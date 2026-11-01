'use strict';
// CHA-01 F: Mutationsprobe zu tools/test-namensmarke-stapel.js. Schreibt je Lauf EINE geänderte Fassung von namensmarke-tokens.js ins Temp-Verzeichnis
// (das Repo bleibt unberührt), lässt den Test dagegen laufen (NM_DATEI) und verlangt, dass er rot wird. --trocken: nur prüfen, dass die Texte vorkommen.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const QUELLE = fs.readFileSync(path.join(ROOT, 'public', 'js', 'namensmarke-tokens.js'), 'utf8');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-nm-'));
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true }); fs.mkdirSync(path.join(TMP, 'shared'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'shared', 'protocol.js'), path.join(TMP, 'shared', 'protocol.js'));
const trocken = process.argv.includes('--trocken');
const MUTATIONEN = [
  ['return a.x < b.x + b.w + luecke && b.x < a.x + a.w + luecke && a.y < b.y + b.h + luecke && b.y < a.y + a.h + luecke;', 'return false;', 'Schnitt wird nie erkannt (Marken überdecken sich)'],
  ['a.x < b.x + b.w + luecke &&', 'a.x < b.x + b.w &&', 'Lücke gilt nur auf einer Seite'],
  ['a.y < b.y + b.h + luecke && b.y < a.y + a.h + luecke', 'a.y < b.y + b.h && b.y < a.y + a.h', 'Lücke zählt nicht'],
  ['if (jetztMs - tiefer < S.haltenMs) z = vz;   // Halten', 'if (false) z = vz;', 'Flackerschutz: sofort in die tiefere Zeile'],
  ['tiefer = v.tiefer != null ? v.tiefer : jetztMs;', 'tiefer = jetztMs;', 'Flackerschutz: Frist beginnt in jedem Frame neu (wechselt nie)'],
  ['const vzFrei = vz >= S.max || zeileFrei(mk, vz);', 'const vzFrei = true;', 'Flackerschutz hält auch eine belegte Zeile'],
  ['andere.sort((a, b) => (b.y - a.y) || (a.x - b.x));', 'andere.sort((a, b) => (a.y - b.y) || (a.x - b.x));', 'Bildschirm-y aufsteigend statt absteigend'],
  ['andere.sort((a, b) => (b.y - a.y) || (a.x - b.x));', 'andere.sort((a, b) => (b.y - a.y) || (b.x - a.x));', 'bei gleichem y rechts zuerst'],
  ['stielH: MASS.stiel.h + z * S.zeile, nurForm: false', 'stielH: MASS.stiel.h, nurForm: false', 'Stiel wächst nicht mit der Zeile'],
  ['dy: -z * S.zeile,', 'dy: -z * S.zeile - 1,', 'Zeilenversatz stimmt nicht'],
  ['max: 3, haltenMs', 'max: 4, haltenMs', 'eine Zeile mehr als vereinbart (Token)'],
  ['if (z < 0 || z >= S.max) {', 'if (z < 0) {', '„nur Form“ greift bei gehaltenem nurForm nicht'],
  ['const eigene = marken.filter((mk) => mk.eigen), andere = marken.filter((mk) => !mk.eigen);', 'const eigene = [], andere = marken.slice();', 'eigene Marke wird nicht zuerst gesetzt'],
  ['gesetzt = (hindernisse || []).slice();', 'gesetzt = [];', 'Gegnernamen werden ignoriert'],
];
let ueberlebt = 0;
for (const [alt, neu, was] of MUTATIONEN) {
  const n = QUELLE.split(alt).length - 1;
  if (n !== 1) { console.log(`  FEHLER Text kommt ${n}× vor: ${was}`); ueberlebt++; continue; }
  if (trocken) { console.log('  ok (trocken) ' + was); continue; }
  const datei = path.join(TMP, 'public', 'js', 'namensmarke-tokens.js');
  fs.writeFileSync(datei, QUELLE.replace(alt, () => neu));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'test-namensmarke-stapel.js')], { env: Object.assign({}, process.env, { NM_DATEI: datei }), encoding: 'utf8' });
  if (r.status === 0) { ueberlebt++; console.log('  ÜBERLEBT ' + was); } else console.log('  erkannt  ' + was);
}
console.log(ueberlebt ? `${ueberlebt} Mutation(en) nicht erkannt.` : 'Alle Mutationen erkannt.');
process.exit(ueberlebt ? 1 : 0);
