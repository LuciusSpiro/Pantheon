// CHA-02 E2: Silhouettenbilder (Abnahme 10) – Spieler neben Gegnern jedes Volks, Draufsicht 1920x1080, Zoom 0 und 1.
// Echter Server im selben Prozess, ein echter Browser-Client (Playwright/Chromium, ?render=voxel&debug=1), Prüf-Hilfe __game.setzeKarte.
//   Phase boden   (Grabenangriff, arena_graben): Spieler mit --karte (germ | lorica | standard) in der Mitte, davor zwei Reihen Gegner
//                 (Reihe A: Germanen-Rollen, Reihe B: Rom, Kontor, Raubzug, Rostmeute, Kustoden, herrenlos), Debug-Befehl `gegner <rolle> <fraktion>`
//   Phase hello   (Freie Fahrt): Anziehen am Spind sendet kein hello (WebSocket-Rahmen mitgezählt)
//   Phase bord    (arena_away, Karte „schiff“: Innenraum eines Feindschiffs): derselbe Spieler im Schiffsinneren neben Gegnern
// Aufruf: node tools/sicht-cha02-dritt.js [--karte germ,lorica,standard] [--phase boden,bord,hello] [--shots <Ordner>] [--port 3641]
//   (Bilder nicht im Repo, Standard-Ordner shots/cha02-silhouette ist ignoriert)   Exit 1 bei Fehlern, 2 ohne Playwright.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3641');
const SHOTS = path.resolve(arg('shots', path.join('shots', 'cha02-silhouette')));
const KARTEN_WAHL = arg('karte', 'germ,lorica').split(',');
const PHASEN = arg('phase', 'boden,bord').split(',');
const W = 1920, H = 1080;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-cha02-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE setzen)'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STD_OUTFIT = { kopf: 'keine', oberteil: 'bordtunika', hose: 'bordhose', schuhe: 'bordstiefel', haende: 'keine', umhang: 'keiner' };
const KARTEN = {
  germ: { v: 1, name: 'Hrolf', koerper: 'standard', frisur: 'wild', haut: 3, haar: 2,
    outfit: { kopf: 'hoernerhelm', oberteil: 'plankenweste', hose: 'germanenhose', schuhe: 'germanenstiefel', haende: 'armschiene', umhang: 'fellumhang' } },
  lorica: { v: 1, name: 'Aurelia', koerper: 'standard', frisur: 'welle', haut: 1, haar: 1,
    outfit: { kopf: 'galea', oberteil: 'lorica', hose: 'bordhose', schuhe: 'ocreae', haende: 'keine', umhang: 'sagum' } },
  standard: { v: 1, name: 'Cato', koerper: 'standard', frisur: 'kurz', haut: 2, haar: 3, outfit: STD_OUTFIT },
};
const REIHE_A = [['grundtyp', 'ger'], ['niederhalter', 'ger'], ['grenadier', 'ger'], ['schuetze', 'ger'], ['enterer', 'ger'], ['haescher', 'ger']];
const REIHE_B = [['grundtyp', 'rom'], ['grundtyp', 'kontor'], ['grundtyp', 'raubzug'], ['grundtyp', 'rostmeute'], ['grundtyp', 'kustoden'], ['grundtyp', 'herrenlos'], ['scavenger', '']];

const fehler = [];
const log = (...a) => console.log(a.join(' '));
async function warteBis(fn, ms, text) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150); }
  throw new Error('Zeit überschritten: ' + text);
}
async function neuerKontext(browser, port, karte) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') fehler.push('console: ' + m.text().slice(0, 200)); });
  await page.goto(`http://127.0.0.1:${port}/?render=voxel&debug=1`);
  await page.waitForFunction(() => window.__game && __game.send && __game.state && window.VoxelRender, null, { timeout: 180000 });
  await page.evaluate((k) => __game.setzeKarte(k), karte);
  return { ctx, page };
}
async function geladen(page, ms) {
  const t0 = Date.now(); let ruhig = 0;
  while (Date.now() - t0 < (ms || 240000)) {
    const r = await page.evaluate(() => { const l = VoxelRender.info().loader; return !!l && l.loading === 0 && l.builds > 0; });
    ruhig = r ? ruhig + 1 : 0;
    if (ruhig >= 5) return true;
    await sleep(700);
  }
  log('WARNUNG: nicht fertig geladen');
  return false;
}
async function bilder(page, name) {
  for (const z of [0, 1]) {
    await page.evaluate((zz) => VoxelRender.zoom(zz ? 1 : -1), z);
    await sleep(1200);
    const f = path.join(SHOTS, `${name}-zoom${z}.png`);
    await page.screenshot({ path: f, timeout: 120000 });
    log('Bild ' + f);
  }
}
async function start(g, c, modus, opts) {
  await c.page.evaluate(([m, o]) => __game.send(Object.assign({ t: 'lobbyOpt', startMission: m }, o)), [modus, opts || {}]);
  await c.page.evaluate(() => __game.send({ t: 'ready', ready: true }));
}

// Gegner per Debug-Befehl spawnen; ihre Position wird festgehalten (hp hoch, aufgedeckt), damit sie im Bild stehen
async function setzeGegner(g, c, liste) {
  const vorher = g.away.drones.length;
  for (const [rolle, fr] of liste) {
    const msg = { t: 'debug', cmd: 'gegner', rolle: rolle === 'scavenger' ? 'grundtyp' : rolle };
    if (fr) msg.fraktion = fr;
    await c.page.evaluate((m) => __game.send(m), msg);
    await sleep(250);
  }
  const neu = g.away.drones.slice(vorher);
  liste.forEach(([rolle], i) => { if (rolle === 'scavenger' && neu[i]) { delete neu[i].rolle; neu[i].kind = 'scavenger'; } });
  return neu;
}
function pinne(g, neu, p, reihe, dy, abstand) {
  const ab = abstand || 48;
  // frozen (nur Tests): der Gegner entscheidet und schießt nicht, steht aber im Bild (Abstand 48 px, damit die Silhouetten einzeln lesbar sind)
  const sx = p.x, sy = p.y;
  return setInterval(() => { p.x = sx; p.y = sy; neu.forEach((e, i) => { e.x = sx - (ab / 2) * (neu.length - 1) + i * ab; e.y = sy + dy; e.hp = 99999; e.revealed = true; e.asleep = false; e.frozen = true; }); }, 60);
}

async function phaseBoden(browser, kname) {
  log(`\n== Phase boden, Karte ${kname} ==`);
  const srv = await startServer({ port: PORT, debug: true, ruestphase: false, roomCode: 'off', quiet: true, worlds: true, worldDir: path.join(TMP, 'worlds-boden-' + kname) });
  const g = srv.game;
  const c = await neuerKontext(browser, PORT, KARTEN[kname]);
  try {
    await warteBis(() => g.players.length === 1 && g.players[0].karte, 20000, 'Karte am Server');
    await start(g, c, 'arena_graben');
    await warteBis(() => g.players.every((p) => p.zone === 'away'), 60000, 'Spieler unten');
    g.god = true;
    for (const e of g.away.drones) { e.x = 0; e.y = 0; e.frozen = true; }
    const p = g.players[0]; p.x = 22 * 32 + 16; p.y = 16 * 32 + 16;
    await geladen(c.page, 300000);
    for (const [name, liste, dy] of [['reiheA-germanen', REIHE_A, 60], ['reiheB-voelker', REIHE_B, 60], ['reiheB-nah-unten', REIHE_B.slice(0, 4), 40]]) {
      const neu = await setzeGegner(g, c, liste);
      const pin = pinne(g, neu, p, 0, dy);
      await sleep(2500); await geladen(c.page, 120000); await sleep(1500);
      log(`Gegner im Bild (${name}): ${neu.length}; Spieler ${g.players[0].name} bei ${Math.round(p.x)},${Math.round(p.y)}`);
      await bilder(c.page, `boden-${kname}-${name}`);
      clearInterval(pin);
      for (const e of neu) { const i = g.away.drones.indexOf(e); if (i >= 0) g.away.drones.splice(i, 1); }
      await sleep(500);
    }
  } finally { await c.ctx.close(); await srv.close(); }
}

async function phaseBord(browser, kname) {
  log(`\n== Phase bord (Feindschiff-Innenraum), Karte ${kname} ==`);
  const srv = await startServer({ port: PORT + 1, debug: true, ruestphase: false, roomCode: 'off', quiet: true, worlds: true, worldDir: path.join(TMP, 'worlds-bord-' + kname) });
  const g = srv.game;
  const c = await neuerKontext(browser, PORT + 1, KARTEN[kname]);
  try {
    await warteBis(() => g.players.length === 1 && g.players[0].karte, 20000, 'Karte am Server');
    await start(g, c, 'arena_away', { wellen: 'schiff' });
    await warteBis(() => g.players.every((p) => p.zone === 'away'), 60000, 'Spieler unten');
    g.god = true;
    const p = g.players[0];
    await geladen(c.page, 300000);
    await sleep(3000);
    // freie Fläche suchen (11 x 4 Kacheln ohne Wand), Spieler oben in der Mitte, Gegnerreihe zwei Kacheln darunter (Sicht frei, sonst „unsichtbar“ im Nebel)
    const interior = require('../server/sim/interior.js'), Physics = require('../shared/physics.js');
    const solid = interior.solidFor(g, 'away'), hb = g.C.player.hitbox;
    const frei = (x, y) => { const r = Physics.moveWithCollision(solid, x, y, 0, 0, hb); return Math.abs(r.x - x) < 0.01 && Math.abs(r.y - y) < 0.01; };
    const ai = g.karteOf && g.karteOf(g.away.map);
    const wT = (ai && ai.w) || 60, hT = (ai && ai.h) || 40;
    let platz = null;
    for (let ty = 2; ty < hT - 5 && !platz; ty++) for (let tx = 2; tx < wT - 12 && !platz; tx++) {
      let ok = true;
      for (let dy = 0; dy < 4 && ok; dy++) for (let dx = 0; dx < 11 && ok; dx++) ok = frei((tx + dx) * 32 + 16, (ty + dy) * 32 + 16);
      if (ok) platz = { x: (tx + 5) * 32 + 16, y: ty * 32 + 16 };
    }
    if (!platz) throw new Error('keine freie Fläche auf der Schiffskarte gefunden');
    p.x = platz.x; p.y = platz.y;
    await sleep(1500);
    log(`Spieler ${p.name} bei ${Math.round(p.x)},${Math.round(p.y)}, Karte ${g.away && g.away.map}, Fläche ${JSON.stringify(platz)}`);
    const alle = g.away.drones.slice(); for (const e of alle) e.frozen = true;
    // vorhandene Gegner der Welle liegen lassen; zusätzlich Reihen mit Völkern
    for (const [name, liste] of [['reiheA-germanen', REIHE_A], ['reiheB-voelker', REIHE_B]]) {
      const neu = await setzeGegner(g, c, liste);
      const pin = pinne(g, neu, p, 0, 64, 40);
      await sleep(2500); await geladen(c.page, 120000); await sleep(1500);
      log(`Gegner im Bild (${name}): ${neu.length}; sonst ${alle.length} Welle`);
      await bilder(c.page, `bord-${kname}-${name}`);
      clearInterval(pin);
      for (const e of neu) { const i = g.away.drones.indexOf(e); if (i >= 0) g.away.drones.splice(i, 1); }
    }
  } finally { await c.ctx.close(); await srv.close(); }
}

// Anziehen am Spind sendet kein hello (Kanal karte.outfit): WebSocket-Rahmen des Clients mitzählen
async function phaseHello(browser) {
  log('\n== Phase hello (kein hello beim Anziehen) ==');
  const srv = await startServer({ port: PORT + 2, debug: true, ruestphase: false, roomCode: 'off', quiet: true, worlds: true, worldDir: path.join(TMP, 'worlds-hello') });
  const g = srv.game;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const rahmen = [];
  page.on('websocket', (ws) => ws.on('framesent', (f) => { try { rahmen.push(JSON.parse(f.payload).t + (JSON.parse(f.payload).c ? ':' + JSON.parse(f.payload).c : '')); } catch (e) { /* binär */ } }));
  page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
  try {
    await page.goto(`http://127.0.0.1:${PORT + 2}/?render=voxel&debug=1`);
    await page.waitForFunction(() => window.__game && __game.send && __game.state && window.VoxelRender, null, { timeout: 180000 });
    await page.evaluate((k) => __game.setzeKarte(k), KARTEN.standard);
    await warteBis(() => g.players.length === 1 && g.players[0].karte, 20000, 'Karte am Server');
    await page.evaluate(() => { __game.send({ t: 'lobbyOpt', startMission: 'freie_fahrt' }); __game.send({ t: 'ready', ready: true }); });
    await warteBis(() => g.phase === 'play', 30000, 'Runde läuft');
    await page.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'spind' }));
    await warteBis(() => g.players[0].console === 'spind', 8000, 'Spind');
    const vor = rahmen.length;
    await page.evaluate((o) => __game.client.sendeOutfit(o), KARTEN.lorica.outfit);
    await warteBis(() => g.players[0].karte.outfit.oberteil === 'lorica', 8000, 'Server hat Outfit');
    const neu = rahmen.slice(vor);
    const hello = neu.filter((t) => t === 'hello').length;
    log(`Rahmen nach dem Anziehen: ${JSON.stringify(neu)}; hello: ${hello}`);
    if (hello) fehler.push('hello beim Anziehen gesendet');
  } finally { await ctx.close(); await srv.close(); }
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  try {
    for (const k of KARTEN_WAHL) {
      if (PHASEN.includes('boden')) await phaseBoden(browser, k);
      if (PHASEN.includes('bord')) await phaseBord(browser, k);
    }
    if (PHASEN.includes('hello')) await phaseHello(browser);
  } catch (e) { fehler.push('Abbruch: ' + e.message); }
  await browser.close();
  log('\nFehler: ' + (fehler.length ? '\n  ' + fehler.slice(0, 20).join('\n  ') : 'keine'));
  process.exit(fehler.length ? 1 : 0);
})();
