'use strict';
// KUL-02 B: Kugel- und Sternzeichner (public/js/kulisse-kugel.js). Reiner Zeichner, hier ohne DOM: Canvas-Fabrik mit Pixelpuffer-Attrappe, Zeichenkontext als Protokoll.
//   (a) fünf Arten: Bild der erwarteten Größe, Kugel deckt Mitte, Rand transparent
//   (b) deterministisch: gleicher Seed = gleiche Pixel (SHA-256), anderer Seed / andere Art = andere Pixel
//   (c) Lichtwinkel: die Lichtseite ist heller als die Gegenseite (alle Arten, zwei Richtungen)
//   (d) Zwischenspeicher: gleicher Aufruf erhöht nur treffer; Radius- und Winkelquantisierung teilen Einträge; Rotation und Abdunkeln bauen die Kugel nicht neu; LRU-Grenze hält
//   (e) Stern, Randlicht, Sternfeld zeichnen innerhalb des Rechtecks, Sternfeld dreht mit rot und ist deterministisch
//   (f) Mutation: Zwischenspeicher abgeschaltet, Grenze ignoriert, Lichtwinkel ignoriert -> die Prüfungen schlagen an
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const QUELLE = path.join(__dirname, '..', 'public', 'js', 'kulisse-kugel.js');
const sha = (b) => crypto.createHash('sha256').update(Buffer.from(b.buffer, b.byteOffset, b.byteLength)).digest('hex').slice(0, 16);

function neuesCanvas(w, h) {
  const cv = { width: w, height: h, daten: new Uint8ClampedArray(w * h * 4) };
  cv.getContext = () => ({ createImageData: (a, b) => ({ data: new Uint8ClampedArray(a * b * 4), width: a, height: b }), putImageData(img) { cv.daten.set(img.data); },
    drawImage() {}, fillRect() {}, set globalCompositeOperation(v) {}, set fillStyle(v) {} });
  return cv;
}
function protokoll() {
  const log = [];
  const grad = { addColorStop() {} };
  const fmt = (v) => (typeof v === 'object' ? '[o]' : typeof v === 'number' ? Math.round(v * 100) / 100 : v);
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : k === 'createRadialGradient' ? () => { log.push('grad'); return grad; } : (...a) => { log.push(k + ':' + JSON.stringify(a.map(fmt))); }),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return { ctx, log };
}
function lade(text) {
  const win = { document: null };
  win.window = win; vm.createContext(win);
  const mod = { exports: {} };
  vm.runInContext('(function(module){' + text + '\n})', win, { filename: 'kulisse-kugel.js' })(mod);
  const K = mod.exports; K.setzeCanvasFabrik(neuesCanvas);
  return K;
}

function pruefe(K, ok, ganz) {
  const section = (t) => console.log('\n' + t);
  const R = 12, ARTEN = ['fels', 'eis', 'wueste', 'ozean', 'gasriese'];
  const hell = (cv, links) => { let s = 0, n = 0; const S = cv.width; for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { if ((x < S / 2) !== links) continue; const i = (y * S + x) * 4; if (cv.daten[i + 3] === 255) { s += cv.daten[i] + cv.daten[i + 1] + cv.daten[i + 2]; n++; } } return n ? s / n : 0; };
  section('(a) Arten, Größe');
  K.leeren();
  const h = {};
  for (const a of ARTEN) {
    const cv = K.planet(a, R, 5, 0);
    const S = cv.width, mitte = (Math.floor(S / 2) * S + Math.floor(S / 2)) * 4;
    ok(cv.width === cv.height && cv.width >= 2 * R && cv.width <= 3 * R + 8, a + ': quadratisch, Größe ' + cv.width + ' für Radius ' + R);
    ok(cv.daten[mitte + 3] === 255 && cv.daten[3] === 0, a + ': Mitte deckend, Ecke transparent');
    h[a] = sha(cv.daten);
  }
  ok(new Set(Object.values(h)).size === 5, 'fünf Arten sehen verschieden aus');
  section('(b) deterministisch');
  K.leeren();
  const p1 = sha(K.planet('ozean', R, 7, 1).daten); K.leeren();
  ok(sha(K.planet('ozean', R, 7, 1).daten) === p1, 'gleicher Seed nach Leeren: gleiche Pixel');
  ok(sha(K.kugelPixel('ozean', R, 7, 1).daten) === p1, 'kugelPixel (ohne Cache) gleich');
  ok(sha(K.planet('ozean', R, 8, 1).daten) !== p1, 'anderer Seed: andere Pixel');
  section('(c) Lichtwinkel');
  for (const a of ARTEN) {
    K.leeren();
    const r = K.planet(a, 20, 3, 0), l = K.planet(a, 20, 3, Math.PI);
    ok(hell(r, false) > hell(r, true) * 1.15, a + ': Licht von rechts, rechte Hälfte heller (' + Math.round(hell(r, false)) + ' > ' + Math.round(hell(r, true)) + ')');
    ok(hell(l, true) > hell(l, false) * 1.15, a + ': Licht von links, linke Hälfte heller');
  }
  section('(d) Zwischenspeicher');
  K.leeren();
  K.planet('fels', 40, 1, 0.5);
  let s = K.statistik();
  ok(s.gebaut === 1 && s.treffer === 0, 'erster Aufruf baut (gebaut 1, treffer 0)');
  K.planet('fels', 40, 1, 0.5);
  s = K.statistik();
  ok(s.gebaut === 1 && s.treffer === 1, 'zweiter Aufruf gleicher Parameter: nur treffer +1');
  K.planet('fels', 41, 1, 0.52);
  s = K.statistik();
  ok(s.gebaut === 1 && s.treffer === 2, 'Radius 41 und Winkel +0,02 teilen den Eintrag (Quantisierung)');
  K.planet('fels', 48, 1, 0.5); K.planet('fels', 40, 2, 0.5); K.planet('eis', 40, 1, 0.5); K.planet('fels', 40, 1, 2.5);
  ok(K.statistik().gebaut === 5, 'andere Stufe, Seed, Art, Lichtwinkel bauen je neu');
  const { ctx, log } = protokoll();
  const vor = K.statistik();
  for (let i = 0; i < 30; i++) K.zeichnePlanet(ctx, 'fels', 100, 80, 40, 1, 0.5, i * 0.1, 0);
  s = K.statistik();
  ok(s.gebaut === vor.gebaut && s.treffer === vor.treffer + 30, '30 Zeichnungen mit wechselnder Rotation: nichts neu gebaut');
  ok(log.filter((x) => x.startsWith('rotate')).length === 29 && log.some((x) => x.startsWith('drawImage')), 'Rotation wird beim Zeichnen angewandt (Cache bleibt ungedreht)');
  for (let i = 0; i < 5; i++) K.zeichnePlanet(ctx, 'fels', 100, 80, 40, 1, 0.5, 0, 0.6);
  s = K.statistik();
  ok(s.gebaut === vor.gebaut && s.dunkelGebaut === 1, 'Abdunkeln: Fassung einmal erzeugt, Kugel nicht neu gebaut');
  K.leeren(); K.setzeGrenze(4);
  for (let i = 0; i < 10; i++) K.planet('fels', 8, i, 0);
  ok(K.statistik().eintraege === 4, 'LRU-Grenze 4 hält (Einträge ' + K.statistik().eintraege + ')');
  K.planet('fels', 8, 9, 0);
  ok(K.statistik().treffer === 1, 'jüngster Eintrag noch im Cache');
  K.planet('fels', 8, 0, 0);
  ok(K.statistik().gebaut === 11, 'ältester Eintrag wurde verdrängt (neu gebaut)');
  K.setzeGrenze(0);
  K.leeren();
  for (let i = 0; i < 30; i++) K.planet('fels', 8, i, 0);
  ok(K.statistik().eintraege === 24, 'Standardgrenze 24 (Einträge ' + K.statistik().eintraege + ')');
  if (ganz) {
    section('(e) Stern, Randlicht, Sternfeld');
    const a = protokoll(), rect = { x: 10, y: 20, w: 200, h: 100 };
    K.stern(a.ctx, 50, 50, 6, 'rot', 1);
    ok(a.log.filter((x) => x === 'grad').length === 4 && a.log.some((x) => x.startsWith('arc')), 'Stern: vier Glühringe und Kern');
    const b = protokoll(); K.randLicht(b.ctx, rect, 0, 'gelb');
    const rf = b.log.filter((x) => x.startsWith('fillRect'));
    ok(b.log.includes('rect:[10,20,200,100]') && b.log.includes('clip:[]') && rf.length === 2, 'Randlicht beschnitten aufs Rechteck');
    ok(rf[1].startsWith('fillRect:[208,'), 'Randlicht Peilung 0: Marke am rechten Rand (' + rf[1] + ')');
    const c = protokoll(); K.randLicht(c.ctx, rect, Math.PI / 2, 'weiss');
    ok(c.log.filter((x) => x.startsWith('fillRect'))[1].includes(',118,'), 'Randlicht Peilung unten: Marke am unteren Rand');
    const f1 = protokoll(), f2 = protokoll(), f3 = protokoll();
    K.sternfeld(f1.ctx, rect, 0, 5); K.sternfeld(f2.ctx, rect, 0, 5); K.sternfeld(f3.ctx, rect, 0.7, 5);
    const sterne = (p) => p.log.filter((x) => x.startsWith('fillRect'));
    ok(sterne(f1).length > 60 && f1.log.join() === f2.log.join(), 'Sternfeld: deterministisch, viele Sterne (' + sterne(f1).length + ')');
    ok(f3.log.join() !== f1.log.join(), 'Sternfeld dreht mit rot');
    const innen = sterne(f3).every((x) => { const [px, py] = JSON.parse(x.slice(9)); return px >= 10 && py >= 20 && px < 210 && py < 120; });
    ok(innen, 'Sterne nur innerhalb des Rechtecks');
  }
}

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const text = fs.readFileSync(QUELLE, 'utf8').replace(/\r\n/g, '\n');
pruefe(lade(text), ok, true);

console.log('\n(f) Mutationen');
const MUT = [
  ['Zwischenspeicher abgeschaltet', 'if (e) { cache.delete(key); cache.set(key, e); treffer++; return e; }', 'if (false) { return e; }'],
  ['Grenze ignoriert', 'while (cache.size > max)', 'while (false)'],
  ['Lichtwinkel ignoriert', 'Math.cos(lichtWinkel) * 0.9, ly0 = Math.sin(lichtWinkel) * 0.9', '0.9, ly0 = 0'],
];
for (const [name, von, nach] of MUT) {
  if (!text.includes(von)) { ok(false, 'Mutation ' + name + ': Stelle nicht gefunden'); continue; }
  let f = 0;
  const orig = console.log; console.log = () => {};
  try { pruefe(lade(text.replace(von, nach)), (c) => { if (!c) f++; }, false); } finally { console.log = orig; }
  ok(f > 0, 'Mutation "' + name + '" -> ' + f + ' Prüfungen schlagen an');
}
console.log('\n' + (fails ? fails + ' FEHLER von ' + n : 'alle ' + n + ' Prüfungen grün'));
process.exit(fails ? 1 : 0);
