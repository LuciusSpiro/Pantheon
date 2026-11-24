'use strict';
// SPT-02 8: Messung Flugmodell V2 in Freie Fahrt Sund (vorher/nachher, gleicher Seed). Nur messen, schreibt nichts ins Repo.
//   node tools/mess-flug-v2.js [--teil anflug|gefecht|alle] [--seed 161354297] [--seeds 5] [--dauer 300] [--korvetten 3] [--crew 3]
//   anflug  : 3 Jäger gegen die langsam kreisende (unverwundbare) Lerche in der Szene splitter, Modus freie_fahrt; Anflug = Abstand >450 px, dann <220 px; je Jäger in --dauer s
//   gefecht : --korvetten Korvetten gegen die Bot-Crew (Lerche nicht unverwundbar), bis alle tot sind oder --dauer s;
//             Verluste Korvetten (Abschüsse) : Verluste Lerche (Hüllenverlust in Lerche-Hüllen)
//   --ausfall / --aus: siehe oben (Waffenausfall der zugewandten Seite; waffenWechsel aus)
//   Pilot.active und Abstürze (game.errors) stehen je Lauf dabei.
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const Sim = require('./sim-headless.js');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const Space = require('../server/sim/space.js');
const Pilot = require('../server/sim/pilot.js');
const Interior = require('../server/sim/interior.js');

const args = process.argv.slice(2);
const val = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const TEIL = val('--teil', 'alle');
const SEED0 = Number(val('--seed', 161354297)) | 0;
const SEEDS = Math.max(1, Number(val('--seeds', 5)) | 0);
const DAUER = Number(val('--dauer', 300));
const NK = Number(val('--korvetten', 3)) | 0;
const CREW = Number(val('--crew', 3)) === 1 ? 1 : 3;
const AUSFALL = args.includes('--ausfall');   // SPT-02 9: bei t = 20 s wird bei jeder Korvette die Waffe der zugewandten Seite zerstört und gehalten (Gegner repariert nicht)
if (args.includes('--aus')) CONFIG.spaceM3b.pilot.waffenWechsel.an = false;   // SPT-02 9: Stand vor Paket 9 (Seitenwechsel nach Waffenausfall aus)
const Physics = require('../shared/physics.js');
const Testhilfe = require('./gegner-testhilfe.js');
const HZ = CONFIG.tickHz;
const DT = 1 / HZ;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-messflug-'));

// Kampf-Bot wie in tools/sim-szene-sund.js
class KampfAgent extends Sim.GenericAgent {
  update(S) {
    const p = this.me(S);
    if (!p || S.phase !== 'play') return;
    if (this.waitT > 0) { this.waitT -= 1 / HZ; return; }
    if (p.downed) { this.input(0, 0); this.act(false); this.ix = null; return; }
    if (this.reactorDuty(S, p)) return;
    if (S.space.enemies.some((e) => e.kind !== 'relay')) { this.combat(S, p); return; }
    if (this.role === 'captain') { this.captainFight(S, p); return; }
    if (this.role === 'weapons' || this.role === 'solo') { if (this.repairDuty(S, p, { damaged: true, cooldown: 1 })) return; }
    if (this.role === 'weapons') { this.enter(S, 'weapons'); return; }
    if (!this.enter(S, 'helm')) return;
    this.brake(S);
  }
}

function neuesSpiel(seed, crew) {
  const dir = path.join(TMP, 'w' + Math.random().toString(36).slice(2));
  fs.mkdirSync(dir, { recursive: true });
  const game = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0', REGIE_DIR: path.join(TMP, 'regie'), TELEMETRIE: 'aus' }, log: () => {} });
  game.simStats = { reactorRestarts: 0, widescans: 0, wreckDone: false, orders: 0, coverShots: 0, keyTries: 0 };
  const roles = crew === 1 ? ['solo'] : ['helm', 'weapons', 'captain'];
  const agents = roles.map((r, i) => new KampfAgent(game, i, r, {}));
  game.simAgents = agents;
  game.lobbyOpts.startMission = 'freie_fahrt';
  for (const a of agents) { game.addConnection(a.conn); a.hello(); }
  for (let i = 0; i < 2 * HZ; i++) game.step();
  game.ship.docked = false; game.ship.dockedAt = null;
  Space.enterScene(game, 'splitter', {});
  game.space.enemies = []; game.space.projectiles = [];
  return { game, agents };
}

function anflug(seed) {
  const { game: g } = neuesSpiel(seed, 1);
  g.god = true;
  const sh = g.ship;
  const act = Pilot.active(g);
  sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.vx = 0; sh.vy = 0; sh.angle = 0; sh.speed = 0;
  const es = [0, 1, 2].map((i) => Space.spawnEnemy(g, 'raider', { angle: i * 2.1, tag: 'sonde' }));
  const st = new Map(es.map((e) => [e.id, { anfl: 0, above: false, minD: Infinity }]));
  let ang = 0; const om = 0.08, R0 = 500;
  for (let i = 0, N = Math.round(DAUER / DT); i < N; i++) {
    ang += om * DT;
    sh.x = g.space.w / 2 + Math.cos(ang) * R0; sh.y = g.space.h / 2 + Math.sin(ang) * R0; sh.angle = ang + Math.PI / 2; sh.vx = -Math.sin(ang) * R0 * om; sh.vy = Math.cos(ang) * R0 * om;
    g.step();
    for (const e of g.space.enemies) {
      const s = st.get(e.id); if (!s) continue;
      const d = Math.hypot(e.x - sh.x, e.y - sh.y);
      if (d > 450) s.above = true;
      if (s.above && d < 220) { s.anfl++; s.above = false; }
      if (d < s.minD) s.minD = d;
    }
  }
  return { seed, aktiv: act, anfluege: es.map((e) => st.get(e.id).anfl), minD: es.map((e) => Math.round(st.get(e.id).minD)), fehler: g.errors || 0 };
}

function gefecht(seed) {
  const { game: g, agents } = neuesSpiel(seed, CREW);
  const act = Pilot.active(g);
  const sh = g.ship;
  sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.vx = 0; sh.vy = 0; sh.angle = 0; sh.speed = 0; sh.helm.stage = Math.max(sh.helm.stage, 1);
  for (let i = 0; i < NK; i++) Space.spawnEnemy(g, 'korvette', { angle: i * (6.283 / NK), tag: 'sonde' });
  let snap = g.snapshot(); let huelleMin = 100; let tEnde = DAUER;
  const SEITE = ['bug', 'stbd', 'heck', 'bb']; const toteSeite = new Map();
  for (let i = 0, N = Math.round(DAUER / DT); i < N; i++) {
    if (AUSFALL) {
      if (i === Math.round(20 / DT)) for (const e of g.space.enemies) { if (e.kind !== 'korvette' || !e.sys) continue; const sec = Physics.sectorOf(e.x, e.y, e.angle, sh.x, sh.y); const ids = Object.keys(e.sys).filter((k) => k.startsWith('waffe_' + SEITE[sec === 1 || sec === 3 ? sec : 1])); toteSeite.set(e, ids); }
      for (const [e, ids] of toteSeite) for (const id of ids) if (e.sys && e.sys[id] && e.sys[id].z !== 'broken') Testhilfe.setzeIntegritaet(e, id, 0);
    }
    g.step();
    if (g.wantsSnapshot()) snap = g.snapshot();
    for (const a of agents) a.update(snap);
    if (i % HZ === 0) huelleMin = Math.min(huelleMin, Interior.integritaetSnapshot(g).gesamt);
    if (!g.space.enemies.some((e) => e.kind === 'korvette')) { tEnde = i * DT; break; }
  }
  const tot = NK - g.space.enemies.filter((e) => e.kind === 'korvette').length;
  const verlust = Math.max(0, 100 - huelleMin) / 100;   // in Lerche-Hüllen
  return { seed, aktiv: act, abgeschossen: tot, huelleMin: Math.round(huelleMin), verlustLerche: verlust, tEnde: Math.round(tEnde), notfall: g.stats.emergencies || 0, fehler: g.errors || 0 };
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
let fehlerGes = 0;
if (TEIL === 'anflug' || TEIL === 'alle') {
  console.log(`\nAnflug (3 Jäger, ${DAUER} s, Lerche kreist langsam, Freie Fahrt Sund, Szene splitter)`);
  const alle = [];
  for (let k = 0; k < SEEDS; k++) {
    const r = anflug(SEED0 + k); fehlerGes += r.fehler; alle.push(...r.anfluege);
    console.log(`  Seed ${r.seed}: Pilot.active ${r.aktiv}, Anflüge je Jäger ${r.anfluege.join('/')}, Mindestabstand ${r.minD.join('/')} px, Fehler ${r.fehler}`);
  }
  console.log(`  MITTEL Anflüge je Jäger in ${DAUER} s: ${mean(alle).toFixed(1)} (n=${alle.length})`);
}
if (TEIL === 'gefecht' || TEIL === 'alle') {
  console.log(`\nGefecht (${NK} Korvetten gegen Bot-Crew ${CREW}, bis alle tot oder ${DAUER} s, Szene splitter)`);
  let kills = 0, verl = 0, tot = 0;
  for (let k = 0; k < SEEDS; k++) {
    const r = gefecht(SEED0 + k); fehlerGes += r.fehler; kills += r.abgeschossen; verl += r.verlustLerche; tot += r.tEnde;
    console.log(`  Seed ${r.seed}: Pilot.active ${r.aktiv}, Korvetten abgeschossen ${r.abgeschossen}/${NK} in ${r.tEnde} s, Lerche-Hülle min ${r.huelleMin} %, Notfälle ${r.notfall}, Fehler ${r.fehler}`);
  }
  console.log(`  SUMME: ${kills} Korvetten abgeschossen, Lerche-Hüllenverlust ${verl.toFixed(2)} Lerche-Hüllen -> Verhältnis Korvetten : Lerche = ${verl > 0 ? (kills / verl).toFixed(1) : 'inf'} : 1; mittlere Kampfdauer ${(tot / SEEDS).toFixed(0)} s`);
}
console.log(`\nFehler gesamt: ${fehlerGes}`);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
process.exit(fehlerGes ? 1 : 0);
