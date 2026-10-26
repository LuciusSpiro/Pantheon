'use strict';
// SUND-04a-2 P1: Mutationsprobe zu tools/test-faden-szene.js (und test-faden-zustand.js). Kopiert Server, Shared, Content und die Tests in ein Temp-Verzeichnis
// (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Regel und verlangt, dass mindestens einer der Tests rot wird (Exit != 0). Ueberlebt eine Mutation, deckt kein Test die Regel ab.
// Selbstcheck: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst bricht die Probe mit Exit 2 ab, statt eine Mutation still zu ueberspringen.
// Abstuerze (Syntaxfehler, Ausnahmen ohne FEHLER-Zeile) zaehlen NICHT als erkannt.
//   node tools/mutation-faden-szene.js [begriff ...] [--trocken]      (npm run test:faden-szene-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-szene-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-faden-szene.js'], ['tools/test-faden-zustand.js']];
for (const [t] of TESTS) fs.copyFileSync(path.join(ROOT, t), path.join(TMP, t));
for (const h of ['regie-fixture.js', 'faden-fixture.js']) fs.copyFileSync(path.join(ROOT, 'tools', h), path.join(TMP, 'tools', h));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const SZ = 'server/sim/faden-szene.js', FR = 'server/sim/faden-fracht.js', FA = 'server/sim/faden.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  [SZ, 'const frei = (game) => !game.simSzene && !game.fadenSzene', 'const frei = (game) => !game.fadenSzene', 'Szene startet bei laufender Sim-Szene'],
  [SZ, '  else if (game.simSzene && game.fadenSzene) unterbrechen(game, game.fadenSzene);', '  else if (false) unterbrechen(game, game.fadenSzene);', 'Sim-Szene unterbricht die Faden-Szene nicht'],
  [SZ, '  Faden.beatZurueck(game, fs.fadenId);\n  funk(game, T.unterbrochen);', "  Faden.beatAusgang(game, fs.fadenId, 'gescheitert');\n  funk(game, T.unterbrochen);", 'Unterbrechung scheitert den Beat statt ihn wieder anzubieten'],
  [SZ, '  if (game.space.escorts) game.space.escorts = game.space.escorts.filter((q) => q.tag !== h.ally.tag);', '  if (false) game.space.escorts = game.space.escorts.filter((q) => q.tag !== h.ally.tag);', 'Verbündeter bleibt nach dem Gefecht im Raum'],
  [SZ, '  const p = npc ? Faden.chanceSpontanhilfe(npc) : 0;', '  const p = npc ? 0.5 : 0;', 'Chance der Spontanhilfe ignoriert die Haltung'],
  [SZ, '  if (!(wuerfel(game, h.n) < p)) return false;', '  if (!(game.rng.chance(p))) return false;', 'Wurf der Spontanhilfe zieht game.rng statt des eigenen Stroms'],
  [SZ, '  funk(game, fmt(T.vorwarnung[it.art], vars));', '  void vars;', 'Gefahr ohne Vorwarnung per Funk'],
  [SZ, '  const sek = Math.max(W.vorlauf_min_s, W.vorlauf_s);', '  const sek = 2;', 'Vorwarnung unter 8 s'],
  [SZ, '  const C = W[fs.art]; const n = nachCrew(C.anzahl, crewN(game));', '  const C = W[fs.art]; const n = nachCrew(C.anzahl, 1);', 'Gegner nicht nach Crewgroesse skaliert'],
  [SZ, '  if (weg.length) sp.enemies = sp.enemies.filter((e) => !weg.includes(e));', '  if (false) sp.enemies = sp.enemies.filter((e) => !weg.includes(e));', 'Szenenwechsel räumt die Gegner der Szene nicht ab'],
  [SZ, '  andockenEnde(game);\n  Fracht.andocken(game);', '  Fracht.andocken(game);', 'Andocken beendet die laufende Szene nicht'],
  [FR, "  F().beatAusgang(game, f.id, 'gescheitert');   // der Ausgang entfernt die Ware", "  F().beatAusgang(game, f.id, 'gelungen');   // der Ausgang entfernt die Ware", 'verlorene Ware gilt als gelungen'],
  [FA, '  delete f.fracht;   // SUND-04a-2 P1: der Beat ist zu Ende', '  void 0;   // SUND-04a-2 P1: der Beat ist zu Ende', 'Ware bleibt nach dem Ende des Beats an Bord'],
  [FA, '  if (x.fracht !== undefined) {', '  if (false) {', 'Ware geht beim Speichern verloren (Leser)'],
  [FA, "  for (const f of F.liste) if (f.phase === 'laeuft' && D.BEATS[D.vorlage(f.vorlage).beats[f.beat].typ].szene) {", "  for (const f of F.liste) if (false && f.phase === 'laeuft' && D.BEATS[D.vorlage(f.vorlage).beats[f.beat].typ].szene) {", 'Szenen-Beat steht nach dem Laden nicht wieder aus'],
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

const lauf = ([test, ...arg]) => spawnSync(process.execPath, [test, ...arg], { cwd: TMP, encoding: 'utf8', timeout: 900000 });
let ueberlebt = 0, gelaufen = 0, erkannt = 0, abstuerze = 0;
console.log(`Mutationsprobe test-faden-szene.js, test-faden-zustand.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of TESTS) {
  const basis = lauf(t);
  console.log(`  Ausgangslage ${t.join(' ')}: ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
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
    const fz = ((r.stdout || '').split('\n')).filter((l) => /FEHLER/.test(l));
    if (fz.length) { wer = path.basename(t[0], '.js').replace('test-', ''); fehler = fz; break; }
    if (!absturz) absturz = { test: path.basename(t[0], '.js'), text: ((r.stderr || '') + (r.stdout || '')).split('\n').filter((l) => /Error|    at /.test(l)).slice(0, 1).join(' ').trim().slice(0, 120) || `Exit ${r.status}` };
  }
  fs.writeFileSync(f, orig);
  if (wer) { erkannt++; console.log(`  rot    ${was} (${wer}: ${fehler.length} Fehler, z. B. ${fehler[0].replace(/^\s*FEHLER\s*/, '').slice(0, 64)})`); }
  else if (absturz) { abstuerze++; console.log(`  ABSTURZ ${was} (${absturz.test}: ${absturz.text}) – nicht als erkannt gezaehlt`); }
  else { ueberlebt++; console.log(`  GRUEN  ${was}  <-- UEBERLEBT`); }
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`Ergebnis: ${erkannt} erkannt, ${ueberlebt} ueberlebt, ${abstuerze} Absturz/Syntaxfehler (von ${gelaufen})`);
process.exit(ueberlebt || abstuerze ? 1 : 0);
