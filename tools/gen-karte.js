'use strict';
// PROTOTYP (Brücke, Gespräch mit Kai 2026-10-10): erzeugt eine Station oder Siedlung mit den Grammatiken aus
// shared/gen-station.js bzw. shared/gen-siedlung.js, fertigt sie mit Buehne.ausRaster (Legende, Türkanten, Prüfer) und legt sie
// als JSON für die 3D-Testseite ab.
//   node tools/gen-karte.js --seed 8 --raeume 8 [--bauweise germanen_halle_holz] [--name holz]      Station
//   node tools/gen-karte.js --art siedlung --seed 2 --haeuser 10 --bauweise rom --typ handel         Siedlung
//   -> public/proto/<id>.json   Ansehen: /proto-karte.html?f=<id>
const fs = require('fs');
const path = require('path');
const Buehne = require('../shared/buehne.js');
const GenStation = require('../shared/gen-station.js');
const GenSiedlung = require('../shared/gen-siedlung.js');

const args = process.argv.slice(2);
const val = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const art = val('--art', 'station');
const seed = +val('--seed', 8);
const name = val('--name', null);
let roh, id;
if (art === 'siedlung') {
  const n = +val('--haeuser', 10), bw = val('--bauweise', 'germanen'), typ = val('--typ', 'handel');
  id = `siedlung-${seed}-${n}-${bw}-${typ}` + (name ? '-' + name : '');
  roh = GenSiedlung.erzeuger(+val('--w', 130), +val('--h', 90)).karteRoh(seed, n, { bauweise: bw, typ, besitz: val('--besitz', null), zustand: val('--zustand', 'intakt'), id });
} else {
  const n = +val('--raeume', 8);
  id = `station-${seed}-${n}` + (name ? '-' + name : val('--besitz', null) ? '-' + val('--besitz', null) : '');
  roh = GenStation.erzeuger(+val('--w', 96), +val('--h', 56)).karteRoh(seed, n, { bauweise: val('--bauweise', 'germanen'), besitz: val('--besitz', null), zustand: val('--zustand', 'intakt'), id });
}
const opts = { id };
const r = Buehne.ausRaster(roh);
const dir = path.join(__dirname, '..', 'public', 'proto');
fs.mkdirSync(dir, { recursive: true });
const datei = path.join(dir, `${opts.id}.json`);
fs.writeFileSync(datei, JSON.stringify({ karte: r.karte, pruefung: r.pruefung }));
console.log(`${opts.id}: ${r.karte.w}×${r.karte.h}, ${art === 'siedlung' ? roh.meta.haeuser + ' Gebäude (Ziel ' + roh.meta.haeuserZiel + ')' : roh.meta.raeume + ' Räume (Ziel ' + roh.meta.raeumeZiel + ')'}, ${r.karte.anker.length} Anker, ${Object.keys(r.karte.kanten).length} Türkanten`);
console.log(`Prüfer: ${r.pruefung.ok ? 'bestanden' : 'FEHLER'}${r.pruefung.fehler.length ? ' – ' + r.pruefung.fehler.slice(0, 5).map((f) => f.code + ' ' + f.msg).join('; ') : ''}`);
console.log(`Warnungen: ${[...new Set(r.pruefung.warnungen.map((w) => w.code))].join(', ') || 'keine'}`);
console.log(`geschrieben: ${path.relative(process.cwd(), datei)}  ->  /proto-karte.html?f=${opts.id}`);
