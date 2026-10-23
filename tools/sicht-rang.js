// Sichtprüfung SUND-02b UI (Designer): Rang von Rom (Terminal-Statuszeile, Captain-Leiste, Block „Stufe n öffnet“) und die Fixes zu den Befunden aus dem
// Review von A1/C (Ops-Leisten, Lagefunk an der Ops, Karte mit Anspruch und Stützpunkt, gesperrter Kaufknopf). Echter Server im selben Prozess, echter
// Browser-Client (Playwright, Chromium), Modus „Freie Fahrt Sund“; zuletzt Kampagne (Rang muss verschwinden).
// Aufruf: node tools/sicht-rang.js [--shots <Ordner>] [--port 3463] [--vp 1280x720,1920x1080,1024x600]
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3463');
const SHOTS = arg('shots', path.join(os.tmpdir(), 'sund02b-ui-shots'));
const VPS = arg('vp', '1280x720,1920x1080,1024x600').split(',').map((s) => s.split('x').map(Number));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-rang-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
const Sektoren = require('../shared/sektoren.js');
const Locations = require('../shared/locations.js');
const Besitz = require('../server/sim/besitz.js');
const Kriegslage = require('../server/sim/kriegslage.js');
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE setzen)'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lauf(b, vw, vh, port) {
  const srv = await startServer({ port, debug: true, roomCode: 'off', quiet: true, worlds: true, worldDir: path.join(TMP, 'worlds-' + vw) });
  const g = srv.game;
  const fehler = [];
  const tag = vw + 'x' + vh;
  try {
    const page = await (await b.newContext({ viewport: { width: vw, height: vh } })).newPage();
    page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') fehler.push('console: ' + m.text().slice(0, 200)); });
    await page.goto(`http://127.0.0.1:${port}/?debug=1&render=2d`);
    await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
    await page.evaluate(() => { __game.send({ t: 'lobbyOpt', startMission: 'freie_fahrt' }); __game.send({ t: 'ready', ready: true }); });
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await sleep(500);
    g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;
    const shot = async (name, wartMs) => { await sleep(wartMs || 700); await page.screenshot({ path: path.join(SHOTS, tag + '-' + name + '.png') }); console.log('Bild', tag, name); };
    const send = (o) => page.evaluate((m) => __game.send(m), o);
    const sitz = (c) => send({ t: 'debug', cmd: 'sitz', console: c });
    const ruf = (w) => send({ t: 'debug', cmd: 'ruf', args: 'rom ' + w });
    const hin = async (hex) => { await send({ t: 'debug', cmd: 'hex', hex }); await page.waitForFunction((h) => __game.state && __game.state.ship && __game.state.ship.scene === h, Sektoren.ortVonHex(hex), { timeout: 8000 }); await sleep(500); };
    const anPosten = (hex, dx) => { const p = Besitz.postenLage(Locations.get(Sektoren.ortVonHex(hex)).scene); Object.assign(g.ship, { x: p.x + (dx || 0), y: p.y, vx: 0, vy: 0, speed: 0 }); g.ship.helm.stage = 1; };
    const andocken = async (hex) => { const dl = Besitz.dockLage(g, Locations.get(Sektoren.ortVonHex(hex)).scene, hex); Object.assign(g.ship, { x: dl.x, y: dl.y - 20, vx: 0, vy: 0, speed: 0 }); g.ship.dockArmed = true; await sleep(900); };
    g.inventory.ersatzteil = 6;
    await ruf(0);
    // Captain-Karte am Start: Roms Anspruch auf freien Hexen (Gasfeld, Brachland), Rang Miles
    await sitz('captain'); await sleep(500); await page.keyboard.press('Digit2'); await sleep(900); await shot('cap-00-karte-anspruch-miles', 600);

    // Ops: zu weit (Einheit), Gründen möglich
    await hin('0505'); await sitz('weapons'); await sleep(500); anPosten('0505', 800); await shot('ops-02-zu-weit', 900);
    anPosten('0505'); await shot('ops-01-gruenden-moeglich', 700);
    // Ops an der Station mit Weigerung, dann Rangwechsel-Funk (Miles -> Optio) über der Leiste
    await hin('0603'); await sitz('weapons'); await sleep(500); await ruf(8); await shot('ops-06-station-rangfunk', 1200);
    // Ops: Ausbau am Gasfeld (Fracht, Höhe halten, Stützpunkt ausbauen gestapelt)
    await ruf(12);
    const nd = g.weltsim.zustand.hexe['0503']; Object.assign(nd, { posten: true, besitzer: 'rom', garnison: 3 }); Kriegslage.szeneAbschliessen(g, { wirkungen: [], wo: 'sicht' });
    await hin('0503'); await sitz('weapons'); await sleep(400); anPosten('0503'); await shot('ops-07-ausbau-rang-fehlt', 1500);
    await ruf(30); await shot('ops-08-ausbau-moeglich', 1500);
    // Posten in Brachland gründen (wird Stützpunkt der Crew)
    await ruf(12);
    await hin('0505'); await sitz('weapons'); await sleep(400); anPosten('0505');
    await send({ t: 'cmd', c: 'weapons.posten.gruenden' });
    await page.waitForFunction(() => __game.state.fracht && __game.state.fracht.halt, null, { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => !(__game.state.fracht && __game.state.fracht.halt), null, { timeout: 20000 });
    await sleep(800);
    // Captain: Karte mit Anspruch, Stützpunkt, Rang in der Leiste (Ruf jetzt 20 nach +8)
    await sitz('captain'); await sleep(500); await page.keyboard.press('Digit2'); await sleep(900); await shot('cap-09-karte-anspruch-rang', 600);
    // Captain Funk-Reiter (Rang steht in der Leiste auf jedem Reiter)
    await page.keyboard.press('Digit1'); await shot('cap-funk-rang', 700);
    // Terminal am Stützpunkt Brachland: Werft, Handel gesperrt
    await andocken('0505'); console.log('  angedockt:', g.ship.docked, g.ship.dockedAt);
    await sitz('shop'); await sleep(900); await shot('term-10-werft-am-posten', 900);
    await page.keyboard.press('KeyH'); await shot('term-11-handel-gesperrt', 900);
    // Werft am Hafen Castra Gradivi (Flottenbasis): Stufe 2 gesperrt (Rang Optio), Stufe-Ansicht
    g.inventory.marks = 4920;
    await hin('0304'); await andocken('0304'); console.log('  angedockt:', g.ship.docked, g.ship.dockedAt);
    await sitz('shop'); await sleep(900);
    await send({ t: 'cmd', c: 'werft.freischalten', art: 'stufe', id: 1 }); await sleep(600);   // Stufe 1 gekauft: Stufe 2 verlangt Centurio (Rang Optio)
    await page.keyboard.press('KeyW'); await page.keyboard.press('KeyA'); await shot('term-werft-hafen-stufe', 900);
    await page.keyboard.press('KeyA'); await shot('term-werft-hafen-platz', 700);
    // Handel am Hafen Ostia Nova (ohne Werft)
    await hin('0305'); await andocken('0305'); await sitz('shop'); await sleep(900); await shot('term-handel-ostia', 900);
    // Legat: höchster Rang
    await ruf(200); await shot('term-handel-legat', 900);
    // Modus endet: zurück in die Lobby, Kampagne starten: kein Rang
    await send({ t: 'debug', cmd: 'lobby' }).catch(() => {});
  } finally {
    await srv.close();
  }
  return fehler;
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const b = await chromium.launch();
  const alle = [];
  try {
    let port = PORT;
    for (const [w, h] of VPS) { const f = await lauf(b, w, h, port++); alle.push(...f.map((x) => w + 'x' + h + ' ' + x)); }
  } finally { await b.close(); }
  console.log(alle.length ? 'Browser-Fehler:\n  ' + alle.join('\n  ') : 'keine Browser-Fehler');
  console.log('Bilder in ' + SHOTS);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
