#!/usr/bin/env node
// SCH-01 P4: Byte-Gleichheit der Schiffskarten (shared/gen-schiff.js) gegen tools/fixtures/sch01-hash-baseline.json.
//   node tools/hash-baseline-schiff.js --compare   vergleicht (Exit 1 bei Abweichung; hängt in npm test, schnell, ohne Browser)
//   node tools/hash-baseline-schiff.js --write     schreibt die Baseline neu
//
// Inhalt: sha1 über JSON.stringify(Rohkarte via Buehne.ausRaster({ spiel: true }).karte) für 10 Seeds (s * 977) x layout (schiff, rechteck)
//   x zustand (intakt, verfallen, umkaempft) = 60 Hashes. Bauweise germanen, Besitz rostmeute.
// Neu schreiben (--write) NUR nach einer bewussten Änderung der Schiffsgrammatik (Raumtypen, Pflichtsatz, Layouts, Zustandsregeln, Raster,
//   Anker): dann zugleich die bauversion 'gschiff1' in shared/gen-schiff.js anheben und den Grund in den Commit schreiben.
//   Eine Abweichung ohne solche Änderung (auch in shared/buehne.js, Kacheln, Legende) ist ein Fehler, kein Grund zum Neuschreiben.
// Außenposten und Station prüft weiterhin tools/hash-baseline.js (ort01-hash-baseline.json).
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATEI = path.join(ROOT, 'tools', 'fixtures', 'sch01-hash-baseline.json');
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
const LAYOUTS = ['schiff', 'rechteck'], ZUSTAENDE = ['intakt', 'verfallen', 'umkaempft'];

function berechne() {
  process.chdir(ROOT);
  const Buehne = require(path.join(ROOT, 'shared/buehne.js'));
  const GenSchiff = require(path.join(ROOT, 'shared/gen-schiff.js'));
  const G = GenSchiff.erzeuger();
  const karten = {};
  for (const layout of LAYOUTS) for (const zustand of ZUSTAENDE) for (let s = 1; s <= 10; s++) {
    const seed = s * 977;
    const roh = G.karteRoh(seed, { layout, zustand, id: 't', bauweise: 'germanen', besitz: 'rostmeute' });
    karten[`${layout}/${zustand}/${seed}`] = sha(JSON.stringify(Buehne.ausRaster(roh, { spiel: true }).karte));
  }
  return karten;
}

const schreibe = process.argv.includes('--write');
const ist = berechne();
if (schreibe) {
  fs.writeFileSync(DATEI, JSON.stringify({ format: 'sch01-hash-baseline/1', stand: 'SCH-01 P5 (Fallen, bauversion gschiff1)', karten: ist }, null, 1) + '\n');
  console.log(`Baseline geschrieben: ${Object.keys(ist).length} Schiffs-Hashes -> ${path.relative(ROOT, DATEI)}`);
  process.exit(0);
}
const soll = JSON.parse(fs.readFileSync(DATEI, 'utf8')).karten;
const ab = [...new Set([...Object.keys(soll), ...Object.keys(ist)])].filter((k) => soll[k] !== ist[k]);
const n = Object.keys(soll).length;
console.log(`${ab.length ? '✗' : '✓'} schiff: ${n - ab.length}/${n} gleich${ab.length ? ', abweichend: ' + ab.slice(0, 8).join(' ') + (ab.length > 8 ? ' …' : '') : ''}`);
process.exit(ab.length ? 1 : 0);
