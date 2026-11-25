'use strict';
// SPT-02 11: Anfluege der Verbuendeten (Flotten-KI, flotte.js kiFlug -> pilot.update). Nur messen, schreibt nichts ins Repo.
//   node tools/mess-verbuendete.js [--root <Repo>] [--arten raider,korvette,fregatte,kreuzer] [--seed 161354297] [--seeds 5] [--dauer 300]
//                                  [--ziele 1] [--rolle angreifer|begleiter] [--anzahl 3] [--json <Datei>]
// Szene splitter (Freie Fahrt), Lerche steht (unverwundbar), --ziele Gegner-Korvetten (unverwundbar, Systeme werden aufgefuellt), --anzahl Verbuendete der Klasse
// (Flotte.aufstellen wie Spontanhilfe/Kriegslage), unverwundbar. Anflug = Abstand zum Ziel des Verbuendeten > 450 px, dann < 220 px (wie mess-flug-v2).
const fs = require('fs');
const os = require('os');
const path = require('path');
const args = process.argv.slice(2);
const val = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const ROOT = path.resolve(val('--root', path.join(__dirname, '..')));
process.chdir(ROOT);
const rq = (p) => require(path.join(ROOT, p));
const Sim = rq('tools/sim-headless.js');
const CONFIG = rq('shared/config.js');
const { Game } = rq('server/game.js');
const Space = rq('server/sim/space.js');
const Pilot = rq('server/sim/pilot.js');
const Flotte = rq('server/sim/flotte.js');
const Testhilfe = rq('tools/gegner-testhilfe.js');

const ARTEN = val('--arten', 'raider,korvette,fregatte,kreuzer').split(',');
const SEED0 = Number(val('--seed', 161354297)) | 0;
const SEEDS = Math.max(1, Number(val('--seeds', 5)) | 0);
const DAUER = Number(val('--dauer', 300));
const ZIELE = Math.max(1, Number(val('--ziele', 1)) | 0);
const ROLLE = val('--rolle', 'angreifer');
const ANZAHL = Math.max(1, Number(val('--anzahl', 3)) | 0);
const JSONF = val('--json', null);
const HZ = CONFIG.tickHz; const DT = 1 / HZ;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-verb-'));

function neuesSpiel(seed) {
  const dir = path.join(TMP, 'w' + Math.random().toString(36).slice(2));
  fs.mkdirSync(dir, { recursive: true });
  const game = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0', REGIE_DIR: path.join(TMP, 'regie'), TELEMETRIE: 'aus' }, log: () => {} });
  game.simStats = { reactorRestarts: 0, widescans: 0, wreckDone: false, orders: 0, coverShots: 0, keyTries: 0 };
  const agents = ['helm', 'weapons', 'captain'].map((r, i) => new Sim.GenericAgent(game, i, r, {}));
  game.simAgents = agents;
  game.lobbyOpts.startMission = 'freie_fahrt';
  for (const a of agents) { game.addConnection(a.conn); a.hello(); }
  for (let i = 0; i < 2 * HZ; i++) game.step();
  game.ship.docked = false; game.ship.dockedAt = null;
  Space.enterScene(game, 'splitter', {});
  game.space.enemies = []; game.space.projectiles = []; game.space.asteroids = [];
  game.god = true;
  return game;
}

function lauf(kind, seed) {
  const g = neuesSpiel(seed);
  const sh = g.ship; const cx = g.space.w / 2, cy = g.space.h / 2;
  sh.x = cx; sh.y = cy; sh.vx = 0; sh.vy = 0; sh.angle = 0; sh.speed = 0; sh.helm.stage = Math.max(sh.helm.stage, 1);
  const ziele = [];
  for (let i = 0; i < ZIELE; i++) ziele.push(Space.spawnEnemy(g, 'korvette', { angle: 1 + i * 2.1, tag: 'sonde' }));
  const verb = [];
  for (let i = 0; i < ANZAHL; i++) {
    const a = i * 2.1 + 3;
    const es = Flotte.aufstellen(g, { tag: 'verb' + i, kind, name: 'V' + i, rolle: ROLLE, von: { x: sh.x + Math.cos(a) * 260, y: sh.y + Math.sin(a) * 260 } });
    if (es) verb.push(es);
  }
  const st = new Map(verb.map((v) => [v.id, { anfl: 0, above: false, minD: Infinity, mitZiel: 0, pst: {}, schuss: 0, wechsel: 0, side: v.side, ptSeen: false }]));
  const seen = new Set();
  for (let i = 0, N = Math.round(DAUER / DT); i < N; i++) {
    if (i % HZ === 0) { for (const z of ziele) if (g.space.enemies.includes(z)) Testhilfe.setzeGesamt(z, z.hpMax); for (const v of verb) if (v.hp > 0) Testhilfe.setzeGesamt(v, v.hpMax); }
    g.step();
    for (const p of g.space.projectiles) if (p.kind === 'ally' && !seen.has(p.id)) { seen.add(p.id); const s = st.get(p.owner); if (s) s.schuss++; }
    for (const v of verb) {
      const s = st.get(v.id);
      const T = v.kiZielObj;
      if (T && g.space.enemies.includes(T)) {
        s.mitZiel += DT;
        const d = Math.hypot(v.x - T.x, v.y - T.y);
        if (d > 450) s.above = true;
        if (s.above && d < 220) { s.anfl++; s.above = false; }
        if (d < s.minD) s.minD = d;
      }
      const ps = v.pstate || '-'; s.pst[ps] = (s.pst[ps] || 0) + DT;
      if (v.side !== s.side) { s.wechsel++; s.side = v.side; }
    }
  }
  const stats = g.flotte && g.flotte.stats;
  return {
    kind, seed, aktiv: Pilot.active(g), flies: Pilot.flies(g, kind), n: verb.length, fehler: g.errors || 0, schuesseStats: stats ? stats.schuesse : null,
    je: verb.map((v) => { const s = st.get(v.id); return { id: v.id, anfl: s.anfl, minD: Math.round(s.minD === Infinity ? -1 : s.minD), mitZiel: Math.round(s.mitZiel), pst: Object.fromEntries(Object.entries(s.pst).map(([k, x]) => [k, Math.round(x)])), schuss: s.schuss, wechsel: s.wechsel, hp: Math.round(v.hp) }; }),
  };
}

const alle = [];
console.log(`Root ${ROOT}\nVerbuendete ${ANZAHL} x Klasse, Rolle ${ROLLE}, ${ZIELE} Ziel-Korvette(n), Dauer ${DAUER} s, Seeds ${SEED0}..+${SEEDS - 1}`);
for (const kind of ARTEN) {
  const rs = []; for (let k = 0; k < SEEDS; k++) rs.push(lauf(kind, SEED0 + k));
  alle.push(...rs);
  const je = rs.flatMap((r) => r.je);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const pst = {}; for (const j of je) for (const [k, x] of Object.entries(j.pst)) pst[k] = (pst[k] || 0) + x;
  const tot = Object.values(pst).reduce((a, b) => a + b, 0) || 1;
  console.log(`\n== Verbuendeter ${kind}: ${je.length} Schiffe, Pilot.active(Szene) ${rs[0].aktiv}, Fehler ${rs.reduce((a, r) => a + r.fehler, 0)}`);
  console.log(`  Anfluege je Schiff in ${DAUER} s: Mittel ${mean(je.map((j) => j.anfl)).toFixed(1)}, je Seed ${rs.map((r) => r.je.map((j) => j.anfl).join('/')).join('  ')}`);
  console.log(`  mit Ziel ${(mean(je.map((j) => j.mitZiel))).toFixed(0)} s von ${DAUER}; Mindestabstand zum Ziel Mittel ${mean(je.filter((j) => j.minD >= 0).map((j) => j.minD)).toFixed(0)} px; Schuesse je Schiff ${mean(je.map((j) => j.schuss)).toFixed(1)} (${(mean(je.map((j) => j.schuss)) / DAUER).toFixed(2)}/s); Seitenwechsel je Schiff ${mean(je.map((j) => j.wechsel)).toFixed(1)}`);
  console.log(`  Flugzustand (Anteil der Zeit): ${Object.entries(pst).map(([k, x]) => k + ' ' + (100 * x / tot).toFixed(0) + '%').join(', ')}`);
}
if (JSONF) fs.writeFileSync(JSONF, JSON.stringify({ root: ROOT, rolle: ROLLE, dauer: DAUER, laeufe: alle }, null, 1));
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
process.exit(0);
