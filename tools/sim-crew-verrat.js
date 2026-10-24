'use strict';
// SUND-02b E: Kennzahlen der Weltsimulation mit und ohne Verrat (Beschuss auf römische Verbündete) durch die Crew (100 Läufe, gleiche Seeds), Muster tools/sim-crew-sprengen.js.
// Verrat = die Wirkungen des Szenen-Siegs im Verrat (kriegslage-szene.js verratSieg): Verluste der römischen Seite im Hex (flotte_verlust: die ganze Stärke jeder römischen Flotte im Hex, die Sim hält
// sie dann auf Stärke 0,5 und schickt sie heim; abwehr_verlust: die ganze Abwehr/Garnison eines römischen Hafens/Postens im Hex), Prüfung Kern.filtereWirkungen; Sprünge der Crew = Ticks.
// Voraussetzung wie im Spiel: eine Sim-Szene im Hex (feindliche Flotte im Feld, Stärke ≥ 1, Befehl angriff/anspruch/rueckzug) UND römische Verbündete (römische Flotte im Hex oder Abwehr/Garnison eines römischen Orts).
//   node tools/sim-crew-verrat.js [--laeufe 100] [--ticks 300] [--seed0 0] [--faktor 1] [--json]   (--faktor überschreibt content/welt/verrat-werte.json verlust.faktor)
// Strategien:
//   ohne    keine Wirkung
//   wenig   ab Tick 20: höchstens ein Verrat alle 40 Ticks, im ersten Hex, in dem die Voraussetzung gilt (ein Spieler, der sich gelegentlich dazu entschließt)
//   viel    Obergrenze (Mensch kaum erreichbar, die Crew steht nie in mehreren Hexen): alle 8 Ticks ab Tick 4 in JEDEM Hex, in dem die Voraussetzung gilt
// Gemessen: die SUND-01-Bänder (Eroberungen 1,0–2,2 je Lauf, Angriffe 1,5–3,0 je 100 Ticks, Stillstand ≤ 8 %, Kollaps 0, Hauptwelt nie verloren), dazu wie oft ein Verrat überhaupt möglich ist
// (Hex-Ticks mit Voraussetzung), wie viele Verräte, wie viele römische Punkte dabei verloren gehen, und der Ruf-Abzug (ungeklemmt).
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const Daten = require('../server/weltsim/daten.js');
const Kz = require('../server/weltsim/kennzahlen.js');
const Kern = require('../server/weltsim/kern.js');
const RUF = require('../content/welt/ruf-werte.json').werte;
const VW = require('../content/welt/verrat-werte.json').werte;

const args = process.argv.slice(2);
const argVal = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const laeufe = Number(argVal('--laeufe', 100)), ticks = Number(argVal('--ticks', 300)), seed0 = Number(argVal('--seed0', 0));
const FAKTOR = Number(argVal('--faktor', VW.verlust.wert.faktor));   // Anteil der römischen Stärke, den ein Verrat kostet (Daten verlust.faktor, hier überschreibbar)
const { karte, werte } = Daten.laden();
const FELD = ['angriff', 'anspruch', 'rueckzug'];   // Befehle im Feld (AUSLOESER_BEFEHLE der Szene)

const hatHafen = (d, hex) => d.hex[hex].hafen !== '';
// Hexe, in denen eine Sim-Szene mit römischen Verbündeten stehen kann
function moeglich(z) {
  const d = Kern.datenVon(z); const out = [];
  const hexe = new Set(z.flotten.filter((f) => Kern.feindlich(f.fraktion, 'rom') && f.staerke >= 1 && FELD.includes(f.befehl)).map((f) => f.ort));
  for (const hex of hexe) {
    const nd = z.hexe[hex]; if (!nd) continue;
    const flotten = z.flotten.filter((f) => f.ort === hex && f.fraktion === 'rom' && f.staerke > 0);
    const pool = nd.besitzer === 'rom' && (hatHafen(d, hex) || nd.posten) ? (hatHafen(d, hex) ? nd.abwehr : nd.garnison) : 0;
    if (flotten.length || pool > 0) out.push({ hex, flotten, pool });
  }
  return out;
}
function verrat(m) {
  const w = [];
  const r2 = (v) => Math.floor(v * 100 + 1e-9) / 100;
  for (const f of m.flotten) if (r2(f.staerke * FAKTOR) >= 0.01) w.push({ typ: 'flotte_verlust', flotte: f.id, punkte: r2(f.staerke * FAKTOR) });
  if (r2(m.pool * FAKTOR) >= 0.01) w.push({ typ: 'abwehr_verlust', ort: m.hex, punkte: r2(m.pool * FAKTOR) });
  return w;
}
// -> { eingriff, st: { verraete: [{ ort, tick, punkte }], moeglich, punkte } }
function strategie(name) {
  const st = { verraete: [], moeglich: 0, punkte: 0, letzte: -1e9 };
  const eingriff = (z, i) => {
    const t = i + 1; const out = [];
    const m = moeglich(z); st.moeglich += m.length;
    if (name === 'ohne') return out;
    const wahl = name === 'wenig' ? (t >= 20 && t - st.letzte >= 40 ? m.slice(0, 1) : []) : (t >= 4 && t % 8 === 4 ? m : []);
    for (const x of wahl) {
      const w = Kern.filtereWirkungen(z, verrat(x)).gueltig;
      if (!w.length) continue;
      out.push(...w); st.letzte = t;
      const p = w.reduce((s, y) => s + y.punkte, 0); st.punkte += p; st.verraete.push({ ort: x.hex, tick: z.tick, punkte: p });
    }
    return out;
  };
  return { eingriff, st };
}
const pq = (a, q) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const med = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const DELTA = RUF.quellen.wert.verrat_beginn.delta + RUF.quellen.wert.verrat_flotte_vernichtet.delta;

const ergebnis = {};
for (const name of ['ohne', 'wenig', 'viel']) {
  const rs = []; let verraete = 0, punkte = 0, moeglich_ = 0, mitVerrat = 0; const erste = [];
  for (let s = 0; s < laeufe; s++) {
    const { eingriff, st } = strategie(name);
    const r = Kz.lauf({ karte, werte, seed: seed0 + s, ticks, eingriff });
    rs.push(r);
    verraete += st.verraete.length; punkte += st.punkte; moeglich_ += st.moeglich;
    if (st.verraete.length) { mitVerrat++; erste.push(st.verraete[0].tick); }
  }
  const sz = Kz.zusammenfassung(rs), a = Kz.angriffsUebersicht(rs);
  ergebnis[name] = { eroberungen: sz.eroberungen, angriffe_je100: a.je100, still: sz.still, kollaps: sz.kollaps, hw_verloren: sz.hw_verloren, rom_h: sz.rom_h, ger_h: sz.ger_h, kon_h: sz.kon_h,
    verraete_je_lauf: verraete / laeufe, laeufe_mit_verrat: mitVerrat / laeufe, roemische_punkte_je_lauf: punkte / laeufe, moeglich_hex_ticks_je_lauf: moeglich_ / laeufe,
    erste: { n: erste.length, p10: pq(erste, 0.1), median: med(erste), p90: pq(erste, 0.9) }, ruf_abzug_je_lauf: -DELTA * (verraete / laeufe) };
}
if (args.includes('--json')) { console.log(JSON.stringify(ergebnis, null, 1)); process.exit(0); }
const f2 = (x) => (typeof x === 'number' ? x.toFixed(2) : String(x));
const B = { eroberungen: [1.0, 2.2], angriffe_je100: [1.5, 3.0], still: [0, 0.08], kollaps: [0, 0], hw_verloren: [0, 0] };
console.log(`${laeufe} Läufe à ${ticks} Ticks (Seeds ${seed0}..${seed0 + laeufe - 1}), Bänder SUND-01: Eroberungen 1,0–2,2, Angriffe/100 1,5–3,0, Stillstand ≤ 8 %, Kollaps 0, Hauptwelt nie verloren`);
console.log('Strategie  Eroberungen  Angriffe/100  Stillstand  Kollaps  Hauptwelt  Häfen Rom/Ger/Kon   Verräte/Lauf  Läufe mit Verrat  röm. Punkte/Lauf');
let ausserhalb = 0;
for (const [name, e] of Object.entries(ergebnis)) {
  const in_ = (k) => e[k] >= B[k][0] - 1e-9 && e[k] <= B[k][1] + 1e-9;
  const bad = Object.keys(B).filter((k) => !in_(k)); ausserhalb += bad.length;
  console.log(`${name.padEnd(10)} ${f2(e.eroberungen).padStart(10)}  ${f2(e.angriffe_je100).padStart(12)}  ${(e.still * 100).toFixed(1).padStart(8)} %  ${f2(e.kollaps).padStart(7)}  ${f2(e.hw_verloren).padStart(9)}  ${f2(e.rom_h)}/${f2(e.ger_h)}/${f2(e.kon_h)}   ${f2(e.verraete_je_lauf).padStart(11)}  ${(e.laeufe_mit_verrat * 100).toFixed(0).padStart(14)} %  ${f2(e.roemische_punkte_je_lauf).padStart(15)}${bad.length ? '   AUSSERHALB: ' + bad.join(', ') : ''}`);
}
const o = ergebnis.ohne;
for (const name of ['wenig', 'viel']) { const e = ergebnis[name]; console.log(`Differenz ${name} − ohne: Eroberungen ${f2(e.eroberungen - o.eroberungen)}, Angriffe/100 ${f2(e.angriffe_je100 - o.angriffe_je100)}, Stillstand ${((e.still - o.still) * 100).toFixed(1)} Pp, Hauptwelt ${f2(e.hw_verloren - o.hw_verloren)}, Rom-Häfen ${f2(e.rom_h - o.rom_h)}`); }
console.log(`\nMöglichkeit (Hex-Ticks je Lauf, in denen eine Szene mit römischen Verbündeten bestehen könnte): ${f2(ergebnis.ohne.moeglich_hex_ticks_je_lauf)} von ${ticks} Ticks`);
for (const [name, e] of Object.entries(ergebnis)) if (name !== 'ohne') console.log(`${name.padEnd(10)} erster Verrat in ${e.erste.n} Läufen: 10 % ${e.erste.p10}, Median ${e.erste.median}, 90 % ${e.erste.p90}; Ruf-Abzug je Lauf ${f2(e.ruf_abzug_je_lauf)} (ungeklemmt, Beginn ${RUF.quellen.wert.verrat_beginn.delta} + vernichtet ${RUF.quellen.wert.verrat_flotte_vernichtet.delta} je Verrat)`);
process.exit(ausserhalb ? 1 : 0);
