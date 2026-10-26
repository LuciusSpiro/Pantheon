'use strict';
// ORT-01 Glut: Schalter für Leuchtflächen im Nebel des Krieges (public/js/voxel/glut.js, Verdrahtung in kit.js).
//   Nur Karten der Kartenart station/aussenposten mit den Bauweisen rom/germanen bekommen die Ausnahme.
//   Ruine, Schiff, andere Bauweisen und unbekannte Werte bleiben beim alten Verhalten.
//   Die Verdrahtung in kit.js prüft der Test als Text: Uniform, Shader-Bedingung, Aufruf mit Kartenart und Bauweise.
//   node tools/test-glut.js
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..');
let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

(async () => {
  const g = await import(pathToFileURL(path.join(ROOT, 'public/js/voxel/glut.js')).href);
  console.log('[Glut-Schalter, rein]');
  ok(g.glutAusnahme('station', 'rom') && g.glutAusnahme('station', 'germanen'), 'Station mit Rom und Germanen: Ausnahme an');
  ok(g.glutAusnahme('aussenposten', 'rom') && g.glutAusnahme('aussenposten', 'germanen'), 'Außenposten mit Rom und Germanen: Ausnahme an');
  ok(!g.glutAusnahme('ruine', 'rom') && !g.glutAusnahme('ruine', 'germanen'), 'Ruine bleibt aus');
  ok(!g.glutAusnahme('schiff', 'germanen') && !g.glutAusnahme('schiff', 'rom'), 'Schiff bleibt aus');
  ok(!g.glutAusnahme('station', 'neutral') && !g.glutAusnahme('station', 'test') && !g.glutAusnahme('station', 'vorlaeufer'), 'Station anderer Bauweisen bleibt aus');
  ok(!g.glutAusnahme(undefined, undefined) && !g.glutAusnahme('', 'rom') && !g.glutAusnahme('station', null), 'fehlende Angaben: aus');

  console.log('[Verdrahtung in kit.js]');
  const kit = fs.readFileSync(path.join(ROOT, 'public/js/voxel/kit.js'), 'utf8');
  ok(/import \{ glutAusnahme \} from '\.\/glut\.js';/.test(kit), 'kit.js importiert glutAusnahme aus glut.js');
  ok(/const mat = makeMaterial\(fogU, glutAusnahme\(k\.art, bw\)\);/.test(kit), 'Kartenmaterial bekommt den Schalter aus Kartenart und Bauweise');
  ok(/uniform float uGlutKeep;/.test(kit) && /sh\.uniforms\.uGlutKeep = \{ value: glut \? 1 : 0 \};/.test(kit), 'Uniform uGlutKeep wird deklariert und gesetzt');
  ok(/if \(uKitFogOn > 0\.5 && !\(uGlutKeep > 0\.5 && vEmit > 0\.5\)\) \{/.test(kit), 'Nebel-Schritt lässt Leuchtflächen aus, nur wenn der Schalter an ist');
  ok(/totalEmissiveRadiance \+= eC \* min\(1\.2, 1\.5 \/ eM\)/.test(kit), 'Emissionszweig unverändert');
  ok(/kit-emit-fog-4/.test(kit) && !/kit-emit-fog-3/.test(kit), 'Programm-Schlüssel neu (kit-emit-fog-4)');

  console.log(fails ? `\n${fails} Prüfung(en) fehlgeschlagen` : '\nAlle Prüfungen grün');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
