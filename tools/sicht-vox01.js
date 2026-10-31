// VOX-01 Paket 5a: Sichtprüfung der Grabenkarte mit den Voxel-Modellen (echter Server im selben Prozess, echter Browser-Client, Playwright/Chromium,
// Voxel-Darstellung ?render=voxel). Lobby-Modus „Grabenangriff“, Spielerfigur per Debug `tp` an feste Stellen, Spielkamera folgt:
//   landung   Landefeld und Palisade
//   graben    Graben mit Brustwehr-Reihen und Grabensohle
//   wall      Wall mit Kante, Plateau-Rasen und Rampe (wallplateau: Figur auf dem Plateau)
//   wald      Wald mit Wegen
//   wald2     Wald, dichte Stelle
// Aufruf: node tools/sicht-vox01.js [--shots <Ordner>] [--port 3475] [--w 1280 --h 720] [--stellen graben,wall]   (Bilder nicht im Repo, Standard: Temp-Ordner)
// Gibt je Bild die Zählwerte des Kit-Renderers aus (Dreiecke, Chunks, Baum- und Kronenzahl, Platzhalter) und beendet den Server am Ende.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3475');
const SHOTS = arg('shots', path.join(os.tmpdir(), 'vox01-sicht'));
const W = +arg('w', '1280'), H = +arg('h', '720');
const STELLEN = {
  landung: [6, 18], graben: [22, 16], wall: [31, 14], wallplateau: [30, 11], wald: [52, 17], wald2: [46, 7], eingang: [76, 18],
};
const NUR = arg('stellen', null) ? arg('stellen', '').split(',') : Object.keys(STELLEN);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-vox01-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE setzen)'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await startServer({ port: PORT, debug: true, ruestphase: false, roomCode: 'off', quiet: true, worlds: true, worldDir: path.join(TMP, 'worlds') });
  const g = srv.game;
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const fehler = [];
  let code = 0;
  try {
    const page = await (await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
    page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') fehler.push(m.type() + ': ' + m.text().slice(0, 240)); });
    await page.goto(`http://127.0.0.1:${PORT}/?render=voxel&debug=1`);
    await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
    await page.evaluate(() => { __game.send({ t: 'lobbyOpt', startMission: 'arena_graben' }); __game.send({ t: 'ready', ready: true }); });
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    g.god = true;
    for (let i = 0; i < 120 && !(g.players[0] && g.players[0].zone === 'away'); i++) await sleep(250);
    const p = g.players[0];
    if (!p || p.zone !== 'away') throw new Error('Crew nicht unten (zone ' + (p && p.zone) + ')');
    await sleep(2500);   // Bau der Karte im Client
    await page.evaluate(() => { const d = document.getElementById('game'); if (d) d.style.visibility = 'hidden'; });
    for (const name of NUR) {
      const [x, y] = STELLEN[name];
      for (const e of g.away.drones) { e.x = 0; e.y = 0; }   // Gegner aus dem Bild
      await page.evaluate(([cx, cy]) => __game.dbg(`tp ${cx} ${cy}`), [x, y]);
      await sleep(2200);
      const info = await page.evaluate(() => { try { const s = VoxelKit.stats(); return { tris: s && s.tris, chunks: s && s.chunks, baeume: s && s.baeume, kronen: s && s.kronen, platzhalter: s && s.platzhalter, fehlend: s && s.fehlend, buildMs: s && s.buildMs, render: (() => { const i = VoxelRender.info(); return { calls: i.calls, tris: i.triangles, frameMs: i.frameMs, renderer: i.renderer }; })() }; } catch (e) { return String(e); } });
      const f = path.join(SHOTS, `${name}-${W}x${H}.png`);
      await page.screenshot({ path: f });
      console.log('Bild', f, JSON.stringify(info));
    }
  } catch (e) { console.error(e); code = 1; }
  console.log('Browser-Meldungen:', fehler.length ? '\n  ' + [...new Set(fehler)].slice(0, 20).join('\n  ') : 'keine');
  await b.close();
  if (srv.close) await srv.close(); else if (srv.server && srv.server.close) srv.server.close();
  process.exit(code);
}
main();
