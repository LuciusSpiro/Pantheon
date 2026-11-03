'use strict';
// OPS-01 Paket A: Ausrichtung der Taktikkarte (Ops) und der Lagekarte (Captain) – „Schiff oben“ (Standard) und „Norden oben“.
//   (a) toS/toW: Hin- und Rückrechnung bei acht Kursen in beiden Ausrichtungen, Ops-Rect und Captain-Lage-Rect, Fehler < 0,5 px
//   (b) Schiff oben: ein Objekt genau vor dem Bug liegt bei jedem Kurs über der Schiffsmitte, ein Objekt Steuerbord rechts; Norden oben: wie bisher (Welt = Bildschirm)
//   (c) Klick (Klickflächen aus drawSpace, Reihenfolge wie Consoles.mouseDown) trifft bei jedem Kurs und in beiden Ausrichtungen dasselbe Objekt, toW liefert dessen Weltort
//   (d) Beschriftungen, Kennungen, Randpfeil-Labels, Nordmarke bleiben aufrecht: nie fillText bei gedrehter Zeichenfläche
//   (e) Randpfeile zeigen in beiden Ausrichtungen in Bildschirmrichtung zum Objekt
//   dazu Kartenlogik (Standard, Umschalten, rot) und die Verdrahtung (Taste Shift+Z, Knopf, Skript-Einbindung)
//   node tools/test-karte-ausrichtung.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);

// Zeichenfläche mit Aufzeichnung: Texte samt Drehzustand (fillText bei gedrehter Fläche = mitgedrehter Text), Randpfeile (fill nach translate+rotate samt Winkel)
function neueFlaeche() {
  const rec = { texte: [], pfeile: [] };
  const st = { fillStyle: '#000', strokeStyle: '#000', tx: 0, ty: 0, rot: false, ang: 0 };
  const stack = [];
  const f = {
    save() { stack.push({ tx: st.tx, ty: st.ty, rot: st.rot, ang: st.ang }); },
    restore() { const s = stack.pop(); if (s) { st.tx = s.tx; st.ty = s.ty; st.rot = s.rot; st.ang = s.ang; } },
    translate(x, y) { st.tx += x; st.ty += y; },
    rotate(a) { st.rot = true; st.ang += a; },
    fill() { if (st.rot) rec.pfeile.push({ x: st.tx, y: st.ty, ang: st.ang, fs: st.fillStyle }); },
    fillText(s, x, y) { if (!/^rgba\(11,14,26/.test(st.fillStyle)) rec.texte.push({ s: String(s), x: x + st.tx, y: y + st.ty, gedreht: st.rot, fs: st.fillStyle }); },
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
  console: Object.assign({}, console, { warn(l, ...r) { if (l !== 'Lerche.sprite') console.warn(l, ...r); } }), Image: function () {}, performance: { now: () => 0 }, location: { search: '' } };
win.window = win; win.self = win;
vm.createContext(win);
const lade = (f) => vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8'), win, { filename: f });
lade('kennung.js');   // Kennungen wie im Spiel (Form statt Sprite), damit ihre Zeichnung mitgeprüft wird
lade('render.js');
lade('kartenlogik.js');
const R = win.Render, KL = win.Kartenlogik;
win.Hud = { szeneVon: () => null };
const PAL = R.PAL;

// ---------------------------------------------------------------------------------------------------------------------------------
const OPS = { x: 10, y: 26, w: 404, h: 292 };      // Ops-Karte (Consoles.mapRects.weapons)
const LAGE = { x: 12, y: 48, w: 440, h: 272 };     // Captain-Lage (Consoles.mapRects.lage)
const KARTEN = [{ karte: 'weapons', rect: OPS, mode: 'tactical', zoom: 0.35 }, { karte: 'lage', rect: LAGE, mode: 'lage', zoom: 0.35 }];
const KURSE = [0, 45, 90, 135, 180, 225, 270, 315];
const rad = (g) => g * Math.PI / 180;
const SHIP = { x: 1000, y: -500 };
const ansicht = (kurs, extra, space) => Object.assign({ time: 1, me: { console: 'weapons' }, ship: null, enemies: [], escorts: [],
  state: { time: 1, ship: { x: SHIP.x, y: SHIP.y, angle: rad(kurs), hull: 100, mounts: [] }, space: space || {}, players: [], flotte: {} } }, extra || {});
// Karte zeichnen wie die Konsolen: Kartenlogik.optionen liefert rot und Nordmarke; Mitte der Karte = Rect-Mitte
function zeichne(k, ausr, kurs, extra, space) {
  KL.setze(k.karte, ausr);
  const view = ansicht(kurs, extra, space);
  const { ctx, rec } = neueFlaeche();
  const rects = [];
  const res = R.drawTactical(ctx, view, k.rect, Object.assign({ zoom: k.zoom, arcs: k.karte === 'weapons', intel: true, mode: k.mode, enemyRects: rects }, KL.optionen(k.karte, view)));
  return { res, rec, rects, view, cx: res.cx, cy: res.cy };
}
const gegner = (id, x, y, extra) => Object.assign({ id, kind: 'raider', x, y, hp: 10, hpMax: 10, angle: 0, shields: [2, 2, 2, 2] }, extra || {});
const nah = (s, d, wink) => ({ x: s.x + Math.cos(wink) * d, y: s.y + Math.sin(wink) * d });   // Weltpunkt im Abstand d unter Winkel wink

// ---------------------------------------------------------------------------------------------------------------------------------
section('Kartenlogik: Standard, Umschalten, Drehung');
{
  const frisch = win.Kartenlogik;
  ok(frisch.ausrichtung('weapons') === 'schiff' && frisch.ausrichtung('lage') === 'schiff', 'Standard beider Karten: Schiff oben');
  ok(frisch.name('weapons') === 'Schiff oben', 'Name: Schiff oben');
  KL.umschalten('weapons');
  ok(KL.ausrichtung('weapons') === 'norden' && KL.ausrichtung('lage') === 'schiff', 'Umschalten gilt je Karte (Ops) – die Lagekarte des Captains bleibt');
  ok(KL.name('weapons') === 'Norden oben' && KL.optionen('weapons', ansicht(90)).rot === 0 && !KL.optionen('weapons', ansicht(90)).nordmarke, 'Norden oben: rot 0, keine Nordmarke');
  KL.umschalten('weapons');
  const o = KL.optionen('weapons', ansicht(90));
  ok(KL.ausrichtung('weapons') === 'schiff' && Math.abs(o.rot - (-Math.PI)) < 1e-9 && o.nordmarke, 'Schiff oben bei Kurs 90°: rot = −Kurs − 90° = −180°, Nordmarke an');
  ok(KL.setze('weapons', 'quer') === false && KL.setze('quatsch', 'schiff') === false && KL.ausrichtung('weapons') === 'schiff', 'ungültige Werte und Karten werden abgewiesen');
  const vp = KL.optionen('weapons', { ship: { angle: 0 }, state: { ship: { angle: Math.PI } } });
  ok(Math.abs(vp.rot + Math.PI / 2) < 1e-9, 'view.ship (vorhergesagt) hat Vorrang vor dem Snapshot-Schiff, wie in drawSpace');
}

// ---------------------------------------------------------------------------------------------------------------------------------
section('Kartenlogik: gemerkte Wahl je Spieler (localStorage), ohne Speicher gilt der Standard');
{
  const quelle = fs.readFileSync(path.join(ROOT, 'public', 'js', 'kartenlogik.js'), 'utf8');
  const laden = (ls) => { const w = { localStorage: ls }; vm.runInNewContext(quelle, { window: w }, { filename: 'kartenlogik.js' }); return w.Kartenlogik; };
  const d = {}, ls = { getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); } };
  const a = laden(ls); a.umschalten('lage');
  const b = laden(ls);
  ok(b.ausrichtung('lage') === 'norden' && b.ausrichtung('weapons') === 'schiff', 'die Wahl überlebt das Neuladen, je Karte getrennt');
  const kaputt = laden({ getItem() { throw new Error('gesperrt'); }, setItem() { throw new Error('gesperrt'); } });
  ok(kaputt.ausrichtung('weapons') === 'schiff' && kaputt.umschalten('weapons') === 'norden', 'gesperrter Speicher: Standard gilt, Umschalten wirft nicht');
  const muell = laden({ getItem: () => '{"weapons":"quer","lage":5}', setItem() {} });
  ok(muell.ausrichtung('weapons') === 'schiff' && muell.ausrichtung('lage') === 'schiff', 'unbrauchbare gespeicherte Werte werden ignoriert');
  ok(laden(null).ausrichtung('lage') === 'schiff', 'ohne localStorage: Standard');
}

// ---------------------------------------------------------------------------------------------------------------------------------
section('(a) toS/toW Hin- und Rückrechnung: 8 Kurse × 2 Ausrichtungen × 2 Karten');
{
  let schlecht = 0, maxS = 0, maxW = 0, anz = 0;
  const pts = [[0, 0], [10, 10], [200, 100], [-150, 80], [399, 280], [212, 146], [60, 250]];
  for (const k of KARTEN) for (const ausr of ['schiff', 'norden']) for (const kurs of KURSE) {
    const { res } = zeichne(k, ausr, kurs);
    // Bildschirmpunkt -> Welt -> Bildschirm (toS rundet auf ganze Pixel: der Rückweg trifft den Ausgangspunkt exakt)
    for (const [dx, dy] of pts) {
      const sx = k.rect.x + dx, sy = k.rect.y + dy, w = res.toW(sx, sy), s = res.toS(w.x, w.y), e = Math.hypot(s.x - sx, s.y - sy);
      maxS = Math.max(maxS, e); anz++; if (e >= 0.5) schlecht++;
    }
    // Welt -> Bildschirm -> Welt: Fehler durch das Runden in toS höchstens ein halbes Pixel (in Bildschirmpixeln gemessen)
    for (const [wx, wy] of [[SHIP.x + 300, SHIP.y - 200], [SHIP.x - 420, SHIP.y + 90], [SHIP.x, SHIP.y], [SHIP.x + 5, SHIP.y + 5]]) {
      const s = res.toS(wx, wy), w = res.toW(s.x, s.y), e = Math.hypot(w.x - wx, w.y - wy) * k.zoom;
      maxW = Math.max(maxW, e); anz++; if (e > 0.75) schlecht++;   // Rundung je Achse ≤ 0,5 px, Diagonale ≤ 0,71 px
    }
  }
  ok(schlecht === 0, 'alle ' + anz + ' Hin-/Rückrechnungen genau (Bildschirm→Welt→Bildschirm max ' + maxS.toFixed(6) + ' px, Welt→Bildschirm→Welt max ' + maxW.toFixed(3) + ' px)');
  const eins = zeichne(KARTEN[0], 'norden', 0).res;
  ok(eins.toS(SHIP.x, SHIP.y).x === eins.cx && eins.toS(SHIP.x, SHIP.y).y === eins.cy, 'das Schiff liegt in beiden Ausrichtungen auf der Kartenmitte (cx, cy)');
}

// ---------------------------------------------------------------------------------------------------------------------------------
section('(b) Schiff oben: voraus liegt oben, Steuerbord rechts, Backbord links, achtern unten');
{
  let schlecht = 0, anz = 0;
  for (const k of KARTEN) for (const kurs of KURSE) {
    const { res } = zeichne(k, 'schiff', kurs);
    const voraus = res.toS(...Object.values(nah(SHIP, 300, rad(kurs)))), stb = res.toS(...Object.values(nah(SHIP, 300, rad(kurs + 90))));
    const bb = res.toS(...Object.values(nah(SHIP, 300, rad(kurs - 90)))), achtern = res.toS(...Object.values(nah(SHIP, 300, rad(kurs + 180))));
    const alle = [Math.abs(voraus.x - res.cx) <= 1 && voraus.y < res.cy - 100, Math.abs(stb.y - res.cy) <= 1 && stb.x > res.cx + 100,
      Math.abs(bb.y - res.cy) <= 1 && bb.x < res.cx - 100, Math.abs(achtern.x - res.cx) <= 1 && achtern.y > res.cy + 100];
    anz += 4; schlecht += alle.filter((v) => !v).length;
  }
  ok(schlecht === 0, 'bei allen 8 Kursen und beiden Karten: voraus über, Steuerbord rechts, Backbord links, achtern unter der Schiffsmitte (' + anz + ' Prüfungen)');
  let nord = 0;
  for (const kurs of KURSE) { const { res } = zeichne(KARTEN[0], 'norden', kurs); const p = res.toS(SHIP.x, SHIP.y - 300), o = res.toS(SHIP.x + 300, SHIP.y); if (Math.abs(p.x - res.cx) <= 1 && p.y < res.cy && Math.abs(o.y - res.cy) <= 1 && o.x > res.cx) nord++; }
  ok(nord === 8, 'Norden oben: Welt-Norden (−y) oben und Osten (+x) rechts bei jedem Kurs (wie bisher)');
  // Das gezeichnete Schiff selbst: Kurs + rot = −90° heißt Bug nach oben
  const { res: r0 } = zeichne(KARTEN[0], 'schiff', 135);
  ok(Math.abs(Math.atan2(r0.toS(...Object.values(nah(SHIP, 300, rad(135)))).y - r0.cy, r0.toS(...Object.values(nah(SHIP, 300, rad(135)))).x - r0.cx) + Math.PI / 2) < 0.01, 'der Bug (Kurs 135°) zeigt auf dem Schirm genau nach oben (−90°)');
}

// ---------------------------------------------------------------------------------------------------------------------------------
section('(c) Klick trifft dasselbe Objekt: Gegner, Versteck, Station; Marker-Rückrechnung');
{
  let schlecht = 0, anz = 0, markerFehl = 0;
  const trifft = (rects, x, y) => { for (let i = rects.length - 1; i >= 0; i--) { const r = rects[i]; if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) return r.id; } return null; };   // wie Consoles.mouseDown (Ops)
  for (const k of KARTEN) for (const ausr of ['schiff', 'norden']) for (const kurs of KURSE) {
    // drei Gegner, ein Versteck und eine Station im Umkreis von 250 Welteinheiten (≈ 88 px, passt bei jeder Drehung ins Rect)
    const orte = { g1: nah(SHIP, 250, rad(10)), g2: nah(SHIP, 250, rad(130)), g3: nah(SHIP, 250, rad(250)) };
    const space = { hidden: [{ id: 'h1', kind: 'beacon', x: nah(SHIP, 120, rad(70)).x, y: nah(SHIP, 120, rad(70)).y, found: false }], markers: [{ kind: 'station', name: 'Posten', x: nah(SHIP, 120, rad(190)).x, y: nah(SHIP, 120, rad(190)).y, r: 80 }] };
    const en = [gegner('g1', orte.g1.x, orte.g1.y, { angle: rad(40) }), gegner('g2', orte.g2.x, orte.g2.y, { angle: rad(200) }), gegner('g3', orte.g3.x, orte.g3.y, { angle: rad(300) })];
    const { res, rects } = zeichne(k, ausr, kurs, { enemies: en }, space);
    const soll = Object.assign({}, orte, { h1: { x: space.hidden[0].x, y: space.hidden[0].y }, station: { x: space.markers[0].x, y: space.markers[0].y } });
    for (const id of Object.keys(soll)) {
      const s = res.toS(soll[id].x, soll[id].y); anz++;
      if (trifft(rects, s.x, s.y) !== id) schlecht++;
      const w = res.toW(s.x, s.y); if (Math.hypot(w.x - soll[id].x, w.y - soll[id].y) * k.zoom > 0.75) markerFehl++;   // Rechtsklick/Marker: toW gibt den Ort zurück
    }
  }
  ok(anz > 0 && schlecht === 0, 'Klick auf die Bildschirmmitte jedes Objekts trifft dasselbe Objekt (' + anz + ' Klicks: 3 Gegner, Versteck, Station × 8 Kurse × 2 Ausrichtungen × 2 Karten)');
  ok(markerFehl === 0, 'toW liefert den Weltort des angeklickten Objekts (Marker setzen) bis auf ein Pixel Rundung');
  // Kontrolle: die Klickfläche liegt dort, wo das Objekt gezeichnet wird – Schiff oben und Norden oben setzen sie an verschiedene Stellen
  const e1 = [gegner('g1', nah(SHIP, 250, rad(0)).x, nah(SHIP, 250, rad(0)).y)];
  const a = zeichne(KARTEN[0], 'schiff', 90, { enemies: e1 }), b = zeichne(KARTEN[0], 'norden', 90, { enemies: e1 });
  const c = (z) => { const r = z.rects.find((q) => q.id === 'g1'); return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null; };
  ok(c(a) && c(b) && Math.hypot(c(a).x - c(b).x, c(a).y - c(b).y) > 50, 'bei Kurs 90° liegt dieselbe Klickfläche in den beiden Ausrichtungen an verschiedenen Stellen (rechts bei „Norden“, links bei „Schiff“)');
  ok(c(b).x > b.cx + 60 && Math.abs(c(b).y - b.cy) < 3 && c(a).x < a.cx - 60 && Math.abs(c(a).y - a.cy) < 3, 'Norden oben: Gegner im Osten rechts; Schiff oben bei Kurs 90° (Bug nach Süden): derselbe Gegner liegt backbord, also links');
}

// ---------------------------------------------------------------------------------------------------------------------------------
section('(d) Texte bleiben aufrecht (kein fillText bei gedrehter Zeichenfläche)');
{
  let gedreht = 0, texte = 0, ohneText = 0;
  const kennungen = { n: 0 };
  for (const k of KARTEN) for (const ausr of ['schiff', 'norden']) for (const kurs of [0, 45, 90, 135, 200, 315]) {
    const sicht = [gegner('g1', nah(SHIP, 200, rad(10)).x, nah(SHIP, 200, rad(10)).y, { angle: rad(77), kind: 'korvette', vk: 'ger', nm: 'Wolfsjagd' }),
      gegner('g2', nah(SHIP, 200, rad(250)).x, nah(SHIP, 200, rad(250)).y, { angle: rad(300), kind: 'fregatte', vk: 'rom' }),
      gegner('g3', nah(SHIP, 1000, rad(kurs)).x, nah(SHIP, 1000, rad(kurs)).y, { kind: 'raider' })];   // außerhalb: Randpfeil mit Label
    const space = { markers: [{ kind: 'dock', x: nah(SHIP, 90, rad(100)).x, y: nah(SHIP, 90, rad(100)).y, r: 70 }, { kind: 'exit', x: nah(SHIP, 1200, rad(kurs + 90)).x, y: nah(SHIP, 1200, rad(kurs + 90)).y, r: 140 }],
      zonen: undefined };
    const { rec } = zeichne(k, ausr, kurs, { enemies: sicht }, space);
    texte += rec.texte.length; gedreht += rec.texte.filter((t) => t.gedreht).length; if (!rec.texte.length) ohneText++;
    kennungen.n += rec.pfeile.length;
  }
  ok(texte > 100 && ohneText === 0, 'die Szenen tragen Beschriftungen (' + texte + ' Texte), keine Szene ohne Text');
  ok(gedreht === 0, 'kein einziger Text wird bei gedrehter Zeichenfläche gesetzt (Labels, Randpfeil-Labels, Sprungpunkt, Nordmarke; ' + gedreht + ' gedrehte von ' + texte + ')');
  ok(win.Kennung && typeof win.Kennung.zeichne === 'function' && kennungen.n > 0, 'Kennungsformen und Randpfeile wurden mitgezeichnet (' + kennungen.n + ' gedrehte Formen)');
  // die Nordmarke steht aufrecht am Rand in Richtung Norden
  const { rec, cx, cy } = zeichne(KARTEN[0], 'schiff', 90);
  const N = rec.texte.find((t) => t.s === 'N');
  ok(!!N && !N.gedreht, 'Schiff oben: Nordmarke „N“ da und aufrecht');
  ok(N && N.y > cy + 30 && Math.abs(N.x - cx) < 14, 'bei Kurs 90° (Bug nach Süden = oben) liegt Norden unten – Nordmarke bei ' + (N ? Math.round(N.x - cx) + '/' + Math.round(N.y - cy) : '–') + ' von der Schiffsmitte');
  ok(!zeichne(KARTEN[0], 'norden', 90).rec.texte.some((t) => t.s === 'N'), 'Norden oben: keine Nordmarke');
}

// ---------------------------------------------------------------------------------------------------------------------------------
section('(e) Randpfeil zeigt in Bildschirmrichtung zum Objekt');
{
  let schlecht = 0, anz = 0, minAbst = 99;
  const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  for (const k of KARTEN) for (const ausr of ['schiff', 'norden']) for (const kurs of KURSE) {
    // ein Gegner weit außerhalb unter Winkel 30° zum Bug (sonst nichts auf der Karte außer dem Schiff)
    const ziel = nah(SHIP, 900, rad(kurs + 30));
    const { rec, res } = zeichne(k, ausr, kurs, { enemies: [gegner('x1', ziel.x, ziel.y)] });
    const p = rec.pfeile.filter((q) => q.fs === PAL.red);
    const s = res.toS(ziel.x, ziel.y), soll = Math.atan2(s.y - res.cy, s.x - res.cx);
    anz++;
    if (p.length !== 1) { schlecht++; continue; }
    const wink = Math.atan2(p[0].y - res.cy, p[0].x - res.cx);   // Lage des Pfeils am Rand von der Kartenmitte aus
    if (Math.abs(norm(p[0].ang - soll)) > 0.02 || Math.abs(norm(wink - soll)) > 0.05) schlecht++;
    minAbst = Math.min(minAbst, Math.min(p[0].x - k.rect.x, k.rect.x + k.rect.w - p[0].x, p[0].y - k.rect.y, k.rect.y + k.rect.h - p[0].y));
  }
  ok(anz === 32 && schlecht === 0, 'ein Pfeil je Karte/Ausrichtung/Kurs (' + anz + ' Fälle), Spitze und Lage am Rand in Richtung toS(Objekt), Rand-Abstand min ' + Math.round(minAbst) + ' px (innerhalb des Rects)');
  // Schiff oben: Gegner genau voraus -> Pfeil oben in der Mitte nach oben; Steuerbord -> Pfeil rechts, nach rechts
  const v = nah(SHIP, 900, rad(60)), vz = zeichne(KARTEN[0], 'schiff', 60, { enemies: [gegner('v', v.x, v.y)] });
  const pv = vz.rec.pfeile.filter((q) => q.fs === PAL.red)[0];
  ok(pv && Math.abs(pv.x - vz.cx) < 2 && pv.y < OPS.y + 20 && Math.abs(Math.atan2(Math.sin(pv.ang), Math.cos(pv.ang)) + Math.PI / 2) < 0.02, 'Schiff oben: Gegner voraus (Kurs 60°) – Pfeil oben über der Schiffsmitte, zeigt nach oben');
  const sb = nah(SHIP, 900, rad(60 + 90)), sz = zeichne(KARTEN[0], 'schiff', 60, { enemies: [gegner('v', sb.x, sb.y)] });
  const ps = sz.rec.pfeile.filter((q) => q.fs === PAL.red)[0];
  ok(ps && ps.x > OPS.x + OPS.w - 20 && Math.abs(ps.y - sz.cy) < 2 && Math.abs(Math.atan2(Math.sin(ps.ang), Math.cos(ps.ang))) < 0.02, 'Schiff oben: Gegner Steuerbord – Pfeil am rechten Rand auf Höhe der Schiffsmitte, zeigt nach rechts');
}

// ---------------------------------------------------------------------------------------------------------------------------------
section('Verdrahtung: Taste Shift+Z, Knopf mit Kappe, Skript, keine fremden Eingriffe');
{
  const TW = { localStorage: null }; vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'tasten.js'), 'utf8'), { window: TW, console }, { filename: 'tasten.js' });
  const T = TW.Tasten;
  const ids = T.AKTIONEN.filter((a) => /ausrichtung$/.test(a.id));
  ok(ids.length === 2 && ids.every((a) => a.std.length === 1 && a.std[0] === 'Shift+KeyZ'), 'Tasten: ops.ausrichtung und captain.lage.ausrichtung auf Shift+Z');
  ok(T.AKTIONEN.find((a) => a.id === 'ops.zoom').std[0] === 'KeyZ', 'Z bleibt Zoom (reihum), Shift+Z ist eine eigene Aktion');
  const rd = (f) => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8');
  const kons = rd('consoles.js'), pult = rd('pult-stationen.js'), html = rd('../index.html'), rend = rd('render.js');
  ok(/<script src="js\/kartenlogik\.js"><\/script>/.test(html) && html.indexOf('js/kartenlogik.js') < html.indexOf('js/consoles.js') && html.indexOf('js/kartenlogik.js') < html.indexOf('js/pult-stationen.js'), 'index.html bindet kartenlogik.js vor consoles.js und pult-stationen.js ein');
  ok(/'ops\.ausrichtung'/.test(pult) && /'captain\.lage\.ausrichtung'/.test(kons), 'Knopf mit Kappe: Ops (pult-stationen.js) und Captain-Lage (consoles.js) tragen die Aktion');
  ok(/code === 'KeyZ' && e\.shiftKey\) return press\(\(\) => this\.tryButton\('Ausrichtung'\)\)/.test(kons) && (kons.match(/tryButton\('Ausrichtung'\)/g) || []).length === 2, 'Consoles.keyDown: Shift+Z drückt den Knopf „Ausrichtung“ (Ops und Captain-Lage) vor dem Zoom auf Z');
  ok(/Kartenlogik\.optionen\('weapons', view\)/.test(pult) && /Kartenlogik\.optionen\('lage', view\)/.test(kons), 'Ops und Captain rufen Kartenlogik direkt auf (kein Stationsparameter, kein lokaler Zustand in consoles.js)');
  ok(!/fuerCaptain|fuerOps/.test(rend + kons + pult), 'kein Stationsparameter wie fuerCaptain in render/consoles/pult');
  ok(/rot: opts\.rot \|\| 0/.test(rend) && !/rot: 0 }, opts\)/.test(rend), 'Render.drawTactical reicht rot aus den Optionen an drawSpace (nicht mehr fest 0)');
  ok(/const rot = -\(ship\.angle \|\| 0\) - Math\.PI \/ 2/.test(rend) && /mode: 'front', zoom, rot, cx, cy, bound: win/.test(rend), 'Frontsicht (drawFrontView) unverändert');
}

// ---------------------------------------------------------------------------------------------------------------------------------
section('Sprungboje (R4): der Richtungspfeil zeigt in Bildschirmrichtung des Zielsektors');
{
  for (const q of ['kartenzeichen.js', 'karte-tokens.js', 'kartenansicht.js', 'starmap.js']) lade(q);
  const gesehen = [];
  win.IconsB = { boje(ctx, z, x, y, zoom, w) { gesehen.push(w); return true; } };   // Attrappe: nimmt den Richtungswinkel entgegen
  const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const SZ = { w: 6000, h: 6000 };
  const boje = { z: 'aktiv', n: '1,2', x: SHIP.x + 120, y: SHIP.y - 60 };   // Zielsektor: vom Szenenmittelpunkt (3000, 3000) aus gesehen nach links oben
  const wWelt = Math.atan2(boje.y - SZ.h / 2, boje.x - SZ.w / 2);
  let alle = true; const detail = [];
  for (const [k, ausr, kurs] of [[KARTEN[0], 'schiff', 0], [KARTEN[0], 'schiff', 90], [KARTEN[0], 'schiff', 200], [KARTEN[1], 'schiff', 315], [KARTEN[0], 'norden', 90]]) {
    gesehen.length = 0;
    const z = zeichne(k, ausr, kurs, {}, Object.assign({ jp: [boje] }, SZ));
    // Bildschirmrichtung des Weltwinkels wWelt: Bild zweier Weltpunkte im Abstand 100 in dieser Richtung
    const a = z.res.toS(boje.x, boje.y), b = z.res.toS(boje.x + Math.cos(wWelt) * 100, boje.y + Math.sin(wWelt) * 100);
    const soll = Math.atan2(b.y - a.y, b.x - a.x);
    const ist = gesehen.length === 1 ? gesehen[0] : NaN;
    if (!(Math.abs(norm(ist - soll)) < 0.02)) alle = false;
    detail.push(ausr + ' ' + kurs + '°: ' + (isNaN(ist) ? 'keine Boje' : Math.round(norm(ist) * 180 / Math.PI) + '° (Soll ' + Math.round(soll * 180 / Math.PI) + '°)'));
  }
  ok(alle, 'Pfeilwinkel an IconsB.boje = Bildschirmrichtung zum Zielsektor (Schiff oben bei 0°/90°/200°, Captain-Lage 315°, Norden oben): ' + detail.join('; '));
  ok(fs.readFileSync(path.join(ROOT, 'public', 'js', 'starmap.js'), 'utf8').includes('w + (cam.front ? 0 : (cam.rot || 0))'), 'starmap.js addiert cam.rot (nur Karten, nicht Frontsicht) zum Weltwinkel');
}

section('Nordmarke (G2): „N“ nur bei „Schiff oben“, bei „Norden oben“ nicht');
{
  const hatN = (ausr, kurs, k) => zeichne(k || KARTEN[0], ausr, kurs, {}).rec.texte.some((t) => t.s === 'N');
  ok(hatN('schiff', 0) && hatN('schiff', 135) && hatN('schiff', 135, KARTEN[1]), 'Schiff oben: „N“ steht am Rand (Ops und Captain-Lage)');
  ok(!hatN('norden', 0) && !hatN('norden', 135) && !hatN('norden', 135, KARTEN[1]), 'Norden oben: kein „N“ (Ops und Captain-Lage)');
  KL.setze('weapons', 'norden'); const on = KL.optionen('weapons', ansicht(0)); KL.setze('weapons', 'schiff'); const os = KL.optionen('weapons', ansicht(0));
  ok(on.nordmarke === false && os.nordmarke === true, 'Kartenlogik.optionen: nordmarke false bei Norden oben, true bei Schiff oben');
  const direkt = (opts) => { const { ctx, rec } = neueFlaeche(); R.drawTactical(ctx, ansicht(0), OPS, Object.assign({ zoom: 0.35, mode: 'tactical' }, opts)); return rec.texte.some((t) => t.s === 'N'); };
  ok(!direkt({ nordmarke: false, rot: 0 }) && !direkt({ rot: 0 }) && direkt({ nordmarke: true, rot: 0.5 }), 'drawTactical: bei nordmarke false kein „N“, bei true „N“');
}

console.log('\n' + (fails ? fails + ' von ' + n + ' Prüfungen FEHLGESCHLAGEN' : 'alle ' + n + ' Prüfungen bestanden'));
process.exit(fails ? 1 : 0);
