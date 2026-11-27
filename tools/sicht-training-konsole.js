// Sichtprüfung TRA-01 C2: die Trainingsliste (Checkliste + Hänger-Hinweis) an der Konsole, in beiden Renderern (2D und Voxel-Sitz).
// Echter Server im selben Prozess, echter Chromium-Client (Playwright, Software-GL: Voxel ist langsam). Der Spielzustand wird nur zum Vorspulen berührt (Schrittzeit, Konsolen-Sitz);
// die Anzeige kommt aus dem echten Client. Je Lauf: Training starten, am Steuer fliegen (erstes Ziel abgehakt), dann
//   steuer   Steuer (helm)           Bilder: <render>-steuer-liste, <render>-steuer-hinweis (ODA-Hinweis des Schritts)
//   captain  Captain-Konsole         Bild:   <render>-captain-liste
//   ops      Ops/Waffen (weapons)    Bild:   <render>-ops-liste
//   zufuss   Konsole verlassen       Bild:   <render>-zufuss (Checkliste des HUD, die Trainingsliste darf nicht doppelt stehen)
//   abschluss (nur 2d, Fliegen)      TRA-01 Nacharbeit S3: Training geschafft (Server-Flag trainingFertig, danach läuft der echte Abschluss: Abzeichen, Buch zu, Neustart nach 8 s): Bilder abschluss-steuer, abschluss-captain-funk, abschluss-zufuss (Liste mit Haken und „Neustart in N s“, kein „Frei erkunden“, keine Marken/Entdeckungen)
//   Captain, Sternkarte: zusätzlich sternkarte-untertitel (Bot-Untertitel „NAVIGATION: …“ darf „SEKTOR …“ nicht überdecken; S6)
// Im Voxel-Sitz je Blick: vorn (Hauptschirm, Standard) und pult (Rad nach unten).
// Aufruf: node tools/sicht-training-konsole.js [--render 2d|voxel|beide] [--buch fliegen|captain] [--shots <Ordner>] [--port 3611] [--nur steuer,captain]
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT0 = +arg('port', '3611');
const SHOTS = path.resolve(arg('shots', path.join(os.tmpdir(), 'tra01-c2-shots')));
const RENDER = arg('render', 'beide');
const BUCH = arg('buch', 'fliegen');
const NUR = arg('nur', 'steuer,captain,ops,zufuss,abschluss').split(',');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sicht-tra01c2-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
const Interior = require('../server/sim/interior.js');
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE setzen)'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fehler = [];

async function lauf(render, port) {
  const voxel = render === 'voxel';
  let hinweisEcht = false;
  const srv = await startServer({ port, debug: true, roomCode: 'off', quiet: true, worlds: false, worldDir: path.join(TMP, 'worlds-' + render) });
  const g = srv.game;
  const b = await chromium.launch(voxel ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {});
  try {
    const page = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    page.on('pageerror', (e) => fehler.push(render + ' pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) fehler.push(render + ' console: ' + m.text().slice(0, 200)); });
    await page.goto(`http://127.0.0.1:${port}/?debug=1&render=${voxel ? 'voxel' : '2d'}`);
    await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
    const shot = async (name, wartMs) => { await sleep(wartMs || 800); await page.screenshot({ path: path.join(SHOTS, render + '-' + name + '.png') }); console.log('Bild', render + '-' + name); };
    const send = (o) => page.evaluate((m) => __game.send(m), o);
    await send({ t: 'lobbyOpt', startMission: 'training_' + BUCH }); await send({ t: 'ready', ready: true });
    await page.waitForFunction(() => __game.state && __game.state.phase === 'play', null, { timeout: 30000 });
    if (voxel) await page.waitForFunction(() => window.VoxelRender && VoxelRender.ready, null, { timeout: 60000 });
    const p = g.players[0];
    await sleep(1500);
    console.log(render, 'Schritt', g.mission.state.stage, 'Ziele', g.mission.state.objectives.length);
    // erstes Ziel (Ablegen) am Steuer erfüllen
    Interior.enterConsole(g, p, 'helm');
    if (BUCH === 'fliegen') {
      await send({ t: 'cmd', c: 'helm.throttle', delta: 1 }); await send({ t: 'cmd', c: 'helm.throttle', set: 4 });
      for (let i = 0; i < 600 && g.mission.state.stage === 'a_hoch'; i++) await sleep(100);
      await send({ t: 'cmd', c: 'helm.stop' });
      console.log(render, 'Schritt nach Ablegen:', g.mission.state.stage);
    }
    const blick = async (name) => {   // Voxel: Blick wechseln (Rad nach unten = Pult, nach oben = Hauptschirm)
      if (!voxel) return;
      await page.mouse.move(640, 300); await sleep(200);
      if (name === 'pult') { await page.mouse.wheel(0, 100); await sleep(1800); } else { await page.mouse.wheel(0, -100); await sleep(1500); }
      console.log(render, 'Blick', await page.evaluate(() => (window.Sitz ? Sitz.blick : '-')));
    };
    const anSitz = async (con) => { Interior.konsoleVerlassen(g, p, 'sicht'); await sleep(300); Interior.enterConsole(g, p, con); await sleep(voxel ? 2500 : 800); };
    const blicke = voxel ? ['vorn', 'pult'] : ['pult'];
    for (const [key, con] of [['steuer', 'helm'], ['captain', 'captain'], ['ops', 'weapons']]) {
      if (!NUR.includes(key)) continue;
      await anSitz(con);
      for (const bl of blicke) {
        await blick(bl);
        const suffix = voxel ? '-' + bl : '';
        await shot(key + '-liste' + suffix, 900);
        if (key === 'captain' && bl === 'pult') {   // die Reiter der Captain-Konsole: Sternkarte (kompakter Streifen), Lage, Sektorplan, Aufträge (volle Liste)
          for (const [taste, name] of [['2', 'sternkarte'], ['3', 'lage'], ['5', 'sektorplan'], ['6', 'auftraege']]) { await page.keyboard.press(taste); await shot(key + '-' + name + suffix, 700);
            if (name === 'sternkarte' && BUCH === 'captain') {   // S6: ein Bot-Untertitel (Ablehnung kein_ziel der Sprungtaste) steht neben „SEKTOR …“, nicht darauf
              await send({ t: 'bot.befehl', an: 'navigation', befehl: 'nav.sprung', args: { ziel: 'marke' }, quelle: 'taste' });
              await shot(key + '-sternkarte-untertitel' + suffix, 500);
            } }
          await page.keyboard.press('1'); await sleep(300);
        }
        if (key === 'steuer' && BUCH === 'fliegen') {
          // Der Hänger-Hinweis des Schritts feuert nur einmal (45 s nach Schrittstart, vorgespult): beim ersten Blick echt vom Server, danach spielt der Client dieselbe ODA-Zeile nach (Hud.pushOda, derselbe Weg)
          const hinweis = g.mission.def.texte['hinweis.runter'];
          const warte = (t) => page.waitForFunction((x) => window.Hud && Hud.oda.cur && Hud.oda.cur.text === x && Hud.oda.cur.shown >= x.length, t, { timeout: 90000 }).catch(() => console.log('Hinweis nicht erschienen'));
          if (!hinweisEcht) { hinweisEcht = true; g.mission.stepTime = 44.3; } else await page.evaluate((t) => Hud.pushOda(t), hinweis);
          await warte(hinweis);
          await shot(key + '-hinweis' + suffix, 300);
          if (voxel && bl === 'vorn') {   // die ODA verschwindet: dann steht der Hinweis in der Liste (nicht doppelt, aber auch nicht weg)
            await page.waitForFunction(() => window.Hud && !Hud.oda.cur, null, { timeout: 90000 }).catch(() => console.log('ODA blieb stehen'));
            await shot(key + '-hinweis-nach-oda' + suffix, 400);
          }
        }
      }
      if (voxel) await blick('vorn');
    }
    if (NUR.includes('zufuss')) { Interior.konsoleVerlassen(g, p, 'sicht'); await sleep(voxel ? 2500 : 900); await shot('zufuss', 700); }
    if (NUR.includes('abschluss') && !voxel && BUCH === 'fliegen') {   // S3: echter Abschluss; die Bilder müssen innerhalb der 8 s bis zum Neustart fallen
      await anSitz('helm');
      await page.evaluate(() => { window.__ab = []; const o = TrainingHud.abschluss; TrainingHud.abschluss = (ev) => { window.__ab.push(JSON.stringify(ev)); return o(ev); }; });   // DEBUG
      console.log('vor Abschluss:', JSON.stringify(await page.evaluate(() => { const m = __game.state.mission; return { aktiv: m.active && m.active.id, istT: TrainingHud.istTraining(m), q: Hud.zieleVon(__game.state).title, laeuft: TrainingHud.laeuft(__game.state) }; })));
      g.mission.flags.trainingFertig = true;
      await sleep(1200);
      await shot('abschluss-steuer', 100);
      const lg = await page.evaluate(() => ({ laeuft: window.TrainingHud.laeuft(__game.state), aktiv: __game.state.mission.active && __game.state.mission.active.id, ziele: Hud.zieleVon(__game.state), ab: window.__ab }));
      console.log(render, 'Abschluss im Client:', JSON.stringify(lg).slice(0, 400));
      if (!lg.laeuft) fehler.push(render + ': nach dem Abschluss kennt der Client das Training nicht mehr (Liste weg)');
      await anSitz('captain'); await page.keyboard.press('1'); await sleep(200); await shot('abschluss-captain-funk', 100);
      Interior.konsoleVerlassen(g, p, 'sicht'); await sleep(500); await shot('abschluss-zufuss', 100);
      console.log(render, 'Abschluss-Stand: Neustart-Versuch', g.arena.training.versuch, 'Zeit seit Erfolg', (g.time - g.arena.training.erfolgAb).toFixed(1), 's');
    }
    console.log(render, 'g.errors', g.errors);
  } finally { await b.close(); await srv.close(); }
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const modi = RENDER === 'beide' ? ['2d', 'voxel'] : [RENDER];
  let i = 0;
  for (const m of modi) await lauf(m, PORT0 + i++);
  console.log(fehler.length ? 'Browser-Fehler:\n  ' + fehler.join('\n  ') : 'keine Browser-Fehler');
  console.log('Bilder in ' + SHOTS);
  process.exit(fehler.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
