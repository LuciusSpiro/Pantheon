'use strict';
// FRE-05: Mutationsprobe zu tools/test-reise-rueckfall-regulaer.js. Kopiert Server, Shared, Content und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel
// (Eintrag mit fünftem Element true: alle Fundstellen) und verlangt, dass der Test rot wird (Exit != 0). Überlebt eine Mutation, deckt kein Test die Regel ab.
//   node tools/mutation-reise-rueckfall-regulaer.js [--trocken] [begriff …]      (npm run test:reise-rueckfall-regulaer-mutation)
//   --trocken: prüft nur, ob jede Textstelle genau einmal gefunden wird (kein Testlauf)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-rueckfall-regulaer-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TEST = 'tools/test-reise-rueckfall-regulaer.js';
fs.copyFileSync(path.join(ROOT, TEST), path.join(TMP, TEST));
fs.copyFileSync(path.join(ROOT, 'tools', 'regie-fixture.js'), path.join(TMP, 'tools', 'regie-fixture.js'));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const BR = 'server/sim/abenteuer-brett.js', SZ = 'server/sim/faden-szene.js', RE = 'server/sim/reise-ereignis.js';
const KOPF = 'function abenteuerRueckfallWeiter(game) {\n  const F = game && game.weltsim && game.weltsim.faeden, l = game && game.lageSpielleiter;\n  if (!F || !l || l.rueckfallBetrieb !== true || ';
// [Datei, alter Text (genau einmal, mit fünftem Element true: mindestens einmal, alle werden ersetzt), neuer Text, Beschreibung]
const MUTATIONEN = [
  [BR, '    if (f.beat < 1) f.zaehler = Math.max(f.zaehler, f.abstand);\n', '', 'a1: Beat 0 uebergeht den Abstand nicht mehr (der Start haengt am Abstand)'],
  [BR, "if (!f.plan || f.notruf || f.phase !== 'wartet') continue;", "if (!f.plan || f.notruf || f.phase !== 'wartet' || f.beat < 1) continue;", 'a2: Beat 0 wird nicht gestartet (wie notrufRueckfallWeiter: der erste Beat gehoert dem Annehmen)'],
  [RE, "  try { require('./abenteuer-brett.js').abenteuerRueckfallWeiter(game); } catch", "  try { } catch", 'a3: der Aufruf in reise-ereignis.js fehlt (nichts fuehrt den regulaeren Faden)'],
  [BR, KOPF, KOPF.replace('l.rueckfallBetrieb !== true || ', ''), 'b: ohne Guard rueckfallBetrieb (Doppeltreiben mit einem Modell)'],
  [BR, "if (!f.plan || f.notruf || f.phase !== 'wartet') continue;", "if (!f.plan || f.phase === 'abgeschlossen') continue;", 'c1: der Rueckfall fuehrt auch laufende Beats (wartet nicht auf das Szenenende) und Notruf-Faeden'],
  [BR, "if (!f.plan || f.notruf || f.phase !== 'wartet') continue;", "if (!f.plan || f.phase !== 'wartet') continue;", 'd: ohne f.notruf-Ausschluss (Notruf-Faeden werden angefasst)'],
  [BR, "if (!f.plan || f.notruf || f.phase !== 'wartet') continue;", "if (f.notruf || f.phase !== 'wartet') continue;", 'd2: ohne f.plan-Bedingung (alte Faeden ohne Plan werden angefasst)'],
  [BR, '    if (f.beat >= 1 && f.zaehler < f.abstand) continue;   // nur der erste Beat uebergeht den Abstand\n    if (f.beat < 1) f.zaehler = Math.max(f.zaehler, f.abstand);\n', '    f.zaehler = Math.max(f.zaehler, f.abstand);\n', 'e: der Abstand wird auch bei Beat >= 1 uebersprungen'],
  [SZ, "if (game.fadenWarte && game.fadenWarte.length) game.fadenWarte = game.fadenWarte.filter((it) => laeuft(game, it.fadenId, it.beatId));", '', 'c2: Szenen-Warteschlange raeumt Eintraege beendeter Beats nicht ab (Zombie-Eintrag)'],
  [SZ, "if (!laeuft(game, fs.fadenId, fs.beatId)) { aufraeumen(game, fs); naechsteStarten(game); return; }", "if (!laeuft(game, fs.fadenId, fs.beatId)) { return; }", 'c3: eine Szene, deren Beat die Frist beendet hat, wird nicht aufgeraeumt (Zombie-Szene)'],
  [BR, "if (!r.ok) {\n      if (!rueckfallAbgelehnt.has(f)) rueckfallAbgelehnt.set(f, new Set());\n      rueckfallAbgelehnt.get(f).add(f.beat);\n", "if (!r.ok) {\n", 'f: eine Ablehnung wird nicht gemerkt (Fehler in jedem Takt)'],
];

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const TROCKEN = process.argv.includes('--trocken');
const lauf = () => spawnSync(process.execPath, [TEST], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
let ueberlebt = 0, gelaufen = 0;
console.log(`Mutationsprobe test-reise-rueckfall-regulaer.js (${MUTATIONEN.length} Mutationen${TROCKEN ? ', trocken' : ''}, Kopie in ${TMP})`);
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
