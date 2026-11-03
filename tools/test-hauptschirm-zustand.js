'use strict';
// KUL-02 A: Zustand der Hauptschirm-Ansicht (server/sim/hauptschirm.js, Befehl helm.hauptschirm, Snapshot ship.hs) und Client-Selektor (public/js/hauptschirm.js).
//   - Standard klassisch (Snapshot-Feld fehlt); der Steuer schaltet um, ship.hs = 'visier'
//   - andere Stationen (Ops, Captain, Technik) und ungültige Werte werden abgewiesen, der Zustand bleibt
//   - zwei Clients sehen dieselbe Ansicht binnen eines Ticks; der Zustand überlebt Sprung und Sektorwechsel
//   - Client: Selektor liest ship.hs, Registry ruft den Zeichner der aktiven Ansicht
//   node tools/test-hauptschirm-zustand.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CONFIG = require('../shared/config.js');
const Sektoren = require('../shared/sektoren.js');
const Hauptschirm = require('../server/sim/hauptschirm.js');
const Station = require('../server/sim/station.js');
const { Game } = require('../server/game.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n[' + t + ']');
const DT = 1 / CONFIG.tickHz;

function partie() {
  const g = new Game({ noStore: true, seed: 41, debug: true, log: () => {}, env: { MISSION_SOURCE: 'fallback' } });
  const conns = [];
  for (let i = 0; i < 4; i++) { const c = { inbox: [], send(m) { this.inbox.push(m); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'HS' + i, color: i }); conns.push(c); }
  g.handleMessage(conns[0], { t: 'lobbyOpt', startMission: 'arena_space' });
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  g.space.enemies = []; g.space.projectiles = []; if (g.arena) g.arena.nextAt = null;
  g.god = true;
  g.players[0].console = 'helm'; g.players[1].console = 'weapons'; g.players[2].console = 'captain'; g.players[3].console = 'technik';
  const T = { g, conns, run: (s) => { for (let k = 0; k < Math.round(s / DT); k++) g.step(); } };
  T.cmd = (i, c, f) => { conns[i].inbox.length = 0; g.handleMessage(conns[i], Object.assign({ t: 'cmd', c }, f || {})); return conns[i].inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  // Snapshot aus Sicht eines Clients (der Snapshot ist für alle derselbe Stand; die Sicht = das Feld ship.hs)
  T.hs = () => JSON.parse(JSON.stringify(g.snapshot())).ship.hs;
  return T;
}

section('Server: Standard und Umschalten durch den Steuer');
{
  const T = partie(); const g = T.g;
  ok(Hauptschirm.ansichtVon(g) === 'klassisch' && T.hs() === undefined, 'Standard klassisch, Snapshot ohne ship.hs');
  ok(T.cmd(0, 'helm.hauptschirm', { ansicht: 'visier' }).length === 0, 'Steuer schaltet auf visier ohne Fehlermeldung');
  ok(Hauptschirm.ansichtVon(g) === 'visier' && T.hs() === 'visier', 'Zustand visier, Snapshot ship.hs = "visier"');
  T.cmd(0, 'helm.hauptschirm', { ansicht: 'klassisch' });
  ok(Hauptschirm.ansichtVon(g) === 'klassisch' && T.hs() === undefined, 'zurück auf klassisch: Snapshot-Feld fehlt wieder');
}

section('Server: andere Stationen und ungültige Werte werden abgewiesen');
{
  const T = partie(); const g = T.g;
  for (const [i, name] of [[1, 'weapons'], [2, 'captain'], [3, 'technik']]) {
    const r = T.cmd(i, 'helm.hauptschirm', { ansicht: 'visier' });
    ok(r.length === 1 && Hauptschirm.ansichtVon(g) === 'klassisch' && T.hs() === undefined, name + ': Befehl abgewiesen (Hinweis), Zustand bleibt klassisch');
  }
  // Rechteprüfung der Funktion selbst (unabhängig vom Präfix-Filter in game.js)
  ok(typeof Hauptschirm.ansichtSetzen(g, g.players[1], 'visier') === 'string' && Hauptschirm.ansichtVon(g) === 'klassisch', 'ansichtSetzen: Ops-Spieler -> Fehlertext, Zustand bleibt');
  ok(typeof Hauptschirm.ansichtSetzen(g, g.players[2], 'visier') === 'string' && typeof Hauptschirm.ansichtSetzen(g, g.players[3], 'visier') === 'string', 'ansichtSetzen: Captain und Technik -> Fehlertext');
  g.players[1].console = null;
  ok(Station.stationOf(g.players[1]) === null && typeof Hauptschirm.ansichtSetzen(g, g.players[1], 'visier') === 'string', 'ansichtSetzen: Spieler ohne Konsole -> Fehlertext');
  // Der Steuer, der sitzt, aber mit einem Tab-Interface (p.station) wechselt: zählt die aktive Station
  g.players[0].station = 'weapons';
  ok(typeof Hauptschirm.ansichtSetzen(g, g.players[0], 'visier') === 'string' && Hauptschirm.ansichtVon(g) === 'klassisch', 'Steuer-Ort, aber aktives Interface Ops: abgewiesen');
  g.players[0].station = null;
  // Ungültige Werte
  for (const v of ['', 'foo', undefined, null, 'VISIER', 3]) {
    const r = typeof Hauptschirm.ansichtSetzen(g, g.players[0], v);
    ok(r === 'string' && Hauptschirm.ansichtVon(g) === 'klassisch', 'ungültiger Wert ' + JSON.stringify(v) + ' abgewiesen');
  }
  ok(T.cmd(0, 'helm.hauptschirm', {}).length === 1 && Hauptschirm.ansichtVon(g) === 'klassisch', 'Befehl ohne ansicht: Hinweis, Zustand bleibt');
  // Zustand visier bleibt nach abgewiesenem Versuch stehen
  T.cmd(0, 'helm.hauptschirm', { ansicht: 'visier' });
  T.cmd(1, 'helm.hauptschirm', { ansicht: 'klassisch' });
  Hauptschirm.ansichtSetzen(g, g.players[0], 'foo');
  ok(Hauptschirm.ansichtVon(g) === 'visier', 'Zustand visier bleibt nach Versuchen von Ops und ungültigem Wert');
}

section('Zwei Clients sehen dasselbe binnen eines Snapshot-Takts');
{
  const T = partie(); const g = T.g;
  const letzteSicht = (i) => { const sn = T.conns[i].inbox.filter((m) => m.t === 'snap'); return sn.length ? sn[sn.length - 1] : null; };
  T.run(0.2);
  T.cmd(0, 'helm.hauptschirm', { ansicht: 'visier' });
  ok(T.hs() === 'visier', 'sofort nach dem Befehl trägt der Snapshot ship.hs = visier (Zustand liegt einmal im Server)');
  for (const c of T.conns) c.inbox.length = 0;
  // wie server/index.js: nach jedem Tick, der wantsSnapshot() erfüllt, geht g.snapshot() per broadcast an alle
  const tickBisSnapshot = (max) => { for (let k = 0; k < max; k++) { g.step(); if (g.wantsSnapshot()) g.broadcast(g.snapshot()); } };
  const takt = CONFIG.net.snapEvery;   // Snapshots gehen alle snapEvery Ticks raus: bis dahin muss jeder Client die neue Ansicht bekommen haben
  tickBisSnapshot(takt);
  const alle = [0, 1, 2, 3].map(letzteSicht);
  ok(alle.every((q) => q && q.ship.hs === 'visier'), 'binnen ' + takt + ' Ticks (ein Snapshot-Takt) tragen die Snapshots aller vier Clients ship.hs = visier');
  T.cmd(0, 'helm.hauptschirm', { ansicht: 'klassisch' });
  for (const c of T.conns) c.inbox.length = 0;
  tickBisSnapshot(takt);
  ok([0, 1, 2, 3].map(letzteSicht).every((q) => q && q.ship.hs === undefined), 'und zurück: ship.hs fehlt bei allen vier Clients');
}

section('Zustand überlebt Sprung und Sektorwechsel');
{
  const T = partie(); const g = T.g;
  T.cmd(0, 'helm.hauptschirm', { ansicht: 'visier' });
  const vor = g.ship.scene;
  // Sprung wie in test-features: Ziel wählen, Sprungpunkt anfliegen, Antrieb laden, springen
  const sprung = require('../server/sim/sprung.js');
  const ziel = Sektoren.hexVonOrt('vaelen');
  let zielOrt = 'vaelen';
  T.cmd(2, 'captain.selectDest', { dest: zielOrt });
  const jp = sprung.sprungpunkt(g, ziel);
  const sh = g.ship;
  if (jp) { sh.docked = false; sh.dockedAt = null; sh.x = jp.x; sh.y = jp.y; }
  T.run(8.5);
  const r = T.cmd(0, 'helm.jump');
  T.run(1);
  ok(sh.scene !== vor || (g.snapshot().world && g.snapshot().world.location === 'vaelen'), 'Sprung ausgeführt (Szene ' + vor + ' -> ' + sh.scene + ')' + (r.length ? ' Hinweis: ' + r.join('|') : ''));
  ok(Hauptschirm.ansichtVon(g) === 'visier' && T.hs() === 'visier', 'nach dem Sprung noch visier, Snapshot ship.hs = "visier"');
  T.cmd(0, 'helm.hauptschirm', { ansicht: 'klassisch' });
  ok(T.hs() === undefined, 'im neuen Sektor weiter umschaltbar (klassisch, Feld fehlt)');
}

section('Client: Selektor und Registry (public/js/hauptschirm.js)');
{
  const win = {}; const ctx = vm.createContext({ window: win });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'hauptschirm.js'), 'utf8'), ctx);
  const H = win.Hauptschirm;
  const sicht = (hs) => ({ state: { ship: hs === undefined ? {} : { hs } } });
  ok(H.ansichtVon(sicht(undefined)) === 'klassisch' && H.ansichtVon({}) === 'klassisch' && H.ansichtVon(null) === 'klassisch', 'ansichtVon: fehlendes Feld, leere und fehlende Sicht = klassisch');
  ok(H.ansichtVon(sicht('visier')) === 'visier' && H.ansichtVon(sicht('quatsch')) === 'klassisch', 'ansichtVon: visier gelesen, Unbekanntes = klassisch');
  ok(H.andere('klassisch') === 'visier' && H.andere('visier') === 'klassisch', 'andere: wechselt zur jeweils anderen Ansicht');
  const log = [];
  H.registriere('klassisch', () => log.push('k')); H.registriere('visier', () => log.push('v'));
  H.zeichne(null, sicht(undefined), {}); H.zeichne(null, sicht('visier'), {}); H.zeichne(null, sicht('visier'), {}); H.zeichne(null, sicht('klassisch'), {});
  ok(log.join('') === 'kvvk', 'zeichne ruft den Zeichner der aktiven Ansicht (' + log.join('') + ')');
  let wirft = false; try { H.registriere('foo', () => {}); } catch (e) { wirft = true; }
  ok(wirft, 'registriere: unbekannte Ansicht wird abgelehnt');
}

console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
