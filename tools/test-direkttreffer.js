'use strict';
// SYS-03 B1 „Direkttreffer auf die Lerche“: Ein Treffer ohne Schildschutz schaltet ein Lerche-System genau EINE Stufe weiter
// (ok -> beschädigt -> zerstört), unabhängig von der Schadenszahl. Treffer-Fenster (systemModell.trefferFenster_s), Torpedo unverändert,
// Schild über 0 fängt ab, Fragiles bricht, leere Zone läuft in die Mitte, Reaktor-Countdown nur einmal, Snapshot zeigt den Treffer sofort.
//   node tools/test-direkttreffer.js
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const Locations = require('../shared/locations.js');
const Physics = require('../shared/physics.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const I = require('../server/sim/interior.js');
const Alarm = require('../server/sim/alarm.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(title, fn) { console.log('\n[' + title + ']'); try { fn(); } catch (e) { fails++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); } }
const SM = CONFIG.systemModell;
const FENSTER = SM.trefferFenster_s;
const DT = 1 / CONFIG.tickHz;

function newGame(seed) {
  const g = new Game({ noStore: true, seed: seed || 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  g.space.enemies = []; g.space.projectiles = [];
  g.ship.fireList = []; g.ship.breachList = [];
  for (const k of I.SYSTEM_ORDER) g.ship.systems[k] = 'ok';
  g.ship.fragile = {}; g.ship.offline = {}; g.ship.trefferT = {};
  g.ship.shields.current = [0, 0, 0, 0]; g.ship.shields.regenHold = 0;
  g.ship.x = 1500; g.ship.y = 800; g.ship.angle = 0; g.ship.docked = false;
  g.god = false;
  I.integritaetVoll(g);
  return g;
}
const zone = (g, z) => I.SYSTEM_ORDER.filter((k) => I.systemSector(k) === z && I.systemAktiv(g, k));
const stand = (g) => { const o = {}; for (const k of I.SYSTEM_ORDER) o[k] = g.ship.systems[k]; return o; };
const geaendert = (g, vor) => I.SYSTEM_ORDER.filter((k) => g.ship.systems[k] !== vor[k]);
const weiter = (g) => { g.time += FENSTER + 0.01; };
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
  'Sturm bei Schild 0': { dmgs: [0.1, 50], treffer: (g, d) => space.shipHit(g, 0, d, { sperrfeuer: true, sturm: true }) },
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
      weiter(g); q.treffer(g, d);
      ok(g.ship.systems[s] === 'broken' && pct(g, s) === 0, `Schaden ${d}: zweiter Treffer beschädigt -> zerstört, Snapshot 0 %`);
      weiter(g); const v2 = stand(g); q.treffer(g, d);
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
    g.ship.shields.current = [0, 0, 0, 0]; g.ship.shields.regenHold = 1e9; g.god = false; g.ship.x = 1500 + 200; g.ship.y = 800;
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
