'use strict';
// SUND-04a-3 Orbit: Bot-Läufe der Orbit-Szene des Finales (Entscheidungsschlacht um Hrafnheim, Freie Fahrt Sund). Der Kampf-Bot ist der der Sim-Szene (tools/sim-szene-sund.js: Agent aus
// tools/sim-headless.js), die Crew kämpft wirklich gegen Flaggschiff und Wachschiffe. Das Finale startet wie im Spiel: Rang Tribun, Angebot, zweistufige Bestätigung (Finale.waehlen/bestaetigen).
//   node tools/sim-finale-orbit.js [--crew 1|2|3] [--seeds N] [--seed S] [--max 600] [--verbose]
// Je Lauf: Ausgang, Dauer, Hülle der Lerche, Notfallprotokolle, Verluste der Verbündeten, Gegner (Flaggschiff, Wachschiffe), Snapshot-Maximum. Exit 1, wenn ein Lauf nicht mit Sieg endet.
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const Sim = require('./sim-headless.js');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const Finale = require('../server/sim/finale.js');
const Kriegslage = require('../server/sim/kriegslage.js');

const HZ = CONFIG.tickHz;
const RW = require('../content/welt/ruf-werte.json').werte;
const TRIBUN = RW.raenge.wert.find((r) => r.id === 'tribun').ab;

// Kampf-Bot wie in der Sim-Szene: kämpft, solange Gegner da sind, sonst Pause (Reparatur, Captain an der Konsole)
class OrbitAgent extends Sim.GenericAgent {
  update(S) {
    const p = this.me(S);
    if (!p || S.phase !== 'play') return;
    if (this.opts && this.opts.passiv) return;
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

function neuesSpiel(seed, crew, opts, tmp) {
  const dir = path.join(tmp, 'w' + Math.random().toString(36).slice(2));
  fs.mkdirSync(dir, { recursive: true });
  const game = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(tmp, 'regie') }, log: () => {} });
  game.simStats = { reactorRestarts: 0, widescans: 0, wreckDone: false, orders: 0, coverShots: 0, keyTries: 0 };
  const roles = crew === 1 ? ['solo'] : crew === 2 ? ['helm', 'weapons'] : ['helm', 'weapons', 'captain'];
  const agents = roles.map((r, i) => new OrbitAgent(game, i, r, opts || {}));
  game.simAgents = agents;
  game.lobbyOpts.startMission = 'freie_fahrt';
  for (const a of agents) { game.addConnection(a.conn); a.hello(); }
  for (let i = 0; i < 2 * HZ; i++) game.step();
  return { game, agents };
}

// Ein Lauf: Finale beginnen (wie im Spiel), die Bots kämpfen, bis die Szene endet. -> Ergebnis
async function lauf(seed, crew, o) {
  const opt = o || {};
  const tmp = opt.tmp || fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-orbitbot-'));
  const { game: g, agents } = neuesSpiel(seed, crew, { passiv: !!opt.passiv }, tmp);
  g.space.enemies = [];
  g.weltsim.ruf.rom = TRIBUN;
  Kriegslage.tick(g, 'test');
  const res = { seed, crew, ok: false };
  const f1 = Finale.waehlen(g); const f2 = Finale.bestaetigen(g);
  if (f1 || f2) { res.fehler = 'Finale startet nicht: ' + JSON.stringify(f1 || f2); return res; }
  const S = g.simSzene;
  if (!S || S.modus !== 'finale') { res.fehler = 'keine Orbit-Szene'; return res; }
  g.ship.helm.stage = Math.max(g.ship.helm.stage, 1);
  const tick0 = g.weltsim.tickZahl;
  const t0 = g.time; let snap = g.snapshot(); let snapMax = 0; let maxSchiffe = 0; let erster = null;
  const maxSek = opt.max || 600;
  let n = 0; const verbundete0 = (g.space.escorts || []).filter((q) => q.sim === S.id).length;
  while (g.simSzene && g.time - t0 < maxSek) {
    g.step(); n++;
    if (g.wantsSnapshot()) { snap = g.snapshot(); const b = Buffer.byteLength(JSON.stringify(snap)); if (b > snapMax) snapMax = b; }
    for (const a of agents) a.update(snap);
    if (erster == null && g.space.enemies.some((e) => e.finaleS === S.id)) erster = g.time - t0;
    maxSchiffe = Math.max(maxSchiffe, g.space.enemies.length + (g.space.escorts || []).filter((q) => q.state !== 'entkommen').length);
    if (opt.verbose && n % (30 * HZ) === 0) console.log(`  [t ${(g.time - t0).toFixed(0)}] Gegner ${g.space.enemies.length} Verbündete ${(g.space.escorts || []).filter((q) => q.sim === S.id && q.state === 'ok').length} Hülle ${Math.round(g.ship.hull)} Notfall ${g.stats.emergencies}`);
    if (n % 3000 === 0) await new Promise((r) => setImmediate(r));
  }
  const L = g.simSzeneLetzte;
  res.dauer = Math.round(g.time - t0); res.ersterGegner = erster == null ? null : Math.round(erster * 10) / 10; res.snapMax = snapMax; res.maxSchiffe = maxSchiffe;
  res.huelle = Math.round(g.ship.hull); res.notfall = g.stats.emergencies; res.kills = Object.assign({}, S.kills);
  res.verbuendeteVerloren = verbundete0 - (g.space.escorts || []).filter((q) => q.sim === S.id && q.state === 'ok').length;
  res.verbuendete0 = verbundete0; res.wach = S.nWach; res.tickDelta = g.weltsim.tickZahl - tick0; res.phase = Finale.phase(g);
  res.ausgang = L && L.finale ? L.ausgang : null;
  res.errors = g.errors;
  if (g.simSzene) { res.fehler = 'Zeitlimit ' + maxSek + ' s'; return res; }
  res.ok = res.ausgang === 'sieg' && res.phase === 'boden' && !g.errors;
  res.game = g;
  return res;
}

const zeile = (r) => r.fehler ? `  FEHLER crew ${r.crew} seed ${r.seed}: ${r.fehler}` :
  `  ${r.ok ? 'ok    ' : 'FEHLER '}crew ${r.crew} seed ${r.seed}: ${r.ausgang}, ${r.dauer} s, erster Gegner nach ${r.ersterGegner} s, Wachschiffe ${r.wach}, Abschüsse ${Object.entries(r.kills).map(([k, c]) => c + ' ' + k).join(', ')}, Verbündete verloren ${r.verbuendeteVerloren}/${r.verbuendete0}, Hülle ${r.huelle}, Notfall ${r.notfall}, Tick +${r.tickDelta}, Phase ${r.phase}, größte Last ${r.maxSchiffe} Schiffe, Snapshot max ${r.snapMax} B`;

module.exports = { lauf, zeile, TRIBUN, OrbitAgent };

if (require.main === module) {
  const args = process.argv.slice(2);
  const val = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
  const crews = val('--crew', '1,2,3').split(',').map(Number);
  const seeds = Math.max(1, Number(val('--seeds', 3)) | 0); const seed0 = Number(val('--seed', 11)) | 0;
  (async () => {
    let fehler = 0;
    for (const c of crews) for (let k = 0; k < seeds; k++) {
      const r = await lauf(seed0 + k, c, { max: Number(val('--max', 600)), verbose: args.includes('--verbose') });
      console.log(zeile(r)); if (!r.ok) fehler++;
    }
    console.log(fehler ? `FEHLER: ${fehler} Lauf/Läufe ohne Sieg` : 'SIM-FINALE-ORBIT OK');
    process.exit(fehler ? 1 : 0);
  })();
}
