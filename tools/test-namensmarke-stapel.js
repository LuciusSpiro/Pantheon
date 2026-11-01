'use strict';
// CHA-01 F: Stapeln der Namensmarken (public/js/namensmarke-tokens.js, Namensmarke.ordne). Regeln:
//  - eigene Marke zuerst in Zeile 0; übrige nach Bildschirm-y absteigend, dann x; erste Zeile 0…max−1 ohne Schnitt mit gesetzten Marken und Gegnernamen
//  - dy = −zeile·zeile_px, Stiel = 3 + zeile·zeile_px (endet immer am Kopf); keine Zeile frei → nur Form
//  - Flackerschutz: alte Zeile bleibt, solange frei; tiefere Zeile erst nach haltenMs
// Aufruf: node tools/test-namensmarke-stapel.js     (Umgebung NM_DATEI: andere Fassung der Tokens, für tools/mutation-namensmarke-stapel.js)
const fs = require('fs');
const path = require('path');
const NM = require(process.env.NM_DATEI || '../public/js/namensmarke-tokens.js');
const S = NM.TOKENS.MASS.stapel, M = NM.TOKENS.MASS;
let fehler = 0;
const ok = (b, msg) => { if (!b) { fehler++; console.log('  FEHLER ' + msg); } };
const tw = (s) => s.length * 6 - 1;   // Pixelschrift: 5 px + 1 Lücke

// Tokens
ok(S && S.luecke === 2 && S.zeile === 12 && S.max === 3 && S.haltenMs === 300, 'MASS.stapel: ' + JSON.stringify(S));
ok(S.zeile >= M.h + S.luecke, 'Zeilenabstand kleiner als Markenhöhe + Lücke: Zeilen würden sich berühren');

// Szene: Figuren, Kopfmitte x, Oberkante der Marke in Zeile 0 = y
function eintrag(id, name, x, y, eigen) {
  const m = NM.marke(name, !!eigen, tw);
  return { id, eigen: !!eigen, x: x + m.x, y, w: m.w, h: m.h, m, cx: x };
}
const rechteck = (e, z) => ({ x: e.x, y: e.y + z.dy, w: e.w, h: e.h });
const schnitt = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
function pruefeOhneSchnitt(liste, erg, hind, was) {
  const sicht = liste.filter((e) => !erg[e.id].nurForm || e.eigen);
  for (let i = 0; i < sicht.length; i++) {
    for (let j = i + 1; j < sicht.length; j++) ok(!schnitt(rechteck(sicht[i], erg[sicht[i].id]), rechteck(sicht[j], erg[sicht[j].id])), `${was}: ${sicht[i].id} schneidet ${sicht[j].id}`);
    for (const h of hind || []) ok(!schnitt(rechteck(sicht[i], erg[sicht[i].id]), h), `${was}: ${sicht[i].id} schneidet Gegnername`);
  }
}

// 1. Vier Marken im Abstand 24 px (Reihe), eigene dabei
{
  const liste = [eintrag('a', 'Aurelia', 100, 80), eintrag('c', 'Cato', 124, 80), eintrag('b', 'Brunhilde', 148, 80), eintrag('ich', 'Hrolf', 172, 80, true)];
  const erg = NM.ordne(liste, [], null, 0);
  pruefeOhneSchnitt(liste, erg, [], 'Reihe 24 px');
  ok(erg.ich.dy === 0 && erg.ich.nurForm, 'eigene Marke: Zeile 0, nur Form');
  ok(!['a', 'c', 'b'].some((i) => erg[i].nurForm), 'Reihe 24 px: eine Marke wurde zu „nur Form“, obwohl drei Zeilen reichen');
  for (const e of liste) {
    const z = erg[e.id];
    ok(z.dy === -z.zeile * S.zeile, `${e.id}: dy ${z.dy} ≠ −Zeile·${S.zeile}`);
    ok(z.stielH === M.stiel.h + z.zeile * S.zeile, `${e.id}: Stiel ${z.stielH} ≠ 3 + Zeile·${S.zeile}`);
    ok(e.y + z.dy + e.m.h + z.stielH === e.y + e.m.h + M.stiel.h, `${e.id}: Stiel endet nicht am Kopf`);
    ok(e.m.x <= 0 && e.m.x + e.m.w >= 0 && e.m.stiel.x === 0, `${e.id}: Stiel liegt nicht unter der Marke / nicht bei x der Figur`);
  }
  console.log('  Reihe 24 px: ' + liste.map((e) => e.id + '=' + (erg[e.id].nurForm ? 'Form' : 'Zeile ' + erg[e.id].zeile)).join(', '));
  // Reihenfolge: weiter unten auf dem Bildschirm zuerst (tiefere Zeile), bei gleichem y links zuerst
  const e2 = NM.ordne([eintrag('hinten', 'Aurelia', 100, 74), eintrag('vorn', 'Cato', 100, 80)], [], null, 0);
  ok(e2.vorn.zeile === 0 && e2.hinten.zeile === 1, 'Bildschirm-y absteigend: die weiter vorn stehende Figur nimmt Zeile 0 (vorn ' + e2.vorn.zeile + ', hinten ' + e2.hinten.zeile + ')');
  const e3 = NM.ordne([eintrag('rechts', 'Aurelia', 110, 80), eintrag('links', 'Cato', 100, 80)], [], null, 0);
  ok(e3.links.zeile === 0 && e3.rechts.zeile === 1, 'gleiches y: links zuerst');
  // Eigene Marke zuerst, auch wenn der Mitspieler weiter vorn steht
  const e5 = NM.ordne([eintrag('x', 'Aurelia', 100, 90), eintrag('ich', 'Hrolf', 100, 70, true)], [], null, 0);
  ok(e5.ich.dy === 0 && e5.ich.zeile === 0, 'eigene Marke in Zeile 0');
  const e6 = NM.ordne([eintrag('x', 'Aurelia', 100, 70), eintrag('ich', 'Hrolf', 100, 70, true)], [], null, 0);
  ok(e6.x.zeile === 1, 'Mitspieler über der eigenen Marke weicht in Zeile 1 aus (Zeile ' + e6.x.zeile + ')');
}

// 2. Gedränge: mehr als max Zeilen -> nur Form
{
  const liste = ['A', 'B', 'C', 'D', 'E'].map((n) => eintrag(n, 'Spieler' + n, 100, 80));
  const erg = NM.ordne(liste, [], null, 0);
  const zeilen = liste.filter((e) => !erg[e.id].nurForm).map((e) => erg[e.id].zeile).sort();
  ok(JSON.stringify(zeilen) === '[0,1,2]', 'Gedränge: genau Zeilen 0,1,2 belegt, Rest nur Form: ' + JSON.stringify(zeilen));
  ok(liste.filter((e) => erg[e.id].nurForm).length === 2, 'Gedränge: zwei Marken nur Form');
  for (const e of liste) if (erg[e.id].nurForm) ok(erg[e.id].dy === 0 && erg[e.id].stielH === M.stiel.h, 'nurForm sitzt in Zeile 0 mit kurzem Stiel');
  const mitEigener = [eintrag('ich', 'Hrolf', 100, 80, true)].concat(['A', 'B', 'C'].map((n) => eintrag(n, 'Spieler' + n, 100, 80)));
  const e2 = NM.ordne(mitEigener, [], null, 0);
  ok(e2.ich.dy === 0 && !e2.A.nurForm && !e2.B.nurForm && e2.C.nurForm, 'Eigene Marke belegt Zeile 0; von drei Mitspielern am selben Platz bleibt der letzte nur Form');
}

// 3. Gegnernamen sind feste Hindernisse
{
  const a = eintrag('a', 'Aurelia', 100, 80);
  const hind = [{ x: a.x + 5, y: 80, w: 40, h: 10 }];   // Gegnername auf Zeile 0
  const erg = NM.ordne([a], hind, null, 0);
  ok(erg.a.zeile === 1, 'Gegnername in Zeile 0: Marke weicht in Zeile 1 aus (Zeile ' + erg.a.zeile + ')');
  pruefeOhneSchnitt([a], erg, hind, 'Hindernis');
  const dicht = [{ x: a.x, y: 80 - 12, w: 40, h: 10 }, hind[0], { x: a.x, y: 80 - 24, w: 40, h: 10 }];
  ok(NM.ordne([a], dicht, null, 0).a.nurForm, 'alle drei Zeilen durch Gegnernamen belegt: nur Form');
  // Abstand: Hindernis 1 px unter der Marke zählt als Schnitt (Lücke 2), mit genau der Lücke nicht
  ok(NM.ordne([a], [{ x: a.x, y: 80 + 10 + 1, w: 40, h: 10 }], null, 0).a.zeile === 1, 'Hindernis mit 1 px Abstand verdrängt (Lücke ' + S.luecke + ')');
  ok(NM.ordne([a], [{ x: a.x, y: 80 + 10 + S.luecke, w: 40, h: 10 }], null, 0).a.zeile === 0, 'Hindernis mit genau der Lücke Abstand verdrängt nicht');
  // seitlich: 1 px Abstand links bzw. rechts verdrängt, genau die Lücke nicht
  ok(NM.ordne([a], [{ x: a.x - 40 - 1, y: 80, w: 40, h: 10 }], null, 0).a.zeile === 1, 'Hindernis links mit 1 px Abstand verdrängt');
  ok(NM.ordne([a], [{ x: a.x + a.w + 1, y: 80, w: 40, h: 10 }], null, 0).a.zeile === 1, 'Hindernis rechts mit 1 px Abstand verdrängt');
  ok(NM.ordne([a], [{ x: a.x - 40 - S.luecke, y: 80, w: 40, h: 10 }, { x: a.x + a.w + S.luecke, y: 80, w: 40, h: 10 }], null, 0).a.zeile === 0, 'Hindernisse mit genau der Lücke Abstand seitlich verdrängen nicht');
}

// 4. Flackerschutz
{
  const a = eintrag('a', 'Aurelia', 100, 80);
  const blockiert = [{ x: a.x, y: 80, w: 40, h: 10 }];
  let st = NM.ordne([a], blockiert, null, 0);
  ok(st.a.zeile === 1, 'Start: Zeile 1');
  st = NM.ordne([a], [], st, 100);
  ok(st.a.zeile === 1, 'Zeile 0 frei: Zeile 1 bleibt (Flackerschutz)');
  st = NM.ordne([a], [], st, 350);
  ok(st.a.zeile === 1, '250 ms frei: Zeile 1 bleibt noch');
  st = NM.ordne([a], [], st, 400);
  ok(st.a.zeile === 0, '300 ms frei: wechselt in Zeile 0 (Zeile ' + st.a.zeile + ')');
  // Zwischendurch wieder blockiert: Frist beginnt neu
  let s2 = NM.ordne([a], blockiert, null, 0);
  s2 = NM.ordne([a], [], s2, 100); s2 = NM.ordne([a], blockiert, s2, 200); s2 = NM.ordne([a], [], s2, 250);
  s2 = NM.ordne([a], [], s2, 450);
  ok(s2.a.zeile === 1, 'Zeile 0 war zwischendurch wieder belegt: Frist beginnt neu (200 ms nach 250)');
  s2 = NM.ordne([a], [], s2, 560);
  ok(s2.a.zeile === 0, 'Frist neu abgelaufen');
  // Wird die gehaltene Zeile selbst belegt, wechselt die Marke sofort
  let s3 = NM.ordne([a], blockiert, null, 0);
  s3 = NM.ordne([a], [], s3, 100);
  s3 = NM.ordne([a], [{ x: a.x, y: 80 - 12, w: 40, h: 10 }], s3, 150);
  ok(s3.a.zeile === 0, 'gehaltene Zeile 1 belegt, Zeile 0 frei: sofort Zeile 0 (Zeile ' + s3.a.zeile + ')');
  // Aus „nur Form“ zurück in eine Zeile erst nach der Frist
  const gedraengt = ['A', 'B', 'C', 'D'].map((n) => eintrag(n, 'Spieler' + n, 100, 80));
  const g = NM.ordne(gedraengt, [], null, 0);
  ok(g.D.nurForm, 'vierte Marke nur Form');
  const weg = gedraengt.map((e) => (e.id === 'D' ? eintrag('D', 'SpielerD', 300, 80) : e));
  const g2 = NM.ordne(weg, [], g, 100);
  ok(g2.D.nurForm, 'D steht frei, bleibt aber für die Frist nur Form');
  const g3 = NM.ordne(weg, [], g2, 400);
  ok(!g3.D.nurForm && g3.D.zeile === 0, 'nach der Frist hat D Zeile 0');
  // Rein: Eingaben unverändert
  const kopie = JSON.stringify([a, blockiert]);
  NM.ordne([a], blockiert, null, 0);
  ok(JSON.stringify([a, blockiert]) === kopie, 'ordne ändert die Eingaben');
}

// 5. Zeichnen: ein Layout je Frame, erst alle Stiele, dann alle Marken (Quelltext render.js)
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'render.js'), 'utf8');
  const fn = src.slice(src.indexOf('function markenZeichnen'), src.indexOf('function shape('));
  ok((src.match(/\.ordne\(/g) || []).length === 1, 'render.js: genau ein ordne-Aufruf (ein Layout je Frame)');
  const iStiel = fn.indexOf('stiel'), iMarke = fn.indexOf('backdrop(');
  ok(iStiel > 0 && iMarke > iStiel, 'markenZeichnen: Stiele werden vor den Marken gezeichnet');
  ok((src.match(/(?<!function )markenZeichnen\(ctx\)/g) || []).length === 2 && (src.match(/(?<!function )markeMerken\(/g) || []).length === 2, 'render.js: beide Pfade (2D, Voxel-Overlay) sammeln und zeichnen gestapelt');
  ok((src.match(/hindernisMerken\(/g) || []).length >= 5, 'render.js: Gegnernamen melden sich als Hindernisse (2D und Overlay)');
  ok(!/\bnamensmarke\(ctx/.test(src), 'render.js: alte Einzel-Marke wird noch aufgerufen');
}
console.log(fehler ? `${fehler} Fehler.` : 'Namensmarken stapeln ok.');
process.exit(fehler ? 1 : 0);
