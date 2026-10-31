'use strict';
// BOD-02 P6: Der Endkampf (server/sim/endkampf.js) schickt Trupps aus mehreren Mitgliedern statt Einzelgegnern.
// Gegnerzahl und Rollen bleiben gleich (10 + Anführer), nur die Trupp-Zugehörigkeit ändert sich: benachbarte Ringplätze bilden einen Trupp,
// der Anführer steht im ersten Trupp, die Rollen sind reihum auf die Trupps verteilt.
const CONFIG = require('../shared/config.js');
const Physics = require('../shared/physics.js');
const { Game } = require('../server/game.js');
const L = require('../server/sim/landepunkte.js');
const Anker = require('../server/sim/anker.js');
const away = require('../server/sim/away.js');
const Endkampf = require('../server/sim/endkampf.js');
const W = require('../server/world.js');

const LP = 'splitter.eisenwald', LAB = 'stellung_nehmen/flagge_hissen';
let n = 0, fails = 0;
function ok(c, msg) { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); }
const ticks = (g, sek) => { const k = Math.round(sek * CONFIG.tickHz); for (let i = 0; i < k; i++) g.step(); };

function spiel(np, seed, config) {
  const g = new Game({ noStore: true, seed, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  if (config) Object.assign(g.C.awayCombat.endkampf, config);
  const cs = [];
  for (let i = 0; i < np; i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 600) this.inbox.push(m); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'K' + i, color: i }); cs.push(c);
  }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'labor', labor: { id: LAB, seed } });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  ticks(g, 1);
  g.weltstand.data.rollen_gesehen = ['niederhalter', 'grenadier', 'schuetze', 'enterer'];
  L.get(g, LP);
  g.transferZiel = { lp: LP, scene: g.ship.scene }; g.setAwayMap(LP);
  away.executeBeam(g, g.players.map((p) => p.id), 'down');
  ticks(g, 0.5);
  return { g, cs };
}
const events = [];
function hissen(g) {
  const me0 = g.missionEvent.bind(g); g.missionEvent = (k, d) => { events.push([k, d]); return me0(k, d); };
  const fl = W.AWAY_MAPS[LP].karte.anker.find((a) => a.rolle === 'flagge');
  Anker.setzen(g, LP, fl.id, 'gehisst', g.players[0].id);
  ticks(g, 1);
  return g.aways[LP];
}
const tile = (e) => Physics.toTile(e.x, e.y);

console.log('\n[Standard: 10 Gegner und Anführer als Trupps]');
for (const [np, seed] of [[3, 11], [1, 4], [4, 9]]) {
  events.length = 0;
  const { g } = spiel(np, seed);
  const aw = hissen(g);
  const ds = aw.drones.filter((e) => e.alive);
  const trupps = Object.values(aw.squads).filter((s) => s.endkampf);
  const gr = trupps.map((s) => ds.filter((e) => e.squad === s.name).length).sort((a, b) => b - a);
  const tag = trupps[0] && trupps[0].tag;
  ok(ds.length === 11 && aw.endkampf.n === 11, `${np} Spieler: 11 Gegner insgesamt, aw.endkampf.n = ${aw.endkampf && aw.endkampf.n}`);
  ok(trupps.length === 3 && gr.join(',') === '4,4,3', `3 Trupps mit 4, 4 und 3 Mitgliedern (${gr.join(',')})`);
  ok(trupps.every((s) => s.alert && s.fraktion === 'raubzug' && s.tag === tag && /^labs1/.test(s.tag)), 'alle Trupps wach, mit tag, fraktion und endkampf-Kennzeichen');
  ok(trupps.map((s) => s.name).sort().join(',') === [1, 2, 3].map((i) => tag + '.' + i).join(','), `Trupp-Namen ${tag}.1 bis ${tag}.3`);
  const boss = ds.find((e) => e.boss);
  ok(ds.filter((e) => e.boss).length === 1 && boss.squad === tag + '.1' && aw.endkampf.boss === boss.id, 'ein Anführer, im ersten Trupp, in aw.endkampf.boss');
  ok(boss.rolle === 'niederhalter' && boss.mod && boss.mod.name === 'anfuehrer', 'der Anführer ist ein Niederhalter mit Modifikator');
  const rollen = ds.filter((e) => !e.boss).map((e) => e.rolle || 'grundtyp').sort().join(',');
  const soll = Endkampf.rollenFuer(g, 10).sort().join(',');
  ok(rollen === soll, `Rollen der 10 Angreifer unverändert (${rollen})`);
  ok(trupps.every((s) => new Set(ds.filter((e) => e.squad === s.name).map((e) => e.rolle || 'grundtyp')).size >= 2), 'jeder Trupp hat einen Rollenmix (mindestens 2 Rollen)');
  const mittel = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const paare = (f) => { const out = []; for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) if (f(ds[i], ds[j])) { const a = tile(ds[i]), b = tile(ds[j]); out.push(Math.hypot(a.x - b.x, a.y - b.y)); } return out; };
  const innen = mittel(paare((a, b) => a.squad === b.squad)), aussen = mittel(paare((a, b) => a.squad !== b.squad));
  ok(innen < aussen, `Trupp-Mitglieder stehen näher beieinander als Fremde (innen ${innen.toFixed(1)}, außen ${aussen.toFixed(1)} Kacheln)`);
  const sp = events.filter(([k]) => k === 'squadSpawn' || k === 'endkampfAngriff');
  ok(sp.length === 2 && sp.every(([, d]) => d.n === 11) && sp.some(([k, d]) => k === 'endkampfAngriff' && d.boss === boss.id), 'Ereignisse squadSpawn und endkampfAngriff: n 11, Anführer');
  ok(Endkampf.angriffStarten(g, { map: LP, fraktion: 'raubzug', tag: 'x' }) === 0, 'zweiter Aufruf: nichts');
  ok(!Endkampf.bossBesiegt(g, LP) && (boss.alive = false, Endkampf.bossBesiegt(g, LP)), 'bossBesiegt arbeitet über aw.endkampf.boss');
  ok(Endkampf.gegnerAbziehen(g, LP) === 11 && Object.values(aw.squads).every((s) => !s.endkampf), 'gegnerAbziehen entfernt alle Trupps');
  ok(g.errors === 0 || !g.errors || (Array.isArray(g.errors) && !g.errors.length), 'keine Server-Fehler');
}

console.log('\n[Config truppMax]');
{
  const { g } = spiel(3, 11, { truppMax: 1 });
  const aw = hissen(g);
  ok(aw.drones.length === 11 && Object.values(aw.squads).filter((s) => s.endkampf).length === 11, 'truppMax 1: wie früher 11 Einzel-Trupps');
  const { g: g2 } = spiel(3, 11, { truppMax: 6 });
  const aw2 = hissen(g2);
  ok(aw2.drones.length === 11 && Object.values(aw2.squads).filter((s) => s.endkampf).length === 2, 'truppMax 6: 2 Trupps');
  const { g: g3 } = spiel(3, 11);
  const k = Endkampf.angriffStarten(g3, { map: LP, fraktion: 'raubzug', tag: 'w', gegner: 3, boss: 1 });
  const a3 = g3.aways[LP];
  ok(k === 4 && Object.values(a3.squads).filter((s) => s.tag === 'w').length === 1 && a3.drones.filter((e) => e.boss).length === 1, 'kleiner Angriff (3 + Anführer, wie Finale am Boden): ein Trupp');
  const { g: g4 } = spiel(3, 11);
  const k4 = Endkampf.angriffStarten(g4, { map: LP, fraktion: 'raubzug', tag: 'v', gegner: 5, boss: 0 });
  ok(k4 === 5 && g4.aways[LP].drones.every((e) => !e.boss) && g4.aways[LP].endkampf.boss == null, 'ohne Anführer: 5 Gegner, kein boss');
}

console.log(fails ? `\n${fails} von ${n} FEHLER` : `\nalle ${n} ok`);
process.exit(fails ? 1 : 0);
