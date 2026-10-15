// Prüft im echten Browser, ob die Konsolentasten den erwarteten Befehl an den Server schicken – in 2D (flache Konsole)
// und im Ego-Sitz (Voxel, Blick VORN, Knöpfe verdeckt). Protokolliert je Taste die gesendeten Befehle und Sperrmeldungen.
// Aufruf: node tools/sicht-tasten.js [--port 3452]   (Exit 1, wenn eine Taste mit Erwartung keinen passenden Befehl schickt)
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3452');
const DIRS = { WORLD_DIR: 'data/worlds-tasten', REGIE_DIR: 'data/regie-tasten', ERZEUGT_DIR: 'data/erzeugt-tasten' };
function playwright() {
  for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'C:/tmp/pwtest/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } }
  console.error('playwright-core nicht gefunden'); process.exit(2);
}
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ping() { return new Promise((res) => { const r = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 800 }, (x) => { x.resume(); res(x.statusCode === 200); }); r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); }); }); }

// [Taste, erwarteter Befehl (Präfix) oder null = nur protokollieren, Haltezeit ms, Wartezeit danach ms]
const PLAN = {
  helm: [['KeyW', 'helm.throttle'], ['KeyW', 'helm.throttle', 0, 2500], ['Shift+KeyA', 'helm.dodge', 0, 8000], ['Shift+KeyD', 'helm.dodge'], ['KeyS', 'helm.throttle'],
    ['KeyA', 'helm.input', 400], ['KeyD', 'helm.input', 400], ['KeyX', 'helm.stop'], ['KeyG', null], ['KeyF', null], ['KeyN', null]],
  weapons: [['KeyT', null], ['Numpad8', 'weapons.charge', 600], ['Digit8', 'weapons.charge', 600], ['Numpad4', 'weapons.fire'], ['Numpad6', 'weapons.fire'], ['Digit4', 'weapons.fire'], ['Numpad1', null], ['Space', null], ['KeyE', null], ['KeyA', 'weapons.alloc'], ['KeyD', 'weapons.alloc'],
    ['KeyS', null], ['KeyW', 'weapons.widescan'], ['KeyZ', null], ['KeyX', null], ['KeyO', null]],
  technik: [['ArrowDown', null], ['ArrowRight', 'technik.'], ['ArrowLeft', 'technik.'], ['KeyA', 'technik.'], ['KeyU', null]],
  captain: [['Digit2', null], ['Digit3', null], ['Digit5', null], ['Digit1', null]],
};

async function main() {
  if (await ping()) throw new Error('Port ' + PORT + ' belegt');
  for (const d of Object.values(DIRS)) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
  const env = Object.assign({}, process.env, { PORT: String(PORT), ROOM_CODE: 'off' }, DIRS);
  delete env.LLM_LIVE; delete env.SPIELLEITER_LLM;
  const srv = spawn(process.execPath, ['server/index.js', '--debug'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 100 && !(await ping()); i++) await sleep(100);
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let fehlt = 0;
  try {
    for (const modus of ['2d', 'sitz']) {
      const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await ctx.newPage();
      const errs = []; page.on('pageerror', (e) => errs.push(e.message));
      await page.addInitScript(() => {
        window.__out = []; window.__deny = [];
        const orig = WebSocket.prototype.send;
        WebSocket.prototype.send = function (d) { try { const m = JSON.parse(d); if (m && m.t !== 'ping' && m.t !== 'input') window.__out.push(m.t === 'cmd' ? m.c : m.t); } catch (e) { /* binär */ } return orig.call(this, d); };
      });
      await page.goto(`http://127.0.0.1:${PORT}/?debug=1&render=${modus === 'sitz' ? 'voxel' : '2d'}`);
      await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
      await page.evaluate(() => { const d = Consoles.denied.bind(Consoles); Consoles.denied = (r) => { window.__deny.push(r); return d(r); }; });
      if (modus === 'sitz') await page.evaluate(() => __game.send({ t: 'lobbyOpt', startMission: 'free', skipDrill: true }));
      await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
      await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
      if (modus === 'sitz') await page.waitForFunction(() => window.VoxelRender && VoxelRender.ready, null, { timeout: 30000 });
      await page.mouse.move(640, 300);
      console.log(`\n== ${modus === 'sitz' ? 'Ego-Sitz (Voxel, Blick vorn)' : '2D (flache Konsole)'} ==`);
      for (const [station, plan] of Object.entries(PLAN)) {
        if (modus === 'sitz' && station === 'technik') continue;   // Technik hat keinen Sitz
        await page.evaluate((s) => __game.send({ t: 'debug', cmd: 'sitz', console: s, hin: true }), station);
        await sleep(1200);
        const blick = modus === 'sitz' ? await page.evaluate(() => window.Sitz && Sitz.station ? Sitz.blick : '-') : '-';
        console.log(`-- ${station}${modus === 'sitz' ? ' (Blick: ' + blick + ')' : ''}`);
        for (const [key, want, hold = 0, after = 600] of plan) {
          await page.evaluate(() => { window.__out.length = 0; window.__deny.length = 0; });
          const [mod, k] = key.includes('+') ? key.split('+') : [null, key];
          if (mod) await page.keyboard.down(mod);
          await page.keyboard.down(k); await sleep(hold || 60); await page.keyboard.up(k);
          if (mod) await page.keyboard.up(mod);
          await sleep(after);
          const { out, deny } = await page.evaluate(() => ({ out: window.__out.slice(), deny: window.__deny.slice() }));
          const ok = !want || out.some((c) => String(c).startsWith(want)) || (deny.length > 0 && !/^Keine Waffe auf Platz/.test(deny[0]));   // Sperrmeldung = Taste kam an, Spiel lehnt begründet ab
          if (!ok) fehlt++;
          console.log(`   ${ok ? (want ? 'ok   ' : 'info ') : 'FEHLT'} ${key.padEnd(11)} → ${out.length ? [...new Set(out)].join(', ') : '(kein Befehl)'}${deny.length ? '  · gesperrt: ' + deny[0] : ''}${want && !ok ? '  · erwartet ' + want : ''}`);
        }
      }
      // Umbelegung: Allstopp X -> K (Menü „Steuerung“), dann muss K wirken und X nicht mehr
      await page.evaluate((s) => __game.send({ t: 'debug', cmd: 'sitz', console: s, hin: true }), 'helm'); await sleep(800);
      await page.evaluate(() => Tasten.setze('steuer.allstopp', 0, 'KeyK'));
      for (const [key, want] of [['KeyK', 'helm.stop'], ['KeyX', null]]) {
        await page.evaluate(() => { window.__out.length = 0; window.__deny.length = 0; });
        await page.keyboard.press(key); await sleep(500);
        const out = await page.evaluate(() => window.__out.slice());
        const ok = want ? out.includes(want) : !out.includes('helm.stop');
        if (!ok) fehlt++;
        console.log(`   ${ok ? 'ok   ' : 'FEHLT'} umbelegt ${key.padEnd(6)} → ${out.length ? [...new Set(out)].join(', ') : '(kein Befehl)'}${want ? '' : '  · erwartet: kein Allstopp'}`);
      }
      await page.evaluate(() => Tasten.zuruecksetzen('steuer.allstopp'));
      await page.evaluate(() => __game.send({ t: 'leave' }));
      if (errs.length) console.log('   Seitenfehler: ' + errs.slice(0, 3).join(' | '));
      await ctx.close();
    }
  } finally { await b.close(); srv.kill(); }
  console.log(fehlt ? `\n${fehlt} Taste(n) ohne erwarteten Befehl.` : '\nAlle erwarteten Befehle kamen an.');
  process.exit(fehlt ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
