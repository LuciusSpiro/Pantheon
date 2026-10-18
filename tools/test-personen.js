'use strict';
// SL0 (CONCEPT-SL0): Personen als Fracht. Frachtbetten, Person an Bord (belegt Frachtplatz und Bett), Beamen von der Oberfläche durch die Ops
// (mit Landepunkt-Scan-Stub), Abgeben, Warenabgabe lässt Personen in Ruhe, Snapshot, Speichern/Laden, Baustein, Notfallsprung mit Person.
//   node tools/test-personen.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Maps = require('../shared/maps.js');
const Weltstand = require('../server/weltstand.js');
const { Game } = require('../server/game.js');
const Fracht = require('../server/sim/fracht.js');
const PB = require('../server/sim/personen-bord.js');
const Away = require('../server/sim/away.js');
const Sprung = require('../server/sim/sprung.js');
const Registry = require('../server/mission/registry.js');

const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, body) {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-personen-'));
let dirSeq = 0;
const freshDir = () => { const d = path.join(TMP, 'w' + (++dirSeq)); fs.mkdirSync(d, { recursive: true }); return d; };

function setup(start, opts) {
  const o = opts || {};
  const g = new Game(Object.assign({ noStore: true, worlds: start !== 'arena_space', worldSaveSync: true, worldDir: o.dir, seed: 21, debug: true,
    env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} }, o.game || {}));
  const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'P0', name: 'Pers0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: start, ...(o.world ? { world: o.world } : {}) });
  g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = []; g.space.projectiles = [];
  const events = []; const emit0 = g.emit.bind(g);
  g.emit = (kind, data) => { events.push(Object.assign({ kind, t: g.time }, data)); return emit0(kind, data); };
  const mev = []; const me0 = g.missionEvent.bind(g);
  g.missionEvent = (kind, data) => { mev.push(Object.assign({ kind }, data)); return me0(kind, data); };
  const p = g.players[0];
  const run = (sec) => { for (let k = 0; k < Math.round(sec / DT); k++) g.step(); };
  const T = { g, c, p, run, events, mev, ev: (k) => events.filter((e) => e.kind === k), me: (k) => mev.filter((e) => e.kind === k) };
  T.ops = () => { p.console = 'weapons'; };
  T.cmd = (cmd, f) => { c.inbox.length = 0; g.handleMessage(c, Object.assign({ t: 'cmd', c: cmd }, f || {})); return c.inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  return T;
}
function arena() {
  const T = setup('arena_space');
  const sh = T.g.ship; sh.x = T.g.space.w / 2; sh.y = T.g.space.h / 2; sh.angle = 0; sh.vx = 0; sh.vy = 0; sh.turnVel = 0;
  T.g.god = true; T.run(0.1);
  return T;
}

section('Frachtbetten im Grundriss (PAN-01 B: zwei je Modulraum)', () => {
  ok(Array.isArray(Maps.CARGO_BEDS) && Maps.CARGO_BEDS.length === 8, 'acht Frachtbetten (zwei je Modulraum)');
  for (const b of Maps.CARGO_BEDS) {
    const r = Maps.roomAt(b.x, b.y);
    ok(Maps.ship.at(b.x, b.y) === 'r' && Maps.ship.solid(b.x, b.y) && r && r.kind === 'modul' && r.modul === b.raum, `${b.id} in Modulraum ${b.raum}, solide`);
    ok(!Maps.ship.solid(b.access.x, b.access.y), `${b.id}: Zugangskachel begehbar`);
  }
  ok(Maps.cargoCapacity([1]) === 2 && Maps.frachtPlaetze([1]).beds.length === 2, 'Kapazität 2 je Frachtraum (Personen und Waren teilen sich die Plätze), zwei Betten je Frachtraum');
});

section('Mehrere Frachträume: Personen und Betten', () => {
  const T = arena();
  const Modul = require('../server/sim/module.js');
  require('../server/sim/ausbau.js').setStufe(T.g, 2);
  T.g.ship.module = [{ id: 'frachtraum', raum: 1, an: true, lauf: true }, { id: 'frachtraum', raum: 3, an: true, lauf: true }, { id: 'krankenstation', raum: 2, an: true, lauf: true }];
  Modul.verteilungSetzen(T.g);
  ok(Fracht.capacity(T.g) === 4 && PB.bettFrei(T.g) === 0, 'zwei Frachträume: Kapazität 4, erstes Bett frei');
  for (const [id, n] of [['a', 'Anna'], ['b', 'Bernd'], ['c', 'Carla'], ['d', 'Dirk']]) ok(PB.personAnBordLegen(T.g, id, n), `${n} an Bord`);
  ok(!PB.personAnBordLegen(T.g, 'e', 'Egon') && PB.bettFrei(T.g) === -1, 'fünfte Person abgelehnt, kein Bett frei');
  const figs = T.g.snapshot().ship.npcs.filter((q) => q.lie === 1);
  const beds = Maps.frachtPlaetze([1, 3]).beds;
  ok(figs.length === 4 && beds.every((b) => figs.some((f) => Math.floor(f.x / 32) === b.x && Math.floor(f.y / 32) === b.y)), 'vier liegende Figuren auf den vier Betten beider Frachträume (Räume 1 und 3)');
  ok(T.g.snapshot().fracht.pers.map((p) => p.b).join() === '0,1,4,5', 'Snapshot fracht.pers: Betten 0, 1 (Raum 1) und 4, 5 (Raum 3), an die Raumnummer gebunden');
  PB.personAbgeben(T.g, 'b');
  ok(PB.bettFrei(T.g) === 1 && Fracht.frei(T.g) === 1, 'Bett 1 wird frei, ein Platz frei');
});

section('Person an Bord: Platz, Bett, Snapshot', () => {
  const T = arena();
  ok(PB.personAnBordLegen(T.g, 'evert', 'Evert Kroeger'), 'Evert an Bord gelegt');
  ok(PB.personAnBord(T.g, 'evert') && Fracht.anBord(T.g) === 1 && Fracht.frei(T.g) === 1, 'belegt einen Frachtplatz');
  ok(T.me('personAnBord').length === 1 && T.me('personAnBord')[0].person === 'evert', 'missionEvent personAnBord');
  const s = T.g.snapshot();
  ok(s.fracht && s.fracht.pers && s.fracht.pers[0].id === 'evert' && s.fracht.pers[0].b === 0, 'Snapshot fracht.pers mit Bett 0');
  ok(!s.fracht.lager, 'Snapshot fracht.lager enthält nur Ware (Buchten bleiben leer)');
  const f = (s.ship.npcs || []).find((q) => q.id === 'evert');
  const bc = Maps.CARGO_BEDS[0];
  ok(f && f.lie === 1 && Math.floor(f.x / 32) === bc.x && Math.floor(f.y / 32) === bc.y, 'Figur liegt auf Bett 0 (ship.npcs, lie 1)');
  Fracht.anBordLegen(T.g, 'fracht');
  ok(Fracht.frei(T.g) === 0 && !PB.personAnBordLegen(T.g, 'zweite', 'Zweite'), 'Frachtraum voll: zweite Person abgelehnt');
  ok(PB.personAnBordLegen(T.g, 'evert', 'Evert'), 'doppeltes Einlagern derselben Person ist harmlos');
  const bad = PB.aufnehmenGrund(T.g, null);
  ok(/Frachtraum voll/.test(bad || ''), 'Aufnehmen bei vollem Frachtraum: ' + bad);
  ok(Sprung.notsprungGrund(T.g) === null || !/Außenteam/.test(Sprung.notsprungGrund(T.g) || ''), 'Person an Bord blockiert den Notfallsprung nicht (kein Außenteam)');
});

section('Warenabgabe lässt Personen an Bord', () => {
  const T = setup('free', { dir: freshDir() });
  T.run(0.5); T.ops();
  T.g.debugGoto('hafen', false); T.run(0.3);
  PB.personAnBordLegen(T.g, 'evert', 'Evert');
  Fracht.anBordLegen(T.g, 'sprengstoff');
  T.g.ship.x = 620; T.g.ship.y = 700;
  const err = T.cmd('weapons.abliefern');
  ok(!err.length && T.g.fracht.halt && T.g.fracht.halt.kind === 'ab', 'Waren abliefern startet ' + JSON.stringify(err));
  T.run(3.2);
  ok(Fracht.anBord(T.g, 'sprengstoff') === 0 && PB.personAnBord(T.g, 'evert'), 'Sprengstoff weg, Evert noch an Bord');
  Fracht.skriptAbliefern(T.g, null, null);
  ok(PB.personAnBord(T.g, 'evert'), 'Skript-Warenabgabe ohne Art lässt Personen in Ruhe');
  // Person abgeben (Ops, Halteprozess)
  const e2 = T.cmd('weapons.person_ab');
  ok(!e2.length && T.g.fracht.halt && T.g.fracht.halt.kind === 'person_ab', 'weapons.person_ab startet am Hafen ' + JSON.stringify(e2));
  ok(T.g.snapshot().fracht.halt.kind === 'person_ab', 'Snapshot halt.kind person_ab');
  T.run(3.2);
  ok(!PB.personAnBord(T.g, 'evert') && T.me('personAbgegeben').length === 1 && T.me('personAbgegeben')[0].person === 'evert', 'nach 3 s abgegeben, Ereignis personAbgegeben');
});

section('Ops beamt eine Person vom Landepunkt (Scan-Stub)', () => {
  const T = arena(); T.ops();
  const aw = T.g.aways.platform;
  T.g.away = aw;
  Away.spawnPerson(T.g, 'platform', { x: 8, y: 8 }, { person: 'evert', name: 'Evert Kroeger' });
  const sh = T.g.ship;
  const spot0 = Away.beamSpot;
  T.g.transferZiel = { lp: 'platform', scene: T.g.ship.scene };   // gewählter Landepunkt (die Stub-Position ersetzt away.beamSpot)
  const spX = sh.x + 50, spY = sh.y;
  Away.beamSpot = () => ({ x: spX, y: spY, range: 300, map: 'platform' });
  const LP = require('../server/sim/lpscan.js');
  try {
    ok(/gescannt/.test(PB.aufnehmenGrund(T.g, 'evert') || ''), 'ohne Landepunkt-Scan kein Beamen: ' + PB.aufnehmenGrund(T.g, 'evert'));
    LP.markieren(T.g, 'platform');
    ok(LP.gescannt(T.g, 'platform'), 'Landepunkt platform gescannt (lpscan)');
    ok(PB.aufnehmbare(T.g).length === 1, 'Evert ist aufnehmbar (Kennung, nicht verletzt)');
    ok(T.g.snapshot().fracht.pq[0].id === 'evert', 'Snapshot fracht.pq nennt Evert');
    let err = T.cmd('weapons.person');
    ok(!err.length && T.g.fracht.halt && T.g.fracht.halt.kind === 'person_an', 'weapons.person startet den Halteprozess ' + JSON.stringify(err));
    T.run(1);
    sh.x += 500; T.run(0.1);
    ok(!T.g.fracht.halt && !PB.personAnBord(T.g, 'evert'), 'Schiff außer Reichweite: Abbruch, Person bleibt unten');
    sh.x -= 500;
    T.cmd('weapons.person'); T.run(3.2);
    ok(PB.personAnBord(T.g, 'evert') && T.me('npcRescued').length === 1 && T.me('npcRescued')[0].person === 'evert', 'nach 3 s an Bord, npcRescued wie bei der Rettung');
    ok(Away.personState(T.g, 'platform', 'evert') === 'rescued', 'Karte führt Evert als gerettet');
    ok(PB.aufnehmbare(T.g).length === 0, 'nichts mehr aufnehmbar');
    // verletzte Personen: erst Medipack
    Away.spawnPerson(T.g, 'platform', { x: 9, y: 8 }, { person: 'kora', name: 'Kora', injured: true });
    ok(/verletzt/.test(PB.aufnehmenGrund(T.g, 'kora') || ''), 'verletzte Person wird abgelehnt: ' + PB.aufnehmenGrund(T.g, 'kora'));
    // Scan-Pflicht (SL7b): Scan zurücknehmen -> kein Beamen
    Away.spawnPerson(T.g, 'platform', { x: 9, y: 8 }, { person: 'kora', name: 'Kora' });
    T.g.explore.mapsKnown.platform = false;
    ok(/gescannt/.test(PB.aufnehmenGrund(T.g, 'kora') || ''), 'Landepunkt nicht gescannt: kein Beamen');
  } finally { Away.beamSpot = spot0; }
});

section('Weltstand: Speichern und Laden mit Person', () => {
  const dir = freshDir();
  const T = setup('free', { dir });
  T.run(0.3);
  const id = T.g.weltstand.id;
  PB.personAnBordLegen(T.g, 'evert', 'Evert Kroeger'); Fracht.anBordLegen(T.g, 'fracht');
  T.g.menu ? 0 : 0;
  T.c.inbox.length = 0; T.g.handleMessage(T.c, { t: 'menu', op: 'end' });
  const data = JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8'));
  ok(JSON.stringify(data.schiff.fracht) === '[{"p":"evert","n":"Evert Kroeger","b":0},"fracht"]', 'Stand enthält Person ' + JSON.stringify(data.schiff.fracht));
  ok(Weltstand.validate(data).length === 0, 'Stand ist schema-gültig ' + (Weltstand.validate(data)[0] || ''));
  const L = setup('free', { dir, world: id });
  L.run(0.3);
  ok(PB.personAnBord(L.g, 'evert') && Fracht.anBord(L.g, 'fracht') === 1 && Fracht.frei(L.g) === 0, 'nach dem Laden: Evert und Fracht an Bord');
  ok(PB.personenAnBord(L.g)[0].bett === 0 && PB.personenAnBord(L.g)[0].name === 'Evert Kroeger', 'Bett und Name erhalten');
});

section('Bausteine', () => {
  const names = ['person_aufnehmen', 'person_abgeben', 'person_an_bord'];
  const ids = Registry.list ? Registry.list().map((b) => b.id) : names;
  ok(names.every((x) => ids.includes(x) || (Registry.get && Registry.get(x))), 'Bausteine person_aufnehmen / person_abgeben / person_an_bord registriert');
});

console.log(`\ntest-personen: ${n - fails}/${n} ok`);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
process.exit(fails ? 1 : 0);
