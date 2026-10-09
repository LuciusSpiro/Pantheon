// CORE M4 (CONTRACT-M4 §3.2): Asset-Lader für den Voxel-Client.
// Library aus /voxel/core/library.js, io per fetch('/voxel/…'), Build-Cache (LRU 256), Platzhalter für fehlende Assets.
// object() und figure() liefern sofort ein Objekt. Ist das Asset noch nicht geladen, steckt darin zuerst ein Platzhalter,
// der nach dem Laden durch das echte Modell ersetzt wird. Fehlende Assets bleiben Platzhalter und werden gezählt.
import * as THREE from 'three';
import { Library } from 'voxelwerk/core/library.js';
import { geometriesOf, figureObject, applyPose, MATS } from 'voxelwerk/render/voxel-three.js';

const BASE = '/voxel/';
const LRU_MAX = 256;
const DEBUG = new URLSearchParams(location.search).get('debug') === '1';

// B1 (VOXEL): /voxel/index.json listet alle vorhandenen Assets je Art. Vorlagen (`use` mit options) fragen sonst jede
// Kombination ab (z. B. kit/<bauweise>/<art>/wand_fuellung) – Hunderte vermeidbare 404 je Kartenbau. Was nicht im Index steht,
// wird ohne Anfrage als fehlend gemeldet (loadOptional fängt das ab). Ohne Index: wie bisher.
const indexReady = (async () => {
  try {
    const r = await fetch(BASE + 'index.json', { cache: 'no-cache' });
    if (!r.ok) return null;
    const j = await r.json();
    const out = new Map();
    for (const [kind, list] of Object.entries(j || {})) if (Array.isArray(list)) out.set(kind, new Set(list));
    return out.size ? out : null;
  } catch (e) { return null; }
})();
let index404 = 0;
const io = {
  async json(p) {
    const m = /^assets\/(models|palettes|rigs|figures|poses|moods|scenes)\/(.+)\.json$/.exec(p);
    if (m) {
      const idx = await indexReady;
      if (idx && idx.has(m[1]) && !idx.get(m[1]).has(m[2])) { index404++; throw new Error('HTTP 404 ' + p + ' (nicht im Index)'); }
    }
    const r = await fetch(BASE + p, { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + p);
    return r.json();
  },
  async binary(p) {
    const r = await fetch(BASE + p, { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + p);
    return r.arrayBuffer();
  },
};

export const lib = new Library(io);
export { MATS };

// ------------------------------------------------------------------------------------------------ Material + Netz-Hilfen
/** Ein Material für Voxel-Netze: beleuchtet; Vertices mit aEmit = 1 leuchten (Farbe = Emission).
 *  lit + emit eines Modells werden zu einem Netz zusammengelegt → ein Draw Call je Objekt statt zwei. */
export const VOXEL_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
VOXEL_MAT.onBeforeCompile = (sh) => {
  sh.vertexShader = 'attribute float aEmit;\nvarying float vEmit;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvEmit = aEmit;');
  sh.fragmentShader = 'varying float vEmit;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
    // Emission: Vertexfarbe = Rollenfarbe × emit (Mesher). Stärke bleibt erhalten (×1,2, damit ember/leit über die Bloom-Schwelle
    // kommen und als Lichtpunkte lesbar sind), farbtreu gedeckelt bei Maximalkanal 1,5 (Kronen mit emit 1,6–2 brennen nicht weiß aus).
    // Früher: Maximalkanal ≤ 1,0 × 0,85 – damit ging emit der Palette verloren (ember beige, leit lavendel).
    '#include <emissivemap_fragment>\n\tif (vEmit > 0.5) { vec3 eC = diffuseColor.rgb; float eM = max(max(eC.r, eC.g), max(eC.b, 1e-3)); totalEmissiveRadiance += eC * min(1.2, 1.5 / eM); diffuseColor.rgb *= 0.0; }');
};
VOXEL_MAT.customProgramCacheKey = () => 'voxel-emit-v3';

/** lit + emit (je BufferGeometry oder null) → eine Geometrie mit Attribut aEmit. */
export function combine(lit, emit) {
  const parts = [];
  if (lit) parts.push([lit, 0]);
  if (emit) parts.push([emit, 1]);
  if (!parts.length) return null;
  let nv = 0, ni = 0;
  for (const [g] of parts) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), em = new Float32Array(nv);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let ov = 0, oi = 0;
  for (const [g, e] of parts) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, ov * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, ov * 3);
    if (g.attributes.color) col.set(g.attributes.color.array, ov * 3);
    if (e) em.fill(1, ov, ov + n);
    if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[oi + i] = a[i] + ov; oi += a.length; }
    else { for (let i = 0; i < n; i++) idx[oi + i] = ov + i; oi += n; }
    ov += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('aEmit', new THREE.BufferAttribute(em, 1));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}

const tmpN = new THREE.Vector3(), tmpP = new THREE.Vector3(), nMat = new THREE.Matrix3();
/**
 * Statisches Zusammenbacken: items = [{ geo (kombinierte Geometrie), matrix (Matrix4) }] → eine Geometrie.
 * Für Böden und Wände eines Decks (ein Draw Call statt hunderter).
 */
export function bake(items) {
  let nv = 0, ni = 0;
  for (const it of items) { if (!it.geo) continue; nv += it.geo.attributes.position.count; ni += it.geo.index.count; }
  if (!nv) return null;
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), em = new Float32Array(nv);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let ov = 0, oi = 0;
  for (const it of items) {
    const g = it.geo; if (!g) continue;
    const P = g.attributes.position.array, N = g.attributes.normal.array, C = g.attributes.color.array, E = g.attributes.aEmit ? g.attributes.aEmit.array : null;
    const n = g.attributes.position.count, m = it.matrix;
    nMat.getNormalMatrix(m);
    for (let i = 0; i < n; i++) {
      tmpP.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(m);
      pos[(ov + i) * 3] = tmpP.x; pos[(ov + i) * 3 + 1] = tmpP.y; pos[(ov + i) * 3 + 2] = tmpP.z;
      tmpN.set(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]).applyMatrix3(nMat).normalize();
      nor[(ov + i) * 3] = tmpN.x; nor[(ov + i) * 3 + 1] = tmpN.y; nor[(ov + i) * 3 + 2] = tmpN.z;
    }
    col.set(C, ov * 3);
    if (E) em.set(E, ov);
    const I = g.index.array;
    for (let i = 0; i < I.length; i++) idx[oi + i] = I[i] + ov;
    oi += I.length; ov += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('aEmit', new THREE.BufferAttribute(em, 1));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}

/** Eine Modell-Group aus voxel-three (lit + emit Mesh) auf ein Netz mit VOXEL_MAT umstellen. */
const combinedOf = new WeakMap();
function combineGroupMeshes(grp) {
  const meshes = grp.children.filter((c) => c.isMesh && !c.isInstancedMesh);
  if (!meshes.length) return;
  const lit = meshes.find((m) => m.material === MATS.lit), emit = meshes.find((m) => m.material === MATS.emit);
  if (!lit && !emit) return;
  const key = (lit || emit).geometry;
  let cg = combinedOf.get(key);
  if (!cg) { cg = combine(lit && lit.geometry, emit && emit.geometry); combinedOf.set(key, cg); }
  if (!cg) return;
  for (const m of [lit, emit]) if (m) grp.remove(m);
  const m = new THREE.Mesh(cg, VOXEL_MAT);
  m.castShadow = true; m.receiveShadow = true;
  grp.add(m);
}

const manifestById = new Map();
const missing = new Set();          // 'models:id' / 'figures:id', die nicht geladen werden konnten
const loading = new Map();          // 'kind:id' → Promise<boolean>
const lru = new Map();              // Build-Schlüssel → { lit, emit, voxels, size }
const counters = { builds: 0, hits: 0, placeholders: 0, missing: 0, errors: 0, evicted: 0 };
let onError = (where, e) => console.warn('[voxel/loader]', where, e);

export function setErrorHandler(fn) { if (typeof fn === 'function') onError = fn; }

async function loadManifest() {
  try {
    const m = await io.json('manifest.json');
    // PIPELINE-Format: { format, teams: [...], assets: { <id>: Eintrag mit source } } (auch Liste toleriert)
    const list = Array.isArray(m) ? m : Array.isArray(m.assets) ? m.assets : m.assets ? Object.entries(m.assets).map(([id, a]) => Object.assign({ id }, a)) : [];
    for (const a of list) if (a && a.id) manifestById.set(a.id, a);
  } catch (e) { /* noch kein Manifest (PIPELINE) – kein Fehler */ }
}

export const ready = (async () => {
  await loadManifest();
  // Grundausstattung vorladen; fehlt etwas, geht es ohne weiter
  await Promise.all([
    lib.load('palettes', 'lerche_rom').catch(() => null),
    lib.load('rigs', 'human').catch(() => null),
  ]);
  return true;
})();

export function manifest(id) { return manifestById.get(id) || null; }
export function manifestIds() { return [...manifestById.keys()]; }

/** Lädt ein Modell bzw. eine Figur (einmal). → Promise<boolean> */
export function load(id0, kind = 'models') {
  const id = src(id0);
  const k = kind + ':' + id;
  if (lib.get(kind, id)) return Promise.resolve(true);
  if (missing.has(k)) return Promise.resolve(false);
  let p = loading.get(k);
  if (p) return p;
  p = lib.load(kind, id).then(() => true, (e) => {
    missing.add(k); counters.missing++;
    if (DEBUG) console.warn('[voxel/loader] fehlt', k, e && e.message);
    return false;
  }).finally(() => loading.delete(k));
  loading.set(k, p);
  return p;
}
export function loadMany(ids, kind = 'models') { return Promise.all([...new Set(ids)].map((id) => load(id, kind))); }
export function isLoaded(id, kind = 'models') { return !!lib.get(kind, src(id)); }
export function isMissing(id, kind = 'models') { return missing.has(kind + ':' + src(id)); }
/** Rezept-ID im voxelwerk: Manifest-Feld source (PIPELINE), sonst die ID selbst */
export function src(id) { const m = manifestById.get(id); return (m && m.source) || id; }

function keyOf(id, params, palette, colors) {
  return id + '|' + JSON.stringify(params || {}) + '|' + (palette || '') + '|' + (colors ? JSON.stringify(colors) : '');
}
function trimLibCache() {
  const bc = lib.buildCache;
  while (bc.size > LRU_MAX) { const k = bc.keys().next().value; bc.delete(k); }
}

/**
 * Geometrien eines Modells in Metern (Anker im Ursprung), gecacht (LRU 256).
 * → { lit: BufferGeometry|null, emit: BufferGeometry|null, voxels } oder null, wenn (noch) nicht verfügbar.
 */
export function geometries(id0, params, opts = {}) {
  const id = src(id0);
  const model = lib.get('models', id);
  if (!model) { load(id); return null; }
  // nur deklarierte Parameter weitergeben (der Kern wirft sonst „unbekannter Parameter“)
  if (params) {
    const decl = model.params || {}, out = {};
    for (const k in params) if (k === 'seed' || k in decl) out[k] = params[k];
    params = out;
  }
  const k = keyOf(id, params, opts.palette, opts.colors);
  let hit = lru.get(k);
  if (hit) { lru.delete(k); lru.set(k, hit); counters.hits++; return hit; }
  try {
    const built = lib.build(id, { params: params || {}, palette: opts.palette, colors: opts.colors });
    const g = geometriesOf(built);
    hit = { lit: g.lit, emit: g.emit, voxels: g.voxels, geo: combine(g.lit, g.emit) };
    counters.builds++;
  } catch (e) {
    counters.errors++; onError('loader.build:' + id, e);
    // fehlende Palette (palette-Override noch nicht geladen) macht das Modell nicht dauerhaft „fehlend“
    if (!/Palette ".*" nicht gefunden/.test(String(e && e.message))) missing.add('models:' + id);
    else if (opts.palette && lib.load) lib.load('palettes', opts.palette).catch(() => null);
    return null;
  }
  lru.set(k, hit);
  if (lru.size > LRU_MAX) { const old = lru.keys().next().value; lru.delete(old); counters.evicted++; }
  trimLibCache();
  return hit;
}

// ------------------------------------------------------------------------------------------------ Platzhalter
const phMats = new Map();
function phMat(color) {
  const c = DEBUG ? '#FF00FF' : (color || '#7A8494');
  let m = phMats.get(c);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, transparent: !DEBUG, opacity: DEBUG ? 1 : 0.85 }); phMats.set(c, m); }
  return m;
}
const boxGeo = new THREE.BoxGeometry(1, 1, 1); boxGeo.translate(0, 0.5, 0);
/** Platzhalterbox (Mitte unten am Ursprung). size = [w, h, d] in Metern. */
export function placeholder(size, color) {
  const s = size || [0.8, 1, 0.8];
  const m = new THREE.Mesh(boxGeo, phMat(color));
  m.scale.set(Math.max(0.05, s[0]), Math.max(0.05, s[1]), Math.max(0.05, s[2]));
  m.castShadow = true; m.receiveShadow = true;
  m.userData.placeholder = true;
  counters.placeholders++;
  return m;
}
export function placeholderSize(id) {
  const m = manifest(id);
  if (m) {
    const fp = m.footprint || [0.8, 0.8];
    return [fp[0] * 0.9, Math.min(3, m.height || 1), fp[1] * 0.9];
  }
  return [0.8, 1, 0.8];
}

function fillGroup(grp, g, opts) {
  if (g.geo) { const m = new THREE.Mesh(g.geo, VOXEL_MAT); m.castShadow = opts.castShadow !== false; m.receiveShadow = true; grp.add(m); }
  grp.userData.voxels = g.voxels;
}

/**
 * Modell als THREE.Object3D (Group). Geometrie wird geteilt (Klon aus dem Cache).
 * opts: { palette, colors, color (Platzhalterfarbe), castShadow, onReady(group) }
 */
export function object(id, params, opts = {}) {
  const grp = new THREE.Group(); grp.name = id;
  grp.userData.assetId = id;
  const g = geometries(id, params, opts);
  if (g) { fillGroup(grp, g, opts); grp.userData.ready = true; if (opts.onReady) opts.onReady(grp); return grp; }
  const ph = placeholder(placeholderSize(id), opts.color);
  grp.add(ph);
  grp.userData.ready = false;
  if (!isMissing(id)) {
    load(id).then((ok) => {
      if (!ok) return;
      const g2 = geometries(id, params, opts);
      if (!g2) return;
      grp.remove(ph);
      fillGroup(grp, g2, opts);
      grp.userData.ready = true;
      if (opts.onReady) try { opts.onReady(grp); } catch (e) { onError('loader.onReady:' + id, e); }
    });
  }
  return grp;
}

/**
 * Figur: { root, joints, pose(name, t), ready, loaded (Promise) }.
 * Bis die Figur geladen ist, steht eine Platzhaltersäule in root, joints ist leer.
 */
export function figure(id, opts = {}) {
  const root = new THREE.Group(); root.name = id;
  const f = { root, joints: {}, ready: false, inner: null, pose(name, t) { if (f.inner) applyPose(f.inner, name, t || 0); } };
  // opts.params (z. B. role beim Plünderer): abgeleitete Figurdefinition unter eigener ID, Schlüssel inkl. params
  const derivedId = () => {
    const base = src(id);
    const p = opts.params;
    if (!p || !Object.keys(p).length) return base;
    const did = base + '#' + JSON.stringify(Object.keys(p).sort().map((k) => [k, p[k]]));
    if (!lib.get('figures', did)) {
      const fig = lib.get('figures', base);
      lib.store.figures.set(did, Object.assign({}, fig, { id: did, params: Object.assign({}, fig.params || {}, p) }));
    }
    return did;
  };
  const build = () => {
    try {
      const fo = figureObject(lib, derivedId(), opts);
      // je Teil lit + emit → ein Netz (halbiert die Draw Calls einer Figur)
      const groups = [];
      fo.root.traverse((o) => { if (o.isGroup && o.children.some((c) => c.isMesh)) groups.push(o); });
      for (const g of groups) combineGroupMeshes(g);
      f.inner = fo; f.joints = fo.joints; f.ready = true;
      root.clear(); root.add(fo.root);
      applyPose(fo, 'stand', 0);
      return true;
    } catch (e) { counters.errors++; onError('loader.figure:' + id, e); return false; }
  };
  if (lib.get('figures', src(id)) && build()) { f.loaded = Promise.resolve(true); return f; }
  root.add(placeholder([0.5, 1.8, 0.4], opts.color || '#C9974A'));
  f.loaded = load(id, 'figures').then((ok) => ok && build());
  return f;
}

/** Stimmung laden (moods/<id>.json) → Objekt oder null */
export async function mood(id) {
  const ok = await load(id, 'moods');
  return ok ? lib.get('moods', id) : null;
}

export function stats() {
  return {
    manifest: manifestById.size, cached: lru.size, builds: counters.builds, hits: counters.hits,
    placeholders: counters.placeholders, missing: [...missing], errors: counters.errors, evicted: counters.evicted,
    loading: loading.size, vermiedeneAnfragen: index404,
  };
}
