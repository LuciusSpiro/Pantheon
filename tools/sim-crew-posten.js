'use strict';
// SUND-02b A1: Kennzahlen der Weltsimulation mit und ohne Posten der Crew (100 Läufe, gleiche Seeds). Die Standard-KI behandelt Crew-Posten wie jeden römischen Posten
// (gleiche Regeln); dieses Werkzeug misst, ob Eroberungen, Angriffe, Stillstand und „Hauptwelt verloren“ in den Bändern aus SUND-01 bleiben.
//   node tools/sim-crew-posten.js [--laeufe 100] [--ticks 300] [--seed0 0] [--json]
// Crew-Strategien (nur Wirkungen des Katalogs, Prüfung wie im Spiel; Sprünge der Crew = Ticks):
//   ohne     keine Wirkung
//   wenig    Tick 6 und 14: ein Posten in einem freien Hex in Roms Anspruch (posten_gehisst), Tick 40: ein römischer Posten wird Stützpunkt (posten_ausgebaut)
//   viel     Obergrenze (Mensch kaum erreichbar): alle 8 Ticks ab Tick 4 wird jeder gültige Anspruchs-Hex besetzt und jeder römische Posten ausgebaut; fällt einer, steht er bald wieder
// Bänder (SUND-01, 100 Läufe): Eroberungen 1,0–2,2 je Lauf, Angriffe 1,5–3,0 je 100 Ticks, Stillstand ≤ 8 %, Kollaps 0, Hauptwelt nie verloren.
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const Daten = require('../server/weltsim/daten.js');
const Kz = require('../server/weltsim/kennzahlen.js');
const Kern = require('../server/weltsim/kern.js');

const args = process.argv.slice(2);
const argVal = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const laeufe = Number(argVal('--laeufe', 100)), ticks = Number(argVal('--ticks', 300)), seed0 = Number(argVal('--seed0', 0));
const { karte, werte } = Daten.laden();
const ANSPRUCH = require('../content/welt/posten-werte.json').werte.anspruch.wert.rom;

const gueltig = (z, wk) => Kern.pruefeWirkung(z, wk).ok;
function strategie(name) {
  if (name === 'ohne') return null;
  return (z, i) => {
    const t = i + 1;   // Tick, der gleich läuft
    const out = [];
    const probiere = (wk) => { if (gueltig(z, wk)) out.push(wk); };
    if (name === 'wenig') {
      if (t === 6 || t === 14) for (const h of ANSPRUCH) { const wk = { typ: 'posten_gehisst', ort: h }; if (gueltig(z, wk)) { out.push(wk); break; } }
      if (t === 40) for (const [h, nd] of Object.entries(z.hexe)) { if (nd.posten && nd.besitzer === 'rom') { const wk = { typ: 'posten_ausgebaut', ort: h }; if (gueltig(z, wk)) { out.push(wk); break; } } }
    } else if (name === 'viel') {
      if (t >= 4 && t % 8 === 4) {
        for (const h of ANSPRUCH) probiere({ typ: 'posten_gehisst', ort: h });
        for (const [h, nd] of Object.entries(z.hexe)) if (nd.posten && nd.besitzer === 'rom') probiere({ typ: 'posten_ausgebaut', ort: h });
      }
    }
    return out;
  };
}

const ergebnis = {};
for (const name of ['ohne', 'wenig', 'viel']) {
  const rs = [];
  let crewHexe = 0, crewVerloren = 0, aufbauten = 0;
  for (let s = 0; s < laeufe; s++) {
    const r = Kz.lauf({ karte, werte, seed: seed0 + s, ticks, eingriff: strategie(name) });
    rs.push(r);
    crewHexe += Object.values(r.z.hexe).filter((nd) => nd.crew).length;
    crewVerloren += r.ereignisse.filter((e) => e.typ === 'posten_verloren' && e.besitzer === 'rom').length;
    aufbauten += r.ereignisse.filter((e) => e.typ === 'posten_gehisst' || e.typ === 'posten_ausgebaut').length;
  }
  const sz = Kz.zusammenfassung(rs), a = Kz.angriffsUebersicht(rs);
  ergebnis[name] = { eroberungen: sz.eroberungen, angriffe_je100: a.je100, still: sz.still, kollaps: sz.kollaps, hw_verloren: sz.hw_verloren, rom_h: sz.rom_h, ger_h: sz.ger_h, kon_h: sz.kon_h,
    posten_sim_je_lauf: sz.posten, posten_verloren_rom_je_lauf: crewVerloren / laeufe, crew_ereignisse_je_lauf: aufbauten / laeufe, crew_posten_am_ende: crewHexe / laeufe };
}
if (args.includes('--json')) { console.log(JSON.stringify(ergebnis, null, 1)); process.exit(0); }
const f2 = (x) => (typeof x === 'number' ? x.toFixed(2) : String(x));
const B = { eroberungen: [1.0, 2.2], angriffe_je100: [1.5, 3.0], still: [0, 0.08], kollaps: [0, 0], hw_verloren: [0, 0] };
console.log(`${laeufe} Läufe à ${ticks} Ticks (Seeds ${seed0}..${seed0 + laeufe - 1}), Bänder SUND-01: Eroberungen 1,0–2,2, Angriffe/100 1,5–3,0, Stillstand ≤ 8 %, Kollaps 0, Hauptwelt nie verloren`);
console.log('Strategie  Eroberungen  Angriffe/100  Stillstand  Kollaps  Hauptwelt  Häfen Rom/Ger/Kon   Crew-Ereign.  Crew-Posten Ende  Rom-Posten verloren');
let ausserhalb = 0;
for (const [name, e] of Object.entries(ergebnis)) {
  const in_ = (k) => e[k] >= B[k][0] - 1e-9 && e[k] <= B[k][1] + 1e-9;
  const bad = Object.keys(B).filter((k) => !in_(k)); ausserhalb += bad.length;
  console.log(`${name.padEnd(10)} ${f2(e.eroberungen).padStart(10)}  ${f2(e.angriffe_je100).padStart(12)}  ${(e.still * 100).toFixed(1).padStart(8)} %  ${f2(e.kollaps).padStart(7)}  ${f2(e.hw_verloren).padStart(9)}  ${f2(e.rom_h)}/${f2(e.ger_h)}/${f2(e.kon_h)}   ${f2(e.crew_ereignisse_je_lauf).padStart(11)}  ${f2(e.crew_posten_am_ende).padStart(16)}  ${f2(e.posten_verloren_rom_je_lauf).padStart(18)}${bad.length ? '   AUSSERHALB: ' + bad.join(', ') : ''}`);
}
const o = ergebnis.ohne;
for (const name of ['wenig', 'viel']) { const e = ergebnis[name]; console.log(`Differenz ${name} − ohne: Eroberungen ${f2(e.eroberungen - o.eroberungen)}, Angriffe/100 ${f2(e.angriffe_je100 - o.angriffe_je100)}, Stillstand ${((e.still - o.still) * 100).toFixed(1)} Pp, Hauptwelt ${f2(e.hw_verloren - o.hw_verloren)}`); }
process.exit(ausserhalb ? 1 : 0);
