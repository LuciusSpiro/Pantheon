'use strict';
// LAD-01 F2: Frachtraum-Darstellung. Ohne Browser prüfbar: Belegung -> Darstellungsschlüssel je Platz (8 Arten, leer, Personen-Modul),
// Fallback für unbekannte Ware und fehlenden Katalog, Füllstufen 1..4 Plätze, 2D-Tabelle (art.js) deckt alle Schlüssel ab,
// Manifest-Eintrag lerche/furn/ladeplatz und die Dateien der neun Varianten im Spiel (public/voxel/assets).
const fs = require('fs');
const path = require('path');
const Maps = require('../shared/maps.js');
const Waren = require('../shared/waren.js');
const daten = require('../content/waren.json');

const ROOT = path.join(__dirname, '..');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const raum = Maps.CARGO_PLAETZE[0].raum;
const plaetze = Maps.CARGO_PLAETZE.filter((p) => p.raum === raum);
// Darstellung des Platzes nr (0..3) bei dieser Ladung, Frachtraum im Raum `raum`
const dar = (lager, pers, nr) => { const b = Maps.frachtBelegung([raum], lager, pers); const p = plaetze[nr]; return Waren.platzDarstellung(Maps.frachtPlatzAn(b, p.x, p.y)); };

console.log('\n[Abbildung Ware -> Darstellung]');
const ERWARTET = { fracht: 'kiste', waffen: 'waffenkiste', erz: 'erzbrocken', bergungsgut: 'schrott', deuterium: 'fass', sprengstoff: 'sprengkiste', hilfsgueter: 'kiste_med' };
for (const [art, d] of Object.entries(ERWARTET)) ok(dar([art], 0, 0) === d, art + ' -> ' + d);
ok(dar([], 2, 0) === 'bett' && dar([], 2, 3) === 'bett', 'Personen-Modul: alle vier Plätze bett');
ok(dar([], 0, 0) === 'leer', 'leerer Platz -> leer');
ok(Waren.platzDarstellung(null) === 'leer', 'kein belegbarer Platz -> leer');
ok(Object.keys(ERWARTET).length + 1 === daten.waren.length, 'acht Arten im Katalog (7 Waren + Person)');
for (const w of daten.waren) ok(w.id === 'person' ? w.darstellung === 'bett' : ERWARTET[w.id] === w.darstellung, 'waren.json: ' + w.id + ' hat darstellung ' + w.darstellung);

console.log('\n[Fallback]');
ok(dar(['gibtesnicht'], 0, 0) === 'kiste', 'unbekannte Ware (Testware ohne Optik) -> kiste');
Waren.registrieren({ id: 'testware_x', name: 'X', grundpreis: 1, gewicht: 0, eigenschaften: [], darstellung: 'erzbrocken', kategorie: 'ware' });
ok(dar(['testware_x'], 0, 0) === 'erzbrocken', 'neue Ware nutzt vorhandenen Schlüssel ohne Codeänderung');
Waren.entfernen('testware_x');
Waren.setze({ waren: [] });   // fetch noch nicht zurück
ok(dar(['waffen'], 0, 0) === 'kiste', 'Katalog nicht geladen -> kiste');
ok(dar([], 1, 0) === 'bett' && dar([], 0, 0) === 'leer', 'ohne Katalog bleiben bett und leer');
Waren.setze(daten);

console.log('\n[Füllstufen]');
for (let k = 1; k <= 4; k++) {
  const lager = Array(k).fill('erz');
  const ds = [0, 1, 2, 3].map((i) => dar(lager, 0, i));
  ok(ds.filter((d) => d === 'erzbrocken').length === k && ds.filter((d) => d === 'leer').length === 4 - k, k + ' Erz: ' + k + ' belegt, ' + (4 - k) + ' leer (' + k * 25 + ' %)');
  ok(ds.slice(0, k).every((d) => d === 'erzbrocken'), k + ' Erz: belegte Plätze zuerst');
}
// zweiter Frachtraum: Typ-Regel, anderes Modul zeigt andere Ware
const zweiRaeume = [Maps.CARGO_PLAETZE[0].raum, Maps.CARGO_PLAETZE[4].raum];
const b2 = Maps.frachtBelegung(zweiRaeume, ['erz', 'waffen'], 0);
const art = (m) => b2.module[m].plaetze.map((p) => Waren.platzDarstellung({ modulArt: b2.module[m].art, art: p.art }));
ok(art(0)[0] === 'erzbrocken' && art(0)[1] === 'leer' && art(1)[0] === 'waffenkiste', 'zwei Module: je Modul eine Art, Rest leer');

console.log('\n[2D-Tabelle]');
const src = fs.readFileSync(path.join(ROOT, 'public/js/art.js'), 'utf8');
const m = /var CARGO_DARSTELLUNG = (\{[\s\S]*?\n  \});/.exec(src);
ok(!!m, 'art.js: Tabelle CARGO_DARSTELLUNG gefunden');
const tab = m ? new Function('return ' + m[1])() : {};
for (const d of Object.values(ERWARTET)) ok(Array.isArray(tab[d]) && tab[d].length === 5, '2D: Darstellung ' + d + ' hat Farben und Zeichen');
ok(new Set(Object.values(tab).map((v) => v[1])).size === Object.keys(tab).length, '2D: jede Darstellung hat eine eigene Hauptfarbe');




console.log('\n[Manifest und Assets]');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/manifest/art-e.json'), 'utf8'));
const liste = Array.isArray(manifest) ? manifest : (manifest.assets || manifest.entries || manifest.models || []);
const e = liste.find((x) => x.id === 'lerche/furn/ladeplatz');
ok(!!e, 'Manifest art-e.json: lerche/furn/ladeplatz');
const SCHL = ['leer', 'kiste', 'waffenkiste', 'erzbrocken', 'schrott', 'fass', 'sprengkiste', 'kiste_med', 'bett'];
ok(!!e && SCHL.every((s) => e.states && e.states[s] && e.states[s].darstellung === s), 'Manifest: neun states mit darstellung = Schlüssel');
const dir = path.join(ROOT, 'public/voxel/assets/models/lerche/furn');
ok(fs.existsSync(path.join(dir, 'ladeplatz.json')), 'Spiel-Assets: ladeplatz.json');
for (const s of SCHL) ok(fs.existsSync(path.join(dir, 'ladeplatz_' + s + '.json')), 'Spiel-Assets: ladeplatz_' + s + '.json');
const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/voxel/index.json'), 'utf8'));
ok(JSON.stringify(idx).includes('lerche/furn/ladeplatz_bett'), 'index.json listet die Teilmodelle');
for (const d of Object.values(ERWARTET).concat(['bett'])) ok(SCHL.includes(d), 'Darstellung ' + d + ' hat ein Modell');
const ship = fs.readFileSync(path.join(ROOT, 'public/js/voxel/ship.js'), 'utf8');
ok(ship.includes("'lerche/furn/ladeplatz'") && ship.includes('platzDarstellung'), 'ship.js: Platz nutzt ladeplatz mit Darstellung');

console.log('\n' + (fails ? fails + ' von ' + n + ' FEHLER' : n + ' Prüfungen ok'));
process.exit(fails ? 1 : 0);
