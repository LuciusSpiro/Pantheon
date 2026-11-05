#!/usr/bin/env node
'use strict';
// GEL-02 B: Browser-Probe der Kartenart hoehle (Vorbild tools/gel01-shots.js). Startet einen frischen Server, öffnet die Testgelände-URL
//   ?arena=away&art=hoehle&seed=<seed>&groesse=klein&wellen=0   (prüft damit Client -> Server -> Erzeuger -> Voxel-Aufbau),
// wartet auf den Aufbau und macht Bilder nach shots/gel02/ (gitignored): hoehle-spielnah, hoehle-uebersicht, hoehle-nah.
// Test: Exit 1 bei Konsolenfehlern, Aufbaufehlern, Platzhaltern oder falscher Stimmung. Ohne playwright-core oder public/voxel: SKIP (Exit 0).
//   node tools/test-hoehle-shot.js [--out shots/gel02] [--port 3396] [--seed 3] [--groesse klein] [--warte 1500]
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; };
const PORT = +arg('port', '3396');
const OUT = path.resolve(ROOT, arg('out', 'shots/gel02'));
const SEED = arg('seed', '3');
const GROESSE = arg('groesse', 'mittel');   // GEL-02 E1: mittel, damit Steine und Pfuetzen des echten Erzeugers dabei sind (klein hatte keine Kit-Fehler gezeigt)
const WARTE = +arg('warte', '1500');
function playwright() {
  for (const k of [process.env.PLAYWRIGHT_CORE, 'playwright-core', 'C:/tmp/pw-test/node_modules/playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* nächster */ } }
  return null;
}
const pw = playwright();
if (!pw || !fs.existsSync(path.join(ROOT, 'public', 'voxel', 'manifest.json'))) { console.log('SKIP (playwright-core oder public/voxel fehlt)'); process.exit(0); }
const { chromium } = pw;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DIRS = { WORLD_DIR: 'data/worlds-shots-h', REGIE_DIR: 'data/regie-shots-h', ERZEUGT_DIR: 'data/erzeugt-shots-h' };
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

async function lauf(b) {
  const err = [];
  const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => err.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /Fehler in Voxel|\[kit\]/.test(m.text()))) err.push(m.type() + ': ' + m.text().slice(0, 200)); });   // GEL-02 E1: Kit-Fehler kommen als console.warn (Loader)
  await page.goto(`http://127.0.0.1:${PORT}/?render=voxel&debug=1&arena=away&art=hoehle&seed=${SEED}&groesse=${GROESSE}&wellen=0`);
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
    return { id: st.away.map, art: m.art, w: m.w, h: m.h, tris: S.tris, bewuchs: S.bewuchs, deko: S.deko, platzhalter: S.platzhalter, stimmung: S.stimmung, fehler: S.fehler, start: [Math.floor(me.x / 32), Math.floor(me.y / 32)] };
  });
  fs.mkdirSync(OUT, { recursive: true });
  const dateien = [];
  const shot = async (name) => { const f = path.join(OUT, name + '.png'); await page.screenshot({ path: f }); dateien.push(path.relative(ROOT, f).split(path.sep).join('/')); };
  await page.waitForTimeout(WARTE);
  await shot('hoehle-spielnah');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(() => { if (window.Render) window.Render.teamVision = () => null; });   // Übersicht ohne Sichtnebel
  await kamera(page, info.w / 2, info.h / 2, Math.max(info.w, info.h) * 0.5, 45, true);
  await page.waitForTimeout(WARTE + 1000);
  await shot('hoehle-uebersicht');
  await kamera(page, info.w * 0.55, info.h * 0.5, 9, 40, true);
  await page.waitForTimeout(WARTE);
  await shot('hoehle-nah');
  await page.close();
  return Object.assign(info, { bilder: dateien, konsolenfehler: err.length, fehlertexte: err.slice(0, 5) });
}

(async () => {
  const srv = await serverStart();
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let rc = 0;
  try {
    const r = await lauf(b);
    console.log(JSON.stringify(r));
    const stimmungId = r.stimmung && (r.stimmung.id || r.stimmung);
    const fehler = [];
    if (r.art !== 'hoehle') fehler.push('art ' + r.art);
    if (r.konsolenfehler) fehler.push(r.konsolenfehler + ' Konsolenfehler');
    if (r.fehler && (Array.isArray(r.fehler) ? r.fehler.length : r.fehler)) fehler.push('Aufbaufehler ' + JSON.stringify(r.fehler));
    if (r.platzhalter && (Array.isArray(r.platzhalter) ? r.platzhalter.length : 0)) fehler.push('Platzhalter ' + JSON.stringify(r.platzhalter));
    if (stimmungId !== 'hoehle') fehler.push('Stimmung ' + JSON.stringify(r.stimmung));
    if (!(r.tris > 0)) fehler.push('keine Dreiecke');
    if (fehler.length) { rc = 1; console.log('FEHLER ' + fehler.join('; ')); } else console.log('TEST-HOEHLE-SHOT OK');
  } catch (e) { rc = 1; console.log('FEHLER ' + String(e.message || e).slice(0, 300)); }
  finally { await b.close(); await serverStop(srv); }
  process.exit(rc);
})();
