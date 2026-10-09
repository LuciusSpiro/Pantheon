// Layer „fx“ (CONTRACT-M4 §3.5) – Team ACTORS; B2-Effekte: Team FX (eigener Dateibesitz, CONTRACT-B1 §1.1)
// Alle Effekte als gepoolte Würfelpartikel: drei InstancedMesh (leuchtend, beleuchtet, additiv), zusammen ≤ 2000 Partikel,
// dazu höchstens FX_LIGHTS dynamische Punktlichter. Auslöser: Snapshot (Feuer, Lecks, Stationszustände, Aktionen, Schilde,
// Projektile, Befehle, Kuppel, Orbitalschlag, Sensor …) und Server-Ereignisse (wie im 2D-Renderer).
// Öffentlich: export function spawnFx(type, opts) · window.VoxelFx = { spawnFx, onEvent, clear, dauer, stats, shots }
// B2 (CONTRACT-B2 §8) – Ereignis → Typ: ueberhitzt→overheat · ladungLanze→lance_charge · lanzeSchuss→lance_beam · ausholen→windup ·
//   schlag→slash (+melee_hit im Sektor) · granate→grenade_arc · granateEinschlag→grenade_blast+stun_cloud · betaeubt→stun ·
//   bewusstlos→unconscious · gefesselt→bind · befreit→bind_release · aufgerichtet→lift_comrade · abgelenkt→deflect ·
//   Treffer mit waffe nahkampf|faust→melee_hit · neues Projektil→muzzle_<waffe>. Snapshot hält: ch wu bt zs ht ov gr, Granaten-Projektile.
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
    const hex = kind === 'enemy' ? COL.enemyBolt : kind === 'warden' ? COL.violet : kind === 'pistol' ? COL.shield : kind === 'betaeuber' ? '#3D8BFF' : kind === 'sturmgewehr' ? '#FFD98A' : COL.mint;
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

// ==============================================================================================================================
// B2 „Bodenkampf“ (Team FX, CONTRACT-B2 §0.13/§8/§10, ART-PLAN §1.7/§2.2, artdirector §3)
// Telegraf-Farben nach Wirkungstyp (nie Fraktion, nie Zustandsfarben M4 §6.2):
//   Glut-Orange = Flächenschaden (Granatring, Schlagsektor) · Weißgold = Präzision (Lanze) · Elektrisch-Blau = außer Gefecht.
// Ankündigungsregel: Lanze lädt ≥ 1 s mit Zielstrahl AM ZIEL, Ausholen 0,5 s mit Schlagsektor, Granatring ab Anlegen (gr) bzw.
// über die ganze Flugzeit – alles für alle Spieler sichtbar (keine Sichtprüfung im FX).
// Dauer-Effekte („dauer“) laufen über Ereignis (Timer) oder Snapshot (solange das Feld gesetzt ist) und folgen der Figur.
const TEL = {
  glut: '#FF7A2E', glutHot: '#FFC08A', glutDeep: '#B8381A', glutDim: '#6A2A12',
  gold: '#FFE9A8', goldHot: '#FFFAEA', goldDim: '#B8955A',
  blau: '#3D8BFF', blauHell: '#9CC8FF', blauWeiss: '#E4F1FF', blauDim: '#1E4A9A',
  dampf: '#C8D0D6', dampfGrau: '#9AA3AB', dampfDunkel: '#22272C', stahl: '#C9D4E0', hell: '#F4F7FA', hebe: '#FFF4D6',
};
const DIR_ANG = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
// Standard-Sockets (Vorwärts-Abstand m, Höhe m), solange actors.js keine Weltpunkte liefert (Wunsch: VoxelActors.socket(id, name))
const SOCK_DEF = { muzzle: [0.5, 1.15], vent: [0.12, 1.3], charge: [0.6, 1.25], blade_tip: [0.3, 1.8], head_top: [0, 2.02], wrists: [0, 0.95], chest: [0, 1.1] };
const B2T = ['lance_charge', 'lance_beam', 'grenade_arc', 'grenade_ring', 'grenade_blast', 'stun_cloud', 'stun', 'heat_vent', 'overheat', 'windup',
  'slash', 'unconscious', 'bind', 'bind_release', 'melee_hit', 'lift_comrade', 'deflect',
  'muzzle_blaster', 'muzzle_sturmgewehr', 'muzzle_granatwerfer', 'muzzle_lanze', 'muzzle_betaeuber', 'muzzle_pistole', 'muzzle_faust'];
F.b2 = { dauer: new Map(), ang: new Map(), proj: new Map(), seq: 0 };

function acfgNum(path, def) { try { const R = window.Render; const v = R && R.cfgNum ? R.cfgNum(path, def) : def; return isFinite(+v) ? +v : def; } catch (e) { return def; } }
function wcfg(waffe, key, def) {
  const v = acfgNum('waffen.' + waffe + '.' + key, NaN);
  if (isFinite(v)) return v;
  try { const C = window.CONFIG || (window.Shared_Config && window.Shared_Config.CONFIG); const a = C && C.awayCombat && C.awayCombat.waffen && C.awayCombat.waffen[waffe] && C.awayCombat.waffen[waffe][key]; if (Array.isArray(a)) return +a[a.length - 1]; if (isFinite(+a)) return +a; } catch (e) { /* Vorgabe */ }
  return def;
}
function entity(id) {
  if (id == null || !F.view) return null;
  for (const p of F.view.players || []) if (p.id === id) return p;
  for (const d of F.view.drones || []) if (d.id === id) return d;
  const st = F.view.state || {};
  for (const d of (st.away && st.away.drones) || []) if (d.id === id) return d;
  return null;
}
function isPlayer(e) { return !!(e && F.view && (F.view.players || []).includes(e)); }
function lying(e) { return !!(e && (e.zs === 'bewusstlos' || e.zs === 'verwundet' || e.downed)); }
function setAng(id, a) { if (id != null && isFinite(a)) F.b2.ang.set(id, { a: +a, t: F.time }); }
function angleOf(e) {
  if (!e) return 0;
  const m = e.id != null ? F.b2.ang.get(e.id) : null;
  if (m && F.time - m.t < 4) return m.a;
  if (e.facing != null && isFinite(+e.facing)) return +e.facing;
  if (e.aim && e.aim.target != null) { const q = entity(e.aim.target); if (q) return Math.atan2(q.y - e.y, q.x - e.x); }
  // nächster Gegner der anderen Seite
  const others = isPlayer(e) ? (F.view.drones || []).filter((d) => d.alive !== false) : (F.view.players || []).filter((p) => p.zone === 'away');
  let best = null, bd = 12 * TILE;
  for (const o of others) { const d = Math.hypot(o.x - e.x, o.y - e.y); if (d < bd) { bd = d; best = o; } }
  if (best) return Math.atan2(best.y - e.y, best.x - e.x);
  return DIR_ANG[e.dir] != null ? DIR_ANG[e.dir] : 0;
}
/** Socket einer Figur in Layer-Koordinaten. a = Blickwinkel (Spielwinkel, atan2(dy, dx)) */
function sockAt(e, name, a) {
  try {
    const VA = window.VoxelActors;
    if (e && e.id != null && VA && typeof VA.socket === 'function') {
      const w = VA.socket(e.id, name);
      if (w && F.ctx.root) { const v = F.ctx.root.worldToLocal(new F.THREE.Vector3(w[0], w[1], w[2])); return [v.x, v.y, v.z]; }
    }
  } catch (x) { /* Rückfall */ }
  const d = SOCK_DEF[name] || [0, 1];
  let f = d[0], h = d[1];
  if (lying(e)) { h = Math.min(h, name === 'head_top' ? 0.42 : 0.3); if (name === 'head_top') f = 0.65; }
  else if (e.zs === 'gefesselt' || e.zs === 'gefangen') h *= 0.66;
  else if (e.cr) h *= 0.72;
  if (a == null) a = angleOf(e);
  return W(e.x + Math.cos(a) * f * TILE, e.y + Math.sin(a) * f * TILE, h);
}
function toPx(o) {
  if (!o) return null;
  if (o.tx != null && o.ty != null) return { x: +o.tx, y: +o.ty };
  const t = o.to;
  if (!t) return null;
  if (Array.isArray(t)) return { x: t[0] * TILE, y: t[2] * TILE };
  if (t.id != null) { const e = entity(t.id); if (e) return { x: e.x, y: e.y }; }
  return t.x != null ? { x: +t.x, y: +t.y } : null;
}

// ---- Bausteine (Weltkoordinaten, m) ------------------------------------------------------------------------------------------
function line(mesh, a, b, w, hex, gap) {
  // Linie aus Würfeln (gap = 0 durchgehend, 1 = gestrichelt)
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dz) || 0.001;
  const n = Math.max(2, Math.min(80, Math.round(L * 3)));
  const yaw = Math.atan2(dx, dz), seg = L / n;
  for (let i = 0; i < n; i++) {
    if (gap && i % 2) continue;
    const u = (i + 0.5) / n;
    put(mesh, a[0] + dx * u, a[1] + dy * u, a[2] + dz * u, w, hex, 1, 1, (seg * (gap ? 0.8 : 1.02)) / w, yaw);
  }
}
function ring(mesh, p, r, n, size, hex, y, rot, flat) {
  for (let i = 0; i < n; i++) {
    const a = (rot || 0) + (i / n) * Math.PI * 2;
    put(mesh, p[0] + Math.cos(a) * r, y != null ? y : p[1], p[2] + Math.sin(a) * r, size, hex, flat ? 1.8 : 1, flat ? 0.45 : 1, 1, -a);
  }
}
/** Sektor am Boden um p (Welt), Richtung a (Spielwinkel), halbe Öffnung half, Radius R, Füllung k */
function sector(p, a, half, R, k, hexEdge, hexFill, on) {
  // Flackern = Wechsel hell/gedämpft (nie ganz aus, damit die Ankündigung durchgehend lesbar bleibt)
  if (!on) { hexEdge = TEL.glutDeep; hexFill = TEL.glutDim; }
  const m = Math.max(8, Math.round(R * 12));
  for (let i = 0; i <= m; i++) {
    const b = a - half + (i / m) * half * 2;
    put('emit', p[0] + Math.cos(b) * R, 0.05, p[2] + Math.sin(b) * R, 0.065, hexEdge, 1.6, 0.5, 1, -b);
  }
  for (const s of [-1, 1]) {
    const b = a + s * half;
    for (let j = 1; j < 6; j++) { const r = (j / 6) * R; put('emit', p[0] + Math.cos(b) * r, 0.05, p[2] + Math.sin(b) * r, 0.05, hexEdge); }
  }
  const rings = Math.ceil(4 * clamp01(k));
  for (let j = 1; j <= rings; j++) {
    const r = R * Math.min(k, j / 4);
    const n = Math.max(4, Math.round(r * 9));
    for (let i = 0; i <= n; i++) { const b = a - half + (i / n) * half * 2; put('glow', p[0] + Math.cos(b) * r, 0.04, p[2] + Math.sin(b) * r, 0.16, hexFill, 1, 0.3, 1, -b); }
  }
}
function crackle(a, b, hexA, hexB, n) {
  // gezackter Blitz zwischen a und b
  let x = a[0], y = a[1], z = a[2];
  const N = n || 8;
  for (let i = 1; i <= N; i++) {
    const u = i / N, j = i === N ? 0 : 0.12;
    const nx = a[0] + (b[0] - a[0]) * u + rnd(-j, j), ny = a[1] + (b[1] - a[1]) * u + rnd(-j, j), nz = a[2] + (b[2] - a[2]) * u + rnd(-j, j);
    put('emit', (x + nx) / 2, (y + ny) / 2, (z + nz) / 2, 0.035, i % 2 ? hexA : hexB);
    put('emit', nx, ny, nz, 0.035, hexA);
    x = nx; y = ny; z = nz;
  }
}
function arcPoint(from, to, u, peak) {
  return [from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u + 4 * peak * u * (1 - u), from[2] + (to[2] - from[2]) * u];
}

const FX2 = {
  // Lanze laden: Glühen an der Waffe + Ziellinie dünn → dick → hell, Zielmarke AM ZIEL zieht sich zusammen
  lanceCharge(from, to, k, t, dt) {
    const kk = k * k;
    put('glow', from[0], from[1], from[2], 0.14 + 0.3 * k, TEL.gold);
    put('emit', from[0], from[1], from[2], 0.04 + 0.07 * k, k > 0.9 && (t * 24 | 0) % 2 ? TEL.goldHot : TEL.gold);
    if (Math.random() < dt * (8 + 40 * k)) {
      const a = Math.random() * Math.PI * 2, r = rnd(0.35, 0.6);
      spawn({ mesh: 'emit', p: [from[0] + Math.cos(a) * r, from[1] + rnd(-0.25, 0.25), from[2] + Math.sin(a) * r], v: [-Math.cos(a) * r / 0.22, 0, -Math.sin(a) * r / 0.22], life: 0.22, s0: 0.03, s1: 0.05, c0: TEL.goldDim, c1: TEL.goldHot });
    }
    if (to) {
      const w = 0.014 + 0.075 * kk;
      line('emit', from, to, w, k < 0.35 ? TEL.goldDim : k < 0.8 ? TEL.gold : TEL.goldHot, 0);
      if (k > 0.45) line('glow', from, to, w * 3.2, TEL.gold, 1);
      // Wanderpuls entlang der Linie (zum Ziel hin, wird schneller)
      const u = (t * (0.8 + 2.2 * k)) % 1;
      put('emit', from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u, from[2] + (to[2] - from[2]) * u, w * 2.2 + 0.03, TEL.goldHot);
      // Zielmarke am Ziel: Ring am Boden schrumpft, Kreuz auf Brusthöhe
      const r = 0.95 - 0.6 * k;
      ring('emit', to, r, 12, 0.05 + 0.03 * k, k > 0.85 ? TEL.goldHot : TEL.gold, 0.05, t * 2, true);
      ring('glow', to, r, 12, 0.12, TEL.gold, 0.05, t * 2, true);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) put('emit', to[0] + dx * (0.16 + 0.2 * (1 - k)), to[1], to[2] + dz * (0.16 + 0.2 * (1 - k)), 0.045, TEL.goldHot, dx ? 3 : 1, 1, dz ? 3 : 1);
      lightReq(to[0], 0.6, to[2], TEL.gold, 0.4 + 1.6 * k, 3);
    }
    lightReq(from[0], from[1], from[2], TEL.gold, 0.5 + 2 * k, 3);
  },
  lanceBeam(from, to, stufe, q, fresh) {
    const s = Math.max(1, +stufe || 1);
    const w = (0.06 + 0.035 * s) * (1 - q * 0.75);
    line('emit', from, to, w, q < 0.5 ? TEL.goldHot : TEL.gold, 0);
    line('glow', from, to, w * 3.5 * (1 - q), TEL.gold, 0);
    if (fresh) {
      const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
      for (let i = 0; i < 26; i++) { const u = Math.random(); spawn({ mesh: 'glow', p: [from[0] + dx * u, from[1] + dy * u, from[2] + dz * u], v: [rnd(-0.2, 0.2), rnd(0.2, 0.6), rnd(-0.2, 0.2)], life: rnd(0.4, 0.8), s0: 0.06, s1: 0, c0: TEL.goldHot, c1: TEL.gold }); }
      FX.sparks(to, 10 + 6 * s, { speed: 1.3, c0: TEL.goldHot, c1: TEL.gold });
      for (let i = 0; i < 8; i++) spawn({ mesh: 'emit', p: from.slice(), v: [rnd(-1, 1), rnd(-0.4, 1), rnd(-1, 1)], life: 0.14, s0: 0.1, s1: 0, c0: TEL.goldHot, c1: TEL.gold });
      FX._flash.push({ p: to.slice(), t: 0, T: 0.3, hex: TEL.gold, i: 4 + 2 * s });
    }
  },
  // Granate: gestrichelter Bogen (Rest der Flugbahn) + Kugel + Aufschlagring, der sich füllt
  grenadeArc(from, to, k, R, t, dt) {
    const L = Math.hypot(to[0] - from[0], to[2] - from[2]);
    const peak = Math.min(3.5, 0.8 + L * 0.28);
    const N = Math.max(10, Math.min(36, Math.round(L * 2.4)));
    // ganze Flugbahn gestrichelt; schon geflogener Teil gedämpft, Rest hell
    for (let i = 0; i < N; i += 2) {
      const u0 = i / N, u1 = (i + 1) / N;
      const a = arcPoint(from, to, u0, peak), b = arcPoint(from, to, u1, peak);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const ahead = u1 >= k;
      put('emit', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, ahead ? 0.06 : 0.04, ahead ? TEL.glut : TEL.glutDeep, 1, 1, len * 0.9 / (ahead ? 0.06 : 0.04), Math.atan2(b[0] - a[0], b[2] - a[2]));
    }
    if (k < 1) {
      const b = arcPoint(from, to, k, peak);
      put('emit', b[0], b[1], b[2], 0.16, '#3A3E46');
      put('emit', b[0], b[1] + 0.06, b[2], 0.07, (t * 10 | 0) % 2 ? TEL.glutHot : TEL.glut);
      put('glow', b[0], b[1], b[2], 0.28, TEL.glut);
      if (Math.random() < dt * 30) spawn({ mesh: 'lit', p: b.slice(), v: [rnd(-0.1, 0.1), rnd(0.1, 0.3), rnd(-0.1, 0.1)], life: rnd(0.5, 0.8), s0: 0.06, s1: 0.16, c0: '#6A6470', c1: COL.smokeLight, drag: 0.6 });
    }
    FX2.grenadeRing(to, R, k, t);
  },
  grenadeRing(p, R, k, t) {
    const late = k > 0.8, flick = late && (t * 14 | 0) % 2;
    const n = Math.max(24, Math.round(R * 20));
    ring('emit', p, R, n, 0.075, flick ? TEL.glutHot : TEL.glut, 0.05, t * 0.8, true);
    ring('glow', p, R, Math.round(n / 2), 0.2, TEL.glut, 0.05, t * 0.8, true);
    // Füllung: konzentrische Ringe von innen bis R·k
    const rr = R * clamp01(k);
    for (let j = 1; j <= 4; j++) {
      const r = rr * j / 4; if (r < 0.08) continue;
      ring('glow', p, r, Math.max(6, Math.round(r * 10)), 0.15, j === 4 ? TEL.glut : TEL.glutDeep, 0.04, -t * 0.5 + j, true);
    }
    put('emit', p[0], 0.05, p[2], 0.08, TEL.glutHot);
    lightReq(p[0], 0.5, p[2], TEL.glut, 0.6 + 2.2 * k, 3);
  },
  grenadeBlast(p, R) {
    const c = [p[0], 0.35, p[2]];
    for (let i = 0; i < 46; i++) {
      const u = Math.random(), a = Math.random() * Math.PI * 2, sp = rnd(1.5, 4.2);
      spawn({ mesh: 'emit', p: c.slice(), v: [Math.cos(a) * sp * (1 - u * 0.5), u * sp + 0.6, Math.sin(a) * sp * (1 - u * 0.5)], life: rnd(0.3, 0.6), s0: rnd(0.12, 0.24), s1: 0.02, c0: i % 3 ? TEL.glutHot : TEL.hell, c1: TEL.glutDeep, drag: 2.6 });
    }
    // Druckring am Boden bis R
    for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; spawn({ mesh: 'glow', p: [p[0], 0.08, p[2]], v: [Math.cos(a) * R / 0.3, 0, Math.sin(a) * R / 0.3], life: 0.32, s0: 0.2, s1: 0.06, c0: TEL.glutHot, c1: TEL.glut }); }
    for (let i = 0; i < 12; i++) { const a = Math.random() * Math.PI * 2, sp = rnd(1.5, 4); spawn({ mesh: 'lit', p: c.slice(), v: [Math.cos(a) * sp, rnd(2, 4.5), Math.sin(a) * sp], life: rnd(0.8, 1.3), s0: rnd(0.05, 0.09), s1: 0.04, c0: '#3A3E46', c1: '#22252B', grav: 9, drag: 0.2 }); }
    for (let i = 0; i < 9; i++) spawn({ mesh: 'lit', p: [p[0] + rnd(-0.4, 0.4), 0.3, p[2] + rnd(-0.4, 0.4)], v: [rnd(-0.4, 0.4), rnd(0.5, 1.1), rnd(-0.4, 0.4)], life: rnd(1.4, 2.4), s0: 0.22, s1: 0.65, c0: '#4A4044', c1: COL.smokeLight, drag: 0.6 });
    FX._flash.push({ p: c, t: 0, T: 0.35, hex: TEL.glut, i: 8 });
  },
  // Betäubungswolke: elektrisch-blauer Dunst mit Knistern, Rand bei R, blendet über k aus
  stunCloud(p, R, k, t, dt) {
    const f = 1 - k;
    for (let n = Math.floor(dt * 46 * f + Math.random()); n > 0; n--) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R * 0.9;
      spawn({ mesh: 'glow', p: [p[0] + Math.cos(a) * r, rnd(0.1, 1.1), p[2] + Math.sin(a) * r], v: [rnd(-0.15, 0.15), rnd(0.05, 0.35), rnd(-0.15, 0.15)], life: rnd(0.6, 1.0), s0: rnd(0.08, 0.14), s1: 0.02, c0: TEL.blauHell, c1: TEL.blau, drag: 0.8 });
    }
    for (let b = 0; b < 2; b++) {
      if (Math.random() > f * 0.8) continue;
      const a = Math.random() * Math.PI * 2, r = Math.random() * R * 0.8, s = [p[0] + Math.cos(a) * r, rnd(0.2, 1.0), p[2] + Math.sin(a) * r];
      crackle(s, [s[0] + rnd(-0.5, 0.5), s[1] + rnd(-0.4, 0.4), s[2] + rnd(-0.5, 0.5)], TEL.blauWeiss, TEL.blau, 5);
    }
    if ((t * 12 | 0) % 3) ring('emit', p, R, Math.max(16, Math.round(R * 14)), 0.045, f > 0.4 ? TEL.blau : TEL.blauDim, 0.05, -t * 1.2, true);
    lightReq(p[0], 0.8, p[2], TEL.blau, 1.6 * f, 2);
  },
  // Betäubt: Funkenkranz über dem Kopf
  stun(h, t, dt, seed) {
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = t * 4.2 + seed + (i / n) * Math.PI * 2, r = 0.3 + 0.035 * Math.sin(t * 13 + i * 1.7);
      const fl = ((t * 30 + i * 7) | 0) % 3;
      put('emit', h[0] + Math.cos(a) * r, h[1] + 0.05 * Math.sin(t * 9 + i), h[2] + Math.sin(a) * r, fl ? 0.045 : 0.065, fl ? TEL.blauHell : TEL.blauWeiss);
    }
    ring('glow', h, 0.3, 8, 0.12, TEL.blau, h[1], -t * 2);
    if (Math.random() < dt * 14) {
      const a = Math.random() * Math.PI * 2;
      spawn({ mesh: 'emit', p: [h[0] + Math.cos(a) * 0.3, h[1], h[2] + Math.sin(a) * 0.3], v: [Math.cos(a) * 1.2, rnd(-0.6, 0.8), Math.sin(a) * 1.2], life: 0.18, s0: 0.035, s1: 0, c0: TEL.blauWeiss, c1: TEL.blau, stretch: 3 });
    }
    if ((t * 7 | 0) % 2) crackle([h[0] - 0.3, h[1], h[2]], [h[0] + rnd(-0.1, 0.1), h[1] - 0.35, h[2] + rnd(-0.15, 0.15)], TEL.blauWeiss, TEL.blau, 4);
  },
  // Hitze: Dampf an der Kühlöffnung, ab 35 % Hitze, mehr je heißer
  heatVent(v, k, dt) {
    if (k < 0.35) return;
    const q = (k - 0.35) / 0.65;
    for (let n = Math.floor(dt * (4 + 26 * q) + Math.random()); n > 0; n--) {
      spawn({ mesh: 'glow', p: [v[0] + rnd(-0.05, 0.05), v[1] + 0.05, v[2] + rnd(-0.05, 0.05)], v: [rnd(-0.15, 0.15), rnd(0.5, 0.95), rnd(-0.15, 0.15)], life: rnd(0.7, 1.2), s0: 0.05 + 0.03 * q, s1: 0.14 + 0.06 * q, c0: TEL.dampf, c1: TEL.dampfDunkel, drag: 0.7 });
    }
    if (k > 0.8 && Math.random() < dt * 5) spawn({ mesh: 'emit', p: v.slice(), v: [rnd(-0.3, 0.3), rnd(0.4, 0.9), rnd(-0.3, 0.3)], life: 0.3, s0: 0.03, s1: 0, c0: TEL.glutHot, c1: TEL.glut });
  },
  // Überhitzt: Dampfstoß, dann Flackern + dichter Dampf bis zur Freigabe
  overheat(v, t, dt, fresh) {
    if (fresh) {
      for (let i = 0; i < 26; i++) { const a = Math.random() * Math.PI * 2; spawn({ mesh: 'glow', p: v.slice(), v: [Math.cos(a) * rnd(0.6, 1.6), rnd(0.8, 2.0), Math.sin(a) * rnd(0.6, 1.6)], life: rnd(0.7, 1.3), s0: 0.1, s1: 0.2, c0: TEL.hell, c1: TEL.dampfDunkel, drag: 1.4 }); }
      FX.sparks(v, 12, { speed: 1.2, c0: TEL.glutHot, c1: TEL.glut });
    }
    for (let n = Math.floor(dt * 24 + Math.random()); n > 0; n--) spawn({ mesh: 'glow', p: [v[0] + rnd(-0.06, 0.06), v[1] + 0.05, v[2] + rnd(-0.06, 0.06)], v: [rnd(-0.2, 0.2), rnd(0.6, 1.1), rnd(-0.2, 0.2)], life: rnd(0.8, 1.3), s0: 0.08, s1: 0.18, c0: TEL.dampf, c1: TEL.dampfDunkel, drag: 0.7 });
    const on = Math.random() < 0.55;
    if (on) { put('emit', v[0], v[1], v[2], 0.09, Math.random() < 0.5 ? TEL.glutHot : TEL.glut); put('glow', v[0], v[1], v[2], 0.24, TEL.glut); }
    if (Math.random() < dt * 6) FX.sparks(v, 2, { speed: 0.7, c0: TEL.glutHot, c1: TEL.glutDeep });
    lightReq(v[0], v[1], v[2], TEL.glut, on ? 1.4 : 0.2, 2);
  },
  // Ausholen: glühende Klinge + flackernder Schlagsektor am Boden (Glut-Orange = Fläche)
  windup(p, tip, a, k, R, t, dt) {
    put('glow', tip[0], tip[1], tip[2], 0.16 + 0.3 * k, TEL.glut);
    put('emit', tip[0], tip[1], tip[2], 0.05 + 0.06 * k, k > 0.7 ? TEL.goldHot : TEL.glutHot);
    if (Math.random() < dt * (6 + 30 * k)) spawn({ mesh: 'emit', p: tip.slice(), v: [rnd(-0.3, 0.3), rnd(0.3, 1.0), rnd(-0.3, 0.3)], life: rnd(0.2, 0.4), s0: 0.035, s1: 0, c0: TEL.glutHot, c1: TEL.glut, drag: 1 });
    const freq = 5 + 16 * k;
    const on = k > 0.85 || Math.sin(t * freq * Math.PI * 2) > -0.35;
    sector(p, a, 1.0, R, k, k > 0.85 ? TEL.glutHot : TEL.glut, TEL.glutDeep, on);
    lightReq(tip[0], tip[1], tip[2], TEL.glut, 0.6 + 1.8 * k, 3);
  },
  // Schlag: Klingenspur als Bogen + kurzer Sektorblitz
  slash(p, a, fresh, q, R) {
    if (fresh) {
      for (let i = 0; i < 24; i++) {
        const u = i / 23, b = a - 1.1 + u * 2.2, r = 0.95;
        const tx = -Math.sin(b), tz = Math.cos(b);
        spawn({ mesh: 'emit', p: [p[0] + Math.cos(b) * r, 1.35 - u * 0.6, p[2] + Math.sin(b) * r], v: [tx * 2.2 + Math.cos(b) * 0.6, -0.4, tz * 2.2 + Math.sin(b) * 0.6], life: rnd(0.16, 0.28), s0: 0.1, s1: 0.02, c0: i % 3 ? TEL.glutHot : TEL.hell, c1: TEL.glut, stretch: 3.2 });
      }
      lightReq(p[0], 1, p[2], TEL.glutHot, 3, 4);
    }
    sector(p, a, 1.0, R, 1, q < 0.5 ? TEL.glutHot : TEL.glut, TEL.glut, true);
  },
  // Bewusstlos: langsamer blauer Puls (ruhig, nicht Telegraf-hektisch)
  unconscious(p, t, seed) {
    const P = 2.4, ph = ((t + seed) % P) / P;
    const r = 0.35 + 0.8 * ph, fade = 1 - ph;
    ring('emit', p, r, 20, 0.085 * fade + 0.015, ph < 0.5 ? TEL.blauHell : TEL.blau, 0.05, seed, true);
    ring('glow', p, r, 14, 0.2 * fade + 0.03, TEL.blau, 0.05, seed + 0.2, true);
    // ruhiger Grundring am Körper, atmet mit
    const br = 0.5 + 0.5 * Math.sin((t + seed) * Math.PI * 2 / P);
    ring('glow', p, 0.42, 12, 0.08 + 0.08 * br, TEL.blauDim, 0.06, -t * 0.3, true);
    put('emit', p[0], 0.45, p[2], 0.04 + 0.04 * br, TEL.blauHell);
  },
  // Fesseln: Energiefessel-Bogen vom Fesselnden, danach rotierende Doppelschlaufe am Handgelenk
  bind(wr, from, age, t) {
    if (from && age < 0.6) {
      const q = age / 0.6;
      const mid = [(from[0] + wr[0]) / 2, Math.max(from[1], wr[1]) + 0.5, (from[2] + wr[2]) / 2];
      const N = 12;
      let prev = from;
      for (let i = 1; i <= N; i++) {
        const u = i / N, a = 1 - u;
        const pt = [a * a * from[0] + 2 * a * u * mid[0] + u * u * wr[0] + rnd(-0.04, 0.04), a * a * from[1] + 2 * a * u * mid[1] + u * u * wr[1] + rnd(-0.04, 0.04), a * a * from[2] + 2 * a * u * mid[2] + u * u * wr[2] + rnd(-0.04, 0.04)];
        if (u <= q * 1.6) { put('emit', pt[0], pt[1], pt[2], 0.045, i % 2 ? TEL.blauWeiss : TEL.blauHell); put('glow', (prev[0] + pt[0]) / 2, (prev[1] + pt[1]) / 2, (prev[2] + pt[2]) / 2, 0.12, TEL.blau); }
        prev = pt;
      }
      lightReq(wr[0], wr[1], wr[2], TEL.blau, 2, 3);
    }
    const s = age < 0.6 ? age / 0.6 : 1;
    // Fesselband um die Figur (von oben lesbar, größer als der Körper)
    ring('emit', wr, 0.36 * s + 0.02, 14, 0.055, TEL.blauHell, wr[1] - 0.06, t * 2.4);
    ring('emit', wr, 0.32 * s + 0.02, 12, 0.05, TEL.blauWeiss, wr[1] + 0.08, -t * 3);
    ring('glow', wr, 0.34 * s, 10, 0.14, TEL.blau, wr[1], t);
    if ((t * 5 | 0) % 2) crackle([wr[0] + 0.34, wr[1] - 0.06, wr[2]], [wr[0] - 0.1, wr[1] + 0.08, wr[2] + 0.32], TEL.blauWeiss, TEL.blau, 4);
  },
  bindRelease(wr) {
    for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2; spawn({ mesh: 'emit', p: [wr[0] + Math.cos(a) * 0.16, wr[1], wr[2] + Math.sin(a) * 0.16], v: [Math.cos(a) * rnd(1, 2), rnd(-0.2, 0.8), Math.sin(a) * rnd(1, 2)], life: rnd(0.25, 0.45), s0: 0.05, s1: 0, c0: TEL.blauWeiss, c1: TEL.blau, drag: 1.5 }); }
    for (let i = 0; i < 8; i++) spawn({ mesh: 'lit', p: wr.slice(), v: [rnd(-1, 1), rnd(0.5, 1.5), rnd(-1, 1)], life: rnd(0.6, 0.9), s0: 0.05, s1: 0.03, c0: '#5A6A80', c1: '#3A4454', grav: 9 });
  },
  meleeHit(p, a) {
    const dx = Math.cos(a), dz = Math.sin(a);
    for (let i = 0; i < 18; i++) spawn({ mesh: 'emit', p: p.slice(), v: [dx * rnd(1, 3) + rnd(-1, 1), rnd(0.2, 2), dz * rnd(1, 3) + rnd(-1, 1)], life: rnd(0.2, 0.4), s0: rnd(0.04, 0.07), s1: 0, c0: i % 3 ? TEL.glutHot : TEL.hell, c1: TEL.glut, grav: 6, stretch: 2.5 });
    for (let i = 0; i < 12; i++) { const b = a + Math.PI / 2 + (i / 12) * Math.PI * 2; spawn({ mesh: 'glow', p: p.slice(), v: [Math.cos(b) * 1.6 * 0.4 + dx * 0.5, Math.sin(b) * 1.6, Math.cos(b) * 1.6 * 0.4 + dz * 0.5], life: 0.18, s0: 0.14, s1: 0.02, c0: TEL.hell, c1: TEL.glut }); }
    spawn({ mesh: 'emit', p: p.slice(), v: [0, 0, 0], life: 0.08, s0: 0.3, s1: 0.05, c0: TEL.hell, c1: TEL.glutHot });
    lightReq(p[0], p[1], p[2], TEL.glutHot, 3.2, 4);
  },
  deflect(p) {
    for (let i = 0; i < 16; i++) { const a = rnd(-1.4, 1.4) + Math.PI / 2; spawn({ mesh: 'emit', p: p.slice(), v: [Math.cos(a) * rnd(1, 2.5), rnd(0.3, 2), Math.sin(a) * rnd(1, 2.5) * (Math.random() < 0.5 ? -1 : 1)], life: rnd(0.2, 0.4), s0: 0.05, s1: 0, c0: TEL.hell, c1: TEL.stahl, grav: 6, stretch: 2.4 }); }
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; spawn({ mesh: 'glow', p: p.slice(), v: [Math.cos(a) * 1.4, Math.sin(a) * 1.0, Math.sin(a) * 0.4], life: 0.22, s0: 0.12, s1: 0.02, c0: TEL.hell, c1: TEL.stahl }); }
    lightReq(p[0], p[1], p[2], TEL.stahl, 2.5, 3);
  },
  // Kamerad aufrichten: Bodenring + aufsteigende helle Spirale (warmweiß, keine Zustandsfarbe)
  liftComrade(p) {
    for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2; spawn({ mesh: 'glow', p: [p[0] + Math.cos(a) * 0.25, 0.08, p[2] + Math.sin(a) * 0.25], v: [Math.cos(a) * 1.6, 0.05, Math.sin(a) * 1.6], life: 0.6, s0: 0.12, s1: 0.02, c0: TEL.hell, c1: TEL.hebe, drag: 1.4 }); }
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 4; spawn({ mesh: 'emit', p: [p[0] + Math.cos(a) * 0.4, 0.1 + i * 0.03, p[2] + Math.sin(a) * 0.4], v: [-Math.sin(a) * 0.6, rnd(1.4, 2.0), Math.cos(a) * 0.6], life: rnd(0.7, 1.0), s0: 0.055, s1: 0, c0: TEL.hell, c1: TEL.hebe, drag: 0.5 }); }
    lightReq(p[0], 1, p[2], TEL.hebe, 3, 3);
    FX._flash.push({ p: [p[0], 0.6, p[2]], t: 0, T: 0.5, hex: TEL.hebe, i: 3 });
  },
  liftFlow(from, to, dt, t, k) {
    for (let n = Math.floor(dt * 30 + Math.random()); n > 0; n--) {
      const life = 0.55;
      spawn({ mesh: 'glow', p: [from[0], 1.0, from[2]], v: [(to[0] - from[0]) / life + rnd(-0.2, 0.2), (0.35 - 1.0) / life, (to[2] - from[2]) / life + rnd(-0.2, 0.2)], life, s0: 0.09, s1: 0.04, c0: TEL.hebe, c1: TEL.hell });
    }
    // Ring unter dem Liegenden, wächst mit dem Fortschritt
    const r = 0.25 + 0.35 * (k || 0);
    ring('emit', to, r, 14, 0.05, TEL.hebe, 0.05, t * 1.5, true);
    ring('glow', to, r, 10, 0.14, TEL.hell, 0.05, t * 1.5, true);
  },
  // Mündungsfeuer je Waffe (p = Mündung, a = Schusswinkel)
  muzzle(waffe, p, a) {
    const dx = Math.cos(a), dz = Math.sin(a);
    switch (waffe) {
      case 'sturmgewehr': {
        // Leuchtspur + kurzer Sternblitz + Hülse
        spawn({ mesh: 'emit', p: [p[0] + dx * 0.3, p[1], p[2] + dz * 0.3], v: [dx * 14, 0, dz * 14], life: 0.07, s0: 0.05, s1: 0.04, c0: TEL.hell, c1: '#FFD98A', stretch: 9 });
        for (let i = 0; i < 4; i++) { const b = a + (i - 1.5) * 0.5; spawn({ mesh: 'emit', p: p.slice(), v: [Math.cos(b) * 2.5, rnd(-0.2, 0.3), Math.sin(b) * 2.5], life: 0.06, s0: 0.07, s1: 0, c0: TEL.hell, c1: '#FFD98A', stretch: 2.5 }); }
        spawn({ mesh: 'lit', p: p.slice(), v: [-dz * 1.6, 1.4, dx * 1.6], life: 0.5, s0: 0.03, s1: 0.03, c0: COL.bronze, c1: COL.bronze, grav: 9 });
        lightReq(p[0], p[1], p[2], '#FFD98A', 1.8, 3);
        break;
      }
      case 'granatwerfer':
        for (let i = 0; i < 8; i++) spawn({ mesh: 'lit', p: p.slice(), v: [dx * rnd(0.8, 1.8) + rnd(-0.3, 0.3), rnd(0.2, 0.7), dz * rnd(0.8, 1.8) + rnd(-0.3, 0.3)], life: rnd(0.6, 1.0), s0: 0.09, s1: 0.28, c0: '#8A8490', c1: COL.smokeLight, drag: 1.6 });
        for (let i = 0; i < 6; i++) spawn({ mesh: 'emit', p: p.slice(), v: [dx * 2 + rnd(-0.6, 0.6), rnd(-0.2, 0.6), dz * 2 + rnd(-0.6, 0.6)], life: 0.1, s0: 0.12, s1: 0, c0: TEL.glutHot, c1: TEL.glut });
        lightReq(p[0], p[1], p[2], TEL.glut, 2.2, 3);
        break;
      case 'lanze':
        for (let i = 0; i < 12; i++) { const b = (i / 12) * Math.PI * 2; spawn({ mesh: 'glow', p: p.slice(), v: [Math.cos(b) * 0.5 * -dz + dx * 0.4, Math.sin(b) * 0.9, Math.cos(b) * 0.5 * dx + dz * 0.4], life: 0.2, s0: 0.1, s1: 0, c0: TEL.goldHot, c1: TEL.gold }); }
        break;
      case 'betaeuber':
        // Bola-Schocker: zwei blaue Kugeln + Knistern
        for (const s of [-1, 1]) spawn({ mesh: 'emit', p: [p[0] - dz * 0.12 * s, p[1], p[2] + dx * 0.12 * s], v: [dx * 5 - dz * 0.8 * s, 0, dz * 5 + dx * 0.8 * s], life: 0.12, s0: 0.08, s1: 0.04, c0: TEL.blauWeiss, c1: TEL.blau });
        crackle(p, [p[0] + dx * 0.45, p[1] + rnd(-0.1, 0.1), p[2] + dz * 0.45], TEL.blauWeiss, TEL.blau, 4);
        for (let i = 0; i < 5; i++) spawn({ mesh: 'glow', p: p.slice(), v: [rnd(-1, 1), rnd(-0.5, 1), rnd(-1, 1)], life: 0.14, s0: 0.1, s1: 0, c0: TEL.blauHell, c1: TEL.blau });
        lightReq(p[0], p[1], p[2], TEL.blau, 1.8, 3);
        break;
      case 'faust':
        for (let i = 0; i < 6; i++) spawn({ mesh: 'lit', p: [p[0], 0.1, p[2]], v: [rnd(-0.5, 0.5) + dx * 0.4, rnd(0.2, 0.5), rnd(-0.5, 0.5) + dz * 0.4], life: rnd(0.5, 0.8), s0: 0.06, s1: 0.16, c0: '#B8AE98', c1: '#8C8270', drag: 1 });
        break;
      case 'pistole':
        for (let i = 0; i < 4; i++) spawn({ mesh: 'emit', p: p.slice(), v: [dx * 1.5 + rnd(-0.5, 0.5), rnd(-0.3, 0.6), dz * 1.5 + rnd(-0.5, 0.5)], life: 0.08, s0: 0.06, s1: 0, c0: TEL.hell, c1: COL.shield });
        lightReq(p[0], p[1], p[2], COL.shield, 1.4, 3);
        break;
      default: // blaster
        for (let i = 0; i < 6; i++) spawn({ mesh: 'emit', p: p.slice(), v: [dx * 2 + rnd(-0.8, 0.8), rnd(-0.4, 0.8), dz * 2 + rnd(-0.8, 0.8)], life: 0.11, s0: 0.09, s1: 0, c0: TEL.hell, c1: COL.shield });
        put('glow', p[0], p[1], p[2], 0.3, COL.shield);
        lightReq(p[0], p[1], p[2], COL.shield, 2, 3);
    }
  },
};

// ---- Dauer-Effekte -----------------------------------------------------------------------------------------------------------
function dauerKey(type, o) { return type + ':' + (o.id != null ? o.id : o.key != null ? o.key : 'n' + (++F.b2.seq)); }
function dauer(type, o, T) {
  const key = dauerKey(type, o);
  let d = F.b2.dauer.get(key);
  if (!d) { d = { type, key, age: 0, T: null, o: {}, snap: -1, k: null, fresh: true, seed: (F.b2.seq++ % 17) * 0.37 }; F.b2.dauer.set(key, d); }
  Object.assign(d.o, o);
  if (T != null) d.T = T;
  return d;
}
function dauerStop(type, id) {
  if (id == null) return;
  const d = F.b2.dauer.get(type + ':' + id);
  if (d) F.b2.dauer.delete(d.key);
}
/** Snapshot hält einen Dauer-Effekt am Leben (k optional) */
function hold(type, e, k, extra) {
  const d = dauer(type, Object.assign({ id: e.id }, extra || {}), null);
  d.snap = F.time; if (k != null) d.k = clamp01(k);
  return d;
}
function stepDauer(dt, t) {
  for (const d of F.b2.dauer.values()) {
    d.age += dt;
    let end;
    if (d.snap >= 0) end = F.time - d.snap > 0.3;   // Snapshot führt: endet, sobald das Feld fehlt
    else end = d.age > (d.T != null ? d.T : 5);
    if (end) { F.b2.dauer.delete(d.key); continue; }
    try { drawDauer(d, dt, t); } catch (e) { err('dauer:' + d.type, e); F.b2.dauer.delete(d.key); }
    d.fresh = false;
  }
}
function drawDauer(d, dt, t) {
  const o = d.o;
  const ent = (o.id != null ? entity(o.id) : null) || (o.x != null ? { id: null, x: +o.x, y: +o.y, zs: o.zs, cr: o.cr } : o.pos ? { id: null, x: o.pos[0] * TILE, y: o.pos[2] * TILE } : null);
  if (!ent) return;
  if (F.ctx.zone === 'ship' && !visibleDeckPx(ent.y)) return;
  const k = d.k != null && d.snap >= 0 ? d.k : d.T ? clamp01(d.age / d.T) : 0;
  const tp = toPx(o);
  const a = o.winkel != null ? +o.winkel : tp ? Math.atan2(tp.y - ent.y, tp.x - ent.x) : angleOf(ent);
  const base = W(ent.x, ent.y, 0);
  switch (d.type) {
    case 'lance_charge': FX2.lanceCharge(sockAt(ent, 'charge', a), tp ? W(tp.x, tp.y, 1.0) : null, d.k != null && d.snap >= 0 ? d.k : (o.k != null ? clamp01(o.k) : k), t, dt); break;
    case 'lance_beam': if (tp) FX2.lanceBeam(o.from || sockAt(ent, 'charge', a), W(tp.x, tp.y, 1.0), o.stufe, k, d.fresh); break;
    case 'grenade_arc': {
      if (!tp) break;
      if (!o.from) o.from = W(ent.x, ent.y, 1.3);
      FX2.grenadeArc(o.from, W(tp.x, tp.y, 0.05), k, (o.radius || wcfg('granatwerfer', 'radius', 1.5)) * 1, t, dt);
      if (k >= 1 && d.snap < 0) d.T = 0;
      break;
    }
    case 'grenade_ring': if (tp) FX2.grenadeRing(W(tp.x, tp.y, 0.05), o.radius || wcfg('granatwerfer', 'radius', 1.5), d.k != null ? d.k : (o.k != null ? o.k : k), t); break;
    case 'stun_cloud': FX2.stunCloud(base, o.radius || wcfg('granatwerfer', 'radius', 1.5), k, t, dt); break;
    case 'stun': FX2.stun(sockAt(ent, 'head_top', a), t, dt, d.seed); break;
    case 'heat_vent': FX2.heatVent(sockAt(ent, 'vent', a), d.k != null ? d.k : (o.k != null ? clamp01(o.k) : 1), dt); break;
    case 'overheat': FX2.overheat(sockAt(ent, 'vent', a), t, dt, d.fresh); break;
    case 'windup': {
      const R = (o.reach || wcfg(o.waffe || 'nahkampf', 'reichweite', 1.3)) + 0.35;
      FX2.windup(base, sockAt(ent, 'blade_tip', a), a, d.k != null && d.snap >= 0 ? d.k : k, R, t, dt);
      break;
    }
    case 'slash': FX2.slash(base, a, d.fresh, k, (o.reach || wcfg('nahkampf', 'reichweite', 1.3)) + 0.35); break;
    case 'unconscious': FX2.unconscious(base, t, d.seed); break;
    case 'bind': {
      const by = o.durch != null ? entity(o.durch) : null;
      const from = by ? sockAt(by, 'muzzle', Math.atan2(ent.y - by.y, ent.x - by.x)) : (o.to && !tp ? null : tp ? W(tp.x, tp.y, 1.0) : null);
      FX2.bind(sockAt(ent, 'wrists', a), from, d.age, t);
      break;
    }
    case 'lift_flow': if (tp) FX2.liftFlow(base, W(tp.x, tp.y, 0), dt, t, d.k != null ? d.k : k); break;
    default: break;
  }
}

// ---- Snapshot → B2-Effekte ---------------------------------------------------------------------------------------------------
function b2Snapshot(view, st, dt) {
  const aw = st.away || {};
  const v2 = aw.combat === 'v2';
  const list = [];
  for (const p of view.players || []) if (p.zone === 'away' && p.connected !== false) list.push(p);
  for (const e of view.drones || []) if (e.zs !== 'aus' && (!v2 || e.vis || e.zs === 'bewusstlos' || e.zs === 'gefesselt')) list.push(e);
  for (const e of list) {
    if (e.ch > 0) hold('lance_charge', e, e.ch / 100);
    if (e.wu > 0) hold('windup', e, e.wu / 100, e.wf && e.wf !== 'nahkampf' ? { waffe: e.wf } : null);
    if (e.bt) hold('stun', e);
    if (e.zs === 'bewusstlos') hold('unconscious', e);
    if (e.zs === 'gefesselt') hold('bind', e);
    if (e.ht >= 35) hold('heat_vent', e, e.ht / 100);
    if (e.ov) hold('overheat', e);
    // gr.t = Spielzeit des Zielbeginns (s), kein Fortschritt: Fortschritt aus aim.p, sonst (Zeit − gr.t) / 2 (shared/protocol.js)
    if (e.gr && e.gr.x != null) {
      const now = st.time != null ? +st.time : view.time;
      const k = e.aim && e.aim.p != null ? +e.aim.p : (e.gr.t != null && now != null ? (now - e.gr.t) / 2 : 0.5);
      hold('grenade_ring', e, clamp01(k), { tx: e.gr.x, ty: e.gr.y });
    }
    // Kamerad aufrichten (Hold-Interaktion des Spielers)
    if (e.action && e.action.kind === 'aufrichten') {
      const o = list.find((q) => q !== e && lying(q) && Math.hypot(q.x - e.x, q.y - e.y) < 64);
      if (o) hold('lift_flow', e, e.action.progress != null ? +e.action.progress : null, { tx: o.x, ty: o.y });
    }
  }
}
/** Granaten im Snapshot: Bogen übernehmen (Ereignis) oder neu anlegen; liefert true, wenn das Projektil eine Granate ist */
function grenadeProjectile(q) {
  if (q.kind !== 'granate' || q.tx == null) return false;
  let d = null;
  for (const x of F.b2.dauer.values()) if (x.type === 'grenade_arc' && x.o.tx != null && Math.hypot(x.o.tx - q.tx, x.o.ty - q.ty) < 12 && (x.o.pid == null || x.o.pid === q.id)) { d = x; break; }
  const flug = +q.flug || wcfg('granatwerfer', 'flug', 0.8);
  if (!d) {
    // Ereignis verpasst: x, y der Granate bleiben am Abwurfpunkt (waffen.js, speed 0), Flugbild rechnet FX aus t/flug
    d = dauer('grenade_arc', { key: 'p' + q.id, x: +q.x, y: +q.y, tx: +q.tx, ty: +q.ty }, null);
  }
  d.o.pid = q.id;
  d.snap = F.time;
  if (q.t != null) d.k = clamp01(+q.t / flug); else d.k = clamp01(d.age / flug);
  return true;
}
function shooterNear(x, y) {
  let best = null, bd = 40;
  for (const p of (F.view && F.view.players) || []) { if (p.zone !== 'away') continue; const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
  for (const e of (F.view && F.view.drones) || []) { const d = Math.hypot(e.x - x, e.y - y); if (d < bd) { bd = d; best = e; } }
  return best;
}
function meleeTargets(src, a, R) {
  const res = [];
  const pool = isPlayer(src) ? (F.view.drones || []).filter((d) => d.alive !== false && d.zs !== 'aus') : (F.view.players || []).filter((p) => p.zone === 'away');
  for (const o of pool) {
    const dx = o.x - src.x, dy = o.y - src.y, dist = Math.hypot(dx, dy) / TILE;
    if (dist > R || dist < 0.05) continue;
    let da = Math.atan2(dy, dx) - a; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) <= 1.05) res.push(o);
  }
  return res;
}

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
        // QA: Strahl aus dem Socket muzzle des Löschers (actors.js), sonst geschätzter Handpunkt
        let from = null;
        try {
          const mw = window.VoxelActors && window.VoxelActors.muzzle ? window.VoxelActors.muzzle(p.id) : null;
          if (mw && F.ctx.root) { const v = F.ctx.root.worldToLocal(new F.ctx.THREE.Vector3(mw[0], mw[1], mw[2])); from = [v.x, v.y, v.z]; }
        } catch (e) { from = null; }
        if (!from) from = frontOf(p.x, p.y, yawDir, 0.35, 1.0);
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
    // B2: Granate = Bogen + Ring (Ereignis bzw. Snapshot kind 'granate'), kein Bolzen
    if (grenadeProjectile(q)) { now.set(q.id, { p: null, kind: 'granate' }); continue; }
    const p = W(q.x, q.y, v2 ? 1.0 : 0.9);
    now.set(q.id, { p, kind: q.kind });
    if (!F.prev.proj.has(q.id)) {
      // B2: Mündungsfeuer je Waffe (kind = Waffe laut waffen.js, sonst wf des nächsten Schützen)
      const sh = shooterNear(q.x, q.y);
      const waffe = MUZZLE_OF[q.kind] || (sh && sh.wf && MUZZLE_OF[sh.wf]) || null;
      if (waffe) {
        const a = +q.angle || 0;
        if (sh) setAng(sh.id, a);
        FX2.muzzle(waffe, sh ? sockAt(sh, 'muzzle', a) : p, a);
      } else {
        const hex = q.kind === 'enemy' ? COL.enemyBolt : q.kind === 'warden' ? COL.violet : COL.shield;
        FX.muzzle(p, hex);
      }
    }
    FX.bolt(p, +q.angle || 0, BOLT_OF[q.kind] || q.kind, dt);
  }
  for (const [id, o] of F.prev.proj) if (!now.has(id) && o.p) FX.impact(o.p, o.kind === 'enemy' ? COL.enemyBolt : o.kind === 'warden' ? COL.violet : o.kind === 'betaeuber' ? TEL.blau : COL.shield);
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
  if (!inShip && b2Event(ev, pos)) return;
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
// B2-Ereignisse (CONTRACT-B2 §8, Nachtrag FX). true = vollständig behandelt.
const MELEE = { nahkampf: 1, faust: 1 };
const MUZZLE_OF = { blaster: 'blaster', sturmgewehr: 'sturmgewehr', granatwerfer: 'granatwerfer', lanze: 'lanze', betaeuber: 'betaeuber', faust: 'faust', pistole: 'pistole' };
const BOLT_OF = { blaster: 'player', pistole: 'pistol' };
function meleeHitAt(e, a) {
  if (!e) return;
  const key = 'mh:' + e.id;
  if (F.seen[key] && F.time - F.seen[key] < 0.25) return;
  F.seen[key] = F.time;
  FX2.meleeHit(W(e.x - Math.cos(a) * 0.25 * TILE, e.y - Math.sin(a) * 0.25 * TILE, lying(e) ? 0.4 : 1.1), a);
}
function b2Event(ev, pos) {
  const e = ev.id != null ? entity(ev.id) : null;
  const xy = e ? { x: e.x, y: e.y } : pos;
  switch (ev.kind) {
    case 'ueberhitzt': if (xy) dauer('overheat', { id: ev.id, x: xy.x, y: xy.y }, wcfg((e && e.wf) || 'blaster', 'sperre', 3)); return true;
    case 'ladungLanze': {
      if (ev.tx != null && ev.x != null) setAng(ev.id, Math.atan2(ev.ty - ev.y, ev.tx - ev.x));
      dauer('lance_charge', { id: ev.id, x: ev.x, y: ev.y, tx: ev.tx, ty: ev.ty }, wcfg('lanze', 'laden', 1.5));
      return true;
    }
    case 'lanzeSchuss': {
      const ch = F.b2.dauer.get('lance_charge:' + ev.id);
      const tx = ev.tx != null ? ev.tx : ch && ch.o.tx, ty = ev.ty != null ? ev.ty : ch && ch.o.ty;
      dauerStop('lance_charge', ev.id);
      if (tx == null) return true;
      const sx = ev.x != null ? ev.x : xy && xy.x, sy = ev.y != null ? ev.y : xy && xy.y;
      if (sx == null) return true;
      const a = Math.atan2(ty - sy, tx - sx); setAng(ev.id, a);
      const src = e || { id: null, x: sx, y: sy };
      dauer('lance_beam', { key: 'b' + (++F.b2.seq), x: sx, y: sy, tx, ty, stufe: ev.stufe, from: sockAt(src, 'charge', a) }, 0.35);
      FX2.muzzle('lanze', sockAt(src, 'charge', a), a);
      return true;
    }
    case 'ausholen': {
      if (ev.winkel != null) setAng(ev.id, +ev.winkel);
      const o = { id: ev.id, waffe: (e && e.wf) || 'nahkampf' };
      if (ev.winkel != null) o.winkel = +ev.winkel;
      if (xy) { o.x = xy.x; o.y = xy.y; }
      dauer('windup', o, wcfg(o.waffe, 'ausholen', 0.5));
      return true;
    }
    case 'schlag': {
      dauerStop('windup', ev.id);
      const sx = ev.x != null ? +ev.x : xy && xy.x, sy = ev.y != null ? +ev.y : xy && xy.y;
      if (sx == null) return true;
      const src = e || { id: ev.id, x: sx, y: sy };
      const a = ev.winkel != null ? +ev.winkel : angleOf(src);
      setAng(ev.id, a);
      const waffe = (e && e.wf) || 'nahkampf';
      dauer('slash', { key: 's' + (++F.b2.seq), x: sx, y: sy, winkel: a }, 0.2);
      // Treffer sichtbar machen, auch wenn das Treffer-Ereignis (mit waffe) fehlt: Ziele im Sektor
      if (F.view) for (const o of meleeTargets(src, a, wcfg(waffe, 'reichweite', 1.3) + 0.3)) meleeHitAt(o, a);
      return true;
    }
    case 'granate': {
      if (ev.tx == null || ev.x == null) return true;
      setAng(ev.id, Math.atan2(ev.ty - ev.y, ev.tx - ev.x));
      dauerStop('grenade_ring', ev.id);
      dauer('grenade_arc', { key: 'g' + ev.id + ':' + ev.tx + ',' + ev.ty, x: ev.x, y: ev.y, tx: ev.tx, ty: ev.ty }, +ev.flug || wcfg('granatwerfer', 'flug', 0.8));
      const src = e || { id: null, x: ev.x, y: ev.y };
      FX2.muzzle('granatwerfer', sockAt(src, 'muzzle', Math.atan2(ev.ty - ev.y, ev.tx - ev.x)), Math.atan2(ev.ty - ev.y, ev.tx - ev.x));
      return true;
    }
    case 'granateEinschlag': {
      if (ev.x == null) return true;
      for (const d of [...F.b2.dauer.values()]) if (d.type === 'grenade_arc' && d.o.tx != null && Math.hypot(d.o.tx - ev.x, d.o.ty - ev.y) < 40) F.b2.dauer.delete(d.key);
      const R = ev.radius != null ? +ev.radius : wcfg('granatwerfer', 'radius', 1.5);
      FX2.grenadeBlast(W(+ev.x, +ev.y, 0), R);
      dauer('stun_cloud', { key: 'c' + (++F.b2.seq), x: +ev.x, y: +ev.y, radius: R }, Math.max(0.8, wcfg('granatwerfer', 'betaeubt', 1.5)));
      return true;
    }
    case 'betaeubt':
      if (ev.waffe && MELEE[ev.waffe] && e) meleeHitAt(e, angleOf(e) + Math.PI);
      if (xy) dauer('stun', { id: ev.id, x: xy.x, y: xy.y }, 2);
      return true;
    case 'bewusstlos':
      if (ev.waffe && MELEE[ev.waffe] && e) meleeHitAt(e, angleOf(e) + Math.PI);
      dauerStop('stun', ev.id);
      if (xy) dauer('unconscious', { id: ev.id, x: xy.x, y: xy.y }, acfgNum('koerper.bewusstlos', 30));
      return true;
    case 'gefesselt':
      dauerStop('unconscious', ev.id);
      if (xy) dauer('bind', { id: ev.id, x: xy.x, y: xy.y, durch: ev.durch }, 600);
      return true;
    case 'befreit': {
      dauerStop('bind', ev.id);
      if (e) FX2.bindRelease(sockAt(e, 'wrists')); else if (xy) FX2.bindRelease(W(xy.x, xy.y, 0.7));
      return true;
    }
    case 'aufgerichtet':
      dauerStop('unconscious', ev.id); dauerStop('bind', ev.id);
      if (xy) FX2.liftComrade(W(xy.x, xy.y, 0));
      return true;
    case 'abgelenkt': {
      if (!e) return false;
      const a = angleOf(e);
      FX2.deflect(W(e.x + Math.cos(a) * 0.6 * TILE, e.y + Math.sin(a) * 0.6 * TILE, 1.0));
      return true;
    }
    default:
      // Treffer-Ereignisse mit waffe (Nachtrag FX): Nahkampftreffer zusätzlich zum Schildeffekt
      if (ev.waffe && MELEE[ev.waffe]) {
        const tgt = e || (ev.pid != null ? entity(ev.pid) : null);
        if (tgt) meleeHitAt(tgt, angleOf(tgt) + Math.PI);
      }
      return false;
  }
}
// F7 (B1-FIX-CLIENT): einmal als Zuhörer anmelden (Net.onEvent), statt Net.onMessage zu überschreiben
function installEventHook() {
  const Net = window.Net;
  if (F.hooked || !Net || typeof Net.onEvent !== 'function') return;
  F.hooked = Net.onEvent('*', (msg) => { try { onEvent(msg); } catch (e) { err('event', e); } });
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
      default: return B2T.includes(type) ? spawnB2(type, o, p) : false;
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
    if (!F.hooked) installEventHook();
    F.frame++; F.time += dt;
    const zone = F.ctx.zone;
    if (zone !== F.lastZone || F.lastDeck !== F.ctx.deck) {
      // Zonen-/Deckwechsel: alte Partikel weg, Stationen neu bestimmen
      for (const P of Object.values(F.pools)) P.live = 0;
      if (zone !== F.lastZone) { F.stations = null; F.prev.proj = new Map(); F.prev.drones = new Map(); F.b2.dauer.clear(); F.b2.ang.clear(); }
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
    try { if (zone !== 'ship') b2Snapshot(view, st, dt); } catch (e) { err('b2snap', e); }
    try { stepDauer(dt, t); } catch (e) { err('dauer', e); }
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

/**
 * B2-Typen über spawnFx (Test/Debug; im Spiel lösen die Ereignisse aus CONTRACT-B2 §8 sie selbst aus).
 * Dauer-Effekte: { id } folgt der Figur, sonst { x, y } fest; { dur } s (Standard je Typ), { k } fester Fortschritt 0–1.
 * Ende: spawnFx.stop(type, id|key) bzw. Zeitablauf / Snapshot-Feld fällt weg.
 */
const DAUER_DEF = { lance_charge: 1.5, grenade_arc: 0.8, grenade_ring: 1.2, stun_cloud: 1.5, stun: 2, heat_vent: 2, overheat: 3, windup: 0.5, unconscious: 6, bind: 4 };
function spawnB2(type, o, p) {
  const base = {};
  for (const k of ['id', 'key', 'tx', 'ty', 'to', 'winkel', 'radius', 'stufe', 'durch', 'waffe', 'k', 'zs', 'cr', 'reach']) if (o[k] != null) base[k] = o[k];
  if (o.x != null) { base.x = +o.x; base.y = +o.y; } else if (o.pos) base.pos = p;
  if (base.id == null && base.key == null) base.key = type + (++F.b2.seq);
  const a = o.winkel != null ? +o.winkel : 0;
  const ent = base.id != null ? entity(base.id) : null;
  const px = ent ? { x: ent.x, y: ent.y } : { x: o.x != null ? +o.x : p[0] * TILE, y: o.y != null ? +o.y : p[2] * TILE };
  switch (type) {
    case 'lance_beam': dauer('lance_beam', Object.assign(base, { x: px.x, y: px.y }), 0.35); return true;
    case 'slash': dauer('slash', Object.assign(base, { x: px.x, y: px.y, winkel: a }), 0.2); return true;
    case 'grenade_blast': {
      const R = o.radius || wcfg('granatwerfer', 'radius', 1.5);
      FX2.grenadeBlast(W(px.x, px.y, 0), R);
      if (o.cloud !== false) dauer('stun_cloud', { key: 'c' + (++F.b2.seq), x: px.x, y: px.y, radius: R }, wcfg('granatwerfer', 'betaeubt', 1.5));
      return true;
    }
    case 'bind_release': FX2.bindRelease(W(px.x, px.y, o.h != null ? o.h : 0.7)); return true;
    case 'melee_hit': FX2.meleeHit(W(px.x, px.y, o.h != null ? o.h : 1.1), a); return true;
    case 'lift_comrade': FX2.liftComrade(W(px.x, px.y, 0)); if (base.tx != null || base.to) dauer('lift_flow', Object.assign({}, base, { key: 'lf' + (++F.b2.seq) }), o.dur || 1); return true;
    case 'deflect': FX2.deflect(W(px.x, px.y, o.h != null ? o.h : 1.0)); return true;
    default:
      if (type.startsWith('muzzle_')) {
        const src = ent || { id: null, x: px.x, y: px.y };
        FX2.muzzle(type.slice(7), o.pos ? p : sockAt(src, 'muzzle', a), a);
        return true;
      }
      if (DAUER_DEF[type] != null) { dauer(type, base, o.dur != null ? +o.dur : DAUER_DEF[type]); return true; }
      return false;
  }
}
function clearAll() { F.b2.dauer.clear(); for (const P of Object.values(F.pools)) P.live = 0; FX._flash.length = 0; }
spawnFx.stop = function (type, idOrKey) { if (type == null) { F.b2.dauer.clear(); return; } dauerStop(type, idOrKey); };
spawnFx.types = B2T.slice();

registerLayer(layer);
window.VoxelFx = { spawnFx, onEvent, clear: clearAll,
  // QA: laufende B2-Dauer-Effekte (Typ, Fortschritt, vom Snapshot gehalten?)
  dauer: () => [...F.b2.dauer.values()].map((d) => ({ type: d.type, key: d.key, k: d.k != null ? Math.round(d.k * 100) / 100 : null, snap: d.snap >= 0, age: Math.round(d.age * 100) / 100 })), stats: () => Object.assign({}, F.stats, { live: { emit: F.pools.emit && F.pools.emit.live, lit: F.pools.lit && F.pools.lit.live, glow: F.pools.glow && F.pools.glow.live } }), shots: F.shots, layer };
export { layer as fxLayer, onEvent };
