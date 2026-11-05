#!/usr/bin/env node
'use strict';
// GEL-02 Paket 0: Client-Voraussetzung fuer ein zweites Deck unter einer Wildnis-Karte und fuer die Karte art 'hoehle'.
//   node tools/test-hoehle-client.js [--schreiben]     (--schreiben: Geometrie-Basis tools/fixtures/hoehle-client-basis.json neu schreiben; nur auf dem Stand VOR der Aenderung sinnvoll)
// Ohne Browser: Probekarten (tools/lib/hoehle-probe.js) im Pruefer, Stimmung (stimmung.js), Bodenbewuchs (deko.js) auf Deck >= 1.
// Mit Browser (playwright-core, Software-GL, public/voxel): Wildnis (Wueste, Wiesenwald, Vulkan) mit Hoehlendeck: kein Konsolenfehler in Deck 0 und 1, kein Platzhalter,
// Erdboden im Deck 1 (nicht der Biomton), Stimmung wechselt mit dem Deck (Leiterfahrt hin und zurueck), kein Bewuchs im Deck 1. Karte art 'hoehle' mit einem Deck.
// Bestand: Bunker (aussenposten mit Decks) und Wildnis ohne Deck bauen dieselbe Geometrie wie vor der Aenderung (Hash der Kit-Meshes gegen die Basis).
// Bilder: shots/gel02/ (gitignored). Fehlt playwright-core oder public/voxel, laeuft nur der Teil ohne Browser (Hinweis SKIP).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..');
const Buehne = require('../shared/buehne.js');
const Gelaende = require('../shared/gen-gelaende.js');
const GenFest = require('../shared/gen-fest.js');
const Physics = require('../shared/physics.js');
const Probe = require('./lib/hoehle-probe.js');

const SCHREIBEN = process.argv.includes('--schreiben');
const BASIS = path.join(__dirname, 'fixtures', 'hoehle-client-basis.json');
const OUT = path.join(ROOT, 'shots', 'gel02');
let n = 0, bad = 0;
const ok = (c, t) => { n++; if (!c) { bad++; console.log('  FEHLER ' + t); } else if (process.env.VERBOSE) console.log('  ok   ' + t); };
const abschnitt = (t) => console.log('[' + t + ']');
const lies = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const rd = (f) => JSON.parse(lies(f).replace(/^﻿/, ''));
const imp = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BIOME = Gelaende.BIOME;
const SEED = 3;

function wildnisMitDeck(biom, seed, o) {
  const roh = Probe.kombi(Gelaende.erzeuger().karteRoh(seed, { biom, groesse: 'klein' }), seed, Object.assign({ boden2: 'erde' }, o));
  roh.id = 'test.gel02.' + biom;
  return roh;
}
function hoehleOhneOberflaeche(biom, seed) {
  const roh = Probe.nurHoehle(Gelaende.erzeuger().karteRoh(seed, { biom, groesse: 'klein' }), seed, { boden2: 'erde' });
  roh.id = 'test.gel02.nurhoehle';
  return roh;
}

async function ohneBrowser() {
  const kacheln = rd('content/buehnen/kacheln.json').zeichen;
  const D = await imp('public/js/voxel/deko.js');
  const S = await imp('public/js/voxel/stimmung.js');
  const render = lies('public/js/voxel/renderer.js');
  const kit = lies('public/js/voxel/kit.js');

  abschnitt('Probekarten: Pruefer');
  const karten = {};
  for (const biom of BIOME) {
    const roh = wildnisMitDeck(biom, SEED);
    const r = Buehne.ausRaster(roh, { spiel: true });
    ok(r.pruefung.ok, `${biom}: Wildnis mit Hoehlendeck besteht den Pruefer (${r.pruefung.ok ? 'ok' : JSON.stringify(r.fehler.slice(0, 2))})`);
    ok(r.karte.decks && r.karte.decks.stride === roh._probe.Hs && r.karte.decks.links.length === 1, `${biom}: decks.stride = Oberflaechenhoehe, ein Leiter-Link`);
    ok(r.karte.meta.boden2 === 'erde' && r.karte.art === 'wildnis', `${biom}: meta.boden2 erde, art wildnis`);
    karten[biom] = { roh, karte: r.karte };
  }
  // Karte art 'hoehle': der Pruefer kennt die Art seit GEL-02 B (config.js buehne.jeArt.hoehle.eingaengeMin = 0) und ist gruen
  const nur = hoehleOhneOberflaeche('wueste', SEED);
  const rn = Buehne.ausRaster(nur, { spiel: true });
  ok(rn.pruefung.ok === true, `art hoehle: Pruefer gruen (jeArt.hoehle.eingaengeMin = 0): ${JSON.stringify(rn.fehler.slice(0, 2))}`);
  const nurW = hoehleOhneOberflaeche('wueste', SEED); nurW.art = 'wildnis';
  const rw = Buehne.ausRaster(nurW, { spiel: true });
  ok(rw.pruefung.ok, 'dieselbe Karte mit art wildnis besteht den Pruefer (Raster, Anker, Erreichbarkeit der Hoehle sind in Ordnung): ' + JSON.stringify(rw.fehler.slice(0, 2)));
  ok(rn.karte.rows.join('').split('').every((c) => 'F,'.includes(c)) && rn.karte.rows[0].split('').every((c) => c === 'F'), 'art hoehle (Probe): nur Boden , und Fels F, Rand F');
  karten.nur = { roh: nur, karte: rw.karte };

  abschnitt('Bodenbewuchs auf Deck >= 1');
  const kindAtVon = (k) => (x, y) => { const c = k.rows[y] && k.rows[y][x]; return c ? (kacheln[c] || {}).kind : null; };
  for (const biom of BIOME) {
    const k = karten[biom].karte, stride = k.decks.stride;
    const basis = { w: k.w, h: k.h, seed: 1234, art: 'wildnis', boden: k.meta.boden, kindAt: kindAtVon(k), anker: k.anker };
    const mit = D.streuenWildnis(Object.assign({}, basis, { stride }));
    const ohneStride = D.streuenWildnis(basis);
    ok(mit.length > 0 && mit.every((d) => d.y < stride), `${biom}: Bewuchs nur auf Deck 0 (${mit.length} Eintraege, keiner mit y >= ${stride})`);
    ok(JSON.stringify(ohneStride.filter((d) => d.y < stride)) === JSON.stringify(mit), `${biom}: Deck 0 identisch zur Streuung ohne Stride (Oberflaeche unveraendert)`);
    ok(!kindAtVon(k)(0, 0) || k.rows.slice(stride).join('').split('').every((c) => c !== ':'), `${biom}: Hoehle der Probe hat keine :-Kacheln (Boden ist ,), also auch keine Streuflaeche`);
    // Altweg: Hoehle mit ':' als Boden darf trotzdem nichts bekommen
    const alt = Object.assign({}, k, { rows: k.rows.map((r, y) => (y >= stride ? r.replace(/,/g, ':') : r)) });
    const a = D.streuenWildnis(Object.assign({}, basis, { kindAt: kindAtVon(alt), stride }));
    ok(a.length === mit.length, `${biom}: auch mit ':' als Hoehlenboden kein Bewuchs auf Deck 1 (${a.length} = ${mit.length})`);
  }
  ok(D.streuenWildnis({ w: 8, h: 8, seed: 1, art: 'hoehle', boden: 'wueste', kindAt: () => 'gelaende', anker: [] }).length === 0, 'art hoehle: keine Streuung');
  ok(/stride: k\.decks \? k\.stride : 0/.test(kit), 'kit.js: streuenWildnis bekommt den Stride der Decks');

  abschnitt('Stimmung hoehle');
  const H = S.HOEHLE_STIMMUNG.hoehle;
  const hell = (c) => { const v = parseInt(c.slice(1), 16); return ((v >> 16) & 255) * 0.3 + ((v >> 8) & 255) * 0.59 + (v & 255) * 0.11; };
  const licht = (m) => m.hemi.intensity + m.sun.intensity;
  ok(H && H.id === 'hoehle' && H.background && H.fog && H.hemi && H.sun && H.exposure > 0, 'HOEHLE_STIMMUNG.hoehle mit Hintergrund, Nebel, Hemisphaere, Sonne, Belichtung');
  ok(H.fog.far * 10 < 6 * 10 && H.fog.near * 10 < 2 * 10, `Nebel enger als in jeder Wildnis-Stimmung (near ${H.fog.near * 10}, far ${H.fog.far * 10} m)`);
  for (const [id, m] of Object.entries(S.WILDNIS_STIMMUNG)) {
    ok(H.fog.far < m.fog.far && H.fog.near < m.fog.near, `Hoehle: Nebel enger als ${id}`);
    ok(licht(H) < licht(m), `Hoehle: weniger Licht als ${id} (${licht(H).toFixed(2)} < ${licht(m).toFixed(2)})`);
  }
  ok(hell(H.background) < 40 && hell(H.background) > 5 && hell(H.fog.color) < 40, 'Hintergrund und Nebel dunkel, aber nicht schwarz');
  ok(H.hemi.intensity >= 0.8 && H.sun.intensity >= 1.0, 'genug Licht, dass Figur und Gegner lesbar bleiben (Hemisphaere >= 0,8, Sonne >= 1,0)');
  const sky = (c) => [(parseInt(c.slice(1), 16) >> 16) & 255, (parseInt(c.slice(1), 16) >> 8) & 255, parseInt(c.slice(1), 16) & 255];
  ok(sky(H.hemi.sky)[2] > sky(H.hemi.sky)[0] && sky(H.sun.color)[2] > sky(H.sun.color)[0], 'kaelter Ton (Blau > Rot) in Himmel und Sonne');
  ok(S.stimmungVon({ wildnis: 'wildnis_wueste', 'wildnis:gras': 'wildnis_wiesenwald' }, 'hoehle', null) === 'hoehle' && S.stimmungVon({}, 'hoehle', 'wueste') === 'hoehle', 'stimmungVon: art hoehle liefert hoehle (ein Eintrag, nicht je Biom)');
  ok(S.stimmungVon({ wildnis: 'wildnis_wueste', 'wildnis:gras': 'wildnis_wiesenwald' }, 'wildnis', 'gras') === 'wildnis_wiesenwald' && S.stimmungVon({ aussenposten: 'outpost_frost' }, 'aussenposten', 'wueste') === 'outpost_frost', 'stimmungVon: Wildnis und Aussenposten unveraendert');
  ok(/\.\.\.HOEHLE_STIMMUNG/.test(render) && /HOEHLE_ARTEN\.includes\(art\) && !!buehneDecks\(\)/.test(render), 'renderer.js: Hoehle in MOOD_FALLBACK, Deck >= 1 von wildnis/hoehle mit Decks nimmt die Hoehlenstimmung');
  ok(!S.HOEHLE_ARTEN.includes('aussenposten') && !S.HOEHLE_ARTEN.includes('schiff'), 'Bunker (aussenposten) und Schiff nehmen die Hoehlenstimmung nicht');
  return karten;
}

// ----------------------------------------------------------------------------------------------------------------------------------------------- Browser
function playwright() {
  for (const k of [process.env.PLAYWRIGHT_CORE, 'playwright-core', 'C:/tmp/pw-test/node_modules/playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* naechster */ } }
  return null;
}

// Hash und Messung der Kit-Meshes im Browser (Positionen und Farben, 3 Nachkommastellen)
const IM_BROWSER = {
  geometrie: () => {
    const S = VoxelRender.renderer.state(); const out = {}; let h = 2166136261 >>> 0;
    const mix = (v) => { h ^= v; h = Math.imul(h, 16777619) >>> 0; };
    const meshes = []; S.scene.traverse((o) => { if (o.isMesh && o.name && o.name.startsWith('kit:') && !o.name.startsWith('kit:huelle') && !o.name.startsWith('kit:krone')) meshes.push(o); });
    meshes.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const m of meshes) {
      const d = m.name.slice(4).split(',')[0]; const g = m.geometry; const P = g.attributes.position.array, C = g.attributes.color ? g.attributes.color.array : [];
      let hh = 2166136261 >>> 0;
      for (let i = 0; i < P.length; i++) hh = Math.imul(hh ^ (Math.round(P[i] * 1000) & 0xffff), 16777619) >>> 0;
      for (let i = 0; i < C.length; i++) hh = Math.imul(hh ^ (Math.round(C[i] * 1000) & 0xffff), 16777619) >>> 0;
      mix(hh); out[d] = ((out[d] || 0) ^ hh) >>> 0;
    }
    return { gesamt: h >>> 0, deck: out, meshes: meshes.length };
  },
  // Mittel der Farbe der nach oben zeigenden Flaechen auf Bodenhoehe (y ~ 0) je Deck
  boden: () => {
    const S = VoxelRender.renderer.state(); const sum = {};
    S.scene.traverse((o) => {
      if (!(o.isMesh && o.name && o.name.startsWith('kit:') && !o.name.startsWith('kit:huelle') && !o.name.startsWith('kit:krone'))) return;
      const d = o.name.slice(4).split(',')[0]; const g = o.geometry, P = g.attributes.position.array, N = g.attributes.normal.array, C = g.attributes.color.array;
      const a = sum[d] || (sum[d] = { r: 0, g: 0, b: 0, n: 0 });
      for (let i = 0; i < P.length / 3; i++) if (N[i * 3 + 1] > 0.9 && Math.abs(P[i * 3 + 1]) < 0.02) { a.r += C[i * 3]; a.g += C[i * 3 + 1]; a.b += C[i * 3 + 2]; a.n++; }
    });
    const out = {}; for (const d of Object.keys(sum)) { const a = sum[d]; out[d] = a.n ? { r: a.r / a.n, g: a.g / a.n, b: a.b / a.n, n: a.n } : null; }
    return out;
  },
  render: () => {
    const S = VoxelRender.renderer.state(); const c = (o) => (o && o.getHexString ? '#' + o.getHexString() : null);
    return { moodId: S.moodId, shownDeck: S.shownDeck, hoehleAn: !!S.hoehleAn, bg: c(S.scene.background), fog: S.scene.fog ? c(S.scene.fog.color) : null, fogNF: S.scene.fog ? [S.scene.fog.near, S.scene.fog.far] : null,
      hemi: S.hemi.intensity, sun: S.sun.intensity, exp: S.renderer.toneMappingExposure, lift: S.lift && S.lift.phase };
  },
  kit: () => { const s = VoxelKit.stats(); return { id: s.id, art: s.art, tris: s.tris, bewuchs: s.bewuchs, deko: s.deko, platzhalter: s.platzhalter || {}, fehlend: s.fehlend || [], fehler: s.fehler, stimmung: s.stimmung }; },
};

// Spiel starten, Karte als Landepunkt einspeisen, runterbeamen, auf den Kit-Aufbau warten
async function sitzung(chromium, startServer, W, away, karte, lp) {
  const srv = await startServer({ port: 0, quiet: true, noStore: true, roomCode: 'off', debug: true });
  const g = srv.game;
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const fehler = [];
  const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /Fehler in Voxel|\[kit\]/.test(m.text()))) fehler.push(m.type() + ': ' + m.text().slice(0, 240)); });   // GEL-02 E1: der Loader meldet Kit-Fehler per console.warn
  await page.goto(`http://127.0.0.1:${srv.port}/?render=voxel&debug=1`);
  await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000, polling: 20 });
  await page.waitForTimeout(1000);
  await page.evaluate(() => __game.send({ t: 'lobbyOpt', skipDrill: true }));
  await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
  await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  W.AWAY_MAPS[lp] = { id: lp, karte };
  g.aways[lp] = away.makeLandepunkt(g, lp);
  g.setAwayMap(lp);
  away.executeBeam(g, g.players.map((p) => p.id), 'down');
  await page.waitForFunction(() => { const st = __game.state, me = st && st.players.find((p) => p.id === __game.pid); return !!(me && me.zone === 'away' && st.away && Shared_Maps[st.away.map] && Shared_Maps[st.away.map].buehne); }, null, { timeout: 30000, polling: 40 });
  await page.waitForFunction(() => { const s = window.VoxelKit && VoxelKit.stats(); return !!(s && s.id === __game.state.away.map); }, null, { timeout: 90000, polling: 40 });
  await page.waitForTimeout(1500);
  const P = g.players[0];
  const platz = (tx, ty) => { const c = Physics.tileCenter(tx, ty); P.x = c.x; P.y = c.y; P.input.mx = 0; P.input.my = 0; };
  await page.evaluate(() => __game.dbg('god on'));
  const ende = async () => { await b.close().catch(() => null); await srv.close(); };
  return { srv, g, b, page, fehler, platz, ende };
}
const deckVon = (page) => page.evaluate(() => { const m = __game.state.players.find((p) => p.id === __game.pid); return m.deck; });
async function fahren(page, ziel) {
  await page.evaluate(() => __game.send({ t: 'act', down: true }));
  let r = null;
  for (let i = 0; i < 120; i++) { await sleep(100); const d = await deckVon(page); r = await page.evaluate(IM_BROWSER.render); if (d === ziel && r.lift === 'idle' && r.shownDeck === ziel) break; }
  await page.evaluate(() => __game.send({ t: 'act', down: false }));
  await sleep(600);
  return r;
}
const nahe = (a, b, e) => Math.abs(a - b) <= e;

async function mitBrowser(karten) {
  const pw = playwright();
  if (!pw || !fs.existsSync(path.join(ROOT, 'public', 'voxel', 'manifest.json'))) { console.log('SKIP Browserteil (playwright-core oder public/voxel fehlt)'); return; }
  const { chromium } = pw;
  const W = require('../server/world.js'), away = require('../server/sim/away.js'), { startServer } = require('../server/index.js');
  fs.mkdirSync(OUT, { recursive: true });
  const basis = SCHREIBEN ? {} : JSON.parse(fs.readFileSync(BASIS, 'utf8')).stand;
  const neueBasis = {};

  // ---- Bestand: Bunker und Wildnis ohne Deck (Geometrie gegen die Basis)
  abschnitt('Bestand: Bunker und Wildnis ohne Deck bauen dieselbe Geometrie wie vor der Aenderung');
  {
    const DEF = rd('content/buehnen/festkarten/grabenangriff.json');
    const bunkerRoh = GenFest.karteRoh(DEF, { id: 'test.gel02.bunker', bauweise: DEF.bauweise, besitz: 'rom', seed: 7 });
    const bunker = Buehne.ausRaster(bunkerRoh, { spiel: true });
    ok(bunker.pruefung.ok, 'Bunker (Grabenangriff) besteht den Pruefer');
    const wRoh = Gelaende.erzeuger().karteRoh(SEED, { biom: 'wueste', groesse: 'klein' }); wRoh.id = 'test.gel02.wildnis0';
    const wild = Buehne.ausRaster(wRoh, { spiel: true });
    ok(wild.pruefung.ok, 'Wildnis ohne Deck besteht den Pruefer');
    for (const [name, karte] of [['bunker', bunker.karte], ['wildnis-ohne-deck', wild.karte]]) {
      const s = await sitzung(chromium, startServer, W, away, karte, karte.id);
      try {
        const geo = await s.page.evaluate(IM_BROWSER.geometrie), kitS = await s.page.evaluate(IM_BROWSER.kit);
        neueBasis[name] = { gesamt: geo.gesamt, deck: geo.deck, meshes: geo.meshes, tris: kitS.tris };
        ok(s.fehler.length === 0, `${name}: keine Konsolenfehler (${s.fehler.length}${s.fehler[0] ? ': ' + s.fehler[0] : ''})`);
        if (!SCHREIBEN) {
          const b0 = basis[name];
          ok(!!b0, `${name}: Basis vorhanden`);
          ok(b0 && b0.gesamt === geo.gesamt && b0.tris === kitS.tris && JSON.stringify(b0.deck) === JSON.stringify(geo.deck), `${name}: Kit-Geometrie byteweise wie vor der Aenderung (Hash ${geo.gesamt}, ${kitS.tris} Dreiecke, ${geo.meshes} Meshes)`);
        }
      } finally { await s.ende(); }
    }
  }

  if (SCHREIBEN) { fs.mkdirSync(path.dirname(BASIS), { recursive: true }); fs.writeFileSync(BASIS, JSON.stringify({ hinweis: 'Geometrie-Hash der Kit-Meshes (tools/test-hoehle-client.js --schreiben), aufgenommen auf main 45c100c vor GEL-02 Paket 0: bunker und wildnis-ohne-deck.', stand: neueBasis }, null, 1)); console.log('Basis geschrieben: ' + BASIS); return; }

  // ---- Wildnis mit Hoehlendeck je Biom
  const FARBEN = {};
  for (const biom of BIOME) {
    abschnitt('Browser: Wildnis ' + biom + ' mit Hoehlendeck (Deck 0 -> 1 -> 0)');
    const { karte, roh } = karten[biom];
    const { E, U, stride, Hd } = roh._probe;
    const s = await sitzung(chromium, startServer, W, away, karte, karte.id);
    try {
      const { page } = s;
      const kit0 = await page.evaluate(IM_BROWSER.kit);
      s.platz(E[0], E[1] + 2); await sleep(1500);
      const oben = await page.evaluate(IM_BROWSER.render);
      await page.screenshot({ path: path.join(OUT, `${biom}-deck0.png`) });
      ok(oben.moodId === 'wildnis_' + (biom === 'wueste' ? 'wueste' : biom === 'wiesenwald' ? 'wiesenwald' : 'vulkan') && !oben.hoehleAn && oben.shownDeck === 0, `${biom}: Deck 0 traegt die Stimmung der Wildnis (${oben.moodId})`);
      ok(s.fehler.length === 0, `${biom}: Deck 0 ohne Konsolenfehler (${s.fehler.length}${s.fehler[0] ? ': ' + s.fehler[0] : ''})`);
      ok(!kit0.platzhalter.boden && !kit0.platzhalter.boden2 && kit0.fehler === 0, `${biom}: kein Boden-Platzhalter, keine Kit-Fehler (Platzhalter ${JSON.stringify(kit0.platzhalter)}: Steine/Schleier/Fluessigkeit sind bis VOX bewusst Platzhalter; Fehler ${kit0.fehler})`);
      ok(kit0.bewuchs > 0, `${biom}: Deck 0 hat Bodenbewuchs (${kit0.bewuchs})`);
      const geo0 = await page.evaluate(IM_BROWSER.geometrie);
      // Bewuchs genau die Oberflaeche: dieselbe Streuung wie im Test ohne Browser, nur y < stride
      const D = await imp('public/js/voxel/deko.js');
      const kacheln = rd('content/buehnen/kacheln.json').zeichen;
      const kindAt = (x, y) => { const c = karte.rows[y] && karte.rows[y][x]; return c ? (kacheln[c] || {}).kind : null; };
      const seedK = await page.evaluate(() => VoxelKit.normKarte(Shared_Maps[__game.state.away.map].karte || Shared_Maps[__game.state.away.map]).seed);
      const soll = D.streuenWildnis({ w: karte.w, h: karte.h, seed: seedK, art: 'wildnis', boden: karte.meta.boden, kindAt, anker: karte.anker, stride }).length;
      const sollOhne = D.streuenWildnis({ w: karte.w, h: karte.h, seed: seedK, art: 'wildnis', boden: karte.meta.boden, kindAt, anker: karte.anker }).length;
      ok(kit0.bewuchs === soll && soll === sollOhne, `${biom}: gezeichneter Bewuchs (${kit0.bewuchs}) = Streuung der Oberflaeche (${soll}); Deck 1 traegt nichts (Streuung gesamt ${sollOhne})`);
      // Leiter runter
      s.platz(E[0], E[1]); await sleep(300);
      await page.evaluate(() => __game.send({ t: 'act', down: true }));
      const verlauf = []; let wechsel = null;
      for (let i = 0; i < 120; i++) {
        await sleep(100);
        const d = await deckVon(page), r = await page.evaluate(IM_BROWSER.render); verlauf.push([d, r.shownDeck, r.moodId, r.lift]);
        if (!wechsel && r.shownDeck === 1) wechsel = r;
        if (d === 1 && r.lift === 'idle' && r.shownDeck === 1) break;
      }
      await page.evaluate(() => __game.send({ t: 'act', down: false }));
      await sleep(800);
      const unten = await page.evaluate(IM_BROWSER.render);
      await page.screenshot({ path: path.join(OUT, `${biom}-deck1.png`) });
      ok(await deckVon(page) === 1 && unten.shownDeck === 1, `${biom}: Spielfigur auf Deck 1, Client zeigt Deck 1`);
      ok(unten.hoehleAn && unten.moodId === oben.moodId && unten.fog === '#10141b' && unten.bg === '#0c0f14', `${biom}: Deck 1 traegt die Hoehlenstimmung (Nebel ${unten.fog}, Hintergrund ${unten.bg})`);
      ok(nahe(unten.hemi, 0.95, 1e-6) && nahe(unten.sun, 1.1, 1e-6) && unten.fogNF[1] < oben.fogNF[1] && unten.hemi + unten.sun < oben.hemi + oben.sun, `${biom}: Licht und Nebel dunkler/enger als oben (Hemi ${oben.hemi} -> ${unten.hemi}, Sonne ${oben.sun} -> ${unten.sun}, Nebelende ${oben.fogNF[1]} -> ${unten.fogNF[1]})`);
      ok(wechsel && wechsel.hoehleAn, `${biom}: Stimmung wechselt mit dem Deck (beim ersten Bild mit Deck 1 schon Hoehle)`);
      ok(s.fehler.length === 0, `${biom}: Deck 1 ohne Konsolenfehler (${s.fehler.length}${s.fehler[0] ? ': ' + s.fehler[0] : ''})`);
      const kit1 = await page.evaluate(IM_BROWSER.kit);
      ok(kit1.bewuchs === kit0.bewuchs && kit1.deko === kit0.deko, `${biom}: Kit-Zaehler unveraendert nach dem Wechsel (Bewuchs ${kit1.bewuchs}, Deko ${kit1.deko})`);
      // Boden: erdfarben, nicht der Biomton
      const bd = await page.evaluate(IM_BROWSER.boden);
      FARBEN[biom] = bd;
      ok(bd[1] && bd[1].n > 200 && bd[1].r >= bd[1].g && bd[1].g >= bd[1].b, `${biom}: Boden Deck 1 braun (R >= G >= B): ${bd[1] ? [bd[1].r, bd[1].g, bd[1].b].map((v) => v.toFixed(3)).join('/') : 'keiner'}, ${bd[1] && bd[1].n} Flaechen`);
      const dist = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
      ok(bd[0] && bd[1] && dist(bd[0], bd[1]) > 0.02, `${biom}: Boden Deck 1 unterscheidet sich vom Biomton auf Deck 0 (Abstand ${bd[0] && bd[1] ? dist(bd[0], bd[1]).toFixed(3) : '?'})`);
      // Fund und Uebersicht
      const fund = karte.anker.find((a) => a.rolle === 'fund' && a.y >= stride);
      s.platz(fund.x, fund.y); await sleep(1500);
      await page.screenshot({ path: path.join(OUT, `${biom}-deck1-fund.png`) });
      s.platz(U[0], U[1] + stride); await sleep(800);
      await page.addStyleTag({ content: '#game { visibility: hidden !important; }' }).catch(() => null);
      await page.setViewportSize({ width: 1600, height: 900 }); await sleep(600);
      await page.evaluate(([cx, cz, h]) => { const Rr = VoxelRender.renderer; Rr.state().scene.fog = null; if (window.Render) window.Render.teamVision = () => null; Rr.setSeat({ pos: [cx, h, cz + h * 0.95], look: [cx, 0, cz], fov: 45 }); }, [karte.w / 2, Hd / 2 + 1, Math.max(karte.w, Hd) * 0.55]);
      await sleep(2500);
      await page.screenshot({ path: path.join(OUT, `${biom}-deck1-uebersicht.png`) });
      await page.evaluate(() => VoxelRender.renderer.setSeat(null));
      await page.setViewportSize({ width: 1280, height: 720 });
      // zurueck
      s.platz(U[0], U[1] + stride); await sleep(300);
      const zurueck = await fahren(page, 0);
      await page.screenshot({ path: path.join(OUT, `${biom}-deck0-zurueck.png`) });
      ok(await deckVon(page) === 0 && zurueck.shownDeck === 0 && !zurueck.hoehleAn, `${biom}: zurueck auf Deck 0, Hoehlenstimmung aus`);
      ok(zurueck.moodId === oben.moodId && zurueck.bg === oben.bg && zurueck.fog === oben.fog && zurueck.hemi === oben.hemi && zurueck.sun === oben.sun && zurueck.exp === oben.exp && JSON.stringify(zurueck.fogNF) === JSON.stringify(oben.fogNF), `${biom}: Stimmung zurueck wie vorher (${oben.bg}/${oben.fog}/${oben.hemi}/${oben.sun})`);
      ok(s.fehler.length === 0, `${biom}: nach der Rueckfahrt keine Konsolenfehler (${s.fehler.length}${s.fehler[0] ? ': ' + s.fehler[0] : ''})`);
      ok(s.g.errors === 0, `${biom}: keine Serverfehler (${s.g.errors})`);
      const geo1 = await page.evaluate(IM_BROWSER.geometrie);
      ok(geo1.gesamt === geo0.gesamt, `${biom}: Geometrie nach Hin- und Rueckfahrt unveraendert`);
    } finally { await s.ende(); }
  }
  ok(BIOME.every((b) => FARBEN[b] && FARBEN[b][1]) && BIOME.every((b) => dist3(FARBEN[b][1], FARBEN[BIOME[0]][1]) < 0.02), 'Hoehlenboden ist in allen drei Biomen gleich (Erde, nicht Biomton): ' + BIOME.map((b) => FARBEN[b][1] && [FARBEN[b][1].r, FARBEN[b][1].g, FARBEN[b][1].b].map((v) => v.toFixed(3)).join('/')).join(' | '));

  // ---- Karte art hoehle (ein Deck)
  abschnitt('Browser: Karte art hoehle (ein Deck, alles Boden , und Fels)');
  {
    const karte = Object.assign({}, karten.nur.karte, { art: 'hoehle' });   // Pruefer kennt die Art noch nicht (siehe oben): Art erst am fertigen Karten-Objekt gesetzt
    const s = await sitzung(chromium, startServer, W, away, karte, 'test.gel02.nurhoehle');
    try {
      const { page } = s;
      await sleep(1000);
      const r = await page.evaluate(IM_BROWSER.render), kitS = await page.evaluate(IM_BROWSER.kit);
      await page.screenshot({ path: path.join(OUT, 'hoehle-nur-spielnah.png') });
      ok(kitS.art === 'hoehle', 'Client uebernimmt art hoehle aus der Karte (' + kitS.art + ')');
      ok(r.moodId === 'hoehle' && r.fog === '#10141b' && r.bg === '#0c0f14', `art hoehle: Hoehlenstimmung ab Deck 0 (${r.moodId}, Nebel ${r.fog}, Hintergrund ${r.bg})`);
      ok(!kitS.platzhalter.boden && !kitS.platzhalter.boden2 && !kitS.platzhalter.gelaende && kitS.fehler === 0, `art hoehle: kein Boden-Platzhalter, keine Kit-Fehler (${JSON.stringify(kitS.platzhalter)} / ${kitS.fehler})`);
      ok(kitS.bewuchs === 0 && !kitS.deko, `art hoehle: kein Bewuchs, keine Deko (${kitS.bewuchs}/${kitS.deko})`);
      const bd = await page.evaluate(IM_BROWSER.boden);
      ok(bd[0] && bd[0].n > 200 && FARBEN.wueste && dist3(bd[0], FARBEN.wueste[1]) < 0.02, 'art hoehle: Boden hat dieselbe Erdfarbe wie Deck 1 der Wildnis: ' + (bd[0] ? [bd[0].r, bd[0].g, bd[0].b].map((v) => v.toFixed(3)).join('/') : 'keiner'));
      ok(s.fehler.length === 0, `art hoehle: keine Konsolenfehler (${s.fehler.length}${s.fehler[0] ? ': ' + s.fehler[0] : ''})`);
      ok(s.g.errors === 0, `art hoehle: keine Serverfehler (${s.g.errors})`);
      // Uebersicht
      await page.addStyleTag({ content: '#game { visibility: hidden !important; }' }).catch(() => null);
      await page.setViewportSize({ width: 1600, height: 900 }); await sleep(600);
      await page.evaluate(([cx, cz, h]) => { VoxelRender.renderer.state().scene.fog = null; if (window.Render) window.Render.teamVision = () => null; VoxelRender.renderer.setSeat({ pos: [cx, h, cz + h * 0.95], look: [cx, 0, cz], fov: 45 }); }, [karte.w / 2, karte.h / 2, Math.max(karte.w, karte.h) * 0.55]);
      await sleep(2500);
      await page.screenshot({ path: path.join(OUT, 'hoehle-nur-uebersicht.png') });
    } finally { await s.ende(); }
  }
}
function dist3(a, b) { return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b); }

(async () => {
  const karten = SCHREIBEN ? null : await ohneBrowser();
  await mitBrowser(karten);
  console.log(`${n - bad}/${n} Pruefungen gruen`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FEHLER', e && e.stack || e); process.exit(1); });
