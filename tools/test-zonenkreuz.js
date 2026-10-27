'use strict';
// SYS-01 A1c „Zonenkreuz“ (Teil): Snapshot ship.zonen (Integrität je Seite in %), Statusleiste = schwächste eigene Seite,
// Modulsysteme modul_1..4 mit Namen nach dem Modul im Raum, Reparatur-Gate für modul_N.
// Client-Hilfen (PultSysteme) laufen hier in Node; hud.js/consoles.js/pult.js brauchen den Browser (Sichtprüfung über tools/sicht-systeme.js).
//   node tools/test-zonenkreuz.js
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');
const I = require('../server/sim/interior.js');
const W = require('../server/world.js');
const PS = require('../public/js/pult-systeme-tokens.js');
const fs = require('fs');
const path = require('path');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

function newGame(seed) {
  const g = new Game({ noStore: true, seed: seed || 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  g.space.enemies = []; g.space.projectiles = [];
  g.ship.fireList = []; g.ship.breachList = [];
  for (const k of I.SYSTEM_ORDER) g.ship.systems[k] = 'ok';
  g.ship.fragile = {}; g.ship.offline = {};
  g.ship.shields.current = [0, 0, 0, 0];
  g.ship.shields.regenHold = 0;
  g.god = false;
  I.integritaetVoll(g);
  return g;
}

console.log('Server: Snapshot ship.zonen');
{
  const g = newGame(21);
  const sn = g.snapshot().ship;
  ok(Array.isArray(sn.zonen) && sn.zonen.length === 4, `zonen hat vier Seiten (Bug, Stb, Heck, Bb): ${JSON.stringify(sn.zonen)}`);
  ok(sn.zonen.every((v) => Number.isInteger(v) && v >= 0 && v <= 100), 'zonen: ganze Prozent 0–100 bei heilem Schiff');
  ok(sn.zonen.every((v) => v === 100), 'zonen: heiles Schiff steht überall auf 100');
  // Seiten-Reihenfolge = Sektoren der Server-Zuordnung (SECTOR_LABEL 0 Bug, 1 Steuerbord, 2 Heck, 3 Backbord)
  const lab = I.SECTOR_LABEL.map((s) => s.replace(/sektor$/, ''));
  ok(lab[0] === 'Bug' && lab[1] === 'Steuerbord' && lab[2] === 'Heck' && lab[3] === 'Backbord', `Seitenreihenfolge der Server-Labels: ${lab.join(' ')}`);
  ok(PS.TOKENS.TEXT.zone.bug === 'BUG' && PS.TOKENS.TEXT.zone.stb === 'STB' && PS.TOKENS.TEXT.zone.heck === 'HECK' && PS.TOKENS.TEXT.zone.bb === 'BB', 'Client: Seitenkürzel in derselben Reihenfolge (bug, stb, heck, bb)');
  ok(I.systemSector('emitter_bow') === 0 && I.systemSector('emitter_stbd') === 1 && I.systemSector('emitter_aft') === 2 && I.systemSector('emitter_port') === 3, 'Emitter je Seite: 0 Bug, 1 Stb, 2 Heck, 3 Bb (Index = EMITTERS)');
  ok(I.systemSector('reactor') === -1 && I.systemSector('shields') === -1, 'Reaktor und Schildgenerator liegen in der Mitte (-1)');
  ok(I.systemSector('modul_1') === -1 && I.systemSector('modul_4') === -1, 'Module liegen in der Mitte (-1)');

  // Seite zerstören: alle aktiven Systeme der Backbord-Seite (Sektor 3) zerstört -> 0 %, schwächste Seite
  for (const k of I.SYSTEM_ORDER) if (I.systemSector(k) === 3 && I.systemAktiv(g, k)) I.setzeZustand(g, k, 'broken');
  const sn2 = g.snapshot().ship;
  ok(sn2.zonen[3] === 0, `Backbord leer: zonen[3] = 0 (${sn2.zonen[3]})`);
  ok(sn2.zonen[0] === 100 && sn2.zonen[1] === 100 && sn2.zonen[2] === 100, 'andere Seiten bleiben voll');
  const sw = PS.schwaechsteSeite(sn2);
  ok(sw && sw.zone === 3 && sw.pct === 0 && sw.zust === 'zer' && sw.name === 'BB', `schwächste Seite ist Backbord, 0 %, zerstört (${JSON.stringify(sw)})`);

  // Teilschaden: Bug auf 40 % -> schwächste Seite Bug, beschädigt
  I.integritaetVoll(g);
  for (const k of I.SYSTEM_ORDER) if (I.systemSector(k) === 0 && I.systemAktiv(g, k)) I.setInteg(g, k, Math.round(I.integMax(g, k) * 0.4));
  const sn3 = g.snapshot().ship;
  const sw3 = PS.schwaechsteSeite(sn3);
  ok(sw3 && sw3.zone === 0 && sw3.zust === 'besch' && sn3.zonen[0] >= 35 && sn3.zonen[0] <= 45, `Bug auf ~40 %: schwächste Seite Bug, beschädigt (${sn3.zonen[0]} %)`);

  // Zonen-Wert = Server-Funktion (kein zweiter Rechenweg)
  const direkt = I.zonenSnapshot(g);
  ok(JSON.stringify(direkt) === JSON.stringify(sn3.zonen), 'Snapshot zonen = I.zonenSnapshot (eine Quelle)');
  const schwach = I.schwaechsteZone(g);
  ok(schwach && schwach.zone === sw3.zone, 'Server-schwaechsteZone und Client-Statusleiste zeigen dieselbe Seite');

  // Module: modul_1 zerstört -> Name nach dem Modul im Raum 1 (Frachtraum laut Start-Bestückung)
  g.ship.systems.modul_1 = 'ok';
  I.setzeZustand(g, 'modul_1', 'broken');
  const sn4 = g.snapshot().ship;
  ok(sn4.systems && sn4.systems.modul_1 === 'broken', 'Modulsystem modul_1 im Snapshot (zerstört)');
  ok(PS.modulName(sn4, 'modul_1') === 'Frachtraum', `modul_1 heißt nach dem Modul im Raum 1: ${PS.modulName(sn4, 'modul_1')}`);
  ok(sn4.zonen.every((v) => Number.isInteger(v)), 'zonen bleibt ganzzahlig nach Modulschaden (Mitte zählt nicht)');
  const sizeWithZonen = Buffer.byteLength(JSON.stringify(sn4));
  ok(sizeWithZonen > 0, `Snapshot-Ship-Größe ${sizeWithZonen} B (Gesamtbudget: tools/snap-mess.js)`);
}

console.log('\nServer: Module und Reparatur-Gate');
{
  ok(I.SYSTEM_ORDER.includes('modul_1') && I.SYSTEM_ORDER.includes('modul_4'), 'SYSTEM_ORDER enthält modul_1..modul_4 (Reparatur-Gate in repairCmd)');
  const rooms = W.Maps.MODUL_RAEUME.map((r) => r.raum);
  for (const r of rooms) ok(W.STATIONS.some((s) => s.system === 'modul_' + r), `Modulraum ${r}: Station modul_${r} in der Welt (Reparatur an der Station)`);
  ok(Protocol.SYSTEMS_INTEG.length === I.SYSTEM_ORDER.length, 'SYSTEMS_INTEG und SYSTEM_ORDER gleich lang (Snapshot-Positionen)');
}

console.log('\nClient-Hilfen (PultSysteme)');
{
  ok(PS.zonenZustand(0) === 'zer' && PS.zonenZustand(1) === 'besch' && PS.zonenZustand(50) === 'besch' && PS.zonenZustand(51) === 'ok' && PS.zonenZustand(100) === 'ok', 'zonenZustand: 0 zerstört, bis 50 beschädigt, darüber heil');
  ok(PS.zonenZustand(-1) === 'keine', 'zonenZustand: -1 = keine aktive Seite');
  ok(PS.schwaechsteSeite(null) === null && PS.schwaechsteSeite({}) === null && PS.schwaechsteSeite({ zonen: [-1, -1, -1, -1] }) === null, 'schwaechsteSeite: ohne Daten oder ohne aktive Seite null');
  const b = PS.schwaechsteSeite({ zonen: [100, 50, 20, 90] });
  ok(b && b.zone === 2 && b.name === 'HECK' && b.pct === 20 && b.zust === 'besch', 'schwaechsteSeite: niedrigster Wert gewinnt (Heck 20 %)');
  const c = PS.schwaechsteSeite({ zonen: [70, -1, 70, 70] });
  ok(c && c.zone === 0 && c.pct === 70, 'schwaechsteSeite: Seiten ohne aktive Systeme (-1) zählen nicht');
  ok(PS.modulName({ mod: [['f', 1, 1, 1], ['w', 3, 1, 1]] }, 'modul_1') === 'Frachtraum' && PS.modulName({ mod: [['f', 1, 1, 1], ['w', 3, 1, 1]] }, 'modul_3') === 'Werkstatt', 'modulName: Raum 1 Frachtraum, Raum 3 Werkstatt');
  ok(PS.modulName({ mod: [] }, 'modul_2') === 'Modulraum 2', 'modulName: ohne Modul im Raum Modulraum N');
  ok(PS.modulName({}, 'reactor') === null, 'modulName: kein Modulsystem -> null');
  // Modul-Codes: gleiche Namen wie config.module.codes (Quelle der Codes im Snapshot)
  const codes = CONFIG.module.codes;
  for (const id of Object.keys(codes)) {
    const want = id.charAt(0).toUpperCase() + id.slice(1);
    ok(PS.MODUL_NAMEN[codes[id]] === want, `Modul-Code ${codes[id]} (${id}) -> ${want}`);
  }
}

console.log('\nClient-Quelltext (Übergang entfernt)');
{
  const root = path.join(__dirname, '..', 'public', 'js');
  const lesen = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const cons = lesen('consoles.js');
  ok(!/leakText|Durchlass-Ampel|Systemschaden je Treffer/.test(cons), 'consoles.js: keine Durchlass-Legende und kein leakText mehr');
  const alle = ['consoles.js', 'hud.js', 'pult.js', 'sitz.js', 'client.js'].map(lesen).join('\n');
  ok(!/'SYS ' \+|label: 'SYS'|l: 'SYS'|'SYS', /.test(alle), 'Statusleiste/Technik: kein SYS-Feld mehr');
  ok(!/SYS 100/.test(alle), "keine Platzhalter 'SYS 100'");
  ok(!/H\.SYS_NAMES\[(sys|s|ev\.system)\] \|\| /.test(alle), 'Namen laufen über H.sysName (Modulnamen)');
}

console.log('\n' + (fails ? `${fails} FEHLER von ${n}` : `${n}/${n} ok`) + ' (SYS-01 A1c Zonenkreuz, Teil Daten)');
process.exit(fails ? 1 : 0);
