#!/usr/bin/env node
'use strict';
// GEL-02 Nacharbeit D (K1): Trupps ohne bereich (Testgelände, Baustein besetzen ohne Bereich, Debug buehne) auf Karten mit Decks
// stehen auf EINEM Deck und sind gebunden, auch mit 4 Spielern und Stärke gross (dann reichen die Anker eines Decks nicht).
// Echter Erzeuger: Wildnis mit Höhle (Game.arenaParams -> Arena.start -> combat.besetzen mit bereich null).
//   node tools/test-deck-bindung-misch.js
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');
const Arena = require('../server/sim/arena.js');
const W = require('../server/world.js');
const { Game } = require('../server/game.js');

let n = 0, bad = 0;
const ok = (c, t) => { n++; if (!c) { bad++; console.log('  FEHLER ' + t); } else console.log('  ok   ' + t); };
const TICK = CONFIG.tickHz;

function spiel(np, params) {
  const g = new Game({ noStore: true, seed: 5, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  for (let i = 0; i < np; i++) {
    const c = { inbox: [], send() {} };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'A' + i, name: 'A' + i, color: i }); g.handleMessage(c, { t: 'ready', ready: true });
  }
  Arena.start(g, 'arena_away', Game.arenaParams(params));
  const map = g.away.map, k = W.AWAY_MAPS[map].karte;
  return { g, map, k, aw: g.aways[map] };
}

console.log('(a) 4 Spieler, bereich null: kein gemischter Trupp, jeder Trupp gebunden');
let gesamt = 0, misch = 0, ungebunden = 0, leer = 0, gegner = 0;
for (const gr of ['klein', 'mittel']) for (const st of ['mittel', 'gross']) for (let seed = 1; seed <= 15; seed++) {
  const fr = seed % 2 ? 'raubzug' : 'rostmeute';
  const { k, aw } = spiel(4, { art: 'wildnis', seed, groesse: gr, hoehle: '1', fraktion: fr, staerke: st });
  if (!k.decks) continue;
  const S = k.decks.stride;
  for (const s of Object.values(aw.squads)) {
    const dr = aw.drones.filter((e) => e.squad === s.name);
    if (!dr.length) { leer++; continue; }
    const ds = new Set(dr.map((e) => Math.floor(Physics.toTile(e.x, e.y).y / S)));
    gesamt++; gegner += dr.length;
    if (ds.size > 1) misch++;
    else if (s.deckBindung !== [...ds][0]) ungebunden++;
  }
}
ok(gesamt > 100, `genug Trupps gemessen (${gesamt}, ${gegner} Gegner)`);
ok(misch === 0, `gemischte Trupps: ${misch} von ${gesamt} (Ziel 0)`);
ok(ungebunden === 0, `Trupps ohne passende Bindung: ${ungebunden} von ${gesamt} (Ziel 0)`);

console.log('(b) 60 s alarmiert, 4 Spieler oben an der Leiter: kein Deckwechsel von Gegnern');
for (const [gr, st, seed, fr] of [['mittel', 'mittel', 2, 'raubzug'], ['mittel', 'gross', 2, 'raubzug'], ['klein', 'gross', 1, 'rostmeute'], ['mittel', 'gross', 11, 'rostmeute']]) {
  const { g, k, aw } = spiel(4, { art: 'wildnis', seed, groesse: gr, hoehle: '1', fraktion: fr, staerke: st, haltung: 'wach' });
  const S = k.decks.stride, lo = k.anker.find((a) => a.id === 'gelaende.leiter');
  g.players.forEach((p, i) => { const c = Physics.tileCenter(lo.x + (i % 2), lo.y + 1 + (i >> 1)); p.x = c.x; p.y = c.y; p.input.mx = 0; p.input.my = 0; });
  const deck = (e) => Math.floor(Physics.toTile(e.x, e.y).y / S);
  const d0 = aw.drones.map(deck), wechsel = new Set();
  for (let t = 0; t < 60 * TICK; t++) {
    for (const s of Object.values(aw.squads)) { s.alert = true; for (const p of g.players) { s.lastKnown[p.id] = { x: p.x, y: p.y, t: g.time }; if (p.shield) p.shield.seg = 3; p.downed = false; p.hp = 100; } }
    g.step();
    aw.drones.forEach((e, i) => { if (e.alive && deck(e) !== d0[i]) wechsel.add(e.id); });
  }
  const oben = d0.filter((d) => d === 0).length;
  ok(aw.drones.length > 0 && wechsel.size === 0, `${gr} ${st} Seed ${seed} ${fr}: ${aw.drones.length} Gegner (${oben} oben, ${d0.length - oben} unten), Deckwechsel ${wechsel.size} (Ziel 0)`);
}
console.log(`\n${n - bad}/${n} ok`);
process.exit(bad ? 1 : 0);
