'use strict';
// EK1b: Fregatte und Kreuzer – Schildsegmente, Trefferzuordnung, Waffenplätze, Tempo, Snapshot, Breitseiten-KI.
//   node tools/test-klassen.js
const Physics = require('../shared/physics.js');
const Schilde = require('../shared/schilde.js');
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Pilot = require('../server/sim/pilot.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const DT = 1 / CONFIG.tickHz;
const NET = CONFIG.net; const SNAP_ZIEL = NET.snapMax - NET.snapLuft;
const DEG = Math.PI / 180;

function arena(players, seed) {
  const g = new Game({ noStore: true, seed: seed || 31, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const conns = [];
  for (let i = 0; i < players; i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'K' + i, color: i }); conns.push(c);
  }
  g.handleMessage(conns[0], { t: 'lobbyOpt', startMission: 'arena_space' });
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = []; g.space.projectiles = [];
  const sh = g.ship; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; sh.vx = 0; sh.vy = 0; sh.turnVel = 0;
  const run = (sec, each) => { for (let k = 0; k < Math.round(sec / DT); k++) { if (each) each(k * DT); g.step(); } };
  const ev = (kind) => conns[0].inbox.filter((m) => m.kind === kind);
  return { g, conns, run, ev };
}
function keep(g) {
  const sh = g.ship;
  for (const k of Object.keys(sh.systems)) { const d = Object.getOwnPropertyDescriptor(sh.systems, k); if (d && d.writable && sh.systems[k] !== 'ok') sh.systems[k] = 'ok'; }
  sh.fireList.length = 0; sh.breachList.length = 0;
}

console.log('\n[EK1b: Schildpunkte-Tabelle]');
{
  const lay = (k) => Schilde.layout(CONFIG, k);
  const werte = (k, seite) => lay(k).seiten[seite].map((i) => lay(k).max[i]);
  const tab = (k) => [werte(k, 2), werte(k, 1), werte(k, 3), werte(k, 0)].map((a) => a.join('+')).join(' | ');   // hinten | Steuerbord | Backbord | vorne
  ok(tab('korvette') === '0 | 2 | 2 | 1', 'Korvette: hinten 0, je Seite 2 (1 Segment), vorne 1 – ' + tab('korvette'));
  ok(tab('fregatte') === '1 | 2+2 | 2+2 | 2', 'Fregatte: hinten 1, je Seite 2 Seitenbereiche à 2, vorne 2 – ' + tab('fregatte'));
  ok(tab('kreuzer') === '1 | 3+3+3 | 3+3+3 | 2', 'Kreuzer: hinten 1, je Seite 3 Seitenbereiche à 3, vorne 2 – ' + tab('kreuzer'));
  ok(lay('korvette').max.join() === '1,2,0,2' && lay('korvette').n === 4, 'Korvette = Spezialfall: [Bug, Steuerbord, Heck, Backbord], ein Segment je Seite');
  ok(lay('fregatte').n === 6 && lay('kreuzer').n === 8, 'Segmentzahl: Fregatte 6, Kreuzer 8');
  ok(lay('raider').max.join() === '2,1,0,1' && lay('pylon').max.join() === '4,0,0,0' && lay('sentinel').max.join() === '3,3,3,3', 'Jäger, Pylon, Wächter unverändert (vier Sektoren)');
  const { g } = arena(1);
  const f = space.spawnEnemy(g, 'fregatte', { x: g.ship.x + 900, y: g.ship.y });
  const k = space.spawnEnemy(g, 'kreuzer', { x: g.ship.x + 900, y: g.ship.y + 200 });
  ok(f.shields.join() === '2,2,2,1,2,2' && f.shieldsMax.join() === f.shields.join(), 'Fregatte entsteht mit vollen Segmenten (Bug 2 | Stb 2,2 | Heck 1 | Bb 2,2)');
  ok(k.shields.join() === '2,3,3,3,1,3,3,3', 'Kreuzer entsteht mit vollen Segmenten (Bug 2 | Stb 3,3,3 | Heck 1 | Bb 3,3,3)');
  ok(f.hp === f.hpMax && f.hpMax > g.C.enemies.korvette.hp * 0.5 && g.C.enemies.kreuzer.hp > g.C.enemies.fregatte.hp && g.C.enemies.fregatte.hp > g.C.enemies.korvette.hp, 'Hülle: Korvette < Fregatte < Kreuzer');
}

console.log('\n[EK1b: Segmentzuordnung eines Treffers entlang der Schiffslänge]');
{
  const { g } = arena(1);
  const treffer = (kind, relGrad, dist) => {
    const e = space.spawnEnemy(g, kind, { x: 2000, y: 1500, facing: 0 });
    e.angle = 0; const before = e.shields.slice();
    const a = relGrad * DEG; const d = dist || 100;
    space.damageEnemy(g, e, 0.5, e.x + Math.cos(a) * d, e.y + Math.sin(a) * d);
    const idx = e.shields.map((v, i) => (v < before[i] ? i : -1)).filter((i) => i >= 0);
    g.space.enemies = g.space.enemies.filter((q) => q !== e);
    return idx;
  };
  // Fregatte [Bug 0 | Stb 1,2 | Heck 3 | Bb 4,5]; rel 0° = voraus, +90° = Steuerbord. Winkel zwischen 45° und 90°: vorderer Seitenbereich
  ok(treffer('fregatte', 0).join() === '0', 'Fregatte: Treffer von vorn -> Bug (Segment 0)');
  ok(treffer('fregatte', 60).join() === '1', 'Fregatte: Steuerbord, vorderer Teil (60°) -> Segment 1');
  ok(treffer('fregatte', 120).join() === '2', 'Fregatte: Steuerbord, hinterer Teil (120°) -> Segment 2');
  ok(treffer('fregatte', 90).join() === '2' || treffer('fregatte', 89).join() === '1', 'Fregatte: Mitte (90°) trennt die beiden Seitenbereiche');
  ok(treffer('fregatte', 180).join() === '3', 'Fregatte: von hinten -> Heck (Segment 3)');
  ok(treffer('fregatte', -60).join() === '4' && treffer('fregatte', -120).join() === '5', 'Fregatte: Backbord vorn -> 4, Backbord hinten -> 5');
  ok(treffer('fregatte', 60, 900).join() === '1' && treffer('fregatte', 120, 900).join() === '2', 'Zuordnung gilt auch für weit entfernte Schützen (Lanze aus 900 px)');
  // Kreuzer [Bug 0 | Stb 1,2,3 | Heck 4 | Bb 5,6,7]: Drittel der Längsachse
  ok(treffer('kreuzer', 50).join() === '1' && treffer('kreuzer', 90).join() === '2' && treffer('kreuzer', 130).join() === '3', 'Kreuzer: Steuerbord vorn/mitte/hinten (50°, 90°, 130°) -> 1, 2, 3');
  ok(treffer('kreuzer', -50).join() === '5' && treffer('kreuzer', -90).join() === '6' && treffer('kreuzer', -130).join() === '7', 'Kreuzer: Backbord vorn/mitte/hinten -> 5, 6, 7');
  ok(treffer('kreuzer', 10).join() === '0' && treffer('kreuzer', 170).join() === '4', 'Kreuzer: Bug -> 0, Heck -> 4');
  // Korvette: ein Segment je Seite, Zuordnung = Physics.sectorOf in jedem Winkel
  let gleich = true;
  for (let w = -179; w <= 180; w += 7) {
    const e = space.spawnEnemy(g, 'korvette', { x: 2000, y: 1500, facing: 0 }); e.angle = 0.3;
    const before = e.shields.slice(); const a = w * DEG + e.angle;
    const px = e.x + Math.cos(a) * 120, py = e.y + Math.sin(a) * 120;
    space.damageEnemy(g, e, 0.25, px, py);
    const sec = Physics.sectorOf(e.x, e.y, e.angle, px, py);
    const idx = e.shields.findIndex((v, i) => v < before[i]);
    // Schilde mit 0 (Heck) nehmen nichts auf: dann geht der Schaden in die Hülle und kein Segment sinkt
    if (before[sec] > 0 && idx !== sec) gleich = false;
    g.space.enemies = g.space.enemies.filter((q) => q !== e);
  }
  ok(gleich, 'Korvette: Segment = Sektor (Physics.sectorOf) in allen Winkeln');
  // Schaden trifft nur das getroffene Segment: erst vorderes Steuerbord-Segment leer schießen, dann geht der nächste Treffer auf die Hülle
  const e = space.spawnEnemy(g, 'fregatte', { x: 2000, y: 1500, facing: 0 }); e.angle = 0;
  const sx = e.x + Math.cos(60 * DEG) * 100, sy = e.y + Math.sin(60 * DEG) * 100;
  const hp0 = e.hp;
  space.damageEnemy(g, e, 2, sx, sy);
  ok(e.shields[1] === 0 && e.shields[2] === 2 && e.hp === hp0, 'Segment 1 leer geschossen (2 Punkte), Nachbarsegment 2 unberührt, Hülle unberührt');
  space.damageEnemy(g, e, 1, sx, sy);
  ok(e.hp === hp0 - 1 && e.shields[2] === 2, 'offenes Segment: nächster Treffer geht auf die Hülle, der Nachbar schützt dort nicht');
  space.damageEnemy(g, e, 1, e.x + Math.cos(120 * DEG) * 100, e.y + Math.sin(120 * DEG) * 100);
  ok(e.shields[2] === 1 && e.hp === hp0 - 1, 'hinterer Seitenbereich fängt weiter ab');
  // Regeneration je Segment
  e.regenT = g.C.enemyShieldRegen; g.space.enemies.push(e);
  const s0 = e.shields.slice();
  space.updateEnemies(g, 0.001);
  ok(e.shields[1] === s0[1] + 1 && e.shields[2] === s0[2] + 1 && e.shields[5] === 2, 'Regeneration: je Segment ein Punkt');
}

console.log('\n[EK1b: Waffenplätze und Bestückung je Klasse]');
{
  const { g } = arena(1);
  const plaetze = (k) => g.C.enemyWeapons[k];
  const seite = (k, sg) => plaetze(k).filter((w) => w.facing * sg > 45).length;
  const front = (k) => plaetze(k).filter((w) => w.facing === 0).length;
  ok(front('korvette') === 1 && seite('korvette', 1) === 1 && seite('korvette', -1) === 1, 'Korvette: Front 1, je Seite 1');
  ok(front('fregatte') === 1 && seite('fregatte', 1) === 2 && seite('fregatte', -1) === 2, 'Fregatte: Front 1, je Seite 2');
  ok(front('kreuzer') === 2 && seite('kreuzer', 1) === 3 && seite('kreuzer', -1) === 3, 'Kreuzer: Front 2, je Seite 3');
  ok(plaetze('fregatte').map((w) => w.platz).join() === 'bug,stbd1,stbd2,bb1,bb2', 'Fregatte: Platznamen bug, stbd1, stbd2, bb1, bb2');
  const arten = new Set(); let alle = true;
  for (let i = 0; i < 40; i++) {
    for (const kind of ['fregatte', 'kreuzer']) {
      const e = space.spawnEnemy(g, kind, { x: 500, y: 500 + i * 10 });
      if (Object.keys(e.waffen).sort().join() !== plaetze(kind).map((w) => w.platz).sort().join()) alle = false;
      for (const v of Object.values(e.waffen)) arten.add(v);
    }
  }
  ok(alle && [...arten].sort().join() === 'batterie,bolzen,lanze', 'zufällige Bestückung: jeder Platz belegt, alle drei Arten kommen vor');
  const v = space.spawnEnemy(g, 'fregatte', { x: 600, y: 600, waffen: { bug: 'lanze', stbd1: 'bolzen', stbd2: 'batterie', bb1: 'lanze', bb2: 'lanze' } });
  ok(v.waffen.stbd1 === 'bolzen' && v.waffen.stbd2 === 'batterie' && space.waffenPlaetze(g, v, 'lanze').length === 3, 'Bestückung per Vorgabe, Filter nach Art');
  ok(!space.spawnEnemy(g, 'raider', { x: 700, y: 700 }).waffen && !space.spawnEnemy(g, 'pylon', { x: 800, y: 800 }).waffen, 'Jäger und Pylon haben keine Plätze');
  // Snapshot nach dem Scan: Platz und Art, Geometrie ergänzt der Client aus der Config
  v.scanned = true; const se = g.snapshot().space.enemies.find((x) => x.id === v.id);
  ok(se.weapons.length === 5 && se.weapons.every((w) => w.platz && w.typ && w.facing == null), 'Snapshot nach Scan: 5 Plätze mit platz und typ');
  const voll = Schilde.fuellen(JSON.parse(JSON.stringify(se)), CONFIG);
  ok(voll.weapons.find((w) => w.platz === 'stbd2').facing === 90 && voll.shields.join() === '2,2,2,1,2,2' && voll.shieldsMax.length === 6, 'Client-Leser ergänzt Bögen und volle Schilde aus der Config');
}

console.log('\n[EK1b: Fregatte und Kreuzer sind langsamer und träger]');
{
  const SC = CONFIG.shipClasses;
  ok(SC.fregatte.maxSpeed < SC.korvette.maxSpeed && SC.kreuzer.maxSpeed < SC.fregatte.maxSpeed, `Höchstfahrt Korvette ${SC.korvette.maxSpeed} > Fregatte ${SC.fregatte.maxSpeed} > Kreuzer ${SC.kreuzer.maxSpeed}`);
  ok(SC.fregatte.accel < SC.korvette.accel && SC.kreuzer.accel < SC.fregatte.accel, 'Beschleunigung nimmt ab');
  ok(SC.fregatte.turnRate < SC.korvette.turnRate && SC.kreuzer.turnRate < SC.fregatte.turnRate && SC.fregatte.turnAccel < SC.korvette.turnAccel && SC.kreuzer.turnAccel < SC.fregatte.turnAccel, 'Drehrate und Drehbeschleunigung nehmen ab');
  ok(SC.fregatte.radius > SC.korvette.radius && SC.kreuzer.radius > SC.fregatte.radius, 'Radius wächst');
  // gemessen: Spitzentempo im Gefecht
  const spitze = {};
  for (const kind of ['korvette', 'fregatte', 'kreuzer']) {
    const { g, run } = arena(1, 5);
    const e = space.spawnEnemy(g, kind, { x: g.ship.x + 700, y: g.ship.y - 300 });
    e.hp = e.hpMax = 99999; let vmax = 0;
    run(60, () => { keep(g); const v = Math.hypot(e.vx || 0, e.vy || 0); if (v > vmax) vmax = v; });
    spitze[kind] = vmax;
  }
  ok(spitze.fregatte < spitze.korvette && spitze.kreuzer < spitze.fregatte, `gemessenes Spitzentempo: Korvette ${Math.round(spitze.korvette)} > Fregatte ${Math.round(spitze.fregatte)} > Kreuzer ${Math.round(spitze.kreuzer)}`);
}

console.log('\n[EK1b: Breitseiten-KI (eine Funktion für alle Klassen), Waffen im Gefecht]');
for (const kind of ['fregatte', 'kreuzer']) {
  const { g, run, ev } = arena(3, 17);
  const sh = g.ship;
  const e = space.spawnEnemy(g, kind, { x: sh.x + 650, y: sh.y - 250 });
  e.hp = e.hpMax = 99999;
  ok(Pilot.isBreitseite(kind) && Pilot.flies(g, e) && e.pstate === 'station', `${kind}: fährt die Breitseiten-KI (Station)`);
  let ticks = 0, imBogen = 0, schuesse = 0, dmin = 1e9, dmax = 0; const seen = new Set();
  run(70, () => {
    keep(g); ticks++;
    const d = Math.hypot(e.x - sh.x, e.y - sh.y); dmin = Math.min(dmin, d); if (ticks > 15 * 30) dmax = Math.max(dmax, d);
    if (ticks > 20 * 30) {
      const bogen = g.C.enemyWeapons[kind].filter((w) => w.facing !== 0).some((w) => Physics.inArc(e.x, e.y, e.angle, w.facing, w.arc, w.range, sh.x, sh.y));
      if (bogen) imBogen++;
    }
    for (const p of g.space.projectiles) if (p.owner === e.id && !seen.has(p.id)) { seen.add(p.id); schuesse++; }
  });
  const anteil = imBogen / (50 * 30);
  // schwere Schiffe brauchen für einen Seitenwechsel (Segment aufgebrochen) lange – Soll daher niedriger als bei der Korvette (≈ 55–80 %)
  ok(anteil >= 0.3, `${kind}: Lerche liegt zu ${Math.round(anteil * 100)} % in einem Seitenbogen (Breitseite, Soll ≥ 30 %)`);
  ok(dmin > 120 && dmax < 700, `${kind}: Abstand gehalten (min ${Math.round(dmin)}, max ${Math.round(dmax)})`);
  ok(schuesse + ev('tele').length > 0, `${kind}: feuert (${schuesse} Geschosse, ${ev('tele').length} Ladungen)`);
  ok(g.errors === 0, `${kind}: keine Server-Fehler`);
}
{
  // mehrere Plätze: drei Bolzen an Steuerbord schießen je Takt drei Schüsse, drei Lanzen laden stärker als eine
  const { g, run, ev } = arena(3, 19);
  const sh = g.ship;
  const wb = { bug: 'lanze', stbd1: 'bolzen', stbd2: 'bolzen', stbd3: 'bolzen', bb1: 'lanze', bb2: 'lanze', bb3: 'lanze', bug2: 'lanze' };
  const e = space.spawnEnemy(g, 'kreuzer', { x: sh.x, y: sh.y - 300, waffen: wb });   // Lerche liegt querab Steuerbord (Bug zeigt nach +x, Lerche südlich)
  e.angle = 0; e.hp = e.hpMax = 99999; e.stage = 0;
  const im = space.waffenPlaetze(g, e, 'bolzen').filter((w) => Physics.inArc(e.x, e.y, 0, w.facing, w.arc, w.range, sh.x, sh.y)).length;
  ok(im === 3, 'Lerche steht im Bogen aller drei Steuerbord-Bolzen');
  e.boltT = 99;
  const vorher = g.space.projectiles.length;
  space.updateEnemies(g, DT);
  const neu = g.space.projectiles.filter((p) => p.owner === e.id && p.kind === 'enemy');
  ok(g.space.projectiles.length - vorher >= 3 && neu.length === 3, `drei Bolzen-Plätze im Bogen: ${neu.length} Schüsse in einem Takt`);
  ok(new Set(neu.map((p) => Math.round(p.x) + ':' + Math.round(p.y))).size === 3, 'die Schüsse kommen aus drei verschiedenen Mündungen');
  // Lanze: Schaden wächst je weiterem Platz im Bogen
  const L = (kind, waffen) => {
    const a = arena(1, 23); const s = a.g.ship;
    for (let i = 0; i < 4; i++) s.shields.current[i] = 0;
    const q = space.spawnEnemy(a.g, kind, { x: s.x, y: s.y - 300, waffen }); q.angle = 0; q.hp = q.hpMax = 99999;
    a.g.space.enemies = [q];
    let dmg = null;
    a.run(12, () => { keep(a.g); for (const sec of [0, 1, 2, 3]) a.g.ship.shields.current[sec] = 0; q.angle = 0; q.x = s.x; q.y = s.y - 300; q.vx = q.vy = 0; q.stage = 0; for (const h of a.ev('hit')) if (h.heavy && dmg == null && !h.evaded) dmg = h.dmg; });
    return dmg;
  };
  const d1 = L('korvette', { bug: 'bolzen', stbd: 'lanze', bb: 'bolzen' });
  const d3 = L('kreuzer', { bug: 'bolzen', bug2: 'bolzen', stbd1: 'lanze', stbd2: 'lanze', stbd3: 'lanze', bb1: 'bolzen', bb2: 'bolzen', bb3: 'bolzen' });
  ok(d1 != null && d3 != null && d3 > d1 && Math.abs(d3 - d1 * (1 + 2 * g.C.waffenMehr.lanzeJeWeitere)) < 0.31, `Lanze: eine ${d1} Hülle, drei Plätze im Bogen ${d3} (× ${1 + 2 * g.C.waffenMehr.lanzeJeWeitere})`);
}

console.log('\n[EK1b: Snapshot im Budget, Spawn, Debug, Namen]');
{
  const { g, run } = arena(3, 29);
  const sh = g.ship;
  const kinds = ['kreuzer', 'kreuzer', 'fregatte', 'fregatte', 'fregatte', 'korvette', 'korvette', 'raider', 'raider', 'raider', 'sentinel', 'pylon'];
  kinds.forEach((k, i) => { const e = space.spawnEnemy(g, k, { x: sh.x + 500 + 40 * i, y: sh.y + (i - 6) * 90 }); e.scanned = true; e.hp = e.hpMax = 9999; });
  // Schilde angeschossen (Standardwerte entfallen nur bei vollen Schilden)
  for (const e of g.space.enemies) if (e.shields.length > 4) e.shields[2] = 0;
  const bytes = (o) => Buffer.byteLength(JSON.stringify(o));
  let worst = 0;
  run(20, () => { keep(g); worst = Math.max(worst, bytes(g.snapshot())); });
  ok(worst <= SNAP_ZIEL, `Snapshot mit 2 Kreuzern, 3 Fregatten und 7 weiteren Gegnern (alle gescannt): ${worst} B ≤ ${SNAP_ZIEL} B`);
  const s = g.snapshot();
  const sk = s.space.enemies.find((e) => e.kind === 'kreuzer');
  ok(!('shieldsMax' in sk), 'Snapshot: shieldsMax entfällt (Standard aus der Config)');
  const full = space.spawnEnemy(g, 'fregatte', { x: sh.x + 900, y: sh.y }); full.scanned = false;
  const sf = g.snapshot().space.enemies.find((e) => e.id === full.id);
  ok(!('shields' in sf) && !('shieldsMax' in sf), 'Snapshot: volle Schilde fehlen (Standard)');
  const einzel = bytes(g.snapshot().space.enemies.find((e) => e.id === full.id));
  ok(einzel < 150, `Snapshot: eine ungescannte Fregatte mit vollen Schilden ${einzel} B`);
  ok(Protocol.ENEMY_KINDS.includes('fregatte') && Protocol.ENEMY_KINDS.includes('kreuzer'), 'ENEMY_KINDS enthält fregatte und kreuzer');
  // Debug spawn
  const dbg = arena(1, 3);
  dbg.g.handleMessage(dbg.conns[0], { t: 'debug', cmd: 'spawn', kind: 'fregatte' });
  dbg.g.handleMessage(dbg.conns[0], { t: 'debug', cmd: 'spawn', kind: 'kreuzer' });
  ok(dbg.g.space.enemies.map((e) => e.kind).join() === 'fregatte,kreuzer', 'Debug spawn fregatte | kreuzer');
  ok(g.errors === 0 && dbg.g.errors === 0, 'keine Server-Fehler');
}

console.log(`\n${n - fails}/${n} Klassen-Tests bestanden.`);
process.exit(fails ? 1 : 0);
