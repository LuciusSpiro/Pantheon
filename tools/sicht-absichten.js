// Sichtprüfung SUND-02b D (Designer-Review): der Terminal-Bereich „Lage“ (Absichten von Rom) und der Lagefunk. Echter Server im selben Prozess, echter Browser-Client (Playwright, Chromium),
// Modus „Freie Fahrt Sund“: vor Tribun (Knopf gedimmt, Hinweis), Angebot (2–3 Karten, Auswahl), laufende Absicht, nach dem Ablauf, „Schon gewählt“, Ende des Modus (Löschsignal); dazu der Funk-Reiter des Captains.
// Aufruf: node tools/sicht-absichten.js [--shots <Ordner>] [--port 3471] [--vp 1280x720,1920x1080,1024x600]
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3471');
const SHOTS = arg('shots', path.join(os.tmpdir(), 'sund02b-d-shots'));
const VPS = arg('vp', '1280x720,1920x1080,1024x600').split(',').map((s) => s.split('x').map(Number));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-absichten-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Absicht = require('../server/sim/absicht.js');
const W = require('../content/welt/absichten.json').werte;
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE setzen)'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lauf(b, vw, vh, port) {
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
    const shot = async (name, wartMs) => { await sleep(wartMs || 700); await page.screenshot({ path: path.join(SHOTS, tag + '-' + name + '.png') }); console.log('Bild', tag, name); };
    const send = (o) => page.evaluate((m) => __game.send(m), o);
    const sitz = (c) => send({ t: 'debug', cmd: 'sitz', console: c });
    const ruf = (w) => send({ t: 'debug', cmd: 'ruf', args: 'rom ' + w });
    const taste = async (code) => { await page.keyboard.press(code); await sleep(300); };
    const tick = (k) => { for (let i = 0; i < (k || 1); i++) Kriegslage.tick(g, 'sicht'); };
    const TRIBUN = require('../content/welt/ruf-werte.json').werte.raenge.wert.find((r) => r.id === W.mindestrang.wert).ab;

    // 1. Terminal vor Tribun: der Lage-Knopf ist gedimmt, der Bereich nennt den Rang
    await ruf(0);
    await sitz('shop'); await sleep(900); await shot('lage-00-werft-lage-knopf-gedimmt', 500);
    await taste('KeyK'); await shot('lage-01-vor-tribun', 500);
    // 2. Tribun, ein Sprung: das Angebot kommt (Funk)
    await ruf(TRIBUN); await sleep(300); tick();
    await shot('lage-02-angebot', 900);
    await taste('ArrowDown'); await shot('lage-03-zweite-karte-gewaehlt', 600);
    // Funk-Reiter des Captains: der Angebots-Funk
    await sitz('captain'); await sleep(500); await taste('Digit1'); await shot('cap-funk-angebot', 800);
    await sitz('shop'); await sleep(700); await taste('KeyK');
    await shot('lage-04-angebot-wieder', 600);
    // 3. Annehmen
    await taste('Enter'); await shot('lage-05-laeuft', 900);
    tick(5); await shot('lage-06-laeuft-rest', 900);
    await ruf(0); await sleep(300); tick(1); await shot('lage-06b-laeuft-nach-rangverlust', 900);
    await ruf(TRIBUN); await sleep(300);
    // Absage: ein zweiter Versuch (die UI zeigt „läuft“, Enter tut nichts); „Schon gewählt“ kommt vom Server, wenn jemand schneller war: Stand nachstellen
    // 4. Ablauf: keine Frage
    const rest = g.weltsim.absicht.laufend ? g.weltsim.absicht.laufend.bis - g.weltsim.tickZahl : 0; tick(rest);
    await shot('lage-07-nach-ablauf-keine-frage', 900);
    // 5. Pause vorbei: neues Angebot, ablehnen
    tick(W.abstand_nach_ablauf.wert);
    await shot('lage-08-neues-angebot', 900);
    // alle vier Absichten mit ihren Texten: ein Angebot mit drei Karten (Belagerung, Stärke) und eines mit der vierten
    if (g.weltsim.absicht.angebot) { g.weltsim.absicht.angebot.ids = ['verteidigung', 'offensive', 'ausgreifen']; await sleep(300); tick(0); g.sentAbsichtKey = null; await shot('lage-08b-drei-karten', 900); g.weltsim.absicht.angebot.ids = ['bereitschaft', 'verteidigung']; g.sentAbsichtKey = null; await shot('lage-08c-bereitschaft-verteidigung', 900); }
    await taste('KeyX'); await shot('lage-09-abgelehnt', 900);
    // 6. „Schon gewählt“: ein Mitspieler war schneller, die Anzeige zeigt noch das Angebot (Server wählt, die UI schickt dann ihre Wahl)
    tick(W.abstand_nach_verfall.wert);
    await sleep(700);
    const ids = g.weltsim.absicht.angebot ? g.weltsim.absicht.angebot.ids : [];
    await page.evaluate(() => { window.__angebotAlt = JSON.parse(JSON.stringify(Absicht.store.absicht)); });
    Absicht.waehlen(g, ids[ids.length - 1]);                       // der andere war schneller
    await sleep(300);
    await page.evaluate(() => { Absicht.store.absicht = window.__angebotAlt; });   // der Client hat den neuen Block noch nicht (Latenz)
    await taste('Enter'); await shot('lage-10-schon-gewaehlt', 700);
    // Ende des Modus: Löschsignal, der Knopf verschwindet
    const ws = g.weltsim; g.weltsim = null; await shot('lage-11-modus-ende-ohne-knopf', 1200); g.weltsim = ws;
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
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
