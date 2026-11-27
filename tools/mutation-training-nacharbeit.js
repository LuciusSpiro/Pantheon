'use strict';
// TRA-01 Nacharbeit: Mutationsprobe zu tools/test-training-nacharbeit.js und tools/test-training-fliegen.js: je Lauf wird EINE Regel in einer Kopie des Repos (Temp-Verzeichnis, nie im Repo)
// entfernt und der zuständige Test muss rot werden (Exit 1 MIT FEHLER-Zeile). Abstürze (Exit != 0 ohne FEHLER-Zeile) zählen NICHT als erkannt. Vorab: jeder Anker steht genau einmal (Exit 2, wenn nicht).
//   node tools/mutation-training-nacharbeit.js [--trocken] [begriff ...]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-training-nacharbeit-'));
for (const rel of ['server', 'shared', 'content', 'public']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
for (const f of ['test-training-nacharbeit.js', 'test-training-fliegen.js', 'sim-training-captain.js', 'sim-training.js', 'gen-tra-captain.js']) fs.copyFileSync(path.join(ROOT, 'tools', f), path.join(TMP, 'tools', f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
const aufraeumen = () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } };

const TC = 'server/sim/training-captain.js', TR = 'server/sim/training.js', GM = 'server/game.js', BUCH = 'content/regiebuecher/tra_fliegen.regiebuch.json', GEN = 'tools/gen-tra-captain.js';
const NA = 'tools/test-training-nacharbeit.js', FL = 'tools/test-training-fliegen.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, Testdatei]
const MUTATIONEN = [
  [TR, '  buchflagsZuruecksetzen(game);   // enthält FERTIG_FLAG\n', '', 'W1: Neustart setzt die Buchflags nicht zurück', NA],
  [TR, '  buchflagsZuruecksetzen(game);   // enthält FERTIG_FLAG\n', '', 'W1: Neustart setzt die Buchflags nicht zurück (Sim Fliegen, zweiter Versuch)', FL],
  [GM, '    Training.botsNachTrainingRaeumen(this);', '    void 0;', 'W2: Trainings-Bots bleiben in der Lobby', NA],
  [TR, "  require('../bots/spieler.js').alleBotsRaeumen(game);\n", '', 'W2/W3: vorhandene Lobby-Bots werden vor dem Training nicht geräumt', NA],
  [TR, "if (Crew.menschen(game) > 1) { game.refuseStart(", "if (Crew.menschen(game) > 99) { game.refuseStart(", 'W3: zwei Menschen starten das Training', NA],
  [TR, "'sicherheitsstopp', 'reparaturnachlegen'],", "'sicherheitsstopp'],", 'W4: Wächter reparaturnachlegen entfernt (Sackgasse)', NA],
  [GM, "    Training.botsNachTrainingRaeumen(this);", "    Training.botsNachTrainingRaeumen(this); this.lobbyOpts.trainingSprache = false;", 'N1: Sprachwahl wird beim Weg in die Lobby zurückgesetzt', NA],
  [TR, "if (!istTraining(kind) || game.lobbyOpts.world) return true;", "if (!istTraining(kind)) return true;", 'N5: Weltstand gewählt, Training legt trotzdem Bots an', NA],
  [GEN, "hint(50, nicht(bef(V, 'tech.reparieren')), 'h.reparieren')", "hint(50, nicht(alle(bef(V, 'tech.reparieren'), mitQuelle(V, 'repariert'))), 'h.reparieren')", 'N2a: Hinweis h.reparieren hängt wieder am Reparaturerfolg', NA],
  [BUCH, '"at": 90,\n          "if": {\n            "not": {\n              "atLocation": "b7"', '"at": 40,\n          "if": {\n            "not": {\n              "atLocation": "b7"', 'N2b: Hinweis b_schnell wieder nach 40 s', NA],
  [BUCH, '"do": "training_sprungziel",\n          "ziel": "vaelen"', '"do": "training_sprungziel",\n          "ziel": "splitter"', 'W5: Faltsprung der Übung wieder in den Splittergürtel', FL],
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
  if (schlecht.length) { console.log(`Anker-Check: ${schlecht.length} von ${MUTATIONEN.length} Mutationen nicht anwendbar:\n  ` + schlecht.join('\n  ')); aufraeumen(); process.exit(2); }
  console.log(`Anker-Check: alle ${MUTATIONEN.length} Anker genau einmal gefunden.`);
  if (process.argv.includes('--trocken')) { aufraeumen(); process.exit(0); }
}

const lauf = (test) => spawnSync(process.execPath, [test], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
const basen = {};
for (const t of [NA, FL]) {
  basen[t] = lauf(t);
  console.log(`  Ausgangslage ${t}: ${basen[t].status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
  if (basen[t].status !== 0) { console.log((basen[t].stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n') + (basen[t].stderr || '').slice(0, 400)); aufraeumen(); process.exit(1); }
}
let gelaufen = 0, erkannt = 0, ueberlebt = 0, abstuerze = 0;
for (const [datei, alt, neu, was, test] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  const r = lauf(test);
  const fz = (r.stdout || '').split('\n').filter((l) => /FEHLER/.test(l) && !/FEHLER Ausnahme/.test(l));
  if (r.status === 0) { ueberlebt++; console.log(`  UEBERLEBT  ${was}`); }
  else if (fz.length) { erkannt++; console.log(`  erkannt    ${was}  <- ${fz[0].trim().slice(0, 110)}`); }
  else { abstuerze++; console.log(`  ABSTURZ    ${was}  (Exit ${r.status}, zählt nicht)  ${((r.stderr || '') + (r.stdout || '')).split('\n').filter((l) => /Error/.test(l))[0] || ''}`.slice(0, 220)); }
  fs.writeFileSync(f, orig);
}
aufraeumen();
console.log(`\nMUTATION-TRAINING-NACHARBEIT: ${gelaufen} Mutationen, erkannt ${erkannt}, überlebt ${ueberlebt}, Abstürze ${abstuerze}`);
process.exit(ueberlebt || abstuerze ? 1 : 0);
