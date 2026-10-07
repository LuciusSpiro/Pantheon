// Layer „fx“ (CONTRACT-M4 §3.5) – Team ACTORS
// Alle Effekte als gepoolte Würfelpartikel: drei InstancedMesh (leuchtend, beleuchtet, additiv), zusammen ≤ 2000 Partikel,
// dazu höchstens FX_LIGHTS dynamische Punktlichter. Auslöser: Snapshot (Feuer, Lecks, Stationszustände, Aktionen, Schilde,
// Projektile, Befehle, Kuppel, Orbitalschlag, Sensor …) und Server-Ereignisse (wie im 2D-Renderer).
// Öffentlich: export function spawnFx(type, opts) · window.VoxelFx = { spawnFx, onEvent, stats, shots }
import { registerLayer } from './renderer.js';

const TILE = 32;
const CAP = { emit: 1000, lit: 600, glow: 400 };   // Summe 2000 (§3.5)
const FX_LIGHTS = 2;                               // von insgesamt ≤ 4 dynamischen Lichtern (§7) – Rest für ship.js/away.js
const COL = {
  fireCore: '#FFD27A', fire: '#F0602C', fireDeep: '#C8342C', ember: '#FFC66B', spark: '#FFF1B8', amber: '#F08A3C',
  smoke: '#7C7684', smokeLight: '#B4AEB8', ice: '#A9D6E5', shield: '#7FF3FF', mint: '#7FE0C2', gel: '#DFF7F0', foam: '#F4FBF8',
  violet: '#B57CFF', red: '#E0473C', yellow: '#F2C94C', heal: '#3FB894', healLight: '#C8F5E6', stone: '#C8BEAA', stoneDark: '#8C7F6A',
  metal: '#8A8F99', bronze: '#B08D57', enemyBolt: '#FF6A3D', white: '#FFFFFF', strike: '#FFC66B',
};
const ORDER_COL = { sammeln: '#7FE0C2', halten: '#F2C94C', flanke: '#A9D6E5', rueckzug: '#F08A3C', fokus: '#E0473C', gefahr: '#FF7A3D' };
const PLAYER_COLORS = ['#56B4E9', '#E69F00', '#CC79A7', '#7FE0C2'];
// Stationszeichen → Asset (für Sockets, §3.3)
const STATION_ASSET = { R: 'reactor', G: 'shield_gen', O: 'life_support', E: 'engine', F: 'thruster', Z: 'thruster', K: 'lance',
  M: 'battery', J: 'battery', A: 'emitter', I: 'emitter', U: 'emitter', V: 'emitter', X: 'transfer' };
const DEF_SOCKETS = { fx_smoke: [0, 1.5, 0], fx_spark: [0.25, 1.0, 0.35] };

const F = {
  THREE: null, ctx: null, group: null, meshes: {}, pools: {}, lights: [], lightReq: [], frame: 0, time: 0,
  queue: [], emitters: new Map(), seen: {}, stations: null, stationMap: null, colorCache: new Map(),
  stats: { particles: 0, emit: 0, lit: 0, glow: 0, drawCalls: 0, lights: 0, spawned: 0, dropped: 0, errors: 0, events: 0 },
  prev: { fires: new Map(), drones: new Map(), proj: new Map(), hp: {}, sensor: false, strikes: new Set(), setbacks: {} },
  shots: {}, view: null, focus: null, lastZone: null, evSeen: new WeakSet(),
};

function err(where, e) {
  F.stats.errors++;
  try { if (F.ctx && F.ctx.countError) F.ctx.countError('fx.' + where, e); else console.warn('[fx]', where, e); } catch (e2) { /* nie werfen */ }
}
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : +v || 0);

// ------------------------------------------------------------------------------------------------------------------------------
// Partikel-Pools (Struktur aus Arrays, kein GC im Frame)
const STRIDE = 20;   // px py pz vx vy vz age life s0 s1 r0 g0 b0 r1 g1 b1 grav drag sx(Streckung) yaw
function makePool(n) { return { n, live: 0, d: new Float32Array(n * STRIDE) }; }
function colorOf(hex) {
  let c = F.colorCache.get(hex);
  if (!c) { c = new F.THREE.Color(hex); F.colorCache.set(hex, c); }
  return c;
}
/**
 * Partikel anlegen. o: { mesh:'emit'|'lit'|'glow', p:[x,y,z], v:[x,y,z], life, s0, s1, c0, c1, grav, drag, stretch, yaw }
 */
function spawn(o) {
  const P = F.pools[o.mesh || 'emit'];
  if (!P) return;
  if (P.live >= P.n) { F.stats.dropped++; return; }
  const i = P.live++ * STRIDE, d = P.d;
  const c0 = colorOf(o.c0 || COL.spark), c1 = colorOf(o.c1 || o.c0 || COL.spark);
  d[i] = o.p[0]; d[i + 1] = o.p[1]; d[i + 2] = o.p[2];
  const v = o.v || [0, 0, 0];
  d[i + 3] = v[0]; d[i + 4] = v[1]; d[i + 5] = v[2];
  d[i + 6] = 0; d[i + 7] = o.life || 0.5;
  d[i + 8] = o.s0 != null ? o.s0 : 0.08; d[i + 9] = o.s1 != null ? o.s1 : 0;
  d[i + 10] = c0.r; d[i + 11] = c0.g; d[i + 12] = c0.b; d[i + 13] = c1.r; d[i + 14] = c1.g; d[i + 15] = c1.b;
  d[i + 16] = o.grav || 0; d[i + 17] = o.drag || 0; d[i + 18] = o.stretch || 1; d[i + 19] = o.yaw || 0;
  F.stats.spawned++;
}
function stepPools(dt) {
  for (const P of Object.values(F.pools)) {
    const d = P.d;
    let w = 0;
    for (let r = 0; r < P.live; r++) {
      const i = r * STRIDE;
      const age = d[i + 6] + dt;
      if (age >= d[i + 7]) continue;
      const j = w * STRIDE;
      if (j !== i) d.copyWithin(j, i, i + STRIDE);
      d[j + 6] = age;
      const dr = Math.max(0, 1 - d[j + 17] * dt);
      d[j + 3] *= dr; d[j + 5] *= dr; d[j + 4] = d[j + 4] * dr - d[j + 16] * dt;
      d[j] += d[j + 3] * dt; d[j + 1] += d[j + 4] * dt; d[j + 2] += d[j + 5] * dt;
      if (d[j + 16] > 0 && d[j + 1] < 0.02) { d[j + 1] = 0.02; d[j + 4] *= -0.25; d[j + 3] *= 0.6; d[j + 5] *= 0.6; }
      w++;
    }
    P.live = w;
  }
}
// Sofort-Partikel nur für diesen Frame (Ringe, Säulen, Projektile): direkt in die Instanzen
const IMM = { emit: [], lit: [], glow: [] };
function put(mesh, x, y, z, size, hex, sx, sy, sz, yaw) {
  const L = IMM[mesh]; if (!L) return;
  L.push(x, y, z, size, hex, sx || 1, sy || 1, sz || 1, yaw || 0);
}
const _m = { mat: null, q: null, v: null, s: null, e: null, c: null, up: null };
function writeInstances() {
  const T = F.THREE;
  if (!_m.mat) { _m.mat = new T.Matrix4(); _m.q = new T.Quaternion(); _m.v = new T.Vector3(); _m.s = new T.Vector3(); _m.e = new T.Euler(); _m.c = new T.Color(); }
  let total = 0, calls = 0;
  for (const name of ['emit', 'lit', 'glow']) {
    const im = F.meshes[name], P = F.pools[name], d = P.d;
    let n = 0;
    for (let r = 0; r < P.live && n < P.n; r++) {
      const i = r * STRIDE;
      const k = d[i + 6] / d[i + 7];
      const s = d[i + 8] + (d[i + 9] - d[i + 8]) * k;
      if (s <= 0.002) continue;
      const st = d[i + 18];
      _m.v.set(d[i], d[i + 1], d[i + 2]);
      if (st !== 1) {
        // gestreckt entlang der Bewegungsrichtung
        const vx = d[i + 3], vy = d[i + 4], vz = d[i + 5], len = Math.hypot(vx, vy, vz) || 1;
        _m.e.set(Math.asin(Math.max(-1, Math.min(1, -vy / len))), Math.atan2(vx, vz), 0, 'YXZ');
        _m.q.setFromEuler(_m.e);
        _m.s.set(s, s, s * st);
      } else {
        _m.e.set(0, d[i + 19] + d[i] * 3.1, 0); _m.q.setFromEuler(_m.e);
        _m.s.set(s, s, s);
      }
      _m.mat.compose(_m.v, _m.q, _m.s);
      im.setMatrixAt(n, _m.mat);
      _m.c.setRGB(d[i + 10] + (d[i + 13] - d[i + 10]) * k, d[i + 11] + (d[i + 14] - d[i + 11]) * k, d[i + 12] + (d[i + 15] - d[i + 12]) * k);
      im.setColorAt(n, _m.c);
      n++;
    }
    const L = IMM[name];
    for (let q = 0; q < L.length && n < P.n; q += 9) {
      _m.v.set(L[q], L[q + 1], L[q + 2]);
      _m.e.set(0, L[q + 8], 0); _m.q.setFromEuler(_m.e);
      _m.s.set(L[q + 3] * L[q + 5], L[q + 3] * L[q + 6], L[q + 3] * L[q + 7]);
      _m.mat.compose(_m.v, _m.q, _m.s);
      im.setMatrixAt(n, _m.mat);
      im.setColorAt(n, colorOf(L[q + 4]));
      n++;
    }
    if (L.length / 9 + P.live > P.n) F.stats.dropped += L.length / 9 + P.live - P.n;
    L.length = 0;
    im.count = n; im.visible = n > 0;
    if (n) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; calls++; }
    F.stats[name] = n; total += n;
  }
  F.stats.particles = total; F.stats.drawCalls = calls;
}

// ------------------------------------------------------------------------------------------------------------------------------
// Lichter (gepoolt, feste Anzahl → kein Shader-Neubau)
function lightReq(x, y, z, hex, intensity, prio) { F.lightReq.push({ x, y, z, hex, intensity, prio }); }
function assignLights() {
  const f = F.focus;
  F.lightReq.sort((a, b) => (b.prio - a.prio) || (f ? Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z) : 0));
  let used = 0;
  for (let i = 0; i < F.lights.length; i++) {
    const L = F.lights[i], r = F.lightReq[i];
    if (r) { L.position.set(r.x, r.y, r.z); L.color.set(r.hex); L.intensity = r.intensity; used++; }
    else L.intensity = 0;
  }
  F.stats.lights = used;
  F.lightReq.length = 0;
}

// ------------------------------------------------------------------------------------------------------------------------------
// Koordinaten
function W(px, py, h) { const v = F.ctx.toWorld(px, py); return [v.x, (v.y || 0) + (h || 0), v.z]; }
function Wt(tx, ty, h) { const v = F.ctx.tile(tx, ty); return [v.x, (v.y || 0) + (h || 0), v.z]; }
function visibleDeckPx(py) {
  if (F.ctx.zone !== 'ship') return true;
  const M = window.Shared_Maps; if (!M || !M.deckOfPx || F.ctx.deck == null) return true;
  const d = M.deckOfPx(py); return d === F.ctx.deck || d < 0;
}
function visibleDeckTile(ty) { return visibleDeckPx(ty * TILE + 16); }

// ------------------------------------------------------------------------------------------------------------------------------
// Effekt-Bausteine
const FX = {
  // Feuer (Größe 0–2): Flammenwürfel, Glut, Rauch, Licht
  fire(p, size, dt, t) {
    const k = [0.6, 1, 1.5][size] || 1;
    const rate = [28, 46, 70][size] * dt;
    for (let n = Math.floor(rate + Math.random()); n > 0; n--) {
      const core = Math.random() < 0.35;
      spawn({ mesh: 'emit', p: [p[0] + rnd(-0.32, 0.32) * k, p[1] + 0.05, p[2] + rnd(-0.32, 0.32) * k], v: [rnd(-0.15, 0.15), rnd(0.9, 1.7) * (0.8 + k * 0.25), rnd(-0.15, 0.15)],
        life: rnd(0.35, 0.75) * (0.8 + k * 0.2), s0: rnd(0.14, 0.22) * k, s1: 0.02, c0: core ? COL.fireCore : COL.fire, c1: core ? COL.fire : COL.fireDeep, drag: 0.6 });
    }
    if (Math.random() < dt * 6 * k) spawn({ mesh: 'emit', p: [p[0] + rnd(-0.3, 0.3), p[1] + 0.4, p[2] + rnd(-0.3, 0.3)], v: [rnd(-0.4, 0.4), rnd(1.4, 2.4), rnd(-0.4, 0.4)], life: rnd(0.8, 1.4), s0: 0.035, s1: 0.01, c0: COL.ember, c1: COL.amber, drag: 0.3 });
    if (Math.random() < dt * [5, 8, 13][size]) spawn({ mesh: 'lit', p: [p[0] + rnd(-0.2, 0.2), p[1] + 0.7 * k, p[2] + rnd(-0.2, 0.2)], v: [rnd(-0.1, 0.1) + 0.08, rnd(0.5, 0.8), rnd(-0.1, 0.1)], life: rnd(1.6, 2.4), s0: 0.07 * k, s1: 0.2 * k, c0: COL.smoke, c1: COL.smokeLight, drag: 0.4 });
    lightReq(p[0], p[1] + 0.8, p[2], COL.amber, (2.2 + size * 1.4) * (0.8 + 0.25 * Math.sin(t * 17 + p[0] * 3) + 0.1 * Math.sin(t * 29)), 2);
  },
  smoke(p, dt, amount) {
    if (Math.random() < dt * 8 * (amount || 1)) spawn({ mesh: 'lit', p: [p[0] + rnd(-0.1, 0.1), p[1], p[2] + rnd(-0.1, 0.1)], v: [rnd(-0.1, 0.1) + 0.06, rnd(0.4, 0.7), rnd(-0.1, 0.1)], life: rnd(1.4, 2.2), s0: 0.06, s1: 0.2, c0: '#5E5864', c1: COL.smokeLight, drag: 0.4 });
  },
  sparks(p, n, opts) {
    const o = opts || {};
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = rnd(0.8, 2.4) * (o.speed || 1);
      spawn({ mesh: 'emit', p: [p[0], p[1], p[2]], v: [Math.cos(a) * sp * 0.6 + (o.dir ? o.dir[0] : 0), rnd(0.6, 2.2) * (o.up || 1), Math.sin(a) * sp * 0.6 + (o.dir ? o.dir[2] : 0)],
        life: rnd(0.25, 0.55), s0: rnd(0.03, 0.05), s1: 0.01, c0: o.c0 || COL.spark, c1: o.c1 || COL.amber, grav: 6, drag: 0.5, stretch: 2.2 });
    }
  },
  // Leck: Sog-Partikel zum Leck, Eiskristalle, kaltes Glimmen
  breach(p, dt, t) {
    for (let n = Math.floor(dt * 34 + Math.random()); n > 0; n--) {
      const a = Math.random() * Math.PI * 2, r = rnd(0.9, 1.7), h = rnd(0.05, 1.3);
      const sx = p[0] + Math.cos(a) * r, sz = p[2] + Math.sin(a) * r;
      const life = rnd(0.55, 0.9);
      // swirl: tangential + radial auf das Leck zu
      const vx = (p[0] - sx) / life + -Math.sin(a) * 0.6, vz = (p[2] - sz) / life + Math.cos(a) * 0.6, vy = (0.15 - h) / life;
      spawn({ mesh: Math.random() < 0.7 ? 'emit' : 'lit', p: [sx, h, sz], v: [vx, vy, vz], life, s0: 0.03, s1: 0.012, c0: COL.ice, c1: COL.white, stretch: 2.5 });
    }
    put('glow', p[0], 0.06, p[2], 1, '#2A4A5C', 1.1 + 0.08 * Math.sin(t * 7), 0.06, 1.1 + 0.08 * Math.sin(t * 7));
    lightReq(p[0], 0.5, p[2], COL.ice, 1.2, 1);
  },
  gelStream(from, to, dt) {
    for (let n = Math.floor(dt * 70 + Math.random()); n > 0; n--) {
      const life = rnd(0.28, 0.38);
      const tx = to[0] + rnd(-0.25, 0.25), tz = to[2] + rnd(-0.25, 0.25), ty = to[1];
      // ballistisch: Start mit Aufwärtsanteil, Schwerkraft 4
      const vx = (tx - from[0]) / life, vz = (tz - from[2]) / life, vy = (ty - from[1]) / life + 0.5 * 4 * life;
      spawn({ mesh: Math.random() < 0.5 ? 'lit' : 'glow', p: from.slice(), v: [vx, vy, vz], life, s0: 0.05, s1: 0.09, c0: COL.gel, c1: COL.mint, grav: 4, stretch: 1.8 });
    }
    FX.foam(to, dt, 0.8);
  },
  foam(p, dt, amount) {
    for (let n = Math.floor(dt * 16 * (amount || 1) + Math.random()); n > 0; n--) {
      spawn({ mesh: 'lit', p: [p[0] + rnd(-0.4, 0.4), 0.06 + rnd(0, 0.2), p[2] + rnd(-0.4, 0.4)], v: [rnd(-0.1, 0.1), rnd(0.05, 0.25), rnd(-0.1, 0.1)], life: rnd(1.0, 1.8), s0: rnd(0.08, 0.14), s1: 0.02, c0: COL.foam, c1: COL.gel, drag: 1.5 });
    }
  },
  foamBurst(p) {
    for (let i = 0; i < 26; i++) spawn({ mesh: 'lit', p: [p[0] + rnd(-0.3, 0.3), 0.1, p[2] + rnd(-0.3, 0.3)], v: [rnd(-0.8, 0.8), rnd(0.4, 1.4), rnd(-0.8, 0.8)], life: rnd(1.2, 2.2), s0: rnd(0.1, 0.16), s1: 0.02, c0: COL.foam, c1: COL.gel, grav: 2, drag: 1.2 });
    for (let i = 0; i < 10; i++) spawn({ mesh: 'lit', p: [p[0], 0.5, p[2]], v: [rnd(-0.2, 0.2), rnd(0.5, 0.9), rnd(-0.2, 0.2)], life: rnd(1.5, 2.2), s0: 0.12, s1: 0.4, c0: '#C9D3D6', c1: '#8C979C', drag: 0.4 });
  },
  repairSparks(p, dt, t, seed) {
    if (Math.floor(t * 4 + seed) !== Math.floor((t - dt) * 4 + seed)) FX.sparks(p, 6, { speed: 0.8, up: 0.8 });
    if (Math.random() < dt * 3) spawn({ mesh: 'glow', p: [p[0], p[1] + 0.1, p[2]], v: [0, 0.5, 0], life: 0.6, s0: 0.06, s1: 0.0, c0: COL.mint, c1: COL.mint });
    lightReq(p[0], p[1] + 0.2, p[2], COL.spark, 0.9 + Math.random() * 0.8, 1);
  },
  setback(p) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, sp = rnd(1.2, 3);
      spawn({ mesh: 'lit', p: p.slice(), v: [Math.cos(a) * sp, rnd(1, 3), Math.sin(a) * sp], life: rnd(0.6, 1.1), s0: rnd(0.04, 0.08), s1: 0.03, c0: i % 3 ? COL.metal : COL.bronze, c1: '#5A5F6A', grav: 9, drag: 0.3 });
    }
    FX.sparks(p, 12, { speed: 1.6 });
    lightReq(p[0], p[1], p[2], COL.red, 3, 3);
  },
  // Beamen: Zerfall (out, v 0..1) bzw. Aufbau (in, v 1..0)
  beam(p, v, dt, hex, dirIn) {
    const rate = (dirIn ? 160 : 60 + v * 160) * dt;
    for (let n = Math.floor(rate + Math.random()); n > 0; n--) {
      const a = Math.random() * Math.PI * 2, r = rnd(0, 0.3), h = rnd(0.05, 1.9);
      const c = Math.random() < 0.5 ? hex : COL.mint;
      if (dirIn) {
        const y0 = h + rnd(1.5, 3);
        spawn({ mesh: 'emit', p: [p[0] + Math.cos(a) * r * 2, y0, p[2] + Math.sin(a) * r * 2], v: [-Math.cos(a) * r * 2 / 0.4, (h - y0) / 0.4, -Math.sin(a) * r * 2 / 0.4], life: 0.4, s0: 0.05, s1: 0.07, c0: COL.white, c1: c });
      } else {
        spawn({ mesh: 'emit', p: [p[0] + Math.cos(a) * r, h, p[2] + Math.sin(a) * r], v: [Math.cos(a) * 0.2, rnd(1.2, 3.2), Math.sin(a) * 0.2], life: rnd(0.4, 0.8), s0: 0.07, s1: 0.0, c0: c, c1: COL.white });
      }
    }
    const k = dirIn ? v : Math.min(1, v * 1.4);
    put('glow', p[0], 1.6, p[2], 1, COL.mint, 0.55 * k + 0.05, 3.2, 0.55 * k + 0.05);
    put('glow', p[0], 0.04, p[2], 1, COL.mint, 0.9 * k, 0.05, 0.9 * k);
    lightReq(p[0], 1.2, p[2], COL.mint, 2.5 * k, 2);
  },
  // Personenschild: 3 Segmente als Würfelring (voll = hell, leer = Stummel), Regeneration wächst im nächsten Segment
  shieldRing(p, seg, max, regen, t, radius, dim) {
    max = Math.max(1, max || 3); const per = 8, gap = 0.35;
    const span = (Math.PI * 2) / max;
    for (let s = 0; s < max; s++) {
      const full = s < seg, grow = !full && s === seg ? clamp01(regen) : 0;
      const n = full ? per : Math.floor(per * grow);
      for (let i = 0; i < per; i++) {
        const a = t * 0.6 + s * span + gap / 2 + (i / (per - 1)) * (span - gap);
        const on = i < n;
        put('glow', p[0] + Math.cos(a) * radius, p[1], p[2] + Math.sin(a) * radius, on ? (dim ? 0.06 : 0.08) : 0.035, on ? COL.shield : '#2A5560', 1, on ? 1.4 : 1, 1, -a);
      }
    }
  },
  shieldHit(p, radius) {
    for (let i = 0; i < 28; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      const x = Math.cos(a) * r * radius, z = Math.sin(a) * r * radius, y = 0.95 + u * 1.0;
      spawn({ mesh: 'glow', p: [p[0] + x, y, p[2] + z], v: [x * 0.4, u * 0.2, z * 0.4], life: rnd(0.25, 0.4), s0: 0.11, s1: 0.02, c0: COL.white, c1: COL.shield });
    }
    lightReq(p[0], 1, p[2], COL.shield, 2.5, 3);
  },
  shieldBreak(p) {
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, sp = rnd(1.5, 3.2);
      spawn({ mesh: 'emit', p: [p[0] + Math.cos(a) * 0.5, rnd(0.6, 1.4), p[2] + Math.sin(a) * 0.5], v: [Math.cos(a) * sp, rnd(0.5, 2.2), Math.sin(a) * sp], life: rnd(0.5, 0.9), s0: rnd(0.06, 0.1), s1: 0.01, c0: COL.white, c1: COL.shield, grav: 7, drag: 0.4 });
    }
    lightReq(p[0], 1, p[2], COL.shield, 4, 4);
  },
  muzzle(p, hex) {
    for (let i = 0; i < 6; i++) spawn({ mesh: 'emit', p: p.slice(), v: [rnd(-1, 1), rnd(-0.5, 1), rnd(-1, 1)], life: 0.12, s0: 0.09, s1: 0.0, c0: COL.white, c1: hex || COL.shield });
    lightReq(p[0], p[1], p[2], hex || COL.shield, 2.2, 3);
  },
  impact(p, hex) {
    FX.sparks(p, 7, { speed: 1, c0: COL.white, c1: hex || COL.shield });
  },
  coverHit(p) {
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI / 2 + rnd(-1.2, 1.2) + (Math.random() < 0.5 ? Math.PI : 0);
      spawn({ mesh: 'lit', p: [p[0], p[1], p[2]], v: [Math.cos(a) * rnd(0.6, 2), rnd(1, 3), Math.sin(a) * rnd(0.6, 2)], life: rnd(0.5, 0.9), s0: rnd(0.04, 0.08), s1: 0.03, c0: i % 2 ? COL.stone : COL.stoneDark, c1: COL.stoneDark, grav: 9 });
    }
    for (let i = 0; i < 5; i++) spawn({ mesh: 'lit', p: [p[0], p[1], p[2]], v: [rnd(-0.3, 0.3), rnd(0.3, 0.7), rnd(-0.3, 0.3)], life: rnd(0.8, 1.2), s0: 0.08, s1: 0.28, c0: '#B8AE98', c1: '#8C8270', drag: 0.8 });
    spawn({ mesh: 'emit', p: p.slice(), v: [0, 0, 0], life: 0.1, s0: 0.22, s1: 0.05, c0: COL.spark, c1: COL.ember });
  },
  wardenDeflect(p) {
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      spawn({ mesh: 'glow', p: [p[0], p[1], p[2]], v: [Math.cos(a) * 2.2, Math.sin(a) * 1.2, Math.sin(a) * 2.2 * 0.3 + Math.cos(a) * 0.3], life: 0.35, s0: 0.1, s1: 0.02, c0: COL.white, c1: COL.violet });
    }
    FX.sparks(p, 8, { c0: COL.white, c1: COL.violet });
    lightReq(p[0], p[1], p[2], COL.violet, 3, 3);
  },
  // Frontschild des Wächters (ART-G: Socket shield_front [0,0.84,0.75], Blick +z) – nur wach, lebend, front 1
  wardenFront(p, facing, arcDeg, asleep, t, sock) {
    if (asleep) return;
    const arc = (arcDeg || 120) * Math.PI / 180;
    const so = sock || [0, 0.84, 0.75];
    const cx = p[0] + Math.cos(facing) * (so[2] - 0.6), cz = p[2] + Math.sin(facing) * (so[2] - 0.6);
    const n = 13;
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < n; i++) {
        const a = facing - arc / 2 + (i / (n - 1)) * arc;
        const x = cx + Math.cos(a) * 1.15, z = cz + Math.sin(a) * 1.15;
        const wob = 0.03 * Math.sin(t * 6 + i);
        put('glow', x, so[1] - 0.45 + r * 0.42 + wob, z, 0.13, r === 1 ? COL.shield : COL.violet, 1, 0.9, 0.4, -a + Math.PI / 2);
      }
    }
  },
  empWave(p, hex) {
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      spawn({ mesh: 'glow', p: [p[0], 0.25, p[2]], v: [Math.cos(a) * 7, 0, Math.sin(a) * 7], life: 0.85, s0: 0.16, s1: 0.04, c0: COL.white, c1: hex || COL.ice, drag: 0.6 });
      if (i % 3 === 0) spawn({ mesh: 'emit', p: [p[0], 0.9, p[2]], v: [Math.cos(a) * 4.5, rnd(-0.3, 0.3), Math.sin(a) * 4.5], life: 0.6, s0: 0.05, s1: 0.0, c0: COL.white, c1: hex || COL.ice, stretch: 3 });
    }
    lightReq(p[0], 1, p[2], hex || COL.ice, 5, 4);
  },
  empArcs(p, t) {
    // Eisblaue Bögen an der Station (EMP)
    for (let b = 0; b < 3; b++) {
      if (Math.floor(t * 9 + b * 3.3) % 2) continue;
      let x = p[0] + rnd(-0.35, 0.35), y = p[1] + rnd(-0.2, 0.3), z = p[2] + rnd(-0.35, 0.35);
      for (let i = 0; i < 5; i++) { put('emit', x, y, z, 0.035, i % 2 ? COL.ice : COL.white); x += rnd(-0.12, 0.12); y += rnd(-0.1, 0.12); z += rnd(-0.12, 0.12); }
    }
  },
  escalate(p, left, dt, t) {
    // Boden glimmt rund um die Station, schneller und heller, je näher das Feuer kommt
    const hot = clamp01(1 - (left || 0) / 20);
    for (let n = Math.floor(dt * (8 + hot * 30) + Math.random()); n > 0; n--) {
      const a = Math.random() * Math.PI * 2, r = rnd(0.3, 0.75);
      spawn({ mesh: 'emit', p: [p[0] + Math.cos(a) * r, 0.04, p[2] + Math.sin(a) * r], v: [0, rnd(0.05, 0.3 + hot), 0], life: rnd(0.4, 0.9), s0: 0.05, s1: 0.0, c0: hot > 0.7 ? COL.fireCore : COL.amber, c1: COL.fireDeep });
    }
    put('glow', p[0], 0.03, p[2], 1, hot > 0.7 ? '#5A2010' : '#3A1A0C', 1.4, 0.04, 1.4);
    if (hot > 0.5) lightReq(p[0], 0.3, p[2], COL.amber, 1 + hot * 1.5 * (0.7 + 0.3 * Math.sin(t * 12)), 1);
  },
  heal(p) {
    for (let i = 0; i < 6; i++) {
      const x = p[0] + rnd(-0.35, 0.35), z = p[2] + rnd(-0.35, 0.35), y = rnd(0.4, 1.2);
      for (const [dx, dy] of [[0, 0], [0.06, 0], [-0.06, 0], [0, 0.06], [0, -0.06]]) spawn({ mesh: 'emit', p: [x + dx, y + dy, z], v: [0, 0.9, 0], life: 1.0, s0: 0.06, s1: 0.03, c0: dx || dy ? COL.heal : COL.healLight, c1: COL.heal });
    }
    lightReq(p[0], 1, p[2], COL.mint, 1.8, 2);
  },
  revive(p) {
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      spawn({ mesh: 'glow', p: [p[0] + Math.cos(a) * 0.3, 0.1, p[2] + Math.sin(a) * 0.3], v: [Math.cos(a) * 1.8, 0.1, Math.sin(a) * 1.8], life: 0.7, s0: 0.1, s1: 0.02, c0: COL.white, c1: COL.mint, drag: 1.2 });
    }
    for (let i = 0; i < 14; i++) spawn({ mesh: 'emit', p: [p[0] + rnd(-0.3, 0.3), rnd(0.1, 0.6), p[2] + rnd(-0.3, 0.3)], v: [0, rnd(1.2, 2.2), 0], life: 0.9, s0: 0.05, s1: 0.0, c0: COL.shield, c1: COL.mint });
    lightReq(p[0], 1, p[2], COL.mint, 3, 3);
  },
  reviveFlow(from, to, dt) {
    for (let n = Math.floor(dt * 20 + Math.random()); n > 0; n--) {
      const life = 0.6;
      spawn({ mesh: 'glow', p: [from[0], 1.0, from[2]], v: [(to[0] - from[0]) / life + rnd(-0.2, 0.2), (0.35 - 1.0) / life, (to[2] - from[2]) / life + rnd(-0.2, 0.2)], life, s0: 0.05, s1: 0.03, c0: COL.mint, c1: COL.white });
    }
  },
  explosion(p, scale) {
    const k = scale || 1;
    for (let i = 0; i < 36 * k; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u), sp = rnd(1.5, 4) * k;
      spawn({ mesh: 'emit', p: [p[0], p[1], p[2]], v: [Math.cos(a) * r * sp, Math.abs(u) * sp + 0.5, Math.sin(a) * r * sp], life: rnd(0.35, 0.7), s0: rnd(0.12, 0.22) * k, s1: 0.02, c0: i % 3 ? COL.fireCore : COL.white, c1: COL.fireDeep, drag: 2.5 });
    }
    for (let i = 0; i < 14 * k; i++) {
      const a = Math.random() * Math.PI * 2, sp = rnd(1.5, 4);
      spawn({ mesh: 'lit', p: p.slice(), v: [Math.cos(a) * sp, rnd(2, 5), Math.sin(a) * sp], life: rnd(0.8, 1.4), s0: rnd(0.05, 0.1), s1: 0.04, c0: '#3A3E46', c1: '#22252B', grav: 9, drag: 0.2 });
    }
    for (let i = 0; i < 8 * k; i++) spawn({ mesh: 'lit', p: [p[0] + rnd(-0.3, 0.3), p[1], p[2] + rnd(-0.3, 0.3)], v: [rnd(-0.4, 0.4), rnd(0.6, 1.2), rnd(-0.4, 0.4)], life: rnd(1.6, 2.6), s0: 0.2 * k, s1: 0.6 * k, c0: '#4A4044', c1: COL.smokeLight, drag: 0.6 });
    FX._flash.push({ p: p.slice(), t: 0, T: 0.35, hex: COL.amber, i: 7 * k });
  },
  _flash: [],
  orderPillar(p, hex, t) {
    put('glow', p[0], 1.9, p[2], 1, hex, 0.32, 3.8, 0.32);
    put('emit', p[0], 1.9, p[2], 1, hex, 0.06, 3.8, 0.06);
    for (let i = 0; i < 12; i++) {
      const a = t * 1.5 + (i / 12) * Math.PI * 2;
      put('emit', p[0] + Math.cos(a) * 0.55, 0.05, p[2] + Math.sin(a) * 0.55, 0.07, hex, 1, 0.5, 1, -a);
    }
    if (Math.random() < 0.3) spawn({ mesh: 'glow', p: [p[0] + rnd(-0.12, 0.12), 0.2, p[2] + rnd(-0.12, 0.12)], v: [0, rnd(1.5, 2.5), 0], life: 1.4, s0: 0.06, s1: 0, c0: COL.white, c1: hex });
  },
  kuppel(p, t) {
    const R = 0.95, pulse = 1 + 0.03 * Math.sin(t * 6);
    for (let lat = 0; lat < 4; lat++) {
      const phi = (lat / 4) * Math.PI / 2, n = Math.max(4, Math.round(14 * Math.cos(phi)));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + t * 0.4 * (lat % 2 ? 1 : -1);
        put('glow', p[0] + Math.cos(a) * Math.cos(phi) * R * pulse, Math.sin(phi) * R * 1.9 * pulse + 0.05, p[2] + Math.sin(a) * Math.cos(phi) * R * pulse, 0.07, COL.mint);
      }
    }
    put('glow', p[0], 1.85, p[2], 0.09, COL.mint);
  },
  strike(p, age, delay, t) {
    const r = 2.5;
    if (age < delay) {
      const late = age > delay - 0.5;
      const hex = late ? COL.red : COL.strike;
      const n = 36, rot = t * 1.5;
      for (let i = 0; i < n; i += 2) { const a = rot + (i / n) * Math.PI * 2; put('emit', p[0] + Math.cos(a) * r, 0.06, p[2] + Math.sin(a) * r, 0.09, hex, 1.6, 0.5, 1, -a); }
      const inner = r * (1 - age / delay);
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; put('emit', p[0] + Math.cos(a) * inner, 0.06, p[2] + Math.sin(a) * inner, 0.06, hex); }
      put('glow', p[0], 0.04, p[2], 1, hex, 0.5, 0.05, 0.5);
      lightReq(p[0], 0.5, p[2], hex, 1.2 + 1.5 * (0.5 + 0.5 * Math.sin(t * 12)), 2);
    } else if (age < delay + 0.9) {
      const q = (age - delay) / 0.9;
      put('glow', p[0], 6, p[2], 1, COL.strike, 0.9 * (1 - q) + 0.1, 12, 0.9 * (1 - q) + 0.1);
      put('emit', p[0], 6, p[2], 1, COL.white, 0.3 * (1 - q) + 0.02, 12, 0.3 * (1 - q) + 0.02);
      lightReq(p[0], 1, p[2], COL.strike, 9 * (1 - q), 5);
    }
  },
  sensorPulse(p) {
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      spawn({ mesh: 'glow', p: [p[0], 0.1, p[2]], v: [Math.cos(a) * 11, 0, Math.sin(a) * 11], life: 1.0, s0: 0.12, s1: 0.04, c0: COL.white, c1: COL.amber, drag: 0.3 });
    }
  },
  sensorMark(p, t) {
    const s = 0.45 + 0.04 * Math.sin(t * 5);
    for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      put('emit', p[0] + dx * s, 0.08, p[2] + dz * s, 0.05, COL.amber, 1, 1, 1);
      put('emit', p[0] + dx * s, 1.1, p[2] + dz * s, 0.04, COL.amber, 1, 18, 1);
    }
  },
  bolt(p, angle, kind, dt) {
    // Projektil: gestreckter Würfel in Flugrichtung + kurze Spur
    const hex = kind === 'enemy' ? COL.enemyBolt : kind === 'warden' ? COL.violet : kind === 'pistol' ? COL.shield : COL.mint;
    const yaw = Math.atan2(Math.cos(angle), Math.sin(angle));
    if (kind === 'warden') {
      put('glow', p[0], p[1], p[2], 0.34, hex);
      put('emit', p[0], p[1], p[2], 0.16, COL.white);
    } else {
      put('emit', p[0], p[1], p[2], 0.07, hex, 1, 1, kind === 'pistol' ? 5 : 7, yaw);
      put('glow', p[0], p[1], p[2], 0.12, hex, 1, 1, 4, yaw);
    }
    if (Math.random() < dt * 40) spawn({ mesh: 'emit', p: p.slice(), v: [rnd(-0.1, 0.1), rnd(-0.1, 0.1), rnd(-0.1, 0.1)], life: 0.15, s0: 0.04, s1: 0, c0: hex, c1: hex });
  },
  alarm(p, mode, t) {
    // Alarm rot: pulsierendes Rotlicht; Notstrom: flackerndes, schwaches Bernsteinlicht (Licht-mode der Wandleuchten macht ship.js)
    if (mode === 'red') lightReq(p[0], 2.6, p[2], COL.red, 1.5 + 1.5 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2)), 0);
    else if (mode === 'power') lightReq(p[0], 2.6, p[2], COL.amber, Math.random() < 0.08 ? 0.2 : 0.9, 0);
  },
};

// ------------------------------------------------------------------------------------------------------------------------------
// Stationen (Sockets aus dem Manifest, gedreht wie CORE sie stellt: +z zur ersten begehbaren Nachbarkachel, Suche +z, −z, −x, +x)
function buildStations() {
  const m = F.ctx.map; F.stations = [];
  if (!m || !m.info || F.ctx.zone !== 'ship') return;
  for (let y = 0; y < (m.h || 0); y++) for (let x = 0; x < (m.w || 0); x++) {
    const ch = m.at(x, y), info = m.info(x, y);
    if (!info || !info.system) continue;
    let yaw = 0;
    for (const [dx, dy, yw] of [[0, 1, 0], [0, -1, Math.PI], [-1, 0, -Math.PI / 2], [1, 0, Math.PI / 2]]) if (!m.solid(x + dx, y + dy)) { yaw = yw; break; }
    const asset = 'lerche/station/' + (STATION_ASSET[ch] || 'reactor');
    F.stations.push({ sys: info.system, x, y, yaw, asset, seed: (x * 7 + y * 13) % 10 });
  }
}
function socketOf(stn, name) {
  let s = null;
  try { const mf = F.ctx.loader && F.ctx.loader.manifest ? F.ctx.loader.manifest(stn.asset) : null; s = mf && mf.sockets && mf.sockets[name]; } catch (e) { s = null; }
  s = s || DEF_SOCKETS[name] || [0, 1, 0];
  const c = Math.cos(stn.yaw), sn = Math.sin(stn.yaw);
  const base = Wt(stn.x, stn.y, 0);
  return [base[0] + s[0] * c + s[2] * sn, base[1] + s[1], base[2] - s[0] * sn + s[2] * c];
}
function botSocket(b, name, yaw, def) {
  let s = null;
  try { const mf = F.ctx.loader && F.ctx.loader.manifest ? F.ctx.loader.manifest('lerche/actor/bot') : null; s = mf && mf.sockets && mf.sockets[name]; } catch (e) { s = null; }
  s = s || def;
  const c = Math.cos(yaw), sn = Math.sin(yaw), base = W(b.x, b.y, 0);
  return [base[0] + s[0] * c + s[2] * sn, base[1] + s[1], base[2] - s[0] * sn + s[2] * c];
}
function stationOfSystem(sys) { return (F.stations || []).find((s) => s.sys === sys) || null; }

// ------------------------------------------------------------------------------------------------------------------------------
// Snapshot → Effekte
function nearestFire(st, p) {
  let best = null, bd = 1e9;
  for (const f of (st.ship && st.ship.fires) || []) {
    const d = Math.hypot(f[0] * TILE + 16 - p.x, f[1] * TILE + 16 - p.y);
    if (d < bd) { bd = d; best = f; }
  }
  return bd < 80 ? best : null;
}
function frontOf(px, py, yawDir, dist, h) {
  const a = yawDir;
  return W(px + Math.sin(a) * dist * TILE, py + Math.cos(a) * dist * TILE, h);
}
const DIR_YAW = { down: 0, right: Math.PI / 2, up: Math.PI, left: -Math.PI / 2 };

function shipFx(view, st, dt, t) {
  const ship = st.ship || {};
  // Feuer
  const nowFires = new Map();
  for (const f of ship.fires || []) {
    const k = f[0] + ',' + f[1];
    const born = F.prev.fires.has(k) ? F.prev.fires.get(k) : t;
    nowFires.set(k, born);
    if (!visibleDeckTile(f[1])) continue;
    let nb = 0; for (const g of ship.fires) if (Math.abs(g[0] - f[0]) + Math.abs(g[1] - f[1]) === 1) nb++;
    const size = Math.min(2, (t - born > 4 ? 1 : 0) + (t - born > 12 ? 1 : 0) + (nb >= 2 ? 1 : 0));
    FX.fire(Wt(f[0], f[1], 0), size, dt, t);
  }
  for (const [k] of F.prev.fires) if (!nowFires.has(k)) { const [x, y] = k.split(',').map(Number); if (visibleDeckTile(y)) FX.foamBurst(Wt(x, y, 0)); }
  F.prev.fires = nowFires;
  // Lecks
  for (const b of ship.breaches || []) if (visibleDeckTile(b.ty)) FX.breach(Wt(b.tx, b.ty, 0), dt, t);
  // Stationen: beschädigt = Funken, zerstört = Rauch, EMP = Bögen, Eskalation = Boden glimmt
  if (!F.stations) buildStations();
  const sys = ship.systems || {}, esc = ship.escalate || {};
  for (const s of F.stations) {
    if (!visibleDeckTile(s.y)) continue;
    const state = sys[s.sys] || 'ok';
    if (state === 'damaged') { if (Math.floor(t * 1.6 + s.seed * 0.37) !== Math.floor((t - dt) * 1.6 + s.seed * 0.37)) FX.sparks(socketOf(s, 'fx_spark'), 7); }
    else if (state === 'broken') { FX.smoke(socketOf(s, 'fx_smoke'), dt, 1.2); if (Math.random() < dt * 0.7) FX.sparks(socketOf(s, 'fx_spark'), 4); }
    else if (state === 'offline') FX.empArcs(socketOf(s, 'fx_spark'), t);
    if (esc[s.sys] != null) FX.escalate(Wt(s.x, s.y, 0), +esc[s.sys], dt, t);
  }
  // Bots: löschen/reparieren
  for (const b of view.bots || []) {
    if (!b.task || !(b.progress > 0) || !visibleDeckPx(b.y)) continue;
    const to = W(b.task.x, b.task.y, 0.1);
    // ART-F: Sockets nozzle (Löschstrahl) und tool (Schweißfunken), Bot schaut (+z) zur Aufgabe
    const yaw = Math.atan2(b.task.x - b.x, b.task.y - b.y);
    if (b.task.kind === 'extinguish') FX.gelStream(botSocket(b, 'nozzle', yaw, [0, 0.55, 0.3]), [to[0], 0.25, to[2]], dt);
    else FX.repairSparks(botSocket(b, 'tool', yaw, [0, 0.55, 0.45]), dt, t, (b.id && b.id.length) || 1);
  }
  // Rückschläge
  for (const s of view.setbacks || []) {
    const key = s.system + '|' + (s.pid || '') + '|' + (s.bot || '');
    const last = F.prev.setbacks[key];
    if (last == null || s.age < last) {
      const stn = stationOfSystem(s.system);
      if (stn && visibleDeckTile(stn.y)) FX.setback(socketOf(stn, 'fx_spark'));
    }
    F.prev.setbacks[key] = s.age;
  }
  // Alarm / Notstrom (Licht-mode der Wandleuchten macht ship.js)
  const reactor = ship.reactor || {};
  if (F.focus && F.ctx.deck === 0) {
    if (reactor.state === 'offline') FX.alarm([F.focus.x, 0, F.focus.z], 'power', t);
    else if (ship.alert === 'red') FX.alarm([F.focus.x, 0, F.focus.z], 'red', t);
  }
}

function playerFx(view, st, dt, t) {
  const zone = F.ctx.zone, want = zone === 'ship' ? 'ship' : 'away';
  const v2 = !!(st.away && st.away.combat === 'v2');
  for (const p of view.players || []) {
    if (p.connected === false) continue;
    const hex = PLAYER_COLORS[p.color || 0] || COL.mint;
    // Heilen (hp springt hoch)
    const hp0 = F.prev.hp[p.id];
    if (hp0 != null && (p.hp || 0) - hp0 >= 20 && p.zone === want && visibleDeckPx(p.y)) FX.heal(W(p.x, p.y, 0));
    F.prev.hp[p.id] = p.hp || 0;
    if (p.zone !== want || !visibleDeckPx(p.y)) continue;
    const pos = W(p.x, p.y, 0);
    // Beamen
    if (p.action && p.action.kind === 'beam') FX.beam(pos, clamp01(p.action.progress || 0), dt, hex, false);
    const bf = view.beamFx && view.beamFx[p.id];
    if (bf != null) FX.beam(pos, clamp01(bf), dt, hex, true);
    const a = p.action;
    if (a) {
      if (a.kind === 'extinguish' && zone === 'ship') {
        const f = nearestFire(st, p);
        const yawDir = f ? Math.atan2(f[0] * TILE + 16 - p.x, f[1] * TILE + 16 - p.y) : (DIR_YAW[p.dir] || 0);
        const from = frontOf(p.x, p.y, yawDir, 0.35, 1.0);
        const to = f ? Wt(f[0], f[1], 0.25) : frontOf(p.x, p.y, yawDir, 1.2, 0.2);
        FX.gelStream(from, to, dt);
      } else if (a.kind === 'flick' || a.kind === 'swap' || a.kind === 'minigame' || a.kind === 'patch') {
        let target = null;
        const stn = a.system ? stationOfSystem(a.system) : null;
        if (stn && Math.hypot(stn.x * TILE + 16 - p.x, stn.y * TILE + 16 - p.y) < 90) {
          const s = W(p.x, p.y, 0), c = Wt(stn.x, stn.y, 0);
          target = [s[0] + (c[0] - s[0]) * 0.6, a.kind === 'minigame' ? 1.0 : 0.65, s[2] + (c[2] - s[2]) * 0.6];
        } else if (a.kind === 'patch') {
          const b = ((st.ship && st.ship.breaches) || []).find((q) => Math.hypot(q.tx * TILE + 16 - p.x, q.ty * TILE + 16 - p.y) < 80);
          if (b) target = Wt(b.tx, b.ty, 0.3);
        }
        if (!target) target = frontOf(p.x, p.y, DIR_YAW[p.dir] || 0, 0.55, 0.7);
        if (a.kind === 'minigame') { if (Math.random() < dt * 4) FX.sparks(target, 2, { speed: 0.5 }); }
        else FX.repairSparks(target, dt, t, (p.color || 0) * 0.3);
      } else if (a.kind === 'revive') {
        const o = (view.players || []).find((q) => q.id !== p.id && q.downed && q.zone === p.zone && Math.hypot(q.x - p.x, q.y - p.y) < 64);
        if (o) FX.reviveFlow(pos, W(o.x, o.y, 0), dt);
      }
    }
    // Personenschild (Außenteam v2)
    if (v2 && zone !== 'ship' && Array.isArray(p.sh) && !p.downed) {
      FX.shieldRing([pos[0], p.cr ? 0.7 : 0.95, pos[2]], p.sh[0], p.sh[1], p.shR || 0, t, p.cr ? 0.5 : 0.58, false);
    }
    // Schildkuppel (Captain-Unterstützung)
    const aw = st.away || {};
    if (zone !== 'ship' && aw.kuppelUntil && st.time < aw.kuppelUntil) FX.kuppel(pos, t);
  }
}

function awayFx(view, st, dt, t) {
  const aw = st.away || {};
  const v2 = aw.combat === 'v2';
  const R = window.Render;
  // Gegner: Schilde, Wächter-Bogen, Tod → Explosion, Sensor-Markierung
  const sensorOn = !!(aw.sensorUntil && st.time < aw.sensorUntil);
  if (sensorOn && !F.prev.sensor) for (const p of view.players || []) if (p.zone === 'away') FX.sensorPulse(W(p.x, p.y, 0));
  F.prev.sensor = sensorOn;
  const alive = new Map();
  for (const e of view.drones || []) {
    const isAlive = e.alive !== false;
    alive.set(e.id, isAlive);
    const was = F.prev.drones.get(e.id);
    const pos = W(e.x, e.y, 0);
    if (was === true && !isAlive && !F.seen['boom:' + e.id]) { F.seen['boom:' + e.id] = 1; FX.explosion([pos[0], e.kind === 'warden' ? 1.0 : e.kind === 'scavenger' ? 0.8 : 0.75, pos[2]], e.kind === 'warden' ? 1.6 : 1); }
    const shown = !v2 || (isAlive ? !!e.vis : true);
    if (sensorOn && isAlive) FX.sensorMark(pos, t);
    if (!shown || !isAlive) continue;
    if (v2 && Array.isArray(e.sh) && e.kind !== 'warden') FX.shieldRing([pos[0], 0.9, pos[2]], e.sh[0], e.sh[1], 0, t, 0.5, true);
    if (e.kind === 'warden') {
      const facing = +e.facing || 0;
      let arc = 120; try { arc = (R && R.cfgNum) ? R.cfgNum('enemy.warden.frontArc', 120) : 120; } catch (e2) { arc = 120; }
      let sock = null; try { const mf = F.ctx.loader && F.ctx.loader.manifest && F.ctx.loader.manifest('lerche/actor/warden'); sock = mf && mf.sockets && mf.sockets.shield_front; } catch (e3) { sock = null; }
      FX.wardenFront(pos, facing, arc, !!e.asleep, t, sock);
      if (v2 && Array.isArray(e.sh)) FX.shieldRing([pos[0], 1.9, pos[2]], e.sh[0], e.sh[1], 0, t, 1.1, true);
    }
    // Zielen: glühende Mündung (rot)
    if (e.aim) {
      const pr = clamp01(e.aim.p);
      const tp = (view.players || []).find((q) => q.id === e.aim.target);
      const yawDir = tp ? Math.atan2(tp.x - e.x, tp.y - e.y) : 0;
      const m = frontOf(e.x, e.y, yawDir, e.kind === 'warden' ? 1.0 : 0.45, e.kind === 'warden' ? 1.4 : 1.15);
      put('emit', m[0], m[1], m[2], 0.05 + pr * 0.09, pr > 0.75 ? COL.spark : COL.red);
      put('glow', m[0], m[1], m[2], 0.12 + pr * 0.18, COL.red);
    }
  }
  F.prev.drones = alive;
  // Projektile: Bolzen + Mündungsfeuer bei neuen, Einschlag bei verschwundenen
  const now = new Map();
  for (const q of view.awayProjectiles || []) {
    const p = W(q.x, q.y, v2 ? 1.0 : 0.9);
    now.set(q.id, { p, kind: q.kind });
    if (!F.prev.proj.has(q.id)) {
      const hex = q.kind === 'enemy' ? COL.enemyBolt : q.kind === 'warden' ? COL.violet : COL.shield;
      FX.muzzle(p, hex);
    }
    FX.bolt(p, +q.angle || 0, q.kind, dt);
  }
  for (const [id, o] of F.prev.proj) if (!now.has(id)) FX.impact(o.p, o.kind === 'enemy' ? COL.enemyBolt : o.kind === 'warden' ? COL.violet : COL.shield);
  F.prev.proj = now;
  // Befehlssäulen des Captains
  for (const o of aw.orders || []) {
    if (!o || !ORDER_COL[o.kind] || (o.until != null && st.time != null && st.time > o.until)) continue;
    let ox = +o.x || 0, oy = +o.y || 0;
    if (o.kind === 'fokus' && o.target != null) { const e = (view.drones || []).find((d) => d.id === o.target); if (e) { ox = e.x; oy = e.y; } }
    FX.orderPillar(W(ox, oy, 0), ORDER_COL[o.kind], t);
  }
  // Orbitalschlag
  for (const s of aw.strikes || []) {
    const age = (st.time || 0) - (s.t != null ? s.t : st.time);
    const key = 'strike:' + s.x + ',' + s.y + ',' + s.t;
    FX.strike(W(s.x, s.y, 0), age, 1.5, t);
    if (age >= 1.5 && !F.seen[key]) { F.seen[key] = 1; FX.explosion(W(s.x, s.y, 0.3), 1.6); }
  }
}

// ------------------------------------------------------------------------------------------------------------------------------
// Ereignisse (Server) – gleiche Auslöser wie client.js onEvent → R.addFx im 2D-Renderer
function onEvent(ev) {
  if (!ev || typeof ev !== 'object') return;
  if (F.evSeen.has(ev)) return;
  F.evSeen.add(ev);
  F.stats.events++;
  F.queue.push({ ev, t: performance.now() });
  if (F.queue.length > 200) F.queue.shift();
}
function posOfEvent(ev, st) {
  if (ev.x != null && ev.y != null) return { x: +ev.x, y: +ev.y };
  if (ev.pid != null) { const p = (st.players || []).find((q) => q.id === ev.pid); if (p) return { x: p.x, y: p.y }; }
  if (ev.id != null) { const d = ((st.away && st.away.drones) || []).find((q) => q.id === ev.id); if (d) return { x: d.x, y: d.y }; }
  return null;
}
function handleEvent(ev, st) {
  const zone = F.ctx.zone, inShip = zone === 'ship';
  const pos = posOfEvent(ev, st);
  const at = (h) => (pos ? W(pos.x, pos.y, h) : null);
  switch (ev.kind) {
    case 'shieldHit': if (!inShip && pos) FX.shieldHit(at(0), 0.62); break;
    case 'shieldBreak': if (!inShip && pos) FX.shieldBreak(at(0)); break;
    case 'enemyShieldHit': if (!inShip && pos) FX.shieldHit(at(0), 0.55); break;
    case 'enemyDown': if (!inShip && pos && ev.id != null && !F.seen['boom:' + ev.id]) { F.seen['boom:' + ev.id] = 1; FX.explosion(at(0.8), ev.enemyKind === 'warden' ? 1.6 : 1); } break;
    case 'wardenDeflect': {
      if (inShip || !pos) break;
      const w = ((st.away && st.away.drones) || []).find((d) => d.id === ev.id);
      const f = w ? +w.facing || 0 : 0;
      FX.wardenDeflect(W(pos.x + Math.cos(f) * 1.5 * TILE, pos.y + Math.sin(f) * 1.5 * TILE, 1.0));
      break;
    }
    case 'wardenWake': if (!inShip) { const w = ((st.away && st.away.drones) || []).find((d) => d.kind === 'warden'); if (w) FX.empWave(W(w.x, w.y, 0), COL.violet); } break;
    case 'wardenDown': if (!inShip && pos) { FX.empWave(at(0), COL.violet); FX.explosion(at(1.0), 1.6); } break;
    case 'coverHit': if (!inShip && pos) FX.coverHit(at(0.75)); break;
    case 'revived': if (pos && !inShip) FX.revive(at(0)); break;
    case 'strike': if (pos && !inShip) { /* Telegraf läuft über away.strikes */ } break;
    case 'emp': {
      if (!inShip) break;
      const stn = ev.system ? stationOfSystem(ev.system) : null;
      if (stn && visibleDeckTile(stn.y)) FX.empWave(Wt(stn.x, stn.y, 0), COL.ice);
      break;
    }
    case 'systemHit': {
      if (!inShip) break;
      const stn = ev.system ? stationOfSystem(ev.system) : null;
      if (stn && visibleDeckTile(stn.y)) { FX.sparks(socketOf(stn, 'fx_spark'), 16, { speed: 1.5 }); if (ev.state === 'broken') FX.explosion(socketOf(stn, 'fx_smoke'), 0.6); }
      break;
    }
    case 'escalated': {
      if (!inShip) break;
      const stn = ev.system ? stationOfSystem(ev.system) : null;
      if (stn && visibleDeckTile(stn.y)) FX.explosion(Wt(stn.x, stn.y, 0.4), 0.5);
      break;
    }
    case 'repairDone': {
      if (!inShip) break;
      const stn = ev.system ? stationOfSystem(ev.system) : null;
      if (stn && visibleDeckTile(stn.y)) FX.revive(Wt(stn.x, stn.y, 0));
      break;
    }
    case 'sfx': {
      // Mündungsfeuer am Schützen (Spieler) – außerdem merkt sich actors.js den Schuss für die Zielpose
      if ((ev.name === 'pistol' || ev.name === 'blaster') && ev.x != null) {
        let best = null, bd = 40;
        for (const p of st.players || []) { if (p.zone !== 'away') continue; const d = Math.hypot(p.x - ev.x, p.y - ev.y); if (d < bd) { bd = d; best = p; } }
        if (best) F.shots[best.id] = performance.now() / 1000;
      }
      break;
    }
    default: break;
  }
}
function installEventHook() {
  const Net = window.Net;
  if (!Net || F.hooked === Net.onMessage) return;
  const orig = Net.onMessage;
  if (typeof orig !== 'function') return;
  const wrapped = function (msg) {
    const r = orig.apply(this, arguments);
    try { if (msg && msg.t === 'event') onEvent(msg); } catch (e) { err('event', e); }
    return r;
  };
  Net.onMessage = wrapped; F.hooked = wrapped;
}

// ------------------------------------------------------------------------------------------------------------------------------
/**
 * Effekt von außen auslösen (ship.js, away.js, Debug). opts: { x, y } Spiel-Pixel oder { pos: [x,y,z] } Welt, { h } Höhe,
 * { color, size, n, to: {x,y}|[x,y,z] }. Typen: fire, smoke, sparks, breach, gel, foam, foam_burst, repair, setback, beam_out, beam_in,
 * shield_hit, shield_break, muzzle, impact, cover_hit, warden_deflect, emp_wave, heal, revive, explosion, sensor, strike_boom.
 */
export function spawnFx(type, opts) {
  const o = opts || {};
  if (!F.ctx || !F.THREE) { F.queue.push({ fx: type, o, t: performance.now() }); return false; }
  try {
    const p = o.pos ? [o.pos[0] != null ? o.pos[0] : o.pos.x, o.pos[1] != null ? o.pos[1] : o.pos.y, o.pos[2] != null ? o.pos[2] : o.pos.z] : W(+o.x || 0, +o.y || 0, o.h || 0);
    const to = o.to ? (Array.isArray(o.to) ? o.to : W(o.to.x, o.to.y, o.to.h || 0)) : null;
    const dt = o.dt || 1 / 30;
    switch (type) {
      case 'fire': FX.fire(p, o.size || 0, dt, F.time); break;
      case 'smoke': FX.smoke(p, dt, o.n || 3); break;
      case 'sparks': FX.sparks(p, o.n || 10, { c0: o.color }); break;
      case 'breach': FX.breach(p, dt, F.time); break;
      case 'gel': if (to) FX.gelStream(p, to, dt); break;
      case 'foam': FX.foam(p, dt, o.n || 3); break;
      case 'foam_burst': FX.foamBurst(p); break;
      case 'repair': FX.sparks(p, 6, { speed: 0.8 }); break;
      case 'setback': FX.setback(p); break;
      case 'beam_out': FX.beam(p, o.v != null ? o.v : 1, dt, o.color || COL.mint, false); break;
      case 'beam_in': FX.beam(p, o.v != null ? o.v : 1, dt, o.color || COL.mint, true); break;
      case 'shield_hit': FX.shieldHit(p, o.size || 0.6); break;
      case 'shield_break': FX.shieldBreak(p); break;
      case 'muzzle': FX.muzzle(p, o.color); break;
      case 'impact': FX.impact(p, o.color); break;
      case 'cover_hit': FX.coverHit(p); break;
      case 'warden_deflect': FX.wardenDeflect(p); break;
      case 'emp_wave': FX.empWave(p, o.color); break;
      case 'heal': FX.heal(p); break;
      case 'revive': FX.revive(p); break;
      case 'explosion': case 'drone_explosion': FX.explosion(p, o.size || 1); break;
      case 'sensor': FX.sensorPulse(p); break;
      case 'strike_boom': FX.explosion(p, 1.6); break;
      default: return false;
    }
    return true;
  } catch (e) { err('spawnFx:' + type, e); return false; }
}

// ------------------------------------------------------------------------------------------------------------------------------
const layer = {
  id: 'fx',
  zones: ['*'],
  build(ctx) {
    F.ctx = ctx; F.THREE = ctx.THREE;
    const T = F.THREE;
    if (!F.group) {
      F.group = new T.Group(); F.group.name = 'fx';
      const geo = new T.BoxGeometry(1, 1, 1);
      const mats = {
        emit: new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
        lit: new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }),
        glow: new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }),
      };
      for (const name of ['emit', 'lit', 'glow']) {
        const im = new T.InstancedMesh(geo, mats[name], CAP[name]);
        im.instanceMatrix.setUsage(T.DynamicDrawUsage);
        im.setColorAt(0, new T.Color(1, 1, 1));
        im.instanceColor.setUsage(T.DynamicDrawUsage);
        im.count = 0; im.frustumCulled = false; im.castShadow = false; im.receiveShadow = name === 'lit';
        im.name = 'fx-' + name; if (name !== 'lit') im.userData.bloom = true;
        im.renderOrder = name === 'glow' ? 10 : 0;
        F.group.add(im); F.meshes[name] = im; F.pools[name] = makePool(CAP[name]);
      }
      for (let i = 0; i < FX_LIGHTS; i++) { const L = new T.PointLight(0xffffff, 0, 7, 2); L.castShadow = false; F.group.add(L); F.lights.push(L); }
    }
    if (F.group.parent !== ctx.root) ctx.root.add(F.group);
    installEventHook();
  },
  update(view, dt, ctx) {
    F.ctx = ctx || F.ctx; if (!F.ctx) return;
    if (!F.THREE) layer.build(F.ctx);
    if (F.group.parent !== F.ctx.root) F.ctx.root.add(F.group);
    if (F.frame % 60 === 0) installEventHook();
    F.frame++; F.time += dt;
    const zone = F.ctx.zone;
    if (zone !== F.lastZone || F.lastDeck !== F.ctx.deck) {
      // Zonen-/Deckwechsel: alte Partikel weg, Stationen neu bestimmen
      for (const P of Object.values(F.pools)) P.live = 0;
      if (zone !== F.lastZone) { F.stations = null; F.prev.proj = new Map(); F.prev.drones = new Map(); }
      F.lastZone = zone; F.lastDeck = F.ctx.deck;
    }
    const t = view.time != null ? view.time : F.time;
    const st = view.state || {};
    F.view = view;
    const me = view.self;
    F.focus = me ? (() => { const v = F.ctx.toWorld(me.x, me.y); return { x: v.x, z: v.z }; })() : null;
    try {
      // Warteschlange: Ereignisse und frühe spawnFx-Aufrufe
      const q = F.queue; F.queue = [];
      for (const it of q) {
        if (performance.now() - it.t > 1500) continue;
        if (it.ev) handleEvent(it.ev, st); else if (it.fx) spawnFx(it.fx, it.o);
      }
    } catch (e) { err('events', e); }
    try { stepPools(dt); } catch (e) { err('step', e); }
    try { if (zone === 'ship') shipFx(view, st, dt, t); } catch (e) { err('ship', e); }
    try { playerFx(view, st, dt, t); } catch (e) { err('players', e); }
    try { if (zone !== 'ship') awayFx(view, st, dt, t); } catch (e) { err('away', e); }
    // Explosionsblitze (Licht)
    for (let i = FX._flash.length - 1; i >= 0; i--) {
      const f = FX._flash[i]; f.t += dt;
      if (f.t >= f.T) { FX._flash.splice(i, 1); continue; }
      lightReq(f.p[0], f.p[1] + 0.5, f.p[2], f.hex, f.i * (1 - f.t / f.T), 6);
    }
    try { writeInstances(); assignLights(); } catch (e) { err('write', e); }
    window.VoxelFx.shots = F.shots;
    if (F.frame % 600 === 0) { const keep = {}; for (const k in F.seen) if (k.startsWith('boom:')) keep[k] = 1; F.seen = keep; }
  },
  dispose() {
    for (const P of Object.values(F.pools)) P.live = 0;
    if (F.group && F.group.parent) F.group.parent.remove(F.group);
  },
};

registerLayer(layer);
window.VoxelFx = { spawnFx, onEvent, stats: () => Object.assign({}, F.stats, { live: { emit: F.pools.emit && F.pools.emit.live, lit: F.pools.lit && F.pools.lit.live, glow: F.pools.glow && F.pools.glow.live } }), shots: F.shots, layer };
export { layer as fxLayer, onEvent };
