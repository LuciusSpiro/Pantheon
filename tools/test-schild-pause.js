'use strict';
// SYS-03 C1: Regenerationspause des Lerche-Schilds je Sektor (Helfer Schilde.pause, shared/schilde.js).
// Regel: Ein Sektor regeneriert erst, wenn auf DIESEN Sektor shields.regenDelay s lang kein Treffer ankam (jeder Treffer zählt, auch bei Schild 0 und am Schild vorbei),
// danach 1 Punkt je shields.regenInterval s (Timer je Sektor). Sturm-Treffer sperren zusätzlich systemModell.sturm.regenSperre_s (es gilt das Längere).
// Abnahme 5: Streufeuer (gleiche Trefferrate reihum auf drei Sektoren) bricht den ersten Sektor deutlich später als konzentriertes Feuer.
//   node tools/test-schild-pause.js   (npm run test:schild-pause)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const Katalog = require('../shared/schiffskatalog.js');
const Schilde = require('../shared/schilde.js');
const Locations = require('../shared/locations.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Dmg = require('../server/sim/damage.js');
const Alarm = require('../server/sim/alarm.js');
const Combat = require('../server/sim/combat.js');
const Arena = require('../server/sim/arena.js');
const Wellen = require('../server/sim/wellen.js');
const Reset = require('../server/sim/szenenreset.js');
const I = require('../server/sim/interior.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const info = (t) => console.log('  info ' + t);
function section(title, fn) { console.log('\n[' + title + ']'); try { fn(); } catch (e) { fails++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); } }
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-schild-pause-'));
const SH = CONFIG.shields;
const DELAY = SH.regenDelay, INT = SH.regenInterval;

function arena(seed, alloc) {
  const g = new Game({ noStore: true, worlds: false, seed: seed || 1, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie' + (seed || 1)) }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'P0', name: 'P0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' }); g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.god = false;
  const sh = g.ship; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; sh.vx = sh.vy = 0;
  g.space.enemies = []; g.space.projectiles = [];
  for (let i = 0; i < 10; i++) g.step();   // Pool wird erst nach einigen Ticks auf Energie 2 × pointsPerPower gesetzt
  if (alloc) { sh.shields.allocIntent = alloc.slice(); sh.shields.alloc = alloc.slice(); g.step(); }
  return g;
}
const lauf = (g, sek, cb) => { const t1 = g.time + sek - 1e-9; while (g.time < t1) { const sh = g.ship; sh.vx = sh.vy = 0; sh.x = g.space.w / 2; sh.y = g.space.h / 2; sh.angle = 0; g.step(); if (cb) cb(); } };
const cur = (g, i) => g.ship.shields.current[i];
const bis = (g, i) => Schilde.pause.bis(g.ship.shields, i);
const frisch = (g, current) => { Schilde.pause.loeschen(g.ship.shields); g.ship.shields.current = current.slice(); g.ship.shields.regenT = [0, 0, 0, 0]; };
const getune = (pfad, wert) => { const r = Combat.tune(game0, pfad, String(wert)); if (!r.ok) throw new Error('tune ' + pfad + ': ' + r.text); };
let game0 = null;

section('Konfiguration: eine Quelle je Wert', () => {
  ok(SH.regenDelay === 5 && SH.regenInterval === 2, `shields.regenDelay ${SH.regenDelay} s, regenInterval ${SH.regenInterval} s (Startwerte)`);
  ok(CONFIG.systemModell.sturm.regenSperre_s === 6, `systemModell.sturm.regenSperre_s ${CONFIG.systemModell.sturm.regenSperre_s} s (Startwert)`);
  ok(Katalog.waffe('sturmbatterie').sturm.regenSperre === undefined, 'regenSperre steht nicht mehr im Katalog (sturmbatterie.sturm)');
  ok(typeof Schilde.pause.treffer === 'function' && typeof Schilde.pause.trefferSturm === 'function' && typeof Schilde.pause.darfRegenerieren === 'function', 'Helfer Schilde.pause: treffer, trefferSturm, darfRegenerieren');
});

section('Helfer: Pause je Index (Sektor oder Segment), nicht aufzählbar, Seiten als Liste', () => {
  const k = { shields: [1, 1, 1, 1] }; const C = { shields: { regenDelay: 5 }, systemModell: { sturm: { regenSperre_s: 6 } } };
  Schilde.pause.treffer(k, 2, 10, C);
  ok(!Schilde.pause.darfRegenerieren(k, 2, 14.9) && Schilde.pause.darfRegenerieren(k, 2, 15) && Schilde.pause.darfRegenerieren(k, 0, 10), 'Treffer auf Index 2 bei t=10: Pause bis 15, Index 0 unberührt');
  Schilde.pause.trefferSturm(k, [0, 1], 10, C);
  ok(Schilde.pause.bis(k, 0) === 16 && Schilde.pause.bis(k, 1) === 16 && Schilde.pause.bis(k, 2) === 15, 'Sturm-Treffer auf eine Liste (Seite): Pause bis 16 für alle Indizes der Liste');
  Schilde.pause.treffer(k, 0, 11, C);
  ok(Schilde.pause.bis(k, 0) === 16, 'ein späterer normaler Treffer verkürzt eine laufende Sturm-Sperre nie');
  ok(JSON.stringify(k) === '{"shields":[1,1,1,1]}' && Object.keys(k).join() === 'shields', 'Zustand am Körper nicht aufzählbar (weder Snapshot noch Weltstand)');
  const C2 = { shields: { regenDelay: 8 }, systemModell: { sturm: { regenSperre_s: 6 } } }; const k2 = {};
  Schilde.pause.trefferSturm(k2, 0, 0, C2);
  ok(Schilde.pause.bis(k2, 0) === 8, 'Sturm-Sperre kürzer als die normale Pause: es gilt das Längere (8)');
  Schilde.pause.loeschen(k); ok(Schilde.pause.darfRegenerieren(k, 2, 0), 'loeschen entfernt alle Pausen');
});

section('Pause je Sektor: kein Regenerieren innerhalb regenDelay, danach im Takt regenInterval, Sektoren unabhängig', () => {
  const g = arena(3, [4, 2, 0, 2]);
  frisch(g, [3, 1, 0, 2]);
  const t0 = g.time;
  space.shipHit(g, 0, 1, {});   // Sektor 0: 3 -> 2
  ok(cur(g, 0) === 2 && cur(g, 1) === 1, `Treffer auf Sektor 0: Schild ${cur(g, 0)}, Sektor 1 steht bei ${cur(g, 1)}`);
  const verlauf0 = [], verlauf1 = [];
  lauf(g, DELAY - 0.2, () => { if (cur(g, 0) !== 2) verlauf0.push(+(g.time - t0).toFixed(2)); if (cur(g, 1) === 2 && !verlauf1.length) verlauf1.push(+(g.time - t0).toFixed(2)); });
  ok(cur(g, 0) === 2 && !verlauf0.length, `Sektor 0 regeneriert innerhalb von ${DELAY} s nach dem Treffer nicht (${cur(g, 0)})`);
  ok(cur(g, 1) === 2 && verlauf1.length === 1 && verlauf1[0] <= INT + 0.2, `Sektor 1 (kein Treffer) regeneriert unabhängig: voll nach ${verlauf1[0]} s (Takt ${INT} s)`);
  lauf(g, INT * 0.8 + 0.2);   // t = DELAY + 0.8 × Intervall: Timer läuft erst ab Pausenende
  ok(cur(g, 0) === 2, `kurz nach dem Pausenende (${(g.time - t0).toFixed(1)} s) noch kein Punkt: der Takt beginnt erst mit dem Pausenende`);
  const takte = []; let vor = cur(g, 0);
  lauf(g, 2 * INT + 0.3, () => { if (cur(g, 0) !== vor) { takte.push(+(g.time - t0).toFixed(2)); vor = cur(g, 0); } });
  ok(cur(g, 0) === 4 && takte.length === 2 && Math.abs(takte[1] - takte[0] - INT) < 0.15 && takte[0] >= DELAY + INT - 0.1, `danach je ${INT} s ein Punkt: Sektor 0 2 -> 4 bei ${takte.join(' s, ')} s (frühestens ${DELAY + INT} s)`);
});

section('Jeder Treffer stempelt DEN Sektor: Schild 0, Durchschlag, Sturm, Streu, Torpedo, Mine, Dauerdruck', () => {
  const quellen = {
    'Schild 0 (Treffer geht ins System)': { sek: 0, strom: [0, 2, 0, 2], treffer: (g) => space.shipHit(g, 0, 1, {}) },
    'Durchschlag pierce (Schild > 0)': { sek: 0, strom: [4, 2, 0, 2], treffer: (g) => space.shipHit(g, 0, 1, { pierce: true }) },
    'Durchschlag zone (Lanze, Vollladung)': { sek: 0, strom: [4, 2, 0, 2], treffer: (g) => space.shipHit(g, 0, 3, { durchschlag: 'zone' }) },
    'Sturm gegen vollen Schild': { sek: 0, strom: [4, 2, 0, 2], treffer: (g) => space.shipHit(g, 0, 0.15, { sperrfeuer: true, sturm: true }) },
    'Streu-Granate': { sek: 0, strom: [4, 2, 0, 2], treffer: (g) => space.shipHit(g, 0, 1, { streu: { schildFaktor: 1 } }) },
    'Torpedo bei Schild 0': { sek: 0, strom: [0, 2, 0, 2], treffer: (g) => space.shipHit(g, 0, 1, { pierce: true, heavy: true, torpedo: true }) },
    'Torpedo prallt am stehenden Schild ab': { sek: -1, strom: [4, 4, 0, 4], treffer: (g) => { g.ship.lastDodgeT = -99; space.etorpedoTreffer(g, { x: g.ship.x + 30, y: g.ship.y }); } },
    'Mine (am Schild vorbei)': { sek: -1, strom: [4, 4, 0, 4], treffer: (g) => { const m = { id: 9001, x: g.ship.x + 40, y: g.ship.y, besitzer: 'gegner' }; g.space.minen = [m]; Alarm.explodiere(g, m, 'test'); } },
    'direktTreffer (Mine, Schild unbeteiligt)': { sek: 2, strom: [4, 4, 4, 4], treffer: (g) => Dmg.direktTreffer(g, 2, { mine: true }) },
  };
  for (const [name, q] of Object.entries(quellen)) {
    const g = arena(7, [4, 2, 0, 2]); g.god = false;
    frisch(g, q.strom); g.ship.shields.alloc = [4, 4, 4, 4]; g.ship.shields.allocIntent = [4, 4, 4, 4];   // Platz zum Regenerieren in jedem Sektor (Pool wird unten nicht erzwungen)
    const t0 = g.time; q.treffer(g);
    const gestempelt = [0, 1, 2, 3].filter((i) => bis(g, i) > t0);
    const sek = q.sek >= 0 ? q.sek : gestempelt[0];
    ok(gestempelt.length === 1 && gestempelt[0] === sek && bis(g, sek) >= t0 + DELAY - 1e-9, `${name}: Pause bis ${(bis(g, sek) - t0).toFixed(1)} s nach dem Treffer, nur Sektor ${gestempelt.join(',') || '–'} gestempelt`);
  }
  // Dauerdruck der Zone (zonen.druck über die Szene), auch bei Schild 0
  const SZENE = Locations.get('rabenpass').scene; const alt = { zonen: SZENE.zonen, station: SZENE.station, hafen: SZENE.hafen, kauft: SZENE.kauft };
  try {
    SZENE.zonen = [{ id: 'dd', form: 'kreis', x: 1500, y: 800, r: 40000, schaden: 3, sicht: 1 }]; delete SZENE.station; delete SZENE.hafen; delete SZENE.kauft;
    for (const [name, strom] of [['Dauerdruck bei Schild > 0', [4, 4, 4, 4]], ['Dauerdruck bei Schild 0', [0, 0, 0, 0]]]) {
      const g = new Game({ noStore: true, worlds: false, seed: 81, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
      const c = { inbox: [], send(m) { if (this.inbox.length < 50) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
      g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'D0', name: 'D0', color: 0 });
      g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' }); g.handleMessage(c, { t: 'ready', ready: true });
      if (g.arena) g.arena.nextAt = null;
      space.enterScene(g, 'rabenpass', {}); g.space.enemies = []; g.space.projectiles = [];
      for (let k = 0; k < 10; k++) g.step();
      for (const k of I.SYSTEM_ORDER) g.ship.systems[k] = 'ok'; I.integritaetVoll(g); g.god = false;
      g.ship.shields.alloc = [4, 4, 4, 4]; g.ship.shields.allocIntent = [4, 4, 4, 4]; frisch(g, strom);
      const t0 = g.time; let t1 = null;
      for (let k = 0; k < 90 && t1 == null; k++) { g.ship.x = 1700; g.ship.y = 800; g.step(); if ([0, 1, 2, 3].some((i) => bis(g, i) > t0)) t1 = g.time; }
      const sek = [0, 1, 2, 3].filter((i) => bis(g, i) > t0);
      ok(t1 != null && sek.length >= 1 && sek.every((i) => bis(g, i) >= t1 + DELAY - 1e-6 - 0.05), `${name}: der Zonendruck stempelt Sektor ${sek.join(',')} (Pause bis ${sek.length ? (bis(g, sek[0]) - t0).toFixed(1) : '–'} s)`);
    }
  } finally { for (const k of Object.keys(alt)) { if (alt[k] === undefined) delete SZENE[k]; else SZENE[k] = alt[k]; } }
});

section('Pause wirkt wirklich: Schild 0 und Durchschlag halten die Regeneration an', () => {
  const g = arena(5, [4, 2, 0, 2]);
  frisch(g, [0, 2, 0, 2]); space.shipHit(g, 0, 1, {});
  lauf(g, DELAY - 0.3);
  ok(cur(g, 0) === 0, `Treffer auf Schild 0: nach ${(DELAY - 0.3).toFixed(1)} s noch 0 (kein Regenerieren trotz fehlendem Schild)`);
  lauf(g, INT + 1);
  ok(cur(g, 0) >= 1, `nach Pause und Intervall wieder ${cur(g, 0)}`);
  const h = arena(6, [4, 2, 0, 2]);
  frisch(h, [2, 2, 0, 2]); space.shipHit(h, 0, 1, { pierce: true });   // Durchschlag: Schild unberührt
  ok(cur(h, 0) === 2, 'Durchschlag lässt den Schild unberührt');
  lauf(h, DELAY - 0.3);
  ok(cur(h, 0) === 2, 'Durchschlag stempelt trotzdem: Sektor 0 regeneriert nicht auf 4');
});

section('tune: shields.regenDelay und systemModell.sturm.regenSperre_s wirken', () => {
  const g = arena(9, [4, 2, 0, 2]); game0 = g;
  const d0 = SH.regenDelay, s0 = CONFIG.systemModell.sturm.regenSperre_s;
  try {
    getune('shields.regenDelay', 1);
    frisch(g, [3, 2, 0, 2]); const t0 = g.time; space.shipHit(g, 0, 1, {});
    ok(near(bis(g, 0) - t0, 1), `tune shields.regenDelay 1: Pause bis ${(bis(g, 0) - t0).toFixed(2)} s`);
    lauf(g, 1 + INT + 0.4);
    ok(cur(g, 0) === 3, `mit Pause 1 s regeneriert Sektor 0 nach ${(g.time - t0).toFixed(1)} s wieder (${cur(g, 0)})`);
    getune('shields.regenDelay', 12);
    frisch(g, [3, 2, 0, 2]); const t1 = g.time; space.shipHit(g, 0, 1, {});
    lauf(g, 10);
    ok(cur(g, 0) === 2 && near(bis(g, 0) - t1, 12), `tune shields.regenDelay 12: nach 10 s noch keine Regeneration (${cur(g, 0)})`);
    getune('shields.regenDelay', d0);
    getune('systemModell.sturm.regenSperre_s', 15);
    frisch(g, [4, 4, 0, 2]); g.ship.shields.alloc = [4, 4, 0, 2]; const t2 = g.time; space.shipHit(g, 0, 0.15, { sperrfeuer: true, sturm: true });
    ok(near(bis(g, 0) - t2, 15), `tune systemModell.sturm.regenSperre_s 15: Sturm-Pause ${(bis(g, 0) - t2).toFixed(1)} s`);
    getune('systemModell.sturm.regenSperre_s', 1);
    frisch(g, [4, 4, 0, 2]); const t3 = g.time; space.shipHit(g, 0, 0.15, { sperrfeuer: true, sturm: true });
    ok(near(bis(g, 0) - t3, DELAY), `Sturm-Sperre 1 s < regenDelay ${DELAY} s: es gilt die normale Pause (${(bis(g, 0) - t3).toFixed(1)} s)`);
  } finally { getune('shields.regenDelay', d0); getune('systemModell.sturm.regenSperre_s', s0); }
  ok(SH.regenDelay === d0 && CONFIG.systemModell.sturm.regenSperre_s === s0, 'Werte zurückgestellt');
});
function near(a, b) { return Math.abs(a - b) < 1e-6; }

section('Sturm-Sperre je Sektor, länger als die normale Pause', () => {
  const SPERRE = CONFIG.systemModell.sturm.regenSperre_s;
  ok(SPERRE > DELAY, `Startwerte: regenSperre_s ${SPERRE} s > regenDelay ${DELAY} s`);
  const g = arena(11, [4, 4, 0, 0]);
  frisch(g, [3, 3, 0, 0]); const t0 = g.time;
  space.shipHit(g, 1, 1, {});   // Sektor 1: normaler Treffer (3 -> 2)
  space.shipHit(g, 0, 0.15, { sperrfeuer: true, sturm: true });   // Sektor 0: Sturm
  ok(near(bis(g, 0) - t0, SPERRE) && near(bis(g, 1) - t0, DELAY) && bis(g, 2) === 0, `Pause Sektor 0 (Sturm) ${SPERRE} s, Sektor 1 (normal) ${DELAY} s, Sektor 2 keine`);
  const v0 = cur(g, 0);
  const takt1 = []; let vor = cur(g, 1);
  lauf(g, DELAY + INT + 0.3, () => { if (cur(g, 1) !== vor) { takt1.push(+(g.time - t0).toFixed(2)); vor = cur(g, 1); } });
  ok(takt1.length === 1 && cur(g, 1) === 3 && cur(g, 0) <= v0 + 1e-9, `nach ${(g.time - t0).toFixed(1)} s: Sektor 1 (normal) regeneriert, Sektor 0 (Sturm) noch nicht (${cur(g, 0).toFixed(3)})`);
  lauf(g, SPERRE - DELAY + INT + 0.2);
  ok(cur(g, 0) > v0 + 0.5, `danach regeneriert auch Sektor 0 (${cur(g, 0).toFixed(2)})`);
});

section('Szenenwechsel, Wellenpause, Arena: voller Schild, Pause gelöscht', () => {
  const g = arena(13, [4, 2, 0, 2]); const sh = g.ship.shields;
  const stempeln = () => { sh.current = [1, 0, 0, 0]; Schilde.pause.alleBis(sh, g.time + 99); };
  const voll = () => sh.current.every((v, i) => v === sh.alloc[i]) && [0, 1, 2, 3].every((i) => Schilde.pause.darfRegenerieren(sh, i, g.time));
  stempeln(); Reset.zuruecksetzen(g, {});
  ok(voll(), `Szene von vorn: current = alloc (${sh.current.join('/')}), keine Pause`);
  stempeln(); Wellen.BUEHNEN.all.auffuellen(g);
  ok(voll(), `Wellenpause: current = alloc (${sh.current.join('/')}), keine Pause`);
  stempeln(); Arena.start(g, 'arena_space', null, null);
  ok(g.ship.shields === sh && voll(), `Arena-Start: current = alloc (${sh.current.join('/')}), keine Pause`);
});

section('Zerstörter Generator: Schild 0 (current = 0 bleibt); beschädigt: langsamerer Takt', () => {
  const g = arena(15, [4, 2, 0, 2]);
  g.ship.systems.shields = 'broken'; lauf(g, 1);
  ok(g.ship.shields.current.every((v) => v === 0), `Generator zerstört: current ${g.ship.shields.current.join('/')}`);
  lauf(g, DELAY + 2 * INT + 1);
  ok(g.ship.shields.current.every((v) => v === 0), 'Generator zerstört: auch nach Ablauf jeder Pause kein Schild');
  g.ship.systems.shields = 'damaged'; frisch(g, [0, 0, 0, 0]);
  const t0 = g.time; let erst = null;
  lauf(g, CONFIG.shieldsDamagedInterval + 2, () => { if (erst == null && g.ship.shields.current.some((v) => v > 0)) erst = g.time - t0; });
  ok(erst != null && erst >= CONFIG.shieldsDamagedInterval - 0.1, `Generator beschädigt: erster Punkt nach ${erst != null ? erst.toFixed(1) : '–'} s (Takt shieldsDamagedInterval ${CONFIG.shieldsDamagedInterval} s)`);
});

// ---------------------------------------------------------------- Abnahme 5: Streufeuer vs. konzentriertes Feuer
// Gleiche Gesamttrefferrate (Treffer/s, je 1 Schildpunkt), Start alloc [3,3,0,2] voll, Zeit ab dem ersten Treffer bis der erste Sektor 0 erreicht.
function bisBruch(rate, verteilung, maxSek) {
  const g = arena(21, [3, 3, 0, 2]); frisch(g, [3, 3, 0, 2]);
  const folge = verteilung === 'konzentriert' ? [0] : [0, 1, 3];
  const takt = 1 / rate; let t0 = g.time, nextHit = g.time, k = 0;
  while (g.time - t0 < maxSek) {
    if (g.time >= nextHit - 1e-9) {
      const sek = folge[k++ % folge.length];
      if (cur(g, sek) > 0 || true) { space.shipHit(g, sek, 1, {}); }
      nextHit += takt;
      if ([0, 1, 3].some((i) => cur(g, i) <= 1e-9 && g.ship.shields.alloc[i] > 0)) return g.time - t0;
    }
    lauf(g, 1 / CONFIG.tickHz);
  }
  return null;
}
section('Abnahme 5: Streufeuer bricht den ersten Sektor deutlich später als konzentriertes Feuer', () => {
  for (const rate of [2, 3, 4]) {
    const kz = bisBruch(rate, 'konzentriert', 60), st = bisBruch(rate, 'streu', 60);
    const q = kz != null && st != null ? st / Math.max(kz, 1 / CONFIG.tickHz) : (st == null ? Infinity : 0);
    info(`Rate ${rate}/s: konzentriert ${kz == null ? '–' : kz.toFixed(2)} s, streu ${st == null ? '> 60' : st.toFixed(2)} s, Quotient ${q === Infinity ? '∞' : q.toFixed(2)}`);
    ok(kz != null && q >= 2, `Rate ${rate}/s: Streufeuer ≥ 2× später (Quotient ${q === Infinity ? '∞' : q.toFixed(2)})`);
  }
  // Niedrige Rate: je Sektor kommt seltener ein Treffer als die Pause dauert, der Schild lädt zwischen den Treffern nach, Streufeuer bricht nie
  const kzL = bisBruch(0.3, 'konzentriert', 120), stL = bisBruch(0.3, 'streu', 120);
  ok(kzL != null && stL == null, `Rate 0,3/s: konzentriert bricht nach ${kzL == null ? '–' : kzL.toFixed(1)} s, Streufeuer bricht in 120 s nie (Pause ${DELAY} s, je Sektor ein Treffer alle ${(3 / 0.3).toFixed(0)} s)`);
});

console.log('\n' + (fails ? 'FEHLER: ' + fails + ' von ' + n : 'alle ' + n + ' Prüfungen grün') + ' (test-schild-pause)');
process.exit(fails ? 1 : 0);
