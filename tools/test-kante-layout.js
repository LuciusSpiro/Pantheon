'use strict';
// KUL-02 Nacharbeit: Kantenleiste am Sitz (Sitz.zeichneKante via draw im Blick VORN). Werte haben Vorrang vor den rechtsbündigen Hinweisen;
// bei Platzmangel kommt die kurze Fassung oder gar kein Hinweis, nie überlappen zwei Textrechtecke. 5 px je Zeichen im Stub, Texthöhe 9.
//   node tools/test-kante-layout.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

const stub = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 0 }) : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
const BREITE = 5, HOEHE = 9;
let texte = [];
const mess = (t) => String(t).length * BREITE;
const R = { PAL: new Proxy({}, { get: () => '#fff' }), ui: { buttons: [] }, measure: (t) => mess(t), FRONT: { fwd: 1, back: 1 }, drawFrontView() {},
  text(ctx, t, x, y, o) { const w = mess(t); const l = o && o.align === 'right' ? x - w : o && o.align === 'center' ? x - w / 2 : x; texte.push({ t: String(t), l, r: l + w, y, o: y + HOEHE }); } };
let zonenWert = '–', cdAktiv = false;
const PultSysteme = { banderole: (rt) => (cdAktiv ? { zahl: 42 } : null), TOKENS: { TEXT: { kanteLabel: 'REAKTOR', kanteWert: 'x' }, FARBE: { zerText: '#f00', besch: '#fa0' } },
  text: () => 'ZERSTOERUNG IN 42 S · AUSFAELLE 3', statusFeld: () => ({ l: 'ZONEN', v: zonenWert, zust: 'ok' }) };
const win = { Shared_Maps: require('../shared/maps.js'), Shared_Physics: require('../shared/physics.js'), Hud: { szeneVon: () => null }, PultSysteme,
  Render: R, Consoles: { targetOf: () => ({ station: true, name: 'ALTE-FESTUNG-TRAEGER' }), draw() {}, helmInfo: () => ({ names: ['VOLLE KRAFT VORAUS'], stage: 0 }) },
  VoxelRender: { ready: true, mode: 'voxel', renderer: { setSeat() {} } }, Client: { pid: 'a', mouse: { x: 320, y: 180 } }, Net: { reportError() {}, guard: (n, f) => f() },
  document: { createElement: () => ({ getContext: () => stub, style: {}, width: 0, height: 0 }) },
  location: { search: '' }, URLSearchParams, performance: { now: () => 0 }, console };
win.window = win; win.self = win;
vm.createContext(win);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'hauptschirm.js'), 'utf8'), win, { filename: 'hauptschirm.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'sitz.js'), 'utf8'), win, { filename: 'sitz.js' });
const Sitz = win.Sitz;

const lauf = (st, blick, cd, zonen) => {
  zonenWert = zonen; cdAktiv = cd; texte = [];
  const view = { me: { console: st }, self: { zone: 'ship', x: 0, y: 0 }, time: 0, state: { ship: { speed: 12, angle: 1, reaktorTod: cd ? { n: 3 } : null }, flotte: {} } };
  win.Client.mouse = { x: 320, y: 180 };
  Sitz.update(view, 1); Sitz.update(view, 1);
  if (blick === 'crew') win.Client.mouse = { x: 2, y: 180 };
  for (let i = 0; i < 40; i++) Sitz.update(view, 0.2);
  Sitz.draw(stub, view);
  return texte.filter((t) => t.y >= 300);   // nur die Kantenleiste (unten)
};
const ueberlappt = (a, b) => a.l < b.r && b.l < a.r && a.y < b.o && b.y < a.o;
const paare = (ts) => { const f = []; for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) if (ueberlappt(ts[i], ts[j])) f.push(ts[i].t + ' x ' + ts[j].t); return f; };

let hinweisGezeigt = 0;
for (const st of ['helm', 'weapons', 'captain']) {
  for (const cd of [false, true]) {
    for (const zonen of ['RUHIG', 'REAKTOR ZERSTOERT', 'MITTE OFFEN - SEITE LINKS SCHWACH']) {
      const ts = lauf(st, 'vorn', cd, zonen);
      const f = paare(ts);
      ok(ts.length > 4 && f.length === 0, st + (cd ? ' mit Countdown' : '') + ', ZONEN ' + zonen + ': keine überlappenden Texte' + (f.length ? ' (' + f[0] + ')' : ''));
      if (!cd && ts.some((t) => /Pult/.test(t.t))) hinweisGezeigt++;
      // Werte vollständig vorhanden (Vorrang): ZONEN-Wert immer gezeichnet
      ok(ts.some((t) => t.t === zonen), st + ': Wert ' + zonen + ' gezeichnet');
    }
  }
}
{
  const ts = lauf('helm', 'vorn', false, 'RUHIG');
  ok(ts.some((t) => t.t === 'ANSICHT') && ts.some((t) => t.t === 'KLASSISCH'), 'Steuer zeigt weiter ANSICHT / KLASSISCH');
  ok(ts.some((t) => /Pult/.test(t.t)), 'Steuer: ein (ggf. kurzer) Hinweis bleibt sichtbar bei normalem Wert');
}
{
  const ts = lauf('helm', 'crew', false, 'RUHIG');
  ok(paare(ts).length === 0, 'Blick Crew: keine Überlappung');
}
ok(hinweisGezeigt > 0, 'Hinweis erscheint, wo Platz ist (' + hinweisGezeigt + ' Fälle)');
console.log(fails ? '\n' + fails + ' von ' + n + ' FEHLER' : '\nalle ' + n + ' ok');
process.exit(fails ? 1 : 0);
