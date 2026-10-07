// Farben: Paletten mit Rollen + Farbangaben in Rezepten.
//
// Palette (assets/palettes/<id>.json):
//   { "id": "rom", "extends": "base", "roles": { "primary": "#A8262B", "glow": { "color": "#9FE8FF", "emit": 1.5 } } }
//
// Farbangabe in einem Rezept (Feld "color"):
//   "primary"                         Rolle aus der Palette
//   "#C0FFEE"                         feste Farbe
//   { "role": "glow", "emit": 2 }     Rolle mit Leuchten (überschreibt das Leuchten der Rolle)
//   { "noise": ["stone","stone_dark"], "weights": [3,1] }        zufällig je Voxel (stabil per Seed)
//   { "stripes": ["a","b"], "axis": "y", "period": 2 }           Bänder entlang einer Achse
//   { "checker": ["a","b"], "period": 1 }                         Schachbrett
//   { "gradient": ["a","b"], "axis": "y" }                        Verlauf über die Form
//   { "frame": "trim", "fill": "primary", "axes": "xy", "width": 1 }  Rand der Form in eigener Farbe
//   { "shade": "primary", "f": 0.8 }                               Rolle abgedunkelt (<1) oder aufgehellt (>1)
// Jede Unterangabe darf wieder eine Farbangabe sein (verschachtelbar).

export function hexToInt(s) {
  const m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (!m) throw new Error(`Ungültige Farbe "${s}"`);
  return parseInt(m[1], 16);
}

export function mix(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}
export const shade = (c, f) => (f < 1 ? mix(c, 0x000000, 1 - f) : mix(c, 0xffffff, Math.min(1, f - 1)));
export const scale = (c, f) => {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f)), g = Math.min(255, Math.round(((c >> 8) & 255) * f)), b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
};

export function hash3(x, y, z, seed = 0) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683) + Math.imul(seed, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Palette-Objekt mit aufgelöster Vererbung → { roles: { name: {c, e} } } */
export function resolvePalette(id, getPalette, overrides) {
  const chain = []; let cur = id; const seen = new Set();
  while (cur) {
    if (seen.has(cur)) throw new Error(`Paletten-Zyklus bei "${cur}"`);
    seen.add(cur);
    const p = getPalette(cur);
    if (!p) throw new Error(`Palette "${cur}" nicht gefunden`);
    chain.unshift(p); cur = p.extends;
  }
  const roles = {};
  const put = (name, v) => {
    if (typeof v === 'string') {
      // Verweis auf eine andere Rolle oder Hexwert
      if (v.startsWith('#')) roles[name] = { c: hexToInt(v), e: 0 };
      else if (roles[v]) roles[name] = { ...roles[v] };
      else throw new Error(`Palette: Rolle "${name}" verweist auf unbekannte Rolle "${v}"`);
    } else roles[name] = { c: hexToInt(v.color), e: v.emit || 0 };
  };
  for (const p of chain) for (const [name, v] of Object.entries(p.roles || {})) put(name, v);
  for (const [name, v] of Object.entries(overrides || {})) put(name, v);
  return { id, roles, overrides: overrides || {} };
}

/**
 * Übersetzt eine Farbangabe in eine Funktion (ctx) → {c, e}.
 * ctx: { x,y,z (Gitter), lx,ly,lz (lokal in der Form), size:[w,h,d], seed }
 */
export function compileColor(spec, palette, defaultEmit = 0) {
  if (spec == null) throw new Error('Farbangabe fehlt');
  if (typeof spec === 'string') {
    let v;
    if (spec.startsWith('#')) v = { c: hexToInt(spec), e: 0 };
    else {
      v = palette.roles[spec];
      if (!v) throw new Error(`Unbekannte Farbrolle "${spec}" (Palette ${palette.id})`);
    }
    const out = { c: v.c, e: defaultEmit || v.e };
    return () => out;
  }
  if (typeof spec !== 'object') throw new Error(`Ungültige Farbangabe ${JSON.stringify(spec)}`);
  const emit = spec.emit ?? defaultEmit;
  const sub = (s) => compileColor(s, palette, emit);
  const axisIdx = (a) => ({ x: 0, y: 1, z: 2 })[a ?? 'y'];

  if (spec.role) return sub(spec.role);
  if (spec.shade) {
    const base = sub(spec.shade), f = spec.f ?? 0.8;
    return (k) => { const v = base(k); return { c: shade(v.c, f), e: v.e }; };
  }
  if (spec.noise) {
    const opts = spec.noise.map(sub), w = spec.weights || spec.noise.map(() => 1);
    const tot = w.reduce((a, b) => a + b, 0), salt = spec.seed ?? 0, cell = spec.cell ?? 1;
    return (k) => {
      let r = hash3(Math.floor(k.x / cell), Math.floor(k.y / cell), Math.floor(k.z / cell), k.seed + salt) * tot;
      for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r < 0) return opts[i](k); }
      return opts[opts.length - 1](k);
    };
  }
  if (spec.stripes) {
    const opts = spec.stripes.map(sub), a = axisIdx(spec.axis), per = spec.period ?? 1, off = spec.offset ?? 0;
    return (k) => {
      const p = [k.lx, k.ly, k.lz][a] + off;
      return opts[((Math.floor(p / per) % opts.length) + opts.length) % opts.length](k);
    };
  }
  if (spec.checker) {
    const opts = spec.checker.map(sub), per = spec.period ?? 1;
    return (k) => opts[((Math.floor(k.lx / per) + Math.floor(k.ly / per) + Math.floor(k.lz / per)) % 2 + 2) % 2](k);
  }
  if (spec.gradient) {
    const a = sub(spec.gradient[0]), b = sub(spec.gradient[1]), ax = axisIdx(spec.axis);
    return (k) => {
      const n = Math.max(1, k.size[ax] - 1), t = Math.min(1, Math.max(0, [k.lx, k.ly, k.lz][ax] / n));
      const va = a(k), vb = b(k);
      return { c: mix(va.c, vb.c, t), e: va.e + (vb.e - va.e) * t };
    };
  }
  if (spec.frame) {
    const fr = sub(spec.frame), fill = sub(spec.fill), w = spec.width ?? 1;
    const axes = [...(spec.axes ?? 'xyz')].map(axisIdx);
    return (k) => {
      const l = [k.lx, k.ly, k.lz];
      for (const ax of axes) if (l[ax] < w || l[ax] >= k.size[ax] - w) return fr(k);
      return fill(k);
    };
  }
  throw new Error(`Unbekannte Farbangabe ${JSON.stringify(spec)}`);
}
