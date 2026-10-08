'use strict';
// Feature-Tests der Server-Regeln (§4.2, §6, §8, CONTRACT-M1) direkt gegen die Game-Klasse.
// Aufbau per Debug-Befehl (nur Testvorbereitung), die geprüften Aktionen laufen über echte Nachrichten.
//   node tools/test-features.js
const Physics = require('../shared/physics.js');
const Maps = require('../shared/maps.js');
const Locations = require('../shared/locations.js');
const { Game } = require('../server/game.js');
const generator = require('../server/mission/generator.js');
const Schema = require('../shared/schema.js');
const interior = require('../server/sim/interior.js');

const W = require('../server/world.js');

// M3a: Schiffspositionen nur aus dem Layout (shared/maps.js, server/world.js) – keine festen Koordinaten.
// Stehplatz = begehbare Nachbarkachel + Blickrichtung auf das Objekt (unten, oben, links, rechts).
const STAND = [[0, 1, 'up'], [0, -1, 'down'], [-1, 0, 'right'], [1, 0, 'left']];
function standSpots(tiles) {
  const list = Array.isArray(tiles) ? tiles : [tiles];
  const out = [];
  for (const t of list) for (const [dx, dy, dir] of STAND) {
    const s = { x: t.x + dx, y: t.y + dy, dir };
    if (!W.ship.solid(s.x, s.y) && !out.some((o) => o.x === s.x && o.y === s.y)) out.push(s);
  }
  return out;
}
const dirTo = (from, to) => (to.y < from.y ? 'up' : to.y > from.y ? 'down' : to.x > from.x ? 'right' : 'left');
const conSpot = (con, k) => standSpots(W.CONSOLE_TILES[con])[k || 0];
const sysSpot = (sys) => standSpots(W.SYSTEM_TILES[sys])[0];
const bedSpot = (color) => standSpots(Maps.BEDS.find((b) => b.color === color))[0];
const switchSpot = (id) => standSpots(Maps.REACTOR_SWITCHES.find((s) => s.id === id))[0];
function shelfSpot(item) {
  const s = Maps.SHELF_TILES.find((q) => q.item === item);
  return s.access ? { x: s.access.x, y: s.access.y, dir: dirTo(s.access, s) } : standSpots(s)[0];
}
// zwei waagrecht benachbarte Bodenkacheln (a links, b rechts) ab einem Spieler-Spawn
const FLOOR_PAIR = (() => {
  for (const s of Maps.SHIP_SPAWNS) if (!W.ship.solid(s.x + 1, s.y)) return { a: { x: s.x, y: s.y }, b: { x: s.x + 1, y: s.y } };
  return null;
})();

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

function setup(players, opts) {
  const g = new Game(Object.assign({ noStore: true, seed: 5, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} }, opts || {}));
  const conns = [];
  for (let i = 0; i < players; i++) {
    const c = { inbox: [], send(o) { this.inbox.push(o); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'T' + i, name: 'T' + i, color: i });
    conns.push(c);
  }
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  const P = (i) => g.players[i];
  const send = (i, m) => g.handleMessage(conns[i], m);
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
  const place = (i, tx, ty, dir, zone) => { const p = P(i); const c = Physics.tileCenter(tx, ty); p.x = c.x; p.y = c.y; p.dir = dir || 'down'; if (zone) p.zone = zone; p.console = null; };
  const placeAt = (i, s, zone) => place(i, s.x, s.y, s.dir, zone);   // Stehplatz aus dem Layout
  const notices = (i) => conns[i].inbox.filter((m) => m.kind === 'notice').map((m) => m.text);
  const events = (kind) => conns[0].inbox.filter((m) => m.kind === kind);
  const tap = (i) => { send(i, { t: 'act', down: true }); send(i, { t: 'act', down: false }); };
  const cmd = (i, c, extra) => send(i, Object.assign({ t: 'cmd', c }, extra || {}));
  const enter = (i, kind) => {
    const pos = W.CONSOLE_TILES[kind] ? conSpot(kind) : null;
    if (pos) { placeAt(i, pos); tap(i); }
  };
  return { g, conns, P, send, run, place, placeAt, notices, events, tap, cmd, enter };
}

console.log('\n[Regale, Tragen, Reparatur]');
{
  // M3a: zu zweit (Bot-Automatik aus), damit kein Schrauber dazwischen repariert. Reparaturwege laut CONTRACT-M3 §8.1.
  const { g, P, send, run, placeAt, notices, tap } = setup(2);
  placeAt(0, shelfSpot('ersatzteil')); tap(0);
  const startParts = g.C.economy.startInventory.ersatzteil;
  ok(P(0).carry === 'ersatzteil' && g.inventory.ersatzteil === startParts - 1, 'Ersatzteil aus Regal genommen');
  tap(0);
  ok(P(0).carry === null && g.inventory.ersatzteil === startParts, 'zurückgelegt');
  g.ship.systems.engines = 'broken';
  placeAt(0, sysSpot('engines'));
  send(0, { t: 'act', down: true }); run(1.6); send(0, { t: 'act', down: false });
  ok(g.ship.systems.engines === 'damaged' && g.ship.fragile && g.ship.fragile.engines, 'M3a: broken ohne Teil -> Flicken (1,5 s): damaged + fragil');
  g.ship.systems.engines = 'broken';
  P(0).carry = 'ersatzteil';
  send(0, { t: 'act', down: true }); run(3.2); send(0, { t: 'act', down: false });
  ok(g.ship.systems.engines === 'ok' && P(0).carry === null && !(g.ship.fragile && g.ship.fragile.engines), 'M3a: broken mit Teil -> Austausch (3 s): direkt ok, nicht fragil');
  g.ship.systems.engines = 'damaged';
  send(0, { t: 'act', down: true }); run(1); send(0, { t: 'input', seq: 1, mx: 1, my: 0 }); run(0.2); send(0, { t: 'input', seq: 2, mx: 0, my: 0 }); run(2);
  ok(g.ship.systems.engines === 'damaged' && !P(0).hold, 'Bewegen bricht Halten ab');
  send(0, { t: 'act', down: false });
  placeAt(0, sysSpot('engines'));
  send(0, { t: 'act', down: true }); run(1.6); send(0, { t: 'act', down: false });
  ok(g.ship.systems.engines === 'ok', 'damaged -> ok (Flicken 1,5 s)');
  g.ship.systems.engines = 'offline';
  tap(0);
  ok(notices(0).length > 0 && g.ship.systems.engines === 'offline', 'offline (EMP): Hinweis, keine Reparatur');
  g.ship.systems.engines = 'ok';
  P(0).carry = 'flickblech';
  send(0, { t: 'drop' });
  ok(P(0).carry === null && g.ship.groundItems.length === 1, 'G legt ab (Bodengegenstand)');
  tap(0);
  ok(P(0).carry === 'flickblech' && g.ship.groundItems.length === 0, 'Bodengegenstand aufgehoben');
}

console.log('\n[Feuer, Leck, Revive]');
{
  const { g, P, send, run, place } = setup(2);
  g.ship.fireList = []; g.ship.breachList = [];
  const FP = FLOOR_PAIR;
  g.ship.fireList.push({ tx: FP.b.x, ty: FP.b.y, spreadT: 0, dmgT: 0 });
  place(0, FP.a.x, FP.a.y, 'right');
  P(0).carry = 'loeschgel'; P(0).carryCharges = 5;
  send(0, { t: 'act', down: true }); run(1.6); send(0, { t: 'act', down: false });
  ok(g.ship.fireList.length === 0 && P(0).carryCharges === 4, 'Feuer gelöscht, Ladung verbraucht');
  g.ship.breachList.push({ tx: FP.b.x, ty: FP.b.y, t: 0 });
  P(0).carry = 'flickblech';
  send(0, { t: 'act', down: true }); run(3.1); send(0, { t: 'act', down: false });
  ok(g.ship.breachList.length === 0 && P(0).carry === null, 'Leck geflickt');
  place(1, FP.b.x, FP.b.y);
  interior.downPlayer(g, P(1), 'test');
  send(0, { t: 'act', down: true }); run(3.1); send(0, { t: 'act', down: false });
  ok(!P(1).downed && P(1).hp === 50, 'Wiederbelebt (HP 50)');
  interior.downPlayer(g, P(1), 'test');
  run(15.2);
  ok(!P(1).downed, 'automatisch nach 15 s auf');
}

console.log('\n[Konsolen, Koje, Shop, Deko, Energie]');
{
  const { g, P, send, run, placeAt, notices, tap, cmd, enter } = setup(2);
  enter(0, 'captain');
  ok(P(0).console === 'captain', 'Captain-Konsole betreten');
  placeAt(1, conSpot('captain', 1)); tap(1);
  ok(P(1).console === null && notices(1).some((t) => /besetzt/.test(t)), 'besetzte Konsole abgelehnt');
  cmd(1, 'captain.accept');
  ok(notices(1).some((t) => /passenden Konsole/.test(t)), 'Befehl ohne Konsole abgelehnt');
  placeAt(1, bedSpot(1)); tap(1);
  ok(P(1).console === 'quartier', 'eigene Koje -> quartier');
  send(1, { t: 'leave' });
  placeAt(1, bedSpot(0)); tap(1);
  ok(P(1).console === null && notices(1).some((t) => /Nicht deine Koje/.test(t)), 'fremde Koje abgelehnt');
  placeAt(1, bedSpot(3)); tap(1);
  ok(P(1).console === null && notices(1).some((t) => /Gästequartier/.test(t)), 'Gästequartier (Koje 4) nicht nutzbar');
  send(0, { t: 'leave' });
  enter(0, 'shop');
  ok(P(0).console === 'shop', 'Hafenterminal (angedockt)');
  cmd(0, 'shop.buy', { item: 'pflanze' });
  cmd(0, 'shop.buy', { item: 'werkzeuggurt' });
  ok(g.inventory.deko.includes('pflanze') && P(0).gear.werkzeuggurt && g.inventory.marks === 150 + g.C.discovery.firstVisitMarks - 20 - 120, 'Kauf Deko + Werkzeuggürtel');
  cmd(0, 'shop.buy', { item: 'seitenturm' });
  ok(notices(0).some((t) => /Nicht genug Marken/.test(t)), 'zu teuer -> Hinweis');
  cmd(0, 'shop.buy', { item: 'kristalllampe' });
  ok(notices(0).some((t) => /Vaelen/.test(t)), 'Kristalllampe nur bei Vaelen');
  send(0, { t: 'leave' });
  placeAt(0, bedSpot(0)); tap(0);
  cmd(0, 'deco.place', { slot: 'q0c', item: 'pflanze' });
  ok(g.deco.q0c === 'pflanze' && !g.inventory.deko.includes('pflanze'), 'Deko in Slot 3 von 4 gesetzt');
  cmd(0, 'deco.place', { slot: 'q1a', item: null });
  ok(notices(0).some((t) => /nicht dein Deko/.test(t)), 'fremder Deko-Slot abgelehnt');
  cmd(0, 'quartier.style', { part: 'floor', value: 'teppich_blau' });
  cmd(0, 'quartier.style', { part: 'light', value: 'mint' });
  cmd(0, 'quartier.style', { part: 'wall', value: 'pink' });
  ok(g.quarters.q0.floor === 'teppich_blau' && g.quarters.q0.light === 'mint' && g.quarters.q0.wall !== 'pink' && notices(0).some((t) => /Stil/.test(t)), 'Quartier-Stile (gültig/ungültig)');
  ok(Object.keys(g.snapshot().deco).length === 16 && g.snapshot().quarters.q3.floor, 'Snapshot: 16 Deko-Slots + 4 Quartiere');
  send(0, { t: 'leave' });
  enter(0, 'captain');
  cmd(0, 'captain.power', { sys: 'engines', delta: 1 });
  ok(notices(0).some((t) => /Reaktor ausgelastet/.test(t)), 'Energie: Reaktorgrenze');
  cmd(0, 'captain.power', { sys: 'weapons', delta: -1 }); cmd(0, 'captain.power', { sys: 'shields', delta: 1 });
  run(0.1);
  ok(g.ship.power.shields === 3 && g.ship.shields.pool === 3 * g.C.shields.pointsPerPower, 'Energie verschoben, Schildpool ' + g.ship.shields.pool + ' (M3b: 3 je Energie)');
  g.ship.systems.reactor = 'broken'; run(0.1);
  ok(Object.values(g.ship.power).reduce((a, b) => a + b, 0) <= g.C.spaceM3.reactorBrokenOutput && g.ship.power.life >= 1, 'Reaktor broken -> Notstrom 2, von oben gekürzt, Lebenserhaltung zuletzt');
  // M3a: Ein zerstörter Reaktor braucht nach der Reparatur einen Neustart (test-m3); hier direkt wieder online
  g.ship.systems.reactor = 'ok'; require('../server/sim/space.js').reactorOnline(g, 'Test'); run(0.1);
  ok(g.ship.power.shields === 3 && g.ship.power.weapons === 1, 'Reaktor repariert + online -> letzte Einstellung zurück');
}

console.log('\n[M1 §6: Reaktor überladen, offline, Neustart zu zweit]');
{
  const { g, P, send, run, placeAt, notices, cmd, enter, events } = setup(2);
  send(0, { t: 'debug', cmd: 'skip' });
  enter(0, 'captain');
  cmd(0, 'captain.overload');
  run(0.1);
  ok(g.ship.reactor.state === 'overload' && g.ship.reactor.output === 12 && g.ship.reactor.overloadLeft === 180, 'Überladen: +4 für 180 s');
  cmd(0, 'captain.overload');
  ok(notices(0).some((t) => /bereits überladen/.test(t)), 'doppelt überladen abgelehnt');
  g.ship.reactorCtl.overloadLeft = 31; run(1.2);
  ok(events('oda').some((e) => /endet in 30 s/.test(e.text)), 'ODA-Warnung 30 s vorher');
  run(31);
  ok(g.ship.reactor.state === 'offline' && g.ship.reactor.output === 2, 'danach offline, Notstrom 2');
  ok(Object.values(g.ship.power).reduce((a, b) => a + b, 0) <= 2 && g.ship.power.life >= 1, 'Energie von oben gekürzt, Lebenserhaltung zuletzt');
  send(0, { t: 'leave' });
  placeAt(0, switchSpot('A')); placeAt(1, switchSpot('B'));
  send(0, { t: 'act', down: true }); run(1);
  ok(g.ship.reactor.switches.A && !g.ship.reactor.switches.B, 'Schalter A gehalten');
  send(1, { t: 'act', down: true }); run(1.5);
  send(1, { t: 'act', down: false }); run(0.2);
  ok(g.ship.reactor.state === 'offline' && g.ship.reactorCtl.restartProgress === 0, 'Loslassen -> Fortschritt verfällt');
  send(1, { t: 'act', down: true }); run(3.3);
  ok(g.ship.reactor.state === 'online' && !P(0).hold && !P(1).hold, 'beide 3 s gemeinsam -> online');
  send(0, { t: 'act', down: false }); send(1, { t: 'act', down: false });
  // Allein: Schrauber hilft
  g.ship.reactorCtl.state = 'offline'; g.ship.reactorCtl.offlineT = 0;
  placeAt(0, switchSpot('A')); send(0, { t: 'act', down: true });
  run(12);
  ok(g.ship.reactor.state === 'online', 'allein: nach 3 s schickt der Server einen Schrauber an B -> online (' + g.ship.reactor.state + ')');
  send(0, { t: 'act', down: false });
  ok(events('oda').some((e) => /Schrauber an Schalter B/.test(e.text)), 'ODA meldet den Schrauber');
  g.ship.reactorCtl.state = 'offline'; g.ship.reactorCtl.offlineT = 0;
  run(g.C.reactorM1.autoRestartAfter + 1);
  ok(g.ship.reactor.state === 'online', 'Softlock-Schutz: Notstart nach ' + g.C.reactorM1.autoRestartAfter + ' s ohne Crew');
}

console.log('\n[M3a §5: Halterungen (Altnamen phase_l/both), Gegner-Schilde, Ziel-Scan, Marker, EMP]');
{
  const { g, P, send, run, place, notices, cmd, enter, events } = setup(2);
  send(0, { t: 'debug', cmd: 'mission', id: 'm1', step: 'scan' });
  g.space.enemies = []; g.space.projectiles = [];
  const sh = g.ship; sh.x = 1000; sh.y = 1500; sh.angle = 0; sh.vx = 0; sh.vy = 0;
  const space = require('../server/sim/space.js');
  const M3 = g.C.spaceM3;
  // Kanonenboot oben (Backbord des Schiffs), Blick nach Osten: seine Steuerbord-Seite (Sektor 1, Schild 4) zeigt zum Schiff
  const e = space.spawnEnemy(g, 'gunboat', { x: 1000, y: 1150, facing: 0 });
  e.hp = e.hpMax = 40;
  const hold = (en, x, y, a) => () => { en.x = x; en.y = y; en.angle = a; en.fireT = -999; en.tele = null; g.space.projectiles = []; };
  const runPinned = (sec, f) => { for (let k = 0; k < Math.round(sec * 30); k++) { f(); g.step(); } };
  const pinE = hold(e, 1000, 1150, 0);
  const snap0 = g.snapshot();
  const ids = snap0.ship.mounts.map((m) => m.id);
  ok(ids.slice(0, 3).join() === 'bow,port,stbd' && !ids.includes('bolzen') && !ids.some((x) => /^phase_/.test(x)), 'Start: Lanze + 2 Batterien (bow/port/stbd), kein Bolzenwerfer – ' + ids.join());
  ok(snap0.ship.mounts[1].facing === -90 && snap0.ship.mounts[1].arc === 70 && snap0.ship.mounts[0].arc === 16, 'Bögen: Bb −90°/70°, Lanze 16°');
  const se = snap0.space.enemies[0];
  ok(se.shields.join() === '2,4,1,4' && se.weapons === null && se.scanned === false, 'Gegner-Schilde im Snapshot, Waffen erst nach Scan');
  enter(0, 'weapons');
  cmd(0, 'weapons.target', { id: e.id });
  // §20.4: kein hold mehr – Batterien feuern nur auf Befehl; stbd leer, damit 'both' nur Bb feuert
  sh.mount.port.charge = 1; sh.mount.stbd.charge = 0; sh.mount.bow.charge = 0;
  cmd(0, 'weapons.fire', { mount: 'both' });   // Altname both -> all
  let batteryBeams = 0;
  runPinned(1.2, () => { pinE(); batteryBeams += g.space.beams.filter((b) => b.kind === 'battery' && !b.seen).map((b) => (b.seen = true)).length; });
  ok(e.shields[1] === 0 && e.shields[3] === 4 && e.hp === 40 - (4 * M3.mounts.port.damage - 4), `Altname both: Bb-Salve 4×1,5 auf den Schild zum Schiff (4 -> 0), Rest auf die Hülle (hp ${e.hp})`);
  ok(batteryBeams === 4, 'vier Batterie-Strahlen (Beam-Kind battery): ' + batteryBeams);
  e.shields = [0, 0, 0, 0]; e.hp = 40;
  sh.mount.port.charge = 1;
  cmd(0, 'weapons.fire', { mount: 'phase_l' });   // Altname phase_l -> port
  runPinned(1.2, () => { pinE(); e.shields = [0, 0, 0, 0]; });
  ok(e.hp === 40 - 4 * M3.mounts.port.damage, 'Altname phase_l -> Bb-Batterie, Schild weg -> Hüllenschaden (hp ' + e.hp + ')');
  // Ziel außerhalb des Bogens: Ziel auf Steuerbord, Bb feuern
  e.x = 1000; e.y = 1850;
  sh.mount.port.charge = 1;
  cmd(0, 'weapons.fire', { mount: 'phase_l' });
  // §20.4: kein Ziel im Bogen -> Salve ins Leere (senkrecht zur Flanke), kein Schaden am Ziel auf Steuerbord
  const hpOut = e.hp;
  let voidBeams = 0;
  runPinned(1.2, () => { e.x = 1000; e.y = 1850; e.fireT = -999; e.tele = null; voidBeams += g.space.beams.filter((b) => b.kind === 'battery' && b.miss && !b.seen).map((b) => (b.seen = true)).length; });
  ok(e.hp === hpOut && voidBeams === 4, 'Ziel außerhalb des Feuerbogens: Salve ins Leere (' + voidBeams + ' Strahlen), kein Schaden')
  e.x = 1000; e.y = 1150;
  cmd(0, 'weapons.fire', { mount: 'bolzen' });
  ok(notices(0).some((t) => /Bolzenwerfer/.test(t)), 'Bolzenwerfer nicht eingebaut (Shop-Upgrade)');
  // Ziel-Scan
  e.x = 1500; e.y = 1500;
  for (let k = 0; k < 8; k++) { cmd(0, 'weapons.scan', { on: true }); run(0.3); }
  ok(e.scanned && g.snapshot().space.enemies[0].weapons.length === 2, 'Ziel-Scan 2 s -> scanned, Feuerbögen im Snapshot');
  ok(g.snapshot().ship.tscan.targetId === e.id, 'Snapshot ship.tscan');
  e.x = 2000; e.scanned = false; cmd(0, 'weapons.scan', { on: true });
  ok(notices(0).some((t) => /zu weit/.test(t)), 'Scan-Reichweite 800');
  // Marker
  cmd(0, 'weapons.marker', { x: 1200, y: 1300 });
  enter(1, 'captain');
  cmd(1, 'captain.marker', { x: 900, y: 1700 });
  let ms = g.snapshot().ship.markers;
  ok(ms.tactical.x === 1200 && ms.captain.y === 1700, 'Marker Taktik (Bernstein) + Captain (Mint) gleichzeitig');
  cmd(0, 'weapons.marker', { clear: true });
  ok(g.snapshot().ship.markers.tactical === null && g.snapshot().ship.markers.captain, 'Taktik-Marker gelöscht, Captain-Marker bleibt');
  // Unbesetzte Taktik: Auto-Feuer 50 % (M3a: Bb-Salve 4 × 1,5 × 0,5 = 3)
  send(0, { t: 'leave' });
  g.space.enemies = [];
  const r = space.spawnEnemy(g, 'raider', { x: 1000, y: 1150, facing: Math.PI / 2 });
  r.shields = [0, 0, 0, 0]; r.hp = 10; sh.mount.port.charge = 1; sh.mount.stbd.charge = 0; sh.mount.bow.charge = 0;
  runPinned(1.2, () => { r.x = 1000; r.y = 1150; r.fireT = -999; r.shields = [0, 0, 0, 0]; sh.mount.bow.charge = 0; sh.mount.stbd.charge = 0; g.space.projectiles = []; });
  // Toleranz: space.damageEnemy rundet HP je Treffer auf 0,1 (0,75 -> 0,7)
  ok(Math.abs(r.hp - (10 - 4 * M3.mounts.port.damage)) <= 0.05, 'unbesetzt: Bb-Batterie feuert automatisch (M3a: halbe Ladegeschwindigkeit, voller Schaden 4×1,5) – hp ' + r.hp);
  // EMP des Wächters
  g.space.enemies = [];
  sh.shields.current = [0, 0, 0, 0]; sh.shields.alloc = [0, 0, 0, 0]; sh.shields.allocIntent = [0, 0, 0, 0];
  const hull = sh.hull;
  space.shipHit(g, 0, 1, { emp: true });
  const off = Object.entries(sh.systems).find(([, v]) => v === 'offline');
  ok(!!off && sh.hull === hull, 'EMP durch die Schilde: ein System offline statt Hüllenschaden (' + (off && off[0]) + ')');
  ok(!!off && g.snapshot().ship.offline[off[0]] === 12, 'Snapshot ship.offline (Restsekunden)');
  run(12.2);
  ok(!!off && sh.systems[off[0]] !== 'offline', 'nach 12 s startet das System selbst wieder');
  ok(g.C.enemyShields.pylon.join() === '4,0,0,0' && g.C.enemyShields.sentinel.join() === '3,3,3,3' && g.C.enemyShields.raider.join() === '2,1,0,1', 'Schildwerte laut Vertrag');
}

console.log('\n[M1 §9: Reisen, Docken Vaelen, Weitscan, Verstecke, Leitbake]');
{
  const { g, P, send, run, place, notices, cmd, enter, events } = setup(2);
  const sh = g.ship;
  ok(g.explore.locationsSnapshot().map((l) => l.id + (l.unknown ? '?' : '')).join() === 'hafen,splitter,b7?,vaelen?,wrack?', 'Start: Hafen + Splittergürtel bekannt, Nachbarn als „Unbekanntes Signal“');
  enter(0, 'captain');
  cmd(0, 'captain.selectDest', { dest: 'nebel' });
  ok(notices(0).some((t) => /Keine bekannte Route/.test(t)), 'nicht verbundener Ort abgelehnt');
  cmd(0, 'captain.selectDest', { dest: 'vaelen' });
  ok(sh.jump.dest === 'vaelen', 'unbekannter, aber verbundener Ort wählbar (Erkunden)');
  sh.docked = false; sh.dockedAt = null; sh.x = 1200; sh.y = 700;
  run(8.5);
  enter(1, 'helm'); cmd(1, 'helm.jump');
  ok(sh.scene === 'vaelen' && g.explore.visited.has('vaelen') && g.snapshot().world.location === 'vaelen', 'Sprung -> Vaelen besucht, world.location');
  ok(g.explore.log.some((l) => /Erstbesuch: Vaelen/.test(l.text)), 'Logbuch: Erstbesuch');
  const d = Locations.get('vaelen').scene.dock;
  sh.x = d.x - 120; sh.y = d.y; sh.vx = 0; sh.vy = 0; run(0.2);
  sh.x = d.x - 30; run(0.2);
  ok(sh.docked && sh.dockedAt === 'vaelen' && g.snapshot().shopContext === 'vaelen', 'Andocken bei Vaelen -> dockedAt, shopContext vaelen');
  send(1, { t: 'leave' });
  enter(1, 'shop');
  const m0 = g.inventory.marks;
  cmd(1, 'shop.buy', { item: 'kristalllampe' });
  ok(g.inventory.deko.includes('kristalllampe') && g.inventory.marks === m0 - 70, 'Kristalllampe bei Vaelen');
  g.inventory.marks = 500;
  cmd(1, 'shop.buy', { item: 'bolzenwerfer' });
  ok(g.upgrades.bolzenwerfer && g.inventory.marks === 340, 'Bolzenwerfer bei Vaelen günstiger (160)');
  ok(g.snapshot().ship.mounts.some((m) => m.id === 'bolzen'), 'Bolzenwerfer jetzt als Mount');
  cmd(1, 'shop.buy', { item: 'seitenturm' });
  ok(notices(1).some((t) => /Hafen/.test(t)), 'Seitenturm nur im Hafen');
  send(1, { t: 'leave' });
  // Weitscan
  send(0, { t: 'leave' });
  enter(0, 'weapons');
  const cache = Locations.get('vaelen').hidden[0];
  sh.docked = false; sh.dockedAt = null; sh.x = cache.x - 900; sh.y = cache.y + 200;
  cmd(0, 'weapons.widescan');
  ok(g.explore.isRevealed(cache.id) && g.snapshot().space.hidden.some((h) => h.id === cache.id && !h.found), 'Weitscan deckt Versteck auf (space.hidden)');
  ok(g.snapshot().mission.discoveries.found === 1 && g.snapshot().mission.discoveries.total === 12, 'Entdeckungen 1/12');
  cmd(0, 'weapons.widescan');
  ok(notices(0).some((t) => /lädt noch/.test(t)), 'Weitscan-Cooldown');
  const deko = g.inventory.deko.length;
  sh.x = cache.x; sh.y = cache.y; run(0.1);
  ok(g.explore.isFound(cache.id) && g.inventory.deko.length === deko + 1, 'drüberfliegen sammelt Versteck ein (Belohnung)');
  // Leitbake im Nebel
  send(0, { t: 'debug', cmd: 'reveal', loc: 'nebel' });
  send(0, { t: 'debug', cmd: 'goto', loc: 'nebel' });
  ok(g.explore.locationsSnapshot().find((l) => l.id === 'nebel').fog, 'Nebel: fog');
  ok(!g.explore.locationsSnapshot().find((l) => l.id === 'nebel').links.includes('relais'), 'Relais zunächst ohne Verbindung');
  const b = Locations.get('nebel').hidden.find((h) => h.kind === 'beacon');
  sh.x = b.x - 500; sh.y = b.y; g.ship.widescan.cd = 0;
  send(0, { t: 'leave' }); enter(0, 'weapons');
  cmd(0, 'weapons.widescan');
  cmd(0, 'weapons.target', { id: b.id });
  for (let k = 0; k < 8; k++) { cmd(0, 'weapons.scan', { on: true }); run(0.3); }
  ok(g.explore.isFound(b.id) && g.explore.isKnown('relais') && g.explore.isLinked('nebel', 'relais'), 'Leitbake gescannt -> Relais bekannt + Verbindung offen');
}

console.log('\n[Transfer, Außenmission B-7, Orbit-Hilfe]');
{
  const { g, P, send, run, place, placeAt, notices, events, tap, cmd } = setup(3);
  send(0, { t: 'debug', cmd: 'mission', id: 'm1', step: 'away' });
  ok(g.mission.state.stage === 'away' && g.ship.scene === 'b7', 'Debug: Mission 1 Schritt away (B-7)');
  g.ship.x = 1850; g.ship.y = 1500; g.ship.vx = 0; g.ship.vy = 0;
  place(0, W.SHIP_PADS[1].x, W.SHIP_PADS[1].y, 'down');
  placeAt(1, conSpot('transfer')); tap(1);
  ok(P(1).console === 'transfer', 'Transferkonsole');
  cmd(1, 'transfer.down');
  run(0.5);
  ok(g.ship.shields.current.every((v) => v === 0), 'während Transfer Schilde 0');
  run(3);
  ok(P(0).zone === 'away' && g.away.active && g.away.map === 'platform', 'Konsole beamt runter (3 s) auf die Plattform');
  send(0, { t: 'mark', x: 300, y: 200 });
  ok(g.away.marker && g.away.marker.x === 300, 'Markierung gesetzt');
  cmd(1, 'transfer.supply');
  ok(g.away.items.some((i) => i.kind === 'medipack') && g.inventory.medipack === 1, 'Medipack zur Markierung');
  placeAt(2, conSpot('weapons'), 'ship'); tap(2);
  ok(P(2).console === 'weapons', 'Taktikkonsole');
  g.away.drones[0].x = 310; g.away.drones[0].y = 210; g.away.drones[0].hp = 6;
  // M3a §5.6: Orbitalschlag verbraucht eine volle Ladung (bow, sonst port, sonst stbd)
  for (const k of ['bow', 'port', 'stbd']) g.ship.mount[k].charge = 0.5;
  cmd(2, 'weapons.strike');
  ok(notices(2).some((t) => /Keine Waffe voll geladen/.test(t)) && g.away.strikes.length === 0, 'Orbitalschlag ohne volle Ladung: „Keine Waffe voll geladen.“');
  g.ship.mount.bow.charge = 0.5; g.ship.mount.port.charge = 1; g.ship.mount.stbd.charge = 1;
  cmd(2, 'weapons.strike');
  ok(g.ship.mount.port.charge === 0 && g.ship.mount.stbd.charge === 1 && g.ship.mount.bow.charge === 0.5, 'Orbitalschlag verbraucht eine volle Ladung (Lanze nicht voll -> Bb)');
  run(1.6);
  ok(!g.away.drones[0].alive && events('strike').length === 1, 'Orbitalschlag trifft Drohne nach 1,5 s');
  send(2, { t: 'leave' });
  placeAt(2, conSpot('captain')); tap(2);
  cmd(2, 'captain.support', { kind: 'sensor' });
  cmd(2, 'captain.support', { kind: 'kuppel' });
  run(0.1);
  ok(g.away.drones.every((d) => !d.alive || d.revealed) && g.away.kuppelUntil > g.time && g.ship.shields.pool === g.ship.power.shields * g.C.shields.pointsPerPower - 2,'Sensor + Kuppel (Pool −2)');
  place(0, 14, 15, 'right', 'away');
  g.away.drones.forEach((d) => { d.alive = false; });
  tap(0);
  ok(P(0).console === 'sonde', 'Sonde-Konsole');
  const s = g.away.sonde; const wrong = ['mint', 'bernstein', 'rot', 'blau', 'pink', 'weiss'].find((c) => c !== g.away.codeTable[s.symbols[0]]);
  cmd(0, 'sonde.input', { color: wrong });
  ok(s.lockout > 9 && events('codeResult').some((e) => e.ok === false), 'falsche Farbe -> Sperre');
  run(10.1);
  for (const sym of s.symbols) cmd(0, 'sonde.input', { color: g.away.codeTable[sym] });
  ok(s.disabled && g.away.doorOpen, 'richtiger Code -> Sonde aus, Tür offen');
  send(0, { t: 'leave' });
  place(0, 14, 8, 'up');
  send(0, { t: 'act', down: true }); run(5.3); send(0, { t: 'act', down: false });
  ok(g.away.coreRebooted && g.away.drones.filter((d) => d.guard && d.alive).length === 2, 'Bojenkern neu gestartet -> 2 Wächter-Drohnen');
  g.away.drones.forEach((d) => { d.alive = false; });
  place(0, 27, 11, 'down'); tap(0);
  ok(P(0).carry === 'datenkern', 'Datenkern aufgehoben');
  cmd(1, 'transfer.recall', { pid: P(0).id });
  ok(P(0).zone === 'ship' && P(0).carry === 'datenkern', 'Notrückholung mit Datenkern');
  run(0.2);
  ok(g.mission.state.stage === 'decision', 'Schritt -> decision (Datenkern an Bord, niemand unten)');
  cmd(2, 'captain.choice', { option: 'decode' });
  ok(g.mission.state.stage === 'return' && g.mission.flags.decision === 'decode', 'Entscheidung decode');
  cmd(2, 'captain.selectDest', { dest: 'splitter' }); run(10);
  ok(g.ship.jump.blockedReason && !g.ship.jump.ready, 'Sprung blockiert bis die Nachhut weg ist: ' + g.ship.jump.blockedReason);
}

console.log('\n[M1 §9.4: Wrack-Außenmission]');
{
  const { g, P, send, run, place, notices, cmd, enter } = setup(1);
  send(0, { t: 'debug', cmd: 'skip' });   // Hafen-Übung erledigen (Transfer heil)
  send(0, { t: 'debug', cmd: 'reveal', loc: 'wrack' });
  send(0, { t: 'debug', cmd: 'goto', loc: 'wrack' });
  const st = Locations.get('wrack').scene.station;
  g.ship.x = st.x - 150; g.ship.y = st.y; g.ship.vx = 0; g.ship.vy = 0;
  run(0.2);
  ok(g.away.map === 'wreck', 'Transfer zielt am Wrack auf die Wrack-Karte');
  place(0, W.SHIP_PADS[0].x, W.SHIP_PADS[0].y);
  send(0, { t: 'act', down: true }); run(3.2); send(0, { t: 'act', down: false });
  ok(P(0).zone === 'away' && g.snapshot().away.map === 'wreck', 'Selbst-Transfer aufs Wrack (away.map = wreck)');
  g.away.drones.forEach((d) => { d.alive = false; });
  const marks = g.inventory.marks; const parts = g.inventory.ersatzteil;
  place(0, 25, 2, 'right');
  send(0, { t: 'act', down: true }); run(2.2); send(0, { t: 'act', down: false });
  ok(g.away.salvage.find((q) => q.x === 26 && q.y === 2).done && g.inventory.marks > marks && P(0).carry === null, 'Container E halten 2 s -> Belohnung direkt ins Inventar, kein Tragen');
  place(0, 4, 9, 'down'); send(0, { t: 'act', down: true }); send(0, { t: 'act', down: false });
  ok(g.away.loreRead && g.explore.log.some((l) => /Zaunkönig/.test(l.text)), 'Logbuch-Terminal -> Lore + Logbuch');
  place(0, 16, 7, 'down'); send(0, { t: 'act', down: true }); run(4.3); send(0, { t: 'act', down: false });
  ok(!g.away.hollow.open, 'dünne Wand ohne Weitscan: nichts passiert');
  // Weitscan aus dem Orbit (Schiff)
  g.ship.widescan.cd = 0;
  require('../server/sim/space.js').weaponsWidescan(g);
  ok(g.away.hollow.marked && g.snapshot().away.hollow.marked, 'Weitscan aus dem Orbit markiert den Hohlraum');
  send(0, { t: 'act', down: true }); run(4.3); send(0, { t: 'act', down: false });
  ok(g.away.hollow.open && !interior.awaySolid(g)(16, 8), 'markierte Wand: E halten 4 s -> Boden');
  const dk = g.inventory.deko.length;
  place(0, 15, 8, 'down'); send(0, { t: 'act', down: true }); run(2.2); send(0, { t: 'act', down: false });
  ok(g.inventory.deko.includes('aquarium') && g.inventory.deko.length === dk + 1, 'Hohlraum-Container: Aquarium + Teile');
  ok(g.inventory.ersatzteil > parts, 'Bergung bringt Ersatzteile');
}

console.log('\n[M1 §8: Planungstisch]');
{
  const { g, P, send, placeAt, notices, tap, cmd, conns } = setup(3);
  placeAt(0, conSpot('plan', 0)); tap(0);
  placeAt(1, conSpot('plan', standSpots(W.CONSOLE_TILES.plan).length - 1)); tap(1);
  ok(P(0).console === 'plan' && P(1).console === 'plan' && g.snapshot().plan.seated.length === 2, 'zwei Spieler gleichzeitig am Tisch (nicht exklusiv)');
  for (let k = 0; k < 6; k++) cmd(0, 'plan.pin', { map: 'star', x: 100 + k * 10, y: 200, label: 'ziel' });
  ok(g.plan.pins.filter((q) => q.owner === P(0).id).length === 5 && notices(0).some((t) => /Maximal 5/.test(t)), 'höchstens 5 Pins je Spieler');
  cmd(1, 'plan.pin', { map: 'star', x: 300, y: 200, label: 'gefahr' });
  cmd(1, 'plan.pin', { map: 'wreck', x: 300, y: 200, label: 'landeplatz' });
  ok(notices(1).some((t) => /noch nicht gescannt/.test(t)), 'Außenkarte erst nach Scan pinnbar');
  cmd(1, 'plan.pin', { map: 'star', x: 1, y: 1, label: 'quatsch' });
  ok(notices(1).some((t) => /Label/.test(t)), 'ungültiges Label abgelehnt');
  const foreign = g.plan.pins.find((q) => q.owner === P(0).id);
  cmd(1, 'plan.unpin', { id: foreign.id });
  ok(notices(1).some((t) => /eigene/.test(t)) && g.plan.pins.includes(foreign), 'fremden Pin nicht entfernbar');
  cmd(0, 'plan.unpin', { id: foreign.id });
  ok(!g.plan.pins.includes(foreign), 'eigenen Pin entfernt');
  g.removeConnection(conns[1]);
  ok(g.snapshot().plan.seated.length === 1 && g.plan.pins.some((q) => q.owner === P(1).id), 'Disconnect am Tisch: Platz frei, Pins bleiben');
}

console.log('\n[Selbst-Transfer, Transfer broken, Bots, Notfall]');
{
  const { g, P, send, run, place } = setup(1);
  send(0, { t: 'debug', cmd: 'mission', id: 'm1', step: 'away' });
  g.ship.x = 1850; g.ship.y = 1500; g.ship.vx = 0; g.ship.vy = 0;
  place(0, W.SHIP_PADS[0].x, W.SHIP_PADS[0].y);
  send(0, { t: 'act', down: true }); run(3.2); send(0, { t: 'act', down: false });
  ok(P(0).zone === 'away', 'Selbst-Transfer runter (E halten 3 s)');
  g.ship.systems.transfer = 'broken';
  run(1);
  const pads = Maps.PLATFORM_PADS[0]; place(0, pads.x, pads.y);
  send(0, { t: 'act', down: true }); run(1); send(0, { t: 'act', down: false });
  ok(P(0).zone === 'away', 'Transfer broken -> kein Hochbeamen');
  run(40);
  ok(g.ship.systems.transfer !== 'broken', 'Bots reparieren den Transfer: ' + g.ship.systems.transfer);
  ok(Math.hypot(g.ship.x - 1850, g.ship.y - 1500) < 5, 'unbesetzte Steuer auf STOPP: Schiff bleibt stehen (M3b: keine Sonderbremse, Stufe bleibt)');
  send(0, { t: 'act', down: true }); run(6.2); send(0, { t: 'act', down: false });
  ok(P(0).zone === 'ship', 'danach Selbst-Transfer hoch');
  g.inventory.ersatzteil = 0; g.ship.systems.engines = 'broken';
  run(46);
  ok(g.ship.systems.engines !== 'broken', 'Notreparatur nach 45 s ohne Ersatzteile');
  const marks = g.inventory.marks;
  g.ship.hull = 0; g.ship.fireList.push({ tx: FLOOR_PAIR.b.x, ty: FLOOR_PAIR.b.y, spreadT: 0, dmgT: 0 }); g.ship.breachList.push({ tx: FLOOR_PAIR.a.x, ty: FLOOR_PAIR.a.y, t: 0 });
  run(0.1);
  ok(g.ship.hull === 30 && g.ship.fireList.length === 0 && g.ship.breachList.length === 0 && g.inventory.marks === Math.max(0, marks - 50) && g.stats.emergencies === 1, 'Notfallprotokoll (inkl. Lecks verschäumt)');
}

console.log('\n[Missions-Engine, Mission 2, Ende M1, Snapshot]');
{
  const { g, P, send, run, cmd, enter, notices } = setup(2);
  send(0, { t: 'debug', cmd: 'mission', id: 'm2', step: 'relay' });
  ok(g.mission.activeId === 'm2' && g.mission.missions.m1.state === 'done' && g.ship.scene === 'relais', 'Debug: Mission 2 Schritt relay (m1 als erledigt)');
  ok(g.space.enemies.filter((e) => e.kind === 'pylon').length === 3, '3 Pylonen');
  const s = g.snapshot();
  const sz = Buffer.byteLength(JSON.stringify(s));
  ok(sz < 12 * 1024, 'Snapshot im Kampf < 12 KB (' + sz + ' B)');
  for (const k of ['world', 'quarters', 'deco', 'plan', 'shopContext']) ok(k in s, 'Snapshot-Feld ' + k);
  for (const k of ['dockedAt', 'reactor', 'markers', 'tscan', 'widescan', 'mounts', 'npcs']) ok(k in s.ship, 'Snapshot ship.' + k);
  ok(['state', 'output', 'used', 'overloadLeft', 'switches', 'restartProgress'].every((k) => k in s.ship.reactor), 'ship.reactor laut §6');
  ok(['active', 'list', 'discoveries'].every((k) => k in s.mission) && s.mission.active.id === 'm2', 'mission.active/list/discoveries');
  ok(s.space.enemies[0].shieldsMax.length === 4 && 'hidden' in s.space, 'space.enemies.shieldsMax, space.hidden');
  ok(['map', 'salvage', 'hollow'].every((k) => k in s.away), 'away.map/salvage/hollow');
  enter(0, 'captain');
  cmd(0, 'captain.scan', { on: true });
  ok(notices(0).some((t) => /Wächter/.test(t)), 'Relaiskern-Scan erst ohne Wächter');
  send(0, { t: 'debug', cmd: 'skip' });
  run(0.5);
  ok(g.mission.state.stage === 'finale', 'Relaiskern gescannt -> Finale');
  run(5);
  // M2 „Schildwall“: nach Mission 2 geht die Kampagne mit Mission 3 weiter (CONTRACT-M2 §3.2)
  // S2: Teaser „Fortsetzung folgt“ abgelöst (Spielleiter) – kein Teaser mehr nach m2
  ok(g.phase === 'play' && g.mission.missions.m2.state === 'done' && g.mission.activeId === 'm3' && !g.mission.state.teaser, 'Ende M2: Mission 3 beginnt (S2: kein Teaser mehr)');
  run(g.C.missionM3.offerAfter + 1);
  ok(g.mission.state.radio && g.mission.state.radio.needsAccept && /Kesh/.test(g.mission.state.radio.text), 'Tesk bietet Mission 3 an');
  const chapters = [];
  const watch = { send: (o) => { if (o && o.t === 'event' && (o.kind === 'chapter' || o.kind === 'ending')) chapters.push(o); } };
  g.addConnection(watch); watch.observer = true;
  send(0, { t: 'debug', cmd: 'mission', id: 'm3', step: 'extract' });
  g.mission.v = {}; g.inventory.tafel = 1; g.aways.kesh.active = true;
  run(0.5);
  // S2 Entscheidung 9: in der Kampagne Kapitelkarte und weiterspielen (Direktstart m3: Ende wie bisher, test-regiebuch)
  ok(g.phase === 'play' && g.mission.missions.m3.state === 'done' && chapters.some((o) => o.kind === 'chapter') && !chapters.some((o) => o.kind === 'ending'), 'Ende M3 (Kampagne): Kapitelkarte, Spiel läuft weiter');
  ok(g.snapshot().mission.objectives[0].id === 'explore', 'nach m3: frei erkunden');
  cmd(0, 'captain.listen');
  ok(!(g.mission.state.radio && /Belohnung/.test(g.mission.state.radio.text)), 'S2: kein Teaser zum Abhören');
  // Engine: unbekannte Bausteine werden gezählt, nicht verschluckt
  const errs = g.errors;
  g.mission.cond({ quatsch: 1 });
  ok(g.errors === errs + 1, 'unbekannte Bedingung zählt als Fehler');
  g.errors = errs;
}

console.log('\n[Missions-Engine: Ort verlassen und zurück]');
{
  const { g, send, run, cmd, enter } = setup(1);
  send(0, { t: 'debug', cmd: 'mission', id: 'm2', step: 'relay' });
  const sh = g.ship; sh.x = 1000; sh.y = 1000; sh.vx = 0; sh.vy = 0;
  enter(0, 'captain'); cmd(0, 'captain.selectDest', { dest: 'nebel' });
  ok(!g.ship.jump.blockedReason || !/Störsender/.test(g.ship.jump.blockedReason), 'Pylonen haben keinen Störsender – Rückzug möglich');
  run(8.5); send(0, { t: 'leave' }); enter(0, 'helm'); cmd(0, 'helm.jump');
  ok(g.ship.scene === 'nebel' && g.space.enemies.length === 0, 'Relais verlassen');
  run(35);
  ok(g.space.enemies.length === 0, 'Wächter erscheint nicht am falschen Ort');
  send(0, { t: 'leave' }); enter(0, 'captain'); cmd(0, 'captain.scan', { on: true });
  ok(g.mission.scanTarget() === null, 'Missions-Scan nur am Relais');
  cmd(0, 'captain.selectDest', { dest: 'relais' }); run(8.5); send(0, { t: 'leave' }); enter(0, 'helm'); cmd(0, 'helm.jump');
  run(0.2);
  ok(g.ship.scene === 'relais' && g.space.enemies.filter((e) => e.kind === 'pylon').length === 3 && g.mission.state.stage === 'relay', 'zurück am Relais: Schritt beginnt neu (3 Pylonen)');
}

console.log('\n[Debug-Befehle M1, Schutz]');
{
  const { g, send, notices } = setup(1);
  send(0, { t: 'debug', cmd: 'reveal', loc: 'all' });
  ok(Locations.LOCATIONS.every((l) => g.explore.isKnown(l.id)), 'debug reveal all');
  send(0, { t: 'debug', cmd: 'goto', loc: 'nebel' });
  ok(g.ship.scene === 'nebel', 'debug goto');
  send(0, { t: 'debug', cmd: 'reactor', state: 'offline' }); g.step();
  ok(g.ship.reactor.state === 'offline', 'debug reactor offline');
  send(0, { t: 'debug', cmd: 'spawn', kind: 'sentinel' });
  send(0, { t: 'debug', cmd: 'scanall' });
  ok(g.space.enemies.every((e) => e.scanned) && g.explore.hiddenHere().every((h) => g.explore.isRevealed(h.id)), 'debug scanall');
  const g2 = setup(1, { debug: false });
  g2.send(0, { t: 'debug', cmd: 'hull', n: 1 });
  ok(g2.g.ship.hull === 100 && g2.notices(0).some((t) => /deaktiviert/.test(t)), 'Debug ohne --debug abgelehnt');
}

console.log('\n[M0: Raumcode]');
{
  const g = new Game({ noStore: true, seed: 5, roomCode: 'k7qm', env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(o) { this.inbox.push(o); } };
  g.addConnection(c);
  g.step(); g.step();
  g.broadcast(g.snapshot());
  ok(c.inbox.length === 0, 'vor hello: keine Snapshots/Events');
  g.handleMessage(c, { t: 'hello', clientId: 'R1', name: 'Rita', color: 0 });
  ok(c.inbox.some((m) => m.t === 'error' && m.code === 'badcode') && g.players.length === 0 && !c.player, 'hello ohne Code -> badcode, kein Spieler');
  g.handleMessage(c, { t: 'hello', clientId: 'R1', name: 'Rita', color: 0, code: 'XXXX' });
  ok(c.inbox.filter((m) => m.code === 'badcode').length === 2 && g.players.length === 0, 'falscher Code -> badcode');
  g.handleMessage(c, { t: 'hello', clientId: 'R1', name: 'Rita', color: 0, code: 'K7QM' });
  const w = c.inbox.find((m) => m.t === 'welcome');
  ok(!!w && w.roomCode === 'K7QM' && g.players.length === 1, 'richtiger Code -> welcome mit roomCode');
  const { resolveRoomCode } = require('../server/index.js');
  ok(resolveRoomCode('off') === null && resolveRoomCode('ab12') === 'AB12', 'ROOM_CODE off / fest');
}

console.log('\n[M0: Hafen-Übung überspringen]');
{
  const g = new Game({ noStore: true, seed: 5, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const conns = [0, 1].map((i) => { const c = { inbox: [], send(o) { this.inbox.push(o); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'S' + i, name: 'S' + i, color: i }); return c; });
  g.handleMessage(conns[1], { t: 'lobbyOpt', skipDrill: true });
  ok(g.snapshot().lobby.skipDrill === true, 'lobbyOpt -> Snapshot lobby.skipDrill');
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  ok(g.phase === 'play' && g.mission.state.stage === 'dock', 'Start in Schritt dock');
  ok(g.ship.fireList.length === 0 && g.ship.breachList.length === 0 && g.ship.systems.transfer === 'ok', 'kein Kabelbrand, kein Leck, Transfer heil');
  let radioAt = null;
  for (let k = 0; k < 30 * 12 && radioAt === null; k++) { g.step(); if (g.mission.state.radio && g.mission.state.radio.needsAccept) radioAt = g.mission.stageTime; }
  ok(radioAt !== null && radioAt <= 10, 'Funkspruch von Tesk nach ' + (radioAt && radioAt.toFixed(1)) + ' s (≤ 10 s)');
  const g2 = setup(1).g;
  ok(g2.ship.fireList.length === 1 && g2.ship.systems.transfer === 'broken', 'ohne Schalter: Übung wie bisher');
}

console.log('\n[M0: Lager leer / debug inv]');
{
  // M3a §8.2: Bots reparieren Systeme nur aus der Reparaturliste; „part“ ohne Teil im Lager -> Meldung, Eintrag wird flick
  const { g, send, run, events, cmd, enter } = setup(2);
  send(0, { t: 'debug', cmd: 'skip' });
  send(0, { t: 'debug', cmd: 'inv', item: 'ersatzteil', n: 0 });
  ok(g.inventory.ersatzteil === 0, 'debug inv setzt Bestand');
  g.ship.systems.engines = 'broken';
  enter(1, 'captain');
  cmd(1, 'captain.repair', { system: 'engines', mode: 'part' });
  run(3);
  ok(events('oda').filter((m) => /Kein Ersatzteil mehr im Lager/.test(m.text)).length === 1, 'Schrauber melden einmalig „Kein Ersatzteil mehr im Lager“');
  const q = g.ship.repairQueue.find((x) => x.system === 'engines');
  ok(!q || q.mode === 'flick', 'Eintrag wird zu flick');
}

// ======================================================================
// M4 Stufe 1 „Zwei Decks“ (CONTRACT-M4 §2.4, §8): Lift, Notleiter, Bots über den Lift, Ivo auf Deck II, kein Feuer auf Deck II
console.log('\n[M4 Zwei Decks: Lift und Leiter]');
{
  const S = Maps.DECK_STRIDE;
  const deckOfP = (p) => Maps.deckOfPx(p.y);
  const tileOf = (o) => Physics.toTile(o.x, o.y);
  const { g, P, send, run, place, events } = setup(3);
  g.mission.isDrill = () => false;   // Übung aus (sonst stehen die Schrauber)
  g.ship.fireList = []; g.ship.breachList = [];
  const L = g.C.lift;
  ok(L && L.rideTime === 1.5 && L.rideTimeLowPower === 3 && L.ladderTime === 2 && L.arrivalClearRadius === 1, 'CONFIG.lift laut Vertrag');
  // drei Spieler gleichzeitig im Lift, zwei davon auf derselben Kachel
  const lt = Maps.SHIP_LIFTS[0].tiles;
  place(0, lt[0][0], lt[0][1]); place(1, lt[0][0], lt[0][1]); place(2, lt[3][0], lt[3][1]);
  for (let i = 0; i < 3; i++) { send(i, { t: 'act', down: true }); send(i, { t: 'act', down: false }); }
  ok([0, 1, 2].every((i) => P(i).lift && P(i).lift.to === 1 && P(i).lift.T === 1.5), 'drei Spieler gleichzeitig im Lift (to 1, T 1,5 s)');
  const snap0 = g.snapshot();
  ok(snap0.players.every((q) => q.lift && q.lift.to === 1 && q.lift.T === 1.5 && q.deck === 0), 'Snapshot players[].lift { to, t, T } und deck 0');
  ok(events('lift').filter((e) => e.phase === 'start').length === 3, 'Ereignis lift (phase start) je Spieler');
  // Eingaben gesperrt, kein Schaden während der Fahrt
  const x0 = P(0).x, y0 = P(0).y, hp0 = P(0).hp;
  send(0, { t: 'input', seq: 1, mx: 1, my: 0 });
  interior.damagePlayer(g, P(0), 30, 'test');
  let ticks = 0;
  while (P(2).lift && ticks < 200) { g.step(); ticks++; }
  send(0, { t: 'input', seq: 2, mx: 0, my: 0 });
  const rideS = ticks / g.C.tickHz;
  ok(Math.abs(rideS - 1.5) <= 0.1, `Liftfahrt gemessen ${rideS.toFixed(2)} s (1,5 s ± 0,1)`);
  ok(P(0).hp === hp0, 'im Lift kein Schaden');
  ok([0, 1, 2].every((i) => !P(i).lift && deckOfP(P(i)) === 1), 'alle drei auf Deck II angekommen');
  const t0 = tileOf(P(0)), t1 = tileOf(P(1)), t2 = tileOf(P(2));
  ok(t2.x === lt[3][0] && t2.y === lt[3][1] + S, 'Ankunft auf derselben lokalen Kachel (y + 16)');
  ok(!(t0.x === t1.x && t0.y === t1.y) && Math.abs(t0.x - t1.x) + Math.abs(t0.y - t1.y) <= 2, `belegte Zielkachel -> freie Nachbarkachel (${t0.x},${t0.y}) / (${t1.x},${t1.y})`);
  ok(Math.abs(x0 - P(0).x) < 64 && P(0).y > y0 + S * 32 - 64, 'keine Bewegung während der Fahrt (nur Teleport)');
  ok(events('lift').filter((e) => e.phase === 'arrive').length === 3, 'Ereignis lift (phase arrive) je Spieler');
  const snap1 = g.snapshot();
  ok(snap1.players.every((q) => q.deck === 1 && !('lift' in q)), 'Snapshot: deck 1, lift nur während der Fahrt');
  // Raumname auf Deck II
  ok(Maps.roomAt(t2.x, t2.y).name === 'Liftvorraum', 'roomAt auf Deck II: Liftvorraum');
  // zurück nach oben, Notstrom: 3 s
  g.ship.reactorCtl.state = 'offline';
  place(0, lt[1][0], lt[1][1] + S);
  send(0, { t: 'act', down: true }); send(0, { t: 'act', down: false });
  ok(P(0).lift && P(0).lift.to === 0 && P(0).lift.T === 3, 'Notstrom (Reaktor abgeschaltet): Liftfahrt 3 s');
  ticks = 0; while (P(0).lift && ticks < 300) { g.step(); ticks++; }
  ok(Math.abs(ticks / 30 - 3) <= 0.1 && deckOfP(P(0)) === 0, `Notstrom-Fahrt gemessen ${(ticks / 30).toFixed(2)} s, oben angekommen`);
  g.ship.reactorCtl.state = 'online';
  // E vor dem Lift (nicht darauf) startet keine Fahrt
  place(1, 28, 18, 'left');
  send(1, { t: 'act', down: true }); send(1, { t: 'act', down: false });
  ok(!P(1).lift, 'neben dem Lift: keine Fahrt (nur auf der Plattform)');
  // Notleiter: E halten 2 s
  const lad = Maps.SHIP_LADDERS;
  place(1, lad[1].x, lad[1].y, 'down');
  send(1, { t: 'act', down: true }); run(1.0); send(1, { t: 'act', down: false }); run(0.1);
  ok(deckOfP(P(1)) === 1 && !P(1).hold, 'Leiter: zu früh losgelassen -> bleibt unten');
  send(1, { t: 'act', down: true });
  run(1.0);
  const sl = g.snapshot().players[1];
  ok(sl.ladder && sl.ladder.T === 2 && sl.ladder.t > 0.8 && sl.action && sl.action.kind === 'ladder', 'Snapshot players[].ladder { t, T } + action ladder');
  let lt2 = 0; while (deckOfP(P(1)) === 1 && lt2 < 120) { g.step(); lt2++; }
  send(1, { t: 'act', down: false });
  const ladS = 1.0 + lt2 / 30;
  ok(deckOfP(P(1)) === 0 && Math.abs(ladS - 2) <= 0.1, `Leiter gemessen ${ladS.toFixed(2)} s, oben an der Leiter (${tileOf(P(1)).x},${tileOf(P(1)).y})`);
  ok(tileOf(P(1)).x === lad[0].x && tileOf(P(1)).y === lad[0].y, 'Leiter: Ankunft auf der Gegenleiter');
}

console.log('\n[M4 Zwei Decks: kein Feuer/Leck auf Deck II]');
{
  const { g, send, conns } = setup(1);
  g.ship.fireList = []; g.ship.breachList = [];
  let bad = 0;
  for (let y = 16; y <= 28; y++) for (let x = 0; x < W.ship.w; x++) if (interior.addFire(g, x, y) || interior.addBreach(g, x, y)) bad++;
  const lt = Maps.SHIP_LIFTS[0].tiles;
  for (const [x, y] of lt) if (interior.addFire(g, x, y) || interior.addBreach(g, x, y)) bad++;
  for (const l of Maps.SHIP_LADDERS) if (interior.addFire(g, l.x, l.y) || interior.addBreach(g, l.x, l.y)) bad++;
  ok(bad === 0 && g.ship.fireList.length === 0 && g.ship.breachList.length === 0, 'addFire/addBreach lehnen Deck II, Lift und Leiter ab');
  let wrong = 0;
  for (let k = 0; k < 400; k++) for (let r = 0; r < 4; r++) for (const wall of [false, true]) {
    const t = interior.randomRegionFloor(g, r, wall);
    if (!t || Maps.deckOf(t.y) !== 0 || !Maps.hazardAllowed(t.x, t.y)) wrong++;
  }
  ok(wrong === 0, 'Treffer-Feuer/-Lecks (randomRegionFloor, 3200 Würfe) nur auf Deck I');
  // Feuer neben dem Lift breitet sich nie auf die Plattform aus (300 s Ausbreitung, Übung aus)
  g.mission.isDrill = () => false;
  g.god = true;
  const lift0 = lt[2];
  interior.addFire(g, lift0[0] + 2, lift0[1]);
  const savedMax = g.C.fire.max; g.C.fire.max = 40;
  const botsMod = require('../server/sim/bots.js');
  const botUpdate = botsMod.update;
  botsMod.update = () => {};   // Schrauber aus, sonst löschen sie sofort
  try { for (let k = 0; k < 300 * 30; k++) g.step(); } finally { botsMod.update = botUpdate; g.C.fire.max = savedMax; }
  ok(g.ship.fireList.length > 1 && g.ship.fireList.every((f) => Maps.deckOf(f.ty) === 0 && Maps.hazardAllowed(f.tx, f.ty)),
    `Ausbreitung: ${g.ship.fireList.length} Feuer, keines auf Lift/Leiter/Deck II`);
  // Debug-Feuer auf Deck II wird abgelehnt
  g.ship.fireList = [];
  send(0, { t: 'debug', cmd: 'fire', x: 15, y: 22 });
  ok(g.ship.fireList.length === 0, 'Debug-Feuer auf Deck II: keins');
  void conns;
}

console.log('\n[M4 Zwei Decks: Bots und Ivo]');
{
  const { g, run } = setup(1);   // solo: Bot-Automatik an
  g.mission.isDrill = () => false;
  g.ship.fireList = []; g.ship.breachList = [];
  for (const s of Object.keys(g.ship.systems)) g.ship.systems[s] = 'ok';
  g.inventory.ersatzteil = 3;
  g.ship.systems.battery_port = 'broken';
  let carried = false, onDeck2 = false;
  for (let k = 0; k < 90 * 30 && g.ship.systems.battery_port !== 'ok'; k++) {
    g.step();
    for (const b of g.bots) { if (b.carry === 'ersatzteil') carried = true; if (Maps.deckOfPx(b.y) !== 0 || b.lift) onDeck2 = true; }
  }
  ok(g.ship.systems.battery_port === 'ok' && carried && g.inventory.ersatzteil === 2, `Bot holt Ersatzteil aus dem Regal und repariert auf Deck I (Lager ${g.inventory.ersatzteil})`);
  ok(!onDeck2, 'Bots bleiben dabei auf Deck I');
  // Bot steht auf Deck II -> fährt Lift (gleiche Zeit) und repariert oben
  const b = g.bots[0];
  for (const o of g.bots) { o.task = null; o.path = null; o.carry = null; }
  const c = Physics.tileCenter(15, 22); b.x = c.x; b.y = c.y;
  g.ship.systems.thruster_port = 'damaged';
  let rode = null, liftT = 0, sawSnap = false;
  for (let k = 0; k < 120 * 30 && g.ship.systems.thruster_port !== 'ok'; k++) {
    g.step();
    if (b.lift) { rode = rode || b.lift.T; liftT++; if (!sawSnap) { const sb = g.snapshot().bots.find((q) => q.id === b.id); sawSnap = !!(sb && sb.lift && sb.lift.to === 0); } }
  }
  ok(rode === g.C.lift.rideTime && Math.abs(liftT / 30 - rode) <= 0.1, `Bot fährt Lift (T ${rode} s, gemessen ${(liftT / 30).toFixed(2)} s)`);
  ok(sawSnap, 'Snapshot bots[].lift während der Fahrt');
  ok(g.ship.systems.thruster_port === 'ok' && Maps.deckOfPx(b.y) === 0, 'Bot von Deck II repariert die Düse auf Deck I');
  // Ivo bleibt auf Deck II
  g.mission.flags.technikerRescued = true;
  let ivoUp = 0, ivoMoved = 0, last = null;
  for (let k = 0; k < 120 * 30; k++) {
    g.step();
    if (g.ivo) { if (Maps.deckOfPx(g.ivo.y) !== 1) ivoUp++; const tt = Physics.toTile(g.ivo.x, g.ivo.y); const key = tt.x + ',' + tt.y; if (key !== last) { ivoMoved++; last = key; } }
  }
  ok(g.ivo && ivoUp === 0 && ivoMoved > 10, `Ivo bleibt auf Deck II (${ivoMoved} Kachelwechsel in 120 s)`);
  run(0);
}

console.log('\n[M4 Zwei Decks: Gefechtsalarm]');
{
  const S = require('../server/sim/space.js');
  for (const below of [true, false]) {
    const g = new Game({ noStore: true, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'A', name: 'A', color: 0 });
    g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' });
    g.handleMessage(c, { t: 'ready', ready: true });
    if (g.arena) g.arena.nextAt = null;
    g.space.enemies = []; g.space.projectiles = [];
    g.step();
    const p = g.players[0];
    if (below) { const t = Physics.tileCenter(15, 22); p.x = t.x; p.y = t.y; p.console = null; }
    c.inbox.length = 0;
    const en = S.spawnEnemy(g, 'raider', { x: g.ship.x + 250, y: g.ship.y, facing: Math.PI });
    en.hp = en.hpMax = 9999;
    const noFire = () => { for (const k of ['bow', 'port', 'stbd']) if (g.ship.mount[k]) g.ship.mount[k].charge = 0; };
    let firstShot = null;
    const pinAt = { x: en.x, y: en.y, angle: en.angle };
    for (let k = 0; k < 14 * 30; k++) {
      noFire();
      Object.assign(en, pinAt); en.retreatUntil = 0;   // Jäger festhalten: Bug zum Schiff, in Reichweite
      g.step();
      const shot = g.space.projectiles.some((q) => q.kind === 'enemy' || q.kind === 'emp') || g.space.enemies.some((e) => e.tele);
      if (shot && firstShot == null) firstShot = k / 30;
      if (Maps.deckOfPx(p.y) === 1 && below) { /* bleibt unten */ }
    }
    const odaHit = c.inbox.some((m) => m.kind === 'oda' && /Lift im Liftvorraum/.test(m.text));
    if (below) {
      ok(odaHit, 'Spieler auf Deck II: ODA „Alle auf Station – Lift im Liftvorraum.“');
      ok(firstShot == null || firstShot >= 8 - 0.05, `erster Feindkontakt ≥ 8 s nach dem Alarm (erster Schuss ${firstShot == null ? '–' : firstShot.toFixed(1) + ' s'})`);
    } else {
      ok(!odaHit, 'alle auf Deck I: keine Lift-Ansage');
      ok(firstShot != null && firstShot < 8, `ohne Spieler auf Deck II schießt der Jäger früher (${firstShot == null ? '–' : firstShot.toFixed(1) + ' s'})`);
    }
  }
}

console.log('\n[Teaser-Generator / Schema]');
(async () => {
  ok(generator.FALLBACK.length === 6, '6 Archiv-Missionen');
  for (const m of generator.FALLBACK) ok(Schema.validate(Schema.MISSION_SCHEMA, { title: m.title, from: m.from, briefing: m.briefing, reward: m.reward, hook: m.hook }).ok, 'Archiv gültig: ' + m.title);
  const env = { MISSION_SOURCE: 'bridge', CLAUDE_BRIDGE_TOKEN: 'geheim', CLAUDE_BRIDGE_URL: 'http://127.0.0.1:9' };
  const r1 = await generator.generate({ bribed: false }, { env, bridgeImpl: async () => { throw new Error('offline'); } });
  ok(r1.source === 'archiv', 'Bridge-Fehler -> Archiv');
  console.log(`\n${n - fails}/${n} Feature-Tests bestanden.`);
  process.exit(fails ? 1 : 0);
})();
