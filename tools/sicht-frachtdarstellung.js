// LAD-01 F2: Sichtbeleg Frachtraum (echter Server im selben Prozess, ein echter Browser-Client, Playwright/Chromium).
// Bilder: Voxel und 2D, je mit mehreren Waren (Typ-Regel: ein Modul = eine Art, vier Plätze) und mit Personen.
// Aufruf: node tools/sicht-frachtdarstellung.js [--shots shots/frachtdarstellung] [--port 3561] [--w 1280 --h 720]   (Bilder nicht im Repo, shots/ ist ignoriert)
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3561');
const SHOTS = path.resolve(arg('shots', path.join('shots', 'frachtdarstellung')));
const W = +arg('w', '1280'), H = +arg('h', '720');
fs.mkdirSync(SHOTS, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-fracht-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
const Fracht = require('../server/sim/fracht.js');
const Maps = require('../shared/maps.js');
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } throw new Error('playwright-core nicht gefunden (PLAYWRIGHT_CORE setzen)'); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(a.join(' '));
const KARTE = { v: 1, name: 'Hrolf', koerper: 'standard', frisur: 'bartlang', haut: 3, haar: 2, outfit: { kopf: 'keine', oberteil: 'bordtunika', hose: 'bordhose', schuhe: 'bordstiefel', haende: 'keine', umhang: 'keiner' } };
const fehler = [];
let ausfall = 0;

async function warteBis(fn, ms, text) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150); } throw new Error('Zeit überschritten: ' + text); }
async function geladen(page) {
  const t0 = Date.now(); let ruhig = 0;
  while (Date.now() - t0 < 240000) {
    const r = await page.evaluate(() => { const l = window.VoxelRender && VoxelRender.info().loader; return !!l && l.loading === 0 && l.builds > 0; }).catch(() => false);
    ruhig = r ? ruhig + 1 : 0;
    if (ruhig >= 4) return true;
    await sleep(700);
  }
  log('WARNUNG: nicht fertig geladen');
  return false;
}
async function bild(page, name) { const f = path.join(SHOTS, name + '.png'); await page.screenshot({ path: f, timeout: 120000 }); log('Bild ' + path.relative(ROOT, f).replace(/\\/g, '/')); }

async function lauf(browser, render, port) {
  const srv = await startServer({ port, debug: true, ruestphase: false, roomCode: 'off', quiet: true, worlds: true, worldDir: path.join(TMP, 'welten-' + render) });
  const g = srv.game;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await ctx.addInitScript((s) => { try { localStorage.setItem('pantheon.charaktere', s); } catch (e) { /* egal */ } }, JSON.stringify({ v: 1, gewaehlt: 'c1', liste: [{ id: 'c1', karte: KARTE }] }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fehler.push(render + ' pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') fehler.push(render + ' error: ' + m.text().slice(0, 240)); });
  await page.goto(`http://127.0.0.1:${port}/?render=${render}&debug=1`);
  await page.waitForFunction(() => window.__game && __game.send && __game.state && window.Charaktere && Charaktere.lies().bereit, null, { timeout: 60000 });
  await warteBis(() => g.players.length === 1 && g.players[0].karte, 20000, 'Karte am Server');
  await page.evaluate(() => __game.send({ t: 'lobbyOpt', startMission: 'freie_fahrt' }));
  await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
  await warteBis(() => g.phase === 'play', 30000, 'Runde läuft');
  g.god = true;
  // vier Frachträume (Räume 3 und 4 öffnen erst mit dem Ausbau)
  require('../server/sim/ausbau.js').debug(g, ['3']);
  g.ship.module = [1, 2, 3, 4].map((raum) => ({ id: 'frachtraum', raum, an: true, lauf: true }));
  return { srv, g, ctx, page };
}
function stelle(g, lager, pers) {
  Fracht.debug(g, ['leer']);
  for (const a of lager) { const r = Fracht.debug(g, ['an', a]); if (r) { log('  fracht an ' + a + ': ' + r); ausfall++; } }
  for (let i = 0; i < pers; i++) { const r = Fracht.debug(g, ['person', 'p' + i, 'Gast ' + i]); if (r) { log('  fracht person: ' + r); ausfall++; } }
}
const setze = (p, tx, ty) => { p.zone = 'ship'; p.x = tx * 32 + 16; p.y = ty * 32 + 16; p.dir = 'up'; p.console = null; p.input.mx = 0; p.input.my = 0; };

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let port = PORT;
  try {
    for (const render of ['voxel', '2d']) {
      log('\n== ' + render + ' ==');
      const { srv, g, ctx, page } = await lauf(browser, render, port++);
      try {
        const p = g.players[0];
        const raum1 = Maps.CARGO_PLAETZE.filter((q) => q.raum === 1);
        const mx = Math.round(raum1.reduce((s, q) => s + q.x, 0) / raum1.length), my = raum1[0].y + 1;   // freie Mittelreihe des ersten Frachtraums
        // Warenbild 1: Raum 1 Erz 3 (75 %), Raum 2 Waffen 1 (25 %), Raum 3 Hilfsgüter 4 (100 %), Raum 4 Deuterium 2 (50 %)
        stelle(g, ['erz', 'erz', 'erz', 'waffen', 'hilfsgueter', 'hilfsgueter', 'hilfsgueter', 'hilfsgueter', 'deuterium', 'deuterium'], 0);
        setze(p, mx, my);
        await sleep(2500); if (render === 'voxel') await geladen(page);
        await sleep(1500);
        await bild(page, render + '-waren-1-erz-waffen');
        stelle(g, ['bergungsgut', 'bergungsgut', 'sprengstoff', 'sprengstoff', 'sprengstoff', 'sprengstoff', 'fracht'], 0);
        await sleep(2500); if (render === 'voxel') await geladen(page);
        await bild(page, render + '-waren-2-schrott-sprengstoff-fracht');
        stelle(g, [], 3);
        await sleep(2500); if (render === 'voxel') await geladen(page);
        await bild(page, render + '-personen-3');
      } finally { await ctx.close().catch(() => null); if (srv.stop) await srv.stop(); else if (srv.close) await srv.close(); }
    }
  } finally { await browser.close().catch(() => null); }
  if (fehler.length) { log('\nKonsolenfehler:'); for (const f of fehler.slice(0, 20)) log('  ' + f); }
  log(ausfall ? 'AUSFÄLLE ' + ausfall : 'ok');
  process.exit(ausfall ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
