'use strict';
// OPS-01 C1: Anzeigeziel des Captains (server/sim/captainziel.js, Befehl captain.anzeigeziel, Snapshot ship.cz). Echter Server, zwei Spieler (Captain und Ops).
//   Eigener Zustand: ship.target (Ops) bleibt unberührt und umgekehrt; Details nur bei gescanntem Ziel (gleiche Werte wie zielSys/zielZon/zielWahl der Ops);
//   ungültig/außer Reichweite: abgelehnt, das bisherige Ziel bleibt (nur null/'' löscht; weicht vom C1-Briefing ab, Entscheidung des Leiters); gestorben -> weg; Station und aufgedecktes verstecktes Objekt wählbar; Nicht-Captain abgelehnt; keine Doppeldaten bei gleichem Ziel;
//   ohne Ziel kein cz und der Snapshot bleibt unverändert; Weltstand speichern/laden ohne das Feld.
//   node tools/test-captain-ziel.js
const fs = require('fs');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Weltstand = require('../server/weltstand.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Gsys = require('../server/sim/gegnersystem.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, body) {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 4).join(' | ')); }
}
const DT = 1 / CONFIG.tickHz;

function setup(scene) {
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const conns = [0, 1].map((i) => { const c = { inbox: [], send(m) { if (this.inbox.length < 300) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'C' + i, name: 'Cap' + i, color: i }); return c; });
  g.handleMessage(conns[0], { t: 'lobbyOpt', startMission: 'arena_space' });
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  space.enterScene(g, scene || 'rabenpass', {});
  g.space.enemies = []; g.space.projectiles = [];
  g.players[0].console = 'captain'; g.players[1].console = 'weapons';
  g.god = true;
  const cmd = (i, c, f) => { conns[i].inbox.length = 0; g.handleMessage(conns[i], Object.assign({ t: 'cmd', c }, f || {})); return conns[i].inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  return { g, conns, cap: (c, f) => cmd(0, c, f), ops: (c, f) => cmd(1, c, f), run: (s) => { for (let k = 0; k < Math.round(s / DT); k++) g.step(); } };
}
const gegner = (g, kind, x, y) => { const e = space.spawnEnemy(g, kind, { x, y, facing: 0, tag: 'zz' }); e.retreatUntil = 0; return e; };
const platz = (g, x, y) => { const s = g.ship; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; s.turnVel = 0; };
const ship = (g) => JSON.parse(JSON.stringify(g.snapshot().ship));

section('(a) setzen, ship.target unverändert', () => {
  const T = setup(); const g = T.g;
  platz(g, 1200, 1000);
  const e1 = gegner(g, 'fregatte', 1500, 1000), e2 = gegner(g, 'fregatte', 1500, 1200);
  T.ops('weapons.target', { id: e1.id });
  ok(g.ship.target === e1.id, 'Ops-Ziel e1');
  ok(T.cap('captain.anzeigeziel', { id: e2.id }).length === 0, 'captain.anzeigeziel e2 ohne Fehler');
  ok(g.ship.target === e1.id, 'ship.target unverändert (e1)');
  const s = ship(g);
  ok(s.cz && s.cz.id === e2.id, 'ship.cz.id = e2 ' + JSON.stringify(s.cz));
  ok(s.target === e1.id, 'Snapshot target (Ops) = e1');
});

section('(b) weapons.target ändert capZiel nicht', () => {
  const T = setup(); const g = T.g;
  platz(g, 1200, 1000);
  const e1 = gegner(g, 'fregatte', 1500, 1000), e2 = gegner(g, 'fregatte', 1500, 1200);
  T.cap('captain.anzeigeziel', { id: e2.id });
  T.ops('weapons.target', { id: e1.id });
  T.ops('weapons.target', { id: null });
  ok(g.ship.capZiel && g.ship.capZiel.id === e2.id && ship(g).cz.id === e2.id, 'Captain-Ziel bleibt e2 nach Ops-Anwahl und Ops-Löschen');
  T.cap('captain.anzeigeziel', { id: null });
  ok(!g.ship.capZiel && !('cz' in ship(g)), 'null löscht das Captain-Ziel');
});

section('(c) Details nur gescannt, gleiche Werte wie Ops-Zielkasten; (h) keine Doppeldaten', () => {
  const T = setup(); const g = T.g;
  platz(g, 1200, 1000);
  gegner(g, 'fregatte', 1500, 1000);
  const e2 = gegner(g, 'fregatte', 1500, 1200);
  e2.angle = 0;
  T.cap('captain.anzeigeziel', { id: e2.id });
  let cz = ship(g).cz;
  ok(cz && Object.keys(cz).join() === 'id', 'ungescannt: nur { id } ' + JSON.stringify(cz));
  const s0 = ship(g);
  ok(!('zielSys' in s0) && !('zielZon' in s0) && !('zielWahl' in s0), 'ungescannt: keine Ops-Felder (Ops-Ziel nicht gesetzt)');
  e2.scanned = true;
  cz = ship(g).cz;
  ok(cz.sys && cz.zon && cz.wahl, 'gescannt: sys, zon, wahl vorhanden');
  const ids = Gsys.systemeVon('fregatte').length;
  ok(cz.sys.length === 2 * ids + 1, 'sys: je System zwei Werte + Countdown');
  T.ops('weapons.target', { id: e2.id });
  const so = ship(g);
  ok(JSON.stringify(so.zielSys) === JSON.stringify(cz.sys) && JSON.stringify(so.zielZon) === JSON.stringify(cz.zon) && JSON.stringify(so.zielWahl) === JSON.stringify(cz.wahl), 'sys/zon/wahl == zielSys/zielZon/zielWahl der Ops-Wahl');
  ok(so.cz && Object.keys(so.cz).join() === 'id' && so.cz.id === e2.id, '(h) Ops-Ziel = Captain-Ziel: cz nur { id } ' + JSON.stringify(so.cz));
  ok(g.ship.target === e2.id, 'Ops-Ziel bleibt');
});

section('(d) ungültig, außer Reichweite, nicht existent: abgelehnt, das bisherige Ziel bleibt stehen (R5)', () => {
  const T = setup(); const g = T.g;
  platz(g, 1000, 1000);
  const nah = gegner(g, 'fregatte', 1300, 1000);
  const fern = gegner(g, 'fregatte', 1000 + space.sensorReichweite(g) + 800, 1000);
  ok(T.cap('captain.anzeigeziel', { id: nah.id }).length === 0 && !!g.ship.capZiel, 'gesetzt auf nah');
  let r = T.cap('captain.anzeigeziel', { id: 'gibtsnicht' });
  ok(r.length === 1 && g.ship.capZiel && g.ship.capZiel.id === nah.id && ship(g).cz && ship(g).cz.id === nah.id, 'unbekannte ID: Fehlermeldung, Anzeigeziel bleibt auf nah ' + r);
  r = T.cap('captain.anzeigeziel', { id: fern.id });
  ok(r.length === 1 && g.ship.capZiel && g.ship.capZiel.id === nah.id, 'außerhalb der Sensoren: Fehlermeldung, Anzeigeziel bleibt auf nah ' + r);
  r = T.cap('captain.anzeigeziel', { id: 12345 });
  ok(r.length === 1 && g.ship.capZiel && g.ship.capZiel.id === nah.id, 'numerische/fremde ID abgelehnt, Ziel bleibt');
  ok(T.cap('captain.anzeigeziel', { id: null }).length === 0 && !g.ship.capZiel && !('cz' in ship(g)), 'nur null löscht');
  T.cap('captain.anzeigeziel', { id: nah.id });
  ok(T.cap('captain.anzeigeziel', { id: '' }).length === 0 && !g.ship.capZiel, 'leere ID löscht');
  // ohne vorheriges Ziel: Ablehnung setzt nichts
  r = T.cap('captain.anzeigeziel', { id: 'gibtsnicht' });
  ok(r.length === 1 && !g.ship.capZiel, 'ohne bisheriges Ziel: Ablehnung setzt kein Ziel');
  // Mutation: die alte Regel (Ablehnung löscht das Ziel) lässt diesen Abschnitt rot werden
  const Module = require('module'), pfad = path.join(__dirname, '..', 'server', 'sim', 'captainziel.js');
  const q = fs.readFileSync(pfad, 'utf8'), alt = "if (!rt) return 'Ziel nicht gefunden.';";
  ok(q.includes(alt), 'Mutationsstelle in captainziel.js vorhanden');
  const m = new Module(pfad); m.filename = pfad; m.paths = Module._nodeModulePaths(path.dirname(pfad)); m._compile(q.replace(alt, "if (!rt) { loeschen(game); return 'Ziel nicht gefunden.'; }"), pfad);
  T.cap('captain.anzeigeziel', { id: nah.id });
  const meldung = m.exports.setzen(g, 'gibtsnicht');
  ok(typeof meldung === 'string' && !g.ship.capZiel, 'Mutation (Ablehnung löscht das Ziel): das Ziel ist weg – die Prüfung oben würde rot');
});

section('(e) Gegner stirbt: cz verschwindet', () => {
  const T = setup(); const g = T.g;
  platz(g, 1200, 1000);
  const e = gegner(g, 'fregatte', 1500, 1000); e.scanned = true;
  T.cap('captain.anzeigeziel', { id: e.id });
  ok(ship(g).cz && ship(g).cz.id === e.id, 'cz steht');
  g.space.enemies = g.space.enemies.filter((q) => q !== e);   // Konvoi-/Gegnertod entfernen den Gegner aus der Liste
  let s; let boom = null;
  try { s = ship(g); T.run(0.3); } catch (x) { boom = x; }
  ok(!boom && s && !('cz' in s), 'Gegner weg: kein cz, kein Absturz');
  ok(!g.ship.capZiel, 'capZiel geleert');
  const e2 = gegner(g, 'fregatte', 1500, 1100);
  T.cap('captain.anzeigeziel', { id: e2.id });
  space.enemyDown(g, e2); T.run(0.3);
  ok(!('cz' in ship(g)), 'space.enemyDown: cz weg');
});

section('(f) Station und verstecktes Objekt', () => {
  const T = setup('hafen'); const g = T.g;
  g.space.enemies = [];
  ok(!!space.resolveTarget(g, 'station'), 'Szene hafen hat eine Station');
  ok(T.cap('captain.anzeigeziel', { id: 'station' }).length === 0 && ship(g).cz && ship(g).cz.id === 'station', 'Station wählbar');
  ok(g.ship.target == null, 'ship.target bleibt leer');
  const h = g.explore.hiddenHere()[0];
  ok(!!h, 'verstecktes Objekt ' + (h && h.id));
  let r = T.cap('captain.anzeigeziel', { id: h.id });
  ok(r.length === 1 && g.ship.capZiel && g.ship.capZiel.id === 'station', 'unaufgedeckt: abgelehnt, das bisherige Ziel (Station) bleibt');
  g.explore.revealHidden(h, true);
  r = T.cap('captain.anzeigeziel', { id: h.id });
  ok(r.length === 0 && ship(g).cz && ship(g).cz.id === h.id && Object.keys(ship(g).cz).join() === 'id', 'aufgedeckt: wählbar, nur { id }');
  space.enterScene(g, 'rabenpass', {});
  ok(!('cz' in ship(g)), 'Szenenwechsel: cz weg');
});

section('(g) Nicht-Captain abgelehnt', () => {
  const T = setup(); const g = T.g;
  platz(g, 1200, 1000);
  const e = gegner(g, 'fregatte', 1500, 1000);
  const r = T.ops('captain.anzeigeziel', { id: e.id });
  ok(r.length === 1 && !g.ship.capZiel, 'Ops-Spieler: abgelehnt, nichts gesetzt ' + r);
  g.players[0].console = 'helm';
  ok(T.cap('captain.anzeigeziel', { id: e.id }).length === 1 && !g.ship.capZiel, 'Pilot (andere Konsole): abgelehnt');
  g.players[0].console = 'captain';
  T.cap('captain.anzeigeziel', { id: e.id });
  ok(!!g.ship.capZiel, 'am Captain-Pult erlaubt (Gegenprobe)');
});

section('(i) ohne Ziel: kein cz, Snapshot unverändert; nur bei besetztem Captain', () => {
  const T = setup(); const g = T.g;
  platz(g, 1200, 1000);
  const e = gegner(g, 'fregatte', 1500, 1000); e.scanned = true;
  T.ops('weapons.target', { id: e.id });
  const a = JSON.stringify(g.snapshot().ship);
  T.cap('captain.anzeigeziel', { id: e.id }); T.cap('captain.anzeigeziel', { id: null });
  const b = JSON.stringify(g.snapshot().ship);
  ok(!a.includes('"cz"') && a === b, 'gesetzt und wieder gelöscht: ship byte-gleich zum Stand davor (' + a.length + ' B)');
  const e2 = gegner(g, 'fregatte', 1500, 1300);
  T.cap('captain.anzeigeziel', { id: e2.id });
  ok('cz' in ship(g), 'Captain besetzt: cz da');
  g.players[0].console = null;
  ok(!('cz' in ship(g)) && !!g.ship.capZiel, 'Captain-Pult leer: kein cz im Snapshot');
  g.players[0].console = 'captain';
  ok('cz' in ship(g), 'wieder besetzt: cz wieder da');
});

section('(j) Weltstand speichern/laden', () => {
  const T = setup(); const g = T.g;
  platz(g, 1200, 1000);
  const e = gegner(g, 'fregatte', 1500, 1000); e.scanned = true;
  T.cap('captain.anzeigeziel', { id: e.id });
  const data = JSON.parse(JSON.stringify(Weltstand.capture(g)));
  ok(!JSON.stringify(data).includes('capZiel') && !JSON.stringify(data).includes('anzeigeziel'), 'Weltstand enthält das Feld nicht');
  const T2 = setup(); let boom = null;
  try { Weltstand.apply(T2.g, data); T2.run(0.3); T2.g.snapshot(); } catch (x) { boom = x; }
  ok(!boom && !T2.g.ship.capZiel, 'laden ohne Feld: kein Absturz, kein Captain-Ziel' + (boom ? ' ' + boom.message : ''));
});

console.log(`\n${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
