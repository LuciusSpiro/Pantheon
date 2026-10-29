// SUND-04b D (Designer): Tokens des Auftragsbretts (public/js/pult-auftrag-tokens.js) prüfen.
//  1. Spiegel: Funktionsfarben und Skin rom = pult.js, Kartenfarben und Fraktionsplaketten = karte-tokens.js, gemeinsame Flächen = pult-terminal-tokens.js
//  2. Kontrast nach WCAG 2.1: Text ≥ 4,5:1, Grafik ≥ 3:1. Gibt die Messwerte aus.
//  3. Geometrie: Karten und Detail liegen im Bereich, das Detail endet über der Infozeile (normal und „läuft“), Knopf „Brett“ links von Info/Kurs.
//  4. Hilfen: folge() (Objekt und Zeichenkette), verfall(), beats(), typText(), schritt().
// Aufruf: node tools/test-auftrag-tokens.js   (Exit 1 bei Fehlern)
'use strict';
const fs = require('fs');
const path = require('path');
const PA = require('../public/js/pult-auftrag-tokens.js');
const KT = require('../public/js/karte-tokens.js');
const { FARBE, MASS, FN, TEXT } = PA.TOKENS;

let fehler = 0, n = 0;
const ok = (b, msg) => { n++; if (!b) { fehler++; console.log('  FEHLER ' + msg); } };
const JS = path.join(__dirname, '..', 'public', 'js');

// 1. Spiegel
const pult = fs.readFileSync(path.join(JS, 'pult.js'), 'utf8');
const fnZeile = pult.match(/const FN = (\{[^}]+\});/);
ok(fnZeile, 'FN in pult.js nicht gefunden');
if (fnZeile) { const echt = Function('return ' + fnZeile[1])(); for (const k of Object.keys(echt)) ok(echt[k] === FN[k], `FN.${k}: pult.js ${echt[k]} ≠ Spiegel ${FN[k]}`); }
const rom = pult.split('SKINS.rom = {')[1] || '';
for (const [feld, rolle] of [['screenBg', 'grund'], ['text', 'text'], ['dim', 'dim'], ['ink', 'ink'], ['offLine', 'tagRand']]) {
  const m = rom.match(new RegExp('\\b' + feld + ": '(#[0-9A-Fa-f]{6})'"));
  ok(m && m[1] === FARBE[rolle], `Skin rom.${feld}: pult.js ${m && m[1]} ≠ ${rolle} ${FARBE[rolle]}`);
}
const term = fs.readFileSync(path.join(JS, 'pult-terminal-tokens.js'), 'utf8');
for (const [k, rolle] of [['kachel', 'kachel'], ['kachelZu', 'kachelZu'], ['trenner', 'trenner'], ['platzZu', 'leerBalken']]) {
  const m = term.match(new RegExp('\\n\\s+' + k + ": '(#[0-9A-Fa-f]{6})'"));
  ok(m && m[1] === FARBE[rolle], `PultTerminal ${k}: ${m && m[1]} ≠ ${rolle} ${FARBE[rolle]}`);
}
const sys = fs.readFileSync(path.join(JS, 'pult-systeme-tokens.js'), 'utf8').match(/zerText: '(#[0-9A-Fa-f]{6})'/);
ok(sys && sys[1] === FARBE.gefahrText, `PultSysteme zerText ${sys && sys[1]} ≠ gefahrText ${FARBE.gefahrText}`);
const P = KT.FARBE.pult;
ok(FARBE.gefahrHell === P.hell && FARBE.hudTitel === P.gold && FARBE.hudText === P.hell && FARBE.hudDim === P.stahlhell && FARBE.plaketteText === P.tisch, 'Kartenfarben (hell, gold, stahlhell, tisch) weichen von karte-tokens.js ab');
for (const [id, k] of [['rom', 'r'], ['ger', 'g'], ['kon', 'k']]) {
  const f = PA.fraktion(id), e = KT.FARBE.fraktion[k];
  ok(f.buchstabe === e.buchstabe && f.feld === e.haltung && f.name === e.name, `Plakette ${id}: ${JSON.stringify(f)} ≠ karte-tokens ${e.buchstabe}/${e.haltung}/${e.name}`);
}

// 2. Kontrast
const TXT = 4.5, GRAFIK = 3;
const fr = (id) => PA.fraktion(id).feld;
const paare = [
  ['text', 'kachel', TXT, 'Titel, Folgen auf Karte'], ['dim', 'kachel', TXT, 'Typ · Ort, Verfall auf Karte'], ['text', 'grund', TXT, 'Detail'], ['dim', 'grund', TXT, 'Anlass, Überschriften'],
  ['ink', 'angebot', TXT, 'gewählte Karte'], ['angebot', 'grund', TXT, 'AUFTRAGSBRETT, GERÜCHT'],
  ['laeuft', 'kachel', TXT, 'LÄUFT'], ['laeuft', 'grund', TXT, 'kostet nichts, ANGENOMMEN'],
  ['bald', 'kachel', TXT, 'verfällt bald (Karte)'], ['bald', 'grund', TXT, 'gesperrt, Absage, Frist'],
  ['gefahrText', 'kachel', TXT, 'GEFAHR auf Karte'], ['gefahrText', 'grund', TXT, 'GEFAHR im Detail'], ['dim', 'kachelZu', TXT, 'leer: Text'],
  [FARBE.plaketteText, fr('rom'), TXT, 'Plakette R'], [FARBE.plaketteText, fr('ger'), TXT, 'Plakette G'], [FARBE.plaketteText, fr('kon'), TXT, 'Plakette K'],
  [fr('rom'), 'kachel', GRAFIK, 'Plakette R auf Kachel'], [fr('ger'), 'kachel', GRAFIK, 'Plakette G auf Kachel'], [fr('kon'), 'kachel', GRAFIK, 'Plakette K auf Kachel'],
  ['gefahrRot', 'gefahrHell', GRAFIK, 'Bake: Streifen'], ['gefahrRot', 'kachel', GRAFIK, 'Bake: Rand auf Kachel'], ['beatOffen', 'kachel', GRAFIK, 'Beat offen (Rand)'], ['laeuft', 'kachel', GRAFIK, 'Beat fertig'],
  ['text', 'kappeGew', TXT, 'Nummernkappe auf der gewählten Karte'],
  ['hudTitel', 'ink', TXT, 'HUD Titel (Tisch, schlechtester Fall)'], ['hudText', 'ink', TXT, 'HUD Schritt'], ['hudDim', 'ink', TXT, 'HUD Frist'],
];
console.log('Kontrast (WCAG 2.1):');
for (const [a, b, min, rolle] of paare) {
  const k = PA.kontrast(a, b);
  console.log(`  ${k.toFixed(1).padStart(5)}:1  ${rolle}`);
  ok(k >= min, `Kontrast ${rolle}: ${k.toFixed(2)} < ${min}`);
}
// Plakette auf voller Messingfläche: der ink-Rahmen trägt die Grenze (Plakette G auf Messing ist zu schwach)
ok(PA.kontrast('ink', 'angebot') >= GRAFIK, 'ink-Rahmen um Plakette auf Messing');

// 3. Geometrie
const innen = (r, B) => r.x >= B.x && r.y >= B.y && r.x + r.w <= B.x + B.w && r.y + r.h <= B.y + B.h;
for (const lauf of [false, true]) {
  const L = PA.layout(lauf), B = L.bereich, D = L.detail, tag = lauf ? 'läuft' : 'normal';
  L.liste.forEach((r, i) => ok(innen(r, B), `${tag}: Karte ${i + 1} außerhalb des Bereichs ${JSON.stringify(r)}`));
  for (let i = 1; i < 3; i++) ok(L.liste[i].y >= L.liste[i - 1].y + L.liste[i - 1].h + 2, `${tag}: Karten ${i}/${i + 1} überlappen`);
  ok(D.x >= L.liste[0].x + L.liste[0].w + 8, `${tag}: Detail zu nah an der Liste`);
  ok(D.x + D.w <= B.x + B.w, `${tag}: Detail ragt rechts heraus`);
  ok(D.unten <= L.info.y - 4, `${tag}: Detail endet bei ${D.unten}, Infozeile beginnt bei ${L.info.y} (Trenner ${L.info.y - 3})`);
  ok(D.gefahr.y < D.schritte.y, `${tag}: GEFAHR muss vor den Schritten stehen`);
  ok(D.schritte.x + D.schritte.w < D.gelingt.x, `${tag}: Schritte und Folgen überlappen`);
  ok(D.scheitert.y >= D.gelingt.y + D.gelingt.h, `${tag}: Gelingt und Scheitert überlappen`);
  if (lauf) ok(L.laeuft.y + L.laeuft.h + 2 <= L.liste[0].y, 'läuft: Streifen überlappt die erste Karte');
}
ok(MASS.info.y + MASS.info.h <= 6 + 226 + 2, 'Infozeile endet unter der Anzeige');
ok(MASS.knopf.brett.x + MASS.knopf.brett.w <= 424 - 2, 'Knopf Brett reicht in den Knopf Info (x 424)');
ok(MASS.knopf.brett.x >= 266 + MASS.knopf.modulTitelW + 4, 'Knopf Brett liegt auf dem Titel MODULRAUM');

// 4. Hilfen
const f1 = PA.folge('Ruf Rom +1'), f2 = PA.folge('Haltung Germanen −2'), f3 = PA.folge({ f: 'kon', art: 'haltung', d: -1 }), f4 = PA.folge('Sigrid erinnert sich an Euch.'), f5 = PA.folge({ f: 'Konkordat', d: 3 });
ok(f1.marke && f1.marke.f === 'rom' && f1.marke.d === 1 && f1.marke.art === 'ruf', 'folge „Ruf Rom +1“ ' + JSON.stringify(f1));
ok(f2.marke && f2.marke.f === 'ger' && f2.marke.d === -2 && f2.marke.art === 'haltung', 'folge „Haltung Germanen −2“ ' + JSON.stringify(f2));
ok(f3.marke && f3.marke.f === 'kon' && f3.marke.d === -1, 'folge Objekt kon −1');
ok(!f4.marke && f4.text === 'Sigrid erinnert sich an Euch.', 'folge Text bleibt Text');
ok(f5.marke && f5.marke.f === 'kon' && f5.marke.d === 2, 'folge: Name statt Kürzel, Betrag auf 2 begrenzt');
ok(!PA.folge({ f: 'rom', d: 0 }).marke && !PA.folge(null).marke, 'folge ohne Änderung / leer: keine Marke');
ok(PA.pfeile(2) === '▲▲' && PA.pfeile(-1) === '▼', 'pfeile');
ok(PA.verfall(7).kurz === 'noch 7' && !PA.verfall(7).bald && PA.verfall(2).bald && PA.verfall(1).lang === TEXT.verfallEins && PA.verfall(undefined).n === 0, 'verfall');
ok(PA.beats(3, 4).join() === 'fertig,fertig,jetzt,offen' && PA.beats(9, 3).join() === 'fertig,fertig,jetzt' && PA.beats(null, null).join() === 'jetzt', 'beats');
ok(PA.typText(['geruecht', 'konvoi']) === 'Gerücht · Konvoi' && PA.typText(['neuartig']) === 'Neuartig' && PA.typText(null) === '', 'typText');
ok(PA.schritt('a').gefahr === false && PA.schritt({ text: 'b', gefahr: 1 }).gefahr === true, 'schritt');
ok(PA.fraktion('xyz').buchstabe === '-', 'unbekannte Fraktion -> neutral');
ok(PA.text('angenommenText', { titel: 'X' }) === 'Die Crew hat „X“ angenommen.', 'text-Vorlage');
// Keine Spielernamen und keine Farbnamen der Spieler in den festen Texten (Brett-Inhalt ist Crew-neutral)
ok(!/Blau|Orange|Pink|Spieler/.test(JSON.stringify(TEXT)), 'feste Texte nennen Spieler');

console.log(`${n} Prüfungen, ${fehler} Fehler.`);
process.exit(fehler ? 1 : 0);
