// Dünn besetztes Voxelgitter. Ein Voxel trägt eine Farbe (0xRRGGBB) und optional
// eine Leuchtstärke (emit > 0 → leuchtet, wird ohne Licht/AO gerendert).
const OFF = 1024, SPAN = 2048;
export const key = (x, y, z) => ((x + OFF) * SPAN + (y + OFF)) * SPAN + (z + OFF);

export class VoxelGrid {
  constructor() { this.map = new Map(); }

  set(x, y, z, color, emit = 0) {
    x = Math.round(x); y = Math.round(y); z = Math.round(z);
    this.map.set(key(x, y, z), { x, y, z, c: color, e: emit });
  }
  get(x, y, z) { return this.map.get(key(Math.round(x), Math.round(y), Math.round(z))); }
  has(x, y, z) { return this.map.has(key(Math.round(x), Math.round(y), Math.round(z))); }
  delete(x, y, z) { this.map.delete(key(Math.round(x), Math.round(y), Math.round(z))); }
  get size() { return this.map.size; }
  values() { return this.map.values(); }

  bounds() {
    if (!this.map.size) return { min: [0, 0, 0], max: [0, 0, 0] };
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const v of this.map.values()) {
      if (v.x < min[0]) min[0] = v.x; if (v.y < min[1]) min[1] = v.y; if (v.z < min[2]) min[2] = v.z;
      if (v.x > max[0]) max[0] = v.x; if (v.y > max[1]) max[1] = v.y; if (v.z > max[2]) max[2] = v.z;
    }
    return { min, max };   // inklusiv
  }

  /** Kopie, verschoben um (dx,dy,dz). */
  shifted(dx, dy, dz) {
    const g = new VoxelGrid();
    for (const v of this.map.values()) g.set(v.x + dx, v.y + dy, v.z + dz, v.c, v.e);
    return g;
  }
}
