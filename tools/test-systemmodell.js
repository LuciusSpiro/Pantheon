'use strict';
// SYS-01 A1a „Das Schiff in Zonen“ (Paket A, Teil 1): Systemmodell der Lerche.
// Integrität je System, Zustände aus den Schwellen, Reparatur auf den Grundwert, Schild hält sicher, Trefferweg
// über die Zonen (Bug, Backbord, Heck, Steuerbord = Sektoren 0–3, Mitte = -1), Durchschlag 'schild' und 'zone',
// Sturm- und Streu-Ausnahmen, Hülle entfällt, Naht des Notfallprotokolls, Weltstand mit Altstand (huelle).
//   node tools/test-systemmodell.js
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const I = require('../server/sim/interior.js');
const D = require('../server/sim/damage.js');
const Weltstand = require('../server/weltstand.js');
const fs = require('fs');
const os = require('os');
const path = require('path');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const near = (a, b, tol) => typeof a === 'number' && Math.abs(a - b) <= tol;
const SM = CONFIG.systemModell;
let G = null;   // aktuelles Spiel (von newGame gesetzt; systemAktiv braucht game.ship)
const ZONE = (z) => I.SYSTEM_ORDER.filter((k) => I.systemSector(k) === z && I.systemAktiv(G, k));
const MITTE = () => ZONE(-1);

// Frisches Spiel ohne Lobby; alle Zonen-Systeme heil, Schilde 0, keine Gegner, Lecks/Feuer leer.
function newGame(seed) {
  const g = new Game({ noStore: true, seed: seed || 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  G = g;
  g.space.enemies = []; g.space.projectiles = [];
  g.ship.fireList = []; g.ship.breachList = [];
  for (const k of I.SYSTEM_ORDER) { g.ship.systems[k] = 'ok'; }
  g.ship.fragile = {}; g.ship.offline = {};
  g.ship.shields.current = [0, 0, 0, 0];
  g.ship.shields.regenHold = 0;
  g.god = false;
  I.integritaetVoll(g);
  return g;
}
const setShield = (g, sec, v) => { g.ship.shields.current[sec] = v; };
const integ = (g, k) => I.integOf(g, k);
const brokenSet = (g) => I.SYSTEM_ORDER.filter((k) => g.ship.systems[k] === 'broken');
const changed = (g, before) => I.SYSTEM_ORDER.filter((k) => g.ship.systems[k] !== before[k] || integ(g, k) !== before.__i[k]);
function snapShot(g) { const o = {}; for (const k of I.SYSTEM_ORDER) o[k] = g.ship.systems[k]; o.__i = {}; for (const k of I.SYSTEM_ORDER) o.__i[k] = integ(g, k); return o; }
// Ein Treffer ohne Schild, Feuer und Lecks werden hier nicht geprüft (eigene Tests).
const hit = (g, sec, dmg, opts) => space.shipHit(g, sec, dmg, opts || {});

function section(title, fn) { console.log('\n[' + title + ']'); try { fn(); } catch (e) { fails++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); } }

// ---------------------------------------------------------------- Konfiguration
section('Konfiguration (SYS-01 A1a, config.systemModell)', () => {
  ok(SM && SM.integ && SM.integ.default === 10 && SM.integ.reactor === 12 && SM.integ.shields === 12, 'Integrität: Standard 10, Reaktor und Schildgenerator 12');
  ok(SM.schwelle === 0.6 && SM.reparatur.damaged === 0.5 && SM.schadenFaktor === 1, 'Schwelle 60 %, Reparatur beschädigt = 50 %, schadenFaktor 1');
  ok(CONFIG.spaceM3b.shieldLeak === undefined && CONFIG.spaceM3b.shieldOverflow === undefined, 'Durchlass-Tabelle und Überlauf aus der Konfiguration entfernt');
  ok(CONFIG.spaceM3.centreChance === undefined && CONFIG.spaceM3.sectorWeight === undefined && CONFIG.spaceM3.neighbourWeight === undefined, 'centreChance, sectorWeight, neighbourWeight entfernt');
  ok(CONFIG.ship.hull === undefined && CONFIG.ship.hullRegen === undefined && CONFIG.emergency.hull === undefined, 'Hülle, Hüllenregeneration und Notfall-Hülle aus der Konfiguration entfernt');
});

// ---------------------------------------------------------------- Integrität und Zustände
section('Integrität und Zustandsschwellen (Regel 1)', () => {
  const g = newGame(3);
  ok(integ(g, 'reactor') === 12 && integ(g, 'shields') === 12 && integ(g, 'battery_port') === 10, 'Start: Maximum je System (Reaktor 12, Schildgenerator 12, Batterie 10)');
  ok(g.snapshot().ship.hull === undefined && g.snapshot().ship.hullMax === undefined, 'Snapshot: keine Hülle mehr');
  const sn = g.snapshot().ship;
  ok(Array.isArray(sn.integ) && sn.integ.length === I.SYSTEM_ORDER.length && sn.integPct === 100, `Snapshot: integ je System (${sn.integ.length} Felder), integPct 100`);
  const b = 'battery_port';
  I.systemTreffer(g, b, 4);
  ok(integ(g, b) === 6 && g.ship.systems[b] === 'ok', 'Schaden 4: Integrität 6, noch ok (Schwelle 60 % = 6, darunter beschädigt)');
  const r1 = I.systemTreffer(g, b, 1);
  ok(integ(g, b) === 5 && g.ship.systems[b] === 'damaged' && r1 && r1.state === 'damaged', 'Schaden 1 mehr: Integrität 5 -> beschädigt');
  I.systemTreffer(g, b, 5);
  ok(integ(g, b) === 0 && g.ship.systems[b] === 'broken', 'Integrität 0 -> zerstört');
  ok(I.systemTreffer(g, b, 3) === null && integ(g, b) === 0, 'zerstört bleibt zerstört, Punkte bleiben 0');
  const rc = 'reactor';
  I.systemTreffer(g, rc, 11);
  ok(integ(g, rc) === 1 && g.ship.systems[rc] === 'damaged', 'Reaktor (12): 11 Schaden -> 1 Punkt, beschädigt');
  I.systemTreffer(g, rc, 1);
  ok(g.ship.systems[rc] === 'broken', 'Reaktor (12): genau 12 Schaden -> zerstört');
});

section('Reparatur setzt den Grundwert der Stufe (Regel 1)', () => {
  const g = newGame(4);
  const s = 'thruster_port';
  I.systemTreffer(g, s, 10);
  ok(g.ship.systems[s] === 'broken' && integ(g, s) === 0, 'zerstört: 0 Punkte');
  I.repairSystem(g, s, 'player', 'minigame');
  ok(g.ship.systems[s] === 'damaged' && near(integ(g, s), 5, 1e-9), `Reparatur zerstört -> beschädigt: Grundwert 50 % (${integ(g, s)} von 10)`);
  I.repairSystem(g, s, 'player', 'swap');
  ok(g.ship.systems[s] === 'ok' && integ(g, s) === 10, 'Reparatur beschädigt -> ok: Maximum');
  I.systemTreffer(g, s, 6);
  ok(g.ship.systems[s] === 'damaged', 'Vorbereitung: beschädigt');
  I.repairSystem(g, s, 'player', 'flick');
  ok(g.ship.systems[s] === 'ok' && integ(g, s) === 10 && I.isFragile(g, s), 'Flicken: beschädigt -> ok, Maximum, geflickt');
  // Geflicktes bricht beim nächsten Treffer direkt
  const r = I.trefferweg(g, 1, 1);
  ok(r && g.ship.systems[s] === 'ok', 'Treffer in einer anderen Zone lässt geflicktes System stehen');
  const r2 = I.systemTreffer(g, s, 0.5);
  ok(g.ship.systems[s] === 'broken' && !I.isFragile(g, s) && r2 && r2.state === 'broken', 'Geflicktes System bricht beim Treffer direkt (Flag weg)');
});

// ---------------------------------------------------------------- Schild und Trefferweg
section('Schild hält sicher (Regel 2)', () => {
  const g = newGame(5);
  setShield(g, 1, 4);
  const b = snapShot(g);
  const r = D.resolveHit(g, 1, 3, {});
  ok(r.absorbed === 3 && r.rest === 0 && r.systems.length === 0, `Schild 4, Treffer 3: alles absorbiert, kein Systemschaden, kein Überlauf (absorbed ${r.absorbed})`);
  ok(g.ship.shields.current[1] === 1 && changed(g, b).length === 0, 'Schild 4 -> 1, keine Integrität verändert');
  const r2 = D.resolveHit(g, 1, 5, {});
  ok(r2.absorbed === 1 && r2.rest === 0 && r2.systems.length === 0, 'Schild 1, Treffer 5: nur min(Schild, Schaden) = 1, Rest 4 verfällt (kein Überlauf)');
  ok(g.ship.shields.current[1] === 0 && changed(g, b).length === 0, 'Schild auf 0, trotzdem kein Systemschaden in diesem Treffer');
  // Schild 0 trifft ein System, mit Überlauf kein Schild-Rest
  const b2 = snapShot(g);
  const r3 = D.resolveHit(g, 1, 2, {});
  ok(r3.absorbed === 0 && r3.rest === 2 && r3.systems.length === 1 && changed(g, b2).length === 1, 'Schild 0, Treffer 2: Rest 2 trifft genau ein System');
});

section('Trefferweg ohne Schild: Zone des Sektors aus allen vier Richtungen (Regel 3)', () => {
  for (let sec = 0; sec < 4; sec++) {
    const g = newGame(10 + sec);
    const opp = ZONE((sec + 2) % 4); const mitte = MITTE();
    let treffer = 0, inZone = 0, gegen = 0, mitteOhneZone = 0, mitteMitZone = 0;
    for (let i = 0; i < 60; i++) {
      const zoneOffen = ZONE(sec).some((k) => g.ship.systems[k] !== 'broken');
      const r = D.resolveHit(g, sec, 1, {});
      for (const t of r.systems) {
        treffer++;
        if (ZONE(sec).includes(t.system)) inZone++;
        if (opp.includes(t.system)) gegen++;
        if (mitte.includes(t.system)) { if (zoneOffen) mitteMitZone++; else mitteOhneZone++; }
      }
    }
    ok(treffer >= 20 && gegen === 0 && mitteMitZone === 0 && inZone + mitteOhneZone === treffer, `Sektor ${sec}: ${treffer} Treffer, ${inZone} in der Zone, Gegenseite ${gegen} (Soll 0), Mitte nur bei leerer Zone (${mitteOhneZone}, bei offener Zone ${mitteMitZone})`);
  }
});

section('Kein Treffer auf ein zerstörtes System, solange die Zone nicht leer ist (Regel 3)', () => {
  for (const seed of [1, 7, 42]) {
    const g = newGame(seed);
    let verstoesse = 0, zufallTreffer = 0;
    for (let i = 0; i < 400; i++) {
      const zone = i % 4;
      const vorher = new Set(brokenSet(g));
      const nichtZerstoert = ZONE(zone).filter((k) => !vorher.has(k));
      const r = I.trefferweg(g, zone, 1);
      if (!r) break;
      if (vorher.has(r.system)) verstoesse++;
      if (nichtZerstoert.length) { zufallTreffer++; if (!nichtZerstoert.includes(r.system)) verstoesse++; }
      if (!nichtZerstoert.length && !MITTE().some((k) => !vorher.has(k))) break;
    }
    ok(verstoesse === 0 && zufallTreffer > 100, `Seed ${seed}: ${zufallTreffer} Treffer, keiner auf ein zerstörtes System (Verstöße ${verstoesse})`);
  }
});

section('Zone leer -> Mitte (Regel 3)', () => {
  const g = newGame(20);
  for (const k of ZONE(0)) { g.ship.systems[k] = 'broken'; I.setInteg(g, k, 0); }
  let mitte = 0, sonst = 0;
  for (let i = 0; i < 80; i++) {
    const r = I.trefferweg(g, 0, 1);
    if (!r) break;
    if (I.systemSector(r.system) === -1) mitte++; else sonst++;
    // Mitte-Systeme werden nicht zerstört, solange sie heil sind; hier genügt die Richtung
    if (g.ship.systems[r.system] === 'broken') { /* zerstört, nächster Treffer wählt anders */ }
  }
  ok(sonst === 0 && mitte > 20, `Zone 0 leer: alle Treffer in der Mitte (Mitte ${mitte}, andere ${sonst})`);
  const g2 = newGame(21);
  for (const k of I.SYSTEM_ORDER) { if (I.systemSector(k) === 2 || I.systemSector(k) === -1) { g2.ship.systems[k] = 'broken'; I.setInteg(g2, k, 0); } }
  ok(I.trefferweg(g2, 2, 1) === null, 'Zone und Mitte beide zerstört: kein Ziel (null), kein Systemschaden');
});

// ---------------------------------------------------------------- Durchschlag
section('Durchschlag (Regel 2)', () => {
  const g = newGame(30);
  setShield(g, 0, 4);
  const b = snapShot(g);
  const r = D.resolveHit(g, 0, 2, { durchschlag: 'schild' });
  ok(r.systems.length === 1 && g.ship.shields.current[0] === 4 && changed(g, b).length === 1, 'Durchschlag Schild: Schild 4 ignoriert, Treffer geht ins System der Zone');
  const g2 = newGame(31);
  let mitte = 0, zone = 0;
  for (let i = 0; i < 80; i++) {
    const r2 = D.resolveHit(g2, 1, 1, { durchschlag: 'zone' });
    for (const t of r2.systems) { if (I.systemSector(t.system) === -1) mitte++; else zone++; }
    if (g2.space) void 0;
  }
  ok(zone === 0 && mitte > 20, `Durchschlag Zone: Treffer nur in der Mitte (Mitte ${mitte}, Zone ${zone})`);
  // Zahl: Schild um so viele Punkte schwächer
  const g3 = newGame(32);
  setShield(g3, 3, 3);
  const r3 = D.resolveHit(g3, 3, 3, { pierce: 2 });
  ok(near(r3.absorbed, 1, 1e-9) && r3.rest === 0 && r3.systems.length === 0 && g3.ship.shields.current[3] === 2, 'Durchschlag Zahl 2 bei Schild 3: wirksamer Schild 1 hält (absorbiert 1, Rest verfällt, kein Systemschaden)');
  const g4 = newGame(33);
  setShield(g4, 3, 2);
  const b4 = snapShot(g4);
  const r4 = D.resolveHit(g4, 3, 3, { pierce: 2 });
  ok(r4.absorbed === 0 && r4.rest === 3 && r4.systems.length === 1 && changed(g4, b4).length === 1, 'Durchschlag Zahl 2 bei Schild 2: wirksamer Schild 0, Rest 3 trifft ein System');
});

// ---------------------------------------------------------------- Sturm und Streu
section('Sturmbatterie und Streu-Granate (Regel 2, Ausnahmen)', () => {
  const g = newGame(40);
  setShield(g, 2, 4);
  const b = snapShot(g);
  const r = D.resolveHit(g, 2, 2, { sturm: true });
  ok(r.systems.length === 0 && g.ship.shields.regenHold > g.time && g.ship.shields.current[2] > 3, `Sturm gegen vollen Schild: kein Systemschaden, Regeneration gesperrt (Schild ${g.ship.shields.current[2]})`);
  void b;
  // niedriger Schild: Systemchance ST.systemChance, kleiner Integritätsschaden
  let sys = 0; const N = 3000; const g2 = newGame(41);
  for (let i = 0; i < N; i++) {
    I.integritaetVoll(g2); for (const k of I.SYSTEM_ORDER) g2.ship.systems[k] = 'ok';
    setShield(g2, 0, 1);
    const b2 = snapShot(g2);
    D.resolveHit(g2, 0, 1, { sturm: true });
    if (changed(g2, b2).length) sys++;
  }
  const ST = require('../shared/schiffskatalog.js').waffe('sturmbatterie').sturm;
  ok(near(sys / N, ST.systemChance, 0.03), `Sturm bei niedrigem Schild: Systemchance ${(100 * sys / N).toFixed(1)} % (Soll ${(100 * ST.systemChance).toFixed(0)} % ± 3)`);
  // Streu: eine Granate = Schildschaden, nie Systemschaden
  const g3 = newGame(42);
  setShield(g3, 1, 4);
  const b3 = snapShot(g3);
  D.resolveHit(g3, 1, 2, { streu: { schildFaktor: 1.5 } });
  ok(changed(g3, b3).length === 0 && g3.ship.shields.current[1] < 4, 'Streu-Granate: Schildschaden, kein Systemschaden');
  // zweite Granate im Fenster: sicherer Systemschaden (Durchschlag 3, ohne Schild)
  const g4 = newGame(43);
  setShield(g4, 1, 4);
  const b4 = snapShot(g4);
  hit(g4, 1, 3, { pierce: true, streuZwei: true });
  ok(changed(g4, b4).length === 1, 'zweite Streu-Granate: trifft sicher ein System, auch bei vollem Schild (Durchschlag)');
});

// ---------------------------------------------------------------- Hülle, Lecks, Feuer, Naht
section('Hülle entfällt, Lecks aus Treffern entfallen (Regel 5, 7)', () => {
  const g = newGame(50);
  g.ship.breachList = [];
  for (let i = 0; i < 200; i++) { setShield(g, i % 4, 0); hit(g, i % 4, 1, {}); }
  ok(g.ship.breachList.length === 0, 'Treffer ohne Schild erzeugen keine Lecks');
  ok(g.ship.hull === undefined && g.ship.hullMax === undefined, 'ship.hull und hullMax existieren nicht mehr');
  const brk = [];
  for (let i = 0; i < 100; i++) { g.ship.breachList = []; I.updateHazards(g, 0.5); brk.push(g.ship.hull); }
  ok(brk.every((v) => v === undefined), 'Lecks ziehen keine Hülle (hullPerSec entfällt)');
  g.ship.breachList = [{ tx: 1, ty: 1, t: 0 }];
  g.ship.systems.battery_port = 'ok';
  I.updateHazards(g, 1);
  ok(g.ship.hull === undefined, 'offenes Leck: Hülle bleibt ohne Bedeutung');
});

section('Naht des Notfallprotokolls (Regel 6)', () => {
  const g = newGame(60);
  g.inventory.marks = 120;
  const em0 = g.stats.emergencies;
  space.verlustAusloesen(g, 'test');
  ok(g.stats.emergencies === em0 + 1 && g.inventory.marks === 70, `verlustAusloesen: Zähler +1 (${g.stats.emergencies}), Marken −50 (${g.inventory.marks})`);
  ok(g.inventory.marks === 70 && g.ship.fireList.length === 0 && g.ship.breachList.length === 0, 'Lecks und Feuer abgedichtet wie im alten Protokoll');
  const g2 = newGame(61);
  for (const k of I.SYSTEM_ORDER) { g2.ship.systems[k] = 'broken'; I.setInteg(g2, k, 0); }
  const em1 = g2.stats.emergencies;
  for (let i = 0; i < 300; i++) g2.step();
  ok(g2.stats.emergencies === em1, 'Kein automatischer Verlust: auch ohne Systeme, ohne Reaktor und ohne Schild löst nichts das Protokoll aus');
  ok(typeof space.checkEmergency === 'undefined', 'checkEmergency gibt es nicht mehr (Hüllenprüfung entfällt)');
});

section('Alarm und Zonen-Auswertung', () => {
  const g = newGame(70);
  ok(I.schwaechsteZone(g) && near(I.schwaechsteZone(g).anteil, 1, 1e-9), 'Schwächste Seite: 100 % am Start');
  for (const k of ZONE(3)) { I.setInteg(g, k, 0); g.ship.systems[k] = 'broken'; }
  const sz = I.schwaechsteZone(g);
  ok(sz && sz.zone === 3 && sz.anteil === 0, `Schwächste Seite erkennt die leere Backbordzone (Zone ${sz && sz.zone}, Anteil ${sz && sz.anteil})`);
});

// ---------------------------------------------------------------- Module in der Mitte (Regel 4): Übergang
section('Module in der Mitte (Regel 4): Übergang, noch ohne Zustand', () => {
  // Der Modul-Schadenszustand ist in A1a noch nicht umgesetzt. Hier nur der Stand, damit eine spätere Umsetzung
  // gegen diesen Test läuft: Frachtraum, Krankenstation, Werkstatt liegen heute nicht in SYSTEM_ORDER.
  const mod = ['frachtraum', 'krankenstation', 'werkstatt'];
  ok(mod.every((m) => !I.SYSTEM_ORDER.includes(m)), 'Module sind noch keine Systeme mit Zustand (Übergang, Paket A1a Teil 2)');
});

// ---------------------------------------------------------------- Weltstand
section('Weltstand: Altstand mit huelle (Regel 8)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-systemmodell-'));
  const g = newGame(80);
  g.ship.systems.shields = 'damaged'; I.setInteg(g, 'shields', 5);
  const data = Weltstand.capture ? Weltstand.capture(g) : null;
  ok(data && data.schiff && data.schiff.huelle === undefined && data.schiff.integ === undefined, 'Speicherstand schreibt kein huelle und kein integ mehr');
  const alt = JSON.parse(JSON.stringify(data || {}));
  alt.schiff = Object.assign({}, alt.schiff || {}, { huelle: 42, systeme: { shields: 'damaged', engines: 'ok' } });
  const g2 = newGame(81);
  Weltstand.apply(g2, alt);
  ok(g2.ship.systems.shields === 'damaged' && g2.ship.systems.engines === 'ok', 'Altstand lädt: Zustände übernommen');
  ok(near(integ(g2, 'shields'), SM.integ.shields * SM.reparatur.damaged, 1e-9), `Altstand: beschädigter Schildgenerator bekommt den Grundwert (${integ(g2, 'shields')})`);
  ok(integ(g2, 'battery_port') === 10 && g2.ship.hull === undefined, 'Altstand: huelle 42 ignoriert, übrige Systeme auf Maximum');
  void dir;
  void fs.rmSync;
});

// ---------------------------------------------------------------- Testhelfer-Kompatibilität
section('Protokoll', () => {
  ok(Array.isArray(Protocol.DEBUG_CMDS || []) || true, 'Protokoll lädt');
  const ds = (Protocol.DEBUG_CMDS || []);
  ok(!ds.includes('hull') && ds.includes('verlust'), 'Debug-Befehl hull entfällt, verlust kommt dazu');
});

console.log('\n' + (fails ? `${fails} FEHLER von ${n}` : `${n}/${n} ok`) + ' (SYS-01 A1a Systemmodell)');
process.exit(fails ? 1 : 0);
