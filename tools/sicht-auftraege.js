// Screenshot + Klicktest SPT-02 5: Captain-Reiter "Aufträge" (Tabs Aktive Missionen / Notrufe), echter Server, Playwright (Bilder: screenshots-spt02/p5-*). Lauf: node tools/sicht-auftraege.js
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const SHOTS = path.join(ROOT, 'screenshots-spt02');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-auftraege-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
process.env.FAEDEN = '1'; process.env.LAGE_SPIELLEITER = '1'; process.env.SPIELLEITER_LLM = 'mock'; process.env.ABENTEUER_ANSCHLUSS = '0';
delete process.env.LLM_LIVE;
const { startServer } = require(ROOT + '/server/index.js');
const Sektoren = require(ROOT + '/shared/sektoren.js');
const Space = require(ROOT + '/server/sim/space.js');
const Faden = require(ROOT + '/server/sim/faden.js');
const Brett = require(ROOT + '/server/sim/abenteuer-brett.js');
const Marken = require(ROOT + '/server/sim/marken.js');
const RE = require(ROOT + '/server/sim/reise-ereignis.js');
const Notrufe = require(ROOT + '/server/sim/notrufe.js');
const LLM = require(ROOT + '/server/mission/llm.js');
const LS = require(ROOT + '/server/sim/lage-spielleiter.js');
const ANSCHLUSS = require(ROOT + '/content/faeden/anschluss.json').plaene;
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('Playwright fehlt'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const klon = (x) => JSON.parse(JSON.stringify(x));
const VPS = [[1280, 720], [1024, 600]];
const NOTRUF = RE.KATALOG.find((e) => e.art === 'notruf' && !e.gefahr);

async function lauf(b, vw, vh, port) {
  const srv = await startServer({ port, debug: true, roomCode: 'off', quiet: true, worlds: true, worldDir: path.join(TMP, 'worlds-' + vw) });
  const g = srv.game; const fehler = []; const tag = vw + 'x' + vh;
  try {
    const page = await (await b.newContext({ viewport: { width: vw, height: vh } })).newPage();
    page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') fehler.push('console: ' + m.text().slice(0, 200)); });
    await page.goto(`http://127.0.0.1:${port}/?render=2d`);
    await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
    await page.evaluate(() => { __game.send({ t: 'lobbyOpt', startMission: 'freie_fahrt' }); __game.send({ t: 'ready', ready: true }); });
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await sleep(500);
    g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;
    g.env.FAEDEN = '1'; g.env.ABENTEUER_ANSCHLUSS = '0';
    g.lageSpielleiter = LS.create(g, { llm: LLM.create({ mode: 'mock' }), werte: { min_abstand_ticks: 1, deckel_je_sitzung: 0 }, abenteuerWerte: { deckel_je_sitzung: 0 } });
    g.lageSchalter = true; g.lageSpielleiter.rueckfallBetrieb = false;
    const shot = async (name, ms) => { await sleep(ms || 700); await page.screenshot({ path: path.join(SHOTS, 'p5-' + tag + '-' + name + '.png') }); console.log('Bild', tag, name); };
    const send = (o) => page.evaluate((m) => __game.send(m), o);
    const dock = (hex) => { Space.enterScene(g, Sektoren.ortVonHex(hex), {}); Object.assign(g.ship, { docked: true, dockedAt: Sektoren.ortVonHex(hex), vx: 0, vy: 0, speed: 0 }); };
    dock('0305'); g.inventory.marks = 500;
    const Fz = () => Faden.zustandVon(g);
    // drei laufende Abenteuer
    for (const i of [2, 3, 0]) { const r = Faden.abenteuerAnbieten(g, klon(ANSCHLUSS[i]), { hex: '0305' }); if (!r.ok) { fehler.push('anbieten ' + i + ' ' + r.grund); continue; } const e = Brett.annehmen(g, 'a' + r.angebot.nr); if (e) fehler.push('annehmen ' + i + ' ' + JSON.stringify(e)); }
    // drei Takt-Notrufe: A am Brett, B angenommen (Notruf-Faden), C ohne Angebot; dazu zwei Kampagnen-Notrufe
    const R = g.weltsim.reise;
    const takt = (nr, hex, mitAngebot) => {
      const marke = 'reise:n' + nr;
      R.offen.push({ nr, id: NOTRUF.id, hex, bis: Number.MAX_SAFE_INTEGER, bisUhr: R.taktUhr + 1e7, marke, ev: { nr, id: NOTRUF.id, hex, art: 'notruf' }, takt: true });
      Marken.setze(g, { id: marke, typ: 'notruf', hex, ticks: 900 / 30 });
      if (!mitAngebot) return null;
      return Brett.notrufAnbieten(g, { nr, id: NOTRUF.id, hex, variante: NOTRUF.parameter.variante, sprecher: 'Kutter Fortuna', marke, ankunft: '0305' });
    };
    const A = takt(11, '0603', true), B = takt(12, '0504', true); takt(13, '0403', false);
    if (!A || !B) fehler.push('Notruf-Angebote fehlen');
    else { const e = Brett.annehmen(g, 'a' + B.nr); if (e) fehler.push('Notruf annehmen: ' + JSON.stringify(e)); }
    Notrufe.freischalten(g, 'sl_klar,sl_echt');
    g.step(); await sleep(300);
    await send({ t: 'debug', cmd: 'sitz', console: 'captain' }); await sleep(900);
    const st = await page.evaluate(() => ({ marken: StarMap.marken, nr: (__game.state.nr || []).length, laufend: (Brett.modell() || {}).laufend && Brett.modell().laufend.length, ang: (Brett.modell() || {}).angebote && Brett.modell().angebote.length }));
    console.log(tag, JSON.stringify(st));
    await page.evaluate(() => { Consoles.tab = 5; NotrufView.setzeTab('aktiv'); });
    await shot('01-tab-aktive-missionen', 9000);
    await page.keyboard.press('KeyD'); await sleep(500);
    let z = await page.evaluate(() => NotrufView.zustand().tab); if (z !== 'notruf') fehler.push('Taste D wechselt nicht zum Tab Notrufe: ' + z);
    await shot('02-tab-notrufe-kampagne', 700);
    for (let i = 0; i < 2; i++) await page.keyboard.press('KeyS');
    await shot('03-tab-notrufe-takt-am-brett', 600);
    await page.keyboard.press('KeyS'); await shot('04-tab-notrufe-takt-angenommen', 500);
    await page.keyboard.press('KeyS'); await shot('05-tab-notrufe-takt-ohne-angebot', 500);
    await page.keyboard.press('KeyA'); await sleep(400);
    z = await page.evaluate(() => NotrufView.zustand().tab); if (z !== 'aktiv') fehler.push('Taste A wechselt nicht zurück: ' + z);
    await page.keyboard.press('ArrowRight'); await sleep(300);
    z = await page.evaluate(() => NotrufView.zustand().tab); if (z !== 'notruf') fehler.push('Pfeil rechts wechselt nicht: ' + z);
    // Klick auf die Tab-Knöpfe: Position über R.ui.buttons
    const btn = async (label) => page.evaluate((l) => { const b = Render.ui.buttons.find((x) => x.label && x.label.indexOf(l) === 0); return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null; }, label);
    const cv = await page.evaluate(() => { const c = document.getElementById('game'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, vw: Render.VW || 640, vh: Render.VH || 360 }; });
    const klick = async (bx) => { await page.mouse.click(cv.x + (bx.x + bx.w / 2) * cv.w / cv.vw, cv.y + (bx.y + bx.h / 2) * cv.h / cv.vh); await sleep(400); };
    const ba = await btn('Aktive Missionen');
    if (!ba) fehler.push('Tab-Knopf Aktive Missionen nicht gefunden'); else { await klick(ba); z = await page.evaluate(() => NotrufView.zustand().tab); if (z !== 'aktiv') fehler.push('Klick auf Tab Aktive Missionen wirkt nicht: ' + z); }
    const bn = await btn('Notrufe');
    if (!bn) fehler.push('Tab-Knopf Notrufe nicht gefunden'); else { await klick(bn); z = await page.evaluate(() => NotrufView.zustand().tab); if (z !== 'notruf') fehler.push('Klick auf Tab Notrufe wirkt nicht: ' + z); }
    console.log(tag, 'Tab-Klicks ok', !!ba, !!bn, JSON.stringify(ba), JSON.stringify(cv));
    // Karten-Klick auf eine Marke: Sternkarte, Plakette von reise:n11
    await page.evaluate(() => { Consoles.tab = 1; NotrufView.setzeTab('aktiv'); });
    console.log(tag, 'offen', JSON.stringify(g.weltsim.reise.offen.map((o) => o.marke)), 'marken', JSON.stringify(g.marken.map((m) => m.id)));
    await shot('06-sternkarte-mit-marken', 900);
    const mk = await page.evaluate(() => { const o = {}; for (const id of ['reise:n11', 'reise:n12', 'reise:n13', 'notruf:sl_klar', 'notruf:sl_echt']) { const l = StarMap.markeAn ? null : null; void l; } return null; });
    void mk;
    const pos = await page.evaluate(() => {
      // Plaketten-Mitten aus dem zuletzt gezeichneten Layout (store ist privat): Probe über das Raster der Karte
      const rects = Consoles.starRects; const sum = {}; const out = {};
      for (let y = 40; y < 330; y += 2) for (let x = 10; x < 630; x += 2) { const m = StarMap.markeAn(x, y, rects); if (m) { const q = sum[m.id] || (sum[m.id] = { x: 0, y: 0, n: 0 }); q.x += x; q.y += y; q.n++; } }
      for (const id of Object.keys(sum)) out[id] = { x: sum[id].x / sum[id].n, y: sum[id].y / sum[id].n };
      return out;
    });
    console.log(tag, 'Marken-Treffer', JSON.stringify(pos));
    for (const id of ['reise:n11', 'reise:n12', 'reise:n13', 'notruf:sl_klar']) {
      if (!pos[id]) { fehler.push('Marke ' + id + ' nicht anklickbar'); continue; }
      await page.evaluate(() => { Consoles.tab = 1; NotrufView.setzeTab('aktiv'); }); await sleep(500);
      await page.mouse.click(cv.x + pos[id].x * cv.w / cv.vw, cv.y + pos[id].y * cv.h / cv.vh); await sleep(500);
      const r = await page.evaluate(() => ({ tab: Consoles.tab, v: NotrufView.zustand() }));
      if (r.tab !== 5 || r.v.tab !== 'notruf' || r.v.wahl.notruf !== id.replace(/^notruf:/, '')) fehler.push('Klick auf ' + id + ' öffnet nicht den Eintrag: ' + JSON.stringify(r));
      else console.log(tag, 'Klick', id, 'ok', JSON.stringify(r.v));
      if (id === 'reise:n12') await shot('07-klick-auf-marke-n12-oeffnet-notrufe', 300);
      if (id === 'notruf:sl_klar') await shot('08-klick-auf-kampagnen-marke', 300);
    }
    // Pseudo-Eintrag: nach einem beendeten Faden; Enter/X tun nichts
    const f = Fz().liste.find((x) => x.plan && !x.notruf);
    if (f) { f.zaehler = f.abstand; }
    await page.evaluate(() => { Consoles.tab = 5; NotrufView.setzeTab('aktiv'); });
    const vor = await page.evaluate(() => JSON.stringify(__game.state.nr || null));
    await page.keyboard.press('Enter'); await page.keyboard.press('KeyX'); await sleep(500);
    const nach = await page.evaluate(() => JSON.stringify(__game.state.nr || null));
    if (vor !== nach) fehler.push('Enter/X im Tab Aktive Missionen veränderte nr');
  } finally { try { if (srv.close) srv.close(); } catch (e) { /* egal */ } }
  return fehler;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const b = await chromium.launch(); const alle = [];
  try { let port = 3541; for (const [vw, vh] of VPS) alle.push(...(await lauf(b, vw, vh, port++))); } finally { await b.close(); }
  if (alle.length) { console.log('Fehler:\n' + [...new Set(alle)].join('\n')); process.exit(1); }
  console.log('ok'); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
