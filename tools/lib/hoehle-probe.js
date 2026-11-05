'use strict';
// GEL-02 Paket 0: Probekarten fuer die Hoehle (nur Speicher, KEIN Produktgenerator; der echte Hoehlenerzeuger kommt in Paket B).
// Eigene Zufallsstroeme aus dem Seed, die Oberflaeche bleibt unberuehrt.
//   kombi(roh, seed, { boden2, hf, via })   Wildnis-Roh + zweites Deck (Zellularautomat) gleicher Breite, Stride = Oberflaechenhoehe, Leiter-Link
//   nurHoehle(roh, seed, { boden2 })        ein Deck, art 'hoehle', Boden ',' / Rand F, Anker auf Hoehlenboden
const N4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];
function rngVon(seed) {
  let a = seed >>> 0;
  const f = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { f, int: (n) => Math.floor(f() * n), shuffle: (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; } };
}
// Zellularautomat (4-5-Regel), Rand F, Ergebnis zusammenhaengend (kleine Regionen zu F, groessere per Gang verbunden)
function hoehleRaster(W, H, seed, boden) {
  const R = rngVon((seed ^ 0xC0FFEE) >>> 0);
  let g = []; for (let y = 0; y < H; y++) { g.push([]); for (let x = 0; x < W; x++) g[y].push(x === 0 || y === 0 || x === W - 1 || y === H - 1 ? 'F' : (R.f() < 0.5 ? 'F' : boden)); }
  const wand = (g, x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 1 : g[y][x] === 'F' ? 1 : 0);
  for (let it = 0; it < 5; it++) {
    const n = g.map((r) => r.slice());
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      let c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) c += wand(g, x + dx, y + dy);
      n[y][x] = (c >= 5 || (g[y][x] === 'F' && c >= 4)) ? 'F' : boden;
    }
    g = n;
  }
  const reg = new Int32Array(W * H).fill(-1), liste = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (g[y][x] !== 'F' && reg[y * W + x] < 0) {
    const id = liste.length, q = [[x, y]]; reg[y * W + x] = id; const zellen = [];
    for (let h = 0; h < q.length; h++) { const [cx, cy] = q[h]; zellen.push([cx, cy]); for (const [dx, dy] of N4) { const nx = cx + dx, ny = cy + dy; if (nx > 0 && ny > 0 && nx < W - 1 && ny < H - 1 && g[ny][nx] !== 'F' && reg[ny * W + nx] < 0) { reg[ny * W + nx] = id; q.push([nx, ny]); } } }
    liste.push(zellen);
  }
  if (!liste.length) return null;
  liste.sort((a, b) => b.length - a.length);
  const haupt = liste[0];
  for (const z of liste.slice(1)) {
    if (z.length < 20) { for (const [x, y] of z) g[y][x] = 'F'; continue; }
    let best = null;
    const hs = haupt.length > 400 ? haupt.filter((_, i) => i % 3 === 0) : haupt;
    for (const [x, y] of z.filter((_, i) => i % 2 === 0)) for (const [hx, hy] of hs) { const d = Math.abs(x - hx) + Math.abs(y - hy); if (!best || d < best.d) best = { d, x, y, hx, hy }; }
    let { x, y } = best; const { hx, hy } = best;
    const carve = (cx, cy) => { for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) { const nx = cx + dx, ny = cy + dy; if (nx > 0 && ny > 0 && nx < W - 1 && ny < H - 1) g[ny][nx] = boden; } };
    while (x !== hx) { carve(x, y); x += Math.sign(hx - x); }
    while (y !== hy) { carve(x, y); y += Math.sign(hy - y); }
    carve(x, y);
  }
  const start = haupt[0], seen = new Uint8Array(W * H), q = [start[1] * W + start[0]]; seen[q[0]] = 1;
  for (let h = 0; h < q.length; h++) { const u = q[h], ux = u % W, uy = (u - ux) / W; for (const [dx, dy] of N4) { const nx = ux + dx, ny = uy + dy; if (nx > 0 && ny > 0 && nx < W - 1 && ny < H - 1 && g[ny][nx] !== 'F' && !seen[ny * W + nx]) { seen[ny * W + nx] = 1; q.push(ny * W + nx); } } }
  let n = 0; for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (g[y][x] !== 'F') { if (!seen[y * W + x]) g[y][x] = 'F'; else n++; }
  return { g, begehbar: n };
}
function bodenKacheln(g, W, H) {
  const frei3 = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (g[y + dy][x + dx] === 'F') return false; return true; };
  const out = []; for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) if (g[y][x] !== 'F' && frei3(x, y)) out.push([x, y]);
  return out;
}
function raster(W, H, seed, boden) {
  for (let v = 0; v < 12; v++) { const r = hoehleRaster(W, H, seed * 31 + v, boden); if (r && r.begehbar > 0.22 * (W - 2) * (H - 2)) return r; }
  throw new Error('keine Hoehle');
}
function kombi(roh, seed, o) {
  o = o || {};
  const W = roh.w, Hs = roh.h, Hd = Math.max(14, Math.round(Hs * (o.hf == null ? 0.75 : o.hf))), stride = Hs;
  const g = raster(W, Hd, seed, ',').g;
  const A = roh.anker.find((a) => a.ankunft), sg = roh.rows.map((r) => r.split(''));
  const dS = (() => { const d = new Int32Array(W * Hs).fill(-1), q = [A.y * W + A.x]; d[q[0]] = 0; for (let h = 0; h < q.length; h++) { const u = q[h], ux = u % W, uy = (u - ux) / W; for (const [dx, dy] of N4) { const nx = ux + dx, ny = uy + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < Hs && d[ny * W + nx] < 0 && (sg[ny][nx] === ':' || sg[ny][nx] === 's')) { d[ny * W + nx] = d[u] + 1; q.push(ny * W + nx); } } } return d; })();
  let max = 0; for (const v of dS) if (v > max) max = v;
  const nahAnker = (x, y, r) => roh.anker.some((a) => Math.abs(a.x - x) <= r && Math.abs(a.y - y) <= r);
  const kand = [];
  for (let y = 3; y < Hs - 4; y++) for (let x = 3; x < W - 3; x++) {
    const d = dS[y * W + x]; if (d < max * 0.4 || d > max * 0.8) continue;
    let ok = true; for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if (sg[y + dy][x + dx] !== ':') { ok = false; break; }
    if (ok && !nahAnker(x, y, 3)) kand.push([x, y]);
  }
  if (!kand.length) throw new Error('kein Oberflaechen-Eingang');
  const RR = rngVon(seed * 7 + 1), E = kand[RR.int(kand.length)];
  const boeden = RR.shuffle(bodenKacheln(g, W, Hd)), U = boeden[0];
  const Y = (y) => y + stride;
  const funde = boeden.filter((p) => Math.hypot(p[0] - U[0], p[1] - U[1]) > 8).slice(0, 3);
  const rolle = o.via === 'lift' ? 'lift' : 'leiter';
  roh.anker.push({ id: 'gelaende.leiter', rolle, x: E[0], y: E[1], platz: 'gelaende', bereich: 'gelaende' },
    { id: 'hoehle.leiter', rolle, x: U[0], y: Y(U[1]), platz: 'hoehle', bereich: 'hoehle' });
  funde.forEach((p, i) => roh.anker.push({ id: 'hoehle.fund.' + (i + 1), rolle: 'fund', x: p[0], y: Y(p[1]), platz: 'hoehle', bereich: 'hoehle' }));
  roh.bereiche.hoehle = { name: 'Hoehle', rects: [[1, Y(1), W - 2, Hd - 2]] };
  roh.rows = roh.rows.concat(g.map((r) => r.join(''))); roh.h = roh.rows.length;
  roh.decks = { stride, links: [{ a: [E[0], E[1]], b: [U[0], Y(U[1])], via: o.via || 'leiter' }] };
  roh.erzeuger = 'probe'; roh.bauversion += '+hoehle';
  if (o.boden2) roh.meta.boden2 = o.boden2;
  roh._probe = { E, U, Hd, stride, W, Hs };
  return roh;
}
// Ein Deck, art 'hoehle': Raster der Wildnis-Groesse durch die Hoehle ersetzt, Anker (Abholpunkt, Funde) auf Hoehlenboden
function nurHoehle(roh, seed, o) {
  o = o || {};
  const W = roh.w, H = roh.h, g = raster(W, H, seed, ',').g;
  const boeden = rngVon(seed * 5 + 3).shuffle(bodenKacheln(g, W, H));
  const behalten = roh.anker.filter((a) => a.rolle === 'abholpunkt' || a.rolle === 'fund');
  behalten.forEach((a, i) => { const p = boeden[i * 9 % boeden.length]; a.x = p[0]; a.y = p[1]; });
  roh.anker = behalten;
  roh.rows = g.map((r) => r.join(''));
  roh.bereiche = { gelaende: { name: 'Hoehle', rects: [[1, 1, W - 2, H - 2]] } };
  roh.plaetze = { gelaende: Object.assign({}, roh.plaetze.gelaende, { rect: [1, 1, W - 2, H - 2] }) };
  roh.meta.pflicht = { abholpunkt: 1, fund: 2 };
  roh.art = 'hoehle';
  if (o.boden2) roh.meta.boden2 = o.boden2;
  roh.erzeuger = 'probe'; roh.bauversion += '+nurhoehle';
  return roh;
}
module.exports = { kombi, nurHoehle, hoehleRaster, rngVon };
