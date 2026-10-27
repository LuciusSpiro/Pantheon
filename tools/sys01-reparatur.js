'use strict';
// SYS-01 Erkundung Frage 4: Reparaturzeiten in der Praxis (Sekunden Sim-Zeit). Echte Wege: onAct (E halten) für flick/swap, repair.start/done für das Minispiel,
// Reparaturliste + Schrauber-Bot (bots.queueRepair) für den Bot. Die Config-Werte repair.damagedToOk / brokenToDamaged werden von KEINEM Code gelesen (Befund), gemessen wird,
// was wirklich passiert. Keine Spielzustände außerhalb der Messung.
//   node tools/sys01-reparatur.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const W = require('../server/world.js');
const interior = require('../server/sim/interior.js');
const Bots = require('../server/sim/bots.js');
const Modul = require('../server/sim/module.js');
const Physics = require('../shared/physics.js');
const { bfs } = require('../server/util.js');
const DT = 1 / CONFIG.tickHz;
const r1 = (v) => Math.round(v * 100) / 100;

function neuesSpiel() {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sys01-rep-'));
  const g = new Game({ noStore: true, worlds: false, seed: 5, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'R0', name: 'R0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' }); g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = [];
  for (let i = 0; i < 5; i++) g.step();
  return g;
}
const zustand = (g, sys) => g.ship.systems[sys];
// Spieler steht neben der Station und hält E (flick / swap), Zeit bis sich der Zustand ändert
function spielerHalten(sys, von, gurt, mitTeil) {
  const g = neuesSpiel(); const p = g.players[0];
  g.ship.systems[sys] = von; if (g.ship.fragile) delete g.ship.fragile[sys];
  if (sys === 'reactor' && von === 'broken') g.ship.reactorCtl.state = 'online';
  p.gear.werkzeuggurt = !!gurt; if (mitTeil) { p.carry = 'ersatzteil'; }
  const st = W.STATIONS.find((s) => s.system === sys);
  const acc = W.accessTiles(W.ship, W.shipWalkable, st.x, st.y)[0];
  const c = W.tileCenter(acc.x, acc.y); p.x = c.x; p.y = c.y; p.zone = 'ship'; p.console = null; p.input.mx = p.input.my = 0;
  const t0 = g.time; interior.onAct(g, p, true);
  const hold = p.hold ? { kind: p.hold.kind, dur: p.hold.dur } : null;
  let t = 0; const before = zustand(g, sys);
  while (t < 30 && zustand(g, sys) === before) { g.step(); t += DT; if (!p.hold) break; }
  return { zeit: g.time - t0, hold, nach: zustand(g, sys) };
}
function minispiel(sys, von, wartezeit) {
  const g = neuesSpiel(); const p = g.players[0];
  g.ship.systems[sys] = von;
  const st = W.STATIONS.find((s) => s.system === sys); const acc = W.accessTiles(W.ship, W.shipWalkable, st.x, st.y)[0];
  const c = W.tileCenter(acc.x, acc.y); p.x = c.x; p.y = c.y; p.zone = 'ship'; p.console = null;
  const e1 = interior.repairCmd(g, p, 'repair.start', { system: sys });
  let t = 0; while (t < wartezeit) { g.step(); t += DT; }
  const e2 = interior.repairCmd(g, p, 'repair.done', { system: sys, errors: 0 });
  return { fehler: e1 || e2 || null, nach: zustand(g, sys), t };
}
// Bot (Reparaturliste): Zeit von der Beschädigung bis zum Zustand, inkl. Laufweg des Schraubers. werkstatt = Modul Werkstatt per Debug 'voll' (zweiter Schrauber)
function botReparatur(syss, von, mode, werkstatt) {
  const g = neuesSpiel();
  if (werkstatt) { const e = Modul.debug(g, ['voll']); if (e) throw new Error(e); for (let i = 0; i < 40; i++) g.step(); }
  for (const s of syss) g.ship.systems[s] = von;
  g.ship.botAuto = false; g.ship.botAutoChosen = true;
  for (const s of syss) { const e = Bots.queueRepair(g, s, mode); if (e) throw new Error(e); }
  const erst = {}, fertig = {}; const t0 = g.time; let t = 0;
  while (t < 150 && Object.keys(fertig).length < syss.length) {
    g.step(); t += DT;
    for (const s of syss) { if (erst[s] == null && zustand(g, s) !== von) erst[s] = g.time - t0; if (fertig[s] == null && zustand(g, s) === 'ok') fertig[s] = g.time - t0; }
  }
  return { erst, fertig, bots: g.bots.length };
}
// Laufweg des Spielers: Konsole -> Zugangskachel der Station (Kacheln, ohne Lifte), Zeit bei Gehen 96 px/s und Rennen ×1,33
function laufweg(von, sys) {
  const st = W.STATIONS.find((s) => s.system === sys); const goals = W.accessTiles(W.ship, W.shipWalkable, st.x, st.y);
  const set = new Set(goals.map((q) => q.y * W.ship.w + q.x)); const walk = W.shipWalkableFor(0);
  const path = bfs(walk, von, (x, y) => set.has(y * W.ship.w + x) && walk(x, y), W.ship.w, W.ship.h, null, W.liftLinksFor(0));
  return path ? path.length : null;
}

console.log('Befehl: node tools/sys01-reparatur.js   (Config: repair.damagedToOk ' + CONFIG.repair.damagedToOk + ', brokenToDamaged ' + CONFIG.repair.brokenToDamaged + ', werkzeuggurtFactor ' + CONFIG.repair.werkzeuggurtFactor +
  '; spaceM3.repair ' + JSON.stringify(CONFIG.spaceM3.repair) + ', bot.repairFactor ' + CONFIG.bot.repairFactor + ')');
console.log('\n## Spieler, E halten (Sim-Sekunden bis Zustandswechsel), Station Antrieb/Schilde/Batterie/Reaktor');
console.log('| System | Weg | von | nach | ohne Gürtel s | mit Gürtel s | Halte-Dauer laut Code (ohne/mit) |');
console.log('|---|---|---|---|---|---|---|');
for (const sys of ['reactor', 'shields', 'engines', 'battery_port']) {
  for (const [weg, teil] of [['flick (E)', false], ['swap (Ersatzteil)', true]]) {
    for (const von of ['damaged', 'broken']) {
      const a = spielerHalten(sys, von, false, teil), b = spielerHalten(sys, von, true, teil);
      console.log(`| ${sys} | ${weg} | ${von} | ${a.nach} / ${b.nach} | ${r1(a.zeit)} | ${r1(b.zeit)} | ${a.hold ? a.hold.dur : '—'} / ${b.hold ? b.hold.dur : '—'} |`);
    }
  }
}
console.log('\n## Spieler, Minispiel (repair.start, nach 2,5 s repair.done = Mindestzeit; Gürtel wirkt nicht)');
for (const von of ['damaged', 'broken']) { const m = minispiel('shields', von, 2.5 + 0.05); console.log(`- shields ${von} -> ${m.nach} nach ${r1(m.t)} s${m.fehler ? ' (Meldung: ' + m.fehler + ')' : ''}`); }
{ const m = minispiel('shields', 'broken', 1.0); console.log(`- zu hastig (1,0 s): shields -> ${m.nach} (${m.fehler})`); }
console.log('\n## Schrauber-Bot über die Reparaturliste (Zeit ab Beschädigung inkl. Laufweg, Start an der Ruhebank; Flicken = eine Stufe je Auftrag)');
console.log('| System(e) | von | Modus | Werkstatt | Bots | erste Stufe s | bis ok s |');
console.log('|---|---|---|---|---|---|---|');
for (const [syss, von, mode, ws] of [[['shields'], 'damaged', 'flick', false], [['shields'], 'broken', 'flick', false], [['reactor'], 'broken', 'flick', false], [['engines'], 'broken', 'flick', false], [['battery_port'], 'broken', 'flick', false],
  [['shields'], 'broken', 'part', false], [['reactor', 'shields'], 'broken', 'flick', true], [['shields', 'engines'], 'broken', 'flick', false], [['shields', 'engines'], 'broken', 'flick', true], [['battery_port', 'battery_stbd'], 'broken', 'flick', false], [['battery_port', 'battery_stbd'], 'broken', 'flick', true]]) {
  const r = botReparatur(syss, von, mode, ws);
  console.log(`| ${syss} | ${von} | ${mode} | ${ws ? 'ja' : 'nein'} | ${r.bots} | ${syss.map((k) => k + ' ' + (r.erst[k] != null ? r1(r.erst[k]) : '—')).join('; ')} | ${syss.map((k) => k + ' ' + (r.fertig[k] != null ? r1(r.fertig[k]) : 'nicht in 150 s')).join('; ')} |`);
}

console.log('\n## Laufweg Spieler Technik-Konsole (15,7) und Brücke -> Station (Kacheln; Gehen 3,0 Kacheln/s, Rennen 4,0 Kacheln/s)');
for (const sys of ['reactor', 'shields', 'engines', 'battery_port', 'battery_stbd', 'weapon_bow', 'emitter_bow']) {
  const a = laufweg({ x: 15, y: 7 }, sys), b = laufweg({ x: 33, y: 8 }, sys);
  console.log(`- ${sys}: ab Technik ${a} Kacheln (${a != null ? r1(a / 3) + ' s gehen / ' + r1(a / 4) + ' s rennen' : '—'}), ab Captain ${b} Kacheln (${b != null ? r1(b / 3) + ' s gehen' : '—'})`);
}
