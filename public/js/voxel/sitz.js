// UI-Sitz (Prototyp E2): Layer „sitz“ – Hauptschirm an der Bugwand der Brücke. Zeigt das Stationsbild aus Sitz.schirm
// (public/js/sitz.js): die Frontsicht des Piloten, solange jemand vom eigenen Client auf der Brücke ist; sonst ein ruhendes Sternenbild.
import * as THREE from 'three';

const SCHIRM = (window.Sitz && Sitz.schirm && Sitz.schirm.mass) || { x: 35.94, y: 1.74, z: 6.5, w: 4.4, h: 2.475 };   // Maße aus public/js/sitz.js (Shared_Maps.HAUPTSCHIRM)

function ruhebild() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 144;
  const g = c.getContext('2d');
  g.fillStyle = '#0B0E1A'; g.fillRect(0, 0, 256, 144);
  let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 90; i++) { g.fillStyle = 'rgba(244,238,220,' + (0.3 + r() * 0.7).toFixed(2) + ')'; g.fillRect(Math.floor(r() * 256), Math.floor(r() * 144), 1, 1); }
  return c;
}

const layer = {
  id: 'sitz',
  zones: ['ship'],
  build(ctx) {
    const S = ctx._sitz = { version: -1 };
    const ruhe = new THREE.CanvasTexture(ruhebild());
    ruhe.colorSpace = THREE.SRGBColorSpace; ruhe.magFilter = THREE.NearestFilter;
    S.ruhe = ruhe;
    const live = window.Sitz && Sitz.schirm ? new THREE.CanvasTexture(Sitz.schirm.canvas) : null;
    if (live) { live.colorSpace = THREE.SRGBColorSpace; live.magFilter = THREE.NearestFilter; live.minFilter = THREE.LinearFilter; live.generateMipmaps = false; }
    S.live = live;
    const g = new THREE.Group(); g.name = 'hauptschirm';
    g.position.set(SCHIRM.x, SCHIRM.y, SCHIRM.z);
    g.rotation.y = -Math.PI / 2;   // Bildseite zeigt nach −x (zur Brücke)
    const rahmen = new THREE.Mesh(new THREE.BoxGeometry(SCHIRM.w + 0.16, SCHIRM.h + 0.16, 0.08), new THREE.MeshStandardMaterial({ color: '#C9974A', roughness: 0.55, metalness: 0.35 }));
    rahmen.position.z = -0.03;
    const bild = new THREE.Mesh(new THREE.PlaneGeometry(SCHIRM.w, SCHIRM.h), new THREE.MeshBasicMaterial({ map: ruhe, toneMapped: false }));
    bild.position.z = 0.015;
    g.add(rahmen, bild);
    S.bild = bild;
    S.group = g;
    ctx.root.add(g);
  },
  update(view, dt, ctx) {
    const S = ctx._sitz;
    if (!S) return;
    S.group.visible = ctx.deck === 0;
    const sz = window.Sitz && Sitz.schirm;
    const live = !!(sz && sz.aktiv && S.live);
    const want = live ? S.live : S.ruhe;
    if (S.bild.material.map !== want) { S.bild.material.map = want; S.bild.material.needsUpdate = true; }
    if (live && sz.version !== S.version) { S.version = sz.version; S.live.needsUpdate = true; }
  },
  dispose(ctx) {
    const S = ctx._sitz;
    if (!S) return;
    S.ruhe.dispose(); if (S.live) S.live.dispose();
    S.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  },
};

export default layer;
