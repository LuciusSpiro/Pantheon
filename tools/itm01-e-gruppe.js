#!/usr/bin/env node
// ITM-01 E: Gruppenlauf im echten Browser mit zwei Clients (zwei Browser-Kontexte = zwei Spieler) und einem Nachzügler (Wiederverbinden und dritter Spieler): echter Server (--debug), echte Ereignisse.
// Geprüft: beide sehen nur die passiven Fallen; ein Scan (Stufe 2) enthüllt die verborgenen bei BEIDEN; ein Spieler entschärft (E halten, act), der andere sieht Fortschritt und Ergebnis;
// ein Spieler löst aus, beide sehen Zustand, Feld/Lagezeile und den Selbstschuss (Ereignis kommt bei beiden an); wer nach dem Enthüllen verbindet (Wiederverbinden, dritter Spieler am Boden), sieht die Falle.
//   node tools/itm01-e-gruppe.js [--out shots/itm01-e] [--port 3420] [--render 2d|voxel]
// 2D ist der Standard (im Voxel-Modus ist Headless-Chromium bei gehaltenen Tasten unzuverlässig; hier werden keine Tasten gehalten, nur Nachrichten gesendet). Bilder: <out>/gruppe-*.png.
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; };
const PORT = +arg('port', '3420');
const RENDER = arg('render', '2d');
const OUT = path.resolve(ROOT, arg('out', 'shots/itm01-e'));
const DATEN = path.join(OUT, 'daten-gruppe');
fs.rmSync(DATEN, { recursive: true, force: true });
fs.mkdirSync(DATEN, { recursive: true });
Object.assign(process.env, { WORLD_DIR: path.relative(ROOT, path.join(DATEN, 'worlds')), REGIE_DIR: path.relative(ROOT, path.join(DATEN, 'regie')), ERZEUGT_DIR: path.relative(ROOT, path.join(DATEN, 'erzeugt')), ROOM_CODE: 'off', MISSION_SOURCE: 'fallback' });
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
function playwright() {
  for (const k of [process.env.PLAYWRIGHT_CORE, 'playwright-core', 'C:/tmp/pw-test/node_modules/playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* nächster */ } }
  console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE).'); process.exit(2);
}
const { chromium } = playwright();
const { startServer } = require('../server/index.js');
const W = require('../server/world.js');
const Anker = require('../server/sim/anker.js');
const Fallen = require('../server/sim/fallen.js');
const Buehne = require('../shared/buehne.js');
const Physics = require('../shared/physics.js');
const interior = require('../server/sim/interior.js');
const combat = require('../server/sim/combat.js');
let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await startServer({ port: PORT, debug: true, roomCode: 'off', quiet: true });
  const game = srv.game;
  const b = await chromium.launch();
  const err = [];
  try {
    const neuerClient = async (name, ctx) => {
      const c = ctx || await b.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await c.newPage();
      page.on('pageerror', (e) => err.push(name + ' pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error') err.push(name + ' console: ' + m.text().slice(0, 240)); });
      await page.goto(`http://127.0.0.1:${PORT}/?render=${RENDER}&debug=1`);
      await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000, polling: 20 });
      return { name, ctx: c, page };
    };
    const A = await neuerClient('A');
    const B = await neuerClient('B');
    await sleep(1200);
    for (const C of [A, B]) await C.page.evaluate(() => __game.send({ t: 'ready', ready: true }));
    await A.page.evaluate(() => __game.send({ t: 'lobbyOpt', skipDrill: true }));
    await A.page.evaluate(() => __game.send({ t: 'ready', ready: true }));
    await A.page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await sleep(2500);
    ok(game.players.length === 2 && game.players.every((q) => q.connected !== false), 'zwei verbundene Spieler (' + game.players.map((q) => q.name).join(', ') + ')');
    await A.page.evaluate(() => __game.dbg('buehne aussenposten 1 - rostmeute intakt'));
    for (const C of [A, B]) await C.page.waitForFunction(() => { const st = __game.state, me = st && st.players.find((q) => q.id === __game.pid); return !!(me && me.zone === 'away' && st.away && Shared_Maps[st.away.map] && Shared_Maps[st.away.map].buehne); }, null, { timeout: 60000, polling: 40 }).catch(() => null);
    const pA = game.players.find((q) => q.conn && q === game.players[0]), pB = game.players[1];
    console.log('  Zonen: A=' + pA.zone + ' B=' + pB.zone);
    if (pB.zone !== 'away') { interior.placeOnAwayPad(game, pB, 1); combat.onArrive(game, pB); }
    for (const C of [A, B]) await C.page.waitForFunction(() => { const st = __game.state, me = st && st.players.find((q) => q.id === __game.pid); return !!(me && me.zone === 'away' && st.away && Shared_Maps[st.away.map] && Shared_Maps[st.away.map].buehne); }, null, { timeout: 30000, polling: 40 });
    game.god = true;
    await sleep(1000);

    // Fallen setzen (alle sechs, wie itm01-e-shots.js), die Karte wird neu gesendet
    const aw = game.away, K = W.AWAY_MAPS[aw.map].karte, Ra = Buehne.raster(K);
    const mitte = Physics.toTile(pA.x, pA.y);
    const belegt = new Set(K.anker.map((a) => a.x + ',' + a.y));
    const ring = [[3, 0], [0, 3], [3, 3], [0, -3], [-3, 3], [3, -3], [4, 1], [-1, 4], [1, 4], [-1, -4]];
    const frei = ring.map(([dx, dy]) => ({ x: mitte.x + dx, y: mitte.y + dy })).filter((t) => { const i = Ra.info(t.x, t.y); return i && i.kante === 'begehbar' && Ra.durchgang(t.x, t.y) && !belegt.has(t.x + ',' + t.y); });
    const liste = [['druck', 'passiv'], ['schuss', 'passiv'], ['schott', 'passiv'], ['druck', 'verborgen'], ['schuss', 'verborgen'], ['schott', 'verborgen']];
    liste.forEach(([typ, sicht], i) => K.anker.push({ id: 'falle.e' + (i + 1), rolle: 'falle', x: frei[i].x, y: frei[i].y, typ, sicht }));
    Fallen.standVerwerfen(aw);
    for (const q of game.players) { q.awayKv = null; if (q.awayEnth) delete q.awayEnth[aw.map]; }
    for (const C of [A, B]) await C.page.waitForFunction(() => Shared_Maps[__game.state.away.map].anker.some((a) => a[0] === 'falle.e3'), null, { timeout: 15000, polling: 40 });
    await sleep(800);
    const ids = (C) => C.page.evaluate(() => Shared_Maps[__game.state.away.map].anker.filter((a) => a[1] === 'falle').map((a) => a[0]).join(','));
    const zust = (C) => C.page.evaluate(() => { const st = __game.state, m = Shared_Maps[st.away.map]; return m.anker.map((a, i) => [a[0], a[1], Render.ankerZustand(m, st, i)]).filter((a) => a[1] === 'falle').map((a) => a[0] + '=' + a[2]).join(','); });
    ok(await ids(A) === 'falle.e1,falle.e2,falle.e3' && await ids(B) === 'falle.e1,falle.e2,falle.e3', 'beide Clients kennen nur die drei passiven Fallen');
    // Zähler für Ereignisse in beiden Seiten
    for (const C of [A, B]) await C.page.evaluate(() => { window.__ev = { selbstschuss: 0, falleFeld: 0, ankerEnthuellt: 0 }; const o = Render.fallenEreignis; Render.fallenEreignis = function (ev) { if (ev && window.__ev[ev.kind] != null) window.__ev[ev.kind]++; return o.apply(this, arguments); }; const e0 = Render.ankerEnthuellt; Render.ankerEnthuellt = function (ev) { window.__ev.ankerEnthuellt++; return e0.apply(this, arguments); }; });

    // Scan Stufe 2 durch A: die verborgenen Fallen erscheinen bei BEIDEN
    await A.page.evaluate(() => __game.dbg('scanfertig 2'));
    for (const C of [A, B]) await C.page.waitForFunction(() => Shared_Maps[__game.state.away.map].anker.filter((a) => a[1] === 'falle').length >= 6, null, { timeout: 15000, polling: 40 });
    await sleep(800);
    ok(await ids(A) === await ids(B) && (await ids(A)).split(',').length === 6, 'Scan durch A: B sieht dieselben sechs Fallen in derselben Reihenfolge (' + await ids(A) + ')');
    ok(await zust(A) === await zust(B) && !/verborgen/.test(await zust(A)), 'Zustände bei A und B gleich (' + await zust(A) + ')');
    ok((await A.page.evaluate(() => window.__ev.ankerEnthuellt)) === 3 && (await B.page.evaluate(() => window.__ev.ankerEnthuellt)) === 3, 'beide haben drei ankerEnthuellt verarbeitet');
    await B.page.screenshot({ path: path.join(OUT, RENDER + '-gruppe-b-nach-scan.png') });

    // A entschärft die Druckfalle e1 (E halten), B sieht den Fortschritt und das Ergebnis
    const e1 = K.anker.find((a) => a.id === 'falle.e1');
    pA.x = e1.x * 32 + 16 + 32; pA.y = e1.y * 32 + 16; pA.dir = 'left'; pA.input.mx = 0; pA.input.my = 0;
    pB.x = pA.x; pB.y = pA.y + 64; pB.input.mx = 0; pB.input.my = 0;
    await sleep(600);
    await A.page.evaluate(() => __game.send({ t: 'act', down: true }));
    await B.page.waitForFunction((pid) => { const q = __game.state.players.find((x) => x.id === pid); return q && q.action && q.action.kind === 'anker:falle' && q.action.progress > 0.2; }, game.players.indexOf(pA) >= 0 ? pA.id : null, { timeout: 8000, polling: 30 }).catch(() => null);
    const sehe = await B.page.evaluate((pid) => { const q = __game.state.players.find((x) => x.id === pid); return q && q.action ? { kind: q.action.kind, p: q.action.progress } : null; }, pA.id);
    ok(sehe && sehe.kind === 'anker:falle' && sehe.p > 0, 'B sieht, dass A entschärft (action anker:falle, Fortschritt ' + (sehe && sehe.p) + ')');
    await B.page.screenshot({ path: path.join(OUT, RENDER + '-gruppe-b-sieht-entschaerfen.png') });
    await A.page.waitForFunction(() => /falle\.e1=entschaerft/.test((() => { const st = __game.state, m = Shared_Maps[st.away.map]; return m.anker.map((a, i) => a[0] + '=' + Render.ankerZustand(m, st, i)).join(','); })()), null, { timeout: 8000, polling: 40 });
    await A.page.evaluate(() => __game.send({ t: 'act', down: false }));
    await sleep(700);
    ok(/falle\.e1=entschaerft/.test(await zust(A)) && /falle\.e1=entschaerft/.test(await zust(B)), 'nach 3 s: e1 ist bei A und B entschärft');
    ok((await B.page.evaluate(() => Hud.notices.some((n) => /Falle entschärft/.test(n.text)))), 'B bekommt die Meldung „Falle entschärft“');

    // B löst die Selbstschussanlage e2 aus (Berühren: auf die Kachel daneben laufen lassen = Server-Auslöser), beide sehen Zustand und Schuss
    const e2 = K.anker.find((a) => a.id === 'falle.e2');
    pA.x = e2.x * 32 + 16 + 64; pA.y = e2.y * 32 + 16; pA.input.mx = 0; pA.input.my = 0;   // A steht im Ziel (Mitte zu Mitte <= 8 Kacheln, Sichtlinie)
    pB.x = e2.x * 32 + 16 + 40; pB.y = e2.y * 32 + 16; pB.input.mx = -1; pB.input.my = 0;   // B läuft auf die Anlage zu und berührt sie
    await sleep(1500);
    pB.input.mx = 0;
    await A.page.waitForFunction(() => /falle\.e2=ausgeloest/.test((() => { const st = __game.state, m = Shared_Maps[st.away.map]; return m.anker.map((a, i) => a[0] + '=' + Render.ankerZustand(m, st, i)).join(','); })()), null, { timeout: 8000, polling: 40 }).catch(() => null);
    await sleep(1800);
    ok(/falle\.e2=ausgeloest/.test(await zust(A)) && /falle\.e2=ausgeloest/.test(await zust(B)), 'e2 durch Berühren ausgelöst: beide Clients sehen „ausgelöst“');
    const sa = await A.page.evaluate(() => window.__ev.selbstschuss), sb = await B.page.evaluate(() => window.__ev.selbstschuss);
    ok(sa === 3 && sb === 3, 'Selbstschuss: drei Schuss-Ereignisse bei A (' + sa + ') und bei B (' + sb + ')');
    // Druckfeld: e4 (verborgen, jetzt erkannt) wird von A ausgelöst
    await A.page.evaluate(() => __game.dbg('tune anker.falle.feld.druck.dauer 6'));
    const e4 = K.anker.find((a) => a.id === 'falle.e4');
    Fallen.ausloesen(game, aw, { id: e4.id, x: e4.x, y: e4.y, px: e4.x * 32 + 16, py: e4.y * 32 + 16, typ: 'druck', sicht: 'verborgen', start: 'verborgen' }, pA);
    for (const C of [A, B]) await C.page.waitForFunction(() => Render.fallenLaufend(__game.state).some((x) => x.art === 'feld'), null, { timeout: 6000, polling: 30 });
    await sleep(500);
    ok((await A.page.evaluate(() => window.__ev.falleFeld)) >= 1 && (await B.page.evaluate(() => window.__ev.falleFeld)) >= 1, 'Druckfeld: Ereignis falleFeld bei beiden');
    ok(/falle\.e4=ausgeloest/.test(await zust(A)) && /falle\.e4=ausgeloest/.test(await zust(B)), 'e4 bei beiden ausgelöst');
    ok((await B.page.evaluate(() => Hud.notices.some((n) => /Druckverlust/.test(n.text)))), 'B bekommt den Wirkungstext des Servers („Druckverlust! …“)');
    await B.page.screenshot({ path: path.join(OUT, RENDER + '-gruppe-b-druckfeld.png') });
    for (const C of [A, B]) await C.page.waitForFunction(() => !Render.fallenLaufend(__game.state).some((x) => x.art === 'feld'), null, { timeout: 12000, polling: 100 });
    ok(true, 'Druckfeld endet bei beiden (Ereignis an 0)');

    // Nachzügler 1: Wiederverbinden (B schließt die Seite, gleiche Kennung in neuem Tab desselben Kontexts)
    const alt = await B.page.evaluate(() => __game.pid);
    await B.page.close();
    await sleep(1200);
    const B2 = await neuerClient('B2', B.ctx);
    await sleep(1500);
    // Trennen schickt den Spieler an Bord (Serverregel); danach geht er wieder an den Boden: awayMap und die schon Enthüllten kommen erneut (Fallen.nachreichen)
    const pB2 = game.players.find((q) => q.id === alt);
    console.log('  nach dem Wiederverbinden: Server ' + game.players.map((q) => q.id + ':' + q.zone + ':' + q.connected).join(' '));
    if (pB2.zone !== 'away') { interior.placeOnAwayPad(game, pB2, 1); combat.onArrive(game, pB2); }
    await B2.page.waitForFunction(() => { const st = __game.state, me = st && st.players.find((q) => q.id === __game.pid); return !!(me && me.zone === 'away' && st.away && Shared_Maps[st.away.map] && Shared_Maps[st.away.map].buehne); }, null, { timeout: 30000, polling: 40 });
    await B2.page.waitForFunction(() => Shared_Maps[__game.state.away.map].anker.filter((a) => a[1] === 'falle').length >= 6, null, { timeout: 15000, polling: 40 }).catch(() => null);
    await sleep(800);
    const neuPid = await B2.page.evaluate(() => __game.pid);
    ok(neuPid === alt, 'Wiederverbinden: derselbe Spieler (' + neuPid + ')');
    ok(await ids(B2) === await ids(A) && (await ids(B2)).split(',').length === 6, 'Wiederverbinden nach dem Enthüllen: der Client kennt alle sechs Fallen in derselben Reihenfolge (' + await ids(B2) + ')');
    ok(await zust(B2) === await zust(A), 'Wiederverbinden: Zustände wie bei A (' + await zust(B2) + ')');
    await B2.page.screenshot({ path: path.join(OUT, RENDER + '-gruppe-nachzuegler-wiederverbunden.png') });

    // Nachzügler 2: dritter Spieler tritt der laufenden Partie bei und kommt nach dem Enthüllen an den Boden
    const C3 = await neuerClient('C');
    await sleep(1500);
    const pC = game.players.find((q) => q !== pA && q !== pB);
    ok(!!pC, 'dritter Spieler ist in der laufenden Partie (' + (pC && pC.name) + ', Zone ' + (pC && pC.zone) + ')');
    if (pC) {
      if (pC.zone !== 'away') { interior.placeOnAwayPad(game, pC, 2); combat.onArrive(game, pC); }
      await C3.page.waitForFunction(() => { const st = __game.state, me = st && st.players.find((q) => q.id === __game.pid); return !!(me && me.zone === 'away' && st.away && Shared_Maps[st.away.map] && Shared_Maps[st.away.map].buehne); }, null, { timeout: 30000, polling: 40 }).catch(() => null);
      await C3.page.waitForFunction(() => Shared_Maps[__game.state.away.map] && Shared_Maps[__game.state.away.map].anker.filter((a) => a[1] === 'falle').length >= 6, null, { timeout: 15000, polling: 40 }).catch(() => null);
      await sleep(800);
      ok(await ids(C3) === await ids(A), 'Nachzügler (dritter Spieler): kennt alle sechs Fallen in derselben Reihenfolge (' + await ids(C3) + ')');
      ok(await zust(C3) === await zust(A), 'Nachzügler: Zustände wie bei A (' + await zust(C3) + ')');
      await C3.page.screenshot({ path: path.join(OUT, RENDER + '-gruppe-nachzuegler-dritter-spieler.png') });
    }
    console.log('Konsolenfehler: ' + err.length); err.slice(0, 8).forEach((e) => console.log('  ' + e));
    if (err.length) fails++;
  } finally { await b.close().catch(() => null); await srv.close().catch(() => null); }
  console.log(fails ? '\n' + fails + ' FEHLER' : '\nalle ok');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
