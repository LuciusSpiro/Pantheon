'use strict';
// SUND-04a-3: Mutationsprobe zu tools/test-finale-boden.js (Boden-Teil des Finales, Paket SUND-04a-3 Boden). Kopiert Server, Shared, Content und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je
// Lauf EINE Regel und verlangt, dass ein Test mit einer echten Prüfung rot wird (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, SyntaxError, Zeitüberschreitung, keine Prüfzeile) zählt NICHT
// als erkannt: er sagt nichts über die Regel. Überlebt eine Mutation, deckt kein Test die Regel ab.
//   node tools/mutation-finale.js [begriff …] [--trocken]      (npm run test:finale-boden-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-boden-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const TESTS = [['tools/test-finale-boden.js']];
for (const [t] of TESTS) fs.copyFileSync(path.join(ROOT, t), path.join(TMP, t));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const FB = 'server/sim/finale-boden.js', LPF = 'server/sim/landepunkte.js', AK = 'server/sim/anker.js', DB = 'content/welt/finale-boden.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  [FB, "    aw.ankerSperre = Object.assign(aw.ankerSperre || {}, { [ziel.id]: sperrText() });\n", "", 'Schrein-Aktivierung ohne Boss (keine Sperre)'],
  [AK, "    case 'ziel': return z === 'frei' && !(aw.ankerSperre && aw.ankerSperre[a.id]);", "    case 'ziel': return z === 'frei';", 'Schrein-Sperre gilt nicht fuer das Halten'],
  [FB, "  return nach === 'wachen' ? wachen : nach === 'boss_oder_wachen' ? boss || wachen : boss;", "  return true;", 'Freigabe ohne Bedingung'],
  [FB, "  try { Finale().bodenEnde(game, ausgang); } catch (e) { fehler(game, 'finale-boden-ende', e); }", "  try { Finale().bodenEnde(game, ausgang); Finale().bodenEnde(game, ausgang); } catch (e) { fehler(game, 'finale-boden-ende', e); }", 'bodenEnde doppelt gemeldet'],
  [FB, "  return aktiv(game) && S && !S.ende && S.lp === lpId ? null : T.sperrgrund;", "  return null;", 'Landepunkt ohne Finale anwaehlbar'],
  [FB, "  if (!da.length || Endkampf().crewGefallen(game, S.lp)) { ende(game, S, 'crew_gefallen', da.length ? 'gefallen' : 'abbruch'); return; }", "  if (!da.length || Endkampf().crewGefallen(game, S.lp)) { S.ende = 'abbruch'; return; }", 'crew gefallen ohne Meldung'],
  [FB, "  if (!da.length || Endkampf().crewGefallen(game, S.lp)) {", "  if (Endkampf().crewGefallen(game, S.lp)) {", 'Hochbeamen beendet den Boden-Teil nicht'],
  [FB, "gegner: wachenFuer(n), boss: G.boss", "gegner: wachenFuer(1), boss: G.boss", 'Skalierung nach Crewgroesse ignoriert'],
  [FB, "  funk(game, 'bereit');\n  return true;", "  game.rng.int(2);\n  funk(game, 'bereit');\n  return true;", 'game.rng gezogen'],
  [FB, "    if (da.length) { S.gelandet = true; landung(game, S, aw, da.length); }", "    if (da.length) { landung(game, S, aw, da.length); }", 'Gegner bei jedem Tick (Landung nicht gemerkt)'],
  [FB, "    game.transferZiel = { lp: id, scene: ort };\n", "", 'Transferziel nicht gesetzt'],
  [FB, "  if (L.verwerfen(game, S.lp) || !L.eintrag(game, S.lp)) game.finaleBoden = null;", "", 'Aufraeumen fehlt (Landepunkt bleibt)'],
  [FB, "    if (G.alle_abziehen_nach_boss) Endkampf().gegnerAbziehen(game, S.lp, S.tag);", "", 'Wachen ziehen nach dem Waechter nicht ab'],
  [FB, "  if (S.frei && Anker().zustand(game, S.lp, S.ziel) === 'aktiviert') {\n    funk(game, 'schrein');", "  if (S.frei && Anker().zustand(game, S.lp, S.ziel) === 'aktiviert') {\n    funk(game, 'schrein'); ende(game, S, 'crew_gefallen', 'x');", 'Sieg meldet crew_gefallen'],
  [LPF, "if (S.dyn[id] && (S.dyn[id].test || S.dyn[id].fluechtig)) continue;", "if (S.dyn[id] && S.dyn[id].test) continue;", 'Schrein-Landepunkt im Weltstand'],
  [LPF, "    if (d.frei === 'finale' && sperrgrund(game, d.id)) continue;", "", 'Schrein steht ausserhalb des Finales in der Liste'],
  [DB, '"wert": { "1": 4, "2": 6, "3": 8, "4": 10 }', '"wert": { "1": 8, "2": 8, "3": 8, "4": 8 }', 'Daten: Wachen nicht nach Crewgroesse'],
  [DB, '"nach": "boss"', '"nach": "wachen"', 'Daten: Freigabe nach Wachen statt Waechter'],
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
const lauf = ([test, ...arg]) => spawnSync(process.execPath, [test, ...arg], { cwd: TMP, encoding: 'utf8', timeout: 300000 });
// erkannt = rot MIT einer echten FEHLER-Prüfzeile; ein Absturz (FEHLER Ausnahme, SyntaxError, Zeitüberschreitung, nur stderr) ist kein Beleg
const pruefFehler = (r) => ((r && r.stdout) || '').split('\n').filter((l) => /^\s*FEHLER\b/.test(l) && !/^\s*FEHLER Ausnahme/.test(l));
let ueberlebt = 0, gelaufen = 0, abstuerze = 0;
console.log(`Mutationsprobe test-finale-boden.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of TESTS) {
  const basis = lauf(t);
  console.log(`  Ausgangslage ${t.join(' ')}: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
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
  let wer = null, beleg = null, absturz = false;
  for (const t of TESTS) {
    const r = lauf(t);
    if (r.status === 0) continue;
    const fe = pruefFehler(r);
    if (fe.length) { wer = path.basename(t[0], '.js').replace('test-', ''); beleg = fe; break; }
    absturz = true;   // rot ohne Prüfzeile: Absturz, zählt nicht
  }
  fs.writeFileSync(f, orig);
  if (!wer) { ueberlebt++; if (absturz) abstuerze++; }
  console.log(`  ${wer ? 'rot  ' : 'GRÜN '} ${was}${wer ? ` (${wer}: ${beleg.length} Fehler, z. B. ${beleg[0].replace(/^\s*FEHLER\s*/, '').slice(0, 64)})` : (absturz ? '  <-- NUR ABSTURZ, nicht erkannt' : '  <-- ÜBERLEBT')}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) nicht erkannt (davon ${abstuerze} nur Absturz)` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
