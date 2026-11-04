#!/usr/bin/env node
// AUS-02 B: Browser-Prüfung des Waffenwechsels am Boden (Tasten 1–3, Slot-Leiste mit Ziffern, Sperr-Zustand, Hilfezeile).
//   node tools/aus02-b-shots.js [--out <ordner>] [--port 3392] [--render voxel|2d]
// Startet den Server im Prozess (startServer, --debug, eigene Datenordner), öffnet headless Chromium, beamt die Figur per Debug-Befehl `buehne` nach unten, setzt das Loadout direkt über
// Loadout.slotSetzen (die Station selbst ist nicht Thema), drückt echte Tasten und prüft den Snapshot (wf). Bilder: a-drei-slots, b-nach-wechsel (Sperre sichtbar), c-nach-sperre, d-zwei-slots.
// Voraussetzung: node_modules mit playwright-core (oder PLAYWRIGHT_CORE), public/voxel (npm run assets) für --render voxel.
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; };
const PORT = +arg('port', '3392');
const RENDER = arg('render', 'voxel');
const OUT = path.resolve(ROOT, arg('out', 'shots/aus02'));
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
const Loadout = require('../server/sim/loadout.js');
const await_url = () => 'Port ' + PORT;
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
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => err.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') err.push('console: ' + m.text().slice(0, 200)); });
    await page.goto(`http://127.0.0.1:${PORT}/?render=${RENDER}&debug=1`);
    await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000, polling: 20 }).catch((e) => { console.log('Fehler:', err.join(' | '), await_url()); throw e; });
    await page.waitForTimeout(1500);
    await page.evaluate(() => __game.send({ t: 'lobbyOpt', skipDrill: true }));
    await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await page.waitForTimeout(2500);
    const p = game.players[0];
    // Loadout vor dem Beamen setzen (der Stand kommt beim Beamen nach unten); 3 Slots: Sturmgewehr, Lanze, Granatwerfer
    Loadout.slotSetzen(game, p, 0, 'sturmgewehr'); Loadout.slotSetzen(game, p, 1, 'lanze'); Loadout.slotSetzen(game, p, 2, 'granatwerfer');
    game.C.awayCombat.wechselzeit = 4;   // nur für die Bilder: die Sperre bleibt lang genug sichtbar (Standard 0,6 s)
    await page.evaluate(() => __game.dbg('buehne aussenposten 1 - rostmeute intakt'));
    await page.waitForFunction(() => { const st = __game.state, me = st && st.players.find((q) => q.id === __game.pid); return !!(me && me.zone === 'away' && st.away && Shared_Maps[st.away.map] && Shared_Maps[st.away.map].buehne); }, null, { timeout: 60000, polling: 40 });
    if (RENDER === 'voxel') await page.waitForFunction(() => { const s = window.VoxelKit && VoxelKit.stats(); return !!(s && s.id === __game.state.away.map); }, null, { timeout: 60000, polling: 40 });
    await page.waitForTimeout(1500);
    Loadout.standSenden(game, p);   // sicher ist sicher: aktueller Stand (kommt auch beim Beamen)
    await page.evaluate(() => __game.dbg('god on'));
    await page.waitForFunction(() => Hud.loadoutStand && Hud.loadoutStand.slotzahl === 3, null, { timeout: 5000, polling: 40 });
    const wf = () => page.evaluate(() => __game.state.players.find((q) => q.id === __game.pid).wf);
    const shot = async (n) => { const f = path.join(OUT, RENDER + '-' + n + '.png'); await page.screenshot({ path: f }); console.log(f); const g = path.join(OUT, RENDER + '-' + n + '-hud.png'); await page.screenshot({ path: g, clip: { x: 0, y: 440, width: 420, height: 280 } }); console.log(g); };
    await page.mouse.move(700, 300);
    console.log('Start-Waffe:', await wf());
    ok(await wf() === 'sturmgewehr', 'Start: Slot 1 (Sturmgewehr) aktiv');
    await shot('a-drei-slots');
    // Taste 2 -> Lanze, Sperre läuft
    await page.keyboard.press('Digit2');
    await page.waitForFunction(() => __game.state.players.find((q) => q.id === __game.pid).wf === 'lanze', null, { timeout: 3000, polling: 20 });
    ok(true, 'Taste 2: Waffe wechselt auf Lanze');
    await sleep(1200);
    const anteil = await page.evaluate(() => JSON.stringify(Hud.wechselSperre));
    await shot('b-nach-wechsel');
    console.log('Sperre {bis,dauer}:', anteil);
    // Taste 1 -> zurück; Taste 3 -> Granatwerfer
    await sleep(4200);
    await shot('c-nach-sperre');
    await page.keyboard.press('Digit3');
    await page.waitForFunction(() => __game.state.players.find((q) => q.id === __game.pid).wf === 'granatwerfer', null, { timeout: 3000, polling: 20 });
    ok(true, 'Taste 3: Waffe wechselt auf Granatwerfer');
    await sleep(4200);
    // Zwei Slots: Stand mit slotzahl 2, Taste 3 sendet nichts
    game.slotzahl = 2; Loadout.standSenden(game, p);
    await page.waitForFunction(() => Hud.loadoutStand && Hud.loadoutStand.slotzahl === 2, null, { timeout: 5000, polling: 40 });
    await page.keyboard.press('Digit1');
    await page.waitForFunction(() => __game.state.players.find((q) => q.id === __game.pid).wf === 'sturmgewehr', null, { timeout: 3000, polling: 20 });
    await sleep(4200);
    await page.keyboard.press('Digit3');
    await sleep(500);
    ok(await wf() === 'sturmgewehr', 'Slotzahl 2: Taste 3 ändert nichts');
    await shot('d-zwei-slots');
    console.log('Konsolenfehler:', err.length); err.slice(0, 8).forEach((e) => console.log('  ' + e));
    if (err.length) fails++;
  } finally { await b.close().catch(() => null); await srv.close().catch(() => null); }
  console.log(fails ? fails + ' FEHLER' : 'alle ok');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
