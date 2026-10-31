'use strict';
// SYS-03 C2: Streufeuer-Messung auf der GEGNER-Seite (Abnahme 5, Gegenstück zu sys03-streufeuer.js der Lerche). Ein stehender Gegner (Klasse, Standardschild), die Treffer kommen in festem Takt
// direkt über space.damageEnemy (Rohschaden 1 je Treffer, normale Treffer), im vollen Spielablauf (g.step: Pause, Regeneration, Gegner-Reparatur). Jeder Lauf ein frischer Game-Seed.
// konzentriert = alle Treffer auf das Segment mit dem meisten Schild (erstes seiner Klasse), streu = reihum über alle Segmente mit Schild (Standardverteilung der Klasse).
//   node tools/sys03-streufeuer-gegner.js [--kinds raider,korvette,fregatte,kreuzer] [--rate 0.5] [--seeds 10] [--sek 120] [--seed0 1] [--verteilung konzentriert,streu]
// Gemessen ab erstem Treffer: Zeit bis das erste Schildsegment (das beim ersten Treffer > 0 war) auf 0 fällt, bis zum ersten Systemschaden, bis Reaktor zerstört. TUNE: wie bei den anderen Werkzeugen.
const path = require('path');
const fs = require('fs');
const os = require('os');
const CONFIG = require('../shared/config.js');
const Schilde = require('../shared/schilde.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Gsys = require('../server/sim/gegnersystem.js');
const a = process.argv.slice(2);
const arg = (k, d) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : d);
const kinds = arg('--kinds', 'raider,korvette,fregatte,kreuzer').split(','), verteilungen = arg('--verteilung', 'konzentriert,streu').split(',');
const RATE = Number(arg('--rate', 0.5)), SEEDS = Number(arg('--seeds', 10)), SEK = Number(arg('--sek', 120)), SEED0 = Number(arg('--seed0', 1));
const DT = 1 / CONFIG.tickHz;
const f = (x) => (x == null ? '—' : (Math.round(x * 10) / 10).toString());
const stat = (v) => { v = v.filter((x) => x != null).sort((x, y) => x - y); const n = v.length; if (!n) return { n: 0 }; return { n, med: v[Math.floor((n - 1) / 2 + 0.5)], min: v[0], max: v[n - 1] }; };

function messe(kind, verteilung, seed) {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sys03-sfg-'));
  const g = new Game({ noStore: true, worlds: false, seed, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'S0', name: 'S0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' }); g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.god = true;
  const sh = g.ship; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; sh.vx = sh.vy = 0;
  g.space.enemies = []; g.space.projectiles = [];
  for (let i = 0; i < 4; i++) g.step();
  const e = space.spawnEnemy(g, kind, { x: g.space.w / 2 + 900, y: g.space.h / 2, facing: 0 }) || g.space.enemies[g.space.enemies.length - 1];
  const lay = Schilde.layout(CONFIG, kind);
  const mit = lay.max.map((m, i) => i).filter((i) => lay.max[i] > 0);   // Segmente mit Schild
  const ziel = mit.reduce((b, i) => (lay.max[i] > lay.max[b] ? i : b), mit[0]);
  // Winkel (rel. zur Schiffsachse) der Mitte jedes Segments: Quelle dort, 300 px entfernt
  const relVon = (i) => {
    const s = lay.segs[i];
    if (s.seite === 0) return 0;
    if (s.seite === 2) return Math.PI;
    const u = (s.von + s.bis) / 2;
    return Schilde.winkelBei(s.seite, u);
  };
  const quelleVon = (i) => { const r = e.angle + relVon(i); return { x: e.x + Math.cos(r) * 300, y: e.y + Math.sin(r) * 300 }; };
  for (const i of mit) { const q = quelleVon(i); if (Schilde.segmentOf(lay, e.x, e.y, e.angle, q.x, q.y) !== i) throw new Error('Quelle trifft Segment ' + i + ' nicht (' + kind + ')'); }
  const sys0 = Object.keys(e.sys).reduce((o, id) => { o[id] = e.sys[id].z; return o; }, {});
  const rt = Gsys.idVon(e, 'reaktor');
  const festX = e.x, festY = e.y;
  let t = 0, nextHit = 0, k = 0, hits = 0, tHit = null, tSh0 = null, tSys = null, tRt = null, shHit = null;
  while (t < SEK && g.space.enemies.includes(e)) {
    e.x = festX; e.y = festY; e.angle = 0; e.vx = e.vy = 0;
    while (t >= nextHit - 1e-9) {
      const seg = verteilung === 'streu' ? mit[k % mit.length] : ziel;
      if (tHit == null) { tHit = t; shHit = e.shields.map((v) => v > 0.05); }
      space.damageEnemy(g, e, 1, quelleVon(seg).x, quelleVon(seg).y, {}); hits++; k++; nextHit += 1 / RATE;
    }
    g.step(); t += DT;
    e.x = festX; e.y = festY;
    if (tHit != null) {
      if (tSh0 == null && e.shields.some((v, i) => shHit[i] && v < 0.05)) tSh0 = t - tHit;
      if (tSys == null && Object.keys(e.sys).some((id) => sys0[id] === 'ok' && e.sys[id].z !== 'ok')) tSys = t - tHit;
      if (tRt == null && rt && e.sys[rt].z === 'broken') tRt = t - tHit;
    }
  }
  return { tSh0, tSys, tRt, hits };
}
console.log(`Befehl: node tools/sys03-streufeuer-gegner.js --kinds ${kinds} --rate ${RATE} --seeds ${SEEDS} --seed0 ${SEED0} --sek ${SEK} --verteilung ${verteilungen}${process.env.TUNE ? '   (TUNE=' + process.env.TUNE + ')' : ''}`);
console.log('| Klasse | Verteilung | Rate/s | n | Treffer/Lauf | 1. Treffer→1. Segment 0 Median (min–max, n/N) | 1. Treffer→1. Systemschaden Median (min–max, n/N) | 1. Treffer→Reaktor zerstört Median (min–max, n/N) |');
console.log('|---|---|---|---|---|---|---|---|');
for (const kind of kinds) {
  const med = {};
  for (const v of verteilungen) {
    const rs = []; for (let i = 0; i < SEEDS; i++) rs.push(messe(kind, v, SEED0 + i));
    const s1 = stat(rs.map((r) => r.tSh0)), s2 = stat(rs.map((r) => r.tSys)), s3 = stat(rs.map((r) => r.tRt));
    const fm = (s) => `${f(s.med)} (${f(s.min)}–${f(s.max)}, ${s.n}/${rs.length})`;
    med[v] = { s1, s2, s3 };
    console.log(`| ${kind} | ${v} | ${RATE} | ${rs.length} | ${f(rs.reduce((s, r) => s + r.hits, 0) / rs.length)} | ${fm(s1)} | ${fm(s2)} | ${fm(s3)} |`);
  }
  const q = (k, s) => (k.n && s.n ? (s.med / Math.max(k.med, 1e-9)).toFixed(2) : s.n ? '–' : '∞');
  if (med.konzentriert && med.streu) console.log(`Quotient streu/konzentriert ${kind} (Rate ${RATE}/s): Segment 0 ${q(med.konzentriert.s1, med.streu.s1)}, Systemschaden ${q(med.konzentriert.s2, med.streu.s2)}, Reaktor ${q(med.konzentriert.s3, med.streu.s3)}`);
}
