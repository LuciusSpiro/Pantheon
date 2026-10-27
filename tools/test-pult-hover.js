'use strict';
// SUND-03 F2 Z1: Pult.knopf (public/js/pult.js) mit der Maus auf einem Knopf mit reason. Früher stand dort `zustand === 'off'` ohne dass `zustand` in knopf definiert war: eine ReferenceError in JEDEM Frame,
// solange die Maus auf einem Knopf mit reason lag (z. B. der gedimmte Kurs-Knopf vor Tribun); sie brach das Zeichnen des Terminals ab. Pult.zelle (dort gibt es zustand) zeigt den Hinweis auch für eine
// gedimmte, anklickbare Zelle (zustand off). Ohne Browser: pult.js in einem vm-Kontext mit Attrappen für Render und Zeichenfläche.
//   node tools/test-pult-hover.js   (npm run test:pult-hover)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

const tief = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : tief()), apply: () => tief() });
function lade() {
  const R = { PAL: new Proxy({}, { get: () => '#888888' }), ui: { buttons: [], mouse: { x: -1, y: -1 }, tooltip: null }, text() {}, measure: (s) => String(s).length * 6, button() {} };
  const win = { Render: R, Shared_Config: { shipClasses: {} }, document: { getElementById: () => null }, location: { search: '' }, URLSearchParams, localStorage: { getItem: () => null }, console };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pult.js'), 'utf8'), win, { filename: 'pult.js' });
  return { P: win.Pult, R };
}
const ctx = () => tief();

const { P, R } = lade();
ok(P && typeof P.knopf === 'function' && typeof P.zelle === 'function', 'Pult mit knopf und zelle geladen');
const sag = (f) => { try { f(); return null; } catch (e) { return e; } };

// Maus auf einem gedimmten Knopf mit reason: kein Fehler, Tooltip mit dem Grund
R.ui.buttons.length = 0; R.ui.tooltip = null; R.ui.mouse = { x: 15, y: 15 };
let b, e = sag(() => { b = P.knopf(ctx(), 10, 10, 60, 14, 'Kurs', { disabled: true, reason: 'Erst ab Tribun' }); });
ok(e === null, 'knopf mit disabled und reason, Maus darauf: keine Ausnahme' + (e ? ' (' + e.message + ')' : ''));
ok(R.ui.tooltip && R.ui.tooltip.text === 'Erst ab Tribun' && R.ui.tooltip.x === 15 && R.ui.tooltip.y === 15, 'der Tooltip-Pfad wird erreicht (Text, Ort der Maus)');
ok(b && b.disabled === true && R.ui.buttons.includes(b), 'der Knopf bleibt registriert und gedimmt');

// der gedimmte, anklickbare Kurs-Knopf (gedimmt: true, nicht disabled): der Grund erscheint als Tooltip (die Absicht des alten `zustand === 'off'`)
R.ui.buttons.length = 0; R.ui.tooltip = null; R.ui.mouse = { x: 15, y: 15 };
e = sag(() => P.knopf(ctx(), 10, 10, 60, 14, 'Kurs', { gedimmt: true, fn: 'neutral', reason: 'Erst ab Tribun', onClick() {} }));
ok(e === null && R.ui.tooltip && R.ui.tooltip.text === 'Erst ab Tribun', 'gedimmter, anklickbarer Knopf (Kurs vor Tribun): keine Ausnahme, Tooltip mit dem Grund');

// Welle 5 (K3): kontur: true zeichnet keine Farbfläche (Rand und Text statt voller Funktionsfarbe), gesperrt bleibt der Skin-Knopf
{
  const rects = [], texte = [];
  const rc = new Proxy({}, { get: (t, k) => (k === 'fillRect' ? (x, y, w, h) => rects.push({ x, y, w, h, c: rc.fillStyle }) : t[k]), set: (t, k, v) => { t[k] = v; return true; } });
  R.text = (c, s, x, y, o) => texte.push({ s, c: o && o.color });
  R.ui.buttons.length = 0; R.ui.mouse = { x: -1, y: -1 };
  const FNn = P.FN.neutral;
  P.knopf(rc, 10, 10, 100, 14, 'Schlacht ablehnen', { fn: 'neutral', hotkey: 'N', onClick() {} });
  const flaecheVon = (liste) => liste.filter((q) => q.c === FNn).reduce((a, q) => a + q.w * q.h, 0);   // Fläche in der Funktionsfarbe (der Skin zeichnet in Streifen)
  const flaeche = flaecheVon(rects);
  rects.length = 0; texte.length = 0; R.ui.buttons.length = 0;
  P.knopf(rc, 10, 10, 100, 14, 'Schlacht ablehnen', { fn: 'neutral', kontur: true, hotkey: 'N', onClick() {} });
  const flaeche2 = flaecheVon(rects);
  ok(flaeche > 500 && flaeche2 === 0, 'Knopf mit kontur: keine Fläche in der Funktionsfarbe (normal ' + flaeche + ' px², kontur ' + flaeche2 + ' px²)');
  ok(rects.some((q) => q.w === 100 && q.h === 1) && rects.some((q) => q.h === 14 && q.w === 1), 'Knopf mit kontur: 1-px-Rand rundum');
  ok(texte.some((t) => t.s === 'Schlacht ablehnen') && R.ui.buttons.length === 1 && R.ui.buttons[0].label === 'Schlacht ablehnen', 'Knopf mit kontur: Text da, als Knopf registriert');
  rects.length = 0; texte.length = 0; R.ui.buttons.length = 0;
  P.knopf(rc, 10, 10, 100, 14, 'Schlacht ablehnen', { fn: 'neutral', kontur: true, disabled: true, hotkey: 'N' });
  ok(rects.filter((q) => q.w === 1 && q.h === 1).length > 10, 'gesperrt mit kontur: der gepunktete Rand des Skins');
  R.text = () => {};
}

// Maus auf einem freigegebenen Knopf mit reason: kein Tooltip (Verhalten wie vorher), keine Ausnahme
R.ui.buttons.length = 0; R.ui.tooltip = null;
e = sag(() => P.knopf(ctx(), 10, 10, 60, 14, 'Annehmen', { reason: 'nur ein Hinweis', onClick() {} }));
ok(e === null && R.ui.tooltip === null, 'ein freigegebener Knopf mit reason zeigt keinen Tooltip, keine Ausnahme');

// Maus daneben: kein Tooltip
R.ui.tooltip = null; R.ui.mouse = { x: 200, y: 200 };
e = sag(() => P.knopf(ctx(), 10, 10, 60, 14, 'Kurs', { disabled: true, reason: 'Erst ab Tribun' }));
ok(e === null && R.ui.tooltip === null, 'Maus daneben: kein Tooltip');

// ohne reason, Maus darauf
R.ui.mouse = { x: 15, y: 15 };
e = sag(() => P.knopf(ctx(), 10, 10, 60, 14, 'Kurs', { disabled: true }));
ok(e === null && R.ui.tooltip === null, 'gedimmt ohne reason: kein Tooltip, keine Ausnahme');

// viele Frames hintereinander (der Fehler trat in jedem Frame auf)
let fehler = 0;
for (let i = 0; i < 100; i++) { R.ui.buttons.length = 0; if (sag(() => P.knopf(ctx(), 10, 10, 60, 14, 'Kurs', { disabled: true, reason: 'Erst ab Tribun' }))) fehler++; }
ok(fehler === 0, '100 Frames mit der Maus auf dem gedimmten Knopf: 0 Ausnahmen');

// zelle: gedimmt (off) und anklickbar mit reason zeigt den Hinweis, gesperrt ohne klickbar ebenfalls, aktiv nicht
for (const [zustand, opts, erwartet] of [['off', { klickbar: true, reason: 'Platz gesperrt' }, true], ['off', { reason: 'Platz gesperrt' }, true], ['an', { reason: 'Platz gesperrt' }, false], ['off', { klickbar: true }, false]]) {
  R.ui.buttons.length = 0; R.ui.tooltip = null; R.ui.mouse = { x: 15, y: 15 };
  e = sag(() => P.zelle(ctx(), 10, 10, 80, 24, 'A', 'Lanze', 'bereit', 'weapon', zustand, 0, opts));
  ok(e === null && (R.ui.tooltip !== null) === erwartet, `zelle ${zustand}${opts.klickbar ? ' klickbar' : ''}${opts.reason ? ' mit reason' : ''}: Tooltip ${erwartet ? 'ja' : 'nein'}, keine Ausnahme`);
}
console.log(`\n${n - fails} von ${n} ok` + (fails ? `, ${fails} FEHLER` : ''));
process.exit(fails ? 1 : 0);
