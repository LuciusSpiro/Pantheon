'use strict';
// SYS-01 Erkundung Frage 1: Dauerleistung JE WAFFE am Ladepool (deterministisch, ruhende Attrappe ohne Schild, 100 % Treffer, Ops feuert sofort bei Bereitschaft).
// Aufbau wie tools/pan01-feuerkraft-messung.js, aber EINE Waffe allein auf ihrem Platz mit 1, 2 oder 4 Ladepunkten (Pool Energie 2 + 2 = 4, allocMax 4).
//   node tools/sys01-dauerleistung.js [--sek 150] [--punkte 1,2,4] [--ziel schild]
// Ausgabe: Waffenschaden/s (game.stats.waffenSchaden.gesamt = Schaden, der am Ziel ankommt), Anfangsstoß 0–10 s, Schuss/Zyklus-Zeit.
const path = require('path');
const fs = require('fs');
const os = require('os');
const CONFIG = require('../shared/config.js');
const Katalog = require('../shared/schiffskatalog.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Waffen = require('../server/sim/schiffswaffen.js');
const Ausbau = require('../server/sim/ausbau.js');
const Maps = require('../shared/maps.js');
const a = process.argv.slice(2);
const arg = (k, d) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : d);
const SEK = Number(arg('--sek', 150)); const PUNKTE = arg('--punkte', '1,2,4').split(',').map(Number);
const DT = 1 / CONFIG.tickHz;
const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
// Platz je Platzart und Ziel (Attrappe) – wie die Feuerkraft-Messung: Bug 8/5 -> Ziel voraus, Backbord 4 -> Ziel (0,-300), Heck 2 -> Jäger nah
const TESTS = [
  { id: 'standardbatterie', platz: 4 }, { id: 'sturmbatterie', platz: 4 }, { id: 'streubatterie', platz: 4 }, { id: 'lanzenbatterie', platz: 4 },
  { id: 'lanze', platz: 8 }, { id: 'standardkanone', platz: 5 }, { id: 'abwehrturm', platz: 2 },
];
function messe(t, punkte) {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sys01-dl-'));
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'F0', name: 'F0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' }); g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.god = true; g.players[0].console = 'weapons';
  const sh = g.ship; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; sh.vx = sh.vy = 0;
  const stufe = Maps.waffenplatz(t.platz).stufe;
  Ausbau.setStufe(g, stufe);
  for (const p of Maps.WAFFENPLAETZE) if (stufe >= p.stufe) Waffen.bestuecken(g, p.platz, p.platz === t.platz ? t.id : 'leer');
  const POOL = 4, wp = POOL - 2;
  g.ship.powerIntent = { engines: 2, shields: 2, weapons: wp };
  Object.assign(g.ship.power, g.ship.powerIntent);
  const ids = Waffen.energieMounts(g).map((x) => x.id);
  g.space.enemies = []; g.space.projectiles = [];
  const mk = (kind, dx, dy) => { const e = space.spawnEnemy(g, kind, { x: sh.x + dx, y: sh.y + dy, facing: Math.PI }); e.shields = e.shields.map(() => 0); e.hp = e.hpMax = 1e9; e.pin = { x: e.x, y: e.y, angle: e.angle }; return e; };
  mk('korvette', 400, 0); mk('korvette', 0, -300); mk('korvette', 0, 300); mk('raider', -120, 90);
  const pin = () => { sh.vx = sh.vy = 0; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; for (const e of g.space.enemies) { e.x = e.pin.x; e.y = e.pin.y; e.angle = e.pin.angle; e.vx = 0; e.vy = 0; e.hp = 1e9; e.fireT = -999; e.boltT = -999; if (e.sf) e.sf.t = -999; e.tele = null; } };
  const want = {}; for (const id of ids) want[id] = punkte; g.ship.wAllocIntent = want;
  const fenster = [[0, 10], [30, SEK]]; const sum = fenster.map(() => 0); let last = 0, tt = 0, schuss = 0;
  const zaehl = () => ((g.stats.waffenSchaden || {}).gesamt || 0);
  while (tt < SEK) {
    pin();
    for (const id of ids) {
      const m = g.ship.mount[id]; const w = Waffen.waffeAn(g, id);
      if (w.art === 'lanze') { if (m.charging && m.power >= 1) { Waffen.weaponsCharge(g, id, false); schuss++; } else if (!m.charging && m.charge >= 1) Waffen.weaponsCharge(g, id, true); }
      else if (m.charge >= 1 && !(m.salvo > 0)) { Waffen.weaponsFire(g, id); schuss++; }
    }
    g.step(); tt += DT;
    const z = zaehl(); const d = z - last; last = z;
    fenster.forEach((fw, i) => { if (tt > fw[0] && tt <= fw[1]) sum[i] += d; });
  }
  return { stoss: sum[0], rate: sum[1] / (SEK - 30), schuss };
}
console.log(`Befehl: node tools/sys01-dauerleistung.js --sek ${SEK} --punkte ${PUNKTE}   (Pool 4 = Energie 2 + 2; ruhende Attrappen ohne Schild, 100 % Treffer; Fenster Dauer = 30–${SEK} s)`);
console.log('| Waffe | Platz | Punkte | Katalog: Schaden × Rohre | Ladung je Waffe (Schaden×Rohre) | Ladekosten s/Punkt | Rechnung Schaden×Rohre/(ladekosten/Punkte) je s | gemessen Schaden/s (30–' + SEK + ' s) | gemessen je Ladepunkt | Schaden 0–10 s | Ladungen/Salven |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const t of TESTS) for (const p of PUNKTE) {
  const w = Katalog.waffe(t.id); const r = messe(t, p);
  const calc = w.schaden * w.rohre / (w.ladekosten / p + (w.nachlauf || 0));   // Dauerleistung nach Modell
  console.log(`| ${t.id} | ${t.platz} | ${p} | ${w.schaden} × ${w.rohre} = ${f2(w.schaden * w.rohre)} | ${Katalog.volley(t.id)} | ${w.ladekosten} | ${f2(calc)} | ${f2(r.rate)} | ${f2(r.rate / p)} | ${f2(r.stoss)} | ${r.schuss} |`);
}
const T = Katalog.TORPEDO;
console.log(`Torpedowerfer (kein Pool, Cooldown ${T.cooldown} s, Lager ${T.lagerStart}/${T.lagerMax}): Schaden Jäger ${T.schaden.raider}, Korvette/Fregatte/Kreuzer ${T.schaden.korvette} je Treffer, nur gegen Segment mit Schild 0 (Lesart B) = ${f2(T.schaden.korvette / T.cooldown)} Schaden/s auf Hülle; gegen Lerche ${T.gegenLerche} Schadenspunkte.`);
