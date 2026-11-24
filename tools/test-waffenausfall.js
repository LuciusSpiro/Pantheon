'use strict';
// SPT-02 9: Wenden bei Waffenausfall (pilot.js breitseite, Daten spaceM3b.pilot.waffenWechsel). Ist jede Waffe der der Lerche zugewandten Seite zerstört und hat die
// Gegenseite noch eine, wechselt das Boot die Seite und schießt wieder; nur der tatsächliche Ausfall zählt (nicht die Waffenart, EK1a), mit Verzug und Abklingzeit.
//   node tools/test-waffenausfall.js
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Testhilfe = require('./gegner-testhilfe.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const DT = 1 / CONFIG.tickHz;
const PW = CONFIG.spaceM3b.pilot.waffenWechsel;
const SEITE = ['bug', 'stbd', 'heck', 'bb'];

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
// Korvette mit Bolzen auf allen Plätzen; die Lerche steht (Standard) oder fährt (fahrt: Kreis, 28 px/s)
function szene(opts) {
  const g = arena(opts && opts.seed);
  const e = space.spawnEnemy(g, 'korvette', { angle: (opts && opts.angle) || 0.7, tag: 'sonde', waffen: { bug: 'bolzen', stbd: 'bolzen', bb: 'bolzen' } });
  const sh = g.ship; let ang = 0; const om = 0.04, R0 = 700;
  const st = { g, e, sh, t: 0, schuss: 0, seen: new Set(), wechsel: [], facing: null, sideWechsel: 0, side: e.side };
  st.tick = () => {
    if (opts && opts.fahrt) { ang += om * DT; sh.x = g.space.w / 2 + Math.cos(ang) * R0; sh.y = g.space.h / 2 + Math.sin(ang) * R0; sh.angle = ang + Math.PI / 2; sh.vx = -Math.sin(ang) * R0 * om; sh.vy = Math.cos(ang) * R0 * om; }
    if (e.shields) { e.shields[1] = 2; e.shields[3] = 2; }   // die Schildregel (schwaches Segment) soll nicht mitwechseln: nur der Waffenausfall unterscheidet
    g.step(); st.t += DT;
    for (const p of g.space.projectiles) if (p.owner === e.id && !st.seen.has(p.id)) { st.seen.add(p.id); st.schuss++; }
    if (e.side !== st.side) { st.sideWechsel++; st.side = e.side; }   // Umlauf auf die andere Seite des Sollpunkts
    const sec = Physics.sectorOf(e.x, e.y, e.angle, sh.x, sh.y);
    if ((sec === 1 || sec === 3) && sec !== st.facing) { if (st.facing != null) st.wechsel.push(+st.t.toFixed(1)); st.facing = sec; }
  };
  st.lauf = (s) => { for (let i = 0, N = Math.round(s / DT); i < N; i++) st.tick(); };
  st.sec = () => Physics.sectorOf(e.x, e.y, e.angle, sh.x, sh.y);
  const ids = (seite) => Object.keys(e.sys).filter((k) => k.startsWith('waffe_' + SEITE[seite]));
  st.zerstoere = (seite) => { for (const id of ids(seite)) Testhilfe.setzeIntegritaet(e, id, 0); };
  st.heile = (seite) => { for (const id of ids(seite)) Testhilfe.setzeIntegritaet(e, id, 1); };
  st.halte = (seite) => { for (const id of ids(seite)) if (e.sys[id].z !== 'broken') Testhilfe.setzeIntegritaet(e, id, 0); };   // der Gegner repariert sonst selbst
  // bis eine Seite (1 oder 3) zur Lerche steht (ruhe s am Stück, Standard 10, nach 40 s)
  st.einschwingen = (max, ruhe) => { let stabil = 0; for (let i = 0, N = Math.round((max || 150) / DT); i < N; i++) { st.tick(); const sc = st.sec(); stabil = (sc === 1 || sc === 3) ? stabil + DT : 0; if (st.t > 40 && stabil >= (ruhe || 10)) return true; } return false; };
  return st;
}

console.log('Daten');
ok(PW && PW.an === true && PW.verzug > 0, 'spaceM3b.pilot.waffenWechsel (an, verzug) steht in den Daten');

console.log('\nWaffe der zugewandten Seite zerstört (Lerche steht), beide Seiten (Steuerbord und Backbord)');
{
  const gesehen = new Set();
  for (const [seed, angle] of [[31, 0.7], [32, -0.7], [33, 2.4], [34, -2.4], [35, 1.6], [36, -1.6]]) {

    const s = szene({ seed, angle });
    if (!s.einschwingen()) { ok(false, 'Seed ' + seed + ': Boot liegt mit einer Seite zur Lerche'); continue; }
    const alt = s.sec(), neu = alt === 1 ? 3 : 1; gesehen.add(alt);
    const T = 'Seed ' + seed + ', Start ' + angle + ' rad' + ' (' + SEITE[alt] + ' fällt aus): ';
    s.zerstoere(alt); s.facing = alt; const s0 = s.schuss, w0 = s.wechsel.length, sw0 = s.sideWechsel;
    for (let i = 0, N = Math.round(120 / DT); i < N; i++) { s.halte(alt); s.tick(); }
    ok(s.schuss - s0 > 0, T + 'Schüsse nach dem Ausfall > 0 (' + (s.schuss - s0) + ', vorher 0 in 180 s)');
    ok(s.sec() === neu, T + 'zugewandt ist die Seite mit funktionierender Waffe (' + SEITE[s.sec()] + ')');
    ok(s.wechsel.length - w0 >= 1 && s.wechsel.length - w0 <= 2, T + 'höchstens zwei Wechsel, kein Flattern (' + (s.wechsel.length - w0) + ')');
    ok(s.sideWechsel === sw0, T + 'das Boot dreht auf seinem Platz, kein Umlauf (Platzwechsel ' + (s.sideWechsel - sw0) + ')');
    const w1 = s.wechsel.length; let zuAlt = 0;
    for (let i = 0, N = Math.round(60 / DT); i < N; i++) { s.halte(alt); s.tick(); if (s.sec() === alt) zuAlt++; }
    ok(s.wechsel.length === w1 && zuAlt === 0, T + '60 s später kein Rückwechsel: die ausgefallene Seite zeigt nie wieder zur Lerche (' + zuAlt + ' Ticks)');
  }
  ok(gesehen.size === 2, 'beide Seiten kamen als zugewandte ausgefallene Seite vor (' + [...gesehen].map((x) => SEITE[x]).join(', ') + ')');
}

console.log('\nWaffe der zugewandten Seite funktioniert: kein Wechsel');
{
  const s = szene();
  ok(s.einschwingen(), 'Boot liegt mit einer Seite zur Lerche');
  const alt = s.sec(), neu = alt === 1 ? 3 : 1;
  s.zerstoere(neu); s.facing = alt; const w0 = s.wechsel.length, s0 = s.schuss;
  for (let i = 0, N = Math.round(120 / DT); i < N; i++) { s.halte(neu); s.tick(); }
  ok(s.sec() === alt && s.wechsel.length === w0, 'ausgefallen ist nur die abgewandte Seite: das Boot bleibt (' + SEITE[s.sec()] + ', Wechsel ' + (s.wechsel.length - w0) + ')');
  ok(s.schuss - s0 > 0, 'es schießt weiter (' + (s.schuss - s0) + ')');
}

console.log('\nBeide Seiten ausgefallen: kein Wechsel (beide Startlagen)');
for (const [seed, angle] of [[31, 0.7], [32, -0.7]]) {
  const s = szene({ seed, angle });
  ok(s.einschwingen(), 'Boot liegt mit einer Seite zur Lerche');
  const alt = s.sec(); s.zerstoere(1); s.zerstoere(3); s.facing = alt; const w0 = s.wechsel.length, sw0 = s.sideWechsel;
  for (let i = 0, N = Math.round(90 / DT); i < N; i++) { s.halte(1); s.halte(3); s.tick(); }
  ok(s.wechsel.length === w0 && s.sideWechsel === sw0 && s.sec() === alt, 'ohne funktionierende Waffe auf der Gegenseite bleibt es liegen (' + SEITE[alt] + ', Wechsel ' + (s.wechsel.length - w0) + ', Sektor ' + s.sec() + ' statt ' + alt + ')');
}

console.log('\nSchalter aus (Daten): wie zuvor, kein Wechsel');
{
  PW.an = false;
  const s = szene();
  ok(s.einschwingen(), 'Boot liegt mit einer Seite zur Lerche');
  const alt = s.sec(); s.zerstoere(alt); s.facing = alt; const w0 = s.wechsel.length, s0 = s.schuss;
  for (let i = 0, N = Math.round(90 / DT); i < N; i++) { s.halte(alt); s.tick(); }
  ok(s.wechsel.length === w0 && s.sec() === alt && s.schuss === s0, 'waffenWechsel.an false: kein Wechsel, keine Schüsse (Wechsel ' + (s.wechsel.length - w0) + ', Schüsse ' + (s.schuss - s0) + ')');
  PW.an = true;
}

console.log('\nLerche fährt: Seitenwechsel mit Abklingzeit');
{
  const s = szene({ fahrt: true });
  ok(s.einschwingen(200, 13), 'Boot liegt seit 13 s mit einer Seite zur fahrenden Lerche (Abklingzeiten abgelaufen)');
  const K = CONFIG.spaceM3b.pilotKlasse.korvette.switchCd;
  const alt = s.sec();
  s.zerstoere(alt); const side0 = s.e.side; let tFlip = null; const t0 = s.t;
  for (let i = 0, N = Math.round(40 / DT); i < N && tFlip === null; i++) { s.halte(alt); s.tick(); if (s.e.side !== side0) tFlip = s.t - t0; }
  ok(tFlip !== null && tFlip >= PW.verzug - 0.2 && tFlip <= PW.verzug + 1, 'die Seite wird nach dem Verzug sofort gewechselt (nach ' + (tFlip == null ? '-' : tFlip.toFixed(1)) + ' s)');
  // sofort danach fällt auch die neue Seite aus, die alte ist heil: die Abklingzeit hält das Boot K s auf seiner Seite
  const neu = alt === 1 ? 3 : 1;
  s.heile(alt); s.zerstoere(neu); const side1 = s.e.side; const cd = s.e.switchCd; let tZweit = null; const t1 = s.t;
  ok(cd > K - 2 && cd <= K, 'Abklingzeit nach dem Wechsel gesetzt (' + cd.toFixed(1) + ' s von ' + K + ' s)');
  for (let i = 0, N = Math.round((K + 25) / DT); i < N && tZweit === null; i++) { s.halte(neu); s.tick(); if (s.e.side !== side1) tZweit = s.t - t1; }
  ok(tZweit === null || tZweit >= cd - 0.5, 'kein zweiter Wechsel vor Ablauf der Abklingzeit (' + (tZweit == null ? 'keiner' : tZweit.toFixed(1) + ' s') + ')');
}

console.log('\nLerche fährt: Verzug, danach kein weiterer Wechsel');
{
  const s = szene({ fahrt: true });
  ok(s.einschwingen(200, 13), 'Boot liegt seit 13 s mit einer Seite zur fahrenden Lerche (Abklingzeiten abgelaufen)');
  const alt = s.sec();
  // kurzer Ausfall unter dem Verzug: nach der Reparatur bleibt die Seite
  s.zerstoere(alt); const side0 = s.e.side; s.lauf(PW.verzug * 0.5); s.heile(alt);
  const sw0 = s.sideWechsel; s.lauf(8);
  ok(s.sideWechsel === sw0 && s.e.side === side0, 'Ausfall von ' + (PW.verzug * 0.5) + ' s (Verzug ' + PW.verzug + ' s): kein Wechsel');
  // Ausfall bleibt: ein Wechsel nach dem Verzug, danach liegt die funktionierende Seite zur Lerche und es folgt keiner mehr
  s.zerstoere(alt); let tFlip = null; const t0 = s.t;
  for (let i = 0, N = Math.round(40 / DT); i < N && tFlip === null; i++) { s.halte(alt); s.tick(); if (s.e.side !== side0) tFlip = s.t - t0; }
  ok(tFlip !== null && tFlip >= PW.verzug - 0.2 && tFlip <= PW.verzug + 5, 'Wechsel erst nach dem Verzug, dann zügig (' + (tFlip == null ? '-' : tFlip.toFixed(1)) + ' s)');
  const sw1 = s.sideWechsel; for (let i = 0, N = Math.round(60 / DT); i < N; i++) { s.halte(alt); s.tick(); }
  ok(s.sideWechsel === sw1, 'danach kein weiterer Wechsel in 60 s (' + (s.sideWechsel - sw1) + ')');
}

console.log(fails ? '\n' + fails + ' FEHLER von ' + n : '\n' + n + '/' + n + ' ok');
process.exit(fails ? 1 : 0);
