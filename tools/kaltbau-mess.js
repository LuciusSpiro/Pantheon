#!/usr/bin/env node
// AP7 (Team ART, CONTRACT-W1 §3.2/1): kalter Kartenbau im Browser, Methode QA-INTEGRATION §3.4.
// Je Lauf frischer Server (eigene Datenordner, ohne .env, ohne Live-LLM) und frischer Browser (headless Chromium).
//
//   npm run mess:kaltbau [-- --arten aussenposten,station,ruine,schiff --modi direkt,transfer --seeds 5,6,7 --port 3385 --warte 1800 --json --v]
//
// Modi:
//   direkt   – Direktstart ?arena=away&art=…  (Testgelände; der Leerlauf-Prefetch hat nur die Zeit bis „bereit“)
//   transfer – Kampagne (?debug=1), Transferkammer betreten (client.js stößt VoxelKit.prefetch an), dann `buehne <art> …`
// Gemessen ab „Außenkarte im Client sichtbar“ bis „Kit-Bau fertig“: buildMs/ladeMs/assetMs aus VoxelKit.stats(), Wandzeit,
// HTTP-Anfragen in dieser Zeit (je Ordner) und akteureMs = bis die eigene Crew-Figur und ihre Waffe (Gerüst + Anbau) geladen sind.
// Ausgabe: Median je Kartenart und Modus (Tabelle, mit --json zusätzlich alle Läufe).
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; };
const ARTEN = arg('arten', 'aussenposten,station,ruine,schiff').split(',');
const MODI = arg('modi', 'direkt,transfer').split(',');
const SEEDS = arg('seeds', '5,6,7').split(',').map(Number);
const PORT = +arg('port', '3385');
const JSON_OUT = process.argv.includes('--json');
const VERBOSE = process.argv.includes('--v');
const SHOTS = arg('shots', null);   // Ordner für einen Screenshot je Lauf (optional)
const WARTE = +arg('warte', '1800');   // ms zwischen Seitenaufruf und „bereit“ (QA §3.4: 1800; 0 = härtester Direktstart)
// Vergleich mit einem älteren Stand: --kit <datei> liefert diese Datei statt /js/voxel/kit.js aus (z. B. git show HEAD:…)
const KIT_DATEI = arg('kit', null);
// Bauweise/Besitz je Kartenart wie QA-INTEGRATION §3.4
const BW = {
  aussenposten: { bauweise: 'germanen', besitz: 'rostmeute', zustand: 'intakt' },
  station: { bauweise: 'germanen', besitz: 'rostmeute', zustand: 'intakt' },
  schiff: { bauweise: 'germanen', besitz: 'rostmeute', zustand: 'intakt' },
  ruine: { bauweise: 'rom', besitz: 'herrenlos', zustand: 'verfallen' },
};

function playwright() {
  const kand = [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'C:/tmp/pwtest/node_modules/playwright-core',
    'C:/Users/Luciu/projects/Asgard/node_modules/playwright-core', 'playwright-core'].filter(Boolean);
  for (const k of kand) { try { return require(k); } catch (e) { /* nächster */ } }
  console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE setzen, siehe concept/buehnen/TEAM-START.md).');
  process.exit(2);
}
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => { const s = a.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

// ------------------------------------------------------------------------------------------------ Server
const DIRS = { WORLD_DIR: 'data/worlds-art', REGIE_DIR: 'data/regie-art', ERZEUGT_DIR: 'data/erzeugt-art' };
function frei() { for (const d of Object.values(DIRS)) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true }); }
function ping() {
  return new Promise((res) => { const r = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 800 }, (x) => { x.resume(); res(x.statusCode === 200); }); r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); }); });
}
async function serverStart() {
  if (await ping()) throw new Error('Port ' + PORT + ' ist schon belegt');
  frei();
  const env = Object.assign({}, process.env, { PORT: String(PORT), ROOM_CODE: 'off' }, DIRS);
  delete env.LLM_LIVE; delete env.SPIELLEITER_LLM;
  const p = spawn(process.execPath, ['server/index.js', '--debug'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100; i++) { if (await ping()) return p; if (p.exitCode != null) break; await sleep(100); }
  p.kill(); throw new Error('Server startet nicht:\n' + log.slice(-800));
}
async function serverStop(p) {
  if (!p || p.exitCode != null) return;
  p.kill();
  for (let i = 0; i < 50 && p.exitCode == null; i++) await sleep(50);
  for (let i = 0; i < 40 && await ping(); i++) await sleep(100);
}

// ------------------------------------------------------------------------------------------------ Transferkammer (wie b-client-lib.js)
async function sitzen(page, kind) {
  const goal = await page.evaluate((kind) => {
    const M = Shared_Maps.ship, st = __game.state, me = st.players.find((p) => p.id === __game.pid), T = Shared_Maps.TILE;
    const sy0 = Math.floor(me.y / T), cand = [];
    for (let y = 0; y < M.h; y++) for (let x = 0; x < M.w; x++) {
      const inf = M.info(x, y); if (!inf || inf.console !== kind) continue;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) if (!M.solid(x + dx, y + dy)) cand.push({ x: x + dx, y: y + dy, d: Math.abs(y - sy0), fx: -dx, fy: -dy });
    }
    cand.sort((a, b) => a.d - b.d);
    return cand[0] || null;
  }, kind);
  if (!goal) throw new Error('Konsole nicht gefunden: ' + kind);
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > 45000) throw new Error('Weg zur Konsole: Zeit');
    const r = await page.evaluate((goal) => {
      const C = __game.client, st = __game.state, me = st.players.find((p) => p.id === __game.pid), M = Shared_Maps.ship, T = Shared_Maps.TILE;
      const sx = Math.floor(me.x / T), sy = Math.floor(me.y / T);
      if (sx === goal.x && sy === goal.y && Math.hypot(me.x - (goal.x * T + 16), me.y - (goal.y * T + 16)) < 13) { C.seq++; __game.send({ t: 'input', seq: C.seq, mx: 0, my: 0 }); return 'da'; }
      const key = (x, y) => x + ',' + y, prev = { [key(sx, sy)]: null }, q = [[sx, sy]];
      let found = false;
      while (q.length) {
        const [x, y] = q.shift();
        if (x === goal.x && y === goal.y) { found = true; break; }
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, k = key(nx, ny); if (k in prev || M.solid(nx, ny)) continue; prev[k] = [x, y]; q.push([nx, ny]); }
      }
      if (!found) return 'kein Weg';
      let cur = [goal.x, goal.y];
      while (prev[key(cur[0], cur[1])] && !(prev[key(cur[0], cur[1])][0] === sx && prev[key(cur[0], cur[1])][1] === sy)) cur = prev[key(cur[0], cur[1])];
      let mx = cur[0] * T + 16 - me.x, my = cur[1] * T + 16 - me.y; const l = Math.hypot(mx, my) || 1;
      C.seq++; __game.send({ t: 'input', seq: C.seq, mx: mx / l, my: my / l });
      return 'geht';
    }, goal);
    if (r === 'da') break;
    if (r === 'kein Weg') throw new Error('kein Weg zur Konsole ' + kind);
    await page.waitForTimeout(60);
  }
  await page.evaluate((g) => { const C = __game.client; C.seq++; __game.send({ t: 'input', seq: C.seq, mx: g.fx, my: g.fy }); }, goal);
  await page.waitForTimeout(120);
  await page.evaluate(() => { const C = __game.client; C.seq++; __game.send({ t: 'input', seq: C.seq, mx: 0, my: 0 }); });
  await page.waitForTimeout(200);
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => __game.send({ t: 'act', down: true })); await page.waitForTimeout(150);
    await page.evaluate(() => __game.send({ t: 'act', down: false })); await page.waitForTimeout(600);
    if (await page.evaluate((k) => __game.state.players.find((p) => p.id === __game.pid).console === k, kind)) return true;
  }
  throw new Error('nicht gesessen: ' + kind);
}

// ------------------------------------------------------------------------------------------------ ein Lauf
async function lauf(art, modus, seed) {
  const srv = await serverStart();
  const b = await chromium.launch();
  try {
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
    const err = [];
    page.on('pageerror', (e) => err.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') err.push('console: ' + m.text().slice(0, 160)); });
    if (KIT_DATEI) { const body = fs.readFileSync(KIT_DATEI, 'utf8'); await page.route('**/js/voxel/kit.js*', (r) => r.fulfill({ contentType: 'text/javascript', body })); }
    const B = BW[art];
    const q = modus === 'direkt' ? `?render=voxel&arena=away&art=${art}&seed=${seed}&bauweise=${B.bauweise}&besitz=${B.besitz}&zustand=${B.zustand}` : '?render=voxel&debug=1';
    await page.goto(`http://127.0.0.1:${PORT}/${q}`);
    if (WARTE > 0) await page.waitForTimeout(WARTE); else await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000, polling: 20 });
    const res = { art, modus, seed };
    if (modus !== 'direkt') await page.evaluate(() => __game.send({ t: 'lobbyOpt', skipDrill: true }));
    await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    if (modus === 'transfer') {
      await page.waitForTimeout(1500);
      await sitzen(page, 'transfer');
      const tp = Date.now();
      res.prefetchTeile = await page.evaluate(() => window.VoxelKit && window.VoxelKit.prefetch());
      res.prefetchMs = Date.now() - tp;
      await page.evaluate(() => __game.send({ t: 'leave' }));
      await page.waitForTimeout(500);
    }
    const reqs = []; let zaehlen = modus === 'direkt';
    page.on('request', (r) => { if (zaehlen) reqs.push(r.url().replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '')); });
    if (modus !== 'direkt') { zaehlen = true; await page.evaluate((l) => __game.dbg(l), `buehne ${art} ${seed} ${B.bauweise} ${B.besitz} ${B.zustand}`); }
    await page.waitForFunction(() => { const st = __game.state; const me = st && st.players.find((p) => p.id === __game.pid); return !!(me && me.zone === 'away' && st.away && Shared_Maps[st.away.map] && Shared_Maps[st.away.map].buehne); }, null, { timeout: 60000, polling: 20 });
    const ta = await page.evaluate(() => performance.now());
    await page.waitForFunction(() => { const s = window.VoxelKit && VoxelKit.stats(); return !!(s && s.id === __game.state.away.map); }, null, { timeout: 60000, polling: 20 });
    const tb = await page.evaluate(() => performance.now()); zaehlen = false;
    const nAnfragen = reqs.length;
    // Akteure: eigene Crew-Figur + Waffe (Gerüst und Anbau rom) geladen
    const akt = await page.waitForFunction((ta) => {
      const L = window.VoxelRender && VoxelRender.loader; if (!L) return false;
      const st = __game.state, me = st.players.find((p) => p.id === __game.pid);
      const fig = ['crew/nova', 'crew/juno', 'crew/tami', 'crew/nova'][me.color || 0] || 'crew/nova';
      const wf = me.wf && me.wf !== 'faust' ? me.wf : 'blaster';
      const ok = L.isLoaded(fig, 'figures') && L.isLoaded('item/waffe/' + wf) && (L.isLoaded('item/waffe/rom/' + wf) || L.isMissing('item/waffe/rom/' + wf));
      return ok ? { ms: Math.round(performance.now() - ta), fig, wf } : false;
    }, ta, { timeout: 30000, polling: 20 }).then((h) => h.jsonValue()).catch(() => null);
    if (akt) res.akteur = akt.fig + ' + ' + akt.wf;
    const s = await page.evaluate(() => { const s = VoxelKit.stats(); return { buildMs: s.buildMs, ladeMs: s.ladeMs, assetMs: s.assetMs, bakeMs: s.bakeMs, tris: s.tris, fehler: s.fehler, platzhalter: Object.keys(s.platzhalter || {}).length }; });
    const arten = {};
    for (const u of reqs.slice(0, nAnfragen)) { const m = /^\/voxel\/assets\/(\w+)\//.exec(u); const k = m ? m[1] : /^\/content\/buehnen\//.test(u) ? 'buehnen' : 'sonst'; arten[k] = (arten[k] || 0) + 1; }
    Object.assign(res, s, { sichtbarBisFertigMs: Math.round(tb - ta), akteureMs: akt ? akt.ms : null, anfragen: nAnfragen, anfragenArten: arten, konsolenfehler: err.length });
    if (SHOTS) { await page.waitForTimeout(1200); fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `kaltbau-${modus}-${art}-${seed}.png`) }); }
    if (VERBOSE && err.length) console.error('  Konsole:', err.slice(0, 4).join(' || '));
    if (VERBOSE) console.error('  Anfragen:', reqs.join(' '));
    return res;
  } finally {
    await b.close().catch(() => null);
    await serverStop(srv);
  }
}

(async () => {
  const laeufe = [];
  for (const art of ARTEN) for (const modus of MODI) for (const seed of SEEDS) {
    try {
      const r = await lauf(art, modus, seed);
      laeufe.push(r);
      console.error(`${art.padEnd(12)} ${modus.padEnd(8)} seed ${seed}: build ${r.buildMs} ms, lade ${r.ladeMs} ms, Akteure ${r.akteureMs} ms, Anfragen ${r.anfragen} ${JSON.stringify(r.anfragenArten)}`);
    } catch (e) {
      laeufe.push({ art, modus, seed, fehler: String(e.message || e).slice(0, 200) });
      console.error(`${art} ${modus} seed ${seed}: FEHLER ${e.message}`);
    }
  }
  const zeilen = [];
  for (const art of ARTEN) for (const modus of MODI) {
    const L = laeufe.filter((r) => r.art === art && r.modus === modus && r.buildMs != null);
    zeilen.push({ art, modus, n: L.length, buildMs: L.map((r) => r.buildMs), buildMedian: median(L.map((r) => r.buildMs)), ladeMedian: median(L.map((r) => r.ladeMs)),
      assetMedian: median(L.map((r) => r.assetMs)), akteureMedian: median(L.map((r) => r.akteureMs)), anfragen: L.map((r) => r.anfragen) });
  }
  console.log('| Kartenart | Modus | buildMs (Läufe) | **Median** | ladeMs Median | assetMs Median | Akteure Median | HTTP-Anfragen |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const z of zeilen) console.log(`| ${z.art} | ${z.modus} | ${z.buildMs.join(' / ')} | **${z.buildMedian}** | ${z.ladeMedian} | ${z.assetMedian} | ${z.akteureMedian} | ${z.anfragen.join(' / ')} |`);
  if (JSON_OUT) console.log(JSON.stringify({ seeds: SEEDS, zeilen, laeufe }, null, 1));
  if (laeufe.some((r) => r.fehler)) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exit(1); });
