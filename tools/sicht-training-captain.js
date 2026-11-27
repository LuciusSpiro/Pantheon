// TRA-01 E: Sichtprüfung des Captain-Trainings im echten Client gegen den echten Server (Lobby-Modus training_captain, beide Varianten).
// Prüft: Mensch an der Captain-Konsole, drei Bots (Livia, Cassius, Titus) im Snapshot an ihren Stationen, Checkliste (Ziele des Buchs) im HUD, Befehlstafel (B) mit Bots, Crew-Zeile.
// Bilder nach --out (Standard shots/tra01-e, git-ignoriert). Eigener Server je Szenario (Port ab 3480, ROOM_CODE=off, Weltordner im Temp-Verzeichnis, nicht im Repo).
// Aufruf: node tools/sicht-training-captain.js [--port 3480] [--out <Ordner>] [--nur tafel,sprache]   (Exit 1, wenn eine Prüfung fehlschlägt; Software-GL, langsam)
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT0 = +arg('port', '3480');
const NUR = arg('nur', '').split(',').filter(Boolean);
const SHOTS = arg('out', path.join(ROOT, 'shots', 'tra01-e'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sichttraining-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
function playwright() {
  for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'C:/tmp/pwtest/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* nächster */ } }
  console.error('playwright-core nicht gefunden'); process.exit(2);
}
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ping = (port) => new Promise((res) => { const r = http.get({ host: '127.0.0.1', port, path: '/', timeout: 800 }, (x) => { x.resume(); res(x.statusCode === 200); }); r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); }); });

let fehlt = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('   ok    ' + t); else { fehlt++; console.log('   FEHLT ' + t); } };
const info = (t) => console.log('   info  ' + t);
const bild = async (page, name) => { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); info('Bild ' + path.join(SHOTS, name + '.png')); };

let portNr = PORT0;
async function mitServer(name, fn) {
  if (NUR.length && !NUR.includes(name)) return;
  const port = portNr++;
  console.log('\n== ' + name + ' (Port ' + port + ') ==');
  if (await ping(port)) throw new Error('Port ' + port + ' belegt');
  const dir = path.join(TMP, name);
  const env = Object.assign({}, process.env, { PORT: String(port), ROOM_CODE: 'off', WORLD_DIR: path.join(dir, 'worlds'), REGIE_DIR: path.join(dir, 'regie'), ERZEUGT_DIR: path.join(dir, 'erzeugt') });
  delete env.LLM_LIVE; delete env.SPIELLEITER_LLM;
  const srv = spawn(process.execPath, ['server/index.js', '--debug'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 150 && !(await ping(port)); i++) await sleep(100);
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try { await fn(b, port); }
  finally { await b.close(); srv.kill(); const se = log.split('\n').filter((l) => /Error|TypeError/.test(l)); if (se.length) { fehlt++; console.log('   FEHLT Serverfehler: ' + se.slice(0, 4).join(' | ')); } }
}

async function szenario(b, port, sprache) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push('console: ' + m.text().slice(0, 160)); });
  await page.goto('http://127.0.0.1:' + port + '/?debug=1&render=2d');
  await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
  await page.evaluate(() => __game.send({ t: 'lobbyOpt', startMission: 'training_captain' }));
  if (sprache) await page.evaluate(() => __game.send({ t: 'lobbyOpt', trainingSprache: true }));
  await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
  await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
  await sleep(1500);
  await bild(page, (sprache ? 'sprache' : 'tafel') + '-1-start');
  await page.waitForFunction(() => { const s = __game.state; return s.players.filter((p) => p.bot && p.console).length >= 3; }, null, { timeout: 30000 }).catch(() => {});
  await sleep(800);
  const s = await page.evaluate(() => {
    const st = __game.state; const me = st.players.find((p) => p.id === __game.pid);
    return { phase: st.phase, me: me && { console: me.console, bot: !!me.bot }, bots: st.players.filter((p) => p.bot).map((p) => ({ n: p.name, r: p.rolle, c: p.console })),
      ziele: ((st.mission && (st.mission.focusObjectives || (st.mission.active && st.mission.active.objectives) || st.mission.objectives)) || []).map((o) => o.text + (o.optional ? ' (freiwillig)' : '') + (o.done ? ' [x]' : ' [ ]')),
      titel: st.mission && (st.mission.focusTitle || (st.mission.active && st.mission.active.title)) };
  });
  info('Mensch: ' + JSON.stringify(s.me) + ' · Bots: ' + s.bots.map((x) => x.n + '/' + x.r + '@' + x.c).join(', '));
  info('Titel: ' + s.titel + ' · Ziele: ' + s.ziele.join(' | '));
  ok(s.phase === 'play' && s.me && s.me.console === 'captain', 'Mensch sitzt an der Captain-Konsole');
  ok(s.bots.length === 3 && ['navigation', 'ops', 'technik'].every((r) => s.bots.some((x) => x.r === r)), 'drei Bots (Navigation, Ops, Technik) im Snapshot: ' + s.bots.map((x) => x.n).join(', '));
  ok(s.bots.every((x) => x.c), 'alle drei Bots sitzen an einer Konsole');
  ok(s.ziele.length === 3 && s.ziele.every((t) => /\[ \]$/.test(t)), 'Checkliste im HUD: drei offene Ziele des Schritts stand');
  await page.mouse.move(5, 5);
  await page.keyboard.press('Digit3'); await sleep(500);
  await bild(page, (sprache ? 'sprache' : 'tafel') + '-2-captain');
  await page.keyboard.press('KeyB'); await sleep(500);
  await bild(page, (sprache ? 'sprache' : 'tafel') + '-3-tafel');
  ok(errs.length === 0, 'keine Fehler im Browser' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await ctx.close();
}

(async () => {
  await mitServer('tafel', (b, port) => szenario(b, port, false));
  await mitServer('sprache', (b, port) => szenario(b, port, true));
  console.log('\nSICHT-TRAINING-CAPTAIN: ' + (fehlt ? fehlt + ' FEHLT von ' + n : n + '/' + n + ' ok'));
  process.exit(fehlt ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
