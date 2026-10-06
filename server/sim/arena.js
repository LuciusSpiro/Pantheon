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

function start(game, kind) {
  if (kind === 'arena_away') return startAway(game);
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
    space.spawnEnemy(game, k, { tag: TAG, angle: ship.angle + off });
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

function update(game) {
  if (!game.arena) return;
  if (game.arena.kind === 'arena_space') updateSpace(game);
}

module.exports = { KINDS, TAG, isArena, start, update, objectiveText, skipWave, spawnWave, besideConsole };
