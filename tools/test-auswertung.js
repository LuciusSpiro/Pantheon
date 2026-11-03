'use strict';
// TEL-01 D1: Test der Auswertung (tools/auswertung/*.js, tools/auswerten.js).
//   1. Handgebautes Mini-Protokoll mit von Hand ausgerechneten Werten (exakte Gleichheit): Quote je Waffe (Flaechenwaffe, Raum-Lanze ohne pid, Gegner),
//      Zeit bis Kill, Rollenzeiten mit Nachzuegler und Abgang, Leerlauf, Deckungszeit, Verlassen-bis-Treffer, Peek-and-Shoot, Buchungssummen, Tickspitzen.
//   2. Rotierte Session (zwei Teile) = gleiche Kennzahlen wie ungeteilt; abgeschnittene letzte Zeile wird gezaehlt, nicht abgebrochen; unbekannte Typen gezaehlt.
//   3. Echte Bot-Laeufe mit Telemetrie an (Graben zu dritt, Wellen, Kampagne zu dritt): Bericht <= 60 Zeilen, Auffaelligkeiten oben, Block je Frage, SVG gueltig,
//      Quoten <= 100 %, kein NaN/undefined/Infinity, keine Bot-Namen, keine clientId.
//   4. Basis-Abweichung (eine Quote x2 -> genau diese Kennzahl in den Auffaelligkeiten) und Ziele (leer: keine Ampel; Test-Ziel: Ampel).
//   5. Nacharbeit D1: Bewertung (bewertung.js: Reihenfolge, Kuerzen, b = 0, Verluste mit Basis, Leerlauf bei Bots), Marken (stand), Reihen, Spielerzahl, Zeilenlaenge 160,
//      SVG als XML (strenger Mini-Pruefer), Verlustmarken je Pixelspalte, lange Sessions (kein Spread).
//   node tools/test-auswertung.js   (npm run test:auswertung)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const Lesen = require('./auswertung/lesen.js');
const { kennzahlen, flach, infoZu, KENNZAHL_INFO } = require('./auswertung/kennzahlen.js');
const { bericht, auffaelligkeiten } = require('./auswertung/bericht.js');
const Bewertung = require('./auswertung/bewertung.js');
const Config = require('../shared/config.js');
const { profil } = require('./auswertung/profil.js');
const { auswerten } = require('./auswerten.js');
const { SCHEMA } = require('../server/telemetrie/schema.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const LIMIT = 60;   // Zeilendeckel laut Briefing; bewusst NICHT aus bericht.js gelesen, sonst würde die Mutationsprobe am Limit nichts bemerken
const gleich = (a, b, t) => ok(a === b, t + (a === b ? '' : ' (ist ' + JSON.stringify(a) + ', soll ' + JSON.stringify(b) + ')'));
const section = (t) => console.log('\n' + t);
// passt: Regex gegen den Berichtstext; bei Fehler steht der Bericht unter der Meldung (sonst raet man, welche Zeile abweicht)
const passt = (txt, re, t) => { const g = re.test(txt); ok(g, t); if (!g) console.log(txt.split('\n').map((l) => '      | ' + l).join('\n')); };
const maxZeile = (text) => text.split('\n').reduce((m, l) => Math.max(m, l.length), 0);

// K11: strenger Mini-Pruefer fuer wohlgeformtes XML (keine Abhaengigkeit). Ein Wurzelelement, Tags balanciert und richtig verschachtelt, Attribute in Anfuehrungszeichen und
// eindeutig, nur die fuenf Entities und Zeichenverweise (kein rohes & oder < in Text und Werten), keine Steuerzeichen, Kommentare ohne --. Rueckgabe null = wohlgeformt, sonst die Fehlermeldung.
function xmlPruefen(text) {
  const ENT = '&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);';
  const NAME = '[A-Za-z_][\\w.:-]*';
  const ZEICHEN = (q) => '[^' + q + '<&]*';   // entrollt (Zeichenfolge, dann Entity, dann Zeichenfolge ...): keine tiefe Rueckverfolgung bei Werten mit Megabytes (Polylinien)
  const wert = (q) => q + ZEICHEN(q) + '(?:' + ENT + ZEICHEN(q) + ')*' + q;
  const ATTR = '\\s+' + NAME + '\\s*=\\s*(?:' + wert('"') + '|' + wert("'") + ')';
  const START = new RegExp('<(' + NAME + ')((?:' + ATTR + ')*)\\s*(/?)>', 'y');
  const ENDE = new RegExp('</(' + NAME + ')\\s*>', 'y');
  const ATTRNAME = new RegExp('\\s(' + NAME + ')\\s*=', 'g');
  const ENTITY = new RegExp(ENT, 'y');
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) return 'Steuerzeichen im Text';
  let i = 0;
  const prolog = /^\uFEFF?<\?xml[^?]*\?>\s*/.exec(text);
  if (prolog) i = prolog[0].length;
  const stack = [];
  let wurzeln = 0;
  const f = (m) => m + ' (Position ' + i + ')';
  while (i < text.length) {
    if (text[i] !== '<') {
      const e = text.indexOf('<', i);
      const stueck = text.slice(i, e < 0 ? text.length : e);
      if (!stack.length) { if (stueck.trim()) return f('Text ausserhalb des Wurzelelements'); }
      else {
        if (stueck.includes(']]>')) return f(']]> im Text');
        for (let k = stueck.indexOf('&'); k >= 0; k = stueck.indexOf('&', k + 1)) { ENTITY.lastIndex = k; if (!ENTITY.test(stueck)) return f('rohes & oder unbekannte Entity im Text'); }
      }
      i = e < 0 ? text.length : e;
      continue;
    }
    if (text.startsWith('<!--', i)) {
      const e = text.indexOf('-->', i + 4);
      if (e < 0) return f('Kommentar nicht geschlossen');
      if (text.slice(i + 4, e).includes('--')) return f('-- im Kommentar');
      i = e + 3; continue;
    }
    if (text.startsWith('</', i)) {
      ENDE.lastIndex = i;
      const m = ENDE.exec(text);
      if (!m) return f('kaputtes Endtag');
      if (stack.pop() !== m[1]) return f('Endtag ' + m[1] + ' passt nicht zum offenen Tag');
      i += m[0].length; continue;
    }
    START.lastIndex = i;
    const m = START.exec(text);
    if (!m) return f('kaputtes Starttag (Attribut ohne Anfuehrungszeichen, rohes & oder <, kein >)');
    const namen = [...m[2].matchAll(ATTRNAME)].map((x) => x[1]);
    if (new Set(namen).size !== namen.length) return f('doppeltes Attribut in ' + m[1]);
    if (!stack.length && ++wurzeln > 1) return f('zweites Wurzelelement');
    if (!m[3]) stack.push(m[1]);
    i += m[0].length;
  }
  if (stack.length) return 'Tag nicht geschlossen: ' + stack[stack.length - 1];
  return wurzeln === 1 ? null : 'kein Wurzelelement';
}

// Kleines Protokoll (zwei Slots am Boden, ohne Deckungszeilen, Slot p1 ohne jede Eingabe) fuer Ausschnitte: Bot/Mensch, mit/ohne Ende, mit/ohne Kopf, Stand gesetzt
function klein(o) {
  o = o || {};
  const n = o.fenster || 40;
  const L = [];
  const Zk = (t, typ, f) => L.push(JSON.stringify(Object.assign({ v: o.v || 1, typ, sitzung: 'klein-1', tick: Math.round(t * 30), t }, f)));
  if (o.kopf !== false) Zk(0, 'kopf', { commit: 'abcdef012345', plattform: 'win32-x64', quelle: o.quelle || 'mensch', spielerzahl: 2, modus: 'graben', szenario: null, seed: 1, regielog: null, weltstand: null });
  if (o.stand) Zk(0, 'buchung', { konto: 'marks', art: 'stand', grund: 'testmarken', betrag: 4850, stand: 5000 });
  for (let k = 1; k <= n; k++) {
    Zk(2 * k, 'zeitreihe', { fenster: 2, tick_n: 60, tick_med: 0.1, tick_max: 0.5, tick_ueber5: 0, tick_ueber16: 0, tick_ueber33: 0, snap_n: 0, kappung_n: 0, kappung_ticks: 0, nachhol_ticks: 0, fehler_n: 0,
      szene: 'g', r_integ: [10, 10], r_schild: [4, 4, 4, 4], r_hitze: [0, 0, 0], r_energie: [2, 2, 2], r_gegner: 0,
      slots: ['p1', 'p3'], verbunden: [true, true], ort: ['boden', 'boden'], konsole: [null, null], station: [null, null], ein_bew: [0, 1], ein_akt: [0, 0], b_schild: [2, 2], b_gg: 0 });
  }
  if (o.ende !== false) Zk(2 * n, 'session_ende', { grund: 'test', dauer: 2 * n, zeilen: L.length + 1, fehler: 0, verworfen: 0, bytes: 1000 });
  return L.join('\n') + '\n';
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-auswertung-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });

// ===================== 1. Mini-Protokoll =====================
// 20 Zeitreihenfenster (je 2 s, t = 2 ... 40). p1: Fenster 1-12 im Schiff (captain), 13-20 am Boden. p2: Nachzuegler, steht ab Fenster 8 in slots,
// verbunden in 8-14 (weapons), ab Fenster 15 Abgang (verbunden false, die Station steht noch auf weapons: zaehlt NICHT).
const SID = 'mini-1';
const zeilen = [];
const Z = (t, typ, f) => zeilen.push(Object.assign({ v: 1, typ, sitzung: SID, tick: Math.round(t * 30), t }, f));
Z(0, 'kopf', { commit: 'abcdef0123456789', server_version: '0.2.0', plattform: 'win32-x64', node: 'v22', run_id: SID, seed: 1, modus: 'wellen_boden', szenario: 'kesh', graben: null, weltstand: null, regielog: 'mini.jsonl', quelle: 'mensch', spielerzahl: 0, slots: [{ slot: 'p1', belegung: 1, konsole: null, verbunden: true }], schiff: {}, schalter: {}, tuning_hash: 'x', tuning_teile: {} });
Z(0, 'szene_start', { modus: 'wellen_boden', szene: 'kesh', spielerzahl: 5, seed: 1, gegner: null, hex: null, klasse: null });
// Marken: zwei stand-Zeilen vor der ersten Buchung (Anfang = die LETZTE: 150), eine danach (laden, +30). Bolzen: Stand 100, danach nur Buchungen
Z(0, 'buchung', { konto: 'marks', art: 'stand', grund: 'anfang', betrag: 100, stand: 100 });
Z(0.5, 'buchung', { konto: 'marks', art: 'stand', grund: 'testmarken', betrag: 50, stand: 150 });
Z(0, 'buchung', { konto: 'bolzen', art: 'stand', grund: 'anfang', betrag: 100, stand: 100 });
Z(16, 'buchung', { konto: 'marks', art: 'stand', grund: 'laden', betrag: 30, stand: 150 });
Z(2, 'buchung', { konto: 'marks', art: 'unbekannt', grund: 'zukunft', betrag: 7, stand: 999 });   // unbekannte Art (spaeteres Schema): weder Buchung noch Stand, wird ignoriert
Z(1, 'buchung', { konto: 'marks', art: 'buchung', grund: 'erkundung', betrag: 20, stand: 170 });
Z(0, 'buchung', { konto: 'sonde', art: 'stand', grund: 'anfang', betrag: 10, stand: 10 });
Z(4, 'buchung', { konto: 'sonde', art: 'buchung', grund: 'abwurf', betrag: -1, stand: 9 });
Z(8, 'buchung', { konto: 'sonde', art: 'buchung', grund: 'abwurf', betrag: -1, stand: 5 });   // Kette bricht: 9 - 1 = 8, gelesen 5 = nicht protokollierter Sprung -3 (gesetzt)
Z(4, 'buchung', { konto: 'tafel', art: 'buchung', grund: 'mission', betrag: null, stand: 1 });   // kaputter Betrag in der ersten Buchung: anfang = ihr stand
Z(9, 'buchung', { konto: 'tafel', art: 'buchung', grund: 'sprengung', betrag: -1, stand: 0 });
Z(3, 'buchung', { konto: 'marks', art: 'buchung', grund: 'kauf', betrag: -50, stand: 120 });
Z(3, 'buchung', { konto: 'bolzen', art: 'buchung', grund: 'schuss', betrag: -5, stand: 95 });
Z(3.5, 'buchung', { konto: 'bolzen', art: 'buchung', grund: 'schuss', betrag: -3, stand: 92 });
Z(1, 'spieler_bei', { slot: 'p1', art: 'neu', belegung: 1, nachzuegler: true, spielerzahl: 1 });   // Beitritt beim Start: das Protokoll nennt ihn Nachzuegler, die Auswertung nicht (vor dem ersten Fenster bei t = 2)
Z(5, 'spieler_bei', { slot: 'p2', art: 'neu', belegung: 1, nachzuegler: true, spielerzahl: 2 });
Z(28, 'spieler_weg', { slot: 'p2', belegung: 1, spielerzahl: 1 });
// Zeitreihe: 20 Fenster
for (let k = 1; k <= 20; k++) {
  const t = 2 * k;
  const mitP2 = k >= 8;
  const p1Boden = k >= 13;
  const r = {
    fenster: 2, tick_n: 60, tick_med: k === 5 ? 6 : 0.1, tick_max: k === 5 ? 41.5 : k === 9 ? 36 : 0.5, tick_ueber5: k === 5 ? 1 : k === 9 ? 2 : 0, tick_ueber16: k === 5 || k === 9 ? 1 : 0, tick_ueber33: k === 5 || k === 9 ? 1 : 0, snap_n: 0, snap_med: null, snap_max: null,
    kappung_n: 0, kappung_ticks: 0, nachhol_ticks: 0, fehler_n: 0, fehler_wo: [], szene: 'kesh',
    r_zustand: '0', r_integ: k === 6 ? [10, 4] : [10, 10], r_reaktor: 'online', r_energie: [2, 2, 2], r_leistung: 6, r_verbrauch: 6, r_hitze: k === 4 ? [50, 0, 0] : [0, 0, 0], r_schild: k === 10 ? [1, 1, 1, 1] : [4, 4, 4, 4], r_gegner: k >= 3 && k <= 6 ? 2 : 0,
    slots: mitP2 ? ['p1', 'p2'] : ['p1'],
    verbunden: mitP2 ? [true, k <= 14] : [true],
    ort: mitP2 ? [p1Boden ? 'boden' : 'raum', 'raum'] : [p1Boden ? 'boden' : 'raum'],
    konsole: mitP2 ? [p1Boden ? null : 'captain', 'weapons'] : [p1Boden ? null : 'captain'],
    station: mitP2 ? ['captain', 'weapons'] : ['captain'],   // p1 draussen (ab Fenster 13) mit Konsolenrest: station bleibt captain, die Rolle ist trotzdem boden
    // p1: Eingaben nur in den Fenstern 1-2 und 19-20 -> Leerlauf Fenster 3-18 = 16 Fenster = 32 s (>= 30 s); p2 immer aktiv, ausser Fenster 8-14 komplett (14 s, keine Strecke)
    ein_bew: mitP2 ? [k <= 2 || k >= 19 ? 1 : 0, 0] : [k <= 2 ? 1 : 0],
    ein_akt: mitP2 ? [0, 0] : [0],
    b_schild: mitP2 ? [p1Boden ? 3 : null, null] : [p1Boden ? 3 : null], b_wunden: null, b_liegt: null, b_cv: null, b_geduckt: null, b_sp: null,
    b_gg: p1Boden && k <= 16 ? 4 : (p1Boden ? 0 : null), b_gg_duck: p1Boden && k <= 16 ? 1 : (p1Boden ? 0 : null), b_gg_abst_min: p1Boden && k <= 16 ? 2 : null, b_gg_abst_nn: p1Boden && k <= 16 ? 6 : null, b_gg_pos: null,
  };
  Z(t, 'zeitreihe', r);
}
Z(11, 'konsole', { slot: 'p1', konsole: 'captain', station: 'helm', rein: true, grund: 'tab' });
Z(12, 'konsole', { slot: 'p1', konsole: 'captain', station: 'captain', rein: true, grund: 'tab' });
Z(12.5, 'konsole', { slot: 'p1', konsole: 'captain', station: 'captain', rein: true, grund: 'betreten' });
// Schuesse und Treffer (Boden): blaster von p1: a1 (1 Treffer), a2 (kein), a3 (2 Treffer), a4 (kein) -> 4 Schuesse, 2 mit Treffer = 50 %, 3 Treffer = 0,75 je Schuss
const sch = (t, f) => Z(t, 'schuss', Object.assign({ ort: 'boden', waffe: 'blaster', von: 'p1', mount: null, pid: null, ziel: null, gegner: null, rolle: null, kraft: null, treffer: null, hitze: 0.2, von_deckung: false, geduckt: false }, f));
const tre = (t, f) => Z(t, 'treffer', Object.assign({ ort: 'boden', waffe: 'blaster', von: 'p1', ziel: 'gegner', gegner: 'w-1', rolle: 'grundtyp', pid: null, ergebnis: 'schild', schaden_roh: 2, schild: 2, schaden: 0, wunde: false, von_deckung: false, ziel_deckung: false, flaeche: false }, f));
sch(26.5, { pid: 'a1', von_deckung: true }); tre(26.7, { pid: 'a1', von_deckung: true });
sch(27, { pid: 'a2' });
sch(27.5, { pid: 'a3' }); tre(27.8, { pid: 'a3', gegner: 'w-1' }); tre(27.9, { pid: 'a3', gegner: 'w-2', schaden_roh: 3, schild: 1, schaden: 2, ergebnis: 'wunde' });
sch(28, { pid: 'a4', von_deckung: true });
// Flaechenwaffe: 1 Schuss, 3 Treffer -> Quote 100 %, Treffer je Schuss 3
sch(29, { waffe: 'granatwerfer', von: 'p2', pid: 'g1' });
for (const g of ['w-1', 'w-2', 'w-3']) tre(29.4, { waffe: 'granatwerfer', von: 'p2', pid: 'g1', gegner: g });
// Eigenbeschuss p1 -> p2 (weder Schaden aus noch ein, kein Treffer auf/von Spieler), Gegner -> Gegner (zaehlt nirgends)
tre(32.5, { von: 'p1', ziel: 'p2', gegner: null, rolle: null, ergebnis: 'wunde', schaden_roh: 2, schild: 0, schaden: 2, wunde: true });
tre(30.3, { von: 'p2', ziel: 'p1', gegner: null, rolle: null, ergebnis: 'wunde', schaden_roh: 2, schild: 0, schaden: 2, wunde: true });   // Eigenbeschuss VOR dem ersten Feindtreffer (30,6) in p1s Verlassen-Episode
tre(33.5, { waffe: 'granatwerfer', von: 'gegner', ziel: 'gegner', ergebnis: 'wunde', schaden_roh: 3, schild: 0, schaden: 3, wunde: true });
// Raum, Lerche -> Gegner: standardbatterie mit pid, 4 Schuesse: pr1 abgeprallt, pr2 Treffer (Schild 1), pr3 ausgewichen, pr4 daneben -> Quote 75 %, Wirkungsquote 25 %
const traum = (t, f) => Z(t, 'treffer', Object.assign({ ort: 'raum', waffe: 'standardbatterie', von: 'lerche', ziel: 'gegner', gegner: 'e1', rolle: 'raider', pid: null, ergebnis: 'treffer', schaden_roh: 2.66, schild: 0, schaden: 2.66 }, f));
for (const [k, t] of [[1, 8], [2, 8.5], [3, 9], [4, 9.5]]) Z(t, 'schuss', { ort: 'raum', waffe: 'standardbatterie', von: 'lerche', mount: 'bow', pid: 'pr' + k, ziel: 'gegner', gegner: 'e1', rolle: 'raider', kraft: 0.4, treffer: null });
traum(8.1, { pid: 'pr1', ergebnis: 'abgeprallt', schaden: 0 });
traum(8.6, { pid: 'pr2', schild: 1, schaden: 1 });
traum(9.1, { pid: 'pr3', ergebnis: 'ausgewichen', schaden: 0 });
traum(6.1, { waffe: 'lanze', schaden_roh: 12, schaden: 12 });   // Lanze: ohne pid, gehoert zu keinem Schuss, zaehlt aber im Schaden
// Raum, ->Lerche: Gegner (Schild 1 von 4), Raumtreffer auf einen Slot (Schild 1 von 1), Objekt (Brocken)
const tein = (t, f) => Z(t, 'treffer', Object.assign({ ort: 'raum', waffe: 'sperrfeuer', von: 'gegner', ziel: 'lerche', gegner: 'e1', rolle: 'raider', pid: null, ergebnis: 'treffer', schaden_roh: 4, schild: 1, schaden: 3 }, f));
tein(10, {});
tein(30.2, { ziel: 'p1', schaden_roh: 1, schild: 1, schaden: 0 });
tein(33, { waffe: 'brocken', von: 'objekt', gegner: null, rolle: null, schaden_roh: 5, schild: 0, schaden: 5 });
// Raum-Lanze ohne pid: Ergebnis steht im Schuss -> 2 Schuesse, 1 Treffer = 50 %
Z(6, 'schuss', { ort: 'raum', waffe: 'lanze', von: 'lerche', mount: 'bow', pid: null, ziel: 'gegner', gegner: 'e1', rolle: 'raider', kraft: 0.4, treffer: true });
Z(7, 'schuss', { ort: 'raum', waffe: 'lanze', von: 'lerche', mount: 'bow', pid: null, ziel: 'gegner', gegner: 'e1', rolle: 'raider', kraft: 0.4, treffer: false });
// Gegnerschuesse: 2 Schuesse, 1 Treffer
Z(30, 'schuss', { ort: 'boden', waffe: 'sturmgewehr', von: 'gegner', pid: 'e1', gegner: 'w-1', rolle: 'grundtyp', hitze: null, von_deckung: true, geduckt: false });
Z(30.5, 'schuss', { ort: 'boden', waffe: 'sturmgewehr', von: 'gegner', pid: 'e2', gegner: 'w-1', rolle: 'grundtyp', hitze: null, von_deckung: true, geduckt: false });
// Treffer auf p1: t=31 (ziel_deckung false), t=39 (ziel_deckung true)
Z(30.6, 'treffer', { ort: 'boden', waffe: 'sturmgewehr', von: 'gegner', ziel: 'p1', gegner: 'w-1', rolle: 'grundtyp', pid: 'e2', ergebnis: 'gefallen', schaden_roh: 2, schild: 0, schaden: 2, wunde: true, von_deckung: true, ziel_deckung: false, flaeche: false });
Z(39, 'treffer', { ort: 'boden', waffe: 'sturmgewehr', von: 'gegner', ziel: 'p1', gegner: 'w-1', rolle: 'grundtyp', pid: null, ergebnis: 'schild', schaden_roh: 1, schild: 1, schaden: 0, wunde: false, von_deckung: false, ziel_deckung: true, flaeche: false });
Z(30.6, 'gefallen', { slot: 'p1', waffe: 'sturmgewehr', von: 'gegner' });
Z(35, 'notrueckholung', { art: 'einzel', slot: 'p1', slots: null });
Z(36, 'notfall', { grund: 'test' });
Z(37, 'zone_aus', { system: 'engines', zone: 'heck', zustand: 'broken', vorher: 'ok' });
// Kills: grundtyp 10/20/60 s -> Median 20 (Mittel waere 30); zinne 5 s
const kill = (t, rolle, lebte, von) => Z(t, 'kill', { ort: 'boden', gegner: 'w-' + t, rolle, von: von || 'p1', waffe: 'blaster', lebte, nr: 1 });
kill(31, 'grundtyp', 10); kill(32, 'grundtyp', 20); kill(33, 'grundtyp', 60, 'p2'); kill(34, 'zinne', 5);
// Deckung p1 (Rohzustand): siehe Kopf der Auswertung; Zeiten wie im Kommentar der Erwartung unten
const dk = (t, f) => Z(t, 'deckung', Object.assign({ slot: 'p1', gegner: null, rolle: null, cv: 0, geduckt: false, verdeckt: false, flanke: false, stellung: false, x: 5, y: 5, ende: null }, f));
dk(26, { cv: 2 }); dk(30, {}); dk(32, { geduckt: true }); dk(34, { verdeckt: true }); dk(35.5, { cv: 1 }); dk(36.5, { verdeckt: true, x: 6 }); dk(37.5, { cv: 1 }); dk(40, { ende: 'session' });
// Peek: eigener Schuss zwischen 36.5 und 37.5
sch(37, { pid: 'a5' });
// p2 (Deckung am Boden): 20-21 in Deckung, bei 21 raus (verdeckt, gleiche Kachel = nur ein Gegnerwechsel), bei 22 wieder drin (1 s = Peek) OHNE eigenen Schuss, aber p1 schiesst bei 21,5;
// bei 24 raus (nicht verdeckt), bei 25 endet die Zeile mit ende ort (Ortswechsel: KEINE Rueckkehr, also kein Peek) mit eigenem Schuss bei 24,5
const dk2 = (t, f) => dk(t, Object.assign({ slot: 'p2' }, f));
dk2(20, { cv: 1 }); dk2(21, { verdeckt: true }); dk2(22, { cv: 1 }); dk2(24, {}); dk2(25, { ende: 'ort' });
sch(21.5, { waffe: 'sturmgewehr', pid: 'a6' });
sch(24.5, { waffe: 'sturmgewehr', von: 'p2', pid: 'a7' });
// Reparaturspiele
Z(20, 'reparatur', { slot: 'p1', system: 'engines', wie: 'minigame', dauer: 4, erfolg: true, notflicken: false });
Z(22, 'reparatur', { slot: 'p1', system: 'engines', wie: 'flick', dauer: 2, erfolg: false, notflicken: true });
Z(40, 'szene_ende', { modus: 'wellen_boden', szene: 'kesh', ausgang: 'unten', dauer: 40, dauer_gesamt: 40, spielerzahl: 1, welle: 2, geschafft: 1, debug: false, versuche: null, hex: null, verrat: null });
Z(40, 'session_ende', { grund: 'test', dauer: 40, zeilen: zeilen.length + 1, fehler: 0, verworfen: 0, bytes: 12345 });
zeilen.sort((a, b) => a.t - b.t);   // das Protokoll ist zeitlich geordnet (Stabilsortierung)
const TEXT = zeilen.map((z) => JSON.stringify(z)).join('\n') + '\n';

section('1. Mini-Protokoll: Kennzahlen von Hand gerechnet');
const P = Lesen.ausText(TEXT, { kennung: SID });
ok(P.zeilen.length === zeilen.length && P.kaputt === 0 && P.abgeschnitten === 0 && P.schemaOk, 'ausText liest alle ' + zeilen.length + ' Zeilen ohne Fehler');
const K = kennzahlen(P);
const F = flach(K);
const soll = (k, v) => gleich(F[k], v, k + ' = ' + v);
// F2: Quote, Treffer je Schuss
soll('f2.schuesse.boden.blaster', 5);          // a1..a5 (a5 ohne Treffer)
soll('f2.quote.boden.blaster', 40);            // a1 und a3 haben Treffer: 2 / 5
soll('f2.treffer_je_schuss.boden.blaster', 0.6);   // 3 Treffer / 5 Schuesse
soll('f2.quote.boden.granatwerfer', 100);      // 1 Schuss, 3 Treffer
soll('f2.treffer_je_schuss.boden.granatwerfer', 3);
soll('f2.quote.raum.lanze', 50);               // ohne pid: Ergebnis im Schuss
soll('f2.schuesse_gegner.boden.sturmgewehr', 2);
soll('f2.quote_gegner.boden.sturmgewehr', 50); // e2 trifft p1, e1 nicht
soll('f2.treffer_je_schuss_gegner.boden.sturmgewehr', 0.5);
// F2: Schaden aus/ein (Boden): aus = 5 Treffer von p1/p2 auf gegner (roh 2+2+3+2*... siehe Zeilen)
soll('f2.treffer_n.boden.aus', 6);             // a1, a3 x2, g1 x3
soll('f2.schaden.boden.aus.roh', 13);          // 2 + 2 + 3 + 3 * 2
soll('f2.schaden.boden.aus.schild', 11);       // 2 + 2 + 1 + 3 * 2
soll('f2.schaden.boden.aus.wirkt', 2);         // nur der wunde-Treffer
soll('f2.treffer_n.boden.ein', 2);
soll('f2.treffer_n.boden.eigen', 2);          // Eigenbeschuss p1 -> p2 und p2 -> p1: gezaehlt, aber kein Schaden aus/ein; Gegner -> Gegner zaehlt nirgends
ok(F['f2.schaden.boden.eigen.roh'] === undefined, 'Eigenbeschuss hat keinen Schaden-Eintrag');
soll('f2.schaden.boden.ein.roh', 3);
soll('f2.schaden.boden.ein.wirkt', 2);
// F2: Schaden je Ort (Nacharbeit S6): Raum aus = schaden - schild; Raum ein = Rest nach Schild; kein doppeltes Addieren
soll('f2.treffer_n.raum.aus', 4); soll('f2.schaden.raum.aus.roh', 19.98); soll('f2.schaden.raum.aus.schild', 1); soll('f2.schaden.raum.aus.wirkt', 12);   // wirkt: (1 - 1) + 12; ohne den Abzug waeren es 13
soll('f2.treffer_n.raum.ein', 3); soll('f2.schaden.raum.ein.roh', 10); soll('f2.schaden.raum.ein.schild', 2); soll('f2.schaden.raum.ein.wirkt', 8);   // Gegner (3) + Raumtreffer auf Slot (0) + Objekt (5)
// F2: Quote und Wirkungsquote
soll('f2.schuesse.raum.standardbatterie', 4); soll('f2.quote.raum.standardbatterie', 75); soll('f2.treffer_je_schuss.raum.standardbatterie', 0.75);
soll('f2.quote_wirkt.raum.standardbatterie', 25);   // nur pr2 wirkt (pr1 abgeprallt, pr3 ausgewichen, pr4 daneben)
soll('f2.quote_wirkt.boden.blaster', 40); soll('f2.quote_wirkt.boden.granatwerfer', 100); soll('f2.quote_wirkt.raum.lanze', 50);
soll('f2.schuesse.boden.sturmgewehr', 2); soll('f2.quote.boden.sturmgewehr', 0);
// F2: Kills und Zeit bis Kill
soll('f2.kills.boden.gesamt', 4);
soll('f2.kills.boden.grundtyp', 3);
soll('f2.zeit_bis_kill.boden.grundtyp', 20);   // Median von 10, 20, 30
soll('f2.zeit_bis_kill.boden.zinne', 5);
soll('f2.kills_von.p1', 3);
soll('f2.kills_von.p2', 1);
soll('f2.gefecht.raum', 8);                    // Fenster 3-6 mit r_gegner > 0
soll('f2.gefecht.boden', 8);                   // Fenster 13-16 mit b_gg > 0
// F2b: Deckung (cv > 0 / geduckt / verdeckt getrennt)
soll('f2b.deckung.p1.cv_s', 7.5);              // 26-30 (4) + 35,5-36,5 (1) + 37,5-40 (2,5)
soll('f2b.deckung.p1.geduckt_s', 2);           // 32-34
soll('f2b.deckung.p1.verdeckt_s', 2.5);        // 34-35,5 und 36,5-37,5
soll('f2b.deckung.p2.cv_s', 3);                // 20-21 und 22-24
soll('f2b.deckung.p2.verdeckt_s', 1);          // 21-22
soll('f2b.deckung.p1.cv_anteil', 46.88);       // 7,5 s / 16 s am Boden
soll('f2b.verlassen.n', 4);                    // p1 bei 30 und 36,5; p2 bei 21 und 24 (die zweite endet mit ende ort)
soll('f2b.verlassen.bewegt_n', 3);             // p1@30 (nicht verdeckt), p1@36,5 (Kachelwechsel), p2@24 (nicht verdeckt); NICHT p2@21 (verdeckt, gleiche Kachel = nur ein Gegnerwechsel)
soll('f2b.verlassen.mit_treffer', 1);          // Treffer bei 30,6 vor der Rueckkehr (35,5); der Treffer bei 39 liegt nach der Rueckkehr
soll('f2b.verlassen.bis_treffer_median', 0.6);
soll('f2b.peek.episoden', 2);                  // p1 36,5 -> 37,5 und p2 21 -> 22 (je 1 s < 3 s); p2@24 endet mit ende, keine Rueckkehr
soll('f2b.peek.mit_schuss', 1);                // nur p1 mit eigenem Schuss a5 bei 37; p2 hat bei 21,5 nur den Schuss von p1 in seiner Episode
soll('f2b.treffer_auf_spieler.n', 2);
soll('f2b.treffer_auf_spieler.in_deckung_anteil', 50);
soll('f2b.treffer_von_spieler.n', 6);
soll('f2b.treffer_von_spieler.aus_deckung_anteil', 16.67);   // 1 von 6 (a1)
soll('f2b.schuesse_spieler.aus_deckung_anteil', 25);         // a1, a4 aus Deckung von 8 Schuessen am Boden (a1..a5, g1, a6, a7)
soll('f2b.schuesse_gegner.aus_deckung_anteil', 100);
soll('f2b.gegner_abstand.nn_mittel', 6);
soll('f2b.gegner_abstand.min', 2);
soll('f2b.gegner_geduckt_anteil', 25);
// F3
soll('f3.gefallen.n', 1); soll('f3.gefallen.p1', 1); soll('f3.notrueckholung.einzel', 1); soll('f3.notfall.n', 1); soll('f3.zone_aus.n', 1); soll('f3.zone_aus.kaputt', 1);
soll('f3.erster_verlust_s', 30.6);
// F4: Rollenzeiten mit Nachzuegler und Abgang
soll('f4.dabei.p1', 40);
soll('f4.rolle.p1.captain', 24);               // Fenster 1-12
soll('f4.rolle.p1.boden', 16);                 // Fenster 13-20
soll('f4.dabei.p2', 14);                       // Fenster 8-14 verbunden; ab 15 Abgang (station steht noch auf weapons, zaehlt nicht)
soll('f4.rolle.p2.weapons', 14);
ok(F['f4.rolle.p2.ohne'] === undefined && F['f4.rolle.p2.boden'] === undefined, 'p2: keine anderen Rollen');
soll('f4.leerlauf.p1.dauer', 32);              // Fenster 3-18
soll('f4.leerlauf.p1.episoden', 1);
soll('f4.leerlauf.p1.anteil', 80);
soll('f4.leerlauf.p2.dauer', 0);               // 14 s ohne Eingabe: unter 30 s, keine Strecke
soll('f4.wechsel.p1', 2);                      // zwei Tabwechsel (betreten zaehlt nicht)
soll('f4.reparatur.n', 2); soll('f4.reparatur.erfolg_anteil', 50); soll('f4.reparatur.dauer_mittel', 3); soll('f4.reparatur.notflicken', 1);
ok(K.listen.rollen.p2.nachzuegler === true && K.listen.rollen.p2.abgang === 28 && K.listen.rollen.p1.nachzuegler === false, 'Rollenliste: p2 Nachzügler, Abgang bei 28 s, p1 nicht');
// F1
soll('f1.dauer.session', 40); soll('f1.dauer.wellen_boden.summe', 40); soll('f1.dauer.wellen_boden.n', 1); soll('f1.ausgang.unten', 1);
soll('f1.spieler.start', 1); soll('f1.spieler.max', 2); soll('f1.spieler.beitritte', 2); soll('f1.spieler.nachzuegler', 1); soll('f1.spieler.abgaenge', 1);
// Vertrag Spielerzahl/Nachzuegler (Kopf von kennzahlen.js): bereinigt aus dem ersten Fenster, Rohwert daneben; Beitritt VOR dem ersten Fenster ist kein Nachzuegler
gleich(K.kopf.spielerzahl, 1, 'kopf.spielerzahl bereinigt = f1.spieler.start'); gleich(K.kopf.spielerzahl_kopf, 0, 'kopf.spielerzahl_kopf = Rohwert aus dem Sessionkopf');
gleich(K.listen.szenen[0].spielerzahl, 1, 'Spielerzahl der Szene aus dem ersten Fenster der Szene (nicht szene_start = 5)'); gleich(K.listen.szenen[0].spielerzahl_start, 5, 'Rohwert aus szene_start steht daneben');
gleich(K.listen.szenen[0].nachzuegler, 1, 'Szene: ein Nachzuegler (p2 bei 5 s, nach dem ersten Fenster der Szene)');
// F5: Buchungen (nur art buchung), Anfangsstand aus der ersten Buchung
soll('f5.buchung.marks.erkundung', 20); soll('f5.buchung.marks.kauf', -50); soll('f5.buchung.bolzen.schuss', -8);
soll('f5.konto.marks.anfang', 150); soll('f5.konto.marks.ende', 150); soll('f5.konto.marks.netto', -30); soll('f5.konto.marks.gesetzt', 30);
// Marken-Stand (Nacharbeit S2): Anfang = Stand nach der LETZTEN stand-Zeile vor der ersten Buchung; stand-Zeilen stehen in f5.stand, nie in den Buchungssummen
soll('f5.stand.marks.anfang', 100); soll('f5.stand.marks.testmarken', 150); soll('f5.stand.marks.laden', 150);
ok(F['f5.buchung.marks.zukunft'] === undefined && F['f5.buchung.marks.anfang'] === undefined && F['f5.buchung.marks.testmarken'] === undefined && F['f5.buchung.marks.laden'] === undefined, 'stand-Zeilen stehen nicht in den Buchungssummen');
soll('f5.konto.bolzen.anfang', 100); soll('f5.konto.bolzen.ende', 92); soll('f5.konto.bolzen.netto', -8);
soll('f5.konto.sonde.anfang', 10); soll('f5.konto.sonde.netto', -2); soll('f5.konto.sonde.gesetzt', -3); soll('f5.konto.sonde.ende', 5);   // Kette bricht: der nicht protokollierte Sprung steht in gesetzt
soll('f5.konto.tafel.anfang', 1); soll('f5.konto.tafel.netto', -1); soll('f5.konto.tafel.ende', 0); ok(F['f5.konto.tafel.gesetzt'] === undefined, 'kaputter Betrag in der ersten Buchung: anfang = ihr stand, nichts gesetzt');
ok(Object.keys(K.f5.konto).every((k) => { const c = K.f5.konto[k]; return c.anfang + c.netto + (c.gesetzt || 0) === c.ende; }), 'jedes Konto: anfang + netto + gesetzt = ende');
soll('f5.energie.engines_anteil', 33.33);
// F6: Tickspitzen
soll('f6.tick.med', 0.1); soll('f6.tick.max', 41.5); soll('f6.tick.ueber33', 2); soll('f6.tick.ueber16', 2); soll('f6.tick.ueber5', 3); soll('f6.tick.n', 1200);   // zwei Fenster mit Spitzen (Summe, nicht Maximum), ein Ausreisser im Median
soll('f6.protokoll.mb_je_h', Math.round(12345 * 3600 / 40 / 1048576 * 100) / 100);
// Info-Tabelle: jede Kennzahl des Laufs hat ein Muster mit Einheit, Frage, Richtung
const ohneInfo = Object.keys(F).filter((k) => !infoZu(k));
ok(ohneInfo.length === 0, 'jede Kennzahl hat einen KENNZAHL_INFO-Eintrag' + (ohneInfo.length ? ' (fehlt: ' + ohneInfo.slice(0, 5).join(', ') + ')' : ''));
ok(Object.values(KENNZAHL_INFO).every((i) => ['besser', 'schlechter', 'neutral'].includes(i.richtung) && i.einheit && i.frage && i.text), 'KENNZAHL_INFO: Einheit, Frage, Richtung, Text');
ok(Object.keys(F).every((k) => Number.isFinite(F[k])) && JSON.stringify(K).indexOf('NaN') < 0, 'alle Kennzahlen sind endliche Zahlen');
const K2 = kennzahlen(P);
ok(JSON.stringify(K) === JSON.stringify(K2), 'kennzahlen ist rein: zweimal gerechnet = gleich');
// Reihen EINMAL in kennzahlen.js (mit Raumfilter), Integritaet daraus (Nacharbeit S3)
{
  const RE = K.listen.reihen;
  gleich(RE.raum.t.length, 20, 'Reihen Raum: 20 Fenster');
  ok(RE.raum.integ[0] === 20 && RE.raum.integ[5] === 14, 'Reihe Integritaet: Summe r_integ (20, im Fenster 6: 10 + 4 = 14)');
  ok(RE.raum.schild[0] === 16 && RE.raum.schild[9] === 4, 'Reihe Schild: Summe r_schild (16, im Fenster 10: 4)');
  gleich(RE.raum.hitze[3], 50, 'Reihe Hitze: groesste r_hitze (Fenster 4: 50)');
  gleich(RE.hitzegrenze, Config.power.heatLimit, 'Hitzegrenze = shared/config.js power.heatLimit');
  ok(RE.boden.t.length === 8 && RE.boden.mittel[0] === 3 && RE.boden.min[0] === 3, 'Reihe Boden: 8 Fenster, Bodenschild Mittel/Minimum');
  soll('f3.integritaet.min', 70);   // 14 / 20
  ok(F['f3.huelle.min'] === undefined && /Systemintegrität/.test(infoZu('f3.integritaet.min').text) && /keinen Hüllenwert/.test(infoZu('f3.integritaet.min').text), 'f3.huelle heisst f3.integritaet.min und nennt den Ersatz fuer die Huelle');
  ok(profil({ zeilen: [] }, K) === profil(P, K), 'profil zeichnet nur aus kz.listen.reihen (das Protokoll wird nicht mehr gelesen)');
}
// Einheiten und Beschreibungen (Nacharbeit S6, S7)
{
  const e = (k) => infoZu(k);
  ok(e('f5.buchung.marks.kauf').einheit === 'marken' && e('f5.konto.marks.netto').einheit === 'marken' && e('f5.stand.marks.anfang').einheit === 'marken', 'Marken nur fuer marks: marken');
  ok(e('f5.buchung.bolzen.schuss').einheit === 'stück' && e('f5.konto.bolzen.ende').einheit === 'stück' && e('f5.buchung.bolzen.schuss').min === 2 && e('f5.konto.bolzen.netto').min === 2, 'uebrige Konten in Stueck, Mindestmenge 2');
  ok(e('f6.protokoll.mb_je_h').einheit === 'mb/h' && /MB/.test(e('f6.protokoll.mb_je_h').text), 'mb_je_h in MB');
  ok(/schaden - schild/.test(e('f2.schaden.raum.aus.wirkt').text) && /Rest nach Schild/.test(e('f2.schaden.raum.ein.wirkt').text) && /Segmente/.test(e('f2.schaden.boden.aus.schild').text), 'Info-Text je Ort: Raum aus = schaden - schild, Raum ein = Rest nach Schild, Boden Segmente');
  ok(['raum.aus', 'raum.ein', 'boden.aus'].every((q) => /nicht addieren/.test(e('f2.schaden.' + q + '.roh').text)), 'Info-Text je Ort warnt vor doppeltem Addieren');
  ok(/SICHTBAREN/.test(e('f2b.deckung.p1.cv_s').text) && /Kachelwechsel/.test(e('f2b.verlassen.bewegt_n').text), 'Deutung von cv (gefaehrlichster sichtbarer Gegner) und bewegt_n stehen in KENNZAHL_INFO');
  ok(/Bots erzeugen keine Eingaben/.test(e('f4.leerlauf.p1.dauer').text), 'Leerlauf: Hinweis zu Bots in KENNZAHL_INFO');
}

section('2. Rotierte Session, abgeschnittene Zeile, unbekannter Typ');
{
  const dir = path.join(TMP, 'rot');
  fs.mkdirSync(dir);
  const teile = TEXT.split('\n').filter(Boolean);
  const k = Math.floor(teile.length / 2);
  fs.writeFileSync(path.join(dir, SID + '.jsonl'), teile.slice(0, k).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, SID + '.2.jsonl'), teile.slice(k).join('\n') + '\n');
  const R = Lesen.lesen(SID, { dirs: [dir] });
  gleich(R.dateien.length, 2, 'Kennung findet beide Teile');
  ok(JSON.stringify(kennzahlen(R)) === JSON.stringify(K), 'zwei Teile = gleiche Kennzahlen wie ungeteilt');
  const R2 = Lesen.lesen(path.join(dir, SID + '.2.jsonl'));
  gleich(R2.dateien.length, 2, 'eine Teildatei als Eingabe liest die ganze Session');
  // abgeschnittene letzte Zeile (Prozess hart beendet) und eine kaputte Zeile mitten drin, dazu ein unbekannter Typ
  const kaputt = path.join(dir, 'k');
  fs.mkdirSync(kaputt);
  fs.writeFileSync(path.join(kaputt, SID + '.jsonl'), teile.slice(0, 20).join('\n') + '\n{"v":1,"typ":"zukunft","t":1}\nnicht json\n' + teile.slice(20, 30).join('\n') + '\n{"v":1,"typ":"treff');
  const R3 = Lesen.lesen(SID, { dirs: [kaputt] });
  gleich(R3.abgeschnitten, 1, 'abgeschnittene letzte Zeile gezählt');
  gleich(R3.kaputt, 1, 'kaputte Zeile mitten in der Datei gezählt');
  gleich(R3.unbekannt.zukunft, 1, 'unbekannter Typ gezählt, nicht abgebrochen');
  const K3 = kennzahlen(R3);
  gleich(K3.f6.daten.abgeschnitten, 1, 'Kennzahl f6.daten.abgeschnitten = 1');
  const B3 = bericht(K3, { svg: 'x.svg' });
  ok(/abgeschnittene Zeile/.test(B3) && /unbekannten Typs/.test(B3), 'Bericht nennt abgeschnittene und unbekannte Zeilen in den Auffälligkeiten');
  const fremd = Lesen.ausText(TEXT.replace(/"v":1/g, '"v":2'));
  ok(fremd.schemaOk === false && fremd.warnungen.some((w) => /Schema-Version/.test(w)), 'fremde Schema-Version wird gemeldet');
  let wirft = false;
  try { Lesen.lesen('gibt-es-nicht', { dirs: [dir] }); } catch (e) { wirft = /nicht gefunden/.test(e.message); }
  ok(wirft, 'unbekannte Session: klare Fehlermeldung');
  ok(Lesen.letzteKennung([dir]) === SID, 'letzteKennung findet die Session (Teile zählen als eine)');
  // D2-Nacharbeit: Kennung = Spielkennung + Prozess (run-<zeit>-<n>-<pid36>): Suche nach Kennung, Datei, --letzte (letzteKennung) und Ordner finden sie
  {
    const neuKennung = 'run-1793000000000-1-k2f';
    const dn = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-kennung-'));
    fs.writeFileSync(path.join(dn, neuKennung + '.jsonl'), TEXT.split(SID).join(neuKennung));
    const P = Lesen.lesen(neuKennung, { dirs: [dn] });
    ok(P.kennung === neuKennung && P.dateien.length === 1 && P.zeilen.length > 3, 'Kennung mit Prozessanteil: Suche nach Kennung findet die Datei');
    ok(Lesen.lesen(path.join(dn, neuKennung + '.jsonl')).kennung === neuKennung && Lesen.kennungVon(neuKennung + '.jsonl') === neuKennung && Lesen.kennungVon(neuKennung + '.2.jsonl') === neuKennung, 'kennungVon: Teilnummer .2 ist nicht Teil der Kennung, der Prozessanteil schon');
    ok(Lesen.letzteKennung([dn]) === neuKennung, 'letzteKennung (--letzte) liefert die volle Kennung samt Prozessanteil');
    ok(JSON.stringify(Lesen.ordnerSessions(dn).map((e) => e.kennung)) === JSON.stringify([neuKennung]), 'ordnerSessions: eine Session mit voller Kennung');
    fs.rmSync(dn, { recursive: true, force: true });
  }
}

section('Bericht und Bild des Mini-Protokolls');
{
  const txt = bericht(K, { svg: 'mini-1.svg' });
  const zl = txt.split('\n').length - 1;
  ok(zl <= LIMIT, 'Bericht hat ' + zl + ' Zeilen (<= ' + LIMIT + ')');
  ok(txt.indexOf('## Auffälligkeiten') > 0 && txt.indexOf('## Auffälligkeiten') < txt.indexOf('## F1'), 'Auffälligkeiten stehen vor den Fragenblöcken');
  ok(/keine Basis angegeben/.test(txt), 'ohne Basis steht: keine Basis angegeben');
  ok(!/Leerlauf \(>= 30 s/.test(txt), 'Leerlauf von p1 (32 s, 80 %) liegt unter der Auffälligkeits-Schwelle von 60 s: nicht in den Auffälligkeiten');
  {
    const k2 = JSON.parse(JSON.stringify(K));
    k2.f4.leerlauf.p1 = { dauer: 100, episoden: 3, anteil: 50 };
    k2.f4.leerlauf.p2 = { dauer: 100, episoden: 3, anteil: 10 };   // viel Zeit, aber unter 20 %
    const ll = bericht(k2, { svg: 'x.svg' }).split('\n').find((l) => /Leerlauf \(>= 30 s/.test(l));
    ok(!!ll && /p1 100 s \(50 %\)/.test(ll) && !/p2/.test(ll), 'Leerlauf über Schwelle (>= 60 s und >= 20 %): p1 steht in den Auffälligkeiten, p2 (10 %) nicht');
  }
  ok(/Verluste: 1 gefallen, 1 Notrückholung/.test(txt), 'Verluste stehen in den Auffälligkeiten');
  ok(/!\[Gefechtsprofil\]\(mini-1\.svg\)/.test(txt), 'Bild ist relativ eingebunden');
  ok(/p2: dabei 14 s .*Nachzügler ab .*Abgang bei 28 s/.test(txt), 'Rollenzeile von p2 nennt Nachzügler und Abgang');
  ok(!/\b(Ada|Bo|Cem)\b/.test(txt), 'nur Slots im Bericht');
  ok(maxZeile(txt) <= 160, 'keine Berichtszeile ueber 160 Zeichen (laengste ' + maxZeile(txt) + ')');
  passt(txt.replace(/\n\s+/g, ' '), /Marken: Stand gesetzt \(anfang auf 100, laden auf 150, testmarken auf 150\) · Buchungen: erkundung \+20, kauf -50 Anfang 150 → Ende 150 \(netto -30, gesetzt \+30\)/, 'Marken: Stand gesetzt, Buchungen und Bilanz getrennt');
  ok(/Quote raum[^\n]*standardbatterie 75 % \(wirkt 25 %\) \(4 Sch\., 0,75 Tr\/Sch\)/.test(txt), 'Quote und Wirkungsquote stehen im Bericht, wenn sie verschieden sind');
  ok(!/blaster 40 % \(wirkt/.test(txt) && !/lanze 50 % \(wirkt/.test(txt), 'gleiche Wirkungsquote wird nicht wiederholt');
  ok(/Schaden raum[^\n]*aus roh 20 · Schildverlust 1 · darüber hinaus 12 \/ ein roh 10 · Schildverlust 2 · darüber hinaus 8/.test(txt) && /Schaden boden[^\n]*Schildsegmente 11 · Körper 2/.test(txt), 'Schadenszeilen je Ort mit getrennten Posten');
  ok(/Deckung verlassen: 4× \(davon bewegt 3\)/.test(txt), 'bewegte Episoden stehen im Bericht');
  ok(/Systemintegrität min 70 %/.test(txt) && !/Hülle \(Systemintegrität\)/.test(txt), 'F3: Systemintegrität statt Hülle');
  ok(/\(1 Sp\.\)/.test(txt) && /Spieler 1 \(Start\) \/ 2 \(max\)/.test(txt), 'Kopf: bereinigte Spielerzahl, Szene mit Spielerzahl');
  const svg = profil(P, K);
  ok(xmlPruefen(svg) === null, 'SVG des Mini-Protokolls ist wohlgeformtes XML (' + xmlPruefen(svg) + ')');
  ok(/^<svg /.test(svg) && /<\/svg>\s*$/.test(svg) && /<polyline/.test(svg) && /stroke-dasharray/.test(svg) && /<polygon/.test(svg), 'SVG: Linien, Szenengrenze, Verlustmarken');
  ok(/Hülle/.test(svg) && /Hitze/.test(svg) && /Bodenschild/.test(svg) && /Spielzeit/.test(svg), 'SVG: Legende und Achsenbeschriftung (Raum und Boden)');
}

// ===================== 3. Echte Bot-Läufe =====================
section('3. Echte Bot-Läufe mit Telemetrie');
const BOT_NAME = /\b(Ada|Bo|Cem)\b/;
const BOT_ID = /sim-\d+/;
const laeufe = [
  ['graben', ['graben', '--players', '3', '--seed', '1', '--max', '200']],
  ['wellen', ['wellen', '--karte', 'kesh', '--players', '3', '--seeds', '1', '--max', '120']],
  ['kampagne', ['3', '--seed', '7']],
];
const ergebnisse = {};
// AUSWERTUNG_SCHNELL=1 (Mutationsprobe): ohne die Bot-Läufe, nur Mini-Protokoll, Basis und Ziele
const SCHNELL = !!process.env.AUSWERTUNG_SCHNELL;
for (const [name, args] of SCHNELL ? [] : laeufe) {
  const dir = path.join(TMP, 'lauf-' + name);
  const r = spawnSync(process.execPath, [path.join('tools', 'sim-headless.js'), ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 480000, env: Object.assign({}, process.env, { TELEMETRIE: 'an', TELEMETRIE_DIR: dir }) });
  ok(r.status === 0, name + ': Bot-Lauf endet mit Exit 0' + (r.status === 0 ? '' : ' (' + r.status + ': ' + ((r.stdout || '') + (r.stderr || '')).slice(-200).replace(/\s+/g, ' ') + ')'));
  const datei = fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl')) : [];
  ok(datei.length >= 1, name + ': Protokoll da');
  if (!datei.length) continue;
  const aus = path.join(TMP, 'bericht-' + name);
  const A = auswerten(path.join(dir, datei[0]), { aus });
  ergebnisse[name] = A;
  const zl = A.text.split('\n').length - 1;
  ok(zl <= LIMIT && zl > 10, name + ': Bericht hat ' + zl + ' Zeilen (<= ' + LIMIT + ')');
  ok(fs.existsSync(A.md) && fs.existsSync(A.svg) && /!\[Gefechtsprofil\]\(.*\.svg\)/.test(fs.readFileSync(A.md, 'utf8')), name + ': .md und .svg geschrieben, Bild eingebunden');
  const kopfPos = A.text.indexOf('## Auffälligkeiten');
  ok(kopfPos > 0 && kopfPos < A.text.indexOf('## F1'), name + ': Auffälligkeiten stehen oben');
  const hat = (b) => A.text.indexOf('## ' + b) > 0;
  const k = A.kz;
  ok(hat('F1') && hat('F2') && hat('F2b') && hat('F3') && hat('F4') && hat('F5') && hat('F6') && hat('Gefechtsprofil'), name + ': ein Block je Frage');
  ok(!/NaN|undefined|Infinity|\[object/.test(A.text + A.svgText + JSON.stringify(k)), name + ': kein NaN/undefined/Infinity in Bericht, Bild und Kennzahlen');
  const quoten = Object.entries(flach(k)).filter(([key]) => /^f2\.quote/.test(key));
  ok(quoten.length > 0 && quoten.every(([, v]) => v >= 0 && v <= 100), name + ': ' + quoten.length + ' Quoten, alle zwischen 0 und 100 %');
  ok(!BOT_NAME.test(A.text + A.svgText) && !BOT_ID.test(A.text + A.svgText + JSON.stringify(k)), name + ': keine Bot-Namen, keine clientId in Bericht, Bild, Kennzahlen');
  ok(/<polyline/.test(A.svgText) && (A.svgText.match(/<polyline/g) || []).length >= 2, name + ': SVG enthält Linien');
  // SVG parst als XML (einfacher Wohlgeformtheits-Check ohne Abhängigkeit: Tags gleichmäßig geöffnet/geschlossen)
  const xmlFehler = xmlPruefen(A.svgText);
  ok(xmlFehler === null, name + ': SVG ist wohlgeformtes XML (strenger Pruefer: ' + xmlFehler + ')');
  ok(maxZeile(A.text) <= 160, name + ': keine Berichtszeile ueber 160 Zeichen (laengste ' + maxZeile(A.text) + ')');
  ok(Object.keys(k.f5.konto || {}).every((q) => { const c = k.f5.konto[q]; return c.anfang + c.netto + (c.gesetzt || 0) === c.ende; }), name + ': jedes Konto: anfang + netto + gesetzt = ende');
  gleich(k.f6.daten.ohne_ende, 0, name + ': Session sauber beendet');
  ok(k.kopf.spielerzahl === 3 && k.f1.spieler.start === 3 && k.f1.spieler.nachzuegler === 0, name + ': Spielerzahl 3 (bereinigt), Nachzuegler 0 (Rohwert im Kopf: ' + k.kopf.spielerzahl_kopf + ')');
  ok(k.listen.szenen.every((x) => x.spielerzahl === 3 || x.spielerzahl == null), name + ': Spielerzahl je Szene 3');
  ok(Object.keys(flach(k)).every((key) => infoZu(key)), name + ': jede Kennzahl hat einen Info-Eintrag');
  ok(k.f6.fehler.schreiben === 0 && k.f6.daten.abgeschnitten === 0 && k.f6.daten.unbekannte_typen === 0, name + ': keine Schreibfehler, nichts abgeschnitten, keine unbekannten Typen');
}
if (!SCHNELL) {
  const k = ergebnisse.graben && ergebnisse.graben.kz;
  ok(k && k.f4.rolle && Object.keys(k.f4.rolle).length === 3, 'Graben zu dritt: Rollenzeiten für drei Slots (Abnahme 10)');
  ok(k && Object.keys(k.f4.rolle).every((s) => Object.values(k.f4.rolle[s]).reduce((a, b) => a + b, 0) > 0), 'Graben zu dritt: jeder Slot hat eigene Zeiten');
  ok(k && Object.keys(k.f2b).length > 0, 'Graben: Kennzahlen zu Deckung/Gegnern vorhanden');
  const w = ergebnisse.wellen && ergebnisse.wellen.kz, c = ergebnisse.kampagne && ergebnisse.kampagne.kz;
  ok(w && Object.keys(w.f2.quote || {}).length > 0, 'Wellen: Trefferquote je Waffe');
  ok(c && Object.keys(c.f4.rolle || {}).length === 3 && c.f4.rolle.p1 && Object.keys(c.f4.rolle.p1).some((r) => r !== 'boden' && r !== 'ohne'), 'Kampagne zu dritt: Rollen je Slot (Stationen)');
  ok(c && c.f2.quote.raum && Object.keys(c.f2.quote.raum).length > 0, 'Kampagne: Raum-Quote je Waffe');
}

// ===================== 4. Basis und Ziele =====================
section('4. Basis-Abweichung und Ziele');
{
  const miniDatei = path.join(TMP, SID + '.jsonl');
  fs.writeFileSync(miniDatei, TEXT);
  const A = { kz: K, protokoll: { dateien: [miniDatei] } };
  {
    const kz = A.kz;
    const basis = JSON.parse(JSON.stringify(kz));
    // gleiche Basis -> keine Abweichung
    const t0 = bericht(kz, { basis, svg: 'x.svg' });
    ok(/0 wesentlich anders/.test(t0), 'Basis = Lauf: 0 Abweichungen');
    ok(!/keine Basis angegeben/.test(t0), 'mit Basis steht nicht "keine Basis angegeben"');
    // eine Quote verdoppeln (Basis halbieren): genau diese Kennzahl in den Auffälligkeiten
    const schluessel = 'f2.quote.boden.blaster';
    const alt = basis.f2.quote.boden.blaster;
    basis.f2.quote.boden.blaster = alt / 2;
    const t1 = bericht(kz, { basis, svg: 'x.svg' });
    const aufl = t1.split('## Auffälligkeiten')[1].split('\n## ')[0];
    ok(aufl.includes(schluessel), 'Basis mit halber Quote: ' + schluessel + ' steht in den Auffälligkeiten');
    ok(/1 wesentlich anders/.test(aufl), 'genau eine Kennzahl weicht ab');
    ok((aufl.match(/f\d+b?\.[a-z_]+\./g) || []).length === 1, 'nur diese Kennzahl wird genannt');
    // kleine Abweichung (unter der Schwelle) und kleine Menge fallen nicht auf
    const basis2 = JSON.parse(JSON.stringify(kz));
    basis2.f2.quote.boden.blaster = alt * 0.9;
    ok(/0 wesentlich anders/.test(bericht(kz, { basis: basis2, svg: 'x.svg' })), '10 % Abweichung fällt nicht auf');
    const basis3 = JSON.parse(JSON.stringify(kz));
    basis3.f3.gefallen.n = (kz.f3.gefallen.n || 0) + 1;   // 1 Ereignis Unterschied: unter der Mindestmenge
    ok(/0 wesentlich anders/.test(bericht(kz, { basis: basis3, svg: 'x.svg' })), 'ein Ereignis mehr/weniger fällt nicht auf (Mindestmenge)');
    // große Werte mit kleiner relativer Abweichung (9 %): Mindestmenge erfüllt, relative Schwelle nicht
    const gk = JSON.parse(JSON.stringify(kz)), gb = JSON.parse(JSON.stringify(kz));
    gk.f1.dauer.session = 1000; gb.f1.dauer.session = 1100;
    ok(/0 wesentlich anders/.test(bericht(gk, { basis: gb, svg: 'x.svg' })), 'große Zahl, nur 9 % Abweichung: fällt nicht auf (relative Schwelle)');
    gb.f1.dauer.session = 2000;
    ok(/1 wesentlich anders/.test(bericht(gk, { basis: gb, svg: 'x.svg' })), 'große Zahl, 50 % Abweichung: fällt auf');
    // Ziele
    const t2 = bericht(kz, { svg: 'x.svg', ziele: { version: 1, ziele: {} } });
    ok(!/\[(rot|grün|grau)\]/.test(t2) && !/## Ziele/.test(t2), 'leere Zieldatei: keine Ampel');
    const t3 = bericht(kz, { svg: 'x.svg', ziele: { version: 1, ziele: { 'f2.quote.boden.blaster': { min: 99 }, 'f2.kills.boden.gesamt': { min: 1 } } } });
    ok(/\[rot\] f2\.quote\.boden\.blaster/.test(t3) && /\[grün\] f2\.kills\.boden\.gesamt/.test(t3), 'Ziele: rote und grüne Ampel an der Kennzahl');
    ok(/Ziel verfehlt: f2\.quote\.boden\.blaster/.test(t3.split('## F1')[0]), 'verfehltes Ziel steht in den Auffälligkeiten');
    const t4 = bericht(kz, { svg: 'x.svg', ziele: { version: 1, ziele: { 'f2.quote.boden.gibtsnicht': { max: 1 } } } });
    ok(/\[grau\] f2\.quote\.boden\.gibtsnicht/.test(t4), 'Ziel ohne Wert im Lauf: grau');
    const ziel = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'telemetrie', 'ziele.json'), 'utf8'));
    ok(ziel.version === 1 && Object.keys(ziel.ziele).length === 0, 'eingecheckte ziele.json ist leer (Kai legt die Werte fest)');
    // Zeilendeckel: ein künstlich riesiges Kennzahlenobjekt wird auf LIMIT gekürzt
    const gross = JSON.parse(JSON.stringify(kz));
    for (let i = 0; i < 40; i++) { gross.f2.quote.boden['waffe' + i] = 10; gross.f2.schuesse.boden['waffe' + i] = 10; gross.f2.treffer_je_schuss.boden['waffe' + i] = 1; }
    gross.f4.dabei = { p1: 1, p2: 2, p3: 3, p4: 4 }; gross.f4.rolle = { p1: { a: 1 }, p2: { a: 1 }, p3: { a: 1 }, p4: { a: 1 } };
    const ziele = {}; for (let i = 0; i < 80; i++) ziele['f2.quote.boden.waffe' + (i % 40)] = { min: 1 + i };
    const t5 = bericht(gross, { svg: 'x.svg', ziele: { version: 1, ziele } });
    ok(t5.split('\n').length - 1 <= LIMIT, 'Zeilendeckel: Bericht mit riesiger Zielliste hat höchstens ' + LIMIT + ' Zeilen (' + (t5.split('\n').length - 1) + ')');
    ok(maxZeile(t5) <= 160 && maxZeile(bericht(gross, { svg: 'x.svg' })) <= 160, 'Zeilenlaenge: auch mit 40 Waffen in einer Quote-Zeile keine Zeile ueber 160 Zeichen (laengste ' + maxZeile(bericht(gross, { svg: 'x.svg' })) + ')');
    // CLI: --json schreibt das Kennzahlen-Objekt, --basis liest es wieder
    const jf = path.join(TMP, 'basis.json');
    auswerten(A.protokoll.dateien[0], { aus: path.join(TMP, 'b2'), json: jf });
    const geladen = JSON.parse(fs.readFileSync(jf, 'utf8'));
    ok(JSON.stringify(flach(geladen)) === JSON.stringify(flach(kz)), 'Kennzahlen-JSON (Basis-Datei) enthält genau das Kennzahlen-Objekt');
    const cli = spawnSync(process.execPath, [path.join('tools', 'auswerten.js'), A.protokoll.dateien[0], '--basis', jf, '--aus', path.join(TMP, 'b3')], { cwd: ROOT, encoding: 'utf8' });
    ok(cli.status === 0 && /Bericht:/.test(cli.stdout) && !/NaN/.test(cli.stdout), 'CLI mit --basis: Exit 0');
    const cli2 = spawnSync(process.execPath, [path.join('tools', 'auswerten.js'), 'gibt-es-nicht-xyz', '--aus', path.join(TMP, 'b4')], { cwd: ROOT, encoding: 'utf8' });
    ok(cli2.status === 2, 'CLI: unbekannte Session -> Exit 2');
  }
}

// ===================== 5. Nacharbeit: Bewertung, Marken, Bild, Zeilenlaenge, lange Sessions =====================
section('5. Nacharbeit D1');
{
  const kopie = (o) => JSON.parse(JSON.stringify(o));
  // --- umbrechen (K12) ---
  {
    const { umbrechen } = require('./auswertung/bericht.js');
    const lang = '- ' + Array.from({ length: 60 }, (_, i) => 'wort' + i + ' abc').join(' · ');
    const teile = umbrechen(lang, 160);
    ok(teile.length > 1 && teile.every((t) => t.length <= 160), 'umbrechen: jede Teilzeile hoechstens 160 Zeichen (' + teile.length + ' Zeilen)');
    ok(teile.slice(1).every((t) => t.startsWith('  ')), 'umbrechen: Folgezeilen sind eingerueckt (Listenpunkt bleibt zusammen)');
    ok(teile.join(' ').replace(/[\s·]+/g, ' ') === lang.replace(/[\s·]+/g, ' ') && umbrechen('kurz', 160)[0] === 'kurz', 'umbrechen: kein Wort geht verloren, kurze Zeilen bleiben');
    ok(umbrechen('x'.repeat(400), 160).every((t) => t.length <= 160), 'umbrechen: auch ohne Trenner (hart geschnitten) hoechstens 160');
  }
  // --- XML-Pruefer selbst (K11) ---
  {
    ok(xmlPruefen('<?xml version="1.0"?><svg a="1" b=\'2\'><!-- c --><g/><t>x &amp; y &#169; &#x20;</t></svg>') === null, 'xmlPruefen: gueltiges XML');
    const schlecht = {
      'Endtag falsch': '<svg><g></svg>', 'rohes &': '<svg><text>a & b</text></svg>', 'Attribut ohne Anfuehrungszeichen': '<svg a=b/>', 'doppeltes Attribut': '<svg a="1" a="2"/>',
      'zwei Wurzeln': '<svg/><svg/>', 'nicht geschlossen': '<svg><a></a>', 'unbekannte Entity': '<svg>&nbsp;</svg>', 'rohes < im Wert': '<svg a="x<y"/>', 'Text ausserhalb': 'x<svg/>', 'leer': '',
    };
    for (const [n, t] of Object.entries(schlecht)) ok(xmlPruefen(t) !== null, 'xmlPruefen lehnt ab: ' + n);
    // ein Name mit & und < im Szenennamen muss im Bild maskiert sein
    const kz = kopie(K);
    kz.listen.szenen[0].szene = 'a&b<c"d';
    kz.kopf.sitzung = 'x&y';
    ok(xmlPruefen(profil(P, kz)) === null, 'SVG maskiert & < " in Szenen- und Sitzungsnamen (wohlgeformt)');
  }
  // --- S13: Verlustmarken je Pixelspalte und Art ---
  {
    const kz = kopie(K);
    kz.listen.verluste = [];
    for (let i = 0; i < 800; i++) kz.listen.verluste.push({ t: i * 0.05, art: 'gefallen', slot: 'p1', waffe: 'x' });          // 800 Verluste in 800 verschiedenen Spalten: keine Kuerzung bei 600
    for (let i = 0; i < 50; i++) kz.listen.verluste.push({ t: 20.01 + i * 0.0001, art: 'bodenschild_leer', slot: 'p1' });          // 50 in EINER Spalte (zeitlich verschieden)
    const svg = profil(P, kz);
    const titel = [...svg.matchAll(/<polygon[^>]*><title>(?:(\d+)× )?([^<0-9][^<]*?) [\d.]+ s<\/title>/g)].map((m) => ({ n: m[1] ? Number(m[1]) : 1, art: m[2] }));
    const gef = titel.filter((x) => x.art === 'gefallen'), bsl = titel.filter((x) => x.art === 'Bodenschild leer');
    ok(gef.length === 800 && gef.every((x) => x.n === 1), 'Verlustmarken: 800 Verluste in 800 Spalten = 800 Marken (nichts abgeschnitten) (' + gef.length + ')');
    ok(bsl.length === 1 && bsl[0].n === 50, 'Verlustmarken: 50 Verluste derselben Art in einer Pixelspalte = EINE Marke mit 50x (' + JSON.stringify(bsl.map((x) => x.n)) + ')');
    ok(!/nur die ersten/.test(svg) && xmlPruefen(svg) === null, 'keine Abschneide-Meldung, Bild wohlgeformt');
    const mix = kopie(K);
    mix.listen.verluste = [{ t: 20, art: 'gefallen', slot: 'p1' }, { t: 20, art: 'bodenschild_leer', slot: 'p1' }];
    const sm = [...profil(P, mix).matchAll(/<polygon[^>]*><title>/g)].length;
    gleich(sm, 2, 'Verlustmarken: verschiedene Arten in derselben Spalte bleiben getrennt');
  }
  // --- S11 und Bewertung ---
  {
    const kz0 = kopie(K);
    kz0.kopf.quelle = 'mensch';
    kz0.f6.daten.abgeschnitten = 2; kz0.f6.daten.ohne_ende = 1;
    kz0.f4.leerlauf.p1 = { dauer: 100, episoden: 2, anteil: 50 };
    const idx = (zl, re) => zl.findIndex((l) => re.test(l));
    // b = 0: Gewicht |a| / Mindestmenge (nicht fuer alle Neuzugaenge dasselbe)
    const ab = Bewertung.abweichungen({ f3: { gefallen: { n: 9 }, notfall: { n: 2 } }, f2: { kills: { boden: { gesamt: 12 } } } }, { 'f3.gefallen.n': 0, 'f3.notfall.n': 0, 'f2.kills.boden.gesamt': 0 });
    gleich(ab.liste.map((x) => x.k).join(' '), 'f3.gefallen.n f2.kills.boden.gesamt f3.notfall.n', 'Basis = 0: Gewicht |a| / min (9/3*1,5 = 4,5 vor 12/3 = 4 vor 2/1*1,5 = 3)');
    // Reihenfolge: Daten, Basis (Kopf, Abweichungen), Technik, Verluste, Leerlauf
    const basisFlach = { 'f2.kills.boden.gesamt': 8, 'f2.quote.boden.blaster': 80, 'f2.gefecht.boden': 40, 'f3.zone_aus.kaputt': 9 };
    const zl = auffaelligkeiten(kz0, { basis: basisFlach });
    const pos = [idx(zl, /^Daten:/), idx(zl, /^Basis:/), idx(zl, /^ {2}f\d/), idx(zl, /^Technik:/), idx(zl, /^Verluste:/), idx(zl, /^Leerlauf/)];
    ok(pos.every((x) => x >= 0) && pos.every((x, i) => i === 0 || x > pos[i - 1]), 'Auffaelligkeiten: erst Daten, dann Basis, dann Technik, dann Verluste, dann Leerlauf (' + pos.join(',') + ')');
    ok(/Session nicht sauber beendet/.test(zl[0]) && /2 abgeschnittene Zeile/.test(zl[0]), 'Daten: nicht sauber beendet und abgeschnittene Zeilen');
    // Kuerzen: viele Abweichungen kuerzen zuerst die einzelnen Basis-Zeilen, Daten und Technik bleiben, hoechstens 8 Zeilen
    const viele = {}; for (const k of Object.keys(flach(kz0))) if (infoZu(k) && /^f(2|4|5)/.test(k)) viele[k] = flach(kz0)[k] * 3 + 100;
    const zv = auffaelligkeiten(kz0, { basis: viele });
    ok(zv.length <= 8 && zv.length >= 6, 'Auffaelligkeiten: hoechstens 8 Zeilen (' + zv.length + ')');
    ok(idx(zv, /^Daten:/) === 0 && idx(zv, /^Technik:/) > 0 && idx(zv, /^Verluste:/) > 0 && idx(zv, /^Leerlauf/) > 0, 'Kuerzen: Daten, Technik, Verluste und Leerlauf bleiben, wenn Basis-Zeilen gekuerzt werden');
    ok(idx(zv, /weitere Abweichungen/) > 0 && zv.filter((l) => /^ {2}f\d/.test(l)).length <= 3, 'Kuerzen: einzelne Basis-Zeilen weg, Restzeile nennt die Zahl');
    // Nur Basis-Abweichungen (keine Daten/Technik/Verluste/Leerlauf): hoechstens BASIS_ZEILEN_MAX = 3 einzeln, der Rest als Zeile "+n weitere"
    {
      const klein5 = { kopf: { quelle: 'mensch' }, f2: { kills: { boden: { gesamt: 4 } }, gefecht: { boden: 8, raum: 8 }, quote: { boden: { blaster: 40 } }, schuesse: { boden: { blaster: 5 } } }, f3: {}, f4: {}, f6: {}, listen: {} };
      const b5 = { 'f2.kills.boden.gesamt': 12, 'f2.gefecht.boden': 40, 'f2.gefecht.raum': 40, 'f2.quote.boden.blaster': 90, 'f2.schuesse.boden.blaster': 20 };
      const z5 = auffaelligkeiten(klein5, { basis: b5 });
      ok(z5.filter((l) => /^ {2}f\d/.test(l)).length === 3 && z5.some((l) => /\(\+2 weitere Abweichungen\)/.test(l)), 'fuenf Abweichungen ohne andere Auffaelligkeiten: drei einzeln, dazu "+2 weitere" (' + z5.length + ' Zeilen)');
    }
    // Verluste: ohne Basis immer, mit Basis nur ohne Gegenstueck in der Basis (sonst als Abweichung)
    const bw = (basis) => Bewertung.bewerten(kz0, { basis });
    ok(bw(null).verluste.length === 4 && bw({}).verluste.length === 4, 'Verluste ohne Basis (und bei leerer Basis): alle in der Liste');
    const mit = bw({ 'f3.gefallen.n': 1, 'f3.notfall.n': 1 }).verluste.map((x) => x.k);
    ok(mit.length === 2 && !mit.includes('f3.gefallen.n') && !mit.includes('f3.notfall.n'), 'Verluste mit Basis: nur die ohne Gegenstueck in der Basis (' + mit.join(',') + ')');
    ok(!/^Verluste:/m.test(auffaelligkeiten(kz0, { basis: flach(kz0) }).join('\n')), 'Verluste mit voller Basis: kein Verlust-Block, nur Abweichungen');
    // Leerlauf: bei Bots keine Auffaelligkeit, die Kennzahl bleibt
    ok(bw(null).leerlauf.length === 1 && bw(null).leerlauf[0].slot === 'p1', 'Leerlauf bei Menschen: p1 steht in der Bewertung');
    kz0.kopf.quelle = 'bot';
    ok(bw(null).leerlauf.length === 0 && kz0.f4.leerlauf.p1.dauer === 100, 'Leerlauf bei quelle bot: keine Auffaelligkeit, Kennzahl bleibt');
    // Ziele: rote Ziele auch in den Auffaelligkeiten
    const rot = Bewertung.bewerten(kz0, { ziele: { 'f2.quote.boden.blaster': { min: 99 } } });
    ok(rot.ziele.length === 1 && rot.ziele[0].status === 'rot', 'Bewertung: Ziel ausserhalb = rot');
  }
  // --- S9, S10, K9: kleine Protokolle ---
  {
    const lesenK = (o) => { const pr = Lesen.ausText(klein(o)); return { pr, kz: kennzahlen(pr) }; };
    const bot = lesenK({ quelle: 'bot', ende: false });
    gleich(bot.kz.f6.daten.ohne_ende, 1, 'ohne session_ende: f6.daten.ohne_ende = 1');
    const tb = bericht(bot.kz, { svg: 'k.svg' });
    const aufB = tb.split('## Auffälligkeiten')[1].split('\n## ')[0];
    ok(/Session nicht sauber beendet/.test(aufB), 'Auffaelligkeit "Session nicht sauber beendet"');
    gleich(bot.kz.f4.leerlauf.p1.dauer, 80, 'Bot: Kennzahl f4.leerlauf.p1.dauer bleibt (80 s ohne Eingabe)');
    ok(!/Leerlauf \(>= 30 s/.test(aufB) && /Bot-Lauf: Leerlauf nicht aussagekräftig/.test(tb), 'Bot: keine Leerlauf-Auffaelligkeit, Hinweis im F4-Block');
    const mensch = lesenK({ quelle: 'mensch' });
    gleich(mensch.kz.f6.daten.ohne_ende, 0, 'mit session_ende: f6.daten.ohne_ende = 0');
    ok(/Leerlauf \(>= 30 s ohne Eingabe\): p1 80 s \(100 %\)/.test(bericht(mensch.kz, { svg: 'k.svg' })), 'Mensch: dieselben Daten ergeben die Leerlauf-Auffaelligkeit');
    // Warnungen des Lesers fliessen in den Bericht (kein Sessionkopf), fremde Schema-Version nennt SCHEMA_VERSION
    const ohneKopf = lesenK({ kopf: false });
    ok(ohneKopf.pr.warnungen.some((w) => /Sessionkopf/.test(w)) && /kein Sessionkopf/.test(bericht(ohneKopf.kz, { svg: 'k.svg' }).split('## F1')[0]), 'Warnung des Lesers (kein Sessionkopf) steht in den Auffaelligkeiten');
    const v2 = lesenK({ v: 2 });
    ok(/Schema-Version 2 statt 1/.test(bericht(v2.kz, { svg: 'k.svg' }).split('## F1')[0]), 'fremde Schema-Version steht in den Auffaelligkeiten (erwartet: SCHEMA_VERSION)');
    // K9: Slots am Boden ohne Deckungszeile = 0 s in Deckung
    const dk = (kz, q) => (kz.f2b.deckung || {})[q] || {};   // Zugriff ohne Absturz, wenn die Kennzahl fehlt (dann schlaegt die Pruefung an, der Test stuerzt nicht ab)
    gleich(dk(bot.kz, 'p1').cv_s, 0, 'K9: p1 am Boden ohne Deckungszeile: cv_s = 0');
    gleich(dk(bot.kz, 'p3').cv_anteil, 0, 'K9: p3 am Boden ohne Deckungszeile: cv_anteil = 0');
    ok(/p1 0 s in Deckung · p3 0 s in Deckung/.test(tb), 'K9: Bericht sagt "0 s in Deckung"');
    // S3: nur Bodenfenster -> keine Systemintegritaet
    ok(bot.kz.f3.integritaet === undefined && bot.kz.listen.reihen.raum.t.length === 0, 'S3: ohne Raumfenster kein f3.integritaet.min (Raumfilter)');
    // S2: nur Stand gesetzt, keine Buchungen
    const st = lesenK({ stand: true });
    const tm = bericht(st.kz, { svg: 'k.svg' });
    ok(/- Marken: Stand gesetzt \(testmarken\) auf 5000 · Buchungen: keine/.test(tm), 'Marken: "Stand gesetzt (testmarken) auf 5000 · Buchungen: keine"');
    const c = st.kz.f5.konto.marks;
    ok(c.anfang === 5000 && c.netto === 0 && c.ende === 5000 && c.anfang + c.netto === c.ende, 'Marken nur Stand gesetzt: anfang 5000, netto 0, ende 5000');
    ok(st.kz.f5.buchung === undefined && st.kz.f5.stand.marks.testmarken === 5000, 'Marken: keine Buchungssumme, f5.stand.marks.testmarken = 5000');
  }
  // --- K1 bis K8 (zweite Nacharbeit) ---
  {
    const Zs = (t, typ, f, sitzung) => Object.assign({ v: 1, typ, sitzung: sitzung || 'a', tick: 0, t }, f);
    // K1: --aus und --json gelten beide ab dem aktuellen Verzeichnis (nicht --aus ab dem Repo)
    const cwd = path.join(TMP, 'cwd-k1');
    fs.mkdirSync(cwd);
    fs.writeFileSync(path.join(cwd, 'mini-1.jsonl'), TEXT);
    const cli = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'auswerten.js'), 'mini-1.jsonl', '--aus', 'rel-aus', '--json', 'rel/basis.json', '--json-voll', 'rel/voll.json'], { cwd, encoding: 'utf8' });
    ok(cli.status === 0 && fs.existsSync(path.join(cwd, 'rel-aus', 'mini-1.md')) && fs.existsSync(path.join(cwd, 'rel-aus', 'mini-1.svg')), 'K1: --aus relativ gilt ab dem aktuellen Verzeichnis (' + (cli.stderr || '').slice(0, 100) + ')');
    ok(fs.existsSync(path.join(cwd, 'rel', 'basis.json')) && !fs.existsSync(path.join(ROOT, 'rel-aus')), 'K1: --json relativ ab dem aktuellen Verzeichnis, nichts im Repo');
    // (b) --json ohne listen.reihen, --json-voll mit; die Basis ohne Reihen funktioniert
    const bj = JSON.parse(fs.readFileSync(path.join(cwd, 'rel', 'basis.json'), 'utf8')), vj = JSON.parse(fs.readFileSync(path.join(cwd, 'rel', 'voll.json'), 'utf8'));
    ok(bj.listen && bj.listen.reihen === undefined && bj.listen.szenen && vj.listen.reihen && vj.listen.reihen.raum.t.length === 20, '--json schreibt ohne listen.reihen, --json-voll mit');
    ok(JSON.stringify(flach(bj)) === JSON.stringify(flach(vj)), 'die Kennzahlen sind in beiden Dateien gleich');
    const cb = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'auswerten.js'), 'mini-1.jsonl', '--basis', 'rel/basis.json', '--aus', 'rel-aus2'], { cwd, encoding: 'utf8' });
    ok(cb.status === 0 && /0 wesentlich anders/.test(fs.readFileSync(path.join(cwd, 'rel-aus2', 'mini-1.md'), 'utf8')), 'Basis ohne Reihen: Bericht und Bild laufen, keine Abweichung gegen sich selbst');
    // K2: Zeit bis Kill ist ein Median
    ok(/grundtyp 3 \(Median 20 s\)/.test(bericht(K, { svg: 'x.svg' })) && !/Zeit bis Kill[^\n]*Ø/.test(bericht(K, { svg: 'x.svg' })), 'K2: Zeit bis Kill steht als Median, nicht als Ø');
    // K3: leere Abschlussszene
    const k3 = kennzahlen({ zeilen: [
      Zs(0, 'kopf', {}), Zs(100, 'szene_ende', { modus: 'kampagne', szene: 'm1', ausgang: 'erfolg', dauer: 100, dauer_gesamt: 100 }),
      Zs(100, 'szene_start', { modus: 'kampagne', szene: 'm2' }), Zs(100, 'szene_ende', { modus: 'kampagne', szene: 'm2', ausgang: 'session_ende', dauer: 0, dauer_gesamt: 0 }),
      Zs(100, 'szene_start', { modus: 'kampagne', szene: 'm3' }), Zs(250, 'szene_ende', { modus: 'kampagne', szene: 'm3', ausgang: 'session_ende', dauer: 150, dauer_gesamt: 150 }),
    ] });
    ok(k3.f1.dauer.kampagne.n === 2 && k3.f1.dauer.kampagne.mittel === 125 && k3.f1.dauer.kampagne.summe === 250, 'K3: Szene mit session_ende und Dauer unter 1 s zaehlt nicht in n und Mittel (n 2, Mittel 125)');
    ok(k3.f1.ausgang.session_ende === 2 && k3.listen.szenen.length === 3, 'K3: Ausgang und Szenenliste behalten sie');
    // K4: Wellenmittel durch die Wellen MIT Dauer
    const k4 = kennzahlen({ zeilen: [Zs(1, 'welle_geschafft', { modus: 'wellen_boden', nr: 1, dauer: 10 }), Zs(2, 'welle_geschafft', { modus: 'wellen_boden', nr: 2, dauer: 20 }), Zs(3, 'welle_geschafft', { modus: 'wellen_boden', nr: 3, dauer: null })] });
    ok(k4.f1.wellen.geschafft === 3 && k4.f1.wellen.dauer_mittel === 15, 'K4: Wellenmittel = Summe / Wellen mit Dauer (15, nicht 10)');
    // K5: Neustarts nur in f3
    const k5 = kennzahlen({ zeilen: [Zs(1, 'szene_neustart', { modus: 'graben', szene: 'g', versuch: 2 }), Zs(2, 'szene_neustart', { modus: 'graben', szene: 'g', versuch: 3 })] });
    ok(k5.f3.neustarts === 2 && k5.f1.neustarts === undefined && flach(k5)['f1.neustarts'] === undefined, 'K5: Neustarts nur als f3.neustarts');
    ok(/Neustarts 2/.test(bericht(k5, { svg: 'x.svg' })), 'K5: der F1-Text liest den Wert aus f3');
    // K6: Schuss und Treffer nur derselben Sitzung und Seite verknuepfen
    const sch6 = (sitz, pid, von) => Zs(1, 'schuss', { ort: 'raum', waffe: 'standardbatterie', von, pid, treffer: null }, sitz);
    const tr6 = (sitz, pid, von, ziel) => Zs(2, 'treffer', { ort: 'raum', waffe: 'standardbatterie', von, ziel, pid, ergebnis: 'treffer', schaden_roh: 1, schild: 0, schaden: 1 }, sitz);
    const k6 = kennzahlen({ zeilen: [sch6('a', 'pr1', 'lerche'), sch6('b', 'pr2', 'lerche'), tr6('b', 'pr1', 'lerche', 'gegner'), tr6('a', 'pr1', 'gegner', 'lerche'), tr6('a', 'pr1', 'lerche', 'gegner'), tr6('a', 'pr1', 'lerche', 'gegner')] });
    ok(k6.f2.schuesse.raum.standardbatterie === 2 && k6.f2.quote.raum.standardbatterie === 50 && k6.f2.treffer_je_schuss.raum.standardbatterie === 1, 'K6: nur Paare derselben Sitzung und Seite (Quote 50 %, 1 Treffer je Schuss; falsche Paare ergaeben mehr)');
    // K8: Kennzahl-Version von Basis und Lauf
    const bv = kopie(K); bv.version = 99;
    const zv8 = auffaelligkeiten(K, { basis: bv });
    ok(/Basis hat Kennzahl-Version 99, Lauf 1 – Vergleich nur über gemeinsame Schlüssel/.test(zv8[0]) && /^Daten:/.test(zv8[0]), 'K8: ungleiche Kennzahl-Version steht in der Datenzeile');
    ok(!auffaelligkeiten(K, { basis: kopie(K) }).some((l) => /Kennzahl-Version/.test(l)) && !auffaelligkeiten(K, { basis: flach(K) }).some((l) => /Kennzahl-Version/.test(l)), 'K8: gleiche Version und flache Basis: keine Zeile');
  }
  // --- K7: lange Session (ein Spread mit 200000 Eintraegen wirft RangeError) ---
  {
    const N = 200000;
    const zeilenL = [{ v: 1, typ: 'kopf', sitzung: 'lang', t: 0, quelle: 'bot', spielerzahl: 1 }];
    for (let i = 0; i < N; i++) {
      zeilenL.push({ v: 1, typ: 'zeitreihe', t: 2 * (i + 1), fenster: 2, tick_n: 60, tick_med: 0.1, tick_max: i === N - 1 ? 77 : 0.5, tick_ueber5: 0, tick_ueber16: 0, tick_ueber33: 0, snap_n: 1, snap_med: 1, snap_max: i === 7 ? 9 : 2,
        kappung_n: 0, kappung_ticks: 0, nachhol_ticks: 0, fehler_n: 0, r_integ: [10, 10 - (i % 3)], r_schild: [4, 4, 4, 4], r_hitze: [0, 0, 0], r_energie: [2, 2, 2], r_gegner: 0,
        slots: ['p1'], verbunden: [true], ort: ['raum'], konsole: ['helm'], station: ['helm'], ein_bew: [1], ein_akt: [0], b_schild: [i % 4 + 1], b_gg: 1, b_gg_duck: 0, b_gg_abst_min: 3 + (i % 5), b_gg_abst_nn: 5 });
      if (i < N) zeilenL.push({ v: 1, typ: 'spielleiter_warten', t: 2 * (i + 1), art: 'szene', dauer: i === 5 ? 88 : 1, ausgang: 'ok' });
    }
    try {
      const kz = kennzahlen({ zeilen: zeilenL });
      ok(kz.f6.tick.max === 77 && kz.f6.snap.max === 9 && kz.f6.spielleiter.dauer_max === 88 && kz.f2b.gegner_abstand.min === 3 && kz.listen.reihen.raum.t.length === N && kz.f3.integritaet.min === 90, 'lange Session (' + N + ' Fenster): Maxima und Minima ohne Spread korrekt');
      const svg = profil({ zeilen: [] }, kz);
      ok(xmlPruefen(svg) === null && bericht(kz, { svg: 'l.svg' }).split('\n').length - 1 <= LIMIT, 'lange Session: Bild wohlgeformt, Bericht hoechstens ' + LIMIT + ' Zeilen');
    } catch (e) { ok(false, 'lange Session wirft: ' + String(e.message).slice(0, 120)); }
  }
}

console.log('\n' + (fails ? 'FEHLER: ' + fails + ' von ' + n + ' Prüfungen' : 'OK: ' + n + ' Prüfungen'));
process.exit(fails ? 1 : 0);
