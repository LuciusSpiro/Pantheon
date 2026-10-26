// Sichtpruefung SUND-04a-3: Abspaenne der Freien Fahrt Sund (Palatina faellt, Sieg) mit Schlusszeile. Echter Server im selben Prozess, echter Browser-Client (Playwright, Chromium),
// Debug-Befehl `abspann palatina|sieg`. Je Abspann ein karger Zustand (Miles, nichts verloren, keine Faeden) und ein voller (Tribun, Haefen verloren, Gefallene, Faeden-Ausgaenge);
// je Bild der Anfang (die Zeilen laufen von unten ein) und das Ende (die Liste steht, Bilanz und Schluss muessen sichtbar sein). Am Ende: Enter fuehrt in die Lobby.
// Aufruf: node tools/sicht-abspann.js [--shots <Ordner>] [--port 3471] [--vp 1280x720,1920x1080,1024x600]
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3471');
const SHOTS = arg('shots', path.join(os.tmpdir(), 'sund04a3-abspann-shots'));
const VPS = arg('vp', '1280x720,1920x1080,1024x600').split(',').map((s) => s.split('x').map(Number));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-abspann-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE setzen)'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KARG = () => {};
const VOLL = (g) => {
  const ws = g.weltsim, z = ws.zustand;
  ws.ruf.rom = 60;   // Tribun
  z.hexe['0105'].besitzer = 'ger'; z.hexe['0203'].besitzer = 'ger';   // zwei Haefen verloren
  ws.kommandanten = { Aulus: { fraktion: 'ger', schicksal: 'gefallen', begegnungen: 1, tick: 1 } };
  ws.faeden.liste = [
    { vorlage: 'falscher_haendler', ausgang: { art: 'gescheitert', status: 'aktiv', tick: 3 } },
    { vorlage: 'entfuehrter_haendler', ausgang: { art: 'gelungen', status: 'verbuendet', tick: 5 } },
    { vorlage: 'dankbarer_captain', ausgang: { art: 'gelungen', status: 'verbuendet', tick: 7 } },
  ];
  ws.chronik = [{ t: 4, art: 'posten', ref: '0505', kurz: 'Posten gefallen: Brachland an ger' }];
  g.weltstand.fact('finale_gespielt', true, 'sicht');
  g.saveWorld = () => ({ ok: true });   // die Faden-Fixtures oben sind nicht schemagueltig (nur das Gesamtbild zaehlt): kein Speichern in der Sichtpruefung
};
const FAELLE = [
  ['palatina-karg', 'palatina', KARG], ['palatina-voll', 'palatina', VOLL],
  ['sieg-karg', 'sieg', KARG], ['sieg-voll', 'sieg', VOLL],
];

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
    const shot = async (name, wartMs) => { await sleep(wartMs || 600); await page.screenshot({ path: path.join(SHOTS, tag + '-' + name + '.png') }); console.log('Bild', tag, name); };
    const send = (o) => page.evaluate((m) => __game.send(m), o);
    for (const [name, art, zustand] of FAELLE) {
      await send({ t: 'lobbyOpt', startMission: 'freie_fahrt' }); await send({ t: 'ready', ready: true });
      await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby' && __game.state.phase !== 'end', null, { timeout: 30000 });
      await sleep(600);
      zustand(g);
      await page.evaluate(() => { if (window.Hud) window.Hud.abspannKey = null; });   // gleicher Titel wie im Fall davor: die Laufzeit des Abspanns neu beginnen
      await send({ t: 'debug', cmd: 'abspann', args: art });
      await page.waitForFunction(() => __game.state && __game.state.phase === 'end' && __game.state.abspann, null, { timeout: 8000 });
      const ab = await page.evaluate(() => __game.state.abspann);
      console.log(`  ${name}: ${ab.bloecke.length} Bloecke, Schluss: ${ab.schluss}`);
      await shot(name + '-1-anfang', 5500);
      await page.evaluate(() => { if (window.Hud) window.Hud.abspannT0 -= 300; });   // die Liste ist durchgelaufen
      await shot(name + '-2-ende', 700);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => __game.state && __game.state.phase === 'lobby', null, { timeout: 8000 });
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
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
