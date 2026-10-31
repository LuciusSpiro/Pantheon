// CHA-01 B2: Sichtprüfung der Spielerfigur aus der Charakterkarte (echter Server im selben Prozess, echte Browser-Clients, Playwright/Chromium, ?render=voxel&debug=1).
// Drei Kontexte mit drei Karten (ganz germanisch; Bordhelm mit Fellumhang; Standard), Prüf-Hilfe __game.setzeKarte, Lobby-Start über __game.send.
//   Phase schiff   (Freie Fahrt Sund): Crew an Bord dicht beieinander, Bilder bei Zoom 0 und 1 aus Sicht von Spieler 1; dann Outfit-Wechsel eines Spielers (karte.outfit)
//                  und Bilder bei den anderen ohne Neuladen; dann ein Nachzügler (vierter Kontext) und dessen Sicht
//   Phase boden    (Grabenangriff, arena_graben): dieselben Karten im Einsatz mit Gegnern im Bild, Zoom 0 und 1
//   Phase heap     (--heap): 100 × Outfit wechseln, Heap und Cache-Größen im Browser messen
// Umgebung: HEAP_N=400 (Anzahl Outfit-Wechsel, Standard 100), HEAP_ZWEI=1 (nur zwei Outfits im Wechsel), OHNE_KARTEN=1 (Kontrolle ohne Karten), NUR_ERSTE=1
// Aufruf: node tools/sicht-charakter.js [--phase schiff,boden,heap] [--shots shots/charakter] [--port 3531] [--w 1920 --h 1080]   (Bilder nicht im Repo, shots/ ist ignoriert)
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3531');
const SHOTS = path.resolve(arg('shots', path.join('shots', 'charakter')));
const W = +arg('w', '1920'), H = +arg('h', '1080');
const PHASEN = arg('phase', 'schiff,boden,heap,posen').split(',');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-charakter-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
const interior = require('../server/sim/interior.js');
const Physics = require('../shared/physics.js');
const KAT = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'katalog', 'charakter.json'), 'utf8'));
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE setzen)'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STD_OUTFIT = { kopf: 'keine', oberteil: 'bordtunika', hose: 'bordhose', schuhe: 'bordstiefel', haende: 'keine', umhang: 'keiner' };
const KARTEN = [
  { v: 1, name: 'Hrolf', koerper: 'standard', gesicht: 'narbe', frisur: 'zoepfe', bart: 'vollbart', haut: 3, haar: 2,
    outfit: { kopf: 'keine', oberteil: 'plankenweste', hose: 'germanenhose', schuhe: 'germanenstiefel', haende: 'armschiene', umhang: 'fellumhang' } },
  { v: 1, name: 'Aurelia', koerper: 'standard', gesicht: 'lerche', frisur: 'dutt', bart: 'keiner', haut: 1, haar: 1,
    outfit: { kopf: 'bordhelm', oberteil: 'bordtunika', hose: 'bordhose', schuhe: 'bordstiefel', haende: 'keine', umhang: 'fellumhang' } },
  { v: 1, name: 'Cato', koerper: 'standard', gesicht: 'lerche', frisur: 'zoepfe', bart: 'vollbart', haut: 2, haar: 3, outfit: STD_OUTFIT },
];
const NACHZUEGLER = { v: 1, name: 'Brienne', koerper: 'standard', gesicht: 'narbe', frisur: 'dutt', bart: 'keiner', haut: 0, haar: 0,
  outfit: { kopf: 'bordhelm', oberteil: 'plankenweste', hose: 'bordhose', schuhe: 'germanenstiefel', haende: 'armschiene', umhang: 'keiner' } };
const NEUES_OUTFIT = { kopf: 'bordhelm', oberteil: 'plankenweste', hose: 'germanenhose', schuhe: 'bordstiefel', haende: 'armschiene', umhang: 'fellumhang' };

const fehler = [];
const ALLE = [];
const bericht = [];
const log = (...a) => { const s = a.join(' '); bericht.push(s); console.log(s); };

async function neuerKontext(browser, port, karte, name) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fehler.push(name + ' pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') fehler.push(name + ' ' + m.type() + ': ' + m.text().slice(0, 240)); });
  await page.goto(`http://127.0.0.1:${port}/?render=voxel&debug=1`);
  await page.waitForFunction(() => window.__game && __game.send && __game.state && window.VoxelRender, null, { timeout: 180000 });
  if (karte && !process.env.OHNE_KARTEN) await page.evaluate((k) => __game.setzeKarte(k), karte);
  const c = { ctx, page, name };
  ALLE.push(c);
  return c;
}
// Seiten einfrieren (CDP), damit der Nachzügler nicht mit drei weiteren Software-Renderern um die CPU kämpft (swiftshader); Verbindung bleibt, Nachrichten werden gepuffert
async function lebenszustand(c, state) {
  if (!c.cdp) c.cdp = await c.ctx.newCDPSession(c.page);
  await c.cdp.send('Page.setWebLifecycleState', { state });
}
// Genau eine Seite läuft, alle anderen sind eingefroren (die Software-Renderer würden sich sonst gegenseitig aushungern: Assets laden nicht fertig, Bilder zeigen Platzhalter)
async function nur(c) {
  for (const o of ALLE) if (o !== c && !o.zu) await lebenszustand(o, 'frozen').catch(() => null);
  await lebenszustand(c, 'active');
  await c.page.bringToFront();
  await sleep(400);
}
// Warten, bis der Lader dieser Seite ruht (nichts mehr in Arbeit) und alle sichtbaren Spielerfiguren gebaut sind
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
// Lobby-Start wie in den anderen Sicht-Skripten: Modus wählen, alle bereit
async function starte(cs, modus) {
  await cs[0].page.evaluate((m) => __game.send({ t: 'lobbyOpt', startMission: m }), modus);
  for (const c of cs) await c.page.evaluate(() => __game.send({ t: 'ready', ready: true }));
}
async function warteBis(fn, ms, text) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150); }
  throw new Error('Zeit überschritten: ' + text);
}
const figInfos = (page) => page.evaluate(() => {
  const out = {}; const st = __game.state || {};
  for (const p of st.players || []) out[p.id] = Object.assign({ name: p.name }, window.VoxelActors.figurInfo(p.id));
  return out;
});
async function zoom(c, z) { await c.page.evaluate((zz) => VoxelRender.zoom(zz ? 1 : -1), z); await sleep(900); }
async function bild(c, name) {
  const f = path.join(SHOTS, name + '.png');
  await c.page.bringToFront();
  await c.page.screenshot({ path: f, timeout: 120000 });
  log('Bild ' + path.relative(ROOT, f).replace(/\\/g, '/'));
  return f;
}
async function paar(c, name, vor) {
  if (vor) { vor(); await sleep(300); }
  await nur(c);
  await sleep(2500);
  await geladen(c);
  for (const z of [0, 1]) {
    await zoom(c, z);
    await bild(c, `${name}-zoom${z}`);
  }
}
// Spieler dicht nebeneinander (34 px, knapp eine Kachel), nur auf begehbaren Stellen. `eigen` (Index) steht ganz links: die Kamera folgt dem eigenen Spieler,
// und das Debug-Feld (?debug=1) links im Bild würde die anderen sonst verdecken.
function setzeHaufen(g, mitte, eigen) {
  const solid = interior.solidFor(g, mitte.zone);
  const hb = g.C.player.hitbox;
  const frei = (x, y) => { const r = Physics.moveWithCollision(solid, x, y, 0, 0, hb); return Math.abs(r.x - x) < 0.01 && Math.abs(r.y - y) < 0.01; };
  const ox = [0, 34, 68, 102, 136];
  const reihe = g.players.slice().sort((a, b) => (a === g.players[eigen || 0] ? -1 : b === g.players[eigen || 0] ? 1 : g.players.indexOf(a) - g.players.indexOf(b)));
  let k = 0;
  for (const p of reihe) {
    p.zone = mitte.zone;
    for (; k < ox.length; k++) { const x = mitte.x + ox[k]; if (frei(x, mitte.y)) { p.x = x; p.y = mitte.y; k++; break; } }
    p.dir = 'down';
  }
}

async function phaseSchiff(browser) {
  log('\n== Phase schiff (Freie Fahrt Sund) ==');
  const srv = await startServer({ port: PORT, debug: true, ruestphase: false, roomCode: 'off', quiet: true, worlds: true, worldDir: path.join(TMP, 'worlds-schiff') });
  const g = srv.game;
  try {
    const cs = [];
    for (let i = 0; i < 3; i++) cs.push(await neuerKontext(browser, PORT, KARTEN[i], 'S' + (i + 1)));
    await warteBis(() => g.players.length === 3 && (process.env.OHNE_KARTEN || g.players.every((p) => p.karte)), 20000, 'drei Karten am Server');
    log('Spieler am Server: ' + g.players.map((p) => `${p.id}:${p.name}`).join(', '));
    await starte(cs, 'freie_fahrt');
    await warteBis(() => g.phase === 'play', 30000, 'Runde läuft');
    g.god = true;
    await sleep(1000);
    const p0 = g.players[0];
    const MITTE = { zone: 'ship', x: p0.x, y: p0.y };
    setzeHaufen(g, MITTE, 0);
    log('Positionen: ' + g.players.map((p) => `${p.name} (${Math.round(p.x)},${Math.round(p.y)})`).join('  '));
    // jede Seite einzeln laden lassen
    for (const c of cs) { await nur(c); await geladen(c); }
    await nur(cs[0]);
    log('Figuren aus Sicht von Spieler 1: ' + JSON.stringify(await figInfos(cs[0].page)));
    await paar(cs[0], 'schiff-spieler1', () => setzeHaufen(g, MITTE, 0));
    await paar(cs[1], 'schiff-spieler2', () => setzeHaufen(g, MITTE, 1));
    if (process.env.NUR_ERSTE) { await paar(cs[2], 'schiff-spieler3'); for (const c of ALLE) await c.ctx.close(); await srv.close(); await browser.close(); process.exit(0); }

    // Outfit-Wechsel von Spieler 2 (Aurelia): Bordhelm ab, Plankenweste, Germanenhose – ohne Neuladen
    log('\nOutfit-Wechsel von ' + g.players[1].name + ' (karte.outfit), keine Neuladung');
    await nur(cs[0]);
    const vorher = await cs[0].page.evaluate(() => JSON.stringify(window.VoxelActors.figurInfo('p2').key));
    await nur(cs[1]);
    await cs[1].page.evaluate((o) => __game.client.sendeOutfit(o), NEUES_OUTFIT);
    await warteBis(() => g.players[1].karte.outfit.oberteil === 'plankenweste', 8000, 'Server hat das Outfit');
    await nur(cs[0]);
    await warteBis(() => cs[0].page.evaluate(() => { const k = __game.client.karten.p2; return k && k.outfit.oberteil === 'plankenweste'; }), 20000, 'Ereignis karte beim anderen');
    await warteBis(() => cs[0].page.evaluate((v) => JSON.stringify(window.VoxelActors.figurInfo('p2').key) !== v, vorher), 60000, 'Neubau der Figur von p2 bei Spieler 1');
    const nachher = await cs[0].page.evaluate(() => JSON.stringify(window.VoxelActors.figurInfo('p2').key));
    log(`Baukey von p2 bei Spieler 1: neu gebaut = ${vorher !== nachher}; Neuladen der Seite: nein`);
    await paar(cs[0], 'schiff-outfit-neu-bei-spieler1', () => setzeHaufen(g, MITTE, 0));
    await paar(cs[2], 'schiff-outfit-neu-bei-spieler3', () => setzeHaufen(g, MITTE, 2));
    // Gleiches Outfit erneut: kein Neubau
    await nur(cs[1]);
    await cs[1].page.evaluate((o) => __game.client.sendeOutfit(o), NEUES_OUTFIT);
    await sleep(800);
    await nur(cs[0]);
    const bauten0 = await cs[0].page.evaluate(() => window.VoxelRender.info().loader.builds);
    await sleep(2500);
    const bauten1 = await cs[0].page.evaluate(() => window.VoxelRender.info().loader.builds);
    log(`Gleiches Outfit erneut gesendet: Builds bei Spieler 1 ${bauten0} -> ${bauten1} (kein Neubau erwartet)`);

    // Nachzügler
    log('\nNachzügler (vierter Kontext tritt in laufender Runde bei)');
    for (const c of cs) await lebenszustand(c, 'frozen');
    const c4 = await neuerKontext(browser, PORT, NACHZUEGLER, 'S4');
    await warteBis(() => g.players.length === 4, 30000, 'vierter Spieler');
    await sleep(500);
    setzeHaufen(g, MITTE, 3);
    await geladen(c4, 90000);
    log(`Nachzügler: Client-Fehler beim Laden ${await c4.page.evaluate(() => __game.errors | 0)} (Wettlauf im Lader, Böden/Wände können Platzhalter bleiben; Figuren sind davon unabhängig)`);
    log('Karten beim Nachzügler: ' + await c4.page.evaluate(() => Object.keys(__game.client.karten).sort().join(',')));
    log('Figuren aus Sicht des Nachzüglers: ' + JSON.stringify(await figInfos(c4.page)));
    await paar(c4, 'schiff-nachzuegler', () => setzeHaufen(g, MITTE, 3));
    await nur(cs[0]);
    await geladen(cs[0]);
    await paar(cs[0], 'schiff-spieler1-mit-nachzuegler', () => setzeHaufen(g, MITTE, 0));
    for (const c of ALLE) { c.zu = true; await c.ctx.close(); }
    ALLE.length = 0;
  } finally { await srv.close(); }
}

async function phaseBoden(browser) {
  log('\n== Phase boden (Grabenangriff) ==');
  const srv = await startServer({ port: PORT + 1, debug: true, ruestphase: false, roomCode: 'off', quiet: true, worlds: true, worldDir: path.join(TMP, 'worlds-boden') });
  const g = srv.game;
  try {
    const cs = [];
    for (let i = 0; i < 3; i++) cs.push(await neuerKontext(browser, PORT + 1, KARTEN[i], 'B' + (i + 1)));
    await warteBis(() => g.players.length === 3 && g.players.every((p) => p.karte), 20000, 'drei Karten am Server');
    await starte(cs, 'arena_graben');
    await warteBis(() => g.players.every((p) => p.zone === 'away'), 60000, 'Crew unten');
    g.god = true;
    for (const c of cs) { await nur(c); await geladen(c, 300000); }
    // Gegner aus dem Weg der Landung, dann Stelle am Graben (Kachel 22,16) und Gegner daneben
    for (const e of g.away.drones) { e.x = 0; e.y = 0; }
    [[22, 16], [23, 16], [22, 17]].forEach(([tx, ty], i) => { g.players[i].x = tx * 32 + 16; g.players[i].y = ty * 32 + 16; });
    await nur(cs[0]);
    await sleep(2500);
    const vorher = g.away.drones.length;
    for (let i = 0; i < 3; i++) { await cs[0].page.evaluate(() => __game.dbg('gegner')); await sleep(250); }
    const neu = g.away.drones.slice(vorher);
    const mitte = g.players[0];
    const setze = () => neu.forEach((e, i) => { e.x = mitte.x + 70 + i * 26; e.y = mitte.y + (i - 1) * 30; e.hp = 9999; e.revealed = true; });
    setze();
    const pin = setInterval(setze, 60);
    await sleep(2500);
    log(`Gegner im Bild: ${neu.length}; Spieler: ${g.players.map((p) => `${p.name} ${p.zone}`).join(', ')}`);
    log('Figuren aus Sicht von Spieler 1: ' + JSON.stringify(await figInfos(cs[0].page)));
    await paar(cs[0], 'boden-spieler1');
    await paar(cs[1], 'boden-spieler2');
    clearInterval(pin);
    for (const c of ALLE) { c.zu = true; await c.ctx.close(); }
    ALLE.length = 0;
  } finally { await srv.close(); }
}

// Herkunft der Posen: welche Pose-Quelle greift für cha/spieler, die Bestandsfiguren an Bord (lerche/crew_*), am Boden (crew/*) und Gegner?
async function phasePosen(browser) {
  log('\n== Phase posen (Herkunft der Posen je Figur) ==');
  const kurz = (i) => i && { figId: i.figId, gebaut: i.gebaut, skinned: i.skinned, gelenke: i.gelenke, posen: [...new Set(Object.values(i.posen || {}))].join('+') + ' ' + JSON.stringify(i.posen) };
  for (const [modus, port, name] of [['freie_fahrt', PORT + 3, 'Bord'], ['arena_graben', PORT + 4, 'Boden']]) {
    const srv = await startServer({ port, debug: true, ruestphase: false, roomCode: 'off', quiet: true, worlds: true, worldDir: path.join(TMP, 'worlds-posen-' + name) });
    const g = srv.game;
    try {
      const a = await neuerKontext(browser, port, KARTEN[0], 'P1'), b = await neuerKontext(browser, port, null, 'P2');
      await warteBis(() => g.players.length === 2 && g.players[0].karte, 20000, 'zwei Spieler');
      await starte([a, b], modus);
      g.god = true;
      await nur(a); await geladen(a, 300000);
      await nur(b); await geladen(b, 300000);
      if (modus === 'arena_graben') { await cs0gegner(g, b); }
      await nur(b);
      const von = await b.page.evaluate(() => { const o = {}; const st = __game.state || {}; for (const p of st.players || []) o[p.id] = Object.assign({ name: p.name }, window.VoxelActors.figurInfo(p.id)); for (const d of (st.away && st.away.drones) || []) { const i = window.VoxelActors.figurInfo(String(d.id)); if (i) o['gegner ' + d.id] = i; } return o; });
      for (const [k, v] of Object.entries(von)) log(`${name}: ${k} ${v.name || ''} ${JSON.stringify(kurz(v))}`);
    } finally { for (const c of ALLE) { c.zu = true; await c.ctx.close(); } ALLE.length = 0; await srv.close(); }
  }
}
async function cs0gegner(g, c) {
  await nur(c);
  for (let i = 0; i < 2; i++) { await c.page.evaluate(() => __game.dbg('gegner')); await sleep(250); }
  await sleep(2500);
}

async function phaseHeap(browser) {
  log('\n== Phase heap (100 x Outfit wechseln) ==');
  const srv = await startServer({ port: PORT + 2, debug: true, ruestphase: false, roomCode: 'off', quiet: true, worlds: true, worldDir: path.join(TMP, 'worlds-heap') });
  const g = srv.game;
  try {
    const c = await neuerKontext(browser, PORT + 2, KARTEN[0], 'H1');
    await warteBis(() => g.players.length === 1 && g.players[0].karte, 20000, 'Karte am Server');
    await c.page.evaluate(() => { __game.send({ t: 'lobbyOpt', startMission: 'freie_fahrt' }); __game.send({ t: 'ready', ready: true }); });
    await warteBis(() => c.page.evaluate(() => __game.state && __game.state.phase && __game.state.phase !== 'lobby'), 30000, 'Runde läuft');
    await sleep(2500);
    const messe = () => c.page.evaluate(async () => {
      if (window.gc) window.gc();
      await new Promise((r) => setTimeout(r, 300));
      if (window.gc) window.gc();
      const L = VoxelRender.loader, m = performance.memory || {};
      return { heapMB: +(m.usedJSHeapSize / 1048576).toFixed(1), buildCache: L.lib.buildCache.size, figuren: L.lib.store.figures.size, builds: L.stats().builds, lru: L.stats().cached, geometries: VoxelRender.info().geometries, texturen: VoxelRender.info().textures };
    });
    const alle = { vor: await messe() };
    log('vor: ' + JSON.stringify(alle.vor));
    const rnd = (() => { let s = 12345; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();
    const wahl = (platz) => { const t = KAT.teile.filter((x) => x.platz === platz).map((x) => x.id.split('/')[1]); return t[Math.floor(rnd() * t.length)]; };
    const serie = [];
    const N = +process.env.HEAP_N || 100;
    for (let i = 1; i <= N; i++) {
      const o = process.env.HEAP_ZWEI   // Kontrolle: nur zwei Outfits im Wechsel (Cache-Treffer), trennt Neubau-Leck von Cache-Wachstum
        ? (i % 2 ? { kopf: 'bordhelm', oberteil: 'plankenweste', hose: 'germanenhose', schuhe: 'germanenstiefel', haende: 'armschiene', umhang: 'fellumhang' } : STD_OUTFIT)
        : { kopf: wahl('kopf'), oberteil: wahl('oberteil'), hose: wahl('hose'), schuhe: wahl('schuhe'), haende: wahl('haende'), umhang: wahl('umhang') };
      await c.page.evaluate((x) => __game.client.sendeOutfit(x), o);
      await warteBis(() => c.page.evaluate((x) => { const k = __game.client.karten.p1; return !!k && JSON.stringify(k.outfit) === JSON.stringify(x); }, o), 5000, 'Karte beim Client ' + i);
      await sleep(120);
      if (i % (N >= 200 ? 50 : 25) === 0) { const m = await messe(); serie.push([i, m]); log(`nach ${i}: ` + JSON.stringify(m)); }
    }
    alle.serie = serie;
    const eff = await c.page.evaluate(() => window.VoxelActors.figurInfo('p1'));
    log('Figur am Ende: ' + JSON.stringify(eff));
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(path.join(SHOTS, 'heap.json'), JSON.stringify(alle, null, 1));
    await c.ctx.close();
  } finally { await srv.close(); }
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  let code = 0;
  try {
    if (PHASEN.includes('schiff')) await phaseSchiff(browser);
    if (PHASEN.includes('boden')) await phaseBoden(browser);
    if (PHASEN.includes('posen')) await phasePosen(browser);
    if (PHASEN.includes('heap')) await phaseHeap(browser);
  } catch (e) { console.error(e); code = 1; }
  const uniq = [...new Set(fehler)];
  log('\nBrowser-Meldungen: ' + (uniq.length ? '\n  ' + uniq.slice(0, 30).join('\n  ') : 'keine'));
  await browser.close();
  process.exit(code);
}
main();
