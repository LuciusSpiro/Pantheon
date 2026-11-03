'use strict';
// KUL-03 B1: Objekte des Visiers (public/js/visier-objekte.js), reiner Node-Test ohne Browser.
//   (1) Sortierung hinten -> vorn nach Tiefe
//   (2) Gegner hinter dem Schiff (und hinter der Kamera) stehen nicht im Hauptbild
//   (3) Groesse 1,6-fach, mindestens 16 px, hoechstens 3,2-fach; Dunst ab 280, hoechstens 38 %
//   (4) Marke fester Groesse 20 x 10, unabhaengig von der Entfernung
//   (5) Zielklammern nur am Ziel der Ops (der Text steht seit B2 in visier-beschriftung.js)
//   (6) Verbuendete in Mint, Eigenes Schiff nicht in der Liste
//   (7) kein Wurf bei leeren/fehlenden Listen und kaputten Eintraegen; save/restore ausgeglichen
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const rad = (g) => g * Math.PI / 180;
globalThis.HauptschirmTokens = require('../public/js/hauptschirm-tokens.js');
const TK = HauptschirmTokens.TOKENS, V = TK.VISIER, OB = V.objekt;
require('../public/js/kulisse-himmel.js');
const Vis = require('../public/js/visier.js');
const textCalls = [];
globalThis.Render = { textKontur: (ctx, s, x, y, o) => textCalls.push({ s, x, y, o }) };
let zielId = null;
globalThis.Consoles = { targetOf: (view) => (zielId ? (view.enemies || []).find((e) => e.id === zielId) || null : null) };
const Obj = require('../public/js/visier-objekte.js');
const c = Vis.kamera();

// Szene: Schiff bei (1000, 1000), Kurs Osten (0 = +x). voraus = +x, Steuerbord = +y.
const ship = { x: 1000, y: 1000, angle: 0 };
const enemy = (id, f, r, kind, extra) => Object.assign({ id, kind: kind || 'raider', x: 1000 + f, y: 1000 + r, angle: rad(180), hp: 8, hpMax: 10, shields: [1, 1, 1, 1], shieldsMax: [2, 2, 2, 2] }, extra);
const mkView = (enemies, extra) => Object.assign({ time: 1, ship, enemies, escorts: [], spaceProjectiles: [], state: { ship: Object.assign({ scene: 'zz', jump: {} }, ship), space: {} } }, extra);
const plan = (v) => Vis.plan(v);
const lage = (v) => Obj.baue(v, plan(v), c);

section('(1) Sortierung hinten -> vorn');
{
  const v = mkView([enemy('a', 250, 0), enemy('b', 700, 60), enemy('c', 450, -80), enemy('d', 210, 40), enemy('e', 560, -20, 'korvette')]);
  const L = lage(v), g = L.objekte.filter((o) => o.art === 'gegner');
  ok(g.length === 5, g.length + ' Gegner im Bild');
  ok(g.every((o, i) => i === 0 || g[i - 1].tiefe >= o.tiefe), 'Tiefe fallend (hinten zuerst): ' + g.map((o) => Math.round(o.tiefe)).join(' > '));
  v.state.space.mines = [{ id: 'm1', x: 1300, y: 1000, s: 1 }]; v.state.space.asteroids = [{ id: 'a1', x: 1500, y: 1100, r: 40 }];
  const L2 = lage(v);
  ok(L2.objekte.every((o, i) => i === 0 || L2.objekte[i - 1].tiefe >= o.tiefe), 'gemischte Objektarten (Gegner, Mine, Asteroid) in einer Tiefenreihenfolge (' + L2.objekte.map((o) => o.art).join(', ') + ')');
}

section('(2) hinter dem Schiff nicht im Hauptbild');
{
  const v = mkView([enemy('vorn', 300, 0), enemy('hinten', -200, 30), enemy('neben', 0, 400), enemy('knapp', 20, 0), enemy('weitHinten', -900, 0)]);
  const ids = lage(v).objekte.filter((o) => o.art === 'gegner').map((o) => o.e.id);
  ok(ids.includes('vorn'), 'Gegner voraus im Bild');
  ok(!ids.includes('hinten') && !ids.includes('weitHinten'), 'Gegner hinter dem Schiff nicht im Bild');
  ok(!ids.includes('neben'), 'Gegner querab (ausserhalb des Blickfelds) nicht im Bild');
  ok(!ids.includes('knapp'), 'Gegner unter der Mindesttiefe (Z 20, vor der Kamera aber < tiefeMin) nicht im Bild');
  ok(!Vis.projiziereWelt(ship, 800, 1000, 0).ok, 'Gegenprobe: projiziereWelt hinter dem Schiff ok = false');
}

section('(3) Groesse und Dunst');
{
  const g = Obj.groesse(32, 1);
  ok(Math.abs(g.faktor - 1.6) < 1e-9 && Math.abs(g.px - 51.2) < 1e-9, 'nah: 1,6-fach (32 -> ' + g.px.toFixed(1) + ' px)');
  let min = Infinity;
  for (const L0 of [32, 68, 88, 104]) for (let k = 0.2; k <= 3; k += 0.05) { const q = Obj.groesse(L0, k); if (q.faktor < 3.2 - 1e-9) min = Math.min(min, q.px); if (q.faktor < 1.6 - 1e-9 || q.faktor > 3.2 + 1e-9) fails++; }
  ok(min >= 16 - 1e-6, 'mindestens 16 px lang, solange der Faktor unter 3,2 bleibt (kleinster Wert ' + min.toFixed(2) + ')');
  const fern = Obj.groesse(32, 0.3);
  ok(fern.faktor > 1.6 && fern.faktor <= 3.2 && fern.px >= 16 - 1e-6, 'fern: Faktor waechst (' + fern.faktor.toFixed(2) + '), Laenge ' + fern.px.toFixed(1) + ' px >= 16');
  ok(Obj.groesse(32, 0.01).faktor === 3.2, 'Faktor hoechstens 3,2');
  ok(Obj.dunst(100) === 0 && Obj.dunst(280) === 0, 'kein Dunst bis 280');
  ok(Math.abs(Obj.dunst(500) - 220 / 1100) < 1e-9 && Obj.dunst(281) > 0, 'Dunst linear ab 280: (Tiefe - 280) / 1100 (Tiefe 500 -> ' + Obj.dunst(500).toFixed(3) + ')');
  ok(Obj.dunst(5000) === 0.38 && Obj.dunst(1e9) === 0.38, 'Dunst hoechstens 38 %');
  const Vn = lage(mkView([enemy('n', 250, 0)])).objekte[0], Vf = lage(mkView([enemy('f', 900, 0)])).objekte[0];
  ok(Vn.dunst === 0 && Vf.dunst > 0, 'Liste: nah ohne Dunst, fern mit Dunst (' + Vf.dunst.toFixed(2) + ')');
  ok(Vn.gr.faktor >= 1.6 && Vf.gr.faktor >= Vn.gr.faktor, 'Liste: Groesse aus groesse() (nah ' + Vn.gr.faktor.toFixed(2) + ', fern ' + Vf.gr.faktor.toFixed(2) + ')');
}

section('(4) Marke fester Groesse');
{
  const M = OB.marke;
  for (const f of [250, 400, 650, 900]) {
    const o = lage(mkView([enemy('m', f, 20, 'korvette')])).objekte[0], r = Obj.marke(o.bb);
    ok(Math.abs((r.x1 - r.x0) - M.w) < 1e-9 && Math.abs((r.y1 - r.y0) - M.h) < 1e-9, 'Entfernung ' + f + ': Marke ' + (r.x1 - r.x0) + ' x ' + (r.y1 - r.y0) + ' (20 x 10), Modell ' + Math.round(o.bb.x1 - o.bb.x0) + ' px breit');
    ok(Math.abs(r.y1 - (o.bb.y0 - M.abstand)) < 1e-9, '  sitzt 3 px ueber der Oberkante des Modells');
  }
  ok(M.w === 20 && M.h === 10 && M.huelle.h === 3, 'Token 20 x 10, Huellenbalken 3 px');
}

section('(5) Zielmarke nur am Ziel');
{
  const v = mkView([enemy('a', 300, -20), enemy('b', 400, 60), enemy('c', 500, 0)]);
  zielId = 'b';
  const L = lage(v), z = L.objekte.filter((o) => o.ziel);
  ok(z.length === 1 && z[0].e.id === 'b', 'genau ein Objekt mit Ziel-Kennzeichen: ' + z.map((o) => o.e.id));
  const prot = [], ctx = new Proxy({}, { get: (t, k) => (k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 0 }) : (...a) => { prot.push(k); }), set: () => true });
  textCalls.length = 0;
  Obj.zeichne(ctx, v, plan(v), c);
  ok(textCalls.length === 0, 'B1 zeichnet keinen Text mehr (ZIEL-Text und Marken setzt B2 in visier-beschriftung.js)');
  ok(prot.includes('stroke') && lage(v).objekte.find((o) => o.e && o.e.id === 'b').ziel, 'Zielklammern werden weiter in B1 gezeichnet');
  zielId = null; textCalls.length = 0;
  Obj.zeichne(ctx, v, plan(v), c);
  ok(textCalls.length === 0 && lage(v).objekte.every((o) => !o.ziel), 'ohne Ziel: keine Zielmarke, kein Text');
  zielId = null;
}

section('(6) Verbuendete, Eigenes Schiff');
{
  const v = mkView([enemy('f1', 300, 0)], { escorts: [{ id: 'z1', kind: 'korvette', x: 1400, y: 1050, angle: 0, hp: 5, hpMax: 10, al: 1 }] });
  const L = lage(v), fr = L.objekte.find((o) => o.art === 'gegner' && o.e.id === 'z1');
  ok(fr && fr.freund && !L.objekte.find((o) => o.e && o.e.id === 'f1').freund, 'Verbuendeter als Freund markiert, Gegner nicht');
  ok(TK.VISIER.objekt.gegner.freund.farbe === TK.FARBE.schild, 'Freund-Farbe = Mint (FARBE.schild)');
  ok(L.objekte.filter((o) => o.art === 'gegner').length === 2, 'nur 2 Schiffe in der Liste: das eigene Schiff wird nicht gezeichnet');
}

section('(7) Robustheit');
{
  const prot = [], ctx = new Proxy({}, { get: (t, k) => (k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 0 }) : (...a) => { prot.push(k); }), set: () => true });
  let w = null;
  const leer = mkView([]);
  const faelle = [[leer], [{}], [null], [mkView(undefined)], [mkView(null, { escorts: null, spaceProjectiles: null })],
    [mkView([null, {}, { id: 'x', x: NaN, y: 1 }, { id: 'y', x: 1300, y: 1000 }, enemy('k', 300, 0, 'unbekannt')])],
    [Object.assign(mkView([]), { state: { ship: Object.assign({ jump: {} }, ship), space: { markers: [null, { kind: 'dock' }, { kind: 'station', x: 1300, y: 1000 }, { kind: 'exit', x: 1400, y: 1000 }], jp: [null, { x: 1300, y: 1020, k: 'b' }], asteroids: [null, { x: 1400, y: 1000 }, { x: 'a', y: 1 }], mines: [null, {}], hidden: [null], salvage: [null], beams: [null, { x1: 1, y1: 1 }, { x1: 1100, y1: 1000, x2: 1300, y2: 1000, kind: 'lance' }] }, fracht: { draussen: [null, { x: 1300, y: 1050 }] } } })]];
  try {
    for (const [v] of faelle) { if (v && v.state) { const L = Vis.plan(v); Obj.baue(v, L, c); Obj.zeichne(ctx, v, L, c); } else { Obj.baue(v, null, c); Obj.zeichne(ctx, v, null, c); } }
    Obj.baue(); Obj.zeichne();
  } catch (e) { w = e; }
  ok(!w, 'wirft nicht bei leeren/fehlenden Listen, Nullen und kaputten Eintraegen' + (w ? ': ' + w.stack : ''));
  ok(prot.filter((k) => k === 'save').length === prot.filter((k) => k === 'restore').length, 'save/restore ausgeglichen (' + prot.filter((k) => k === 'save').length + ')');
  ok(Obj.baue(leer, Vis.plan(leer), c).objekte.length === 0, 'leere Szene: leere Liste');
  ok(Obj.baue(null, null, c) === null, 'ohne View: null');
  // Schicht angemeldet: Visier.zeichne ruft sie ueber registriereSchicht
  const v = mkView([enemy('s', 300, 0)]);
  const prot2 = [], ctx2 = new Proxy({}, { get: (t, k) => (k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 0 }) : (...a) => { prot2.push(k); }), set: () => true });
  zielId = 's'; textCalls.length = 0;
  Vis.zeichne(ctx2, v, { x: 0, y: 0, w: 512, h: 288 });
  ok(prot2.includes('drawImage') || prot2.includes('stroke'), 'Visier.zeichne ruft die Schicht "objekte" (es wird gezeichnet)');
  zielId = null;
}
section('(8) Schildring der Gegner (N1 B4)');
{
  // Stufen 0..4 aus shields/shieldsMax je Seite (Bug, Steuerbord, Heck, Backbord); leer = 0; null ohne Schilde
  const st = (sh, mx) => Obj.seitenStufen({ kind: 'raider', shields: sh, shieldsMax: mx });
  ok(JSON.stringify(st([0, 1, 2, 2], [2, 2, 2, 2])) === '[0,2,4,4]', 'Stufen aus Ist/Max: [0,1,2,2] von 2 -> ' + JSON.stringify(st([0, 1, 2, 2], [2, 2, 2, 2])) + ' (0 = leer, 4 = voll)');
  ok(JSON.stringify(st([2, 2, 2, 2], [2, 2, 2, 2])) === '[4,4,4,4]' && JSON.stringify(st([6, 3, 1.5, 0.2], [6, 6, 6, 6])) === '[4,2,1,1]', 'volle Seiten 4, halbe 2, ein Rest mindestens 1');
  ok(JSON.stringify(st([0, 0, 0, 0], [2, 2, 2, 2])) === '[0,0,0,0]', 'alle Seiten leer: 0');
  ok(Obj.seitenStufen({ kind: 'raider' }) === null && Obj.seitenStufen({ kind: 'raider', shields: [] }) === null, 'ohne Schilde im Snapshot: null (kein Ring)');
  // gezeichnet: je Gegner vier Bogen (einer je Seite), leere Seite rot gestrichelt, sonst Mint mit Breite und Deckung nach Stufe
  const SR = OB.gegner.schildring, mint = parseInt(TK.FARBE.schild.slice(1), 16), rot = parseInt(TK.FARBE.gefahr.slice(1), 16);
  const rgb = (n) => (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
  const speicher = { lineWidth: 1, strokeStyle: '#000', dash: [] }, strokes = [];
  const ctxS = new Proxy({}, { get: (t, k) => (k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 0 }) : k in speicher ? speicher[k] : k === 'setLineDash' ? (d) => { speicher.dash = d.slice(); } : k === 'stroke' ? () => { strokes.push({ w: speicher.lineWidth, s: String(speicher.strokeStyle), dash: speicher.dash.join(',') }); } : () => {}), set: (t, k, v) => { speicher[k] = v; return true; } });
  const ringe = (e) => { strokes.length = 0; const v = mkView([e]); Obj.zeichne(ctxS, v, plan(v), c); return strokes.filter((q) => q.s.startsWith('rgba(' + rgb(mint) + ',') || q.s.startsWith('rgba(' + rgb(rot) + ',')); };
  const R1 = ringe(enemy('s1', 300, 0, 'raider', { shields: [0, 2, 1, 2], shieldsMax: [2, 2, 2, 2] }));   // erwartete Stufen 0, 4, 2, 4
  ok(R1.length === 4, 'vier Schildbogen je Gegner (' + R1.length + ')');
  ok(R1[0] && R1[0].dash === SR.leer.strich.join(',') && R1[0].s.startsWith('rgba(' + rgb(rot) + ',') && R1[0].w === SR.leer.breite, 'leere Seite (Bug): rot gestrichelt, Breite ' + SR.leer.breite);
  const wStufe = (v) => SR.breiteGrund + v * SR.breiteJeStufe;
  ok(R1[1] && R1[1].dash === '' && R1[1].w === wStufe(4) && R1[2] && R1[2].w === wStufe(2) && R1[3] && R1[3].w === wStufe(4), 'Seiten Steuerbord/Heck/Backbord: Breite nach Stufe 4/2/4 (' + R1.slice(1).map((q) => q.w).join('/') + ')');
  const alpha = (q) => +q.s.match(/,([\d.]+)\)$/)[1];
  ok(R1[1] && Math.abs(alpha(R1[1]) - Math.min(1, SR.alphaGrund + 4 * SR.alphaJeStufe)) < 1e-9 && alpha(R1[2]) < alpha(R1[1]), 'Deckung waechst mit der Stufe (' + [R1[1], R1[2]].map((q) => alpha(q)).join(' > ') + ')');
  ok(ringe(enemy('s2', 300, 0, 'raider', { shields: undefined, shieldsMax: undefined })).length === 0, 'Gegner ohne Schilde: kein Ring');
  const zwei = (() => { strokes.length = 0; const v = mkView([enemy('a', 300, 0, 'raider', { shields: [2, 2, 2, 2] }), enemy('b', 500, 60, 'raider', { shields: [2, 2, 0, 0] })]); Obj.zeichne(ctxS, v, plan(v), c); return strokes.filter((q) => q.s.startsWith('rgba(' + rgb(mint) + ',') || q.s.startsWith('rgba(' + rgb(rot) + ',')); })();
  ok(zwei.length === 8 && zwei.filter((q) => q.dash === '2,3').length === 2, 'zwei Gegner: 8 Bogen, davon 2 leere Seiten');
}

console.log('\n' + (fails ? fails + ' von ' + n + ' FEHLER' : 'alle ' + n + ' Pruefungen gruen'));
process.exit(fails ? 1 : 0);
