#!/usr/bin/env node
'use strict';
// SCH-01 P1: Schiffsgenerator shared/gen-schiff.js durch den Prüfer (Buehne.ausRaster({spiel:true})), Tabelle und ASCII-Bild.
//   node tools/proto-schiff.js                                   Seeds 1..20, layout schiff, zustand intakt, ASCII für Seed 1
//   node tools/proto-schiff.js --layout rechteck --zustand verfallen --seeds 50 --ascii 7
//   node tools/proto-schiff.js --layout alle --zustand alle --seeds 50 --kurz      Summe je Kombination (ohne Zeilen je Seed)
//   --warn   zusätzlich Lauf ohne spiel:true (Kennzahlen, Warnungen K-DECKUNG/K-SICHTGASSE …) mit Zählung je Code
// awayMap-Bytes wie tools/proto-hoehle.js: Game.prototype.awayMapPayload (JSON-Länge in Bytes), Grenze Protocol.AWAY_MAP_MAX_BYTES.
const Buehne = require('../shared/buehne.js');
const GenSchiff = require('../shared/gen-schiff.js');
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');

const args = process.argv.slice(2);
const val = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(k);
const G = GenSchiff.erzeuger();
const payloadB = (k) => Buffer.byteLength(JSON.stringify(Game.prototype.awayMapPayload.call({}, k)));
const ms = () => Number(process.hrtime.bigint()) / 1e6;
const max = Protocol.AWAY_MAP_MAX_BYTES || 16384;
const buchst = { abholpunkt: 'A', lift: 'L', leiter: 'T', eingang: 'E', sprengpunkt: 'X', ziel: 'Z', terminal: 'P', zelle: 'C', beute: 'b', nsc: 'n', wache: 'W' };

function ascii(roh) {
  const k = roh.rows.map((z) => z.split(''));
  for (const a of roh.anker) k[a.y][a.x] = buchst[a.rolle] || '?';
  console.log(k.map((q) => q.join('')).join('\n'));
  console.log('Legende: # Wand · . Raumboden · , Gang · S Schott · D Tür · L Luke · _ außen · ~ Hüllenloch · o O I Deckung · z Gitter · x X Trümmer/Schutt · A Abholpunkt · L Lift · T Leiter · E Eingang · X Sprengpunkt · Z Ziel · P Terminal · C Zelle · b Beute · n NSC · W Wache');
}

const layouts = val('--layout', 'schiff') === 'alle' ? ['schiff', 'rechteck'] : [val('--layout', 'schiff')];
const zustaende = val('--zustand', 'intakt') === 'alle' ? ['intakt', 'verfallen', 'umkaempft'] : [val('--zustand', 'intakt')];
const asciiSeed = +val('--ascii', 1);
const n = +val('--seeds', 20);
const kurz = flag('--kurz');
let rotGesamt = 0;
for (const layout of layouts) for (const zustand of zustaende) {
  if (!kurz) console.log(`== layout ${layout}, zustand ${zustand} ==\nSeed | ok | Fehler | BxH | Anker | awayMap B (Grenze ${max}) | Bau ms | Prüfer ms`);
  let rot = 0, wurf = 0, bmax = 0, wmax = 0; const warn = {}; let warnKarten = 0;
  for (let seed = 1; seed <= n; seed++) {
    let roh, t0 = ms(), tb;
    try { roh = G.karteRoh(seed, { layout, zustand, bauweise: 'germanen' }); tb = ms() - t0; } catch (e) { wurf++; rot++; if (!kurz) console.log(`${seed} | NEIN | Erzeuger wirft: ${e.message} | - | - | - | - | -`); continue; }
    const t1 = ms();
    const r = Buehne.ausRaster(roh, { spiel: true, cfg: CONFIG.buehne });
    const tp = ms() - t1;
    const b = payloadB(r.karte);
    bmax = Math.max(bmax, b); wmax = Math.max(wmax, roh.w);
    if (!r.pruefung.ok || b > max) rot++;
    if (flag('--warn')) { const w = Buehne.ausRaster(roh, { cfg: CONFIG.buehne }).pruefung.warnungen || []; if (w.length) warnKarten++; for (const x of w) warn[x.code] = (warn[x.code] || 0) + 1; }
    if (!kurz) console.log(`${seed} | ${r.pruefung.ok ? 'ok' : 'NEIN'} | ${r.pruefung.ok ? '-' : r.fehler.slice(0, 4).map((f) => f.code + ' ' + f.msg).join('; ')} | ${roh.w}x${roh.h} | ${roh.anker.length} | ${b} | ${tb.toFixed(1)} | ${tp.toFixed(1)}`);
    if (seed === asciiSeed && !kurz) { console.log(`--- ASCII Seed ${seed} (${layout}, ${zustand}) ---`); ascii(roh); console.log('---'); }
  }
  rotGesamt += rot;
  console.log(`Ergebnis ${layout}/${zustand}: ${n - rot}/${n} ok (${wurf} Erzeuger-Würfe), max Breite ${wmax}, max awayMap ${bmax} B` + (flag('--warn') ? `, Warnungen: ${warnKarten} Karten mit Warnung ${JSON.stringify(warn)}` : ''));
}
process.exit(rotGesamt ? 1 : 0);
