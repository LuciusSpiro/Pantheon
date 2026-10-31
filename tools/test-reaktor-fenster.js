'use strict';
// SYS-03 D-Nacharbeit: Regressionstest Reaktor-Fenster (systemModell.reaktorFenster_s, Binär-Prüfung) für Lerche, ALLE Gegnerklassen und Verbündete (Korvette, Fregatte):
// beschädigt -> zerstört dauert beim Reaktor mindestens das Reaktor-Fenster (6,0 s), egal wie dicht die Treffer kommen; Der Torpedo ignoriert das Fenster, die Lanze-Vollladung beachtet es am Reaktor (SYS-03 N1: eine Stufe, im Fenster ein anderes System der Mitte).
// Ein Fenster, das nur für die Lerche (oder nur für Gegner) gilt, macht den Test rot (Mutationsbeleg im Bericht).
//   node tools/test-reaktor-fenster.js
const CONFIG = require('../shared/config.js');
const Schilde = require('../shared/schilde.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Flotte = require('../server/sim/flotte.js');
const Gsys = require('../server/sim/gegnersystem.js');
const I = require('../server/sim/interior.js');
const Th = require('./gegner-testhilfe.js');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const RF = CONFIG.systemModell.reaktorFenster_s;
const TOL = 0.11;   // ein Messschritt (dt 0,1) Toleranz nach oben
let seq = 0;

function lerche() {
  const g = new Game({ noStore: true, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  g.space.enemies = []; g.space.projectiles = []; g.ship.fireList = []; g.ship.breachList = [];
  for (const k of I.SYSTEM_ORDER) g.ship.systems[k] = 'ok';
  g.ship.fragile = {}; g.ship.offline = {}; g.ship.trefferT = {};
  g.ship.shields.current = [0, 0, 0, 0]; Schilde.pause.loeschen(g.ship.shields);
  g.ship.x = 1500; g.ship.y = 800; g.ship.angle = 0; g.ship.docked = false; g.god = false;
  I.integritaetVoll(g);
  return g;
}
function raum() {
  const g = new Game({ noStore: true, seed: 90 + (++seq), debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  const c = { inbox: [], send() {}, sendRaw() {} };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'D0', name: 'D0', color: 0 });
  g.reset(); g.phase = 'play';
  space.enterScene(g, 'splitter', {});
  g.space.enemies = []; g.space.projectiles = []; g.space.asteroids = [];
  g.ship.x = 1500; g.ship.y = 1200; g.god = true;
  return g;
}
// Gegner/Verbündeter: alles außer dem Reaktor zerstört, Schild 0, voller Reaktor
function frisch(e) {
  for (const id of Gsys.ids(e)) { const st = e.sys[id]; st.i = Gsys.maxOf(e, id); st.z = 'ok'; delete st.sp; delete st.imm; delete st.tf; delete st.rp; }
  e.hp = Gsys.summe(e); e.rt = null; delete e.druckZ; e.repSperre = null; Schilde.pause.loeschen(e);
  Th.schildNull(e); e.shieldsMax = e.shieldsMax.map(() => 0);
  for (const id of Gsys.ids(e)) if (Gsys.artVon(e, id) !== 'reaktor') { e.sys[id].i = 0; e.sys[id].z = 'broken'; }
  e.hp = Gsys.summe(e);
}
// Zeit vom ersten Treffer bis Reaktor zerstört (Treffer alle dt s auf Zone, Reaktor in der Mitte)
function messLerche(dt) {
  const g = lerche();
  for (const k of I.SYSTEM_ORDER) if (k !== 'reactor') { g.ship.systems[k] = 'broken'; I.setInteg(g, k, 0); }
  const t0 = g.time;
  for (let i = 0; i < 400; i++) {
    space.shipHit(g, 0, 3, { durchschlag: 'zone' }); g.ship.shields.current = [0, 0, 0, 0];
    if (g.ship.systems.reactor === 'broken') return g.time - t0;
    g.time += dt;
  }
  return null;
}
function messGegner(g, e, dt) {
  frisch(e);
  const t0 = g.time, rid = Gsys.idVon(e, 'reaktor');
  for (let i = 0; i < 400; i++) {
    space.damageEnemy(g, e, 5, e.x + 300, e.y, { durchschlag: 'zone' }); Th.schildNull(e);
    if (e.sys[rid].z === 'broken') return g.time - t0;
    g.time += dt;
  }
  return null;
}
const imBereich = (t) => t != null && t >= RF - 1e-9 && t <= RF + TOL;
const txt = (t) => t == null ? 'nie' : t.toFixed(2) + ' s';

console.log('\n[Reaktor-Fenster: beschädigt -> zerstört nach ' + RF + ' s]');
ok(RF >= 5, 'Konfiguration: reaktorFenster_s = ' + RF + ' (Binär-Prüfung braucht ein spürbares Fenster)');
for (const dt of [0.1, 0.5, 1]) {
  const t = messLerche(dt);
  ok(imBereich(t), 'Lerche, Treffer alle ' + dt + ' s: Reaktor zerstört nach ' + txt(t));
  for (const kind of ['raider', 'korvette', 'fregatte', 'kreuzer']) {
    const g = raum();
    const e = space.spawnEnemy(g, kind, { x: 1500, y: 500, facing: 0 });
    const tg = messGegner(g, e, dt);
    ok(imBereich(tg), 'Gegner ' + kind + ', dt ' + dt + ' s: Reaktor zerstört nach ' + txt(tg));
  }
  for (const kind of ['korvette', 'fregatte']) {
    const g = raum();
    const es = Flotte.aufstellen(g, { tag: 'v_' + kind + (++seq), kind });
    es.skript = { modus: 'halten' }; es.gestellt = true; es.x = 1500; es.y = 500; es.angle = 0;
    ok(!!es.sys, 'Verbündeter ' + kind + ' hat ein Systemmodell');
    const ta = es.sys ? messGegner(g, es, dt) : null;
    ok(imBereich(ta), 'Verbündeter ' + kind + ', dt ' + dt + ' s: Reaktor zerstört nach ' + txt(ta));
  }
}

console.log('\n[Torpedo und Vollladung ignorieren das Fenster]');
{
  const g = lerche();
  for (const k of I.SYSTEM_ORDER) if (I.systemSector(k) === 0) { g.ship.systems[k] = 'broken'; I.setInteg(g, k, 0); }
  space.shipHit(g, 0, 3, { torpedo: true }); const a = g.ship.systems.reactor; g.time += 0.1; space.shipHit(g, 0, 3, { torpedo: true });
  ok(a === 'damaged' && g.ship.systems.reactor === 'broken', 'Lerche: zwei Torpedos im Abstand 0,1 s: ' + a + ' -> ' + g.ship.systems.reactor);
}
{
  const g = raum(); const e = space.spawnEnemy(g, 'fregatte', { x: 1500, y: 500, facing: 0 });
  frisch(e); const rid = Gsys.idVon(e, 'reaktor');
  for (const id of Gsys.ids(e)) if (Gsys.defOf(e.kind, id).zone === 'bug' && id !== rid) { e.sys[id].i = 0; e.sys[id].z = 'broken'; }
  space.damageEnemy(g, e, 5, e.x + 300, e.y, { torpedo: true, huelle: true, nurOhneSchild: true }); const a = e.sys[rid].z; g.time += 0.1;
  space.damageEnemy(g, e, 5, e.x + 300, e.y, { torpedo: true, huelle: true, nurOhneSchild: true });
  ok(a === 'damaged' && e.sys[rid].z === 'broken', 'Fregatte: zwei Torpedos im Abstand 0,1 s: ' + a + ' -> ' + e.sys[rid].z);
}
console.log('\n[Lanze-Vollladung beachtet das Reaktor-Fenster (SYS-03 N1)]');
for (const kind of ['raider', 'korvette', 'fregatte', 'kreuzer']) {
  const g = raum(); const e = space.spawnEnemy(g, kind, { x: 1500, y: 500, facing: 0 });
  frisch(e); const rid = Gsys.idVon(e, 'reaktor');
  space.damageEnemy(g, e, 5, e.x + 300, e.y, { durchschlag: 'zone' }); const a = e.sys[rid].z; g.time += 0.5;
  space.damageEnemy(g, e, 5, e.x + 300, e.y, { durchschlag: 'zone', vollladung: true });
  ok(a === 'damaged' && e.sys[rid].z === 'damaged', kind + ': Lanze-Vollladung 0,5 s nach dem ersten Treffer: Reaktor bleibt beschädigt (' + a + ' -> ' + e.sys[rid].z + ')');
  g.time += RF;
  space.damageEnemy(g, e, 5, e.x + 300, e.y, { durchschlag: 'zone', vollladung: true });
  ok(e.sys[rid].z === 'broken', kind + ': Lanze-Vollladung nach Ablauf des Fensters: Reaktor zerstört (' + e.sys[rid].z + ')');
}

console.log('\n' + (fails ? 'FEHLER: ' + fails + ' von ' + n : 'alle ' + n + ' Prüfungen grün') + ' (test-reaktor-fenster)');
process.exit(fails ? 1 : 0);
