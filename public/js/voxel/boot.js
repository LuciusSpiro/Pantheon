// CORE M4 (CONTRACT-M4 §3.1): Einstieg des Voxel-Clients. Setzt window.VoxelRender, Moduswahl (?render=voxel|2d, F8,
// localStorage), lädt three, Renderer und Loader erst, wenn der Voxel-Modus gewählt ist, und dann die Layer
// (ship, actors, fx, away) fehlertolerant. Fehler werden gezählt und geloggt; 3 Fehler in Folge, verlorener
// WebGL-Kontext oder fehlendes WebGL schalten auf 2D und setzen einmal einen Hinweis (VoxelRender.notice).
const params = new URLSearchParams(location.search);
const LS_KEY = 'sternenschicht.render';
const LS_ZOOM = 'sternenschicht.zoom';
const canvas = document.getElementById('world3d');
const hud = document.getElementById('game');

function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* egal */ } }
function report(where, e) {
  VR.errors++;
  const err = e instanceof Error ? e : new Error(String(e && e.message || e));
  try { if (window.Net && typeof Net.reportError === 'function') Net.reportError('Voxel.' + where, err); else console.warn('[voxel]', where, err); }
  catch (x) { console.warn('[voxel]', where, err); }
}

let R = null, L = null, starting = null, inRow = 0, shown = false;
const layerLoad = {};

const VR = {
  ready: false, mode: '2d', errors: 0, notice: null, failed: false,
  layers: layerLoad,
  setMode(m) {
    m = m === 'voxel' ? 'voxel' : '2d';
    lsSet(LS_KEY, m);
    if (m === '2d') { VR.mode = '2d'; hide(); return VR.mode; }
    if (!hasWebGL()) { fail('Kein WebGL – Spiel läuft in 2D weiter.', new Error('WebGL nicht verfügbar')); return VR.mode; }
    VR.mode = 'voxel'; VR.failed = false; inRow = 0;
    start();
    return VR.mode;
  },
  toggle() { return VR.setMode(VR.mode === 'voxel' ? '2d' : 'voxel'); },
  /** true, wenn 3D diese Zone zeichnet ('ship' | 'platform' | 'wreck' | 'kesh' | 'buehne'; 'away' wird über den Zustand aufgelöst) */
  handles(zone) {
    if (!VR.ready || VR.mode !== 'voxel' || !R) return false;
    try { return R.handles(zone); } catch (e) { return false; }
  },
  /** Zone eines View (für client.js) */
  zoneOf(view) { return R ? R.zoneOf(view) : (view && view.self && view.self.zone === 'ship' ? 'ship' : null); },
  frame(view, dt) {
    if (!VR.ready || VR.mode !== 'voxel') return false;
    try {
      R.frame(view, dt);
      inRow = 0;
      show();
      return true;
    } catch (e) {
      inRow++;
      report('frame', e);
      if (inRow >= 3 || (R && R.state().contextLost)) fail('3D-Darstellung gestört – zurück auf 2D (F8 versucht es erneut).', null);
      return false;
    }
  },
  hide() { hide(); },
  worldToScreen(px, py, h) { return R && VR.ready ? R.worldToScreen(px, py, h) : { x: px, y: py }; },
  screenToWorld(sx, sy) { return R && VR.ready ? R.screenToWorld(sx, sy) : { x: sx, y: sy }; },
  pxPerMeter() { return R && VR.ready ? R.pxPerMeter() : 32; },
  shownDeck() { return R ? R.shownDeck() : 0; },
  zoom(dir) { if (R) { R.zoomStep(dir); lsSet(LS_ZOOM, String(R.getZoom())); } },
  info() { return R ? Object.assign(R.info(), { loader: L ? L.stats() : null, voxelErrors: VR.errors, mode: VR.mode }) : { mode: VR.mode, errors: VR.errors }; },
  get renderer() { return R; },
  get loader() { return L; },
};
window.VoxelRender = VR;

function hasWebGL() {
  if (params.get('nowebgl') === '1') return false;   // Test: Spiel ohne WebGL
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
}
function show() {
  if (shown) return;
  shown = true;
  canvas.style.display = 'block';
  hud.style.background = 'transparent';
}
function hide() {
  if (!shown) return;
  shown = false;
  canvas.style.display = 'none';
  hud.style.background = '';
}
function fail(msg, err) {
  if (err) report('init', err);
  VR.mode = '2d'; VR.failed = true; hide();
  if (!VR.noticeShown) { VR.notice = msg; VR.noticeShown = true; }
}

async function importLayer(name) {
  try {
    const m = await import('./' + name + '.js');
    const lay = m && (m.layer || m.default);
    if (lay && lay.id && typeof lay.update === 'function' && !R.layerIds().includes(lay.id)) R.registerLayer(lay);
    layerLoad[name] = 'ok';
  } catch (e) {
    layerLoad[name] = 'fehlt: ' + (e && e.message ? e.message.slice(0, 120) : e);
    report('layer.' + name, e);
  }
}

function start() {
  if (starting) return starting;
  starting = (async () => {
    try {
      [R, L] = await Promise.all([import('./renderer.js'), import('./loader.js')]);
      L.setErrorHandler((where, e) => report(where, e));
      R.init(canvas, L, { onError: (where, e) => report(where, e), quality: params.get('quality'), preserve: params.get('preserve') === '1' });
      const z = +lsGet(LS_ZOOM, '0'); if (z) R.setZoom(1);
      await Promise.race([L.ready, new Promise((r) => setTimeout(r, 5000))]);
      // Layer: eigener Schiffs-Layer + die der Teams ACTORS und AWAY, jeder für sich fehlertolerant
      await Promise.all(['ship', 'actors', 'fx', 'away', 'kit'].map(importLayer));   // B1: kit = Bühnen (Zone 'buehne')
      VR.ready = true;
    } catch (e) {
      starting = null;
      fail('3D konnte nicht starten – Spiel läuft in 2D.', e);
    }
  })();
  return starting;
}

// ------------------------------------------------------------------------------------------------ Eingaben
function typing() { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); }
function inWorld() {
  const v = window.Client && Client.view;
  return VR.mode === 'voxel' && VR.ready && shown && !(v && v.me && v.me.console);
}
window.addEventListener('keydown', (e) => {
  if (e.code === 'F8') { e.preventDefault(); VR.toggle(); return; }
  if (typing() || !inWorld()) return;
  if (e.key === '+' || e.code === 'NumpadAdd') { VR.zoom(-1); }
  else if (e.key === '-' || e.code === 'NumpadSubtract') { VR.zoom(1); }
}, true);
window.addEventListener('wheel', (e) => {
  if (!inWorld()) return;
  VR.zoom(e.deltaY > 0 ? 1 : -1);
}, { passive: true });

// ------------------------------------------------------------------------------------------------ Start
// Kai 2026-10-07: Voxel ist Standard; 2D bleibt per ?render=2d bzw. F8 erreichbar
const wanted = params.get('render') || lsGet(LS_KEY, 'voxel');
if (wanted === 'voxel') {
  if (!hasWebGL()) fail('Kein WebGL – Spiel läuft in 2D weiter.', new Error('WebGL nicht verfügbar'));
  else { VR.mode = 'voxel'; start(); }
}
