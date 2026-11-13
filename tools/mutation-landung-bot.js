'use strict';
// FAB-01 C: Mutationsprobe zu tools/test-landung-bot.js (Bot-Laeufe des Beats landung am echten Server). Kopiert Server, Shared, Content, public und die Werkzeuge in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf
// EINE Regel und verlangt, dass der Test fuer den zugehoerigen Fall rot wird (Exit 1 MIT FEHLER-Zeile). ABSTUERZE (Exit != 0 ohne FEHLER-Zeile) zaehlen NICHT als erkannt. Der Selbstcheck vorab verlangt, dass jeder Anker genau einmal
// im Quelltext steht (Exit 2, wenn nicht). --trocken prueft nur die Anker. Jede Mutation faehrt nur ihren Fall (--fall), die Ausgangslage zwei Faelle: je Fall ein echter Server-Lauf (rund 20 s).
//   node tools/mutation-landung-bot.js [--trocken] [begriff ...]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-landung-bot-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'public'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
kopiere('tools/lib');
for (const f of ['tools/spiel-landung.js', 'tools/test-landung-bot.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const GA = 'server/game.js', FL = 'server/sim/faden-landung.js', AO = 'server/sim/abenteuer-orte.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, Fall des Tests]
const MUTATIONEN = [
  [GA, 'if (this.weltsim) { try { FadenBoden.ereignis(this, { name, data }); }', 'if (false) { try { FadenBoden.ereignis(this, { name, data }); }', 'Haken in game.missionEvent (Verteiler) aus: der Beat erfaehrt nichts vom Boden', 'raeuber-1'],
  [FL, 'if (niemandUnten(game, lp)) untenGewesen.delete(faden); else untenGewesen.add(faden);', 'untenGewesen.add(faden);', 'Beat-Ausgang "unten gewesen" ohne Landung: der Start gilt immer als unten gewesen (gelungen, ohne dass jemand runter war)', 'ruhig-1'],
  [AO, 'function ortAbraeumen(game, id) {', 'function ortAbraeumen(game, id) {\n  return false;', 'Abraeumen weg: der Ort bleibt nach dem Faden-Ende stehen', 'ruhig-1'],
  [FL, 'const besetzungVon = (beat) => WERTE.besetzung.wert[besetzungsSchluessel(beat)];', 'const besetzungVon = () => WERTE.besetzung.wert[WERTE.besetzung_standard.wert];', 'Besetzung immer ruhig: der Belagerer-Lauf zeigt zu wenige Gegner', 'belagerer-1'],
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

const lauf = (fall) => spawnSync(process.execPath, ['tools/test-landung-bot.js', '--fall', fall], { cwd: TMP, encoding: 'utf8', timeout: 900000 });
let ueberlebt = 0, gelaufen = 0, erkannt = 0, abstuerze = 0;
console.log(`Mutationsprobe Landung-Bot (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
{
  const basis = lauf('belagerer-1,frist');
  console.log(`  Ausgangslage (belagerer-1, frist): ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
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
