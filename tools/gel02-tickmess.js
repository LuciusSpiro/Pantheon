#!/usr/bin/env node
'use strict';
// GEL-02 F (Abnahme 6): Tick-Zeit mit vier Spielern und alarmierten Gruppen. Messwerkzeug, kein Test (Ausgabe als Tabelle, Exit 0).
//   node tools/gel02-tickmess.js [--sek 60] [--seeds 3] [--json]
// (a) eigene Höhle mittel: 4 Spieler in Gefechtsbereichen, alle Gefechtsbereiche besetzt (mittel, wach, Alarm erzwungen)
// (b) Wildnis mit Höhle mittel: je 2 Spieler pro Deck, alle Gefechtsbereiche beider Decks besetzt (mittel, wach, Alarm erzwungen)
// Besetzung über combat.besetzen mit bereich (Spielleiter-Weg). Spieler unverwundbar gehalten (Schild/HP), damit der Alarm über die ganze Zeit trägt.
// Tickdauer = Game.step(); zusätzlich "inkl. Snapshot" (step + JSON.stringify(snapshot)) als Näherung der Serverschleife (ohne Netz).
// Snapshot-Bytes wie tools/snap-mess.js: Buffer.byteLength(JSON.stringify(g.snapshot())), Ziel CONFIG.net.snapMax - snapLuft, Grenze snapMax.
const CONFIG = require('../shared/config.js');
const Gelaende = require('../shared/gen-gelaende.js');
const combat = require('../server/sim/combat.js');
const Physics = require('../shared/physics.js');
const H = require('./gel02-hilfen.js');

const args = process.argv.slice(2);
const val = (k, d) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : d; };
const SEK = val('--sek', 60), SEEDS = val('--seeds', 3), JSON_OUT = args.includes('--json');
const TICK = CONFIG.tickHz, BUDGET = 1000 / TICK, ZIEL = CONFIG.net.snapMax - CONFIG.net.snapLuft, GRENZE = CONFIG.net.snapMax;
const SEEDS_LISTE = [3, 11, 20, 29, 38];

function messlauf(art, seed, biom) {
  const params = art === 'hoehle' ? { art: 'hoehle', seed, groesse: 'mittel' } : { art: 'wildnis', seed, groesse: 'mittel', biom, hoehle: true };
  const { g, map, k } = H.neuesSpiel(4, params);
  const aw = g.away;
  const S = k.decks ? k.decks.stride : Infinity;
  const lager = Object.keys(k.bereiche).filter((b) => k.bereiche[b].gefecht);
  let gegner = 0;
  for (const b of lager) gegner += combat.besetzen(g, { map, bereich: b, fraktion: 'raubzug', staerke: 'mittel', haltung: 'wach', tag: 'm_' + b });
  // Spieler an Wachen-Anker von Gefechtsbereichen: Wildnis je zwei pro Deck, Höhle alle vier (verschiedene Lager reihum)
  const wachen = (deck) => k.anker.filter((a) => a.rolle === 'wache' && (k.decks ? Math.floor(a.y / S) === deck : true) && k.bereiche[a.bereich] && k.bereiche[a.bereich].gefecht);
  const plaetze = [];
  if (art === 'hoehle') { const w = wachen(0); for (let i = 0; i < 4; i++) plaetze.push(w[(i * 3) % w.length]); }
  else { const w0 = wachen(0), w1 = wachen(1); plaetze.push(w0[0], w0[w0.length >> 1], w1[0], w1[w1.length >> 1]); }
  plaetze.forEach((a, i) => { const p = g.players[i]; const c = Physics.tileCenter(a.x, a.y); p.x = c.x; p.y = c.y; p.input.mx = 0; p.input.my = 0; });
  const keep = () => {
    for (const s of Object.values(aw.squads)) { s.alert = true; for (const p of g.players) { s.lastKnown[p.id] = { x: p.x, y: p.y, t: g.time }; } }
    for (const p of g.players) { if (p.shield) p.shield.seg = 3; p.downed = false; p.hp = 100; }
  };
  for (let i = 0; i < 3 * TICK; i++) { keep(); g.step(); }   // Einschwingen (nicht gemessen)
  const tick0 = g.tick, N = Math.round(SEK * TICK);
  const stepMs = [], vollMs = [], snapB = [];
  let projMax = 0, lebendMin = Infinity;
  for (let i = 0; i < N; i++) {
    keep();
    const t0 = process.hrtime.bigint(); g.step(); const t1 = process.hrtime.bigint();
    const js = JSON.stringify(g.snapshot()); const t2 = process.hrtime.bigint();
    stepMs.push(Number(t1 - t0) / 1e6); vollMs.push(Number(t2 - t0) / 1e6); snapB.push(Buffer.byteLength(js));
    projMax = Math.max(projMax, (aw.projectiles || []).length);
    lebendMin = Math.min(lebendMin, aw.drones.filter((d) => d.alive).length);
  }
  const s = H.stat(stepMs), v = H.stat(vollMs), b = H.stat(snapB);
  return { art, seed, biom: art === 'hoehle' ? '-' : biom, gegner, lebendMin, projMax, step: s, voll: v, ueber: stepMs.filter((x) => x > BUDGET).length, ueberVoll: vollMs.filter((x) => x > BUDGET).length,
    snapMax: b.max, snapMed: b.med, ticks: g.tick - tick0, erwartet: N, fehler: H.fehlerZahl(g), alarm: Object.values(aw.squads).filter((q) => q.alert).length };
}

const alle = [];
for (const art of ['hoehle', 'wildnis']) for (let i = 0; i < SEEDS; i++) {
  const seed = SEEDS_LISTE[i % SEEDS_LISTE.length], biom = Gelaende.BIOME[i % 3];
  alle.push(messlauf(art, seed, biom));
  if (!JSON_OUT) { const r = alle[alle.length - 1]; console.error(`  fertig ${art} Seed ${seed}: step med ${r.step.med.toFixed(2)} ms`); }
}
if (JSON_OUT) { console.log(JSON.stringify(alle)); process.exit(0); }
const f = (x, d = 2) => x.toFixed(d);
console.log(`\nTick-Zeit GEL-02 (vier Spieler, alle Gefechtsbereiche besetzt mittel+wach, Alarm erzwungen, ${SEK} s = ${Math.round(SEK * TICK)} Ticks; Budget ${f(BUDGET, 1)} ms; Snapshot Ziel ${ZIEL} B, Grenze ${GRENZE} B)`);
console.log('Karte        Seed Biom       Gegner  step Med  p95    Max   >Budget | inkl.Snap Med p95 Max >Budget | Snap max B  Ticks/erw  Fehler');
for (const r of alle) console.log(`${r.art.padEnd(12)} ${String(r.seed).padEnd(4)} ${r.biom.padEnd(10)} ${String(r.gegner).padStart(5)}   ${f(r.step.med).padStart(7)} ${f(r.step.p95).padStart(6)} ${f(r.step.max, 1).padStart(6)} ${String(r.ueber).padStart(5)}   | ${f(r.voll.med).padStart(6)} ${f(r.voll.p95).padStart(5)} ${f(r.voll.max, 1).padStart(5)} ${String(r.ueberVoll).padStart(4)}   | ${String(r.snapMax).padStart(6)}  ${r.ticks}/${r.erwartet}  ${r.fehler}`);
for (const art of ['hoehle', 'wildnis']) {
  const a = alle.filter((r) => r.art === art);
  console.log(`Summe ${art}: step-Median max ${f(Math.max(...a.map((r) => r.step.med)))} ms, p95 max ${f(Math.max(...a.map((r) => r.step.p95)))} ms, Maximum ${f(Math.max(...a.map((r) => r.step.max)), 1)} ms, Ticks über Budget ${a.reduce((x, r) => x + r.ueber, 0)}, Snapshot max ${Math.max(...a.map((r) => r.snapMax))} B, Tick-Verlust ${a.some((r) => r.ticks !== r.erwartet) ? 'JA' : 'nein'}, Gegner min lebend ${Math.min(...a.map((r) => r.lebendMin))}, Geschosse max ${Math.max(...a.map((r) => r.projMax))}`);
}
