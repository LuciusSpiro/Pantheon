'use strict';
// TRA-01 C: Sichtbeleg der Abzeichen (Echter Server im selben Prozess, echter Chromium-Client via Playwright, Software-GL, langsam).
// Ablauf: A  localStorage vorbelegt (Fliegen, Captain mit Sprache) → Unterseite Training zeigt beide; Neuladen behält sie; Captain mit beiden Varianten; Ops/Technik/Außeneinsatz ohne Abzeichen
//         B  echtes Spiel: Training Fliegen starten, Ziel erzwingen (Server-Flag trainingFertig) → genau EINE Meldung im HUD (Hinweis; die ODA-Zeile wird unterdrückt), Speicher gefüllt
//         C  der gespeicherte Stand aus B in frischem Browser → Unterseite zeigt Fliegen
//         D  localStorage wirft bei jedem Zugriff außer dem Lesen des Raumcodes (addInitScript; den verlangt der Testserver) → Menü läuft, Unterseite zeigt nichts, Training läuft, Meldung kommt trotzdem, keine Fehler
// Aufruf: node tools/sicht-training-abzeichen.js [--port 3581] [--shots <Ordner>] [--w 1280 --h 720]   Exit 1 bei Fehlern, 2 ohne Playwright.   Bilder nicht im Repo.
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3581');
const SHOTS = path.resolve(arg('shots', path.join('shots', 'training-abzeichen')));
const W = +arg('w', '1280'), H = +arg('h', '720');
const CODE = 'T4AB';
const KEY = 'pantheon.abzeichen';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-training-abzeichen-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
const Ch = require('../shared/charakter.js');
const KAT = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'katalog', 'charakter.json'), 'utf8'));
const SPEICHER = JSON.stringify({ v: 1, gewaehlt: 'c0', liste: [{ id: 'c0', karte: Ch.standardKarte('Aurelia', KAT) }] });
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fehler = [];
const log = (...a) => console.log(a.join(' '));
const ok = (b, t) => { log((b ? '  ok   ' : '  FEHLER ') + t); if (!b) fehler.push(t); };

// speicher: { abzeichen: <JSON-Text|null> } vorbelegen | 'wirft' (jeder localStorage-Zugriff wirft)
async function kontext(browser, url, speicher) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await ctx.addInitScript(([d, code, ab, wirft, key]) => {
    if (wirft) {   // jeder Zugriff wirft; nur der Raumcode ist lesbar, weil der Testserver ihn beim hello verlangt (sonst käme der Client gar nicht in die Lobby)
      const boese = () => { throw new DOMException('gesperrt', 'SecurityError'); };
      Object.defineProperty(window, 'localStorage', { configurable: true, get() { return { getItem: (k) => (k === 'sternenschicht.roomCode' ? code : boese()), setItem: boese, removeItem: boese, clear: boese, key: boese, get length() { return boese(); } }; } });
      return;
    }
    try {
      if (!sessionStorage.getItem('init')) {
        sessionStorage.setItem('init', '1'); localStorage.setItem('pantheon.charaktere', d); localStorage.setItem('sternenschicht.roomCode', code);
        if (ab) localStorage.setItem(key, ab);
      }
    } catch (e) { /* ohne Speicher */ }
  }, [SPEICHER, CODE, speicher && speicher.abzeichen || null, speicher === 'wirft', KEY]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) fehler.push('console: ' + m.text().slice(0, 200)); });
  await page.goto(url);
  await page.waitForFunction(() => window.__game && __game.state && __game.pid && window.Charaktere && Charaktere.lies().bereit && window.MenueFluss && window.MenueUi, null, { timeout: 60000 });
  await page.focus('#game');
  return { ctx, page };
}
async function bild(page, name) {
  await page.waitForTimeout(700);
  const f = path.join(SHOTS, name + '.png');
  await page.screenshot({ path: f });
  log('Bild ' + f);
}
const taste = async (page, k) => { await page.keyboard.press(k); await page.waitForTimeout(150); };
const stand = (page) => page.evaluate(() => Object.fromEntries(MenueFluss.trainingKacheln().map((k) => [k.id, k.abzeichen])));
const speicherInhalt = (page) => page.evaluate((key) => { try { return localStorage.getItem(key); } catch (e) { return 'WIRFT'; } }, KEY);
async function zumTraining(page) {
  await taste(page, 'Enter');   // Titel → Hauptmenü
  await taste(page, 't'); await taste(page, 'Enter');
  return page.evaluate(() => MenueFluss.lies().unterseite);
}
// Fliegen in der Lobby wählen, bereit melden, Server startet das Training
async function trainingStarten(page, srv) {
  await taste(page, '1'); await taste(page, 'Enter');
  await page.waitForFunction(() => __game.state.lobby && __game.state.lobby.startMission === 'training_fliegen', null, { timeout: 8000 });
  await page.evaluate(() => Net.send({ t: 'ready', ready: true }));
  const t0 = Date.now();
  while (!(srv.game.arena && srv.game.arena.training && srv.game.mission && srv.game.mission.flags) && Date.now() - t0 < 20000) await sleep(200);
  await sleep(1500);
  return !!(srv.game.arena && srv.game.arena.training);
}
const meldungen = (page) => page.evaluate(() => ({
  hinweise: (Hud.notices || []).map((n) => n.text),
  oda: [Hud.oda.cur && Hud.oda.cur.text].concat((Hud.oda.queue || []).map((m) => m.text)).filter(Boolean),
}));

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const opt = (port) => ({ port, debug: false, ruestphase: false, roomCode: CODE, quiet: true, worlds: false, noStore: true });
  let gespeichert = null;
  try {
    // ---------------------------------------------------------------- A: vorbelegt, Neuladen
    log('\n== A Speicher vorbelegt: Fliegen erreicht, Captain mit Sprache erreicht ==');
    const srvA = await startServer(opt(PORT));
    const vorbelegt = JSON.stringify({ v: 1, liste: [{ id: 'fliegen', zeit: 1700000000000 }, { id: 'captain', variante: 'sprache', zeit: 1700000100000 }] });
    { const { ctx, page } = await kontext(browser, `http://127.0.0.1:${PORT}/?menue=1`, { abzeichen: vorbelegt });
      ok(await zumTraining(page) === 'training', 'Unterseite Training geöffnet');
      let s = await stand(page);
      ok(s.fliegen && s.captain && gleich(s.captain.varianten, ['sprache']) && s.ops === false && s.technik === false && s.aussen === false, 'Fliegen erreicht, Captain mit Sprache, drei gesperrte Kacheln ohne Abzeichen: ' + JSON.stringify(s));
      await bild(page, '01-unterseite-fliegen-und-captain-sprache');
      await taste(page, '2'); await bild(page, '02-captain-gewaehlt');
      await taste(page, 'Escape');
      await page.reload(); await page.waitForFunction(() => window.__game && __game.state && __game.pid && window.Charaktere && Charaktere.lies().bereit && window.MenueFluss && window.MenueUi, null, { timeout: 60000 });
      await page.focus('#game');
      ok(await zumTraining(page) === 'training', 'nach Neuladen: Unterseite wieder geöffnet');
      s = await stand(page);
      ok(s.fliegen && s.captain && gleich(s.captain.varianten, ['sprache']), 'nach Neuladen bleiben beide Abzeichen: ' + JSON.stringify(s));
      await bild(page, '03-nach-neuladen');
      // Captain-Tafel im Browser dazu: beide Varianten
      await taste(page, 'Escape');
      await page.evaluate(() => Abzeichen.setzen('captain', 'tafel'));
      await taste(page, 'Enter');
      s = await stand(page);
      ok(s.captain && gleich(s.captain.varianten, ['tafel', 'sprache']), 'Captain mit Tafel dazu, Unterseite neu geöffnet: Varianten Tafel und Sprache: ' + JSON.stringify(s.captain));
      await bild(page, '04-captain-beide-varianten');
      ok((await speicherInhalt(page)).includes('"tafel"'), 'Speicherinhalt enthält die Variante: ' + await speicherInhalt(page));
      await ctx.close(); }
    await srvA.close();

    // ---------------------------------------------------------------- B: echtes Spiel, Meldung
    log('\n== B Training Fliegen im echten Spiel: Meldung und Speicher ==');
    const srvB = await startServer(opt(PORT + 1));
    { const { ctx, page } = await kontext(browser, `http://127.0.0.1:${PORT + 1}/?menue=1`, {});
      ok(await zumTraining(page) === 'training', 'Unterseite Training geöffnet (leerer Speicher)');
      let s = await stand(page); ok(Object.values(s).every((x) => x === false), 'ohne Abzeichen: alle Kacheln leer: ' + JSON.stringify(s));
      await bild(page, '05-leer');
      ok(await trainingStarten(page, srvB), 'Training Fliegen läuft');
      await bild(page, '06-im-training-vor-dem-ziel');
      srvB.game.mission.flags.trainingFertig = true;
      await sleep(1800);
      const m = await meldungen(page);
      ok(m.hinweise.filter((t) => /^Abzeichen erreicht: Fliegen/.test(t)).length === 1, 'genau ein Hinweis „Abzeichen erreicht: Fliegen“ im HUD: ' + JSON.stringify(m.hinweise));
      ok(!m.oda.some((t) => /Abzeichen/.test(t)), 'die ODA-Zeile des Servers wird nicht zusätzlich gezeigt (ODA-Warteschlange: ' + JSON.stringify(m.oda) + ')');
      await bild(page, '07-meldung-im-spiel');
      gespeichert = await speicherInhalt(page);
      ok(!!gespeichert && JSON.parse(gespeichert).liste.some((x) => x.id === 'fliegen'), 'Speicher nach dem Spiel: ' + gespeichert);
      await ctx.close(); }
    await srvB.close();

    // ---------------------------------------------------------------- C: gespeicherter Stand in frischem Browser
    log('\n== C Stand aus dem Spiel, frischer Browser ==');
    const srvC = await startServer(opt(PORT + 2));
    { const { ctx, page } = await kontext(browser, `http://127.0.0.1:${PORT + 2}/?menue=1`, { abzeichen: gespeichert });
      ok(await zumTraining(page) === 'training', 'Unterseite Training geöffnet');
      const s = await stand(page);
      ok(s.fliegen && s.captain === false, 'das im Spiel erreichte Fliegen-Abzeichen erscheint, Captain nicht: ' + JSON.stringify(s));
      await bild(page, '08-nach-dem-spiel-fliegen');
      await ctx.close(); }
    await srvC.close();

    // ---------------------------------------------------------------- D: localStorage wirft
    log('\n== D localStorage wirft ==');
    const srvD = await startServer(opt(PORT + 3));
    { const { ctx, page } = await kontext(browser, `http://127.0.0.1:${PORT + 3}/?menue=1`, 'wirft');
      ok(await page.evaluate((k) => { try { localStorage.getItem(k); return false; } catch (e) { return true; } }, KEY) && await page.evaluate(() => { try { localStorage.setItem('x', '1'); return false; } catch (e) { return true; } }), 'Voraussetzung: Lesen und Schreiben des Abzeichen-Speichers werfen im Browser');
      ok(await zumTraining(page) === 'training', 'Menü läuft, Unterseite Training geöffnet');
      const s = await stand(page); ok(s.fliegen === false && s.captain === false, 'keine Abzeichen, keine Ausnahme: ' + JSON.stringify(s));
      await bild(page, '09-ohne-speicher-unterseite');
      ok(await trainingStarten(page, srvD), 'Training Fliegen läuft ohne Speicher');
      srvD.game.mission.flags.trainingFertig = true;
      await sleep(1800);
      const m = await meldungen(page);
      ok(m.hinweise.filter((t) => /^Abzeichen erreicht: Fliegen/.test(t)).length === 1, 'die Meldung kommt trotzdem (einmal): ' + JSON.stringify(m.hinweise));
      await bild(page, '10-ohne-speicher-meldung');
      ok(srvD.game.errors === 0, 'Server g.errors 0');
      await ctx.close(); }
    await srvD.close();
  } catch (e) {
    fehler.push('Abbruch: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await browser.close();
  }
  const echt = [...new Set(fehler)];
  if (echt.length) { log('\nFehler:\n' + echt.join('\n')); process.exit(1); }
  log('\nAlles ok');
  process.exit(0);
})();
function gleich(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
