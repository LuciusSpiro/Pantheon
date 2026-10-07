// CORE M4 (CONTRACT-M4 §3.3): Layer „ship“ – Schiffsinneres der Lerche in Voxel.
// Böden und Wände je Deck zu einem Netz gebacken (Autotile conn/cut/style), Türen offen/zu, Stationen und Konsolen mit
// Zuständen aus dem Snapshot, Wandleuchten (Alarm/Notstrom), Plaketten, Bodenkleinkram, Quartier-Optionen, Deko-Slots,
// Lecks und Brandflecken. Sichtbar ist nur das Deck der eigenen Figur (ctx.deck, Liftfahrt regelt renderer.js).
// Kein Code hier kennt Schiffskoordinaten: alles kommt aus Shared_Maps (Karte, Legende, Räume, Betten, Regale, Schalter).
import * as THREE from 'three';
import { registerLayer } from './renderer.js';

const TILE = 32;
const DEBUG = new URLSearchParams(location.search).get('debug') === '1';
const WALLISH = { '#': 1, '%': 1, 'D': 1, 'w': 1 };  // Autotile-Nachbarn (ART-A: Tür, Fenster, Lichtschacht zählen als Wand)
const OUTSIDE = { '#': 1, ' ': 1, '%': 1, '~': 1 };   // kein Innenraum
const FLOOR_CH = { '.': 0, '=': 1, '_': 1, ',': 2, ':': 3 };
const QUARTER_FLOORS = ['holz_hell', 'holz_dunkel', 'teppich_rot', 'teppich_blau', 'fliesen'];
const QUARTER_WALLS = { holz: [3, 0], paneel: [3, 1], tapete_gruen: [4, 0], tapete_creme: [4, 1] };
const QUARTER_LIGHT = { warm: '#FFC66B', mint: '#7FE0C2', bernstein: '#FFA032' };
const SIDE_NUM = { bow: 0, stbd: 1, aft: 2, port: 3, mid: 4 };
const EMITTER_SIDE = { emitter_bow: 0, emitter_stbd: 1, emitter_aft: 2, emitter_port: 3 };
const SECTOR_OF_EMITTER = { emitter_bow: 0, emitter_stbd: 1, emitter_aft: 2, emitter_port: 3 };

// Legenden-kind → Asset-ID (Stationen nach kind, Konsolen nach console)
const STATION_ID = {
  sys_reactor: 'lerche/station/reactor', sys_engines: 'lerche/station/engine', sys_shields: 'lerche/station/shield_gen',
  sys_life: 'lerche/station/life_support', sys_thruster: 'lerche/station/thruster', sys_weapon_bow: 'lerche/station/lance',
  sys_weapons: 'lerche/station/lance', sys_battery: 'lerche/station/battery', sys_emitter: 'lerche/station/emitter',
  sys_transfer: 'lerche/station/transfer',
};
const CONSOLE_ID = {
  helm: 'lerche/console/helm', weapons: 'lerche/console/tactical', captain: 'lerche/console/captain', transfer: 'lerche/console/transfer',
  plan: 'lerche/console/plan_table', shop: 'lerche/console/shop',
};
const FURN_ID = {
  terminal_spare: 'lerche/console/spare', reactor_switch: 'lerche/station/reactor_switch',
  shelf: 'lerche/furn/shelf', pipes: 'lerche/furn/pipes', workbench: 'lerche/furn/workbench', control_desk: 'lerche/furn/control_desk',
  barrel: 'lerche/furn/barrel', crate: 'lerche/furn/crate', bed: 'lerche/furn/bed', table: 'lerche/furn/mess_table',
  sideboard: 'lerche/furn/sideboard', trophy_niche: 'lerche/furn/trophy_niche', shrine: 'lerche/furn/shrine', med_bed: 'lerche/furn/med_bed',
  bath: 'lerche/furn/bath', bench: 'lerche/furn/bench', light_shaft: 'lerche/kit/light_shaft', plant: 'lerche/deco/pflanze',
};
const MULTI = { Y: 1, m: 1, '^': 1 };    // 2×2-Objekte: einmal in die Blockmitte
const ID = {
  floor: 'lerche/kit/floor', wall: 'lerche/kit/wall', window: 'lerche/kit/window', door: 'lerche/kit/door', breach: 'lerche/kit/breach',
  light: 'lerche/kit/light', plaque: 'lerche/kit/plaque', pad: 'lerche/kit/pad', shaft: 'lerche/lift/shaft', platform: 'lerche/lift/platform',
  ladder: 'lerche/lift/ladder', decal: 'lerche/furn/floor_decal', qfloor: 'lerche/deco/quarter_floor',
};
// Platzhalterfarben je Kachelart (Debug: Magenta im Loader)
const PH_COL = { floor: '#5A5F6A', floor_wood: '#7A5236', floor_mosaic: '#B8A88C', wall: '#3A3F4C', station: '#B0453A', console: '#4F6178',
  furn: '#6E4228', lift: '#8A8F99', door: '#C9974A', deco: '#5B7A4A', light: '#FFC66B', breach: '#A9D6E5' };

function hash(x, y, s) { let n = (x * 374761393 + y * 668265263 + (s || 0) * 982451653) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
function Maps() { return window.Shared_Maps || {}; }
function CFG() { return window.Shared_Config || {}; }

// ------------------------------------------------------------------------------------------------ Kartenanalyse
function analyze(ctx) {
  const map = ctx.map, M = Maps();
  const D = ctx.decks();
  const legend = map.legend || {};
  const info = (ch) => legend[ch] || null;
  const interior = (x, y) => !OUTSIDE[map.at(x, y)];
  const walkable = (x, y) => interior(x, y) && !(info(map.at(x, y)) || {}).solid;
  const roomOf = (x, y) => (M.roomAt ? M.roomAt(x, y) : null);
  const quarterRoom = new Map();   // 'x,y' → Raum-ID (Quartier-Innenfläche)
  for (const b of M.BEDS || []) { const r = b.room; if (!r) continue; for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) quarterRoom.set(x + ',' + y, r.id); }
  const decks = D.map((d, i) => ({ index: i, y0: d.y0, y1: Math.min(d.y1, map.h - 1), tiles: [] }));
  const multiSeen = new Set();
  const objects = [];   // { ch, kind, tx, ty, cx, cz (Blockmitte in Kacheln, lokal), deck }
  for (const dk of decks) {
    for (let ty = dk.y0; ty <= dk.y1; ty++) for (let tx = 0; tx < map.w; tx++) {
      const ch = map.at(tx, ty);
      if (ch === ' ' || ch === '~') continue;
      const inf = info(ch) || {};
      dk.tiles.push({ tx, ty, ch });
      if (ch === '#' || ch === '%') continue;
      const isObj = MULTI[ch] || ch === 'D' || ch === '!' || ch === 'P' || (inf.solid && inf.kind !== 'wall');
      if (!isObj) continue;
      if (MULTI[ch]) {
        if (multiSeen.has(tx + ',' + ty)) continue;
        // zusammenhängender Block gleicher Zeichen (Flood-Fill) → Mitte
        const stack = [[tx, ty]], cells = [];
        multiSeen.add(tx + ',' + ty);
        while (stack.length) {
          const [x, y] = stack.pop(); cells.push([x, y]);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
            if (!multiSeen.has(k) && map.at(nx, ny) === ch && ny >= dk.y0 && ny <= dk.y1) { multiSeen.add(k); stack.push([nx, ny]); }
          }
        }
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
        for (const [x, y] of cells) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        objects.push({ ch, kind: inf.kind, tx: x0, ty: y0, cx: (x0 + x1 + 1) / 2, cz: (y0 + y1 + 1) / 2 - dk.y0, deck: dk.index, w: x1 - x0 + 1, h: y1 - y0 + 1 });
      } else {
        objects.push({ ch, kind: inf.kind, tx, ty, cx: tx + 0.5, cz: ty - dk.y0 + 0.5, deck: dk.index, w: 1, h: 1 });
      }
    }
  }
  // Blickrichtung: +z zur ersten begehbaren Nachbarkachel (Reihenfolge +z, −z, −x, +x)
  const faceRot = (tx, ty) => {
    if (walkable(tx, ty + 1)) return 0;
    if (walkable(tx, ty - 1)) return Math.PI;
    if (walkable(tx - 1, ty)) return -Math.PI / 2;
    if (walkable(tx + 1, ty)) return Math.PI / 2;
    return 0;
  };
  const faceDir = (rot) => [Math.round(Math.sin(rot)), Math.round(Math.cos(rot))];
  return { map, legend, info, interior, walkable, roomOf, quarterRoom, decks, objects, faceRot, faceDir };
}

// Boden-Zeichen einer Kachel (Objekte/Türen: häufigster Nachbarboden)
function floorChar(A, tx, ty) {
  const ch = A.map.at(tx, ty);
  if (ch in FLOOR_CH) return ch;
  const counts = {};
  for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const c = A.map.at(tx + dx, ty + dy);
    if (c in FLOOR_CH) counts[c] = (counts[c] || 0) + 1;
  }
  let best = '.', n = 0;
  for (const c in counts) if (counts[c] > n) { n = counts[c]; best = c; }
  return best;
}

// ------------------------------------------------------------------------------------------------ Platzhalter-Geometrie (Bake)
const phGeoCache = new Map();
function phGeo(w, h, d, color, y0) {
  const k = [w, h, d, color, y0].join('|');
  let g = phGeoCache.get(k);
  if (g) return g;
  const b = new THREE.BoxGeometry(w, h, d); b.translate(0, (y0 || 0) + h / 2, 0);
  const c = new THREE.Color(DEBUG ? '#FF00FF' : color).convertSRGBToLinear();
  const n = b.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  b.setAttribute('color', new THREE.BufferAttribute(col, 3));
  b.setAttribute('aEmit', new THREE.BufferAttribute(new Float32Array(n), 1));
  b.deleteAttribute('uv');
  phGeoCache.set(k, b);
  return b;
}

// ------------------------------------------------------------------------------------------------ Zustand aus dem Snapshot
function sysCode(st, sys) {
  const s = st && st.ship;
  if (!s) return 0;
  const v = (s.systems && s.systems[sys]) || 'ok';
  if (v === 'broken') return 2;
  if (v === 'offline') return 5;
  if (s.escalate && s.escalate[sys] != null) return 4;
  const fr = s.fragile;
  if (fr && (Array.isArray(fr) ? fr.indexOf(sys) >= 0 : fr[sys])) return 3;
  if (v === 'damaged') return 1;
  return 0;
}
function reactorPower(st) {
  const r = (st && st.ship && st.ship.reactor) || {};
  if (r.state === 'overload') return 1;
  if (r.state === 'offline') return (+r.restartProgress || 0) > 0 ? 3 : 2;
  return 0;
}
function mountCharge(st, id) {
  const ms = (st && st.ship && st.ship.mounts) || [];
  const m = Array.isArray(ms) ? ms.find((x) => x && x.id === id) : ms[id];
  return m ? Math.max(0, Math.min(1, +m.charge || 0)) : 0;
}
function shieldStrength(st, sector) {
  const sh = (st && st.ship && st.ship.shields) || {};
  const cur = Array.isArray(sh.current) ? sh.current[sector] : sh.current && sh.current[sector];
  const cap = Array.isArray(sh.cap) ? sh.cap[sector] : sh.cap && sh.cap[sector];
  if (cur == null) return 0;
  return Math.max(0, Math.min(4, Math.round((cap ? cur / cap : cur / 100) * 4)));
}
function throttle(st) {
  const h = (st && st.ship && st.ship.helm) || {};
  if (h.stage != null) { const n = Array.isArray(h.stages) ? h.stages.length - 1 : 5; return Math.max(0, Math.min(4, Math.round((+h.stage / Math.max(1, n)) * 4))); }
  return Math.max(0, Math.min(4, Math.round(Math.abs(+h.thrust || 0) * 4)));
}
function consoleBusy(st, con) { return (st && st.players || []).some((p) => p.console === con) ? 1 : 0; }

// ------------------------------------------------------------------------------------------------ Layer
const layer = {
  id: 'ship',
  zones: ['ship'],
  async build(ctx) {
    const A = analyze(ctx);
    const S = ctx._ship = { A, decks: [], dyn: [], lamps: [], warm: [], fireTiles: new Set(), seenBreaches: new Map(), bakeSig: [], lightMode: -1, t: 0 };
    for (const dk of A.decks) {
      const g = new THREE.Group(); g.name = 'deck' + dk.index; g.visible = dk.index === ctx.deck;
      ctx.root.add(g);
      S.decks.push({ dk, group: g, bake: null, lampMesh: null });
    }
    // alle IDs vorladen (fehlende werden schnell gezählt und bleiben Platzhalter)
    const ids = new Set(Object.values(ID));
    for (const v of Object.values(STATION_ID)) ids.add(v);
    for (const v of Object.values(CONSOLE_ID)) ids.add(v);
    for (const v of Object.values(FURN_ID)) ids.add(v);
    for (const d of CFG().deko || []) ids.add('lerche/deco/' + d);
    await Promise.race([ctx.loader.loadMany([...ids]), new Promise((r) => setTimeout(r, 8000))]);
    if (ctx._disposed) return;
    buildDynamic(ctx, S);
    buildLamps(ctx, S);
    S.ready = true;
  },
  update(view, dt, ctx) {
    const S = ctx._ship;
    if (!S || !S.ready) return;
    S.t += dt;
    const st = view.state || {};
    for (const d of S.decks) d.group.visible = d.dk.index === ctx.deck;
    if (S.moodDeck !== ctx.deck) { S.moodDeck = ctx.deck; ctx.setMood(ctx.deck >= 1 ? 'ship_private' : 'ship_interior'); }   // ART-A: Deck II eigene Stimmung
    // Brandflecken: Kacheln, die je gebrannt haben
    let wearChanged = false;
    for (const f of (st.ship && st.ship.fires) || []) { const k = f[0] + ',' + f[1]; if (!S.fireTiles.has(k)) { S.fireTiles.add(k); wearChanged = true; } }
    // statische Netze neu backen, wenn Quartier-Optionen oder Brandflecken sich ändern (selten)
    // Wände nur bei geänderten Quartier-Optionen, Böden auch bei neuen Brandflecken (Wände sind teuer: seed je Kachel)
    const qSig = JSON.stringify(st.quarters || {}), fSig = qSig + '|' + S.fireTiles.size;
    for (const d of S.decks) {
      if (d.bakeSig !== qSig) { rebake(ctx, S, d, st, true); d.bakeSig = qSig; d.floorSig = fSig; }
      else if (d.floorSig !== fSig) { rebake(ctx, S, d, st, false); d.floorSig = fSig; }
    }
    void wearChanged;
    updateDynamic(view, ctx, S, st);
    updateLights(view, ctx, S, st);
    // Vorwärmen: je Frame höchstens ein noch nicht gebauter Zustand
    if (S.warm.length) { const w = S.warm.shift(); try { ctx.loader.geometries(w[0], w[1]); } catch (e) { /* gezählt im Loader */ } }
  },
  dispose(ctx) {
    ctx._disposed = true;
    const S = ctx._ship;
    if (!S) return;
    for (const d of S.decks) if (d.bake) for (const m of d.bake) m.geometry.dispose();
  },
};

// ------------------------------------------------------------------------------------------------ Statisch: Böden, Wände, Fenster, Kleinkram, Plaketten
function wallStyle(A, st, tx, ty, deckIndex) {
  // Quartierwand? (Nachbar im 8er-Umkreis ist Quartier-Innenfläche)
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const q = A.quarterRoom.get((tx + dx) + ',' + (ty + dy));
    if (q) {
      const w = ((st.quarters || {})[q] || {}).wall || 'holz';
      const sv = QUARTER_WALLS[w] || QUARTER_WALLS.holz;
      return { style: sv[0], variant: sv[1] };
    }
  }
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const r = A.roomOf(tx + dx, ty + dy);
    if (r && r.id === 'bruecke') return { style: 2, variant: 0 };
  }
  return { style: deckIndex >= 1 ? 1 : 0, variant: 0 };
}

const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), SC = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
function mat(x, z, rot, y) { Q.setFromAxisAngle(UP, rot || 0); V.set(x, y || 0, z); return new THREE.Matrix4().compose(V, Q, SC); }

function rebake(ctx, S, d, st, withSolids) {
  const A = S.A, L = ctx.loader, dk = d.dk;
  const floors = [], solids = [];
  const frontOfStation = S.frontTiles || new Set();
  for (const { tx, ty, ch } of dk.tiles) {
    const lz = ty - dk.y0 + 0.5, lx = tx + 0.5;
    if ((ch === '#' || ch === '%') && !withSolids) continue;
    if (ch === '#') {
      const conn = (WALLISH[A.map.at(tx, ty - 1)] ? 1 : 0) | (WALLISH[A.map.at(tx + 1, ty)] ? 2 : 0) | (WALLISH[A.map.at(tx, ty + 1)] ? 4 : 0) | (WALLISH[A.map.at(tx - 1, ty)] ? 8 : 0);
      const cut = A.interior(tx, ty - 1) ? 1 : 0;
      const ws = wallStyle(A, st, tx, ty, dk.index);
      const params = { conn, cut, style: ws.style, variant: ws.variant, seed: tx + ty * 37 };   // ART-A: Pilaster alle 3 m, Fresken wechseln
      const g = L.geometries(ID.wall, params);
      solids.push({ geo: g ? g.geo : phGeo(1, cut ? 1.25 : 3, 1, PH_COL.wall), matrix: mat(lx, lz, 0) });
      continue;
    }
    if (ch === '%') {
      const rot = A.faceRot(tx, ty);
      const conn = (WALLISH[A.map.at(tx, ty - 1)] ? 1 : 0) | (WALLISH[A.map.at(tx + 1, ty)] ? 2 : 0) | (WALLISH[A.map.at(tx, ty + 1)] ? 4 : 0) | (WALLISH[A.map.at(tx - 1, ty)] ? 8 : 0);
      const g = L.geometries(ID.window, { conn, cut: A.interior(tx, ty - 1) ? 1 : 0 });
      solids.push({ geo: g ? g.geo : phGeo(1, 3, 0.3, '#7FA8C8'), matrix: mat(lx, lz, rot) });
      continue;
    }
    // Boden unter jeder Innenkachel – nicht unter Lift und Lichtschacht (ART-A/ART-E)
    if (ch === '^' || ch === 'w') continue;
    const q = A.quarterRoom.get(tx + ',' + ty);
    if (q) {
      const fl = ((st.quarters || {})[q] || {}).floor || 'holz_hell';
      const style = Math.max(0, QUARTER_FLOORS.indexOf(fl));
      const g = L.geometries(ID.qfloor, { style, seed: Math.floor(hash(tx, ty, 2) * 8) });
      const g2 = g || L.geometries(ID.floor, { kind: 2, wear: 0, seed: Math.floor(hash(tx, ty, 2) * 8) });
      floors.push({ geo: g2 ? g2.geo : phGeo(1, 0.06, 1, PH_COL.floor_wood, -0.06), matrix: mat(lx, lz, 0) });
    } else {
      const fc = floorChar(A, tx, ty);
      let kind = FLOOR_CH[fc];
      if (kind === 0) { const r = A.roomOf(tx, ty); if (r && r.id === 'bruecke') kind = 4; else if (r && r.id === 'krankenstation') kind = 5; }
      const wear = S.fireTiles.has(tx + ',' + ty) ? 2 : 0;
      // QA: Mosaik nur als Mäanderrand an Wänden (seed ≥ 8, Band zur Wand gedreht), im Feld ruhiger Travertin
      let seed = Math.floor(hash(tx, ty, 3) * 8), frot = 0;
      if (kind === 3 && !wear) {
        const wallAt = (dx, dy) => A.map.at(tx + dx, ty + dy) === '#' || A.map.at(tx + dx, ty + dy) === '%';
        const wr = wallAt(0, -1) ? 0 : wallAt(0, 1) ? Math.PI : wallAt(-1, 0) ? Math.PI / 2 : wallAt(1, 0) ? -Math.PI / 2 : null;
        if (wr != null) { seed = 8; frot = wr; }
      }
      const g = L.geometries(ID.floor, { kind, wear, seed });
      floors.push({ geo: g ? g.geo : phGeo(1, 0.06, 1, kind === 2 ? PH_COL.floor_wood : kind === 3 ? PH_COL.floor_mosaic : PH_COL.floor, -0.06), matrix: mat(lx, lz, frot) });
    }
    // Bodenkleinkram (nur Systemdeck, stabil per Hash, nicht vor Stationen, nicht auf Türen/Lift/Leiter/Pads)
    if (withSolids && dk.index === 0 && (ch === '.' || ch === '=' || ch === '_') && !frontOfStation.has(tx + ',' + ty) && hash(tx, ty, 7) < 0.1) {
      const g = L.geometries(ID.decal, { kind: Math.floor(hash(tx, ty, 8) * 9), seed: Math.floor(hash(tx, ty, 9) * 16) });
      if (g) solids.push({ geo: g.geo, matrix: mat(lx + (hash(tx, ty, 10) - 0.5) * 0.3, lz + (hash(tx, ty, 11) - 0.5) * 0.3, Math.floor(hash(tx, ty, 12) * 4) * Math.PI / 2) });
    }
  }
  // Plaketten an Stationen (statisch, Seite aus der Legende)
  for (const o of (withSolids && S.stations) || []) {
    if (o.deck !== dk.index) continue;
    const g = L.geometries(ID.plaque, { side: o.sideNum });
    if (!g) continue;
    const [fx, fz] = A.faceDir(o.rot);
    // an der Wand hinter der Station (Wand-Sockel „plaque“ 0,9 m, Wandfläche +0,5), sonst vor der Station am Boden
    const behind = A.map.at(o.tx - fx, o.ty - fz) === '#';
    if (behind) solids.push({ geo: g.geo, matrix: mat(o.cx - fx * 0.5, o.cz - fz * 0.5, o.rot, 0.9) });
    else solids.push({ geo: g.geo, matrix: mat(o.cx + fx * 0.45, o.cz + fz * 0.45, o.rot) });
  }
  const swap = (key, geo, cast) => {
    if (d[key]) { d.group.remove(d[key]); d[key].geometry.dispose(); d[key] = null; }
    if (!geo) return;
    const m = new THREE.Mesh(geo, ctx.material); m.receiveShadow = true; m.castShadow = cast; m.name = key; m.frustumCulled = false;
    d.group.add(m); d[key] = m;
  };
  swap('floorMesh', L.bake(floors), false);
  if (withSolids) swap('wallMesh', L.bake(solids), true);
  d.bake = [d.floorMesh, d.wallMesh].filter(Boolean);
}

// ------------------------------------------------------------------------------------------------ Dynamisch: Objekte mit Zustand
function buildDynamic(ctx, S) {
  const A = S.A, M = Maps();
  S.frontTiles = new Set();
  S.stations = [];
  const shelfIndex = (tx, ty) => (M.SHELF_TILES || []).findIndex((s) => s.x === tx && s.y === ty);
  const switches = M.REACTOR_SWITCHES || [];
  const add = (o, id, color, paramsFn, extra) => {
    const e = Object.assign({ o, id, color, paramsFn, sig: null, obj: null, deck: o.deck }, extra || {});
    S.dyn.push(e);
    return e;
  };
  for (const o of A.objects) {
    const ch = o.ch, inf = A.info(ch) || {}, kind = inf.kind;
    o.rot = MULTI[ch] ? 0 : A.faceRot(o.tx, o.ty);
    const [fx, fz] = A.faceDir(o.rot);
    if (inf.system || inf.console) S.frontTiles.add((o.tx + fx) + ',' + (o.ty + fz));
    if (ch === 'D') {
      const vertical = WALLISH[A.map.at(o.tx, o.ty - 1)] && WALLISH[A.map.at(o.tx, o.ty + 1)];
      o.rot = vertical ? Math.PI / 2 : 0;
      const cut = A.interior(o.tx, o.ty - 1) ? 1 : 0;
      add(o, ID.door, PH_COL.door, (st, ent) => ({ open: ent.near(o) ? 1 : 0, style: o.deck >= 1 ? 1 : 0, cut }), { door: true });
      continue;
    }
    if (ch === '^') {
      // ART-E: open = begehbare Seiten des Blocks (N1 O2 W8), power 1 = Notstrom
      let open = 0;
      for (let i = 0; i < o.w; i++) if (A.walkable(o.tx + i, o.ty - 1)) open |= 1;
      for (let j = 0; j < o.h; j++) { if (A.walkable(o.tx + o.w, o.ty + j)) open |= 2; if (A.walkable(o.tx - 1, o.ty + j)) open |= 8; }
      const emerg = (st) => { const p = reactorPower(st); return p === 2 || p === 3 ? 1 : 0; };
      add(o, ID.shaft, PH_COL.lift, (st) => ({ deck: o.deck, power: emerg(st), open, cut: 1 }));
      add(o, ID.platform, PH_COL.lift, (st) => ({ moving: (st.players || []).some((p) => p.lift) || (st.bots || []).some((b) => b.lift) ? 1 : 0, power: emerg(st) }));
      continue;
    }
    if (ch === '!') { add(o, ID.ladder, PH_COL.lift, () => ({})); continue; }
    if (ch === 'P') {
      add(o, ID.pad, '#7FA8C8', (st) => {
        const ps = (st.players || []).filter((p) => p.action && p.action.kind === 'beam');
        if (!ps.length) return { phase: 0 };
        const pr = Math.max(...ps.map((p) => +p.action.progress || 0));
        return { phase: pr > 0.85 ? 2 : 1 };
      });
      continue;
    }
    if (inf.system && STATION_ID[kind]) {
      const sys = inf.system;
      const sideNum = SIDE_NUM[inf.side] != null ? SIDE_NUM[inf.side] : 4;
      o.sideNum = sideNum; o.system = sys;
      S.stations.push(o);
      const id = STATION_ID[kind];
      let fn;
      if (kind === 'sys_reactor') fn = (st) => ({ state: sysCode(st, sys), power: reactorPower(st) });
      else if (kind === 'sys_engines') fn = (st) => ({ state: sysCode(st, sys), throttle: throttle(st) });
      else if (kind === 'sys_thruster') fn = (st) => ({ state: sysCode(st, sys), side: sys === 'thruster_port' ? 0 : 1 });
      else if (kind === 'sys_weapon_bow' || kind === 'sys_weapons') fn = (st) => ({ state: sysCode(st, sys), charge: Math.min(3, Math.floor(mountCharge(st, 'bow') * 3.999)) });
      else if (kind === 'sys_battery') fn = (st) => { const m = sys === 'battery_port' ? 'port' : 'stbd'; return { state: sysCode(st, sys), side: m === 'port' ? 0 : 1, tubes: Math.min(4, Math.floor(mountCharge(st, m) * 4.999)) }; };
      else if (kind === 'sys_emitter') fn = (st) => ({ state: sysCode(st, sys), side: EMITTER_SIDE[sys] != null ? EMITTER_SIDE[sys] : 0, strength: shieldStrength(st, SECTOR_OF_EMITTER[sys] != null ? SECTOR_OF_EMITTER[sys] : 0) });
      else fn = (st) => ({ state: sysCode(st, sys) });
      const e = add(o, id, PH_COL.station, fn, { station: true });
      // alle sechs Zustände vorwärmen (Bau beim ersten Schaden vermeiden)
      for (let s = 0; s <= 5; s++) { const p = fn({ ship: {} }); p.state = s; S.warm.push([id, p]); }
      continue;
    }
    if (inf.console && CONSOLE_ID[inf.console]) {
      const con = inf.console, id = CONSOLE_ID[con];
      let fn;
      if (con === 'plan') fn = (st) => ({ active: consoleBusy(st, 'plan') });
      else if (con === 'shop') fn = (st) => ({ docked: st.ship && st.ship.docked ? 1 : 0 });
      else if (con === 'captain') fn = (st) => ({ occupied: consoleBusy(st, con) });
      else fn = (st) => ({ occupied: consoleBusy(st, con), alert: st.ship && st.ship.alert === 'red' ? 1 : 0 });
      add(o, id, PH_COL.console, fn);
      continue;
    }
    if (FURN_ID[kind]) {
      const id = FURN_ID[kind];
      let fn = () => ({});
      if (kind === 'shelf') {
        const i = shelfIndex(o.tx, o.ty);
        const item = i >= 0 ? M.SHELF_TILES[i].item : null;
        const cap = CFG().shelfCapacity;
        fn = (st) => ({ item: Math.max(0, i), fill: item && M.shelfFill ? Math.round(M.shelfFill(st.inventory, item, cap) * 3) : 3 });
      } else if (kind === 'reactor_switch') {
        const sw = switches.find((s) => s.x === o.tx && s.y === o.ty);
        fn = (st) => { const r = (st.ship && st.ship.reactor) || {}; const held = !!(sw && r.switches && r.switches[sw.id]); return { pos: held ? ((+r.restartProgress || 0) >= 1 ? 2 : 1) : 0 }; };
      } else if (kind === 'bed') {
        const bed = (M.BEDS || []).find((b) => b.x === o.tx && b.y === o.ty);
        const color = bed ? bed.color : 0;
        fn = () => ({ color });
      } else if (kind === 'crate') fn = () => ({ seed: Math.floor(hash(o.tx, o.ty, 5) * 16) });
      else if (kind === 'light_shaft') { const w = (x, y) => A.map.at(x, y) === ch; const conn = (w(o.tx, o.ty - 1) ? 1 : 0) | (w(o.tx + 1, o.ty) ? 2 : 0) | (w(o.tx, o.ty + 1) ? 4 : 0) | (w(o.tx - 1, o.ty) ? 8 : 0); fn = (st) => { const p = reactorPower(st); return { glow: p === 2 ? 0 : p === 3 ? 1 : 2, conn }; }; }
      else if (kind === 'bath') { const first = A.map.at(o.tx - 1, o.ty) !== ch && A.map.at(o.tx, o.ty - 1) !== ch ? 1 : 0; fn = () => ({ spout: first }); }   // ART-D: nur ein Löwenkopf
      else if (kind === 'trophy_niche') fn = (st) => ({ filled: (st.inventory && (+st.inventory.tafel || 0) > 0) || ((st.mission && st.mission.discoveries) || []).length > 0 ? 1 : 0 });
      add(o, id, kind === 'light_shaft' ? '#A9D6E5' : PH_COL.furn, fn);
      continue;
    }
    // unbekannte solide Art: Platzhalter, damit nichts unsichtbar blockiert
    add(o, 'lerche/unknown/' + (kind || ch), PH_COL.furn, () => ({}));
  }
  // Deko-Slots der Quartiere (Inhalt aus dem Snapshot)
  for (const b of M.BEDS || []) for (const slot of b.slots || []) {
    const dIdx = Math.max(0, deckOfTile(ctx, slot.y));
    const dk = A.decks[dIdx];
    const o = { ch: 'deco', tx: slot.x, ty: slot.y, cx: slot.x + 0.5, cz: slot.y - dk.y0 + 0.5, deck: dIdx };
    o.rot = A.faceRot(slot.x, slot.y);
    add(o, null, PH_COL.deco, (st) => ({ item: (st.deco || {})[slot.id] || null }), { deco: slot.id });
  }
}
function deckOfTile(ctx, ty) { return ctx.deckOfTile ? ctx.deckOfTile(ty) : 0; }

function entitiesNear(view, S) {
  const pts = [];
  for (const p of view.players || []) if (p.zone === 'ship' && p.connected !== false) pts.push(p);
  for (const b of view.bots || []) pts.push(b);
  for (const n of view.shipNpcs || []) pts.push(n);
  return {
    near(o) {
      const cx = (o.tx + 0.5) * TILE, cy = (o.ty + 0.5) * TILE;
      for (const p of pts) if (Math.abs(p.x - cx) < 44 && Math.abs(p.y - cy) < 44) return true;
      return false;
    },
  };
}

function placeObj(ctx, S, e, params) {
  const d = S.decks[e.deck];
  if (!d) return;
  if (e.obj) { d.group.remove(e.obj); e.obj = null; }
  let id = e.id;
  if (e.deco) { if (!params.item) return; id = 'lerche/deco/' + params.item; params = { on: 1 }; }   // lampe: on (andere ignorieren den Parameter)
  const obj = ctx.loader.object(id, params, { color: e.color });
  obj.position.set(e.o.cx, 0, e.o.cz);
  obj.rotation.y = e.o.rot || 0;
  obj.userData.tile = [e.o.tx, e.o.ty];
  d.group.add(obj);
  e.obj = obj;
}

function updateDynamic(view, ctx, S, st) {
  const ent = entitiesNear(view, S);
  for (const e of S.dyn) {
    if (e.deck !== ctx.deck && e.obj) continue;   // unsichtbares Deck nicht nachführen (außer beim ersten Aufbau)
    let params;
    try { params = e.paramsFn(st, ent) || {}; } catch (err) { params = {}; }
    if (!e.door && !e.deco && !e.station && e.id && e.id.indexOf('/kit/pad') < 0) params.seed = params.seed != null ? params.seed : Math.floor(hash(e.o.tx, e.o.ty, 4) * 8);
    const sig = JSON.stringify(params);
    if (sig === e.sig) continue;
    e.sig = sig;
    placeObj(ctx, S, e, params);
  }
  // Lecks (offen) und geflickte Lecks (vorher offen, jetzt nicht mehr in der Liste)
  const open = new Set();
  for (const b of (st.ship && st.ship.breaches) || []) {
    const k = b.tx + ',' + b.ty; open.add(k);
    let r = S.seenBreaches.get(k);
    if (!r) { r = { tx: b.tx, ty: b.ty, patched: -1, obj: null }; S.seenBreaches.set(k, r); }
  }
  for (const [k, r] of S.seenBreaches) {
    const patched = open.has(k) ? 0 : 1;
    if (patched === r.patched) continue;
    r.patched = patched;
    const dIdx = Math.max(0, deckOfTile(ctx, r.ty));
    const d = S.decks[dIdx]; if (!d) continue;
    if (r.obj) d.group.remove(r.obj);
    r.obj = ctx.loader.object(ID.breach, { patched }, { color: PH_COL.breach });
    r.obj.position.set(r.tx + 0.5, 0, r.ty - d.dk.y0 + 0.5);
    r.obj.rotation.y = S.A.faceRot(r.tx, r.ty);
    d.group.add(r.obj);
  }
}

// ------------------------------------------------------------------------------------------------ Wandleuchten + Licht
function buildLamps(ctx, S) {
  const A = S.A;
  for (const d of S.decks) {
    const dk = d.dk, cand = [];
    for (const { tx, ty, ch } of dk.tiles) {
      if (ch !== '#') continue;
      const lz = ty - dk.y0;
      // Innenraum südlich (+z): Leuchte an der sichtbaren Wandseite
      const y = A.interior(tx, ty - 1) ? 0.35 : 1.6;
      if (A.walkable(tx, ty + 1)) cand.push({ x: tx + 0.5, z: lz + 1, rot: 0, tx, ty, y, pri: 0 });
      else if (A.walkable(tx + 1, ty)) cand.push({ x: tx + 1, z: lz + 0.5, rot: Math.PI / 2, tx, ty, y, pri: 1 });
      else if (A.walkable(tx - 1, ty)) cand.push({ x: tx, z: lz + 0.5, rot: -Math.PI / 2, tx, ty, y, pri: 1 });
    }
    // QA: Mindestabstand 4,5 m zwischen Leuchten (auch quer über schmale Räume) – vorher hingen im Liftvorraum 5–6 Lampen dicht
    cand.sort((a, b) => a.pri - b.pri || a.ty - b.ty || a.tx - b.tx);
    const list = [];
    for (const c of cand) if (!list.some((l) => Math.hypot(l.x - c.x, l.z - c.z) < 4.5)) list.push(c);
    d.lamps = list;
    S.lamps.push(...list.map((l) => Object.assign({ deck: dk.index }, l)));
  }
}
function setLampMode(ctx, S, mode) {
  for (const d of S.decks) {
    if (d.lampMesh) { d.group.remove(d.lampMesh); d.lampMesh.dispose && d.lampMesh.dispose(); d.lampMesh = null; }
    if (!d.lamps.length) continue;
    const style = d.dk.index >= 1 ? 1 : 0;
    const g = ctx.loader.geometries(ID.light, { mode, style });
    const geo = g ? g.geo : phGeo(0.25, 0.4, 0.08, mode === 1 ? '#E0473C' : '#FFC66B', 0);
    const im = new THREE.InstancedMesh(geo, ctx.material, d.lamps.length);
    d.lamps.forEach((l, i) => im.setMatrixAt(i, mat(l.x, l.z, l.rot, l.y)));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = false; im.receiveShadow = false; im.name = 'lamps';
    im.computeBoundingSphere();
    d.group.add(im); d.lampMesh = im;
  }
  S.lightMode = mode;
}
function updateLights(view, ctx, S, st) {
  const alert = st.ship && st.ship.alert;
  const rp = reactorPower(st);
  const mode = rp === 2 || rp === 3 ? 2 : alert === 'red' ? 1 : 0;
  if (mode !== S.lightMode) setLampMode(ctx, S, mode);
  ctx.shared.lightMode = mode;
  // zwei nächste Leuchten des sichtbaren Decks als Punktlicht
  const sp = view.self ? ctx.toWorld(view.self.x, view.self.y) : { x: 0, z: 0 };
  const cam = { x: sp.x, z: sp.z + 9 };
  const pulse = 0.55 + 0.45 * Math.sin(S.t * Math.PI * 2);
  const col = mode === 1 ? '#FF4A3A' : mode === 2 ? '#FF9A40' : ctx.deck >= 1 ? '#FFC98A' : '#D8E6FF';
  const inten = mode === 1 ? 3.2 * pulse : mode === 2 ? 1.4 : 2.4;
  const near = S.lamps.filter((l) => l.deck === ctx.deck).map((l) => ({ l, d: Math.hypot(l.x - cam.x, l.z - (cam.z - 9)) })).sort((a, b) => a.d - b.d).slice(0, 2);
  for (const { l } of near) ctx.addLight({ x: l.x + Math.sin(l.rot) * 0.6, y: l.y + 0.8, z: l.z + Math.cos(l.rot) * 0.6, color: col, intensity: inten, distance: 7, priority: 0 });
  // ART-B: Reaktor überladen/Notstart – pulsierendes Licht am Socket light (0,8 m)
  if (rp === 1 || rp === 3) for (const o of S.stations || []) if (o.system === 'reactor' && o.deck === ctx.deck) ctx.addLight({ x: o.cx, y: 0.8, z: o.cz + 0.3, color: rp === 1 ? '#FF5A3A' : '#FFB040', intensity: 2 + 2 * pulse, distance: 5, priority: 1 });
  // Quartierlicht der eigenen Figur
  const me = view.me, self = view.self;
  if (me && self) {
    const tx = Math.floor(self.x / TILE), ty = Math.floor(self.y / TILE);
    const q = S.A.quarterRoom.get(tx + ',' + ty);
    if (q) {
      const lt = ((st.quarters || {})[q] || {}).light || 'warm';
      const c = QUARTER_LIGHT[lt];
      const b = (Maps().BEDS || []).find((bb) => bb.room && bb.room.id === q);
      if (c && b) { const r = b.room, dIdx = Math.max(0, deckOfTile(ctx, r.y0)), y0 = S.decks[dIdx].dk.y0; ctx.addLight({ x: (r.x0 + r.x1 + 1) / 2, y: 2.1, z: (r.y0 + r.y1 + 1) / 2 - y0, color: c, intensity: 4, distance: 5, priority: 2 }); }
    }
  }
}

registerLayer(layer);
export default layer;
