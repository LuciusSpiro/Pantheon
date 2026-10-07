// Sternenschicht M4 – Team AWAY: Außenmissionen in Voxel (Plattform B-7, Wrack „Zaunkönig“, Mond Kesh).
// CONTRACT-M4 §3.2 (Layer-Schnittstelle), §3.6 (Assets/Zustände), §7 (Performance).
//
// Aufbau je Zone:
// - Statisches (Böden, Wände, Fels/Gelände, Pfeiler, Deckung, Kisten, Trümmer, Streuung, Rumpf) wird beim Bau zu
//   wenigen Meshes zusammengefasst (ein lit- und ein emit-Mesh + Gelände). Assets kommen über ctx.loader; fehlt eine ID
//   im Manifest, baut diese Datei einen eigenen, lesbaren Voxel-Fallback (kein Magenta-Kasten).
// - Objekte mit Zustand (Türen, Sonde, Bojenkern, dünne Wand, Bergungscontainer, Terminal, Störrelais, Schlüssel, Tor,
//   Tafel) sind einzelne Gruppen. Ihre Parameter werden je Frame aus dem Snapshot abgeleitet (wie render.js), neu gebaut
//   wird nur, wenn sich die Parameter ändern.
// - Kesh: Nebel des Krieges per Shader-Patch (Sichtbarkeits-Textur über die Karte, unsichtbar = 35 % Helligkeit,
//   entsättigt). Sichtbarkeit wie render.js teamVision (Shared_Los, sightTiles, Ducken, Tor).
import { registerLayer } from './renderer.js';

const TILE = 32;
const G = typeof window !== 'undefined' ? window : globalThis;

// ------------------------------------------------------------------ kleine Helfer
function hash2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul((s | 0) + 1, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const colorCache = new Map();
/** Hex (sRGB) → lineare Farbe [r,g,b], optional skaliert (f > 1 = leuchtet für Bloom). */
function C(hex, f = 1) {
  let c = colorCache.get(hex);
  if (!c) {
    const n = parseInt(String(hex).replace('#', ''), 16) || 0;
    c = [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
    colorCache.set(hex, c);
  }
  return f === 1 ? c : [c[0] * f, c[1] * f, c[2] * f];
}
const mulC = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : +v || 0);
// Boden-Variante: meist schlicht (seed 0), nur jede vierte Kachel mit Markierung/Klappe/Ruß – sonst wirkt der Boden wie ein Schachbrett
function calmSeed(tx, ty, salt) { return hash2(tx, ty, salt) < 0.75 ? 0 : 1 + Math.floor(hash2(tx, ty, salt + 1) * 7); }

function cfgNum(path, d) {
  let o = (G.Shared_Config || {}).awayCombat || {};
  for (const k of path.split('.')) { if (!o || typeof o !== 'object') return d; o = o[k]; }
  return typeof o === 'number' && isFinite(o) ? o : d;
}
// Koordinaten aus dem Snapshot, die Kachel ODER Pixel sein können (salvage/hollow/jammers) → Kachel (wie render.js)
function toTileXY(map, x, y) {
  if (x == null || y == null) return null;
  if (x <= map.w && y <= map.h && Math.floor(x) === x && Math.floor(y) === y) return { x, y };
  return { x: Math.floor(x / TILE), y: Math.floor(y / TILE) };
}

// ------------------------------------------------------------------ Geometrie-Sammler
// Bucket = ein künftiges Mesh (Positionen, Normalen, Farben, Indizes). Wird von Boxen, Quads und fremden
// Geometrien (Loader-Assets mit Matrix) gefüllt und am Ende zu einer BufferGeometry.
class Bucket {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.idx = []; this.n = 0; }
  get empty() { return this.n === 0; }
  quad(p, nrm, cols) {
    // Windung automatisch passend zur Normalen
    const ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = p[1][2] - p[0][2];
    const bx = p[2][0] - p[0][0], by = p[2][1] - p[0][1], bz = p[2][2] - p[0][2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const flip = cx * nrm[0] + cy * nrm[1] + cz * nrm[2] < 0;
    const b = this.n;
    for (let i = 0; i < 4; i++) {
      this.pos.push(p[i][0], p[i][1], p[i][2]);
      this.nor.push(nrm[0], nrm[1], nrm[2]);
      const c = cols[i] || cols[0];
      this.col.push(c[0], c[1], c[2]);
    }
    if (flip) this.idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    else this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    this.n += 4;
  }
  /** Fremde BufferGeometry mit Matrix übernehmen (nur position/normal/color). */
  addGeometry(THREE, geo, m, fallbackColor) {
    const P = geo.getAttribute('position');
    if (!P) return;
    const N = geo.getAttribute('normal'), Cc = geo.getAttribute('color');
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3(), w = new THREE.Vector3();
    const base = this.n;
    const fc = fallbackColor || [0.6, 0.6, 0.6];
    for (let i = 0; i < P.count; i++) {
      v.set(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(m);
      this.pos.push(v.x, v.y, v.z);
      if (N) { w.set(N.getX(i), N.getY(i), N.getZ(i)).applyMatrix3(nm).normalize(); this.nor.push(w.x, w.y, w.z); } else this.nor.push(0, 1, 0);
      if (Cc) this.col.push(Cc.getX(i), Cc.getY(i), Cc.getZ(i)); else this.col.push(fc[0], fc[1], fc[2]);
    }
    const I = geo.getIndex();
    if (I) for (let i = 0; i < I.count; i++) this.idx.push(base + I.getX(i));
    else for (let i = 0; i < P.count; i++) this.idx.push(base + i);
    this.n += P.count;
  }
  toGeometry(THREE) {
    if (!this.n) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(new THREE.BufferAttribute(this.n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

const FACES = [
  // [Normalenachse, Vorzeichen]
  ['y', 1], ['y', -1], ['x', 1], ['x', -1], ['z', 1], ['z', -1],
];
// Pen: zeichnet Boxen in ein Bucket-Paar { lit, emit } unter einer Matrix (Kachelmitte + Drehung + lokale Extras).
class Pen {
  constructor(THREE, set) {
    this.T = THREE; this.set = set; this.m = new THREE.Matrix4(); this.nm = new THREE.Matrix3();
    this.v = new THREE.Vector3(); this.w = new THREE.Vector3(); this.ident = true;
  }
  at(m) { this.m.copy(m); this.nm.getNormalMatrix(m); this.ident = false; return this; }
  /** Box [x0..x1]×[y0..y1]×[z0..z1] (lokal). top/side = lineare Farben. o: { emit, bottom, faces:'top', low, jit } */
  box(x0, y0, z0, x1, y1, z1, top, side, o = {}) {
    const tgt = o.emit ? this.set.emit : this.set.lit;
    const low = o.low ?? 0.8;   // Seiten unten dunkler (eingebackenes AO)
    const j = o.jit === false ? 1 : 1 + (hash2(Math.round((x0 + x1) * 50), Math.round((z0 + z1) * 50), Math.round(y1 * 50)) - 0.5) * 0.08;
    const tc = mulC(top, j), sc = mulC(side || top, j), sl = o.emit ? sc : mulC(sc, low);
    for (const [ax, s] of FACES) {
      if (o.faces === 'top' && !(ax === 'y' && s === 1)) continue;
      if (ax === 'y' && s === -1 && !o.bottom) continue;
      if (o.skip && o.skip.indexOf(ax + (s > 0 ? '+' : '-')) >= 0) continue;
      let p;
      if (ax === 'y') { const y = s > 0 ? y1 : y0; p = [[x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]]; }
      else if (ax === 'x') { const x = s > 0 ? x1 : x0; p = [[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]]; }
      else { const z = s > 0 ? z1 : z0; p = [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]]; }
      let n = ax === 'x' ? [s, 0, 0] : ax === 'y' ? [0, s, 0] : [0, 0, s];
      const cols = ax === 'y' ? [s > 0 ? tc : mulC(sc, 0.6)] : p.map((q) => (q[1] === y0 ? sl : sc));
      if (!this.ident) {
        p = p.map((q) => { this.v.set(q[0], q[1], q[2]).applyMatrix4(this.m); return [this.v.x, this.v.y, this.v.z]; });
        this.w.set(n[0], n[1], n[2]).applyMatrix3(this.nm).normalize(); n = [this.w.x, this.w.y, this.w.z];
      }
      tgt.quad(p, n, cols);
    }
  }
}

// ------------------------------------------------------------------ Farben (Fallback; Paletten können überschreiben)
const COL = {
  // Plattform B-7 (Kustoden-Boje): kühles Stahlblau, Indigo, Eislicht
  // Farben nach ART-H-Paletten (wrack: plat_* / Rost; mond_kesh), damit Fallback und echte Assets zusammenpassen
  platFloor: '#5D6E82', platFloor2: '#66788E', platSeam: '#2E3846', platWall: '#3E4C5E', platWallTop: '#6F7B8A', platTrim: '#6F7B8A',
  platHull: '#2E3846', platHullDark: '#1E242C', platGlow: '#C8DAFF', indigo: '#4C3C7E', indigoDark: '#2C2450',
  // Wrack: Rost, Ruß, Notlicht
  wrFloor: '#4A433D', wrFloor2: '#544B44', wrScorch: '#1E1B1A', wrSeam: '#1E1B1A', wrWall: '#4A433E', wrWallTop: '#6A625A', wrRust: '#8A4B2A',
  wrPit: '#0A0909', wrGrate: '#5A524C', emergency: '#FF4A36',
  // Kesh: warmer Sand, mauvefarbener Fels, schieferblauer Ruinenstein, violettes Kustoden-Neon
  sand: '#C49A6C', sand2: '#B48C62', sand3: '#CFA676', rockTop: '#8A7470', rock: '#7A6560', rock2: '#6E5A56', rockDark: '#4E4044',
  ruinFloor: '#8C7B66', ruinFloor2: '#7E6E5B', ruinFloor3: '#968470', ruinGrout: '#5A4C3E', ruinWall: '#6F7A8A', ruinWall2: '#647080',
  ruinWallTop: '#9DA6B2', violet: '#A77BFF',
  coverBody: '#5C6676', coverTop: '#EDE6D0', pillarShaft: '#48505E', pillarLight: '#6F7A8A', pillarCrown: '#1C1D26', pillarShadow: '#14141A',
  gold: '#D9A441', bronzeDark: '#4E4558', jam: '#FF4FD8',
};
// Spielerfarben-freie Farben der Sonde (Protocol.CODE_COLORS: mint, bernstein, rot, blau, pink, weiss)
const SONDE_COLORS = ['#7FE0C2', '#F2B04C', '#E0473C', '#56A8E9', '#E57CC0', '#F4F1E8'];

// ------------------------------------------------------------------ Fallback-Modelle (lokal: Kachelmitte = Ursprung, Boden y = 0, vorn = +z)
const FB = {
  // --- Plattform ---
  'away/platform/floor'(pen, p) {
    const s = p.seed | 0;
    pen.box(-0.5, -0.04, -0.5, 0.5, -0.02, 0.5, C(COL.platSeam), null, { faces: 'top', jit: false });
    pen.box(-0.47, -0.04, -0.47, 0.47, 0, 0.47, C(s % 5 === 0 ? COL.platFloor2 : COL.platFloor), C(COL.platSeam));
    if (s % 7 === 3) pen.box(-0.3, 0, -0.06, 0.3, 0.012, 0.06, C('#6C7890'), null, { faces: 'top' });   // Riffelblech-Streifen
  },
  'away/platform/wall'(pen, p) {
    const H = p.cut ? 1.25 : 3;
    pen.box(-0.5, 0, -0.5, 0.5, H, 0.5, C(COL.platWallTop), C(COL.platWall));
    pen.box(-0.52, H - 0.3, -0.52, 0.52, H - 0.16, 0.52, C(COL.platTrim), C(COL.platTrim), { skip: ['y-'] });
    if (!p.cut && !(p.conn & 4)) pen.box(-0.32, 2.0, 0.5, 0.32, 2.07, 0.53, C(COL.platGlow, 1.6), null, { emit: true });   // Lichtleiste
  },
  'away/platform/door_locked'(pen, p) {
    pen.box(-0.5, 0, -0.32, -0.38, 2.6, 0.32, C(COL.platWallTop), C(COL.platWall));
    pen.box(0.38, 0, -0.32, 0.5, 2.6, 0.32, C(COL.platWallTop), C(COL.platWall));
    pen.box(-0.5, 2.3, -0.32, 0.5, 2.6, 0.32, C(COL.platWallTop), C(COL.platWall));
    if (p.open) {
      pen.box(-0.38, 0, -0.08, 0.38, 0.03, 0.08, C('#2E3440'), null);
      pen.box(-0.1, 2.12, 0.32, 0.1, 2.2, 0.34, C('#7FE0C2', 1.6), null, { emit: true });
    } else {
      pen.box(-0.38, 0, -0.14, 0.38, 2.3, 0.14, C('#5A4048'), C('#4A3238'));
      for (let i = 0; i < 3; i++) pen.box(-0.3, 0.5 + i * 0.6, 0.14, 0.3, 0.56 + i * 0.6, 0.16, C('#E0473C', 1.5), null, { emit: true });
      pen.box(-0.1, 2.12, 0.32, 0.1, 2.2, 0.34, C('#E0473C', 1.8), null, { emit: true });
    }
  },
  'away/platform/buoy_core'(pen, p) {
    // 2×2: Ursprung = Blockmitte
    const st = p.state | 0;
    pen.box(-0.95, 0, -0.95, 0.95, 0.25, 0.95, C('#4A4590'), C(COL.indigoDark));
    pen.box(-0.75, 0.25, -0.75, 0.75, 0.4, 0.75, C(COL.indigo), C(COL.indigoDark));
    for (const [x, z] of [[-0.7, -0.7], [0.55, -0.7], [-0.7, 0.55], [0.55, 0.55]]) pen.box(x, 0.4, z, x + 0.15, 1.9, z + 0.15, C('#6A64B0'), C(COL.indigo));
    pen.box(-0.75, 1.9, -0.75, 0.75, 2.05, 0.75, C('#6A64B0'), C(COL.indigo));
    const core = st === 0 ? C('#7FE0C2', 1.8) : st === 1 ? C('#F2C94C', 1.6) : null;
    if (core) pen.box(-0.25, 0.45, -0.25, 0.25, 1.75, 0.25, core, null, { emit: true });
    else pen.box(-0.25, 0.4, -0.25, 0.25, 1.75, 0.25, C('#2A2840'), C('#1E1C30'));
    if (st === 1) pen.box(-0.55, 0.4, 0.62, 0.55, 1.2, 0.68, C('#2A2840'), C('#3A3570'));   // Wartungsklappe offen
  },
  'away/platform/sonde'(pen, p) {
    pen.box(-0.32, 0, -0.32, 0.32, 0.25, 0.32, C('#4A4590'), C(COL.indigoDark));
    pen.box(-0.18, 0.25, -0.18, 0.18, 1.25, 0.18, C('#3A3448'), C('#2C2838'));
    pen.box(-0.28, 1.25, -0.28, 0.28, 1.5, 0.28, C('#5A5490'), C(COL.indigo));
    const c = p.on ? C(SONDE_COLORS[(p.color | 0) % 6], 1.8) : C('#4A4E58');
    pen.box(-0.16, 1.5, -0.16, 0.16, 1.72, 0.16, c, null, { emit: !!p.on });
    if (p.on) pen.box(-0.12, 0.7, 0.18, 0.12, 0.95, 0.2, c, null, { emit: true });
  },
  'lerche/kit/pad'(pen) {
    pen.box(-0.45, 0, -0.45, 0.45, 0.06, 0.45, C('#3A4250'), C('#262C36'));
    for (const [a, b, c2, d] of [[-0.36, -0.36, 0.36, -0.3], [-0.36, 0.3, 0.36, 0.36], [-0.36, -0.3, -0.3, 0.3], [0.3, -0.3, 0.36, 0.3]]) {
      pen.box(a, 0.06, b, c2, 0.08, d, C('#7FE0C2', 1.4), null, { emit: true });
    }
    pen.box(-0.08, 0.06, -0.08, 0.08, 0.09, 0.08, C('#9FD8FF', 1.2), null, { emit: true });
  },
  'lerche/furn/crate'(pen, p) {
    const r = hash2(p.seed | 0, 3, 7);
    const w = 0.36 + r * 0.06;
    pen.box(-w, 0, -0.32, w, 0.66, 0.32, C('#7D6A4C'), C('#6B5A40'));
    pen.box(-w - 0.01, 0.1, -0.33, w + 0.01, 0.16, 0.33, C('#3E3428'), C('#3E3428'), { skip: ['y-'] });
    pen.box(-w - 0.01, 0.5, -0.33, w + 0.01, 0.56, 0.33, C('#3E3428'), C('#3E3428'), { skip: ['y-'] });
    if (r > 0.5) pen.box(-0.25, 0.66, -0.2, 0.2, 0.98, 0.22, C('#857254'), C('#6E5D44'));
  },
  // --- Wrack ---
  'away/wreck/floor'(pen, p) {
    const s = p.seed | 0;
    const top = s % 9 === 0 ? COL.wrScorch : s % 3 === 0 ? COL.wrFloor2 : COL.wrFloor;
    pen.box(-0.5, -0.04, -0.5, 0.5, -0.02, 0.5, C(COL.wrSeam), null, { faces: 'top', jit: false });
    pen.box(-0.47, -0.05, -0.47, 0.47, s % 11 === 5 ? -0.03 : 0, 0.47, C(top), C(COL.wrSeam));
    if (s % 13 === 4) pen.box(-0.2, 0, 0.05, 0.25, 0.015, 0.2, C(COL.wrRust), null, { faces: 'top' });
  },
  'away/wreck/grate'(pen) {
    // Gitter über dunklem Schacht; Streben quer zur Laufrichtung (Laufrichtung = lokale x-Achse)
    pen.box(-0.5, -0.7, -0.5, 0.5, -0.68, 0.5, C(COL.wrPit), null, { faces: 'top', jit: false });
    pen.box(-0.5, -0.7, -0.5, 0.5, 0, -0.42, C(COL.wrGrate), C('#2A2522'));
    pen.box(-0.5, -0.7, 0.42, 0.5, 0, 0.5, C(COL.wrGrate), C('#2A2522'));
    for (let i = 0; i < 5; i++) { const x = -0.45 + i * 0.2; pen.box(x, -0.08, -0.42, x + 0.07, 0, 0.42, C(COL.wrGrate), C('#2E2824')); }
  },
  'away/wreck/wall'(pen, p, T) {
    const H = p.cut ? 1.25 : 3;
    const seed = p.seed | 0;
    if (p.bent) {
      // verbogen: oben verschoben und gekippt, gezackte Kante
      const m = new T.Matrix4().makeRotationX((hash2(seed, 1, 2) - 0.5) * 0.35).premultiply(new T.Matrix4().makeRotationZ((hash2(seed, 5, 2) - 0.5) * 0.3));
      const base = pen.m.clone();
      pen.box(-0.5, 0, -0.5, 0.5, H * 0.45, 0.5, C(COL.wrWallTop), C(COL.wrWall));
      pen.at(base.clone().multiply(new T.Matrix4().makeTranslation(0, H * 0.45, 0)).multiply(m));
      const h1 = H * (0.4 + hash2(seed, 9, 1) * 0.15), h2 = H * (0.3 + hash2(seed, 3, 8) * 0.25);
      pen.box(-0.5, 0, -0.45, 0.02, h1, 0.45, C(COL.wrWallTop), C(COL.wrWall));
      pen.box(0.02, 0, -0.45, 0.5, h2, 0.45, C(COL.wrWallTop), C(COL.wrRust));
      pen.at(base);
    } else {
      pen.box(-0.5, 0, -0.5, 0.5, H, 0.5, C(COL.wrWallTop), C(COL.wrWall));
      pen.box(-0.51, H * 0.35, -0.51, 0.51, H * 0.35 + 0.08, 0.51, C('#2A2522'), C('#2A2522'), { skip: ['y-'] });
      if (seed % 3 === 0) pen.box(-0.2, 0.1, 0.5, 0.0, H * 0.6, 0.515, C(COL.wrRust), C(COL.wrRust));   // Rostspur
    }
  },
  'away/wreck/wall_weak'(pen, p) {
    const H = p.cut ? 1.25 : 3, st = p.state | 0;
    if (st === 2) {
      // aufgebrochen: Stummel links/rechts, Bruchstücke am Boden
      pen.box(-0.5, 0, -0.4, -0.3, H * 0.8, 0.4, C(COL.wrWallTop), C('#4E4842'));
      pen.box(0.3, 0, -0.4, 0.5, H * 0.6, 0.4, C(COL.wrWallTop), C('#4E4842'));
      pen.box(-0.25, 0, -0.1, -0.05, 0.12, 0.15, C('#5A524B'), C('#3E3935'));
      pen.box(0.05, 0, 0.1, 0.22, 0.09, 0.3, C('#5A524B'), C('#3E3935'));
      return;
    }
    pen.box(-0.5, 0, -0.42, 0.5, H, 0.42, C('#6A625A'), C('#4E4842'));
    for (let i = 0; i < 3; i++) pen.box(-0.35 + i * 0.25, 0.2 + i * 0.25, 0.42, -0.3 + i * 0.25, 0.75 + i * 0.25, 0.44, C('#24201D'), C('#24201D'));   // Risse
    if (st === 1) {
      const a = C('#F2C94C', 1.6), o = { emit: true };
      pen.box(-0.48, 0.05, 0.43, 0.48, 0.12, 0.46, a, null, o);
      pen.box(-0.48, H - 0.12, 0.43, 0.48, H - 0.05, 0.46, a, null, o);
      pen.box(-0.48, 0.05, 0.43, -0.41, H - 0.05, 0.46, a, null, o);
      pen.box(0.41, 0.05, 0.43, 0.48, H - 0.05, 0.46, a, null, o);
    }
  },
  'away/wreck/salvage'(pen, p, T) {
    pen.box(-0.42, 0, -0.32, 0.42, 0.62, 0.32, C('#5E6650'), C('#4A5040'));
    pen.box(-0.43, 0.12, -0.33, 0.43, 0.18, 0.33, C('#2E3228'), C('#2E3228'), { skip: ['y-'] });
    pen.box(-0.43, 0.44, -0.33, 0.43, 0.5, 0.33, C('#2E3228'), C('#2E3228'), { skip: ['y-'] });
    if (p.open) {
      pen.box(-0.36, 0.5, -0.26, 0.36, 0.62, 0.26, C('#141210'), null, { faces: 'top' });   // innen leer
      const base = pen.m.clone();
      pen.at(base.clone().multiply(new T.Matrix4().makeTranslation(0, 0.62, -0.32)).multiply(new T.Matrix4().makeRotationX(-1.2)));
      pen.box(-0.42, 0, 0, 0.42, 0.06, 0.64, C('#66705A'), C('#4A5040'));
      pen.at(base);
      pen.box(-0.06, 0.3, 0.32, 0.06, 0.38, 0.34, C('#3A3F47'), null);
    } else {
      pen.box(-0.42, 0.62, -0.32, 0.42, 0.7, 0.32, C('#6E7860'), C('#4A5040'));
      pen.box(-0.06, 0.3, 0.32, 0.06, 0.4, 0.345, C('#F2B04C', 1.7), null, { emit: true });
    }
  },
  'away/wreck/lore_terminal'(pen, p, T) {
    pen.box(-0.35, 0, -0.28, 0.35, 0.85, 0.2, C('#3A404C'), C('#2A2F38'));
    const base = pen.m.clone();
    pen.at(base.clone().multiply(new T.Matrix4().makeTranslation(0, 0.85, 0.1)).multiply(new T.Matrix4().makeRotationX(-0.6)));
    pen.box(-0.33, 0, -0.02, 0.33, 0.42, 0.04, C('#2A2F38'), C('#2A2F38'));
    pen.box(-0.27, 0.05, 0.04, 0.27, 0.37, 0.06, p.read ? C('#3A5560') : C('#A9D6E5', 1.6), null, { emit: !p.read });
    pen.at(base);
  },
  'away/wreck/debris'(pen, p, T) {
    const s = p.seed | 0, base = pen.m.clone();
    const n = 3 + Math.floor(hash2(s, 1, 1) * 3);
    const cols = ['#4A423C', '#5A5048', '#3A3430', '#6B4A35'];
    for (let i = 0; i < n; i++) {
      const x = (hash2(s, i, 2) - 0.5) * 0.6, z = (hash2(s, i, 3) - 0.5) * 0.6;
      const w = 0.15 + hash2(s, i, 4) * 0.3, d = 0.1 + hash2(s, i, 5) * 0.25, h = 0.1 + hash2(s, i, 6) * (i === 0 ? 0.7 : 0.35);
      pen.at(base.clone().multiply(new T.Matrix4().makeTranslation(x, 0, z)).multiply(new T.Matrix4().makeRotationY(hash2(s, i, 7) * 3)).multiply(new T.Matrix4().makeRotationZ((hash2(s, i, 8) - 0.5) * 0.5)));
      const c = C(cols[i % 4]);
      pen.box(-w / 2, 0, -d / 2, w / 2, h, d / 2, mulC(c, 1.15), c);
    }
    pen.at(base);
  },
  // --- Kesh ---
  'away/kesh/floor_ruin'(pen, p) {
    const s = p.seed | 0;
    pen.box(-0.5, -0.3, -0.5, 0.5, -0.06, 0.5, C(COL.ruinGrout), null, { faces: 'top', jit: false });
    const tops = [COL.ruinFloor, COL.ruinFloor2, COL.ruinFloor3];
    for (let i = 0; i < 4; i++) {
      const x0 = i % 2 ? 0.02 : -0.48, z0 = i < 2 ? -0.48 : 0.02;
      const dip = hash2(s, i, 4) < 0.2 ? -0.025 : 0;
      const sandy = hash2(s, i, 9) < 0.06;
      pen.box(x0, -0.06, z0, x0 + 0.46, dip, z0 + 0.46, C(sandy ? COL.sand2 : tops[Math.floor(hash2(s, i, 5) * 3)]), C(COL.ruinGrout));
    }
    if (hash2(s, 7, 7) > 0.88) pen.box(-0.3, 0, -0.04, -0.05, 0.006, 0.04, C(COL.violet, 1.2), null, { emit: true });   // Glyphe
  },
  'away/kesh/wall_ruin'(pen, p) {
    const H = p.cut ? 1.25 : 3, s = p.seed | 0;
    const layers = Math.round(H / 0.5);
    for (let l = 0; l < layers; l++) {
      const y0 = l * 0.5, top = l === layers - 1;
      const off = l % 2 ? -0.18 : 0.12;
      for (let b = 0; b < 2; b++) {
        const x0 = b === 0 ? -0.5 : off, x1 = b === 0 ? off : 0.5;
        let y1 = Math.min(H, y0 + 0.5);
        if (top && p.decay && hash2(s, b, l) < 0.55) y1 = y0 + 0.15 + hash2(s, b, l + 9) * 0.2;   // verfallen: Kante bricht weg
        const c = C(hash2(s, b, l + 3) < 0.5 ? COL.ruinWall : COL.ruinWall2);
        pen.box(x0, y0, -0.5, x1, y1, 0.5, top ? C(COL.ruinWallTop) : c, c, { low: l === 0 ? 0.8 : 0.92 });
      }
    }
    if (s % 3 === 0 && !(p.conn & 4)) pen.box(-0.12, Math.min(H - 0.4, 0.8), 0.5, 0.12, Math.min(H - 0.4, 0.8) + 0.08, 0.52, C(COL.violet, 1.5), null, { emit: true });
  },
  'away/kesh/cover_low'(pen, p) {
    // halbe Deckung: ≤ 0,9 m, helle Oberkante, nie Bodenfarbe; läuft zu Nachbar-Mauerresten durch (p.l/p.r)
    const x0 = p.l ? -0.5 : -0.44, x1 = p.r ? 0.5 : 0.44;
    pen.box(x0, 0, -0.3, x1, 0.66, 0.3, C(COL.coverBody), C(COL.coverBody), { low: 0.72 });
    if (p.damaged) {
      pen.box(x0, 0.66, -0.31, -0.05, 0.8, 0.31, C(COL.coverTop), C('#D8CCB4'));
      pen.box(0.2, 0.66, -0.31, x1, 0.8, 0.31, C(COL.coverTop), C('#D8CCB4'));
      pen.box(-0.05, 0.66, -0.25, 0.2, 0.7, 0.25, C('#5A5262'), C('#5A5262'));
    } else pen.box(x0, 0.66, -0.31, x1, 0.8, 0.31, C(COL.coverTop), C('#D8CCB4'));
    pen.box(-0.2, 0.25, 0.3, -0.16, 0.5, 0.31, C('#4A4252'), C('#4A4252'));
  },
  'away/kesh/pillar'(pen) {
    // volle Deckung: ≥ 2,2 m, dunkle Krone, Schatten am Boden
    pen.box(-0.62, 0, -0.62, 0.62, 0.012, 0.62, C(COL.pillarShadow), null, { faces: 'top', jit: false });
    pen.box(-0.42, 0, -0.42, 0.42, 0.3, 0.42, C(COL.pillarLight), C('#5A5068'));
    pen.box(-0.29, 0.3, -0.29, 0.29, 2.05, 0.29, C(COL.pillarLight), C(COL.pillarShaft), { low: 0.7 });
    pen.box(-0.3, 1.2, -0.3, 0.3, 1.28, 0.3, C(COL.violet, 1.5), null, { emit: true });
    pen.box(-0.45, 2.05, -0.45, 0.45, 2.38, 0.45, C(COL.pillarCrown), C('#2E2738'));
  },
  'away/kesh/jammer'(pen, p) {
    pen.box(-0.38, 0, -0.38, 0.38, 0.3, 0.38, C('#4A4252'), C('#3E3644'));
    pen.box(-0.24, 0.3, -0.2, 0.24, 0.85, 0.2, C('#5A4E62'), C(p.on ? '#4A4252' : '#34303A'));
    pen.box(-0.2, 0.5, 0.2, 0.2, 0.58, 0.22, C('#8A4A2E'), null);
    pen.box(-0.04, 0.85, -0.04, 0.04, 1.75, 0.04, C('#6B7380'), C('#555C68'));
    pen.box(-0.22, 1.35, -0.03, 0.22, 1.39, 0.03, C('#6B7380'), C('#555C68'));
  },
  'away/kesh/jammer#light'(pen, p) {
    pen.box(-0.1, 1.75, -0.1, 0.1, 1.93, 0.1, p.on ? C(COL.jam, 2.0) : C('#3A2A36'), C('#3A2A36'), { emit: !!p.on });
  },
  'away/kesh/archive_key'(pen) {
    pen.box(-0.4, 0, -0.32, 0.4, 0.62, 0.32, C('#6E6480'), C('#5A5070'), { low: 0.75 });
    pen.box(-0.42, 0.62, -0.34, 0.42, 0.74, 0.34, C(COL.coverTop), C('#D8CCB4'));
  },
  'away/kesh/archive_key#crystal'(pen, p) {
    const f = p.pos === 2 ? 2.2 : p.pos === 1 ? 1.6 : 0.9;
    const c = C(COL.violet, f), o = { emit: true };
    pen.box(-0.06, 0, -0.06, 0.06, 0.08, 0.06, c, null, o);
    pen.box(-0.12, 0.08, -0.12, 0.12, 0.18, 0.12, c, null, o);
    pen.box(-0.17, 0.18, -0.17, 0.17, 0.3, 0.17, c, null, o);
    pen.box(-0.12, 0.3, -0.12, 0.12, 0.4, 0.12, c, null, o);
    pen.box(-0.06, 0.4, -0.06, 0.06, 0.48, 0.06, c, null, o);
  },
  'away/kesh/vault_gate'(pen, p) {
    // 2 Kacheln breit: Ursprung = Mitte zwischen beiden Kacheln
    const st = p.open | 0;
    pen.box(-1.0, 0, -0.45, -0.75, 1.9, 0.45, C(COL.ruinWallTop), C('#3A3148'));
    pen.box(0.75, 0, -0.45, 1.0, 1.9, 0.45, C(COL.ruinWallTop), C('#3A3148'));
    pen.box(-1.0, 1.65, -0.45, 1.0, 1.9, 0.45, C('#4E4462'), C('#3A3148'));
    if (st === 2) {
      pen.box(-0.75, 0, -0.1, 0.75, 0.02, 0.1, C('#2A2333'), null, { faces: 'top' });
      pen.box(-0.7, 1.58, 0.45, 0.7, 1.63, 0.47, C(COL.violet, 1.4), null, { emit: true });
      return;
    }
    const y0 = st === 1 ? 0.55 : 0;
    pen.box(-0.75, y0, -0.18, 0.75, 1.65, 0.18, C('#4E4462'), C('#3A3148'));
    const c = C(COL.violet, st === 1 ? 2.2 : 1.4);
    for (let i = 0; i < 3; i++) pen.box(-0.5 + i * 0.45, y0 + 0.15, 0.18, -0.42 + i * 0.45, 1.5, 0.2, c, null, { emit: true });
  },
  'away/kesh/tablet_pedestal'(pen, p, T) {
    pen.box(-0.4, 0, -0.32, 0.4, 0.62, 0.32, C('#7A7086'), C('#5E5470'), { low: 0.75 });
    pen.box(-0.42, 0.62, -0.34, 0.42, 0.74, 0.34, C(COL.coverTop), C('#D8CCB4'));
    if (p.present) {
      const base = pen.m.clone();
      pen.at(base.clone().multiply(new T.Matrix4().makeTranslation(0, 0.74, 0)).multiply(new T.Matrix4().makeRotationX(-0.35)));
      pen.box(-0.2, 0, -0.04, 0.2, 0.5, 0.04, C('#B07040'), C('#9A5A3A'));
      for (let i = 0; i < 4; i++) pen.box(-0.14, 0.08 + i * 0.1, 0.04, 0.14, 0.12 + i * 0.1, 0.05, C(COL.gold, 1.4), null, { emit: true });
      pen.at(base);
    } else pen.box(-0.22, 0.74, -0.06, 0.22, 0.78, 0.06, C('#2A2430'), null);
  },
  'away/kesh/rubble'(pen, p, T) {
    const s = p.seed | 0, base = pen.m.clone();
    const n = 2 + Math.floor(hash2(s, 2, 2) * 3);
    const cols = ['#5A5058', '#6E6150', '#4A424A', '#7A7086'];
    for (let i = 0; i < n; i++) {
      const x = (hash2(s, i, 11) - 0.5) * 0.5, z = (hash2(s, i, 12) - 0.5) * 0.5, w = 0.06 + hash2(s, i, 13) * 0.14, h = 0.04 + hash2(s, i, 14) * 0.12;
      pen.at(base.clone().multiply(new T.Matrix4().makeTranslation(x, 0, z)).multiply(new T.Matrix4().makeRotationY(hash2(s, i, 15) * 3)));
      const c = C(cols[i % 4]);
      pen.box(-w, 0, -w * 0.8, w, h, w * 0.8, mulC(c, 1.1), c);
    }
    pen.at(base);
  },
};

// ------------------------------------------------------------------ Nebel des Krieges (Shader-Patch)
function makeFogUniforms(THREE, w, h) {
  const data = new Uint8Array(w * h * 4).fill(255);
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return {
    tex: { value: tex }, rect: { value: new THREE.Vector4(0, 0, 1 / w, 1 / h) }, on: { value: 0 },
    data, w, h, cur: new Float32Array(w * h).fill(1), target: new Float32Array(w * h).fill(1),
  };
}
function patchFog(mat, U) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uAwayFogTex = U.tex; sh.uniforms.uAwayFogRect = U.rect; sh.uniforms.uAwayFogOn = U.on;
    sh.vertexShader = 'varying vec2 vAwayXZ;\n' + sh.vertexShader.replace('#include <project_vertex>', [
      '#include <project_vertex>',
      '{ vec4 awp = vec4(transformed, 1.0);',
      '#ifdef USE_INSTANCING',
      '  awp = instanceMatrix * awp;',
      '#endif',
      '  awp = modelMatrix * awp; vAwayXZ = awp.xz; }',
    ].join('\n'));
    sh.fragmentShader = 'uniform sampler2D uAwayFogTex;\nuniform vec4 uAwayFogRect;\nuniform float uAwayFogOn;\nvarying vec2 vAwayXZ;\n' +
      sh.fragmentShader.replace('#include <dithering_fragment>', [
        '#include <dithering_fragment>',
        'if (uAwayFogOn > 0.5) {',
        '  float fv = texture2D(uAwayFogTex, (vAwayXZ - uAwayFogRect.xy) * uAwayFogRect.zw).r;',
        '  float fl = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));',
        '  gl_FragColor.rgb = mix(vec3(fl), gl_FragColor.rgb, 0.3 + 0.7 * fv) * (0.35 + 0.65 * fv);',
        '}',
      ].join('\n'));
  };
  mat.customProgramCacheKey = () => 'awayFog1';
  return mat;
}

// ------------------------------------------------------------------ Layer
const ZONE_CFG = {
  platform: {
    mood: 'platform_space', moodFallback: 'ship_interior',
    floorId: 'away/platform/floor', wallId: 'away/platform/wall',
    wallish: (ch) => ch === '#' || ch === 'L',
    stars: { count: 1400, bright: 1 },
  },
  wreck: {
    mood: 'wreck_dark', moodFallback: 'ship_interior',
    floorId: 'away/wreck/floor', wallId: 'away/wreck/wall',
    wallish: (ch) => ch === '#' || ch === 'V',
    stars: { count: 700, bright: 0.55 },
  },
  kesh: {
    mood: 'kesh_dusk', moodFallback: 'planet_dusk',
    floorId: 'away/kesh/floor_ruin', wallId: 'away/kesh/wall_ruin',
    wallish: (ch) => ch === '#' || ch === 'G' || ch === 'k' || ch === 'R',   // ART-H: Nachbarn Wand/Tor/Fels
    stars: null,
  },
};
// Alle Asset-IDs je Zone (§3.6) – werden beim Bau vorgeladen
const ZONE_ASSETS = {
  platform: ['away/platform/floor', 'away/platform/wall', 'away/platform/edge', 'away/platform/door_locked', 'away/platform/buoy_core', 'away/platform/sonde', 'lerche/furn/crate', 'lerche/kit/pad'],
  wreck: ['away/wreck/floor', 'away/wreck/grate', 'away/wreck/wall', 'away/wreck/wall_weak', 'away/wreck/salvage', 'away/wreck/lore_terminal', 'away/wreck/debris', 'lerche/kit/pad'],
  kesh: ['away/kesh/floor_ruin', 'away/kesh/wall_ruin', 'away/kesh/cover_low', 'away/kesh/pillar', 'away/kesh/jammer', 'away/kesh/archive_key',
    'away/kesh/vault_gate', 'away/kesh/tablet_pedestal', 'away/kesh/rubble', 'lerche/kit/pad'],
};
const KESH_RUIN = { ',': 1, L: 1, a: 1, b: 1, c: 1 };
const KESH_OBJ = { o: 1, I: 1, r: 1, k: 1, G: 1, T: 1 };

function makeLayer(zone) {
  const Z = ZONE_CFG[zone];
  let S = null;   // Zustand des aktuellen Baus

  // Im Manifest? Ist das Manifest des Loaders leer (Format-Abweichung o. Ä.), optimistisch versuchen –
  // loader.geometries liefert dann null für Fehlendes, und der Fallback greift.
  function hasAsset(ctx, id) {
    const L = ctx.loader;
    if (!L || typeof L.manifest !== 'function') return false;
    try {
      if (L.manifest(id)) return true;
      if (typeof L.isMissing === 'function' && L.isMissing(id)) return false;
      return typeof L.manifestIds === 'function' && L.manifestIds().length === 0;
    } catch (e) { return false; }
  }
  const countFb = (id) => { S.stats.fallback[id] = (S.stats.fallback[id] || 0) + 1; };
  // Geometrien eines Assets ({ lit, emit } in Metern, Anker im Ursprung) oder null → Fallback.
  // Nutzt loader.geometries (CORE); Assets werden in build() vorher per loadMany geladen.
  function assetGeo(ctx, id, params) {
    if (!hasAsset(ctx, id) || typeof ctx.loader.geometries !== 'function') { countFb(id); return null; }
    try {
      const g = ctx.loader.geometries(id, params || {});
      if (!g || (!g.lit && !g.emit)) { countFb(id); return null; }
      S.stats.assets[id] = (S.stats.assets[id] || 0) + 1;
      return g;
    } catch (e) { ctx.countError('away.asset:' + id, e); countFb(id); return null; }
  }
  // Höhe eines Loader-Bodens: Oberkante auf y = 0 legen (Figuren stehen auf y = 0)
  const floorShift = new Map();
  function floorOffset(id, g) {
    if (floorShift.has(id)) return floorShift.get(id);
    let dy = 0;
    try {
      const geo = g.lit || g.emit;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const bb = geo.boundingBox;
      if (isFinite(bb.max.y) && bb.max.y - bb.min.y < 0.6) dy = -bb.max.y;
    } catch (e) { /* bleibt 0 */ }
    floorShift.set(id, dy);
    return dy;
  }

  /** Statisch platzieren: Asset (gemerged) oder Fallback. m = Weltmatrix (Kachelmitte, Drehung). */
  function placeStatic(ctx, _set, pen, id, params, m, opts = {}) {
    const T = ctx.THREE;
    const set = chunkAtWorld(m.elements[12], m.elements[14]);
    pen.set = set;
    const g = assetGeo(ctx, id, params);
    if (g) {
      let mm = m;
      if (opts.floor) { const dy = floorOffset(id, g) + (opts.lift || 0); if (dy) mm = m.clone().multiply(new T.Matrix4().makeTranslation(0, dy, 0)); }
      if (g.lit) set.lit.addGeometry(T, g.lit, mm);
      if (g.emit) set.emit.addGeometry(T, g.emit, mm);
      return true;
    }
    const fb = FB[id];
    if (fb) { pen.at(m); fb(pen, Object.assign({}, params || {}, opts.fbParams || {}), T); }
    return false;
  }

  function tileMatrix(ctx, tx, ty, rotY = 0, dx = 0, dz = 0) {
    const T = ctx.THREE, p = ctx.tile(tx, ty);
    const m = new T.Matrix4().makeRotationY(rotY);
    m.setPosition(p.x + dx, p.y || 0, p.z + dz);
    return m;
  }
  // Blickrichtung +z zur ersten begehbaren Nachbarkachel (+z, −z, −x, +x), §3.3
  function facingRot(map, tx, ty, walk) {
    if (walk(tx, ty + 1)) return 0;
    if (walk(tx, ty - 1)) return Math.PI;
    if (walk(tx - 1, ty)) return -Math.PI / 2;
    if (walk(tx + 1, ty)) return Math.PI / 2;
    return 0;
  }

  function makeMats(ctx) {
    const T = ctx.THREE;
    const lit = patchFog(new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }), S.fog);
    const emit = patchFog(new T.MeshBasicMaterial({ vertexColors: true }), S.fog);
    S.mats.push(lit, emit);
    return { lit, emit };
  }
  function meshesFrom(ctx, set, mats, name, shadow = true) {
    const T = ctx.THREE, out = [];
    const gl = set.lit.toGeometry(T), ge = set.emit.toGeometry(T);
    if (gl) { const m = new T.Mesh(gl, mats.lit); m.name = name + ':lit'; m.castShadow = shadow; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); out.push(m); S.geos.push(gl); S.stats.tris += gl.index.count / 3; }
    if (ge) { const m = new T.Mesh(ge, mats.emit); m.name = name + ':emit'; m.userData.bloom = true; m.matrixAutoUpdate = false; m.updateMatrix(); out.push(m); S.geos.push(ge); S.stats.tris += ge.index.count / 3; }
    return out;
  }
  const newSet = () => ({ lit: new Bucket(), emit: new Bucket() });
  // Statisches in Chunks (CHUNK × CHUNK Kacheln) → Frustum-Culling in Bild- und Schattenpass
  const CHUNK = 12;
  function chunkAtTile(tx, ty) {
    const k = Math.floor(tx / CHUNK) + ',' + Math.floor(ty / CHUNK);
    let c = S.chunks.get(k);
    if (!c) { c = newSet(); S.chunks.set(k, c); }
    return c;
  }
  function chunkAtWorld(x, z) {
    const R = S.mapRect;
    return chunkAtTile(Math.floor((x - R.x0) / R.sx), Math.floor((z - R.z0) / R.sz));
  }


  // ---------------------------------------------------------------- Bau
  async function build(ctx) {
    const T = ctx.THREE;
    const map = ctx.map || (G.Shared_Maps && G.Shared_Maps[zone]);
    if (!map) throw new Error('away: Karte "' + zone + '" fehlt');
    if (S) dispose(ctx);
    // Palette mond_kesh (ART-H) für das Gelände, falls schon ausgeliefert; sonst eingebaute Farben
    const palette = zone === 'kesh' ? await loadPalette('mond_kesh') : null;
    if (S) dispose(ctx);
    S = {
      map, root: ctx.root, geos: [], mats: [], matClones: new Map(), dyn: [], lamps: [], lights: [], fbCache: new Map(),
      fog: makeFogUniforms(T, map.w, map.h), fogCache: { t: -1e9, key: '' }, fogActive: false,
      stats: { tris: 0, fallback: {}, assets: {}, buildMs: 0 }, ready: false, time: 0, stars: null, palette, chunks: new Map(),
    };
    const S0 = S;
    const t0 = performance.now();
    // Loader abwarten und alle Assets der Zone vorladen (höchstens 8 s – sonst Fallbacks; die Assets kommen beim nächsten Bau)
    const L = ctx.loader;
    if (L) {
      const timeout = (ms) => new Promise((r) => setTimeout(r, ms));
      try {
        if (L.ready) await Promise.race([L.ready, timeout(5000)]);
        const ids = ZONE_ASSETS[zone].filter((id) => hasAsset(ctx, id));
        if (ids.length && typeof L.loadMany === 'function') await Promise.race([L.loadMany(ids), timeout(8000)]);
        S.stats.preloaded = ids.length;
      } catch (e) { ctx.countError('away.loader', e); }
    }
    if (S !== S0) return;   // inzwischen neu gebaut/entsorgt
    // Stimmung
    try { const r = ctx.setMood(Z.mood); if (r === false) ctx.setMood(Z.moodFallback); } catch (e) { try { ctx.setMood(Z.moodFallback); } catch (e2) { ctx.countError('away.mood', e2); } }
    // Kartenlage für den Nebel: Ursprung und Maßstab aus ctx.tile
    const a = ctx.tile(0, 0), b = ctx.tile(1, 1);
    const sx = (b.x - a.x) || 1, sz = (b.z - a.z) || 1;
    S.fog.rect.value.set(a.x - sx / 2, a.z - sz / 2, 1 / (sx * map.w), 1 / (sz * map.h));
    S.mapRect = { x0: a.x - sx / 2, z0: a.z - sz / 2, sx, sz };

    const mats = makeMats(ctx);
    S.baseMats = mats;
    const set = newSet(), pen = new Pen(T, set);
    if (zone === 'platform') buildPlatform(ctx, map, set, pen);
    else if (zone === 'wreck') buildWreck(ctx, map, set, pen);
    else buildKesh(ctx, map, set, pen);
    for (const [k, cs] of S.chunks) for (const m of meshesFrom(ctx, cs, mats, zone + ':static:' + k)) ctx.root.add(m);
    S.stats.chunks = S.chunks.size;
    if (Z.stars) addStars(ctx, map, Z.stars);
    if (zone === 'wreck') buildWreckLights(ctx, map);
    S.stats.buildMs = Math.round(performance.now() - t0);
    S.ready = true;
    S.stats.staticTris = S.stats.tris;
  }

  // Gemeinsame Kachel-Logik für Plattform/Wrack: Wände mit conn/cut, Böden unter allem Begehbaren und unter Objekten
  // inside(x, y): Kachel liegt im Gebäude/auf der Plattform (nicht All, nicht Fels, nicht außerhalb der Karte)
  function wallParams(map, tx, ty, wallish, inside) {
    const w = (x, y) => wallish(map.at(x, y));
    const conn = (w(tx, ty - 1) ? 1 : 0) | (w(tx + 1, ty) ? 2 : 0) | (w(tx, ty + 1) ? 4 : 0) | (w(tx - 1, ty) ? 8 : 0);
    // §3.2 wie CORE im Schiff (ship.js: A.interior): nur die obere Außenhülle bleibt voll (3 m), alle Innenwände
    // werden geschnitten (1,25 m) – auch N-S-Wände, deren Nordnachbar selbst Wand ist (sonst verdecken sie die Sicht).
    const cut = inside(tx, ty - 1) ? 1 : 0;
    return { conn, cut };
  }

  function buildPlatform(ctx, map, set, pen) {
    const T = ctx.THREE;
    const inside = (x, y) => { const c = map.at(x, y); return c !== '~' && c !== ' ' && c != null && c !== undefined && x >= 0 && y >= 0 && x < map.w && y < map.h; };
    const walk = (x, y) => inside(x, y) && !Z.wallish(map.at(x, y));
    for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
      const ch = map.at(tx, ty);
      if (!inside(tx, ty)) continue;
      const seed = Math.floor(hash2(tx, ty, 11) * 64);
      if (ch === '#') { placeStatic(ctx, set, pen, Z.wallId, wallParams(map, tx, ty, Z.wallish, inside), tileMatrix(ctx, tx, ty)); continue; }
      placeStatic(ctx, set, pen, Z.floorId, { seed: calmSeed(tx, ty, 11) }, tileMatrix(ctx, tx, ty), { floor: true });
      if (ch === 'P') placeStatic(ctx, set, pen, 'lerche/kit/pad', { phase: 0 }, tileMatrix(ctx, tx, ty));
      else if (ch === 'x') placeStatic(ctx, set, pen, 'lerche/furn/crate', { seed: seed % 4 }, tileMatrix(ctx, tx, ty, facingRot(map, tx, ty, walk)));
      else if (ch === 'L') {
        // ART-H: Durchgang entlang lokal z; Tür in einer N-S-Wand (Durchgang O-W) → rot 90
        const vertical = Z.wallish(map.at(tx, ty - 1)) && Z.wallish(map.at(tx, ty + 1));
        const cut = inside(tx, ty - 1) ? 1 : 0;
        addDyn(ctx, { id: 'away/platform/door_locked', m: tileMatrix(ctx, tx, ty, vertical ? Math.PI / 2 : 0), params: (st) => ({ open: st.doorOpen ? 1 : 0, cut }) });
      } else if (ch === 'b' && map.at(tx - 1, ty) !== 'b' && map.at(tx, ty - 1) !== 'b') {
        const m = tileMatrix(ctx, tx, ty, 0, 0.5 * S.mapRect.sx, 0.5 * S.mapRect.sz);
        addDyn(ctx, { id: 'away/platform/buoy_core', m, params: (st) => ({ state: st.buoyState }), anim: animBuoy });
      } else if (ch === 'Z') {
        addDyn(ctx, { id: 'away/platform/sonde', m: tileMatrix(ctx, tx, ty, facingRot(map, tx, ty, walk)), params: (st) => ({ color: st.sondeColor, on: st.sondeOn ? 1 : 0 }) });
      }
    }
    // Rumpf unter der Plattform: Kante zum All, abgestuft nach unten, Positionslichter.
    // Mit ART-H-Asset: away/platform/edge (Rumpfschürze + Positionslichter) auf jeder Randkachel, edge = Seiten zum All (N1 O2 S4 W8).
    const hp = pen;
    const solidT = (x, y) => inside(x, y);
    const edgeAsset = hasAsset(ctx, 'away/platform/edge');
    for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
      if (!solidT(tx, ty)) continue;
      const skip = [];
      if (solidT(tx + 1, ty)) skip.push('x+'); if (solidT(tx - 1, ty)) skip.push('x-');
      if (solidT(tx, ty + 1)) skip.push('z+'); if (solidT(tx, ty - 1)) skip.push('z-');
      if (edgeAsset) {
        const edge = (solidT(tx, ty - 1) ? 0 : 1) | (solidT(tx + 1, ty) ? 0 : 2) | (solidT(tx, ty + 1) ? 0 : 4) | (solidT(tx - 1, ty) ? 0 : 8);
        // Schürze kommt vom Asset; nur die eingerückte zweite Stufe (unten) bleibt eigene Geometrie
        if (edge) placeStatic(ctx, set, pen, 'away/platform/edge', { edge, rail: 0 }, tileMatrix(ctx, tx, ty));
      }
      hp.set = chunkAtTile(tx, ty);
      hp.at(tileMatrix(ctx, tx, ty));
      if (!edgeAsset) hp.box(-0.5, -1.1, -0.5, 0.5, -0.04, 0.5, C(COL.platHull), C(COL.platHull), { skip: skip.concat(['y+']), low: 0.6 });
      // Positionslicht an der Außenkante alle ~3 Kacheln
      if (!edgeAsset && skip.length < 4 && hash2(tx, ty, 21) < 0.34) {
        if (!solidT(tx, ty + 1)) hp.box(-0.12, -0.5, 0.5, 0.12, -0.42, 0.53, C(COL.platGlow, 1.8), null, { emit: true });
        else if (!solidT(tx + 1, ty)) hp.box(0.5, -0.5, -0.12, 0.53, -0.42, 0.12, C(COL.platGlow, 1.8), null, { emit: true });
        else if (!solidT(tx - 1, ty)) hp.box(-0.53, -0.5, -0.12, -0.5, -0.42, 0.12, C(COL.platGlow, 1.8), null, { emit: true });
      }
      // zweite, eingerückte Stufe nur unter Innenkacheln
      let interior = true;
      for (let dy = -1; dy <= 1 && interior; dy++) for (let dx = -1; dx <= 1; dx++) if (!solidT(tx + dx, ty + dy)) { interior = false; break; }
      if (interior) {
        const sk = [];
        const inner = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!solidT(x + dx, y + dy)) return false; return true; };
        if (inner(tx + 1, ty)) sk.push('x+'); if (inner(tx - 1, ty)) sk.push('x-'); if (inner(tx, ty + 1)) sk.push('z+'); if (inner(tx, ty - 1)) sk.push('z-');
        hp.box(-0.5, -2.4, -0.5, 0.5, -1.1, 0.5, C(COL.platHullDark), C(COL.platHullDark), { skip: sk.concat(['y+']), low: 0.5 });
      }
    }
  }

  function buildWreck(ctx, map, set, pen) {
    const inside = (x, y) => { const c = map.at(x, y); return c != null && c !== '~' && c !== ' ' && x >= 0 && y >= 0 && x < map.w && y < map.h; };
    const walk = (x, y) => inside(x, y) && !Z.wallish(map.at(x, y));
    for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
      const ch = map.at(tx, ty);
      if (!inside(tx, ty)) continue;
      const seed = Math.floor(hash2(tx, ty, 13) * 64);
      if (ch === '#') {
        const wp = wallParams(map, tx, ty, Z.wallish, inside);
        placeStatic(ctx, set, pen, Z.wallId, { conn: wp.conn, cut: wp.cut, bent: hash2(tx, ty, 5) < 0.28 ? 1 : 0, seed: seed % 8 }, tileMatrix(ctx, tx, ty));
        continue;
      }
      // Boden (unter Objekten nach Mehrheit der Nachbarn wie render.js floorFor)
      const grate = ch === '_' || (ch !== '.' && majorityGrate(map, tx, ty));
      if (grate) {
        const vertical = walk(tx, ty - 1) && walk(tx, ty + 1) && !walk(tx - 1, ty) && !walk(tx + 1, ty);
        placeStatic(ctx, set, pen, 'away/wreck/grate', { seed: seed % 8 }, tileMatrix(ctx, tx, ty, vertical ? Math.PI / 2 : 0), { floor: true });
      } else placeStatic(ctx, set, pen, Z.floorId, { seed: calmSeed(tx, ty, 13) }, tileMatrix(ctx, tx, ty), { floor: true });
      if (ch === 'P') placeStatic(ctx, set, pen, 'lerche/kit/pad', { phase: 0 }, tileMatrix(ctx, tx, ty));
      else if (ch === 'x') placeStatic(ctx, set, pen, 'away/wreck/debris', { seed: seed % 8 }, tileMatrix(ctx, tx, ty, hash2(tx, ty, 3) * 6.28));
      else if (ch === 'V') {
        const wp = wallParams(map, tx, ty, Z.wallish, inside);
        addDyn(ctx, { id: 'away/wreck/wall_weak', m: tileMatrix(ctx, tx, ty), tx, ty,
          params: (st) => { const here = st.hollowT && st.hollowT.x === tx && st.hollowT.y === ty; return { state: here && st.hollow.open ? 2 : here && st.hollow.marked ? 1 : 0, cut: wp.cut, conn: wp.conn }; } });
      } else if (ch === 'h') {
        addDyn(ctx, { id: 'away/wreck/salvage', m: tileMatrix(ctx, tx, ty, facingRot(map, tx, ty, walk)), params: (st) => ({ open: st.salvageDone[tx + ',' + ty] ? 1 : 0 }) });
      } else if (ch === 'g') {
        addDyn(ctx, { id: 'away/wreck/lore_terminal', m: tileMatrix(ctx, tx, ty, facingRot(map, tx, ty, walk)), params: (st) => ({ read: st.loreRead ? 1 : 0 }), anim: animLore });
      }
    }
  }
  function majorityGrate(map, tx, ty) {
    let g = 0, f = 0;
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) { const c = map.at(tx + dx, ty + dy); if (c === '_') g++; else if (c === '.' || c === 'a') f++; }
    return g > f;
  }

  // Notlicht im Wrack: Lampen an Wänden mit begehbarer Kachel davor (+z), drei Flacker-Gruppen
  function buildWreckLights(ctx, map) {
    const T = ctx.THREE;
    const walk = (x, y) => { const c = map.at(x, y); return c != null && c !== '~' && c !== ' ' && c !== '#' && c !== 'V'; };
    const groups = [newSet(), newSet(), newSet()];
    let k = 0;
    for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
      if (map.at(tx, ty) !== '#' || !walk(tx, ty + 1)) continue;
      if ((tx + ty * 3) % 4 !== 0) continue;
      const cn = map.at(tx, ty - 1);
      const cut = ty > 0 && cn != null && cn !== '~' && cn !== ' ';   // wie wallParams: Innenwand → geschnitten
      const y = cut ? 0.95 : 2.1;
      const g = groups[k % 3]; k++;
      const pen = new Pen(T, g).at(tileMatrix(ctx, tx, ty));
      pen.box(-0.14, y - 0.02, 0.5, 0.14, y + 0.12, 0.56, C('#2A2522'), null);
      pen.box(-0.1, y, 0.56, 0.1, y + 0.1, 0.6, C(COL.emergency, 1), null, { emit: true });
      const p = ctx.tile(tx, ty);
      S.lamps.push({ x: p.x, y: y + 0.05, z: p.z + 0.75, g: (k - 1) % 3 });
    }
    S.lampMats = [];
    groups.forEach((g, i) => {
      const em = patchFog(new T.MeshBasicMaterial({ vertexColors: true }), S.fog);
      S.mats.push(em); S.lampMats.push(em);
      const mats = { lit: S.baseMats.lit, emit: em };
      for (const m of meshesFrom(ctx, g, mats, 'wreck:lamps' + i, false)) ctx.root.add(m);
    });
    // Punktlichter: über den Lichtpool von CORE (ctx.addLight, je Frame), sonst eigene (Harness/ältere Renderer)
    if (ctx.quality !== 'low' && typeof ctx.addLight !== 'function') {
      for (let i = 0; i < 2; i++) {
        const L = new T.PointLight(0xff4a36, 0, 7, 2);
        L.castShadow = false; L.name = 'wreck:emergency' + i;
        ctx.root.add(L); S.lights.push(L);
      }
    }
  }

  function buildKesh(ctx, map, set, pen) {
    const T = ctx.THREE;
    const ch = (x, y) => map.at(x, y);
    const walk = (x, y) => { const c = ch(x, y); return c != null && c !== 'R' && c !== '#' && c !== ' ' && !KESH_OBJ[c] && x >= 0 && y >= 0 && x < map.w && y < map.h; };
    const isRock = (x, y) => x < 0 || y < 0 || x >= map.w || y >= map.h || ch(x, y) === 'R';
    const ruinFloorAt = (x, y) => {
      const c = ch(x, y);
      if (KESH_RUIN[c]) return true;
      if (KESH_OBJ[c] || c === '#') {
        // unter Objekten/Wänden: nach Nachbarn (Ruine, wenn mehr Ruinen- als Sandboden angrenzt)
        let r = 0, s = 0;
        for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1], [1, 1], [-1, 1]]) { const d = ch(x + dx, y + dy); if (KESH_RUIN[d]) r++; else if (d === '.' || d === 'P') s++; }
        return r >= s;
      }
      return false;
    };
    // --- Gelände (1 Voxel/m) inkl. Felsrand um die Karte
    const B = 8;
    const W = map.w + 2 * B, D = map.h + 2 * B;
    const hgt = new Int8Array(W * D), kind = new Uint8Array(W * D);   // kind 0 nichts, 1 Sand, 2 Fels
    // Abstand zum Spielfeld (Chebyshev) für die Felshöhe
    const distTo = (x, y) => {
      for (let r = 1; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < map.w && yy < map.h && !isRock(xx, yy)) return r;
      }
      return 4;
    };
    const walkNorth = (x, y, n) => { for (let i = 1; i <= n; i++) if (y - i >= 0 && y - i < map.h && x >= 0 && x < map.w && !isRock(x, y - i)) return i; return 0; };
    const openForCut = (x, y) => { const c = ch(x, y); return c != null && c !== 'R' && c !== ' ' && x >= 0 && y >= 0 && x < map.w && y < map.h; };
    for (let gz = 0; gz < D; gz++) for (let gx = 0; gx < W; gx++) {
      const x = gx - B, y = gz - B, i = gz * W + gx;
      if (isRock(x, y)) {
        const d = distTo(x, y);
        // ART-H: an der Spielfeldkante 2 m, Abstand 2 → 3 m, weiter 4 m, +1 per Hash
        let h = d <= 1 ? 2 + (hash2(x, y, 31) < 0.25 ? 1 : 0) : d === 2 ? 3 + (hash2(x, y, 32) < 0.3 ? 1 : 0) : 4 + (hash2(x, y, 33) < 0.4 ? 1 : 0);
        // Felsen südlich vom Spielfeld verdecken die Kamera-Sicht: knapp dahinter niedrig halten (min. 2 m)
        const wn = walkNorth(x, y, 2);
        // QA: 2 m direkt südlich verdeckten im Gang (Störrelais 32,13) Figuren und Füße → 1 m, eine Reihe weiter max. 2 m
        if (wn === 1) h = 1; else if (wn === 2) h = Math.min(h, 2);
        if ((x < 0 || y < 0 || x >= map.w || y >= map.h) && wn === 0) h = Math.max(h, 4);
        hgt[i] = h; kind[i] = 2;
      } else {
        const c = ch(x, y);
        if (c === '#' || ruinFloorAt(x, y)) { hgt[i] = -1; kind[i] = 0; }   // Ruinenboden/Wände: eigenes Modell
        else { hgt[i] = 0; kind[i] = 1; }
      }
    }
    const terr = newSet();
    buildTerrainMesh(T, terr, hgt, kind, W, D, B, S.mapRect);
    for (const m of meshesFrom(ctx, terr, S.baseMats, 'kesh:terrain')) ctx.root.add(m);

    // --- Kacheln
    for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
      const c = ch(tx, ty);
      if (c === 'R') continue;
      const seed = Math.floor(hash2(tx, ty, 17) * 64);
      if (c === '#') {
        const wp = wallParams(map, tx, ty, Z.wallish, openForCut);
        placeStatic(ctx, set, pen, Z.wallId, { conn: wp.conn, cut: wp.cut, decay: hash2(tx, ty, 7) < 0.2 ? 1 : 0, seed: seed % 8 }, tileMatrix(ctx, tx, ty));
        continue;
      }
      // Ruinenboden 0,01 m über dem Gelände (ART-H: sonst z-Fighting)
      if (ruinFloorAt(tx, ty)) placeStatic(ctx, set, pen, Z.floorId, { seed: calmSeed(tx, ty, 17) }, tileMatrix(ctx, tx, ty), { floor: true, lift: 0.01 });
      if (c === 'P') placeStatic(ctx, set, pen, 'lerche/kit/pad', { phase: 0 }, tileMatrix(ctx, tx, ty));
      else if (c === 'o') {
        const l = ch(tx - 1, ty) === 'o', r = ch(tx + 1, ty) === 'o', u = ch(tx, ty - 1) === 'o', d = ch(tx, ty + 1) === 'o';
        const vertical = (u || d) && !(l || r);
        const params = { damaged: hash2(tx, ty, 9) < 0.3 ? 1 : 0 };
        const fbp = vertical ? { l: d, r: u } : { l, r };   // Fallback: an Nachbarn anschließen (rot 90°: lokales −x = Süden)
        placeStatic(ctx, set, pen, 'away/kesh/cover_low', params, tileMatrix(ctx, tx, ty, vertical ? Math.PI / 2 : 0), { fbParams: fbp });
      } else if (c === 'I') placeStatic(ctx, set, pen, 'away/kesh/pillar', {}, tileMatrix(ctx, tx, ty));
      else if (c === 'r') {
        const m = tileMatrix(ctx, tx, ty, facingRot(map, tx, ty, walk));
        addDyn(ctx, { id: 'away/kesh/jammer', m, params: (st) => { const j = st.jammerAt(tx, ty); return { on: j && j.off ? 0 : 1 }; }, parts: ['away/kesh/jammer#light'], anim: animJammer });
      } else if (c === 'k') {
        const m = tileMatrix(ctx, tx, ty, facingRot(map, tx, ty, walk));
        addDyn(ctx, { id: 'away/kesh/archive_key', m, params: (st) => { const k = st.keyAt(tx, ty); const t = k ? clamp01(k.t) : 0; return { pos: st.gateOpen || t >= 1 ? 2 : t > 0 ? 1 : 0 }; }, parts: ['away/kesh/archive_key#crystal'], anim: animKey });
      } else if (c === 'G' && ch(tx - 1, ty) !== 'G') {
        const two = ch(tx + 1, ty) === 'G';
        const m = tileMatrix(ctx, tx, ty, facingRot(map, tx, ty, walk), two ? 0.5 * S.mapRect.sx : 0, 0);
        // ART-H: einmal in die Mitte beider G-Kacheln, cut 1
        addDyn(ctx, { id: 'away/kesh/vault_gate', m, params: (st) => ({ open: st.gateOpen ? 2 : st.keysTurning ? 1 : 0, cut: 1 }), anim: animGate });
      } else if (c === 'T') {
        addDyn(ctx, { id: 'away/kesh/tablet_pedestal', m: tileMatrix(ctx, tx, ty, facingRot(map, tx, ty, walk)), params: (st) => ({ present: st.tablet && st.tablet.taken ? 0 : 1 }) });
      }
      // Streuung: Geröll auf freien Sand-/Ruinenkacheln (stabil per Hash), nicht auf Pads und Spawns
      if ((c === '.' || c === ',') && hash2(tx, ty, 41) < 0.11) {
        const m = tileMatrix(ctx, tx, ty, hash2(tx, ty, 42) * 6.28, (hash2(tx, ty, 43) - 0.5) * 0.4, (hash2(tx, ty, 44) - 0.5) * 0.4);
        placeStatic(ctx, set, pen, 'away/kesh/rubble', { seed: Math.floor(hash2(tx, ty, 45) * 8) }, m);
      }
    }
    S.fogActive = true;
  }

  // Gelände-Mesher (1 Voxel/m): Oberseiten je Säule, Seiten je Voxel (Schichtfarben + Streuung), keine Unterseiten
  function buildTerrainMesh(T, set, hgt, kind, W, D, B, R) {
    const pal = S.palette || {};
    const sandC = C(pal.sand || COL.sand), rockC = C(pal.rock || COL.rock);
    const sand = [sandC, mulC(sandC, 0.95), mulC(sandC, 1.04)];
    // ART-H (kesh-test): Oberseite rock / rock_light gestreut, obere zwei Schichten rock, Füllung rock_dark
    const rockTop = pal.rockTop ? C(pal.rockTop) : mulC(rockC, 1.2), rockA = rockC, rockB = mulC(rockC, 0.92), rockD = C(pal.rockDark || COL.rockDark);
    const bottom = -2;
    const H = (gx, gz) => (gx < 0 || gz < 0 || gx >= W || gz >= D ? -99 : kind[gz * W + gx] === 0 ? -1 : hgt[gz * W + gx]);
    const X = (gx) => R.x0 + (gx - B) * R.sx, Zc = (gz) => R.z0 + (gz - B) * R.sz;
    const colAt = (gx, gz, y, k) => {
      const j = 1 + (hash2(gx * 7 + y, gz * 13 - y, 51) - 0.5) * 0.1;
      if (k === 1) return mulC(sand[Math.floor(hash2(gx, gz, 52) * 3)], j);
      const h = hgt[gz * W + gx];
      if (y === h - 1) return mulC(hash2(gx, gz, 53) < 0.3 ? rockTop : rockA, j);
      if (y >= h - 3 && y >= 0) return mulC((y + gx + gz) % 2 ? rockA : rockB, j);
      return mulC(rockD, j);
    };
    for (let gz = 0; gz < D; gz++) for (let gx = 0; gx < W; gx++) {
      const k = kind[gz * W + gx];
      if (!k) continue;
      const h = hgt[gz * W + gx];
      const x0 = X(gx), x1 = x0 + R.sx, z0 = Zc(gz), z1 = z0 + R.sz;
      const tc = colAt(gx, gz, h - 1, k);
      set.lit.quad([[x0, h, z0], [x0, h, z1], [x1, h, z1], [x1, h, z0]], [0, 1, 0], [tc]);
      for (const [dx, dz, nx, nz] of [[1, 0, 1, 0], [-1, 0, -1, 0], [0, 1, 0, 1], [0, -1, 0, -1]]) {
        const nh = H(gx + dx, gz + dz);
        const from = Math.max(nh, bottom);
        for (let y = from; y < h; y++) {
          const c = colAt(gx, gz, y, k), cl = mulC(c, y === from ? 0.78 : 1);
          let p;
          if (nx === 1) p = [[x1, y, z0], [x1, y + 1, z0], [x1, y + 1, z1], [x1, y, z1]];
          else if (nx === -1) p = [[x0, y, z0], [x0, y, z1], [x0, y + 1, z1], [x0, y + 1, z0]];
          else if (nz === 1) p = [[x0, y, z1], [x1, y, z1], [x1, y + 1, z1], [x0, y + 1, z1]];
          else p = [[x0, y, z0], [x0, y + 1, z0], [x1, y + 1, z0], [x1, y, z0]];
          set.lit.quad(p, [nx, 0, nz], p.map((q) => (q[1] === y ? cl : c)));
        }
      }
    }
  }

  // Sternenhimmel unter und um die Plattform / das Wrack
  function addStars(ctx, map, cfg) {
    const T = ctx.THREE;
    const n = cfg.count, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const cx = S.mapRect.x0 + map.w * S.mapRect.sx / 2, cz = S.mapRect.z0 + map.h * S.mapRect.sz / 2;
    for (let i = 0; i < n; i++) {
      const r = 6 + Math.sqrt(hash2(i, 1, 61)) * 90, a = hash2(i, 2, 61) * Math.PI * 2;
      pos[i * 3] = cx + Math.cos(a) * r; pos[i * 3 + 2] = cz + Math.sin(a) * r;
      pos[i * 3 + 1] = -8 - hash2(i, 3, 61) * 70;
      const b = (0.35 + hash2(i, 4, 61) * 0.65) * cfg.bright, tint = hash2(i, 5, 61);
      const c = tint < 0.15 ? [1.0, 0.85, 0.7] : tint < 0.3 ? [0.75, 0.85, 1.0] : [1, 1, 1];
      col[i * 3] = c[0] * b; col[i * 3 + 1] = c[1] * b; col[i * 3 + 2] = c[2] * b;
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    const m = new T.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false });
    const pts = new T.Points(g, m);
    pts.name = zone + ':stars'; pts.frustumCulled = false; pts.renderOrder = -10;
    // Drehpunkt in der Kartenmitte (leichte Drift)
    const pivot = new T.Group(); pivot.position.set(cx, 0, cz); pts.position.set(-cx, 0, -cz); pivot.add(pts);
    ctx.root.add(pivot);
    S.geos.push(g); S.mats.push(m); S.stars = pivot;
  }

  // ---------------------------------------------------------------- Objekte mit Zustand
  function addDyn(ctx, def) { def.key = null; def.group = null; S.dyn.push(def); }

  function buildDynGroup(ctx, def, p) {
    const T = ctx.THREE;
    const grp = new T.Group();
    grp.name = def.id;
    grp.matrixAutoUpdate = false; grp.matrix.copy(def.m); grp.matrixWorldNeedsUpdate = true;
    const ag = assetGeo(ctx, def.id, p);
    def.fallback = !ag;
    if (ag) {
      if (ag.lit) { const m = new T.Mesh(ag.lit, S.baseMats.lit); m.castShadow = true; m.receiveShadow = true; grp.add(m); }
      if (ag.emit) { const m = new T.Mesh(ag.emit, S.baseMats.emit); m.userData.bloom = true; grp.add(m); }
      def.partGroups = [];
      return grp;
    }
    // Fallback: Hauptteil + Animationsteile; Geometrie je (id, Parameter) gecacht
    def.partGroups = [];
    for (const id of [def.id].concat(def.parts || [])) {
      const ck = id + '|' + JSON.stringify(p);
      let geo = S.fbCache.get(ck);
      if (!geo) {
        const set = newSet(), pen = new Pen(T, set);
        if (FB[id]) FB[id](pen, p, T);
        geo = { lit: set.lit.toGeometry(T), emit: set.emit.toGeometry(T) };
        if (geo.lit) S.geos.push(geo.lit);
        if (geo.emit) S.geos.push(geo.emit);
        S.fbCache.set(ck, geo);
      }
      const pg = new T.Group(); pg.name = id;
      if (geo.lit) { const m = new T.Mesh(geo.lit, S.baseMats.lit); m.castShadow = true; m.receiveShadow = true; pg.add(m); }
      if (geo.emit) {
        // eigenes emit-Material je Objekt (Blinken/Pulsieren ohne Nachbarn zu beeinflussen)
        const em = patchFog(new ctx.THREE.MeshBasicMaterial({ vertexColors: true }), S.fog);
        S.mats.push(em);
        const m = new T.Mesh(geo.emit, em); m.userData.bloom = true; pg.add(m); pg.userData.emitMat = em;
      }
      grp.add(pg); def.partGroups.push(pg);
    }
    return grp;
  }

  function deriveState(view, map) {
    const st = (view && view.state) || {};
    const a = st.away || {};
    const out = { st, a };
    if (zone === 'platform') {
      const sonde = a.sonde || {};
      out.doorOpen = !!(a.doorOpen || sonde.disabled);
      out.sondeOn = !sonde.disabled;
      const ent = sonde.entered || [];
      const cc = ((G.Shared_Protocol || {}).CODE_COLORS) || ['mint', 'bernstein', 'rot', 'blau', 'pink', 'weiss'];
      const last = ent.length ? ent[ent.length - 1] : null;
      out.sondeColor = last == null ? 0 : Math.max(0, typeof last === 'number' ? last % 6 : cc.indexOf(last));
      // Bojenkern: 0 aktiv (neu gestartet), 1 offen (Sonde aus, wartet auf Neustart), 2 stumm (Sonde sperrt noch)
      out.buoyState = a.coreRebooted ? 0 : sonde.disabled ? 1 : 2;
    } else if (zone === 'wreck') {
      out.hollow = a.hollow || null;
      out.hollowT = out.hollow ? toTileXY(map, out.hollow.x, out.hollow.y) : null;
      out.salvageDone = {};
      for (const s of a.salvage || []) { const tt = toTileXY(map, s.x, s.y); if (tt) out.salvageDone[tt.x + ',' + tt.y] = !!s.done; }
      out.loreRead = !!a.loreRead;
    } else {
      out.gateOpen = !!(a.vault && a.vault.open);
      const at = (list, tx, ty) => (list || []).find((q) => { const t = toTileXY(map, q.x, q.y); return t && t.x === tx && t.y === ty; }) || null;
      out.jammerAt = (tx, ty) => at(a.jammers, tx, ty);
      out.keyAt = (tx, ty) => at(a.keys, tx, ty);
      out.keysTurning = (a.keys || []).some((k) => +k.t > 0);
      out.tablet = a.tablet || null;
    }
    return out;
  }

  // Animationen (nur Fallback-Teile; Loader-Assets zeigen ihren Zustand über Parameter)
  function animJammer(def, t, p) {
    const pg = def.partGroups[1];
    if (!pg || !pg.userData.emitMat) return;
    const on = p.on && Math.floor(t * 3) % 2 === 0;
    pg.userData.emitMat.color.setScalar(on ? 1 : 0.3);
  }
  function animKey(def, t, p) {
    const pg = def.partGroups[1];
    if (!pg) return;
    pg.position.y = 0.78 + Math.sin(t * 2) * 0.03;
    pg.rotation.y = p.pos === 1 ? t * 4 : p.pos === 2 ? t * 0.8 : 0;
    pg.updateMatrix();
    if (pg.userData.emitMat) pg.userData.emitMat.color.setScalar(p.pos === 0 ? 0.75 + 0.25 * Math.sin(t * 1.5) : 1);
  }
  function animGate(def, t, p) {
    const pg = def.partGroups[0];
    if (pg && pg.userData.emitMat) pg.userData.emitMat.color.setScalar(p.open === 1 ? 0.7 + 0.3 * Math.sin(t * 8) : 0.75 + 0.25 * Math.sin(t * 2));
  }
  function animBuoy(def, t, p) {
    const pg = def.partGroups[0];
    if (pg && pg.userData.emitMat) pg.userData.emitMat.color.setScalar(p.state === 0 ? 0.8 + 0.2 * Math.sin(t * 2.5) : p.state === 1 ? (Math.floor(t * 2) % 2 ? 1 : 0.55) : 1);
  }
  function animLore(def, t, p) {
    const pg = def.partGroups[0];
    if (pg && pg.userData.emitMat && !p.read) pg.userData.emitMat.color.setScalar(0.7 + 0.3 * (Math.floor(t * 4) % 3 ? 1 : 0.4));
  }

  // ---------------------------------------------------------------- Nebel des Krieges (Sichtbarkeit wie render.js teamVision)
  function solidFn(map, st) {
    if (!map || map.id !== 'kesh') return (tx, ty) => map.solid(tx, ty);
    const open = !!(st && st.away && st.away.vault && st.away.vault.open);
    return (tx, ty) => (open && map.at(tx, ty) === 'G') ? false : map.solid(tx, ty);
  }
  function teamVision(view, map, st) {
    const Los = G.Shared_Los;
    if (!Los) return null;
    const now = performance.now();
    const gate = !!(st.away && st.away.vault && st.away.vault.open);
    const players = (view.players || []).filter((p) => p.zone === 'away' && p.connected !== false);
    // harter Schlüssel (Tor, Ducken, Spielerliste) → sofort neu; Positionen → höchstens alle 100 ms
    const hard = (gate ? 'g' : '') + players.map((p) => p.id + (p.cr && !p.downed ? 'c' : '')).join('|');
    const key = players.map((p) => Math.floor(p.x / 8) + ',' + Math.floor(p.y / 8)).join('|');
    const fc = S.fogCache;
    if (fc.set && fc.hard === hard && (fc.key === key || now - fc.t < 100)) return fc.set;
    fc.hard = hard;
    const solid = solidFn(map, st);
    const blocked = Los.sightFn(map, solid);
    const r = cfgNum('sightTiles', 10);
    const set = new Set();
    for (const p of players) {
      const b = p.cr && !p.downed && Los.crouchSight ? Los.crouchSight(map, solid, blocked, [{ x: p.x, y: p.y }]) : blocked;
      for (const k of Los.visibleTiles(b, p.x, p.y - 4, r, map.w, map.h)) set.add(k);
    }
    fc.t = now; fc.key = key; fc.set = set;
    return set;
  }
  function updateFog(view, dt) {
    const U = S.fog;
    const st = (view && view.state) || {};
    const v2 = !!(st.away && st.away.combat === 'v2');
    if (!S.fogActive || !v2) { U.on.value = 0; return; }
    const set = teamVision(view, S.map, st);
    if (!set) { U.on.value = 0; return; }
    U.on.value = 1;
    const k = Math.min(1, dt * 7);
    let changed = false;
    const { w, h, cur, target, data } = U;
    for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < w; tx++) {
      const i = ty * w + tx;
      target[i] = set.has(tx + ',' + ty) ? 1 : 0;
      const d = target[i] - cur[i];
      if (d === 0) continue;
      if (Math.abs(d) > 0.004) cur[i] += d * k; else cur[i] = target[i];
      const v = Math.round(cur[i] * 255);
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
      changed = true;
    }
    if (changed) U.tex.value.needsUpdate = true;
  }

  // ---------------------------------------------------------------- Update
  function update(view, dt, ctx) {
    if (!S || !S.ready) return;
    dt = Math.min(0.1, Math.max(0, +dt || 0));
    S.time += dt;
    const t = (view && isFinite(view.time)) ? view.time : S.time;
    const d = deriveState(view, S.map);
    for (const def of S.dyn) {
      try {
        const p = def.params(d);
        const key = JSON.stringify(p);
        if (key !== def.key) {
          if (def.group) { ctx.root.remove(def.group); }
          def.group = buildDynGroup(ctx, def, p);
          ctx.root.add(def.group);
          def.key = key; def.p = p;
        }
        if (def.anim && def.fallback) def.anim(def, t, def.p);
      } catch (e) { ctx.countError('away.dyn:' + def.id, e); }
    }
    if (zone === 'kesh') updateFog(view, dt);
    if (S.stars) S.stars.rotation.y += dt * 0.004;
    if (zone === 'wreck') updateLamps(view, t, ctx);
  }

  function lampLevel(g, t) {
    const step = Math.floor(t * 9);
    if (hash2(step, g, 71) < 0.07) return 0.08;   // kurzer Aussetzer
    return 0.6 + 0.25 * Math.sin(t * (2.1 + g * 0.7) + g * 2) + 0.15 * Math.sin(t * 23 + g * 5);
  }
  function updateLamps(view, t, ctx) {
    if (S.lampMats) S.lampMats.forEach((m, g) => m.color.setScalar(Math.max(0.05, lampLevel(g, t)) * 1.6));
    const pool = typeof ctx.addLight === 'function';
    if ((!pool && !S.lights.length) || !S.lamps.length || ctx.quality === 'low') return;
    // Punktlichter an die Lampen, die der eigenen Figur am nächsten sind (höchstens 2)
    const self = view && view.self;
    if (!self) return;
    const p = ctx.toWorld(self.x, self.y);
    const near = S.lamps.map((l) => ({ l, d: (l.x - p.x) ** 2 + (l.z - p.z) ** 2 })).sort((a, b) => a.d - b.d);
    if (pool) {
      for (let i = 0; i < 2 && near[i]; i++) {
        const l = near[i].l;
        ctx.addLight({ x: l.x, y: l.y, z: l.z, color: COL.emergency, intensity: 3.2 * Math.max(0.05, lampLevel(l.g, t)), distance: 7, priority: 0 });
      }
      return;
    }
    S.lights.forEach((L, i) => {
      const n = near[i];
      if (!n) { L.intensity = 0; return; }
      L.position.set(n.l.x, n.l.y, n.l.z);
      L.intensity = 3.2 * Math.max(0.05, lampLevel(n.l.g, t));
    });
  }

  function dispose(ctx) {
    if (!S) return;
    try {
      for (const def of S.dyn) if (def.group && def.group.parent) def.group.parent.remove(def.group);
      if (ctx && ctx.root) while (ctx.root.children.length) ctx.root.remove(ctx.root.children[0]);
      for (const g of S.geos) g.dispose();
      for (const m of S.mats) m.dispose();
      S.fog.tex.value.dispose();
    } catch (e) { if (ctx && ctx.countError) ctx.countError('away.dispose', e); }
    S = null;
  }

  return {
    id: zone, zones: [zone],
    build,
    update,
    dispose,
    // für Tests/QA: Kennzahlen des letzten Baus
    stats: () => (S ? Object.assign({ dyn: S.dyn.length, lamps: S.lamps.length, fog: S.fog.on.value, palette: !!S.palette }, S.stats) : null),
  };
}

// Paletten-Rollen → Geländefarben (mond_kesh von ART-H; Rollen nach AUTHORING.md)
const paletteCache = new Map();
async function loadPalette(id) {
  if (paletteCache.has(id)) return paletteCache.get(id);
  let out = null;
  try {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctl && ctl.abort(), 1500);
    const res = await fetch('/voxel/assets/palettes/' + id + '.json', ctl ? { signal: ctl.signal } : undefined);
    clearTimeout(timer);
    if (res.ok) {
      const j = await res.json();
      const r = j.roles || {};
      const hex = (v) => (typeof v === 'string' ? v : v && typeof v.color === 'string' ? v.color : null);
      out = {};
      if (hex(r.sand)) out.sand = hex(r.sand);
      if (hex(r.rock)) out.rock = hex(r.rock);
      if (hex(r.rock_dark)) out.rockDark = hex(r.rock_dark);
      if (hex(r.rock_light)) out.rockTop = hex(r.rock_light);
    }
  } catch (e) { out = null; }
  paletteCache.set(id, out);
  return out;
}

const LAYERS = {};
for (const zone of ['platform', 'wreck', 'kesh']) {
  try { LAYERS[zone] = makeLayer(zone); registerLayer(LAYERS[zone]); } catch (e) {
    try { (G.Net && G.Net.reportError) && G.Net.reportError('away.register:' + zone, e); } catch (e2) { /* nichts */ }
    console.error('[away] registerLayer', zone, e);
  }
}
// Kennzahlen für QA-Skripte: window.VoxelAway.stats('kesh')
G.VoxelAway = { stats: (z) => (LAYERS[z] && LAYERS[z].stats ? LAYERS[z].stats() : null) };
