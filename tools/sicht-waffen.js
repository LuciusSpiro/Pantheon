// Sichtprüfung PAN-01 C (Waffen und Munition): je Waffenart des Katalogs vier Bilder
//   waffe-<id>-pult.png      Ziffernblock-Zellen des Ops-Pults (Ausschnitt) mit Name, Symbol, Zustand
//   waffe-<id>-taktik.png    Taktikkarte mit beschrifteten Feuerbögen (Bb und Stb verschieden bestückt)
//   waffe-<id>-projektil.png Strahl/Projektil im Flug gegen einen Gegner im Bogen
//   waffe-<id>-lafette.png   Innenansicht: Lafetten-Kachel mit dem Platzhalter der Waffe
// Dazu zielkasten.png (gescannte Korvette mit Waffen und Modulen) und – falls Fehler – eine Liste der Konsolenfehler (Net.reportError, pageerror).
// Nur Port 3355 (Standard), ROOM_CODE=off, eigene Weltordner (data/*-waffen). Aufruf:
//   node tools/sicht-waffen.js [--out <ordner>] [--waffe <id>] [--port 3355] [--ohne-projektil]
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3355');
const OUT = path.resolve(arg('out', 'C:/Users/Luciu/projects/Pantheon-gestaltung/pan01/pruefung-c'));
const NUR = arg('waffe', null);
const OHNE_PROJ = process.argv.includes('--ohne-projektil');
const DIRS = { WORLD_DIR: 'data/worlds-waffen', REGIE_DIR: 'data/regie-waffen', ERZEUGT_DIR: 'data/erzeugt-waffen' };
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden'); process.exit(2); }
const { chromium } = playwright();
const Katalog = require('../shared/schiffskatalog.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ping() { return new Promise((res) => { const r = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 800 }, (x) => { x.resume(); res(x.statusCode === 200); }); r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); }); }); }

// Hauptplatz je Platzart; Gegenseite trägt eine andere Waffe, damit Bb und Stb verschieden bestückt sind
const PLATZ = { seite: 4, bug: 8, heck: 2 };

async function main() {
  if (await ping()) throw new Error('Port ' + PORT + ' belegt');
  for (const d of Object.values(DIRS)) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const env = Object.assign({}, process.env, { PORT: String(PORT), ROOM_CODE: 'off' }, DIRS);
  delete env.LLM_LIVE; delete env.SPIELLEITER_LLM;
  const srv = spawn(process.execPath, ['server/index.js', '--debug'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100 && !(await ping()); i++) await sleep(100);
  const b = await chromium.launch();
  const fehler = [];
  try {
    const page = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') fehler.push('console: ' + m.text().slice(0, 200)); });
    await page.goto(`http://127.0.0.1:${PORT}/?debug=1&render=2d`);
    await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
    await page.evaluate(() => __game.send({ t: 'lobbyOpt', startMission: 'free', skipDrill: true }));
    await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await page.mouse.move(5, 5);
    const sitz = (c) => page.evaluate((cc) => __game.send({ t: 'debug', cmd: 'sitz', console: cc }), c);
    const dbg = (args) => page.evaluate((a) => __game.send({ t: 'debug', cmd: a.split(' ')[0], args: a.split(' ').slice(1).join(' ') }), args);
    const cmd = (c, extra) => page.evaluate(([cc, ex]) => __game.send(Object.assign({ t: 'cmd', c: cc }, ex || {})), [c, extra]);
    const ship = () => page.evaluate(() => { const s = __game.state.ship || {}; return { x: s.x, y: s.y, angle: s.angle, speed: s.speed, docked: s.docked, st: s.st, mounts: s.mounts }; });
    // Leinwand-Ausschnitt (Koordinaten der 640×360-Spielfläche) -> Seitenpixel
    const clip = async (x, y, w, h) => {
      const r = await page.evaluate(() => { const c = document.getElementById('game').getBoundingClientRect(); return { l: c.left, t: c.top, w: c.width, h: c.height }; });
      const sx = r.w / 640, sy = r.h / 360;
      return { x: Math.round(r.l + x * sx), y: Math.round(r.t + y * sy), width: Math.round(w * sx), height: Math.round(h * sy) };
    };
    const shot = async (name, rect) => { await page.screenshot({ path: path.join(OUT, name), clip: rect ? await clip(...rect) : undefined }); console.log('Bild', name); };

    // ---- ablegen, anhalten, Stufe 3 (alle neun Plätze offen), Torpedos voll, unverwundbar
    await sitz('helm'); await sleep(600);
    for (let i = 0; i < 3; i++) await cmd('helm.throttle', { delta: 1 });
    await page.waitForFunction(() => { const s = __game.state.ship || {}; return !s.docked && !s.dockedAt; }, null, { timeout: 20000 }).catch(() => console.log('noch angedockt'));
    await sleep(2500);
    await cmd('helm.stop');
    await page.waitForFunction(() => { const s = __game.state.ship || {}; return (s.speed || 0) < 1.5; }, null, { timeout: 30000 }).catch(() => console.log('fährt noch'));
    await page.evaluate(() => __game.send({ t: 'debug', cmd: 'god', on: true }));
    await dbg('inv'); await page.evaluate(() => __game.send({ t: 'debug', cmd: 'inv', item: 'bolzen', n: 12 }));
    await dbg('bestueck alle 3'); await sleep(400);

    const waffen = Katalog.WAFFEN.filter((w) => !NUR || w.id === NUR);
    for (const w of waffen) {
      const platz = PLATZ[w.platzart];
      console.log('=== ' + w.id + ' (Platz ' + platz + ')');
      await dbg('bestueck alle 3'); await sleep(250);
      await dbg(`bestueck ${platz} ${w.id}`);
      // Bb und Stb verschieden: Seitenwaffe auf 4, Gegenstück auf 6; sonst Sturm links, Streu rechts
      if (w.platzart === 'seite') await dbg(`bestueck 6 ${w.id === 'streubatterie' ? 'sturmbatterie' : 'streubatterie'}`);
      else { await dbg('bestueck 4 sturmbatterie'); await dbg('bestueck 6 streubatterie'); }
      await sleep(500);
      const mid = Katalog.MOUNT_ID[platz];
      // alle Ladepunkte auf die Waffe: erst die anderen abziehen, dann +4
      const st0 = await ship();
      const andere = (st0.mounts || []).filter((m) => m.id !== mid && m.alloc !== undefined);
      for (let k = 0; k < 4; k++) for (const m of andere) await cmd('weapons.alloc', { mount: m.id, delta: -1 });
      if (w.energie) for (let k = 0; k < 4; k++) await cmd('weapons.alloc', { mount: mid, delta: 1 });
      // Gegner im Bogen (Weltwinkel = Schiffswinkel + Bogenmitte), als Ziel wählen
      const dist = w.id === 'abwehrturm' ? 150 : w.platzart === 'bug' ? 380 : w.platzart === 'heck' ? 300 : 215;
      const art = w.id === 'abwehrturm' ? 'raider' : 'korvette';
      const facing = (w.platzart === 'seite' ? -90 : w.platzart === 'heck' ? 180 : 0) * Math.PI / 180;
      await page.evaluate(([k, d, f]) => { const s = __game.state.ship; __game.send({ t: 'debug', cmd: 'spawn', kind: k, volk: 'ger', dist: d, winkel: s.angle + f }); }, [art, dist, facing]);
      await sleep(900);
      const zid = await page.evaluate(() => { const l = (__game.state.space.enemies || []).slice(); const s = __game.state.ship; l.sort((p, q) => Math.hypot(p.x - s.x, p.y - s.y) - Math.hypot(q.x - s.x, q.y - s.y)); return l[0] ? l[0].id : null; });
      if (zid) await cmd('weapons.target', { id: zid });
      await sitz('weapons'); await sleep(400);
      await page.mouse.move(5, 5);
      // Ladung abwarten (Energiewaffen)
      if (w.energie) await page.waitForFunction((id) => { const m = (__game.state.ship.mounts || []).find((q) => q.id === id); return m && m.charge >= 1; }, mid, { timeout: 25000 }).catch(() => console.log('Ladung nicht voll: ' + w.id));
      await sleep(300);
      // (a) Pult-Zellen, (b) Taktik
      await shot(`waffe-${w.id}-pult.png`, [60, 212, 222, 112]);
      await page.evaluate(() => { Consoles.zoom.weapons = 0.25; });   // alle Bögen im Bild
      await sleep(250);
      await shot(`waffe-${w.id}-taktik.png`, [62, 6, 404, 184]);
      await page.evaluate(() => { Consoles.zoom.weapons = 0.35; });
      // (c) Feuern und Flug einfangen: bestes Bild (meiste Strahlen/Projektile)
      if (!OHNE_PROJ) {
        if (w.art === 'lanze') { await cmd('weapons.charge', { mount: mid, on: true }); await sleep(2600); await cmd('weapons.charge', { mount: mid, on: false }); }
        else await cmd('weapons.fire', { mount: mid });
        let best = -1, bestBuf = null;
        for (let i = 0; i < 18; i++) {
          const n = await page.evaluate(() => { const sp = __game.state.space || {}; return (sp.beams || []).length * 2 + (sp.projectiles || []).length; });
          const buf = await page.screenshot({ clip: await clip(62, 6, 404, 184) });
          if (n > best) { best = n; bestBuf = buf; }
          if (i > 5 && best > 0 && n === 0) break;
          await sleep(60);
        }
        fs.writeFileSync(path.join(OUT, `waffe-${w.id}-projektil.png`), bestBuf);
        console.log('Bild', `waffe-${w.id}-projektil.png`, '(Strahlen/Projektile im besten Bild: ' + best + ')');
      }
      // (d) Innenansicht: Spieler an die Lafette des Platzes stellen
      const tp = await page.evaluate(([p]) => {
        const M = window.Shared_Maps, pl = M.waffenplatz(p); if (!pl) return null;
        const solid = M.shipSolidFn(3), walk = (x, y) => !solid(x, y);
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1]]) if (walk(pl.x + dx, pl.y + dy)) return { x: pl.x + dx, y: pl.y + dy, lx: pl.x, ly: pl.y };
        return { x: pl.x, y: pl.y, lx: pl.x, ly: pl.y };
      }, [platz]);
      if (tp) {
        await dbg(`tp ${tp.x} ${tp.y}`); await sleep(900);
        await shot(`waffe-${w.id}-lafette.png`, null);
      }
      await sleep(200);
      // Weg mit dem Gegner (nächste Waffe, frische Lage): Szene neu laden ist unnötig, Gegner sind harmlos (god)
    }
    // ---- Zielkasten: Korvette mit Bug lanzenbatterie? (Katalog-Id), gescannt
    await dbg('bestueck alle 3'); await sleep(300);
    await sitz('weapons'); await sleep(400);
    await page.evaluate(() => { const s = __game.state.ship; __game.send({ t: 'debug', cmd: 'spawn', kind: 'fregatte', volk: 'ger', dist: 330, winkel: s.angle - 0.5, waffen: { bug: 'torpedowerfer', stbd1: 'sturmbatterie', stbd2: 'streubatterie', bb1: 'lanze', bb2: 'batterie' } }); });
    await sleep(900);
    await page.evaluate(() => __game.send({ t: 'debug', cmd: 'scanall' }));
    await sleep(700);
    await page.keyboard.press('KeyT'); await sleep(500);
    await shot('zielkasten.png', [466, 6, 168, 184]);
    await shot('pult-ops-gesamt.png', null);
    await page.mouse.move(5, 5);
    const err = await page.evaluate(() => { const G = window.__game; return G && G.errorLog ? G.errorLog.map((e) => e.label + ': ' + e.msg) : []; });
    for (const e of err) fehler.push('Net.reportError ' + e);
  } finally {
    await b.close(); srv.kill();
    if (fehler.length) console.log('Fehler:\n' + [...new Set(fehler)].slice(0, 25).join('\n')); else console.log('keine Konsolenfehler');
    const se = log.split('\n').filter((l) => /Error|clientError|Fehler in/.test(l)); if (se.length) console.log('Server:\n' + se.slice(0, 10).join('\n'));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
