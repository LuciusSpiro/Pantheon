'use strict';
// Raum: Orte/Szenen, Flug, Docken, Faltsprung, Energie/Reaktor, Lebenserhaltung, Schilde, Waffen (Phasenkanonen),
// Gegner (mit Schildsektoren), Projektile, Asteroiden, Ziel-Scan, Weitscan, Marker. CONTRACT-M1 §4–§6, §9.2.
const Physics = require('../../shared/physics.js');
const Protocol = require('../../shared/protocol.js');
const Locations = require('../../shared/locations.js');
const Flight = require('../../shared/flight.js');
const interior = require('./interior.js');
const Pilot = require('./pilot.js');
const Escort = require('./escort.js');   // S2 §5 Schützlinge (ohne Schützlinge/Gegnerziel kein Einfluss auf den Ablauf)
const { makeRng, clamp, dist, turnToward } = require('../util.js');

const POWER_SYSTEMS = Protocol.POWER_SYSTEMS;
const JAMMERS = ['raider', 'gunboat'];   // Rostmeute: Störsender blockieren den Faltsprung
const isDown = (st) => st === 'broken' || st === 'offline';
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const EPS = 1e-6;   // Gleitkomma-Rest bei Gegner-HP/-Schilden

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ---------- M3a: Grunddaten (CONTRACT-M3 §4, §5) ----------
const M3_MOUNTS = ['bow', 'port', 'stbd'];
const BATTERIES = ['port', 'stbd'];
const MOUNT_SYSTEM = { bow: 'weapon_bow', port: 'battery_port', stbd: 'battery_stbd' };
const WEAPON_SYSTEMS = ['weapon_bow', 'battery_port', 'battery_stbd'];
// Altnamen eingehender Befehle (§5.1). seitenturm (früher Steuerbord-Turm) -> stbd.
const MOUNT_ALIAS = { phase_l: 'port', phase_r: 'stbd', both: 'all', seitenturm: 'stbd', lanze: 'bow' };
const EMITTERS = ['emitter_bow', 'emitter_stbd', 'emitter_aft', 'emitter_port'];   // Sektor 0..3
const M3_SYSTEMS = ['reactor', 'engines', 'shields', 'life', 'transfer', 'thruster_port', 'thruster_stbd',
  'emitter_bow', 'emitter_stbd', 'emitter_aft', 'emitter_port', 'weapon_bow', 'battery_port', 'battery_stbd'];
const SECTOR_LABEL = ['Bug', 'Steuerbord', 'Heck', 'Backbord'];
const ENEMY_LABEL = { raider: 'Jäger', gunboat: 'Kanonenboot', sentinel: 'Wächter', pylon: 'Pylon', relay: 'Störrelais' };
const STATE_RANK = { ok: 0, damaged: 1, offline: 2, broken: 3 };

function M3(game) { return game.C.spaceM3; }
function M3B(game) { return game.C.spaceM3b || {}; }
// QA M3b: Schusswinkel mit Vorhalt auf die Lerche (Abfangpunkt bei Geschossgeschwindigkeit v), Anteil f (0..1) des Vorhalts
function leadAngle(x, y, ship, v, f) {
  const rx = ship.x - x, ry = ship.y - y; const k = Math.max(0, Math.min(1, Number(f) || 0));
  const vx = (ship.vx || 0) * k, vy = (ship.vy || 0) * k;
  const a = vx * vx + vy * vy - v * v, b = 2 * (rx * vx + ry * vy), c = rx * rx + ry * ry;
  let t = 0;
  if (Math.abs(a) < 1e-6) t = b < 0 ? -c / b : 0;
  else { const disc = b * b - 4 * a * c; if (disc >= 0) { const s = Math.sqrt(disc); const t1 = (-b - s) / (2 * a), t2 = (-b + s) / (2 * a); t = Math.max(t1, t2) > 0 ? (t1 > 0 && t2 > 0 ? Math.min(t1, t2) : Math.max(t1, t2)) : 0; } }
  t = Math.max(0, Math.min(3, t));
  return Math.atan2(ry + vy * t, rx + vx * t);
}
function sysState(game, sys) { const s = game.ship.systems[sys]; return s == null ? 'ok' : s; }
function stateKey(st) { return st === 'offline' ? 'broken' : (st || 'ok'); }   // offline (EMP) wirkt wie zerstört
function emitterFor(sector) {
  if (typeof interior.emitterFor === 'function') { const e = interior.emitterFor(sector); if (e) return e; }
  return EMITTERS[sector];
}
function normMount(mount) { const m = String(mount); return MOUNT_ALIAS[m] || m; }
function mountCfg(game, mount) {
  const m = normMount(mount);
  if (M3_MOUNTS.includes(m)) return M3(game).mounts[m];
  return game.C.weapons[m] || null;
}

// Zustand lazy ergänzen: game.js (SERVER-SHIP) legt evtl. noch den alten Zustand an.
function ensureM3(game) {
  const ship = game.ship; const S = M3(game);
  if (ship._m3) return;
  ship._m3 = true;
  for (const sys of M3_SYSTEMS) if (ship.systems[sys] == null) ship.systems[sys] = 'ok';
  if (!ship.fragile) ship.fragile = {};
  const m = ship.mount || (ship.mount = {});
  for (const k of M3_MOUNTS) if (!m[k]) m[k] = { charge: 1, alloc: S.allocDefault[k] || 0 };
  // §20.3: Lanze ohne Zielphase – power (0..1) und charging (Aufladen läuft)
  delete m.bow.aim;
  m.bow.power = 0; m.bow.charging = false;
  for (const k of BATTERIES) { const b = m[k]; delete b.hold; b.salvo = b.salvo || 0; b.salvoT = 0; b.salvoTarget = null; }
  if (!m.bolzen) m.bolzen = { loaded: game.C.weapons.bolzen.magazine, reloadT: null, shotT: 0 };
  if (!ship.wAllocIntent) ship.wAllocIntent = Object.assign({}, S.allocDefault);
  if (ship.turnVel == null) ship.turnVel = 0;
  const sh = ship.shields;
  if (sh.burst === undefined) sh.burst = null;
  if (sh.burstCd == null) sh.burstCd = 0;
  if (!sh.cap) sh.cap = [4, 4, 4, 4];
  const st = game.stats;
  for (const k of ['bursts', 'burstsPerfect', 'dodges', 'dodgeEvades']) if (st[k] == null) st[k] = 0;
  if (ship.lastDodgeT == null) ship.lastDodgeT = -99;
}

// ---------- Szenen ----------
// opts.docked: Start angedockt (nur Orte mit Liegeplatz). Sonst Ankunft am arrive-Punkt.
function enterScene(game, locId, opts) {
  const C = game.C;
  const loc = Locations.get(locId) || Locations.get('hafen');
  const sc = loc.scene;
  const ship = game.ship;
  const fromScene = ship.scene;
  const docked = !!(opts && opts.docked && sc.dock);
  const st = docked ? Object.assign({ angle: 0 }, sc.start || sc.dock) : sc.arrive;
  ship.scene = loc.id;
  ship.x = st.x; ship.y = st.y; ship.angle = st.angle || 0;
  ship.vx = 0; ship.vy = 0; ship.speed = 0;
  ship.docked = docked; ship.dockedAt = docked ? loc.id : null; ship.dockArmed = !docked;
  ship.helm.turn = 0; ship.helm.thrust = 0; ship.helm.autoStop = false;   // §21.1: Sprung/Szenenwechsel beendet den Allstopp
  ship.helm.stage = stopIndex(game);   // M3b: Ankunft/Andocken steht auf Stopp
  ship.dodgeT = 0;
  ensureM3(game);
  ship.turnVel = 0;
  ship.mount.bow.power = 0; ship.mount.bow.charging = false;
  ship.lastDodgeT = -99;
  for (const k of BATTERIES) { ship.mount[k].salvo = 0; ship.mount[k].salvoTarget = null; }
  ship.jump.dest = null; ship.jump.charge = 0; ship.jump.ready = false;
  ship.target = null;
  ship.markers = { captain: null, tactical: null };
  ship.tscan = { targetId: null, progress: 0, on: false, at: 0 };
  ship.scanning = false;
  const sp = game.space;
  sp.w = sc.w; sp.h = sc.h;
  sp.enemies = []; sp.projectiles = []; sp.beams = [];
  sp.asteroids = makeAsteroids(game, loc);
  sp.salvage = [];
  sp.markers = [];
  if (sc.station) sp.markers.push({ kind: sc.station.kind, x: sc.station.x, y: sc.station.y, r: sc.station.r });
  if (sc.dock) sp.markers.push({ kind: 'dock', x: sc.dock.x, y: sc.dock.y, r: C.travel.dockDist });
  ship.asteroidImmune = {};
  game.asteroidsDirty = true;
  if (game.explore) game.explore.location = loc.id;
  if (sc.beam && game.setAwayMap && !game.players.some((p) => p.zone === 'away')) game.setAwayMap(sc.beam.map);
  // S2 §5: Rückzugsregel gilt nur im Ort; Schützlinge springen mit oder bleiben zurück
  if (sp.retreatRule) delete sp.retreatRule;
  if (sp.escorts && sp.escorts.length) { try { Escort.onSceneChange(game, fromScene); } catch (err) { if (game.countError) game.countError('escort-scene', err); } }
}

function makeAsteroids(game, loc) {
  const sc = loc.scene;
  const n = sc.asteroids || 0;
  if (!n) return [];
  const rng = makeRng((game.seed ^ 0xA57E ^ hashStr(loc.id)) >>> 0);
  const f = sc.field || { x0: 200, x1: sc.w - 120, y0: 80, y1: sc.h - 80 };
  const keep = [sc.arrive, sc.station, sc.dock].filter(Boolean);
  const hiddenPts = loc.hidden || [];
  const list = [];
  let guard = 0;
  while (list.length < n && guard++ < 6000) {
    const r = Math.round(rng.range(16, 44));
    const x = Math.round(rng.range(f.x0, f.x1));
    const y = Math.round(rng.range(f.y0, f.y1));
    if (keep.some((k) => dist(x, y, k.x, k.y) < (k.r || 0) + 280)) continue;
    if (hiddenPts.some((h) => dist(x, y, h.x, h.y) < r + 110)) continue;
    if (list.some((a) => dist(a.x, a.y, x, y) < a.r + r + 70)) continue;
    list.push({ id: 'a' + list.length, x, y, r, seed: rng.int(100000) });
  }
  return list;
}

// Bergungsgut im Splittergürtel (Mission 1): abseits der direkten Linie, frei von Brocken.
function spawnSalvage(game, count) {
  const C = game.C; const sp = game.space;
  const loc = Locations.get(game.ship.scene); const sc = loc.scene;
  const rng = makeRng((game.seed ^ 0x5A17) >>> 0);
  const xs = [800, 1550, 2300];
  sp.salvage = [];
  for (let i = 0; i < count; i++) {
    let best = null;
    for (let k = 0; k < 300 && !best; k++) {
      const x = Math.round(xs[i % xs.length] + rng.range(-150, 150));
      const y = Math.round(sc.arrive.y + (rng.chance(0.5) ? -1 : 1) * rng.range(180, 380));
      if (sp.asteroids.some((a) => dist(a.x, a.y, x, y) < a.r + 90)) continue;
      best = { id: 'sv' + i, x, y, kind: C.salvage.rewards[i % C.salvage.rewards.length] };
    }
    if (best) sp.salvage.push(best);
  }
}
function updateSalvage(game) {
  const sp = game.space; const ship = game.ship; const C = game.C;
  if (!sp.salvage || !sp.salvage.length) return;
  for (const s of sp.salvage.slice()) {
    if (dist(ship.x, ship.y, s.x, s.y) > C.salvage.pickupDist) continue;
    sp.salvage.splice(sp.salvage.indexOf(s), 1);
    game.salvaged = (game.salvaged || 0) + 1;
    let what;
    if (s.kind === 'marks') { game.inventory.marks += C.salvage.marks; what = C.salvage.marks + ' Marken Altmetall'; }
    else { game.inventory[s.kind] = (game.inventory[s.kind] || 0) + 1; what = s.kind === 'ersatzteil' ? 'ein Ersatzteil' : 'ein Flickblech'; }
    game.emit('sfx', { name: 'pickup' });
    game.missionEvent('salvage', { what, n: game.salvaged });
  }
}

// ---------- Energie / Reaktor (§6) ----------
function baseReactorOutput(game) {
  const P = game.C.power; const s = game.ship.systems.reactor;
  // M3a §4.2: zerstört = Notstrom spaceM3.reactorBrokenOutput (2)
  const broken = M3(game).reactorBrokenOutput != null ? M3(game).reactorBrokenOutput : P.reactorBroken;
  return isDown(s) ? broken : s === 'damaged' ? P.reactorDamaged : P.reactor;
}
function reactorOutput(game) {
  const R = game.C.reactorM1; const rc = game.ship.reactorCtl;
  const base = baseReactorOutput(game);
  if (rc.state === 'overload') return base + R.overloadBonus;
  if (rc.state === 'offline') return Math.min(base, R.offlineOutput);
  return base;
}
function powerUsed(game) { return POWER_SYSTEMS.reduce((a, k) => a + game.ship.power[k], 0); }
// Reihenfolge beim Kürzen bei Gleichstand: Lebenserhaltung zuletzt.
const CUT_ORDER = ['weapons', 'engines', 'shields', 'life'];
function enforcePower(game) {
  const out = reactorOutput(game);
  const ship = game.ship;
  if (!ship.powerIntent) ship.powerIntent = Object.assign({}, ship.power);
  const pw = ship.power;
  Object.assign(pw, ship.powerIntent);
  while (powerUsed(game) > out) {
    let top = null;
    for (const k of CUT_ORDER) if (top === null || pw[k] > pw[top]) top = k;
    if (pw[top] <= 0) break;
    pw[top]--;
  }
}
function shieldPool(game) {
  const C = game.C; const ship = game.ship;
  const gen = ship.systems.shields;
  if (isDown(gen)) return 0;   // M3a §4.2: Generator zerstört = keine Schilde
  let pool = ship.power.shields * C.shields.pointsPerPower + (game.upgrades.schildpool ? 2 : 0);
  if (gen === 'damaged') pool += M3(game).generatorDamagedPool || 0;   // beschädigt: Pool −2
  if (game.time < game.away.kuppelUntil) pool -= C.support.kuppel.shieldCost;
  return Math.max(0, pool);
}
// M3a §4.2: Emitter je Sektor begrenzen, was der Sektor hält (cap 4 -> 2 -> 0).
function shieldCaps(game) {
  const C = game.C; const f = M3(game).emitterCap;
  const out = [];
  for (let i = 0; i < 4; i++) {
    const st = stateKey(sysState(game, emitterFor(i)));
    const k = f[st] != null ? f[st] : 1;
    out.push(Math.floor(C.shields.maxPerSector * k));
  }
  return out;
}
function enforceShields(game) {
  const sh = game.ship.shields; const pool = shieldPool(game);
  sh.pool = pool;
  const cap = shieldCaps(game);
  sh.cap = cap;
  if (!sh.allocIntent) sh.allocIntent = sh.alloc.slice();
  sh.alloc = sh.allocIntent.map((v, i) => Math.min(v, cap[i]));
  while (sh.alloc.reduce((a, b) => a + b, 0) > pool) {
    let top = 0; for (let i = 0; i < 4; i++) if (sh.alloc[i] > sh.alloc[top]) top = i;
    sh.alloc[top]--;
  }
  for (let i = 0; i < 4; i++) if (sh.current[i] > cap[i]) sh.current[i] = cap[i];
}

function switchHolders(game) {
  const held = { A: false, B: false }; const byPlayer = { A: false, B: false };
  for (const p of game.players) if (p.hold && p.hold.kind === 'switch' && p.connected) { held[p.hold.sw] = true; byPlayer[p.hold.sw] = true; }
  for (const b of game.bots) if (b.task && b.task.kind === 'switch' && b.task.phase === 'work') held[b.task.sw] = true;
  return { held, byPlayer };
}

function updateReactor(game, dt) {
  const R = game.C.reactorM1; const rc = game.ship.reactorCtl;
  if (rc.state === 'overload') {
    rc.overloadLeft = Math.max(0, rc.overloadLeft - dt);
    if (!rc.warned && rc.overloadLeft <= R.warnAt) {
      rc.warned = true;
      game.emit('sfx', { name: 'overload_warn' });
      game.oda(`Reaktor-Überladung endet in ${R.warnAt} s – danach schaltet er ab. Neustart: beide Schalter im Maschinenraum.`, null);
    }
    if (rc.overloadLeft <= 0) {
      rc.state = 'offline'; rc.offlineT = 0; rc.restartProgress = 0; rc.aloneT = 0;
      game.emit('sfx', { name: 'reactor_down' });
      game.oda('Reaktor abgeschaltet – nur Notstrom. Neustart: Schalter A (oben) und B (unten) gleichzeitig halten (E).', null);
      game.missionEvent('reactorOffline', {});
    }
  }
  const { held, byPlayer } = switchHolders(game);
  rc.switches = held;
  if (rc.state !== 'offline') { rc.restartProgress = 0; rc.needBot = null; rc.aloneT = 0; return; }
  rc.offlineT += dt;
  // Allein am Schalter: nach botAssistAfter s schickt der Server einen freien Schrauber zum anderen Schalter
  const onlyOne = (byPlayer.A !== byPlayer.B);
  if (onlyOne) {
    rc.aloneT += dt;
    if (rc.aloneT >= R.botAssistAfter && !rc.needBot) {
      rc.needBot = byPlayer.A ? 'B' : 'A';
      game.oda(`Halt ihn fest – ich schicke einen Schrauber an Schalter ${rc.needBot}.`, null);
    }
  } else if (!byPlayer.A && !byPlayer.B) { rc.aloneT = 0; rc.needBot = null; }
  if (held.A && held.B) {
    rc.restartProgress += dt;
    if (rc.restartProgress >= R.restartTime) reactorOnline(game, 'Reaktor läuft wieder! Saubere Teamarbeit am Schalter.');
  } else rc.restartProgress = 0;
  if (rc.state === 'offline' && rc.offlineT >= R.autoRestartAfter) reactorOnline(game, 'Notstart über die Hilfsbatterie – ruckelig, aber der Reaktor läuft wieder.');
}
function reactorOnline(game, text) {
  const rc = game.ship.reactorCtl;
  rc.state = 'online'; rc.restartProgress = 0; rc.needBot = null; rc.aloneT = 0; rc.offlineT = 0; rc.overloadLeft = 0; rc.warned = false;
  for (const p of game.players) if (p.hold && p.hold.kind === 'switch') p.hold = null;
  game.emit('sfx', { name: 'reactor_up' });
  game.oda(text, null);
  game.missionEvent('reactorOnline', {});
}

function captainOverload(game) {
  const R = game.C.reactorM1; const ship = game.ship; const rc = ship.reactorCtl;
  if (rc.state === 'overload') return 'Der Reaktor ist bereits überladen.';
  if (rc.state === 'offline') return 'Reaktor ist abgeschaltet – erst neu starten (Maschinenraum, beide Schalter).';
  if (isDown(ship.systems.reactor)) return 'Reaktor zerstört oder offline – erst reparieren.';
  rc.state = 'overload'; rc.overloadLeft = R.overloadTime; rc.warned = false;
  game.emit('sfx', { name: 'overload_start' });
  game.oda(`Reaktor überladen: +${R.overloadBonus} Energie für ${Math.round(R.overloadTime / 60)} Minuten. Danach ist erst mal Pause.`, null);
  game.missionEvent('overload', {});
  return null;
}

// M3a §4.1: 'weapons' ist Altname = schlechtester Zustand von Lanze und Batterien. Bei SERVER-SHIP ist das ein
// Getter (interior.makeSystems); nur wenn es ein einfaches Feld ist (alter Zustand), schreiben wir es nach.
function syncWeaponsAlias(game) {
  const s = game.ship.systems;
  const d = Object.getOwnPropertyDescriptor(s, 'weapons');
  if (d && (d.get || d.set || !d.writable)) return;
  let worst = 'ok';
  for (const k of WEAPON_SYSTEMS) { const v = s[k] || 'ok'; if (STATE_RANK[v] > STATE_RANK[worst]) worst = v; }
  s.weapons = worst;
}
// Hitze (§4.2): Auswahl macht interior.heatDamage(game, powerSys) (SERVER-SHIP).
function heatDamage(game, k) { interior.heatDamage(game, k); }

function updateSystems(game, dt) {
  const C = game.C; const ship = game.ship;
  interior.updateOffline(game, dt);
  syncWeaponsAlias(game);
  updateReactor(game, dt);
  enforcePower(game);
  const rc = ship.reactorCtl;
  ship.reactor = { state: rc.state, output: reactorOutput(game), used: powerUsed(game), overloadLeft: Math.ceil(rc.overloadLeft),
    switches: { A: !!rc.switches.A, B: !!rc.switches.B }, restartProgress: Math.round(Math.min(1, rc.restartProgress / C.reactorM1.restartTime) * 100) / 100 };
  // Hitze
  for (const k of POWER_SYSTEMS) {
    if (ship.power[k] >= C.power.maxPerSystem) ship.heat[k] += C.power.heatAt4 * dt;
    else ship.heat[k] = Math.max(0, ship.heat[k] - C.power.heatCool * dt);
    if (ship.heat[k] >= C.power.heatLimit) {
      ship.heat[k] = 0;
      heatDamage(game, k);
      syncWeaponsAlias(game);
      game.oda(`${cap(interior.sysNameNom(k))} ist überhitzt! Stufe 4 nur kurz fahren, sonst wird's warm.`, 'heat_' + k);
    }
  }
  // Lebenserhaltung / O₂
  const lifeDown = ship.power.life === 0 || isDown(ship.systems.life);
  if (lifeDown) ship.o2 -= C.o2.drainLifeBroken * dt;
  else ship.o2 += C.o2.regen * dt;
  const drill = game.mission && game.mission.isDrill();
  if (!drill) ship.o2 -= C.breach.o2PerSec * ship.breachList.length * dt;
  ship.o2 = clamp(ship.o2, 0, C.o2.max);
  // Schilde
  enforceShields(game);
  const sh = ship.shields;
  // M3b §4: Schildstoß entfällt (burst/burstCd bleiben eine Version lang null/0)
  sh.burst = null; sh.burstCd = 0;
  if (isDown(ship.systems.shields) || game.transfer.isBeaming(game)) {
    sh.current = [0, 0, 0, 0]; sh.regenT = 0;
  } else {
    for (let i = 0; i < 4; i++) {
      const max = Math.min(sh.cap ? sh.cap[i] : 4, sh.alloc[i]);
      if (sh.current[i] > max) sh.current[i] = max;
    }
    const interval = ship.systems.shields === 'damaged' ? C.shieldsDamagedInterval : C.shields.regenInterval;
    sh.regenT += dt;
    if (sh.regenT >= interval) {
      sh.regenT = 0;
      for (let i = 0; i < 4; i++) if (sh.current[i] < sh.alloc[i]) sh.current[i]++;
    }
  }
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- Flug (M3b §2: gemeinsames Flugmodell shared/flight.js) ----------
function lercheClass(game) {
  const SC = game.C.shipClasses;
  return (SC && SC.lerche) || FALLBACK_LERCHE(game);
}
// Falls der Config-Block fehlt (alte Config): Klasse aus den bisherigen ship-Werten
function FALLBACK_LERCHE(game) {
  const S = game.C.ship;
  return { maxSpeed: S.maxSpeed, minSpeed: 0, accel: S.accel, decel: S.accel, brakeFactor: 1, stages: [-0.3, 0, 0.25, 0.5, 0.75, 1],
    stageNames: ['R', 'STOPP', '¼', '½', '¾', 'VOLL'], turnRate: S.turnRate, turnCurve: [[0, 1], [1, 1]], turnAccel: S.turnAccel || 0.8,
    lateralDrag: game.C.flight.lateralDrag, dodge: { impulse: S.dodgeImpulse, cooldown: S.dodgeCooldown, turnPenalty: 1, turnPenaltyTime: 0 }, radius: game.C.flight.radius };
}
// Faktor aus Triebwerkszustand und Energie (vorher in maxSpeed): 0 = kein Schub
function engineSpeedFactor(game) {
  const C = game.C; const ship = game.ship;
  const st = ship.systems.engines === 'offline' ? 'broken' : ship.systems.engines;
  const sf = C.stateFactor.engines[st];
  const pf = C.enginePowerFactor[ship.power.engines];
  return (pf != null ? pf : 1) * (sf != null ? sf : 1);
}
function maxSpeed(game) {
  return lercheClass(game).maxSpeed * engineSpeedFactor(game);
}
function stopIndex(game) { return Flight.stopStage(lercheClass(game)); }
function ensureHelmStage(game) {
  const h = game.ship.helm;
  const n = (lercheClass(game).stages || [0]).length;
  if (!Number.isInteger(h.stage) || h.stage < 0 || h.stage >= n) h.stage = stopIndex(game);
}

// M3a §4.2/§6: Düsen begrenzen das Drehen zur jeweiligen Seite (negatives helm.turn = Backbord).
function turnCaps(game) {
  const f = M3(game).turnCap;
  const c = (sys) => { const st = stateKey(sysState(game, sys)); return f[st] != null ? f[st] : 1; };
  return { port: c('thruster_port'), stbd: c('thruster_stbd') };
}

function updateFlight(game, dt) {
  const C = game.C; const ship = game.ship;
  const loc = Locations.get(ship.scene); const sc = loc.scene;
  const cls = lercheClass(game);
  ensureHelmStage(game);
  const h = ship.helm;
  ship.dodgeCd = Math.max(0, ship.dodgeCd - dt);
  h.manned = game.players.some((p) => p.console === 'helm' && p.connected);
  // M3b §0.8: unbesetzte Steuer – Stufe bleibt, Ruder 0, keine Sonderbremse (das Stationshalten aus M1 entfällt)
  if (!h.manned) { h.turn = 0; h.thrust = 0; }
  const caps = turnCaps(game);
  ship.turnCap = caps;
  if (ship.docked) {
    const dp = sc.dock || sc.start;
    ship.vx = 0; ship.vy = 0; ship.speed = 0; ship.turnVel = 0;
    // Ablegen: Temporegler über Stopp (W). Rückwärts oder Stopp: bleibt angedockt.
    if (h.stage > stopIndex(game)) {
      ship.docked = false; ship.dockedAt = null; ship.dockArmed = false; ship.undockT = game.time; ship.dockHold = false;
      game.emit('sfx', { name: 'dodge' });
      game.missionEvent('undocked', {});
    } else { h.stage = stopIndex(game); h.autoStop = false; ship.x = dp.x; ship.y = dp.y; return; }
  }
  const rudder = h.manned ? (Number(h.turn) || 0) : 0;
  const mods = { speedFactor: engineSpeedFactor(game), turnCapPort: caps.port, turnCapStbd: caps.stbd };
  const body = ship;   // ship hat x, y, angle, vx, vy, turnVel – stage/dodgeT liegen am Schiff
  body.stage = h.stage;
  Flight.stepBody(body, { stage: h.stage, rudder, brake: !!h.autoStop }, cls, mods, dt);
  delete body.stage;   // Stufe lebt in ship.helm.stage (Snapshot), nicht doppelt am Schiff
  // §2 Allstopp: Bremsen, bis das Schiff steht (unter 1 px/s), dann endet er von selbst
  if (h.autoStop && Math.hypot(ship.vx, ship.vy) < 1) { ship.vx = 0; ship.vy = 0; h.autoStop = false; }
  const m = 40, sp = game.space;
  if (ship.x < m) { ship.x = m; ship.vx = Math.max(0, ship.vx); }
  if (ship.x > sp.w - m) { ship.x = sp.w - m; ship.vx = Math.min(0, ship.vx); }
  if (ship.y < m) { ship.y = m; ship.vy = Math.max(0, ship.vy); }
  if (ship.y > sp.h - m) { ship.y = sp.h - m; ship.vy = Math.min(0, ship.vy); }
  ship.speed = Math.hypot(ship.vx, ship.vy);
  // Andocken (Hafen und Vaelen): Dock-Ring langsam anfliegen. Nach dem Ablegen erst einmal Abstand gewinnen.
  if (sc.dock && !ship.docked) {
    const d = dist(ship.x, ship.y, sc.dock.x, sc.dock.y);
    // QA M1: auch scharf, wenn man nach dem Ablegen ein paar Sekunden in der Nähe bleibt (versehentlich abgelegt)
    if (!ship.dockArmed && (d > C.travel.dockDist + 60 || game.time - (ship.undockT || 0) > 4)) ship.dockArmed = true;
    if (ship.dockArmed && d <= C.travel.dockDist && ship.speed <= C.travel.dockSpeed) {
      ship.docked = true; ship.dockedAt = loc.id; ship.x = sc.dock.x; ship.y = sc.dock.y; ship.vx = 0; ship.vy = 0; ship.speed = 0;
      ship.angle = loc.id === 'hafen' ? 0 : ship.angle;
      ship.helm.thrust = 0; ship.helm.turn = 0; ship.dockHold = true;
      ship.helm.stage = stopIndex(game); ship.helm.autoStop = false; ship.turnVel = 0;
      game.emit('sfx', { name: 'door' });
      game.missionEvent('docked', { loc: loc.id });
    }
  }
  // Asteroiden
  for (const a of sp.asteroids) {
    const d = dist(ship.x, ship.y, a.x, a.y);
    const min = a.r + C.flight.radius;
    if (d >= min || d === 0) continue;
    const nx = (ship.x - a.x) / d, ny = (ship.y - a.y) / d;
    ship.x = a.x + nx * min; ship.y = a.y + ny * min;
    const vn = ship.vx * nx + ship.vy * ny;
    if (vn < 0) { ship.vx -= 1.6 * vn * nx; ship.vy -= 1.6 * vn * ny; }
    if ((ship.asteroidImmune[a.id] || 0) <= game.time) {
      ship.asteroidImmune[a.id] = game.time + C.flight.asteroidImmunity;
      shipHit(game, Physics.sectorOf(ship.x, ship.y, ship.angle, a.x, a.y), C.asteroid.damage, {});
      game.missionEvent('asteroid', {});
    }
  }
}

function dodge(game, dir) {
  const C = game.C; const ship = game.ship;
  if (ship.docked) return 'Erst ablegen.';
  if (ship.dodgeCd > 0) return 'Ausweichrolle lädt noch.';
  if (isDown(ship.systems.engines)) return 'Antrieb ausgefallen.';
  const D = lercheClass(game).dodge || {};
  const imp = D.impulse != null ? D.impulse : C.ship.dodgeImpulse;
  const a = ship.angle + (dir >= 0 ? Math.PI / 2 : -Math.PI / 2);
  ship.vx += Math.cos(a) * imp; ship.vy += Math.sin(a) * imp;
  ship.dodgeCd = D.cooldown != null ? D.cooldown : C.ship.dodgeCooldown;
  ship.dodgeT = D.turnPenaltyTime || 0;   // M3b §2: danach 1 s lang Drehen × dodge.turnPenalty (stepBody)
  ship.lastDodgeT = game.time;   // §20.2: Ausweich-Fenster für endende Ladungen
  ship.helm.autoStop = false;    // §21.1: Ausweichen ist erlaubt und beendet den Allstopp
  game.stats.dodges = (game.stats.dodges || 0) + 1;
  game.emit('sfx', { name: 'dodge' });
  return null;
}

// ---------- Allstopp und Temporegler (§21.1, M3b §2) ----------
// Altname (M3a): Bremsleistung des Allstopps. Seit M3b bremst stepBody mit decel × brakeFactor der Klasse.
function fullStopBrake(game) {
  const cls = lercheClass(game);
  return (cls.decel || 0) * (cls.brakeFactor || 1);
}
// cmd helm.stop (X): Stufe auf Stopp + brake, bis das Schiff steht (vorwärts und seitlich). Das Ruder bleibt frei.
function helmStop(game) {
  const ship = game.ship;
  if (ship.docked) return 'Angedockt – das Schiff steht schon.';
  ensureHelmStage(game);
  ship.helm.stage = stopIndex(game);
  ship.helm.autoStop = true;
  ship.helm.thrust = 0;
  game.emit('sfx', { name: 'ui_click' });
  return null;
}
// Stufe setzen (intern): beendet einen laufenden Allstopp
function setStage(game, idx) {
  const h = game.ship.helm; const n = (lercheClass(game).stages || [0]).length;
  const v = clamp(Math.round(idx), 0, n - 1);
  if (v === h.stage) return false;
  h.stage = v; h.autoStop = false;
  return true;
}
// cmd helm.throttle { delta: ±1 } oder { set: index } – eine Stufe pro Tastendruck (M3b §2)
function helmThrottle(game, msg) {
  ensureHelmStage(game);
  const h = game.ship.helm; const n = (lercheClass(game).stages || [0]).length;
  msg = msg || {};
  let want;
  if (msg.set != null && msg.set !== '') {
    want = Number(msg.set);
    if (!Number.isFinite(want)) return 'Unbekannte Stufe.';
    want = Math.round(want);
    if (want < 0 || want >= n) return 'Unbekannte Stufe.';
  } else {
    const d = Number(msg.delta);
    if (!Number.isFinite(d) || d === 0) return null;
    want = h.stage + (d > 0 ? 1 : -1);
    if (want < 0 || want >= n) { if (h.autoStop) h.autoStop = false; return null; }   // Anschlag: still
  }
  if (setStage(game, want)) game.emit('sfx', { name: 'ui_click' });
  else if (h.autoStop) h.autoStop = false;   // dieselbe Stufe nochmal gewählt: Allstopp endet trotzdem
  return null;
}
// cmd helm.input: der Client schickt kontinuierlich. turn = Ruder. thrust ist Altname: ein Wechsel über +0,5 bzw.
// unter −0,5 wirkt EINMAL als Stufe +1 bzw. −1 (Dauerdruck schaltet nicht weiter).
function helmInput(game, turn, thrust) {
  ensureHelmStage(game);
  const h = game.ship.helm;
  const prev = Number(h.thrust) || 0;
  h.turn = turn; h.thrust = thrust;
  if (thrust > 0.5 && !(prev > 0.5)) setStage(game, h.stage + 1);
  else if (thrust < -0.5 && !(prev < -0.5)) setStage(game, h.stage - 1);
}
// Snapshot-Ergänzung ship.helm (M3b §2): Stufe, Stufen-Tempi (Nennwert px/s), Faktor aus Triebwerk/Energie,
// aktueller Drehfaktor. game.js mischt das in ship.helm.
function helmSnapshot(game) {
  ensureHelmStage(game);
  const cls = lercheClass(game); const ship = game.ship;
  const fwd = Flight.forwardSpeed(ship);
  return {
    stage: ship.helm.stage,
    stages: (cls.stages || [0]).map((s) => Math.round(s * cls.maxSpeed)),
    stageNames: cls.stageNames || null,
    stop: stopIndex(game),
    agile: Flight.agileStage(cls),
    speedFactor: r2(engineSpeedFactor(game)),
    fwd: r1(fwd),
    turnFactor: r2(Flight.turnFactor(cls, fwd)),
    autoStop: !!ship.helm.autoStop,
  };
}

// ---------- Reisen / Faltsprung (§9.2) ----------
function jammersPresent(game) { return game.space.enemies.some((e) => JAMMERS.includes(e.kind)); }

function updateJump(game, dt) {
  const C = game.C; const ship = game.ship; const j = ship.jump;
  const loc = Locations.get(ship.scene); const sc = loc.scene;
  let reason = null;
  if (!j.dest) reason = 'Kein Sprungziel gewählt (Captain, Sternkarte).';
  else if (ship.docked) reason = 'Erst ablegen.';
  else if (isDown(ship.systems.engines)) reason = 'Antrieb ausgefallen – reparieren.';
  else if (ship.power.engines <= 0) reason = 'Antrieb ohne Energie.';
  else if (game.players.some((p) => p.zone === 'away')) reason = 'Außenteam noch unten – erst alle zurückbeamen.';
  else if (game.transfer.isBeaming(game)) reason = 'Transfer läuft.';
  else if (jammersPresent(game)) reason = 'Störsender der Rostmeute – erst die Gegner abwehren.';
  else if (sc.dock && dist(ship.x, ship.y, (sc.station || sc.dock).x, (sc.station || sc.dock).y) < C.travel.jumpMinStationDist) reason = 'Zu nah an der Station (≥ 300).';
  else {
    const why = game.mission.jumpBlocked(j.dest);
    if (why) reason = why;
  }
  j.blockedReason = reason;
  if (!reason) {
    if (j.charge < 1 && j.charge + dt / C.ship.jumpCharge >= 1) game.missionEvent('jumpReady', {});
    j.charge = Math.min(1, j.charge + dt / C.ship.jumpCharge);
  } else j.charge = Math.max(0, j.charge - dt / C.ship.jumpCharge);
  j.ready = !reason && j.charge >= 1;
}

function doJump(game) {
  const j = game.ship.jump;
  if (!j.ready) return j.blockedReason || 'Sprungantrieb lädt noch.';
  const dest = j.dest;
  if (!Locations.get(dest)) return 'Kein gültiges Sprungziel.';
  const from = game.ship.scene;
  game.emit('sfx', { name: 'jump' });
  enterScene(game, dest, {});
  game.emit('jump', { scene: dest, location: dest, from });
  game.explore.arrive(dest);
  game.missionEvent('jumped', { scene: dest, loc: dest, from });
  return null;
}

function selectDest(game, dest) {
  const ex = game.explore;
  if (!Locations.get(dest)) return 'Unbekanntes Ziel.';
  if (dest === game.ship.scene) return 'Da sind wir doch schon.';
  if (!ex.isLinked(game.ship.scene, dest)) return 'Keine bekannte Route dorthin – erst über einen Nachbarort.';
  const why = game.mission.destBlocked(dest);
  if (why) return why;
  game.ship.jump.dest = dest;
  game.emit('sfx', { name: 'jump_charge' });
  game.missionEvent('destSelected', { dest });
  return null;
}

// ---------- Treffer ----------
// opts: { pierce (bool, Schild ganz umgehen – Nachzügler), emp, heavy (angekündigter Treffer) }
// M3b §4: dünne Hülle um damage.resolveHit (SERVER-DAMAGE). resolveHit rechnet Schild, Überlauf, Hülle, EMP,
// Systemschaden, Feuer/Lecks und Zähler; shipHit behält Signatur, Ereignisse ('hit', sfx) und Missionsereignisse.
// Fehlt damage.js (parallele Lieferung), gilt die bisherige Logik (hitLegacy).
let damageMod;   // undefined = noch nicht gesucht, null = nicht vorhanden
function damageApi(game) {
  if (damageMod === undefined) {
    try { damageMod = require('./damage.js'); }
    catch (err) {
      damageMod = null;
      if (err && err.code !== 'MODULE_NOT_FOUND' && game.countError) game.countError('damage-require', err);
    }
  }
  return damageMod && typeof damageMod.resolveHit === 'function' ? damageMod : null;
}
function shipHit(game, sector, dmg, opts) {
  const ship = game.ship; const sh = ship.shields;
  opts = opts || {};
  ensureM3(game);
  game.stats.hits++;
  const D = damageApi(game);
  if (!D) return hitLegacy(game, sector, dmg, opts);
  const heavy = !!opts.heavy;
  const before = sh.current[sector] || 0;
  // S2 §5: Breitseite als Schild – das 'hit'-Ereignis nennt den geschützten Schützling (shielded: '<escortId>')
  const hitEv = (d) => (opts.shielded ? Object.assign(d, { shielded: opts.shielded }) : d);
  let r;
  try { r = D.resolveHit(game, sector, dmg, opts); }
  catch (err) { if (game.countError) game.countError('resolveHit', err); return hitLegacy(game, sector, dmg, opts); }
  r = r || {};
  syncWeaponsAlias(game);
  if (r.evaded) {   // z. B. Ausweichfenster – kein Treffer
    game.emit('hit', hitEv({ sector, shield: true, dmg: 0, heavy, evaded: true }));
    return;
  }
  const hull = Number(r.hull) || 0;
  const absorbed = Number(r.absorbed) || 0;
  const empThrough = !!opts.emp && (r.empThrough != null ? !!r.empThrough : hull > 0);
  if (empThrough) {
    game.emit('hit', hitEv({ sector, shield: false, dmg: 0, emp: true, heavy, absorbed }));
    game.emit('sfx', { name: 'emp' });
  } else if (hull > 0) {
    game.emit('hit', hitEv({ sector, shield: false, dmg: r1(hull / 5), heavy, absorbed, hull: r1(hull) }));
    game.emit('sfx', { name: 'hull_hit' });
  } else {
    game.emit('hit', hitEv({ sector, shield: true, dmg, heavy, absorbed }));
    game.emit('sfx', { name: 'shield_hit' });
  }
  if (before > 0 && (sh.current[sector] || 0) <= 0) game.missionEvent('shieldDown', { sector });
  if (hull > 0) game.missionEvent('hullHit', { sector });
}
// Bisherige Treffer-Logik (M3a ohne Schildstoß) – nur Fallback, solange damage.js fehlt
function hitLegacy(game, sector, dmg, opts) {
  const C = game.C; const ship = game.ship; const sh = ship.shields;
  const heavy = !!opts.heavy;
  if (!opts.pierce && sh.current[sector] > 0) {
    sh.current[sector] = Math.max(0, sh.current[sector] - dmg);
    game.emit('hit', { sector, shield: true, dmg, heavy });
    game.emit('sfx', { name: 'shield_hit' });
    if (sh.current[sector] === 0) game.missionEvent('shieldDown', { sector });
    return;
  }
  if (opts.emp) {
    // EMP durch die Schilde: zufälliges System offline statt Hüllenschaden
    const order = (interior.SYSTEM_ORDER || M3_SYSTEMS).filter((s) => s !== 'weapons' && ship.systems[s] != null);
    const cand = order.filter((s) => !isDown(ship.systems[s]));
    game.emit('hit', { sector, shield: false, dmg: 0, emp: true, heavy });
    game.emit('sfx', { name: 'emp' });
    if (cand.length) interior.setOffline(game, game.rng.pick(cand), C.emp.offlineTime);
    return;
  }
  game.emit('hit', { sector, shield: false, dmg, heavy });
  game.emit('sfx', { name: 'hull_hit' });
  if (!game.god) ship.hull = Math.max(0, ship.hull - 5 * dmg);
  const region = sector;
  // M3a §4.3: Systemtreffer (fragil, Chance, Gewichte, Sperre, ODA) macht interior.hitSystems (SERVER-SHIP).
  interior.hitSystems(game, sector);
  syncWeaponsAlias(game);
  if (game.rng.chance(C.hitEffects.fireChance)) { const t = interior.randomRegionFloor(game, region, false); if (t) interior.addFire(game, t.x, t.y); }
  if (game.rng.chance(C.hitEffects.breachChance)) { const t = interior.randomRegionFloor(game, region, true); if (t) interior.addBreach(game, t.x, t.y); }
  game.missionEvent('hullHit', { sector });
}

function updateHull(game, dt) {
  const C = game.C; const ship = game.ship;
  if (game.space.enemies.some((e) => e.kind !== 'relay') || ship.breachList.length || ship.hull >= C.ship.hullRegenMax) return;
  ship.hull = Math.min(C.ship.hullRegenMax, ship.hull + C.ship.hullRegen * dt);
}

function checkEmergency(game) {
  const C = game.C; const ship = game.ship;
  if (ship.hull > 0) return;
  ship.hull = C.emergency.hull;
  ship.fireList = [];
  ship.breachList = [];   // M1: Notschaum dichtet auch alle Lecks ab (sonst Notfall-Schleife ohne Flickblech)
  for (const e of game.space.enemies) { e.retreatUntil = game.time + C.combat.retreatTime; if (e.tele) { e.tele = null; game.emit('teleMiss', { id: e.id }); } }
  game.space.projectiles = game.space.projectiles.filter((p) => p.kind !== 'enemy' && p.kind !== 'emp');
  game.inventory.marks = Math.max(0, game.inventory.marks - C.emergency.marksCost);
  game.stats.emergencies++;
  game.emit('emergency', {});
  game.emit('sfx', { name: 'emergency' });
  game.oda('Notfallprotokoll! Hülle stabilisiert, Feuer erstickt, Lecks verschäumt. Kostet 50 Marken – und Würde.', null);
}

// ---------- Waffen (M3a §5): Lanze (bow), Batterien (port/stbd), Bolzenwerfer ----------
// PHASES: Altname-Export (M1). Seit M3a gibt es keine Phasenkanonen mehr; Befehle mit phase_l/phase_r werden umgesetzt.
const PHASES = ['phase_l', 'phase_r'];
function mountIds(game) {
  const out = M3_MOUNTS.slice();
  if (game.upgrades.bolzenwerfer) out.push('bolzen');
  return out;
}
function mountState(game, k) { return sysState(game, MOUNT_SYSTEM[k]); }
function weaponsManned(game) { return game.players.some((p) => p.console === 'weapons' && p.connected); }

// §5.2 Ladepunkte
function chargePoints(game) {
  const pw = game.ship.power.weapons;
  return pw > 0 ? pw + 2 : 0;
}
// Effektive Verteilung: besetzt = Wunsch der Taktik, gekürzt bei der Halterung mit den meisten Punkten
// (Gleichstand: zuerst die Batterien); unbesetzt = gleichmäßig reihum ab bow (§5.5).
function computeAlloc(game) {
  const S = M3(game); const ship = game.ship;
  const cp = chargePoints(game);
  const out = { bow: 0, port: 0, stbd: 0 };
  if (!weaponsManned(game)) {
    let left = cp, guard = 0;
    while (left > 0 && guard++ < 50) {
      let placed = false;
      for (const k of M3_MOUNTS) { if (left > 0 && out[k] < S.allocMax) { out[k]++; left--; placed = true; } }
      if (!placed) break;
    }
    return out;
  }
  const want = ship.wAllocIntent || S.allocDefault;
  for (const k of M3_MOUNTS) out[k] = clamp(Math.round(want[k] || 0), 0, S.allocMax);
  const cutOrder = ['port', 'stbd', 'bow'];
  while (out.bow + out.port + out.stbd > cp) {
    let top = null;
    for (const k of cutOrder) if (top === null || out[k] > out[top]) top = k;
    if (out[top] <= 0) break;
    out[top]--;
  }
  return out;
}
function batteryTubes(game, k) {
  const cfg = M3(game).mounts[k];
  if (mountState(game, k) === 'damaged') return cfg.tubesDamaged;
  return game.upgrades.seitenturm ? cfg.tubesUpgrade : cfg.tubes;   // Upgrade „Zusatzrohre“ (ID seitenturm)
}
// Ladezeit einer Halterung für 0 -> 1 (null = lädt nicht)
function chargeTime(game, k) {
  const cfg = M3(game).mounts[k]; const m = game.ship.mount[k];
  const st = mountState(game, k);
  if (isDown(st) || !(m.alloc > 0)) return null;
  let t = cfg.secPerPoint / m.alloc;
  if (st === 'damaged' && cfg.damagedFactor) t *= cfg.damagedFactor;
  // §5.5 unbesetzte Taktik: autoFactor wirkt auf die Ladezeit (halbe Feuerrate, voller Schaden je Treffer).
  // Abweichung vom Wortlaut: Mit halbem Schaden je Treffer käme eine Salve (4 × 0,75) nie durch Schild 3 (Wächter) – Softlock solo.
  if (!weaponsManned(game)) t /= (M3(game).autoFactor || 1);
  return t;
}
// Bolzenwerfer (Upgrade): Energie-Faktor wie bisher, fällt bei zerstörtem Triebwerk aus (§5.6)
function bolzenFactor(game) {
  const C = game.C; const ship = game.ship;
  if (isDown(ship.systems.engines)) return null;
  const pf = C.weaponPowerFactor[ship.power.weapons];
  return pf == null ? null : pf;
}
// Altname (M1): wird noch von Bolzen-Nachladen benutzt
function chargeFactor(game) { return bolzenFactor(game); }

function inMountArc(game, mount, x, y) {
  const s = game.ship; const cfg = mountCfg(game, mount);
  if (!cfg) return false;
  return Physics.inArc(s.x, s.y, s.angle, cfg.facing, cfg.arc, cfg.range, x, y);
}
function mountOrigin(game, mount) {
  const s = game.ship; const a = s.angle; const m = normMount(mount);
  if (m === 'port' || m === 'stbd') {
    const side = m === 'port' ? -Math.PI / 2 : Math.PI / 2;
    return { x: s.x + Math.cos(a + side) * 16, y: s.y + Math.sin(a + side) * 16 };
  }
  if (m === 'bow') return { x: s.x + Math.cos(a) * 34, y: s.y + Math.sin(a) * 34 };
  return { x: s.x, y: s.y };
}
function nearestInArc(game, mount) {
  const ship = game.ship;
  let best = null, bd = Infinity;
  for (const e of game.space.enemies) {
    if (!inMountArc(game, mount, e.x, e.y)) continue;
    const d = dist(ship.x, ship.y, e.x, e.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
function selectedEnemy(game) { const id = game.ship.target; return id == null ? null : game.space.enemies.find((e) => e.id === id) || null; }

function updateWeapons(game, dt) {
  const ship = game.ship; const m = ship.mount;
  const alloc = computeAlloc(game);
  for (const k of M3_MOUNTS) m[k].alloc = alloc[k];
  // Laden (Bereitschaft). Die Lanze lädt nicht nach, solange sie aufgeladen wird (sie ist ja schon bereit).
  for (const k of M3_MOUNTS) {
    if (k === 'bow' && m.bow.charging) continue;
    if (BATTERIES.includes(k) && m[k].salvo > 0) continue;
    const t = chargeTime(game, k);
    if (t != null) m[k].charge = Math.min(1, m[k].charge + dt / t);
  }
  const bf = bolzenFactor(game);
  if (bf != null && m.bolzen) {
    m.bolzen.shotT = Math.max(0, m.bolzen.shotT - dt);
    if (m.bolzen.reloadT != null) {
      m.bolzen.reloadT += dt / bf;
      if (m.bolzen.reloadT >= game.C.weapons.bolzen.reloadTime) {
        m.bolzen.reloadT = null; m.bolzen.loaded = Math.min(game.C.weapons.bolzen.magazine, m.bolzen.loaded + 1);
        game.emit('sfx', { name: 'ui_click' });
      }
    }
  }
  if (ship.target && !resolveTarget(game, ship.target)) ship.target = null;
  const manned = weaponsManned(game);
  updateLanceCharge(game, dt, manned);
  updateSalvos(game, dt);
  // §20.4: Automatikfeuer nur bei unbesetzter Taktik (halbe Ladegeschwindigkeit über chargeTime/autoFactor).
  // Besetzt feuert nichts von selbst – die Taktik drückt weapons.fire bzw. lädt die Lanze mit weapons.charge.
  if (!ship.docked && !manned) {
    for (const k of BATTERIES) {
      const b = m[k];
      if (b.charge < 1 || b.salvo > 0 || isDown(mountState(game, k))) continue;
      const tgt = nearestInArc(game, k);
      if (tgt) startSalvo(game, k, tgt, 1);
    }
    if (m.bow.charge >= 1 && !m.bow.charging && !isDown(mountState(game, 'bow')) && lanceTrace(game).hit) {
      fireLance(game, M3(game).lance.autoPower, true);
    }
  }
  for (const bm of game.space.beams) bm.ttl -= dt;
  game.space.beams = game.space.beams.filter((bm) => bm.ttl > 0);
}

// ---------- §20.3 Lanze als Ladewaffe ----------
function lanceCfg(game) {
  return M3(game).lance || { chargeTime: 3, minDamage: 3, maxDamage: 12, width: 10, autoPower: 0.5, damagedTimeFactor: 1.5, damagedMaxFactor: 0.75 };
}
// Aufladezeit power 0 -> 1 (beschädigt × damagedTimeFactor)
function lanceChargeTime(game) {
  const L = lanceCfg(game);
  return L.chargeTime * (mountState(game, 'bow') === 'damaged' ? (L.damagedTimeFactor || 1) : 1);
}
// Schaden für power (beschädigt: Maximalschaden × damagedMaxFactor)
function lanceDamage(game, power) {
  const L = lanceCfg(game);
  const max = L.maxDamage * (mountState(game, 'bow') === 'damaged' ? (L.damagedMaxFactor || 1) : 1);
  const p = clamp(power || 0, 0, 1);
  return L.minDamage + Math.max(0, max - L.minDamage) * p;
}
// Strahl in Bugrichtung: erster Gegner, dessen Abstand zur Strahllinie < hitRadius[kind] + width ist (innerhalb range).
function lanceTrace(game) {
  const ship = game.ship; const C = game.C;
  const cfg = M3(game).mounts.bow; const L = lanceCfg(game);
  const o = mountOrigin(game, 'bow');
  const ang = ship.angle + (cfg.facing || 0) * Math.PI / 180;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  let hit = null, ht = Infinity;
  for (const e of game.space.enemies) {
    const rx = e.x - o.x, ry = e.y - o.y;
    const t = rx * dx + ry * dy;              // Abstand entlang des Strahls
    const rad = (C.combat.hitRadius[e.kind] || 18) + (L.width || 0);
    if (t < -rad || t > cfg.range + rad) continue;
    const perp = Math.abs(-rx * dy + ry * dx); // Abstand zur Strahllinie
    if (perp >= rad) continue;
    if (t < ht) { ht = t; hit = e; }
  }
  return { o, dx, dy, range: cfg.range, hit, t: hit ? Math.max(0, ht) : cfg.range };
}
function lanceFizzle(game, why) {
  const bow = game.ship.mount.bow;
  if (!bow.charging) return;
  bow.charging = false; bow.power = 0;
  game.emit('lance', { state: 'fizzle', power: 0, hit: null, why: why || null });
  game.missionEvent('lanceFizzle', { why: why || null });
}
function updateLanceCharge(game, dt, manned) {
  const ship = game.ship; const bow = ship.mount.bow;
  if (!bow.charging) { bow.power = 0; return; }
  // Konsole verlassen, System aus oder angedockt: Aufladen verpufft ohne Schuss
  if (!manned) return lanceFizzle(game, 'console');
  if (isDown(mountState(game, 'bow'))) return lanceFizzle(game, 'system');
  if (ship.docked) return lanceFizzle(game, 'docked');
  bow.power = Math.min(1, (bow.power || 0) + dt / lanceChargeTime(game));
}
// weapons.charge { mount: 'bow', on }
function weaponsCharge(game, mount, on) {
  ensureM3(game);
  const ship = game.ship; const bow = ship.mount.bow;
  const k = normMount(mount == null ? 'bow' : mount);
  if (k !== 'bow') return 'Aufladen gibt es nur für die Lanze.';
  if (!on) {
    if (!bow.charging) return null;   // Loslassen ohne Aufladen: nichts
    fireLance(game, bow.power, false);
    return null;
  }
  if (bow.charging) return null;
  if (ship.docked) return 'Angedockt wird nicht geschossen.';
  if (isDown(mountState(game, 'bow'))) return 'Lanze ausgefallen – reparieren.';
  if (bow.charge < 1) return 'Lanze lädt noch.';
  bow.charging = true; bow.power = 0;
  const dur = lanceChargeTime(game);
  game.emit('lance', { state: 'charge', power: 0, hit: null, dur: r2(dur) });
  game.emit('sfx', { name: 'lance_charge', key: 'lance', dur: r2(dur) });
  game.missionEvent('lanceCharge', {});
  return null;
}
// Schuss in Bugrichtung mit power (0..1). Treffer = erster Gegner nahe der Strahllinie; sonst ins Leere.
function fireLance(game, power, auto) {
  const ship = game.ship; const bow = ship.mount.bow; const cfg = M3(game).mounts.bow;
  const p = clamp(power || 0, 0, 1);
  const tr = lanceTrace(game);
  bow.charging = false; bow.power = 0; bow.charge = 0;
  const x2 = tr.o.x + tr.dx * tr.t, y2 = tr.o.y + tr.dy * tr.t;
  const beam = { x1: tr.o.x, y1: tr.o.y, x2, y2, ttl: game.C.combat.beamTtl * 2, ttlMax: game.C.combat.beamTtl * 2, kind: 'lance', mount: 'bow', power: r2(p) };
  if (!tr.hit) beam.miss = true;
  game.space.beams.push(beam);
  // S2 §5: kein Eigenbeschuss – die Lanze geht durch Schützlinge hindurch, nur ein Funk-Rüffel
  if (game.space.escorts && game.space.escorts.length) { try { Escort.lanceCrossed(game, tr); } catch (err) { if (game.countError) game.countError('escort-lance', err); } }
  game.stats.lanceShots = (game.stats.lanceShots || 0) + 1;
  // Achtung: emit() mischt data in { t, kind } – kein Feld 'kind' mitgeben
  game.emit('lance', { state: 'fire', power: r2(p), hit: tr.hit ? tr.hit.id : null, auto: !!auto });
  game.emit('sfx', { name: 'lance_fire', power: r2(p) });
  if (tr.hit) {
    game.stats.lanceHits = (game.stats.lanceHits || 0) + 1;
    damageEnemy(game, tr.hit, lanceDamage(game, p), tr.o.x, tr.o.y, { pierce: cfg.pierce });
  }
  game.missionEvent('lanceFire', { power: p, hit: tr.hit ? tr.hit.id : null, auto: !!auto });
}

// §5.4/§20.4 Batterie-Salven: N Treffer, gestaffelt im Abstand salvoGap. target darf null sein (Schuss ins Leere).
function startSalvo(game, k, target, factor) {
  const b = game.ship.mount[k];
  b.charge = 0;
  b.salvo = batteryTubes(game, k);
  b.salvoMax = b.salvo;
  b.salvoT = 0;
  b.salvoTarget = target ? target.id : null;
  b.salvoFactor = factor;
  game.emit('sfx', { name: 'battery_salvo', count: b.salvo });
}
// Endpunkt eines Schusses ins Leere: senkrecht zur Flanke, leicht gefächert je Rohr, damit die Kette lesbar ist
function voidShotEnd(game, k, o, idx) {
  const ship = game.ship; const cfg = M3(game).mounts[k];
  const spread = ((idx % 4) - 1.5) * 0.06;   // ±5° gefächert
  const a = ship.angle + cfg.facing * Math.PI / 180 + spread;
  const len = cfg.range * 0.8;
  return { x: o.x + Math.cos(a) * len, y: o.y + Math.sin(a) * len };
}
function batteryBeamTtl(game) {
  // §20.1: vorher combat.beamTtl × 0,6 = 0,15 s – siehe spaceM3.batteryBeamTtl
  const v = M3(game).batteryBeamTtl;
  return v > 0 ? v : game.C.combat.beamTtl * 0.6;
}
function updateSalvos(game, dt) {
  for (const k of BATTERIES) {
    const b = game.ship.mount[k];
    if (!(b.salvo > 0)) continue;
    b.salvoT -= dt;
    while (b.salvo > 0 && b.salvoT <= 0) {
      const cfg = M3(game).mounts[k];
      b.salvoT += cfg.salvoGap;
      const idx = (b.salvoMax || b.salvo) - b.salvo;
      b.salvo--;
      let e = b.salvoTarget != null ? game.space.enemies.find((q) => q.id === b.salvoTarget) : null;
      if (!e || !inMountArc(game, k, e.x, e.y)) { e = nearestInArc(game, k); b.salvoTarget = e ? e.id : null; }
      const o = mountOrigin(game, k);
      const ttl = batteryBeamTtl(game);
      if (!e) {   // §20.4: Schuss ins Leere – Strahl trotzdem zeichnen
        const p = voidShotEnd(game, k, o, idx);
        game.space.beams.push({ x1: o.x, y1: o.y, x2: p.x, y2: p.y, ttl, ttlMax: ttl, kind: 'battery', mount: k, miss: true });
        continue;
      }
      game.space.beams.push({ x1: o.x, y1: o.y, x2: e.x, y2: e.y, ttl, ttlMax: ttl, kind: 'battery', mount: k });
      damageEnemy(game, e, cfg.damage * (b.salvoFactor || 1), o.x, o.y);
    }
    if (b.salvo <= 0) { b.salvo = 0; b.salvoTarget = null; }
  }
}

function fireOne(game, k) {
  const ship = game.ship; const m = ship.mount[k];
  const names = { bow: 'Lanze', port: 'Batterie Backbord', stbd: 'Batterie Steuerbord' };
  if (isDown(mountState(game, k))) return `${names[k]} ausgefallen – reparieren.`;
  if (k === 'bow') {
    // §20.4: weapons.fire bow feuert mit der aktuellen power (aus dem Stand 0 = Mindestschaden)
    if (m.charging) { fireLance(game, m.power, false); return null; }
    if (m.charge < 1) return 'Lanze lädt noch.';
    fireLance(game, 0, false);
    return null;
  }
  if (m.salvo > 0) return `${names[k]}: Salve läuft.`;
  if (m.charge < 1) return `${names[k]} lädt noch.`;
  // Ziel nicht nötig: gewähltes Ziel im Bogen, sonst nächster Gegner im Bogen, sonst ins Leere
  const sel = selectedEnemy(game);
  const tgt = sel && inMountArc(game, k, sel.x, sel.y) ? sel : nearestInArc(game, k);
  startSalvo(game, k, tgt, 1);
  return null;
}

function fireBolzen(game) {
  const C = game.C; const ship = game.ship; const cfg = C.weapons.bolzen;
  if (!game.upgrades.bolzenwerfer) return 'Kein Bolzenwerfer eingebaut (Shop: Hafen oder Vaelen).';
  if (isDown(ship.systems.engines)) return 'Bolzenwerfer aus – Triebwerk zerstört.';
  const target = selectedEnemy(game);
  if (!target) return ship.target ? 'Das Ziel ist kein Gegner – nur scannen (S).' : 'Kein Ziel gewählt (T).';
  if (!inMountArc(game, 'bolzen', target.x, target.y)) return 'Ziel außerhalb des Feuerbogens.';
  const b = ship.mount.bolzen;
  if (b.loaded <= 0) return 'Magazin leer – R: nachladen.';
  if (b.shotT > 0) return 'Bolzenwerfer kühlt noch.';
  b.loaded--; b.shotT = C.combat.bolzenShotDelay;
  const a = Math.atan2(target.y - ship.y, target.x - ship.x);
  game.space.projectiles.push({ id: game.nextId('pr'), kind: 'bolzen', x: ship.x - Math.cos(ship.angle) * 30, y: ship.y - Math.sin(ship.angle) * 30,
    angle: a, speed: cfg.speed, ttl: C.combat.bolzenTtl, dmg: cfg.damage, target: target.id });
  game.emit('sfx', { name: 'bolzen' });
  return null;
}

// weapons.fire { mount: 'bow'|'port'|'stbd'|'all'|'bolzen' } (Altnamen phase_l/phase_r/both/seitenturm)
// §20.4: 'all' feuert beide Batterien (nicht die Lanze).
function weaponsFire(game, mount) {
  ensureM3(game);
  const ship = game.ship;
  if (ship.docked) return 'Angedockt wird nicht geschossen.';
  const k = normMount(mount);
  if (k === 'bolzen') return fireBolzen(game);
  if (M3_MOUNTS.includes(k)) return fireOne(game, k);
  if (k !== 'all') return 'Unbekannte Waffe.';
  const errs = [];
  let fired = 0;
  for (const q of BATTERIES) {
    const err = fireOne(game, q);
    if (err) errs.push(err); else fired++;
  }
  if (fired) return null;
  return errs[0] || 'Batterien laden noch.';
}

// weapons.alloc { mount, delta: ±1 }
function weaponsAlloc(game, mount, delta) {
  ensureM3(game);
  const S = M3(game); const ship = game.ship;
  const k = normMount(mount);
  if (!M3_MOUNTS.includes(k)) return 'Ladepunkte nur für Lanze, Batterie Bb oder Stb.';
  const d = delta > 0 ? 1 : delta < 0 ? -1 : 0;
  if (!d) return null;
  const cur = computeAlloc(game);
  if (!weaponsManned(game)) Object.assign(cur, ship.wAllocIntent);   // ohne Taktik: Wunsch weiterpflegen
  const nv = cur[k] + d;
  if (nv < 0 || nv > S.allocMax) return 'Grenze erreicht.';
  if (d > 0 && cur.bow + cur.port + cur.stbd + 1 > chargePoints(game)) return 'Keine Ladepunkte frei – erst woanders abziehen oder mehr Energie auf Waffen.';
  cur[k] = nv;
  ship.wAllocIntent = { bow: cur.bow, port: cur.port, stbd: cur.stbd };
  for (const q of M3_MOUNTS) ship.mount[q].alloc = computeAlloc(game)[q];
  game.emit('sfx', { name: 'ui_click' });
  return null;
}

// weapons.hold { mount: 'port'|'stbd', hold }
// §20.4: „Halten“/„Feuer frei“ entfallen – nur noch Hinweis
function weaponsHold(game, mount, hold) {   // eslint-disable-line no-unused-vars
  return 'Batterien feuern nur auf Befehl.';
}

// §5.6 Orbitalschlag: volle Ladung verbrauchen (bow, sonst port, sonst stbd)
function consumeFullCharge(game) {
  ensureM3(game);
  const m = game.ship.mount;
  for (const k of M3_MOUNTS) {
    if (m[k].charge < 1 || isDown(mountState(game, k))) continue;
    if (BATTERIES.includes(k) && m[k].salvo > 0) continue;
    if (k === 'bow' && m.bow.charging) lanceFizzle(game, 'strike');   // Orbitalschlag nimmt die Ladung
    m[k].charge = 0;
    return k;
  }
  return null;
}

// Snapshot-Block ship.mounts (§9.3)
function mountsSnapshot(game) {
  ensureM3(game);
  const C = game.C; const S = M3(game); const m = game.ship.mount;
  const out = [];
  for (const k of M3_MOUNTS) {
    const cfg = S.mounts[k];
    const o = { id: k, facing: cfg.facing, arc: cfg.arc, range: cfg.range, charge: r2(m[k].charge), alloc: m[k].alloc || 0, state: mountState(game, k) };
    if (k === 'bow') {   // §20.3: power 0..1, charging; dmg = Schaden bei aktueller power (Anzeige)
      o.power = r2(m.bow.power || 0); o.charging = !!m.bow.charging; o.dmg = r1(lanceDamage(game, m.bow.power || 0));
    } else { o.salvo = m[k].salvo || 0; o.salvoMax = batteryTubes(game, k); }
    out.push(o);
  }
  if (game.upgrades.bolzenwerfer) {
    const w = C.weapons.bolzen; const b = m.bolzen;
    const ch = b.reloadT != null ? b.reloadT / w.reloadTime : (b.loaded > 0 ? 1 - b.shotT / C.combat.bolzenShotDelay : 0);
    out.push({ id: 'bolzen', facing: w.facing, arc: w.arc, range: w.range, charge: r2(clamp(ch, 0, 1)), ammo: game.inventory.bolzen, loaded: b.loaded,
      state: isDown(game.ship.systems.engines) ? 'broken' : 'ok' });
  }
  return out;
}

function weaponsReload(game) {
  const C = game.C; const b = game.ship.mount.bolzen;
  if (!game.upgrades.bolzenwerfer) return 'Kein Bolzenwerfer eingebaut.';
  if (b.reloadT != null) return 'Lädt bereits nach.';
  if (b.loaded >= C.weapons.bolzen.magazine) return 'Magazin ist voll.';
  if (game.inventory.bolzen <= 0) return 'Keine Bolzen mehr im Vorrat.';
  if (chargeFactor(game) == null) return 'Bolzenwerfer ohne Energie oder Triebwerk zerstört.';
  game.inventory.bolzen--;
  b.reloadT = 0;
  game.emit('sfx', { name: 'ui_click' });
  return null;
}

// ---------- Schildstoß: entfällt seit M3b (Kai) ----------
const BURST_GONE = 'Den Schildstoß gibt es nicht mehr.';
function captainBurst(game, sector) { return BURST_GONE; }   // eslint-disable-line no-unused-vars
function debugBurst(game, sector) { return BURST_GONE; }     // eslint-disable-line no-unused-vars
function shieldsSnapshot(game) {
  ensureM3(game);
  const sh = game.ship.shields;
  return {
    pool: sh.pool, alloc: sh.alloc, current: sh.current, cap: sh.cap || shieldCaps(game),
    burst: null, burstCd: 0,   // M3b: eine Version lang als Altname
  };
}

// Ziel auflösen: Gegner, aufgedecktes verstecktes Objekt (dieser Ort) oder 'station'
function resolveTarget(game, id) {
  if (id == null) return null;
  const e = game.space.enemies.find((o) => o.id === id);
  if (e) return { type: 'enemy', id, x: e.x, y: e.y, obj: e };
  if (id === 'station') {
    const loc = Locations.get(game.ship.scene);
    if (loc.scene.station) return { type: 'station', id, x: loc.scene.station.x, y: loc.scene.station.y, loc: loc.id };
    return null;
  }
  const h = game.explore.hiddenHere().find((o) => o.id === id && game.explore.isRevealed(o.id));
  if (h) return { type: 'hidden', id, x: h.x, y: h.y, obj: h };
  return null;
}
function weaponsTarget(game, id) {
  if (id === null || id === undefined) { game.ship.target = null; return null; }
  if (!resolveTarget(game, id)) return 'Ziel nicht gefunden.';
  if (game.ship.target !== id) game.ship.tscan.progress = 0;
  game.ship.target = id;
  return null;
}

// ---------- Ziel-Scan / Weitscan / Marker ----------
function weaponsScan(game, on) {
  const ts = game.ship.tscan;
  ts.on = !!on; ts.at = game.time;
  if (!on) return null;
  const t = resolveTarget(game, game.ship.target);
  if (!t) return 'Erst ein Ziel wählen (T oder anklicken).';
  if (dist(game.ship.x, game.ship.y, t.x, t.y) > game.C.tscan.range) return 'Ziel zu weit für den Scan (max. 800).';
  return null;
}
function updateTargetScan(game, dt) {
  const C = game.C; const ship = game.ship; const ts = ship.tscan;
  const manned = game.players.some((p) => p.console === 'weapons' && p.connected);
  if (!manned || game.time - ts.at > C.tscan.holdTimeout) ts.on = false;
  const t = resolveTarget(game, ship.target);
  if (!t) { ts.targetId = null; ts.progress = 0; return; }
  if (ts.targetId !== t.id) { ts.targetId = t.id; ts.progress = 0; }
  if (!ts.on) { ts.progress = 0; return; }
  if (dist(ship.x, ship.y, t.x, t.y) > C.tscan.range) { ts.progress = 0; return; }
  if (alreadyScanned(game, t)) { ts.progress = 1; return; }
  const before = ts.progress;
  ts.progress = Math.min(1, ts.progress + dt / C.tscan.time);
  if (Math.floor(before * 4) !== Math.floor(ts.progress * 4) && ts.progress < 1) game.emit('sfx', { name: 'scan_tick' });
  if (ts.progress >= 1) {
    ts.on = false;
    game.emit('sfx', { name: 'scan_done' });
    onTargetScanned(game, t);
  }
}
function alreadyScanned(game, t) {
  if (t.type === 'enemy') return !!t.obj.scanned;
  if (t.type === 'station') return game.scans.has('station:' + t.loc);
  if (t.type === 'hidden') return game.scans.has(t.id);
  return false;
}
function onTargetScanned(game, t) {
  if (t.type === 'enemy') {
    t.obj.scanned = true;
    const n = { raider: 'Jäger: Bug stark, Heck ungeschützt, eine Kanone vorn.', gunboat: 'Kanonenboot: Breitseiten stark, Heck schwach – von vorn oder hinten angreifen.',
      sentinel: 'Kustoden-Wächter: rundum geschützt, EMP-Schüsse. Schilde oben halten!', pylon: 'Pylon: nur die Front ist geschützt – Pilot, an die Seite!', relay: 'Störrelais: keine Schilde, keine Waffen.' }[t.obj.kind];
    game.oda('Scan: ' + (n || 'Daten erfasst.'), 'scan_' + t.obj.kind);
    game.missionEvent('enemyScanned', { enemy: t.obj });
    return;
  }
  if (t.type === 'station') {
    game.scans.add('station:' + t.loc);
    game.explore.onStationScanned(t.loc);
    game.missionEvent('scanned', { id: 'station:' + t.loc });
    return;
  }
  if (t.type === 'hidden') {
    game.scans.add(t.id);
    game.explore.onHiddenScanned(t.obj);
    game.missionEvent('scanned', { id: t.id });
  }
}

function weaponsWidescan(game) {
  const C = game.C; const ship = game.ship; const ws = ship.widescan;
  if (ws.cd > 0) return `Weitscan lädt noch (${Math.ceil(ws.cd)} s).`;
  ws.cd = C.widescan.cooldown; ws.pulseAt = Math.round(game.time * 100) / 100;
  game.emit('sfx', { name: 'widescan' });
  game.emit('widescan', { x: Math.round(ship.x), y: Math.round(ship.y), r: C.widescan.radius });
  const n = game.explore.widescanAt(ship.x, ship.y, C.widescan.radius);
  if (!n) game.oda('Weitscan: nichts Neues in Reichweite. Woanders nochmal probieren.', null);
  game.missionEvent('widescan', { found: n });
  return null;
}

function setMarker(game, who, x, y, clear) {
  const m = game.ship.markers;
  if (clear) { m[who] = null; return null; }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 'Ungültige Markierung.';
  m[who] = { x: Math.round(clamp(x, 0, game.space.w)), y: Math.round(clamp(y, 0, game.space.h)) };
  game.emit('sfx', { name: 'marker_set' });
  return null;
}
function markerOnTarget(game) {
  const t = resolveTarget(game, game.ship.target);
  if (!t) return 'Kein Ziel für den Marker.';
  return setMarker(game, 'tactical', t.x, t.y, false);
}

// ---------- Gegner ----------
function spawnEnemy(game, kind, opts) {
  const C = game.C; const ship = game.ship; const sp = game.space;
  const o = opts || {};
  const cfg = C.enemies[kind];
  // M3a §6: zusätzlich spaceM3.enemyHpFactor (nicht beim Störrelais)
  const hp = Math.max(1, Math.round(cfg.hp * (kind === 'relay' ? 1 : crewScale(game).enemyHp * (M3(game).enemyHpFactor || 1))));
  const a = o.angle != null ? o.angle : game.rng.range(-Math.PI, Math.PI);
  let x = o.x != null ? o.x : ship.x + Math.cos(a) * C.combat.spawnDist;
  let y = o.y != null ? o.y : ship.y + Math.sin(a) * C.combat.spawnDist;
  x = clamp(x, 60, sp.w - 60); y = clamp(y, 60, sp.h - 60);
  const shields = (C.enemyShields[kind] || [0, 0, 0, 0]).slice();
  const e = { id: game.nextId('e'), kind, x, y, angle: o.facing != null ? o.facing : Math.atan2(ship.y - y, ship.x - x), hp, hpMax: hp,
    shields, shieldsMax: shields.slice(), regenT: 0, scanned: false,
    fireT: cfg.fireInterval * 0.5, orbitDir: game.rng.chance(0.5) ? 1 : -1, retreatUntil: 0, tag: o.tag || null, hitT: 0,
    phase: 'broadside', phaseT: 0, side: 1, orbitA: o.orbitA, home: { x, y }, vx: 0, vy: 0 };
  // S2 §5: Spawn-Parameter ziel (lerche | schuetzling | auto | Tag eines Schützlings) -> e.targetId (null = Lerche)
  if (o.ziel != null && o.ziel !== 'lerche') {
    try { e.targetId = Escort.pickTarget(game, o.ziel); } catch (err) { e.targetId = null; if (game.countError) game.countError('escort-ziel', err); }
    if (e.targetId != null && o.facing == null) { const T = Pilot.targetOf(game, e); e.angle = Math.atan2(T.y - y, T.x - x); }
  }
  // M3b §3/§7: im neuen Flugmodell mit Anfangstempo (Kanonenboot ½, Jäger Voll), nicht aus dem Stand
  if (Pilot.flies(game, e)) Pilot.initSpawn(game, e);
  sp.enemies.push(e);
  game.missionEvent('enemySpawn', { enemy: e });
  return e;
}

function crewScale(game) {
  const n = Math.max(1, Math.min(3, game.players.filter((p) => p.connected).length));
  return game.C.crewScaling[n] || { enemyFireInterval: 1, enemyHp: 1 };
}

// Schaden aus Richtung (srcX, srcY): erst Schildsektor des Gegners, dann Hülle.
// opts.pierce: der Schildsektor zählt bei diesem Treffer so viele Punkte weniger (Lanze, §5.1).
function damageEnemy(game, e, dmg, srcX, srcY, opts) {
  e.hitT = game.time;
  if (e.targetId != null) Escort.onLercheHit(game, e);   // S2 §5: Treffer der Lerche ziehen den Gegner 10 s auf sie
  // M3a §7.1: Treffer verlängern eine laufende Ladung (je Treffer delayPerHit, insgesamt höchstens delayMax)
  if (e.tele) {
    const T = M3(game).tele;
    const add = Math.min(T.delayPerHit, Math.max(0, T.delayMax - (e.tele.delayed || 0)));
    if (add > 0) { e.tele.left += add; e.tele.dur += add; e.tele.delayed = (e.tele.delayed || 0) + add; }
  }
  let rest = dmg;
  if (srcX != null && e.shields) {
    const sec = Physics.sectorOf(e.x, e.y, e.angle, srcX, srcY);
    const pierce = (opts && opts.pierce) || 0;
    const absorb = Math.min(Math.max(0, e.shields[sec] - pierce), rest);
    // QA M3a: nicht mehr auf 0,1 runden (Teiltreffer wie 0,75 bei unbesetzter Taktik verloren sonst Schaden);
    // gerundet wird nur im Snapshot. EPS fängt Gleitkomma-Reste ab.
    if (absorb > 0) { e.shields[sec] = Math.max(0, e.shields[sec] - absorb); if (e.shields[sec] < EPS) e.shields[sec] = 0; rest -= absorb; e.shieldHitT = game.time; e.shieldHitSector = sec; }
    if (rest <= EPS) { game.emit('sfx', { name: 'shield_hit', volume: 0.5 }); game.missionEvent('enemyShieldHit', { enemy: e, sector: sec }); return; }
  }
  e.hp -= rest;
  if (e.hp < EPS) e.hp = 0;
  game.missionEvent('enemyDamaged', { enemy: e });
  if (e.hp > 0) return;
  const C = game.C;
  game.space.enemies = game.space.enemies.filter((o) => o !== e);
  game.inventory.marks += C.enemies[e.kind].salvage;
  game.stats.kills++;
  game.emit('explosion', { x: Math.round(e.x), y: Math.round(e.y), zone: 'space' });
  game.emit('sfx', { name: e.kind === 'pylon' ? 'pylon_down' : (e.kind === 'gunboat' || e.kind === 'sentinel') ? 'explosion_big' : 'explosion_small' });
  if (game.ship.target === e.id) game.ship.target = null;
  game.missionEvent('enemyKilled', { enemy: e });
}

function stationPoint(game) {
  const loc = Locations.get(game.ship.scene);
  return loc.scene.station || { x: game.space.w / 2, y: game.space.h / 2 };
}

function enemyCanHit(game, e, target) {
  const W = game.C.enemyWeapons[e.kind] || [];
  const s = target || game.ship;
  return W.some((w) => Physics.inArc(e.x, e.y, e.angle, w.facing, w.arc, w.range, s.x, s.y));
}

function updateEnemies(game, dt) {
  const C = game.C; const ship = game.ship; const sp = game.space;
  for (const e of sp.enemies) {
    const cfg = C.enemies[e.kind];
    // Schild-Regeneration je Sektor
    e.regenT += dt;
    if (e.regenT >= C.enemyShieldRegen) { e.regenT = 0; for (let i = 0; i < 4; i++) if (e.shields[i] < e.shieldsMax[i]) e.shields[i] = Math.min(e.shieldsMax[i], Math.floor(e.shields[i]) + 1); }
    const retreating = e.retreatUntil > game.time;
    if (Pilot.flies(game, e)) {
      // M3b §3: Pilot + gemeinsames Flugmodell
      try { Pilot.fly(game, e, dt); }
      catch (err) { if (game.countError) game.countError('pilot', err); moveLegacy(game, e, dt, retreating); }
    } else moveLegacy(game, e, dt, retreating);
    // S2 §5: Gegner mit Schützling als Ziel – eigene, immer angekündigte Angriffslogik (escort.js)
    if (e.targetId != null) {
      const T = Pilot.targetOf(game, e);
      if (T !== ship) {
        if (e.tele && !e.tele.tgt) { updateTele(game, e, Math.hypot(e.x - ship.x, e.y - ship.y) || 1, retreating, dt); continue; }
        try { Escort.updateAttack(game, e, T, Math.hypot(e.x - T.x, e.y - T.y) || 1, retreating, dt); }
        catch (err) { if (game.countError) game.countError('escort-attack', err); }
        continue;
      }
    }
    if (e.tele && e.tele.tgt) { e.tele = null; e.fireT = 0; game.emit('teleMiss', { id: e.id }); }   // Ziel gewechselt (Treffer der Lerche)
    const d = Math.hypot(e.x - ship.x, e.y - ship.y) || 1;
    const toShip = Math.atan2(ship.y - e.y, ship.x - e.x);
    // M3a §7.1: Kanonenboot, Pylon, Wächter kündigen an (tele) und treffen am Ende sofort
    const T = M3(game).tele;
    if (T && T[e.kind]) { updateTele(game, e, d, retreating, dt); continue; }
    // Schießen (nur wenn das Schiff in einem Feuerbogen liegt)
    e.fireT += dt;
    // QA M3b: im neuen Flugmodell eigenes Feuerintervall und Vorhalt (spaceM3b.pilotFire) – sonst trafen Jäger im kurzen
    // Anflug kaum: ein Schuss je Überflug, gezielt auf die alte Position (Schiff fährt 1–1,5 s Flugzeit weiter)
    const PF = Pilot.flies(game, e) ? ((M3B(game).pilotFire || {})[e.kind] || null) : null;
    const interval = PF && PF.fireInterval != null ? PF.fireInterval : cfg.fireInterval;
    if (!retreating && e.fireT >= interval * crewScale(game).enemyFireInterval && d <= cfg.range && enemyCanHit(game, e) && !ship.docked && !holdingFire(game)) {
      e.fireT = 0;
      const kind = cfg.emp ? 'emp' : 'enemy';
      const ang = PF && PF.lead ? leadAngle(e.x, e.y, ship, C.combat.enemyShotSpeed, PF.lead) : toShip;
      sp.projectiles.push({ id: game.nextId('pr'), kind, x: e.x, y: e.y, angle: ang, speed: C.combat.enemyShotSpeed,
        ttl: C.combat.enemyShotTtl, dmg: PF && PF.damage != null ? PF.damage : cfg.damage, owner: e.id });
      game.emit('sfx', { name: 'blaster' });
    }
  }
}

// M3a-Bewegung (kinematisch): Missionen bis Schritt B, Relais und Wächter immer. Setzt vx/vy für die Interpolation.
function moveLegacy(game, e, dt, retreating) {
  const C = game.C; const ship = Pilot.targetOf(game, e); const sp = game.space;   // S2: Ziel (ohne targetId die Lerche)
  const cfg = C.enemies[e.kind];
  const x0 = e.x, y0 = e.y;
  {
    const dx = e.x - ship.x, dy = e.y - ship.y;
    const d = Math.hypot(dx, dy) || 1;
    const toShip = Math.atan2(ship.y - e.y, ship.x - e.x);
    let tx = e.x, ty = e.y, face = null;
    if (retreating) {
      tx = ship.x + dx / d * C.combat.retreatDist; ty = ship.y + dy / d * C.combat.retreatDist;
    } else if (e.kind === 'relay') {
      const b = stationPoint(game);
      e.orbitA = (e.orbitA || 0) + dt * 0.18 * e.orbitDir;
      tx = b.x + Math.cos(e.orbitA) * C.combat.relayOrbit; ty = b.y + Math.sin(e.orbitA) * C.combat.relayOrbit;
    } else if (e.kind === 'pylon') {
      tx = e.home.x; ty = e.home.y;
      e.angle = turnToward(e.angle, toShip, cfg.turnRate * dt);
      face = e.angle;
    } else if (e.kind === 'sentinel') {
      const a = Math.atan2(dy, dx) + 0.35 * e.orbitDir;
      tx = ship.x + Math.cos(a) * 240; ty = ship.y + Math.sin(a) * 240;
      face = toShip;
    } else if (e.kind === 'raider') {
      // M3a: Kreisrichtung regelmäßig wechseln – sonst „parkt“ ein Jäger im toten Winkel achtern, weil er so schnell
      // um das Schiff kreist, wie es dreht (spaceM3.raiderFlip s, 0 = aus)
      const flip = M3(game).raiderFlip || 0;
      if (flip > 0) { e.flipT = (e.flipT || 0) + dt; if (e.flipT >= flip) { e.flipT = 0; e.orbitDir = -e.orbitDir; } }
      const a =Math.atan2(dy, dx) + 0.55 * e.orbitDir;
      tx = ship.x + Math.cos(a) * C.combat.raiderOrbit; ty = ship.y + Math.sin(a) * C.combat.raiderOrbit;
      if (d <= cfg.range + 120) face = toShip;   // in Reichweite: Bug (Kanone) zum Schiff
    } else {
      // Kanonenboot: Breitseite halten, regelmäßig quer vor dem Bug die Seite wechseln
      e.phaseT += dt;
      const rel = Physics.normAngle(Math.atan2(dy, dx) - ship.angle);
      if (e.phase === 'broadside') {
        e.side = rel >= 0 ? 1 : -1;
        if (e.phaseT >= C.combat.gunboatBroadside) { e.phase = 'crossing'; e.phaseT = 0; e.side = -e.side; }
        const a = ship.angle + e.side * Math.PI / 2;
        tx = ship.x + Math.cos(a) * C.combat.gunboatDist; ty = ship.y + Math.sin(a) * C.combat.gunboatDist;
      } else {
        const goal = e.side * Math.PI / 2;
        const step = Math.sign(goal - rel) * 0.6;
        const nrel = Math.abs(goal - rel) < 0.6 ? goal : rel + step;
        const a = ship.angle + nrel;
        tx = ship.x + Math.cos(a) * C.combat.gunboatDist; ty = ship.y + Math.sin(a) * C.combat.gunboatDist;
        if ((Math.sign(rel) === e.side && Math.abs(rel) > 1.2) || e.phaseT >= C.combat.gunboatCrossing) { e.phase = 'broadside'; e.phaseT = 0; }
      }
      face = toShip + Math.PI / 2;
    }
    const mx = tx - e.x, my = ty - e.y;
    const md = Math.hypot(mx, my);
    const step = Math.min(md, cfg.speed * dt);
    if (md > 1 && cfg.speed > 0) { e.x += mx / md * step; e.y += my / md * step; }
    e.x = clamp(e.x, 30, sp.w - 30); e.y = clamp(e.y, 30, sp.h - 30);
    if (e.kind !== 'pylon') {
      const want = retreating ? (md > 2 ? Math.atan2(my, mx) : e.angle) : (face != null ? face : (md > 2 ? Math.atan2(my, mx) : e.angle));
      e.angle = turnToward(e.angle, want, 3 * dt);
    }
  }
  if (dt > 0) { e.vx = (e.x - x0) / dt; e.vy = (e.y - y0) / dt; }
}

// Snapshot-Ergänzung je Gegner (M3b §3): vx, vy (Interpolation) und state (nur im neuen Flugmodell).
// game.js: Object.assign(o, space.enemySnapExtra(e))
function enemySnapExtra(e) {
  const o = { vx: r1(e.vx || 0), vy: r1(e.vy || 0) };
  const st = Pilot.snapState(e);
  if (st) o.state = st;
  return o;
}

// ---------- Angekündigte Angriffe (M3a §7.1) ----------
function teleSector(game, e) { const s = game.ship; return Physics.sectorOf(s.x, s.y, s.angle, e.x, e.y); }
function startTele(game, e) {
  const T = M3(game).tele; const t = T[e.kind];
  if (!t) return false;
  e.tele = { kind: t.emp ? 'emp' : 'shot', left: t.dur, dur: t.dur, sector: teleSector(game, e), delayed: 0 };
  // Achtung: emit() mischt data in { t, kind } – kein Feld 'kind' mitgeben (sonst überschreibt es den Ereignistyp)
  game.emit('tele', { id: e.id, tkind: e.tele.kind, sector: e.tele.sector, dur: e.tele.dur, enemy: e.kind });
  game.emit('sfx', { name: 'tele_charge', enemy: e.kind, dur: e.tele.dur, key: e.id });
  game.missionEvent('tele', { enemy: e });
  // Solo: ODA sagt jede Ladung an (Abklingzeit je Gegner)
  const solo = game.players.filter((p) => p.connected).length === 1;
  if (solo && (e.teleOdaAt == null || game.time - e.teleOdaAt >= T.odaCooldown)) {
    e.teleOdaAt = game.time;
    game.oda(`${ENEMY_LABEL[e.kind] || 'Gegner'} lädt – ${SECTOR_LABEL[e.tele.sector]}!`, null);
  }
  return true;
}
function updateTele(game, e, d, retreating, dt) {
  const C = game.C; const ship = game.ship; const cfg = C.enemies[e.kind]; const t = M3(game).tele[e.kind];
  if (e.tele) {
    if (retreating || ship.docked) { e.tele = null; e.fireT = 0; game.emit('teleMiss', { id: e.id }); return; }
    e.tele.sector = teleSector(game, e);
    e.tele.left -= dt;
    if (e.tele.left > 0) return;
    const sector = e.tele.sector; const emp = e.tele.kind === 'emp';
    e.tele = null; e.fireT = 0;
    // §20.2: Ausweichen kurz vor dem Ende der Ladung -> der schwere Treffer verfehlt
    const DW = M3(game).dodgeWindow;
    if (DW > 0 && game.time - (ship.lastDodgeT != null ? ship.lastDodgeT : -99) <= DW + EPS) {
      game.stats.teleMisses = (game.stats.teleMisses || 0) + 1;
      game.stats.dodgeEvades = (game.stats.dodgeEvades || 0) + 1;
      game.emit('teleMiss', { id: e.id, dodged: true });
      game.emit('sfx', { name: 'dodge_evade', enemy: e.kind });
      game.missionEvent('dodgeEvade', { enemy: e });
      return;
    }
    if (d <= cfg.range && enemyCanHit(game, e)) {
      game.space.beams.push({ x1: e.x, y1: e.y, x2: ship.x, y2: ship.y, ttl: C.combat.beamTtl * 1.6, kind: 'enemy_heavy', owner: e.id });
      game.emit('sfx', { name: 'heavy_hit', enemy: e.kind });
      game.stats.heavyHits = (game.stats.heavyHits || 0) + 1;
      shipHit(game, sector, t.damage != null ? t.damage : cfg.damage, { heavy: true, emp });
    } else {
      game.stats.teleMisses = (game.stats.teleMisses || 0) + 1;
      game.emit('teleMiss', { id: e.id });
    }
    return;
  }
  e.fireT += dt;
  if (!retreating && !ship.docked && !holdingFire(game) && e.fireT >= cfg.fireInterval * crewScale(game).enemyFireInterval && d <= cfg.range && enemyCanHit(game, e)) startTele(game, e);
}
// M4 §2.4: erster Feindkontakt frühestens CONFIG.lift.firstContactDelay s nach dem Gefechtsalarm, wenn jemand auf Deck II war
// (game.updateAlert setzt ship.holdFireUntil).
function holdingFire(game) { return game.ship.holdFireUntil != null && game.time < game.ship.holdFireUntil; }
function enemyTeleSnap(e) {
  const t = e && e.tele;
  return t ? { kind: t.kind, left: r2(Math.max(0, t.left)), dur: r2(t.dur), sector: t.sector } : null;
}
// Debug `tele [id]`: sofort laden (ohne Bogen-/Reichweitenprüfung)
function debugTele(game, id) {
  const T = M3(game).tele;
  const list = game.space.enemies.filter((e) => T[e.kind]);
  const e = id != null && id !== '' ? list.find((q) => q.id === String(id)) : list.find((q) => !q.tele) || list[0];
  if (!e) return id ? 'Kein ladefähiger Gegner mit dieser ID (Kanonenboot, Pylon, Wächter).' : 'Kein ladefähiger Gegner da (spawn gunboat).';
  startTele(game, e);
  return null;
}

function updateProjectiles(game, dt) {
  const C = game.C; const ship = game.ship; const sp = game.space;
  const keep = [];
  for (const p of sp.projectiles) {
    p.ttl -= dt;
    if (p.kind === 'bolzen') {
      const t = sp.enemies.find((e) => e.id === p.target);
      if (t) p.angle = turnToward(p.angle, Math.atan2(t.y - p.y, t.x - p.x), C.combat.bolzenTurnRate * dt);
    }
    p.x += Math.cos(p.angle) * p.speed * dt; p.y += Math.sin(p.angle) * p.speed * dt;
    let hit = false;
    if (p.kind === 'enemy' || p.kind === 'emp') {
      if (dist(p.x, p.y, ship.x, ship.y) < C.flight.projectileHitDist) {
        hit = true;
        const owner = sp.enemies.find((e) => e.id === p.owner);
        const pierce = !!(owner && owner.tag === 'nachzuegler' && !owner.hasHit);
        if (pierce) owner.hasHit = true;
        const hopts = { pierce, emp: p.kind === 'emp' };
        if (p.tgt) { hopts.shielded = p.tgt; if (game.stats.escort) game.stats.escort.shielded++; }   // S2: Lerche fängt Salve auf den Schützling
        shipHit(game, Physics.sectorOf(ship.x, ship.y, ship.angle, p.x, p.y), p.dmg, hopts);
        if (pierce) game.missionEvent('nachzueglerHit', {});
      } else if (p.tgt) {
        try { hit = Escort.projectileHit(game, p); } catch (err) { if (game.countError) game.countError('escort-projectile', err); }
      }
    } else {
      for (const e of sp.enemies) {
        if (dist(p.x, p.y, e.x, e.y) < (C.combat.hitRadius[e.kind] || 18)) { hit = true; damageEnemy(game, e, p.dmg, p.x - Math.cos(p.angle) * 20, p.y - Math.sin(p.angle) * 20); break; }
      }
    }
    if (!hit && p.ttl > 0 && p.x > -50 && p.y > -50 && p.x < sp.w + 50 && p.y < sp.h + 50) keep.push(p);
  }
  sp.projectiles = keep;
}

function update(game, dt) {
  ensureM3(game);
  game.ship.widescan.cd = Math.max(0, game.ship.widescan.cd - dt);
  updateSystems(game, dt);
  updateFlight(game, dt);
  updateJump(game, dt);
  updateWeapons(game, dt);
  updateTargetScan(game, dt);
  updateEnemies(game, dt);
  // S2 §5: Schützlinge und Rückzugsregel (nur wenn vorhanden – sonst unverändert)
  const sp = game.space;
  if ((sp.escorts && sp.escorts.length) || sp.retreatRule || sp.enemies.some((e) => e.leaving)) {
    try { Escort.update(game, dt); } catch (err) { if (game.countError) game.countError('escort', err); }
  }
  updateProjectiles(game, dt);
  updateHull(game, dt);
  updateSalvage(game);
  checkEmergency(game);
}

// ---------- Konsolenbefehle ----------
function captainPower(game, sys, delta) {
  const C = game.C; const pw = game.ship.power;
  if (!POWER_SYSTEMS.includes(sys)) return 'Unbekanntes System.';
  const d = delta > 0 ? 1 : -1;
  const nv = pw[sys] + d;
  if (nv < 0 || nv > C.power.maxPerSystem) return 'Grenze erreicht.';
  if (d > 0 && powerUsed(game) + 1 > reactorOutput(game)) return 'Reaktor ausgelastet – erst woanders Energie abziehen.';
  pw[sys] = nv;
  game.ship.powerIntent = Object.assign({}, pw);
  enforceShields(game);
  return null;
}
function captainShield(game, sector, delta) {
  const C = game.C; const sh = game.ship.shields;
  if (!(sector >= 0 && sector <= 3)) return 'Unbekannter Sektor.';
  const d = delta > 0 ? 1 : -1;
  const nv = sh.alloc[sector] + d;
  if (nv < 0 || nv > C.shields.maxPerSector) return 'Grenze erreicht.';
  const cp = shieldCaps(game)[sector];
  if (d > 0 && nv > cp) return cp === 0 ? `Emitter ${SECTOR_LABEL[sector]} zerstört – der Sektor hält keine Schilde.` : `Emitter ${SECTOR_LABEL[sector]} beschädigt – höchstens ${cp}.`;
  if (d > 0 && sh.alloc.reduce((a, b) => a + b, 0) + 1 > shieldPool(game)) return 'Schildpool erschöpft – erst woanders abziehen oder mehr Energie auf Schilde.';
  sh.alloc[sector] = nv;
  sh.allocIntent = sh.alloc.slice();
  return null;
}

module.exports = {
  enterScene, update, shipHit, spawnEnemy, damageEnemy, dodge, doJump, selectDest, weaponsFire, weaponsReload, weaponsTarget,
  weaponsScan, weaponsWidescan, setMarker, markerOnTarget, resolveTarget, captainOverload, reactorOnline,
  captainPower, captainShield, shieldPool, reactorOutput, maxSpeed, checkEmergency, spawnSalvage, mountIds, inMountArc, jammersPresent,
  stationPoint, isDown, PHASES,
  // M3a §9.4 (SERVER-COMBAT) – Aufrufer: game.js (Befehle, Snapshot)
  weaponsAlloc, weaponsHold, weaponsCharge, lanceTrace, lanceDamage, captainBurst, chargePoints, shieldCaps, turnCaps, mountsSnapshot, shieldsSnapshot, enemyTeleSnap,
  consumeFullCharge, debugTele, debugBurst, normMount, ensureM3, M3_MOUNTS, MOUNT_SYSTEM, EMITTERS, chargeFactor,
  // §21.1 Allstopp
  helmStop, helmInput, fullStopBrake,
  // M3b §2/§3 (SERVER-FLIGHT): Temporegler, Snapshot-Ergänzungen
  helmThrottle, helmSnapshot, enemySnapExtra, engineSpeedFactor, lercheClass,
  leadAngle,   // QA M3b: Vorhalt der Jäger-Schüsse (spaceM3b.pilotFire)
  crewScale, holdingFire, enemyCanHit,   // S2 §5 (escort.js)
};
