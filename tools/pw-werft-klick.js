'use strict';
// PAN-01 D Fix (Kai: leere Waffenplätze und Modulräume ließen sich nicht anklicken): Browser-Test mit ECHTEN Mausklicks am Werft-Terminal.
//   Server:  WORLD_DIR=C:/tmp/werft-klick-world PORT=3366 ROOM_CODE=off MISSION_SOURCE=fallback node server/index.js --debug
//   Test:    node tools/pw-werft-klick.js [port=3366] [bildordner]       (Playwright aus C:/tmp/pw-test)
// Wellen All, Rüstphase (5000 Marken, abgedockt): jede Zelle des Waffenkreuzes und der Modulräume (bestückt, leer, gesperrt), Platzmarken und Räume im Schiffsschnitt und
// die Teilliste werden mit der Maus angeklickt; ein leerer Waffenplatz wird gewählt, eine Waffe gewählt und per Klick eingebaut, ebenso ein Modul in einen leeren Modulraum.
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('C:/tmp/pw-test/node_modules/playwright')); }
const PORT = process.argv[2] || '3366';
const OUT = process.argv[3] || 'C:/Users/Luciu/projects/Pantheon-gestaltung/pan01/pruefung-d/fix2';
try { fs.mkdirSync(OUT, { recursive: true }); } catch (e) { /* egal */ }
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errs = [];
async function warte(page, f, arg, ms) { try { await page.waitForFunction(f, arg, { timeout: ms || 12000, polling: 50 }); return true; } catch (e) { return false; } }
const st = (page, f, arg) => page.evaluate(f, arg);
async function shot(page, name) { await sleep(400); await page.screenshot({ path: path.join(OUT, name + '.png') }); console.log('       Bild ' + name + '.png'); }

// Klickfläche (Beschriftung der Schaltfläche) in Seitenkoordinaten; null, wenn es sie nicht gibt oder sie gesperrt ist
const finde = (page, label) => st(page, (l) => {
  const b = (Render.ui.buttons || []).filter((q) => q.label === l && !q.disabled && typeof q.onClick === 'function').pop();
  if (!b) return null;
  const r = document.getElementById('game').getBoundingClientRect(), k = Client.scale;
  return { x: r.left + (b.x + b.w / 2) * k, y: r.top + (b.y + b.h / 2) * k };
}, label);
async function klick(page, label) {
  let p = null;
  for (let i = 0; i < 40 && !p; i++) { p = await finde(page, label); if (!p) await sleep(100); }
  if (!p) return false;
  await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y);
  await sleep(250);
  return true;
}
const zust = (page) => st(page, () => { const s = TerminalUI.zustand; return { auswahl: s.auswahl, platz: s.platz, raum: s.raum, bereich: s.bereich, teil: s.teil }; });
async function warteAntwort(page, aktion) {
  await st(page, () => { TerminalUI.zustand.antwort = null; });
  await aktion();
  await warte(page, () => !!TerminalUI.zustand.antwort, null, 12000);
  return st(page, () => TerminalUI.zustand.antwort);
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
  if (await st(page, () => __game.state.phase) !== 'lobby') { await st(page, () => __game.send({ t: 'menu', op: 'end' })); await warte(page, () => __game.state.phase === 'lobby', null, 15000); }

  console.log('\n[Start: Wellen All, Rüstphase]');
  await st(page, () => __game.send({ t: 'lobbyOpt', startMission: 'arena_space', szene: 'frei' })); await sleep(300);
  await st(page, () => __game.send({ t: 'ready', ready: true }));
  ok(await warte(page, () => __game.state.phase === 'play' && __game.state.wellen && __game.state.wellen.ph === 'vorbereitung', null, 20000), 'Rüstphase');
  await st(page, () => __game.debugCmd('sitz', { console: 'shop' }));
  ok(await warte(page, () => !!__game.state.werft && TerminalUI.zustand.geoeffnet, null, 15000), 'am Terminal, Werft aktiv (Testumgebung)');
  await sleep(500);

  console.log('\n[Stufe 1 kaufen: nur per Maus]');
  ok(await klick(page, 'Ausbau'), 'Klick: Ausbau');
  const a1 = await warteAntwort(page, () => klick(page, 'Stufe 1 öffnen · 100 M'));
  ok(!!a1 && a1.ok && await st(page, () => __game.state.ship.st) === 1, 'Klick auf "Stufe 1 öffnen": Stufe 1 gekauft');
  await sleep(500);

  console.log('\n[Jede Zelle in jedem Zustand per Maus wählbar]');
  const bestueckt = [8, 4, 6], leer = [7, 9], gesperrt = [5, 2, 1, 3];
  for (const [art, liste] of [['bestückt', bestueckt], ['leer', leer], ['gesperrt', gesperrt]]) {
    for (const p of liste) {
      await st(page, () => TerminalUI.zuruecksetzen());
      const gut = await klick(page, 'Platz ' + p);
      const z = await zust(page);
      ok(gut && z.auswahl === 'platz' && z.platz === p, `Kreuz: Klick auf ${art}en Platz ${p} wählt ihn (${gut ? JSON.stringify(z) : 'nicht klickbar'})`);
    }
  }
  for (const [art, liste] of [['belegt', [1, 2]], ['leer', [3]], ['gesperrt', [4]]]) {
    for (const r of liste) {
      await st(page, () => TerminalUI.zuruecksetzen());
      const gut = await klick(page, 'Modulraum ' + r);
      const z = await zust(page);
      ok(gut && z.auswahl === 'modul' && z.raum === r, `Modulräume: Klick auf ${art}en Raum F${r} wählt ihn`);
    }
  }
  for (const p of [9, 1]) {   // Schiffsschnitt: Platzmarken (leer, gesperrt)
    await st(page, () => TerminalUI.zuruecksetzen());
    const gut = await klick(page, 'Plan Platz ' + p); const z = await zust(page);
    ok(gut && z.platz === p, `Schiffsschnitt: Platzmarke ${p} anklickbar`);
  }
  for (const r of [3, 4]) {   // Schiffsschnitt: Modulräume (leer, gesperrt)
    await st(page, () => TerminalUI.zuruecksetzen());
    const gut = await klick(page, 'Plan Modulraum ' + r); const z = await zust(page);
    ok(gut && z.raum === r, `Schiffsschnitt: Modulraum ${r} anklickbar`);
  }

  console.log('\n[Leerer Waffenplatz: anklicken, Waffe wählen, bestätigen]');
  await st(page, () => TerminalUI.zuruecksetzen());
  ok(await klick(page, 'Platz 9'), 'Klick auf den leeren Platz 9');
  await shot(page, 'fix2-01-leerer-platz-angeklickt');
  ok(await klick(page, 'Standardbatterie'), 'Klick auf die Zeile Standardbatterie');
  await shot(page, 'fix2-02-waffe-gewaehlt');
  const a2 = await warteAntwort(page, () => klick(page, 'Umbau bestätigen'));
  ok(!!a2 && a2.ok && await warte(page, () => __game.state.ship.mounts.some((m) => m.id === 'p9')), 'Klick auf "Umbau bestätigen": Platz 9 trägt eine Standardbatterie (gratis)');
  await shot(page, 'fix2-03-platz-bestueckt');

  console.log('\n[Leerer Modulraum: anklicken, Modul einbauen]');
  await st(page, () => TerminalUI.zuruecksetzen());
  ok(await klick(page, 'Modulraum 3'), 'Klick auf den leeren Modulraum 3');
  await shot(page, 'fix2-04-leerer-modulraum-angeklickt');
  ok(await klick(page, 'Frachtraum'), 'Klick auf die Zeile Frachtraum');
  const a3 = await warteAntwort(page, () => klick(page, 'Modul einbauen'));
  ok(!!a3 && a3.ok && await warte(page, () => __game.state.ship.mod.length === 3), 'Klick auf "Modul einbauen": drei Module');
  await shot(page, 'fix2-05-modul-eingebaut');

  console.log('\n[Gesperrter Platz per Maus: Stufe öffnen]');
  await st(page, () => TerminalUI.zuruecksetzen());
  ok(await klick(page, 'Platz 1'), 'Klick auf den gesperrten Platz 1');
  const mo = await st(page, () => { const m = TerminalUI.modell(__game.client.view); return { a: m.ansicht, t: m.aktionen.haupt.text, h: m.aktionen.hinweis.text }; });
  ok(mo.a === 'stufe' && /^Stufe 2 öffnen · \d+ M$/.test(mo.t), 'zeigt "' + mo.t + '" (' + mo.h + ')');
  await shot(page, 'fix2-06-gesperrter-platz-preis');

  console.log('\n[Weitere Klickziele]');
  ok(await klick(page, 'Handel') && await st(page, () => TerminalUI.zustand.bereich) === 'handel', 'Klick H: Handel');
  ok(await klick(page, 'Ersatzteil') && await st(page, () => TerminalUI.zustand.handel) === 'ersatzteil', 'Handel-Kachel anklickbar');
  await shot(page, 'fix2-07-handel');
  ok(await klick(page, 'Werft') && await st(page, () => TerminalUI.zustand.bereich) === 'werft', 'Klick W: Werft');
  ok(await klick(page, 'Platz 8') && await klick(page, 'Standardkanone') && await st(page, () => TerminalUI.zustand.teil) === 'standardkanone', 'Teilliste: Zeile anklickbar (Platz 8)');
  ok(await klick(page, 'Ausbau') && await st(page, () => TerminalUI.zustand.auswahl) === 'stufe', 'Aktionsknopf Ausbau');
  ok(await st(page, () => __game.state.errors) === 0, 'Server-Fehlerzähler 0');
  ok(!(await st(page, () => __game.errors)), 'Client-Fehlerzähler 0');
  ok(errs.length === 0, 'keine Browser-Konsolenfehler ' + (errs[0] || ''));
  await b.close();
  console.log(`\npw-werft-klick: ${n - fails}/${n} ok`);
  process.exit(fails || errs.length ? 1 : 0);
})().catch((e) => { console.error('Abbruch: ' + (e && e.message)); process.exit(2); });
