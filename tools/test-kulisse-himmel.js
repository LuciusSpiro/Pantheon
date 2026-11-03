'use strict';
// KUL-02 C: Himmelsschicht des klassischen Hauptschirms (public/js/kulisse-himmel.js) mit dem ECHTEN render.js, starmap.js und den Tokens (vm, Canvas-Attrappe mit Aufrufprotokoll).
//   (a) Peilung: Kreuzweg 0503, Frostgrat 0402 (Limes) und Sund 0503 (Gasfeld, Karte sund): jeder Stern, Planet und jede Boje liegt in der Peilung der Karte (Kurse 0°, 90°, 217°)
//   (b) Zeichenreihenfolge: Sternenhimmel von drawSpace < Kulisse < Zonen und alle Beschriftungen/Spielobjekte; Pult ohne rect.himmel zeichnet keine Kulisse
//   (c) Zwischenspeicher: 60 Frames mit wechselndem Kurs bauen nicht mehr Kugeln als Planeten da sind
//   (d) Gasriese mit Zonen (scene.zonen) wird von der Kulisse NICHT als Kugel gezeichnet (drawZonen zeichnet ihn), ohne Zonen schon; Höhenlinien nur mit Zonen und nur für sichtbare Schichten
//       (sichtbarFuer 'karte' erst nach dem Erkunden = st.zonen.bk, Freigabe sv, abgeschaltete Gruppe au); die Kulisse schreibt KEINE Namen, drawZonen setzt sie dynamisch (frei von Tafeln und Rand, je einmal)
//   (e) leere und fehlerhafte Szenen, fehlende Felder, kein Schiff: wirft nicht, ctx.save/restore bleiben ausgeglichen
//   (f) Pult-Frontsicht unverändert: tools/test-frontsicht.js bleibt grün (Kindprozess, Exit-Code)
//   (g) Mutationen: Parallaxe 1 -> Peilung bleibt grün, Position (Abstand = 0,45 ×) rot; Kulisse nach drawFrontView -> Reihenfolge rot
//   (h) Hyperraum zeichnet nichts, Nebel ohne Himmelsgrund und Sternfeld; Stern-Lichtwinkel der Planeten zeigt zum nächsten Stern
//   (j) KUL-02 N1: Namen dynamisch und frei, Nebel zeigt nur, was in der halben Sicht liegt; Randlicht unten ±72 px von der Lerche weg; Navboje mit dunklem Saum; save/restore bei Fehlern in zeichnePlanet und stern
//   (i) Keine Kollision: Sim fliegt durch Planet (Frostgrat), Stern und Boje (Kreuzweg) ohne Schaden und ohne Bremsung; im Server nutzt nur besitz.js (Standortwahl) Planeten
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const Locs = require('../shared/locations.js');
const Sektoren = require('../shared/sektoren.js');
const Welt = require('../server/sim/welt.js');
const Zonen = require('../shared/zonen.js');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const info = (t) => console.log('  info ' + t);
const rd = (f) => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8').replace(/\r\n/g, '\n');
const rad = (g) => g * Math.PI / 180;
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

// ------------------------------------------------------------------ Zeichenfläche
function neueFlaeche(log) {
  const st = { fillStyle: '#000', strokeStyle: '#000', font: '8px monospace', textAlign: 'left' };
  const grad = { addColorStop(a, b) { log.push('stop:' + a + ',' + b); } };
  const f = { measureText: (s) => ({ width: String(s).length * 5 }), createLinearGradient: () => grad, createRadialGradient: () => grad };
  const fmt = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : typeof v === 'object' ? '[o]' : v);
  return new Proxy(f, {
    get: (t, k) => (k in t ? t[k] : k in st ? st[k] : typeof k === 'string' ? (...a) => { log.push(k + ':' + JSON.stringify(a.map(fmt))); } : undefined),
    set: (t, k, v) => { st[k] = v; log.push('=' + String(k) + ':' + JSON.stringify(fmt(v))); return true; },
  });
}
const stub = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 0 }) : () => {}), set: () => true });
const stubM = new Proxy({}, { get: (t, k) => (k === 'measureText' ? (s) => ({ width: String(s).length * 8 }) : () => {}), set: () => true });   // Textbreite 8 px je Zeichen (Namenskästen)
function pixelCanvas(w, h) {
  const cv = { width: w, height: h, daten: new Uint8ClampedArray(w * h * 4) };
  cv.getContext = () => ({ createImageData: (a, b) => ({ data: new Uint8ClampedArray(a * b * 4), width: a, height: b }), putImageData(img) { cv.daten.set(img.data); }, drawImage() {}, fillRect() {}, set globalCompositeOperation(v) {}, set fillStyle(v) {} });
  return cv;
}

// ------------------------------------------------------------------ Umgebung (echte Skripte im vm)
const FAKE = {};   // Testszenen: id -> { id, scene, fog? }
function umgebung(q) {
  q = q || {};
  const meldungen = [];
  const win = { Shared_Maps: require('../shared/maps.js'), Shared_Physics: require('../shared/physics.js'), Shared_Config: require('../shared/config.js'), Shared_Protocol: require('../shared/protocol.js'),
    Shared_Zonen: Zonen, Shared_Locations: { get: (id) => (FAKE[id] !== undefined ? FAKE[id] : Locs.get(id)) }, Net: { reportError: (l, e) => meldungen.push(l + ': ' + (e && e.message)) },
    document: { createElement: () => ({ getContext: () => stubM, style: {}, width: 0, height: 0 }), querySelector: () => null, head: { appendChild() {} }, getElementById: () => null },
    console: Object.assign({}, console, { warn(l, ...r) { if (l !== 'Lerche.sprite') console.warn(l, ...r); } }), Image: function () {}, performance: { now: () => 0 }, location: { search: '' } };
  win.window = win; win.self = win; win.meldungen = meldungen;
  vm.createContext(win);
  const lade = (f) => vm.runInContext(q[f] != null ? q[f] : rd(f), win, { filename: f });
  win.IconsB = { boje(ctx, z, x, y, zoom, w) { ctx.rect(x, y, w, zoom); return true; } };
  for (const f of ['kennung.js', 'render.js', 'kartenlogik.js', 'sonden.js', 'spur.js', 'kartenzeichen.js', 'karte-tokens.js', 'kartenansicht.js', 'starmap.js', 'hauptschirm-tokens.js', 'kulisse-kugel.js', 'kulisse-himmel.js']) lade(f);
  win.Hud = { szeneVon: () => null };
  win.KulisseKugel.setzeCanvasFabrik(pixelCanvas);
  return win;
}

// ------------------------------------------------------------------ Ansicht
const RECT = (() => { const zoom = 288 / 820; return { x: 0, y: 0, w: 512, h: 288, side: 256 / zoom, sicht: { x: 0, y: 0, w: 512, h: 288 } }; })();
function ansicht(szeneId, kursGrad, o) {
  o = o || {};
  const loc = o.loc !== undefined ? o.loc : (FAKE[szeneId] || Locs.get(szeneId));
  const a = (loc && loc.scene && loc.scene.arrive) || { x: 600, y: 1100 };
  const ship = { x: o.x != null ? o.x : a.x, y: o.y != null ? o.y : a.y, angle: rad(kursGrad), hull: 100, scene: szeneId, jump: o.jump || {}, mounts: [] };
  const sc = (loc && loc.scene) || {};
  const f = (vor, seit) => ({ x: ship.x + Math.cos(ship.angle) * vor - Math.sin(ship.angle) * seit, y: ship.y + Math.sin(ship.angle) * vor + Math.cos(ship.angle) * seit });
  const space = { w: sc.w || 3000, h: sc.h || 2200, so: [], jp: o.jp || [], markers: [Object.assign({ id: 'h', kind: 'station', name: 'Hafen' }, f(260, 90))], hidden: [], salvage: [], mines: [] };
  const enemies = [Object.assign({ id: 'e1', kind: 'raider', vk: 'ger', hp: 10, hpMax: 10, angle: 1, shields: [2, 2, 2, 2] }, f(200, 40))];
  return { time: 1, me: { console: 'helm' }, ship: null, enemies, escorts: [], spaceProjectiles: [],
    state: { time: 1, ship, space, players: [], flotte: {}, inventory: { sonde: 2 }, zonen: { in: [], bk: [] }, world: { location: szeneId } } };
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function setzeKarte(id) { const k = Welt.karte(id); if (!k) throw new Error('Karte ' + id); Sektoren.setzeKarte(k); }

const SZENEN = [
  { name: 'Kreuzweg 0503', hex: '0503', id: 'kreuzweg', karte: 'limes' },
  { name: 'Frostgrat 0402', hex: '0402', id: 'frostgrat', karte: 'limes' },
  { name: 'Sund 0503 (Gasfeld)', hex: '0503', id: 'gasfeld', karte: 'sund' },
];
const KURSE = [0, 90, 217];

// ------------------------------------------------------------------ (a) Peilung und (g) Position, als Funktionen für die Mutationen
function pruefePeilung(win, rep) {
  const KH = win.KulisseHimmel, R = win.Render;
  let geprueft = 0;
  for (const S of SZENEN) {
    setzeKarte(S.karte);
    for (const kurs of KURSE) {
      const v = ansicht(S.id, kurs), L = KH.plan(v, RECT), P = R.frontProjektion(v, RECT), sh = v.state.ship, tag = S.name + ' Kurs ' + kurs;
      const erwartet = (wx, wy) => Math.atan2(wy - sh.y, wx - sh.x) + P.rot;   // Karte (Nord oben, y nach unten) ins Bild gedreht
      const pruef = (it, wx, wy, was) => {
        const d = Math.hypot(it.x - P.cx, it.y - P.cy); if (d < 8) return;
        geprueft++;
        rep(angDiff(Math.atan2(it.y - P.cy, it.x - P.cx), erwartet(wx, wy)) * d <= 2.5, tag + ': ' + was + ' in der Peilung der Karte');
      };
      for (const s of L.sterne) { geprueft++; rep(angDiff(s.winkel, erwartet(s.wx, s.wy)) < 1e-9 && (s.versetzt ? Math.abs(Math.abs(s.x - P.cx) - 72) < 1e-9 : angDiff(Math.atan2(s.y - P.cy, s.x - P.cx), s.winkel) < 0.01) && s.x >= 0 && s.x <= 512 && s.y >= 0 && s.y <= 288, tag + ': Stern am Bildrand in der Peilung der Karte'); }
      for (const p of L.planeten) pruef(p, p.wx, p.wy, 'Planet ' + p.art);
      for (const b of L.bojen) pruef(b, b.wx, b.wy, 'Boje');
    }
  }
  return geprueft;
}
function pruefePosition(win, rep) {
  const KH = win.KulisseHimmel, R = win.Render, TK = win.HauptschirmTokens.TOKENS;
  let geprueft = 0;
  for (const S of SZENEN) {
    setzeKarte(S.karte);
    for (const kurs of KURSE) {
      const v = ansicht(S.id, kurs), L = KH.plan(v, RECT), P = R.frontProjektion(v, RECT), sc = Locs.get(S.id).scene;
      for (const p of L.planeten) {
        const echt = P.toS(p.wx, p.wy), d0 = Math.hypot(echt.x - P.cx, echt.y - P.cy), d1 = Math.hypot(p.x - P.cx, p.y - P.cy), orig = sc.planeten.find((q) => q.x === p.wx && q.y === p.wy);
        geprueft++;
        rep(Math.abs(d1 - 0.45 * d0) <= 2 && Math.abs(p.r - 0.9 * orig.r * P.zoom) < 1e-6, S.name + ' Kurs ' + kurs + ': Planet ' + p.art + ' mit 45 % Abstand und 0,9 × Radius (' + Math.round(d1) + ' von ' + Math.round(d0) + ')');
      }
      void TK;
    }
  }
  return geprueft;
}

// ------------------------------------------------------------------ (b) Reihenfolge
const KS = 'KULISSE-ANFANG', KE = 'KULISSE-ENDE';
function reihenfolge(win, rep, mitHimmel) {
  const out = {};
  for (const S of SZENEN) {
    setzeKarte(S.karte);
    const log = [], c = neueFlaeche(log), v = ansicht(S.id, 90);
    const KH = win.KulisseHimmel, orig = KH.zeichne;
    const rect = Object.assign({}, RECT);
    if (mitHimmel) rect.himmel = (cx) => { log.push(KS); orig(cx, v, rect); log.push(KE); };
    win.Render.drawFrontView(c, v, rect);
    const a = log.indexOf(KS), e = log.indexOf(KE);
    const stern = log.indexOf('=fillStyle:"#0B0E1A"');   // drawSpace: fbStarfield füllt mit PAL.space, die Kulisse legt ihren Grund darüber
    const text = log.findIndex((l, i) => (i < a || i > e || a < 0) && /^fillText/.test(l));
    const zone = log.findIndex((l) => /^stop:0,#b8793a/.test(l));   // drawZonen: Scheibe des Gasriesen
    out[S.name] = { a, e, stern, text, zone, n: log.length };
    if (rep) {
      rep(mitHimmel ? a > stern && stern >= 0 && e > a : a < 0, S.name + ': ' + (mitHimmel ? 'Kulisse nach dem Sternenhimmel von drawSpace' : 'Pult (ohne rect.himmel): keine Kulisse'));
      if (mitHimmel) {
        rep(e < text, S.name + ': Kulisse vor allen Beschriftungen und Spielobjekten (Ende ' + e + ' < erster Text ' + text + ')');
        if (S.id === 'gasfeld') rep(zone >= 0 && e < zone, S.name + ': Kulisse vor drawZonen (Scheibe/Zonen) (Ende ' + e + ' < ' + zone + ')');
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ Lauf
const win = umgebung();
const KH = win.KulisseHimmel, K = win.KulisseKugel, R = win.Render, TK = win.HauptschirmTokens.TOKENS;

section('(a) Peilung: Kreuzweg 0503, Frostgrat 0402, Sund 0503 (Karte) bei Kurs 0°, 90°, 217°');
{
  setzeKarte('limes');
  ok(Sektoren.hexVonOrt('kreuzweg') === '0503' && Sektoren.hexVonOrt('frostgrat') === '0402', 'Hex-Kennungen: kreuzweg = 0503, frostgrat = 0402 (Limes)');
  setzeKarte('sund');
  ok(Sektoren.hexVonOrt('gasfeld') === '0503', 'Hex-Kennung: gasfeld = 0503 (Sund)');
  const sc = (id, k) => { setzeKarte(k); return Locs.get(id).scene; };
  ok(sc('kreuzweg', 'limes').stern.length >= 1 && sc('kreuzweg', 'limes').bojen.length >= 1, 'Kreuzweg: Stern und Bojen in den Daten');
  ok(sc('frostgrat', 'limes').planeten.length === 2, 'Frostgrat: zwei Planeten in den Daten');
  const gf = sc('gasfeld', 'sund');
  ok(gf.planeten.length === 1 && gf.planeten[0].art === 'gasriese' && gf.zonen.length > 0, 'Sund 0503: Gasriese mit Zonen in den Daten');
  let fehler = 0;
  const g = pruefePeilung(win, (c, t) => { if (!c) { fehler++; console.log('  FEHLER ' + t); n++; fails++; } });
  ok(fehler === 0 && g >= 30, 'alle ' + g + ' Sterne, Planeten und Bojen liegen in der Peilung der Karte');
  fehler = 0;
  const p = pruefePosition(win, (c, t) => { if (!c) { fehler++; console.log('  FEHLER ' + t); n++; fails++; } });
  ok(fehler === 0 && p >= 6, 'Position: Abstand der Planeten = 0,45 × Abstand zur Karte, Radius 0,9 × r × Zoom (' + p + ' Planeten, Frostgrat)');
  // Nichts von der Kulisse hängt am Kurs der Lage: Planeten bleiben für das Schiff, das sich dreht, auf einem Kreis um die Schiffsmitte
  setzeKarte('limes');
  const Pm = R.frontProjektion(ansicht('frostgrat', 0), RECT);
  const r0 = KH.plan(ansicht('frostgrat', 0), RECT).planeten.map((q) => Math.round(Math.hypot(q.x - Pm.cx, q.y - Pm.cy))), r1 = KH.plan(ansicht('frostgrat', 217), RECT).planeten.map((q) => Math.round(Math.hypot(q.x - Pm.cx, q.y - Pm.cy)));
  ok(r0.every((v, i) => Math.abs(v - r1[i]) <= 2), 'Drehen des Kurses ändert den Abstand der Planeten zur Schiffsmitte nicht (' + r0 + ' / ' + r1 + ')');
}

section('(b) Zeichenreihenfolge');
{
  reihenfolge(win, ok, true);
  reihenfolge(win, ok, false);
}

section('(c) Zwischenspeicher');
{
  setzeKarte('limes');
  K.leeren();
  const log = [], c = neueFlaeche(log);
  const planeten = Locs.get('frostgrat').scene.planeten.length;
  for (let i = 0; i < 60; i++) {
    const v = ansicht('frostgrat', i * 6.1, { x: 600 + i * 7, y: 1100 - i * 3 });
    v.time = i / 20;
    KH.zeichne(c, v, RECT);
  }
  const s = K.statistik();
  ok(s.gebaut > 0 && s.gebaut <= planeten, '60 Frames mit wechselndem Kurs: gebaut ' + s.gebaut + ' ≤ ' + planeten + ' Planeten');
  ok(s.treffer >= 60, 'Rest aus dem Zwischenspeicher (Treffer ' + s.treffer + ')');
  ok(log.filter((l) => /^drawImage/.test(l)).length >= 60, 'Planeten werden gezeichnet (drawImage ' + log.filter((l) => /^drawImage/.test(l)).length + ')');
}

section('(d) Gasriese mit und ohne Zonen');
{
  setzeKarte('sund');
  const gas = Locs.get('gasfeld').scene.planeten[0];
  const vM = ansicht('gasfeld', 30);
  const lM = KH.plan(vM, RECT);
  ok(lM.planeten.length === 0 && lM.gas.length === 1, 'mit Zonen: keine Kugel in der Kulisse, ein Gasriese mit Linien (drawZonen zeichnet die Scheibe)');
  const gz = Locs.get('gasfeld').scene.zonen, ringId = (nm) => gz.find((z) => z.form === 'ring' && z.name.toUpperCase() === nm.toUpperCase()).id;
  const namen = (v) => KH.plan(v, RECT).gas[0].linien.map((l) => l.name).join();
  // B1: sichtbarFuer 'karte' erst nach dem Erkunden; ohne Erkundung nur die Hochatmosphäre ('alle')
  ok(namen(vM) === 'HOCHATMOSPHÄRE', 'unerkundet (bk = []): nur die Hochatmosphäre (sichtbarFuer alle), keine Wolkendecke/Förderschicht/Tiefe: ' + namen(vM));
  const vB = ansicht('gasfeld', 30); vB.state.zonen = { in: [], bk: [ringId('Förderschicht')] };
  ok(namen(vB) === 'HOCHATMOSPHÄRE,FÖRDERSCHICHT', 'bk = [Förderschicht]: Hochatmosphäre und Förderschicht: ' + namen(vB));
  ok(KH.plan(vB, RECT).gas[0].linien.find((l) => l.name === 'FÖRDERSCHICHT').k === 2, 'der Linienstil zählt über alle vier Grenzen (Förderschicht = Index 2, nicht 1)');
  const vS = ansicht('gasfeld', 30); vS.state.zonen = { in: [], bk: [], sv: [ringId('Tiefe')] };
  ok(namen(vS) === 'HOCHATMOSPHÄRE,TIEFE', 'sv (vom Regiebuch freigegeben) = Tiefe sichtbar: ' + namen(vS));
  const vA = ansicht('gasfeld', 30); vA.state.zonen = { in: [], bk: gz.map((z) => z.id) };
  ok(namen(vA) === 'HOCHATMOSPHÄRE,WOLKENDECKE,FÖRDERSCHICHT,TIEFE', 'alles erkundet (bk = alle): vier Linien: ' + namen(vA));
  FAKE.gas_gruppe = { id: 'gas_gruppe', scene: Object.assign({}, Locs.get('gasfeld').scene, { zonen: gz.map((z) => (z.name === 'Wolkendecke' ? Object.assign({}, z, { gruppe: 'halt' }) : z)) }) };
  const vG = ansicht('gas_gruppe', 30); vG.state.zonen = { in: [], bk: gz.map((z) => z.id), au: ['halt'] };
  ok(namen(vG) === 'HOCHATMOSPHÄRE,FÖRDERSCHICHT,TIEFE', 'abgeschaltete Schaltgruppe (au): Wolkendecke fehlt: ' + namen(vG));
  delete FAKE.gas_gruppe;
  ok(KH.plan(vA, RECT).gas[0].linien.every((l, i) => Math.abs(l.r - Locs.get('gasfeld').scene.zonen.filter((z) => z.form === 'ring' && z.x === gas.x).sort((a, b) => b.r1 - a.r1)[i].r1 * R.frontProjektion(vM, RECT).zoom) < 1e-6), 'Radien der Linien = r1 der Zonen × Zoom (Parallaxe 1)');
  const logM = [], cM = neueFlaeche(logM);
  K.leeren(); KH.zeichne(cM, vM, RECT);
  ok(K.statistik().gebaut === 0 && !logM.some((l) => /^drawImage/.test(l)), 'mit Zonen: keine Kugel gebaut und gezeichnet (nicht doppelt)');
  const kultur = (l) => l.filter((x) => /^arc/.test(x)).length;
  const bStern = 2;   // Bögen des Sterns (Kern, Glanz) in dieser Szene
  ok(kultur(logM) - bStern === 1, 'mit Zonen, unerkundet: nur die Hochatmosphäre als Linie gezeichnet (Bögen ' + kultur(logM) + ' = 1 Linie + Stern)');
  { const lA = [], cA = neueFlaeche(lA); KH.zeichne(cA, vA, RECT); ok(kultur(lA) - bStern === 4, 'mit Zonen, erkundet: vier Höhenlinien gezeichnet (Bögen ' + kultur(lA) + ' = 4 Linien + Stern)'); ok(!lA.some((l) => /^fillText/.test(l)), 'die Kulisse schreibt keine Schichtnamen (Namen kommen nur von drawZonen)'); }
  // ohne Zonen: derselbe Planet, Szene ohne scene.zonen
  FAKE.gas_ohne = { id: 'gas_ohne', kind: 'void', scene: { w: 5000, h: 3800, arrive: { x: 300, y: 1800, angle: 0 }, stern: [], bojen: [], planeten: [{ x: gas.x, y: gas.y, r: gas.r, art: 'gasriese' }] } };
  const vO = ansicht('gas_ohne', 30), lO = KH.plan(vO, RECT);
  ok(lO.planeten.length === 1 && lO.gas.length === 0 && lO.planeten[0].art === 'gasriese', 'ohne Zonen: Gasriese als Kugel der Kulisse (Parallaxe 0,45)');
  const logO = [], cO = neueFlaeche(logO); K.leeren();
  vO.state.ship.x = gas.x - 900; vO.state.ship.y = gas.y;   // so nah, dass die Kugel im Bild liegt
  KH.zeichne(cO, vO, RECT);
  ok(K.statistik().gebaut === 1 && logO.some((l) => /^drawImage/.test(l)), 'ohne Zonen: eine Kugel gebaut und gezeichnet');
}

section('(e) leere und fehlerhafte Szenen');
{
  const faelle = {
    'leere Szene': { id: 'leer1', kind: 'void', scene: {} },
    'Ort ohne scene': { id: 'leer2' },
    'Ort null': null,
    'Listen kaputt': { id: 'k1', scene: { stern: 'x', planeten: 5, bojen: {}, zonen: 'y' } },
    'Einträge kaputt': { id: 'k2', scene: { stern: [null, {}, { x: NaN, y: 1 }, { x: 5 }], planeten: [null, { x: 1, y: 2 }, { x: 1, y: 2, r: -5, art: 'fels' }, { x: 1, y: 2, r: NaN }, { x: Infinity, y: 2, r: 4 }, { x: 100, y: 100, r: 50, art: 'unbekannt' }], bojen: [null, {}, { x: 'a', y: 2 }], zonen: [null, 5, { form: 'ring' }] } },
    'Stern ohne Klasse, Planet ohne Art': { id: 'k3', scene: { stern: [{ x: 10, y: 10, r: 100 }], planeten: [{ x: 700, y: 1100, r: 80 }], bojen: [{ x: 650, y: 1000 }] } },
    'Gasriese, Zonen ohne Namen': { id: 'k4', scene: { planeten: [{ x: 700, y: 1100, r: 80, art: 'gasriese' }], zonen: [{ form: 'ring', x: 700, y: 1100, r1: 100, r0: 50 }, { form: 'kreis' }] } },
  };
  for (const [name, loc] of Object.entries(faelle)) {
    FAKE.fehler = loc;
    const log = [], c = neueFlaeche(log);
    let wirft = null;
    try { for (const kurs of KURSE) KH.zeichne(c, ansicht('fehler', kurs, { loc: loc, x: 600, y: 1100 }), RECT); } catch (e) { wirft = e; }
    const s = log.filter((l) => /^save:/.test(l)).length, r = log.filter((l) => /^restore:/.test(l)).length;
    ok(!wirft && s === r && !win.meldungen.some((m) => /^KulisseHimmel/.test(m)), name + ': wirft nicht, save/restore ausgeglichen (' + s + '/' + r + ')' + (wirft ? ' ' + wirft.message : ''));
  }
  delete FAKE.fehler;
  const log = [], c = neueFlaeche(log);
  let wirft = null;
  try {
    KH.zeichne(c, null, RECT); KH.zeichne(c, {}, RECT); KH.zeichne(c, { state: {} }, RECT); KH.zeichne(c, { state: { ship: {} } }, RECT); KH.zeichne(c, { state: { ship: { x: 1, y: 1 } } }, RECT); KH.zeichne(null, ansicht('kreuzweg', 0), RECT); KH.zeichne(c, ansicht('kreuzweg', 0), null);
    KH.plan(null, RECT); KH.plan({ state: { ship: { x: 1, y: 1, scene: 'nirgends' } } }, RECT);
  } catch (e) { wirft = e; }
  ok(!wirft, 'ohne Ansicht, Zustand, Schiff, Fenster: wirft nicht' + (wirft ? ' ' + wirft.message : ''));
  // eine Kulisse, die selbst wirft, bricht drawSpace nicht ab (ctx.restore im finally)
  const log2 = [], c2 = neueFlaeche(log2);
  FAKE.boese = { id: 'boese', scene: { stern: [{ x: 5, y: 5, klasse: 'gelb' }], get planeten() { throw new Error('Daten kaputt'); } } };
  let w2 = null; try { KH.zeichne(c2, ansicht('boese', 0), RECT); } catch (e) { w2 = e; }
  ok(!w2 && log2.filter((l) => /^save:/.test(l)).length === log2.filter((l) => /^restore:/.test(l)).length && win.meldungen.filter((m) => /^KulisseHimmel/.test(m)).length === 1, 'wirft die Szene beim Lesen: abgefangen, gemeldet (Net.reportError), restore ausgeglichen');
  delete FAKE.boese;
  win.meldungen.length = 0;
}

section('(f) Pult-Frontsicht unverändert');
{
  const r = spawnSync(process.execPath, [path.join(__dirname, 'test-frontsicht.js')], { encoding: 'utf8' });
  ok(r.status === 0, 'tools/test-frontsicht.js Exit-Code ' + r.status + (r.status === 0 ? ' (Protokoll bit-gleich zur Referenz ohne neue Referenz)' : ''));
}

section('(h) Hyperraum, Nebel, Sternlicht');
{
  setzeKarte('limes');
  const logH = [], cH = neueFlaeche(logH);
  KH.zeichne(cH, ansicht('frostgrat', 0, { jump: { reise: { ziel: 'x' } } }), RECT);
  ok(logH.length === 0, 'Hyperraum (ship.jump.reise): die Kulisse zeichnet nichts');
  FAKE.nebel = { id: 'nebel', kind: 'nebula', fog: true, scene: Object.assign({}, Locs.get('frostgrat').scene) };
  const plN = Locs.get('frostgrat').scene.planeten[0];   // KUL-02 N1: im Nebel nur Planeten in der halben Sicht (350 m): Schiff nahe am Planeten
  const logN = [], cN = neueFlaeche(logN);
  KH.zeichne(cN, ansicht('nebel', 0, { x: plN.x - plN.r - 150, y: plN.y }), RECT);
  ok(!logN.includes('=fillStyle:"#05070D"') && logN.some((l) => /^drawImage/.test(l)), 'Nebel: kein Himmelsgrund, kein Sternfeld, Planeten bleiben (den Nebel legt drawFrontView darüber)');
  const logF = [], cF = neueFlaeche(logF);
  KH.zeichne(cF, ansicht('frostgrat', 0), RECT);
  ok(logF.includes('=fillStyle:"#05070D"'), 'klar: Himmelsgrund der Tokens (#05070D) und Sternfeld');
  delete FAKE.nebel;
  const L = KH.plan(ansicht('frostgrat', 0), RECT), sc = Locs.get('frostgrat').scene, st = sc.stern[0];
  ok(L.planeten.every((p) => angDiff(p.licht, Math.atan2(st.y - p.wy, st.x - p.wx)) < 1e-9), 'Planeten werden aus der Richtung zum Stern beleuchtet (Weltorientierung)');
  FAKE.dunkel = { id: 'dunkel', scene: { planeten: [{ x: 1000, y: 1000, r: 100, art: 'fels' }] } };
  const Ld = KH.plan(ansicht('dunkel', 0), RECT);
  ok(Ld.planeten.length === 1 && Math.abs(Ld.planeten[0].licht - Math.atan2(TK.SONNE.lichtOhneStern[1], TK.SONNE.lichtOhneStern[0])) < 1e-9, 'ohne Stern: Licht aus lichtOhneStern der Tokens');
  delete FAKE.dunkel;
  ok(TK.HIMMEL.abdunklung.alpha === 0.45 && TK.HIMMEL.parallaxePlanet === 0.45 && TK.HIMMEL.radiusFaktor === 0.9, 'Tokens: Abdunklung 45 % (Designer-Review 2026-11-03), Parallaxe 0,45, Radiusfaktor 0,9');
}

section('(g) Mutationen');
{
  const still = (fn) => { let f = 0; const o = console.log; console.log = () => {}; try { fn(() => f++); } finally { console.log = o; } return f; };
  // 1: Parallaxe 1 statt 0,45
  const tokenText = rd('hauptschirm-tokens.js');
  const mutText = tokenText.replace('parallaxePlanet: 0.45,', 'parallaxePlanet: 1,');
  ok(mutText !== tokenText, 'Mutation 1: Stelle in den Tokens gefunden');
  const w1 = umgebung({ 'hauptschirm-tokens.js': mutText });
  let anz = 0;
  const peilFehler = still((f) => { pruefePeilung(w1, (c) => { anz++; if (!c) f(); }); });
  const posFehler = still((f) => { pruefePosition(w1, (c) => { if (!c) f(); }); });
  ok(peilFehler === 0, 'Parallaxe 1: Peilungstest bleibt grün (Peilung ist invariant, ' + anz + ' Prüfungen)');
  ok(posFehler > 0, 'Parallaxe 1: Positionstest (Abstand = 0,45 ×) rot (' + posFehler + ' Abweichungen)');
  // 2: Kulisse NACH drawFrontView (hier: nach den Spielobjekten und Beschriftungen)
  const rtext = rd('render.js');
  const hook = "    if (front && cfg.himmel) cfg.himmel(ctx, { fog });";
  ok(rtext.includes(hook) && rtext.includes('    res.markersLayer();\n    hyperraum(ctx, view, win);'), 'Mutation 2: Stellen in render.js gefunden');
  const mutR = rtext.replace(hook, '').replace('    res.markersLayer();\n    hyperraum(ctx, view, win);', '    res.markersLayer();\n    if (rect.himmel) rect.himmel(ctx, { fog });\n    hyperraum(ctx, view, win);');
  const w2 = umgebung({ 'render.js': mutR });
  const ordFehler = still((f) => { reihenfolge(w2, (c) => { if (!c) f(); }, true); });
  ok(ordFehler > 0, 'Kulisse nach drawFrontView: Reihenfolgetest rot (' + ordFehler + ' Abweichungen)');
  // 3: ohne Mutation bleibt es grün (Gegenprobe)
  const gr = still((f) => { reihenfolge(win, (c) => { if (!c) f(); }, true); });
  ok(gr === 0, 'Gegenprobe: unveränderte Skripte, Reihenfolgetest grün');
}

section('(i) Keine Kollision: Planeten, Sterne und Bojen sind Kulisse');
{
  // statisch: welche Server-Dateien lesen scene.planeten / stern / bojen
  const treffer = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.js$/.test(e.name)) { const t = fs.readFileSync(p, 'utf8'); if (/\.planeten\b|scene\.stern\b|sc\.stern\b|scene\.bojen\b|sc\.bojen\b/.test(t)) treffer.push(path.relative(ROOT, p).replace(/\\/g, '/')); } } };
  walk(path.join(ROOT, 'server'));
  ok(treffer.length === 1 && treffer[0] === 'server/sim/besitz.js', 'im Server liest nur server/sim/besitz.js Planeten (Standortwahl der Posten, keine Kollision): ' + treffer.join(', '));
  // dynamisch: Flug durch Planet, Stern, Boje
  const { Game } = require('../server/game.js');
  const Physics = require('../shared/physics.js');
  const CONFIG = require('../shared/config.js');
  const DT = 1 / CONFIG.tickHz;
  setzeKarte('limes');
  const g = new Game({ noStore: true, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'K0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' }); g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  const sh = g.ship, me = g.players[0];
  const sitzen = () => {   // Steuer besetzen wie in test-flight (Konsolenkachel, Aktion)
    const W = require('../server/world.js'), t = W.CONSOLE_TILES.helm, tl = Array.isArray(t) ? t : [t];
    for (const q of tl) for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [0, 2], [-1, 1], [1, 1]]) {
      const sx = q.x + dx, sy = q.y + dy; if (W.ship.solid(sx, sy)) continue;
      const pc = Physics.tileCenter(sx, sy); me.x = pc.x; me.y = pc.y; me.dir = 'up'; me.input.mx = 0; me.input.my = 0;
      g.handleMessage(c, { t: 'act', down: true }); g.handleMessage(c, { t: 'act', down: false });
      if (me.console === 'helm') return true;
    }
    return false;
  };
  const fliege = (szene, von, bis, wasName, kreis) => {
    g.handleMessage(c, { t: 'debug', cmd: 'goto', loc: szene });
    g.space.enemies = []; g.space.projectiles = [];
    if (me.console) g.handleMessage(c, { t: 'leave' });
    ok(sitzen(), 'Steuer besetzt (' + szene + ')');
    const sc = Locs.get(szene).scene;
    sh.x = von.x; sh.y = von.y; sh.angle = Math.atan2(bis.y - von.y, bis.x - von.x); sh.vx = 0; sh.vy = 0; sh.turnVel = 0;
    g.handleMessage(c, { t: 'cmd', c: 'helm.throttle', set: 5 });
    const hull0 = JSON.stringify([g.snapshot().ship.integ, g.snapshot().ship.shields.current]);
    let vmax = 0, vInnen = Infinity, innen = 0, steps = 0, maxSteps = Math.round(60 / DT);
    while (steps++ < maxSteps && Math.hypot(bis.x - sh.x, bis.y - sh.y) > 30 && sh.x < sc.w - 20) {
      g.space.enemies = []; g.space.projectiles = [];
      g.step();
      vmax = Math.max(vmax, sh.speed);
      if (Math.hypot(sh.x - kreis.x, sh.y - kreis.y) < kreis.r) { innen++; vInnen = Math.min(vInnen, sh.speed); }
    }
    const hull1 = JSON.stringify([g.snapshot().ship.integ, g.snapshot().ship.shields.current]);
    return { hull0, hull1, vmax, vInnen, innen, ende: { x: sh.x, y: sh.y } };
  };
  const frost = Locs.get('frostgrat').scene, pl = frost.planeten[0];
  const A = fliege('frostgrat', { x: pl.x - 700, y: pl.y }, { x: pl.x + 400, y: pl.y }, 'Planet', { x: pl.x, y: pl.y, r: pl.r });
  info('Planet Frostgrat: Rumpf und Schilde ' + (A.hull1 === A.hull0 ? 'unverändert' : 'GEÄNDERT') + ', Tempo max ' + Math.round(A.vmax) + ', im Planeten min ' + Math.round(A.vInnen) + ' (' + A.innen + ' Schritte), Ende ' + Math.round(A.ende.x) + ',' + Math.round(A.ende.y));
  ok(A.innen > 20 && A.hull1 === A.hull0 && A.vInnen >= A.vmax * 0.97, 'Schiff fliegt mitten durch den Planeten (r ' + pl.r + '): ' + A.innen + ' Schritte im Planeten, kein Schaden, keine Bremsung');
  ok(Math.abs(A.ende.x - (pl.x + 400)) < 120, 'und kommt auf der anderen Seite an (x ' + Math.round(A.ende.x) + ')');
  const kw = Locs.get('kreuzweg').scene, st = kw.stern[0], bj = kw.bojen[1];
  const B = fliege('kreuzweg', { x: st.x + 800, y: st.y }, { x: st.x - 300, y: st.y }, 'Stern', { x: st.x, y: st.y, r: st.r });   // KUL-02 N1 (Review S4): Kreis um den Stern selbst, Flug mitten hindurch (vorher y + 200: verfehlte den Stern)
  ok(B.innen > 10 && B.hull1 === B.hull0 && B.vInnen >= B.vmax * 0.97, 'Schiff fliegt durch den Stern (r ' + st.r + '): ' + B.innen + ' Schritte, kein Schaden, keine Bremsung');
  const C = fliege('kreuzweg', { x: bj.x - 700, y: bj.y }, { x: bj.x + 300, y: bj.y }, 'Boje', { x: bj.x, y: bj.y, r: 40 });
  ok(C.innen > 3 && C.hull1 === C.hull0 && C.vInnen >= C.vmax * 0.97, 'Schiff fliegt durch die Navigationsboje: ' + C.innen + ' Schritte, kein Schaden, keine Bremsung');
}

section('(j) KUL-02 N1: Namen, Nebel, Randlicht unten, Saum, Fehlerfestigkeit');
{
  // Namen: drawZonen setzt sie dynamisch, Hauptschirm (Skala 2): frei von Tafeln und Rand, je Name genau einmal (9 Zeichnungen = Kontur), Kulisse schreibt keine
  setzeKarte('sund');
  const gas = Locs.get('gasfeld').scene.planeten[0], gzn = Locs.get('gasfeld').scene.zonen, bkAlle = gzn.map((z) => z.id);
  const TAFELN = [{ x: 6, y: 6, w: 186, h: 64 }, { x: 512 - 6 - 170, y: 6, w: 170, h: 64 }];
  const NAMEN = ['HOCHATMOSPHÄRE', 'WOLKENDECKE', 'FÖRDERSCHICHT', 'TIEFE'];
  const treffe = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const BLOCK = [{ x: 150, y: 90, w: 212, h: 130 }];   // zusätzliche Sperre mitten im Bild: die nächsten freien Punkte liegen dort, die Namen müssen ausweichen
  let gepr = 0; const schlecht = [], sichtbarNamen = {};
  for (const [abst, kurs, ver, blk] of [[300, 0, 0], [500, 90, 0], [760, 180, 0], [1100, 217, 60], [1500, 300, -40], [2200, 45, 0], [300, 0, 0, 1], [500, 90, 0, 1], [760, 180, 0, 1]]) {
    const sp = blk ? TAFELN.concat(BLOCK) : TAFELN, mitLerche = sp.concat([{ x: 256 - 24, y: Math.round(288 * 700 / 820) - 28, w: 48, h: 56 }]);   // Sperren der Tafeln (+ Block); geprüft wird zusätzlich gegen die Lerche (drawZonen sperrt sie selbst)
    const rect = Object.assign({}, RECT, { textSkala: 2, sperren: sp });
    const v = ansicht('gasfeld', kurs, { x: gas.x - abst * Math.cos(rad(kurs)), y: gas.y - abst * Math.sin(rad(kurs)) + ver });
    rect.himmel = (cx) => KH.zeichne(cx, v, rect);
    v.state.zonen = { in: [], bk: bkAlle }; v.enemies = []; v.state.space.markers = [];
    const log = [], c = neueFlaeche(log);
    win.Render.drawFrontView(c, v, rect);
    for (const nm of NAMEN) {
      const eintr = log.filter((l) => l.startsWith('fillText:["' + nm + '"'));
      if (!eintr.length) continue;
      sichtbarNamen[nm] = (sichtbarNamen[nm] || 0) + 1;
      gepr++;
      const tx = eintr.map((e) => JSON.parse(e.slice(9))), mx = tx.reduce((a, q) => a + q[1], 0) / tx.length, my = tx.reduce((a, q) => a + q[2], 0) / tx.length;
      const w = nm.length * 8 + 2, h = 16, box = { x: mx - w / 2, y: my - 1, w, h };
      const meldung = abst + ' m Kurs ' + kurs + ' ' + nm;
      if (eintr.length !== 9) schlecht.push(meldung + ': ' + eintr.length + ' Zeichnungen statt 9 (doppelt?)');
      if (box.x < 5 || box.x + w > 512 - 5 || box.y < 5 || box.y + h > 288 - 5) schlecht.push(meldung + ': Name ragt über den Bildrand ' + JSON.stringify(box));
      if (mitLerche.some((q) => treffe(box, q))) schlecht.push(meldung + ': Name unter einer Tafel ' + JSON.stringify(box));
    }
  }
  ok(gepr >= 12 && schlecht.length === 0, 'Ringnamen am Hauptschirm: ' + gepr + ' gezeichnet, keiner unter Tafeln, am Rand oder doppelt' + (schlecht.length ? ' – ' + schlecht.join('; ') : ''));
  ok(Object.keys(sichtbarNamen).length >= 3, 'aus der Nähe und aus der Ferne stehen Namen im Bild (' + JSON.stringify(sichtbarNamen) + ')');
  // Pult (ohne textSkala): Namen wie bisher oben am Ring, einmal gezeichnet (Kontur nur am Hauptschirm)
  { const v = ansicht('gasfeld', 0, { x: gas.x - 500, y: gas.y }); v.state.zonen = { in: [], bk: bkAlle }; const log = [], c = neueFlaeche(log); win.Render.drawFrontView(c, v, Object.assign({}, RECT)); ok(log.filter((l) => l.startsWith('fillText:["WOLKENDECKE"')).length === 2, 'Pult/Skala 1: Ringname unverändert (Schatten + Text, keine Kontur, feste Stelle oben am Ring)'); }
  // Nebel: nur, was in der halben Sicht (350 m) liegt
  FAKE.nebel2 = { id: 'nebel2', kind: 'nebula', fog: true, scene: { w: 3000, h: 2200, arrive: { x: 600, y: 1100 }, stern: [{ x: 600 + 800, y: 1100, klasse: 'gelb', r: 100 }, { x: 600 + 200, y: 1100 + 5, klasse: 'gelb', r: 100 }], planeten: [{ x: 600 + 500, y: 1100, r: 40, art: 'fels' }, { x: 600 + 380, y: 1100, r: 60, art: 'eis' }], bojen: [{ x: 600 + 200, y: 1100 }, { x: 600 + 600, y: 1100 }] } };
  const Ln = KH.plan(ansicht('nebel2', 0, { x: 600, y: 1100 }), RECT);
  ok(Ln.fog && Ln.bojen.length === 1 && Ln.sterne.length === 1 && Ln.planeten.length === 1 && Ln.planeten[0].art === 'eis', 'Nebel: Boje, Stern und Planet jenseits der halben Sicht (350 m) fehlen, der Planetenrand zählt (' + Ln.bojen.length + ' Boje, ' + Ln.sterne.length + ' Stern, ' + Ln.planeten.length + ' Planet)');
  FAKE.nebel2.fog = false; FAKE.nebel2.kind = 'void';
  const Lk = KH.plan(ansicht('nebel2', 0, { x: 600, y: 1100 }), RECT);
  ok(!Lk.fog && Lk.bojen.length === 2 && Lk.sterne.length === 2 && Lk.planeten.length === 2, 'klare Sicht: alles da (' + Lk.bojen.length + ' Bojen, ' + Lk.sterne.length + ' Sterne, ' + Lk.planeten.length + ' Planeten)');
  delete FAKE.nebel2;
  // Randlicht unten: nie näher als 72 px an der Lerchenmitte
  FAKE.hinten = { id: 'hinten', scene: { w: 3000, h: 2200, arrive: { x: 1500, y: 1100 }, stern: [{ x: 500, y: 1100 + 30, klasse: 'gelb', r: 100 }, { x: 500, y: 1100 - 30, klasse: 'weiss', r: 100 }, { x: 1500, y: 1100 + 2000, klasse: 'rot', r: 100 }], planeten: [], bojen: [] } };
  const vH = ansicht('hinten', 0, { x: 1500, y: 1100 }), Lh = KH.plan(vH, RECT), Ph = R.frontProjektion(vH, RECT);
  ok(Lh.sterne.length === 3 && Lh.sterne.every((q) => !(q.y >= 288 - TK.SONNE.randAbstand - 0.5) || Math.abs(q.x - Ph.cx) >= TK.SONNE.sperreUnten.halbB - 1e-9), 'Randlicht unten: nie näher als ±' + TK.SONNE.sperreUnten.halbB + ' px an der Lerchenmitte (x: ' + Lh.sterne.map((q) => Math.round(q.x - Ph.cx)).join(', ') + ')');
  ok(Lh.sterne.filter((q) => q.versetzt).length >= 1 && Lh.sterne.filter((q) => q.versetzt).every((q) => Math.abs(Math.abs(q.x - Ph.cx) - 72) < 1e-9), 'versetztes Randlicht sitzt genau bei Mitte ± 72 px');
  ok(Lh.sterne.filter((q) => !q.versetzt).every((q) => angDiff(Math.atan2(q.y - Ph.cy, q.x - Ph.cx), q.winkel) < 0.01), 'nicht versetztes Randlicht bleibt in seiner Peilung');
  delete FAKE.hinten;
  // Navboje: dunkler Saum unter der Raute
  setzeKarte('limes');
  { const lg = [], cg = neueFlaeche(lg); KH.zeichne(cg, ansicht('kreuzweg', 0, { x: 1017, y: 670 + 100 }), RECT); const sm = TK.BOJE.nav.saum; ok(sm && sm.plus > 0 && lg.some((l) => l === '=fillStyle:"rgba(5,7,13,' + sm.alpha + ')"'), 'Navboje: dunkler Saum (' + sm.farbe + ') unter der Raute gezeichnet'); }
  // save/restore auch bei Fehlern
  const wirft = (log, was) => { const c = neueFlaeche(log); return new Proxy(c, { get: (t, k) => (k === was ? () => { throw new Error('boom'); } : t[k]), set: (t, k, v) => { t[k] = v; return true; } }); };
  for (const [was, f] of [['drawImage', (c) => K.zeichnePlanet(c, 'fels', 50, 50, 20, 3, 0, 0.3, 0.45)], ['createRadialGradient', (c) => K.stern(c, 50, 50, 6, 'gelb', 1)]]) {
    const lg = [], c = wirft(lg, was); let w = null; try { f(c); } catch (e) { w = e; }
    ok(w && lg.filter((l) => /^save:/.test(l)).length === lg.filter((l) => /^restore:/.test(l)).length && lg.filter((l) => /^save:/.test(l)).length > 0, (was === 'drawImage' ? 'zeichnePlanet' : 'stern') + ': restore trotz Fehler in ' + was + ' (save/restore ausgeglichen)');
  }
}

console.log('\n' + (fails ? fails + ' FEHLER von ' + n : 'alle ' + n + ' Prüfungen grün'));
process.exit(fails ? 1 : 0);
