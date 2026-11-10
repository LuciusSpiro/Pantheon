// Sichtprüfung LIV-02 P3: Frage „Limit erhöhen?“ (Kontingent-Popup) im ECHTEN Spiel, und die Nicht-Anzeige an allen anderen Stellen.
// Echter Server im selben Prozess (Freie Fahrt mit der Lobby-Option Live-Spielleiter, das Modell ist der Fake tools/fixtures/messe/fake-claude.js; Live-Schalter SPIELLEITER_LLM=live und LLM_LIVE=1, kleines Limit CLAUDE_TOKEN_BUDGET=60000, Schwelle 54 000), drei echte Browser-Clients (Playwright, Chromium):
// Spieler 1 (color 0, blaue Markierung) an der Captain-Konsole, Spieler 2 (color 1) am Helm, Spieler 3 (color 2) an der Waffen-Konsole. KEIN Aufruf an Claude: der Zähler wird im selben Prozess per
// LLM.addUsage auf 54 000 gesetzt; mit Zähler über der Schwelle fragt kein Spielleiter (kein CLI-Prozess), das Spiel läuft im Rückfall weiter.
// Zwei Läufe mit je eigenem Server (Port und Port+1): Lauf NEIN, Lauf JA. Prüfungen je Lauf (Exit 1 bei einer verfehlten):
//   a  Vor dem Erreichen, an allen drei Konsolen: nichts Kontingent-Bezogenes im DOM (kein #kontingentFrage, kein #kontingent, kein Streifen/Knopf, kein Wort Kontingent/Limit/Token im sichtbaren Text, keine Funkzeile)
//   a2 Nach dem Erreichen, Spieler ohne color 0 (Helm, Waffen): weiter nichts im DOM und im Bild; kein Funk „Kontingent“, kein world.kontingent im Snapshot
//   b  Spieler mit color 0: das Popup erscheint genau einmal (ein Ereignis kontingentFrage), ohne Zahl, Knöpfe Ja/Nein
//   c  Lauf NEIN: Klick auf Nein: Popup weg, erscheint nicht erneut (auch nach weiteren Ticks), Limit unverändert, Rückfall läuft weiter (Spielzeit läuft, keine Serverfehler)
//   d  Lauf JA: Klick auf Ja: Popup weg, Limit +500 000 (Server-Zustand), Spiel läuft weiter
//   e  Leiste offen: einzeilig, genau in der Lage Canvas x 356..630, y 343..359 mal Skala (Unterkante fest), schneidet kein sichtbares interaktives DOM-Element, im Canvas darunter steht an Captain/Helm/Waffen nichts (Pixelprüfung), Bilder für den Designer-Review
//   f  Lauf NEIN, Captain: Skala 1 (800x450) und Skala 3 (1920x1080): Lage/Größe stimmen, Schrift mindestens 13 px, Knopf mindestens 24 px; Fehlerzustand (Text ersetzt, eine Zeile); gleichzeitig Siegel „Weltstand gesichert“: es endet vor der Leiste (Pixelprüfung); zu Fuß (ohne Konsole): die Leiste liegt über dem Boden-Panel/ODA, nicht darauf
// Bilder (Standard-Ordner: Temp-Ordner „pantheon-kontingent-shots“, nie im Repo): nein-1-vorher-captain.png, nein-2-popup-captain.png, nein-3-popup-helm.png, nein-4-popup-waffen.png,
//   nein-5-ohne-farbe0-helm.png, nein-6-ohne-farbe0-waffen.png, nein-8-skala1-captain.png, nein-9-skala3-captain.png, nein-10-fehler-captain.png, nein-11-siegel-captain.png, nein-12-siegel-skala1-captain.png,
//   nein-13-zu-fuss.png, nein-7-nach-nein-captain.png, ja-1-popup-captain.png, ja-2-nach-ja-captain.png
// Aufruf: node tools/sicht-kontingent.js [--port 3400] [--shots <Ordner>]
// Exit 0 = alles stimmte, 1 = Prüfung verfehlt oder Seitenfehler, 2 = ohne Playwright.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3400');
const SHOTS = path.resolve(arg('shots', path.join(os.tmpdir(), 'pantheon-kontingent-shots')));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-kontingent-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
process.env.CLAUDE_TOKEN_BUDGET = '60000'; process.env.TELEMETRIE = 'aus';   // nichts nach data/ im Repo (Telemetrie aus, noStore beim Server)
process.env.SPIELLEITER_LLM = 'live'; process.env.LLM_LIVE = '1'; process.env.CLAUDE_CLI = path.join(__dirname, 'fixtures', 'messe', 'fake-claude.js'); process.env.FAKE_ZAEHLER_DIR = fs.mkdtempSync(path.join(TMP, 'zaehler-'));   // CLAUDE_CLI ist der Fake (kein echter Claude, kein Abo); die Freie Fahrt mit Live-Option ruft ihn evtl. vor der Schwelle   // Live-Schalter an (nur dann gibt es die Frage); das Modell wird nie gefragt: der Zähler steht vor jedem Spielleiter-Aufruf über der Schwelle
const { startServer } = require('../server/index.js');
const LLM = require('../server/mission/llm.js');
const Kontingent = require('../server/sim/kontingent.js');
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fehler = [];
const pruefe = (c, t) => { console.log((c ? '  ok   ' : '  FEHLER ') + t); if (!c) fehler.push(t); };

// Alles Kontingent-Bezogene im Client: Elemente, Text (auch unsichtbarer Text zählt nicht, aber sichtbarer), Store, Funkzeilen
const SPUR = () => {
  const ids = ['kontingentFrage', 'kontingent'].filter((i) => document.getElementById(i) && getComputedStyle(document.getElementById(i)).display !== 'none');
  const text = (document.body.innerText || '').replace(/\s+/g, ' ');
  const treffer = text.match(/kontingent|limit erhöhen|spielleiter-limit|erhöhen\?|token-?limit|tokens?\b/i);
  const kf = window.KontingentFrage ? window.KontingentFrage.store.offen : false;
  const knoepfe = [...document.querySelectorAll('button')].filter((b) => /freigeben|\bja\b|\bnein\b/i.test(b.textContent) && b.getBoundingClientRect().width > 0 && !b.closest('#kontingentFrage')).map((b) => b.textContent.trim());
  const snap = window.__game && window.__game.state && window.__game.state.world ? ('kontingent' in window.__game.state.world) : false;
  return { ids, treffer: treffer ? treffer[0] : null, storeOffen: kf, knoepfe, snapFeld: snap };
};

async function lauf(name, port, ja) {
  console.log(`\n=== Lauf ${name} (Port ${port}) ===`);
  LLM.resetBudget(); LLM.setBudgetLimit(60000);
  const srv = await startServer({ port, debug: true, roomCode: 'off', quiet: true, worlds: true, noStore: true, worldDir: path.join(TMP, 'worlds-' + name) });
  const g = srv.game;
  const b = await chromium.launch();
  const bild = async (p, n) => { const f = path.join(SHOTS, `${name}-${n}.png`); await p.screenshot({ path: f }); console.log('Bild ' + f); return f; };
  try {
    const neu = async (n) => {
      const page = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
      page.on('pageerror', (e) => fehler.push(name + ' ' + n + ' pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error') fehler.push(name + ' ' + n + ' console: ' + m.text().slice(0, 200)); });
      await page.goto(`http://127.0.0.1:${port}/?render=2d`);
      await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
      await page.evaluate(() => { window.__fragen = 0; window.__funk = []; Net.on((m) => { if (m.t === 'event' && m.kind === 'kontingentFrage') window.__fragen++; if (m.t === 'event' && m.kind === 'radio') window.__funk.push(m.text); }); });
      return page;
    };
    const eins = await neu('spieler1');   // zuerst: bekommt color 0
    await eins.evaluate(() => { __game.send({ t: 'lobbyOpt', startMission: 'freie_fahrt' }); });
    await sleep(300);
    await eins.evaluate(() => { __game.send({ t: 'lobbyOpt', liveSpielleiter: true }); });
    const zwei = await neu('spieler2'), drei = await neu('spieler3');
    await sleep(400);
    for (const p of [eins, zwei, drei]) await p.evaluate(() => { __game.send({ t: 'ready', ready: true }); });
    for (const p of [eins, zwei, drei]) await p.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await sleep(500);
    const farben = g.players.map((p) => p.color);
    pruefe(farben[0] === 0 && farben[1] === 1 && farben[2] === 2, 'Farben der drei Spieler 0, 1, 2 (' + farben.join(',') + '): Spieler 1 trägt die blaue Markierung');
    const sitz = (p, c) => p.evaluate((cc) => __game.send({ t: 'debug', cmd: 'sitz', console: cc }), c);
    await sitz(eins, 'captain'); await sitz(zwei, 'helm'); await sitz(drei, 'weapons');
    await sleep(900);
    const alle = [['Captain', eins], ['Helm', zwei], ['Waffen', drei]];
    const frage = (p) => p.evaluate(() => { const e = document.getElementById('kontingentFrage'); if (!e || getComputedStyle(e).display === 'none') return null; const r = e.getBoundingClientRect(); return { text: e.innerText.replace(/\s+/g, ' '), x: r.x, y: r.y, w: r.width, h: r.height, knoepfe: [...e.querySelectorAll('button')].map((k) => k.textContent) }; });
    const weg = (p) => p.waitForFunction(() => { const e = document.getElementById('kontingentFrage'); return !e || getComputedStyle(e).display === 'none'; }, null, { timeout: 8000 }).then(() => true, () => false);
    const da = (p) => p.waitForFunction(() => { const e = document.getElementById('kontingentFrage'); return e && getComputedStyle(e).display !== 'none'; }, null, { timeout: 8000 }).then(() => true, () => false);

    // a: vor dem Erreichen
    pruefe(LLM.budget().used < 54000, 'Zähler ' + LLM.budget().used + ' von 60 000, unter der Schwelle 54 000; Live-Spielleiter an: ' + (g.env && g.env.SPIELLEITER_LLM));
    await sleep(1200);
    for (const [n, p] of alle) { const s = await p.evaluate(SPUR); pruefe(!s.ids.length && !s.treffer && !s.storeOffen && !s.knoepfe.length && !s.snapFeld, `a ${n}: vor dem Erreichen nichts Kontingent-Bezogenes im DOM (${JSON.stringify(s)})`); }
    await bild(eins, '1-vorher-captain');

    // Erreichen der Schwelle
    LLM.addUsage(54000);
    const t0 = g.time; pruefe(Kontingent.live(g), 'Live-Modus des Spiels (Voraussetzung der Frage)');
    pruefe(await da(eins), 'b Spieler 1 (color 0): das Popup erscheint bei 54 000 von 60 000');
    await sleep(1500);
    const f = await frage(eins);
    pruefe(!!f && /Limit/.test(f.text) && /erhöhen\?/.test(f.text) && f.knoepfe.join() === 'Ja,Nein', 'b Leiste mit „… Limit … erhöhen?“ und den Knöpfen Ja / Nein (' + (f && f.text) + ')');
    pruefe(!!f && !/\d/.test(f.text.replace(/(Ja|Nein)/g, '')), 'b Leiste nennt keine Zahl');
    pruefe((await eins.evaluate(() => window.__fragen)) === 1, 'b Frage genau einmal zugestellt (Ereignis kontingentFrage)');
    pruefe(g.kontingent && g.kontingent.frage && g.kontingent.frage.offen === true, 'Server: Frage offen');
    // a2: die anderen sehen nichts
    for (const [n, p] of alle.slice(1)) { const s = await p.evaluate(SPUR); const fz = await p.evaluate(() => ({ fragen: window.__fragen, funk: window.__funk })); pruefe(!s.ids.length && !s.treffer && !s.storeOffen && !s.knoepfe.length && !s.snapFeld && fz.fragen === 0 && !fz.funk.some((x) => /kontingent/i.test(x)), `a2 ${n} (ohne color 0): nach dem Erreichen nichts im DOM, kein Ereignis, kein Funk (${JSON.stringify(s)})`); }
    if (name === 'nein') { await bild(zwei, '5-ohne-farbe0-helm'); await bild(drei, '6-ohne-farbe0-waffen'); }
    const fkap = await eins.evaluate(() => { const fz = window.__funk || []; return fz.some((x) => /kontingent/i.test(x)); });
    pruefe(!fkap, 'b kein Funk „Kontingent“ auch beim Spieler mit color 0');

    // e: Popup offen an Captain, Helm, Waffen: Überdeckung, Bilder (der Spieler mit color 0 setzt sich nacheinander an die drei Konsolen)
    const verdeckt = (p) => p.evaluate(() => {
      const e = document.getElementById('kontingentFrage'); const r = e.getBoundingClientRect(); const out = [];
      for (const el of document.querySelectorAll('button,a,input,select,textarea,[role=button],[onclick],[tabindex]')) {
        if (e.contains(el) || el.tagName === 'CANVAS') continue;   // das Spielfeld-Canvas liegt immer darunter (Bedienflächen im Canvas prüft das Auge am Bild)
        const q = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        if (q.width < 2 || q.height < 2 || cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none' || +cs.opacity === 0) continue;
        if (q.right > r.left && q.left < r.right && q.bottom > r.top && q.top < r.bottom) out.push((el.id || el.className || el.tagName) + '');
      }
      return { out, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
    });
    // e2: Lage und Größe der Leiste (Canvas-Einheiten x 356..630, y 343..359 mal Skala, Unterkante fest), eine Zeile, Schrift/Knopf nicht zu klein, darunter im Canvas nichts Helles
    const lage = (p, hoch) => p.evaluate((hochY) => {
      const e = document.getElementById('kontingentFrage'), cv = document.getElementById('game');
      const r = e.getBoundingClientRect(), c = cv.getBoundingClientRect(), sc = c.width / 640, cs = getComputedStyle(e);
      const text = e.querySelector('.kf-text'), knoepfe = [...e.querySelectorAll('button')];
      const L = hochY || { x: 356, y: 343, w: 274, h: 16 };
      const soll = { hoch: Math.max(Math.round(L.h * sc), Math.max(24, Math.round(14 * sc)) + 2) };
      // helle Pixel im Canvas unter der Leiste; ganze waagerechte Linien (Zeilen zu mehr als 90 % hell: Rahmenlinie der Konsole) zählen als Linie, nicht als Inhalt
      let belegt = 0, linien = 0;
      try {
        const d = cv.getContext('2d').getImageData(L.x, L.y, L.w, L.h).data;
        for (let y = 0; y < L.h; y++) { let n = 0; for (let x = 0; x < L.w; x++) { const i = (y * L.w + x) * 4; if (Math.max(d[i], d[i + 1], d[i + 2]) > 150) n++; } if (n > 0.9 * L.w) linien++; else belegt += n; }
      } catch (er) { belegt = -1; }
      return {
        sc, rect: { l: Math.round(r.left - c.left), t: Math.round(r.top - c.top), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right - c.left), b: Math.round(r.bottom - c.top) },
        erwartet: { r: Math.round((L.x + L.w) * sc), b: Math.round((L.y + L.h) * sc), w: Math.round(L.w * sc), h: soll.hoch },
        schrift: parseFloat(cs.fontSize), knopfH: knoepfe.map((b) => Math.round(b.getBoundingClientRect().height)),
        eineZeile: (() => { const rg = document.createRange(); rg.selectNodeContents(text); return rg.getClientRects().length === 1; })() && r.height <= soll.hoch + 1, text: text.textContent, kurz: text.textContent === 'Limit erhöhen?' || text.textContent === 'Noch einmal?',
        rand: cs.borderTopColor, grund: cs.backgroundColor, schatten: cs.boxShadow, belegt, linien, canvasPx: { w: cv.width, h: cv.height },
        links: knoepfe.map((b) => Math.round(b.getBoundingClientRect().left - c.left)),
      };
    }, hoch);
    const lagePruefen = (l, tag) => {
      const ex = l.erwartet;
      pruefe(Math.abs(l.rect.r - ex.r) <= 1 && Math.abs(l.rect.b - ex.b) <= 1 && Math.abs(l.rect.w - ex.w) <= 1 && Math.abs(l.rect.h - ex.h) <= 1, `${tag}: Lage/Größe ${JSON.stringify(l.rect)} entspricht Canvas 356..630 / 343..359 mal Skala ${l.sc} (rechts ${ex.r}, unten ${ex.b}, Breite ${ex.w}, Höhe ${ex.h})`);
      pruefe(l.schrift >= 13 && Math.abs(l.schrift - Math.max(13, Math.round(8 * l.sc))) <= 1, `${tag}: Schrift ${l.schrift} px (8 x Skala, mindestens 13)`);
      pruefe(l.knopfH.every((h) => h >= 24 && h >= Math.round(14 * l.sc) - 1), `${tag}: Knopfhöhe ${l.knopfH.join('/')} px (mindestens max(24, 14 x Skala))`);
      pruefe(l.eineZeile, `${tag}: genau eine Zeile (Höhe ${l.rect.h} px), Text „${l.text}“${l.kurz ? ' (Kurzform)' : ''}`);
      pruefe(/^rgba\(11, 14, 26, 0\.85\)$/.test(l.grund) && l.schatten === 'none', `${tag}: flacher Grund ${l.grund}, kein Schatten (${l.schatten})`);
    };
    // f: Skalen, Fehlerzustand, Siegel, zu Fuß (nur Lauf NEIN, Spieler 1 sitzt am Captain)
    const extras = async () => {
      const Lpx = { x: 356, y: 343, w: 274, h: 16 };
      for (const [vw, vh, bn] of [[800, 450, '8-skala1-captain'], [1920, 1080, '9-skala3-captain']]) {
        await eins.setViewportSize({ width: vw, height: vh }); await sleep(900);
        const l = await lage(eins); lagePruefen(l, `f Fenster ${vw}x${vh}`);
        pruefe(l.sc === (vw === 800 ? 1 : 3), `f Fenster ${vw}x${vh}: Client.scale ${l.sc} (erwartet ${vw === 800 ? 1 : 3})`);
        pruefe(!(await verdeckt(eins)).out.length, `f Fenster ${vw}x${vh}: verdeckt kein interaktives DOM-Element`);
        await bild(eins, bn);
      }
      await eins.setViewportSize({ width: 1280, height: 720 }); await sleep(700);
      // Canvas darunter (Captain): nichts Helles in der Fläche der Leiste
      const l2 = await lage(eins);
      pruefe(l2.belegt === 0, `e2 Captain: im Canvas unter der Leiste (Canvas 356..630 x 343..359) stehen ${l2.belegt} helle Pixel (erwartet 0)`);
      // Fehlerzustand: der Server meldet code fehler; der Fragetext wird ersetzt, die Leiste bleibt eine Zeile
      await eins.evaluate(() => { KontingentFrage.lesen({ t: 'event', kind: 'kontingentAntwort', pid: KontingentFrage.store.pid, op: 'freigeben', ok: false, code: 'fehler' }); KontingentFrageUi.zeichnen(); });
      await sleep(300);
      const lf = await lage(eins); lagePruefen(lf, 'f Fehlerzustand');
      pruefe(/nicht geklappt/.test(lf.text) && /noch einmal/.test(lf.text) && lf.rand === 'rgb(242, 201, 76)', `f Fehlerzustand: Text „${lf.text}“ ersetzt den Fragetext, Rand ${lf.rand} (#F2C94C)`);
      await bild(eins, '10-fehler-captain');
      await eins.evaluate(() => { KontingentFrage.store.fehler = false; KontingentFrageUi.zeichnen(); });
      // Siegel „Weltstand gesichert“ gleichzeitig: es endet vor der Leiste (Pixelprüfung im Canvas), Fenster 1280x720 und 800x450
      const siegel = () => eins.evaluate((L) => {
        const cv = document.getElementById('game'), d = cv.getContext('2d').getImageData(0, 340, 640, 20).data;
        const mint = (i) => Math.abs(d[i] - 127) < 45 && Math.abs(d[i + 1] - 224) < 35 && Math.abs(d[i + 2] - 194) < 45;
        let min = 999, max = -1;
        for (let y = 0; y < 20; y++) for (let x = 200; x < L.x; x++) { if (mint((y * 640 + x) * 4)) { if (x < min) min = x; if (x > max) max = x; } }
        const e = document.getElementById('kontingentFrage').getBoundingClientRect(), c = cv.getBoundingClientRect();
        return { min, max, barLinks: (e.left - c.left) / (c.width / 640) };
      }, Lpx);
      for (const [vw, vh, bn] of [[1280, 720, '11-siegel-captain'], [800, 450, '12-siegel-skala1-captain']]) {
        await eins.setViewportSize({ width: vw, height: vh }); await sleep(700);
        await eins.evaluate(() => Hud.showSaveSeal(true, 'Weltstand gesichert · Hafen Sund')); await sleep(400);
        const sg = await siegel();
        pruefe(sg.max >= 270 && sg.min >= 270 && sg.max <= 352 && sg.max + 4 <= sg.barLinks + 1, `f Siegel + Leiste (${vw}x${vh}): Siegel in Canvas-x ${sg.min}..${sg.max}, Leiste beginnt bei ${Math.round(sg.barLinks)}: überlappen nicht`);
        await bild(eins, bn);
        await eins.evaluate(() => { Hud.saveSeal = null; });
      }
      await eins.setViewportSize({ width: 1280, height: 720 }); await sleep(600);
      // zu Fuß (ohne Konsole)
      await eins.evaluate(() => __game.send({ t: 'leave' })); await sleep(900);
      const fuss = await eins.evaluate(() => { const m = __game.state.players.find((p) => p.id === Client.pid); return { konsole: m && m.console, leiste: Client.kontingentLeiste, oda: !!(Hud.oda && Hud.oda.cur), funk: !!(window.Funkwahl && Funkwahl.offen()) }; });
      const lfuss = await lage(eins, fuss.leiste);
      pruefe(!fuss.konsole && !!fuss.leiste && lfuss.rect.b === Math.round((fuss.leiste.y + fuss.leiste.h) * lfuss.sc), `f zu Fuß: ohne Konsole, die Leiste folgt der HUD-Lage ${JSON.stringify(fuss.leiste)} (ODA ${fuss.oda}, Funkwahl ${fuss.funk})`);
      console.log(`  info f zu Fuß: unter der Leiste liegt die Spielwelt (${lfuss.belegt} helle Pixel); sie steht über ODA/Funkwahl/Boden-Panel, nicht darauf (ODA ${fuss.oda})`);
      await bild(eins, '13-zu-fuss');
      await sitz(eins, 'captain'); await sleep(700);
    };
    if (name === 'nein') {
      for (const [konsole, bn] of [['captain', '2-popup-captain'], ['helm', '3-popup-helm'], ['weapons', '4-popup-waffen']]) {
        await sitz(eins, konsole); await sleep(900);
        pruefe(await da(eins), `e Popup bleibt offen an der Konsole ${konsole}`);
        const v = await verdeckt(eins);
        pruefe(v.out.length === 0, `e Konsole ${konsole}: das Popup (${JSON.stringify(v.rect)}) verdeckt kein interaktives DOM-Element (${v.out.join(', ') || 'keins'})`);
        const lg = await lage(eins); lagePruefen(lg, 'e2 Konsole ' + konsole);
        pruefe(lg.belegt === 0, 'e2 Konsole ' + konsole + ': im Canvas unter der Leiste stehen ' + lg.belegt + ' helle Pixel Inhalt (erwartet 0), dazu ' + lg.linien + ' Rahmenlinie(n) der Konsole (die Leiste deckt sie in x 356..630 ab, Linienzüge sind Zierrat)');
        await bild(eins, bn);
      }
      await sitz(eins, 'captain'); await sleep(600);
      await extras();
    } else await bild(eins, '1-popup-captain');

    if (!ja) {
      // c: Nein
      const limitVor = LLM.budget().limit;
      await eins.locator('#kontingentFrage .kf-nein').click();
      pruefe(await weg(eins), 'c Nein: Popup verschwindet');
      await sleep(3500);
      pruefe(await weg(eins) && (await eins.evaluate(() => window.__fragen)) === 1, 'c Nein: das Popup erscheint nicht erneut (3,5 s später, weiter ein Ereignis)');
      pruefe(LLM.budget().limit === limitVor && g.kontingent.frage.abgelehnt === true && g.kontingent.frage.offen === false, 'c Nein: Limit unverändert (' + LLM.budget().limit + '), Server: abgelehnt, nicht offen');
      pruefe(g.time > t0 + 2 && !g.errors && g.phase !== 'lobby', 'c Rückfall: Spiel läuft weiter (Spielzeit ' + Math.round(t0) + ' -> ' + Math.round(g.time) + ', Serverfehler ' + g.errors + ')');   // g.errors ist eine Zahl (countError zählt hoch)
      const s = await eins.evaluate(SPUR);
      pruefe(!s.ids.length && !s.treffer && !s.storeOffen, 'c Nein: nichts Kontingent-Bezogenes mehr im DOM');
      await eins.keyboard.press('Digit2'); await sleep(300);
      await bild(eins, '7-nach-nein-captain');
    } else {
      // d: Ja
      const limitVor = LLM.budget().limit;
      await eins.locator('#kontingentFrage .kf-ja').click();
      pruefe(await weg(eins), 'd Ja: Popup verschwindet');
      await sleep(800);
      pruefe(LLM.budget().limit === limitVor + 500000 && LLM.budget().limit === 560000, 'd Ja: Limit +500 000 laut Server (' + limitVor + ' -> ' + LLM.budget().limit + ')');
      pruefe(!(g.kontingent.frage && g.kontingent.frage.offen), 'd Ja: Server: Frage geschlossen');
      await sleep(2500);
      pruefe(await weg(eins) && (await eins.evaluate(() => window.__fragen)) === 1, 'd Ja: kein zweites Popup');
      pruefe(g.time > t0 + 2 && !g.errors, 'd Spiel läuft weiter, Serverfehler ' + g.errors);
      await bild(eins, '2-nach-ja-captain');
    }
  } finally {
    await b.close();
    try { await srv.close(); } catch (er) { /* egal */ }
    LLM.resetBudget();
  }
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  await lauf('nein', PORT, false);
  await lauf('ja', PORT + 1, true);
  console.log(fehler.length ? '\nFEHLER (' + fehler.length + '):\n  ' + fehler.join('\n  ') : '\nalles ok, Bilder in ' + SHOTS);
  process.exit(fehler.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
