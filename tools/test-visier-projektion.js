'use strict';
// KUL-03 A: Projektion und Lage des Visiers (public/js/visier.js), reiner Node-Test ohne Browser.
//   (1) Horizont y = 55,5 (+-1), Brennweite 308,8; Hoehe traegt Objekte ueber/unter der Ebene (Schuesse, Asteroiden, Marken)
//   (2) Ringe 200/400/700 an den Tokenwerten (Bildzeilen wie im Mockup)
//   (3) Planeten-Sicherung: Oberkante nie hoeher als Horizont + 6; Planet waechst beim Anflug, Mittelpunkt rutscht nach unten
//   (4) Peilung: Punkt in Kurs k+Delta liegt auf der richtigen Seite, Delta = 0 auf x = 256; Weltachsen wie die klassische Frontsicht
//   (5) kein Wurf ohne Szene / ohne Planeten / ohne Schiff; Nebelregel dieselbe wie KulisseHimmel
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const rad = (g) => g * Math.PI / 180;
globalThis.HauptschirmTokens = require('../public/js/hauptschirm-tokens.js');
const TK = HauptschirmTokens.TOKENS, V = TK.VISIER, W = TK.SCHIRM.w;
const KH = require('../public/js/kulisse-himmel.js');   // setzt globalThis.KulisseHimmel (Nebelregel)
const Vis = require('../public/js/visier.js');
const Locs = require('../shared/locations.js');
globalThis.Shared_Locations = Locs;

section('(1) Kamera');
const cam = Vis.kamera();
ok(Math.abs(cam.horizont - 55.5) <= 1, 'Horizont y = ' + cam.horizont.toFixed(2) + ' (55,5 +-1)');
ok(Math.abs(cam.F - 308.8) < 0.1, 'Brennweite ' + cam.F.toFixed(1));
ok(Math.abs(V.kamera.horizontY - cam.horizont) <= 1, 'Token horizontY passt zur Rechnung');
const fern = Vis.projiziere(0, 1e6, 0);
ok(Math.abs(fern.y - cam.horizont) < 1, 'Ebene im Unendlichen liegt auf dem Horizont (y ' + fern.y.toFixed(2) + ')');
ok(Vis.projiziere(0, 100, 0).x === W / 2, 'Mitte voraus liegt auf x = ' + W / 2);
ok(!Vis.projiziere(0, -300, 0).ok && Vis.projiziere(0, 500, 0).ok, 'hinter dem Schiff: ok = false, voraus: true');
ok(Vis.projiziere(0, 300, 40).y < Vis.projiziere(0, 300, 0).y && Vis.projiziere(0, 300, -40).y > Vis.projiziere(0, 300, 0).y, 'Hoehe verschiebt den Punkt senkrecht (oben/unten)');

section('(2) Entfernungsringe');
const ZEILEN = V.glas.ringe.welt.map((r) => Vis.projiziere(0, r, 0).y);
ok(JSON.stringify(V.glas.ringe.welt) === '[200,400,700]', 'Tokenringe 200/400/700');
[213, 132, 99].forEach((e, i) => ok(Math.abs(ZEILEN[i] - e) <= 1.5, 'Ring ' + V.glas.ringe.welt[i] + ' voraus bei y ' + ZEILEN[i].toFixed(1) + ' (Mockup ' + e + ')'));
ok(ZEILEN[0] > ZEILEN[1] && ZEILEN[1] > ZEILEN[2] && ZEILEN[2] > cam.horizont, 'Ringe naeher = weiter unten, alle unter dem Horizont');
ok(Vis.projiziere(200, 300, 0).x > W / 2 && Vis.projiziere(-200, 300, 0).x < W / 2, 'Ring 200 Steuerbord rechts, Backbord links');

section('(3) Planeten-Sicherung und Anflug');
let minAbst = Infinity, zeilen = 0;
for (const R of [110, 150, 230, 520]) {
  for (const gr of [0, 30, -30]) {
    let letzt = null;
    for (const d of [30000, 15000, 8000, 3700, 2450, 1250, 650]) {
      const a = rad(gr), L = Vis.planetLage(Math.sin(a) * d, Math.cos(a) * d, R);
      if (!L.ok) continue;
      zeilen++;
      const ober = L.y - L.r;
      minAbst = Math.min(minAbst, ober - cam.horizont);
      ok(ober >= cam.horizont + V.planet.sicherungPx - 1e-6, 'R ' + R + ' Peilung ' + gr + ' Abstand ' + d + ': Oberkante ' + ober.toFixed(1) + ' >= Horizont+6');
      const saumOber = L.y - L.r * (1 + TK.KUGEL.saum.breite);   // KulisseKugel malt den Atmosphaerensaum bis 1,18 R: auch er bleibt unter dem Horizont (N1 B3)
      ok(saumOber >= cam.horizont + V.planet.sicherungPx - 1e-6, '  Saum-Oberkante ' + saumOber.toFixed(1) + ' >= Horizont+6');
      if (letzt) {
        ok(L.r > letzt.r, '  waechst beim Anflug (' + letzt.r.toFixed(1) + ' -> ' + L.r.toFixed(1) + ')');
        ok(L.y >= letzt.y - 1e-6, '  Mittelpunkt rutscht nach unten (' + letzt.y.toFixed(1) + ' -> ' + L.y.toFixed(1) + ')');
      }
      letzt = L;
    }
  }
}
ok(zeilen > 20, zeilen + ' Lagen geprueft, kleinster Abstand Oberkante - Horizont ' + minAbst.toFixed(1));
// Geometrisch liegt die Kugel immer darunter (Sicherung = Netz): Mutation mit grosser Sicherung zeigt, dass die Klemmung greift und nach unten schiebt
ok(!Vis.planetLage(0, 6000, 2500).geklemmt, 'regulaer klemmt nichts (Kugel liegt von selbst unter dem Horizont)');
const sp = V.planet.sicherungPx; V.planet.sicherungPx = 80;
const gm = Vis.planetLage(0, 6000, 2500); V.planet.sicherungPx = sp;
ok(gm.geklemmt && gm.y - gm.r >= cam.horizont + 80 - 1e-6, 'Mutation: Sicherung 80 klemmt und schiebt die Kugel nach unten');
// Kugel-Zwischenspeicher: nie ein Bild groesser als kugelMaxPx (Speicherobergrenze), groessere Radien werden skaliert (N1 B6)
{
  const max = V.planet.kugelMaxPx;
  ok(max > 0 && max <= 320, 'kugelMaxPx ' + max);
  let hoechst = 0;
  for (let r = 2; r < 1500; r += 3) hoechst = Math.max(hoechst, Vis.stufeFuer(r));
  ok(hoechst <= max && hoechst > max * 0.8, 'Cache-Stufe nie ueber ' + max + ' (hoechste ' + hoechst + ')');
  ok(Vis.stufeFuer(900) === Vis.stufeFuer(400), 'oberhalb der Grenze kein Neuaufbau (Stufe ' + Vis.stufeFuer(900) + ')');
}
ok(Vis.planetLage(0, -60, 150).ok === false, 'Planet unter/hinter dem Schiff (Tiefe < 80): nicht gezeichnet');

section('(4) Peilung (Weltachsen)');
for (const kursGrad of [0, 90, 217, 300]) {   // Kompasskurs, Nord = 0, Ost = 90; Weltwinkel 0 = +x
  const ang = rad(kursGrad - 90), s = { x: 1000, y: 1000, angle: ang };
  const punkt = (delta, d) => { const a = ang + rad(delta); return Vis.projiziereWelt(s, s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, 0); };
  ok(Math.abs(punkt(0, 600).x - W / 2) < 1e-6, 'Kurs ' + kursGrad + ': Punkt in Kurs auf x = ' + W / 2);
  ok(punkt(15, 600).x > W / 2 && punkt(-15, 600).x < W / 2, 'Kurs ' + kursGrad + ': +15 Grad (Steuerbord, im Uhrzeigersinn) rechts, -15 links');
  ok(Math.abs((punkt(20, 600).x - W / 2) + (punkt(-20, 600).x - W / 2)) < 1e-6, 'Kurs ' + kursGrad + ': symmetrisch');
  ok(!punkt(180, 600).ok, 'Kurs ' + kursGrad + ': hinter dem Schiff nicht ok');
}
const nord = { x: 0, y: 0, angle: -Math.PI / 2 };
ok(Vis.projiziereWelt(nord, 300, -500, 0).x > W / 2 && Math.abs(Vis.projiziereWelt(nord, 0, -500, 0).x - W / 2) < 1e-9 && Vis.projiziereWelt(nord, -300, -500, 0).x < W / 2, 'Kurs Nord: Nordost rechts, Norden mittig, Nordwest links');
{
  const s = { x: 100, y: 200, angle: rad(37) }, q = { x: 700, y: 650 };
  const peil = Math.atan2(q.y - s.y, q.x - s.x) - s.angle, p = Vis.projiziereWelt(s, q.x, q.y, 0);
  ok(Math.abs(Math.atan2(p.r, p.f) - peil) < 1e-9, 'relative Peilung = atan2(dy, dx) - Kurs (wie Frontsicht und Karte)');
}

section('(5) Robustheit und Nebelregel');
const leer = { time: 1, ship: { x: 0, y: 0, angle: 0 }, state: { ship: { x: 0, y: 0, angle: 0, scene: 'gibt-es-nicht' }, space: {} } };
let wirft = false;
try { ok(Vis.plan(leer) !== null && Vis.plan(leer).planeten.length === 0, 'unbekannte Szene: leerer Plan'); Vis.plan({}); Vis.plan(null); Vis.plan({ state: { ship: {} } }); } catch (e) { wirft = e; }
ok(!wirft, 'plan wirft nicht bei fehlender Szene, Schiff oder Feldern' + (wirft ? ' ' + wirft.message : ''));
const prot = [];
const ctx = new Proxy({}, { get: (t, k) => (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 0 }) : (...a) => { prot.push(k); }), set: () => true });
try { Vis.zeichne(ctx, leer, { x: 0, y: 0, w: 512, h: 288 }); Vis.zeichne(ctx, {}, {}); Vis.zeichne(ctx, null, null); wirft = false; } catch (e) { wirft = e; }
ok(!wirft, 'zeichne wirft nicht ohne Szene / ohne Schiff' + (wirft ? ' ' + wirft.message : ''));
ok(prot.filter((k) => k === 'save').length === prot.filter((k) => k === 'restore').length, 'save/restore ausgeglichen');
const loc = Locs.get('frostgrat');
if (loc && loc.scene && (loc.scene.planeten || []).length) {
  const a = loc.scene.arrive || { x: 600, y: 1100 };
  for (const kurs of [0, 90, 180, 270]) {
    const v = { time: 1, ship: { x: a.x, y: a.y, angle: rad(kurs) }, state: { ship: { x: a.x, y: a.y, angle: rad(kurs), scene: 'frostgrat', jump: {} }, space: {} } };
    const P = Vis.plan(v);
    ok(P.planeten.every((p) => p.y - p.r >= cam.horizont + 6 - 1e-6), 'Frostgrat Kurs ' + kurs + ': ' + P.planeten.length + ' Planeten, alle unter dem Horizont');
  }
}
const nebel = { id: 'nebeltest', kind: 'nebula', fog: true, scene: { planeten: [{ x: 1800, y: 1000, r: 150, art: 'fels' }, { x: 1250, y: 1000, r: 150, art: 'eis' }], stern: [{ x: 2900, y: 1000, klasse: 'gelb' }] } };
globalThis.Shared_Locations = { get: (id) => (id === 'nebeltest' ? nebel : Locs.get(id)) };
{
  const mk = (id) => ({ time: 1, ship: { x: 1000, y: 1000, angle: 0 }, state: { ship: { x: 1000, y: 1000, angle: 0, scene: id, jump: {} }, space: {} } });
  const mit = Vis.plan(mk('nebeltest'));
  ok(mit.fog && mit.planeten.length === 1 && mit.planeten[0].wx === 1250 && mit.sterne.length === 0, 'Nebel: nur der Planet in halber Sicht (Abstand - r <= 350), Stern weg');
  nebel.fog = false; nebel.kind = 'normal';
  const ohne = Vis.plan(mk('nebeltest'));
  ok(!ohne.fog && ohne.planeten.length === 2 && ohne.sterne.length === 1, 'ohne Nebel: unbegrenzte Sicht');
  ok(KH.sichtVon(mk('nebeltest').state).weite === Infinity, 'gleiche Regel wie KulisseHimmel.sichtVon');
}
console.log('\n' + (fails ? fails + ' von ' + n + ' FEHLER' : 'alle ' + n + ' Pruefungen gruen'));
process.exit(fails ? 1 : 0);
