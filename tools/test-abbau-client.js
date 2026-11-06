#!/usr/bin/env node
'use strict';
// GEL-03 A2: Client-Anzeige und Platzhalter-Optik der Anker-Rolle `abbau` (Erzader). Nur public/js, kein Server.
//   node tools/test-abbau-client.js     (Bilder: shots/gel03/ bzw. $ABBAU_OUT, gitignored)
// Ohne Browser (Quelltext): Zustandsliste im Client (render.js ANKER_ZUSTAENDE, voxel/kit.js ANKER_FB) = content/buehnen/anker.json in genau dieser Reihenfolge (sie ist der Index in ao),
//   Aktionswort ABBAUEN, Farbe, Name, Zustandsnamen, Rollenlisten in hud.js/consoles.js, Ader abgebaut als Meldung, Platzhalter PROP_FB.abbau.
// Mit Browser (playwright-core, Software-GL, Qualitaet low erzwungen): Hoehlenkarte (art hoehle) mit handgesetzten abbau-Ankern (der Erzeuger setzt sie erst in Paket C).
//   - Hinweistext je Zustand (da, laeuft mit fremdem Halter, abgebaut, leer) ueber Client.interactionAt
//   - Kollisionsspiegel: Render.buehneBewegungSolid ist je Zustand gleich der Server-Kollision (interior.awaySolid): fest in da/laeuft/abgebaut, begehbar in leer
//   - Prop je Zustand: da/laeuft/abgebaut erzeugen Geometrie innerhalb der Kachel, niedriger als der Fund-Sockel plus Funken, abgebaut kleiner als da, leer erzeugt keine
//   - echter Halteweg (E halten): Aktion anker:abbau mit Fortschritt im Snapshot (Fortschrittsbalken), Zustand laeuft, Loslassen setzt zurueck, voll gehalten: abgebaut
//   - keine Konsolenfehler und keine Loader-Warnungen (der Voxel-Loader meldet per console.warn), keine Kit-Fehler
// Fehlt playwright-core oder public/voxel, laeuft nur der Teil ohne Browser (Hinweis SKIP).
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const Buehne = require('../shared/buehne.js');
const Gelaende = require('../shared/gen-gelaende.js');
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');
const Probe = require('./lib/hoehle-probe.js');

const OUT = process.env.ABBAU_OUT || path.join(ROOT, 'shots', 'gel03');
let n = 0, bad = 0;
const ok = (c, t) => { n++; if (!c) { bad++; console.log('  FEHLER ' + t); } else if (process.env.VERBOSE) console.log('  ok   ' + t); };
const abschnitt = (t) => console.log('[' + t + ']');
const lies = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const rd = (f) => JSON.parse(lies(f).replace(/^﻿/, ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TILE = Physics.TILE;
const ZUSTAENDE = rd('content/buehnen/anker.json').rollen.abbau.zustaende;

function quelltext() {
  abschnitt('Quelltext');
  const render = lies('public/js/render.js'), kit = lies('public/js/voxel/kit.js'), client = lies('public/js/client.js'), hud = lies('public/js/hud.js'), cons = lies('public/js/consoles.js');
  const liste = (src, re) => { const m = src.match(re); return m ? m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')) : null; };
  ok(JSON.stringify(ZUSTAENDE) === JSON.stringify(['da', 'laeuft', 'abgebaut', 'leer']), 'anker.json: Zustaende abbau da, laeuft, abgebaut, leer (Index im Snapshot ao)');
  ok(JSON.stringify(liste(render, /\babbau: \[([^\]]*)\] \};\s*\/\/ GEL-03 A2/)) === JSON.stringify(ZUSTAENDE), 'render.js ANKER_ZUSTAENDE.abbau = anker.json (gleiche Reihenfolge)');
  ok(JSON.stringify(liste(kit, /abbau: \['erzader', \[([^\]]*)\]\]/)) === JSON.stringify(ZUSTAENDE), 'kit.js ANKER_FB.abbau = anker.json (gleiche Reihenfolge)');
  ok(rd('content/buehnen/anker.json').rollen.abbau.objekt === 'erzader', 'anker.json: Objekt erzader');
  ok(/'anker:abbau': 'ABBAUEN'/.test(render), "render.js: Aktionswort 'anker:abbau' ABBAUEN");
  ok(/abbau: '#C98A5A'/.test(render) && /abbau: 'Erzader'/.test(render), 'render.js: Ankerfarbe und Name Erzader');
  ok(/laeuft: '[^']+'/.test(render) && /abgebaut: '[^']+'/.test(render), 'render.js: Zustandsnamen laeuft und abgebaut');
  ok(/abbau: '#c98a5a'/.test(lies('public/js/werkstatt/basis.js')), 'werkstatt/basis.js: Rollenfarbe abbau');
  ok(/'abbau:abgebaut': 'Ader abgebaut'/.test(client), 'client.js: Zustandsmeldung abbau:abgebaut');
  ok(/'E halten: Erz abbauen \('/.test(client) && /'Die Ader ist ersch.pft'/.test(client), 'client.js: Hinweistexte');
  ok(/'zelle', 'abbau'\]\.indexOf/.test(hud) && /'zelle', 'abbau'\]\.indexOf/.test(cons), 'hud.js und consoles.js: abbau in der Rollenliste');
  ok(/abbau\(pen, p, F\) \{/.test(kit) && /if \(st === 3\) return;/.test(kit), 'kit.js: Platzhalter PROP_FB.abbau, leer zeichnet nichts');
  const ab = kit.slice(kit.indexOf('abbau(pen, p, F) {'), kit.indexOf('raetsel(pen, p, F) {'));
  const faktoren = [...ab.matchAll(/F\.get\('ember', ([0-9.]+)\)/g)].map((m) => +m[1]);
  ok(faktoren.length === 3 && Math.max(...faktoren) <= 1.25, `kit.js: die Funken (einzige leuchtende Flaechen der Erzader) liegen nicht ueber Faktor 1,25 (${faktoren.join(', ')})`);
  ok((ab.match(/emit: true/g) || []).length === 3, 'kit.js: nur die drei Funken leuchten (emit), Erz und Fels nicht');
  ok(/inv\.erz > 0\) items\.push\('erz'\)/.test(hud) && /erz: 'Erz'/.test(hud), 'hud.js: Lagerzeile zeigt Erz (nur wenn inventory.erz > 0)');
  ok(/away\.ab\)/.test(client) && !/Math\.hypot\(q\.x - \(tx/.test(client), 'client.js: fremder Halter aus away.ab, keine Abstandsheuristik mehr');
  ok(/'sechseck'/.test(render) && /m\.art === 'erz'/.test(render), 'render.js: Scan-Marker der Erzader als Sechseck');
  ok(/blk\.abbau/.test(render) && /Shared_Buehne\.ankerBlockiertIn\(/.test(render), 'render.js: Kollisionsspiegel der Erzader aus der einen Quelle Buehne.ankerBlockiertIn');
  const bbs = render.slice(render.indexOf('function buehneBewegungSolid'), render.indexOf('function buehneSolid'));
  ok(bbs.length > 50 && !/'leer'/.test(bbs), 'render.js: buehneBewegungSolid traegt keine eigene leer-Ausnahme (K5)');
  ok(Buehne.ankerBlockiertIn({ rolle: 'abbau' }, 'leer') === false && ['da', 'laeuft', 'abgebaut', undefined].every((z) => Buehne.ankerBlockiertIn({ rolle: 'abbau' }, z) === true), 'Buehne.ankerBlockiertIn: Ader fest ausser im Zustand leer');
}

// ----------------------------------------------------------------------------------------------------------------------------------------------- Karte
const IDS = ['abbau.1', 'abbau.2', 'abbau.3', 'abbau.4'];
function karte() {
  const roh = Probe.nurHoehle(Gelaende.erzeuger().karteRoh(3, { biom: 'wueste', groesse: 'klein' }), 3, { boden2: 'erde' });
  roh.id = 'test.gel03.abbau';
  roh.art = 'wildnis';
  const belegt = new Set(roh.anker.map((a) => a.x + ',' + a.y));
  const frei = (x, y) => roh.rows[y] && roh.rows[y][x] === ',' && !belegt.has(x + ',' + y);
  // Ader mit freier Kachel in allen vier Nachbarn und einer zweiten Reihe nach Norden (die Figur steht nördlich, der Fels südlich von ihr ist der Worst-Case der Lesbarkeit)
  const kand = [];
  for (let y = 3; y < roh.h - 3; y++) for (let x = 3; x < roh.w - 3; x++) if (frei(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1], [0, -2], [1, -1], [-1, -1]].every(([dx, dy]) => frei(x + dx, y + dy))) kand.push({ x, y });
  const gew = [];
  for (const t of kand) if (gew.length < IDS.length && gew.every((o) => Math.hypot(o.x - t.x, o.y - t.y) >= 6)) gew.push(t);
  if (gew.length < IDS.length) throw new Error('zu wenig freie Plaetze: ' + gew.length);
  IDS.forEach((id, i) => roh.anker.push({ id, rolle: 'abbau', x: gew[i].x, y: gew[i].y, art: 'erz' }));
  const r = Buehne.ausRaster(roh, { spiel: true });
  ok(r.pruefung.ok, 'Testkarte besteht den Pruefer' + (r.pruefung.ok ? '' : ': ' + JSON.stringify(r.fehler.slice(0, 2))));
  const k = Object.assign({}, r.karte, { art: 'hoehle' });
  ok(IDS.every((id) => k.anker.some((a) => a.id === id && a.rolle === 'abbau')), 'Testkarte traegt vier abbau-Anker');
  return k;
}

// ----------------------------------------------------------------------------------------------------------------------------------------------- Browser
function playwright() {
  for (const k of [process.env.PLAYWRIGHT_CORE, 'playwright-core', 'C:/tmp/pw-test/node_modules/playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* naechster */ } }
  return null;
}
const IM_BROWSER = {
  // Geometrie der Prop-Gruppe 'anker:<id>': Meshes, Dreiecke, Boundingbox relativ zur Kachelmitte (Meter), Farbmittel
  prop: (arg) => {
    const S = VoxelRender.renderer.state(); let grp = null;
    S.scene.traverse((o) => { if (o.name === 'anker:' + arg.id) grp = o; });
    if (!grp) return null;
    const box = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9, z0: 1e9, z1: -1e9 }; let tris = 0, meshes = 0, emit = 0, maxC = 0;
    grp.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      meshes++;
      const g = o.geometry, P = g.attributes.position.array, C = g.attributes.color ? g.attributes.color.array : null;
      tris += (g.index ? g.index.count : P.length / 3) / 3;
      for (let i = 0; i < P.length; i += 3) { box.x0 = Math.min(box.x0, P[i]); box.x1 = Math.max(box.x1, P[i]); box.y0 = Math.min(box.y0, P[i + 1]); box.y1 = Math.max(box.y1, P[i + 1]); box.z0 = Math.min(box.z0, P[i + 2]); box.z1 = Math.max(box.z1, P[i + 2]); }
      if (C) for (let i = 0; i < C.length; i++) maxC = Math.max(maxC, C[i]);
    });
    return { meshes, tris, box, maxC };
  },
  kit: () => { const s = VoxelKit.stats(); return { id: s.id, art: s.art, tris: s.tris, platzhalter: s.platzhalter || {}, fehlend: s.fehlend || [], fehler: s.fehler }; },
  ich: () => { const m = __game.state.players.find((p) => p.id === __game.pid); return { action: m.action || null, x: m.x, y: m.y }; },
};

async function mitBrowser(k) {
  const pw = playwright();
  if (!pw || !fs.existsSync(path.join(ROOT, 'public', 'voxel', 'manifest.json'))) { console.log('SKIP Browserteil (playwright-core oder public/voxel fehlt)'); return; }
  const { chromium } = pw;
  const W = require('../server/world.js'), away = require('../server/sim/away.js'), Anker = require('../server/sim/anker.js'), interior = require('../server/sim/interior.js'), { startServer } = require('../server/index.js');
  fs.mkdirSync(OUT, { recursive: true });
  abschnitt('Browser: Hoehle mit vier Erzadern');
  const srv = await startServer({ port: 0, quiet: true, noStore: true, roomCode: 'off', debug: true });
  const g = srv.game;
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const fehler = [];
  try {
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /Fehler in Voxel|\[kit\]/.test(m.text()))) fehler.push(m.type() + ': ' + m.text().slice(0, 240)); });   // der Voxel-Loader meldet per console.warn
    await page.goto(`http://127.0.0.1:${srv.port}/?render=voxel&debug=1`);
    await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000, polling: 20 });
    await sleep(1000);
    await page.evaluate(() => __game.send({ t: 'lobbyOpt', skipDrill: true }));
    await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 15000 });
    await sleep(1500);
    const lp = k.id;
    W.AWAY_MAPS[lp] = { id: lp, karte: k };
    g.aways[lp] = away.makeLandepunkt(g, lp);
    g.setAwayMap(lp);
    away.executeBeam(g, g.players.map((p) => p.id), 'down');
    await page.waitForFunction(() => { const st = __game.state, me = st && st.players.find((p) => p.id === __game.pid); return !!(me && me.zone === 'away' && st.away && Shared_Maps[st.away.map] && Shared_Maps[st.away.map].buehne); }, null, { timeout: 30000, polling: 40 });
    await page.waitForFunction(() => { const s = window.VoxelKit && VoxelKit.stats(); return !!(s && s.id === __game.state.away.map); }, null, { timeout: 90000, polling: 40 });
    await sleep(1500);
    await page.evaluate(() => { VoxelRender.renderer.setZoom(1); VoxelRender.renderer.setQuality('low'); });   // Qualitaet low erzwungen (Software-GL): sonst haengt das Bild vom FPS-Waechter ab
    await page.evaluate(() => __game.dbg('god on'));
    const P = g.players[0];
    const platz = (tx, ty, dir) => { const c = Physics.tileCenter(tx, ty); P.x = c.x; P.y = c.y; P.dir = dir || 'down'; P.input.mx = 0; P.input.my = 0; };
    const ader = (id) => k.anker.find((a) => a.id === id);
    const setze = (id, z) => Anker.setzen(g, lp, id, z);
    const awaySolid = () => interior.awaySolid(g);
    const clientSolid = (tx, ty) => page.evaluate(([x, y]) => { const st = __game.state; return Render.buehneBewegungSolid(Shared_Maps[st.away.map], st)(x, y); }, [tx, ty]);
    const hinweis = (a) => page.evaluate(([x, y]) => { const st = __game.state, m = st.players.find((p) => p.id === __game.pid); return __game.client.interactionAt ? __game.client.interactionAt(st, m, x, y, 'away', false) : 'KEIN interactionAt'; }, [a.x, a.y]);
    const warte = async (z, id) => { for (let i = 0; i < 100; i++) { const zz = await page.evaluate(([i2]) => { const st = __game.state; const m = Shared_Maps[st.away.map]; return Render.ankerZustand(m, st, m.anker.findIndex((a) => a[0] === i2)); }, [id]); if (zz === z) return true; await sleep(100); } return false; };
    // Nahaufnahme (Sitzkamera schraeg von Sueden, ohne Oberflaechen-HUD): nur zum Betrachten
    const nahAn = async (a) => {
      await page.evaluate(() => { const e = document.getElementById('game'); if (e) e.style.visibility = 'hidden'; });
      await page.evaluate(([cx, cz]) => { const R = VoxelRender.renderer; if (window.Render) window.Render.teamVision = () => null; R.setSeat({ pos: [cx, 2.4, cz + 2.8], look: [cx, 0.3, cz - 0.3], fov: 40 }); }, [a.x + 0.5, a.y + 0.5]);
    };
    const nahAus = async () => { await page.evaluate(() => { VoxelRender.renderer.setSeat(null); const e = document.getElementById('game'); if (e) e.style.visibility = ''; }); await sleep(300); };
    const nah = async (name, a) => { await nahAn(a); await sleep(1500); await page.screenshot({ path: path.join(OUT, `abbau-${name}-nah.png`) }); await nahAus(); };
    const kit0 = await page.evaluate(IM_BROWSER.kit);
    ok(kit0.fehler === 0, `Kit ohne Fehler (${kit0.fehler}); Platzhalter ${JSON.stringify(kit0.platzhalter)}`);

    // ---- je Zustand: Hinweis, Kollision, Prop, Bild
    const a1 = ader('abbau.1');
    const stand = { x: a1.x, y: a1.y - 1 };   // Figur nördlich, die Ader südlich von ihr (Kamera schaut von Süden: der Worst-Case der Lesbarkeit)
    const MESS = {};
    // laeuft laesst sich nicht setzen (ohne Halter faellt die Ader im Server-Tick auf da zurueck): dieser Zustand kommt weiter unten ueber den echten Halteweg
    for (const z of ZUSTAENDE.filter((q) => q !== 'laeuft')) {
      setze('abbau.1', z);
      ok(await warte(z, 'abbau.1'), `Client uebernimmt Zustand ${z} (ao)`);
      platz(stand.x, stand.y, 'down'); await sleep(1800);
      const h = z === 'leer' ? null : await hinweis(a1);
      const soll = { da: ['E halten: Erz abbauen (', true], abgebaut: ['Die Ader ist ersch\u00f6pft', false], leer: null }[z];
      if (soll === null) ok(await hinweis(a1) === null, `leer: kein Hinweis, nichts angeboten (${JSON.stringify(await hinweis(a1))})`);
      else ok(h && h.label.startsWith(soll[0]) && h.ok === soll[1], `${z}: Hinweis "${h && h.label}" ok=${h && h.ok}`);
      if (z === 'da') ok(h && /5 s/.test(h.label) && /Treffer unterbricht/.test(h.label), `da: Haltezeit ${CONFIG.anker.halten.abbau} s und Treffer-Hinweis im Text`);
      // Kollision: Client = Server
      const cs = await clientSolid(a1.x, a1.y), ss = !!awaySolid()(a1.x, a1.y);
      ok(cs === ss && cs === (z !== 'leer'), `${z}: Kollision der Kachel Client ${cs} = Server ${ss} = ${z !== 'leer'}`);
      // Prop
      const pr = await page.evaluate(IM_BROWSER.prop, { id: 'abbau.1' });
      MESS[z] = pr;
      if (z === 'leer') ok(!pr || pr.meshes === 0, 'leer: keine Geometrie gezeichnet (' + (pr ? pr.meshes + ' Meshes' : 'keine Gruppe') + ')');
      else {
        const bx = pr && pr.box;
        ok(pr && pr.meshes > 0 && pr.tris > 0, `${z}: Prop erzeugt (${pr && pr.meshes} Meshes, ${pr && pr.tris} Dreiecke)`);
        ok(bx && bx.x0 >= -0.51 && bx.x1 <= 0.51 && bx.z0 >= -0.51 && bx.z1 <= 0.51, `${z}: Footprint innerhalb einer Kachel (x ${bx && bx.x0.toFixed(2)}..${bx && bx.x1.toFixed(2)}, z ${bx && bx.z0.toFixed(2)}..${bx && bx.z1.toFixed(2)})`);
        ok(bx && bx.y1 <= (z === 'laeuft' ? 1.1 : 0.9) + 1e-6, `${z}: nicht hoeher als der Fund-Sockel (0,85 m; laeuft mit Funken bis 1,1): ${bx && bx.y1.toFixed(2)} m`);
      }
      await page.screenshot({ path: path.join(OUT, `abbau-${z}.png`) });
      await nah(z, a1);
    }
    ok(MESS.da && MESS.abgebaut && MESS.abgebaut.box.y1 < MESS.da.box.y1 && MESS.abgebaut.tris > 0, `abgebaut ist kleiner als da (${MESS.abgebaut && MESS.abgebaut.box.y1.toFixed(2)} < ${MESS.da && MESS.da.box.y1.toFixed(2)} m)`);

    // ---- echter Halteweg an Ader 2
    const a2 = ader('abbau.2');
    abschnitt('Halten (E) an einer Ader: Fortschritt, Zustand, Loslassen, Vollendung');
    setze('abbau.2', 'da'); await warte('da', 'abbau.2');
    platz(a2.x, a2.y - 1, 'down'); await sleep(800);
    // HUD-Texte mitschreiben (Render.text): Boden-HUD "Erz: n" und Hinweis waehrend des Haltens
    await page.evaluate(() => { window.__texte = []; const t0 = Render.text; Render.text = function (c, s) { if (window.__texte.length < 4000) window.__texte.push(String(s)); return t0.apply(this, arguments); }; });
    const texte = async () => { await page.evaluate(() => { window.__texte = []; }); await sleep(400); return page.evaluate(() => window.__texte.slice()); };
    const t0 = await texte();
    ok(t0.some((t) => /^Erzader: \d+\/\d+/.test(t)) && !t0.some((t) => /^Erz: /.test(t)), 'Boden-HUD ohne Erz im Lager: Zielzaehler da, "Erz: n" nicht (' + t0.filter((t) => /^Erz/.test(t)).join(' | ') + ')');
    await page.evaluate(() => __game.send({ t: 'act', down: true }));
    let aktion = null;
    for (let i = 0; i < 40 && !(aktion && aktion.progress > 0.15); i++) { await sleep(100); aktion = (await page.evaluate(IM_BROWSER.ich)).action; }
    ok(aktion && aktion.kind === 'anker:abbau' && aktion.progress > 0, `Halten: Aktion ${JSON.stringify(aktion)} (Fortschritt kommt vom Server, Beschriftung ABBAUEN)`);
    ok(await warte('laeuft', 'abbau.2'), 'Halten: Ader im Zustand laeuft');
    await page.screenshot({ path: path.join(OUT, 'abbau-laeuft.png') });   // mit Fortschrittsbalken
    const t2 = await texte();
    ok(!t2.some((t) => /^E halten: Erz abbauen/.test(t)), 'Halten: Hinweistext "E halten: Erz abbauen" wird nicht gezeichnet (Ring bleibt frei) (' + t2.filter((t) => /Erz/.test(t)).join(' | ') + ')');
    const pr2 = await page.evaluate(IM_BROWSER.prop, { id: 'abbau.2' });
    MESS.laeuft = pr2;
    ok(pr2 && pr2.meshes > 0 && pr2.box.x0 >= -0.51 && pr2.box.x1 <= 0.51 && pr2.box.z0 >= -0.51 && pr2.box.z1 <= 0.51 && pr2.box.y1 <= 1.1 + 1e-6, `laeuft: Prop innerhalb der Kachel, hoechstens 1,1 m mit Funken (${pr2 && pr2.box.y1.toFixed(2)} m)`);
    ok(pr2 && MESS.da && pr2.tris > MESS.da.tris, `laeuft hat zusaetzlich die Funken (${pr2 && pr2.tris} > ${MESS.da && MESS.da.tris} Dreiecke)`);
    ok(await clientSolid(a2.x, a2.y) === true && !!awaySolid()(a2.x, a2.y) === true, 'laeuft: Kollision Client und Server fest');
    // fremder Halter (GEL-03 N2): Quelle ist away.ab = [[Ankerindex, Spieler-ID]] aus dem Server-Snapshot, nicht der Abstand. Kopie des Snapshots: zwei Adern laufen (a1, a2), nur a2 hat den
    // Halter 'fremd'; die Figur 'fremd' steht dabei neben a1 (die alte Abstandsheuristik haette dort den Hinweis gezeigt). Nur an a2 steht der Fremd-Hinweis.
    const fremd = await page.evaluate(([x1, y1, x2, y2]) => {
      const st = __game.state, m = st.players.find((p) => p.id === __game.pid), map = Shared_Maps[st.away.map];
      const i1 = map.anker.findIndex((a) => a[2] === x1 && a[3] === y1), i2 = map.anker.findIndex((a) => a[2] === x2 && a[3] === y2);
      const ao = (st.away.ao || []).filter((e) => e[0] !== i1 && e[0] !== i2).concat([[i1, 1], [i2, 1]]);   // Zustandsindex 1 = laeuft
      const kopie = (ab) => Object.assign({}, st, { away: Object.assign({}, st.away, { ao, ab }), players: st.players.concat([{ id: 'fremd', zone: 'away', x: x1 * 32 + 16, y: (y1 + 1) * 32 + 16, action: { kind: 'anker:abbau', progress: 0.3 } }]) });
      const t = (k, x, y) => __game.client.interactionAt(k, m, x, y, 'away', false);
      return { an2: t(kopie([[i2, 'fremd']]), x2, y2), an1: t(kopie([[i2, 'fremd']]), x1, y1), ohne: t(kopie(undefined), x2, y2), eigener: t(kopie([[i2, m.id]]), x2, y2) };
    }, [a1.x, a1.y, a2.x, a2.y]);
    ok(fremd.an2 && fremd.an2.label === 'Dort wird schon abgebaut.' && fremd.an2.ok === false, 'fremder Halter an a2 (away.ab): "' + (fremd.an2 && fremd.an2.label) + '" (Text des Servers)');
    ok(fremd.an1 && fremd.an1.ok === true && /E halten/.test(fremd.an1.label), 'zweite Ader nebenan ohne Halter: kein Fremd-Hinweis, obwohl die fremde Figur daneben steht (' + (fremd.an1 && fremd.an1.label) + ')');
    ok(fremd.ohne && fremd.ohne.ok === true, 'ohne away.ab (kein Halter bekannt): kein Fremd-Hinweis, der Server entscheidet');
    ok(fremd.eigener && fremd.eigener.ok === true, 'away.ab nennt mich selbst: weiter E halten');
    const abEcht = await page.evaluate(() => (__game.state.away || {}).ab || null), pidEcht = await page.evaluate(() => __game.pid);
    ok(Array.isArray(abEcht) && abEcht.length === 1 && abEcht[0][1] === pidEcht, 'echter Snapshot waehrend des eigenen Haltens: away.ab = ' + JSON.stringify(abEcht));
    const eigen = await hinweis(a2);
    ok(eigen && eigen.ok === true, 'Halten: eigener Halter sieht weiter "E halten" (' + (eigen && eigen.label) + ')');
    await page.evaluate(() => __game.send({ t: 'act', down: false }));
    await sleep(600);
    ok(await warte('da', 'abbau.2') && !(await page.evaluate(IM_BROWSER.ich)).action, 'Loslassen: Ader zurueck auf da, kein Fortschrittsbalken');
    // zweites Halten nur fuer das Nahbild (Sitzkamera steht schon, wenn das Halten beginnt)
    await nahAn(a2);
    await page.evaluate(() => __game.send({ t: 'act', down: true }));
    await warte('laeuft', 'abbau.2'); await sleep(300);
    await page.screenshot({ path: path.join(OUT, 'abbau-laeuft-nah.png') });
    await page.evaluate(() => __game.send({ t: 'act', down: false }));
    await nahAus();
    ok(await warte('da', 'abbau.2'), 'Loslassen (zweites Halten): wieder da');
    await page.evaluate(() => __game.send({ t: 'act', down: true }));
    await sleep((CONFIG.anker.halten.abbau + 1.5) * 1000);
    await page.evaluate(() => __game.send({ t: 'act', down: false }));
    ok(await warte('abgebaut', 'abbau.2'), 'voll gehalten: Ader abgebaut');
    const h2 = await hinweis(a2);
    ok(h2 && h2.label === 'Die Ader ist ersch\u00f6pft' && h2.ok === false, 'abgebaut: "' + (h2 && h2.label) + '"');
    const aufg = path.join(OUT, 'abbau-abgebaut-nach-halten.png'); await page.screenshot({ path: aufg });
    const t3 = await texte();
    const erzSnap = await page.evaluate(() => (__game.state.inventory || {}).erz || 0);
    ok(erzSnap > 0 && t3.includes('Erz: ' + erzSnap), 'Boden-HUD mit Erz im Lager: "Erz: ' + erzSnap + '" gezeichnet (' + t3.filter((t) => /^Erz/.test(t)).join(' | ') + ')');
    

    ok(fehler.length === 0, `keine Konsolenfehler, keine Loader-Warnungen (${fehler.length}${fehler[0] ? ': ' + fehler[0] : ''})`);
    const kit1 = await page.evaluate(IM_BROWSER.kit);
    ok(kit1.fehler === 0, `Kit nach allen Zustandswechseln ohne Fehler (${kit1.fehler})`);
    ok(g.errors === 0 || (Array.isArray(g.errors) && !g.errors.length), `keine Serverfehler (${Array.isArray(g.errors) ? g.errors.length : g.errors})`);
  } finally { await b.close().catch(() => null); await srv.close(); }
}

(async () => {
  quelltext();
  const k = karte();
  await mitBrowser(k);
  console.log(`${n - bad}/${n} Pruefungen gruen`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FEHLER', e && e.stack || e); process.exit(1); });
