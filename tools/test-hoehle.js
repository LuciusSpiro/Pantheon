#!/usr/bin/env node
'use strict';
// GEL-02 A: Erzeuger shared/gen-hoehle.js (Kartenart hoehle und Deck unter Wildnis), Nachweise in eingecheckter Form.
//   a) Determinismus   b) Prüfer-Sweep, Fallback-Rate, Erreichbarkeit, Engstellen, Pflichtsatz   c) deckRoh (Grenzzeilen, Anker, IDs, deck-lokale y)
//   d) Bauzeit und Payload   e) Kombination Wildnis + Deck durch den Prüfer (K-DECK, K-ERREICHBAR)
//   node tools/test-hoehle.js      (Umgebung: SEEDS=<n> je Größe, Standard 50; KOMBI=<n> Seeds je Größe der Kombination, Standard 25; VERBOSE=1)
const Buehne = require('../shared/buehne.js');
const Hoehle = require('../shared/gen-hoehle.js');
const Gelaende = require('../shared/gen-gelaende.js');
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');

let n = 0, bad = 0;
const ok = (c, t) => { n++; if (!c) { bad++; console.log('  FEHLER ' + t); } else if (process.env.VERBOSE) console.log('  ok   ' + t); };
const abschnitt = (t) => console.log('[' + t + ']');
const SEEDS = Math.max(1, +process.env.SEEDS || 50);
const KOMBI = Math.max(1, +process.env.KOMBI || 25);
const GR = Object.keys(Hoehle.GROESSEN);
const seedVon = (i) => 101 + i * 7919;
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
const cfg = CONFIG.buehne;   // GEL-02 B: jeArt.hoehle.eingaengeMin = 0 steht in shared/config.js (echte Produktionskonfiguration)
const H = Hoehle.erzeuger();
const ms = () => Number(process.hrtime.bigint()) / 1e6;
const payloadB = (k) => Buffer.byteLength(JSON.stringify(Game.prototype.awayMapPayload.call({}, k)));
const N4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// Flutfüllung über ',' (Boden) ab (sx, sy), unabhängig vom Prüfer (nur Bodenkacheln, Steine/Wasser/Fels blockieren)
function flut(rows, sx, sy) {
  const h = rows.length, w = rows[0].length, seen = new Uint8Array(w * h), q = [sy * w + sx];
  if (rows[sy][sx] !== ',') return seen;
  seen[q[0]] = 1;
  for (let i = 0; i < q.length; i++) { const u = q[i], ux = u % w, uy = (u - ux) / w;
    for (const [dx, dy] of N4) { const x = ux + dx, y = uy + dy; if (x < 0 || y < 0 || x >= w || y >= h || seen[y * w + x] || rows[y][x] !== ',') continue; seen[y * w + x] = 1; q.push(y * w + x); } }
  return seen;
}
// Engstellen: Bodenkachel mit blockierter Gegenüberliegenden-Paarung (links+rechts oder oben+unten) oder Diagonal-Engpass (Boden nur über Eck).
// Blockiert = Fels. Steine und Pfützen stehen nur dort, wo ringsum 2 Kacheln frei sind (Gaps zwischen zwei Steinen liegen im offenen Raum, nie in einem Gang).
function engstellen(rows) {
  const h = rows.length, w = rows[0].length, bl = (x, y) => x < 0 || y < 0 || x >= w || y >= h || rows[y][x] === 'F';
  let boden = 0, eng = 0, diag = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rows[y][x] === ',') { boden++; if ((bl(x - 1, y) && bl(x + 1, y)) || (bl(x, y - 1) && bl(x, y + 1))) eng++; }
    if (x + 1 < w && y + 1 < h) { const a = !bl(x, y), b = !bl(x + 1, y), c = !bl(x, y + 1), d = !bl(x + 1, y + 1); if ((a && d && !b && !c) || (b && c && !a && !d)) diag++; }
  }
  return { boden, eng, diag };
}
function bau(seed, opts) {
  const roh = H.karteRoh(seed, opts);
  const r = Buehne.ausRaster(roh, { spiel: true, cfg });
  return { roh, r, fehler: r.fehler };
}

// ---------------------------------------------------------------- a) Determinismus
abschnitt('a) Determinismus');
{
  let gleich = 0, anders = 0;
  for (const gr of GR) {
    const a = H.karteRoh(seedVon(3), { groesse: gr }), b = H.karteRoh(seedVon(3), { groesse: gr }), c = H.karteRoh(seedVon(4), { groesse: gr });
    if (JSON.stringify(a) === JSON.stringify(b)) gleich++;
    if (a.rows.join('') !== c.rows.join('')) anders++;
  }
  ok(gleich === GR.length, `karteRoh: gleicher Seed zweimal byte-gleich (${gleich}/${GR.length} Größen)`);
  ok(anders === GR.length, `karteRoh: anderer Seed, andere Zeilen (${anders}/${GR.length} Größen)`);
  const vars = [{ dichte: 0 }, { dichte: 1 }, { fundorte: 2 }, { fundorte: 4 }, { gegner: 'keine' }, { gegner: 0 }, { gegner: 6 }, { dichte: 0.8, fundorte: 3, gegner: 4 }];
  let det = 0, sauber = 0;
  for (const v of vars) for (const gr of GR) {
    const o = Object.assign({ groesse: gr }, v), a = bau(seedVon(5), o), b = bau(seedVon(5), o);
    if (JSON.stringify(a.roh) === JSON.stringify(b.roh)) det++;
    if (a.fehler.length === 0) sauber++;
  }
  ok(det === vars.length * GR.length, `opts-Varianten: byte-gleich bei gleichem Seed (${det}/${vars.length * GR.length})`);
  ok(sauber === vars.length * GR.length, `opts-Varianten bauen ohne Prüferfehler (${sauber}/${vars.length * GR.length})`);
  const zaehle = (k, rolle) => k.anker.filter((x) => x.rolle === rolle).length;
  ok(zaehle(H.karteRoh(seedVon(5), { groesse: 'gross', fundorte: 2 }), 'fund') === 2 && zaehle(H.karteRoh(seedVon(5), { groesse: 'gross', fundorte: 4 }), 'fund') === 4, 'opts.fundorte wirkt (2 und 4)');
  const g0 = H.karteRoh(seedVon(5), { groesse: 'mittel', gegner: 'keine' });
  ok(zaehle(g0, 'wache') === 0 && Object.values(g0.bereiche).every((b) => !b.gefecht), 'opts.gegner "keine": keine Wachen, keine Gefechtsbereiche');
  const lagerZahl = (k) => Object.values(k.bereiche).filter((b) => b.gefecht).length;
  ok(lagerZahl(H.karteRoh(seedVon(5), { groesse: 'gross', gegner: 3 })) === 3, 'opts.gegner 3: drei Lager');
  const d0 = H.karteRoh(seedVon(5), { groesse: 'mittel', dichte: 0 }), d1 = H.karteRoh(seedVon(5), { groesse: 'mittel', dichte: 1 });
  const bo = (k) => k.rows.join('').replace(/F/g, '').length;
  ok(bo(d0) > bo(d1), `opts.dichte wirkt (Bodenkacheln: dichte 0 -> ${bo(d0)}, dichte 1 -> ${bo(d1)})`);
  ok(JSON.stringify(H.karteRoh(5, { groesse: 'klein' })) === JSON.stringify(H.karteRoh(5 + 4294967296, { groesse: 'klein' })), 'Seed wird mit |0 normiert (5 und 2^32+5 gleich)');
  ok(H.karteRoh(7, {}).w === Hoehle.GROESSEN.mittel.w, 'ohne opts: Größe mittel');
  let dd = 0;
  for (const gr of GR) { const d = Hoehle.GROESSEN[gr]; const a = H.deckRoh(seedVon(2), { w: d.w, hoehe: 30, eingangX: 20 }), b = H.deckRoh(seedVon(2), { w: d.w, hoehe: 30, eingangX: 20 }); if (JSON.stringify(a) === JSON.stringify(b)) dd++; }
  ok(dd === GR.length, `deckRoh: gleicher Seed zweimal byte-gleich (${dd}/${GR.length})`);
  ok(H.deckRoh(1, { w: 56, hoehe: 30 }).rows.join('') !== H.deckRoh(2, { w: 56, hoehe: 30 }).rows.join(''), 'deckRoh: anderer Seed, andere Zeilen');
  ok(H.karteRoh(7, { groesse: 'klein' }).rows.join('') !== H.deckRoh(7, { w: 56, hoehe: 40 }).rows.join(''), 'karteRoh und deckRoh benutzen verschiedene Zufallsströme');
}

// ---------------------------------------------------------------- b) Sweep
abschnitt('b) Prüfer-Sweep, Fallback, Erreichbarkeit, Engstellen, Pflichtsatz');
const zeiten = {}, payloads = {};
for (const gr of GR) {
  let fehl = 0, wurf = 0, erreichFehl = 0, ankerFalsch = 0, pflichtFehl = 0, randFehl = 0, endlos = 0;
  let boden = 0, eng = 0, diag = 0, taschen = 0, lagerOhneWache = 0;
  const tz = [], pl = [];
  for (let i = 0; i < SEEDS; i++) {
    let seed = seedVon(i), roh = null, r = null;
    // Fallback wie der Aufrufer: Wurf oder Prüferfehler -> Seed + 1
    for (let v = 0; v < 6; v++) {
      try { const t0 = ms(); roh = H.karteRoh(seed + v, { groesse: gr }); tz.push(ms() - t0); } catch (e) { if (v === 0) wurf++; roh = null; continue; }
      r = Buehne.ausRaster(roh, { spiel: true, cfg });
      if (r.fehler.length) { if (v === 0) fehl++; if (process.env.VERBOSE) console.log('  Prüfer ' + gr + ' ' + (seed + v) + ': ' + r.fehler.slice(0, 2).map((f) => f.code + ' ' + f.msg).join('; ')); roh = null; continue; }
      break;
    }
    if (!roh) { endlos++; continue; }
    // erste Variante ohne Fallback für die Eigenschaftsprüfung (die Rate steht oben); hier die, die der Aufrufer bekäme
    const rows = roh.rows, w = roh.w, h = roh.h;
    pl.push(payloadB(r.karte));
    const ab = roh.anker.find((a) => a.rolle === 'abholpunkt' && a.ankunft);
    if (!ab) { pflichtFehl++; continue; }
    const seen = flut(rows, ab.x, ab.y);
    // jede Bodenkachel, jeder Anker, jede Kammer (Lagerwachen) erreichbar; keine Taschen
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rows[y][x] === ',' && !seen[y * w + x]) taschen++;
    for (const a of roh.anker) { if (rows[a.y][a.x] !== ',') ankerFalsch++; if (!seen[a.y * w + a.x]) erreichFehl++; }
    for (const [id, b] of Object.entries(roh.bereiche)) if (b.gefecht && !roh.anker.some((a) => a.rolle === 'wache' && a.bereich === id)) lagerOhneWache++;
    for (const [rolle, soll] of Object.entries(Hoehle.PFLICHT)) if (roh.anker.filter((a) => a.rolle === rolle).length < soll) pflichtFehl++;
    for (let x = 0; x < w; x++) if (rows[0][x] !== 'F' || rows[h - 1][x] !== 'F') randFehl++;
    for (let y = 0; y < h; y++) if (rows[y][0] !== 'F' || rows[y][w - 1] !== 'F') randFehl++;
    const e = engstellen(rows); boden += e.boden; eng += e.eng; diag += e.diag;
  }
  zeiten[gr] = median(tz); payloads[gr] = pl.length ? [Math.min(...pl), median(pl), Math.max(...pl)] : [0, 0, 0];
  console.log(`  ${gr}: ${SEEDS} Seeds, Fallback (Seed+1) nötig bei ${wurf + fehl} (Wurf ${wurf}, Prüfer ${fehl}) = ${(100 * (wurf + fehl) / SEEDS).toFixed(1)} %, ohne Erfolg in 6 Versuchen ${endlos}; Engstellen (1-breit) ${eng}/${boden} Bodenkacheln, Diagonalengpässe ${diag}`);
  ok(endlos === 0, `${gr}: jeder Seed baut innerhalb von 6 Versuchen ohne Prüferfehler`);
  ok(wurf === 0 && fehl === 0, `${gr}: Fallback-Rate 0 (Wurf ${wurf}, Prüferfehler ${fehl})`);
  ok(taschen === 0 && erreichFehl === 0, `${gr}: jede Bodenkachel und jeder Anker (Kammern, Funde, Lager) per eigener Flutfüllung von der Ankunft erreichbar (Taschen ${taschen}, unerreichbare Anker ${erreichFehl})`);
  ok(ankerFalsch === 0, `${gr}: alle Anker stehen auf Boden (nie auf Stein, Wasser, Fels)`);
  ok(pflichtFehl === 0, `${gr}: Pflichtsatz abholpunkt/fund/deckung erfüllt`);
  ok(randFehl === 0, `${gr}: Rand (oberste und unterste Zeile, linke und rechte Spalte) ist Fels`);
  ok(lagerOhneWache === 0, `${gr}: jedes Lager hat Wachen`);
  ok(eng === 0 && diag === 0, `${gr}: keine Engstellen unter 2 Kacheln (Bodenkacheln mit Fels/Stein/Wasser auf zwei Gegenseiten: ${eng}, Diagonalengpässe: ${diag})`);
}
{
  const kl = H.karteRoh(seedVon(1), { groesse: 'klein' });
  ok(kl.art === 'hoehle' && /^hoehle\.1\[/.test(kl.bauversion) && kl.meta.boden2 === 'erde', 'art hoehle, bauversion hoehle.1[...], meta.boden2 erde');
  ok(kl.w === 56 && kl.h === 40 && kl.rows.every((z) => z.length === 56), 'klein 56x40');
  ok(kl.ankunft === 'hoehle.abholpunkt' && kl.anker.some((a) => a.id === 'hoehle.abholpunkt' && a.ankunft === true), 'Ankunft = Anker hoehle.abholpunkt mit ankunft: true');
  const ids = kl.anker.map((a) => a.id);
  ok(new Set(ids).size === ids.length, 'Anker-IDs eindeutig');
  ok(JSON.stringify(Hoehle.PFLICHT) === JSON.stringify({ abholpunkt: 1, fund: 2, deckung: 4 }) && JSON.stringify(Hoehle.PFLICHT_DECK) === JSON.stringify({ fund: 2, deckung: 4 }), 'PFLICHT und PFLICHT_DECK exportiert');
  ok(!/[^F,oOa]/.test(kl.rows.join('')), 'nur vorhandene Kachelzeichen F , o O a');
  // Stein-Deckung: jedes Deckungsanker liegt neben einem Stein
  const nachbar = (a) => { for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]) if ('oO'.includes(kl.rows[a.y + dy][a.x + dx])) return true; return false; };
  ok(kl.anker.filter((a) => a.rolle === 'deckung').every(nachbar), 'jedes Deckungsanker liegt neben einem Stein');
}

// ---------------------------------------------------------------- c) deckRoh
abschnitt('c) deckRoh');
{
  let rand = 0, aufBoden = 0, praefix = 0, lokal = 0, leiterNah = 0, leiterRolle = 0, eind = 0, lagerPraefix = 0, flutFehl = 0, eng = 0, pflicht = 0, gesamt = 0, hoeheOk = 0;
  const fall = [];
  for (const w of [56, 80, 104]) for (const hoehe of [20, 30, 60, 94, 190]) for (let i = 0; i < 6; i++) fall.push({ w, hoehe, eingangX: [4, 10, Math.floor(w / 2), w - 8, w - 5, 30][i], seed: seedVon(i * 3 + hoehe) });
  for (const f of fall) {
    gesamt++;
    const d = H.deckRoh(f.seed, { w: f.w, hoehe: f.hoehe, eingangX: f.eingangX, fundorte: 2 + (f.seed % 3) });
    if (d.w === f.w && d.h === f.hoehe && d.rows.length === f.hoehe && d.rows.every((z) => z.length === f.w)) hoeheOk++;
    let ok1 = true;
    for (let x = 0; x < d.w; x++) if (d.rows[0][x] !== 'F' || d.rows[d.h - 1][x] !== 'F') ok1 = false;
    for (let y = 0; y < d.h; y++) if (d.rows[y][0] !== 'F' || d.rows[y][d.w - 1] !== 'F') ok1 = false;
    if (ok1) rand++;
    if (d.anker.every((a) => d.rows[a.y][a.x] === ',')) aufBoden++;
    if (d.anker.every((a) => /^hoehle\./.test(a.id)) && Object.keys(d.bereiche).every((b) => /^hoehle(_|$)/.test(b))) praefix++;
    if (Object.entries(d.bereiche).filter(([, b]) => b.gefecht).every(([id]) => /^hoehle_lager_\d+$/.test(id))) lagerPraefix++;
    if (d.anker.every((a) => a.y >= 0 && a.y < d.h && a.x >= 0 && a.x < d.w)) lokal++;
    const L = d.anker.filter((a) => a.rolle === 'leiter');
    if (L.length === 1 && L[0].id === 'hoehle.leiter') leiterRolle++;
    if (L.length === 1 && Math.abs(L[0].x - f.eingangX) <= 3) leiterNah++;
    const ids = d.anker.map((a) => a.id); if (new Set(ids).size === ids.length) eind++;
    if (L.length === 1) { const seen = flut(d.rows, L[0].x, L[0].y); if (!d.anker.every((a) => seen[a.y * d.w + a.x]) || d.rows.some((z, y) => [...z].some((c, x) => c === ',' && !seen[y * d.w + x]))) flutFehl++; }
    if (engstellen(d.rows).eng === 0 && engstellen(d.rows).diag === 0) eng++;
    if (Object.entries(Hoehle.PFLICHT_DECK).every(([r, s]) => d.anker.filter((a) => a.rolle === r).length >= s) && JSON.stringify(d.meta.pflicht) === JSON.stringify(Hoehle.PFLICHT_DECK) && d.meta.boden2 === 'erde' && !d.anker.some((a) => a.rolle === 'abholpunkt')) pflicht++;
  }
  ok(hoeheOk === gesamt, `Maße w x hoehe wie verlangt (${hoeheOk}/${gesamt})`);
  ok(rand === gesamt, `Grenzzeilen (oberste, unterste Zeile) und Seitenspalten sind Fels (${rand}/${gesamt})`);
  ok(aufBoden === gesamt, `alle Anker auf Boden (${aufBoden}/${gesamt})`);
  ok(praefix === gesamt && lagerPraefix === gesamt, `Anker-IDs hoehle.*, Bereiche hoehle / hoehle_lager_n (${praefix}/${gesamt})`);
  ok(lokal === gesamt, `deck-lokale y (alle Anker innerhalb 0..hoehe-1) (${lokal}/${gesamt})`);
  ok(eind === gesamt, `Anker-IDs eindeutig (${eind}/${gesamt})`);
  ok(leiterRolle === gesamt, `genau ein Anker hoehle.leiter mit rolle leiter (${leiterRolle}/${gesamt})`);
  ok(leiterNah === gesamt, `Leiter höchstens 3 Spalten von eingangX entfernt (${leiterNah}/${gesamt})`);
  ok(flutFehl === 0, `alle Anker und Bodenkacheln vom Leiter-Ende aus erreichbar (Verstöße ${flutFehl}/${gesamt})`);
  ok(eng === gesamt, `keine Engstellen unter 2 Kacheln (${eng}/${gesamt})`);
  ok(pflict(pflicht, gesamt), `PFLICHT_DECK erfüllt, meta.boden2 erde, kein abholpunkt (${pflicht}/${gesamt})`);
  const d = H.deckRoh(seedVon(1), { w: 56, hoehe: 30, eingangX: 25, gegner: 2 });
  ok(Object.values(d.bereiche).filter((b) => b.gefecht).length === 2, 'deckRoh opts.gegner wirkt');
  ok(Object.values(H.deckRoh(seedVon(1), { w: 56, hoehe: 30, gegner: 'keine' }).bereiche).every((b) => !b.gefecht), 'deckRoh gegner "keine": keine Gefechtsbereiche');
  // Rand-Ausreißer von eingangX: in 4..w-5 geklemmt
  const e = H.deckRoh(seedVon(1), { w: 56, hoehe: 30, eingangX: 999 });
  ok(e.anker.find((a) => a.rolle === 'leiter').x <= 56 - 2, 'eingangX außerhalb wird geklemmt');
}
function pflict(a, b) { return a === b; }

// ---------------------------------------------------------------- d) Bauzeit und Payload
abschnitt('d) Bauzeit und Payload');
{
  for (const gr of GR) console.log(`  ${gr}: Bauzeit Median ${zeiten[gr].toFixed(1)} ms, awayMap-Payload min/Median/max ${payloads[gr].join(' / ')} B (Grenze ${Protocol.AWAY_MAP_MAX_BYTES})`);
  for (const gr of GR) { ok(zeiten[gr] < 100, `${gr}: Bauzeit Median unter 100 ms`); ok(payloads[gr][2] < Protocol.AWAY_MAP_MAX_BYTES, `${gr}: Payload unter ${Protocol.AWAY_MAP_MAX_BYTES} B`); }
  // grobe Schätzung eines Decks (Zeichen + Anker), die der Aufrufer für sein Budget braucht
  for (const [w, hh] of [[56, 40], [56, 100], [80, 56], [80, 90]]) {
    const d = H.deckRoh(seedVon(9), { w, hoehe: hh });
    const b = d.rows.reduce((s, z) => s + z.length + 3, 0) + JSON.stringify(d.anker).length;
    console.log(`  Deck ${w}x${hh}: Zeilen ${d.rows.length * (w + 3)} B + Anker ${JSON.stringify(d.anker).length} B (${d.anker.length} Anker) = ca. ${b} B`);
  }
}

// ---------------------------------------------------------------- e) Kombination: Wildnis + Deck durch den Prüfer
abschnitt('e) Kombination Wildnis + Höhlendeck (Testhilfe: baut Wildnis + deckRoh von Hand; der Produktweg ist gen-gelaende hoehleDazu, geprüft in test-wildnis-hoehle.js)');
// Wie Paket C es tun wird: Zeilen untereinander (stride = Höhe der Oberfläche, keine Lücke: die zwei Randzeilen F trennen die Decks), Deck-Anker um stride versetzt,
// Leiter oben auf einer erreichbaren Oberflächenkachel mit freier Umgebung (40-80 % des Wegs zur Ankunft), unten freigeräumte Kammer nahe eingangX.
function kombi(seed, groesse, biom, hoehe) {
  const roh = Gelaende.erzeuger().karteRoh(seed, { groesse, biom });
  const Wd = roh.w, S = roh.h;
  const A = roh.anker.find((a) => a.ankunft);
  const d = new Int32Array(Wd * S).fill(-1), q = [A.y * Wd + A.x]; d[q[0]] = 0;
  for (let i = 0; i < q.length; i++) { const u = q[i], ux = u % Wd, uy = (u - ux) / Wd;
    for (const [dx, dy] of N4) { const x = ux + dx, y = uy + dy; if (x >= 0 && y >= 0 && x < Wd && y < S && d[y * Wd + x] < 0 && (roh.rows[y][x] === ':' || roh.rows[y][x] === 's')) { d[y * Wd + x] = d[u] + 1; q.push(y * Wd + x); } } }
  let max = 0; for (const v of d) if (v > max) max = v;
  const kand = [];
  for (let y = 3; y < S - 4; y++) for (let x = 3; x < Wd - 3; x++) {
    const dd = d[y * Wd + x]; if (dd < max * 0.4 || dd > max * 0.8) continue;
    let frei = true; for (let dy = -1; dy <= 1 && frei; dy++) for (let dx = -1; dx <= 1; dx++) if (roh.rows[y + dy][x + dx] !== ':') { frei = false; break; }
    if (frei && !roh.anker.some((a) => Math.abs(a.x - x) <= 3 && Math.abs(a.y - y) <= 3)) kand.push([x, y]);
  }
  if (!kand.length) return null;
  const E = kand[(seed >>> 0) % kand.length];
  hoehe = hoehe || Math.round(S * 0.75);
  const deck = H.deckRoh(seed, { w: Wd, hoehe, eingangX: E[0], fundorte: 3 });
  const U = deck.anker.find((a) => a.rolle === 'leiter');
  // K-DECK nimmt jedes Deck als `stride` Zeilen hoch: ist das Deck höher als die Oberfläche, wird die Oberfläche mit Lückenzeilen `_` aufgefüllt (stride = max)
  const stride = Math.max(S, hoehe);
  roh.rows = roh.rows.concat(Array(stride - S).fill('_'.repeat(Wd)), deck.rows); roh.h = roh.rows.length;
  for (const a of deck.anker) roh.anker.push(Object.assign({}, a, { y: a.y + stride }));
  roh.anker.push({ id: 'gelaende.leiter', rolle: 'leiter', x: E[0], y: E[1], platz: 'gelaende', bereich: 'gelaende' });
  for (const [id, b] of Object.entries(deck.bereiche)) roh.bereiche[id] = Object.assign({}, b, { rects: b.rects.map((r) => [r[0], r[1] + stride, r[2], r[3]]) });
  roh.plaetze.hoehle = Object.assign({}, deck.plaetze.hoehle, { rect: deck.plaetze.hoehle.rect.map((v, i) => (i === 1 ? v + stride : v)) });
  roh.decks = { stride, links: [{ a: [E[0], E[1]], b: [U.x, U.y + stride], via: 'leiter' }] };
  roh.meta.boden2 = deck.meta.boden2;
  roh.meta.pflicht = Object.assign({}, roh.meta.pflicht);
  roh.bauversion += '+hoehle';
  return roh;
}
{
  let gebaut = 0, gesamt = 0, deckF = 0, erreichF = 0, andere = 0, ohneKand = 0;
  const zb = [];
  for (const gr of ['klein', 'mittel']) for (let i = 0; i < KOMBI; i++) {
    const biom = Gelaende.BIOME[i % 3], seed = seedVon(i);
    gesamt++;
    let roh;
    try { const t0 = ms(); roh = kombi(seed, gr, biom); zb.push(ms() - t0); } catch (e) { andere++; if (process.env.VERBOSE) console.log('  Wurf ' + e.message); continue; }
    if (!roh) { ohneKand++; continue; }
    const r = Buehne.ausRaster(roh, { spiel: true });
    gebaut++;
    for (const f of r.fehler) { if (f.code === 'K-DECK') deckF++; else if (f.code === 'K-ERREICHBAR') erreichF++; else andere++; if (process.env.VERBOSE) console.log('  ' + gr + ' ' + seed + ' ' + f.code + ' ' + f.msg); }
  }
  console.log(`  ${gebaut}/${gesamt} Kombinationen gebaut (Oberfläche ohne Leiter-Platz: ${ohneKand}), Bauzeit Median Deck+Leiter ${median(zb).toFixed(1)} ms`);
  ok(ohneKand === 0, `Kombination: für jede Oberfläche ein Leiter-Platz (${ohneKand} ohne)`);
  ok(deckF === 0, `Prüfer K-DECK grün (${gebaut} Kombinationen klein/mittel, ${deckF} Verstöße)`);
  ok(erreichF === 0, `Prüfer K-ERREICHBAR grün (Funde und Leiter-Enden beider Decks von der Ankunft, ${erreichF} Verstöße)`);
  ok(andere === 0, `Prüfer sonst ohne Fehler und kein Wurf (${andere})`);
  // Deck höher als die Oberfläche: nur mit stride = Deckhöhe und Lückenzeilen (Befund für Paket C)
  let hoch = 0, hochGesamt = 0;
  for (const [gr, hh] of [['klein', 60], ['klein', 90], ['mittel', 70]]) for (let i = 0; i < 5; i++) {
    const roh = kombi(seedVon(i + 40), gr, Gelaende.BIOME[i % 3], hh); hochGesamt++;
    if (roh && Buehne.ausRaster(roh, { spiel: true }).fehler.length === 0) hoch++;
  }
  ok(hoch === hochGesamt, `Deck höher als die Oberfläche (stride = Deckhöhe, Lückenzeilen): Prüfer grün (${hoch}/${hochGesamt})`);
  // Gegenprobe: ohne die Randzeilen als Fels meldet der Prüfer K-DECK, also wacht die Regel wirklich
  const roh = kombi(seedVon(0), 'klein', 'wueste');
  const S = roh.decks.stride, zeilen = roh.rows.slice();
  zeilen[S] = zeilen[S].slice(0, 10) + ',' + zeilen[S].slice(11);
  const neg = Buehne.ausRaster(Object.assign({}, roh, { rows: zeilen }), { spiel: true });
  ok(neg.fehler.some((f) => f.code === 'K-DECK'), 'Gegenprobe: Boden in der Grenzzeile löst K-DECK aus');
}

console.log(`${n - bad}/${n} Prüfungen ok` + (bad ? `, ${bad} FEHLER` : ''));
process.exit(bad ? 1 : 0);
