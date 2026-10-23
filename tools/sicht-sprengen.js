// Sichtprüfung Posten sprengen (SUND-02b A2): echter Server (im selben Prozess, damit Rang, Posten der Gegner und Lage der Lerche präpariert werden können) und echter Browser-Client
// (Playwright, Chromium), Modus „Freie Fahrt Sund“. Bilder: Ops mit „Posten angreifen“ (möglich, zu weit), Anlauf mit Fortschritt, Szenenzeile ANGRIFF AUF POSTEN (Vorwarnung, Kampf mit Welle k/n),
// Sieg (Posten gesprengt), Weigerung am eigenen Stützpunkt, am Konkordat-Posten kein Feld.
// Aufruf: node tools/sicht-sprengen.js [--shots <Ordner>] [--port 3462] [--dpr 1]      (Bilder nicht im Repo, Standard: Temp-Ordner)
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3462');
const SHOTS = arg('shots', path.join(os.tmpdir(), 'sund02b-a2-shots'));
const DPR = +arg('dpr', '1');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-sprengen-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
const Sektoren = require('../shared/sektoren.js');
const Locations = require('../shared/locations.js');
const Besitz = require('../server/sim/besitz.js');
const Space = require('../server/sim/space.js');
const PW = require('../content/welt/posten-werte.json').werte;
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE setzen)'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GER1 = '0703';

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
    PW.angreifen.wert.vorlauf = 12;
    const shot = async (name, wartMs) => { await sleep(wartMs || 700); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); console.log('Bild', name); };
    const send = (o) => page.evaluate((m) => __game.send(m), o);
    const sitz = (c) => send({ t: 'debug', cmd: 'sitz', console: c });
    const hin = async (hex) => { await send({ t: 'debug', cmd: 'hex', hex }); await page.waitForFunction((h) => __game.state && __game.state.ship && __game.state.ship.scene === h, Sektoren.ortVonHex(hex), { timeout: 8000 }); await sleep(500); };
    const anPosten = (hex) => { const p = Besitz.postenLage(Locations.get(Sektoren.ortVonHex(hex)).scene); Object.assign(g.ship, { x: p.x, y: p.y, vx: 0, vy: 0, speed: 0 }); g.ship.helm.stage = 1; };
    const z = () => g.weltsim.zustand;
    g.weltsim.ruf.rom = 0;   // Miles genügt
    Object.assign(z().hexe[GER1], { besitzer: 'ger', posten: true, garnison: 4, anspruch: {} }); z().flotten = z().flotten.filter((f) => f.ort !== GER1);

    // 1) germanischer Posten 0703: Angreifen möglich
    await hin(GER1); await sitz('weapons'); await sleep(500); anPosten(GER1); await shot('01-ops-angreifen-moeglich', 900);
    // 2) zu weit
    Object.assign(g.ship, { x: g.ship.x + 800 }); await shot('02-ops-zu-weit', 700); anPosten(GER1);
    // 3) Anlauf
    await send({ t: 'cmd', c: 'weapons.posten.angreifen' }); await sleep(4000); await shot('03-ops-anlauf', 100);
    // 4) Szene: Vorwarnung, Szenenzeile
    await page.waitForFunction(() => __game.state.flotte && __game.state.flotte.sz && __game.state.flotte.sz.p === 'v', null, { timeout: 20000 });
    await shot('04-szene-vorwarnung-ops', 800);
    await sitz('captain'); await sleep(600); await shot('05-szene-vorwarnung-captain', 500);
    await sitz('weapons');
    // 5) Kampf mit Welle k/n
    await page.waitForFunction(() => __game.state.flotte && __game.state.flotte.sz && __game.state.flotte.sz.p === 'k', null, { timeout: 30000 });
    await shot('06-szene-kampf-welle', 2500);
    // 6) Sieg
    for (let i = 0; i < 600 && g.simSzene; i++) { for (const e of g.space.enemies.slice()) { e.hp = 1; Space.damageEnemy(g, e, 500, e.x - 100, e.y, {}); } await sleep(100); }
    await shot('07-szene-sieg-posten-gesprengt', 1200);
    console.log('  Posten:', JSON.stringify(z().hexe[GER1]), 'Ruf', JSON.stringify(g.weltsim.ruf), 'Szene:', JSON.stringify(require('../server/sim/kriegslage-szene.js').letzte(g)).slice(0, 200));
    await shot('08-ops-nach-dem-sprengen', 7000);
    // 7) Konkordat-Posten: kein Feld; eigener Stützpunkt: Weigerung im Befehl (kein Feld)
    Object.assign(z().hexe['0503'], { besitzer: 'kon', posten: true, garnison: 3, anspruch: {} });
    await hin('0503'); await sitz('weapons'); await sleep(400); anPosten('0503'); await shot('09-ops-konkordat-posten-kein-feld', 900);
  } finally {
    await b.close(); await srv.close();
  }
  console.log(fehler.length ? 'Browser-Fehler:\n  ' + fehler.join('\n  ') : 'keine Browser-Fehler');
  console.log('Bilder in ' + SHOTS);
  process.exit(fehler.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
