'use strict';
// Transfer (Beamen) + Außenmissionen (B-7-Plattform, Wrack „Zaunkönig“) + Orbit-Unterstützung (§6, M1 §9.4).
const Physics = require('../../shared/physics.js');
const Protocol = require('../../shared/protocol.js');
const Locations = require('../../shared/locations.js');
const W = require('../world.js');
const interior = require('./interior.js');
const combat = require('./combat.js');
const squad = require('./squad.js');
const { bfs, lineOfSight, dist, makeRng } = require('../util.js');

const TILE = Physics.TILE;
const DRONE_HITBOX = { w: 14, h: 10 };
const isDown = (st) => st === 'broken' || st === 'offline';

// kampf (B1 §0.1): 'alt' = alter Kampf (Plattform/Wrack im Tutorial), 'v2' = Kampf v2 (combat.js). Kesh und gebaute
// Karten setzen 'v2'; eine 'alt'-Karte wird beim nächsten Betreten bzw. map_reset nach dem Tutorial umgerüstet.
function baseAway(map) {
  return {
    map, kampf: 'alt', active: false, drones: [], projectiles: [],
    npc: { x: 0, y: 0, dir: 'down', following: null, rescued: false, present: false, injured: false, path: null, pathT: 0, moving: false },
    items: [], marker: null, strikes: [], pendingStrikes: [],
    sonde: { disabled: true, symbols: [], entered: [], lockout: 0 },
    codeTable: {}, odaCodeHelp: false, kuppelUntil: 0, sensorUntil: 0, doorOpen: true,
    kuppelHp: 0, alarmUntil: 0, noHumanT: 0, firstBeamAt: null, coreRebooted: false,
    salvage: [], hollow: null, loreRead: false,
  };
}

// ---------- Aufbau ----------
// opts (S2 map_reset): { salt } = anderer Code je Zurücksetzen, { noNpc } = ohne Ivo (Ivo ist längst gerettet/vermisst)
function makeAway(game, opts) {
  const o = opts || {};
  const rng = makeRng(o.salt ? ((game.seed ^ 0xC0DE ^ Math.imul(o.salt, 0x9E3779B1)) >>> 0) : game.seed ^ 0xC0DE);
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
    npc: { x: npcC.x, y: npcC.y, dir: 'down', following: null, rescued: false, present: !o.noNpc, injured: !o.noNpc, path: null, pathT: 0, moving: false },
    items: o.noCore ? [] : [{ id: 'core', kind: 'datenkern', x: qC.x, y: qC.y }],
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

// B1 §6.1: Laufzeitobjekt für einen Landepunkt mit gebauter Karte (landepunkte.js legt es als game.aways[lpId] an).
// Kampf v2, kartenneutral; Besetzung kommt über squad.spawnSquad(game, name, { map: lpId, bereich, besetzung }).
function makeLandepunkt(game, lpId) {
  const aw = baseAway(lpId);
  aw.kampf = 'v2';
  aw.zustaende = {};   // Laufzeitzustände von Kanten/Ankern (ankerId|kantenId -> zustand), steuern Tür-Kacheln
  return combat.ensureV2(game, aw, lpId);
}

// ---------- Tutorial-Schutz (B1 §0.1, E28) ----------
// Gleiche Regel wie der Faltsprung (sprung.tutorialLaeuft, CONTRACT-B3 §0.1): ohne Kampagnen-Weltstand (Direktstart,
// Golden, Tests) läuft das Tutorial immer – Plattform und Wrack behalten dort den alten Kampf.
function tutorialLaeuft(game) {
  try {
    const sp = require('./sprung.js');
    if (sp && typeof sp.tutorialLaeuft === 'function') return sp.tutorialLaeuft(game);
  } catch (e) { /* SEKTOR-Modul fehlt: eigene Prüfung */ }
  const ws = game.weltstand;
  if (!ws || !ws.persistent) return true;
  const t = ws.data && ws.data.tutorial;
  return !(t === 'uebersprungen' || t === 'erledigt');
}
// Karte mit altem Kampf nach dem Tutorial auf Kampf v2 umrüsten (beim Betreten ohne Außenteam bzw. nach map_reset)
function kampfPruefen(game, aw) {
  if (!aw || aw.kampf !== 'alt' || tutorialLaeuft(game)) return false;
  combat.ruesteV2(game, aw);
  return true;
}

// ---------- Transfer ----------
// B1 §6.1 (Wunsch ENTERN): gewählter Landepunkt mit gebauter Karte -> landepunkte.beamSpot (Lage und Reichweite, z. B.
// der Prise). Handkarten (Eintrag ohne Karte) wie bisher über scene.beam.
let lpMod;
function landepunkte() {
  if (lpMod === undefined) {
    try { lpMod = require('./landepunkte.js'); } catch (e) { if (!(e && e.code === 'MODULE_NOT_FOUND' && String(e.message).includes('landepunkte.js'))) console.error('[away] landepunkte.js:', e && e.message); lpMod = null; }
  }
  return lpMod;
}
function beamSpot(game) {
  const z = game.transferZiel;
  if (z && z.lp && W.AWAY_MAPS[z.lp] && interior.awayInfoOf(z.lp).karte) {
    const L = landepunkte();
    if (L && typeof L.beamSpot === 'function') {
      try { const sp = L.beamSpot(game); if (sp) return sp; } catch (e) { if (game.countError) game.countError('landepunkte-beamSpot', e); }
    }
  }
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
  const far = dist(ship.x, ship.y, spot.x, spot.y);
  if (far > spot.range) {
    // QA M3b: fährt das Schiff (unbesetzte Steuer behält die Stufe), ist das die eigentliche Ursache – Hinweis mitgeben
    if (ship.speed > C.ship.beamMaxSpeed) return { ok: false, tooFast: true, reason: `Zu weit vom Ziel (${Math.round(far)}, max. ${spot.range}) – das Schiff fährt weiter. Steuer: zurück und STOPP (X).` };
    return { ok: false, reason: `Zu weit vom Ziel (max. ${spot.range}).` };
  }
  // QA M3b: Die unbesetzte Steuer fährt mit ihrer Stufe weiter (§0.8) – Hinweis, wie man anhält
  if (ship.speed > C.ship.beamMaxSpeed) return { ok: false, tooFast: true, reason: `Schiff zu schnell für den Transfer (${Math.round(ship.speed)}, max. ${C.ship.beamMaxSpeed}) – Steuer auf STOPP (X = Allstopp).` };
  if (game.ship.beaming) return { ok: false, reason: 'Transfer läuft bereits.' };
  return { ok: true };
}
// QA M3b: Beamversuch scheitert am Tempo -> ODA sagt einmal je 20 s, was zu tun ist (Steuer verlassen = Schiff fährt weiter)
function tooFastHint(game) {
  if (game.ship.tooFastOdaAt != null && game.time - game.ship.tooFastOdaAt < 20) return;
  game.ship.tooFastOdaAt = game.time;
  const helmManned = game.players.some((q) => q.connected && q.console === 'helm');
  game.oda(helmManned ? 'Schiff zu schnell für den Transfer – Steuer auf Stopp, bitte!'
    : 'Schiff zu schnell für den Transfer – niemand an der Steuer, wir fahren weiter. Steuer auf Stopp (X), dann beamen.', null);
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
  if (!chk.ok) { if (chk.tooFast) tooFastHint(game); return chk.reason; }
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
    if (!game.players.some((p) => p.zone === 'away')) kampfPruefen(game, away);   // B1 §0.1: neues Betreten
    players.forEach((p, i) => { interior.placeOnAwayPad(game, p, i); p.beamLock = false; });
    if (!away.active) { away.active = true; away.firstBeamAt = game.time; }
    game.emit('beam', { pids, dir, map: away.map });
    game.emit('sfx', { name: 'beam' });
    game.missionEvent('beamedDown', { players, map: away.map });
  } else {
    // S2: NSC-Person (Ivo auf B-7 oder per spawn_person auf jeder Außenkarte) wird mit hochgebeamt, wenn sie folgt
    const npc = away.npc;
    if (npc && npc.present && !npc.rescued && npc.following && players.some((p) => dist(p.x, p.y, npc.x, npc.y) <= game.C.awayExtra.rescueRange)) {
      npc.rescued = true; npc.present = false; npc.following = null;
      if (npc.person) {
        markRescued(game, away.map, npc.person);
        game.missionEvent('npcRescued', { person: npc.person, name: npc.name, map: away.map });
      } else game.missionEvent('npcRescued', {});
    }
    if (away.map === 'platform') {
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
  const v2 = combat.isV2(game);
  for (const t of C.awayExtra.guardSpawns || []) {
    const c = W.tileCenter(t.x, t.y);
    if (v2) {   // B1 §0.1: Plattform nach dem Tutorial (Kampf v2) – Wachen als v2-Gegner, gleich alarmiert
      const e = squad.makeEnemy(game, away, 'drone', 'w' + (++n), c, 'posten');
      e.guard = true;
      away.drones.push(e);
      continue;
    }
    away.drones.push({ id: 'w' + (++n), kind: 'drone', x: c.x, y: c.y, hp: C.away.drone.hp, dir: 'down', revealed: false, alive: true,
      home: { x: c.x, y: c.y }, fireT: n * 0.5, wander: null, wanderT: 0, hitT: -9, guard: true });
  }
  away.alarmUntil = game.time + C.awayExtra.alarmTime;
  if (v2 && n) { if (!away.squads.posten) away.squads.posten = squad.newSquad('posten', n); away.squads.posten.noBark = true; squad.alertSquad(game, away, away.squads.posten); }
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
    game.explore.addLog('Wrack: Hohlraum ausgeräumt – ' + txt + '.', 'wrack', 'zaunkoenig');
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
  game.explore.addLog('Logbuch der „Zaunkönig“: „Plünderer im Anflug. Das Beste haben wir hinter die dünne Wand im Laderaum gepackt.“', 'wrack', 'zaunkoenig');
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

// Orbitalschlag nutzt eine volle Waffenladung (M1: Phasenkanone, M3a: bow/port/stbd)
function weaponsStrike(game) {
  const C = game.C; const ship = game.ship;
  if (!anyAway(game)) return 'Kein Außenteam unten.';
  if (!game.away.marker) return 'Keine Markierung gesetzt (Außenteam: Q).';
  if (game.support.strike > 0) return `Orbitalschlag lädt noch (${Math.ceil(game.support.strike)} s).`;
  // M3a §5.6: verbraucht eine volle Ladung (Lanze, sonst Batterie Bb, sonst Stb) – über space.consumeFullCharge
  if (ship.speed > C.ship.beamMaxSpeed) return 'Zu schnell für einen Orbitalschlag (max. 30).';
  const space = require('./space.js');   // spät laden (kein Zyklus beim Modulstart)
  const k = space.consumeFullCharge(game);
  if (!k) return 'Keine Waffe voll geladen.';
  game.support.strike = C.support.strike.cooldown;
  const mk = game.away.marker;
  game.away.pendingStrikes.push({ x: mk.x, y: mk.y, at: game.time + C.support.strike.delay });
  if (k === 'bow') game.emit('sfx', { name: 'lance_fire' });
  else game.emit('sfx', { name: 'battery_salvo', count: game.C.spaceM3.mounts[k].tubes });
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

// opts (B2, optional): { los: true } = Abzug losgelassen (Lanze feuert). ENGINE reicht msg.los durch.
function shoot(game, p, angle, opts) {
  const C = game.C;
  if (p.zone === 'away' && combat.isV2(game)) return combat.shoot(game, p, angle, opts);   // M2: Kampf v2 (inkl. Pistole verwundet)
  if (p.zone !== 'away' || p.downed || p.console || p.beamLock) return;
  if (!Number.isFinite(angle)) return;
  if (game.time < p.shootReadyAt) return;
  p.shootReadyAt = game.time + C.away.blaster.cooldown;
  game.away.projectiles.push({ id: game.nextId('ap'), kind: 'blaster', x: p.x, y: p.y - 10, angle, speed: C.away.blaster.speed,
    ttl: C.awayExtra.blasterTtl, dmg: C.away.blaster.damage, owner: p.id });
  game.emit('sfx', { name: 'blaster', zone: 'away', x: Math.round(p.x), y: Math.round(p.y) });
}

// FIX-ZIELEN: Blickrichtung der Spielerfigur = Zielwinkel (Mauszeiger, ganze Grad) aus der Eingabe. Fehlt er
// (Tastatur/kein Zeiger), gilt wieder die Laufrichtung (dir). Gesendet als players[].fa (Grad), nur außen.
function setAim(game, p, aim) {
  const a = aim == null ? NaN : Number(aim);
  p.facing = p.zone === 'away' && Number.isFinite(a) ? Physics.normAngle(Math.round(a) * Math.PI / 180) : null;
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
  if (away.sonde && away.sonde.lockout > 0) away.sonde.lockout = Math.max(0, away.sonde.lockout - dt);
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
  if (away.npc && away.npc.present) updateNpc(game, dt);   // S2: Person auf jeder Außenkarte (bisher nur B-7)
  else if (away.npc) away.npc.moving = false;
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
      game.emit('radio', npc.name ? { from: npc.name, text: 'Ein Medipack vom Himmel! Danke, Lerche. Jetzt kann ich wieder laufen – holt mich ab!' }
        : { from: 'Techniker Ivo', text: 'Ein Medipack vom Himmel! Danke, Lerche. Jetzt kann ich wieder laufen – holt mich ab!' });
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
    const mp = interior.awayInfo(game).map;
    npc.path = bfs((x, y) => !solid(x, y), st, (x, y) => x === pt.x && y === pt.y, mp.w, mp.h);
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

// =================================================================================================================
// S2 (CONTRACT-S2 §6, Team BAUSTEINE): Außenkarten zurücksetzen, NSC-Personen auf jeder Außenkarte
// =================================================================================================================
// Liegt die Tafel von Kesh schon beim Konkordat (Fakt aus m3 bzw. „ohne Tutorial“), an Bord oder ist m3 erledigt?
function tabletGone(game) {
  const f = game.weltstand && game.weltstand.data && game.weltstand.data.fakten;
  if (f && f.tafel_von_kesh != null && f.tafel_von_kesh !== false) return true;
  if ((game.inventory && game.inventory.tafel) >= 1) return true;
  const ms = game.mission && game.mission.missions && game.mission.missions.m3;
  return !!(ms && ms.state === 'done');
}
function wardenGone(game) {
  const f = game.weltstand && game.weltstand.data && game.weltstand.data.fakten;
  return !!(f && f.waechter_kesh === 'zerstoert');
}
// Kesh an die Weltfakten anpassen: Sockel leer (Tafel im Archiv) bzw. neuer Fund; zerstörter Wächter bleibt zerstört.
// fund = Gegenstand auf dem Sockel (Inventar-Schlüssel), null = nach Fakten
function applyKeshFacts(game, aw, fund) {
  if (!aw || !aw.tablet) return;
  if (fund) { aw.tablet.item = String(fund); aw.tablet.taken = false; aw.tablet.empty = false; }
  else if (tabletGone(game)) { aw.tablet.taken = true; aw.tablet.empty = true; aw.tablet.item = null; aw.tablet.by = null; }
  if (wardenGone(game)) for (const d of aw.drones) if (d.kind === 'warden') { d.alive = false; d.asleep = false; d.aim = null; }
}
// Nach dem Laden eines Weltstands aufrufen (ENGINE, defensiv): frisch gebaute Karten an die Fakten anpassen,
// ohne sie sonst zu verändern (Kesh-Sockel/Wächter). Ohne Fakten (Direktstart, Tests) No-op.
function applyWorldFacts(game) {
  const k = game.aways && game.aways.kesh;
  if (k && !k.active && !k.tablet.item && !k.resets) applyKeshFacts(game, k, null);
}

// Karte zurück auf Anfang. opts: { fund? (nur Kesh), datenkern? (nur Plattform, Standard true) }.
// Spieler auf der Karte kommen vorher an Bord. Liefert { ok, map, resets, moved } bzw. { ok: false, reason }.
function resetMap(game, map, opts) {
  const o = opts || {};
  const old = game.aways && game.aways[map];
  if (!old) return { ok: false, reason: 'Unbekannte Außenkarte ' + map };
  // Wer gerade auf dieser Karte steht, kommt an Bord (die Karte wird neu aufgebaut)
  let moved = 0;
  if (game.away === old) {
    if (game.ship.beaming && game.ship.beaming.dir === 'up') game.ship.beaming = null;
    const list = game.players.filter((p) => p.zone === 'away');
    list.forEach((p, i) => { if (p.downed) interior.revivePlayer(game, p); interior.placeOnShipPad(game, p, i); p.beamLock = false; p.hold = null; moved++; });
  }
  const resets = (old.resets || 0) + 1;
  game.mapResets = game.mapResets || {};
  game.mapResets[map] = resets;
  let fresh;
  if (map === 'platform') {
    fresh = makeAway(game, { salt: resets, noNpc: true, noCore: o.datenkern === false });
    // Ivo kommt nicht zurück auf die Plattform: Objekt platform.ivo bleibt 'rescued', wenn er gerettet wurde
    if (old.npc && old.npc.rescued && !old.npc.name) fresh.npc.rescued = true;
  } else if (map === 'wreck') {
    fresh = makeWreck(game);
    // Den Hohlraum kennt die Crew schon (Weitscan): die Wand bleibt markiert
    const hid = Locations.LOCATIONS.flatMap((l) => l.hidden || []).find((h) => h.kind === 'hollow');
    if (hid && game.explore && game.explore.isRevealed && game.explore.isRevealed(hid.id)) fresh.hollow.marked = true;
  } else if (map === 'kesh') {
    fresh = makeKesh(game);
    fresh.rng = makeRng(((game.seed ^ 0x5C0B1) + Math.imul(resets, 0x9E3779B1)) >>> 0);
    applyKeshFacts(game, fresh, o.fund || null);
  } else return { ok: false, reason: 'Karte ' + map + ' kann nicht zurückgesetzt werden' };
  kampfPruefen(game, fresh);   // B1 §0.1: nach dem Tutorial gilt nach map_reset Kampf v2
  fresh.resets = resets;
  game.aways[map] = fresh;
  if (game.away === old) game.away = fresh;
  game.emit('mapReset', { map });
  return { ok: true, map, resets, moved };
}

// NSC-Person auf eine Außenkarte setzen (Kachel tile). opts: { person (Kennung, Pflicht), name (Anzeige), injured }.
// Ersetzt eine frühere Person dieser Karte (je Karte eine; Ivo ist die namenlose Person von B-7 und bleibt unberührt,
// solange kein Regiebuch eine Person auf B-7 setzt).
function spawnPerson(game, map, tile, opts) {
  const aw = game.aways && game.aways[map];
  const o = opts || {};
  if (!aw || !tile || !o.person) return false;
  const c = W.tileCenter(tile.x, tile.y);
  aw.npc = { x: c.x, y: c.y, dir: 'down', following: null, rescued: false, present: true, injured: !!o.injured, path: null, pathT: 0, moving: false,
    person: String(o.person), name: String(o.name || o.person), met: false };
  return true;
}
function markRescued(game, map, person) {
  game.rescuedPersons = game.rescuedPersons || [];
  const key = map + ':' + person;
  if (!game.rescuedPersons.includes(key)) game.rescuedPersons.push(key);
}
function personRescued(game, map, person) {
  if ((game.rescuedPersons || []).includes(map + ':' + person)) return true;
  const a = game.aways && game.aways[map];
  return !!(a && a.npc && a.npc.person === person && a.npc.rescued);
}
// Zustand einer Person: 'injured' | 'ok' | 'following' | 'rescued' | null (nicht auf der Karte)
function personState(game, map, person) {
  if (personRescued(game, map, person)) return 'rescued';
  const a = game.aways && game.aways[map];
  if (!a || !a.npc || a.npc.person !== person || !a.npc.present) return null;
  return a.npc.injured ? 'injured' : a.npc.following ? 'following' : 'ok';
}

module.exports = {
  resetMap, spawnPerson, markRescued, personRescued, personState, applyWorldFacts, applyKeshFacts, tabletGone,
  baseAway, makeLandepunkt, tutorialLaeuft, kampfPruefen,
  makeAway, makeWreck, makeKesh, canBeam, isBeaming, consoleBeam, selfBeam, executeBeam, recall, supply, captainSupport, weaponsStrike,
  setMarker, shoot, setAim, sondeInput, update, anyAway, onPad, spawnGuards, openSalvage, readLore, openHollow, beamSpot, tooFastHint,
};
