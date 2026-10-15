// Sichtprüfung Pult-Baukasten: Steuer, Ops, Technik, Captain in beiden Skins (rom = Lerche, germanen), 2D-Modus.
// Bilder nach shots/pult. Nur Port 3453, ROOM_CODE=off, eigene Weltordner.
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3453');
const SHOTS = path.join(ROOT, arg('shots', 'shots/pult'));
const DIRS = { WORLD_DIR: 'data/worlds-pult', REGIE_DIR: 'data/regie-pult', ERZEUGT_DIR: 'data/erzeugt-pult' };
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ping() { return new Promise((res) => { const r = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 800 }, (x) => { x.resume(); res(x.statusCode === 200); }); r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); }); }); }

async function main() {
  if (await ping()) throw new Error('Port ' + PORT + ' belegt');
  for (const d of Object.values(DIRS)) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const env = Object.assign({}, process.env, { PORT: String(PORT), ROOM_CODE: 'off' }, DIRS);
  delete env.LLM_LIVE; delete env.SPIELLEITER_LLM;
  const srv = spawn(process.execPath, ['server/index.js', '--debug'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100 && !(await ping()); i++) await sleep(100);
  const b = await chromium.launch();
  const fehler = [];
  try {
    const page = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') fehler.push('console: ' + m.text().slice(0, 200)); });
    await page.goto(`http://127.0.0.1:${PORT}/?debug=1&render=2d`);
    await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
    await page.evaluate(() => __game.send({ t: 'lobbyOpt', startMission: 'free', skipDrill: true }));
    await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await page.mouse.move(5, 5);
    const sitz = (c) => page.evaluate((cc) => __game.send({ t: 'debug', cmd: 'sitz', console: cc }), c);
    const dbg = (args) => page.evaluate((a) => __game.send({ t: 'debug', cmd: a.split(' ')[0], args: a.split(' ').slice(1).join(' ') }), args);
    await sitz('helm'); await sleep(800);
    for (let i = 0; i < 3; i++) await page.evaluate(() => __game.send({ t: 'cmd', c: 'helm.throttle', delta: 1 }));
    await page.waitForFunction(() => { const s = __game.state.ship || {}; return !s.docked && !s.dockedAt; }, null, { timeout: 15000 }).catch(() => console.log('noch angedockt'));
    await sleep(3000);   // abgelegt (W), etwas Abstand zum Hafen
    for (const [kind, volk] of [['korvette', 'ger'], ['fregatte', 'ger'], ['kreuzer', 'pirat'], ['raider', 'ger'], ['raider', 'ger']]) await page.evaluate(([k, v]) => __game.send({ t: 'debug', cmd: 'spawn', kind: k, volk: v }), [kind, volk]);
    await sleep(2500);
    for (const skin of ['rom', 'germanen']) {
      await page.evaluate((s) => { try { localStorage.setItem('pantheon.pult', s); } catch (e) { /* egal */ } }, skin);
      for (const st of ['helm', 'weapons', 'technik', 'captain']) {
        await sitz(st); await sleep(900);
        if (st === 'weapons') { await page.keyboard.press('KeyT'); await sleep(300); }
        await page.screenshot({ path: path.join(SHOTS, skin + '-' + st + '.png') });
        console.log('Bild', skin + '-' + st);
      }
    }
    await page.evaluate(() => { try { localStorage.removeItem('pantheon.pult'); } catch (e) { /* egal */ } });
  } finally {
    await b.close(); srv.kill();
    if (fehler.length) console.log('Fehler:\n' + [...new Set(fehler)].slice(0, 15).join('\n'));
    const se = log.split('\n').filter((l) => /Error/.test(l)); if (se.length) console.log('Server:\n' + se.slice(0, 8).join('\n'));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
