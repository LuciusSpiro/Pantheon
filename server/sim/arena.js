'use strict';
// Testgelände (Lobby-Start 'arena_space' / 'arena_away'): direkter Einstieg in einen Kampfbereich, ohne Debug-Rechte,
// solo wie zu dritt. Kampagne und Direktstart m3 bleiben unberührt.
//  - arena_space: Schiff abgelegt in einer Szene ohne Brocken (CONFIG.arena.spaceScene), Crew auf der Brücke,
//    Pseudo-Mission „Testgelände: Raumkampf“ mit Gegnerwellen (zyklisch). Nächste Welle CONFIG.arena.nextWaveDelay s
//    nach der Räumung. Schaden, Bots, Notfallprotokoll wie im Spiel.
//  - arena_away: Mission m3 direkt auf Schritt 'courtyard', alle Spieler auf den Kesh-Pads, Schiff in Transferreichweite.
const W = require('../world.js');
const Locations = require('../../shared/locations.js');
const interior = require('./interior.js');
const space = require('./space.js');
const away = require('./away.js');

const TAG = 'arena';
const KINDS = ['arena_space', 'arena_away'];
const ENEMY_NAMES = { raider: 'Jäger', gunboat: 'Kanonenboot', sentinel: 'Kustoden-Wächter', pylon: 'Pylon', relay: 'Störrelais' };

function isArena(kind) { return KINDS.includes(kind); }
function cfg(game) { return game.C.arena; }

function start(game, kind, params) {
  if (kind === 'arena_away') return params && params.art ? startAwayBuehne(game, params) : startAway(game);
  return startSpace(game);
}

// Szene ohne Brocken: die Ortsliste darf gleich im ersten Snapshot mit (sonst zeigt die Ankunftsanzeige kurz
// „Unbekanntes Signal“, weil Asteroiden und Ortsliste nie im selben Snapshot reisen).
function worldFirst(game) {
  if (!game.space.asteroids.length) game.asteroidsDirty = false;
}

// ---------- Raumkampf ----------
// Begehbare Nachbarkachel einer Konsole (Brücke) – dort steht der Spieler, E setzt ihn an die Konsole.
function besideConsole(name, n) {
  const tiles = W.CONSOLE_TILES[name] || [];
  for (const t of tiles) {
    const acc = W.accessTiles(W.ship, W.shipWalkable, t.x, t.y);
    if (acc.length) return acc[Math.min(n || 0, acc.length - 1)];
  }
  return null;
}

function placeOnBridge(game) {
  const order = ['helm', 'weapons', 'captain'];
  game.players.forEach((p, i) => {
    if (p.zone !== 'ship') interior.placeOnShipPad(game, p);
    if (p.console) interior.leaveConsole(game, p);
    const t = besideConsole(order[i % order.length], Math.floor(i / order.length));
    if (!t) return;
    const c = W.tileCenter(t.x, t.y);
    p.x = c.x; p.y = c.y; p.dir = 'down'; p.moving = false;
  });
}

// M3a §15: Beim Start ist das Schiff unbeschädigt (alle Systeme ok, nicht fragil, Hülle/O₂ voll, Schilde voll).
function repairShip(game) {
  const ship = game.ship; const C = game.C;
  for (const k of Object.keys(ship.systems)) {
    const d = Object.getOwnPropertyDescriptor(ship.systems, k);
    if (d && d.writable) ship.systems[k] = 'ok';   // 'weapons' ist bei SERVER-SHIP ein Getter
  }
  ship.offline = {};
  ship.fragile = {};
  if (Array.isArray(ship.repairQueue)) ship.repairQueue = [];
  ship.fireList = []; ship.breachList = [];
  ship.hull = ship.hullMax; ship.o2 = C.o2.max;
  for (const k of Object.keys(ship.heat)) ship.heat[k] = 0;
  if (ship.reactorCtl.state === 'offline') space.reactorOnline(game, 'Testgelände: Reaktor läuft.');
  ship.shields.current = ship.shields.alloc.slice();
  ship.sysHitAt = {};
}

function startSpace(game) {
  const A = cfg(game);
  const ex = game.explore;
  const loc = Locations.get(A.spaceScene) ? A.spaceScene : 'hafen';
  // Ort still bekannt/besucht machen (keine Erstbesuch-Ansage, keine Marken)
  if (!ex.known.has(loc)) { ex.known.add(loc); ex.version++; }
  if (!ex.visited.has(loc)) { ex.visited.add(loc); ex.version++; }
  space.enterScene(game, loc, { docked: false });
  const ship = game.ship;
  ship.x = A.shipPos.x; ship.y = A.shipPos.y; ship.angle = A.shipPos.angle;
  ship.vx = 0; ship.vy = 0; ship.speed = 0;
  repairShip(game);
  worldFirst(game);
  placeOnBridge(game);
  game.arena = { kind: 'arena_space', wave: 0, round: 1, active: false, nextAt: game.time + A.firstWaveAt, cleared: 0 };
  game.mission.startMission('arena_space');
  game.oda('Testgelände Raumkampf! Kein Auftrag, nur Gegner. Steuer, Taktik und Captain stehen bereit.', null);
  game.log('Testgelände Raumkampf gestartet.');
}

function waveDef(game, n) {
  const W8 = cfg(game).waves;
  return W8[(n - 1) % W8.length];
}

function arenaEnemies(game) { return game.space.enemies.filter((e) => e.tag === TAG); }

function describe(kinds) {
  const cnt = {};
  for (const k of kinds) cnt[k] = (cnt[k] || 0) + 1;
  return Object.entries(cnt).map(([k, n]) => (n > 1 ? n + '× ' : '') + (ENEMY_NAMES[k] || k)).join(', ');
}

function spawnWave(game) {
  const a = game.arena; const A = cfg(game); const ship = game.ship;
  a.wave++;
  a.round = Math.floor((a.wave - 1) / A.waves.length) + 1;
  const kinds = waveDef(game, a.wave);
  kinds.forEach((k, i) => {
    const off = (i - (kinds.length - 1) / 2) * A.spawnSpread;
    if (k === 'pylon' && A.pylonAt) {
      // M3a §15: Pylon an fester Position (relativ zum Startpunkt des Testgeländes)
      const x = A.shipPos.x + A.pylonAt.dx, y = A.shipPos.y + A.pylonAt.dy;
      space.spawnEnemy(game, k, { tag: TAG, x, y, facing: Math.atan2(ship.y - y, ship.x - x) });
    } else space.spawnEnemy(game, k, { tag: TAG, angle: ship.angle + off });
  });
  a.active = true; a.nextAt = null;
  game.oda(`Welle ${a.wave}: ${describe(kinds)} im Anflug!`, null);
  game.emit('sfx', { name: 'alarm_red' });
}

function updateSpace(game) {
  const a = game.arena;
  if (game.phase !== 'play') return;
  if (a.active) {
    if (arenaEnemies(game).length) return;
    a.active = false; a.cleared++;
    a.nextAt = game.time + cfg(game).nextWaveDelay;
    game.oda(`Welle ${a.wave} geräumt! Nächste Welle in ${cfg(game).nextWaveDelay} s – kurz reparieren.`, null);
    return;
  }
  if (a.nextAt != null && game.time >= a.nextAt) spawnWave(game);
}

// Zielanzeige der Pseudo-Mission (Mission.tpl {arena})
function objectiveText(game) {
  const a = game.arena;
  if (!a || a.kind !== 'arena_space') return '';
  if (a.active) return `Welle ${a.wave}: Gegner ausschalten (${arenaEnemies(game).length} übrig)`;
  const left = a.nextAt != null ? Math.max(0, Math.ceil(a.nextAt - game.time)) : 0;
  return `Welle ${a.wave + 1} kommt in ${left} s` + (a.cleared ? ` (${a.cleared} geräumt)` : '');
}

// Debug `skip`: aktuelle Welle entfernen bzw. nächste sofort rufen
function skipWave(game) {
  const a = game.arena;
  if (!a || a.kind !== 'arena_space') return;
  if (a.active) game.space.enemies = game.space.enemies.filter((e) => e.tag !== TAG);
  else a.nextAt = game.time;
}

// ---------- Außenteam (Kesh) ----------
function startAway(game) {
  const A = cfg(game);
  const err = game.mission.forceStep('m3', 'courtyard');   // reveal Kesh, Schiff nach Kesh, Trupp 1
  if (err) { game.countError('arena', new Error(err)); return; }
  const ship = game.ship; const loc = Locations.get('kesh');
  const st = loc.scene.station;
  ship.x = st.x - A.keshShipOffset; ship.y = st.y; ship.angle = 0;
  ship.vx = 0; ship.vy = 0; ship.speed = 0;
  game.setAwayMap('kesh');
  worldFirst(game);
  const team = game.players.filter((p) => p.connected);
  for (const p of team) { if (p.console) interior.leaveConsole(game, p); if (p.downed) interior.revivePlayer(game, p); }
  if (team.length) away.executeBeam(game, team.map((p) => p.id), 'down');
  game.arena = { kind: 'arena_away' };
  game.oda('Testgelände Außenteam: direkt auf Kesh. Wer Captain spielen will, beamt hoch (Pads, E halten).', null);
  game.log('Testgelände Außenteam gestartet.');
}

// ---------- B1 §4: Direktstart Testgelände auf einer gebauten Karte (Karten-QA) ----------
// params: { art, schablone?, seed, bauweise, besitz, zustand, fraktion?, staerke?, haltung? } (Protocol.ARENA_AWAY_FIELDS).
// Bauen und Landepunkt anlegen macht landepunkte.js (BUEHNE): testgelaende(game, params) -> lpId bzw. neu(game, ort, params).
const ARENA_ORT = 'kesh';
function lpMod() { try { const m = require('./landepunkte.js'); return m && !m.stub ? m : null; } catch (e) { return null; } }
function startAwayBuehne(game, params) {
  const L = lpMod();
  let lp = null;
  try {
    if (L && typeof L.testgelaende === 'function') lp = L.testgelaende(game, params);
    else if (L && typeof L.neu === 'function') lp = L.neu(game, ARENA_ORT, params);
  } catch (e) { game.countError('arena-buehne', e); }
  if (lp && typeof lp === 'object') lp = lp.id || lp.lpId || null;
  if (!lp || !game.aways[lp]) {
    if (L && typeof L.get === 'function' && lp) { try { L.get(game, lp); } catch (e) { game.countError('arena-buehne', e); } }
  }
  if (!lp || !game.aways[lp]) {
    game.oda('Testgelände: Diese Karte lässt sich (noch) nicht bauen – zurück nach Kesh.', null);
    game.countError('arena-buehne', new Error('Landepunkt für ' + JSON.stringify(params) + ' nicht angelegt'));
    return startAway(game);
  }
  const ex = game.explore;
  if (!ex.known.has(ARENA_ORT)) { ex.known.add(ARENA_ORT); ex.version++; }
  if (!ex.visited.has(ARENA_ORT)) { ex.visited.add(ARENA_ORT); ex.version++; }
  space.enterScene(game, ARENA_ORT, { docked: false });
  const ship = game.ship; const st = Locations.get(ARENA_ORT).scene.station || { x: 1200, y: 900 };
  ship.x = st.x - cfg(game).keshShipOffset; ship.y = st.y; ship.angle = 0; ship.vx = 0; ship.vy = 0; ship.speed = 0;
  repairShip(game);
  game.transferZiel = { lp, scene: ship.scene };
  game.setAwayMap(lp);
  worldFirst(game);
  if (params.fraktion) {
    let besetzen = null;
    for (const n of ['./combat.js', './squad.js']) { try { const m = require(n); if (m && typeof m.besetzen === 'function') { besetzen = m.besetzen; break; } } catch (e) { /* weiter */ } }
    const opts = { map: lp, bereich: null, fraktion: params.fraktion, staerke: params.staerke || 'mittel', haltung: params.haltung || 'ruhig', tag: 'arena', neue_rolle: null };
    if (besetzen) { try { besetzen(game, opts); } catch (e) { game.countError('arena-besetzen', e); } } else game.countError('arena-besetzen', new Error('besetzen fehlt (BODENKAMPF)'));
  }
  const team = game.players.filter((p) => p.connected);
  for (const p of team) { if (p.console) interior.leaveConsole(game, p); if (p.downed) interior.revivePlayer(game, p); }
  if (team.length) away.executeBeam(game, team.map((p) => p.id), 'down');
  game.arena = { kind: 'arena_away', lp, params: Object.assign({}, params) };
  game.oda(`Testgelände: ${params.art} (Seed ${params.seed}, ${params.bauweise || 'Standard'}, ${params.besitz || '–'}, ${params.zustand || 'intakt'}).`, null);
  game.log(`Testgelände Außenteam auf ${lp} gestartet (${JSON.stringify(params)}).`);
}

function update(game) {
  if (!game.arena) return;
  if (game.arena.kind === 'arena_space') updateSpace(game);
}

module.exports = { KINDS, TAG, isArena, start, update, objectiveText, skipWave, spawnWave, besideConsole };
