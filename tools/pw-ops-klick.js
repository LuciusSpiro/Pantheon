'use strict';
// PAN-01 D Fix: Browser-Test mit ECHTEN Mausklicks an der Ops-Waffenkonsole (Kai: neue, nie benutzte Waffe ließ sich nicht per Klick mit Energie versorgen).
//   Server:  WORLD_DIR=C:/tmp/werft-klick-world PORT=3366 ROOM_CODE=off MISSION_SOURCE=fallback node server/index.js --debug
//   Test:    node tools/pw-ops-klick.js [port=3366] [bildordner]       (Playwright aus C:/tmp/pw-test)
// Wellen All (Raumkampf), Ops, Debug bestueck alle 3 (neun neue Waffen, keine benutzt): Ladepunkte werden mit der Maus genommen (Rechtsklick), dann einer neuen Waffe
// per Linksklick gegeben (kein Fehlerton), per Mausrad +1/−1 und per Rechtsklick −1; leerer/gesperrter Platz: Hinweis statt Stille; Fehlerton (Consoles.denied) bleibt aus.
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
const alloc = (page, id) => st(page, (i) => { const m = (__game.state.ship.mounts || []).find((q) => q.id === i); return m ? m.alloc : null; }, id);
// Seitenkoordinaten der Mitte der Waffenzelle (Consoles.waffenZellen: Leinwandkoordinaten)
const zelle = (page, id) => st(page, (i) => {
  const z = (Consoles.waffenZellen || []).find((q) => q.id === i); if (!z) return null;
  const r = document.getElementById('game').getBoundingClientRect(), k = Client.scale;
  return { x: r.left + (z.x + z.w / 2) * k, y: r.top + (z.y + z.h / 2) * k };
}, id);
async function maus(page, id, was) {
  let p = null; for (let i = 0; i < 40 && !p; i++) { p = await zelle(page, id); if (!p) await sleep(100); }
  if (!p) return false;
  await page.mouse.move(p.x, p.y);
  if (was === 'links') await page.mouse.click(p.x, p.y);
  else if (was === 'rechts') await page.mouse.click(p.x, p.y, { button: 'right' });
  else if (was === 'rad+') await page.mouse.wheel(0, -120);
  else if (was === 'rad-') await page.mouse.wheel(0, 120);
  await sleep(350);
  return true;
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
  await st(page, () => __game.send({ t: 'lobbyOpt', startMission: 'arena_space', szene: 'frei' })); await sleep(300);
  await st(page, () => __game.send({ t: 'ready', ready: true }));
  ok(await warte(page, () => __game.state.phase === 'play' && __game.state.wellen, null, 20000), 'Wellen All gestartet (Rüstphase)');
  await st(page, () => __game.debugCmd('bestueck', { args: 'alle 3' }));
  await st(page, () => __game.debugCmd('sitz', { console: 'weapons' }));
  ok(await warte(page, () => { const m = __game.state.players.find((p) => p.id === __game.client.pid); return m.console === 'weapons' && (__game.state.ship.mounts || []).length >= 8 && (Consoles.waffenZellen || []).length >= 8; }, null, 20000), 'an der Ops, neun neue Waffen (Stufe 3)');
  // Fehlerton mitzählen
  await st(page, () => { window.__denied = []; const d = Consoles.denied.bind(Consoles); Consoles.denied = function (t) { window.__denied.push(t); return d(t); }; });
  const denied = () => st(page, () => window.__denied.slice());
  const ids = await st(page, () => (Consoles.waffenZellen || []).map((z) => z.id));
  ok(ids.length >= 7, 'Energiewaffen-Zellen: ' + ids.join(' '));

  console.log('\n[Punkte per Rechtsklick nehmen]');
  for (const id of ids) for (let k = 0; k < 5 && (await alloc(page, id)) > 0; k++) await maus(page, id, 'rechts');
  const rest = await Promise.all(ids.map((id) => alloc(page, id)));
  ok(rest.every((v) => v === 0), 'alle Waffen ohne Punkte (neu, nie benutzt): ' + rest.join(' '));
  ok((await denied()).length === 0, 'kein Fehlerton beim Nehmen');
  await shot(page, 'fix2-08-ops-alle-ohne-punkte');

  console.log('\n[Neue Waffe anklicken: Punkt geben]');
  const neu = ids.includes('p9') ? 'p9' : ids[ids.length - 1];
  await maus(page, neu, 'links');
  ok(await warte(page, (i) => { const m = (__game.state.ship.mounts || []).find((q) => q.id === i); return m && m.alloc === 1; }, neu), `Linksklick auf ${neu}: Ladepunkt +1`);
  ok((await denied()).length === 0, 'Fehlerton bleibt aus');
  await shot(page, 'fix2-09-ops-punkt-per-klick');
  await maus(page, neu, 'rad+');
  ok(await warte(page, (i) => { const m = (__game.state.ship.mounts || []).find((q) => q.id === i); return m && m.alloc === 2; }, neu), 'Mausrad hoch: +1 (2)');
  await maus(page, neu, 'rad-');
  ok(await warte(page, (i) => { const m = (__game.state.ship.mounts || []).find((q) => q.id === i); return m && m.alloc === 1; }, neu), 'Mausrad runter: −1 (1)');
  await maus(page, neu, 'rechts');
  ok(await warte(page, (i) => { const m = (__game.state.ship.mounts || []).find((q) => q.id === i); return m && m.alloc === 0; }, neu), 'Rechtsklick: −1 (0)');
  ok((await denied()).length === 0, 'kein Fehlerton bei Rad und Rechtsklick');
  // jede neue Waffe nimmt per Klick einen Punkt (solange Punkte frei sind)
  let gegeben = 0;
  for (const id of ids) { const vor = await alloc(page, id); await maus(page, id, 'links'); if (await warte(page, (a) => { const m = (__game.state.ship.mounts || []).find((q) => q.id === a[0]); return m && m.alloc === a[1] + 1; }, [id, vor], 3000)) gegeben++; }
  const cp = await st(page, () => __game.state.ship.chargePoints);
  ok(gegeben === Math.min(ids.length, cp), `jede neue Waffe nimmt per Klick einen Punkt, bis der Pool leer ist (${gegeben} von ${ids.length}, Pool ${cp})`);
  const d2 = await denied();
  ok(d2.every((t) => /Alle Ladepunkte verteilt|Maximum/.test(t)), 'Grenzen nennen den Grund (' + d2.join(' | ') + ')');
  await shot(page, 'fix2-10-ops-punkte-verteilt');

  console.log('\n[Leerer und gesperrter Platz]');
  await st(page, () => __game.debugCmd('bestueck', { args: 'start' }));
  await sleep(800);
  const leer = await st(page, () => { const r = document.getElementById('game').getBoundingClientRect(), k = Client.scale; return (Render.ui.buttons || []).filter((q) => /^Platz [1-9]$/.test(q.label) && !q.disabled).map((q) => ({ l: q.label, x: r.left + (q.x + q.w / 2) * k, y: r.top + (q.y + q.h / 2) * k })); });
  ok(leer.length >= 1, 'leere/gesperrte Plätze sind Klickflächen: ' + leer.map((q) => q.l).join(', '));
  await st(page, () => { window.__notizen = []; const f = Hud.pushNotice.bind(Hud); Hud.pushNotice = function (t, c) { window.__notizen.push(t); return f(t, c); }; });
  if (leer.length) { await page.mouse.move(leer[0].x, leer[0].y); await page.mouse.click(leer[0].x, leer[0].y); await sleep(400); }
  const notizen = await st(page, () => window.__notizen);
  ok(notizen.some((t) => /gesperrt|keine Waffe/.test(t)) && (await denied()).length === d2.length, 'Klick auf einen leeren/gesperrten Platz: Hinweis "' + (notizen[0] || '') + '", kein Fehlerton');
  await shot(page, 'fix2-11-ops-leerer-platz-hinweis');

  ok(await st(page, () => __game.state.errors) === 0, 'Server-Fehlerzähler 0');
  ok(!(await st(page, () => __game.errors)), 'Client-Fehlerzähler 0');
  ok(errs.length === 0, 'keine Browser-Konsolenfehler ' + (errs[0] || ''));
  await b.close();
  console.log(`\npw-ops-klick: ${n - fails}/${n} ok`);
  process.exit(fails || errs.length ? 1 : 0);
})().catch((e) => { console.error('Abbruch: ' + (e && e.message)); process.exit(2); });
