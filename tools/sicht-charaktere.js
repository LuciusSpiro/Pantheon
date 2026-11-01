'use strict';
// CHA-01 C: Sichtbeleg der Charakterliste und Charaktererstellung (echter Server im selben Prozess, echte Browser-Clients, Playwright/Chromium, Debug-Server).
// Ablauf: (1) Altstand – nur sternenschicht.name gesetzt → direkt in der Lobby mit diesem Namen, ohne Pflichtschritt (Abnahme 9);
//         (2) Erststart – leerer Browser → Standard-Charakter, Lobby ohne Namensfeld; (3) vier Charaktere mit verschiedenem Aussehen anlegen, fünften versuchen,
//         Neuladen → alle vier da (Abnahme 1); Erstellung zeigt genau die sechs Felder (Abnahme 2); Umbenennen; Löschen mit Rückfrage;
//         (4) gewählter Charakter im Spiel, Standard-Outfit, Name aus dem Snapshot (Doppelname bekommt eine Ziffer), Crew-Übersicht (Abnahme 5); (5) ?render=2d: Ersatzbilder ohne Absturz.
// Hinweis: ohne ?debug=1 (das Debug-Feld verdeckt sonst die Crew-Liste der Lobby); der Server läuft als Debug-Server.
// Aufruf: node tools/sicht-charaktere.js [--port 3541] [--shots shots/charaktere] [--w 1280 --h 720]   (Bilder nicht im Repo, shots/ ist ignoriert)   Exit 1 bei Fehlern, 2 ohne Playwright.
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3541');
const SHOTS = path.resolve(arg('shots', path.join('shots', 'charaktere')));
const W = +arg('w', '1280'), H = +arg('h', '720');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-charaktere-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
const Ch = require('../shared/charakter.js');
const KAT = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'katalog', 'charakter.json'), 'utf8'));
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE setzen)'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fehler = [];
const log = (...a) => console.log(a.join(' '));
const ok = (b, t) => { log((b ? '  ok   ' : '  FEHLER ') + t); if (!b) fehler.push(t); };

async function neuerKontext(browser, url, vorher) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  if (vorher) await ctx.addInitScript(vorher);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) fehler.push('console: ' + m.text().slice(0, 200)); });
  await page.goto(url);
  await page.waitForFunction(() => window.__game && __game.state && __game.pid && window.Charaktere && Charaktere.lies().bereit, null, { timeout: 60000 });
  return { ctx, page };
}
async function bild(page, name) {
  await page.waitForTimeout(500);
  const f = path.join(SHOTS, name + '.png');
  await page.screenshot({ path: f });
  log('Bild ' + path.relative(ROOT, f).replace(/\\/g, '/'));
}
const taste = async (page, k, n) => { for (let i = 0; i < (n || 1); i++) { await page.keyboard.press(k); await page.waitForTimeout(40); } };
const store = (page) => page.evaluate(() => { const s = Charaktere.lies(); return { n: s.liste.length, gewaehlt: s.gewaehlt, namen: s.liste.map((c) => c.karte.name), seite: s.sitzung.seite, cursor: s.sitzung.cursor, karten: s.liste.map((c) => c.karte) }; });
const serverName = (page) => page.evaluate(() => { const p = (__game.state.players || []).find((q) => q.id === __game.pid); return p && p.name; });
// Charakter über die Tasten anlegen: N, Name tippen, Enter (Name fertig), Plätze mit ← →, Enter (speichern)
async function erstelle(page, name, plaetze) {
  await taste(page, 'n');
  await page.keyboard.type(name, { delay: 15 });
  await taste(page, 'Enter');
  for (const [ziffer, schritte] of plaetze) { await taste(page, ziffer); await taste(page, 'ArrowRight', schritte); }
  await taste(page, 'Enter');
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await startServer({ port: PORT, debug: true, ruestphase: false, roomCode: 'off', quiet: true, worlds: false, noStore: true });
  const g = srv.game;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const URL = `http://127.0.0.1:${PORT}/?render=voxel`;
  try {
    // ---------------------------------------------------------------- 1 Altstand (Abnahme 9)
    log('\n== 1 Altstand: nur sternenschicht.name ==');
    {
      const c = await neuerKontext(browser, URL, () => { if (!localStorage.getItem('pantheon.charaktere') && !sessionStorage.getItem('x')) { localStorage.setItem('sternenschicht.name', 'Ragnar'); sessionStorage.setItem('x', '1'); } });
      await c.page.waitForFunction(() => Charaktere.lies().liste.length === 1, null, { timeout: 15000 });
      await c.page.waitForFunction(() => (__game.state.players || []).some((p) => p.id === __game.pid && p.name === 'Ragnar'), null, { timeout: 15000 });
      const s = await store(c.page);
      ok(s.n === 1 && s.namen[0] === 'Ragnar' && s.gewaehlt, 'Charakter „Ragnar“ entstand ohne Pflichtschritt und ist gewählt');
      ok(await serverName(c.page) === 'Ragnar', 'Spielername am Server: Ragnar');
      ok(await c.page.evaluate(() => document.getElementById('lobbyName') === null && localStorage.getItem('sternenschicht.name') === 'Ragnar'), 'kein Namensfeld im DOM, alter Schlüssel bleibt erhalten');
      ok(await c.page.evaluate(() => __game.state.phase === 'lobby'), 'Spieler steht direkt in der Lobby');
      const k = s.karten[0];
      ok(JSON.stringify(k) === JSON.stringify(Ch.standardKarte('Ragnar', KAT)), 'Standardaussehen und Standard-Outfit');
      await bild(c.page, '01-altstand-lobby');
      await c.ctx.close();
    }

    // ---------------------------------------------------------------- 2 Erststart, Liste, Erstellung (Abnahme 1, 2)
    log('\n== 2 Erststart, vier Charaktere, fünfter, Neuladen ==');
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) fehler.push('console: ' + m.text().slice(0, 200)); });
    const lade = async (u) => { await page.goto(u || URL); await page.waitForFunction(() => window.__game && __game.state && __game.pid && window.Charaktere && Charaktere.lies().bereit, null, { timeout: 60000 }); await page.focus('#game'); await page.waitForTimeout(300); };
    await lade();
    let s = await store(page);
    ok(s.n === 1 && /^Crew-\d{3}$/.test(s.namen[0]), 'Erststart ohne alles: Standard-Charakter mit Zufallsnamen (' + s.namen[0] + ')');
    await page.waitForFunction(() => (__game.state.players || []).some((p) => p.id === __game.pid && p.name === Charaktere.aktiverName()), null, { timeout: 10000 });
    await bild(page, '02-erststart-lobby');
    await taste(page, 'c');
    ok((await store(page)).seite === 'liste', 'Taste C öffnet die Charakterliste');
    await bild(page, '03-liste-ein-charakter');
    // den automatischen Charakter löschen (zweimal Entf = Rückfrage, dann weg): es gilt wieder der Erststart, ein neuer Standard-Charakter mit Zufallsnamen ist gewählt und gesendet
    const alt = await store(page);
    await taste(page, 'Delete'); await bild(page, '04-liste-loeschfrage'); await taste(page, 'Delete');
    s = await store(page);
    ok(s.n === 1 && s.gewaehlt && s.gewaehlt !== alt.gewaehlt && /^Crew-\d{3}$/.test(s.namen[0]), 'letzten Charakter löschen (Rückfrage, dann weg): neuer Standard-Charakter mit Zufallsnamen (' + s.namen[0] + ') ist gewählt');
    ok(JSON.stringify(s.karten[0]) === JSON.stringify(Ch.standardKarte(s.namen[0], KAT)), 'Ersatz-Charakter: Standardaussehen und Standard-Outfit');
    ok(await page.evaluate(() => __game.client.karte && __game.client.karte.name === Charaktere.aktiverName()), 'Client.karte trägt den Ersatz-Charakter (nicht null)');
    await page.waitForFunction(() => (__game.state.players || []).some((p) => p.id === __game.pid && p.name === Charaktere.aktiverName()), null, { timeout: 10000 });
    await page.waitForFunction(() => { const k = __game.client.karten[__game.pid]; return k && k.name === Charaktere.aktiverName(); }, null, { timeout: 10000 });
    ok(g.players.length === 1 && g.players[0].name === s.namen[0] && g.players[0].karte && g.players[0].karte.name === s.namen[0], 'Server hat den Ersatz-Charakter (Spielername und Karte), nicht mehr den gelöschten (' + alt.namen[0] + ')');
    await bild(page, '05-liste-ersatz');
    // Erstellung: erst nur ansehen
    await taste(page, 'n');
    await page.keyboard.type('Aurelia', { delay: 15 });
    await bild(page, '06-erstellung-name');
    const felder = await page.evaluate(() => ({ plaetze: Charaktere.PLAETZE.slice(), block: PultKammer.ziffernblock('erstellung').filter((z) => !z.leer).map((z) => z.platz), entwurf: Object.keys(Charaktere.lies().sitzung.entwurf.karte) }));
    ok(felder.plaetze.join() === 'frisur,gesicht,bart,haar,haut' && felder.block.slice().sort().join() === 'bart,frisur,gesicht,haar,haut', 'Erstellung: genau Frisur, Gesicht, Bart, Haarfarbe, Hautton (+ Name), kein Outfit-Platz und kein Körperschalter');
    await taste(page, 'Enter'); await taste(page, '8'); await taste(page, 'ArrowRight');
    await bild(page, '07-erstellung-frisur');
    await taste(page, '9'); await taste(page, 'ArrowRight');
    await bild(page, '08-erstellung-haarfarbe');
    await taste(page, '6'); await taste(page, 'ArrowRight', 2);
    await taste(page, 'q', 2);
    await bild(page, '09-erstellung-gedreht');
    await taste(page, 'r');   // zurücksetzen
    s = await page.evaluate(() => { const e = Charaktere.lies().sitzung.entwurf; return { name: e.name, frisur: e.karte.frisur, haut: e.karte.haut, edit: e.nameEdit }; });
    ok(s.name === '' && s.frisur === 'dutt' && s.haut === 0 && s.edit, 'R setzt die Erstellung zurück');
    // Name ungültig: Enter ohne Namen
    await taste(page, 'Enter');   // Namensfeld ist wieder offen, leer: Enter beendet nicht, Hinweis
    await bild(page, '10-erstellung-name-ungueltig');
    ok(await page.evaluate(() => Charaktere.lies().sitzung.entwurf.hinweis === 'name'), 'ungültiger (leerer) Name: Hinweis');
    await taste(page, 'Escape');   // Schreibmodus ist an: Esc verwirft bei leerem Namen
    ok((await store(page)).seite === 'liste' && (await store(page)).n === 1, 'Esc verwirft die Erstellung');

    // vier Charaktere mit verschiedenem Aussehen
    await erstelle(page, 'Aurelia', [['9', 1], ['6', 1]]);
    await erstelle(page, 'Brennus', [['8', 1], ['2', 1], ['9', 2], ['6', 3]]);
    await erstelle(page, 'Kaeso', [['5', 1], ['8', 2], ['9', 3], ['6', 2]]);
    // vier Plätze belegt (Zufalls-Charakter + drei): den Zufalls-Charakter auf Platz 1 löschen, dann Livia anlegen
    ok((await store(page)).n === 4, 'Zufalls-Charakter und drei neue: vier');
    await taste(page, '1'); await taste(page, 'Delete'); await taste(page, 'Delete');
    ok((await store(page)).namen.join() === 'Aurelia,Brennus,Kaeso', 'Zufalls-Charakter gelöscht (Auswahl bleibt bei Kaeso)');
    await erstelle(page, 'Livia', [['5', 1], ['9', 1]]);
    s = await store(page);
    ok(s.n === 4 && s.namen.join() === 'Aurelia,Brennus,Kaeso,Livia' && s.gewaehlt === (await page.evaluate(() => Charaktere.lies().liste[3].id)), 'vier Charaktere angelegt, der letzte ist gewählt');
    ok(new Set(s.karten.map((k) => [k.gesicht, k.frisur, k.bart, k.haut, k.haar].join())).size === 4, 'alle vier sehen verschieden aus');
    ok(s.karten.every((k) => JSON.stringify(k.outfit) === JSON.stringify(Ch.standardKarte('x', KAT).outfit)), 'jeder neue Charakter trägt das Standard-Outfit');
    await page.waitForTimeout(1500);
    await bild(page, '11-liste-vier');
    await taste(page, 'n');
    s = await store(page);
    ok(s.n === 4 && s.seite === 'liste', 'fünfter Charakter: Erstellung öffnet nicht');
    ok(await page.evaluate(() => { const m = Charaktere.lies().sitzung.meldung; return !!m && m.grund === 'voll'; }), 'Meldung „voll“ steht im Store (die Oberfläche zeigt den Text)');
    await bild(page, '12-fuenfter-abgelehnt');
    // Neuladen
    await lade();
    s = await store(page);
    ok(s.n === 4 && s.namen.join() === 'Aurelia,Brennus,Kaeso,Livia', 'Neuladen: alle vier unverändert da');
    await taste(page, 'c'); await page.waitForTimeout(1500);
    await bild(page, '13-liste-nach-neuladen');
    // Umbenennen (F2): Aussehen fest
    await taste(page, '2'); await taste(page, 'F2');
    await bild(page, '14-umbenennen');
    for (let i = 0; i < 7; i++) await taste(page, 'Backspace');
    await page.keyboard.type('Cato', { delay: 15 });
    await taste(page, 'Enter');
    s = await store(page);
    ok(s.namen[1] === 'Cato' && s.n === 4 && s.seite === 'liste', 'Umbenennen: Brennus heißt jetzt Cato, Enter speichert und geht zurück in die Liste');
    ok(await page.evaluate(() => { const k = Charaktere.lies().liste[1].karte; return k.frisur === 'zoepfe' && k.bart === 'vollbart' && k.haut === 3 && k.haar === 2; }), 'Aussehen bleibt beim Umbenennen');
    await taste(page, 'F2'); for (let i = 0; i < 4; i++) await taste(page, 'Backspace'); await page.keyboard.type('Brennus', { delay: 15 }); await taste(page, 'Enter');
    // Löschen des gewählten wählt einen anderen
    await taste(page, '4');
    const vor = await store(page);
    await taste(page, 'Delete'); await taste(page, 'Delete');
    s = await store(page);
    ok(s.n === 3 && s.gewaehlt && s.gewaehlt !== vor.gewaehlt, 'gewählten Charakter löschen: ein anderer wird gewählt');
    await bild(page, '15-liste-nach-loeschen');
    // Wählen und in die Lobby
    await taste(page, '2'); await taste(page, 'Enter');
    s = await store(page);
    ok(s.seite === null && s.namen[s.cursor] === 'Brennus', 'Enter übernimmt Brennus und schließt die Liste');
    await page.waitForFunction(() => (__game.state.players || []).some((p) => p.id === __game.pid && p.name === 'Brennus'), null, { timeout: 10000 });
    ok(await page.evaluate(() => __game.client.karte && __game.client.karte.name === 'Brennus'), 'Client.karte und hello tragen den gewählten Charakter');
    await bild(page, '16-lobby-gewaehlt');
    await taste(page, 'c'); await taste(page, 'Shift+Slash'); await bild(page, '17-liste-hilfe'); await taste(page, 'Shift+Slash'); await taste(page, 'Escape');
    ok((await store(page)).seite === null, 'Esc schließt die Liste');

    // ---------------------------------------------------------------- 3 im Spiel
    log('\n== 3 im Spiel: Standard-Outfit, Name aus dem Snapshot ==');
    // ein zweiter Spieler mit demselben Namen (Altstand): der Server hängt eine Ziffer an
    const zweiter = await neuerKontext(browser, URL, () => { if (!sessionStorage.getItem('x')) { localStorage.setItem('sternenschicht.name', 'Brennus'); sessionStorage.setItem('x', '1'); } });
    await page.waitForFunction(() => (__game.state.players || []).length === 2, null, { timeout: 15000 });
    await zweiter.page.waitForFunction(() => (__game.state.players || []).length === 2, null, { timeout: 15000 });
    // Wettlauf (CHA-01 F, Befund 8): der zweite Browser meldet sich zuerst ohne Karte (Charakterliste lädt noch), dann mit Karte; erst das zweite hello vergibt die Ziffer.
    // Also auf den Endzustand warten, nicht auf „zwei Spieler“.
    await page.waitForFunction(() => { const n = __game.state.players.map((p) => p.name); return n.includes('Brennus') && n.includes('Brennus 2'); }, null, { timeout: 15000 }).catch(() => null);
    const namen = await page.evaluate(() => __game.state.players.map((p) => p.name));
    ok(namen.includes('Brennus') && namen.includes('Brennus 2'), 'Doppelname: der Server hängt eine Ziffer an (' + namen.join(', ') + ')');
    await bild(page, '18-lobby-zwei-spieler');
    await page.evaluate(() => __game.send({ t: 'lobbyOpt', startMission: 'freie_fahrt' }));
    for (const p of [page, zweiter.page]) await p.evaluate(() => __game.send({ t: 'ready', ready: true }));
    await page.waitForFunction(() => __game.state.phase === 'play', null, { timeout: 30000 });
    await page.waitForTimeout(3000);
    await page.waitForFunction(() => { const l = VoxelRender.info().loader; return l && l.loading === 0; }, null, { timeout: 120000 });
    await page.evaluate(() => VoxelRender.zoom(-1)); await page.waitForTimeout(1500);
    await bild(page, '19-spiel-bord');
    const karten = await page.evaluate(() => __game.client.karten);
    const eigen = await page.evaluate(() => __game.pid);
    ok(JSON.stringify(karten[eigen].outfit) === JSON.stringify(Ch.standardKarte('x', KAT).outfit), 'im Spiel: eigener Charakter im Standard-Outfit');
    await page.keyboard.down('Tab'); await page.waitForTimeout(400); await bild(page, '20-spiel-crew-uebersicht'); await page.keyboard.up('Tab');
    ok((await page.evaluate(() => __game.state.players.map((p) => p.name))).includes('Brennus 2'), 'Name im Spiel kommt aus dem Snapshot (p.name)');
    await zweiter.ctx.close();
    await page.evaluate(() => __game.send({ t: 'menu', op: 'end' }));   // Partie beenden: zurück in die Lobby
    await page.waitForFunction(() => __game.state.phase === 'lobby', null, { timeout: 20000 });

    // ---------------------------------------------------------------- 4 ohne 3D
    log('\n== 4 ?render=2d: Ersatzbilder ==');
    await page.goto(`http://127.0.0.1:${PORT}/?render=2d`);
    await page.waitForFunction(() => window.__game && __game.state && __game.pid && Charaktere.lies().bereit, null, { timeout: 60000 });
    await page.focus('#game'); await page.waitForTimeout(500);
    await taste(page, 'c'); await page.waitForTimeout(1200);
    await bild(page, '21-liste-2d');
    await taste(page, 'n'); await page.keyboard.type('Zwei', { delay: 15 }); await taste(page, 'Enter'); await taste(page, '8'); await taste(page, 'ArrowRight');
    await bild(page, '22-erstellung-2d');
    ok(await page.evaluate(() => window.KammerBild.info().kontext === 0), '2D: kein zusätzlicher WebGL-Kontext');
    // Befund 2: der Ersatz zeigt die Wahl des aktuellen Platzes – das Figurfenster ändert sich beim Blättern (Frisur, Bart, Farben), der Hinweis sagt „Vorschau ohne 3D“
    const fenster = async () => { const f = await page.evaluate(() => { const r = PultKammer.figur(PultKammer.rahmen().anzeige); const cv = document.getElementById('game'); const k = cv.getBoundingClientRect().width / 640; return { x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k }; }); await page.waitForTimeout(250); return page.screenshot({ clip: { x: Math.round(f.x), y: Math.round(f.y), width: Math.round(f.w), height: Math.round(f.h) } }); };
    const gleichBild = (a, b) => Buffer.compare(a, b) === 0;
    for (const [ziffer, name] of [['8', 'Frisur'], ['2', 'Bart'], ['5', 'Gesicht'], ['9', 'Haarfarbe'], ['6', 'Hautton']]) {
      await taste(page, ziffer); await page.waitForTimeout(300);
      const a = await fenster(); await taste(page, 'ArrowRight'); const b = await fenster();
      ok(!gleichBild(a, b), '2D: Figurfenster ändert sich beim Blättern (' + name + ')');
      fs.writeFileSync(path.join(SHOTS, '22-2d-fenster-' + name.toLowerCase() + '.png'), b);
    }
    ok(await page.evaluate(() => KammerUi.TEXT.erstellung.hinweisOhne3d === '←→↑↓ wählen · Vorschau ohne 3D' && !KammerBild.moeglich()), '2D: Hinweis „Vorschau ohne 3D“ statt „die Figur zeigt es sofort“');
    await taste(page, 'Escape');   // Namensfeld ist aus: Esc verwirft
    ok((await store(page)).seite === 'liste', '2D: Esc zurück in die Liste');
    // Befund 6: Speicherfehler (privater Modus, Speicher voll) ist in der Liste sichtbar
    await page.evaluate(() => { Storage.prototype.setItem = function () { throw new Error('QuotaExceededError'); }; });
    await page.evaluate(() => Charaktere.waehle(Charaktere.lies().gewaehlt));
    ok(await page.evaluate(() => Charaktere.lies().speicherOk === false), 'Speicher scheitert: speicherOk false im Store');
    await bild(page, '23-liste-speicherfehler');
    await ctx.close();
    // ---------------------------------------------------------------- 5 Figurdatei fehlt (Befund 1)
    log('\n== 5 figures/cha/spieler.json fehlt (404): keine Fehlerflut ==');
    {
      const c2 = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      let angefragt = 0;
      await c2.route('**/figures/cha/spieler.json', (route) => { angefragt++; route.fulfill({ status: 404, body: 'nicht da' }); });
      const p2 = await c2.newPage();
      p2.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
      p2.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) fehler.push('console: ' + m.text().slice(0, 200)); });
      await p2.goto(URL);
      await p2.waitForFunction(() => window.__game && __game.state && __game.pid && window.Charaktere && Charaktere.lies().bereit, null, { timeout: 60000 });
      await p2.focus('#game'); await taste(p2, 'c');
      await p2.waitForTimeout(5000);
      const i1 = await p2.evaluate(() => Object.assign({ moeglich: KammerBild.moeglich(), fehlt: VoxelRender.loader.isMissing('cha/spieler', 'figures') }, KammerBild.info()));
      await p2.waitForTimeout(4000);
      const i2 = await p2.evaluate(() => KammerBild.info());
      log('  KammerBild nach 5 s: ' + JSON.stringify(i1) + ', nach 9 s: versuche ' + i2.versuche + ', Dateianfragen ' + angefragt);
      ok(i1.fehlt && i1.moeglich === false, 'Figur gilt als fehlend, KammerBild.moeglich() ist false (Ersatz greift)');
      ok(i1.versuche <= 4 && i2.versuche === i1.versuche && i2.fehler === i1.fehler, 'Zahl der Versuche bleibt begrenzt (' + i1.versuche + '), keine weiteren in 4 s (' + i2.versuche + ')');
      ok(angefragt <= 3, 'Figurdatei höchstens ' + angefragt + '× angefragt (nicht je Frame)');
      await bild(p2, '24-liste-figur-fehlt');
      await c2.close();
    }
  } catch (e) {
    fehler.push('Abbruch: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await browser.close();
    await srv.close();
  }
  const echt = [...new Set(fehler)];
  if (echt.length) { log('\nFehler:\n' + echt.join('\n')); process.exit(1); }
  log('\nAlles ok');
  process.exit(0);
})();
