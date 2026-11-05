#!/usr/bin/env node
// SCA-01 P4: Browser-Beleg der Scan-Anzeige. Zwei Clients: A am Boden (Kesh, Debug scantest/scanfertig), B als Captain im Reiter Außenteam (Taste 4).
//   node tools/sca01-p4-shots.js [--out <ordner>] [--port 3396] [--render 2d|voxel] [--vergleich <ordner-mit-Basisbild>]
// Bilder (Präfix <render>-): captain-a-ohne (Reiter ohne Ergebnis), captain-b-stufe1 (kein Positionsmarker), captain-c-stufe3 (Marker + Datenblatt mit Position),
// captain-d-viele (5+ Einträge, „+n weitere“), boden-a-stufe1 (kein Marker), boden-b-stufe3 (Marker am Boden), dazu ein Ausschnitt. --vergleich: Bild captain-a-ohne gegen ein
// Basisbild (z. B. vom Stand vor P4) Byte für Byte vergleichen. Prüft nebenbei, dass der Client keine Browserfehler wirft.
// Server im Prozess (--debug, eigene Datenordner). Voraussetzung: playwright-core (PLAYWRIGHT_CORE), für --render voxel public/voxel (npm run assets).
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; };
const PORT = +arg('port', '3396');
const RENDER = arg('render', '2d');
const OUT = path.resolve(ROOT, arg('out', 'shots/sca01-p4'));
const VERGLEICH = arg('vergleich', null);
const DIRS = { WORLD_DIR: 'data/worlds-shots', REGIE_DIR: 'data/regie-shots', ERZEUGT_DIR: 'data/erzeugt-shots' };
for (const d of Object.values(DIRS)) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
Object.assign(process.env, DIRS, { ROOM_CODE: 'off', MISSION_SOURCE: 'fallback' });
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
function playwright() {
  for (const k of [process.env.PLAYWRIGHT_CORE, 'playwright-core', 'C:/tmp/pw-test/node_modules/playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* nächster */ } }
  console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE).'); process.exit(2);
}
const { chromium } = playwright();
const { startServer } = require('../server/index.js');
const Scanbar = require('../server/sim/scanbar.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await startServer({ port: PORT, debug: true, roomCode: 'off', quiet: true });
  const game = srv.game;
  const b = await chromium.launch();
  const err = [];
  try {
    const neueSeite = async (render) => {
      const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
      page.on('pageerror', (e) => err.push('pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error') err.push('console: ' + m.text().slice(0, 200)); });
      await page.goto(`http://127.0.0.1:${PORT}/?render=${render}&debug=1`);
      await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000, polling: 20 });
      await page.waitForTimeout(1200);
      return page;
    };
    const A = await neueSeite(RENDER);   // Boden (zuerst: Spieler 0)
    const C = await neueSeite('2d');     // Captain
    for (const pg of [A, C]) { await pg.evaluate(() => __game.send({ t: 'lobbyOpt', skipDrill: true })); await pg.evaluate(() => __game.send({ t: 'ready', ready: true })); }
    await A.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await sleep(2500);
    const dbg = (pg, cmd, extra) => pg.evaluate(([c, x]) => __game.send(Object.assign({ t: 'debug', cmd: c }, x || {})), [cmd, extra]);
    await dbg(C, 'sitz', { console: 'captain' });
    await sleep(700);
    await dbg(A, 'kesh');
    await A.waitForFunction(() => { const st = __game.state, me = st && st.players.find((q) => q.id === __game.pid); return !!(me && me.zone === 'away' && st.away && st.away.map === 'kesh'); }, null, { timeout: 60000, polling: 40 });
    if (RENDER === 'voxel') {
      await A.waitForFunction(() => { const s = window.VoxelKit && VoxelKit.stats(); return !!(s && s.id === __game.state.away.map); }, null, { timeout: 30000, polling: 40 })
        .catch(async () => console.log('Voxel-Kit meldet die Karte nicht als aufgebaut:', await A.evaluate(() => JSON.stringify(window.VoxelKit && VoxelKit.stats()))));   // Einzelbilder trotzdem
      console.log('Renderer:', await A.evaluate(() => (window.Render && Render.modus) || (window.VoxelRender ? 'voxel-geladen' : '?')));
    }
    await sleep(1500);
    await dbg(A, 'god', { args: 'on' });
    await C.keyboard.press('Digit4');
    await sleep(800);
    const shot = async (pg, name, clip) => { const f = path.join(OUT, RENDER + '-' + name + '.png'); await pg.screenshot(Object.assign({ path: f }, clip ? { clip } : {})); console.log(f); return f; };
    const scState = (pg) => pg.evaluate(() => JSON.stringify((__game.state.away || {}).sc || null));
    const roh = async () => (await scState(C)).replace(/"[^"]*"/g, '');

    // a) ohne Ergebnis
    ok((await scState(C)) === 'null', 'ohne Scan: kein away.sc im Snapshot');
    const fa = await shot(C, 'captain-a-ohne');
    if (VERGLEICH) {
      // Byte-Gleichheit gibt es nicht (FPS-/Ping-Zeile, Kartenrauschen bei gestörtem Scan, zufälliger Crew-Name); deshalb Pixelvergleich im Browser außerhalb dieser dynamischen Zonen:
      // FPS-Zeile (y < 24), Karte (x >= 620, y <= 420) und Namenszeile der Crew (x < 290, y 360..385). Der Rest muss gleich sein – insbesondere Legende, Befehlsleiste, Schilde, Frachtleiste.
      const basis = path.join(path.resolve(ROOT, VERGLEICH), RENDER + '-captain-a-ohne.png');
      const rd = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
      const r = fs.existsSync(basis) ? await C.evaluate(async ([a, c]) => {
        const ld = (u) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = u; });
        const [x, y] = await Promise.all([ld(a), ld(c)]);
        const g = (i) => { const k = document.createElement('canvas'); k.width = i.width; k.height = i.height; const t = k.getContext('2d'); t.drawImage(i, 0, 0); return t.getImageData(0, 0, i.width, i.height); };
        const A = g(x), B = g(y); let rest = 0, maske = 0;
        for (let j = 0; j < A.height; j++) for (let i = 0; i < A.width; i++) {
          const k = (j * A.width + i) * 4;
          if (A.data[k] === B.data[k] && A.data[k + 1] === B.data[k + 1] && A.data[k + 2] === B.data[k + 2]) continue;
          if (j < 24 || (i >= 620 && j <= 420) || (i < 290 && j >= 360 && j <= 385)) maske++; else rest++;
        }
        return { w: A.width, h: A.height, rest, maske, gleich: A.width === B.width && A.height === B.height };
      }, [rd(basis), rd(fa)]) : null;
      console.log('Vergleich mit Basisbild:', JSON.stringify(r));
      ok(!!r && r.gleich && r.rest === 0, 'Reiter ohne Ergebnis: außerhalb der dynamischen Zonen pixelgleich zum Basisbild (' + basis + ')');
    }
    // b) Stufe 1: drei Ziele, keine Position
    await dbg(A, 'scantest');
    await dbg(A, 'scanfertig', { stufe: 1 });
    await C.waitForFunction(() => !!((__game.state.away || {}).sc), null, { timeout: 5000, polling: 40 });
    await sleep(500);
    ok(JSON.parse(await scState(C)).length === 3 && !/\d{3,}/.test(await roh()), 'Stufe 1: drei Einträge ohne Koordinaten im Snapshot');
    await shot(C, 'captain-b-stufe1');
    await shot(A, 'boden-a-stufe1');
    // c) Stufe 3: Positionen
    await dbg(A, 'scanfertig', { stufe: 3 });
    await sleep(700);
    ok(/\d{3,}/.test(await roh()), 'Stufe 3: Positionen im Snapshot');
    await shot(C, 'captain-c-stufe3');
    await shot(A, 'boden-b-stufe3');
    // d) 5+ Einträge: eine zweite Art (mit unbekanntem Typ) in Reichweite (Server im Prozess), erst Stufe 2, dann 3
    const p = game.players[0];
    const weg = Scanbar.scanbarAnmelden('erz', { ziele: () => [{ id: 'e1', typ: 'erzader', x: p.x + 60, y: p.y + 40 }, { id: 'e2', typ: 'erzader', x: p.x - 70, y: p.y - 20 }, { id: 'e3', typ: 'unbekannt_xyz', x: p.x + 20, y: p.y + 90 }] });
    await dbg(A, 'scanfertig', { stufe: 2 });
    await sleep(700);
    ok(JSON.parse(await scState(C)).length === 6, 'sechs Einträge im Snapshot');
    await shot(C, 'captain-d-viele');
    await dbg(A, 'scanfertig', { stufe: 3 });
    await sleep(700);
    await shot(C, 'captain-e-viele-stufe3');
    await shot(A, 'boden-c-sechs');
    weg();
    await shot(A, 'boden-d-ausschnitt', { x: 340, y: 160, width: 600, height: 400 });
  } finally {
    await b.close();
    if (srv.close) await srv.close();
  }
  console.log('Browserfehler:', err.length ? [...new Set(err)].slice(0, 10).join(' | ') : 'keine');
  ok(err.length === 0, 'keine Browserfehler');
  console.log(fails ? fails + ' FEHLER' : 'alles ok');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
