'use strict';
// SYS-03 E „HUD und Sauerstoff entfernen“ (Kai: „brauchen wir nicht“):
//   Server: kein ship.o2 im Schiff, im Snapshot und in der Config (Kein Erstickungsschaden, keine Sauerstoff-Ansage); Weltstand speichert kein o2.
//   Client: drawShipHud (hud.js) läuft in Node gegen einen aufzeichnenden Render-Stub: weder Hüllen-Symbol noch Zonenbalken noch Sauerstoff,
//           Kopfzeile (Marken, Schildmini), Raumname, Sprungzeile und Reaktorhinweis stehen ohne Überlappung untereinander.
//   node tools/test-hud-oben-rechts.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

console.log('Server: kein Sauerstoff');
{
  const g = new Game({ noStore: true, seed: 5, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  g.ship.breachList = [{ tx: 5, ty: 5 }];
  for (let i = 0; i < 300; i++) g.step();
  const sn = g.snapshot().ship;
  ok(!('o2' in g.ship) && !('o2' in sn), 'ship und Snapshot haben kein o2');
  ok(!('o2' in CONFIG) && !('o2PerSec' in CONFIG.breach), 'Config ohne o2-Block und ohne breach.o2PerSec');
  ok(!JSON.stringify(sn).includes('"o2"'), 'Snapshot-JSON enthält nirgends „o2“');
  const ws = fs.readFileSync('server/weltstand.js', 'utf8');
  ok(!/\bo2\b/.test(ws), 'weltstand.js speichert kein o2 (Alt-Stände mit o2-Feld ignorieren es, Format bleibt)');
  for (const f of ['server/game.js', 'server/sim/space.js', 'server/sim/interior.js', 'server/sim/mission.js', 'server/sim/arena.js', 'shared/protocol.js', 'public/js/hud.js']) {
    ok(!/\.o2\b|\bo2:|C\.o2|CONFIG\.o2|'o2'/.test(fs.readFileSync(f, 'utf8')), f + ': kein o2 mehr');
  }
}

console.log('Client: drawShipHud gegen Render-Stub');
{
  const calls = [];
  const rec = (name) => (...a) => { calls.push({ name, a: a.slice(1) }); };
  const R = {
    PAL: new Proxy({}, { get: (t, k) => '#' + String(k) }),
    backdrop: rec('backdrop'), icon: rec('icon'), bar: rec('bar'), text: rec('text'), panel: rec('panel'),
    measure: (t) => String(t).length * 6, locName: (st, id) => id,
  };
  const win = { Render: R, Shared_Maps: { roomAt: () => ({ name: 'Maschinenraum', kind: 'raum' }) }, Shared_Config: CONFIG, Shared_Protocol: require('../shared/protocol.js'), Net: { guard: (n, f) => f(), on() {} } };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(fs.readFileSync('public/js/hud.js', 'utf8'), win, { filename: 'hud.js' });
  const H = win.Hud;
  const ctx = { fillStyle: '', strokeStyle: '', lineWidth: 1, fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, arc() {}, stroke() {} };
  const L = H.HUD_LAYOUT;
  const mk = (jump, reaktor) => ({
    time: 1, self: { x: 3 * 32, y: 3 * 32, zone: 'ship' }, me: {},
    state: { phase: 'play', inventory: { marks: 12 }, ship: { zonen: [100, 100, 100, 100], shields: { current: [2, 2, 2, 2], cap: [4, 4, 4, 4] }, jump: jump || {}, reactor: reaktor || { state: 'online' }, systems: {} } },
  });
  const lauf = (view) => { calls.length = 0; H.drawShipHud(ctx, view); H.drawReactorHint(ctx, view); return calls.slice(); };
  let c = lauf(mk());
  ok(!c.some((x) => x.name === 'icon' && (x.a[0] === 'hull' || x.a[0] === 'o2')), 'kein Icon hull oder o2');
  ok(!c.some((x) => x.name === 'bar'), 'kein Balken (Zonenbalken und Sauerstoffbalken entfallen)');
  ok(!c.some((x) => x.name === 'text' && /VOLL/.test(String(x.a[0]))), 'kein Zonentext „VOLL“');
  ok(c.some((x) => x.name === 'icon' && x.a[0] === 'marks') && c.some((x) => x.name === 'text' && x.a[0] === '12 Marken'), 'Marken stehen da');
  ok(c.some((x) => x.name === 'text' && x.a[0] === 'Maschinenraum'), 'Raumname steht da');
  // Anordnung: Kopfzeile 2..30, Raumname 32..43, Sprungzeile 44..55, Reaktorhinweis darunter mit 5 px Abstand
  const bd = (v) => lauf(v).filter((x) => x.name === 'backdrop').map((x) => ({ y: x.a[1], h: x.a[3] }));
  let b = bd(mk());
  ok(b.length === 2 && b[0].y === L.top && b[0].h === L.kopfH && b[1].y === L.roomY, 'ohne Sprung: Kopf-Backdrop und Raumname-Backdrop');
  ok(b[0].y + b[0].h + 2 === b[1].y, 'Kopfzeile und Raumname: 2 px Lücke wie vorher zwischen den Blöcken');
  b = bd(mk({ dest: 'hafen', ready: true }));
  ok(b.length === 3 && b[2].y === L.jumpY - 1 && b[1].y + b[1].h + 1 === b[2].y, 'mit Sprungzeile: schließt unter dem Raumnamen an (1 px, wie bisher)');
  ok(H.jumpLineH === 12, 'jumpLineH = 12 mit Sprungzeile');
  b = bd(mk({ dest: 'hafen', ready: true }, { state: 'overload', overloadLeft: 60 }));
  ok(b.length === 4 && b[3].y === L.hintY + 12 && b[3].y >= b[2].y + b[2].h + 4, 'Reaktorhinweis (überladen) unter der Sprungzeile, ohne Überlappung: y ' + (b[3] && b[3].y));
  b = bd(mk({}, { state: 'overload', overloadLeft: 60 }));
  ok(b.length === 3 && b[2].y === L.hintY && b[2].y >= b[1].y + b[1].h + 4, 'Reaktorhinweis ohne Sprungzeile: direkt unter dem Raumnamen, y ' + (b[2] && b[2].y));
  // Schildmini liegt innerhalb der Kopfzeile
  ok(L.shieldY - 3 >= L.top && L.shieldY + 15 <= L.top + L.kopfH, 'Schildmini (y-3 bis y+15) liegt innerhalb der Kopfzeile');
  ok(typeof H.zonenAnzeige === 'function', 'zonenAnzeige bleibt exportiert (Außeneinsatz-HUD)');
}

console.log(`\n${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
