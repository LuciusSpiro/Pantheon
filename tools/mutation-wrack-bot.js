'use strict';
// WRK-01 B: Mutationsprobe zu tools/test-wrack-bot.js (Bot-Laeufe des Beats wrack am echten Server). Kopiert Server, Shared, Content, public und die Werkzeuge in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf
// EINE Regel und verlangt, dass der Test fuer den zugehoerigen Fall rot wird (Exit 1 MIT FEHLER-Zeile). ABSTUERZE (Exit != 0 ohne FEHLER-Zeile) zaehlen NICHT als erkannt. Der Selbstcheck vorab verlangt, dass jeder Anker genau einmal
// im Quelltext steht (Exit 2, wenn nicht). --trocken prueft nur die Anker. Jede Mutation faehrt nur ihren Fall (--fall), die Ausgangslage zwei Faelle: je Fall ein echter Server-Lauf (rund 20 s).
//   node tools/mutation-wrack-bot.js [--trocken] [begriff ...]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-wrack-bot-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'public'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
kopiere('tools/lib');
for (const f of ['tools/spiel-wrack.js', 'tools/test-wrack-bot.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const GA = 'server/game.js', FW = 'server/sim/faden-wrack.js', AO = 'server/sim/abenteuer-orte.js', BO = 'server/sim/faden-boden.js', RA = 'server/sim/faden-boden-rahmen.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, Fall des Tests]
const MUTATIONEN = [
  [GA, 'if (this.weltsim) { try { FadenBoden.ereignis(this, { name, data }); }', 'if (false) { try { FadenBoden.ereignis(this, { name, data }); }', 'Haken in game.missionEvent (Verteiler) aus: der Beat erfaehrt nichts vom Boden', 'ruhig-1'],
  [FW, 'if (R.niemandUnten(game, lp)) untenGewesen.delete(faden); else untenGewesen.add(faden);', 'untenGewesen.add(faden);', 'Start: der Beat gilt immer als unten gewesen (Frist-Lauf: gelungen, ohne dass jemand runter war)', 'frist'],
  [AO, 'function ortAbraeumen(game, id) {', 'function ortAbraeumen(game, id) {\n  return false;', 'Abraeumen weg: der Ort bleibt nach dem Faden-Ende stehen', 'ruhig-1'],
  [FW, "if (ev.name === 'beuteGeborgen')", 'if (false)', 'Beute geborgen wird nicht vermerkt (Funk beim Fund fehlt, Abschlussfunk ohne Beute)', 'ruhig-1b'],
  [FW, "if (ev.name === 'ankerGelesen')", 'if (false)', 'Logbuch gelesen wird nicht vermerkt (Funk beim Logbuch fehlt, Abschlussfunk ohne Logbuch)', 'ruhig-1l'],
  [BO, "  beuteGeborgen: 'karte',   // WRK-01 B: traegt data.map: nur der Faden der Karte", '', 'Verteiler kennt beuteGeborgen nicht', 'ruhig-1b'],
  [RA, '  if (!verlangt(e) || besetztAn(game, lp)) return 0;', '  return 0;', 'Besetzung wird nie ausgefuehrt (raeuber ohne Gegner, auch nicht beim Runterbeamen)', 'raeuber-1'],
  [FW, "'abschluss_' + (x.beute ? 'mit' : 'ohne')", "'abschluss_ohne'", 'Abschlussfunk nennt die Beute nie', 'ruhig-1b'],
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

const lauf = (fall) => spawnSync(process.execPath, ['tools/test-wrack-bot.js', '--fall', fall], { cwd: TMP, encoding: 'utf8', timeout: 900000 });
let ueberlebt = 0, gelaufen = 0, erkannt = 0, abstuerze = 0;
console.log(`Mutationsprobe Wrack-Bot (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
{
  const basis = lauf('ruhig-1,frist');
  console.log(`  Ausgangslage (ruhig-1, frist): ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 8).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
}
for (const [datei, alt, neu, was, fall] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  if (text.split(alt).length !== 2) { console.log(`  ?? ${was}: Textstelle nicht eindeutig gefunden (${datei})`); ueberlebt++; continue; }
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  const r = lauf(fall);
  fs.writeFileSync(f, orig);
  const fz = (r.stdout || '').split('\n').filter((l) => /FEHLER/.test(l) && !/FEHLER Ausnahme/.test(l) && !/^FEHLER: \d+$/.test(l.trim()));
  if (r.status !== 0 && fz.length) { erkannt++; console.log(`  rot    ${was} (Fall ${fall}: ${fz.length} Fehler, z. B. ${fz[0].replace(/^\s*FEHLER\s*/, '').slice(0, 70)})`); }
  else if (r.status !== 0) { abstuerze++; console.log(`  ABSTURZ ${was} (Exit ${r.status}) - nicht als erkannt gezaehlt`); }
  else { ueberlebt++; console.log(`  GRUEN  ${was}  <-- UEBERLEBT`); }
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`Ergebnis: ${erkannt} erkannt, ${ueberlebt} ueberlebt, ${abstuerze} Absturz/Syntaxfehler (von ${gelaufen})`);
process.exit(ueberlebt || abstuerze ? 1 : 0);
