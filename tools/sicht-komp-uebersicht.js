// Sichtprüfung TEC-01 D: Übersicht der Schildkette-Komponenten im Schadensplan der Technik-Konsole. Echter Server (im selben Prozess, damit Komponenten gesetzt werden können) und echter
// Browser-Client (Playwright, Chromium, 2D-Ansicht oder --render voxel). Bilder: Generator zerstört, Emitter mit verschlissenem Relais, geflickte Komponenten mit Sprungzähler, dazu Reaktor-/Waffenschaden
// (unverändert) – jeweils mit dem betreffenden System gewählt. Prüfungen lesen die Texte aus dem Client (Zeilenmodell der Konsole), nicht aus den Pixeln.
// Aufruf: node tools/sicht-komp-uebersicht.js [--shots <Ordner>] [--port 3472] [--render 2d|voxel]    Exit 1 bei Browser-/Prüffehlern, 2 ohne Playwright.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3472');
const SHOTS = arg('shots', path.join(os.tmpdir(), 'tec01-d-sicht'));
const RENDER = arg('render', '2d');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-kompuebersicht-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
const I = require('../server/sim/interior.js');
const K = require('../server/sim/komponenten.js');
const BOTS = require('../server/sim/bots.js');
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.log('playwright-core nicht gefunden'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await startServer({ port: PORT, debug: true, roomCode: 'off', quiet: true, worlds: true, worldDir: path.join(TMP, 'worlds') });
  const g = srv.game;
  const args = RENDER === 'voxel' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [];
  const b = await chromium.launch({ args });
  const fehler = [];
  let pruef = 0, botsAus = null;
  const ok = (c, t) => { pruef++; console.log((c ? '  ok   ' : '  FEHLER ') + t); if (!c) fehler.push('Prüfung: ' + t); };
  try {
    const page = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') fehler.push('console: ' + m.text().slice(0, 200)); });
    await page.goto(`http://127.0.0.1:${PORT}/?render=${RENDER}`);
    await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
    await page.evaluate(() => { __game.send({ t: 'lobbyOpt', startMission: 'freie_fahrt' }); __game.send({ t: 'ready', ready: true }); });
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    if (RENDER === 'voxel') await page.waitForFunction(() => window.VoxelRender && VoxelRender.ready, null, { timeout: 60000 });
    await sleep(800);
    botsAus = setInterval(() => { g.ship.repairQueue = g.ship.repairQueue.filter((q) => q.keep); for (const bo of g.bots) if (bo.task && bo.task.kind === 'repair') bo.task = null; }, 40);   // keine Schrauber-Bots (sie reparierten zwischendurch); Einträge mit keep bleiben
    g.space.enemies = []; g.space.projectiles = [];
    const CODE = { o: 'ok', d: 'defekt', g: 'geflickt' };
    const setz = (sys, codes, n, sp) => { K.erzeugeAusZustand(g, sys); codes.split('').forEach((ch, i) => { const k = g.ship.komp[sys][i]; k.z = CODE[ch]; k.n = (n && n[i]) || 0; k.sp = (sp && sp[i]) || 0; }); K.synchronisieren(g, sys); };
    const alleHeil = () => { for (const k of I.SYSTEM_ORDER) g.ship.systems[k] = 'ok'; g.ship.fragile = {}; g.ship.offline = {}; g.ship.repairQueue = []; I.integritaetVoll(g); K.neuAufstellen(g); };
    const sitz = async () => { await page.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'technik' })); await sleep(700); await page.evaluate(() => { Consoles.ttab = 1; }); await page.mouse.move(5, 5); };
    const waehle = async (sys) => { await page.evaluate((s) => { const rows = Consoles.damageRows(Client.state); Consoles.sel.damage = Math.max(0, rows.findIndex((r) => r.target === s)); }, sys); await sleep(500); };
    const shot = async (name, wartMs) => { await sleep(wartMs || 500); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); console.log('Bild', name); };
    // Konsolenansicht (Canvas 640x360) ausgeschnitten: das Fenster ist 1280x720, die Konsole füllt das Canvas
    // TEC-01 Designer-Nacharbeit 2 (N1): Messpunkt Consoles.kompLayout: jede Komponente sichtbar, die gewählte voll bzw. so voll wie möglich, nichts unter der Grenze
    const layout = () => page.evaluate(() => (Consoles.kompLayout ? JSON.parse(JSON.stringify(Consoles.kompLayout)) : null));
    const pruefeLayout = async (nm, wahlErwartet) => { const L = await layout(); const alle = L && L.eintraege.length === L.folgen.length && !L.mehr;
      ok(L && alle && L.ende <= L.grenze && (wahlErwartet == null || L.wahl === wahlErwartet) && (L.wahl < 0 || L.eintraege.some((e) => e.i === L.wahl)), nm + ': jede Komponente sichtbar, Ende ' + (L && L.ende) + ' <= Grenze ' + (L && L.grenze) + ', Stufe ' + (L && L.stufe) + ', Wahl ' + (L && L.wahl) + ', Folgezeilen ' + (L && JSON.stringify(L.folgen))); };
    const modell = (sys) => page.evaluate((s) => (window.Consoles && Consoles.kompModell ? Consoles.kompModell(Client.state, s) : null), sys);

    g.ship.botAuto = false;
    const bekommen = []; const q0 = BOTS.queueRepairKomponente; BOTS.queueRepairKomponente = function (...a) { bekommen.push(a.slice(1)); return q0.apply(this, a); };   // Server-Seite: was kommt bei queueRepairKomponente an (system, mode, komp)
    await page.evaluate(() => { window.__gesendet = []; const o = Net.send.bind(Net); Net.send = (m) => { window.__gesendet.push(m); return o(m); }; });
    const gesendet = async () => { const l = await page.evaluate(() => { const r = window.__gesendet.filter((m) => m.c === 'technik.repair'); window.__gesendet = []; return r; }); return l; };
    const text = (sys) => page.evaluate((s) => { const m = Consoles.kompModell(Client.state, s); return m && { zusammenfassung: m.zusammenfassung, zeilen: m.zeilen.map((z) => [z.name, z.zustand, z.ausfall, z.bruch, z.aktion].filter(Boolean).join(' | ')) }; }, sys);
    alleHeil();
    // Szene: Generator zerstört (K und S defekt, R geflickt nach 3 Sprüngen), Emitter vorn R verschlissen defekt + L geflickt (sp 7), Emitter Steuerbord R geflickt sp 0, Emitter hinten R n 2 defekt, Emitter Backbord ok;
    // dazu Reaktor und Bug-Waffe beschädigt
    setz('shields', 'ddg', [1, 0, 2], [0, 0, 3]);
    setz('emitter_bow', 'dg', [3, 0], [0, 7]);
    setz('emitter_stbd', 'go', [1, 0], [0, 0]);
    setz('emitter_aft', 'dd', [2, 0], [0, 0]);
    g.ship.systems.reactor = 'damaged'; g.ship.systems.weapon_bow = 'damaged';
    await sitz(); await sleep(600);
    for (const [sys, nm] of [['shields', '01-generator'], ['emitter_bow', '02-emitter-verschlissen-geflickt7'], ['emitter_stbd', '03-emitter-geflickt'], ['emitter_aft', '04-emitter-defekt'], ['emitter_port', '05-emitter-heil'], ['reactor', '06-reaktor'], ['weapon_bow', '07-waffe']]) {
      await waehle(sys); await shot(nm, 300);
    }
    // Texte aus dem Client (Zeilenmodell der Konsole)
    const tg = await text('shields'); console.log('  Generator:', JSON.stringify(tg));
    ok(tg && /^Schildgenerator: zerstört – Steuerkern, Spannungsregler defekt; Relais geflickt$/.test(tg.zusammenfassung), 'Zusammenfassung Generator: ' + (tg && tg.zusammenfassung));
    ok(tg && tg.zeilen[2] === 'Relais | geflickt | Ausfälle 2/3 | bricht beim Sprung mit 60 % | Minispiel · Tausch', 'Relais geflickt, sp 3: 60 %, Ausfälle 2/3, Minispiel · Tausch: ' + (tg && tg.zeilen[2]));
    const te = await text('emitter_bow'); console.log('  Bug-Emitter:', JSON.stringify(te));
    ok(te && te.zeilen[0] === 'Relais | DEFEKT | verschlissen (3/3) | nur Flicken oder Tausch' && /bricht beim Sprung mit 100 %/.test(te.zeilen[1]) && /nur Tausch$/.test(te.zeilen[1]), 'Bug-Emitter: Relais verschlissen, Leitung sp 7 = 100 %, nur Tausch');
    ok(await text('reactor') === null && await text('weapon_bow') === null, 'Reaktor und Waffe haben kein Komponentenmodell');
    // Bedienung: Komponente wählen (←/→), Flicken/Teil senden komp
    await waehle('shields'); await gesendet();
    await page.keyboard.press('ArrowRight'); await sleep(200);   // Steuerkern
    await page.keyboard.press('ArrowRight'); await sleep(300);   // Spannungsregler
    await shot('08-generator-spannungsregler-gewaehlt', 300);
    await page.keyboard.press('KeyF'); await sleep(500);
    let m = await gesendet(); ok(m.length === 1 && m[0].system === 'shields' && m[0].mode === 'flick' && m[0].komp === 'S', 'F mit gewähltem Spannungsregler sendet komp S: ' + JSON.stringify(m));
    ok(bekommen.some((a) => a[0] === 'shields' && a[1] === 'flick' && a[2] === 'S'), 'Server: queueRepairKomponente erhält komp S (normalisiert): ' + JSON.stringify(bekommen.slice(-1)));
    await page.keyboard.press('ArrowRight'); await sleep(200);   // Relais (geflickt): Flicken geht nicht
    await page.keyboard.press('KeyF'); await sleep(500);
    m = await gesendet(); const dn = await page.evaluate(() => Render.uiDenied && Render.uiDenied.text);
    ok(m.length === 0 && /Relais ist schon geflickt/.test(dn || ''), 'Flicken am geflickten Relais: nichts gesendet, Hinweis „' + dn + '“');
    await shot('09-relais-flicken-abgelehnt', 100);
    // M1: der Ablehnkasten liegt NACH dem Pult über der Statusleiste: Pixel prüfen (Warn-Gelb #F2C94C im Streifen 18 px über der Oberkante der Statusleiste)
    const px = await page.evaluate(() => { const c = document.getElementById('game'), x = c.getContext('2d'), S = window.Pult && Pult.statusOben(Client.view); if (S == null) return null; const k = c.width / 640, y0 = Math.round((S - 18) * k), hh = Math.round(18 * k);
      const d = x.getImageData(0, y0, c.width, hh).data; let n = 0, minX = 1e9, maxX = -1; for (let i = 0; i < d.length; i += 4) { if (Math.abs(d[i] - 0xF2) < 40 && Math.abs(d[i + 1] - 0xC9) < 40 && Math.abs(d[i + 2] - 0x4C) < 60) { n++; const xx = (i / 4) % c.width; if (xx < minX) minX = xx; if (xx > maxX) maxX = xx; } } return { S, n, von: Math.round(minX / k), bis: Math.round(maxX / k) }; });
    console.log('  Pixel Ablehnkasten:', JSON.stringify(px));
    ok(px && px.n > 120 && px.von > 120 && px.bis < 520, 'M1: Warn-Gelb-Pixel des Ablehnkastens über der Statusleiste: ' + JSON.stringify(px));
    await page.keyboard.press('KeyT'); await sleep(500);
    m = await gesendet(); ok(m.length === 1 && m[0].mode === 'part' && m[0].komp === 'R', 'T (Tausch) am geflickten Relais sendet komp R: ' + JSON.stringify(m));
    await page.keyboard.press('ArrowRight'); await sleep(200);   // wieder das ganze System
    await page.keyboard.press('KeyF'); await sleep(500);
    m = await gesendet(); ok(m.length === 1 && m[0].komp === undefined, 'ohne Komponentenwahl: kein komp im Befehl: ' + JSON.stringify(m));
    // Klick auf eine Komponentenzeile wählt sie
    const kn = await page.evaluate(() => { const b = (Render.ui.buttons || []).filter((x) => x.label === '' && x.h >= 19 && x.x > 380); return b[0] ? { x: b[0].x, y: b[0].y, w: b[0].w, h: b[0].h } : null; });
    if (kn) { const box = await page.locator('#game').boundingBox(); await page.mouse.click(box.x + (kn.x + kn.w / 2) * box.width / 640, box.y + (kn.y + kn.h / 2) * box.height / 360); await sleep(300); }
    ok(await page.evaluate(() => Consoles.sel.komp.shields) === 'K', 'Klick auf die erste Komponentenzeile wählt den Steuerkern');
    await shot('10-klick-steuerkern', 100);
    await page.evaluate(() => { Consoles.sel.komp = {}; });
    // Platzprobe: Generator mit drei Schäden und alle vier Emitter beschädigt, dazu Reaktor und Waffe
    alleHeil(); g.ship.botAuto = false;
    setz('shields', 'ddd', [3, 0, 2], [0, 0, 0]);
    setz('emitter_bow', 'dg', [3, 0], [0, 7]); setz('emitter_stbd', 'gd', [2, 0], [4, 0]); setz('emitter_aft', 'dd', [1, 0], [0, 0]); setz('emitter_port', 'gg', [0, 0], [1, 2]);
    g.ship.systems.reactor = 'broken'; g.ship.systems.weapon_bow = 'damaged'; g.ship.systems.thruster_port = 'damaged';
    await sleep(600); await waehle('shields'); await shot('11-platzprobe-generator', 300); await pruefeLayout('Platzprobe 11 Generator');
    await waehle('emitter_stbd'); await shot('12-platzprobe-emitter', 300); await pruefeLayout('Platzprobe 12 Emitter');
    await waehle('reactor'); await shot('13-platzprobe-reaktor-gewaehlt', 300);
    // H2 Worst Case: alles geflickt und verschlissen (Generator ggg, Ausfälle 3/0/3, sp 7), alle Emitter beschädigt
    alleHeil(); g.ship.botAuto = false;
    setz('shields', 'ggg', [3, 0, 3], [7, 7, 7]);
    setz('emitter_bow', 'dg', [3, 0], [0, 7]); setz('emitter_stbd', 'gd', [2, 0], [4, 0]); setz('emitter_aft', 'dd', [1, 0], [0, 0]); setz('emitter_port', 'gg', [0, 0], [1, 2]);
    await sleep(600); await waehle('shields'); await shot('14-platzprobe-geflickt-verschlissen', 400); await pruefeLayout('Platzprobe 14 ggg ohne Wahl');
    for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await sleep(200); }   // K, S, dann das Relais (die dritte Komponente, im Befund unsichtbar)
    await sleep(300); await shot('14c-platzprobe-relais-gewaehlt', 300); await pruefeLayout('Platzprobe 14c Relais gewählt', 2);
    await page.keyboard.press('ArrowLeft'); await sleep(200); await pruefeLayout('Platzprobe 14d Spannungsregler gewählt', 1);
    await page.evaluate(() => { Consoles.sel.komp = {}; });
    await waehle('emitter_bow'); await shot('14b-platzprobe-emitter-ausfall-lage', 300);
  } finally {
    clearInterval(botsAus); await b.close(); await srv.close();
  }
  console.log(fehler.length ? 'Fehler:\n  ' + fehler.join('\n  ') : `${pruef} Prüfungen ok, keine Browser-Fehler`);
  console.log('Bilder in ' + SHOTS);
  process.exit(fehler.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
