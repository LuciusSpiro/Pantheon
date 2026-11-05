#!/usr/bin/env node
// SCA-01 P4: Browser-Beleg der Scan-Anzeige. Zwei Clients: A am Boden (Kesh, Debug scantest/scanfertig), B als Captain im Reiter Außenteam (Taste 4).
//   node tools/sca01-p4-shots.js [--out <ordner>] [--port 3396] [--render 2d|voxel] [--vergleich <ordner-mit-Basisbild>] [--content <datei.json>] [--nur basis]
// Bilder (Präfix <render>-): captain-a-ohne (Reiter ohne Ergebnis), captain-b-stufe1 (kein Positionsmarker), captain-c-stufe3 (Marker + Datenblatt mit Position),
// captain-d-viele (5+ Einträge, „+n weitere“), boden-a-stufe1 (kein Marker), boden-b-stufe3 (Marker am Boden), dazu ein Ausschnitt. --vergleich: Bild captain-a-ohne gegen ein
// Basisbild (z. B. vom Stand vor P4) vergleichen (Pixelvergleich außerhalb der dynamischen Zonen).
// Nacharbeit (SCA-01 NC): --content <datei> übersteuert content/scanner/datenblaetter.json NUR im Lauf (der Browser bekommt die Datei statt der Repo-Datei, das Repo bleibt unberührt); ohne --content gilt der Repo-Content.
// Zusätzliche Bilder (Präfix <render>-): captain-f-real-stufe1/-stufe3 (reale lange Texte), captain-f-hinweis130 (überlanger Hinweis), flanke-karte/flanke-boden (Captain-Befehl Flanke + Scan-Marker zugleich),
// captain-h-sechs-vorher/-nachher (6 Einträge, Fokus per BildB), captain-h-hover (Kürzel nur bei Hover), overlay-mit-oda/overlay-ohne-oda (Scanner-Overlay an fester Stelle, mit und ohne ODA-Zeile), captain-j-gestoert-ergebnis (q < 1 mit Ergebnissen: Störrelais-Zeile).
// Datenordner des Servers (Weltstand, Regie, erzeugt) liegen im Temp-Verzeichnis (os.tmpdir) und werden am Ende entfernt, nicht im Repo. --nur basis lässt die Nacharbeit-Bilder aus. Prüft nebenbei, dass der Client keine Browserfehler wirft.
// Server im Prozess (--debug, eigene Datenordner). Voraussetzung: playwright-core (PLAYWRIGHT_CORE), für --render voxel public/voxel (npm run assets).
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.join(__dirname, '..');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; };
const PORT = +arg('port', '3396');
const RENDER = arg('render', '2d');
const OUT = path.resolve(ROOT, arg('out', 'shots/sca01-p4'));
const VERGLEICH = arg('vergleich', null);
const CONTENT = arg('content', null) ? path.resolve(arg('content', null)) : null;
const NUR = arg('nur', null);
let contentDatei = CONTENT;   // --content: nur im Lauf, die Repo-Datei bleibt unberührt
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sca01-p4-'));
const DIRS = { WORLD_DIR: path.join(TMP, 'worlds'), REGIE_DIR: path.join(TMP, 'regie'), ERZEUGT_DIR: path.join(TMP, 'erzeugt') };
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
Object.assign(process.env, DIRS, { ROOM_CODE: 'off', MISSION_SOURCE: 'fallback' });
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
function playwright() {
  for (const k of [process.env.PLAYWRIGHT_CORE, 'playwright-core', 'C:/tmp/pw-test/node_modules/playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* nächster */ } }
  console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE).'); process.exit(2);
}
const { chromium } = playwright();
const { startServer } = require('../server/index.js');
const Scanbar = require('../server/sim/scanbar.js');
const Loadout = require('../server/sim/loadout.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Nacharbeit-Bilder (SCA-01 NC). Reihenfolge: reale Texte -> Flanke+Marker -> 6 Einträge/Fokus per Taste/Hover -> Overlay mit/ohne ODA -> gestörter Scan mit Ergebnissen.
async function nacharbeit(ctx) {
  const { A, C, game, shot, dbg, scState, sleep, p } = ctx;
  const echt = CONTENT || null;
  // Ausschnitt des 640x360-Bilds (Canvas, im Voxel-Modus mit dem 3D-Canvas darunter) mit Faktor f ohne Glättung vergrößert – damit Formen (Raute, Eckwinkel, Strichelung) beurteilbar sind
  const zoom = async (pg, name, r, f) => {
    const url = await pg.evaluate(([r, f, voxel]) => {
      const o = document.createElement('canvas'); o.width = r.w * f; o.height = r.h * f;
      const x = o.getContext('2d'); x.imageSmoothingEnabled = false;
      if (voxel) { const w3 = document.getElementById('world3d'); if (w3) x.drawImage(w3, r.x, r.y, r.w, r.h, 0, 0, o.width, o.height); }
      x.drawImage(document.getElementById('game'), r.x, r.y, r.w, r.h, 0, 0, o.width, o.height);
      return o.toDataURL('image/png');
    }, [r, f, RENDER === 'voxel']);
    const file = path.join(OUT, RENDER + '-' + name + '.png'); fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64')); console.log(file);
  };
  const setContent = async (datei) => { contentDatei = datei; await C.evaluate(() => ScanAnzeige.laden()); await sleep(400); };
  const tmpInhalt = (typen) => { const f = path.join(TMP, 'content-' + Math.random().toString(36).slice(2) + '.json'); const basis = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/scanner/datenblaetter.json'), 'utf8')); Object.assign(basis.typen, typen); fs.writeFileSync(f, JSON.stringify(basis)); return f; };
  // (1) Datenblatt mit realem langem Text. Ohne --content: eingebauter Satz echter Längen (zeile 2 Beispiele, Hinweis wie im Auftrag); mit --content: genau diese Datei.
  const REAL = { testerz: { name: 'Kupfererz-Ader', gefahr: 0, zeile: 'Erzader mit hohem Reinheitsgrad', hinweis: 'Mit der Spitzhacke abbauen, 3 s halten.', hinweisAb: 1, symbol: 'ER' },
    testmonster: { name: 'Panzerkäfer', gefahr: 3, zeile: 'Schweres Tier, jagt im Rudel.', hinweis: 'Panzerung vorn, Schwachstelle am Rücken. Bäume und Felsen halten es auf.', hinweisAb: 1, symbol: 'PK' } };
  const LANG130 = 'Ein überlanger Regelhinweis, der weit mehr als hundert Zeichen hat und deshalb gekürzt werden muss, ohne die Positionszeile zu verdrängen. Wirklich.';
  ok(LANG130.length >= 130, 'Testhinweis hat ' + LANG130.length + ' Zeichen (>= 130)');
  await setContent(echt || tmpInhalt(REAL));
  await dbg(A, 'scantest');
  await dbg(A, 'scanfertig', { stufe: 1 });
  await sleep(800);
  await shot(C, 'captain-f-real-stufe1');
  await dbg(A, 'scanfertig', { stufe: 3 });
  await sleep(800);
  await shot(C, 'captain-f-real-stufe3');
  console.log('Echte Schriftbreiten (px):', JSON.stringify(await C.evaluate(() => ['Erzader mit hohem Reinheitsgrad', 'x'.repeat(34), 'Störrelais stören den Scan', 'Unbekanntes Objekt'].map((t) => [t.slice(0, 20), Render.measure(t, 1)]))));
  const pos3 = await C.evaluate(() => Consoles.scanAnsicht(__game.state.away) && Consoles.scanMass(Consoles.scanAnsicht(__game.state.away), 318).sheet.map((l) => l.art + ':' + l.text));
  console.log('Datenblatt (Fokus):', JSON.stringify(pos3));
  ok(Array.isArray(pos3) && /^pos:Position: Feld /.test(pos3[pos3.length - 1]), 'Datenblatt Stufe 3: letzte Zeile ist die Position');
  // überlanger Hinweis (130 Zeichen) am Monster
  if (!echt) {
    await setContent(tmpInhalt(Object.assign({}, REAL, { testmonster: Object.assign({}, REAL.testmonster, { hinweis: LANG130 }) })));
    await sleep(500);
    await shot(C, 'captain-f-hinweis130');
    const l130 = await C.evaluate(() => Consoles.scanMass(Consoles.scanAnsicht(__game.state.away), 318).sheet.map((l) => l.art + ':' + l.text));
    ok(/^pos:Position: Feld /.test(l130[l130.length - 1]) && /…$/.test(l130[l130.length - 2]), 'Hinweis mit 130+ Zeichen: endet mit „…“, Position bleibt sichtbar (' + JSON.stringify(l130.slice(-2)) + ')');
    await setContent(tmpInhalt(REAL));
  }

  // (2) Captain-Befehl Flanke + Scan-Marker zugleich (Karte und Boden)
  const mk = await C.evaluate(() => (__game.state.away.sc || []).filter((r) => r.length >= 6).map((r) => ({ id: r[0], x: r[4], y: r[5] })));
  ok(mk.length >= 2, 'Marker mit Position vorhanden (' + mk.length + ')');
  const m0 = mk[0];
  // Flanke dicht neben das Ziel (30 px) und genau auf ein zweites Ziel: beide Fälle (nebeneinander / übereinander) müssen unterscheidbar bleiben
  const m1 = mk[1];
  await C.evaluate(([x, y]) => __game.send({ t: 'cmd', c: 'captain.order', kind: 'flanke', x, y }), [Math.round(m0.x + 30), Math.round(m0.y + 14)]);
  await C.evaluate(([x, y]) => __game.send({ t: 'cmd', c: 'captain.order', kind: 'gefahr', x, y }), [Math.round(m1.x), Math.round(m1.y)]);
  await sleep(900);
  await shot(C, 'flanke-karte');
  await shot(A, 'flanke-boden');
  const mr = await C.evaluate(() => Consoles.maps.away.rect);
  await zoom(C, 'flanke-karte-zoom', mr, 4);
  await zoom(A, 'flanke-boden-zoom', { x: 140, y: 40, width: 360, height: 270, w: 360, h: 270 }, 3);
  await C.evaluate(() => __game.send({ t: 'cmd', c: 'captain.order', kind: 'gefahr', clear: true }));

  // (3) sechs Einträge, „+n weitere“, Fokus per Taste
  const weg = Scanbar.scanbarAnmelden('erz', { ziele: () => [{ id: 'e1', typ: 'erzader', x: p.x + 60, y: p.y + 40 }, { id: 'e2', typ: 'erzader', x: p.x - 70, y: p.y - 20 }, { id: 'e3', typ: 'unbekannt_xyz', x: p.x + 20, y: p.y + 90 }] });
  await dbg(A, 'scanfertig', { stufe: 2 });
  await sleep(700);
  ok(JSON.parse(await scState(C)).length === 6, 'sechs Einträge im Snapshot');
  await C.evaluate(() => { const l = ScanAnzeige.ansicht(__game.state.away.sc, 4); ScanAnzeige.waehle(l.zeilen[0].key); });
  await sleep(500);
  await shot(C, 'captain-h-sechs-vorher');
  const fok = [];
  for (let i = 0; i < 6; i++) { await C.keyboard.press('PageDown'); await sleep(250); fok.push(await C.evaluate(() => ScanAnzeige.fokusKey())); if (i === 3) await shot(C, 'captain-h-sechs-nachher'); }
  ok(new Set(fok).size === 6, 'BildB durchläuft alle sechs Einträge (' + fok.join(' ') + ')');
  await C.keyboard.press('PageUp'); await sleep(250);
  ok((await C.evaluate(() => ScanAnzeige.fokusKey())) === fok[4], 'BildA geht einen Eintrag zurück');
  // Hover: Maus über einen Marker, Kürzel erscheint nur dort
  const hv = await C.evaluate(() => { const m = Consoles.maps.away.scanRects[0]; const r = document.getElementById('game').getBoundingClientRect(); return { x: r.left + (m.x + m.w / 2) * Client.scale, y: r.top + (m.y + m.h / 2) * Client.scale }; });
  await C.mouse.move(hv.x, hv.y); await sleep(500);
  await shot(C, 'captain-h-hover');
  await C.mouse.move(5, 5);
  // Klick auf einen Marker setzt keinen Befehl (D3)
  const befVor = await C.evaluate(() => JSON.stringify((__game.state.away.orders || []).map((o) => o.id + o.x + o.y)));
  await C.mouse.click(hv.x, hv.y); await sleep(500);
  ok((await C.evaluate(() => JSON.stringify((__game.state.away.orders || []).map((o) => o.id + o.x + o.y)))) === befVor, 'Klick auf einen Scan-Marker setzt keinen Befehl');
  await C.mouse.move(5, 5);
  weg();

  // (4) Overlay an fester Stelle, mit und ohne ODA-Zeile (Scanner in Slot 2, Taste 2 startet)
  Loadout.slotSetzen(game, p, 1, 'scanner'); Loadout.standSenden(game, p);
  game.C.scanner.abklingzeit = 0;
  await A.waitForFunction(() => Hud.loadoutStand && Hud.loadoutStand.slots.includes('scanner'), null, { timeout: 8000, polling: 40 });
  await A.mouse.move(900, 300);
  await A.evaluate(() => { Hud.oda.cur = null; Hud.oda.queue = []; });
  const slotTaste = await A.evaluate(() => 'Digit' + (Hud.loadoutStand.slots.indexOf('scanner') + 1));
  const warteScan = (an) => A.waitForFunction((v) => { const q = __game.state.players.find((x) => x.id === __game.pid); return !!(q.action && q.action.kind === 'scan') === v; }, an, { timeout: 5000, polling: 30 });
  await A.keyboard.press(slotTaste); await warteScan(true); await sleep(500);
  await shot(A, 'overlay-ohne-oda');
  await A.evaluate(() => { Hud.oda.queue = []; Hud.oda.cur = { text: 'Orbitale Datenanalyse: Drei Signaturen im Südkorridor, Abstand wachsend. Empfehlung: Deckung suchen.', shown: 999 }; Hud.oda.queue.push({ text: 'Zweite Meldung' }); });
  await sleep(400);
  await shot(A, 'overlay-mit-oda');
  const rO = await A.evaluate(() => Scanner.rechteck());
  ok(rO.y === 360 - 8 - 84 && rO.w === 240 && rO.h === 84, 'Overlay 240x84 an fester Stelle y = 268 (' + JSON.stringify(rO) + ')');
  await shot(A, 'overlay-mit-oda-ausschnitt', { x: 300, y: 440, width: 700, height: 280 });
  await A.keyboard.press('Escape'); await warteScan(false); await sleep(400);
  await A.evaluate(() => { Hud.oda.cur = { text: 'Orbitale Datenanalyse: Drei Signaturen im Südkorridor, Abstand wachsend. Empfehlung: Deckung suchen.', shown: 999 }; Hud.oda.queue = []; });
  await sleep(300);
  await shot(A, 'nach-scan-oda-wieder');
  await A.evaluate(() => { Hud.oda.cur = null; Hud.oda.queue = []; });

  // (5) Captain bei gestörtem Scan (q < 1) mit Ergebnissen: die Störrelais-Zeile steht im Block
  const q = await C.evaluate(() => (__game.state.away || {}).scanQuality);
  ok(q != null && q < 1, 'Scan gestört (scanQuality ' + q + ') – Kesh hat die Störrelais an');
  await shot(C, 'captain-j-gestoert-ergebnis');
  await C.evaluate(() => { const r = Consoles.maps.away; return !!r; });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await startServer({ port: PORT, debug: true, roomCode: 'off', quiet: true });
  const game = srv.game;
  const b = await chromium.launch();
  const err = [];
  try {
    const neueSeite = async (render) => {
      const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
      await page.route('**/content/scanner/datenblaetter.json', (route) => (contentDatei ? route.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(contentDatei, 'utf8') }) : route.continue()));
      page.on('pageerror', (e) => err.push('pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error') err.push('console: ' + m.text().slice(0, 200)); });
      await page.goto(`http://127.0.0.1:${PORT}/?render=${render}&debug=1`);
      await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000, polling: 20 });
      await page.waitForTimeout(1200);
      return page;
    };
    const A = await neueSeite(RENDER);   // Boden (zuerst: Spieler 0)
    const C = await neueSeite('2d');     // Captain
    for (const pg of [A, C]) { await pg.evaluate(() => __game.send({ t: 'lobbyOpt', skipDrill: true })); await pg.evaluate(() => __game.send({ t: 'ready', ready: true })); }
    await A.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await sleep(2500);
    const dbg = (pg, cmd, extra) => pg.evaluate(([c, x]) => __game.send(Object.assign({ t: 'debug', cmd: c }, x || {})), [cmd, extra]);
    await dbg(C, 'sitz', { console: 'captain' });
    await sleep(700);
    await dbg(A, 'kesh');
    await A.waitForFunction(() => { const st = __game.state, me = st && st.players.find((q) => q.id === __game.pid); return !!(me && me.zone === 'away' && st.away && st.away.map === 'kesh'); }, null, { timeout: 60000, polling: 40 });
    if (RENDER === 'voxel') {
      await A.waitForFunction(() => { const s = window.VoxelKit && VoxelKit.stats(); return !!(s && s.id === __game.state.away.map); }, null, { timeout: 30000, polling: 40 })
        .catch(async () => console.log('Voxel-Kit meldet die Karte nicht als aufgebaut:', await A.evaluate(() => JSON.stringify(window.VoxelKit && VoxelKit.stats()))));   // Einzelbilder trotzdem
      console.log('Renderer:', await A.evaluate(() => (window.Render && Render.modus) || (window.VoxelRender ? 'voxel-geladen' : '?')));
    }
    await sleep(1500);
    await dbg(A, 'god', { args: 'on' });
    await C.keyboard.press('Digit4');
    await sleep(800);
    const shot = async (pg, name, clip) => { const f = path.join(OUT, RENDER + '-' + name + '.png'); await pg.screenshot(Object.assign({ path: f }, clip ? { clip } : {})); console.log(f); return f; };
    const scState = (pg) => pg.evaluate(() => JSON.stringify((__game.state.away || {}).sc || null));
    const roh = async () => (await scState(C)).replace(/"[^"]*"/g, '');

    // a) ohne Ergebnis
    ok((await scState(C)) === 'null', 'ohne Scan: kein away.sc im Snapshot');
    const fa = await shot(C, 'captain-a-ohne');
    if (VERGLEICH) {
      // Byte-Gleichheit gibt es nicht (FPS-/Ping-Zeile, Kartenrauschen bei gestörtem Scan, zufälliger Crew-Name); deshalb Pixelvergleich im Browser außerhalb dieser dynamischen Zonen:
      // FPS-Zeile (y < 24), Karte (x >= 620, y <= 420) und Namenszeile der Crew (x < 290, y 360..385). Der Rest muss gleich sein – insbesondere Legende, Befehlsleiste, Schilde, Frachtleiste.
      const basis = path.join(path.resolve(ROOT, VERGLEICH), RENDER + '-captain-a-ohne.png');
      const rd = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
      const r = fs.existsSync(basis) ? await C.evaluate(async ([a, c]) => {
        const ld = (u) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = u; });
        const [x, y] = await Promise.all([ld(a), ld(c)]);
        const g = (i) => { const k = document.createElement('canvas'); k.width = i.width; k.height = i.height; const t = k.getContext('2d'); t.drawImage(i, 0, 0); return t.getImageData(0, 0, i.width, i.height); };
        const A = g(x), B = g(y); let rest = 0, maske = 0;
        for (let j = 0; j < A.height; j++) for (let i = 0; i < A.width; i++) {
          const k = (j * A.width + i) * 4;
          if (A.data[k] === B.data[k] && A.data[k + 1] === B.data[k + 1] && A.data[k + 2] === B.data[k + 2]) continue;
          if (j < 24 || (i >= 620 && j <= 420) || (i < 290 && j >= 360 && j <= 385)) maske++; else rest++;
        }
        return { w: A.width, h: A.height, rest, maske, gleich: A.width === B.width && A.height === B.height };
      }, [rd(basis), rd(fa)]) : null;
      console.log('Vergleich mit Basisbild:', JSON.stringify(r));
      ok(!!r && r.gleich && r.rest === 0, 'Reiter ohne Ergebnis: außerhalb der dynamischen Zonen pixelgleich zum Basisbild (' + basis + ')');
    }
    // b) Stufe 1: drei Ziele, keine Position
    await dbg(A, 'scantest');
    await dbg(A, 'scanfertig', { stufe: 1 });
    await C.waitForFunction(() => !!((__game.state.away || {}).sc), null, { timeout: 5000, polling: 40 });
    await sleep(500);
    ok(JSON.parse(await scState(C)).length === 3 && !/\d{3,}/.test(await roh()), 'Stufe 1: drei Einträge ohne Koordinaten im Snapshot');
    await shot(C, 'captain-b-stufe1');
    await shot(A, 'boden-a-stufe1');
    // c) Stufe 3: Positionen
    await dbg(A, 'scanfertig', { stufe: 3 });
    await sleep(700);
    ok(/\d{3,}/.test(await roh()), 'Stufe 3: Positionen im Snapshot');
    await shot(C, 'captain-c-stufe3');
    await shot(A, 'boden-b-stufe3');
    // d) 5+ Einträge: eine zweite Art (mit unbekanntem Typ) in Reichweite (Server im Prozess), erst Stufe 2, dann 3
    const p = game.players[0];
    const weg = Scanbar.scanbarAnmelden('erz', { ziele: () => [{ id: 'e1', typ: 'erzader', x: p.x + 60, y: p.y + 40 }, { id: 'e2', typ: 'erzader', x: p.x - 70, y: p.y - 20 }, { id: 'e3', typ: 'unbekannt_xyz', x: p.x + 20, y: p.y + 90 }] });
    await dbg(A, 'scanfertig', { stufe: 2 });
    await sleep(700);
    ok(JSON.parse(await scState(C)).length === 6, 'sechs Einträge im Snapshot');
    await shot(C, 'captain-d-viele');
    await dbg(A, 'scanfertig', { stufe: 3 });
    await sleep(700);
    await shot(C, 'captain-e-viele-stufe3');
    await shot(A, 'boden-c-sechs');
    weg();
    await shot(A, 'boden-d-ausschnitt', { x: 340, y: 160, width: 600, height: 400 });
    if (NUR === 'basis') return;
    await nacharbeit({ A, C, game, shot, dbg, scState, sleep, p });
  } finally {
    await b.close();
    if (srv.close) await srv.close();
  }
  console.log('Browserfehler:', err.length ? [...new Set(err)].slice(0, 10).join(' | ') : 'keine');
  ok(err.length === 0, 'keine Browserfehler');
  console.log(fails ? fails + ' FEHLER' : 'alles ok');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
