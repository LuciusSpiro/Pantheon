'use strict';
// M3a „Breitseite & Schaden“ (CONTRACT-M3 §14): Systeme, Reparaturwege, Schildstoß, Ladungen, Zielphase, Ladepunkte,
// Bots auf Befehl, Trefferauswahl, Altnamen, Snapshot. Direkt gegen die Game-Klasse, ohne Netz.
// Aufbau per Debug-Befehl bzw. direktem Zustand (nur Testvorbereitung), geprüft wird über echte Befehle und die
// Vertragsfunktionen aus §9.4/§9.5.
//   node tools/test-m3.js            -> alle Abschnitte
//   node tools/test-m3.js tele burst -> nur Abschnitte, deren Name einen der Begriffe enthält
const Physics = require('../shared/physics.js');
const Maps = require('../shared/maps.js');
const Protocol = require('../shared/protocol.js');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const W = require('../server/world.js');
const space = require('../server/sim/space.js');
const interior = require('../server/sim/interior.js');

const M3 = CONFIG.spaceM3;
const FILTER = process.argv.slice(2).map((s) => s.toLowerCase());
const SYS14 = Protocol.SYSTEMS.filter((s) => s !== 'weapons');
const COMBAT12 = SYS14.filter((s) => s !== 'life' && s !== 'transfer');

let fails = 0, n = 0;
const missing = new Set();
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const near = (a, b, tol) => typeof a === 'number' && Math.abs(a - b) <= tol;
// Vertragsfunktion holen; fehlt sie, zählt der Aufruf als Fehler (statt den ganzen Lauf abzubrechen)
function fn(mod, modName, name) {
  if (typeof mod[name] === 'function') return mod[name];
  return (...a) => { if (!missing.has(modName + '.' + name)) { missing.add(modName + '.' + name); console.log(`  FEHLER ${modName}.${name} fehlt (Vertrag §9.4/§9.5)`); fails++; n++; } throw new Error('fehlt: ' + name); };
}
const S = {
  weaponsFire: fn(space, 'space', 'weaponsFire'), weaponsAlloc: fn(space, 'space', 'weaponsAlloc'), weaponsHold: fn(space, 'space', 'weaponsHold'),
  captainBurst: fn(space, 'space', 'captainBurst'), chargePoints: fn(space, 'space', 'chargePoints'), shieldCaps: fn(space, 'space', 'shieldCaps'),
  turnCaps: fn(space, 'space', 'turnCaps'), consumeFullCharge: fn(space, 'space', 'consumeFullCharge'), shipHit: fn(space, 'space', 'shipHit'),
  maxSpeed: fn(space, 'space', 'maxSpeed'), damageEnemy: fn(space, 'space', 'damageEnemy'), spawnEnemy: fn(space, 'space', 'spawnEnemy'),
  enemyTeleSnap: fn(space, 'space', 'enemyTeleSnap'),
};
const I = {
  hitSystems: fn(interior, 'interior', 'hitSystems'), systemSector: fn(interior, 'interior', 'systemSector'), emitterFor: fn(interior, 'interior', 'emitterFor'),
  isFragile: fn(interior, 'interior', 'isFragile'), repairSystem: fn(interior, 'interior', 'repairSystem'),
};

function section(name, body) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n[' + name + ']');
  try { body(); } catch (e) {
    if (!/^fehlt: /.test(e.message)) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); }
    else console.log('  (Abschnitt abgebrochen: ' + e.message + ')');
  }
}

// ---------- Aufbau ----------
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
const stationTiles = (sys) => (W.STATIONS || []).filter((s) => s.system === sys).map((s) => ({ x: s.x, y: s.y }));
const sysSpot = (sys) => standSpots(stationTiles(sys).length ? stationTiles(sys) : W.SYSTEM_TILES[sys])[0];
const conSpot = (con) => standSpots(W.CONSOLE_TILES[con])[0];

// Testgelände Raumkampf (Lobby-Start): abgelegt, ohne Brocken, Crew auf der Brücke. Wellen abgeschaltet.
function arena(players, opts) {
  const o = opts || {};
  const g = new Game({ noStore: true, seed: o.seed || 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const conns = [];
  for (let i = 0; i < players; i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'M' + i, name: 'M' + i, color: i }); conns.push(c);
  }
  g.handleMessage(conns[0], { t: 'lobbyOpt', startMission: 'arena_space' });
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = []; g.space.projectiles = [];
  const sh = g.ship; sh.x = 1100; sh.y = 1500; sh.angle = 0; sh.vx = 0; sh.vy = 0;
  if ('turnVel' in sh) sh.turnVel = 0;
  const P = (i) => g.players[i];
  const send = (i, m) => g.handleMessage(conns[i], m);
  const run = (sec, each) => { for (let k = 0; k < Math.round(sec * 30); k++) { if (each) each(); g.step(); } };
  const place = (i, s) => { const p = P(i); const c = Physics.tileCenter(s.x, s.y); p.x = c.x; p.y = c.y; p.dir = s.dir || 'down'; p.input.mx = 0; p.input.my = 0; };
  const leave = (i) => { if (P(i).console) send(i, { t: 'leave' }); };
  const tap = (i) => { send(i, { t: 'act', down: true }); send(i, { t: 'act', down: false }); };
  const enter = (i, con) => { leave(i); place(i, conSpot(con)); tap(i); return P(i).console === con; };
  const cmd = (i, c, extra) => send(i, Object.assign({ t: 'cmd', c }, extra || {}));
  const dbg = (i, extra) => send(i, Object.assign({ t: 'debug' }, extra));
  const notices = (i) => conns[i].inbox.filter((m) => m.kind === 'notice').map((m) => m.text);
  const events = (kind) => conns[0].inbox.filter((m) => m.t === 'event' && m.kind === kind);
  const clearInbox = () => { for (const c of conns) c.inbox.length = 0; };
  return { g, conns, P, send, run, place, leave, tap, enter, cmd, dbg, notices, events, clearInbox };
}
// Gegner fest an einer Stelle (Position/Ausrichtung je Tick zurückgesetzt), ohne eigene Schüsse
function pinnedEnemy(g, kind, x, y, angle, opts) {
  const o = opts || {};
  const e = S.spawnEnemy(g, kind, { x, y, facing: angle != null ? angle : Math.atan2(g.ship.y - y, g.ship.x - x) });
  if (o.hp) { e.hp = e.hpMax = o.hp; }
  if (o.noShields !== false) e.shields = [0, 0, 0, 0];
  e.pin = { x, y, angle: e.angle };
  return e;
}
function pin(g) {
  for (const e of g.space.enemies) if (e.pin) {
    e.x = e.pin.x; e.y = e.pin.y; e.angle = e.pin.angle;
    if (!e.keepFire) { e.fireT = -999; }
    e.shields = e.keepShields ? e.shields : [0, 0, 0, 0];
  }
  g.space.projectiles = g.space.projectiles.filter((q) => q.kind === 'bolzen');
}
const mountOf = (g, id) => (g.ship.mount || {})[id];
function setCharge(g, id, v) { const m = mountOf(g, id); if (m) m.charge = v; return !!m; }
const snapMount = (s, id) => (s.ship.mounts || []).find((m) => m.id === id);
// Waffen leer halten (sonst feuert die Automatik bei unbesetzter Taktik in Tests hinein)
function noFire(g) { for (const k of ['bow', 'port', 'stbd']) setCharge(g, k, 0); }
function resetSystems(g) {
  for (const s of Object.keys(g.ship.systems)) g.ship.systems[s] = 'ok';
  g.ship.offline = {};
  if (g.ship.fragile) for (const k of Object.keys(g.ship.fragile)) delete g.ship.fragile[k];
}
function setPower(g, pw) { g.ship.powerIntent = Object.assign({}, g.ship.power, pw); Object.assign(g.ship.power, pw); }

// ======================================================================
section('Snapshot und Startwerte (§9.3, §10, §5.2)', () => {
  const { g } = arena(1);
  g.step();
  const s = g.snapshot();
  const sh = s.ship;
  ok(Protocol.VERSION === 3, 'Protocol.VERSION 3');
  ok(SYS14.every((k) => k in sh.systems) && 'weapons' in sh.systems, 'ship.systems: alle 14 Systeme + Altname weapons');
  ok(typeof sh.turnVel === 'number' && sh.turnCap && sh.turnCap.port === 1 && sh.turnCap.stbd === 1, 'ship.turnVel, ship.turnCap { port 1, stbd 1 }');
  ok(Array.isArray(sh.fragile) && sh.fragile.length === 0, 'ship.fragile [] (Liste)');
  ok(Array.isArray(sh.repairQueue) && sh.repairQueue.length === 0, 'ship.repairQueue []');
  ok(sh.botAuto === true, 'ship.botAuto solo an');
  const shd = sh.shields || {};
  ok(['pool', 'alloc', 'current', 'cap', 'burst', 'burstCd'].every((k) => k in shd), 'ship.shields: pool, alloc, current, cap, burst, burstCd');
  ok(JSON.stringify(shd.cap) === '[4,4,4,4]' && shd.burst == null && shd.burstCd === 0, 'Schild-cap [4,4,4,4], kein Stoß, keine Abklingzeit');
  ok(sh.chargePoints === g.ship.power.weapons + 2 && sh.chargePoints === 4, 'chargePoints = Energie Waffen + 2 = 4');
  const bow = snapMount(s, 'bow'), port = snapMount(s, 'port'), stbd = snapMount(s, 'stbd');
  ok(!!bow && !!port && !!stbd && !(sh.mounts || []).some((m) => /^phase_/.test(m.id)), 'mounts: bow/port/stbd, keine phase_*');
  ok(bow && bow.facing === 0 && bow.arc === 16 && bow.range === 650 && port.facing === -90 && port.arc === 70 && stbd.facing === 90 && stbd.range === 520, 'Bögen laut §5.1');
  ok(bow && bow.alloc === 2 && port.alloc === 1 && stbd.alloc === 1, 'Start-Ladepunkte { bow 2, port 1, stbd 1 }');
  ok(bow && ['charge', 'alloc', 'state'].every((k) => k in bow) && bow.state === 'ok' && bow.aim == null, 'bow: charge, alloc, state (aim nur in der Zielphase)');
  ok(port && ['hold', 'salvo', 'salvoMax', 'state', 'charge'].every((k) => k in port) && port.hold === false && port.salvoMax === 4 && port.salvo === 0, 'Batterien: hold false, salvo 0, salvoMax 4');
  ok(['bursts', 'burstsPerfect', 'flicks', 'swaps', 'minigames', 'bridgeLeaves'].every((k) => g.stats[k] === 0), 'stats: bursts, burstsPerfect, flicks, swaps, minigames, bridgeLeaves = 0');
  ok(CONFIG.ship.turnRate === 0.5 && CONFIG.ship.maxSpeed === 130 && CONFIG.ship.accel === 50 && CONFIG.ship.dodgeCooldown === 10 && CONFIG.ship.turnAccel === 0.8, 'CONFIG.ship laut §10');
  ok(CONFIG.shop.find((x) => x.id === 'seitenturm').name === 'Zusatzrohre' && CONFIG.shop.find((x) => x.id === 'seitenturm').price === 300, 'Shop: Zusatzrohre 300');
  ok(Buffer.byteLength(JSON.stringify(s)) < 12 * 1024, 'Snapshot < 12 KB');
  const g3 = arena(3).g;
  ok(g3.snapshot().ship.botAuto === false, 'ship.botAuto zu dritt aus');
});

section('Interior-Hilfen (§9.5)', () => {
  ok(Array.isArray(interior.SYSTEM_ORDER) && interior.SYSTEM_ORDER.length === 14 && SYS14.every((s) => interior.SYSTEM_ORDER.includes(s)) && !interior.SYSTEM_ORDER.includes('weapons'), 'SYSTEM_ORDER: 14 Systeme ohne weapons');
  ok(SYS14.every((s) => typeof interior.sysName(s) === 'string' && interior.sysName(s) !== s && interior.sysNameNom(s) !== s), 'deutsche Namen für alle 14 Systeme');
  const want = { weapon_bow: 0, emitter_bow: 0, thruster_stbd: 1, battery_stbd: 1, emitter_stbd: 1, transfer: 1, engines: 2, emitter_aft: 2,
    thruster_port: 3, battery_port: 3, emitter_port: 3, reactor: -1, shields: -1, life: -1 };
  ok(SYS14.every((s) => I.systemSector(s) === want[s]), 'systemSector laut §2.2');
  ok([0, 1, 2, 3].map((i) => I.emitterFor(i)).join() === 'emitter_bow,emitter_stbd,emitter_aft,emitter_port', 'emitterFor 0..3');
});

// ======================================================================
section('Wirkung der 12 Kampfsysteme (§4.2)', () => {
  // zu dritt: Bot-Automatik aus, damit kein Schrauber die Testschäden zwischendurch repariert
  const { g, run, dbg, cmd, enter, notices, P, place } = arena(3);
  const set = (sys, st) => { dbg(0, { cmd: 'damage', system: sys, state: st }); run(0.1, () => { pin(g); noFire(g); }); };
  for (const sys of SYS14) {
    set(sys, 'broken');
    const okB = g.ship.systems[sys] === 'broken';
    set(sys, 'ok');
    ok(okB && g.ship.systems[sys] === 'ok', `debug damage ${sys} broken/ok (§17)`);
  }
  // Reaktor
  set('reactor', 'damaged'); const outD = g.ship.reactor.output;
  set('reactor', 'broken'); const outB = g.ship.reactor.output;
  set('reactor', 'ok');
  ok(outD === 6 && outB === M3.reactorBrokenOutput, `Reaktor: beschädigt Leistung 6 (${outD}), zerstört Notstrom ${M3.reactorBrokenOutput} (${outB})`);
  // Triebwerk
  const v0 = S.maxSpeed(g);
  set('engines', 'damaged'); const vD = S.maxSpeed(g);
  set('engines', 'broken'); const vB = S.maxSpeed(g);
  ok(near(vD / v0, 0.5, 0.01) && vB === 0, `Triebwerk: maxSpeed ×0,5 (${(vD / v0).toFixed(2)}), zerstört 0 (${vB})`);
  g.ship.jump.dest = 'splitter'; run(0.2, () => { pin(g); noFire(g); });
  ok(/Antrieb|Triebwerk/.test(g.ship.jump.blockedReason || '') && !g.ship.jump.ready, 'Triebwerk zerstört: kein Faltsprung (' + g.ship.jump.blockedReason + ')');
  g.ship.jump.dest = null;
  enter(0, 'helm'); const n0 = notices(0).length; cmd(0, 'helm.dodge', { dir: 1 });
  ok(notices(0).length > n0 && g.ship.dodgeCd === 0, 'Triebwerk zerstört: keine Ausweichrolle');
  g.upgrades.bolzenwerfer = true;
  const tgt = pinnedEnemy(g, 'raider', g.ship.x - 400, g.ship.y, 0, { hp: 999 });
  enter(0, 'weapons'); cmd(0, 'weapons.target', { id: tgt.id });
  const loaded = g.ship.mount && g.ship.mount.bolzen ? g.ship.mount.bolzen.loaded : null;
  const n1 = notices(0).length; cmd(0, 'weapons.fire', { mount: 'bolzen' });
  ok(notices(0).length > n1 && (!g.ship.mount || g.ship.mount.bolzen.loaded === loaded), 'Triebwerk zerstört: Bolzenwerfer aus');
  g.upgrades.bolzenwerfer = false; g.space.enemies = [];
  set('engines', 'ok'); P(0).console && g.handleMessage(g.players[0].conn, { t: 'leave' });
  // Düsen: turnCaps und echte Winkelgeschwindigkeit
  for (const [sys, side] of [['thruster_port', 'port'], ['thruster_stbd', 'stbd']]) {
    const other = side === 'port' ? 'stbd' : 'port';
    set(sys, 'damaged'); const cD = S.turnCaps(g);
    set(sys, 'broken'); const cB = S.turnCaps(g);
    const snapCap = g.snapshot().ship.turnCap;
    ok(cD[side] === M3.turnCap.damaged && cD[other] === 1 && cB[side] === M3.turnCap.broken && cB[other] === 1 && snapCap[side] === M3.turnCap.broken,
      `${sys}: Drehen zur Seite ${side} ×${cD[side]} / ×${cB[side]}, andere Seite 1`);
    // Verhalten: volles Ruder zu dieser Seite -> turnVel ≈ turnRate × cap (Backbord = negatives turn)
    enter(0, 'helm');
    const turn = side === 'port' ? -1 : 1;
    g.ship.turnVel = 0;
    run(4, () => { cmd(0, 'helm.input', { turn, thrust: 0 }); });
    const tv = g.ship.turnVel;
    ok(near(Math.abs(tv), CONFIG.ship.turnRate * M3.turnCap.broken, 0.02) && Math.sign(tv) === turn, `${sys} zerstört: turnVel ${tv.toFixed(3)} ≈ ${(CONFIG.ship.turnRate * M3.turnCap.broken).toFixed(3)}`);
    g.ship.turnVel = 0;
    run(4, () => { cmd(0, 'helm.input', { turn: -turn, thrust: 0 }); });
    ok(near(Math.abs(g.ship.turnVel), CONFIG.ship.turnRate, 0.02), `${sys} zerstört: Gegenseite dreht voll (${g.ship.turnVel.toFixed(3)})`);
    cmd(0, 'helm.input', { turn: 0, thrust: 0 }); g.ship.turnVel = 0; g.ship.angle = 0;
    set(sys, 'ok');
  }
  g.handleMessage(g.players[0].conn, { t: 'leave' });
  // Schildgenerator
  const pool0 = g.snapshot().ship.shields.pool;
  set('shields', 'damaged'); const poolD = g.snapshot().ship.shields.pool;
  ok(poolD === pool0 + M3.generatorDamagedPool, `Schildgenerator beschädigt: Pool ${pool0} -> ${poolD} (−2)`);
  set('shields', 'broken');
  ok(g.ship.shields.current.every((v) => v === 0), 'Schildgenerator zerstört: keine Schilde');
  ok(!!S.captainBurst(g, 0), 'Schildgenerator zerstört: kein Schildstoß');
  set('shields', 'ok');
  // Regeneration halb so schnell: Sektor 0 leer, Zeit bis +1 messen
  const regenTime = (st) => {
    // Sektor 1 (alloc 1 bleibt auch beim kleineren Pool erhalten)
    set('shields', st); g.ship.shields.current = [0, 0, 0, 0]; g.ship.shields.regenT = 0;
    let t = 0; while (g.ship.shields.current[1] === 0 && t < 30) { run(0.1, () => { pin(g); noFire(g); }); t += 0.1; }
    return t;
  };
  const tOk = regenTime('ok'), tDam = regenTime('damaged');
  ok(tDam >= tOk * 1.6, `Schildgenerator beschädigt: Regeneration langsamer (${tOk.toFixed(1)} s -> ${tDam.toFixed(1)} s)`);
  set('shields', 'ok');
  // Emitter je Sektor
  for (let sec = 0; sec < 4; sec++) {
    const em = ['emitter_bow', 'emitter_stbd', 'emitter_aft', 'emitter_port'][sec];
    set(em, 'damaged'); const capD = S.shieldCaps(g)[sec];
    g.ship.shields.allocIntent = [0, 0, 0, 0]; g.ship.shields.allocIntent[sec] = 4; run(0.1, () => { pin(g); noFire(g); });
    const allocD = g.ship.shields.alloc[sec];
    set(em, 'broken'); const capB = S.shieldCaps(g)[sec];
    run(0.1, () => { pin(g); noFire(g); });
    const curB = g.ship.shields.current[sec];
    const burstErr = S.captainBurst(g, sec);
    ok(capD === 2 && capB === 0 && g.snapshot().ship.shields.cap[sec] === 0, `${em}: cap 4 -> ${capD} (beschädigt) -> ${capB} (zerstört)`);
    ok(allocD <= 2 && curB === 0, `${em}: Sektor hält höchstens ${capD} (alloc ${allocD}), zerstört offen (current ${curB})`);
    ok(!!burstErr, `${em} zerstört: Schildstoß dort unmöglich`);
    set(em, 'ok');
    g.ship.shields.allocIntent = CONFIG.shields.default.slice();
  }
  // Bug-Waffe: Ladezeit × 1,5, zerstört lädt nicht
  const rate = (mount) => { setCharge(g, mount, 0); run(3, () => pin(g)); return mountOf(g, mount).charge / 3; };
  // Taktik besetzt (unbesetzt lädt nur halb so schnell – abgestimmte Abweichung)
  enter(1, 'weapons');
  const rOk = rate('bow');
  set('weapon_bow', 'damaged'); const rD = rate('bow');
  set('weapon_bow', 'broken'); const rB = rate('bow');
  g.handleMessage(g.players[1].conn, { t: 'leave' });
  ok(near(rOk, 2 / M3.mounts.bow.secPerPoint, 0.15 * 2 / 24), `Lanze lädt mit 2 Punkten in 12 s (${(1 / rOk).toFixed(1)} s)`);
  ok(near(rD, rOk / 1.5, 0.01) && rB === 0, `weapon_bow: beschädigt ×1,5 (${(1 / rD).toFixed(1)} s), zerstört lädt nicht`);
  ok(g.snapshot().ship.systems.weapons === 'broken' && snapMount(g.snapshot(), 'bow').state === 'broken', 'Altname systems.weapons = schlechtester Zustand (broken)');
  setCharge(g, 'bow', 1);
  const e = pinnedEnemy(g, 'raider', g.ship.x + 400, g.ship.y, Math.PI, { hp: 999 });
  enter(0, 'weapons'); cmd(0, 'weapons.target', { id: e.id });
  const nb = notices(0).length; cmd(0, 'weapons.fire', { mount: 'bow' });
  ok(notices(0).length > nb && !(g.ship.mount.bow.aim), 'weapon_bow zerstört: feuert nicht');
  set('weapon_bow', 'ok');
  g.space.enemies = [];
  // Batterien: beschädigt 2 Rohre, zerstört lädt/feuert nicht
  for (const [sys, mount, dy] of [['battery_port', 'port', -400], ['battery_stbd', 'stbd', 400]]) {
    set(sys, 'damaged');
    ok(snapMount(g.snapshot(), mount).salvoMax === M3.mounts[mount].tubesDamaged && g.snapshot().ship.systems.weapons === 'damaged', `${sys} beschädigt: salvoMax ${M3.mounts[mount].tubesDamaged}, systems.weapons damaged`);
    const t = pinnedEnemy(g, 'raider', g.ship.x, g.ship.y + dy, 0, { hp: 999 });
    cmd(0, 'weapons.target', { id: t.id });
    cmd(0, 'weapons.hold', { mount, hold: true });
    setCharge(g, mount, 1);
    const hp0 = t.hp;
    cmd(0, 'weapons.fire', { mount });
    run(1.2, () => pin(g));
    ok(near(hp0 - t.hp, M3.mounts[mount].tubesDamaged * M3.mounts[mount].damage, 0.01), `${sys} beschädigt: Salve 2 × 1,5 = ${hp0 - t.hp}`);
    set(sys, 'broken');
    const rBat = rate(mount);
    setCharge(g, mount, 1);
    const hp1 = t.hp; const nn = notices(0).length;
    cmd(0, 'weapons.fire', { mount });
    run(1, () => pin(g));
    ok(rBat === 0 && t.hp === hp1 && notices(0).length > nn, `${sys} zerstört: lädt nicht, feuert nicht`);
    cmd(0, 'weapons.hold', { mount, hold: false });
    set(sys, 'ok');
    g.space.enemies = [];
  }
  // Hitze auf Waffen trifft eine der drei Waffen
  g.handleMessage(g.players[0].conn, { t: 'leave' });
  resetSystems(g);
  setPower(g, { engines: 0, shields: 2, weapons: 4, life: 2 });
  g.ship.heat.weapons = CONFIG.power.heatLimit - 0.5;
  run(0.5, () => { pin(g); noFire(g); });
  const hot = ['weapon_bow', 'battery_port', 'battery_stbd'].filter((s) => g.ship.systems[s] !== 'ok');
  ok(hot.length === 1 && g.ship.systems.weapons === 'damaged', 'Hitze Waffen (Stufe 4) trifft eine der drei Waffen: ' + hot.join());
  ok(g.errors === 0, 'keine Server-Fehler (' + g.errors + ')');
});

// ======================================================================
section('Reparatur: Flicken, Fragil, Werkzeuggürtel (§8.1, §4.3)', () => {
  const { g, P, send, run, place, events } = arena(1);
  noFire(g);
  const hold = (sec) => { send(0, { t: 'act', down: true }); run(sec, () => noFire(g)); send(0, { t: 'act', down: false }); run(0.05); };
  g.ship.systems.battery_port = 'broken';
  place(0, sysSpot('battery_port'));
  hold(1.3);
  ok(g.ship.systems.battery_port === 'broken', 'Flicken dauert flickTime 1,5 s (nach 1,3 s noch zerstört)');
  hold(1.6);
  ok(g.ship.systems.battery_port === 'damaged' && I.isFragile(g, 'battery_port') && g.snapshot().ship.fragile.includes('battery_port'), 'E ohne Teil: zerstört -> beschädigt, fragil (Snapshot fragile)');
  ok(g.stats.flicks === 1 && events('repairDone').some((e) => e.system === 'battery_port' && e.how === 'flick'), 'stats.flicks 1, repairDone how flick');
  hold(1.6);
  ok(g.ship.systems.battery_port === 'ok' && I.isFragile(g, 'battery_port') && g.stats.flicks === 2, 'nochmal flicken: beschädigt -> ok, bleibt fragil');
  // Fragil bricht beim nächsten Treffer im Sektor, Treffer im anderen Sektor nicht
  g.time += 20;
  I.hitSystems(g, 1);
  ok(g.ship.systems.battery_port === 'ok' && I.isFragile(g, 'battery_port'), 'Treffer in Sektor 1: fragile Bb-Batterie bleibt');
  g.time += 20;
  I.hitSystems(g, 3);
  ok(g.ship.systems.battery_port === 'broken' && !I.isFragile(g, 'battery_port'), 'fragil + Treffer in Sektor 3: sofort zerstört, Flag weg');
  // mehrere fragile im Sektor brechen alle, sonst kein weiterer Schaden
  resetSystems(g);
  g.ship.fragile.battery_port = true; g.ship.fragile.emitter_port = true;
  g.time += 20;
  const before = JSON.stringify(g.ship.systems);
  I.hitSystems(g, 3);
  const changed = SYS14.filter((s) => g.ship.systems[s] !== 'ok');
  ok(changed.sort().join() === 'battery_port,emitter_port' && !I.isFragile(g, 'emitter_port'), 'alle fragilen Systeme des Sektors brechen, kein weiterer Schaden (' + changed.join() + ')');
  ok(before !== JSON.stringify(g.ship.systems), 'Systeme verändert');
  // Debug fragile
  resetSystems(g);
  send(0, { t: 'debug', cmd: 'fragile', system: 'thruster_stbd' });
  ok(I.isFragile(g, 'thruster_stbd'), 'debug fragile <system>');
  // Werkzeuggürtel × 0,7
  resetSystems(g);
  g.ship.systems.emitter_port = 'damaged';
  P(0).gear.werkzeuggurt = true;
  place(0, sysSpot('emitter_port'));
  hold(1.5 * 0.7 + 0.1);
  ok(g.ship.systems.emitter_port === 'ok', 'Werkzeuggürtel: Flicken in 1,05 s');
  P(0).gear.werkzeuggurt = false;
  // Offline (EMP): keine Reparatur
  resetSystems(g);
  interior.setOffline(g, 'emitter_port', 12);
  hold(2);
  ok(g.ship.systems.emitter_port === 'offline', 'offline (EMP): E repariert nicht');
  ok(g.errors === 0, 'keine Server-Fehler (' + g.errors + ')');
});

section('Reparatur: Austauschen (§8.1)', () => {
  const { g, P, send, run, place, events } = arena(1);
  const hold = (sec) => { send(0, { t: 'act', down: true }); run(sec, () => noFire(g)); send(0, { t: 'act', down: false }); run(0.05); };
  g.ship.systems.thruster_port = 'broken';
  const parts = g.inventory.ersatzteil;
  P(0).carry = 'ersatzteil';
  place(0, sysSpot('thruster_port'));
  hold(2.6);
  ok(g.ship.systems.thruster_port === 'broken' && P(0).carry === 'ersatzteil', 'Austauschen dauert partTime 3 s');
  hold(3.2);
  ok(g.ship.systems.thruster_port === 'ok' && P(0).carry === null && !I.isFragile(g, 'thruster_port'), 'mit Ersatzteil: zerstört -> direkt ok, Teil verbraucht');
  ok(g.inventory.ersatzteil === parts && g.stats.swaps === 1 && events('repairDone').some((e) => e.system === 'thruster_port' && e.how === 'swap'), 'stats.swaps 1, repairDone how swap');
  // fragil + beschädigt -> Austausch: ok und nicht mehr fragil
  g.ship.systems.thruster_port = 'damaged'; g.ship.fragile.thruster_port = true;
  P(0).carry = 'ersatzteil';
  hold(3.2);
  ok(g.ship.systems.thruster_port === 'ok' && !I.isFragile(g, 'thruster_port'), 'Austausch an fragilem System: ok, Flag weg');
  // ok + fragil: Austausch entfernt Fragil (Station ist nicht „heil“ im Sinne der Liste)
  ok(g.errors === 0, 'keine Server-Fehler');
});

section('Reparatur: Minispiel (§8.1)', () => {
  const { g, P, send, run, place, events, cmd, notices } = arena(2);
  noFire(g);
  g.ship.systems.emitter_stbd = 'damaged'; g.ship.fragile.emitter_stbd = true;
  // zu weit weg
  place(0, conSpot('helm'));
  cmd(0, 'repair.start', { system: 'emitter_stbd' });
  ok(!(P(0).hold && P(0).hold.kind === 'minigame'), 'repair.start außer Reichweite abgelehnt');
  place(0, sysSpot('emitter_stbd'));
  cmd(0, 'repair.start', { system: 'emitter_stbd' });
  ok(P(0).hold && P(0).hold.kind === 'minigame' && P(0).hold.system === 'emitter_stbd', 'repair.start an der Station: p.hold minigame (ohne Konsole)');
  const sp = g.snapshot().players[0].action;
  ok(sp && sp.kind === 'minigame' && sp.system === 'emitter_stbd' && 'progress' in sp, 'Snapshot players[].action { kind minigame, system, progress }');
  place(1, standSpots(stationTiles('emitter_stbd'))[1] || sysSpot('emitter_stbd'));
  cmd(1, 'repair.start', { system: 'emitter_stbd' });
  ok(!(P(1).hold && P(1).hold.kind === 'minigame'), 'zweiter Spieler am selben System abgelehnt');
  run(1, () => noFire(g));
  cmd(0, 'repair.done', { system: 'emitter_stbd', errors: 0 });
  // SERVER-SHIP (Abweichung, abgestimmt): repair.done vor der Mindestzeit beendet das Minispiel ohne Reparatur
  ok(g.ship.systems.emitter_stbd === 'damaged' && !(P(0).hold && P(0).hold.kind === 'minigame'), 'repair.done vor minigameMinTime (2,5 s): keine Reparatur, Minispiel beendet');
  cmd(0, 'repair.start', { system: 'emitter_stbd' });
  run(2.7, () => noFire(g));
  cmd(0, 'repair.done', { system: 'emitter_stbd', errors: 1 });
  ok(g.ship.systems.emitter_stbd === 'ok' && !I.isFragile(g, 'emitter_stbd') && !P(0).hold, 'nach 2,7 s: eine Stufe hoch, dauerhaft (Flag weg)');
  ok(g.stats.minigames === 1 && events('repairDone').some((e) => e.system === 'emitter_stbd' && e.how === 'minigame'), 'stats.minigames 1, repairDone how minigame');
  // zerstört -> eine Stufe (beschädigt), nicht ok
  g.ship.systems.emitter_stbd = 'broken';
  cmd(0, 'repair.start', { system: 'emitter_stbd' }); run(2.6, () => noFire(g)); cmd(0, 'repair.done', { system: 'emitter_stbd', errors: 0 });
  ok(g.ship.systems.emitter_stbd === 'damaged', 'Minispiel an zerstörtem System: nur eine Stufe');
  // Bewegung bricht ab
  cmd(0, 'repair.start', { system: 'emitter_stbd' });
  send(0, { t: 'input', seq: 9, mx: 1, my: 0 }); run(0.2); send(0, { t: 'input', seq: 10, mx: 0, my: 0 }); run(0.1);
  ok(!P(0).hold, 'Bewegung bricht das Minispiel ab');
  place(0, sysSpot('emitter_stbd'));
  cmd(0, 'repair.start', { system: 'emitter_stbd' });
  cmd(0, 'repair.cancel', { system: 'emitter_stbd' });
  ok(!P(0).hold, 'repair.cancel bricht ab');
  run(2.6); cmd(0, 'repair.done', { system: 'emitter_stbd', errors: 0 });
  ok(g.ship.systems.emitter_stbd === 'damaged', 'repair.done ohne aktives Minispiel wirkungslos');
  // ok / offline: kein Minispiel
  g.ship.systems.emitter_stbd = 'ok';
  cmd(0, 'repair.start', { system: 'emitter_stbd' });
  ok(!P(0).hold, 'ok-System: kein Minispiel');
  g.ship.systems.emitter_stbd = 'damaged'; interior.setOffline(g, 'emitter_stbd', 12);
  cmd(0, 'repair.start', { system: 'emitter_stbd' });
  ok(!P(0).hold, 'offline-System: kein Minispiel');
  // Konsole bricht ab
  g.ship.offline = {}; g.ship.systems.emitter_stbd = 'damaged';
  cmd(0, 'repair.start', { system: 'emitter_stbd' });
  P(0).console = 'helm'; run(0.1);
  ok(!P(0).hold || P(0).hold.kind !== 'minigame', 'Konsole bricht das Minispiel ab');
  P(0).console = null;
  ok(notices(0).length >= 1, 'Ablehnungen kommen als Hinweis');
  ok(g.errors === 0, 'keine Server-Fehler');
});

section('Zerstörter Reaktor braucht Neustart (§4.2, §9.5)', () => {
  const { g, run } = arena(1);
  g.ship.systems.reactor = 'broken'; run(0.1, () => noFire(g));
  I.repairSystem(g, 'reactor', 'p1', 'flick');
  run(0.1, () => noFire(g));
  ok(g.ship.systems.reactor === 'damaged' && g.ship.reactorCtl.state === 'offline', 'zerstört -> geflickt: reactorCtl offline (Neustart zu zweit)');
  ok(g.ship.reactor.output <= CONFIG.reactorM1.offlineOutput, 'offline: Notstrom ' + g.ship.reactor.output);
  space.reactorOnline(g, 'Test');
  I.repairSystem(g, 'reactor', 'p1', 'flick');
  ok(g.ship.systems.reactor === 'ok' && g.ship.reactorCtl.state === 'online', 'beschädigt -> ok: kein Neustart nötig');
  g.ship.systems.reactor = 'broken';
  I.repairSystem(g, 'reactor', 'p1', 'swap');
  ok(g.ship.reactorCtl.state === 'offline', 'zerstört -> Austausch: ebenfalls Neustart');
});

// ======================================================================
section('Schildstoß (§7.2)', () => {
  const { g, run, enter, cmd, events, notices } = arena(1);
  const tick = () => { pin(g); noFire(g); };
  ok(enter(0, 'captain'), 'Captain-Konsole');
  run(0.5, tick);
  // perfekt
  const c0 = g.ship.shields.current[0]; const hull0 = g.ship.hull;
  cmd(0, 'captain.burst', { sector: 0 });
  const b = g.ship.shields.burst;
  ok(b && b.sector === 0 && near(b.until - b.t0, M3.burst.duration, 0.01) && b.absorb === M3.burst.absorb, 'captain.burst: burst { sector 0, until t0+1,5, absorb 5 }');
  const sb = g.snapshot().ship.shields;
  ok(sb.burst && sb.burst.sector === 0 && near(sb.burst.left, 1.5, 0.05) && near(sb.burst.perfectLeft, 0.5, 0.05) && sb.burst.absorb === 5 && near(sb.burstCd, 8, 0.1), 'Snapshot burst { sector, left, perfectLeft, absorb }, burstCd 8');
  run(0.3, tick);
  const cBefore = g.ship.shields.current[0];
  S.shipHit(g, 0, 8, { heavy: true, pierce: true });
  ok(g.ship.hull === hull0 && g.ship.shields.current[0] === Math.min(S.shieldCaps(g)[0], cBefore + 1), `perfekt (0,3 s): Treffer (8, durchschlagend) ganz geschluckt, Sektor +1 (${cBefore} -> ${g.ship.shields.current[0]})`);
  ok(events('burst').some((e) => e.sector === 0 && e.perfect === true) && g.stats.bursts === 1 && g.stats.burstsPerfect === 1, 'Ereignis burst perfect, stats.bursts 1, burstsPerfect 1');
  ok(c0 >= 0, 'Startschild gemessen');
  // Abklingzeit
  const nn = notices(0).length;
  cmd(0, 'captain.burst', { sector: 1 });
  ok(notices(0).length > nn && g.ship.shields.burst.sector === 0, 'Abklingzeit 8 s: zweiter Stoß abgelehnt');
  run(8.1, tick);
  // perfekt auch gegen EMP
  cmd(0, 'captain.burst', { sector: 3 });
  run(0.2, tick);
  S.shipHit(g, 3, 1, { emp: true, heavy: true });
  ok(!Object.values(g.ship.systems).includes('offline') && g.stats.burstsPerfect === 2, 'perfekt schluckt auch EMP');
  run(8.1, tick);
  // nicht perfekt: absorb zuerst
  g.ship.shields.current = [0, 0, 0, 0]; g.ship.shields.allocIntent = [0, 0, 0, 0]; run(0.1, tick);
  cmd(0, 'captain.burst', { sector: 1 });
  run(0.7, tick);
  const h1 = g.ship.hull;
  S.shipHit(g, 1, 4, {});
  ok(g.ship.hull === h1 && g.ship.shields.burst && g.ship.shields.burst.absorb === 1, 'nicht perfekt (0,7 s): 4 Schaden aus absorb (5 -> 1), Hülle unberührt');
  S.shipHit(g, 1, 3, {});
  ok(g.ship.hull < h1 && g.stats.burstsPerfect === 2 && events('burst').filter((e) => e.perfect === false).length >= 0, `Rest 2 geht auf Hülle (${h1} -> ${g.ship.hull})`);
  run(1, tick);
  const h2 = g.ship.hull;
  S.shipHit(g, 1, 1, {});
  ok(g.ship.hull < h2 && !g.ship.shields.burst, 'nach until: Stoß vorbei, Treffer normal');
  g.ship.shields.allocIntent = CONFIG.shields.default.slice();
  run(8, tick);
  // beschädigter Emitter: absorb 2
  g.ship.systems.emitter_stbd = 'damaged';
  cmd(0, 'captain.burst', { sector: 1 });
  ok(g.ship.shields.burst && g.ship.shields.burst.absorb === M3.burst.absorbDamaged, 'beschädigter Emitter: absorb 2');
  // Sperren
  for (const [sys, sec, why] of [['emitter_aft', 2, 'Emitter zerstört'], ['shields', 0, 'Generator zerstört']]) {
    const t = arena(1); t.enter(0, 'captain'); t.g.ship.systems[sys] = 'broken'; t.run(0.1, () => noFire(t.g));
    const n0 = t.notices(0).length;
    t.cmd(0, 'captain.burst', { sector: sec });
    ok(!t.g.ship.shields.burst && t.notices(0).length > n0, `${why}: Schildstoß gesperrt`);
  }
  // Debug burst ohne Prüfung
  const t2 = arena(1); t2.g.ship.systems.emitter_aft = 'broken';
  t2.dbg(0, { cmd: 'burst', sector: 2 });
  ok(t2.g.ship.shields.burst && t2.g.ship.shields.burst.sector === 2, 'debug burst <sector> ohne Prüfung');
  ok(g.errors === 0, 'keine Server-Fehler');
});

// ======================================================================
section('Ladung / tele (§7.1)', () => {
  const { g, run, events, dbg, clearInbox } = arena(1);
  const tick = () => { pin(g); noFire(g); };
  const sh = g.ship;
  // Kanonenboot oberhalb (Backbord), Breitseite (facing +90°) zeigt aufs Schiff
  const gb = pinnedEnemy(g, 'gunboat', sh.x, sh.y - 380, 0, { hp: 999 });
  gb.keepFire = true;
  run(0.1, () => { pin(g); noFire(g); gb.fireT = -999; });
  ok(!gb.tele, 'ohne Ladung kein tele');
  dbg(0, { cmd: 'tele', id: gb.id });
  ok(gb.tele && gb.tele.kind === 'shot' && near(gb.tele.dur, M3.tele.gunboat.dur, 0.01) && gb.tele.sector === 3, 'debug tele: Ladung { kind shot, dur 3, sector 3 (Backbord) }');
  const ts = g.snapshot().space.enemies.find((e) => e.id === gb.id).tele;
  ok(ts && ts.kind === 'shot' && near(ts.left, 3, 0.1) && ts.dur === 3 && ts.sector === 3, 'Snapshot enemies[].tele { kind, left, dur, sector }');
  ok(JSON.stringify(S.enemyTeleSnap(gb)) === JSON.stringify(ts) || (S.enemyTeleSnap(gb).sector === 3), 'enemyTeleSnap');
  // Abweichung SERVER-COMBAT: Art im Ereignis als tkind (kind ist schon der Ereignisname)
  ok(events('tele').some((e) => e.id === gb.id && (e.tkind || e.kind) === 'shot' && e.sector === 3 && e.dur === 3), 'Ereignis tele { id, tkind, sector, dur }');
  ok(events('oda').some((e) => /Kanonenboot/.test(e.text) && /lädt/.test(e.text) && /Backbord/i.test(e.text)), 'solo: ODA „Kanonenboot lädt – Backbord!“');
  // Sektor wird jeden Tick neu berechnet: Schiff um 180° drehen -> Steuerbord
  run(0.5, tick);
  sh.angle = Math.PI; run(0.1, tick);
  ok(gb.tele && gb.tele.sector === 1, 'tele.sector folgt dem Schiff (gedreht -> Sektor 1)');
  sh.angle = 0; run(0.1, tick);
  // Verlängerung durch Treffer
  const l0 = gb.tele.left;
  S.damageEnemy(g, gb, 1, sh.x, sh.y);
  ok(near(gb.tele.left, l0 + M3.tele.delayPerHit, 0.05), `Treffer verlängert um 1 s (${l0.toFixed(2)} -> ${gb.tele.left.toFixed(2)})`);
  S.damageEnemy(g, gb, 1, sh.x, sh.y); S.damageEnemy(g, gb, 1, sh.x, sh.y);
  ok(near(gb.tele.left, l0 + M3.tele.delayMax, 0.05), `insgesamt höchstens +2 s (${gb.tele.left.toFixed(2)})`);
  // Treffer am Ende: schwer, Strahl enemy_heavy, keine Projektile
  sh.shields.current = [0, 0, 0, 0]; sh.shields.allocIntent = [0, 0, 0, 0];
  const hull0 = sh.hull;
  let sawHeavy = false;
  run(5.5, () => { tick(); if (g.space.beams.some((b) => b.kind === 'enemy_heavy')) sawHeavy = true; });
  // QA M3a: Schaden aus der Konfig (spaceM3.tele.gunboat.damage, 4 -> 3)
  const gbDmg = CONFIG.spaceM3.tele.gunboat.damage;
  ok(!gb.tele && hull0 - sh.hull >= gbDmg * 5 - 0.01, `Ende der Ladung: Treffer ${gbDmg} Schaden (Hülle ${hull0} -> ${sh.hull})`);
  ok(sawHeavy, 'Strahl kind enemy_heavy');
  // Fehlschuss nach dem Wegdrehen/Wegfliegen
  clearInbox();
  dbg(0, { cmd: 'tele', id: gb.id });
  run(1, tick);
  sh.x += 900; run(0.1, tick);
  const hull1 = sh.hull;
  run(3, tick);
  ok(!gb.tele && sh.hull === hull1 && events('teleMiss').some((e) => e.id === gb.id), 'Schiff aus Bogen/Reichweite: Fehlschuss (teleMiss), kein Schaden');
  sh.x -= 900;
  // Pylon 2 s, Wächter 2,5 s EMP
  const py = pinnedEnemy(g, 'pylon', sh.x + 350, sh.y, Math.PI, { hp: 999 });
  dbg(0, { cmd: 'tele', id: py.id });
  ok(py.tele && near(py.tele.dur, 2, 0.01) && py.tele.kind === 'shot' && py.tele.sector === 0, 'Pylon: Ladung 2 s, Sektor Bug');
  const se = pinnedEnemy(g, 'sentinel', sh.x - 200, sh.y, 0, { hp: 999 });
  dbg(0, { cmd: 'tele', id: se.id });
  ok(se.tele && near(se.tele.dur, 2.5, 0.01) && se.tele.kind === 'emp', 'Wächter: Ladung 2,5 s, kind emp');
  g.space.enemies = [];
  // Natürliche Ladung: Feuerintervall abgelaufen + Schiff in Bogen und Reichweite -> tele statt Projektil
  const gb2 = pinnedEnemy(g, 'gunboat', sh.x, sh.y + 380, 0, { hp: 999 });
  gb2.keepFire = true; gb2.fireT = 0;
  let teleSeen = false, proj = 0;
  run(12, () => { proj += g.space.projectiles.filter((q) => q.owner === gb2.id).length; pin(g); noFire(g); if (gb2.tele) teleSeen = true; });
  ok(teleSeen && proj === 0, 'Kanonenboot schießt nicht sofort: Ladung statt Projektil');
  // Jäger schießen in M3a weiter wie bisher (kein tele)
  g.space.enemies = [];
  const r = pinnedEnemy(g, 'raider', sh.x + 300, sh.y, Math.PI, { hp: 999 });
  r.keepFire = true; r.fireT = 0;
  let rTele = false, rShots = 0;
  run(8, () => {
    rShots += g.space.projectiles.filter((q) => q.owner === r.id).length;
    g.space.projectiles = [];
    r.x = r.pin.x; r.y = r.pin.y; r.angle = r.pin.angle; r.shields = [0, 0, 0, 0]; noFire(g);
    if (r.tele) rTele = true;
  });
  ok(!rTele && rShots >= 1, `Jäger ohne Ladung, schießt wie bisher (${rShots} Schüsse)`);
  ok(g.errors === 0, 'keine Server-Fehler (' + g.errors + ')');
});

section('Captain sieht Ladung erst spät (§7.1, Konfig)', () => {
  ok(M3.tele.captainSeesLast === 1.2 && M3.tele.odaCooldown === 4, 'captainSeesLast 1,2 s, ODA-Abklingzeit 4 s (Filter im Client)');
  const { g, run, dbg, events, clearInbox } = arena(1);
  const gb = pinnedEnemy(g, 'gunboat', g.ship.x, g.ship.y - 380, 0, { hp: 999 });
  dbg(0, { cmd: 'tele', id: gb.id });
  const first = events('oda').filter((e) => /lädt/.test(e.text)).length;
  run(2.5, () => { pin(g); noFire(g); });
  clearInbox();
  dbg(0, { cmd: 'tele', id: gb.id });
  const second = events('oda').filter((e) => /lädt/.test(e.text)).length;
  ok(first === 1 && second === 0, 'ODA-Ansage je Gegner höchstens alle 4 s');
  const g3 = arena(3);
  const gb3 = pinnedEnemy(g3.g, 'gunboat', g3.g.ship.x, g3.g.ship.y - 380, 0, { hp: 999 });
  g3.dbg(0, { cmd: 'tele', id: gb3.id });
  ok(!g3.events('oda').some((e) => /lädt/.test(e.text)), 'zu dritt: keine ODA-Ansage');
});

// ======================================================================
section('Zielphase der Lanze (§5.3)', () => {
  const { g, run, enter, cmd, events, notices, clearInbox } = arena(1);
  const sh = g.ship;
  ok(enter(0, 'weapons'), 'Taktik-Konsole');
  const e = pinnedEnemy(g, 'raider', sh.x + 400, sh.y, Math.PI, { hp: 999 });
  const tick = () => { pin(g); setCharge(g, 'port', 0); setCharge(g, 'stbd', 0); };
  cmd(0, 'weapons.fire', { mount: 'bow' });
  ok(notices(0).length > 0 && !(mountOf(g, 'bow') || {}).aim, 'ohne Ziel: Fehlermeldung');
  cmd(0, 'weapons.target', { id: e.id });
  setCharge(g, 'bow', 0.5);
  const nb = notices(0).length;
  cmd(0, 'weapons.fire', { mount: 'bow' });
  ok(notices(0).length > nb, 'Ladung < 1: Fehlermeldung');
  // Treffer
  setCharge(g, 'bow', 1);
  cmd(0, 'weapons.fire', { mount: 'bow' });
  const a = g.snapshot().ship.mounts.find((m) => m.id === 'bow').aim;
  ok(a && near(a.left, M3.aimTime, 0.05) && near(a.dev, 0, 0.5) && events('aim').some((x) => x.state === 'start'), 'Zielphase beginnt: aim { left 1,5, dev 0 }, Ereignis aim start');
  const hp0 = e.hp;
  run(1.2, tick);
  ok(e.hp === hp0, 'während der Zielphase noch kein Schaden');
  let lance = false;
  run(0.5, () => { tick(); if (g.space.beams.some((b) => b.kind === 'lance')) lance = true; });
  ok(near(hp0 - e.hp, M3.mounts.bow.damage, 0.01) && lance && events('aim').some((x) => x.state === 'fire') && mountOf(g, 'bow').charge < 0.05, `nach 1,5 s Treffer 8 (${hp0 - e.hp}), Strahl lance, aim fire, Ladung 0`);
  // Durchschlagend 2: Schild 4 zählt nur 2
  e.keepShields = true;
  e.shields = [4, 4, 4, 4];
  setCharge(g, 'bow', 1);
  const hp1 = e.hp;
  cmd(0, 'weapons.fire', { mount: 'bow' });
  run(1.7, tick);
  ok(near(hp1 - e.hp, M3.mounts.bow.damage - (4 - M3.mounts.bow.pierce), 0.01), `durchschlagend 2: Schild 4 zählt 2 -> Hülle −6 (${(hp1 - e.hp).toFixed(1)})`);
  e.keepShields = false;
  // Abbruch: Kurs weicht > 5° ab
  clearInbox();
  setCharge(g, 'bow', 1);
  cmd(0, 'weapons.fire', { mount: 'bow' });
  run(0.5, tick);
  sh.angle += 6 * Math.PI / 180; sh.turnVel = 0;
  const hp2 = e.hp;
  run(0.2, tick);
  ok(!mountOf(g, 'bow').aim && near(mountOf(g, 'bow').charge, M3.aimAbortCharge, 0.02) && events('aim').some((x) => x.state === 'abort') && e.hp === hp2, `Abweichung 6°: Abbruch, Ladung 0,7 (${mountOf(g, 'bow').charge.toFixed(2)}), aim abort`);
  sh.angle = 0;
  // 4° Abweichung: kein Abbruch
  setCharge(g, 'bow', 1);
  cmd(0, 'weapons.fire', { mount: 'bow' });
  run(0.3, tick);
  sh.angle = 4 * Math.PI / 180;
  run(0.2, tick);
  const dev = g.snapshot().ship.mounts.find((m) => m.id === 'bow').aim;
  ok(dev && near(dev.dev, 4, 0.3), `4° Abweichung: Zielphase läuft weiter, aim.dev ${dev && dev.dev}`);
  run(1.5, tick); sh.angle = 0;
  // Fehlschuss: Ziel verlässt den Bogen
  clearInbox();
  setCharge(g, 'bow', 1);
  cmd(0, 'weapons.fire', { mount: 'bow' });
  e.pin.y = sh.y + 300;
  const hp3 = e.hp;
  let missBeam = null;
  run(1.7, () => { tick(); const b = g.space.beams.find((q) => q.kind === 'lance'); if (b) missBeam = b; });
  ok(e.hp === hp3 && mountOf(g, 'bow').charge < 0.05 && events('aim').some((x) => x.state === 'miss'), 'Ziel außerhalb des Bogens am Ende: Fehlschuss, Ladung 0, aim miss');
  ok(missBeam && near(Math.hypot(missBeam.x2 - missBeam.x1, missBeam.y2 - missBeam.y1), M3.mounts.bow.range, 40), 'Fehlschuss-Strahl bis zur maximalen Reichweite');
  ok(g.errors === 0, 'keine Server-Fehler');
});

// ======================================================================
section('Ladepunkte (§5.2, §5.5)', () => {
  const { g, run, enter, cmd, notices, P } = arena(1);
  const al = () => { const s = g.snapshot(); return ['bow', 'port', 'stbd'].map((k) => snapMount(s, k).alloc).join(','); };
  ok(enter(0, 'weapons'), 'Taktik-Konsole');
  ok(al() === '2,1,1' && S.chargePoints(g) === 4, 'Start 2,1,1 bei 4 Punkten');
  let nn = notices(0).length;
  cmd(0, 'weapons.alloc', { mount: 'bow', delta: 1 });
  ok(al() === '2,1,1' && notices(0).length > nn, 'Summe > chargePoints abgelehnt');
  cmd(0, 'weapons.alloc', { mount: 'port', delta: -1 });
  cmd(0, 'weapons.alloc', { mount: 'bow', delta: 1 });
  ok(al() === '3,0,1', 'umverteilen: Bb −1, Lanze +1 -> 3,0,1');
  cmd(0, 'weapons.alloc', { mount: 'stbd', delta: -1 });
  cmd(0, 'weapons.alloc', { mount: 'bow', delta: 1 });
  ok(al() === '4,0,0', 'Lanze 4 Punkte');
  setPower(g, { weapons: 3, engines: 1 }); run(0.2, () => pin(g));
  ok(S.chargePoints(g) === 5, 'Energie 3 -> 5 Punkte');
  nn = notices(0).length;
  cmd(0, 'weapons.alloc', { mount: 'bow', delta: 1 });
  ok(al() === '4,0,0' && notices(0).length > nn, 'höchstens 4 je Halterung');
  cmd(0, 'weapons.alloc', { mount: 'port', delta: -1 });
  ok(al() === '4,0,0', 'nicht unter 0');
  setPower(g, { weapons: 2, engines: 2 }); run(0.2, () => pin(g));
  ok(al() === '4,0,0', 'zurück auf 4 Punkte: 4,0,0 bleibt');
  // alloc 0 lädt nicht
  setCharge(g, 'port', 0); run(2, () => pin(g));
  ok(mountOf(g, 'port').charge === 0, 'alloc 0: Batterie lädt nicht');
  // Kürzung: meiste Punkte zuerst
  setPower(g, { weapons: 1, engines: 3 }); run(0.2, () => pin(g));
  ok(S.chargePoints(g) === 3 && al() === '3,0,0' && g.snapshot().ship.chargePoints === 3, 'Energie 1 -> 3 Punkte, Lanze gekürzt (3,0,0)');
  // Gleichstand: zuerst die Batterien
  setPower(g, { weapons: 2, engines: 2 }); run(0.2, () => pin(g));
  // (der Server merkt sich die gewünschte Verteilung und stellt sie bei mehr Energie wieder her – daher hier gezielt umbauen)
  const target = { bow: 2, port: 2, stbd: 0 };
  for (let k = 0; k < 12 && al() !== '2,2,0'; k++) {
    const s0 = g.snapshot();
    const down = ['bow', 'port', 'stbd'].find((id) => snapMount(s0, id).alloc > target[id]);
    const up = ['bow', 'port', 'stbd'].find((id) => snapMount(s0, id).alloc < target[id]);
    cmd(0, 'weapons.alloc', down ? { mount: down, delta: -1 } : { mount: up, delta: 1 });
  }
  ok(al() === '2,2,0', 'Aufbau 2,2,0');
  setPower(g, { weapons: 1, engines: 3 }); run(0.2, () => pin(g));
  ok(al() === '2,1,0', 'Gleichstand Lanze/Bb: Batterie zuerst gekürzt (2,1,0)');
  setPower(g, { weapons: 0, engines: 4 }); run(0.2, () => pin(g));
  ok(S.chargePoints(g) === 0 && al() === '0,0,0', 'Energie 0: 0 Punkte');
  // Unbesetzte Taktik: gleichmäßig reihum ab bow
  g.handleMessage(g.players[0].conn, { t: 'leave' });
  for (const [w, want] of [[2, '2,1,1'], [3, '2,2,1'], [4, '2,2,2'], [1, '1,1,1']]) {
    setPower(g, { weapons: w, engines: 4 - w }); run(0.3, () => pin(g));
    ok(al() === want, `unbesetzt, Energie ${w} (${w + 2} Punkte): ${al()} (Soll ${want})`);
  }
  setPower(g, { weapons: 2, engines: 2 }); run(0.3, () => pin(g));
  // Automatik 0,5: Batterie-Salve und Lanze mit Zielphase
  const sh = g.ship;
  const t = pinnedEnemy(g, 'raider', sh.x, sh.y - 350, 0, { hp: 999 });
  setCharge(g, 'bow', 0); setCharge(g, 'stbd', 0); setCharge(g, 'port', 1);
  const hp0 = t.hp;
  run(1.5, () => { pin(g); setCharge(g, 'bow', 0); setCharge(g, 'stbd', 0); });
  // Abweichung (Studioleitung genehmigt): unbesetzte Taktik = halbe LADEgeschwindigkeit, voller Schaden je Treffer
  ok(near(hp0 - t.hp, M3.mounts.port.tubes * M3.mounts.port.damage, 0.05), `unbesetzt: Bb-Salve mit vollem Schaden (${(hp0 - t.hp).toFixed(1)} von ${M3.mounts.port.tubes * 1.5})`);
  setCharge(g, 'port', 0); run(4, () => { pin(g); setCharge(g, 'bow', 0); setCharge(g, 'stbd', 0); t.hp = 999; });
  const rUn = mountOf(g, 'port').charge / 4;
  ok(near(rUn, 1 / M3.mounts.port.secPerPoint * M3.autoFactor, 0.005), `unbesetzt: Bb lädt mit halber Geschwindigkeit (${(1 / rUn).toFixed(1)} s statt ${M3.mounts.port.secPerPoint} s)`);
  g.space.enemies = [];
  const f = pinnedEnemy(g, 'raider', sh.x + 400, sh.y, Math.PI, { hp: 999 });
  setCharge(g, 'bow', 1);
  const hp1 = f.hp; let aimSeen = false;
  run(0.5, () => { pin(g); setCharge(g, 'port', 0); setCharge(g, 'stbd', 0); if (mountOf(g, 'bow').aim) aimSeen = true; });
  const midHp = f.hp;
  run(1.5, () => { pin(g); setCharge(g, 'port', 0); setCharge(g, 'stbd', 0); });
  ok(aimSeen && midHp === hp1 && near(hp1 - f.hp, M3.mounts.bow.damage, 0.01), `unbesetzt: Lanze mit Zielphase, voller Schaden (${hp1 - f.hp})`);
  ok(g.errors === 0, 'keine Server-Fehler');
});

section('Batterien: Feuer frei / Halten, Salve (§5.4)', () => {
  const { g, run, enter, cmd, events } = arena(1);
  const sh = g.ship;
  enter(0, 'weapons');
  const t = pinnedEnemy(g, 'raider', sh.x, sh.y + 350, 0, { hp: 999 });
  const other = pinnedEnemy(g, 'raider', sh.x + 300, sh.y - 300, 0, { hp: 999 });
  cmd(0, 'weapons.target', { id: other.id });   // Ziel nicht im Stb-Bogen -> nächster Gegner im Bogen
  cmd(0, 'weapons.hold', { mount: 'stbd', hold: true });
  ok(g.snapshot().ship.mounts.find((m) => m.id === 'stbd').hold === true, 'weapons.hold stbd true');
  setCharge(g, 'stbd', 1);
  const hp0 = t.hp;
  run(1, () => { pin(g); setCharge(g, 'bow', 0); setCharge(g, 'port', 0); });
  ok(t.hp === hp0 && mountOf(g, 'stbd').charge >= 1, 'Halten: geladene Batterie feuert nicht von selbst');
  cmd(0, 'weapons.hold', { mount: 'stbd', hold: false });
  let midSalvo = null; let beams = 0;
  run(1, () => {
    pin(g); setCharge(g, 'bow', 0); setCharge(g, 'port', 0);
    const m = g.snapshot().ship.mounts.find((q) => q.id === 'stbd');
    if (m.salvo > 0 && midSalvo === null) midSalvo = m.salvo;
    beams += g.space.beams.filter((b) => b.kind === 'battery' && !b.counted).map((b) => { b.counted = true; return b; }).length;
  });
  ok(near(hp0 - t.hp, 4 * 1.5, 0.01) && other.hp === 999, `Feuer frei: Salve auf den nächsten Gegner im Bogen (4 × 1,5 = ${hp0 - t.hp})`);
  ok(midSalvo !== null && midSalvo >= 1 && beams === 4, `Salve über Zeit (salvo ${midSalvo} ausstehend, 4 Strahlen battery)`);
  ok(events('sfx').some((e) => e.name === 'battery_salvo'), 'sfx battery_salvo');
  // Zusatzrohre: 5
  g.upgrades.seitenturm = true; run(0.1, () => pin(g));
  ok(g.snapshot().ship.mounts.find((m) => m.id === 'port').salvoMax === M3.mounts.port.tubesUpgrade, 'Zusatzrohre: salvoMax 5');
  ok(g.errors === 0, 'keine Server-Fehler');
});

// ======================================================================
section('Altnamen-Befehle (§5.1)', () => {
  const { g, run, enter, cmd, notices } = arena(1);
  const sh = g.ship;
  enter(0, 'weapons');
  const tp = pinnedEnemy(g, 'raider', sh.x, sh.y - 350, 0, { hp: 999 });
  cmd(0, 'weapons.target', { id: tp.id });
  for (const m of ['port', 'stbd']) cmd(0, 'weapons.hold', { mount: m, hold: true });
  const salvoOf = (id) => g.snapshot().ship.mounts.find((m) => m.id === id);
  setCharge(g, 'port', 1); setCharge(g, 'stbd', 1); setCharge(g, 'bow', 0);
  const n0 = notices(0).length;
  cmd(0, 'weapons.fire', { mount: 'phase_l' });
  run(0.05, () => pin(g));
  ok(notices(0).length === n0 && (salvoOf('port').salvo > 0 || mountOf(g, 'port').charge < 1), 'phase_l -> port (Salve gestartet)');
  run(1, () => pin(g));
  g.space.enemies = [];
  const ts = pinnedEnemy(g, 'raider', sh.x, sh.y + 350, 0, { hp: 999 });
  cmd(0, 'weapons.target', { id: ts.id });
  const n1 = notices(0).length;
  cmd(0, 'weapons.fire', { mount: 'phase_r' });
  run(0.05, () => pin(g));
  ok(notices(0).length === n1 && mountOf(g, 'stbd').charge < 1, 'phase_r -> stbd');
  run(1, () => pin(g));
  setCharge(g, 'port', 1); setCharge(g, 'stbd', 1);
  const hp0 = ts.hp;
  cmd(0, 'weapons.fire', { mount: 'both' });
  run(1, () => pin(g));
  ok(hp0 - ts.hp > 0 && !notices(0).some((t) => /Unbekannte Waffe/.test(t)), 'both -> all (feuert, keine „Unbekannte Waffe“)');
  setCharge(g, 'port', 1); setCharge(g, 'stbd', 1);
  const hp1 = ts.hp;
  cmd(0, 'weapons.fire', { mount: 'all' });
  run(1, () => pin(g));
  ok(hp1 - ts.hp > 0, 'all feuert alles im Bogen');
  ok(Protocol.MOUNTS.includes('phase_l') && Protocol.MOUNTS.includes('bow'), 'Protocol.MOUNTS mit Alt- und Neunamen');
});

section('Orbitalschlag: volle Ladung verbrauchen (§5.6)', () => {
  const { g } = arena(1);
  setCharge(g, 'bow', 1); setCharge(g, 'port', 1); setCharge(g, 'stbd', 1);
  ok(S.consumeFullCharge(g) === 'bow' && mountOf(g, 'bow').charge === 0, 'zuerst bow');
  ok(S.consumeFullCharge(g) === 'port' && mountOf(g, 'port').charge === 0, 'dann port');
  ok(S.consumeFullCharge(g) === 'stbd', 'dann stbd');
  ok(S.consumeFullCharge(g) === null, 'keine volle Ladung -> null');
});

// ======================================================================
section('Flugmodell (§6)', () => {
  const { g, run, enter, cmd } = arena(1);
  const sh = g.ship;
  enter(0, 'helm');
  sh.turnVel = 0;
  run(0.5, () => { cmd(0, 'helm.input', { turn: 1, thrust: 0 }); noFire(g); });
  ok(near(sh.turnVel, CONFIG.ship.turnAccel * 0.5, 0.05), `turnVel steigt mit turnAccel (${sh.turnVel.toFixed(3)} nach 0,5 s)`);
  sh.angle = 0; sh.turnVel = 0;
  let t90 = null;
  for (let k = 0; k < 30 * 8 && t90 === null; k++) { cmd(0, 'helm.input', { turn: 1, thrust: 0 }); g.step(); if (sh.angle >= Math.PI / 2) t90 = k / 30; }
  ok(t90 !== null && t90 > 2.8 && t90 < 4, `90° in etwa 3 s (${t90 && t90.toFixed(2)} s)`);
  g.handleMessage(g.players[0].conn, { t: 'leave' });
  run(0.3, () => noFire(g));
  const v1 = Math.abs(sh.turnVel);
  run(1.5, () => noFire(g));
  ok(v1 > 0 && sh.turnVel === 0, `unbesetzte Steuer: turnVel fällt auf 0 (${v1.toFixed(2)} -> ${sh.turnVel})`);
  enter(0, 'helm');
  sh.angle = 0; sh.turnVel = 0;
  run(8, () => { cmd(0, 'helm.input', { turn: 0, thrust: 1 }); noFire(g); });
  ok(sh.speed <= CONFIG.ship.maxSpeed + 0.5 && near(sh.speed, S.maxSpeed(g), 1.5), `Höchsttempo = maxSpeed (${sh.speed.toFixed(1)} / ${S.maxSpeed(g).toFixed(1)}, Basis 130)`);
  cmd(0, 'helm.dodge', { dir: 1 });
  ok(near(sh.dodgeCd, 10, 0.05), 'Ausweichrolle: Abklingzeit 10 s');
  // Gegner-HP × 0,8
  const e = S.spawnEnemy(g, 'gunboat', {});
  const r = S.spawnEnemy(g, 'relay', {});
  ok(e.hpMax === Math.max(1, Math.round(CONFIG.enemies.gunboat.hp * CONFIG.crewScaling[1].enemyHp * M3.enemyHpFactor)) && r.hpMax === CONFIG.enemies.relay.hp, `Gegner-HP × 0,8 (Kanonenboot solo ${e.hpMax}), Relais unverändert`);
});

// ======================================================================
section('Bots auf Befehl, Reparaturliste, Automatik (§8.2)', () => {
  // zu dritt: Automatik aus -> Bots fassen Systeme nicht an, löschen aber Feuer
  {
    const { g, run, enter, cmd, notices, events } = arena(3);
    const tick = () => noFire(g);
    g.ship.systems.battery_port = 'damaged'; g.ship.systems.engines = 'broken';
    const ft = W.REGION_FLOORS[1][0];
    interior.addFire(g, ft.x, ft.y);
    run(40, tick);
    ok(g.ship.systems.battery_port === 'damaged' && g.ship.systems.engines === 'broken' && g.ship.repairQueue.length === 0, 'ohne Liste: Bots fassen kein System an (40 s)');
    ok(!g.ship.fireList.some((f) => f.tx === ft.x && f.ty === ft.y), 'Feuer löschen Bots weiter selbst');
    ok(enter(2, 'captain'), 'Captain');
    cmd(2, 'captain.repair', { system: 'battery_port', mode: 'flick' });
    const q = g.snapshot().ship.repairQueue;
    ok(q.length === 1 && q[0].system === 'battery_port' && q[0].mode === 'flick' && 'bot' in q[0], 'captain.repair: Eintrag { system, mode flick, bot }');
    cmd(2, 'captain.repair', { system: 'battery_port', mode: 'part' });
    ok(g.ship.repairQueue.length === 1 && g.ship.repairQueue[0].mode === 'part', 'gleiches System: nur mode ersetzt');
    cmd(2, 'captain.repair', { system: 'battery_port', mode: null });
    ok(g.ship.repairQueue.length === 0, 'mode null entfernt den Eintrag');
    cmd(2, 'captain.repair', { system: 'battery_port', mode: 'flick' });
    let assigned = false;
    run(45, () => { tick(); if (g.ship.repairQueue.some((x) => x.bot)) assigned = true; });
    ok(assigned && g.ship.systems.battery_port === 'ok', 'flick: Bot übernimmt (bot gesetzt) und flickt -> ' + g.ship.systems.battery_port);
    ok(g.ship.systems.engines === 'broken', 'anderes System bleibt unberührt');
    const parts = g.inventory.ersatzteil;
    cmd(2, 'captain.repair', { system: 'engines', mode: 'part' });
    run(70, tick);
    ok(g.ship.systems.engines === 'ok' && !I.isFragile(g, 'engines') && g.inventory.ersatzteil === parts - 1, 'part: Bot holt Ersatzteil, tauscht aus -> ok, nicht fragil');
    ok(!g.ship.repairQueue.some((x) => x.system === 'engines'), 'Eintrag fällt weg, sobald ok und nicht fragil');
    ok(events('repairDone').some((e) => e.system === 'engines' && e.how === 'bot'), 'repairDone how bot');
    // höchstens 3 Einträge
    for (const s of ['emitter_bow', 'emitter_port', 'emitter_aft', 'emitter_stbd']) g.ship.systems[s] = 'damaged';
    const nn = notices(2).length;
    for (const s of ['emitter_bow', 'emitter_port', 'emitter_aft', 'emitter_stbd']) cmd(2, 'captain.repair', { system: s, mode: 'flick' });
    ok(g.ship.repairQueue.length <= M3.repair.queueMax && notices(2).length > nn, `höchstens ${M3.repair.queueMax} Einträge (4. abgelehnt)`);
    // captain.priority <System> stellt flick an die Spitze
    cmd(2, 'captain.priority', { target: 'emitter_stbd' });
    ok(g.ship.repairQueue[0] && g.ship.repairQueue[0].system === 'emitter_stbd' && g.ship.repairQueue[0].mode === 'flick', 'captain.priority <System>: flick-Eintrag an der Spitze');
    // part ohne Ersatzteil -> Meldung, wird flick
    for (const s of ['emitter_bow', 'emitter_port', 'emitter_aft', 'emitter_stbd']) cmd(2, 'captain.repair', { system: s, mode: null });
    g.inventory.ersatzteil = 0; g.ship.systems.thruster_stbd = 'broken';
    const oda0 = events('oda').length;
    cmd(2, 'captain.repair', { system: 'thruster_stbd', mode: 'part' });
    run(6, tick);
    const e2 = g.ship.repairQueue.find((x) => x.system === 'thruster_stbd');
    ok((!e2 || e2.mode === 'flick') && events('oda').slice(oda0).some((e) => /Ersatzteil/.test(e.text)), 'part ohne Teil im Lager: Meldung, Eintrag wird flick');
    // Automatik zu dritt einschalten
    g.inventory.ersatzteil = 3;
    cmd(2, 'captain.botAuto', { on: true });
    ok(g.ship.botAuto === true && g.snapshot().ship.botAuto === true, 'captain.botAuto on');
    g.ship.repairQueue.length = 0;
    g.ship.systems.weapon_bow = 'broken';
    run(1, tick);
    ok(g.ship.repairQueue.some((x) => x.system === 'weapon_bow' && x.mode === 'part'), 'Automatik: zerstört -> part (Teil im Lager)');
    cmd(2, 'captain.botAuto', { on: false });
    ok(g.ship.botAuto === false, 'captain.botAuto off');
    ok(g.errors === 0, 'keine Server-Fehler (' + g.errors + ')');
  }
  // solo: Automatik an
  {
    const { g, run } = arena(1);
    g.ship.systems.battery_stbd = 'broken'; g.ship.systems.emitter_bow = 'damaged';
    run(1, () => noFire(g));
    const q = g.ship.repairQueue.map((x) => x.system + ':' + x.mode);
    ok(q[0] === 'battery_stbd:part' && q.includes('emitter_bow:flick'), 'solo Automatik: zuerst zerstört (part), dann beschädigt (flick): ' + q.join(' '));
    run(90, () => noFire(g));
    ok(g.ship.systems.battery_stbd === 'ok' && g.ship.systems.emitter_bow === 'ok', 'solo: Bots reparieren selbst (' + g.ship.systems.battery_stbd + ', ' + g.ship.systems.emitter_bow + ')');
  }
  // Notreparatur-Schutz für alle 14 Systeme (kein Teil, niemand da)
  {
    const { g, run } = arena(3);
    g.inventory.ersatzteil = 0;
    for (const s of SYS14) g.ship.systems[s] = 'broken';
    g.ship.reactorCtl.state = 'online';
    run(CONFIG.emergencyRepair.brokenDelay + 2, () => noFire(g));
    const still = SYS14.filter((s) => g.ship.systems[s] === 'broken');
    ok(still.length === 0, 'Notreparatur-Schutz gilt für alle 14 Systeme' + (still.length ? ' – noch zerstört: ' + still.join(',') : ''));
  }
});

// ======================================================================
section('Trefferauswahl statistisch (§4.3)', () => {
  const { g } = arena(3);
  const sectorOf = (s) => I.systemSector(s);
  const opposite = (s) => (s + 2) % 4;
  const stations = SYS14;
  // Erwartung aus den Gewichten des Vertrags (Systeme mit Sektor s ×3, Nachbarn ×1, Mitte mit centreChance)
  const expectOwn = (s) => {
    const w = (x) => (sectorOf(x) === s ? M3.sectorWeight : (sectorOf(x) === (s + 1) % 4 || sectorOf(x) === (s + 3) % 4) ? M3.neighbourWeight : 0);
    const tot = stations.filter((x) => sectorOf(x) >= 0).reduce((a, x) => a + w(x), 0);
    const own = stations.filter((x) => sectorOf(x) === s).reduce((a, x) => a + w(x), 0);
    return (1 - M3.centreChance) * own / tot;
  };
  for (let s = 0; s < 4; s++) {
    const cnt = { own: 0, nb: 0, opp: 0, mid: 0, total: 0 };
    const N = 2000;
    for (let i = 0; i < N; i++) {
      resetSystems(g);
      g.time += 20;
      I.hitSystems(g, s);
      const hit = SYS14.filter((x) => g.ship.systems[x] !== 'ok');
      if (!hit.length) continue;
      cnt.total++;
      const sec = sectorOf(hit[0]);
      if (sec === -1) cnt.mid++; else if (sec === s) cnt.own++; else if (sec === opposite(s)) cnt.opp++; else cnt.nb++;
    }
    const own = cnt.own / cnt.total, mid = cnt.mid / cnt.total, chance = cnt.total / N;
    const exp = expectOwn(s);
    ok(near(chance, CONFIG.hitEffects.systemChance, 0.04), `Sektor ${s}: Systemschaden in ${(chance * 100).toFixed(1)} % der Treffer (Soll 45 %)`);
    ok(cnt.opp === 0, `Sektor ${s}: Gegenseite 0 % (${cnt.opp})`);
    ok(near(mid, M3.centreChance, 0.04), `Sektor ${s}: Mitte ${(mid * 100).toFixed(1)} % (Soll 15 % ± 4)`);
    ok(near(own, exp, 0.05), `Sektor ${s}: eigener Sektor ${(own * 100).toFixed(1)} % (Erwartung aus den Gewichten ${(exp * 100).toFixed(1)} %)`);
    // Vertrag §14: „Sektor s ≥ 50 %“ – mit den Gewichten 3/1 nur für Sektoren mit ≥ 3 Stationen erreichbar
    if (exp >= 0.5) ok(own >= 0.5, `Sektor ${s}: eigener Sektor ≥ 50 % (${(own * 100).toFixed(1)} %)`);
    else console.log(`  info Sektor ${s}: „≥ 50 %“ laut §14 mit den Vertragsgewichten nicht erreichbar (Erwartung ${(exp * 100).toFixed(1)} %), geprüft wird: eigener Sektor ist der häufigste`);
    ok(cnt.own >= cnt.nb / 2 && cnt.own > cnt.mid, `Sektor ${s}: eigener Sektor häufiger als jeder Nachbar und als die Mitte`);
  }
  // Sperre: dasselbe System innerhalb von 10 s nicht erneut
  resetSystems(g);
  for (const s of SYS14) if (s !== 'weapon_bow') g.ship.systems[s] = 'broken';
  g.time += 20;
  g.ship.systems.weapon_bow = 'ok';
  let first = null, again = 0;
  for (let i = 0; i < 200; i++) {
    I.hitSystems(g, 0);
    if (g.ship.systems.weapon_bow === 'damaged' && first === null) first = g.time;
    if (first !== null && g.ship.systems.weapon_bow === 'broken') again++;
    g.time += 0.01;
  }
  ok(first !== null && again === 0, 'systemLock 10 s: getroffenes System nicht sofort erneut');
  // offline-Systeme werden nicht gezogen
  resetSystems(g);
  for (const s of SYS14) interior.setOffline(g, s, 30);
  let changed = 0;
  for (let i = 0; i < 200; i++) { g.time += 20; I.hitSystems(g, 1); changed += SYS14.filter((s) => g.ship.systems[s] !== 'offline').length; }
  ok(changed === 0, 'offline-Systeme werden nicht gezogen');
  // Ereignis systemHit + ODA-Ansage gebündelt
  const t = arena(3);
  resetSystems(t.g);
  t.g.time += 20;
  let hits = 0;
  for (let i = 0; i < 40 && hits < 2; i++) { t.g.time += 11; I.hitSystems(t.g, 1); hits = t.events('systemHit').length; }
  const sh = t.events('systemHit');
  ok(sh.length >= 1 && SYS14.includes(sh[0].system) && ['damaged', 'broken'].includes(sh[0].state), 'Ereignis systemHit { system, state }');
  ok(t.events('oda').some((e) => /(beschädigt|zerstört)/.test(e.text)), 'ODA-Ansage bei Systemschaden');
});

// ======================================================================
section('Hüllentreffer -> Systemschaden über interior.hitSystems (§9.4)', () => {
  const { g } = arena(3);
  let calls = 0; const orig = interior.hitSystems;
  interior.hitSystems = (game, sec) => { calls++; return orig(game, sec); };
  try {
    g.ship.shields.current = [0, 0, 0, 0]; g.ship.shields.allocIntent = [0, 0, 0, 0];
    S.shipHit(g, 2, 1, {});
    g.ship.shields.current = [4, 4, 4, 4];
    S.shipHit(g, 2, 1, {});
  } finally { interior.hitSystems = orig; }
  ok(calls === 1, `shipHit ruft hitSystems nur bei Hüllentreffer (${calls}×)`);
});

// ======================================================================
section('bridgeLeaves (§8.3)', () => {
  const { g, P, send, run, place } = arena(1);
  const door = { x: 34, y: 6, dir: 'left' };
  const walkOut = () => { place(0, door); send(0, { t: 'input', seq: 1, mx: -1, my: 0 }); run(0.8, () => { pin(g); noFire(g); }); send(0, { t: 'input', seq: 2, mx: 0, my: 0 }); run(0.1); };
  const room = () => Maps.roomAt(Math.floor(P(0).x / 32), Math.floor(P(0).y / 32));
  walkOut();
  ok(room() && room().id !== 'bruecke' && g.stats.bridgeLeaves === 0, 'ohne Gegner: kein Zähler');
  S.spawnEnemy(g, 'relay', {});
  walkOut();
  ok(g.stats.bridgeLeaves === 0, 'nur Relais: kein Zähler');
  pinnedEnemy(g, 'raider', g.ship.x + 600, g.ship.y, Math.PI, { hp: 999 });
  walkOut();
  ok(g.stats.bridgeLeaves === 1, 'mit Gegner: Brücke verlassen zählt 1');
  run(1, () => { pin(g); noFire(g); });
  ok(g.stats.bridgeLeaves === 1, 'draußen bleiben zählt nicht weiter');
  walkOut();
  ok(g.stats.bridgeLeaves === 2, 'erneut verlassen: 2');
});

// ======================================================================
section('Testgelände Wellen 4 und 5 (§15)', () => {
  const A = CONFIG.arena;
  ok(A.waves.length >= 5 && A.waves[3].slice().sort().join() === 'gunboat,raider' && A.waves[4].slice().sort().join() === 'gunboat,pylon', 'Welle 4 Kanonenboot+Jäger, Welle 5 Pylon+Kanonenboot');
  const { g } = arena(1);
  ok(SYS14.every((s) => g.ship.systems[s] === 'ok') && g.ship.hull === g.ship.hullMax, 'Start im Testgelände: Schiff unbeschädigt');
});

// ======================================================================
section('QA: tune spaceM3.<pfad> (§10, §17)', () => {
  const combat = require('../server/sim/combat.js');
  const { g } = arena(1);
  const old = CONFIG.spaceM3.tele.gunboat.dur, oldOrbit = CONFIG.combat.raiderOrbit, oldShield = CONFIG.awayCombat.shield.regenDelay;
  try {
    const r1 = combat.tune(g, 'spaceM3.tele.gunboat.dur', '4');
    ok(r1.ok && CONFIG.spaceM3.tele.gunboat.dur === 4, `tune spaceM3.tele.gunboat.dur 4 (${r1.text})`);
    const r2 = combat.tune(g, 'combat.raiderOrbit', 300);
    ok(r2.ok && CONFIG.combat.raiderOrbit === 300, 'tune combat.raiderOrbit 300');
    const r3 = combat.tune(g, 'shield.regenDelay', 5);
    ok(r3.ok && CONFIG.awayCombat.shield.regenDelay === 5, 'awayCombat-Pfade gehen weiter ohne Präfix');
    ok(!combat.tune(g, 'spaceM3.tele', 3).ok && !combat.tune(g, 'gibtsnicht.x', 1).ok, 'Objekte und unbekannte Pfade abgelehnt');
  } finally { CONFIG.spaceM3.tele.gunboat.dur = old; CONFIG.combat.raiderOrbit = oldOrbit; CONFIG.awayCombat.shield.regenDelay = oldShield; }
});

// ======================================================================
section('QA: Teiltreffer gehen nicht verloren (damageEnemy)', () => {
  const { g } = arena(1);
  const e = pinnedEnemy(g, 'raider', g.ship.x + 300, g.ship.y, Math.PI, { hp: 3 });
  for (let i = 0; i < 4; i++) S.damageEnemy(g, e, 0.75);   // 4 × 0,75 = 3 (vorher: 0,8 je Treffer gerundet -> 3,2, aber 0,05er-Fehler je Treffer)
  ok(!g.space.enemies.includes(e), '4 × 0,75 Schaden zerstören einen Gegner mit 3 HP');
  const e2 = pinnedEnemy(g, 'raider', g.ship.x + 300, g.ship.y + 50, Math.PI, { hp: 1 });
  for (let i = 0; i < 3; i++) S.damageEnemy(g, e2, 0.3);
  ok(g.space.enemies.includes(e2) && Math.abs(e2.hp - 0.1) < 1e-6, `3 × 0,3 Schaden lassen 0,1 HP übrig (${e2.hp.toFixed(3)})`);
  S.damageEnemy(g, e2, 0.1);
  ok(!g.space.enemies.includes(e2), 'Gleitkomma-Rest: letzter Teiltreffer 0,1 zerstört');
});

console.log(`\n${n - fails}/${n} M3-Tests bestanden.` + (missing.size ? ` Fehlende Vertragsfunktionen: ${[...missing].join(', ')}` : ''));
process.exit(fails ? 1 : 0);
