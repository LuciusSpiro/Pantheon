// Sichtprüfung Posten der Crew (SUND-02b A1): echter Server (im selben Prozess, damit Rang und Lage der Lerche präpariert werden können) und echter Browser-Client
// (Playwright, Chromium), Modus „Freie Fahrt Sund“. Bilder: Ops mit „Posten gründen“ (möglich, verweigert), Halteprozess mit Fortschritt, Posten steht (Dock-Marker),
// Weigerungen (nicht in Roms Anspruch, Station, Rang beim Ausbau), Übersichtskarte mit Roms Anspruch und Legende, Terminal am Stützpunkt (Werft aktiv, Handel gesperrt).
// Aufruf: node tools/sicht-posten.js [--shots <Ordner>] [--port 3461] [--dpr 1]      (Bilder nicht im Repo, Standard: Temp-Ordner)
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3461');
const SHOTS = arg('shots', path.join(os.tmpdir(), 'sund02b-a1-shots'));
const DPR = +arg('dpr', '1');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-posten-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
const Sektoren = require('../shared/sektoren.js');
const Locations = require('../shared/locations.js');
const Besitz = require('../server/sim/besitz.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const PW = require('../content/welt/posten-werte.json').werte;
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE setzen)'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;
    const shot = async (name, wartMs) => { await sleep(wartMs || 700); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); console.log('Bild', name); };
    const send = (o) => page.evaluate((m) => __game.send(m), o);
    const sitz = (c) => send({ t: 'debug', cmd: 'sitz', console: c });
    const hin = async (hex) => { await send({ t: 'debug', cmd: 'hex', hex }); await page.waitForFunction((h) => __game.state && __game.state.ship && __game.state.ship.scene === h, Sektoren.ortVonHex(hex), { timeout: 8000 }); await sleep(500); };
    const anPosten = (hex) => { const p = Besitz.postenLage(Locations.get(Sektoren.ortVonHex(hex)).scene); Object.assign(g.ship, { x: p.x, y: p.y, vx: 0, vy: 0, speed: 0 }); g.ship.helm.stage = 1; };
    g.inventory.ersatzteil = 4;
    g.weltsim.ruf.rom = 0;   // Miles: Gründen verlangt keinen Rang

    // 1) Brachland 0505: Gründen möglich
    await hin('0505'); await sitz('weapons'); await sleep(500); anPosten('0505'); await shot('01-ops-gruenden-moeglich', 900);
    // 2) zu weit
    Object.assign(g.ship, { x: g.ship.x + 800 }); await shot('02-ops-zu-weit', 700); anPosten('0505');
    // 3) Halteprozess
    await send({ t: 'cmd', c: 'weapons.posten.gruenden' }); await sleep(6000); await shot('03-ops-halteprozess', 100);
    // 4) fertig
    await page.waitForFunction(() => !(__game.state.fracht && __game.state.fracht.halt), null, { timeout: 15000 }); await shot('04-ops-posten-steht', 1200);
    console.log('  Posten:', JSON.stringify(g.weltsim.zustand.hexe['0505']), 'Ruf', JSON.stringify(g.weltsim.ruf), 'Ersatzteile', g.inventory.ersatzteil);
    // 5) Weigerungen: germanischer Anspruch, Station
    await hin('0703'); await sitz('weapons'); await sleep(400); anPosten('0703'); await shot('05-ops-nicht-in-roms-anspruch', 900);
    await hin('0603'); await sitz('weapons'); await sleep(400); await shot('06-ops-station', 900);
    // 6) Rang beim Ausbau: römischer Sim-Posten in 0503
    const nd = g.weltsim.zustand.hexe['0503']; Object.assign(nd, { posten: true, besitzer: 'rom', garnison: 3 }); Kriegslage.szeneAbschliessen(g, { wirkungen: [], wo: 'sicht' });
    await hin('0503'); await sitz('weapons'); await sleep(400); anPosten('0503'); await shot('07-ops-ausbau-rang-fehlt', 900);
    g.weltsim.ruf.rom = 30; await shot('08-ops-ausbau-moeglich', 900);
    // 7) Übersichtskarte: Roms Anspruch und Legende
    await sitz('captain'); await sleep(500); await page.keyboard.press('Digit2'); await sleep(900); await shot('09-karte-anspruch-legende', 600);
    // 8) Terminal am Stützpunkt: Brachland, angedockt, Handel gesperrt, Werft aktiv
    await hin('0505'); const dl = Besitz.dockLage(g, Locations.get(Sektoren.ortVonHex('0505')).scene, '0505');
    Object.assign(g.ship, { x: dl.x, y: dl.y - 20, vx: 0, vy: 0, speed: 0 }); g.ship.dockArmed = true; await sleep(800);
    console.log('  angedockt:', g.ship.docked, g.ship.dockedAt);
    await sitz('shop'); await sleep(900); await shot('10-terminal-werft-am-posten', 900);
    await page.keyboard.press('KeyH'); await shot('11-terminal-handel-gesperrt', 900);
  } finally {
    await b.close(); await srv.close();
  }
  console.log(fehler.length ? 'Browser-Fehler:\n  ' + fehler.join('\n  ') : 'keine Browser-Fehler');
  console.log('Bilder in ' + SHOTS);
  process.exit(fehler.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
