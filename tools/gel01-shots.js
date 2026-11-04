#!/usr/bin/env node
// GEL-01 D: Sichtbeleg der Kartenart wildnis je Biom (Bilder nach shots/gel01/, gitignored).
//   node tools/gel01-shots.js [--out shots/gel01] [--port 3395] [--seed 3] [--groesse klein] [--biome wueste,wiesenwald,vulkan] [--warte 1500]
// Startet einen frischen Server (eigene Datenordner, --debug) und je Biom eine Browser-Seite mit der Testgelände-URL
//   ?arena=away&art=wildnis&seed=<seed>&biom=<biom>&groesse=<groesse>&wellen=0   (prüft damit zugleich den Pfad Client -> Server -> Erzeuger),
// wartet auf den Voxel-Aufbau und macht je Biom: <biom>-spielnah (Ankunft), <biom>-uebersicht (ganze Karte von oben, Nebel aus), <biom>-nah (Nahansicht Boden/Bewuchs).
// Ausgabe: JSON-Zeile je Biom (Dreiecke, Bewuchs, Platzhalter, Stimmung, Konsolenfehler). Voraussetzung: playwright-core, public/voxel (npm run assets).
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; };
const PORT = +arg('port', '3395');
const OUT = path.resolve(ROOT, arg('out', 'shots/gel01'));
const SEED = arg('seed', '3');
const GROESSE = arg('groesse', 'klein');
const BIOME = arg('biome', 'wueste,wiesenwald,vulkan').split(',');
const WARTE = +arg('warte', '1500');
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
async function kamera(page, cx, cz, hoch, fov, uebersicht) {
  await page.evaluate(([x, z, h, v, ue]) => { const R = VoxelRender.renderer; if (ue) R.state().scene.fog = null; R.setSeat({ pos: [x, h, z + h * (ue ? 0.95 : 0.62)], look: [x, 0, z], fov: v }); }, [cx, cz, hoch, fov, !!uebersicht]);
}

async function biomLauf(b, biom, dirOut) {
  const err = [];
  const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => err.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') err.push('console: ' + m.text().slice(0, 200)); });
  const url = `http://127.0.0.1:${PORT}/?render=voxel&debug=1&arena=away&art=wildnis&seed=${SEED}&biom=${biom}&groesse=${GROESSE}&wellen=0`;
  await page.goto(url);
  await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000, polling: 20 });
  await page.waitForFunction(() => __game.state && __game.state.phase === 'lobby', null, { timeout: 30000, polling: 40 });
  await page.waitForTimeout(1500);   // der Client schickt lobbyOpt { arena } beim ersten Lobby-Snapshot
  await page.evaluate(() => __game.send({ t: 'lobbyOpt', skipDrill: true }));
  await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
  await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
  await page.waitForFunction(() => { const st = __game.state, me = st && st.players.find((p) => p.id === __game.pid); return !!(me && me.zone === 'away' && st.away && Shared_Maps[st.away.map] && Shared_Maps[st.away.map].buehne); }, null, { timeout: 60000, polling: 40 });
  await page.waitForFunction(() => { const s = window.VoxelKit && VoxelKit.stats(); return !!(s && s.id === __game.state.away.map); }, null, { timeout: 60000, polling: 40 });
  await page.waitForTimeout(1200);
  await page.addStyleTag({ content: '#game { visibility: hidden !important; }' }).catch(() => null);
  await page.evaluate(() => __game.dbg('god on'));
  const info = await page.evaluate(() => {
    const st = __game.state, m = Shared_Maps[st.away.map], S = VoxelKit.stats(), me = st.players.find((p) => p.id === __game.pid);
    return { id: st.away.map, art: m.art, w: m.w, h: m.h, boden: m.boden || (m.meta && m.meta.boden) || null, tris: S.tris, bewuchs: S.bewuchs, deko: S.deko, platzhalter: S.platzhalter, stimmung: S.stimmung, fehler: S.fehler,
      start: [Math.floor(me.x / 32), Math.floor(me.y / 32)], arena: st.arena || null };
  });
  fs.mkdirSync(dirOut, { recursive: true });
  const dateien = [];
  const shot = async (name) => { const f = path.join(dirOut, name + '.png'); await page.screenshot({ path: f }); dateien.push(path.relative(ROOT, f).split(path.sep).join('/')); };
  await page.waitForTimeout(WARTE);
  await shot(biom + '-spielnah');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(() => { if (window.Render) window.Render.teamVision = () => null; });   // Übersicht ohne Sichtnebel (sonst nur der Ausschnitt um die Figur in Farbe)
  await kamera(page, info.w / 2, info.h / 2, Math.max(info.w, info.h) * 0.5, 45, true);
  await page.waitForTimeout(WARTE + 1000);
  await shot(biom + '-uebersicht');
  // Nahansicht: Kartenmitte, flacher Blick auf Boden und Bewuchs
  await kamera(page, info.w * 0.55, info.h * 0.5, 9, 40, true);
  await page.waitForTimeout(WARTE);
  await shot(biom + '-nah');
  await page.close();
  return Object.assign(info, { bilder: dateien, konsolenfehler: err.length, fehlertexte: err.slice(0, 5) });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let rc = 0;
  for (const biom of BIOME) {   // je Biom ein frischer Server (die Testgelände-URL wirkt nur in der Lobby)
    const srv = await serverStart();
    const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    try { console.log(JSON.stringify(Object.assign({ biom }, await biomLauf(b, biom, OUT)))); }
    catch (e) { rc = 1; console.log(JSON.stringify({ biom, fehler: String(e.message || e).slice(0, 300) })); }
    finally { await b.close(); await serverStop(srv); }
  }
  process.exit(rc);
})();
