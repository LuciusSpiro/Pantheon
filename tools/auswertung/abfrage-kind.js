'use strict';
// TEL-01 D2 Nacharbeit K6: Kindprozess der Abfrage (nur von abfrage.js ausfuehrenMitLimit gestartet). Er fuehrt EINE lesende Anweisung aus und gibt { spalten, zeilen } oder { fehler } als JSON aus.
// Warum ein Prozess: node:sqlite blockiert in der Anweisung (kein Interrupt), ein Worker-Thread lasse sich nicht beenden (terminate wartet auf die laufende Anweisung); ein Prozess laesst sich abschiessen.
//   node abfrage-kind.js <datenbank>    das SQL kommt ueber die Standardeingabe
const fs = require('fs');
const Abfrage = require('./abfrage.js');

const jsonWert = (k, v) => (typeof v === 'bigint' ? (v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : String(v)) : (v instanceof Uint8Array ? 'x\'' + Buffer.from(v).toString('hex') + '\'' : v));
let aus;
try {
  const db = Abfrage.oeffnenLesend(process.argv[2]);
  aus = Abfrage.ausfuehren(db, fs.readFileSync(0, 'utf8'));
  db.close();
} catch (e) {
  aus = { fehler: String((e && e.message) || e), verstaendlich: e instanceof Abfrage.AbfrageFehler };
}
process.stdout.write(JSON.stringify(aus, jsonWert));
