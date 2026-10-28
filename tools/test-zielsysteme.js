'use strict';
// SUND-04a-1 A, umgestellt auf SYS-01 C1b-1 „Zielsysteme im Zonenmodell“: Gezielter Systemtreffer mit gleichen Regeln für beide Seiten
// (server/sim/zielsysteme.js, server/sim/gegnersystem.js, Daten content/kampf/zielsysteme-werte.json). e.zs entfällt: der Antrieb ist e.sys.antrieb.
// Die neuen Regeln (Zone, Erreichbarkeit, Wahl statt Zufall, Sperre, Immunität, Zonen-Lerche) stehen in tools/test-zielsysteme-zonen.js.
//  - Daten: Systeme als Katalog, Seiten, Stufen (ohne Erholung), Sperre
//  - Wahl (weapons.systemziel): jede System-Id des Ziels, Erreichbarkeit bei der Wahl
//  - Trefferregel Lerche -> Gegner: Schild durchschlagen und Zone des Ziels, Wahl statt Zufall, Sperre
//  - Wirkung auf die Fahrt in allen drei Flugwegen (Pilot, kinematisch, Konvoi), mit Messung vorher/nachher
//  - Gegenseite: Gegner -> Lerche mit derselben Regel (ship.systems.engines)
//  - Ohne Systemziel/Schalter bleibt alles beim Alten (kein tempoAn, kein Snapshot-Feld, keine Zufallsnutzung)
//   node tools/test-zielsysteme.js            -> alle Abschnitte
//   node tools/test-zielsysteme.js erholung   -> nur Abschnitte, deren Name einen der Begriffe enthält
const fs = require('fs');
const CONFIG = require('../shared/config.js');
const Schilde = require('../shared/schilde.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Testhilfe = require('./gegner-testhilfe.js');   // SYS-01 C1a-1: Gegner ohne Hülle (Budget)
const Zs = require('../server/sim/zielsysteme.js');
const Gsys = require('../server/sim/gegnersystem.js');
const Konvoi = require('../server/sim/konvoi.js');
const interior = require('../server/sim/interior.js');
const DATEN = require('../content/kampf/zielsysteme-werte.json').werte;

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const DT = 1 / CONFIG.tickHz;

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const info = (t) => console.log('  info ' + t);
function section(name, body) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}

function setup(opts) {
  const o = opts || {};
  const g = new Game({ noStore: true, worlds: false, seed: o.seed || 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < (o.np || 1); i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 400) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'Z' + i, name: 'Zie' + i, color: i });
    g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' });
    cs.push(c);
  }
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  space.enterScene(g, 'rabenpass', {});
  g.space.enemies = []; g.space.projectiles = [];
  const odas = []; const oda0 = g.oda.bind(g); g.oda = (t, x) => { odas.push(t); return oda0(t, x); };
  const mev = []; const me0 = g.missionEvent.bind(g); g.missionEvent = (k, d) => { mev.push(Object.assign({ kind: k }, d)); return me0(k, d); };
  const c = cs[0];
  const T = { g, c, odas, mev, me: (k) => mev.filter((e) => e.kind === k) };
  T.run = (sec, each) => { for (let k = 0; k < Math.round(sec / DT); k++) { if (each && each(k * DT) === true) return true; g.step(); } return false; };
  T.cmd = (cmd, f) => { c.inbox.length = 0; g.handleMessage(c, Object.assign({ t: 'cmd', c: cmd }, f || {})); return c.inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  T.taktik = () => { g.players[0].console = 'weapons'; };
  return T;
}
const platz = (g, x, y, ang) => { const s = g.ship; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; s.turnVel = 0; if (ang != null) s.angle = ang; };
// Treffer aus der Richtung rel (0 = von vorn/Bug, π = von hinten/Heck, ±π/2 = Seiten), Entfernung 60
const treffer = (g, e, rel, dmg, opts) => space.damageEnemy(g, e, dmg == null ? 1 : dmg, e.x + Math.cos(e.angle + rel) * 60, e.y + Math.sin(e.angle + rel) * 60, Object.assign({ angriff: true }, opts || {}));
const HECK = Math.PI, BUG = 0, STB = Math.PI / 2, BB = -Math.PI / 2;
const vel = (e) => Math.hypot(e.vx || 0, e.vy || 0);
const leer = (g, kind, x, y) => { const e = space.spawnEnemy(g, kind, { x, y, facing: 0, tag: 'zs' }); e.retreatUntil = 0; return e; };
// Lerche 300 px hinter dem Ziel (Zone Heck = zugewandt), Ziel gescannt und das Systemziel gewählt
function hinten(g, e, abstand) { const a = e.angle + Math.PI; platz(g, e.x + Math.cos(a) * (abstand || 300), e.y + Math.sin(a) * (abstand || 300), e.angle); }
const stb = (g, e) => { e.scanned = true; g.ship.target = e.id; hinten(g, e); return Zs.waehle(g, 'antrieb'); };
// Anteil am Systemmaximum (C1b-1: die Schwellen gelten für die Integrität)
const anteil = (e, id, f) => f * Gsys.maxOf(e, id);
const antriebZ = (e) => e.sys.antrieb.z;

section('Daten: Zielsysteme als Katalog', () => {
  const S = DATEN.systeme.wert;
  ok(Object.keys(S).includes('antrieb'), 'das Antrieb-System steht in den Daten');
  for (const [id, s] of Object.entries(S)) {
    ok(s.seite === 'heck' && Schilde.SEITEN.includes('heck'), `${id}: Seite ${s.seite} (Zone Heck)`);
    ok(s.klassen.every((k) => CONFIG.enemies[k]), `${id}: alle Klassen (${s.klassen.join(', ')}) gibt es in CONFIG.enemies`);
    ok(s.stufen[0].faktor === 1 && s.stufen.every((st, i) => i === 0 || (st.faktor >= 0 && st.faktor < s.stufen[i - 1].faktor)), `${id}: Stufe ok = voll (Faktor 1), danach fallende Faktoren`);
    ok(s.stufen.every((st) => st.erholung_s === undefined), `${id}: keine Erholungszeit mehr in den Daten (C1b-1, die Gegner-Reparatur kommt in C2)`);
    ok(!s.lerche || interior.SYSTEM_ORDER.includes(s.lerche), `${id}: Systemname der Lerche (${s.lerche}) gibt es im Schiff`);
    ok(s.wirkung === 'tempo', `${id}: Wirkungsart tempo`);
    ok(s.sperre === true, `${id}: Sperre zwischen zwei Zustandswechseln (Daten)`);
  }
  const T = DATEN.treffer.wert;
  ok(T.sperre_s > 0 && T.immunitaet_s > 0 && T.wahrscheinlichkeit === undefined, `Trefferregel: Sperre ${T.sperre_s} s, Immunität ${T.immunitaet_s} s, ohne Wahrscheinlichkeit (ungezielt = Zufall in der Zone)`);
  ok(Zs.SYSTEME === S, 'das Modul liest dieselben Daten (keine Zahlen im Code)');
  const src = fs.readFileSync(require('path').join(__dirname, '..', 'server', 'sim', 'zielsysteme.js'), 'utf8');
  ok(!/'antrieb'|"antrieb"|'engines'|'heck'/.test(src.replace(/\/\/.*$/gm, '')), 'kein Systemname im Code von zielsysteme.js (nur in den Daten)');
  ok(Zs.trifftGegner === undefined && Zs.trifftLerche === undefined && Zs.schaedige === undefined && Zs.stufe === undefined && Zs.zuruecksetzen === undefined, 'entfernt: trifftGegner, trifftLerche, schaedige, stufe, zuruecksetzen (Parallelmodell e.zs)');
});

section('Ohne Systemziel und Schalter: nichts ändert sich', () => {
  const T = setup(); const g = T.g;
  const e = leer(g, 'korvette', 1500, 1100);
  e.scanned = true;
  treffer(g, e, HECK, 5);
  ok(e.hp < e.hpMax && !('tempoAn' in e), 'Heck-Treffer durch den Schild: Systemintegrität sinkt (SYS-01 C2a: e.tempoAn entfällt, kein Schalter nötig)');
  const s = g.snapshot().space.enemies.find((q) => q.id === e.id);
  ok(('az' in s) === (antriebZ(e) !== 'ok'), 'Snapshot: az genau dann, wenn der Antrieb nicht ok ist (ohne Schalter)');
  ok(!('zs' in g.snapshot().ship), 'Snapshot ship ohne zs');
  const e2 = leer(g, 'raider', 1700, 1300);
  const ran = []; const ch = g.rng.chance.bind(g.rng); g.rng.chance = (p) => { ran.push(p); return ch(p); };
  treffer(g, e2, HECK, 3);
  g.rng.chance = ch;
  ok(!ran.length, 'kein Würfelwurf der Trefferregel (ungezielt = Zufall in der Zone)');
  ok(!Zs.szeneAktiv(g) && g.ship.zielsystem === undefined, 'Szenenschalter aus, kein Systemziel');
  // Brocken, Minen und Zonen sind keine Angriffe: auch mit Systemziel kein gezielter Treffer
  stb(g, e2);
  space.damageEnemy(g, e2, 5, e2.x - Math.cos(e2.angle) * 60, e2.y - Math.sin(e2.angle) * 60);
  ok(!(g.stats.zielsysteme && g.stats.zielsysteme.gegner), 'Treffer ohne opts.angriff (Brocken, Mine, Zone) lösen keinen gezielten Treffer aus');
});

section('Befehl weapons.systemziel: jede System-Id des Ziels, Erreichbarkeit bei der Wahl', () => {
  const T = setup(); const g = T.g; T.taktik();
  ok(T.cmd('weapons.systemziel', { id: 'antrieb' }).some((t) => /Ziel wählen/.test(t)), 'ohne Ziel: Hinweis');
  const e = leer(g, 'korvette', 1500, 1100);
  g.ship.target = e.id;
  ok(T.cmd('weapons.systemziel', { id: 'antrieb' }).some((t) => /scannen/.test(t)) && !g.ship.zielsystem, 'ungescanntes Ziel: Hinweis (erst scannen)');
  e.scanned = true; hinten(g, e);
  ok(T.cmd('weapons.systemziel', { id: 'antrieb' }).length === 0 && g.ship.zielsystem === 'antrieb', 'gescanntes Ziel von hinten: Systemziel Antrieb gesetzt');
  ok(g.snapshot().ship.zs === 'antrieb', 'Snapshot ship.zs = antrieb');
  ok(T.cmd('weapons.systemziel', { id: 'unsinn' }).some((t) => /kein solches System/.test(t)), 'unbekannte System-Id: Hinweis');
  // C1b-1: jede System-Id des Ziels ist wählbar (hier der Reaktor in der Mitte), aber nur wenn erreichbar: die Zone der zugewandten Seite (Heck) ist offen
  ok(T.cmd('weapons.systemziel', { id: 'reaktor' }).some((t) => /nicht erreichbar/.test(t)) && g.ship.zielsystem === 'antrieb', 'Reaktor (Mitte) bei offener zugewandter Zone: nicht erreichbar, Wahl abgelehnt');
  // das Ziel von vorn: der Antrieb im Heck ist nicht erreichbar
  platz(g, e.x + Math.cos(e.angle) * 300, e.y + Math.sin(e.angle) * 300, e.angle + Math.PI);
  ok(T.cmd('weapons.systemziel', { id: 'antrieb' }).some((t) => /nicht erreichbar/.test(t)), 'Antrieb im Heck, Lerche von vorn: nicht erreichbar');
  hinten(g, e);
  const p = space.spawnEnemy(g, 'pylon', { x: 1700, y: 900 }); p.scanned = true;
  g.ship.target = p.id; delete g.ship.zielsystem; hinten(g, p);
  ok(T.cmd('weapons.systemziel', { id: 'antrieb' }).length === 0 && g.ship.zielsystem === 'antrieb', 'Pylon hat einen Antrieb (Daten): wählbar, wenn von hinten erreichbar (C1b-1: kein Klassen-Filter mehr)');
  g.ship.target = e.id; T.cmd('weapons.systemziel', { id: 'antrieb' });
  ok(g.ship.zielsystem === 'antrieb', 'wieder gesetzt');
  T.cmd('weapons.target', { id: p.id });
  ok(!g.ship.zielsystem, 'anderes Ziel gewählt: das Systemziel verfällt');
  g.ship.target = e.id; T.cmd('weapons.systemziel', { id: 'antrieb' }); T.cmd('weapons.systemziel', { id: null });
  ok(!g.ship.zielsystem, 'id null hebt das Systemziel auf');
  T.cmd('weapons.systemziel', { id: 'antrieb' }); T.cmd('weapons.target', { id: null });
  ok(!g.ship.zielsystem && g.ship.target === null, 'Ziel abgewählt: Systemziel weg');
  T.cmd('weapons.target', { id: e.id }); T.cmd('weapons.systemziel', { id: 'antrieb' });
  space.enterScene(g, 'splitter', {});
  ok(!g.ship.zielsystem, 'Szenenwechsel: kein Systemziel');
});

section('Trefferregel Lerche -> Gegner: Schild durchschlagen, Zone des Ziels, Wahl statt Zufall', () => {
  const T = setup(); const g = T.g;
  const e = leer(g, 'korvette', 1500, 1100); e.angle = 0;
  ok(stb(g, e) === null, 'Systemziel Antrieb am gescannten Ziel (von hinten)');
  const a0 = e.sys.antrieb.i;
  treffer(g, e, BUG, 2);
  ok(e.sys.antrieb.i === a0 && Zs.tempoFaktor(e) === 1, 'Treffer am Bug: kein Antriebstreffer, kein Tempo (Zone Bug)');
  treffer(g, e, STB, 2);
  ok(e.sys.antrieb.i === a0 && Zs.tempoFaktor(e) === 1, 'Treffer an der Seite: kein Antriebstreffer, kein Tempo');
  // Heck mit stehendem Schild: der Schild fängt den Treffer
  const lay = Schilde.layout(CONFIG, 'korvette');
  const heckIdx = lay.seiten[2][0];
  e.shields[heckIdx] = 5;
  treffer(g, e, HECK, 2);
  ok(e.sys.antrieb.i === a0 && e.shields[heckIdx] === 3, 'Heck-Treffer, den der Schild fängt (Schild 5 -> 3): kein Antriebstreffer');
  // Schild 1, Treffer 3: der Schild fängt, der Rest verfällt (kein Überlauf)
  e.shields[heckIdx] = 1;
  treffer(g, e, HECK, 3);
  ok(e.sys.antrieb.i === a0 && e.shields[heckIdx] === 0, 'Heck-Treffer mit Schild 1 (Treffer 3): der Schild fängt ohne Überlauf, kein Antriebstreffer');
  treffer(g, e, HECK, 3);
  ok(e.sys.antrieb.i < a0, 'Heck-Treffer, der den Schild durchschlägt (Schild 0): Antrieb wird getroffen (Heck hat nur den Antrieb; gezielt in test-zielsysteme-zonen)');
  // beschädigt: Integrität unter 60 %
  const ziel = anteil(e, 'antrieb', 0.45);
  e.sys.antrieb.i = Gsys.maxOf(e, 'antrieb'); e.sys.antrieb.z = 'ok'; e.sys.antrieb.sp = null;
  treffer(g, e, HECK, ziel);
  ok(antriebZ(e) === 'damaged' && Math.abs(Zs.tempoFaktor(e) - DATEN.systeme.wert.antrieb.stufen[1].faktor) < 1e-9, 'Stufe beschädigt, Tempofaktor = ' + Zs.tempoFaktor(e));
  // zweiter Treffer binnen der Sperre (sperre_s): der Zustand bleibt beschädigt, auch wenn die Integrität ausreicht
  treffer(g, e, HECK, anteil(e, 'antrieb', 0.6));
  ok(antriebZ(e) === 'damaged', 'zweiter Treffer binnen der Sperre (' + DATEN.treffer.wert.sperre_s + ' s): bleibt beschädigt (eine Salve schaltet nicht alles auf einmal aus)');
  T.run(DATEN.treffer.wert.sperre_s + 0.1);
  ok(antriebZ(e) === 'broken' && Zs.tempoFaktor(e) === 0 && Zs.ausgefallen(e, 'antrieb'), 'nach der Sperre holt der Zustand nach: ausgefallen, Tempofaktor 0');
  ok(T.odas.filter((t) => /Antrieb des Ziels/.test(t)).length === 2 && T.me('zielsystemGetroffen').length === 2, 'ODA und missionEvent zielsystemGetroffen je Zustandswechsel (2)');
  // Torpedo (huelle): geht an den Schilden vorbei, trifft die Hülle am Heck
  const t = leer(g, 'korvette', 1900, 1500); t.angle = 0; stb(g, t);
  treffer(g, t, HECK, anteil(t, 'antrieb', 0.45), { huelle: true });
  ok(antriebZ(t) === 'damaged', 'Torpedo (huelle) am Heck: Antrieb beschädigt (gleiche Regel)');
  // Verbündete: nie gezielt, ohne Szenenschalter kein Tempo
  const a = leer(g, 'raider', 2100, 1500); a.angle = 0; a.scanned = true; g.ship.target = a.id; g.ship.zielsystem = 'antrieb';
  const gz0 = (g.stats.zielsysteme || { gegner: 0 }).gegner;
  treffer(g, a, HECK, 3, { ally: true });
  ok((g.stats.zielsysteme || { gegner: 0 }).gegner === gz0, 'Treffer der Verbündeten ohne Szenenschalter: kein gezielter Treffer (gezielt gilt nur für die Lerche)');
});

section('Zufall in der Zone und Szenenschalter', () => {
  const T = setup(); const g = T.g;
  const e = leer(g, 'korvette', 1500, 1100); e.angle = 0; e.scanned = true;
  Zs.szeneAn(g, true);
  ok(Zs.szeneAktiv(g), 'Szenenschalter an');
  const chance = g.rng.chance.bind(g.rng); const w = [];
  g.rng.chance = (p) => { w.push(p); return false; };
  treffer(g, e, HECK, anteil(e, 'antrieb', 0.45));
  g.rng.chance = chance;
  ok(w.length === 0 && antriebZ(e) === 'damaged' && Zs.tempoFaktor(e) === DATEN.systeme.wert.antrieb.stufen[1].faktor, 'ohne Systemziel, Schalter an: Heck-Treffer trifft den Antrieb (Zufall in der Zone, Heck = nur Antrieb), kein Würfelwurf');
  // Verbündete im Schalter: ungezielt, kein gezielter Treffer
  const a = leer(g, 'raider', 2100, 1500); a.angle = 0; a.scanned = true; g.ship.target = a.id; g.ship.zielsystem = 'antrieb';
  treffer(g, a, HECK, 3, { ally: true });
  ok(antriebZ(a) !== 'ok', 'Verbündeter trifft im Szenenschalter: Antrieb getroffen (der Schalter gilt auf beiden Seiten)');
  const aus = Zs.debug(g, ['aus']);
  ok(aus === null && !Zs.szeneAktiv(g), 'Debug zielsysteme aus');
  space.enterScene(g, 'b7', {});
  Zs.szeneAn(g, true); space.enterScene(g, 'rabenpass', {});
  ok(!Zs.szeneAktiv(g), 'Szenenwechsel setzt den Schalter zurück');
});

section('Keine Erholung nach Zeit ohne Reparatur (gestellt): ausgefallen bleibt ausgefallen (SYS-01 C2a: die Reparatur ist die einzige Erholung)', () => {
  const T = setup(); const g = T.g;
  const e = leer(g, 'korvette', 1500, 1100); e.angle = 0; stb(g, e); Testhilfe.setzeBudget(e, 5000);   // mehrere Treffer: der Gegner stirbt dabei nicht
  g.god = true; platz(g, 300, 300, 0);   // Lerche weit weg (keine Gegner-Aktion nötig)
  const sperre = DATEN.treffer.wert.sperre_s + 0.1;
  treffer(g, e, HECK, anteil(e, 'antrieb', 0.45)); T.run(sperre); treffer(g, e, HECK, anteil(e, 'antrieb', 0.6));
  T.run(sperre);
  ok(antriebZ(e) === 'broken', 'ausgefallen');
  Zs.halte(e);   // C2a: gestellt = keine Reparatur (ohne das würde der Gegner den Antrieb nach 10 s + 6 s selbst reparieren, siehe test-gegner-reparatur.js)
  T.run(120);
  ok(antriebZ(e) === 'broken' && Zs.tempoFaktor(e) === 0, 'gestellt: 120 s später noch ausgefallen (keine Erholung)');
  T.run(60);
  ok(antriebZ(e) === 'broken', 'gestellt: auch nach weiteren 60 s ausgefallen (Erholung entfällt)');
});

section('Gestellt (halte): der Schalter bleibt aus, die Reparatur ist ausgeschaltet', () => {
  const T = setup(); const g = T.g;
  const e = leer(g, 'korvette', 1500, 1100); e.angle = 0; stb(g, e);
  g.god = true; platz(g, 300, 300, 0);
  treffer(g, e, HECK, anteil(e, 'antrieb', 0.45));
  ok(antriebZ(e) === 'damaged', 'beschädigt');
  Zs.halte(e);
  ok(e.gestellt === true && !Zs.reparaturErlaubt(e), 'gestellt: Reparatur aus (reparaturErlaubt = false)');
  T.run(DATEN.treffer.wert.sperre_s + 0.1);
  treffer(g, e, HECK, anteil(e, 'antrieb', 0.6));
  ok(antriebZ(e) === 'broken', 'gestellt: ein weiterer Treffer wirkt weiter (die Integrität sinkt), der Zustand folgt');
  const snap = Zs.snapExtra(e);
  ok(snap && snap.ag === 1 && snap.az === 2, 'Snapshot: az = 2 und ag = 1 (gestellt)');
});

// Fahrt: ein Gegner mit Fluchtziel (e.fluchtZiel, Verhalten der Verfolgung) fährt in jedem Flugmodell geradeaus; gemessen wird sein Tempo vorher und nachher
function fahrtMessung(kind, modus) {
  const T = setup(); const g = T.g; g.god = true; platz(g, 200, 200, 0);
  let alt = null;
  if (modus === 'kinematisch') { alt = CONFIG.spaceM3b.flightV2; CONFIG.spaceM3b.flightV2 = { arena: false, missions: false }; }
  try {
    const e = space.spawnEnemy(g, kind, { x: 700, y: 1900, facing: 0, tag: 'fahrt' });
    e.fluchtZiel = { x: 2900, y: 1900 };
    Zs.halte(e);   // SYS-01 C2a: die Messung läuft ohne Reparatur des Gegners (gestellt), sonst repariert er den Antrieb während der Messfenster
    const pilot = require('../server/sim/pilot.js');
    const r = { flies: pilot.flies(g, e) };
    T.run(14); r.voll = vel(e);
    e.scanned = true; g.ship.target = e.id; hinten(g, e, 200); Zs.waehle(g, 'antrieb');
    Testhilfe.schildNull(e); treffer(g, e, HECK, anteil(e, 'antrieb', 0.45));   // ein stehender Schild fängt ohne Überlauf, das Heck-Segment muss unten sein
    platz(g, 200, 200, 0);   // die Lerche wieder weit weg (wie vor der Wahl): nah am Ziel steht es im Flugmodell
    T.run(8); r.beschaedigt = vel(e);
    hinten(g, e, 200); Testhilfe.schildNull(e); T.run(DATEN.treffer.wert.sperre_s); treffer(g, e, HECK, anteil(e, 'antrieb', 0.6));
    platz(g, 200, 200, 0);
    T.run(8); r.aus = vel(e);
    const x1 = e.x; T.run(2); r.weg = e.x - x1;
    r.snap = g.snapshot().space.enemies.find((q) => q.id === e.id);
    return r;
  } finally { if (alt) CONFIG.spaceM3b.flightV2 = alt; }
}
section('Wirkung auf die Fahrt: Pilot-Modell (Messung)', () => {
  const r = fahrtMessung('korvette', 'pilot');
  info(`Korvette (Pilot-Modell): voll ${r.voll.toFixed(1)} px/s, beschädigt ${r.beschaedigt.toFixed(1)}, ausgefallen ${r.aus.toFixed(1)}`);
  ok(r.flies === true, 'Korvette fliegt im Pilot-Modell (Pilot.flies)');
  ok(r.voll > 60, 'voll: fährt (> 60 px/s)');
  ok(r.beschaedigt < r.voll * 0.7 && r.beschaedigt > 10, 'beschädigt: deutlich langsamer (halbes Tempo)');
  ok(r.aus < 1 && r.weg < 2, 'ausgefallen: Stillstand (speedFactor greift im Pilot-Modell)');
  ok(r.snap.az === 2 && r.snap.scanned, 'Snapshot: az = 2 am gescannten Ziel');
  const j = fahrtMessung('raider', 'pilot');
  info(`Jäger (Pilot-Modell): voll ${j.voll.toFixed(1)}, beschädigt ${j.beschaedigt.toFixed(1)}, ausgefallen ${j.aus.toFixed(1)}`);
  ok(j.beschaedigt < j.voll * 0.7 && j.aus < 1, 'Jäger: beschädigt langsamer, ausgefallen steht still (die Mindestfahrt wirkt ohne Schub nicht)');
});
section('Wirkung auf die Fahrt: kinematisches Modell (Messung)', () => {
  const r = fahrtMessung('frachter', 'kinematisch');
  info(`Frachter (kinematisch): voll ${r.voll.toFixed(1)} px/s, beschädigt ${r.beschaedigt.toFixed(1)}, ausgefallen ${r.aus.toFixed(1)}`);
  ok(r.flies === false, 'Frachter fliegt nicht im Pilot-Modell (kinematisch)');
  ok(r.voll > 50 && Math.abs(r.beschaedigt - r.voll * DATEN.systeme.wert.antrieb.stufen[1].faktor) < 3, 'beschädigt: Tempo × Faktor');
  ok(r.aus < 0.5 && r.weg < 1, 'ausgefallen: Stillstand');
  const k = fahrtMessung('korvette', 'kinematisch');
  ok(k.flies === false, 'Korvette mit abgeschaltetem Pilot-Modell ist kinematisch');
  info(`Korvette (kinematisch): voll ${k.voll.toFixed(1)}, beschädigt ${k.beschaedigt.toFixed(1)}, ausgefallen ${k.aus.toFixed(1)}`);
  ok(k.beschaedigt < k.voll * 0.7 && k.aus < 0.5, 'Korvette kinematisch: gleiche Wirkung');
});
section('Wirkung auf die Fahrt: Konvoi-Transporter', () => {
  const T = setup(); const g = T.g; g.god = true; platz(g, 200, 200, 0);
  Konvoi.an(g, { n: 1, sieg: 'aufhalten', eskorte: 'keine' });
  const e = Konvoi.transporter(g)[0];
  Zs.halte(e);   // SYS-01 C2a: Messung ohne Reparatur (gestellt)
  T.run(12); const voll = vel(e);
  e.scanned = true; g.ship.target = e.id; hinten(g, e, 200); Zs.waehle(g, 'antrieb');
  Testhilfe.schildNull(e);   // SYS-01 C1a-1: ein stehender Schild fängt ohne Überlauf
  space.damageEnemy(g, e, anteil(e, 'antrieb', 0.45), e.x - Math.cos(e.angle) * 60, e.y - Math.sin(e.angle) * 60, { angriff: true });
  platz(g, 200, 200, 0);
  T.run(0.1);
  ok(e.sys && antriebZ(e) !== 'ok', 'Transporter: Heck-Treffer beschädigt den Antrieb');
  T.run(5); const b = vel(e);
  info(`Transporter: voll ${voll.toFixed(1)}, beschädigt ${b.toFixed(1)} px/s`);
  ok(voll > 20 && b < voll * 0.75, 'Konvoi-Transporter fährt mit beschädigtem Antrieb langsamer (dritter Haken)');
});

section('Gegenseite: Gegner treffen die Lerche mit derselben Regel', () => {
  const T = setup(); const g = T.g; const ship = g.ship;
  const eng = () => ship.systems.engines;
  const chance = g.rng.chance.bind(g.rng);
  const hit = (sector, opts, dmg) => { ship.shields.current = [0, 0, 0, 0]; space.shipHit(g, sector, dmg == null ? 2 : dmg, Object.assign({ angriff: true }, opts || {})); };
  g.rng.chance = () => false;
  hit(2, { zielt: 'engines' });
  ok(eng() === 'ok', 'ohne Szenenschalter: Heck-Treffer ohne Angriffs-Regel, Triebwerk heil');
  Zs.szeneAn(g, true);
  hit(0, { zielt: 'engines' }); hit(1, { zielt: 'engines' }); hit(3, { zielt: 'engines' });
  ok(eng() === 'ok', 'Bug, Steuerbord, Backbord: Triebwerk heil (nur das Heck zählt, Sektor 2)');
  ship.shields.current = [0, 0, 5, 0]; space.shipHit(g, 2, 2, { angriff: true, zielt: 'engines' });
  ok(eng() === 'ok', 'Heck-Treffer, den der Schild fängt: Triebwerk heil');
  ship.systems.engines = 'ok'; interior.integritaetVoll(g);
  hit(2, { zielt: 'engines' }, 8);
  ok(eng() === 'damaged', 'gezielt, Schild durchschlagen, Heck: Triebwerk beschädigt (ship.systems.engines)');
  hit(2, { zielt: 'engines' }, 12);
  ok(eng() === 'broken', 'zweiter gezielter Treffer: zerstört (Lerche hat keine Sperre, der Schaden folgt der Integrität)');
  ok(T.me('zielsystemGetroffen').filter((e) => e.seite === 'lerche').length >= 2, 'missionEvent zielsystemGetroffen (seite lerche) je gezieltem Treffer');
  ok(space.engineSpeedFactor(g) === 0, 'engineSpeedFactor der Lerche = 0 (bestehendes Systemmodell, nichts Paralleles)');
  // ungezielt: Zufall in der Zone, kein gezielter Treffer gezählt
  ship.systems.engines = 'ok'; interior.integritaetVoll(g); T.run(0.1);
  const z0 = g.stats.zielsysteme.lerche;
  hit(2, {}, 3);
  ok(g.stats.zielsysteme.lerche === z0, 'ungezielt: kein gezielter Systemtreffer gezählt (Zufall in der Zone)');
  // kein Angriff (Mine, Brocken): nichts
  ship.systems.engines = 'ok'; interior.integritaetVoll(g); T.run(0.1);
  g.rng.chance = () => false; ship.shields.current = [0, 0, 0, 0]; space.shipHit(g, 2, 2, { pierce: true }); g.rng.chance = chance;
  ok(eng() === 'ok', 'Treffer ohne opts.angriff (Mine, Brocken): Triebwerk heil');
  // ein Treffer schädigt das Triebwerk nicht doppelt
  ship.systems.engines = 'ok'; interior.integritaetVoll(g); T.run(0.1);
  const d0 = interior.damageSystem; let n = 0; interior.damageSystem = function (...a) { if (a[1] === 'engines') n++; return d0.apply(this, a); };
  ship.shields.current = [0, 0, 0, 0];
  space.shipHit(g, 2, 2, { angriff: true, zielt: 'engines' });
  interior.damageSystem = d0;
  ok(n <= 1 && eng() !== 'broken', 'ein Treffer: das Triebwerk wird höchstens einmal geschädigt (' + n + ')');
});

section('Gegenseite: Gegner-Geschosse und Ladungen tragen die Regel', () => {
  const T = setup(); const g = T.g; const ship = g.ship;
  g.rng.chance = () => false;
  Zs.szeneAn(g, true);
  platz(g, 1500, 1100, 0);
  // Gegner HINTER der Lerche schießt (Heck der Lerche = Sektor 2), mit Systemziel
  const e = space.spawnEnemy(g, 'raider', { x: 1300, y: 1100, facing: 0, tag: 'zs' });
  e.zielsystem = 'engines';
  ship.shields.current = [0, 0, 0, 0];
  g.space.projectiles.push({ id: 'pr1', kind: 'enemy', x: 1470, y: 1100, angle: 0, speed: 100, ttl: 3, dmg: 8, owner: e.id });
  T.run(0.5);
  ok(ship.systems.engines === 'damaged', 'Geschoss eines Gegners mit Systemziel trifft das Heck: Triebwerk beschädigt');
  // ohne Szenenschalter: dasselbe Geschoss lässt das Triebwerk heil (Gegner zielen nur mit Schalter)
  Zs.szeneAn(g, false); ship.systems.engines = 'ok'; interior.integritaetVoll(g); T.run(0.1);
  const z0 = g.stats.zielsysteme.lerche;
  ship.shields.current = [0, 0, 0, 0];
  g.space.projectiles.push({ id: 'pr3', kind: 'enemy', x: 1470, y: 1100, angle: 0, speed: 100, ttl: 3, dmg: 8, owner: e.id });
  T.run(0.5);
  ok(g.stats.zielsysteme.lerche === z0, 'ohne Szenenschalter: kein gezielter Treffer (Gegner zielen nur mit Schalter)');
});

section('Regel als Funktion: gezielt nur für das gewählte Ziel', () => {
  const T = setup(); const g = T.g; const ship = g.ship;
  const qx = (e, rel) => [e.x + Math.cos(e.angle + rel) * 60, e.y + Math.sin(e.angle + rel) * 60];
  const e = leer(g, 'korvette', 1500, 1100); e.angle = 0; stb(g, e);
  ok(ship.target === e.id && ship.zielsystem === 'antrieb', 'Systemziel liegt am Ziel A');
  const b = leer(g, 'korvette', 1800, 1300); b.angle = 0; b.scanned = true;
  const gzB = (g.stats.zielsysteme || { gegner: 0 }).gegner;
  treffer(g, b, HECK, anteil(b, 'antrieb', 0.45));
  ok((g.stats.zielsysteme || { gegner: 0 }).gegner === gzB, 'Treffer auf ein anderes Ziel B (kein Szenenschalter): das Systemziel gilt nur für das gewählte Ziel (kein gezielter Treffer)');
  treffer(g, e, HECK, anteil(e, 'antrieb', 0.45));
  ok(antriebZ(e) === 'damaged' && Zs.tempoFaktor(e) === DATEN.systeme.wert.antrieb.stufen[1].faktor, 'Treffer auf das gewählte Ziel A: Antrieb beschädigt, Tempo wirkt');
  // Ohne Ziel-Wahl der Ops: Systemtreffer des Ziels bleibt ein Zufall in der Zone
  ok(Zs.gezielt(g, e) !== null && Zs.gezielt(g, b) === null, 'gezielt() liefert das Systemziel nur für das Ziel der Ops');
});

section('Gegenseite: Ladung der Gegner (Lanze) und Geschosse der Verbündeten tragen die Regel', () => {
  // Ladung einer Korvette hinter der Lerche (Heck der Lerche), Schild 0: die angekündigte Lanze trifft das Heck
  const T = setup(); const g = T.g; const ship = g.ship;
  g.rng.chance = () => false; g.god = false;
  platz(g, 1500, 1100, 0);
  Zs.szeneAn(g, true);
  const e = space.spawnEnemy(g, 'korvette', { x: 1300, y: 1100, facing: -Math.PI / 2, tag: 'zs' });
  e.zielsystem = 'engines'; e.vx = 0; e.vy = 0;
  ship.shields.current = [0, 0, 0, 0];
  e.tele = { kind: 'shot', left: 0.02, dur: 2.2, sector: 2, delayed: 0 };
  const integ0 = ship.integ.engines;
  T.run(0.2);
  ok(g.stats.heavyHits >= 1, 'die Ladung traf die Lerche (Voraussetzung des Tests)');
  ok(ship.integ.engines < integ0, 'schwere Ladung eines Gegners mit Systemziel trifft das Heck: Triebwerk getroffen (Integrität ' + integ0 + ' -> ' + ship.integ.engines.toFixed(1) + ')');
  // dieselbe Ladung ohne Szenenschalter: Triebwerk heil
  const U = setup(); const h = U.g; h.rng.chance = () => false; h.god = false;
  platz(h, 1500, 1100, 0);
  const e2 = space.spawnEnemy(h, 'korvette', { x: 1300, y: 1100, facing: -Math.PI / 2, tag: 'zs' });
  e2.zielsystem = 'engines'; e2.vx = 0; e2.vy = 0; h.ship.shields.current = [0, 0, 0, 0];
  e2.tele = { kind: 'shot', left: 0.02, dur: 2.2, sector: 2, delayed: 0 };
  U.run(0.2);
  ok(h.stats.heavyHits >= 1 && h.ship.systems.engines === 'ok', 'ohne Szenenschalter: dieselbe Ladung lässt das Triebwerk heil');
  // Geschoss eines Verbündeten am Heck eines Gegners: nur mit Szenenschalter eine Tempo-Wirkung
  const V = setup(); const w = V.g; w.god = true;
  platz(w, 300, 300, 0);
  const z = space.spawnEnemy(w, 'korvette', { x: 1500, y: 1100, facing: 0, tag: 'zs' }); z.vx = 0; z.vy = 0; z.scanned = true;
  const schuss = (id) => w.space.projectiles.push({ id, kind: 'ally', x: z.x - 30, y: z.y, angle: 0, speed: 60, ttl: 2, dmg: anteil(z, 'antrieb', 0.5) });
  w.rng.chance = () => true;
  schuss('pa0'); V.run(0.3);
  ok(antriebZ(z) !== 'ok' && Zs.tempoFaktor(z) < 1, 'Geschoss eines Verbündeten ohne Szenenschalter: Antrieb am Heck getroffen, Tempo wirkt (C2a: kein Schalter)');
  Zs.szeneAn(w, true);
  schuss('pa1'); V.run(0.3);
  ok(antriebZ(z) !== 'ok' && Zs.tempoFaktor(z) < 1, 'Geschoss eines Verbündeten mit Szenenschalter am Heck: Antrieb beschädigt (Zufall in der Zone, Heck = Antrieb)');
});

section('Snapshot-Größe und Anzeige-Daten', () => {
  const T = setup({ np: 3 }); const g = T.g;
  const es = [];
  for (let i = 0; i < 4; i++) { const e = leer(g, 'korvette', 1200 + i * 150, 1000 + i * 80); e.angle = 0; e.scanned = true; es.push(e); }
  g.ship.target = es[0].id; hinten(g, es[0]); Zs.waehle(g, 'antrieb');
  Zs.szeneAn(g, true);
  for (const e of es) { treffer(g, e, HECK, anteil(e, 'antrieb', 0.45)); }
  const eintraege = () => JSON.stringify(g.snapshot().space.enemies.filter((q) => es.some((e) => e.id === q.id))).length;
  const sz0 = JSON.stringify(g.snapshot().ship.zs || '').length;
  const s0 = eintraege() + sz0;
  const tAlt = es.map((e) => e.tempoAn);
  for (const e of es) delete e.tempoAn;
  const s1 = eintraege();
  info(`Snapshot-Einträge von 4 beschädigten, gescannten Zielen samt Systemziel: ${s0} B, ohne Schaden: ${s1} B (Zusatz ${s0 - s1} B)`);
  es.forEach((e, i) => { e.tempoAn = tAlt[i]; });
  ok(s0 - s1 <= 80, 'Zusatz ≤ 80 B für vier Ziele und das Systemziel (je gescanntem Ziel klein)');
  const e = es[0]; e.scanned = false; g.ship.zielsystem = 'antrieb'; g.ship.target = e.id; treffer(g, e, HECK, anteil(e, 'antrieb', 0.45));
  ok(!('az' in g.snapshot().space.enemies.find((q) => q.id === e.id)), 'ungescanntes Ziel: kein az im Snapshot (der Schaden bleibt verborgen)');
});

section('Dauerfeuer auf dem ausgefallenen Antrieb: der Zustand hält, keine Frist (C1b-1; C2a: gestellt, ohne Reparatur)', () => {
  const T = setup(); const g = T.g;
  const e = leer(g, 'korvette', 1500, 1100); e.angle = 0; stb(g, e); Testhilfe.setzeBudget(e, 5000);   // ein Ziel, das im Dauerfeuer nicht stirbt
  Zs.halte(e);   // SYS-01 C2a: ohne Reparatur, sonst repariert der Gegner den Antrieb im Dauerfeuer-Fenster
  g.god = true; platz(g, 300, 300, 0);
  const sperre = DATEN.treffer.wert.sperre_s + 0.1;
  treffer(g, e, HECK, anteil(e, 'antrieb', 0.45)); T.run(sperre); treffer(g, e, HECK, anteil(e, 'antrieb', 0.6));
  T.run(sperre);
  ok(antriebZ(e) === 'broken', 'ausgefallen am Zeitpunkt t0');
  const t0 = g.time;
  while (g.time < t0 + 100) { treffer(g, e, HECK, 3); T.run(sperre); }
  ok(antriebZ(e) === 'broken' && Zs.tempoFaktor(e) === 0, '100 s Dauerfeuer: der Antrieb bleibt ausgefallen (keine Erholung, keine Lücke)');
});

console.log(`\ntest-zielsysteme: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
