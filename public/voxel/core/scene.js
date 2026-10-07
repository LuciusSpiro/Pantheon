// Szene → flache Liste (ohne three.js): Terrain + Platzierungen + Figuren.
// Positionen in Metern, Drehung in Grad um die Hochachse. Genaues Format: AUTHORING.md.
import { terrainInfo } from './terrain.js';
import { hash3 } from './color.js';

/**
 * @returns { placements:[{model, params, palette, colors, pos:[x,y,z], rot, tier}], figures:[...], info }
 */
export function resolveScene(scene, lib) {
  const info = scene.terrain ? terrainInfo(scene.terrain) : { W: 0, D: 0, height: () => 0, cellAt: () => null };
  const groundY = (x, z) => info.height(x, z);
  const placements = [];

  const addPlacement = (pl, x, z, extra = {}) => {
    const model = lib.get('models', pl.model);
    if (!model) throw new Error(`Szene: Modell "${pl.model}" nicht geladen`);
    // Höhe: absolut über "y", sonst Oberkante des Terrains + "lift"
    const y = pl.y !== undefined ? pl.y : groundY(x, z) + (pl.lift ?? 0);
    placements.push({
      model: pl.model, params: { ...(pl.params || {}), ...(extra.params || {}) }, palette: pl.palette || scene.palette,
      colors: pl.colors, pos: [x, y, z], rot: (pl.rot ?? 0) + (extra.rot ?? 0), tier: model.tier, footprint: model.footprint,
    });
  };

  for (const pl of scene.place || []) {
    const at = pl.at || [0, 0];   // [x, z] in Metern
    const x0 = at[0], z0 = at[1];
    const n = pl.row?.count ?? 1, st = pl.row?.step ?? [0, 0];
    for (let i = 0; i < n; i++) {
      const params = pl.row?.vary ? { seed: (pl.params?.seed ?? 0) + i } : {};
      addPlacement(pl, x0 + st[0] * i, z0 + st[1] * i, { params });
    }
  }

  // Streuung: Kleinkram (Gras, Steine, Blumen) zufällig, aber stabil per Seed
  const blocked = (x, z, pad) => placements.some((p) => {
    if (!p.footprint) return false;
    const r = ((p.rot % 180) + 180) % 180 === 90;
    const w = (r ? p.footprint[1] : p.footprint[0]) / 2 + pad, d = (r ? p.footprint[0] : p.footprint[1]) / 2 + pad;
    return Math.abs(x - p.pos[0]) < w && Math.abs(z - p.pos[2]) < d;
  });
  (scene.scatter || []).forEach((sc, si) => {
    const models = [].concat(sc.model), on = sc.on ? new Set(sc.on) : null, seed = (sc.seed ?? 0) + si * 101;
    const area = sc.area || [0, 0, info.W, info.D];   // [x0, z0, x1, z1] in Metern
    const per = sc.perCell ?? 1;
    for (let z = Math.floor(area[1]); z < area[3]; z++) for (let x = Math.floor(area[0]); x < area[2]; x++) {
      const cell = info.cellAt(x, z);
      if (on && (!cell || !on.has(cell.ch))) continue;
      for (let k = 0; k < per; k++) {
        if (hash3(x, z, k, seed) > (sc.density ?? 0.2)) continue;
        const px = x + 0.15 + hash3(x, z, k, seed + 1) * 0.7, pz = z + 0.15 + hash3(x, z, k, seed + 2) * 0.7;
        if (blocked(px, pz, sc.pad ?? 0.2)) continue;
        const m = models[Math.floor(hash3(x, z, k, seed + 3) * models.length)];
        const rot = Math.floor(hash3(x, z, k, seed + 4) * 4) * 90;
        const variant = Math.floor(hash3(x, z, k, seed + 5) * (sc.variants ?? 4));
        addPlacement({ model: m, palette: sc.palette, params: sc.params }, px, pz, { rot, params: { seed: variant } });
      }
    }
  });

  const figures = (scene.figures || []).map((f) => {
    const x = f.at[0], z = f.at[1];
    return { ...f, pos: [x, f.y !== undefined ? f.y : groundY(x, z) + (f.lift ?? 0), z], rot: f.rot ?? 0 };
  });
  return { placements, figures, info };
}
