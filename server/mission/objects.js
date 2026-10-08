'use strict';
// S1 (CONTRACT-S1 §3.4): Objekte und Bereiche der Außenkarten für Regiebücher.
// Liest Maps.MAP_OBJECTS / MAP_AREAS (Studioleitung) und bildet Zustände auf die bestehenden Laufzeitstrukturen ab
// (game.aways.<karte>). combat.js / away.js werden nicht umgebaut – nur gelesen bzw. über ihre Funktionen gesetzt.
// Ohne Server nutzbar (Prüfer): schwere Module werden erst beim Setzen geladen.
const Maps = require('../../shared/maps.js');
const Locations = require('../../shared/locations.js');

const TILE = Maps.TILE || 32;

// Ergänzungen zu Maps.MAP_OBJECTS (Übergang; Maps.MAP_OBJECTS hat Vorrang). wreck.container steht inzwischen in maps.js.
const EXTRA_OBJECTS = {};
// Gruppen und Einheiten je Außenkarte (Kachelart = legend; Quelle bisher content/regiebuch/bausteine.json „karten“)
const MAP_GROUPS = {
  platform: { gruppen: { guards: { legend: 'drone' } }, einheiten: {} },
  wreck: { gruppen: { plunderer: { legend: 'scavenger' } }, einheiten: {} },
  kesh: {
    gruppen: { squad1: { legend: 'squad1' }, squad2: { legend: 'squad2' }, rearguard: { legend: 'rearguard' }, relief: { legend: 'squad2' } },
    einheiten: { warden: { legend: 'warden' } },
  },
};
// Benannte Zonen der Raumszenen (ersetzt Pixelgrenzen wie shipX gt 1500): Ort -> Zone -> { xMin?, xMax?, yMin?, yMax? }
const SPACE_ZONES = {
  splitter: { durchquert: { xMin: 1500 } },
  nebel: { durchquert: { xMin: 1500 } },   // S2: kurs_durch_gefahr/nebelflug (wie splitter: zweite Hälfte der Szene erreicht)
};
// Beam-Regeln je Außenkarte (ersetzt die m1-Sonderlogik in beamDownBlocked): nur, wenn der Schritt die Karte in
// allowBeam nennt; Texte vorher bzw. nachher (Karte schon benutzt oder Mission mit dieser Karte erledigt).
const BEAM_RULES = {
  platform: { nurMitAllowBeam: true, vorher: 'Erst die Boje scannen.', erledigt: 'Auf der Plattform gibt es nichts mehr zu tun.' },
};
// Gegenstände mit Träger (item_in_area carrierRule): Gegenstand -> { map, object } mit .by als Träger-ID
const ITEM_CARRIER = { tafel: { map: 'kesh', object: 'tablet' } };

const AWAY_LEGENDS = { platform: Maps.PLATFORM_LEGEND, wreck: Maps.WRECK_LEGEND, kesh: Maps.KESH_LEGEND };
const MAP_IDS = Object.keys(AWAY_LEGENDS);

function declared(map) {
  return Object.assign({}, EXTRA_OBJECTS[map] || {}, (Maps.MAP_OBJECTS || {})[map] || {});
}
function areas(map) { return ((Maps.MAP_AREAS || {})[map]) || {}; }
function groups(map) { return (MAP_GROUPS[map] && MAP_GROUPS[map].gruppen) || {}; }
function units(map) { return (MAP_GROUPS[map] && MAP_GROUPS[map].einheiten) || {}; }
function legendKinds(map) {
  return new Set(Object.values(AWAY_LEGENDS[map] || {}).flatMap((t) => [t.kind, t.spawn, t.interact].filter(Boolean)));
}
// Ort, an dem man auf diese Karte beamt (platform -> b7)
function locOfMap(map) {
  const l = Locations.LOCATIONS.find((x) => x.scene && x.scene.beam && x.scene.beam.map === map);
  return l ? l.id : null;
}
// Kacheln eines Objekts (aus der Legende): [{ x, y }]
const tileCache = {};
function tilesOf(map, object) {
  const key = map + ':' + object;
  if (tileCache[key]) return tileCache[key];
  const def = declared(map)[object]; const L = AWAY_LEGENDS[map]; const m = Maps[map];
  if (!def || !L || !m) return (tileCache[key] = []);
  const chars = Object.entries(L).filter(([, t]) => [t.kind, t.spawn, t.interact].includes(def.legend)).map(([c]) => c);
  return (tileCache[key] = chars.flatMap((c) => m.find(c)));
}

function aw(game, map) { return game && game.aways ? game.aways[map] : null; }
function countErr(game, where, msg) { if (game && game.countError) game.countError(where, new Error(msg)); }

// ---------- Zustand lesen ----------
// -> string (ein Exemplar) bzw. Liste (viele: true, ohne index); null = unbekannt/Karte fehlt
function state(game, map, object, index) {
  const a = aw(game, map);
  const def = declared(map)[object];
  if (!def) { countErr(game, 'mission-object', `Objekt ${map}.${object} unbekannt`); return null; }
  if (!a) return null;
  const list = (arr, fn) => { const out = (arr || []).map(fn); return index != null ? (out[index] != null ? out[index] : null) : out; };
  switch (map + '.' + object) {
    case 'platform.sonde': return a.sonde && a.sonde.disabled ? 'off' : 'on';
    case 'platform.core': return a.coreRebooted ? 'rebooted' : 'off';
    case 'platform.ivo': return a.npc && a.npc.rescued ? 'rescued' : a.npc && a.npc.injured ? 'injured' : 'ok';
    case 'platform.datenkern': return (a.items || []).some((i) => i.kind === 'datenkern') ? 'present' : 'taken';
    // 'open' = Hohlraum ausgeräumt (wie das Original: versteckter Container erledigt); ohne versteckten Container: Wand offen
    case 'wreck.hollow': {
      const hid = (a.salvage || []).find((s) => s.hidden);
      return (hid ? hid.done : !!(a.hollow && a.hollow.open)) ? 'open' : 'closed';
    }
    case 'wreck.lore': return a.loreRead ? 'read' : 'unread';
    case 'wreck.container': return list((a.salvage || []).filter((s) => !s.hidden), (s) => (s.done ? 'taken' : 'full'));
    case 'kesh.jammer': return list(a.jammers, (j) => (j.off ? 'off' : 'on'));
    case 'kesh.vault': return a.vault && a.vault.open ? 'open' : 'closed';
    case 'kesh.key': return list(a.keys, (k) => ((k.t || 0) > 0 || k.doneAt != null ? 'held' : 'idle'));
    case 'kesh.tablet': return a.tablet && a.tablet.taken ? 'taken' : 'present';
    case 'kesh.warden': {
      const w = (a.drones || []).find((d) => d.kind === 'warden');
      if (!w) return 'dead';
      return !w.alive ? 'dead' : w.asleep ? 'asleep' : 'awake';
    }
    default:
      countErr(game, 'mission-object', `Zustand von ${map}.${object} ist nicht abgebildet`);
      return null;
  }
}
// Wie viele Exemplare sind im Zustand z? (Platzhalter {objectsInState:o:z})
function countInState(game, map, object, z) {
  const s = state(game, map, object);
  if (s == null) return 0;
  return Array.isArray(s) ? s.filter((x) => x === z).length : (s === z ? 1 : 0);
}
function countAll(game, map, object) {
  const s = state(game, map, object);
  if (s == null) return 0;
  return Array.isArray(s) ? s.length : 1;
}
// object_state { all: true } bzw. „mindestens eins“
function inState(game, map, object, z, all) {
  const s = state(game, map, object);
  if (s == null) return false;
  if (!Array.isArray(s)) return s === z;
  return all ? s.length > 0 && s.every((x) => x === z) : s.some((x) => x === z);
}

// ---------- Zustand setzen ----------
let combatMod = null;
const combat = () => combatMod || (combatMod = require('../sim/combat.js'));
function setState(game, map, object, z) {
  const a = aw(game, map);
  const def = declared(map)[object];
  if (!def) { countErr(game, 'mission-object', `Objekt ${map}.${object} unbekannt`); return false; }
  if (!def.zustaende.includes(z)) { countErr(game, 'mission-object', `Zustand ${z} gibt es für ${map}.${object} nicht`); return false; }
  if (!a) return false;
  switch (map + '.' + object + '=' + z) {
    case 'kesh.vault=open': combat().openVault(game); return true;
    case 'kesh.tablet=taken': combat().takeTablet(game, null); return true;
    case 'kesh.warden=awake': combat().wakeWarden(game); return true;
    case 'kesh.jammer=off': for (const j of a.jammers || []) j.off = true; return true;
    case 'platform.sonde=off': if (a.sonde) a.sonde.disabled = true; a.doorOpen = true; return true;
    case 'platform.core=rebooted': a.coreRebooted = true; return true;
    case 'wreck.lore=read': a.loreRead = true; return true;
    case 'wreck.hollow=open': {
      if (a.hollow) a.hollow.open = true;
      const hid = (a.salvage || []).find((s) => s.hidden);
      if (hid) hid.done = true;
      return true;
    }
    default:
      countErr(game, 'mission-object', `Zustand ${map}.${object}=${z} kann die Laufzeit nicht setzen`);
      return false;
  }
}

// ---------- Bereiche und Positionen ----------
function inArea(game, map, area, x, y) {
  if (!areas(map)[area]) { countErr(game, 'mission-area', `Bereich ${map}.${area} unbekannt`); return false; }
  return Maps.inArea(map, area, Math.floor(x / TILE), Math.floor(y / TILE));
}
// Spieler auf dieser Außenkarte (Zone away, aktive Karte)
function teamOn(game, map) {
  return game.players.filter((p) => p.zone === 'away' && (!map || (game.away && game.away.map === map)));
}
// Pixelpositionen eines Objekts (Ivo dynamisch, sonst Kacheln aus der Legende)
function positions(game, map, object) {
  const a = aw(game, map);
  if (map === 'platform' && object === 'ivo') return a && a.npc && a.npc.present ? [{ x: a.npc.x, y: a.npc.y }] : [];
  return tilesOf(map, object).map((t) => ({ x: t.x * TILE + TILE / 2, y: t.y * TILE + TILE / 2 }));
}
function carrierOf(game, item) {
  const c = ITEM_CARRIER[item];
  if (!c) return null;
  const a = aw(game, c.map);
  const o = a && a[c.object === 'tablet' ? 'tablet' : c.object];
  return o && o.by ? o.by : null;
}
function inZone(game, loc, zone) {
  const z = SPACE_ZONES[loc] && SPACE_ZONES[loc][zone];
  if (!z) { countErr(game, 'mission-zone', `Zone ${loc}.${zone} unbekannt`); return false; }
  const s = game.ship;
  if (s.scene !== loc) return false;
  return (z.xMin == null || s.x > z.xMin) && (z.xMax == null || s.x < z.xMax) && (z.yMin == null || s.y > z.yMin) && (z.yMax == null || s.y < z.yMax);
}

module.exports = {
  EXTRA_OBJECTS, MAP_GROUPS, SPACE_ZONES, BEAM_RULES, ITEM_CARRIER, AWAY_LEGENDS, MAP_IDS,
  declared, areas, groups, units, legendKinds, locOfMap, tilesOf,
  state, setState, inArea, countInState, countAll, inState, teamOn, positions, carrierOf, inZone,
};
