// Sichtprüfung SYS-03 E: HUD oben rechts im Schiffsinnern (Dev-Mock, Chromium). Szenen: ohne Sprungziel, mit Sprungzeile, mit Reaktorhinweis (überladen, offline),
// beides zusammen. Bilder nach --shots <Ordner> (Standard docs-sys03): hud-<szene>.png (Ausschnitt oben rechts, 3-fach) und hud-<szene>-voll.png.
// Aufruf: node tools/sicht-hud.js [--shots <Ordner>] [--port 3466]   Exit 1 bei Konsolen-/Seitenfehlern, 2 ohne Playwright.
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3466');
const SHOTS = path.resolve(ROOT, arg('shots', 'docs-sys03'));
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.log('Playwright fehlt'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ping() { return new Promise((res) => { const r = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 800 }, (x) => { x.resume(); res(x.statusCode === 200); }); r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); }); }); }

const SZENEN = [
  { id: '1-ohne-sprung', q: '', dest: null },
  { id: '2-sprungzeile', q: '', dest: 'splitter' },
  { id: '3-reaktor-ueberladen', q: '&reactor=overload', dest: null },
  { id: '4-sprung-und-reaktor', q: '&reactor=overload', dest: 'splitter' },
  { id: '5-reaktor-offline', q: '&reactor=offline', dest: 'splitter' },
];

async function main() {
  if (await ping()) throw new Error('Port ' + PORT + ' belegt');
  fs.mkdirSync(SHOTS, { recursive: true });
  const env = Object.assign({}, process.env, { PORT: String(PORT), ROOM_CODE: 'off' });
  const srv = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: 'ignore' });
  for (let i = 0; i < 100 && !(await ping()); i++) await sleep(100);
  const b = await chromium.launch();
  const fehler = [];
  try {
    const page = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') fehler.push('console: ' + m.text().slice(0, 240)); });
    for (const sz of SZENEN) {
      await page.goto(`http://127.0.0.1:${PORT}/?mock=1&render=2d&mockcrew=0&loc=hafen${sz.q}`);
      await page.waitForFunction(() => window.__game && __game.state && __game.state.phase === 'play', null, { timeout: 30000 });
      await sleep(600);
      if (sz.dest) { await page.evaluate((d) => __game.send({ t: 'cmd', c: 'captain.selectDest', dest: d }), sz.dest); await sleep(800); }
      await page.mouse.move(5, 5); await sleep(300);
      const info = await page.evaluate(() => ({ o2: 'o2' in (__game.state.ship || {}), jump: (__game.state.ship.jump || {}).dest, reaktor: (__game.state.ship.reactor || {}).state, zone: __game.state.players && 1 }));
      console.log(sz.id, JSON.stringify(info));
      const box = await page.evaluate(() => { const c = document.getElementById('game'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
      const k = box.w / 640;
      await page.screenshot({ path: path.join(SHOTS, `hud-${sz.id}.png`), clip: { x: box.x + box.w - 250 * k, y: box.y, width: 250 * k, height: 100 * k } });
      await page.screenshot({ path: path.join(SHOTS, `hud-${sz.id}-voll.png`), clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
    }
  } finally { await b.close(); srv.kill(); }
  if (fehler.length) { console.log('FEHLER:\n' + fehler.join('\n')); process.exit(1); }
  console.log('ok, Bilder in ' + SHOTS);
}
main().catch((e) => { console.log(e); process.exit(1); });
