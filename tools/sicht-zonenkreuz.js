// Sichtprüfung SYS-01 A1c „Zonenkreuz“ im laufenden Spiel (Server + Chromium): Technik (Schadensplan), Steuer, Ops, Captain in beiden Skins,
// Zustände: voll, beschädigt, Zone leer (Bresche, Mitte offen), Reaktor zerstört, Modul zerstört, Gegnerziel aktiv. Die Browser-Konsole muss ohne Fehler bleiben.
// Bilder nach --shots <Ordner> (Standard shots/zonenkreuz): <skin>-<zustand>-<station>.png. Nur Port 3455, ROOM_CODE=off, eigene Weltordner.
// Aufruf: node tools/sicht-zonenkreuz.js [--shots <Ordner>] [--port 3455]   Exit 1 bei Konsolen-/Seitenfehlern, 2 ohne Playwright.
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3455');
const SHOTS = path.resolve(ROOT, arg('shots', 'shots/zonenkreuz'));
const DIRS = { WORLD_DIR: 'data/worlds-zk', REGIE_DIR: 'data/regie-zk', ERZEUGT_DIR: 'data/erzeugt-zk' };
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.log('Playwright fehlt'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ping() { return new Promise((res) => { const r = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 800 }, (x) => { x.resume(); res(x.statusCode === 200); }); r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); }); }); }

// Zustände (Debug-Befehl damage <system> <ok|damaged|broken>); Zonen: Bb = emitter_port, battery_port, thruster_port, lafette_7, lafette_1
const ALLE = ['reactor', 'engines', 'shields', 'transfer', 'thruster_port', 'thruster_stbd', 'emitter_bow', 'emitter_stbd', 'emitter_aft', 'emitter_port', 'weapon_bow', 'battery_port', 'battery_stbd', 'lafette_5', 'lafette_7', 'lafette_9', 'lafette_1', 'lafette_3', 'lafette_2', 'modul_1', 'modul_2', 'modul_3', 'modul_4'];
const BB = ['emitter_port', 'battery_port', 'thruster_port', 'lafette_7', 'lafette_1'];
const SZENEN = [
  { id: '1-voll', text: 'alles heil', set: {} },
  { id: '2-beschaedigt', text: 'beschädigt: Bb-Düse, Stb-Batterie, Antrieb; Stb-Emitter zerstört', set: { thruster_port: 'damaged', battery_stbd: 'damaged', engines: 'damaged', emitter_stbd: 'broken' } },
  { id: '3-zone-leer', text: 'Bb leer: Bresche, Mitte offen', set: Object.fromEntries(BB.map((k) => [k, 'broken'])) },
  { id: '4-reaktor', text: 'Reaktor zerstört (und Bb leer)', set: Object.assign(Object.fromEntries(BB.map((k) => [k, 'broken'])), { reactor: 'broken' }) },
  { id: '5-modul', text: 'Modul 1 zerstört, Modul 2 beschädigt', set: { modul_1: 'broken', modul_2: 'damaged', emitter_bow: 'damaged' } },
  { id: '6-gegnerziel', text: 'Gegner zielt auf den Antrieb', set: { thruster_port: 'damaged' }, ziel: true },
  // SYS-01 A2b: Banderole (Countdown 2. Ausfall, Rest 6,4 s, eingefroren über die Solo-Pause) und Einblendung nach dem Tod (letzter Zustand: Eingabe gesperrt)
  { id: '7-countdown', text: 'Countdown läuft (Ausfall 2, 6,4 s)', set: {}, countdown: true },
  { id: '8-zerstoert', text: 'Schiff zerstört (Einblendung)', set: {}, zerstoert: true },
];

async function main() {
  if (await ping()) throw new Error('Port ' + PORT + ' belegt');
  for (const d of Object.values(DIRS)) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const env = Object.assign({}, process.env, { PORT: String(PORT), ROOM_CODE: 'off' }, DIRS);
  delete env.LLM_LIVE; delete env.SPIELLEITER_LLM;
  const srv = spawn(process.execPath, ['server/index.js', '--debug'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100 && !(await ping()); i++) await sleep(100);
  const b = await chromium.launch();
  const fehler = [];
  let status = 0;
  try {
    const page = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') fehler.push('console: ' + m.text().slice(0, 240)); });
    await page.goto(`http://127.0.0.1:${PORT}/?debug=1&render=2d`);
    await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
    await page.evaluate(() => __game.send({ t: 'lobbyOpt', startMission: 'free', skipDrill: true }));
    await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await page.mouse.move(5, 5);
    const sitz = (c) => page.evaluate((cc) => __game.send({ t: 'debug', cmd: 'sitz', console: cc }), c);
    const damage = (system, state) => page.evaluate(([s, st]) => __game.send({ t: 'debug', cmd: 'damage', system: s, state: st }), [system, state]);
    const damageCd = (system, state) => page.evaluate(([s, st]) => __game.send({ t: 'debug', cmd: 'damage', system: s, state: st, countdown: true }), [system, state]);   // mit Reaktor-Countdown (A2b)
    await sitz('helm'); await sleep(600);
    for (let i = 0; i < 3; i++) await page.evaluate(() => __game.send({ t: 'cmd', c: 'helm.throttle', delta: 1 }));
    await page.waitForFunction(() => { const s = __game.state.ship || {}; return !s.docked && !s.dockedAt; }, null, { timeout: 15000 }).catch(() => console.log('noch angedockt'));
    await sleep(2500);
    // ein Gegner in Sicht (Karte), nicht schießend genug, um das Bild zu verändern: Schilde und Schäden setzen wir danach selbst
    await page.evaluate(() => __game.send({ t: 'debug', cmd: 'spawn', kind: 'fregatte', volk: 'ger' }));
    await sleep(1500);
    let zielAn = false;
    for (const sz of SZENEN) {
      if (!sz.zerstoert) for (const k of ALLE) await damage(k, 'ok');
      for (const [k, v] of Object.entries(sz.set)) await damage(k, v);
      if (sz.countdown) {   // 1. Ausfall, Reparatur (Countdown aus), 2. Ausfall: n = 2, Dauer 10 s; nach 3,6 s steht die Solo-Pause den Rest bei 6,4 s
        await damageCd('reactor', 'broken'); await sleep(500);
        await damage('reactor', 'ok'); await sleep(300);
        await damageCd('reactor', 'broken'); await sleep(3600);
        await page.evaluate(() => __game.send({ t: 'menu', op: 'pause', on: true })); await sleep(400);
      }
      if (sz.zerstoert) {   // Pause lösen, der Countdown läuft ab, Einblendung abwarten
        await page.evaluate(() => __game.send({ t: 'menu', op: 'pause', on: false }));
        const t0 = Date.now();
        while (!(await page.evaluate(() => !!(__game.state.ship.reaktorTod && __game.state.ship.reaktorTod.tot))) && Date.now() - t0 < 40000) await sleep(200);
        await sleep(400);
      }
      if (sz.ziel && !zielAn) {
        await page.evaluate(() => __game.send({ t: 'debug', cmd: 'zielsysteme', args: 'an' }));
        await page.evaluate(() => __game.send({ t: 'debug', cmd: 'verfolgung', args: 'korvette' }));
        zielAn = true; await sleep(1200);
      }
      await sleep(500);
      const snap = await page.evaluate(() => { const s = __game.state.ship; return { zonen: s.zonen, zielAuf: s.zielAuf, reaktor: s.systems.reactor, reaktorTod: s.reaktorTod }; });
      console.log(sz.id, sz.text, JSON.stringify(snap));
      for (const skin of ['rom', 'germanen']) {
        await page.evaluate((s) => { try { localStorage.setItem('pantheon.pult', s); } catch (e) { /* egal */ } }, skin);
        for (const st of ['technik', 'helm', 'weapons', 'captain']) {
          await sitz(st); await sleep(700);
          if (st === 'technik') { await page.evaluate(() => { if (window.Consoles) Consoles.ttab = 1; }); await page.mouse.move(5, 5); await sleep(300); }
          if (st === 'weapons') { await page.keyboard.press('KeyT'); await sleep(250); }
          const f = path.join(SHOTS, `${skin}-${sz.id}-${st}.png`);
          await page.screenshot({ path: f });
        }
        console.log('Bilder', skin, sz.id);
      }
    }
    // HUD-Felder (Bord oben rechts und das schmale LERCHE-Panel der Außenansicht): jeder Rang, schlimmster Text; der Text darf das Panel nie verlassen
    const hud = await page.evaluate(() => {
      const R = window.Render, H = window.Hud, out = { grenzen: [], bild: null };
      const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360; const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#10151F'; ctx.fillRect(0, 0, 640, 360);
      const zonen = (a) => ({ systems: { reactor: 'ok' }, zonen: a });
      const faelle = [['voll', zonen([100, 100, 100, 100])], ['Heck 100% knapp', zonen([100, 100, 99, 100])], ['Stb 63', zonen([100, 63, 100, 100])], ['BB 5', zonen([100, 100, 100, 5])], ['Mitte offen', zonen([100, 100, 100, 0])], ['Reaktor', { systems: { reactor: 'broken' }, zonen: [100, 100, 100, 0] }], ['ohne', {}]];
      faelle.forEach(([name, ship], i) => {
        const y = 6 + i * 50;
        // Bord: Panel x0-4 .. x0+114 (x0 = 640 - 116), Zeile ab x0+14; Außen: x0 = 640 - 116, Zeile ab x0, rechts bis x0+82 (davor die Schildanzeige bei x0+84)
        const x0 = 640 - 7 * 16 - 4;
        ctx.fillStyle = '#0B0E1A'; ctx.fillRect(x0 - 4, y, 118, 22); H.zonenAnzeige(ctx, x0 + 14, y + 6, 98, ship);
        const xa = 640 - 116; ctx.fillStyle = '#0B0E1A'; ctx.fillRect(xa - 4, y + 24, 118, 22); H.zonenAnzeige(ctx, xa, y + 28, 80, ship);
        R.text(ctx, name, 8, y + 10, { color: '#8EA3B5' });
        const sf = window.PultSysteme.statusFeld(ship), tw = R.measure(sf.text, 1);
        out.grenzen.push({ name, text: sf.text, breite: tw, platzBord: 98 - 13, platzAussen: 80 - 13, ok: tw <= 98 - 13 && tw <= 80 - 13 });
      });
      out.bild = cv.toDataURL('image/png');
      return out;
    });
    fs.writeFileSync(path.join(SHOTS, 'hud-felder.png'), Buffer.from(hud.bild.split(',')[1], 'base64'));
    console.log('HUD-Felder:', hud.grenzen.map((g) => `${g.text} ${g.breite}px ${g.ok ? 'passt' : 'ZU BREIT'}`).join(' | '));
    if (hud.grenzen.some((g) => !g.ok)) fehler.push('HUD-Feld: Text zu breit');
    await page.evaluate(() => { try { localStorage.removeItem('pantheon.pult'); } catch (e) { /* egal */ } });
  } finally {
    await b.close(); srv.kill();
    const fe = [...new Set(fehler)];
    console.log(fe.length ? 'FEHLER in der Browser-Konsole:\n' + fe.slice(0, 15).join('\n') : 'Browser-Konsole: keine Fehler');
    if (fe.length) status = 1;
    const se = log.split('\n').filter((l) => /Error/.test(l)); if (se.length) { console.log('Server:\n' + se.slice(0, 8).join('\n')); status = 1; }
  }
  process.exit(status);
}
main().catch((e) => { console.error(e); process.exit(1); });
