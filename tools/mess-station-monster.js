#!/usr/bin/env node
'use strict';
// MON-02 O3b: Messung Modell gegen Kollisionsbox und Wände beim Station-Monster (Messskript, kein Test, kein Gate-Wert).
// Das Modell Schottbrecher ist 28 Voxel (1,75 m = 56 px) breit, der Server rechnet mit der Box HB 28 × 28 px (server/sim/monster.js, nicht geändert);
// der Weg (Maske) verlangt 2 × 2 freie Kacheln um die Gitterpunkte. Gemessen wird im echten Spiel (Station Helix, ganze Patrouille und Jagd), wie weit das Modell
// über die Box und in feste Kacheln ragt. Das Modell wird als Rechteck der Rig-Maße gedreht mit der Blickrichtung (x ±14 Voxel, z −14..+14,9 Voxel) und als Kreis
// (Kreisregel des Rigs: alle Voxelmitten höchstens 15,29 Voxel von der Mitte) geprüft.
//   node tools/mess-station-monster.js [--sek N] [--seeds 21,33] [--json]
const CONFIG = require('../shared/config.js');
const Locations = require('../shared/locations.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Welt = require('../server/sim/welt.js');
const away = require('../server/sim/away.js');
const combat = require('../server/sim/combat.js');
const Monster = require('../server/sim/monster.js');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const SEK = +arg('--sek', 120), SEEDS = String(arg('--seeds', '21,33')).split(',').map(Number), JSONAUS = process.argv.includes('--json');
const DT = 1 / CONFIG.tickHz, VOX = 2;   // px je Voxel (16 Voxel = 1 m = 32 px)
const HB = Monster.HB, RUCK = 7 * 2;   // Ruck beim Rammen: 7 Voxel = 14 px (actors.js SM_RUCK_VOXEL)
const MODELL = { halbBreite: 14 * VOX, hinten: 14 * VOX, vorn: 14.9 * VOX, kreis: 15.29 * VOX };

function station(seed) {
  const g = new Game({ noStore: true, worlds: false, seed, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { if (this.inbox.length < 4000) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'M0', name: 'Mess', color: 0 }); g.handleMessage(c, { t: 'lobbyOpt', startMission: 'free' });
  g.handleMessage(c, { t: 'ready', ready: true });
  Welt.waehle(g, 'sund'); g.god = true;
  space.enterScene(g, 'helix', {});
  const sc = Locations.get('helix').scene; g.ship.x = sc.station.x - 100; g.ship.y = sc.station.y;
  const run = (sec, each) => { for (let k = 0; k < Math.round(sec / DT); k++) { if (each && each(k * DT) === true) return; g.step(); } };
  run(0.2); g.chooseLandepunkt(g.players[0], 'helix.station'); away.executeBeam(g, g.players.map((q) => q.id), 'down'); run(0.3);
  return { g, run };
}
// Tiefe (px) eines Punktes in einer festen Kachel: Abstand zur nächsten Kachelkante, 0 wenn frei
function tiefe(solid, x, y) {
  const tx = Math.floor(x / 32), ty = Math.floor(y / 32);
  if (!solid(tx, ty)) return 0;
  return Math.min(x - tx * 32, (tx + 1) * 32 - x, y - ty * 32, (ty + 1) * 32 - y);
}
function ueberstand(solid, M, f, ruck) {
  let rechteck = 0, kreis = 0;
  const c = Math.cos(f), s = Math.sin(f);   // Blick (c, s) in Spielkoordinaten, quer (-s, c)
  const pt = (u, v) => [M.x + c * u - s * v, M.y + s * u + c * v];   // u nach vorn, v quer
  const R = Object.assign({}, MODELL); R.vorn += ruck || 0; R.hinten -= ruck || 0;   // Ruck: Wurzel um ruck px nach vorn
  for (let i = 0; i <= 12; i++) {
    const a = -R.halbBreite + (2 * R.halbBreite * i) / 12, b = -R.hinten + ((R.hinten + R.vorn) * i) / 12;
    for (const [u, v] of [[R.vorn, a], [-R.hinten, a], [b, R.halbBreite], [b, -R.halbBreite]]) { const p = pt(u, v); rechteck = Math.max(rechteck, tiefe(solid, p[0], p[1])); }
  }
  for (let i = 0; i < 32; i++) { const w = i / 32 * Math.PI * 2; kreis = Math.max(kreis, tiefe(solid, M.x + Math.cos(f) * (ruck || 0) + Math.cos(w) * R.kreis, M.y + Math.sin(f) * (ruck || 0) + Math.sin(w) * R.kreis)); }
  return { rechteck, kreis };
}

const ergebnis = { box: HB, modell: { breite: 2 * MODELL.halbBreite, laenge: MODELL.hinten + MODELL.vorn, kreisRadius: MODELL.kreis }, laeufe: [] };
for (const seed of SEEDS) {
  const { g, run } = station(seed), aw = g.away, M = aw.monster, p = g.players[0], E = combat.env(g);
  const Z = { gesamt: { n: 0, r: 0, k: 0, rmax: 0, kmax: 0 }, jagd: { n: 0, r: 0, k: 0, rmax: 0, kmax: 0 }, rammen: { n: 0, r: 0, k: 0, rmax: 0, kmax: 0 } };
  const wirf = (Zs, u) => { Zs.n++; if (u.rechteck > 0) Zs.r++; if (u.kreis > 0) Zs.k++; Zs.rmax = Math.max(Zs.rmax, u.rechteck); Zs.kmax = Math.max(Zs.kmax, u.kreis); };
  g.C.monster = Object.assign({}, g.C.monster || {}, { treffer: 0 });   // keine Bisse: das Monster soll ungestört laufen
  p.x = 3 * 32; p.y = 3 * 32;
  let nextJagd = 20;
  run(SEK, (t) => {
    if (t > nextJagd) { const a = Math.atan2(Math.sin(M.facing), Math.cos(M.facing)); p.x = M.x + Math.cos(M.facing) * 150; p.y = M.y + Math.sin(M.facing) * 150; nextJagd += 25; void a; }
    const u = ueberstand(E.solid, M, M.facing, M.ramm ? RUCK : 0);
    wirf(Z.gesamt, u); if (M.z === 'jagd') wirf(Z.jagd, u); if (M.ramm) wirf(Z.rammen, u);
    return false;
  });
  ergebnis.laeufe.push({ seed, sek: SEK, ...Z });
}
if (JSONAUS) console.log(JSON.stringify(ergebnis, null, 1));
else {
  console.log('Box (Server, nicht geändert): ' + HB.w + ' × ' + HB.h + ' px; Modell: ' + ergebnis.modell.breite + ' px breit (1,75 m), ' + ergebnis.modell.laenge.toFixed(1) + ' px lang, Kreisradius ' + ergebnis.modell.kreisRadius.toFixed(1) + ' px');
  console.log('Überstand über die Box: seitlich ' + ((2 * MODELL.halbBreite - HB.w) / 2) + ' px je Seite, vorn ' + (MODELL.vorn - HB.h / 2).toFixed(1) + ' px, hinten ' + (MODELL.hinten - HB.h / 2) + ' px');
  for (const l of ergebnis.laeufe) {
    for (const k of ['gesamt', 'jagd', 'rammen']) {
      const z = l[k];
      console.log('Seed ' + l.seed + ' (' + l.sek + ' s) ' + k + ': ' + z.n + ' Ticks, Rechteck in fester Kachel ' + (z.n ? (z.r / z.n * 100).toFixed(1) : '0') + ' % (max. ' + z.rmax.toFixed(1) + ' px tief), Kreis ' + (z.n ? (z.k / z.n * 100).toFixed(1) : '0') + ' % (max. ' + z.kmax.toFixed(1) + ' px tief)');
    }
  }
}
process.exit(0);
