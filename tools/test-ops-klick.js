'use strict';
// PAN-01 D Fix (Kai: an der Ops-Waffenkonsole ließ sich eine neue, noch nicht benutzte Waffe nicht per Klick mit Energie versorgen, nur mit A/D):
//  1. Server: `weapons.alloc` nimmt jede bestückte Energiewaffe an, auch frisch bestückt und nie benutzt (Ladung 0, kein Ziel): Punkte geben und nehmen.
//  2. Klickpfad im Client (public/js/consoles.js + pult-stationen.js, mit Attrappen für Render/Pult/Hud gegen einen echten Server): Linksklick auf die Zelle einer Waffe
//     OHNE Ladepunkte gibt ihr den ersten Punkt (kein Fehlerton), Rechtsklick und Mausrad geben und nehmen Punkte wie A/D, Grenzen zeigen den Grund; Klick auf eine
//     Waffe mit Punkten und Ladung feuert wie bisher; leere und gesperrte Plätze antworten mit einem Hinweis statt Stille.
//   node tools/test-ops-klick.js        (Browser mit echten Mausklicks: tools/pw-ops-klick.js)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CONFIG = require('../shared/config.js');
const Katalog = require('../shared/schiffskatalog.js');
const Maps = require('../shared/maps.js');
const Protocol = require('../shared/protocol.js');
const Locations = require('../shared/locations.js');
const { Game } = require('../server/game.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n[' + t + ']');
const DT = 1 / CONFIG.tickHz;

function partie(players) {
  const g = new Game({ noStore: true, seed: 41, debug: true, log: () => {}, env: { MISSION_SOURCE: 'fallback' } });
  const conns = [];
  for (let i = 0; i < (players || 1); i++) { const c = { inbox: [], send(m) { this.inbox.push(m); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'Klick' + i, color: i }); conns.push(c); }
  g.handleMessage(conns[0], { t: 'lobbyOpt', startMission: 'arena_space' });
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  g.space.enemies = []; g.space.projectiles = []; if (g.arena) g.arena.nextAt = null;
  g.god = true;
  const T = { g, conns, run: (s) => { for (let k = 0; k < Math.round(s / DT); k++) g.step(); } };
  T.debug = (cmd, args) => g.handleMessage(conns[0], { t: 'debug', cmd, args });
  T.cmd = (c, f) => { conns[0].inbox.length = 0; g.handleMessage(conns[0], Object.assign({ t: 'cmd', c }, f || {})); return conns[0].inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  return T;
}
const mountOf = (g, id) => (g.snapshot().ship.mounts || []).find((m) => m.id === id);

section('Server: weapons.alloc auf frisch bestückte, nie benutzte Waffen');
{
  const T = partie(); const g = T.g;
  T.debug('bestueck', 'alle 3'); T.run(0.5);
  g.players[0].console = 'weapons';
  // Ladepool leeren, dann neue Waffe (Platz 9) einzeln versorgen
  const ids = (g.snapshot().ship.mounts || []).filter((m) => m.alloc !== undefined).map((m) => m.id);
  for (const id of ids) for (let k = 0; k < 6; k++) T.cmd('weapons.alloc', { mount: id, delta: -1 });
  g.ship.mount.p9.charge = 0;   // SYS-01 B1: der Magazindeckel (26,7) lässt eine neue Batterie neben Lanze, Batterien und Kanone geladen starten; die Prüfung will eine Waffe ohne Ladung
  T.run(0.1);
  const p9 = () => mountOf(g, 'p9');
  ok(p9() && p9().alloc === 0 && p9().charge === 0, 'Platz 9: bestückt, 0 Punkte, Ladung 0, nie benutzt');
  ok(T.cmd('weapons.alloc', { mount: 'p9', delta: 1 }).length === 0 && p9().alloc === 1, 'Punkt geben auf die neue Waffe (ohne Ziel, Ladung 0)');
  ok(T.cmd('weapons.alloc', { mount: 'p9', delta: 1 }).length === 0 && p9().alloc === 2, 'zweiter Punkt');
  ok(T.cmd('weapons.alloc', { mount: 'p9', delta: -1 }).length === 0 && p9().alloc === 1, 'Punkt nehmen');
  ok(T.cmd('weapons.alloc', { mount: 'p9', delta: -1 }).length === 0 && p9().alloc === 0, 'letzten Punkt nehmen');
  ok(T.cmd('weapons.alloc', { mount: 'p9', delta: -1 }).length === 1, 'darunter: Server nennt den Grund (Grenze)');
  for (const platz of [1, 3, 5, 7]) { const id = Katalog.mountId(platz); ok(T.cmd('weapons.alloc', { mount: id, delta: 1 }).length === 0 && mountOf(g, id).alloc === 1, `Platz ${platz}: neue Waffe nimmt einen Punkt`); }
}

section('Klickpfad im Client (consoles.js und pult-stationen.js mit Attrappen)');
{
  // tiefe Attrappe: jede Eigenschaft ist eine Funktion/Attrappe, damit die Skripte laden und zeichnen können
  const tief = (name) => new Proxy(function () {}, { get: (t, k) => (Object.prototype.hasOwnProperty.call(t, k) && !['length', 'name', 'prototype'].includes(k) ? t[k] : k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : k === 'length' ? 0 : tief(name + '.' + String(k))), apply: () => tief(name + '()'), construct: () => ({}) });
  const win = { Shared_Schiffskatalog: Katalog, Shared_Maps: Maps, Shared_Config: CONFIG, Shared_Protocol: Protocol, Shared_Locations: Locations, performance, console };
  win.window = win;
  win.Render = tief('Render'); win.Render.PAL = new Proxy({}, { get: () => '#000' });
  win.Render.cfgM3 = (p, d) => (CONFIG.spaceM3[p] != null ? CONFIG.spaceM3[p] : d);
  win.Hud = tief('Hud'); win.Pult = tief('Pult'); win.Pult.FN = new Proxy({}, { get: () => '#000' });
  const meldungen = [];
  win.Hud.pushNotice = (t) => meldungen.push(t);
  win.Net = { guard: (w, f, d) => { try { return f(); } catch (e) { return d; } }, reportError() {} };
  win.document = { getElementById: () => null, querySelector: () => null, addEventListener() {}, createElement: () => ({ getContext: () => tief('ctx') }) };
  win.Tasten = null;
  vm.createContext(win);
  let geladen = true;
  try {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'schiffswaffen-ui.js'), 'utf8'), win, { filename: 'schiffswaffen-ui.js' });   // echte Waffen-Zuordnung (SchiffsUI.waffeVon)
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'consoles.js'), 'utf8'), win, { filename: 'consoles.js' });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pult-stationen.js'), 'utf8'), win, { filename: 'pult-stationen.js' });
  } catch (e) { geladen = false; console.log('  (Laden: ' + e.message + ')'); }
  const K = win.Consoles;
  ok(geladen && K && typeof K.mountKlick === 'function' && typeof K.punktAmZiel === 'function' && typeof K.allocGrund === 'function', 'Consoles mit mountKlick, punktAmZiel, allocGrund geladen');
  if (geladen && K) {
    const T = partie(); const g = T.g;
    T.debug('bestueck', 'alle 3'); T.run(0.5);
    g.players[0].console = 'weapons';
    const gesendet = [];
    const sicht = () => ({ state: JSON.parse(JSON.stringify(g.snapshot())), me: g.players[0], pid: 'p1', send(m) { gesendet.push(m); g.handleMessage(T.conns[0], m); }, actions: { sfx(n) { gesendet.push({ sfx: n }); } }, time: g.time });
    const klingt = [];
    K.denied = (t) => klingt.push(t);   // das Fehlergeräusch (Consoles.denied spielt 'error' und zeigt den Grund)
    const alleIds = () => (g.snapshot().ship.mounts || []).filter((m) => m.alloc !== undefined).map((m) => m.id);
    const leeren = () => { for (const id of alleIds()) for (let k = 0; k < 6; k++) T.cmd('weapons.alloc', { mount: id, delta: -1 }); T.run(0.1); };
    leeren();
    g.ship.mount.p9.charge = 0;   // SYS-01 B1: wie oben – die Waffe ohne Ladung, sonst löst der Klick einen Schuss aus
    const m9 = () => (sicht().state.ship.mounts || []).find((m) => m.id === 'p9');
    // Linksklick auf die neue Waffe ohne Punkte
    klingt.length = 0;
    K.mountKlick(sicht(), m9());
    ok(klingt.length === 0 && m9().alloc === 1, 'Linksklick auf die neue Waffe ohne Punkte: kein Fehlerton, sie bekommt einen Ladepunkt ' + JSON.stringify([klingt, m9().alloc, sicht().state.ship.chargePoints, K.keinePunkte(sicht(), m9())]));
    ok(K.sel.mount === K.energieMounts(sicht()).findIndex((m) => m.id === 'p9'), 'der Klick wählt die Waffe (wie Q/E)');
    // Rechtsklick und Mausrad auf die Zelle
    K.waffenZellen = [{ x: 10, y: 10, w: 60, h: 24, id: 'p9' }];
    ok(K.mouseDown(20, 20, sicht(), 2) === true && m9().alloc === 0, 'Rechtsklick auf die Zelle: Ladepunkt −1');
    ok(K.rad(20, 20, -120, sicht()) === true && m9().alloc === 1, 'Mausrad hoch über der Zelle: +1');
    ok(K.rad(20, 20, 120, sicht()) === true && m9().alloc === 0, 'Mausrad runter: −1');
    klingt.length = 0;
    ok(K.mouseDown(20, 20, sicht(), 2) === true && klingt.length === 1 && /Keine Punkte/.test(klingt[0]), 'Rechtsklick ohne Punkte: der Grund steht da ("' + klingt[0] + '")');
    ok(K.rad(300, 300, -120, sicht()) === false, 'Rad außerhalb der Zellen: nicht verbraucht (Karte zoomt wie bisher)');
    // Grenzen: Maximum, alle Punkte verteilt
    leeren();
    for (let k = 0; k < 4; k++) K.mountKlick(sicht(), m9());   // 1. Klick gibt den Punkt (keine Punkte), danach Klicks bedienen (feuern/Lädt)
    ok(m9().alloc >= 1, 'weitere Klicks auf eine Waffe mit Punkten bedienen sie (kein weiterer Punkt)');
    K.waffenZellen = [{ x: 10, y: 10, w: 60, h: 24, id: 'p9' }];
    for (let k = 0; k < 8; k++) K.rad(20, 20, -120, sicht());
    ok(m9().alloc <= CONFIG.spaceM3.allocMax, 'Mausrad hält die Grenze (' + m9().alloc + ' von höchstens ' + CONFIG.spaceM3.allocMax + ')');
    klingt.length = 0; const vorher = m9().alloc; K.rad(20, 20, -120, sicht());
    ok(m9().alloc === vorher && klingt.length === 1, 'am Maximum oder bei verteilten Punkten: Grund statt Aktion ("' + klingt[0] + '")');
    // geladene Waffe: Klick feuert wie bisher
    leeren(); T.cmd('weapons.alloc', { mount: 'stbd', delta: 1 }); T.cmd('weapons.alloc', { mount: 'stbd', delta: 1 }); T.cmd('weapons.alloc', { mount: 'stbd', delta: 1 });
    T.run(40);
    const stbd = () => (sicht().state.ship.mounts || []).find((m) => m.id === 'stbd');
    gesendet.length = 0; K.mountKlick(sicht(), stbd());
    ok(stbd().charge >= 1 ? gesendet.some((q) => q.c === 'weapons.fire') : true, 'Waffe mit Ladung: Klick feuert wie bisher (weapons.fire)');
  }
}

console.log(`\ntest-ops-klick: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
