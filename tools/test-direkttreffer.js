'use strict';
const Schilde = require('../shared/schilde.js');   // SYS-03 C1: Regenerationspause je Sektor
// SYS-03 B1 „Direkttreffer auf die Lerche“: Ein Treffer ohne Schildschutz schaltet ein Lerche-System genau EINE Stufe weiter
// (ok -> beschädigt -> zerstört), unabhängig von der Schadenszahl. Treffer-Fenster (systemModell.trefferFenster_s), Torpedo unverändert,
// Schild über 0 fängt ab, Fragiles bricht, leere Zone läuft in die Mitte, Reaktor-Countdown nur einmal, Snapshot zeigt den Treffer sofort.
// SYS-03 B-Nacharbeit: Sturm-Fenster (längeres Fenster je System für Sturm-Treffer), Dauerdruck-Zähler (je Sektor, Verfall nach druckAbkling_s), Torpedo reaktorStufen, robuste Stufe
// (tune systemModell.reparatur.damaged 0,6 / 0,7), gezielter Antrieb-Treffer der Gegner auf die Lerche (zwei Stufen, die zweite nach der Sperre).
//   node tools/test-direkttreffer.js
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const Locations = require('../shared/locations.js');
const Physics = require('../shared/physics.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const I = require('../server/sim/interior.js');
const Alarm = require('../server/sim/alarm.js');
const Integ = require('../server/sim/integritaet.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(title, fn) { console.log('\n[' + title + ']'); try { fn(); } catch (e) { fails++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); } }
const SM = CONFIG.systemModell;
const FENSTER = SM.trefferFenster_s;
const FENSTER_STURM = SM.sturm.trefferFenster_s;
const DT = 1 / CONFIG.tickHz;

function newGame(seed) {
  const g = new Game({ noStore: true, seed: seed || 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  g.space.enemies = []; g.space.projectiles = [];
  g.ship.fireList = []; g.ship.breachList = [];
  for (const k of I.SYSTEM_ORDER) g.ship.systems[k] = 'ok';
  g.ship.fragile = {}; g.ship.offline = {}; g.ship.trefferT = {};
  g.ship.shields.current = [0, 0, 0, 0]; Schilde.pause.loeschen(g.ship.shields);
  g.ship.x = 1500; g.ship.y = 800; g.ship.angle = 0; g.ship.docked = false;
  g.god = false;
  I.integritaetVoll(g);
  return g;
}
const zone = (g, z) => I.SYSTEM_ORDER.filter((k) => I.systemSector(k) === z && I.systemAktiv(g, k));
const stand = (g) => { const o = {}; for (const k of I.SYSTEM_ORDER) o[k] = g.ship.systems[k]; return o; };
const geaendert = (g, vor) => I.SYSTEM_ORDER.filter((k) => g.ship.systems[k] !== vor[k]);
const weiter = (g, art) => { g.time += (art === 'sturm' ? FENSTER_STURM : FENSTER) + 0.01; };   // das Treffer-Fenster abwarten (art 'sturm': das längere Sturm-Fenster)
// Zone 0 (Bug) hat genau ein lebendes System: das erste, der Rest zerstört. Rückgabe: dessen Name.
function einziges(g, z) {
  const ks = zone(g, z);
  for (const k of ks.slice(1)) { g.ship.systems[k] = 'broken'; I.setInteg(g, k, 0); }
  return ks[0];
}
const pct = (g, k) => g.snapshot().ship.integ[Protocol.SYSTEMS_INTEG.indexOf(k)];

// ---------------------------------------------------------------- Quellen: je zwei Treffer, eine Stufe je Treffer
const quellen = {
  'Standard-Schuss': { dmgs: [0.1, 50], treffer: (g, d) => space.shipHit(g, 0, d, {}) },
  'Sturm bei Schild 0': { dmgs: [0.1, 50], art: 'sturm', treffer: (g, d) => space.shipHit(g, 0, d, { sperrfeuer: true, sturm: true }) },
  'Streu-zwei (Durchschlag)': { dmgs: [0.1, 50], treffer: (g, d) => space.shipHit(g, 0, d, { pierce: true, streuZwei: true }) },
  'Mine': {
    dmgs: [null], treffer: (g) => {
      const m = { id: 9001, x: g.ship.x + 40, y: g.ship.y, besitzer: 'gegner' };
      g.space.minen = [m]; Alarm.explodiere(g, m, 'test');
    },
  },
};
for (const [name, q] of Object.entries(quellen)) {
  section('Quelle ' + name + ': ok -> beschädigt -> zerstört, unabhängig vom Schaden', () => {
    for (const d of q.dmgs) {
      const g = newGame(31); const s = einziges(g, 0); const vor = stand(g);
      q.treffer(g, d);
      ok(g.ship.systems[s] === 'damaged' && geaendert(g, vor).join() === s, `Schaden ${d}: erster Treffer ok -> beschädigt (${s}), sonst nichts`);
      ok(pct(g, s) === 50, `Schaden ${d}: Snapshot integ ${pct(g, s)} % sofort nach dem ersten Treffer (Soll 50)`);
      weiter(g, q.art); q.treffer(g, d);
      ok(g.ship.systems[s] === 'broken' && pct(g, s) === 0, `Schaden ${d}: zweiter Treffer beschädigt -> zerstört, Snapshot 0 %`);
      weiter(g, q.art); const v2 = stand(g); q.treffer(g, d);
      ok(JSON.stringify(stand(g)) !== JSON.stringify(v2) ? geaendert(g, v2).every((k) => I.systemSector(k) === -1) : true, 'dritter Treffer: Zone leer, geht in die Mitte (nie zurück auf das zerstörte System)');
    }
  });
}

// ---------------------------------------------------------------- Treffer-Fenster
section('Treffer-Fenster: keine Doppelstufe im selben Tick, Treffer sucht ein anderes System', () => {
  const g = newGame(41); const ks = zone(g, 0);   // zwei lebende Systeme im Bug
  space.shipHit(g, 0, 3, {}); space.shipHit(g, 0, 3, {});
  ok(ks.length >= 2 && ks.every((k) => g.ship.systems[k] === 'damaged'), `zwei Treffer im selben Tick: beide Systeme beschädigt (${ks.map((k) => g.ship.systems[k]).join()}), keins zerstört`);
  const g2 = newGame(42); const s = einziges(g2, 0);
  space.shipHit(g2, 0, 3, {}); space.shipHit(g2, 0, 3, {}); space.shipHit(g2, 0, 3, {});
  ok(g2.ship.systems[s] === 'damaged', 'einziges System, drei Treffer im selben Tick: nur eine Stufe, die übrigen verfallen (kein Überlauf in die Mitte)');
  ok(zone(g2, -1).every((k) => g2.ship.systems[k] === 'ok'), 'die Mitte bleibt dabei unberührt');
  g2.time += FENSTER - 0.05; space.shipHit(g2, 0, 3, {});
  ok(g2.ship.systems[s] === 'damaged', 'Treffer knapp vor Ablauf des Fensters: weiter verfallen');
  g2.time += 0.06; space.shipHit(g2, 0, 3, {});
  ok(g2.ship.systems[s] === 'broken', 'nach Ablauf des Fensters: zerstört');
  const g3 = newGame(43); SM.trefferFenster_s = 0;
  try { const s3 = einziges(g3, 0); space.shipHit(g3, 0, 3, {}); space.shipHit(g3, 0, 3, {}); ok(g3.ship.systems[s3] === 'broken', 'Fenster 0 (tune systemModell.trefferFenster_s 0): zwei Treffer im selben Tick zerstören'); } finally { SM.trefferFenster_s = FENSTER; }
  const gl = newGame(44); for (const k of zone(gl, 0)) { gl.ship.systems[k] = 'broken'; I.setInteg(gl, k, 0); }
  const vor = stand(gl); space.shipHit(gl, 0, 3, {});
  const ch = geaendert(gl, vor);
  ok(ch.length === 1 && I.systemSector(ch[0]) === -1, `Zone ganz zerstört: der Treffer geht wie bisher in die Mitte (${ch.join()})`);
  ok(!('trefferT' in g.snapshot().ship) && !JSON.stringify(g.snapshot().ship).includes('trefferT'), 'Fenster-Zeitstempel steht nicht im Snapshot');
});

// ---------------------------------------------------------------- Schild, Fragiles
section('Schild über 0 fängt ab; Fragiles bricht direkt', () => {
  const g = newGame(51); g.ship.shields.current = [6, 6, 6, 6];
  const vor = stand(g);
  space.shipHit(g, 0, 50, {}); space.shipHit(g, 1, 0.1, {}); space.shipHit(g, 2, 3, { sturm: true, sperrfeuer: true });
  ok(geaendert(g, vor).length === 0, 'Schild 6: Treffer 50, 0,1 und Sturm ändern keine Stufe');
  const g2 = newGame(52); const ks = zone(g2, 0); g2.ship.fragile[ks[0]] = true;
  space.shipHit(g2, 0, 0.1, {});
  ok(g2.ship.systems[ks[0]] === 'broken' && !g2.ship.fragile[ks[0]], 'fragiles ok-System bricht beim Treffer direkt auf zerstört');
});

// ---------------------------------------------------------------- Torpedo unverändert
section('Torpedo: System der Zone zerstört, Reaktor zweistufig, Durchschlag ohne Fenster', () => {
  const g = newGame(61); const vor = stand(g);
  space.etorpedoTreffer(g, { x: g.ship.x + 30, y: g.ship.y });
  const ch = geaendert(g, vor); const zerst = ch.filter((k) => g.ship.systems[k] === 'broken');
  ok(zerst.length === 1 && I.systemSector(zerst[0]) === 0 && g.ship.systems.reactor === 'damaged' && pct(g, 'reactor') === 50, `erster Torpedo: ein System der Bugzone zerstört (${zerst.join()}), Reaktor beschädigt (${pct(g, 'reactor')} %)`);
  ok(!g.ship.reaktorCountdown, 'erster Torpedo: noch kein Countdown');
  space.etorpedoTreffer(g, { x: g.ship.x + 30, y: g.ship.y });   // im selben Tick: der Reaktor-Durchschlag scheitert nicht am Fenster
  ok(g.ship.systems.reactor === 'broken' && !!g.ship.reaktorCountdown, 'zweiter Torpedo (selber Tick): Reaktor zerstört, Countdown läuft');
  const cd = g.ship.reaktorCountdown; const n0 = g.ship.reaktorAusfaelle;
  space.etorpedoTreffer(g, { x: g.ship.x + 30, y: g.ship.y }); weiter(g); space.shipHit(g, 0, 3, { durchschlag: 'zone' });
  ok(g.ship.reaktorCountdown === cd && g.ship.reaktorAusfaelle === n0, 'weitere Treffer lösen den Countdown nicht erneut aus');
});

// ---------------------------------------------------------------- Reaktor als Ziel
section('Reaktor als Ziel: Direkttreffer ok -> beschädigt -> zerstört, Countdown genau einmal', () => {
  const g = newGame(71);
  for (const k of zone(g, -1)) if (k !== 'reactor') { g.ship.systems[k] = 'broken'; I.setInteg(g, k, 0); }
  space.shipHit(g, 0, 3, { durchschlag: 'zone' }); space.shipHit(g, 0, 3, { durchschlag: 'zone' });
  ok(g.ship.systems.reactor === 'damaged', 'zwei Treffer im selben Tick: Reaktor beschädigt (Fenster), nicht zerstört');
  weiter(g); space.shipHit(g, 0, 3, { durchschlag: 'zone' });
  ok(g.ship.systems.reactor === 'broken' && !!g.ship.reaktorCountdown && g.ship.reaktorAusfaelle === 1, 'Treffer nach dem Fenster: zerstört, Countdown gestartet');
  weiter(g); space.shipHit(g, 0, 3, { durchschlag: 'zone' }); weiter(g); space.shipHit(g, 0, 3, { durchschlag: 'zone' });
  ok(g.ship.reaktorAusfaelle === 1, 'mehrere Treffer danach: Countdown nur einmal ausgelöst');
});

// ---------------------------------------------------------------- Dauerdruck
section('Dauerdruck: eine Stufe je zonen.druckPunkte, höchstens eine je Takt', () => {
  const SZENE = Locations.get('rabenpass').scene; const alt = { zonen: SZENE.zonen, station: SZENE.station, hafen: SZENE.hafen, kauft: SZENE.kauft };
  try {
    SZENE.zonen = [{ id: 'dd', form: 'kreis', x: 1500, y: 800, r: 40000, schaden: 3, sicht: 1 }]; delete SZENE.station; delete SZENE.hafen; delete SZENE.kauft;
    const g = new Game({ noStore: true, worlds: false, seed: 81, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    const c = { inbox: [], send(m) { if (this.inbox.length < 200) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'D0', name: 'D0', color: 0 });
    g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' }); g.handleMessage(c, { t: 'ready', ready: true });
    if (g.arena) g.arena.nextAt = null;
    space.enterScene(g, 'rabenpass', {}); g.space.enemies = []; g.space.projectiles = [];
    for (let k = 0; k < 10; k++) g.step();
    for (const k of I.SYSTEM_ORDER) g.ship.systems[k] = 'ok'; g.ship.fragile = {}; g.ship.trefferT = {}; I.integritaetVoll(g);
    g.ship.shields.current = [0, 0, 0, 0]; Schilde.pause.alleBis(g.ship.shields, 1e9); g.god = false; g.ship.x = 1500 + 200; g.ship.y = 800;
    const K = CONFIG.zonen.druckPunkte; const rate = 3;
    const stufen = () => I.SYSTEM_ORDER.reduce((a, k) => a + (g.ship.systems[k] === 'damaged' ? 1 : g.ship.systems[k] === 'broken' ? 2 : 0), 0);
    const lauf = (sek) => { for (let k = 0; k < Math.round(sek / DT); k++) { g.ship.x = 1700; g.ship.y = 800; g.step(); } };
    const t0 = g.time; lauf(K / rate - 1.5);
    ok(stufen() === 0, `vor ${K / rate} s (${K} Punkte bei ${rate}/s): noch keine Stufe verloren`);
    lauf(3);
    ok(stufen() === 1, `nach ${(g.time - t0).toFixed(1)} s: genau eine Stufe verloren (${stufen()})`);
    lauf(K / rate);
    ok(stufen() === 2, `nach weiteren ${K / rate} s: zwei Stufen (${stufen()}), nie mehr als eine je Takt`);
  } finally { for (const k of Object.keys(alt)) { if (alt[k] === undefined) delete SZENE[k]; else SZENE[k] = alt[k]; } }
});

// ---------------------------------------------------------------- Sturm-Fenster (SYS-03 B-Nacharbeit)
section('Sturm-Fenster: eine Salve (8 Nadeln in 0,5 s, Schild 0) kostet je System höchstens eine Stufe, nichts in der Mitte; nach dem Fenster wieder eine Stufe', () => {
  const g = newGame(53); const ks = zone(g, 0);
  const zwei = ks.slice(0, 2); for (const k of ks.slice(2)) { g.ship.systems[k] = 'broken'; I.setInteg(g, k, 0); }
  const mitte = zone(g, -1).map((k) => g.ship.systems[k]).join();
  const stufen = (liste) => liste.reduce((a, k) => a + (g.ship.systems[k] === 'damaged' ? 1 : g.ship.systems[k] === 'broken' ? 2 : 0), 0);
  for (let i = 0; i < 8; i++) { space.shipHit(g, 0, 0.5, { sperrfeuer: true, sturm: true }); g.time += 0.5 / 8; }
  ok(zwei.length === 2 && zwei.every((k) => g.ship.systems[k] === 'damaged'), `8 Nadeln in 0,5 s auf eine Zone mit 2 Systemen: je System eine Stufe (${zwei.map((k) => g.ship.systems[k]).join()}), keins zerstört`);
  ok(zone(g, -1).map((k) => g.ship.systems[k]).join() === mitte, 'nichts in der Mitte (die Treffer im Fenster verfallen, kein Überlauf)');
  g.time += 0.4; space.shipHit(g, 0, 0.5, { sperrfeuer: true, sturm: true });
  ok(stufen(zwei) === 2, 'weitere Nadel 0,9 s nach der ersten Stufe (noch im Sturm-Fenster ' + FENSTER_STURM + ' s): keine weitere Stufe');
  g.time += FENSTER_STURM; space.shipHit(g, 0, 0.5, { sperrfeuer: true, sturm: true });
  ok(stufen(zwei) === 3, `nach Ablauf des Fensters: eine weitere Stufe (${zwei.map((k) => g.ship.systems[k]).join()})`);
  // das längere Fenster gilt gegen JEDEN Treffer auf dasselbe System (eine Fensterlänge je Treffer-Art, die Art des ersten Treffers bestimmt sie)
  const g2 = newGame(54); const s = einziges(g2, 0);
  space.shipHit(g2, 0, 0.5, { sperrfeuer: true, sturm: true }); g2.time += 0.5; space.shipHit(g2, 0, 3, {});
  ok(g2.ship.systems[s] === 'damaged', 'Standard-Treffer 0,5 s nach einem Sturm-Treffer: im Sturm-Fenster, verfällt');
  g2.time += FENSTER_STURM; space.shipHit(g2, 0, 3, {});
  ok(g2.ship.systems[s] === 'broken', 'Standard-Treffer nach dem Sturm-Fenster: zerstört');
  const g3 = newGame(55); const s3 = einziges(g3, 0); space.shipHit(g3, 0, 3, {}); g3.time += FENSTER + 0.01; space.shipHit(g3, 0, 0.5, { sperrfeuer: true, sturm: true });
  ok(g3.ship.systems[s3] === 'broken', 'ein Standard-Treffer stempelt nur das kurze Fenster: Sturm-Treffer nach ' + FENSTER + ' s zerstört');
  // Sturm gegen vollen Schild: kein Systemschaden
  const g4 = newGame(56); g4.ship.shields.current = [6, 6, 6, 6]; const v4 = stand(g4);
  for (let i = 0; i < 30; i++) { space.shipHit(g4, 0, 0.5, { sperrfeuer: true, sturm: true }); g4.time += 0.1; }
  ok(geaendert(g4, v4).length === 0, 'Sturm gegen vollen Schild: kein Systemschaden');
  // eine Quelle: der Wert steht in der Config (tune-bar), die Fensterfunktion liest ihn je Treffer-Art
  ok(Integ.fensterDauer({ C: CONFIG }, 'sturm') === FENSTER_STURM && Integ.fensterDauer({ C: CONFIG }) === FENSTER && FENSTER_STURM > FENSTER, 'systemModell.sturm.trefferFenster_s (1,5) > trefferFenster_s (0,25), beide über Integ.fensterDauer');
  const f0 = SM.sturm.trefferFenster_s;
  try {
    SM.sturm.trefferFenster_s = 0;
    const g5 = newGame(57); const s5 = einziges(g5, 0); space.shipHit(g5, 0, 0.5, { sperrfeuer: true, sturm: true }); space.shipHit(g5, 0, 0.5, { sperrfeuer: true, sturm: true });
    ok(g5.ship.systems[s5] === 'broken', 'tune systemModell.sturm.trefferFenster_s 0: zwei Nadeln im selben Tick zerstören');
  } finally { SM.sturm.trefferFenster_s = f0; }
});

// ---------------------------------------------------------------- Torpedo reaktorStufen
section('Torpedo: systemModell.torpedo.reaktorStufen (Ganzzahl) – 1 = zwei Torpedos zerstören den Reaktor, 2 = einer, 0 = kein Durchschlag', () => {
  const r0 = SM.torpedo.reaktorStufen;
  ok(r0 === 1 && SM.torpedo.reaktorAnteil === undefined, 'Startwert reaktorStufen 1, reaktorAnteil entfällt');
  try {
    for (const [stufen, soll] of [[0, 'ok'], [1, 'damaged'], [2, 'broken'], [5, 'broken']]) {
      SM.torpedo.reaktorStufen = stufen;
      const g = newGame(62 + stufen); space.etorpedoTreffer(g, { x: g.ship.x + 30, y: g.ship.y });
      ok(g.ship.systems.reactor === soll, `reaktorStufen ${stufen}: ein Torpedo -> Reaktor ${soll} (${g.ship.systems.reactor})`);
      if (soll === 'broken') ok(!!g.ship.reaktorCountdown, `reaktorStufen ${stufen}: Countdown läuft`);
    }
  } finally { SM.torpedo.reaktorStufen = r0; }
});

// ---------------------------------------------------------------- Robustheit: Stufe unabhängig von reparatur.damaged
section('Robustheit: tune systemModell.reparatur.damaged 0,6 / 0,7 / 0,9 – fünf Treffer auf ein System: ok -> beschädigt -> zerstört', () => {
  const d0 = SM.reparatur.damaged;
  try {
    for (const dm of [0.6, 0.7, 0.9]) {
      SM.reparatur.damaged = dm;
      const g = newGame(63); const s = einziges(g, 0); const folge = [];
      for (let i = 0; i < 5; i++) { weiter(g); space.shipHit(g, 0, 1, {}); folge.push(g.ship.systems[s]); }
      ok(folge.slice(0, 2).join() === 'damaged,broken' && folge.slice(2).every((x) => x === 'broken'), `reparatur.damaged ${dm}: Folge ${folge.join(' > ')}`);
      ok(pct(g, s) === 0, `reparatur.damaged ${dm}: zerstört = 0 %`);
      const g2 = newGame(64); const s2 = einziges(g2, 0); space.shipHit(g2, 0, 1, {});
      ok(g2.ship.systems[s2] === 'damaged' && pct(g2, s2) === Math.round(100 * dm), `reparatur.damaged ${dm}: beschädigt = ${Math.round(100 * dm)} % im Snapshot (${pct(g2, s2)})`);
      I.integKonsistent(g2, s2);
      ok(g2.ship.systems[s2] === 'damaged' && I.integOf(g2, s2) > 0 && I.integOf(g2, s2) < I.integMax(g2, s2), `reparatur.damaged ${dm}: integKonsistent lässt die Stufe beschädigt (i ${I.integOf(g2, s2)})`);
    }
  } finally { SM.reparatur.damaged = d0; }
  ok(SM.schwelle === undefined, 'systemModell.schwelle entfällt (die Stufe ist keine Schwelle mehr)');
});

// ---------------------------------------------------------------- Gezielter Treffer auf den Antrieb der Lerche
section('Gezielter Antrieb-Treffer eines Gegners auf die Lerche: zwei Stufen (sofort beschädigt, nach der Sperre zerstört); ungezielt eine Stufe', () => {
  const ZW = require('../content/kampf/zielsysteme-werte.json').werte; const SPERRE = ZW.treffer.wert.sperre_s;
  ok(ZW.systeme.wert.antrieb.gezielt === 'zerstoert', 'Datenfeld systeme.antrieb.gezielt = zerstoert (eine Quelle für Gegner und Lerche)');
  const sek = (g, s) => { for (let k = 0; k < Math.round(s / DT); k++) g.step(); };
  const sektor = I.systemSector('engines');
  const g = newGame(81); g.phase = 'play'; g.ship.systems.engines = 'ok'; I.integritaetVoll(g);
  space.shipHit(g, sektor, 3, { angriff: true, zielt: 'engines' });
  ok(g.ship.systems.engines === 'damaged', 'gezielter Treffer: der Antrieb ist sofort beschädigt');
  ok(I.repairSystem(g, 'engines', 'bot', 'minigame') === false && g.ship.systems.engines === 'damaged', 'bis zur zweiten Stufe wartet eine Reparatur (die vorgemerkte Zerstörung geht nicht verloren)');
  sek(g, SPERRE * 0.5);
  ok(g.ship.systems.engines === 'damaged', `nach ${(SPERRE * 0.5).toFixed(2)} s noch beschädigt`);
  sek(g, SPERRE * 0.5 + 0.2);
  ok(g.ship.systems.engines === 'broken' && pct(g, 'engines') === 0, `nach der Sperre (${SPERRE} s): zerstört`);
  const g2 = newGame(82); g2.phase = 'play'; g2.ship.systems.engines = 'ok'; I.integritaetVoll(g2);
  space.shipHit(g2, sektor, 3, {});
  const getroffen = I.SYSTEM_ORDER.filter((k) => g2.ship.systems[k] !== 'ok');
  sek(g2, SPERRE + 0.5);
  ok(getroffen.length === 1 && I.SYSTEM_ORDER.filter((k) => g2.ship.systems[k] !== 'ok').join() === getroffen.join() && g2.ship.systems[getroffen[0]] === 'damaged', 'ungezielter Treffer: genau eine Stufe, bleibt beschädigt');
  const g3 = newGame(83); g3.ship.systems.engines = 'damaged'; I.setInteg(g3, 'engines', I.integAusZustand(g3, 'engines', 'damaged'));
  space.shipHit(g3, sektor, 3, { angriff: true, zielt: 'engines' });
  ok(g3.ship.systems.engines === 'broken', 'gezielter Treffer auf einen schon beschädigten Antrieb: zerstört (eine Stufe, nichts weiter)');
});

// ---------------------------------------------------------------- Dauerdruck-Zähler (Zähler je Sektor, Verfall)
// Zone mit `schaden` Punkten je Sekunde auf der Lerche (Schild 0). druckSzene liefert Lauf, Stufenzähler und den Zonen-Schalter (schaden 0 = kein Druck).
function druckSzene(seed, schaden) {
  const SZENE = Locations.get('rabenpass').scene; const alt = { zonen: SZENE.zonen, station: SZENE.station, hafen: SZENE.hafen, kauft: SZENE.kauft };
  SZENE.zonen = [{ id: 'dd', form: 'kreis', x: 1500, y: 800, r: 40000, schaden, sicht: 1 }]; delete SZENE.station; delete SZENE.hafen; delete SZENE.kauft;
  const g = new Game({ noStore: true, worlds: false, seed, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { if (this.inbox.length < 200) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'D0', name: 'D0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' }); g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  space.enterScene(g, 'rabenpass', {}); g.space.enemies = []; g.space.projectiles = [];
  for (let k = 0; k < 10; k++) g.step();
  for (const k of I.SYSTEM_ORDER) g.ship.systems[k] = 'ok'; g.ship.fragile = {}; g.ship.trefferT = {}; I.integritaetVoll(g);
  g.ship.shields.current = [0, 0, 0, 0]; Schilde.pause.alleBis(g.ship.shields, 1e9); g.god = false; g.ship.x = 1700; g.ship.y = 800;
  const zone = SZENE.zonen[0];
  const verloren = () => I.SYSTEM_ORDER.reduce((a, k) => a + (g.ship.systems[k] === 'damaged' ? 1 : g.ship.systems[k] === 'broken' ? 2 : 0), 0);
  let schildHoch = 0;   // > 0: der Schild steht in jedem Tick auf diesem Wert (die Schildverteilung des Spiels deckelt ihn auf die Zuteilung); die Lerche zeigt mit dem Bug zur Zone (Sektor 0 hat Zuteilung, das Heck nicht)
  const lauf = (sek) => { for (let k = 0; k < Math.round(sek / DT); k++) { g.ship.x = 1700; g.ship.y = 800; g.ship.angle = Math.PI; if (schildHoch) g.ship.shields.current = [schildHoch, schildHoch, schildHoch, schildHoch]; g.step(); } };
  const zaehler = () => { const A = require('../server/sim/zonen.js').state(g).akk.sys || {}; return Object.values(A).reduce((a, z) => a + Integ.druckStand(g, z), 0); };
  const schild = (v) => { schildHoch = v; g.ship.shields.current = [v, v, v, v]; };
  return { g, zone, verloren, lauf, zaehler, schild, ende() { for (const k of Object.keys(alt)) { if (alt[k] === undefined) delete SZENE[k]; else SZENE[k] = alt[k]; } } };
}
section('Dauerdruck-Zähler: bleibt innerhalb der Frist, verfällt danach (auch bei Schild > 0 ohne Resttreffer); Stufentempo bei 1 Punkt/s ≈ druckPunkte s je Stufe', () => {
  const K = CONFIG.zonen.druckPunkte; const A = CONFIG.zonen.druckAbkling_s;
  ok(K === 6 && A === 3, `Startwerte zonen.druckPunkte ${K} (6), zonen.druckAbkling_s ${A} (3)`);
  let d = druckSzene(91, 1);
  try {
    d.lauf(K - 0.5); ok(d.verloren() === 0, `bei 1 Punkt/s nach ${K - 0.5} s: noch keine Stufe`);
    d.lauf(1); ok(d.verloren() === 1, `nach ${K + 0.5} s: die erste Stufe (≈ ${K} s je Stufe)`);
    d.lauf(K); ok(d.verloren() === 2, `nach ${2 * K + 0.5} s: die zweite Stufe`);
  } finally { d.ende(); }
  // innerhalb der Frist: 4 Punkte, 2 s Pause (< Frist), 2 Punkte -> die Stufe kommt (der Zähler blieb)
  d = druckSzene(92, 1);
  try {
    d.lauf(4.5); const n1 = d.zaehler(); d.zone.schaden = 0; d.lauf(A - 1); const n2 = d.zaehler(); d.zone.schaden = 1; d.lauf(2.7);
    ok(n1 >= 3 && n2 === n1, `Zähler nach 4 Punkten ${n1}, nach ${A - 1} s Pause unverändert (${n2})`);
    ok(d.verloren() === 1, 'Pause innerhalb der Frist: die Stufe kommt, sobald insgesamt ' + K + ' Punkte da sind');
  } finally { d.ende(); }
  // nach der Frist: 4 Punkte, Pause > Frist -> Zähler 0, dieselben 2 Punkte danach geben keine Stufe
  d = druckSzene(93, 1);
  try {
    d.lauf(4.5); d.zone.schaden = 0; d.lauf(A + 1.5); const n3 = d.zaehler(); d.zone.schaden = 1; d.lauf(2.7);
    ok(n3 === 0, `Zähler nach ${A + 1.5} s ohne Druck: 0 (${n3})`);
    ok(d.verloren() === 0, 'Pause länger als die Frist: der Zähler ist verfallen, 2 Punkte danach kosten keine Stufe');
    d.lauf(K); ok(d.verloren() >= 1, 'danach kostet erst der volle Zähler eine Stufe');
  } finally { d.ende(); }
  // Schild > 0 ohne Resttreffer: der Druck wirkt nicht auf die Systeme, die Frist läuft auch dann ab
  d = druckSzene(94, 1);
  try {
    d.lauf(4.5); d.schild(50); d.lauf(A + 1.5); const n4 = d.zaehler(); d.schild(0); d.lauf(2.7);
    ok(n4 === 0 && d.verloren() === 0, `Schild fängt den Druck ${A + 1.5} s lang (kein Resttreffer): Zähler verfällt (${n4}), danach keine Stufe`);
  } finally { d.ende(); }
  // eine Quelle: Lerche und Gegner/Verbündete benutzen denselben Helfer (integritaet.js), Config in zonen
  ok(typeof Integ.druckSammeln === 'function' && typeof Integ.druckStand === 'function', 'Zähler und Verfall im gemeinsamen Helfer integritaet.js (druckSammeln, druckStand)');
});

// ---------------------------------------------------------------- Quellen-Pfade Ende-zu-Ende (Projektil, telegraphierte Ladung, Asteroid): je eine Stufe
section('Projektil-Pfad: Gegner-Jäger schießt auf die Lerche (updateProjectiles) – Schild 0: der erste Treffer = genau eine Stufe, unabhängig von der Schadenszahl', () => {
  const d = druckSzene(95, 0);
  try {
    const g = d.g; g.ship.shields.current = [0, 0, 0, 0]; Schilde.pause.alleBis(g.ship.shields, 1e9); g.god = false; g.ship.x = 1500; g.ship.y = 800; g.ship.angle = 0;
    const e = space.spawnEnemy(g, 'raider', { x: 1500 + 300, y: 800, facing: Math.PI }); e.hitT = -99;
    g.space.enemies = [e];
    let t = 0; const lerche = () => I.SYSTEM_ORDER.reduce((a, k) => a + (g.ship.systems[k] === 'damaged' ? 1 : g.ship.systems[k] === 'broken' ? 2 : 0), 0);
    let schuss = false;
    while (t < 40 && lerche() === 0) { g.ship.x = 1500; g.ship.y = 800; g.ship.shields.current = [0, 0, 0, 0]; e.x = 1800; e.y = 800; g.step(); t += DT; if (g.space.projectiles.some((p) => p.kind === 'enemy')) schuss = true; }
    ok(schuss && lerche() === 1, `Jäger-Schuss (Projektil kind enemy, Schaden ${CONFIG.enemies.raider.damage}) -> updateProjectiles -> shipHit: nach ${t.toFixed(1)} s genau eine Stufe verloren (${lerche()})`);
    const verloren = I.SYSTEM_ORDER.filter((k) => g.ship.systems[k] !== 'ok');
    ok(verloren.length === 1 && g.ship.systems[verloren[0]] === 'damaged' && pctSnap(g, verloren[0]) === 50, `ein System beschädigt (${verloren.join()}), Snapshot ${pctSnap(g, verloren[0])} % sofort`);
  } finally { d.ende(); }
});
function pctSnap(g, k) { return g.snapshot().ship.integ[Protocol.SYSTEMS_INTEG.indexOf(k)]; }

section('Telegraphierte Ladung (schwerer Treffer) und Asteroid: je genau eine Stufe', () => {
  const d = druckSzene(96, 0);
  const Station = require('../server/sim/station.js'); const autoAlt = Station.waffenAutomatikAktiv;
  Station.waffenAutomatikAktiv = () => false;   // keine Auto-Waffen der Lerche: sonst schießt sie die Korvette an und die Ladung bricht ab
  try {
    const g = d.g; g.god = false; g.ship.shields.current = [0, 0, 0, 0]; Schilde.pause.alleBis(g.ship.shields, 1e9); g.ship.x = 1500; g.ship.y = 800; g.ship.angle = 0;
    const lerche = () => I.SYSTEM_ORDER.reduce((a, k) => a + (g.ship.systems[k] === 'damaged' ? 1 : g.ship.systems[k] === 'broken' ? 2 : 0), 0);
    // schwere Ladung einer Korvette: die Ladung läuft ab (e.tele), der Strahl trifft die Lerche mit tele.damage (heavy) – eine Stufe
    const e = space.spawnEnemy(g, 'korvette', { x: 1500 + 250, y: 800, facing: Math.PI }); g.space.enemies = [e];
    e.tele = { kind: 'shot', left: 0.05, dur: 1, sector: 0, delayed: 0 }; e.fireT = 0;
    let t = 0; while (t < 5 && lerche() === 0) { g.ship.x = 1500; g.ship.y = 800; g.ship.shields.current = [0, 0, 0, 0]; e.x = 1750; e.y = 800; g.step(); t += DT; }
    ok((g.stats.heavyHits || 0) >= 1 && lerche() === 1, `Ladung ausgelöst (heavyHits ${g.stats.heavyHits}): genau eine Stufe (${lerche()}), nicht mehrere trotz hohem Schaden`);
    // Asteroid: die Lerche berührt einen Brocken
    const g2 = druckSzene(97, 0); try {
      const h = g2.g; h.god = false; h.ship.shields.current = [0, 0, 0, 0]; Schilde.pause.alleBis(h.ship.shields, 1e9); h.ship.x = 1500; h.ship.y = 800; h.space.enemies = [];
      h.space.asteroids = [{ id: 'ast_t', x: 1500 + 30, y: 800, r: 80 }];
      const l2 = () => I.SYSTEM_ORDER.reduce((a, k) => a + (h.ship.systems[k] === 'damaged' ? 1 : h.ship.systems[k] === 'broken' ? 2 : 0), 0);
      h.step(); h.step();
      ok(l2() === 1 && (h.stats.brocken || {}).lerche >= 1, `Asteroid-Berührung: genau eine Stufe (${l2()}), Brocken-Zähler ${(h.stats.brocken || {}).lerche}`);
      for (let k = 0; k < 10; k++) { h.ship.x = 1500; h.ship.y = 800; h.step(); }
      ok(l2() === 1, 'weitere Ticks im selben Brocken (Immunität asteroidImmunity): keine weitere Stufe');
    } finally { g2.ende(); }
  } finally { Station.waffenAutomatikAktiv = autoAlt; d.ende(); }
});

section('Konfiguration: keine Punktregel mehr im Lerche-Treffer-Kern', () => {
  ok(SM.schadenFaktor === undefined && CONFIG.alarm.mine.punkte === undefined, 'schadenFaktor und alarm.mine.punkte entfernt');
  ok(typeof SM.trefferFenster_s === 'number' && SM.trefferFenster_s === 0.25 && CONFIG.zonen.druckPunkte > 0, 'trefferFenster_s 0,25 und zonen.druckPunkte in der Config (tune-bar)');
  const fs = require('fs'); const path = require('path');
  const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', f), 'utf8');
  ok(!/schadenFaktor/.test(src('interior.js')) && !/schadenFaktor/.test(src('damage.js')) && !/schadenFaktor/.test(src('zonen.js')) && !/sturmSchaden/.test(src('damage.js')), 'kein schadenFaktor/sturmSchaden im Lerche-Pfad (interior, damage, zonen)');
  void Physics;
});

console.log('\n' + (fails ? `${fails} FEHLER von ${n}` : `${n}/${n} ok`) + ' (SYS-03 B1 Direkttreffer)');
process.exit(fails ? 1 : 0);
