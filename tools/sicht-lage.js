// Sichtprüfung der Übersichtskarte Sund (SUND-01 C, Abnahme 7): echter Server (im selben Prozess, damit der Sim-Zustand präpariert werden kann) und
// echter Browser-Client (Playwright), Modus „Freie Fahrt Sund“, Captain-Konsole. Lagen: ruhig, Aufmarsch gesehen (mit Funk-Einblendung), Aufmarsch nicht
// gesehen (Altstand), Marsch, Belagerung, Zoom, Nahansicht, Funk-Reiter, mehrere Meldungen kurz hintereinander. Die Lagen entstehen durch einen
// präparierten Sim-Zustand (kein Warten), das Wissen von Rom rechnet der echte Server (kriegslage-wissen.js), gezeichnet wird mit dem echten Client.
// Aufruf: node tools/sicht-lage.js [--shots <Ordner>] [--port 3460] [--dpr 1]      (Bilder nicht im Repo, Standard: Temp-Ordner; --dpr 3 für die Hexnahaufnahmen z-*.png)
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3460');
const SHOTS = arg('shots', path.join(os.tmpdir(), 'sund01-shots'));
const DPR = +arg('dpr', '1');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-lage-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Wissen = require('../server/sim/kriegslage-wissen.js');
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await startServer({ port: PORT, debug: true, roomCode: 'off', quiet: true, worlds: true, worldDir: path.join(TMP, 'worlds') });
  const g = srv.game;
  const b = await chromium.launch();
  const fehler = [];
  try {
    const page = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: DPR })).newPage();
    page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') fehler.push('console: ' + m.text().slice(0, 200)); });
    await page.goto(`http://127.0.0.1:${PORT}/?debug=1&render=2d`);
    await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
    await page.evaluate(() => { __game.send({ t: 'lobbyOpt', startMission: 'freie_fahrt' }); __game.send({ t: 'ready', ready: true }); });
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await sleep(500);
    const ws = g.weltsim, z = ws.zustand;
    const flotteVon = (heimat) => z.flotten.find((f) => f.heimat === heimat && f.fraktion !== 'pirat');
    const schritt = (aendere, ev) => { const vor = Kriegslage.abbild(ws.zustand); if (aendere) aendere(ws.zustand); ws.tickZahl++; ws.zustand.tick++; Wissen.nachTick(g, vor, ev || [], g.ship.scene); };
    const sammelt = (fl, an, stuetz, ziel) => { fl.befehl = 'sammeln'; fl.ziel = stuetz; fl.ort = stuetz; fl.angriff = an; z.angriffe.push({ id: an, t0: z.tick, ziel, von: 'ger', art: 'reich', relevant: true, zielArt: 'hafen', t_an: null, t_ende: null, ausgang: null, phase: 'sammeln', t_marsch: null, stuetz, flotten: [fl.id] }); };
    const ruhigMachen = (post, lerche) => {
      for (const fl of z.flotten) { fl.befehl = 'heim'; fl.ziel = null; fl.ort = fl.heimat; fl.angriff = null; }
      z.angriffe.length = 0; ws.ereignisse.length = 0;
      for (const c of ['0603']) Object.assign(z.hexe[c], post ? { besitzer: 'rom', posten: true, garnison: 4 } : { besitzer: null, posten: false, garnison: 0 });
      Object.assign(z.hexe['0703'], { besitzer: 'ger', posten: false });   // Eisfeld ist germanisch: Front am Pass Kantenstein|Eisfeld
      g.debugGoto(lerche, false);
      Wissen.starten(g);
      ws.wissen.t = ws.tickZahl;
    };
    const KARTE = { x: 125, y: 15, width: 830, height: 470 }, SPALTE = { x: 965, y: 15, width: 310, height: 470 };
    const shot = async (name, wartMs, clip) => { await sleep(wartMs || 700); await page.screenshot(Object.assign({ path: path.join(SHOTS, name + '.png') }, clip ? { clip } : {})); console.log('Bild', name); };
    const hexPos = (code) => page.evaluate((c) => { const m = StarMap.hexMitte(c); const cv = document.getElementById('game'); const r = cv.getBoundingClientRect(); return m ? { x: r.x + m.x * r.width / 640, y: r.y + m.y * r.height / 360 } : null; }, code);
    // Nahaufnahme eines Hexes (SUND-01 G: eigener Kurspfeil, Auswahl über den Plaketten, Klasse unter Belagerung)
    const hexShot = async (name, code, dx, dy) => { const q = await hexPos(code); if (!q) return; await page.screenshot({ path: path.join(SHOTS, name + '.png'), clip: { x: Math.max(0, q.x - (dx || 55)), y: Math.max(0, q.y - (dy || 45)), width: 2 * (dx || 55), height: 2 * (dy || 45) } }); console.log('Bild', name); };
    const hover = async (code) => { const q = await hexPos(code); if (q) await page.mouse.move(q.x, q.y); await sleep(250); };
    const sitz = (c) => page.evaluate((cc) => __game.send({ t: 'debug', cmd: 'sitz', console: cc }), c);
    const lage = () => page.evaluate(() => ({ hat: !!(window.StarMap && StarMap.lageAktiv()), ansicht: StarMap.lageAnsicht }));
    await sitz('captain'); await sleep(600);
    await page.keyboard.press('Digit2'); await sleep(400);

    // ---- Lage A: ruhig (Posten Kantenstein, Lerche in Pulverhorn), Eisfeld mit germanischer Patrouille, Altstand bei Skjaldborg
    ruhigMachen(true, 'pulverhorn');
    // Gullfjord-Flotte: eine Sonde sieht sie (Alter 0), danach geht sie heim und bleibt als Altstand mit wachsendem Alter
    const gull = flotteVon('1003');
    schritt(() => { gull.befehl = 'anspruch'; gull.ziel = '0803'; gull.ort = '0904'; });
    g.time += 1; require('../server/sim/sektorplan.js').sichten(g, '0904', 'sonde');
    schritt(() => { gull.befehl = 'heim'; gull.ort = gull.heimat; gull.ziel = null; });
    // römische Patrouille unterwegs (Kurs), Skjaldborg-Flotte beansprucht Eisfeld (gesehen, Kurs), sichtbar nach einem Tick
    const rom = flotteVon('0305'), skj = flotteVon('0904');
    for (let i = 0; i < 8; i++) schritt();
    schritt(() => { rom.befehl = 'anspruch'; rom.ziel = '0505'; rom.ort = '0405'; skj.befehl = 'anspruch'; skj.ziel = '0703'; skj.ort = '0803'; });
    schritt();
    await shot('a-ruhig'); await shot('crop-a-karte', 100, KARTE); await shot('crop-a-spalte', 100, SPALTE);
    await hexShot('z-a-porta', '0405'); await hexShot('z-a-eisfeld', '0703'); await hexShot('z-a-ulfs', '0803');
    await hover('0602'); await shot('crop-altrost-spalte', 100, SPALTE); await page.mouse.move(5, 5);   // verborgenes Hex Altrost: „?“ ohne Namen (Wissensleck geschlossen)
    console.log('Lage A:', JSON.stringify(await lage()), JSON.stringify(Wissen.lage(g)).length + ' B');

    // ---- Lage B: Aufmarsch gesehen: Sammeln in Ulfsvakt (2 Sprünge vom Posten), Funk-Einblendung
    ruhigMachen(true, 'pulverhorn');
    for (let i = 0; i < 3; i++) schritt();
    const ger = flotteVon('0803');
    schritt(() => sammelt(ger, 1, '0803', '0403'));
    await sleep(200);
    schritt();   // Anzeige hängt einen Tick nach: jetzt Plakette, Meldung und Funk
    await shot('b-aufmarsch-gesehen-funk', 900); await shot('crop-b-karte', 50, KARTE);
    schritt(); await shot('b-aufmarsch-gesehen', 8000);   // Einblendung (6 s) ist vorbei
    await hover('0803'); await shot('crop-b-ulfsvakt', 100, SPALTE); await page.mouse.move(5, 5);
    // Zoom 2x um Kantenstein
    const pos = await page.evaluate(() => { const m = StarMap.hexMitte('0603'); return m ? { x: m.x, y: m.y } : null; });
    console.log('Hexmitte Kantenstein (Spielpixel):', JSON.stringify(pos));
    const box = await page.evaluate(() => { const c = document.getElementById('game'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cw: c.width, ch: c.height }; });
    if (pos) { await page.mouse.move(box.x + pos.x * box.w / 640, box.y + pos.y * box.h / 360); for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -120); await sleep(120); } }
    await shot('zoom-b', 600); await shot('crop-zoom', 50, KARTE);
    await page.keyboard.press('Digit0'); await sleep(300);
    // Nahansicht (M)
    await page.keyboard.press('KeyM'); await sleep(400);
    await shot('nahansicht-b', 500); await shot('crop-nah', 50, KARTE);
    await page.keyboard.press('KeyM'); await sleep(300);
    // Funk-Reiter mit Lagefunk
    await page.keyboard.press('Digit1'); await sleep(500);
    await shot('funk-reiter', 300);
    await page.keyboard.press('Digit2'); await sleep(300);

    // ---- Phasen: Marsch (Kurs und vermutetes Ziel), Belagerung (zwei Plaketten, Notruf-Marke)
    schritt(() => { ger.befehl = 'angriff'; ger.ziel = '0403'; ger.ort = '0703'; z.angriffe[0].phase = 'marsch'; });
    schritt();
    await shot('phase-marsch', 800); await shot('crop-marsch', 50, KARTE);
    schritt(() => { ger.ort = '0403'; z.angriffe[0].t_an = z.tick; }, [{ typ: 'notruf', tick: z.tick, fraktion: 'rom', art: 'belagerung', ort: '0403', ortName: 'Speculum', opfer: 'rom', angreifer: 'ger', staerke: 2, klasse: 1, angriff: 1 }]);
    schritt();
    await shot('phase-belagerung', 900); await shot('crop-bel', 50, KARTE); await shot('crop-bel-spalte', 50, SPALTE);
    await hexShot('z-bel-spec', '0403'); await hover('0403'); await hexShot('z-bel-spec-sel', '0403'); await page.mouse.move(5, 5);
    // SUND-01 G: Hafenklasse unter Belagerung erscheint, wo Platz ist (Zoom); in der Übersicht entfällt sie
    { const q = await hexPos('0403'); if (q) { await page.mouse.move(q.x, q.y); for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -120); await sleep(120); } await sleep(300); await shot('zoom-bel', 300); await shot('crop-zoom-bel', 50, KARTE); await page.keyboard.press('Digit0'); await sleep(300); await page.mouse.move(5, 5); } }

    // ---- Lage C: Aufmarsch nicht gesehen (Posten Kantenstein verloren, Ulfsvakt außer Sicht, Altstand)
    ruhigMachen(true, 'pulverhorn');
    const ger2 = flotteVon('0803');
    for (let i = 0; i < 2; i++) schritt();
    schritt(() => sammelt(ger2, 1, '0803', '0403')); schritt();
    schritt();
    await sleep(6800);   // Funk-Einblendung (6 s) auslaufen lassen
    schritt((zz) => { Object.assign(zz.hexe['0603'], { besitzer: null, posten: false, garnison: 0 }); }, [{ typ: 'posten_verloren', tick: z.tick, fraktion: 'rom', ort: '0603', ortName: 'Kantenstein', besitzer: 'rom', durch: 'pirat' }]);
    schritt();   // höchstens 2 Ticks nach dem Postenverlust: Ulfsvakt ist Altstand (kein Aufmarsch-Funk)
    await sleep(6800);   // die Einblendung „Posten verloren“ auslaufen lassen, damit keine Funkmeldung auf dem Bild steht
    await hover('0803');
    await shot('c-aufmarsch-nicht-gesehen', 900); await shot('crop-c-karte', 50, KARTE); await shot('crop-c-spalte', 50, SPALTE);
    // SUND-01 G: mit gewähltem Sprungziel (Knopf, Sprungpunkt-Zeile und Hinweis zusammen: die engste Höhenbilanz der Spalte)
    for (const hh of ['0803', '0603', '0703', '0503', '0604', '0602', '0704']) { await page.evaluate((x) => __game.send({ t: 'cmd', c: 'captain.selectDest', hex: x }), hh); await sleep(250); if (g.ship.jump.dest) { console.log('Sprungziel', g.ship.jump.dest, '·', g.ship.jump.blockedReason); break; } }
    await sleep(300);
    await shot('crop-c-ziel-spalte', 300, SPALTE);
    g.ship.jump.dest = null; await sleep(300);
    await page.mouse.move(5, 5);

    // ---- mehrere Meldungen kurz hintereinander (Schnellsprung): drei Lagefunks im Abstand von 1,5 s
    ruhigMachen(true, 'pulverhorn');
    for (let i = 0; i < 2; i++) schritt();
    const a = flotteVon('0803'), c2 = flotteVon('0805'), d2 = flotteVon('0904');
    schritt(() => { sammelt(a, 11, '0803', '0403'); });
    schritt(() => { sammelt(c2, 12, '0703', '0403'); });
    schritt(() => { sammelt(d2, 13, '0703', '0503'); });
    schritt(); await sleep(1500); schritt(); await sleep(1500); schritt();
    await shot('funk-folge-1', 200); await shot('crop-viele', 50, KARTE); await shot('crop-viele-spalte', 50, SPALTE);
    await sleep(3000); await shot('funk-folge-2', 100);
    const h = await page.evaluate(() => ({ queue: (Hud.radioQueue || []).length, flash: Hud.radioFlash && Hud.radioFlash.text, lf: KarteLage.funkListe().length }));
    console.log('Lagefunk-Folge:', JSON.stringify(h), 'Funk-Ereignisse im Server-Logbuch:', g.explore.log.filter((e) => /sammelt sich/.test(e.text)).length);
    await page.keyboard.press('Digit1'); await sleep(500);
    await shot('funk-reiter-folge', 300);   // Lagefunk-Liste und Logbuch nach mehreren Meldungen kurz hintereinander
    // SUND-01 G: viele Flotten (Liste länger als 5), Ortsinfo mit Hafen
    await page.keyboard.press('Digit2'); await sleep(300);
    ruhigMachen(true, 'pulverhorn');
    const ids = ['0803', '0805', '0904', '0905', '1003', '1004', '1005', '1105'], ziele = ['0703', '0704', '0705', '0703', '0803', '0705', '0904', '0805'];
    schritt(() => { ids.forEach((hh, i) => { const f = flotteVon(hh); if (f) { f.befehl = 'anspruch'; f.ziel = ziele[i]; f.ort = ziele[i]; } }); const pp = z.flotten.find((f) => f.fraktion === 'pirat'); if (pp) { pp.befehl = 'anspruch'; pp.ziel = '0703'; pp.ort = '0703'; } });
    schritt(); schritt(); await sleep(6800);
    await hover('0704'); await shot('viele-flotten', 400); await shot('crop-viele2-spalte', 50, SPALTE); await page.mouse.move(5, 5);
    console.log('Server-Fehler:', g.errors);
  } finally {
    await b.close(); await srv.close();
    if (fehler.length) console.log('Browser-Fehler:\n' + [...new Set(fehler)].slice(0, 15).join('\n'));
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
