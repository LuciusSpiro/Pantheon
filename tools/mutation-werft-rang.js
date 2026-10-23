'use strict';
// SUND-02b C: Mutationsprobe zu tools/test-werft-rang.js. Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE
// Regel und verlangt, dass test-werft-rang.js rot wird (Exit != 0). Überlebt eine Mutation, deckt der Test die Regel nicht ab.
//   node tools/mutation-werft-rang.js          (npm run test:werft-rang-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-mut-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'tools', 'test-werft-rang.js'), path.join(TMP, 'tools', 'test-werft-rang.js'));
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
];

let ueberlebt = 0;
console.log(`Mutationsprobe test-werft-rang.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
const basis = spawnSync(process.execPath, ['tools/test-werft-rang.js'], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
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
  const r = spawnSync(process.execPath, ['tools/test-werft-rang.js'], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
  fs.writeFileSync(f, orig);
  const rot = r.status !== 0;
  const fehler = (r.stdout || '').split('\n').filter((l) => /FEHLER/.test(l));
  if (!rot) ueberlebt++;
  console.log(`  ${rot ? 'rot  ' : 'GRÜN '} ${was}${rot ? ` (${fehler.length} Fehler, z. B. ${(fehler[0] || 'Absturz').replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : '  <-- ÜBERLEBT'}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} Mutation(en) überlebt` : 'alle Mutationen erkannt');
process.exit(ueberlebt ? 1 : 0);
