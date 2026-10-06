'use strict';
// Transfer (Beamen) + Außenmissionen (B-7-Plattform, Wrack „Zaunkönig“) + Orbit-Unterstützung (§6, M1 §9.4).
const Physics = require('../../shared/physics.js');
const Protocol = require('../../shared/protocol.js');
const Locations = require('../../shared/locations.js');
const W = require('../world.js');
const interior = require('./interior.js');
const combat = require('./combat.js');
const { bfs, lineOfSight, dist, makeRng } = require('../util.js');

const TILE = Physics.TILE;
const DRONE_HITBOX = { w: 14, h: 10 };
const isDown = (st) => st === 'broken' || st === 'offline';

function baseAway(map) {
  return {
    map, active: false, drones: [], projectiles: [],
    npc: { x: 0, y: 0, dir: 'down', following: null, rescued: false, present: false, injured: false, path: null, pathT: 0, moving: false },
    items: [], marker: null, strikes: [], pendingStrikes: [],
    sonde: { disabled: true, symbols: [], entered: [], lockout: 0 },
    codeTable: {}, odaCodeHelp: false, kuppelUntil: 0, sensorUntil: 0, doorOpen: true,
    kuppelHp: 0, alarmUntil: 0, noHumanT: 0, firstBeamAt: null, coreRebooted: false,
    salvage: [], hollow: null, loreRead: false,
  };
}

// ---------- Aufbau ----------
function makeAway(game) {
  const rng = makeRng(game.seed ^ 0xC0DE);
  const symbols = rng.shuffle(Protocol.CODE_SYMBOLS.slice()).slice(0, game.C.away.codeLength);
  const colors = rng.shuffle(Protocol.CODE_COLORS.slice());
  const codeTable = {};
  Protocol.CODE_SYMBOLS.forEach((s, i) => { codeTable[s] = colors[i]; });
  const npcC = W.tileCenter(W.NPC_SPAWN.x, W.NPC_SPAWN.y);
  const qC = W.tileCenter(W.DATENKERN_SPAWN.x, W.DATENKERN_SPAWN.y);
  return Object.assign(baseAway('platform'), {
    drones: W.DRONE_SPAWNS.map((t, i) => {
      const c = W.tileCenter(t.x, t.y);
      return { id: 'd' + i, kind: 'drone', x: c.x, y: c.y, hp: game.C.away.drone.hp, dir: 'down', revealed: false, alive: true,
        home: { x: c.x, y: c.y }, fireT: i * 0.4, wander: null, wanderT: 0, hitT: -9 };
    }),
    npc: { x: npcC.x, y: npcC.y, dir: 'down', following: null, rescued: false, present: true, injured: true, path: null, pathT: 0, moving: false },
    items: [{ id: 'core', kind: 'datenkern', x: qC.x, y: qC.y }],
    sonde: { disabled: false, symbols, entered: [], lockout: 0 },
    codeTable, doorOpen: false,
  });
}

function makeWreck(game) {
  const C = game.C; const info = W.AWAY_MAPS.wreck;
  const hv = info.hollow;
  const rewards = C.wreckAway.rewards;
  let k = 0;
  const salvage = info.salvage.map((t) => {
    // Container direkt hinter der dünnen Wand = Hohlraum-Belohnung
    const hidden = Math.abs(t.x - hv.x) <= 1 && t.y === hv.y + 1;
    return { x: t.x, y: t.y, done: false, hidden, reward: hidden ? C.wreckAway.hollowReward : rewards[(k++) % rewards.length] };
  });
  return Object.assign(baseAway('wreck'), {
    drones: info.scavengers.map((t, i) => {
      const c = W.tileCenter(t.x, t.y);
      return { id: 'v' + i, kind: 'scavenger', x: c.x, y: c.y, hp: C.wreckAway.scavenger.hp, dir: 'down', revealed: false, alive: true,
        home: { x: c.x, y: c.y }, fireT: i * 0.5, wander: null, wanderT: 0, hitT: -9 };
    }),
    salvage, hollow: { x: hv.x, y: hv.y, marked: false, open: false },
  });
}

// M2: Mond Kesh (Kampf v2, server/sim/combat.js)
function makeKesh(game) { return combat.makeKesh(game, baseAway('kesh')); }

// ---------- Transfer ----------
function beamSpot(game) {
  const loc = Locations.get(game.ship.scene);
  const sc = loc && loc.scene;
  if (!sc || !sc.beam || !sc.station) return null;
  return { x: sc.station.x, y: sc.station.y, range: sc.beam.range, map: sc.beam.map };
}

function canBeam(game, dir) {
  const C = game.C; const ship = game.ship;
  if (isDown(ship.systems.transfer)) return { ok: false, reason: ship.systems.transfer === 'offline' ? 'Transfer offline (EMP) – kurz warten.' : 'Transfer zerstört – erst reparieren (Bots holen Ersatzteile).' };
  const spot = beamSpot(game);
  if (!spot) return { ok: false, reason: 'Hier gibt es nichts zum Hinbeamen.' };
  if (spot.map !== game.away.map) return { ok: false, reason: 'Transfer wird noch umgestellt – kurz warten.' };
  if (game.away.recallLockUntil && game.time < game.away.recallLockUntil) return { ok: false, reason: `Transfer kühlt nach der Notrückholung ab (${Math.ceil(game.away.recallLockUntil - game.time)} s).` };
  if (dir === 'down') {
    const why = game.mission.beamDownBlocked(spot.map);
    if (why) return { ok: false, reason: why };
  }
  if (dist(ship.x, ship.y, spot.x, spot.y) > spot.range) return { ok: false, reason: `Zu weit vom Ziel (max. ${spot.range}).` };
  if (ship.speed > C.ship.beamMaxSpeed) return { ok: false, reason: 'Zu schnell zum Beamen (max. 30).' };
  if (game.ship.beaming) return { ok: false, reason: 'Transfer läuft bereits.' };
  return { ok: true };
}

function isBeaming(game) {
  return !!game.ship.beaming || game.players.some((p) => p.hold && p.hold.kind === 'beam');
}

function onPad(game, p) {
  const t = Physics.toTile(p.x, p.y);
  const pads = p.zone === 'ship' ? W.SHIP_PADS : interior.awayInfo(game).pads;
  return pads.some((q) => q.x === t.x && q.y === t.y);
}

function padPlayers(game, zone) {
  return game.players.filter((p) => p.zone === zone && p.connected && onPad(game, p));
}

function consoleBeam(game, p, dir) {
  const chk = canBeam(game, dir);
  if (!chk.ok) return chk.reason;
  const zone = dir === 'down' ? 'ship' : 'away';
  const list = padPlayers(game, zone);
  if (!list.length) return dir === 'down' ? 'Niemand auf den Transferpads.' : 'Niemand vom Außenteam steht auf den Pads unten.';
  const dur = game.ship.systems.transfer === 'damaged' ? game.C.ship.beamTimeDamaged : game.C.ship.beamTime;
  game.ship.beaming = { dir, t: 0, dur, pids: list.map((o) => o.id) };
  for (const o of list) { o.beamLock = true; o.console = null; o.hold = null; }
  game.emit('sfx', { name: 'beam' });
  return null;
}

function selfBeam(game, p, dir) {
  const list = padPlayers(game, p.zone);
  if (!list.includes(p)) list.push(p);
  executeBeam(game, list.map((o) => o.id), dir);
}

function updateBeaming(game, dt) {
  const b = game.ship.beaming;
  if (!b) return;
  b.t += dt;
  if (isDown(game.ship.systems.transfer)) {
    for (const id of b.pids) { const p = game.playerById(id); if (p) p.beamLock = false; }
    game.ship.beaming = null;
    game.oda('Transfer abgebrochen – das System ist ausgefallen.', null);
    return;
  }
  if (b.t < b.dur) return;
  game.ship.beaming = null;
  for (const id of b.pids) { const p = game.playerById(id); if (p) p.beamLock = false; }
  executeBeam(game, b.pids, b.dir);
}

function executeBeam(game, pids, dir) {
  const away = game.away;
  const players = pids.map((id) => game.playerById(id)).filter(Boolean);
  if (!players.length) return;
  if (dir === 'down') {
    players.forEach((p, i) => { interior.placeOnAwayPad(game, p, i); p.beamLock = false; });
    if (!away.active) { away.active = true; away.firstBeamAt = game.time; }
    game.emit('beam', { pids, dir, map: away.map });
    game.emit('sfx', { name: 'beam' });
    game.missionEvent('beamedDown', { players, map: away.map });
  } else {
    if (away.map === 'platform') {
      const npc = away.npc;
      if (npc.present && !npc.rescued && npc.following && players.some((p) => dist(p.x, p.y, npc.x, npc.y) <= game.C.awayExtra.rescueRange)) {
        npc.rescued = true; npc.present = false; npc.following = null;
        game.missionEvent('npcRescued', {});
      }
      for (const it of away.items.slice()) {
        const t = Physics.toTile(it.x, it.y);
        if (it.kind === 'datenkern' && W.PLATFORM_PADS.some((q) => q.x === t.x && q.y === t.y)) {
          away.items.splice(away.items.indexOf(it), 1);
          const pad = W.SHIP_PADS[2];
          const c = W.tileCenter(pad.x, pad.y);
          game.ship.groundItems.push({ id: it.id, kind: 'datenkern', x: c.x, y: c.y });
        }
      }
    }
    players.forEach((p, i) => { interior.placeOnShipPad(game, p, i); p.beamLock = false; });
    game.emit('beam', { pids, dir, map: away.map });
    game.emit('sfx', { name: 'beam' });
    game.missionEvent('beamedUp', { players, map: away.map });
    // QA M1: Wrack-Außenmission endet, sobald niemand mehr unten ist (sonst bleiben Außenteam-Reiter und
    // Orbit-Einblendung der Taktik dauerhaft an). Erneutes Beamen startet sie wieder.
    if (away.map === 'wreck' && !game.players.some((p) => p.zone === 'away')) away.active = false;
  }
}
// (Schild/Medipack beim Betreten/Verlassen einer v2-Karte: interior.placeOnAwayPad/placeOnShipPad -> combat.onArrive/onLeave)

function recall(game, pid) {
  const p = game.playerById(pid);
  if (!p || p.zone !== 'away') return 'Dieser Spieler ist nicht unten.';
  if (isDown(game.ship.systems.transfer)) return 'Transfer ausgefallen.';
  if (game.support.recall > 0) return `Notrückholung lädt noch (${Math.ceil(game.support.recall)} s).`;
  game.support.recall = game.C.support.recall.cooldown;
  if (p.downed) interior.revivePlayer(game, p);
  interior.placeOnShipPad(game, p);
  game.emit('beam', { pids: [p.id], dir: 'up' });
  game.emit('sfx', { name: 'beam' });
  game.missionEvent('beamedUp', { players: [p], map: game.away.map });
  if (game.away.map === 'wreck' && !game.players.some((q) => q.zone === 'away')) game.away.active = false;
  return null;
}

function supply(game) {
  if (!anyAway(game)) return 'Kein Außenteam unten.';
  if (isDown(game.ship.systems.transfer)) return 'Transfer ausgefallen.';
  if (!game.away.marker) return 'Keine Markierung gesetzt (Außenteam: Q).';
  if (game.support.supply > 0) return `Nachschub lädt noch (${Math.ceil(game.support.supply)} s).`;
  if (game.inventory.medipack <= 0) return 'Keine Medipacks mehr an Bord.';
  game.inventory.medipack--;
  game.support.supply = game.C.support.supply.cooldown;
  const m = game.away.marker;
  game.away.items.push({ id: game.nextId('i'), kind: 'medipack', x: m.x, y: m.y });
  game.emit('beam', { pids: [], dir: 'down', x: m.x, y: m.y });
  game.emit('sfx', { name: 'beam', zone: 'away', x: m.x, y: m.y });
  return null;
}

function spawnGuards(game) {
  const away = game.away; const C = game.C;
  let n = 0;
  for (const t of C.awayExtra.guardSpawns || []) {
    const c = W.tileCenter(t.x, t.y);
    away.drones.push({ id: 'w' + (++n), kind: 'drone', x: c.x, y: c.y, hp: C.away.drone.hp, dir: 'down', revealed: false, alive: true,
      home: { x: c.x, y: c.y }, fireT: n * 0.5, wander: null, wanderT: 0, hitT: -9, guard: true });
  }
  away.alarmUntil = game.time + C.awayExtra.alarmTime;
  game.emit('sfx', { name: 'code_fail', zone: 'away' });
  return n;
}

function anyAway(game) { return game.players.some((p) => p.zone === 'away'); }

// ---------- Wrack ----------
function openSalvage(game, p, x, y) {
  const aw = game.away;
  const s = aw.salvage.find((q) => q.x === x && q.y === y);
  if (!s || s.done) return;
  s.done = true;
  const txt = game.explore.reward(s.reward);
  game.emit('sfx', { name: 'salvage', zone: 'away', x: x * TILE + 16, y: y * TILE + 16 });
  if (s.hidden) {
    game.explore.addLog('Wrack: Hohlraum ausgeräumt – ' + txt + '.', 'wrack');
    game.oda('Der Hohlraum hatte es in sich: ' + txt + '. Neugier lohnt sich!', null);
  } else game.oda('Container geborgen: ' + txt + '. Direkt ins Lager, kein Schleppen.', null);
  game.missionEvent('wreckSalvage', { hidden: s.hidden });
}
function readLore(game, p) {
  const aw = game.away;
  if (aw.loreRead) { game.notice(p, 'Logbuch der „Zaunkönig“: „…Ladung gesichert. Hinter der Wand ist sie sicher.“'); return; }
  aw.loreRead = true;
  const txt = game.explore.reward(game.C.wreckAway.loreReward);
  game.emit('sfx', { name: 'lore', zone: 'away' });
  game.explore.addLog('Logbuch der „Zaunkönig“: „Plünderer im Anflug. Das Beste haben wir hinter die dünne Wand im Laderaum gepackt.“', 'wrack');
  game.emit('radio', { from: 'Logbuch „Zaunkönig“', text: 'Plünderer im Anflug. Das Beste haben wir hinter die dünne Wand im Laderaum gepackt. Möge es jemand Netteres finden.' });
  game.oda('Logbuch gelesen (' + txt + '). Dünne Wand? Ein Weitscan aus dem Orbit zeigt Hohlräume.', null);
  game.missionEvent('wreckLore', {});
}
function openHollow(game, p) {
  const aw = game.away;
  if (!aw.hollow || aw.hollow.open) return;
  aw.hollow.open = true;
  game.emit('sfx', { name: 'door', zone: 'away', x: aw.hollow.x * TILE + 16, y: aw.hollow.y * TILE + 16 });
  game.oda('Wand durch! Dahinter ein Hohlraum mit einem Container. Na also.', null);
  game.missionEvent('hollowOpened', {});
}

// ---------- Orbit-Unterstützung ----------
function captainSupport(game, kind) {
  const C = game.C;
  if (!anyAway(game)) return 'Kein Außenteam unten.';
  if (kind === 'sensor') {
    if (game.support.sensor > 0) return `Sensor lädt noch (${Math.ceil(game.support.sensor)} s).`;
    game.support.sensor = C.support.sensor.cooldown;
    game.away.sensorUntil = game.time + C.support.sensor.duration;
    game.oda('Sensorimpuls! Gegner unten 10 s lang sichtbar – auch durch Wände.', null);
    return null;
  }
  if (kind === 'kuppel') {
    if (game.support.kuppel > 0) return `Kuppel lädt noch (${Math.ceil(game.support.kuppel)} s).`;
    game.support.kuppel = C.support.kuppel.cooldown;
    game.away.kuppelUntil = game.time + C.support.kuppel.duration;
    game.away.kuppelHp = C.support.kuppel.absorb;
    game.oda('Schildkuppel über dem Außenteam. Kostet uns oben 2 Schildpunkte.', null);
    return null;
  }
  return 'Unbekannte Unterstützung.';
}

// Orbitalschlag nutzt die Ladung einer Phasenkanone (M1)
function weaponsStrike(game) {
  const C = game.C; const ship = game.ship;
  if (!anyAway(game)) return 'Kein Außenteam unten.';
  if (!game.away.marker) return 'Keine Markierung gesetzt (Außenteam: Q).';
  if (game.support.strike > 0) return `Orbitalschlag lädt noch (${Math.ceil(game.support.strike)} s).`;
  const m = ship.mount;
  const k = m.phase_l.charge >= 1 ? 'phase_l' : m.phase_r.charge >= 1 ? 'phase_r' : null;
  if (!k) return 'Keine Phasenkanone geladen.';
  if (ship.speed > C.ship.beamMaxSpeed) return 'Zu schnell für einen Orbitalschlag (max. 30).';
  m[k].charge = 0;
  game.support.strike = C.support.strike.cooldown;
  const mk = game.away.marker;
  game.away.pendingStrikes.push({ x: mk.x, y: mk.y, at: game.time + C.support.strike.delay });
  game.emit('sfx', { name: 'phase' });
  return null;
}

function setMarker(game, p, x, y) {
  if (p.zone !== 'away') return;
  if (!(Number.isFinite(x) && Number.isFinite(y))) return;
  const map = interior.awayInfo(game).map;
  const mx = Math.max(0, Math.min(map.w * TILE, x)), my = Math.max(0, Math.min(map.h * TILE, y));
  game.away.marker = { x: Math.round(mx), y: Math.round(my) };
  game.emit('sfx', { name: 'ui_click', zone: 'away', x: game.away.marker.x, y: game.away.marker.y });
}

function shoot(game, p, angle) {
  const C = game.C;
  if (p.zone === 'away' && combat.isV2(game)) return combat.shoot(game, p, angle);   // M2: Kampf v2 (inkl. Pistole verwundet)
  if (p.zone !== 'away' || p.downed || p.console || p.beamLock) return;
  if (!Number.isFinite(angle)) return;
  if (game.time < p.shootReadyAt) return;
  p.shootReadyAt = game.time + C.away.blaster.cooldown;
  game.away.projectiles.push({ id: game.nextId('ap'), kind: 'blaster', x: p.x, y: p.y - 10, angle, speed: C.away.blaster.speed,
    ttl: C.awayExtra.blasterTtl, dmg: C.away.blaster.damage, owner: p.id });
  game.emit('sfx', { name: 'blaster', zone: 'away', x: Math.round(p.x), y: Math.round(p.y) });
}

// ---------- Sonde ----------
function sondeInput(game, p, color) {
  const C = game.C; const s = game.away.sonde;
  if (game.away.map !== 'platform') return 'Hier gibt es keine Sonde.';
  if (s.disabled) return 'Die Sonde ist bereits abgeschaltet.';
  if (s.lockout > 0) return `Sonde gesperrt (${Math.ceil(s.lockout)} s).`;
  if (!Protocol.CODE_COLORS.includes(color)) return 'Unbekannte Farbe.';
  const expected = game.away.codeTable[s.symbols[s.entered.length]];
  if (color !== expected) {
    s.entered = []; s.lockout = C.away.codeLockout;
    game.away.alarmUntil = game.time + C.awayExtra.alarmTime;
    game.emit('codeResult', { ok: false });
    game.emit('sfx', { name: 'code_fail', zone: 'away' });
    game.oda('Falsche Farbe – Sonde 10 s gesperrt, und die Drohnen sind jetzt wach. Ups.', null);
    return null;
  }
  s.entered.push(color);
  game.emit('sfx', { name: 'ui_click', zone: 'away' });
  if (s.entered.length >= s.symbols.length) {
    s.disabled = true; game.away.doorOpen = true;
    for (const d of game.away.drones) d.alive = false;
    game.away.projectiles = game.away.projectiles.filter((q) => q.kind !== 'drone');
    game.emit('codeResult', { ok: true });
    game.emit('sfx', { name: 'code_ok', zone: 'away' });
    game.emit('sfx', { name: 'door', zone: 'away' });
    game.missionEvent('sondeDisabled', {});
  }
  return null;
}

// ---------- Update ----------
function update(game, dt) {
  const C = game.C; const away = game.away;
  for (const k of Object.keys(game.support)) game.support[k] = Math.max(0, game.support[k] - dt);
  updateBeaming(game, dt);
  if (away.sonde.lockout > 0) away.sonde.lockout = Math.max(0, away.sonde.lockout - dt);
  if (game.time >= away.kuppelUntil) away.kuppelHp = 0;
  if (!away.active) return;
  const awayPlayers = game.players.filter((p) => p.zone === 'away' && !p.downed);
  const humansAboard = game.players.some((p) => p.zone === 'ship' && p.connected);
  if (away.map === 'platform' && !away.sonde.disabled && !away.odaCodeHelp && awayPlayers.length && !humansAboard) {
    away.noHumanT += dt;
    if (away.noHumanT >= C.away.odaCodeHelpDelay) {
      away.odaCodeHelp = true;
      game.oda('Niemand an Bord? Ich funke euch die Codetabelle direkt auf die Sonde. Gern geschehen.', null);
    }
  }
  const v2 = combat.isV2(game);
  if (v2) combat.update(game, dt);
  else {
    if (awayPlayers.length || away.drones.some((d) => d.alive)) updateDrones(game, dt, awayPlayers);
    updateAwayProjectiles(game, dt);
  }
  if (away.map === 'platform') updateNpc(game, dt);
  for (const s of away.pendingStrikes.slice()) {
    if (game.time < s.at) continue;
    away.pendingStrikes.splice(away.pendingStrikes.indexOf(s), 1);
    away.strikes.push({ x: s.x, y: s.y, t: game.time });
    game.emit('strike', { x: s.x, y: s.y });
    game.emit('explosion', { x: s.x, y: s.y, zone: 'away' });
    game.emit('sfx', { name: 'strike', zone: 'away', x: s.x, y: s.y });
    for (const d of away.drones) {
      if (d.alive && dist(d.x, d.y, s.x, s.y) <= C.support.strike.radius) {
        if (v2) combat.strikeEnemy(game, d); else damageDrone(game, d, C.support.strike.damage);
      }
    }
  }
  away.strikes = away.strikes.filter((s) => game.time - s.t < 1.5);
  for (const d of away.drones) d.revealed = game.time < away.sensorUntil;
  if (v2) for (const d of away.drones) if (d.alive && d.revealed) d.vis = true;
}

function damageDrone(game, d, dmg) {
  d.hp -= dmg; d.hitT = game.time;
  if (d.hp <= 0 && d.alive) {
    d.alive = false; d.hp = 0;
    game.emit('sfx', { name: 'drone_die', zone: 'away', x: Math.round(d.x), y: Math.round(d.y) });
    game.emit('explosion', { x: Math.round(d.x), y: Math.round(d.y), zone: 'away' });
    game.missionEvent('droneKilled', { kind: d.kind });
  }
}

function updateDrones(game, dt, awayPlayers) {
  const C = game.C; const away = game.away; const cfg = C.away.drone;
  const solid = interior.awaySolid(game);
  const alarm = game.time < away.alarmUntil;
  for (const d of away.drones) {
    if (!d.alive) continue;
    let target = null, td = Infinity;
    for (const p of awayPlayers) {
      const dd = dist(d.x, d.y, p.x, p.y);
      if ((dd <= cfg.aggroRange || (alarm && dd <= cfg.aggroRange * 2.5)) && lineOfSight(solid, d.x, d.y - 8, p.x, p.y - 8) && dd < td) { td = dd; target = p; }
    }
    let mx = 0, my = 0;
    if (target) {
      if (td > C.awayExtra.droneStopDist) { mx = (target.x - d.x) / td; my = (target.y - d.y) / td; }
      d.fireT += dt;
      if (d.fireT >= cfg.fireInterval) {
        d.fireT = 0;
        const a = Math.atan2(target.y - d.y, target.x - d.x);
        away.projectiles.push({ id: game.nextId('ap'), kind: 'drone', x: d.x, y: d.y - 8, angle: a, speed: cfg.shotSpeed,
          ttl: C.awayExtra.droneShotTtl, dmg: cfg.damage });
        game.emit('sfx', { name: 'drone_shot', zone: 'away', x: Math.round(d.x), y: Math.round(d.y) });
      }
    } else {
      d.fireT = Math.min(d.fireT, cfg.fireInterval * 0.5);
      d.wanderT -= dt;
      if (!d.wander || d.wanderT <= 0) {
        const a = game.rng.range(-Math.PI, Math.PI), r = game.rng.range(0, C.awayExtra.dronePatrolRadius);
        d.wander = { x: d.home.x + Math.cos(a) * r, y: d.home.y + Math.sin(a) * r };
        d.wanderT = 2 + game.rng.range(0, 2);
      }
      const wd = dist(d.x, d.y, d.wander.x, d.wander.y);
      if (wd > 4) { mx = (d.wander.x - d.x) / wd * 0.6; my = (d.wander.y - d.y) / wd * 0.6; }
    }
    if (mx || my) {
      const res = Physics.moveWithCollision(solid, d.x, d.y, mx * cfg.speed * dt, my * cfg.speed * dt, DRONE_HITBOX);
      if (res.x === d.x && res.y === d.y) d.wanderT = 0;
      d.x = res.x; d.y = res.y;
      d.dir = Math.abs(mx) > Math.abs(my) ? (mx > 0 ? 'right' : 'left') : (my > 0 ? 'down' : 'up');
    }
  }
}

function updateAwayProjectiles(game, dt) {
  const C = game.C; const away = game.away;
  const solid = interior.awaySolid(game);
  const keep = [];
  for (const q of away.projectiles) {
    q.ttl -= dt;
    q.x += Math.cos(q.angle) * q.speed * dt; q.y += Math.sin(q.angle) * q.speed * dt;
    let hit = solid(Math.floor(q.x / TILE), Math.floor(q.y / TILE));
    if (!hit && q.kind === 'blaster') {
      for (const d of away.drones) {
        if (d.alive && dist(q.x, q.y, d.x, d.y - 8) < C.awayExtra.hitRadiusDrone) { hit = true; damageDrone(game, d, q.dmg); break; }
      }
    } else if (!hit && q.kind === 'drone') {
      for (const p of game.players) {
        if (p.zone === 'away' && !p.downed && dist(q.x, q.y, p.x, p.y - 10) < C.awayExtra.hitRadiusPlayer) { hit = true; interior.damagePlayer(game, p, q.dmg, 'drone'); break; }
      }
    }
    if (!hit && q.ttl > 0) keep.push(q);
  }
  away.projectiles = keep;
}

function updateNpc(game, dt) {
  const C = game.C; const npc = game.away.npc;
  npc.moving = false;
  if (npc.present && npc.injured) {
    const kit = game.away.items.find((i) => i.kind === 'medipack' && dist(i.x, i.y, npc.x, npc.y) <= C.awayExtra.npcKitRange);
    if (kit) {
      game.away.items.splice(game.away.items.indexOf(kit), 1);
      npc.injured = false;
      game.emit('radio', { from: 'Techniker Ivo', text: 'Ein Medipack vom Himmel! Danke, Lerche. Jetzt kann ich wieder laufen – holt mich ab!' });
      game.emit('sfx', { name: 'heal', zone: 'away', x: Math.round(npc.x), y: Math.round(npc.y) });
      game.missionEvent('npcHealed', {});
    }
    return;
  }
  if (!npc.present || npc.rescued || !npc.following) return;
  const p = game.playerById(npc.following);
  if (!p || p.zone !== 'away') { npc.following = null; return; }
  const d = dist(npc.x, npc.y, p.x, p.y);
  if (d <= C.awayExtra.npcFollowDist) { npc.path = null; return; }
  const solid = interior.awaySolid(game);
  npc.pathT -= dt;
  if (!npc.path || npc.pathT <= 0) {
    npc.pathT = 0.4;
    const st = Physics.toTile(npc.x, npc.y), pt = Physics.toTile(p.x, p.y);
    npc.path = bfs((x, y) => !solid(x, y), st, (x, y) => x === pt.x && y === pt.y, W.platform.w, W.platform.h);
  }
  if (!npc.path || !npc.path.length) {
    const s = Math.min(d, C.awayExtra.npcSpeed * dt);
    const res = Physics.moveWithCollision(solid, npc.x, npc.y, (p.x - npc.x) / d * s, (p.y - npc.y) / d * s, C.player.hitbox);
    npc.x = res.x; npc.y = res.y; npc.moving = true;
    return;
  }
  let budget = C.awayExtra.npcSpeed * dt;
  while (budget > 0 && npc.path.length) {
    const n = npc.path[0]; const c = W.tileCenter(n.x, n.y);
    const dx = c.x - npc.x, dy = c.y - npc.y; const dd = Math.hypot(dx, dy);
    if (dd > 0.01) npc.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    if (dd <= budget) { npc.x = c.x; npc.y = c.y; budget -= dd; npc.path.shift(); }
    else { npc.x += dx / dd * budget; npc.y += dy / dd * budget; budget = 0; }
  }
  npc.moving = true;
}

module.exports = {
  makeAway, makeWreck, makeKesh, canBeam, isBeaming, consoleBeam, selfBeam, executeBeam, recall, supply, captainSupport, weaponsStrike,
  setMarker, shoot, sondeInput, update, anyAway, onPad, spawnGuards, openSalvage, readLore, openHollow, beamSpot,
};
