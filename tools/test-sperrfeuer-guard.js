'use strict';
// SPT-02 10: Sperrfeuer-Guard der Breitseiten-Schiffe (space.js updateSperrfeuer: „kurz vor einer Ladung keinen Stoß beginnen“). Der Guard sperrt den Stoß nur, wenn eine
// Ladung auch beginnen kann: Lanze im Bogen auf das Ziel (enemyCanHit), Reichweite, Intervall. Liegt die Lanze am Bug und steht die Lerche querab, startet nie eine Ladung –
// früher blieb e.fireT über der Schwelle und die Batterie schoss kaum noch (1 Stoß in 200 s statt 54).
//   node tools/test-sperrfeuer-guard.js
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const DT = 1 / CONFIG.tickHz;

function arena(seed) {
  const g = new Game({ noStore: true, seed: seed || 31, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'W0', name: 'W0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' });
  g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = []; g.space.projectiles = []; g.god = true;
  const sh = g.ship; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; sh.vx = 0; sh.vy = 0; sh.turnVel = 0;
  return g;
}
// Ein Schiff mit vorgegebener Bestückung gegen die stehende Lerche; zählt Stöße und Ladungen ab Sekunde `ab`
function messe(kind, waffen, seed, ab, dauer) {
  const g = arena(seed);
  const e = space.spawnEnemy(g, kind, { angle: 0.7 + seed / 10, tag: 'sonde', waffen });
  const zaehl = () => ({ stoesse: (g.stats.sperrfeuer || { bursts: 0 }).bursts, ladungen: (g.stats.heavyHits || 0) + (g.stats.teleMisses || 0) });
  for (let i = 0, N = Math.round(ab / DT); i < N; i++) g.step();
  const a = zaehl();
  let lanzeImBogen = 0, ticks = 0, b0 = a.stoesse; const starts = [];
  for (let i = 0, N = Math.round(dauer / DT); i < N; i++) {
    const fT = e.fireT;
    g.step(); ticks++;
    if (!g.space.enemies.includes(e)) break;
    const im = space.enemyCanHit(g, e, null, 'lanze'); if (im) lanzeImBogen++;
    const bn = (g.stats.sperrfeuer || { bursts: 0 }).bursts;
    if (bn > b0) { b0 = bn; starts.push({ fireT: fT, im, d: Math.hypot(e.x - g.ship.x, e.y - g.ship.y) }); }   // Stoßstart in diesem Tick: fireT davor
  }
  const b = zaehl();
  return { starts, teleIv: CONFIG.enemies[kind].fireInterval * CONFIG.crewScaling[1].enemyFireInterval,   // Ladeintervall (ein Spieler = solo)
     burstDur: (CONFIG.spaceS2b.sperrfeuer.burst - 1) * CONFIG.spaceS2b.sperrfeuer.burstGap, stoesse: b.stoesse - a.stoesse, ladungen: b.ladungen - a.ladungen, lanzeAnteil: lanzeImBogen / ticks, tot: !g.space.enemies.includes(e), errors: g.errors || 0 };
}

const SEEDS = [31, 32, 33];
console.log('Lanze am Bug, Batterie an beiden Seiten, Lerche querab: Lanze nie im Bogen, Sperrfeuer läuft (vorher 0 Stöße in 80 s)');
for (const seed of SEEDS) {
  const r = messe('korvette', { bug: 'lanze', stbd: 'batterie', bb: 'batterie' }, seed, 20, 80);
  ok(!r.tot && r.errors === 0, 'Seed ' + seed + ': Korvette lebt, keine Fehler');
  ok(r.lanzeAnteil < 0.2, 'Seed ' + seed + ': die Lanze am Bug liegt fast nie im Bogen der Lerche (' + (r.lanzeAnteil * 100).toFixed(0) + ' % der Ticks)');
  ok(r.stoesse >= 10, 'Seed ' + seed + ': Stöße in 80 s >= 10 (' + r.stoesse + ', vorher 0)');
  ok(r.ladungen === 0, 'Seed ' + seed + ': keine Lanzen-Ladung (' + r.ladungen + ')');
}

console.log('\nLanze auf der zugewandten Seite, Batterie auf der Gegenseite: Lanze lädt, der Stoß der abgewandten Batterie fehlt wie bisher');
for (const seed of SEEDS) {
  const r = messe('korvette', { bug: 'bolzen', stbd: 'lanze', bb: 'batterie' }, seed, 20, 80);
  ok(r.ladungen >= 3 && r.stoesse === 0, 'Seed ' + seed + ': Ladungen ' + r.ladungen + ' >= 3, Stöße ' + r.stoesse + ' = 0');
}

console.log('\nLanze im Bogen und Batterie im Bogen (Fregatte, je Seite Lanze + Batterie): der Guard greift weiter wie bisher');
for (const seed of SEEDS) {
  const r = messe('fregatte', { bug: 'bolzen', stbd1: 'lanze', stbd2: 'batterie', bb1: 'lanze', bb2: 'batterie' }, seed, 20, 80);
  ok(r.lanzeAnteil > 0.3, 'Seed ' + seed + ': die Lanze liegt im Bogen (' + (r.lanzeAnteil * 100).toFixed(0) + ' % der Ticks)');
  ok(r.ladungen >= 3, 'Seed ' + seed + ': Ladungen laufen (' + r.ladungen + ')');
  ok(r.stoesse <= 0.8 * 80 / CONFIG.spaceS2b.sperrfeuer.interval, 'Seed ' + seed + ': Stöße bleiben unter dem freien Takt, weil vor jeder Ladung Ruhe herrscht (' + r.stoesse + ' von höchstens ' + Math.floor(0.8 * 80 / CONFIG.spaceS2b.sperrfeuer.interval) + ')');
  const imB = r.starts.filter((s) => s.im && s.d <= CONFIG.enemies.fregatte.range);
  ok(r.teleIv > 0 && imB.length >= 3, 'Seed ' + seed + ': Stöße beginnen auch mit der Lanze im Bogen (' + imB.length + ' Stöße, Ladeintervall ' + r.teleIv.toFixed(2) + ' s)');
  ok(imB.every((s) => s.fireT + r.burstDur + 0.5 < r.teleIv + 0.1), 'Seed ' + seed + ': kein Stoß beginnt kurz vor einer Ladung (spätester Stoßstart bei fireT ' + Math.max(0, ...imB.map((s) => s.fireT)).toFixed(2) + ' s, Grenze ' + (r.teleIv - r.burstDur - 0.5).toFixed(2) + ' s)');
}

console.log('\nGuard unmittelbar (ein Tick, Stoß bereit, Schiff steht mit der Steuerbordseite zur Lerche, 300 px)');
// Setzt Lage und Zähler, lässt einen Tick laufen und meldet, ob ein Stoß begann (und ob eine Ladung)
function eintick(kind, waffen, fireT, abstand) {
  const g = arena(31);
  const e = space.spawnEnemy(g, kind, { angle: 0, tag: 'sonde', waffen });
  for (let i = 0; i < 5; i++) g.step();
  const sh = g.ship; e.x = sh.x - abstand; e.y = sh.y; e.angle = -Math.PI / 2; e.vx = 0; e.vy = 0;   // Lerche liegt in Richtung 0 = Steuerbord (Platzrichtung +90 Grad)
  e.fireT = fireT; e.tele = null; e.sf = { t: 100, left: 0, gapT: 0, n: 0 };
  const b0 = (g.stats.sperrfeuer || { bursts: 0 }).bursts;
  g.step();
  return { stoss: (g.stats.sperrfeuer || { bursts: 0 }).bursts > b0, ladung: !!e.tele, bogen: space.enemyCanHit(g, e, null, 'lanze') };
}
{
  const IV = CONFIG.enemies.fregatte.fireInterval * CONFIG.crewScaling[1].enemyFireInterval;   // Ladeintervall (ein Spieler = solo)
  const LB = { bug: 'bolzen', stbd1: 'lanze', stbd2: 'batterie', bb1: 'bolzen', bb2: 'bolzen' };   // Lanze und Batterie auf der zugewandten Seite
  const LG = { bug: 'bolzen', stbd1: 'batterie', stbd2: 'batterie', bb1: 'lanze', bb2: 'bolzen' };   // Lanze auf der abgewandten Seite
  let r = eintick('fregatte', LB, IV - 0.6, 300);
  ok(r.bogen && !r.stoss && !r.ladung, 'Lanze im Bogen, Ladung in 0,6 s: kein Stoß, noch keine Ladung (Guard greift; Bogen ' + r.bogen + ', Stoß ' + r.stoss + ')');
  r = eintick('fregatte', LB, IV - 2, 300);
  ok(r.bogen && r.stoss && !r.ladung, 'Lanze im Bogen, Ladung erst in 2 s: der Stoß beginnt (Stoß ' + r.stoss + ')');
  r = eintick('fregatte', LG, IV - 0.6, 300);
  ok(!r.bogen && r.stoss, 'Lanze nicht im Bogen, Ladung wäre in 0,6 s fällig: der Stoß beginnt trotzdem (der Fehler: früher gesperrt; Bogen ' + r.bogen + ', Stoß ' + r.stoss + ')');
  r = eintick('fregatte', LG, IV + 5, 300);
  ok(!r.bogen && r.stoss && !r.ladung, 'Lanze nicht im Bogen, e.fireT weit über dem Ladeintervall: Stoß, keine Ladung (Stoß ' + r.stoss + ', Ladung ' + r.ladung + ')');
  r = eintick('fregatte', LB, IV + 0.05, 300);
  ok(r.bogen && r.ladung && !r.stoss, 'Lanze im Bogen, Ladung fällig: die Ladung beginnt, kein Stoß (Ladung ' + r.ladung + ', Stoß ' + r.stoss + ')');
  r = eintick('fregatte', LB, IV - 0.6, 510);
  ok(!r.bogen && r.stoss, 'Lanze im Bogen, aber außerhalb ihrer Reichweite (510 px), im Band zum Sperrfeuer: der Stoß beginnt (Bogen ' + r.bogen + ', Stoß ' + r.stoss + ')');
}

console.log(fails ? '\n' + fails + ' FEHLER von ' + n : '\n' + n + '/' + n + ' ok');
process.exit(fails ? 1 : 0);
