'use strict';
// SUND-02b C: Mutationsprobe zu tools/test-werft-rang.js und test-werft-ui.js. Kopiert Server, Shared, Content, Client und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE
// Regel und verlangt, dass test-werft-rang.js rot wird (Exit != 0). Überlebt eine Mutation, deckt der Test die Regel nicht ab.
//   node tools/mutation-werft-rang.js [--trocken]          (npm run test:werft-rang-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-mut-'));
const TESTS = ['test-werft-rang.js', 'test-werft-ui.js'];   // Server-/Daten-Mutationen: test-werft-rang, Terminal-Mutationen: test-werft-ui; rot, wenn EINER der beiden rot wird
const laufe = () => { let r = null; for (const t of TESTS) { r = spawnSync(process.execPath, ['tools/' + t], { cwd: TMP, encoding: 'utf8', timeout: 600000 }); if (r.status !== 0) return r; } return r; };
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
for (const t of TESTS) fs.copyFileSync(path.join(ROOT, 'tools', t), path.join(TMP, 'tools', t));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  ['server/sim/werft.js', 'if (bed && !istFrei(game, art, id)) return bed;', 'if (bed) return bed;', 'Rang auch beim Anwenden einer gekauften Stufe verlangt'],
  ['server/sim/werft.js', 'if (bed && !istFrei(game, art, id)) return bed;', '', 'Rang wird beim Kauf nie geprüft'],
  ['server/sim/werft.js', 'const e = ortPruefen(game) || freischaltenPruefen(game, art, id);', 'const e = freischaltenPruefen(game, art, id) || ortPruefen(game);', 'Reihenfolge der Gründe: Rang vor Ort'],
  ['server/sim/werft.js', "istFrei(game, 'stufe', i) ? null : rangVerlangt(game, 'stufe', i)", "rangVerlangt(game, 'stufe', i)", 'Snapshot: Sperre auch für Gekauftes'],
  ['server/sim/werft.js', 'if (Object.keys(sp).length) out.sperre = sp;', '', 'Snapshot liefert keinen Grund'],
  ['server/sim/werft.js', 'Ruf.rangName(r) })) : null;', 'r })) : null;', 'Fehlertext mit Rang-Id statt Rangname'],
  ['server/sim/ruf.js', ">= verlangt;", "> verlangt;", 'rufErreicht: > statt >='],
  ['server/sim/ruf.js', 'if (!game.weltsim) return true;   // kein Ruf-System', 'if (!game.weltsim) return false;   // kein Ruf-System', 'Kampagne: Rang-Bedingung gilt als verfehlt'],
  ['shared/config.js', "stufe: { 2: 'centurio', 3: 'tribun' }", "stufe: { 3: 'tribun' }", 'Daten: Stufe 2 ohne Rangbindung'],
  ['shared/config.js', "stufe: { 2: 'centurio', 3: 'tribun' }", "stufe: { 2: 'centurio', 3: 'centurio' }", 'Daten: Stufe 3 schon ab Centurio'],
  ['shared/config.js', "stufe: { 2: 'centurio', 3: 'tribun' }", "stufe: { 1: 'optio', 2: 'centurio', 3: 'tribun' }", 'Daten: auch Stufe 1 am Rang'],
  ['shared/config.js', 'stufe: { 1: 100, 2: 180, 3: 900 },', 'stufe: { 1: 100, 2: 170, 3: 900 },', 'Daten: Preis Stufe 2 geändert'],
  ['shared/config.js', 'modul: { werkstatt: 40 },', 'modul: { werkstatt: 30 },', 'Daten: Modulpreis geändert'],
  ['content/flotte/ruf.json', '"stufe_grund": "Rang {rang} nötig"', '"stufe_grund": "Rang {rang} fehlt"', 'Text: Grund anders formuliert'],
  ['content/flotte/ruf.json', '"stufe_fehler": "{name} braucht den Rang {rang}."', '"stufe_fehler": "Dafür fehlt der Rang."', 'Text: Fehlermeldung ohne Stufe und Rang'],
  ['server/sim/ruf.js', 'if (!game.weltsim) return true;   // kein Ruf-System', 'if (!game.weltsim && !game.arena && !game.labor) return true;   // kein Ruf-System', 'Rang greift auch in Arena und Labor'],
  ['server/sim/ruf.js', 'if (!t) return String(', 'if (false) return String(', 'Textdatei fehlt: leerer Grund statt Rückfall'],
  ['public/js/terminal-ui.js', "else if (L.sperre[ziel]) grund = L.sperre[ziel]; else if (fehlt(preis, L.marks)) grund = fehlt(preis, L.marks); else if (!bedienbar) grund = 'Zuschauer bedienen nicht'; else if (wartet) grund = 'Warte auf den Server …';\n      const danach", "else if (fehlt(preis, L.marks)) grund = fehlt(preis, L.marks); else if (!bedienbar) grund = 'Zuschauer bedienen nicht'; else if (wartet) grund = 'Warte auf den Server …';\n      const danach", 'UI Platzansicht: Rang-Grund am Hauptknopf entfällt'],
  ['public/js/terminal-ui.js', "else if (L.sperre[ziel]) grund = L.sperre[ziel]; else if (fehlt(preis, L.marks)) grund = fehlt(preis, L.marks); else if (!bedienbar) grund = 'Zuschauer bedienen nicht'; else if (wartet) grund = 'Warte auf den Server …';\n      m.aktionen", "else if (fehlt(preis, L.marks)) grund = fehlt(preis, L.marks); else if (!bedienbar) grund = 'Zuschauer bedienen nicht'; else if (wartet) grund = 'Warte auf den Server …';\n      m.aktionen", 'UI Ausbauansicht: Rang-Grund am Hauptknopf entfällt'],
  ['public/js/terminal-ui.js', "L.sperre[ziel] && !voll ? hinweis(L.sperre[ziel], 'warn') : hinweis(preis", "hinweis(preis", 'UI: Hinweiszeile ohne Rang-Grund'],
  ['public/js/pult-terminal-tokens.js', "(st.sperre ? '! ' : '')", "''", 'Zeichnung: kein "!" an gesperrter Kachel'],
  ['public/js/pult-terminal-tokens.js', "hat ? 'modul' : st.sperre ? 'warn' : 'preis'", "hat ? 'modul' : 'preis'", 'Zeichnung: gesperrter Preis nicht in Warnfarbe'],
  ['public/js/pult-terminal-tokens.js', "if (s.sperre) {   // Grund der gesperrten Stufe", "if (false) {   // Grund der gesperrten Stufe", 'Zeichnung: Grundzeile im Block entfällt'],
];

// --trocken: nur der Anker-Check (jeder Anker genau einmal im Quelltext der Kopie, sonst Exit 2); die Tests laufen nicht
if (process.argv.includes('--trocken')) {
  const schlecht = [];
  for (const [datei, alt, neu, was, zusatz] of MUTATIONEN) {
    let text;
    try { text = fs.readFileSync(path.join(TMP, datei), 'utf8').replace(/\r\n/g, '\n'); } catch (e) { schlecht.push(was + ': Datei fehlt (' + datei + ')'); continue; }
    const n = text.split(alt).length - 1;
    if (n !== 1) { schlecht.push(was + (n === 0 ? ': Anker nicht gefunden' : ': Anker ' + n + 'x gefunden') + ' (' + datei + ')'); continue; }
    if (Array.isArray(zusatz) && !text.replace(alt, () => neu).includes(zusatz[0])) schlecht.push(was + ': zweiter Anker nicht gefunden (' + datei + ')');
  }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
  if (schlecht.length) { console.log(`Anker-Check: ${schlecht.length} von ${MUTATIONEN.length} Mutationen nicht anwendbar:\n  ` + schlecht.join('\n  ')); process.exit(2); }
  console.log(`Anker-Check: alle ${MUTATIONEN.length} Anker genau einmal gefunden.`);
  process.exit(0);
}

let ueberlebt = 0;
console.log(`Mutationsprobe test-werft-rang.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
const basis = laufe();
console.log(`  Ausgangslage (unverändert): ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n')); process.exit(1); }
for (const [datei, alt, neu, was, zusatz] of MUTATIONEN) {
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  if (text.split(alt).length !== 2) { console.log(`  ?? ${was}: Textstelle nicht eindeutig gefunden (${datei})`); ueberlebt++; continue; }
  const mut = text.replace(alt, () => neu);
  const mut2 = zusatz ? mut.replace(zusatz[0], () => zusatz[1]) : mut;
  fs.writeFileSync(f, nl ? mut2.replace(/\n/g, '\r\n') : mut2);
  const r = laufe();
  fs.writeFileSync(f, orig);
  const rot = r.status !== 0;
  const fehler = (r.stdout || '').split('\n').filter((l) => /FEHLER/.test(l));
  if (!rot) ueberlebt++;
  console.log(`  ${rot ? 'rot  ' : 'GRÜN '} ${was}${rot ? ` (${fehler.length} Fehler, z. B. ${(fehler[0] || 'Absturz').replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : '  <-- ÜBERLEBT'}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} Mutation(en) überlebt` : 'alle Mutationen erkannt');
process.exit(ueberlebt ? 1 : 0);
