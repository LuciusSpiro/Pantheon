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
  ok(g.ship.systems.emitter_bow === 'damaged' && K.defekteZahl(g, 'emitter_bow') === 1, 'B1: ein Tausch heilt nur EINE Komponente: broken wird damaged');
  I.repairSystem(g, 'emitter_bow', 'bot', 'swap');
  ok(g.ship.systems.emitter_bow === 'ok' && z(g, 'emitter_bow') === 'oo', 'Reparatur broken per Ersatzteil (swap): zwei Tausche, dann wieder ok, beide Komponenten heil');
  ok(K.konsistent(g, 'emitter_bow') === false, 'nach der Reparatur ist nichts mehr nachzuziehen');
  // Zufall nur unter funktionierenden, bevorzugt S
  const g2 = newGame(4); K.konsistentAlle(g2);
  let alleS = true;
  for (let i = 0; i < 20; i++) { I.setzeZustand(g2, 'shields', 'ok'); K.ueberlastTreffer(g2, 'shields'); if (z(g2, 'shields') !== 'odo') alleS = false; }
  ok(alleS, 'Überlasttreffer mit Vorzug S: immer der Spannungsregler');
  setz(g2, 'shields', 'dgo');
  K.hebeAufZustand(g2, 'shields', 'broken');
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
  setz(g6, 'emitter_bow', 'gg'); g6.ship.fragile.emitter_bow = true;   // Altlast-Flag: B1 ignoriert ship.fragile auf der Schildkette
  const d6 = Weltstand.capture(g6);
  ok(d6.schiff.systeme.emitter_bow === 'ok' && d6.schiff.komp && d6.schiff.komp.emitter_bow === 'gg', 'ok + geflickte Komponenten: als ok gespeichert (kein damaged), der Flicken steht im Block (B1)');
  g6.ship.komp.emitter_bow[0].n = 3; g6.ship.komp.emitter_bow[1].sp = 1;
  const d6b = Weltstand.capture(g6);
  ok(d6b.schiff.komp && d6b.schiff.komp.emitter_bow === 'gg;3,0;0,1', 'ok + Flicken + Zähler: Codes und Zähler im Block (' + (d6b.schiff.komp && d6b.schiff.komp.emitter_bow) + ')');
  ok(!(Weltstand.validate(Object.assign(JSON.parse(JSON.stringify(d6b)), { id: 'test', name: 'Test' })) || []).length, 'Schema nimmt den Platzhalter an');
  const g6b = newGame(17); Weltstand.apply(g6b, JSON.parse(JSON.stringify(d6b)));
  ok(g6b.ship.systems.emitter_bow === 'ok' && z(g6b, 'emitter_bow') === 'gg' && I.isFragile(g6b, 'emitter_bow') && g6b.ship.komp.emitter_bow[0].n === 3 && g6b.ship.komp.emitter_bow[1].sp === 1, 'laden: ok, beide Flicken, fragil abgeleitet, Zähler aus dem Block');
  // EMP-Pause: offline wird als ok gespeichert, die Ableitung (prev) ist damaged
  const g7 = newGame(18); K.konsistentAlle(g7);
  setz(g7, 'emitter_aft', 'od'); g7.ship.komp.emitter_aft[0].n = 2;
  g7.ship.offline.emitter_aft = { t: 10, prev: 'damaged' }; g7.ship.systems.emitter_aft = 'offline';
  const d7 = Weltstand.capture(g7);
  ok(d7.schiff.systeme.emitter_aft === 'ok' && d7.schiff.komp && d7.schiff.komp.emitter_aft === '--;2,0;0,0', 'EMP-Pause (offline als ok gespeichert): Zähler bleiben, Codes entfallen (' + (d7.schiff.komp && d7.schiff.komp.emitter_aft) + ')');
  const g7b = newGame(19); Weltstand.apply(g7b, JSON.parse(JSON.stringify(d7)));
  ok(g7b.ship.systems.emitter_aft === 'ok' && K.defekteZahl(g7b, 'emitter_aft') === 0 && g7b.ship.komp.emitter_aft[0].n === 2, 'laden: ok, alles heil, Ausfallzähler 2 erhalten');
  const alt7 = JSON.parse(JSON.stringify(d7)); alt7.schiff.komp = { emitter_aft: 'oo;2,0;0,0' };
  const g7c = newGame(20); Weltstand.apply(g7c, alt7);
  ok(g7c.ship.komp.emitter_aft[0].n === 2 && z(g7c, 'emitter_aft') === 'oo', 'alter Format-String (nur Codes + Zähler) lädt weiter');
});

// ---------- TEC-01 A2: Trefferwege auf Komponenten ----------
const DAMAGE = require('../server/sim/damage.js');
const heil = (g, sys) => { I.setzeZustand(g, sys, 'ok'); if (g.ship.trefferT) delete g.ship.trefferT[sys]; };
const verteilung = (g, sys, start, lauf) => {   // wie oft ist welcher Platz der neu defekte? (Start: Codes, genau ein Treffer)
  const h = new Array(g.ship.komp[sys].length).fill(0);
  for (let i = 0; i < lauf; i++) {
    setz(g, sys, start); if (g.ship.trefferT) delete g.ship.trefferT[sys];
    I.direktTreffer(g, sys);
    const zz = z(g, sys);
    for (let j = 0; j < zz.length; j++) if (zz[j] === 'd' && start[j] !== 'd') h[j]++;
  }
  return h;
};
const EMITTER = ['emitter_bow', 'emitter_stbd', 'emitter_aft', 'emitter_port'];

section('A2: Treffer wählt zufällig EINE funktionierende Komponente', () => {
  const g = newGame(21); K.konsistentAlle(g);
  const h = verteilung(g, 'shields', 'ooo', 600);
  ok(h.every((x) => x >= 150 && x <= 250) && h.reduce((a, b) => a + b, 0) === 600, 'Generator, 600 Treffer: grob gleich über K, S, R ' + JSON.stringify(h));
  const he = verteilung(g, 'emitter_bow', 'oo', 400);
  ok(he.every((x) => x >= 150 && x <= 250), 'Emitter, 400 Treffer: grob gleich über R und L ' + JSON.stringify(he));
  const hg = verteilung(g, 'shields', 'ggo', 600);
  ok(hg.every((x) => x >= 150 && x <= 250), 'Pool schließt geflickte ein: ggo, jede der drei wird getroffen ' + JSON.stringify(hg));
  setz(g, 'shields', 'ggg'); delete g.ship.trefferT.shields;
  const r = I.direktTreffer(g, 'shields');
  const zz = z(g, 'shields');
  ok(r && r.state === 'damaged' && (zz.match(/d/g) || []).length === 1 && (zz.match(/g/g) || []).length === 2, 'ggg + Treffer: genau ein Flicken bricht, die beiden anderen bleiben geflickt (' + zz + '), System damaged');
  let andereIntakt = true;
  for (let i = 0; i < 60; i++) {
    setz(g, 'emitter_aft', 'go'); setz(g, 'shields', 'gog'); delete g.ship.trefferT.emitter_aft;
    I.direktTreffer(g, 'emitter_aft');
    if (z(g, 'shields') !== 'gog') andereIntakt = false;
  }
  ok(andereIntakt, 'Treffer auf einen Emitter bricht nie den Flicken eines anderen Systems');
  heil(g, 'shields'); I.direktTreffer(g, 'shields');
  ok(I.direktTreffer(g, 'shields') === null && K.defekteZahl(g, 'shields') === 1, 'zweiter Treffer im Fenster wirkt nicht (null, weiter 1 defekt)');
  g.time += 1;
  const r2 = I.direktTreffer(g, 'shields');
  ok(r2 && r2.state === 'broken' && K.defekteZahl(g, 'shields') === 2, 'nach dem Fenster: zweiter Treffer zerstört (2 defekt)');
  g.time += 1;
  const vor = z(g, 'shields');
  ok(I.direktTreffer(g, 'shields') === null && z(g, 'shields') === vor && K.trefferAuf(g, 'shields') === null, 'zerstörtes System nimmt keinen weiteren Komponentenschaden');
  setz(g, 'shields', 'ggg'); g.time += 1; delete g.ship.trefferT.shields;
  I.direktTreffer(g, 'shields'); g.time += 1; I.direktTreffer(g, 'shields');
  ok(g.ship.systems.shields === 'broken' && K.defekteZahl(g, 'shields') === 2 && (z(g, 'shields').match(/g/g) || []).length === 1, 'ggg: zwei Treffer = zerstört, ein Flicken bleibt');
});

section('A2: trefferweg und resolveHit, Fenster unverändert', () => {
  const g = newGame(22); K.konsistentAlle(g);
  const zone = I.systemSector('emitter_bow');
  const opt = { ziel: 'emitter_bow', zugewandt: zone };
  const t1 = I.trefferweg(g, zone, opt);
  ok(t1 && t1.system === 'emitter_bow' && t1.state === 'damaged' && t1.wechsel === true && K.defekteZahl(g, 'emitter_bow') === 1, 'trefferweg (Ziel): ein Komponententreffer, damaged');
  const t2 = I.trefferweg(g, zone, opt);
  ok(K.defekteZahl(g, 'emitter_bow') === 1 && (!t2 || t2.system !== 'emitter_bow'), 'zweiter Treffer im Fenster wirkt nicht auf denselben Emitter');
  g.time += 1;
  I.trefferweg(g, zone, opt);
  ok(g.ship.systems.emitter_bow === 'broken' && K.defekteZahl(g, 'emitter_bow') === 2, 'nach dem Fenster: zerstört');
  const g2 = newGame(23); K.konsistentAlle(g2);
  setz(g2, 'emitter_bow', 'gg');
  const t3 = I.trefferweg(g2, zone, opt);
  ok(t3 && t3.system === 'emitter_bow' && g2.ship.systems.emitter_bow === 'damaged' && (z(g2, 'emitter_bow').match(/g/g) || []).length === 1, 'emitter_bow gg: ein Flicken bricht, damaged (nicht broken)');
  const g3 = newGame(24); K.konsistentAlle(g3);
  g3.ship.shields.current = [0, 0, 0, 0];
  const res = DAMAGE.resolveHit(g3, zone, 5, { pierce: true, zielt: 'emitter_bow' });
  ok(res.systems.length === 1, 'resolveHit ohne Schild: ein Systemtreffer');
  ok(K.defekteZahl(g3, 'emitter_bow') === 1 && g3.ship.systems.emitter_bow === 'damaged', 'resolveHit: der erste Treffer kam an (genau 1 defekt)');
  DAMAGE.resolveHit(g3, zone, 5, { pierce: true, zielt: 'emitter_bow' });
  ok(K.defekteZahl(g3, 'emitter_bow') === 1 && g3.ship.systems.emitter_bow === 'damaged', 'resolveHit: derselbe Emitter verliert im Fenster keine zweite Komponente');
});

section('A2: Torpedo zerstört sicher', () => {
  const g = newGame(25); K.konsistentAlle(g);
  I.direktTreffer(g, 'shields');
  const r = I.zerstoerenTreffer(g, 'shields');
  ok(r && r.state === 'broken' && K.defekteZahl(g, 'shields') === 2 && g.ship.systems.shields === 'broken', 'zerstoerenTreffer im Fenster: zerstört (2 defekt)');
  const g2 = newGame(26); K.konsistentAlle(g2);
  I.zerstoerenTreffer(g2, 'emitter_stbd');
  ok(z(g2, 'emitter_stbd') === 'dd' && g2.ship.systems.emitter_stbd === 'broken', 'Emitter: Torpedo = beide Komponenten defekt');
  const g3 = newGame(27); K.konsistentAlle(g3);
  const zone = I.systemSector('emitter_port');
  I.trefferweg(g3, zone, { ziel: 'emitter_port', zugewandt: zone, zerstoeren: true });
  ok(g3.ship.systems.emitter_port === 'broken', 'trefferweg mit zerstoeren: zerstört');
});

section('A2: Überlast trifft den Spannungsregler', () => {
  const g = newGame(28); K.konsistentAlle(g);
  let alleS = true;
  for (let i = 0; i < 40; i++) { heil(g, 'shields'); I.heatDamage(g, 'shields'); if (z(g, 'shields') !== 'odo') alleS = false; }
  ok(alleS, 'ok-Generator: Überlast bricht immer S');
  alleS = true;
  for (let i = 0; i < 40; i++) { setz(g, 'shields', 'ogo'); I.heatDamage(g, 'shields'); if (z(g, 'shields') !== 'odo') alleS = false; }
  ok(alleS, 'S geflickt: der Flicken von S bricht (sicher), K und R bleiben');
  setz(g, 'shields', 'ood');
  I.heatDamage(g, 'shields');
  ok(z(g, 'shields') === 'ood', 'beschädigter Generator: Überlast wirkt wie heute nicht (nur heile Systeme)');
  setz(g, 'shields', 'odo');
  K.ueberlastTreffer(g, 'shields');
  ok(g.ship.systems.shields === 'broken' && z(g, 'shields')[1] === 'd' && K.defekteZahl(g, 'shields') === 2, 'S schon defekt: Vorzug greift nicht, ein anderer fällt aus');
  ok(K.ueberlastZiel(g, 'shields') === 'S' && KETTE.slice(1).every((s) => K.ueberlastZiel(g, s) === null) && K.ueberlastZiel(g, 'reactor') === null, 'Überlastziel ist ein Datum (systemModell.komponenten.ueberlast): nur der Generator hat eines');
  const g3 = newGame(41); K.konsistentAlle(g3);
  const ev = []; const emit0 = g3.emit.bind(g3); g3.emit = (n, d) => { ev.push(n + ':' + (d && d.system)); return emit0(n, d); };
  I.heatDamage(g3, 'shields');
  ok(ev.includes('systemHit:shields') && g3.ship.sysAnnounce.list.some((e) => e.system === 'shields') && I.integOf(g3, 'shields') === I.integAusZustand(g3, 'shields', 'damaged'),
    'Überlast: gleiche Nachbehandlung wie ein Treffer (systemHit, ODA-Meldung, Integrität)');
  const g2 = newGame(29); K.konsistentAlle(g2);
  I.heatDamage(g2, 'emitter_bow');
  ok(K.defekteZahl(g2, 'emitter_bow') === 1, 'sonstige Hitzeschäden bleiben normale Treffer');
});

section('A2: Ausfallzähler n für R und K', () => {
  const g = newGame(30); K.konsistentAlle(g);
  for (let i = 0; i < 30; i++) { heil(g, 'shields'); I.direktTreffer(g, 'shields'); }
  const summe = (G, sys, t) => G.ship.komp[sys].filter((k) => k.t === t).reduce((a, k) => a + k.n, 0);
  const kr = summe(g, 'shields', 'K') + summe(g, 'shields', 'R');
  ok(kr > 10 && kr < 30 && summe(g, 'shields', 'S') === 0, 'Generator, 30 Treffer: K und R zählen, S nie (K+R=' + kr + ')');
  const g2 = newGame(31); K.konsistentAlle(g2);
  for (let i = 0; i < 30; i++) { setz(g2, 'shields', 'ggg'); if (g2.ship.trefferT) delete g2.ship.trefferT.shields; I.direktTreffer(g2, 'shields'); }
  ok(g2.ship.komp.shields.every((k) => k.n === 0), 'geflickt -> defekt zählt nicht (n bleibt 0)');
  const g3 = newGame(32); K.konsistentAlle(g3);
  K.hebeAufZustand(g3, 'emitter_bow', 'broken');
  ok(g3.ship.komp.emitter_bow[0].n === 1 && g3.ship.komp.emitter_bow[1].n === 0, 'Emitter: Relais zählt 1, Leitung nie');
  const g4 = newGame(33); K.konsistentAlle(g4);
  I.damageSystem(g4, 'shields', 'broken');
  ok(g4.ship.komp.shields[1].n === 0 && g4.ship.komp.shields[0].n + g4.ship.komp.shields[2].n >= 1, 'Torpedo/broken: nur K und R zählen');
});

section('A2: Reaktor und Nicht-Schildkette behalten das alte Flicken-Verhalten', () => {
  const g = newGame(34); K.konsistentAlle(g);
  g.ship.fragile.reactor = true;
  const r = I.trefferweg(g, I.systemSector('reactor'), {});
  ok(g.ship.systems.reactor === 'broken' && r && !g.ship.fragile.reactor, 'Reaktor fragil: Treffer bricht direkt auf broken (frag-Schleife)');
  const g2 = newGame(35); K.konsistentAlle(g2);
  g2.ship.fragile.engines = true;
  I.trefferweg(g2, I.systemSector('engines'), {});
  ok(g2.ship.systems.engines === 'broken', 'engines fragil: bricht auf broken wie heute');
  const g3 = newGame(36); K.konsistentAlle(g3);
  I.direktTreffer(g3, 'transfer');
  ok(g3.ship.systems.transfer === 'damaged' && !(g3.ship.komp && g3.ship.komp.transfer), 'transfer: eine Stufe systemweit, keine Komponenten');
  g3.ship.fragile.weapon_bow = true; g3.time += 1;
  I.direktTreffer(g3, 'weapon_bow');
  ok(g3.ship.systems.weapon_bow === 'broken', 'weapon_bow fragil: direkt zerstört wie heute');
});

section('A2: EMP, Notsprung, Feuer, Wächter bleibt still', () => {
  const g = newGame(37); K.konsistentAlle(g);
  I.setOffline(g, 'shields', 10);
  ok(g.ship.systems.shields === 'offline' && z(g, 'shields') === 'ooo', 'setOffline ändert keine Komponenten');
  I.direktTreffer(g, 'shields');
  ok(g.ship.systems.shields === 'offline' && g.ship.offline.shields.prev === 'damaged' && K.defekteZahl(g, 'shields') === 1, 'Treffer während offline: ein Komponententreffer, prev = damaged');
  g.time += 1; I.direktTreffer(g, 'shields');
  ok(g.ship.offline.shields.prev === 'broken' && K.defekteZahl(g, 'shields') === 2, 'zweiter Treffer: prev broken, 2 defekt');
  const g2 = newGame(38); K.konsistentAlle(g2);
  I.damageSystem(g2, 'emitter_aft', 'damaged');
  ok(g2.ship.systems.emitter_aft === 'damaged' && K.defekteZahl(g2, 'emitter_aft') === 1, 'Notsprung-Schaden (damaged): ein Komponentenausfall');
  const g3 = newGame(39); K.konsistentAlle(g3);
  I.damageSystem(g3, 'shields');
  ok(K.defekteZahl(g3, 'shields') === 1 && g3.ship.systems.shields === 'damaged', 'Feuerschaden: normaler Zufallstreffer');
  const g4 = newGame(40); K.konsistentAlle(g4);
  for (let i = 0; i < 80; i++) {
    g4.time += 1;
    for (const s of KETTE) I.direktTreffer(g4, s);
    I.direktTreffer(g4, 'reactor'); I.heatDamage(g4, 'shields');
    DAMAGE.update(g4, 0.05);
    if (i % 5 === 4) for (const s of KETTE) I.setzeZustand(g4, s, 'ok');
  }
  ok((g4.ship.kompKorrekturen | 0) === 0, 'Wächter hat nach 80 Treffer-Runden nie korrigiert (kompKorrekturen=' + (g4.ship.kompKorrekturen | 0) + ')');
  ok(!('kompKorrekturen' in JSON.parse(JSON.stringify(g4.ship))), 'Zähler ist kein Snapshot-Feld');
  g4.ship.systems.shields = 'broken'; K.konsistent(g4, 'shields');
  ok(g4.ship.kompKorrekturen === 1, 'Gegenprobe: direkter Schreiber wird gezählt');
});

// ---------- TEC-01 A-Nacharbeit ----------
section('Nacharbeit 1: Schildkette bleibt aus der Flicken-Schleife von trefferweg', () => {
  const zone = I.systemSector('emitter_aft');   // Zone 2: engines, emitter_aft, lafette_2
  ok(I.systemSector('engines') === zone, 'Voraussetzung: engines liegt in der Zone des Emitters');
  const g = newGame(50); K.konsistentAlle(g);
  g.ship.fragile.emitter_aft = true;   // Altlast-Flag auf einem Schildkette-System
  const r = I.trefferweg(g, zone, {});
  ok(r && r.wechsel === true, 'trefferweg: der Treffer kam an (Wechsel)');
  ok(g.ship.systems.emitter_aft !== 'broken' && K.defekteZahl(g, 'emitter_aft') <= 1, 'Emitter ok + fragile-Altlast: kein Direktbruch auf zerstört, höchstens 1 Komponente defekt');
  // Gegenprobe: ein System der Zone ohne Komponenten bricht mit fragile weiter direkt
  const g2 = newGame(51); K.konsistentAlle(g2);
  g2.ship.fragile.engines = true;
  const r2 = I.trefferweg(g2, zone, {});
  ok(r2 && r2.system === 'engines' && g2.ship.systems.engines === 'broken' && g2.ship.systems.emitter_aft === 'ok', 'Gegenprobe: engines fragile bricht direkt auf broken, der Emitter bleibt unberührt');
  // beide fragil: nur das Nicht-Schildkette-System bricht direkt
  const g3 = newGame(52); K.konsistentAlle(g3);
  g3.ship.fragile.engines = true; g3.ship.fragile.emitter_aft = true;
  I.trefferweg(g3, zone, {});
  ok(g3.ship.systems.engines === 'broken' && g3.ship.systems.emitter_aft === 'ok' && K.defekteZahl(g3, 'emitter_aft') === 0, 'beide fragil: engines bricht direkt, der Emitter nimmt keinen Direktbruch');
});

section('Nacharbeit 3: neu aufgestellte Lerche hat Ausfallzähler 0', () => {
  const zaehler = (g) => KETTE.reduce((a, s) => a + g.ship.komp[s].reduce((b, k) => b + k.n + k.sp, 0), 0);
  const belegen = (g) => { for (const s of KETTE) g.ship.komp[s].forEach((k) => { k.n = 3; k.sp = 2; }); };
  const g = newGame(53); K.konsistentAlle(g); belegen(g);
  I.setzeZustand(g, 'shields', 'damaged');
  ok(g.ship.komp.shields.every((k) => k.n === 3 && k.sp === 2), 'Gegenprobe: Zustand setzen / Wächter behält die Zähler (erzeugeAusZustand)');
  require('../server/sim/szenenreset.js').zuruecksetzen(g, {});
  ok(zaehler(g) === 0 && z(g, 'shields') === 'ooo' && g.ship.systems.shields === 'ok', 'Szenenreset: alle Komponenten heil, n und sp 0');
  const g2 = newGame(54); K.konsistentAlle(g2); belegen(g2);
  I.damageSystem(g2, 'emitter_port', 'broken');
  require('../server/sim/arena.js').repairShip(g2);
  ok(zaehler(g2) === 0 && z(g2, 'emitter_port') === 'oo' && g2.ship.systems.emitter_port === 'ok', 'Arena-Rücksetzer: alle Komponenten heil, n und sp 0');
  const g3 = newGame(55); K.konsistentAlle(g3); belegen(g3);
  K.neuAufstellen(g3);
  ok(zaehler(g3) === 0, 'K.neuAufstellen setzt die Zähler auf 0');
});

section('Nacharbeit 4: frisches Spiel ohne Tick', () => {
  const g0 = new Game({ noStore: true, seed: 3, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  ok(KETTE.every((s) => Array.isArray(g0.ship.komp[s])) && z(g0, 'shields') === 'ooo', 'game.reset legt die Komponenten an (alle heil)');
  const idx = new Set(); let nOk = true; let korr = 0; let broken = true;
  for (let seed = 1; seed <= 30; seed++) {
    const g = new Game({ noStore: true, seed, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    g.space.enemies = []; g.space.projectiles = [];
    I.damageSystem(g, 'shields', 'damaged');   // toState, kein Tick davor
    const zz = z(g, 'shields'); const i = zz.indexOf('d'); idx.add(i);
    const KR = g.ship.komp.shields.filter((k) => k.t !== 'S').reduce((a, k) => a + k.n, 0);
    if (zz.split('d').length !== 2 || KR !== (i === 1 ? 0 : 1)) nOk = false;
    I.damageSystem(g, 'emitter_bow', 'broken');
    const e = g.ship.komp.emitter_bow;
    if (z(g, 'emitter_bow') !== 'dd' || e[0].n !== 1 || e[1].n !== 0 || g.ship.systems.emitter_bow !== 'broken') broken = false;
    korr += g.ship.kompKorrekturen | 0;
  }
  ok(idx.size === 3, 'damaged mit toState: der Ausfall verteilt sich zufällig über K, S, R (kompRng), nicht fest auf das Rezeptende ' + [...idx].join(','));
  ok(nOk, 'damaged mit toState: genau 1 defekt, Ausfallzähler zählt für K und R (nie für S)');
  ok(broken, 'broken mit toState am Emitter: 2 defekt, Relais zählt 1, Leitung 0');
  ok(korr === 0, 'Wächter hat dabei nie korrigiert (kompKorrekturen 0)');
  const ga = new Game({ noStore: true, seed: 9, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  ga.space.enemies = []; ga.space.projectiles = [];
  I.direktTreffer(ga, 'shields');
  ok((ga.ship.kompKorrekturen | 0) === 0 && K.defekteZahl(ga, 'shields') === 1, 'erster Treffer im frischen Spiel zählt keine Wächterkorrektur');
});

// ---------- TEC-01 B1: Reparatur je Komponente ----------
const WORLD = require('../server/world.js');
const DT = 1 / CONFIG.tickHz;
function lerche(seed) {   // Spiel in der Freien Fahrt mit einem Spieler (Hold-Tests laufen über onAct und Ticks)
  const g = new Game({ noStore: true, seed: seed || 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off' }, log: () => {} });
  const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'K0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  g.handleMessage(c, { t: 'ready', ready: true });
  const run = (sec) => { for (let k = 0; k < Math.round(sec / DT); k++) g.step(); };
  run(1); g.space.enemies = []; g.space.projectiles = [];
  for (const k of I.SYSTEM_ORDER) g.ship.systems[k] = 'ok';
  g.ship.fragile = {}; g.ship.offline = {}; g.ship.repairQueue = [];
  I.integritaetVoll(g); K.neuAufstellen(g);
  g.god = false;
  const notices = []; const notice0 = g.notice.bind(g); g.notice = (pp, m) => { notices.push(m); return notice0(pp, m); };
  return { g, p: g.players[0], c, run, notices };
}
const ankern = (g, p, sys) => { const st = WORLD.STATIONS.find((s) => s.system === sys); const c = WORLD.tileCenter(st.x, st.y); p.x = c.x; p.y = c.y; p.zone = 'ship'; p.console = null; p.hold = null; p.moving = false; p.input.mx = 0; p.input.my = 0; };
const zaehler = (g, sys, n, sp) => g.ship.komp[sys].forEach((k, i) => { if (n) k.n = n[i]; if (sp) k.sp = sp[i]; });
const nz = (g, sys) => g.ship.komp[sys].map((k) => k.n).join(',');
const spz = (g, sys) => g.ship.komp[sys].map((k) => k.sp).join(',');

section('B1: Flicken je Komponente (defekt -> geflickt, sp 0, Systemzustand abgeleitet)', () => {
  const g = newGame(60); K.konsistentAlle(g);
  for (const sys of KETTE) {
    const rez = K.rezept(g, sys);
    let alle = true; let detail = '';
    rez.forEach((t, i) => {
      const start = rez.map((_, j) => (j === i ? 'd' : 'o')).join('');
      setz(g, sys, start); zaehler(g, sys, rez.map(() => 2), rez.map(() => 4));
      const r = I.repairSystem(g, sys, 'player', 'flick', { komp: t });
      const erwartet = rez.map((_, j) => (j === i ? 'g' : 'o')).join('');
      const k = g.ship.komp[sys][i];
      if (!(r === true && z(g, sys) === erwartet && k.sp === 0 && k.n === 2 && g.ship.systems[sys] === 'ok' && I.isFragile(g, sys) && !g.ship.fragile[sys])) { alle = false; detail += ` ${sys}/${t}:${r}/${z(g, sys)}`; }
    });
    ok(alle, `${sys}: Flicken je Komponente (${rez.join('')}): geflickt, sp 0, n bleibt, System ok (1 defekt + Flicken), fragil abgeleitet, kein ship.fragile${detail}`);
  }
  setz(g, 'shields', 'ddo');
  I.repairSystem(g, 'shields', 'player', 'flick');
  ok(z(g, 'shields') === 'gdo' && g.ship.systems.shields === 'damaged' && I.integOf(g, 'shields') === I.integAusZustand(g, 'shields', 'damaged'), 'zerstörter Generator ddo: ein Flicken (Standard: erste defekte = K) -> gdo, damaged, Integrität = Grundwert damaged');
  I.repairSystem(g, 'shields', 'player', 'flick');
  ok(z(g, 'shields') === 'ggo' && g.ship.systems.shields === 'ok' && I.integOf(g, 'shields') === I.integMax(g, 'shields'), 'zweiter Flicken -> ggo, ok, Integrität Maximum');
  ok(I.repairSystem(g, 'shields', 'player', 'flick') === false && z(g, 'shields') === 'ggo', 'Flicken ohne defekte Komponente: abgewiesen, nichts ändert sich');
  const ev = []; const emit0 = g.emit.bind(g); g.emit = (nm, d) => { if (nm === 'repairDone') ev.push(d); return emit0(nm, d); };
  setz(g, 'emitter_aft', 'od');
  const rep0 = g.stats.repairs; const fl0 = g.stats.flicks | 0;
  I.repairSystem(g, 'emitter_aft', 'player', 'flick');
  ok(ev.length === 1 && ev[0].komp === 'L' && ev[0].how === 'flick' && ev[0].fragile === true && ev[0].state === 'ok' && g.stats.repairs === rep0 + 1 && (g.stats.flicks | 0) === fl0 + 1, 'repairDone trägt den Komponententyp (komp), Statistik zählt wie bisher');
  g.emit = emit0;
  ok((g.ship.kompKorrekturen | 0) === 0, 'Wächter hat bei den Reparaturen nie korrigiert (kompKorrekturen 0)');
});

section('B1: Tausch (nur diese Komponente, n 0, sp 0, Ersatzteil weg) per Hold', () => {
  const { g, p, run } = lerche(61);
  setz(g, 'shields', 'dgd'); zaehler(g, 'shields', [2, 0, 3], [1, 1, 1]);
  ankern(g, p, 'shields'); p.carry = 'ersatzteil'; I.onAct(g, p, true);
  ok(p.hold && p.hold.kind === 'swap' && p.hold.komp === 'K' && p.hold.system === 'shields', 'Tausch-Hold trägt die Zielkomponente (komp K = erste defekte)');
  run(3.3);
  ok(!p.hold && p.carry === null, 'Tausch fertig: Ersatzteil verbraucht');
  ok(z(g, 'shields') === 'ogd' && nz(g, 'shields') === '0,0,3' && spz(g, 'shields') === '0,1,1', 'nur der Steuerkern: ok, n 0, sp 0; geflickte S und defektes R unberührt');
  ok(g.ship.systems.shields === 'damaged', 'Systemzustand abgeleitet: ogd = damaged');
  I.onAct(g, p, false);
  // Tausch auf eine geflickte Komponente (Wunsch) und Standard ohne defekte
  setz(g, 'shields', 'gog'); zaehler(g, 'shields', [1, 0, 2], [3, 0, 3]);
  p.carry = 'ersatzteil'; ankern(g, p, 'shields'); p.carry = 'ersatzteil';
  I.onAct(g, p, true);
  ok(p.hold && p.hold.kind === 'swap' && p.hold.komp === 'K', 'ok + Flicken, Ersatzteil in der Hand: Tausch möglich, Standard = erste geflickte');
  run(3.3); I.onAct(g, p, false);
  ok(z(g, 'shields') === 'oog' && nz(g, 'shields') === '0,0,2' && spz(g, 'shields') === '0,0,3' && g.ship.systems.shields === 'ok' && I.isFragile(g, 'shields'), 'geflickte K getauscht: ok, n 0, sp 0; R bleibt geflickt (System ok, fragil)');
  p.carry = 'ersatzteil'; ankern(g, p, 'shields'); p.carry = 'ersatzteil'; I.onAct(g, p, true, 'R');
  run(3.3); I.onAct(g, p, false);
  ok(z(g, 'shields') === 'ooo' && !I.isFragile(g, 'shields') && I.repairable(g, 'shields') === false, 'Wunsch R: zweiter Tausch, nichts mehr geflickt, nicht mehr reparierbar');
});

section('B1: zerstörter Generator braucht zwei Tausche', () => {
  const g = newGame(62); K.konsistentAlle(g);
  setz(g, 'shields', 'ddo');
  I.repairSystem(g, 'shields', 'player', 'swap');
  ok(z(g, 'shields') === 'odo' && g.ship.systems.shields === 'damaged' && I.integOf(g, 'shields') === I.integAusZustand(g, 'shields', 'damaged'), 'erster Tausch: broken -> damaged (odo), Integrität Grundwert damaged');
  I.repairSystem(g, 'shields', 'player', 'swap');
  ok(z(g, 'shields') === 'ooo' && g.ship.systems.shields === 'ok' && I.integOf(g, 'shields') === I.integMax(g, 'shields'), 'zweiter Tausch: ok');
  ok(I.repairSystem(g, 'shields', 'player', 'swap') === false, 'dritter Tausch auf ein heiles System: abgewiesen');
  setz(g, 'emitter_port', 'dd');
  I.repairSystem(g, 'emitter_port', 'player', 'swap', { komp: 'L' });
  ok(z(g, 'emitter_port') === 'do' && g.ship.systems.emitter_port === 'damaged', 'Emitter dd, Tausch mit Wunsch L: nur die Leitung ok');
  ok((g.ship.kompKorrekturen | 0) === 0, 'kompKorrekturen bleibt 0');
});

section('B1: Ausfallzähler n >= 3 sperrt das Relais-Minispiel, Flicken und Tausch gehen', () => {
  const { g, p, run } = lerche(63);
  setz(g, 'emitter_bow', 'do'); zaehler(g, 'emitter_bow', [3, 0], [2, 0]);
  ankern(g, p, 'emitter_bow');
  const e = I.repairCmd(g, p, 'repair.start', { system: 'emitter_bow' });
  ok(e === 'Relais verschlissen: nur noch Flicken oder Tausch.' && !p.hold, 'n = 3: Minispiel abgewiesen mit Hinweis, kein Hold');
  zaehler(g, 'emitter_bow', [2, 0]);
  ok(I.repairCmd(g, p, 'repair.start', { system: 'emitter_bow' }) === null && p.hold && p.hold.kind === 'minigame' && p.hold.komp === 'R', 'n = 2: Minispiel startet, Hold trägt komp R');
  p.hold = null; zaehler(g, 'emitter_bow', [3, 0]);
  I.onAct(g, p, true); run(1.6); I.onAct(g, p, false);
  ok(z(g, 'emitter_bow') === 'go' && g.ship.komp.emitter_bow[0].sp === 0 && g.ship.komp.emitter_bow[0].n === 3, 'Flicken geht bei n = 3 (n bleibt 3, sp 0)');
  p.hold = null;
  ok(I.repairCmd(g, p, 'repair.start', { system: 'emitter_bow' }) === 'Relais verschlissen: nur noch Flicken oder Tausch.', 'geflicktes Relais bei n = 3: Minispiel bleibt gesperrt');
  p.carry = 'ersatzteil'; I.onAct(g, p, true); run(3.3); I.onAct(g, p, false);
  ok(z(g, 'emitter_bow') === 'oo' && g.ship.komp.emitter_bow[0].n === 0, 'Tausch bei n = 3: Relais ok, n 0 (wieder reparierbar)');
  // Steuerkern: kein Minispiel, Flicken und Tausch gehen
  const q = lerche(64); const g2 = q.g;
  setz(g2, 'shields', 'doo'); zaehler(g2, 'shields', [4, 0, 0]);
  ankern(g2, q.p, 'shields');
  ok(I.repairCmd(g2, q.p, 'repair.start', { system: 'shields' }) === 'Relais ist heil.' && !q.p.hold, 'Steuerkern defekt, Relais heil: Minispiel abgewiesen (Relais ist heil)');
  ok(I.repairCmd(g2, q.p, 'repair.start', { system: 'shields', komp: 'K' }) === 'Steuerkern hat kein Minispiel: E halten zum Flicken oder Tauschen.', 'Wunsch K beim Minispiel: Hinweis, K hat keins');
  I.onAct(g2, q.p, true); q.run(1.6); I.onAct(g2, q.p, false);
  ok(z(g2, 'shields') === 'goo' && g2.ship.komp.shields[0].n === 4, 'Steuerkern n = 4: Flicken geht');
  setz(g2, 'shields', 'doo'); zaehler(g2, 'shields', [4, 0, 0]);
  q.p.carry = 'ersatzteil'; ankern(g2, q.p, 'shields'); q.p.carry = 'ersatzteil'; I.onAct(g2, q.p, true); q.run(3.3); I.onAct(g2, q.p, false);
  ok(z(g2, 'shields') === 'ooo' && g2.ship.komp.shields[0].n === 0, 'Steuerkern n = 4: Tausch geht, n 0');
});

section('B1: Relais-Minispiel repariert nur R und lehnt K, S, L ab', () => {
  const { g, p, run } = lerche(65);
  setz(g, 'shields', 'dod'); zaehler(g, 'shields', [1, 0, 1], [2, 0, 2]);
  ankern(g, p, 'shields');
  ok(I.repairCmd(g, p, 'repair.start', { system: 'shields' }) === null && p.hold && p.hold.kind === 'minigame' && p.hold.komp === 'R', 'Generator K und R defekt: Minispiel bindet an R');
  run(3);
  ok(I.repairCmd(g, p, 'repair.done', { system: 'shields', errors: 0 }) === null && z(g, 'shields') === 'doo', 'Minispiel gelungen: R ok (kein Flicken), K bleibt defekt');
  ok(g.ship.komp.shields[2].n === 1 && g.ship.komp.shields[2].sp === 0 && g.ship.komp.shields[0].sp === 2, 'n des Relais bleibt, sp des Relais 0, K unberührt');
  ok(I.repairCmd(g, p, 'repair.start', { system: 'shields' }) === 'Relais ist heil.', 'nur K defekt: Minispiel abgewiesen');
  setz(g, 'shields', 'odo');
  ok(I.repairCmd(g, p, 'repair.start', { system: 'shields' }) === 'Relais ist heil.', 'nur S defekt: abgewiesen');
  setz(g, 'emitter_bow', 'od'); ankern(g, p, 'emitter_bow');
  ok(I.repairCmd(g, p, 'repair.start', { system: 'emitter_bow' }) === 'Relais ist heil.' && !p.hold, 'Emitter: nur die Leitung defekt: abgewiesen');
  ok(I.repairCmd(g, p, 'repair.start', { system: 'emitter_bow', komp: 'L' }) === 'Leitung hat kein Minispiel: E halten zum Flicken oder Tauschen.', 'Wunsch L: Hinweis');
  setz(g, 'emitter_bow', 'oo');
  ok(I.repairCmd(g, p, 'repair.start', { system: 'emitter_bow' }) === 'Emitter Bug ist heil.' || /ist heil/.test(I.repairCmd(g, p, 'repair.start', { system: 'emitter_bow' }) || ''), 'heiles System: "ist heil"');
  setz(g, 'emitter_bow', 'gg'); zaehler(g, 'emitter_bow', [1, 0]);
  ok(I.repairCmd(g, p, 'repair.start', { system: 'emitter_bow' }) === null && p.hold.komp === 'R', 'geflicktes Relais: Minispiel startet (macht es ok)');
  run(3); I.repairCmd(g, p, 'repair.done', { system: 'emitter_bow', errors: 0 });
  ok(z(g, 'emitter_bow') === 'og' && g.ship.systems.emitter_bow === 'ok' && I.isFragile(g, 'emitter_bow'), 'Minispiel macht das geflickte Relais ok; die geflickte Leitung bleibt');
  I.damageSystem(g, 'engines', 'damaged', { quiet: true }); ankern(g, p, 'engines');
  ok(I.repairCmd(g, p, 'repair.start', { system: 'engines' }) === null && p.hold && p.hold.kind === 'minigame' && p.hold.komp === undefined, 'Nicht-Schildkette: Minispiel wie bisher (kein komp)');
  p.hold = null;
  ok((g.ship.kompKorrekturen | 0) === 0, 'kompKorrekturen bleibt 0');
});

section('B1: Komponentenwunsch gültig / ungültig', () => {
  const { g, p, c, run, notices } = lerche(66);
  setz(g, 'shields', 'dod'); ankern(g, p, 'shields');
  I.onAct(g, p, true, 'S');
  ok(!p.hold && notices.some((m) => /Spannungsregler ist nicht defekt/.test(m)), 'Flicken-Wunsch S (heil): Hinweis, kein Hold');
  I.onAct(g, p, false); notices.length = 0;
  I.onAct(g, p, true, 'D');
  ok(p.hold && p.hold.kind === 'flick' && p.hold.komp === 'K', 'Wunsch D (nicht im Rezept): ignoriert, Standard (erste defekte = K)');
  I.onAct(g, p, false);
  I.onAct(g, p, true, 'K');
  ok(p.hold && p.hold.komp === 'K', 'Wunsch K (defekt): Hold auf K');
  I.onAct(g, p, false);
  setz(g, 'shields', 'ddo'); ankern(g, p, 'shields');
  I.onAct(g, p, true, 'R');
  ok(!p.hold && notices.some((m) => /Relais ist nicht defekt/.test(m)), 'Wunsch R (heil): Hinweis');
  I.onAct(g, p, false);
  setz(g, 'shields', 'dod'); ankern(g, p, 'shields');
  I.onAct(g, p, true, 'R');
  ok(p.hold && p.hold.komp === 'R', 'Wunsch R bei defektem K und R: Hold auf R (nicht auf die erste defekte)');
  run(1.6); I.onAct(g, p, false);
  ok(z(g, 'shields') === 'dog', 'Flicken traf R, nicht K');
  notices.length = 0; p.carry = 'ersatzteil'; ankern(g, p, 'shields'); p.carry = 'ersatzteil';
  I.onAct(g, p, true, 'S');
  ok(!p.hold && notices.some((m) => /Spannungsregler ist heil/.test(m)) && p.carry === 'ersatzteil', 'Tausch-Wunsch auf eine heile Komponente: Hinweis, Ersatzteil bleibt in der Hand');
  I.onAct(g, p, false);
  // über die Nachricht des Protokolls
  p.carry = null; setz(g, 'shields', 'dod'); ankern(g, p, 'shields');
  g.handleMessage(c, { t: 'act', down: true, komp: 'R' });
  ok(p.hold && p.hold.kind === 'flick' && p.hold.komp === 'R', 'Nachricht {t:"act", down:true, komp:"R"} setzt den Wunsch');
  g.handleMessage(c, { t: 'act', down: false });
  g.handleMessage(c, { t: 'act', down: true, komp: 42 });
  ok(p.hold && p.hold.komp === 'K', 'Nachricht mit unbrauchbarem komp: Standard');
  g.handleMessage(c, { t: 'act', down: false });
  // Reparaturwunsch bei Nicht-Schildkette bleibt wirkungslos
  I.damageSystem(g, 'engines', 'damaged', { quiet: true }); ankern(g, p, 'engines');
  I.onAct(g, p, true, 'R');
  ok(p.hold && p.hold.kind === 'flick' && p.hold.komp === undefined, 'Nicht-Schildkette ignoriert den Wunsch');
  I.onAct(g, p, false);
});

section('B1: holdValid und Ende prüfen die Zielkomponente', () => {
  const { g, p, run } = lerche(67);
  setz(g, 'shields', 'ddo'); ankern(g, p, 'shields'); I.onAct(g, p, true, 'K');
  run(0.5);
  ok(p.hold && p.hold.komp === 'K', 'Flicken auf K läuft');
  K.flickenKomponente(g, 'shields', 'K');   // jemand anderes war schneller
  run(0.1);
  ok(!p.hold, 'Zielkomponente nicht mehr defekt: Abbruch während des Haltens');
  I.onAct(g, p, false);
  // Flicken auf R, während K getauscht wird: R weiter defekt, Halten geht weiter
  setz(g, 'shields', 'dod'); ankern(g, p, 'shields'); I.onAct(g, p, true, 'R'); run(0.5);
  K.tauschenKomponente(g, 'shields', 'K');
  run(1.2);
  ok(z(g, 'shields') === 'oog' && !p.hold, 'andere Komponente geändert: Halten läuft weiter und endet auf der gewählten (R)');
  I.onAct(g, p, false);
  // Tausch einer geflickten Komponente: ein Treffer bricht den Flicken (defekt) während des Tauschens -> weiter gültig
  setz(g, 'shields', 'goo'); zaehler(g, 'shields', [1, 0, 0]);
  p.carry = 'ersatzteil'; ankern(g, p, 'shields'); p.carry = 'ersatzteil'; I.onAct(g, p, true);
  run(1);
  K.setzeKomponente(g, 'shields', 0, 'defekt');   // Treffer bricht den Flicken
  run(0.1);
  ok(p.hold && p.hold.kind === 'swap', 'Treffer bricht den Flicken der Zielkomponente: Tausch läuft weiter (defekt ist tauschbar)');
  run(2.3);
  ok(!p.hold && z(g, 'shields') === 'ooo' && g.ship.komp.shields[0].n === 0, 'Tausch endet: K ok, n 0');
  I.onAct(g, p, false);
  // Tausch, die Komponente wird inzwischen anders getauscht -> Abbruch
  setz(g, 'shields', 'doo'); p.carry = 'ersatzteil'; ankern(g, p, 'shields'); p.carry = 'ersatzteil'; I.onAct(g, p, true); run(1);
  K.tauschenKomponente(g, 'shields', 'K'); run(0.1);
  ok(!p.hold && p.carry === 'ersatzteil', 'Tausch: Zielkomponente inzwischen heil: Abbruch, Ersatzteil bleibt in der Hand');
  I.onAct(g, p, false);
  // Minispiel: Relais wird währenddessen getauscht -> Abbruch
  setz(g, 'emitter_bow', 'do'); ankern(g, p, 'emitter_bow');
  I.repairCmd(g, p, 'repair.start', { system: 'emitter_bow' }); run(0.3);
  ok(p.hold && p.hold.kind === 'minigame', 'Minispiel läuft');
  K.tauschenKomponente(g, 'emitter_bow', 'R'); run(0.1);
  ok(!p.hold, 'Minispiel: Relais inzwischen heil: Abbruch');
  // Ende: repair.done nach einem Tausch des Relais ändert nichts
  setz(g, 'emitter_bow', 'do'); I.repairCmd(g, p, 'repair.start', { system: 'emitter_bow' }); run(3);
  const hold = p.hold; K.flickenKomponente(g, 'emitter_bow', 'R'); K.tauschenKomponente(g, 'emitter_bow', 'R');
  p.hold = hold;   // der Hold wäre schon gefallen; das Ende selbst muss ebenfalls prüfen
  I.repairCmd(g, p, 'repair.done', { system: 'emitter_bow', errors: 0 });
  ok(z(g, 'emitter_bow') === 'oo' && g.ship.komp.emitter_bow[0].n === 0, 'Ende prüft erneut: nichts doppelt gezählt');
  // Sturm-Sperre gilt weiter (system-bezogen)
  setz(g, 'shields', 'ddo'); ankern(g, p, 'shields'); I.onAct(g, p, true); run(0.7);
  I.reparaturSperren(g, I.systemSector('shields'), 6);
  ok(p.hold && p.hold.t === 0, 'Sturm-Sperre setzt den Fortschritt des Holds auf 0 (unverändert)');
  I.onAct(g, p, false);
});

section('B1: Notreparatur durch ODA, Altweg bot, repairQueue', () => {
  const { g, p } = lerche(68);
  setz(g, 'shields', 'ddo'); zaehler(g, 'shields', [2, 0, 0]);
  g.inventory.ersatzteil = 0; p.carry = null; g.ship.groundItems = [];
  const rep0 = g.stats.repairs;
  I.updateHazards(g, g.C.emergencyRepair.brokenDelay + 1);
  ok(z(g, 'shields') === 'gdo' && g.ship.systems.shields === 'damaged' && g.stats.repairs === rep0 && I.isFragile(g, 'shields'), 'ODA-Notreparatur: ein Flicken auf die erste defekte (K), System beschädigt, n bleibt');
  ok(g.ship.komp.shields[0].n === 2, 'Notreparatur zählt n nicht');
  setz(g, 'shields', 'ddd'); zaehler(g, 'shields', [1, 0, 2], [3, 3, 3]);
  I.repairSystem(g, 'shields', 'bot');
  ok(z(g, 'shields') === 'gdd' && g.ship.komp.shields[0].n === 1 && g.ship.komp.shields[0].sp === 0 && I.isFragile(g, 'shields'), "TEC-01 E: der Altweg how 'bot' ist für die Schildkette entfallen (er umging die Sperre n >= 3): wie Flicken, erste defekte -> geflickt, n unverändert");
  I.repairSystem(g, 'shields', 'bot', 'flick');
  ok(z(g, 'shields') === 'ggd', "Bot-Flicken ('flick'): erste defekte -> geflickt");
  I.repairSystem(g, 'shields', 'bot', 'swap');
  ok(z(g, 'shields') === 'ggo' && g.ship.komp.shields[2].n === 0, "Bot-Tausch ('swap'): erste defekte (R) -> ok, n 0");
  // repairQueue / pruneRepairQueue: ein Eintrag bleibt, solange ein Flicken sitzt
  setz(g, 'shields', 'goo');
  g.ship.repairQueue = [{ system: 'shields', mode: 'part', bot: null }];
  I.pruneRepairQueue(g);
  ok(g.ship.repairQueue.length === 1, 'pruneRepairQueue: ok + Flicken (fragil abgeleitet) bleibt in der Liste');
  I.repairSystem(g, 'shields', 'player', 'swap');
  ok(g.ship.repairQueue.length === 0 && z(g, 'shields') === 'ooo', 'Tausch der letzten Flicken: Eintrag fällt weg');
  const sn = g.snapshot();
  setz(g, 'emitter_stbd', 'og');
  const sn2 = g.snapshot();
  ok(Array.isArray(sn2.ship.fragile) && sn2.ship.fragile.includes('emitter_stbd') && !sn.ship.fragile.includes('shields'), 'Snapshot-Feld fragile: abgeleitet aus den geflickten Komponenten');
  g.ship.fragile.shields = true;   // Altlast-Flag
  ok(!I.isFragile(g, 'shields') && !I.fragileSystems(g).includes('shields'), 'Altlast-Flag auf einem Schildkette-System zählt nicht');
});

section('B1: Nicht-Schildkette und Reaktor behalten das alte System-Flicken', () => {
  const g = newGame(69); K.konsistentAlle(g);
  I.damageSystem(g, 'engines', 'damaged', { quiet: true });
  I.repairSystem(g, 'engines', 'player', 'flick');
  ok(g.ship.systems.engines === 'ok' && g.ship.fragile.engines === true && I.isFragile(g, 'engines'), 'engines: Flicken = ok + fragil (ship.fragile)');
  I.repairSystem(g, 'engines', 'player', 'swap');
  ok(g.ship.systems.engines === 'ok' && !g.ship.fragile.engines, 'engines: Tausch räumt fragil');
  I.damageSystem(g, 'engines', 'broken', { quiet: true });
  I.repairSystem(g, 'engines', 'player', 'swap');
  ok(g.ship.systems.engines === 'ok', 'engines broken: ein Tausch heilt das ganze System wie bisher');
  I.damageSystem(g, 'reactor', 'damaged', { quiet: true });
  I.repairSystem(g, 'reactor', 'player', 'flick');
  ok(g.ship.systems.reactor === 'ok' && g.ship.fragile.reactor === true, 'Reaktor: Flicken = ok + fragil wie bisher');
  I.repairSystem(g, 'reactor', 'player', 'minigame');
  ok(g.ship.systems.reactor === 'ok' && !g.ship.fragile.reactor, 'Reaktor: Minispiel räumt fragil');
  ok(I.fragileSystems(g).length === 0, 'fragileSystems: leer');
  g.ship.fragile.weapon_bow = true;
  ok(I.fragileSystems(g).join() === 'weapon_bow', 'fragileSystems: Altflag der Nicht-Schildkette zählt');
});

section('B1: Weltstand mit geflickter Komponente', () => {
  const g = newGame(70); K.konsistentAlle(g);
  setz(g, 'shields', 'gog'); zaehler(g, 'shields', [0, 0, 2], [3, 0, 1]);
  const d = Weltstand.capture(g);
  ok(d.schiff.systeme.shields === 'ok' && d.schiff.komp && d.schiff.komp.shields === 'gog;0,0,2;3,0,1', 'ok + 2 Flicken: als ok gespeichert, Block mit Flicken und Zählern (' + (d.schiff.komp && d.schiff.komp.shields) + ')');
  const dv = JSON.parse(JSON.stringify(d)); dv.id = 'test'; dv.name = 'Test';
  ok(!(Weltstand.validate(dv) || []).length, 'Schema-Prüfung');
  const g2 = newGame(71); Weltstand.apply(g2, JSON.parse(JSON.stringify(d)));
  ok(g2.ship.systems.shields === 'ok' && z(g2, 'shields') === 'gog' && I.isFragile(g2, 'shields') && g2.ship.komp.shields[2].n === 2 && g2.ship.komp.shields[0].sp === 3, 'laden: ok, geflickte Komponenten, Zähler');
  ok(!(g2.ship.fragile && g2.ship.fragile.shields), 'laden: kein ship.fragile für die Schildkette');
  ok((g2.ship.kompKorrekturen | 0) === 0, 'laden: kein Wächter-Eingriff');
  const d2 = Weltstand.capture(g2);
  ok(JSON.stringify(d2.schiff.komp) === JSON.stringify(d.schiff.komp) && d2.schiff.systeme.shields === 'ok', 'Rundlauf stabil');
  // geflickt + 1 defekt: damaged
  setz(g, 'shields', 'gdo');
  const d3 = Weltstand.capture(g);
  ok(d3.schiff.systeme.shields === 'damaged' && d3.schiff.komp && d3.schiff.komp.shields.startsWith('gdo'), 'geflickt + defekt: damaged mit Block gdo');
  const g3 = newGame(72); Weltstand.apply(g3, JSON.parse(JSON.stringify(d3)));
  ok(z(g3, 'shields') === 'gdo' && g3.ship.systems.shields === 'damaged', 'laden: gdo, damaged');
  // Nicht-Schildkette: fragile wird weiter als damaged gespeichert
  const g4 = newGame(73); K.konsistentAlle(g4); g4.ship.fragile.engines = true;
  ok(Weltstand.capture(g4).schiff.systeme.engines === 'damaged', 'engines fragil: weiter als damaged gespeichert');
});

section('B1: sauberer Reparaturpfad ohne Wächterkorrektur', () => {
  const { g, p, run } = lerche(74);
  for (let i = 0; i < 6; i++) {
    for (const sys of KETTE) I.damageSystem(g, sys, 'broken', { quiet: true });
    for (const sys of KETTE) {
      I.repairSystem(g, sys, 'player', 'flick'); I.repairSystem(g, sys, 'player', 'swap'); I.repairSystem(g, sys, 'bot', 'flick'); I.repairSystem(g, sys, 'bot'); I.repairSystem(g, sys, 'player', 'minigame');
      I.repairSystem(g, sys, 'player', 'swap'); I.repairSystem(g, sys, 'player', 'swap');
      I.repairable(g, sys); I.isFragile(g, sys);
    }
    run(0.1);
  }
  ok((g.ship.kompKorrekturen | 0) === 0, 'sechs Runden Schaden und Reparatur auf der ganzen Kette: kompKorrekturen ' + (g.ship.kompKorrekturen | 0));
  ok(KETTE.every((s) => z(g, s).split('').every((c) => 'og'.includes(c) || c === 'd') && g.ship.systems[s] === K.abgeleitet(g, s)), 'Systemzustand folgt immer den Komponenten');
});

// ---------- TEC-01 Endreview ----------
section('Endreview M3: Hold bricht ab, wenn Ersatzteil weg ist oder die gewählte Komponente nicht mehr Ziel ist', () => {
  const a = lerche(81);
  setz(a.g, 'shields', 'odo'); ankern(a.g, a.p, 'shields'); a.p.carry = 'ersatzteil';
  I.onAct(a.g, a.p, true);
  ok(a.p.hold && a.p.hold.kind === 'swap', 'Tausch-Hold läuft mit Ersatzteil in der Hand');
  a.p.carry = null; a.run(0.3);
  ok(!a.p.hold && z(a.g, 'shields') === 'odo', 'Ersatzteil nicht mehr in der Hand: Hold bricht ab, nichts getauscht (Ersatzteil ist Voraussetzung)');
  const b = lerche(82);
  setz(b.g, 'shields', 'ddo'); ankern(b.g, b.p, 'shields');
  I.onAct(b.g, b.p, true, 'S');
  ok(b.p.hold && b.p.hold.kind === 'flick' && b.p.hold.komp === 'S', 'Flick-Hold mit Wunsch S (K und S defekt)');
  b.g.ship.komp.shields[1].z = 'geflickt'; K.synchronisieren(b.g, 'shields');   // S ist inzwischen geflickt, K weiter defekt: der Hold auf S hat kein Ziel mehr
  b.run(0.3);
  ok(!b.p.hold && z(b.g, 'shields') === 'dgo', 'gewählte Komponente nicht mehr Ziel: Hold bricht ab, die andere defekte (K) wird nicht stillschweigend geflickt: ' + z(b.g, 'shields'));
  I.onAct(b.g, b.p, false);
});

section('Endreview M4: kaputter Komponentenblock macht den Weltstand nicht unladbar (echter Lade-Pfad: Datei -> Weltstand.load mit Schema-Prüfung)', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-komp-m4-'));
  const g = newGame(70); K.konsistentAlle(g);
  setz(g, 'shields', 'ddo'); g.ship.komp.shields[1].n = 2;
  const basis = Weltstand.capture(g); basis.id = 'tecm4-test'; basis.name = 'Test';
  ok(basis.schiff.komp && basis.schiff.komp.shields === 'ddo;0,2,0;0,0,0', 'Ausgangsstand: guter Block ' + JSON.stringify(basis.schiff.komp));
  const laden = (komp, wie) => {
    const d = JSON.parse(JSON.stringify(basis));
    if (komp === undefined) delete d.schiff.komp; else d.schiff.komp = komp;
    fs.writeFileSync(path.join(dir, 'tecm4-test.json'), JSON.stringify(d));
    const r = Weltstand.load(dir, 'tecm4-test', newGame(71));
    ok(r.ok && !r.fromBak, wie + ': Weltstand lädt (Schema lehnt nicht ab) ' + (r.ok ? '' : JSON.stringify(r).slice(0, 160)));
    if (!r.ok) return null;
    const g2 = newGame(72);
    Weltstand.apply(g2, r.data);
    return g2;
  };
  const ausZustand = (g2, wie) => ok(g2 && g2.ship.systems.shields === 'broken' && z(g2, 'shields') === 'odd' && nz(g2, 'shields') === '0,0,0' && spz(g2, 'shields') === '0,0,0' && KETTE.every((s) => g2.ship.komp[s].length === K.rezept(g2, s).length), wie + ': Komponenten aus dem Systemzustand, Zähler 0');
  const gut = laden(basis.schiff.komp, 'guter Block');
  ok(gut && z(gut, 'shields') === 'ddo' && nz(gut, 'shields') === '0,2,0', 'guter Block: Zähler und Zustände übernommen');
  ausZustand(laden({ shields: 'zz' }, 'kaputter Code'), 'kaputter Code');
  ausZustand(laden({ shields: 'o'.repeat(500) + ';1;1' }, 'Überlänge'), 'Überlänge');
  ausZustand(laden({ shields: 5, emitter_bow: null }, 'falscher Typ der Werte (Zahl, null)'), 'falscher Typ der Werte');
  ausZustand(laden(5, 'Block als Zahl'), 'Block als Zahl');
  ausZustand(laden(['ddo'], 'Block als Array'), 'Block als Array');
  ausZustand(laden('ddo;0,2,0;0,0,0', 'Block als Text'), 'Block als Text');
  ausZustand(laden({ shields: 'ddo;0,10000,0;0,0,0' }, 'Zähler über 9999'), 'Zähler über 9999');
  ausZustand(laden({ shields: 'ddo;0,2;0,0,0' }, 'Zählerliste zu kurz'), 'Zählerliste zu kurz');
  ausZustand(laden({ shields: 'dd' }, 'Code zu kurz für das Rezept'), 'Code zu kurz');
  ausZustand(laden({ shields: 'ddo;0,-2,0;0,0,0' }, 'negativer Zähler'), 'negativer Zähler');
  const unb = laden({ unbekannt: 'oo', shields: 'ddo;0,2,0;0,0,0', toString: 'x' }, 'unbekanntes System');
  ok(unb && !('unbekannt' in unb.ship.komp) && z(unb, 'shields') === 'ddo' && nz(unb, 'shields') === '0,2,0', 'unbekanntes System ignoriert, bekanntes übernommen');
  const wid = laden({ shields: 'ooo;0,2,0;0,0,0' }, 'Code widerspricht dem Systemzustand');
  ok(wid && z(wid, 'shields') === 'odd' && nz(wid, 'shields') === '0,2,0', 'Codes widersprechen dem Zustand: Zustand gilt, Zähler bleiben');
  const kein = laden(undefined, 'Altstand ohne Block');
  ausZustand(kein, 'Altstand ohne Block');
  ok(KETTE.every((s) => !gut.ship.komp[s].some((k) => !['ok', 'defekt', 'geflickt'].includes(k.z))), 'kein ungültiger Komponentenzustand nach dem Laden');
  // Speichern-Pfad: Schema-Prüfung beim Speichern (capture + validate) nimmt den guten Block an
  ok(!(Weltstand.validate(JSON.parse(JSON.stringify(basis))) || []).length, 'Speichern-Pfad: Schema nimmt den erfassten Block an');
  ok(!Weltstand.fallbackValidate(JSON.parse(JSON.stringify(basis)), Weltstand.schema()).length, 'eigener Schema-Prüfer (Rückfall) nimmt den Stand mit Block an');
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* egal */ }
});

section('Endreview N2: lesende Zugriffe (lage, Plan, minispielMoeglich) ohne Nebenwirkung', () => {
  const Plan = require('../server/sim/komponenten-plan.js');
  const tief = (o) => JSON.stringify(o);
  const g = newGame(73); K.konsistentAlle(g);
  setz(g, 'shields', 'ddo'); g.ship.komp.shields[2].n = 1;
  g.ship.systems.shields = 'damaged';   // direkt geschrieben: widerspricht den Komponenten (zwei defekt); der Wächter würde nachziehen
  g.ship.komp.emitter_bow = null;       // fehlt ganz
  delete g.ship.kompKorrekturen;
  const vorher = tief(g.ship.komp), kk = g.ship.kompKorrekturen | 0;
  const l = K.lage(g, 'shields');
  ok(l && l.map((k) => k.z[0]).join('') === 'ood' && l[2].n === 1, 'lage folgt dem geschriebenen Systemzustand (damaged = 1 defekt), Zähler bleiben: ' + (l && l.map((k) => k.z[0] + k.n).join(',')));
  const le = K.lage(g, 'emitter_bow');
  ok(le && le.length === 2 && le.every((k) => k.z === 'ok'), 'fehlende Liste: Berechnung aus dem Zustand');
  Plan.reparaturPlan(g, 'shields', { druck: false, ersatzteile: 2, minispiel: true }); Plan.reparaturPlan(g, 'emitter_bow', { druck: true });
  Plan.wunschZulaessig(g, 'shields', 'flick', 'S'); Plan.kontextFuer(g, 'shields', {}); K.minispielMoeglich(g, 'shields'); K.minispielMoeglich(g, 'emitter_bow');
  ok(tief(g.ship.komp) === vorher && (g.ship.kompKorrekturen | 0) === kk && g.ship.komp.emitter_bow === null, 'lage/Plan/minispielMoeglich: ship.komp und kompKorrekturen unverändert (Deep-Equal)');
  ok(K.lage(g, 'reactor') === null && Plan.reparaturPlan(g, 'reactor', {}) === null, 'System ohne Rezept: null');
  // schreibende Wege ziehen den Wächter weiter nach
  K.reparaturZiel(g, 'shields', 'flick');
  ok((g.ship.kompKorrekturen | 0) === kk + 1 && z(g, 'shields') === 'ood', 'reparaturZiel (schreibend) zieht den Wächter nach');
});

section('Endreview N5: Haltezeiten nach oben UND unten geprüft (Flicken 1,5 s, Tausch 3 s aus spaceM3.repair)', () => {
  const RC = CONFIG.spaceM3.repair;
  ok(RC.flickTime === 1.5 && RC.partTime === 3, 'Konfig spaceM3.repair: flickTime 1,5 / partTime 3');
  const probe = (wie, aktion, codes, sek) => {
    const { g, p, run } = lerche(80);
    setz(g, 'shields', codes); ankern(g, p, 'shields'); if (aktion === 'swap') p.carry = 'ersatzteil';
    I.onAct(g, p, true);
    ok(p.hold && p.hold.kind === aktion, wie + ': Hold läuft an');
    run(sek - 0.1);
    ok(p.hold && p.hold.kind === aktion && z(g, 'shields') === codes, wie + ': nach ' + (sek - 0.1).toFixed(1) + ' s noch nicht fertig (Hold aktiv, Zustand unverändert)');
    run(0.1 + 2 * DT);
    ok(!p.hold && z(g, 'shields') !== codes, wie + ': nach ' + sek + ' s + 2 Ticks fertig');
    I.onAct(g, p, false);
  };
  probe('Flicken', 'flick', 'odo', RC.flickTime);
  probe('Tausch', 'swap', 'odo', RC.partTime);
});

section('Endreview N1/N3: eine Quelle, kein Drift zwischen Konfig und Standardwerten', () => {
  const F = require('../shared/komponenten-format.js');
  const KD = CONFIG.systemModell.komponenten;
  ok(KD.sprungBruch && KD.sprungBruch.grund === F.BRUCH_GRUND && KD.sprungBruch.proSprung === F.BRUCH_PRO_SPRUNG, 'Konfig sprungBruch = Standardwerte des Format-Moduls (' + JSON.stringify(KD.sprungBruch) + ')');
  ok(KD.ausfallSperre === F.AUSFALL_SPERRE && F.sperreVon(KD) === F.sperreVon({}), 'Konfig ausfallSperre = Standard des Format-Moduls');
  ok([0, 1, 4, 9].every((sp) => F.bruchChance(sp, KD) === F.bruchChance(sp, {})), 'bruchChance mit Konfig = bruchChance mit Standards');
  const lies = (f) => require('fs').readFileSync(require('path').join(__dirname, '..', f), 'utf8');
  ok(!/ZAEHLT_AUSFALL/.test(lies('server/sim/komponenten.js')) && /F\.hatZaehler\(/.test(lies('server/sim/komponenten.js')), 'komponenten.js nutzt F.hatZaehler statt einer zweiten Liste');
  ok(/F\.zulaessigeZiele\(/.test(lies('server/sim/komponenten-plan.js')) && !require('../server/sim/komponenten-plan.js').TEILE_RESERVE, 'Plan: wunschZulaessig nutzt F.zulaessigeZiele; TEILE_RESERVE nicht mehr exportiert');
  const g = newGame(74); K.konsistentAlle(g);
  for (const [st, codes] of [['ok', 'ooo'], ['damaged', 'ood'], ['broken', 'odd']]) { I.setzeZustand(g, 'shields', st); ok(F.kodiere(F.ausZustand(K.rezept(g, 'shields'), st)) === codes && z(g, 'shields') === codes, 'Standard aus dem Zustand ' + st + ' = ' + codes + ' (Server = Format-Modul)'); }
});

console.log(`\n${n - fails}/${n} Prüfungen grün${fails ? ', ' + fails + ' FEHLER' : ''}`);
process.exit(fails ? 1 : 0);
