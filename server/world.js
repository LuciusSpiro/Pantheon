'use strict';
// Statische Weltdaten, einmal aus shared/maps.js abgeleitet (Systempunkte, Konsolen, Regale, Bereiche, Außenkarten).
const Maps = require('../shared/maps.js');
const Physics = require('../shared/physics.js');
const Locations = require('../shared/locations.js');

const ship = Maps.ship;
const platform = Maps.platform;
const wreck = Maps.wreck;

function findAll(map, pred) {
  const out = [];
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (pred(map.at(x, y), x, y)) out.push({ x, y });
  return out;
}

const SYSTEM_TILES = {};   // system -> {x,y} (erste Kachel des Systems, Altname)
const CONSOLE_TILES = {};  // console -> [{x,y}]
// M3a: alle Stationskacheln aus der Legende (mehrere Kacheln je System möglich). sector/side aus der Legende;
// fehlt das (alte Legende), Sektor aus dem Raum (Maps.roomAt), side null.
const STATIONS = [];       // [{ system, x, y, sector, side }]
for (const t of findAll(ship, (ch) => !!ship.legend[ch])) {
  const info = ship.info(t.x, t.y);
  if (info.system) {
    if (!SYSTEM_TILES[info.system]) SYSTEM_TILES[info.system] = t;
    const room = Maps.roomAt ? Maps.roomAt(t.x, t.y) : null;
    STATIONS.push({ system: info.system, x: t.x, y: t.y,
      sector: info.sector != null ? info.sector : (room && room.sector != null ? room.sector : -1),
      side: info.side || null });
  }
  if (info.console) (CONSOLE_TILES[info.console] = CONSOLE_TILES[info.console] || []).push(t);
}
// Regale aus dem Schiffslayout ({x,y,item,access}), Reihenfolge = Regal 1..5
const SHELF_TILES = Maps.SHELF_TILES.map((s) => ({ x: s.x, y: s.y, item: s.item, access: s.access ? { x: s.access.x, y: s.access.y } : null }));
const SHIP_PADS = findAll(ship, (ch) => (ship.legend[ch] || {}).kind === 'pad');   // M3a: über die Legende statt Zeichen
const PLATFORM_PADS = Maps.PLATFORM_PADS.slice();
const SONDE_TILE = platform.find('Z')[0];
const NPC_SPAWN = platform.find('N')[0];
const DATENKERN_SPAWN = platform.find('Q')[0];
const DRONE_SPAWNS = platform.find('d');
const PLATFORM_DOORS = platform.find('L');
const REACTOR_SWITCHES = Maps.REACTOR_SWITCHES.slice();

// M1: Außenkarten (Beamen je Ort, shared/locations.js scene.beam.map)
const AWAY_MAPS = {
  platform: { id: 'platform', map: platform, pads: PLATFORM_PADS },
  wreck: { id: 'wreck', map: wreck, pads: Maps.WRECK_PADS.slice(),
    salvage: wreck.find('h'), lore: wreck.find('g'), hollow: wreck.find('V')[0], scavengers: wreck.find('a') },
};

// M2 „Schildwall“: Mond Kesh (Kampf v2, CONTRACT-M2 §2/§3.1). Deckungsplätze einmal vorberechnet (§5):
// begehbare Kacheln mit einer Deckungskachel (info.cover) in der 8er-Nachbarschaft, ohne Kartenrand/Pads.
const kesh = Maps.kesh;
function keshCoverSpots() {
  const out = [];
  const pads = new Set(Maps.KESH_PADS.map((p) => p.x + ',' + p.y));
  for (let y = 1; y < kesh.h - 1; y++) for (let x = 1; x < kesh.w - 1; x++) {
    if (kesh.solid(x, y) || pads.has(x + ',' + y)) continue;
    let best = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const info = kesh.info(x + dx, y + dy);
      if (info.cover && info.kind !== 'vault_gate') best = Math.max(best, info.cover);
    }
    if (best) out.push({ x, y, cover: best });
  }
  return out;
}
AWAY_MAPS.kesh = {
  id: 'kesh', map: kesh, pads: Maps.KESH_PADS.slice(), combat: 'v2',
  jammers: kesh.find('r'), keys: kesh.find('k'), gate: kesh.find('G'), tablet: kesh.find('T')[0],
  spawns: { warden: kesh.find('L'), squad1: kesh.find('a'), squad2: kesh.find('b'), rearguard: kesh.find('c'),
    // QA M2: Verstärkung nach dem ersten Störrelais (je ein Plünderer an den Korridor-Enden Nord und Süd)
    relief: [kesh.find('b')[0], kesh.find('b')[2]] },
  coverSpots: keshCoverSpots(),
};

// ---------- B1 (BUEHNE, CONTRACT-B1 §6.1): AWAY_MAPS als Registry ----------
// Handkarten (platform, wreck, kesh) bleiben feste Einträge. Gebaute Karten (Vertrag `Karte`) registriert
// server/sim/landepunkte.js als { id, karte, combat: 'v2' }; ihre Bereiche (Rechtecklisten) landen in Maps.MAP_AREAS[id],
// damit Maps.inArea (team_im_bereich, area_occupied) sie kennt. Höchstens 2 gebaute Karten liegen gleichzeitig hier (LRU).
const HAND_IDS = ['platform', 'wreck', 'kesh'];
const istHand = (id) => HAND_IDS.includes(id);
function register(id, karte) {
  if (istHand(id)) throw new Error(`world.register: ${id} ist eine Handkarte`);
  if (!karte || !Array.isArray(karte.rows)) throw new Error(`world.register: ${id} ohne Karte`);
  const e = { id, karte, combat: 'v2' };
  AWAY_MAPS[id] = e;
  const areas = {};
  for (const bid of Object.keys(karte.bereiche || {}).sort()) {
    const b = karte.bereiche[bid];
    areas[bid] = { rects: (b.rects || []).map((r) => r.slice()), rolle: b.rolle || null, gefecht: !!b.gefecht };
  }
  Maps.MAP_AREAS[id] = areas;
  return e;
}
function unregister(id) {
  if (istHand(id) || !AWAY_MAPS[id]) return false;
  delete AWAY_MAPS[id];
  delete Maps.MAP_AREAS[id];
  return true;
}
function registered() { return Object.keys(AWAY_MAPS).filter((id) => !istHand(id)).sort(); }

const floorWalkable = (map) => (x, y) => !map.solid(x, y);
const shipWalkable = floorWalkable(ship);

// Bodenkacheln je Schildsektor-Bereich (für Feuer) und wandnahe Bodenkacheln (für Hüllenbrüche).
const SHIP_FLOORS = findAll(ship, (ch, x, y) => !ship.solid(x, y));
function isOuterWallAdjacent(x, y) {
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const ch = ship.at(x + dx, y + dy);
    if (ch === '#' || ch === ' ') return true;
  }
  return false;
}
// M4: Feuer/Lecks nur auf Deck I und nie auf Lift oder Leiter (Maps.hazardAllowed)
const hazardAllowed = (x, y) => (Maps.hazardAllowed ? Maps.hazardAllowed(x, y) : !ship.solid(x, y));
const REGION_FLOORS = Maps.SECTOR_REGIONS.map((r) => SHIP_FLOORS.filter((t) => r.test(t.x, t.y) && hazardAllowed(t.x, t.y)));
const REGION_WALL_FLOORS = Maps.SECTOR_REGIONS.map((r, i) => {
  const list = REGION_FLOORS[i].filter((t) => isOuterWallAdjacent(t.x, t.y) && ship.info(t.x, t.y).kind !== 'pad');
  return list.length ? list : REGION_FLOORS[i];
});

// Begehbare Nachbarkachel eines (soliden) Objekts – für Bots/Agenten.
function accessTiles(map, walkable, tx, ty) {
  const out = [];
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) if (walkable(tx + dx, ty + dy)) out.push({ x: tx + dx, y: ty + dy });
  return out;
}

// Quartier einer Kachel – für Stile/Licht. Rückgabe wie bisher: Quartier-ID ('q0'..'q3') oder null.
// M3a: stützt sich auf Maps.roomAt (Räume mit kind 'quarter'); Fallback auf BEDS[].room.
function roomAt(tx, ty) {
  if (Maps.roomAt) { const r = Maps.roomAt(tx, ty); return r && r.kind === 'quarter' ? r.id : null; }
  for (const b of Maps.BEDS) { const r = b.room; if (tx >= r.x0 && tx <= r.x1 && ty >= r.y0 && ty <= r.y1) return r.id; }
  return null;
}

const tileCenter = Physics.tileCenter;

// M4 §2.4: Deck-Übergänge als BFS-Kanten für bfs(…, links). Bots: nur Lift; Spieler-Agenten (Tools) dürfen auch die Leiter.
const deckOf = (ty) => (Maps.deckOf ? Maps.deckOf(ty) : 0);
const liftLinks = (x, y) => (Maps.deckLinks ? Maps.deckLinks(x, y, { ladder: false }) : []);
const deckLinksAll = (x, y) => (Maps.deckLinks ? Maps.deckLinks(x, y) : []);

module.exports = {
  Maps, Locations, ship, platform, wreck, kesh, SYSTEM_TILES, STATIONS, CONSOLE_TILES, SHELF_TILES, SHIP_PADS, PLATFORM_PADS, SONDE_TILE,
  NPC_SPAWN, DATENKERN_SPAWN, DRONE_SPAWNS, PLATFORM_DOORS, REACTOR_SWITCHES, AWAY_MAPS, SHIP_FLOORS, REGION_FLOORS, REGION_WALL_FLOORS,
  shipWalkable, accessTiles, tileCenter, findAll, roomAt,
  hazardAllowed, deckOf, liftLinks, deckLinksAll,
  // B1 (BUEHNE): Registry gebauter Karten
  HAND_IDS, istHand, register, unregister, registered,
};
