// Rezept → Voxelgitter.
// Ein Modell ist eine JSON-Datei mit Stufe, Palette, Parametern und einer Liste von Bauschritten (ops).
// Das genaue Format steht in AUTHORING.md. Diese Datei hat keine Abhängigkeit zu three.js.
import { VoxelGrid } from './grid.js';
import { evalNum, evalVec } from './expr.js';
import { compileColor, hash3, scale as scaleColor } from './color.js';
import { tierOf } from './scales.js';

export const DEFAULT_JITTER = { terrain: 0.07, architecture: 0.05, detail: 0.035 };
const AX = { x: 0, y: 1, z: 2 };

// ---------------------------------------------------------------------------------------------
// Transformationen arbeiten auf Voxel-Mittelpunkten: p' = M·p + t, Voxel = floor(p').
// ---------------------------------------------------------------------------------------------
const IDENTITY = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
function apply(T, p) {
  const m = T.m;
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + T.t[0],
    m[3] * p[0] + m[4] * p[1] + m[5] * p[2] + T.t[1],
    m[6] * p[0] + m[7] * p[1] + m[8] * p[2] + T.t[2],
  ];
}
/** A∘B (erst B, dann A) */
function compose(A, B) {
  const a = A.m, b = B.m, m = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return { m, t: apply(A, B.t) };
}
const translate = (x, y, z) => ({ m: IDENTITY.m, t: [x, y, z] });
function rotY(deg, px = 0, pz = 0) {
  const r = ((Math.round(deg / 90) % 4) + 4) % 4;
  if (deg % 90 !== 0) throw new Error(`rot muss ein Vielfaches von 90 sein (bekommen ${deg})`);
  const c = [1, 0, -1, 0][r], s = [0, 1, 0, -1][r];
  // gegen den Uhrzeigersinn von oben gesehen: x' = x·c + z·s, z' = −x·s + z·c (um den Drehpunkt)
  const R = { m: [c, 0, s, 0, 1, 0, -s, 0, c], t: [0, 0, 0] };
  return compose(translate(px, 0, pz), compose(R, translate(-px, 0, -pz)));
}
function mirror(axis, plane) {
  const i = AX[axis]; const m = [1, 0, 0, 0, 1, 0, 0, 0, 1]; m[i * 4] = -1;
  const t = [0, 0, 0]; t[i] = 2 * plane;
  return { m, t };
}

// ---------------------------------------------------------------------------------------------
// Bauen
// ---------------------------------------------------------------------------------------------
/**
 * @param model  Modell-Objekt (geparstes JSON)
 * @param params Parameterwerte (überschreiben die Defaults)
 * @param env    { getModel(id), getVox(path), palette (aufgelöst), resolvePalette(id, overrides) }
 * @returns { grid, anchor:[x,y,z], tier }
 */
export function buildModel(model, params = {}, env, depth = 0) {
  if (depth > 12) throw new Error(`Modell "${model.id}": Teilmodelle zu tief verschachtelt (Zyklus?)`);
  const tier = model.tier; tierOf(tier);
  const scope = paramScope(model, params);
  const palette = env.palette;
  const ctx = {
    model, env, palette, depth, tier,
    grid: new VoxelGrid(),
    jitter: model.jitter ?? DEFAULT_JITTER[tier],
    seed: scope.seed | 0,
  };
  runOps(model.ops || [], scope, IDENTITY, ctx, 'ops');
  let anchor;
  if (model.anchor) anchor = evalVec(model.anchor, scope);
  else {
    const b = ctx.grid.bounds();
    anchor = [(b.min[0] + b.max[0] + 1) / 2, b.min[1], (b.min[2] + b.max[2] + 1) / 2];
  }
  return { grid: ctx.grid, anchor, tier };
}

/** Defaults + übergebene Werte + abgeleitete Werte (let). */
export function paramScope(model, params) {
  const scope = { seed: 0 };
  for (const [k, def] of Object.entries(model.params || {})) scope[k] = def.default;
  for (const [k, v] of Object.entries(params || {})) {
    if (!(k in scope) && k !== 'seed') throw new Error(`Modell "${model.id}": unbekannter Parameter "${k}"`);
    scope[k] = v;
  }
  for (const [k, def] of Object.entries(model.params || {})) {
    if (def.options && !def.options.includes(scope[k])) throw new Error(`Modell "${model.id}": "${k}" muss einer von ${def.options.join(', ')} sein`);
  }
  for (const [k, e] of Object.entries(model.let || {})) scope[k] = evalNum(e, scope);
  return scope;
}

function runOps(ops, scope, T, ctx, path) {
  ops.forEach((op, i) => {
    const where = `${ctx.model.id} › ${path}[${i}]${op.op ? ' ' + op.op : ''}${op.name ? ' "' + op.name + '"' : ''}`;
    try {
      runOp(op, scope, T, ctx, `${path}[${i}]`);
    } catch (e) {
      if (!e.voxelwerkPath) { e.message = `${where}: ${e.message}`; e.voxelwerkPath = true; }
      throw e;
    }
  });
}

function runOp(op, scope, T, ctx, path) {
  // "if" erst nach dem Aufklappen von "repeat" auswerten, damit die Schleifenvariable verfügbar ist
  if (op.if !== undefined && !op.repeat && !evalNum(op.if, scope)) return;
  if (op.repeat) {
    const n = evalNum(op.repeat.count, scope), step = evalVec(op.repeat.step || [0, 0, 0], scope), v = op.repeat.var || 'i';
    const { repeat, ...single } = op;
    for (let k = 0; k < n; k++) {
      const s = { ...scope, [v]: k };
      runOp(single, s, compose(T, translate(step[0] * k, step[1] * k, step[2] * k)), ctx, path);
    }
    return;
  }
  if (op.mirror) {
    // Original + Spiegelkopie (im Koordinatensystem des aktuellen Elternteils)
    const { mirror: axes, mirrorAt, ...single } = op;
    const planes = typeof mirrorAt === 'object' && mirrorAt !== null ? mirrorAt : { x: mirrorAt, z: mirrorAt, y: mirrorAt };
    let variants = [IDENTITY];
    for (const a of axes) {
      const p = planes[a];
      if (p === undefined) throw new Error(`mirror "${a}" braucht mirrorAt`);
      const M = mirror(a, evalNum(p, scope));
      variants = variants.concat(variants.map((V) => compose(M, V)));
    }
    for (const V of variants) runOp(single, scope, compose(T, V), ctx, path);
    return;
  }
  const s = op.let ? withLet(scope, op.let) : scope;
  switch (op.op) {
    case 'group': return opGroup(op, s, T, ctx, path);
    case 'use': return opUse(op, s, T, ctx);
    case 'vox': return opVox(op, s, T, ctx);
    case 'box': return shapeBox(op, s, T, ctx);
    case 'cyl': return shapeCyl(op, s, T, ctx);
    case 'ellipsoid': return shapeEllipsoid(op, s, T, ctx);
    case 'line': return shapeLine(op, s, T, ctx);
    case 'wedge': return shapeWedge(op, s, T, ctx);
    case 'loft': return shapeLoft(op, s, T, ctx);
    case 'erode': return opErode(op, s, T, ctx);
    default: throw new Error(`Unbekannter Bauschritt "${op.op}"`);
  }
}

function withLet(scope, lets) {
  const s = { ...scope };
  for (const [k, e] of Object.entries(lets)) s[k] = evalNum(e, s);
  return s;
}

/** Transformation eines Schritts: at (Verschiebung) und rot (um pivot, lokal). */
function localT(op, scope, T) {
  let L = IDENTITY;
  if (op.rot) {
    const pv = op.pivot ? evalVec(op.pivot, scope) : [0, 0];
    L = rotY(evalNum(op.rot, scope), pv[0], pv[1]);
  }
  if (op.at && (op.op === 'group' || op.op === 'use' || op.op === 'vox')) {
    const a = evalVec(op.at, scope); L = compose(translate(a[0], a[1], a[2]), L);
  }
  return compose(T, L);
}

function opGroup(op, scope, T, ctx, path) {
  runOps(op.ops || [], scope, localT(op, scope, T), ctx, `${path}.ops`);
}

function opUse(op, scope, T, ctx) {
  const tmpl = isTemplateUse(op);
  const sub = tmpl ? resolveTemplateUse(op, scope, ctx.env) : ctx.env.getModel(op.model);
  if (!sub) throw new Error(`Teilmodell "${op.model}" nicht geladen`);
  if (sub.tier !== ctx.tier) throw new Error(`Teilmodell "${sub.id}" hat Stufe ${sub.tier}, erwartet ${ctx.tier} (Stufen nicht mischen – Szene benutzen)`);
  const params = {};
  for (const [k, v] of Object.entries(op.params || {})) {
    // Vorlagen: nur Parameter weitergeben, die das gewählte Modell kennt (Steckplätze dürfen weniger deklarieren)
    if (tmpl && k !== 'seed' && !(k in (sub.params || {}))) continue;
    if (typeof v !== 'string') params[k] = v;
    else if (sub.params?.[k]?.options) params[k] = fillTemplate(v, scope, op.model);   // "{art}" reicht den eigenen Wert durch
    else params[k] = evalNum(v, scope);
  }
  if (params.seed === undefined) params.seed = ctx.seed;
  // Farbüberschreibungen des Elternteils (z. B. Crew-Akzent der Figur) bleiben erhalten
  const env = op.palette || op.colors
    ? { ...ctx.env, palette: ctx.env.resolvePalette(op.palette || ctx.palette.id, { ...(ctx.palette.overrides || {}), ...(op.colors || {}) }) }
    : ctx.env;
  const built = buildModel(sub, params, env, ctx.depth + 1);
  const Tt = compose(localT(op, scope, T), translate(-built.anchor[0], -built.anchor[1], -built.anchor[2]));
  const mode = op.mode || 'add';
  for (const v of built.grid.values()) write(ctx, Tt, v.x, v.y, v.z, mode, () => ({ c: v.c, e: v.e }), null, false);
}

// ---------------------------------------------------------------------------------------------
// Vorlagen in use: "model": "kit/{bauweise}/{art}/fuellung", optional "fallback": "<id>" | ["<id>", …]
// Platzhalter = options-Parameter des Modells, das den Schritt enthält. collectDeps lädt alle Kombinationen
// (fehlende Dateien sind erlaubt); beim Bauen gewinnt der erste vorhandene Kandidat.
// ---------------------------------------------------------------------------------------------
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const MAX_TEMPLATE_COMBOS = 1024;
const hasPlaceholder = (s) => typeof s === 'string' && /\{[A-Za-z_][A-Za-z0-9_]*\}/.test(s);
const useCandidates = (op) => [op.model, ...[].concat(op.fallback ?? [])];
/** Ein use ist eine Vorlage, wenn Modell oder Fallback Platzhalter enthält oder ein Fallback angegeben ist. */
export const isTemplateUse = (op) => op.fallback !== undefined || hasPlaceholder(op.model);
const placeholderNames = (cands) => [...new Set(cands.flatMap((c) => [...c.matchAll(PLACEHOLDER)].map((m) => m[1])))];

function fillTemplate(t, values, where) {
  return t.replace(PLACEHOLDER, (_, n) => {
    const v = values[n];
    if (v === undefined) throw new Error(`Vorlage "${where}": Platzhalter {${n}} hat keinen Wert`);
    return String(v);
  });
}

function resolveTemplateUse(op, scope, env) {
  const cands = useCandidates(op), ids = cands.map((c) => fillTemplate(c, scope, op.model));
  for (const id of ids) { const m = env.getModel(id); if (m) return m; }
  const names = placeholderNames(cands);
  const vals = names.length ? ' mit ' + names.map((n) => `${n}=${scope[n]}`).join(', ') : '';
  throw new Error(`Vorlage "${op.model}"${vals}: kein Modell vorhanden (versucht: ${ids.join(', ')})`);
}

/** Alle Kombinationen einer Vorlage: [{ values: {name: wert}, ids: [Kandidat, Fallback …] }]. */
export function expandTemplateUse(model, op) {
  const cands = useCandidates(op), names = placeholderNames(cands);
  for (const n of names) {
    if (!model.params?.[n]?.options) throw new Error(`Modell "${model.id}": Vorlage "${op.model}": Platzhalter {${n}} muss ein Parameter mit "options" sein`);
  }
  let combos = [{}];
  for (const n of names) combos = combos.flatMap((c) => model.params[n].options.map((o) => ({ ...c, [n]: o })));
  if (combos.length > MAX_TEMPLATE_COMBOS) throw new Error(`Modell "${model.id}": Vorlage "${op.model}" ergibt ${combos.length} Kombinationen (höchstens ${MAX_TEMPLATE_COMBOS})`);
  return combos.map((values) => ({ values, ids: cands.map((c) => fillTemplate(c, values, op.model)) }));
}

function opVox(op, scope, T, ctx) {
  const vox = ctx.env.getVox(op.file);
  if (!vox) throw new Error(`.vox-Datei "${op.file}" nicht geladen`);
  const Tt = localT(op, scope, T), remap = {};
  for (const [idx, spec] of Object.entries(op.remap || {})) remap[idx] = compileColor(spec, ctx.palette, undefined, scope);
  const mode = op.mode || 'add';
  // MagicaVoxel ist Z-oben → bei uns Y-oben: (x, y, z)vox → (x, z, y)
  for (const v of vox.voxels) {
    const f = remap[v.i] || (() => ({ c: vox.palette[v.i], e: 0 }));
    write(ctx, Tt, v.x, v.z, v.y, mode, f, null, !!op.jitter);
  }
}

// ---------------------------------------------------------------------------------------------
// Formen
// ---------------------------------------------------------------------------------------------
function colorFn(op, ctx, scope) {
  if (op.mode === 'carve') return null;
  // emit darf ein Ausdruck sein ("0.3 + heat * 0.5"); gesetztes emit gilt auch bei 0, fehlendes = Leuchten der Rolle
  const emit = op.emit !== undefined ? evalNum(op.emit, scope) : undefined;
  return compileColor(op.color ?? 'primary', ctx.palette, emit, scope);
}

/**
 * Schreibt einen Voxel. (x,y,z) sind lokale Ganzzahl-Koordinaten der Form; der Mittelpunkt wird
 * transformiert. local = { lx,ly,lz,size } für Muster.
 */
function write(ctx, T, x, y, z, mode, col, local, jitter = true) {
  const p = apply(T, [x + 0.5, y + 0.5, z + 0.5]);
  const gx = Math.floor(p[0] + 1e-6), gy = Math.floor(p[1] + 1e-6), gz = Math.floor(p[2] + 1e-6);
  const g = ctx.grid;
  if (mode === 'carve') { g.delete(gx, gy, gz); return; }
  if (mode === 'paint' && !g.has(gx, gy, gz)) return;
  if (mode === 'under' && g.has(gx, gy, gz)) return;
  const k = local ? { x: gx, y: gy, z: gz, lx: local[0], ly: local[1], lz: local[2], size: local[3], seed: ctx.seed } : { x: gx, y: gy, z: gz, lx: x, ly: y, lz: z, size: [1, 1, 1], seed: ctx.seed };
  const v = col(k);
  let c = v.c;
  if (jitter && !v.e && ctx.jitter > 0) {
    const q = Math.floor(hash3(gx, gy, gz, ctx.seed + 7) * 5);   // 5 Stufen → gleiche Nachbarn lassen sich zusammenfassen
    c = scaleColor(c, 1 + (q - 2) * ctx.jitter * 0.5);
  }
  g.set(gx, gy, gz, c, v.e);
}

function shapeBox(op, scope, T, ctx) {
  const at = evalVec(op.at || [0, 0, 0], scope), size = evalVec(op.size, scope).map(Math.round);
  const Tl = localT(op, scope, T), col = colorFn(op, ctx, scope), mode = op.mode || 'add';
  const [x0, y0, z0] = at.map(Math.round), jit = op.jitter !== false;
  for (let x = 0; x < size[0]; x++) for (let y = 0; y < size[1]; y++) for (let z = 0; z < size[2]; z++)
    write(ctx, Tl, x0 + x, y0 + y, z0 + z, mode, col, [x, y, z, size], jit);
}

function shapeCyl(op, scope, T, ctx) {
  const axis = op.axis || 'y', ai = AX[axis], ui = (ai + 1) % 3, wi = (ai + 2) % 3;
  const at = evalVec(op.at || [0, 0, 0], scope), r1 = evalNum(op.r, scope), r2 = op.r2 !== undefined ? evalNum(op.r2, scope) : r1;
  const h = Math.round(evalNum(op.h, scope)), hollow = op.hollow !== undefined ? evalNum(op.hollow, scope) : 0;
  const arc = op.arc ? evalVec(op.arc, scope) : null;
  const Tl = localT(op, scope, T), col = colorFn(op, ctx, scope), mode = op.mode || 'add', jit = op.jitter !== false;
  const R = Math.max(r1, r2), cu = at[ui], cw = at[wi], a0 = Math.round(at[ai]);
  const size = [0, 0, 0]; size[ai] = h; size[ui] = Math.ceil(2 * R); size[wi] = Math.ceil(2 * R);
  for (let s = 0; s < h; s++) {
    const r = h > 1 ? r1 + (r2 - r1) * (s / (h - 1)) : r1;
    for (let u = Math.floor(cu - R); u < Math.ceil(cu + R); u++) for (let w = Math.floor(cw - R); w < Math.ceil(cw + R); w++) {
      const du = u + 0.5 - cu, dw = w + 0.5 - cw, d = Math.hypot(du, dw);
      if (d > r + 0.01) continue;
      if (hollow > 0 && d < r - hollow) continue;
      if (arc) { let ang = (Math.atan2(dw, du) * 180) / Math.PI; if (ang < 0) ang += 360; if (!inArc(ang, arc[0], arc[1])) continue; }
      const p = [0, 0, 0]; p[ai] = a0 + s; p[ui] = u; p[wi] = w;
      const l = [0, 0, 0]; l[ai] = s; l[ui] = u - Math.floor(cu - R); l[wi] = w - Math.floor(cw - R);
      write(ctx, Tl, p[0], p[1], p[2], mode, col, [...l, size], jit);
    }
  }
}
function inArc(a, a0, a1) { a0 = ((a0 % 360) + 360) % 360; a1 = ((a1 % 360) + 360) % 360; return a0 <= a1 ? a >= a0 && a <= a1 : a >= a0 || a <= a1; }

function shapeEllipsoid(op, scope, T, ctx) {
  const c = evalVec(op.at, scope), rr = Array.isArray(op.r) ? evalVec(op.r, scope) : [evalNum(op.r, scope), evalNum(op.r, scope), evalNum(op.r, scope)];
  const Tl = localT(op, scope, T), col = colorFn(op, ctx, scope), mode = op.mode || 'add', jit = op.jitter !== false;
  const half = op.half; // "+y", "-y", "+x" ...
  const lo = c.map((v, i) => Math.floor(v - rr[i])), hi = c.map((v, i) => Math.ceil(v + rr[i]));
  const size = hi.map((v, i) => v - lo[i]);
  for (let x = lo[0]; x < hi[0]; x++) for (let y = lo[1]; y < hi[1]; y++) for (let z = lo[2]; z < hi[2]; z++) {
    const d = [(x + 0.5 - c[0]) / rr[0], (y + 0.5 - c[1]) / rr[1], (z + 0.5 - c[2]) / rr[2]];
    if (d[0] * d[0] + d[1] * d[1] + d[2] * d[2] > 1.0001) continue;
    if (half) { const i = AX[half[1]], sg = half[0] === '+' ? 1 : -1; if ((([x, y, z][i] + 0.5) - c[i]) * sg < 0) continue; }
    write(ctx, Tl, x, y, z, mode, col, [x - lo[0], y - lo[1], z - lo[2], size], jit);
  }
}

function shapeLine(op, scope, T, ctx) {
  const a = evalVec(op.from, scope), b = evalVec(op.to, scope), r = op.r !== undefined ? evalNum(op.r, scope) : 0.5;
  const Tl = localT(op, scope, T), col = colorFn(op, ctx, scope), mode = op.mode || 'add', jit = op.jitter !== false;
  const lo = [0, 1, 2].map((i) => Math.floor(Math.min(a[i], b[i]) - r)), hi = [0, 1, 2].map((i) => Math.ceil(Math.max(a[i], b[i]) + r));
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
  const size = hi.map((v, i) => v - lo[i]);
  for (let x = lo[0]; x < hi[0]; x++) for (let y = lo[1]; y < hi[1]; y++) for (let z = lo[2]; z < hi[2]; z++) {
    const p = [x + 0.5 - a[0], y + 0.5 - a[1], z + 0.5 - a[2]];
    const t = Math.max(0, Math.min(1, (p[0] * ab[0] + p[1] * ab[1] + p[2] * ab[2]) / L2));
    const d = Math.hypot(p[0] - ab[0] * t, p[1] - ab[1] * t, p[2] - ab[2] * t);
    if (d > r + 0.01) continue;
    write(ctx, Tl, x, y, z, mode, col, [x - lo[0], y - lo[1], z - lo[2], size], jit);
  }
}

/**
 * Rumpf aus Querschnitten entlang z (Schiffe, Rümpfe, Gondeln). sections: [{ z, w, up, down, x, y, bevel, round }]
 * werden zwischen den z-Werten linear interpoliert. Querschnitt: Rechteck w breit, von y-down bis y+up,
 * Mitte x; bevel = Fase an den Ecken (Voxel); round 1 = Ellipse statt Rechteck (Zwischenwerte mischen).
 */
function shapeLoft(op, scope, T, ctx) {
  const secs = (op.sections || []).map((s) => {
    const n = (k, d) => (s[k] !== undefined ? evalNum(s[k], scope) : d);
    const h = n('h', 0);
    return { z: n('z', 0), w: n('w', 1), up: n('up', h / 2), down: n('down', h / 2), x: n('x', 0), y: n('y', 0), bevel: n('bevel', 0), round: n('round', 0) };
  }).sort((a, b) => a.z - b.z);
  if (secs.length < 2) throw new Error('loft braucht mindestens 2 Querschnitte');
  const Tl = localT(op, scope, T), col = colorFn(op, ctx, scope), mode = op.mode || 'add', jit = op.jitter !== false;
  const hol = op.hollow !== undefined ? evalNum(op.hollow, scope) : 0;   // Wandstärke; 0 = massiv
  const z0 = Math.round(secs[0].z), z1 = Math.round(secs[secs.length - 1].z);
  const lerp = (a, b, t) => a + (b - a) * t;
  let maxW = 0, maxU = 0, maxD = 0;
  for (const s of secs) { maxW = Math.max(maxW, s.w); maxU = Math.max(maxU, s.y + s.up); maxD = Math.max(maxD, s.down - s.y); }
  const size = [Math.ceil(maxW), Math.ceil(maxU + maxD), z1 - z0];
  let k = 0;
  for (let z = z0; z < z1; z++) {
    const zc = z + 0.5;
    while (k < secs.length - 2 && zc > secs[k + 1].z) k++;
    const A = secs[k], B = secs[k + 1], t = Math.max(0, Math.min(1, (zc - A.z) / ((B.z - A.z) || 1)));
    const w = lerp(A.w, B.w, t), up = lerp(A.up, B.up, t), down = lerp(A.down, B.down, t);
    const cx = lerp(A.x, B.x, t), cy = lerp(A.y, B.y, t), bev = lerp(A.bevel, B.bevel, t), rnd = lerp(A.round, B.round, t);
    if (w <= 0 || up + down <= 0) continue;
    const hw = w / 2, mid = cy + (up - down) / 2, hh = (up + down) / 2;
    for (let x = Math.floor(cx - hw); x < Math.ceil(cx + hw); x++) for (let y = Math.floor(cy - down); y < Math.ceil(cy + up); y++) {
      const dx = Math.abs(x + 0.5 - cx), dy = Math.abs(y + 0.5 - mid);
      if (dx > hw || dy > hh) continue;
      if (bev > 0 && (hw - dx) + (hh - dy) < bev) continue;
      if (rnd > 0 && (dx / hw) ** 2 + (dy / hh) ** 2 > 1 + (1 - rnd) * 1.5) continue;
      if (hol > 0 && z >= z0 + hol && z < z1 - hol) {
        // nur die Hülle schreiben: Punkte tief im Inneren auslassen
        const ihw = hw - hol, ihh = hh - hol;
        const inside = ihw > 0 && ihh > 0 && dx < ihw && dy < ihh &&
          (bev <= 0 || (hw - dx) + (hh - dy) >= bev + hol * 1.5) &&
          (rnd < 0.5 || (dx / ihw) ** 2 + (dy / ihh) ** 2 <= 1);
        if (inside) continue;
      }
      write(ctx, Tl, x, y, z, mode, col, [Math.floor(x - (cx - maxW / 2)), Math.floor(y + maxD), z - z0, size], jit);
    }
  }
}

/** Keil/Dach: slope "+x" fällt zur +x-Seite ab; gable "x" = Satteldach mit First in der Mitte entlang z, fällt nach ±x ab. */
function shapeWedge(op, scope, T, ctx) {
  const at = evalVec(op.at || [0, 0, 0], scope).map(Math.round), size = evalVec(op.size, scope).map(Math.round);
  const Tl = localT(op, scope, T), col = colorFn(op, ctx, scope), mode = op.mode || 'add', jit = op.jitter !== false;
  const [w, h, d] = size;
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) {
    let top = h;
    if (op.slope) {
      const i = AX[op.slope[1]], n = i === 0 ? w : d, p = i === 0 ? x : z;
      const t = op.slope[0] === '+' ? (p + 0.5) / n : (n - p - 0.5) / n;
      top = Math.max(1, Math.round(h * (1 - t) + 0.5));
    } else if (op.gable) {
      const i = AX[op.gable], n = i === 0 ? w : d, p = i === 0 ? x : z;
      const t = Math.abs((p + 0.5) - n / 2) / (n / 2);
      top = Math.max(1, Math.round(h * (1 - t) + 0.5));
    }
    for (let y = 0; y < top; y++) write(ctx, Tl, at[0] + x, at[1] + y, at[2] + z, mode, col, [x, y, z, size], jit);
  }
}

// ---------------------------------------------------------------------------------------------
// Verfall: erode trägt Voxel an freiliegenden Kanten ab (deterministisch: hash3 + seed + salt)
// ---------------------------------------------------------------------------------------------
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/**
 * { op: "erode", density 0–1, depth 1–8, edges (Standard true), at/size (Bereich, lokal), ground (Standard true), salt }
 * Durchgang 1: freiliegende Voxel (edges: nur Kanten/Ecken = an mindestens zwei Achsen frei) fallen mit
 * Wahrscheinlichkeit density weg. Durchgang 2…depth: freiliegende Nachbarn der eben entfernten Voxel ebenso.
 * Jede Entscheidung hängt nur von (x, y, z, seed, salt, Durchgang) ab → gleicher seed, gleiches Ergebnis.
 * Zum Schluss fallen Voxel ohne jeden Nachbarn weg (keine schwebenden Krümel).
 */
function opErode(op, scope, T, ctx) {
  const g = ctx.grid;
  if (!g.size) return;
  const density = Math.max(0, Math.min(1, evalNum(op.density ?? 0.3, scope)));
  const depth = Math.max(1, Math.min(8, Math.round(evalNum(op.depth ?? 1, scope))));
  const edges = op.edges !== false, ground = op.ground !== false;
  const salt = op.salt !== undefined ? evalNum(op.salt, scope) | 0 : 0;
  let lo = null, hi = null;
  if (op.size) {
    // Bereich in lokalen Koordinaten (wie box: at = Ecke), transformiert ins Modell
    const at = evalVec(op.at || [0, 0, 0], scope), size = evalVec(op.size, scope), Tl = localT(op, scope, T);
    const a = apply(Tl, at), b = apply(Tl, [at[0] + size[0], at[1] + size[1], at[2] + size[2]]);
    lo = a.map((v, i) => Math.min(v, b[i])); hi = a.map((v, i) => Math.max(v, b[i]));
  }
  const inRegion = (v) => !lo || (v.x + 0.5 > lo[0] && v.x + 0.5 < hi[0] && v.y + 0.5 > lo[1] && v.y + 0.5 < hi[1] && v.z + 0.5 > lo[2] && v.z + 0.5 < hi[2]);
  const minY = ground ? g.bounds().min[1] : -Infinity;
  /** Anzahl Achsen mit mindestens einer freien Seite (unterhalb der Grundschicht zählt als Boden). */
  const freeAxes = (x, y, z) => {
    let n = 0;
    for (let a = 0; a < 3; a++) {
      const d = N6[a * 2], free = (s) => {
        const nx = x + d[0] * s, ny = y + d[1] * s, nz = z + d[2] * s;
        return !(ny < minY) && !g.has(nx, ny, nz);
      };
      if (free(1) || free(-1)) n++;
    }
    return n;
  };
  const seedMix = (Math.imul(ctx.seed ^ 0x5bd1e995, 31) + Math.imul(salt, 7919)) | 0;
  let front = null;   // im letzten Durchgang entfernte Voxel
  for (let pass = 0; pass < depth; pass++) {
    const cand = [];
    if (pass === 0) {
      for (const v of g.values()) if (inRegion(v) && freeAxes(v.x, v.y, v.z) >= (edges ? 2 : 1)) cand.push(v);
    } else {
      const seen = new Set();
      for (const r of front) for (const d of N6) {
        const v = g.get(r.x + d[0], r.y + d[1], r.z + d[2]);
        if (!v || seen.has(v) || !inRegion(v)) continue;
        seen.add(v);
        if (freeAxes(v.x, v.y, v.z) >= 1) cand.push(v);
      }
    }
    const ps = (seedMix + Math.imul(pass + 1, 104729)) | 0;
    front = cand.filter((v) => hash3(v.x, v.y, v.z, ps) < density);
    for (const v of front) g.delete(v.x, v.y, v.z);
    if (!front.length) break;
  }
  // Einzelne Voxel ohne jeden Nachbarn (schwebende Krümel) entfernen; die Grundschicht steht auf dem Boden
  const lonely = [];
  for (const v of g.values()) {
    if (!inRegion(v) || (ground && v.y === minY)) continue;
    if (!N6.some((d) => g.has(v.x + d[0], v.y + d[1], v.z + d[2]))) lonely.push(v);
  }
  for (const v of lonely) g.delete(v.x, v.y, v.z);
}

/**
 * Alle Abhängigkeiten eines Modells (Teilmodelle, .vox-Dateien, Paletten).
 * models = Pflicht; optional = Kandidaten aus Vorlagen (dürfen fehlen); templates = [{ template, combos }].
 */
export function collectDeps(model) {
  const deps = { models: new Set(), optional: new Set(), vox: new Set(), palettes: new Set(), templates: [] };
  if (model.palette) deps.palettes.add(model.palette);
  const walk = (ops) => {
    for (const op of ops || []) {
      if (op.op === 'use') {
        if (isTemplateUse(op)) {
          const combos = expandTemplateUse(model, op);
          for (const c of combos) for (const id of c.ids) deps.optional.add(id);
          deps.templates.push({ template: op.model, fallback: op.fallback, combos });
        } else deps.models.add(op.model);
        if (op.palette) deps.palettes.add(op.palette);
      }
      if (op.op === 'vox') deps.vox.add(op.file);
      if (op.ops) walk(op.ops);
    }
  };
  walk(model.ops);
  for (const id of deps.models) deps.optional.delete(id);
  return deps;
}
