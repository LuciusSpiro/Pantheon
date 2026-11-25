'use strict';
// SPT-02 10: Mutationsprobe zu tools/test-sperrfeuer-guard.js (Sperrfeuer-Guard, space.js updateSperrfeuer). Kopiert Server, Shared, Content, Client-Module und
// den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel und verlangt, dass der Test rot wird (FEHLER-Zeile). Überlebt eine Mutation, deckt
// der Test die Regel nicht ab. Vorher prüft ein Selbstcheck, dass jeder Anker genau einmal vorkommt (sonst Exit 2).
//   node tools/mutation-sperrfeuer-guard.js [begriff …]      (nicht in package.json, nicht in der Kette)
//   node tools/mutation-sperrfeuer-guard.js --trocken         nur die Anker prüfen
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-sperrfeuer-guard-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'public', 'index.html'), path.join(TMP, 'public', 'index.html'));
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
// Test und Hilfsdatei
const TESTS = [['tools/test-sperrfeuer-guard.js']];
for (const f of ['test-sperrfeuer-guard.js', 'gegner-testhilfe.js']) fs.copyFileSync(path.join(ROOT, 'tools', f), path.join(TMP, 'tools', f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const SP = 'server/sim/space.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
// Bewusst nicht in der Liste (äquivalent): die Bedingung M3(game).tele[e.kind] – jede Klasse mit Waffenplätzen und Sperrfeuer (Korvette, Fregatte, Kreuzer) hat eine Ladung.
const MUTATIONEN = [
  [SP, "enemyCanHit(game, e, T, 'lanze') && e.fireT + burstDur", "hatWaffe(game, e, 'lanze') && e.fireT + burstDur", "Guard wie vor SPT-02 10: Lanze irgendwo am Schiff statt im Bogen"],
  [SP, "enemyCanHit(game, e, T, 'lanze') && e.fireT + burstDur", "true && e.fireT + burstDur", "Guard ohne Lanzen-Bedingung"],
  [SP, "e.fireT + burstDur + 0.5 >= teleIv", "e.fireT + burstDur + 0.5 < teleIv", "Guard-Zeitfenster umgekehrt"],
  [SP, "e.fireT + burstDur + 0.5 >= teleIv && dist", "false && dist", "Guard nie"],
  [SP, "<= waffenReichweite(game, cfg.range)) return;", "> waffenReichweite(game, cfg.range)) return;", "Guard-Reichweite umgekehrt"],
  [SP, "enemyCanHit(game, e, T, 'lanze')", "enemyCanHit(game, e, T, 'batterie')", "Bogenprüfung mit der falschen Waffenart"],
];

// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie). Sonst bricht die Probe mit Exit 2 ab.
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
const lauf = ([test, ...arg]) => spawnSync(process.execPath, [test, ...arg], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
// Erkannt = ein Test ist mit FEHLER-Zeilen rot (eine Prüfung schlägt fehl). Ein Lauf ohne FEHLER-Zeile bei Exit != 0 ist ein ABSTURZ (SyntaxError,
// Laufzeitfehler der Mutante): wird getrennt ausgewiesen und NICHT als erkannt gezählt.
const fehlerZeilen = (r) => ((r && r.stdout) || '').split('\n').filter((l) => /FEHLER/.test(l) && !/Ausnahme/.test(l));
let ueberlebt = 0, gelaufen = 0, erkannt = 0, abstuerze = 0;
console.log(`Mutationsprobe test-sperrfeuer-guard.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of TESTS) {
  const basis = lauf(t);
  console.log(`  Ausgangslage ${t.join(' ')}: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l) && !/Ausnahme/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
}
for (const [datei, alt, neu, was] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  if (text.split(alt).length !== 2) { console.log(`  ?? ${was}: Textstelle nicht eindeutig gefunden (${datei})`); ueberlebt++; continue; }
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  let wer = null, fehler = [], absturz = null;
  for (const t of TESTS) {
    const r = lauf(t);
    if (r.status === 0) continue;
    const fz = fehlerZeilen(r);
    if (fz.length) { wer = path.basename(t[0], '.js').replace('test-', ''); fehler = fz; break; }
    if (!absturz) absturz = { test: path.basename(t[0], '.js'), text: ((r.stderr || '') + (r.stdout || '')).split('\n').filter((l) => /Error|    at /.test(l)).slice(0, 1).join(' ').trim().slice(0, 120) || `Exit ${r.status}` };
  }
  fs.writeFileSync(f, orig);
  if (wer) { erkannt++; console.log(`  rot   ${was} (${wer}: ${fehler.length} Fehler, z. B. ${fehler[0].replace(/^\s*FEHLER\s*/, '').slice(0, 64)})`); }
  else if (absturz) { abstuerze++; console.log(`  ABSTURZ ${was} (${absturz.test}: ${absturz.text}) – nicht als erkannt gezählt`); }
  else { ueberlebt++; console.log(`  GRÜN  ${was}  <-- ÜBERLEBT`); }
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`Ergebnis: ${erkannt} erkannt, ${ueberlebt} überlebt, ${abstuerze} Absturz/Syntaxfehler (von ${gelaufen})`);
process.exit(ueberlebt || abstuerze ? 1 : 0);
