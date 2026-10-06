'use strict';
// Leben an Bord (M1): Planungstisch mit Pins (§8) und Techniker Ivo im Gästequartier (§1 Studio, §7).
const Physics = require('../../shared/physics.js');
const W = require('../world.js');
const { bfs, dist } = require('../util.js');

// ---------- Planungstisch ----------
function seated(game) { return game.players.filter((p) => p.console === 'plan' && p.connected).map((p) => p.id); }

function pin(game, p, msg) {
  const C = game.C;
  const label = String(msg.label || '');
  if (!C.plan.labels.includes(label)) return 'Unbekanntes Pin-Label.';
  const map = String(msg.map || '');
  if (map !== 'star' && !(map in game.explore.mapsKnown)) return 'Unbekannte Karte.';
  if (map !== 'star' && !game.explore.mapsKnown[map]) return 'Diese Karte ist noch nicht gescannt.';
  const x = Number(msg.x), y = Number(msg.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 'Ungültige Position.';
  const mine = game.plan.pins.filter((q) => q.owner === p.id);
  if (mine.length >= C.plan.maxPins) return `Maximal ${C.plan.maxPins} Pins – erst einen eigenen entfernen.`;
  const lim = map === 'star' ? { w: 900, h: 600 } : { w: W.AWAY_MAPS[map].map.w * 32, h: W.AWAY_MAPS[map].map.h * 32 };
  game.plan.pins.push({ id: 'pin' + (++game.plan.seq), owner: p.id, color: p.color, map,
    x: Math.round(Math.max(0, Math.min(lim.w, x))), y: Math.round(Math.max(0, Math.min(lim.h, y))), label });
  game.emit('sfx', { name: 'marker_set', zone: 'ship' });
  game.missionEvent('pinned', { label });
  return null;
}
function unpin(game, p, id) {
  const i = game.plan.pins.findIndex((q) => q.id === id);
  if (i < 0) return 'Pin nicht gefunden.';
  if (game.plan.pins[i].owner !== p.id) return 'Nur eigene Pins lassen sich entfernen.';
  game.plan.pins.splice(i, 1);
  return null;
}

// ---------- Ivo an Bord ----------
// Wegpunkte: Gästequartier, Messe, Planungstisch, Gang, Maschinenraum-Tür (er schraubt gern).
const IVO_SPOTS = [{ x: 20, y: 9 }, { x: 21, y: 10 }, { x: 25, y: 9 }, { x: 28, y: 5 }, { x: 25, y: 4 }, { x: 18, y: 6 }, { x: 8, y: 6 }, { x: 20, y: 9 }];

function updateIvo(game, dt) {
  if (!game.mission.flags.technikerRescued) { game.ivo = null; return; }
  if (!game.ivo) {
    const c = W.tileCenter(20, 9);
    game.ivo = { id: 'ivo', x: c.x, y: c.y, dir: 'down', moving: false, path: null, waitT: 3, spot: 0 };
    game.oda('Ivo ist ins Gästequartier gezogen. Er sagt, das Bett ist besser als die Plattform. Hohe Messlatte.', 'ivoMovedIn');
  }
  const v = game.ivo;
  v.moving = false;
  if (v.waitT > 0) { v.waitT -= dt; return; }
  if (!v.path) {
    v.spot = (v.spot + 1) % IVO_SPOTS.length;
    const goal = IVO_SPOTS[v.spot];
    v.path = bfs(W.shipWalkable, Physics.toTile(v.x, v.y), (x, y) => x === goal.x && y === goal.y, W.ship.w, W.ship.h) || [];
  }
  if (!v.path.length) { v.path = null; v.waitT = 4 + game.rng.range(0, 5); return; }
  let budget = 55 * dt;
  while (budget > 0 && v.path.length) {
    const n = v.path[0]; const c = W.tileCenter(n.x, n.y);
    const dx = c.x - v.x, dy = c.y - v.y; const d = Math.hypot(dx, dy);
    if (d > 0.01) v.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    if (d <= budget) { v.x = c.x; v.y = c.y; budget -= d; v.path.shift(); } else { v.x += dx / d * budget; v.y += dy / d * budget; budget = 0; }
  }
  v.moving = true;
}

function npcsSnapshot(game) {
  const v = game.ivo;
  return v ? [{ id: 'ivo', x: Math.round(v.x * 10) / 10, y: Math.round(v.y * 10) / 10, dir: v.dir, moving: v.moving }] : [];
}

module.exports = { seated, pin, unpin, updateIvo, npcsSnapshot, dist };
