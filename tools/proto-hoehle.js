#!/usr/bin/env node
'use strict';
// GEL-02 A: Sicherung und Sichtkontrolle des Erzeugers shared/gen-hoehle.js (Kartenart hoehle, Deck unter Wildnis).
//   node tools/proto-hoehle.js                        3 Größen x 20 Seeds durch Buehne.ausRaster({spiel:true}); Exit 1 bei Prüferfehler/Fehlbau
//   node tools/proto-hoehle.js --seeds 50             andere Seedzahl je Lauf
//   node tools/proto-hoehle.js --ascii 7 [klein]      eine Karte als Text (Anker als Buchstaben); weitere: --dichte 0.7 --fundorte 3 --gegner keine
//   node tools/proto-hoehle.js --deck 7 [breite] [hoehe] [eingangX]   ein Deck als Text (deck-lokal)
// Je Lauf: Prüferfehler, Fehlbauten (Erzeuger wirft oder Prüfer scheitert; landepunkte.js würde Seed + 1 versuchen), Anker min/max, Payload, Bauzeit (Median, p95).
// Der Prüfer verlangt standardmäßig 2 Eingänge; die Höhle hat keine: hier wird jeArt.hoehle.eingaengeMin = 0 eingesetzt (so muss es später in shared/config.js stehen, Paket B).
const Buehne = require('../shared/buehne.js');
const Hoehle = require('../shared/gen-hoehle.js');
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');

const args = process.argv.slice(2);
const val = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const cfg = Object.assign({}, CONFIG.buehne, { jeArt: Object.assign({}, CONFIG.buehne.jeArt, { hoehle: Object.assign({}, (CONFIG.buehne.jeArt || {}).hoehle, { eingaengeMin: 0 }) }) });
const G = Hoehle.erzeuger();
const payloadB = (k) => Buffer.byteLength(JSON.stringify(Game.prototype.awayMapPayload.call({}, k)));
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const p95 = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]; };
const ms = () => Number(process.hrtime.bigint()) / 1e6;
const buchst = { abholpunkt: 'A', leiter: 'L', fund: 'U', deckung: 'd', wache: 'W', patrouille: 'p' };

function zeige(rows, anker, kopf) {
  const k = rows.map((z) => z.split(''));
  for (const a of anker) k[a.y][a.x] = a.schwer ? 'S' : buchst[a.rolle] || '?';
  const z = {}; for (const a of anker) z[a.rolle] = (z[a.rolle] || 0) + 1;
  console.log(kopf + ' · Anker ' + JSON.stringify(z));
  console.log(k.map((q) => q.join('')).join('\n'));
  console.log('Legende: A Abholpunkt (Ankunft) · L Leiter · U Fund · d Deckung · W Wache · S Wächter · p Patrouille · F Fels · , Boden · o/O Stein · a Wasser');
}

if (args.includes('--ascii')) {
  const i = args.indexOf('--ascii');
  const o = { groesse: ['klein', 'mittel', 'gross'].includes(args[i + 2]) ? args[i + 2] : 'mittel' };
  if (val('--dichte')) o.dichte = +val('--dichte');
  if (val('--fundorte')) o.fundorte = +val('--fundorte');
  if (val('--gegner')) o.gegner = val('--gegner') === 'keine' ? 'keine' : +val('--gegner');
  const roh = G.karteRoh(+args[i + 1], o);
  const r = Buehne.ausRaster(roh, { spiel: true, cfg });
  zeige(roh.rows, roh.anker, `Seed ${args[i + 1]} · ${roh.w}x${roh.h} · ${roh.bauversion} · Prüfer ${r.pruefung.ok ? 'ok' : 'FEHLER ' + r.fehler.slice(0, 3).map((f) => f.code + ' ' + f.msg).join('; ')} · ${payloadB(r.karte)} B`);
  process.exit(0);
}
if (args.includes('--deck')) {
  const i = args.indexOf('--deck');
  const d = G.deckRoh(+args[i + 1], { w: +args[i + 2] || 56, hoehe: +args[i + 3] || 40, eingangX: args[i + 4] == null ? undefined : +args[i + 4] });
  zeige(d.rows, d.anker, `Deck Seed ${args[i + 1]} · ${d.w}x${d.h} · ${d.meta.bauversion}`);
  process.exit(0);
}

const n = +val('--seeds', 20);
let fehlerGesamt = 0, fehlbauGesamt = 0;
const max = Protocol.AWAY_MAP_MAX_BYTES || 16384;
console.log(`Größe | Seeds | Prüferfehler | Fehlbau | Fund min-max | Deckung min-max | Wache min-max | Bytes max (Grenze ${max}) | Erzeuger ms Median/p95 | Prüfer ms Median/p95`);
for (const groesse of ['klein', 'mittel', 'gross']) {
  let fe = 0, fb = 0, bmax = 0;
  const tg = [], tp = [], mm = { fund: [9e9, 0], deckung: [9e9, 0], wache: [9e9, 0] };
  for (let s = 0; s < n; s++) {
    const seed = 101 + s * 7919;
    let roh;
    try { const t0 = ms(); roh = G.karteRoh(seed, { groesse }); tg.push(ms() - t0); } catch (e) { fb++; continue; }
    const t1 = ms();
    const r = Buehne.ausRaster(roh, { spiel: true, cfg });
    tp.push(ms() - t1);
    if (r.fehler.length) { fe++; fb++; continue; }
    bmax = Math.max(bmax, payloadB(r.karte));
    for (const k of Object.keys(mm)) { const c = roh.anker.filter((a) => a.rolle === k).length; mm[k][0] = Math.min(mm[k][0], c); mm[k][1] = Math.max(mm[k][1], c); }
  }
  fehlerGesamt += fe; fehlbauGesamt += fb;
  console.log(`${groesse} | ${n} | ${fe} | ${fb} | ${mm.fund.join('-')} | ${mm.deckung.join('-')} | ${mm.wache.join('-')} | ${bmax} | ${med(tg).toFixed(1)}/${p95(tg).toFixed(1)} | ${med(tp).toFixed(1)}/${p95(tp).toFixed(1)}`);
}
process.exit(fehlbauGesamt ? 1 : 0);
