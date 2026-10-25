'use strict';
// SUND-03b P: Messung der Verteilung des Preisfaktors (server/sim/preise.js, content/welt/preise-werte.json) über Läufe der Sim.
// Je Seed läuft die Sim --ticks Ticks; nach jedem Tick wird für jeden Hafen im Besitz von Rom (dort legt die Crew an) und jeden Verbrauchsartikel der Faktor gemessen.
// Zwei Reihen: „ohne“ (die Sim allein: Belagerung und Munitionsvorrat) und „embargo“ (Regie-Befehl des Konkordats gegen Rom, Waren M,T,E, wie tools/sim-regie.js über den Kern-Befehl, alle 40 Ticks neu).
// Ausgabe je Artikel: Anteil der Messpunkte mit Faktor != 1, Spanne (min/max), Mittel, Gründe. Nur Messung, kein Urteil (Exit 0).
//   node tools/messe-preise.js [--seeds 40] [--ticks 300] [--seed0 0] [--json]
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const Daten = require('../server/weltsim/daten.js');
const Kern = require('../server/weltsim/kern.js');
const Preise = require('../server/sim/preise.js');

const args = process.argv.slice(2);
const argVal = (k, d) => (args.indexOf(k) >= 0 ? Number(args[args.indexOf(k) + 1]) : d);
const SEEDS = argVal('--seeds', 40), TICKS = argVal('--ticks', 300), SEED0 = argVal('--seed0', 0);
const JSON_OUT = args.includes('--json');
const { karte, werte } = Daten.laden();
const ARTIKEL = Object.keys(Preise.WERTE.artikel.wert).filter((id) => Preise.WERTE.artikel.wert[id].verbrauchsgut === true);

function reihe(mitEmbargo) {
  const R = {};
  for (const id of ARTIKEL) R[id] = { n: 0, anders: 0, min: Infinity, max: -Infinity, summe: 0, gruende: {} };
  for (let s = 0; s < SEEDS; s++) {
    const z = Kern.erzeuge({ karte, werte, seed: SEED0 + s });
    const d = Kern.datenVon(z);
    for (let t = 1; t <= TICKS; t++) {
      const befehle = mitEmbargo && t % 40 === 20 ? [{ typ: 'embargo', von: 'kon', gegen: 'rom', waren: ['M', 'T', 'E'], dauer: 30 }] : null;
      Kern.tick(z, befehle ? { befehle } : undefined);
      for (const hex of d.codes) {
        if (!d.hex[hex].hafen || z.hexe[hex].besitzer !== 'rom') continue;
        for (const id of ARTIKEL) {
          const m = R[id], l = Preises(z, id, hex);
          m.n++; m.summe += l.faktor; m.min = Math.min(m.min, l.faktor); m.max = Math.max(m.max, l.faktor);
          if (l.faktor !== 1) { m.anders++; for (const g of l.gruende) m.gruende[g] = (m.gruende[g] || 0) + 1; }
        }
      }
    }
  }
  return R;
}
const Preises = (z, id, hex) => Preise.faktorAus(z, id, hex);

const out = { seeds: SEEDS, ticks: TICKS, seed0: SEED0, ohne: reihe(false), embargo: reihe(true) };
if (JSON_OUT) console.log(JSON.stringify(out));
else {
  console.log(`Preisfaktor, ${SEEDS} Seeds x ${TICKS} Ticks, Häfen von Rom (Messpunkt = Hafen x Tick):`);
  for (const k of ['ohne', 'embargo']) {
    console.log(`\nReihe ${k}:`);
    for (const id of ARTIKEL) {
      const m = out[k][id];
      const g = Object.entries(m.gruende).map(([a, b]) => `${a} ${(100 * b / m.n).toFixed(1)} %`).join(', ');
      console.log(`  ${id.padEnd(11)} Faktor != 1 in ${(100 * m.anders / m.n).toFixed(1).padStart(5)} % der Messpunkte  Spanne ${m.min.toFixed(2)}..${m.max.toFixed(2)}  Mittel ${(m.summe / m.n).toFixed(3)}  ${g}`);
    }
  }
}
