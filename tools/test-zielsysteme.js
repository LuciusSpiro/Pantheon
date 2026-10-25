'use strict';
// SUND-04a-1 A: Gezielter Systemtreffer (Antrieb) mit gleichen Regeln für beide Seiten (server/sim/zielsysteme.js, Daten content/kampf/zielsysteme-werte.json).
//  - Daten: Zielsysteme als Katalog, Seiten, Stufen, Klassen
//  - Regel Lerche -> Gegner: Schild durchschlagen UND Heck, gezielt/ungezielt, Sperre, Erholung, Szenenschalter, Befehl weapons.systemziel
//  - Wirkung auf die Fahrt in allen drei Flugwegen (Pilot, kinematisch, Konvoi), mit Messung vorher/nachher
//  - Gegenseite: Gegner -> Lerche mit derselben Regel (ship.systems.engines)
//  - Ohne Systemziel/Schalter bleibt alles beim Alten (kein e.zs, kein Snapshot-Feld, keine Zufallsnutzung)
//   node tools/test-zielsysteme.js            -> alle Abschnitte
//   node tools/test-zielsysteme.js erholung   -> nur Abschnitte, deren Name einen der Begriffe enthält
const fs = require('fs');
const CONFIG = require('../shared/config.js');
const Schilde = require('../shared/schilde.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Zs = require('../server/sim/zielsysteme.js');
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
const stb = (g, e) => { e.scanned = true; g.ship.target = e.id; return Zs.waehle(g, 'antrieb'); };

section('Daten: Zielsysteme als Katalog', () => {
  const S = DATEN.systeme.wert;
  ok(Object.keys(S).includes('antrieb'), 'V1 enthält den Antrieb');
  for (const [id, s] of Object.entries(S)) {
    ok(Schilde.SEITEN.includes(s.seite), `${id}: Seite ${s.seite} ist eine Schildseite`);
    ok(s.klassen.every((k) => CONFIG.enemies[k]), `${id}: alle Klassen (${s.klassen.join(', ')}) gibt es in CONFIG.enemies`);
    ok(s.stufen[0].faktor === 1 && s.stufen[0].erholung_s === null && s.stufen.every((st, i) => i === 0 || (st.faktor >= 0 && st.faktor < s.stufen[i - 1].faktor)), `${id}: Stufe 0 = voll (Faktor 1), danach fallende Faktoren`);
    ok(s.stufen.slice(1).every((st) => st.erholung_s > 0), `${id}: jede beschädigte Stufe erholt sich nach Zeit (Daten)`);
    ok(!s.lerche || interior.SYSTEM_ORDER.includes(s.lerche), `${id}: Systemname der Lerche (${s.lerche}) gibt es im Schiff`);
    ok(s.wirkung === 'tempo', `${id}: Wirkungsart tempo`);
  }
  const T = DATEN.treffer.wert;
  ok(T.wahrscheinlichkeit.gezielt === 1 && T.wahrscheinlichkeit.ungezielt > 0 && T.wahrscheinlichkeit.ungezielt < 1 && T.sperre_s > 0, `Trefferregel: gezielt ${T.wahrscheinlichkeit.gezielt}, ungezielt ${T.wahrscheinlichkeit.ungezielt}, Sperre ${T.sperre_s} s`);
  ok(Zs.SYSTEME === S && Zs.TREFFER === T, 'das Modul liest dieselben Daten (keine Zahlen im Code)');
  const src = fs.readFileSync(require('path').join(__dirname, '..', 'server', 'sim', 'zielsysteme.js'), 'utf8');
  ok(!/'antrieb'|"antrieb"|'engines'|'heck'/.test(src.replace(/\/\/.*$/gm, '')), 'kein Systemname im Code von zielsysteme.js (nur in den Daten)');
});

section('Ohne Systemziel und Schalter: nichts ändert sich', () => {
  const T = setup(); const g = T.g;
  const e = leer(g, 'korvette', 1500, 1100);
  e.scanned = true;
  treffer(g, e, HECK, 5);
  ok(e.zs === undefined && e.hp < e.hpMax, 'Heck-Treffer durch den Schild: Hülle sinkt, kein Systemzustand (e.zs fehlt)');
  const s = g.snapshot().space.enemies.find((q) => q.id === e.id);
  ok(!('az' in s), 'Snapshot ohne az');
  ok(!('zs' in g.snapshot().ship), 'Snapshot ship ohne zs');
  const e2 = leer(g, 'raider', 1700, 1300);
  const ran = []; const ch = g.rng.chance.bind(g.rng); g.rng.chance = (p) => { ran.push(p); return ch(p); };
  treffer(g, e2, HECK, 3);
  g.rng.chance = ch;
  ok(!ran.length, 'kein Würfelwurf der Trefferregel');
  ok(!Zs.szeneAktiv(g) && g.ship.zielsystem === undefined, 'Szenenschalter aus, kein Systemziel');
  // Brocken, Minen und Zonen sind keine Angriffe: auch mit Systemziel kein Systemtreffer
  stb(g, e2);
  space.damageEnemy(g, e2, 5, e2.x - Math.cos(e2.angle) * 60, e2.y - Math.sin(e2.angle) * 60);
  ok(e2.zs === undefined, 'Treffer ohne opts.angriff (Brocken, Mine, Zone) lösen keinen Systemtreffer aus');
});

section('Befehl weapons.systemziel', () => {
  const T = setup(); const g = T.g; T.taktik();
  ok(T.cmd('weapons.systemziel', { id: 'antrieb' }).some((t) => /Ziel wählen/.test(t)), 'ohne Ziel: Hinweis');
  const e = leer(g, 'korvette', 1500, 1100);
  g.ship.target = e.id;
  ok(T.cmd('weapons.systemziel', { id: 'antrieb' }).some((t) => /scannen/.test(t)) && !g.ship.zielsystem, 'ungescanntes Ziel: Hinweis (erst scannen)');
  e.scanned = true;
  ok(T.cmd('weapons.systemziel', { id: 'antrieb' }).length === 0 && g.ship.zielsystem === 'antrieb', 'gescanntes Ziel: Systemziel Antrieb gesetzt');
  ok(g.snapshot().ship.zs === 'antrieb', 'Snapshot ship.zs = antrieb');
  ok(T.cmd('weapons.systemziel', { id: 'unsinn' }).some((t) => /Unbekannt/.test(t)), 'unbekanntes System: Hinweis');
  const p = space.spawnEnemy(g, 'pylon', { x: 1700, y: 900 }); p.scanned = true; g.ship.target = null;
  g.ship.target = p.id; delete g.ship.zielsystem;
  ok(T.cmd('weapons.systemziel', { id: 'antrieb' }).some((t) => /keinen Antrieb/.test(t)) && !g.ship.zielsystem, 'Pylon hat keinen Antrieb: Hinweis');
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

section('Trefferregel Lerche -> Gegner: Schild durchschlagen und Heck', () => {
  const T = setup(); const g = T.g;
  const e = leer(g, 'korvette', 1500, 1100); e.angle = 0;
  ok(stb(g, e) === null, 'Systemziel Antrieb am gescannten Ziel');
  treffer(g, e, BUG, 2);
  ok(e.zs === undefined, 'Treffer am Bug: kein Antriebstreffer (Hülle wird getroffen, falsche Seite)');
  treffer(g, e, STB, 2);
  ok(e.zs === undefined, 'Treffer an der Seite: kein Antriebstreffer');
  // Heck mit stehendem Schild: der Schild fängt den Treffer
  const lay = Schilde.layout(CONFIG, 'korvette');
  const heckIdx = lay.seiten[2][0];
  e.shields[heckIdx] = 5;
  const hp0 = e.hp;
  treffer(g, e, HECK, 2);
  ok(e.zs === undefined && e.hp === hp0 && e.shields[heckIdx] === 3, 'Heck-Treffer, den der Schild fängt (Schild 5 -> 3): kein Antriebstreffer');
  e.shields[heckIdx] = 1;
  treffer(g, e, HECK, 3);
  ok(e.zs && e.zs.antrieb.s === 1 && e.hp < hp0, 'Heck-Treffer, der den Schild durchschlägt (Rest > 0): Antrieb beschädigt (Stufe 1)');
  ok(Zs.tempoFaktor(e) === DATEN.systeme.wert.antrieb.stufen[1].faktor, 'Tempofaktor beschädigt = ' + Zs.tempoFaktor(e));
  treffer(g, e, HECK, 1);
  ok(e.zs.antrieb.s === 1, 'zweiter Treffer binnen der Sperre (' + DATEN.treffer.wert.sperre_s + ' s): bleibt Stufe 1 (eine Salve schaltet nicht alles auf einmal aus)');
  T.run(DATEN.treffer.wert.sperre_s + 0.1);
  treffer(g, e, HECK, 1);
  ok(e.zs.antrieb.s === 2 && Zs.tempoFaktor(e) === 0 && Zs.ausgefallen(e, 'antrieb'), 'nach der Sperre: Stufe 2 (ausgefallen), Tempofaktor 0');
  T.run(DATEN.treffer.wert.sperre_s + 0.1);
  const bis0 = e.zs.antrieb.bis;
  treffer(g, e, HECK, 1);
  ok(e.zs.antrieb.s === 2 && e.zs.antrieb.bis > bis0, 'weiterer Treffer am Ende der Stufen: bleibt ausgefallen, die Erholungsfrist beginnt neu');
  ok(T.odas.filter((t) => /Antrieb des Ziels/.test(t)).length === 2 && T.me('zielsystemGetroffen').length === 2, 'ODA und missionEvent zielsystemGetroffen je Stufe (2)');
  // Klassen ohne Antrieb im Katalog (Pylon): kein Eintrag
  const p = space.spawnEnemy(g, 'pylon', { x: 1700, y: 900 }); p.scanned = true; g.ship.target = p.id;
  g.ship.zielsystem = 'antrieb'; treffer(g, p, HECK, 9);
  ok(p.zs === undefined, 'Pylon (Klasse nicht im Katalog): kein Antriebstreffer');
  // Torpedo (huelle): geht an den Schilden vorbei, trifft die Hülle am Heck
  const t = leer(g, 'korvette', 1900, 1500); t.angle = 0; stb(g, t);
  treffer(g, t, HECK, 3, { huelle: true });
  ok(t.zs && t.zs.antrieb.s === 1, 'Torpedo (huelle) am Heck: Antrieb beschädigt (gleiche Regel)');
  // Verbündete: nur ungezielt, nur mit Szenenschalter
  const a = leer(g, 'raider', 2100, 1500); a.angle = 0; a.scanned = true; g.ship.target = a.id; g.ship.zielsystem = 'antrieb';
  treffer(g, a, HECK, 3, { ally: true });
  ok(a.zs === undefined, 'Treffer der Verbündeten ohne Szenenschalter: kein Systemtreffer (gezielt gilt nur für die Lerche)');
});

section('Ungezielt und Szenenschalter', () => {
  const T = setup(); const g = T.g;
  const e = leer(g, 'korvette', 1500, 1100); e.angle = 0; e.scanned = true;
  Zs.szeneAn(g, true);
  ok(Zs.szeneAktiv(g), 'Szenenschalter an');
  const chance = g.rng.chance.bind(g.rng); const w = [];
  g.rng.chance = (p) => { w.push(p); return false; };
  treffer(g, e, HECK, 3);
  ok(e.zs === undefined && w.length === 1 && w[0] === DATEN.treffer.wert.wahrscheinlichkeit.ungezielt, 'ohne Systemziel: Würfelwurf mit der ungezielten Wahrscheinlichkeit (' + w[0] + '), verfehlt');
  g.rng.chance = () => true;
  treffer(g, e, HECK, 3);
  ok(e.zs && e.zs.antrieb.s === 1, 'Wurf gelungen: Stufe 1');
  g.rng.chance = chance;
  // gezielt: sicher, ohne Wurf
  const f = leer(g, 'korvette', 1800, 1300); f.angle = 0; stb(g, f);
  g.rng.chance = () => { throw new Error('kein Wurf bei gezielt'); };
  treffer(g, f, HECK, 3);
  g.rng.chance = chance;
  ok(f.zs && f.zs.antrieb.s === 1, 'gezielt (Systemziel am Ziel): trifft sicher, ohne Würfelwurf');
  // Verbündete im Schalter: ungezielt
  const a = leer(g, 'raider', 2100, 1500); a.angle = 0; a.scanned = true; g.ship.target = a.id; g.ship.zielsystem = 'antrieb';
  g.rng.chance = () => true; treffer(g, a, HECK, 3, { ally: true }); g.rng.chance = chance;
  ok(a.zs && a.zs.antrieb.s === 1, 'Verbündeter trifft im Szenenschalter ungezielt (Wurf)');
  const aus = Zs.debug(g, ['aus']);
  ok(aus === null && !Zs.szeneAktiv(g), 'Debug zielsysteme aus');
  space.enterScene(g, 'b7', {});
  Zs.szeneAn(g, true); space.enterScene(g, 'rabenpass', {});
  ok(!Zs.szeneAktiv(g), 'Szenenwechsel setzt den Schalter zurück');
});

section('Erholung nach Zeit', () => {
  const T = setup(); const g = T.g;
  const S = DATEN.systeme.wert.antrieb.stufen;
  const e = leer(g, 'korvette', 1500, 1100); e.angle = 0; stb(g, e);
  g.god = true; platz(g, 300, 300, 0);   // Lerche weit weg (keine Gegner-Aktion nötig)
  const sperre = DATEN.treffer.wert.sperre_s + 0.1;
  treffer(g, e, HECK, 3); T.run(sperre); treffer(g, e, HECK, 3);
  ok(e.zs.antrieb.s === 2, 'ausgefallen (Stufe 2)');
  T.run(S[2].erholung_s - 1);
  ok(e.zs && e.zs.antrieb.s === 2, `${S[2].erholung_s - 1} s später: noch ausgefallen`);
  T.run(2);
  ok(e.zs && e.zs.antrieb.s === 1, `nach ${S[2].erholung_s} s: beschädigt (Stufe 1)`);
  treffer(g, e, HECK, 3);
  ok(e.zs.antrieb.s === 2, 'neuer Treffer: wieder ausgefallen (Frist neu)');
  T.run(S[2].erholung_s + 0.5);
  ok(e.zs.antrieb.s === 1, 'Erholung erneut: Stufe 1');
  T.run(S[1].erholung_s + 0.5);
  ok(e.zs === undefined, `nach weiteren ${S[1].erholung_s} s: voll, Zustand gelöscht (e.zs fehlt wieder)`);
  // gehalten (gestellt): keine Erholung
  treffer(g, e, HECK, 3); T.run(sperre); treffer(g, e, HECK, 3);
  Zs.halte(e, 'antrieb');
  T.run(S[2].erholung_s + S[1].erholung_s + 5);
  ok(e.zs && e.zs.antrieb.s === 2, 'ein gestelltes Schiff (halte) bleibt ausgefallen');
});

// Fahrt: ein Gegner mit Fluchtziel (e.fluchtZiel, Verhalten der Verfolgung) fährt in jedem Flugmodell geradeaus; gemessen wird sein Tempo vorher und nachher
function fahrtMessung(kind, modus) {
  const T = setup(); const g = T.g; g.god = true; platz(g, 200, 200, 0);
  let alt = null;
  if (modus === 'kinematisch') { alt = CONFIG.spaceM3b.flightV2; CONFIG.spaceM3b.flightV2 = { arena: false, missions: false }; }
  try {
    const e = space.spawnEnemy(g, kind, { x: 700, y: 1900, facing: 0, tag: 'fahrt' });
    e.fluchtZiel = { x: 2900, y: 1900 };
    const pilot = require('../server/sim/pilot.js');
    const r = { flies: pilot.flies(g, e) };
    T.run(14); r.voll = vel(e);
    e.scanned = true; g.ship.target = e.id; Zs.waehle(g, 'antrieb');
    treffer(g, e, HECK, 3);
    T.run(8); r.beschaedigt = vel(e);
    T.run(DATEN.treffer.wert.sperre_s); treffer(g, e, HECK, 3);
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
  T.run(12); const voll = vel(e);
  e.scanned = true; g.ship.target = e.id; Zs.waehle(g, 'antrieb');
  space.damageEnemy(g, e, 9, e.x - Math.cos(e.angle) * 60, e.y - Math.sin(e.angle) * 60, { angriff: true });
  T.run(0.1);
  ok(e.zs && e.zs.antrieb.s === 1, 'Transporter: Heck-Treffer beschädigt den Antrieb');
  T.run(5); const b = vel(e);
  info(`Transporter: voll ${voll.toFixed(1)}, beschädigt ${b.toFixed(1)} px/s`);
  ok(voll > 20 && b < voll * 0.75, 'Konvoi-Transporter fährt mit beschädigtem Antrieb langsamer (dritter Haken)');
});

section('Gegenseite: Gegner treffen die Lerche mit derselben Regel', () => {
  const T = setup(); const g = T.g; const ship = g.ship;
  const eng = () => ship.systems.engines;
  const chance = g.rng.chance.bind(g.rng);
  const hit = (sector, opts, dmg) => { ship.shields.current = [0, 0, 0, 0]; space.shipHit(g, sector, dmg == null ? 2 : dmg, Object.assign({ angriff: true }, opts || {})); };
  g.rng.chance = () => false;   // der Durchlass-Wurf der Systemtabelle würfelt nie: nur die neue Regel wirkt
  hit(2, { zielt: 'antrieb' });
  ok(eng() === 'ok', 'ohne Szenenschalter: Heck-Treffer ohne Angriffs-Regel, Triebwerk heil');
  Zs.szeneAn(g, true);
  hit(0, { zielt: 'antrieb' }); hit(1, { zielt: 'antrieb' }); hit(3, { zielt: 'antrieb' });
  ok(eng() === 'ok', 'Bug, Steuerbord, Backbord: Triebwerk heil (nur das Heck zählt, Sektor 2)');
  ship.shields.current = [0, 0, 5, 0]; space.shipHit(g, 2, 2, { angriff: true, zielt: 'antrieb' });
  ok(eng() === 'ok', 'Heck-Treffer, den der Schild fängt: Triebwerk heil');
  hit(2, {});
  ok(eng() === 'ok', 'ungezielt, Wurf verfehlt: Triebwerk heil');
  hit(2, { zielt: 'antrieb' }, 0.5);
  ok(eng() === 'damaged', 'gezielt, Schild durchschlagen, Heck: Triebwerk beschädigt (ship.systems.engines)');
  hit(2, { zielt: 'antrieb' });
  ok(eng() === 'damaged', 'zweiter Treffer binnen der Sperre: bleibt beschädigt');
  T.run(DATEN.treffer.wert.sperre_s + 0.1);
  hit(2, { zielt: 'antrieb' });
  ok(eng() === 'broken', 'nach der Sperre: zerstört (zwei Stufen wie beim Gegner)');
  ok(T.me('zielsystemGetroffen').filter((e) => e.seite === 'lerche').length === 2, 'missionEvent zielsystemGetroffen (seite lerche) je Stufe');
  ok(space.engineSpeedFactor(g) === 0, 'engineSpeedFactor der Lerche = 0 (bestehendes Systemmodell, nichts Paralleles)');
  // ungezielt mit gelungenem Wurf
  ship.systems.engines = 'ok'; delete ship.zsAt; T.run(0.1);
  g.rng.chance = () => true; hit(2, {}); g.rng.chance = chance;
  ok(eng() === 'damaged', 'ungezielt, Wurf gelungen: beschädigt');
  // kein Angriff (Mine, Brocken): nichts
  ship.systems.engines = 'ok'; delete ship.zsAt; T.run(0.1);
  g.rng.chance = () => false; ship.shields.current = [0, 0, 0, 0]; space.shipHit(g, 2, 2, { pierce: true }); g.rng.chance = chance;
  ok(eng() === 'ok', 'Treffer ohne opts.angriff (Mine, Brocken): Triebwerk heil');
  // ein Treffer schädigt das Triebwerk nicht doppelt (Durchlass-Tabelle und Regel im selben Treffer)
  ship.systems.engines = 'ok'; delete ship.zsAt; T.run(0.1);
  const d0 = interior.damageSystem; let n = 0; interior.damageSystem = function (...a) { if (a[1] === 'engines') n++; return d0.apply(this, a); };
  ship.shields.current = [0, 0, 0, 0];
  g.rng.chance = () => true; space.shipHit(g, 2, 2, { angriff: true, zielt: 'antrieb' }); g.rng.chance = chance;
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
  e.zielsystem = 'antrieb';
  ship.shields.current = [0, 0, 0, 0];
  g.space.projectiles.push({ id: 'pr1', kind: 'enemy', x: 1470, y: 1100, angle: 0, speed: 100, ttl: 3, dmg: 1, owner: e.id });
  T.run(0.5);
  ok(ship.systems.engines === 'damaged', 'Geschoss eines Gegners mit Systemziel trifft das Heck: Triebwerk beschädigt');
  // ohne Systemziel des Schützen: ungezielt, Wurf verfehlt
  ship.systems.engines = 'ok'; delete ship.zsAt; T.run(0.1);
  e.zielsystem = null;
  ship.shields.current = [0, 0, 0, 0];
  g.space.projectiles.push({ id: 'pr2', kind: 'enemy', x: 1470, y: 1100, angle: 0, speed: 100, ttl: 3, dmg: 1, owner: e.id });
  T.run(0.5);
  ok(ship.systems.engines === 'ok', 'Gegner ohne Systemziel: ungezielt, Wurf verfehlt');
  // ohne Szenenschalter: nichts
  Zs.szeneAn(g, false); e.zielsystem = 'antrieb';
  ship.shields.current = [0, 0, 0, 0];
  g.space.projectiles.push({ id: 'pr3', kind: 'enemy', x: 1470, y: 1100, angle: 0, speed: 100, ttl: 3, dmg: 1, owner: e.id });
  T.run(0.5);
  ok(ship.systems.engines === 'ok', 'ohne Szenenschalter: dasselbe Geschoss lässt das Triebwerk heil');
});

section('Regel als Funktion: Einzelfälle (Verträge der Funktionen, unabhängig von den Haken)', () => {
  const T = setup(); const g = T.g; const ship = g.ship;
  const qx = (e, rel) => [e.x + Math.cos(e.angle + rel) * 60, e.y + Math.sin(e.angle + rel) * 60];
  // trifftGegner: nur Angriffe
  const e = leer(g, 'korvette', 1500, 1100); e.angle = 0; stb(g, e);
  ok(Zs.trifftGegner(g, e, ...qx(e, HECK), {}) === false && e.zs === undefined, 'trifftGegner ohne opts.angriff: kein Systemtreffer (Brocken, Mine, Zone)');
  ok(Zs.trifftGegner(g, e, null, null, { angriff: true }) === false, 'trifftGegner ohne Trefferquelle: nichts');
  // nur das gewählte Ziel: Systemziel auf A, Treffer auf B
  const b = leer(g, 'korvette', 1800, 1300); b.angle = 0; b.scanned = true;
  ok(ship.target === e.id && ship.zielsystem === 'antrieb', 'Systemziel liegt am Ziel A');
  ok(Zs.trifftGegner(g, b, ...qx(b, HECK), { angriff: true }) === false && b.zs === undefined, 'Treffer auf ein anderes Ziel B (kein Szenenschalter): das Systemziel gilt nur für das gewählte Ziel');
  ok(Zs.trifftGegner(g, e, ...qx(e, HECK), { angriff: true }) === true && e.zs.antrieb.s === 1, 'Treffer auf das gewählte Ziel A: Antrieb beschädigt');
  // gestellt (gehalten): weitere Treffer ändern nichts, auch die Frist wird nicht neu gesetzt
  T.run(DATEN.treffer.wert.sperre_s + 0.1); Zs.trifftGegner(g, e, ...qx(e, HECK), { angriff: true });
  Zs.halte(e, 'antrieb');
  const s0 = e.zs.antrieb.s;
  T.run(DATEN.treffer.wert.sperre_s + 0.1);
  Zs.trifftGegner(g, e, ...qx(e, HECK), { angriff: true });
  ok(e.zs.antrieb.s === s0 && e.zs.antrieb.bis === null && e.zs.antrieb.gehalten === true, 'gehalten: ein weiterer Treffer gibt keine Erholungsfrist zurück');
  // trifftLerche: nur durchschlagende Angriffe in Szenen mit Schalter, nur das Heck
  Zs.szeneAn(g, true);
  const k = (r, o) => Zs.trifftLerche(g, 2, r, o);
  ship.systems.engines = 'ok'; delete ship.zsAt;
  ok(k({ hull: 0, systems: [] }, { angriff: true, zielt: 'antrieb' }) === false && ship.systems.engines === 'ok', 'trifftLerche ohne Hüllenschaden (Schild gefangen): Triebwerk heil');
  ok(k({ hull: 5, systems: [] }, { zielt: 'antrieb' }) === false && ship.systems.engines === 'ok', 'trifftLerche ohne opts.angriff (Mine, Brocken): Triebwerk heil');
  ok(Zs.trifftLerche(g, 0, { hull: 5, systems: [] }, { angriff: true, zielt: 'antrieb' }) === false && ship.systems.engines === 'ok', 'trifftLerche am Bug: Triebwerk heil');
  Zs.szeneAn(g, false);
  ok(k({ hull: 5, systems: [] }, { angriff: true, zielt: 'antrieb' }) === false && ship.systems.engines === 'ok', 'trifftLerche ohne Szenenschalter: Triebwerk heil');
  Zs.szeneAn(g, true);
  ok(k({ hull: 5, systems: [] }, { angriff: true, zielt: 'antrieb' }) === true && ship.systems.engines === 'damaged', 'trifftLerche: durchschlagender gezielter Angriff am Heck: Triebwerk beschädigt');
  T.run(DATEN.treffer.wert.sperre_s + 0.1);
  ok(k({ hull: 5, systems: [{ system: 'engines', state: 'damaged' }] }, { angriff: true, zielt: 'antrieb' }) === false && ship.systems.engines === 'damaged', 'derselbe Treffer hat das Triebwerk schon geschädigt (Durchlass-Tabelle): keine zweite Stufe');
});

section('Gegenseite: Ladung der Gegner (Lanze) und Geschosse der Verbündeten tragen die Regel', () => {
  // Ladung einer Korvette hinter der Lerche (Heck der Lerche), Schild 0: die angekündigte Lanze trifft das Heck
  const T = setup(); const g = T.g; const ship = g.ship;
  g.rng.chance = () => false; g.god = false;
  platz(g, 1500, 1100, 0);
  Zs.szeneAn(g, true);
  // Die Lanze der Korvette sitzt am Steuerbord (Bogen 90°): sie steht hinter der Lerche und zeigt mit der Steuerbordseite auf sie (Bug nach oben)
  const e = space.spawnEnemy(g, 'korvette', { x: 1300, y: 1100, facing: -Math.PI / 2, tag: 'zs' });
  e.zielsystem = 'antrieb'; e.vx = 0; e.vy = 0;
  ship.shields.current = [0, 0, 0, 0];
  e.tele = { kind: 'shot', left: 0.02, dur: 2.2, sector: 2, delayed: 0 };
  T.run(0.2);
  ok(g.stats.heavyHits >= 1, 'die Ladung traf die Lerche (Voraussetzung des Tests)');
  ok(ship.systems.engines === 'damaged', 'schwere Ladung eines Gegners mit Systemziel trifft das Heck: Triebwerk beschädigt');
  // dieselbe Ladung ohne Szenenschalter: Triebwerk heil (der Durchlass-Wurf ist abgeschaltet)
  const U = setup(); const h = U.g; h.rng.chance = () => false; h.god = false;
  platz(h, 1500, 1100, 0);
  const e2 = space.spawnEnemy(h, 'korvette', { x: 1300, y: 1100, facing: -Math.PI / 2, tag: 'zs' });
  e2.zielsystem = 'antrieb'; e2.vx = 0; e2.vy = 0; h.ship.shields.current = [0, 0, 0, 0];
  e2.tele = { kind: 'shot', left: 0.02, dur: 2.2, sector: 2, delayed: 0 };
  U.run(0.2);
  ok(h.stats.heavyHits >= 1 && h.ship.systems.engines === 'ok', 'ohne Szenenschalter: dieselbe Ladung lässt das Triebwerk heil');
  // Geschoss eines Verbündeten am Heck eines Gegners: ungezielt (Wurf), nur mit Szenenschalter
  const V = setup(); const w = V.g; w.god = true;
  platz(w, 300, 300, 0);
  const z = space.spawnEnemy(w, 'korvette', { x: 1500, y: 1100, facing: 0, tag: 'zs' }); z.vx = 0; z.vy = 0; z.scanned = true;
  const schuss = (id) => w.space.projectiles.push({ id, kind: 'ally', x: z.x - 30, y: z.y, angle: 0, speed: 60, ttl: 2, dmg: 3 });
  w.rng.chance = () => true;
  schuss('pa0'); V.run(0.3);
  ok(z.zs === undefined, 'Geschoss eines Verbündeten ohne Szenenschalter: kein Systemtreffer');
  Zs.szeneAn(w, true);
  schuss('pa1'); V.run(0.3);
  ok(z.zs && z.zs.antrieb.s === 1, 'Geschoss eines Verbündeten mit Szenenschalter am Heck: Antrieb beschädigt (ungezielt, Wurf gelungen)');
});

section('Snapshot-Größe und Anzeige-Daten', () => {
  const T = setup({ np: 3 }); const g = T.g;
  const es = [];
  for (let i = 0; i < 4; i++) { const e = leer(g, 'korvette', 1200 + i * 150, 1000 + i * 80); e.angle = 0; e.scanned = true; es.push(e); }
  g.ship.target = es[0].id; Zs.waehle(g, 'antrieb');
  for (const e of es) { Zs.szeneAn(g, true); const gz = g.ship.zielsystem; g.ship.zielsystem = 'antrieb'; g.ship.target = e.id; treffer(g, e, HECK, 3); g.ship.zielsystem = gz; }
  const eintraege = () => JSON.stringify(g.snapshot().space.enemies.filter((q) => es.some((e) => e.id === q.id))).length;
  const sz0 = JSON.stringify(g.snapshot().ship.zs || '').length;
  const s0 = eintraege() + sz0;
  const zsAlt = es.map((e) => e.zs);
  for (const e of es) delete e.zs;
  const s1 = eintraege();
  info(`Snapshot-Einträge von 4 beschädigten, gescannten Zielen samt Systemziel: ${s0} B, ohne Schaden: ${s1} B (Zusatz ${s0 - s1} B)`);
  es.forEach((e, i) => { e.zs = zsAlt[i]; });
  ok(s0 - s1 <= 80, 'Zusatz ≤ 80 B für vier Ziele und das Systemziel (je gescanntem Ziel klein)');
  const e = es[0]; e.scanned = false; Zs.szeneAn(g, true); g.ship.zielsystem = 'antrieb'; g.ship.target = e.id; treffer(g, e, HECK, 3);
  ok(!('az' in g.snapshot().space.enemies.find((q) => q.id === e.id)), 'ungescanntes Ziel: kein az im Snapshot (der Schaden bleibt verborgen)');
});

console.log(`\ntest-zielsysteme: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
