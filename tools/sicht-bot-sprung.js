// TRA-01 C3: Sichtprüfung des Sprung-Senders am Captain-Pult im echten Client gegen den echten Server (Lobby-Modus training_captain: Bots Navigation, Ops, Technik, Saumraum vorerkundet).
// Prüft: Befehlstafel (B) -> Navigation: Eintrag „Sprung (gewähltes Ziel)“ sichtbar; Shift+J und Tafel-Eintrag ohne gewähltes Ziel -> bot.antwort kein_ziel (Untertitel);
// mit gewähltem Sprungziel (captain.selectDest, Reiter 2 zeigt den Stern) -> bot.antwort ok, der Bot springt (ship.scene wechselt); danach zweiter Sprung per Shift+J.
// Bilder nach --out (Standard shots/tra01-c3, git-ignoriert). Eigener Server, Port ab 3490, ROOM_CODE=off, Weltordner im Temp-Verzeichnis.
// Aufruf: node tools/sicht-bot-sprung.js [--port 3490] [--out <Ordner>]   (Exit 1, wenn eine Prüfung fehlschlägt; Software-GL, langsam)
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3490');
const SHOTS = arg('out', path.join(ROOT, 'shots', 'tra01-c3'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sichtsprung-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
function playwright() {
  for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'C:/tmp/pwtest/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* nächster */ } }
  console.error('playwright-core nicht gefunden'); process.exit(2);
}
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ping = (port) => new Promise((res) => { const r = http.get({ host: '127.0.0.1', port, path: '/', timeout: 800 }, (x) => { x.resume(); res(x.statusCode === 200); }); r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); }); });

let fehlt = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('   ok    ' + t); else { fehlt++; console.log('   FEHLT ' + t); } };
const info = (t) => console.log('   info  ' + t);
const bild = async (page, name) => { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); info('Bild ' + path.join(SHOTS, name + '.png')); };

(async () => {
  if (await ping(PORT)) throw new Error('Port ' + PORT + ' belegt');
  const env = Object.assign({}, process.env, { PORT: String(PORT), ROOM_CODE: 'off', WORLD_DIR: path.join(TMP, 'worlds'), REGIE_DIR: path.join(TMP, 'regie'), ERZEUGT_DIR: path.join(TMP, 'erzeugt') });
  delete env.LLM_LIVE; delete env.SPIELLEITER_LLM;
  const srv = spawn(process.execPath, ['server/index.js', '--debug'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 150 && !(await ping(PORT)); i++) await sleep(100);
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push('console: ' + m.text().slice(0, 160)); });
    const antworten = [];   // alle bot.antwort vom Server, in Reihenfolge
    const gesendet = [];    // alle bot.befehl des Clients
    page.on('websocket', (ws) => {
      ws.on('framereceived', (f) => { try { const m = JSON.parse(String(f.payload)); if (m && m.t === 'bot.antwort') antworten.push(m); } catch (e) { /* kein JSON */ } });
      ws.on('framesent', (f) => { try { const m = JSON.parse(String(f.payload)); if (m && m.t === 'bot.befehl') gesendet.push(m); } catch (e) { /* kein JSON */ } });
    });
    await page.goto('http://127.0.0.1:' + PORT + '/?debug=1&render=2d');
    await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
    await page.evaluate(() => __game.send({ t: 'lobbyOpt', startMission: 'training_captain' }));
    await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await page.waitForFunction(() => { const s = __game.state; return s.players.filter((p) => p.bot && p.console).length >= 3; }, null, { timeout: 60000 }).catch(() => {});
    await sleep(1500);
    const lage = () => page.evaluate(() => { const st = __game.state, sh = st.ship || {}; const me = st.players.find((p) => p.id === __game.pid); return { phase: st.phase, konsole: me && me.console, scene: sh.scene, dest: sh.jump && sh.jump.dest, ready: sh.jump && sh.jump.ready, grund: sh.jump && sh.jump.blockedReason, docked: sh.docked }; });
    let l = await lage();
    info('Lage: ' + JSON.stringify(l));
    ok(l.phase === 'play' && l.konsole === 'captain', 'Mensch sitzt an der Captain-Konsole');
    await page.mouse.move(5, 5);
    await page.keyboard.press('Digit3'); await sleep(500);

    // 1. Tafel: B, dann Navigation (Q): der Eintrag steht im Feld X
    await page.keyboard.press('KeyB'); await sleep(500);
    await page.keyboard.press('KeyQ'); await sleep(500);
    await bild(page, '1-tafel-navigation');
    const tafel = await page.evaluate(() => { const v = window.PultBefehl && PultBefehl.sichtbar && PultBefehl.sichtbar(); return { sichtbar: !!v }; });
    ok(tafel.sichtbar, 'Befehlstafel ist offen (Stufe Navigation)');

    // 2. Eintrag ohne gewähltes Ziel: kein_ziel
    const n0 = antworten.length, g0 = gesendet.length;
    await page.keyboard.press('KeyX'); await sleep(2500);
    await bild(page, '2-eintrag-ohne-ziel');
    const g = gesendet.slice(g0), a = antworten.slice(n0);
    info('gesendet: ' + JSON.stringify(g) + ' · Antworten: ' + a.map((x) => x.befehl + ' ' + x.status + ' ' + x.textId + ' "' + x.text + '"').join(' | '));
    ok(g.length === 1 && g[0].befehl === 'nav.sprung' && g[0].quelle === 'menu' && g[0].an === 'navigation' && JSON.stringify(g[0].args) === '{"ziel":"marke"}', 'Tafel-Eintrag sendet nav.sprung, quelle menu, args ziel marke');
    ok(a.length === 1 && a[0].status === 'abgelehnt' && a[0].textId === 'nav.sprung.abgelehnt.kein_ziel', 'Server: abgelehnt kein_ziel (kein Sprungziel gewählt)');

    // 3. Taste ohne Ziel
    const n1 = antworten.length, g1 = gesendet.length;
    await page.keyboard.press('Shift+KeyJ'); await sleep(2500);
    const g1s = gesendet.slice(g1), a1 = antworten.slice(n1);
    ok(g1s.length === 1 && g1s[0].befehl === 'nav.sprung' && g1s[0].quelle === 'taste', 'Shift+J sendet nav.sprung mit quelle taste');
    ok(a1.length === 1 && a1[0].textId === 'nav.sprung.abgelehnt.kein_ziel', 'Server: Shift+J ohne Ziel -> kein_ziel');
    await bild(page, '3-taste-ohne-ziel');

    // 4. Sprungziel wählen (Reiter 2 zeigt die Sternkarte), dann Eintrag über die Tafel
    // (die Tafel schließt nach dem Senden von selbst; ein Esc würde jetzt die Konsole verlassen)
    await page.keyboard.press('Digit2'); await sleep(800);
    await page.evaluate(() => __game.send({ t: 'cmd', c: 'captain.selectDest', dest: '0306' }));
    await sleep(1500);
    await bild(page, '4-reiter2-ziel-gewaehlt');
    l = await lage();
    info('Lage: ' + JSON.stringify(l));
    ok(l.dest === 'splitter', 'Sprungziel Splittergürtel (0306) ist im Server-Snapshot gewählt (ship.jump.dest ' + l.dest + ')');
    await page.keyboard.press('KeyB'); await sleep(400);
    await page.keyboard.press('KeyQ'); await sleep(400);
    const n2 = antworten.length, g2 = gesendet.length;
    await page.keyboard.press('KeyX'); await sleep(2500);
    const g2s = gesendet.slice(g2), a2 = antworten.slice(n2);
    info('Antworten: ' + a2.map((x) => x.befehl + ' ' + x.status + ' ' + x.textId + ' "' + x.text + '"').join(' | '));
    ok(g2s.length === 1 && g2s[0].quelle === 'menu', 'Tafel-Eintrag mit gewähltem Ziel gesendet (quelle menu)');
    ok(a2.length === 1 && a2[0].status === 'ok' && a2[0].textId === 'nav.sprung.ok', 'Server: nav.sprung ok');
    await bild(page, '5-eintrag-ok');
    // der Bot legt ab, fliegt zum Sprungpunkt und springt
    let sprang = false;
    for (let i = 0; i < 90 && !sprang; i++) { await sleep(2000); l = await lage(); if (l.scene !== 'hafen') sprang = true; if (i % 5 === 0) info('Lage: ' + JSON.stringify(l)); }
    ok(sprang, 'der Bot springt: Szene wechselt von hafen zu ' + l.scene);
    await sleep(2500);
    await bild(page, '6-nach-sprung');

    // 5. zweiter Sprung per Taste (nächster Hop 0406)
    await page.evaluate(() => __game.send({ t: 'cmd', c: 'captain.selectDest', dest: '0406' }));
    await sleep(1500);
    l = await lage();
    info('Lage: ' + JSON.stringify(l));
    const n3 = antworten.length, g3 = gesendet.length;
    await page.keyboard.press('Shift+KeyJ'); await sleep(2500);
    const g3s = gesendet.slice(g3), a3 = antworten.slice(n3);
    info('Antworten: ' + a3.map((x) => x.befehl + ' ' + x.status + ' ' + x.textId).join(' | '));
    ok(g3s.length === 1 && g3s[0].quelle === 'taste' && a3.length === 1, 'Shift+J mit gewähltem Ziel gesendet (quelle taste), eine Antwort: ' + (a3[0] && a3[0].textId));
    await bild(page, '7-taste-zweiter-sprung');
    ok(errs.length === 0, 'keine Fehler im Browser' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
    await ctx.close();
  } finally {
    await b.close(); srv.kill();
    const se = log.split('\n').filter((x) => /Error|TypeError/.test(x)); if (se.length) { fehlt++; console.log('   FEHLT Serverfehler: ' + se.slice(0, 4).join(' | ')); }
  }
  console.log('\nSICHT-BOT-SPRUNG: ' + (fehlt ? fehlt + ' FEHLT von ' + n : n + '/' + n + ' ok'));
  process.exit(fehlt ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
