// Sichtprüfung Beschuss auf römische Verbündete (SUND-02b E): echter Server (im selben Prozess, damit Rang, römische Flotte und Lage der Lerche präpariert werden können) und ZWEI echte
// Browser-Clients (Playwright, Chromium), Modus „Freie Fahrt Sund“: Ada an der Ops, Bo am Captain-Platz (sieht die Warnung der Szenenzeile). Bilder: Ops mit Knopf „Römische Schiffe angreifen“ und
// Warnung, Anlauf (Fracht-Leiste mit Fortschritt, beide Clients), Szenenzeile VERRAT mit den ehemaligen Verbündeten als Gegner, Sieg, Weigerung ohne Verbündete.
// Aufruf: node tools/sicht-verrat.js [--shots <Ordner>] [--port 3463] [--dpr 1]      (Bilder nicht im Repo, Standard: Temp-Ordner)
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3463');
const SHOTS = arg('shots', path.join(os.tmpdir(), 'sund02b-e-shots'));
const DPR = +arg('dpr', '1');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-verrat-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
const Sektoren = require('../shared/sektoren.js');
const Szene = require('../server/sim/kriegslage-szene.js');
const Space = require('../server/sim/space.js');
const Testhilfe = require('./gegner-testhilfe.js');   // SYS-01 C1a-1: Gegner ohne Hülle, Abschuss über den Reaktor
const CONFIG = require('../shared/config.js');
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE setzen)'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HEX = '0505';

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await startServer({ port: PORT, debug: true, roomCode: 'off', quiet: true, worlds: true, worldDir: path.join(TMP, 'worlds') });
  const g = srv.game;
  const b = await chromium.launch();
  const fehler = [];
  try {
    const mk = async (name) => {
      const page = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: DPR })).newPage();
      page.on('pageerror', (e) => fehler.push(name + ' pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error') fehler.push(name + ' console: ' + m.text().slice(0, 200)); });
      await page.goto(`http://127.0.0.1:${PORT}/?debug=1&render=2d`);
      await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
      return page;
    };
    const a = await mk('Ada'); const c = await mk('Bo');
    await a.evaluate(() => { __game.send({ t: 'lobbyOpt', startMission: 'freie_fahrt' }); __game.send({ t: 'ready', ready: true }); });
    await c.evaluate(() => { __game.send({ t: 'ready', ready: true }); });
    await a.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await sleep(500);
    g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;
    const shot = async (page, name, wartMs) => { await sleep(wartMs || 700); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); console.log('Bild', name); };
    const send = (page, o) => page.evaluate((m) => __game.send(m), o);
    const z = () => g.weltsim.zustand;
    g.weltsim.ruf.rom = 50;   // Centurio: der Rangabstieg ist im Bild sichtbar
    z().flotten = z().flotten.filter((f) => f.ort !== HEX);
    await send(a, { t: 'debug', cmd: 'hex', hex: HEX });
    await a.waitForFunction((h) => __game.state && __game.state.ship && __game.state.ship.scene === h, Sektoren.ortVonHex(HEX), { timeout: 8000 }); await sleep(500);
    await send(a, { t: 'debug', cmd: 'sitz', console: 'weapons' }); await send(c, { t: 'debug', cmd: 'sitz', console: 'captain' });
    const rfl = { id: z().naechsteId++, fraktion: 'rom', heimat: '0405', ort: HEX, staerke: 8, kap: 8, befehl: 'rueckzug', ziel: '0405', warte: 0, versorgung: 1, angriff: null };
    z().flotten.push(rfl);
    Szene.debug(g, ['6', 'ger']);
    await sleep(1500);
    // 1) Vorwarnung: Knopf mit Warnung an der Ops; Szenenzeile am Captain
    await shot(a, '01-ops-knopf-verrat-moeglich', 800); await shot(c, '02-captain-szene-vorwarnung', 300);
    await a.waitForFunction(() => __game.state.flotte && __game.state.flotte.sz && __game.state.flotte.sz.p === 'k', null, { timeout: 40000 });
    await sleep(2500);
    await shot(a, '03-ops-kampf-knopf', 300);
    // 2) Anlauf: Fracht-Leiste mit Fortschritt (Ops), Warnzeile (Captain)
    await send(a, { t: 'cmd', c: 'weapons.verrat.beginnen' }); await sleep(600); await shot(a, '03b-ops-bestaetigen', 100); await send(a, { t: 'cmd', c: 'weapons.verrat.beginnen' }); await sleep(3200);
    await shot(a, '04-ops-anlauf-warnung', 100); await shot(c, '05-captain-anlauf-warnzeile', 100);
    // 3) Abbruch kostet nichts
    await send(a, { t: 'cmd', c: 'weapons.fracht', off: true }); await sleep(800);
    await shot(a, '06-ops-abgebrochen-nichts-geschehen', 300);
    console.log('  nach Abbruch: Ruf', g.weltsim.ruf.rom, 'Modus', g.simSzene && g.simSzene.modus);
    // 4) Auslösung
    await send(a, { t: 'cmd', c: 'weapons.verrat.beginnen' }); await sleep(300); await send(a, { t: 'cmd', c: 'weapons.verrat.beginnen' });
    await a.waitForFunction(() => __game.state.flotte && __game.state.flotte.sz && __game.state.flotte.sz.vt === 1, null, { timeout: 15000 });
    await sleep(2500);
    await shot(a, '07-ops-verrat-laeuft', 300); await shot(c, '08-captain-verrat-zeile', 300);
    console.log('  nach Auslösung: Ruf', g.weltsim.ruf.rom, 'Rang', JSON.stringify(g.snapshot().world && g.snapshot().world.ruf), 'Gegner', g.space.enemies.filter((e) => e.verratS).length);
    // 5) Sieg
    for (let i = 0; i < 600 && g.simSzene; i++) { for (const e of g.space.enemies.filter((x) => x.verratS)) { Testhilfe.toeten(g, e); } await sleep(100); }
    await shot(a, '09-ops-sieg-ergebnis', 1200); await shot(c, '10-captain-sieg-ergebnis', 200);
    console.log('  Ergebnis:', JSON.stringify(Szene.letzte(g)).slice(0, 220), 'Ruf', g.weltsim.ruf.rom);
    // 6) ohne Verbündete: kein Knopf
    await sleep(7000);
    await shot(a, '11-ops-danach-kein-knopf', 500);
    void CONFIG;
  } finally {
    await b.close(); await srv.close();
  }
  console.log(fehler.length ? 'Browser-Fehler:\n  ' + fehler.join('\n  ') : 'keine Browser-Fehler');
  console.log('Bilder in ' + SHOTS);
  process.exit(fehler.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
