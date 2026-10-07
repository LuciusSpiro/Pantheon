// Terrain: Stufe "terrain" (1 Voxel = 1 m). Beschrieben als Zeichenkarte wie die ASCII-Karten des Spiels.
//
// "terrain": {
//   "palette": "natur",                 // optional, sonst Szenen-Palette
//   "depth": 3,                         // Voxel unter y=0 (sichtbar an den Kartenrändern)
//   "legend": { ".": { "h": 1, "top": "grass", "sub": "soil", "fill": "rock" }, ... },
//   "rows": ["....##..", ...],          // Zeile = z, Spalte = x
//   "heights": ["11112211", ...]        // optional: Höhe je Zelle (0–9, a–z = 10–35) statt legend.h
// }
// Die Oberkante einer Zelle liegt bei y = h (Meter). Dort stehen Objekte.
import { VoxelGrid } from './grid.js';
import { compileColor, hash3, scale as scaleColor } from './color.js';
import { DEFAULT_JITTER } from './recipe.js';

export function terrainInfo(t) {
  const rows = t.rows || [], D = rows.length, W = D ? rows[0].length : 0;
  rows.forEach((r, z) => { if (r.length !== W) throw new Error(`terrain.rows[${z}] hat Länge ${r.length}, erwartet ${W}`); });
  const cellAt = (x, z) => {
    if (x < 0 || z < 0 || x >= W || z >= D) return null;
    const ch = rows[z][x], L = t.legend[ch];
    if (!L) throw new Error(`terrain: Zeichen "${ch}" (x=${x}, z=${z}) fehlt in legend`);
    let h = L.h ?? 1;
    if (t.heights) { const c = t.heights[z]?.[x]; if (c && c !== '.') h = parseInt(c, 36); }
    return { ch, L, h };
  };
  const height = (x, z) => { const c = cellAt(Math.floor(x), Math.floor(z)); return c ? c.h : 0; };
  return { W, D, cellAt, height };
}

export function buildTerrain(t, palette, seed = 0) {
  const info = terrainInfo(t), g = new VoxelGrid(), depth = t.depth ?? 2;
  const fns = new Map();
  const fn = (spec) => { const k = JSON.stringify(spec); if (!fns.has(k)) fns.set(k, compileColor(spec, palette)); return fns.get(k); };
  const jit = t.jitter ?? DEFAULT_JITTER.terrain;
  for (let z = 0; z < info.D; z++) for (let x = 0; x < info.W; x++) {
    const { L, h } = info.cellAt(x, z);
    for (let y = -depth; y < h; y++) {
      const role = y === h - 1 ? (L.top ?? 'grass') : y === h - 2 ? (L.sub ?? L.fill ?? 'soil') : (L.fill ?? 'soil');
      const k = { x, y, z, lx: x, ly: y + depth, lz: z, size: [info.W, h + depth, info.D], seed };
      const v = fn(role)(k);
      const q = Math.floor(hash3(x, y, z, seed + 3) * 5);
      g.set(x, y, z, v.e ? v.c : scaleColor(v.c, 1 + (q - 2) * jit * 0.5), v.e);
    }
  }
  return { grid: g, info };
}
