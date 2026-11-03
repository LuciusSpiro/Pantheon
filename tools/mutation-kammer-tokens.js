'use strict';
// CHA-02 E1b: Mutationsprobe zu den Erstellungs-Prüfungen in tools/test-kammer-tokens.js (Ziffernblock 8/5/2, Blickwinkel der Livekacheln, Farbmuster in zwei Zeilen,
// Namensfeld unter den Kachelreihen, Statusfeld FRISUR, Kachelzahl). Schreibt je Lauf EINE geänderte Fassung von pult-kammer-tokens.js ins Temp-Verzeichnis (das Repo
// bleibt unberührt), lässt den Test dagegen laufen (KAMMER_TOKENS_DATEI) und verlangt, dass er rot wird. --trocken: nur prüfen, dass die Texte genau einmal vorkommen.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const QUELLE = fs.readFileSync(path.join(ROOT, 'public', 'js', 'pult-kammer-tokens.js'), 'utf8').replace(/\r\n/g, '\n');
const NM_QUELLE = fs.readFileSync(path.join(ROOT, 'public', 'js', 'namensmarke-tokens.js'), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-kt-'));
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true }); fs.mkdirSync(path.join(TMP, 'shared'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'shared', 'protocol.js'), path.join(TMP, 'shared', 'protocol.js'));
const trocken = process.argv.includes('--trocken');
// [alter Text, neuer Text, Beschreibung, Quelle (Standard: pult-kammer-tokens.js, 'nm' = namensmarke-tokens.js)]
const MUTATIONEN = [
  ["erstellung: { 8: 'frisur', 5: 'haar', 2: 'haut' },", "erstellung: { 8: 'frisur', 9: 'haar', 6: 'haut' },", 'Ziffernblock der Erstellung wieder 8/9/6'],
  ["erstellung: { 8: 'frisur', 5: 'haar', 2: 'haut' },", "erstellung: { 8: 'frisur', 5: 'haar', 2: 'haut', 4: 'gesicht' },", 'Erstellung bietet wieder ein Gesicht an'],
  ['kachelAnsicht: { frisur: { yaw: 0 }, kopf: { yaw: 0 } },', 'kachelAnsicht: { frisur: { yaw: 122 }, kopf: { yaw: 0 } },', 'Frisur-Kacheln wieder schräg von hinten'],
  ['kachelAnsicht: { frisur: { yaw: 0 }, kopf: { yaw: 0 } },', 'kachelAnsicht: { frisur: { yaw: 0 }, kopf: { yaw: 90 } },', 'Kopf-Kacheln von der Seite'],
  ['wahl: 2, proZeile: 6 }', 'wahl: 2, proZeile: 8 }', 'Haar-Muster in einer Zeile (ragen in die Spalte Charakter)'],
  ['x: x + m.label + (i % je) * (m.w + m.fuge), y: y + Math.floor(i / je) * (m.h + m.fuge)', 'x: x + m.label + i * (m.w + m.fuge), y', 'Muster laufen ohne Zeilenumbruch nach rechts'],
  ['namensfeld: { h: 13, unten: 20,', 'namensfeld: { h: 13, unten: 40,', 'Namensfeld überlappt die zweite Kachelreihe'],
  ['namensfeld: { h: 13, unten: 20,', 'namensfeld: { h: 13, unten: 8,', 'Namensfeld ragt unten aus der Anzeige'],
  ['unten: 20, w: 110,', 'unten: 20, w: 260,', 'Namensfeld so breit, dass der Hinweis nicht mehr passt'],
  ["{ l: 'FRISUR', fn: 'nav', w: 1.7 }", "{ l: 'FRISUR', fn: 'nav', w: 0.8 }", 'Statusfeld FRISUR zu schmal für den längsten Frisurennamen'],
  ['kachel: { x: 8, y: 6, titelH: 13, w: 72, bild: 62, text: 22, fuge: 6, spalten: 5, zeilen: 2,', 'kachel: { x: 8, y: 6, titelH: 13, w: 72, bild: 62, text: 22, fuge: 6, spalten: 4, zeilen: 2,', 'nur 8 Kacheln: die neun Frisuren passen nicht'],
  ['ueberKopf: 64, geduckt: 52,', 'ueberKopf: 52, geduckt: 40,', 'Namensmarke wieder auf 52: Crista und Hörner berühren die Marke', 'nm'],
  ['ueberKopf: 64, geduckt: 52,', 'ueberKopf: 64, geduckt: 40,', 'geduckte Marke nicht mehr 12 unter der stehenden', 'nm'],
  ['kopf: 48, pxJeMeterMin: 21, abstand: 2,', 'kopf: 44, pxJeMeterMin: 21, abstand: 2,', 'Kopfhöhe der Marken-Prüfung nicht mehr 35 Voxel', 'nm'],
  ['function musterHoehe(n) { const m = MASS.muster, z = musterZeilen(n); return z * m.h + (z - 1) * m.fuge; }', 'function musterHoehe(n) { const m = MASS.muster; return m.h; }', 'musterHoehe kennt nur eine Zeile'],
];
let ueberlebt = 0;
for (const [alt, neu, was, art] of MUTATIONEN) {
  const nm = art === 'nm', quelle = nm ? NM_QUELLE : QUELLE;
  const n = quelle.split(alt).length - 1;
  if (n !== 1) { console.log(`  FEHLER Text kommt ${n}× vor: ${was}`); ueberlebt++; continue; }
  if (trocken) { console.log('  ok (trocken) ' + was); continue; }
  const datei = path.join(TMP, nm ? 'public/js/namensmarke-tokens.js' : 'pult-kammer-tokens.js');
  fs.writeFileSync(datei, quelle.replace(alt, () => neu));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'test-kammer-tokens.js')], { env: Object.assign({}, process.env, nm ? { NAMENSMARKE_TOKENS_DATEI: datei } : { KAMMER_TOKENS_DATEI: datei }), encoding: 'utf8' });
  if (r.status === 0 || !/FEHLER/.test(r.stdout)) { ueberlebt++; console.log((r.status === 0 ? '  ÜBERLEBT ' : '  ABSTURZ (zählt nicht) ') + was); } else console.log('  erkannt  ' + was);
}
console.log(ueberlebt ? `${ueberlebt} Mutation(en) nicht erkannt.` : 'Alle Mutationen erkannt.');
process.exit(ueberlebt ? 1 : 0);
