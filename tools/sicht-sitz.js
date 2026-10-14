// UI-Sitz (Prototyp E2): Kamera-Test in der Voxel-Brücke. Setzt die Sitzkamera (VoxelRender.renderer.setSeat) an die Plätze
// von Steuer, Ops und Captain und fotografiert je Blickrichtung (vorn, pult, crew). Nur Port 3451, ROOM_CODE=off, eigene Weltordner.
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3451');
const SHOTS = path.join(ROOT, arg('shots', 'shots/sitz'));
const DIRS = { WORLD_DIR: 'data/worlds-sitz', REGIE_DIR: 'data/regie-sitz', ERZEUGT_DIR: 'data/erzeugt-sitz' };
function playwright() {
  const kand = [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'C:/tmp/pwtest/node_modules/playwright-core', 'playwright-core'].filter(Boolean);
  for (const k of kand) { try { return require(k); } catch (e) { /* nächster */ } }
  console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE setzen)'); process.exit(2);
}
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ping() { return new Promise((res) => { const r = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 800 }, (x) => { x.resume(); res(x.statusCode === 200); }); r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); }); }); }

// Sitzplätze in Metern (1 Kachel = 1 m, Kachelmitte = +0,5). Bug ist +x.
const SEATS = JSON.parse(arg('seats', 'null')) || {
  helm: { con: 'helm', eye: [32.35, 1.25, 6.5], views: { vorn: [[40, 1.15, 6.5], 62], pult: [[33.5, 0.55, 6.5], 55], crew: [[29, 0.9, 4.5], 62] } },
  ops: { con: 'weapons', eye: [29.35, 1.25, 3.5], views: { vorn: [[40, 1.15, 3.5], 62], pult: [[30.5, 0.55, 3.5], 55], crew: [[33, 0.9, 7], 62] } },
  captain: { con: 'captain', eye: [29.35, 1.3, 6.5], views: { vorn: [[40, 1.1, 6.5], 62], pult: [[30.5, 0.55, 6.5], 55], crew: [[30.5, 0.9, 3], 62] } },
};

async function main() {
  if (await ping()) throw new Error('Port ' + PORT + ' belegt');
  for (const d of Object.values(DIRS)) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const env = Object.assign({}, process.env, { PORT: String(PORT), ROOM_CODE: 'off' }, DIRS);
  delete env.LLM_LIVE; delete env.SPIELLEITER_LLM;
  const srv = spawn(process.execPath, ['server/index.js', '--debug'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100 && !(await ping()); i++) await sleep(100);
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const fehler = [];
  try {
    const mk = async (name) => {
      const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => fehler.push(name + ' pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error') fehler.push(name + ' console: ' + m.text().slice(0, 200)); });
      await page.goto(`http://127.0.0.1:${PORT}/?debug=1&render=voxel`);
      await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
      return page;
    };
    const A = await mk('A'); const B2 = await mk('B'); const C3 = await mk('C');
    await A.evaluate(() => __game.send({ t: 'lobbyOpt', startMission: 'free', skipDrill: true }));
    for (const p of [A, B2, C3]) await p.evaluate(() => __game.send({ t: 'ready', ready: true }));
    await A.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await A.waitForFunction(() => window.VoxelRender && VoxelRender.ready, null, { timeout: 30000 });
    const sitz = (p, con) => p.evaluate((c) => __game.send({ t: 'debug', cmd: 'sitz', console: c, hin: true }), con);
    // A sitzt wirklich an der Station (Sitz-Modus), B und C an den anderen beiden Plätzen
    const mitte = async () => { await A.mouse.move(640, 300); await sleep(150); };
    for (const [key, s] of Object.entries(SEATS)) {
      const others = Object.values(SEATS).filter((o) => o.con !== s.con).map((o) => o.con);
      await sitz(B2, others[0]); await sitz(C3, others[1]);
      await sitz(A, s.con); await sleep(500);
      await mitte(); await sleep(1500);
      await A.screenshot({ path: path.join(SHOTS, key + '-vorn.png') }); console.log('Bild', key + '-vorn', await A.evaluate(() => Sitz.blick));
      await A.mouse.move(2, 300); await sleep(1600);
      await A.screenshot({ path: path.join(SHOTS, key + '-crew.png') }); console.log('Bild', key + '-crew', await A.evaluate(() => Sitz.blick));
      await mitte(); await A.mouse.wheel(0, -100); await sleep(900);
      await A.mouse.wheel(0, 100); await sleep(1600);
      await A.screenshot({ path: path.join(SHOTS, key + '-pult.png') }); console.log('Bild', key + '-pult', await A.evaluate(() => Sitz.blick));
      await A.mouse.wheel(0, -100); await sleep(300);
      await A.screenshot({ path: path.join(SHOTS, key + '-zurueck.png') });
      await A.evaluate(() => __game.send({ t: 'leave' })); await sleep(400);
    }
    console.log('Voxel', JSON.stringify(await A.evaluate(() => { const i = VoxelRender.info(); return { fps: i.fps, zone: i.zone, deck: i.deck, errors: i.errors, layers: i.layers }; })));
  } finally {
    await b.close();
    srv.kill();
    if (fehler.length) console.log('Fehler:\n' + fehler.slice(0, 20).join('\n'));
    if (/Error|TypeError/.test(log)) console.log('Server-Log (Auszug):\n' + log.split('\n').filter((l) => /Error/.test(l)).slice(0, 10).join('\n'));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
