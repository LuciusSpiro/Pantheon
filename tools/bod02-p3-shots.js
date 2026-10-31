#!/usr/bin/env node
// BOD-02 P3: Browser-Prüfung der Rückmeldung beim Niederhalten (Vignette, Staub am Einschlag).
//   node tools/bod02-p3-shots.js [--out <ordner>] [--port 3391] [--render voxel|2d] [--fenster 4]
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
const PORT = +arg('port', '3392');
const RENDER = arg('render', 'voxel');
const FENSTER = +arg('fenster', '4');
const OUT = path.resolve(ROOT, arg('out', 'shots/bod02-p3'));
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
    let knapp = 0, letztes = null;
    page.on('websocket', (ws) => ws.on('framereceived', (f) => { const t = typeof f.payload === 'string' ? f.payload : f.payload.toString(); if (t.includes('"knapp"')) { knapp++; letztes = Date.now(); } }));
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
    await dbg('god on');
    await dbg('tune niederhalten.knapp 28');
    const shot = async (n) => { const f = path.join(OUT, RENDER + '-' + n + '.png'); await page.screenshot({ path: f }); console.log(f); };
    await dbg('gegner niederhalter');
    await dbg('gegner niederhalter');
    await sleep(4000);
    console.log(JSON.stringify(await page.evaluate(() => ({ me: (m => ({ x: m.x, y: m.y, sh: m.sh }))(__game.state.players.find((p) => p.id === __game.pid)), d: (__game.state.away.drones || []).map((d) => ({ id: d.id, x: d.x, y: d.y, ro: d.ro, wf: d.wf, vis: d.vis })) }))));
    let n = 0;
    for (let i = 0; i < 1500 && n < 3; i++) {
      if (letztes && Date.now() - letztes < 120) { letztes = null; await shot('knapp' + n); n++; await sleep(700); }
      await sleep(15);
    }
    console.log('Ereignisse knapp (Frames):', knapp, '| Bilder:', n, '| Konsolenfehler:', err.length); err.slice(0, 8).forEach((e) => console.log('  ' + e));
    if (!n) process.exitCode = 1;
  } finally { await b.close().catch(() => null); await serverStop(srv); }
})().catch((e) => { console.error(e); process.exit(1); });
