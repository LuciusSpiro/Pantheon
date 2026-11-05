#!/usr/bin/env node
// SCA-01 P3: Browser-Prüfung des Scanner-Clients mit echtem Server und echten Tasten.
//   node tools/sca01-p3-shots.js [--out <ordner>] [--port 3393] [--render 2d|voxel]
// 2d (Standard): voller Lauf – Station (Scanner per Taste 7 in Slot 2), HUD-Leiste, Scan starten (Taste 2), Overlay, Frequenz mit A/D nachführen (liest players[me].sc.s aus dem Snapshot),
// Bewegung/Schuss/Fremdwaffe werden geschluckt, Scan vollendet (Notice „Scan: 3 Ziele erfasst“), Esc-Abbruch, Treffer-Abbruch (Server-Hook onTreffer, kein echter Gegnertreffer), Abbruch über die Slot-Taste.
// voxel: nur Einzelbilder (Headless-Chromium überhitzt im Voxel-Modus mit gehaltenen Tasten): Station, HUD-Leiste, Overlay laufend, Ergebnis.
// Startet den Server im Prozess (startServer, --debug, eigene Datenordner). Voraussetzung: playwright-core (PLAYWRIGHT_CORE), public/voxel (npm run assets) für --render voxel.
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; };
const PORT = +arg('port', '3393');
const RENDER = arg('render', '2d');
const OUT = path.resolve(ROOT, arg('out', 'shots/sca01-p3'));
const DIRS = { WORLD_DIR: 'data/worlds-shots-sca', REGIE_DIR: 'data/regie-shots-sca', ERZEUGT_DIR: 'data/erzeugt-shots-sca' };
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
const ScannerSim = require('../server/sim/scanner.js');
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
    const meSnap = () => page.evaluate(() => { const q = __game.state.players.find((x) => x.id === __game.pid); return { action: q.action || null, sc: q.sc || null, wf: q.wf, x: q.x, y: q.y, zone: q.zone, console: q.console || null }; });
    const scanLaeuft = async () => { const m = await meSnap(); return !!(m.action && m.action.kind === 'scan'); };
    const overlay = () => page.evaluate(() => Scanner.aktiv(__game.state.players.find((x) => x.id === __game.pid)));
    const warteScan = async (an, ms) => { await page.waitForFunction((v) => { const q = __game.state.players.find((x) => x.id === __game.pid); return !!(q.action && q.action.kind === 'scan') === v; }, an, { timeout: ms || 4000, polling: 30 }); };
    const notices = () => page.evaluate(() => Hud.notices.map((n) => n.text));

    // ---------- Station: Scanner mit Taste 7 in Slot 2 wählen (an Bord, Konsole serverseitig geöffnet) ----------
    Loadout.slotSetzen(game, p, 0, 'sturmgewehr'); Loadout.slotSetzen(game, p, 1, null); Loadout.slotSetzen(game, p, 2, null);
    game.C.scanner.abklingzeit = 0;
    p.console = 'ausruestung';
    await page.waitForFunction(() => { const q = __game.state.players.find((x) => x.id === __game.pid); return q.console === 'ausruestung'; }, null, { timeout: 8000, polling: 40 }).catch(() => null);
    await page.waitForFunction(() => Consoles.ausr && Consoles.ausr.stand, null, { timeout: 8000, polling: 40 });
    await page.waitForTimeout(600);
    await page.keyboard.press('ArrowDown');   // Slot 2 wählen
    await page.keyboard.press('Digit7');      // Scanner
    await page.waitForFunction(() => Consoles.ausr.stand.slots[1] === 'scanner', null, { timeout: 4000, polling: 40 }).catch(() => null);
    ok(Loadout.wirksam(game, p)[1] === 'scanner', 'Station: Taste 7 hat den Scanner (Item) serverseitig in Slot 2 gesetzt');
    await page.waitForTimeout(500);
    await shot('station-scanner');
    p.console = null;
    await page.waitForTimeout(400);

    // ---------- an den Boden ----------
    await page.evaluate(() => __game.dbg('buehne aussenposten 1 - rostmeute intakt'));
    await page.waitForFunction(() => { const st = __game.state, me = st && st.players.find((q) => q.id === __game.pid); return !!(me && me.zone === 'away' && st.away && Shared_Maps[st.away.map] && Shared_Maps[st.away.map].buehne); }, null, { timeout: 60000, polling: 40 });
    if (RENDER === 'voxel') await page.waitForFunction(() => { const s = window.VoxelKit && VoxelKit.stats(); return !!(s && s.id === __game.state.away.map); }, null, { timeout: 60000, polling: 40 });
    await page.waitForTimeout(1500);
    Loadout.standSenden(game, p);
    await page.evaluate(() => __game.dbg('god on'));
    await page.waitForFunction(() => Hud.loadoutStand && Hud.loadoutStand.slots[1] === 'scanner', null, { timeout: 5000, polling: 40 });
    await page.mouse.move(900, 300);
    await page.evaluate(() => __game.send({ t: 'debug', cmd: 'scantest' }));
    await page.waitForTimeout(600);
    const HUD = { x: 0, y: 440, width: 420, height: 280 };
    await shot('hud-leiste', HUD);
    ok((await meSnap()).wf === 'sturmgewehr', 'Boden: aktive Waffe ist das Sturmgewehr, der Scanner im Slot 2 ist keine Waffe');
    const sw = await page.evaluate(() => Render.measure('Scanner', 1) + ' / ' + Render.measure(Hud.fit('Scanner', Math.floor(164 / 3) - 13, 1), 1));
    console.log('Breite „Scanner“ (roh / nach fit):', sw);
    ok(await page.evaluate(() => Hud.fit('Scanner', Math.floor(164 / 3) - 13, 1) === 'Scanner'), '„Scanner“ passt ungekürzt in die 3-Slot-Zelle (echte Schrift)');

    // ---------- Scan starten (Taste 2) ----------
    await page.keyboard.press('Digit2');
    await warteScan(true);
    await page.waitForTimeout(400);
    ok(await overlay(), 'Taste 2: Overlay erscheint (action.kind scan im Snapshot)');
    await shot('overlay-laufend');
    await shot('hud-leiste-scan-laeuft', HUD);

    // Bewegung, Schuss, Fremdwaffe: geschluckt, Scan läuft weiter
    const pos0 = await meSnap();
    for (const k of ['KeyW', 'ArrowUp', 'KeyS']) { await page.keyboard.down(k); await sleep(250); await page.keyboard.up(k); }
    await page.keyboard.press('Space'); await page.keyboard.press('Digit1'); await page.keyboard.press('Digit3'); await page.keyboard.press('KeyQ');
    await page.mouse.click(900, 300);
    await sleep(400);
    const nach = await meSnap();
    ok(await scanLaeuft() && await overlay(), 'W, Pfeil hoch, S, Space, Taste 1, Taste 3, Q und Mausklick: Scan läuft weiter, Overlay bleibt');
    ok(Math.abs(nach.x - pos0.x) < 1 && Math.abs(nach.y - pos0.y) < 1 && nach.wf === 'sturmgewehr', 'keine Bewegung, keine Waffenwechsel');

    // ---------- Frequenz nachführen bis zum Ende ----------
    // Das Band kennt der Client nicht: in eine Richtung fahren, bis die Signalstärke da ist und steigt; fällt sie, umkehren; stößt f an den Rand, umkehren.
    const fuehren = async (maxMs) => {
      let dir = 0, lastS = 0, lastF = null, t0 = Date.now(), flips = 0, shotGemacht = false, sMax = 0;
      const setDir = async (d) => { if (d === dir) return; if (dir === 1) await page.keyboard.up('KeyD'); if (dir === -1) await page.keyboard.up('KeyA'); dir = d; if (d === 1) await page.keyboard.down('KeyD'); if (d === -1) await page.keyboard.down('KeyA'); };
      await setDir(1);
      while (Date.now() - t0 < maxMs) {
        const m = await meSnap();
        if (!(m.action && m.action.kind === 'scan')) break;
        const sc = m.sc || { f: 0.5, s: 0, h: 0 };
        sMax = Math.max(sMax, sc.s);
        if (!shotGemacht && sc.s > 0.5) { shotGemacht = true; await shot('overlay-signal-gefunden'); }
        if (sc.s > 0 && sc.s < lastS - 0.01 && flips < 40) { await setDir(-dir || 1); flips++; }
        else if (sc.s === 0 && lastF != null && ((dir === 1 && sc.f > 0.97) || (dir === -1 && sc.f < 0.03))) { await setDir(-dir); flips++; }
        lastS = sc.s; lastF = sc.f;
        await sleep(70);
      }
      await setDir(0);
      return { flips, sMax };
    };
    let r1 = await fuehren(40000);
    const ergebnis = () => page.waitForFunction(() => Hud.notices.some((n) => /^Scan:|Nichts in Reichweite|Nur Rauschen/.test(n.text)), null, { timeout: 4000, polling: 30 }).catch(() => null);
    await ergebnis();
    await sleep(150);
    let ns = await notices();
    // Voxel: die niedrige Bildrate macht das Nachführen ungenau (Qualität 0 = „Nur Rauschen“, ein gültiges Serverergebnis ohne Ziele): bis zu drei Versuche
    for (let v = 1; RENDER === 'voxel' && v < 4 && !ns.some((n) => /^Scan: 3 Ziele erfasst/.test(n)); v++) {
      console.log('Versuch ' + v + ' endete mit:', JSON.stringify(ns));
      await sleep(3200);   // alte Notice verfällt
      await page.keyboard.press('Digit2'); await warteScan(true);
      r1 = await fuehren(40000); await ergebnis(); await sleep(150); ns = await notices();
    }
    console.log('Notices:', JSON.stringify(ns), ' Umkehrungen:', r1.flips, ' max. Signal:', r1.sMax);
    ok(!(await scanLaeuft()) && !(await overlay()), 'Scan vollendet: Overlay weg, Snapshot ohne action scan');
    ok(ns.some((n) => /^Scan: 3 Ziele erfasst/.test(n)), 'Notice „Scan: 3 Ziele erfasst“ sichtbar');
    await shot('ergebnis-notice');
    const aw = await page.evaluate(() => (__game.state.away && __game.state.away.sc) || null);
    ok(Array.isArray(aw) && aw.length === 3, 'Snapshot away.sc trägt die drei Ziele (' + (aw ? aw.length : 'fehlt') + ')');
    const nachScan = await meSnap();
    ok(!nachScan.sc, 'players[me].sc nach dem Scan weg');
    // A/D waren zuletzt gehalten und wurden losgelassen: danach geht die Figur nicht von selbst
    await sleep(300);

    // ---------- Esc-Abbruch ----------
    if (RENDER === 'voxel') await sleep(300);
    const abbruchLauf = async (name, beenden, erwartetNotice) => {
      await page.keyboard.press('Digit2'); await warteScan(true); await page.waitForTimeout(300);
      const awVor = await page.evaluate(() => JSON.stringify(__game.state.away.sc));
      await page.keyboard.down('KeyD'); await sleep(500);   // Richtung gehalten, dann beenden
      const px = (await meSnap()).x;
      await beenden();
      await warteScan(false, 3000);
      await sleep(300);
      ok(!(await overlay()) && !(await meSnap()).sc, name + ': Overlay weg, kein sc im Snapshot');
      ok(game.players[0].scan == null && game.players[0].hold == null, name + ': Server hat Scan und Hold aufgeräumt');
      await sleep(500);
      ok(Math.abs((await meSnap()).x - px) < 1, name + ': D noch gehalten, aber die Figur läuft nicht los (die Taste wurde im Overlay verbraucht)');
      await page.keyboard.up('KeyD');
      ok(await page.evaluate((v) => JSON.stringify(__game.state.away.sc) === v, awVor), name + ': kein Ergebnis (away.sc unverändert)');
      if (erwartetNotice) ok((await notices()).some((n) => erwartetNotice.test(n)), name + ': Notice ' + erwartetNotice);
      await page.waitForTimeout(150);
    };
    await abbruchLauf('Esc', async () => { await page.keyboard.press('Escape'); });
    ok(!(await page.evaluate(() => (Client.ui && Client.ui.stack ? Client.ui.stack.length : 0))), 'Esc öffnet kein Spielmenü');
    await shot('nach-esc-abbruch');
    await abbruchLauf('Slot-Taste 2', async () => { await page.keyboard.press('Digit2'); }, /Scan abgebrochen/);
    await abbruchLauf('Treffer', async () => { ScannerSim.onTreffer(game, p.id); }, /Getroffen/);
    await shot('nach-treffer-abbruch');
    console.log('Hinweis: der Treffer-Abbruch ruft den Server-Hook scanner.onTreffer direkt (combat.ankerTreffer ruft ihn bei jedem echten Treffer; getestet in tools/test-scanner.js).');

    console.log('Konsolenfehler:', err.length); err.slice(0, 8).forEach((e) => console.log('  ' + e));
    if (err.length) fails++;
  } finally { await b.close().catch(() => null); await srv.close().catch(() => null); }
  console.log(fails ? fails + ' FEHLER' : 'alle ok');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
