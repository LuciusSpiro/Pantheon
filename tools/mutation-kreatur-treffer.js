'use strict';
// MON-01 P2a: Mutationsprobe zu tools/test-kreatur-treffer.js. Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE
// Einhängung oder EINEN Guard und verlangt, dass der Test mit einer echten Prüfung rot wird (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, keine Prüfzeile) zählt NICHT als erkannt.
//   node tools/mutation-kreatur-treffer.js [begriff …] [--trocken]      (npm run test:kreatur-treffer-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-kreatur-treffer-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
for (const rel of ['server', 'shared', 'content']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const TEST = 'tools/test-kreatur-treffer.js';
fs.copyFileSync(path.join(ROOT, TEST), path.join(TMP, TEST));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
for (const rel of ['public', 'node_modules']) { if (fs.existsSync(path.join(ROOT, rel))) { try { fs.symlinkSync(path.join(ROOT, rel), path.join(TMP, rel), 'junction'); } catch (e) { /* kein Modul nötig */ } } }

const CB = 'server/sim/combat.js', SQ = 'server/sim/squad.js', AW = 'server/sim/away.js', KR = 'server/sim/kreatur.js', GR = 'server/sim/graben.js', WE = 'server/sim/wellen.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, gleichwertig?]
const MUTATIONEN = [
  // ---- Treffer-Einhängung
  [CB, "for (const e of kreatur().ziele(game.away)) if (e.alive && !e.asleep) out.push(kaempfer(game, e));", "for (const e of game.away.drones) if (e.alive && !e.asleep) out.push(kaempfer(game, e));", 'Kämpfer-Vertrag: Kreaturen fehlen in waffenWelt.kaempfer (Granate, Lanze, Nahkampf treffen nicht)'],
  [CB, "  if (k.kreatur) kreatur().ausruesten(game, k);", "", 'Kämpfer-Vertrag: ausruesten entfällt (Wunden/Radius/Frontbogen aus Drohnen-Fallbacks)'],
  [CB, "for (const e of kreatur().ziele(aw)) {   // MON-01 P2a: Kreaturen mit eigenem Trefferradius", "for (const e of aw.drones) {", 'Projektil-Schleife kennt Kreaturen nicht'],
  [CB, "const r = e.kreatur ? e.hitRadius : (C.hitRadius && C.hitRadius[e.kind]) || 13;", "const r = (C.hitRadius && C.hitRadius[e.kind]) || 13;", 'Projektil: Trefferradius aus der Drohnen-Tabelle (13 px) statt aus der Kreatur'],
  [AW, "for (const d of require('./kreatur.js').ziele(away)) {", "for (const d of away.drones) {", 'Orbitalschlag trifft keine Kreaturen'],
  [CB, "for (const e of kreatur().ziele(game.away)) {   // MON-01 P2a\n    if (!e.zustand) continue;", "for (const e of game.away.drones) {\n    if (!e.zustand) continue;", 'folgenAbgleich kennt Kreaturen nicht (kein Fall, kein Aufstehen nachgezogen)'],
  [CB, "for (const e of kreatur().ziele(aw)) if (e.alive || (e.liegt", "for (const e of aw.drones) if (e.alive || (e.liegt", 'Wf.update kennt Kreaturen nicht (kein Aufwachen, Ausbluten, Hitze)'],
  // ---- Guards
  [SQ, "  if (e.kreatur) return;   // MON-01 P2a: Kreaturen haben keinen Trupp (sonst Phantom-Trupp, Funkspruch, Zufallsverbrauch)\n", "", 'Guard squad.onEnemyHit entfernt (Phantom-Trupp, Funkspruch)'],
  [SQ, "function onEnemyDown(game, e) {\n  if (e.kreatur) return;   // MON-01 P2a\n", "function onEnemyDown(game, e) {\n", 'Guard squad.onEnemyDown entfernt'],
  [CB, "  if (!e.kreatur) game.missionEvent('droneKilled',", "  game.missionEvent('droneKilled',", 'Guard knockOut: droneKilled auch für Kreaturen'],
  [CB, "  if (!e.kreatur) game.missionEvent('enemyUp',", "  game.missionEvent('enemyUp',", 'Guard stehtAuf: enemyUp auch für Kreaturen'],
  // ---- Kreatur selbst
  [KR, "    if (!k || !K.alive) continue;    // gefallen/liegend", "    if (!k) continue;    // gefallen/liegend", 'kreatur.update: gefallene Kreatur läuft weiter'],
  [KR, "    if (Wf && !Wf.handlungsfaehig(game, K)) continue;", "", 'kreatur.update: betäubte Kreatur läuft weiter'],
  [KR, "    schildRegeneration(game, K, dt);\n", "", 'kreatur.update: Schildregeneration aus dem Datenfeld entfällt'],
  [KR, "  if (game.time - K.lastHitAt < r.verzoegerung) { K.regenT = 0; return; }", "", 'Schildregeneration ohne Verzögerung nach Treffer'],
  [KR, "function ziele(aw) { return aw.kreaturen && aw.kreaturen.length ? aw.drones.concat(aw.kreaturen) : aw.drones; }", "function ziele(aw) { return aw.drones.concat(aw.kreaturen || []); }", 'ziele liefert immer ein neues Array (Referenz-Gleichheit ohne Kreaturen weg)'],
  [KR, "function ziele(aw) { return aw.kreaturen && aw.kreaturen.length ? aw.drones.concat(aw.kreaturen) : aw.drones; }", "function ziele(aw) { return aw.kreaturen && aw.kreaturen.length ? aw.kreaturen.concat(aw.drones) : aw.drones; }", 'ziele: Kreaturen vor Drohnen (Reihenfolge)'],
  [KR, "function raeumen(aw) { if (aw && aw.kreaturen && aw.kreaturen.length) aw.kreaturen = []; }", "function raeumen(aw) { }", 'raeumen tut nichts'],
  // ---- Szenario-Resets
  [GR, "  require('./kreatur.js').raeumen(aw);   // MON-01 P2a: Kreaturen der Karte mit weg\n", "", 'Graben-Start räumt Kreaturen nicht'],
  [WE, "  require('./kreatur.js').raeumen(aw);   // MON-01 P2a\n", "", 'Wellen-Start räumt Kreaturen nicht'],
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
const pruefFehler = (r) => ((r && r.stdout) || '').split('\n').filter((l) => /^\s*FEHLER\b/.test(l) && !/^\s*FEHLER Abschnitt/.test(l));
let ueberlebt = 0, gelaufen = 0, abstuerze = 0;
console.log(`Mutationsprobe test-kreatur-treffer.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
  // Abschnitt-Abbruch durch eine Ausnahme zählt hier als Erkennung nur, wenn zugleich eine Prüfzeile rot ist; sonst Absturz
  const fe = r.status === 0 ? [] : pruefFehler(r);
  const absturz = r.status !== 0 && !fe.length;
  if (gleichwertig) {   // als gleichwertig eingestuft (kein Test beobachtet die Stelle): muss überleben
    if (fe.length) ueberlebt++;
    console.log(`  ${fe.length ? 'ROT  ' : 'gleich'} ${was} (gleichwertig: ${fe.length ? 'wurde doch erkannt, Einstufung prüfen' : 'überlebt erwartungsgemäß (nicht getestet)'})`);
    continue;
  }
  if (!fe.length) { ueberlebt++; if (absturz) abstuerze++; }
  console.log(`  ${fe.length ? 'rot  ' : 'GRÜN '} ${was}${fe.length ? ` (${fe.length} Fehler, z. B. ${fe[0].replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : (absturz ? '  <-- NUR ABSTURZ, nicht erkannt' : '  <-- ÜBERLEBT')}`);
}
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) nicht erkannt (davon ${abstuerze} nur Absturz)` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
