'use strict';
// SUND-01 A: Weltsimulation headless, Kennzahlen wie summary() in sim_sund.py (Prototyp), dazu Eingreif-Fenster und Sicht-Messung.
//   node tools/sim-welt.js [--laeufe 100] [--ticks 300] [--seed0 0] [--wert k=0.25 ...] [--sicht] [--json]
//   --wert name=json   überschreibt einen Wert der Datei (mehrfach möglich, Pfad mit Punkt für Tabellen: cap.A=10), z. B. --wert stuetz=false --wert feld_decay=0
//   --sicht            zusätzlich die Sicht-Messung (Sichtweite 0 bis alles, Verzögerung aus den Werten)
const Daten = require('../server/weltsim/daten.js');
const Kz = require('../server/weltsim/kennzahlen.js');

const args = process.argv.slice(2);
const argVal = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const alleWerte = (k) => args.reduce((a, x, i) => (x === k ? a.concat(args[i + 1]) : a), []);

const { karte, werte } = Daten.laden();
for (const kv of alleWerte('--wert')) {
  const i = kv.indexOf('=');
  const pfad = kv.slice(0, i).split('.'), roh = kv.slice(i + 1);
  let wert;
  try { wert = JSON.parse(roh); } catch (e) { wert = roh; }
  let o = werte.werte[pfad[0]];
  if (!o) throw new Error(`Unbekannter Wert: ${pfad[0]}`);
  if (pfad.length === 1) o.wert = wert;
  else { o = o.wert; for (const p of pfad.slice(1, -1)) o = o[p]; o[pfad[pfad.length - 1]] = wert; }
}

const laeufe = Number(argVal('--laeufe', 100)), seed0 = Number(argVal('--seed0', 0));
const ticks = Number(argVal('--ticks', werte.werte.ticks.wert));
const RADIEN = [0, 1, 2, 3, 99];
const sicht = args.includes('--sicht');

const t0 = Date.now();
const rs = [];
for (let i = 0; i < laeufe; i++) rs.push(Kz.lauf({ karte, werte, seed: seed0 + i, ticks, sichtRadien: sicht ? RADIEN : null }));
const s = Kz.zusammenfassung(rs);
const a = Kz.angriffsUebersicht(rs, 'reich', ticks);
if (args.includes('--json')) { console.log(JSON.stringify({ zusammenfassung: s, angriffe: a })); process.exit(0); }
console.log(`${laeufe} Läufe à ${ticks} Ticks, Seeds ${seed0}..${seed0 + laeufe - 1}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log('Kennzahlen:   ' + Kz.fmt(s));
console.log('Angriffe/100: ' + a.je100.toFixed(2) + '   (angriffe je Lauf: ' + s.angriffe.toFixed(2) + ', abgebrochen je Lauf: ' + Kz.mittel(rs.map((r) => r.abort)).toFixed(2) + ')');
console.log('Fenster:      ' + Kz.fmt(a));
if (sicht) {
  const t = Kz.sichtTabelle(rs, RADIEN);
  console.log(`Sicht (Verzögerung ${werte.sicht.verzoegerung.wert} Tick), ${t[0].angriffe} germanische Angriffe:`);
  console.log('  Sichtweite  vor Marsch  Vorwarnung  rechtzeitig  mittendrin');
  for (const r of t) console.log(`  ${(r.sichtweite === 99 ? 'alles' : r.sichtweite + ' Sprung' + (r.sichtweite === 1 ? '' : 'e')).padEnd(11)} ${(r.vor_marsch * 100).toFixed(0).padStart(8)} %  ${String(r.vorwarnung).padStart(8)} T  ${r.rechtzeitig.toFixed(2).padStart(11)}  ${r.mittendrin.toFixed(2).padStart(10)}`);
}
