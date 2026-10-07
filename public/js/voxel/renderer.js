// CORE M4 (CONTRACT-M4 §3.1/§3.2): WebGL-Renderer für die begehbaren Zonen (Schiff, Plattform, Wrack, Kesh).
// Szene, Kamera (Perspektive, FOV 30°, Neigung 57°, zwei Zoomstufen, folgt weich), Stimmung/Licht, Layer-Verwaltung,
// Projektion fürs 2D-Overlay, Liftfahrt (Kamerafahrt + Lichtband-Blende), FPS-Wächter, Bloom nur bei quality 'high'.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const TILE = 32, VW = 640, VH = 360;
const D2R = Math.PI / 180;
const ELEV = 57;                       // Neigung der Kamera (Grad)
const FOV = 30, FOV_KESH = 36;
const VIEW_W = [15, 23];               // sichtbare Breite (m) in den Zoomstufen 0 (nah, Standard) und 1 (weit)
const LIFT_RIDE = 0.6;                 // s Kamerafahrt
const LIFT_RISE = 3.2;                 // m senkrecht
const MAX_POINT_LIGHTS = 4;
const ZONES = ['ship', 'platform', 'wreck', 'kesh'];
const MOOD_OF = { ship: 'ship_interior', platform: 'platform_space', wreck: 'wreck_dark', kesh: 'kesh_dusk' };
const MOOD_FALLBACK = {
  ship_interior: { background: '#0B0E1A', hemi: { sky: '#6F86A6', ground: '#1B2433', intensity: 0.55 }, sun: { color: '#CFE2FF', intensity: 0.9, dir: [-0.3, 1, 0.2] }, exposure: 1.1, bloom: { strength: 0.9, radius: 0.5, threshold: 0.7 } },
  platform_space: { background: '#05070E', hemi: { sky: '#8FA6C8', ground: '#141A26', intensity: 0.6 }, sun: { color: '#FFF2DC', intensity: 1.6, dir: [-0.5, 1, 0.4] }, exposure: 1.0 },
  wreck_dark: { background: '#04050A', hemi: { sky: '#3A4A60', ground: '#0C0F16', intensity: 0.35 }, sun: { color: '#9FB4D6', intensity: 0.5, dir: [-0.2, 1, 0.3] }, exposure: 1.0 },
  kesh_dusk: { background: '#2A1E2E', hemi: { sky: '#C9A4B8', ground: '#3A2A22', intensity: 0.7 }, sun: { color: '#FFC79A', intensity: 1.8, dir: [-0.6, 0.8, 0.3] }, exposure: 1.0 },
};

import { VOXEL_MAT } from './loader.js';
export { VOXEL_MAT };

// ------------------------------------------------------------------------------------------------ Zustand
const layers = [];
const S = {
  inited: false, canvas: null, renderer: null, scene: null, camera: null, composer: null, bloom: null,
  loader: null, quality: 'high', forcedQuality: null,
  zone: null, ctxs: new Map(), building: new Set(),
  moodGroup: null, sun: null, hemi: null, ambient: null, points: [], lightReq: [],
  target: new THREE.Vector3(), camInit: false, zoom: 0, camOffY: 0,
  shownDeck: 0, deckY0: 0,
  lift: { phase: 'idle', t: 0, dir: 1, hold: 0 },
  blend: null,
  fps: { samples: [], acc: 0, n: 0, last: 0, value: 0, lowSince: 0 },
  errors: 0, layerErrors: {}, onError: null,
  info: { calls: 0, triangles: 0, frameMs: 0 },
  view: null, mood: null, moodId: null,
  shared: {},
  W: 0, H: 0,
};

function report(where, e) {
  S.errors++;
  try { if (S.onError) S.onError(where, e); else console.warn('[voxel]', where, e); } catch (x) { /* egal */ }
}

// ------------------------------------------------------------------------------------------------ Karten/Koordinaten
function Maps() { return window.Shared_Maps || {}; }
export function decks() {
  const M = Maps();
  if (Array.isArray(M.SHIP_DECKS) && M.SHIP_DECKS.length) return M.SHIP_DECKS;
  const h = (M.ship && M.ship.h) || 13;
  return [{ id: 'system', name: 'Systemdeck', level: 0, y0: 0, y1: h - 1 }];
}
/** Deck einer Schiffszeile (Kachel) → 0|1, −1 in der Lücke */
export function deckOfTile(ty) {
  const M = Maps();
  if (typeof M.deckOf === 'function') { const d = M.deckOf(ty); if (d != null) return d; }
  const D = decks();
  for (let i = 0; i < D.length; i++) if (ty >= D[i].y0 && ty <= D[i].y1) return i;
  return -1;
}
export function deckOfPx(py) { return deckOfTile(Math.floor(py / TILE)); }
function deckY0(d) { const D = decks(); return (D[d] || D[0]).y0; }
function mapOfZone(zone) {
  const M = Maps();
  if (zone === 'ship') return M.ship;
  if (zone === 'wreck') return M.wreck || (window.Render && Render.mapFor ? Render.mapFor('away', { away: { map: 'wreck' } }) : null);
  return M[zone] || null;
}
/** Zone des Spielers → 'ship' | 'platform' | 'wreck' | 'kesh' */
export function zoneOf(view) {
  const z = view && view.self && view.self.zone;
  if (z === 'ship') return 'ship';
  if (z === 'away') {
    const id = (view.state && view.state.away && view.state.away.map) || 'platform';
    return ZONES.includes(id) ? id : 'platform';
  }
  return z || null;
}

const tmpV = new THREE.Vector3();
function toWorldIn(zone, px, py, out) {
  out = out || new THREE.Vector3();
  let z = py / TILE;
  if (zone === 'ship') { const d = deckOfPx(py); z = (py - deckY0(d < 0 ? 0 : d) * TILE) / TILE; }
  return out.set(px / TILE, 0, z);
}

// ------------------------------------------------------------------------------------------------ Init
export function init(canvas, loader, opts = {}) {
  if (S.inited) return S;
  S.canvas = canvas; S.loader = loader; S.onError = opts.onError || null;
  const q = opts.quality;
  if (q === 'low' || q === 'high') { S.quality = q; S.forcedQuality = q; }
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve });
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.NeutralToneMapping;
  r.shadowMap.enabled = S.quality === 'high';
  r.shadowMap.type = THREE.PCFShadowMap;
  r.info.autoReset = false;
  S.renderer = r;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); S.contextLost = true; report('webglcontextlost', new Error('WebGL-Kontext verloren')); }, false);
  S.scene = new THREE.Scene();
  S.camera = new THREE.PerspectiveCamera(FOV, VW / VH, 0.3, 200);
  S.scene.add(S.camera);
  S.moodGroup = new THREE.Group(); S.moodGroup.name = 'mood'; S.scene.add(S.moodGroup);
  // feste Lichter (Anzahl bleibt gleich → keine Shader-Neuübersetzung)
  S.hemi = new THREE.HemisphereLight('#6F86A6', '#1B2433', 0.55); S.moodGroup.add(S.hemi);
  S.ambient = new THREE.AmbientLight('#FFFFFF', 0); S.moodGroup.add(S.ambient);
  S.sun = new THREE.DirectionalLight('#CFE2FF', 0.9);
  S.sun.castShadow = true;
  S.sun.shadow.mapSize.set(2048, 2048);
  const sc = S.sun.shadow.camera; sc.left = sc.bottom = -13; sc.right = sc.top = 13; sc.near = 0.5; sc.far = 60;
  S.sun.shadow.bias = -0.0004; S.sun.shadow.normalBias = 0.03;
  S.moodGroup.add(S.sun, S.sun.target);
  for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
    const l = new THREE.PointLight('#FFC66B', 0, 8, 2); l.castShadow = false; S.points.push(l); S.moodGroup.add(l);
  }
  S.blend = makeBlend(); S.camera.add(S.blend);
  buildComposer();
  S.fps.last = performance.now();
  S.inited = true;
  resize(true);
  return S;
}

function buildComposer() {
  const r = S.renderer;
  try {
    S.composer = new EffectComposer(r);
    S.composer.addPass(new RenderPass(S.scene, S.camera));
    S.bloom = new UnrealBloomPass(new THREE.Vector2(256, 144), 0.6, 0.5, 0.8);
    S.composer.addPass(S.bloom);
    S.composer.addPass(new OutputPass());
  } catch (e) { report('renderer.composer', e); S.composer = null; }
}

function pixelRatio() {
  const dpr = window.devicePixelRatio || 1;
  return S.quality === 'low' ? 0.75 : Math.min(dpr, 1.5);
}
function resize(force) {
  const c = S.canvas;
  const w = Math.max(1, Math.round(c.clientWidth || VW)), h = Math.max(1, Math.round(c.clientHeight || VH));
  const pr = pixelRatio();
  if (!force && w === S.W && h === S.H && pr === S.PR) return;
  S.W = w; S.H = h; S.PR = pr;
  S.renderer.setPixelRatio(pr);
  S.renderer.setSize(w, h, false);
  if (S.composer) { S.composer.setPixelRatio(pr); S.composer.setSize(w, h); }
  if (S.bloom) S.bloom.resolution.set(Math.round(w * pr / 2), Math.round(h * pr / 2));
  S.camera.aspect = VW / VH; S.camera.updateProjectionMatrix();
}

export function setQuality(q) {
  if (q !== 'low' && q !== 'high') return;
  if (S.quality === q) return;
  S.quality = q;
  if (!S.renderer) return;
  S.renderer.shadowMap.enabled = q === 'high';
  VOXEL_MAT.needsUpdate = true;
  S.scene.traverse((o) => { if (o.material && o.material.needsUpdate !== undefined) o.material.needsUpdate = true; });
  resize(true);
  for (const c of S.ctxs.values()) c.quality = q;
}

// ------------------------------------------------------------------------------------------------ Layer
/**
 * layer = { id, zones: ['ship'|'platform'|'wreck'|'kesh'|'*'], build(ctx) → void|Promise, update(view, dt, ctx), dispose?(ctx) }
 */
export function registerLayer(layer) {
  if (!layer || !layer.id || typeof layer.update !== 'function') { report('registerLayer', new Error('ungültiger Layer ' + (layer && layer.id))); return; }
  const i = layers.findIndex((l) => l.id === layer.id);
  if (i >= 0) { disposeLayer(layers[i]); layers.splice(i, 1); }
  layers.push(layer);
  if (S.zone && layerFor(layer, S.zone)) buildLayer(layer, S.zone);
}
export function layerIds() { return layers.map((l) => l.id); }
function layerFor(layer, zone) { const z = layer.zones || ['*']; return z.includes('*') || z.includes(zone); }
/** Zeichnet 3D diese Zone? Nur, wenn ein Layer sie ausdrücklich bedient (nicht nur '*'). */
export function handles(zone) {
  if (!ZONES.includes(zone)) return false;
  return layers.some((l) => (l.zones || []).includes(zone) && !(S.layerErrors[l.id] && S.layerErrors[l.id].disabled));
}

function makeCtx(layer, zone) {
  const root = new THREE.Group(); root.name = 'layer:' + layer.id;
  S.scene.add(root);
  const ctx = {
    THREE, root, loader: S.loader, zone, deck: S.shownDeck, map: mapOfZone(zone),
    tile(tx, ty) {
      let z = ty;
      if (zone === 'ship') { const d = deckOfTile(ty); z = ty - deckY0(d < 0 ? 0 : d); }
      return new THREE.Vector3(tx + 0.5, 0, z + 0.5);
    },
    toWorld(px, py) { return toWorldIn(zone, px, py); },
    quality: S.quality, camera: S.camera,
    setMood(id) { applyMood(id); },
    countError(where, err) { report(layer.id + ':' + where, err); },
    // Zusätze (über §3.2 hinaus): Deck-Hilfen, Lichtpool, gemeinsamer Zustand der Layer
    deckOf: deckOfPx, deckOfTile, decks, scene: S.scene, renderer: S.renderer, material: VOXEL_MAT,
    addLight(o) { if (o) S.lightReq.push(o); },
    shared: S.shared,
    view: null,
  };
  return ctx;
}

function buildLayer(layer, zone) {
  const ctx = makeCtx(layer, zone);
  S.ctxs.set(layer.id, ctx);
  try {
    const p = layer.build ? layer.build(ctx) : null;
    if (p && typeof p.then === 'function') {
      S.building.add(layer.id);
      p.then(() => S.building.delete(layer.id), (e) => { S.building.delete(layer.id); report(layer.id + '.build', e); });
    }
  } catch (e) { report(layer.id + '.build', e); }
}
function disposeLayer(layer) {
  const ctx = S.ctxs.get(layer.id);
  if (!ctx) return;
  try { if (layer.dispose) layer.dispose(ctx); } catch (e) { report(layer.id + '.dispose', e); }
  S.scene.remove(ctx.root);
  S.ctxs.delete(layer.id);
}
function enterZone(zone) {
  for (const l of layers) disposeLayer(l);
  S.zone = zone;
  S.shared = {};
  S.camInit = false;
  S.lift = { phase: 'idle', t: 0, dir: 1, hold: 0 };
  S.camera.fov = zone === 'kesh' ? FOV_KESH : FOV; S.camera.updateProjectionMatrix();
  applyMood(MOOD_OF[zone] || 'ship_interior');
  for (const l of layers) if (layerFor(l, zone)) buildLayer(l, zone);
}

// ------------------------------------------------------------------------------------------------ Stimmung
let moodReq = 0;
function applyMood(id) {
  const req = ++moodReq;
  const set = (m) => { if (req === moodReq) setMoodObj(id, m || MOOD_FALLBACK[id] || MOOD_FALLBACK.ship_interior); };
  set(MOOD_FALLBACK[id] || null);
  if (S.loader && S.loader.mood) S.loader.mood(id).then((m) => { if (m) set(m); }, () => {});
}
function setMoodObj(id, mood) {
  S.moodId = id; S.mood = mood;
  const col = (s, d) => new THREE.Color(s || d);
  S.scene.background = col(mood.background, '#0B0E1A');
  S.scene.fog = mood.fog ? new THREE.Fog(col(mood.fog.color), (mood.fog.near || 2) * 10, (mood.fog.far || 6) * 10) : null;
  S.hemi.color = col(mood.hemi && mood.hemi.sky, '#a0b4c8'); S.hemi.groundColor = col(mood.hemi && mood.hemi.ground, '#40382c');
  S.hemi.intensity = mood.hemi && mood.hemi.intensity != null ? mood.hemi.intensity : 1;
  S.ambient.color = col(mood.ambient && mood.ambient.color, '#FFFFFF'); S.ambient.intensity = mood.ambient ? mood.ambient.intensity || 0 : 0;
  const sun = mood.sun || { intensity: 0 };
  S.sun.color = col(sun.color, '#fff2dc'); S.sun.intensity = sun.intensity != null ? sun.intensity : 1;
  S.sunDir = new THREE.Vector3(...(sun.dir || [-0.5, 1, 0.3])).normalize();
  S.renderer.toneMappingExposure = mood.exposure != null ? mood.exposure : 1;
  if (S.bloom) {
    const b = mood.bloom || {};
    S.bloom.strength = b.strength != null ? b.strength : 0.5; S.bloom.radius = b.radius != null ? b.radius : 0.5; S.bloom.threshold = b.threshold != null ? b.threshold : 0.85;
  }
  S.baseHemi = S.hemi.intensity; S.baseSun = S.sun.intensity;
}

// ------------------------------------------------------------------------------------------------ Lichtband-Blende
function makeBlend() {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { edge: { value: -1 }, below: { value: 1 }, glow: { value: new THREE.Color('#FFE2A0') }, dark: { value: new THREE.Color('#0B0E1A') } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: [
      'uniform float edge; uniform float below; uniform vec3 glow; uniform vec3 dark; varying vec2 vUv;',
      'void main(){',
      '  float y = vUv.y; float covered = below > 0.5 ? step(y, edge) : step(edge, y);',
      '  float d = abs(y - edge); float band = exp(-d * 28.0) + 0.6 * exp(-d * 7.0);',
      '  vec3 c = mix(dark, glow, clamp(band, 0.0, 1.0));',
      '  float a = max(covered, clamp(band, 0.0, 1.0));',
      '  gl_FragColor = vec4(c, a);',
      '}',
    ].join('\n'),
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  m.frustumCulled = false; m.renderOrder = 9999; m.visible = false;
  return m;
}
/** p: 0 = offen, 1 = ganz bedeckt. closing: Kante läuft in Richtung dir ein; opening: läuft weiter und gibt frei. */
function setBlend(p, closing, dir) {
  const u = S.blend.material.uniforms;
  if (p <= 0.001) { S.blend.visible = false; return; }
  S.blend.visible = true;
  // aufwärts (dir > 0): Boden zieht nach unten weg → Kante wandert von oben nach unten
  const down = dir > 0;
  if (closing) { u.edge.value = down ? 1.1 - p * 1.2 : -0.1 + p * 1.2; u.below.value = down ? 0 : 1; }
  else { u.edge.value = down ? 1.1 - (1 - p) * 1.2 : -0.1 + (1 - p) * 1.2; u.below.value = down ? 1 : 0; }
}

// ------------------------------------------------------------------------------------------------ Kamera
export function setZoom(z) { S.zoom = z ? 1 : 0; }
export function zoomStep(dir) { setZoom(dir > 0 ? 1 : 0); }
export function getZoom() { return S.zoom; }
function camDist() {
  const w = VIEW_W[S.zoom] * (S.zone === 'kesh' ? 1.12 : 1);
  return w / (2 * Math.tan((S.camera.fov * D2R) / 2) * S.camera.aspect);
}
const camOff = new THREE.Vector3();
function updateCamera(view, dt) {
  const self = view.self || { x: 0, y: 0 };
  const p = toWorldIn(S.zone, self.x, self.y, tmpV);
  // eigene Figur etwas unter der Bildmitte (wie 2D: Kamera 16 px über den Füßen)
  p.y = 0.6;
  if (S.zone === 'ship') p.z = (self.y - S.deckY0 * TILE) / TILE;
  const jump = !S.camInit || p.distanceTo(S.target) > 6;
  if (jump) { S.target.copy(p); S.camInit = true; S.distNow = camDist(); }
  else { const k = 1 - Math.exp(-dt * 7); S.target.lerp(p, k); }
  const want = camDist();
  S.distNow = S.distNow == null ? want : S.distNow + (want - S.distNow) * (1 - Math.exp(-dt * 8));
  const e = ELEV * D2R;
  camOff.set(0, Math.sin(e) * S.distNow, Math.cos(e) * S.distNow);
  S.camera.position.copy(S.target).add(camOff);
  S.camera.position.y += S.camOffY;
  tmpV.copy(S.target); tmpV.y += S.camOffY;
  S.camera.lookAt(tmpV);
  S.camera.updateMatrixWorld(true);
  // Sonne + Schattenkamera folgen dem Bildausschnitt
  const d = S.sunDir || tmpV.set(-0.3, 1, 0.2).normalize();
  S.sun.target.position.set(S.target.x, 0, S.target.z);
  S.sun.position.copy(S.sun.target.position).addScaledVector(d, 25);
  S.sun.target.updateMatrixWorld(); S.sun.updateMatrixWorld();
}

// ------------------------------------------------------------------------------------------------ Liftfahrt
function updateLift(view, dt) {
  const L = S.lift;
  if (S.zone !== 'ship') { S.shownDeck = 0; S.deckY0 = deckY0(0); S.camOffY = 0; setBlend(0); return; }
  const self = view.self || {};
  const me = view.me || {};
  const myDeck = Math.max(0, deckOfPx(self.y));
  const D = decks();
  const level = (d) => (D[d] && D[d].level != null ? D[d].level : d);
  // Vorwarnung: Lift/Leiter läuft und endet bald → Blende schließen
  let soon = null;
  const lf = me.lift, ld = me.ladder;
  if (lf && lf.to != null && lf.to !== S.shownDeck) { const left = (+lf.T || 1.5) - (+lf.t || 0); if (left <= LIFT_RIDE + 0.05) soon = lf.to; }
  if (ld && ld.T) { const left = (+ld.T) - (+ld.t || 0); if (left <= LIFT_RIDE + 0.05) soon = S.shownDeck === 0 ? 1 : 0; }
  if (L.phase === 'idle') {
    if (soon != null && soon !== S.shownDeck) { L.phase = 'out'; L.t = 0; L.dir = Math.sign(level(soon) - level(S.shownDeck)) || 1; L.hold = 0; }
    else if (myDeck !== S.shownDeck) { // ohne Vorwarnung (z. B. Teleport): im Bedecken umschalten
      L.dir = Math.sign(level(myDeck) - level(S.shownDeck)) || 1; L.phase = 'out'; L.t = LIFT_RIDE * 0.5; L.hold = 0;
    }
  }
  if (L.phase === 'out') {
    L.t += dt;
    const p = Math.min(1, L.t / LIFT_RIDE);
    S.camOffY = ease(p) * L.dir * LIFT_RISE;
    setBlend(p, true, L.dir);
    if (p >= 1) { L.phase = 'hold'; L.hold = 0; }
  }
  if (L.phase === 'hold') {
    L.hold += dt;
    setBlend(1, true, L.dir);
    if (myDeck !== S.shownDeck) { S.shownDeck = myDeck; S.deckY0 = deckY0(myDeck); S.camInit = false; L.phase = 'in'; L.t = 0; }
    else if (L.hold > 4) { L.phase = 'in'; L.t = 0; L.dir = -L.dir; }   // abgebrochen
  }
  if (L.phase === 'in') {
    L.t += dt;
    const p = Math.min(1, L.t / LIFT_RIDE);
    S.camOffY = -(1 - ease(p)) * L.dir * LIFT_RISE;
    setBlend(1 - p, false, L.dir);
    if (p >= 1) { L.phase = 'idle'; S.camOffY = 0; setBlend(0); }
  }
  if (L.phase === 'idle') { S.camOffY = 0; S.shownDeck = myDeck; S.deckY0 = deckY0(myDeck); setBlend(0); }
}
function ease(p) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }

// ------------------------------------------------------------------------------------------------ Lichtpool
function assignLights() {
  const req = S.lightReq;
  const tx = S.target.x, tz = S.target.z;
  for (const r of req) r._s = (r.priority || 0) * 100 - Math.hypot((r.x || 0) - tx, (r.z || 0) - tz);
  req.sort((a, b) => b._s - a._s);
  for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
    const l = S.points[i], r = req[i];
    if (!r) { l.intensity = 0; continue; }
    l.position.set(r.x || 0, r.y != null ? r.y : 1.6, r.z || 0);
    l.color.set(r.color || '#FFC66B');
    l.intensity = r.intensity != null ? r.intensity : 3;
    l.distance = r.distance || 7;
  }
  S.lightReq = [];
}

// ------------------------------------------------------------------------------------------------ FPS-Wächter
function watchFps(dt) {
  const F = S.fps;
  F.acc += dt; F.n++;
  if (F.acc >= 1) {
    F.value = F.n / F.acc; F.acc = 0; F.n = 0;
    F.samples.push(F.value); if (F.samples.length > 10) F.samples.shift();
    if (!S.forcedQuality && S.quality === 'high' && F.samples.length >= 10) {
      const s = F.samples.slice().sort((a, b) => a - b);
      const med = (s[4] + s[5]) / 2;
      if (med < 25) { setQuality('low'); F.samples = []; S.autoLow = true; }
    }
  }
}

// ------------------------------------------------------------------------------------------------ Frame
/** Zeichnet die aktuelle Zone. Wirft bei Fehlern im Renderer selbst (boot.js zählt und schaltet ggf. auf 2D). */
export function frame(view, dt) {
  if (!S.inited) throw new Error('Renderer nicht initialisiert');
  if (S.contextLost) throw new Error('WebGL-Kontext verloren');
  dt = Math.max(0, Math.min(0.1, +dt || 1 / 60));
  const t0 = performance.now();
  S.view = view;
  const zone = zoneOf(view);
  if (zone !== S.zone) enterZone(zone);
  resize(false);
  watchFps(dt);
  updateLift(view, dt);
  updateCamera(view, dt);
  for (const l of layers) {
    const ctx = S.ctxs.get(l.id);
    if (!ctx) continue;
    const LE = S.layerErrors[l.id] || (S.layerErrors[l.id] = { inRow: 0, total: 0, disabled: false });
    if (LE.disabled) continue;
    ctx.deck = S.shownDeck; ctx.quality = S.quality; ctx.view = view; ctx.dt = dt;
    try { l.update(view, dt, ctx); LE.inRow = 0; }
    catch (e) {
      LE.inRow++; LE.total++;
      report(l.id + '.update', e);
      if (LE.inRow >= 3) { LE.disabled = true; ctx.root.visible = false; report(l.id, new Error('Layer nach 3 Fehlern in Folge abgeschaltet')); }
    }
  }
  assignLights();
  const r = S.renderer;
  r.info.reset();
  if (S.quality === 'high' && S.composer) S.composer.render(dt);
  else r.render(S.scene, S.camera);
  S.info.calls = r.info.render.calls; S.info.triangles = r.info.render.triangles;
  S.info.frameMs = performance.now() - t0;
}

// ------------------------------------------------------------------------------------------------ Projektion
const pv = new THREE.Vector3();
/** Spiel-Pixel (+ Höhe in m) → HUD-Koordinaten 640×360. Benutzt die Kamera des letzten Frames. */
export function worldToScreen(px, py, h) {
  if (!S.inited) return { x: px, y: py, behind: true };
  toWorldIn(S.zone || 'ship', px, py, pv);
  if (S.zone === 'ship') pv.z = (py - S.deckY0 * TILE) / TILE;
  pv.y = +h || 0;   // Höhe über dem Boden (m)
  pv.project(S.camera);
  return { x: (pv.x + 1) / 2 * VW, y: (1 - pv.y) / 2 * VH, behind: pv.z > 1 };
}
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
/** HUD-Koordinaten → Spiel-Pixel auf der Bodenebene des sichtbaren Decks */
export function screenToWorld(sx, sy) {
  if (!S.inited) return { x: sx, y: sy };
  ndc.set(sx / VW * 2 - 1, 1 - sy / VH * 2);
  ray.setFromCamera(ndc, S.camera);
  if (!ray.ray.intersectPlane(plane, hit)) return { x: S.target.x * TILE, y: (S.target.z + (S.zone === 'ship' ? S.deckY0 : 0)) * TILE };
  return { x: hit.x * TILE, y: (hit.z + (S.zone === 'ship' ? S.deckY0 : 0)) * TILE };
}
/** Pixel pro Meter am Boden in der Bildmitte (für Overlay-Größen) */
export function pxPerMeter() {
  const a = worldToScreen(S.target.x * TILE, (S.target.z + S.deckY0) * TILE, 0);
  const b = worldToScreen((S.target.x + 1) * TILE, (S.target.z + S.deckY0) * TILE, 0);
  return Math.abs(b.x - a.x) || 32;
}

export function shownDeck() { return S.shownDeck; }
export function currentZone() { return S.zone; }
export function liftPhase() { return S.lift.phase; }

export function info() {
  const gl = S.renderer && S.renderer.getContext();
  let rendererName = '';
  try { const ext = gl && gl.getExtension('WEBGL_debug_renderer_info'); rendererName = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch (e) { /* egal */ }
  const mem = S.renderer ? S.renderer.info.memory : {};
  return {
    fps: Math.round(S.fps.value * 10) / 10, quality: S.quality, autoLow: !!S.autoLow, calls: S.info.calls, triangles: S.info.triangles,
    frameMs: Math.round(S.info.frameMs * 100) / 100, zone: S.zone, deck: S.shownDeck, zoom: S.zoom, lift: S.lift.phase,
    layers: layers.map((l) => l.id), building: [...S.building], layerErrors: S.layerErrors, errors: S.errors,
    geometries: mem.geometries, textures: mem.textures, pixelRatio: S.PR, size: [S.W, S.H], renderer: rendererName,
  };
}
export function state() { return S; }

export function hide() { /* Canvas-Sichtbarkeit regelt boot.js */ }
