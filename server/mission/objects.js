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
// B1: gebaute Karten liefern ihre Bereiche aus der Karte ({ rects } wie MAP_AREAS mit rects)
function areas(map) {
  const a = (Maps.MAP_AREAS || {})[map];
  if (a || isHand(map)) return a || {};
  const k = karte(null, map);
  return (k && k.bereiche) || {};
}
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
    // B1 Nachauftrag: Ivo, Wächter, Container über Bausteine setzbar
    case 'platform.ivo=injured': if (a.npc) { a.npc.injured = true; a.npc.rescued = false; } return true;
    case 'platform.ivo=ok': if (a.npc) { a.npc.injured = false; a.npc.rescued = false; } return true;
    case 'platform.ivo=rescued': if (a.npc) { a.npc.injured = false; a.npc.rescued = true; a.npc.present = false; a.npc.following = null; } return true;
    case 'kesh.warden=dead': for (const d of a.drones || []) if (d.kind === 'warden') { d.alive = false; d.asleep = false; d.aim = null; } return true;
    case 'kesh.warden=asleep': for (const d of a.drones || []) if (d.kind === 'warden' && d.alive) { d.asleep = true; d.aim = null; } return true;
    case 'wreck.container=full': case 'wreck.container=taken': for (const s of a.salvage || []) if (!s.hidden) s.done = z === 'taken'; return true;
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
function areaDef(map, area) {
  const all = areas(map);
  if (all[area]) return all[area];
  if (isHand(map) || !['hinein', 'ziel', 'rueckzug'].includes(area)) return null;
  const key = Object.keys(all).sort().find((k) => all[k] && all[k].rolle === area);
  return key ? all[key] : null;
}
function inArea(game, map, area, x, y) {
  // Wunsch KATALOG (genehmigt): auf gebauten Karten löst hinein|ziel|rueckzug auch über die Bereichsrolle auf
  const def = areaDef(map, area);
  if (!def) { countErr(game, 'mission-area', `Bereich ${map}.${area} unbekannt`); return false; }
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (!isHand(map)) return (def.rects || []).some((q) => tx >= q[0] && tx < q[0] + q[2] && ty >= q[1] && ty < q[1] + q[3]);
  return Maps.inArea(map, area, tx, ty);
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

// =================================================================================================================
// B1 (CONTRACT-B1 §6.3): Ankermodell. Objektbezug neu { map: <lpId>, anker: <rolle>|<ankerId>, state, all? }.
// Handkarten (platform, wreck, kesh): Maps.MAP_ANCHORS (BUEHNE) + Adapter auf die alten Objekte (Zustandsnamen übersetzt).
// Gebaute Karten: Anker aus der Karte (world.AWAY_MAPS[lpId].karte bzw. landepunkte.karte), Zustand über anker.js (BUEHNE).
// =================================================================================================================
const HAND_MAPS = ['platform', 'wreck', 'kesh'];
let ankerVokabular = null;
function vokabular() {
  if (!ankerVokabular) { try { ankerVokabular = require('../../content/buehnen/anker.json'); } catch (e) { ankerVokabular = { rollen: {} }; } }
  return ankerVokabular;
}
const ROLLEN = () => vokabular().rollen || {};
function rolleZustaende(rolle) { const r = ROLLEN()[rolle]; return (r && Array.isArray(r.zustaende)) ? r.zustaende : []; }
// Zustandsübersetzung alt (MAP_OBJECTS) -> neu (anker.json). Objekte ohne Rollenzustände (warden, ivo) behalten ihre Namen.
const ADAPTER_ZUSTAENDE = {
  vault: { closed: 'zu', open: 'offen' },
  key: { idle: 'ruhe', held: 'gehalten' },
  tablet: { present: 'da', taken: 'genommen' },
  container: { full: 'voll', taken: 'leer' },
  lore: { unread: 'bereit', read: 'geladen' },
  hollow: { closed: 'zu', open: 'offen' },
  datenkern: { present: 'frei', taken: 'genommen' },
  jammer: { on: 'frei', off: 'aktiviert' },
};
const zuNeu = (alt, z) => { const t = ADAPTER_ZUSTAENDE[alt]; return t && t[z] != null ? t[z] : z; };
const zuAlt = (alt, z) => { const t = ADAPTER_ZUSTAENDE[alt]; if (!t) return z; const k = Object.keys(t).find((x) => t[x] === z); return k != null ? k : z; };
const isHand = (map) => HAND_MAPS.includes(map);

let worldMod = null; let ankerSim; let lpSim;
const world = () => worldMod || (worldMod = require('../world.js'));
function optSim(name) {
  try { const m = require('../sim/' + name + '.js'); return m && !m.stub ? m : null; } catch (e) { return null; }
}
function ankerMod() { if (ankerSim === undefined) ankerSim = optSim('anker'); return ankerSim; }
function landepunkteMod() { if (lpSim === undefined) lpSim = optSim('landepunkte'); return lpSim; }

// Gebaute Karte eines Landepunkts (Vertrag Karte, §2) oder null
function karte(game, map) {
  if (!map || isHand(map)) return null;
  try {
    const reg = (world().AWAY_MAPS || {})[map];
    const k = reg && (reg.karte || (Array.isArray(reg.rows) && reg.anker ? reg : null));
    if (k) return k;
    const L = landepunkteMod();
    if (L && typeof L.karte === 'function') return L.karte(game, map) || null;
  } catch (e) { if (game && game.countError) game.countError('mission-anker', e); }
  return null;
}
// Alle Anker einer Karte: [{ id, rolle, x, y, alt?, … }]
function anchors(game, map) {
  if (isHand(map)) return ((Maps.MAP_ANCHORS || {})[map]) || [];
  const k = karte(game, map);
  return (k && Array.isArray(k.anker)) ? k.anker : [];
}
// ref = Anker-ID oder Rolle -> passende Anker (Rolle: alle dieser Rolle)
function resolveAnker(game, map, ref) {
  const list = anchors(game, map);
  const byId = list.filter((a) => a.id === ref);
  return byId.length ? byId : list.filter((a) => a.rolle === ref);
}
// Index eines Hand-Ankers unter den Ankern mit demselben alten Objekt (viele: container, key, jammer)
function altIndex(map, a) {
  const same = (((Maps.MAP_ANCHORS || {})[map]) || []).filter((x) => x.alt === a.alt);
  return same.length > 1 ? same.indexOf(a) : null;
}
// Zustand eines Ankers (Vokabular anker.json) bzw. null
function ankerState(game, map, a) {
  if (!a) return null;
  if (isHand(map)) {
    if (!a.alt) return rolleZustaende(a.rolle)[0] || null;
    if (a.alt === 'pads') return 'bereit';
    if (a.alt === 'container') {   // Container über die Kachel (auch der versteckte im Hohlraum ist ein beute-Anker)
      const w = aw(game, map); const s = w && (w.salvage || []).find((x) => x.x === a.x && x.y === a.y);
      return s ? (s.done ? 'leer' : 'voll') : null;
    }
    if (a.alt === 'key') {   // gelöstes Paar = Gewölbe offen
      if (state(game, 'kesh', 'vault') === 'open') return 'geloest';
    }
    const idx = altIndex(map, a);
    const s = declared(map)[a.alt] ? state(game, map, a.alt, idx != null ? idx : undefined) : null;
    if (Array.isArray(s)) return s.length ? zuNeu(a.alt, s[0]) : null;
    return s == null ? null : zuNeu(a.alt, s);
  }
  const A = ankerMod();
  if (A && typeof A.zustand === 'function') { try { const z = A.zustand(game, map, a.id); if (z != null) return z; } catch (e) { game.countError('mission-anker', e); } }
  const k = karte(game, map);
  if (k && k.zustaende && k.zustaende[a.id] != null) return k.zustaende[a.id];
  return rolleZustaende(a.rolle)[0] || null;
}
// anker_state / object_state { anker }: eins (bzw. alle mit all) im Zustand z
function ankerInState(game, map, ref, z, all) {
  const list = resolveAnker(game, map, ref);
  if (!list.length) return false;
  const st = list.map((a) => ankerState(game, map, a));
  return all ? st.every((s) => s === z) : st.some((s) => s === z);
}
function ankerCount(game, map, ref, z) {
  return resolveAnker(game, map, ref).filter((a) => z == null || ankerState(game, map, a) === z).length;
}
// Zustand setzen. Handkarten über das alte Objekt (setState), gebaute Karten über anker.js setzen(game, map, id, z, pid?).
function setAnkerState(game, map, ref, z, opts) {
  const list = resolveAnker(game, map, ref);
  if (!list.length) { countErr(game, 'mission-anker', `Anker ${map}.${ref} unbekannt`); return false; }
  let ok = true;
  if (isHand(map)) {
    const done = new Set();
    for (const a of list) {
      if (a.alt === 'container') {   // einzelner Container über seine Kachel (auch der versteckte im Hohlraum)
        const w = aw(game, map); const s = w && (w.salvage || []).find((x) => x.x === a.x && x.y === a.y);
        if (s && (z === 'voll' || z === 'leer')) s.done = z === 'leer'; else ok = false;
        continue;
      }
      if (!a.alt || a.alt === 'pads' || done.has(a.alt)) continue;
      done.add(a.alt);
      ok = setState(game, map, a.alt, zuAlt(a.alt, z)) && ok;
    }
    return ok;
  }
  const A = ankerMod();
  if (!A || typeof A.setzen !== 'function') { countErr(game, 'mission-anker', `anker.js fehlt – ${map}.${ref}=${z} nicht gesetzt`); return false; }
  for (const a of list) {
    try { const e = A.setzen(game, map, a.id, z, null, opts || {}); if (e) { ok = false; countErr(game, 'mission-anker', e); } } catch (e) { game.countError('mission-anker', e); ok = false; }
  }
  return ok;
}
// Zustände, die ein Anker-Bezug kennen kann (Prüfer): Rollenzustände, bei Handkarten auch die alten Namen ohne Übersetzung
function ankerZustaende(map, ref) {
  const out = new Set();
  const list = isHand(map) ? resolveAnker(null, map, ref) : [];
  const rollen = list.length ? [...new Set(list.map((a) => a.rolle))] : (ROLLEN()[ref] ? [ref] : []);
  for (const r of rollen) for (const z of rolleZustaende(r)) out.add(z);
  for (const a of list) if (a.alt && declared(map)[a.alt]) for (const z of declared(map)[a.alt].zustaende) out.add(zuNeu(a.alt, z));
  if (rollen.includes('raetsel')) out.add('geloest');
  return [...out];
}
// Positionen (Pixel) der Anker eines Bezugs
function ankerPositions(game, map, ref) {
  return resolveAnker(game, map, ref).map((a) => ({ x: a.x * TILE + TILE / 2, y: a.y * TILE + TILE / 2 }));
}
// Ankerzahlen je Rolle einer Karte (Kontext, Prüfer): { rolle: anzahl }
function ankerZahlen(list) {
  const out = {};
  for (const a of list || []) out[a.rolle] = (out[a.rolle] || 0) + 1;
  return out;
}

// ---------- Landepunkte (content/welt/landepunkte.json, BUEHNE) – für Prüfer und Kontext ohne Server ----------
let lpDaten;
function landepunktDaten() {
  if (lpDaten === undefined) {
    lpDaten = {};
    try {
      const d = require('../../content/welt/landepunkte.json');
      for (const [ort, list] of Object.entries((d && d.orte) || {})) for (const e of list || []) if (e && e.id) lpDaten[e.id] = Object.assign({ ort }, e);
    } catch (e) { /* Datei fehlt: nur Handkarten */ }
  }
  return lpDaten;
}
const KARTEN_ARTEN = ['aussenposten', 'station', 'ruine', 'schiff'];
// Landepunkt-ID -> { id, ort, art, gesperrt, frei, dynamisch? } | null. Dynamisch: <ort>.<art>-<n> (lp neu) und <ort>.prise (§7)
function landepunkt(id) {
  if (typeof id !== 'string' || !id) return null;
  const d = landepunktDaten()[id];
  if (d) return d;
  if (isHand(id)) return { id, ort: locOfMap(id), art: 'hand', gesperrt: false, frei: 'immer' };
  const m = /^([a-z0-9_]+)\.(?:(prise)|([a-z]+)-\d+)$/.exec(id);
  if (m && Locations.LOCATIONS.some((l) => l.id === m[1]) && (m[2] || KARTEN_ARTEN.includes(m[3]) || m[3] === 'wrack')) {   // wrack-<n>: treibendes Wrack (ENTERN)
    return { id, ort: m[1], art: m[2] || m[3] === 'wrack' ? 'schiff' : m[3], gesperrt: false, frei: 'immer', dynamisch: true };
  }
  return null;
}
function landepunkteAm(ort) { return Object.values(landepunktDaten()).filter((e) => e.ort === ort); }

// §11.1/§11.3: buehne_braucht einer Umsetzung gegen eine gebaute Karte prüfen.
//   braucht = { kartenarten?: [..], anker: ['tor', 'fund', { rolle: 'raetsel', paar: 1 }], min?: { eingang: 2 }, gefecht?: true }
//   k = Karte (§2) oder { art, anker, bereiche } (Handkarte: art 'hand' bzw. die Karten-ID in kartenarten)
// -> [{ code: 'BUEHNE-ART'|'BUEHNE-ANKER', msg }]
function pruefeBuehneBraucht(braucht, k, mapId) {
  const out = [];
  if (!braucht || typeof braucht !== 'object') return out;
  const list = (k && k.anker) || [];
  const art = k && k.art;
  const arten = Array.isArray(braucht.kartenarten) ? braucht.kartenarten : null;
  if (arten && arten.length && !arten.includes(art) && !(mapId && arten.includes(mapId))) out.push({ code: 'BUEHNE-ART', msg: `Kartenart '${art}'${mapId ? ` (${mapId})` : ''} passt nicht (verlangt: ${arten.join(', ')})` });
  const zahl = ankerZahlen(list);
  for (const req of braucht.anker || []) {
    const rolle = typeof req === 'string' ? req : req && req.rolle;
    if (!rolle) continue;
    if (typeof req === 'object' && req.paar) {
      const paare = {};
      for (const a of list) if (a.rolle === rolle && a.paar) paare[a.paar] = (paare[a.paar] || 0) + 1;
      const n = Object.values(paare).filter((c) => c >= 2).length;
      if (n < req.paar) out.push({ code: 'BUEHNE-ANKER', msg: `Karte hat ${n} vollständige ${rolle}-Paare (verlangt ${req.paar})` });
    } else if (!zahl[rolle]) out.push({ code: 'BUEHNE-ANKER', msg: `Karte hat keinen Anker '${rolle}'` });
  }
  for (const [rolle, n] of Object.entries(braucht.min || {})) {
    if ((zahl[rolle] || 0) < n) out.push({ code: 'BUEHNE-ANKER', msg: `Karte hat ${zahl[rolle] || 0}× '${rolle}' (verlangt mindestens ${n})` });
  }
  if (braucht.gefecht) {
    const b = (k && k.bereiche) || {};
    if (!Object.values(b).some((x) => x && x.gefecht)) out.push({ code: 'BUEHNE-ANKER', msg: 'Karte hat keinen Gefechtsbereich' });
  }
  return out;
}

module.exports = {
  HAND_MAPS, ADAPTER_ZUSTAENDE, karte, anchors, resolveAnker, ankerState, ankerInState, ankerCount, setAnkerState, ankerZustaende,
  ankerPositions, ankerZahlen, pruefeBuehneBraucht, rolleZustaende, isHand, landepunkt, landepunkteAm, landepunktDaten, KARTEN_ARTEN,
  EXTRA_OBJECTS, MAP_GROUPS, SPACE_ZONES, BEAM_RULES, ITEM_CARRIER, AWAY_LEGENDS, MAP_IDS,
  declared, areas, groups, units, legendKinds, locOfMap, tilesOf,
  state, setState, inArea, countInState, countAll, inState, teamOn, positions, carrierOf, inZone,
};
