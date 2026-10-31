'use strict';
// SYS-03 A: Streufeuer-Messung. Wie schnell bricht der Lerche-Schild, wenn dieselbe Trefferrate auf EINEN Sektor konzentriert oder reihum über alle Sektoren MIT Schild verteilt wird?
// Deterministisch, ohne Gegner: Arena-Szene, Lerche steht still, Treffer kommen direkt über space.shipHit in festem Takt (Rate Treffer/s), jeder Lauf ein frischer Game-Seed.
// SYS-03 C1: Schild mit Regenerationspause je Sektor (shields.regenDelay s ohne Treffer auf DEN Sektor, danach 1 Punkt je regenInterval s): jeder Treffer stempelt seinen Sektor (space.shipHit -> damage.resolveHit).
// Streufeuer verteilt die Trefferrate auf mehrere Sektoren; je Sektor kommt ein Treffer seltener als alle regenDelay s, erst dann lädt er zwischen den Treffern nach. Am Ende steht der Quotient streu/konzentriert (Median 1. Treffer -> 1. Sektor 0).
//   node tools/sys03-streufeuer.js [--rate 1] [--dmg 1] [--verteilung konzentriert,streu] [--crews 1,3] [--seeds 20] [--sek 60] [--seed0 1] [--schild 4,2,0,2] [--ziel 0] [--heavy]
// Gemessen ab erstem Treffer: Zeit bis der erste Schildsektor (der beim ersten Treffer > 0 war) auf 0 fällt, Zeit bis zum ersten Systemschaden (ein System 'ok' -> anderer Zustand), Zeit bis Reaktor zerstört.
// Nicht erreicht = nicht in n, aber in N. Config-Tuning: TUNE='{"shields.regenInterval": 4}' node -r ./tools/tune-preload.js tools/sys03-streufeuer.js ...
const path = require('path');
const fs = require('fs');
const os = require('os');
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const a = process.argv.slice(2);
const arg = (k, d) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : d);
const verteilungen = arg('--verteilung', 'konzentriert,streu').split(','), crews = arg('--crews', '1,3').split(',').map(Number);
const RATE = Number(arg('--rate', 1)), DMG = Number(arg('--dmg', 1)), SEEDS = Number(arg('--seeds', 20)), SEK = Number(arg('--sek', 60)), SEED0 = Number(arg('--seed0', 1)), ZIEL = Number(arg('--ziel', 0));
const HEAVY = a.includes('--heavy');
const SCHILD = arg('--schild', null) ? arg('--schild').split(',').map(Number) : null;
const DT = 1 / CONFIG.tickHz;
const f = (x) => (x == null ? '—' : (Math.round(x * 10) / 10).toString());
const stat = (v) => { v = v.filter((x) => x != null).sort((x, y) => x - y); const n = v.length; if (!n) return { n: 0 }; return { n, med: v[Math.floor((n - 1) / 2 + 0.5)], min: v[0], max: v[n - 1] }; };

function messe(verteilung, crew, seed) {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sys03-sf-'));
  const g = new Game({ noStore: true, worlds: false, seed, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  for (let i = 0; i < crew; i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'S' + i, name: 'S' + i, color: i });
    if (i === 0) g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' });
    g.handleMessage(c, { t: 'ready', ready: true });
  }
  if (g.arena) g.arena.nextAt = null;
  const sh = g.ship; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; sh.vx = sh.vy = 0;
  g.space.enemies = []; g.space.projectiles = [];
  for (let i = 0; i < 4; i++) g.step();
  const SS = sh.shields;
  if (SCHILD) { SS.allocIntent = SCHILD.slice(); SS.alloc = SCHILD.slice(); SS.current = SCHILD.slice(); g.step(); }
  const start = SS.current.slice();
  const mitSchild = [0, 1, 2, 3].filter((i) => SS.alloc[i] > 0);   // Sektoren mit Zuteilung
  const sys0 = Object.assign({}, sh.systems);
  let t = 0, nextHit = 0, k = 0, hits = 0, tHit = null, tSh0 = null, tSys = null, tRt = null, shHit = null;
  while (t < SEK) {
    sh.vx = sh.vy = 0; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0;
    while (t >= nextHit - 1e-9) {
      const sec = verteilung === 'streu' && mitSchild.length ? mitSchild[k % mitSchild.length] : (mitSchild.includes(ZIEL) ? ZIEL : (mitSchild[0] != null ? mitSchild[0] : ZIEL));
      if (tHit == null) { tHit = t; shHit = SS.current.map((v) => v > 0.05); }
      space.shipHit(g, sec, DMG, HEAVY ? { heavy: true } : {}); hits++; k++; nextHit += 1 / RATE;
    }
    g.step(); t += DT;
    if (tHit != null) {
      if (tSh0 == null && SS.current.some((v, i) => shHit[i] && v < 0.05)) tSh0 = t - tHit;
      if (tSys == null && Object.keys(sh.systems).some((s) => sys0[s] === 'ok' && sh.systems[s] !== 'ok')) tSys = t - tHit;
      if (tRt == null && sh.systems.reactor === 'broken') tRt = t - tHit;
    }
  }
  return { tSh0, tSys, tRt, hits, start };
}
console.log(`Befehl: node tools/sys03-streufeuer.js --rate ${RATE} --dmg ${DMG} --verteilung ${verteilungen} --crews ${crews} --seeds ${SEEDS} --seed0 ${SEED0} --sek ${SEK} --ziel ${ZIEL}${SCHILD ? ' --schild ' + SCHILD : ''}${HEAVY ? ' --heavy' : ''}${process.env.TUNE ? '   (TUNE=' + process.env.TUNE + ')' : ''}`);
console.log('| Verteilung | Crew | Schild Start | n | Treffer/Lauf | 1. Treffer→1. Sektor 0 Median (min–max, n/N) | 1. Treffer→1. Systemschaden Median (min–max, n/N) | 1. Treffer→Reaktor zerstört Median (min–max, n/N) |');
console.log('|---|---|---|---|---|---|---|---|');
const med = {};
for (const v of verteilungen) for (const c of crews) {
  const rs = []; for (let i = 0; i < SEEDS; i++) rs.push(messe(v, c, SEED0 + i));
  const s1 = stat(rs.map((r) => r.tSh0)), s2 = stat(rs.map((r) => r.tSys)), s3 = stat(rs.map((r) => r.tRt));
  const fm = (s) => `${f(s.med)} (${f(s.min)}–${f(s.max)}, ${s.n}/${rs.length})`;
  med[v + '|' + c] = s1;
  console.log(`| ${v} | ${c} | ${rs[0].start.join('/')} | ${rs.length} | ${f(rs.reduce((s, r) => s + r.hits, 0) / rs.length)} | ${fm(s1)} | ${fm(s2)} | ${fm(s3)} |`);
}
for (const c of crews) {
  const k = med['konzentriert|' + c], s = med['streu|' + c];
  if (k && s) console.log(`Quotient streu/konzentriert (Crew ${c}, Rate ${RATE}/s, Pause ${CONFIG.shields.regenDelay} s): ${k.n && s.n ? (s.med / Math.max(k.med, 1e-9)).toFixed(2) : s.n ? '–' : '∞ (Streufeuer bricht in ' + SEK + ' s keinen Sektor)'}`);
}
