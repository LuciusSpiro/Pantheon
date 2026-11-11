#!/usr/bin/env node
'use strict';
// SPL-01 b2: Bot-/Gruppenlauf ueber bestimmte Archiv-Eintraege (Kampagne ohne Tutorial, Spielleiter im Modus off, Archiv-Angebote wie im Spiel).
// Der Vorrat des Spielleiters wird dafuer auf die genannten Eintraege beschraenkt (Archiv.load gefiltert); gespielt wird ueber sim-headless
// (runGeneric, mode archiv): Archiv-Pick -> Grobplan -> buehne.neu legt den Landepunkt an -> Buch -> Bots spielen Szene fuer Szene.
//   node tools/sim-archiv-eintraege.js [--namen a,b] [--seeds n] [--crew 1|3]   (Standard: zuflucht_auf_kesh,zwischenfall_am_stollen, 2 Seeds, Crew 3)
// Exit 0 = alle erledigt, kein Softlock, 0 Server-Fehler; 1 = Auffaelligkeit; 2 = falscher Aufruf. Kein Gate-Wert eines Tests ausser test-spl-rueckfall-gelaende.
const Archiv = require('../server/mission/archiv.js');

const argv = process.argv.slice(2);
const val = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
for (const a of argv) if (a.startsWith('--') && !['--namen', '--seeds', '--crew'].includes(a)) { console.error(`Unbekannte Option ${a}\nAufruf: node tools/sim-archiv-eintraege.js [--namen a,b] [--seeds n] [--crew 1|3]`); process.exit(2); }
const NAMEN = String(val('--namen', 'zuflucht_auf_kesh,zwischenfall_am_stollen')).split(',').filter(Boolean);
const SEEDS = Number(val('--seeds', 2)); const CREW = Number(val('--crew', 3));
if (!Number.isInteger(SEEDS) || SEEDS < 1 || ![1, 2, 3].includes(CREW)) { console.error('--seeds erwartet eine ganze Zahl >= 1, --crew 1|2|3'); process.exit(2); }

const lade = Archiv.load;
const alle = lade().entries.map((e) => e.name);
const fehlt = NAMEN.filter((x) => !alle.includes(x));
if (fehlt.length) { console.error(`Archiv-Eintrag unbekannt: ${fehlt.join(', ')} (bekannt: ${alle.join(', ')})`); process.exit(2); }
Archiv.load = (d, o) => { const r = lade(d, o); r.entries = r.entries.filter((e) => NAMEN.includes(e.name)); return r; };

process.argv.push('--ohne-telemetrie');
const S = require('./sim-headless.js');
(async () => {
  let schlecht = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = await S.runGeneric({ seed, crew: CREW, mode: 'archiv', count: NAMEN.length, order: NAMEN, funk: seed % 2 ? 'b' : 'a', pilot: 'maneuver', maxSec: 9000, missionMax: 4500 });
    S.printGenericRun(r, 'Archiv');
    const gespielt = r.missions.map((m) => m.archiv);
    const gut = !r.aborted && !r.errors && r.missions.length === NAMEN.length && r.missions.every((m) => m.success && !m.softlock) && NAMEN.every((x) => gespielt.includes(x));
    if (!gut) { schlecht++; console.log(`  AUFFAELLIG Seed ${seed}: ${r.aborted || 'nicht alles erledigt'} (Fehler ${r.errors}, gespielt ${gespielt.join(', ') || '-'})`); }
  }
  console.log(schlecht ? `\nSIM ARCHIV-EINTRAEGE: ${schlecht} Auffaelligkeit(en)` : `\nSIM ARCHIV-EINTRAEGE OK (${SEEDS} Seed(s), Crew ${CREW}, ${NAMEN.join(', ')})`);
  process.exit(schlecht ? 1 : 0);
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
