// BOT-05 B2: Sichtpruefung des Bot-Gespraechs im echten Client gegen den echten Server mit Fake-Ollama und Fake-Voicebox (tools/lib/bot-gespraech-fakes.js).
// Bilder: Lobby mit drei Bots (Kartenlayout), Sprechspalte "denkt nach", mit Gespraechssaetzen, "nicht erreichbar". Geprueft mit echten Tasten (Ö = Gespraechszeile, Ä halten = Gespraech sprechen):
// Ö oeffnet die Zeile, Enter sendet bot.gespraech (nie bot.befehl), der Server antwortet bot.rede, die Sprechspalte zeigt es. Eigener Server (Port ab 3492, ROOM_CODE=off, Weltordner im Temp-Verzeichnis).
// Aufruf: node tools/sicht-bot-gespraech.js [--port 3492] [--bilder <Ordner>]   (Exit 1, wenn eine Pruefung fehlschlaegt; Software-GL ist langsam)
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');
const { fakeOllama, fakeVoicebox } = require('./lib/bot-gespraech-fakes.js');

const ROOT = path.join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3492');
const BILDER = arg('bilder', path.join(ROOT, 'shots', 'bot05-gespraech'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sichtgespraech-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
function playwright() {
  for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'C:/tmp/pwtest/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } }
  console.error('playwright-core nicht gefunden'); process.exit(2);
}
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ping = (port) => new Promise((res) => { const r = http.get({ host: '127.0.0.1', port, path: '/', timeout: 800 }, (x) => { x.resume(); res(x.statusCode === 200); }); r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); }); });

let fehlt = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('   ok    ' + t); else { fehlt++; console.log('   FEHLT ' + t); } };
const info = (t) => console.log('   info  ' + t);
const bild = async (page, name) => { fs.mkdirSync(BILDER, { recursive: true }); await page.screenshot({ path: path.join(BILDER, name + '.png') }); info('Bild ' + name); };
const spalte = (page) => page.evaluate(() => Hud.sprech.eintraege.map((e) => e.who + ': ' + e.text));
const warte = (page, fn, arg0, ms) => page.waitForFunction(fn, arg0, { timeout: ms || 15000 }).then(() => true, () => false);

async function main() {
  const llm = await fakeOllama().start(), vb = await fakeVoicebox().start();
  const dir = path.join(TMP, 'srv');
  const env = Object.assign({}, process.env, {
    PORT: String(PORT), ROOM_CODE: 'off', WORLD_DIR: path.join(dir, 'worlds'), REGIE_DIR: path.join(dir, 'regie'), ERZEUGT_DIR: path.join(dir, 'erzeugt'),
    OLLAMA_URL: 'http://127.0.0.1:' + llm.port, VOICEBOX_URL: 'http://127.0.0.1:' + vb.port, BOT_GESPRAECH_ERSTES_TOKEN_MS: '6000', BOT_GESPRAECH_GESAMT_MS: '8000', BOT_GESPRAECH_RATE_PRO_MINUTE: '1000',
  });
  delete env.LLM_LIVE; delete env.SPIELLEITER_LLM; delete env.VOICEBOX_AUTH;
  if (await ping(PORT)) throw new Error('Port ' + PORT + ' belegt');
  const srv = spawn(process.execPath, ['server/index.js', '--debug'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 150 && !(await ping(PORT)); i++) await sleep(100);
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  try {
    // ---- Lobby ohne Debug-Anzeige (die Debug-Tafel deckt sonst die Karten zu): ein Spieler, drei Bots ueber Net.send
    {
      const c0 = await b.newContext({ viewport: { width: 1280, height: 720 } });
      const p0 = await c0.newPage();
      await p0.goto('http://127.0.0.1:' + PORT + '/?render=2d&pult=rom&botsprache=1');
      await p0.waitForFunction(() => window.Net && Net.send && Client && Client.state && Client.state.phase === 'lobby' && Client.pid, null, { timeout: 30000 });
      for (const r of ['navigation', 'ops', 'technik']) { await p0.evaluate((x) => Net.send({ t: 'lobbyBot', op: 'add', rolle: x }), r); await sleep(200); }
      await p0.waitForFunction(() => Client.state.players.filter((p) => p.bot).length >= 3, null, { timeout: 8000 });
      await sleep(1200);
      await bild(p0, '01-lobby-drei-bots');
      await c0.close(); await sleep(500);
    }
    const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push('console: ' + m.text().slice(0, 160)); });
    await page.addInitScript(() => {
      window.__gesendet = []; window.__rede = [];
      const orig = WebSocket.prototype.send;
      WebSocket.prototype.send = function (d) { try { const m = JSON.parse(d); if (m && /^bot\./.test(m.t)) window.__gesendet.push(m); } catch (e) { /* egal */ } return orig.call(this, d); };
    });
    await page.goto('http://127.0.0.1:' + PORT + '/?debug=1&render=2d&pult=rom&botsprache=1');
    await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
    await page.evaluate(() => { Net.on((m) => { if (m && m.t === 'bot.rede') window.__rede.push(m); }); });

    // ---- Lobby mit drei Bots
    for (let i = 0; i < 3 && !(await page.evaluate(() => __game.state.players.filter((p) => p.bot).length >= 3)); i++) { await page.evaluate(() => __game.send({ t: 'lobbyBot', op: 'add', rolle: ['navigation', 'ops', 'technik'].find((r) => !__game.state.players.some((p) => p.bot && p.rolle === r)) })); await sleep(300); }
    await page.waitForFunction(() => __game.state.players.filter((p) => p.bot).length >= 3, null, { timeout: 8000 });
    await sleep(800);
    const bots = await page.evaluate(() => __game.state.players.filter((p) => p.bot).map((p) => p.botId + ':' + p.name));
    ok(bots.join() === 'b0:Livia,b1:Cassius,b2:Titus', 'Lobby: drei Bots mit festen Figuren (' + bots.join(' ') + ')');

    // ---- Partie starten, an die Captain-Konsole setzen
    await page.evaluate(() => __game.send({ t: 'lobbyOpt', startMission: 'free', skipDrill: true }));
    await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await page.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'captain', hin: true }));
    await page.waitForFunction(() => __game.state.players.find((p) => p.id === __game.pid && p.console === 'captain'), null, { timeout: 8000 });
    await page.mouse.move(5, 5);
    await page.waitForFunction(() => window.BotSprache && BotSprache.laeuft() && window.PultBefehl && (!PultBefehl.menue.hatBots() || PultBefehl.menue.geladen()), null, { timeout: 15000 });
    await sleep(500);
    ok(await page.evaluate(() => BotSprache.laeuft() && Hud.sprech.bots === true), 'Sprache laeuft, Sprechspalte kennt die Bots (bis zu 3 Eintraege)');

    const tippe = async (text) => {
      await page.keyboard.press('Semicolon');
      await sleep(200);
      const offen = await page.evaluate(() => !!(Hud.sprech.zeile && Hud.sprech.zeile.offen));
      await page.keyboard.type(text, { delay: 15 });
      await page.keyboard.press('Enter');
      return offen;
    };
    const gesendet = () => page.evaluate(() => window.__gesendet.slice());

    // ---- 1 "denkt nach" und "nicht erreichbar": Ollama haengt
    llm.reset(); llm.modus = 'haengt';
    ok(await tippe('Livia, wie steht es?'), 'Ö oeffnet die Gespraechszeile');
    ok(await warte(page, () => Hud.sprech.eintraege.some((e) => /denkt nach/.test(e.text))), '"denkt nach" steht in der Sprechspalte');
    const s1 = await spalte(page);
    info('Spalte: ' + JSON.stringify(s1));
    ok(s1.some((x) => /^LIVIA: denkt nach/.test(x)) && s1.some((x) => /^DU: Livia, wie steht es\?/.test(x)), 'LIVIA: denkt nach … und DU: <Zeile>');
    await bild(page, '02-denkt-nach');
    const g1 = await gesendet();
    ok(g1.length === 1 && g1[0].t === 'bot.gespraech' && g1[0].an === 'b0' && g1[0].quelle === 'text', 'gesendet: genau ein bot.gespraech an b0 (' + JSON.stringify(g1) + ')');
    ok(await warte(page, () => !Hud.sprech.eintraege.some((e) => /denkt nach/.test(e.text)) && window.__rede.some((m) => m.zustand === 'nicht_erreichbar'), null, 25000), 'nach dem Zeitlimit: nicht_erreichbar, "denkt nach" weg');
    await sleep(500);
    const s3 = await spalte(page);
    info('Spalte: ' + JSON.stringify(s3));
    ok(s3.some((x) => /^BORD: Livia ist nicht erreichbar\./.test(x)), 'Sprechspalte: "Livia ist nicht erreichbar."');
    await bild(page, '03-nicht-erreichbar');

    // ---- 2 drei Saetze mit Ton
    llm.reset(); vb.reset(); llm.chunkMs = 60; llm.antwort = () => 'Kurs 270 Grad, Captain. Die Schilde stehen bei 100 Prozent. Sonst gibt es nichts zu melden.';
    await page.evaluate(() => { window.__rede.length = 0; });
    ok(await tippe('Cassius, Lage?'), 'zweites Gespraech ueber Ö');
    ok(await warte(page, () => Hud.sprech.eintraege.filter((e) => e.who === 'CASSIUS' && !/denkt/.test(e.text)).length >= 2, null, 20000), 'mindestens zwei Saetze von CASSIUS sind da');
    await sleep(900);
    const s2 = await spalte(page);
    info('Spalte: ' + JSON.stringify(s2));
    await bild(page, '04-gespraechssaetze');
    ok(!s2.some((x) => /denkt nach/.test(x)), 'kein "denkt nach" mehr neben den Saetzen');
    ok(await warte(page, () => window.__rede.some((m) => m.zustand === 'ende')), 'bot.rede endet');
    const z2 = await page.evaluate(() => window.__rede.map((m) => m.zustand + (m.nr != null ? m.nr : '')));
    ok(/^denkt,satz0/.test(z2.join()) && z2.includes('ton0') && z2.at(-1) === 'ende', 'Ablauf vom Server: ' + z2.join(','));
    const g2 = await gesendet();
    ok(g2.every((m) => m.t === 'bot.gespraech') && g2.length === 2, 'nie ein bot.befehl (' + g2.map((m) => m.t).join(',') + ')');
    ok(vb.anfragen.length >= 1, 'Voicebox hat Saetze bekommen (' + vb.anfragen.length + ')');

    // ---- 3 Befehlswortlaut bleibt ein Gespraech
    llm.reset(); llm.antwort = () => 'Das kann ich nur auf Befehl tun, Captain.';
    await page.evaluate(() => { window.__gesendet.length = 0; window.__rede.length = 0; });
    await sleep(3000);
    await tippe('Schilde Steuerbord');
    await warte(page, () => window.__rede.some((m) => m.zustand === 'ende'));
    const g3 = await gesendet();
    ok(g3.length === 1 && g3[0].t === 'bot.gespraech', 'Text "Schilde Steuerbord" ueber Ö: bot.gespraech, kein bot.befehl (' + JSON.stringify(g3) + ')');

    ok(errs.length === 0, 'keine Seitenfehler im Browser' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  } finally {
    await b.close(); srv.kill(); await llm.stop(); await vb.stop();
    const se = log.split('\n').filter((l) => /Error|TypeError/.test(l)); if (se.length) { fehlt++; console.log('   FEHLT Serverfehler: ' + se.slice(0, 4).join(' | ')); }
  }
  console.log('\n' + (n - fehlt) + '/' + n + ' Pruefungen ok' + (fehlt ? ', ' + fehlt + ' FEHLT' : ''));
  process.exit(fehlt ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
