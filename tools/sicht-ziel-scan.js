// Sichtprüfung SYS-01 C1b-2 „Ziel-Scan“ im laufenden Spiel (Server + Chromium): Ziel-Scan-Kreuz für Jäger, Korvette, Fregatte, Kreuzer (gescannt),
// Fregatte mit zugewandter Zone offen und leer (Bresche, Mitte offen), Fregatte ruhig (außer Schussweite, Bresche ohne Strahlen), Reaktor-Countdown am Ziel,
// Eigenschiff-Bresche. Systemziel gewählt. Skins rom und germanen, Stationen Ops und Captain. Die Browser-Konsole muss ohne Fehler bleiben.
// Bilder nach --shots <Ordner> (Standard shots/ziel-scan): <szene>-<skin>-ops.png, <szene>-<skin>-captain.png, dazu Ausschnitte <szene>-<skin>-kasten.png und -karte.png (3-fach).
// Aufruf: node tools/sicht-ziel-scan.js [--shots <Ordner>] [--port 3456] [--nur <szene>[,<szene>]] [--skins rom,germanen]   Exit 1 bei Konsolen-/Seitenfehlern, 2 ohne Playwright.
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3456');
const SHOTS = path.resolve(ROOT, arg('shots', 'shots/ziel-scan'));
const DIRS = { WORLD_DIR: 'data/worlds-zs', REGIE_DIR: 'data/regie-zs', ERZEUGT_DIR: 'data/erzeugt-zs' };
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.log('Playwright fehlt'); process.exit(2); }
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ping() { return new Promise((res) => { const r = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 800 }, (x) => { x.resume(); res(x.statusCode === 200); }); r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); }); }); }

// Szenen: Klasse des Ziels, Zustand der zugewandten Zone (Systeme zerstören), Systemziel wählen
const SZENEN = [
  { id: 'raider', kind: 'raider' },
  { id: 'korvette', kind: 'korvette' },
  { id: 'fregatte-offen', kind: 'fregatte' },
  { id: 'fregatte-leer', kind: 'fregatte', leerZugewandt: true },
  { id: 'fregatte-ruhig', kind: 'fregatte', leerZugewandt: true, dist: 560, voraus: true },   // außerhalb der Schussweite: keine Strahlen, keine Treffer über der Bresche
  { id: 'kreuzer', kind: 'kreuzer' },
  { id: 'fregatte-countdown', kind: 'fregatte', leerZugewandt: true, reaktor: true },
  { id: 'eigen-bresche', kind: 'fregatte', eigenBresche: true },
];
const nur = arg('nur', '') ? arg('nur', '').split(',') : null, SKINS = arg('skins', 'rom,germanen').split(',');

async function main() {
  if (await ping()) throw new Error('Port ' + PORT + ' belegt');
  fs.mkdirSync(SHOTS, { recursive: true });
  const env = Object.assign({}, process.env, { PORT: String(PORT), ROOM_CODE: 'off' }, DIRS);
  let srv = null, log = '';
  // je Szene ein frischer Server (sonst schießen die Gegner der Vorszenen weiter und zerlegen das Schiff, Strahlen liegen über allem)
  async function serverStart() {
    for (const d of Object.values(DIRS)) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
    srv = spawn(process.execPath, ['server/index.js', '--debug'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
    for (let i = 0; i < 100 && !(await ping()); i++) await sleep(100);
  }
  async function serverStop() { if (!srv) return; const s = srv; srv = null; await new Promise((res) => { s.on('exit', res); s.kill(); setTimeout(res, 3000); }); }
  const b = await chromium.launch();
  const fehler = [];
  let status = 0;
  try {
    const PAARE = []; for (const s0 of SZENEN) if (!nur || nur.includes(s0.id)) for (const skin of SKINS) PAARE.push([s0, skin]);
    for (const [s0, skin] of PAARE) {
      const sz = Object.assign({}, s0, { id: s0.id + '-' + skin });
      await serverStart();
      const page = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
      page.on('pageerror', (e) => fehler.push(sz.id + ' pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error') fehler.push(sz.id + ' console: ' + m.text().slice(0, 240)); });
      await page.goto(`http://127.0.0.1:${PORT}/?debug=1&render=2d&pult=${skin}`);
      await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
      await page.evaluate(() => __game.send({ t: 'lobbyOpt', startMission: 'free', skipDrill: true }));
      await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
      await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
      await page.evaluate(() => __game.send({ t: 'debug', cmd: 'god', on: true }));   // die Gegner zerlegen das Schiff sonst während der Aufnahme (Banderole, Schiff tot)
      await page.mouse.move(5, 5);
      await page.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'helm' }));
      await sleep(600);
      for (let i = 0; i < 3; i++) await page.evaluate(() => __game.send({ t: 'cmd', c: 'helm.throttle', delta: 1 }));
      await page.waitForFunction(() => { const s = __game.state.ship || {}; return !s.docked && !s.dockedAt; }, null, { timeout: 15000 }).catch(() => console.log(sz.id + ': noch angedockt'));
      await sleep(2000);
      await page.evaluate(([k, d, w]) => __game.send({ t: 'debug', cmd: 'spawn', kind: k, volk: 'ger', dist: d, winkel: (w == null ? 0 : (__game.state.ship.angle || 0) + w) }), [sz.kind, sz.dist || 300, sz.voraus ? 0 : null]);
      await sleep(1200);
      await page.evaluate(() => __game.send({ t: 'debug', cmd: 'scanall' }));
      await sleep(400);
      const id = await page.evaluate((k) => { const e = (__game.state.space.enemies || []).find((q) => q.kind === k && q.scanned); return e ? e.id : null; }, sz.kind);
      if (id == null) { console.log(sz.id + ': kein gescannter Gegner'); status = 1; await page.close(); await serverStop(); continue; }
      await page.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'weapons' })); await sleep(500);
      await page.evaluate((x) => __game.send({ t: 'cmd', c: 'weapons.target', id: x }), id);
      await sleep(500);
      console.log('DIAG ' + JSON.stringify(await page.evaluate(() => { const s = __game.state.ship, e = (__game.state.space.enemies || []).map((q) => [q.id, q.kind, q.scanned, Math.round(Math.hypot(q.x - s.x, q.y - s.y))]); return { target: s.target, enemies: e, scan: s.scan }; })));
      if (sz.leerZugewandt) {
        // Zugewandte Zone leer: alle Systeme dieser Zone zerstören (Treffer-Befehl der Verfolgungs-Sicht), dann Mitte offen
        await page.evaluate(() => {
          const sh = __game.state.ship, zz = sh.zielZon, Z = window.Zielsysteme, e = (__game.state.space.enemies || []).find((q) => q.id === sh.target);
          if (!zz || zz.z < 0 || !e) return;
          const zone = ['bug', 'stb', 'heck', 'bb'][zz.z];
          for (const d of Z.systemeVon(e.kind).filter((s) => s.zone === zone)) __game.send({ t: 'debug', cmd: 'zielsysteme', args: 'treffer 6 ' + d.id });
        });
        await sleep(600);
      }
      if (sz.reaktor) {   // Reaktor des Ziels zerstören: der Countdown läuft (zielSys, letztes Feld)
        await page.evaluate(() => __game.send({ t: 'debug', cmd: 'zielsysteme', args: 'treffer 6 reaktor' }));
        // Der Debug-Treffer startet keinen Countdown (nur der Tod-Pfad des Servers): Restzeit für die Sichtprüfung am Client vorgeben, die Zeichnung ist die echte
        await page.evaluate(() => { window.Zielsysteme.reaktorRest = () => 14.2; });
        await sleep(600);
      }
      if (sz.eigenBresche) {   // Eigenschiff: alle aktiven Systeme der Bug-Zone zerstört (Zone leer, Mitte offen); kein Reaktor-Countdown (Debug-Schaden)
        await page.evaluate(() => { const ZK = window.Zonenkreuz, ids = (window.Shared_Protocol || {}).SYSTEMS_INTEG || [], ship = __game.state.ship; ids.forEach((id, i) => { if (ship.integ[i] >= 0 && ZK.sektorVon(id) === 0) __game.send({ t: 'debug', cmd: 'damage', system: id, state: 'broken' }); }); });
        await sleep(600);
      }
      // Systemziel reihum: erstes anwählbares System wählen (Taste 0 macht dasselbe)
      await page.evaluate(() => { const st = __game.state, Z = window.Zielsysteme, e = (st.space.enemies || []).find((q) => q.id === st.ship.target); const id2 = e ? Z.reihum(st, e) : undefined; if (id2 !== undefined) __game.send({ t: 'cmd', c: 'weapons.systemziel', id: id2 }); });
      await sleep(500);
      await page.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'weapons' }));
      await sleep(900);
      const info = await page.evaluate(() => { const s = __game.state.ship; return { zs: s.zs || null, zielZon: s.zielZon || null, wahl: s.zielWahl || [] }; });
      console.log(sz.id + ': ' + JSON.stringify(info));
      const rep = await page.evaluate(() => (__game.errorLog || []).map((e) => e.label + ': ' + e.msg + ' ' + String(e.stack || '').split('\n').slice(0, 2).join(' | ')));
      if (rep.length) { fehler.push(sz.id + ' Anzeige: ' + rep.join(' // ')); }
      await page.screenshot({ path: path.join(SHOTS, sz.id + '-ops.png') });
      await page.screenshot({ path: path.join(SHOTS, sz.id + '-kasten.png'), clip: { x: 940, y: 4, width: 340, height: 380 } });
      await page.screenshot({ path: path.join(SHOTS, sz.id + '-karte.png'), clip: { x: 120, y: 8, width: 816, height: 376 } });
      await page.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'captain' }));
      await sleep(900);
      await page.screenshot({ path: path.join(SHOTS, sz.id + '-captain.png') });
      await page.close();
      await serverStop();
    }
  } catch (e) {
    fehler.push('Lauf abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); status = 1;
  } finally {
    await b.close();
    await serverStop();
  }
  if (fehler.length) { console.log('FEHLER im Browser:\n  ' + fehler.join('\n  ')); status = 1; }
  else console.log('Browser-Konsole ohne Fehler');
  if (/Fehler|Error/.test(log) && /Error/.test(log)) console.log('Server-Log enthält Fehler (siehe Lauf)');
  process.exit(status);
}
main().catch((e) => { console.error(e); process.exit(1); });
