#!/usr/bin/env node
// KAC-01 A0: Bitgleich-Wächter für Raumszenen. Je Karte (limes, sund, sund_frei) und je Hex im Raster (spalten x zeilen, auch Leerraum) ein sha1
// über die Raumszene, so wie das Spiel sie ausliefert. Gegen tools/fixtures/raumszenen-hash-baseline.json.
//
//   node tools/hash-raumszenen.js              Hashes je Karte+Hex ausgeben (Zahl je Karte)
//   node tools/hash-raumszenen.js --compare    vergleicht mit der Baseline (Exit 1 bei Abweichung, nennt die abweichenden Hexe)
//   node tools/hash-raumszenen.js --write      schreibt die Baseline neu (nur auf einem Stand, der als Referenz gelten soll!)
//
// Kanonischer Weg (wie das Spiel, server/sim/welt.js waehle + shared/locations.js get):
//   Sektoren.setzeKarte(<content/welt/<id>.json>)  -> Locations leitet links neu ab (beiKarte-Hook)
//   ort = Sektoren.ortVonHex(hex)                    -> Orts-ID aus der Karte, 'leer-<hex>' im Leerraum, null bei Hex ohne Raumszene
//   szene = Locations.get(ort)                       -> feste Szene aus locations.js | Sektoren.datenOrt (gen:true -> Shared_GenSektor.erzeuge)
//                                                       | Sektoren.leerraumOrt (Leerraum)
//   Hash = sha1(JSON.stringify(szene)) des ganzen Orts-Objekts (inkl. links und hex, die in Locations als Getter haengen).
//   Kein Ort oder Locations.get liefert null: Hash von "null" (auch das muss gleich bleiben).
// Strikt: JSON.stringify ohne Kanonisierung, also faellt auch eine geaenderte Schluesselreihenfolge auf. Die Karte wird vor jedem Hexraster frisch
// aus der Datei geladen (setzeKarte leert die Caches), das Ergebnis haengt nicht von der Reihenfolge der Karten ab.
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATEI = path.join(ROOT, 'tools', 'fixtures', 'raumszenen-hash-baseline.json');
const KARTEN = ['limes', 'sund', 'sund_frei'];
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
const pad2 = (n) => (n < 10 ? '0' : '') + n;

const kartenDoc = (id) => JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'welt', id + '.json'), 'utf8'));
const hexListe = (K) => { const o = []; for (let c = 1; c <= K.spalten; c++) for (let r = 1; r <= K.zeilen; r++) o.push(pad2(c) + pad2(r)); return o; };
const szeneHash = (Locations, ort) => {
  const s = ort ? Locations.get(ort) : null;
  return sha(JSON.stringify(s === undefined ? null : s));
};

// -> { <karte>: { <hex>: sha1 } }. Optional `vorHash(karte, hex, ort, Locations, Sektoren)` (Mutationsprobe des Tests, ändert Szenen im Speicher).
function berechne(opt) {
  const Sektoren = require(path.join(ROOT, 'shared/sektoren.js'));
  const Locations = require(path.join(ROOT, 'shared/locations.js'));
  const aus = {};
  for (const id of KARTEN) {
    const doc = kartenDoc(id);
    Sektoren.setzeKarte(doc);
    const m = {};
    for (const hex of hexListe(doc)) {
      const ort = Sektoren.ortVonHex(hex);
      if (opt && opt.vorHash) opt.vorHash(id, hex, ort, Locations, Sektoren);
      m[hex] = szeneHash(Locations, ort);
    }
    aus[id] = m;
  }
  return aus;
}

// -> Liste der Abweichungen 'karte/hex' (mit Zusatz ' (neu)' bzw. ' (fehlt)')
function vergleiche(ist, soll) {
  const ab = [];
  for (const k of new Set([...Object.keys(soll), ...Object.keys(ist)])) {
    const s = soll[k] || {}, i = ist[k] || {};
    for (const hex of Object.keys(s)) { if (!(hex in i)) ab.push(`${k}/${hex} (fehlt)`); else if (s[hex] !== i[hex]) ab.push(`${k}/${hex}`); }
    for (const hex of Object.keys(i)) if (!(hex in s)) ab.push(`${k}/${hex} (neu)`);
  }
  return ab;
}
const ladeBaseline = () => JSON.parse(fs.readFileSync(DATEI, 'utf8'));

module.exports = { berechne, vergleiche, ladeBaseline, KARTEN, DATEI };

if (require.main === module) {
  const modus = process.argv.includes('--write') ? 'write' : process.argv.includes('--compare') ? 'compare' : 'zeige';
  const ist = berechne();
  const zahl = () => KARTEN.map((k) => `${k}: ${Object.keys(ist[k]).length}`).join(', ');
  if (modus === 'write') {
    fs.writeFileSync(DATEI, JSON.stringify({ format: 'raumszenen-hash-baseline/1', stand: 'KAC-01 A0, main 6f7556a (vor jeder Aenderung an gen-sektor.js)', karten: ist }, null, 1) + '\n');
    console.log(`Baseline geschrieben (${zahl()}) -> ${path.relative(ROOT, DATEI)}`);
  } else if (modus === 'compare') {
    const soll = ladeBaseline().karten;
    const ab = vergleiche(ist, soll);
    for (const k of KARTEN) {
      const n = Object.keys(soll[k] || {}).length, mine = ab.filter((a) => a.startsWith(k + '/'));
      console.log(`${mine.length ? '✗' : '✓'} ${k}: ${n - mine.filter((a) => !a.includes(' (neu)')).length}/${n} gleich${mine.length ? ', abweichend: ' + mine.slice(0, 12).join(', ') + (mine.length > 12 ? ' …' : '') : ''}`);
    }
    process.exit(ab.length ? 1 : 0);
  } else {
    for (const k of KARTEN) for (const [hex, h] of Object.entries(ist[k])) console.log(`${k} ${hex} ${h}`);
    console.log(`(${zahl()})`);
  }
}
