'use strict';
// SUND-03 F8/F2: Verteilung der Reise-Ereignisse über viele Sprünge (tools/messe-reise.js, Zufallsgang, echte Entscheidung) mit vier Seed-Sätzen (seed0 7, 101, 555, 9001). Geschützt sind die URSACHEN der
// schiefen Verteilung aus der Messung der Erkundung (Späher 195 von 328 Gefahren, Rudel nie):
//   - der Späher kommt nie auf freiem Gebiet (Piraten-Land: dort gehören die Piraten-Einträge hin),
//   - das Rudel tritt schon bei Rang Optio auf (nicht erst ab Centurio), ebenso Streife und Belagerung am Posten,
//   - im Rang-Mix (Miles/Optio/Centurio reihum) kommt jede Gefahr-Id vor, keine stellt mehr als 35 % aller Gefahren und der Späher höchstens 40 % der Patrouillen und Piraten,
//   - die Rate bleibt bei einem Ereignis je 6 bis 8 Sprünge.
// Der Miles-Fall (Crew ohne Rang) wird ehrlich ausgewiesen: der Späher ist dort die einzige Gefahr in germanischem Gebiet (Streife, Belagerung am Posten und Rudel verlangen einen Rang: rang_min, gewollt);
// sein Anteil unter Patrouillen und Piraten liegt bei 35 bis 45 %, die Schranke dort ist 50 %.
//   node tools/test-reise-verteilung.js   (npm run test:reise-verteilung)
const { messe } = require('./messe-reise.js');
const RE = require('../server/sim/reise-ereignis.js');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const SPAEHER = 'patrouille_ger_spaeher', RUDEL = 'piraten_rudel', STREIFE = 'patrouille_ger_streife', BELAGERUNG = 'notruf_belagerung_posten';
const teilmenge = (r) => r.ids.filter((id) => ['patrouille', 'piraten'].includes(RE.KATALOG.find((e) => e.id === id).art));
const anteilSpaeher = (r) => { const sub = teilmenge(r); const summe = sub.reduce((a, id) => a + (r.proId[id] || 0), 0); return (r.proId[SPAEHER] || 0) / summe; };

for (const seed0 of [7, 101, 555, 9001]) {
  console.log(`\nSeed-Satz ${seed0}`);
  const mix = messe({ seeds: 6, spruenge: 1000, seed0 });
  const optio = messe({ seeds: 6, spruenge: 1000, seed0, ruf: [8] });
  const miles = messe({ seeds: 6, spruenge: 1000, seed0, ruf: [0] });
  const max = Math.max(...Object.values(mix.anteil));
  console.log(`    Mix: ${mix.ereignisse} Ereignisse (1 je ${mix.rate.toFixed(1)}), größter Anteil ${(100 * max).toFixed(1)} %, Späher ${(100 * anteilSpaeher(mix)).toFixed(1)} % der Patrouillen/Piraten; Miles: Späher ${(100 * anteilSpaeher(miles)).toFixed(1)} %`);
  ok(mix.rate >= 6 && mix.rate <= 8 && optio.rate >= 6 && optio.rate <= 8 && miles.rate >= 6 && miles.rate <= 8, `Rate: ein Ereignis je ${mix.rate.toFixed(1)} / ${optio.rate.toFixed(1)} / ${miles.rate.toFixed(1)} Sprünge (Mix/Optio/Miles, 6 bis 8)`);
  ok(mix.ids.every((id) => (mix.proId[id] || 0) >= 1), 'Rang-Mix: jede Gefahr-Id kommt vor (' + mix.ids.filter((id) => !(mix.proId[id] || 0)).join(', ') + ' fehlt)');
  ok(max <= 0.35, `keine Id stellt mehr als 35 % aller Gefahren (${(100 * max).toFixed(1)} %)`);
  ok(anteilSpaeher(mix) <= 0.40, `Späher höchstens 40 % der Patrouillen und Piraten (${(100 * anteilSpaeher(mix)).toFixed(1)} %)`);
  const spFrei = [mix, optio, miles].reduce((a, r) => a + ((r.proBesitzer[SPAEHER] || {}).frei || 0), 0);
  ok((mix.proId[SPAEHER] || 0) > 20 && spFrei === 0, `der Späher kommt nie auf freiem Gebiet (${spFrei} von ${mix.proId[SPAEHER]}+ Spähern)`);
  ok((optio.proId[RUDEL] || 0) >= 10 && (optio.proId[STREIFE] || 0) >= 10 && (optio.proId[BELAGERUNG] || 0) >= 10, `bei Rang Optio: Rudel ${optio.proId[RUDEL]}, Streife ${optio.proId[STREIFE]}, Belagerung am Posten ${optio.proId[BELAGERUNG]} (je mindestens 10)`);
  ok(!(miles.proId[RUDEL] || miles.proId[STREIFE] || miles.proId[BELAGERUNG]) && anteilSpaeher(miles) <= 0.5, `Miles (gewollt): Rudel, Streife und Belagerung am Posten verlangen einen Rang; Späher ${(100 * anteilSpaeher(miles)).toFixed(1)} % (≤ 50 %)`);
}
console.log(`\n${n - fails} von ${n} ok` + (fails ? `, ${fails} FEHLER` : ''));
process.exit(fails ? 1 : 0);
