'use strict';
// PAN-01 D (Kai 2026-10-22): Browser-Test der Testumgebung der Werft (Wellen All, Wellen Boden, Szenario-Labor) mit echten Tasten und Bildern.
//   Server:  WORLD_DIR=C:/tmp/werft-test-world PORT=3366 ROOM_CODE=off MISSION_SOURCE=fallback node server/index.js --debug     (Rüstphase ist im echten Server an; RUESTPHASE=0 schaltet sie ab)
//   Test:    node tools/pw-werft-testumgebung.js [port=3366] [bildordner]       (Playwright aus C:/tmp/pw-test; Port nicht 3300/3301/3355)
// Je Modus: Lobby-Wahl wie über die Taste M (lobbyOpt), Marken = Testmarken, Terminal an der Handelskonsole (hier per Debug sitz, sonst E im Meetingraum), Werft aktiv mit Grund
// „Testumgebung“ abgedockt, Ausbau und Umbau ohne Debug-Befehle, Rüstphase und Start (Taste G). Exit 1 bei Fehlschlag oder Browser-Konsolenfehlern.
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('C:/tmp/pw-test/node_modules/playwright')); }
const PORT = process.argv[2] || '3366';
const OUT = process.argv[3] || 'C:/Users/Luciu/projects/Pantheon-gestaltung/pan01/pruefung-d/testumgebung';
try { fs.mkdirSync(OUT, { recursive: true }); } catch (e) { /* egal */ }
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errs = [];
async function warte(page, f, arg, ms) { try { await page.waitForFunction(f, arg, { timeout: ms || 12000, polling: 50 }); return true; } catch (e) { return false; } }
const st = (page, f, arg) => page.evaluate(f, arg);
async function shot(page, name) { await sleep(400); await page.screenshot({ path: path.join(OUT, name + '.png') }); console.log('       Bild ' + name + '.png'); }
const taste = async (page, k, ms) => { await page.keyboard.press(k); await sleep(ms || 150); };
const modell = (page) => st(page, () => { const m = TerminalUI.modell(__game.client.view); return { kopf: m.kopf, start: m.start && m.start.text, haupt: m.aktionen && m.aktionen.haupt && m.aktionen.haupt.text, ansicht: m.ansicht }; });

async function zurLobby(page) {
  await st(page, () => __game.send({ t: 'menu', op: 'end' }));
  await warte(page, () => __game.state.phase === 'lobby', null, 15000);
  await sleep(500);
}
async function starten(page, opts) {
  await st(page, (o) => { __game.send(Object.assign({ t: 'lobbyOpt' }, o)); }, opts);
  await sleep(300);
  await st(page, () => __game.send({ t: 'ready', ready: true }));
  return warte(page, () => __game.state.phase === 'play' && __game.state.players.length, null, 20000);
}
async function sitzen(page) {
  await st(page, () => __game.debugCmd('sitz', { console: 'shop' }));
  return warte(page, () => !!__game.state.werft && TerminalUI.zustand.geoeffnet, null, 15000);
}

(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/?debug=1&sitz=0`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.players && window.__game.client.pid, null, { timeout: 15000 });
  } catch (e) { console.log('  FEHLER Seite laden: ' + e.message); await b.close(); process.exit(1); }
  const testmarken = await st(page, () => Shared_Config.werft.testmarken);
  if (await st(page, () => __game.state.phase) !== 'lobby') await zurLobby(page);   // wiederholbar: ein früherer Lauf kann in einer Partie stehen geblieben sein

  // ---------------------------------------------------------------- Wellen All
  console.log('\n[Wellen All (Raumkampf)]');
  ok(await starten(page, { startMission: 'arena_space', szene: 'frei' }), 'Partie Wellen All gestartet');
  ok(await warte(page, () => __game.state.wellen && __game.state.wellen.ph === 'vorbereitung'), 'Rüstphase: wellen.ph vorbereitung');
  ok(await st(page, () => __game.state.inventory.marks) === testmarken, 'Marken = Testmarken (' + testmarken + ')');
  await shot(page, 't1-wellen-all-ruestphase-welt');
  ok(await sitzen(page), 'am Terminal');
  let w = await st(page, () => __game.state.werft);
  ok(!!w && w.aktiv === true && w.test === 1 && w.grund === 'Testumgebung', 'Werft aktiv, abgedockt, Grund Testumgebung');
  ok(await st(page, () => !__game.state.ship.docked), 'Schiff ist nicht angedockt');
  await shot(page, 't1-wellen-all-terminal-werft');
  await taste(page, 'KeyA'); await shot(page, 't1-wellen-all-terminal-ausbau');
  await taste(page, 'KeyF', 400);
  ok(await warte(page, () => __game.state.ship.st === 1), 'Stufe 1 gekauft (F), abgedockt');
  await taste(page, 'KeyA'); await taste(page, 'Digit9'); await taste(page, 'ArrowDown');
  await taste(page, 'Enter', 400);
  ok(await warte(page, () => __game.state.ship.mounts.some((m) => m.id === 'p9')), 'Umbau Platz 9 (Enter) abgedockt');
  await taste(page, 'KeyH'); await shot(page, 't1-wellen-all-terminal-handel');
  await taste(page, 'KeyW');
  const mo = await modell(page);
  ok(mo.start === 'Szene starten' && mo.kopf.art === 'test', 'Knopf "Szene starten", Kopf TESTUMGEBUNG');
  await shot(page, 't1-wellen-all-terminal-start');
  await taste(page, 'KeyG', 500);
  ok(await warte(page, () => __game.state.wellen.ph === 'countdown' || __game.state.wellen.ph === 'kampf'), 'Taste G: die Szene startet (Countdown)');
  ok(await warte(page, () => __game.state.wellen.ph === 'kampf', null, 30000), 'Welle 1 läuft');
  await taste(page, 'Escape', 300);
  await shot(page, 't1-wellen-all-welle-laeuft');
  ok(await st(page, () => __game.state.errors) === 0, 'Server-Fehlerzähler 0');
  await zurLobby(page);

  // ---------------------------------------------------------------- Wellen Boden
  console.log('\n[Wellen Boden]');
  ok(await starten(page, { startMission: 'arena_away', wellen: 'aussenposten' }), 'Partie Wellen Boden gestartet');
  ok(await warte(page, () => __game.state.wellen && __game.state.wellen.ph === 'vorbereitung'), 'Rüstphase');
  ok(await st(page, () => { const m = __game.state.players.find((p) => p.id === __game.client.pid); return m.zone === 'ship'; }), 'die Crew steht an Bord (nicht unten)');
  ok(await st(page, () => __game.state.inventory.marks) === testmarken, 'Marken = Testmarken');
  await shot(page, 't2-wellen-boden-ruestphase-welt');
  ok(await sitzen(page), 'am Terminal');
  w = await st(page, () => __game.state.werft);
  ok(!!w && w.aktiv && w.test === 1, 'Werft aktiv (Testumgebung)');
  await taste(page, 'KeyA'); await taste(page, 'KeyF', 300);
  ok(await warte(page, () => __game.state.ship.st === 1), 'Stufe 1 vor dem Hinunterbeamen');
  await taste(page, 'KeyA'); await taste(page, 'Digit7'); await taste(page, 'ArrowUp');   // Platz 7: Lanzenbatterie (kostet), Freischalten
  await taste(page, 'KeyF', 300);
  await shot(page, 't2-wellen-boden-terminal-werft');
  await taste(page, 'KeyG', 800);
  ok(await warte(page, () => { const m = __game.state.players.find((p) => p.id === __game.client.pid); return m.zone === 'away'; }, null, 15000), 'nach G beamt die Crew hinunter');
  await sleep(1500);
  await shot(page, 't2-wellen-boden-unten');
  ok(await st(page, () => __game.state.errors) === 0, 'Server-Fehlerzähler 0');
  await zurLobby(page);

  // ---------------------------------------------------------------- Labor
  console.log('\n[Szenario-Labor]');
  const lab = await st(page, () => (__game.state.lobby && __game.state.lobby.laborListe && __game.state.lobby.laborListe[0] && __game.state.lobby.laborListe[0].id) || null);
  await st(page, () => __game.send({ t: 'lobbyOpt', startMission: 'labor' })); await sleep(400);
  const lab2 = await st(page, () => ((__game.state.lobby || {}).laborListe || [{}])[0].id || null);
  ok(await starten(page, { startMission: 'labor', labor: { id: lab2 || lab } }), 'Labor gestartet ' + (lab2 || lab));
  ok(await warte(page, () => __game.state.inventory.marks === Shared_Config.werft.testmarken, null, 8000), 'Marken = Testmarken');
  ok(await sitzen(page), 'am Terminal');
  w = await st(page, () => __game.state.werft);
  ok(!!w && w.aktiv && w.test === 1 && w.grund === 'Testumgebung', 'Werft aktiv, Grund Testumgebung');
  await shot(page, 't3-labor-terminal-werft');
  await taste(page, 'KeyA'); await taste(page, 'KeyF', 400);
  ok(await warte(page, () => __game.state.ship.st === 1), 'Labor: Ausbau am Terminal');
  await shot(page, 't3-labor-terminal-nach-ausbau');
  ok(await st(page, () => __game.state.errors) === 0, 'Server-Fehlerzähler 0');
  const cz = await st(page, () => __game.errors);
  ok(!cz, 'Client-Fehlerzähler ' + cz);
  ok(errs.length === 0, 'keine Browser-Konsolenfehler ' + (errs[0] || ''));
  await b.close();
  console.log(`\npw-werft-testumgebung: ${n - fails}/${n} ok`);
  process.exit(fails || errs.length ? 1 : 0);
})().catch((e) => { console.error('Abbruch: ' + (e && e.message)); process.exit(2); });
