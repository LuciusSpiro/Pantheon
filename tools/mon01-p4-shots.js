#!/usr/bin/env node
// MON-01 P4: Browser-Beleg der Kreaturen-Anzeige. Zwei Clients: A am Boden (Kesh, Debug kreatur/scanfertig), B als Captain im Reiter Außenteam (Taste 4).
//   node tools/mon01-p4-shots.js [--out <ordner>] [--port 3397] [--render 2d|voxel]
// Bilder (Präfix <render>-): boden-a-ohne-scan (Kreatur neutral "?"), boden-b-stufe1 (Name aus dem Scan), boden-c-stufe3 (Name, Marker), boden-d-ladung0..3, boden-e-rammt, boden-f-pause,
// captain-a-stufe1 (Datenblatt mit Regelhinweis ohne Position), captain-b-stufe3 (mit Position und Marker), captain-c-karte (Kreatur auf der Kommandokarte).
// Server im Prozess (--debug, eigene Datenordner im Temp-Verzeichnis). Die Kreatur wird für die Bilder auf ihrer Stelle festgehalten (Position und Blick), damit sie im Bild bleibt.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.join(__dirname, '..');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; };
const PORT = +arg('port', '3397');
const RENDER = arg('render', '2d');
const OUT = path.resolve(ROOT, arg('out', 'shots/mon01-p4'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mon01-p4-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
Object.assign(process.env, { WORLD_DIR: path.join(TMP, 'worlds'), REGIE_DIR: path.join(TMP, 'regie'), ERZEUGT_DIR: path.join(TMP, 'erzeugt'), ROOM_CODE: 'off', MISSION_SOURCE: 'fallback' });
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
function playwright() {
  for (const k of [process.env.PLAYWRIGHT_CORE, 'playwright-core', 'C:/tmp/pw-test/node_modules/playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* nächster */ } }
  console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE).'); process.exit(2);
}
const { chromium } = playwright();
const { startServer } = require('../server/index.js');
const Kreatur = require('../server/sim/kreatur.js');
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
    const A = await neueSeite(RENDER);
    const C = await neueSeite('2d');
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
        .catch(async () => console.log('Voxel-Kit meldet die Karte nicht als aufgebaut:', await A.evaluate(() => JSON.stringify(window.VoxelKit && VoxelKit.stats()))));
    }
    await sleep(1500);
    await dbg(A, 'god', { args: 'on' });
    await C.keyboard.press('Digit4');
    await sleep(800);
    const shot = async (pg, name, clip) => { const f = path.join(OUT, RENDER + '-' + name + '.png'); await pg.screenshot(Object.assign({ path: f }, clip ? { clip } : {})); console.log(f); return f; };
    const krSnap = (pg) => pg.evaluate(() => JSON.stringify((__game.state.away || {}).kr || null));
    const scSnap = (pg) => pg.evaluate(() => JSON.stringify((__game.state.away || {}).sc || null));

    // Kreatur anlegen und festhalten (Position und Blick), damit sie im Bild bleibt
    await dbg(A, 'kreatur', { typ: 'probe' });
    await sleep(400);
    const K = game.away.kreaturen[0];
    ok(!!K, 'Kreatur K1 angelegt');
    const fx = K.x, fy = K.y;
    const p = game.players[0];
    const halten = setInterval(() => { K.x = fx; K.y = fy; K.facing = Math.atan2(p.y - fy, p.x - fx); }, 20);
    const zustand = (zu, lad) => { Kreatur.zustandSetzen(game, K, zu); K.aufladung = lad ? { stufe: lad, ruhe: 0, zerfallT: 0 } : null; };
    try {
      zustand('patrouille', 0);
      await sleep(900);
      const kr0 = JSON.parse(await krSnap(A));
      ok(Array.isArray(kr0) && kr0.length === 1 && kr0[0][0] === 1, 'Client-Snapshot trägt away.kr mit K1: ' + JSON.stringify(kr0));
      const drohnen = await A.evaluate(() => 'ok');
      ok(drohnen === 'ok', 'Client lebt');
      ok((await scSnap(A)) === 'null', 'ohne Scan: kein away.sc');
      await shot(A, 'boden-a-ohne-scan');
      await shot(C, 'captain-c-karte-ohne-scan');

      await dbg(A, 'scanfertig', { stufe: 1 });
      await sleep(800);
      const sc1 = JSON.parse(await scSnap(A));
      ok(sc1 && sc1.length === 1 && sc1[0].length === 4 && sc1[0][1] === 'monster' && sc1[0][2] === 'probe', 'Stufe 1: away.sc [K1, monster, probe, 1] ohne Position: ' + JSON.stringify(sc1));
      await shot(A, 'boden-b-stufe1');
      await shot(C, 'captain-a-stufe1');

      await dbg(A, 'scanfertig', { stufe: 3 });
      await sleep(800);
      const sc3 = JSON.parse(await scSnap(A));
      ok(sc3 && sc3[0].length === 6, 'Stufe 3: away.sc mit Position: ' + JSON.stringify(sc3));
      await shot(A, 'boden-c-stufe3');
      await shot(C, 'captain-b-stufe3');

      for (const lad of [0, 1, 2, 3]) { zustand('patrouille', lad); await sleep(700); await shot(A, 'boden-d-ladung' + lad); }
      zustand('rammen', 3); K.t = 99; await sleep(700); await shot(A, 'boden-e-rammt');
      const krR = JSON.parse(await krSnap(A));
      ok(krR && (krR[0][5] & 8) === 8, 'rammt: Bit 8 im Client-Snapshot (bits ' + (krR && krR[0][5]) + ')');
      zustand('pause', 1); K.t = 99; await sleep(700); await shot(A, 'boden-f-pause');
      const krP = JSON.parse(await krSnap(A));
      ok(krP && (krP[0][5] & 4) === 4, 'Pause: Bit 4 im Client-Snapshot (bits ' + (krP && krP[0][5]) + ')');
      zustand('patrouille', 2); await sleep(700);
      await shot(C, 'captain-d-karte-ladung2');
      // Ausschnitt um die Kreatur (Bodenansicht), vergrößert
      const mitte = await A.evaluate(() => { const c = document.getElementById('game'); return { w: c.width, h: c.height }; });
      console.log('Canvas', JSON.stringify(mitte));
    } finally { clearInterval(halten); }
  } finally {
    await b.close();
    if (srv.close) await srv.close();
  }
  console.log('Browserfehler:', err.length ? [...new Set(err)].slice(0, 10).join(' | ') : 'keine');
  ok(err.length === 0, 'keine Browserfehler');
  console.log(fails ? fails + ' FEHLER' : 'alles ok');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
