'use strict';
// KUL-03 D: Lagescheibe des Visiers (public/js/visier-lage.js), reiner Node-Test ohne Browser.
//   (1) Abbildung Welt -> Scheibe: voraus oben, hinter dem Schiff unten, Steuerbord rechts, bei Kurs 0 / 90 / 217 Grad (Kompass Nord = 0, Ost = 90, Uhrzeigersinn)
//   (2) Radius 800 = Scheibenrand; weiter entfernte Kontakte klemmen am Rand; Kontakt hinter dem Schiff erscheint in der Scheibe
//   (3) Keil = halber waagrechter Blickwinkel aus Visier.kamera() (±40 Grad)
//   (4) Schildring nur wenn Schilde im Snapshot, Stufen 0..4, offene Seite = 0
//   (5) Kontakte aus dem Snapshot: Gegner, Verbuendete, Sprungboje/-punkt, Station, Ziel der Ops hervorgehoben
//   (6) kein Wurf bei fehlenden Daten, Zeichnen mit Attrappe ohne Fehler, keine Texte
//   (7) Scheibe liegt im Schirm und ueberlappt weder Sprungziel-Tafel oben rechts, noch Band der Leiste, noch das Kursfeld links; Schicht ist angemeldet
let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const rad = (g) => g * Math.PI / 180;
globalThis.HauptschirmTokens = require('../public/js/hauptschirm-tokens.js');
const TK = HauptschirmTokens.TOKENS, V = TK.VISIER, LG = V.lagescheibe, W = TK.SCHIRM.w, H = TK.SCHIRM.h;
require('../public/js/kulisse-himmel.js');
const Vis = require('../public/js/visier.js');
const VL = require('../public/js/visier-lage.js');
const kam = Vis.kamera(), geo = VL.geometrie(kam);
// Schiff mit Kurs k (Grad, Kompass: 0 = Nord = -y der Welt, 90 = Ost = +x); Weltwinkel (Bogenmass, 0 = +x) = rad(k - 90)
const schiff = (k, x, y) => ({ x: x == null ? 1000 : x, y: y == null ? 1000 : y, angle: rad(k - 90) });
// Punkt im Abstand d in Richtung Kompass-Peilung p
const punkt = (s, p, d) => ({ x: s.x + Math.sin(rad(p)) * d, y: s.y - Math.cos(rad(p)) * d });
const abb = (s, p, d) => { const q = punkt(s, p, d); return VL.abbilden(s, q.x, q.y, geo); };
const nahe = (a, b, e) => Math.abs(a - b) <= (e == null ? 0.01 : e);

section('(1) Abbildung Welt -> Scheibe');
for (const k of [0, 90, 217]) {
  const s = schiff(k), vor = abb(s, k, 400), hin = abb(s, k + 180, 400), stb = abb(s, k + 90, 400), bb = abb(s, k - 90, 400);
  ok(nahe(vor.x, geo.cx) && nahe(vor.y, geo.cy - geo.R / 2), 'Kurs ' + k + ': 400 voraus liegt oben (halber Radius), x = Mitte');
  ok(nahe(hin.x, geo.cx) && nahe(hin.y, geo.cy + geo.R / 2), 'Kurs ' + k + ': 400 hinter dem Schiff liegt unten');
  ok(nahe(stb.x, geo.cx + geo.R / 2) && nahe(stb.y, geo.cy), 'Kurs ' + k + ': Steuerbord rechts');
  ok(nahe(bb.x, geo.cx - geo.R / 2) && nahe(bb.y, geo.cy), 'Kurs ' + k + ': Backbord links');
}
const sA = schiff(217);
ok(nahe(VL.abbilden(sA, sA.x, sA.y, geo).x, geo.cx) && nahe(VL.abbilden(sA, sA.x, sA.y, geo).y, geo.cy), 'das eigene Schiff liegt in der Mitte');
const sB = schiff(0), q = VL.abbilden(sB, sB.x + 400, sB.y - 400, geo);   // Nordost bei Kurs Nord: rechts oben
ok(q.x > geo.cx && q.y < geo.cy, 'Kurs 0: Kontakt Nordost steht rechts oben');
const qv = VL.abbilden({ x: 1000, y: 1000, angle: rad(-90) }, 1000, 600, geo);
ok(nahe(qv.x, geo.cx) && qv.y < geo.cy, 'angle im Bogenmass der Welt (0 = +x): -90 Grad = Nord, Kontakt in -y steht oben');
ok(Math.abs(VL.abbilden(sB, 1000 + 123, 1000 - 321, geo).d - Math.hypot(123, 321)) < 1e-9, 'd = Weltabstand');
const s217 = schiff(217), p217 = punkt(s217, 217 + 45, 300), pw = Vis.projiziereWelt(s217, p217.x, p217.y, 0);
ok(abb(s217, 217 + 45, 300).x > geo.cx && pw.x > W / 2, 'gleiche Seite wie Visier.projiziereWelt (Steuerbord = rechts)');
const hw = punkt(s217, 217 + 180, 300);
ok(!Vis.projiziereWelt(s217, hw.x, hw.y, 0).ok && abb(s217, 217 + 180, 300).y > geo.cy, 'was der Hauptschirm nicht zeigt (hinten), zeigt die Scheibe');

section('(2) Radius 800 und Rand');
const s0 = schiff(0);
const r800 = VL.abbilden(s0, s0.x, s0.y - 800, geo);
ok(LG.reichweiteWelt === 800 && Math.hypot(r800.x - geo.cx, r800.y - geo.cy) <= geo.R + 1e-9 && Math.hypot(r800.x - geo.cx, r800.y - geo.cy) >= geo.R - LG.randPad - 1e-9, 'Kontakt auf 800 liegt am Scheibenrand (R ' + geo.R + ', mit Randabstand ' + LG.randPad + ')');
const r400 = VL.abbilden(s0, s0.x, s0.y - 400, geo);
ok(nahe(r400.y, geo.cy - geo.R * 0.5) && nahe(geo.R * LG.mitte.anteil, geo.R / 2), 'Massstab: 400 = halber Radius = Ring der Scheibe');
const fern = VL.abbilden(s0, s0.x + 3000, s0.y + 500, geo);
ok(fern.geklemmt && nahe(Math.hypot(fern.x - geo.cx, fern.y - geo.cy), geo.R - LG.randPad), 'Kontakt auf 3000 klemmt am Rand (R - ' + LG.randPad + ')');
ok(!VL.abbilden(s0, s0.x, s0.y - 700, geo).geklemmt, 'Kontakt auf 700 ist nicht geklemmt');
ok(nahe(Math.atan2(fern.x - geo.cx, -(fern.y - geo.cy)), Math.atan2(3000, -500), 1e-6), 'Klemmen behaelt die Richtung');
const hinten = VL.abbilden(s0, s0.x + 50, s0.y + 600, geo);
ok(hinten.y > geo.cy && Math.hypot(hinten.x - geo.cx, hinten.y - geo.cy) <= geo.R, 'Kontakt hinter dem Schiff (600) erscheint unten in der Scheibe');

section('(3) Keil');
ok(Math.abs(VL.keilGrad(kam) - LG.keil.halbGrad) <= 1 && Math.abs(VL.keilGrad(kam) - 39.7) < 0.2, 'Keil ±' + VL.keilGrad(kam).toFixed(2) + ' Grad (aus Visier.kamera, Token ' + LG.keil.halbGrad + ')');
const randvoraus = abb(s0, 39.5, 300), ausserhalb = abb(s0, 41, 300);
const inKeil = (p) => Math.abs(Math.atan2(p.x - geo.cx, -(p.y - geo.cy))) <= rad(VL.keilGrad(kam));
ok(inKeil(randvoraus) && !inKeil(ausserhalb), 'Kontakt bei 39,5 Grad liegt im Keil, bei 41 Grad nicht');

section('(4) Schildring');
ok(VL.schildStufen({}) === null && VL.schildStufen(null) === null && VL.schildStufen({ shields: {} }) === null && VL.schildStufen({ shields: { current: [1, 2] } }) === null, 'ohne Schilde im Snapshot: null (kein Ring)');
ok(JSON.stringify(VL.schildStufen({ shields: { current: [4, 4, 4, 4], alloc: [4, 4, 4, 4], cap: [4, 4, 4, 4] } })) === '[4,4,4,4]', 'volle Schilde: 4 je Seite');
ok(JSON.stringify(VL.schildStufen({ shields: { current: [4, 2, 0, 1], alloc: [4, 4, 4, 4], cap: [4, 4, 4, 4] } })) === '[4,2,0,1]', 'Seiten Bug/Stb/Heck/Bb: 4, 2, 0 (offen), 1 (angeschlagen)');
ok(VL.schildStufen({ shields: { current: [1, 1, 1, 1], alloc: [8, 8, 8, 8], cap: 8 } })[0] === 1, 'Zahl als cap, 1 von 8: Stufe 1');
const st = () => ({ state: { ship: Object.assign(schiff(0), { shields: { current: [3, 3, 3, 3], alloc: [4, 4, 4, 4], cap: [4, 4, 4, 4] } }) }, ship: schiff(0), enemies: [] });
ok(VL.plan(st(), null, kam).schild.join() === '3,3,3,3', 'Plan traegt die Schildstufen');
const ohne = st(); delete ohne.state.ship.shields;
ok(VL.plan(ohne, null, kam).schild === null, 'Plan ohne Schilde: schild = null');

section('(5) Kontakte');
const ship = schiff(0), vorn = punkt(ship, 0, 300), achter = punkt(ship, 180, 500), rechts = punkt(ship, 90, 200);
const view = {
  ship, state: { ship: Object.assign({}, ship, { target: 'e2', shields: { current: [4, 4, 4, 4] } }), space: { jp: [{ k: 'x', x: rechts.x, y: rechts.y }], markers: [{ kind: 'exit', x: 1000, y: 700 }, { kind: 'dock', x: 900, y: 900, r: 70 }, { kind: 'station', x: 1200, y: 1000, name: 'Hafen' }] } },
  enemies: [{ id: 'e1', x: vorn.x, y: vorn.y }, { id: 'e2', x: achter.x, y: achter.y }, { id: 'e3', x: 5000, y: 5000 }, { id: 'e4', x: NaN, y: 1 }],
  escorts: [{ id: 'a1', x: 1100, y: 1100, al: 1 }],
};
const P = VL.plan(view, null, kam);
const art = (a) => P.kontakte.filter((k) => k.art === a);
ok(art('gegner').length === 3, 'drei gueltige Gegner (NaN fliegt raus)');
ok(art('verbuendet').length === 1, 'ein Verbuendeter');
ok(art('sprung').length === 2, 'Sprungboje und Sprungpunkt');
ok(art('station').length === 1 && !art('station')[0].ziel, 'Station, nicht Ziel (Dock-Ring zaehlt nicht)');
const zi = P.kontakte.filter((k) => k.ziel);
ok(zi.length === 1 && zi[0].art === 'gegner' && zi[0].y > geo.cy, 'Ziel der Ops (e2, hinter dem Schiff) ist hervorgehoben und steht unten');
ok(P.kontakte[P.kontakte.length - 1].ziel, 'Ziel wird zuletzt gezeichnet (obenauf)');
ok(P.kontakte.filter((k) => k.art === 'gegner' && k.geklemmt).length === 1, 'Gegner auf 5000 klemmt am Rand, die beiden anderen nicht');
const mitStation = JSON.parse(JSON.stringify(view)); mitStation.state.ship.target = 'station';
ok(VL.plan(mitStation, null, kam).kontakte.filter((k) => k.ziel).map((k) => k.art).join() === 'station', 'Ziel = Station: der Stationspunkt traegt das Ziel');
const mitHidden = JSON.parse(JSON.stringify(view)); mitHidden.state.ship.target = 'h1';
globalThis.Consoles = { targetOf: (v) => (v.state.ship.target === 'h1' ? { id: 'h1', hidden: true, x: 1300, y: 900 } : null) };
ok(VL.plan(mitHidden, null, kam).kontakte.filter((k) => k.ziel).map((k) => k.art).join() === 'verborgen', 'verstecktes Ziel wird als Ziel-Punkt angefuegt');
delete globalThis.Consoles;

section('(6) Fehlende Daten, Zeichnen');
let wurf = null;
try {
  ok(VL.plan(null, null, kam) === null && VL.plan({}, null, kam) === null && VL.plan({ state: {} }, null, kam) === null, 'plan ohne Schiff: null');
  ok(VL.plan({ state: { ship: schiff(0) } }, null, kam).kontakte.length === 0, 'ohne enemies/escorts/space: leere Kontaktliste');
  ok(VL.plan({ state: { ship: schiff(0), space: { jp: 5, markers: 'x' } }, enemies: 'x', escorts: {} }, null, kam).kontakte.length === 0, 'Muell in den Listen: leer, kein Wurf');
  ok(VL.plan({ state: { ship: { x: NaN, y: 0, angle: 0 } } }, null, kam) === null, 'Schiff mit NaN: null');
  ok(VL.kontakte(null).length === 0 && VL.kontakte({}).length === 0, 'kontakte ohne view/state: leer');
} catch (e) { wurf = e; }
ok(!wurf, 'kein Wurf bei fehlenden Daten' + (wurf ? ' (' + wurf.message + ')' : ''));
const aufrufe = { text: 0, arc: 0, rect: 0 };
const ctx = new Proxy({}, { get: (t, n) => { if (n === 'fillText' || n === 'strokeText') return () => { aufrufe.text++; }; if (n === 'fillRect') return () => { aufrufe.rect++; }; if (n === 'arc') return () => { aufrufe.arc++; }; return () => {}; }, set: () => true });
try { VL.zeichne(ctx, view, { ship }, kam); VL.zeichne(ctx, {}, null, kam); VL.zeichne(null, view, null, kam); VL.zeichne(ctx, view, null, null); } catch (e) { wurf = e; }
ok(!wurf, 'zeichne wirft nicht (auch ohne view, ctx, kamera)' + (wurf ? ' (' + wurf.message + ')' : ''));
ok(aufrufe.text === 0, 'keine Texte in der Lagescheibe');
ok(aufrufe.arc >= 2 + 4 && aufrufe.rect >= 10, 'Scheibe, Ringe, Schildring (4 Seiten), Punkte und Schiffssymbol werden gezeichnet');

section('(7) Lage im Schirm, keine Ueberlappung');
const F = VL.flaeche(kam), TF = TK.TAFEL.rechts, LS = V.leiste;
const schneidet = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const tafel = { x: W + TF.x - TF.w, y: TF.y, w: TF.w, h: TF.h };
const band = { x: LS.band.rand, y: H - LS.hoehe, w: W - 2 * LS.band.rand, h: LS.hoehe };
const kursfeld = { x: 0, y: H - LS.hochfeld, w: LS.feldBreite, h: LS.hochfeld };
const links = { x: 0, y: 0, w: 192, h: 70 };   // oben links bleibt frei (Tafel links entfaellt)
ok(F.x >= 0 && F.y >= 0 && F.x + F.w <= W && F.y + F.h <= H, 'Scheibe liegt im Schirm (' + F.x + ',' + F.y + ' ' + F.w + 'x' + F.h + ')');
ok(!schneidet(F, tafel), 'ueberlappt nicht die Sprungziel-Tafel oben rechts');
ok(!schneidet(F, band), 'ueberlappt nicht das Peilband der Leiste (Band endet bei x ' + (W - LS.band.rand) + ', Scheibe beginnt bei x ' + F.x + ')');
ok(!schneidet(F, kursfeld), 'ueberlappt nicht das Tempo-/Kursfeld links');
ok(!schneidet(F, links), 'oben links bleibt frei');
ok(F.x > W - LS.band.rand, 'rechts vom Band');
ok(typeof Vis.registriereSchicht === 'function', 'Visier bietet registriereSchicht an');
const gemeldet = [];
globalThis.Visier = { registriereSchicht: (n, r, f) => gemeldet.push([n, r, f]) };
delete require.cache[require.resolve('../public/js/visier-lage.js')]; require('../public/js/visier-lage.js');
ok(gemeldet.length === 1 && gemeldet[0][0] === 'lage' && gemeldet[0][1] === 30 && typeof gemeldet[0][2] === 'function', 'meldet sich als Schicht lage, Rang 30 an');

console.log('\n' + (fails ? fails + ' FEHLER' : 'alles gruen'));
process.exit(fails ? 1 : 0);
