'use strict';
// Leitet das Zeitbudget je Schritt (Feld budget_s in tools/testliste.json) aus einem seriellen Lauf ab (TST-01).
// Aufruf: node tools/testliste-budgets.js [--aus <ergebnis.json>] [--schreiben] [--liste <datei.json>]
//   --aus        Ergebnis-JSON des Runners (Standard tools/fixtures/testzeiten/baseline.json); gelesen wird je Schritt dauer_s
//   --schreiben  Budgets in die Liste schreiben; ohne: nur Vorschau
// Regel: budget_s = max(2 x Dauer, Dauer + 5 s), aufgerundet auf ganze Sekunden. Nur sinnvoll aus einem SERIELLEN Lauf auf ruhigem Rechner
// (unter Parallelbetrieb sind die Zeiten das 3- bis 7-Fache). Schritte ohne Messwert behalten ihr bisheriges Budget.
const fs = require('fs');
const path = require('path');
const io = require('./testliste-io');

function argWert(name, std) { const i = process.argv.indexOf(name); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : std; }
const budget = d => Math.ceil(Math.max(2 * d, d + 5));

const quelle = path.resolve(argWert('--aus', path.join(__dirname, 'fixtures', 'testzeiten', 'baseline.json')));
const listeDatei = path.resolve(argWert('--liste', io.STANDARD));
const doc = io.lesen(listeDatei);
const lauf = JSON.parse(fs.readFileSync(quelle, 'utf8'));
const dauern = new Map((lauf.schritte || []).map(s => [s.id, s.dauer_s]));

let neu = 0, geaendert = 0, gleich = 0;
const ohne = [];
for (const e of doc.schritte) {
  if (!dauern.has(e.id)) { if (e.budget_s === undefined) ohne.push(e.id); continue; }
  const b = budget(dauern.get(e.id));
  if (e.budget_s === undefined) neu++; else if (e.budget_s !== b) geaendert++; else gleich++;
  e.budget_s = b;
}
const mit = doc.schritte.filter(e => e.budget_s !== undefined);
console.log('Quelle: ' + quelle + ' (' + dauern.size + ' Schritte)');
console.log('Budgets: ' + neu + ' neu, ' + geaendert + ' geaendert, ' + gleich + ' unveraendert; ' + mit.length + '/' + doc.schritte.length + ' Schritte mit Budget');
if (ohne.length) console.log('Ohne Messwert und ohne Budget (' + ohne.length + '): ' + ohne.join('; '));
const lang = mit.slice().sort((a, b) => b.budget_s - a.budget_s).slice(0, 8);
console.log('Groesste Budgets: ' + lang.map(e => e.id + ' ' + e.budget_s + ' s').join('; '));
if (process.argv.includes('--schreiben')) { io.schreiben(listeDatei, doc); console.log('Geschrieben: ' + listeDatei); }
else console.log('Vorschau, nichts geschrieben (--schreiben zum Speichern).');
