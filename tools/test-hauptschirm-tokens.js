// KUL-02 Designer: Tokens des Hauptschirms (public/js/hauptschirm-tokens.js) prüfen.
//  1. Struktur und Typen: alle Gruppen da, Zahlen sind Zahlen, Skalen ganzzahlig, Alpha in [0, 1].
//  2. Herkunft der Farben: Spiegel = render.js PAL; jede Farbe außerhalb von PAL/EIGEN/STERN/PLANET verweist auf PAL oder EIGEN;
//     keine rgba-Strings; Hex-Literale in der Datei nur im Token-Block.
//  3. Daten statt Erfindung: Planetentypen und Sternklassen = shared/gen-sektor.js.
//  4. Wertebereiche: Parallaxe, Radiusfaktor, Abdunklung wie Richtung A; Beschriftung ≥ Skala 2; Tafeln im Schirm, ohne Überlappung,
//     Mitte oben frei; Elemente in ihrer Tafel.
//  5. Kontrast nach WCAG 2.1: dokumentierte Werte stimmen (±0,05); Text ≥ 4,5:1, Rot (nur Skala 2) ≥ 3:1, auch auf dem Tafelgrund
//     über hellstem Bild (86 % über Weiß).
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
const GRUPPEN = ['SCHIRM', 'PAL', 'EIGEN', 'FARBE', 'TEXT', 'HIMMEL', 'STERNFELD', 'STERN', 'SONNE', 'PLANET', 'KUGEL', 'BOJE', 'GASRIESE', 'TAFEL', 'KONTRAST'];
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
ok(T.TAFEL.grund.farbe === '#0B0E1A' && T.TAFEL.grund.alpha === 0.86, 'Tafelgrund nicht #0B0E1A bei 86 %');
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
ok(planeten && planeten.concat('gasriese').sort().join() === Object.keys(T.PLANET).sort().join(), `Planetentypen ≠ gen-sektor.js + gasriese (${planeten})`);
ok(T.PLANET.ozean.land, 'Ozean braucht Landrampe');

// 4. Wertebereiche
const H = T.HIMMEL;
ok(H.parallaxePlanet === 0.45 && H.parallaxeGasriesePlan === 1, 'Parallaxe nicht 0,45 / 1 (Richtung A)');
ok(H.radiusFaktor === 0.9 && H.radiusFaktorGasriesePlan === 1, 'Radiusfaktor nicht 0,9 / 1');
ok(H.abdunklung.alpha === 0.22, 'Abdunklung nicht 22 %');
ok(H.parallaxePlanet > 0 && H.parallaxePlanet < 1, 'Planeten müssen langsamer ziehen als die Ebene');
const SF = T.STERNFELD;
ok(Number.isInteger(SF.anzahl) && SF.anzahl > 0 && SF.anzahl <= 1000, 'Sternfeld-Anzahl');
ok(SF.klassen.every((k, i, a) => istAlpha(k.ab) && (i === 0 || a[i - 1].ab > k.ab)) && SF.klassen[SF.klassen.length - 1].ab === 0, 'Sternfeld-Klassen absteigend bis 0');
const S = T.SONNE;
ok(S.radius > 0 && S.randAbstand > S.radius && S.gluehen.every(([r, a]) => r > 1 && istAlpha(a)), 'Sonne: Maße/Glühen');
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
ok(B.sprung.label.skala >= 2 && G.label.skala >= 2, 'Bojen-/Schicht-Labels unter Skala 2');
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
console.log(`Kontrast auf Tafelgrund ${KO.grund} (und 86 % über Weiß = ${tafelHell}):`);
for (const [k, doku] of Object.entries(KO.werte)) {
  const c = palEcht[k], v = kontrast(c, KO.grund), w = kontrast(c, tafelHell), min = KO.nurAbSkala2.includes(k) ? 3 : 4.5;
  console.log(`  ${k.padEnd(6)} ${c}  ${fmt(v).padStart(6)}:1  (Doku ${fmt(doku)})  über Weiß ${fmt(w)}:1  min ${fmt(min)}`);
  ok(Math.abs(v - doku) <= 0.05, `${k}: gemessen ${fmt(v)} ≠ Doku ${fmt(doku)}`);
  ok(v >= min && w >= min, `${k}: unter ${fmt(min)}:1`);
}
for (const [n, c, g] of [['Kappe ink auf Messing', F.ink, F.sprung], ['Kappe ink auf Bernstein', F.ink, F.kurs], ['Boje/Entfernung Creme', F.text, KO.grund], ['Bojenraute', T.EIGEN.bojeKern, F.grund], ['Schichtnamen', T.EIGEN.gasLinie, F.grund]]) {
  const v = kontrast(c, g); console.log(`  ${n.padEnd(24)} ${fmt(v).padStart(6)}:1`); ok(v >= 4.5, `${n} ${fmt(v)}:1 < 4,5`);
}

console.log(fehler ? `${fehler} Fehler.` : 'Tokens Hauptschirm ok.');
process.exit(fehler ? 1 : 0);
