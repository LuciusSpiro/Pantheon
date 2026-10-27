'use strict';
// SYS-01 Erkundung Frage 1: Zeit bis Schildsegment 0 unter Gegnerfeuer, deterministisch, OHNE Bot-Rauschen.
// Aufbau wie tools/pan01-feuerkraft-messung.js: Arena-Szene, die Lerche steht still (Kurs und Schildverteilung unverändert, keine Gegenwehr, keine Reparatur),
// EIN Gegner der Klasse fliegt mit seiner normalen KI an und schießt. Gemessen ab Spawn: erster Treffer, erstes Schildsegment (das beim ersten Treffer > 0 war) auf 0,
// erster Systemschaden, Hüllenverlust nach 60 s. Jeder Lauf ein frischer Game-Seed.
//   node tools/sys01-gegnerfeuer.js [--kinds raider,korvette,fregatte,kreuzer] [--crews 1,3] [--seeds 20] [--sek 120] [--seed0 1] [--schild 2,2,0,2] [--lang]
const path = require('path');
const fs = require('fs');
const os = require('os');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
// SYS-01 B1: Hüllenzähler gibt es nicht mehr. Lerche = Summe der Systemintegrität (aktive Systeme, interior.integOf).
const INT = require('../server/sim/interior.js');
const integ = (g) => INT.SYSTEM_ORDER.reduce((a, k) => a + (g.ship.systems[k] !== undefined && INT.systemAktiv(g, k) ? INT.integOf(g, k) : 0), 0);
const a = process.argv.slice(2);
const arg = (k, d) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : d);
const kinds = arg('--kinds', 'raider,korvette,fregatte,kreuzer').split(','), crews = arg('--crews', '1,3').split(',').map(Number);
const SEEDS = Number(arg('--seeds', 20)), SEK = Number(arg('--sek', 120)), SEED0 = Number(arg('--seed0', 1));
const SCHILD = arg('--schild', null) ? arg('--schild').split(',').map(Number) : null;
const DT = 1 / CONFIG.tickHz;
const f = (x) => (x == null ? '—' : (Math.round(x * 10) / 10).toString());
const stat = (v) => { v = v.filter((x) => x != null).sort((x, y) => x - y); const n = v.length; if (!n) return { n: 0 }; const m = v.reduce((s, x) => s + x, 0) / n; const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) * (x - m), 0) / Math.max(1, n - 1)); return { n, mean: m, sd, med: v[Math.floor((n - 1) / 2 + 0.5)], min: v[0], max: v[n - 1] }; };

function messe(kind, crew, seed) {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sys01-gf-'));
  const g = new Game({ noStore: true, worlds: false, seed, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  for (let i = 0; i < crew; i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'F' + i, name: 'F' + i, color: i });
    if (i === 0) g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' });
    g.handleMessage(c, { t: 'ready', ready: true });
  }
  if (g.arena) g.arena.nextAt = null;
  const sh = g.ship; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; sh.vx = sh.vy = 0;
  g.space.enemies = []; g.space.projectiles = [];
  if (SCHILD) { sh.shields.current = SCHILD.slice(); }
  for (let i = 0; i < 4; i++) g.step();   // Lage setzen
  const sh0 = sh.shields.current.slice();
  const e = space.spawnEnemy(g, kind, {});
  const e0 = { hp: e.hpMax, sh: e.shieldsMax.join('/') };
  const hull0 = integ(g); const sys0 = Object.assign({}, sh.systems);
  let tHit = null, tSh0 = null, tSys = null, shHit = null, hull60 = null, hits = 0, t = 0; const sektorHits = [0, 0, 0, 0];
  const orig = g.emit.bind(g);
  g.emit = function (k, d) { if (k === 'hit' && !(d && d.evaded)) { hits++; if (tHit == null) tHit = t; if (d && Number.isInteger(d.sector)) sektorHits[d.sector]++; } return orig(k, d); };
  while (t < SEK) {
    sh.vx = sh.vy = 0; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0;   // Lerche bleibt stehen (Kurs fest)
    g.step(); t += DT;
    if (tHit != null && shHit == null) shHit = sh.shields.current.map((v) => v > 0.05);
    if (shHit && tSh0 == null && sh.shields.current.some((v, i) => shHit[i] && v < 0.05)) tSh0 = t - tHit;
    if (tHit != null && tSys == null && Object.keys(sh.systems).some((k) => sys0[k] === 'ok' && sh.systems[k] !== 'ok')) tSys = t - tHit;
    if (hull60 == null && t >= 60) hull60 = hull0 - integ(g);
  }
  return { tHit, tSh0, tSys, hull60, hits, sh0, e0, hullEnd: hull0 - integ(g) };
}
console.log(`Befehl: node tools/sys01-gegnerfeuer.js --kinds ${kinds} --crews ${crews} --seeds ${SEEDS} --seed0 ${SEED0} --sek ${SEK}${SCHILD ? ' --schild ' + SCHILD : ''}`);
console.log('| Klasse | Crew | Gegner Hülle / Schild | n | Treffer bis Ende (Mittel) | Spawn→1. Treffer Median | 1. Treffer→Segment 0 Median (min–max, n von N) | 1. Treffer→1. Systemschaden Median (n) | Hülle Lerche nach 60 s (Mittel) |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const k of kinds) for (const c of crews) {
  const rs = []; for (let i = 0; i < SEEDS; i++) rs.push(messe(k, c, SEED0 + i));
  const s1 = stat(rs.map((r) => r.tHit)), s2 = stat(rs.map((r) => r.tSh0)), s3 = stat(rs.map((r) => r.tSys));
  const hm = rs.reduce((s, r) => s + (r.hull60 || 0), 0) / rs.length, hits = rs.reduce((s, r) => s + r.hits, 0) / rs.length;
  console.log(`| ${k} | ${c} | ${rs[0].e0.hp} / ${rs[0].e0.sh} | ${rs.length} | ${f(hits)} | ${f(s1.med)} | ${f(s2.med)} (${f(s2.min)}–${f(s2.max)}, ${s2.n}/${rs.length}) | ${f(s3.med)} (${s3.n}) | ${f(hm)} |`);
}
