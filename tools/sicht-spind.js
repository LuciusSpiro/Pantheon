// CHA-01 D: Sichtbeleg Spind im eigenen Quartier (echter Server im selben Prozess, echte Browser-Clients, Playwright/Chromium, ?render=voxel&debug=1).
// Drei Kontexte mit drei Charakteren aus der ECHTEN Charakterliste (localStorage 'pantheon.charaktere', Format aus charaktere.js; kein __game.setzeKarte).
//   Phase schiff  (Freie Fahrt Sund): Spieler 1 am eigenen Spind (Hinweis „Spind öffnen“), Spind-Pult 1920×1080 und 1280×720, Bordhelm und Fellumhang in der Anprobe, Anziehen;
//                 Bilder bei Spieler 2 und 3 ohne Neuladen; Spieler 1 am fremden Spind (kein Hinweis, E öffnet nichts); Spind bei Alarm (Schildgenerator zerstört → Alarm rot);
//                 Neuladen von Spieler 1 → Outfit erhalten (Speicher und Server)
//   Phase boden   (Grabenangriff): die Charaktere (mit dem angezogenen Outfit aus dem Speicher von Spieler 1) im Einsatz, Bilder bei Spieler 2 und 3
// Aufruf: node tools/sicht-spind.js [--phase schiff,boden] [--shots shots/spind] [--port 3551] [--w 1920 --h 1080]   (Bilder nicht im Repo, shots/ ist ignoriert)
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3551');
const SHOTS = path.resolve(arg('shots', path.join('shots', 'spind')));
const W = +arg('w', '1920'), H = +arg('h', '1080');
const PHASEN = arg('phase', 'schiff,boden').split(',');
fs.mkdirSync(SHOTS, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-spind-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE setzen)'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STD_OUTFIT = { kopf: 'keine', oberteil: 'bordtunika', hose: 'bordhose', schuhe: 'bordstiefel', haende: 'keine', umhang: 'keiner' };
const KARTEN = [
  { v: 1, name: 'Hrolf', koerper: 'standard', gesicht: 'narbe', frisur: 'zoepfe', bart: 'vollbart', haut: 3, haar: 2, outfit: STD_OUTFIT },
  { v: 1, name: 'Aurelia', koerper: 'standard', gesicht: 'lerche', frisur: 'dutt', bart: 'keiner', haut: 1, haar: 1,
    outfit: { kopf: 'keine', oberteil: 'bordtunika', hose: 'bordhose', schuhe: 'bordstiefel', haende: 'keine', umhang: 'keiner' } },
  { v: 1, name: 'Cato', koerper: 'standard', gesicht: 'lerche', frisur: 'zoepfe', bart: 'vollbart', haut: 2, haar: 3,
    outfit: { kopf: 'keine', oberteil: 'plankenweste', hose: 'germanenhose', schuhe: 'germanenstiefel', haende: 'armschiene', umhang: 'keiner' } },
];
const speicherText = (k) => JSON.stringify({ v: 1, gewaehlt: 'c1', liste: [{ id: 'c1', karte: k }] });

const fehler = [];
const ALLE = [];
const log = (...a) => console.log(a.join(' '));

// Seed nur, solange noch nichts im Speicher steht: ein Neuladen behält, was der Spind gespeichert hat
async function neuerKontext(browser, port, name, seed) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await ctx.addInitScript((s) => { try { if (s && !localStorage.getItem('pantheon.charaktere')) localStorage.setItem('pantheon.charaktere', s); } catch (e) { /* egal */ } }, seed);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fehler.push(name + ' pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') fehler.push(name + ' ' + m.type() + ': ' + m.text().slice(0, 240)); });
  await page.goto(`http://127.0.0.1:${port}/?render=voxel&debug=1`);
  await page.waitForFunction(() => window.__game && __game.send && __game.state && window.VoxelRender && window.Charaktere && Charaktere.lies().bereit, null, { timeout: 180000 });
  const c = { ctx, page, name };
  ALLE.push(c);
  return c;
}
async function lebenszustand(c, state) {
  if (!c.cdp) c.cdp = await c.ctx.newCDPSession(c.page);
  await c.cdp.send('Page.setWebLifecycleState', { state });
}
// Genau eine Seite läuft, alle anderen sind eingefroren (Software-Renderer würden sich sonst gegenseitig aushungern)
async function nur(c) {
  for (const o of ALLE) if (o !== c && !o.zu) await lebenszustand(o, 'frozen').catch(() => null);
  await lebenszustand(c, 'active');
  await c.page.bringToFront();
  await sleep(400);
}
async function geladen(c, ms) {
  const t0 = Date.now(); let ruhig = 0;
  while (Date.now() - t0 < (ms || 240000)) {
    const r = await c.page.evaluate(() => {
      const l = VoxelRender.info().loader; if (!l) return false;
      const st = __game.state || {}; const spieler = (st.players || []).filter((p) => p.connected !== false);
      return l.loading === 0 && spieler.every((p) => { const i = window.VoxelActors && window.VoxelActors.figurInfo(p.id); return !i || i.gebaut; }) && l.builds > 0;
    });
    ruhig = r ? ruhig + 1 : 0;
    if (ruhig >= 4) return true;
    await sleep(700);
  }
  log('WARNUNG: ' + c.name + ' nicht fertig geladen');
  return false;
}
async function starte(cs, modus) {
  await cs[0].page.evaluate((m) => __game.send({ t: 'lobbyOpt', startMission: m }), modus);
  for (const c of cs) await c.page.evaluate(() => __game.send({ t: 'ready', ready: true }));
}
async function warteBis(fn, ms, text) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150); }
  throw new Error('Zeit überschritten: ' + text);
}
async function zoom(c, z) { await c.page.evaluate((zz) => VoxelRender.zoom(zz ? 1 : -1), z); await sleep(900); }
async function bild(c, name) {
  const f = path.join(SHOTS, name + '.png');
  await c.page.bringToFront();
  await c.page.screenshot({ path: f, timeout: 120000 });
  log('Bild ' + path.relative(ROOT, f).replace(/\\/g, '/'));
  return f;
}
const taste = async (c, code) => { await c.page.keyboard.down(code); await sleep(60); await c.page.keyboard.up(code); await sleep(250); };
const setze = (p, tx, ty, dir) => { p.zone = 'ship'; p.x = tx * 32 + 16; p.y = ty * 32 + 16; p.dir = dir; p.console = null; p.input.mx = 0; p.input.my = 0; };
const pultInfo = (c) => c.page.evaluate(() => { const e = Charaktere.lies().sitzung.entwurf; return { konsole: (__game.state.players.find((p) => p.id === __game.pid) || {}).console, entwurf: e && { modus: e.modus, platz: e.platz, outfit: e.karte.outfit, hinweis: e.hinweis }, getragen: (Charaktere.aktiveKarte() || {}).outfit }; });

async function phaseSchiff(browser) {
  log('\n== Phase schiff (Freie Fahrt Sund) ==');
  const srv = await startServer({ port: PORT, debug: true, ruestphase: false, roomCode: 'off', quiet: true, worlds: true, worldDir: path.join(TMP, 'worlds-schiff') });
  const g = srv.game;
  let speicher1 = null;
  try {
    const cs = [];
    for (let i = 0; i < 3; i++) cs.push(await neuerKontext(browser, PORT, 'S' + (i + 1), speicherText(KARTEN[i])));
    await warteBis(() => g.players.length === 3 && g.players.every((p) => p.karte), 20000, 'drei Karten am Server');
    log('Spieler am Server: ' + g.players.map((p) => `${p.id}:${p.name} Farbe ${p.color}`).join(', '));
    await starte(cs, 'freie_fahrt');
    await warteBis(() => g.phase === 'play', 30000, 'Runde läuft');
    g.god = true;
    await sleep(1000);
    const [p1, p2, p3] = g.players;
    // Alle drei im Quartier von Spieler 1: Spieler 1 neben seinem Spind (13,17), die anderen daneben
    const quartier = (p) => `q${p.color}`;
    log('Quartiere: ' + g.players.map((p) => `${p.name} ${quartier(p)}`).join(', '));
    const aufstellen = () => { setze(p1, 12, 17, 'right'); setze(p2, 10, 18, 'right'); setze(p3, 9, 18, 'right'); };
    aufstellen();
    for (const c of cs) { await nur(c); await geladen(c); }
    await nur(cs[0]);
    await sleep(2500);

    // 1) Hinweis am eigenen Spind
    await bild(cs[0], 'schiff-1-eigener-spind-hinweis');

    // 2) E öffnet das Pult
    await taste(cs[0], 'KeyE');
    await warteBis(() => p1.console === 'spind', 5000, 'Spind-Konsole offen');
    await sleep(1500);
    await warteBis(() => cs[0].page.evaluate(() => !!(Charaktere.lies().sitzung.entwurf)), 5000, 'Entwurf');
    log('Spind offen: ' + JSON.stringify(await pultInfo(cs[0])));
    await sleep(2500);   // Figur und Vorschaubilder laden
    await bild(cs[0], 'spind-1920x1080-kopf-getragen');
    await cs[0].page.setViewportSize({ width: 1280, height: 720 }); await sleep(1200);
    await bild(cs[0], 'spind-1280x720-kopf-getragen');
    await cs[0].page.setViewportSize({ width: W, height: H }); await sleep(1200);

    // 3) Bordhelm und Fellumhang in der Anprobe
    await taste(cs[0], 'Digit8'); await taste(cs[0], 'ArrowRight'); await sleep(2500);
    log('Anprobe Kopf: ' + JSON.stringify((await pultInfo(cs[0])).entwurf));
    await bild(cs[0], 'spind-anprobe-bordhelm');
    await taste(cs[0], 'Digit6'); await taste(cs[0], 'ArrowRight'); await sleep(3000);
    log('Anprobe Umhang: ' + JSON.stringify((await pultInfo(cs[0])).entwurf));
    await bild(cs[0], 'spind-anprobe-fellumhang');
    await taste(cs[0], 'KeyE'); await sleep(2500);   // Q/E drehen die Figur im Pult (E ist hier Drehen, nicht Interaktion)
    await bild(cs[0], 'spind-anprobe-gedreht');
    await taste(cs[0], 'KeyQ');
    // Serverseitig noch nichts geändert
    log('Vor Enter: Server-Outfit ' + JSON.stringify(p1.karte.outfit));
    await taste(cs[0], 'Digit5');   // Oberteil-Platz (nur Ansicht)
    await sleep(1200);
    await bild(cs[0], 'spind-platz-oberteil');
    await taste(cs[0], 'Digit8'); await sleep(800);

    // 4) Anziehen
    await taste(cs[0], 'Enter');
    await warteBis(() => p1.karte.outfit.kopf === 'bordhelm' && p1.karte.outfit.umhang === 'fellumhang', 8000, 'Server hat das Outfit');
    await sleep(2500);
    log('Nach Enter: Server-Outfit ' + JSON.stringify(p1.karte.outfit) + '; Entwurf ' + JSON.stringify((await pultInfo(cs[0])).entwurf));
    await bild(cs[0], 'spind-angezogen');
    // Esc verlässt
    await taste(cs[0], 'Escape');
    await warteBis(() => p1.console === null, 5000, 'Spind verlassen');
    log('Esc: Konsole geschlossen = ' + (p1.console === null));

    // 5) Bilder bei Spieler 2 und 3 ohne Neuladen
    for (const [i, name] of [[1, 'spieler2'], [2, 'spieler3']]) {
      const c = cs[i];
      await nur(c);
      await warteBis(() => c.page.evaluate(() => { const k = __game.client.karten.p1; return !!k && k.outfit.kopf === 'bordhelm' && k.outfit.umhang === 'fellumhang'; }), 30000, 'Ereignis karte bei ' + name);
      await sleep(2500); await geladen(c);
      log(`${name}: karten.p1.outfit ${JSON.stringify(await c.page.evaluate(() => __game.client.karten.p1.outfit))} (kein Neuladen)`);
      for (const z of [0, 1]) { await zoom(c, z); await bild(c, `schiff-outfit-bei-${name}-zoom${z}`); }
    }

    // 6) fremder Spind: Spieler 1 an Spieler 2s Spind (13,27)
    await nur(cs[0]);
    const fremd = g.players.find((p) => p !== p1 && p.color === 1) || p2;
    setze(p1, 12, 27, 'right');
    await sleep(2500);
    await taste(cs[0], 'KeyE'); await sleep(1200);
    log(`Fremder Spind (${quartier(fremd)} von ${fremd.name}): Konsole nach E = ${p1.console}`);
    await bild(cs[0], 'schiff-2-fremder-spind-kein-hinweis');

    // 7) Alarm: Schildgenerator zerstört → Alarm rot, Spind öffnet trotzdem
    setze(p1, 12, 17, 'right');
    g.ship.systems.shields = 'broken';
    await sleep(1500);
    log('Alarmstufe: ' + g.ship.alert);
    await taste(cs[0], 'KeyE');
    await warteBis(() => p1.console === 'spind', 5000, 'Spind bei Alarm offen');
    await sleep(2500);
    await bild(cs[0], 'spind-bei-alarm');
    await taste(cs[0], 'Digit2'); await taste(cs[0], 'ArrowRight'); await taste(cs[0], 'Enter');
    await warteBis(() => p1.karte.outfit.hose === 'germanenhose', 8000, 'Umziehen bei Alarm');
    log('Bei Alarm angezogen: Hose ' + p1.karte.outfit.hose + ' (Alarm ' + g.ship.alert + ')');
    await taste(cs[0], 'KeyR'); await taste(cs[0], 'Digit2'); await taste(cs[0], 'ArrowLeft'); await taste(cs[0], 'Enter');   // Hose zurück
    await warteBis(() => p1.karte.outfit.hose === 'bordhose', 8000, 'Hose zurück');
    await taste(cs[0], 'Escape');
    await warteBis(() => p1.console === null, 5000, 'Spind verlassen');
    g.ship.systems.shields = 'ok';

    // 8) Neuladen von Spieler 1: Outfit erhalten
    speicher1 = await cs[0].page.evaluate(() => localStorage.getItem('pantheon.charaktere'));
    log('Speicher von Spieler 1 vor dem Neuladen: ' + speicher1);
    await cs[0].page.reload();
    await cs[0].page.waitForFunction(() => window.__game && window.Charaktere && Charaktere.lies().bereit && __game.client.karten && __game.pid, null, { timeout: 180000 });
    await sleep(2500);
    const nach = await cs[0].page.evaluate(() => ({ aktiv: Charaktere.aktiveKarte().outfit, name: Charaktere.aktiverName() }));
    log('Nach Neuladen im Browser: ' + JSON.stringify(nach));
    log('Server nach Neuladen (hello mit gespeicherter Karte): ' + JSON.stringify(g.players.find((p) => p.name === 'Hrolf').karte.outfit));
    await geladen(cs[0]);
    await bild(cs[0], 'schiff-nach-neuladen-spieler1');
    for (const c of ALLE) { c.zu = true; await c.ctx.close(); }
    ALLE.length = 0;
  } finally { await srv.close(); }
  return speicher1;
}

async function phaseBoden(browser, speicher1) {
  log('\n== Phase boden (Grabenangriff) ==');
  const srv = await startServer({ port: PORT + 1, debug: true, ruestphase: false, roomCode: 'off', quiet: true, worlds: true, worldDir: path.join(TMP, 'worlds-boden') });
  const g = srv.game;
  try {
    const cs = [];
    const seeds = [speicher1 || speicherText(KARTEN[0]), speicherText(KARTEN[1]), speicherText(KARTEN[2])];
    for (let i = 0; i < 3; i++) cs.push(await neuerKontext(browser, PORT + 1, 'B' + (i + 1), seeds[i]));
    await warteBis(() => g.players.length === 3 && g.players.every((p) => p.karte), 20000, 'drei Karten am Server');
    log('Karte von Spieler 1 im Einsatz: ' + JSON.stringify(g.players[0].karte.outfit));
    await starte(cs, 'arena_graben');
    await warteBis(() => g.players.every((p) => p.zone === 'away'), 60000, 'Crew unten');
    g.god = true;
    for (const c of cs) { await nur(c); await geladen(c, 300000); }
    for (const e of g.away.drones) { e.x = 0; e.y = 0; }
    [[22, 16], [23, 16], [22, 17]].forEach(([tx, ty], i) => { g.players[i].x = tx * 32 + 16; g.players[i].y = ty * 32 + 16; });
    await nur(cs[1]);
    await sleep(2500);
    const vorher = g.away.drones.length;
    for (let i = 0; i < 3; i++) { await cs[1].page.evaluate(() => __game.dbg('gegner')); await sleep(250); }
    const neu = g.away.drones.slice(vorher);
    const mitte = g.players[1];
    const setzeG = () => neu.forEach((e, i) => { e.x = mitte.x + 70 + i * 26; e.y = mitte.y + (i - 1) * 30; e.hp = 9999; e.revealed = true; });
    setzeG();
    const pin = setInterval(setzeG, 60);
    await sleep(2500);
    log(`Gegner im Bild: ${neu.length}; Spieler: ${g.players.map((p) => `${p.name} ${p.zone}`).join(', ')}`);
    for (const [i, name] of [[1, 'spieler2'], [2, 'spieler3']]) {
      await nur(cs[i]); await sleep(2500); await geladen(cs[i], 300000);
      for (const z of [0, 1]) { await zoom(cs[i], z); await bild(cs[i], `boden-outfit-bei-${name}-zoom${z}`); }
    }
    clearInterval(pin);
    for (const c of ALLE) { c.zu = true; await c.ctx.close(); }
    ALLE.length = 0;
  } finally { await srv.close(); }
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let ausnahme = null;
  try {
    let s = null;
    if (PHASEN.includes('schiff')) s = await phaseSchiff(browser);
    if (PHASEN.includes('boden')) await phaseBoden(browser, s);
  } catch (e) { ausnahme = e; console.error('FEHLER: ' + (e && e.stack || e)); }
  await browser.close().catch(() => null);
  const echte = fehler.filter((f) => !/favicon|Failed to load resource.*404/i.test(f));
  log('\nClient-Meldungen: ' + echte.length);
  echte.slice(0, 20).forEach((f) => log('  ' + f));
  process.exit(ausnahme ? 1 : 0);
})();
