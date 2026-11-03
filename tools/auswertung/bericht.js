'use strict';
// TEL-01 D1: Sessionbericht als Markdown. bericht(kz, opt) -> Text, HOECHSTENS ZEILEN_MAX = 60 Zeilen (ein harter Deckel, Test und Mutationsprobe halten ihn fest).
//   kz   Kennzahlen-Objekt aus kennzahlen.js (der Vertrag)
//   opt  { basis, ziele, svg }
//          basis  Kennzahlen-Objekt (oder flache Map { schluessel: zahl }) einer früheren Session: Abweichungen kommen oben in die Auffälligkeiten
//          ziele  { schluessel: { min, max } } (Datei tools/fixtures/telemetrie/ziele.json, Format unten); leer -> keine Ampel
//          svg    Dateiname des Gefechtsprofils, relativ eingebunden: ![Gefechtsprofil](<svg>)
//
// ZIELDATEI tools/fixtures/telemetrie/ziele.json: { "version": 1, "ziele": { "<Kennzahl-Schlüssel>": { "min": <Zahl>, "max": <Zahl> } } }
//   min und max sind einzeln optional. Leer ({ "version": 1, "ziele": {} }) -> keine Ampeln. Kai legt die Werte fest; es stehen keine erfundenen Werte darin.
//   Mit Eintrag: Block "Ziele" mit Ampel je Kennzahl ([gruen] im Bereich, [rot] außerhalb, [grau] kein Wert im Lauf), rote Eintraege auch oben in den Auffälligkeiten.
//
// Keine Namen: der Bericht nennt nur Slots (p1..p4) und Rollen. Nichts davon geht an ein LLM.

const { flach, infoZu } = require('./kennzahlen.js');

const ZEILEN_MAX = 60;
const AUFFAELLIG_MAX = 8;             // Zeilen im Auffälligkeiten-Abschnitt (ohne Ueberschrift)
const LEERLAUF_AUFFAELLIG_S = 60;     // Leerlauf je Slot: mindestens so viele s in Strecken von >= 30 s ohne Eingabe ...
const LEERLAUF_AUFFAELLIG_ANTEIL = 20; // ... UND mindestens so viel Prozent der verbundenen Zeit (beides, sonst fallen kurze Raststrecken auf)
const TICK_SPITZE_MS = 33;

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const n = (v, d) => (num(v) ? (Math.round(v * Math.pow(10, d == null ? 1 : d)) / Math.pow(10, d == null ? 1 : d)).toString().replace('.', ',') : '-');
function zeit(s) {
  if (!num(s)) return '-';
  if (s < 120) return n(s, 1) + ' s';
  const m = Math.floor(s / 60), r = Math.round(s - m * 60);
  return (r === 60 ? m + 1 : m) + ':' + String(r === 60 ? 0 : r).padStart(2, '0') + ' min';
}
const wert = (v, einheit) => (einheit === '%' ? n(v, 1) + ' %' : einheit === 's' ? zeit(v) : einheit === 'ms' ? n(v, 2) + ' ms' : n(v, 2));
const get = (o, pfad) => { let c = o; for (const k of pfad.split('.')) { if (c == null || typeof c !== 'object') return undefined; c = c[k]; } return c; };
const keys = (o) => (o && typeof o === 'object' ? Object.keys(o).sort() : []);

function basisFlach(basis) {
  if (!basis || typeof basis !== 'object') return null;
  return basis.f1 || basis.f2 || basis.f6 ? flach(basis) : basis;
}

// ---------- Auffälligkeiten ----------
function abweichungen(kz, basis) {
  const a = flach(kz), b = basisFlach(basis);
  const out = [];
  let verglichen = 0;
  for (const k of Object.keys(a)) {
    if (!(k in b) || !num(b[k])) continue;
    const info = infoZu(k);
    if (!info) continue;
    verglichen++;
    const diff = Math.abs(a[k] - b[k]);
    const rel = b[k] === 0 ? (a[k] === 0 ? 0 : Infinity) : diff / Math.abs(b[k]);
    if (diff < info.min || rel < info.rel) continue;
    const schlechter = info.richtung === 'neutral' ? false : (info.richtung === 'schlechter' ? a[k] > b[k] : a[k] < b[k]);
    out.push({ k, a: a[k], b: b[k], rel, info, schlechter, score: Math.min(rel, 10) * (schlechter ? 1.5 : 1) });
  }
  out.sort((x, y) => y.score - x.score || (x.k < y.k ? -1 : 1));
  return { liste: out, verglichen, fehlt: Object.keys(b).filter((k) => !(k in a) && infoZu(k)).length };
}
function amp(z, w) { if (!num(w)) return 'grau'; if ((num(z.min) && w < z.min) || (num(z.max) && w > z.max)) return 'rot'; return 'gruen'; }
function zielBewertung(kz, ziele) {
  const a = flach(kz);
  return Object.keys(ziele || {}).map((k) => ({ k, w: a[k], z: ziele[k], status: amp(ziele[k] || {}, a[k]), info: infoZu(k) }));
}

function auffaelligkeiten(kz, opt) {
  const z = [];
  const f3 = kz.f3 || {}, f4 = kz.f4 || {}, f6 = kz.f6 || {};
  const g = (o, p) => get(o, p);
  // 1. Datenqualitaet
  const dq = [];
  if (g(f6, 'daten.abgeschnitten') > 0) dq.push(g(f6, 'daten.abgeschnitten') + ' abgeschnittene Zeile(n)');
  if (g(f6, 'daten.kaputt') > 0) dq.push(g(f6, 'daten.kaputt') + ' kaputte Zeile(n)');
  if (g(f6, 'daten.unbekannte_typen') > 0) dq.push(g(f6, 'daten.unbekannte_typen') + ' Zeile(n) unbekannten Typs');
  if (kz.kopf && kz.kopf.schema_version != null && kz.kopf.schema_version !== 1) dq.push('Schema-Version ' + kz.kopf.schema_version);
  if (dq.length) z.push('Daten: ' + dq.join(', ') + ' (Kennzahlen unvollständig moeglich)');
  // 2. Verluste
  const vl = [];
  if (g(f3, 'gefallen.n') > 0) vl.push(g(f3, 'gefallen.n') + ' gefallen');
  if (g(f3, 'notrueckholung.n') > 0) vl.push(g(f3, 'notrueckholung.n') + ' Notrückholung(en)');
  if (g(f3, 'notfall.n') > 0) vl.push(g(f3, 'notfall.n') + ' Notfallprotokoll(e)');
  if (g(f3, 'zone_aus.n') > 0) vl.push(g(f3, 'zone_aus.n') + ' Zonenausfall/-ausfälle' + (g(f3, 'zone_aus.kaputt') > 0 ? ' (' + g(f3, 'zone_aus.kaputt') + ' kaputt)' : ''));
  if (g(f3, 'schiff_zerstoert.n') > 0) vl.push('Schiff zerstört');
  if (g(f3, 'neustarts') > 0) vl.push(g(f3, 'neustarts') + ' Neustart(s)');
  if (vl.length) z.push('Verluste: ' + vl.join(', ') + ' (erster bei ' + zeit(g(f3, 'erster_verlust_s')) + ')');
  // 3. Ziele außerhalb
  const rote = zielBewertung(kz, opt.ziele).filter((x) => x.status === 'rot');
  for (const x of rote.slice(0, 2)) z.push('Ziel verfehlt: ' + x.k + ' = ' + wert(x.w, x.info && x.info.einheit) + ' (Ziel ' + (num(x.z.min) ? 'min ' + n(x.z.min, 2) : '') + (num(x.z.min) && num(x.z.max) ? ', ' : '') + (num(x.z.max) ? 'max ' + n(x.z.max, 2) : '') + ')');
  // 4. Basis
  let basisZeile = null;
  if (!opt.basis) basisZeile = 'Basis: keine Basis angegeben (kein Vergleich; --basis <json> vergleicht mit einer früheren Session)';
  else {
    const ab = abweichungen(kz, opt.basis);
    basisZeile = 'Basis: ' + ab.verglichen + ' Kennzahlen verglichen, ' + ab.liste.length + ' wesentlich anders (>= 25 % und Mindestmenge je Kennzahl)' + (ab.fehlt ? ', ' + ab.fehlt + ' nur in der Basis' : '');
    z.push(basisZeile);
    for (const x of ab.liste.slice(0, 3)) {
      const e = x.info.einheit;
      z.push('  ' + x.k + ': ' + wert(x.a, e) + ' statt ' + wert(x.b, e) + (x.b !== 0 ? ' (' + (x.a >= x.b ? '+' : '-') + n(100 * Math.abs(x.a - x.b) / Math.abs(x.b), 0) + ' %)' : '') + (x.info.richtung === 'neutral' ? '' : x.schlechter ? ', schlechter' : ', besser'));
    }
    if (ab.liste.length > 3) z.push('  (+' + (ab.liste.length - 3) + ' weitere Abweichungen)');
    basisZeile = null;
  }
  if (basisZeile) z.push(basisZeile);
  // 5. Leerlauf je Slot
  const ll = [];
  for (const s of keys(f4.leerlauf)) {
    const e = f4.leerlauf[s];
    if (e.dauer >= LEERLAUF_AUFFAELLIG_S && e.anteil >= LEERLAUF_AUFFAELLIG_ANTEIL) ll.push(s + ' ' + zeit(e.dauer) + ' (' + n(e.anteil, 0) + ' %)');
  }
  if (ll.length) z.push('Leerlauf (>= 30 s ohne Eingabe): ' + ll.join(', '));
  // 6. Technik
  const te = [];
  if (g(f6, 'tick.ueber33') > 0) te.push(g(f6, 'tick.ueber33') + ' Ticks > ' + TICK_SPITZE_MS + ' ms (max ' + n(g(f6, 'tick.max'), 1) + ' ms)');
  if (g(f6, 'kappung.n') > 0) te.push('Kappung ' + g(f6, 'kappung.n') + '× (' + g(f6, 'kappung.ticks') + ' Ticks verworfen)');
  const sf = (g(f6, 'fehler.schreiben') || 0) + (g(f6, 'fehler.verworfen') || 0) + (g(f6, 'fehler.zeitreihe') || 0);
  if (sf > 0) te.push(sf + ' Protokollfehler/verworfene Zeilen');
  if (g(f6, 'spielleiter.timeout') > 0) te.push(g(f6, 'spielleiter.timeout') + ' Spielleiter-Timeout(s)');
  if (te.length) z.push('Technik: ' + te.join(', '));
  if (!z.length) z.push('keine Auffälligkeiten');
  if (z.length > AUFFAELLIG_MAX) { const rest = z.length - (AUFFAELLIG_MAX - 1); z.length = AUFFAELLIG_MAX - 1; z.push('(+' + rest + ' weitere Zeilen gekürzt)'); }
  return z;
}

// ---------- Bloecke ----------
const liste = (o, fn, trenn) => keys(o).map((k) => fn(k, o[k])).filter(Boolean).join(trenn || ' · ');

function kopfBlock(kz, opt) {
  const k = kz.kopf || {};
  const sz = (kz.listen && kz.listen.szenen) || [];
  const f1 = kz.f1 || {};
  const sp = f1.spieler || {};
  const szenen = sz.slice(0, 4).map((s) => String(s.szene || s.modus) + ' ' + zeit(s.start == null ? 0 : s.start) + '-' + zeit(s.ende)).join(', ') + (sz.length > 4 ? ' +' + (sz.length - 4) + ' weitere' : '');
  return [
    '# Sessionbericht ' + (k.sitzung || '?'),
    'Quelle ' + (k.quelle || '?') + ' · Commit ' + (k.commit ? String(k.commit).slice(0, 8) : '?') + ' · ' + (k.plattform || '?') + ' · Modus ' + (k.modus || '?') + (k.szenario ? ' (' + k.szenario + ')' : '') + ' · Seed ' + (k.seed == null ? '?' : k.seed) + ' · Spieler ' + n(sp.start, 0) + ' (Start) / ' + n(sp.max, 0) + ' (max) · Dauer ' + zeit(k.dauer) + (k.grund ? ' · Ende: ' + k.grund : ''),
    'Szenen: ' + (szenen || 'keine') + ' · Regielog: ' + (k.regielog || '-') + (k.weltstand ? ' (Weltstand ' + k.weltstand + ')' : ''),
  ];
}
function f1Block(kz) {
  const f1 = kz.f1 || {};
  const z = ['## F1 Dauer und Ausgang'];
  const modi = keys(f1.dauer).filter((m) => m !== 'session');
  const d = liste(f1.dauer, (m, v) => (m === 'session' ? null : m + ' ' + n(v.n, 0) + '× Ø ' + zeit(v.mittel)));
  const a = liste(f1.ausgang, (k, v) => k + ' ' + v);
  z.push('- Szenen je Modus: ' + (modi.length ? d : 'keine') + (a ? ' · Ausgang: ' + a : ''));
  const sp = f1.spieler || {};
  z.push('- Spieler: Start ' + n(sp.start, 0) + ', max ' + n(sp.max, 0) + ', Nachzügler ' + n(sp.nachzuegler, 0) + ', Abgänge ' + n(sp.abgaenge, 0) + (f1.wellen ? ' · Wellen geschafft ' + n(f1.wellen.geschafft, 0) + ' (Ø ' + zeit(f1.wellen.dauer_mittel) + ')' : '') + (f1.neustarts ? ' · Neustarts ' + f1.neustarts : ''));
  return z;
}
function f2Block(kz) {
  const f2 = kz.f2 || {};
  const z = ['## F2 Gefecht'];
  const gd = liste(f2.gefecht, (k, v) => k + ' ' + zeit(v));
  if (gd) z.push('- Gefechtsdauer: ' + gd);
  const orte = keys(f2.schaden);
  for (const ort of orte) {
    const s = f2.schaden[ort];
    const t = (r) => (r ? 'roh ' + n(r.roh, 1) + ' (Schild ' + n(r.schild, 1) + ', wirkt ' + n(r.wirkt, 1) + ')' : '-');
    z.push('- Schaden ' + ort + ': aus ' + t(s.aus) + ' / ein ' + t(s.ein));
  }
  for (const [name, sg] of [['Quote', ''], ['Quote Gegner', '_gegner']]) {
    const q = f2['quote' + sg];
    for (const ort of keys(q)) {
      const text = liste(q[ort], (w, v) => w + ' ' + n(v, 0) + ' % (' + n(get(f2, 'schuesse' + sg + '.' + ort + '.' + w), 0) + ' Sch., ' + n(get(f2, 'treffer_je_schuss' + sg + '.' + ort + '.' + w), 2) + ' Tr/Sch)');
      if (text) z.push('- ' + name + ' ' + ort + ': ' + text);
    }
  }
  for (const ort of keys(f2.kills)) {
    const ks = f2.kills[ort];
    const text = liste(ks, (r, v) => (r === 'gesamt' ? null : r + ' ' + v + (get(f2, 'zeit_bis_kill.' + ort + '.' + r) != null ? ' (Ø ' + zeit(get(f2, 'zeit_bis_kill.' + ort + '.' + r)) + ')' : '')));
    z.push('- Kills ' + ort + ' (' + ks.gesamt + '), Zeit bis Kill je Rolle (Median): ' + text);
  }
  const ue = liste(f2.ueberhitzt, (ort, v) => liste(v, (s, c) => ort + ' ' + s + ' ' + c, ', '));
  if (ue) z.push('- Überhitzung: ' + ue);
  if (z.length === 1) z.push('- keine Daten (kein Gefecht)');
  return z;
}
function f2bBlock(kz) {
  const f = kz.f2b || {};
  const z = ['## F2b Deckung'];
  const dk = liste(f.deckung, (s, v) => s + ' ' + zeit(v.cv_s) + (v.cv_anteil != null ? ' (' + n(v.cv_anteil, 1) + ' %)' : '') + ', geduckt ' + zeit(v.geduckt_s) + ', verdeckt ' + zeit(v.verdeckt_s), ' · ');
  if (dk) z.push('- In Deckung (cv > 0), geduckt, verdeckt je Slot: ' + dk);
  if (f.verlassen) z.push('- Deckung verlassen: ' + f.verlassen.n + '×, davon ' + f.verlassen.mit_treffer + ' mit Treffer, bis Treffer (Median) ' + zeit(f.verlassen.bis_treffer_median) + ' · Peek-and-Shoot: ' + f.peek.mit_schuss + ' von ' + f.peek.episoden + ' kurzen Episoden (< 3 s) mit Schuss');
  const t = [];
  if (f.treffer_auf_spieler) t.push('Treffer auf Spieler in Deckung ' + n(f.treffer_auf_spieler.in_deckung_anteil, 1) + ' % (n ' + f.treffer_auf_spieler.n + ')');
  if (f.treffer_von_spieler) t.push('eigene Treffer aus Deckung ' + n(f.treffer_von_spieler.aus_deckung_anteil, 1) + ' % (n ' + f.treffer_von_spieler.n + ')');
  if (f.schuesse_spieler) t.push('Spielerschüsse aus Deckung ' + n(f.schuesse_spieler.aus_deckung_anteil, 1) + ' %');
  if (f.schuesse_gegner) t.push('Gegnerschüsse aus Deckung ' + n(f.schuesse_gegner.aus_deckung_anteil, 1) + ' %');
  if (t.length) z.push('- ' + t.join(' · '));
  if (f.gegner_abstand) z.push('- Gegnerabstand: Ø nächster Nachbar ' + n(f.gegner_abstand.nn_mittel, 1) + ' Kacheln, kleinster ' + n(f.gegner_abstand.min, 1) + ' · Gegner geduckt ' + n(f.gegner_geduckt_anteil, 1) + ' %');
  if (z.length === 1) z.push('- keine Daten (kein Gefecht am Boden)');
  return z;
}
function f3Block(kz) {
  const f = kz.f3 || {};
  const z = ['## F3 Verluste'];
  const v = [];
  const add = (txt, c) => { if (c > 0) v.push(txt + ' ' + c); };
  add('gefallen', get(f, 'gefallen.n')); add('Bodenschild leer', get(f, 'bodenschild_leer.n')); add('Notrückholung', get(f, 'notrueckholung.n'));
  add('Notfallprotokoll', get(f, 'notfall.n')); add('Zonenausfall', get(f, 'zone_aus.n')); add('Schiff zerstört', get(f, 'schiff_zerstoert.n')); add('Neustart', f.neustarts);
  z.push('- ' + (v.length ? v.join(' · ') : 'keine Verluste') + (f.huelle ? ' · Hülle (Systemintegrität) min ' + n(f.huelle.min, 0) + ' %' : ''));
  const l = ((kz.listen && kz.listen.verluste) || []);
  if (l.length) {
    const kurz = l.filter((x) => x.art !== 'bodenschild_leer').slice(0, 6).map((x) => x.art + (x.slot ? ' ' + x.slot : '') + (x.system ? ' ' + x.system : '') + ' ' + zeit(x.t)).join(', ');
    if (kurz) z.push('- Zeitpunkte: ' + kurz + (l.length > 6 ? ', ...' : ''));
  }
  return z;
}
function f4Block(kz) {
  const f = kz.f4 || {};
  const z = ['## F4 Menschen: Rollen, Leerlauf, Reparatur'];
  const ro = (kz.listen && kz.listen.rollen) || {};
  for (const s of keys(f.dabei)) {
    const r = f.rolle && f.rolle[s] ? liste(f.rolle[s], (k, v) => k + ' ' + zeit(v), ', ') : '-';
    const l = (f.leerlauf || {})[s];
    const info = ro[s] || {};
    const x = (info.nachzuegler ? ' · Nachzügler ab ' + zeit(info.erstes_fenster) : '') + (info.abgang != null ? ' · Abgang bei ' + zeit(info.abgang) : '');
    z.push('- ' + s + ': dabei ' + zeit(f.dabei[s]) + ' · ' + r + ' · Leerlauf ' + (l ? zeit(l.dauer) + ' (' + l.episoden + '×, ' + n(l.anteil, 0) + ' %)' : '-') + ' · Wechsel ' + n(get(f, 'wechsel.' + s), 0) + x);
  }
  if (z.length === 1 && !f.reparatur) z.push('- keine Daten');
  if (f.reparatur) z.push('- Reparaturspiele: ' + f.reparatur.n + ', Erfolg ' + n(f.reparatur.erfolg_anteil, 0) + ' %, Ø ' + zeit(f.reparatur.dauer_mittel) + ', Notflicken ' + n(f.reparatur.notflicken, 0));
  return z;
}
function f5Block(kz) {
  const f = kz.f5 || {};
  const z = ['## F5 Wirtschaft'];
  const marks = liste(get(f, 'buchung.marks'), (g, v) => g + ' ' + (v > 0 ? '+' : '') + n(v, 0), ', ');
  const m = get(f, 'konto.marks');
  if (m) z.push('- Marken: Anfang ' + n(m.anfang, 0) + ' → Ende ' + n(m.ende, 0) + ' (netto ' + (m.netto > 0 ? '+' : '') + n(m.netto, 0) + '): ' + (marks || 'keine Buchungen'));
  const gut = liste(f.buchung, (k, v) => (k === 'marks' ? null : k + ' ' + liste(v, (g, c) => g + ' ' + (c > 0 ? '+' : '') + n(c, 0), '/')), ' · ');
  if (gut) z.push('- Verbrauchsgüter (Summe je Grund): ' + gut);
  const ru = liste(f.ruf, (k, v) => k + ' ' + (v > 0 ? '+' : '') + n(v, 0), ', ');
  if (ru) z.push('- Ruf: ' + ru);
  if (f.energie) z.push('- Energieverteilung (Mittel): Antrieb ' + n(f.energie.engines_anteil, 0) + ' %, Schild ' + n(f.energie.shields_anteil, 0) + ' %, Waffen ' + n(f.energie.weapons_anteil, 0) + ' %' + (f.energie.technik_n != null || f.energie.automatik_n != null ? ' · Änderungen: Konsole ' + n(f.energie.technik_n || 0, 0) + ', Automatik ' + n(f.energie.automatik_n || 0, 0) : ''));
  if (z.length === 1) z.push('- keine Wirtschaftsereignisse');
  return z;
}
function f6Block(kz) {
  const f = kz.f6 || {};
  const z = ['## F6 Technik'];
  if (f.tick) z.push('- Tickzeit: Median ' + n(f.tick.med, 3) + ' ms, längster ' + n(f.tick.max, 2) + ' ms · Ticks > 5/16/33 ms: ' + n(f.tick.ueber5, 0) + '/' + n(f.tick.ueber16, 0) + '/' + n(f.tick.ueber33, 0) + (f.snap ? ' · Snapshot Median ' + n(f.snap.med, 2) + ' ms, max ' + n(f.snap.max, 2) + ' ms' : ' · kein Snapshot (Bot-Lauf)') + ' · Kappung ' + n(get(f, 'kappung.n'), 0) + '× (nachgeholt ' + n(get(f, 'kappung.nachholt'), 0) + ')');
  if (f.spielleiter) z.push('- Spielleiter-Wartezeit: ' + f.spielleiter.n + '×, Median ' + zeit(f.spielleiter.dauer_median) + ', max ' + zeit(f.spielleiter.dauer_max) + ', Timeouts ' + n(f.spielleiter.timeout, 0));
  z.push('- Protokoll: ' + n(get(f, 'protokoll.zeilen'), 0) + ' Zeilen (' + n(get(f, 'protokoll.zeilen_je_min'), 0) + '/min, ' + n(get(f, 'protokoll.mb_je_h'), 1) + ' MB/h) · Schreibfehler ' + n(get(f, 'fehler.schreiben'), 0) + ', verworfen ' + n(get(f, 'fehler.verworfen'), 0));
  return z;
}
function zieleBlock(kz, ziele) {
  const b = zielBewertung(kz, ziele);
  if (!b.length) return null;
  const z = ['## Ziele'];
  for (const x of b) z.push('- [' + (x.status === 'gruen' ? 'grün' : x.status) + '] ' + x.k + ' = ' + (num(x.w) ? wert(x.w, x.info && x.info.einheit) : 'kein Wert') + ' (' + (num(x.z.min) ? 'min ' + n(x.z.min, 2) : '') + (num(x.z.min) && num(x.z.max) ? ', ' : '') + (num(x.z.max) ? 'max ' + n(x.z.max, 2) : '') + ')');
  return z;
}

// Deckel: von hinten (unwichtigste Bloecke zuerst) je eine Zeile entfernen, bis es passt; Ueberschrift und erste Zeile bleiben
function begrenzen(bloecke, max) {
  const gesamt = () => bloecke.reduce((s, b) => s + b.zeilen.length, 0);
  let gekürzt = false;
  while (gesamt() > max) {
    const b = bloecke.filter((x) => x.zeilen.length > 2).sort((x, y) => y.prio - x.prio)[0];
    if (!b) break;
    b.zeilen.pop(); gekürzt = true;
  }
  const out = [];
  for (const b of bloecke) out.push(...b.zeilen);
  if (gesamt() > max) out.length = max;   // notfalls hart
  if (gekürzt && out.length) out[out.length - 1] += ' (Bericht auf ' + max + ' Zeilen gekürzt)';
  return out;
}

function bericht(kz, opt) {
  opt = opt || {};
  const ziele = opt.ziele && typeof opt.ziele === 'object' ? (opt.ziele.ziele || (opt.ziele.version ? {} : opt.ziele)) : {};
  const o = { basis: opt.basis || null, ziele };
  const bl = [];
  bl.push({ prio: 0, zeilen: kopfBlock(kz, o) });
  bl.push({ prio: 1, zeilen: ['## Auffälligkeiten'].concat(auffaelligkeiten(kz, o).map((l) => (l.startsWith('  ') ? '  - ' + l.trim() : '- ' + l))) });
  const zb = zieleBlock(kz, ziele);
  if (zb) bl.push({ prio: 2, zeilen: zb });
  bl.push({ prio: 3, zeilen: f1Block(kz) });
  bl.push({ prio: 4, zeilen: f2Block(kz) });
  bl.push({ prio: 5, zeilen: f2bBlock(kz) });
  bl.push({ prio: 6, zeilen: f3Block(kz) });
  bl.push({ prio: 7, zeilen: f4Block(kz) });
  bl.push({ prio: 9, zeilen: f5Block(kz) });
  bl.push({ prio: 8, zeilen: f6Block(kz) });
  bl.push({ prio: 0, zeilen: ['## Gefechtsprofil', opt.svg ? '![Gefechtsprofil](' + opt.svg + ')' : '(kein Bild)'] });
  return begrenzen(bl, ZEILEN_MAX).join('\n') + '\n';
}

module.exports = { bericht, abweichungen, zielBewertung, auffaelligkeiten, ZEILEN_MAX, AUFFAELLIG_MAX, LEERLAUF_AUFFAELLIG_S, LEERLAUF_AUFFAELLIG_ANTEIL };
