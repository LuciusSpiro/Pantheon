// Sichtprüfung SUND-02b UI2 (Designer-Review A2, D, E): echter Server im selben Prozess, VIER echte Browser-Clients (Playwright, Chromium), Modus „Freie Fahrt Sund“:
// Ada an der Ops, Bo am Captain-Platz, Cy an der Steuer, Di am Terminal (Zuschauer der Warnungen). Je Bildschirmgröße: Verrat (Knopf, Anfrage „Bestätigen“, Anlauf mit Warnung an allen
// Plätzen, Szene mit den Namen der ehemaligen Verbündeten, Sieg, Weigerung an der Hauptwelt), Posten gründen und ausbauen, Posten angreifen (Anlauf, Szenenzeile, Sieg), Übersichtskarte mit
// Anspruch/Stützpunkt/gesprengtem Posten, Terminal (Handel, Werft, Kurs).
// Aufruf: node tools/sicht-ui2.js [--shots <Ordner>] [--port 3481] [--vp 1280x720,1920x1080,1024x600]      (Bilder nicht im Repo, Standard: Temp-Ordner)
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3481');
const SHOTS = arg('shots', path.join(os.tmpdir(), 'sund02b-ui2-shots'));
const VPS = arg('vp', '1280x720,1920x1080,1024x600').split(',').map((s) => s.split('x').map(Number));
const NUR = arg('nur', '');   // Teilmenge: verrat,posten,sprengen,terminal
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-ui2-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
const Sektoren = require('../shared/sektoren.js');
const Locations = require('../shared/locations.js');
const Besitz = require('../server/sim/besitz.js');
const Szene = require('../server/sim/kriegslage-szene.js');
const Space = require('../server/sim/space.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const PW = require('../content/welt/posten-werte.json').werte;
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE setzen)'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const teil = (n) => !NUR || NUR.split(',').includes(n);

async function lauf(b, vw, vh, port) {
  const srv = await startServer({ port, debug: true, roomCode: 'off', quiet: true, worlds: true, worldDir: path.join(TMP, 'worlds-' + vw) });
  const g = srv.game;
  const fehler = [];
  const tag = vw + 'x' + vh;
  try {
    const mk = async (name) => {
      const page = await (await b.newContext({ viewport: { width: vw, height: vh } })).newPage();
      page.on('pageerror', (e) => fehler.push(name + ' pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error') fehler.push(name + ' console: ' + m.text().slice(0, 200)); });
      await page.goto(`http://127.0.0.1:${port}/?debug=1&render=2d`);
      await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
      return page;
    };
    const ops = await mk('Ada'), cap = await mk('Bo'), helm = await mk('Cy'), term = await mk('Di');
    await ops.evaluate(() => { __game.send({ t: 'lobbyOpt', startMission: 'freie_fahrt' }); __game.send({ t: 'ready', ready: true }); });
    for (const p of [cap, helm, term]) await p.evaluate(() => { __game.send({ t: 'ready', ready: true }); });
    await ops.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await sleep(500);
    g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;
    const shot = async (page, name, wartMs) => { await sleep(wartMs || 600); await page.screenshot({ path: path.join(SHOTS, tag + '-' + name + '.png') }); console.log('Bild', tag, name); };
    const send = (page, o) => page.evaluate((m) => __game.send(m), o);
    const sitz = (page, c) => send(page, { t: 'debug', cmd: 'sitz', console: c });
    const hin = async (hex) => { await send(ops, { t: 'debug', cmd: 'hex', hex }); await ops.waitForFunction((h) => __game.state && __game.state.ship && __game.state.ship.scene === h, Sektoren.ortVonHex(hex), { timeout: 8000 }); await sleep(500); };
    const anPosten = (hex) => { const p = Besitz.postenLage(Locations.get(Sektoren.ortVonHex(hex)).scene); Object.assign(g.ship, { x: p.x, y: p.y, vx: 0, vy: 0, speed: 0 }); g.ship.helm.stage = 1; };
    const plaetze = async () => { await sitz(ops, 'weapons'); await sitz(cap, 'captain'); await sitz(helm, 'helm'); await sitz(term, 'shop'); await sleep(400); };
    const z = () => g.weltsim.zustand;
    const siegen = async (filter) => { for (let i = 0; i < 600 && g.simSzene; i++) { for (const e of g.space.enemies.filter(filter || (() => true))) { e.hp = 1; Space.damageEnemy(g, e, 500, e.x - 100, e.y, {}); } await sleep(100); } };
    g.inventory.ersatzteil = 6;

    if (teil('verrat')) {
      // ---- E: Verrat an 0505 mit römischer Flotte im Hex
      const HEX = '0505';
      g.weltsim.ruf.rom = 50;
      z().flotten = z().flotten.filter((f) => f.ort !== HEX);
      await hin(HEX); await plaetze();
      z().flotten.push({ id: z().naechsteId++, fraktion: 'rom', heimat: '0405', ort: HEX, staerke: 8, kap: 8, befehl: 'rueckzug', ziel: '0405', warte: 0, versorgung: 1, angriff: null });
      Szene.debug(g, ['6', 'ger']);
      await sleep(1500);
      await shot(ops, 'e01-ops-vorwarnung-knopf', 600); await shot(cap, 'e02-captain-vorwarnung', 100); await shot(helm, 'e02b-steuer-vorwarnung', 100);
      await ops.waitForFunction(() => __game.state.flotte && __game.state.flotte.sz && __game.state.flotte.sz.p === 'k', null, { timeout: 40000 });
      await sleep(2000);
      await shot(ops, 'e03-ops-kampf-knopf', 200);
      await send(ops, { t: 'cmd', c: 'weapons.verrat.beginnen' }); await sleep(500);
      await shot(ops, 'e04-ops-anfrage-bestaetigen', 100); await shot(cap, 'e04b-captain-anfrage', 100); await shot(term, 'e04c-terminal-anfrage', 100);
      await send(ops, { t: 'cmd', c: 'weapons.verrat.beginnen' }); await sleep(2500);
      await shot(ops, 'e05-ops-anlauf', 100); await shot(cap, 'e06-captain-anlauf', 100); await shot(term, 'e08-terminal-anlauf', 100);
      { const ge = g.space.enemies[0]; if (ge) ge.tele = { left: 2.6, dur: 3, sector: 1, kind: 'heavy' }; }   // AUSWEICHEN-Warnung an der Steuer unter der Szenenzeile
      await shot(helm, 'e07-steuer-anlauf-ausweichen', 150);
      await send(ops, { t: 'cmd', c: 'weapons.fracht', off: true }); await sleep(700);
      await shot(ops, 'e09-ops-abgebrochen', 200); await shot(cap, 'e09b-captain-abgebrochen', 100);
      await send(ops, { t: 'cmd', c: 'weapons.verrat.beginnen' }); await sleep(300); await send(ops, { t: 'cmd', c: 'weapons.verrat.beginnen' });
      await ops.waitForFunction(() => __game.state.flotte && __game.state.flotte.sz && __game.state.flotte.sz.vt === 1, null, { timeout: 15000 });
      await sleep(2500);
      await shot(ops, 'e10-ops-verrat-laeuft', 200); await shot(cap, 'e11-captain-verrat', 100); await shot(helm, 'e12-steuer-verrat', 100); await shot(term, 'e12b-terminal-verrat', 100);
      await siegen((x) => x.verratS);
      await shot(ops, 'e13-ops-sieg', 1000); await shot(cap, 'e14-captain-sieg', 100);
      await sleep(7000);
      // Weigerung an der Hauptwelt Palatina: römische Flotte und Szene dort
      const PAL = '0204';
      await hin(PAL); await plaetze();
      z().flotten.push({ id: z().naechsteId++, fraktion: 'rom', heimat: PAL, ort: PAL, staerke: 8, kap: 8, befehl: 'rueckzug', ziel: PAL, warte: 0, versorgung: 1, angriff: null });
      try { Szene.debug(g, ['6', 'ger']); } catch (e) { console.log('  Szene Palatina:', e.message); }
      await sleep(2500);
      await shot(ops, 'e15-ops-weigerung-hauptwelt', 300);
      if (g.simSzene) { await siegen(); await sleep(7000); }
    }

    if (teil('posten')) {
      // ---- A1: Posten gründen an 0505, Ausbau an 0503
      g.weltsim.ruf.rom = 0;
      await hin('0505'); await plaetze(); anPosten('0505');
      await shot(ops, 'a01-ops-gruenden-moeglich', 900);
      Object.assign(g.ship, { x: g.ship.x + 800 }); await shot(ops, 'a02-ops-gruenden-zu-weit', 700); anPosten('0505');
      await send(ops, { t: 'cmd', c: 'weapons.posten.gruenden' }); await sleep(4000); await shot(ops, 'a03-ops-gruendung-laeuft', 100);
      await ops.waitForFunction(() => !(__game.state.fracht && __game.state.fracht.halt), null, { timeout: 15000 }); await shot(ops, 'a04-ops-posten-steht', 1000);
      const nd = z().hexe['0503']; Object.assign(nd, { posten: true, besitzer: 'rom', garnison: 3 }); Kriegslage.szeneAbschliessen(g, { wirkungen: [], wo: 'sicht' });
      await hin('0503'); await plaetze(); anPosten('0503'); await shot(ops, 'a05-ops-ausbau-rang-fehlt', 900);
      g.weltsim.ruf.rom = 30; await shot(ops, 'a06-ops-ausbau-moeglich', 900);
    }

    if (teil('sprengen')) {
      // ---- A2: germanischer Posten 0703 angreifen
      const GER1 = '0703';
      g.weltsim.ruf.rom = 30;
      Object.assign(z().hexe[GER1], { besitzer: 'ger', posten: true, garnison: 4, anspruch: {} }); z().flotten = z().flotten.filter((f) => f.ort !== GER1);
      g.weltBesitz.hexe[GER1] = { besitzer: 'ger', posten: true };
      PW.angreifen.wert.vorlauf = 12;
      await hin(GER1); await plaetze(); anPosten(GER1);
      await shot(ops, 'x01-ops-angreifen-moeglich', 900);
      await send(ops, { t: 'cmd', c: 'weapons.posten.angreifen' }); await sleep(4000); await shot(ops, 'x02-ops-anlauf', 100);
      await ops.waitForFunction(() => __game.state.flotte && __game.state.flotte.sz && __game.state.flotte.sz.p === 'v', null, { timeout: 20000 });
      await shot(ops, 'x03-ops-vorwarnung', 800); await shot(cap, 'x04-captain-vorwarnung', 100); await shot(helm, 'x05-steuer-vorwarnung', 100); await shot(term, 'x05b-terminal-vorwarnung', 100);
      await ops.waitForFunction(() => __game.state.flotte && __game.state.flotte.sz && __game.state.flotte.sz.p === 'k', null, { timeout: 30000 });
      await sleep(2500);
      await shot(ops, 'x06-ops-kampf-welle', 100); await shot(cap, 'x07-captain-kampf-welle', 100); await shot(helm, 'x08-steuer-kampf-welle', 100);
      await siegen();
      await shot(ops, 'x09-ops-sieg', 1000); await shot(cap, 'x10-captain-sieg', 100);
      await sleep(7000);
      await cap.keyboard.press('Digit2'); await sleep(900); await shot(cap, 'x11-karte-gesprengt-anspruch-stuetzpunkt', 500);
      await cap.keyboard.press('Digit1'); await sleep(300);
    }

    if (teil('terminal')) {
      // ---- Terminal: Werft, Handel, Kurs (Tribun mit Angebot)
      await send(ops, { t: 'debug', cmd: 'goto', loc: Sektoren.ortVonHex('0405'), docked: true }); await sleep(1200); await plaetze();
      await send(ops, { t: 'debug', cmd: 'ruf', args: 'rom 82' }); await sleep(300); Kriegslage.tick(g, 'sicht');
      await sleep(800);
      await shot(term, 't01-terminal-start', 500);
      await term.keyboard.press('KeyH'); await shot(term, 't02-terminal-handel', 600);
      await term.keyboard.press('KeyW'); await shot(term, 't03-terminal-werft', 600);
      await term.keyboard.press('KeyK'); await shot(term, 't04-terminal-kurs', 600);
      await shot(cap, 't05-captain-funk-angebot', 100); await shot(ops, 't06-ops-ticker', 100);
    }
  } finally {
    await srv.close();
  }
  return fehler;
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const b = await chromium.launch();
  const alle = [];
  try {
    let port = PORT;
    for (const [w, h] of VPS) { const f = await lauf(b, w, h, port++); alle.push(...f.map((x) => w + 'x' + h + ' ' + x)); }
  } finally { await b.close(); }
  console.log(alle.length ? 'Browser-Fehler:\n  ' + alle.join('\n  ') : 'keine Browser-Fehler');
  console.log('Bilder in ' + SHOTS);
  process.exit(alle.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
