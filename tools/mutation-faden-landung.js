'use strict';
// FAB-01 B: Mutationsprobe zu tools/test-faden-landung.js (Beat landung: Ausgang gelungen, Besetzung nach Variante, Pflicht landeplatz, Abraeumen, Notrueckholung, Notsprung, Merker, Frist, Haken). Kopiert Server, Shared,
// Content, public und die noetigen Tests in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Regel und verlangt, dass der Test rot wird (Exit 1 MIT FEHLER-Zeile). ABSTUERZE (Exit != 0 ohne
// FEHLER-Zeile) zaehlen NICHT als erkannt. Der Selbstcheck vorab verlangt, dass jeder Anker genau einmal im Quelltext steht (Exit 2, wenn nicht). --trocken prueft nur die Anker.
//   node tools/mutation-faden-landung.js [--trocken] [begriff ...]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-faden-landung-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'public'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-faden-landung.js'], ['tools/test-faden-boden.js']];
for (const f of ['tools/test-faden-landung.js', 'tools/test-faden-boden.js', 'tools/regie-fixture.js', 'tools/faden-fixture.js', 'tools/gegner-testhilfe.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const FL = 'server/sim/faden-landung.js', PR = 'server/sim/faden-pruefer.js', FA = 'server/sim/faden.js', RE = 'server/sim/reise-ereignis.js', BO = 'server/sim/faden-boden.js', BT = 'content/faeden/beats.json', AM = 'server/sim/abenteuer-mock.js', PT = 'server/sim/abenteuer-prompt.js', WT = 'content/faeden/boden-werte.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  [FL, 'if (!untenGewesen.has(f) || !niemandUnten(game, lp)) return;', 'if (!niemandUnten(game, lp)) return;', 'Ausgang gelungen ignoriert "unten gewesen" (beamedUp ohne beamedDown beendet den Beat)'],
  [FL, 'if (niemandUnten(game, lp)) ausgang(game, f, \'gelungen\');', 'if (true) ausgang(game, f, \'gelungen\');', 'Pruefung bei Taetigkeit und Tick ignoriert, dass noch jemand unten ist'],
  [FL, 'const besetzungVon = (beat) => WERTE.besetzung.wert[besetzungsSchluessel(beat)];', 'const besetzungVon = () => WERTE.besetzung.wert[WERTE.besetzung_standard.wert];', 'Besetzung nach Variante: immer die Standardbesetzung (ruhig)'],
  [PR, 'if (braucht.landeplatz === true && !(typeof p.landeplatz', 'if (false && braucht.landeplatz === true && !(typeof p.landeplatz', 'Pflicht landeplatz: Pruefer-Regel aus'],
  [FA, 'try { require(\'./abenteuer-orte.js\').abraeumen(game, f.id); } catch (e) { fehlerZaehlen(game, \'abenteuer-orte-ende\', e); }', '', 'Abraeumen: der Aufruf im Faden-Abschluss fehlt (nur der Takt raeumt spaeter)'],
  [FL, 'ev.data.notrueckholung === true ? \'gescheitert\' : \'gelungen\'', '\'gelungen\'', 'Notrueckholung-Auswertung: der Marker wird ignoriert (squadRecall zaehlt als gelungen)'],
  [FL, 'return !!(aw && W.AWAY_MAPS[lp] && aw.besetzt && aw.besetzt[WERTE.besetzung_tag.wert]); };', 'return false; };', 'Besetzungs-Marker: die Karte gilt nie als besetzt (beamedDown besetzt noch einmal)'],
  [FL, '  if (!verlangt(e) || besetztAn(game, lp)) return 0;\n  let n = 0;\n  const stand = Landepunkte().sobaldGeladen(game, lp, ART, () => {\n    if (besetztAn(game, lp)) return;\n    n = Combat().besetzen(game, { map: lp, fraktion: e.fraktion, staerke: e.staerke, haltung: e.haltung, tag: WERTE.besetzung_tag.wert });\n    if (n <= 0) fehlerZaehlen(', '  const ZZ = (globalThis.ZZ = globalThis.ZZ || new WeakMap()); const zs = ZZ.get(game) || (ZZ.set(game, new Set()), ZZ.get(game));\n  if (!verlangt(e) || zs.has(lp)) return 0;\n  let n = 0;\n  const stand = Landepunkte().sobaldGeladen(game, lp, ART, () => {\n    if (zs.has(lp)) return;\n    n = Combat().besetzen(game, { map: lp, fraktion: e.fraktion, staerke: e.staerke, haltung: e.haltung, tag: WERTE.besetzung_tag.wert });\n    if (n > 0) zs.add(lp);\n    if (n <= 0) fehlerZaehlen(', 'Besetzungs-Marker haengt am Spiel statt an der lebenden Karte (ueberlebt reset, Laden und Verdraengen: der Ort bleibt leer)'],
  [FL, 'const untenGewesen = new WeakSet();', 'const IDS = new Set(); const untenGewesen = { has: (f) => IDS.has(f.id), add: (f) => IDS.add(f.id), delete: (f) => IDS.delete(f.id) };', '"unten gewesen" haengt an der Fadenid statt am Faden-Objekt (ueberlebt reset und Laden: falsches gelungen)'],
  [FL, 'if (niemandUnten(game, lp)) untenGewesen.delete(faden); else untenGewesen.add(faden);', 'untenGewesen.delete(faden);', 'Start: "unten gewesen" wird nicht aus dem echten Zustand abgeleitet (Crew steht schon am Platz, kein neues beamedDown)'],
  [FL, 'besetzen(game, beat, lp);   // nachholen (die Karte traegt keine Besetzung: neu gebaut, geladen, verdraengt), sonst nichts', '', 'Nachholen: beamedDown holt die fehlende Besetzung nicht nach'],
  [FL, 'if (ev.name === \'notsprung\') { ausgang(game, f, \'gescheitert\'); return; }', '', 'Notsprung im Beat: der Handler reagiert nicht'],
  [BO, 'personAbgegeben: \'alle\', notsprung: \'alle\' }', 'personAbgegeben: \'alle\' }', 'Verteiler kennt notsprung nicht'],
  [FL, 'if (!lp || map !== lp) return;', 'if (!lp) return;', 'Handler prueft die Karte nicht (Ereignisse eines anderen Ortes des Fadens zaehlen)'],
  [FL, 'Boden.anmelden(ART, handler);', '', 'Handler nicht am Verteiler angemeldet'],
  [FA, 'try { require(\'./faden-landung.js\').nachTaetigkeit(game); }', 'try { void 0; }', 'Haken bei der Taetigkeit (faden.taetigkeit) fehlt'],
  [RE, 'try { require(\'./faden-landung.js\').update(game); }', 'try { void 0; }', 'Haken im Tick (reise-ereignis.update) fehlt'],
  [BT, '"frist": 12,\n      "braucht": {"nsc_status": ["aktiv", "verbuendet", "gefangen"], "landeplatz": true},', '"braucht": {"nsc_status": ["aktiv", "verbuendet", "gefangen"], "landeplatz": true},', 'Katalog: keine eigene frist (es gilt beat_frist)'],
  [AM, '&& !(D.BEATS[t].braucht && D.BEATS[t].braucht.landeplatz === true));', ');', 'Mock nimmt Beats mit braucht.landeplatz nicht aus planbar aus (Wuerfelreihe aendert sich)'],
  [PT, 'br.landeplatz === true ? \'Pflicht: landeplatz\' : null, ', '', 'Katalogzeile nennt die Pflicht landeplatz nicht'],
  [BT, '"zweck": "Die Crew landet an einem Ort des Plans, beamt runter und wieder hoch; unten ruhig, Raeuber oder Belagerer.",', '"zweck": "Die Crew landet an einem Ort des Plans, beamt runter und wieder hoch; unten ruhig, Raeuber oder Belagerer, ' + 'mit einer viel zu langen Beschreibung. '.repeat(4) + '",', 'Katalogzeile laenger als 400 Zeichen'],
  [WT, '"belagerer": { "fraktion": "raubzug", "staerke": "mittel", "haltung": "wach" }', '"belagerer": { "fraktion": "rostmeute", "staerke": "klein", "haltung": "wach" }', 'Daten: belagerer mit anderer Fraktion (rostmeute statt raubzug; rot ueber die Fraktionspruefung, nicht ueber die Staerke)'],
  [WT, '"belagerer": { "fraktion": "raubzug", "staerke": "mittel", "haltung": "wach" }', '"belagerer": { "fraktion": "raubzug", "staerke": "klein", "haltung": "wach" }', 'Daten: belagerer nur klein (gleiche Staerke wie raeuber: der Belagerer ist nicht staerker)'],
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
console.log(`Mutationsprobe Landung (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
