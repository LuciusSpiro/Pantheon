'use strict';
// SCA-01 NS M4c: Tick-Zeit des Scanners. Misst Mikrosekunden je Tick für Scanbar.update + Scanner.update (die beiden Aufrufe aus game.step) in zwei Zuständen:
//   leer   niemand scannt, aw.sc leer (früher Rücksprung in beiden Modulen)
//   voll   4 Scannende (p.scan, p.hold) und 16 Einträge in aw.sc (18 Ziele geliefert, Obergrenze greift), ziele() liefert eine fertige Liste (billig, wie im Vertrag verlangt)
// Echte Module aus diesem Worktree, ein echtes Game-Objekt als Hülle; gemessen wird NUR der Scanner-Anteil, nicht game.step. Kein Gate-Wert, nur die Zahl für den Bericht.
//   node tools/mess-scanner-tick.js [--ticks 30000] [--json]      Exit 0 = gemessen
const { Game } = require('../server/game.js');
const interior = require('../server/sim/interior.js');
const combat = require('../server/sim/combat.js');
const Scanner = require('../server/sim/scanner.js');
const Scanbar = require('../server/sim/scanbar.js');
const CONFIG = require('../shared/config.js');

const args = process.argv.slice(2);
const TICKS = Math.max(1000, Number((args[args.indexOf('--ticks') + 1])) || 30000);
const DT = 1 / CONFIG.tickHz;

function szene() {
  const g = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const cs = Array.from({ length: 4 }, () => ({ send() {}, sendRaw() {} }));
  for (const [i, c] of cs.entries()) { g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'M' + i, name: 'Mess' + i, color: i }); }
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  for (let k = 0; k < 6; k++) g.step();
  g.setAwayMap('kesh'); g.aways.kesh.active = true;
  for (const [j, p] of g.players.entries()) { interior.placeOnAwayPad(g, p, j); combat.onArrive(g, p); }
  g.god = true;
  return g;
}

// ein Tick: die beiden Scanner-Aufrufe aus game.step; Zeit läuft mit (Drossel der Aufräumprüfung über game.time)
function tick(g, vor) { g.time += DT; if (vor) vor(); Scanbar.update(g); Scanner.update(g, DT); }
function messe(g, vor) {
  for (let k = 0; k < 2000; k++) tick(g, vor);   // Warmlauf (JIT)
  const einzel = new Float64Array(TICKS);
  for (let k = 0; k < TICKS; k++) { const t0 = process.hrtime.bigint(); tick(g, vor); einzel[k] = Number(process.hrtime.bigint() - t0) / 1000; }
  const s = Array.from(einzel).sort((a, b) => a - b);
  const mittel = s.reduce((a, b) => a + b, 0) / s.length;
  return { mittel, p50: s[Math.floor(s.length * 0.5)], p99: s[Math.floor(s.length * 0.99)], max: s[s.length - 1] };
}

const leer = messe(szene());

const g = szene();
const p0 = g.players[0];
const liste = Array.from({ length: 18 }, (_, i) => ({ id: 'm' + String(i + 1).padStart(2, '0'), typ: 'raider', x: p0.x + 12 * (i + 1), y: p0.y + (i % 3) * 20 }));
Scanbar.scanbarAnmelden('monster', { ziele: () => liste });
Scanbar.debugScanfertig(g, p0, 3);
const eintraege = g.away.sc ? Object.keys(g.away.sc).length : 0;
for (const p of g.players) { p.scanBis = 0; p.hold = null; Scanner.scanStarten(g, p); }
const scannende = g.players.filter((p) => p.scan).length;
// Fortschritt festhalten: kein Scan wird vollendet, jeder Tick rechnet die Frequenz (Abst.schritt) wirklich
const halten = () => { for (const p of g.players) if (p.scan) p.scan.halt = Math.min(p.scan.halt, 0.5); };
const voll = messe(g, halten);
const noch = g.players.filter((p) => p.scan).length;

const f = (v) => v.toFixed(2);
if (args.includes('--json')) { console.log(JSON.stringify({ ticks: TICKS, leer, voll, scannende, eintraege })); process.exit(scannende === 4 && eintraege === 16 && noch === 4 ? 0 : 1); }
console.log(`Scanner-Tick (Scanbar.update + Scanner.update), ${TICKS} Ticks je Zustand, µs je Tick:`);
console.log(`  leer (niemand scannt, aw.sc leer):                  Mittel ${f(leer.mittel)}  p50 ${f(leer.p50)}  p99 ${f(leer.p99)}  max ${f(leer.max)}`);
console.log(`  voll (${scannende} Scannende, ${eintraege} Einträge in aw.sc, 18 Ziele):   Mittel ${f(voll.mittel)}  p50 ${f(voll.p50)}  p99 ${f(voll.p99)}  max ${f(voll.max)}`);
console.log(`  Zum Vergleich: Tickbudget bei ${CONFIG.tickHz} Hz = ${(1e6 / CONFIG.tickHz).toFixed(0)} µs; voll im Mittel = ${(voll.mittel / (1e6 / CONFIG.tickHz) * 100).toFixed(3)} % davon.`);
if (scannende !== 4 || eintraege !== 16 || noch !== 4) { console.log('  FEHLER Aufbau nicht wie beschrieben (Scannende ' + scannende + '/' + noch + ', Einträge ' + eintraege + ')'); process.exit(1); }
process.exit(0);
