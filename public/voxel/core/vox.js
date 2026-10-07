// MagicaVoxel .vox lesen und schreiben (nur ein Modell pro Datei, Version 150/200).
// Lesen:  parseVox(ArrayBuffer) → { size:[x,y,z], voxels:[{x,y,z,i}], palette: [0xRRGGBB × 256, Index 1..255] }
// Schreiben: gridToVox(grid) → Uint8Array (Z-oben wie MagicaVoxel: unser y → z)

const DEFAULT_PALETTE_SEED = 0x9E3779B1;

export function parseVox(buf) {
  const dv = new DataView(buf); let o = 0;
  const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(dv.getUint8(o + i)); o += n; return s; };
  const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v; };
  if (str(4) !== 'VOX ') throw new Error('Keine .vox-Datei');
  u32(); // Version
  let size = null, voxels = null, palette = null;
  const end = buf.byteLength;
  while (o < end) {
    const id = str(4), content = u32(), children = u32(), start = o;
    if (id === 'MAIN') { continue; }
    if (id === 'SIZE' && !size) size = [u32(), u32(), u32()];
    else if (id === 'XYZI' && !voxels) {
      const n = u32(); voxels = new Array(n);
      for (let k = 0; k < n; k++) { voxels[k] = { x: dv.getUint8(o), y: dv.getUint8(o + 1), z: dv.getUint8(o + 2), i: dv.getUint8(o + 3) }; o += 4; }
    } else if (id === 'RGBA') {
      palette = new Array(256).fill(0);
      for (let k = 0; k < 255; k++) palette[k + 1] = (dv.getUint8(o + k * 4) << 16) | (dv.getUint8(o + k * 4 + 1) << 8) | dv.getUint8(o + k * 4 + 2);
    }
    o = start + content + children;   // Unterchunks anderer Typen (z. B. nTRN) überspringen
  }
  if (!size || !voxels) throw new Error('.vox ohne SIZE/XYZI');
  if (!palette) { palette = new Array(256).fill(0); for (let k = 1; k < 256; k++) palette[k] = (Math.imul(k, DEFAULT_PALETTE_SEED) >>> 8) & 0xffffff; }
  return { size, voxels, palette };
}

/** Gitter → .vox. Farben werden auf höchstens 255 Paletteneinträge abgebildet (häufigste zuerst). */
export function gridToVox(grid) {
  const b = grid.bounds(), vals = [...grid.values()];
  const counts = new Map();
  for (const v of vals) counts.set(v.c, (counts.get(v.c) || 0) + 1);
  const colors = [...counts.entries()].sort((a, c) => c[1] - a[1]).map((e) => e[0]);
  const pal = colors.slice(0, 255);
  const nearest = new Map();
  const idxOf = (c) => {
    let i = pal.indexOf(c); if (i >= 0) return i + 1;
    if (nearest.has(c)) return nearest.get(c);
    let best = 0, bd = Infinity;
    pal.forEach((p, k) => { const d = (((p >> 16) & 255) - ((c >> 16) & 255)) ** 2 + (((p >> 8) & 255) - ((c >> 8) & 255)) ** 2 + ((p & 255) - (c & 255)) ** 2; if (d < bd) { bd = d; best = k; } });
    nearest.set(c, best + 1); return best + 1;
  };
  const sx = b.max[0] - b.min[0] + 1, sy = b.max[1] - b.min[1] + 1, sz = b.max[2] - b.min[2] + 1;
  if (sx > 256 || sy > 256 || sz > 256) throw new Error(`.vox erlaubt höchstens 256³ (Modell ${sx}×${sy}×${sz})`);
  const n = vals.length;
  const sizeLen = 12, xyziLen = 4 + n * 4, rgbaLen = 1024;
  const mainChildren = 12 + sizeLen + 12 + xyziLen + 12 + rgbaLen;
  const out = new Uint8Array(8 + 12 + mainChildren); const dv = new DataView(out.buffer); let o = 0;
  const s = (t) => { for (const ch of t) out[o++] = ch.charCodeAt(0); };
  const u = (v) => { dv.setUint32(o, v, true); o += 4; };
  s('VOX '); u(150);
  s('MAIN'); u(0); u(mainChildren);
  s('SIZE'); u(sizeLen); u(0); u(sx); u(sz); u(sy);
  s('XYZI'); u(xyziLen); u(0); u(n);
  for (const v of vals) { out[o++] = v.x - b.min[0]; out[o++] = v.z - b.min[2]; out[o++] = v.y - b.min[1]; out[o++] = idxOf(v.c); }
  s('RGBA'); u(rgbaLen); u(0);
  for (let k = 0; k < 256; k++) { const c = pal[k] ?? 0; out[o++] = (c >> 16) & 255; out[o++] = (c >> 8) & 255; out[o++] = c & 255; out[o++] = 255; }
  return out;
}
