#!/usr/bin/env node
// Sichtprüfung der Client-Teile von SL6/SL7/SL10 im echten Browser (Playwright, headless Chromium), nur Port 3441, ROOM_CODE=off, eigene Weltordner.
//   node tools/sicht-t4.js [--port 3441] [--shots shots/t4]
// Bilder: Gasriese (Ops/Steuer, Verkaufen/Abwerfen), Gravimetrie (Ops-Scan, Feldkarte), Landepunkt-Scan und Planungstisch, Monster-Station
// (Außenteam + Captain-Karte mit Monster und Pult), Glyphenfeld (Ops, Captain), Boje-Anzeige (Technik). Steuerung über die Debug-Befehle
// karte / goto / sitz / sl (server/game.js). Kein Live-LLM.
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3441');
const SHOTS = path.join(ROOT, arg('shots', 'shots/t4'));
const DIRS = { WORLD_DIR: 'data/worlds-t4', REGIE_DIR: 'data/regie-t4', ERZEUGT_DIR: 'data/erzeugt-t4' };
function playwright() {
  const kand = [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'C:/tmp/pwtest/node_modules/playwright-core', 'playwright-core'].filter(Boolean);
  for (const k of kand) { try { return require(k); } catch (e) { /* nächster */ } }
  console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE setzen)'); process.exit(2);
}
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
    const mk = async (name) => {
      const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => fehler.push(name + ' pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error') fehler.push(name + ' console: ' + m.text().slice(0, 200)); });
      await page.goto(`http://127.0.0.1:${PORT}/?debug=1`);
      await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
      return page;
    };
    const A = await mk('A'); const B2 = await mk('B');
    await A.evaluate(() => __game.send({ t: 'lobbyOpt', startMission: 'free', skipDrill: true }));
    await A.evaluate(() => __game.send({ t: 'ready', ready: true }));
    await B2.evaluate(() => __game.send({ t: 'ready', ready: true }));
    await A.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    const dbg = (p, cmd, args) => p.evaluate(([c, a]) => __game.send({ t: 'debug', cmd: c, args: a || '' }), [cmd, args]);
    const cmd = (p, c, extra) => p.evaluate(([c2, e]) => __game.send(Object.assign({ t: 'cmd', c: c2 }, e || {})), [c, extra]);
    const shot = async (p, name) => { await sleep(500); await p.screenshot({ path: path.join(SHOTS, name + '.png') }); console.log('Bild', name); };
    const notices = (p) => p.evaluate(() => (window.__notices || []).slice(-3));
    void notices;

    // ---- Karte Sund, Gasfeld
    await dbg(A, 'karte', ''); await A.evaluate(() => __game.send({ t: 'debug', cmd: 'karte', args: 'sund', id: 'sund' }));
    await sleep(500);
    await A.evaluate(() => __game.send({ t: 'debug', cmd: 'goto', loc: 'gasfeld' }));
    await sleep(800);
    const pl = await A.evaluate(() => { const l = Shared_Locations.get('gasfeld'); return l && l.scene.planeten.find((p) => p.art === 'gasriese'); });
    console.log('Gasriese', JSON.stringify(pl));
    await dbg(A, 'sl', `pos ${Math.round(pl.x + pl.r * 1.3)} ${pl.y}`);
    await dbg(A, 'fracht', 'an deuterium');
    await dbg(A, 'sitz', ''); await A.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'weapons' }));
    await sleep(1500);
    await shot(A, 'gas-ops');
    await A.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'helm' }));
    await shot(A, 'gas-helm');
    await A.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'weapons' }));
    await A.evaluate(() => __game.send({ t: 'debug', cmd: 'goto', loc: 'concordia', docked: true }));
    await sleep(1200);
    await shot(A, 'concordia-ops-verkaufen');

    // ---- Gravimetrie (Helix)
    await A.evaluate(() => __game.send({ t: 'debug', cmd: 'goto', loc: 'helix' }));
    await sleep(800);
    await shot(A, 'helix-ops-vor-scan');
    await cmd(A, 'weapons.zonenscan'); await sleep(1500); await shot(A, 'helix-ops-scan-laeuft');
    await sleep(2500); await shot(A, 'helix-ops-gescannt');
    await A.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'helm' }));
    await shot(A, 'helix-helm-ohne-felder');
    await dbg(A, 'sl', 'schalten halt on'); await dbg(A, 'sl', 'karte');
    await A.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'weapons' }));
    await shot(A, 'helix-feldkarte-ops');
    await A.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'helm' }));
    await shot(A, 'helix-feldkarte-helm');

    // ---- Landepunkt-Scan und Planungstisch
    await A.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'weapons' }));
    await dbg(A, 'sl', 'pos 1900 1100');
    await sleep(800); await shot(A, 'lp-ops-bereit');
    await cmd(A, 'weapons.landescan'); await sleep(5200);
    await shot(A, 'lp-ops-gescannt');
    await A.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'plan' }));
    await sleep(800); await shot(A, 'lp-plan-stern');
    await A.keyboard.press('l'); await sleep(800); await shot(A, 'lp-plan-landekarte');

    // ---- Monster-Station: A unten, B am Captain
    await B2.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'captain' }));
    await A.evaluate(() => __game.send({ t: 'debug', cmd: 'sl', args: 'beam helix.station' }));
    await sleep(4000);
    await dbg(A, 'sl', 'monster 90 0 99'); await sleep(600); await shot(A, 'monster-sprite-nah');
    await B2.keyboard.press('4');   // Captain: Reiter Außenteam (Außenmissionskarte mit Monster und Pult)
    await shot(A, 'monster-aussen');
    await shot(B2, 'monster-captain');
    await sleep(8000); await shot(B2, 'monster-captain-spaeter'); await shot(A, 'monster-aussen-spaeter');
    await A.evaluate(() => __game.send({ t: 'cmd', c: 'transfer.up' }));

    // ---- Boje und Glyphen
    await A.evaluate(() => __game.send({ t: 'debug', cmd: 'goto', loc: 'bojenfeld' }));
    await sleep(1000);
    const bf = await A.evaluate(() => Shared_Locations.get('bojenfeld').scene.bojeFeld);
    await dbg(A, 'sl', `pos ${bf.x + 40} ${bf.y}`);
    await dbg(A, 'sl', 'glyphen boje');
    await A.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'weapons' }));
    await B2.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'captain' }));
    await sleep(1200);
    await shot(A, 'glyphen-ops'); await shot(B2, 'glyphen-captain');
    await A.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'technik' }));
    await dbg(A, 'sl', 'zaehler boje 37');
    await shot(A, 'boje-technik');
    await dbg(A, 'sl', 'energie');
    await sleep(600); await shot(A, 'boje-technik-energie');
    await A.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'helm' }));
    await shot(A, 'boje-helm');
    console.log(fehler.length ? 'Browser-Fehler:\n' + [...new Set(fehler)].slice(0, 20).join('\n') : 'keine Browser-Fehler');
  } finally {
    await b.close();
    srv.kill();
    await sleep(300);
    if (/Error|TypeError|ReferenceError/.test(log)) console.log('Server-Log (Auszug):\n' + log.split('\n').filter((l) => /Error|Fehler/.test(l)).slice(0, 10).join('\n'));
  }
}
main().catch((e) => { console.error(e.stack || e); process.exit(1); });
