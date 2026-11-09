#!/usr/bin/env node
// KAC-01 A0: Test des Raumszenen-Wächters (tools/hash-raumszenen.js): Vergleich gegen die Baseline plus Mutationsproben
// (eine Szene im Speicher verändern -> der Vergleich muss rot werden; feste Szene, generierte Szene, Leerraum).
'use strict';
const assert = require('assert');
const H = require('./hash-raumszenen.js');

let fehler = 0;
const pruefe = (name, f) => { try { f(); console.log('✓ ' + name); } catch (e) { fehler++; console.log('✗ ' + name + ': ' + e.message); } };
const soll = H.ladeBaseline().karten;
const ist = H.berechne();

pruefe('Baseline deckt alle drei Karten ab, je mit Hexen', () => {
  assert.deepStrictEqual(Object.keys(soll).sort(), H.KARTEN.slice().sort());
  for (const k of H.KARTEN) assert.ok(Object.keys(soll[k]).length > 0, k);
});
pruefe('Vergleich gegen die Baseline grün', () => assert.deepStrictEqual(H.vergleiche(ist, soll), []));
pruefe('zweiter Lauf im selben Prozess identisch', () => assert.deepStrictEqual(H.berechne(), ist));

// Je ein Hex der Art fest / gen / leer in limes suchen
const ziele = {};
H.berechne({ vorHash: (k, hex, ort, L, S) => {
  if (k !== 'limes') return;
  const h = S.hexDaten(hex);
  const a = !h ? 'leer' : h.gen ? 'gen' : ort && L.get(ort) ? 'fest' : 'ohne';
  if (!ziele[a]) ziele[a] = hex;
} });
for (const a of ['fest', 'gen', 'leer']) {
  pruefe(`Mutationsprobe ${a}: Szene verändert -> Vergleich rot und nennt genau dieses Hex`, () => {
    const hex = ziele[a];
    assert.ok(hex, 'kein Hex der Art ' + a + ' in limes');
    let szene = null;
    const mut = H.berechne({ vorHash: (k, h, ort, L) => {
      if (k !== 'limes' || h !== hex) return;
      szene = L.get(ort);
      assert.ok(szene && szene.scene, 'keine Szene');
      szene.scene.w += 1;
    } });
    if (szene) szene.scene.w -= 1;   // Probe hinterlässt nichts (feste Szenen sind Modul-Objekte)
    assert.ok(szene);
    assert.deepStrictEqual(H.vergleiche(mut, soll), ['limes/' + hex]);
  });
}
pruefe('nach den Mutationsproben wieder grün', () => assert.deepStrictEqual(H.vergleiche(H.berechne(), soll), []));
pruefe('fehlendes und zusätzliches Hex werden gemeldet', () => {
  const c = JSON.parse(JSON.stringify(ist));
  const hex = Object.keys(c.sund)[0];
  delete c.sund[hex]; c.sund['9999'] = 'x';
  assert.deepStrictEqual(H.vergleiche(c, soll).sort(), [`sund/${hex} (fehlt)`, 'sund/9999 (neu)']);
});
process.exit(fehler ? 1 : 0);
