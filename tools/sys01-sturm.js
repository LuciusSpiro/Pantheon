'use strict';
// SYS-01 D (Abnahme 9/10, Entscheidung 2): Sturm-Messung, deterministisch, ohne Bot.
//   node tools/sys01-sturm.js [--seeds 20] [--sek 120] [--faktor 0.25]
// A) Lerche-Sturm gegen den vollen Gegner-Schild: ruhende Attrappe (Klasse mit Schild 3 je Segment = Kreuzer, Segment zur Lerche), 100 % Treffer, Pool 4 auf einer Sturmbatterie.
//    Gemessen: Zeit, bis das getroffene Segment auf "niedrig" (Katalog sturm.niedrig) fällt, und Zeit bis 0 (Sturm allein erreicht 0 nicht, er stört nur); zum Vergleich
//    die Standardbatterie (Zeit bis 0).
// B) Gegner-Sturm gegen den vollen Lerchen-Schild: Korvette mit Sturm-Verhalten feuert auf die stehende Lerche (Schild [6,6,6,6]); gemessen: Nadeln, Schild des meistgetroffenen
//    Segments nach 30/60/120 s, Zeit bis "niedrig" (Schild ≤ sturm.niedrig).
// `--faktor` setzt Katalog.WAFFEN sturmbatterie.sturm.schildFaktor für den Lauf (zum Abtasten, ohne die Datei zu ändern).
const path = require('path');
const fs = require('fs');
const os = require('os');
const CONFIG = require('../shared/config.js');
const Katalog = require('../shared/schiffskatalog.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Testhilfe = require('./gegner-testhilfe.js');
const Waffen = require('../server/sim/schiffswaffen.js');
const Ausbau = require('../server/sim/ausbau.js');
const Maps = require('../shared/maps.js');
const a = process.argv.slice(2);
const arg = (k, d) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : d);
const SEEDS = Number(arg('--seeds', 20)), SEK = Number(arg('--sek', 120));
const ST = Katalog.waffe('sturmbatterie').sturm;
if (arg('--faktor', null) != null) ST.schildFaktor = Number(arg('--faktor'));
const DT = 1 / CONFIG.tickHz;
const f1 = (v) => (v == null ? '—' : (Math.round(v * 10) / 10).toString());
const med = (v) => { v = v.filter((x) => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor((v.length - 1) / 2 + 0.5)] : null; };
function neu(seed) {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sys01-st-'));
  const g = new Game({ noStore: true, worlds: false, seed, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'S0', name: 'S0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' }); g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.god = true; g.players[0].console = 'weapons';
  const sh = g.ship; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; sh.vx = sh.vy = 0;
  g.space.enemies = []; g.space.projectiles = [];
  return g;
}
// A) Lerche -> Gegner
function messeA(waffe, seed) {
  const g = neu(seed); const sh = g.ship;
  const platz = 4; const stufe = Maps.waffenplatz(platz).stufe;
  Ausbau.setStufe(g, stufe);
  for (const p of Maps.WAFFENPLAETZE) if (stufe >= p.stufe) Waffen.bestuecken(g, p.platz, p.platz === platz ? waffe : 'leer');
  g.ship.powerIntent = { engines: 2, shields: 2, weapons: 2 }; Object.assign(g.ship.power, g.ship.powerIntent);
  const ids = Waffen.energieMounts(g).map((x) => x.id);
  const e = space.spawnEnemy(g, 'kreuzer', { x: sh.x, y: sh.y - 300, facing: Math.PI });
  Testhilfe.setzeBudget(e, 1e9); e.pin = { x: e.x, y: e.y, angle: e.angle };
  const max = e.shields.slice();
  const want = {}; for (const id of ids) want[id] = 4; g.ship.wAllocIntent = want;
  let t = 0, tNiedrig = null, t0 = null, sec = null;
  while (t < SEK && t0 == null) {
    sh.vx = sh.vy = 0; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; e.x = e.pin.x; e.y = e.pin.y; e.angle = e.pin.angle; e.vx = 0; e.vy = 0; Testhilfe.setzeGesamt(e, 1e9); e.fireT = -999;
    for (const id of ids) { const m = g.ship.mount[id]; if (m.charge >= 1 && !(m.salvo > 0)) Waffen.weaponsFire(g, id); }
    g.step(); t += DT;
    if (sec == null) { const i = e.shields.findIndex((v, k) => v < max[k] - 1e-6); if (i >= 0) sec = i; }
    if (sec != null) { if (tNiedrig == null && e.shields[sec] <= ST.niedrig + 1e-6) tNiedrig = t; if (e.shields[sec] <= 1e-6) t0 = t; }
  }
  return { sek: sec != null ? max[sec] : null, tNiedrig, t0 };
}
// B) Gegner (Sturm) -> Lerche
function messeB(seed) {
  const g = neu(seed); const sh = g.ship;
  sh.shields.alloc = [6, 0, 0, 0]; sh.shields.allocIntent = [6, 0, 0, 0]; sh.shields.current = [6, 0, 0, 0]; sh.shields.regenHold = 0;   // Pool 6 ganz auf den Bug, die Korvette steht vor dem Bug
  const e = space.spawnEnemy(g, 'korvette', { x: sh.x + 300, y: sh.y, facing: Math.PI });
  for (const k of Object.keys(e.waffen || {})) e.waffen[k] = 'sturmbatterie';
  Testhilfe.setzeBudget(e, 1e9); e.pin = { x: e.x, y: e.y, angle: e.angle };
  let t = 0, nadeln = 0, tNiedrig = null; const at = {};
  const orig = g.emit.bind(g);
  g.emit = function (k, d) { if (k === 'hit' && !(d && d.evaded)) nadeln++; return orig(k, d); };
  while (t < SEK) {
    sh.vx = sh.vy = 0; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; e.x = e.pin.x; e.y = e.pin.y; e.angle = e.pin.angle; e.vx = 0; e.vy = 0; Testhilfe.setzeGesamt(e, 1e9);
    g.step(); t += DT;
    const mn = sh.shields.current[0];
    if (tNiedrig == null && mn <= ST.niedrig + 1e-6) tNiedrig = t;
    for (const s of [30, 60, 120]) if (at[s] == null && t >= s) at[s] = mn;
  }
  return { nadeln, tNiedrig, at, verh: Object.values(e.waffen || {}).join(',') };
}
console.log(`Befehl: node tools/sys01-sturm.js --seeds ${SEEDS} --sek ${SEK}${arg('--faktor', null) != null ? ' --faktor ' + arg('--faktor') : ''}   (sturm.schildFaktor ${ST.schildFaktor}, niedrig ${ST.niedrig})`);
for (const w of ['sturmbatterie', 'standardbatterie']) {
  const rs = []; for (let i = 0; i < SEEDS; i++) rs.push(messeA(w, 1 + i));
  console.log(`A) Lerche ${w} (Pool 4, 100 % Treffer) gegen Gegner-Schild ${rs[0].sek} (Kreuzer, getroffenes Segment): Zeit bis niedrig (≤ ${ST.niedrig}) Median ${f1(med(rs.map((r) => r.tNiedrig)))} s (n ${rs.filter((r) => r.tNiedrig != null).length}/${rs.length}), Zeit bis 0 Median ${f1(med(rs.map((r) => r.t0)))} s (n ${rs.filter((r) => r.t0 != null).length}/${rs.length})`);
}
const rb = []; for (let i = 0; i < SEEDS; i++) rb.push(messeB(1 + i));
console.log(`B) Gegner-Sturm (Korvette, Waffen ${rb[0].verh}) gegen vollen Lerchen-Schild (Bug 6): Treffer in ${SEK} s Median ${f1(med(rb.map((r) => r.nadeln)))}, Bug-Schild nach 30 s ${f1(med(rb.map((r) => r.at[30])))}, 60 s ${f1(med(rb.map((r) => r.at[60])))}, ${SEK} s ${f1(med(rb.map((r) => r.at[SEK] != null ? r.at[SEK] : r.at[120])))}; Zeit bis niedrig Median ${f1(med(rb.map((r) => r.tNiedrig)))} s (n ${rb.filter((r) => r.tNiedrig != null).length}/${rb.length})`);
