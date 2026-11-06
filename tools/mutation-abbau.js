'use strict';
// GEL-03 A1: Mutationsprobe zu tools/test-abbau.js. Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel
// und verlangt, dass der Test mit einer echten Prüfung rot wird (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, keine Prüfzeile) zählt NICHT als erkannt.
//   node tools/mutation-abbau.js [begriff …] [--trocken]      (npm run test:abbau-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet.
// Einträge mit 5. Element true sind als gleichwertig begründet (keine Beobachtung möglich) und müssen überleben.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-abbau-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
for (const rel of ['server', 'shared', 'content']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const TEST = 'tools/test-abbau.js';
fs.copyFileSync(path.join(ROOT, TEST), path.join(TMP, TEST));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
for (const rel of ['public', 'node_modules']) { if (fs.existsSync(path.join(ROOT, rel))) { try { fs.symlinkSync(path.join(ROOT, rel), path.join(TMP, rel), 'junction'); } catch (e) { /* kein Modul nötig */ } } }

const AN = 'server/sim/anker.js', LP = 'server/sim/landepunkte.js', IN = 'server/sim/interior.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, gleichwertig?]
const MUTATIONEN = [
  // ---- Treffer-Abbruch
  [AN, "    p.hold = null;   // wie die Falle: kein Fortschritt gemerkt, Abbau von vorn; der andere Spieler kann sofort übernehmen\n", "", 'Treffer: Hold wird nicht beendet'],
  [AN, "  } else if (h.kind === 'anker:abbau') {\n    p.hold = null;", "  } else if (false) {\n    p.hold = null;", 'Treffer: Abbau-Zweig in onTreffer fehlt'],
  [AN, "    if (game.notice) game.notice(p, 'Getroffen – der Abbau ist unterbrochen.');", "", 'Treffer: Meldung fehlt'],
  [AN, "      if (b || z === 'laeuft') abbauAbbrechen(game, aw.map, a.id, null);", "", 'Tick: laeuft ohne Halter fällt nicht auf da zurück'],
  [AN, "  delete lauf(aw).abbau[id];\n  if (zustandIn(aw, k, id) === 'laeuft') setzen(game, map, id, 'da', pid || null);", "  delete lauf(aw).abbau[id];", 'abbauAbbrechen setzt nicht auf da (der Tick holt es nach)'],
  // ---- Exklusivität
  [AN, "  return abbauHaelt(game.players.find((q) => q.id === b.pid), id);", "  return false;", 'Exklusivität: ein zweiter Halter wird nie erkannt'],
  [AN, "  if (!b || b.pid === p.id) return false;", "  if (!b) return false;", 'Exklusivität: der Halter gilt sich selbst als „anderer“'],
  [AN, "  return abbauHaelt(game.players.find((q) => q.id === b.pid), id);", "  return true;", 'Exklusivität: ein verwaister Halter-Eintrag blockiert für immer (keine Übernahme)'],
  [AN, " && !p.downed && !abbauHalterAnderer(game, p, a.id);   // erster Halter gewinnt", " && !p.downed;   // erster Halter gewinnt", 'holdValid lässt den zweiten Halter gelten (gleichzeitiger Vollzug)'],
  [AN, "  if (abbauHalterAnderer(game, p, a.id)) return;\n  const L = lauf(aw);\n  delete L.abbau[a.id];", "  const L = lauf(aw);\n  delete L.abbau[a.id];", 'abbauFertig prüft den Halter nicht (holdValid und Zustand schützen)', true],   // gleichwertig: ein zweiter Vollzug scheitert am Zustand abgebaut
  [AN, "  if (z !== 'da' && z !== 'laeuft') return;\n  if (abbauHalterAnderer(game, p, a.id)) return;", "  if (abbauHalterAnderer(game, p, a.id)) return;", 'abbauFertig prüft den Zustand nicht (zweiter Abbau derselben Ader)'],
  [AN, "        if (z === 'da' || z === 'laeuft') { if (abbauHalterAnderer(game, p, a.id)) block('Dort wird schon abgebaut.'); else it({ op: 'abbauen' }); }", "        if (z === 'da' || z === 'laeuft') it({ op: 'abbauen' });", 'Angebot: kein Block bei fremdem Halter'],
  // ---- Zustände und Angebot
  [AN, "        else if (z === 'abgebaut') block('Die Ader ist erschöpft.');", "        else block('Die Ader ist erschöpft.');", 'leer bietet einen Hinweis an'],
  [AN, "  if (z === 'da') setzen(game, aw.map, a.id, 'laeuft', p.id);\n  if (neu) {", "  if (neu) {", 'Start setzt den Zustand laeuft nicht'],
  [AN, "  setzen(game, aw.map, a.id, 'abgebaut', p.id);\n  const m = abbauMenge", "  const m = abbauMenge", 'Abschluss setzt abgebaut nicht'],
  [AN, "  game.emit('abbauFertig', d); game.missionEvent('abbauFertig', d);", "  game.emit('abbauFertig', d);", 'Missionsereignis abbauFertig fehlt'],
  [AN, "  if (rolle === 'abbau') return Number(H.abbau) || 5;", "  if (rolle === 'abbau') return 1;", 'Haltezeit ignoriert CONFIG.anker.halten.abbau'],
  // ---- Lärm
  [AN, "    abbauLaerm(game, aw.map, a, p.id);\n  }\n}", "  }\n}", 'Lärm beim Start fehlt'],
  [AN, "    if (b.t >= takt - 1e-9) { b.t -= takt; abbauLaerm(game, aw.map, a, b.pid); }", "    if (b.t >= takt * 2) { b.t -= takt * 2; abbauLaerm(game, aw.map, a, b.pid); }", 'Lärmtakt doppelt so lang'],
  [AN, "    b.t += dt;\n", "", 'Lärmtakt zählt nicht (kein dt)'],
  // ---- Speichern, Kollision
  [LP, " else if (z[id] === 'laeuft') z[id] = 'da';", "", 'Speichern: laeuft bleibt im Weltstand'],
  [IN, "(kand || (kand = [])).push({ id: a.id, kachel: a.y * k.w + a.x, abbau: true });", "{ /* keine Kollision */ }", 'Erzader hat keine Kollisionsbox'],
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
  if (schlecht.length) { console.log(`Anker-Check: ${schlecht.length} von ${MUTATIONEN.length} Mutationen nicht anwendbar:\n  ` + schlecht.join('\n  ')); process.exit(2); }
  console.log(`Anker-Check: alle ${MUTATIONEN.length} Anker genau einmal gefunden.`);
  if (process.argv.includes('--trocken')) process.exit(0);
}

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lauf = () => spawnSync(process.execPath, [TEST], { cwd: TMP, encoding: 'utf8', timeout: 120000 });
// erkannt = rot MIT einer echten FEHLER-Prüfzeile; ein Absturz ist kein Beleg
const pruefFehler = (r) => ((r && r.stdout) || '').split('\n').filter((l) => /^\s*FEHLER\b/.test(l) && !/^\s*FEHLER Ausnahme/.test(l));
let ueberlebt = 0, gelaufen = 0, abstuerze = 0;
console.log(`Mutationsprobe test-abbau.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
const basis = lauf();
console.log(`  Ausgangslage: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
if (basis.status !== 0) { console.log(pruefFehler(basis).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
for (const [datei, alt, neu, was, gleichwertig] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  const r = lauf();
  fs.writeFileSync(f, orig);
  const fe = r.status === 0 ? [] : pruefFehler(r);
  const absturz = r.status !== 0 && !fe.length;
  if (gleichwertig) {   // als gleichwertig eingestuft (keine Beobachtung möglich): muss überleben
    if (fe.length) ueberlebt++;
    console.log(`  ${fe.length ? 'ROT  ' : 'gleich'} ${was} (gleichwertig: ${fe.length ? 'wurde doch erkannt, Einstufung prüfen' : 'überlebt erwartungsgemäß'})`);
    continue;
  }
  if (!fe.length) { ueberlebt++; if (absturz) abstuerze++; }
  console.log(`  ${fe.length ? 'rot  ' : 'GRÜN '} ${was}${fe.length ? ` (${fe.length} Fehler, z. B. ${fe[0].replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : (absturz ? '  <-- NUR ABSTURZ, nicht erkannt' : '  <-- ÜBERLEBT')}`);
}
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) nicht erkannt (davon ${abstuerze} nur Absturz)` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
