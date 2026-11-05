#!/usr/bin/env node
'use strict';
// SCH-01 P0: Spike des Schiffsgenerators shared/gen-schiff.js.
//   node tools/proto-schiff.js            Seeds 1..20 durch Buehne.ausRaster({spiel:true}), Tabelle, ASCII für Seed 1
//   node tools/proto-schiff.js --seeds 50 --ascii 7
// awayMap-Bytes wie tools/proto-hoehle.js: Game.prototype.awayMapPayload (JSON-Länge in Bytes), Grenze Protocol.AWAY_MAP_MAX_BYTES.
const Buehne = require('../shared/buehne.js');
const GenSchiff = require('../shared/gen-schiff.js');
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');

const args = process.argv.slice(2);
const val = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const G = GenSchiff.erzeuger();
const payloadB = (k) => Buffer.byteLength(JSON.stringify(Game.prototype.awayMapPayload.call({}, k)));
const ms = () => Number(process.hrtime.bigint()) / 1e6;
const max = Protocol.AWAY_MAP_MAX_BYTES || 16384;
const buchst = { abholpunkt: 'A', lift: 'L', leiter: 'T', eingang: 'E', sprengpunkt: 'X', ziel: 'Z', terminal: 'P', zelle: 'C', beute: 'b', nsc: 'n', wache: 'W' };

function ascii(roh) {
  const k = roh.rows.map((z) => z.split(''));
  for (const a of roh.anker) k[a.y][a.x] = buchst[a.rolle] || '?';
  console.log(k.map((q) => q.join('')).join('\n'));
  console.log('Legende: # Wand · . Raumboden · , Gang · S Schott · D Tür · _ außen · A Abholpunkt · L Lift · T Leiter · E Eingang · X Sprengpunkt · Z Ziel · P Terminal · C Zelle · b Beute · n NSC · W Wache');
}

const asciiSeed = +val('--ascii', 1);
const n = +val('--seeds', 20);
console.log(`Seed | ok | Fehler | BxH | Anker | awayMap B (Grenze ${max}) | Bau ms | Prüfer ms`);
let rot = 0, bmax = 0, wmax = 0;
for (let seed = 1; seed <= n; seed++) {
  let roh, t0 = ms(), tb, r, tp;
  try { roh = G.karteRoh(seed, { bauweise: 'germanen' }); tb = ms() - t0; } catch (e) { rot++; console.log(`${seed} | NEIN | Erzeuger wirft: ${e.message} | - | - | - | - | -`); continue; }
  const t1 = ms();
  r = Buehne.ausRaster(roh, { spiel: true, cfg: CONFIG.buehne });
  tp = ms() - t1;
  const b = payloadB(r.karte);
  bmax = Math.max(bmax, b); wmax = Math.max(wmax, roh.w);
  if (!r.pruefung.ok) rot++;
  console.log(`${seed} | ${r.pruefung.ok ? 'ok' : 'NEIN'} | ${r.pruefung.ok ? '-' : r.fehler.slice(0, 4).map((f) => f.code + ' ' + f.msg).join('; ')} | ${roh.w}x${roh.h} | ${roh.anker.length} | ${b} | ${tb.toFixed(1)} | ${tp.toFixed(1)}`);
  if (seed === asciiSeed) { console.log(`--- ASCII Seed ${seed} ---`); ascii(roh); console.log('---'); }
}
console.log(`Ergebnis: ${n - rot}/${n} ok, max Breite ${wmax}, max awayMap ${bmax} B`);
process.exit(rot ? 1 : 0);
