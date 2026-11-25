'use strict';
// SPT-02 10: Messung Sperrfeuer-Guard (Korvette, space.js updateSperrfeuer), vorher/nachher mit gleichem Seed. Nur messen, schreibt nichts ins Repo.
//   node tools/mess-sperrfeuer.js [--seed 161354297] [--seeds 10] [--zufall 36] [--dauer 200]
// Eine Korvette gegen die stehende, unverwundbare Lerche in der Szene splitter (Freie Fahrt).
//   fest    : Bestückung Bug Lanze, Steuerbord Batterie, Backbord Batterie; je Seed 1 Korvette, --dauer s: Stöße, Geschosse, Treffer, Ladungen
//   zufall  : Bestückung wie im Spiel (Zufall je Platz, `bestueckung`), je Seed 1 Korvette; getrennt nach „Bug Lanze + eine Seite Batterie“ (Fehlerfall) und dem Rest
// Zähler: stats.sperrfeuer {bursts, shots, hits}, Ladungen = Lanzenschläge (stats.heavyHits + stats.teleMisses).
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const Space = require('../server/sim/space.js');
const args = process.argv.slice(2);
const val = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const SEED0 = Number(val('--seed', 161354297)) | 0;
const SEEDS = Math.max(1, Number(val('--seeds', 10)) | 0);
const DAUER = Number(val('--dauer', 200));
const ZUF = Math.max(1, Number(val('--zufall', 36)) | 0);   // Seeds der Zufalls-Bestückung (der Fehlerfall tritt bei etwa 1 von 9 auf)
const DT = 1 / CONFIG.tickHz;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-messsperr-'));

function lauf(seed, waffen) {
  const dir = path.join(TMP, 'w' + Math.random().toString(36).slice(2));
  fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0', REGIE_DIR: path.join(TMP, 'regie'), TELEMETRIE: 'aus' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < 3; i++) { const c = { inbox: [], send() {}, sendRaw() {} }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'A' + i, name: 'A' + i, color: i }); cs.push(c); }
  g.lobbyOpts.startMission = 'freie_fahrt';
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  for (let i = 0; i < 2 * CONFIG.tickHz; i++) g.step();
  g.ship.docked = false; g.ship.dockedAt = null;
  Space.enterScene(g, 'splitter', {});
  g.space.enemies = []; g.space.projectiles = []; g.god = true;
  const sh = g.ship;
  sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.vx = 0; sh.vy = 0; sh.angle = 0; sh.speed = 0;
  const e = Space.spawnEnemy(g, 'korvette', Object.assign({ angle: 0.7, tag: 'sonde' }, waffen ? { waffen } : {}));
  const s0 = Object.assign({ bursts: 0, shots: 0, hits: 0 }, g.stats.sperrfeuer || {});
  const l0 = (g.stats.heavyHits || 0) + (g.stats.teleMisses || 0);
  for (let i = 0, N = Math.round(DAUER / DT); i < N; i++) {
    g.step();
    if (!g.space.enemies.includes(e)) break;
  }
  const s1 = g.stats.sperrfeuer || { bursts: 0, shots: 0, hits: 0 };
  return { seed, waffen: Object.assign({}, e.waffen), stoesse: s1.bursts - s0.bursts, geschosse: s1.shots - s0.shots, treffer: s1.hits - s0.hits, ladungen: (g.stats.heavyHits || 0) + (g.stats.teleMisses || 0) - l0, fehler: g.errors || 0 };
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
let fehlerGes = 0;
console.log(`\nfest: Bug Lanze, Steuerbord Batterie, Backbord Batterie (${DAUER} s, Lerche steht, ${SEEDS} Seeds ab ${SEED0})`);
{
  const rs = [];
  for (let k = 0; k < SEEDS; k++) {
    const r = lauf(SEED0 + k, { bug: 'lanze', stbd: 'batterie', bb: 'batterie' }); rs.push(r); fehlerGes += r.fehler;
    console.log(`  Seed ${r.seed}: Stöße ${r.stoesse}, Geschosse ${r.geschosse}, Treffer ${r.treffer}, Lanzen-Ladungen ${r.ladungen}, Fehler ${r.fehler}`);
  }
  console.log(`  MITTEL je ${DAUER} s: Stöße ${mean(rs.map((r) => r.stoesse)).toFixed(1)}, Geschosse ${mean(rs.map((r) => r.geschosse)).toFixed(1)}, Treffer je Korvette ${mean(rs.map((r) => r.treffer)).toFixed(1)}, Ladungen ${mean(rs.map((r) => r.ladungen)).toFixed(1)}`);
}
console.log(`\nzufall: Bestückung wie im Spiel (${DAUER} s, ${ZUF} Seeds ab ${SEED0})`);
{
  const rs = [];
  for (let k = 0; k < ZUF; k++) {
    const r = lauf(SEED0 + k, null); rs.push(r); fehlerGes += r.fehler;
    const f = r.waffen.bug === 'lanze' && (r.waffen.stbd === 'batterie' || r.waffen.bb === 'batterie');
    r.fall = f;
    console.log(`  Seed ${r.seed}: ${r.waffen.bug}/${r.waffen.stbd}/${r.waffen.bb}${f ? ' (Bug Lanze + Batterie)' : ''}: Stöße ${r.stoesse}, Geschosse ${r.geschosse}, Treffer ${r.treffer}, Ladungen ${r.ladungen}, Fehler ${r.fehler}`);
  }
  const mit = rs.filter((r) => r.fall), ohne = rs.filter((r) => !r.fall);
  const z = (a) => a.length ? `Stöße ${mean(a.map((r) => r.stoesse)).toFixed(1)}, Treffer je Korvette ${mean(a.map((r) => r.treffer)).toFixed(1)}` : '-';
  console.log(`  Bug Lanze + Batterie (n=${mit.length}): ${z(mit)}`);
  console.log(`  übrige (n=${ohne.length}): ${z(ohne)}`);
  console.log(`  alle (n=${rs.length}): ${z(rs)}`);
}
console.log(`\nFehler gesamt: ${fehlerGes}`);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
process.exit(fehlerGes ? 1 : 0);
