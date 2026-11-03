'use strict';
// TEL-01 D2: Fragen an die Abfrage-Datenbank (tools/auswertung/abfrage.js; geladen mit `npm run abfrage:laden`). NUR LESEND: die Datenbank wird schreibgeschuetzt geoeffnet, Schreib-SQL wird abgelehnt.
//   npm run abfrage -- "<SQL>" [--csv] [--max <n>] [--db <datei>]
//   npm run abfrage -- --beispiel <name>      gespeicherte Beispielabfrage (tools/auswertung/abfragen.sql); ohne Namen: Liste
//   npm run abfrage -- --schema               Tabellen, Views und Spalten
//     --csv    CSV statt Markdown-Tabelle (ohne Zeilenbegrenzung)
//     --max    hoechstens n Zeilen in der Tabelle (Standard 1000, 0 = alle)
//     --db     Datenbank (Standard data/telemetrie/abfrage.sqlite)
// Exit 0 bei Erfolg, 2 bei Aufrufproblemen, fehlerhaftem oder schreibendem SQL (verstaendliche Meldung auf der Fehlerausgabe).
const Abfrage = require('./auswertung/abfrage.js');

function args(argv) {
  const a = { sql: null, csv: false, max: null, db: null, beispiel: undefined, schema: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    const wert = () => { const v = argv[++i]; if (v == null) throw new Error(x + ' braucht einen Wert'); return v; };
    if (x === '--csv') a.csv = true;
    else if (x === '--schema') a.schema = true;
    else if (x === '--max') { a.max = Number(wert()); if (!(a.max >= 0)) throw new Error('--max braucht eine Zahl >= 0'); }
    else if (x === '--db') a.db = wert();
    else if (x === '--beispiel') a.beispiel = (argv[i + 1] != null && !argv[i + 1].startsWith('--')) ? argv[++i] : null;
    else if (x.startsWith('--')) throw new Error('unbekannte Option ' + x);
    else if (a.sql == null) a.sql = x;
    else throw new Error('zu viele Angaben (das SQL gehoert in Anfuehrungszeichen): ' + x);
  }
  return a;
}

// Beschreibung als Kommentarzeilen mit hoechstens 160 Zeichen
function kommentar(text) {
  const out = [];
  let zeile = '--';
  for (const w of text.split(' ')) { if (zeile.length + 1 + w.length > 160 && zeile !== '--') { out.push(zeile); zeile = '--'; } zeile += ' ' + w; }
  out.push(zeile);
  return out.join('\n');
}

function main() {
  let a;
  try { a = args(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  try {
    let sql = a.sql;
    if (a.beispiel !== undefined) {
      const liste = Abfrage.beispieleLaden();
      if (a.beispiel === null) { console.log(liste.map((b) => b.name + '\n    ' + b.text).join('\n') + '\n'); return; }
      const b = liste.find((x) => x.name === a.beispiel);
      if (!b) throw new Abfrage.AbfrageFehler('Beispiel "' + a.beispiel + '" gibt es nicht; vorhanden: ' + liste.map((x) => x.name).join(', '));
      sql = b.sql;
      if (!a.csv) console.log(kommentar(b.name + ': ' + b.text) + '\n');
    }
    const db = Abfrage.oeffnenLesend(a.db);
    if (a.schema) { process.stdout.write(Abfrage.schemaText(db)); db.close(); return; }
    if (sql == null) throw new Abfrage.AbfrageFehler('kein SQL angegeben: npm run abfrage -- "SELECT ..." | --beispiel <name> | --schema');
    const res = Abfrage.ausfuehren(db, sql);
    db.close();
    process.stdout.write(a.csv ? Abfrage.csv(res) : Abfrage.tabelle(res, a.max));
  } catch (e) {
    console.error(e instanceof Abfrage.AbfrageFehler ? e.message : 'Abfrage fehlgeschlagen: ' + e.message);
    process.exit(2);
  }
}
if (require.main === module) main();
module.exports = { args };
