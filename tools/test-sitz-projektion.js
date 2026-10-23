'use strict';
// SUND-02a Fixrunde M-1 (R-S4 l): Voxel-Sitz, Blick VORN. Die Unterkante der Szenenzeile am Hauptschirm (Sitz.szeneUnten) wird jeden Frame über die echte
// Sitzkamera projiziert statt mit festen Werten (SCHIRM_VY0/VS, nur Steuer, Neigung 0). Referenz ist die echte three.js-Kamera (public/vendor/three,
// PerspectiveCamera + lookAt + Vector3.project, Aspekt 640/360) mit denselben Setzer-Werten, die Sitz.update an VoxelRender.renderer.setSeat gibt.
//   Prüft: je Station (Steuer, Ops, Captain) und Mausstellung (oben 7 %, Mitte, unten) liegt szeneUnten innerhalb 1 HUD-px auf der Referenz;
//   die Maus bewegt den Wert (Neigung wird mitgeführt, sonst Mutation „feste Konstanten“ rot); Ops/Captain weichen vom Steuerwert ab;
//   Notbehelf ohne Kamera; ohne Szene 0; andere Blicke 0.
//   node tools/test-sitz-projektion.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

(async () => {
  const THREE = await import(pathToFileURL(path.join(ROOT, 'public', 'vendor', 'three', 'three.module.js')).href);
  const stub = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 0 }) : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
  let seat = null, zeilenH = 14, szene = true;
  const Hud = { szeneVon: () => (szene ? { p: 'k' } : null), szenenHoehe: () => zeilenH };
  const win = { Shared_Maps: require('../shared/maps.js'), Shared_Physics: require('../shared/physics.js'), Hud,
    Render: { PAL: new Proxy({}, { get: () => '#fff' }), ui: { buttons: [] }, text() {}, measure: () => 0, FRONT: { fwd: 1, back: 1 }, drawFrontView() {} },
    VoxelRender: { ready: true, mode: 'voxel', renderer: { setSeat: (s) => { seat = s; } } },
    Client: { pid: 'a', mouse: { x: 320, y: 180 } }, Net: { reportError() {}, guard: (n, f) => f() },
    document: { createElement: () => ({ getContext: () => stub, style: {}, width: 0, height: 0 }) },
    location: { search: '' }, URLSearchParams, performance: { now: () => 0 }, console };
  win.window = win; win.self = win;
  vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'sitz.js'), 'utf8'), win, { filename: 'sitz.js' });
  const Sitz = win.Sitz;
  ok(typeof Sitz.szeneUnten === 'function' && typeof Sitz.projiziereSchirmY === 'function', 'Sitz.szeneUnten und Sitz.projiziereSchirmY vorhanden');

  const view = (st) => ({ me: { console: st }, self: { zone: 'ship', x: 0, y: 0 }, time: 0, state: { ship: {}, flotte: { sz: { p: 'k' } } } });
  const M = win.Shared_Maps.HAUPTSCHIRM;
  const SCH = Sitz.schirm.mass;
  // Referenz: three.js
  const ref = (s, texY) => {
    const cam = new THREE.PerspectiveCamera(s.fov, 640 / 360, 0.3, 200);
    cam.position.set(...s.pos); cam.lookAt(new THREE.Vector3(...s.look)); cam.updateMatrixWorld(true);
    let best = -1e9;
    for (const dz of [0, -0.3, 0.3]) {
      const v = new THREE.Vector3(SCH.x, SCH.y + SCH.h / 2 - (texY / 288) * SCH.h, SCH.z + dz * SCH.w).project(cam);
      best = Math.max(best, (1 - v.y) / 2 * 360);
    }
    return best;
  };
  const stand = (st, mausY) => { win.Client.mouse = { x: 320, y: mausY }; const v = view(st); Sitz.update(v, 1); Sitz.update(v, 1); return v; };
  const werte = {};
  for (const st of ['helm', 'weapons', 'captain']) {
    for (const [name, my] of [['oben', 25], ['mitte', 180], ['unten', 335]]) {
      const v = stand(st, my);
      const unten = Sitz.szeneUnten(v);
      const zeile = 6 + zeilenH;   // Texturzeile der Unterkante
      // Sitz.update gibt in zwei Schritten (k=1 beim ersten, danach 1-exp(-8)) an die Kamera; die Referenz nimmt die zuletzt gesetzte Pose
      const r = ref(seat, zeile);
      ok(Math.abs(unten - r) <= 1, st + ', Maus ' + name + ': szeneUnten ' + unten + ' = three.js-Projektion ' + r.toFixed(1) + ' (±1)');
      werte[st + name] = unten;
    }
    ok(werte[st + 'oben'] !== werte[st + 'unten'], st + ': die Mausneigung verschiebt die Unterkante (' + werte[st + 'oben'] + ' / ' + werte[st + 'mitte'] + ' / ' + werte[st + 'unten'] + ')');
  }
  ok(werte.weaponsmitte !== werte.helmmitte || werte.captainmitte !== werte.helmmitte, 'Ops/Captain sitzen anders als die Steuerposition (' + werte.helmmitte + ' / ' + werte.weaponsmitte + ' / ' + werte.captainmitte + ')');
  // Zeilenhöhe: Kampfzeile höher -> Unterkante weiter unten
  zeilenH = 30; { const v = stand('helm', 180); const r = ref(seat, 6 + 30); ok(Math.abs(Sitz.szeneUnten(v) - r) <= 1, 'höhere Zeile (30): Unterkante folgt (' + Sitz.szeneUnten(v) + ' / ' + r.toFixed(1) + ')'); } zeilenH = 14;
  // Pure Funktion: Neigung ändern -> Versatz geht mit
  const cam0 = { auge: [34.4, 1.42, 6.5], ziel: [36, 1.64, 6.5], fov: 56 };
  const y0 = Sitz.projiziereSchirmY(cam0, SCH, 20);
  const y1 = Sitz.projiziereSchirmY(Object.assign({}, cam0, { ziel: [36, 1.64 + 0.2, 6.5] }), SCH, 20);
  ok(y1 > y0 + 5, 'Blick nach oben (Ziel +0,2 m) schiebt die Schirmkante nach unten im Bild: ' + y0.toFixed(1) + ' -> ' + y1.toFixed(1));
  ok(isNaN(Sitz.projiziereSchirmY(null, SCH, 20)) && isNaN(Sitz.projiziereSchirmY({ auge: [0, 0, 0], ziel: [0, 0, 0], fov: 56 }, SCH, 20)) && isNaN(Sitz.projiziereSchirmY({ auge: [40, 1, 6], ziel: [45, 1, 6], fov: 56 }, SCH, 20)), 'ohne brauchbare Kamera (null, Ziel = Auge, Schirm hinter dem Auge) NaN');
  // andere Blicke / keine Szene
  { const v = stand('helm', 180); Sitz.setBlick('pult'); ok(Sitz.szeneUnten(v) === 0, 'Blick PULT: 0'); Sitz.setBlick('vorn');
    szene = false; ok(Sitz.szeneUnten(v) === 0, 'ohne Szene: 0'); szene = true; }
  // Notbehelf: Kamera nicht bereit -> Steuer mit den alten Konstanten, Ops/Captain 0
  { const v = stand('helm', 180); win.VoxelRender.ready = false; const u = Sitz.szeneUnten(v); ok(u === Math.round(80 + (6 + 14) * 0.642), 'Notbehelf Steuer ohne Kamera: ' + u); win.VoxelRender.ready = true; }
  console.log(fails ? `\n${fails} FEHLER` : `\n${n}/${n} Prüfungen ok`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
