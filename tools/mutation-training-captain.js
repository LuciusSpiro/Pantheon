'use strict';
// TRA-01 E: Mutationsprobe zu tools/test-training-captain.js (Captain-Training): je Lauf wird EINE Regel in einer Kopie des Repos (Temp-Verzeichnis, nie im Repo) geändert und der Test muss rot werden
// (Exit 1 MIT FEHLER-Zeile). ABSTÜRZE (Exit != 0 ohne FEHLER-Zeile) zählen NICHT als erkannt. Vorab: jeder Anker steht genau einmal im Quelltext (Exit 2, wenn nicht). --trocken prüft nur die Anker.
//   node tools/mutation-training-captain.js [--trocken] [begriff ...]        (npm run test:training-captain-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-training-captain-'));
for (const rel of ['server', 'shared', 'content', 'public']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
for (const f of ['test-training-captain.js', 'sim-training-captain.js', 'gen-tra-captain.js']) fs.copyFileSync(path.join(ROOT, 'tools', f), path.join(TMP, 'tools', f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
const aufraeumen = () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } };

const TC = 'server/sim/training-captain.js', TR = 'server/sim/training.js', TE = 'server/sim/training-erkennung.js', GM = 'server/game.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  [GM, 'if (!Training.botsVorStart(this)) return;', '', 'Bots-Setup entfernt (kein Bot vor dem Start)'],
  [TC, '  e.orbitDir = 0;      // steht still auf dem Ring (space.js dreht den Winkel sonst weiter)\n', '', 'Orbit-Stopp entfernt (die Relais kreisen)'],
  [TC, "if (a && a.absicht && a.absicht.feuer == null) a.feuerSetzen('halt', null);", '', 'Feuer-halt-Start entfernt (Cassius schießt unkommandiert)'],
  [TC, 'if (a && a.absicht && a.absicht.feuer == null)', "if (a && a.absicht && a.absicht.feuer == null && !game.arena.training.erreicht.has('bot_befehl:bot.automatik'))", 'Feuersperre wird nach bot.automatik nicht erneuert (Wächter hält nur den Start)'],
  [TE, "if (typeof d.quelle === 'string') { markieren(game, 'bot_quelle:' + d.quelle); markieren(game, 'bot_befehl:' + d.befehl + ':' + d.quelle); }",
    "if (typeof d.quelle === 'string') { markieren(game, 'bot_quelle:' + d.quelle); for (const q of ['menu', 'taste', 'text', 'sprache']) markieren(game, 'bot_befehl:' + d.befehl + ':' + q); }", 'Quelle nicht geprüft (jeder Befehl zählt über jede Quelle)'],
  [TC, '  Space().helmStop(game);\n', '', 'Sicherheitsstopp entfernt (die Tab-Falle läuft bis an den Rand)'],
  [TR, 'game.explore.vorerkunden(v.hexe, v.kanten);', 'void 0;', 'vorerkunden entfernt (kein Schnellsprung möglich)'],
  [TC, 'function reiseRuheHalten(game) { game._reiseOhne = -1; }', 'function reiseRuheHalten(game) { }', 'Reiseruhe entfernt (Zufallsbegegnung im Schnellsprung möglich)'],
  [TC, 'u.id = uebungszielSpawnen(game, z).id; u.tot = null;', 'u.tot = null;', 'Nachrücken entfernt (nach dem Abschuss bleibt das Ziel weg)'],
  [TC, '  e.ohneBeute = true;  // keine Marken für den Abschuss\n', '', 'Beute nicht unterdrückt (Marken für den Abschuss)'],
  [TR, 'return game.arena.training.sprache && d.buchSprache ? d.buchSprache : d.buch;', 'return d.buch;', 'Variante wählt immer das Tafel-Buch'],
  [TE, "jumped(game) { if (!game.reise) markieren(game, 'sprung'); },", "jumped(game) { markieren(game, 'sprung'); },", 'Hops des Schnellsprungs zählen als normaler Sprung'],
  [TE, "if (typeof st === 'string' && st !== 'ok' && !T.repariere.some((r) => r.system === s))", "if (typeof st === 'string' && !T.repariere.some((r) => r.system === s))", 'Reparatur zählt auch für ein heiles System'],
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

const lauf = () => spawnSync(process.execPath, ['tools/test-training-captain.js'], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
const basis = lauf();
console.log(`Mutationsprobe Captain-Training (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})\n  Ausgangslage: ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); aufraeumen(); process.exit(1); }
let gelaufen = 0, erkannt = 0, ueberlebt = 0, abstuerze = 0;
for (const [datei, alt, neu, was] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  const r = lauf();
  const fz = (r.stdout || '').split('\n').filter((l) => /FEHLER/.test(l) && !/FEHLER Ausnahme/.test(l));
  if (r.status === 0) { ueberlebt++; console.log(`  UEBERLEBT  ${was}`); }
  else if (fz.length) { erkannt++; console.log(`  erkannt    ${was}  <- ${fz[0].trim().slice(0, 110)}`); }
  else { abstuerze++; console.log(`  ABSTURZ    ${was}  (Exit ${r.status}, zählt nicht)  ${((r.stderr || '') + (r.stdout || '')).split('\n').filter((l) => /Error/.test(l))[0] || ''}`.slice(0, 220)); }
  fs.writeFileSync(f, orig);
}
aufraeumen();
console.log(`\nMUTATION-TRAINING-CAPTAIN: ${gelaufen} Mutationen, erkannt ${erkannt}, überlebt ${ueberlebt}, Abstürze ${abstuerze}`);
process.exit(ueberlebt || abstuerze ? 1 : 0);
