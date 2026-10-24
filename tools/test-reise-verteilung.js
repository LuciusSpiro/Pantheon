'use strict';
// SUND-03 F8: Verteilung der Reise-Ereignisse über viele Sprünge (tools/messe-reise.js, Zufallsgang, Rang-Mix Miles/Optio/Centurio, echte Entscheidung). Jede Gefahr-Id kommt vor, keine stellt mehr als
// 35 % der Gefahren (alle Gefahren und Patrouillen plus Piraten getrennt gezählt: so hat der Prüfer gemessen), die Rate bleibt bei einem Ereignis je 6 bis 8 Sprünge. Der Katalog bleibt Daten
// (content/reise/ereignisse.json): ein Gewicht oder eine Bedingung, die eine Id verdrängt, macht diesen Test rot.
//   node tools/test-reise-verteilung.js   (npm run test:reise-verteilung)
const { messe } = require('./messe-reise.js');
const RE = require('../server/sim/reise-ereignis.js');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

const r = messe({ seeds: 6, spruenge: 1000 });
console.log(`  ${r.gesamt} Sprünge, ${r.ereignisse} Ereignisse, ${r.summe} Gefahren`);
for (const id of r.ids) console.log(`    ${id.padEnd(26)} ${String(r.proId[id] || 0).padStart(4)}  ${(100 * r.anteil[id]).toFixed(1)} %`);
ok(r.rate >= 6 && r.rate <= 8, `Rate: ein Ereignis je ${r.rate.toFixed(1)} Sprünge (6 bis 8)`);
ok(r.ids.every((id) => (r.proId[id] || 0) >= 1), 'jede Gefahr-Id kommt vor (' + r.ids.filter((id) => !(r.proId[id] || 0)).join(', ') + ' fehlt)');
const max = Math.max(...Object.values(r.anteil));
ok(max <= 0.35, `keine Id stellt mehr als 35 % aller Gefahren (größter Anteil ${(100 * max).toFixed(1)} %)`);
const sub = r.ids.filter((id) => ['patrouille', 'piraten'].includes(RE.KATALOG.find((e) => e.id === id).art));
const summeSub = sub.reduce((a, id) => a + (r.proId[id] || 0), 0);
const maxSub = Math.max(...sub.map((id) => (r.proId[id] || 0) / summeSub));
ok(maxSub <= 0.35, `und keine mehr als 35 % der Patrouillen und Piraten (größter Anteil ${(100 * maxSub).toFixed(1)} %)`);
ok(r.ids.every((id) => (r.proId[id] || 0) / r.summe >= 0.01), 'jede Id hat mindestens 1 % der Gefahren');
console.log(`\n${n - fails} von ${n} ok` + (fails ? `, ${fails} FEHLER` : ''));
process.exit(fails ? 1 : 0);
