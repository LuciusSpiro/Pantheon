// Sichtprüfung Boden des Finales (SUND-04a-3 Boden): echter Server (im selben Prozess, damit Rang, Orbit-Ende und die Bodenszene präpariert werden können) und echter Browser-Client
// (Playwright, Chromium), Modus „Freie Fahrt Sund“. Bilder der Karte „Schrein von Asgard“ (hrafnheim.schrein) in 1280×720, 1024×600 und 1920×1080:
//   landung       Crew auf dem Transferpad, Wachen und Wächter im Ring, Funk zur Landung
//   schrein-zu    am Schrein vor dem Wächter: Interaktion gesperrt (Hinweistext)
//   schrein-frei  nach dem Wächter: Schrein frei (HALTEN), Wachen abgezogen
// Aufruf: node tools/sicht-boden.js [--shots <Ordner>] [--port 3464] [--dpr 1]      (Bilder nicht im Repo, Standard: Temp-Ordner)
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3464');
const SHOTS = arg('shots', path.join(os.tmpdir(), 'sund04a3-boden-shots'));
const DPR = +arg('dpr', '1');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-boden-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
const Finale = require('../server/sim/finale.js');
const LP = require('../server/sim/landepunkte.js');
const interior = require('../server/sim/interior.js');
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE setzen)'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GROESSEN = [[1280, 720], [1024, 600], [1920, 1080]];

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await startServer({ port: PORT, debug: true, roomCode: 'off', quiet: true, worlds: true, worldDir: path.join(TMP, 'worlds') });
  const g = srv.game;
  const b = await chromium.launch();
  const fehler = [];
  try {
    const page = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: DPR })).newPage();
    page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') fehler.push('console: ' + m.text().slice(0, 200)); });
    await page.goto(`http://127.0.0.1:${PORT}/?debug=1&render=2d`);
    await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
    await page.evaluate(() => { __game.send({ t: 'lobbyOpt', startMission: 'freie_fahrt' }); __game.send({ t: 'ready', ready: true }); });
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await sleep(500);
    g.space.enemies = [];
    g.debugGoto('hrafnheim', false); await sleep(1500);
    g.weltsim.ruf.rom = 1e9;
    g.god = true;
    Finale.ersetzen('szene', { finaleStarten: () => ({ id: 1 }) });
    Finale.ersetzen('abspann', { beenden: () => true });
    g.ship.speed = 0;
    if (!Finale.starten(g) || !Finale.orbitEnde(g, 'sieg') || Finale.phase(g) !== 'boden') throw new Error('Finale kam nicht in den Boden-Teil');
    const p = g.players[0];
    interior.placeOnShipPad(g, p, 0); p.console = 'transfer';
    await page.evaluate(() => __game.send({ t: 'cmd', c: 'transfer.down' }));
    await page.waitForFunction(() => __game.state && __game.state.you && __game.state.you.zone === 'away' || true, null, { timeout: 15000 });
    for (let i = 0; i < 100 && p.zone !== 'away'; i++) await sleep(100);
    if (p.zone !== 'away') throw new Error('nicht gelandet');
    await sleep(1200);
    const k = LP.karte(g, 'hrafnheim.schrein');
    console.log('Karte', k.w + 'x' + k.h, 'Gegner', g.away.drones.length);
    const shot = async (name) => {
      for (const [w, h] of GROESSEN) {
        await page.setViewportSize({ width: w, height: h });
        await sleep(700);
        await page.screenshot({ path: path.join(SHOTS, `${name}-${w}x${h}.png`) });
        console.log('Bild', `${name}-${w}x${h}`);
      }
    };
    await shot('01-landung');
    // am Schrein vor dem Wächter
    const z = k.anker.find((a) => a.id === g.finaleBoden.ziel);
    for (const e of g.away.drones) { e.x = (z.x + 30) * 32; e.y = (z.y + 30) * 32; }   // Gegner aus dem Bild (nur die Ansicht), der Wächter bleibt am Leben
    p.x = z.x * 32 + 16; p.y = (z.y + 1) * 32 + 16;
    await sleep(800);
    await page.keyboard.down('e'); await sleep(500);
    await shot('02-schrein-zu');
    await page.keyboard.up('e');
    // Wächter fällt
    const boss = g.away.drones.find((e) => e.boss); boss.alive = false; boss.hp = 0;
    await sleep(1500);
    await shot('03-schrein-frei');
    await page.keyboard.down('e'); await sleep(1200);
    await shot('04-schrein-halten');
    await page.keyboard.up('e');
  } finally {
    await b.close();
    Finale.ersetzen('szene', null); Finale.ersetzen('abspann', null);
    await srv.close && srv.close();
  }
  console.log('Browserfehler:', fehler.length ? fehler.join(' | ') : 'keine');
  process.exit(fehler.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
