// Sichtprüfung SUND-03b I: der Terminal-Bereich „Information“ (Informationshandel des Konkordats). Echter Server im selben Prozess, echter Browser-Client (Playwright, Chromium),
// Modus „Freie Fahrt Sund“, angedockt in Concordia (Hafen des Konkordats): Knopf „Info“, Angebot, Gerücht gekauft, Beleg gekauft, zu wenig Marken, kein Angebot, römischer Hafen (kein Knopf).
// Aufruf: node tools/sicht-info.js [--shots <Ordner>] [--port 3491] [--vp 1280x720,1920x1080,1024x600]      (Bilder nicht im Repo, Standard: Temp-Ordner)
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3491');
const SHOTS = arg('shots', path.join(os.tmpdir(), 'sund03b-i-shots'));
const VPS = arg('vp', '1280x720,1920x1080,1024x600').split(',').map((s) => s.split('x').map(Number));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-info-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Sektoren = require('../shared/sektoren.js');
const Space = require('../server/sim/space.js');
const Info = require('../server/sim/handel-info.js');
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
    const taste = async (code) => { await page.keyboard.press(code); await sleep(350); };
    const dock = (hex) => { Space.enterScene(g, Sektoren.ortVonHex(hex), {}); Object.assign(g.ship, { docked: true, dockedAt: Sektoren.ortVonHex(hex), vx: 0, vy: 0, speed: 0 }); };
    const ticks = () => { for (let i = 0; i < 400; i++) { Kriegslage.tick(g, 'sicht'); if (Info.angebotFuer(g).themen.length >= 2) return true; } return false; };

    dock('0305'); g.inventory.marks = 500;
    await sitz('shop'); await sleep(900);
    await shot('info-00-roemischer-hafen-kein-knopf', 500);
    dock('0604');
    if (!ticks()) fehler.push('kein Angebot mit 2 Themen nach 400 Ticks');
    await sleep(800);
    await shot('info-01-konkordat-hafen-handel', 600);
    await taste('KeyI'); await shot('info-02-angebot', 600);
    await taste('ArrowDown'); await shot('info-03-zweites-thema', 500);
    await taste('Enter'); await shot('info-04-geruecht-gekauft', 1000);
    await taste('KeyB'); await shot('info-05-beleg-gekauft', 1000);
    g.inventory.marks = 20; await sleep(600);
    await taste('ArrowUp'); await shot('info-06-zu-wenig-marken', 700);
    await taste('KeyW'); await shot('info-07-werft', 500);
    await taste('KeyI'); await taste('KeyK'); await shot('info-08-kurs', 500);
    // kein Thema: Sim leeren
    g.weltsim.zustand.angriffe.length = 0; g.weltsim.ereignisse.length = 0; g.weltsim.infoZahl = (g.weltsim.infoZahl || 0) + 1; g.inventory.marks = 500; await sleep(600);
    await taste('KeyI'); await shot('info-09-kein-angebot', 900);
    if (fehler.length) console.log('FEHLER im Browser:\n  ' + fehler.join('\n  '));
    await page.context().close();
  } finally { await srv.close(); }
  return fehler.length;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const b = await chromium.launch();
  let f = 0, port = PORT;
  for (const [vw, vh] of VPS) f += await lauf(b, vw, vh, port++);
  await b.close();
  console.log(f ? 'FEHLER' : 'Sicht ok', '· Bilder in', SHOTS);
  process.exit(f ? 1 : 0);
})();
