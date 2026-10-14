#!/usr/bin/env node
// Sichtprüfung U2 (Gasriese: Zug, Schaden, Schöpfen als Ops-Aktion) im echten Browser (Playwright, headless Chromium), nur Port 3492, ROOM_CODE=off,
// WORLD_DIR=data/worlds-u2. Bilder nach shots/u2/. Steuerung über die Debug-Befehle (server/game.js): karte / goto / sitz / sl pos / god / hull.
//   node tools/sicht-u2.js [--port 3492] [--shots shots/u2]
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3492');
const SHOTS = path.join(ROOT, arg('shots', 'shots/u2'));
const DIRS = { WORLD_DIR: 'data/worlds-u2', REGIE_DIR: 'data/regie-u2', ERZEUGT_DIR: 'data/erzeugt-u2' };
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
    const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
    const A = await ctx.newPage();
    A.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
    A.on('console', (m) => { if (m.type() === 'error') fehler.push('console: ' + m.text().slice(0, 200)); });
    await A.goto(`http://127.0.0.1:${PORT}/?debug=1`);
    await A.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
    await A.evaluate(() => __game.send({ t: 'lobbyOpt', startMission: 'free', skipDrill: true }));
    await A.evaluate(() => __game.send({ t: 'ready', ready: true }));
    await A.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    const dbg = (cmd, args, extra) => A.evaluate(([c, a, e]) => __game.send(Object.assign({ t: 'debug', cmd: c, args: a || '' }, e || {})), [cmd, args, extra]);
    const cmd = (c, extra) => A.evaluate(([c2, e]) => __game.send(Object.assign({ t: 'cmd', c: c2 }, e || {})), [c, extra]);
    const sitz = (k) => A.evaluate((c) => __game.send({ t: 'debug', cmd: 'sitz', console: c }), k);
    const shot = async (name) => { await sleep(400); await A.screenshot({ path: path.join(SHOTS, name + '.png') }); console.log('Bild', name); };
    const ship = () => A.evaluate(() => { const s = __game.state.ship; return { x: Math.round(s.x), y: Math.round(s.y), hull: Math.round(s.hull), p: s.power && s.power.engines, f: __game.state.fracht && JSON.stringify(__game.state.fracht) }; });
    // das Schiff in der Schicht festhalten (der Antrieb der Navigation hält die Höhe): Position alle 120 ms neu setzen
    const halt = async (sek, x, y) => { for (let t = 0; t < sek * 1000; t += 120) { await dbg('sl', `pos ${x} ${y}`); await sleep(120); } };
    await dbg('god', '', { on: false });
    await A.evaluate(() => __game.send({ t: 'debug', cmd: 'karte', args: 'sund', id: 'sund' }));
    await sleep(500);
    await A.evaluate(() => __game.send({ t: 'debug', cmd: 'goto', loc: 'gasfeld' }));
    await sleep(900);
    const pl = await A.evaluate(() => Shared_Locations.get('gasfeld').scene.planeten.find((p) => p.art === 'gasriese'));
    const sz = await A.evaluate(() => { const s = Shared_Locations.get('gasfeld').scene; return { w: s.w, h: s.h, zonen: s.zonen.length }; });
    console.log('Gasriese', JSON.stringify(pl), JSON.stringify(sz));
    // 1) Anflug: außerhalb der Atmosphäre, Ops-Karte gezoomt
    await dbg('sl', `pos ${Math.round(pl.x - pl.r * 2.3)} ${Math.round(pl.y + pl.r * 0.9)}`);
    await sitz('weapons'); await sleep(1000);
    await A.keyboard.press('Minus'); await A.keyboard.press('Minus');
    await shot('01-anflug-ops'); console.log(JSON.stringify(await ship()));
    await sitz('helm'); await shot('02-anflug-helm');
    // 2) Hochatmosphäre / Wolkendecke: Zug 10 / 30 sichtbar im Helm, Karte erkundet sich
    await halt(1.5, Math.round(pl.x + pl.r * 1.25), pl.y);
    await sitz('weapons'); await shot('03-wolkendecke-ops'); await sitz('helm'); await shot('04-wolkendecke-helm');
    // 3) Förderschicht: Schöpfen-Knopf (Ops), Höhe halten (Navigation); ohne Aktion füllt sich nichts
    const fx = Math.round(pl.x + pl.r * 0.82);
    await halt(1.2, fx, pl.y);
    await sitz('weapons'); await halt(4, fx, pl.y); await shot('05-foerderschicht-ops-bereit'); console.log('ohne Aktion', await ship());
    await A.keyboard.press('KeyC'); await halt(6, fx, pl.y); await shot('06-schoepfen-laeuft'); console.log('schöpft', await ship());
    await sitz('helm'); await sleep(300); await sitz('weapons'); await halt(1.2, fx, pl.y);   // (Station wechseln bricht ab: Ops muss besetzt bleiben)
    await shot('07-nach-wechsel');
    await A.keyboard.press('KeyC'); await halt(0.6, fx, pl.y);
    await halt(6, fx, pl.y); await shot('08-schoepfen-weiter'); console.log(JSON.stringify(await ship()));
    await sitz('helm'); await shot('09-foerderschicht-helm');
    // 4) Tiefe und Kern (Schaden), Hinauswurf
    await dbg('hull', '', { n: 100 });
    const tx = Math.round(pl.x + pl.r * 0.45);
    await halt(1.5, tx, pl.y); await sitz('weapons'); await shot('10-tiefe-ops'); await sitz('helm'); await shot('11-tiefe-helm');
    for (let i = 0; i < 5 && (await ship()).x > 0; i++) { await halt(1.5, tx, pl.y); const s = await ship(); console.log('Tiefe', JSON.stringify(s)); if (s.hull < 30) break; }
    await shot('12-tiefe-schaden');
    const kx = Math.round(pl.x + pl.r * 0.15);
    await dbg('hull', '', { n: 100 });
    await halt(2.0, kx, pl.y); await shot('13-kern'); console.log('Kern', JSON.stringify(await ship()));
    await sleep(1500); await shot('14-nach-notfall'); console.log('nach Notfall', JSON.stringify(await ship()));
    // 5) Verkauf in Concordia
    await dbg('fracht', 'an deuterium');
    await A.evaluate(() => __game.send({ t: 'debug', cmd: 'goto', loc: 'concordia', docked: true }));
    await sleep(1200); await sitz('weapons'); await shot('15-concordia-ops'); await cmd('weapons.verkaufen'); await sleep(1200); await shot('16-verkauf-laeuft');
    await sleep(3000); await shot('17-verkauft'); console.log(JSON.stringify(await ship()));
    console.log(fehler.length ? 'Browser-Fehler:\n' + [...new Set(fehler)].slice(0, 20).join('\n') : 'keine Browser-Fehler');
  } finally { await b.close(); srv.kill(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
