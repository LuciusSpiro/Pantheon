'use strict';
// SYS-01 C2a „Reparatur der Gegner“ (Konzept „Systemmodell Zonen“, „Gegner im neuen Modell“; Auftrag Paket C, Abnahme 11–13):
//   A  Zeiten: zerstört → beschädigt 10 s, beschädigt → ok 6 s (Daten: systemModell.gegner.reparatur); Wirkung = Grundwert der Stufe.
//   B  Vorgänge: ein Vorgang gleichzeitig, ein Werkstatt-Modul erlaubt einen zweiten, zerstörter Reaktor nur einen, zerstörte Werkstatt nur einen.
//   C  Reihenfolge: Reaktor, Schildgenerator, Antrieb, Waffe, Emitter, Module (Daten gegner-systeme.json reparatur.prioritaet).
//   D  Rückschlag: ein Systemtreffer in der Zone des Vorgangs halbiert den Fortschritt (systemModell.gegner.reparatur.rueckschlag).
//   E  Reaktor-Sonderreparatur: zerstört → beschädigt 12 s (= reaktorTod.sonderreparatur.zeiten[0]), Countdown endet, der Zähler bleibt, der nächste Ausfall 10 s.
//   F  Gestellt, Prise (nicht mehr in space.enemies) und Relais ohne Modell: keine Reparatur.
//   G  Zufall: die Reparatur benutzt game.rng nicht; zwei gleiche Läufe ergeben denselben Zustand.
//   H  Keine Skalierung mit der Crewgröße: Zeiten gleich bei 1 und 3 Spielern.
//   I  Antrieb ohne Schalter: beschädigt 0,5, zerstört 0 in jeder Szene (e.tempoAn entfällt).
//   J  Zerstörtes System ist nicht anwählbar (Wahl und Erreichbarkeit).
//   K  Schützlinge (Review H1): zerstörte Waffen laden keinen Angriff, beschädigte Waffe lädt ×1,5 langsamer.
//   L  Rückzug mit laufendem Countdown (Review M1): der Gegner zieht nicht ab, stirbt dort; nach einer Reparatur darf er abziehen.
//   M  Crew-Skalierung: gleiche Systeme und Zonen bei 1, 2, 3 Spielern; nur die Integrität skaliert (crewScaling.gegnerIntegritaet).
//   N  Entscheidungen der Nacharbeit: Reaktor-Schalter (Standard aus: Todesurteil; an: Sonderreparatur rettet), Klassen-Flag repariert, Schützling außerhalb der Erfassung (Nebel).
//   node tools/test-gegner-reparatur.js
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Gsys = require('../server/sim/gegnersystem.js');
const Gegnertod = require('../server/sim/gegnertod.js');
const Gegnerreparatur = require('../server/sim/gegnerreparatur.js');
const Zs = require('../server/sim/zielsysteme.js');
const Escort = require('../server/sim/escort.js');
const reaktortod = require('../server/sim/reaktortod.js');
const Testhilfe = require('./gegner-testhilfe.js');
const DATEN = require('../content/kampf/gegner-systeme.json');

const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const info = (t) => console.log('  info ' + t);
const section = (t, fn) => { console.log('\n[' + t + ']'); CONFIG.systemModell.gegner.reparatur.reaktor = false; try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); } };

// Testspiel wie in test-gegner-tod.js: Arena ohne Wellen, Lerche unverwundbar und ohne eigene Schüsse
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
  const noWeapons = () => { for (const k of ['bow', 'port', 'stbd']) if (g.ship.mount[k]) { g.ship.mount[k].charge = 0; g.ship.mount[k].salvo = 0; } };
  const run = (sec) => { for (let k = 0; k < Math.round(sec / DT); k++) { noWeapons(); g.step(); } };
  return { g, run };
}
// Gegner 250 px vor der Lerche, ruhend (facing überschreibbar)
function gegner(g, kind, o) {
  const sh = g.ship;
  const e = space.spawnEnemy(g, kind, Object.assign({ x: sh.x + 250, y: sh.y, facing: Math.PI }, o || {}));
  e.vx = 0; e.vy = 0;
  return e;
}
// Crewgröße: verbundene Spieler (space.crewScale zählt sie)
function setCrew(g, k) {
  while (g.players.length < k) g.players.push(Object.assign({}, g.players[0], { id: 'platz' + g.players.length, connected: true }));
  g.players.forEach((p, i) => { p.connected = i < k; });
}
const zust = (e, id) => e.sys[id].z;
const rp = (e, id) => e.sys[id].rp || 0;
const R = () => CONFIG.systemModell.gegner.reparatur;
const reaktorAn = () => { R().reaktor = true; };   // Schalter reaktor (Standard aus) für die Abschnitte der Sonderreparatur; die section-Hilfe setzt ihn je Abschnitt zurück

section('A Zeiten und Wirkung: zerstört → beschädigt 10 s, beschädigt → ok 6 s, Integrität auf den Grundwert', () => {
  ok(R().zerstoertZuBeschaedigt === 10 && R().beschaedigtZuOk === 6, 'Startwerte in shared/config.js: 10 s und 6 s');
  const { g, run } = arena(61);
  const e = gegner(g, 'korvette');
  const m = Gsys.maxOf(e, 'antrieb');
  Testhilfe.setzeIntegritaet(e, 'antrieb', 0);   // zerstört
  ok(zust(e, 'antrieb') === 'broken' && Gegnerreparatur.zeit(g, e, 'antrieb') === 10, 'zerstörter Antrieb: Vorgang mit 10 s');
  run(9.9);
  ok(zust(e, 'antrieb') === 'broken', 'nach 9,9 s noch zerstört');
  run(0.3);
  ok(zust(e, 'antrieb') === 'damaged' && Math.abs(e.sys.antrieb.i - m * CONFIG.systemModell.reparatur.damaged) < 1e-9, 'nach 10 s beschädigt, Integrität = 50 % des Maximums');
  ok(Math.abs(e.hp - Gsys.summe(e)) < 1e-9, 'e.hp bleibt die Summe der Integrität');
  run(5.6);
  ok(zust(e, 'antrieb') === 'damaged', 'nach weiteren 5,6 s (15,8 s gesamt) noch beschädigt');
  run(0.3);
  ok(zust(e, 'antrieb') === 'ok' && Math.abs(e.sys.antrieb.i - m) < 1e-9, 'nach 6 s ok, Integrität = Maximum');
  ok(Math.abs(e.hp - e.hpMax) < 1e-6, 'Gesamtintegrität wieder das Klassenbudget');
});

section('B Vorgänge: ein Vorgang gleichzeitig, Werkstatt erlaubt einen zweiten, zerstörter Reaktor nur einen', () => {
  reaktorAn();
  const { g } = arena(62);
  const f = gegner(g, 'fregatte');   // Werkstatt und Krankenstation an Bord
  ok(Gegnerreparatur.plaetze(g, f) === 2, 'Fregatte mit lebender Werkstatt: 2 Vorgänge');
  Testhilfe.setzeIntegritaet(f, 'modul_werkstatt', 0);
  ok(Gegnerreparatur.plaetze(g, f) === 1, 'Werkstatt zerstört: 1 Vorgang');
  Testhilfe.setzeIntegritaet(f, 'modul_werkstatt', Gsys.maxOf(f, 'modul_werkstatt'));
  Testhilfe.setzeIntegritaet(f, 'antrieb', 0); Testhilfe.setzeIntegritaet(f, 'waffe_bug', 0);
  ok(Gegnerreparatur.vorgaenge(g, f).length === 2, 'zwei defekte Systeme, Werkstatt lebt: zwei gleichzeitige Vorgänge');
  Testhilfe.setzeIntegritaet(f, 'reaktor', 0);   // Reaktor ohne Strom: die Werkstatt läuft nicht
  ok(Gegnerreparatur.plaetze(g, f) === 1 && Gegnerreparatur.vorgaenge(g, f)[0] === 'reaktor', 'zerstörter Reaktor: nur ein Vorgang, der Reaktor zuerst (Werkstatt ohne Strom)');
  const j = gegner(g, 'raider');   // Jäger: keine Werkstatt
  Testhilfe.setzeIntegritaet(j, 'antrieb', 0); Testhilfe.setzeIntegritaet(j, 'waffe_bug', 0);
  ok(Gegnerreparatur.plaetze(g, j) === 1 && Gegnerreparatur.vorgaenge(g, j).length === 1, 'Jäger ohne Werkstatt: ein Vorgang');
});

section('C Reihenfolge der Wahl: Reaktor, Schildgenerator, Antrieb, Waffe, Emitter, Module', () => {
  reaktorAn();
  const { g } = arena(63);
  const k = gegner(g, 'korvette');
  Testhilfe.setzeIntegritaet(k, 'modul_werkstatt', 0);   // nur ein Vorgang
  Testhilfe.setzeIntegritaet(k, 'emitter_bug', 0); Testhilfe.setzeIntegritaet(k, 'waffe_bug', 0); Testhilfe.setzeIntegritaet(k, 'antrieb', 0);
  ok(Gegnerreparatur.vorgaenge(g, k)[0] === 'antrieb', 'Antrieb vor Waffe und Emitter');
  Testhilfe.setzeIntegritaet(k, 'schildgenerator', 0.3 * Gsys.maxOf(k, 'schildgenerator'));
  ok(Gegnerreparatur.vorgaenge(g, k)[0] === 'schildgenerator', 'Schildgenerator (beschädigt) vor dem Antrieb');
  Testhilfe.setzeIntegritaet(k, 'reaktor', 0.3 * Gsys.maxOf(k, 'reaktor'));
  ok(Gegnerreparatur.vorgaenge(g, k)[0] === 'reaktor', 'Reaktor (beschädigt) vor dem Schildgenerator');
  ok(DATEN.reparatur.prioritaet.join() === 'reaktor,schildgenerator,antrieb,waffe,emitter,modul', 'Daten: Reihenfolge reaktor, schildgenerator, antrieb, waffe, emitter, modul');
});

section('D Rückschlag: ein Systemtreffer in der Zone des Vorgangs halbiert den Fortschritt, andere Zonen bleiben', () => {
  const { g, run } = arena(64);
  const k = gegner(g, 'korvette');   // Werkstatt zerstört: ein Vorgang; der Emitter Bug ist der einzige Kandidat
  Testhilfe.setzeIntegritaet(k, 'modul_werkstatt', 0);
  Testhilfe.setzeIntegritaet(k, 'emitter_bug', 0.1);
  ok(zust(k, 'emitter_bug') === 'damaged', 'Vorbedingung: Emitter Bug beschädigt, Zone Bug');
  run(4);
  const vor = rp(k, 'emitter_bug');
  ok(vor > 3.5 && vor < 4.5, 'Fortschritt nach 4 s ca. 4 s (' + vor.toFixed(2) + ')');
  Testhilfe.schildNull(k);
  // Treffer aus der Richtung des Bugs (Zone Bug): der Schild ist 0, also trifft er ein System der Zone
  space.damageEnemy(g, k, 0.01, k.x + Math.cos(k.angle) * 60, k.y + Math.sin(k.angle) * 60, {});
  ok(Math.abs(rp(k, 'emitter_bug') - vor / 2) < 1e-9, 'Systemtreffer in der Zone Bug: Fortschritt halbiert (' + rp(k, 'emitter_bug').toFixed(2) + ' von ' + vor.toFixed(2) + ')');
  const ant = gegner(g, 'korvette'); Testhilfe.setzeIntegritaet(ant, 'antrieb', 0);
  run(3);
  const v2 = rp(ant, 'antrieb');
  Gegnerreparatur.rueckschlag(g, ant, 'bug');
  ok(Math.abs(rp(ant, 'antrieb') - v2) < 1e-9, 'Zone Heck (Antrieb) bleibt bei einem Treffer in der Zone Bug unberührt');
  // Ein Treffer, der den Zustand ändert, setzt den Fortschritt dieses Systems zurück (kein Rest aus dem alten Zustand)
  Testhilfe.setzeIntegritaet(k, 'emitter_bug', 0);
  run(0.1);
  ok(zust(k, 'emitter_bug') === 'broken' && rp(k, 'emitter_bug') < 0.2, 'Zustandswechsel: der alte Fortschritt gilt nicht mehr (Reset)');
});

section('E Reaktor-Sonderreparatur: zerstört → beschädigt 12 s, Countdown endet, Zähler bleibt, nächster Ausfall 10 s', () => {
  reaktorAn();
  const { g, run } = arena(65);
  const k = gegner(g, 'korvette');
  Gegnertod.brechen(g, k, 'reaktor');
  ok(k.rt.n === 1 && Math.abs(k.rt.rest - 20) < 1e-9, 'erster Ausfall: Countdown 20 s');
  ok(Gegnerreparatur.zeit(g, k, 'reaktor') === CONFIG.reaktorTod.sonderreparatur.zeiten[0] && Gegnerreparatur.zeit(g, k, 'reaktor') === 12, 'Reaktor zerstört → beschädigt: 12 s (aus reaktorTod.sonderreparatur.zeiten[0])');
  run(11.9);
  ok(zust(k, 'reaktor') === 'broken' && k.rt.rest != null && g.space.enemies.includes(k), 'nach 11,9 s noch zerstört, Countdown läuft, Gegner da');
  run(0.3);
  ok(zust(k, 'reaktor') === 'damaged' && k.rt.rest === null && k.rt.n === 1, 'nach 12 s beschädigt: Countdown endet, Zähler bleibt (1)');
  ok(g.space.enemies.includes(k), 'der Gegner lebt weiter');
  run(6.3);
  ok(zust(k, 'reaktor') === 'ok', 'beschädigter Reaktor: nach 6 s ok (Reparatur ohne Sonderzeit)');
  Gegnertod.brechen(g, k, 'reaktor');
  ok(k.rt.n === 2 && Math.abs(k.rt.rest - reaktortod.dauer(g, 2)) < 1e-9 && Math.abs(k.rt.rest - 10) < 1e-9, 'nächster Ausfall: Countdown 10 s (Zähler 2)');
  ok(Gegnerreparatur.plaetze(g, k) === 1, 'zerstörter Reaktor: die lebende Werkstatt verdoppelt den Vorgang nicht');
});

section('F Ohne Reparatur: gestellt, Prise (nicht in space.enemies) und Relais ohne Modell', () => {
  const { g, run } = arena(66);
  const k = gegner(g, 'korvette');
  Testhilfe.setzeIntegritaet(k, 'antrieb', 0);
  Zs.halte(k);
  run(30);
  ok(zust(k, 'antrieb') === 'broken', 'gestellt: 30 s später noch zerstört (keine Reparatur)');
  const p = gegner(g, 'korvette');
  Testhilfe.setzeIntegritaet(p, 'antrieb', 0);
  g.space.enemies = g.space.enemies.filter((x) => x !== p); g.space.treibend = (g.space.treibend || []).concat([p]);   // treibende Prise (Entern): nicht mehr in der Szene
  run(30);
  ok(zust(p, 'antrieb') === 'broken', 'Prise (treibt, nicht in space.enemies): keine Reparatur');
  const r = space.spawnEnemy(g, 'relay', { x: g.ship.x + 250, y: g.ship.y });
  ok(!r.sys && !Gsys.hat(r), 'Relais hat kein Systemmodell: nichts zu reparieren');
});

section('G Zufall: die Reparatur benutzt game.rng nicht, gleiche Läufe ergeben denselben Zustand', () => {
  const lauf = (seed) => {
    const { g } = arena(seed);
    const k = gegner(g, 'fregatte');
    Testhilfe.setzeIntegritaet(k, 'antrieb', 0); Testhilfe.setzeIntegritaet(k, 'waffe_bug', 0); Testhilfe.setzeIntegritaet(k, 'emitter_bb', 0.2);
    let calls = 0;
    const r = g.rng;   // Zufall des Spiels: die Methoden, die der Code benutzt (rng.chance, rng.pick, rng.int, rng.range, rng.shuffle)
    for (const key of ['int', 'pick', 'range', 'chance', 'shuffle']) { const f = r[key]; r[key] = (...a) => { calls++; return f(...a); }; }
    for (let i = 0; i < Math.round(40 / DT); i++) Gegnerreparatur.tick(g, k, DT);   // nur das Modul, ohne den übrigen Spielablauf
    return { state: JSON.stringify(Object.keys(k.sys).map((id) => [id, k.sys[id].z, Math.round(k.sys[id].i * 1e6)])), calls, hp: k.hp };
  };
  const a = lauf(67), b = lauf(67);
  ok(a.calls === 0, 'keine Zufallsaufrufe in der Reparatur (' + a.calls + ')');
  ok(a.state === b.state && a.hp === b.hp, 'zwei gleiche Läufe: gleicher Zustand');
  ok(a.state.includes('"ok"') && a.state.includes('"broken"') === false, 'nach 40 s sind die Reparaturen abgeschlossen (kein zerstörtes System mehr)');
});

section('H Keine Skalierung mit der Crewgröße: gleiche Zeiten bei 1 und 3 Spielern', () => {
  const { g, run } = arena(68);
  setCrew(g, 1);
  const a = gegner(g, 'korvette');
  Testhilfe.setzeIntegritaet(a, 'antrieb', 0);
  const z1 = Gegnerreparatur.zeit(g, a, 'antrieb');
  g.space.enemies = g.space.enemies.filter((x) => x !== a);
  setCrew(g, 3);
  const b = gegner(g, 'korvette');
  Testhilfe.setzeIntegritaet(b, 'antrieb', 0);
  ok(z1 === 10 && Gegnerreparatur.zeit(g, b, 'antrieb') === 10, 'zerstört → beschädigt: 10 s solo und zu dritt');
  run(10.2);
  ok(zust(b, 'antrieb') === 'damaged', 'zu dritt nach 10 s beschädigt (wie solo)');
});

section('I Antrieb ohne Schalter: beschädigt 0,5, zerstört 0, in jeder Szene (e.tempoAn entfällt)', () => {
  const { g } = arena(69);
  const e = gegner(g, 'korvette');
  ok(!g.space.zielsysteme, 'kein Szenenschalter gesetzt');
  Testhilfe.setzeIntegritaet(e, 'antrieb', 0.3 * Gsys.maxOf(e, 'antrieb'));
  ok(Zs.tempoFaktor(e) === 0.5 && !('tempoAn' in e), 'beschädigt: Tempofaktor 0,5 ohne Schalter');
  Testhilfe.setzeIntegritaet(e, 'antrieb', 0);
  ok(Zs.tempoFaktor(e) === 0, 'zerstört: Tempofaktor 0 ohne Schalter');
});

section('J Zerstörtes System ist nicht anwählbar (Wahl und Erreichbarkeit)', () => {
  const { g } = arena(70);
  const e = gegner(g, 'korvette', { facing: 0 });   // Gegner 250 px vor der Lerche, Blick nach vorn (+x): die Lerche steht hinter ihm, Zone Heck zugewandt
  e.scanned = true; g.ship.target = e.id;
  ok(Zs.waehlbar(g, e).includes('antrieb'), 'intakter Antrieb im Heck ist wählbar');
  ok(Zs.waehle(g, 'antrieb') === null && g.ship.zielsystem === 'antrieb', 'Wahl des intakten Antriebs gelingt');
  Testhilfe.setzeIntegritaet(e, 'antrieb', 0);
  ok(!Zs.waehlbar(g, e).includes('antrieb'), 'zerstörter Antrieb: nicht mehr in der Wahlliste');
  const fehler = Zs.waehle(g, 'antrieb');
  ok(typeof fehler === 'string' && fehler.length > 0, 'Wahl des zerstörten Systems wird abgelehnt (Text)');
});

section('K Schützlinge (Review H1): zerstörte Waffen laden keinen Angriff, beschädigte Waffe lädt langsamer', () => {
  const ladeZeit = (zustand) => {
    const { g } = arena(71);
    const es = Escort.spawn(g, { tag: 'h1', kind: 'karawane', verhalten: 'folgt_kurs', von: { x: 1500, y: 1500 } });
    es.x = 1500; es.y = 1500; es.vx = 0; es.vy = 0;
    const gb = space.spawnEnemy(g, 'korvette', { x: 1250, y: 1500, facing: 0 });   // Bug zeigt auf den Schützling (250 px)
    gb.vx = 0; gb.vy = 0; gb.targetId = es.id;
    Testhilfe.schildNull(gb);
    if (zustand === 'alle zerstört') for (const id of ['waffe_bug', 'waffe_stbd', 'waffe_bb']) Testhilfe.setzeIntegritaet(gb, id, 0);
    if (zustand === 'bug beschädigt') Testhilfe.setzeIntegritaet(gb, 'waffe_bug', 0.3 * Gsys.maxOf(gb, 'waffe_bug'));
    let tele = null;
    gb.fireT = 0;
    for (let t = 0; t < 60 && tele === null; t += DT) { Escort.updateAttack(g, gb, es, Math.hypot(gb.x - es.x, gb.y - es.y), false, DT); if (gb.tele) tele = t; }
    return tele;
  };
  ok(ladeZeit('alle zerstört') === null, 'alle Waffen zerstört: keine Ladung auf den Schützling (60 s)');
  const intakt = ladeZeit('intakt'), dam = ladeZeit('bug beschädigt');
  info('Ladezeit bis zum Angriff: intakt ' + (intakt == null ? '–' : intakt.toFixed(2)) + ' s, Bug beschädigt ' + (dam == null ? '–' : dam.toFixed(2)) + ' s');
  ok(intakt != null && dam != null && dam > intakt * 1.3 && dam < intakt * 1.7, 'beschädigte Waffe lädt ×1,5 langsamer (Verhältnis ' + (intakt && dam ? (dam / intakt).toFixed(2) : '?') + ')');
});

section('L Rückzug mit laufendem Countdown (Review M1): der Gegner zieht nicht ab, stirbt dort; nach einer Reparatur darf er abziehen', () => {
  // L1: Countdown läuft (gestellt = keine Reparatur): nach 15 s noch in der Szene, nach dem Countdown tot, Abschuss und Beute
  const { g, run } = arena(72);
  const k = gegner(g, 'korvette'); Zs.halte(k);
  const k0 = g.stats.kills, marks0 = g.inventory.marks;
  Gegnertod.brechen(g, k, 'reaktor');
  k.leaving = true; k.leaveT = 0; k.retreatUntil = g.time + 9999;
  run(15);
  ok(g.space.enemies.includes(k) && k.rt.rest != null, 'Rückzug mit Countdown: nach 15 s noch in der Szene');
  run(6);
  ok(!g.space.enemies.includes(k) && g.stats.kills === k0 + 1, 'nach Ablauf des Countdowns: tot, kills +1');
  ok(g.inventory.marks > marks0, 'Beute aus dem Tod (Marken) gezählt');
  reaktorAn();
  // L2 (Schalter an): der Reaktor wird vorher repariert (12 s): der Countdown endet, danach zieht er ab (14 s Abzug, ohne Tod)
  const { g: h, run: runH } = arena(73);
  const j = gegner(h, 'korvette');
  Gegnertod.brechen(h, j, 'reaktor');
  j.leaving = true; j.leaveT = 0; j.retreatUntil = h.time + 9999;
  runH(12.3);
  ok(zust(j, 'reaktor') === 'damaged' && j.rt.rest === null && h.space.enemies.includes(j), 'Reaktor vorher repariert: Countdown aus, der Gegner lebt');
  runH(14.5);
  ok(!h.space.enemies.includes(j) && h.stats.kills === 0, 'danach zieht er ab (kein Tod, kein Abschuss)');
});

section('M Crew-Skalierung: gleiche Systeme und Zonen bei 1, 2, 3 Spielern; nur die Integrität skaliert', () => {
  const { g } = arena(74);
  const aufbau = [];
  for (const k of [1, 2, 3]) {
    setCrew(g, k);
    const e = gegner(g, 'fregatte');
    aufbau.push({ ids: Object.keys(e.sys).join(), zonen: Object.keys(e.sys).map((id) => Gsys.defOf('fregatte', id).zone).join(), hpMax: e.hpMax, sum: Object.values(e.sys).reduce((a, s) => a + s.i, 0) });
    g.space.enemies = g.space.enemies.filter((x) => x !== e);
  }
  ok(aufbau.every((a) => a.ids === aufbau[0].ids && a.zonen === aufbau[0].zonen), 'gleiche Systeme und Zonen bei 1, 2 und 3 Spielern');
  ok(aufbau.every((a) => Math.abs(a.sum - a.hpMax) < 1e-6), 'Σ Integrität = Klassenbudget bei jeder Crewgröße');
  ok(aufbau[0].hpMax === Math.round(CONFIG.enemies.fregatte.hp * CONFIG.crewScaling[1].gegnerIntegritaet), 'solo: Budget = Hülle × 0,4 (' + aufbau[0].hpMax + ')');
  ok(aufbau[1].hpMax === Math.round(CONFIG.enemies.fregatte.hp * CONFIG.crewScaling[2].gegnerIntegritaet) && aufbau[2].hpMax === aufbau[1].hpMax, 'zu zweit und zu dritt: Budget = Hülle × 0,56');
  ok(CONFIG.crewScaling[1].enemyFireInterval === 2.2 && CONFIG.crewScaling[3].enemyFireInterval === 1.7, 'das Feuerintervall der Gegner bleibt (2,2 / 1,7)');
});

section('N Entscheidungen: Reaktor-Schalter (aus = Todesurteil, an = Sonderreparatur rettet), Klassen-Flag repariert, Schützling außerhalb der Erfassung', () => {
  ok(R().reaktor === false, 'Standard: systemModell.gegner.reparatur.reaktor = false');
  // N1 Schalter aus: der zerstörte Reaktor bleibt zerstört, der Gegner stirbt nach dem Countdown (20 s); andere Systeme werden weiter repariert
  const { g, run } = arena(75);
  const k = gegner(g, 'korvette');
  Gegnertod.brechen(g, k, 'reaktor'); Testhilfe.setzeIntegritaet(k, 'antrieb', 0);
  ok(!Gegnerreparatur.vorgaenge(g, k).includes('reaktor') && Gegnerreparatur.vorgaenge(g, k)[0] === 'antrieb', 'Schalter aus: der Reaktor ist kein Kandidat, der Antrieb schon');
  const k0 = g.stats.kills;
  run(19.5);
  ok(zust(k, 'reaktor') === 'broken' && g.space.enemies.includes(k) && k.rt.rest != null, 'nach 19,5 s: Reaktor noch zerstört, Countdown läuft, Gegner da');
  ok(zust(k, 'antrieb') !== 'broken', 'der Antrieb wurde in der Zeit repariert (andere Systeme bleiben Sache der Reparatur)');
  run(1);
  ok(!g.space.enemies.includes(k) && g.stats.kills === k0 + 1, 'nach 20 s: der Gegner stirbt (kills +1)');
  // N2 Schalter an (live): die Sonderreparatur (12 s) rettet im 20-s-Fenster
  reaktorAn();
  const { g: h, run: runH } = arena(76);
  const j = gegner(h, 'korvette');
  Gegnertod.brechen(h, j, 'reaktor');
  runH(12.3);
  ok(zust(j, 'reaktor') === 'damaged' && j.rt.rest === null && h.space.enemies.includes(j), 'Schalter an: nach 12 s beschädigt, Countdown endet, der Gegner lebt');
  runH(10);
  ok(h.space.enemies.includes(j) && h.stats.kills === 0, 'und stirbt auch nach 22 s nicht');
  // N3 Klassen-Flag repariert (Daten): Korvette, Fregatte, Kreuzer true; Jäger, Strukturen und Frachter false (SYS-02c: Jäger-Reparatur aus, wie SYS-02a); Wirkung in tick
  const klassen = ['raider', 'korvette', 'fregatte', 'kreuzer', 'sentinel', 'pylon', 'frachter'];
  const flags = klassen.map((c) => c + ':' + DATEN.klassen[c].repariert).join();
  ok(flags === 'raider:false,korvette:true,fregatte:true,kreuzer:true,sentinel:false,pylon:false,frachter:false', 'Daten: repariert je Klasse (' + flags + ')');
  R().reaktor = false;
  const { g: m, run: runM } = arena(77);
  const cs = {};
  for (const c of klassen) { cs[c] = gegner(m, c); Testhilfe.setzeIntegritaet(cs[c], 'antrieb', 0); }
  runM(11);
  const stand = klassen.map((c) => c + ':' + zust(cs[c], 'antrieb')).join();
  ok(['korvette', 'fregatte', 'kreuzer'].every((c) => zust(cs[c], 'antrieb') === 'damaged') && ['raider', 'sentinel', 'pylon', 'frachter'].every((c) => zust(cs[c], 'antrieb') === 'broken'), 'nach 11 s: Korvette, Fregatte, Kreuzer repariert (beschädigt), Jäger, Wächter, Pylon, Frachter nicht (' + stand + ')');
  ok(Gegnerreparatur.repariert(cs.korvette) && !Gegnerreparatur.repariert(cs.raider) && !Gegnerreparatur.repariert(cs.pylon), 'Gegnerreparatur.repariert(e) liest das Klassen-Flag');
  // N4 Schützling außerhalb der Erfassung (Nebel, space.waffenReichweite): der Gegner greift den Schützling nicht an, in Erfassung schon (Befund 5b)
  const angriff = (erfassung) => {
    const t0 = CONFIG.tscan.range; CONFIG.tscan.range = erfassung;
    try {
      const { g } = arena(78);
      const es = Escort.spawn(g, { tag: 'n4', kind: 'karawane', verhalten: 'folgt_kurs', von: { x: 1500, y: 1500 } });
      es.x = 1500; es.y = 1500; es.vx = 0; es.vy = 0;
      const gb = space.spawnEnemy(g, 'korvette', { x: 1250, y: 1500, facing: 0 });   // Bug zeigt auf den Schützling (250 px)
      gb.vx = 0; gb.vy = 0; gb.targetId = es.id; Testhilfe.schildNull(gb); gb.fireT = 0;
      let tele = false;
      for (let t = 0; t < 30 && !tele; t += DT) { Escort.updateAttack(g, gb, es, Math.hypot(gb.x - es.x, gb.y - es.y), false, DT); if (gb.tele) tele = true; }
      return { tele, kann: space.enemyCanHit(g, gb, es) };
    } finally { CONFIG.tscan.range = t0; }
  };
  const klar = angriff(800), nebel = angriff(200);
  ok(klar.tele && klar.kann, 'Schützling in Erfassung (800 px): der Gegner lädt einen Angriff');
  ok(!nebel.tele && !nebel.kann, 'Schützling außerhalb der Erfassung (200 px, Nebel): kein Angriff in 30 s, enemyCanHit false');
});

console.log(`\ntest-gegner-reparatur: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
