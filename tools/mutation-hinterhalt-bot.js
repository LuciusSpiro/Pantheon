'use strict';
// BEA-03 B: Mutationsprobe zu tools/test-hinterhalt-bot.js (Bot-Laeufe des Beats hinterhalt am echten Server). Kopiert Server, Shared, Content, public und die Werkzeuge in ein Temp-Verzeichnis (das Repo bleibt unberuehrt),
// aendert dort je Lauf EINE Regel und verlangt, dass der Test fuer den zugehoerigen Fall rot wird (Exit 1 MIT FEHLER-Zeile). ABSTUERZE (Exit != 0 ohne FEHLER-Zeile) zaehlen NICHT als erkannt. Der Selbstcheck vorab verlangt,
// dass jeder Anker genau einmal im Quelltext steht (Exit 2, wenn nicht). --trocken prueft nur die Anker. Jede Mutation faehrt nur ihren Fall (--fall), die Ausgangslage zwei Faelle: je Fall ein echter Server-Lauf (rund 10 bis 20 s).
//   node tools/mutation-hinterhalt-bot.js [--trocken] [begriff ...]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-hinterhalt-bot-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'public'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
kopiere('tools/lib');
for (const f of ['tools/spiel-hinterhalt.js', 'tools/test-hinterhalt-bot.js', 'tools/gegner-testhilfe.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const HHJ = 'server/sim/faden-hinterhalt.js', SZ = 'server/sim/faden-szene.js', RS = 'server/sim/reise.js', SW = 'content/faeden/szenen-werte.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, Fall des Tests]
const MUTATIONEN = [
  [HHJ, "return f ? fmt(T.schnellsprung_hinterhalt, { ort: hexName(hex) }) : null;", 'return null;', 'kein Halt: der Hinterhalt haelt den Schnellsprung nie an (Modul)', 'schnell-gelungen-1'],
  [RS, "const halt = befreiungHalt(game, next) || hinterhaltHalt(game, next);", "const halt = befreiungHalt(game, next);", 'kein Halt: reise.js fragt den Hinterhalt nicht', 'schnell-flucht-3'],
  [RS, "if (halt) return stop(game, halt);", "if (halt && !abfangen(game, next)) return stop(game, halt);", 'Halt NACH dem Zufalls-Abfangen (alte Reihenfolge): Zufalls-Jaeger und Szene zugleich', 'schnell-gelungen-1'],
  [SW, '"ring": 300, "vorlauf_s": 0', '"ring": 300, "vorlauf_s": 10', 'Daten: der Hinterhalt hat 10 s Vorlauf (die Gegner stehen nicht im Takt der Meldung)', 'schnell-flucht-3'],
  [SZ, '? nachCrew(W[it.art].anzahl, crewN(game)) : 1;', '? nachCrew(W[it.art].anzahl, 3) : 1;', 'Zahl der Gegner immer fuer Crew 3', 'schnell-gelungen-1'],
  [HHJ, "if (beat && f.laufend.hex === hier) ankunft(game, f, beat);", "if (false) ankunft(game, f, beat);", 'Ankunft per Takt loest nie aus (der Einzelsprung in den Sektor bleibt folgenlos)', 'einzel-frist-1'],
  [HHJ, "beatVon(x) && x.laufend.hex === hex)", "beatVon(x))", 'Halt an jedem Sektor, solange ein Hinterhalt wartet (nicht nur an seinem)', 'fremd-3'],
  [SZ, "enden(game, game.fadenSzene, 'gescheitert', 'szenenwechsel');", "enden(game, game.fadenSzene, 'gelungen', 'szenenwechsel');", 'Flucht (Szenenwechsel) gilt als gelungen', 'schnell-flucht-3'],
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

const lauf = (fall) => spawnSync(process.execPath, ['tools/test-hinterhalt-bot.js', '--fall', fall], { cwd: TMP, encoding: 'utf8', timeout: 900000 });
let ueberlebt = 0, gelaufen = 0, erkannt = 0, abstuerze = 0;
console.log(`Mutationsprobe Hinterhalt-Bot (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
{
  const basis = lauf('einzel-frist-1,fremd-3');
  console.log(`  Ausgangslage (einzel-frist-1, fremd-3): ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
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
