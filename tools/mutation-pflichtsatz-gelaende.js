'use strict';
// SPL-01 a1: Mutationsprobe zu tools/test-pflichtsatz-gelaende.js. Je Lauf wird EINE Stelle der Erzeuger geändert, der Test läuft dagegen und muss rot werden;
// danach wird die Originaldatei zurückgeschrieben (finally; ein Abbruch mit Strg-C kann die Änderung stehen lassen: dann `git checkout shared/`).
// --trocken: nur prüfen, dass die Texte in den Quellen vorkommen.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const trocken = process.argv.includes('--trocken');
const MUTATIONEN = [
  ['shared/gen-gelaende.js', 'deckung: 4, wache: 3 }', 'deckung: 4 }', 'wache fehlt im Pflichtsatz der Wildnis'],
  ['shared/gen-hoehle.js', 'deckung: 4, wache: 3, abbau: 4', 'deckung: 4, abbau: 4', 'wache fehlt im Pflichtsatz der Höhle'],
  ['shared/gen-gelaende.js', 'deckung: 4, wache: 3 }', 'deckung: 4, wache: 2 }', 'wache nur min 2 (Wildnis)'],
  ['shared/gen-hoehle.js', 'wache: 3, abbau: 4', 'wache: 2, abbau: 4', 'wache nur min 2 (Höhle)'],
  ['shared/gen-gelaende.js', 'deckung: 4, wache: 3 }', 'deckung: 4, wache: 9 }', 'Zusage wache 9 (Sweep unterschritten)'],
];
let ueberlebt = 0;
for (const [datei, alt, neu, was] of MUTATIONEN) {
  const p = path.join(ROOT, datei), orig = fs.readFileSync(p, 'utf8');
  if (!orig.includes(alt)) { console.log('FEHLT   ' + was + ' (' + datei + ')'); ueberlebt++; continue; }
  if (trocken) { console.log('ok      ' + was); continue; }
  let rot;
  try { fs.writeFileSync(p, orig.replace(alt, neu)); rot = spawnSync(process.execPath, [path.join(__dirname, 'test-pflichtsatz-gelaende.js')], { cwd: ROOT, encoding: 'utf8' }).status !== 0; }
  finally { fs.writeFileSync(p, orig); }
  console.log((rot ? 'getötet ' : 'ÜBERLEBT ') + was);
  if (!rot) ueberlebt++;
}
if (!trocken) console.log(ueberlebt ? `${ueberlebt} Mutation(en) überlebt` : 'alle Mutationen getötet');
process.exit(ueberlebt ? 1 : 0);
