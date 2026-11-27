'use strict';
// TEC-01 A1: Komponenten der Schildkette (server/sim/komponenten.js).
//   node tools/test-komponenten.js
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const I = require('../server/sim/interior.js');
const K = require('../server/sim/komponenten.js');
const Weltstand = require('../server/weltstand.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(title, fn) { console.log('\n[' + title + ']'); try { fn(); } catch (e) { fails++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); } }
function newGame(seed) {
  const g = new Game({ noStore: true, seed: seed || 5, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  g.space.enemies = []; g.space.projectiles = [];
  I.integritaetVoll(g);
  return g;
}
const KETTE = ['shields', 'emitter_bow', 'emitter_stbd', 'emitter_aft', 'emitter_port'];
const z = (g, sys) => g.ship.komp[sys].map((k) => k.z[0]).join('');   // o d g
const CODES = { o: 'ok', d: 'defekt', g: 'geflickt' };
const setz = (g, sys, codes) => { K.erzeugeAusZustand(g, sys); codes.split('').forEach((c, i) => { g.ship.komp[sys][i].z = CODES[c]; }); K.synchronisieren(g, sys); };

section('Rezepte als Daten', () => {
  const KD = CONFIG.systemModell.komponenten;
  ok(JSON.stringify(KD.rezepte.schilde) === '["K","S","R"]' && JSON.stringify(KD.rezepte.emitter) === '["R","L"]', 'Rezepte schilde K,S,R und emitter R,L');
  ok(KETTE.every((s) => KD.rezepte[KD.systeme[s]]) && Object.keys(KD.systeme).length === 5, 'Zuordnung System -> Rezept für genau die fünf Systeme');
  const g = newGame(1);
  ok(KETTE.every((s) => K.hatKomponenten(g, s)) && !['reactor', 'engines', 'transfer', 'weapon_bow', 'modul_1', 'thruster_port'].some((s) => K.hatKomponenten(g, s)), 'nur die Schildkette hat Komponenten');
  ok(g.ship.komp && typeof g.ship.komp === 'object', 'ship.komp vorhanden');
  K.konsistentAlle(g);
  ok(z(g, 'shields') === 'ooo' && z(g, 'emitter_bow') === 'oo', 'frisches Schiff: alle Komponenten ok');
  ok(g.ship.komp.shields.every((k) => k.n === 0 && k.sp === 0), 'Ausfall- und Sprungzähler 0');
});

section('Modell: 0/1/2/3 defekt, geflickt zählt funktionierend', () => {
  const g = newGame(2);
  K.konsistentAlle(g);
  ok(K.abgeleitet(g, 'shields') === 'ok' && g.ship.systems.shields === 'ok', '0 defekt = ok');
  setz(g, 'shields', 'odo');
  ok(K.abgeleitet(g, 'shields') === 'damaged' && g.ship.systems.shields === 'damaged' && K.defekteZahl(g, 'shields') === 1, '1 defekt = damaged, Systemzustand folgt');
  ok(I.integOf(g, 'shields') === I.integAusZustand(g, 'shields', 'damaged'), 'Integrität folgt (beschädigt = Grundwert)');
  setz(g, 'shields', 'ddo');
  ok(K.abgeleitet(g, 'shields') === 'broken' && g.ship.systems.shields === 'broken' && I.integOf(g, 'shields') === 0, '2 defekt = broken, Integrität 0');
  setz(g, 'shields', 'ddd');
  ok(K.abgeleitet(g, 'shields') === 'broken' && K.defekteZahl(g, 'shields') === 3, '3 defekt = broken');
  setz(g, 'shields', 'ggg');
  ok(K.abgeleitet(g, 'shields') === 'ok' && g.ship.systems.shields === 'ok' && K.funktionierende(g, 'shields').length === 3, 'geflickt zählt als funktionierend (3 geflickt = ok)');
  setz(g, 'shields', 'gdg');
  ok(K.abgeleitet(g, 'shields') === 'damaged', 'geflickt + 1 defekt = damaged');
  setz(g, 'emitter_aft', 'dd');
  ok(g.ship.systems.emitter_aft === 'broken' && g.ship.systems.emitter_bow === 'ok', 'Emitter: 2 defekt = broken, andere Emitter unberührt');
  setz(g, 'emitter_aft', 'od');
  ok(g.ship.systems.emitter_aft === 'damaged', 'Emitter: 1 defekt = damaged');
});

section('Einhängen: damageSystem, setzeZustand, Reparatur', () => {
  const g = newGame(3);
  K.konsistentAlle(g);
  I.damageSystem(g, 'shields');
  ok(g.ship.systems.shields === 'damaged' && K.defekteZahl(g, 'shields') === 1 && K.abgeleitet(g, 'shields') === 'damaged', 'damageSystem ohne toState: eine Stufe, ein Komponentenausfall');
  I.damageSystem(g, 'shields');
  ok(g.ship.systems.shields === 'broken' && K.defekteZahl(g, 'shields') === 2, 'zweite Stufe: zerstört, 2 defekt');
  const vor = z(g, 'shields');
  I.damageSystem(g, 'shields');
  ok(z(g, 'shields') === vor && g.ship.systems.shields === 'broken', 'zerstörtes System nimmt keinen weiteren Komponentenschaden');
  ok(K.setzeKomponente(g, 'shields', vor.indexOf('o'), 'defekt') === false && z(g, 'shields') === vor, 'setzeKomponente auf zerstörtem System: kein weiterer Schaden');
  I.setzeZustand(g, 'shields', 'ok');
  ok(z(g, 'shields') === 'ooo' && g.ship.systems.shields === 'ok', 'setzeZustand ok: Komponenten heil');
  I.damageSystem(g, 'emitter_stbd', 'broken');
  ok(z(g, 'emitter_stbd') === 'dd' && g.ship.systems.emitter_stbd === 'broken', 'damageSystem mit toState broken: 2 defekt');
  I.setzeZustand(g, 'emitter_stbd', 'damaged');
  ok(K.defekteZahl(g, 'emitter_stbd') === 1 && g.ship.systems.emitter_stbd === 'damaged', 'setzeZustand damaged: 1 defekt');
  I.repairSystem(g, 'emitter_stbd', 'bot', 'swap');
  ok(g.ship.systems.emitter_stbd === 'ok' && z(g, 'emitter_stbd') === 'oo', 'Reparatur (heutiger Weg): Komponenten folgen, Wächter bleibt still');
  I.damageSystem(g, 'emitter_bow', 'broken');
  I.repairSystem(g, 'emitter_bow', 'bot', 'swap');
  ok(g.ship.systems.emitter_bow === 'ok' || (g.ship.systems.emitter_bow === 'damaged' && K.defekteZahl(g, 'emitter_bow') === 1), 'Reparatur broken -> ...: Komponenten zum Zustand passend');
  ok(K.konsistent(g, 'emitter_bow') === false, 'nach der Reparatur ist nichts mehr nachzuziehen');
  // Zufall nur unter funktionierenden, bevorzugt S
  const g2 = newGame(4); K.konsistentAlle(g2);
  let alleS = true;
  for (let i = 0; i < 20; i++) { I.setzeZustand(g2, 'shields', 'ok'); K.hebeAufZustand(g2, 'shields', 'damaged', 'S'); if (z(g2, 'shields') !== 'odo') alleS = false; }
  ok(alleS, 'hebeAufZustand mit Vorzug S: immer der Spannungsregler');
  setz(g2, 'shields', 'dgo');
  K.hebeAufZustand(g2, 'shields', 'broken', 'K');
  ok(z(g2, 'shields') === 'dgo' || z(g2, 'shields') === 'ddo' || z(g2, 'shields') === 'dgd', 'hebeAufZustand wählt nur unter funktionierenden (hier schon 1 defekt, kein Dritter)');
  ok(K.defekteZahl(g2, 'shields') === 2 && z(g2, 'shields')[0] === 'd', 'bereits defekter Steuerkern bleibt, genau ein weiterer fällt aus');
  const g3 = newGame(4); K.konsistentAlle(g3);
  ok(K.hebeAufZustand(g3, 'shields', 'broken') === 2 && K.defekteZahl(g3, 'shields') === 2 && K.hebeAufZustand(g3, 'shields', 'damaged') === 0, 'hebt auf 2, senkt nie');
  const g4 = newGame(7); const r0 = g4.rng.int(1e9); const g5 = newGame(7); I.damageSystem(g5, 'shields'); I.damageSystem(g5, 'emitter_bow', 'broken');
  ok(g5.rng.int(1e9) === r0, 'Komponentenwahl verschiebt game.rng nicht');
});

section('Wächter: direkter Schreiber -> Komponenten folgen', () => {
  const g = newGame(6);
  K.konsistentAlle(g);
  g.ship.systems.shields = 'broken';
  ok(K.konsistent(g, 'shields') === true && K.defekteZahl(g, 'shields') === 2 && g.ship.systems.shields === 'broken', 'direkt auf broken geschrieben: Komponenten neu erzeugt (2 defekt)');
  ok(K.konsistent(g, 'shields') === false, 'Wächter ist idempotent');
  g.ship.systems.shields = 'ok';
  require('../server/sim/damage.js').update(g, 0.05);
  ok(z(g, 'shields') === 'ooo', 'direkt auf ok geschrieben: der Tick-Wächter zieht nach');
  g.ship.systems.emitter_port = 'damaged';
  require('../server/sim/damage.js').update(g, 0.05);
  ok(K.defekteZahl(g, 'emitter_port') === 1 && g.ship.systems.emitter_port === 'damaged', 'Emitter direkt auf damaged: ein Komponentenausfall, Systemzustand bleibt');
  g.ship.komp.shields[0].n = 3; g.ship.komp.shields[0].sp = 2;
  g.ship.systems.shields = 'damaged'; K.konsistent(g, 'shields');
  ok(g.ship.komp.shields[0].n === 3 && g.ship.komp.shields[0].sp === 2, 'Neuerzeugung behält Ausfall- und Sprungzähler');
  g.ship.systems.shields = 'broken'; K.konsistent(g, 'shields');
  require('../server/sim/szenenreset.js').zuruecksetzen(g, {});
  ok(z(g, 'shields') === 'ooo' && g.ship.systems.shields === 'ok', 'Szenenreset: Komponenten heil');
});

section('EMP offline wird nie überschrieben', () => {
  const g = newGame(8);
  K.konsistentAlle(g);
  g.ship.offline.emitter_bow = { t: 10, prev: 'ok' }; g.ship.systems.emitter_bow = 'offline';
  K.synchronisieren(g, 'emitter_bow');
  ok(g.ship.systems.emitter_bow === 'offline' && g.ship.offline.emitter_bow.prev === 'ok', 'synchronisieren: offline bleibt');
  K.konsistentAlle(g);
  ok(g.ship.systems.emitter_bow === 'offline' && z(g, 'emitter_bow') === 'oo', 'Wächter fasst offline nicht an');
  I.damageSystem(g, 'emitter_bow');
  ok(g.ship.systems.emitter_bow === 'offline' && g.ship.offline.emitter_bow.prev === 'damaged' && K.defekteZahl(g, 'emitter_bow') === 1, 'Schaden während offline: prev = damaged, 1 defekt');
  I.damageSystem(g, 'emitter_bow', 'broken');
  ok(g.ship.systems.emitter_bow === 'offline' && g.ship.offline.emitter_bow.prev === 'broken' && K.defekteZahl(g, 'emitter_bow') === 2, 'prev folgt auf broken, 2 defekt');
  g.ship.komp.emitter_bow[0].z = 'ok'; K.synchronisieren(g, 'emitter_bow');
  ok(g.ship.systems.emitter_bow === 'offline' && g.ship.offline.emitter_bow.prev === 'damaged', 'Komponente geheilt: prev folgt, offline bleibt');
  K.konsistentAlle(g);
  ok(K.defekteZahl(g, 'emitter_bow') === 1 && g.ship.systems.emitter_bow === 'offline', 'Wächter prüft gegen prev (damaged), nicht gegen offline');
});

section('Reaktor und andere Systeme unberührt', () => {
  const g = newGame(9);
  K.konsistentAlle(g);
  for (const s of ['reactor', 'engines', 'transfer', 'thruster_port', 'weapon_bow', 'battery_port']) {
    I.damageSystem(g, s, 'damaged', { quiet: true });
    ok(g.ship.systems[s] === 'damaged' && !(g.ship.komp && g.ship.komp[s]), `${s}: systemweit wie heute, keine Komponenten`);
  }
  ok(Object.keys(g.ship.komp).every((s) => KETTE.includes(s)), 'ship.komp enthält nur Schildkette-Systeme');
});

section('Snapshot: nur bei Abweichung, kompakt', () => {
  const g = newGame(10);
  K.konsistentAlle(g);
  ok(K.snapshot(g) === null, 'alles ok: kein Feld');
  setz(g, 'shields', 'odd');
  setz(g, 'emitter_aft', 'od');
  const sn = K.snapshot(g);
  ok(sn && sn.shields === 'odd' && sn.emitter_aft === 'od' && Object.keys(sn).length === 2, 'Snapshot: je abweichendem System ein Zustandsstring');
  g.ship.komp.emitter_bow[0].n = 2;
  ok(K.snapshot(g).emitter_bow === 'oo;2,0;0,0', 'Zähler > 0 stehen hinter dem Zustandsstring');
  const dek = K.dekodiere(g, 'emitter_bow', 'oo;2,0;0,0');
  ok(dek && dek[0].n === 2 && dek[1].n === 0 && K.dekodiere(g, 'emitter_bow', 'ooo') === null && K.dekodiere(g, 'shields', 'xyz') === null, 'dekodiere: Rundlauf, passt nicht zum Rezept = null');
});

section('Weltstand: Block nur bei Abweichung, alter Stand lädt', () => {
  const g = newGame(11);
  K.konsistentAlle(g);
  setz(g, 'shields', 'ood');
  let d = Weltstand.capture(g);
  ok(d.schiff.komp === undefined && d.schiff.systeme.shields === 'damaged', 'Standard (aus dem Zustand erzeugt): kein Block');
  setz(g, 'shields', 'odo');
  d = Weltstand.capture(g);
  ok(d.schiff.komp && d.schiff.komp.shields === 'odo', 'andere Komponente defekt als der Standard: Block');
  setz(g, 'shields', 'ddo');
  g.ship.komp.shields[1].n = 2;
  setz(g, 'emitter_port', 'do');
  g.ship.komp.shields[1].n = 2;
  d = Weltstand.capture(g);
  ok(d.schiff.komp && d.schiff.komp.shields === 'ddo;0,2,0;0,0,0', 'Abweichung (Zähler): Block mit Zustand und Zählern');
  ok(d.schiff.komp.emitter_port === 'do', 'Emitter mit defektem Relais (nicht der Standard R-ok, L-defekt): Block');
  const dv = JSON.parse(JSON.stringify(d)); dv.id = 'test'; dv.name = 'Test';
  const errs = Weltstand.validate(dv);
  ok(!errs || !errs.length, 'Schema-Prüfung mit Block: ' + JSON.stringify(errs));
  const g2 = newGame(12);
  Weltstand.apply(g2, JSON.parse(JSON.stringify(d)));
  ok(z(g2, 'shields') === 'ddo' && g2.ship.komp.shields[1].n === 2 && g2.ship.systems.shields === 'broken' && z(g2, 'emitter_port') === 'do', 'laden: Komponenten und Zähler aus dem Block');
  const alt = JSON.parse(JSON.stringify(d)); delete alt.schiff.komp;
  const g3 = newGame(13);
  Weltstand.apply(g3, alt);
  ok(g3.ship.systems.shields === 'broken' && K.defekteZahl(g3, 'shields') === 2 && K.abgeleitet(g3, 'shields') === 'broken', 'alter Stand ohne Block: Komponenten aus dem Systemzustand');
  const falsch = JSON.parse(JSON.stringify(d)); falsch.schiff.komp.shields = 'ooo';
  const g4 = newGame(14);
  Weltstand.apply(g4, falsch);
  ok(g4.ship.systems.shields === 'broken' && K.defekteZahl(g4, 'shields') === 2, 'Block passt nicht zum Systemzustand: Standard, kein Absturz');
  const kaputt = JSON.parse(JSON.stringify(d)); kaputt.schiff.komp = { shields: 'zz', emitter_bow: 5 };
  const g5 = newGame(15);
  Weltstand.apply(g5, kaputt);
  ok(g5.ship.systems.shields === 'broken', 'unbrauchbarer Block: kein Absturz');
  const g6 = newGame(16); K.konsistentAlle(g6);
  setz(g6, 'emitter_bow', 'gg'); g6.ship.fragile.emitter_bow = true;
  const d6 = Weltstand.capture(g6);
  ok(d6.schiff.systeme.emitter_bow === 'damaged' && d6.schiff.komp === undefined, 'Zustand/Block widersprüchlich (fragil als damaged gespeichert): Block entfällt');
});

console.log(`\n${n - fails}/${n} Prüfungen grün${fails ? ', ' + fails + ' FEHLER' : ''}`);
process.exit(fails ? 1 : 0);
