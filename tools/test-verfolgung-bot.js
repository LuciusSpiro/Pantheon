'use strict';
// SUND-04a-1 A: Bot-Läufe der Verfolgung (A6) über das Szenario-Labor (tools/sim-headless.js, Umsetzung verfolgen/fliehenden_stellen): Die Ops scannen das Zielschiff,
// wählen das Systemziel Antrieb (weapons.systemziel), die Steuer jagt von hinten; zu dritt wird das Zielschiff gestellt (Antrieb ausgefallen, Lerche nah), solo je nach Lauf
// gestellt, zerstört oder erst nach einer Wiederholung. Der Bot nutzt nur Snapshot und Befehle; die Zähler (game.stats.verfolgung/zielsysteme) kommen vom Server.
//   node tools/test-verfolgung-bot.js
const { runGeneric } = require('./sim-headless.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const info = (t) => console.log('  info ' + t);
const ID = 'verfolgen/fliehenden_stellen';

(async () => {
  console.log('[Bot zu dritt (Captain, Steuer, Ops)]');
  const zeiten = [];
  for (const seed of [1, 2, 3]) {
    const r = await runGeneric({ seed, crew: 3, mode: 'labor', labor: ID, pilot: 'maneuver', maxSec: 600, funk: 'a' });
    const m = r.missions[0]; const v = r.sim.verfolgung || {}; const z = r.sim.zielsysteme || {};
    info(`Seed ${seed}: ${m ? m.dur : '–'} s, Ausgänge ${JSON.stringify(v)}, Systemstufen Gegner ${z.gegner}, Systemziel gewählt ${r.sim.systemziel}`);
    ok(!r.aborted && m && m.success && !m.skips, `Seed ${seed}: Mission erfolgreich ohne Überspringen`);
    // C1b-1 (Seed 3 war bis C1b offen): der Bot wählt das Systemziel Antrieb erst, wenn er aus dem Heck steht (Lanze und Batterien halten bis dahin), und
    // die Vollladung der Lanze (Durchschlag bis in die Mitte) feuert er nicht mehr mit gesetztem Systemziel. Alte Regel: zwei Stufen voll→beschädigt→ausgefallen.
    // Neue Regel: der Antrieb wechselt gezielt mindestens einmal (eine schwere Lanzensalve bringt eine Korvette, deren Heck nur aus dem Antrieb besteht, sofort auf ausgefallen).
    ok(v.gestellt === 1 && !v.entkommen, `Seed ${seed}: gestellt, nicht entkommen (Ausgänge ${JSON.stringify(v)})`);
    ok(r.sim.systemziel >= 1 && z.gegner >= 1, `Seed ${seed}: der Bot hat das Systemziel Antrieb gewählt und ihn gezielt getroffen (${z.gegner} gezielte Zustandswechsel)`);
    ok(!r.errors, `Seed ${seed}: keine Server-Fehler`);
    zeiten.push(m.dur);
  }
  info(`Zeit bis zum Stellen: ${zeiten.join(', ')} s (Sprungladung 15 s nach der Ankunft, Flucht ~30 s)`);
  console.log('\n[Bot solo (Steuer und Ops in einer Person)]');
  let gestellt = 0; let solo_systemziel = 0;
  for (const seed of [1, 2, 3, 4]) {
    const r = await runGeneric({ seed, crew: 1, mode: 'labor', labor: ID, pilot: 'maneuver', maxSec: 900, funk: 'a' });
    const m = r.missions[0]; const v = r.sim.verfolgung || {}; const z = r.sim.zielsysteme || {};
    info(`Seed ${seed}: ${m ? m.dur : '–'} s, Ausgänge ${JSON.stringify(v)}, Systemstufen Gegner ${z.gegner}`);
    ok(!r.aborted && m && m.success && !m.skips && !r.errors, `Seed ${seed}: Mission erfolgreich ohne Überspringen und ohne Fehler`);
    // C1b-1: die unbesetzte Ops feuert die Lanze automatisch (autoPower) auf jedes Ziel in der Linie. Steht die Lerche hinter dem Ziel, trifft dieser Auto-Schuss das Heck,
    // bevor das Systemziel gewählt ist; der Antrieb ist dann ausgefallen, das Ziel gestellt. Deshalb nur info je Lauf, die Prüfung zählt im Aggregat.
    if (r.sim.systemziel >= 1) solo_systemziel++;
    info(`Seed ${seed}: Systemziel vor dem Stellen gewählt: ${r.sim.systemziel >= 1 ? 'ja' : 'nein (Auto-Lanze der unbesetzten Ops zuerst)'}`);
    if (v.gestellt) gestellt++;
  }
  ok(gestellt >= 1, `solo: mindestens ein Lauf stellt das Zielschiff über den Antrieb (${gestellt}/4)`);
  ok(solo_systemziel >= 1, `solo: mindestens ein Lauf wählt das Systemziel Antrieb vor dem Stellen (${solo_systemziel}/4)`);
  console.log(`\ntest-verfolgung-bot: ${n - fails}/${n} ok`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('  FEHLER ' + (e && e.stack || e)); process.exit(1); });
