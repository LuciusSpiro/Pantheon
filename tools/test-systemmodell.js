'use strict';
// SYS-01 A1a „Das Schiff in Zonen“ (Paket A, Teil 1): Systemmodell der Lerche.
// SYS-01 A1b (Paket A, Teil 2): Minen über die nächste Zone, Dauerdruck als Systemtreffer, Frachtraum-Verlust nur am Modul,
// Notfallsprung-Kosten, Torpedo als ein System der Zone, Rückschlag je Treffer und Zone genau einmal.
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

// ---------------------------------------------------------------- Module in der Mitte (Regel 4)
section('Module in der Mitte (Regel 4): Zustand, Trefferweg, Funktion, Reparatur', () => {
  const Modul = require('../server/sim/module.js');
  const g = newGame(90);
  const ms = ['modul_1', 'modul_2'];   // Start-Lerche: Frachtraum (Raum 1), Krankenstation (Raum 2)
  ok(ms.every((m) => I.SYSTEM_ORDER.includes(m) && I.systemSector(m) === -1 && I.systemAktiv(g, m)), 'Module der Start-Lerche sind Systeme der Mitte (Sektor -1) und aktiv');
  ok(!I.systemAktiv(g, 'modul_3') && !I.systemAktiv(g, 'modul_4'), 'Leere Modulräume sind keine Systeme (kein Trefferziel)');
  ok(ms.every((m) => g.ship.systems[m] === 'ok' && integ(g, m) === SM.integ.default), 'Start: ok, Integrität = Standardmaximum');
  ok(ms.every((m) => MITTE().includes(m)) && MITTE().includes('reactor') && MITTE().includes('shields'), 'Mitte = Reaktor, Schildgenerator und die Module');
  const sn = g.snapshot().ship;
  ok(ms.every((m) => sn.systems[m] === 'ok') && sn.systems.modul_3 === undefined, 'Snapshot: aktive Module mit Zustand, leere Räume fehlen');

  // 1. Zugewandte Zone nicht leer: Module bleiben heil (wie Reaktor und Schildgenerator)
  let anyMid = 0;
  for (let i = 0; i < 40; i++) { const b = snapShot(g); hit(g, 0, 3); for (const k of MITTE()) if (g.ship.systems[k] !== b[k] || integ(g, k) !== b.__i[k]) anyMid++; if (i % 6 === 5) { for (const k of I.SYSTEM_ORDER) g.ship.systems[k] = 'ok'; I.integritaetVoll(g); } }
  ok(anyMid === 0, 'Treffer auf eine Zone mit lebenden Systemen: Mitte (auch Module) bleibt unberührt');

  // 2. Durchschlag 'zone' trifft die Mitte, und zwar auch die Module
  const g2 = newGame(91);
  const treffer = new Set();
  for (let i = 0; i < 60; i++) { const r = hit(g2, 0, 3, { durchschlag: 'zone' }); for (const s of r.systems || []) treffer.add(s.system); I.integritaetVoll(g2); for (const k of I.SYSTEM_ORDER) g2.ship.systems[k] = 'ok'; }
  ok(treffer.has('modul_1') && treffer.has('modul_2') && [...treffer].every((k) => MITTE().includes(k)), `Durchschlag 'zone': trifft nur die Mitte, Module sind Ziele (${[...treffer].join(', ')})`);

  // 3. Leere zugewandte Zone: der Überlauf geht in die Mitte, Module sind dabei
  const g3 = newGame(92);
  for (const k of ZONE(0)) { g3.ship.systems[k] = 'broken'; I.setInteg(g3, k, 0); }
  const t3 = new Set();
  for (let i = 0; i < 60; i++) { const r = hit(g3, 0, 3); for (const s of r.systems || []) t3.add(s.system); for (const k of MITTE()) { g3.ship.systems[k] = 'ok'; I.setInteg(g3, k, I.integMax(g3, k)); } }
  ok(t3.has('modul_1') && t3.has('modul_2') && [...t3].every((k) => MITTE().includes(k)), `Leere Bugzone: Treffer gehen in die Mitte inkl. Module (${[...t3].join(', ')})`);

  // 4. Zustände: ok -> beschädigt -> zerstört über Integrität
  const g4 = newGame(93);
  I.systemTreffer(g4, 'modul_2', 5);
  ok(g4.ship.systems.modul_2 === 'damaged' && integ(g4, 'modul_2') === 5, 'Modul beschädigt bei Integrität < 60 %');
  const tick = (gg) => space.update(gg, 0.1);   // Leistung und Modul-Wirkung werden im Raumtick neu bestimmt
  tick(g4);
  ok(Modul.liste(g4).find((m) => m.raum === 2).lauf === true, 'Beschädigtes Modul läuft wie heute');
  I.systemTreffer(g4, 'modul_2', 5);
  ok(g4.ship.systems.modul_2 === 'broken' && integ(g4, 'modul_2') === 0, 'Modul zerstört bei Integrität 0');

  // 5. Zerstörtes Modul funktioniert nicht
  tick(g4);
  const kr = Modul.liste(g4).find((m) => m.id === 'krankenstation');
  ok(kr.lauf === false && !Modul.laeuft(g4, 'krankenstation'), 'Zerstörte Krankenstation läuft nicht');
  I.systemTreffer(g4, 'modul_1', 10);
  tick(g4);
  ok(g4.ship.systems.modul_1 === 'broken' && Modul.liste(g4).find((m) => m.id === 'frachtraum').lauf === false, 'Zerstörter Frachtraum läuft nicht');
  const Fr = require('../server/sim/fracht.js');
  ok(Fr.gesichert(g4) === false, 'Zerstörter Frachtraum: Ladung ungesichert (Wirkung folgt dem Lauf-Zustand)');

  // 6. Reparatur über den bestehenden Weg (repairSystem), Station im Modulraum
  ok(I.repairable(g4, 'modul_2') && I.stationInReach !== undefined, 'Zerstörtes Modul ist reparierbar');
  const W = require('../server/world.js');
  ok(W.STATIONS.some((s) => s.system === 'modul_1') && W.STATIONS.some((s) => s.system === 'modul_2'), 'Jedes Modul hat eine Station im Modulraum (Reparatur, Brandeskalation)');
  ok(I.repairSystem(g4, 'modul_2', 'player', 'minigame') !== false && g4.ship.systems.modul_2 === 'damaged' && near(integ(g4, 'modul_2'), SM.integ.default * SM.reparatur.damaged, 1e-9), 'Reparatur: zerstört -> beschädigt (Grundwert 50 %)');
  tick(g4);
  ok(Modul.liste(g4).find((m) => m.raum === 2).lauf === true, 'Repariertes Modul (beschädigt) läuft wieder');
  I.repairSystem(g4, 'modul_2', 'player', 'minigame');
  ok(g4.ship.systems.modul_2 === 'ok' && integ(g4, 'modul_2') === SM.integ.default, 'Zweite Reparatur: ok, volle Integrität');

  // 7. Ausgebautes Modul nimmt den Schaden nicht mit
  Modul.entfernen(g4, 'krankenstation', 2);
  I.inaktiveHeilen(g4);
  ok(!I.systemAktiv(g4, 'modul_2') && g4.ship.systems.modul_2 === 'ok', 'Modul ausgebaut: Raum ist kein System mehr');
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
section('SYS-01 A1b: Mine trifft die nächste Zone, Schilde gelten nicht (Punkt 1)', () => {
  const Alarm = require('../server/sim/alarm.js');
  const Phys = require('../shared/physics.js');
  for (const [dx, dy] of [[40, 0], [0, 40], [-40, 0], [0, -40]]) {
    const g = newGame(31);
    g.ship.x = 1500; g.ship.y = 800; g.ship.angle = 0; g.ship.docked = false; g.ship.shields.current = [3, 3, 3, 3];
    const m = { id: 9001, x: g.ship.x + dx, y: g.ship.y + dy, besitzer: 'gegner' };
    g.space.minen = [m];
    const zone = Phys.sectorOf(g.ship.x, g.ship.y, g.ship.angle, m.x, m.y);
    const s0 = snapShot(g);
    Alarm.explodiere(g, m, 'test');
    const ch = changed(g, s0);
    const verlust = I.SYSTEM_ORDER.reduce((a, k) => a + (s0.__i[k] - integ(g, k)), 0);
    ok(g.ship.shields.current.every((v) => v === 3), `Mine (Richtung ${dx},${dy}, Zone ${zone}): Schilde unberührt`);
    ok(near(verlust, CONFIG.alarm.mine.punkte, 0.01) && ch.length >= 1 && ch.every((k) => I.systemSector(k) === zone), `Mine: ${CONFIG.alarm.mine.punkte} Integrität aus der nächsten Zone (${ch.join(',') || 'keins'})`);
  }
});

section('SYS-01 A1b: Gegner-Torpedo gegen die Lerche = ein System der Zone (Punkt 5)', () => {
  const g = newGame(33); g.ship.shields.current = [0, 0, 0, 0];
  ok(CONFIG.systemModell.torpedoLerche === 10, 'Startwert torpedoLerche 10 (ein Standardsystem wird sicher zerstört)');
  const s0 = snapShot(g);
  space.etorpedoTreffer(g, { x: g.ship.x + 30, y: g.ship.y, dmg: CONFIG.systemModell.torpedoLerche });
  const ch = changed(g, s0);
  ok(ch.length === 1 && I.systemSector(ch[0]) === 0 && g.ship.systems[ch[0]] === 'broken', `Torpedo bei Schild 0: genau ein System der Bugzone zerstört (${ch.join(',')})`);
});

section('SYS-01 A1b: Frachtraum-Verlust nur bei Treffer auf das Modul (Punkt 3)', () => {
  const Fracht = require('../server/sim/fracht.js'); const Modul = require('../server/sim/module.js');
  const g = newGame(43);
  const fr = Modul.liste(g).find((m) => m.id === 'frachtraum');
  ok(!!fr, 'Start-Lerche hat einen Frachtraum');
  Fracht.anBordLegen(g, 'fracht'); fr.an = false; g.ship.shields.current = [0, 0, 0, 0];
  hit(g, 0, 1, {});   // Treffer auf die Bugzone, nicht auf das Modul
  ok(Fracht.anBord(g) === 1 && Fracht.draussen(g).length === 0, 'ungesicherter Frachtraum, Treffer auf die Bugzone: keine Ladung verloren');
});

section('SYS-01 A1b: Notfallsprung beschädigt ein zufälliges ok-System (Punkt 4)', () => {
  const S = require('../server/sim/sprung.js');
  const g = newGame(37);
  const k = S.notsprungSchaden(g);
  ok(!!k && k !== 'reactor' && g.ship.systems[k] === 'damaged', `Notsprung: ${k} ist beschädigt (ok → beschädigt, nicht der Reaktor)`);
  const g2 = newGame(41); for (const sy of I.SYSTEM_ORDER) if (sy !== 'reactor') g2.ship.systems[sy] = 'damaged';
  const s2 = snapShot(g2);
  ok(S.notsprungSchaden(g2) === null && changed(g2, s2).length === 0, 'kein ok-System: der Notsprung bewirkt nichts');
  const a = newGame(45); const b = newGame(45);
  ok(S.notsprungSchaden(a) === S.notsprungSchaden(b), 'deterministisch über game.rng (gleicher Seed, gleiches System)');
});

section('SYS-01 A1b: Rückschlag der Reparatur genau einmal je Treffer und Zone (Punkt 7)', () => {
  const D = require('../server/sim/damage.js');
  const g = newGame(35); g.ship.shields.current = [0, 0, 0, 0];
  g.players = [{ id: 'p1', hold: { kind: 'flick', system: 'emitter_bow', t: 5 } }];   // laufende Reparatur in der Bugzone
  let n = 0; const emit0 = g.emit.bind(g);
  g.emit = (name, data) => { if (name === 'repairSetback') n++; return emit0(name, data); };
  hit(g, 0, 6, {});   // ein Treffer, ein Systemschaden in der Bugzone
  ok(n === 1, `ein Treffer, ein Systemschaden: genau ein Rückschlag (${n})`);
  n = 0; const out = { systems: [] };
  D.rueckschlag(g, out, 0); D.rueckschlag(g, out, 0);
  ok(n === 1, `zweimal dieselbe Zone im selben Treffer: nur ein Rückschlag (${n})`);
  n = 0; hit(g, 0, 6, {}); hit(g, 0, 6, {});
  ok(n === 2, `zwei Treffer: zwei Rückschläge (${n})`);
});

// ---------------------------------------------------------------- SYS-01 A1 Nacharbeit: Zustand und Integrität gehen nie auseinander
// Invariante: ok => Integrität >= Schwelle, beschädigt => > 0 und < Schwelle, zerstört => 0. Offline (EMP) zählt als die vorgemerkte Stufe (prev).
function inkonsistent(g) {
  const bad = [];
  for (const k of I.SYSTEM_ORDER) {
    let st = g.ship.systems[k];
    if (st === 'offline') { const o = g.ship.offline[k]; st = (o && o.prev) || 'ok'; }
    const v = integ(g, k); const max = I.integMax(g, k); const sw = SM.schwelle * max;
    const passt = st === 'ok' ? v >= sw : st === 'damaged' ? (v > 0 && v < sw) : st === 'broken' ? v === 0 : false;
    if (!passt) bad.push(`${k} ${st}/${v}`);
  }
  return bad;
}
const invariante = (g, t) => { const b = inkonsistent(g); ok(b.length === 0, t + (b.length ? ' – ' + b.slice(0, 4).join(', ') : '')); };
const W_ = require('../server/world.js');
const platzVon = (sys) => W_.Maps.WAFFENPLAETZE.find((p) => p.system === sys).platz;

section('Nacharbeit 1: Flottenneustart behält den Zustand, die Integrität folgt ihm', () => {
  const Flotte = require('../server/sim/flotte.js');
  const g = newGame(101);
  I.damageSystem(g, 'engines', 'damaged', { quiet: true }); I.damageSystem(g, 'battery_port', 'broken', { quiet: true }); I.damageSystem(g, 'reactor', 'damaged', { quiet: true });
  Flotte.neustart(g);
  ok(g.ship.systems.engines === 'damaged' && integ(g, 'engines') === 5, `engines beschädigt bleibt beschädigt, 5 von 10 (${g.ship.systems.engines}/${integ(g, 'engines')})`);
  ok(g.ship.systems.battery_port === 'broken' && integ(g, 'battery_port') === 0, `battery_port zerstört bleibt zerstört, 0 (${g.ship.systems.battery_port}/${integ(g, 'battery_port')})`);
  ok(g.ship.systems.reactor === 'damaged' && integ(g, 'reactor') === 6, `Reaktor beschädigt: 6 von 12 (${integ(g, 'reactor')})`);
  ok(g.ship.systems.shields === 'ok' && integ(g, 'shields') === 12, 'heile Systeme: Maximum');
  invariante(g, 'Neustart: Zustand und Integrität konsistent');
  // EMP-Pause: die vorgemerkte Stufe zählt
  const g2 = newGame(102);
  I.damageSystem(g2, 'engines', 'damaged', { quiet: true }); I.setOffline(g2, 'engines', 30); I.damageSystem(g2, 'transfer', 'broken', { quiet: true });
  Flotte.neustart(g2);
  ok(g2.ship.systems.engines === 'offline' && integ(g2, 'engines') === 5, 'Neustart während EMP: Integrität nach vorgemerkter Stufe (beschädigt = 5)');
  invariante(g2, 'Neustart mit EMP: konsistent');
});

section('Nacharbeit 2: Bestückung, Ausbau, Reset und Mission halten Zustand und Integrität zusammen', () => {
  const Waffen = require('../server/sim/schiffswaffen.js');
  const Reset = require('../server/sim/szenenreset.js');
  const Registry = require('../server/mission/registry.js');
  const Modul = require('../server/sim/module.js');
  // Bestückung: zerstörte Batterie neu bestückt = ok, volle Punkte; der nächste Treffer zerstört sie nicht
  const g = newGame(103); const pl = platzVon('battery_port');
  I.systemTreffer(g, 'battery_port', 10);
  ok(g.ship.systems.battery_port === 'broken', 'Vorbereitung: Batterie zerstört');
  ok(Waffen.bestuecken(g, pl, 'standardbatterie') === null, 'Batterie neu bestückt');
  ok(g.ship.systems.battery_port === 'ok' && integ(g, 'battery_port') === 10, `neu bestückt: ok mit Maximum (${g.ship.systems.battery_port}/${integ(g, 'battery_port')})`);
  I.systemTreffer(g, 'battery_port', 3);
  ok(g.ship.systems.battery_port === 'ok' && integ(g, 'battery_port') === 7, 'der nächste Treffer (3) zerstört sie nicht (7 von 10, ok)');
  invariante(g, 'nach Bestückung');
  // Umrüsten (Werft) behält Zustand und Punkte
  I.systemTreffer(g, 'battery_port', 5);
  Waffen.umruesten(g, pl, 'standardbatterie');
  ok(g.ship.systems.battery_port === 'damaged' && integ(g, 'battery_port') === 2, 'Werft-Umbau behält Zustand und Punkte');
  // Platz leeren und Schaden darauf: inaktive Waffensysteme stehen heil da
  Waffen.bestuecken(g, pl, 'leer');
  I.damageSystem(g, 'battery_port', 'broken', { quiet: true });
  I.inaktiveHeilen(g);
  ok(g.ship.systems.battery_port === 'ok' && integ(g, 'battery_port') === 10, 'inaktive Waffe: inaktiveHeilen setzt ok und Maximum');
  invariante(g, 'nach inaktiveHeilen (Waffe)');
  // Module: ausgebautes Modul nimmt Schaden nicht mit, vorher zerstörtes aktives bleibt zerstört
  const gm = newGame(104);
  I.systemTreffer(gm, 'modul_2', 5); I.systemTreffer(gm, 'modul_1', 10);   // Krankenstation beschädigt, Frachtraum zerstört
  ok(gm.ship.systems.modul_2 === 'damaged' && gm.ship.systems.modul_1 === 'broken', 'Vorbereitung: Krankenstation beschädigt, Frachtraum zerstört');
  Modul.entfernen(gm, 'krankenstation', 2);
  I.inaktiveHeilen(gm);
  ok(gm.ship.systems.modul_2 === 'ok' && integ(gm, 'modul_2') === 10, `ausgebautes beschädigtes Modul: ok und Maximum (${gm.ship.systems.modul_2}/${integ(gm, 'modul_2')})`);
  ok(gm.ship.systems.modul_1 === 'broken' && integ(gm, 'modul_1') === 0, 'aktives zerstörtes Modul bleibt zerstört (inaktiveHeilen heilt nur Inaktives)');
  invariante(gm, 'nach inaktiveHeilen (Modul)');
  // Rücksetzer
  const gr = newGame(105); I.systemTreffer(gr, 'engines', 7); I.systemTreffer(gr, 'shields', 12);
  Reset.zuruecksetzen(gr);
  ok(I.SYSTEM_ORDER.every((k) => gr.ship.systems[k] === 'ok' && integ(gr, k) === I.integMax(gr, k)), 'Szenen-Reset: alles ok, Maximum');
  invariante(gr, 'nach Szenen-Reset');
  // Missionsweg: ship_incident (Hafenübung) und debug_clear_incidents
  const gi = newGame(106); const m = { game: gi, isDrillStep: () => true, tpl: (t) => t };
  Registry.get('ship_incident').run(m, { system: 'transfer', state: 'broken', fires: 0, breaches: 0 });
  ok(gi.ship.systems.transfer === 'broken' && integ(gi, 'transfer') === 0, `ship_incident broken: Zustand und 0 Punkte (${integ(gi, 'transfer')})`);
  invariante(gi, 'nach ship_incident (broken)');
  Registry.get('ship_incident').run(m, { system: 'engines', state: 'damaged' });
  ok(gi.ship.systems.engines === 'damaged' && integ(gi, 'engines') === 5, 'ship_incident damaged: 5 von 10');
  Registry.get('debug_clear_incidents').run(m, {});
  ok(gi.ship.systems[gi.C.drill.system] === 'ok' && integ(gi, gi.C.drill.system) === I.integMax(gi, gi.C.drill.system), 'debug_clear_incidents: Übungssystem ok mit Maximum');
  invariante(gi, 'nach debug_clear_incidents');
});

section('Nacharbeit 2b: EMP (offline) führt die vorgemerkte Stufe samt Integrität mit', () => {
  const g = newGame(110);
  I.setOffline(g, 'engines', 5);
  I.damageSystem(g, 'engines', null, { quiet: true }); I.damageSystem(g, 'engines', null, { quiet: true });   // ok -> beschädigt -> zerstört, während offline
  ok(g.ship.systems.engines === 'offline' && g.ship.offline.engines.prev === 'broken' && integ(g, 'engines') === 0, 'Offline: 2× Schaden merkt zerstört vor und führt die Integrität auf 0');
  invariante(g, 'offline mit vorgemerktem Schaden');
  I.updateOffline(g, 10);
  ok(g.ship.systems.engines === 'broken' && integ(g, 'engines') === 0, `nach EMP-Ende: zerstört mit 0 Punkten (${g.ship.systems.engines}/${integ(g, 'engines')})`);
  invariante(g, 'nach EMP-Ende');
  const g2 = newGame(111);
  I.setOffline(g2, 'thruster_port', 5);
  I.damageSystem(g2, 'thruster_port', null, { quiet: true });
  I.updateOffline(g2, 10);
  ok(g2.ship.systems.thruster_port === 'damaged' && integ(g2, 'thruster_port') === 5, 'offline, ein Schaden: nach EMP-Ende beschädigt mit 5 Punkten');
  // ein Integritätstreffer auf ein Offline-System mindert die Punkte und merkt die Stufe vor
  const g3 = newGame(112);
  I.setOffline(g3, 'thruster_stbd', 5);
  const r = I.systemTreffer(g3, 'thruster_stbd', 3);
  ok(r === null && integ(g3, 'thruster_stbd') === 7 && g3.ship.offline.thruster_stbd.prev === 'ok', 'Treffer 3 auf Offline: 7 Punkte, vorgemerkt bleibt ok');
  const r2 = I.systemTreffer(g3, 'thruster_stbd', 3);
  ok(r2 && r2.state === 'offline' && g3.ship.offline.thruster_stbd.prev === 'damaged' && integ(g3, 'thruster_stbd') === 4, 'weiterer Treffer: vorgemerkt beschädigt, 4 Punkte');
  invariante(g3, 'Offline mit Integritätstreffern');
  I.updateOffline(g3, 10);
  ok(g3.ship.systems.thruster_stbd === 'damaged' && integ(g3, 'thruster_stbd') === 4, 'nach EMP-Ende: beschädigt mit 4 Punkten');
  I.systemTreffer(g3, 'thruster_stbd', 4);
  ok(g3.ship.systems.thruster_stbd === 'broken' && integ(g3, 'thruster_stbd') === 0, 'danach zerstört bei 0');
  invariante(g3, 'Ende');
  // Sicherheitsnetz: das Ende der Pause gleicht eine uneinheitliche Integrität an die vorgemerkte Stufe an
  const g4 = newGame(113);
  I.setOffline(g4, 'engines', 1);
  g4.ship.offline.engines.prev = 'broken';   // von außen gesetzt, Punkte noch voll
  I.updateOffline(g4, 2);
  ok(g4.ship.systems.engines === 'broken' && integ(g4, 'engines') === 0, 'EMP-Ende gleicht die Integrität an die vorgemerkte Stufe an');
});

section('Nacharbeit 3: Zone mit nur Offline-Systemen ist nicht leer', () => {
  const g = newGame(120);
  const zone = ZONE(0); const offlineSys = zone[0];
  for (const k of zone) if (k !== offlineSys) { g.ship.systems[k] = 'broken'; I.setInteg(g, k, 0); }
  I.setOffline(g, offlineSys, 60);
  let mitte = 0, inZone = 0;
  for (let i = 0; i < 40; i++) {
    const r = I.trefferweg(g, 0, 0.1);
    if (!r) break;
    if (I.systemSector(r.system) === -1) mitte++; else if (r.system === offlineSys) inZone++;
  }
  ok(mitte === 0 && inZone === 40, `nur Offline-Systeme in der Zone: kein Treffer geht in die Mitte (Mitte ${mitte}, Offline-System ${inZone} von 40)`);
  const g2 = newGame(121); const z2 = ZONE(0); const o2 = z2[0];
  for (const k of z2) if (k !== o2) { g2.ship.systems[k] = 'broken'; I.setInteg(g2, k, 0); }
  I.setOffline(g2, o2, 60);
  const mid0 = snapShot(g2);
  const res = hit(g2, 0, 3, {});
  ok(res.systems.length === 1 && res.systems[0].system === o2 && integ(g2, o2) === I.integMax(g2, o2) - 3, 'Schiffstreffer: trifft das Offline-System und mindert die Integrität');
  ok(MITTE().every((k) => g2.ship.systems[k] === mid0[k] && integ(g2, k) === mid0.__i[k]), 'Die Mitte bleibt dabei unberührt');
  invariante(g2, 'nach Treffer auf Offline-System');
  // sind alle aktiven Systeme der Zone zerstört, geht es weiter in die Mitte (unverändert)
  const g3 = newGame(122);
  for (const k of ZONE(0)) { g3.ship.systems[k] = 'broken'; I.setInteg(g3, k, 0); }
  const r3 = I.trefferweg(g3, 0, 1);
  ok(r3 && I.systemSector(r3.system) === -1, 'alle zerstört: Treffer geht in die Mitte');
});

section('Nacharbeit 4: Geflicktes bricht, Schwellen nach Treffern ohne Reparatur, Zufallsläufe halten die Invariante', () => {
  // Fragil-Fall über den Trefferweg
  const g = newGame(130); const z = ZONE(1); const f = z[0];
  const f2 = z[1];
  for (const k of [f, f2]) { I.systemTreffer(g, k, 6); I.repairSystem(g, k, 'player', 'flick'); }   // beschädigt, dann geflickt
  ok([f, f2].every((k) => g.ship.systems[k] === 'ok' && I.isFragile(g, k)), 'Vorbereitung: zwei Systeme der Zone geflickt (ok, fragil)');
  const b = snapShot(g);
  const r = I.trefferweg(g, 1, 0.5);
  ok(r && r.wechsel && [f, f2].every((k) => g.ship.systems[k] === 'broken' && integ(g, k) === 0 && !I.isFragile(g, k)), `Trefferweg: alle geflickten Systeme der Zone brechen (${g.ship.systems[f]}/${integ(g, f)}, ${g.ship.systems[f2]}/${integ(g, f2)})`);
  ok(z.filter((k) => k !== f && k !== f2).every((k) => g.ship.systems[k] === b[k] && integ(g, k) === b.__i[k]), 'kein weiterer Schaden in der Zone');
  invariante(g, 'nach Bruch des Geflickten');
  // Geflicktes Offline-System (EMP nach Flicken) bricht ebenfalls beim Integritätstreffer
  const g1 = newGame(131); const f1 = ZONE(2)[0];
  I.systemTreffer(g1, f1, 6); I.repairSystem(g1, f1, 'player', 'flick'); I.setOffline(g1, f1, 20);
  I.systemTreffer(g1, f1, 0.5);
  ok(g1.ship.offline[f1].prev === 'broken' && integ(g1, f1) === 0, 'geflickt und offline: ein Treffer merkt zerstört vor, 0 Punkte');
  // Schwellen nach Treffern ohne Reparatur, Punkt für Punkt
  const g2 = newGame(132); const s = 'weapon_bow';
  const stufen = [];
  for (let i = 0; i < 11; i++) { I.systemTreffer(g2, s, 1); stufen.push(g2.ship.systems[s][0] + integ(g2, s)); }
  ok(stufen.join(' ') === 'o9 o8 o7 o6 d5 d4 d3 d2 d1 b0 b0', `Punkt für Punkt: ok bis 6, beschädigt 5 bis 1, zerstört bei 0 (${stufen.join(' ')})`);
  // Zufallsläufe: Treffer, Schaden, Reparatur, EMP, Zeit – nach jedem Schritt gilt die Invariante
  let schritte = 0; const verletzt = [];
  for (const seed of [201, 202, 203]) {
    const gz = newGame(seed); const rng = gz.rng;
    for (let i = 0; i < 400; i++) {
      const akt = I.SYSTEM_ORDER.filter((k) => I.systemAktiv(gz, k));
      const k = rng.pick(akt); const w = rng.int(7);
      if (w === 0) hit(gz, rng.int(4), 0.5 + rng.int(40) / 10, rng.chance(0.2) ? { durchschlag: 'zone' } : {});
      else if (w === 1) I.systemTreffer(gz, k, 0.5 + rng.int(60) / 10);
      else if (w === 2) I.damageSystem(gz, k, null, { quiet: true });
      else if (w === 3) I.repairSystem(gz, k, 'player', rng.pick(['flick', 'swap', 'minigame']));
      else if (w === 4) I.setOffline(gz, k, 1 + rng.int(4));
      else if (w === 5) I.updateOffline(gz, rng.int(3));
      else I.damageSystem(gz, k, rng.pick(['damaged', 'broken']), { quiet: true });
      schritte++;
      const bad = inkonsistent(gz); if (bad.length && verletzt.length < 3) verletzt.push(`Seed ${seed} Schritt ${i} Aktion ${w}: ${bad[0]}`);
    }
  }
  ok(verletzt.length === 0, `Zufallsläufe: ${schritte} Schritte, Zustand und Integrität nie auseinander ${verletzt.join(' | ')}`);
});

section('Nacharbeit 5: Snapshot-Integrität und Protokoll-Reihenfolge', () => {
  const g = newGame(140);
  g.ship.integ = {};
  let n = 0; const orig = I.integritaetSnapshot; I.integritaetSnapshot = function (...a) { n++; return orig.apply(this, a); };
  try { g.snapshot(); } finally { I.integritaetSnapshot = orig; }
  ok(n === 1, `integritaetSnapshot läuft je Snapshot genau einmal (${n})`);
  ok(Object.keys(g.ship.integ).length === 0, 'der Snapshot schreibt nichts in ship.integ (lesend)');
  ok(Array.isArray(Protocol.SYSTEMS_INTEG) && Protocol.SYSTEMS_INTEG.join() === I.SYSTEM_ORDER.join(), 'Protocol.SYSTEMS_INTEG = interior.SYSTEM_ORDER (eine Reihenfolge für das integ-Array)');
  ok([...Protocol.SYSTEMS_INTEG].sort().join() === Protocol.SYSTEMS.filter((k) => k !== 'weapons').sort().join(), 'Protocol.SYSTEMS_INTEG enthält dieselben Systeme wie Protocol.SYSTEMS (ohne Altnamen weapons)');
  const g2 = newGame(141); I.systemTreffer(g2, 'battery_port', 6);
  const s2 = g2.snapshot().ship;
  ok(s2.integ[Protocol.SYSTEMS_INTEG.indexOf('battery_port')] === 40 && s2.integ[Protocol.SYSTEMS_INTEG.indexOf('engines')] === 100, 'integ[i] gehört zu Protocol.SYSTEMS_INTEG[i] (Batterie 40 %, Triebwerke 100 %)');
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'client.js'), 'utf8');
  ok(!/case 'hull'/.test(src), "Client: kein Debug-Befehl 'hull' mehr");
});

section('Protokoll', () => {
  ok(Array.isArray(Protocol.DEBUG_CMDS || []) || true, 'Protokoll lädt');
  const ds = (Protocol.DEBUG_CMDS || []);
  ok(!ds.includes('hull') && ds.includes('verlust'), 'Debug-Befehl hull entfällt, verlust kommt dazu');
});

console.log('\n' + (fails ? `${fails} FEHLER von ${n}` : `${n}/${n} ok`) + ' (SYS-01 A1a Systemmodell)');
process.exit(fails ? 1 : 0);
