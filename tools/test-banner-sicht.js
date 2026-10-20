'use strict';
// SUND-01 H: Banner im sichtbaren Ausschnitt. Der Hauptschirm der Brücke (Voxel-Modus) zeigt nur die Textur (512x288, 417 px nach vorn);
// Station und Banner laufen dort am oberen Rand ein. Render.bannerMasse (render.js) hält Mast und Fahne ganz im Ausschnitt.
//   Prüft: ohne Ausschnitt oder mit Platz = Maße aus Paket D (Kampagne/Limes/2D unverändert), am Rand gekürzt/nach innen gerückt, Sweep.
//   node tools/test-banner-sicht.js   (npm run test:banner-sicht)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

const stub = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 0 }) : () => {}), set: () => true });
const win = { Shared_Maps: require('../shared/maps.js'), Shared_Physics: require('../shared/physics.js'), Shared_Config: require('../shared/config.js'), Shared_Protocol: require('../shared/protocol.js'),
  document: { createElement: () => ({ getContext: () => stub, style: {} }), querySelector: () => null, head: { appendChild() {} }, getElementById: () => null },
  console, Image: function () {}, performance: { now: () => 0 } };
win.window = win; win.self = win;
vm.createContext(win);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'render.js'), 'utf8'), win, { filename: 'render.js' });
const M = win.Render.bannerMasse;
ok(typeof M === 'function', 'Render.bannerMasse vorhanden');

const SICHT = { x: 0, y: 0, w: 512, h: 288 };   // Textur des Hauptschirms (public/js/sitz.js SW x SH)
const D = (sx, sy, rad) => { const h = Math.max(24, rad * 0.8); return { x: sx + rad * 0.45, y: sy - rad * 0.45, h, bw: Math.max(18, h * 0.78), bh: Math.max(11, h * 0.46) }; };
const gleich = (a, b) => ['x', 'y', 'h', 'bw', 'bh'].every((k) => Math.abs(a[k] - b[k]) < 1e-9);

console.log('\nOhne Ausschnitt und mit Platz: Maße wie in Paket D');
ok(gleich(M(300, 400, 80), D(300, 400, 80)), 'ohne Ausschnitt (2D-Karten ohne Rand in der Nähe)');
ok(gleich(M(256, 200, 53, SICHT), D(256, 200, 53)), 'Station mittig im Ausschnitt: unverändert');
ok(gleich(M(110, 190, 53, SICHT), D(110, 190, 53)), 'Station angedockt links unten (Ostia/Concordia am Hauptschirm): unverändert');
ok(gleich(M(320, 120, 26, SICHT), D(320, 120, 26)), 'Posten (halber Radius) mit Platz: unverändert');

console.log('\nAm oberen Rand (Ulfsvakt 330 px voraus: Station bei y 53, Radius 53)');
{
  const b = M(320, 53, 53, SICHT), d = D(320, 53, 53);
  ok(d.y - d.h < 0, 'Ausgangslage: Mastspitze nach D läge bei ' + (d.y - d.h).toFixed(1) + ' (über dem Rand)');
  ok(b.y - b.h >= 0 && b.y - b.h + b.bh <= SICHT.h, 'Mast und Fahne jetzt im Ausschnitt (Spitze y ' + (b.y - b.h).toFixed(1) + ')');
  ok(b.h >= b.bh && b.h < d.h, 'Mast gekürzt (' + b.h.toFixed(1) + ' statt ' + d.h.toFixed(1) + '), Fahne behält ihre Größe');
}

console.log('\nAm rechten Rand: Fahne bleibt im Ausschnitt');
{
  const b = M(500, 150, 60, SICHT);
  ok(b.x + b.bw <= SICHT.w && b.x >= 0, 'Fahnenende x ' + (b.x + b.bw).toFixed(1) + ' <= ' + SICHT.w);
}

console.log('\nSweep: Stationsmitte im Ausschnitt -> Banner ganz im Ausschnitt');
{
  let faelle = 0, schlecht = 0, bsp = null;
  for (const rad of [26, 40, 53, 70, 88]) for (let sy = 0; sy <= SICHT.h; sy += 6) for (let sx = 0; sx <= SICHT.w; sx += 16) {
    faelle++;
    const b = M(sx, sy, rad, SICHT);
    const oben = b.y - b.h, unten = b.y, links = b.x, rechts = b.x + b.bw;
    if (oben < SICHT.y || unten > SICHT.y + SICHT.h || links < SICHT.x || rechts > SICHT.x + SICHT.w || !(b.h > 0)) { schlecht++; if (!bsp) bsp = [sx, sy, rad, oben, unten, links, rechts].join('/'); }
  }
  ok(schlecht === 0, faelle + ' Fälle, ' + schlecht + ' außerhalb' + (bsp ? ' (erster: ' + bsp + ')' : ''));
}

console.log('\nVerdrahtung');
{
  const sitz = fs.readFileSync(path.join(ROOT, 'public', 'js', 'sitz.js'), 'utf8');
  ok(/drawFrontView\(c, view, \{[^}]*sicht: \{ x: 0, y: 0, w: SW, h: SH \}/.test(sitz), 'sitz.js reicht die Textur als sicht an drawFrontView');
  const r = fs.readFileSync(path.join(ROOT, 'public', 'js', 'render.js'), 'utf8');
  ok(/sicht: rect\.sicht/.test(r) && /zeichneBanner\(ctx, s\.x, s\.y, lr - 2, m\.fr, t, sicht\)/.test(r), 'render.js: drawFrontView -> drawSpace -> zeichneBanner tragen sicht');
}

console.log('\n' + (fails ? 'FEHLER: ' + fails + ' von ' + n : 'alle ' + n + ' Prüfungen grün'));
process.exit(fails ? 1 : 0);
