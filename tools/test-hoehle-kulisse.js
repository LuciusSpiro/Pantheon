#!/usr/bin/env node
'use strict';
// GEL-02 E2: Kulisse der Höhle (public/js/voxel/hoehle-kulisse.js): Schacht am Eingang, Pilze/Kristalle/Glutrisse, Glutring unter dem Fund.
//   node tools/test-hoehle-kulisse.js [--ohne-browser] [--out shots/gel02]
// Ohne Browser: Platzierung rein aus der Karte (Echt-Erzeuger Wildnis mit Höhle, mittel, und art hoehle): deterministisch, nur in/auf Fels bzw. flach (<= 0,2 m),
//   Dichten über 50 Seeds, Dreiecksbudget, Karten ohne Erdboden bleiben leer.
// Mit Browser (playwright-core, Software-GL, public/voxel): Wildnis mit Höhle (3 Biome, Seed 3, mittel) und art hoehle mittel: 0 Konsolen- und 0 Kit-Fehler, Schacht gezeichnet
//   (Anker leiter auf Deck 0 ohne Schiffs-Prop), Bilder nach shots/gel02/ (gitignored). Fehlt playwright-core oder public/voxel, läuft nur der Teil ohne Browser.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..');
const Gelaende = require('../shared/gen-gelaende.js');
const Hoehle = require('../shared/gen-hoehle.js');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; };
const OUT = path.resolve(ROOT, arg('out', 'shots/gel02'));
let n = 0, bad = 0;
const ok = (c, t) => { n++; if (!c) { bad++; console.log('  FEHLER ' + t); } else if (process.env.VERBOSE) console.log('  ok   ' + t); };
const abschnitt = (t) => console.log('[' + t + ']');
const info = (t) => console.log('  ' + t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const imp = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const Z = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/buehnen/kacheln.json'), 'utf8').replace(/^﻿/, '')).zeichen;
const BIOME = Gelaende.BIOME;

// Karte -> Eingabe von platziere(): Stride, Biom, kindAt wie kit.js normKarte; felsHoehe = 1 (Fels mit begehbarer Südkachel ist niedrig)
function sicht(roh, art, seed) {
  const kindAt = (x, y) => { const c = roh.rows[y] && roh.rows[y][x]; return c ? (Z[c] || {}).kind : null; };
  return { art, w: roh.w, h: roh.h, seed, stride: roh.decks ? roh.decks.stride : 0, boden: (roh.meta && roh.meta.boden) || null, kindAt, felsHoehe: () => 1, anker: roh.anker };
}
const wildnisMitHoehle = (biom, seed) => sicht(Gelaende.erzeuger().karteRoh(seed, { biom, groesse: 'mittel', hoehle: true }), 'wildnis', seed * 7919 + 17);
const nurHoehle = (seed) => sicht(Hoehle.erzeuger().karteRoh(seed, { groesse: 'mittel' }), 'hoehle', seed * 7919 + 17);

function alleBoxen(K, p, k) {
  const out = [];
  for (const [key, nis] of p.nischen) { const [x, y] = key.split(',').map(Number); out.push({ art: 'nische', x, y, boxen: K.nischeBoxen(nis) }); }
  for (const c of p.kristalle) out.push({ art: 'kristall', x: c.x, y: c.y, H: c.H, boxen: c.boxen });
  return out;
}

async function ohneBrowser() {
  const K = await imp('public/js/voxel/hoehle-kulisse.js');
  const kit = fs.readFileSync(path.join(ROOT, 'public/js/voxel/kit.js'), 'utf8');

  abschnitt('(a) deterministisch');
  const kA = wildnisMitHoehle('wueste', 3);
  const j = (p) => JSON.stringify([[...p.nischen.entries()], p.kristalle]);
  ok(j(K.platziere(kA)) === j(K.platziere(kA)), 'zweimal dieselbe Platzierung (gleiche Karte, gleicher Seed)');
  ok(j(K.platziere(Object.assign({}, kA, { seed: kA.seed + 1 }))) !== j(K.platziere(kA)), 'anderer Karten-Seed: andere Platzierung');
  ok(!/Math\.random/.test(fs.readFileSync(path.join(ROOT, 'public/js/voxel/hoehle-kulisse.js'), 'utf8').replace(/\/\/.*$/gm, '')), 'hoehle-kulisse.js nutzt kein Math.random');
  ok(JSON.stringify(K.schachtOben('wueste')) === JSON.stringify(K.schachtOben('wueste')), 'Schacht: gleiche Boxen bei jedem Aufruf');

  abschnitt('(b) alles in/auf Fels oder flach, nie hoch auf begehbarer Kachel');
  const karten = [];
  for (const biom of BIOME) for (const s of [3, 4, 7, 11]) karten.push({ name: `${biom} ${s}`, k: wildnisMitHoehle(biom, s) });
  for (const s of [3, 5]) karten.push({ name: `hoehle ${s}`, k: nurHoehle(s) });
  const WALK = { boden: 1, boden2: 1, gelaende: 1 };
  let nNische = 0, nKristall = 0, maxFlach = 0, tisch = {};
  for (const { name, k } of karten) {
    const p = K.platziere(k), stride = k.stride;
    let f = 0;
    for (const e of alleBoxen(K, p, k)) {
      const typ = k.kindAt(e.x, e.y);
      if (typ !== 'fels') f++;
      if (stride && e.y < stride) f++;                                              // nie auf Deck 0 der Wildnis
      for (const b of e.boxen) {
        if (!(b.x0 >= -0.5 && b.x1 <= 0.5 && b.z0 >= -0.5 && b.z1 <= 0.5 && b.x0 <= b.x1 && b.y0 <= b.y1 && b.z0 <= b.z1)) f++;   // nichts über die Kachelgrenze
        if (b.emit && b.z1 > 0.48 && e.art === 'nische') f++;                      // Leuchtfarbe bleibt hinter der Südkante (z 0,38..0,48)
      }
      if (e.art === 'nische') {
        nNische++;
        if (!WALK[k.kindAt(e.x, e.y + 1)]) f++;                                    // begehbare Südkachel
        if (stride && Math.floor((e.y + 1) / stride) !== Math.floor(e.y / stride)) f++;
        for (const b of e.boxen) if (b.z0 < 0.37 || b.y0 < -0.01 || b.y1 > 1.0) f++;   // innerhalb der untersten Felsschicht (1 m), hinter der Südkante
      } else {
        nKristall++;
        for (const b of e.boxen) { if (b.y0 < e.H - 1e-9 || b.y1 > e.H + 0.6 + 1e-9) f++; if (Math.abs(b.x0) > 0.4 || Math.abs(b.x1) > 0.4 || Math.abs(b.z0) > 0.4 || Math.abs(b.z1) > 0.4) f++; }   // sitzt auf dem Fels, 0,3..0,6 m, in der Kachel
        const h = Math.max(...e.boxen.map((b) => b.y1)) - e.H;
        if (h < 0.29 || h > 0.61) f++;
      }
    }
    if (f) { bad++; n++; console.log(`  FEHLER ${name}: ${f} Platzierungen verletzen die Kollisionsregel`); } else n++;
  }
  info(`${karten.length} Karten, ${nNische} Nischen (Pilze/Glutrisse), ${nKristall} Kristallgruppen geprüft`);
  // flache Teile: Schacht, Lichtfleck, Glutring
  for (const [name, boxen] of [['Schacht wueste', K.schachtOben('wueste')], ['Schacht gras', K.schachtOben('gras')], ['Schacht vulkan', K.schachtOben('vulkan')], ['Lichtfleck', K.lichtfleck()], ['Glutring', K.glutring()]]) {
    const hoch = Math.max(...boxen.map((b) => b.y1));
    maxFlach = Math.max(maxFlach, hoch);
    ok(hoch <= K.FLACH_MAX + 1e-9, `${name}: höchstens ${K.FLACH_MAX} m (${hoch.toFixed(3)} m)`);
    ok(boxen.every((b) => b.x0 >= -0.5 && b.x1 <= 0.5 && b.z0 >= -0.5 && b.z1 <= 0.5), `${name}: innerhalb der Kachel`);
  }
  const so = K.schachtOben('wueste');
  ok(Math.max(...K.glutring().map((b) => b.y1)) === 0.02 && K.glutring().every((b) => b.emit), 'Glutring: 0,02 m hoch, leuchtend');
  ok(K.lichtfleck().length === 1 && K.lichtfleck()[0].emit && K.lichtfleck()[0].y1 === 0.004 && K.lichtfleck()[0].x1 - K.lichtfleck()[0].x0 === 0.9, 'Lichtfleck: 0,9 x 0,9 m auf y 0,004, leuchtend');
  ok(so[0].x1 - so[0].x0 === 0.8 && so[0].z1 - so[0].z0 === 0.8 && so[0].y0 === -0.02 && so[0].y1 === 0.005 && !so[0].emit, 'Schachtloch: 0,8 x 0,8, y -0,02..0,005, nicht leuchtend');
  ok(so.filter((b) => b.c.hex === K.SCHACHT_RAND.wueste).length === 12, 'Schachtrand: 12 Steine im Biomton');
  ok(!so.some((b) => b.emit), 'Schacht: nichts leuchtet');

  abschnitt('(c) Dichten über 50 Seeds (mittel)');
  let sumB = 0, sumP = 0, sumK = 0, sumR = 0, sumTris = 0, minP = 1e9, maxP = 0, anz = 0, sumKr = 0;
  for (let s = 1; s <= 50; s++) {
    const biom = BIOME[s % 3], k = wildnisMitHoehle(biom, s), p = K.platziere(k);
    sumB += p.begehbar; sumP += p.pilze.length; sumR += p.risse.length; sumK += p.kristalle.length; anz++;
    const cl = p.pilze.length + p.risse.length; minP = Math.min(minP, cl); maxP = Math.max(maxP, cl);
    let t = 0; for (const e of alleBoxen(K, p, k)) t += K.dreiecke(e.boxen);
    // abzüglich der Südfläche, die die Nische ersetzt (2 Dreiecke je Nische)
    t -= 2 * p.nischen.size; sumTris += t;
    sumKr += p.kristalle.reduce((a, c) => a + K.dreiecke(c.boxen), 0);
  }
  const dP = (sumP + sumR) / (sumB / 50), dK = sumK / (sumB / 150);
  info(`mittel: ${(sumB / anz).toFixed(0)} begehbare Kacheln je Karte; Pilz-/Rissgruppen Ø ${((sumP + sumR) / anz).toFixed(1)} (min ${minP}, max ${maxP}), Kristallgruppen Ø ${(sumK / anz).toFixed(1)}`);
  ok(dP > 0.9 && dP < 1.1, `Pilze/Glutrisse: 1 Gruppe je ${(sumB / (sumP + sumR)).toFixed(1)} begehbare Kacheln (Soll ca. 50)`);
  ok(dK > 0.85 && dK < 1.15, `Kristalle: 1 Gruppe je ${(sumB / sumK).toFixed(0)} begehbare Kacheln (Soll ca. 150)`);
  abschnitt('(d) Dreiecksbudget');
  info(`zusätzliche Dreiecke je Karte (Ø über 50 Seeds, mittel): ${(sumTris / anz).toFixed(0)} (davon Kristalle ${(sumKr / anz).toFixed(0)}); Ziel unter 6000`);
  ok(sumTris / anz < 6000, `zusätzliche Dreiecke Ø ${(sumTris / anz).toFixed(0)} < 6000`);

  abschnitt('(e) nur Karten mit Erdboden, nur unter der Erde');
  const leer = (p) => !p.aktiv && p.nischen.size === 0 && p.kristalle.length === 0 && p.pilze.length === 0 && p.risse.length === 0;
  const ohneDeck = Object.assign({}, kA, { stride: 0 });
  ok(leer(K.platziere(ohneDeck)), 'Wildnis ohne Deck: leere Kulisse');
  for (const art of ['aussenposten', 'station', 'schiff', 'ruine']) ok(leer(K.platziere(Object.assign({}, kA, { art, stride: art === 'aussenposten' ? kA.stride : 0 }))), `art ${art}: leere Kulisse (auch mit Decks beim Bunker)`);
  const pk = K.platziere(kA);
  ok(pk.aktiv && [...pk.nischen.keys()].every((q) => +q.split(',')[1] >= kA.stride) && pk.kristalle.every((c) => c.y >= kA.stride), 'Wildnis mit Deck: Kulisse nur auf Deck >= 1, nie auf Deck 0');
  ok(K.leiterEnde(ohneDeck, 5) === null && K.leiterEnde(Object.assign({}, kA, { art: 'aussenposten' }), 5) === null && K.leiterEnde(Object.assign({}, kA, { art: 'schiff', stride: 16 }), 20) === null, 'leiterEnde: Wildnis ohne Deck, Bunker und Schiff behalten das Prop (null)');
  ok(K.leiterEnde(kA, 10) === 'oben' && K.leiterEnde(kA, kA.stride + 10) === 'unten' && K.leiterEnde(nurHoehle(3), 10) === 'unten', 'leiterEnde: Deck 0 der Wildnis = oben (Schacht), Deck 1 = unten (Lichtfleck)');
  ok(K.leiterBoxen(null).length === 0 && K.leiterBoxen('oben', 'gras').length > 15 && K.leiterBoxen('unten').length === 1, 'leiterBoxen');
  ok(K.fundRing(kA, kA.stride + 3, 'da') && !K.fundRing(kA, kA.stride + 3, 'genommen') && !K.fundRing(kA, 3, 'da') && !K.fundRing(ohneDeck, 3, 'da') && K.fundRing(nurHoehle(3), 3, 'da'), 'Glutring: nur unter der Erde und nur solange der Fund da ist');
  ok(K.LICHT_LEITER.priority === 1 && K.LICHT_LEITER.color === '#FFE2A0' && K.LICHT_LEITER.intensity === 2.5 && K.LICHT_LEITER.distance === 6 && K.LICHT_LEITER.y === 2.5, 'Lichtschacht: Farbe, Stärke, Reichweite, Priorität 1 wie vorgegeben');
  ok(K.LICHT_FUND.priority === 1, 'Fundlicht: Priorität 1 (Schüsse in fx.js verdrängen es)');
  // Verdrahtung in kit.js
  ok(/import \* as KULISSE from '\.\/hoehle-kulisse\.js'/.test(kit) && /KULISSE\.platziere\(/.test(kit) && /KULISSE\.leiterEnde\(/.test(kit) && /lichter\(\)/.test(kit), 'kit.js: Kulisse eingehängt (Import, platziere, leiterEnde, lichter)');
  ok(/ctx\.addLight\(l\)/.test(kit), 'kit.js: layer.update reicht die Kulissenlichter an den Lichtpool');
}

// ---------------------------------------------------------------------------------------------------------------------------------- Browser
function playwright() {
  for (const k of [process.env.PLAYWRIGHT_CORE, 'playwright-core', 'C:/tmp/pw-test/node_modules/playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* nächster */ } }
  return null;
}
async function mitBrowser() {
  const pw = playwright();
  if (!pw || !fs.existsSync(path.join(ROOT, 'public', 'voxel', 'manifest.json'))) { console.log('SKIP Browserteil (playwright-core oder public/voxel fehlt)'); return; }
  const K = await imp('public/js/voxel/hoehle-kulisse.js');
  const Physics = require('../shared/physics.js');
  const W = require('../server/world.js');
  const { startServer } = require('../server/index.js');
  fs.mkdirSync(OUT, { recursive: true });
  const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const fpsMessen = (page) => page.evaluate(() => new Promise((res) => { let c = 0; const t0 = performance.now(); const f = () => { c++; const dt = performance.now() - t0; if (dt > 2500) res(Math.round(c / (dt / 1000) * 10) / 10); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
  for (const spec of [...BIOME.map((bm) => 'wildnis:' + bm), 'hoehle']) {
    const [art, biom] = spec.split(':');
    const tag = art === 'hoehle' ? 'hoehle' : biom;
    abschnitt(`Browser: ${art === 'hoehle' ? 'art hoehle mittel' : 'Wildnis ' + biom + ' mit Höhle, mittel'}, Seed 3`);
    const srv = await startServer({ port: 0, quiet: true, noStore: true, roomCode: 'off', debug: true });
    const g = srv.game, fehler = [];
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') fehler.push('console: ' + m.text().slice(0, 200)); });
    try {
      const url = art === 'hoehle' ? '?arena=away&art=hoehle&seed=3&groesse=mittel&render=voxel&debug=1' : `?arena=away&art=wildnis&seed=3&biom=${biom}&groesse=mittel&hoehle=1&render=voxel&debug=1`;
      await page.goto(`http://127.0.0.1:${srv.port}/${url}`);
      await page.waitForFunction(() => window.__game && __game.send && __game.state && __game.state.phase === 'lobby', null, { timeout: 30000, polling: 40 });
      await sleep(1500);
      await page.evaluate(() => __game.send({ t: 'lobbyOpt', skipDrill: true }));
      await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
      await page.waitForFunction(() => { const st = window.__game && __game.state, me = st && st.players && st.players.find((p) => p.id === __game.pid); return !!(me && me.zone === 'away' && st.away && window.Shared_Maps && Shared_Maps[st.away.map] && Shared_Maps[st.away.map].buehne); }, null, { timeout: 60000, polling: 40 });
      await page.waitForFunction(() => { const s = window.VoxelKit && VoxelKit.stats(); return !!(s && s.id === __game.state.away.map); }, null, { timeout: 120000, polling: 40 });
      await sleep(1500);
      await page.evaluate(() => __game.dbg('god on'));
      const ks = W.AWAY_MAPS[g.away.map].karte;
      const stride = ks.decks ? ks.decks.stride : 0, y0 = art === 'hoehle' ? 0 : stride;
      const P = g.players[0];
      const platz = (tx, ty) => { const c = Physics.tileCenter(tx, ty); P.x = c.x; P.y = c.y; P.dir = 'up'; P.input.mx = 0; P.input.my = 0; };
      const kd = (x, y) => { const r = ks.rows[y]; return r ? r[x] : null; };
      const frei = (x, y) => kd(x, y) === '.' || kd(x, y) === ',';
      const sucheFrei = (x, y) => { for (let r = 0; r < 6; r++) for (let dy = r; dy >= -r; dy--) for (let dx = -r; dx <= r; dx++) if (frei(x + dx, y + dy)) return [x + dx, y + dy]; return [x, y]; };
      const shot = async (name, grau) => {
        if (grau) await page.addStyleTag({ content: 'canvas{filter:grayscale(1)!important}' });
        await page.screenshot({ path: path.join(OUT, `kulisse-${tag}-${name}${grau ? '-grau' : ''}.png`) });
        if (grau) await page.evaluate(() => { for (const s of document.querySelectorAll('style')) if (s.textContent.includes('grayscale(1)')) s.remove(); });
      };
      const zoom = (z) => page.evaluate((zz) => VoxelRender.renderer.setZoom(zz), z);
      const kitS = () => page.evaluate(() => { const s = VoxelKit.stats(); return { tris: s.tris, fehler: s.fehler, platzhalter: s.platzhalter || {}, kulisse: s.kulisse || null, id: s.id }; });
      const s0 = await kitS();
      ok(s0.fehler === 0, `Kit-Fehler 0 (${s0.fehler})`);
      info(`Dreiecke gesamt ${s0.tris}, Kulisse ${JSON.stringify(s0.kulisse)}, Platzhalter ${JSON.stringify(s0.platzhalter)}`);
      ok(s0.kulisse && s0.kulisse.pilze + s0.kulisse.risse > 20 && s0.kulisse.kristalle > 5, 'Pilze/Risse und Kristalle gezeichnet');
      ok(biom === 'vulkan' ? s0.kulisse.risse > 0 && s0.kulisse.pilze === 0 : s0.kulisse.pilze > 0 && s0.kulisse.risse === 0, 'Vulkan: Glutrisse statt Pilzen, sonst Pilze');
      // Schacht: der Leiter-Anker auf Deck 0 trägt kein Prop (flach, <= 0,2 m)
      if (art === 'wildnis') {
        const sz = await page.evaluate(() => {
          const S = VoxelRender.renderer.state(); const out = [];
          S.scene.traverse((o) => { if (o.name && o.name.startsWith('anker:') && /leiter/.test(o.name)) { let max = -9, tris = 0; o.traverse((m) => { if (m.isMesh) { m.geometry.computeBoundingBox(); max = Math.max(max, m.geometry.boundingBox.max.y); tris += m.geometry.index.count / 3; } }); out.push({ name: o.name, max, tris }); } });
          return out;
        });
        ok(sz.length === 2, `beide Leiter-Anker haben eine Gruppe (${sz.map((q) => q.name).join(', ')})`);
        ok(sz.every((q) => q.max <= 0.2 + 1e-6 && q.max > 0), `Leiter-Anker: flach (höchstens 0,2 m), kein Schiffs-Prop (${sz.map((q) => q.name + ' ' + q.max.toFixed(3) + ' m ' + q.tris + ' Dreiecke').join('; ')})`);
      }
      // Bilder
      const link = ks.decks ? ks.decks.links[0] : null;
      const lo = link ? (link.a[1] < stride ? { x: link.a[0], y: link.a[1] } : { x: link.b[0], y: link.b[1] }) : null;
      const lu = link ? (link.a[1] < stride ? { x: link.b[0], y: link.b[1] } : { x: link.a[0], y: link.a[1] }) : null;
      let fps = {};
      if (art === 'wildnis') {
        let p = sucheFrei(lo.x, lo.y + 7); platz(p[0], p[1]); await zoom(1); await sleep(2200);
        await shot('eingang-fern-zoom1'); await shot('eingang-fern-zoom1', true);
        fps.fern = await fpsMessen(page);
        await zoom(0); p = sucheFrei(lo.x, lo.y + 3); platz(p[0], p[1]); await sleep(1800); await shot('eingang-nah');
        platz(lo.x, lo.y); await sleep(600);
        await page.evaluate(() => __game.send({ t: 'act', down: true }));
        for (let i = 0; i < 120; i++) { await sleep(100); const r = await page.evaluate(() => ({ ph: VoxelRender.renderer.liftPhase(), d: VoxelRender.renderer.shownDeck() })); if (r.d === 1 && r.ph === 'idle') break; }
        await page.evaluate(() => __game.send({ t: 'act', down: false }));
        await sleep(2500);
        await shot('leiter-unten'); await shot('leiter-unten', true);
        const li = await page.evaluate(() => { const S = VoxelRender.renderer.state(); return S.points.map((l) => ({ i: +l.intensity.toFixed(2), d: l.distance, x: +l.position.x.toFixed(1), y: +l.position.y.toFixed(1), z: +l.position.z.toFixed(1), c: '#' + l.color.getHexString() })); });
        ok(li.some((l) => l.i >= 2.4 && Math.abs(l.x - (lu.x + 0.5)) < 0.1 && Math.abs(l.z - (lu.y - stride + 0.5)) < 0.1 && l.c === '#ffe2a0'), `unten am Leiter-Ende brennt der Lichtschacht (Pool: ${JSON.stringify(li)})`);
      } else { platz(sucheFrei(30, 30)[0], sucheFrei(30, 30)[1]); await zoom(0); await sleep(1500); }
      // Pilz-/Kristall-Stellen aus derselben Platzierung (Kartenzeichen -> Art)
      const kindAt = (x, y) => { const c = kd(x, y); return c ? (Z[c] || {}).kind : null; };
      const pl = K.platziere({ art: ks.art, w: ks.w, h: ks.h, seed: await page.evaluate(() => VoxelKit.normKarte(Shared_Maps[__game.state.away.map].karte || Shared_Maps[__game.state.away.map]).seed), stride, boden: (ks.meta && ks.meta.boden) || ks.boden, kindAt, felsHoehe: () => 1 });
      const nah = (xs, ys) => { const t = (art === 'hoehle' ? [30, 30] : [lu.x, lu.y]); return xs.sort((a, c) => Math.hypot(a[0] - t[0], a[1] - t[1]) - Math.hypot(c[0] - t[0], c[1] - t[1])); };
      const pz = nah([...pl.pilze, ...pl.risse]), kr = nah(pl.kristalle.map((c) => [c.x, c.y]));
      if (pz.length) { const q = sucheFrei(pz[1][0], pz[1][1] + 3); platz(q[0], q[1]); await sleep(2200); await shot('pilze'); await shot('pilze', true); }
      if (kr.length) { const q = sucheFrei(kr[0][0], kr[0][1] + 3); platz(q[0], q[1]); await sleep(2200); await shot('kristalle'); await shot('kristalle', true); fps.hoehle = await fpsMessen(page); }
      // Fund mit Glutring
      const fund = ks.anker.filter((a) => a.rolle === 'fund' && a.y >= y0)[0];
      if (fund) {
        const q = sucheFrei(fund.x, fund.y + 3); platz(q[0], q[1]); await sleep(2200); await shot('fund'); await shot('fund', true);
        const f2 = await page.evaluate(() => { const S = VoxelRender.renderer.state(); const o = []; S.scene.traverse((m) => { if (m.name && m.name.startsWith('anker:') && /fund/.test(m.name)) o.push({ name: m.name, kinder: m.children.length }); }); return o; });
        const fu = f2.filter((q2) => /hoehle.fund/.test(q2.name)); ok(fu.length >= 1 && fu.every((q2) => q2.kinder >= 2) && f2.filter((q2) => /gelaende.fund/.test(q2.name)).every((q2) => q2.kinder === 1), `Fund unter der Erde trägt Prop und Glutring, Oberfläche nur das Prop (${f2.map((q2) => q2.name + ':' + q2.kinder).join(', ')})`);
      }
      info(`FPS (Software-GL, nur Größenordnung): ${JSON.stringify(fps)}`);
      ok(fehler.length === 0, `keine Konsolenfehler (${fehler.length}${fehler[0] ? ': ' + fehler[0] : ''})`);
      const s1 = await kitS();
      ok(s1.fehler === 0 && s1.tris === s0.tris, `nach Fahrt und Rundgang: Kit-Fehler 0, Dreiecke unverändert (${s1.tris})`);
      ok(g.errors === 0, `keine Serverfehler (${g.errors})`);
    } catch (e) { bad++; n++; console.log('  FEHLER ' + String(e && e.stack || e).slice(0, 400)); }
    finally { await page.close().catch(() => null); await srv.close(); }
  }
  await b.close();
}

(async () => {
  await ohneBrowser();
  if (!process.argv.includes('--ohne-browser')) await mitBrowser();
  console.log(bad ? `FEHLER ${bad} von ${n}` : `TEST-HOEHLE-KULISSE OK (${n} Pruefungen)`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('FEHLER ' + (e && e.stack || e)); process.exit(1); });
