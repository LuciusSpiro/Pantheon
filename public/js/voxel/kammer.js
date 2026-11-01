// CHA-01 C: Bilder der Spielerfigur für die Kleiderkammer (Charakterliste, Erstellung) – Porträts und Figurfenster, live mit three.js aus `cha/spieler`.
// EIN kleiner Offscreen-Renderer (ein Canvas, ein WebGL-Kontext für alle Bilder, nie je Karte einer), das Ergebnis wird je Kartenaussehen als 2D-Bild gemerkt (nur bei Änderung neu).
// Globales `KammerBild` (Modul, per <script type="module"> geladen; three und der Lader kommen erst beim ersten Bild – ohne WebGL oder mit ?render=2d bleibt alles aus).
//   KammerBild.moeglich()                        -> true, wenn Bilder gerendert werden können (Voxel-Modus gewählt, WebGL da, nicht ausgefallen)
//   KammerBild.bild(karte, art, yaw?)            -> Canvas (2D) oder null (noch in Arbeit/nicht möglich; der Aufrufer zeichnet inzwischen den Ersatz). art 'portraet' | 'nah' | 'ganz' (CHA-01 D: ganze Figur, hochformatig, für den Spind)
//   KammerBild.info()                            -> { gerendert, cache, fehler, kontext, versuche } (Tests); ein fehlgeschlagener Schlüssel wird nie neu versucht, fehlt die Figurdatei, ist moeglich() false
// Kamera wie die Referenzbilder des Voxelwerks (tools/cha-ansicht.mjs): orthografisch, Kopf y 22–34 (Porträt), yaw 28°, pitch 6°; „nah“ zeigt Kopf und Schultern (CHA-01 F: y 20–35, Breite folgt dem Seitenverhältnis 150 × 176 der Erstellung, damit der Kopf das Fenster füllt).
const params = new URLSearchParams(location.search);
const GROESSE = { portraet: { px: 260, fenster: { x: [-5, 4], y: [22, 34], yaw: 28, pitch: 6 } }, nah: { px: { w: 300, h: 352 }, fenster: { x: [-8, 7], y: [20, 35], yaw: 28, pitch: 6 } },
  ganz: { px: { w: 240, h: 368 }, fenster: { x: [-8, 7], y: [-1, 36], yaw: 28, pitch: 6 } } };   // ganz: Breite folgt dem Seitenverhältnis des Bildes (Figurfenster des Spinds 120 × 184)
const CACHE_MAX = 40;   // Bilder (Porträts der Liste + Drehungen des Figurfensters)

let T = null, L = null, voxelSize = null, Ch = null, werkzeug = null, startet = null, ausgefallen = false;
const cache = new Map();      // Schlüssel -> Canvas
const wartend = new Map();    // Schlüssel -> true, solange in der Warteschlange
const gescheitert = new Set(); // Schlüssel, deren Bild fehlgeschlagen ist: nie neu anstoßen (sonst bei fehlender Figur ein Versuch je Frame)
let kette = Promise.resolve();
const zaehler = { gerendert: 0, fehler: 0, kontext: 0, versuche: 0 };

function figurId() { const kat = L && L.charakterKatalog && L.charakterKatalog(); return (kat && kat.figur) || 'cha/spieler'; }
function moeglich() {
  if (ausgefallen || params.get('render') === '2d' || params.get('nowebgl') === '1') return false;
  const VR = window.VoxelRender;
  if (VR && (VR.mode === '2d' || VR.failed)) return false;
  if (L && typeof L.isMissing === 'function' && L.isMissing(figurId(), 'figures')) return false;   // Figurdatei fehlt: Ersatz greift (wie kartenFigur in actors.js)
  return true;
}
async function start() {
  if (startet) return startet;
  startet = (async () => {
    try {
      [T, L] = await Promise.all([import('three'), import('./loader.js')]);
      ({ voxelSize } = await import('voxelwerk/core/scales.js'));
      Ch = window.Shared_Charakter;
      await Promise.race([L.ready, new Promise((r) => setTimeout(r, 8000))]);
      const canvas = document.createElement('canvas');
      const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
      zaehler.kontext++;
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.NeutralToneMapping;
      renderer.setPixelRatio(1);
      renderer.setClearColor(0x000000, 0);
      canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); ausgefallen = true; });
      const scene = new T.Scene();
      // Licht: three rechnet Diffus als Albedo/π × Lichtstärke – mit 1,1 + 1,5 war die Hautfläche nur etwa 40 % so hell wie das Hautmuster (Gesicht 115/72/35 statt 198/142/104).
      // Mit 3,4 + 4,5 und fast weißer Sonne liegt die Gesichtsfront bei etwa 195/139/99, wie die Vorschaukachel des Voxelwerks (tools/mess-kammer-helligkeit.js).
      scene.add(new T.HemisphereLight('#B9C8E0', '#3A4256', 3.4));
      const sonne = new T.DirectionalLight('#FFFAF2', 4.5); sonne.position.set(-1.5, 2.5, 3); scene.add(sonne);
      const cam = new T.OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
      werkzeug = { renderer, scene, cam, canvas };
    } catch (e) { zaehler.fehler++; ausgefallen = true; console.warn('[kammer] kein Renderer', e && e.message); }
  })();
  return startet;
}

// Eine Karte in ein Bild (Canvas 2D). Die Figur wird je Bild gebaut, gerendert und wieder freigegeben (der Lader behält die Teile im LRU).
async function rendern(karte, art, yaw) {
  const kat = L.charakterKatalog && L.charakterKatalog();
  const fig = kat && Ch && Ch.figurAusKarte(karte, kat);
  if (!fig) throw new Error('Katalog fehlt');
  const f = L.figure(figurId(), { params: fig.params, colors: fig.colors });
  await f.loaded;
  if (!f.ready) throw new Error('Figur nicht geladen');
  const { renderer, scene, cam } = werkzeug;
  const G = GROESSE[art], w = G.fenster, s = voxelSize('detail');
  f.pose('stand', 0);
  scene.add(f.root);
  try {
    const px = G.px;
    const pw = typeof px === 'object' ? px.w : px, ph = typeof px === 'object' ? px.h : px;
    renderer.setSize(pw, ph, false);
    // Ausschnitt in Metern: Mitte des Fensters, halbe Höhe = halbe Fensterhöhe plus kleiner Rand (Referenz: 8 von 260 px)
    const cx = ((w.x[0] + w.x[1] + 1) / 2) * s, cy = ((w.y[0] + w.y[1] + 1) / 2) * s;
    const halb = typeof px === 'object' ? (w.y[1] + 1 - w.y[0]) * s / 2 * 1.04 : Math.max((w.y[1] + 1 - w.y[0]) * s, (w.x[1] + 1 - w.x[0]) * s) / 2 * 1.07;
    const halbB = halb * pw / ph;
    cam.left = -halbB; cam.right = halbB; cam.top = halb; cam.bottom = -halb; cam.updateProjectionMatrix();
    const ya = (w.yaw + (yaw || 0)) * Math.PI / 180, pi = w.pitch * Math.PI / 180, d = 6;
    cam.position.set(cx + Math.sin(ya) * Math.cos(pi) * d, cy + Math.sin(pi) * d, Math.cos(ya) * Math.cos(pi) * d);
    cam.lookAt(cx, cy, 0);
    renderer.render(scene, cam);
    const out = document.createElement('canvas'); out.width = pw; out.height = ph;
    out.getContext('2d').drawImage(renderer.domElement, 0, 0);   // sofort nach render(): der Puffer wird nicht bewahrt
    zaehler.gerendert++;
    return out;
  } finally {
    scene.remove(f.root);   // die Geometrien gehören dem Lader (gemeinsamer Cache), nicht freigeben
  }
}

function schluessel(karte, art, yaw) {
  const kat = L && L.charakterKatalog && L.charakterKatalog();
  const fig = kat && Ch && Ch.figurAusKarte(karte, kat);
  return fig ? art + '|' + (yaw || 0) + '|' + JSON.stringify(fig) : null;
}
function merke(k, canvas) {
  cache.set(k, canvas);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}
function bild(karte, art, yaw) {
  if (!moeglich() || !GROESSE[art]) return null;
  if (!startet) { start(); return null; }
  if (!werkzeug) return null;
  const k = schluessel(karte, art, yaw);
  if (!k) return null;
  const c = cache.get(k);
  if (c) { cache.delete(k); cache.set(k, c); return c; }   // zuletzt benutzt nach hinten
  if (wartend.has(k) || gescheitert.has(k)) return null;
  wartend.set(k, true);
  const kopie = JSON.parse(JSON.stringify(karte));
  kette = kette.then(() => { zaehler.versuche++; return rendern(kopie, art, yaw); }).then((canvas) => merke(k, canvas), (e) => { gescheitert.add(k); zaehler.fehler++; console.warn('[kammer] Bild fehlgeschlagen', e && e.message); })
    .finally(() => wartend.delete(k));
  return null;
}

window.KammerBild = { moeglich, bild, info: () => ({ gerendert: zaehler.gerendert, cache: cache.size, fehler: zaehler.fehler, kontext: zaehler.kontext, versuche: zaehler.versuche, bereit: !!werkzeug, ausgefallen }) };
