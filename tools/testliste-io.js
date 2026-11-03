'use strict';
// Lesen und Schreiben von tools/testliste.json (TST-01). Gemeinsam fuer run-tests.js, testliste-ergaenzen.js, testliste-budgets.js.
// Form: { "grenzen": {"fast": {"s": 300, "hart": true}, ...}, "schritte": [...], "ausgenommen": [{datei, grund}] }.
// Schritte duerfen u. a. "timeout_s" tragen (eigener Timeout, gilt als Untergrenze neben --timeout); schreiben() erhaelt alle Felder.
// Die alte Form (nackte Liste der Schritte) wird weiter gelesen: keine Grenzen, keine Ausnahmen.
const fs = require('fs');
const path = require('path');

const STANDARD = path.join(__dirname, 'testliste.json');
// Grenze einer Stufe (Wandzeit des Gesamtlaufs im Parallelmodus) aus "grenzen": { s, hart } oder null.
// hart: true = Ueberschreitung gibt Exit 3 (nur wenn sonst alles gruen); sonst nur Hinweis. Eine nackte Zahl (alte Form) gilt als nicht hart.
function grenze(doc, stufe) {
  const g = (doc.grenzen || {})[stufe];
  const s = Number(g && typeof g === 'object' ? g.s : g);
  if (!(s > 0)) return null;
  return { s, hart: !!(g && typeof g === 'object' && g.hart === true) };
}

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

module.exports = { lesen, schreiben, grenze, STANDARD };
