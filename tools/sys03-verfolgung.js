'use strict';
// SYS-03 B-Nacharbeit: Messung der Verfolgung (Bot-Läufe wie tools/test-verfolgung-bot.js) über mehrere Seeds und Crewgrößen.
// Je Lauf: Dauer der Mission (s), Ausgänge der Verfolgung (gestellt / entkommen / zerstört), Erfolg ohne Überspringen. Läuft gegen jeden Stand (auch 24bae96 vor der Nacharbeit).
//   node tools/sys03-verfolgung.js [--seeds 4] [--crews 3,1] [--sek 600]
const { runGeneric } = require('./sim-headless.js');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const SEEDS = Number(arg('seeds', 4)); const CREWS = String(arg('crews', '3,1')).split(',').map(Number); const SEK = Number(arg('sek', 600));
const ID = 'verfolgen/fliehenden_stellen';
(async () => {
  for (const crew of CREWS) {
    const zeilen = []; let erfolg = 0, entk = 0, gest = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = await runGeneric({ seed, crew, mode: 'labor', labor: ID, pilot: 'maneuver', maxSec: crew === 1 ? Math.max(SEK, 900) : SEK, funk: 'a' });
      const m = r.missions[0]; const v = r.sim.verfolgung || {};
      const gut = !r.aborted && m && m.success && !m.skips && !r.errors;
      if (gut) erfolg++; entk += v.entkommen || 0; gest += v.gestellt || 0;
      zeilen.push(`Seed ${seed}: ${m ? Math.round(m.dur * 10) / 10 : '–'} s, gestellt ${v.gestellt || 0}, entkommen ${v.entkommen || 0}${gut ? '' : ' (ohne Erfolg)'}`);
    }
    console.log(`Verfolgung Crew ${crew}, ${SEEDS} Seeds: Erfolg ${erfolg}/${SEEDS}, gestellt ${gest}, entkommen ${entk}`);
    for (const z of zeilen) console.log('  ' + z);
  }
})();
