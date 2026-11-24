'use strict';
// SPT-02 1: Mutationsprobe zu tools/test-faden-auto-abschluss.js. Kopiert Server, Shared, Content und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel
// und verlangt, dass der Test rot wird (Exit != 0). Überlebt eine Mutation, deckt kein Test die Regel ab.
//   node tools/mutation-faden-auto-abschluss.js [--trocken] [begriff …]
//   --trocken: prüft nur, ob jede Textstelle genau einmal gefunden wird (kein Testlauf)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-faden-auto-abschluss-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TEST = 'tools/test-faden-auto-abschluss.js';
fs.copyFileSync(path.join(ROOT, TEST), path.join(TMP, TEST));
fs.copyFileSync(path.join(ROOT, 'tools', 'regie-fixture.js'), path.join(TMP, 'tools', 'regie-fixture.js'));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const BR = 'server/sim/abenteuer-brett.js', RE = 'server/sim/reise-ereignis.js';
const ZL = "if (!f.plan || f.notruf || f.phase !== 'wartet' || f.beat < 1 || f.zaehler";
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  [BR, '    if (!beat || !B[beat.typ] || !B[beat.typ].abschluss) continue;\n    if (rueckfallAbgelehnt', '    if (!beat) continue;\n    if (rueckfallAbgelehnt', 'a: auch Beats ohne abschluss werden gefuehrt (Eingriff in das Modell-Fuehren)'],
  [BR, "f.notruf || f.phase !== 'wartet' || f.beat < 1 || f.zaehler < f.abstand) continue;\n    const beat", "f.notruf || f.phase !== 'wartet' || f.beat < 1) continue;\n    const beat", 'b: der Abstand wird uebergangen (ABSTAND-Umgehung)'],
  [RE, "  try { require('./abenteuer-brett.js').abenteuerAbschlussWeiter(game); } catch", '  try { } catch', 'c: der Aufruf in reise-ereignis.js fehlt (nichts schliesst den Faden ab)'],
  [BR, ZL, ZL.replace(' || f.notruf', ''), 'd: ohne f.notruf-Ausschluss (Notruf-Faeden werden angefasst)'],
  [BR, ZL, ZL.replace('!f.plan || ', ''), 'e: ohne f.plan-Bedingung (alte Faeden ohne Plan werden angefasst)'],
  [BR, 'function abenteuerAbschlussWeiter(game) {\n  const F = game && game.weltsim && game.weltsim.faeden;\n  if (!F || !Faden().aktiv(game) || !Faden().spielleiterAktiv(game)) return 0;', 'function abenteuerAbschlussWeiter(game) {\n  const F = game && game.weltsim && game.weltsim.faeden;\n  if (!F || !Faden().aktiv(game)) return 0;', 'f: ohne spielleiterAktiv-Guard (Abschluss auch bei Ausfall des Spielleiters)'],
  [BR, 'function abenteuerAbschlussWeiter(game) {\n  const F = game && game.weltsim && game.weltsim.faeden;\n', 'function abenteuerAbschlussWeiter(game) {\n  return 0;\n  const F = game && game.weltsim && game.weltsim.faeden;\n', 'g: die Funktion tut nichts'],
];

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const TROCKEN = process.argv.includes('--trocken');
const lauf = () => spawnSync(process.execPath, [TEST], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
let ueberlebt = 0, gelaufen = 0;
console.log(`Mutationsprobe test-faden-auto-abschluss.js (${MUTATIONEN.length} Mutationen${TROCKEN ? ', trocken' : ''}, Kopie in ${TMP})`);
if (!TROCKEN) {
  const basis = lauf();
  console.log(`  Ausgangslage: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
}
for (const [datei, alt, neu, was, alle] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  const stellen = text.split(alt).length - 1;
  if (alle ? stellen < 1 : stellen !== 1) { console.log(`  ?? ${was}: Textstelle nicht ${alle ? 'gefunden' : 'eindeutig gefunden'} (${datei}, ${stellen}x)`); ueberlebt++; continue; }
  if (TROCKEN) { console.log(`  ok   ${was}: Textstelle gefunden (${stellen}x)`); continue; }
  const neuText = alle ? text.split(alt).join(neu) : text.replace(alt, () => neu);
  fs.writeFileSync(f, nl ? neuText.replace(/\n/g, '\r\n') : neuText);
  const r = lauf();
  fs.writeFileSync(f, orig);
  const rot = r.status !== 0;
  const fehler = (r.stdout || '').split('\n').filter((l) => /FEHLER/.test(l));
  if (!rot) ueberlebt++;
  console.log(`  ${rot ? 'rot  ' : 'GRÜN '} ${was}${rot ? ` (${fehler.length} Fehler, z. B. ${(fehler[0] || 'Absturz').replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : '  <-- ÜBERLEBT'}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) überlebt` : `alle ${gelaufen} Mutationen ${TROCKEN ? 'gefunden (trocken)' : 'erkannt'}`);
process.exit(ueberlebt ? 1 : 0);
