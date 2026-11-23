'use strict';
// SPT-01 A: Tooltip der Schildleiste (Consoles.shieldStrip, Kapitaenskonsole). Frueher stand dort `lk.long`, `lk` (leakText) war mit SYS-01 A1a entfallen:
// ReferenceError, sobald die Maus ueber einem Sektor der Leiste stand. Ohne Browser: consoles.js im vm-Kontext mit Aufzeichnungs-Zeichenflaeche.
//   node tools/test-schildleiste-tooltip.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const read = (f) => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8').replace(/\r\n/g, '\n');   // Quelldateien sind CRLF
const stub = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 0 }) : () => {}), set: () => true });
const f = { fillText() {}, fillRect() {}, measureText: (s) => ({ width: String(s).length * 5 }), createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }) };
const st = { fillStyle: '#000', strokeStyle: '#000' };
const ctx = new Proxy(f, { get: (t, k) => (k in t ? t[k] : k in st ? st[k] : typeof k === 'string' ? () => {} : undefined), set: (t, k, v) => { st[k] = v; return true; } });
const win = { Shared_Maps: require('../shared/maps.js'), Shared_Physics: require('../shared/physics.js'), Shared_Config: require('../shared/config.js'), Shared_Protocol: require('../shared/protocol.js'), Shared_Schilde: require('../shared/schilde.js'),
  document: { createElement: () => ({ getContext: () => stub, style: {}, width: 0, height: 0 }), querySelector: () => null, head: { appendChild() {} }, getElementById: () => null, addEventListener() {} },
  console: Object.assign({}, console, { warn(l, ...r) { if (l !== 'Lerche.sprite') console.warn(l, ...r); } }), Image: function () {}, performance: { now: () => 0 }, location: { search: '' }, URLSearchParams, localStorage: { getItem: () => null, setItem() {} } };
win.window = win; win.self = win;
vm.createContext(win);
win.Net = { guard: (w, fn, d) => { try { return fn(); } catch (e) { return d; } }, reportError() {} };
win.Hud = { SECTOR_NAMES: ['Bug', 'Steuerbord', 'Heck', 'Backbord'] };   // Namen wie in hud.js; sonst Attrappe
for (const q of ['kennung.js', 'render.js', 'pult-systeme-tokens.js', 'zonenkreuz.js', 'zielsysteme.js', 'kartenlogik.js', 'pult.js', 'consoles.js']) vm.runInContext(read(q), win, { filename: q });
const R = win.Render, C = win.Consoles;
const hudNamen = read('hud.js').match(/const SECTOR_NAMES = (\[[^\]]*\])/);
ok(hudNamen && JSON.stringify(win.Hud.SECTOR_NAMES) === JSON.stringify(eval(hudNamen[1])), 'Sektornamen der Attrappe gleich hud.js');

const view = { state: { ship: { shields: { current: [4, 3, 2, 1], cap: [4, 4, 4, 4] } } }, enemies: [] };
const x = 10, y = 26, order = [3, 0, 1, 2];
// Leiste einmal ohne Maus zeichnen, dann mit der Maus je Sektor: x-Bereich eines Balkens aus der Geometrie (Beschriftung SCHILD + 4, Balken bw+1 breit)
const bw = ((win.Shared_Config.shields && win.Shared_Config.shields.maxPerSector) || 4) > 4 ? 30 : 22;
const x0 = x + R.measure('SCHILD', 1) + 4;
R.ui.mouse = { x: -1, y: -1 }; R.ui.tooltip = null;
let e = null; try { C.shieldStrip(ctx, view, x, y); } catch (er) { e = er; }
ok(e === null && !R.ui.tooltip, 'ohne Maus: kein Fehler, kein Tooltip');
for (let j = 0; j < 4; j++) {
  const i = order[j];
  R.ui.mouse = { x: x0 + j * (bw + 1) + 3, y: y + 5 }; R.ui.tooltip = null;
  e = null; try { C.shieldStrip(ctx, view, x, y); } catch (er) { e = er; }
  const t = R.ui.tooltip && R.ui.tooltip.text;
  ok(e === null, 'Maus ueber Sektor ' + win.Hud.SECTOR_NAMES[i] + ': keine Ausnahme' + (e ? ' (' + e.message + ')' : ''));
  ok(typeof t === 'string' && t.includes(win.Hud.SECTOR_NAMES[i] + ' ' + view.state.ship.shields.current[i]) && !/undefined|NaN|\[object/.test(t), 'Tooltip lesbar: "' + t + '"');
}
console.log(fails ? '\n' + fails + ' FEHLER' : '\nSCHILDLEISTE-TOOLTIP OK');
process.exit(fails ? 1 : 0);
