// KUL-02 Designer: Tokens des Hauptschirms (public/js/hauptschirm-tokens.js) prüfen.
//  1. Struktur und Typen: alle Gruppen da, Zahlen sind Zahlen, Skalen ganzzahlig, Alpha in [0, 1].
//  2. Herkunft der Farben: Spiegel = render.js PAL; jede Farbe außerhalb von PAL/EIGEN/STERN/PLANET verweist auf PAL oder EIGEN;
//     keine rgba-Strings; Hex-Literale in der Datei nur im Token-Block.
//  3. Daten statt Erfindung: Planetentypen und Sternklassen = shared/gen-sektor.js.
//  4. Wertebereiche: Parallaxe, Radiusfaktor, Abdunklung wie Richtung A; Beschriftung ≥ Skala 2; Tafeln im Schirm, ohne Überlappung,
//     Mitte oben frei; Elemente in ihrer Tafel.
//  5. Kontrast nach WCAG 2.1: dokumentierte Werte stimmen (±0,05); Text ≥ 4,5:1, Rot (nur Skala 2) ≥ 3:1, auch auf dem Tafelgrund
//     über hellstem Bild (94 % über Weiß). KUL-03: dieselbe Prüfung für die Paare des Visiers (KONTRAST.visier).
//  6. KUL-03 Visier: Kamera wie Mockup (Horizont, Ringabstände nachgerechnet), Planeten unter der Ebene, Leiste 70 % der Mockup-Höhe mit
//     Platz für Skala 3 (Hochfeld) und Skala 2, Lagescheibe im Schirm, oben links frei, Skalen nach Auftrag, Skins rom/germanen.
// Aufruf: node tools/test-hauptschirm-tokens.js   (Exit 1 bei Fehlern)
'use strict';
const fs = require('fs');
const path = require('path');
const DATEI = path.join(__dirname, '..', 'public', 'js', 'hauptschirm-tokens.js');
const HT = require(DATEI);

let fehler = 0;
const ok = (b, msg) => { if (!b) { fehler++; console.log('  FEHLER ' + msg); } };
const T = HT.TOKENS;
const HEX = /^#[0-9A-F]{6}$/;
const istZahl = (v) => typeof v === 'number' && Number.isFinite(v);
const istAlpha = (v) => istZahl(v) && v >= 0 && v <= 1;

// 1. Struktur
const GRUPPEN = ['SCHIRM', 'PAL', 'EIGEN', 'FARBE', 'TEXT', 'HIMMEL', 'STERNFELD', 'STERN', 'SONNE', 'PLANET', 'KUGEL', 'BOJE', 'GASRIESE', 'TAFEL', 'VISIER', 'KONTRAST'];
ok(T && typeof T === 'object', 'TOKENS fehlt');
for (const g of GRUPPEN) ok(T[g] && typeof T[g] === 'object', `Gruppe ${g} fehlt`);
ok(Object.keys(HT).join() === 'TOKENS', 'Modul exportiert mehr als TOKENS (nur Daten, kein Zeichencode)');
// keine Funktionen irgendwo in den Tokens; Alpha-Felder in [0, 1]; Skalen ganzzahlig ≥ 1
(function lauf(o, p) {
  if (typeof o === 'function') { ok(false, `${p} ist eine Funktion (nur Daten erlaubt)`); return; }
  if (Array.isArray(o)) { o.forEach((v, i) => lauf(v, `${p}[${i}]`)); return; }
  if (o && typeof o === 'object') { for (const [k, v] of Object.entries(o)) {
    if (/alpha/i.test(k) && v != null) ok(istAlpha(v), `${p}.${k} = ${v} ist kein Alpha in [0, 1]`);
    if (/^skala/i.test(k)) ok(Number.isInteger(v) && v >= 1, `${p}.${k} = ${v} ist keine ganzzahlige Skala ≥ 1`);
    lauf(v, `${p}.${k}`);
  } }
})(T, 'TOKENS');
ok(T.SCHIRM.w === 512 && T.SCHIRM.h === 288, 'SCHIRM ist nicht 512 × 288');
const sitz = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'sitz.js'), 'utf8').match(/const SW = (\d+), SH = (\d+)/);
ok(sitz && +sitz[1] === T.SCHIRM.w && +sitz[2] === T.SCHIRM.h, `SCHIRM ≠ sitz.js SW/SH (${sitz && sitz.slice(1).join('×')})`);

// 2. Herkunft der Farben
const render = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'render.js'), 'utf8');
const palBlock = (render.match(/const PAL = \{([\s\S]*?)\n\s*\};/) || [])[1] || '';
ok(palBlock, 'PAL in render.js nicht gefunden');
const palEcht = {};
for (const m of palBlock.matchAll(/(\w+): '(#[0-9A-Fa-f]{6})'/g)) palEcht[m[1]] = m[2].toUpperCase();
for (const [k, v] of Object.entries(T.PAL)) ok(palEcht[k] === v, `PAL.${k}: render.js ${palEcht[k]} ≠ Spiegel ${v}`);
const palWerte = new Set(Object.values(palEcht));
for (const [k, v] of Object.entries(T.EIGEN)) ok(HEX.test(v), `EIGEN.${k} = ${v} ist kein #RRGGBB`);
for (const [k, s] of Object.entries(T.STERN)) for (const f of ['kern', 'glut']) ok(HEX.test(s[f]), `STERN.${k}.${f} = ${s[f]}`);
for (const [k, p] of Object.entries(T.PLANET)) {
  ok(Array.isArray(p.rampe) && p.rampe.length >= 4 && p.rampe.every((c) => HEX.test(c)), `PLANET.${k}.rampe`);
  if (p.land) ok(p.land.length >= 3 && p.land.every((c) => HEX.test(c)), `PLANET.${k}.land`);
  ok(HEX.test(p.atm) && istAlpha(p.atmAlpha), `PLANET.${k}.atm/atmAlpha`);
}
const erlaubt = new Set([...palWerte, ...Object.values(T.EIGEN)]);
const benutzt = new Set();
let farbStellen = 0;
(function lauf(o, p) {
  if (typeof o === 'string') {
    ok(!/rgba?\(|hsla?\(/i.test(o), `${p} = ${o}: rgba/hsl-String (Deckung als eigene Zahl angeben)`);
    if (/^#/.test(o)) { farbStellen++; ok(HEX.test(o), `${p} = ${o} ist kein #RRGGBB`); ok(erlaubt.has(o), `${p} = ${o} stammt weder aus PAL noch aus EIGEN`); benutzt.add(o); }
    return;
  }
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) lauf(v, `${p}.${k}`);
})(Object.fromEntries(Object.entries(T).filter(([g]) => !['PAL', 'EIGEN', 'STERN', 'PLANET'].includes(g))), 'TOKENS');
ok(farbStellen > 20, `nur ${farbStellen} Farbstellen gefunden (Prüfung greift nicht)`);
for (const [k, v] of Object.entries(T.EIGEN)) ok(benutzt.has(v), `EIGEN.${k} wird nirgends verwendet`);
// Funktionsfarben = Brückenpulte (Bernstein Kurs/Schub, Messing Sprungziel, Eisblau Sensoren, Mint Schild, Rot Gefahr)
const F = T.FARBE;
ok(F.kurs === palEcht.amber && F.sprung === palEcht.brass && F.sensor === palEcht.ice && F.schild === palEcht.mint && F.gefahr === palEcht.red, 'Funktionsfarben weichen von PAL ab');
ok(T.TAFEL.grund.farbe === '#0B0E1A' && T.TAFEL.grund.alpha === 0.94, 'Tafelgrund nicht #0B0E1A bei 94 %');
// Hex-Literale nur im Token-Block (wie tools/check-terminal-farben.js)
{
  let drin = false, n = 0;
  fs.readFileSync(DATEI, 'utf8').split('\n').forEach((z, i) => {
    if (/\/\/\s*<tokens>/.test(z)) { drin = true; return; }
    if (/\/\/\s*<\/tokens>/.test(z)) { drin = false; return; }
    const code = z.replace(/\/\/.*$/, '');
    if (!drin && /['"`]#[0-9a-fA-F]{3,8}['"`]|\b(?:rgba?|hsla?)\(\s*\d/.test(code)) { n++; console.log(`  freie Farbe außerhalb des Token-Blocks: Zeile ${i + 1}`); }
  });
  ok(n === 0, `${n} freie Farbwerte außerhalb des Token-Blocks`);
}

// 3. Daten statt Erfindung
const gen = fs.readFileSync(path.join(__dirname, '..', 'shared', 'gen-sektor.js'), 'utf8');
const liste = (name) => { const m = gen.match(new RegExp('const ' + name + " = \\[([^\\]]*)\\]")); return m ? m[1].match(/'(\w+)'/g).map((s) => s.slice(1, -1)) : null; };
const sterne = liste('KIND_STERN'), planeten = liste('KIND_PLANET');
ok(sterne && sterne.slice().sort().join() === Object.keys(T.STERN).sort().join(), `Sternklassen ≠ gen-sektor.js (${sterne})`);
// KAC-01 D: dazu die Planetenarten des Sektortypen-Katalogs (wiesenwald, vulkan, ...), die scene.planeten[].art der Typ-Hexe tragen
const katalogArten = Object.keys(require('../shared/sektortypen.js').katalog().planetenarten);
ok(planeten && [...new Set(planeten.concat(katalogArten, 'gasriese'))].sort().join() === Object.keys(T.PLANET).sort().join(), `Planetentypen ≠ gen-sektor.js + Katalog-Planetenarten + gasriese (${planeten}; ${katalogArten})`);
ok(T.PLANET.ozean.land, 'Ozean braucht Landrampe');

// 4. Wertebereiche
const H = T.HIMMEL;
ok(H.parallaxePlanet === 0.45 && H.parallaxeGasriesePlan === 1, 'Parallaxe nicht 0,45 / 1 (Richtung A)');
ok(H.radiusFaktor === 0.9 && H.radiusFaktorGasriesePlan === 1, 'Radiusfaktor nicht 0,9 / 1');
ok(H.abdunklung.alpha === 0.45, 'Abdunklung nicht 45 % (Designer-Review KUL-02, 2026-11-03)');
ok(H.parallaxePlanet > 0 && H.parallaxePlanet < 1, 'Planeten müssen langsamer ziehen als die Ebene');
const SF = T.STERNFELD;
ok(Number.isInteger(SF.anzahl) && SF.anzahl > 0 && SF.anzahl <= 1000, 'Sternfeld-Anzahl');
ok(SF.klassen.every((k, i, a) => istAlpha(k.ab) && (i === 0 || a[i - 1].ab > k.ab)) && SF.klassen[SF.klassen.length - 1].ab === 0, 'Sternfeld-Klassen absteigend bis 0');
const S = T.SONNE;
ok(S.radius > 0 && S.randAbstand > S.radius && S.gluehen.every(([r, a]) => r > 1 && istAlpha(a)), 'Sonne: Maße/Glühen');
ok(S.sperreUnten && S.sperreUnten.halbB === 72, 'Sonne: sperreUnten.halbB 72 (Randlicht nie neben der Lerche)');
const K = T.KUGEL;
ok(Number.isInteger(K.block.min) && K.block.min >= 1 && K.block.max >= K.block.min && K.block.pxJeBlock > 0, 'Blockraster min/max');
ok(K.dither.bayer4.length === 16 && K.dither.bayer4.slice().sort((a, b) => a - b).every((v, i) => v === i), 'Bayer-Matrix 4 × 4 ist keine Permutation von 0..15');
ok(istAlpha(K.block.kantenFaktor) && istAlpha(K.nacht.faktorRG) && istAlpha(K.nacht.faktorB), 'Kugel-Faktoren in [0, 1]');
const B = T.BOJE;
ok(B.sprung.feld.welt === 140, 'Sprungfeld nicht 140 (Welt)');
ok(B.sprung.farbe === palEcht.brass && B.nav.farbe === palEcht.ice, 'Bojen: Sprung Messing, Nav Eisblau');
const G = T.GASRIESE;
ok(G.linie.length === 4 && G.linie.every((l) => istAlpha(l.alpha) && l.strich.length === 2), 'Gasriese: vier Linienstile (zonen.js: drei Ringe = vier Grenzen)');
ok(G.dunst.bisRadius === 1.9, 'Dunst bis 1,9 R (Hochatmosphäre)');
// Textskalen
const TX = T.TEXT;
ok(TX.skalaBeschriftung >= 2 && TX.skalaWert >= 2 && TX.skalaGross === 3 && TX.skalaKopf === 1, 'Textskalen (Beschriftung ≥ 2, Wert ≥ 2, Groß 3, Kopf 1)');
ok(B.sprung.label.skala >= 2 && G.label.skala >= 2 && G.label.schritt > 0 && G.label.schritt <= 0.2 && G.label.rand >= 0, 'Bojen-/Schicht-Labels unter Skala 2, Namenssuche in Schritten ≤ 0,2 rad');
ok(B.nav.saum && istAlpha(B.nav.saum.alpha) && B.nav.saum.plus > 0, 'Navboje: dunkler Saum (Kontrast auf hellem Planeten)');
// Tafeln
const TF = T.TAFEL, W = T.SCHIRM.w;
const lage = (t) => ({ x: t.x >= 0 ? t.x : W + t.x - t.w, y: t.y, w: t.w, h: t.h });
const L = lage(TF.links), R = lage(TF.rechts);
for (const [n, r] of [['links', L], ['rechts', R]]) ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= T.SCHIRM.h / 3, `Tafel ${n} außerhalb oder zu hoch ${JSON.stringify(r)}`);
ok(L.x + L.w <= R.x, 'Tafeln überlappen');
const frei = R.x - (L.x + L.w);
ok(frei >= TF.mitteFreiMin, `Mitte oben nur ${frei} px frei (< ${TF.mitteFreiMin})`);
ok(TF.links.ecke === 'tl' && TF.rechts.ecke === 'tr' && TF.links.farbe === palEcht.amber && TF.rechts.farbe === palEcht.brass, 'links Bernstein (Kurs/Schub), rechts Messing (Sprungziel)');
const zH = (sk) => 7 * sk;   // Pixelschrift art.js: 7 Zeilen
const drin = (t, x, y, w, h, n) => ok(x >= 0 && y >= 0 && x + w <= t.w && y + h <= t.h, `${n} ragt aus der Tafel (${x},${y},${w}×${h} in ${t.w}×${t.h})`);
const tl = TF.links, tr = TF.rechts;
ok(tl.kurs.skala === 3 && tl.tempo.skala === 3 && tl.stufe.skala === 2 && tr.ziel.skala === 2 && tr.boje.skala === 2, 'Skalen der Tafelwerte (Kurs/Tempo 3, Stufe/Ziel/Boje 2)');
drin(tl, tl.kurs.wertX, tl.kurs.wertY, 63, zH(3), 'Kurs „360°“');
drin(tl, tl.tempo.wertX, tl.tempo.wertY, 51, zH(3), 'Tempo „164“');
drin(tl, tl.stufe.x, tl.stufe.y, 58, zH(2), 'Stufe „STOPP“');
drin(tl, tl.band.x, tl.band.y - tl.band.marke, tl.band.w, tl.band.marke + tl.band.lang + 4, 'Kursband');
ok(tl.kurs.wertX + 63 <= tl.tempo.wertX - 4 && tl.band.x + tl.band.w <= tl.tempo.wertX, 'Kurs-Spalte stößt an die Tempo-Spalte');
const leiterX = tl.w + tl.leiter.x;
ok(tl.stufe.x + 58 <= leiterX - 2 && tl.tempo.wertX + 51 <= leiterX - 2, 'Stufe/Tempo stoßen an die Stufenleiter');
ok(tl.h - tl.leiter.untenAbstand - 5 * tl.leiter.schritt >= TF.streifen, 'Stufenleiter passt nicht in die Tafel');
drin(tr, tr.ziel.wertX, tr.ziel.wertY, tr.ziel.maxBreite, zH(2), 'Sprungziel');
const peilX = tr.w + tr.peil.x;
ok(tr.ziel.wertX + tr.ziel.maxBreite <= peilX - tr.peil.ringRadius - 2, 'Sprungziel-Name stößt an den Peilpfeil');
drin(tr, peilX - tr.peil.ringRadius, tr.peil.y - tr.peil.ringRadius, 2 * tr.peil.ringRadius, 2 * tr.peil.ringRadius, 'Peilring');
drin(tr, tr.boje.x, tr.boje.y, tr.w - 2 * tr.boje.x, zH(2), 'Boje + Entfernung');
ok(tr.boje.y >= tr.peil.y + tr.peil.ringRadius, 'Boje-Zeile überlappt den Peilring');
ok(tr.laden.balkenY >= tr.boje.y + zH(2) && tr.laden.balkenY + tr.laden.balkenH <= tr.h, 'Ladebalken überlappt oder ragt heraus');
ok(tl.kurs.wertY >= tl.kurs.kopfY + TF.kappe.hoehe + 2 && tr.ziel.wertY >= tr.ziel.kopfY + TF.kappe.hoehe + 2, 'Werte stoßen an die Kappe');

// 5. Kontrast
const lum = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
const kontrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const misch = (a, b, t) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * t + parseInt(b.slice(i, i + 2), 16) * (1 - t)).toString(16).padStart(2, '0')).join('').toUpperCase();
const fmt = (v) => v.toFixed(2).replace('.', ',');
const KO = T.KONTRAST, tafelHell = misch(TF.grund.farbe, '#FFFFFF', TF.grund.alpha);
ok(KO.grund === TF.grund.farbe, 'Kontrast-Grund ≠ Tafelgrund');
console.log(`Kontrast auf Tafelgrund ${KO.grund} (und 94 % über Weiß = ${tafelHell}):`);
for (const [k, doku] of Object.entries(KO.werte)) {
  const c = palEcht[k], v = kontrast(c, KO.grund), w = kontrast(c, tafelHell), min = KO.nurAbSkala2.includes(k) ? 3 : 4.5;
  console.log(`  ${k.padEnd(6)} ${c}  ${fmt(v).padStart(6)}:1  (Doku ${fmt(doku)})  über Weiß ${fmt(w)}:1  min ${fmt(min)}`);
  ok(Math.abs(v - doku) <= 0.05, `${k}: gemessen ${fmt(v)} ≠ Doku ${fmt(doku)}`);
  ok(v >= min && w >= min, `${k}: unter ${fmt(min)}:1`);
}
for (const [n, c, g] of [['Kappe ink auf Messing', F.ink, F.sprung], ['Kappe ink auf Bernstein', F.ink, F.kurs], ['Boje/Entfernung Creme', F.text, KO.grund], ['Bojenraute', T.EIGEN.bojeKern, F.grund], ['Schichtnamen', T.EIGEN.gasLinie, F.grund]]) {
  const v = kontrast(c, g); console.log(`  ${n.padEnd(24)} ${fmt(v).padStart(6)}:1`); ok(v >= 4.5, `${n} ${fmt(v)}:1 < 4,5`);
}
const KV = KO.visier;
ok(Array.isArray(KV) && KV.length >= 15, 'KONTRAST.visier fehlt oder ist zu kurz');
console.log('Kontrast Visier (gemessen; über Weiß = Fläche mit grundAlpha über Weiß):');
for (const p of KV || []) {
  const a = p.alpha == null ? 1 : p.alpha, mitAlpha = (g) => (a < 1 ? misch(p.farbe, g, a) : p.farbe);
  const v = kontrast(mitAlpha(p.grund), p.grund);
  let w = null;
  if (p.grundAlpha != null) { const g2 = misch(p.grund, '#FFFFFF', p.grundAlpha); w = kontrast(mitAlpha(g2), g2); }
  console.log(`  ${p.name.padEnd(32)} ${fmt(v).padStart(6)}:1  (Doku ${fmt(p.doku)})${w != null ? '  über Weiß ' + fmt(w) + ':1' : ''}  min ${fmt(p.min)}`);
  ok(Math.abs(v - p.doku) <= 0.05, `Visier ${p.name}: gemessen ${fmt(v)} ≠ Doku ${fmt(p.doku)}`);
  ok(v >= p.min && (w == null || w >= p.min), `Visier ${p.name}: unter ${fmt(p.min)}:1`);
  ok(p.min >= 3, `Visier ${p.name}: min unter 3`);
}

// 6. Visier (KUL-03, Mockup bplus-visier.html)
const V = T.VISIER, SH = T.SCHIRM.h;
const CAM = V.kamera, RAD = Math.PI / 180;
const FOK = (SH / 2) / Math.tan(CAM.blickwinkel * RAD / 2), cp = Math.cos(CAM.neigung * RAD), sp = Math.sin(CAM.neigung * RAD);
const proj = (f, r, u) => { const y = (u || 0) - CAM.auge, ff = f - CAM.vor, depth = ff * cp - y * sp, up = y * cp + ff * sp; return { x: W / 2 + r / depth * FOK, y: SH / 2 - up / depth * FOK, depth, k: FOK / depth }; };
const hz = SH / 2 - Math.tan(CAM.neigung * RAD) * FOK;
ok(CAM.auge === 90 && CAM.neigung === 16 && CAM.blickwinkel === 50 && CAM.vor === 35, 'Kamera nicht wie Mockup (Auge 90, Neigung 16°, Blickwinkel 50°, vor 35)');
ok(Math.abs(hz - CAM.horizontY) <= 1, `Horizont gerechnet ${hz.toFixed(2)} ≠ Token ${CAM.horizontY}`);
const yRing = (r) => proj(r, 0, 0).y;
// Ringe 400/700: mit der Mockup-Kamera 33 px auseinander (B: 15). Die Gestaltungsnotiz nennt 41 statt 20; das Verhältnis (gut doppelt) stimmt, die Zahl nicht
ok(yRing(700) - hz > 20 && yRing(400) - yRing(700) >= 30, `Ringe 400/700 nur ${(yRing(400) - yRing(700)).toFixed(1)} px auseinander (Mockup-Kamera 33)`);
ok(proj(250, 0, 0).y - hz >= 100, `Gegner auf 250 nur ${(proj(250, 0, 0).y - hz).toFixed(0)} px unter dem Horizont (Mockup ~115)`);
ok(Math.abs(Math.atan((W / 2) * cp / FOK) / RAD - V.lagescheibe.keil.halbGrad) <= 0.5, 'Keil der Lagescheibe ≠ halbes Blickfeld auf der Ebene (atan(W/2·cos(Neigung)/F))');
console.log(`Visier: Horizont ${hz.toFixed(2)}, Ringe 200/400/700 bei y ${[200, 400, 700].map((r) => yRing(r).toFixed(0)).join('/')}, F ${FOK.toFixed(1)}`);
// Planeten unter der Ebene: Mittelpunkt immer unter dem Horizont (Anflug 2450 / 1250 / 650, Abnahme 3), Sicherung vorhanden
const PL = V.planet;
ok(PL.tiefeFaktor === 1.25 && PL.tiefePlus === 40 && PL.radiusFaktor === 1 && PL.sicherungPx === 6, 'Planet: 1,25 × R + 40 unter der Ebene, Sicherung Horizont + 6');
for (const Rp of [120, 190, 210, 520]) for (const d of [5000, 2450, 1250, 650]) {
  const p = proj(d, 0, -(Rp * PL.tiefeFaktor + PL.tiefePlus));
  if (p.depth > PL.tiefeMin) ok(p.y > hz, `Planet R ${Rp} auf ${d}: Mittelpunkt über dem Horizont`);
}
ok(PL.block === undefined && PL.kippung === undefined && PL.kugelMaxPx > 0, 'Planet: keine toten Tokens block/kippung (KulisseKugel liest KUGEL.block, HIMMEL.kippung), Kugel-Obergrenze gesetzt');
// Glas und Objekte
const GL = V.glas, OB = V.objekt;
ok(GL.schleier.alpha === 0.34 && GL.schleier.farbe === T.EIGEN.tiefraum, 'Glas: Schleier 34 % Schwarz (Tiefraum)');
ok(GL.ringe.welt.join() === '200,400,700', 'Glas: Ringe 200/400/700');
ok(OB.gegner.faktor === 1.6 && OB.gegner.minPx === 16 && OB.gegner.maxFaktor >= OB.gegner.faktor, 'Gegner 1,6-fach, mindestens 16 px');
ok(OB.gegner.dunst.ab === 280 && OB.gegner.dunst.max === 0.38 && OB.gegner.dunst.spanne > 0, 'Dunst ab 280, höchstens 38 %');
ok(OB.marke.w === 20 && OB.marke.h === 10 && OB.marke.huelle.h < OB.marke.winkel.oben && OB.marke.winkel.unten <= OB.marke.h, 'Gegnermarke 20 × 10, Hüllenbalken über dem Winkel');
ok(OB.beschriftung.nurZielText === true && OB.randpfeil.hinten === false, 'Nur das Ziel trägt Text; kein Randpfeil für Gegner hinter dem Schiff (Lagescheibe)');
ok(['lagescheibe', 'leiste', 'tafelRechts'].every((n) => OB.beschriftung.sperren.includes(n)), 'Beschriftung sperrt Tafel, Leiste, Lagescheibe');
const bsch = OB.beschriftung;
ok(bsch.freiObenLinks && bsch.freiObenLinks.w >= T.TAFEL.links.x + T.TAFEL.links.w && bsch.freiObenLinks.h >= T.TAFEL.links.y + T.TAFEL.links.h, 'B2: Fläche „oben links frei“ deckt die frühere linke Tafel');
ok(OB.grob.tele.sichtLetzte === 1.2, 'B2: Tele-Ladung nur in den letzten 1,2 s (wie die klassische Frontsicht)');
ok(OB.gegner.ziel.halo && istAlpha(OB.gegner.ziel.halo.alpha) && OB.gegner.ziel.halo.extra >= 1, 'B2: Zielklammern mit dunklem Saum');
ok(bsch.hoeheMitEntfernung >= 16 + zH(1) && bsch.hoeheMitEntfernung2 >= 16 + zH(2) && bsch.hoehe >= zH(2), 'Schildhöhen zu klein für die Schrift');
// Skalen nach Auftrag KUL-03 (Kurs, Tempo 3; Peilband, Stufe, Ziel, Station + Entfernung, Dock-Ring, Randpfeil, Bojen 2)
const LS = V.leiste;
ok(LS.tempo.skala === 3 && LS.kasten.skala === 3, 'Kurs und Tempo nicht Skala 3');
ok([LS.band.zahl.skala, LS.stufe.skala, OB.gegner.ziel.label.skala, OB.station.label.skala, OB.station.label.entfernungSkala, OB.station.dock.label.skala, OB.randpfeil.label.skala, OB.boje.sprung.label.skala, OB.boje.nav.label.skala].every((s) => s === 2), 'Skala-2-Vorgaben verletzt');
// Leiste: 70 % der Mockup-Höhe, Skala 3 im Hochfeld, Skala 2 im Band
const LY = SH - LS.hoehe, hochTop = LS.hoehe - LS.hochfeld;
ok(LS.hoehe === Math.round(LS.hoeheMockup * 0.7), `Leiste ${LS.hoehe} ≠ 70 % von ${LS.hoeheMockup}`);
ok(LS.hochfeld >= LS.hoehe && LS.hochfeld >= LS.streifen + zH(3) + 4, 'Skala 3 passt nicht ins Hochfeld (Streifen + 2 + 21 + 2)');
ok(LS.tempo.y >= hochTop + LS.streifen + 1 && LS.tempo.y + zH(3) <= LS.hoehe - 1, 'Tempo ragt aus dem Hochfeld');
ok(LS.stufe.y >= hochTop + LS.streifen + 1 && LS.stufe.y + zH(2) <= LS.leiter.y - 1 && LS.leiter.y + LS.leiter.h <= LS.hoehe - 1, 'Stufe/Leiter ragen aus dem Hochfeld');
const tempoB = 51, stopB = LS.stufe.maxBreite;   // „164“ Skala 3, „STOPP“ Skala 2 (Pixelschrift art.js)
ok(LS.tempo.x + tempoB + LS.stufe.abstand + stopB <= LS.feldBreite && LS.tempo.x + tempoB + LS.stufe.abstand + 5 * LS.leiter.schritt + LS.leiter.w <= LS.feldBreite, 'Tempo + Stufe/Leiter breiter als das Hochfeld');
ok(LS.feldBreite <= LS.band.rand - 2, 'Hochfeld stößt ans Peilband');
const K3 = LS.kasten;
ok(K3.y >= hochTop && K3.textY >= K3.y + K3.randBreite + 1 && K3.textY + zH(3) <= K3.y + K3.h - K3.randBreite - 1 && K3.y + K3.h <= LS.hoehe, 'Kurs passt nicht in den Kasten');
const kw = 51 + 2 * K3.pad;   // „360“ Skala 3
ok(W / 2 - kw / 2 > LS.band.rand && W / 2 + kw / 2 < W - LS.band.rand, 'Kurs-Kasten breiter als das Band');
ok(K3.textY === LS.tempo.y, 'Kurs und Tempo stehen nicht auf einer Zeile');
const BD = LS.band;
ok(BD.tickY >= LS.streifen && BD.tickY + BD.lang + 1 <= BD.zahl.y && BD.zahl.y + zH(BD.zahl.skala) <= LS.hoehe, 'Gradzahlen Skala 2 passen nicht unter die Striche');
ok(BD.zahlAlle % BD.teilung === 0 && istAlpha(BD.alphaLang) && istAlpha(BD.alphaKurz), 'Band-Teilung');
// Lagescheibe unten rechts, im Schirm, unter den Randpfeilen, rechts vom Band
const LG = V.lagescheibe, lcx = W + LG.cx, lcy = SH + LG.cy, lr = LG.radius + LG.grund.plus;
ok(LG.reichweiteWelt === 800 && lcx + lr <= W && lcy + lr <= SH && lcx - lr >= W - LS.band.rand + 2, 'Lagescheibe ragt aus dem Schirm oder ins Band');
ok(LY - OB.randpfeil.ueberLeiste + 6 < lcy - lr, 'Randpfeile reichen in die Lagescheibe');
ok(LG.schildring.radius < LG.radius / 2, 'Schildring der Lagescheibe zu groß');
ok(LG.punkt.verbuendet && HEX.test(LG.punkt.verbuendet.farbe) && LG.punkt.verbuendet.px >= 3 && LG.punkt.verbuendet.px <= 10, 'Lagescheibe: Punkt der Verbündeten fehlt (3–10 px)');
ok(LG.punkt.ziel.rahmen && istZahl(LG.punkt.ziel.rahmen.pad) && istAlpha(LG.punkt.ziel.rahmen.alpha), 'Lagescheibe: Rahmen des Ziels fehlt');
ok(Object.values(LG.punkt).every((p) => HEX.test(p.farbe) && p.px >= 3 && p.px <= 10), 'Lagescheibe: Punkte 3–10 px');
// Tafeln: oben links frei, rechts die Tafel aus KUL-02; sie überschneidet weder Leiste noch Lagescheibe
ok(V.tafel.links === false && V.tafel.rechts === true, 'Visier: oben links muss frei bleiben, rechts die Sprungziel-Tafel');
ok(R.y + R.h < LY + hochTop && R.y + R.h < lcy - lr, 'Sprungziel-Tafel überschneidet Leiste oder Lagescheibe');
// Skins: Platte und Kappe je Skin, Deckung mindestens wie der Tafelgrund
for (const sk of ['rom', 'germanen']) { const S2 = V.skin[sk]; ok(S2 && S2.platte && HEX.test(S2.platte.farbe) && S2.platte.alpha >= TF.grund.alpha && S2.kappe && S2.kappe.form, `Skin ${sk}: Platte/Kappe`); }
ok(V.skin.germanen.wolfszahn.zahn.every((z) => z.length === 4), 'Wolfszahn: Rechtecke [dx, dy, w, h]');

console.log(fehler ? `${fehler} Fehler.` : 'Tokens Hauptschirm ok.');
process.exit(fehler ? 1 : 0);
