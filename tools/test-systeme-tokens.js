// SYS-01 Designer: Tokens der Systemanzeige (public/js/pult-systeme-tokens.js) prüfen.
//  1. Spiegel der Funktionsfarben und Skins = pult.js (sonst laufen Node-Test und Browser auseinander)
//  2. Kontrast nach WCAG 2.1: Text ≥ 4,5:1, Grafik (Pips, Schild, Bresche) ≥ 3:1, in beiden Skins. Gibt die Messwerte aus.
//  3. Kreuz-Geometrie: Kacheln überlappen nicht, liegen im Rahmen, Mitte hat Platz.
// Aufruf: node tools/test-systeme-tokens.js   (Exit 1 bei Fehlern)
'use strict';
const fs = require('fs');
const path = require('path');
const PS = require('../public/js/pult-systeme-tokens.js');
const { FARBE, MASS, FN } = PS.TOKENS;

let fehler = 0;
const ok = (b, msg) => { if (!b) { fehler++; console.log('  FEHLER ' + msg); } };

// 1. Spiegel
const pult = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pult.js'), 'utf8');
const fnZeile = pult.match(/const FN = (\{[^}]+\});/);
ok(fnZeile, 'FN in pult.js nicht gefunden');
if (fnZeile) { const echt = Function('return ' + fnZeile[1])(); for (const k of Object.keys(echt)) ok(echt[k] === FN[k], `FN.${k}: pult.js ${echt[k]} ≠ Spiegel ${FN[k]}`); }
for (const [skin, feld] of [['rom', 'screenBg'], ['rom', 'text'], ['rom', 'dim'], ['rom', 'off'], ['rom', 'offLine'], ['rom', 'ink'], ['germanen', 'screenBg'], ['germanen', 'text'], ['germanen', 'dim'], ['germanen', 'plate'], ['germanen', 'iron']]) {
  const blk = pult.split('SKINS.' + skin + ' = {')[1] || '';
  const m = blk.match(new RegExp('\\b' + feld + ": '(#[0-9A-Fa-f]{6})'"));
  const sp = feld === 'plate' || feld === 'iron' ? PS.farben('germanen')[feld === 'plate' ? 'kachel' : 'kachelRand'] : PS.farben(skin)[{ screenBg: 'grund', text: 'text', dim: 'dim', off: 'schildLeer', offLine: 'schildLeerRand', ink: 'ink' }[feld]];
  ok(m && m[1] === sp, `Skin ${skin}.${feld}: pult.js ${m && m[1]} ≠ Spiegel ${sp}`);
}

// 2. Kontrast: [Vordergrund, Hintergrund, Mindestwert, Rolle]
const TEXT = 4.5, GRAFIK = 3;
const paare = [
  ['text', 'kachel', TEXT, 'Systemname heil'], ['dim', 'kachel', TEXT, 'Beschriftung, Systeme hinter ZU'], ['besch', 'kachel', TEXT, 'beschädigt (Pips/Text)'],
  ['zerText', 'kachel', TEXT, 'zer. / zerstört auf Kachel'], ['zerText', 'kachelLeer', TEXT, 'LEER auf leerer Zone'], ['zerText', 'kachelReaktor', TEXT, 'REAKTOR auf Reaktor-Kachel'],
  ['zerText', 'grund', TEXT, 'ZU auf Grund-Fleck'], ['text', 'kachelReaktor', TEXT, 'Countdown-Zahl groß'], ['text', 'kachelLeer', TEXT, 'Name zerstört (Creme) in leerer Zone'],
  ['systemziel', 'systemzielZeile', TEXT, 'Systemziel auf Zeile'], ['zerText', 'systemzielZeile', TEXT, 'zer. auf Zeile des Systemziels'], ['text', 'systemzielZeile', TEXT, 'Name auf Zeile des Systemziels'], ['gezielt', 'gezieltZeile', TEXT, 'gezielter Treffer auf Zeile'], ['systemziel', 'kachel', TEXT, 'Systemziel ohne Zeile'],
  ['banderoleText', 'banderole', TEXT, 'Banderole Text'], ['banderoleAblauf', 'banderoleSpur', GRAFIK, 'Banderole Ablauf'],
  ['cdText', 'cdFlaeche', TEXT, 'Cooldown Sekunden'], ['cdBesch', 'cdFlaeche', TEXT, 'Cooldown Sekunden, Waffe beschädigt'], ['ink', 'bereit', TEXT, 'Waffe bereit'],
  ['ink', 'statusVoll', TEXT, 'Statusfeld ZONEN VOLL'], ['ink', 'statusBesch', TEXT, 'Statusfeld BB 2/4'], ['ink', 'statusReaktor', TEXT, 'Statusfeld REAKTOR'],
  ['zer', 'kachel', GRAFIK, 'zerstört als Grafik'], ['zer', 'kachelLeer', GRAFIK, 'gestrichelter Rand leere Zone'], ['pipLeer', 'kachel', GRAFIK, 'verlorener Pip'], ['offline', 'kachel', GRAFIK, 'Pip offline'],
  ['schild', 'kachel', GRAFIK, 'Schildsegment'], ['schild', 'grund', GRAFIK, 'Schildsegment am Rand'], ['wandGegner', 'kachel', GRAFIK, 'offene Wand Gegner'], ['wandEigen', 'kachel', GRAFIK, 'offene Wand eigen'],
];
// Statusleiste: rom = ink auf voller Fläche, germanen = Farbe als Text auf der Platte (pult.js SKINS.*.status)
const STATUS = { rom: (k) => ['ink', k], germanen: (k) => [k, 'kachel'] };
const KARTE = FARBE.karteGrund;   // Grund der Taktikkarte (render.js PAL.space)
const fmt = (v) => v.toFixed(2).replace('.', ',');
for (const skin of ['rom', 'germanen']) {
  const F = PS.farben(skin);
  console.log(`Skin ${skin}:`);
  const status = ['statusVoll', 'statusBesch', 'statusOffen', 'statusReaktor'].map((k) => STATUS[skin](k).concat([TEXT, 'Statusfeld ' + k]));
  for (const [a, b, min, rolle] of paare.filter((p) => !/^Statusfeld/.test(p[3])).concat(status)) {
    const v = PS.kontrast(F[a], F[b]);
    console.log(`  ${fmt(v).padStart(6)}:1  ${(a + ' auf ' + b).padEnd(30)} ${rolle}${v < min ? '   < ' + min : ''}`);
    ok(v >= min, `${skin}: ${a} auf ${b} ${fmt(v)}:1 < ${min}:1 (${rolle})`);
  }
}
for (const [k, min] of [['brescheGegner', GRAFIK], ['brescheEigen', GRAFIK]]) { const v = PS.kontrast(FARBE[k], KARTE); console.log(`  ${fmt(v).padStart(6)}:1  ${k} auf Karte`); ok(v >= min, `${k} auf Karte ${fmt(v)}`); }
// Belegt die Anhebung: FN.weapon als Text läge unter AA
const alt = PS.kontrast(FN.weapon, FARBE.kachel);
console.log(`  zum Vergleich FN.weapon als Text auf Kachel: ${fmt(alt)}:1 (darum zerText)`);
ok(alt < TEXT, 'Vergleichswert erwartet < 4,5');

// 3. Geometrie
for (const [st, m] of Object.entries(MASS.kreuz)) {
  const b = { x: 0, y: 0, w: m.w > 0 ? m.w : MASS.zielKastenW + m.w, h: m.h };
  const L = PS.lage(b, m), ks = Object.values(L);
  for (const k of ks) ok(k.w > 0 && k.h > 0 && k.x >= 0 && k.y >= 0 && k.x + k.w <= b.w && k.y + k.h <= b.h, `${st}: Kachel außerhalb ${JSON.stringify(k)}`);
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) { const p = ks[i], q = ks[j]; ok(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y, `${st}: Kacheln überlappen`); }
  ok(L.mitte.h >= 2 * m.schild + 6, `${st}: Mitte zu flach (${L.mitte.h})`);
}
ok(PS.zustand(0, 4) === 'zer' && PS.zustand(2, 4) === 'besch' && PS.zustand(3, 4) === 'ok' && PS.zustand(8, 8, true) === 'offline', 'zustand()');

console.log(fehler ? `${fehler} Fehler.` : 'Tokens Systemanzeige ok.');
process.exit(fehler ? 1 : 0);
