'use strict';
// CHA-01 E: Sichtbeleg des Startmenüs (Richtung A „Rampe“): Titelbild → Hauptmenü → Crew-Lobby, Beitritt per Link (Einladung → Charakter wählen → Lobby),
// Moduswahl-Überlagerung (M), Zusatzoptionen je Modus, CHA-01 G: Porträts der Einladung ohne vorherige Taste (Pixelvergleich), Bereit-Knopf je Zustand, Raumcode-Eingang (Stil A), ohne und mit ?debug=1, Start einer Runde aus der neuen Lobby, Rückkehr in die Lobby.
// Echter Server im selben Prozess (kein Debug-Server nötig: ?debug=1 ist hier nur der Client-Schalter für die Sternenschicht-Modi), echte Browser-Clients (Playwright/Chromium).
// Ohne ?menue=1 beginnen ferngesteuerte Browser (navigator.webdriver) in der Lobby, damit ältere Skripte unverändert laufen; dieses Skript zeigt den echten Ablauf mit ?menue=1.
// Aufruf: node tools/sicht-menue.js [--port 3561] [--shots shots/menue] [--w 1280 --h 720]   (Bilder nicht im Repo, shots/ ist ignoriert)   Exit 1 bei Fehlern, 2 ohne Playwright.
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3561');
const SHOTS = path.resolve(arg('shots', path.join('shots', 'menue')));
const W = +arg('w', '1280'), H = +arg('h', '720');
const CODE = 'M4GM';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-menue-'));
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

// Charakterlisten wie im Browser gespeichert (localStorage 'pantheon.charaktere'): Aussehen je Person verschieden
function karte(name, o) { const k = Ch.standardKarte(name, KAT); return Object.assign(k, o, { outfit: Object.assign(k.outfit, (o && o.outfit) || {}) }); }
const PERSONEN = {
  aurelia: [karte('Aurelia', { frisur: 'dutt', haar: 3, haut: 1 })],
  brennus: [karte('Brennus', { frisur: 'zoepfe', bart: 'vollbart', haar: 2, outfit: { oberteil: 'plankenweste' } })],
  kaeso: [karte('Kaeso', { frisur: 'keine', haut: 2, outfit: { kopf: 'bordhelm' } }), karte('Cato', { gesicht: 'narbe', haar: 1, haut: 3 })],
};
const speicher = (liste) => ({ v: 1, gewaehlt: 'c0', liste: liste.map((k, i) => ({ id: 'c' + i, karte: k })) });

async function kontext(browser, url, person, o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: { width: o.w || W, height: o.h || H }, deviceScaleFactor: 1 });
  const daten = JSON.stringify(speicher(PERSONEN[person]));
  await ctx.addInitScript(([d, code, mitCode]) => { try { if (!sessionStorage.getItem('init')) { sessionStorage.setItem('init', '1'); localStorage.setItem('pantheon.charaktere', d); if (mitCode) localStorage.setItem('sternenschicht.roomCode', code); } } catch (e) { /* egal */ } }, [daten, CODE, !o.link]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) fehler.push('console: ' + m.text().slice(0, 200)); });
  await page.goto(url);
  await page.waitForFunction(() => window.__game && __game.state && __game.pid && window.Charaktere && Charaktere.lies().bereit && window.MenueFluss, null, { timeout: 60000 });
  await page.focus('#game');
  return { ctx, page };
}
async function bild(page, name) {
  await page.waitForTimeout(700);
  const f = path.join(SHOTS, name + '.png');
  await page.screenshot({ path: f });
  log('Bild ' + path.relative(ROOT, f).replace(/\\/g, '/'));
}
const taste = async (page, k, n) => { for (let i = 0; i < (n || 1); i++) { await page.keyboard.press(k); await page.waitForTimeout(60); } };
const schirm = (page) => page.evaluate(() => MenueFluss.lies().schirm);
const lobbyOpts = (page) => page.evaluate(() => { const l = __game.state.lobby || {}; return { start: l.startMission, world: l.world, skipDrill: l.skipDrill }; });
// Fläche des HUD-Canvas (Spielraster 640×360): Anzahl verschiedener Farben und ein Hash der Pixel (CHA-01 G: Porträts vergleichen, nie nur ansehen)
const flaeche = (page, x, y, w, h) => page.evaluate(([x0, y0, w0, h0]) => {
  const d = document.getElementById('game').getContext('2d').getImageData(x0, y0, w0, h0).data, s = new Set(); let hs = 2166136261;
  for (let i = 0; i < d.length; i += 4) { const v = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; s.add(v); hs = Math.imul(hs ^ v, 16777619) >>> 0; }
  return { farben: s.size, hash: hs };
}, [x, y, w, h]);
const PORTRAET_KARTE1 = [60, 196, 52, 56];   // Einladung: Porträt der ersten Charakterkarte ohne Kappe (Kappe wechselt mit dem Cursor)
const PORTRAET_GAST = [32, 127, 20, 20];     // Einladung: kleines Porträt des ersten Gastes
const spielerListe = (page) => page.evaluate(() => (__game.state.players || []).map((p) => ({ n: p.name, ready: p.ready, color: p.color })));

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await startServer({ port: PORT, debug: false, ruestphase: false, roomCode: CODE, quiet: true, worlds: false, noStore: true });
  const g = srv.game;
  g.worldList = [   // für Fortsetzen im Hauptmenü: zwei ladbare Weltstände (nur die Anzeige, der Server prüft die ID beim Wählen)
    { id: 'w2', name: 'Sund · Kantenstein', state: 'ok', playTime: 13620, loc: 'kantenstein', mission: null, step: null, savedAt: Date.now() - 20 * 3600 * 1000, spieler: ['Aurelia', 'Brennus'] },
    { id: 'w1', name: 'Eisenwald · Nebelheim', state: 'ok', playTime: 4200, loc: 'nebelheim', mission: 'k3_nebelheim', step: null, savedAt: Date.now() - 4 * 86400 * 1000, spieler: ['Aurelia'] },
  ];
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const BASIS = `http://127.0.0.1:${PORT}/`;
  const offen = [];
  try {
    // ---------------------------------------------------------------- 1 Titelbild, Hauptmenü, Gruppen
    log('\n== 1 Titelbild und Hauptmenü (Gastgeberin Aurelia, ohne ?debug=1) ==');
    const host = await kontext(browser, BASIS + '?menue=1', 'aurelia'); offen.push(host.ctx);
    const hp = host.page;
    ok(await schirm(hp) === 'titel', 'Start ohne Link: Titelbild');
    ok(await hp.evaluate(() => getComputedStyle(document.getElementById('keyart')).display === 'block' && document.getElementById('keyart').naturalWidth === 1536), 'Key-Art als Bildebene (1536 px breit) unter dem Canvas sichtbar');
    ok(await hp.evaluate(() => document.getElementById('keyart').style.filter === 'brightness(0.95)' && getComputedStyle(document.getElementById('game')).backgroundColor === 'rgba(0, 0, 0, 0)'), 'Helligkeit des Titels 0,95, Canvas durchsichtig');
    ok(await hp.evaluate(() => document.querySelector('link[rel=icon]').getAttribute('href').endsWith('marke-favicon.svg')), 'Favicon ist die Bildmarke (marke-favicon.svg)');
    await bild(hp, '01-titel');
    await taste(hp, 'Enter');
    ok(await schirm(hp) === 'menue', 'Enter im Titel: Hauptmenü');
    ok(await hp.evaluate(() => document.getElementById('keyart').style.filter === 'brightness(0.7)'), 'Helligkeit des Hauptmenüs 0,7');
    const sicht = await hp.evaluate(() => MenueFluss.sichtbar(__game.state.lobby).flatMap((e) => e.modi));
    ok(!['m1', 'free', 'm3'].some((m) => sicht.includes(m)) && sicht.includes('labor') && sicht.includes('eisenwald'), 'ohne ?debug=1: keine Sternenschicht-Modi, Labor und Eisenwald sichtbar (' + sicht.join(',') + ')');
    await taste(hp, '1'); await bild(hp, '02a-menue-schuld-lerche-titel-zweizeilig');
    await taste(hp, '2'); await bild(hp, '02-menue-spielen');
    await taste(hp, '3'); await bild(hp, '03-menue-eisenwald');
    await taste(hp, 'u'); ok(await hp.evaluate(() => MenueFluss.lies().tutorial === false), 'U im Hauptmenü schaltet das Tutorial aus'); await bild(hp, '04-menue-eisenwald-ohne-tutorial'); await taste(hp, 'u');
    await taste(hp, 'ArrowDown', 1); ok(await hp.evaluate(() => MenueFluss.lies().auswahl === 'fortsetzen'), 'Pfeil runter: Fortsetzen'); await bild(hp, '05-menue-fortsetzen');
    await taste(hp, '5'); await bild(hp, '06-menue-uebung');
    await taste(hp, '7'); await bild(hp, '07-menue-labor');
    await taste(hp, 'h'); await sleep(300); ok(await hp.evaluate(() => window.__game.client.ui.stack.slice(-1)[0] === 'controls'), 'H öffnet die Hilfe (Steuerung)'); await taste(hp, 'Escape'); await sleep(200);
    await taste(hp, 'Shift+Minus'); await sleep(300); ok(await hp.evaluate(() => window.__game.client.ui.stack.slice(-1)[0] === 'controls'), '? öffnet die Hilfe (wie an den Pulten)'); await taste(hp, 'Escape'); await sleep(200);
    await taste(hp, 'o'); await sleep(300); ok(await hp.evaluate(() => window.__game.client.ui.stack.slice(-1)[0] === 'options'), 'O öffnet die Optionen'); await taste(hp, 'Escape'); await sleep(200);
    ok(await schirm(hp) === 'menue', 'Optionen/Hilfe schließen zurück ins Hauptmenü');

    // ---------------------------------------------------------------- 2 Lobby als Gastgeberin mit drei Spielern
    log('\n== 2 Lobby: Gastgeberin, 3 Spieler, einer nicht bereit ==');
    await taste(hp, '2'); await taste(hp, 'Enter');
    ok(await schirm(hp) === 'lobby', 'Enter im Hauptmenü: Lobby');
    await hp.waitForFunction(() => __game.state.lobby && __game.state.lobby.startMission === 'freie_fahrt', null, { timeout: 5000 });
    ok((await lobbyOpts(hp)).start === 'freie_fahrt' && (await lobbyOpts(hp)).world === null, 'Server hat Modus Freie Fahrt Sund und neuen Weltstand');
    const brennus = await kontext(browser, BASIS + '?menue=1', 'brennus'); offen.push(brennus.ctx);
    ok(await schirm(brennus.page) === 'titel', 'Brennus steht noch im Titel (er ist trotzdem verbunden)');
    await hp.waitForFunction(() => (__game.state.players || []).length === 2, null, { timeout: 10000 });
    ok(!(await spielerListe(hp)).find((p) => p.n === 'Brennus').ready, 'wer im Titel steht, ist in der Lobby „nicht bereit“');
    // Kaeso kommt per Link: Einladung → Charakter wählen → Lobby
    const kaeso = await kontext(browser, BASIS + '?menue=1&code=' + CODE, 'kaeso', { link: true }); offen.push(kaeso.ctx);
    const kp = kaeso.page;
    await kp.waitForFunction(() => (__game.state.players || []).length === 3, null, { timeout: 10000 });
    ok(await schirm(kp) === 'einladung', 'Beitritt per Link: Einladung (Titel und Hauptmenü übersprungen)');
    await kp.waitForFunction(() => document.getElementById('keyart').style.filter === 'brightness(0.6)');
    const frueh = await flaeche(kp, ...PORTRAET_KARTE1), fruehGast = await flaeche(kp, ...PORTRAET_GAST);   // so früh wie möglich, ohne Taste
    await kp.waitForFunction(() => { const c = Charaktere.lies().liste[0]; const b = window.KammerBild && KammerBild.bild(c.karte, 'portraet'); return !!b; }, null, { timeout: 30000 });
    await kp.waitForTimeout(400); await bild(kp, '08-einladung');   // ohne vorherige Taste
    const ohneTaste = await flaeche(kp, ...PORTRAET_KARTE1), gastOhne = await flaeche(kp, ...PORTRAET_GAST);
    ok(ohneTaste.farben > 12, 'Einladung ohne Taste: das Porträt der ersten Karte ist gezeichnet (' + ohneTaste.farben + ' Farben, keine leere Platte)');
    ok(frueh.farben === 1 || frueh.hash === ohneTaste.hash, 'Einladung, erstes Bild: entweder die neutrale Platte oder schon das echte Porträt, nie ein Standardkopf (' + frueh.farben + ' Farben)');
    ok(fruehGast.farben === 1 || fruehGast.hash === gastOhne.hash || gastOhne.farben > 6, 'Einladung, erstes Bild: das Porträt des Gastes ist Platte oder echt');
    await taste(kp, 'ArrowRight'); await taste(kp, 'ArrowLeft'); await kp.waitForTimeout(300);
    const nachTaste = await flaeche(kp, ...PORTRAET_KARTE1);
    ok(nachTaste.hash === ohneTaste.hash && gastOhne.hash === (await flaeche(kp, ...PORTRAET_GAST)).hash, 'Porträts der Einladung ohne Taste = Porträts nach Eingabe (Pixelvergleich, gleiche Pixel)');
    const bes = await kp.evaluate(() => MenueFluss.einladungBesatzung(__game.state.players, __game.pid));
    ok(bes.n === 2 && bes.text === '2 an Bord + du', 'Einladung zählt ohne sich selbst: „' + bes.text + '“');
    ok(await kp.evaluate(() => !/GEWÄHLT/i.test(JSON.stringify(Render.ui.buttons.map((b) => b.label)))), 'Einladung zeigt kein „GEWÄHLT“');
    await taste(kp, 'ArrowRight'); await bild(kp, '09-einladung-zweiter-charakter');
    ok(await kp.evaluate(() => MenueFluss.lies().einladungCursor === 1), 'Pfeil rechts: zweiter Charakter am Cursor');
    await taste(kp, '1');
    await taste(kp, 'Enter');
    ok(await schirm(kp) === 'lobby', 'Enter: an Bord, Lobby');
    await kp.waitForFunction(() => { const p = (__game.state.players || []).find((q) => q.id === __game.pid); return p && p.name === 'Kaeso'; }, null, { timeout: 5000 });
    // Aurelia und Brennus bereit, Kaeso nicht
    ok(await hp.evaluate(() => { const me = __game.state.players.find((p) => p.id === __game.pid); return MenueFluss.bereitAnzeige(me).art === 'gold' && Render.ui.buttons.some((b) => b.label === 'Bereit melden'); }), 'nicht bereit: goldener Hauptknopf „Bereit melden“ in der START-Kachel');
    await bild(hp, '10a-lobby-nicht-bereit');
    await taste(hp, 'Enter');
    await brennus.page.evaluate(() => __game.send({ t: 'ready', ready: true }));
    await hp.waitForFunction(() => (__game.state.players || []).filter((p) => p.ready).length === 2, null, { timeout: 5000 });
    const sl = await spielerListe(hp);
    ok(sl.length === 3 && sl.filter((p) => p.ready).length === 2 && !sl.find((p) => p.n === 'Kaeso').ready, 'Aurelia und Brennus bereit, Kaeso nicht');
    ok(await hp.evaluate(() => { const me = __game.state.players.find((p) => p.id === __game.pid); return MenueFluss.bereitAnzeige(me).art === 'mint' && Render.ui.buttons.some((b) => b.label === 'Bereit'); }), 'bereit: mintfarbene Fläche „BEREIT“, Enter: zurück');
    await bild(hp, '10-lobby-gastgeberin');
    await bild(kp, '11-lobby-beitretender');
    await taste(hp, 'm'); ok(await hp.evaluate(() => MenueFluss.lies().modusOffen), 'M öffnet die Moduswahl als Überlagerung (reihum schaltet es nicht mehr)');
    ok((await lobbyOpts(hp)).start === 'freie_fahrt', 'M allein ändert den Modus nicht');
    await hp.waitForFunction(() => !Render.ui.buttons.some((b) => b.label === 'Bereit' || b.label === 'Bereit melden'), null, { timeout: 5000 }).catch(() => {});   // erst nach dem nächsten Frame ist die alte Lobby aus der Klickliste
    ok(await hp.evaluate(() => !Render.ui.buttons.some((b) => b.label === 'Bereit' || b.label === 'Bereit melden' || /^Farbe/.test(b.label) || b.label === 'Link kopieren')), 'Moduswahl offen: die Lobby darunter ist nicht gezeichnet (keine Bereit-, Farb- und Link-Flächen)');
    await taste(hp, 'ArrowDown'); await bild(hp, '12-lobby-modus-ueberlagerung');
    await taste(hp, 'Enter');
    await hp.waitForFunction(() => __game.state.lobby.startMission === 'eisenwald', null, { timeout: 5000 });
    ok(await hp.evaluate(() => !MenueFluss.lies().modusOffen && MenueFluss.lies().schirm === 'lobby'), 'Enter in der Überlagerung setzt den Modus (Eisenwald) für alle und schließt sie');
    // jeder darf den Modus ändern: Kaeso (nicht Gastgeber) schaltet das Tutorial ab
    await taste(kp, 'u');
    await hp.waitForFunction(() => __game.state.lobby.startMission === 'eisenwald_ohne', null, { timeout: 5000 });
    ok(true, 'Kaeso (nicht Gastgeber) schaltet mit U das Tutorial ab: Server meldet eisenwald_ohne');
    await bild(hp, '13-lobby-eisenwald-ohne-tutorial');

    // ---------------------------------------------------------------- 3 Zusatzoptionen je Modus in der Lobby
    log('\n== 3 Zusatzoptionen (Karte, Waffe, Abschnitte, Labor) ==');
    const waehle = async (page, taste1) => { await taste(page, 'm'); await taste(page, taste1); await taste(page, 'Enter'); await page.waitForTimeout(400); };
    await waehle(hp, '5'); ok((await lobbyOpts(hp)).start === 'arena_away', 'Wellen Boden gewählt');
    await taste(hp, 'k'); await taste(hp, 'w'); await bild(hp, '14-lobby-wellen-boden');
    await waehle(hp, '4'); await hp.waitForFunction(() => (__game.state.lobby.grabenListe || []).length > 0, null, { timeout: 5000 });
    await taste(hp, 'n'); await bild(hp, '15-lobby-grabenangriff');
    await waehle(hp, '6'); await taste(hp, 'k'); await bild(hp, '16-lobby-wellen-all');
    await waehle(hp, '7'); await hp.waitForFunction(() => (__game.state.lobby.laborListe || []).length > 0, null, { timeout: 5000 });
    for (const k of ['ArrowDown', 'ArrowDown', 'ArrowRight', 'r', 'g']) { await taste(hp, k); await hp.waitForTimeout(250); }   // jede Taste wirkt auf den Stand, den der Server schon gemeldet hat
    await bild(hp, '17-lobby-labor');
    log('  Labor-Stand: ' + JSON.stringify(await hp.evaluate(() => __game.state.lobby.labor)));
    ok(await hp.evaluate(() => { const l = __game.state.lobby; return !!(l.labor && l.labor.god && l.labor.staerke && l.labor.seed); }), 'Labor: ↑↓, ←→, R und G wirken (Stärke, Seed, god gesetzt)');
    // Weltstand fortsetzen aus dem Hauptmenü
    await taste(hp, 'Escape'); ok(await schirm(hp) === 'menue', 'Esc in der Lobby: Hauptmenü');
    ok(!(await spielerListe(hp)).find((p) => p.n === 'Aurelia').ready, 'Aurelia ist im Hauptmenü nicht bereit (Esc nimmt „bereit“ zurück)');
    await taste(hp, 'ArrowUp', 0); await hp.evaluate(() => MenueFluss.waehleTaste('F', __game.state.lobby)); await taste(hp, 'Enter');
    await hp.waitForFunction(() => __game.state.lobby.world === 'w2', null, { timeout: 5000 });
    ok(await schirm(hp) === 'lobby', 'Fortsetzen (Enter auf dem Weltstand): Lobby mit gewähltem Weltstand');
    await bild(hp, '18-lobby-fortsetzen');
    await taste(hp, 'Escape'); await hp.evaluate(() => MenueFluss.waehleTaste('2', __game.state.lobby)); await taste(hp, 'Enter');
    await hp.waitForFunction(() => __game.state.lobby.world == null && __game.state.lobby.startMission === 'freie_fahrt', null, { timeout: 5000 });

    // ---------------------------------------------------------------- 4 Start aus der neuen Lobby bis ins Spiel, zurück in die Lobby
    log('\n== 4 Start aus der Lobby ==');
    for (const p of [hp, brennus.page, kp]) await p.evaluate(() => { const m = (__game.state.players || []).find((q) => q.id === __game.pid); if (m && !m.ready) __game.send({ t: 'ready', ready: true }); });
    await hp.waitForFunction(() => __game.state.phase === 'play', null, { timeout: 40000 });
    ok(true, 'alle bereit: die Runde (Freie Fahrt Sund) startet');
    await hp.waitForTimeout(2500); await bild(hp, '19-spiel');
    await hp.evaluate(() => __game.send({ t: 'menu', op: 'end' }));
    await hp.waitForFunction(() => __game.state.phase === 'lobby', null, { timeout: 20000 });
    await hp.waitForTimeout(500);
    ok(await schirm(hp) === 'lobby' && await schirm(kp) === 'lobby', 'nach der Runde: alle in der Lobby (nicht im Titel)');
    await bild(hp, '20-lobby-nach-der-runde');
    for (const c of offen.splice(0)) await c.close();

    // ---------------------------------------------------------------- 5 mit ?debug=1: Sternenschicht-Modi sichtbar
    log('\n== 5 mit ?debug=1 ==');
    const dbg = await kontext(browser, BASIS + '?menue=1&debug=1', 'aurelia'); offen.push(dbg.ctx);
    await taste(dbg.page, 'Enter');
    const sichtD = await dbg.page.evaluate(() => MenueFluss.sichtbar(__game.state.lobby).flatMap((e) => e.modi));
    ok(['m1', 'free', 'm3'].every((m) => sichtD.includes(m)), 'mit ?debug=1: Kampagne Boje/Nebel/Kesh, ohne Tutorial (Lichtkordon) und Direkt Kesh sichtbar (' + sichtD.join(',') + ')');
    await taste(dbg.page, '8'); await bild(dbg.page, '21-menue-debug');
    await taste(dbg.page, 'Enter'); await dbg.page.waitForFunction(() => __game.state.lobby.startMission === 'm1', null, { timeout: 5000 });
    await bild(dbg.page, '22-lobby-debug-modus');
    for (const c of offen.splice(0)) await c.close();

    // ---------------------------------------------------------------- 6 Automation und Direktstart: Lobby ohne Titel
    log('\n== 6 Direktstart ==');
    const auto = await kontext(browser, BASIS, 'aurelia'); offen.push(auto.ctx);
    ok(await schirm(auto.page) === 'lobby', 'ferngesteuerter Browser ohne ?menue=1: Lobby (ältere Skripte laufen unverändert)');
    await auto.page.evaluate(() => { __game.send({ t: 'lobbyOpt', startMission: 'freie_fahrt' }); });
    await auto.page.waitForFunction(() => __game.state.lobby.startMission === 'freie_fahrt');
    ok(await auto.page.evaluate(() => MenueFluss.lies().schirm === 'lobby'), '__game.send wirkt unabhängig vom Menüzustand');
    {
      const ar = await kontext(browser, BASIS + '?arena=graben', 'aurelia'); offen.push(ar.ctx);
      await ar.page.waitForFunction(() => __game.state.lobby.startMission === 'arena_graben', null, { timeout: 8000 });
      ok(await schirm(ar.page) === 'lobby', '?arena=graben: Direktstart wählt den Grabenangriff und beginnt in der Lobby (kein Titel)');
    }
    for (const c of offen.splice(0)) await c.close();

    // ---------------------------------------------------------------- 6b Nacharbeit: Ton-Hinweis, Farbe per Maus, Weltstand voll, Einladung ablehnen, Eisenwald-Schalter
    log('\n== 6b Ton-Hinweis, Farbe per Maus ==');
    {
      const frisch = await kontext(browser, BASIS + '?menue=0', 'aurelia'); offen.push(frisch.ctx);
      ok(await frisch.page.evaluate(() => !__game.client.audioOn), 'Ton ist vor der ersten Eingabe aus');
      await bild(frisch.page, '26-lobby-ton-hinweis');
      await frisch.page.keyboard.press('Shift');   // erste Eingabe aktiviert den Ton
      const farbeVor = await frisch.page.evaluate(() => (__game.state.players.find((p) => p.id === __game.pid) || {}).color);
      const ziel = farbeVor === 2 ? 3 : 2;
      await frisch.page.evaluate((z) => { const b = Render.ui.buttons.find((x) => x.label === 'Farbe ' + (z + 1)); if (b) b.onClick(); }, ziel);
      await frisch.page.waitForFunction((z) => (__game.state.players.find((p) => p.id === __game.pid) || {}).color === z, ziel, { timeout: 5000 });
      ok(true, 'Klick auf eine Farbe in der Hinweiszeile setzt die Spielerfarbe (S' + (ziel + 1) + ')');
      await bild(frisch.page, '27-lobby-farbe-per-maus');
      for (const c of offen.splice(0)) await c.close();
    }
    log('\n== 6c Weltstände voll ==');
    {
      const alt = g.worldList.slice();
      g.worldList = [1, 2, 3, 4, 5].map((i) => ({ id: 'v' + i, name: 'Weltstand ' + i, state: 'ok', playTime: 1000 * i, loc: 'kantenstein', mission: null, step: null, savedAt: Date.now() - i * 3600 * 1000, spieler: ['Aurelia'] }));
      g.lobbyOpts.world = null;   // der Test-Server führt keine Weltstände (worlds: false): die Liste ist nur die Anzeige, „voll“ folgt aus 5 von 5
      const voll = await kontext(browser, BASIS + '?menue=1', 'aurelia'); offen.push(voll.ctx);
      const vp = voll.page; await taste(vp, 'Enter'); await taste(vp, '1');
      await vp.waitForFunction(() => __game.state.lobby && (__game.state.lobby.worlds || []).length === 5, null, { timeout: 5000 });
      await bild(vp, '28-menue-weltstaende-voll');
      ok(await vp.evaluate(() => MenueFluss.weltstaende(__game.state.lobby).voll), 'Hauptmenü: 5/5 Weltstände gelten als voll');
      await taste(vp, 'Enter'); await vp.waitForFunction(() => MenueFluss.lies().schirm === 'lobby', null, { timeout: 5000 });
      await bild(vp, '29-lobby-weltstaende-voll');
      g.worldList = alt;
      for (const c of offen.splice(0)) await c.close();
    }
    log('\n== 6d Einladung ablehnen ==');
    {
      const gast1 = await kontext(browser, BASIS + '?menue=0', 'aurelia'); offen.push(gast1.ctx);
      const eingeladen = await kontext(browser, BASIS + '?menue=1&code=' + CODE, 'kaeso', { link: true }); offen.push(eingeladen.ctx);
      const ep = eingeladen.page;
      await gast1.page.waitForFunction(() => (__game.state.players || []).length === 2, null, { timeout: 10000 });
      ok(await schirm(ep) === 'einladung', 'Einladung steht');
      await taste(ep, 'Escape');
      await gast1.page.waitForFunction(() => (__game.state.players || []).length === 1, null, { timeout: 10000 });
      ok(true, 'Esc: der Eingeladene ist aus dem Raum (der Server führt nur noch einen Spieler)');
      await ep.waitForFunction(() => !__game.state && Net.badCode === true && Net.roomCode === '', null, { timeout: 10000 });
      ok(await ep.evaluate(() => { let ls = null; try { ls = localStorage.getItem('sternenschicht.roomCode'); } catch (e) { /* egal */ } return !ls && !/code=/.test(location.search); }), 'Raumcode ist vergessen (Speicher und Adresse), kein Wiedereintritt');
      await ep.waitForTimeout(2500);
      ok((await spielerListe(gast1.page)).length === 1, 'er kommt nicht von selbst zurück (nach 2,5 s weiter ein Spieler)');
      ok(await ep.evaluate(() => document.getElementById('keyart').style.filter === 'brightness(0.6)'), 'Raumcode-Eingang: Key-Art mit hell.beitritt 0,6');
      const eing = await ep.evaluate(() => MenueFluss.raumcodeEingang({ badCode: Net.badCode, verbunden: Net.status === 'open', hatSpieler: false, roomCode: Net.roomCode }));
      ok(eing && eing.abgelehnt && eing.ueberschrift === 'EINLADUNG ABGELEHNT' && !eing.fehler, 'nach bewusster Ablehnung: „EINLADUNG ABGELEHNT“, kein Fehlerton');
      ok(await ep.evaluate(() => { const i = document.getElementById('lobbyCode'), r = i.getBoundingClientRect(), c = document.getElementById('game').getBoundingClientRect(), f = Menue.TOKENS.MASS.eingang.feld, s = c.width / 640; return getComputedStyle(i).display === 'block' && Math.abs(r.left - (c.left + f.x * s)) < 2 && Math.abs(r.top - (c.top + f.y * s)) < 2; }), 'Eingabefeld sitzt in der Kachel (Maße aus MASS.eingang.feld)');
      await bild(ep, '30-einladung-abgelehnt');
      await bild(gast1.page, '31-lobby-nach-ablehnung');
      for (const c of offen.splice(0)) await c.close();
    }
    log('\n== 6d2 Raumcode-Eingang ohne Ablehnung, falscher Code ==');
    {
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 }); offen.push(ctx);
      await ctx.addInitScript(() => { try { localStorage.removeItem('sternenschicht.roomCode'); } catch (e) { /* egal */ } });
      const rp = await ctx.newPage(); rp.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
      await rp.goto(BASIS + '?menue=1');
      await rp.waitForFunction(() => window.Net && Net.badCode === true && window.MenueFluss, null, { timeout: 30000 });
      await rp.waitForTimeout(800);
      const e1 = await rp.evaluate(() => MenueFluss.raumcodeEingang({ badCode: Net.badCode, verbunden: Net.status === 'open', hatSpieler: false, roomCode: Net.roomCode }));
      ok(e1 && e1.ueberschrift === 'RAUMCODE' && !e1.abgelehnt && !e1.fehler, 'ohne Ablehnung: „RAUMCODE“, kein Fehlerton');
      await bild(rp, '36-raumcode-eingang');
      await rp.focus('#lobbyCode'); await rp.keyboard.type('zzzz'); await rp.keyboard.press('Enter');
      await rp.waitForFunction(() => Net.roomCode === 'ZZZZ' && Net.badCode === true, null, { timeout: 10000 }); await rp.waitForTimeout(800);
      const e2 = await rp.evaluate(() => MenueFluss.raumcodeEingang({ badCode: Net.badCode, verbunden: Net.status === 'open', hatSpieler: false, roomCode: Net.roomCode }));
      ok(e2 && e2.fehler && e2.ueberschrift === 'RAUMCODE', 'falscher Code: Fehlerzeile unter dem Knopf');
      await bild(rp, '37-raumcode-falsch');
      for (const c of offen.splice(0)) await c.close();
    }
    log('\n== 6e Hauptmenü Eisenwald nach einer Runde, Weltstand in der Moduswahl, sichtbarer Modus ==');
    {
      g.lobbyOpts.startMission = 'eisenwald_ohne'; g.lobbyOpts.world = null;   // der Modus der letzten Runde bleibt in der Lobby stehen
      const eh = await kontext(browser, BASIS + '?menue=1', 'aurelia'); offen.push(eh.ctx);
      const ep = eh.page; await taste(ep, 'Enter');
      ok(await ep.evaluate(() => MenueFluss.lies().auswahl === 'eisenwald' && MenueFluss.lies().tutorial === false), 'Hauptmenü nach der Runde: Eisenwald gewählt, Tutorial steht auf aus (wie die Lobby)');
      await bild(ep, '32-menue-eisenwald-nach-runde');
      await taste(ep, 'u'); await ep.waitForTimeout(800);
      ok(await ep.evaluate(() => MenueFluss.lies().tutorial === true), 'U im Hauptmenü bei Lobby-Modus eisenwald_ohne: Tutorial an (wird nicht jeden Frame zurückgesetzt)');
      await bild(ep, '33-menue-eisenwald-u-gedrueckt');
      await ep.evaluate(() => { const b = Render.ui.buttons.find((x) => x.label === 'Tutorial'); if (b) b.onClick(); }); await ep.waitForTimeout(500);
      ok(await ep.evaluate(() => MenueFluss.lies().tutorial === false), 'Mausklick auf den Tutorial-Schalter im Hauptmenü schaltet denselben Merker');
      await taste(ep, 'u'); await taste(ep, 'Enter');
      await ep.waitForFunction(() => __game.state.lobby.startMission === 'eisenwald', null, { timeout: 5000 });
      ok(true, 'Enter nach U: der Server meldet Eisenwald mit Tutorial');
      await taste(ep, 'u'); await ep.waitForFunction(() => __game.state.lobby.startMission === 'eisenwald_ohne', null, { timeout: 5000 });
      ok(true, 'U in der Lobby schaltet den Modus der Runde sofort (Server: eisenwald_ohne)');
      await ep.waitForTimeout(800);   // erst nach einem gezeichneten Frame kennt der Chip den neuen Modus (der Klick benutzt den Snapshot des letzten Frames)
      await ep.evaluate(() => { const b = Render.ui.buttons.find((x) => /^Tutorial/.test(x.label)); if (b) b.onClick(); });
      await ep.waitForFunction(() => __game.state.lobby.startMission === 'eisenwald', null, { timeout: 5000 });
      ok(true, 'Mausklick auf den Tutorial-Chip in der Lobby: dieselbe Action (Server: eisenwald)');
      // K3: Weltstand in der Moduswahl wählen schließt die Überlagerung
      await taste(ep, 'm'); ok(await ep.evaluate(() => MenueFluss.lies().modusOffen), 'M öffnet die Moduswahl');
      await taste(ep, 'f'); await sleep(300); await taste(ep, 'ArrowDown'); await taste(ep, 'Enter'); await sleep(500);
      ok(await ep.evaluate(() => !MenueFluss.lies().modusOffen && MenueFluss.lies().schirm === 'lobby' && __game.client.ui.stack.length === 0), 'Weltstand in der Moduswahl gewählt: Überlagerung zu, Lobby sichtbar');
      await bild(ep, '34-lobby-nach-weltstandwahl-in-moduswahl');
      // K2: Server-Standard m1 (ohne Debug unsichtbar): „+ Neue Kampagne“ aus dem Hauptmenü
      await taste(ep, 'Escape'); await sleep(200);
      await ep.evaluate(() => __game.send({ t: 'lobbyOpt', startMission: 'm1', world: null })); await ep.waitForFunction(() => __game.state.lobby.startMission === 'm1', null, { timeout: 5000 });
      await taste(ep, 'f'); await sleep(300); await taste(ep, 'Enter'); await sleep(600);
      await ep.waitForFunction(() => __game.state.lobby.startMission !== 'm1', null, { timeout: 5000 });
      ok(await ep.evaluate(() => MenueFluss.lies().schirm === 'lobby' && MenueFluss.eintragZuModus(__game.state.lobby.startMission) && MenueFluss.sichtbar(__game.state.lobby).some((e) => e.modi.includes(__game.state.lobby.startMission))), 'F → + Neue Kampagne bei Server-Modus m1: die Lobby zeigt einen sichtbaren Modus');
      await bild(ep, '35-lobby-sichtbarer-modus');
      for (const c of offen.splice(0)) await c.close();
    }

    // ---------------------------------------------------------------- 7 1920×1080
    log('\n== 7 1920×1080 ==');
    const gross = await kontext(browser, BASIS + '?menue=1', 'aurelia', { w: 1920, h: 1080 }); offen.push(gross.ctx);
    await bild(gross.page, '23-titel-1080');
    await taste(gross.page, 'Enter'); await taste(gross.page, '2'); await bild(gross.page, '24-menue-1080');
    await taste(gross.page, 'Enter'); await bild(gross.page, '25-lobby-1080');
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
