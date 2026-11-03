'use strict';
// Haengt fehlende Schritte einer alten "&&"-Kette an tools/testliste.json an (Stufe full, Kette test) und gibt sie aus.
// Zweck: Branches, die noch Schritte in die alte Kette in package.json eingetragen haben, nach einem Merge nachziehen.
// Aufruf: node tools/testliste-ergaenzen.js --kette "node tools/test-a.js && node tools/test-b.js" [--name check|test]
//         node tools/testliste-ergaenzen.js --datei <textdatei mit der Kette>
// Optional --liste <datei.json> (andere Liste, z. B. eine Kopie zum Ausprobieren).
// Vorhanden = gleiches cmd (Argumentliste). IDs wie im Runner: Dateiname ohne .js, plus Argumente.
const fs = require('fs');
const path = require('path');
const io = require('./testliste-io');

function argWert(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

let kette = argWert('--kette');
const datei = argWert('--datei');
if (!kette && datei) kette = fs.readFileSync(datei, 'utf8');
if (!kette) { console.error('Aufruf: node tools/testliste-ergaenzen.js --kette "<kette>" | --datei <datei> [--name check|test]'); process.exit(2); }
const name = argWert('--name') || 'test';

const LISTE = path.resolve(argWert('--liste') || io.STANDARD);
const doc = io.lesen(LISTE);
const liste = doc.schritte;
const ids = new Set(liste.map(e => e.id));
const cmds = new Set(liste.map(e => JSON.stringify(e.cmd)));
const neu = [];
for (const schritt of kette.split('&&').map(s => s.trim()).filter(Boolean)) {
  const teile = schritt.split(/\s+/);
  if (teile[0] !== 'node') { console.error('Schritt ohne node uebersprungen: ' + schritt); continue; }
  const cmd = teile.slice(1);
  if (cmds.has(JSON.stringify(cmd))) continue;
  let id = path.basename(cmd[0]).replace(/\.m?js$/, '');
  if (cmd.length > 1) id += ' ' + cmd.slice(1).join(' ');
  for (let n = 2, basis = id; ids.has(id); n++) id = basis + '#' + n;
  ids.add(id); cmds.add(JSON.stringify(cmd));
  neu.push({ id, kette: name, cmd, stufe: 'full' });
}
if (!neu.length) { console.log('Nichts zu ergaenzen: alle Schritte stehen schon in testliste.json'); process.exit(0); }
doc.schritte = liste.concat(neu);
io.schreiben(LISTE, doc);
console.log(neu.length + ' Schritt(e) ergaenzt (Stufe full, Kette ' + name + '):');
for (const e of neu) console.log('  ' + e.id);
console.log('Stufe ggf. anpassen (fast/slow). Budget (budget_s) fehlt noch: seriell messen (node tools/run-tests.js --seriell --nur <id> --ausgabe <datei>) und node tools/testliste-budgets.js --aus <datei> --schreiben.');
