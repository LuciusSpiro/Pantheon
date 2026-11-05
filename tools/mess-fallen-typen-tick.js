'use strict';
// ITM-01 D: Tick-Zeit der laufenden Fallen-Wirkungen (Fallen.update mit Zeitwirkungen aus server/sim/fallen-typen.js) und die einmaligen Kosten eines Auslösens.
//   nichts   gebaute Karte (Ruine) mit 16 Fallen, nichts ausgelöst (Vergleichswert aus mess-fallen-tick.js)
//   felder   4 Spieler, 6 Gefahrenfelder (druck) laufen gleichzeitig (Dauer endlos), alle 4 Spieler stehen in mindestens einem Feld: Takt-Buchführung je Spieler und Feld
//   voll     wie felder, dazu 3 Schott-Fallen (je 2 Kanten geschlossen, Dauer endlos) und 3 Anlagen mit laufender Salve-Zeitwirkung (Salve endet nach 1,2 s; gemessen wird der Rest)
//   ausloesen  Kosten eines Auslösens je Typ (µs, Mittel über 200 frische Szenen): Schott, Druck, Salve (3 Schuss mit Sichtlinie, 4 Spieler im Bereich)
// Echte Module aus diesem Worktree, ein echtes Game als Hülle; gemessen wird NUR Fallen.update, nicht game.step. Kein Gate-Wert, nur die Zahl für den Bericht.
//   node tools/mess-fallen-typen-tick.js [--ticks 20000] [--json]      Exit 0 = gemessen
const { Game } = require('../server/game.js');
const interior = require('../server/sim/interior.js');
const combat = require('../server/sim/combat.js');
const Fallen = require('../server/sim/fallen.js');
const Anker = require('../server/sim/anker.js');
const L = require('../server/sim/landepunkte.js');
const W = require('../server/world.js');
const Buehne = require('../shared/buehne.js');
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');

const args = process.argv.slice(2);
const TICKS = Math.max(1000, Number((args[args.indexOf('--ticks') + 1])) || 20000);
const DT = 1 / CONFIG.tickHz;

function szene(setze) {
  L.cacheLeeren();
  const bauen0 = Buehne.bauen;
  Buehne.bauen = function () { const k = bauen0.apply(this, arguments); if (setze) setze(k); return k; };
  try {
    const g = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    const cs = Array.from({ length: 4 }, () => ({ send() {}, sendRaw() {} }));
    for (const [i, c] of cs.entries()) { g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'M' + i, name: 'Mess' + i, color: i }); }
    for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
    for (let k = 0; k < 6; k++) g.step();
    const id = L.neu(g, g.ship.scene, { art: 'ruine' });
    const aw = L.get(g, id); g.setAwayMap(id); aw.active = true;
    for (const [j, p] of g.players.entries()) { interior.placeOnAwayPad(g, p, j); combat.onArrive(g, p); }
    g.god = true;
    return { g, id, aw, k: W.AWAY_MAPS[id].karte };
  } finally { Buehne.bauen = bauen0; }
}
// Freie, erreichbare Kacheln in Zeilenordnung (jede 4. Kachel einer Zeile), Abstand genug, damit sich Zonen nicht überlappen
function kacheln(k, n) {
  const r = Buehne.raster(k); const belegt = new Set(k.anker.map((a) => a.x + ',' + a.y)); const out = [];
  for (let y = 2; y < k.h - 2 && out.length < n; y += 3) for (let x = 2; x < k.w - 2 && out.length < n; x += 5) {
    const i = r.info(x, y);
    if (i && i.kante === 'begehbar' && r.durchgang(x, y) && !belegt.has(x + ',' + y)) out.push({ x, y });
  }
  return out;
}
function mitFallen(spec) {
  return (k) => { const t = kacheln(k, spec.length); spec.forEach((typ, i) => k.anker.push({ id: 'falle.' + (i + 1), rolle: 'falle', x: t[i].x, y: t[i].y, typ, sicht: 'verborgen' })); };
}
function messe(g, ticks) {
  const tick = () => { g.time += DT; Fallen.update(g, DT); };
  for (let i = 0; i < 500; i++) tick();
  const einzel = new Float64Array(ticks);
  for (let i = 0; i < ticks; i++) { const t0 = process.hrtime.bigint(); tick(); einzel[i] = Number(process.hrtime.bigint() - t0) / 1000; }
  const s = Array.from(einzel).sort((a, b) => a - b);
  return { mittel: s.reduce((a, b) => a + b, 0) / s.length, p50: s[Math.floor(s.length * 0.5)], p99: s[Math.floor(s.length * 0.99)], max: s[s.length - 1] };
}
const mitte = (S, i) => Physics.tileCenter(S.k.anker.find((a) => a.id === 'falle.' + i).x, S.k.anker.find((a) => a.id === 'falle.' + i).y);
const stand = (S, ids) => ids.filter((i) => Anker.zustand(S.g, S.id, 'falle.' + i) === 'ausgeloest').length;
function lang(S) {   // Dauern endlos
  const c = S.g.C.anker.falle; c.feld.druck.dauer = 1e9; c.schott.dauer = 1e9;
}

// nichts
const A = szene(mitFallen(Array(16).fill('druck'))); lang(A);
const rn = messe(A.g, TICKS);
// felder: 6 Druckfelder, alle Spieler im ersten Feld, jedes Feld ausgelöst
const B = szene(mitFallen(Array(6).fill('druck'))); lang(B);
for (let i = 1; i <= 6; i++) { const c = mitte(B, i); const p = B.g.players[0]; p.x = c.x; p.y = c.y; Fallen.update(B.g, DT); }
const bereich = (S) => { const c = mitte(S, 1); for (const p of S.g.players) { p.x = c.x + 12; p.y = c.y; } };
bereich(B);
const nB = stand(B, [1, 2, 3, 4, 5, 6]);
const rf = messe(B.g, TICKS);
// voll: 3 Schott (Ruine hat keine Schott-Kanten: Kanten werden in die Karte gesetzt), 3 Anlagen, 4 Druckfelder
const C = szene((k) => {
  const t = kacheln(k, 10);
  const typen = ['druck', 'druck', 'druck', 'druck', 'schott', 'schott', 'schott', 'schuss', 'schuss', 'schuss'];
  typen.forEach((typ, i) => k.anker.push({ id: 'falle.' + (i + 1), rolle: 'falle', x: t[i].x, y: t[i].y, typ, sicht: 'verborgen' }));
  // je zwei Schott-Kacheln neben den Schott-Fallen (nur für die Messung)
  const D = Buehne.daten().kacheln.zeichen; if (!k.legende.S) k.legende.S = JSON.parse(JSON.stringify(D.S));
  const rows = k.rows.map((r) => r.split(''));
  [5, 6, 7].forEach((id) => { const a = k.anker.find((q) => q.id === 'falle.' + id); for (const dy of [1, 2]) { const y = a.y + dy; if (rows[y] && rows[y][a.x] === '.') { rows[y][a.x] = 'S'; } } k.kanten['mess.s' + id] = { a: 'm', b: 'm', typ: 'schott', tiles: [[a.x, a.y + 1], [a.x, a.y + 2]].filter((q) => rows[q[1]] && rows[q[1]][q[0]] === 'S'), zustand: 'offen' }; });
  k.rows = rows.map((r) => r.join(''));
});
lang(C);
for (let i = 1; i <= 10; i++) { const c = mitte(C, i); const p = C.g.players[i % 4]; p.x = c.x; p.y = c.y; Fallen.update(C.g, DT); }
bereich(C);
const nC = stand(C, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const rv = messe(C.g, TICKS);
// ausloesen: Kosten eines Auslösens je Typ
function ausloesenKosten(typ, wiederholungen) {
  let summe = 0;
  for (let i = 0; i < wiederholungen; i++) {
    const S = szene(mitFallen([typ])); lang(S);
    const c = mitte(S, 1);
    for (const [j, p] of S.g.players.entries()) { p.x = c.x + 40 + j * 8; p.y = c.y; }
    const f = Fallen.update; const p0 = S.g.players[0];
    p0.x = c.x + (typ === 'schuss' ? 20 : 0); p0.y = c.y;
    const t0 = process.hrtime.bigint(); Fallen.update(S.g, DT); summe += Number(process.hrtime.bigint() - t0) / 1000;
    if (Anker.zustand(S.g, S.id, 'falle.1') !== 'ausgeloest') { console.log('  FEHLER ' + typ + ' löste nicht aus'); process.exit(1); }
  }
  return summe / wiederholungen;
}
const WH = 15;
const ko = { schott: ausloesenKosten('schott', WH), druck: ausloesenKosten('druck', WH), schuss: ausloesenKosten('schuss', WH) };
// eine Salve (3 Schuss mit Sichtlinie, 4 Spieler) einzeln
function salve() {
  const S = szene(mitFallen(['schuss'])); const c = mitte(S, 1);
  for (const [j, p] of S.g.players.entries()) { p.x = c.x + 60 + j * 10; p.y = c.y; }
  S.g.players[0].x = c.x + 20; Fallen.update(S.g, DT);
  const t0 = process.hrtime.bigint(); for (let i = 0; i < 40; i++) { S.g.time += DT; Fallen.update(S.g, DT); } const us = Number(process.hrtime.bigint() - t0) / 1000;
  return { us, schuesse: 0 };
}
const sv = salve();

const f = (v) => v.toFixed(2);
if (args.includes('--json')) { console.log(JSON.stringify({ ticks: TICKS, nichts: rn, felder: rf, voll: rv, ausloesen: ko, salve40ticks: sv.us, ausgeloestFelder: nB, ausgeloestVoll: nC })); process.exit(nB === 6 && nC === 10 ? 0 : 1); }
console.log(`Fallen-Tick mit laufenden Wirkungen (Fallen.update), ${TICKS} Ticks je Zustand, µs je Tick:`);
console.log(`  16 Fallen, nichts ausgelöst:                              Mittel ${f(rn.mittel)}  p50 ${f(rn.p50)}  p99 ${f(rn.p99)}  max ${f(rn.max)}`);
console.log(`  6 Gefahrenfelder laufen, 4 Spieler im Feld:               Mittel ${f(rf.mittel)}  p50 ${f(rf.p50)}  p99 ${f(rf.p99)}  max ${f(rf.max)}`);
console.log(`  4 Felder + 3 Schott + 3 Anlagen (alle ausgelöst), 4 Sp.:  Mittel ${f(rv.mittel)}  p50 ${f(rv.p50)}  p99 ${f(rv.p99)}  max ${f(rv.max)}`);
console.log(`  Auslösen einmalig (µs, Mittel über ${WH}): Schott ${f(ko.schott)}, Druck ${f(ko.druck)}, Anlage ${f(ko.schuss)}; Salve über 40 Ticks (3 Schuss, 4 Spieler): ${f(sv.us)} µs`);
console.log(`  Zum Vergleich: Tickbudget bei ${CONFIG.tickHz} Hz = ${(1e6 / CONFIG.tickHz).toFixed(0)} µs; voll im Mittel = ${(rv.mittel / (1e6 / CONFIG.tickHz) * 100).toFixed(3)} % davon.`);
if (nB !== 6 || nC !== 10) { console.log('  FEHLER Aufbau nicht wie beschrieben (Felder ' + nB + ', voll ' + nC + ')'); process.exit(1); }
process.exit(0);
