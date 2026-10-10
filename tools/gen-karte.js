'use strict';
// PROTOTYP (Brücke, Gespräch mit Kai 2026-10-10): erzeugt eine Station mit der Grammatik aus shared/gen-station.js, fertigt sie
// mit Buehne.ausRaster (Legende, Türkanten, Prüfer) und legt sie als JSON für die 3D-Testseite ab.
//   node tools/gen-karte.js --seed 8 --raeume 8 [--bauweise germanen] [--besitz kontor] [--zustand intakt]
//   -> public/proto/station-<seed>-<räume>.json   Ansehen: /proto-karte.html?f=station-8-8
const fs = require('fs');
const path = require('path');
const Buehne = require('../shared/buehne.js');
const Gen = require('../shared/gen-station.js');

const args = process.argv.slice(2);
const val = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const seed = +val('--seed', 8), raeume = +val('--raeume', 8);
const opts = { bauweise: val('--bauweise', 'germanen'), besitz: val('--besitz', null), zustand: val('--zustand', 'intakt'), id: `station-${seed}-${raeume}` + (val('--name', null) ? '-' + val('--name', null) : val('--besitz', null) ? '-' + val('--besitz', null) : '') };
const roh = Gen.erzeuger(+val('--w', 96), +val('--h', 56)).karteRoh(seed, raeume, opts);
const r = Buehne.ausRaster(roh);
const dir = path.join(__dirname, '..', 'public', 'proto');
fs.mkdirSync(dir, { recursive: true });
const datei = path.join(dir, `${opts.id}.json`);
fs.writeFileSync(datei, JSON.stringify({ karte: r.karte, pruefung: r.pruefung }));
console.log(`${opts.id}: ${r.karte.w}×${r.karte.h}, ${roh.meta.raeume} Räume (Ziel ${raeume}), ${r.karte.anker.length} Anker, ${Object.keys(r.karte.kanten).length} Türkanten`);
console.log(`Prüfer: ${r.pruefung.ok ? 'bestanden' : 'FEHLER'}${r.pruefung.fehler.length ? ' – ' + r.pruefung.fehler.slice(0, 5).map((f) => f.code + ' ' + f.msg).join('; ') : ''}`);
console.log(`Warnungen: ${[...new Set(r.pruefung.warnungen.map((w) => w.code))].join(', ') || 'keine'}`);
console.log(`geschrieben: ${path.relative(process.cwd(), datei)}  ->  /proto-karte.html?f=${opts.id}`);
