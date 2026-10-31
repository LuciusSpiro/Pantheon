// VOX-01 Paket 5a: Sichtprüfung der Grabenkarte mit den Voxel-Modellen (echter Server im selben Prozess, echter Browser-Client, Playwright/Chromium,
// Voxel-Darstellung ?render=voxel). Lobby-Modus „Grabenangriff“, Spielerfigur per Debug `tp` an feste Stellen, Spielkamera folgt:
//   landung   Landefeld und Palisade
//   graben    Graben mit Brustwehr-Reihen und Grabensohle
//   wall      Wall mit Kante, Plateau-Rasen und Rampe (wallplateau: Figur auf dem Plateau)
//   wald      Wald mit Wegen
//   wald2     Wald, dichte Stelle
//   posten    (5c) Figur auf dem Wachposten-Plateau (Anker w1.posten.1, Aufbau mit Mast, Schirm, Standarte)
//   bunker    (5c) Figur vor dem Bunkereingang (Portal vor dem Mauerblock am Ziel)
//   krone-figur   (5b) eigene Figur unter dem Kronendach: Krone ausgeblendet, Figur sichtbar
//   krone-gegner  (5b) Gegner unter einer Krone, Spieler daneben: Gegner sichtbar
//   krone-leer    (5b) Wald ohne Figur darunter: Kronen da, Boden nicht düster (Spieler am Waldrand, Kronen im Bild)
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
  landung: [6, 18], graben: [22, 16], wall: [31, 14], wallplateau: [30, 11], wald: [52, 17], wald2: [46, 7], eingang: [76, 18], posten: [30, 11], posten2: [30, 24], bunker: [93, 17],
};
const KRONEN = ['krone-figur', 'krone-gegner', 'krone-leer'];
const NUR = arg('stellen', null) ? arg('stellen', '').split(',') : Object.keys(STELLEN).concat(KRONEN);
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
      let [x, y] = STELLEN[name] || [0, 0];
      let gegnerAn = null;
      if (KRONEN.includes(name)) {
        // Wald der Grabenkarte (x 40..60): Kachel ohne Baum, an der mindestens zwei Baum-Kacheln grenzen (darüber liegt Kronendach)
        const k = g.karteOf(g.away.map);
        const zch = (tx, ty) => (k.rows[ty] || '')[tx];
        const baum = (tx, ty) => zch(tx, ty) === 'Y';
        const frei = (tx, ty) => zch(tx, ty) === ':';
        const kand = [];
        for (let ty = 3; ty < 26; ty++) for (let tx = 42; tx < 60; tx++) {
          if (!frei(tx, ty) || !frei(tx, ty + 4)) continue;
          let nah = 0; for (let dy = 3; dy <= 5; dy++) for (let dx = -1; dx <= 1; dx++) if (baum(tx + dx, ty + dy)) nah++;
          if (nah) continue;   // Platz 3..5 Kacheln südlich ist baumfrei (für krone-gegner/-leer)
          let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (baum(tx + dx, ty + dy)) n++;
          if (n >= 3) kand.push({ tx, ty, n });
        }
        kand.sort((a, b) => b.n - a.n || a.ty - b.ty || a.tx - b.tx);
        if (!kand.length) throw new Error('keine Stelle unter Kronen gefunden');
        let c = kand[0];
        if (name === 'krone-gegner') {   // Gegner braucht freie Sicht: Kachel mit Baum daneben, drei freie Kacheln südlich (dort steht die Figur)
          const k2 = [];
          for (let ty = 3; ty < 30; ty++) for (let tx = 42; tx < 60; tx++) {
            if (!frei(tx, ty) || !frei(tx, ty + 1) || !frei(tx, ty + 2) || !frei(tx, ty + 3)) continue;
            let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (baum(tx + dx, ty + dy)) n++;
            if (n >= 2) k2.push({ tx, ty, n });
          }
          k2.sort((a, b) => b.n - a.n || a.ty - b.ty || a.tx - b.tx);
          if (k2.length) c = k2[0];
        }
        console.log('Stelle', name, JSON.stringify(c), 'Kandidaten', kand.length);
        if (name === 'krone-figur') { x = c.tx; y = c.ty; }
        else if (name === 'krone-gegner') { x = c.tx; y = c.ty + 4; gegnerAn = c; y = c.ty + 3; }
        else { x = c.tx; y = c.ty + 4; }   // am Waldrand: Kronen vor der Figur im Bild, keine Figur darunter
      }
      for (const e of g.away.drones) { e.x = 0; e.y = 0; }   // Gegner aus dem Bild
      await page.evaluate(([cx, cy]) => __game.dbg(`tp ${cx} ${cy}`), [x, y]);
      await sleep(2200);
      let pin = null;
      if (gegnerAn) {   // Debug 'gegner' stellt einen Gegner neben die Figur; er wird alle 50 ms unter die Krone gesetzt
        const vorher = g.away.drones.length;
        await page.evaluate(() => __game.dbg('gegner')); await sleep(400);
        const e = g.away.drones[g.away.drones.length - 1];
        if (!e || g.away.drones.length === vorher) throw new Error('Debug gegner erzeugte keinen Gegner');
        const pos = () => { e.x = (gegnerAn.tx + 0.5) * 32; e.y = (gegnerAn.ty + 0.5) * 32; e.hp = 9999; e.revealed = true; };
        pos(); pin = setInterval(pos, 50);
        await sleep(1200);
      }
      const info = await page.evaluate(() => { try { const s = VoxelKit.stats(); return { tris: s && s.tris, chunks: s && s.chunks, baeume: s && s.baeume, kronen: s && s.kronen, platzhalter: s && s.platzhalter, fehlend: s && s.fehlend, buildMs: s && s.buildMs, render: (() => { const i = VoxelRender.info(); return { calls: i.calls, tris: i.triangles, frameMs: i.frameMs, renderer: i.renderer }; })() }; } catch (e) { return String(e); } });
      const f = path.join(SHOTS, `${name}-${W}x${H}.png`);
      await page.screenshot({ path: f });
      if (pin) clearInterval(pin);
      if (process.argv.includes('--probe')) console.log('PROBE', JSON.stringify(await page.evaluate(() => { const a = (__game.state && __game.state.away) || {}; return { drones: (a.drones || []).map((d) => [d.id, Math.round(d.x / 32 * 10) / 10, Math.round(d.y / 32 * 10) / 10, d.alive]), me: (__game.state.players || []).map((p) => [p.x / 32, p.y / 32]) }; })));
      console.log('Bild', f, JSON.stringify(info));
    }
  } catch (e) { console.error(e); code = 1; }
  console.log('Browser-Meldungen:', fehler.length ? '\n  ' + [...new Set(fehler)].slice(0, 20).join('\n  ') : 'keine');
  await b.close();
  if (srv.close) await srv.close(); else if (srv.server && srv.server.close) srv.server.close();
  process.exit(code);
}
main();
