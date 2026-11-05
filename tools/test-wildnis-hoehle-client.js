#!/usr/bin/env node
'use strict';
// GEL-02 C: Browserlauf mit dem ECHTEN Erzeuger (Wildnis mit Höhle, mittel) über die Testgelände-URL
//   ?arena=away&art=wildnis&seed=<n>&biom=<b>&groesse=mittel&hoehle=1&render=voxel&debug=1
// Je Biom: Karte kommt mit decks und Leiter an, Fahrt 0 -> 1 -> 0 (E halten), Stimmung wechselt mit dem Deck, Bilder nach shots/gel02/, keine Konsolen- und Serverfehler.
//   node tools/test-wildnis-hoehle-client.js      (Umgebung: BIOME=vulkan,wueste  SEED=3)
// Fehlt playwright-core oder public/voxel, läuft nichts (Hinweis SKIP, Ausgang 0).
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const Physics = require('../shared/physics.js');
const W = require('../server/world.js');
const Gelaende = require('../shared/gen-gelaende.js');
const OUT = path.join(ROOT, 'shots', 'gel02');
let n = 0, bad = 0;
const ok = (c, t) => { n++; if (!c) { bad++; console.log('  FEHLER ' + t); } else console.log('  ok   ' + t); };
const abschnitt = (t) => console.log('[' + t + ']');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BIOME = (process.env.BIOME ? process.env.BIOME.split(',') : Gelaende.BIOME);
const SEED = +process.env.SEED || 3;

function playwright() {
  for (const k of [process.env.PLAYWRIGHT_CORE, 'playwright-core', 'C:/tmp/pw-test/node_modules/playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* nächster */ } }
  return null;
}
const IM_BROWSER = {
  render: () => {
    const S = VoxelRender.renderer.state(); const c = (o) => (o && o.getHexString ? '#' + o.getHexString() : null);
    return { moodId: S.moodId, shownDeck: S.shownDeck, hoehleAn: !!S.hoehleAn, bg: c(S.scene.background), fog: S.scene.fog ? c(S.scene.fog.color) : null, fogNF: S.scene.fog ? [S.scene.fog.near, S.scene.fog.far] : null, hemi: S.hemi.intensity, sun: S.sun.intensity, lift: S.lift && S.lift.phase };
  },
  kit: () => { const s = VoxelKit.stats(); return { id: s.id, art: s.art, tris: s.tris, bewuchs: s.bewuchs, platzhalter: s.platzhalter || {}, fehler: s.fehler }; },
  karte: () => { const m = Shared_Maps[__game.state.away.map]; const k = m.karte || m; return { art: k.art, w: k.w, h: k.h, decks: k.decks, boden2: (k.meta || {}).boden2 || k.boden2 || null, anker: k.anker.filter((a) => a.rolle === 'leiter') }; },
};
const deckVon = (page) => page.evaluate(() => __game.state.players.find((p) => p.id === __game.pid).deck);

async function lauf(chromium, startServer, biom) {
  abschnitt(`Browser: Wildnis ${biom} mittel mit Höhle (Seed ${SEED}, echter Erzeuger über die URL)`);
  const srv = await startServer({ port: 0, quiet: true, noStore: true, roomCode: 'off', debug: true });
  const g = srv.game;
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const fehler = [];
  try {
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') fehler.push('console: ' + m.text().slice(0, 240)); });
    await page.goto(`http://127.0.0.1:${srv.port}/?arena=away&art=wildnis&seed=${SEED}&biom=${biom}&groesse=mittel&hoehle=1&render=voxel&debug=1`);
    await page.waitForFunction(() => window.__game && __game.send && __game.state && __game.state.phase === 'lobby', null, { timeout: 30000, polling: 40 });
    await sleep(1500);   // der Client schickt lobbyOpt { arena } beim ersten Lobby-Snapshot
    await page.evaluate(() => __game.send({ t: 'lobbyOpt', skipDrill: true }));
    await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
    await page.waitForFunction(() => { const st = window.__game && __game.state, me = st && st.players && st.players.find((p) => p.id === __game.pid); return !!(me && me.zone === 'away' && st.away && window.Shared_Maps && Shared_Maps[st.away.map] && Shared_Maps[st.away.map].buehne); }, null, { timeout: 60000, polling: 40 });
    await page.waitForFunction(() => { const s = window.VoxelKit && VoxelKit.stats(); return !!(s && s.id === __game.state.away.map); }, null, { timeout: 120000, polling: 40 });
    await sleep(1500);
    await page.evaluate(() => __game.dbg('god on'));
    const km = await page.evaluate(IM_BROWSER.karte);
    ok(km.art === 'wildnis' && km.w === 80 && km.h === 98 && km.decks && km.decks.stride === 56 && km.decks.links.length === 1, `Client bekommt die Karte: ${km.art} ${km.w}x${km.h}, stride ${km.decks && km.decks.stride}, ein Link ${km.decks && JSON.stringify(km.decks.links[0])}`);
    const P = g.players[0];
    const platz = (tx, ty) => { const c = Physics.tileCenter(tx, ty); P.x = c.x; P.y = c.y; P.dir = 'up'; P.input.mx = 0; P.input.my = 0; };
    const lo = km.decks.links[0].a, lu = km.decks.links[0].b;
    const fahren = async (ziel) => {
      await page.evaluate(() => __game.send({ t: 'act', down: true }));
      let r = null;
      for (let i = 0; i < 120; i++) { await sleep(100); const d = await deckVon(page); r = await page.evaluate(IM_BROWSER.render); if (d === ziel && r.lift === 'idle' && r.shownDeck === ziel) break; }
      await page.evaluate(() => __game.send({ t: 'act', down: false }));
      await sleep(800);
      return r;
    };
    platz(lo[0], lo[1] + 2); await sleep(1500);
    const oben = await page.evaluate(IM_BROWSER.render), kit0 = await page.evaluate(IM_BROWSER.kit);
    await page.screenshot({ path: path.join(OUT, `wildnis-hoehle-mittel-${biom}-deck0.png`) });
    ok(!oben.hoehleAn && oben.shownDeck === 0 && /^wildnis_/.test(oben.moodId), `Deck 0: Stimmung der Wildnis (${oben.moodId})`);
    ok(kit0.fehler === 0 && !kit0.platzhalter.boden && !kit0.platzhalter.boden2, `Deck 0: keine Kit-Fehler, kein Boden-Platzhalter (${JSON.stringify(kit0.platzhalter)})`);
    // Einstieg: an der Leiter
    platz(lo[0], lo[1]); await sleep(1200);
    await page.screenshot({ path: path.join(OUT, `wildnis-hoehle-mittel-${biom}-leiter.png`) });
    const runter = await fahren(1);
    await page.screenshot({ path: path.join(OUT, `wildnis-hoehle-mittel-${biom}-deck1.png`) });
    const pl = g.players[0], t = Physics.toTile(pl.x, pl.y);
    ok(await deckVon(page) === 1 && runter.shownDeck === 1 && runter.hoehleAn, `Fahrt nach unten: players[].deck 1, Client zeigt Deck 1 mit Höhlenstimmung`);
    ok(Math.abs(t.x - lu[0]) <= 1 && Math.abs(t.y - lu[1]) <= 1, `Ankunft am unteren Leiter-Ende (${t.x},${t.y}) / (${lu[0]},${lu[1]})`);
    ok(runter.fog === '#10141b' && runter.bg === '#0c0f14' && runter.fogNF[1] < oben.fogNF[1], `Höhle dunkler und enger (Nebel ${runter.fog}, Nebelende ${oben.fogNF[1]} -> ${runter.fogNF[1]})`);
    // ein Fundort unten
    const ks = W.AWAY_MAPS[g.away.map].karte;   // Serverkarte (der Client bekommt in awayMap nur die Anker, die er braucht)
    const fund = ks.anker.filter((a) => a.rolle === 'fund' && a.y >= ks.decks.stride).map((a) => [a.x, a.y]);
    ok(fund.length >= 2, `Fundorte im Höhlendeck: ${fund.length}`);
    platz(fund[0][0], fund[0][1]); await sleep(1500);
    await page.screenshot({ path: path.join(OUT, `wildnis-hoehle-mittel-${biom}-deck1-fund.png`) });
    // Übersicht des Decks
    platz(lu[0], lu[1]); await sleep(500);
    await page.addStyleTag({ content: '#game { visibility: hidden !important; }' }).catch(() => null);
    await page.setViewportSize({ width: 1600, height: 900 }); await sleep(600);
    await page.evaluate(([cx, cz, h]) => { const R = VoxelRender.renderer; R.state().scene.fog = null; if (window.Render) window.Render.teamVision = () => null; R.setSeat({ pos: [cx, h, cz + h * 0.95], look: [cx, 0, cz], fov: 45 }); }, [km.w / 2, 42 / 2 + 1, 44]);   // der Client zeigt das Deck 1 auf z 0..41 (shownDeck), nicht auf z 56..97
    await sleep(2500);
    await page.screenshot({ path: path.join(OUT, `wildnis-hoehle-mittel-${biom}-deck1-uebersicht.png`) });
    await page.evaluate(() => VoxelRender.renderer.setSeat(null));
    await page.setViewportSize({ width: 1280, height: 720 });
    // zurück
    platz(lu[0], lu[1]); await sleep(300);
    const hoch = await fahren(0);
    await page.screenshot({ path: path.join(OUT, `wildnis-hoehle-mittel-${biom}-deck0-zurueck.png`) });
    ok(await deckVon(page) === 0 && hoch.shownDeck === 0 && !hoch.hoehleAn && hoch.moodId === oben.moodId && hoch.fog === oben.fog, 'Rückfahrt: deck 0, Wildnisstimmung wie vorher');
    ok(fehler.length === 0, `keine Konsolenfehler (${fehler.length}${fehler[0] ? ': ' + fehler[0] : ''})`);
    ok(g.errors === 0 || (Array.isArray(g.errors) && !g.errors.length), `keine Serverfehler (${Array.isArray(g.errors) ? g.errors.length : g.errors})`);
  } finally { await b.close().catch(() => null); await srv.close(); }
}

(async () => {
  const pw = playwright();
  if (!pw || !fs.existsSync(path.join(ROOT, 'public', 'voxel', 'manifest.json'))) { console.log('SKIP (playwright-core oder public/voxel fehlt)'); return; }
  const { startServer } = require('../server/index.js');
  fs.mkdirSync(OUT, { recursive: true });
  for (const biom of BIOME) await lauf(pw.chromium, startServer, biom);
  console.log(`${n - bad}/${n} Prüfungen grün`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FEHLER', e && e.stack || e); process.exit(1); });
