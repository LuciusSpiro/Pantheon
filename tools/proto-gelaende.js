'use strict';
// GEL-01 A: Sicherung und Sichtkontrolle des Erzeugers shared/gen-gelaende.js (Kartenart wildnis).
//   node tools/proto-gelaende.js                          3 Biome x 3 Größen x 20 Seeds durch Buehne.ausRaster({spiel:true}); Exit 1 bei Prüferfehler/Fehlbau
//   node tools/proto-gelaende.js --seeds 50               andere Seedzahl je Lauf
//   node tools/proto-gelaende.js --ascii wueste 7 [mittel]  eine Karte als Text (Anker als Buchstaben); weitere: --dichte 0.7 --fundorte 3 --gegner keine
// Je Lauf: Fehlerzahl, Pflichtanker (min/max je Rolle), Payload-Bytes (wie Game.awayMapPayload), Bauzeit Erzeuger und Prüfer (Median, p95),
// Fehlbauten (Erzeuger wirft oder Prüfer scheitert; landepunkte.js würde Seed + 1 versuchen), Determinismus (gleicher Seed -> gleicher Hash).
// Der Prüfer verlangt standardmäßig 2 Eingänge (cfg.eingaengeMin); die Wildnis hat keine: hier wird jeArt.wildnis.eingaengeMin = 0 eingesetzt
// (so muss es später in shared/config.js stehen, Paket B).
const Buehne = require('../shared/buehne.js');
const Gelaende = require('../shared/gen-gelaende.js');
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');

const args = process.argv.slice(2);
const val = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const cfg = Object.assign({}, CONFIG.buehne, { jeArt: Object.assign({}, CONFIG.buehne.jeArt, { wildnis: Object.assign({}, (CONFIG.buehne.jeArt || {}).wildnis, { eingaengeMin: 0 }) }) });
const G = Gelaende.erzeuger();
const payloadB = (k) => Buffer.byteLength(JSON.stringify(Game.prototype.awayMapPayload.call({}, k)));
const hash = (o) => Buehne.fnv(JSON.stringify(o));
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const p95 = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]; };
const ms = () => Number(process.hrtime.bigint()) / 1e6;

function bauen(seed, opts) {
  const t0 = ms();
  const roh = G.karteRoh(seed, opts);
  const t1 = ms();
  const r = Buehne.ausRaster(roh, { spiel: true, cfg });
  return { roh, r, tGen: t1 - t0, tPru: ms() - t1 };
}

function ascii(biom, seed, groesse, opts) {
  const { roh, r } = bauen(seed, Object.assign({ biom, groesse }, opts));
  const k = roh.rows.map((z) => z.split(''));
  const buchst = { abholpunkt: 'A', fund: 'U', deckung: 'd', wache: 'W', patrouille: 'p' };
  for (const a of roh.anker) k[a.y][a.x] = a.schwer ? 'S' : buchst[a.rolle] || '?';
  const z = {}; for (const a of roh.anker) z[a.rolle] = (z[a.rolle] || 0) + 1;
  console.log(`Seed ${seed} · ${roh.meta.biom} · ${roh.w}x${roh.h} · ${roh.bauversion} · Prüfer ${r.pruefung.ok ? 'ok' : 'FEHLER ' + r.fehler.slice(0, 3).map((f) => f.code + ' ' + f.msg).join('; ')} · Anker ${JSON.stringify(z)} · ${payloadB(r.karte)} B`);
  console.log(k.map((q) => q.join('')).join('\n'));
  console.log('Legende: A Abholpunkt (Ankunft) · U Fund · d Deckung · W Wache · S Wächter · p Patrouille · F Fels · Y Baum · o/O Stein · s Busch · a Wasser · v Lava · : Boden');
}

if (args.includes('--ascii')) {
  const i = args.indexOf('--ascii');
  const o = {};
  if (val('--dichte')) o.dichte = +val('--dichte');
  if (val('--fundorte')) o.fundorte = +val('--fundorte');
  if (val('--gegner')) o.gegner = val('--gegner') === 'keine' ? 'keine' : +val('--gegner');
  ascii(args[i + 1], +args[i + 2], ['klein', 'mittel', 'gross'].includes(args[i + 3]) ? args[i + 3] : 'mittel', o);
  process.exit(0);
}

const n = +val('--seeds', 20);
let fehlerGesamt = 0, fehlbauGesamt = 0, laeufe = 0;
const max = Protocol.AWAY_MAP_MAX_BYTES || 16384;
console.log(`Biom × Größe | Seeds | Prüferfehler | Fehlbau | Fund min-max | Deckung min-max | Wache min-max | Bytes max (Grenze ${max}) | Erzeuger ms Median/p95 | Prüfer ms Median/p95 | meta.pflicht`);
for (const biom of Gelaende.BIOME) for (const groesse of ['klein', 'mittel', 'gross']) {
  let fe = 0, fb = 0, bmax = 0, pflichtOk = true;
  const mm = { fund: [99, 0], deckung: [99, 0], wache: [99, 0] };
  const tg = [], tp = [];
  for (let seed = 1; seed <= n; seed++) {
    let b;
    try { b = bauen(seed, { biom, groesse }); } catch (e) { fb++; console.log(`  FEHLBAU ${biom}/${groesse} Seed ${seed}: ${e.message}`); continue; }
    tg.push(b.tGen); tp.push(b.tPru);
    if (!b.r.pruefung.ok) { fb++; fe += b.r.fehler.length; console.log(`  PRÜFER ${biom}/${groesse} Seed ${seed}: ${b.r.fehler.slice(0, 3).map((f) => f.code + ' ' + f.msg).join('; ')}`); continue; }
    const z = {}; for (const a of b.roh.anker) z[a.rolle] = (z[a.rolle] || 0) + 1;
    for (const k of Object.keys(mm)) { const v = z[k] || 0; mm[k][0] = Math.min(mm[k][0], v); mm[k][1] = Math.max(mm[k][1], v); }
    for (const k of Object.keys(Gelaende.PFLICHT)) if ((z[k] || 0) < Gelaende.PFLICHT[k]) { fe++; console.log(`  PFLICHT ${biom}/${groesse} Seed ${seed}: ${k} ${z[k] || 0} < ${Gelaende.PFLICHT[k]}`); }
    if (JSON.stringify(b.roh.meta.pflicht) !== JSON.stringify(Gelaende.PFLICHT) || JSON.stringify(b.r.karte.meta.pflicht) !== JSON.stringify(Gelaende.PFLICHT)) pflichtOk = false;
    bmax = Math.max(bmax, payloadB(b.r.karte));
  }
  if (bmax > max) fe++;
  if (!pflichtOk) fe++;
  fehlerGesamt += fe; fehlbauGesamt += fb; laeufe += n;
  const r = (a) => a[0] + '-' + a[1];
  console.log(`${biom}/${groesse} | ${n} | ${fe} | ${fb} | ${r(mm.fund)} | ${r(mm.deckung)} | ${r(mm.wache)} | ${bmax} | ${med(tg).toFixed(1)}/${p95(tg).toFixed(1)} | ${med(tp).toFixed(1)}/${p95(tp).toFixed(1)} | ${pflichtOk ? 'ok' : 'ABWEICHEND'}`);
}

// Determinismus: gleicher Seed zweimal -> gleicher Hash; anderer Seed -> anderer; jede Option zählt; kein Math.random/Date im Erzeuger
let detFehler = 0;
for (const biom of Gelaende.BIOME) for (const groesse of ['klein', 'mittel', 'gross']) for (const seed of [3, 17, 4242]) {
  const o = { biom, groesse, dichte: 0.6, id: 'x' };
  const h1 = hash(G.karteRoh(seed, o)), h2 = hash(G.karteRoh(seed, o)), h3 = hash(G.karteRoh(seed + 1, o));
  const h4 = hash(Buehne.ausRaster(G.karteRoh(seed, o), { spiel: true, cfg }).karte), h5 = hash(Buehne.ausRaster(G.karteRoh(seed, o), { spiel: true, cfg }).karte);
  if (h1 !== h2 || h4 !== h5) { detFehler++; console.log(`  DETERMINISMUS ${biom}/${groesse} Seed ${seed}: gleicher Seed, anderer Hash`); }
  if (h1 === h3) { detFehler++; console.log(`  DETERMINISMUS ${biom}/${groesse} Seed ${seed}: anderer Seed, gleicher Hash`); }
}
const quelle = require('fs').readFileSync(require('path').join(__dirname, '../shared/gen-gelaende.js'), 'utf8');
if (/Math\.random|Date\b|performance\.now/.test(quelle.replace(/\/\/.*$/gm, ''))) { detFehler++; console.log('  DETERMINISMUS: Math.random/Date im Erzeuger'); }
console.log(`Determinismus-Selbsttest: ${detFehler ? detFehler + ' Fehler' : 'grün'} (27 Fälle: gleicher Seed zweimal gleich, Seed + 1 anders, roh und fertige Karte)`);
console.log(`Gesamt: ${laeufe} Karten, Prüferfehler ${fehlerGesamt}, Fehlbau ${fehlbauGesamt}${fehlbauGesamt ? ` (${(100 * fehlbauGesamt / laeufe).toFixed(1)} %)` : ''}`);
process.exit(fehlerGesamt || fehlbauGesamt || detFehler ? 1 : 0);
