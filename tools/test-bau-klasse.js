'use strict';
// ORT-01 Integration: Asset-Klasse `bau` in check:assets (tools/asset-klassen.mjs).
//   Höhe bis 10 m, Budget je belegter Kachel (nicht Vertragsbudget Architekturmodul 3.000), keine `wall`-Behelfe mehr
//   in den ort-*.json, Mockup-Wände nicht im Spiel-Manifest, hohe Stücke tragen `bau`.
//   node tools/test-bau-klasse.js
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..');
let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

(async () => {
  const k = await import(pathToFileURL(path.join(ROOT, 'tools/asset-klassen.mjs')).href);
  console.log('[Klasse bau, rein]');
  ok(k.isBau({ tags: ['x', 'bau'] }) && !k.isBau({ tags: ['wall'] }) && !k.isBau({}), 'isBau nur über den Tag bau');
  ok(k.bauKacheln([8, 5]) === 40, 'Halle 8×5 = 40 Kacheln');
  ok(k.bauKacheln([8.5, 6]) === 51, 'Halle 8,5×6 = 51 Kacheln (aufgerundete Fläche)');
  ok(k.bauKacheln([1, 1.8]) === 2 && k.bauKacheln([1, 1]) === 1 && k.bauKacheln(undefined) === 1, 'Kleinstücke und fehlender Fuß');
  ok(k.bauBudget([8, 5]).n === 100000 && k.bauBudget([8, 5]).ziel === 60000, 'Budget 2.500 hart, 1.500 Ziel je Kachel');
  ok(k.bauBudget([1, 1]).n === 2500, 'Turm 1×1 höchstens 2.500');
  ok(k.bauHoehe(8.75) === 'ok' && k.bauHoehe(10) === 'ok' && k.bauHoehe(10.5) === 'fehler', 'Höhengrenze 10 m');

  console.log('[Manifeste ort-*.json]');
  const dir = path.join(ROOT, 'assets/manifest');
  const alle = [];
  for (const f of fs.readdirSync(dir).filter((f) => /^ort-.*\.json$/.test(f))) {
    for (const e of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).assets) alle.push({ ...e, datei: f });
  }
  ok(alle.length > 0, alle.length + ' Einträge in ort-*.json');
  ok(!alle.some((e) => (e.tags || []).includes('wall')), 'kein wall-Behelf in ort-*.json');
  ok(!alle.some((e) => /\/station\/wand(_hell)?$/.test(e.id)), 'Mockup-Wände (ort/*/station/wand, wand_hell) nicht im Spiel-Manifest');
  const hoch = alle.filter((e) => e.height > 2.2 && !(e.tags || []).includes('bau') && !(e.tags || []).includes('leit') && !/^rom\/(laterne|standarte)$/.test(e.id) && !/^kit\//.test(e.id));   // Kit-Teile folgen der Wandklasse des Checkers
  ok(hoch.length === 0, 'Stücke über 2,2 m tragen bau' + (hoch.length ? ': ' + hoch.map((e) => e.id).join(', ') : ''));
  const bauten = alle.filter((e) => (e.tags || []).includes('bau')).map((e) => e.id);
  for (const id of ['ort/rom/aussenposten/halle', 'ort/germanen/aussenposten/halle', 'ort/rom/aussenposten/sensorturm', 'ort/germanen/aussenposten/sensorturm', 'rom/standarte', 'rom/laterne']) {
    ok(bauten.includes(id), id + ' ist bau');
  }
  console.log(fails ? '\n' + fails + ' FEHLER' : '\nalle grün');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
