'use strict';
// BOT-04 D3: reine Auswertung des Messwerkzeugs tools/bot-latenz.js (keine Abhaengigkeit von Browser, Server, Sleipnir; getestet in tools/test-bot-latenz-auswertung.js).
//
// Gueltig fuer die LATENZ (Median/p90 von t_stt, t_matcher, t_antwort, t_zustand, t_ton) ist nur eine Messung, bei der ALLES zutrifft: kein Aufwaermlauf, kein Werkzeugfehler,
// Vorbereitung ok (vorbereitung_ok === true), der erwartete Befehl wurde erkannt (erkannt === true, exakte Regel BotSprache.erwartungErfuellt) UND die Antwort des Servers lautet ok.
// Alles andere steht in eigenen Spalten, mit Grund, und fliesst NICHT in die Latenz:
//   abgelehnt (Server-Status != ok, z. B. kein_ziel/nicht_jetzt/system; die Latenz der Ablehnungsantwort steht getrennt als Info, ablehnung_t_antwort),
//   nicht erkannt (Matcher lieferte nichts oder etwas anderes als erwartet), keine Antwort (erkannt, aber nichts vom Server), Vorbereitung gescheitert, Fehler des Werkzeugs.
// Je Befehl sagt die Ausgabe genau eines: "Annahme-Latenz gemessen (n)" | "nur Ablehnung messbar (Grund)" | "nicht erkannt" | "keine Antwort" | "Vorbereitung gescheitert" | "keine gueltige Messung".
//
// Statistik: Median = Mittel der beiden mittleren Werte bei geradem n (sonst der mittlere). p90 = Nearest-Rank, s[ceil(0,9 n) - 1] auf den sortierten Werten (kein Interpolieren);
// bei n < P90_MIN_N (5) ist das p90 nur der groesste/zweitgroesste Wert und wird nicht ausgewiesen (p90 null, p90_hinweis "n zu klein"). Fehlende Marken (null) zaehlen nicht mit.
// Der Zustand ("t_zustand") ist eine BEOBACHTUNG im Snapshot (Wert nach dem Absenden des bot.befehl gegen den Wert beim Absenden), keine Kausalitaet: ein Schiff, das von selbst dreht
// (Randstreifen, Standardbewegung), kann eine Zustandsregel zufaellig erfuellen. Zustandsmarken vor dem Absenden zaehlen nie.
const BotSprache = require('../public/js/bot-sprache.js');   // UMD, in Node als Modul: dieselbe Regel wie der Messmodus der Sprache (kein Duplikat)

const MARKEN = ['t_aufnahme_ende_ms', 't_stt_ms', 't_matcher_ms', 't_antwort_ms', 't_zustand_ms', 't_ton_ms'];
const P90_MIN_N = 5;

// exakt wie BotSprache.erwartungErfuellt (gleicher Befehl, genau die erwarteten Argumente, bei erwartetem Adressaten auch der Adressat, nur meter darf zusaetzlich sein); auch bei an 'alle'
const erwartungOk = (b, e) => !!e && BotSprache.erwartungErfuellt({ befehl: b.id, an: b.an, args: b.args || {} }, e);

function median(a) {
  const v = a.filter((x) => typeof x === 'number' && isFinite(x));
  if (!v.length) return null;
  const s = v.slice().sort((x, y) => x - y), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
function nearestRank(a, p) {
  const v = a.filter((x) => typeof x === 'number' && isFinite(x));
  if (!v.length) return null;
  const s = v.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
}
function stat(a) {
  const v = a.filter((x) => typeof x === 'number' && isFinite(x));
  const o = { n: v.length, median: median(v), p90: v.length >= P90_MIN_N ? nearestRank(v, 0.9) : null, min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null };
  if (v.length && v.length < P90_MIN_N) o.p90_hinweis = 'n zu klein';
  return o;
}

// Grund einer Ablehnung: das letzte Stueck der textId '<befehl>.<status>.<grund>' (z. B. kein_ziel, nicht_jetzt, kein_bot, system), sonst der Status
const ablehnGrund = (m) => { const t = m.antwort_textId == null ? '' : String(m.antwort_textId).split('.'); return t.length >= 3 ? t[t.length - 1] : String(m.antwort_status); };

// Einordnung einer Messzeile: { art, grund? }; art: aufwaermen | fehler | vorbereitung | nicht_erkannt | keine_antwort | abgelehnt | gemessen
function klassifiziere(m) {
  if (m.aufwaermen) return { art: 'aufwaermen' };
  if (m.fehler) return { art: 'fehler', grund: String(m.fehler) };
  if (m.vorbereitung_ok !== true) return { art: 'vorbereitung' };
  if (m.erkannt !== true) return { art: 'nicht_erkannt', grund: m.rohtext == null ? null : String(m.rohtext) };
  if (m.antwort_status == null) return { art: 'keine_antwort' };
  if (m.antwort_status !== 'ok') return { art: 'abgelehnt', grund: ablehnGrund(m) };
  return { art: 'gemessen' };
}

const zaehle = (liste, f) => { const o = {}; for (const m of liste) { const k = f(m); if (k != null) o[k] = (o[k] || 0) + 1; } return o; };
const summe = (o) => Object.values(o).reduce((a, b) => a + b, 0);

// Auswertung einer Zeilenmenge (ein Befehl oder alle)
function fuer(liste) {
  const k = liste.map((m) => ({ m, c: klassifiziere(m) }));
  const von = (art) => k.filter((x) => x.c.art === art).map((x) => x.m);
  const gueltig = von('gemessen'), abgelehnt = von('abgelehnt'), nichtErkannt = von('nicht_erkannt'), keineAntwort = von('keine_antwort'), vorb = von('vorbereitung');
  const o = {
    messungen: liste.length,
    gemessen: gueltig.length,
    abgelehnt: abgelehnt.length, abgelehnt_gruende: zaehle(abgelehnt, ablehnGrund),
    nicht_erkannt: nichtErkannt.length, nicht_erkannt_roh: zaehle(nichtErkannt, (m) => (m.rohtext == null ? '(kein Text)' : m.rohtext)),
    keine_antwort: keineAntwort.length,
    vorbereitung_gescheitert: vorb.length,
    erkannt: liste.filter((m) => m.erkannt === true).length,
  };
  const werte = (l, marke) => l.map((m) => m[marke]).filter((x) => x != null);
  for (const marke of MARKEN) o[marke.replace(/_ms$/, '')] = stat(werte(gueltig, marke));   // NUR gueltige Messungen
  o.ablehnung_t_antwort = stat(werte(abgelehnt, 't_antwort_ms'));   // Info: wie schnell lehnt der Server ab; nicht Teil der Annahme-Latenz
  o.zustand_nicht_trennbar = gueltig.length > 0 && gueltig.every((m) => m.zustand_status === 'nicht-trennbar');
  o.zustand_status = zaehle(gueltig, (m) => m.zustand_status);
  return o;
}

// "Annahme-Latenz gemessen (n)" | "nur Ablehnung messbar (Grund)" | "nicht erkannt" | "keine Antwort" | "Vorbereitung gescheitert" | "keine gueltige Messung"
function befehlsStatus(o) {
  if (o.gemessen > 0) return 'Annahme-Latenz gemessen (' + o.gemessen + ')';
  if (o.abgelehnt > 0) return 'nur Ablehnung messbar (' + Object.entries(o.abgelehnt_gruende).map(([g, n]) => g + ' ' + n).join(', ') + ')';
  if (o.nicht_erkannt > 0) return 'nicht erkannt';
  if (o.keine_antwort > 0) return 'keine Antwort';
  if (o.vorbereitung_gescheitert > 0) return 'Vorbereitung gescheitert';
  return 'keine gueltige Messung';
}

// zeilen: alle JSONL-Zeilen; ids: Befehle in Ausgabereihenfolge
function zusammenfassung(zeilen, ids) {
  const z = zeilen.filter((m) => !m.aufwaermen && !m.fehler);
  const je = {};
  for (const id of ids) { const l = z.filter((m) => m.befehl === id); if (l.length) { je[id] = fuer(l); je[id].status = befehlsStatus(je[id]); } }
  const nurAbl = Object.entries(je).filter(([, o]) => o.gemessen === 0 && o.abgelehnt > 0).map(([id, o]) => ({ befehl: id, gruende: o.abgelehnt_gruende }));
  const nichtErk = Object.entries(je).filter(([, o]) => o.gemessen === 0 && o.abgelehnt === 0 && o.nicht_erkannt > 0).map(([id]) => id);
  return {
    insgesamt: fuer(z), je_befehl: je, nur_ablehnung_messbar: nurAbl, nicht_erkannt_befehle: nichtErk,
    aufwaermlaeufe: zeilen.filter((m) => m.aufwaermen).length, fehler: zeilen.filter((m) => m.fehler).map((m) => m.befehl + ': ' + m.fehler),
  };
}

const f = (s) => (s && s.n ? (s.median % 1 ? s.median.toFixed(1) : String(s.median)) + '/' + (s.p90 == null ? 'n<5' : s.p90) + ' (' + s.n + ')' : '-');
function tabelle(sum) {
  const kopf = ['Befehl'.padEnd(16), 'n', 'ok', 'abl', 'n.erk', 'o.Antw', 'Vorb', 'stt', 'matcher', 'antwort', 'zustand', 'ton', 'Ablehnung-Antwort', 'Status'];
  const zeilen = [kopf.join(' | ')];
  const zeile = (name, o, status) => zeilen.push([name.padEnd(16), String(o.messungen).padStart(2), String(o.gemessen).padStart(2), String(o.abgelehnt).padStart(3), String(o.nicht_erkannt).padStart(5), String(o.keine_antwort).padStart(6), String(o.vorbereitung_gescheitert).padStart(4),
    f(o.t_stt).padStart(12), f(o.t_matcher).padStart(12), f(o.t_antwort).padStart(12),
    (o.zustand_nicht_trennbar ? 'nicht trennbar' : f(o.t_zustand) + (o.zustand_status['vorab-erfuellt'] || o.zustand_status['keine-aenderung'] ? ' [' + Object.entries(o.zustand_status).filter(([k]) => k !== 'beobachtet').map(([k, v]) => k + ' ' + v).join(',') + ']' : '')).padStart(14),
    f(o.t_ton).padStart(12), f(o.ablehnung_t_antwort).padStart(12), status || ''].join(' | '));
  for (const [k, o] of Object.entries(sum.je_befehl)) zeile(k, o, o.status);
  zeile('ALLE', sum.insgesamt, '');
  let t = 'Median/p90 in ms ab Loslassen (n), NUR aus gueltigen Messungen (erkannt, erwarteter Befehl, Antwort ok, Vorbereitung ok); p90 "n<5" = n zu klein.\n'
    + 'ok = gueltig, abl = vom Server abgelehnt, n.erk = nicht erkannt, o.Antw = erkannt ohne Antwort, Vorb = Vorbereitung gescheitert. Median bei geradem n = Mittel der beiden mittleren Werte, p90 = Nearest-Rank.\n'
    + zeilen.join('\n');
  if (sum.nur_ablehnung_messbar.length) t += '\n\nNur Ablehnung messbar (keine Annahme-Latenz, die Lage im Szenario nimmt den Befehl nicht an):\n' + sum.nur_ablehnung_messbar.map((x) => '  ' + x.befehl + ': ' + Object.entries(x.gruende).map(([g, n]) => g + ' ' + n).join(', ')).join('\n');
  if (sum.nicht_erkannt_befehle.length) t += '\n\nNicht erkannt: ' + sum.nicht_erkannt_befehle.join(', ');
  return t;
}

module.exports = { MARKEN, P90_MIN_N, erwartungOk, median, nearestRank, stat, klassifiziere, fuer, befehlsStatus, zusammenfassung, tabelle };
if (require.main === module) { console.log('Reine Auswertung fuer tools/bot-latenz.js; Test: node tools/test-bot-latenz-auswertung.js'); }
