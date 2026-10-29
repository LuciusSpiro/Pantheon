// Sichtprüfung SUND-04b D: das Auftragsbrett im ECHTEN Spiel. Echter Server im selben Prozess (FAEDEN=1, Lage-Spielleiter als Mock, die Angebote sind die Standard-Pläne aus content/faeden/anschluss.json),
// echter Browser-Client (Playwright, Chromium), Modus „Freie Fahrt Sund“: Brett mit drei Angeboten (jedes gewählt), Annahme per Taste (laufend, ANGENOMMEN), zweite Antwort (schon_beantwortet),
// Flug-HUD mit dem Streifen, Ablehnen (leise), leeres Brett mit laufendem Abenteuer, Hilfe. Zuschauer und Mehrspieler prüft tools/test-brett-ui.js (Node, echter Server), nicht dieses Skript.
// Aufruf: node tools/sicht-brett.js [--shots <Ordner>] [--port 3511] [--vp 1280x720,1024x600]   (Standard-Ordner: vault/Pantheon/Mockups/SUND-04b/shots, Dateien mit Präfix „spiel-“, nichts anderes wird angefasst)
// Exit 1 bei Seitenfehlern (pageerror, console error) oder fehlendem Zustand, 2 ohne Playwright.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3511');
const SHOTS = path.resolve(arg('shots', 'C:/Users/Luciu/projects/brain/vault/Pantheon/Mockups/SUND-04b/shots'));
const VPS = arg('vp', '1280x720,1024x600').split(',').map((s) => s.split('x').map(Number));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-brett-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
process.env.FAEDEN = '1'; process.env.LAGE_SPIELLEITER = '1'; process.env.SPIELLEITER_LLM = 'mock'; process.env.ABENTEUER_ANSCHLUSS = '0';
delete process.env.LLM_LIVE;
const { startServer } = require('../server/index.js');
const Sektoren = require('../shared/sektoren.js');
const Space = require('../server/sim/space.js');
const Faden = require('../server/sim/faden.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const ANSCHLUSS = require('../content/faeden/anschluss.json').plaene;
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('Playwright fehlt'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const klon = (x) => JSON.parse(JSON.stringify(x));

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
    g.env.FAEDEN = '1'; g.env.ABENTEUER_ANSCHLUSS = '0';
    g.lageSpielleiter = LS.create(g, { llm: LLM.create({ mode: 'mock' }), werte: { min_abstand_ticks: 1, deckel_je_sitzung: 0 }, abenteuerWerte: { deckel_je_sitzung: 0 } });
    g.lageSchalter = true;
    const shot = async (name, wartMs) => { await sleep(wartMs || 700); await page.screenshot({ path: path.join(SHOTS, 'spiel-' + tag + '-' + name + '.png') }); console.log('Bild', tag, name); };
    const send = (o) => page.evaluate((m) => __game.send(m), o);
    const sitz = (c) => send({ t: 'debug', cmd: 'sitz', console: c });
    const taste = async (code) => { await page.keyboard.press(code); await sleep(450); };
    const dock = (hex) => { Space.enterScene(g, Sektoren.ortVonHex(hex), {}); Object.assign(g.ship, { docked: true, dockedAt: Sektoren.ortVonHex(hex), vx: 0, vy: 0, speed: 0 }); };
    const zust = () => page.evaluate(() => ({ bereich: window.TerminalUI && TerminalUI.bereichJetzt, modell: window.Brett && Brett.modell(), antwort: window.TerminalUI && TerminalUI.zustand.antwort && TerminalUI.zustand.antwort.code }));

    dock('0305'); g.inventory.marks = 500;
    // drei Angebote aus den Standard-Plänen (Konvoi, Geleit, Gerücht), der Server baut die Vorschau
    let n = 0;
    for (const i of [2, 3, 0, 1, 4, 5]) { if (n >= 3) break; const r = Faden.abenteuerAnbieten(g, klon(ANSCHLUSS[i]), { hex: '0305' }); if (r.ok) n++; }
    if (n < 3) fehler.push('nur ' + n + ' Angebote angelegt');
    await sitz('shop'); await sleep(1000);
    await taste('KeyO'); await sleep(500);
    let z = await zust();
    if (z.bereich !== 'brett' || !z.modell || z.modell.angebote.length !== 3) fehler.push('Brett nicht offen oder keine 3 Angebote: ' + JSON.stringify(z).slice(0, 200));
    await shot('01-drei-angebote', 700);
    await taste('ArrowDown'); await shot('02-zweites-angebot', 500);
    await taste('Digit3'); await shot('03-drittes-angebot', 500);
    await taste('Digit1');
    // zweite Antwort: zwei Annahmen unmittelbar hintereinander (die zweite kommt dem Server zuvor, ehe der Snapshot da ist)
    await page.evaluate(() => { const id = Brett.modell().angebote[0].id; __game.send({ t: 'cmd', c: 'abenteuer.annehmen', id }); __game.send({ t: 'cmd', c: 'abenteuer.annehmen', id }); });
    await sleep(1200);
    z = await zust();
    if (!z.modell || !z.modell.laufend) fehler.push('Annahme: kein laufendes Abenteuer im Snapshot');
    if (z.antwort !== 'schon_beantwortet') fehler.push('zweite Antwort: Code ' + z.antwort + ' statt schon_beantwortet');
    await shot('04-laeuft-und-zweite-antwort', 400);
    await taste('KeyW'); await taste('KeyO'); await sleep(2200); await shot('05-laeuft-angenommen', 300);
    // Ablehnen (leise): X lehnt das gewählte Angebot ab
    const vor = (await zust()).modell.angebote.length;
    await taste('KeyX'); await sleep(900);
    z = await zust();
    if (z.modell.angebote.length !== vor - 1) fehler.push('Ablehnen: ' + vor + ' -> ' + z.modell.angebote.length);
    await shot('06-abgelehnt-leise', 300);
    await taste('KeyX'); await sleep(900); await shot('07-nur-laufendes-und-ein-angebot', 300);
    await taste('KeyX'); await sleep(900); await shot('08-nur-laufendes', 300);
    // Flug-HUD: das Terminal verlassen (Esc), der Streifen steht unter den Zielen
    await taste('Escape'); await sleep(900); await shot('09-hud-streifen', 400);
    // Tastenhilfe im Terminal
    await sitz('shop'); await sleep(900); await taste('Shift+Slash'); await shot('10-hilfe', 500);
    await taste('Shift+Slash');
  } finally {
    try { if (srv.close) srv.close(); } catch (e) { /* der Prozess endet am Schluss mit process.exit */ }
  }
  return fehler;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const b = await chromium.launch();
  const alle = [];
  try {
    let port = PORT;
    for (const [vw, vh] of VPS) alle.push(...(await lauf(b, vw, vh, port++)));
  } finally { await b.close(); }
  if (alle.length) { console.log('Fehler:\n' + [...new Set(alle)].join('\n')); process.exit(1); }
  console.log('Keine Seitenfehler, Zustände wie erwartet.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
