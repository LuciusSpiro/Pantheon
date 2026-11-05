#!/usr/bin/env node
'use strict';
// GEL-02 C: Basis-Fixture der Wildnis OHNE Höhle (sha1 je Karte). Die Fixture wurde VOR der Option `hoehle` aus dem damaligen Erzeuger erzeugt;
// `node tools/wildnis-basis-fixture.js --schreiben` erzeugt sie neu (nur bewusst tun, wenn sich die Wildnis absichtlich ändert).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Gelaende = require('../shared/gen-gelaende.js');
const DATEI = path.join(__dirname, 'fixtures', 'wildnis-basis.json');
const VARIANTEN = [{}, { dichte: 0.8 }, { fundorte: 3 }, { gegner: 1 }, { dichte: 0.2, fundorte: 4, gegner: 'keine' }, { gegner: 4 }];
function fall() {
  const o = [];
  for (const biom of Gelaende.BIOME) for (const groesse of ['klein', 'mittel', 'gross']) for (let i = 0; i < 40; i++) {
    const seed = 1000 + i * 37, opts = Object.assign({ biom, groesse }, VARIANTEN[i % VARIANTEN.length]);
    o.push({ k: `${biom}/${groesse}/${seed}/${JSON.stringify(VARIANTEN[i % VARIANTEN.length])}`, seed, opts });
  }
  return o;
}
function hashe(seed, opts) {
  let s;
  try { s = JSON.stringify(Gelaende.erzeuger().karteRoh(seed, opts)); } catch (e) { s = 'WURF:' + e.message; }
  return crypto.createHash('sha1').update(s).digest('hex');
}
function berechne() { const out = {}; for (const f of fall()) out[f.k] = hashe(f.seed, f.opts); return out; }
module.exports = { fall, hashe, berechne, DATEI };
if (require.main === module && process.argv.includes('--schreiben')) {
  const out = berechne();
  fs.writeFileSync(DATEI, JSON.stringify(out, null, 1) + '\n');
  console.log(Object.keys(out).length + ' Karten nach ' + DATEI);
}
