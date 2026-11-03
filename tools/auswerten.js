'use strict';
// TEL-01 D1: Sessionbericht aus einem Spielprotokoll.
//   npm run auswerten -- <datei|sessionkennung|--letzte> [--basis <json>] [--ziele <json>] [--aus <ordner>] [--json <datei>]
//     datei / sessionkennung   Protokoll (.jsonl) bzw. Kennung; bei einer Kennung werden alle Teile der Session in Reihenfolge gelesen
//     --letzte                 juengste Session in data/telemetrie/ und data/telemetrie/bot/
//     --basis <json>           Kennzahlen einer frueheren Session (Ausgabe von --json): Abweichungen stehen oben im Bericht
//     --ziele <json>           Zieldatei (Standard tools/fixtures/telemetrie/ziele.json, Format siehe tools/auswertung/bericht.js)
//     --aus <ordner>           Ausgabeordner (Standard data/telemetrie/berichte/, gitignored): <kennung>.md und <kennung>.svg
//     --json <datei>           zusaetzlich das Kennzahlen-Objekt als JSON schreiben (Basis-Datei fuer spaetere Vergleiche), OHNE listen.reihen (Bericht und Bild brauchen sie nicht aus der Basis)
//     --json-voll <datei>      wie --json, aber mit listen.reihen (die Zeitreihen fuer das Bild)
//   Relative Pfade (--aus, --json, --json-voll, --basis, --ziele) gelten ab dem aktuellen Verzeichnis; ohne --aus gilt data/telemetrie/berichte/ im Repo.
// Exit 0 bei Erfolg, 2 bei Aufrufproblemen (Session nicht gefunden, Datei unlesbar). Liest nur, schreibt nur in den Ausgabeordner.

const fs = require('fs');
const path = require('path');
const Lesen = require('./auswertung/lesen.js');
const { kennzahlen } = require('./auswertung/kennzahlen.js');
const { bericht } = require('./auswertung/bericht.js');
const { profil } = require('./auswertung/profil.js');

const ROOT = path.join(__dirname, '..');
const ZIELE_STANDARD = path.join(__dirname, 'fixtures', 'telemetrie', 'ziele.json');

function args(argv) {
  const a = { eingabe: null, letzte: false, basis: null, ziele: null, aus: null, json: null, jsonVoll: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--letzte') a.letzte = true;
    else if (x === '--basis' || x === '--ziele' || x === '--aus' || x === '--json' || x === '--json-voll') { const key = x === '--json-voll' ? 'jsonVoll' : x.slice(2); a[key] = argv[++i]; if (a[key] == null) throw new Error(x + ' braucht einen Wert'); }
    else if (x.startsWith('--')) throw new Error('unbekannte Option ' + x);
    else if (a.eingabe == null) a.eingabe = x;
    else throw new Error('zu viele Eingaben: ' + x);
  }
  if (!a.letzte && a.eingabe == null) throw new Error('Eingabe fehlt: <datei|sessionkennung|--letzte>');
  return a;
}
const jsonDatei = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// Kern, auch fuer Tests: Protokoll lesen, rechnen, Bericht und Bild schreiben. Rueckgabe { kennung, md, svg, kz, protokoll }
function auswerten(eingabe, opt) {
  opt = opt || {};
  const protokoll = Lesen.lesen(eingabe, { dirs: opt.dirs });
  const kz = kennzahlen(protokoll);
  const basis = opt.basis ? jsonDatei(opt.basis) : null;
  const zielDatei = opt.ziele || ZIELE_STANDARD;
  const ziele = fs.existsSync(zielDatei) ? jsonDatei(zielDatei) : {};
  const kennung = protokoll.kennung || 'session';
  const text = bericht(kz, { basis, ziele, svg: kennung + '.svg' });
  const svg = profil(protokoll, kz);
  let md = null, svgPfad = null;
  if (opt.aus !== false) {
    const dir = opt.aus ? path.resolve(opt.aus) : path.join(ROOT, 'data', 'telemetrie', 'berichte');   // K1: --aus gilt ab dem aktuellen Verzeichnis, wie --json
    fs.mkdirSync(dir, { recursive: true });
    md = path.join(dir, kennung + '.md'); svgPfad = path.join(dir, kennung + '.svg');
    fs.writeFileSync(md, text, 'utf8');
    fs.writeFileSync(svgPfad, svg, 'utf8');
  }
  const schreibe = (datei, obj) => { fs.mkdirSync(path.dirname(path.resolve(datei)), { recursive: true }); fs.writeFileSync(path.resolve(datei), JSON.stringify(obj, null, 1) + '\n', 'utf8'); };
  if (opt.json) { const ohne = Object.assign({}, kz, { listen: Object.assign({}, kz.listen) }); delete ohne.listen.reihen; schreibe(opt.json, ohne); }
  if (opt.jsonVoll) schreibe(opt.jsonVoll, kz);
  return { kennung, md, svg: svgPfad, text, svgText: svg, kz, protokoll };
}

function main() {
  let a;
  try { a = args(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  let eingabe = a.eingabe;
  if (a.letzte) { eingabe = Lesen.letzteKennung(); if (!eingabe) { console.error('Keine Session in data/telemetrie/ oder data/telemetrie/bot/ gefunden'); process.exit(2); } }
  let r;
  try { r = auswerten(eingabe, { basis: a.basis, ziele: a.ziele, aus: a.aus, json: a.json, jsonVoll: a.jsonVoll }); } catch (e) { console.error('Auswertung fehlgeschlagen: ' + e.message); process.exit(2); }
  console.log('Bericht: ' + r.md + '\nBild:    ' + r.svg + (a.json ? '\nJSON:    ' + path.resolve(a.json) : '') + (a.jsonVoll ? '\nJSON voll: ' + path.resolve(a.jsonVoll) : '') + '\n(' + (r.text.split('\n').length - 1) + ' Zeilen)');
}

if (require.main === module) main();
module.exports = { auswerten, args };
