'use strict';
// BOT-04 D3: Test der reinen Auswertung des Messwerkzeugs (tools/bot-latenz-auswertung.js) mit synthetischen JSONL-Zeilen:
// Latenzen nur aus gueltigen Messungen, Median gerade/ungerade, p90 Nearest-Rank und n<5-Kennzeichnung, fehlende Marken, Befehlsstatus, exakte Erwartungsregel.
//   node tools/test-bot-latenz-auswertung.js
const A = require('./bot-latenz-auswertung.js');

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };
const section = (t) => console.log('\n[' + t + ']');

const gut = (befehl, o) => Object.assign({ befehl, stt: true, aufwaermen: false, vorbereitung_ok: true, erkannt: true, antwort_status: 'ok', t_antwort_ok: true, rohtext: 'x', t_stt_ms: 900, t_matcher_ms: 1000, t_antwort_ms: 1100, t_zustand_ms: 1300, zustand_status: 'beobachtet', t_ton_ms: 1500 }, o || {});

section('a) Median und p90');
{
  ok(A.median([5]) === 5 && A.median([1, 3, 9]) === 3, 'ungerade n: der mittlere Wert');
  ok(A.median([10, 20]) === 15, 'n = 2: Mittel der beiden (nicht das Minimum)');
  ok(A.median([40, 10, 30, 20]) === 25, 'gerade n = 4: Mittel der beiden mittleren (unsortiert)');
  ok(A.median([]) === null && A.median([null, undefined, NaN]) === null, 'leer / nur kaputte Werte: null');
  ok(A.nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9) === 9, 'Nearest-Rank p90 bei n = 10: 9. Wert');
  ok(A.nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 0.9) === 10, 'Nearest-Rank p90 bei n = 11: 10. Wert (ceil(9,9) = 10)');
  const s4 = A.stat([10, 20, 30, 40]);
  ok(s4.n === 4 && s4.median === 25 && s4.p90 === null && s4.p90_hinweis === 'n zu klein', 'n = 4 < 5: p90 null, Hinweis "n zu klein", Median trotzdem da');
  const s5 = A.stat([10, 20, 30, 40, 50]);
  ok(s5.n === 5 && s5.p90 === 50 && !s5.p90_hinweis && s5.median === 30, 'n = 5: p90 ausgewiesen (Nearest-Rank 5. Wert), kein Hinweis');
  const s0 = A.stat([null, undefined]);
  ok(s0.n === 0 && s0.median === null && s0.p90 === null && !s0.p90_hinweis && s0.min === null, 'keine Werte: n 0, alles null, kein Hinweis');
  const sm = A.stat([100, null, 300, undefined, 200]);
  ok(sm.n === 3 && sm.median === 200 && sm.min === 100 && sm.max === 300, 'fehlende Marken (null/undefined) zaehlen nicht mit');
}

section('b) Einordnung einer Zeile');
{
  const k = (m) => A.klassifiziere(m).art;
  ok(k(gut('nav.stopp')) === 'gemessen', 'erkannt + ok + Vorbereitung ok: gemessen');
  ok(k(gut('nav.stopp', { aufwaermen: true })) === 'aufwaermen', 'Aufwaermlauf');
  ok(k({ befehl: 'nav.stopp', fehler: 'Port belegt' }) === 'fehler', 'Werkzeugfehler');
  ok(k(gut('nav.stopp', { vorbereitung_ok: false })) === 'vorbereitung', 'Vorbereitung gescheitert (auch wenn sonst alles gut aussieht)');
  ok(k(gut('nav.stopp', { vorbereitung_ok: undefined })) === 'vorbereitung', 'Vorbereitung unbekannt (Feld fehlt): nicht gueltig');
  ok(k(gut('nav.stopp', { erkannt: false })) === 'nicht_erkannt', 'nicht erkannt');
  ok(k(gut('nav.stopp', { antwort_status: null, t_antwort_ms: null })) === 'keine_antwort', 'erkannt, aber keine Antwort');
  const a = A.klassifiziere(gut('ops.ziel', { antwort_status: 'kein_ziel', t_antwort_ok: false }));
  ok(a.art === 'abgelehnt' && a.grund === 'kein_ziel', 'abgelehnt mit Grund kein_ziel (Status ohne textId)');
  const a2 = A.klassifiziere(gut('ops.ziel', { antwort_status: 'abgelehnt', antwort_textId: 'ops.ziel.abgelehnt.kein_ziel' }));
  ok(a2.art === 'abgelehnt' && a2.grund === 'kein_ziel', 'abgelehnt: Grund aus der textId (letztes Stueck): kein_ziel');
  ok(A.klassifiziere(gut('bord.sensor', { antwort_status: 'unmoeglich', antwort_textId: 'bord.sensor.unmoeglich.kein_bot' })).grund === 'kein_bot', 'unmoeglich: Grund kein_bot');
}

section('c) gemischte Laeufe: Latenz nur aus gueltigen');
{
  const Z = [
    gut('nav.stopp', { aufwaermen: true, t_antwort_ms: 9999, t_matcher_ms: 9999 }),
    gut('nav.stopp', { t_matcher_ms: 1000, t_antwort_ms: 1100 }),
    gut('nav.stopp', { t_matcher_ms: 1200, t_antwort_ms: 1300 }),
    gut('nav.stopp', { vorbereitung_ok: false, t_matcher_ms: 50000, t_antwort_ms: 50000 }),
    gut('nav.stopp', { erkannt: false, rohtext: 'Hallo', t_matcher_ms: 40000, t_antwort_ms: 40000 }),
    gut('nav.stopp', { antwort_status: 'nicht_jetzt', t_antwort_ms: 70, t_antwort_ok: false, t_matcher_ms: 30000, t_ton_ms: 80, zustand_status: 'keine-aenderung', t_zustand_ms: null }),
    { befehl: 'nav.stopp', fehler: 'kaputt' },
    gut('ops.ziel', { antwort_status: 'kein_ziel', t_antwort_ms: 60, t_antwort_ok: false, t_zustand_ms: null, zustand_status: 'nicht-trennbar' }),
    gut('ops.ziel', { antwort_status: 'kein_ziel', t_antwort_ms: 80, t_antwort_ok: false, t_zustand_ms: null, zustand_status: 'nicht-trennbar' }),
    gut('ops.scan', { erkannt: false, rohtext: 'Scan' }),
    gut('ops.beamen', { vorbereitung_ok: false }),
    gut('bot.status', { antwort_status: null, t_antwort_ms: null }),
  ];
  const sum = A.zusammenfassung(Z, ['nav.stopp', 'ops.ziel', 'ops.scan', 'ops.beamen', 'bot.status', 'tech.prio']);
  const s = sum.je_befehl['nav.stopp'];
  ok(s.messungen === 5 && s.gemessen === 2, 'nav.stopp: 5 gezaehlte Zeilen (ohne Aufwaerm- und Fehlerzeile), 2 gueltig');
  ok(s.t_matcher.n === 2 && s.t_matcher.median === 1100 && s.t_matcher.max === 1200, 'nav.stopp t_matcher: nur die zwei gueltigen (Median 1100, Max 1200, nichts von den 30000+)');
  ok(s.t_antwort.n === 2 && s.t_antwort.median === 1200, 'nav.stopp t_antwort: nur gueltige (Median 1200)');
  ok(s.t_ton.n === 2 && s.t_zustand.n === 2, 'nav.stopp: t_ton und t_zustand nur aus den gueltigen (auch keine Ablehnungs-Marken)');
  ok(s.abgelehnt === 1 && s.abgelehnt_gruende.nicht_jetzt === 1 && s.nicht_erkannt === 1 && s.vorbereitung_gescheitert === 1 && s.keine_antwort === 0, 'nav.stopp: Ablehnung (nicht_jetzt), nicht erkannt, Vorbereitung eigene Spalten');
  ok(s.ablehnung_t_antwort.n === 1 && s.ablehnung_t_antwort.median === 70, 'nav.stopp: Latenz der Ablehnungsantwort getrennt (70 ms), nicht in t_antwort');
  ok(s.t_matcher.p90 === null && s.t_matcher.p90_hinweis === 'n zu klein', 'nav.stopp: n = 2 < 5, p90 als "n zu klein" markiert');
  ok(s.status === 'Annahme-Latenz gemessen (2)', 'nav.stopp: Status "' + s.status + '"');
  const o = sum.je_befehl['ops.ziel'];
  ok(o.gemessen === 0 && o.abgelehnt === 2 && o.t_antwort.n === 0 && o.t_antwort.median === null && o.ablehnung_t_antwort.median === 70, 'ops.ziel nur abgelehnt: keine Annahme-Latenz (n 0), Ablehnungsantwort Median 70 (Mittel 60/80)');
  ok(o.status === 'nur Ablehnung messbar (kein_ziel 2)', 'ops.ziel: Status "' + o.status + '"');
  ok(sum.je_befehl['ops.scan'].status === 'nicht erkannt', 'ops.scan: nicht erkannt');
  ok(sum.je_befehl['ops.beamen'].status === 'Vorbereitung gescheitert', 'ops.beamen: Vorbereitung gescheitert');
  ok(sum.je_befehl['bot.status'].status === 'keine Antwort', 'bot.status: keine Antwort');
  ok(!('tech.prio' in sum.je_befehl), 'Befehl ohne Zeilen taucht nicht auf');
  ok(sum.nur_ablehnung_messbar.length === 1 && sum.nur_ablehnung_messbar[0].befehl === 'ops.ziel' && sum.nur_ablehnung_messbar[0].gruende.kein_ziel === 2, 'Abschnitt "nur Ablehnung messbar" in der Zusammenfassung: ops.ziel');
  ok(sum.nicht_erkannt_befehle.length === 1 && sum.nicht_erkannt_befehle[0] === 'ops.scan', 'Liste "nicht erkannt": ops.scan');
  const g = sum.insgesamt;
  ok(g.gemessen === 2 && g.t_matcher.n === 2 && g.t_matcher.max === 1200, 'insgesamt: Latenz nur aus den 2 gueltigen Zeilen (Ablehnungen und Fehlerkennungen nicht gemischt)');
  ok(g.abgelehnt === 3 && g.nicht_erkannt === 2 && g.vorbereitung_gescheitert === 2 && g.keine_antwort === 1 && g.messungen === 10, 'insgesamt: Spalten abgelehnt 3, nicht erkannt 2, Vorbereitung 2, ohne Antwort 1, Messungen 10');
  ok(sum.aufwaermlaeufe === 1 && sum.fehler.length === 1, 'Aufwaermlauf und Fehler gezaehlt');
  const t = A.tabelle(sum);
  ok(/nur Ablehnung messbar/.test(t) && /Annahme-Latenz gemessen \(2\)/.test(t) && /n<5/.test(t), 'Tabelle nennt Status, Ablehnungs-Abschnitt und "n<5"');
}

section('d) genug Werte fuer p90, fehlende Marken');
{
  const Z = [];
  for (let i = 1; i <= 10; i++) Z.push(gut('nav.schub', { t_antwort_ms: i * 100, t_zustand_ms: i === 3 ? null : i * 200, zustand_status: i === 3 ? 'keine-aenderung' : 'beobachtet' }));
  const o = A.zusammenfassung(Z, ['nav.schub']).je_befehl['nav.schub'];
  ok(o.t_antwort.n === 10 && o.t_antwort.median === 550 && o.t_antwort.p90 === 900 && !o.t_antwort.p90_hinweis, 'n = 10: Median 550 (gerade n), p90 900 (Nearest-Rank), kein Hinweis');
  ok(o.t_zustand.n === 9 && o.t_zustand.median === 1200, 'fehlende Zustandsmarke (null) bleibt draussen: n 9');
  ok(o.zustand_status['keine-aenderung'] === 1 && o.zustand_status.beobachtet === 9, 'Zustandsstatus gezaehlt');
}

section('e) erwartungOk = BotSprache.erwartungErfuellt (exakt)');
{
  const b = { id: 'tech.schild', an: 'technik', args: { sektor: 'heck' } };
  ok(A.erwartungOk(b, { befehl: 'tech.schild', an: 'technik', args: { sektor: 'heck' } }), 'gleicher Befehl, Adressat, Argumente');
  ok(A.erwartungOk(b, { befehl: 'tech.schild', an: 'technik', args: { sektor: 'heck', meter: 50 } }), 'zusaetzliches meter ist erlaubt');
  ok(!A.erwartungOk(b, { befehl: 'tech.schild', an: 'technik', args: { sektor: 'heck', waffen: 'bug' } }), 'zusaetzliches fremdes Argument: nicht erfuellt (nicht nur erwartete Schluessel pruefen)');
  ok(!A.erwartungOk(b, { befehl: 'tech.schild', an: 'ops', args: { sektor: 'heck' } }), 'falscher Adressat: nicht erfuellt');
  ok(!A.erwartungOk(b, { befehl: 'tech.schild', an: 'technik', args: { sektor: 'bug' } }), 'falsches Argument: nicht erfuellt');
  ok(!A.erwartungOk(b, null) && !A.erwartungOk(b, undefined), 'kein Befehl: nicht erfuellt');
  const s = { id: 'bot.status', an: 'alle', args: {} };
  ok(A.erwartungOk(s, { befehl: 'bot.status', an: 'alle', args: {} }), 'an alle: Adressat alle erfuellt');
  ok(!A.erwartungOk(s, { befehl: 'bot.status', an: 'ops', args: {} }), 'an alle erwartet: ein einzelner Adressat zaehlt NICHT (Adressat wird auch bei alle geprueft)');
  ok(A.erwartungOk({ id: 'ops.scan', an: 'ops' }, { befehl: 'ops.scan', an: 'ops' }), 'Argumente fehlen (args null/undefined) werden als leer gelesen');
}

console.log('\n' + (fails ? fails + ' FEHLER von ' + n : n + '/' + n + ' ok'));
process.exit(fails ? 1 : 0);
