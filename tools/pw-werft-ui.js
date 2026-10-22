'use strict';
// PAN-01 D2: Browser-Test des Werft-Terminals (Playwright, drei Spieler, echte Tasten) gegen einen laufenden Debug-Server.
//   Server:  WORLD_DIR=C:/tmp/werft-world PORT=3355 ROOM_CODE=off MISSION_SOURCE=fallback node server/index.js --debug
//   Test:    node tools/pw-werft-ui.js [port=3355] [bildordner]          (Playwright aus C:/tmp/pw-test: npm i playwright)
// Der Test ist wiederholbar auf demselben Server: er setzt am Anfang alles zurück (alle stehen von den Konsolen auf, Debug werft reset, ausbau 0, bestueck start, modul start, Marken,
// Torpedos, Ort Castra Martis) und wartet auf Bedingungen statt auf feste Zeiten (warte/warteBis). Fehlt eine Voraussetzung, steht FEHLER im Protokoll und der Lauf geht weiter
// oder endet geordnet mit Exit 1 (kein Absturz). Geprüft: Handel, Werft (gesperrter Raum mit Preis, Ausbau, Umbau mit Vorschau, Freischalten, Fehler zu wenig Marken, Module F1–F4,
// leer), gesperrt im Lichtkordon, Zuschauer (E am besetzten Terminal), Mehrspieler (Kauf nacheinander, einmal abgebucht, Konsole nach Esc frei) und die Bilder (bildordner).
// Exit 1 bei einem Fehlschlag, Browser-Konsolenfehlern oder Fehlerzähler > 0.
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('C:/tmp/pw-test/node_modules/playwright')); }
const PORT = process.argv[2] || '3355';
const OUT = process.argv[3] || 'C:/Users/Luciu/projects/Pantheon-gestaltung/pan01/pruefung-d/fix';
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errs = [];
try { fs.mkdirSync(OUT, { recursive: true }); } catch (e) { /* egal */ }

async function seite(browser, name) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on('pageerror', (e) => errs.push(name + ' pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(name + ' console: ' + m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/?debug=1&sitz=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.players && window.__game.client.pid, null, { timeout: 10000 });
  await page.evaluate(() => { window.__fKeys = []; window.addEventListener('keydown', (e) => { if (/^F[1-4]$/.test(e.code)) window.__fKeys.push([e.code, e.defaultPrevented]); }); });
  return page;
}
// Bedingung im Browser abwarten (true/false), nie werfen
// Die Seiten rendern in Software (Voxel, WebGL): einzelne Bilder dauern Sekunden, deshalb großzügige Fristen (bei Erfolg kehrt jede Prüfung sofort zurück)
async function warte(page, f, ms) { try { await page.waitForFunction(f, null, { timeout: ms || 10000, polling: 50 }); return true; } catch (e) { return false; } }
async function warteBis(page, f, arg, ms) { try { await page.waitForFunction(f, arg, { timeout: ms || 10000, polling: 50 }); return true; } catch (e) { return false; } }
const st = (page, f, arg) => page.evaluate(f, arg);
const werft = (page) => st(page, () => (window.__game.state || {}).werft || null);
const marksJetzt = (page) => st(page, () => window.__game.state.inventory.marks);
async function marksWird(page, soll) { await warteBis(page, (m) => window.__game.state.inventory.marks === m, soll, 10000); return marksJetzt(page); }   // der Snapshot folgt der Antwort
const dbg = (page, cmd, extra) => st(page, ([c, e]) => window.__game.debugCmd(c, e), [cmd, extra || {}]);
async function shot(page, name) { await sleep(300); await page.screenshot({ path: path.join(OUT, name + '.png') }); console.log('       Bild ' + name + '.png'); }
const taste = async (page, k, ms) => { await page.keyboard.press(k); await sleep(ms || 120); };
const konsole = (page) => st(page, () => { const g = window.__game, m = (g.state.players || []).find((p) => p.id === g.client.pid); return m ? m.console : null; });
const farbeVon = (page) => st(page, () => { const g = window.__game, m = (g.state.players || []).find((p) => p.id === g.client.pid); return m ? m.color : null; });
async function antwort(page, aktion) {   // letzte werftAntwort nach einer Aktion abwarten
  await page.evaluate(() => { window.TerminalUI.zustand.antwort = null; });
  await aktion();
  const got = await warte(page, () => !!window.TerminalUI.zustand.antwort, 10000);
  return got ? st(page, () => window.TerminalUI.zustand.antwort) : null;
}
const modell = (page) => st(page, () => { const m = window.TerminalUI.modell(window.__game.client.view); return { haupt: m.aktionen && m.aktionen.haupt && m.aktionen.haupt.text, hinweis: m.aktionen && m.aktionen.hinweis && m.aktionen.hinweis.text, ansicht: m.ansicht, bereich: m.bereich, titel: m.titel }; });
// E antippen und warten, bis der Server die Konsole belegt hat; in der langsamen Software-Darstellung können Drücken und Loslassen im selben Server-Tick ankommen
// (die Aktion geht dann verloren), deshalb bis zu vier Versuche
async function setzen(page) {
  for (let i = 0; i < 4; i++) {
    await taste(page, 'KeyE', 100);
    if (await warteBis(page, () => { const g = window.__game, m = g.state.players.find((p) => p.id === g.client.pid); return m.console === 'shop'; }, null, 3500)) return i + 1;
  }
  return 0;
}
async function aufstehen(page) { if (await konsole(page)) { await taste(page, 'Escape', 200); await warte(page, () => { const g = window.__game, m = g.state.players.find((p) => p.id === g.client.pid); return !m.console; }, 2000); } }

(async () => {
  const b = await chromium.launch();
  let p1, p2, p3;
  try {
    p1 = await seite(b, 'P1'); p2 = await seite(b, 'P2'); p3 = await seite(b, 'P3');
  } catch (e) { console.log('  FEHLER Seiten laden: ' + e.message); await b.close(); process.exit(1); }

  // ---------------------------------------------------------------- Zurücksetzen (Test ist wiederholbar)
  console.log('\n[Start]');
  for (const p of [p1, p2, p3]) await aufstehen(p);
  await dbg(p1, 'goto', { loc: 'castra_martis', docked: true });
  ok(await warte(p1, () => window.__game.state.ship && window.__game.state.ship.dockedAt === 'castra_martis', 5000), 'Schiff liegt in Castra Martis');
  await dbg(p1, 'werft', { args: 'reset' }); await dbg(p1, 'ausbau', { args: '0' }); await dbg(p1, 'bestueck', { args: 'start' }); await dbg(p1, 'modul', { args: 'start' });
  await dbg(p1, 'marken', { args: '1000' }); await dbg(p1, 'inv', { item: 'bolzen', n: 6 });
  await warteBis(p1, () => window.__game.state.inventory.marks === 1000 && !window.__game.state.ship.st, null, 3000);
  const farben = [await farbeVon(p1), await farbeVon(p2), await farbeVon(p3)];
  ok(new Set(farben).size === 3 && farben.every((f) => f != null), 'drei Spieler an Bord, Farben ' + farben.join(','));
  await dbg(p1, 'sitz', { console: 'shop' });
  ok(await warte(p1, () => !!window.__game.state.werft), 'Snapshot-Block werft nach dem Hinsetzen');
  let w = await werft(p1);
  ok(!!w && w.aktiv === true && w.nutzer === farben[0] && w.stufe === 0, 'Castra Martis: Werft aktiv, Stufe 0, Nutzer = Farbe von P1');
  ok(await konsole(p1) === 'shop', 'P1 sitzt an der Konsole shop');
  ok(await warte(p1, () => window.TerminalUI.zustand.geoeffnet), 'Terminal geöffnet');

  // ---------------------------------------------------------------- Handel
  console.log('\n[Handel]');
  await taste(p1, 'KeyH');
  await taste(p1, 'ArrowDown'); await taste(p1, 'ArrowDown'); await taste(p1, 'ArrowDown');
  await shot(p1, 'fix-07-handel-kreuz-gedimmt');
  const m0 = await marksJetzt(p1);
  const sel = await st(p1, () => window.TerminalUI.zustand.handel);
  await taste(p1, 'Enter', 100);
  const m1 = await marksWird(p1, m0 - 10);
  ok(m1 < m0, `Handel: Enter kauft ${sel} (Marken ${m0} -> ${m1})`);
  await dbg(p1, 'inv', { item: 'bolzen', n: 6 });

  // ---------------------------------------------------------------- Gesperrter Raum mit Preis, Ausbau
  console.log('\n[Werft: gesperrter Raum, Ausbau]');
  await taste(p1, 'KeyW');
  await taste(p1, 'F4');
  let mo = await modell(p1);
  ok(/^Stufe 1 öffnen · 100 M$/.test(mo.haupt || ''), 'F4 (Stufe 2) noch zu: Hauptknopf kauft den nächsten Schritt mit Preis: "' + mo.haupt + '"');
  ok(/^F4 ab Stufe 2 · dann 180 M$/.test(mo.hinweis || ''), 'Hinweis: "' + mo.hinweis + '"');
  await shot(p1, 'fix-03-gesperrter-raum-mit-preis');
  await taste(p1, 'Digit9');
  await taste(p1, 'KeyA');
  mo = await modell(p1);
  ok(mo.ansicht === 'stufe', 'A: Ausbau-Ansicht');
  const mS = await marksJetzt(p1);
  let a = await antwort(p1, () => taste(p1, 'KeyF', 50));
  ok(!!a && a.ok, 'Stufe 1: Server bestätigt (' + (a && a.text) + ')');
  ok(await marksWird(p1, mS - 100) === mS - 100 && await warte(p1, () => window.__game.state.ship.st === 1), 'Stufe 1: 100 Marken abgebucht, Schiff auf Stufe 1');
  ok(await st(p1, () => window.TerminalUI.zustand.auswahl) === 'platz', 'nach dem Stufenkauf zurück zur Platzansicht');
  await sleep(300);
  await shot(p1, 'fix-02-stufe-gekauft');
  const mF = await marksJetzt(p1);
  await taste(p1, 'KeyF', 150);   // zweites F: kauft keine Stufe 2 (Platz 9, Leer eingebaut: Hinweis)
  await sleep(300);
  ok(await marksJetzt(p1) === mF && await st(p1, () => window.__game.state.ship.st) === 1, 'ein zweites F kauft nicht still die nächste Stufe');
  await dbg(p1, 'marken', { args: '1000' });
  await marksWird(p1, 1000);

  // ---------------------------------------------------------------- Umbau Platz 9 mit Vorschau
  console.log('\n[Werft: Umbau]');
  await taste(p1, 'Digit9');
  await taste(p1, 'ArrowDown');   // Leer -> Standardbatterie
  let m9 = await marksJetzt(p1);
  a = await antwort(p1, () => taste(p1, 'Enter', 50));
  ok(!!a && a.ok && await marksWird(p1, m9) === m9, 'Standardbatterie auf Platz 9: Umbau gratis (' + (a && a.text) + ')');
  ok(await warte(p1, () => window.__game.state.ship.mounts.some((m) => m.id === 'p9')), 'Platz 9 trägt jetzt eine Waffe (Snapshot mounts p9)');
  await taste(p1, 'ArrowDown'); await taste(p1, 'ArrowDown');   // Sturm, Streu
  ok(await warte(p1, () => Object.keys(window.TerminalUI.zustand.vorschau.cache).length > 0), 'Vorschau vom Server angefordert (werft.vorschau -> werftVorschau)');
  await shot(p1, 'fix-01-umbau-5-eintraege-kostet');
  m9 = await marksJetzt(p1);
  a = await antwort(p1, () => taste(p1, 'KeyF', 50));
  ok(!!a && a.ok && await marksWird(p1, m9 - 70) === m9 - 70, 'Streubatterie freigeschaltet (70 Marken)');
  await warte(p1, () => { const c = window.TerminalUI.zustand.vorschau.cache; return Object.keys(c).some((k) => /streubatterie/.test(k)); });
  await shot(p1, 'fix-01b-umbau-vorschau-bereit');
  m9 = await marksJetzt(p1);
  a = await antwort(p1, () => taste(p1, 'Enter', 50));
  ok(!!a && a.ok && await marksWird(p1, m9) === m9, 'Platz 9: Streubatterie, gratis');
  ok(await warte(p1, () => { const m = window.__game.state.ship.mounts.find((q) => q.id === 'p9'); return !!m && m.typ === 'streubatterie'; }), 'Snapshot mounts p9 typ streubatterie');

  // ---------------------------------------------------------------- Fehlerfall zu wenig Marken
  console.log('\n[Fehlerfall]');
  await dbg(p1, 'marken', { args: '10' }); await marksWird(p1, 10);
  await taste(p1, 'ArrowDown');   // Lanzenbatterie (120)
  a = await antwort(p1, () => taste(p1, 'KeyF', 50));
  ok(!!a && !a.ok && /Marken/.test(a.text), 'zu wenig Marken: Server lehnt ab, Text im Terminal: ' + (a && a.text));
  mo = await modell(p1);
  ok(/^Es fehlen 110 Marken$/.test(mo.hinweis || ''), 'Hinweis nennt den fehlenden Betrag: "' + mo.hinweis + '"');
  ok(await marksJetzt(p1) === 10, 'nichts abgebucht');
  await shot(p1, 'fix-04-fehler-zu-wenig-marken');
  await taste(p1, 'KeyH'); await sleep(250);
  await shot(p1, 'fix-05-handel-zu-wenig-marken');
  await dbg(p1, 'marken', { args: '1000' }); await marksWird(p1, 1000);
  await taste(p1, 'KeyW');

  // ---------------------------------------------------------------- Module
  console.log('\n[Module F1–F4]');
  await taste(p1, 'KeyA');
  a = await antwort(p1, () => taste(p1, 'KeyF', 50));
  ok(!!a && a.ok && await warte(p1, () => window.__game.state.ship.st === 2), 'Stufe 2 gekauft (Modulraum 4 und Platz 2, 5 offen)');
  await taste(p1, 'F4');
  const fk = await st(p1, () => window.__fKeys);
  ok(fk.length > 0 && fk.every((q) => q[1] === true), 'F4: preventDefault gesetzt (Browser-Hilfe/Suche bleiben zu) ' + JSON.stringify(fk));
  await taste(p1, 'ArrowUp');   // Fracht, Kranken, Werkstatt, Leer: vom leeren Raum (Leer) eins hoch = Werkstatt (kostet)
  await shot(p1, 'fix-09-modul-f4-werkstatt-kostet');
  a = await antwort(p1, () => taste(p1, 'KeyF', 50));
  ok(!!a && a.ok, 'Werkstatt freigeschaltet');
  a = await antwort(p1, () => taste(p1, 'Enter', 50));
  ok(!!a && a.ok && await warte(p1, () => window.__game.state.ship.mod.length === 3), 'Werkstatt in Modulraum 4: drei Module');
  await taste(p1, 'F2');
  a = await antwort(p1, async () => { await taste(p1, 'ArrowDown', 60); await taste(p1, 'ArrowDown', 60); await taste(p1, 'Enter', 50); });   // Kranken (eingebaut) -> Werkstatt -> Leer
  ok(!!a && a.ok && await warte(p1, () => window.__game.state.ship.mod.length === 2), 'Modulraum F2 leeren ("Leer lassen"): zwei Module');
  await shot(p1, 'fix-10-module-leer');

  // ---------------------------------------------------------------- Zuschauer
  console.log('\n[Zuschauer]');
  await dbg(p2, 'tp', { args: '17 25' }); await dbg(p3, 'tp', { args: '17 25' });
  await warteBis(p2, () => { const g = window.__game, m = g.state.players.find((p) => p.id === g.client.pid); return Math.abs(m.y - 25 * 32 - 16) < 4; }, null, 3000);
  await p2.keyboard.down('KeyA'); await sleep(250); await p2.keyboard.up('KeyA');
  const ia = await st(p2, () => JSON.stringify(window.__game.client.view.interaction));
  await taste(p2, 'KeyE', 100);
  ok(await warte(p2, () => window.TerminalUI.zusehend === true), 'P2: E am besetzten Terminal öffnet die Zuschauer-Ansicht (Interaktion ' + ia + ')');
  ok(/am Gerät · E zusehen/.test(ia), 'Hinweis nennt die Farbe statt des Namens');
  ok(await warte(p1, (f) => (window.__game.state.werft.zu || []).indexOf(f) >= 0, 4000) || await warteBis(p1, (f) => ((window.__game.state.werft || {}).zu || []).indexOf(f) >= 0, farben[1], 4000), 'Snapshot nennt P2 als Zuschauer');
  await taste(p1, 'Digit5');
  ok(await warteBis(p2, () => { const u = (window.__game.state.werft || {}).ui; return !!u && u.n === 5; }, null, 4000), 'P2 sieht die Ansicht von P1 (Platz 5)');
  mo = await modell(p2);
  ok(mo.titel === 'ZUSEHEN' && /bedient$/.test(mo.haupt || ''), 'Zuschauer: Titel ZUSEHEN, Hauptknopf "' + mo.haupt + '"');
  await shot(p2, 'fix-06-zuschauer');
  const mz = await marksJetzt(p2);
  await taste(p2, 'KeyF', 200); await taste(p2, 'Enter', 200); await taste(p2, 'KeyA', 200);
  ok(await marksJetzt(p2) === mz && await st(p1, () => window.TerminalUI.zustand.auswahl) !== 'stufe', 'Zuschauer bedient nichts (Marken und Ansicht von P1 unverändert)');

  // ---------------------------------------------------------------- Mehrspieler: nacheinander kaufen
  console.log('\n[Mehrspieler]');
  await dbg(p1, 'marken', { args: '500' }); await marksWird(p1, 500);
  await taste(p1, 'Digit2');
  ok(await st(p1, () => window.TerminalUI.zustand.platz) === 2, 'P1 wählt Platz 2');
  await taste(p1, 'ArrowUp');   // Liste Heck: Torpedowerfer, Abwehrturm, Leer: eins hoch = Abwehrturm
  const mK = await marksJetzt(p1);
  a = await antwort(p1, () => taste(p1, 'KeyF', 50));
  ok(!!a && a.ok, 'P1 schaltet Abwehrturm frei: ' + (a && a.text));
  ok(await marksWird(p1, mK - 70) === mK - 70, 'einmal abgebucht (70)');
  await taste(p1, 'Escape', 150);
  ok(await warte(p1, () => { const g = window.__game, m = g.state.players.find((p) => p.id === g.client.pid); return !m.console; }), 'P1 steht nach Esc auf (Konsole frei)');
  ok(await warte(p2, () => !window.TerminalUI.zusehend), 'P2: Zuschauer-Ansicht schließt sich, wenn P1 aufsteht');
  await p2.keyboard.down('KeyA'); await sleep(200); await p2.keyboard.up('KeyA');
  const ia2 = await warteBis(p2, () => { const i = window.__game.client.view.interaction; return !!i && i.ok === true && !i.zusehen; }, null, 3000);
  const v2 = await setzen(p2);
  ok(v2 > 0, 'P2 sitzt jetzt am Terminal (E am freien Terminal, Interaktion frei: ' + ia2 + ', Versuche ' + v2 + ')');
  await warte(p2, () => !!window.__game.state.werft && window.TerminalUI.zustand.geoeffnet);
  await taste(p2, 'KeyW'); await taste(p2, 'Digit2'); await taste(p2, 'ArrowUp');
  const mD = await marksJetzt(p2);
  a = await antwort(p2, () => taste(p2, 'KeyF', 50));
  ok(!!a && !a.ok && /schon freigeschaltet/i.test(a.text) && await marksJetzt(p2) === mD, 'P2 kauft dasselbe: abgelehnt, kein Doppelkauf (' + (a && a.text) + ')');
  await taste(p2, 'ArrowUp');   // Torpedowerfer
  const mE = await marksJetzt(p2);
  a = await antwort(p2, () => taste(p2, 'KeyF', 50));
  ok(!!a && a.ok && await marksWird(p2, mE - 100) === mE - 100, 'P2 schaltet den Torpedowerfer frei (100 Marken)');
  const t0 = Date.now();
  await taste(p2, 'Escape', 150);
  ok(await warte(p2, () => { const g = window.__game, m = g.state.players.find((p) => p.id === g.client.pid); return !m.console; }, 12000), 'P2 steht auf, Konsole wieder frei (nach ' + (Date.now() - t0) + ' ms ' + await st(p2, () => JSON.stringify([window.__game.client.pid, window.__game.state.players.map((q) => [q.id, q.connected, q.console])])) + ')');
  await p3.keyboard.down('KeyA'); await sleep(200); await p3.keyboard.up('KeyA');
  const v3 = await setzen(p3);
  ok(v3 > 0, 'P3 sitzt am Terminal (Versuche ' + v3 + ')');
  await taste(p3, 'Escape', 150);
  ok(await warte(p3, () => { const g = window.__game, m = g.state.players.find((p) => p.id === g.client.pid); return !m.console; }), 'P3 steht auf');
  ok(await warte(p1, () => !window.__game.state.werft), 'ohne Nutzer am Terminal: kein Block werft im Snapshot');

  // ---------------------------------------------------------------- Gesperrt im Lichtkordon
  console.log('\n[Gesperrt]');
  await dbg(p1, 'goto', { loc: 'hafen', docked: true });
  await warte(p1, () => window.__game.state.ship.dockedAt === 'hafen', 5000);
  await dbg(p1, 'sitz', { console: 'shop' });
  await warte(p1, () => !!window.__game.state.werft, 4000);
  w = await werft(p1);
  ok(!!w && w.aktiv === false && /Nur an Flottenbasen/.test(w.grund || ''), 'Lichtkordon: aktiv false, Grund "' + (w && w.grund) + '"');
  await sleep(300);
  await shot(p1, 'fix-11-handel-nicht-werft');
  await taste(p1, 'KeyW');
  await shot(p1, 'fix-08-gesperrte-werft');
  const mG = await marksJetzt(p1);
  await taste(p1, 'KeyF', 200); await taste(p1, 'Enter', 200);
  ok(await marksJetzt(p1) === mG, 'gesperrt: F und Enter ändern nichts');
  await taste(p1, 'KeyH');
  const mH = await marksJetzt(p1);
  await taste(p1, 'Enter', 100);
  ok(await marksWird(p1, mH - 1) < mH, 'Handel bleibt nutzbar: Enter kauft');
  // Ablegen: wer sitzt, steht auf
  await dbg(p1, 'goto', { loc: 'splitter', docked: false });
  ok(await warte(p1, () => { const g = window.__game, m = g.state.players.find((p) => p.id === g.client.pid); return !m.console && !g.state.werft; }, 15000), 'Abdocken: der Nutzer steht auf, kein Block werft im Flug (' + await st(p1, () => JSON.stringify([window.__game.state.ship.docked, window.__game.state.ship.dockedAt, window.__game.state.ship.scene, !!window.__game.state.werft, window.__game.state.players.map((q) => q.console)])) + ')');

  // ---------------------------------------------------------------- Fehlerzähler
  const fz = await st(p1, () => window.__game.state.errors);
  ok(fz === 0, 'Server-Fehlerzähler ' + fz);
  const cz = await st(p1, () => window.__game.errors);
  ok(!cz, 'Client-Fehlerzähler ' + cz + (cz ? ' ' + await st(p1, () => JSON.stringify(window.__game.firstError || window.__game.errorLog || null).slice(0, 400)) : ''));
  ok(errs.length === 0, 'keine Browser-Konsolenfehler ' + (errs[0] || ''));
  await b.close();
  console.log(`\npw-werft-ui: ${n - fails}/${n} ok`);
  process.exit(fails || errs.length ? 1 : 0);
})().catch((e) => { console.error('Abbruch: ' + (e && e.message)); process.exit(2); });
