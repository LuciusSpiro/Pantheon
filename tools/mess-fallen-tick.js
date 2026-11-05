'use strict';
// ITM-01 C: Tick-Zeit des Fallen-Auslösers (Fallen.update, der Aufruf aus game.step) in drei Zuständen:
//   handkarte  Handkarte kesh, keine Fallen (Normalfall; die Stand-Liste ist leer)
//   gebaut0    gebaute Karte ohne Fallen-Anker (Normalfall der Generatoren in ITM-01)
//   voll       gebaute Karte, 16 Fallen (8 verborgen, 8 erkannt), 4 Spieler stehen außerhalb jeder Auslösezone
// Echte Module aus diesem Worktree, ein echtes Game als Hülle; gemessen wird NUR Fallen.update, nicht game.step. Kein Gate-Wert, nur die Zahl für den Bericht.
//   node tools/mess-fallen-tick.js [--ticks 30000] [--json]      Exit 0 = gemessen
const { Game } = require('../server/game.js');
const interior = require('../server/sim/interior.js');
const combat = require('../server/sim/combat.js');
const Fallen = require('../server/sim/fallen.js');
const L = require('../server/sim/landepunkte.js');
const W = require('../server/world.js');
const Buehne = require('../shared/buehne.js');
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');

const args = process.argv.slice(2);
const TICKS = Math.max(1000, Number((args[args.indexOf('--ticks') + 1])) || 30000);
const DT = 1 / CONFIG.tickHz;

function spiel() {
  const g = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const cs = Array.from({ length: 4 }, () => ({ send() {}, sendRaw() {} }));
  for (const [i, c] of cs.entries()) { g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'M' + i, name: 'Mess' + i, color: i }); }
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  for (let k = 0; k < 6; k++) g.step();
  return g;
}
function runter(g) { for (const [j, p] of g.players.entries()) { interior.placeOnAwayPad(g, p, j); combat.onArrive(g, p); } g.god = true; }
function handkarte() { const g = spiel(); g.setAwayMap('kesh'); g.aways.kesh.active = true; runter(g); return g; }
// n Fallen auf erreichbare Kacheln der Rohkarte (jede dritte Kachel einer Zeile), nur für die Messung
function gebaut(n) {
  L.cacheLeeren();   // der Rohkarten-Cache gilt je Prozess: sonst käme die Karte des vorigen Aufbaus
  const bauen0 = Buehne.bauen;
  if (n) Buehne.bauen = function () {
    const k = bauen0.apply(this, arguments);
    const r = Buehne.raster(k); const belegt = new Set(k.anker.map((a) => a.x + ',' + a.y));
    let i = 0;
    for (let y = 2; y < k.h - 2 && i < n; y += 2) for (let x = 2; x < k.w - 2 && i < n; x += 5) {
      const inf = r.info(x, y);
      if (inf && inf.kante === 'begehbar' && r.durchgang(x, y) && !belegt.has(x + ',' + y)) { i++; k.anker.push({ id: 'falle.' + i, rolle: 'falle', x, y, typ: 'druck', sicht: i % 2 ? 'verborgen' : 'passiv' }); }
    }
    return k;
  };
  try {
    const g = spiel();
    const id = L.neu(g, g.ship.scene, { art: 'ruine' });
    const aw = L.get(g, id); g.setAwayMap(id); aw.active = true; runter(g);
    return g;
  } finally { Buehne.bauen = bauen0; }
}
// Spieler außerhalb jeder Auslösezone (mindestens 1,5 Kacheln von jeder Falle) parken: auf der Landefläche
function messe(g) {
  const tick = () => { g.time += DT; Fallen.update(g, DT); };
  for (let k = 0; k < 2000; k++) tick();
  const einzel = new Float64Array(TICKS);
  for (let k = 0; k < TICKS; k++) { const t0 = process.hrtime.bigint(); tick(); einzel[k] = Number(process.hrtime.bigint() - t0) / 1000; }
  const s = Array.from(einzel).sort((a, b) => a - b);
  const mittel = s.reduce((a, b) => a + b, 0) / s.length;
  return { mittel, p50: s[Math.floor(s.length * 0.5)], p99: s[Math.floor(s.length * 0.99)], max: s[s.length - 1] };
}
const zaehl = (g) => { const k = W.AWAY_MAPS[g.away.map] && W.AWAY_MAPS[g.away.map].karte; return k ? k.anker.filter((a) => a.rolle === 'falle').length : 0; };
const stand = (g) => g.away && Object.values(g.away.zustaende || {}).filter((z) => z === 'ausgeloest').length;

const a = handkarte(), ra = messe(a);
const b = gebaut(0), rb = messe(b);
const c = gebaut(16);
const nFallen = zaehl(c);
const rc = messe(c);
const ausgeloest = stand(c);

const f = (v) => v.toFixed(2);
if (args.includes('--json')) { console.log(JSON.stringify({ ticks: TICKS, handkarte: ra, gebaut0: rb, voll: rc, fallen: nFallen, ausgeloest })); process.exit(nFallen === 16 && !ausgeloest ? 0 : 1); }
console.log(`Fallen-Tick (Fallen.update), ${TICKS} Ticks je Zustand, µs je Tick:`);
console.log(`  Handkarte (keine Fallen):                           Mittel ${f(ra.mittel)}  p50 ${f(ra.p50)}  p99 ${f(ra.p99)}  max ${f(ra.max)}`);
console.log(`  gebaute Karte ohne Fallen:                          Mittel ${f(rb.mittel)}  p50 ${f(rb.p50)}  p99 ${f(rb.p99)}  max ${f(rb.max)}`);
console.log(`  gebaute Karte, ${nFallen} Fallen, 4 Spieler (nichts löst aus): Mittel ${f(rc.mittel)}  p50 ${f(rc.p50)}  p99 ${f(rc.p99)}  max ${f(rc.max)}`);
console.log(`  Zum Vergleich: Tickbudget bei ${CONFIG.tickHz} Hz = ${(1e6 / CONFIG.tickHz).toFixed(0)} µs; voll im Mittel = ${(rc.mittel / (1e6 / CONFIG.tickHz) * 100).toFixed(3)} % davon.`);
if (nFallen !== 16 || ausgeloest) { console.log('  FEHLER Aufbau nicht wie beschrieben (Fallen ' + nFallen + ', ausgelöst ' + ausgeloest + ')'); process.exit(1); }
process.exit(0);
