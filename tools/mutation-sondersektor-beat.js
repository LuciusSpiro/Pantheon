'use strict';
// SON-01 B: Mutationsprobe zu tools/test-sondersektor-beat.js. Kopiert Server, Shared, Content, public und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Regel und verlangt, dass der Test
// rot wird (Exit 1 MIT FEHLER-Zeile). ABSTUERZE (Exit != 0 ohne FEHLER-Zeile) zaehlen NICHT als erkannt. Der Selbstcheck vorab verlangt, dass jeder Anker genau einmal im Quelltext steht (Exit 2, wenn nicht). Die Kopie bekommt
// kein node_modules (nichts davon wird gebraucht). --trocken prueft nur die Anker.
//   node tools/mutation-sondersektor-beat.js [--trocken] [begriff ...]      (npm run test:sondersektor-beat-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-sondbeat-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'public'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
for (const f of ['tools/test-sondersektor-beat.js', 'tools/regie-fixture.js', 'tools/faden-fixture.js', 'tools/sprungkette.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));

const SB = 'server/sim/faden-sondersektor.js', BT = 'content/faeden/beats.json', RE = 'server/sim/reise-ereignis.js', AP = 'server/sim/abenteuer-prompt.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, Abschnitte des Tests (--nur), die rot werden muessen]
const MUTATIONEN = [
  [SB, "  if (s.einmal === 'bei_erfolg') {", '  if (false) {', 'Einmaligkeit: nach Erfolg startet das Buch erneut', 'D'],
  [SB, "st.state === 'done' && st.ausgang === 'erfolg') return", "st.state === 'done' && st.ausgang === 'verloren') return", 'Einmaligkeit: sperrt nach Verlust statt nach Erfolg', 'C,D'],
  [SB, "  if (!B1().erreichbar(game, hierHex(game), s.ziel.erreichbar_max).has(s.von)) return", '  if (false) return', 'Erreichbarkeit von Pulverhorn wird nicht geprueft', 'E'],
  [SB, 'hierHex(game), s.ziel.erreichbar_max).has(s.von)', 'hierHex(game), 99).has(s.von)', 'Erreichbarkeit: Sprungzahl aus den Daten wird ignoriert', 'E'],
  [SB, '  if (szeneLaeuft(game)) return', '  if (false) return', 'Szenensperre fehlt (Sim-Szene, Faden-Szene, Gefahr)', 'E'],
  [SB, 'game.simSzene || game.fadenSzene || ', 'game.fadenSzene || ', 'Szenensperre ohne Sim-Szene', 'E'],
  [SB, '  if (m.activeId) return', '  if (false) return', 'Sperre fuer eine andere laufende Mission fehlt', 'E'],
  [SB, "Faden().beatAusgang(game, f.id, gelungen ? 'gelungen' : 'gescheitert');", "Faden().beatAusgang(game, f.id, 'gelungen');", 'Ausgang verloren wird als gelungen gemeldet', 'C'],
  [SB, "Faden().beatAusgang(game, f.id, gelungen ? 'gelungen' : 'gescheitert');", "Faden().beatAusgang(game, f.id, 'gescheitert');", 'Ausgang erfolg wird als gescheitert gemeldet', 'B1'],
  [SB, "Faden().beatAusgang(game, f.id, gelungen ? 'gelungen' : 'gescheitert');", '/* kein Ausgang */', 'der Ausgang wird nie gemeldet', 'B1'],
  [SB, "sagen(game, s, gelungen ? s.funk.erfolg : s.funk.verlust);", "sagen(game, s, gelungen ? s.funk.erfolg : s.funk.verlust); if (!gelungen) mission(game).startMission(s.buch);", 'Ausgang verloren startet das Buch neu', 'C'],
  [SB, "    mission(game).startMission(s.buch);\n    if (mission(game).activeId !== s.buch)", "    if (mission(game).activeId !== s.buch)", 'das Buch wird nie gestartet', 'B1'],
  [SB, '      m.abbrechen();', '      /* Zombie-Buch bleibt */', 'Fristablauf raeumt das Buch nicht ab (Zombie)', 'G'],
  [RE, "try { require('./faden-sondersektor.js').update(game); }", 'try { /* kein Takt */ }', 'der Takt ruft den Baustein nie', 'B1'],
  [BT, '"frist": 15, ', '', 'der Beat hat keine eigene Frist', 'A'],
  [BT, '"frist": 15, ', '"frist": 1, ', 'Frist 1 statt 15: der reale Weg (Spruenge, Andocken) braucht mehr', 'B1'],
  [BT, '"frist": 15, ', '"frist": 3, ', 'Frist knapp unter dem gemessenen Verbrauch (3 statt 15; gemessen 3 bis 5 Taetigkeiten)', 'B1'],
  [BT, '"nur_inszenierer": true, "baustein": "sondersektor"', '"baustein": "sondersektor"', 'der Beat steht im Prompt-Katalog (nur_inszenierer fehlt)', 'A'],
  [AP, ' && B[t].nur_inszenierer !== true)', ')', 'verlegt_ort eines nur_inszenierer-Beats verlaengert den Prompt-Katalog', 'A'],
];

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

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lauf = (nur) => spawnSync(process.execPath, ['tools/test-sondersektor-beat.js'].concat(nur ? ['--nur', nur] : []), { cwd: TMP, encoding: 'utf8', timeout: 900000 });
let ueberlebt = 0, gelaufen = 0, erkannt = 0, abstuerze = 0;
console.log(`Mutationsprobe Sondersektor-Beat (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
const basis = lauf();
console.log(`  Ausgangslage: ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
for (const [datei, alt, neu, was, nur] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  const r = lauf(nur);
  fs.writeFileSync(f, orig);
  const fz = (r.stdout || '').split('\n').filter((l) => /FEHLER/.test(l) && !/Abschnitt abgebrochen/.test(l));
  const abbruch = (r.stdout || '').split('\n').filter((l) => /Abschnitt abgebrochen/.test(l));
  if (r.status !== 0 && fz.length) { erkannt++; console.log(`  rot    ${was} (${fz.length} Fehler, z. B. ${fz[0].replace(/^\s*FEHLER\s*/, '').slice(0, 70)})`); }
  else if (r.status !== 0) { abstuerze++; console.log(`  ABSTURZ ${was} (${(abbruch[0] || r.stderr || 'Exit ' + r.status).slice(0, 120)}) – nicht als erkannt gezaehlt`); }
  else { ueberlebt++; console.log(`  GRUEN  ${was}  <-- UEBERLEBT`); }
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`Ergebnis: ${erkannt} erkannt, ${ueberlebt} ueberlebt, ${abstuerze} Absturz/Syntaxfehler (von ${gelaufen})`);
process.exit(ueberlebt || abstuerze ? 1 : 0);
