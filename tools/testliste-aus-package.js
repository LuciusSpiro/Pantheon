'use strict';
// Erzeugt tools/testliste.json aus den Ketten "check" und "test" in package.json (Reihenfolge erhalten).
// Aufruf: node tools/testliste-aus-package.js             (nur Vergleich, Exit 1 bei Abweichung)
//         node tools/testliste-aus-package.js --schreiben (Datei schreiben)
const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');
const LISTE = path.join(__dirname, 'testliste.json');

function erzeugen() {
  const pkg = JSON.parse(fs.readFileSync(path.join(WURZEL, 'package.json'), 'utf8'));
  const eintraege = [];
  const benutzt = new Map();
  const dubletten = [];
  for (const kette of ['check', 'test']) {
    for (const schritt of pkg.scripts[kette].split(' && ')) {
      const teile = schritt.trim().split(/\s+/);
      if (teile[0] !== 'node') throw new Error('Schritt ohne node: ' + schritt);
      const cmd = teile.slice(1);
      let id = path.basename(cmd[0]).replace(/\.m?js$/, '');
      if (cmd.length > 1) id += ' ' + cmd.slice(1).join(' ');
      if (benutzt.has(id)) {
        const n = benutzt.get(id) + 1;
        benutzt.set(id, n);
        const neu = id + '#' + n;
        dubletten.push(id + ' -> ' + neu);
        id = neu;
      } else benutzt.set(id, 1);
      eintraege.push({ id, kette, cmd });
    }
  }
  return { eintraege, dubletten };
}

const { eintraege, dubletten } = erzeugen();
// Eintrag je Zeile (kompakt, diff-freundlich)
const zeilen = '[\n' + eintraege.map(e => ' ' + JSON.stringify(e)).join(',\n') + '\n]\n';
if (dubletten.length) console.log('Dubletten umbenannt: ' + dubletten.join('; '));
if (process.argv.includes('--schreiben')) {
  fs.writeFileSync(LISTE, zeilen);
  console.log('testliste.json geschrieben: ' + eintraege.length + ' Schritte');
} else {
  const alt = fs.existsSync(LISTE) ? fs.readFileSync(LISTE, 'utf8') : null;
  if (alt === zeilen) console.log('testliste.json stimmt mit package.json ueberein (' + eintraege.length + ' Schritte)');
  else { console.log('ABWEICHUNG: testliste.json passt nicht zu package.json (--schreiben zum Erzeugen)'); process.exit(1); }
}
