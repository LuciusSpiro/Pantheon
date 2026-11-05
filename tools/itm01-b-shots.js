#!/usr/bin/env node
// ITM-01 B: Browser-Prüfung des Medipack-Clients mit echtem Server: Ausrüstungsstation (Symbol, Direktwahl 8), Boden-HUD-Zelle mit 3/2/1/0 Ladungen (3 und 2 Slots), E-Hinweis zum Wiederbeleben
// (Client.interactionAt) mit und ohne Ladung, dev-mock (?mock=1) ohne Skriptfehler.
//   node tools/itm01-b-shots.js [--out <ordner>] [--port 3394] [--render 2d|voxel]
// Bilder: <out>/<render>-*.png (Standard shots/itm01-b, gitignored). Voraussetzung: playwright-core (PLAYWRIGHT_CORE), public/voxel (npm run assets) für --render voxel.
// Voxel-Modus: nur Einzelbilder (Headless-Chromium ist dort bei gehaltenen Tasten unzuverlässig); hier werden keine Tasten gehalten.
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; };
const PORT = +arg('port', '3394');
const RENDER = arg('render', '2d');
const OUT = path.resolve(ROOT, arg('out', 'shots/itm01-b'));
const DIRS = { WORLD_DIR: 'data/worlds-shots-itm01b', REGIE_DIR: 'data/regie-shots-itm01b', ERZEUGT_DIR: 'data/erzeugt-shots-itm01b' };
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
    await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000, polling: 20 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => __game.send({ t: 'lobbyOpt', skipDrill: true }));
    await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await page.waitForTimeout(2500);
    const p = game.players[0];
    const shot = async (n, clip) => { const f = path.join(OUT, RENDER + '-' + n + '.png'); await page.screenshot(clip ? { path: f, clip } : { path: f }); console.log(f); return f; };
    const meSnap = () => page.evaluate(() => { const q = __game.state.players.find((x) => x.id === __game.pid); return { medkit: q.medkit, wf: q.wf, zone: q.zone, x: q.x, y: q.y }; });

    // ---------- Station: Medipack mit Taste 8 in Slot 2, eigenes Symbol (nicht das des Scanners) ----------
    game.inventory.medipack = 6;
    Loadout.slotSetzen(game, p, 0, 'blaster'); Loadout.slotSetzen(game, p, 1, null); Loadout.slotSetzen(game, p, 2, null);
    p.console = 'ausruestung';
    await page.waitForFunction(() => { const q = __game.state.players.find((x) => x.id === __game.pid); return q.console === 'ausruestung'; }, null, { timeout: 8000, polling: 40 }).catch(() => null);
    await page.waitForFunction(() => Consoles.ausr && Consoles.ausr.stand, null, { timeout: 8000, polling: 40 });
    await page.waitForTimeout(600);
    await page.evaluate(() => { window.__sym = 0; const o = Scanner.symbol; Scanner.symbol = function () { window.__sym++; return o.apply(this, arguments); }; });
    await page.keyboard.press('ArrowDown');   // Slot 2 wählen
    await page.keyboard.press('Digit8');      // Medipack
    await page.waitForFunction(() => Consoles.ausr.stand.slots[1] === 'medipack', null, { timeout: 4000, polling: 40 }).catch(() => null);
    ok(Loadout.wirksam(game, p)[1] === 'medipack', 'Station: Taste 8 hat das Medipack serverseitig in Slot 2 gesetzt (der Server nimmt die Item-ID an)');
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => { window.__sym = 0; return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(window.__sym === 0)))); }), 'Station: mit Medipack im Slot wird Scanner.symbol nicht aufgerufen (eigenes Symbol)');
    await shot('station-medipack');
    // Scanner in Slot 3 zum Vergleich der beiden Symbole in einem Bild
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Digit7');
    await page.waitForFunction(() => Consoles.ausr.stand.slots[2] === 'scanner', null, { timeout: 4000, polling: 40 }).catch(() => null);
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => { window.__sym = 0; return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(window.__sym > 0)))); }), 'Station: der Scanner im anderen Slot zeichnet weiter sein Peilring-Symbol');
    await shot('station-medipack-und-scanner');
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowRight');   // Cursor auf die Zeile des Medipacks
    p.console = null;
    await page.waitForTimeout(400);

    // ---------- an den Boden: 3 Slots ----------
    Loadout.slotSetzen(game, p, 2, null);
    await page.evaluate(() => __game.dbg('buehne aussenposten 1 - rostmeute intakt'));
    await page.waitForFunction(() => { const st = __game.state, me = st && st.players.find((q) => q.id === __game.pid); return !!(me && me.zone === 'away' && st.away && Shared_Maps[st.away.map] && Shared_Maps[st.away.map].buehne); }, null, { timeout: 60000, polling: 40 });
    if (RENDER === 'voxel') await page.waitForFunction(() => { const s = window.VoxelKit && VoxelKit.stats(); return !!(s && s.id === __game.state.away.map); }, null, { timeout: 60000, polling: 40 });
    await page.waitForTimeout(1500);
    Loadout.standSenden(game, p);
    await page.evaluate(() => __game.dbg('god on'));
    await page.waitForFunction(() => Hud.loadoutStand && Hud.loadoutStand.slots[1] === 'medipack', null, { timeout: 5000, polling: 40 });
    await page.mouse.move(900, 300);
    await page.waitForTimeout(500);
    const HUD = { x: 0, y: 440, width: 420, height: 280 };
    let m = await meSnap();
    ok(m.medkit > 0 && m.medkit === game.C.medipack.ladungen, 'Boden: das Pack kam aus dem Lager, medkit im Snapshot = Ladungen je Pack (' + m.medkit + ')');
    ok(m.wf === 'blaster', 'Boden: aktive Waffe bleibt der Blaster, das Medipack im Slot 2 ist keine Waffe');
    // HUD-Zelle bei 3, 2, 1, 0 Ladungen (Server setzt, Client liest den Snapshot)
    for (const n of [3, 2, 1, 0]) {
      p.medkit = n;
      await page.waitForFunction((v) => { const q = __game.state.players.find((x) => x.id === __game.pid); return (q.medkit || 0) === v; }, n, { timeout: 4000, polling: 30 });
      await page.waitForTimeout(250);
      await shot('hud-3slots-ladungen-' + n, HUD);
    }
    // Geschwindigkeit des Wechsels: die Slot-Taste des Medipacks zeigt nur den Rest als notice (Server)
    p.medkit = 2;
    await page.waitForTimeout(300);
    await page.keyboard.press('Digit2');
    await page.waitForFunction(() => Hud.notices.some((n) => /Medipack: 2 Ladungen/.test(n.text)), null, { timeout: 4000, polling: 30 }).catch(() => null);
    ok(await page.evaluate(() => Hud.notices.some((n) => /Medipack: 2 Ladungen/.test(n.text))), 'Slot-Taste 2: Server-Notice „Medipack: 2 Ladungen“ erscheint (der Client erfindet keinen Text)');
    ok((await meSnap()).wf === 'blaster', 'Slot-Taste des Medipacks wechselt die Waffe nicht');
    await shot('hud-3slots-notice', { x: 0, y: 300, width: 640, height: 420 });

    // ---------- 2 Slots (die Clientleiste nur für das Bild auf 2 Slots gestellt; echte 2 Slots kommen erst ab 3 Spielern) ----------
    for (const n of [3, 0]) {
      p.medkit = n;
      await page.waitForFunction((v) => { const q = __game.state.players.find((x) => x.id === __game.pid); return (q.medkit || 0) === v; }, n, { timeout: 4000, polling: 30 });
      await page.evaluate(() => { Hud.loadoutStand = { slotzahl: 2, slots: ['blaster', 'medipack'] }; });
      await page.waitForTimeout(300);
      await shot('hud-2slots-ladungen-' + n, HUD);
    }
    await page.evaluate(() => { Hud.loadoutStand = { slotzahl: 3, slots: ['blaster', 'medipack', null] }; });

    // ---------- Scanner und Medipack nebeneinander (3 Slots), Scan läuft ----------
    p.medkit = 3;
    await page.evaluate(() => { Hud.loadoutStand = { slotzahl: 3, slots: ['blaster', 'medipack', 'scanner'] }; });
    await page.waitForTimeout(300);
    await shot('hud-3slots-medipack-und-scanner', HUD);

    // ---------- E-Hinweis Wiederbeleben (Client.interactionAt) ----------
    const hinweis = (medkit) => page.evaluate((n) => {
      const st = __game.state, TILE = (Shared_Config.tile || 32);
      const me = Object.assign({}, st.players.find((q) => q.id === __game.pid), { sh: [3, 3] });
      if (n == null) delete me.medkit; else me.medkit = n;
      const d = { id: 'fremd', name: 'Kara', downed: true, zone: 'away', x: me.x + TILE, y: me.y, color: 1 };
      const st2 = Object.assign({}, st, { players: [me, d] });
      const r = Client.interactionAt(st2, me, Math.floor(d.x / TILE), Math.floor(d.y / TILE), 'away', false);
      return r && r.label;
    }, medkit);
    const W = game.C.awayCombat.wounded;
    for (const n of [3, 1]) { const l = await hinweis(n); ok(new RegExp('wiederbeleben \\(' + String(W.medkitReviveTime).replace('.', ',') + ' s, Medipack\\)').test(l || ''), 'Hinweis bei ' + n + ' Ladung(en): „' + l + '“'); }
    for (const n of [0, null]) { const l = await hinweis(n); ok(new RegExp('wiederbeleben \\(' + W.reviveTime + ' s\\)$').test(l || ''), 'Hinweis ohne Ladung (' + (n === null ? 'medkit fehlt' : 'medkit 0') + '): „' + l + '“'); }

    // ---------- dev-mock: kein Skriptfehler, Ladungen statt Flag ----------
    const page2 = await b.newPage({ viewport: { width: 1280, height: 720 } });
    page2.on('pageerror', (e) => err.push('mock pageerror: ' + e.message));
    page2.on('console', (m2) => { if (m2.type() === 'error') err.push('mock console: ' + m2.text().slice(0, 200)); });
    await page2.goto(`http://127.0.0.1:${PORT}/?mock=1&loc=kesh&zone=away&scene=hof&render=2d&debug=1`);
    await page2.waitForFunction(() => window.__game && __game.state && __game.state.players && __game.state.players.length, null, { timeout: 30000, polling: 40 });
    await page2.waitForTimeout(1200);
    const mk = await page2.evaluate(() => __game.state.players.map((q) => ({ id: q.id, zone: q.zone, medkit: q.medkit, downed: !!q.downed })));
    console.log('Mock-Spieler:', JSON.stringify(mk));
    ok(mk.some((q) => q.zone === 'away' && q.medkit === game.C.medipack.ladungen), 'dev-mock: Außenteam startet mit vollem Pack (' + game.C.medipack.ladungen + ' Ladungen), nicht mit dem Flag 1');
    await page2.screenshot({ path: path.join(OUT, RENDER + '-mock-hof.png') });
    await page2.close();

    console.log('Konsolenfehler:', err.length); err.slice(0, 8).forEach((e) => console.log('  ' + e));
    if (err.length) fails++;
  } finally { await b.close().catch(() => null); await srv.close().catch(() => null); }
  console.log(fails ? fails + ' FEHLER' : 'alle ok');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
