// Sichtprüfung SYS-03 C1: Schild-Mini im HUD oben rechts (Dev-Mock, Chromium) bei Pool 8, gültige Zustände (Summe der Punkte <= Pool, je Sektor <= Kappe).
// Reihenfolge der Zahlen im Dateinamen: Bug-Steuerbord-Heck-Backbord (wie shields.current). Dateiname = Inhalt. Bilder nach --shots <Ordner> (Standard docs-sys03/c1-hud),
// 6-fach vergrößert. Aufruf: node tools/sicht-hud-mini.js [--shots <Ordner>] [--port 3467]   Exit 1 bei Konsolen-/Seitenfehlern oder ungültigem Zustand, 2 ohne Playwright.
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3467');
const SHOTS = path.resolve(ROOT, arg('shots', 'docs-sys03/c1-hud'));
const CONFIG = require('../shared/config.js');
const POOL = 8, KAPPE = CONFIG.shields.maxPerSector;
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.log('playwright-core fehlt'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ping() { return new Promise((res) => { const r = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 800 }, (x) => { x.resume(); res(x.statusCode === 200); }); r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); }); }); }

// cap: erwartete Obergrenze je Sektor; der Mock leitet sie aus dem Emitter-Zustand ab (beschädigter Bug-Emitter = Kappe/2), sie wird nicht von Hand gesetzt
const ZUSTAENDE = [
  { name: 'mini-4-2-0-2', current: [4, 2, 0, 2], cap: [KAPPE, KAPPE, KAPPE, KAPPE] },
  { name: 'mini-8-0-0-0', current: [8, 0, 0, 0], cap: [KAPPE, KAPPE, KAPPE, KAPPE] },
  { name: 'mini-3-1-0-1-bug-emitter-halb', current: [3, 1, 0, 1], cap: [KAPPE / 2, KAPPE, KAPPE, KAPPE], emitterBug: 'damaged' },
  { name: 'mini-4-2-0-2-bug-emitter-halb', current: [4, 2, 0, 2], cap: [KAPPE / 2, KAPPE, KAPPE, KAPPE], emitterBug: 'damaged' },
];
for (const z of ZUSTAENDE) {
  const summe = z.current.reduce((a, b) => a + b, 0);
  if (summe > POOL || z.current.some((v, i) => v > z.cap[i] || v < 0)) { console.log('ungültiger Zustand ' + z.name); process.exit(1); }
}

async function main() {
  if (await ping()) throw new Error('Port ' + PORT + ' belegt');
  fs.mkdirSync(SHOTS, { recursive: true });
  const env = Object.assign({}, process.env, { PORT: String(PORT), ROOM_CODE: 'off' });
  const srv = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: 'ignore' });
  for (let i = 0; i < 100 && !(await ping()); i++) await sleep(100);
  const b = await chromium.launch();
  const fehler = [];
  try {
    const page = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 3 })).newPage();
    page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') fehler.push('console: ' + m.text().slice(0, 240)); });
    await page.goto(`http://127.0.0.1:${PORT}/?mock=1&render=2d&mockcrew=0&loc=hafen`);
    await page.waitForFunction(() => window.__game && __game.state && __game.state.phase === 'play', null, { timeout: 30000 });
    await sleep(600);
    await page.mouse.move(5, 5);
    for (const z of ZUSTAENDE) {
      // Zustand im Mock-Welt-Objekt festhalten (der Mock regeneriert sonst), danach zeichnen lassen
      await page.evaluate((zz) => {
        const sh = DevMock.world().ship.shields; const sys = DevMock.world().ship.systems;
        const setze = () => { sys.emitter_bow = zz.emitterBug || 'ok'; sh.pool = 8; sh.alloc = zz.current.slice(); sh.current = zz.current.slice(); };
        window.__miniHalten && clearInterval(window.__miniHalten);
        setze(); window.__miniHalten = setInterval(setze, 30);
      }, z);
      await sleep(500);
      const box = await page.evaluate(() => { const c = document.getElementById('game'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
      const k = box.w / 640;
      const cur = await page.evaluate(() => __game.state.ship.shields.current);
      const cap = await page.evaluate(() => __game.state.ship.shields.cap);
      if (JSON.stringify(cur) !== JSON.stringify(z.current) || JSON.stringify(cap) !== JSON.stringify(z.cap)) fehler.push(`${z.name}: Client zeigt ${JSON.stringify(cur)} / Kappe ${JSON.stringify(cap)}`);
      await page.screenshot({ path: path.join(SHOTS, z.name + '.png'), clip: { x: box.x + 590 * k, y: box.y + 2 * k, width: 50 * k, height: 28 * k } });
      console.log(z.name, JSON.stringify(cur), 'Kappe', JSON.stringify(cap));
    }
  } finally { await b.close(); srv.kill(); }
  if (fehler.length) { console.log('FEHLER:\n' + fehler.join('\n')); process.exit(1); }
  console.log('ok, Bilder in ' + SHOTS);
}
main().catch((e) => { console.log(e); process.exit(1); });
