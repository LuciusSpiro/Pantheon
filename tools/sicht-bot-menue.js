// BOT-01 C3: Sichtprüfung des Befehlsmenüs der Bots am Captain-Pult im echten Client gegen den echten Server (Server-Bots über die Lobby, lobbyBot add).
// Prüft mit echten Tasten im Browser: B, Stufen 1 bis 3, Senden (erwartete bot.befehl), die Antwort des Servers (bot.antwort) als Untertitel und Quittung, Tafel schließt, Esc, 6-s-Auto-Schließen,
// Direkttasten Sh+X/A/D/F/G/S, Tasten vor dem Reiter-Zweig (Sh+X löscht keinen Marker), Funk-/Reitertasten bleiben bei geschlossener Tafel frei, Sprache an (eine Antwort, ein Untertitel),
// reine Menschenpartie (nichts aktiv, nichts gesendet, Pult wie bisher), Ego-Sitz (Einblendung), Dev-Mock (Bots im Snapshot, Mensch an Station).
// Bilder nach shots/bot01c3-menue (git-ignoriert). Eigener Server je Szenario (Port ab 3462, ROOM_CODE=off, Weltordner im Temp-Verzeichnis, nicht im Repo).
// Aufruf: node tools/sicht-bot-menue.js [--port 3462] [--nur szenarien,kommagetrennt]   (Exit 1, wenn eine Prüfung fehlschlägt)
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT0 = +arg('port', '3462');
const NUR = arg('nur', '').split(',').filter(Boolean);
const SHOTS = path.join(ROOT, 'shots', 'bot01c3-menue');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sichtbotmenue-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
function playwright() {
  for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'C:/tmp/pwtest/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } }
  console.error('playwright-core nicht gefunden'); process.exit(2);
}
const { chromium } = playwright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ping = (port) => new Promise((res) => { const r = http.get({ host: '127.0.0.1', port, path: '/', timeout: 800 }, (x) => { x.resume(); res(x.statusCode === 200); }); r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); }); });

let fehlt = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('   ok    ' + t); else { fehlt++; console.log('   FEHLT ' + t); } };
const info = (t) => console.log('   info  ' + t);

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

// Seite öffnen, Spieler beitreten lassen, Aufzeichnung der Nachrichten (bot.befehl, bot.antwort, alle cmd-Namen)
async function seite(b, port, query, opts) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push('console: ' + m.text().slice(0, 160)); });
  await page.addInitScript(() => {
    window.__bef = []; window.__cmd = []; window.__ant = []; window.__alle = [];
    const orig = WebSocket.prototype.send;
    WebSocket.prototype.send = function (d) { try { const m = JSON.parse(d); if (m && m.t === 'bot.befehl') window.__bef.push(m); else if (m && m.t === 'cmd') window.__cmd.push(m.c); if (m && m.t !== 'ping' && m.t !== 'input') window.__alle.push(m.t); } catch (e) { /* binär */ } return orig.call(this, d); };
  });
  await page.goto('http://127.0.0.1:' + port + '/?' + query);
  await page.waitForFunction(() => window.__game && __game.send && __game.state, null, { timeout: 30000 });
  await page.evaluate(() => { Net.on((m) => { if (m && m.t === 'bot.antwort') window.__ant.push(m); }); });
  return { ctx, page, errs };
}
async function startePartie(page, rollen) {
  for (const r of rollen) { await page.evaluate((x) => __game.send({ t: 'lobbyBot', op: 'add', rolle: x }), r); await sleep(150); }
  if (rollen.length) await page.waitForFunction((k) => __game.state.players.filter((p) => p.bot).length >= k, rollen.length, { timeout: 8000 });
  await page.evaluate(() => __game.send({ t: 'lobbyOpt', startMission: 'free', skipDrill: true }));
  await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
  await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
  await page.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'captain', hin: true }));
  await page.waitForFunction(() => __game.state.players.find((p) => p.id === __game.pid && p.console === 'captain'), null, { timeout: 8000 });
  await page.mouse.move(5, 5);
  await page.waitForFunction(() => window.PultBefehl && (!PultBefehl.menue.hatBots() || PultBefehl.menue.geladen()), null, { timeout: 8000 });   // Kanon ist geholt
  await sleep(300);
}
const zustand = (page) => page.evaluate(() => (window.PultBefehl ? Object.assign({}, PultBefehl.menue.lies(), { bots: PultBefehl.menue.hatBots(), S: PultBefehl.statusY() }) : null));
const zu = (page) => page.evaluate(() => PultBefehl.schliessen());   // Tafel zu (ein Esc würde bei schon geschlossener Tafel die Konsole verlassen)
const taste = async (page, key, nach) => { await page.keyboard.press(key); await sleep(nach || 150); };
const bild = async (page, name) => { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); info('Bild ' + name); };
const leere = (page) => page.evaluate(() => { window.__bef.length = 0; window.__cmd.length = 0; window.__ant.length = 0; window.__alle.length = 0; });
const warteAntworten = (page, k, ms) => page.waitForFunction((kk) => window.__ant.length >= kk, k, { timeout: ms || 4000 }).then(() => true, () => false);
const untertitel = (page) => page.evaluate(() => Hud.sprech.eintraege.map((e) => e.who + ': ' + e.text));
const sortiert = (v) => (Array.isArray(v) ? v.map(sortiert) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortiert(v[k])])) : v);
const gleich = (a, b) => JSON.stringify(sortiert(a)) === JSON.stringify(sortiert(b));

async function main() {
  // ---------------------------------------------------------------- 1. Partie mit zwei Server-Bots (Navigation, Ops), Skin rom, Sprache aus
  await mitServer('bots-rom', async (b, port) => {
    const { ctx, page, errs } = await seite(b, port, 'debug=1&render=2d&pult=rom');
    await startePartie(page, ['navigation', 'ops']);
    let z = await zustand(page);
    ok(z && z.bots && z.S === 240 && !z.offen, 'Partie mit Bots: Crew-Zeile aktiv (S 240), Tafel zu');
    ok(!(await page.evaluate(() => BotSpracheStart.an())), 'Sprache aus (Standard)');
    await page.evaluate(() => __game.send({ t: 'cmd', c: 'captain.marker', x: 900, y: 700 }));   // Marker setzen: „Marker löschen“ wäre sonst gesperrt (Altlast Sh+X)
    await page.keyboard.press('Digit3'); await sleep(300);
    await bild(page, '01-zu');
    // Tafel: B, Stufen
    await leere(page);
    await taste(page, 'KeyB'); z = await zustand(page);
    ok(z.offen && z.stufe === 1, 'B öffnet die Tafel auf Stufe 1');
    await bild(page, '02-stufe1'); await zu(page);
    await zu(page); await taste(page, 'KeyB'); await taste(page, 'KeyW'); z = await zustand(page);
    ok(z.stufe === 2 && z.rolle === 'ops', 'W: Stufe 2 Ops');
    await bild(page, '03-stufe2'); await zu(page);
    await zu(page); await taste(page, 'KeyB'); await taste(page, 'KeyW'); await taste(page, 'KeyE'); z = await zustand(page);
    ok(z.stufe === 3, 'E: Stufe 3 (Feuer frei …)');
    await bild(page, '04-stufe3');
    await zu(page);
    await leere(page);
    await zu(page); await taste(page, 'KeyB'); await taste(page, 'KeyW'); await taste(page, 'KeyE'); await taste(page, 'KeyW', 100);
    ok(await page.evaluate(() => window.__bef.length) === 1, 'W sendet genau einen Befehl');
    const bef = await page.evaluate(() => window.__bef[0]);
    ok(gleich(bef, { t: 'bot.befehl', an: 'ops', befehl: 'ops.feuer_frei', args: { waffen: 'bug' }, quelle: 'menu' }), 'bot.befehl: ' + JSON.stringify(bef));
    z = await zustand(page);
    ok(!z.offen, 'Tafel schließt nach dem Senden');
    ok(await warteAntworten(page, 1), 'der Server antwortet (bot.antwort)');
    const ant = await page.evaluate(() => window.__ant[0]);
    info('Antwort: ' + JSON.stringify(ant));
    ok(ant && ant.befehl === 'ops.feuer_frei' && ['ok', 'abgelehnt', 'unmoeglich'].includes(ant.status) && typeof ant.textId === 'string', 'Antwort hat befehl, status, textId');
    await sleep(300);
    let ut = await untertitel(page);
    ok(ut.length === 1 && /^OPS: /.test(ut[0]), 'Untertitel erscheint genau einmal, ohne Sprache (' + ut.join(' | ') + ')');
    const q = await page.evaluate(() => PultBefehl.menue.crew()[0]);
    ok(q.quittung && /^OPS (aye|abgelehnt)$/.test(q.text), 'Quittung am Knopf Befehle: ' + q.text);
    // zweite Antwort kommt nicht doppelt
    await sleep(500);
    ut = await untertitel(page);
    ok(ut.length === 1, 'kein zweiter Untertitel nachträglich (' + ut.join(' | ') + ')');
    await bild(page, '05-antwort');

    // Direkttasten
    for (const [key, an, befehl] of [['Shift+KeyX', 'navigation', 'nav.stopp'], ['Shift+KeyA', 'navigation', 'nav.ausweichen'], ['Shift+KeyD', 'navigation', 'nav.ausweichen'], ['Shift+KeyF', 'ops', 'ops.feuer_frei'], ['Shift+KeyG', 'ops', 'ops.feuer_halt'], ['Shift+KeyS', 'alle', 'bot.status']]) {
      await leere(page); await sleep(700);
      await taste(page, key, 250);
      const m = await page.evaluate(() => window.__bef.slice());
      ok(m.length === 1 && gleich(m[0], { t: 'bot.befehl', an, befehl, quelle: 'taste' }), key + ' sendet ' + befehl + ' an ' + an + ' (quelle taste)');
      ok(await warteAntworten(page, key === 'Shift+KeyS' ? 2 : 1), key + ': Antwort(en) vom Server');
    }
    ut = await untertitel(page);
    ok(ut.length <= 2, 'höchstens zwei Untertitel stehen (' + ut.length + ')');
    await bild(page, '06-status');
    // Tasten vor dem Reiter-Zweig: Sh+X darf nicht „Marker löschen“ auslösen, X ohne Shift schon (Altverhalten, Tafel zu)
    await leere(page);
    await taste(page, 'Shift+KeyX', 250);
    ok(!(await page.evaluate(() => window.__cmd)).includes('captain.marker'), 'Sh+X löscht keinen Marker (Bot-Taste vor dem Reiter-Zweig)');
    await leere(page);
    await taste(page, 'KeyX', 250);
    ok((await page.evaluate(() => window.__cmd)).includes('captain.marker') && (await page.evaluate(() => window.__bef.length)) === 0, 'X ohne Shift löscht den Marker wie bisher und sendet keinen Bot-Befehl');
    // Ist die Tafel zu, gehören Q/W/E/A/S/D den Reitern (Funkantworten, Sternkarte): die Bot-Tasten fangen sie nicht ab
    ok(await page.evaluate(() => [PultBefehl.taste({ code: 'KeyQ', shiftKey: false }), PultBefehl.taste({ code: 'KeyW', shiftKey: false }), PultBefehl.taste({ code: 'KeyE', shiftKey: false }), PultBefehl.taste({ code: 'KeyA', shiftKey: false }), PultBefehl.taste({ code: 'KeyD', shiftKey: false }), PultBefehl.taste({ code: 'KeyZ', shiftKey: false })].every((r) => r === false)), 'Tafel zu: Q W E A D Z gehen nicht an die Tafel');
    // Esc: Tafel zu, Konsole bleibt; zweites Esc verlässt
    await zu(page); await taste(page, 'KeyB'); await taste(page, 'KeyQ');
    await taste(page, 'Escape', 250);
    z = await zustand(page);
    ok(!z.offen && await page.evaluate(() => __game.state.players.find((p) => p.id === __game.pid).console) === 'captain', 'Esc bei offener Tafel: Tafel zu, Konsole bleibt');
    // Zurück: B, Rück
    await zu(page); await taste(page, 'KeyB'); await taste(page, 'KeyW'); await taste(page, 'KeyE');
    await taste(page, 'Backspace'); z = await zustand(page);
    ok(z.offen && z.stufe === 2, 'Rück: eine Stufe zurück');
    await taste(page, 'KeyB'); z = await zustand(page);
    ok(z.offen && z.stufe === 1, 'B: noch eine Stufe zurück');
    await taste(page, 'KeyB'); z = await zustand(page);
    ok(!z.offen, 'B auf Stufe 1 schließt');
    // gesperrte Rolle: Technik hat keinen Bot
    await leere(page);
    await zu(page); await taste(page, 'KeyB'); await taste(page, 'KeyE'); z = await zustand(page);
    ok(z.offen && z.stufe === 1 && (await page.evaluate(() => window.__bef.length)) === 0, 'E (Technik, kein Bot): gesperrt, nichts gesendet');
    await bild(page, '07-gesperrt');
    // 6 s Auto-Schließen
    await sleep(6400);
    z = await zustand(page);
    ok(!z.offen, 'nach 6 s ohne Taste schließt die Tafel von selbst');
    // Ziffern bleiben Reiter bei offener Tafel
    await taste(page, 'KeyB'); await taste(page, 'Digit1', 250);
    z = await zustand(page);
    ok(z.offen && await page.evaluate(() => Consoles.tab) === 0, 'Reiter 1 bei offener Tafel: Reiter wechselt, Tafel bleibt');
    await taste(page, 'Escape');
    // Umbelegung (Menü Steuerung): Direkttaste und Tafelfeld folgen der neuen Taste, die alte Taste tut nichts
    await page.evaluate(() => { Tasten.setze('captain.bot.stopp', 0, 'Shift+KeyK'); Tasten.setze('captain.befehl.q', 0, 'KeyM'); });
    await leere(page); await zu(page);
    await taste(page, 'Shift+KeyK', 250);
    ok((await page.evaluate(() => window.__bef.map((m) => m.befehl))).join() === 'nav.stopp', 'umbelegt: Sh+K sendet nav.stopp');
    await leere(page);
    await taste(page, 'Shift+KeyX', 250);
    ok((await page.evaluate(() => window.__bef.length)) === 0 && !(await page.evaluate(() => window.__cmd)).includes('captain.marker'), 'umbelegt: Sh+X (alte Taste) sendet nichts und löscht keinen Marker');
    await taste(page, 'KeyB'); await taste(page, 'KeyM'); z = await zustand(page);
    ok(z.offen && z.stufe === 2 && z.rolle === 'navigation', 'umbelegt: M wählt das Feld Q (Navigation)');
    await taste(page, 'KeyQ'); z = await zustand(page);
    ok(z.stufe === 2, 'umbelegt: Q (alte Taste) wählt in der offenen Tafel nichts mehr');
    await zu(page);
    await page.evaluate(() => { Tasten.zuruecksetzen('captain.bot.stopp'); Tasten.zuruecksetzen('captain.befehl.q'); });
    // Tab schließt die Tafel
    await taste(page, 'KeyB'); await taste(page, 'Tab', 400);
    z = await zustand(page);
    ok(!z.offen, 'Tab (Station wechseln) schließt die Tafel');
    // Hilfe listet Tafelfelder und Crew-Zeile (sie sind Knöpfe mit Kappe)
    await page.evaluate(() => __game.send({ t: 'leave' })); await sleep(400);
    await page.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'captain', hin: true })); await sleep(700);
    const hk = await page.evaluate(() => Consoles.findButtons(/^(Alle Maschinen stopp|Feuer frei|Statusbericht|Befehle)$/).map((x) => x.label + '=' + x.hotkey));
    ok(hk.length >= 4 && hk.some((s) => /Alle Maschinen stopp=Sh\+X/.test(s)) && hk.some((s) => /Befehle=B/.test(s)), 'Crew-Zeile mit Kappen in der Knopfliste (Hilfe): ' + hk.join(', '));
    // Esc (Befund 2, M9): bei offener Tafel nur die Tafel zu; ein NEUER Druck danach verlässt die Konsole auch mit Bots; gehaltenes Esc (Wiederholung) verlässt nicht
    const konsole = () => page.evaluate(() => { const p = __game.state.players.find((q) => q.id === __game.pid); return p ? p.console : null; });
    const sitzen = async () => { if (await konsole() !== 'captain') { await page.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'captain', hin: true })); await sleep(700); } };
    await sitzen(); await zu(page);
    await taste(page, 'KeyB'); await taste(page, 'Escape', 300);
    ok(!(await zustand(page)).offen && await konsole() === 'captain', 'Esc bei offener Tafel: Tafel zu, Konsole bleibt');
    await taste(page, 'Escape', 500);
    ok(await konsole() === null, 'zweites Esc (neuer Druck) verlässt die Konsole auch mit Bots (M9)');
    await sitzen();
    await taste(page, 'KeyB');
    await page.keyboard.down('Escape'); await sleep(60); await page.keyboard.down('Escape'); await sleep(60); await page.keyboard.down('Escape'); await sleep(300); await page.keyboard.up('Escape'); await sleep(400);
    ok(!(await zustand(page)).offen && await konsole() === 'captain', 'gehaltenes Esc (Tastenwiederholung): schließt die Tafel, verlässt die Konsole nicht');
    await taste(page, 'Escape', 500);
    ok(await konsole() === null, 'danach ein neuer Esc-Druck verlässt die Konsole');
    ok(errs.length === 0, 'keine Seitenfehler' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));
    await ctx.close();
  });

  // ---------------------------------------------------------------- 2. Skin germanen, drei Bots, Technik (Nachfrage, Seiten)
  await mitServer('bots-germanen', async (b, port) => {
    const { ctx, page, errs } = await seite(b, port, 'debug=1&render=2d&pult=germanen');
    await startePartie(page, ['navigation', 'ops', 'technik']);
    await page.keyboard.press('Digit3'); await sleep(300);
    await zu(page); await taste(page, 'KeyB'); await taste(page, 'KeyE');
    await bild(page, '08-germanen-technik'); await zu(page);
    await leere(page);
    await zu(page); await taste(page, 'KeyB'); await taste(page, 'KeyE'); await taste(page, 'KeyD'); let z = await zustand(page);
    ok(z.offen && (await page.evaluate(() => window.__bef.length)) === 0, 'Reaktor überladen: erster Druck fragt, sendet nichts');
    await bild(page, '09-germanen-frage');
    await zu(page); await taste(page, 'KeyB'); await taste(page, 'KeyE'); await taste(page, 'KeyD'); await taste(page, 'KeyD', 300);
    const m = await page.evaluate(() => window.__bef.slice());
    ok(m.length === 1 && m[0].befehl === 'tech.ueberladen' && m[0].an === 'technik' && m[0].quelle === 'menu', 'zweiter Druck sendet tech.überladen');
    ok(await warteAntworten(page, 1), 'Antwort des Servers');
    // Seiten: … reparieren, R blättert
    await sleep(600);
    await zu(page); await taste(page, 'KeyB'); await taste(page, 'KeyE'); await taste(page, 'KeyA');
    await taste(page, 'KeyR'); await taste(page, 'KeyR');
    z = await zustand(page);
    ok(z.offen && z.stufe === 3 && z.seite === 2, 'R blättert (Seite 3 von … reparieren)');
    await bild(page, '10-germanen-reparieren-seite3');
    await zu(page); await taste(page, 'KeyB'); await taste(page, 'KeyE'); await taste(page, 'KeyA'); await taste(page, 'KeyR'); await taste(page, 'KeyR');
    const vorQ = await page.evaluate(() => window.__bef.length);
    await taste(page, 'KeyQ', 200);
    ok(await page.evaluate(() => window.__bef.length) === vorQ && (await zustand(page)).stufe === 3, 'Seite 3 Q (Lafette sieben): die Lerche hat dort keine Waffe, leeres Feld, nichts gesendet');
    await taste(page, 'KeyW', 200);
    const m2 = await page.evaluate(() => window.__bef.slice(-1)[0]);
    ok(m2 && m2.befehl === 'tech.reparieren' && m2.args && m2.args.system === 'weapon_bow', 'Seite 3 W: weapon_bow (' + JSON.stringify(m2 && m2.args) + ')');
    // Technik-Taste Y (KeyZ) und C erreichbar: Schub 4 (Y) bei Navigation
    await sleep(500);
    await zu(page); await taste(page, 'KeyB'); await taste(page, 'KeyQ'); await taste(page, 'KeyE'); await taste(page, 'KeyA', 250);
    const m3 = await page.evaluate(() => window.__bef.slice(-1)[0]);
    ok(m3 && m3.befehl === 'nav.schub' && m3.args.stufe === 1, 'B Q E A: nav.schub stufe 1 (Zahl)');
    await sleep(500);
    await zu(page); await taste(page, 'KeyB'); await taste(page, 'KeyQ'); await taste(page, 'KeyA'); await bild(page, '11-germanen-kurs');
    await zu(page); await taste(page, 'KeyB'); await taste(page, 'KeyQ'); await taste(page, 'KeyA'); await taste(page, 'KeyZ', 100);
    ok((await page.evaluate(() => window.__bef.slice(-1)[0])).befehl === 'nav.schub', 'Y (KeyZ) auf leerem Feld sendet nichts');
    await taste(page, 'KeyW', 250);
    const m4 = await page.evaluate(() => window.__bef.slice(-1)[0]);
    ok(m4.befehl === 'nav.kurs' && m4.args.ziel === 'ziel', 'B Q A W: nav.kurs ziel=ziel');
    ok(errs.length === 0, 'keine Seitenfehler' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));
    await ctx.close();
  });

  // ---------------------------------------------------------------- 3. Sprache an: genau ein Untertitel je Antwort
  await mitServer('sprache-an', async (b, port) => {
    const { ctx, page, errs } = await seite(b, port, 'debug=1&render=2d&pult=rom&botsprache=1');
    await page.waitForFunction(() => window.BotSprache && BotSprache.laeuft(), null, { timeout: 15000 });
    await startePartie(page, ['navigation', 'ops']);
    ok(await page.evaluate(() => BotSpracheStart.an() && BotSprache.laeuft()), 'Bot-Sprache läuft');
    await leere(page);
    await taste(page, 'KeyB');
    await bild(page, '12-sprache-stufe1');
    ok(await page.evaluate(() => PultBefehl.menue.ansicht().fuss) !== null, 'Sprache an: Fußzeile in Stufe 1');
    await taste(page, 'KeyW'); await taste(page, 'KeyQ', 250);
    ok(await warteAntworten(page, 1), 'Antwort vom Server');
    await sleep(500);
    const ut = await untertitel(page);
    ok(ut.length === 1, 'Sprache an: die Antwort erscheint genau einmal (' + ut.join(' | ') + ')');
    ok(!(await page.evaluate(() => BotSprache.netAntworten())), 'Sprache hängt (noch) nicht am Spielnetz: das Menü zeigt die Antwort (Paket D stellt um, dann zeigt die Sprache sie)');
    ok(await page.evaluate(() => PultBefehl.menue.crew()[0].quittung !== null), 'Quittung auch bei Sprache an');
    ok(errs.length === 0, 'keine Seitenfehler' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));
    await ctx.close();
  });

  // ---------------------------------------------------------------- 4. Reine Menschenpartie: nichts aktiv, Pult wie bisher
  await mitServer('mensch', async (b, port) => {
    const { ctx, page, errs } = await seite(b, port, 'debug=1&render=2d&pult=rom');
    await startePartie(page, []);
    await page.evaluate(() => __game.send({ t: 'cmd', c: 'captain.marker', x: 900, y: 700 }));
    await page.keyboard.press('Digit3'); await sleep(400);
    const z = await zustand(page);
    ok(z && !z.bots && z.S === 258 && !z.offen, 'ohne Bots: kein Befehlsmenü (S 258, Tafel zu)');
    ok(await page.evaluate(() => Hud.sprech.bots === false && !Hud.sprech.aktiv), 'ohne Bots: Sprechspalte nicht angeschaltet');
    ok(await page.evaluate(() => Consoles.findButtons(/^(Befehle|Statusbericht|Alle Maschinen stopp)$/).length) === 0, 'keine Knöpfe der Crew-Zeile');
    await bild(page, '13-mensch');
    await leere(page);
    await taste(page, 'KeyB', 250);
    ok(await page.evaluate(() => window.__bef.length) === 0 && !(await zustand(page)).offen, 'B: keine Tafel, kein bot.befehl');
    await leere(page);
    await taste(page, 'Shift+KeyX', 300);
    ok((await page.evaluate(() => window.__cmd)).includes('captain.marker') && (await page.evaluate(() => window.__bef.length)) === 0, 'Sh+X: Altverhalten (Marker löschen), kein bot.befehl');
    await leere(page);
    await taste(page, 'Shift+KeyF', 200); await taste(page, 'Shift+KeyS', 200);
    ok(await page.evaluate(() => window.__bef.length) === 0, 'Sh+F / Sh+S: nichts gesendet');
    await taste(page, 'Escape', 400);
    ok(await page.evaluate(() => { const p = __game.state.players.find((q) => q.id === __game.pid); return !p.console; }), 'Esc verlässt die Konsole wie bisher');
    ok(!(await page.evaluate(() => window.__alle)).some((t) => /^bot\./.test(t)), 'keine neuen Nachrichten (bot.*)');
    ok(errs.length === 0, 'keine Seitenfehler' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));
    await ctx.close();
  });

  // ---------------------------------------------------------------- 5. Ego-Sitz (Voxel): Einblendung in den Blicken VORN/CREW
  await mitServer('ego', async (b, port) => {
    const { ctx, page, errs } = await seite(b, port, 'debug=1&render=voxel&pult=rom');
    await page.evaluate(() => __game.send({ t: 'lobbyOpt', startMission: 'free', skipDrill: true }));
    for (const r of ['navigation', 'ops']) { await page.evaluate((x) => __game.send({ t: 'lobbyBot', op: 'add', rolle: x }), r); await sleep(150); }
    await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await page.waitForFunction(() => window.VoxelRender && VoxelRender.ready, null, { timeout: 30000 });
    await page.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'captain', hin: true })); await sleep(1500);
    await page.mouse.move(640, 300);
    const blick = await page.evaluate(() => (window.Sitz && Sitz.station ? Sitz.blick : '-'));
    ok(blick === 'vorn', 'Ego-Sitz, Blick VORN');
    await leere(page);
    await taste(page, 'KeyB', 300); await taste(page, 'KeyW', 300);
    ok((await zustand(page)).offen && (await zustand(page)).stufe === 2, 'B W wirken im Blick VORN (Tasten der Konsole)');
    await bild(page, '14-ego-vorn-einblendung');
    await taste(page, 'KeyE', 200); await taste(page, 'KeyS', 300);
    const m = await page.evaluate(() => window.__bef.slice());
    ok(m.length === 1 && m[0].befehl === 'ops.feuer_frei' && m[0].args.waffen === 'alle', 'B W E S: Feuer frei alle Waffen aus dem Blick VORN');
    ok(await warteAntworten(page, 1), 'Antwort des Servers');
    await sleep(300);
    ok((await untertitel(page)).length === 1, 'Untertitel im Ego-Sitz');
    await bild(page, '15-ego-vorn-antwort');
    ok(errs.length === 0, 'keine Seitenfehler' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));
    await ctx.close();
  });

  // ---------------------------------------------------------------- 6. Dev-Mock: Bots im Snapshot, Mensch an Station
  await mitServer('mock', async (b, port) => {
    for (const [pult, name] of [['rom', 'rom'], ['germanen', 'germanen']]) {
      const { ctx, page, errs } = await seite(b, port, 'mock=1&console=captain&tab=2&mockbots=navigation,ops&mockmensch=helm&markers=1&render=2d&pult=' + pult);
      await page.waitForFunction(() => window.PultBefehl && PultBefehl.menue.hatBots() && PultBefehl.menue.geladen(), null, { timeout: 8000 });
      await sleep(300);
      let z = await zustand(page);
      ok(z && z.bots && z.S === 240, 'Mock ' + name + ': Bots im Snapshot, Crew-Zeile');
      await taste(page, 'KeyB');
      const a = await page.evaluate(() => PultBefehl.menue.ansicht().zellen.map((c) => c.text + ':' + c.zustand + ':' + c.info));
      ok(/^Navigation:aus:Mensch an Station\|Ops:bereit:/.test(a.join('|')) && /Technik:aus:kein Bot/.test(a.join('|')), 'Mock ' + name + ': Navigation gesperrt (Mensch an Station), Technik kein Bot');
      await bild(page, '16-mock-' + name + '-stufe1');
      await taste(page, 'KeyE');   // Technik: gesperrt
      await taste(page, 'KeyW'); await taste(page, 'KeyS', 400);   // Ops: Ziel markieren: Mock lehnt ab
      ok(await warteAntworten(page, 1), 'Mock ' + name + ': Mock-Antwort');
      await sleep(300);
      const q = await page.evaluate(() => PultBefehl.menue.crew()[0]);
      ok(q.text === 'OPS abgelehnt' && q.fn === 'weapon', 'Mock ' + name + ': abgelehnt in Rot am Knopf (' + q.text + ')');
      await bild(page, '17-mock-' + name + '-abgelehnt');
      ok(errs.length === 0, 'Mock ' + name + ': keine Seitenfehler' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));
      await ctx.close();
    }
    // Befund 1: ein Klick auf ein leeres Tafelfeld oder in eine Lücke trifft den Fänger, nicht den verdeckten Reiter-Knopf (Reiter Funk und Lage, Stufe 1 und 3)
    for (const tab of [0, 2]) {
      const rn = tab === 0 ? 'Funk' : 'Lage';
      const { ctx, page, errs } = await seite(b, port, 'mock=1&console=captain&tab=' + tab + '&mockbots=navigation,ops&markers=1&render=2d&pult=rom');
      await page.waitForFunction(() => window.PultBefehl && PultBefehl.menue.hatBots() && PultBefehl.menue.geladen(), null, { timeout: 8000 });
      await sleep(500);
      await page.evaluate(() => { window.__sent = []; const o = Net.send.bind(Net); Net.send = (m) => { if (m && m.t !== 'ping' && m.t !== 'input') window.__sent.push(JSON.stringify(m)); return o(m); }; });   // ping und input sind Dauerrauschen
      const punkte = () => page.evaluate(() => {
        const M = PultBefehlTokens.MASS, RA = M.raster, a = PultBefehl.menue.ansicht();
        const mitte = (i) => [RA.x + (i % 3) * (RA.zw + RA.sx) + RA.zw / 2, RA.y + Math.floor(i / 3) * (RA.zh + RA.sy) + RA.zh / 2];
        const leer = a.zellen.map((z, i) => (z.zustand === 'leer' ? i : -1)).filter((i) => i >= 0).map(mitte);
        const luecken = [[RA.x + RA.zw + RA.sx / 2, RA.y + 5], [RA.x + 2 * RA.zw + 1.5 * RA.sx, RA.y + 20], [RA.x + 50, RA.y + RA.zh + RA.sy / 2], [RA.x + 50, RA.y + 2 * RA.zh + 1.5 * RA.sy], [M.tafel.x + 100, M.tafel.y + 2]];
        return { leer, luecken };
      });
      for (const stufe of [1, 3]) {
        await zu(page); await taste(page, 'KeyB');
        if (stufe === 3) { await taste(page, 'KeyW'); await taste(page, 'KeyE'); }
        const z0 = await zustand(page);
        ok(z0.offen && z0.stufe === stufe, 'Reiter ' + rn + ': Tafel offen auf Stufe ' + stufe);
        const p = await punkte();
        const tab0 = await page.evaluate(() => Consoles.tab);
        await page.evaluate(() => { window.__sent.length = 0; });
        const alle = p.leer.concat(p.luecken);
        for (const [x, y] of alle) { await page.mouse.click(x * 2, y * 2); await sleep(60); }
        const nach = await page.evaluate(() => ({ sent: window.__sent.slice(), tab: Consoles.tab, offen: PultBefehl.sichtbar(), stufe: PultBefehl.menue.lies().stufe }));
        ok(alle.length >= 5 && nach.sent.length === 0 && nach.tab === tab0 && nach.offen && nach.stufe === stufe, 'Klick auf ein leeres Feld und in eine Lücke sendet nichts und wechselt keinen Reiter (Reiter ' + rn + ', Stufe ' + stufe + ', ' + p.leer.length + ' leere Felder + ' + p.luecken.length + ' Lücken; gesendet ' + nach.sent.length + (nach.sent.length ? ' ' + nach.sent.join(' ').slice(0, 160) : '') + ', Reiter ' + tab0 + ' -> ' + nach.tab + ')');
        if (tab === 2 && stufe === 1) await bild(page, '19-mock-lage-tafel-nach-leerklicks');
      }
      // Befund 3 und M13: bei offener Tafel ruht der Reiter-Bereich; bei geschlossener wirken dieselben Tasten wie bisher (Gegenprobe)
      await page.evaluate(() => { window.__tb = []; window.__zoom = 0; window.__scan = 0; const tb = Consoles.tryButton.bind(Consoles); Consoles.tryButton = (...a) => { window.__tb.push(String(a[0])); return tb(...a); }; const cz = Consoles.cycleZoom.bind(Consoles); Consoles.cycleZoom = (...a) => { window.__zoom++; return cz(...a); }; const ss = Consoles.setScan.bind(Consoles); Consoles.setScan = (...a) => { window.__scan++; return ss(...a); }; });
      const spur = () => page.evaluate(() => ({ tb: window.__tb.slice(), zoom: window.__zoom, scan: window.__scan, sent: window.__sent.length }));
      const nullen = () => page.evaluate(() => { window.__tb.length = 0; window.__zoom = 0; window.__scan = 0; window.__sent.length = 0; });
      const tasten = tab === 0 ? ['Enter', 'Shift+KeyQ', 'Shift+KeyW', 'Shift+KeyE', 'KeyL'] : ['KeyT', 'Space', 'KeyZ', 'KeyX', 'KeyH', 'KeyN', 'Shift+KeyT'];
      await zu(page); await nullen();
      for (const k of tasten) await taste(page, k, 80);
      let s = await spur();
      ok(s.tb.length + s.zoom + s.scan > 0, 'Gegenprobe Reiter ' + rn + ', Tafel zu: die Tasten wirken im Reiter (' + JSON.stringify(s) + ')');
      await taste(page, 'KeyB'); await nullen();
      for (const k of tasten) await taste(page, k, 80);
      s = await spur();
      ok(s.tb.length === 0 && s.zoom === 0 && s.scan === 0 && s.sent === 0 && (await zustand(page)).offen, 'Reiter ' + rn + ', Tafel offen: ' + tasten.join(', ') + ' wirken nicht im Reiter und senden nichts (' + JSON.stringify(s) + ')');
      if (tab === 0) ok(s.tb.length === 0, 'Shift+Q und Enter auf dem Funk-Reiter bei offener Tafel senden keine Funkantwort');
      if (tab === 2) {   // M13: Taste auf leerem Tafelfeld (Stufe 1: X, Z, C sind leer) tut nichts im Reiter
        await nullen();
        for (const k of ['KeyX', 'KeyZ', 'KeyC']) await taste(page, k, 80);
        s = await spur();
        ok(s.tb.length === 0 && s.zoom === 0 && s.sent === 0 && (await zustand(page)).offen, 'Taste auf leerem Tafelfeld (X, Z, C) tut nichts im Reiter (' + JSON.stringify(s) + ')');
        await nullen();
        await taste(page, 'Equal', 80);
        ok((await spur()).zoom === 1, 'Zoom (+) der Lage-Karte bleibt bei offener Tafel erlaubt');
        await taste(page, 'Digit1', 120);
        ok(await page.evaluate(() => Consoles.tab) === 0 && (await zustand(page)).offen, 'Reiterziffer 1 bleibt bei offener Tafel erlaubt (Reiter wechselt, Tafel bleibt)');
      }
      ok(errs.length === 0, 'Reiter ' + rn + ': keine Seitenfehler' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));
      await ctx.close();
    }
    // ohne mockbots: Pult wie bisher
    const { ctx, page } = await seite(b, port, 'mock=1&console=captain&tab=2&render=2d&pult=rom');
    await sleep(1000);
    const z = await zustand(page);
    ok(z && !z.bots && z.S === 258, 'Mock ohne Bots: S 258, keine Crew-Zeile');
    await bild(page, '18-mock-ohne-bots');
    await ctx.close();
  });

  // ---------------------------------------------------------------- 7. Designer-Review (W1 bis W3, K6 bis K8, K10)
  // W3: Funk-Reiter mit Funkspruch und Untertiteln (echter Server), Slot der Sprechspalte je Reiter gegen die Bedienflächen des Bildes
  await mitServer('review-funk', async (b, port) => {
    const { ctx, page, errs } = await seite(b, port, 'debug=1&render=2d&pult=rom');
    await startePartie(page, ['navigation', 'ops']);
    await page.keyboard.press('Digit1'); await sleep(300);
    const funk = await page.waitForFunction(() => Hud.radioAktuell && Hud.radioAktuell(), null, { timeout: 20000 }).then(() => true, () => false);
    ok(funk, 'Funk-Reiter: ein Funkspruch steht in der Anzeige (Kasten oben links)');
    await leere(page);
    await taste(page, 'Shift+KeyS', 200);
    ok(await warteAntworten(page, 2), 'Status an alle: zwei Antworten');
    await sleep(500);
    const u = await untertitel(page);
    ok(u.length === 2, 'zwei Untertitel in der Sprechspalte (' + u.join(' | ') + ')');
    const slot = await page.evaluate(() => Hud.sprechSlot(Consoles.view));
    ok(slot.richtung === 'hoch' && slot.y === 216 && slot.x === 178, 'Funk-Reiter: Sprechspalte unten, Unterkante y 216 (4 px über der Frachtleiste y 220), wächst nach oben (' + JSON.stringify(slot) + ')');
    const rect = await page.evaluate(() => { const E = Hud.sprech.eintraege, h = E.reduce((a, e) => a + e.h + 1, 0); return { top: Hud.sprechSlot(Consoles.view).y - h, h }; });
    const knoepfe = await page.evaluate(() => Render.ui.buttons.filter((x) => x.label && x.y < 240).map((x) => ({ x: x.x, y: x.y, w: x.w, h: x.h, label: x.label })));
    const schnitt = knoepfe.filter((k) => k.x < 462 && k.x + k.w > 178 && k.y < 216 && k.y + k.h > rect.top);
    ok(schnitt.length === 0, 'Funk-Reiter: kein Knopf unter den zwei Untertiteln (y ' + rect.top + ' bis 216; ' + knoepfe.length + ' Knöpfe oberhalb der Statusleiste)' + (schnitt.length ? ': ' + schnitt.map((k) => k.label).join(', ') : ''));
    await bild(page, 'r01-funk-funkspruch-untertitel');
    // alle Captain-Reiter: der Slot (ungünstigster Fall 61 hoch) schneidet nie eine Bedienfläche des laufenden Bildes
    for (const tab of [0, 1, 2, 3, 4, 5]) {
      await page.evaluate((t) => { Consoles.tab = t; }, tab); await sleep(350);
      const r = await page.evaluate(() => {
        const s = Hud.sprechSlot(Consoles.view), h = 61, y0 = s.richtung === 'hoch' ? s.y - h : s.y;
        const bt = Render.ui.buttons.filter((x) => x.label && x.y < 240 && x.x < s.x + s.w && x.x + x.w > s.x && x.y < y0 + h && x.y + x.h > y0).map((x) => x.label);
        return { ort: Hud.sprechOrt(Consoles.view), y0, h, bt, n: Render.ui.buttons.length };
      });
      ok(r.bt.length === 0, 'Reiter ' + tab + ' (Slot ' + r.ort + ', Spalte y ' + r.y0 + ' bis ' + (r.y0 + r.h) + '): keine Bedienfläche darunter' + (r.bt.length ? ' – TRIFFT ' + r.bt.join(', ') : ''));
    }
    ok(errs.filter((e) => !/lk is not defined/.test(e)).length === 0, 'keine Seitenfehler (außer dem Altfehler lk, Pult.shieldStrip)' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));
    await ctx.close();
  });
  // W1, W2, K8: Reparaturliste mit Zuständen (Mock dmg=1), beide Skins; K6, K7: gesperrte Direkttaste, Tooltip mit Rolle
  await mitServer('review-mock', async (b, port) => {
    for (const skin of ['rom', 'germanen']) {
      const P = skin === 'rom' ? 'r' : 'rg';
      const { ctx, page, errs } = await seite(b, port, 'mock=1&console=captain&tab=2&markers=1&dmg=1&mockbots=navigation,ops,technik&render=2d&pult=' + skin);
      await page.waitForFunction(() => window.PultBefehl && PultBefehl.menue.hatBots() && PultBefehl.menue.geladen(), null, { timeout: 8000 });
      await sleep(600);
      await taste(page, 'KeyB'); await taste(page, 'KeyE'); await taste(page, 'KeyA');
      const sys = await page.evaluate(() => __game.state.ship.systems), fr = await page.evaluate(() => __game.state.ship.fragile);
      info(skin + ': Zustände ' + JSON.stringify(sys) + ' geflickt ' + JSON.stringify(fr));
      for (let s2 = 1; s2 <= 4; s2++) {
        if (!(await zustand(page)).offen) { await taste(page, 'KeyB'); await taste(page, 'KeyE'); await taste(page, 'KeyA'); for (let i = 1; i < s2; i++) await taste(page, 'KeyR'); }   // die Tafel schließt nach 6 s ohne Taste von selbst (langsamer Rechner)
        const a = await page.evaluate(() => PultBefehl.menue.ansicht().zellen.filter((c) => c.zustand !== 'leer').map((c) => ({ w: c.wert, i: c.info })));
        const falsch = a.filter((c) => { const z = sys[c.w]; const soll = z === 'broken' ? 'zer.' : z === 'damaged' ? 'besch.' : ''; return c.i !== soll; });
        ok(falsch.length === 0, skin + ' Reparieren Seite ' + s2 + ': Info je Feld = Zustand des Schiffs (' + a.map((c) => c.w + ':' + (c.i || '-')).join(' ') + ')');
        await bild(page, P + '14-reparieren-s' + s2); await taste(page, 'KeyR');
      }
      await zu(page);
      // K6/K7: Technik hat hier einen Bot, Navigation ebenfalls; mit Mensch an der Steuerung ist Stopp gesperrt
      ok(errs.filter((e) => !/lk is not defined/.test(e)).length === 0, skin + ': keine Seitenfehler (außer lk)');
      await ctx.close();
    }
    for (const skin of ['rom', 'germanen']) {
      const { ctx, page, errs } = await seite(b, port, 'mock=1&console=captain&tab=0&markers=1&mockbots=ops&render=2d&pult=' + skin);
      await page.waitForFunction(() => window.PultBefehl && PultBefehl.menue.hatBots() && PultBefehl.menue.geladen(), null, { timeout: 8000 });
      await sleep(500);
      await taste(page, 'Shift+KeyX', 150);
      const q = await page.evaluate(() => PultBefehl.menue.crew()[0]);
      ok(q.quittung === 'gesperrt' && q.textKurz === 'NAV gesperrt' && q.fn === 'warn', skin + ': Sh+X ohne Navigation-Bot: Quittung „' + q.textKurz + '“ in warn (Tafel zu)');
      ok(!(await zustand(page)).offen, skin + ': die Tafel bleibt zu');
      await bild(page, 'r05-direkttaste-gesperrt-' + skin);
      await sleep(2100);
      ok((await page.evaluate(() => PultBefehl.menue.crew()[0])).quittung === null, skin + ': nach 2 s ist die Quittung weg');
      // Tooltip an „Sh+X Stopp“ (Crew-Zeile, x 158..250, y 330..344)
      await page.mouse.move(400, 674); await sleep(300);
      const tip = await page.evaluate(() => Render.ui.tooltip && Render.ui.tooltip.text);
      ok(tip === 'Kein Bot an der Navigation', skin + ': Tooltip an Stopp „' + tip + '“');
      await bild(page, 'r06-hover-gesperrt-stopp-' + skin);
      ok(errs.filter((e) => !/lk is not defined/.test(e)).length === 0, skin + ': keine Seitenfehler (außer lk)');
      await ctx.close();
    }
  });
  // K10: Ego-Sitz, offene Tafel, Siegel „Weltstand gesichert“ bleibt über der Einblendung
  await mitServer('review-ego', async (b, port) => {
    const { ctx, page, errs } = await seite(b, port, 'debug=1&render=voxel&pult=rom');
    await page.evaluate(() => __game.send({ t: 'lobbyOpt', startMission: 'free', skipDrill: true }));
    for (const r of ['navigation', 'ops']) { await page.evaluate((x) => __game.send({ t: 'lobbyBot', op: 'add', rolle: x }), r); await sleep(150); }
    await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
    await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
    await page.waitForFunction(() => window.VoxelRender && VoxelRender.ready, null, { timeout: 30000 });
    await page.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'captain', hin: true })); await sleep(1500);
    await page.mouse.move(640, 300);
    await page.evaluate(() => { window.__seal = []; const o = Render.backdrop; Render.backdrop = function (c, x, y, w, h, a) { if (x === 270 && h === 14) window.__seal.push(y); return o.apply(this, arguments); }; });
    await taste(page, 'KeyB', 300);
    await page.evaluate(() => Hud.showSaveSeal(true, 'Weltstand gesichert · Hafen Lichtkordon')); await sleep(700);
    const y = await page.evaluate(() => window.__seal.slice(-1)[0]);
    ok(y != null && y + 14 <= 261, 'Ego-Sitz, Tafel offen: das Siegel liegt über der Einblendung (y ' + y + ' bis ' + (y + 14) + ' <= 261)');
    await bild(page, 'r10-ego-vorn-siegel-tafel-offen');
    await page.evaluate(() => { window.__seal.length = 0; PultBefehl.schliessen(); Hud.showSaveSeal(true, 'Weltstand gesichert · Hafen Lichtkordon'); }); await sleep(700);
    const y2 = await page.evaluate(() => window.__seal.slice(-1)[0]);
    ok(y2 === 342, 'Ego-Sitz, Tafel zu: das Siegel bleibt an seinem alten Platz (y ' + y2 + ')');
    await bild(page, 'r11-ego-vorn-siegel-tafel-zu');
    ok(errs.filter((e) => !/lk is not defined/.test(e)).length === 0, 'keine Seitenfehler (außer lk)');
    await ctx.close();
  });

  console.log(fehlt ? '\n' + fehlt + ' von ' + n + ' Prüfung(en) FEHLGESCHLAGEN' : '\nalle ' + n + ' Prüfungen ok (Bilder: ' + SHOTS + ')');
  process.exit(fehlt ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
