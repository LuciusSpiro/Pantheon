'use strict';
// AUS-01 E: Boden-HUD bekommt die Slots aus dem Stand-Ereignis (ausruestungStand), nicht aus dem Snapshot.
// Geprüft: Stand beim Beamen nach unten (nur an den Spieler), Aktualisierung bei Rückholung/erneutem Beamen, Wiederverbinden am Boden,
// Länge 3 (1 und 2 Spieler) bzw. 2 (3 Spieler), kein Snapshot-Feld, toter Client-Zustand myWaffe entfernt.
//   node tools/test-ausruestung-hud.js  (npm run test:ausruestung-hud)
const fs = require('fs');
const path = require('path');
const { Game } = require('../server/game.js');
const away = require('../server/sim/away.js');

let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function partie(n, seed) {
  const g = new Game({ noStore: true, seed, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < n; i++) {
    const c = { inbox: [], send(o) { this.inbox.push(o); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'H' + n + i, name: 'Hud' + i, color: i }); cs.push(c);
  }
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });   // erst wenn alle verbunden sind: die Slotzahl wird beim Start festgesetzt
  for (let k = 0; k < 6; k++) g.step();
  g.setAwayMap('kesh');
  return { g, cs };
}
const staende = (c) => c.inbox.filter((m) => m.kind === 'ausruestungStand');
const setze = (g, c, p, slot, id) => { p.console = 'ausruestung'; g.handleMessage(c, { t: 'cmd', c: 'ausruestung.slot', slot, id }); p.console = null; };

section('Gruppen 1, 2 und 3 Spieler: Länge des Stands beim Beamen');
for (const [n, erwartet] of [[1, 3], [2, 3], [3, 2]]) {
  const { g, cs } = partie(n, 11 + n);
  ok(g.slotzahl === erwartet, n + ' Spieler: Slotzahl ' + erwartet);
  for (const c of cs) c.inbox.length = 0;
  away.executeBeam(g, g.players.map((p) => p.id), 'down');
  const alle = cs.every((c) => staende(c).length === 1);
  ok(alle, n + ' Spieler: beim Beamen genau ein Stand je Spieler');
  const e = staende(cs[0])[0];
  ok(e && e.pid === g.players[0].id && e.slotzahl === erwartet && e.slots.length === erwartet, n + ' Spieler: Stand mit Slotzahl ' + erwartet + ' und ' + erwartet + ' Slots');
  ok(cs.every((c, i) => staende(c).every((m) => m.pid === g.players[i].id)), n + ' Spieler: jeder Stand nur an den eigenen Spieler (pid passt zur Verbindung)');
}

section('Inhalt, Aktualisierung bei Rückholung und erneutem Beamen');
{
  const { g, cs } = partie(2, 21);
  const [a, b] = g.players;
  setze(g, cs[0], a, 0, 'sturmgewehr'); setze(g, cs[0], a, 1, 'lanze');
  cs[0].inbox.length = 0; cs[1].inbox.length = 0;
  away.executeBeam(g, [a.id], 'down');
  const e1 = staende(cs[0]);
  ok(e1.length === 1 && JSON.stringify(e1[0].slots) === JSON.stringify(['sturmgewehr', 'lanze', null]), 'Stand: Sturmgewehr, Lanze, leer');
  ok(staende(cs[1]).length === 0, 'der Mitspieler an Bord bekommt nichts');
  g.support.recall = 0; g.ship.systems.transfer = 'ok';
  ok(away.recall(g, a.id) === null && a.zone === 'ship', 'Notrückholung');
  setze(g, cs[0], a, 0, null); setze(g, cs[0], a, 1, null);
  cs[0].inbox.length = 0;
  away.executeBeam(g, [a.id], 'down');
  const e2 = staende(cs[0]);
  ok(e2.length === 1 && e2[0].slots.every((x) => x === null) && a.waffe === 'faust', 'erneutes Beamen: aktualisierter Stand (alles leer), aktive Waffe Faust');
}

section('Wiederverbinden am Boden');
{
  const { g, cs } = partie(2, 31);
  const [a] = g.players;
  setze(g, cs[0], a, 0, 'granatwerfer');
  away.executeBeam(g, [a.id], 'down');
  const neu = { inbox: [], send(o) { this.inbox.push(o); } };
  g.addConnection(neu);
  g.handleMessage(neu, { t: 'hello', clientId: a.clientId, name: 'Hud0', color: 0 });
  const e = staende(neu);
  ok(a.zone === 'away' && e.length === 1 && e[0].slots[0] === 'granatwerfer', 'Wiederverbinden während der Außenmission: Stand kommt erneut');
  const an = { inbox: [], send(o) { this.inbox.push(o); } };
  g.addConnection(an);
  const bClient = g.players[1].clientId;
  g.handleMessage(an, { t: 'hello', clientId: bClient, name: 'Hud1', color: 1 });
  ok(staende(an).length === 0, 'Wiederverbinden an Bord: kein Stand (die Station fragt selbst)');
}

section('Kein Snapshot-Wachstum, toter Zustand entfernt');
{
  const { g } = partie(2, 41);
  const s = JSON.stringify(g.snapshot());
  ok(!/slotzahl|loadout|slots/.test(s), 'Snapshot enthält kein Slot-/Loadout-Feld');
}
ok(!/myWaffe/.test(read('public/js/client.js')), 'K.myWaffe ist aus client.js entfernt');
ok(/loadoutStand/.test(read('public/js/hud.js')) && /H\.loadoutStand = /.test(read('public/js/client.js')), 'Client hält einen Stand (H.loadoutStand), HUD zeichnet daraus');

section('Slot-Leiste: welches Feld leuchtet (hud.js in Node gegen Render-Stub)');
{
  const vm = require('vm');
  const CONFIG = require('../shared/config.js');
  const R = { PAL: new Proxy({}, { get: (t, k) => '#' + String(k) }), text() {}, measure: (t) => String(t).length * 6 };
  const win = { Render: R, Shared_Maps: {}, Shared_Config: CONFIG, Shared_Protocol: require('../shared/protocol.js'), Net: { guard: (n, f) => f(), on() {} } };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(read('public/js/hud.js'), win, { filename: 'hud.js' });
  const H = win.Hud;
  const akt = H.aktiverSlot;
  ok(akt(['sturmgewehr', 'lanze', null], 'lanze') === 1, 'wf in Slot 2 -> Index 1');
  ok(akt(['sturmgewehr', 'lanze', null], 'sturmgewehr') === 0, 'wf in Slot 1 -> Index 0');
  ok(akt(['sturmgewehr', 'lanze', null], 'blaster') === -1, 'wf nicht im Loadout (Debug-Waffe) -> -1');
  ok(akt([null, null, null], 'faust') === -1, 'leeres Loadout, wf Faust -> -1');
  ok(akt(['lanze', null], 'faust') === -1, 'Gefangener (Faust) mit belegtem Loadout -> -1 (nicht Slot 1)');
  ok(akt(['lanze', null], undefined) === -1 && akt(['lanze', null], null) === -1, 'ohne wf -> -1');
  // Zeichnen: Das hervorgehobene Feld ist das mit der Füllung #B83A2E
  const zeichne = (slots, wf) => {
    const felder = [];
    const ctx = { fillStyle: '', strokeStyle: '', lineWidth: 1, fillRect(x, y, w, h) { felder.push({ x, c: this.fillStyle }); }, strokeRect() {} };
    H.drawSlotZeile.call(Object.assign(Object.create(H), { loadoutStand: { slotzahl: slots.length, slots } }), ctx, { me: { wf } }, 8, 50);
    return felder.filter((f) => f.c === '#B83A2E').length;
  };
  ok(zeichne(['sturmgewehr', 'lanze', null], 'lanze') === 1, 'drawSlotZeile: genau ein Feld hervorgehoben, wenn wf im Loadout steckt');
  ok(zeichne(['sturmgewehr', 'lanze', null], 'faust') === 0 && zeichne([null, null], 'faust') === 0 && zeichne(['lanze', null], 'blaster') === 0, 'drawSlotZeile: nichts hervorgehoben, wenn wf nicht im Loadout steckt');
}

console.log(fails ? '\n' + fails + ' FEHLER' : '\nalle ok');
process.exit(fails ? 1 : 0);
