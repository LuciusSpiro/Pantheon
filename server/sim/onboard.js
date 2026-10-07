'use strict';
// Leben an Bord (M1): Planungstisch mit Pins (§8) und Techniker Ivo im Gästequartier (§1 Studio, §7).
const Physics = require('../../shared/physics.js');
const Locations = require('../../shared/locations.js');
const W = require('../world.js');
const { bfs, dist } = require('../util.js');

// ---------- Planungstisch ----------
function seated(game) { return game.players.filter((p) => p.console === 'plan' && p.connected).map((p) => p.id); }

function pin(game, p, msg) {
  const C = game.C;
  const label = String(msg.label || '');
  if (!C.plan.labels.includes(label)) return 'Unbekanntes Pin-Label.';
  const map = String(msg.map || '');
  // Karten: 'star' (Übersicht), Decksplan (platform/wreck/kesh, erst nach Scan) oder Detailkarte eines Orts (Orts-ID,
  // sichtbar auf der Sternkarte). Fehler vorher: Orts-IDs wurden als „Unbekannte Karte.“ abgelehnt.
  const ex = game.explore;
  // 'kesh' ist Orts-ID und Decksplan zugleich: vor dem Scan gilt die Detailkarte (Szene), danach der Archivplan
  const loc = map !== 'star' && !(map in ex.mapsKnown && ex.mapsKnown[map]) ? Locations.get(map) : null;
  if (map !== 'star' && !(map in ex.mapsKnown) && !(loc && loc.id === map)) return 'Unbekannte Karte.';
  if (map in ex.mapsKnown && !ex.mapsKnown[map] && !(loc && loc.id === map)) return 'Diese Karte ist noch nicht gescannt.';
  if (loc && !(ex.shown ? ex.shown(map) : ex.isKnown(map))) return 'Dieser Ort ist noch unbekannt.';
  if (!loc && map !== 'star' && !ex.mapsKnown[map]) return 'Diese Karte ist noch nicht gescannt.';
  const x = Number(msg.x), y = Number(msg.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 'Ungültige Position.';
  const mine = game.plan.pins.filter((q) => q.owner === p.id);
  if (mine.length >= C.plan.maxPins) return `Maximal ${C.plan.maxPins} Pins – erst einen eigenen entfernen.`;
  const lim = map === 'star' ? { w: 900, h: 600 }
    : loc ? { w: (loc.scene && loc.scene.w) || 3000, h: (loc.scene && loc.scene.h) || 2000 }
      : { w: W.AWAY_MAPS[map].map.w * 32, h: W.AWAY_MAPS[map].map.h * 32 };
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
// Wegpunkte: Gästequartier, Messe, Planungstisch, Gang, Maschinenraum (er schraubt gern).
// M3a: aus dem Schiffslayout abgeleitet (Maps.IVO_SPOTS, falls die Karte sie vorgibt; sonst aus SHIP_ROOMS/BEDS/Konsolen).
function roomFloor(match, nth) {
  const rooms = (W.Maps.SHIP_ROOMS || []).filter(match);
  const out = [];
  for (const r of rooms) {
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    const tiles = [];
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      if (!W.shipWalkable(x, y) || W.Maps.roomAt(x, y) !== r) continue;
      tiles.push({ x, y, d: Math.abs(x - cx) + Math.abs(y - cy) });
    }
    tiles.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
    if (tiles.length) out.push(tiles[Math.min(nth || 0, tiles.length - 1)]);
  }
  return out[0] ? { x: out[0].x, y: out[0].y } : null;
}
function deriveIvoSpots() {
  if (Array.isArray(W.Maps.IVO_SPOTS) && W.Maps.IVO_SPOTS.length) return W.Maps.IVO_SPOTS.map((s) => ({ x: s.x, y: s.y }));
  const guestBed = (W.Maps.BEDS || []).find((b) => b.color === 3);
  const guestId = guestBed && guestBed.room ? guestBed.room.id : null;
  const guest = roomFloor((r) => r.id === guestId, 0);
  const guest2 = roomFloor((r) => r.id === guestId, 1);
  const plan = (W.CONSOLE_TILES.plan || [])[0];
  const planAccess = plan ? W.accessTiles(W.ship, W.shipWalkable, plan.x, plan.y)[0] : null;
  const list = [guest, guest2, roomFloor((r) => r.id === 'messe', 3), planAccess, roomFloor((r) => r.id === 'gang', 0),
    roomFloor((r) => r.kind === 'engine', 0), guest].filter(Boolean);
  if (!list.length) list.push(W.Maps.SHIP_SPAWNS[0]);
  return list;
}
const IVO_SPOTS = deriveIvoSpots();

function updateIvo(game, dt) {
  if (!game.mission.flags.technikerRescued) { game.ivo = null; return; }
  if (!game.ivo) {
    const c = W.tileCenter(IVO_SPOTS[0].x, IVO_SPOTS[0].y);
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
