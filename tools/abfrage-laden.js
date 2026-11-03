'use strict';
// TEL-01 D2: Protokolle in die Abfrage-Datenbank laden (Tabellen und Views siehe tools/auswertung/abfrage.js).
//   npm run abfrage:laden [-- <ordner>...] [--db <datei>]
//     ohne Ordner: data/telemetrie/ und data/telemetrie/bot/ (jeweils samt Unterordnern ausser tuning/ und berichte/)
//     --db <datei>   Datenbank (Standard data/telemetrie/abfrage.sqlite, gitignored)
// Inkrementell ueber die Sessionkennung: schon geladene (beendete) Sessions werden uebersprungen; eine Session ohne session_ende wird beim naechsten Laden neu gelesen.
// node:sqlite braucht Node >= 22.13 (unter Node 22 ohne Warnung: die ExperimentalWarning wird unterdrueckt). Exit 0 = alles geladen, 1 = mindestens eine Session nicht lesbar oder eine Kennung doppelt (steht in der Ausgabe), 2 = Aufrufproblem.
const path = require('path');
const Lesen = require('./auswertung/lesen.js');
const Abfrage = require('./auswertung/abfrage.js');

function args(argv) {
  const a = { ordner: [], db: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--db') { a.db = argv[++i]; if (a.db == null) throw new Error('--db braucht einen Wert'); }
    else if (x.startsWith('--')) throw new Error('unbekannte Option ' + x);
    else a.ordner.push(x);
  }
  if (!a.ordner.length) a.ordner = Lesen.STANDARD_DIRS.slice(0, 1);   // data/telemetrie enthaelt bot/ als Unterordner
  return a;
}

function main() {
  let a;
  try { a = args(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  const t0 = Date.now();
  let o;
  try { o = Abfrage.oeffnenZumLaden(a.db); } catch (e) { console.error('Datenbank nicht zu oeffnen: ' + e.message); process.exit(2); }
  const erg = Abfrage.laden(o.db, a.ordner);
  o.db.close();
  const f = path.resolve(a.db || Abfrage.DB_STANDARD);
  let mb = 0;
  try { mb = require('fs').statSync(f).size / 1048576; } catch (e) { /* weg */ }
  console.log('Datenbank ' + f + (o.neuAufgebaut ? ' (neu aufgebaut)' : '') + ': ' + erg.gefunden + ' Sessions gefunden, ' + erg.geladen + ' geladen, ' + erg.uebersprungen + ' schon vorhanden, ' + erg.fehler.length + ' Fehler' + (erg.doppelt.length ? ', ' + erg.doppelt.length + ' doppelte Kennung(en) nicht geladen' : '') + '; '
    + mb.toFixed(1).replace('.', ',') + ' MB, ' + ((Date.now() - t0) / 1000).toFixed(1).replace('.', ',') + ' s');
  for (const e of erg.fehler) console.log('  FEHLER ' + e.kennung + ': ' + e.fehler);
  for (const k of erg.doppelt) console.log('  DOPPELT ' + k + ': dieselbe Kennung in einem zweiten Ordner, nicht geladen');
  process.exit(erg.fehler.length || erg.doppelt.length ? 1 : 0);
}
if (require.main === module) main();
module.exports = { args };
