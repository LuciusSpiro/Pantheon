'use strict';
// Lesen und Schreiben von tools/testliste.json (TST-01). Gemeinsam fuer run-tests.js, testliste-ergaenzen.js, testliste-budgets.js.
// Form: { "grenzen": {fast, full, slow, alles in s}, "schritte": [...], "ausgenommen": [{datei, grund}] }.
// Die alte Form (nackte Liste der Schritte) wird weiter gelesen: keine Grenzen, keine Ausnahmen.
const fs = require('fs');
const path = require('path');

const STANDARD = path.join(__dirname, 'testliste.json');
// Stufen mit harter Grenze (Wandzeit des Gesamtlaufs im Parallelmodus): die Zahlen stehen in testliste.json unter "grenzen".

function lesen(datei) {
  const roh = JSON.parse(fs.readFileSync(datei || STANDARD, 'utf8'));
  if (Array.isArray(roh)) return { grenzen: {}, schritte: roh, ausgenommen: [] };
  return { grenzen: roh.grenzen || {}, schritte: roh.schritte || [], ausgenommen: roh.ausgenommen || [] };
}

// Ein Schritt je Zeile, damit Diffs und Merges lesbar bleiben.
function schreiben(datei, doc) {
  const zeilen = a => '[\n' + a.map(e => '  ' + JSON.stringify(e)).join(',\n') + '\n ]';
  const text = '{\n "grenzen": ' + JSON.stringify(doc.grenzen || {}) + ',\n "schritte": ' + zeilen(doc.schritte)
    + ',\n "ausgenommen": ' + zeilen(doc.ausgenommen || []) + '\n}\n';
  fs.writeFileSync(datei || STANDARD, text);
}

module.exports = { lesen, schreiben, STANDARD };
