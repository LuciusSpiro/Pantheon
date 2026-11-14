// CHA-01 Designer: Tokens der Kleiderkammer (public/js/pult-kammer-tokens.js), des Startmenüs (public/js/menue-tokens.js) und der Namensmarke
// (public/js/namensmarke-tokens.js) prüfen.
//  1. Spiegel der Funktionsfarben und Skins = pult.js, Spielerfarben aus shared/protocol.js (sonst laufen Node-Test und Browser auseinander)
//  2. Kontrast nach WCAG 2.1: Text ≥ 4,5:1, große Schrift (Skala ≥ 3) ≥ 3:1, Grafik ≥ 3:1. Kammer in beiden Skins; Menü über dem Bild im
//     schlimmsten Fall (weißes Bild unter der Abdunklung); Namensmarke auf hellem Boden. Gibt die Messwerte aus.
//  3. Geometrie: nichts außerhalb 640×360, Ziffernblock vollständig (genau die Plätze, jede Taste einmal, im Pult), Kacheln/Karten ohne Überlappung.
//  4. Marke und Schriftzug: Raster = Logo-SVG bzw. Pixelschrift aus art.js.
// Aufruf: node tools/test-kammer-tokens.js   (Exit 1 bei Fehlern)   ·   --schriftzug WORT gibt das Raster für einen neuen Namen aus
'use strict';
const fs = require('fs');
const path = require('path');
const PK = require(process.env.KAMMER_TOKENS_DATEI || '../public/js/pult-kammer-tokens.js');   // KAMMER_TOKENS_DATEI: Mutationsprobe (tools/mutation-kammer-tokens.js)
const ME = require('../public/js/menue-tokens.js');
const NM = require(process.env.NAMENSMARKE_TOKENS_DATEI || '../public/js/namensmarke-tokens.js');   // NAMENSMARKE_TOKENS_DATEI: Mutationsprobe (tools/mutation-kammer-tokens.js)
const PROTO = require('../shared/protocol.js');

const ROOT = path.join(__dirname, '..');
const artSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'art.js'), 'utf8');
function glyph(ch) { const m = artSrc.match(new RegExp("'" + ch.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&') + "': '([^']+)'")); if (!m) return null; let s = m[1]; let top = 0; if (s[0] === '^') { top = -1; s = s.slice(1); } else if (/^[0-9]/.test(s) && s.length > 1 && s[1] !== '/') { top = +s[0]; s = s.slice(1); } return { top, rows: s.split('/') }; }
function schriftzugRaster(wort, sp) {
  const rows = Array.from({ length: 7 }, () => '');
  [...wort].forEach((c, i) => { const g = glyph(c); const w = Math.max(...g.rows.map((r) => r.length)); for (let r = 0; r < 7; r++) { rows[r] += (g.rows[r - g.top] || '').padEnd(w, '.'); if (i < wort.length - 1) rows[r] += '.'.repeat(1 + sp); } });
  return rows;
}
const ai = process.argv.indexOf('--schriftzug');
if (ai > 0) { console.log(JSON.stringify(schriftzugRaster(process.argv[ai + 1] || 'PANTHEON', 2), null, 2)); process.exit(0); }

let fehler = 0;
const ok = (b, msg) => { if (!b) { fehler++; console.log('  FEHLER ' + msg); } };
const fmt = (v) => v.toFixed(2).replace('.', ',');
const TEXT = 4.5, GROSS = 3, GRAFIK = 3;
function zeile(v, a, b, rolle, min) { console.log(`  ${fmt(v).padStart(6)}:1  ${(a + ' auf ' + b).padEnd(34)} ${rolle}${v < min ? '   < ' + min : ''}`); }

// ---------------------------------------------------------------- 1. Spiegel
const pult = fs.readFileSync(path.join(ROOT, 'public', 'js', 'pult.js'), 'utf8');
const fnZeile = pult.match(/const FN = (\{[^}]+\});/);
ok(fnZeile, 'FN in pult.js nicht gefunden');
if (fnZeile) {
  const echt = Function('return ' + fnZeile[1])();
  for (const [datei, fn] of [['pult-kammer-tokens', PK.TOKENS.FN], ['menue-tokens', ME.TOKENS.FN]]) for (const k of Object.keys(echt)) ok(echt[k] === fn[k], `${datei} FN.${k}: pult.js ${echt[k]} ≠ Spiegel ${fn[k]}`);
}
const SPIEGEL = { screenBg: 'grund', bg: 'pultGrund', text: 'text', dim: 'dim', ink: 'ink' };
for (const skin of ['rom', 'germanen']) {
  const blk = pult.split('SKINS.' + skin + ' = {')[1] || '';
  const F = PK.farben(skin);
  for (const [feld, token] of Object.entries(SPIEGEL)) { const m = blk.match(new RegExp('\\b' + feld + ": '(#[0-9A-Fa-f]{6})'")); ok(m && m[1] === F[token], `Skin ${skin}.${feld}: pult.js ${m && m[1]} ≠ Kammer ${token} ${F[token]}`); }
  const k = blk.match(new RegExp('\\b' + (skin === 'rom' ? 'off' : 'plate') + ": '(#[0-9A-Fa-f]{6})'"));
  ok(k && k[1] === F.kachel, `Skin ${skin}: Kachel ≠ ${skin === 'rom' ? 'off' : 'plate'} (${k && k[1]} / ${F.kachel})`);
}
ok(JSON.stringify(NM.TOKENS.SPIELER.farben) === JSON.stringify(PROTO.PLAYER_COLORS), 'Namensmarke: Spielerfarben ≠ shared/protocol.js');
ok(ME.spieler(2).farbe === PROTO.PLAYER_COLORS[2] && ME.spieler(1).form === PROTO.PLAYER_SHAPES[1], 'Menue.spieler() ≠ shared/protocol.js');

// ---------------------------------------------------------------- 2a. Kontrast Kammer (beide Skins)
const paare = [
  ['text', 'kachel', TEXT, 'Teilename, Kartenzeilen'], ['dim', 'kachel', TEXT, 'Volk, Herkunft, Körperzeile'], ['platz', 'kachel', TEXT, 'Name getragen / gewählt (Messing)'],
  ['dim', 'grund', TEXT, 'Hinweis unter den Kacheln'], ['platz', 'grund', TEXT, 'Platztitel in der Anzeige'],
  ['gesperrtKappeText', 'gesperrtKappe', TEXT, 'Kappe H / F'], ['kappeText', 'kappe', TEXT, 'Kappe Kartennummer, Q / E'], ['kappeWahlText', 'kappeWahl', TEXT, 'Kappe der gewählten Karte'],
  ['dim', 'figurGrund', TEXT, '„drehen“ im Figurfenster'], ['platz', 'figurGrund', TEXT, 'Name im Figurfenster (Spind)'],
  ['dim', 'pultGrund', TEXT, 'Beschriftung Haar / Haut, Name = Spielername'],
  ['cursor', 'grund', GRAFIK, 'äußerer Cursor-Rand'], ['platz', 'grund', GRAFIK, 'innerer Cursor-Rand, Leiste getragen'], ['musterRand', 'pultGrund', GRAFIK, 'Rand jedes Farbmusters'], ['musterWahl', 'pultGrund', GRAFIK, 'Rand des gewählten Musters'],
  ['gesperrtKappe', 'gesperrtGrund', GRAFIK, 'Kappe der gesperrten Kachel als Form'],
];
// Statusleiste: rom = ink auf voller Funktionsfläche, germanen = Farbe als Text auf der Platte (pult.js SKINS.*.status)
const statusFn = [...new Set(Object.values(PK.TOKENS.STATUS).filter(Boolean).flat().map((s) => s.fn))];
for (const skin of ['rom', 'germanen']) {
  const F = PK.farben(skin);
  console.log(`Kammer, Skin ${skin}:`);
  for (const [a, b, min, rolle] of paare) { const v = PK.kontrast(F[a], F[b]); zeile(v, a, b, rolle, min); ok(v >= min, `Kammer ${skin}: ${a} auf ${b} ${fmt(v)}:1 < ${min}:1 (${rolle})`); }
  for (const fn of statusFn) {
    const [vg, hg, n1, n2] = skin === 'rom' ? [F.ink, PK.TOKENS.FN[fn], 'ink', 'FN.' + fn] : [PK.TOKENS.FN[fn], F.kachel, 'FN.' + fn, 'Platte'];
    const v = PK.kontrast(vg, hg); zeile(v, n1, n2, 'Statusfeld', TEXT); ok(v >= TEXT, `Kammer ${skin}: Statusfeld ${n1} auf ${n2} ${fmt(v)}:1`);
  }
}
const alt = PK.kontrast(PK.TOKENS.FARBE.ink, PK.TOKENS.FN.locked);
console.log(`  zum Vergleich ink auf FN.locked (Kappe im Mockup): ${fmt(alt)}:1 (darum gesperrtKappe aufgehellt)`);
ok(alt < TEXT, 'Vergleichswert erwartet < 4,5');

// ---------------------------------------------------------------- 2b. Kontrast Menü
const MF = ME.TOKENS.FARBE, MM = ME.TOKENS.MASS;
console.log('Menü (kein Skin):');
const kachelWeiss = ME.ueber(MF.kachel, MM.kachelDeckkraft, MF.weiss);   // Kachel über weißem Bild (schlimmster Fall)
const menuePaare = [
  ['text', kachelWeiss, TEXT, 'Text auf Kachel (Bild weiß darunter)'], ['dim', kachelWeiss, TEXT, 'gedämpft auf Kachel'], ['messing', kachelWeiss, TEXT, 'Gruppe/RAUMCODE auf Kachel'],
  ['gold', kachelWeiss, TEXT, 'Raumcode, Auswahl auf Kachel'], ['nichtBereit', kachelWeiss, TEXT, '„wartet auf“ auf Kachel'],
  ['tinte', 'gold', TEXT, 'Schrift auf Hauptknopf'], ['gold', 'tinte', TEXT, 'Taste in der Kappe des Hauptknopfs'], ['tinte', 'messing', TEXT, 'GASTGEBER'], ['tinte', 'bereit', TEXT, 'Knopf BEREIT (Mint)'],
  ['text', 'karte', TEXT, 'Zeile auf Lobby-Karte'], ['dim', 'karte', TEXT, 'FREI, L lädt ein'], ['bereit', 'karte', TEXT, 'Stempel AN BORD'], ['nichtBereit', 'karte', TEXT, 'Stempel NICHT BEREIT'],
  ['kappeText', 'kappe', TEXT, 'Tastenkappe'], ['text', 'statuszeile', TEXT, 'Statuszeile Wert'], ['dim', 'statuszeile', TEXT, 'Statuszeile Label'], ['nichtBereit', 'statuszeile', TEXT, 'BEREIT 2/3'], ['bereit', 'statuszeile', TEXT, 'BEREIT 3/3'], ['messing', 'statuszeile', TEXT, 'Versionsnummer (Lobby)'],
];
for (const [a, b, min, rolle] of menuePaare) { const hb = MF[b] || b, v = ME.kontrast(MF[a], hb); zeile(v, a, MF[b] ? b : 'Kachel/weiß ' + hb, rolle, min); ok(v >= min, `Menü: ${a} auf ${b} ${fmt(v)}:1 < ${min} (${rolle})`); }
// Auswahlzeile im Menü: Goldfläche 12 % über dem Verlauf; Text Gold
for (let y = MM.menue.y; y < 250; y += 20) {
  const u = ME.unterlage('menue', MM.menue.x + MM.menue.w, y), z = ME.ueber(MF.gold, MM.auswahl.deckkraft, u), v = ME.kontrast(MF.gold, z);
  ok(v >= TEXT, `Menü: Auswahlzeile y ${y} Gold ${fmt(v)}:1`);
}
// Spielerfarben (Name auf der Lobby-Karte, Form auf der Platte über dem Porträt)
PROTO.PLAYER_COLORS.forEach((c, i) => {
  const v = ME.kontrast(c, MF.karte); zeile(v, 'Spieler ' + (i + 1) + ' ' + c, 'karte', 'Name in Spielerfarbe', TEXT); ok(v >= TEXT, `Menü: Spielerfarbe ${c} auf Karte ${fmt(v)}`);
  const pl = ME.ueber(MF.formPlatte, MM.karte.formDeckkraft, MF.weiss), g = ME.kontrast(c, pl); ok(g >= GRAFIK, `Menü: Form ${c} auf Platte über hellem Porträt ${fmt(g)}`);
});
// Textzonen über dem Bild (schlimmster Fall: weißes Bild, gedimmt, darunter Abdunklung)
console.log('Menü, Text über dem Bild (schlimmster Fall, je Zone der kleinste Wert):');
for (const [s, x0, y0, x1, y1, f, min] of MM.textzonen) {
  let w = Infinity;
  for (let x = x0; x <= x1; x += 2) for (let y = y0; y <= y1; y += 2) w = Math.min(w, ME.kontrast(MF[f], ME.unterlage(s, x, y)));
  zeile(w, f, `${s} x ${x0}–${x1} y ${y0}–${y1}`, min === GROSS ? 'große Schrift' : 'Text', min);
  ok(w >= min, `Menü ${s}: ${f} über dem Bild x ${x0}–${x1} y ${y0}–${y1} ${fmt(w)}:1 < ${min}`);
}

// ---------------------------------------------------------------- 2c. Namensmarke
const NF = NM.TOKENS.FARBE, NMM = NM.TOKENS.MASS;
console.log('Namensmarke (Grund ' + NMM.grundDeckkraft + ' auf Boden):');
for (const [boden, name] of [[NF.bodenHell, 'hell'], [NF.bodenMittel, 'mittel']]) {
  const g = ME.ueber(NF.grund, NMM.grundDeckkraft, boden);
  PROTO.PLAYER_COLORS.forEach((c, i) => { const v = ME.kontrast(c, g); zeile(v, 'Spieler ' + (i + 1), 'Marke, Boden ' + name, 'Name / Form', TEXT); ok(v >= TEXT, `Namensmarke: Spieler ${i + 1} auf Boden ${name} ${fmt(v)}:1`); });
}
const alt55 = Math.min(...PROTO.PLAYER_COLORS.map((c) => ME.kontrast(c, ME.ueber(NF.grund, 0.55, NF.bodenHell))));
const alt72 = Math.min(...PROTO.PLAYER_COLORS.map((c) => ME.kontrast(c, ME.ueber(NF.grund, 0.72, NF.bodenHell))));
console.log(`  zum Vergleich schwächste Spielerfarbe auf hellem Boden: Grund 0,55 ${fmt(alt55)}:1, Grund 0,72 ${fmt(alt72)}:1`);
ok(alt72 < TEXT, 'Vergleichswert 0,72 erwartet < 4,5');

// ---------------------------------------------------------------- 2d. Zeichen: jeder feste Text hat eine Glyphe in art.js (sonst zeichnet das Spiel ein Kästchen)
const gBlock = artSrc.slice(artSrc.indexOf('var GLYPHS = {') + 'var GLYPHS = '.length);
const GLYPHEN = Function('return ' + gBlock.slice(0, gBlock.indexOf('\n  };') + 4))();
const texte = [];
const sammle = (o) => { if (typeof o === 'string') texte.push(o); else if (o && typeof o === 'object') Object.values(o).forEach(sammle); };
sammle(PK.TOKENS.TEXT); sammle(PK.TOKENS.PLATZ); sammle(PK.TOKENS.HERKUNFT); sammle(ME.TOKENS.TEXT); sammle(ME.TOKENS.STEMPEL);
// CHA-01 E: die festen Texte der Menü-Oberfläche (public/js/menue.js TEXT, Gruppen- und Eintragstexte) und die Modusnamen/-hinweise aus dem Protokoll, die das Menü anzeigt
{ const MF = require('../public/js/menue.js'); sammle(MF.TEXT); sammle(PROTO.START_LABELS); sammle(PROTO.START_HINTS); sammle(PROTO.WELLEN_KARTEN_NAMEN || {}); sammle(Object.values(PROTO.WAFFEN_NAMEN || {})); sammle(['Freie Fahrt Sund']);   // CHA-01 G: Kartennamen der Chips, Weltstand-Typ sammle(MF.GRUPPEN.flatMap((g) => g.eintraege.map((e) => e.art)));
  // Nacharbeit: Texte, die der Server in die Lobby liefert und das Menü anzeigt (Labor: Name, Kartenarten, Landepunkt, Startzustand, Ort; Orte der Welt)
  const lab = require('../server/mission/labor.js').laborListe(); sammle(lab.map((e) => [e.name, (e.kartenarten || []).join('/'), e.landepunkt || '', e.startzustand || '']).flat());
  sammle(require('../shared/locations.js').LOCATIONS.map((l) => l.name)); }
const fehlend = new Set();
for (const t of texte) for (const ch of t.replace(/\{\w+\}/g, '')) if (ch !== ' ' && GLYPHEN[ch] === undefined && GLYPHEN[ch.toUpperCase()] === undefined) fehlend.add(ch);
ok(!fehlend.size, 'Zeichen ohne Glyphe in art.js: ' + [...fehlend].join(' '));
console.log(`Zeichen: ${texte.length} feste Texte geprüft, ${fehlend.size ? 'fehlend ' + [...fehlend].join(' ') : 'alle Glyphen vorhanden'}`);

// ---------------------------------------------------------------- 3. Geometrie
const VW = 640, VH = 360;
const drin = (r, b) => r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h;
const getrennt = (p, q) => p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y;
const SCHIRM = { x: 0, y: 0, w: VW, h: VH };
const R = PK.rahmen();
ok(drin(R.anzeige, SCHIRM) && drin(R.pult, SCHIRM), 'Kammer: Anzeige/Pult außerhalb 640×360');
// Ziffernblock vollständig
const PLAETZE = { spind: ['kopf', 'oberteil', 'hose', 'schuhe', 'haende', 'umhang'], erstellung: ['frisur', 'haut', 'haar'] };
for (const [art, soll] of Object.entries(PLAETZE)) {
  const zb = PK.ziffernblock(art, R.pult), belegt = zb.filter((z) => !z.leer);
  ok(belegt.map((z) => z.platz).sort().join() === soll.slice().sort().join(), `Ziffernblock ${art}: Plätze ${belegt.map((z) => z.platz).join()} ≠ ${soll.join()}`);
  ok(new Set(zb.map((z) => z.taste)).size === zb.length, `Ziffernblock ${art}: Taste doppelt`);
  ok(zb.filter((z) => /^[1-9]$/.test(z.taste)).length === 9, `Ziffernblock ${art}: Tasten 1–9 nicht vollständig`);
  for (const z of zb) {
    ok(drin(z.rect, R.pult), `Ziffernblock ${art}: Taste ${z.taste} außerhalb des Pults ${JSON.stringify(z.rect)}`);
    ok(z.leer || PK.TOKENS.PLATZ[z.platz], `Ziffernblock ${art}: Platz ${z.platz} ohne Namen`);
  }
  for (let i = 0; i < zb.length; i++) for (let j = i + 1; j < zb.length; j++) ok(getrennt(zb[i].rect, zb[j].rect), `Ziffernblock ${art}: Tasten ${zb[i].taste}/${zb[j].taste} überlappen`);
  const blk = PK.TOKENS.MASS.spalten.block; ok(Math.max(...zb.map((z) => z.rect.x + z.rect.w)) <= R.pult.x + blk.x + blk.w, `Ziffernblock ${art}: breiter als Spalte block`);
}
// Plätze des Spinds = Outfit, der Erstellung = Charakter/Farbe
for (const p of PLAETZE.spind) ok(PK.TOKENS.PLATZ[p].gruppe === 'outfit', `Spind: ${p} ist kein Outfit-Platz`);
for (const p of PLAETZE.erstellung) ok(PK.TOKENS.PLATZ[p].gruppe !== 'outfit', `Erstellung: ${p} ist ein Outfit-Platz`);
// Kurznamen passen in die Zelle (Kappe 13 + 5 Abstand, Pixelschrift ≤ 6 px je Zeichen geschätzt mit Glyphenbreiten aus art.js)
const tw = (s) => [...String(s)].reduce((a, c) => { const g = glyph(c); return a + (g ? Math.max(...g.rows.map((r) => r.length)) : c === ' ' ? 3 : 4) + 1; }, -1);
for (const [k, p] of Object.entries(PK.TOKENS.PLATZ)) ok(tw(p.kurz) <= PK.TOKENS.MASS.ziffernblock.w - 13 - 9, `Platz ${k}: Kurzname „${p.kurz}“ ${tw(p.kurz)} px zu breit`);
// Kacheln, Karten, Figur
const ks = PK.kacheln(R.anzeige, 10), fig = PK.figur(R.anzeige), kt = PK.karten(R.anzeige), C = PK.TOKENS.MASS.cursor.aussen;
for (const k of ks) { ok(drin({ x: k.x - C, y: k.y - C, w: k.w + 2 * C, h: k.h + 2 * C }, R.anzeige), `Kachel samt Cursor außerhalb der Anzeige ${JSON.stringify(k)}`); ok(getrennt({ x: k.x - C, y: k.y, w: k.w + 2 * C, h: k.h }, fig), 'Kachel überlappt Figurfenster'); }
ok(ks[ks.length - 1].y + ks[0].h <= R.anzeige.y + R.anzeige.h - PK.TOKENS.MASS.kachel.hinweisUnten - 2, 'Kacheln laufen in die Hinweiszeile');
for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) ok(getrennt(ks[i], ks[j]), 'Kacheln überlappen');
ok(drin(fig, R.anzeige), 'Figurfenster außerhalb der Anzeige');
for (const [art, b] of Object.entries(PK.TOKENS.MASS.figurBild)) ok(b.w <= fig.w && PK.TOKENS.MASS.figur.nameH + b.h + PK.TOKENS.MASS.figur.kappe + 2 <= fig.h, `Figurbild ${art} ${b.w}×${b.h} passt nicht in ${fig.w}×${fig.h}`);
for (const k of kt) ok(drin({ x: k.x - C, y: k.y - C, w: k.w + 2 * C, h: k.h + 2 * C }, R.anzeige), `Charakterkarte samt Cursor außerhalb ${JSON.stringify(k)}`);
for (let i = 0; i < 3; i++) ok(getrennt(kt[i], kt[i + 1]), 'Charakterkarten überlappen');
const mu = PK.muster(R.pult.x + PK.TOKENS.MASS.spalten.mitte.x, R.pult.y + 15, 4), mi = PK.TOKENS.MASS.spalten.mitte;
for (const m of mu) ok(m.x + m.w + PK.TOKENS.MASS.muster.wahl <= R.pult.x + mi.x + mi.w, 'Farbmuster ragen aus der Spalte');
const sp = PK.TOKENS.MASS.spalten; ok(sp.block.x + sp.block.w <= sp.mitte.x && sp.mitte.x + sp.mitte.w <= sp.abschluss.x && sp.abschluss.x + sp.abschluss.w <= R.pult.w, 'Pultspalten überlappen');
// CHA-02 E1b: Erstellung auf dem Katalog Version 2 (Name, Frisur, Hautton, Haarfarbe; kein Gesicht, kein Bart, kein Outfit)
{
  const KAT = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'katalog', 'charakter.json'), 'utf8')), MA = PK.TOKENS.MASS, ZB = PK.TOKENS.ZIFFERNBLOCK;
  ok(JSON.stringify(ZB.erstellung) === JSON.stringify({ 8: 'frisur', 5: 'haar', 2: 'haut' }), 'Erstellung: Ziffernblock ist Mittelspalte 8 Frisur, 5 Haarfarbe, 2 Hautton (kein Gesicht, kein Bart)');
  ok(!('gesicht' in PK.TOKENS.PLATZ) && !('bart' in PK.TOKENS.PLATZ), 'Plätze der Tokens enthalten kein gesicht / bart');
  const anzahl = {}; for (const t of KAT.teile) anzahl[t.platz] = (anzahl[t.platz] || 0) + 1;
  for (const [platz, n] of Object.entries(anzahl)) ok(n <= MA.kachel.spalten * MA.kachel.zeilen, `Platz ${platz}: ${n} Teile passen nicht in ${MA.kachel.spalten * MA.kachel.zeilen} Kacheln (Liste müsste blättern)`);
  ok(anzahl.frisur === 9, 'Frisurenliste hat neun Einträge (Katalog ' + anzahl.frisur + ')');
  ok(MA.kachelAnsicht.frisur.yaw === 0 && MA.kachelAnsicht.kopf.yaw === 0, 'Livekacheln: Frisur und Kopfbedeckung ¾ von vorn (yaw 0 zur Kamera 28°), wie die Vorschaubilder des Voxelwerks');
  // CHA-02 E1b: Hilfe-Liste in Raster-Reihenfolge (8; 4 5 6; 2; 0), Pfeiltasten-Zeilen der Hilfe, Textabstand in den Kacheln
  const reihe = (art) => PK.ziffernblock(art, PK.rahmen().pult).filter((z) => !z.leer).map((z) => z.taste).join();
  ok(reihe('spind') === '8,4,5,6,2,0', 'Spind: Ziffernblock-Knöpfe (= Hilfe-Liste) in Raster-Reihenfolge 8; 4 5 6; 2; 0, nicht aufsteigend (' + reihe('spind') + ')');
  ok(reihe('erstellung') === '8,5,2', 'Erstellung: Ziffernblock in Raster-Reihenfolge 8, 5, 2 (' + reihe('erstellung') + ')');
  ok(PK.TOKENS.TEXT.hilfe.spind.length === 1 && PK.TOKENS.TEXT.hilfe.erstellung.length === 2 && PK.TOKENS.TEXT.hilfe.spind[0][0] === '←→↑↓', 'Hilfe: Pfeiltasten-Zeilen für Spind (←→↑↓) und Erstellung (←→, ↑↓)');
  const ti = MA.kachel.textInnen, twT = MA.kachel.w - 2 * ti;
  ok(ti >= 3, 'Kachel: Textzeilen mit Innenabstand zum Rand (' + ti + ')');
  ok(tw('Einsatzanzug') <= twT, `Kachel „Einsatzanzug“ ${tw('Einsatzanzug')} px stößt am Rand (Textbreite ${twT} px, Innenabstand ${ti}); längere Einzelwörter kürzt die Kachel mit Punkt`);
  // Farbmuster: Haar 8 (zwei Zeilen) und Haut 6 bleiben in der Spalte, nie in der Spalte Charakter
  const mx = R.pult.x + mi.x, mrechts = mx + mi.w;
  for (const [n, zeilen] of [[KAT.farben.haar.length, 2], [KAT.farben.haut.length, 1]]) {
    const ms = PK.muster(mx, R.pult.y + 15, n);
    ok(ms.length === n && new Set(ms.map((m) => m.y)).size === zeilen, `Farbmuster ${n}: ${zeilen} Zeile(n) erwartet`);
    for (const m of ms) ok(m.x + m.w + MA.muster.wahl <= mrechts, `Farbmuster ${n} ragen über die Spalte (${m.x + m.w + MA.muster.wahl} > ${mrechts})`);
    for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) ok(getrennt(ms[i], ms[j]), `Farbmuster ${n}: ${i}/${j} überlappen`);
  }
  ok(KAT.farben.haar.length === 8 && KAT.farben.haut.length === 6, 'Haarfarbe 8, Hautton 6');
  const mh = PK.musterHoehe(8), hh = PK.musterHoehe(6);
  ok(mh === 2 * MA.muster.h + MA.muster.fuge && hh === MA.muster.h, 'musterHoehe: Haar zwei Zeilen, Haut eine');
  ok(15 + 3 + mh + MA.muster.zeile - MA.muster.h + hh + 8 + 8 <= R.pult.h, 'Haar-, Haut-Muster und Hinweis passen in die Pulthöhe');
  // Namensfeld unten in der Anzeige: unter den Kachelreihen (samt Cursor-Rand), im Rahmen, Hinweis rechts daneben passt bis zum Figurfenster
  const NF = MA.namensfeld, a = R.anzeige, ksn = PK.kacheln(a, 10), letzte = ksn[ksn.length - 1], by = a.y + a.h - NF.unten;
  ok(by - 3 >= letzte.y + letzte.h + MA.cursor.aussen, `Namensfeld (Rand ${by - 3}) überlappt die letzte Kachelreihe samt Cursor (${letzte.y + letzte.h + MA.cursor.aussen})`);
  ok(by + NF.h + 3 <= a.y + a.h, 'Namensfeld samt Rand ragt unten aus der Anzeige');
  const hinweisBreite = a.x + MA.figur.x - 12 - (a.x + MA.kachel.x + NF.label + NF.w + NF.hinweisAbstand);
  ok(hinweisBreite >= tw('F2 schreiben · Enter fertig') && hinweisBreite >= tw('Enter speichert · Esc zurück') && hinweisBreite >= tw(PK.TOKENS.TEXT.hinweis.erstellung) && hinweisBreite >= tw('←→↑↓ wählen · Vorschau ohne 3D'), `Hinweis neben dem Namensfeld ${hinweisBreite} px zu schmal`);
  // Statusleiste der Erstellung: Label + längster Frisurenname passen in das Feld (Breite wie Pult.statusFelder: 563 · w / Summe)
  const St = PK.TOKENS.STATUS.erstellung, sum = St.reduce((x, f) => x + f.w, 0), fw = (f) => Math.round(563 * f.w / sum);
  const lang = KAT.teile.filter((t) => t.platz === 'frisur').map((t) => t.name).sort((x, y) => tw(y) - tw(x))[0];
  const fr = St.find((f) => f.l === 'FRISUR');
  ok(tw(fr.l) + tw(lang) + 4 + 5 + 6 <= fw(fr), `Statusfeld FRISUR (${fw(fr)} px) zu schmal für „${lang}“ (${tw(fr.l) + tw(lang)} px + Rand)`);
  const hf = St.find((f) => f.l === 'HAAR'), uf = St.find((f) => f.l === 'HAUT');
  ok(tw(hf.l) + tw('8/8') + 15 <= fw(hf) && tw(uf.l) + tw('6/6') + 15 <= fw(uf), 'Statusfelder HAAR / HAUT zu schmal für „8/8“ bzw. „6/6“');
  const nf = St.find((f) => f.l === 'NAME');
  ok(tw(nf.l) + tw('WWWWWWWWWWWW') + 15 <= fw(nf) || tw(nf.l) + tw('Brennus Maxim') + 15 <= fw(nf), 'Statusfeld NAME zu schmal für 12 Zeichen');
}
// Menü: alle Rechtecke im Bild
const rects = [MM.charakter, MM.menue.detail, MM.lobby.raumcode, MM.lobby.start, { x: 0, y: MM.statuszeile.y, w: VW, h: MM.statuszeile.h }];
for (let i = 0; i < 4; i++) rects.push({ x: MM.lobby.crew.x + i * (MM.lobby.crew.w + MM.lobby.crew.fuge), y: MM.lobby.crew.y, w: MM.lobby.crew.w, h: MM.lobby.crew.h });
for (const r of rects) ok(drin(r, SCHIRM), `Menü: Rechteck außerhalb 640×360 ${JSON.stringify(r)}`);
const crewEnde = MM.lobby.crew.x + 4 * MM.lobby.crew.w + 3 * MM.lobby.crew.fuge; ok(crewEnde <= MM.lobby.start.x, `Menü: Crew-Karten (${crewEnde}) laufen in START (${MM.lobby.start.x})`);
ok(MM.lobby.crew.y + MM.lobby.crew.h < MM.lobby.hinweise && MM.lobby.hinweise + 10 <= MM.statuszeile.y, 'Menü: Lobby-Hinweise kollidieren mit Karten oder Statuszeile');
ok(MM.titel.x + ME.TOKENS.SCHRIFTZUG.raster[0].length * MM.titel.schriftzug.s <= VW && MM.titel.schriftzug.y + 7 * MM.titel.schriftzug.s <= MM.titel.claim, 'Menü: Schriftzug im Titel zu groß');
ok(MM.titel.marke.y + 16 * MM.titel.marke.s < MM.titel.schriftzug.y, 'Menü: Marke überlappt Schriftzug');
// Namensmarke
const mk = NM.marke('Brennus', false, (s) => tw(s)), me = NM.marke('Aurelia', true, (s) => tw(s));
ok(mk.text && mk.text.x + tw('Brennus') <= mk.x + mk.w && me.text === null && me.w === NMM.eigenW, 'Namensmarke: Breite / eigene Marke');
ok(NMM.stiel.h + NMM.h < NMM.geduckt, 'Namensmarke: Stiel reicht in den Kopf');
// CHA-02 E1b: die Marke hängt über dem neuen, höheren Kopf (Figur 35 Voxel = 48 Spielpixel): Anker mindestens Kopf + (Marke + Stiel) im kleinsten Maßstab der Spielkamera
ok(NMM.kopf === Math.round(35 / 16 * 22), `Namensmarke: Kopfhöhe ${NMM.kopf} ≠ 35 Voxel (${Math.round(35 / 16 * 22)} Spielpixel)`);
ok(NMM.ueberKopf >= NMM.kopf + Math.ceil((NMM.h + NMM.stiel.h + NMM.abstand) * 22 / NMM.pxJeMeterMin), `Namensmarke: ueberKopf ${NMM.ueberKopf} < Kopf ${NMM.kopf} + Marke/Stiel/Abstand im kleinsten Maßstab (${NMM.kopf + Math.ceil((NMM.h + NMM.stiel.h + NMM.abstand) * 22 / NMM.pxJeMeterMin)}): Crista/Hörner berühren die Marke`);
ok(NMM.geduckt < NMM.ueberKopf && NMM.ueberKopf - NMM.geduckt === 12, 'Namensmarke: geduckt = ueberKopf − 12 (Duck-Pose senkt den Kopf wie bisher)');


// ---------------------------------------------------------------- 4. Marke und Schriftzug
const svg = fs.readFileSync(path.join(ROOT, 'public', 'img', 'logo', 'marke.svg'), 'utf8');
const gitter = Array.from({ length: 16 }, () => Array(16).fill('.'));
for (const m of svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"(?: fill="(#[0-9A-Fa-f]{6})")?\/>/g)) {
  const [x, y, w, h] = [m[1], m[2], m[3], m[4]].map(Number), ch = m[5] === ME.TOKENS.FN.drive ? '*' : '#';
  for (let r = y; r < y + h; r++) for (let q = x; q < x + w; q++) gitter[r][q] = ch;
}
ok(gitter.map((r) => r.join('')).join() === ME.TOKENS.MARKE.join(), 'Marke: Raster ≠ public/img/logo/marke.svg');
const sz = ME.TOKENS.SCHRIFTZUG, soll = schriftzugRaster(sz.wort, sz.sperrung);
ok(soll.join() === sz.raster.join(), 'Schriftzug: Raster ≠ Pixelschrift art.js (node tools/test-kammer-tokens.js --schriftzug ' + sz.wort + ')');
ok(ME.raster(ME.TOKENS.MARKE, 1).reduce((a, r) => a + r.w * r.h, 0) === ME.TOKENS.MARKE.join('').replace(/\./g, '').length, 'Menue.raster(): Fläche stimmt nicht');
const kb = fs.statSync(path.join(ROOT, 'public', ME.TOKENS.BILD.datei)).size / 1024;
console.log(`Key-Art ${ME.TOKENS.BILD.datei}: ${Math.round(kb)} KB`);
ok(kb <= 350, 'Key-Art größer als 350 KB');

// Nacharbeit S3: render.js setzt die Marke nicht mit festen Zahlen, sondern aus den Tokens (MASS.ueberKopf / MASS.geduckt)
const renderSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'render.js'), 'utf8');
ok(!/crouch\s*\?\s*\d+\s*:\s*\d+/.test(renderSrc), 'render.js: Namensmarken-Höhe mit festen Zahlen (crouch ? n : m)');
ok(/Namensmarke\.TOKENS\.MASS/.test(renderSrc) && /M\.geduckt/.test(renderSrc) && /M\.ueberKopf/.test(renderSrc) &&(renderSrc.match(/markeHoehe\(/g) || []).length >= 2, 'render.js: Namensmarken-Höhe liest MASS.geduckt / MASS.ueberKopf');
console.log(fehler ? `${fehler} Fehler.` : 'Tokens Kleiderkammer, Startmenü, Namensmarke ok.');
process.exit(fehler ? 1 : 0);
