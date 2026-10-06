'use strict';
// Raum: Orte/Szenen, Flug, Docken, Faltsprung, Energie/Reaktor, Lebenserhaltung, Schilde, Waffen (Phasenkanonen),
// Gegner (mit Schildsektoren), Projektile, Asteroiden, Ziel-Scan, Weitscan, Marker. CONTRACT-M1 §4–§6, §9.2.
const Physics = require('../../shared/physics.js');
const Protocol = require('../../shared/protocol.js');
const Locations = require('../../shared/locations.js');
const interior = require('./interior.js');
const { makeRng, clamp, dist, turnToward } = require('../util.js');

const POWER_SYSTEMS = Protocol.POWER_SYSTEMS;
const JAMMERS = ['raider', 'gunboat'];   // Rostmeute: Störsender blockieren den Faltsprung
const isDown = (st) => st === 'broken' || st === 'offline';

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ---------- Szenen ----------
// opts.docked: Start angedockt (nur Orte mit Liegeplatz). Sonst Ankunft am arrive-Punkt.
function enterScene(game, locId, opts) {
  const C = game.C;
  const loc = Locations.get(locId) || Locations.get('hafen');
  const sc = loc.scene;
  const ship = game.ship;
  const docked = !!(opts && opts.docked && sc.dock);
  const st = docked ? Object.assign({ angle: 0 }, sc.start || sc.dock) : sc.arrive;
  ship.scene = loc.id;
  ship.x = st.x; ship.y = st.y; ship.angle = st.angle || 0;
  ship.vx = 0; ship.vy = 0; ship.speed = 0;
  ship.docked = docked; ship.dockedAt = docked ? loc.id : null; ship.dockArmed = !docked;
  ship.helm.turn = 0; ship.helm.thrust = 0;
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
  return isDown(s) ? P.reactorBroken : s === 'damaged' ? P.reactorDamaged : P.reactor;
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
  let pool = ship.power.shields * C.shields.pointsPerPower + (game.upgrades.schildpool ? 2 : 0);
  if (game.time < game.away.kuppelUntil) pool -= C.support.kuppel.shieldCost;
  return Math.max(0, pool);
}
function enforceShields(game) {
  const sh = game.ship.shields; const pool = shieldPool(game);
  sh.pool = pool;
  if (!sh.allocIntent) sh.allocIntent = sh.alloc.slice();
  sh.alloc = sh.allocIntent.slice();
  while (sh.alloc.reduce((a, b) => a + b, 0) > pool) {
    let top = 0; for (let i = 0; i < 4; i++) if (sh.alloc[i] > sh.alloc[top]) top = i;
    sh.alloc[top]--;
  }
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

function updateSystems(game, dt) {
  const C = game.C; const ship = game.ship;
  interior.updateOffline(game, dt);
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
      if (ship.systems[k] === 'ok') interior.damageSystem(game, k, 'damaged');
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
  if (isDown(ship.systems.shields) || game.transfer.isBeaming(game)) {
    sh.current = [0, 0, 0, 0]; sh.regenT = 0;
  } else {
    for (let i = 0; i < 4; i++) if (sh.current[i] > sh.alloc[i]) sh.current[i] = sh.alloc[i];
    const interval = ship.systems.shields === 'damaged' ? C.shieldsDamagedInterval : C.shields.regenInterval;
    sh.regenT += dt;
    if (sh.regenT >= interval) {
      sh.regenT = 0;
      for (let i = 0; i < 4; i++) if (sh.current[i] < sh.alloc[i]) sh.current[i]++;
    }
  }
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- Flug ----------
function maxSpeed(game) {
  const C = game.C; const ship = game.ship;
  const st = ship.systems.engines === 'offline' ? 'broken' : ship.systems.engines;
  return C.ship.maxSpeed * C.enginePowerFactor[ship.power.engines] * (C.stateFactor.engines[st] || 1);
}

function updateFlight(game, dt) {
  const C = game.C; const ship = game.ship;
  const loc = Locations.get(ship.scene); const sc = loc.scene;
  ship.dodgeCd = Math.max(0, ship.dodgeCd - dt);
  ship.helm.manned = game.players.some((p) => p.console === 'helm' && p.connected);
  if (!ship.helm.manned) { ship.helm.turn = 0; ship.helm.thrust = 0; }
  if (ship.docked) {
    const dp = sc.dock || sc.start;
    ship.vx = 0; ship.vy = 0; ship.speed = 0;
    // QA M1: Wer beim Andocken noch W hält, legt nicht sofort wieder ab – erst Schub loslassen, dann erneut W.
    if (ship.dockHold && ship.helm.thrust <= 0.1) ship.dockHold = false;
    if (ship.helm.thrust > 0.1 && !ship.dockHold) {
      ship.docked = false; ship.dockedAt = null; ship.dockArmed = false; ship.undockT = game.time;
      game.emit('sfx', { name: 'dodge' });
      game.missionEvent('undocked', {});
    } else { ship.x = dp.x; ship.y = dp.y; return; }
  }
  ship.angle = Physics.normAngle(ship.angle + ship.helm.turn * C.ship.turnRate * dt);
  const hx = Math.cos(ship.angle), hy = Math.sin(ship.angle);
  let f = ship.vx * hx + ship.vy * hy;
  let l = -ship.vx * hy + ship.vy * hx;
  const vmax = maxSpeed(game);
  f += C.ship.accel * ship.helm.thrust * dt;
  if (f > vmax) f = Math.max(vmax, f - C.ship.accel * dt);
  const vmin = -vmax * C.flight.reverseFactor;
  if (f < vmin) f = Math.min(vmin, f + C.ship.accel * dt);
  l *= Math.max(0, 1 - C.flight.lateralDrag * dt);
  // M1: Stationshalten – unbesetzte Steuer bei Schleichfahrt (≤ Beam-Tempo) bremst auf 0, damit das Schiff
  // während einer Außenmission nicht aus der Transfer-Reichweite driftet (Softlock-Schutz, v. a. solo).
  if (!ship.helm.manned && Math.hypot(f, l) <= C.ship.beamMaxSpeed) {
    const k = Math.max(0, 1 - 1.5 * dt);
    f *= k; l *= k;
    if (Math.abs(f) < 0.5) f = 0;
  }
  ship.vx = f * hx - l * hy; ship.vy = f * hy + l * hx;
  ship.x += ship.vx * dt; ship.y += ship.vy * dt;
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
  const a = ship.angle + (dir >= 0 ? Math.PI / 2 : -Math.PI / 2);
  ship.vx += Math.cos(a) * C.ship.dodgeImpulse; ship.vy += Math.sin(a) * C.ship.dodgeImpulse;
  ship.dodgeCd = C.ship.dodgeCooldown;
  game.emit('sfx', { name: 'dodge' });
  return null;
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
function shipHit(game, sector, dmg, opts) {
  const C = game.C; const ship = game.ship; const sh = ship.shields;
  game.stats.hits++;
  if (!opts.pierce && sh.current[sector] > 0) {
    sh.current[sector] = Math.max(0, sh.current[sector] - dmg);
    game.emit('hit', { sector, shield: true, dmg });
    game.emit('sfx', { name: 'shield_hit' });
    if (sh.current[sector] === 0) game.missionEvent('shieldDown', { sector });
    return;
  }
  if (opts.emp) {
    // EMP durch die Schilde: zufälliges System offline statt Hüllenschaden
    const cand = interior.SYSTEM_ORDER.filter((s) => !isDown(ship.systems[s]));
    game.emit('hit', { sector, shield: false, dmg: 0, emp: true });
    game.emit('sfx', { name: 'emp' });
    if (cand.length) interior.setOffline(game, game.rng.pick(cand), C.emp.offlineTime);
    return;
  }
  game.emit('hit', { sector, shield: false, dmg });
  game.emit('sfx', { name: 'hull_hit' });
  if (!game.god) ship.hull = Math.max(0, ship.hull - 5 * dmg);
  const region = sector;
  const sysList = game.world.Maps.SECTOR_REGIONS[region].systems;
  if (game.rng.chance(C.hitEffects.systemChance)) {
    let list = sysList;
    if (game.rng.chance(C.hitEffects.spill || 0)) {
      const R = game.world.Maps.SECTOR_REGIONS;
      list = R[(region + 1) % 4].systems.concat(R[(region + 3) % 4].systems);
    }
    const ready = list.filter((s) => (ship.sysHitAt[s] || -99) + (C.hitEffects.systemCooldown || 0) <= game.time && ship.systems[s] !== 'offline');
    if (ready.length) { const s = game.rng.pick(ready); ship.sysHitAt[s] = game.time; interior.damageSystem(game, s); }
  }
  if (game.rng.chance(C.hitEffects.fireChance)) { const t = interior.randomRegionFloor(game, region, false); interior.addFire(game, t.x, t.y); }
  if (game.rng.chance(C.hitEffects.breachChance)) { const t = interior.randomRegionFloor(game, region, true); interior.addBreach(game, t.x, t.y); }
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
  for (const e of game.space.enemies) e.retreatUntil = game.time + C.combat.retreatTime;
  game.space.projectiles = game.space.projectiles.filter((p) => p.kind !== 'enemy' && p.kind !== 'emp');
  game.inventory.marks = Math.max(0, game.inventory.marks - C.emergency.marksCost);
  game.stats.emergencies++;
  game.emit('emergency', {});
  game.emit('sfx', { name: 'emergency' });
  game.oda('Notfallprotokoll! Hülle stabilisiert, Feuer erstickt, Lecks verschäumt. Kostet 50 Marken – und Würde.', null);
}

// ---------- Waffen (§4.2, §5) ----------
const PHASES = ['phase_l', 'phase_r'];
function mountIds(game) {
  const out = PHASES.slice();
  if (game.upgrades.bolzenwerfer) out.push('bolzen');
  if (game.upgrades.seitenturm) out.push('seitenturm');
  return out;
}
function chargeFactor(game) {
  const C = game.C; const ship = game.ship;
  const st = ship.systems.weapons;
  if (isDown(st)) return null;
  const pf = C.weaponPowerFactor[ship.power.weapons];
  if (pf == null) return null;
  return pf * (st === 'damaged' ? C.stateFactor.weapons.damaged : 1);
}
function inMountArc(game, mount, x, y) {
  const C = game.C; const s = game.ship; const cfg = C.weapons[mount];
  return Physics.inArc(s.x, s.y, s.angle, cfg.facing, cfg.arc, cfg.range, x, y);
}
function mountOrigin(game, mount) {
  const s = game.ship; const a = s.angle;
  if (mount === 'phase_l' || mount === 'phase_r') {
    const side = mount === 'phase_l' ? -Math.PI / 2 : Math.PI / 2;
    return { x: s.x + Math.cos(a) * 20 + Math.cos(a + side) * 12, y: s.y + Math.sin(a) * 20 + Math.sin(a + side) * 12 };
  }
  return { x: s.x, y: s.y };
}

function updateWeapons(game, dt) {
  const C = game.C; const ship = game.ship; const m = ship.mount;
  const f = chargeFactor(game);
  if (f != null) {
    for (const k of PHASES) m[k].charge = Math.min(1, m[k].charge + dt / (C.weapons[k].charge * f));
    if (game.upgrades.seitenturm) m.seitenturm.charge = Math.min(1, m.seitenturm.charge + dt / (C.weapons.seitenturm.charge * f));
    m.bolzen.shotT = Math.max(0, m.bolzen.shotT - dt);
    if (m.bolzen.reloadT != null) {
      m.bolzen.reloadT += dt / f;
      if (m.bolzen.reloadT >= C.weapons.bolzen.reloadTime) {
        m.bolzen.reloadT = null; m.bolzen.loaded = Math.min(C.weapons.bolzen.magazine, m.bolzen.loaded + 1);
        game.emit('sfx', { name: 'ui_click' });
      }
    }
  }
  if (ship.target && !resolveTarget(game, ship.target)) ship.target = null;
  // Unbesetzte Taktik: Phasenkanonen feuern automatisch mit 50 % auf das nächste Ziel im Bogen
  const manned = game.players.some((p) => p.console === 'weapons' && p.connected);
  if (!manned && !(ship.docked)) {
    for (const k of PHASES) {
      if (m[k].charge < 1) continue;
      let best = null, bd = Infinity;
      for (const e of game.space.enemies) {
        if (!inMountArc(game, k, e.x, e.y)) continue;
        const d = dist(ship.x, ship.y, e.x, e.y);
        if (d < bd) { bd = d; best = e; }
      }
      if (best) fireBeam(game, k, best, C.weapons[k].damage * C.weapons[k].autoFactor);
    }
  }
  for (const b of game.space.beams) b.ttl -= dt;
  game.space.beams = game.space.beams.filter((b) => b.ttl > 0);
}

function fireBeam(game, mount, enemy, dmg) {
  const ship = game.ship;
  ship.mount[mount].charge = 0;
  const o = mountOrigin(game, mount);
  const kind = PHASES.includes(mount) ? 'phase' : mount;
  game.space.beams.push({ x1: o.x, y1: o.y, x2: enemy.x, y2: enemy.y, ttl: game.C.combat.beamTtl, kind, mount });
  game.emit('sfx', { name: kind });
  damageEnemy(game, enemy, dmg, o.x, o.y);
}

function weaponsFire(game, mount) {
  const C = game.C; const ship = game.ship;
  if (ship.docked) return 'Angedockt wird nicht geschossen.';
  if (isDown(ship.systems.weapons)) return 'Waffenbank ausgefallen.';
  const target = game.space.enemies.find((e) => e.id === ship.target);
  if (!target) return ship.target ? 'Das Ziel ist kein Gegner – nur scannen (S).' : 'Kein Ziel gewählt (T).';
  if (mount === 'both') {
    let fired = 0, inArcAny = false;
    for (const k of PHASES) {
      if (!inMountArc(game, k, target.x, target.y)) continue;
      inArcAny = true;
      if (ship.mount[k].charge >= 1) { fireBeam(game, k, target, C.weapons[k].damage); fired++; }
    }
    if (fired) return null;
    return inArcAny ? 'Lädt noch.' : 'Ziel außerhalb beider Feuerbögen.';
  }
  const cfg = C.weapons[mount];
  if (!cfg || mount === 'lanze') return 'Unbekannte Waffe.';
  if (mount === 'seitenturm' && !game.upgrades.seitenturm) return 'Kein Seitenturm eingebaut (Hafen-Shop).';
  if (mount === 'bolzen' && !game.upgrades.bolzenwerfer) return 'Kein Bolzenwerfer eingebaut (Shop: Hafen oder Vaelen).';
  if (!inMountArc(game, mount, target.x, target.y)) return 'Ziel außerhalb des Feuerbogens.';
  if (mount === 'bolzen') {
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
  if (ship.mount[mount].charge < 1) return 'Lädt noch.';
  fireBeam(game, mount, target, cfg.damage);
  return null;
}

function weaponsReload(game) {
  const C = game.C; const b = game.ship.mount.bolzen;
  if (!game.upgrades.bolzenwerfer) return 'Kein Bolzenwerfer eingebaut.';
  if (b.reloadT != null) return 'Lädt bereits nach.';
  if (b.loaded >= C.weapons.bolzen.magazine) return 'Magazin ist voll.';
  if (game.inventory.bolzen <= 0) return 'Keine Bolzen mehr im Vorrat.';
  if (chargeFactor(game) == null) return 'Waffen ohne Energie oder ausgefallen.';
  game.inventory.bolzen--;
  b.reloadT = 0;
  game.emit('sfx', { name: 'ui_click' });
  return null;
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
  const hp = Math.max(1, Math.round(cfg.hp * (kind === 'relay' ? 1 : crewScale(game).enemyHp)));
  const a = o.angle != null ? o.angle : game.rng.range(-Math.PI, Math.PI);
  let x = o.x != null ? o.x : ship.x + Math.cos(a) * C.combat.spawnDist;
  let y = o.y != null ? o.y : ship.y + Math.sin(a) * C.combat.spawnDist;
  x = clamp(x, 60, sp.w - 60); y = clamp(y, 60, sp.h - 60);
  const shields = (C.enemyShields[kind] || [0, 0, 0, 0]).slice();
  const e = { id: game.nextId('e'), kind, x, y, angle: o.facing != null ? o.facing : Math.atan2(ship.y - y, ship.x - x), hp, hpMax: hp,
    shields, shieldsMax: shields.slice(), regenT: 0, scanned: false,
    fireT: cfg.fireInterval * 0.5, orbitDir: game.rng.chance(0.5) ? 1 : -1, retreatUntil: 0, tag: o.tag || null, hitT: 0,
    phase: 'broadside', phaseT: 0, side: 1, orbitA: o.orbitA, home: { x, y } };
  sp.enemies.push(e);
  game.missionEvent('enemySpawn', { enemy: e });
  return e;
}

function crewScale(game) {
  const n = Math.max(1, Math.min(3, game.players.filter((p) => p.connected).length));
  return game.C.crewScaling[n] || { enemyFireInterval: 1, enemyHp: 1 };
}

// Schaden aus Richtung (srcX, srcY): erst Schildsektor des Gegners, dann Hülle.
function damageEnemy(game, e, dmg, srcX, srcY) {
  e.hitT = game.time;
  let rest = dmg;
  if (srcX != null && e.shields) {
    const sec = Physics.sectorOf(e.x, e.y, e.angle, srcX, srcY);
    const absorb = Math.min(e.shields[sec], rest);
    if (absorb > 0) { e.shields[sec] = Math.round((e.shields[sec] - absorb) * 10) / 10; rest -= absorb; e.shieldHitT = game.time; e.shieldHitSector = sec; }
    if (rest <= 0) { game.emit('sfx', { name: 'shield_hit', volume: 0.5 }); game.missionEvent('enemyShieldHit', { enemy: e, sector: sec }); return; }
  }
  e.hp = Math.round((e.hp - rest) * 10) / 10;
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

function enemyCanHit(game, e) {
  const W = game.C.enemyWeapons[e.kind] || [];
  const s = game.ship;
  return W.some((w) => Physics.inArc(e.x, e.y, e.angle, w.facing, w.arc, w.range, s.x, s.y));
}

function updateEnemies(game, dt) {
  const C = game.C; const ship = game.ship; const sp = game.space;
  for (const e of sp.enemies) {
    const cfg = C.enemies[e.kind];
    // Schild-Regeneration je Sektor
    e.regenT += dt;
    if (e.regenT >= C.enemyShieldRegen) { e.regenT = 0; for (let i = 0; i < 4; i++) if (e.shields[i] < e.shieldsMax[i]) e.shields[i] = Math.min(e.shieldsMax[i], Math.floor(e.shields[i]) + 1); }
    const dx = e.x - ship.x, dy = e.y - ship.y;
    const d = Math.hypot(dx, dy) || 1;
    const retreating = e.retreatUntil > game.time;
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
      const a = Math.atan2(dy, dx) + 0.55 * e.orbitDir;
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
    // Schießen (nur wenn das Schiff in einem Feuerbogen liegt)
    e.fireT += dt;
    if (!retreating && e.fireT >= cfg.fireInterval * crewScale(game).enemyFireInterval && d <= cfg.range && enemyCanHit(game, e) && !ship.docked) {
      e.fireT = 0;
      const kind = cfg.emp ? 'emp' : 'enemy';
      sp.projectiles.push({ id: game.nextId('pr'), kind, x: e.x, y: e.y, angle: toShip, speed: C.combat.enemyShotSpeed,
        ttl: C.combat.enemyShotTtl, dmg: cfg.damage, owner: e.id });
      game.emit('sfx', { name: 'blaster' });
    }
  }
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
        shipHit(game, Physics.sectorOf(ship.x, ship.y, ship.angle, p.x, p.y), p.dmg, { pierce, emp: p.kind === 'emp' });
        if (pierce) game.missionEvent('nachzueglerHit', {});
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
  game.ship.widescan.cd = Math.max(0, game.ship.widescan.cd - dt);
  updateSystems(game, dt);
  updateFlight(game, dt);
  updateJump(game, dt);
  updateWeapons(game, dt);
  updateTargetScan(game, dt);
  updateEnemies(game, dt);
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
};
