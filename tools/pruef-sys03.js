'use strict';
// Prüfer SYS-03 (Abnahme im laufenden System). Startet den echten Server (server/index.js startServer, --debug-Modus) im selben Prozess auf Port 3477,
// Chromium per Playwright, Treffer über dieselben Einstiege wie das Spiel (space.shipHit, space.damageEnemy, Escort.hit).
// Aufruf: node tools/pruef-sys03.js <phase> [--shots <Ordner>]    phasen: siehe PHASEN in tools/pruef-sys03-phasen.js (lerche gegner scan scanleer technik schild hud waffen reaktor reaktor2)
// Abnahme-Nachweis SYS-03: Bilder und Konsolenausgabe je Phase; braucht Playwright (C:/tmp/pw-test); Exit 0 = Lauf ohne Abbruch (die Befunde stehen in der Ausgabe, kein Test)
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PHASE = process.argv[2];
const SHOTS = path.resolve(arg('shots', path.join(ROOT, 'shots', 'pruef')));
const PORT = 3477;
process.env.REGIE_DIR = path.join(ROOT, 'data/regie-pruef'); process.env.ERZEUGT_DIR = path.join(ROOT, 'data/erzeugt-pruef'); process.env.WORLD_DIR = path.join(ROOT, 'data/worlds-pruef');
process.env.MISSION_SOURCE = 'fallback';
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { chromium } = require('C:/tmp/pw-test/node_modules/playwright-core');
const { startServer } = require('../server/index.js');
const CONFIG = require('../shared/config.js');
const Schilde = require('../shared/schilde.js');
const space = require('../server/sim/space.js');
const I = require('../server/sim/interior.js');
const Gsys = require('../server/sim/gegnersystem.js');
const Escort = require('../server/sim/escort.js');
const Flotte = require('../server/sim/flotte.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (x) => JSON.stringify(x);
fs.mkdirSync(SHOTS, { recursive: true });

async function boot(render, scale) {
  const srv = await startServer({ port: PORT, debug: true, roomCode: 'off', noStore: true, quiet: true });
  const game = srv.game;
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: scale || 1 })).newPage();
  const fehler = [];
  page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') fehler.push('console: ' + m.text().slice(0, 240)); });
  await page.goto(`http://127.0.0.1:${PORT}/?debug=1&render=${render || '2d'}`);
  await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
  await page.evaluate(() => __game.send({ t: 'lobbyOpt', startMission: 'free', skipDrill: true }));
  await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
  await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
  await page.mouse.move(5, 5);
  const dbg = (o) => page.evaluate((x) => __game.send(Object.assign({ t: 'debug' }, x)), o);
  const sitz = async (c) => { await dbg({ cmd: 'sitz', console: c }); await sleep(600); };
  const snap = () => page.evaluate(() => __game.state);
  const shot = async (name, opt) => { const f = path.join(SHOTS, name + '.png'); await page.screenshot(Object.assign({ path: f }, opt || {})); console.log('BILD ' + f); return f; };
  async function schliessen() { await b.close(); await srv.close(); }
  return { srv, game, b, page, fehler, dbg, sitz, snap, shot, schliessen };
}
async function startFlug(P) {
  await P.sitz('helm');
  for (let i = 0; i < 3; i++) await P.page.evaluate(() => __game.send({ t: 'cmd', c: 'helm.throttle', delta: 1 }));
  await P.page.waitForFunction(() => { const s = __game.state.ship || {}; return !s.docked && !s.dockedAt; }, null, { timeout: 15000 }).catch(() => console.log('noch angedockt'));
  await sleep(1500);
  P.game.space.enemies = []; P.game.space.projectiles = [];
  const sh = P.game.ship; sh.vx = sh.vy = 0;
}
const zoneSys = (g, z) => I.SYSTEM_ORDER.filter((k) => I.systemSector(k) === z && I.systemAktiv(g, k));
const stand = (g) => { const o = {}; for (const k of I.SYSTEM_ORDER) o[k] = g.ship.systems[k]; return o; };
const diff = (a, b) => I.SYSTEM_ORDER.filter((k) => a[k] !== b[k]).map((k) => `${k}: ${a[k]} -> ${b[k]}`);
async function technikTab(P) { await P.sitz('technik'); await P.page.evaluate(() => { if (window.Consoles) Consoles.ttab = 1; }); await P.page.mouse.move(5, 5); await sleep(400); }

const PHASEN = {};
module.exports = { PHASEN, boot, startFlug, zoneSys, stand, diff, technikTab, sleep, J, SHOTS, PORT };
require('./pruef-sys03-phasen.js');
setTimeout(() => { console.log('WATCHDOG: Zeitlimit'); process.exit(3); }, 150000).unref();
(async () => {
  if (!PHASEN[PHASE]) { console.log('Phase unbekannt: ' + PHASE); process.exit(2); }
  let code = 0;
  try { code = (await PHASEN[PHASE]()) || 0; } catch (e) { console.log('ABBRUCH ' + (e.stack || e)); code = 1; }
  process.exit(code);
})();
