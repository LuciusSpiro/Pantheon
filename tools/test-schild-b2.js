'use strict';
// SYS-01 B2 Teil 1: Schild der Lerche. Kapazität je Sektor 6, schnellere Regeneration (regenInterval 2 s statt 4 s),
// Regeneration unter Sturm gesperrt, Sturm-Nadel nimmt den Schild um schildFaktor × Schaden (Rundung im Sturm-Zweig behoben).
// Befund (info, kein Fehler): Die Abnahme „Sturm bricht vollen Schild in ≤ 15 s“ wird mit den heutigen Sturm-Werten NICHT erreicht
// (Gegner-Sturm: 0,0375 Schild je Nadel). Das ist eine Balance-Entscheidung, siehe Rückmeldung B2.
//   node tools/test-schild-b2.js   (npm run test:schild-b2)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const Katalog = require('../shared/schiffskatalog.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');

const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const info = (t) => console.log('  info ' + t);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-schild-b2-'));

function arena(seed) {
  const g = new Game({ noStore: true, worlds: false, seed: seed || 1, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie' + (seed || 1)) }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'F0', name: 'F0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' }); g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.god = false;
  const sh = g.ship; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; sh.vx = sh.vy = 0;
  g.space.enemies = []; g.space.projectiles = [];
  for (let i = 0; i < 10; i++) g.step();   // Pool wird erst nach einigen Ticks auf Energie 2 × 3 gesetzt
  return g;
}
const lauf = (g, sek, cb) => { const t1 = g.time + sek; while (g.time < t1) { const sh = g.ship; sh.vx = sh.vy = 0; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; g.step(); if (cb) cb(); } };

console.log('\n[Konfiguration]');
ok(CONFIG.shields.maxPerSector === 6, 'maxPerSector 6 (vorher 4)');
ok(CONFIG.shields.pointsPerPower === 3 && CONFIG.shields.default.join(',') === '2,2,0,2', 'Pool-Größe (pointsPerPower 3) und Start-Verteilung [2,2,0,2] unverändert');
ok(CONFIG.shields.regenInterval === 2, `regenInterval 2 s (vorher 4 s), Ist ${CONFIG.shields.regenInterval}`);

console.log('\n[Kapazität je Sektor]');
{
  const g = arena(1); const sh = g.ship;
  sh.shields.alloc = [2, 2, 0, 2]; sh.shields.allocIntent = [2, 2, 0, 2];
  // Sektor 1 und 3 leeren, Sektor 0 auf die Obergrenze füllen (Pool 6)
  for (let k = 0; k < 2; k++) { space.technikShield(g, 1, 0); space.technikShield(g, 3, 0); }
  let fehl = null; while (sh.shields.alloc[0] < 6) { const e = space.technikShield(g, 0, 1); if (e) { fehl = e; break; } }
  ok(sh.shields.alloc[0] === 6 && fehl === null, `Sektor 0 nimmt 6 Punkte auf (Pool ${sh.shields.pool}, Zuteilung ${sh.shields.alloc.join('/')})`);
  const siebte = space.technikShield(g, 0, 1);
  ok(!!siebte && sh.shields.alloc[0] === 6, `siebter Punkt wird abgelehnt (${siebte || 'keine Meldung'})`);
}

console.log('\n[Regeneration]');
{
  const g = arena(2); const sh = g.ship;
  sh.shields.regenHold = 0; sh.shields.current = [0, 0, 0, 0]; sh.shields.regenT = 0;
  const alloc = sh.shields.alloc.slice();
  let t0 = null, tVoll = null; const gestartet = g.time;
  lauf(g, 12, () => { if (tVoll == null && sh.shields.current[0] >= alloc[0] - 1e-9 && alloc[0] > 0) tVoll = g.time - gestartet; });
  // Sektor 0 steht bei alloc 2: je Punkt ein Intervall (2 s) → 4 s bis voll (vor B2: 8 s)
  ok(tVoll != null && tVoll <= 2 * CONFIG.shields.regenInterval + 0.5, `Sektor 0 (Zuteilung ${alloc[0]}) ist nach ${tVoll != null ? tVoll.toFixed(1) : '–'} s voll, Soll ${2 * CONFIG.shields.regenInterval} s (vorher 8 s)`);
}

console.log('\n[Regeneration auf Kappe 6]');
{
  const g = arena(4); const sh = g.ship; const MAX = CONFIG.shields.maxPerSector;
  sh.shields.alloc = [MAX, 0, 0, 0]; sh.shields.allocIntent = [MAX, 0, 0, 0]; sh.shields.current = [MAX - 3, 0, 0, 0];
  sh.shields.regenHold = 0; sh.shields.regenT = 0;
  const s0 = sh.shields.current[0]; const verlauf = [];
  lauf(g, 3 * CONFIG.shields.regenInterval + 0.5, () => { const v = sh.shields.current[0]; if (verlauf[verlauf.length - 1] !== v) verlauf.push(v); });
  ok(sh.shields.cap[0] === MAX, `Kappe des Sektors ${sh.shields.cap[0]} = maxPerSector`);
  ok(verlauf.length >= 3 && verlauf[verlauf.length - 1] === MAX, `Schild auf Kappe ${MAX} steigt je Intervall (${CONFIG.shields.regenInterval} s) Punkt für Punkt: ${[s0, ...verlauf].join(' -> ')}`);
  lauf(g, 2 * CONFIG.shields.regenInterval + 0.5);
  ok(sh.shields.current[0] <= MAX + 1e-9, `über der Kappe wächst er nicht (${sh.shields.current[0]})`);
}

console.log('\n[Sturm: Regeneration gesperrt, Schildschaden je Nadel]');
{
  const g = arena(3); const sh = g.ship; const ST = Katalog.waffe('sturmbatterie').sturm;
  sh.shields.alloc = [6, 0, 0, 0]; sh.shields.allocIntent = [6, 0, 0, 0]; sh.shields.current = [6, 0, 0, 0];
  sh.shields.regenHold = 0;
  const s0 = sh.shields.current[0];
  space.shipHit(g, 0, 0.15, { sperrfeuer: true, sturm: true });
  const nach = sh.shields.current[0];
  ok(near(s0 - nach, 0.15 * ST.schildFaktor, 1e-9), `eine Sturm-Nadel nimmt ${(s0 - nach).toFixed(4)} Schild (0,15 × ${ST.schildFaktor}, vorher auf 0 gerundet)`);
  ok(sh.shields.regenHold > g.time && sh.shields.regenHold <= g.time + ST.regenSperre + 1e-6, 'Sturm setzt die Regenerationssperre');
  lauf(g, 3);
  ok(sh.shields.current[0] <= nach + 1e-9 + 0.0, `unter Sturm-Sperre regeneriert der Schild nicht (${nach.toFixed(4)} -> ${sh.shields.current[0].toFixed(4)})`);
  // Sperre läuft ab, dann regeneriert er wieder
  lauf(g, ST.regenSperre + 2.5);
  ok(sh.shields.current[0] > nach + 1e-9, 'nach Ablauf der Sperre regeneriert er wieder');
}

console.log('\n[Sturm-Bruch: Befund]');
{
  // Dauerfeuer: Nadeln je Sekunde gegen einen vollen Bug-Schild (6 Punkte). Mit 0,0375 je Nadel sind 160 Nadeln für 6 Punkte nötig.
  const ST = Katalog.waffe('sturmbatterie').sturm;
  const noetig = 6 / (0.15 * ST.schildFaktor);
  info(`Sturm-Bruch: ${noetig.toFixed(0)} Nadeln für einen vollen Schild (6 Punkte) bei 0,15 Schaden und Faktor ${ST.schildFaktor}. Abnahme 10 (≤ 15 s) ist damit nicht erreicht; Gegner-Sturm: ca. 55 Nadeln in 150 s (Messung, siehe Rückmeldung).`);
}

console.log('\n' + (fails ? 'FEHLER: ' + fails + ' von ' + n : 'alle ' + n + ' Prüfungen grün') + ' (test-schild-b2)');
process.exit(fails ? 1 : 0);
