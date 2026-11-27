// Sichtprüfung TRA-01 D: Training Fliegen im echten Browser (Playwright, Chromium): Checkliste (objectives) im HUD und ein ausgelöster Hänger-Hinweis (ODA).
// Echter Server im selben Prozess, Lobby-Modus training_fliegen wie im Menü. Der Spielzustand wird nur zum Vorspulen berührt (Schrittzeit, Position),
// die Anzeige kommt aus dem echten Client. Bilder: 1 Start (alle Ziele offen), 2 nach Ablegen und Weg vom Liegeplatz (erstes Ziel abgehakt, Schritt 2),
// 3 Hänger-Hinweis des Schritts (ODA-Zeile).
// Aufruf: node tools/sicht-training-fliegen.js [--shots <Ordner>] [--port 3481] [--vp 1280x720]
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3481');
const SHOTS = arg('shots', path.join(os.tmpdir(), 'tra01-d-shots'));
const [VW, VH] = arg('vp', '1280x720').split('x').map(Number);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-tra01-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
const Interior = require('../server/sim/interior.js');
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE setzen)'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await startServer({ port: PORT, debug: true, roomCode: 'off', quiet: true, worlds: false, worldDir: path.join(TMP, 'worlds') });
  const g = srv.game;
  const fehler = [];
  const b = await chromium.launch();
  try {
    const page = await (await b.newContext({ viewport: { width: VW, height: VH } })).newPage();
    page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') fehler.push('console: ' + m.text().slice(0, 200)); });
    await page.goto(`http://127.0.0.1:${PORT}/?debug=1&render=2d`);
    await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
    const shot = async (name, wartMs) => { await sleep(wartMs || 800); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); console.log('Bild', name); };
    const send = (o) => page.evaluate((m) => __game.send(m), o);
    await send({ t: 'lobbyOpt', startMission: 'training_fliegen' }); await send({ t: 'ready', ready: true });
    await page.waitForFunction(() => __game.state && __game.state.phase === 'play', null, { timeout: 30000 });
    const p = g.players[0];
    await sleep(1500);
    console.log('Schritt', g.mission.state.stage, 'Ziele', g.mission.state.objectives.length);
    await shot('1-start', 1500);
    // Platz am Steuer, W, ein Stück vom Liegeplatz weg: erstes Ziel erledigt
    Interior.enterConsole(g, p, 'helm');
    await send({ t: 'cmd', c: 'helm.throttle', delta: 1 });
    await send({ t: 'cmd', c: 'helm.throttle', set: 4 });
    for (let i = 0; i < 500 && g.mission.state.stage === 'a_hoch'; i++) await sleep(100);
    console.log('Schritt nach Ablegen und Flug:', g.mission.state.stage, 'x', Math.round(g.ship.x));
    await send({ t: 'cmd', c: 'helm.stop' });
    await shot('2-erstes-ziel', 1200);
    // Hänger: der Hinweis des Schritts feuert 45 s nach Schrittstart; vorgespult, damit die Sichtprüfung nicht 45 s wartet
    g.mission.stepTime = 44.3;
    const hinweis = g.mission.def.texte['hinweis.runter'];
    // ODA-Zeilen laufen nacheinander (auch Zeilen des Spiels wie „Abgelegt!“): warten, bis der Hinweis an der Reihe ist
    await page.waitForFunction((t) => window.Hud && Hud.oda.cur && Hud.oda.cur.text === t && Hud.oda.cur.shown >= t.length, hinweis, { timeout: 40000 });
    console.log('ODA im Client:', await page.evaluate(() => Hud.oda.cur.text));
    await shot('3-hinweis', 300);
    // zum Vergleich: dieselbe Lage, aber zu Fuß auf der Brücke (Konsole verlassen): Checkliste und Haken
    Interior.konsoleVerlassen(g, p, 'sicht');
    await sleep(800);
    await shot('4-brücke-mit-haken', 600);
    console.log('g.errors', g.errors);
  } finally {
    await b.close(); await srv.close();
  }
  console.log(fehler.length ? 'Browser-Fehler:\n  ' + fehler.join('\n  ') : 'keine Browser-Fehler');
  console.log('Bilder in ' + SHOTS);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
