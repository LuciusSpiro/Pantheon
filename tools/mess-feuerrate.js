'use strict';
// SPT-02 11: Feuerrate der Gegnerklassen (Jaeger, Korvette, Fregatte, Kreuzer) in gleicher Szene. Nur messen, schreibt nichts ins Repo.
//   node tools/mess-feuerrate.js [--root <Repo>] [--arten raider,korvette,fregatte,kreuzer] [--seed 161354297] [--seeds 10] [--dauer 200]
//                                [--lerche steht|kreist] [--waffen zufall|lanze|batterie|bolzen] [--json <Datei>] [--v2 an|aus|auto]
// Ein Gegner (unverwundbar, Systeme heil) gegen die unverwundbare Lerche (Freie Fahrt, Szene splitter, Crew 3).
// Gezaehlt je Gegner: Stoesse/Salven/Ladungen (sfx/tele), Geschosse (Projektile mit owner), Treffer und Schaden an der Lerche ('hit'-Ereignis:
// dmg = Rest an der Huelle, bei Schildtreffer der Rohschaden), Zeit in Reichweite / im Bogen. --root = anderer Worktree (z. B. p10, main).
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
const Physics = rq('shared/physics.js');
const Testhilfe = rq('tools/gegner-testhilfe.js');

const ARTEN = val('--arten', 'raider,korvette,fregatte,kreuzer').split(',');
const SEED0 = Number(val('--seed', 161354297)) | 0;
const SEEDS = Math.max(1, Number(val('--seeds', 10)) | 0);
const DAUER = Number(val('--dauer', 200));
const LERCHE = val('--lerche', 'steht');
const WAFFEN = val('--waffen', 'zufall');
const V2 = val('--v2', 'auto');
const JSONF = val('--json', null);
const ZEITEN = args.includes('--zeiten');   // jeden Schuss mit Zeit, Abstand, Bogen und Flugzustand ausgeben
const HZ = CONFIG.tickHz; const DT = 1 / HZ;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-feuerrate-'));

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
  game.space.enemies = []; game.space.projectiles = []; game.space.asteroids = [];   // Brocken wuerden die Lerche mitzaehlbar treffen
  game.god = true;
  return game;
}

function lauf(kind, seed) {
  if (V2 === 'an') CONFIG.spaceM3b.flightV2.weltsim = true; else if (V2 === 'aus') { CONFIG.spaceM3b.flightV2.weltsim = false; CONFIG.spaceM3b.flightV2.missions = false; }
  const g = neuesSpiel(seed);
  const sh = g.ship; const cx = g.space.w / 2, cy = g.space.h / 2;
  sh.x = cx; sh.y = cy; sh.vx = 0; sh.vy = 0; sh.angle = 0; sh.speed = 0; sh.helm.stage = Math.max(sh.helm.stage, 1);
  const opts = { angle: 0.7, tag: 'sonde' };
  if (WAFFEN !== 'zufall') { opts.waffen = {}; for (const w of (CONFIG.enemyWeapons[kind] || [])) opts.waffen[w.platz] = WAFFEN; }
  const e = Space.spawnEnemy(g, kind, opts);
  const cfg = CONFIG.enemies[kind];
  const arten = {}; for (const v of Object.values(e.waffen || {})) arten[v] = (arten[v] || 0) + 1;
  const Z = { sfx: {}, tele: 0, teleMiss: 0, proj: {}, hits: 0, hitsHuelle: 0, hitsSchild: 0, hitsHeavy: 0, hitsEvaded: 0, schaden: 0, schadenHuelle: 0, tImBogen: 0, tInRange: 0, tSek: [0, 0, 0, 0] };
  const emit0 = g.emit.bind(g);
  g.emit = (k, d) => {
    if (k === 'tele') Z.tele++;
    else if (k === 'teleMiss') Z.teleMiss++;
    else if (k === 'sfx' && d) { if (d.enemy === kind || d.name === 'blaster') Z.sfx[d.name] = (Z.sfx[d.name] || 0) + 1; }
    else if (k === 'hit' && d) {
      if (d.evaded) Z.hitsEvaded++;
      else {
        Z.hits++; if (d.heavy) Z.hitsHeavy++;
        if (d.shield) { Z.hitsSchild++; Z.schaden += Number(d.dmg) || 0; } else { Z.hitsHuelle++; Z.schaden += Number(d.dmg) || 0; Z.schadenHuelle += Number(d.dmg) || 0; }
      }
    }
    return emit0(k, d);
  };
  const seen = new Set();
  const plaetze = CONFIG.enemyWeapons[kind] || [];
  let ang = 0; const om = 0.08, R0 = 500;
  const N = Math.round(DAUER / DT);
  let tot = null; const dist = [];
  for (let i = 0; i < N; i++) {
    if (LERCHE === 'kreist') { ang += om * DT; sh.x = cx + Math.cos(ang) * R0; sh.y = cy + Math.sin(ang) * R0; sh.angle = ang + Math.PI / 2; sh.vx = -Math.sin(ang) * R0 * om; sh.vy = Math.cos(ang) * R0 * om; }
    // Gegner unverwundbar: Systeme und Huelle jede Sekunde auffuellen (die Lerche schiesst mit; sonst faellt Waffe/Gegner aus)
    if (i % HZ === 0 && g.space.enemies.includes(e)) Testhilfe.setzeGesamt(e, e.hpMax);
    g.step();
    if (!g.space.enemies.includes(e)) { tot = i * DT; break; }
    for (const p of g.space.projectiles) if (p.owner === e.id && !seen.has(p.id)) { seen.add(p.id); Z.proj[p.kind] = (Z.proj[p.kind] || 0) + 1; if (ZEITEN) console.log('   schuss', kind, seed, (i * DT).toFixed(2), p.kind, 'abstand', Math.hypot(e.x - sh.x, e.y - sh.y).toFixed(0), 'imBogen', plaetze.some((w) => Physics.inArc(e.x, e.y, e.angle, w.facing, w.arc, w.range, sh.x, sh.y)), e.pstate || ''); }
    const d = Math.hypot(e.x - sh.x, e.y - sh.y);
    if (d <= cfg.range) Z.tInRange += DT;
    if (plaetze.some((w) => Physics.inArc(e.x, e.y, e.angle, w.facing, w.arc, w.range, sh.x, sh.y))) Z.tImBogen += DT;
    Z.tSek[Physics.sectorOf(e.x, e.y, e.angle, sh.x, sh.y)] += DT;
    if (i % HZ === 0) dist.push(d);
  }
  const sf = g.stats.sperrfeuer || { bursts: 0, shots: 0, hits: 0 };
  const sysZ = e.sys ? Object.entries(e.sys).filter(([k]) => k.startsWith('waffe')).map(([k, v]) => k + ':' + v.z).join(',') : '-';
  const T = tot == null ? DAUER : tot;
  return {
    kind, seed, aktiv: Pilot.active(g), flies: Pilot.flies(g, e), tot, T, waffen: e.waffen || null, arten, Z, sperr: { bursts: sf.bursts, shots: sf.shots, hits: sf.hits },
    teleMisses: g.stats.teleMisses || 0, sysZ, distMittel: dist.length ? dist.reduce((a, b) => a + b, 0) / dist.length : 0, fehler: g.errors || 0,
  };
}

const alle = [];
console.log(`Root ${ROOT}\nLerche ${LERCHE}, Waffen ${WAFFEN}, Dauer ${DAUER} s, Seeds ${SEED0}..+${SEEDS - 1}, v2=${V2}`);
for (const kind of ARTEN) {
  const rs = [];
  for (let k = 0; k < SEEDS; k++) rs.push(lauf(kind, SEED0 + k));
  alle.push(...rs);
  const sum = (f) => rs.reduce((a, r) => a + f(r), 0);
  const T = sum((r) => r.T);
  const sfx = (n) => sum((r) => r.Z.sfx[n] || 0);
  const proj = (n) => sum((r) => r.Z.proj[n] || 0);
  const projAll = sum((r) => Object.values(r.Z.proj).reduce((a, b) => a + b, 0));
  const f = (x, d = 2) => (x / T).toFixed(d);
  console.log(`\n== ${kind}: ${rs.length} Laeufe, ${T.toFixed(0)} Gegnersekunden, Pilot.flies ${rs.every((r) => r.flies)}, Tote ${rs.filter((r) => r.tot != null).length}, Fehler ${sum((r) => r.fehler)}`);
  console.log(`  Blaster/Bolzen-Salven ${sfx('blaster')} (${f(sfx('blaster'))}/s) | Sperrfeuer-Stoesse ${sfx('sperrfeuer')} (${f(sfx('sperrfeuer'))}/s) | Sturm ${sfx('sturm_salvo')} | Lanze-Ladungen ${sum((r) => r.Z.tele)} (${f(sum((r) => r.Z.tele))}/s, verfehlt ${sum((r) => r.Z.teleMiss)})`);
  console.log(`  Geschosse gesamt ${projAll} (${f(projAll)}/s): ${JSON.stringify(Object.fromEntries(['enemy', 'sperrfeuer', 'sturm', 'etorpedo', 'estreu', 'emp'].map((n) => [n, proj(n)]).filter(([, v]) => v)))}`);
  console.log(`  Treffer ${sum((r) => r.Z.hits)} (${f(sum((r) => r.Z.hits))}/s; Schild ${sum((r) => r.Z.hitsSchild)}, Huelle ${sum((r) => r.Z.hitsHuelle)}, schwer ${sum((r) => r.Z.hitsHeavy)}, ausgewichen ${sum((r) => r.Z.hitsEvaded)}) | Schaden ${sum((r) => r.Z.schaden).toFixed(1)} (${f(sum((r) => r.Z.schaden), 3)}/s), davon Huelle ${sum((r) => r.Z.schadenHuelle).toFixed(1)}`);
  console.log(`  Zeit im Bogen ${(100 * sum((r) => r.Z.tImBogen) / T).toFixed(0)} %, in Reichweite ${(100 * sum((r) => r.Z.tInRange) / T).toFixed(0)} %, mittl. Abstand ${(sum((r) => r.distMittel) / rs.length).toFixed(0)} px, Sektor der Lerche [bug,stb,heck,bb] ${[0, 1, 2, 3].map((s) => (100 * sum((r) => r.Z.tSek[s]) / T).toFixed(0)).join('/')} %`);
  if (kind !== 'raider') {
    // je Waffenart: Plaetze der Art und Ereignisse (nur aussagekraeftig bei --waffen <art> oder wenn nur eine Art an Bord ist)
    const art = {}; for (const r of rs) for (const [a, n] of Object.entries(r.arten)) art[a] = (art[a] || 0) + n;
    console.log(`  Bestueckung (Plaetze ueber alle Laeufe) ${JSON.stringify(art)}`);
    const nieFeuer = rs.filter((r) => (r.arten.batterie && !r.Z.sfx.sperrfeuer) || (r.arten.lanze && !r.Z.tele) || (r.arten.bolzen && !(r.Z.proj.enemy))).map((r) => `s${r.seed}:${JSON.stringify(r.arten)}->${r.Z.sfx.sperrfeuer || 0}St/${r.Z.tele}La/${r.Z.proj.enemy || 0}Bo`);
    console.log(`  Laeufe mit einer Waffenart, die nie feuerte (${nieFeuer.length}/${rs.length}): ${nieFeuer.join(' ') || '-'}`);
  }
  console.log('  je Seed: ' + rs.map((r) => `${r.seed % 100}[${Object.entries(r.arten).map(([a, n]) => a[0] + n).join('')}] ${r.Z.hits}T/${r.Z.schaden.toFixed(0)}S${r.tot != null ? ' TOT@' + r.tot.toFixed(0) : ''}`).join('  '));
}
if (JSONF) fs.writeFileSync(JSONF, JSON.stringify({ root: ROOT, lerche: LERCHE, waffen: WAFFEN, dauer: DAUER, v2: V2, laeufe: alle }, null, 1));
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
process.exit(0);
