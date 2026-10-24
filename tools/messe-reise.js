'use strict';
// SUND-03 F8: Verteilung der Reise-Ereignisse (server/sim/reise-ereignis.js, Katalog content/reise/ereignisse.json). Ein Zufallsgang der Crew über die Karte (eigener Strom, nie game.rng), je Sprung ein Sim-Tick,
// Reise-Ereignis über die echte Entscheidung (zaehleSprung, entscheiden): Anteil je Katalog-Id an den Gefahren (notruf, patrouille, piraten; Funkmeldungen zählen nicht), Rate (Ereignisse je Sprung) und
// Zahl der Ereignisse je Id. Aufruf: node tools/messe-reise.js [--seeds 6] [--spruenge 1200] [--ruf <Rom-Ruf, sonst Mix 0/8/30>] [--json]
// (npm run messe:reise). Der Test tools/test-reise-verteilung.js nutzt dieselbe Messfunktion in klein.
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const F = require('./regie-fixture.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const RE = require('../server/sim/reise-ereignis.js');
const Sektoren = require('../shared/sektoren.js');
const Marken = require('../server/sim/marken.js');
const Ruf = require('../server/sim/ruf.js');

const GEFAHR = ['notruf', 'patrouille', 'piraten'];

// ruf: Rom-Ruf der Crew je Seed (Liste, reihum): Miles 0, Optio 8, Centurio 30. Die Crew steigt im Spiel auf; Einträge mit rang_min kommen erst dann vor.
function messe({ seeds = 6, spruenge = 1200, ruf = [0, 8, 30], seed0 = 7 } = {}) {
  const proId = {}; let ereignisse = 0, gesamt = 0;
  for (let s = 0; s < seeds; s++) {
    const seed = seed0 + s * 11;
    const t = F.neuesSpiel({ crew: 1, seed, env: { REISE_EREIGNISSE: '1' } });
    const g = t.g;
    const rufWert = Array.isArray(ruf) ? ruf[s % ruf.length] : ruf;
    if (rufWert != null) Ruf.debug(g, ['rom', String(rufWert)]);
    let zs = (seed * 2654435761) >>> 0;
    const zufall = () => { zs = (zs + 0x6D2B79F5) >>> 0; let x = zs; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    let hex = Marken.hexVon(g.ship.scene);
    for (let k = 0; k < spruenge; k++) {
      const nb = Sektoren.nachbarn(hex).filter((h) => Sektoren.spielbar(h) && Sektoren.ortVonHex(h) && !Sektoren.istLeerraum(h));
      if (nb.length) hex = nb[Math.floor(zufall() * nb.length)];
      Kriegslage.tick(g, 'messung');
      RE.zaehleSprung(g);
      gesamt++;
      const ev = RE.entscheiden(g, hex);
      if (ev) {
        ereignisse++;
        proId[ev.id] = (proId[ev.id] || 0) + 1;
        RE.abfangenVermerken(g);
        for (const o of (g.weltsim.reise.offen || []).splice(0)) void o;   // offene Notrufe verfallen im Spiel; hier nicht aufbewahren
      }
    }
  }
  const gefahren = Object.entries(proId).filter(([id]) => GEFAHR.includes((RE.KATALOG.find((e) => e.id === id) || {}).art));
  const summe = gefahren.reduce((a, [, n]) => a + n, 0);
  const ids = RE.KATALOG.filter((e) => GEFAHR.includes(e.art)).map((e) => e.id);
  return { gesamt, ereignisse, rate: ereignisse ? gesamt / ereignisse : null, summe, proId, ids, anteil: Object.fromEntries(ids.map((id) => [id, summe ? (proId[id] || 0) / summe : 0])) };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const val = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
  const r = messe({ seeds: Number(val('--seeds', 6)), spruenge: Number(val('--spruenge', 1200)), ruf: val('--ruf', null) == null ? [0, 8, 30] : Number(val('--ruf', 0)) });
  if (args.includes('--json')) console.log(JSON.stringify(r));
  else {
    console.log(`${r.gesamt} Sprünge, ${r.ereignisse} Ereignisse (1 je ${r.rate && r.rate.toFixed(1)} Sprünge), davon ${r.summe} Gefahren`);
    for (const id of r.ids) console.log(`  ${id.padEnd(26)} ${String(r.proId[id] || 0).padStart(4)}  ${(100 * r.anteil[id]).toFixed(1)} %`);
  }
}
module.exports = { messe, GEFAHR };
