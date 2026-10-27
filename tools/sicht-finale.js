// Sichtprüfung SUND-04a-3 Finale-UI: die Karte „Entscheidungsschlacht um Hrafnheim“ im Terminal-Bereich Kurs. Echter Server im selben Prozess, echter Browser-Client (Playwright, Chromium),
// Modus „Freie Fahrt Sund“, Debug-Befehl `finale` (Angebot, Szene als Stub): Angebot (mit drei Absichten), Anfrage („Bestätigen (n s)“), Phase Orbit, Phase Boden, Absage des Servers
// („läuft schon“), nach dem Ablehnen (keine Karte) und die Karte bei Rang unter Tribun (kein Angebot).
// Aufruf: node tools/sicht-finale.js [--shots <Ordner>] [--port 3481] [--vp 1280x720,1920x1080,1024x600]
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3481');
const SHOTS = arg('shots', path.join(os.tmpdir(), 'sund04a3-finale-ui-shots'));
const VPS = arg('vp', '1280x720,1920x1080,1024x600').split(',').map((s) => s.split('x').map(Number));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-finale-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Finale = require('../server/sim/finale.js');
const TRIBUN = require('../content/welt/ruf-werte.json').werte.raenge.wert.find((r) => r.id === require('../content/welt/finale-werte.json').werte.mindestrang.wert).ab;
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE setzen)'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
Finale.ersetzen('szene', { finaleStarten: () => ({ id: 1 }) });   // die Orbit-Szene gehört einem anderen Paket: hier genügt ein Stub, das Terminal soll nur die Phase zeigen
Finale.ersetzen('boden', { bodenStarten: () => true });
Finale.ersetzen('abspann', { beenden: () => true });

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
    const zustand = () => page.evaluate(() => ({ finale: window.Finale && Finale.modell(), antwort: TerminalUI.zustand.antwort && TerminalUI.zustand.antwort.text }));

    // 1. Terminal vor Tribun: Bereich Kurs ohne Karte
    await ruf(0);
    await sitz('shop'); await sleep(900); await taste('KeyK'); await shot('finale-00-vor-tribun', 500);
    // 2. Tribun, ein Sprung: das Angebot kommt (Funk), die Karte steht rechts neben den Absichten
    await ruf(TRIBUN); await sleep(300); tick(); await sleep(600);
    if (g.weltsim.absicht.angebot) { g.weltsim.absicht.angebot.ids = ['verteidigung', 'offensive', 'ausgreifen']; g.sentAbsichtKey = null; }
    await shot('finale-01-angebot', 900);
    console.log(tag, 'Modell Angebot:', JSON.stringify((await zustand()).finale));
    // 3. Anfrage (E): Knopf „Bestätigen (n s)“, doppelter Rahmen, Frist als Leiste
    await taste('KeyE'); await shot('finale-02-anfrage', 600);
    await sleep(5000); await shot('finale-03-anfrage-spaeter', 200);
    console.log(tag, 'Modell Anfrage:', JSON.stringify(await zustand()));
    // 4. Bestätigen (E): Phase Orbit, keine Knöpfe
    await taste('KeyE'); await shot('finale-04-laeuft-orbit', 900);
    console.log(tag, 'Modell läuft:', JSON.stringify(await zustand()));
    // 5. Taste während des Finales: nichts passiert
    await taste('KeyE'); await taste('KeyN'); await shot('finale-05-laeuft-tasten-ohne-wirkung', 400);
    // 6. Boden
    Finale.orbitEnde(g, 'sieg'); await shot('finale-06-laeuft-boden', 900);
    // 7. Niederlage: Neubeginn, Angebot wieder da; Absichten mit zwei Karten
    Finale.bodenEnde(g, 'crew_gefallen'); await sleep(300); tick();
    if (g.weltsim.absicht.angebot) { g.weltsim.absicht.angebot.ids = ['bereitschaft', 'verteidigung']; g.sentAbsichtKey = null; }
    await shot('finale-07-neubeginn-angebot-zwei-absichten', 900);
    // 8. Ablehnen (N): keine Karte
    await taste('KeyN'); await shot('finale-08-abgelehnt', 900);
    // 9. Zweiter Spieler bestätigt zuerst: die Absage an den Ersten („läuft schon“) steht in der Infozeile
    Finale.debug(g, ['angebot']); await sleep(500);
    await taste('KeyE'); await sleep(700);
    await page.evaluate(() => { window.__alt = { f: JSON.parse(JSON.stringify(Finale.store.finale)), t: Finale.store.anfrageStart }; });
    const ersterBestaetigt = Finale.bestaetigen(g); console.log(tag, 'Mitspieler bestätigt zuerst:', ersterBestaetigt === null ? 'ok' : JSON.stringify(ersterBestaetigt));
    await sleep(500);
    await page.evaluate(() => { const a = window.__alt; Finale.store.finale = Object.assign({}, a.f, { phase: undefined, angebot: 1, anfrage: 20 }); Finale.store.anfrageStart = performance.now(); });   // der Client hat den neuen Block noch nicht (Latenz)
    await taste('KeyE'); await shot('finale-09-absage-laeuft-schon', 700);
    console.log(tag, 'Antwort:', JSON.stringify(await zustand()));
    // Ende des Modus: Löschsignal, kein Kurs mehr
    const ws = g.weltsim; g.weltsim = null; await shot('finale-10-modus-ende', 1200); g.weltsim = ws;
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
