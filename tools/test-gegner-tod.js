'use strict';
// SYS-01 C1a-2 „Der Tod der Gegner“ (Kai, 2026-10-26; Konzept „Systemmodell Zonen“, Abschnitt „Tod: Reaktor“ und „Gegner im neuen Modell“):
//   A  Reaktor-Countdown: zerstörter Reaktor eines Gegners = Countdown wie bei der Lerche (20 / 10 / 5 / 2,5 s), Ablauf = Tod über enemyDown,
//      Rückgabe des Reaktors = Countdown endet, Zähler bleibt; kein Countdown bei intaktem Reaktor; Zähler je Gegner unabhängig.
//   B  Kapern: Enterziel + zerstörter Schildgenerator = Prise; Tod über den Reaktor = keine Prise; Tutorial bleibt ohne Kapern.
//   C  Torpedo: systemModell.torpedoSofortTod (Jäger) stirbt sofort bei Schild 0, bei jeder Crewgröße; am stehenden Schild prallt er ab; andere Klassen
//      bekommen einen Systemtreffer.
//   D  Testhilfe toeten (Countdown abwarten) und toetenSofort; Determinismus über game.rng.
//   node tools/test-gegner-tod.js
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Gsys = require('../server/sim/gegnersystem.js');
const Gegnertod = require('../server/sim/gegnertod.js');
const reaktortod = require('../server/sim/reaktortod.js');
const Entern = require('../server/sim/entern.js');
const I = require('../server/sim/interior.js');
const Katalog = require('../shared/schiffskatalog.js');
const Schilde = require('../shared/schilde.js');
const Testhilfe = require('./gegner-testhilfe.js');

const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, fn) => { console.log('\n[' + t + ']'); try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); } };

// Testspiel wie in test-entern.js (Lobby-Start arena_space, ohne Wellen), Lerche unverwundbar, ohne eigene Waffen
function arena(seed) {
  const g = new Game({ noStore: true, seed: seed || 61, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'TD0', name: 'TD0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' });
  g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = []; g.space.projectiles = [];
  const sh = g.ship; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; sh.vx = 0; sh.vy = 0; sh.turnVel = 0; sh.speed = 0;
  g.god = true;
  const events = [];
  const emit0 = g.emit.bind(g);
  g.emit = (kind, data) => { events.push(Object.assign({ kind }, data)); return emit0(kind, data); };
  const mev = [];
  const mev0 = g.missionEvent.bind(g);
  g.missionEvent = (kind, data) => { mev.push(Object.assign({ kind }, data)); return mev0(kind, data); };
  // Die Lerche feuert nicht (sonst treffen eigene Schüsse die Gegner): Ladung und Salve jedes Geschützes vor jedem Tick auf null
  const noWeapons = () => { for (const k of ['bow', 'port', 'stbd']) if (g.ship.mount[k]) { g.ship.mount[k].charge = 0; g.ship.mount[k].salvo = 0; } };
  const run = (sec) => { for (let k = 0; k < Math.round(sec / DT); k++) { noWeapons(); g.step(); } };
  return { g, run, ev: (k) => events.filter((x) => x.kind === k), mev: (k) => mev.filter((x) => x.kind === k), events };
}
// Gegner vor der Lerche (250 px voraus), ruhend
function gegner(g, kind, o) {
  const sh = g.ship;
  const e = space.spawnEnemy(g, kind, Object.assign({ x: sh.x + 250, y: sh.y, facing: Math.PI }, o || {}));
  e.vx = 0; e.vy = 0;
  e.gestellt = true;   // SYS-01 C2a: diese Tests prüfen den Tod; ohne Reparatur des Gegners (der Reaktor käme sonst nach 12 s zurück). Reparatur: tools/test-gegner-reparatur.js
  return e;
}
// Crewgröße: verbundene Spieler (space.crewScale zählt sie). Fehlende Spieler werden als Platzhalter angelegt.
function setCrew(g, k) {
  while (g.players.length < k) g.players.push(Object.assign({}, g.players[0], { id: 'platz' + g.players.length, connected: true }));
  g.players.forEach((p, i) => { p.connected = i < k; });
}
const reaktorZ = (e) => e.sys.reaktor.z;
const kills = (g) => g.stats.kills;
// Torpedo der Lerche auf den Bug-Bereich des Gegners (Quelle vor dem Bug, Flug gegen den Gegner, Ruhe)
function torpedoAufBug(g, e) {
  const bx = Math.cos(e.angle), by = Math.sin(e.angle);
  g.space.projectiles.push({ id: 'tp' + g.space.projectiles.length, kind: 'torpedo', x: e.x + bx * 10, y: e.y + by * 10, angle: e.angle + Math.PI, speed: 0, ttl: 2, dmg: 45, owner: 'lerche' });
}

// Die Schildgrenzen: alle Segmente auf 0 (ein Torpedo im Bug trifft dann), sonst volle Schilde
const schildOffen = (g, e) => { Testhilfe.schildNull(e, null, g); };

section('A1 Reaktor-Countdown: zerstört startet den Countdown, der Gegner lebt weiter (Solo, 20 s)', () => {
  const { g, run, mev } = arena(61);
  const e = gegner(g, 'korvette');
  const k0 = kills(g);
  Gegnertod.brechen(g, e, 'reaktor');
  ok(g.space.enemies.includes(e) && kills(g) === k0, 'zerstörter Reaktor: kein Sofort-Tod, der Gegner ist noch da');
  ok(e.rt && e.rt.n === 1 && Math.abs(e.rt.rest - CONFIG.reaktorTod.start) < 1e-9, 'erster Ausfall: Countdown 20 s, Zähler 1');
  ok(Gegnertod.restZehntel(e) === 200, 'Restzeit im Snapshot: 200 (Zehntelsekunden)');
  e.shields.fill(0);
  run(0.5);
  ok(g.space.enemies.includes(e) && e.rt.rest < CONFIG.reaktorTod.start && e.rt.rest > 19, 'nach 0,5 s läuft der Countdown mit der Spielzeit');
  run(20);
  ok(!g.space.enemies.includes(e) && kills(g) === k0 + 1, 'nach Ablauf: der Gegner ist weg, genau ein Abschuss gezählt');
  ok(mev('enemyKilled').length === 1, 'enemyKilled genau einmal');
});

section('A2 Countdown-Stufen 20 / 10 / 5 / 2,5 s (Ausfälle 1–4) und Rettung durch Rücksprung', () => {
  const { g } = arena(62);
  const e = gegner(g, 'fregatte');
  const erwartet = [20, 10, 5, 2.5];
  for (let i = 0; i < 4; i++) {
    Gegnertod.brechen(g, e, 'reaktor');
    ok(Math.abs(e.rt.rest - erwartet[i]) < 1e-9 && e.rt.n === i + 1 && e.rt.rest === reaktortod.dauer(g, i + 1),
      `Ausfall ${i + 1}: Countdown ${erwartet[i]} s = reaktortod.dauer (eine Formel)`);
    e.sys.reaktor.z = 'damaged';   // Reparatur auf beschädigt (C2 folgt; hier der Rücksprung)
    ok(!Gegnertod.tick(g, e, DT) && e.rt.rest === null && e.rt.n === i + 1, `Ausfall ${i + 1}: Rücksprung auf nicht zerstört beendet den Countdown, der Zähler (${i + 1}) bleibt`);
    e.sys.reaktor.z = 'ok'; e.sys.reaktor.i = Gsys.maxOf(e, 'reaktor');
  }
  ok(g.space.enemies.includes(e), 'nach vier Rettungen lebt der Gegner');
  Gegnertod.brechen(g, e, 'reaktor');
  ok(Math.abs(e.rt.rest - CONFIG.reaktorTod.minimum) < 1e-9 && e.rt.n === 5, 'fünfter Ausfall: 1,25 s = Minimum (Formel 20 × 0,5^4 liegt darunter)');
});

section('A3 Countdown-Ablauf über tick: genau einmal, dann nicht mehr; Rettung bei Reparatur vor Ablauf', () => {
  const { g } = arena(63);
  const e = gegner(g, 'raider');
  Gegnertod.brechen(g, e, 'reaktor');
  let abgelaufen = 0;
  for (let k = 0; k < Math.round(25 / DT); k++) if (Gegnertod.tick(g, e, DT)) abgelaufen++;
  ok(abgelaufen === 1, 'tick meldet den Ablauf genau einmal (' + abgelaufen + ')');
  const e2 = gegner(g, 'raider', { y: g.ship.y + 120 });
  Gegnertod.brechen(g, e2, 'reaktor');
  for (let k = 0; k < Math.round(5 / DT); k++) Gegnertod.tick(g, e2, DT);
  e2.sys.reaktor.z = 'damaged';
  let weg = false;
  for (let k = 0; k < Math.round(30 / DT); k++) if (Gegnertod.tick(g, e2, DT)) weg = true;
  ok(!weg && e2.rt.rest === null, 'Rettung nach 5 s: kein Tod, auch nach 30 s');
});

section('A4 kein Countdown bei intaktem Reaktor; Zähler je Gegner unabhängig', () => {
  const { g } = arena(64);
  const a = gegner(g, 'korvette');
  const b = gegner(g, 'korvette', { y: g.ship.y + 150 });
  ok(!Gegnertod.tick(g, a, 60) && a.rt == null, 'intakter Reaktor: kein Countdown, kein Zählerfeld');
  Gegnertod.brechen(g, a, 'reaktor'); a.sys.reaktor.z = 'damaged'; Gegnertod.tick(g, a, DT);
  Gegnertod.brechen(g, a, 'reaktor');
  ok(a.rt.n === 2 && Math.abs(a.rt.rest - 10) < 1e-9, 'Gegner a: zweiter Ausfall = 10 s');
  Gegnertod.brechen(g, b, 'reaktor');
  ok(b.rt.n === 1 && Math.abs(b.rt.rest - 20) < 1e-9, 'Gegner b: eigener Zähler, erster Ausfall = 20 s');
  ok(Gegnertod.restZehntel(a) === 100 && Gegnertod.restZehntel({}) === -1, 'Restzeit je Gegner (100 bzw. -1 ohne Countdown)');
});

section('A5 Countdown läuft im Spielzweig (g.step) weiter: Gegner stirbt nach der Zeit, auch gestellt', () => {
  const { g, run } = arena(65);
  const e = gegner(g, 'korvette');
  e.retreatUntil = g.time + 100;   // fliehend: der Countdown läuft weiter
  const k0 = kills(g);
  Gegnertod.brechen(g, e, 'reaktor');
  run(10);
  ok(g.space.enemies.includes(e) && kills(g) === k0, 'nach 10 s noch da (Countdown 20 s)');
  run(11);
  ok(!g.space.enemies.includes(e) && kills(g) === k0 + 1, 'nach 21 s tot, auch gestellt');
});

section('A6 Der Gegner kämpft im Countdown weiter: Schild und Waffen wirken wie vorher', () => {
  const { g } = arena(66);
  const e = gegner(g, 'korvette');
  const nWaffen = space.waffenPlaetze(g, e).length;
  Gegnertod.brechen(g, e, 'reaktor');
  e.shields.fill(4);
  const vor = e.shields.reduce((a, v) => a + v, 0);
  space.damageEnemy(g, e, 2, e.x + 300, e.y, { pierce: 0 });
  ok(e.shields.reduce((a, v) => a + v, 0) < vor, 'Treffer auf den Schild während des Countdowns wirkt');
  ok(g.space.enemies.includes(e) && e.rt.rest != null, 'der Gegner bleibt im Kampf');
  ok(space.waffenPlaetze(g, e).length === nWaffen, 'Waffen wirken unverändert (Plätze ' + nWaffen + ')');
});

section('B1 Kapern: Enterziel, Schildgenerator zerstört = Prise (treibt), Buchhaltung wie ein Abschuss', () => {
  const { g, ev } = arena(71);
  const e = gegner(g, 'raider', { tag: 'beute' });
  e.entern = true;
  const k0 = kills(g); const m0 = g.inventory.marks;
  Gegnertod.brechen(g, e, 'schildgenerator');
  ok(e.st === 'treibt' && !g.space.enemies.includes(e) && Entern.treibende(g).includes(e), 'Schildgenerator zerstört: Prise, Schiff treibt');
  ok(kills(g) === k0 + 1 && g.inventory.marks === m0 + CONFIG.enemies.raider.salvage, 'Marken und Abschuss-Zähler wie bisher');
  ok(ev('enternFrei').length === 1, 'Ereignis enternFrei');
  ok(!!Entern.istPrise(g, g.ship.scene + '.prise'), 'Prise am Ort angelegt');
});

section('B2 Kapern ausgeschlossen: Enterziel, Reaktor zerstört (Countdown läuft ab) = Tod, keine Prise', () => {
  const { g, ev, run } = arena(72);
  const e = gegner(g, 'korvette');
  e.entern = true;
  const k0 = kills(g);
  Gegnertod.brechen(g, e, 'reaktor');
  run(21);
  ok(!g.space.enemies.includes(e) && kills(g) === k0 + 1, 'Reaktor-Countdown abgelaufen: der Gegner stirbt');
  ok(e.st == null && !Entern.treibende(g).includes(e), 'keine Prise, kein treibendes Wrack');
  ok(Object.keys(g.entern ? g.entern.prisen : {}).length === 0 && ev('enternFrei').length === 0, 'keine Prise, kein enternFrei');
});

section('B3 Reihenfolge: Reaktor-Countdown läuft, Schildgenerator fällt danach = Prise, Countdown bricht ab', () => {
  const { g, run } = arena(73);
  const e = gegner(g, 'korvette');
  e.entern = true;
  Gegnertod.brechen(g, e, 'reaktor');
  run(3);
  Gegnertod.brechen(g, e, 'schildgenerator');
  ok(e.st === 'treibt' && !g.space.enemies.includes(e), 'Prise trotz laufendem Countdown');
  ok(e.rt && e.rt.rest === null, 'der Countdown ist abgebrochen');
  run(25);
  ok(e.st === 'treibt' && (g.stats.kills >= 1), 'nach Ablauf der Zeit bleibt es eine Prise (kein zweiter Tod)');
});

section('B4 Alte Regel weg: Enterziel mit Integrität 0 (ohne Schildgenerator-Zerstörung) ist keine Prise', () => {
  const { g } = arena(74);
  const e = gegner(g, 'korvette');
  e.entern = true;
  for (const id of Gsys.ids(e)) if (id !== 'schildgenerator') { e.sys[id].i = 0; e.sys[id].z = 'broken'; }   // Integrität 0 bis auf den Schildgenerator
  e.hp = Gsys.summe(e);
  ok(!Gsys.tot(e) && e.st == null && !Entern.istPrise(g, g.ship.scene + '.prise'), 'kein Kapern ohne zerstörten Schildgenerator (Schildgenerator noch intakt)');
});

section('B5 Nicht-Ziel stirbt wie üblich (Reaktor-Countdown), auch bei zerstörtem Schildgenerator keine Prise', () => {
  const { g } = arena(75);
  const e = gegner(g, 'fregatte');
  const k0 = kills(g);
  Gegnertod.brechen(g, e, 'schildgenerator');
  ok(e.st == null && g.space.enemies.includes(e), 'ohne Enterziel: Schildgenerator zerstört, der Gegner kämpft weiter');
  Testhilfe.toeten(g, e);
  ok(!g.space.enemies.includes(e) && kills(g) === k0 + 1 && e.st == null, 'Testhilfe.toeten: Countdown abgelaufen, kein Kapern');
  ok(Object.keys(g.entern ? g.entern.prisen : {}).length === 0, 'keine Prise');
});

section('B6 Tutorial (m2): Kapern aus, der Schildgenerator-Übergang macht keine Prise', () => {
  const { g } = arena(76);
  const e = gegner(g, 'raider'); e.entern = true;
  const act0 = g.mission.activeId;
  g.mission.activeId = 'm2';
  Gegnertod.brechen(g, e, 'schildgenerator');
  ok(e.st == null && g.space.enemies.includes(e), 'im Tutorial: Schildgenerator zerstört, keine Prise');
  g.mission.activeId = act0;
});

section('C1 Torpedo: Jäger stirbt sofort bei Schild 0, bei jeder Crewgröße (solo, zu zweit, zu dritt)', () => {
  for (const k of [1, 2, 3]) {
    const { g, run, mev } = arena(80 + k);
    setCrew(g, k);
    const e = gegner(g, 'raider');
    schildOffen(g, e);
    const k0 = kills(g); const tr0 = g.stats.torpedoTreffer || 0;
    torpedoAufBug(g, e);
    run(DT);
    ok(!g.space.enemies.includes(e) && kills(g) === k0 + 1, `Crew ${k}: Jäger am offenen Bug-Schild stirbt sofort`);
    ok(!e.rt || e.rt.rest == null, `Crew ${k}: kein Countdown`);
    ok((g.stats.torpedoTreffer || 0) === tr0 + 1, `Crew ${k}: zählt als Torpedo-Treffer`);
    ok(mev('enemyKilled').length >= 1, `Crew ${k}: enemyKilled ausgelöst`);
  }
});

section('C2 Torpedo prallt am stehenden Schild ab (Schild > 0): kein Tod, keine Systemschäden', () => {
  const { g, run } = arena(84);
  const e = gegner(g, 'raider');
  const lay = Schilde.layout(g.C, e.kind);
  const bugSeg = lay.segs.findIndex((s) => s.seite === 0);
  const werte = e.shields.map((v, i) => (i === bugSeg ? 5 : 0));
  Testhilfe.setzeSchilde(e, werte);
  const vor = Gsys.summe(e);
  torpedoAufBug(g, e);
  run(DT);
  ok(g.space.enemies.includes(e) && Gsys.summe(e) === vor, 'am stehenden Schild abgeprallt: lebt, kein Systemschaden');
  ok(e.shields[bugSeg] === 5, 'Schild unverändert (Lesart B)');
});

section('C3 andere Klassen: Torpedo trifft ein System der Zone, kein Sofort-Tod (Korvette, Fregatte, Kreuzer)', () => {
  for (const kind of ['korvette', 'fregatte', 'kreuzer']) {
    const { g, run } = arena(90);
    const e = gegner(g, kind);
    schildOffen(g, e);
    const vor = Gsys.summe(e);
    torpedoAufBug(g, e);
    run(DT);
    ok(g.space.enemies.includes(e) && Gsys.summe(e) < vor, kind + ': lebt, ein System der Zone hat Integrität verloren');
  }
});

section('C4 Config: systemModell.torpedoSofortTod.<klasse> (nur Jäger) und live per echtem tune-Befehl wirksam (nicht im Katalog)', () => {
  const T = CONFIG.systemModell.torpedoSofortTod;
  ok(T.raider === true && Object.keys(T).filter((k) => T[k] === true).join() === 'raider', 'nur der Jäger (raider) ist true');
  ok(Katalog.TORPEDO.sofortTod === undefined, 'der Katalog trägt den Wert nicht mehr (sonst wäre er nicht live änderbar)');
  const combat = require('../server/sim/combat.js');
  try {
    { const { g, run } = arena(86); const r = combat.tune(g, 'systemModell.torpedoSofortTod.raider', 'off');
      ok(r.ok, 'tune systemModell.torpedoSofortTod.raider off: ' + r.text);
      const e = gegner(g, 'raider'); schildOffen(g, e); const vor = Gsys.summe(e); torpedoAufBug(g, e); run(DT);
      ok(g.space.enemies.includes(e) && Gsys.summe(e) < vor, 'raider off: der Jäger stirbt nicht mehr sofort, ein System der Zone verliert Integrität'); }
    { const { g, run } = arena(87); const r = combat.tune(g, 'systemModell.torpedoSofortTod.korvette', 'on');
      ok(r.ok, 'tune systemModell.torpedoSofortTod.korvette on: ' + r.text);
      const e = gegner(g, 'korvette'); schildOffen(g, e); const k0 = kills(g); torpedoAufBug(g, e); run(DT);
      ok(!g.space.enemies.includes(e) && kills(g) === k0 + 1, 'korvette on: die Korvette stirbt sofort'); }
  } finally { T.raider = true; T.korvette = false; }
});
section('D1 Testhilfe: toeten lässt den Countdown ablaufen, toetenSofort tötet ohne Countdown', () => {
  const { g } = arena(95);
  const a = gegner(g, 'korvette');
  const k0 = kills(g);
  Testhilfe.toeten(g, a);
  ok(!g.space.enemies.includes(a) && kills(g) === k0 + 1 && a.sys.reaktor.z === 'broken', 'toeten: Reaktor zerstört, Countdown abgelaufen, tot');
  const b = gegner(g, 'fregatte', { y: g.ship.y + 200 });
  Testhilfe.toetenSofort(g, b);
  ok(!g.space.enemies.includes(b) && kills(g) === k0 + 2 && !(b.rt && b.rt.rest), 'toetenSofort: tot ohne Countdown');
});

section('E1 Gegner-Countdown gilt immer: auch in einer Übung und im Gottmodus (nur der Lerchen-Countdown hat das Gate)', () => {
  const { g, run } = arena(98);   // arena setzt g.god = true
  const drill0 = g.mission.isDrill;
  g.mission.isDrill = () => true;
  try {
    ok(g.god === true && g.mission.isDrill() === true, 'Vorbedingung: Übung und Gottmodus aktiv (isDrill true, god true)');
    const e = gegner(g, 'korvette');
    Gegnertod.brechen(g, e, 'reaktor');
    ok(e.rt && Math.abs(e.rt.rest - CONFIG.reaktorTod.start) < 1e-9, 'Übung und God: der Gegner-Countdown startet trotzdem (20 s)');
    run(CONFIG.reaktorTod.start + 0.5);
    ok(!g.space.enemies.includes(e), 'Übung und God: der Gegner stirbt nach Ablauf');
    Gegnertod.brechen(g, gegner(g, 'korvette', { y: g.ship.y + 150 }), 'reaktor');
    g.ship.systems.reactor = 'ok'; I.damageSystem(g, 'reactor', 'broken');
    ok(!g.ship.reaktorCountdown, 'Gegenprobe: der Lerchen-Countdown startet in Übung/God nicht (Gate bleibt)');
  } finally { g.mission.isDrill = drill0; }
});

section('E2 Gegner ohne Modell (Störrelais): stirbt bei hp 0 über enemyDown, kein Countdown, kein Kapern', () => {
  const { g } = arena(99);
  const e = gegner(g, 'relay');
  ok(!Gsys.hat(e) && e.hp > 0, 'Relais hat kein Systemmodell');
  const k0 = kills(g);
  space.damageEnemy(g, e, 9999, e.x - 50, e.y);
  ok(!g.space.enemies.includes(e) && kills(g) === k0 + 1 && !e.rt, 'Relais: hp 0 = tot (enemyDown), kein Countdown');
});

section('D2 Determinismus: gleicher Seed und gleiche Folge = gleicher Zustand (game.rng)', () => {
  const lauf = () => {
    const { g, run } = arena(97);
    const e = gegner(g, 'kreuzer');
    schildOffen(g, e);
    for (let k = 0; k < 6; k++) space.damageEnemy(g, e, 3, e.x + 300, e.y, {});
    Testhilfe.toeten(g, e);
    run(0.1);
    return JSON.stringify([g.stats.kills, g.space.enemies.length, e.rt]);
  };
  ok(lauf() === lauf(), 'zwei Läufe mit gleichem Seed sind gleich');
});

console.log('\n' + (fails === 0 ? 'GEGNER-TOD OK' : 'GEGNER-TOD FEHLER: ' + fails) + ' (' + n + ' Prüfungen)');
process.exit(fails ? 1 : 0);
