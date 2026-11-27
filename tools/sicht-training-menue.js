'use strict';
// TRA-01 A2: Sichtbeleg des Trainingsmenüs (Echter Server im selben Prozess, echter Chromium-Client via Playwright, Software-GL, langsam).
// Ablauf: Hauptmenü mit Eintrag TRAINING (T) → Unterseite mit fünf Kacheln → Captain-Wahl (Befehlstafel/Tasten, mit Sprache) → gesperrte Kacheln per Klick und Taste ohne Wirkung → Esc zurück
//         → Start Captain mit Sprache (Klick auf den Knopf) → Lobby; Start Fliegen (Enter) → Lobby. Geprüft wird am Server-Lobbyzustand (lobby.startMission, lobby.trainingSprache).
// Aufruf: node tools/sicht-training-menue.js [--port 3571] [--shots <Ordner>] [--w 1280 --h 720]   Exit 1 bei Fehlern, 2 ohne Playwright.   Bilder nicht im Repo.
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3571');
const SHOTS = path.resolve(arg('shots', path.join('shots', 'training-menue')));
const W = +arg('w', '1280'), H = +arg('h', '720');
const CODE = 'T4TR';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-training-menue-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
const Ch = require('../shared/charakter.js');
const KAT = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'katalog', 'charakter.json'), 'utf8'));
const SPEICHER = JSON.stringify({ v: 1, gewaehlt: 'c0', liste: [{ id: 'c0', karte: Ch.standardKarte('Aurelia', KAT) }] });   // Charakterliste wie im Browser gespeichert (localStorage 'pantheon.charaktere')
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE setzen)'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fehler = [];
const log = (...a) => console.log(a.join(' '));
const ok = (b, t) => { log((b ? '  ok   ' : '  FEHLER ') + t); if (!b) fehler.push(t); };

async function kontext(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await ctx.addInitScript(([d, code]) => { try { if (!sessionStorage.getItem('init')) { sessionStorage.setItem('init', '1'); localStorage.setItem('pantheon.charaktere', d); localStorage.setItem('sternenschicht.roomCode', code); } } catch (e) { /* ohne Speicher */ } }, [SPEICHER, CODE]);
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
const taste = async (page, k) => { await page.keyboard.press(k); await page.waitForTimeout(120); };
const zustand = (page) => page.evaluate(() => { const s = MenueFluss.lies(), l = __game.state.lobby || {}; return { schirm: s.schirm, unterseite: s.unterseite, auswahl: s.auswahl, kachel: s.trainingAuswahl, sprache: s.trainingSprache, start: l.startMission, srvSprache: l.trainingSprache }; });
// Klick auf Spielraster-Koordinaten (640×360) → Seite
async function klickRaster(page, x, y) {
  const r = await page.evaluate(() => { const b = document.getElementById('game').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  await page.mouse.click(r.x + (x / 640) * r.w, r.y + (y / 360) * r.h); await page.waitForTimeout(200);
}
const KACHEL = { x: 32, y: 92, w: 108, h: 96, fuge: 9 };
const kachelMitte = (i) => [KACHEL.x + i * (KACHEL.w + KACHEL.fuge) + KACHEL.w / 2, KACHEL.y + KACHEL.h / 2];

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await startServer({ port: PORT, debug: false, ruestphase: false, roomCode: CODE, quiet: true, worlds: false, noStore: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  try {
    log('\n== 1 Hauptmenü mit Eintrag TRAINING ==');
    const { ctx, page } = await kontext(browser, `http://127.0.0.1:${PORT}/?menue=1`);
    await taste(page, 'Enter');
    let z = await zustand(page); ok(z.schirm === 'menue', 'Hauptmenü');
    await taste(page, 't'); z = await zustand(page);
    ok(z.auswahl === 'training' && !z.unterseite, 'T wählt den Eintrag TRAINING (öffnet noch nichts)');
    await bild(page, '01-hauptmenue-training');

    log('\n== 2 Unterseite ==');
    await taste(page, 'Enter'); z = await zustand(page);
    ok(z.unterseite === 'training' && z.schirm === 'menue', 'Enter öffnet die Unterseite');
    const kacheln = await page.evaluate(() => MenueFluss.trainingKacheln().map((k) => k.id + ':' + (k.startbar ? 'start' : 'gesperrt')).join());
    ok(kacheln === 'fliegen:start,captain:start,ops:gesperrt,technik:gesperrt,aussen:gesperrt', 'fünf Kacheln, drei gesperrt (' + kacheln + ')');
    await bild(page, '02-unterseite-fliegen');
    await taste(page, '2'); await bild(page, '03-unterseite-captain-tafel');
    await taste(page, 's'); z = await zustand(page); ok(z.sprache === true, 'S schaltet auf „mit Sprache“');
    await bild(page, '04-unterseite-captain-sprache');

    log('\n== 3 Gesperrte Kacheln: Klick und Taste ohne Wirkung ==');
    const vorher = await zustand(page);
    for (const i of [2, 3, 4]) { const [x, y] = kachelMitte(i); await klickRaster(page, x, y); }
    for (const t of ['3', '4', '5']) await taste(page, t);
    await taste(page, 'Control+t'); await taste(page, 'Control+s');
    z = await zustand(page);
    ok(z.kachel === vorher.kachel && z.start === vorher.start && z.unterseite === 'training' && z.schirm === 'menue' && z.sprache === vorher.sprache, 'Klick auf Ops/Technik/Außeneinsatz, Tasten 3/4/5, Strg+T, Strg+S: nichts ändert sich (Kachel ' + z.kachel + ', Server-Modus ' + z.start + ')');
    ok(await page.evaluate(() => !MenueFluss.trainingKacheln().some((k) => k.gesperrt && k.startbar)), 'gesperrte Kacheln sind nirgends startbar');
    await bild(page, '05-gesperrte-kacheln-nach-klicks');

    log('\n== 4 Esc zurück, wieder öffnen, Captain mit Sprache per Klick auf den Knopf ==');
    await taste(page, 'Escape'); z = await zustand(page); ok(!z.unterseite && z.schirm === 'menue', 'Esc schließt die Unterseite, Hauptmenü');
    await taste(page, 'Enter'); await taste(page, '2');   // Auswahl TRAINING steht noch
    z = await zustand(page); ok(z.unterseite === 'training' && z.kachel === 'captain', 'wieder geöffnet, Captain gewählt');
    await klickRaster(page, 32 + 576 - 190 + 90, 204 + 116 - 32 + 10);   // goldener Knopf „In die Lobby“ der Detailkachel
    await page.waitForFunction(() => __game.state.lobby && __game.state.lobby.startMission === 'training_captain', null, { timeout: 8000 }).catch(() => {});
    z = await zustand(page);
    ok(z.schirm === 'lobby' && z.start === 'training_captain' && z.srvSprache === true, 'Klick auf den Knopf: Lobby, Server-Modus training_captain, trainingSprache true');
    await bild(page, '06-lobby-captain');
    await taste(page, 's'); await page.waitForTimeout(400); z = await zustand(page);
    ok(z.srvSprache === false, 'Lobby: S schaltet die Eingabe am Server zurück (Befehlstafel/Tasten)');
    await bild(page, '07-lobby-captain-tafel');

    log('\n== 5 Moduswahl der Lobby → Unterseite → Fliegen ==');
    await taste(page, 'm'); await taste(page, 'Enter'); z = await zustand(page);
    ok(z.unterseite === 'training' && z.schirm === 'lobby', 'M, Enter auf TRAINING (aktiv): dieselbe Unterseite über der Lobby');
    await bild(page, '08-unterseite-aus-der-lobby');
    await taste(page, '1'); await taste(page, 'Enter');
    await page.waitForFunction(() => __game.state.lobby && __game.state.lobby.startMission === 'training_fliegen', null, { timeout: 8000 }).catch(() => {});
    z = await zustand(page); ok(z.schirm === 'lobby' && !z.unterseite && z.start === 'training_fliegen', 'Fliegen: Lobby im Modus training_fliegen');
    await bild(page, '09-lobby-fliegen');
    await ctx.close();
  } catch (e) {
    fehler.push('Abbruch: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await browser.close();
    await srv.close();
  }
  const echt = [...new Set(fehler)];
  if (echt.length) { log('\nFehler:\n' + echt.join('\n')); process.exit(1); }
  log('\nAlles ok');
  process.exit(0);
})();
