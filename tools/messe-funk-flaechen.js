// SUND-03b UI2: misst im echten Browser-Client, wo an jeder Konsole/Ansicht Bedienflächen (R.ui.buttons) und die Funk-Antwortleiste liegen, und schreibt tools/fixtures/funk-bedienflaechen.json.
// Grundlage von tools/test-ui-03b.js (Leiste/Streifen über keiner Bedienfläche). Neu messen, wenn sich ein Pult-Layout ändert.
// Aufruf: node tools/messe-funk-flaechen.js [--shots <Ordner>] [--port 3501]
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3501');
const SHOTS = arg('shots', '');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-messe-funk-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Sektoren = require('../shared/sektoren.js');
const Space = require('../server/sim/space.js');
const Info = require('../server/sim/handel-info.js');
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE)'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BLOCK = { nr: 5, von: 'Römische Streife', optionen: [{ id: 'a', text: 'Lage an den Hafen melden.' }, { id: 'b', text: 'Händlerfunk informieren.' }, { id: 'c', text: 'Verstanden, weiter auf Kurs.' }], ignorieren: 'Nicht antworten', rest: 2 };

(async () => {
  const srv = await startServer({ port: PORT, debug: true, roomCode: 'off', quiet: true, worlds: true, worldDir: path.join(TMP, 'worlds') });
  const g = srv.game;
  const b = await chromium.launch();
  const out = { gemessen: new Date().toISOString().slice(0, 10), ansichten: {} };
  try {
    const page = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await page.goto(`http://127.0.0.1:${PORT}/?debug=1&render=2d`);
    await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
    await page.evaluate(() => { __game.send({ t: 'lobbyOpt', startMission: 'freie_fahrt' }); __game.send({ t: 'ready', ready: true }); });
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await sleep(500);
    g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;
    const send = (o) => page.evaluate((m) => __game.send(m), o);
    const sitz = async (c) => { await send({ t: 'debug', cmd: 'sitz', console: c }); await sleep(500); };
    const taste = async (code) => { await page.keyboard.press(code); await sleep(350); };
    const dock = (hex) => { Space.enterScene(g, Sektoren.ortVonHex(hex), {}); Object.assign(g.ship, { docked: true, dockedAt: Sektoren.ortVonHex(hex), vx: 0, vy: 0, speed: 0 }); };
    const messen = async (name) => {
      await sleep(500);
      const r = await page.evaluate(() => {
        const R = window.Render, bar = Funkwahl.store.rechteck;
        // Knöpfe dieses Bildes ohne die der Leiste (erkennbar an Beschriftung und Lage in ihrem Rechteck)
        const eigene = ['Lage an den Hafen melden.', 'Händlerfunk informieren.', 'Verstanden, weiter auf Kurs.', 'Nicht antworten', 'Später', 'Funk antworten'];
        const inBar = (x) => bar && eigene.includes(x.label) && x.x >= bar.x && x.y >= bar.y && x.x + x.w <= bar.x + bar.w && x.y + x.h <= bar.y + bar.h;
        const knoepfe = R.ui.buttons.filter((x) => !inBar(x)).map((x) => ({ x: Math.round(x.x), y: Math.round(x.y), w: Math.round(x.w), h: Math.round(x.h), label: String(x.label || '').slice(0, 30) }));
        const k = Pult.konsole({}) || {};
        return { S: k.S, station: k.station, zu: Funkwahl.zu(k), knoepfe };
      });
      out.ansichten[name] = r;
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'messen-' + name + '.png') }); }
      console.log(name, 'S=' + r.S, r.station, r.zu ? 'Streifen' : 'Leiste', r.knoepfe.length + ' Knöpfe');
    };
    await page.evaluate((bl) => { Funkwahl.lesen({ t: 'snap', phase: 'play', world: { funkwahl: bl } }); Funkwahl.store.eingeklappt = false; }, BLOCK);
    await sitz('helm'); await messen('helm');
    await sitz('weapons'); await messen('weapons');
    await sitz('technik');
    for (const t of [0, 1]) { await page.evaluate((v) => { Consoles.ttab = v; }, t); await messen('technik-' + t); }
    await page.evaluate(() => { Consoles.ttab = 0; });
    await sitz('captain');
    for (const t of [0, 1, 2, 4, 5]) { await page.evaluate((v) => { Consoles.tab = v; }, t); await messen('captain-' + t); }
    await page.evaluate(() => { Consoles.tab = 0; });
    dock('0604');
    for (let i = 0; i < 400; i++) { Kriegslage.tick(g, 'messe'); if (Info.angebotFuer(g).themen.length >= 2) break; }
    g.inventory.marks = 500;
    await sitz('shop'); await sleep(800);
    await page.evaluate((bl) => { Funkwahl.lesen({ t: 'snap', phase: 'play', world: { funkwahl: bl } }); }, BLOCK);
    await taste('KeyW'); await messen('terminal-werft');
    await taste('KeyH'); await messen('terminal-handel');
    await taste('KeyI'); await messen('terminal-info');
    await taste('ArrowDown'); await taste('Enter'); await messen('terminal-info-gekauft');
    await taste('KeyK'); await messen('terminal-lage');
    await taste('KeyW');
  } finally { await b.close(); await srv.close(); }
  fs.mkdirSync(path.join(ROOT, 'tools', 'fixtures'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'tools', 'fixtures', 'funk-bedienflaechen.json'), JSON.stringify(out, null, 1));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
