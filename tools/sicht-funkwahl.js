// Sichtprüfung SUND-03b A (Designer-Review): die Antwortleiste am Funk (Funk-Antworten mit Folgen, Freie Fahrt Sund mit Reise-Ereignissen). Echter Server im selben Prozess, echter Browser-Client
// (Playwright, Chromium): Angebot im HUD und an jeder Konsole (Steuer, Captain, Ops, Technik, Terminal), Markierung per Taste, Antwort per Mausklick, Reaktion des Sprechers, „Nicht antworten“,
// Havarie-Angebot mit drei Optionen, Verfall. Aufruf: node tools/sicht-funkwahl.js [--shots <Ordner>] [--port 3481] [--vp 1280x720,1920x1080,1024x600] [--debug 1]
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3481');
const SHOTS = arg('shots', path.join(os.tmpdir(), 'sund03b-a-shots'));
const VPS = arg('vp', '1280x720').split(',').map((s) => s.split('x').map(Number));
const DEBUG = arg('debug', '0') === '1';   // Nacharbeit SUND-04a-2: Standard ist der Client OHNE ?debug=1 (so sieht der Spieler Zeile und Streifen); mit --debug 1 der Debug-Modus (x 404, 232 breit)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-funkwahl-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
process.env.REISE_EREIGNISSE = '1';
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
const Sektoren = require('../shared/sektoren.js');
const Sprung = require('../server/sim/sprung.js');
const RE = require('../server/sim/reise-ereignis.js');
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE setzen)'); process.exit(1); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KAT = RE.KATALOG;
function nur(ids, fn) { const kopie = KAT.slice(); KAT.length = 0; for (const e of kopie) if (ids.includes(e.id)) KAT.push(e); try { return fn(); } finally { KAT.length = 0; KAT.push(...kopie); } }
function sicher(fn) { const alt = RE.WERTE.wahrscheinlichkeit; RE.WERTE.wahrscheinlichkeit = 1; try { return fn(); } finally { RE.WERTE.wahrscheinlichkeit = alt; } }

async function lauf(b, vw, vh, port) {
  const srv = await startServer({ port, debug: true, roomCode: 'off', quiet: true, worlds: true, worldDir: path.join(TMP, 'worlds-' + vw) });
  const g = srv.game;
  const fehler = [];
  const tag = vw + 'x' + vh;
  try {
    const page = await (await b.newContext({ viewport: { width: vw, height: vh } })).newPage();
    page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') fehler.push('console: ' + m.text().slice(0, 200)); });
    await page.goto(`http://127.0.0.1:${port}/?${DEBUG ? 'debug=1&' : ''}render=2d`);
    await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
    await page.evaluate(() => { __game.send({ t: 'lobbyOpt', startMission: 'freie_fahrt' }); __game.send({ t: 'ready', ready: true }); });
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await sleep(500);
    g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;
    const shot = async (name, wartMs) => { await sleep(wartMs || 700); await page.screenshot({ path: path.join(SHOTS, tag + '-' + name + '.png') }); console.log('Bild', tag, name); };
    const sitz = async (c) => { await page.evaluate((x) => __game.send({ t: 'debug', cmd: 'sitz', console: x }), c); await sleep(500); };
    const taste = async (code, mod) => { if (mod) await page.keyboard.down(mod); await page.keyboard.press(code); if (mod) await page.keyboard.up(mod); await sleep(300); };
    const springe = (id, hex) => { g.weltsim.zustand.flotten = []; g.space.enemies = []; g.weltsim.reise.letzter = null; g.weltsim.reise.letzte = []; return nur([].concat(id), () => sicher(() => Sprung.springeNach(g, Sektoren.ortVonHex(hex)))); };
    const angebot = () => (g.weltsim.funkwahl && g.weltsim.funkwahl.offen) || null;
    const klick = async (x, y) => { const box = await page.locator('#game').boundingBox(); await page.mouse.click(box.x + x * box.width / 640, box.y + y * box.height / 360); await sleep(400); };

    // 1. HUD (keine Konsole): Streife mit zwei Optionen
    await sitz('');   // ohne Konsole: bleibt an Bord
    springe('patrouille_rom_gruss', '0305');
    console.log('Angebot', angebot() && angebot().optionen.map((o) => o.text));
    await shot('01-hud-streife', 900);
    // 2. Konsolen
    for (const c of ['helm', 'captain', 'weapons', 'technik', 'shop']) { await sitz(c); await shot('02-konsole-' + c, 700); }
    await sitz('helm');
    // 3. Taste markiert (Punkt), Umschalt+Punkt sendet; vorher Maus-Hover
    await taste('Period'); await shot('03-markiert-1', 400);
    await taste('Period'); await shot('03-markiert-2', 400);
    await taste('Period'); await shot('03-markiert-ignorieren', 400);
    await taste('Period');   // zurück auf Option 1
    await taste('Period', 'Shift'); await shot('04-nach-senden-antwort-der-crew', 800);
    await shot('05-reaktion-des-sprechers', 3500);
    console.log('Ruf', g.weltsim.ruf);
    // 4. Havarie mit Mausklick auf „Nicht antworten“
    await sitz('captain');
    springe(['funk_lage_ger', 'funk_lage_offen', 'funk_lage_rom'], '1003');
    await shot('06a-captain-streifen', 800);   // UI2: Captain trägt Bedienflächen auf dem Schirm: das Angebot beginnt als Streifen oben rechts
    await taste('Period');   // der erste Druck klappt nur auf
    await shot('06-lage-drei-optionen', 800);
    {   // Später: die Leiste klappt zum Streifen zusammen, ein Klick klappt auf
      const q = await page.evaluate(() => Funkwahl.store.rechteck);
      const m0 = angebot().optionen.length;
      await klick(q.x + q.w - 20, q.y + 15 + m0 * 15 + 5); await shot('06b-spaeter-streifen', 500);
      const q2 = await page.evaluate(() => Funkwahl.store.rechteck);
      await klick(q2.x + 40, q2.y + 6); await shot('06c-wieder-offen', 500);
    }
    const r = await page.evaluate(() => Funkwahl.store.rechteck);
    const n = (angebot() || { optionen: [] }).optionen.length;
    await klick(r.x + 40, r.y + 15 + (n) * 15 + 5);   // „Nicht antworten“ (letzte Zeile)
    console.log('nach Ignorieren: Angebot', !!angebot(), 'Ruf', JSON.stringify(g.weltsim.ruf));
    await shot('07-nach-ignorieren', 600);
    // 5. Mausklick auf die zweite Option
    springe('funk_handel_stimmen', '0305'); await shot('08-handelsfunk', 600);
    const r2 = await page.evaluate(() => Funkwahl.store.rechteck);
    await klick(r2.x + 40, r2.y + 15 + 15 + 5);
    console.log('nach Klick Option 2: Angebot', !!angebot(), 'zuletzt', JSON.stringify(g.weltsim.funkwahl.zuletzt));
    await shot('09-nach-klick', 800);
    // 6. Verfall
    springe('notruf_havarie_reaktor', '0305');   // Notruf: die Havarie-Option kommt erst nach dem Hinflug
    console.log('Havarie-Notruf offen', g.weltsim.reise.offen.length, 'Angebot', !!angebot());
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
