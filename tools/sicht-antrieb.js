// Sichtprüfung SUND-04a-1 A (gezielter Antriebstreffer, Verfolgung): Bilder des Ops-Pults im Browser
//   antrieb-1-gescannt.png   Zielkasten mit gescanntem Zielschiff: Zeile „Antrieb voll“ (Bernstein), Knopf „Systemziel“ in der SENSOREN-Spalte
//   antrieb-2-systemziel.png Systemziel gewählt: Knopf „Ziel: Antrieb“, Zeile mit „Systemziel“
//   antrieb-3-beschaedigt.png Antrieb beschädigt (Zielkasten und Karte: „ANTRIEB BESCHÄDIGT“)
//   antrieb-4-ausgefallen.png Antrieb ausgefallen
//   antrieb-karte.png        Taktikkarte mit Zielschiff, Sprungladung (Ring SPRUNG) und Fluchtpunkt
//   antrieb-pult.png         ganzes Ops-Pult im Zustand ausgefallen
// Dazu eine Liste der Konsolenfehler (Net.reportError, pageerror). Nur Port 3377 (Standard), ROOM_CODE=off, eigene Weltordner (data/*-antrieb, werden gelöscht). Aufruf:
//   node tools/sicht-antrieb.js [--out <ordner>] [--port 3377]
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3377');
const OUT = path.resolve(arg('out', path.join(require('os').tmpdir(), 'pantheon-sicht-antrieb')));
const DIRS = { WORLD_DIR: 'data/worlds-antrieb', REGIE_DIR: 'data/regie-antrieb', ERZEUGT_DIR: 'data/erzeugt-antrieb' };
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE setzen)'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ping() { return new Promise((res) => { const r = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 800 }, (x) => { x.resume(); res(x.statusCode === 200); }); r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); }); }); }

async function main() {
  if (await ping()) throw new Error('Port ' + PORT + ' belegt');
  for (const d of Object.values(DIRS)) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const env = Object.assign({}, process.env, { PORT: String(PORT), ROOM_CODE: 'off' }, DIRS);
  delete env.LLM_LIVE; delete env.SPIELLEITER_LLM;
  const srv = spawn(process.execPath, ['server/index.js', '--debug'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100 && !(await ping()); i++) await sleep(100);
  const b = await chromium.launch();
  const fehler = [];
  try {
    const page = await (await b.newContext({ viewport: { width: +arg("w", "1280"), height: +arg("h", "720") }, deviceScaleFactor: 2 })).newPage();
    page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') fehler.push('console: ' + m.text().slice(0, 200)); });
    await page.goto(`http://127.0.0.1:${PORT}/?debug=1&render=2d`);
    await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
    await page.evaluate(() => __game.send({ t: 'lobbyOpt', startMission: 'free', skipDrill: true }));
    await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await page.mouse.move(5, 5);
    const sitz = (c) => page.evaluate((cc) => __game.send({ t: 'debug', cmd: 'sitz', console: cc }), c);
    const dbg = (cmd, args) => page.evaluate(([c, a]) => __game.send({ t: 'debug', cmd: c, args: a || '' }), [cmd, args]);
    const cmd = (c, extra) => page.evaluate(([cc, ex]) => __game.send(Object.assign({ t: 'cmd', c: cc }, ex || {})), [c, extra]);
    const clip = async (x, y, w, h) => {
      const r = await page.evaluate(() => { const c = document.getElementById('game').getBoundingClientRect(); return { l: c.left, t: c.top, w: c.width, h: c.height }; });
      const sx = r.w / 640, sy = r.h / 360;
      return { x: Math.round(r.l + x * sx), y: Math.round(r.t + y * sy), width: Math.round(w * sx), height: Math.round(h * sy) };
    };
    // Fix3: Karte = Ops-Kartenfeld in Bruchteilen der Fensterbreite und -höhe (Pult-Layout skaliert gleichmäßig; 1280/1024/1920 geprüft)
    const kartenClip = async () => {
      const v = page.viewportSize();
      return { x: Math.round(v.width * 0.0975), y: Math.round(v.height * 0.0178), width: Math.round(v.width * 0.63), height: Math.round(v.height * 0.506) };
    };
    const shot = async (name, rect) => { await page.screenshot({ path: path.join(OUT, name), clip: rect ? (Array.isArray(rect) ? await clip(...rect) : rect) : undefined }); console.log('Bild', name); };

    // ---- ablegen, anhalten, unverwundbar, Verfolgung mit einer Fregatte
    await sitz('helm'); await sleep(600);
    for (let i = 0; i < 3; i++) await cmd('helm.throttle', { delta: 1 });
    await page.waitForFunction(() => { const s = __game.state.ship || {}; return !s.docked && !s.dockedAt; }, null, { timeout: 20000 }).catch(() => console.log('noch angedockt'));
    await sleep(2500);
    await cmd('helm.stop');
    await page.waitForFunction(() => { const s = __game.state.ship || {}; return (s.speed || 0) < 1.5; }, null, { timeout: 30000 }).catch(() => console.log('fährt noch'));
    await page.evaluate(() => __game.send({ t: 'debug', cmd: 'god', on: true }));
    await dbg('verfolgung', 'fregatte'); await sleep(900);
    const zid = await page.evaluate(() => { const l = (__game.state.space.enemies || []).slice(); return l.length ? l[0].id : null; });
    console.log('Zielschiff', zid);
    await sitz('weapons'); await sleep(500);
    await cmd('weapons.target', { id: zid }); await sleep(300);
    await page.evaluate(() => __game.send({ t: 'debug', cmd: 'scanall' })); await sleep(700);
    await page.evaluate(() => { Consoles.zoom.weapons = 0.35; });
    await page.mouse.move(5, 5); await sleep(300);
    await shot('antrieb-1-gescannt.png', [400, 6, 234, 200]);
    await cmd('weapons.systemziel', { id: 'antrieb' }); await sleep(500);
    await shot('antrieb-2-systemziel.png', [400, 6, 234, 200]);
    await dbg('zielsysteme', 'treffer 1'); await sleep(600);
    await shot('antrieb-3-beschaedigt.png', [400, 6, 234, 200]);
    await shot('antrieb-karte-beschaedigt.png', await kartenClip());
    await dbg('zielsysteme', 'treffer 1'); await sleep(600);
    await shot('antrieb-4-ausgefallen.png', [400, 6, 234, 200]);
    await shot('antrieb-karte.png', await kartenClip());
    await shot('antrieb-pult.png', null);
    // Steuer und Captain (Fix3; Lage = Reiter 2 mit GESCANNTE ZIELE): ganzer Bildschirm, damit Überlagerungen am Rand zu sehen sind
    await sitz('helm'); await sleep(600);
    await shot('steuer-ausgefallen.png', null);
    await sitz('captain'); await page.evaluate(() => { Consoles.tab = 2; }); await sleep(600);
    await shot('captain-lage.png', null);
    const s = await page.evaluate(() => { const e = (__game.state.space.enemies || [])[0] || {}; return { az: e.az, sj: e.sj, nm: e.nm, zs: (__game.state.ship || {}).zs, vf: (__game.state.space || {}).vf }; });
    console.log('Snapshot', JSON.stringify(s));
    const err = await page.evaluate(() => { const G = window.__game; return G && G.errorLog ? G.errorLog.map((e) => e.label + ': ' + e.msg) : []; });
    for (const e of err) fehler.push('Net.reportError ' + e);
  } finally {
    await b.close(); srv.kill();
    for (const d of Object.values(DIRS)) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
    if (fehler.length) console.log('Fehler:\n' + [...new Set(fehler)].slice(0, 25).join('\n')); else console.log('keine Konsolenfehler');
    const se = log.split('\n').filter((l) => /Error|clientError|Fehler in/.test(l)); if (se.length) console.log('Server:\n' + se.slice(0, 10).join('\n'));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
