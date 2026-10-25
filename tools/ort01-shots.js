#!/usr/bin/env node
// ORT-01: Screenshots der Räume und Gebäude, je Kartenart, Bauweise und Seed (Sichtprüfung der Einrichtung).
//
//   node tools/ort01-shots.js [--arten station,aussenposten] [--bauweisen rom,germanen] [--seeds 1,2,3,4,5,6,7,8,9,10]
//                             [--out shots/ort01] [--port 3386] [--raeume kommando,lager] [--warte 900] [--hud] [--v]
//
// Je Kartenart und Bauweise startet das Werkzeug einen frischen Server (eigene Datenordner, ohne .env, ohne Live-LLM) und einen
// headless Chromium im Direktstart (?render=voxel&arena=away&art=…). Weitere Seeds laden über den Debug-Befehl `buehne`. Für jeden
// Raum, dessen Raumtyp Rollen hat (content/buehnen/rollen/<art>.json), setzt `tp` den Spieler in die Raummitte, die Kamera folgt (spielnahe
// Draufsicht), dann ein Screenshot des Fensters.
//   Ausgabe: <out>/<bauweise>/<kartenart>/<seed>-<platz-id>.png  (z. B. shots/ort01/rom/station/3-lager_2.png)
//            <out>/uebersicht.json  (je Seed: Räume, Rollen-Stücke, Dreiecke, Konsolenfehler)
// Der Ordner shots/ ist gitignored. Voraussetzung: npm run assets (public/voxel) und node_modules (playwright-core).
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; };
const ARTEN = arg('arten', 'station,aussenposten').split(',');
const BAUWEISEN = arg('bauweisen', 'rom,germanen').split(',');
const SEEDS = arg('seeds', '1,2,3,4,5,6,7,8,9,10').split(',').map(Number);
const OUT = path.resolve(ROOT, arg('out', 'shots/ort01'));
const PORT = +arg('port', '3386');
const NUR = arg('raeume', null) ? arg('raeume', '').split(',') : null;
const WARTE = +arg('warte', '900');
const VERBOSE = process.argv.includes('--v');
const MIT_HUD = process.argv.includes('--hud');   // Standard: die 2D-Oberfläche (#game: HUD, Funk, Ziele) wird ausgeblendet, es bleibt die 3D-Ansicht
const BESITZ = 'rostmeute';

function playwright() {
  const kand = [process.env.PLAYWRIGHT_CORE, 'playwright-core', 'C:/tmp/pw-test/node_modules/playwright-core'].filter(Boolean);
  for (const k of kand) { try { return require(k); } catch (e) { /* nächster */ } }
  console.error('playwright-core nicht gefunden (node_modules des Repos oder PLAYWRIGHT_CORE).');
  process.exit(2);
}
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const raumtypVon = (id) => String(id || '').replace(/_\d+$/, '');

const DIRS = { WORLD_DIR: 'data/worlds-shots', REGIE_DIR: 'data/regie-shots', ERZEUGT_DIR: 'data/erzeugt-shots' };
function ping() {
  return new Promise((res) => { const r = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 800 }, (x) => { x.resume(); res(x.statusCode === 200); }); r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); }); });
}
async function serverStart() {
  if (await ping()) throw new Error('Port ' + PORT + ' ist schon belegt');
  for (const d of Object.values(DIRS)) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
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

async function mitBrowser(art, bw, fn) {
  const srv = await serverStart();
  const b = await chromium.launch();
  try {
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
    const err = [];
    page.on('pageerror', (e) => err.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') err.push('console: ' + m.text().slice(0, 160)); });
    return await fn(page, err);
  } finally {
    await b.close().catch(() => null);
    await serverStop(srv);
  }
}

const kartenSig = () => { const st = __game.state; const m = st && st.away && Shared_Maps[st.away.map]; return m && m.rows ? m.rows.length + ':' + m.rows.join('').split('').reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7) : null; };

// Der Direktstart (?arena=away) ist unzuverlässig (Zeitüberschreitung bei rund 40 % der Läufe); der Debug-Befehl `buehne` baut die Karte sofort.
async function bauKarteWarten(page, art, bw, seed, erste) {
  if (erste) {
    await page.goto(`http://127.0.0.1:${PORT}/?render=voxel&debug=1`);
    await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000, polling: 20 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => __game.send({ t: 'lobbyOpt', skipDrill: true }));
    await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await page.waitForTimeout(2500);
  }
  const vorher = await page.evaluate(kartenSig);
  await page.evaluate((l) => __game.dbg(l), `buehne ${art} ${seed} ${bw} ${BESITZ} intakt`);
  await page.waitForFunction(([v, sigSrc]) => {
    const st = __game.state, me = st && st.players.find((p) => p.id === __game.pid);
    if (!(me && me.zone === 'away' && st.away && Shared_Maps[st.away.map] && Shared_Maps[st.away.map].buehne)) return false;
    const sig = (0, eval)('(' + sigSrc + ')')();
    return sig !== v;
  }, [vorher, kartenSig.toString()], { timeout: 60000, polling: 40 });
  await page.waitForFunction(() => { const s = window.VoxelKit && VoxelKit.stats(); return !!(s && s.id === __game.state.away.map); }, null, { timeout: 60000, polling: 40 });
  await page.waitForTimeout(700);
  if (!MIT_HUD) await page.addStyleTag({ content: '#game { visibility: hidden !important; }' }).catch(() => null);
}

(async () => {
  const rollenVon = {};
  for (const art of ARTEN) rollenVon[art] = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/buehnen/rollen/' + art + '.json'), 'utf8')).raumtypen;
  const uebersicht = [];
  let nBilder = 0;
  for (const art of ARTEN) for (const bw of BAUWEISEN) {
    const dir = path.join(OUT, bw, art);
    fs.mkdirSync(dir, { recursive: true });
    await mitBrowser(art, bw, async (page, err) => {
      for (let i = 0; i < SEEDS.length; i++) {
        const seed = SEEDS[i];
        try {
          let letzteErr = err.length;
          await bauKarteWarten(page, art, bw, seed, i === 0);
          if (i === 0) await page.evaluate(() => __game.dbg('god on'));   // Spieler unverwundbar, damit er in Ruhe durch die Räume springt
          const info = await page.evaluate(() => {
            const st = __game.state, m = Shared_Maps[st.away.map], k = m.karte, S = VoxelKit.stats();
            const pl = (m.plaetze || []).map(([id, typ, x, y, w, h]) => ({ id, typ, rect: [x, y, w, h] }));
            return { map: st.away.map, w: m.w, h: m.h, plaetze: pl, tris: S.tris, deko: S.deko, dekoFehlt: S.dekoFehlt, leit: (S.leit || []).length, fehler: S.fehler, T: Shared_Maps.TILE };
          });
          const raeume = info.plaetze.filter((p) => rollenVon[art][raumtypVon(p.id)] && (!NUR || NUR.includes(raumtypVon(p.id))));
          const dateien = [];
          for (const p of raeume) {
            const [x, y, w, h] = p.rect;
            await page.evaluate(([cx, cy]) => __game.dbg(`tp ${cx} ${cy}`), [Math.floor(x + w / 2), Math.floor(y + h / 2)]);
            await page.waitForTimeout(WARTE);
            const f = path.join(dir, `${seed}-${p.id}.png`);
            await page.screenshot({ path: f });
            dateien.push(path.relative(ROOT, f).replace(/\\/g, '/')); nBilder++;
          }
          uebersicht.push({ art, bauweise: bw, seed, map: info.map, raeume: raeume.map((p) => p.id), tris: info.tris, deko: info.deko, dekoFehlt: info.dekoFehlt, leit: info.leit, kitFehler: info.fehler, konsolenfehler: err.length - letzteErr, bilder: dateien });
          console.error(`${art}/${bw} seed ${seed}: ${raeume.length} Räume, ${info.deko} Deko, ${info.tris} Dreiecke${err.length - letzteErr ? ', Konsolenfehler ' + (err.length - letzteErr) : ''}`);
          if (VERBOSE && err.length) console.error('  ' + err.slice(-3).join(' || '));
        } catch (e) {
          uebersicht.push({ art, bauweise: bw, seed, fehler: String(e.message || e).slice(0, 200) });
          console.error(`${art}/${bw} seed ${seed}: FEHLER ${e.message}`);
        }
      }
    });
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'uebersicht.json'), JSON.stringify(uebersicht, null, 1));
  console.log(`${nBilder} Screenshots in ${path.relative(ROOT, OUT)}; Übersicht: ${path.relative(ROOT, path.join(OUT, 'uebersicht.json'))}`);
  if (uebersicht.some((u) => u.fehler)) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exit(1); });
