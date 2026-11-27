// Sichtprüfung TEC-01 B2: Komponentenwahl an Schildkette-Stationen. Echter Server (im selben Prozess, damit Komponenten und Spielerposition gesetzt werden können) und echter Browser-Client
// (Playwright, Chromium, 2D-Ansicht oder --render voxel). Bilder: Hinweis an Schilden (Flicken K, nach Q S, Tausch mit Ersatzteil), Emitter mit verschlissenem Relais, Fortschrittsring beim Halten.
// Aufruf: node tools/sicht-komp-bedienung.js [--shots <Ordner>] [--port 3471] [--render 2d|voxel]    Exit 1 bei Browser-/Prüffehlern, 2 ohne Playwright.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3471');
const SHOTS = arg('shots', path.join(os.tmpdir(), 'tec01-b2-sicht'));
const RENDER = arg('render', '2d');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-komp-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
const WORLD = require('../server/world.js');
const I = require('../server/sim/interior.js');
const K = require('../server/sim/komponenten.js');
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
    { const e0 = g.emit.bind(g); g.emit = (nm, d) => { if (nm === 'repairDone') console.log('  [repairDone]', JSON.stringify(d)); return e0(nm, d); }; }
    const p = g.players[0];
    botsAus = setInterval(() => { g.ship.repairQueue = []; for (const bo of g.bots) if (bo.task && bo.task.kind === 'repair') bo.task = null; }, 40);   // keine Schrauber-Bots: sie würden defekte Komponenten zwischendurch reparieren (Bild und Prüfung sollen nur den Spieler zeigen)
    g.space.enemies = []; g.space.projectiles = [];
    const setz = (sys, codes) => { K.erzeugeAusZustand(g, sys); codes.split('').forEach((ch, i) => { g.ship.komp[sys][i].z = { o: 'ok', d: 'defekt', g: 'geflickt' }[ch]; }); K.synchronisieren(g, sys); };
    // Der Spieler steht NEBEN der Station (der Client bietet am eigenen Stationsfeld nichts an); erste Nachbarkachel, an der der Client einen Hinweis für das System zeigt
    const ankern = async (sys) => {
      const st = WORLD.STATIONS.find((s) => s.system === sys);
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const c = WORLD.tileCenter(st.x + dx, st.y + dy);
        Object.assign(p, { x: c.x, y: c.y, zone: 'ship', console: null, hold: null, moving: false });
        await sleep(700);
        const i = await page.evaluate(() => { const v = Client.view && Client.view.interaction; return v ? v.sys : null; });
        if (i === sys) return;
      }
      console.log('  WARNUNG: keine Nachbarkachel mit Hinweis für ' + sys);
    };
    const alleHeil = () => { for (const k of I.SYSTEM_ORDER) g.ship.systems[k] = 'ok'; g.ship.fragile = {}; g.ship.offline = {}; g.ship.repairQueue = []; I.integritaetVoll(g); K.neuAufstellen(g); };
    const shot = async (name, wartMs) => {
      await sleep(wartMs || 700);
      const crop = await page.evaluate(() => { const v = Client.view, ia = v && v.interaction; const c = document.getElementById('game'); const r = c.getBoundingClientRect(); const k = r.width / 640;
        const s = ia ? Render.worldToScreen(ia.tx * 32 + 16, ia.ty * 32 + 16, 2.1) : null; return { x: r.x, y: r.y, w: r.width, h: r.height, k, sx: s ? s.x : null, sy: s ? s.y : null }; });
      await page.screenshot({ path: path.join(SHOTS, name + '.png') });
      if (crop.sx != null) {
        const cw = 440 * crop.k, ch = 150 * crop.k;   // der Hinweis sitzt in 2D unter der Stationskachel (Kachelmitte + 34 px), in 3D darüber
        const x = Math.max(crop.x, Math.min(crop.x + crop.w - cw, crop.x + crop.sx * crop.k - cw / 2)), y = Math.max(crop.y, Math.min(crop.y + crop.h - ch, crop.y + (crop.sy - (RENDER === 'voxel' ? 90 : 20)) * crop.k));
        await page.screenshot({ path: path.join(SHOTS, name + '-nah.png'), clip: { x, y, width: cw, height: ch } });
      }
      console.log('Bild', name);
    };
    const ia = () => page.evaluate(() => { const i = Client.view && Client.view.interaction; return i ? { label: i.label, alt: i.alt && i.alt.label, alt2: i.alt2 && i.alt2.label, sys: i.sys } : null; });
    const aktion = () => page.evaluate(() => { const m = __game.state.players.find((q) => q.id === Client.pid); return m && m.action; });

    // 1) Schilde: Steuerkern und Spannungsregler defekt, Relais heil
    alleHeil(); await ankern('shields'); setz('shields', 'ddo'); await sleep(900);
    let h = await ia(); console.log('  Hinweis:', JSON.stringify(h));
    ok(h && /Flicken – Steuerkern/.test(h.label) && /kein Minispiel: Relais ist heil/.test(h.alt || '') && /Ziel wechseln \(1\/2\)/.test(h.alt2 || ''), 'Schilde K,S defekt: „halten: Flicken – Steuerkern“, Q-Zeile (1/2), Relais ohne Minispiel');
    await shot('01-schilde-flicken-steuerkern', 400);
    // 2) Q: Spannungsregler
    await page.keyboard.press('KeyQ'); await sleep(400);
    h = await ia(); ok(h && /Flicken – Spannungsregler/.test(h.label) && /\(2\/2\)/.test(h.alt2 || ''), 'Q wechselt auf Spannungsregler (2/2): ' + (h && h.label));
    await shot('02-schilde-flicken-spannungsregler', 300);
    // 3) E halten mit gewähltem Ziel: der Server flickt S, nicht K
    await page.keyboard.down('KeyE'); await sleep(700);
    const a = await aktion(); ok(a && a.kind === 'flick' && a.komp === 'S' && p.hold && p.hold.komp === 'S', 'E halten sendet komp S: Hold im Snapshot ' + JSON.stringify(a));
    await shot('03-schilde-halten-fortschritt', 100);
    await sleep(1400); await page.keyboard.up('KeyE'); await sleep(500);
    ok(K.kodiere(g, 'shields') === 'dgo', 'nach dem Halten: S geflickt, K weiter defekt (' + K.kodiere(g, 'shields') + ')');
    // 4) Rückfall: S ist nicht mehr defekt -> Ziel springt auf den Standard (K)
    await sleep(500); h = await ia(); ok(h && /Flicken – Steuerkern/.test(h.label) && !h.alt2, 'S geflickt, nicht mehr zulässig: Rückfall auf Steuerkern, keine Q-Zeile bei einem Ziel');
    await shot('04-schilde-rueckfall-steuerkern', 300);
    // 5) Tausch mit Ersatzteil in der Hand: K defekt, S geflickt -> Ziele K, S
    p.carry = 'ersatzteil'; g.inventory.ersatzteil = Math.max(2, g.inventory.ersatzteil | 0); await sleep(900);
    h = await ia(); ok(h && /Tausch – Steuerkern/.test(h.label) && /Ziel wechseln/.test(h.alt2 || ''), 'mit Ersatzteil: „halten: Tausch – Steuerkern“, Q wechselt zwischen defektem K und geflicktem S: ' + (h && h.label));
    await shot('05-schilde-tausch', 300);
    p.carry = null;
    // 6) Emitter: Relais verschlissen (n 3), Leitung heil -> Flicken des Relais, Minispiel gesperrt
    alleHeil(); await ankern('emitter_stbd'); setz('emitter_stbd', 'do'); g.ship.komp.emitter_stbd[0].n = 3; await sleep(900);
    h = await ia(); console.log('  Hinweis:', JSON.stringify(h));
    ok(h && /Flicken – Relais/.test(h.label) && /verschlissen/.test(h.alt || ''), 'Emitter, Relais defekt und verschlissen: Flicken – Relais, R-Zeile „verschlissen: nur Flicken/Tausch“');
    await shot('06-emitter-relais-verschlissen', 300);
    await page.keyboard.press('KeyR'); await sleep(800);
    ok(await page.evaluate(() => !Client.minigame), 'R bei verschlissenem Relais startet kein lokales Minispiel');
    await shot('07-emitter-r-gesperrt', 100);
    // 7) Emitter: Relais n 1 defekt -> Minispiel möglich
    alleHeil(); await ankern('emitter_port'); setz('emitter_port', 'dd'); g.ship.komp.emitter_port[0].n = 1; await sleep(900);
    h = await ia(); ok(h && /Relais reparieren \(Minispiel/.test(h.alt || '') && /Ziel wechseln \(1\/2\)/.test(h.alt2 || ''), 'Emitter R und L defekt: R-Zeile Minispiel, Q-Zeile (1/2): ' + JSON.stringify(h));
    await shot('08-emitter-minispiel-moeglich', 300);
    await page.keyboard.press('KeyR'); await sleep(900);
    ok(await page.evaluate(() => !!Client.minigame) && p.hold && p.hold.kind === 'minigame' && p.hold.komp === 'R', 'R startet das Minispiel am Relais (Hold komp R)');
    await shot('09-emitter-minispiel', 200);
    await page.keyboard.press('Escape'); await sleep(300);
    // 8) Nicht-Schildkette unverändert
    alleHeil(); await ankern('reactor'); g.ship.systems.reactor = 'damaged'; await sleep(900);
    h = await ia(); ok(h && /^halten: flicken \(/.test(h.label) && /Minispiel, dauerhaft/.test(h.alt || '') && !h.alt2, 'Reaktor beschädigt: Hinweis wie bisher (flicken, Minispiel), keine Q-Zeile: ' + JSON.stringify(h));
    await shot('10-reaktor-unveraendert', 300);
  } finally {
    clearInterval(botsAus); await b.close(); await srv.close();
  }
  console.log(fehler.length ? 'Fehler:\n  ' + fehler.join('\n  ') : `${pruef} Prüfungen ok, keine Browser-Fehler`);
  console.log('Bilder in ' + SHOTS);
  process.exit(fehler.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
