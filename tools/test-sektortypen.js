#!/usr/bin/env node
// KAC-01 A: Test des Sektortypen-Katalogs (content/welt/sektortypen.json) und seines Laders (shared/sektortypen.js):
// Schema, alle Typen da, Fehlermeldungen per Mutation, landbare Planetenarten, Biom-Namen gegen GenGelaende.BIOME, Szenen-IDs gegen content/katalog.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const S = require('../shared/sektortypen.js');
const GenGelaende = require('../shared/gen-gelaende.js');

let fehler = 0, n = 0;
const pruefe = (name, f) => { n++; try { f(); console.log('✓ ' + name); } catch (e) { fehler++; console.log('✗ ' + name + ': ' + e.message); } };
const kopie = () => JSON.parse(JSON.stringify(S.katalog()));
const wirftMit = (f, teile) => assert.throws(f, (e) => { teile.forEach((t) => assert.ok(String(e.message).includes(t), `Meldung enthält nicht '${t}': ${e.message}`)); return true; });
const typVon = (k, id) => k.typen.find((t) => t.id === id);

const TYPEN = ['planet', 'gasriese', 'station', 'asteroidenfeld', 'grosser_asteroid', 'nebel', 'wrackfeld', 'leerraum', 'piratenlager', 'instabil'];

pruefe('Katalog besteht pruefe', () => assert.strictEqual(S.pruefe(S.katalog()), true));
pruefe('Biom-Liste des Laders identisch zu GenGelaende.BIOME', () => assert.deepStrictEqual(S.BIOME, GenGelaende.BIOME));
pruefe('Typenliste: genau die zehn Typen, in Reihenfolge', () => assert.deepStrictEqual(S.typen(), TYPEN));
for (const id of TYPEN) pruefe(`Typ ${id} vorhanden, istTyp und typ(id) liefern ihn`, () => { assert.ok(S.istTyp(id)); assert.strictEqual(S.typ(id).id, id); });
pruefe('istTyp: unbekannt, undefined und Nicht-String sind false', () => { assert.ok(!S.istTyp('gibtsnicht')); assert.ok(!S.istTyp(undefined)); assert.ok(!S.istTyp(7)); });
pruefe('instabil: Platzhalter, Anzeige "?", keine Ergebnistabelle', () => {
  const t = S.typ('instabil');
  assert.strictEqual(t.anzeige, '?'); assert.strictEqual(t.platzhalter, true);
  assert.deepStrictEqual(t.koerper, []); assert.deepStrictEqual(t.quelle, []); assert.deepStrictEqual(t.szenen, []);
});
pruefe('Raumszenen-Spannen bilden gen-sektor.js nach (Bojen 2..4, Brocken 24 / 14, Gasriese mit Zonen 480..640)', () => {
  const { STANDARD } = require('../shared/gen-sektor.js');
  for (const t of S.katalog().typen) assert.deepStrictEqual(t.szene.bojen, STANDARD.bojen, t.id);
  assert.deepStrictEqual(S.typ('asteroidenfeld').szene.brocken, [STANDARD.asteroiden.asteroiden, STANDARD.asteroiden.asteroiden]);
  assert.deepStrictEqual(S.typ('wrackfeld').szene.brocken, [STANDARD.asteroiden.truemmerstrom, STANDARD.asteroiden.truemmerstrom]);
  assert.strictEqual(S.typ('gasriese').szene.zonen, 'gasriese');
  assert.deepStrictEqual(S.typ('gasriese').koerper[0].radius, [480, 640]);
  assert.ok(S.typ('nebel').szene.nebel && !S.typ('leerraum').szene.nebel);
});
pruefe('grosser_asteroid: Kartenart hoehle ohne Biom, Zugang Transportpunkt', () => {
  const b = S.typ('grosser_asteroid').boden;
  assert.strictEqual(b.kartenart, 'hoehle'); assert.strictEqual(b.biom, null); assert.strictEqual(b.zugang, 'transportpunkt');
});
pruefe('gasriese, asteroidenfeld, nebel, leerraum: keine Landung, keine Kartenart', () => {
  for (const id of ['gasriese', 'asteroidenfeld', 'nebel', 'leerraum']) {
    const t = S.typ(id);
    assert.strictEqual(t.boden.kartenart, null, id);
    assert.ok(!t.koerper.some((k) => k.landbar), id);
  }
});
pruefe('landbare Koerper tragen beam.extra 200 (Radius + 200 wie die Erkundung)', () => {
  for (const t of S.katalog().typen) for (const k of t.koerper) if (k.landbar) assert.strictEqual(k.beam.extra, 200, `${t.id}.${k.id}`);
});
pruefe('Planet: 1 landbarer Planet plus 0..1 Kulisse', () => {
  const [haupt, kul] = S.typ('planet').koerper;
  assert.deepStrictEqual(haupt.anzahl, [1, 1]); assert.strictEqual(haupt.landbar, true);
  assert.deepStrictEqual(kul.anzahl, [0, 1]); assert.strictEqual(kul.landbar, false);
});
pruefe('landbar sind nur wueste, wiesenwald und vulkan', () => {
  const k = S.katalog().planetenarten;
  assert.deepStrictEqual(Object.keys(k).filter((a) => k[a].landbar).sort(), ['vulkan', 'wiesenwald', 'wueste']);
  for (const a of ['fels', 'eis', 'ozean']) { assert.strictEqual(S.planetenart(a).landbar, false); assert.strictEqual(S.planetenart(a).biom, null); }
});
pruefe('landbare Planetenarten verweisen auf ein Biom aus GenGelaende.BIOME', () => {
  for (const [a, d] of Object.entries(S.katalog().planetenarten)) if (d.landbar) assert.ok(GenGelaende.BIOME.includes(d.biom), `${a} -> ${d.biom}`);
});
pruefe('Gueter der Quellen nur T/M/U/E/N/R; Siedlung verarbeitet Erz zu U/E', () => {
  const alle = [];
  for (const t of S.katalog().typen) alle.push(...t.quelle);
  for (const a of Object.values(S.katalog().planetenarten)) alle.push(...a.quelle);
  for (const q of alle) assert.ok('TMUENR'.includes(q.gut), q.gut);
  assert.deepStrictEqual(S.katalog().koerperarten.siedlung.verarbeitet, [{ von: 'R', zu: ['U', 'E'] }]);
  assert.deepStrictEqual(S.typ('gasriese').quelle, [{ gut: 'T' }]);
  assert.strictEqual(S.typ('grosser_asteroid').quelle[0].menge, 'viel');
});
pruefe('Szenen-IDs existieren als content/katalog/szenentypen/<id>.json', () => {
  for (const t of S.katalog().typen) for (const id of t.szenen) assert.ok(fs.existsSync(path.join(__dirname, '..', 'content', 'katalog', 'szenentypen', id + '.json')), `${t.id}: ${id}`);
});
pruefe('Bestehende Karten tragen kein typ (unberührt)', () => {
  for (const f of ['limes', 'sund', 'sund_frei']) assert.ok(!/"typ"\s*:\s*"(planet|gasriese|station|asteroidenfeld|grosser_asteroid|nebel|wrackfeld|leerraum|piratenlager|instabil)"/.test(fs.readFileSync(path.join(__dirname, '..', 'content', 'welt', f + '.json'), 'utf8')), f);
});

// ---- Fehlermeldungen per Mutation ----
pruefe('typ(): unbekannter Typ -> Meldung nennt den Typ und die gültigen', () => wirftMit(() => S.typ('schwarzes_loch'), ["Sektortyp 'schwarzes_loch' unbekannt", 'gueltig:', 'planet', 'instabil']));
pruefe('typ(): undefined und leer -> "Sektortyp fehlt" mit gültigen Typen', () => {
  wirftMit(() => S.typ(undefined), ['Sektortyp fehlt', 'gueltig:', 'gasriese']);
  wirftMit(() => S.typ(''), ['Sektortyp fehlt']);
});
pruefe('planetenart(): unbekannt -> Meldung mit gültigen Arten', () => wirftMit(() => S.planetenart('gas'), ["Planetenart 'gas' unbekannt", 'wueste', 'ozean']));
pruefe('Mutation: kaputter Gütercode im Typ', () => { const k = kopie(); typVon(k, 'gasriese').quelle[0].gut = 'X'; wirftMit(() => S.pruefe(k), ["Typ 'gasriese'.quelle[0].gut", "'X'", 'T/M/U/E/N/R']); });
pruefe('Mutation: kaputter Gütercode in einer Planetenart', () => { const k = kopie(); k.planetenarten.vulkan.quelle[0].gut = 'Q'; wirftMit(() => S.pruefe(k), ["Planetenart 'vulkan'.quelle[0].gut", "'Q'"]); });
pruefe('Mutation: unbekannte Körperart', () => { const k = kopie(); typVon(k, 'station').koerper[0].art = 'mond'; wirftMit(() => S.pruefe(k), ["Typ 'station'.koerper[0].art", "'mond'"]); });
pruefe('Mutation: Spanne min > max (Körper)', () => { const k = kopie(); typVon(k, 'planet').koerper[0].anzahl = [3, 1]; wirftMit(() => S.pruefe(k), ["Typ 'planet'.koerper[0].anzahl", 'verkehrt']); });
pruefe('Mutation: Spanne min > max (Szene)', () => { const k = kopie(); typVon(k, 'wrackfeld').szene.brocken = [20, 5]; wirftMit(() => S.pruefe(k), ["Typ 'wrackfeld'.szene.brocken", 'verkehrt']); });
pruefe('Mutation: Spanne keine Zahlen', () => { const k = kopie(); typVon(k, 'nebel').szene.bojen = ['a', 'b']; wirftMit(() => S.pruefe(k), ["Typ 'nebel'.szene.bojen", 'Spanne']); });
pruefe('Mutation: Planetenart landbar ohne Biom', () => { const k = kopie(); k.planetenarten.wueste.biom = null; wirftMit(() => S.pruefe(k), ["Planetenart 'wueste'", 'landbar', 'Biom']); });
pruefe('Mutation: Planetenart landbar mit fremdem Biom', () => { const k = kopie(); k.planetenarten.eis.landbar = true; k.planetenarten.eis.biom = 'tundra'; wirftMit(() => S.pruefe(k), ["Planetenart 'eis'", "'tundra'"]); });
pruefe('Mutation: Planetenart-Verweis existiert nicht', () => { const k = kopie(); typVon(k, 'planet').koerper[0].arten.push('lava'); wirftMit(() => S.pruefe(k), ["Typ 'planet'.koerper[0].arten", "'lava'"]); });
pruefe('Mutation: landbarer Planet mit nicht landbarer Planetenart', () => { const k = kopie(); typVon(k, 'planet').koerper[0].arten.push('fels'); wirftMit(() => S.pruefe(k), ["Planetenart 'fels'", 'nicht landbar']); });
pruefe('Mutation: doppelter Körper', () => { const k = kopie(); const p = typVon(k, 'planet'); p.koerper.push(JSON.parse(JSON.stringify(p.koerper[1]))); wirftMit(() => S.pruefe(k), ["Typ 'planet'", "doppelter Koerper 'kulisse'"]); });
pruefe('Mutation: doppelte Typ-ID', () => { const k = kopie(); k.typen.push(JSON.parse(JSON.stringify(typVon(k, 'nebel')))); wirftMit(() => S.pruefe(k), ["Typ 'nebel'", 'doppelte Typ-ID']); });
pruefe('Mutation: Kartenart nicht in der Liste', () => { const k = kopie(); typVon(k, 'planet').boden.kartenart = 'dschungel'; wirftMit(() => S.pruefe(k), ["Typ 'planet'.boden.kartenart", "'dschungel'"]); });
pruefe('Mutation: Pflichtfeld fehlt', () => { const k = kopie(); delete typVon(k, 'leerraum').icon; wirftMit(() => S.pruefe(k), ["Typ 'leerraum'", "Pflichtfeld 'icon'"]); });
pruefe('Mutation: landbarer Körper ohne beam', () => { const k = kopie(); delete typVon(k, 'station').koerper[0].beam; wirftMit(() => S.pruefe(k), ["Typ 'station'.koerper[0].beam"]); });
pruefe('Mutation: Landung ohne Kartenart / Kartenart ohne Landung', () => {
  let k = kopie(); typVon(k, 'station').boden.kartenart = null; wirftMit(() => S.pruefe(k), ["Typ 'station'.boden.kartenart", 'landbar']);
  k = kopie(); typVon(k, 'nebel').boden.kartenart = 'wildnis'; wirftMit(() => S.pruefe(k), ["Typ 'nebel'.boden.kartenart", 'kein landbarer']);
});
pruefe('Mutation: nicht landbare Körperart als landbar markiert', () => { const k = kopie(); typVon(k, 'gasriese').koerper[0].landbar = true; wirftMit(() => S.pruefe(k), ["Typ 'gasriese'.koerper[0]", 'nicht landbar']); });
pruefe('leser(): mutierter Katalog wird beim Anlegen abgelehnt, gültiger funktioniert (Browser-Weg)', () => {
  const k = kopie(); typVon(k, 'planet').quelle = [{ gut: 'Z' }];
  wirftMit(() => S.leser(k), ["Typ 'planet'.quelle[0].gut"]);
  assert.strictEqual(S.leser(kopie()).typ('nebel').id, 'nebel');
});
pruefe('pruefe(): kein Objekt -> klare Meldung', () => wirftMit(() => S.pruefe(null), ['Katalog']));
pruefe('Determinismus: zwei Aufrufe liefern denselben Katalog', () => assert.deepStrictEqual(S.katalog(), kopie()));

console.log(`\n${n - fehler}/${n} Prüfungen grün`);
process.exit(fehler ? 1 : 0);
