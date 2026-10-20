'use strict';
// PAN-01 D2: Browser-Test des Werft-Terminals (Playwright, drei Spieler) gegen einen laufenden Debug-Server mit ROOM_CODE=off:
//   WORLD_DIR=C:/tmp/werft-world PORT=3355 ROOM_CODE=off MISSION_SOURCE=fallback node server/index.js --debug
//   node tools/pw-werft-ui.js [port=3355] [ausgabeordner]
// Prüft mit echten Tasten: Handel, Werft (Stufe kaufen, Umbau mit Vorschau, Freischalten, Fehler zu wenig Marken, Modulräume F1–F4, leer), gesperrt im Lichtkordon,
// Zuschauer (E am besetzten Terminal), Mehrspieler (Kauf nacheinander, einmal abgebucht, Konsole nach Esc frei) und schreibt Screenshots.
// Playwright aus C:/tmp/pw-test (npm i playwright dort). Exit 1 bei einem Fehlschlag, Browser-Konsolenfehlern oder Fehlerzähler > 0.
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('C:/tmp/pw-test/node_modules/playwright')); }
const PORT = process.argv[2] || '3355';
const OUT = process.argv[3] || 'C:/Users/Luciu/projects/Pantheon-gestaltung/pan01/pruefung-d';
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errs = [];

async function seite(browser, name) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on('pageerror', (e) => errs.push(name + ' pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(name + ' console: ' + m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/?debug=1&sitz=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.players, null, { timeout: 8000 });
  // Standard-Browser-Hilfe/Suche: merken, ob F1–F4 abgefangen wurden
  await page.evaluate(() => { window.__fKeys = []; window.addEventListener('keydown', (e) => { if (/^F[1-4]$/.test(e.code)) window.__fKeys.push([e.code, e.defaultPrevented]); }); });
  return page;
}
const st = (page, f) => page.evaluate(f);
const werft = (page) => page.evaluate(() => (window.__game.state || {}).werft || null);
const marks = async (page) => { await sleep(350); return page.evaluate(() => window.__game.state.inventory.marks); };   // Snapshot kommt kurz nach der Antwort
const farbeVon = (page) => page.evaluate(() => { const g = window.__game, m = (g.state.players || []).find((p) => p.id === g.client.pid); return m ? m.color : null; });
const dbg = (page, cmd, extra) => page.evaluate(([c, e]) => window.__game.debugCmd(c, e), [cmd, extra || {}]);
async function warte(page, f, ms) { try { await page.waitForFunction(f, null, { timeout: ms || 4000 }); return true; } catch (e) { return false; } }
async function shot(page, name) { await sleep(250); await page.screenshot({ path: path.join(OUT, name + '.png') }); console.log('       Bild ' + name + '.png'); }
const taste = async (page, k, ms) => { await page.keyboard.press(k); await sleep(ms || 180); };
const meineKonsole = (page) => page.evaluate(() => { const g = window.__game, m = (g.state.players || []).find((p) => p.id === g.client.pid); return m ? m.console : null; });
async function antwort(page, aktion) {   // letzte werftAntwort nach einer Aktion abwarten
  await page.evaluate(() => { window.TerminalUI.zustand.antwort = null; });
  await aktion();
  const got = await warte(page, () => { const a = window.TerminalUI.zustand.antwort; return a && performance.now() - a.t < 4000; }, 3000);
  return got ? page.evaluate(() => window.TerminalUI.zustand.antwort) : null;
}

(async () => {
  const b = await chromium.launch();
  const p1 = await seite(b, 'P1'), p2 = await seite(b, 'P2'), p3 = await seite(b, 'P3');
  await sleep(500);
  // ---------------------------------------------------------------- Start: Castra Martis, Marken
  console.log('\n[Start]');
  await dbg(p1, 'goto', { loc: 'castra_martis', docked: true });
  await sleep(600);
  await dbg(p1, 'marken', { args: '1000' });
  const farben = [await farbeVon(p1), await farbeVon(p2), await farbeVon(p3)];
  ok(new Set(farben).size === 3 && farben.every((f) => f != null), 'drei Spieler an Bord, Farben ' + farben.join(','));
  await dbg(p1, 'sitz', { console: 'shop' });
  ok(await warte(p1, () => !!(window.__game.state.werft)), 'Snapshot-Block werft nach dem Hinsetzen');
  let w = await werft(p1);
  ok(w.aktiv === true && w.nutzer === farben[0], 'Castra Martis: Werft aktiv, Nutzer = Farbe von P1');
  ok(await meineKonsole(p1) === 'shop', 'P1 sitzt an der Konsole shop');

  // ---------------------------------------------------------------- Handel
  console.log('\n[Handel]');
  await taste(p1, 'KeyH');
  await taste(p1, 'ArrowDown'); await taste(p1, 'ArrowDown'); await taste(p1, 'ArrowDown');
  await shot(p1, 'd2-01-handel');
  const m0 = await marks(p1);
  const sel = await st(p1, () => window.TerminalUI.zustand.handel);
  await taste(p1, 'Enter', 600);
  const m1 = await marks(p1);
  ok(m1 < m0, `Handel: Enter kauft ${sel} (Marken ${m0} -> ${m1})`);
  // Torpedo bis Lager 12
  await dbg(p1, 'inv', { item: 'bolzen', n: 12 });
  await sleep(300);
  // ---------------------------------------------------------------- Werft: Stufe 1 kaufen
  console.log('\n[Werft: Ausbau]');
  await taste(p1, 'KeyW');
  await taste(p1, 'Digit9');
  await shot(p1, 'd2-02-platz9-gesperrt-stufe1');
  await taste(p1, 'KeyA');
  await shot(p1, 'd2-03-ausbau-stufe1-freischalten');
  const mS = await marks(p1);
  let a = await antwort(p1, () => taste(p1, 'KeyF', 100));
  ok(a && a.ok, 'Stufe 1: Server bestätigt (' + (a && a.text) + ')');
  await sleep(500);
  ok((await marks(p1)) === mS - 100 && (await st(p1, () => window.__game.state.ship.st)) === 1, `Stufe 1: 100 Marken abgebucht, Schiff auf Stufe 1 (Marken ${await marks(p1)})`);
  await dbg(p1, 'marken', { args: '1000' });

  // ---------------------------------------------------------------- Umbau Platz 9 mit Vorschau
  console.log('\n[Werft: Umbau]');
  await taste(p1, 'KeyA');   // zurück zur Platzansicht
  await taste(p1, 'Digit9');
  await taste(p1, 'ArrowDown');   // Leer -> Standardbatterie
  const m9 = await marks(p1);
  a = await antwort(p1, () => taste(p1, 'Enter', 100));
  ok(a && a.ok && (await marks(p1)) === m9, 'Standardbatterie auf Platz 9: Umbau gratis (' + (a && a.text) + ')');
  await sleep(500);
  ok(await st(p1, () => window.__game.state.ship.mounts.some((m) => m.id === 'p9')), 'Platz 9 trägt jetzt eine Waffe (Snapshot mounts p9)');
  await taste(p1, 'ArrowDown'); await taste(p1, 'ArrowDown');   // Sturm, Streu
  await sleep(600);
  await shot(p1, 'd2-04-umbau-vorschau-kostet-streu');
  const m9b = await marks(p1);
  a = await antwort(p1, () => taste(p1, 'KeyF', 100));
  ok(a && a.ok && (await marks(p1)) === m9b - 70, 'Streubatterie freigeschaltet (70 Marken)');
  await sleep(700);
  const vor = await st(p1, () => JSON.stringify(window.TerminalUI.zustand.vorschau.cache));
  ok(/"nachher"/.test(vor), 'Vorschau vom Server angefordert (werft.vorschau -> werftVorschau)');
  await shot(p1, 'd2-05-umbau-vorschau-streu-bereit');
  const m9c = await marks(p1);
  a = await antwort(p1, () => taste(p1, 'Enter', 100));
  await sleep(500);
  ok(a && a.ok && (await marks(p1)) === m9c && await st(p1, () => window.__game.state.ship.mounts.find((m) => m.id === 'p9').typ === 'streubatterie'), 'Platz 9 auf Streubatterie umgebaut: gratis, im Snapshot typ streubatterie');
  await shot(p1, 'd2-06-umgebaut');
  // ---------------------------------------------------------------- Fehlerfall: zu wenig Marken
  console.log('\n[Fehlerfall]');
  await dbg(p1, 'marken', { args: '10' }); await sleep(300);
  await taste(p1, 'ArrowDown');   // Lanzenbatterie (120)
  a = await antwort(p1, () => taste(p1, 'KeyF', 100));
  ok(a && !a.ok && /Marken/.test(a.text), 'zu wenig Marken: Server lehnt ab, Text im Terminal: ' + (a && a.text));
  ok((await marks(p1)) === 10, 'nichts abgebucht');
  await shot(p1, 'd2-07-fehler-zu-wenig-marken');
  await dbg(p1, 'marken', { args: '1000' });

  // ---------------------------------------------------------------- Module
  console.log('\n[Module F1–F4]');
  await taste(p1, 'KeyA');
  a = await antwort(p1, () => taste(p1, 'KeyF', 100));
  ok(a && a.ok && (await st(p1, () => window.__game.state.ship.st)) === 2, 'Stufe 2 gekauft (Modulraum 4 und Platz 2, 5 offen)');
  await taste(p1, 'KeyA');
  await taste(p1, 'F4');
  const fk = await st(p1, () => window.__fKeys);
  ok(fk.length > 0 && fk.every((q) => q[1] === true), 'F4: preventDefault gesetzt (Browser-Hilfe/Suche bleiben zu) ' + JSON.stringify(fk));
  await taste(p1, 'ArrowUp');   // Liste Fracht, Kranken, Werkstatt, Leer: vom leeren Raum (Leer) eins hoch = Werkstatt (kostet)
  await sleep(500);
  await shot(p1, 'd2-08-modul-f4-werkstatt-kostet');
  a = await antwort(p1, () => taste(p1, 'KeyF', 100));
  ok(a && a.ok, 'Werkstatt freigeschaltet');
  a = await antwort(p1, () => taste(p1, 'Enter', 100));
  await sleep(500);
  ok(a && a.ok && await st(p1, () => window.__game.state.ship.mod.length === 3), 'Werkstatt in Modulraum 4: drei Module');
  await taste(p1, 'F3'); await taste(p1, 'F2');
  await shot(p1, 'd2-09-module-f2');
  a = await antwort(p1, () => { return taste(p1, 'ArrowDown', 100).then(() => taste(p1, 'ArrowDown', 100)).then(() => taste(p1, 'Enter', 100)); });   // Kranken (eingebaut) -> Werkstatt -> Leer
  await sleep(400);
  ok(a && a.ok && await st(p1, () => window.__game.state.ship.mod.length === 2), 'Modulraum F2 leeren ("Leer lassen"): zwei Module');
  await shot(p1, 'd2-10-module-leer');

  // ---------------------------------------------------------------- Zuschauer
  console.log('\n[Zuschauer]');
  await dbg(p2, 'tp', { args: '17 25' }); await dbg(p3, 'tp', { args: '17 25' });
  await sleep(500);
  await p2.keyboard.down('KeyA'); await sleep(250); await p2.keyboard.up('KeyA');
  const ia = await st(p2, () => JSON.stringify(window.__game.client.view.interaction));
  await taste(p2, 'KeyE', 300);
  ok(await st(p2, () => window.TerminalUI.zusehend === true), 'P2: E am besetzten Terminal öffnet die Zuschauer-Ansicht (Interaktion ' + ia + ')');
  await sleep(700);
  w = await werft(p1);
  ok(Array.isArray(w.zu) && w.zu.includes(farben[1]), 'Snapshot nennt P2 als Zuschauer (zu ' + JSON.stringify(w.zu) + ')');
  await taste(p1, 'Digit5'); await sleep(500);
  const ui2 = await st(p2, () => JSON.stringify(window.__game.state.werft.ui));
  ok(/"n":5/.test(ui2), 'P2 sieht die Ansicht von P1 (ui ' + ui2 + ')');
  await shot(p2, 'd2-11-zuschauer');
  const mz = await marks(p2);
  await taste(p2, 'KeyF', 300); await taste(p2, 'Enter', 300); await taste(p2, 'KeyA', 300);
  ok((await marks(p2)) === mz && (await st(p1, () => window.TerminalUI.zustand.auswahl)) !== 'stufe', 'Zuschauer bedient nichts (Marken und Ansicht von P1 unverändert)');
  // ---------------------------------------------------------------- Mehrspieler: nacheinander kaufen
  console.log('\n[Mehrspieler]');
  await dbg(p1, 'marken', { args: '500' });
  await taste(p1, 'Digit2'); await sleep(300);   // Heck 2
  const gleich = await st(p1, () => window.TerminalUI.zustand.platz);
  ok(gleich === 2, 'P1 wählt Platz 2');
  // Liste Heck: Torpedowerfer, Abwehrturm, Leer (leer = eingebaut): eins hoch = Abwehrturm
  await taste(p1, 'ArrowUp'); await sleep(200);
  const mK = await marks(p1);
  a = await antwort(p1, () => taste(p1, 'KeyF', 100));
  ok(a && a.ok, 'P1 schaltet Abwehrturm frei: ' + (a && a.text));
  ok((await marks(p1)) === mK - 70, 'einmal abgebucht (70)');
  await taste(p1, 'Escape', 400);
  ok(await meineKonsole(p1) === null, 'P1 steht nach Esc auf (Konsole frei)');
  await sleep(500);
  ok(await st(p2, () => !window.TerminalUI.zusehend), 'P2: Zuschauer-Ansicht schließt sich, wenn P1 aufsteht');
  // P2 sitzt per E ans Terminal und kauft dasselbe noch einmal
  await taste(p2, 'KeyE', 600);
  ok(await meineKonsole(p2) === 'shop', 'P2 sitzt jetzt am Terminal (E am freien Terminal)');
  await sleep(500);
  await taste(p2, 'KeyW'); await taste(p2, 'Digit2'); await taste(p2, 'ArrowUp'); await sleep(300);
  const mD = await marks(p2);
  a = await antwort(p2, () => taste(p2, 'KeyF', 100));
  ok(a && !a.ok && /schon freigeschaltet/i.test(a.text) && (await marks(p2)) === mD, 'P2 kauft dasselbe: abgelehnt, kein Doppelkauf (' + (a && a.text) + ')');
  // P2 kauft etwas anderes
  await taste(p2, 'ArrowUp'); await sleep(200);   // Torpedowerfer
  const mE = await marks(p2);
  a = await antwort(p2, () => taste(p2, 'KeyF', 100));
  ok(a && a.ok && (await marks(p2)) === mE - 100, 'P2 schaltet den Torpedowerfer frei (100 Marken)');
  await taste(p2, 'Escape', 400);
  ok(await meineKonsole(p2) === null, 'P2 steht auf, Konsole wieder frei');
  await taste(p3, 'KeyA', 50); await sleep(100);
  await p3.keyboard.down('KeyA'); await sleep(250); await p3.keyboard.up('KeyA');
  await taste(p3, 'KeyE', 600);
  ok(await meineKonsole(p3) === 'shop', 'P3 sitzt am Terminal');
  await taste(p3, 'Escape', 400);
  ok(await meineKonsole(p3) === null, 'P3 steht auf');
  const fr = await st(p1, () => window.__game.state.werft);
  ok(fr === null || fr === undefined, 'ohne Nutzer am Terminal: kein Block werft im Snapshot');

  // ---------------------------------------------------------------- Gesperrt im Lichtkordon
  console.log('\n[Gesperrt]');
  await dbg(p1, 'goto', { loc: 'hafen', docked: true }); await sleep(800);
  await dbg(p1, 'sitz', { console: 'shop' });
  await warte(p1, () => !!(window.__game.state.werft));
  w = await werft(p1);
  ok(w && w.aktiv === false && /Nur an Flottenbasen/.test(w.grund), 'Lichtkordon: aktiv false, Grund "' + (w && w.grund) + '"');
  await sleep(400);
  await shot(p1, 'd2-12-handel-nicht-werft');
  await taste(p1, 'KeyW');
  await shot(p1, 'd2-13-gesperrt');
  const mG = await marks(p1);
  await taste(p1, 'KeyF', 300); await taste(p1, 'Enter', 300);
  ok((await marks(p1)) === mG, 'gesperrt: F und Enter ändern nichts');
  await taste(p1, 'KeyH');
  const mH = await marks(p1);
  await taste(p1, 'Enter', 700);
  ok((await marks(p1)) < mH, 'Handel bleibt nutzbar: Enter kauft');

  // ---------------------------------------------------------------- Fehlerzähler
  const fz = await st(p1, () => window.__game.state.errors);
  ok(fz === 0, 'Server-Fehlerzähler ' + fz);
  ok(errs.length === 0, 'keine Browser-Konsolenfehler ' + (errs[0] || ''));
  await b.close();
  console.log(`\npw-werft-ui: ${n - fails}/${n} ok`);
  process.exit(fails || errs.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
