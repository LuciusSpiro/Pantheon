'use strict';
// Sichtprüfung SUND-04a-2 P2 (Designer-Review): die Bitte eines Fadens in der Antwortleiste (Freie Fahrt Sund, FAEDEN=1). Echter Server im selben Prozess, echter Browser-Client (Playwright, Chromium).
// Angebot am HUD und an den Konsolen (Helm, Captain, Waffen, Technik, Terminal), Porträt in der Plakette, Später (nur zuklappen), Annahme per Mausklick (Knopf der Leiste), Verfall.
// Aufruf: node tools/sicht-bitte.js [--shots <Ordner>] [--port 3491] [--vp 1280x720,1024x600,1920x1080]
// Alle Bilder sind selbst anzusehen (Befunde im Bericht benennen oder beheben); das Skript prüft nur, ob die Seite fehlerfrei läuft und die Bitte erscheint.
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3491');
const SHOTS = arg('shots', path.join(os.tmpdir(), 'sund04a2-p2-shots'));
const VPS = arg('vp', '1280x720,1024x600,1920x1080').split(',').map((s) => s.split('x').map(Number));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-bitte-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
process.env.REISE_EREIGNISSE = '1'; process.env.FAEDEN = '1';
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
const X = require('./faden-fixture.js');
const Faden = require('../server/sim/faden.js');
const D = require('../server/sim/faden-daten.js');
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE setzen)'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VORLAGE = 'test_bitte_sicht';

async function lauf(b, vw, vh, port) {
  X.registriere(X.alsVorlage(VORLAGE, (v) => { v.beats[0].optionen[0].ausgang = 'gelungen'; }));
  const srv = await startServer({ port, debug: true, roomCode: 'off', quiet: true, worlds: true, worldDir: path.join(TMP, 'worlds-' + vw) });
  const g = srv.game;
  const fehler = [];
  const tag = vw + 'x' + vh;
  try {
    const page = await (await b.newContext({ viewport: { width: vw, height: vh } })).newPage();
    page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') fehler.push('console: ' + m.text().slice(0, 200)); });
    await page.goto(`http://127.0.0.1:${port}/?debug=1&render=2d`);
    await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
    await page.evaluate(() => { __game.send({ t: 'lobbyOpt', startMission: 'freie_fahrt' }); __game.send({ t: 'ready', ready: true }); });
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await sleep(500);
    g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;
    // Faden und Bitte am Server (Fixture: Angebot über den Notruf-Hook, Beat per Befehl), der Rest über das Netz
    const a = Faden.ausgangMitPerson(g, { art: 'notruf', id: 'notruf_sicht_' + tag, hex: '0305', sprecher: 'Sprecher', ausgang: 'gelungen' });
    const oe = a ? Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: VORLAGE, parameter: { angebot: a.nr } }) : { ok: false };
    for (let i = 0; i < 6; i++) g.lageGrenze('andocken');
    const we = oe.ok ? Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: oe.faden.id, beat: 'b_bitte' }) : { ok: false };
    if (!we.ok) fehler.push('Bitte startet nicht (Fixture)');
    const shot = async (name, wartMs) => { await sleep(wartMs || 700); await page.screenshot({ path: path.join(SHOTS, tag + '-' + name + '.png') }); console.log('Bild', tag, name); };
    const sitz = async (c) => { await page.evaluate((x) => __game.send({ t: 'debug', cmd: 'sitz', console: x }), c); await sleep(500); };
    const knopf = (label) => page.evaluate((l) => { const b = (Render.ui.buttons || []).find((x) => x.label === l); return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null; }, label);
    const klickKnopf = async (label) => {
      const r = await knopf(label);
      if (!r) { fehler.push('Knopf fehlt: ' + label); return false; }
      const box = await page.locator('#game').boundingBox();
      await page.mouse.click(box.x + (r.x + r.w / 2) * box.width / 640, box.y + (r.y + r.h / 2) * box.height / 360);
      await sleep(400);
      return true;
    };
    const bitte = () => (g.weltsim.faeden && g.weltsim.faeden.bitte) || null;

    // 1. HUD ohne Konsole: die Bitte mit Porträt
    await sitz('');
    await shot('01-hud-bitte', 900);
    console.log('Bitte', bitte() && bitte().optionen.map((o) => o.text), 'Porträt', bitte() && bitte().pid);
    // 2. Konsolen: Steuer (Helm, volle Leiste), Captain, Waffen, Technik, Terminal (Streifen an Bedienflächen)
    for (const c of ['helm', 'captain', 'weapons', 'technik', 'shop']) { await sitz(c); await shot('02-konsole-' + c, 700); }
    await sitz('helm');
    // 3. Später: die Leiste klappt zum Streifen zusammen, ein Klick klappt wieder auf
    if (await klickKnopf('Später')) await shot('03-spaeter-zugeklappt', 500);
    await klickKnopf('Funk antworten');
    await shot('04-wieder-offen', 500);
    // 4. Annahme per Mausklick auf die Option
    const erste = bitte() && bitte().optionen[0].text;
    if (erste) { await klickKnopf(erste); console.log('nach Annahme: Bitte', !!bitte(), 'Haltung', g.weltsim.faeden.liste[0] && g.weltsim.faeden.liste[0].nsc.haltung); }
    await shot('05-nach-annahme', 900);
    await shot('06-faden-wartet', 600);
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
  console.log(alle.length ? 'Fehler:\n  ' + alle.join('\n  ') : 'keine Browser- oder Ablauffehler');
  console.log('Bilder in ' + SHOTS);
  process.exit(alle.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
