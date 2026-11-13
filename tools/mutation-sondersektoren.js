'use strict';
// SON-01 A: Mutationsprobe zu tools/test-sondersektoren.js. Schreibt je Lauf EINE geänderte Fassung von content/welt/sondersektoren.json ins Temp-Verzeichnis (das Repo bleibt
// unberührt), lässt den Test dagegen laufen (SONDERSEKTOREN_DATEI) und verlangt, dass er rot wird. --trocken: nur prüfen, dass die Texte genau einmal vorkommen.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const QUELLE = fs.readFileSync(path.join(ROOT, 'content', 'welt', 'sondersektoren.json'), 'utf8').replace(/\r\n/g, '\n');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-sond-'));
const trocken = process.argv.includes('--trocken');
// [alter Text, neuer Text, Beschreibung]
const MUTATIONEN = [
  ['"hex": "0506",', '"hex": "0107",', 'hex ist Leerraum (nicht spielbar, kein Kartensystem)'],
  ['"von": "0605",', '"von": "0705",', 'von ist kein geometrischer Nachbar von hex'],
  ['"buch": "sl_forschung",', '"buch": "sl_forschung_fehlt",', 'buch fehlt im Regiebuch-Katalog'],
  ['"hex": "0505",', '"hex": "0507",', 'ausgang.hex ohne Szene (Leerraum)'],
  ['"hex": "0505",', '"hex": "0506",', 'ausgang.hex ist der Sondersektor selbst'],
  ['"erreichbar_max": 3', '"erreichbar_max": 0', 'erreichbar_max unter 1'],
  ['"einmal": "bei_erfolg",', '"einmal": "immer",', 'einmal mit unbekanntem Wert'],
  ['"id": "helix",', '"id": "Helix 1",', 'id kein Name'],
  ['"verlust": "Hier Helix. Die Messreihe ist verloren. Meldet euch, wenn ihr es noch einmal versucht."', '"verlust": ""', 'Funkzeile Verlust leer'],
];
let ueberlebt = 0;
for (const [alt, neu, was] of MUTATIONEN) {
  const n = QUELLE.split(alt).length - 1;
  if (n !== 1) { console.log(`  FEHLER Text kommt ${n}× vor: ${was}`); ueberlebt++; continue; }
  if (trocken) { console.log('  ok (trocken) ' + was); continue; }
  const datei = path.join(TMP, 'sondersektoren.json');
  fs.writeFileSync(datei, QUELLE.replace(alt, () => neu));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'test-sondersektoren.js')], { env: Object.assign({}, process.env, { SONDERSEKTOREN_DATEI: datei }), encoding: 'utf8' });
  if (r.status === 0 || !/FEHLER/.test(r.stdout)) { ueberlebt++; console.log((r.status === 0 ? '  ÜBERLEBT ' : '  ABSTURZ (zählt nicht) ') + was); } else console.log('  erkannt  ' + was);
}
console.log(ueberlebt ? `${ueberlebt} Mutation(en) nicht erkannt.` : 'Alle Mutationen erkannt.');
process.exit(ueberlebt ? 1 : 0);
