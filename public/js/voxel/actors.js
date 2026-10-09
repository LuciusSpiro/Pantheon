// Layer „actors“ (CONTRACT-M4 §3.2, §3.4) – Team ACTORS
// Spieler, Bots, Ivo/Techniker, Plünderer, Drohnen, Wächter und Gegenstände (in der Hand und am Boden) in allen Zonen.
// Pose und Gegenstand kommen aus dem Snapshot – dieselbe Ableitung wie die 2D-Figur (render.js charOpts/drawWorld).
// Robust: fehlende Figuren/Posen/Modelle → eigener Würfel-Ersatz bzw. Ersatzpose; jeder Fehler wird gezählt (ctx.countError).
import { registerLayer } from './renderer.js';

const TILE = 32;
const D2R = Math.PI / 180;
const PLAYER_COLORS = ['#56B4E9', '#E69F00', '#CC79A7', '#7FE0C2'];
const AWAY_FIGURES = ['crew/nova', 'crew/juno', 'crew/tami', 'crew/nova'];
// Spielgegenstand → Modell lerche/item/<id> (§3.4)
const ITEM_IDS = { ersatzteil: 'spare_part', loeschgel: 'extinguisher', flickblech: 'patch_plate', bolzen: 'bolts', medipack: 'medipack',
  datenkern: 'datacore', tafel: 'tablet', salvage: 'salvage', bergegut: 'salvage', wrench: 'wrench' };
// Halte-Aktion (players[].action.kind) → Pose
const ACTION_POSES = { flick: 'repair', swap: 'repair', patch: 'repair', minigame: 'minigame', extinguish: 'extinguish', revive: 'revive',
  switch: 'hold', reboot: 'hold', salvage: 'hold', hollow: 'hold', jammer: 'hold', archkey: 'hold', tablet: 'hold', beam: 'attention' };
const UPPER = ['torso', 'head', 'upperArmL', 'upperArmR', 'lowerArmL', 'lowerArmR', 'handL', 'handR'];
const SWAP = { thighL: 'thighR', thighR: 'thighL', shinL: 'shinR', shinR: 'shinL', upperArmL: 'upperArmR', upperArmR: 'upperArmL',
  lowerArmL: 'lowerArmR', lowerArmR: 'lowerArmL', handL: 'handR', handR: 'handL' };
// ---- B2 (Team VOXEL, CONTRACT-B2 §10, ART-PLAN §4.3): Germanen-Figuren, Waffen nach Fraktion, Körperzustände
const ROLLEN = { grundtyp: 1, niederhalter: 1, grenadier: 1, schuetze: 1, enterer: 1, haescher: 1 };
const ROLLE_SCALE = { enterer: 1.1 };   // Rückfall, solange die Figur noch nicht geladen ist (sonst fig.scale)
// Fraktion (= Besitz) → Waffen-Bauweise; Spieler bekommen 'rom' (Lerche)
const WAFFE_BW = { rostmeute: 'rostmeute', kontor: 'germanen', raubzug: 'germanen', germanen: 'germanen', herrenlos: 'rom', rom: 'rom', kustoden: 'neutral', konkordat: 'neutral' };
// Waffenlänge (m, ART-PLAN §2.3) – entscheidet die Ruhehaltung (lange Waffen nie durch den Boden)
const WAFFE_LEN = { pistole: 0.45, blaster: 0.7, betaeuber: 0.7, sturmgewehr: 0.95, granatwerfer: 0.8, lanze: 1.63, nahkampf: 0.9 };
// Waffen mit eigenem Namen, aber Modell einer Grundwaffe in fester Bauweise (SCHNITTSTELLEN-NACHTRAG „Transfer-Konsole“:
// schrottblaster = Blaster-Regeln für Plünderer/Rostmeute) → item/waffe/<typ> mit bauweise
const WAFFE_VARIANTE = { schrottblaster: { typ: 'blaster', bauweise: 'rostmeute' } };
const waffeTyp = (wf) => (WAFFE_VARIANTE[wf] ? WAFFE_VARIANTE[wf].typ : wf);
const WAFFE_ZIEL = { sturmgewehr: 'aim_rifle', betaeuber: 'aim_rifle', lanze: 'aim_rifle', granatwerfer: 'aim_heavy', blaster: 'aim', pistole: 'aim', nahkampf: 'guard' };
const STRIKE_T = 0.35;          // s Schlagpose nach dem Ausholen
const LIEGT = { wounded: 1, unconscious: 1 };
// Ersatz, falls eine neue Pose (ART-POSEN) in der geladenen Posen-Datei fehlt
const POSE_ALIAS = { unconscious: 'wounded', bound: 'kneel', carried: 'wounded', charge: 'kneel', stagger: 'hit', windup: 'guard', strike: 'aim',
  aim_heavy: 'aim_rifle', aim_rifle: 'aim', launch: 'aim', lift_comrade: 'revive' };
const BODEN_HOEHE_CH = { '^': 0.5, '/': 0.25 };   // optisch erhöhter Boden der Bühnen (kit.js BODEN_HOEHE, E27)
const INSTANCE_THRESHOLD = 6;   // ab mehr sichtbaren Figuren werden gleiche Teile per InstancedMesh gezeichnet (§7)
const STRIDE = 1.25;            // m pro Laufzyklus (ein Doppelschritt)

// Ersatzposen, solange ART-F sie nicht liefert (Winkel in Grad wie poses/human.json). Vorhandene Posen der Figur gehen vor.
const FALLBACK_POSES = {
  stand: { joints: { upperArmL: [2, 0, 4], upperArmR: [2, 0, -4], lowerArmL: [-8, 0, 0], lowerArmR: [-8, 0, 0] }, breathe: 0.5 },
  attention: { joints: { upperArmL: [0, 0, 2], upperArmR: [0, 0, -2] }, breathe: 0.25 },
  walk: { joints: { thighL: [-24, 0, 0], shinL: [14, 0, 0], thighR: [20, 0, 0], shinR: [26, 0, 0], upperArmL: [18, 0, 5], upperArmR: [-18, 0, -5],
    lowerArmL: [-14, 0, 0], lowerArmR: [-24, 0, 0], torso: [4, 0, 0] }, lift: -0.5, breathe: 0.2 },
  aim: { joints: { torso: [0, 18, 0], head: [0, -16, 0], upperArmR: [-86, 14, 0], lowerArmR: [-6, 0, 0], upperArmL: [-70, -38, 0], lowerArmL: [-40, 0, 0],
    thighL: [-14, 0, 0], shinL: [10, 0, 0], thighR: [10, 0, 0] }, breathe: 0.25 },
  guard: { joints: { upperArmR: [-18, 0, -6], lowerArmR: [-62, 0, 0], handR: [80, 0, 0], upperArmL: [4, 0, 6], lowerArmL: [-10, 0, 0] }, breathe: 0.35 },
  kneel: { joints: { thighR: [-88, 0, 0], shinR: [88, 0, 0], thighL: [6, 0, 0], shinL: [84, 0, 0], torso: [12, 0, 0], upperArmR: [-50, 0, 0],
    lowerArmR: [-40, 0, 0], upperArmL: [-44, 0, 0], lowerArmL: [-48, 0, 0], head: [18, 0, 0] }, lift: -6, breathe: 0.3 },
  inspect: { joints: { torso: [10, 0, 0], head: [14, 0, 0], upperArmR: [-48, 0, -6], lowerArmR: [-56, 0, 0], upperArmL: [-30, 0, 8], lowerArmL: [-70, 0, 0] }, breathe: 0.4 },
  sit: { joints: { thighL: [-86, 0, 2], thighR: [-86, 0, -2], shinL: [86, 0, 0], shinR: [86, 0, 0], torso: [6, 0, 0], head: [10, 0, 0],
    upperArmL: [-34, 0, 6], upperArmR: [-34, 0, -6], lowerArmL: [-52, 0, 0], lowerArmR: [-52, 0, 0] }, lift: -6.5, breathe: 0.4 },
  operate: { joints: { torso: [8, 0, 0], head: [12, 0, 0], upperArmL: [-52, 0, 8], upperArmR: [-52, 0, -8], lowerArmL: [-38, 0, 0], lowerArmR: [-38, 0, 0],
    thighL: [-4, 0, 0], thighR: [4, 0, 0] }, breathe: 0.3 },
  repair: { joints: { thighR: [-80, 0, 0], shinR: [84, 0, 0], thighL: [8, 0, 0], shinL: [80, 0, 0], torso: [20, 0, 0], head: [16, 0, 0],
    upperArmR: [-74, 0, -6], lowerArmR: [-34, 0, 0], upperArmL: [-58, 0, 8], lowerArmL: [-46, 0, 0] }, lift: -5.5, breathe: 0.3 },
  extinguish: { joints: { torso: [4, 10, 0], head: [6, -8, 0], upperArmR: [-62, 10, -4], lowerArmR: [-26, 0, 0], upperArmL: [-54, -26, 6], lowerArmL: [-48, 0, 0],
    thighL: [-16, 0, 0], shinL: [10, 0, 0], thighR: [12, 0, 0] }, breathe: 0.2 },
  carry: { joints: { upperArmL: [-48, 0, 6], upperArmR: [-48, 0, -6], lowerArmL: [-56, -10, 0], lowerArmR: [-56, 10, 0], torso: [-3, 0, 0] }, breathe: 0.3 },
  hold: { joints: { torso: [12, 0, 0], head: [14, 0, 0], upperArmR: [-62, 0, -6], lowerArmR: [-34, 0, 0], upperArmL: [-56, 0, 6], lowerArmL: [-40, 0, 0] }, breathe: 0.3 },
  minigame: { joints: { torso: [14, 0, 0], head: [22, 0, 0], upperArmR: [-44, 0, -10], lowerArmR: [-64, 0, 0], upperArmL: [-44, 0, 10], lowerArmL: [-64, 0, 0] }, breathe: 0.3 },
  climb: { joints: { upperArmL: [-150, 0, 4], upperArmR: [-118, 0, -4], lowerArmL: [-10, 0, 0], lowerArmR: [-26, 0, 0], thighL: [-46, 0, 0], shinL: [56, 0, 0],
    thighR: [-8, 0, 0], shinR: [14, 0, 0] }, breathe: 0.1 },
  lift_ride: { joints: { upperArmL: [0, 0, 3], upperArmR: [0, 0, -3], head: [-8, 0, 0] }, breathe: 0.25 },
  crouch: { joints: { thighR: [-70, 0, 0], shinR: [100, 0, 0], thighL: [-24, 0, 0], shinL: [96, 0, 0], torso: [16, 0, 0], head: [-8, 0, 0],
    upperArmR: [-70, 6, 0], lowerArmR: [-20, 0, 0], upperArmL: [-56, -30, 0], lowerArmL: [-42, 0, 0] }, lift: -5, breathe: 0.3 },
  // liegt auf der Seite quer zur Kamera (von oben eindeutig „liegt“; längs zur Blickrichtung sähe es aus wie stehend)
  wounded: { joints: { root: [0, 0, 84], head: [0, 0, -10], upperArmL: [-30, 0, 20], upperArmR: [-40, 0, -10], lowerArmL: [-30, 0, 0], lowerArmR: [-20, 0, 0],
    thighL: [-28, 0, 0], shinL: [40, 0, 0], thighR: [-8, 0, 0], shinR: [16, 0, 0] }, breathe: 0.6, rootLift: 0.2, look: false },
  revive: { joints: { thighR: [-84, 0, 0], shinR: [86, 0, 0], thighL: [6, 0, 0], shinL: [82, 0, 0], torso: [26, 0, 0], head: [22, 0, 0],
    upperArmR: [-60, 0, -10], lowerArmR: [-30, 0, 0], upperArmL: [-60, 0, 10], lowerArmL: [-30, 0, 0] }, lift: -6, breathe: 0.4 },
  hit: { joints: { torso: [-14, 0, 6], head: [-12, 0, 0], upperArmL: [-10, 0, 34], upperArmR: [-10, 0, -34], lowerArmL: [-30, 0, 0], lowerArmR: [-30, 0, 0] }, breathe: 0 },
  talk: { joints: { upperArmR: [-38, 0, -16], lowerArmR: [-58, 0, 0], upperArmL: [2, 0, 5], lowerArmL: [-12, 0, 0], head: [-4, 10, 0] }, breathe: 0.5 },
  arms_crossed: { joints: { upperArmL: [-22, 0, 10], lowerArmL: [-80, -70, 0], upperArmR: [-22, 0, -10], lowerArmR: [-80, 70, 0] }, breathe: 0.5 },
};

// Rig „human“ (voxelwerk assets/rigs/human.json) – für den Würfel-Ersatz, falls keine Figur geladen werden kann.
const RIG = {
  root: [null, [0, 0, 0]], hips: ['root', [0, 14, 0]], thighL: ['hips', [2, 14, 0]], shinL: ['thighL', [2, 7, 0]], thighR: ['hips', [-2, 14, 0]],
  shinR: ['thighR', [-2, 7, 0]], torso: ['hips', [0, 16, 0]], head: ['torso', [0, 25, 0]], upperArmL: ['torso', [5.5, 23, 0]],
  lowerArmL: ['upperArmL', [5.5, 17, 0]], handL: ['lowerArmL', [5.5, 12, 0.5]], upperArmR: ['torso', [-5.5, 23, 0]],
  lowerArmR: ['upperArmR', [-5.5, 17, 0]], handR: ['lowerArmR', [-5.5, 12, 0.5]], back: ['torso', [0, 20, -3]],
};
// Teile des Ersatzes: Gelenk → [Mitte (absolut, Voxel), Größe (Voxel), Farbrolle]
const FB_PARTS = {
  hips: [[0, 14.5, 0], [8, 3, 4], 'dark'], torso: [[0, 20.5, 0], [9, 9, 5], 'cloth'], head: [[0, 28, 0], [6, 6, 6], 'skin'],
  upperArmL: [[5.5, 20, 0], [3, 6, 3], 'cloth'], upperArmR: [[-5.5, 20, 0], [3, 6, 3], 'cloth'],
  lowerArmL: [[5.5, 14.5, 0], [2.6, 5, 2.6], 'skin'], lowerArmR: [[-5.5, 14.5, 0], [2.6, 5, 2.6], 'skin'],
  thighL: [[2, 10.5, 0], [3.4, 7, 3.4], 'dark'], thighR: [[-2, 10.5, 0], [3.4, 7, 3.4], 'dark'],
  shinL: [[2, 3.5, 0.5], [3.4, 7, 4], 'dark'], shinR: [[-2, 3.5, 0.5], [3.4, 7, 4], 'dark'],
};
const VX = 1 / 16;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : +v || 0);
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const DIR_YAW = { down: 0, right: Math.PI / 2, up: Math.PI, left: -Math.PI / 2 };
// Spielrichtung (x rechts, y unten) → Drehung um Y (Modell schaut nach +z)
const yawOf = (dx, dy) => Math.atan2(dx, dy);
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }

// ------------------------------------------------------------------------------------------------------------------------------
const L = {
  THREE: null, ctx: null, group: null, actors: new Map(), batcher: null, frame: 0, time: 0,
  stats: { figures: 0, models: 0, drawCalls: 0, instanced: 0, placeholders: 0, errors: 0, visible: 0 },
  fbGeo: null, fbMats: new Map(), lastZone: null, shotAt: {}, muzzles: new Map(),
};

// Fülllicht nur für Akteure (SICHTUNG-ART): gegen den Eigenschatten unter Helm und Schulterplatten.
// Eigenes Material statt eines Szenenlichts (three.js-Lichter wirken immer auf alles): etwas Grundhelligkeit + weiches Licht
// von schräg vorn oben (Kamerarichtung). Sonst wie VOXEL_MAT (aEmit-Leuchten).
const FILL = { amb: 0.08, dir: 0.2 };
let actorMat = null;
function getActorMat() {
  if (actorMat) return actorMat;
  const m = new L.THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  m.userData.fill = { amb: { value: FILL.amb }, dir: { value: FILL.dir } };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFillAmb = m.userData.fill.amb; sh.uniforms.uFillDir = m.userData.fill.dir;
    sh.vertexShader = 'attribute float aEmit;\nvarying float vEmit;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvEmit = aEmit;');
    sh.fragmentShader = 'varying float vEmit;\nuniform float uFillAmb;\nuniform float uFillDir;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n' +
      '\t{ vec3 fv = normalize(vec3(0.0, 0.55, 0.84)); totalEmissiveRadiance += diffuseColor.rgb * (uFillAmb + uFillDir * max(dot(normal, fv), 0.0)); }\n' +
      '\tif (vEmit > 0.5) { vec3 eC = diffuseColor.rgb; float eM = max(max(eC.r, eC.g), max(eC.b, 1e-3)); totalEmissiveRadiance += eC * min(1.2, 1.5 / eM); diffuseColor.rgb *= 0.0; }');
  };
  m.customProgramCacheKey = () => 'actor-fill-2';
  actorMat = m;
  return m;
}
/** Voxel-Netze eines Akteurs (Figur, Gegenstand) auf das Akteur-Material mit Fülllicht umstellen */
function useActorMat(root) {
  const base = L.ctx && L.ctx.material;
  if (!root || !base) return;
  const am = getActorMat();
  root.traverse((o) => { if (o.isMesh && o.material === base) o.material = am; });
}

function err(where, e) {
  L.stats.errors++;
  try { if (L.ctx && L.ctx.countError) L.ctx.countError('actors.' + where, e); else console.warn('[actors]', where, e); } catch (e2) { /* nie werfen */ }
}

function maps() { return window.Shared_Maps || null; }
function cfg() { return window.Shared_Config || window.CONFIG || {}; }

// ------------------------------------------------------------------------------------------------------------------------------
// Figuren-Ersatz (Würfel auf dem echten Rig) – Posen funktionieren identisch
function fbMaterial(hex) {
  let m = L.fbMats.get(hex);
  if (!m) { m = new L.THREE.MeshStandardMaterial({ color: hex, roughness: 0.9 }); L.fbMats.set(hex, m); }
  return m;
}
function fallbackFigure(kind, color) {
  const T = L.THREE;
  if (!L.fbGeo) L.fbGeo = new T.BoxGeometry(1, 1, 1);
  const pal = {
    crew: { cloth: color || '#56B4E9', skin: '#D9A77E', dark: '#2E3A4A' },
    away: { cloth: color || '#56B4E9', skin: '#B9C2CC', dark: '#3A4656' },
    ivo: { cloth: '#A9D6E5', skin: '#C98F6A', dark: '#40464F' },
    scav: { cloth: '#8A4B2E', skin: '#5A3B2A', dark: '#3B2A22' },
  }[kind] || { cloth: color || '#888888', skin: '#D9A77E', dark: '#333333' };
  const root = new T.Group(); root.name = 'fallback:' + kind;
  const joints = {};
  for (const name of Object.keys(RIG)) {
    const [parent, at] = RIG[name];
    const g = new T.Group(); g.name = name;
    const pa = parent ? RIG[parent][1] : [0, 0, 0];
    g.position.set((at[0] - pa[0]) * VX, (at[1] - pa[1]) * VX, (at[2] - pa[2]) * VX);
    g.userData.rest = g.position.clone();
    (parent ? joints[parent] : root).add(g);
    joints[name] = g;
  }
  for (const [jn, [c, s, role]] of Object.entries(FB_PARTS)) {
    const at = RIG[jn][1];
    const m = new T.Mesh(L.fbGeo, fbMaterial(pal[role]));
    m.scale.set(s[0] * VX, s[1] * VX, s[2] * VX);
    m.position.set((c[0] - at[0]) * VX, (c[1] - at[1]) * VX, (c[2] - at[2]) * VX);
    m.castShadow = true;
    joints[jn].add(m);
  }
  // Gesicht/Visier: zeigt die Blickrichtung auch von oben
  const visor = new T.Mesh(L.fbGeo, fbMaterial(kind === 'scav' ? '#E0473C' : '#0B0E1A'));
  visor.scale.set(4 * VX, 1.5 * VX, 1 * VX); visor.position.set(0, 3.4 * VX, 3.2 * VX);
  joints.head.add(visor);
  return { root, joints, poses: null, placeholder: true, fallback: true };
}
function fallbackModel(kind) {
  const T = L.THREE;
  if (!L.fbGeo) L.fbGeo = new T.BoxGeometry(1, 1, 1);
  const g = new T.Group(); g.name = 'fallback:' + kind; g.userData.placeholder = true;
  const box = (w, h, d, x, y, z, col) => { const m = new T.Mesh(L.fbGeo, fbMaterial(col)); m.scale.set(w, h, d); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  if (kind === 'bot') { box(0.5, 0.35, 0.5, 0, 0.3, 0, '#B08D57'); box(0.3, 0.12, 0.08, 0, 0.42, 0.26, '#7FE0C2'); box(0.12, 0.25, 0.12, 0, 0.6, 0, '#5A5F6A'); }
  else if (kind === 'drone') { box(0.5, 0.22, 0.5, 0, 0, 0, '#5A5F6A'); box(0.18, 0.1, 0.1, 0, 0, 0.28, '#E0473C'); }
  else if (kind === 'warden') { box(1.4, 1.1, 1.8, 0, 0.75, 0, '#4B3F6B'); box(0.9, 0.6, 0.5, 0, 1.4, 0.8, '#B57CFF'); box(1.2, 0.2, 0.3, 0, 0.3, 1.0, '#7FF3FF'); }
  else box(0.22, 0.22, 0.22, 0, 0.11, 0, '#F2C94C');
  return g;
}

// ------------------------------------------------------------------------------------------------------------------------------
// Lader-Zugriff (CORE): figure(id, opts) → { root, joints, pose }, object(id, params, opts) → Object3D, manifest(id)
function isPlaceholder(o) {
  if (!o) return false;
  if (o.placeholder) return true;
  if (o.userData && (o.userData.placeholder || o.userData.fallback)) return true;
  if (o.userData && o.userData.slot) return !o.userData.slot.ready;
  return false;
}

// CORE-Lader: figure() liefert sofort { root, joints:{}, ready:false, loaded:Promise } mit Platzhaltersäule.
// Solange die Figur nicht bereit ist, steht unser posierbarer Würfel-Ersatz da; danach wird getauscht.
function loadFigure(figId, opts, fbKind, color, onLate) {
  const ld = L.ctx && L.ctx.loader;
  let f = null;
  try { if (ld && typeof ld.figure === 'function') f = ld.figure(figId, opts); } catch (e) { err('figure:' + figId, e); f = null; }
  if (f && typeof f.then === 'function') {
    f.then((r) => { if (r && r.root) onLate(r); }).catch((e) => err('figure:' + figId, e));
    f = null;
  }
  if (f && f.root && f.ready === false) {
    const late = f;
    if (late.loaded && late.loaded.then) late.loaded.then((ok) => { if (ok && late.ready) onLate(normFigure(late, figId)); }).catch((e) => err('figure:' + figId, e));
    f = null;
  }
  if (!f || !f.root) return fallbackFigure(fbKind, color);
  return normFigure(f, figId);
}
function normFigure(f, figId) {
  if (!f.joints || !Object.keys(f.joints).length) f.joints = collectJoints(f.root);
  if (!f.poses) f.poses = (f.inner && f.inner.poses) || posesFromLoader(L.ctx && L.ctx.loader, figId);
  if (!f.skinned) { try { skinFigure(f); } catch (e) { err('skin:' + figId, e); } }
  return f;
}

// Starre Hautbindung: alle Teile einer Figur → ein SkinnedMesh (Gelenke = Knochen). Aus ~11 Draw Calls je Figur wird einer.
// Nur, wenn alle Teile dasselbe Material und dieselben Attribute haben (CORE: VOXEL_MAT mit aEmit); sonst bleibt alles, wie es ist.
function skinFigure(f) {
  const T = L.THREE;
  const names = Object.keys(f.joints || {});
  if (!names.length) return;
  for (const n of names) { const o = f.joints[n]; if (!o.userData.rest) o.userData.rest = o.position.clone(); o.rotation.set(0, 0, 0); o.position.copy(o.userData.rest); }
  f.root.updateMatrixWorld(true);
  const boneIndex = new Map(names.map((n, i) => [f.joints[n], i]));
  const parts = []; let mat = null, attrs = null;
  f.root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh) return;
    let j = o.parent; while (j && !boneIndex.has(j)) j = j.parent;
    if (!j) return;
    parts.push({ o, bone: boneIndex.get(j) });
  });
  if (parts.length < 2) return;
  for (const p of parts) {
    const m = p.o.material;
    if (Array.isArray(m) || (mat && m !== mat)) return;
    mat = m;
    const a = Object.keys(p.o.geometry.attributes).sort().join(',');
    if (attrs && a !== attrs) return;
    attrs = a;
  }
  const rootInv = new T.Matrix4().copy(f.root.matrixWorld).invert();
  const keys = attrs.split(',');
  let nv = 0, ni = 0;
  for (const p of parts) { const g = p.o.geometry; nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const out = {}; for (const k of keys) out[k] = new Float32Array(nv * p0Size(parts[0].o.geometry, k));
  const skinI = new Uint16Array(nv * 4), skinW = new Float32Array(nv * 4);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const m4 = new T.Matrix4(), n3 = new T.Matrix3(), v = new T.Vector3();
  let ov = 0, oi = 0;
  for (const p of parts) {
    const g = p.o.geometry, n = g.attributes.position.count;
    m4.multiplyMatrices(rootInv, p.o.matrixWorld); n3.getNormalMatrix(m4);
    for (const k of keys) {
      const src = g.attributes[k], sz = src.itemSize, dst = out[k];
      for (let i = 0; i < n; i++) {
        if (k === 'position') { v.fromBufferAttribute(src, i).applyMatrix4(m4); dst[(ov + i) * 3] = v.x; dst[(ov + i) * 3 + 1] = v.y; dst[(ov + i) * 3 + 2] = v.z; }
        else if (k === 'normal') { v.fromBufferAttribute(src, i).applyMatrix3(n3).normalize(); dst[(ov + i) * 3] = v.x; dst[(ov + i) * 3 + 1] = v.y; dst[(ov + i) * 3 + 2] = v.z; }
        else for (let c = 0; c < sz; c++) dst[(ov + i) * sz + c] = src.array[i * sz + c];
      }
    }
    for (let i = 0; i < n; i++) { skinI[(ov + i) * 4] = p.bone; skinW[(ov + i) * 4] = 1; }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[oi + i] = g.index.array[i] + ov;
    else for (let i = 0; i < n; i++) idx[oi + i] = ov + i;
    oi += g.index ? g.index.count : n; ov += n;
  }
  const geo = new T.BufferGeometry();
  for (const k of keys) geo.setAttribute(k, new T.BufferAttribute(out[k], p0Size(parts[0].o.geometry, k)));
  geo.setAttribute('skinIndex', new T.Uint16BufferAttribute(skinI, 4));
  geo.setAttribute('skinWeight', new T.Float32BufferAttribute(skinW, 4));
  geo.setIndex(new T.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  const sm = new T.SkinnedMesh(geo, mat);
  sm.castShadow = true; sm.receiveShadow = true; sm.frustumCulled = false; sm.name = 'skin';
  f.root.add(sm);
  f.root.updateMatrixWorld(true);
  sm.bind(new T.Skeleton(names.map((n) => f.joints[n])), sm.matrixWorld);
  for (const p of parts) { p.o.parent.remove(p.o); }
  f.skinned = sm;
}
function p0Size(g, k) { return g.attributes[k].itemSize; }
function collectJoints(root) {
  const j = {};
  root.traverse((o) => { if (RIG[o.name] && !j[o.name]) j[o.name] = o; });
  return j;
}
function posesFromLoader(ld, figId) {
  try {
    if (ld && typeof ld.poses === 'function') { const p = ld.poses('human'); if (p) return p.poses || p; }
    const lib = ld && (ld.library || ld.lib);
    if (lib && lib.get) {
      const fig = lib.get('figures', figId); const rig = fig && lib.get('rigs', fig.rig);
      const p = lib.get('poses', (rig && rig.poses) || 'human');
      if (p) return p.poses || null;
    }
  } catch (e) { err('poses', e); }
  return null;
}
// CORE-Lader: object() liefert sofort eine Group (userData.ready false = Platzhalter, wird nach dem Laden gefüllt).
// Wir zeigen bis dahin bzw. bei fehlendem Asset unseren kleinen Ersatz (Gegenstände sonst als 0,8-m-Kiste in der Hand).
function loadModel(id, params, fbKind, palette) {
  const ld = L.ctx && L.ctx.loader;
  let o = null;
  try { if (ld && typeof ld.object === 'function') o = ld.object(id, params || {}, palette ? { palette } : {}); } catch (e) { err('object:' + id, e); o = null; }
  if (o && typeof o.then === 'function') o = null;
  const slot = new L.THREE.Group(); slot.name = 'slot:' + id;
  const fb = fallbackModel(fbKind); fb.userData.fallback = true;
  slot.add(fb);
  const s = { obj: null, fb, ready: false, id };
  slot.userData.slot = s;
  if (o && o.isObject3D) { s.obj = o; slot.add(o); }
  refreshSlot(slot);
  return slot;
}
function refreshSlot(slot) {
  const s = slot.userData.slot; if (!s) return;
  const ready = !!(s.obj && s.obj.userData.ready !== false);
  s.ready = ready;
  if (s.obj) { s.obj.visible = ready; if (ready && !s.matSet) { useActorMat(s.obj); s.matSet = true; } }
  s.fb.visible = !ready;
}

// ------------------------------------------------------------------------------------------------------------------------------
// Akteure
class Actor {
  constructor(key) {
    this.key = key; this.container = new L.THREE.Group(); this.container.name = 'actor:' + key;
    this.body = new L.THREE.Group(); this.container.add(this.body);
    this.fig = null; this.figId = null; this.model = null; this.modelKey = null; this.models = {};
    this.cur = {}; this.yaw = null; this.phase = Math.random() * 6; this.lastPos = null; this.speed = 0;
    this.item = null; this.itemKey = null; this.seen = 0; this.retryAt = 0; this.retries = 0;
    this.deck = null; this.lift = null; this.arrive = null; this.prevAlive = true; this.role = null;
    L.group.add(this.container);
  }
  setFigure(figId, opts, fbKind, color) {
    // Einmal je Figur-ID laden; die echte Figur ersetzt den Ersatz, sobald der Lader sie fertig hat (Promise).
    // Schlüssel inkl. Palette/Parameter (Besitz-Palette per palette-Override, CONTRACT-B2 §10)
    const key = figId + '|' + ((opts && opts.palette) || '') + '|' + JSON.stringify((opts && opts.params) || {});
    if (this.figKey === key && this.fig) return;
    this.figId = figId; this.figKey = key;
    const f = loadFigure(figId, opts, fbKind, color, (late) => { if (this.figKey === key) this.attachFigure(late); });
    this.attachFigure(f);
  }
  /** Größe der Figur (Figurenbaukasten: fig.scale, z. B. Enterer 1,1) */
  figScale() {
    try { const lib = L.ctx.loader && L.ctx.loader.lib; const fd = lib && lib.get('figures', L.ctx.loader.src(this.figId)); if (fd && fd.scale) return +fd.scale; } catch (e) { /* egal */ }
    return this.rolle && ROLLE_SCALE[this.rolle] || 1;
  }
  attachFigure(f) {
    if (this.fig && this.fig.root) this.body.remove(this.fig.root);
    if (!f.joints) f.joints = collectJoints(f.root);
    if (!f.poses) f.poses = posesFromLoader(L.ctx && L.ctx.loader, this.figId);
    for (const o of Object.values(f.joints)) if (!o.userData.rest) o.userData.rest = o.position.clone();
    if (this.fig && this.fig.skinned && this.fig !== f) this.fig.skinned.geometry.dispose();
    this.fig = f; this.cur = {};
    this.body.add(f.root);
    useActorMat(f.root);
    if (this.item) { this.item.parent && this.item.parent.remove(this.item); this.item = null; this.itemKey = null; }
  }
  setModel(id, params, fbKind) {
    const mk = id + JSON.stringify(params || {});
    if (this.modelKey !== mk) {
      let o = this.models[mk];
      if (!o) { o = loadModel(id, params, fbKind); this.models[mk] = o; }
      if (this.model && this.model !== o) this.body.remove(this.model);
      if (this.model !== o) this.body.add(o);
      this.model = o; this.modelKey = mk;
    }
    refreshSlot(this.model);
  }
  // Gegenstand in der Hand (handR) bzw. auf dem Bot
  // itemKind: Spielgegenstand (lerche/item/<id>) oder volle Modell-ID (z. B. item/waffe/lanze); params/palette für Waffen (B2)
  setItem(itemKind, anchor, params, palette) {
    const k = itemKind && anchor ? itemKind + '@' + anchor.uuid + JSON.stringify(params || {}) + (palette || '') : null;
    if (k !== this.itemKey) {
      if (this.item && this.item.parent) this.item.parent.remove(this.item);
      this.item = null; this.itemKey = k;
      if (k) {
        const id = itemKind.indexOf('/') >= 0 ? itemKind : 'lerche/item/' + (ITEM_IDS[itemKind] || itemKind);
        this.item = loadModel(id, params || {}, 'item', palette);
        this.item.userData.itemId = id;
        anchor.add(this.item);
      }
    }
    if (this.item) refreshSlot(this.item);
  }
  // Zusatzteil (Fessel) frei am Körper
  setExtra(id, params, on) {
    if (!on) { if (this.extra) this.extra.visible = false; return null; }
    const key = id + JSON.stringify(params || {});
    if (this.extraKey !== key) {
      if (this.extra && this.extra.parent) this.extra.parent.remove(this.extra);
      this.extra = loadModel(id, params || {}, 'item'); this.extraKey = key;
      this.body.add(this.extra);
    }
    this.extra.visible = true;
    refreshSlot(this.extra);
    return this.extra;
  }
  dispose() { if (this.container.parent) this.container.parent.remove(this.container); if (this.fig && this.fig.skinned) this.fig.skinned.geometry.dispose(); }
}

function actor(key) {
  let a = L.actors.get(key);
  if (!a) { a = new Actor(key); L.actors.set(key, a); }
  a.seen = L.frame;
  a.container.visible = true;
  return a;
}

// ------------------------------------------------------------------------------------------------------------------------------
// Posen
function poseOf(fig, name) {
  const p = fig && fig.poses;
  for (let n = name, i = 0; n && i < 4; n = POSE_ALIAS[n], i++) {
    const hit = (p && p[n]) || FALLBACK_POSES[n];
    if (hit) return hit;
  }
  return (p && p.stand) || FALLBACK_POSES.stand;
}
const TMP = {};
function mirrorVal(j, src) {
  const o = src[SWAP[j] || j];
  if (!o) return null;
  return [o[0], -o[1], -o[2]];
}
/**
 * Zielwinkel berechnen und weich überblenden.
 * st = { base, upper, walk (0..1 Gewicht), phase, t, special }
 */
function pose(a, st, dt) {
  const f = a.fig; if (!f || !f.joints) return;
  const joints = f.joints;
  const base = poseOf(f, st.base);
  a.poseNow = { base: st.base, upper: st.upper || null };
  const tgt = TMP; for (const k in tgt) delete tgt[k];
  let lift = base.lift || 0, breathe = base.breathe != null ? base.breathe : 0.5, rootLift = base.rootLift || 0;
  for (const [j, r] of Object.entries(base.joints || {})) tgt[j] = [r[0], r[1], r[2]];
  const t = st.t;
  // ART-F-Zyklus der Grundpose (φ = Zeit·hz)
  const baseCyc = base.cycle && base.cycle.joints ? base.cycle : null;
  if (baseCyc && st.base !== 'walk') applyCycle(tgt, baseCyc, t * (baseCyc.hz || 1), null);
  if (st.walk > 0 && poseOf(f, 'walk').cycle && poseOf(f, 'walk').cycle.joints) {
    // ART-F-Laufzyklus: φ = Laufweg / stride, Hüfte += bob·(0,5 − |sin 2πφ|)
    const wp = poseOf(f, 'walk'), cyc = wp.cycle;
    const phi = (a.dist || 0) / (cyc.stride || 1.5);
    const wt = {}; for (const [j, r] of Object.entries(wp.joints || {})) wt[j] = [r[0], r[1], r[2]];
    applyCycle(wt, cyc, phi, null);
    for (const j of Object.keys(wt)) {
      const v = wt[j], o = tgt[j] || [0, 0, 0];
      tgt[j] = [o[0] + (v[0] - o[0]) * st.walk, o[1] + (v[1] - o[1]) * st.walk, o[2] + (v[2] - o[2]) * st.walk];
    }
    const wl = (wp.lift || 0) + (cyc.bob || 0) * (0.5 - Math.abs(Math.sin(2 * Math.PI * phi)));
    lift = lift * (1 - st.walk) + wl * st.walk;
    breathe *= 1 - st.walk * 0.6;
  } else if (st.walk > 0) {
    const wp = poseOf(f, 'walk'); const wj = wp.joints || {};
    const w = (1 + Math.sin(st.phase)) / 2;
    const names = new Set([...Object.keys(wj), ...Object.keys(SWAP)]);
    for (const j of names) {
      const A = wj[j] || [0, 0, 0], B = mirrorVal(j, wj) || [0, 0, 0];
      const v = [A[0] + (B[0] - A[0]) * w, A[1] + (B[1] - A[1]) * w, A[2] + (B[2] - A[2]) * w];
      const o = tgt[j] || [0, 0, 0];
      tgt[j] = [o[0] + (v[0] - o[0]) * st.walk, o[1] + (v[1] - o[1]) * st.walk, o[2] + (v[2] - o[2]) * st.walk];
    }
    lift = lift * (1 - st.walk) + ((wp.lift || 0) + Math.abs(Math.cos(st.phase)) * 0.7 - 0.35) * st.walk;
    breathe *= 1 - st.walk * 0.6;
  }
  if (st.upper) {
    const upP = poseOf(f, st.upper), up = upP.joints || {};
    for (const j of UPPER) tgt[j] = up[j] ? [up[j][0], up[j][1], up[j][2]] : (st.walk > 0 && (j === 'torso') ? tgt[j] : [0, 0, 0]);
    if (upP.cycle && upP.cycle.joints) applyCycle(tgt, upP.cycle, t * (upP.cycle.hz || 1), UPPER);
  }
  // Bewegung innerhalb der Pose: nur, wenn ART-F für die Pose keinen Zyklus liefert
  if (!baseCyc) poseExtras(tgt, st, a, t);
  // Atmen + Blick
  const br = Math.sin(t * 2 + a.phase) * breathe;
  if (tgt.torso) tgt.torso[0] += br * 0.7; else tgt.torso = [br * 0.7, 0, 0];
  if (base.look !== false && !st.upper && st.walk < 0.5) { const h = tgt.head || (tgt.head = [0, 0, 0]); h[1] += Math.sin(t * 0.45 + a.phase * 2) * 7; }
  blendApply(a, tgt, lift, rootLift, br, st, dt);
}
// cycle = { hz, stride?, bob?, joints: { j: { c, a, p (Grad), k? } } } → Winkel = c + a·sin(2π·φ·k + p)
function applyCycle(tgt, cyc, phi, only) {
  for (const [j, c] of Object.entries(cyc.joints)) {
    if (only && !only.includes(j)) continue;
    const s = Math.sin(2 * Math.PI * phi * (c.k || 1) + (c.p || 0) * D2R);
    const C = c.c || [0, 0, 0], A = c.a || [0, 0, 0];
    tgt[j] = [C[0] + A[0] * s, C[1] + A[1] * s, C[2] + A[2] * s];
  }
}
function poseExtras(tgt, st, a, t) {
  if (st.special === 'repair' && tgt.lowerArmR) tgt.lowerArmR[0] += Math.sin(t * 13 + a.phase) * 16;
  if (st.special === 'minigame' && tgt.lowerArmL) { tgt.lowerArmL[0] += Math.sin(t * 9) * 8; tgt.lowerArmR[0] += Math.cos(t * 9) * 8; }
  if (st.special === 'extinguish' && tgt.torso) tgt.torso[1] += Math.sin(t * 2.6 + a.phase) * 12;
  if (st.special === 'climb') {
    const c = Math.sin(t * 7);
    if (tgt.upperArmL) tgt.upperArmL[0] += c * 20; if (tgt.upperArmR) tgt.upperArmR[0] -= c * 20;
    if (tgt.thighL) tgt.thighL[0] -= c * 22; if (tgt.thighR) tgt.thighR[0] += c * 22;
  }
  if (st.special === 'operate' && tgt.lowerArmR) tgt.lowerArmR[0] += Math.sin(t * 5 + a.phase) * 6;
  if (st.special === 'hold' && tgt.lowerArmR) tgt.lowerArmR[0] += Math.sin(t * 8) * 5;
}
// Überblenden und auf die Gelenke schreiben
function blendApply(a, tgt, lift, rootLift, br, st, dt) {
  const joints = a.fig.joints;
  const k = 1 - Math.exp(-dt * (st.walk > 0 ? 22 : 12));
  const cur = a.cur;
  for (const j of Object.keys(joints)) {
    const g = tgt[j] || [0, 0, 0];
    const c = cur[j] || (cur[j] = [g[0], g[1], g[2]]);
    c[0] += (g[0] - c[0]) * k; c[1] += (g[1] - c[1]) * k; c[2] += (g[2] - c[2]) * k;
    const o = joints[j];
    o.rotation.set(c[0] * D2R, c[1] * D2R, c[2] * D2R, 'YXZ');
    if (o.userData.rest) o.position.copy(o.userData.rest);
  }
  a.curLift = (a.curLift == null ? lift : a.curLift + (lift - a.curLift) * k);
  a.curRootLift = (a.curRootLift == null ? rootLift : a.curRootLift + (rootLift - a.curRootLift) * k);
  if (joints.hips) joints.hips.position.y += (a.curLift + br * 0.25) * VX;
  if (joints.root) joints.root.position.y += a.curRootLift;
}

// Laufen: Phase aus der echten Strecke, Drehen weich in 8 Richtungen
function locomote(a, wx, wz, dt, wantYaw, moving) {
  let d = 0;
  if (a.lastPos) {
    const dx = wx - a.lastPos.x, dz = wz - a.lastPos.z;
    d = Math.hypot(dx, dz);
    if (d > 2) d = 0;   // Teleport (Lift, Beamen, Leiter) – kein Laufschritt
    else if (d > 0.004 && moving !== false) {
      const y = Math.atan2(dx, dz);
      wantYaw = Math.round(y / (Math.PI / 4)) * (Math.PI / 4);
    }
  }
  a.lastPos = { x: wx, z: wz };
  const sp = dt > 0 ? d / dt : 0;
  a.speed += (sp - a.speed) * (1 - Math.exp(-dt * 10));
  a.phase += d * (Math.PI * 2) / STRIDE;
  a.dist = (a.dist || 0) + d;
  if (wantYaw != null) {
    if (a.yaw == null) a.yaw = wantYaw;
    a.yaw += angDiff(a.yaw, wantYaw) * (1 - Math.exp(-dt * 12));
  }
  a.container.rotation.y = a.yaw || 0;
  return a.speed > 0.25 || moving === true ? clamp01(a.speed / 1.2 + (moving ? 0.6 : 0)) : 0;
}

// ------------------------------------------------------------------------------------------------------------------------------
// Ausrichtung zu einem Ziel (Konsole, Station, Feuer …)
function tileOf(px, py) { return { x: Math.floor(px / TILE), y: Math.floor(py / TILE) }; }
function faceToward(p, test) {
  const m = L.ctx.map; if (!m) return null;
  const t = tileOf(p.x, p.y);
  let best = null, bd = 1e9;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    if (!test(t.x + dx, t.y + dy, m)) continue;
    const cx = (t.x + dx) * TILE + 16, cy = (t.y + dy) * TILE + 16;
    const d = Math.hypot(cx - p.x, cy - p.y);
    if (d < bd) { bd = d; best = yawOf(cx - p.x, cy - p.y); }
  }
  return best;
}
function legendInfo(m, x, y) { try { return m.info ? m.info(x, y) : null; } catch (e) { return null; } }
function targetYaw(p, st) {
  const m = L.ctx.map; if (!m) return null;
  if (p.console) return faceToward(p, (x, y) => { const i = legendInfo(m, x, y); return !!(i && i.console === p.console); });
  const a = p.action; if (!a) return null;
  if (a.kind === 'extinguish') { const fires = (st.ship && st.ship.fires) || []; return faceToward(p, (x, y) => fires.some((f) => f[0] === x && f[1] === y)); }
  if (a.kind === 'patch') { const br = (st.ship && st.ship.breaches) || []; return faceToward(p, (x, y) => br.some((b) => b.tx === x && b.ty === y)); }
  if (a.system) return faceToward(p, (x, y) => { const i = legendInfo(m, x, y); return !!(i && i.system === a.system); });
  if (a.kind === 'switch') return faceToward(p, (x, y) => { const i = legendInfo(m, x, y); return !!(i && i.interact === 'switch'); });
  if (a.kind === 'revive') {
    const o = (st.players || []).find((q) => q.id !== p.id && q.downed && q.zone === p.zone && Math.hypot(q.x - p.x, q.y - p.y) < 56);
    if (o) return yawOf(o.x - p.x, o.y - p.y);
  }
  return null;
}

// ------------------------------------------------------------------------------------------------------------------------------
// Sichtbarkeit nach Zone/Deck
function zoneOfCtx() { return L.ctx.zone || 'ship'; }
// Schiff und Bühnen mit Decks (Schiffskarte, B1): nur das Deck der eigenen Figur zeigen
function isDecked() { const c = L.ctx; return zoneOfCtx() === 'ship' || !!(c && typeof c.decked === 'function' && c.decked()); }
function deckOfPxCtx(py) {
  if (zoneOfCtx() === 'ship') { const M = maps(); if (M && M.deckOfPx) return M.deckOfPx(py); }
  return L.ctx && typeof L.ctx.deckOf === 'function' ? L.ctx.deckOf(py) : 0;
}
function onVisibleDeck(py) {
  if (!isDecked()) return true;
  const d = deckOfPxCtx(py);
  return L.ctx.deck == null || d === L.ctx.deck || d < 0;
}
// Bühnen: Plateau 0,5 m / Rampe 0,25 m nur optisch erhöht (E27) – Figuren stehen sichtbar oben
function bodenHoehe(px, py) {
  if (zoneOfCtx() !== 'buehne') return 0;
  const m = L.ctx.map; if (!m || typeof m.at !== 'function') return 0;
  return BODEN_HOEHE_CH[m.at(Math.floor(px / TILE), Math.floor(py / TILE))] || 0;
}
function place(a, px, py, yOff) {
  const v = L.ctx.toWorld(px, py);
  a.container.position.set(v.x, (v.y || 0) + (yOff || 0) + bodenHoehe(px, py), v.z);
  return v;
}
function deckOfPlayer(p) {
  if (p.deck != null) return p.deck;
  return deckOfPxCtx(p.y);
}

// ------------------------------------------------------------------------------------------------------------------------------
// Spieler
// ------------------------------------------------------------------------------------------------------------------------------
// B2: Körperzustand (zs), Waffenaktion (ch/wu/bt) und Waffe – gleiche Regeln für Spieler und Gegner (CONTRACT-B2 §8, §10)
/** → { base, upper, lie, waffe: 'hand'|'boden'|'keine', fessel, ziel } */
function kampfZustand(a, e, t, aiming, isPlayer) {
  const zs = e.zs || (e.downed ? 'verwundet' : e.alive === false ? 'aus' : 'ok');
  const o = { base: null, upper: null, lie: false, waffe: 'hand', fessel: false, ziel: false, zs };
  // Ausholen → Schlag: Ende des Ausholens (wu fällt auf 0) zeigt STRIKE_T s die Schlagpose
  const wu = +e.wu || 0;
  if (wu > 0) a.wuAt = t; else if (a.wuAt != null && t - a.wuAt < 0.2) { a.strikeAt = t; a.wuAt = null; }
  if (zs === 'verwundet') { o.base = 'wounded'; o.lie = true; o.waffe = isPlayer ? 'keine' : 'boden'; return o; }
  if (zs === 'bewusstlos') { o.base = 'unconscious'; o.lie = true; o.waffe = 'boden'; return o; }
  if (zs === 'aus') { o.base = 'wounded'; o.lie = true; o.waffe = 'boden'; return o; }
  if (zs === 'gefesselt') { o.base = 'bound'; o.waffe = 'keine'; o.fessel = true; return o; }
  if (zs === 'gefangen') { o.waffe = 'keine'; return o; }
  if (e.bt) { o.base = 'stagger'; return o; }
  if ((+e.ch || 0) > 0) { o.base = 'charge'; o.ziel = true; return o; }
  if (wu > 0) { o.base = 'windup'; o.ziel = true; return o; }
  if (a.strikeAt != null && t - a.strikeAt < STRIKE_T) { o.base = 'strike'; o.ziel = true; return o; }
  if (aiming) { o.upper = WAFFE_ZIEL[waffeTyp(e.wf)] || 'aim'; o.ziel = true; }
  return o;
}
// Besitz-Palette erst verwenden, wenn sie geladen ist (sonst bricht der Bau mit „Palette nicht gefunden“); bis dahin Standardpalette
const palLaden = new Set();
function palReady(pal) {
  if (!pal) return null;
  const lib = L.ctx && L.ctx.loader && L.ctx.loader.lib;
  if (!lib) return null;
  if (lib.get('palettes', pal)) return pal;
  if (!palLaden.has(pal)) { palLaden.add(pal); lib.load('palettes', pal).catch(() => null); }
  return null;
}
function heatStufe(e) { if (e.ov) return 3; const h = +e.ht || 0; return h >= 75 ? 3 : h >= 50 ? 2 : h >= 25 ? 1 : 0; }
/** Waffe item/waffe/<typ> an handR, am Boden neben der Figur oder keine. Ruhehaltung: lange Waffen nie durch den Boden. */
function applyWaffe(a, wf, bauweise, heat, palette, ks) {
  const hand = a.fig && a.fig.joints && a.fig.joints.handR;
  if (!wf || wf === 'faust' || ks.waffe === 'keine' || !hand) { a.setItem(null, null); return; }
  const vari = WAFFE_VARIANTE[wf];
  if (vari) { wf = vari.typ; bauweise = vari.bauweise; }
  const id = 'item/waffe/' + wf;
  const params = { bauweise, heat: heat | 0 };
  if (ks.waffe === 'boden') {
    if (!a.groundAnchor) { a.groundAnchor = new L.THREE.Group(); a.groundAnchor.name = 'waffe-boden'; a.container.add(a.groundAnchor); }
    // liegt flach neben dem Körper (quer zur Liegerichtung), Griff zur Hand
    a.groundAnchor.position.set(0.55, 0.16, 0.15); a.groundAnchor.rotation.set(0, 0.4, Math.PI / 2);
    a.setItem(id, a.groundAnchor, params, palette);
    if (a.item) a.item.rotation.set(0, 0, 0);
    return;
  }
  a.setItem(id, hand, params, palette);
  if (!a.item) return;
  // ART-POSEN: pose.itemOffset[modell] (Voxel im Handgelenk-System) – z. B. rest_upright stellt die Lanze mit dem Fuß auf den Boden.
  // Die Pose dreht die Hand selbst; das Modell bleibt dann ungedreht. In allen anderen Posen ist der Versatz 0.
  const off = poseItemOffset(a, id);
  if (off) {
    const s = (a.fig && a.fig.inner && a.fig.inner.s) || VX;
    a.item.position.set(off[0] * s, off[1] * s, off[2] * s); a.item.rotation.set(0, 0, 0);
    return;
  }
  a.item.position.set(0, 0, 0);
  const len = WAFFE_LEN[wf] || 0.7;
  if (ks.ziel) a.item.rotation.set(0, 0, 0);
  else if (wf === 'lanze') a.item.rotation.set(Math.PI, 0, 0);        // ohne rest_upright: Lanze aufrecht wie ein Stab
  else if (len > 0.72) a.item.rotation.set(-1.2, 0, 0);                // lange Waffen schräg nach vorn (Mündung ~0,4 m über dem Boden)
  else a.item.rotation.set(0, 0, 0);
}
/** itemOffset der aktuell gezeigten Pose (Oberkörper vor Grundpose) für ein Modell, sonst null */
function poseItemOffset(a, modelId) {
  const now = a.poseNow; if (!now || !a.fig) return null;
  for (const n of [now.upper, now.base]) {
    if (!n) continue;
    const p = a.fig.poses && a.fig.poses[n];   // nur echte ART-Posen tragen itemOffset
    if (p && p.itemOffset && p.itemOffset[modelId]) return p.itemOffset[modelId];
  }
  return null;
}
/** Ruhepose je Waffe/Rolle (OFFEN-STUDIO): Jäger bzw. lange Stangenwaffe → rest_upright, Berserker → guard_hunched */
function ruhePose(a, wf, rolle) {
  const ps = a.fig && a.fig.poses;
  if (rolle === 'enterer' && ps && ps.guard_hunched) return 'guard_hunched';
  if ((wf === 'lanze' || (rolle === 'schuetze' && wf === 'lanze')) && ps && ps.rest_upright) return 'rest_upright';
  return null;
}
/** Fessel (item/fessel) zwischen den Händen (Socket wrists ≈ Hände, Pose bound) */
function applyFessel(a, on) {
  const ex = a.setExtra('item/fessel', { aktiv: 1 }, on);
  if (!on || !ex || !a.fig || !a.fig.joints) return;
  const hl = a.fig.joints.handL, hr = a.fig.joints.handR;
  if (!hl || !hr) return;
  a.container.updateMatrixWorld(true);
  const p1 = hl.getWorldPosition(new L.THREE.Vector3()), p2 = hr.getWorldPosition(new L.THREE.Vector3());
  const mid = p1.add(p2).multiplyScalar(0.5);
  ex.position.copy(a.body.worldToLocal(mid));
}
// Getragene Figur (Pose carried): Träger = Spieler, dessen carry auf die ID zeigt
function carrierOf(id) { return L.carriedBy ? L.carriedBy.get(String(id)) || null : null; }
function applyCarried(a, carrier, dt, t) {
  const ca = L.actors.get('p:' + carrier.id);
  place(a, carrier.x, carrier.y, 0);
  a.yaw = ca && ca.yaw != null ? ca.yaw : a.yaw;
  a.container.rotation.y = a.yaw || 0;
  // ART-POSEN: Wurzel ≈ −5,5 Voxel in x (rechte Schulter des Trägers)
  a.body.position.set(-5.5 * VX, 0, 0);
  pose(a, { base: 'carried', walk: 0, phase: a.phase, t }, dt);
  a.setItem(null, null);
}

function updatePlayer(p, view, st, dt, t) {
  const zone = zoneOfCtx();
  const inShip = zone === 'ship';
  const a = actor('p:' + p.id);
  a.entityId = String(p.id);
  a.body.position.set(0, 0, 0);
  if (!inShip) { const c = carrierOf(p.id); if (c) { a.setFigure(AWAY_FIGURES[p.color || 0] || AWAY_FIGURES[0], { colors: { primary: PLAYER_COLORS[p.color || 0], cloth2: PLAYER_COLORS[p.color || 0] } }, 'away'); applyCarried(a, c, dt, t); return; } }
  const color = p.color || 0;
  const col = PLAYER_COLORS[color] || PLAYER_COLORS[0];
  if (inShip) a.setFigure('lerche/crew_' + Math.min(2, color), { colors: { cloth2: col } }, 'crew', col);
  else a.setFigure(AWAY_FIGURES[color] || AWAY_FIGURES[0], { colors: { primary: col, cloth2: col } }, 'away', col);

  // Lift/Leiter (DECKS): Fahrt sichtbar machen, Ankunft auf dem neuen Deck von unten/oben einblenden
  const deck = deckOfPlayer(p);
  let yOff = 0, base = 'stand', upper = null, special = null, walkW = 0, wantYaw = null;
  const decked = isDecked();
  if (a.deck != null && deck !== a.deck && decked) {
    // nicht doppelt: das Ereignis lift { phase:'arrive' } kann vor dem (interpolierten) Snapshot ankommen
    if ((a.lift || a.ladder) && !a.arrive) a.arrive = { t: 0, from: deck > a.deck ? -1 : 1, T: a.ladder ? 0.4 : 0.6 };
  }
  a.deck = deck; a.lift = p.lift || null; a.ladder = p.ladder || null;
  if (decked && !onVisibleDeck(p.y) && !(p.lift && p.lift.to === L.ctx.deck)) { a.container.visible = false; return; }

  const pos = place(a, p.x, p.y, 0);
  const beam = beamAmount(p, view);
  const moving = !!p.moving;
  // B2: Körperzustand und Waffenaktion (nur außen und nur, wenn der Server die B2-Felder liefert)
  const b2 = !inShip && (p.zs != null || p.wf != null);
  const shot0 = L.shotAt[p.id] != null && performance.now() / 1000 - L.shotAt[p.id] < 0.6;
  const ks = b2 ? kampfZustand(a, p, t, shot0, true) : null;
  if (ks && ks.base) { base = ks.base; if (ks.lie) wantYaw = lieYaw(a, base); }
  else if (p.downed) { base = 'wounded'; wantYaw = lieYaw(a); }
  else if (p.lift) {
    base = 'lift_ride';
    const q = clamp01((p.lift.t || 0) / Math.max(0.1, p.lift.T || 1.5));
    const dir = (p.lift.to != null ? p.lift.to : 1 - deck) > deck ? 1 : -1;
    yOff = dir * Math.pow(q, 1.6) * 3.2;
    if (q > 0.92) a.container.visible = false;
  } else if (p.ladder) {
    base = 'climb'; special = 'climb';
    const q = clamp01((p.ladder.t || 0) / Math.max(0.1, p.ladder.T || 2));
    yOff = (deck === 0 ? 1 : -1) * q * 1.4;
    wantYaw = faceToward(p, (x, y, m) => m.solid(x, y) && (x === tileOf(p.x, p.y).x || y === tileOf(p.x, p.y).y));
  } else if (p.console) {
    base = p.console === 'plan' ? 'sit' : 'operate'; special = 'operate';
    wantYaw = targetYaw(p, st);
  } else if (p.action && p.action.kind !== 'beam') {
    base = ACTION_POSES[p.action.kind] || 'hold'; special = base;
    wantYaw = targetYaw(p, st);
  } else if (p.cr) base = 'crouch';
  if (a.arrive) {
    a.arrive.t += dt;
    const q = clamp01(a.arrive.t / a.arrive.T);
    yOff += a.arrive.from * (1 - q) * (1 - q) * 2.2;
    if (q >= 1) a.arrive = null;
  }
  if (wantYaw == null && !moving) wantYaw = DIR_YAW[p.dir] != null ? DIR_YAW[p.dir] : null;
  if (wantYaw == null && moving && DIR_YAW[p.dir] != null && a.speed < 0.2) wantYaw = DIR_YAW[p.dir];
  const busy = base !== 'stand' && base !== 'crouch';
  walkW = busy ? 0 : locomote(a, pos.x, pos.z, dt, wantYaw, moving);
  if (ks && ks.ziel && !ks.lie && wantYaw == null) { /* Ausrichtung kommt aus der Laufrichtung bzw. dir */ }
  if (busy) locomote(a, pos.x, pos.z, dt, wantYaw, false);
  a.container.position.y += yOff;

  // Oberkörper: Tragen, Zielen (Schuss in den letzten 0,6 s), Kampfhaltung mit Waffe
  const away = !inShip;
  const shot = L.shotAt[p.id] != null && performance.now() / 1000 - L.shotAt[p.id] < 0.6;
  if (!p.downed && !busy) {
    if (p.carry) upper = 'carry';
    else if (shot) upper = 'aim';
    else if (away && (base === 'crouch')) upper = null;
  }
  if (base === 'crouch' && shot) upper = 'aim';
  if (ks && ks.upper && !busy) upper = ks.upper;
  else if (ks && !ks.base && !busy && !upper) { const rp = ruhePose(a, p.wf, null); if (rp) upper = rp; }   // Ruhe mit Lanze: rest_upright
  pose(a, { base, upper, walk: walkW, phase: a.phase, t, special }, dt);
  if (b2) {
    // B2: Waffe der Crew (Bauweise rom), Hitze 0–3, Fessel; Getragenes und Halteaktionen gehen vor
    const busyHand = p.carry || (p.action && p.action.kind !== 'beam');
    applyFessel(a, !!ks.fessel);
    if (!busyHand) { applyWaffe(a, p.wf || 'blaster', 'rom', heatStufe(p), null, ks); L.muzzles.delete(p.id); beamFx(a, p, beam); return; }
  } else applyFessel(a, false);

  // Gegenstand: getragen > Waffe (Außenteam) > Löscher beim Löschen
  const hand = a.fig && a.fig.joints && a.fig.joints.handR;
  let item = p.carry && !(L.carriedBy && L.carriedBy.has(String(p.carry).replace(/^[pe]:/, ''))) ? p.carry : null;   // getragene Figur ist kein Gegenstand
  if (!item && away && !p.downed) item = 'blaster';
  if (p.action && p.action.kind === 'extinguish') item = 'loeschgel';
  if ((p.action && (p.action.kind === 'flick' || p.action.kind === 'swap')) && !p.carry) item = 'wrench';
  if (p.action && p.action.kind === 'swap') item = 'ersatzteil';
  a.setItem(item, hand);
  // ART-F: beim Tragen sitzt der Gegenstand zwischen den Händen (Versatz in Voxeln)
  if (a.item) { if (upper === 'carry') a.item.position.set(2.8 * VX, 3 * VX, 0); else a.item.position.set(0, 0, 0); }
  // QA: Mündung des Löschers (Manifest-Socket muzzle, relativ zum Griff) als Weltpunkt für fx.js
  if (item === 'loeschgel' && a.item) {
    try {
      const ms = manifestSocket('lerche/item/extinguisher', 'muzzle') || [0, -0.75, 0];
      a.item.updateWorldMatrix(true, false);
      const v = a.item.localToWorld(new L.THREE.Vector3(ms[0], ms[1], ms[2]));
      L.muzzles.set(p.id, [v.x, v.y, v.z]);
    } catch (e) { L.muzzles.delete(p.id); err('muzzle', e); }
  } else L.muzzles.delete(p.id);

  beamFx(a, p, beam);
}
// Beamen: Figur zerfällt/entsteht (Partikel macht fx.js) – hier flackern + schrumpfen
function beamFx(a, p, beam) {
  if (beam != null) {
    const v = clamp01(beam);
    a.body.scale.set(1 - v * 0.35, 1 + v * 0.08, 1 - v * 0.35);
    a.container.visible = a.container.visible && !(v > 0.55 && ((L.frame + (p.color || 0)) % 3 !== 0)) && v < 0.95;
  } else a.body.scale.set(1, 1, 1);
}
// Liegen quer zur Kamera: ART-F-Pose liegt längs z (Kopf nach −z) → Figur um 90° drehen; unsere Ersatzpose liegt schon quer.
// unconscious (Seitenlage) liegt wie wounded (ART-POSEN) und wird gleich gedreht.
function lieYaw(a, base) { const ps = a.fig && a.fig.poses; return ps && (ps[base || 'wounded'] || ps.wounded) ? Math.PI / 2 : 0; }
function beamAmount(p, view) {
  let b = null;
  if (p.action && p.action.kind === 'beam') b = clamp01(p.action.progress || 0) * 0.85;
  const bf = view.beamFx && view.beamFx[p.id];
  if (bf != null) b = bf;
  return b;
}

// ------------------------------------------------------------------------------------------------------------------------------
// Bots (an Bord)
function botMode(b, view) {
  if ((view.setbacks || []).some((s) => s.bot && s.bot === b.id && s.age < 1.2)) return 5;
  const working = !!(b.task && b.progress > 0);
  if (working && b.task.kind === 'extinguish') return 3;
  if (working) return 2;
  if (b.carry) return 4;
  if (b.moving) return 1;
  return 0;
}
function updateBot(b, view, dt, t) {
  if (!onVisibleDeck(b.y)) { const a0 = L.actors.get('b:' + b.id); if (a0) a0.container.visible = false; return; }
  const a = actor('b:' + b.id);
  const mode = botMode(b, view);
  a.setModel('lerche/actor/bot', { mode }, 'bot');
  const pos = place(a, b.x, b.y, 0);
  let wantYaw = DIR_YAW[b.dir] != null ? DIR_YAW[b.dir] : null;
  if (b.task && b.progress > 0 && b.task.x != null) wantYaw = yawOf(b.task.x - b.x, b.task.y - b.y);
  locomote(a, pos.x, pos.z, dt, wantYaw, !!b.moving);
  // Wippen beim Fahren, Rütteln beim Arbeiten, Zurückzucken beim Rückschlag
  const ph = hashStr(String(b.id)) * 6;
  let bob = 0, tilt = 0, roll = 0;
  if (mode === 1 || mode === 4) { bob = Math.abs(Math.sin(t * 9 + ph)) * 0.04; tilt = 0.08; }
  else if (mode === 2 || mode === 3) { bob = Math.sin(t * 18 + ph) * 0.015; roll = Math.sin(t * 11 + ph) * 0.05; tilt = 0.12; }
  else if (mode === 5) { tilt = -0.25 * Math.max(0, Math.sin(t * 20)); }
  else bob = Math.sin(t * 2 + ph) * 0.01;
  a.body.position.y = bob; a.body.rotation.x = tilt; a.body.rotation.z = roll;
  // Ladung oben auf dem Bot
  if (!a.carryAnchor) { a.carryAnchor = new L.THREE.Group(); a.carryAnchor.name = 'carry'; a.body.add(a.carryAnchor); }
  const sock = manifestSocket('lerche/actor/bot', 'carry') || manifestSocket('lerche/actor/bot', 'back') || [0, 0.62, 0];
  a.carryAnchor.position.set(sock[0], sock[1], sock[2]);
  a.carryAnchor.rotation.set(0, 0, Math.PI / 2);
  a.setItem(b.carry || null, a.carryAnchor);
}
function manifestSocket(id, name) {
  try { const m = L.ctx.loader && L.ctx.loader.manifest ? L.ctx.loader.manifest(id) : null; return (m && m.sockets && m.sockets[name]) || null; } catch (e) { return null; }
}

// ------------------------------------------------------------------------------------------------------------------------------
// Ivo an Bord, Techniker auf Plattform/Wrack
function updateNpc(key, n, dt, t, mode) {
  if (!onVisibleDeck(n.y)) { const a0 = L.actors.get(key); if (a0) a0.container.visible = false; return; }
  const a = actor(key);
  a.setFigure('lerche/ivo', {}, 'ivo');
  const pos = place(a, n.x, n.y, 0);
  let base = 'stand';
  if (mode === 'injured') base = 'wounded';
  const idle = Math.floor((t + hashStr(key) * 20) / 9) % 3;
  if (base === 'stand' && !n.moving) base = idle === 1 ? 'arms_crossed' : idle === 2 ? 'inspect' : 'stand';
  const wantYaw = base === 'wounded' ? lieYaw(a) : !n.moving && DIR_YAW[n.dir] != null ? DIR_YAW[n.dir] : null;
  const w = base === 'wounded' ? 0 : locomote(a, pos.x, pos.z, dt, wantYaw, !!n.moving);
  if (base === 'wounded') locomote(a, pos.x, pos.z, dt, wantYaw, false);
  pose(a, { base: w > 0.2 ? 'stand' : base, walk: w, phase: a.phase, t }, dt);
  a.setItem(null, null);
}

// ------------------------------------------------------------------------------------------------------------------------------
// Außenmission: Plünderer, Drohnen, Wächter
let fogCache = { f: -1, set: null };
function enemyShown(e, view, st) {
  const a = st.away || {};
  if (a.combat !== 'v2') return true;
  if (e.alive !== false) return !!e.vis;
  // Tote nur, wenn ihre Kachel im Teamsichtfeld liegt (wie render.js enemyShown)
  try {
    const R = window.Render;
    if (R && R.teamVision) {
      if (fogCache.f !== L.frame) { fogCache = { f: L.frame, set: R.teamVision(view, L.ctx.map, st) }; }
      if (fogCache.set) return fogCache.set.has(Math.floor(e.x / TILE) + ',' + Math.floor(e.y / TILE));
    }
  } catch (e2) { err('teamVision', e2); }
  return true;
}
const squadSeen = new Map();
function scavRole(e) {
  // Der Snapshot kennt keine feste Rolle (nur die KI-Rolle pin/flank/…): Funker = erstes Mitglied je Trupp, sonst abwechselnd Schütze/Flanker
  const sq = e.squad || String(e.id).split('-')[0];
  let list = squadSeen.get(sq);
  if (!list) { list = []; squadSeen.set(sq, list); }
  let i = list.indexOf(e.id);
  if (i < 0) { list.push(e.id); i = list.length - 1; }
  return i === 0 ? 2 : (i % 2 ? 0 : 1);
}
// Waffentyp aus der Figurdefinition (Figurenbaukasten: waffe.typ), falls der Snapshot kein wf liefert
function figWaffe(a) {
  try { const lib = L.ctx.loader && L.ctx.loader.lib; const fd = lib && lib.get('figures', L.ctx.loader.src(a.figId)); return (fd && fd.waffe && fd.waffe.typ) || 'blaster'; } catch (e) { return 'blaster'; }
}
// B2: Germanen-Gegner fig/germanen/<rolle> (Karl, Bolzer, Donnerwerfer, Jäger, Berserker, Wergeld-Fänger).
// Besitz-Palette per palette-Override (pa), Waffe item/waffe/<wf> mit bauweise aus der Fraktion (fr), Zustände zs/bt/ch/wu.
function updateGermane(a, e, view, dt, t, hitAge) {
  a.rolle = e.ro;
  const opts = { attach: { handR: null } };   // Waffe setzt das Spiel selbst (Fraktion, Hitze, Ablage am Boden)
  const pa = palReady(e.pa);
  if (pa) opts.palette = pa;
  if (e.rk != null) opts.params = { rank: +e.rk ? 1 : 0 };
  a.setFigure('fig/germanen/' + e.ro, opts, 'scav');
  const carrier = carrierOf(e.id);
  if (carrier) { applyCarried(a, carrier, dt, t); return; }
  a.body.position.set(0, 0, 0);
  const pos = place(a, e.x, e.y, 0);
  a.container.position.y += arriveOffset(a, dt);   // Deckwechsel (enemyDeck)
  let wantYaw = null;
  if (e.aim && e.aim.target != null) { const tp = (view.players || []).find((q) => q.id === e.aim.target); if (tp) wantYaw = yawOf(tp.x - e.x, tp.y - e.y); }
  if (wantYaw == null && e.gr) wantYaw = yawOf(e.gr.x - e.x, e.gr.y - e.y);
  if (wantYaw == null && e.facing != null && isFinite(+e.facing)) wantYaw = yawOf(Math.cos(+e.facing), Math.sin(+e.facing));
  if (wantYaw == null && typeof e.dir === 'number') wantYaw = yawOf(Math.cos(e.dir), Math.sin(e.dir));
  if (wantYaw == null && DIR_YAW[e.dir] != null) wantYaw = DIR_YAW[e.dir];
  const aiming = !!(e.aim || e.gr);
  const ks = kampfZustand(a, e, t, aiming, false);
  let base = ks.base || 'stand', upper = null;
  if (ks.lie) wantYaw = lieYaw(a, base);
  else if (!ks.base && hitAge < 0.25) base = 'hit';
  else if (!ks.base && e.cr) base = 'crouch';
  const still = !!ks.base || base === 'crouch' || base === 'hit';
  const w = still ? (locomote(a, pos.x, pos.z, dt, wantYaw, false), 0) : locomote(a, pos.x, pos.z, dt, wantYaw, null);
  const rp = ruhePose(a, e.wf || figWaffe(a), e.ro);
  const lang = (e.wf || figWaffe(a)) === 'lanze';   // Lanze ohne rest_upright: Arm hängen lassen (guard dreht die Hand, die Lanze ginge durch den Boden)
  if (!ks.base) upper = ks.upper || (rp === 'rest_upright' ? rp : w > 0.2 || lang ? null : 'guard');
  if (!ks.base && !ks.upper && rp === 'guard_hunched' && base === 'stand') { if (w > 0.2) upper = rp; else { base = rp; upper = null; } }
  if (base === 'crouch' && ks.upper) upper = ks.upper;
  pose(a, { base, upper, walk: still ? 0 : w, phase: a.phase, t }, dt);
  // Ersatzfigur (noch nicht geladen): Rollengröße selbst anwenden; die echte Figur bringt fig.scale mit
  const s = a.fig && a.fig.fallback ? ROLLE_SCALE[e.ro] || 1 : 1;
  a.body.scale.set(s, s, s);
  applyWaffe(a, e.wf || figWaffe(a), WAFFE_BW[e.fr] || 'germanen', 0, pa, ks);
  applyFessel(a, !!ks.fessel);
}

function updateEnemy(e, view, st, dt, t) {
  const map = L.ctx.map;
  const kind = e.kind || (map && map.id === 'wreck' ? 'scavenger' : 'drone');
  const key = 'e:' + e.id;
  if (!enemyShown(e, view, st) || !onVisibleDeck(e.y)) { const a0 = L.actors.get(key); if (a0) a0.container.visible = false; return; }
  const a = actor(key);
  a.entityId = String(e.id);
  const hitAge = view.enemyHit && view.enemyHit[e.id] != null ? view.enemyHit[e.id] : 99;
  const alive = e.alive !== false && e.zs !== 'aus';
  if (e.ro && ROLLEN[e.ro]) { updateGermane(a, e, view, dt, t, hitAge); return; }
  if (kind === 'scavenger' && e.zs && e.zs !== 'ok') {
    // B2: Plünderer liegen/knien nach denselben Zuständen (Gewehr steckt in der Figur)
    a.setFigure('lerche/scavenger', { params: { role: a.role != null ? a.role : (a.role = scavRole(e)) } }, 'scav');
    const pos = place(a, e.x, e.y, 0);
    const ks = kampfZustand(a, e, t, false, false);
    const lie = ks.lie ? lieYaw(a, ks.base) : null;
    locomote(a, pos.x, pos.z, dt, lie, false);
    pose(a, { base: ks.base || 'stand', walk: 0, phase: a.phase, t }, dt);
    applyFessel(a, !!ks.fessel);
    return;
  }
  if (kind === 'scavenger') {
    // DECKS liefert away.drones[i].kit (0 Schütze / 1 Flanker / 2 Funker, nur Kesh); Notbehelf nur ohne kit
    if (e.kit != null && +e.kit >= 0 && +e.kit <= 2) a.role = +e.kit;
    else if (a.role == null) a.role = scavRole(e);
    a.setFigure('lerche/scavenger', { params: { role: a.role } }, 'scav');
    const pos = place(a, e.x, e.y, 0);
    let wantYaw = null, base = 'guard', upper = null;
    if (e.aim) {
      const tp = (view.players || []).find((q) => q.id === e.aim.target);
      if (tp) wantYaw = yawOf(tp.x - e.x, tp.y - e.y);
    }
    if (wantYaw == null && DIR_YAW[e.dir] != null) wantYaw = DIR_YAW[e.dir];
    if (typeof e.dir === 'number') wantYaw = yawOf(Math.cos(e.dir), Math.sin(e.dir));
    if (!alive) { base = 'wounded'; wantYaw = lieYaw(a); }
    else if (hitAge < 0.25) base = 'hit';
    else if (e.cr) { base = 'crouch'; if (e.aim) upper = 'aim_rifle'; }
    else if (e.aim) base = 'aim_rifle';
    const w = alive && base !== 'crouch' ? locomote(a, pos.x, pos.z, dt, wantYaw, null) : (locomote(a, pos.x, pos.z, dt, wantYaw, false), 0);
    if (w > 0.2 && base === 'aim_rifle') { upper = 'aim_rifle'; base = 'stand'; }
    else if (w > 0.2 && base === 'guard') { upper = 'guard'; base = 'stand'; }
    pose(a, { base, upper, walk: base === 'wounded' || base === 'crouch' ? 0 : w, phase: a.phase, t }, dt);
    a.setItem(null, null);   // ART-G: Gewehr steckt schon in der Figur (handR)
    return;
  }
  if (kind === 'warden' || e.ro === 'waechter') {
    const state = !alive ? 2 : hitAge < 0.15 ? 1 : 0;
    // Kastell-Automat (Rom, herrenlose Kastelle) statt Kustoden-Wächter: Fraktion bzw. Bauweise der Bühne
    const mk = L.ctx.map && (L.ctx.map.karte || L.ctx.map);
    const rom = e.fr === 'herrenlos' || e.fr === 'rom' || (!e.fr && mk && mk.bauweise === 'rom');
    a.setModel(rom ? 'actor/rom/waechter' : 'lerche/actor/warden', { state, front: e.asleep || !alive ? 0 : 1 }, 'warden');
    a.labelH = rom ? 2.3 : null;
    const pos = place(a, e.x, e.y, 0);
    const f = +e.facing || 0;
    locomote(a, pos.x, pos.z, dt, yawOf(Math.cos(f), Math.sin(f)), false);
    a.body.position.y = alive && !e.asleep ? Math.sin(t * 1.6) * 0.03 : 0;
    a.body.rotation.z = state === 1 ? Math.sin(t * 40) * 0.03 : 0;
    return;
  }
  // Drohne (Plattform): schwebt, kippt in Flugrichtung
  a.setModel('lerche/actor/drone', { wreck: alive ? 0 : 1 }, 'drone');
  const pos = place(a, e.x, e.y, 0);
  const wantYaw = DIR_YAW[e.dir] != null ? DIR_YAW[e.dir] : null;
  locomote(a, pos.x, pos.z, dt, wantYaw, null);
  const ph = hashStr(String(e.id)) * 6;
  a.body.position.y = alive ? Math.sin(t * 3 + ph) * 0.08 : 0;   // ART-G: Anker liegt 0,875 m unter dem Rumpf (wreck 0)
  a.body.rotation.x = alive ? Math.min(0.3, a.speed * 0.15) : 0.4;
  a.body.rotation.z = alive ? Math.sin(t * 2.3 + ph) * 0.06 + (hitAge < 0.15 ? Math.sin(t * 50) * 0.15 : 0) : 0.3;
}

// ------------------------------------------------------------------------------------------------------------------------------
// Gegenstände am Boden (Schiff: ship.groundItems, außen: away.items)
function updateGroundItem(it, t) {
  if (!onVisibleDeck(it.y)) return;
  const a = actor('i:' + it.id);
  a.setModel('lerche/item/' + (ITEM_IDS[it.kind] || it.kind), {}, 'item');
  place(a, it.x, it.y, 0);
  const ph = hashStr(String(it.id));
  a.container.rotation.y = ph * Math.PI * 2;
  a.body.rotation.z = Math.PI / 2;          // liegt flach (Modelle zeigen mit der Spitze nach −y)
  a.body.position.y = 0.08 + Math.max(0, Math.sin(t * 2.4 + ph * 6)) * 0.02;
}

// ------------------------------------------------------------------------------------------------------------------------------
// Instancing: gleiche Teile (Geometrie + Material) mehrerer Figuren → ein InstancedMesh je Teil
class Batcher {
  constructor() {
    this.root = new L.THREE.Group(); this.root.name = 'actors-batch';
    L.group.add(this.root);
    this.groups = new Map(); this.hidden = []; this.inv = new L.THREE.Matrix4(); this.m = new L.THREE.Matrix4(); this.active = false;
  }
  restore() { for (const m of this.hidden) m.visible = true; this.hidden.length = 0; }
  run(containers) {
    this.restore();
    for (const g of this.groups.values()) { g.n = 0; }
    const byKey = new Map();
    for (const c of containers) {
      c.traverseVisible((o) => {
        if (!o.isMesh || o.isInstancedMesh || !o.geometry || !o.material || Array.isArray(o.material)) return;
        const k = o.geometry.uuid + '|' + o.material.uuid;
        let l = byKey.get(k); if (!l) byKey.set(k, (l = []));
        l.push(o);
      });
    }
    this.inv.copy(this.root.matrixWorld).invert();
    let inst = 0;
    for (const [k, list] of byKey) {
      if (list.length < 2) continue;
      let g = this.groups.get(k);
      if (!g || g.cap < list.length) {
        if (g) { this.root.remove(g.im); g.im.dispose(); }
        const cap = Math.max(4, 1 << Math.ceil(Math.log2(list.length)));
        const im = new L.THREE.InstancedMesh(list[0].geometry, list[0].material, cap);
        im.frustumCulled = false; im.castShadow = list[0].castShadow; im.receiveShadow = list[0].receiveShadow;
        im.userData.bloom = list[0].userData.bloom;
        this.root.add(im);
        g = { im, cap, n: 0 }; this.groups.set(k, g);
      }
      for (let i = 0; i < list.length; i++) {
        this.m.multiplyMatrices(this.inv, list[i].matrixWorld);
        g.im.setMatrixAt(i, this.m);
        list[i].visible = false; this.hidden.push(list[i]);
      }
      g.n = list.length; inst++;
    }
    for (const g of this.groups.values()) {
      g.im.count = g.n; g.im.visible = g.n > 0;
      if (g.n) g.im.instanceMatrix.needsUpdate = true;
    }
    return inst;
  }
  off() { this.restore(); for (const g of this.groups.values()) { g.im.count = 0; g.im.visible = false; } }
}

// ------------------------------------------------------------------------------------------------------------------------------
function countDrawCalls(root) {
  let n = 0;
  root.traverseVisible((o) => { if (o.isInstancedMesh) { if (o.count > 0) n++; } else if (o.isMesh) n++; });
  return n;
}

const layer = {
  id: 'actors',
  zones: ['*'],
  build(ctx) {
    L.ctx = ctx; L.THREE = ctx.THREE;
    if (!L.group) { L.group = new L.THREE.Group(); L.group.name = 'actors'; }
    if (L.group.parent !== ctx.root) ctx.root.add(L.group);
    if (!L.batcher) L.batcher = new Batcher();
  },
  update(view, dt, ctx) {
    L.ctx = ctx || L.ctx; if (!L.ctx) return;
    if (!L.THREE) layer.build(L.ctx);
    if (L.group.parent !== L.ctx.root) L.ctx.root.add(L.group);
    L.frame++; L.time += dt;
    installDeckHook();
    const t = view.time != null ? view.time : L.time;
    const st = view.state || {};
    const zone = zoneOfCtx();
    if (zone !== L.lastZone) { for (const a of L.actors.values()) a.dispose(); L.actors.clear(); squadSeen.clear(); L.lastZone = zone; }
    // Schüsse (fx.js meldet Mündungsfeuer je Spieler)
    try { const fx = window.VoxelFx; if (fx && fx.shots) for (const k in fx.shots) L.shotAt[k] = fx.shots[k]; } catch (e) { /* egal */ }
    const want = zone === 'ship' ? 'ship' : 'away';
    // B2 (carried): Träger = Spieler, dessen carry auf eine Figur-ID zeigt (Spieler oder Gegner)
    L.carriedBy = new Map();
    if (zone !== 'ship') {
      const ids = new Set([...(view.players || []).map((q) => String(q.id)), ...(view.drones || []).map((q) => String(q.id))]);
      for (const q of view.players || []) if (q.zone === 'away' && q.carry != null && !ITEM_IDS[q.carry] && ids.has(String(q.carry).replace(/^[pe]:/, ''))) L.carriedBy.set(String(q.carry).replace(/^[pe]:/, ''), q);
    }
    for (const p of view.players || []) {
      if (p.zone !== want || p.connected === false) continue;
      try { updatePlayer(p, view, st, dt, t); } catch (e) { err('player', e); }
    }
    if (zone === 'ship') {
      for (const b of view.bots || []) { try { updateBot(b, view, dt, t); } catch (e) { err('bot', e); } }
      for (const n of view.shipNpcs || (st.ship && st.ship.npcs) || []) { try { updateNpc('n:' + n.id, n, dt, t); } catch (e) { err('npc', e); } }
      for (const it of (st.ship && st.ship.groundItems) || []) { try { updateGroundItem(it, t); } catch (e) { err('item', e); } }
    } else {
      const aw = st.away || {};
      const npc = view.npc;
      if (npc && npc.present !== false && !npc.rescued && zone !== 'kesh') { try { updateNpc('n:tech', npc, dt, t, npc.injured ? 'injured' : null); } catch (e) { err('npc', e); } }
      for (const e of view.drones || []) { try { updateEnemy(e, view, st, dt, t); } catch (e2) { err('enemy', e2); } }
      for (const it of aw.items || []) { try { updateGroundItem(it, t); } catch (e) { err('item', e); } }
    }
    // Aufräumen: nicht gesehene Akteure ausblenden, nach 3 s entfernen
    let figs = 0;
    const visible = [];
    for (const [k, a] of L.actors) {
      if (a.seen !== L.frame) {
        a.container.visible = false;
        if (L.frame - a.seen > 180) { a.dispose(); L.actors.delete(k); }
        continue;
      }
      if (a.container.visible) { visible.push(a.container); if (a.fig) figs++; }
    }
    // Instancing ab mehr als INSTANCE_THRESHOLD sichtbaren Figuren
    try {
      if (visible.length > INSTANCE_THRESHOLD) {
        L.group.updateWorldMatrix(true, true);
        L.stats.instanced = L.batcher.run(visible);
        L.batcher.active = true;
      } else if (L.batcher.active) { L.batcher.off(); L.batcher.active = false; L.stats.instanced = 0; }
    } catch (e) { err('batch', e); L.batcher.off(); }
    if (L.frame % 30 === 0) {
      L.stats.figures = figs; L.stats.visible = visible.length;
      L.stats.drawCalls = countDrawCalls(L.group);
      let ph = 0; for (const a of L.actors.values()) if ((a.fig && a.fig.placeholder) || isPlaceholder(a.model)) ph++;
      L.stats.placeholders = ph;
    }
  },
  dispose() {
    for (const a of L.actors.values()) a.dispose();
    L.actors.clear();
    if (L.batcher) L.batcher.off();
    if (L.group && L.group.parent) L.group.parent.remove(L.group);
  },
};

registerLayer(layer);

// Debug/QA: window.VoxelActors.stats() – Figuren, Draw Calls (Layer), instanzierte Teile, Ersatzfiguren, Fehler
// ------------------------------------------------------------------------------------------------------------------------------
// Deck-Ereignisse der Bühnen (BODENKAMPF, B1 §6.2): lift { pid, deck, phase, T, zone:'away' }, enemyDeck { id, via, x, y }.
// Spieler: Snapshot players[].deck/lift trägt den Wechsel (Aufstiegs-Einblendung wie an Bord); das Ereignis sichert die
// Ankunft auch ohne lift im Snapshot. Gegner haben kein lift-Feld: Sie tauchen 0,4 s lang aus dem Schacht auf.
function onDeckEvent(ev) {
  if (!ev || typeof ev !== 'object') return;
  const kind = ev.kind || ev.name || ev.e;
  if (kind === 'lift' && ev.zone === 'away' && ev.pid != null && ev.phase === 'arrive') {
    const a = L.actors.get('p:' + ev.pid);
    if (a && !a.arrive) a.arrive = { t: 0, from: (ev.deck | 0) > (a.deck | 0) ? -1 : 1, T: ev.via === 'ladder' ? 0.4 : 0.6 };
    if (a) a.deck = ev.deck;
  } else if (kind === 'enemyDeck' && ev.id != null) {
    const a = L.actors.get('e:' + ev.id);
    if (a) a.arrive = { t: 0, from: -1, T: 0.4 };
    L.stats.deckWechsel = (L.stats.deckWechsel || 0) + 1;
  }
}
// F7 (B1-FIX-CLIENT): einmal als Zuhörer anmelden (Net.onEvent), statt Net.onMessage je Frame zu überschreiben
function installDeckHook() {
  const Net = window.Net;
  if (L.netHook || !Net || typeof Net.onEvent !== 'function') return;
  L.netHook = Net.onEvent('*', (msg) => { try { onDeckEvent(msg); } catch (e) { err('deckEvent', e); } });
}
// Einblendung beim Deckwechsel (Gegner): von unten auftauchen
function arriveOffset(a, dt) {
  if (!a.arrive) return 0;
  a.arrive.t += dt;
  const q = clamp01(a.arrive.t / a.arrive.T);
  const y = a.arrive.from * (1 - q) * (1 - q) * 2.2;
  if (q >= 1) a.arrive = null;
  return y;
}

// ------------------------------------------------------------------------------------------------------------------------------
// FX-Schnittstelle (SCHNITTSTELLEN-NACHTRAG „FX“): Weltpunkt eines Sockets der Figur bzw. ihrer Waffe
const WAFFEN_SOCKETS = { muzzle: 1, vent: 1, charge: 1, blade_tip: 1, grip: 1 };
function actorOf(id) {
  const s = String(id);
  if (/^[pebin]:/.test(s)) return L.actors.get(s) || null;
  const a = L.actors.get('p:' + s) || L.actors.get('e:' + s);
  return a && a.container.visible ? a : (a || null);
}
/** socket(id, name) → [x, y, z] (Welt) oder null. id = Spieler- bzw. Gegner-ID (Präfix p:/e: optional). */
function socketWorld(id, name) {
  try {
    const a = actorOf(id);
    if (!a || !a.container.parent) return null;
    a.container.updateMatrixWorld(true);
    const V = L.THREE.Vector3;
    if (WAFFEN_SOCKETS[name]) {
      const it = a.item, iid = it && it.userData.itemId;
      if (!it || !iid) return null;
      const s = manifestSocket(iid, name);
      if (!s) return null;
      const v = it.localToWorld(new V(s[0], s[1], s[2]));
      return [v.x, v.y, v.z];
    }
    const j = a.fig && a.fig.joints;
    if (name === 'head_top') {
      if (j && j.head) { const v = j.head.localToWorld(new V(0, 9 * VX, 0)); return [v.x, v.y, v.z]; }
      const v = a.container.localToWorld(new V(0, 2.1, 0)); return [v.x, v.y, v.z];
    }
    if (name === 'wrists') {
      if (j && j.handL && j.handR) { const v = j.handL.getWorldPosition(new V()).add(j.handR.getWorldPosition(new V())).multiplyScalar(0.5); return [v.x, v.y, v.z]; }
      return null;
    }
    if (name === 'label') { const v = a.container.localToWorld(new V(0, labelHeight(a), 0)); return [v.x, v.y, v.z]; }
    if (name === 'fx_spark') { const v = a.container.localToWorld(new V(0, 1.3 * (a.figScale ? a.figScale() : 1), 0.2)); return [v.x, v.y, v.z]; }
    return null;
  } catch (e) { err('socket', e); return null; }
}
/** Höhe des label-Sockets über dem Boden (m): Figur-Manifest × Größe (Enterer 1,1 → höher), Kastell-Automat 2,3 */
function labelHeight(a) {
  if (a.labelH) return a.labelH;
  let h = 2.3;
  try { const m = a.figId && L.ctx.loader.manifest(a.figId); if (m && m.sockets && m.sockets.label) h = m.sockets.label[1]; } catch (e) { /* egal */ }
  return h * (a.figScale ? a.figScale() : 1);
}

window.VoxelActors = { stats: () => Object.assign({}, L.stats), layer, poses: FALLBACK_POSES,
  // QA: Weltpunkt der Löscher-Mündung je Spieler (null, wenn kein Löscher in der Hand)
  muzzle: (pid) => L.muzzles.get(pid) || null,
  // FX: Weltpunkt eines Sockets (muzzle, vent, charge, blade_tip, head_top, wrists, label, fx_spark) oder null
  socket: socketWorld,
  onEvent: onDeckEvent,
  // QA: Höhe des Gegenstands in der Hand (min/max y in m, Welt) – Lanzenfuß auf dem Boden?
  // QA: Modell und Schlüssel (inkl. Parameter wie bauweise) des Gegenstands in der Hand
  itemInfo: (id) => { const a = actorOf(id); return a && a.item ? { id: a.item.userData.itemId, key: a.itemKey } : null; },
  // QA: Deck und laufende Einblendung einer Figur
  deckInfo: (id) => { const a = actorOf(id); return a ? { deck: a.deck, arrive: a.arrive ? Object.assign({}, a.arrive) : null, visible: a.container.visible } : null; },
  itemBox: (id) => { const a = actorOf(id); if (!a || !a.item) return null; a.container.updateMatrixWorld(true); const b = new L.THREE.Box3().setFromObject(a.item); return [b.min.y, b.max.y]; },
  // CLIENT-Overlay: Höhe des Namens/der Marke über dem Boden (m) je Spieler-/Gegner-ID
  labelY: (id) => { const a = actorOf(id); return a ? labelHeight(a) + (a.container.position.y || 0) : null; } };
export { layer as actorsLayer, FALLBACK_POSES };
