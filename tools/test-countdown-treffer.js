'use strict';
// GEG-01 B „Treffer halbieren den Countdown“ (Kai): solange der Reaktor-Countdown läuft, HALBIERT jeder Waffentreffer die Restzeit – ohne Mindestzeit.
//   Gegner: gegnertod.treffer (Haken am Eingang von space.damageEnemy, e.rt.rest). Lerche: reaktortod.treffer (Haken am Eingang von space.shipHit und der Mine, ship.reaktorCountdown.t).
//   Zählt: jeder Waffentreffer, auch wenn der Schild ihn hält oder das Trefferfenster ihn verwirft. Zählt nicht: Brocken, Dauerdruck, Schaden 0, der Treffer, der den Reaktor erst zerstört.
//   Unter reaktorTod.restGrenze ist das Schiff sofort zerstört. reaktorTod.minimum gilt weiter nur für den Startwert der Stufung.
//   node tools/test-countdown-treffer.js
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const Space = require('../server/sim/space.js');
const Gsys = require('../server/sim/gegnersystem.js');
const Gegnertod = require('../server/sim/gegnertod.js');
const Reaktortod = require('../server/sim/reaktortod.js');
const Schiffswaffen = require('../server/sim/schiffswaffen.js');
const Katalog = require('../shared/schiffskatalog.js');
const I = require('../server/sim/interior.js');
const BOTS = require('../server/sim/bots.js');
const Testhilfe = require('./gegner-testhilfe.js');

const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const section = (t, fn) => { console.log('\n[' + t + ']'); try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); } };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-cdtreffer-'));
let seq = 0;
function setup(start) {
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie' + seq) }, log: () => {} });
  const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'K0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: start });
  g.handleMessage(c, { t: 'ready', ready: true });
  const run = (sec) => { for (let k = 0; k < Math.round(sec / DT); k++) g.step(); };
  run(1); g.space.enemies = []; g.space.projectiles = [];
  BOTS.setBotAuto(g, false);
  return { g, run };
}
// Gegner (gestellt: keine Reparatur), 250 px voraus
function gegner(g, kind) {
  const sh = g.ship;
  const e = Space.spawnEnemy(g, kind || 'korvette', { x: sh.x + 250, y: sh.y, facing: Math.PI });
  e.vx = 0; e.vy = 0; e.gestellt = true;
  return e;
}
const treffer = (g, e, dmg, opts) => Space.damageEnemy(g, e, dmg == null ? 5 : dmg, e.x + 100, e.y, opts);   // Quelle vor dem Bug-Segment
function brichtReaktor(g, e, rest) { Gegnertod.brechen(g, e, 'reaktor'); if (rest != null) e.rt.rest = rest; }
// Lerche: Reaktor zerstört, Countdown auf rest
function lercheCountdown(g, rest) { I.damageSystem(g, 'reactor', 'broken'); g.ship.reaktorCountdown.t = rest; }

section('1 Gegner: Rest 12 s + 1 Treffer = 6 s, jeder weitere halbiert wieder', () => {
  const { g } = setup('arena_space');
  const e = gegner(g); brichtReaktor(g, e, 12);
  treffer(g, e);
  ok(near(e.rt.rest, 6), `Rest 12 -> ${e.rt.rest}`);
  treffer(g, e);
  ok(near(e.rt.rest, 3), `zweiter Treffer: ${e.rt.rest}`);
  ok(Gegnertod.restZehntel(e) === 30, 'Anzeige-Pfad (restZehntel) zeigt den verkürzten Wert');
});

section('2 Lerche: Rest 12 s + 1 Treffer = 6 s', () => {
  const { g } = setup('freie_fahrt');
  I.damageSystem(g, 'reactor', 'broken');
  ok(g.ship.reaktorCountdown && near(g.ship.reaktorCountdown.t, CONFIG.reaktorTod.start), 'Countdown läuft (20 s)');
  g.ship.reaktorCountdown.t = 12;
  Space.shipHit(g, 0, 6, {});
  ok(near(g.ship.reaktorCountdown.t, 6), `Rest 12 -> ${g.ship.reaktorCountdown.t}`);
  ok(Reaktortod.snapshot(g).rest === 60, 'Snapshot (ship.reaktorTod.rest) zeigt 60 Zehntel');
});

section('3 Streubatterie: eine Salve (3 Granaten, im Fenster auch mit Durchschlag) bringt eine kurze Restzeit auf null', () => {
  const { g } = setup('arena_space');
  const e = gegner(g); brichtReaktor(g, e, 3);
  const T = Katalog.waffe('streubatterie');
  for (let i = 0; i < 3; i++) Schiffswaffen.streuExplosion(g, { x: e.x, y: e.y, dmg: T.schaden });
  ok(e.rt.rest === 0, `Rest nach einer Salve in einem Tick: ${e.rt.rest} (5 Treffer: 3 s / 32 unter der Grenze)`);
  const k0 = g.stats.kills;
  g.step();
  ok(!g.space.enemies.includes(e) && g.stats.kills === k0 + 1, 'nächster Tick: Gegner zerstört, ein Abschuss gezählt');
});

section('4 Der Treffer, der den Reaktor bricht, halbiert nicht (Gegner und Lerche)', () => {
  const { g } = setup('arena_space');
  const e = gegner(g);
  Testhilfe.schildNull(e, null, g);
  Testhilfe.mitteNurReaktor(e);
  const r = Gsys.idVon(e, 'reaktor');
  e.sys[r].i = Math.min(e.sys[r].i, 0.01); e.sys[r].z = 'damaged'; e.hp = Gsys.summe(e);
  treffer(g, e, 5, { durchschlag: 'zone' });   // der echte Treffer zerstört den Reaktor: erst der Haken (kein Countdown, nichts zu halbieren), dann startet der Countdown
  ok(e.rt && e.rt.rest != null && near(e.rt.rest, CONFIG.reaktorTod.start), `Gegner: der brechende Treffer startet den Countdown mit voller Dauer (${e.rt && e.rt.rest})`);
  const { g: g2 } = setup('freie_fahrt');
  I.damageSystem(g2, 'reactor', 'broken');
  ok(near(g2.ship.reaktorCountdown.t, CONFIG.reaktorTod.start), 'Lerche: Countdown startet mit voller Dauer');
  const { g: g3 } = setup('freie_fahrt');
  Space.shipHit(g3, 0, 6, { pierce: true, heavy: true });
  ok(g3.ship.reaktorCountdown == null, 'Lerche: ein Treffer ohne Countdown legt keinen an');
});

section('5 Brocken, Dauerdruck und Schaden 0 halbieren nicht', () => {
  const { g } = setup('arena_space');
  const e = gegner(g); brichtReaktor(g, e, 12);
  Space.damageEnemy(g, e, CONFIG.asteroid.damage, e.x + 50, e.y, { brocken: true });
  ok(near(e.rt.rest, 12), `Gegner: Brocken lässt Rest bei ${e.rt.rest}`);
  treffer(g, e, 5, { druck: true });
  treffer(g, e, 0);
  ok(near(e.rt.rest, 12), 'Dauerdruck und Schaden 0 halbieren nicht');
  const { g: g2 } = setup('freie_fahrt');
  lercheCountdown(g2, 12);
  Space.shipHit(g2, 0, CONFIG.asteroid.damage, { brocken: true });
  ok(near(g2.ship.reaktorCountdown.t, 12), `Lerche: Brocken lässt Rest bei ${g2.ship.reaktorCountdown.t}`);
});

section('6 Ein Treffer, den der Schild vollständig hält, halbiert', () => {
  const { g } = setup('arena_space');
  const e = gegner(g); brichtReaktor(g, e, 12);
  e.shields.fill(50);
  treffer(g, e, 2);
  ok(near(e.rt.rest, 6), `Gegner, Schild hält: Rest ${e.rt.rest}`);
  const { g: g2 } = setup('freie_fahrt');
  lercheCountdown(g2, 12);
  g2.ship.shields.current.fill(50);
  Space.shipHit(g2, 0, 2, {});
  ok(near(g2.ship.reaktorCountdown.t, 6), `Lerche, Schild hält: Rest ${g2.ship.reaktorCountdown.t}`);
});

section('7 Ein Treffer im Trefferfenster (verfällt) halbiert', () => {
  const { g } = setup('arena_space');
  const e = gegner(g); Testhilfe.schildNull(e, null, g); brichtReaktor(g, e, 12);
  treffer(g, e, 5); treffer(g, e, 5); treffer(g, e, 5);   // im selben Tick: ab dem zweiten Treffer sind die Systeme im Fenster, die Treffer verfallen
  ok(near(e.rt.rest, 12 / 8), `drei Treffer im selben Tick: Rest ${e.rt.rest} (12/8)`);
  const { g: g2 } = setup('freie_fahrt');
  lercheCountdown(g2, 12);
  g2.ship.shields.current.fill(0);
  Space.shipHit(g2, 0, 2, { pierce: true }); Space.shipHit(g2, 0, 2, { pierce: true });
  ok(near(g2.ship.reaktorCountdown.t, 3), `Lerche: zwei Treffer ohne Schild: Rest ${g2.ship.reaktorCountdown.t}`);
});

section('8 Ohne Countdown passiert nichts (Gegner, Lerche, repariert, Gottmodus)', () => {
  const { g } = setup('arena_space');
  const e = gegner(g);
  treffer(g, e);
  ok(e.rt == null || e.rt.rest == null, 'Gegner ohne Countdown: kein Countdown');
  brichtReaktor(g, e, 12);
  e.sys.reaktor.z = 'damaged';   // repariert: der Countdown endet beim nächsten tick; ein Treffer davor ändert nichts
  treffer(g, e);
  ok(near(e.rt.rest, 12), 'Gegner, Reaktor repariert: der Treffer halbiert nichts');
  const { g: g2 } = setup('freie_fahrt');
  Space.shipHit(g2, 0, 6, {});
  ok(g2.ship.reaktorCountdown == null && !g2.ship.schiffZerstoert, 'Lerche ohne Countdown: kein Countdown, nicht zerstört');
  lercheCountdown(g2, 12);
  I.setzeZustand(g2, 'reactor', 'damaged');
  Space.shipHit(g2, 0, 2, { pierce: true });
  ok(!g2.ship.schiffZerstoert, 'Lerche, Reaktor wieder ganz: kein Tod durch den Treffer');
  const { g: g3 } = setup('freie_fahrt');
  lercheCountdown(g3, 12); g3.god = true;
  Space.shipHit(g3, 0, 2, {});
  ok(near(g3.ship.reaktorCountdown.t, 12), 'Lerche im Gottmodus (gilt() aus): keine Halbierung');
});

section('9 Unter reaktorTod.restGrenze: sofortiger Tod (Gegner im nächsten Tick, Lerche sofort)', () => {
  const G = CONFIG.reaktorTod.restGrenze;
  ok(G === 0.1, `Config reaktorTod.restGrenze = ${G}`);
  const { g } = setup('arena_space');
  const e = gegner(g); brichtReaktor(g, e, G * 2 - 1e-6);
  const e2 = gegner(g); brichtReaktor(g, e2, G * 2 + 1e-3);
  treffer(g, e); treffer(g, e2);
  ok(e.rt.rest === 0, 'Gegner: Rest unter der Grenze -> 0');
  ok(near(e2.rt.rest, G + 5e-4), `Gegner: knapp über der Grenze bleibt (${e2.rt.rest})`);
  g.step();
  ok(!g.space.enemies.includes(e), 'Gegner mit Rest 0 stirbt im nächsten Tick');
  const { g: g2 } = setup('freie_fahrt');
  lercheCountdown(g2, G * 2 - 1e-6);
  Space.shipHit(g2, 0, 2, {});
  ok(g2.ship.schiffZerstoert === true && g2.ship.reaktorCountdown === null, 'Lerche: sofort zerstört (reaktortod.tod)');
});

section('10 Die Stufung des Startwerts bleibt (20, 10, 5, 2,5, 1,25) – minimum nur dort', () => {
  const { g } = setup('freie_fahrt');
  const soll = [20, 10, 5, 2.5, 1.25, 1.25];
  ok(soll.every((s, i) => near(Reaktortod.dauer(g, i + 1), s)), 'Reaktortod.dauer: ' + soll.join(', '));
  const { g: g2 } = setup('arena_space');
  const e = gegner(g2);
  const erw = [20, 10, 5, 2.5, 1.25];
  for (let i = 0; i < 5; i++) {
    Gegnertod.brechen(g2, e, 'reaktor');
    ok(near(e.rt.rest, erw[i]), `Gegner Ausfall ${i + 1}: ${e.rt.rest} s`);
    e.rt.rest = 0.3; treffer(g2, e);
    ok(near(e.rt.rest, 0.15), '  Restzeit unter dem Minimum möglich (0,3 -> 0,15)');
    e.sys.reaktor.z = 'ok'; e.sys.reaktor.i = Gsys.maxOf(e, 'reaktor'); Gegnertod.tick(g2, e, DT);
  }
});

console.log(`\n${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
