#!/usr/bin/env node
// BOD-02 P2: Browser-Prüfung der Lanze als Laserkanone mit Zielfenster (Ziellinie, Bereit, Strahl, Gegner-Ziellinie).
//   node tools/bod02-p2-shots.js [--out <ordner>] [--port 3391] [--render voxel|2d] [--fenster 4]
// Startet einen frischen Server (eigene Datenordner, --debug) und einen headless Chromium, baut per Debug-Befehl `buehne` einen Außenposten,
// gibt der Figur die Lanze (`waffe lanze`, `god on`) und dehnt das Zielfenster per `tune` (--fenster = max in s, min = max/2), damit
// Screenshots zuverlässig in die Phasen fallen. Bilder: a-zielt (unter min), b-bereit, c-strahl*, d-gegner-linie.
// Voraussetzung: node_modules mit playwright-core (oder PLAYWRIGHT_CORE), public/voxel (npm run assets).
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; };
const PORT = +arg('port', '3391');
const RENDER = arg('render', 'voxel');
const FENSTER = +arg('fenster', '4');
const OUT = path.resolve(ROOT, arg('out', 'shots/bod02-p2'));
function playwright() {
  for (const k of [process.env.PLAYWRIGHT_CORE, 'playwright-core', 'C:/tmp/pw-test/node_modules/playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* nächster */ } }
  console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE).'); process.exit(2);
}
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DIRS = { WORLD_DIR: 'data/worlds-shots', REGIE_DIR: 'data/regie-shots', ERZEUGT_DIR: 'data/erzeugt-shots' };
const ping = () => new Promise((res) => { const r = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 800 }, (x) => { x.resume(); res(x.statusCode === 200); }); r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); }); });
async function serverStart() {
  if (await ping()) throw new Error('Port ' + PORT + ' ist belegt');
  for (const d of Object.values(DIRS)) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
  const env = Object.assign({}, process.env, { PORT: String(PORT), ROOM_CODE: 'off' }, DIRS);
  delete env.LLM_LIVE; delete env.SPIELLEITER_LLM;
  const p = spawn(process.execPath, ['server/index.js', '--debug'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 100; i++) { if (await ping()) return p; await sleep(100); }
  p.kill(); throw new Error('Server startet nicht');
}
async function serverStop(p) { if (!p || p.exitCode != null) return; p.kill(); for (let i = 0; i < 50 && p.exitCode == null; i++) await sleep(50); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serverStart();
  const b = await chromium.launch();
  const err = [];
  try {
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => err.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') err.push('console: ' + m.text().slice(0, 200)); });
    await page.goto(`http://127.0.0.1:${PORT}/?render=${RENDER}&debug=1`);
    await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000, polling: 20 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => __game.send({ t: 'lobbyOpt', skipDrill: true }));
    await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => __game.dbg('buehne aussenposten 1 - rostmeute intakt'));
    await page.waitForFunction(() => { const st = __game.state, me = st && st.players.find((p) => p.id === __game.pid); return !!(me && me.zone === 'away' && st.away && Shared_Maps[st.away.map] && Shared_Maps[st.away.map].buehne); }, null, { timeout: 60000, polling: 40 });
    if (RENDER === 'voxel') await page.waitForFunction(() => { const s = window.VoxelKit && VoxelKit.stats(); return !!(s && s.id === __game.state.away.map); }, null, { timeout: 60000, polling: 40 });
    await page.waitForTimeout(1500);
    const dbg = (l) => page.evaluate((x) => __game.dbg(x), l);
    await dbg('god on'); await dbg('waffe lanze');
    await dbg('tune waffen.lanze.zielfenster.max ' + FENSTER); await dbg('tune waffen.lanze.zielfenster.min ' + FENSTER / 2);
    await page.waitForTimeout(800);
    const shot = async (n) => { const f = path.join(OUT, RENDER + '-' + n + '.png'); await page.screenshot({ path: f }); console.log(f); };
    const me = () => page.evaluate(() => { const m = __game.state.players.find((p) => p.id === __game.pid); return { wf: m.wf, ch: m.ch, x: m.x, y: m.y, fa: m.fa }; });
    console.log('Figur', JSON.stringify(await me()));
    // (a)/(b)/(c): eigene Lanze, Zielen nach rechts
    await page.mouse.move(860, 230);
    await page.mouse.down();
    await page.waitForFunction(() => { const m = __game.state.players.find((p) => p.id === __game.pid); return m && m.ch > 10; }, null, { timeout: 5000, polling: 20 });
    await shot('a-zielt');
    await page.waitForFunction((lim) => { const m = __game.state.players.find((p) => p.id === __game.pid); return m && m.ch >= lim; }, 60, { timeout: 8000, polling: 20 });
    await shot('b-bereit');
    await page.mouse.up();
    await page.waitForFunction(() => { const m = __game.state.players.find((p) => p.id === __game.pid); return m && !(m.ch > 0); }, null, { timeout: 5000, polling: 10 });
    for (let i = 0; i < 4; i++) { await shot('c-strahl' + i); }
    await page.waitForTimeout(1200);
    // Auto-Schuss: Taste gehalten, kein neues Zielen
    await dbg('tune waffen.lanze.zielfenster.max 1'); await dbg('tune waffen.lanze.zielfenster.min 0.5'); await dbg('tune waffen.lanze.kalt 0.5'); await dbg('tune waffen.lanze.sperre 0.5');
    await page.waitForTimeout(500);
    await page.mouse.down(); await page.waitForTimeout(4500);
    const nachAuto = await me(); console.log('Nach Auto-Schuss, Taste weiter gehalten (4,5 s): ch =', nachAuto.ch);
    await page.mouse.up();
    await dbg('tune waffen.lanze.zielfenster.max ' + FENSTER); await dbg('tune waffen.lanze.zielfenster.min ' + FENSTER / 2);
    // (d): Gegner-Lanzenträger, Spielerin steht
    await page.waitForTimeout(500);
    await dbg('gegner schuetze');
    let gezeigt = false;
    for (let i = 0; i < 400 && !gezeigt; i++) {
      const r = await page.evaluate(() => (__game.state.away.drones || []).filter((d) => d.wf === 'lanze' && d.ch > 0).map((d) => ({ id: d.id, ch: d.ch, vis: d.vis, facing: d.facing })));
      if (r.length && r[0].ch >= 15) { await shot('d-gegner-linie'); console.log('Gegner', JSON.stringify(r)); gezeigt = true; }   // die KI schießt ab Fensterbeginn (ch 50): ready-Phase nur ein Tick
      await sleep(40);
    }
    console.log('Gegnerlinie gezeigt:', gezeigt, '| Konsolenfehler:', err.length); err.slice(0, 8).forEach((e) => console.log('  ' + e));
    if (!gezeigt) process.exitCode = 1;
  } finally { await b.close().catch(() => null); await serverStop(srv); }
})().catch((e) => { console.error(e); process.exit(1); });
