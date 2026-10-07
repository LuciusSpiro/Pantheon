// Voxelgitter → Dreiecksnetz (ohne three.js).
// - Nur sichtbare Flächen (Face-Culling)
// - Ambient Occlusion je Ecke, in die Vertexfarben eingebacken
// - Greedy Meshing: benachbarte Flächen gleicher Farbe ohne Verdeckung werden zu einem Rechteck
//   zusammengefasst (Flächen mit AO bleiben einzeln, damit die Schattierung korrekt bleibt)
// - Leuchtende Voxel landen in einem eigenen Netz (ohne Licht/AO)
// Farben kommen als sRGB 0..1 heraus; Positionen in Voxel-Einheiten.
import { key } from './grid.js';

const AO_CURVE = [0.5, 0.68, 0.85, 1.0];
const BOTTOM_SHADE = 0.78;

export function meshGrid(grid, opt = {}) {
  const ao = opt.ao !== false;
  const m = grid.map;
  const solid = (x, y, z) => m.has(key(x, y, z));
  const out = { lit: newBuf(), emit: newBuf() };
  const p = [0, 0, 0];

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, w = (d + 2) % 3;
    for (const s of [1, -1]) {
      // Flächen sammeln: mergeable[sliceKey] = Map(uw → {key,...}); andere direkt ausgeben
      const slices = new Map();
      for (const v of m.values()) {
        p[0] = v.x; p[1] = v.y; p[2] = v.z; p[d] += s;
        if (solid(p[0], p[1], p[2])) continue;
        const pos = [v.x, v.y, v.z];
        const emit = v.e > 0;
        let corners = [3, 3, 3, 3];
        if (ao && !emit) corners = cornerAO(solid, p, u, w);
        const flat = corners[0] === 3 && corners[1] === 3 && corners[2] === 3 && corners[3] === 3;
        if (!flat) { emitQuad(out.lit, d, s, u, w, pos, 1, 1, v.c, corners, 1); continue; }
        const plane = pos[d];
        let sl = slices.get(plane);
        if (!sl) slices.set(plane, (sl = new Map()));
        sl.set(pos[u] * 65536 + pos[w], { u: pos[u], w: pos[w], c: v.c, e: v.e, pos });
      }
      for (const [plane, sl] of slices) greedy(sl, (f, du, dw) => {
        const buf = f.e > 0 ? out.emit : out.lit;
        emitQuad(buf, d, s, u, w, f.pos, du, dw, f.c, [3, 3, 3, 3], f.e > 0 ? f.e : 1);
      });
    }
  }
  return { lit: finish(out.lit), emit: finish(out.emit), voxels: grid.size };
}

function newBuf() { return { p: [], n: [], c: [], i: [] }; }
function finish(b) {
  return { positions: new Float32Array(b.p), normals: new Float32Array(b.n), colors: new Float32Array(b.c), indices: new Uint32Array(b.i), quads: b.i.length / 6 };
}

/** AO der vier Ecken einer Fläche; p = Nachbarzelle vor der Fläche. Reihenfolge: (−u−w)(+u−w)(+u+w)(−u+w) */
function cornerAO(solid, p, u, w) {
  const res = [0, 0, 0, 0], q = [0, 0, 0];
  const du = [-1, 1, 1, -1], dw = [-1, -1, 1, 1];
  for (let k = 0; k < 4; k++) {
    q[0] = p[0]; q[1] = p[1]; q[2] = p[2]; q[u] += du[k]; const s1 = solid(q[0], q[1], q[2]);
    q[u] -= du[k]; q[w] += dw[k]; const s2 = solid(q[0], q[1], q[2]);
    q[u] += du[k]; const sc = solid(q[0], q[1], q[2]);
    res[k] = s1 && s2 ? 0 : 3 - (s1 + s2 + sc);
  }
  return res;
}

/** Fasst gleiche Flächen in einer Ebene zu Rechtecken zusammen. */
function greedy(sl, emit) {
  const K = (u, w) => u * 65536 + w;
  const cells = [...sl.values()].sort((a, b) => a.w - b.w || a.u - b.u);
  const used = new Set();
  const same = (a, b) => b && b.c === a.c && b.e === a.e;
  for (const f of cells) {
    const k0 = K(f.u, f.w);
    if (used.has(k0)) continue;
    let du = 1;
    while (true) { const n = sl.get(K(f.u + du, f.w)); if (!same(f, n) || used.has(K(f.u + du, f.w))) break; du++; }
    let dw = 1;
    grow: while (true) {
      for (let i = 0; i < du; i++) { const kk = K(f.u + i, f.w + dw), n = sl.get(kk); if (!same(f, n) || used.has(kk)) break grow; }
      dw++;
    }
    for (let a = 0; a < du; a++) for (let b = 0; b < dw; b++) used.add(K(f.u + a, f.w + b));
    emit(f, du, dw);
  }
}

function emitQuad(B, d, s, u, w, pos, du, dw, color, corners, gain) {
  const base = B.p.length / 3;
  const r = ((color >> 16) & 255) / 255, g = ((color >> 8) & 255) / 255, b = (color & 255) / 255;
  const cu = [0, 1, 1, 0], cw = [0, 0, 1, 1];
  const bottom = d === 1 && s < 0 ? BOTTOM_SHADE : 1;
  for (let k = 0; k < 4; k++) {
    const v = [pos[0], pos[1], pos[2]];
    if (s > 0) v[d] += 1;
    v[u] += cu[k] * du; v[w] += cw[k] * dw;
    B.p.push(v[0], v[1], v[2]);
    B.n.push(d === 0 ? s : 0, d === 1 ? s : 0, d === 2 ? s : 0);
    const a = gain === 1 ? AO_CURVE[corners[k]] * bottom : gain;
    B.c.push(r * a, g * a, b * a);
  }
  // Diagonale so wählen, dass AO nicht anisotrop wirkt
  let t = corners[0] + corners[2] < corners[1] + corners[3] ? [1, 2, 3, 1, 3, 0] : [0, 1, 2, 0, 2, 3];
  if (s < 0) t = [t[0], t[2], t[1], t[3], t[5], t[4]];
  for (const ti of t) B.i.push(base + ti);
}
