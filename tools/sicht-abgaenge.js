// Sichtprüfung SPT-02 7 (E Abgänge): Schiffe verschwinden nicht mehr ohne Knall. Echter Server (im selben Prozess, damit Gegner, Flotte und Verbündete an der Lerche
// aufgestellt werden können) und EIN echter Browser-Client (Playwright, Chromium), Modus „Freie Fahrt Sund“, Ops-Platz (Radar mit den Schiffen). Je Klasse ein Vorher- und ein Nachher-Bild:
//   gegner     drei Räuber ziehen ab (Escort.retreat, Tag der Szene); einer löst sich nach der Zeitgrenze mitten im Feld auf (abgang rueck)
//   flotte     Korvette, Fregatte und Kreuzer springen per Notsprung (abgang sprung, Gegnersprung.schritt)
//   verbuendete drei Verbündete der Flotte springen am Szenenende ab (abgang sprung, wie hilfeWeg / kriegslage-szene.aufraeumen)
// Aufruf: node tools/sicht-abgaenge.js [--shots <Ordner>] [--port 3471] [--render voxel|2d] [--dpr 1]      (Bilder nicht im Repo, Standard: Temp-Ordner)
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3471');
const SHOTS = arg('shots', path.join(os.tmpdir(), 'spt02-p7-shots'));
const RENDER = arg('render', 'voxel');
const DPR = +arg('dpr', '1');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-abgaenge-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
const Sektoren = require('../shared/sektoren.js');
const Space = require('../server/sim/space.js');
const Escort = require('../server/sim/escort.js');
const Flotte = require('../server/sim/flotte.js');
const Gegnersprung = require('../server/sim/gegnersprung.js');
const Abgang = require('../server/sim/abgang.js');
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } throw new Error('playwright-core nicht gefunden'); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HEX = '0505';

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await startServer({ port: PORT, debug: true, roomCode: 'off', quiet: true, worlds: true, worldDir: path.join(TMP, 'worlds') });
  const g = srv.game;
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const fehler = [];
  try {
    const page = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: DPR })).newPage();
    page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') fehler.push('console: ' + m.text().slice(0, 200)); });
    await page.goto(`http://127.0.0.1:${PORT}/?debug=1` + (RENDER === '2d' ? '&render=2d' : ''));
    await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
    await page.evaluate(() => { __game.send({ t: 'lobbyOpt', startMission: 'freie_fahrt' }); __game.send({ t: 'ready', ready: true }); });
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await sleep(500);
    g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;
    const send = (o) => page.evaluate((m) => __game.send(m), o);
    const shot = async (name, wartMs) => { await sleep(wartMs == null ? 150 : wartMs); await page.screenshot({ path: path.join(SHOTS, RENDER + '-' + name + '.png') }); console.log('Bild', RENDER + '-' + name); };
    await send({ t: 'debug', cmd: 'hex', hex: HEX });
    await page.waitForFunction((h) => __game.state && __game.state.ship && __game.state.ship.scene === h, Sektoren.ortVonHex(HEX), { timeout: 8000 }); await sleep(500);
    await send({ t: 'debug', cmd: 'sitz', console: 'weapons' });
    await sleep(800);
    const sp = g.space, L = g.ship;
    const frei = () => { sp.enemies = []; sp.escorts = []; sp.projectiles = []; };
    const um = (a, r) => ({ x: L.x + Math.cos(a) * r, y: L.y + Math.sin(a) * r });
    const emits = []; const eo = g.emit.bind(g); g.emit = (k, d) => { if (k === 'abgang' || k === 'explosion') emits.push([k, d]); return eo(k, d); };
    const halt = () => { for (const e of sp.enemies) { e.fireT = -999; } };   // niemand schießt: das Bild soll nur den Abgang zeigen

    // ---- 1) Gegner: Abzug nach dem Szenenende (Escort.retreat mit Tag), Auflösen nach der Zeitgrenze
    frei();
    const gg = [0.4, 2.2, 4.0].map((a, i) => { const p = um(a, 260 + i * 40); return Space.spawnEnemy(g, 'raider', { x: p.x, y: p.y, tag: 'abg_g' }); });
    halt(); await shot('gegner-1-vorher', 500);
    Escort.retreat(g, { tag: 'abg_g' }); delete sp.retreatRule;
    await sleep(1500); halt(); await shot('gegner-2-ziehen-ab', 0);
    for (const e of gg) if (sp.enemies.includes(e)) { e.x = L.x + (e.x - L.x) * 0.4; e.y = L.y + (e.y - L.y) * 0.4; e.leaveT = 14.2; }   // Zeitgrenze: sie lösen sich mitten im Feld auf
    await sleep(250); await shot('gegner-3-rueck-aufloesung', 0);
    await sleep(1500); await shot('gegner-4-danach', 0);
    console.log('  Gegner übrig:', sp.enemies.length, ' abgang-Ereignisse:', emits.filter((x) => x[0] === 'abgang').length);

    // ---- 2) Flotte: Notsprung dreier Schiffe (Korvette, Fregatte, Kreuzer)
    frei(); emits.length = 0;
    const ff = [['korvette', 0.3, 280], ['fregatte', 2.0, 330], ['kreuzer', 4.2, 300]].map(([k, a, r]) => { const p = um(a, r); return Space.spawnEnemy(g, k, { x: p.x, y: p.y, tag: 'abg_f' }); });
    halt(); await shot('flotte-1-vorher', 500);
    for (const e of ff) e.notsprung = { rest: 0.05 };
    for (const e of ff.slice()) Gegnersprung.schritt(g, e, 0.1);
    await sleep(220); await shot('flotte-2-sprung', 0);
    await sleep(1500); await shot('flotte-3-danach', 0);
    console.log('  Flotte übrig:', sp.enemies.length, ' abgang-Ereignisse:', emits.filter((x) => x[0] === 'abgang').map((x) => x[1].art).join());

    // ---- 3) Verbündete: Flotte der Spontanhilfe/Sim-Szene springt am Ende ab
    frei(); emits.length = 0;
    const vv = [0.5, 2.3, 4.1].map((a, i) => Flotte.aufstellen(g, { tag: 'abg_v' + i, kind: i === 1 ? 'fregatte' : 'korvette', name: 'Verbündeter ' + (i + 1), rolle: 'angreifer', von: um(a, 240 + i * 40) })).filter(Boolean);
    for (const q of vv) { q.vx = 0; q.vy = 0; }
    await shot('verbuendete-1-vorher', 700);
    for (const q of sp.escorts.filter((x) => x.ally && x.hp > 0)) Abgang.melde(g, q, 'sprung');   // wie hilfeWeg / kriegslage-szene.aufraeumen (Pfad im Test belegt)
    sp.escorts = sp.escorts.filter((x) => !x.ally);
    await sleep(220); await shot('verbuendete-2-sprung', 0);
    await sleep(1500); await shot('verbuendete-3-danach', 0);
    console.log('  Verbündete aufgestellt:', vv.length, ' abgang-Ereignisse:', emits.filter((x) => x[0] === 'abgang').length);
  } catch (e) { fehler.push('Abbruch: ' + (e && e.stack || e)); }
  await b.close(); await srv.close();
  console.log('Fehler:', fehler.length ? '\n  ' + fehler.slice(0, 12).join('\n  ') : 'keine');
  process.exit(fehler.length ? 1 : 0);
}
main();
