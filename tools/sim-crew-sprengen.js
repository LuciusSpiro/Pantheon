'use strict';
// SUND-02b A2: Kennzahlen der Weltsimulation mit und ohne Sprengen gegnerischer Posten durch die Crew (100 Läufe, gleiche Seeds), dazu Versorgung und Farming-Prüfung.
// Sprengen = Wirkungen des Katalogs wie im Spiel (abwehr_verlust mit dem Rest der Garnison, dann posten_gesprengt, Prüfung Kern.pruefeWirkung); Sprünge der Crew = Ticks.
//   node tools/sim-crew-sprengen.js [--laeufe 100] [--ticks 300] [--seed0 0] [--sperre N] [--json]
// Strategien:
//   ohne    keine Wirkung
//   wenig   ab Tick 20: höchstens eine Sprengung alle 40 Ticks (der erste feindliche Posten, den es gibt; ein Spieler, der gelegentlich vorbeifliegt)
//   sabotage SUND-04b B2: wie der Beat sabotage (server/sim/faden-b2.js): hoechstens eine Sprengung je pause_ticks Ticks (content/faeden/b2-texte.json, mit --pause N ueberschreibbar), nur ein germanischer Posten auf einem Quell-Hex (Hex mit Quelle, kein Hafen),
//           nicht in der Ruf-Sperre je Hex (posten-werte.json), ab Tick 20; die Crew sprengt, sobald das Ziel steht (Obergrenze: die Zeit der Crew bis zum Ziel ist nicht abgebildet)
//   viel    Obergrenze (Mensch kaum erreichbar): alle 8 Ticks ab Tick 4 wird JEDER feindliche Posten gesprengt, sobald er steht (Farm-Schleife: sprengen, Gegner gründet neu, sprengen …)
// Gemessen: die SUND-01-Bänder (Eroberungen 1,0–2,2 je Lauf, Angriffe 1,5–3,0 je 100 Ticks, Stillstand ≤ 8 %, Kollaps 0, Hauptwelt nie verloren), dazu die Versorgung (wie viele feindliche Posten stehen,
// wie viele werden gegründet), die Neugründung nach einer Sprengung (Wartezeit bis zum nächsten germanischen Posten am selben Hex) und der Ruf, den die Strategie bekäme (mit und ohne Sperre je Hex,
// Quellen und Sperrfrist aus content/welt/ruf-werte.json bzw. posten-werte.json).
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const Daten = require('../server/weltsim/daten.js');
const Kz = require('../server/weltsim/kennzahlen.js');
const Kern = require('../server/weltsim/kern.js');
const PW = require('../content/welt/posten-werte.json').werte;
const RUF = require('../content/welt/ruf-werte.json').werte;

const args = process.argv.slice(2);
const argVal = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const laeufe = Number(argVal('--laeufe', 100)), ticks = Number(argVal('--ticks', 300)), seed0 = Number(argVal('--seed0', 0));
const SPERRE = Number(argVal('--sperre', PW.sprengen.wert.ruf_sperre_ticks));
const PAUSE = Number(argVal('--pause', require('../content/faeden/b2-texte.json').werte.sabotage.wert.pause_ticks));   // SUND-04b B2: Pause der Sabotage-Auftraege
const { karte, werte } = Daten.laden();

const feindlich = (nd) => nd.posten && (nd.besitzer === 'ger' || nd.besitzer === 'pirat');
function sprengung(z, hex) {
  const nd = z.hexe[hex]; const out = [];
  if (nd.garnison > 0) out.push({ typ: 'abwehr_verlust', ort: hex, punkte: nd.garnison });
  out.push({ typ: 'posten_gesprengt', ort: hex });
  return out;
}
const gilt = (z, liste) => Kern.filtereWirkungen(z, liste).gueltig.length === liste.length;   // wie im Spiel: der Prüfer läuft der Reihe nach
// -> { eingriff, sprengungen: [{ ort, besitzer, tick }] } (die Sprengungen der CREW; die Sim verliert auch selbst Posten an Rom, die zählen nicht)
const quellHex = (h) => !!(karte.hexe.find((x) => x.code === h) || { quellen: [] }).quellen.length && !(karte.hexe.find((x) => x.code === h) || {}).hafenklasse;   // SUND-04b B2: Versorgungsposten = Quelle, kein Hafen
function strategie(name) {
  const sprengungen = [];
  if (name === 'ohne') return { eingriff: null, sprengungen };
  let letzte = -1e9;
  const eingriff = (z, i) => {
    const t = i + 1;
    const out = [];
    if (name === 'wenig') {
      if (t >= 20 && t - letzte >= 40) for (const [h, nd] of Object.entries(z.hexe)) if (feindlich(nd) && gilt(z, sprengung(z, h))) { out.push(...sprengung(z, h)); sprengungen.push({ ort: h, besitzer: nd.besitzer, tick: z.tick }); letzte = t; break; }
    } else if (name === 'sabotage') {   // SUND-04b B2
      if (t >= 20 && t - letzte >= PAUSE) for (const [h, nd] of Object.entries(z.hexe)) {
        const sperreAm = sprengungen.some((x) => x.ort === h && z.tick - x.tick < SPERRE);
        if (nd.posten && nd.besitzer === 'ger' && !nd.crew && quellHex(h) && !sperreAm && gilt(z, sprengung(z, h))) { out.push(...sprengung(z, h)); sprengungen.push({ ort: h, besitzer: nd.besitzer, tick: z.tick }); letzte = t; break; }
      }
    } else if (name === 'viel') {
      if (t >= 4 && t % 8 === 4) for (const [h, nd] of Object.entries(z.hexe)) if (feindlich(nd) && gilt(z, sprengung(z, h))) { out.push(...sprengung(z, h)); sprengungen.push({ ort: h, besitzer: nd.besitzer, tick: z.tick }); }
    }
    return out;
  };
  return { eingriff, sprengungen };
}
// Ruf aus den Sprengungen der Crew: jede Sprengung (posten_verloren durch rom, Besitzer ger/pirat), geklemmt auf die Grenze von Rom; mit Sperre je Hex (Ticks seit der letzten Sprengung am Hex)
function rufAus(sprengungen, sperre) {
  const letzte = {}; let ruf = 0; let n = 0; let gesperrt = 0;
  for (const e of sprengungen) {
    n++;
    const q = RUF.quellen.wert['posten_gesprengt_' + e.besitzer];
    if (sperre > 0 && letzte[e.ort] != null && e.tick - letzte[e.ort] < sperre) gesperrt++;
    else ruf = Math.min(RUF.fraktionen.wert.rom.max, ruf + q.delta);
    letzte[e.ort] = e.tick;
  }
  return { ruf, n, gesperrt };
}
const pq = (a, q) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const med = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const ergebnis = {};
for (const name of ['ohne', 'wenig', 'sabotage', 'viel']) {
  const rs = [];
  const ersteTicks = []; const zweiteTicks = [];
  let sprengungen = 0, ruf = 0, rufOhneSperre = 0, gesperrt = 0, gruendungenFeind = 0, nachSprengung = 0; const wartezeiten = []; let standMittel = 0; let standN = 0; let lebendLaeufe = 0;
  for (let s = 0; s < laeufe; s++) {
    const st = strategie(name);
    const r = Kz.lauf({ karte, werte, seed: seed0 + s, ticks, eingriff: st.eingriff });
    rs.push(r);
    const sp = st.sprengungen;
    sprengungen += sp.length;
    if (sp.length) ersteTicks.push(sp[0].tick); if (sp.length > 1) zweiteTicks.push(sp[1].tick);
    const a = rufAus(sp, SPERRE), b = rufAus(sp, 0);
    ruf += a.ruf; gesperrt += a.gesperrt; rufOhneSperre += b.ruf;
    // Neugründung am selben Hex nach einer Sprengung: Wartezeit
    const letzte = {};
    for (const e of r.ereignisse) {
      if (sp.some((x) => x.ort === e.ort && x.tick === e.tick) && e.typ === 'posten_verloren') letzte[e.ort] = e.tick;
      if (e.typ === 'posten_gegruendet' && (e.fraktion === 'ger' || e.fraktion === 'pirat')) { gruendungenFeind++; if (letzte[e.ort] != null) { nachSprengung++; wartezeiten.push(e.tick - letzte[e.ort]); delete letzte[e.ort]; } }
    }
    if (sp.length) lebendLaeufe++;
  }
  const sz = Kz.zusammenfassung(rs), a = Kz.angriffsUebersicht(rs);
  ergebnis[name] = { eroberungen: sz.eroberungen, angriffe_je100: a.je100, still: sz.still, kollaps: sz.kollaps, hw_verloren: sz.hw_verloren, rom_h: sz.rom_h, ger_h: sz.ger_h, kon_h: sz.kon_h,
    erste_sprengung: { n: ersteTicks.length, p10: pq(ersteTicks, 0.1), median: med(ersteTicks), p90: pq(ersteTicks, 0.9) }, zweite_sprengung: { n: zweiteTicks.length, median: med(zweiteTicks) },
    sprengungen_je_lauf: sprengungen / laeufe, laeufe_mit_sprengung: lebendLaeufe / laeufe, feind_gruendungen_je_lauf: gruendungenFeind / laeufe, neugruendung_am_hex_je_lauf: nachSprengung / laeufe,
    wartezeit_median: med(wartezeiten), wartezeit_min: wartezeiten.length ? Math.min(...wartezeiten) : null, wartezeit_n: wartezeiten.length,
    ruf_je_lauf: ruf / laeufe, ruf_ohne_sperre_je_lauf: rufOhneSperre / laeufe, ruf_gesperrt_je_lauf: gesperrt / laeufe, ruf_je_100: ruf / laeufe / ticks * 100 };
}
if (args.includes('--json')) { console.log(JSON.stringify(ergebnis, null, 1)); process.exit(0); }
const f2 = (x) => (typeof x === 'number' ? x.toFixed(2) : String(x));
const B = { eroberungen: [1.0, 2.2], angriffe_je100: [1.5, 3.0], still: [0, 0.08], kollaps: [0, 0], hw_verloren: [0, 0] };
console.log(`${laeufe} Läufe à ${ticks} Ticks (Seeds ${seed0}..${seed0 + laeufe - 1}), Bänder SUND-01: Eroberungen 1,0–2,2, Angriffe/100 1,5–3,0, Stillstand ≤ 8 %, Kollaps 0, Hauptwelt nie verloren`);
console.log('Strategie  Eroberungen  Angriffe/100  Stillstand  Kollaps  Hauptwelt  Häfen Rom/Ger/Kon   Sprengungen/Lauf  Läufe mit Sprengung');
let ausserhalb = 0;
for (const [name, e] of Object.entries(ergebnis)) {
  const in_ = (k) => e[k] >= B[k][0] - 1e-9 && e[k] <= B[k][1] + 1e-9;
  const bad = Object.keys(B).filter((k) => !in_(k)); ausserhalb += bad.length;
  console.log(`${name.padEnd(10)} ${f2(e.eroberungen).padStart(10)}  ${f2(e.angriffe_je100).padStart(12)}  ${(e.still * 100).toFixed(1).padStart(8)} %  ${f2(e.kollaps).padStart(7)}  ${f2(e.hw_verloren).padStart(9)}  ${f2(e.rom_h)}/${f2(e.ger_h)}/${f2(e.kon_h)}   ${f2(e.sprengungen_je_lauf).padStart(14)}  ${(e.laeufe_mit_sprengung * 100).toFixed(0).padStart(14)} %${bad.length ? '   AUSSERHALB: ' + bad.join(', ') : ''}`);
}
const o = ergebnis.ohne;
for (const name of ['wenig', 'sabotage', 'viel']) { const e = ergebnis[name]; console.log(`Differenz ${name} − ohne: Eroberungen ${f2(e.eroberungen - o.eroberungen)}, Angriffe/100 ${f2(e.angriffe_je100 - o.angriffe_je100)}, Stillstand ${((e.still - o.still) * 100).toFixed(1)} Pp, Hauptwelt ${f2(e.hw_verloren - o.hw_verloren)}`); }
console.log(`\nVersorgung und Farming (Sperre je Hex ${SPERRE} Ticks):`);
console.log('Strategie  feindl. Gründungen/Lauf  Neugründung am selben Hex/Lauf  Wartezeit bis dahin (Median, min, n)  Ruf/Lauf mit Sperre  Ruf/Lauf ohne Sperre  durch Sperre gestrichen/Lauf  Ruf je 100 Ticks');
for (const [name, e] of Object.entries(ergebnis)) console.log(`${name.padEnd(10)} ${f2(e.feind_gruendungen_je_lauf).padStart(20)}  ${f2(e.neugruendung_am_hex_je_lauf).padStart(30)}  ${(e.wartezeit_median == null ? '–' : e.wartezeit_median + ', ' + e.wartezeit_min + ', ' + e.wartezeit_n).padStart(36)}  ${f2(e.ruf_je_lauf).padStart(19)}  ${f2(e.ruf_ohne_sperre_je_lauf).padStart(20)}  ${f2(e.ruf_gesperrt_je_lauf).padStart(28)}  ${f2(e.ruf_je_100).padStart(15)}`);
console.log('\nZeitpunkt der Sprengungen (Tick; wann ein feindlicher Posten dasteht, nicht wann ein Mensch ihn erreicht):');
for (const [name, e] of Object.entries(ergebnis)) if (name !== 'ohne') console.log(`${name.padEnd(10)} erste Sprengung in ${e.erste_sprengung.n} Läufen: 10 % ${e.erste_sprengung.p10}, Median ${e.erste_sprengung.median}, 90 % ${e.erste_sprengung.p90}; zweite in ${e.zweite_sprengung.n} Läufen (Median ${e.zweite_sprengung.median})`);
process.exit(ausserhalb ? 1 : 0);
