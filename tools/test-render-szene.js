'use strict';
// SUND-02a Fixrunde 3 (R-S4 d, g, h, i): die Sim-Szenen-Neuerungen in public/js/render.js (drawSpace/drawFrontView) mit einer Zeichenfläche, die Texte, Pfeile und Ringe aufzeichnet.
//   (d) Ausweichplätze der Labels nur für Randpfeil-Labels (prio 3, nicht optional) – andere Labels bleiben auf ihrem Platz
//   (g) Frontsicht einer Sim-Szene: Randpfeile nur für Gegner in Sensorreichweite, das Flaggschiff (fg) immer; Kampagne ohne sz: keine Randpfeile
//   (h) Mint für Verbündete bei laufender Sim-Szene auch auf den Karten (Ops/Captain), ohne sz nicht
//   (i) randOben: Randpfeile klemmen unter der Szenenzeile; ohne randOben wie bisher; die Aufrufer der Steuerkonsole reichen randOben durch (M-2)
//   node tools/test-render-szene.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

// Zeichenfläche mit Aufzeichnung: Texte (fillText), Randpfeile (fill nach translate+rotate), Ringe (stroke nach arc)
function neueFlaeche() {
  const rec = { texte: [], pfeile: [], ringe: [] };
  const st = { fillStyle: '#000', strokeStyle: '#000', tx: 0, ty: 0, arc: false, rot: false };
  const stack = [];
  const f = {
    save() { stack.push({ tx: st.tx, ty: st.ty, rot: st.rot }); },
    restore() { const s = stack.pop(); if (s) { st.tx = s.tx; st.ty = s.ty; st.rot = s.rot; } },
    translate(x, y) { st.tx += x; st.ty += y; },
    rotate() { st.rot = true; },
    beginPath() { st.arc = false; },
    arc() { st.arc = true; },
    fill() { if (st.rot) rec.pfeile.push({ x: st.tx, y: st.ty, fs: st.fillStyle }); },
    stroke() { if (st.arc) rec.ringe.push({ ss: st.strokeStyle }); },
    fillText(s, x, y) { if (!/^rgba\(11,14,26/.test(st.fillStyle)) rec.texte.push({ s: String(s), x: x + st.tx, y: y + st.ty, fs: st.fillStyle }); },
    measureText: (s) => ({ width: String(s).length * 5 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  };
  const ctx = new Proxy(f, {
    get: (t, k) => (k in t ? t[k] : k in st ? st[k] : typeof k === 'string' ? () => {} : undefined),
    set: (t, k, v) => { st[k] = v; return true; },
  });
  return { ctx, rec };
}
const stub = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 0 }) : () => {}), set: () => true });
const win = { Shared_Maps: require('../shared/maps.js'), Shared_Physics: require('../shared/physics.js'), Shared_Config: require('../shared/config.js'), Shared_Protocol: require('../shared/protocol.js'),
  document: { createElement: () => ({ getContext: () => stub, style: {}, width: 0, height: 0 }), querySelector: () => null, head: { appendChild() {} }, getElementById: () => null },
  console, Image: function () {}, performance: { now: () => 0 }, location: { search: '' } };
win.window = win; win.self = win;
vm.createContext(win);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'render.js'), 'utf8'), win, { filename: 'render.js' });
const R = win.Render;
win.Hud = { szeneVon: (v) => (v && v.state && v.state.flotte && v.state.flotte.sz ? v.state.flotte.sz : null) };
ok(typeof R.drawSpace === 'function' && typeof R.drawFrontView === 'function', 'Render.drawSpace und drawFrontView vorhanden');

const SENS = (win.Shared_Config.sensors || {}).range || 1400;
const ansicht = (o) => Object.assign({ time: 1, me: { console: 'helm' }, ship: null, enemies: [], escorts: [],
  state: { time: 1, ship: { x: 0, y: 0, angle: 0, hull: 100, mounts: [] }, space: {}, players: [], flotte: o.sz ? { sz: { p: 'k', g: 3 } } : {} } }, o.extra || {});
const front = (view, rect) => { const { ctx, rec } = neueFlaeche(); R.drawFrontView(ctx, view, rect); return rec; };
const F = R.FRONT;
const RECT = { x: 10, y: 26, w: 620, h: 292 };
// Gegner rundum in Weite d (Weltkoordinaten; Lerche bei 0,0)
const ring = (d, extra) => [[d, 0], [-d, 0], [0, d], [0, -d]].map(([x, y], i) => Object.assign({ id: 'e' + i, kind: 'raider', x, y, hp: 10, hpMax: 10, angle: 0 }, extra || {}));
const ROT = win.Render.PAL.red;

console.log('\n(g) Frontsicht: Randpfeile nur in Sensorreichweite, Flaggschiff immer');
{
  const fern = SENS * 1.6, nah = SENS * 0.8;
  const pfeile = (en, o) => front(ansicht(Object.assign({ sz: true, extra: { enemies: en } }, o || {})), RECT).pfeile.filter((p) => p.fs === ROT).length;
  const nNah = pfeile(ring(nah));
  ok(nNah > 0, 'Gegner innerhalb der Sensorreichweite (' + Math.round(nah) + ') außerhalb des Bildes: Randpfeile (' + nNah + ')');
  ok(pfeile(ring(fern)) === 0, 'Gegner jenseits der Sensorreichweite (' + Math.round(fern) + '): keine Randpfeile (' + pfeile(ring(fern)) + ')');
  ok(pfeile(ring(fern, { fg: 1 }).slice(0, 1)) === 1, 'ein Flaggschiff (fg) jenseits der Sensorreichweite bekommt trotzdem seinen Pfeil');
  { const rec = front(ansicht({ sz: true, extra: { enemies: ring(fern, { fg: 1 }).slice(0, 1) } }), RECT); ok(rec.texte.some((t) => /^FLAGG /.test(t.s)), 'und trägt „FLAGG“ im Label'); }
  ok(pfeile(ring(nah), { sz: false }) === 0, 'ohne Sim-Szene (Kampagne, Limes, Eisenwald): auch in Reichweite keine Randpfeile der Gegner');
}

console.log('\n(i) randOben: Randpfeile klemmen unter der Szenenzeile');
{
  const en = ring(SENS * 0.8);
  const minY = (rect) => Math.min(...front(ansicht({ sz: true, extra: { enemies: en } }), rect).pfeile.filter((p) => p.fs === ROT).map((p) => p.y));
  const ohne = minY(RECT), mit = minY(Object.assign({ randOben: 40 }, RECT)), null0 = minY(Object.assign({ randOben: 0 }, RECT));
  ok(ohne < RECT.y + 20, 'ohne randOben: oberster Randpfeil bei y ' + ohne + ' (am Oberrand ' + RECT.y + ')');
  ok(mit >= RECT.y + 40 + 12 - 1, 'mit randOben 40: oberster Randpfeil bei y ' + mit + ' (>= ' + (RECT.y + 52) + ', unter der Szenenzeile)');
  ok(null0 === ohne, 'randOben 0 = wie ohne');
  // Hauptschirm-Textur (Voxel-Sitz): das Fenster reicht über rect.sicht hinaus, randOben gilt dort ebenso
  const zoom = 288 / (F.fwd + F.back);
  const tex = { x: 0, y: 0, w: 512, h: 288, side: 256 / zoom, sicht: { x: 0, y: 0, w: 512, h: 288 } };
  const mt = minY(Object.assign({ randOben: 24 }, tex)), mo = minY(tex);
  ok(mt >= 24 + 12 - 1 && mo < 24, 'Hauptschirm-Textur: mit randOben 24 liegt der oberste Randpfeil bei y ' + mt + ', ohne bei ' + mo);
  // M-2: die Aufrufer der Steuerkonsole (2D-Helm und Pult) geben randOben an drawFrontView weiter (Quelltextprüfung: die Konsolen laufen nur im Browser)
  const cons = fs.readFileSync(path.join(ROOT, 'public', 'js', 'consoles.js'), 'utf8'), pult = fs.readFileSync(path.join(ROOT, 'public', 'js', 'pult-stationen.js'), 'utf8');
  ok(/rect\.randOben = H\.szeneRandOben\(view, rect\.y\);[^\n]*\r?\n\s*const fv = R\.drawFrontView\(ctx, view, rect\);/.test(cons), 'M-2: Consoles.drawHelm setzt rect.randOben = H.szeneRandOben(view, rect.y) vor drawFrontView');
  ok(/R\.drawFrontView\(c, view, Object\.assign\(\{\}, r, \{ randOben: H\.szeneRandOben\(view, r\.y\) \}\)\)/.test(pult), 'M-2: das Pult der Steuerkonsole gibt randOben an drawFrontView');
}

console.log('\n(h) Mint für Verbündete auf Ops/Captain-Karte nur bei laufender Sim-Szene');
{
  const al = { id: 'a1', kind: 'frachter', name: 'Fulminata', al: true, x: 100, y: -100, hp: 50, hpMax: 100, angle: 0 };
  const karte = (szene) => { const { ctx, rec } = neueFlaeche(); R.drawSpace(ctx, ansicht({ sz: szene, extra: { escorts: [al] } }), { x: 0, y: 0, w: 640, h: 360 }, { mode: 'tactical', zoom: 0.35, cx: 320, cy: 180, bound: { x: 0, y: 0, w: 640, h: 360 }, arcs: false, intel: true }); return rec; };
  const mint = win.Render.PAL.mint;
  const a = karte(true), b = karte(false);
  ok(a.ringe.some((r) => r.ss === mint), 'Karte (Ops/Captain) mit Sim-Szene: der Ring des Verbündeten ist Mint');
  ok(!b.ringe.some((r) => r.ss === mint), 'Karte ohne Sim-Szene: kein Mint-Ring (Kampagne, Limes, Eisenwald unverändert)');
}

console.log('\n(d) Label-Ausweichplätze nur für Randpfeil-Labels (prio 3)');
{
  // Ops-Karte: ein Gegner außerhalb (Randpfeil mit Label, prio 3) und eine Marke „CAPTAIN“ im Bild (Label prio 6)
  const szene = (sperren) => {
    const view = ansicht({ sz: false, extra: { enemies: [{ id: 'e1', kind: 'raider', x: 1200, y: -300, hp: 10, hpMax: 10, angle: 0 }] } });
    view.state.ship.markers = { captain: { x: 300, y: 200 } };
    const { ctx, rec } = neueFlaeche();
    R.drawSpace(ctx, view, { x: 0, y: 0, w: 640, h: 360 }, { mode: 'tactical', zoom: 0.35, cx: 320, cy: 180, bound: { x: 0, y: 0, w: 640, h: 360 }, arcs: false, intel: true, sperren, sight: Infinity });
    return rec.texte;
  };
  const frei = szene([]);
  const pf = frei.find((t) => /^\d+$/.test(t.s)), mk = frei.find((t) => /^CAPTAIN /.test(t.s));
  ok(!!pf && !!mk, 'Ausgangslage: Randpfeil-Label „' + (pf && pf.s) + '“ bei (' + (pf && pf.x) + ',' + (pf && pf.y) + '), Marken-Label „' + (mk && mk.s) + '“ bei (' + (mk && mk.x) + ',' + (mk && mk.y) + ')');
  if (pf && mk) {
    // alle Grundplätze (senkrecht 0, ±10, ±20, ±30, waagerecht ±0,6 w) sperren; die zusätzlichen Plätze (z. B. 0/+40) bleiben frei
    const sperre = (t) => { const w = R.measure(t.s, 1) + 2, l = t.x - w / 2; return [{ x: l, y: t.y - 30, w, h: 69 }, { x: l - 0.6 * w, y: t.y, w: 2.2 * w, h: 9 }]; };
    const geb = szene([...sperre(pf), ...sperre(mk)]);
    const pf2 = geb.find((t) => /^\d+$/.test(t.s)), mk2 = geb.find((t) => /^CAPTAIN /.test(t.s));
    ok(pf2 && (Math.abs(pf2.x - pf.x) > 0.5 || Math.abs(pf2.y - pf.y) > 0.5), 'Randpfeil-Label (prio 3) weicht auf einen zusätzlichen Platz aus: (' + pf.x + ',' + pf.y + ') -> (' + (pf2 && pf2.x) + ',' + (pf2 && pf2.y) + ')');
    ok(mk2 && Math.abs(mk2.x - mk.x) < 0.5 && Math.abs(mk2.y - mk.y) < 0.5, 'Marken-Label (prio 6) bleibt auf seinem Platz, die zusätzlichen Plätze gelten nur für Randpfeil-Labels: (' + mk.x + ',' + mk.y + ') -> (' + (mk2 && mk2.x) + ',' + (mk2 && mk2.y) + ')');
  }
}

console.log(fails ? `\n${fails} FEHLER` : `\n${n}/${n} Prüfungen ok`);
process.exit(fails ? 1 : 0);
