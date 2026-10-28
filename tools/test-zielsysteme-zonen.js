'use strict';
// SYS-01 C1b-1 „Zielsysteme im Zonenmodell“: die neuen Regeln (Wahl statt Zufall in der Zone, Erreichbarkeit, Mitte nur bei leerer zugewandter Zone,
// Sperre und Immunität als Parameter, Tempo nur mit Wirkung, gleiche Regeln gegen die Lerche, Reaktor-Abbruch der Verfolgung).
// Die alten Regeln aus SUND-04a-1 A prüft tools/test-zielsysteme.js (umgestellt), hier steht nur, was neu ist.
//   node tools/test-zielsysteme-zonen.js
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Zs = require('../server/sim/zielsysteme.js');
const Gsys = require('../server/sim/gegnersystem.js');
const Verfolgung = require('../server/sim/verfolgung.js');
const interior = require('../server/sim/interior.js');
const Testhilfe = require('./gegner-testhilfe.js');
const DATEN = require('../content/kampf/zielsysteme-werte.json').werte;

const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const info = (t) => console.log('  info ' + t);
function section(name, body) {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}
const SPERRE = DATEN.treffer.wert.sperre_s, IMMUN = DATEN.treffer.wert.immunitaet_s;

function setup() {
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { if (this.inbox.length < 400) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'Z0', name: 'Zie0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' });
  g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  space.enterScene(g, 'rabenpass', {});
  g.space.enemies = []; g.space.projectiles = [];
  const T = { g, c };
  T.run = (sec, each) => { for (let k = 0; k < Math.round(sec / DT); k++) { if (each && each(k * DT) === true) return true; g.step(); } return false; };
  return T;
}
const platz = (g, x, y, ang) => { const s = g.ship; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; s.turnVel = 0; if (ang != null) s.angle = ang; };
const leer = (g, kind, x, y) => { const e = space.spawnEnemy(g, kind, { x, y, facing: 0, tag: 'zz' }); e.retreatUntil = 0; return e; };
// Lerche hinter dem Ziel (Heck = zugewandte Zone), vor dem Ziel (Bug = zugewandt)
function hinten(g, e) { const a = e.angle + Math.PI; platz(g, e.x + Math.cos(a) * 300, e.y + Math.sin(a) * 300, e.angle); }
function vorn(g, e) { platz(g, e.x + Math.cos(e.angle) * 300, e.y + Math.sin(e.angle) * 300, e.angle + Math.PI); }
const qx = (e, rel) => [e.x + Math.cos(e.angle + rel) * 60, e.y + Math.sin(e.angle + rel) * 60];
const HECK = Math.PI, BUG = 0;
// Treffer direkt auf das Gegner-Modell (Trefferweg wie in damageEnemy: Zone, gezielt, Schild schon durch), mit dem Systemziel der Ops
function trefferZone(g, e, zone, dmg, gez) { return Gsys.treffen(g, e, zone, dmg, gez); }
// Zustand setzen (Integrität je System, Zustand folgt den Schwellen)
const setze = (e, id, i) => { e.sys[id].i = i; e.sys[id].z = Gsys.hat(e) && i <= 0 ? 'broken' : (i < 0.6 * Gsys.maxOf(e, id) ? 'damaged' : 'ok'); e.hp = Gsys.summe(e); };

section('Wahl und Erreichbarkeit: Zone der zugewandten Seite (Heck) immer, Mitte nur bei leerer zugewandter Zone', () => {
  const T = setup(); const g = T.g;
  const e = leer(g, 'fregatte', 1500, 1100); e.angle = 0; e.scanned = true; g.ship.target = e.id;
  hinten(g, e);
  ok(Zs.waehle(g, 'antrieb') === null, 'Lerche hinten: Antrieb (Heck) wählbar');
  ok(Zs.waehle(g, 'waffe_bug') && /nicht erreichbar/.test(Zs.waehle(g, 'waffe_bug')), 'Lerche hinten: Waffe am Bug nicht erreichbar');
  ok(/nicht erreichbar/.test(Zs.waehle(g, 'reaktor') || '') && g.ship.zielsystem === 'antrieb', 'Lerche hinten, Heck offen: Reaktor (Mitte) nicht wählbar, Wahl bleibt');
  vorn(g, e);
  ok(Zs.waehle(g, 'waffe_bug') === null && g.ship.zielsystem === 'waffe_bug', 'Lerche vorn: Waffe am Bug wählbar');
  ok(/nicht erreichbar/.test(Zs.waehle(g, 'antrieb') || ''), 'Lerche vorn: Antrieb im Heck nicht wählbar');
  // Heck ausgeschaltet (leer): die Mitte wird erreichbar
  hinten(g, e);
  for (const id of Gsys.ids(e)) if (Gsys.defOf(e.kind, id).zone === 'heck') setze(e, id, 0);
  ok(Zs.waehle(g, 'reaktor') === null && g.ship.zielsystem === 'reaktor', 'Heck leer: die Mitte (Reaktor) ist wählbar');
  ok(Zs.waehlbar(g, e).includes('reaktor') && !Zs.waehlbar(g, e).includes('waffe_bug'), 'waehlbar(): Mitte, Bug nicht erreichbar');
});

section('Gezielter Treffer: Wahl statt Zufall in der Zone, nur wenn Zone und Erreichbarkeit stimmen', () => {
  const T = setup(); const g = T.g;
  const e = leer(g, 'fregatte', 1500, 1100); e.angle = 0;   // Heck: Antrieb und Emitter (zwei Systeme)
  hinten(g, e);
  const gez = { id: 'antrieb', zugewandt: 'heck' };
  let trefferAntrieb = 0; const mal = 60;
  for (let i = 0; i < mal; i++) { Testhilfe.setzeGesamt(e, e.hpMax); const t = trefferZone(g, e, 'heck', 1, gez); if (t.id === 'antrieb' && t.gezielt) trefferAntrieb++; }
  ok(trefferAntrieb === mal, `gezielt: alle ${mal} Heck-Treffer mit Systemziel Antrieb treffen den Antrieb (${trefferAntrieb}/${mal})`);
  const ohne = []; for (let i = 0; i < mal; i++) { Testhilfe.setzeGesamt(e, e.hpMax); ohne.push(trefferZone(g, e, 'heck', 1, null).id); }
  ok(ohne.includes('emitter_heck') && ohne.includes('antrieb'), 'ohne Systemziel: der Zufall wählt in der Zone beide Heck-Systeme');
  Testhilfe.setzeGesamt(e, e.hpMax);
  const falschZone = trefferZone(g, e, 'bug', 1, gez);
  ok(!falschZone.gezielt && Gsys.defOf(e.kind, falschZone.id).zone === 'bug', 'Treffer in einer anderen Zone (Bug): der Zufall in dieser Zone, nicht der Antrieb');
  Testhilfe.setzeGesamt(e, e.hpMax);
  vorn(g, e);
  const nichtErr = trefferZone(g, e, 'heck', 1, { id: 'antrieb', zugewandt: 'bug' });
  ok(!nichtErr.gezielt, 'Antrieb im Heck, zugewandte Zone Bug: nicht erreichbar, der Treffer wirkt nicht gezielt (Zufall in der Zone)');
  // das Ziel ist zerstört: der Zufall in der Zone
  setze(e, 'antrieb', 0);
  const zerst = trefferZone(g, e, 'heck', 1, { id: 'antrieb', zugewandt: 'heck' });
  ok(zerst.id !== 'antrieb' && !zerst.gezielt, 'zerstörtes Ziel: der Treffer fällt auf den Zufall in der Zone zurück');
});

section('Zufall wählt nur nicht zerstörte Systeme, bevor die Zone leer ist (Abnahme 3)', () => {
  const T = setup(); const g = T.g;
  const e = leer(g, 'fregatte', 1500, 1100); e.angle = 0;
  setze(e, 'emitter_heck', 0);   // ein Heck-System ist zerstört, das andere lebt
  let kaputt = 0;
  for (let i = 0; i < 80; i++) { Testhilfe.setzeGesamt(e, e.hpMax); setze(e, 'emitter_heck', 0); const t = trefferZone(g, e, 'heck', 1, null); if (t.id === 'emitter_heck') kaputt++; }
  ok(kaputt === 0, `80 Heck-Treffer ohne Systemziel: kein Treffer auf das zerstörte System (${kaputt})`);
  // Zone leer (alle Heck-Systeme zerstört): der Überlauf in die Mitte
  setze(e, 'antrieb', 0);
  const u = trefferZone(g, e, 'heck', 1, null);
  ok(u && Gsys.defOf(e.kind, u.id).zone === 'mitte', 'Heck leer: der Treffer geht in die Mitte');
});

section('Sperre: nur Systeme mit Regel (Antrieb) holen den Zustand verzögert nach', () => {
  const T = setup(); const g = T.g;
  const e = leer(g, 'korvette', 1500, 1100); e.angle = 0;
  hinten(g, e); e.scanned = true; g.ship.target = e.id; Zs.waehle(g, 'antrieb');
  const gez = { id: 'antrieb', zugewandt: 'heck' };
  trefferZone(g, e, 'heck', Gsys.maxOf(e, 'antrieb') * 0.45, gez);
  ok(e.sys.antrieb.z === 'damaged', 'erster Treffer: beschädigt');
  trefferZone(g, e, 'heck', Gsys.maxOf(e, 'antrieb'), gez);
  ok(e.sys.antrieb.z === 'damaged' && e.sys.antrieb.i <= 0, 'zweiter Treffer in der Sperre: Integrität 0, der Zustand hält (Sperre)');
  T.run(SPERRE + DT);
  ok(e.sys.antrieb.z === 'broken', 'nach der Sperre: der Zustand holt nach (ausgefallen)');
  // ein System ohne Regel (Waffe am Bug) wechselt sofort
  const w = leer(g, 'korvette', 1700, 1300); w.angle = 0;
  trefferZone(g, w, 'bug', Gsys.maxOf(w, 'waffe_bug') * 2, null);
  ok(w.sys.waffe_bug.z === 'broken', 'System ohne Sperre (Waffe): sofort zerstört in einem Treffer');
});

section('Immunität nach einer Reparatur (C2-Hook): ein Treffer verschlechtert den Zustand nicht', () => {
  const T = setup(); const g = T.g;
  const e = leer(g, 'korvette', 1500, 1100); e.angle = 0;
  Zs.halte(e);   // SYS-01 C2a: ohne Reparatur des Gegners, damit nur die Immunität geprüft wird
  setze(e, 'antrieb', Gsys.maxOf(e, 'antrieb') * 0.3);   // beschädigt
  Gsys.reparaturFertig(g, e, 'antrieb');
  ok(e.sys.antrieb.imm > g.time, 'reparaturFertig setzt die Immunität (Dauer aus den Daten)');
  trefferZone(g, e, 'heck', Gsys.maxOf(e, 'antrieb'), null);
  ok(e.sys.antrieb.z === 'damaged', 'in der Immunität: der Treffer macht den Antrieb nicht ausgefallen');
  T.run(IMMUN + 0.2);
  ok(e.sys.antrieb.z === 'broken', 'Immunität abgelaufen: der Zustand holt nach (Integrität 0, ausgefallen)');
});

section('Tempo: Faktoren aus den Daten, ohne Schalter (SYS-01 C2a: e.tempoAn entfällt)', () => {
  const T = setup(); const g = T.g;
  const e = leer(g, 'korvette', 1500, 1100); e.angle = 0;
  setze(e, 'antrieb', 0);
  ok(Zs.tempoFaktor(e) === DATEN.systeme.wert.antrieb.stufen[2].faktor, 'ausgefallener Antrieb ohne Schalter und ohne gezielten Treffer: Faktor 0 (aus den Daten, wie bei der Lerche)');
  setze(e, 'antrieb', Gsys.maxOf(e, 'antrieb') * 0.3);
  ok(Zs.tempoFaktor(e) === DATEN.systeme.wert.antrieb.stufen[1].faktor, 'beschädigt = Faktor 0,5');
  ok(Zs.snapExtra(e) === null, 'Snapshot ungescannt: keine Felder');
  e.scanned = true;
  ok(Zs.snapExtra(e).az === 1, 'Snapshot am gescannten Ziel: az = 1 (beschädigt), abgeleitet aus e.sys');
  // Schalter an: jeder Treffer macht das Ziel wirksam
  const f = leer(g, 'korvette', 1700, 1300); f.angle = 0;
  Zs.szeneAn(g, true);
  trefferZone(g, f, 'heck', 1, null);
  space.damageEnemy(g, f, 1, f.x + Math.cos(f.angle + HECK) * 60, f.y + Math.sin(f.angle + HECK) * 60, { angriff: true });
  ok(!('tempoAn' in f), 'Schalter an: e.tempoAn entfällt (C2a), der Schalter schaltet keine Tempo-Wirkung mehr frei');
  Zs.szeneAn(g, false);
});

section('Gleiche Regeln gegen die Lerche: Zielsystem der Gegner, Zone, Mitte nur bei leerer Zone', () => {
  const T = setup(); const g = T.g; const ship = g.ship;
  g.rng.chance = () => false; Zs.szeneAn(g, true);
  ship.shields.current = [0, 0, 0, 0];
  interior.integritaetVoll(g);
  // gezielt auf das Triebwerk (Heck, Sektor 2): engines sicher getroffen
  const i0 = ship.integ.engines;
  space.shipHit(g, 2, 4, { angriff: true, zielt: 'engines' });
  ok(ship.integ.engines === i0 - 4 * (CONFIG.systemModell.schadenFaktor || 1), 'Gegner mit Systemziel Triebwerk, Heck, Schild 0: das Triebwerk verliert den Schaden sicher');
  // gezielt auf ein Lerchensystem in einer anderen Zone (Bug): wirkt nicht gezielt, der Zufall in der Zone (Bug) bestimmt
  const z0 = g.stats.zielsysteme.lerche;
  interior.integritaetVoll(g); ship.shields.current = [0, 0, 0, 0];
  space.shipHit(g, 2, 2, { angriff: true, zielt: 'battery_port' });
  ok(g.stats.zielsysteme.lerche === z0, 'Ziel in einer anderen Zone (Batterie Backbord, Sektor 3) trifft das Heck: kein gezielter Treffer');
  // Mitte (Reaktor) nur, wenn die zugewandte Zone leer ist: Heck (zugewandt) hat den Antrieb noch
  interior.integritaetVoll(g); ship.shields.current = [0, 0, 0, 0];
  space.shipHit(g, 2, 2, { angriff: true, zielt: 'reactor', durchschlag: 'zone' });
  ok(g.stats.zielsysteme.lerche === z0, 'Reaktor in der Mitte bei lebendem Heck: nicht erreichbar, kein gezielter Treffer');
  // Heck leer (Triebwerk, Düse, Lafette Heck zerstört): die Mitte wird erreichbar
  interior.integritaetVoll(g);
  for (const k of ['engines', 'emitter_aft', 'lafette_2']) { ship.integ[k] = 0; if (ship.systems) ship.systems[k] = 'broken'; }
  ship.shields.current = [0, 0, 0, 0];
  const ri = ship.integ.reactor;
  space.shipHit(g, 2, 2, { angriff: true, zielt: 'reactor', durchschlag: 'zone' });
  ok(ship.integ.reactor < ri && g.stats.zielsysteme.lerche === z0 + 1, 'Reaktor in der Mitte, zugewandte Zone leer: gezielt getroffen');
  g.rng.chance = Math.random.bind(Math);
  Zs.szeneAn(g, false);
});

section('Verfolgung: der zerstörte Reaktor bricht die Sprungladung ab, der Ausgang kommt erst mit dem Countdown', () => {
  const T = setup(); const g = T.g;
  Verfolgung.starten(g, { klasse: 'korvette', wiederholung: false });
  const e = Verfolgung.ziel(g);
  const fp = g.space.verfolgung.fluchtpunkt;
  Zs.halte(e);   // SYS-01 C2a: ohne Reparatur des Zielschiffs, sonst repariert es den Reaktor, bevor der Countdown abläuft
  e.x = fp.x - 40; e.y = fp.y; e.angle = 0;
  platz(g, 600, 1100, 0); T.run(0.3);
  ok(e.sprung != null, 'Vorbedingung: die Sprungladung läuft');
  Testhilfe.schildNull(e); Testhilfe.mitteNurReaktor(e);
  const r = Gsys.idVon(e, 'reaktor'); e.sys[r].i = 0.01; e.sys[r].z = 'damaged';
  space.damageEnemy(g, e, 1e6, e.x - 100, e.y, { durchschlag: 'zone', angriff: true });
  T.run(0.2);
  ok(e.sys[r].z === 'broken' && e.rt && e.rt.rest != null, 'Reaktor zerstört: der Countdown läuft');
  ok(e.sprung === null && Verfolgung.ausgang(g) === null, 'die Sprungladung bricht ab; der Ausgang ist noch offen (Countdown läuft)');
  T.run(3);
  ok(e.sprung === null && Verfolgung.ausgang(g) === null && g.space.enemies.includes(e), 'mit dem Countdown läuft kein neuer Ladeversuch (Reaktor zerstört)');
  T.run(e.rt.rest + 0.5);
  ok(!g.space.enemies.includes(e) && Verfolgung.ausgang(g) === 'zerstoert', 'nach dem Countdown: der Gegner stirbt, der Ausgang ist zerstoert');
});

console.log(`\ntest-zielsysteme-zonen: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
