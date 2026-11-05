#!/usr/bin/env node
// ITM-01 E: Browser-Prüfung und Aufnahmen des Fallen-Clients mit echtem Server (--debug): verborgene und passive Fallen aller drei Typen (druck, schuss, schott) in einer Karte,
// Aufnahmen aller Zustände (nur passive sichtbar, Scan enthüllt, entschärft, ausgelöst), Druckfeld an und aus, Selbstschuss, Schott zu und wieder offen (Station), E-Hinweis und Entschärfen-Balken.
// Je Render-Modus (2d, voxel) ein frischer Server. Prüft Konsolenfehler und im Voxel-Modus kitFehler 0 (VoxelKit.stats().fehler).
//   node tools/itm01-e-shots.js [--render 2d|voxel|beide] [--out shots/itm01-e] [--port 3412]
// Bilder: <out>/<render>-NN-name.png (gitignored, Ordner shots/). Daten des Servers: <out>/daten-<render>/ (außerhalb der Quellen). Voraussetzung: playwright-core (PLAYWRIGHT_CORE), public/voxel für voxel.
// Hinweis: Der Schuss-Strahl und der Auslöse-Ring leben 0,2 bis 0,6 s; für ein deterministisches Bild wird das vom Server geschickte Ereignis unmittelbar vor der Aufnahme noch einmal in den Renderer gegeben
// (Render.fallenEreignis, derselbe Weg wie client.js). Die echte Ereigniskette prüft tools/itm01-e-gruppe.js.
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; };
const PORT0 = +arg('port', '3412');
const MODI = arg('render', 'beide') === 'beide' ? ['2d', 'voxel'] : [arg('render', 'beide')];
const OUT = path.resolve(ROOT, arg('out', 'shots/itm01-e'));
function playwright() {
  for (const k of [process.env.PLAYWRIGHT_CORE, 'playwright-core', 'C:/tmp/pw-test/node_modules/playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* nächster */ } }
  console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE).'); process.exit(2);
}
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

async function lauf(RENDER, PORT) {
  console.log('\n=== Render-Modus ' + RENDER + ' ===');
  const DATEN = path.join(OUT, 'daten-' + RENDER);
  fs.rmSync(DATEN, { recursive: true, force: true });
  fs.mkdirSync(DATEN, { recursive: true });
  Object.assign(process.env, { WORLD_DIR: path.relative(ROOT, path.join(DATEN, 'worlds')), REGIE_DIR: path.relative(ROOT, path.join(DATEN, 'regie')), ERZEUGT_DIR: path.relative(ROOT, path.join(DATEN, 'erzeugt')), ROOM_CODE: 'off', MISSION_SOURCE: 'fallback' });
  delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
  const { startServer } = require('../server/index.js');
  const W = require('../server/world.js');
  const Anker = require('../server/sim/anker.js');
  const Fallen = require('../server/sim/fallen.js');
  const Buehne = require('../shared/buehne.js');
  const Physics = require('../shared/physics.js');
  const srv = await startServer({ port: PORT, debug: true, roomCode: 'off', quiet: true });
  const game = srv.game;
  const b = await chromium.launch();
  const err = [];
  let nr = 0;
  try {
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => err.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') err.push('console: ' + m.text().slice(0, 240)); });
    await page.goto(`http://127.0.0.1:${PORT}/?render=${RENDER}&debug=1`);
    await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000, polling: 20 });
    await page.waitForTimeout(1500);
    // zweiter Spieler = Captain (immer 2D): zeigt die Kommandokarte des Reiters Außenteam mit den Fallen (Minikarte und Kommandokarte)
    const cap = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    cap.on('pageerror', (e) => err.push('captain pageerror: ' + e.message));
    cap.on('console', (m) => { if (m.type() === 'error') err.push('captain console: ' + m.text().slice(0, 240)); });
    await cap.goto(`http://127.0.0.1:${PORT}/?render=2d&debug=1`);
    await cap.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000, polling: 20 });
    await page.waitForTimeout(800);
    for (const pg of [page, cap]) { await pg.evaluate(() => __game.send({ t: 'lobbyOpt', skipDrill: true })); await pg.evaluate(() => __game.send({ t: 'ready', ready: true })); }
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await page.waitForTimeout(2500);
    await cap.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'captain' }));
    await page.waitForTimeout(700);
    const p = game.players[0];
    const capShot = async (name) => { const pc = game.players[1]; if (pc && pc.zone !== 'ship') require('../server/sim/interior.js').placeOnShipPad(game, pc, 1); await page.waitForTimeout(500); await cap.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'captain' })); await page.waitForTimeout(800); await cap.keyboard.press('Digit4'); await cap.mouse.move(5, 5); await page.waitForTimeout(700); const f = path.join(OUT, RENDER + '-captain-' + name + '.png'); await cap.screenshot({ path: f }); console.log('  Bild ' + path.relative(ROOT, f).split(path.sep).join('/')); };
    const shot = async (name, clip) => { nr++; const f = path.join(OUT, RENDER + '-' + String(nr).padStart(2, '0') + '-' + name + '.png'); await page.screenshot(clip ? { path: f, clip } : { path: f }); console.log('  Bild ' + path.relative(ROOT, f).split(path.sep).join('/')); return f; };
    const baue = async (befehl) => {
      await page.evaluate((l) => __game.dbg(l), befehl);
      await page.waitForFunction(() => { const st = __game.state, me = st && st.players.find((q) => q.id === __game.pid); return !!(me && me.zone === 'away' && st.away && Shared_Maps[st.away.map] && Shared_Maps[st.away.map].buehne); }, null, { timeout: 60000, polling: 40 });
      if (RENDER === 'voxel') await page.waitForFunction(() => { const s = window.VoxelKit && VoxelKit.stats(); return !!(s && s.id === __game.state.away.map); }, null, { timeout: 90000, polling: 40 });
      await page.waitForTimeout(1500);
      await page.evaluate(() => __game.dbg('god on'));
    };
    const kitFehler = () => (RENDER === 'voxel' ? page.evaluate(() => { const s = VoxelKit.stats(); return { fehler: s.fehler, platzhalter: s.platzhalter || {}, dyn: s.dynamisch }; }) : null);
    const clientIds = () => page.evaluate(() => Shared_Maps[__game.state.away.map].anker.filter((a) => a[1] === 'falle').map((a) => a[0] + ':' + ((a[4] && a[4].typ) || '') + ':' + ((a[4] && a[4].sicht) || '')));
    const zustaende = () => page.evaluate(() => { const st = __game.state, m = Shared_Maps[st.away.map]; return m.anker.map((a, i) => [a[0], a[1], Render.ankerZustand(m, st, i)]).filter((a) => a[1] === 'falle').map((a) => a[0] + '=' + a[2]); });

    // Fallen setzen wie Debug falletest, aber alle sechs auf einmal (ids falle.e1 ..): [typ, sicht] in Reihenfolge der Kandidatenkacheln um den Spieler
    function fallenSetzen(spieler, liste) {
      const aw = game.away, k = W.AWAY_MAPS[aw.map].karte, R = Buehne.raster(k);
      const mitte = Physics.toTile(spieler.x, spieler.y);
      const belegt = new Set(k.anker.map((a) => a.x + ',' + a.y));
      const ring = [[3, 0], [0, 3], [3, 3], [0, -3], [-3, 3], [3, -3], [4, 1], [-1, 4], [1, 4], [-1, -4], [-3, -3], [5, 0], [0, 5], [0, -5], [-3, 0], [-5, 0], [-4, 3], [4, -3]];   // links stehen die Debug- und Missionstafeln: erst rechts und unten, links zuletzt
      const frei = ring.map(([dx, dy]) => ({ x: mitte.x + dx, y: mitte.y + dy })).filter((t) => { const i = R.info(t.x, t.y); return i && i.kante === 'begehbar' && R.durchgang(t.x, t.y) && !belegt.has(t.x + ',' + t.y); });
      if (frei.length < liste.length) throw new Error('zu wenig freie Kacheln um den Spieler (' + frei.length + ')');
      k.anker = k.anker.filter((a) => !/^falle\.e\d+$/.test(a.id));
      for (const id of Object.keys(aw.zustaende || {})) if (/^falle\.e\d+$/.test(id)) delete aw.zustaende[id];
      liste.forEach(([typ, sicht], i) => k.anker.push({ id: 'falle.e' + (i + 1), rolle: 'falle', x: frei[i].x, y: frei[i].y, typ, sicht }));
      Fallen.standVerwerfen(aw);
      for (const q of game.players) { q.awayKv = null; if (q.awayEnth) delete q.awayEnth[aw.map]; }
      return liste.map(([typ, sicht], i) => ({ id: 'falle.e' + (i + 1), typ, sicht, x: frei[i].x, y: frei[i].y }));
    }
    const an = (fid) => W.AWAY_MAPS[game.away.map].karte.anker.find((a) => a.id === fid);
    const eintrag = (fid) => { const a = an(fid); return { id: a.id, x: a.x, y: a.y, px: a.x * 32 + 16, py: a.y * 32 + 16, typ: a.typ, sicht: a.sicht, start: Anker.startFuer(a) }; };

    // ================= Außenposten: alle drei Typen, je passiv und verborgen =================
    await baue('buehne aussenposten 1 - rostmeute intakt');
    // Spieler etwas von der Kartenecke weg: eine freie Kachel mit Platz ringsum (Ankunftspunkt reicht)
    const liste = [['druck', 'passiv'], ['schuss', 'passiv'], ['schott', 'passiv'], ['druck', 'verborgen'], ['schuss', 'verborgen'], ['schott', 'verborgen']];
    const gesetzt = fallenSetzen(p, liste);
    console.log('  Fallen: ' + gesetzt.map((q) => q.id + ' ' + q.typ + '/' + q.sicht + ' @' + q.x + ',' + q.y).join('  '));
    await page.waitForFunction(() => Shared_Maps[__game.state.away.map].anker.some((a) => a[0] === 'falle.e3'), null, { timeout: 15000, polling: 40 });
    await page.mouse.move(1000, 200);
    await page.waitForTimeout(1500);
    let ids = await clientIds();
    ok(ids.length === 3 && ids.every((x) => /:passiv$/.test(x)), 'Client kennt nur die drei passiven Fallen (' + ids.join(', ') + '); die verborgenen stehen nicht in der Liste');
    ok((await zustaende()).every((z) => /=erkannt$/.test(z)), 'passive Fallen starten erkannt (' + (await zustaende()).join(', ') + ')');
    await shot('start-nur-passive-erkannt');

    // E-Hinweis: nur bei erkannt (Client.interactionAt am Browser, drei Zustände)
    const hinweis = (fid, zustandIdx) => page.evaluate(([f, zi]) => {
      const st = __game.state, m = Shared_Maps[st.away.map], i = m.anker.findIndex((a) => a[0] === f), a = m.anker[i];
      const me = st.players.find((q) => q.id === __game.pid);
      const ao = zi == null ? [] : [[i, zi]];
      const st2 = Object.assign({}, st, { away: Object.assign({}, st.away, { ao }) });
      const r = Client.interactionAt(st2, me, a[2], a[3], 'away', false);
      return r ? r.label : null;
    }, [fid, zustandIdx]);
    const hE = await hinweis('falle.e1', null), hN = await hinweis('falle.e1', 2), hA = await hinweis('falle.e1', 3);
    ok(/^E halten: Entschärfen \(3 s\)$/.test(hE || ''), 'E-Hinweis erkannt: „' + hE + '“');
    ok(hN === null && hA === null, 'E-Hinweis entschärft/ausgelöst: keiner (' + hN + ' / ' + hA + ')');

    // Entschärfen-Balken: neben die Druckfalle stellen, E halten (act), Fortschrittsring/Balken nach 1,5 s
    const e1 = an('falle.e1');
    const nb = { x: e1.x * 32 + 16 + 32, y: e1.y * 32 + 16 };
    p.x = nb.x; p.y = nb.y; p.dir = 'left'; p.input.mx = 0; p.input.my = 0;
    await page.waitForTimeout(700);
    await page.evaluate(() => __game.send({ t: 'act', down: true }));
    await page.waitForFunction(() => { const q = __game.state.players.find((x) => x.id === __game.pid); return q.action && q.action.kind === 'anker:falle' && q.action.progress > 0.3; }, null, { timeout: 8000, polling: 30 }).catch(() => null);
    const hold = await page.evaluate(() => { const q = __game.state.players.find((x) => x.id === __game.pid); return q.action || null; });
    ok(hold && hold.kind === 'anker:falle' && hold.progress > 0, 'Entschärfen: Hold anker:falle läuft (Fortschritt ' + (hold && hold.progress) + ')');
    await shot('entschaerfen-halten', { x: 340, y: 160, width: 600, height: 400 });
    await page.waitForFunction(() => { const q = __game.state.players.find((x) => x.id === __game.pid); return !q.action; }, null, { timeout: 8000, polling: 40 }).catch(() => null);
    await page.evaluate(() => __game.send({ t: 'act', down: false }));
    await page.waitForTimeout(600);
    ok(/falle\.e1=entschaerft/.test((await zustaende()).join(',')), 'nach 3 s E halten: die Druckfalle ist entschärft (Server und Client: ' + (await zustaende()).join(', ') + ')');
    // zurück an die Ausgangsstelle (Mitte der Fallen), Zustände für die Aufnahmen neu setzen
    const mitte = { x: game.away && p.x, y: p.y };
    void mitte;
    await shot('nach-entschaerfen');

    // Neu setzen (frische Karte der Fallen), Spieler zurück in die Mitte
    p.x = (an('falle.e1').x + an('falle.e2').x) / 2 * 32 + 16; p.y = (an('falle.e1').y + an('falle.e2').y) / 2 * 32 + 16;
    const gesetzt2 = fallenSetzen(p, liste);
    await page.waitForFunction(() => Shared_Maps[__game.state.away.map].anker.some((a) => a[0] === 'falle.e3'), null, { timeout: 15000, polling: 40 });
    await page.waitForTimeout(1200);
    void gesetzt2;
    // Scan Stufe 2: verborgene Fallen werden erkannt und enthüllt, Marker erscheinen
    const dyn0 = RENDER === 'voxel' ? (await kitFehler()).dyn : null;
    await page.evaluate(() => __game.dbg('scanfertig 2'));
    await page.waitForFunction(() => Shared_Maps[__game.state.away.map].anker.filter((a) => a[1] === 'falle').length >= 6, null, { timeout: 15000, polling: 40 });
    await page.waitForTimeout(1500);
    ids = await clientIds();
    ok(ids.length === 6, 'nach dem Scan (Stufe 2): alle sechs Fallen in der Client-Liste (' + ids.length + ')');
    if (RENDER === 'voxel') { const dyn1 = (await kitFehler()).dyn; ok(dyn1 - dyn0 === 3, 'Voxel: die drei enthüllten Fallen haben ein Prop bekommen (dynamische Objekte ' + dyn0 + ' -> ' + dyn1 + '), ohne Neubau der Karte'); }
    ok((await zustaende()).every((z) => /=erkannt$/.test(z)), 'alle erkannt (' + (await zustaende()).join(', ') + ')');
    await page.mouse.move(1000, 200);
    await shot('scan-stufe2-alle-erkannt');
    await capShot('kommandokarte-nach-scan');
    // Datenblatt-Zeile (Captain-Reiter) wird in Scan-Shots geprüft; hier der Positionstext aus dem Echtbetrieb
    const blatt = await page.evaluate(() => { const sc = __game.state.away.sc || []; const e = ScanAnzeige.lesen(sc).find((x) => x.art === 'falle'); return e ? ScanAnzeige.blatt(ScanAnzeige.zeile(e, ScanAnzeige.store.daten), 32).position : null; });
    ok(/^Position: Feld \d+ \/ \d+$/.test(blatt || ''), 'Datenblatt der Falle nach Stufe 2 trägt die Position: „' + blatt + '“');

    // entschärft: Druck und Schuss (Server setzt direkt, wie ein erfolgreiches Entschärfen), Schott bleibt erkannt
    Anker.setzen(game, game.away.map, 'falle.e1', 'entschaerft', p.id);
    Anker.setzen(game, game.away.map, 'falle.e2', 'entschaerft', p.id);
    await page.waitForTimeout(1200);
    ok(/falle\.e1=entschaerft/.test((await zustaende()).join(',')) && /falle\.e3=erkannt/.test((await zustaende()).join(',')), 'gemischte Zustände: e1/e2 entschärft, e3 erkannt');
    await shot('gemischt-entschaerft-und-erkannt');
    await capShot('kommandokarte-gemischt');

    // ausgelöst: Druck (e4 verborgen -> ausgelöst mit Feld), Schuss (e5) mit Salve auf den Spieler
    await page.evaluate(() => __game.dbg('tune anker.falle.feld.druck.dauer 5'));
    p.x = (an('falle.e4').x + an('falle.e5').x) / 2 * 32 + 16; p.y = (an('falle.e4').y + an('falle.e5').y) / 2 * 32 + 16;
    await page.waitForTimeout(400);
    Fallen.ausloesen(game, game.away, eintrag('falle.e4'), p);
    await page.waitForFunction(() => Render.fallenLaufend(__game.state).some((x) => x.art === 'feld'), null, { timeout: 6000, polling: 30 });
    await page.waitForTimeout(500);
    ok(/falle\.e4=ausgeloest/.test((await zustaende()).join(',')), 'Druckfalle ausgelöst (Zustand ausgelöst)');
    const lz = await page.evaluate(() => Render.fallenLaufend(__game.state));
    ok(lz.length === 1 && lz[0].name === 'DRUCKVERLUST' && lz[0].rest > 0 && lz[0].rest <= 5, 'Lagezeile: DRUCKVERLUST mit Restzeit (' + JSON.stringify(lz) + ')');
    await shot('druckfeld-an');
    await page.waitForFunction(() => !Render.fallenLaufend(__game.state).some((x) => x.art === 'feld'), null, { timeout: 12000, polling: 100 });
    await page.waitForTimeout(700);
    ok((await page.evaluate(() => Render.fallenLaufend(__game.state))).length === 0, 'Druckfeld aus: Lagezeile weg');
    await shot('druckfeld-aus-ausgeloest');

    // Selbstschuss (e5): Salve abwarten, Bild unmittelbar nach dem Ereignis
    await page.evaluate(() => { window.__schuss = null; const o = Render.fallenEreignis; Render.fallenEreignis = function (ev) { if (ev && ev.kind === 'selbstschuss') window.__schuss = JSON.parse(JSON.stringify(ev)); return o.apply(this, arguments); }; });
    Fallen.ausloesen(game, game.away, eintrag('falle.e5'), p);
    await page.waitForFunction(() => !!window.__schuss, null, { timeout: 6000, polling: 20 });
    ok(true, 'Ereignis selbstschuss kam im Client an (' + JSON.stringify(await page.evaluate(() => window.__schuss)) + ')');
    await page.evaluate(() => Render.fallenEreignis(window.__schuss));   // frisch halten (Lebensdauer 0,22 s), dann sofort aufnehmen
    await shot('selbstschuss-strahl');
    await page.waitForTimeout(1800);
    ok(/falle\.e5=ausgeloest/.test((await zustaende()).join(',')), 'Anlage ausgelöst');
    await shot('selbstschuss-nach-der-salve');
    // Ring beim Auslösen (ankerZustand ausgeloest -> Ring): Schott-Falle e6 auslösen (wirkungslos: kein Schott), Ring sichtbar
    Fallen.ausloesen(game, game.away, eintrag('falle.e6'), p);
    await page.waitForTimeout(150);
    await shot('ausloesen-ring-schottfalle');
    await page.waitForTimeout(800);
    await shot('alle-ausgeloest-oder-entschaerft');

    const kf = await kitFehler();
    if (kf) ok(kf.fehler === 0, 'Voxel: kitFehler ' + kf.fehler + ' (Platzhalter: ' + JSON.stringify(kf.platzhalter) + ')');
    if (kf) ok(!Object.keys(kf.platzhalter).some((k) => /falle/.test(k)), 'Voxel: kein Platzhalter für die Falle (die Bauweise liefert Props)');

    // ================= Station: Schott zu und wieder offen =================
    await baue('buehne station 1 - rostmeute intakt');
    const aw = game.away, K = W.AWAY_MAPS[aw.map].karte, R = Buehne.raster(K);
    const kantenIds = Object.keys(K.kanten || {}).filter((id) => K.kanten[id].typ === 'schott' || /schott/.test(id));
    let schottSzene = null;
    for (const kid of kantenIds) {
      const t0 = K.kanten[kid].tiles[0];
      for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-2, -1], [2, 1], [-1, 2], [1, -2]]) {
        const tx = t0[0] + dx, ty = t0[1] + dy, i = R.info(tx, ty);
        if (!(i && i.kante === 'begehbar' && R.durchgang(tx, ty))) continue;
        if (!Buehne.fallenSchottKanten(K, { x: tx, y: ty }, game.C.anker.falle.schott.radius).length) continue;
        // Spieler 2 Kacheln neben der Falle (nicht auf ihr), frei und nicht auf einer Kachel der Kante
        for (const [ex, ey] of [[-2, 0], [2, 0], [0, 2], [0, -2], [-3, 0], [3, 0]]) {
          const px = tx + ex, py = ty + ey, j = R.info(px, py);
          if (j && j.kante === 'begehbar' && R.durchgang(px, py) && !K.anker.some((a) => a.x === px && a.y === py)) { schottSzene = { kid, fx: tx, fy: ty, px, py }; break; }
        }
        if (schottSzene) break;
      }
      if (schottSzene) break;
    }
    ok(!!schottSzene, 'Station: freie Kachel mit Schott im Wirkbereich gefunden (' + JSON.stringify(schottSzene) + ')');
    if (schottSzene) {
      p.x = schottSzene.px * 32 + 16; p.y = schottSzene.py * 32 + 16;
      K.anker.push({ id: 'falle.e1', rolle: 'falle', x: schottSzene.fx, y: schottSzene.fy, typ: 'schott', sicht: 'passiv' });
      Fallen.standVerwerfen(game.away);
      for (const q of game.players) { q.awayKv = null; if (q.awayEnth) delete q.awayEnth[aw.map]; }
      await page.evaluate(() => __game.dbg('tune anker.falle.schott.dauer 6'));
      await page.waitForFunction(() => Shared_Maps[__game.state.away.map].anker.some((a) => a[0] === 'falle.e1'), null, { timeout: 15000, polling: 40 });
      await page.waitForTimeout(1500);
      await shot('schott-vorher-offen');
      Fallen.ausloesen(game, game.away, eintrag('falle.e1'), p);
      await page.waitForFunction(() => Render.fallenLaufend(__game.state).some((x) => x.art === 'schott'), null, { timeout: 6000, polling: 30 });
      await page.waitForTimeout(900);
      const kz = await page.evaluate((kid) => { const st = __game.state, m = Shared_Maps[st.away.map]; const idx = m.kanten.findIndex((k) => k[0] === kid); return Render.kantenZustand(m, st, idx); }, schottSzene.kid);
      ok(kz === 'zu', 'Schott-Kante ' + schottSzene.kid + ' ist zu (Client liest ko: ' + kz + ')');
      ok((await page.evaluate(() => Render.fallenLaufend(__game.state).map((x) => x.name + ' ' + x.rest))).join() !== '', 'Lagezeile SCHOTTS GESPERRT mit Restzeit');
      await shot('schott-zu');
      await page.waitForFunction(() => !Render.fallenLaufend(__game.state).some((x) => x.art === 'schott'), null, { timeout: 12000, polling: 100 });
      await page.waitForTimeout(900);
      const kz2 = await page.evaluate((kid) => { const st = __game.state, m = Shared_Maps[st.away.map]; const idx = m.kanten.findIndex((k) => k[0] === kid); return Render.kantenZustand(m, st, idx); }, schottSzene.kid);
      ok(kz2 !== 'zu', 'nach der Dauer ist die Kante wieder offen (' + kz2 + ')');
      await shot('schott-wieder-offen');
    }
    const kf2 = await kitFehler();
    if (kf2) ok(kf2.fehler === 0, 'Voxel (Station): kitFehler ' + kf2.fehler);

    console.log('Konsolenfehler (' + RENDER + '): ' + err.length); err.slice(0, 8).forEach((e) => console.log('  ' + e));
    if (err.length) fails++;
  } finally { await b.close().catch(() => null); await srv.close().catch(() => null); }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [i, m] of MODI.entries()) await lauf(m, PORT0 + i);
  console.log(fails ? '\n' + fails + ' FEHLER' : '\nalle ok');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
