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
const Flight = require('../shared/flight.js');
let damage = null;
try { damage = require('../server/sim/damage.js'); } catch (e) { damage = null; }
const LERCHE = CONFIG.shipClasses.lerche;
const M3B = CONFIG.spaceM3b;

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
  chargePoints: fn(space, 'space', 'chargePoints'), shieldCaps: fn(space, 'space', 'shieldCaps'),
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
  ok(Protocol.VERSION >= 3, `Protocol.VERSION ≥ 3 (ist ${Protocol.VERSION}; M4: 4)`);
  ok(SYS14.every((k) => k in sh.systems) && 'weapons' in sh.systems, 'ship.systems: alle 14 Systeme + Altname weapons');
  ok(typeof sh.turnVel === 'number' && sh.turnCap && sh.turnCap.port === 1 && sh.turnCap.stbd === 1, 'ship.turnVel, ship.turnCap { port 1, stbd 1 }');
  ok(Array.isArray(sh.fragile) && sh.fragile.length === 0, 'ship.fragile [] (Liste)');
  ok(Array.isArray(sh.repairQueue) && sh.repairQueue.length === 0, 'ship.repairQueue []');
  ok(sh.botAuto === true, 'ship.botAuto solo an');
  const shd = sh.shields || {};
  ok(['pool', 'alloc', 'current', 'cap', 'burst', 'burstCd'].every((k) => k in shd), 'ship.shields: pool, alloc, current, cap, burst, burstCd');
  ok(JSON.stringify(shd.cap) === '[4,4,4,4]' && shd.burst == null && shd.burstCd === 0, 'Schild-cap [4,4,4,4], kein Stoß, keine Abklingzeit');
  // M3b §4: Schildpool 6 bei Energie 2 (pointsPerPower 3), neue Zähler und Eskalations-Feld
  ok(CONFIG.shields.pointsPerPower === 3 && g.ship.power.shields === 2 && shd.pool === 6 && CONFIG.shields.maxPerSector === 4, `M3b: Schildpool ${shd.pool} bei Energie 2 (pointsPerPower 3, maxPerSector 4)`);
  ok(['leakHits', 'escalations', 'repairSetbacks', 'overflowHull'].every((k) => g.stats[k] === 0), 'M3b: stats leakHits, escalations, repairSetbacks, overflowHull = 0');
  ok(sh.escalate && typeof sh.escalate === 'object' && Object.keys(sh.escalate).length === 0, 'M3b: Snapshot ship.escalate {} ohne Kampf');
  ok(sh.chargePoints === g.ship.power.weapons + 2 && sh.chargePoints === 4, 'chargePoints = Energie Waffen + 2 = 4');
  const bow = snapMount(s, 'bow'), port = snapMount(s, 'port'), stbd = snapMount(s, 'stbd');
  ok(!!bow && !!port && !!stbd && !(sh.mounts || []).some((m) => /^phase_/.test(m.id)), 'mounts: bow/port/stbd, keine phase_*');
  ok(bow && bow.facing === 0 && bow.arc === 16 && bow.range === 650 && port.facing === -90 && port.arc === 70 && stbd.facing === 90 && stbd.range === 520, 'Bögen laut §5.1');
  ok(bow && bow.alloc === 2 && port.alloc === 1 && stbd.alloc === 1, 'Start-Ladepunkte { bow 2, port 1, stbd 1 }');
  ok(bow && ['charge', 'alloc', 'state', 'power', 'charging'].every((k) => k in bow) && bow.state === 'ok' && !('aim' in bow) && bow.power === 0 && bow.charging === false, 'bow: charge, alloc, state, power 0, charging false, kein aim (§20.3)');
  ok(port && ['salvo', 'salvoMax', 'state', 'charge'].every((k) => k in port) && !('hold' in port) && port.salvoMax === 4 && port.salvo === 0, 'Batterien: salvo 0, salvoMax 4, kein hold (§20.4)');
  ok(['bursts', 'burstsPerfect', 'flicks', 'swaps', 'minigames', 'bridgeLeaves', 'dodges', 'dodgeEvades'].every((k) => g.stats[k] === 0), 'stats: bursts, burstsPerfect, flicks, swaps, minigames, bridgeLeaves, dodges, dodgeEvades = 0');
  ok(CONFIG.ship.turnRate === 0.5 && CONFIG.ship.maxSpeed === 130 && CONFIG.ship.accel === 50 && CONFIG.ship.dodgeCooldown === 7 && CONFIG.ship.dodgeImpulse === 350 && CONFIG.ship.turnAccel === 0.8, 'CONFIG.ship laut §10/§20.2 (Ausweichen 350/7)');
  ok(M3.dodgeWindow === 0.8 && M3.lance && M3.lance.chargeTime === 3 && M3.lance.minDamage === 3 && M3.lance.maxDamage === 12 && M3.lance.width === 10 && M3.lance.autoPower === 0.5, 'CONFIG.spaceM3 laut §20.5 (dodgeWindow, lance)');
  ok(CONFIG.shop.find((x) => x.id === 'seitenturm').name === 'Zusatzrohre' && CONFIG.shop.find((x) => x.id === 'seitenturm').price === 300, 'Shop: Zusatzrohre 300');
  // M4 (Studioleitung): Budget 12 → 13 KB, weil deck/lift/kit/loreRead dazukamen (gemessen 12.311 B mit Missionsbuch)
  ok(Buffer.byteLength(JSON.stringify(s)) < 13 * 1024, 'Snapshot < 13 KB');
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
    // M3b: Drehrate = turnRate der Klasse × Drehfaktor (im Stand 0,25) × Düsen-Kappung
    const rate0 = LERCHE.turnRate * Flight.turnFactor(LERCHE, 0);
    ok(near(Math.abs(tv), rate0 * M3.turnCap.broken, 0.01) && Math.sign(tv) === turn, `${sys} zerstört: turnVel ${tv.toFixed(3)} ≈ ${(rate0 * M3.turnCap.broken).toFixed(3)} (im Stand)`);
    g.ship.turnVel = 0;
    run(4, () => { cmd(0, 'helm.input', { turn: -turn, thrust: 0 }); });
    ok(near(Math.abs(g.ship.turnVel), rate0, 0.01), `${sys} zerstört: Gegenseite dreht voll (${g.ship.turnVel.toFixed(3)} ≈ ${rate0.toFixed(3)})`);
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
    ok(capD === 2 && capB === 0 && g.snapshot().ship.shields.cap[sec] === 0, `${em}: cap 4 -> ${capD} (beschädigt) -> ${capB} (zerstört)`);
    ok(allocD <= 2 && curB === 0, `${em}: Sektor hält höchstens ${capD} (alloc ${allocD}), zerstört offen (current ${curB})`);
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
  const nb = notices(0).length; cmd(0, 'weapons.charge', { mount: 'bow', on: true });
  const nb2 = notices(0).length; const hpB = e.hp; cmd(0, 'weapons.fire', { mount: 'bow' });
  ok(nb2 > nb && notices(0).length > nb2 && !g.ship.mount.bow.charging && e.hp === hpB, 'weapon_bow zerstört: lädt nicht auf, feuert nicht');
  set('weapon_bow', 'ok');
  g.space.enemies = [];
  // Batterien: beschädigt 2 Rohre, zerstört lädt/feuert nicht
  for (const [sys, mount, dy] of [['battery_port', 'port', -400], ['battery_stbd', 'stbd', 400]]) {
    set(sys, 'damaged');
    ok(snapMount(g.snapshot(), mount).salvoMax === M3.mounts[mount].tubesDamaged && g.snapshot().ship.systems.weapons === 'damaged', `${sys} beschädigt: salvoMax ${M3.mounts[mount].tubesDamaged}, systems.weapons damaged`);
    const t = pinnedEnemy(g, 'raider', g.ship.x, g.ship.y + dy, 0, { hp: 999 });
    cmd(0, 'weapons.target', { id: t.id });
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
// M3b Schritt A (CONTRACT-M3B §4): Der Schildstoß ist weg, dafür Durchlass-Tabelle, Überlauf, Eskalation, Rückschlag, Autostart
const R = (fnName) => (damage && typeof damage[fnName] === 'function' ? damage[fnName] : fn({}, 'damage', fnName));
function clearHazards(g) { g.ship.fireList = []; g.ship.breachList = []; }
function setShield(g, sec, v) { g.ship.shields.current[sec] = v; }

section('M3b: Schildstoß entfernt (§4)', () => {
  const { g, run, enter, cmd, dbg, notices } = arena(1);
  ok(enter(0, 'captain'), 'Captain-Konsole');
  const n0 = notices(0).length;
  cmd(0, 'captain.burst', { sector: 0 });
  ok(notices(0).slice(n0).some((t) => /Schildstoß gibt es nicht mehr/.test(t)), 'captain.burst: „Den Schildstoß gibt es nicht mehr.“');
  ok(g.ship.shields.burst == null && g.stats.bursts === 0, 'kein Stoß gesetzt, stats.bursts 0');
  dbg(0, { cmd: 'burst', sector: 2 });
  run(0.1, () => { pin(g); noFire(g); });
  const s = g.snapshot().ship.shields;
  ok(s.burst == null && s.burstCd === 0, 'debug burst wirkungslos; Snapshot burst null, burstCd 0 (Altnamen)');
  ok(!!(CONFIG.spaceM3.burst && CONFIG.spaceM3.burst.absorb != null), 'config.spaceM3.burst bleibt als Altname stehen');
  ok(g.errors === 0, 'keine Server-Fehler (' + g.errors + ')');
});

section('M3b: Schildpool 6 (§4)', () => {
  const { g, run, enter, cmd } = arena(1);
  enter(0, 'captain');
  run(0.1, () => { pin(g); noFire(g); });
  const pool = g.snapshot().ship.shields.pool;
  ok(pool === 6, `Pool bei Energie 2: ${pool} (Soll 6)`);
  // alles auf Sektor 0: höchstens maxPerSector 4, Rest verteilt sich
  // (QA M3b: Startverteilung nutzt jetzt den ganzen Pool [2,2,0,2] – erst leeren, sonst ist nichts frei)
  g.ship.shields.allocIntent = [0, 0, 0, 0]; g.ship.shields.alloc = [0, 0, 0, 0];
  for (let i = 0; i < 6; i++) cmd(0, 'captain.shield', { sector: 0, delta: 1 });
  run(0.1, () => { pin(g); noFire(g); });
  const al = g.ship.shields.alloc;
  ok(al[0] === 4 && al.reduce((a, b) => a + b, 0) <= 6, `Sektor 0 höchstens 4 (alloc ${al.join('/')}, Summe ≤ 6)`);
  setPower(g, { shields: 3, weapons: 1 });
  run(0.1, () => { pin(g); noFire(g); });
  ok(g.snapshot().ship.shields.pool === 9, `Energie 3: Pool ${g.snapshot().ship.shields.pool} (Soll 9)`);
});

section('M3b: Schild-Durchlass statistisch (§4)', () => {
  const { g } = arena(3);
  const resolveHit = R('resolveHit');
  const N = 2000;
  const rows = [
    { s: 0, heavy: false, want: 0.45 }, { s: 1, heavy: false, want: 0.2 }, { s: 2, heavy: true, want: 0.05 }, { s: 2, heavy: false, want: 0 },
    { s: 3, heavy: true, want: 0 }, { s: 4, heavy: false, want: 0 },
  ];
  const leak0 = g.stats.leakHits;
  let leakCount = 0;
  for (const row of rows) {
    let hits = 0, broken = 0, centre = 0, opp = 0;
    for (let i = 0; i < N; i++) {
      resetSystems(g); clearHazards(g); g.ship.hull = g.ship.hullMax;
      g.time += 20;
      const sec = i % 4;
      setShield(g, sec, row.s);
      const r = resolveHit(g, sec, 1, { heavy: row.heavy });
      const hit = SYS14.filter((x) => g.ship.systems[x] !== 'ok' && g.ship.systems[x] !== 'offline');
      if (hit.length) {
        hits++;
        if (row.s > 0) leakCount++;
        if (hit.some((x) => g.ship.systems[x] === 'broken')) broken++;
        if (hit.some((x) => I.systemSector(x) === -1)) centre++;
        if (hit.some((x) => I.systemSector(x) === (sec + 2) % 4)) opp++;
      }
      if (i === 0) ok(r && typeof r.absorbed === 'number' && Array.isArray(r.systems) && typeof r.hull === 'number', `resolveHit -> { absorbed ${r && r.absorbed}, hull ${r && r.hull}, systems [${r && r.systems.length}] }`);
    }
    const q = hits / N;
    ok(near(q, row.want, 0.03), `S ${row.s}${row.heavy ? ' (schwer)' : ''}: Systemschaden in ${(q * 100).toFixed(1)} % von ${N} Treffern (Soll ${(row.want * 100).toFixed(0)} % ± 3)`);
    if (row.s >= 1 && hits) ok(broken === 0 && centre === 0, `S ${row.s}: höchstens beschädigt, nie Mittschiffs (zerstört ${broken}, Mitte ${centre})`);
    if (row.s === 0 && hits) ok(centre > 0 && opp === 0, `S 0: Mittschiffs möglich (${centre}×), Gegenseite nie (${opp})`);
  }
  ok(g.stats.leakHits - leak0 === leakCount, `stats.leakHits zählt Systemschaden trotz Schild (${g.stats.leakHits - leak0} = ${leakCount})`);
  // S 1 bricht Geflicktes (breakFragile), S 2 nicht
  const frag = (s, heavy) => {
    let n = 0;
    for (let i = 0; i < 400; i++) {
      resetSystems(g); clearHazards(g); g.time += 20;
      g.ship.systems.battery_stbd = 'damaged'; g.ship.fragile.battery_stbd = true;
      setShield(g, 1, s);
      resolveHit(g, 1, 1, { heavy });
      if (g.ship.systems.battery_stbd === 'broken') n++;
    }
    return n / 400;
  };
  const f1 = frag(1, false), f2 = frag(2, true), f0 = frag(0, false);
  ok(near(f1, 0.2, 0.06) && f2 === 0 && f0 === 1, `Geflicktes im Sektor bricht: S 0 immer (${(f0 * 100).toFixed(0)} %), S 1 mit 20 % (${(f1 * 100).toFixed(0)} %), S 2 nie (${(f2 * 100).toFixed(0)} %)`);
  ok(g.errors === 0, 'keine Server-Fehler (' + g.errors + ')');
});

section('M3b: Überlauf auf die Hülle, schwere Treffer (§4)', () => {
  const { g } = arena(3);
  const sh = g.ship;
  const hit = (sec, s, dmg, opts) => {
    resetSystems(g); clearHazards(g); g.time += 20; sh.hull = 100;
    setShield(g, sec, s);
    const of0 = g.stats.overflowHull;
    S.shipHit(g, sec, dmg, opts || {});
    return { hull: 100 - sh.hull, shield: sh.shields.current[sec], of: g.stats.overflowHull - of0 };
  };
  const a = hit(1, 2, 3);
  ok(near(a.hull, 5, 0.01) && a.shield === 0 && near(a.of, 5, 0.01), `S 2, Treffer 3: Schild schluckt 2 (-> ${a.shield}), Rest 1 -> Hülle −${a.hull} (5 × Rest), overflowHull +${a.of}`);
  const b = hit(1, 4, 3);
  ok(b.hull === 0 && b.shield === 1 && b.of === 0, `S 4, Treffer 3: nichts durch (Schild -> ${b.shield}, Hülle −${b.hull})`);
  const c = hit(2, 0, 2);
  ok(near(c.hull, 10, 0.01) && c.of === 0, `S 0, Treffer 2: Hülle −${c.hull}, kein Überlauf (kein Schild)`);
  const d = hit(3, 1, 1);
  ok(d.hull === 0 && d.shield === 0, `S 1, Treffer 1: ganz gefangen (bisher schluckte 1 Punkt jeden Treffer – jetzt nur 1 Schaden)`);
  const d2 = hit(3, 1, 4);
  ok(near(d2.hull, 15, 0.01) && near(d2.of, 15, 0.01), `S 1, Treffer 4: Rest 3 -> Hülle −${d2.hull} (neu: bisher hielt 1 Punkt den ganzen Treffer)`);
  // Durchschlag (Zahl): Schild für diesen Treffer um pierce schwächer
  const e = hit(0, 3, 3, { pierce: 2 });
  ok(near(e.hull, 10, 0.01), `S 3, Treffer 3, pierce 2: wirksam S 1 -> Rest 2, Hülle −${e.hull}`);
  // Schwere Treffer: S ≥ 3 -> Schaden − heavyReduce (1) vor dem Absorbieren
  const h3 = hit(0, 3, 3, { heavy: true });
  ok(h3.hull === 0 && h3.shield === 1, `S 3, schwer 3: −1 -> 2 absorbiert (Schild -> ${h3.shield}), Hülle −${h3.hull}`);
  const h4 = hit(0, 4, 5, { heavy: true });
  ok(h4.hull === 0 && h4.shield === 0, `S 4, schwer 5: −1 -> 4 absorbiert (Schild -> ${h4.shield}), Hülle −${h4.hull}`);
  const h2 = hit(0, 2, 3, { heavy: true });
  ok(near(h2.hull, 5, 0.01) && h2.shield === 0, `S 2, schwer 3: keine Minderung (unter 3) -> Rest 1, Hülle −${h2.hull}`);
  ok(M3B.shieldLeak[3].heavyReduce === 1 && M3B.shieldLeak[4].heavyReduce === 1 && M3B.shieldOverflow === true, 'Konfig: heavyReduce 1 bei S 3/4, shieldOverflow an');
  // Feuer und Lecks nur bei Rest > 0
  let fires = 0, breaches = 0;
  for (let i = 0; i < 300; i++) { resetSystems(g); clearHazards(g); g.time += 20; setShield(g, i % 4, 4); S.shipHit(g, i % 4, 2, {}); fires += sh.fireList.length; breaches += sh.breachList.length; }
  let fires0 = 0;
  for (let i = 0; i < 300; i++) { resetSystems(g); clearHazards(g); g.time += 20; sh.hull = 100; setShield(g, i % 4, 0); S.shipHit(g, i % 4, 1, {}); fires0 += sh.fireList.length + sh.breachList.length; }
  ok(fires === 0 && breaches === 0 && fires0 > 30, `Feuer/Lecks nur bei Rest > 0 (gefangen: ${fires}/${breaches}, durch: ${fires0} in 300 Treffern)`);
  // EMP: nur wenn der Schild durchschlagen ist
  resetSystems(g); setShield(g, 0, 4); S.shipHit(g, 0, 1, { emp: true });
  const off1 = Object.values(sh.systems).includes('offline');
  resetSystems(g); setShield(g, 0, 0); S.shipHit(g, 0, 1, { emp: true });
  const off2 = Object.values(sh.systems).includes('offline');
  ok(!off1 && off2, `EMP: gefangen kein System offline (${off1}), durchschlagen eines offline (${off2})`);
  resetSystems(g);
  ok(g.errors === 0, 'keine Server-Fehler (' + g.errors + ')');
});

section('M3b: Eskalation nach 20 s (§4)', () => {
  const after = M3B.escalation.after;
  ok(after === 20, 'spaceM3b.escalation.after 20 s');
  const { g, run, events, P, place, send } = arena(3);
  const tick = () => { pin(g); noFire(g); g.ship.hull = g.ship.hullMax; g.ship.shields.current = [4, 4, 4, 4]; };
  const stationOf = (sys) => stationTiles(sys)[0];
  const nearStation = (sys) => { const st = stationOf(sys); return g.ship.fireList.filter((f) => Math.abs(f.tx - st.x) <= 1 && Math.abs(f.ty - st.y) <= 1); };
  // ohne Kampf: kein Zähler
  g.ship.systems.battery_port = 'damaged';
  run(after + 2, tick);
  ok(g.stats.escalations === 0 && !('battery_port' in g.snapshot().ship.escalate), 'ohne Gegner: kein Zähler, keine Eskalation');
  // nur Störrelais: kein Kampf
  S.spawnEnemy(g, 'relay', {});
  run(3, tick);
  ok(!('battery_port' in g.snapshot().ship.escalate), 'nur Störrelais: kein Zähler');
  g.space.enemies = [];
  // Gegner da (Jäger fest, Bug vom Schiff weg)
  pinnedEnemy(g, 'raider', g.ship.x + 700, g.ship.y, 0, { hp: 999 });
  run(1, tick);
  const e1 = g.snapshot().ship.escalate;
  ok(typeof e1.battery_port === 'number' && e1.battery_port >= after - 2 && e1.battery_port <= after, `Kampf: Snapshot ship.escalate.battery_port = ${e1.battery_port} s Rest`);
  run(after - 2, tick);
  ok(g.stats.escalations === 0 && nearStation('battery_port').length === 0, `nach ${after - 1} s: noch kein Feuer (Rest ${g.snapshot().ship.escalate.battery_port} s)`);
  run(1.5, tick);
  ok(g.stats.escalations === 1 && events('escalated').some((e) => e.system === 'battery_port'), `nach ${after + 0.5} s: Ereignis escalated { system battery_port }, stats.escalations ${g.stats.escalations}`);
  ok(nearStation('battery_port').length >= 1 || events('escalated').some((e) => e.system === 'battery_port' && Math.abs(e.tx - stationOf('battery_port').x) <= 1), 'Feuer auf einer Bodenkachel neben der Station');
  const e2 = g.snapshot().ship.escalate.battery_port;
  ok(e2 == null || e2 >= after - 2, `Zähler beginnt neu (Rest ${e2} s)`);
  ok(events('oda').some((e) => /brennt/.test(e.text)), 'ODA-Ansage „… es brennt neben der Station …“');
  // Wer daran arbeitet, stoppt den Zähler (Spieler hält E an der Station = Flicken)
  resetSystems(g); clearHazards(g); g.ship.escalateT = {};
  g.ship.systems.emitter_aft = 'damaged';
  run(5, tick);
  const sp = sysSpot('emitter_aft');
  place(0, sp); send(0, { t: 'act', down: true });
  run(0.3, tick);
  const working = P(0).hold && P(0).hold.system === 'emitter_aft'; const hk = P(0).hold ? P(0).hold.kind : '-';
  const left = g.snapshot().ship.escalate.emitter_aft;
  send(0, { t: 'act', down: false });
  ok(working && left == null, `Spieler arbeitet daran: kein Zähler (hold ${hk}, escalate ${left})`);
  ok(g.errors === 0, 'keine Server-Fehler (' + g.errors + ')');
});

section('M3b: Rückschlag 50 % bei Hüllentreffer im Sektor (§4)', () => {
  const loss = M3B.repairHitLoss;
  ok(loss === 0.5, 'spaceM3b.repairHitLoss 0,5');
  const { g, run, P, place, send, events } = arena(3);
  const tick = () => { pin(g); noFire(g); };
  // Spieler flickt die Batterie Steuerbord (Sektor 1)
  g.ship.systems.battery_stbd = 'damaged';
  place(0, sysSpot('battery_stbd'));
  send(0, { t: 'act', down: true });
  run(0.9, tick);
  const h = P(0).hold;
  const t0 = h ? h.t : null;
  ok(h && h.kind === 'flick' && h.system === 'battery_stbd' && t0 > 0.5, `Flicken läuft (${h && h.kind} ${h && h.system}, t ${t0 && t0.toFixed(2)} s)`);
  // Treffer in anderem Sektor: kein Rückschlag
  setShield(g, 3, 0); g.time += 0; S.shipHit(g, 3, 1, {});
  ok(P(0).hold && near(P(0).hold.t, t0, 0.001), 'Hüllentreffer in Sektor 3: Fortschritt unverändert');
  // Treffer im Sektor, ganz gefangen: kein Rückschlag
  setShield(g, 1, 4); S.shipHit(g, 1, 1, {});
  ok(P(0).hold && near(P(0).hold.t, t0, 0.001), 'Treffer im Sektor, vom Schild gefangen: Fortschritt unverändert');
  // Hüllentreffer im Sektor: −50 %
  setShield(g, 1, 0); const sb0 = g.stats.repairSetbacks;
  S.shipHit(g, 1, 1, {});
  ok(P(0).hold && near(P(0).hold.t, t0 * (1 - loss), 0.001), `Hüllentreffer Sektor 1: Fortschritt ${t0.toFixed(2)} -> ${P(0).hold && P(0).hold.t.toFixed(2)} s (−50 %)`);
  ok(g.stats.repairSetbacks === sb0 + 1 && events('repairSetback').some((e) => e.system === 'battery_stbd'), `Ereignis repairSetback { system }, stats.repairSetbacks ${g.stats.repairSetbacks}`);
  send(0, { t: 'act', down: false }); run(0.1, tick);
  // Minispiel-Mindestzeit
  resetSystems(g); g.ship.systems.emitter_port = 'damaged';
  place(0, sysSpot('emitter_port'));
  send(0, { t: 'cmd', c: 'repair.start', system: 'emitter_port' });
  run(1.6, tick);
  const mg = P(0).hold;
  const m0 = mg ? mg.t : null;
  setShield(g, 3, 0); S.shipHit(g, 3, 1, {});
  ok(mg && mg.kind === 'minigame' && near(P(0).hold.t, m0 * (1 - loss), 0.001), `Minispiel: Mindestzeit-Fortschritt ${m0 && m0.toFixed(2)} -> ${P(0).hold && P(0).hold.t.toFixed(2)} s`);
  send(0, { t: 'cmd', c: 'repair.done', system: 'emitter_port', errors: 0 }); run(0.1, tick);
  // Bot-Arbeit (Reparaturliste, Captain) – Rückschlag am Bot-Fortschritt
  resetSystems(g); g.ship.systems.engines = 'damaged';
  const cap = 2; place(cap, conSpot('captain')); send(cap, { t: 'act', down: true }); send(cap, { t: 'act', down: false });
  send(cap, { t: 'cmd', c: 'captain.repair', system: 'engines', mode: 'flick' });
  let bot = null;
  for (let k = 0; k < 30 * 40 && !bot; k++) { tick(); g.step(); bot = g.bots.find((b) => b.task && b.task.kind === 'repair' && b.task.system === 'engines' && b.task.phase === 'work' && b.progress > 0.2); }
  if (bot) {
    const p0 = bot.progress;
    setShield(g, 2, 0); S.shipHit(g, 2, 1, {});
    ok(near(bot.progress, p0 * (1 - loss), 0.001), `Bot flickt Triebwerk (Sektor 2): Fortschritt ${p0.toFixed(2)} -> ${bot.progress.toFixed(2)}`);
  } else ok(false, 'Bot hat die Triebwerk-Reparatur nicht in 40 s begonnen');
  ok(g.errors === 0, 'keine Server-Fehler (' + g.errors + ')');
});

section('M3b: Reaktor-Autostart im Gefecht (§4)', () => {
  const auto = M3B.reactorAutoRestart;
  ok(auto === 3, 'spaceM3b.reactorAutoRestart 3 s');
  const { g, run } = arena(1);
  const tick = () => { pin(g); noFire(g); };
  pinnedEnemy(g, 'raider', g.ship.x + 700, g.ship.y, 0, { hp: 999 });
  g.ship.systems.reactor = 'broken'; run(0.1, tick);
  I.repairSystem(g, 'reactor', 'p1', 'flick');
  ok(g.ship.reactorCtl.state === 'offline', 'zerstört -> geflickt im Gefecht: zunächst offline');
  run(auto - 0.3, tick);
  ok(g.ship.reactorCtl.state === 'offline', `nach ${auto - 0.3} s noch offline`);
  run(0.5, tick);
  ok(g.ship.reactorCtl.state === 'online', `nach ${auto + 0.2} s startet er von selbst (${g.ship.reactorCtl.state})`);
  // ohne Gegner: Neustart zu zweit bleibt
  g.space.enemies = [];
  g.ship.systems.reactor = 'broken'; run(0.1, tick);
  I.repairSystem(g, 'reactor', 'p1', 'flick');
  run(auto + 2, tick);
  ok(g.ship.reactorCtl.state === 'offline', 'ohne Gegner: bleibt offline (Neustart zu zweit)');
  ok(g.errors === 0, 'keine Server-Fehler (' + g.errors + ')');
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
section('Lanze als Ladewaffe (§20.3)', () => {
  const { g, run, enter, cmd, events, notices, clearInbox, leave, dbg } = arena(1);
  const sh = g.ship;
  const L = M3.lance;
  ok(enter(0, 'weapons'), 'Taktik-Konsole');
  const e = pinnedEnemy(g, 'raider', sh.x + 400, sh.y, Math.PI, { hp: 999 });
  const tick = () => { pin(g); setCharge(g, 'port', 0); setCharge(g, 'stbd', 0); };
  const bowSnap = () => g.snapshot().ship.mounts.find((m) => m.id === 'bow');
  // Bereitschaft < 1: kein Aufladen
  setCharge(g, 'bow', 0.5);
  let nb = notices(0).length;
  cmd(0, 'weapons.charge', { mount: 'bow', on: true });
  ok(notices(0).length > nb && !mountOf(g, 'bow').charging, 'Bereitschaft < 1: kein Aufladen, Hinweis');
  // Aufladen ohne gewähltes Ziel
  setCharge(g, 'bow', 1);
  clearInbox();
  cmd(0, 'weapons.charge', { mount: 'bow', on: true });
  ok(mountOf(g, 'bow').charging && events('lance').some((x) => x.state === 'charge' && x.power === 0) &&
    events('sfx').some((x) => x.name === 'lance_charge' && x.key === 'lance'), 'weapons.charge on: Aufladen beginnt ohne Ziel, Ereignis lance charge, sfx lance_charge {key lance}');
  run(1.5, tick);
  const b1 = bowSnap();
  ok(b1.charging === true && near(b1.power, 1.5 / L.chargeTime, 0.04) && e.hp === 999, `nach 1,5 s: power ${b1.power} (≈ 0,5), noch kein Schaden`);
  // Drehen bricht nicht ab
  sh.angle = 0.3; run(0.2, tick); sh.angle = 0; run(0.1, tick);
  ok(mountOf(g, 'bow').charging, 'Drehen bricht das Aufladen nicht ab');
  run(2, tick);
  ok(bowSnap().power === 1 && bowSnap().charging, 'nach 3 s: power 1, bleibt voll');
  // Loslassen = Feuer: voller Schaden 12 auf den Gegner in der Linie
  clearInbox();
  let lanceBeam = null;
  cmd(0, 'weapons.charge', { mount: 'bow', on: false });
  lanceBeam = g.space.beams.find((b) => b.kind === 'lance');
  ok(near(999 - e.hp, L.maxDamage, 0.01) && !mountOf(g, 'bow').charging && mountOf(g, 'bow').charge < 0.05, `loslassen: Treffer ${999 - e.hp} (Soll ${L.maxDamage}), Bereitschaft 0`);
  const ev = events('lance').find((x) => x.state === 'fire');
  ok(ev && ev.power === 1 && ev.hit === e.id && events('sfx').some((x) => x.name === 'lance_fire' && x.power === 1), 'Ereignis lance { fire, power 1, hit id }, sfx lance_fire { power }');
  ok(lanceBeam && !lanceBeam.miss && near(Math.hypot(lanceBeam.x2 - lanceBeam.x1, lanceBeam.y2 - lanceBeam.y1), 400 - 34, 25), 'Strahl lance bis zum Gegner');
  ok(!events('lance').some((x) => x.kind !== 'lance'), 'Ereignis lance: Typ nicht überschrieben');
  // Schaden je power: halb -> 3 + 9 × 0,5 = 7,5
  e.hp = 999; setCharge(g, 'bow', 1);
  cmd(0, 'weapons.charge', { mount: 'bow', on: true });
  run(L.chargeTime / 2 - 1 / 30, tick);   // ein Tick im Befehl schon mitgezählt? nein -> power genau ½
  const pw = mountOf(g, 'bow').power;
  cmd(0, 'weapons.charge', { mount: 'bow', on: false });
  ok(near(999 - e.hp, L.minDamage + (L.maxDamage - L.minDamage) * pw, 0.01) && near(pw, 0.5, 0.05), `power ${pw.toFixed(2)}: Schaden ${(999 - e.hp).toFixed(2)} = min + (max − min) × power`);
  // aus dem Stand: weapons.fire bow = power 0 -> Mindestschaden
  e.hp = 999; setCharge(g, 'bow', 1);
  cmd(0, 'weapons.fire', { mount: 'bow' });
  ok(near(999 - e.hp, L.minDamage, 0.01), `weapons.fire bow aus dem Stand: Mindestschaden ${999 - e.hp}`);
  // Treffer = erster Gegner nahe der Linie (seitlich versetzt innerhalb hitRadius + width), ohne Ziel
  e.hp = 999;
  const e2 = pinnedEnemy(g, 'raider', sh.x + 250, sh.y + (CONFIG.combat.hitRadius.raider + L.width - 3), Math.PI, { hp: 999 });
  setCharge(g, 'bow', 1);
  cmd(0, 'weapons.target', { id: e.id });   // gewähltes Ziel spielt keine Rolle
  cmd(0, 'weapons.fire', { mount: 'bow' });
  ok(e2.hp < 999 && e.hp === 999, 'erster Gegner auf der Linie wird getroffen (seitlich 23 px versetzt, vor dem gewählten Ziel)');
  // knapp außerhalb (hitRadius + width + 3): kein Treffer an e2, aber e dahinter
  e2.pin.y = sh.y + (CONFIG.combat.hitRadius.raider + L.width + 3); e2.hp = 999; run(0.05, tick);
  setCharge(g, 'bow', 1);
  cmd(0, 'weapons.fire', { mount: 'bow' });
  ok(e2.hp === 999 && e.hp < 999, 'knapp neben der Linie: verfehlt, der Gegner dahinter wird getroffen');
  g.space.enemies = g.space.enemies.filter((q) => q !== e2);
  // Durchschlagend 2: Schild 4 zählt 2 -> bei voller power 12 − 2 = 10
  e.hp = 999; e.keepShields = true; e.shields = [4, 4, 4, 4];
  setCharge(g, 'bow', 1);
  cmd(0, 'weapons.charge', { mount: 'bow', on: true });
  run(L.chargeTime + 0.2, tick);
  cmd(0, 'weapons.charge', { mount: 'bow', on: false });
  ok(near(999 - e.hp, L.maxDamage - (4 - M3.mounts.bow.pierce), 0.01), `durchschlagend 2: Schild 4 zählt 2 -> Hülle −${999 - e.hp}`);
  e.keepShields = false;
  // Fehlschuss ins Leere: Strahl bis range, kind lance, miss
  e.pin.y = sh.y + 300; run(0.05, tick);
  clearInbox();
  setCharge(g, 'bow', 1); e.hp = 999;
  cmd(0, 'weapons.fire', { mount: 'bow' });
  const mb = g.space.beams.filter((b) => b.kind === 'lance').pop();
  const snapBeam = (g.snapshot().space.beams || []).find((b) => b.kind === 'lance' && b.miss);
  ok(e.hp === 999 && mb && mb.miss && near(Math.hypot(mb.x2 - mb.x1, mb.y2 - mb.y1), M3.mounts.bow.range, 1) && mountOf(g, 'bow').charge === 0, 'ins Leere: Strahl bis 650, Bereitschaft 0');
  ok(snapBeam && snapBeam.ttlMax > 0 && events('lance').some((x) => x.state === 'fire' && x.hit === null), 'Snapshot-Strahl lance { miss, ttlMax }, Ereignis hit null');
  e.pin.y = sh.y;
  // Konsole verlassen: Aufladen verpufft ohne Schuss
  run(0.05, tick);
  setCharge(g, 'bow', 1); e.hp = 999;
  cmd(0, 'weapons.charge', { mount: 'bow', on: true });
  run(1, tick);
  clearInbox();
  leave(0);
  run(0.1, () => { tick(); setCharge(g, 'bow', 0); });
  ok(!mountOf(g, 'bow').charging && mountOf(g, 'bow').power === 0 && e.hp === 999 && events('lance').some((x) => x.state === 'fizzle') && !g.space.beams.some((b) => b.kind === 'lance'), 'Konsole verlassen: Aufladen verpufft ohne Schuss (lance fizzle)');
  // System fällt aus: verpufft
  enter(0, 'weapons');
  setCharge(g, 'bow', 1);
  cmd(0, 'weapons.charge', { mount: 'bow', on: true });
  run(0.5, tick);
  g.ship.systems.weapon_bow = 'broken';
  run(0.1, tick);
  ok(!mountOf(g, 'bow').charging && e.hp === 999, 'System zerstört: Aufladen verpufft');
  g.ship.systems.weapon_bow = 'damaged';
  // beschädigt: chargeTime × 1,5, maxDamage × 0,75
  setCharge(g, 'bow', 1);
  cmd(0, 'weapons.charge', { mount: 'bow', on: true });
  run(L.chargeTime, tick);
  const pD = mountOf(g, 'bow').power;
  run(L.chargeTime * 0.6, tick);
  cmd(0, 'weapons.charge', { mount: 'bow', on: false });
  ok(near(pD, 1 / L.damagedTimeFactor, 0.04) && near(999 - e.hp, L.maxDamage * L.damagedMaxFactor, 0.01), `beschädigt: nach 3 s power ${pD.toFixed(2)} (≈ 0,67), voll ${999 - e.hp} (Soll 9)`);
  g.ship.systems.weapon_bow = 'ok';
  // Unbesetzt: Lanze feuert automatisch mit autoPower, wenn ein Gegner in der Linie liegt
  leave(0);
  e.hp = 999; setCharge(g, 'bow', 1);
  e.pin.y = sh.y + 300; run(0.5, tick);
  ok(e.hp === 999 && mountOf(g, 'bow').charge >= 1, 'unbesetzt, kein Gegner in der Linie: kein Schuss');
  e.pin.y = sh.y; run(0.2, tick);
  ok(near(999 - e.hp, L.minDamage + (L.maxDamage - L.minDamage) * L.autoPower, 0.01), `unbesetzt: automatisch mit power 0,5 -> ${999 - e.hp}`);
  // Snapshot-Auszug (für den Bericht)
  enter(0, 'weapons'); setCharge(g, 'bow', 1);
  cmd(0, 'weapons.charge', { mount: 'bow', on: true }); run(1, tick);
  console.log('  info Snapshot bow beim Aufladen: ' + JSON.stringify(bowSnap()));
  ok(g.errors === 0, 'keine Server-Fehler');
});

section('Ausweich-Fenster (§20.2)', () => {
  const { g, run, enter, cmd, events, dbg, clearInbox } = arena(1);
  const sh = g.ship;
  const tick = () => { pin(g); noFire(g); };
  sh.shields.current = [0, 0, 0, 0]; sh.shields.allocIntent = [0, 0, 0, 0];
  const gb = pinnedEnemy(g, 'gunboat', sh.x, sh.y - 380, 0, { hp: 999 });
  ok(enter(0, 'helm'), 'Steuer');
  // Versatz messen: Ausweichen aus dem Stand, Querversatz nach 0,8 s und nach 3 s
  const y0 = sh.y, x0 = sh.x;
  cmd(0, 'helm.dodge', { dir: 1 });
  run(0.8, () => { cmd(0, 'helm.input', { turn: 0, thrust: 0 }); tick(); });
  const d08 = Math.hypot(sh.x - x0, sh.y - y0);
  run(2.2, () => { cmd(0, 'helm.input', { turn: 0, thrust: 0 }); tick(); });
  const d3 = Math.hypot(sh.x - x0, sh.y - y0);
  console.log(`  info Ausweichen (Impuls ${CONFIG.ship.dodgeImpulse}): Versatz ${d08.toFixed(0)} px nach 0,8 s, ${d3.toFixed(0)} px gesamt`);
  ok(d08 > 100 && d3 > 140, `Schub spürbar: ${d08.toFixed(0)} px nach 0,8 s, ${d3.toFixed(0)} px gesamt`);
  ok(near(sh.dodgeCd, CONFIG.ship.dodgeCooldown - 3, 0.1) && g.stats.dodges === 1, `Abklingzeit 7 s (Rest ${sh.dodgeCd.toFixed(1)}), stats.dodges 1`);
  // zurück in den Bogen
  sh.x = x0; sh.y = y0; sh.vx = 0; sh.vy = 0; sh.dodgeCd = 0; run(0.1, tick);
  // Ausweichen im Fenster (0,5 s vor Ende): verfehlt
  clearInbox();
  dbg(0, { cmd: 'tele', id: gb.id });
  const dur = gb.tele.dur;
  run(dur - 0.5, tick);
  cmd(0, 'helm.dodge', { dir: 1 });
  const hull0 = sh.hull;
  run(0.7, () => { tick(); sh.x = x0; sh.y = y0; sh.vx = 0; sh.vy = 0; });   // im Bogen festhalten: nur das Fenster zählt
  ok(!gb.tele && sh.hull === hull0 && events('teleMiss').some((x) => x.id === gb.id && x.dodged === true) && events('sfx').some((x) => x.name === 'dodge_evade') && g.stats.dodgeEvades === 1,
    'Ausweichen 0,5 s vor Ende: verfehlt (teleMiss dodged, sfx dodge_evade, stats.dodgeEvades 1)');
  // zu früh (1,5 s vor Ende): trifft
  clearInbox(); sh.dodgeCd = 0;
  dbg(0, { cmd: 'tele', id: gb.id });
  run(dur - 1.5, tick);
  cmd(0, 'helm.dodge', { dir: 1 });
  const hull1 = sh.hull;
  run(1.7, () => { tick(); sh.x = x0; sh.y = y0; sh.vx = 0; sh.vy = 0; });
  ok(!gb.tele && sh.hull < hull1 && !events('teleMiss').some((x) => x.dodged), `Ausweichen 1,5 s vor Ende: Treffer (Hülle ${hull1} -> ${sh.hull})`);
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
  const hp1 = f.hp;
  run(0.5, () => { pin(g); setCharge(g, 'port', 0); setCharge(g, 'stbd', 0); });
  const autoDmg = M3.lance.minDamage + (M3.lance.maxDamage - M3.lance.minDamage) * M3.lance.autoPower;
  ok(near(hp1 - f.hp, autoDmg, 0.01), `unbesetzt: Lanze feuert automatisch mit power 0,5 (${hp1 - f.hp}, Soll ${autoDmg}) – §20.3`);
  ok(g.errors === 0, 'keine Server-Fehler');
});

section('Batterien nur auf Befehl, Salve, Sichtbarkeit (§5.4, §20.1, §20.4)', () => {
  const { g, run, enter, cmd, events, notices, clearInbox } = arena(1);
  const sh = g.ship;
  enter(0, 'weapons');
  const t = pinnedEnemy(g, 'raider', sh.x, sh.y + 350, 0, { hp: 999 });
  const other = pinnedEnemy(g, 'raider', sh.x + 300, sh.y - 300, 0, { hp: 999 });
  // weapons.hold: nur Hinweis
  let nn = notices(0).length;
  cmd(0, 'weapons.hold', { mount: 'stbd', hold: true });
  ok(notices(0).slice(nn).some((x) => /nur auf Befehl/.test(x)) && !('hold' in g.snapshot().ship.mounts.find((m) => m.id === 'stbd')), 'weapons.hold -> „Batterien feuern nur auf Befehl.“, kein hold im Snapshot');
  // besetzt: geladene Batterie mit Gegner im Bogen feuert NICHT von selbst
  setCharge(g, 'stbd', 1);
  const hp0 = t.hp;
  run(2, () => { pin(g); setCharge(g, 'bow', 0); setCharge(g, 'port', 0); });
  ok(t.hp === hp0 && mountOf(g, 'stbd').charge >= 1 && !g.space.beams.length, 'besetzt: kein Automatikfeuer (Batterie geladen, Gegner im Bogen)');
  // Befehl: gewähltes Ziel nicht im Bogen -> nächster Gegner im Bogen
  cmd(0, 'weapons.target', { id: other.id });
  clearInbox();
  cmd(0, 'weapons.fire', { mount: 'stbd' });
  let midSalvo = null; const seen = new Set(); let beams = 0;
  // Sichtbarkeit: jeder Salvenstrahl muss in ≥ 2 Snapshots stehen (Snapshot alle net.snapEvery Ticks)
  const inSnaps = new Map();
  for (let k = 0; k < 45; k++) {
    pin(g); setCharge(g, 'bow', 0); setCharge(g, 'port', 0);
    g.step();
    for (const b of g.space.beams) if (b.kind === 'battery' && !seen.has(b)) { seen.add(b); beams++; }
    if (g.wantsSnapshot()) {
      const s = g.snapshot();
      const m = s.ship.mounts.find((q) => q.id === 'stbd');
      if (m.salvo > 0 && midSalvo === null) midSalvo = m.salvo;
      for (const b of g.space.beams) if (b.kind === 'battery') inSnaps.set(b, (inSnaps.get(b) || 0) + 1);
      const sb = s.space.beams.find((b) => b.kind === 'battery');
      if (sb && !(sb.ttlMax > 0 && sb.mount === 'stbd')) inSnaps.set('badfields', 1);
    }
  }
  ok(near(hp0 - t.hp, 4 * 1.5, 0.01) && other.hp === 999, `weapons.fire stbd: Salve auf den nächsten Gegner im Bogen (4 × 1,5 = ${hp0 - t.hp})`);
  ok(midSalvo !== null && midSalvo >= 1 && beams === 4, `Salve über Zeit (salvo ${midSalvo} ausstehend, 4 Strahlen battery)`);
  const counts = [...inSnaps.entries()].filter(([k]) => k !== 'badfields').map(([, v]) => v);
  ok(counts.length === 4 && counts.every((v) => v >= 2) && !inSnaps.has('badfields'), `§20.1: jeder Salvenstrahl in ≥ 2 Snapshots (${counts.join('/')}), mit ttlMax und mount`);
  ok(events('sfx').some((e) => e.name === 'battery_salvo'), 'sfx battery_salvo');
  // ohne Gegner im Bogen: ins Leere, senkrecht zur Flanke, Strahlen trotzdem da
  g.space.enemies = [];
  setCharge(g, 'port', 1);
  nn = notices(0).length;
  cmd(0, 'weapons.fire', { mount: 'port' });
  const voids = [];
  run(1, () => { setCharge(g, 'bow', 0); setCharge(g, 'stbd', 0); for (const b of g.space.beams) if (b.kind === 'battery' && !voids.includes(b)) voids.push(b); });
  const perp = voids.every((b) => { const a = Math.atan2(b.y2 - b.y1, b.x2 - b.x1); return Math.abs(Physics.normAngle(a - (sh.angle - Math.PI / 2))) < 0.15 && b.miss; });
  ok(notices(0).length === nn && voids.length === 4 && perp, `ohne Gegner: Salve ins Leere (${voids.length} Strahlen, senkrecht zur Backbord-Flanke)`);
  // all = beide Batterien (nicht die Lanze)
  setCharge(g, 'port', 1); setCharge(g, 'stbd', 1); setCharge(g, 'bow', 1);
  cmd(0, 'weapons.fire', { mount: 'all' });
  ok(mountOf(g, 'port').salvo > 0 && mountOf(g, 'stbd').salvo > 0 && mountOf(g, 'bow').charge === 1, 'all: beide Batterien, Lanze bleibt');
  run(1, () => { setCharge(g, 'bow', 1); });
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
section('Flugmodell (§6, M3b §2)', () => {
  // M3b: Einzelwerte des Flugmodells prüft tools/test-flight.js; hier die Kopplung an Spiel und Konfig
  const { g, run, enter, cmd } = arena(1);
  const sh = g.ship;
  enter(0, 'helm');
  cmd(0, 'helm.throttle', { set: 3 });
  run(6, () => noFire(g));
  sh.turnVel = 0;
  run(0.5, () => { cmd(0, 'helm.input', { turn: 1, thrust: 0 }); noFire(g); });
  ok(near(sh.turnVel, LERCHE.turnAccel * 0.5, 0.05), `turnVel steigt mit turnAccel (${sh.turnVel.toFixed(3)} nach 0,5 s)`);
  g.handleMessage(g.players[0].conn, { t: 'leave' });
  run(2, () => noFire(g));
  ok(sh.turnVel === 0 && sh.helm.stage === 3 && sh.speed > 20, `unbesetzte Steuer: Ruder 0 (turnVel ${sh.turnVel}), Stufe bleibt ${sh.helm.stage}, Tempo ${sh.speed.toFixed(0)}`);
  enter(0, 'helm');
  sh.angle = 0; sh.turnVel = 0;
  cmd(0, 'helm.throttle', { set: 5 });
  run(9, () => { cmd(0, 'helm.input', { turn: 0, thrust: 0 }); noFire(g); });
  ok(near(sh.speed, S.maxSpeed(g), 1.5) && S.maxSpeed(g) <= LERCHE.maxSpeed, `Höchsttempo VOLL = maxSpeed (${sh.speed.toFixed(1)} / ${S.maxSpeed(g).toFixed(1)}, Klasse ${LERCHE.maxSpeed})`);
  cmd(0, 'helm.dodge', { dir: 1 });
  ok(near(sh.dodgeCd, LERCHE.dodge.cooldown, 0.05) && LERCHE.dodge.cooldown === 7, 'Ausweichrolle: Abklingzeit 7 s (§20.2)');
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
section('Treffer -> Systemschaden über interior.hitSystems (§9.4, M3b §4)', () => {
  // M3b: hitSystems läuft bei JEDEM Treffer, die Chance kommt aus spaceM3b.shieldLeak[S]
  const { g } = arena(3);
  const calls = []; const orig = interior.hitSystems;
  interior.hitSystems = (game, sec, o) => { calls.push(o ? o.chance : null); return orig(game, sec, o); };
  try {
    g.ship.shields.current = [0, 0, 0, 0]; g.ship.shields.allocIntent = [0, 0, 0, 0];
    S.shipHit(g, 2, 1, {});
    g.ship.shields.current = [4, 4, 4, 4];
    S.shipHit(g, 2, 1, {});
    g.ship.shields.current = [1, 1, 1, 1];
    S.shipHit(g, 2, 1, {});
  } finally { interior.hitSystems = orig; }
  ok(calls.length === 3 && calls[0] === M3B.shieldLeak[0].chance && calls[1] === 0 && calls[2] === M3B.shieldLeak[1].chance, `shipHit ruft hitSystems je Treffer mit Chance aus der Tabelle (${calls.join(' / ')})`);
});

// ======================================================================
section('bridgeLeaves (§8.3)', () => {
  const { g, P, send, run, place } = arena(1);
  // M4: Brückentür aus dem Layout (Tür im Raum bruecke mit begehbarem Nachbarn links außerhalb der Brücke)
  const br = Maps.SHIP_ROOMS.find((r) => r.id === 'bruecke');
  const dt0 = Maps.ship.find('D').find((t) => t.x === br.x0 && t.y >= br.y0 && t.y <= br.y1 && !Maps.ship.solid(t.x - 1, t.y));
  const door = { x: dt0.x, y: dt0.y, dir: 'left' };
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
section('Testgelände Wellen (§15, M3b §7)', () => {
  const A = CONFIG.arena;
  const key = (w) => w.slice().sort().join();
  ok(key(A.waves[0]) === 'gunboat,raider,raider', 'M3b: Welle 1 = Kanonenboot + 2 Jäger');
  ok(A.waves.slice(1).some((w) => key(w) === 'gunboat,raider') && A.waves.slice(1).some((w) => key(w) === 'gunboat,pylon'), 'alte Wellen danach (u. a. Kanonenboot+Jäger, Pylon+Kanonenboot)');
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

// ======================================================================
section('Allstopp (§21.1, M3b §2)', () => {
  const { g, run, enter, cmd, notices, events, clearInbox } = arena(1);
  const sh = g.ship;
  ok(g.snapshot().ship.helm.autoStop === false, 'Snapshot ship.helm.autoStop = false zu Beginn');
  enter(0, 'helm');
  sh.angle = 0; sh.turnVel = 0;
  cmd(0, 'helm.throttle', { set: 5 });
  run(8, () => { cmd(0, 'helm.input', { turn: 0, thrust: 0 }); noFire(g); });
  run(0.5, () => { cmd(0, 'helm.input', { turn: 1, thrust: 0 }); noFire(g); });   // Schiff dreht beim Allstopp
  const v0 = sh.speed, x0 = sh.x, y0 = sh.y;
  clearInbox();
  cmd(0, 'helm.stop');
  ok(sh.helm.autoStop === true && sh.helm.stage === Flight.stopStage(LERCHE) && events('sfx').some((e) => e.name === 'ui_click'), `helm.stop: Stufe STOPP, autoStop an, sfx ui_click (Start ${v0.toFixed(1)} px/s)`);
  // Ruder bleibt frei (M3b), Allstopp läuft weiter
  cmd(0, 'helm.input', { turn: -1, thrust: 0 });
  ok(sh.helm.autoStop === true, 'Ruder-Eingabe beendet den Allstopp nicht (M3b: Ruder bleibt frei)');
  let tStop = null;
  for (let k = 0; k < 30 * 6 && tStop === null; k++) { cmd(0, 'helm.input', { turn: 0, thrust: 0 }); noFire(g); g.step(); if (sh.speed === 0) tStop = (k + 1) / 30; }
  const dStop = Math.hypot(sh.x - x0, sh.y - y0);
  const expT = v0 / (LERCHE.decel * LERCHE.brakeFactor);
  ok(tStop !== null && near(tStop, expT, 0.2), `bremst auf 0 in ${tStop && tStop.toFixed(2)} s (erwartet ${expT.toFixed(2)} s = Tempo / (decel × brakeFactor)), Bremsweg ${dStop.toFixed(0)} px`);
  run(1, () => { cmd(0, 'helm.input', { turn: 0, thrust: 0 }); noFire(g); });
  ok(sh.helm.autoStop === false && sh.speed === 0 && sh.helm.stage === Flight.stopStage(LERCHE), 'steht: Allstopp endet von selbst, Stufe STOPP, Schiff bleibt stehen');
  cmd(0, 'helm.stop'); cmd(0, 'helm.throttle', { delta: 1 });
  ok(sh.helm.autoStop === false, 'Temporegler beendet einen laufenden Allstopp');
  cmd(0, 'helm.throttle', { set: 1 });
  // Seitlich: Ausweichen, dann Allstopp – Quertempo wird mitgebremst
  sh.vx = 0; sh.vy = 0; sh.angle = 0; sh.turnVel = 0; sh.dodgeCd = 0;
  cmd(0, 'helm.dodge', { dir: 1 });
  const lat0 = Math.abs(sh.vy);
  cmd(0, 'helm.stop');
  run(0.5, () => { cmd(0, 'helm.input', { turn: 0, thrust: 0 }); noFire(g); });
  const latFree = lat0 * Math.pow(Math.max(0, 1 - LERCHE.lateralDrag / 30), 15);
  ok(lat0 > 100 && Math.abs(sh.vy) < latFree, `seitlich: Quertempo ${lat0.toFixed(0)} -> ${Math.abs(sh.vy).toFixed(1)} px/s (ohne Allstopp ${latFree.toFixed(1)})`);
  run(5, () => { cmd(0, 'helm.input', { turn: 0, thrust: 0 }); noFire(g); });
  ok(sh.speed === 0, 'seitlich: steht nach Ausweichen + Allstopp');
  sh.dodgeCd = 0;
  cmd(0, 'helm.stop'); cmd(0, 'helm.dodge', { dir: -1 });
  ok(sh.helm.autoStop === false && Math.hypot(sh.vx, sh.vy) > 100, 'Ausweichen ist erlaubt und beendet den Allstopp');
  // Unbesetzte Steuer: Allstopp bremst weiter
  cmd(0, 'helm.throttle', { set: 4 }); run(5, () => noFire(g));
  cmd(0, 'helm.stop');
  g.handleMessage(g.players[0].conn, { t: 'leave' });
  run(6, () => noFire(g));
  ok(sh.speed === 0, 'unbesetzte Steuer: Allstopp bremst weiter bis 0');
  // Sprung/Szenenwechsel beendet den Allstopp; angedockt: Hinweis
  enter(0, 'helm'); cmd(0, 'helm.throttle', { set: 4 }); run(2, () => noFire(g)); cmd(0, 'helm.stop');
  space.enterScene(g, 'hafen', { docked: true });
  ok(sh.helm.autoStop === false, 'Szenenwechsel: autoStop aus');
  enter(0, 'helm');
  cmd(0, 'helm.stop');
  ok(sh.helm.autoStop === false && notices(0).some((t) => /Angedockt/.test(t)), 'angedockt: kein Allstopp, Hinweis');
});

// ======================================================================
function campaign(players) {
  const g = new Game({ noStore: true, seed: 33, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const conns = [];
  for (let i = 0; i < players; i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'B' + i, name: 'B' + i, color: i }); conns.push(c);
  }
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  const send = (i, m) => g.handleMessage(conns[i], m);
  const cmd = (i, c, extra) => send(i, Object.assign({ t: 'cmd', c }, extra || {}));
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
  const notices = (i) => conns[i].inbox.filter((m) => m.kind === 'notice').map((m) => m.text);
  const book = () => g.mission.bookSnapshot();
  const entry = (id) => book().entries.find((e) => e.id === id);
  const skip = (k) => { for (let i = 0; i < k; i++) { send(0, { t: 'debug', cmd: 'skip' }); run(1.5); } };
  const atPlan = (i) => { g.players[i].console = 'plan'; };
  return { g, conns, send, cmd, run, notices, book, entry, skip, atPlan };
}

section('Missionsbuch: Einträge und Form (§21.2)', () => {
  const { g, run, entry, book, skip } = campaign(1);
  run(1);
  const b = book();
  ok(Number.isInteger(b.version) && 'focus' in b && Array.isArray(b.entries), 'book { version, focus, entries }');
  const m1 = entry('m1');
  const KEYS = ['id', 'title', 'from', 'kind', 'state', 'briefing', 'reward', 'objectives', 'log'];
  ok(m1 && KEYS.every((k) => k in m1) && m1.kind === 'mission' && m1.state === 'aktiv' && /Tesk/.test(m1.from) && m1.briefing && m1.reward, 'm1: alle Felder, mission/aktiv, Auftraggeber Tesk, Briefing, Belohnung');
  ok(m1.objectives.every((o) => typeof o.text === 'string' && typeof o.done === 'boolean'), 'objectives [{ text, done }]');
  skip(3);   // dock -> undock -> route -> combat
  const done = entry('m1').objectives.filter((o) => o.done).map((o) => o.text);
  ok(done.some((t) => /ablegen/.test(t)) && done.some((t) => /Faltsprung/.test(t)), `erledigte Ziele bleiben nach Schrittwechsel (${done.length} abgehakt, Schritt ${g.mission.state.stage})`);
  skip(7);   // ... bis Mission 2
  ok(entry('m1').state === 'erledigt' && entry('m1').objectives.some((o) => /Rostmeute abwehren/.test(o.text) && o.done), 'm1 erledigt, Ziel ohne Haken-Bedingung („Rostmeute abwehren“) gilt mit dem Schritt als erledigt');
  ok(g.mission.activeId === 'm2' && !entry('m2'), 'm2 vor dem Angebot: noch nicht im Buch');
  ok(entry('sela') && entry('sela').kind === 'nebenauftrag' && entry('sela').state === 'aktiv', 'Selas Notruf: Nebenauftrag aktiv');
});

section('Missionsbuch: Annehmen, Fokus, HUD (§21.2)', () => {
  const { g, conns, cmd, run, notices, entry, atPlan } = campaign(2);
  g.mission.forceStep('m2', 'briefing');
  run(0.5);
  g.mission.v.offer = true; g.mission.radio('Hafenmeisterin Tesk', 'Echo aus der Grauen Weite. Seht ihr nach?', true);
  ok(entry('m2') && entry('m2').state === 'angeboten', 'offenes Funkangebot: m2 angeboten');
  cmd(0, 'plan.accept', { id: 'm2' });
  ok(notices(0).some((t) => /passenden Konsole/.test(t)) && entry('m2').state === 'angeboten', 'plan.accept nur am Planungstisch');
  atPlan(0); atPlan(1);
  cmd(0, 'plan.accept', { id: 'm1' });
  ok(notices(0).some((t) => /nichts anzunehmen/.test(t)), 'plan.accept auf erledigte Mission: Hinweis');
  cmd(1, 'plan.accept', { id: 'm2' });
  ok(g.mission.state.stage === 'vaelen' && entry('m2').state === 'aktiv' && g.mission.state.radio.needsAccept === false, 'plan.accept nimmt an wie captain.accept (Schritt vaelen)');
  // Fokus
  g.mission.flags.selaCalled = true;
  cmd(0, 'plan.focus', { id: 'sela' });
  let s = g.snapshot();
  ok(g.mission.book.focus === 'sela' && s.mission.focusId === 'sela' && s.mission.focusTitle === 'Selas Notruf' && s.mission.focusObjectives.length === 1 && /Vaelen/.test(s.mission.focusObjectives[0].text), 'plan.focus sela: HUD zeigt focusTitle + focusObjectives des Nebenauftrags');
  ok(g.mission.activeId === 'm2' && s.mission.objectives.length > 0, 'laufende Mission bleibt im Hintergrund gültig (mission.objectives weiter da)');
  cmd(1, 'plan.focus', { id: null });
  s = g.snapshot();
  ok(g.mission.book.focus === null && s.mission.focusId === 'm2' && s.mission.focusTitle === 'Echo im Nebel' && JSON.stringify(s.mission.focusObjectives) === JSON.stringify(s.mission.objectives), 'ohne Fokus: laufende Mission im HUD');
  cmd(0, 'plan.focus', { id: 'gibtsnicht' }); cmd(0, 'plan.focus', { id: 'm1' });
  ok(notices(0).some((t) => /Unbekannter Eintrag/.test(t)) && notices(0).some((t) => /erledigt/.test(t)) && g.mission.book.focus === null, 'Fokus: unbekannt bzw. erledigt abgelehnt');
  cmd(0, 'plan.focus', { id: 'sela' });
  g.ship.docked = true; g.ship.dockedAt = 'vaelen'; g.ship.scene = 'vaelen';
  run(0.2);
  g.snapshot();
  ok(entry('sela').state === 'erledigt' && g.mission.book.focus === null, 'Fokus auf erledigten Eintrag fällt zurück auf die laufende Mission');
  ok(entry('sela').log.length >= 1 || g.explore.log.some((l) => l.mission === 'sela'), 'Selas Log-Eintrag ist dem Nebenauftrag zugeordnet');
  // S2: Teaser abgelöst (Spielleiter) – startTeaser ist ein No-op-Altname, kein Ausblick im Buch
  g.startTeaser();
  ok(!entry('teaser'), 'S2: kein Ausblick (Teaser) mehr im Buch');
  cmd(0, 'plan.accept', { id: 'teaser' });
  ok(notices(0).some((x) => /Unbekannter Eintrag/.test(x)), 'S2: Teaser annehmen -> „Unbekannter Eintrag“');
  void conns;
});

section('Missionsbuch: Log-Zuordnung, Hinweise, Versionierung, Größe (§21.2)', () => {
  const { g, run, entry, book } = campaign(3);
  g.mission.forceStep('m2', 'vaelen');
  run(0.5);
  g.explore.addLog('Testeintrag während Mission 2', 'vaelen');
  const last = g.explore.log[g.explore.log.length - 1];
  ok(last.mission === 'm2' && Number.isInteger(last.t) && entry('m2').log.some((l) => l.text === 'Testeintrag während Mission 2' && l.loc === 'vaelen' && 't' in l), 'addLog ohne missionId -> laufende Mission, log [{ t, loc, text }]');
  g.explore.addLog('Explizit Zaunkönig', 'wrack', 'zaunkoenig');
  g.explore.reveal('wrack', false);
  ok(entry('zaunkoenig') && entry('zaunkoenig').kind === 'nebenauftrag' && entry('zaunkoenig').log.some((l) => l.text === 'Explizit Zaunkönig'), 'addLog(text, loc, missionId) + Wrack-Nebenauftrag');
  ok(!entry('m2').log.some((l) => /Explizit/.test(l.text)), 'fremder Log-Eintrag nicht bei m2');
  const h = g.explore.findHidden('hafen_cache');
  g.explore.revealHidden(h, true);
  ok(entry('h:hafen_cache') && entry('h:hafen_cache').kind === 'hinweis' && entry('h:hafen_cache').state === 'aktiv', 'aufgedeckte Entdeckung: Hinweis aktiv');
  ok(g.explore.log.some((l) => l.mission === 'h:hafen_cache'), 'Entdeckungs-Log dem Hinweis zugeordnet');
  g.explore.hidden.hafen_cache.found = true;
  ok(!entry('h:hafen_cache'), 'eingesammelt: Hinweis verschwindet (steht im Logbuch)');
  // Versionierung: unverändert -> gleiche Version, Buch nur im eigenen Slot; Änderung -> neue Version im nächsten Snapshot
  for (let i = 0; i < 20; i++) g.snapshot();
  const v1 = book().version;
  let withBook = 0;
  for (let i = 0; i < 15; i++) { const s = g.snapshot(); if (s.mission.book) withBook++; }
  ok(book().version === v1 && withBook === 1, `ohne Änderung: Version bleibt ${v1}, Buch 1× je 15 Snapshots (Slot 7) – ${withBook}×`);
  g.mission.setFocus('zaunkoenig');
  let got = null;
  for (let i = 0; i < 4 && !got; i++) { const s = g.snapshot(); if (s.mission.book) got = s.mission.book; }
  ok(got && got.version === v1 + 1 && got.focus === 'zaunkoenig', `Änderung (Fokus): Version ${v1} -> ${got && got.version}, im nächsten freien Snapshot`);
  const s = g.snapshot();
  ok(s.mission.bookVersion === got.version, 'mission.bookVersion in jedem Snapshot');
  // Größe: volles Buch (m1+m2 erledigt, m3 aktiv, Nebenaufträge, Teaser, offene Hinweise) bleibt im Budget
  g.mission.forceStep('m3', 'warden');
  g.mission.flags.selaCalled = true; g.startTeaser();
  for (const id of ['splitter_cache1', 'b7_fragment', 'nebel_lore', 'relais_lore', 'vaelen_cache']) g.explore.revealHidden(g.explore.findHidden(id), true);
  for (let i = 0; i < 40; i++) g.explore.addLog('Füllertext für das Logbuch, damit die Größenmessung etwas zu tun hat – Eintrag ' + i, 'kesh');
  run(1);
  let maxSnap = 0, maxBook = 0, maxWithBook = 0;
  for (let i = 0; i < 30; i++) {
    const sn = g.snapshot(); const nb = Buffer.byteLength(JSON.stringify(sn)); maxSnap = Math.max(maxSnap, nb);
    if (sn.mission.book) { maxWithBook = Math.max(maxWithBook, nb); maxBook = Math.max(maxBook, Buffer.byteLength(JSON.stringify(sn.mission.book))); }
  }
  ok(maxBook > 0 && maxBook <= CONFIG.net.bookBudget + 200 && maxWithBook < 13 * 1024 && maxSnap < 13 * 1024,
    `Buch ${maxBook} B (Budget ${CONFIG.net.bookBudget}), Snapshot mit Buch ${maxWithBook} B, Snapshot max ${maxSnap} B < 13 KB`);
  ok(g.errors === 0, 'keine abgefangenen Fehler');
});

console.log(`\n${n - fails}/${n} M3-Tests bestanden.` + (missing.size ? ` Fehlende Vertragsfunktionen: ${[...missing].join(', ')}` : ''));
process.exit(fails ? 1 : 0);
