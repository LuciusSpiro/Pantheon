'use strict';
// WRK-01 B: Mutationsprobe zu tools/test-faden-wrack.js (Beat wrack: Ausgang gelungen ohne Pflicht fuer Beute/Logbuch, Merker am Faden-Objekt, Funk je Ereignis genau einmal, Pflicht landeplatz in Pruefer UND Expander,
// Art schiff, Verteiler-Ereignisse, Haken bei Taetigkeit und Tick, Notrueckholung, Notsprung, Daten). Kopiert Server, Shared, Content, public und die noetigen Tests in ein Temp-Verzeichnis (das Repo bleibt unberuehrt),
// aendert dort je Lauf EINE Regel und verlangt, dass der Test rot wird (Exit 1 MIT FEHLER-Zeile). ABSTUERZE (Exit != 0 ohne FEHLER-Zeile) zaehlen NICHT als erkannt. Der Selbstcheck vorab verlangt, dass jeder Anker genau
// einmal im Quelltext steht (Exit 2, wenn nicht). --trocken prueft nur die Anker.
//   node tools/mutation-faden-wrack.js [--trocken] [begriff ...]        (npm run test:faden-wrack-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-faden-wrack-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'public'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-faden-wrack.js'], ['tools/test-faden-boden.js']];
for (const f of ['tools/test-faden-wrack.js', 'tools/test-faden-boden.js', 'tools/regie-fixture.js', 'tools/faden-fixture.js', 'tools/gegner-testhilfe.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const FW = 'server/sim/faden-wrack.js', PR = 'server/sim/faden-pruefer.js', BP = 'server/sim/faden-bauplan.js', FA = 'server/sim/faden.js', RE = 'server/sim/reise-ereignis.js', BO = 'server/sim/faden-boden.js', BT = 'content/faeden/beats.json', AM = 'server/sim/abenteuer-mock.js', PT = 'server/sim/abenteuer-prompt.js', TX = 'content/faeden/wrack-texte.json', BR = 'content/faeden/abenteuer-brett.json';
const BPARAM = '"parameter":{"landeplatz":{"erlaubt":"landeplatz"},"besetzung":{"standard":"ruhig","erlaubt":["ruhig","raeuber"]}}';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  [FW, 'if (!untenGewesen.has(f) || !L.niemandUnten(game, lp)) return;', 'if (!L.niemandUnten(game, lp)) return;', 'Ausgang gelungen ignoriert "unten gewesen" (beamedUp ohne beamedDown beendet den Beat)'],
  [FW, 'if (L.niemandUnten(game, lp)) ausgang(game, f, beat, \'gelungen\');', 'if (true) ausgang(game, f, beat, \'gelungen\');', 'Pruefung bei Taetigkeit und Tick ignoriert, dass noch jemand unten ist'],
  [FW, 'if (L.niemandUnten(game, lp)) ausgang(game, f, beat, \'gelungen\');', 'if (L.niemandUnten(game, lp) && fundVon(f).beute) ausgang(game, f, beat, \'gelungen\');', 'Beute wird Pflicht fuer gelungen (Tick/Taetigkeit): Wracks sind Storytelling, kein Loot'],
  [FW, 'if (!untenGewesen.has(f) || !L.niemandUnten(game, lp)) return;', 'if (!untenGewesen.has(f) || !L.niemandUnten(game, lp) || !fundVon(f).beute) return;', 'Beute wird Pflicht fuer gelungen (beamedUp)'],
  [FW, 'ev.data.notrueckholung === true ? \'gescheitert\' : \'gelungen\'', '\'gelungen\'', 'Notrueckholung-Auswertung: der Marker wird ignoriert (squadRecall zaehlt als gelungen)'],
  [FW, 'if (ev.name === \'notsprung\') { ausgang(game, f, beat, \'gescheitert\'); return; }', '', 'Notsprung im Beat: der Handler reagiert nicht'],
  [FW, 'if (!x.beute) { x.beute = true; funk(game, f, beat, \'beute\'); }', 'x.beute = true; funk(game, f, beat, \'beute\');', 'Funk beim Fund bei jeder Beute statt nur beim ersten'],
  [FW, 'if (!x.logbuch) { x.logbuch = true; funk(game, f, beat, \'logbuch\'); }', 'x.logbuch = true; funk(game, f, beat, \'logbuch\');', 'Funk beim Logbuch bei jedem Lesen statt nur beim ersten'],
  [FW, 'if (ev.name === \'ankerGelesen\')', 'if (false)', 'Logbuch gelesen wird nicht vermerkt'],
  [FW, 'if (ev.name === \'beuteGeborgen\')', 'if (false)', 'Beute geborgen wird nicht vermerkt'],
  [FW, '\'abschluss_\' + (x.beute ? \'mit\' : \'ohne\')', '\'abschluss_ohne\'', 'Abschlussfunk nennt die Beute nie'],
  [FW, '(x.logbuch ? \'mit\' : \'ohne\')', '\'ohne\'', 'Abschlussfunk nennt das Logbuch nie'],
  [FW, 'const untenGewesen = new WeakSet();', 'const IDS = new Set(); const untenGewesen = { has: (f) => IDS.has(f.id), add: (f) => IDS.add(f.id), delete: (f) => IDS.delete(f.id) };', '"unten gewesen" haengt an der Fadenid statt am Faden-Objekt (ueberlebt reset und Laden: falsches gelungen)'],
  [FW, 'const fund = new WeakMap();', 'const M = new Map(); const fund = { get: (f) => M.get(f.id), set: (f, x) => M.set(f.id, x), delete: () => {} };', 'Fund haengt an der Fadenid und wird nie geloescht (ueberlebt reset und Laden)'],
  [FW, 'if (L.niemandUnten(game, lp)) untenGewesen.delete(faden); else untenGewesen.add(faden);', 'untenGewesen.delete(faden);', 'Start: "unten gewesen" wird nicht aus dem echten Zustand abgeleitet'],
  [FW, 'untenGewesen.add(f); L.besetzenFuer(game, beat, lp, ART); return; }', 'untenGewesen.add(f); return; }', 'Nachholen: beamedDown holt die fehlende Besetzung nicht nach'],
  [FW, '    L.besetzenFuer(game, beat, lp, ART);\n    const schluessel', '    const schluessel', 'Start besetzt den Ort nicht (raeuber ohne Gegner)'],
  [FW, 'funk(game, faden, beat, has(TEXTE, \'start_\' + schluessel) ? \'start_\' + schluessel : \'start_\' + L.WERTE.besetzung_standard.wert);', 'funk(game, faden, beat, \'start_\' + L.WERTE.besetzung_standard.wert);', 'Startfunk immer in der Standardvariante'],
  [FW, 'if (!lp || map !== lp) return;', 'if (!lp) return;', 'Handler prueft die Karte nicht (Ereignisse eines anderen Ortes des Fadens zaehlen)'],
  [FW, 'Boden.anmelden(ART, handler);', '', 'Handler nicht am Verteiler angemeldet'],
  [FW, 'untenGewesen.delete(f); fund.delete(f);', 'untenGewesen.delete(f);', 'Ausgang loescht den Fund nicht (zweiter Lauf am selben Faden erbt ihn)'],
  [FA, 'try { require(\'./faden-wrack.js\').nachTaetigkeit(game); }', 'try { void 0; }', 'Haken bei der Taetigkeit (faden.taetigkeit) fehlt'],
  [RE, 'try { require(\'./faden-wrack.js\').update(game); }', 'try { void 0; }', 'Haken im Tick (reise-ereignis.update) fehlt'],
  [BO, 'notsprung: \'alle\', beuteGeborgen: \'karte\', ankerGelesen: \'karte\' }', 'notsprung: \'alle\', ankerGelesen: \'karte\' }', 'Verteiler kennt beuteGeborgen nicht'],
  [BO, 'beuteGeborgen: \'karte\', ankerGelesen: \'karte\' }', 'beuteGeborgen: \'karte\' }', 'Verteiler kennt ankerGelesen nicht'],
  [BO, 'beuteGeborgen: \'karte\', ankerGelesen: \'karte\' }', 'beuteGeborgen: \'alle\', ankerGelesen: \'alle\' }', 'Verteiler ordnet beuteGeborgen/ankerGelesen nicht ueber die Karte zu (jeder Faden bekommt sie)'],
  [PR, 'if (braucht.landeplatz === true && !(typeof p.landeplatz', 'if (false && braucht.landeplatz === true && !(typeof p.landeplatz', 'Pflicht landeplatz: Pruefer-Regel aus'],
  [BP, 'if (cat.braucht && cat.braucht.landeplatz === true && !(typeof p.landeplatz', 'if (false && cat.braucht && cat.braucht.landeplatz === true && !(typeof p.landeplatz', 'Pflicht landeplatz: Expander-Regel aus (Pruefer und Expander laufen auseinander)'],
  [PR, 'if (cat && Array.isArray(cat.landeplatz_art) && pl && !cat.landeplatz_art.includes(pl.art))', 'if (false)', 'Katalogfeld landeplatz_art wird nicht geprueft (wrack an einer Hoehle)'],
  [BT, '"frist": 12,\n      "braucht": {"nsc_status": ["aktiv", "verbuendet", "gefangen"], "landeplatz": true},\n      "landeplatz_art"', '"braucht": {"nsc_status": ["aktiv", "verbuendet", "gefangen"], "landeplatz": true},\n      "landeplatz_art"', 'Katalog: wrack ohne eigene frist'],
  [BT, '"landeplatz_art": ["schiff"],', '"landeplatz_art": ["schiff", "station"],', 'Katalog: wrack auch an der Station'],
  [BT, '{"start_status":"aktiv","hinweis_traeger":false,' + BPARAM, '{"start_status":"aktiv","hinweis_traeger":true,' + BPARAM, 'Katalog: wrack als Hinweis-Traeger (ist ein eigener Schritt)'],
  [BT, BPARAM, '"parameter":{"landeplatz":{"erlaubt":"landeplatz"},"besetzung":{"standard":"ruhig","erlaubt":["ruhig","raeuber","belagerer"]}}', 'Katalog: besetzung belagerer fuer wrack erlaubt'],
  [BT, '"landeplatz": true},\n      "landeplatz_art"', '"landeplatz": false},\n      "landeplatz_art"', 'Katalog: wrack ohne braucht.landeplatz'],
  [BT, '"zweck": "Wrack im Sektor (Landeplatz Art schiff):', '"zweck": "' + 'Eine viel zu lange Beschreibung des Wracks. '.repeat(4) + 'Wrack im Sektor (Landeplatz Art schiff):', 'Katalogzeile laenger als 440 Zeichen'],
  [AM, '&& !(D.BEATS[t].braucht && D.BEATS[t].braucht.landeplatz === true));', ');', 'Mock nimmt Beats mit braucht.landeplatz nicht aus planbar aus (Wuerfelreihe aendert sich)'],
  [PT, 'br.landeplatz === true ? \'Pflicht: landeplatz\' : null, ', '', 'Katalogzeile nennt die Pflicht landeplatz nicht'],
  [TX, '"beute": "Da liegt noch', '"beute_alt": "Da liegt noch', 'Daten: Text beute fehlt'],
  [TX, '{platz}, {ort}. Keine Lebenszeichen', '{platz}, {spieler}. Keine Lebenszeichen', 'Daten: Text mit unbekanntem Platzhalter'],
  [BR, '"wrack": {\n      "text": "Wrack erkunden"\n    },', '', 'Brett: kein Klartext fuer den Schritt wrack'],
];

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
{
  const normal = (t) => t.replace(/\r\n/g, '\n');
  const schlecht = [];
  for (const [datei, alt, , was] of MUTATIONEN) {
    let text;
    try { text = normal(fs.readFileSync(path.join(TMP, datei), 'utf8')); } catch (e) { schlecht.push(`${was}: Datei ${datei} nicht lesbar`); continue; }
    const k = text.split(alt).length - 1;
    if (k !== 1) schlecht.push(`${was}: Anker ${k === 0 ? 'nicht gefunden' : k + 'x gefunden'} (${datei})`);
  }
  if (schlecht.length) { console.log(`Anker-Check: ${schlecht.length} von ${MUTATIONEN.length} Mutationen nicht anwendbar:\n  ` + schlecht.join('\n  ')); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } process.exit(2); }
  console.log(`Anker-Check: alle ${MUTATIONEN.length} Anker genau einmal gefunden.`);
  if (process.argv.includes('--trocken')) { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } process.exit(0); }
}

const lauf = ([test, ...arg]) => spawnSync(process.execPath, [test, ...arg], { cwd: TMP, encoding: 'utf8', timeout: 900000 });
let ueberlebt = 0, gelaufen = 0, erkannt = 0, abstuerze = 0;
console.log(`Mutationsprobe Wrack (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of TESTS) {
  const basis = lauf(t);
  console.log(`  Ausgangslage ${t.join(' ')}: ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
}
for (const [datei, alt, neu, was] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  if (text.split(alt).length !== 2) { console.log(`  ?? ${was}: Textstelle nicht eindeutig gefunden (${datei})`); ueberlebt++; continue; }
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  let wer = null, fehler = [], absturz = null;
  for (const t of TESTS) {
    const r = lauf(t);
    if (r.status === 0) continue;
    const fz = ((r.stdout || '').split('\n')).filter((l) => /FEHLER/.test(l) && !/FEHLER Ausnahme/.test(l));
    if (fz.length) { wer = path.basename(t[0], '.js').replace('test-', ''); fehler = fz; break; }
    if (!absturz) absturz = { test: path.basename(t[0], '.js'), text: ((r.stderr || '') + (r.stdout || '')).split('\n').filter((l) => /Error|    at |Ausnahme/.test(l)).slice(0, 1).join(' ').trim().slice(0, 120) || `Exit ${r.status}` };
  }
  fs.writeFileSync(f, orig);
  if (wer) { erkannt++; console.log(`  rot    ${was} (${wer}: ${fehler.length} Fehler, z. B. ${fehler[0].replace(/^\s*FEHLER\s*/, '').slice(0, 64)})`); }
  else if (absturz) { abstuerze++; console.log(`  ABSTURZ ${was} (${absturz.test}: ${absturz.text}) – nicht als erkannt gezaehlt`); }
  else { ueberlebt++; console.log(`  GRUEN  ${was}  <-- UEBERLEBT`); }
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`Ergebnis: ${erkannt} erkannt, ${ueberlebt} ueberlebt, ${abstuerze} Absturz/Syntaxfehler (von ${gelaufen})`);
process.exit(ueberlebt || abstuerze ? 1 : 0);
