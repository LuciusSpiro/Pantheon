'use strict';
// PROTOTYP, nicht ans Spiel angebunden (Gespräch mit Kai, 2026-10-10): prozedurale Siedlungsgrammatik.
//   node tools/proto-siedlung.js --haeuser 14 --seed 1 --bauweise rom --typ handel
//   node tools/proto-siedlung.js --haeuser 18 --seed 4 --bauweise germanen --typ militaer
//   node tools/proto-siedlung.js --sweep 40
// Reihenfolge: Rahmen (Tor, Landefeld, Mauer nur beim Militärlager) -> Straßennetz (Rom: Raster, Germanen: Hauptachse mit
// Abzweigen) -> Parzellen entlang der Straßen -> Gebäude (Funktionsgebäude betretbar, Rest Kulisse) -> Leitstücke, Deckung.
const args = process.argv.slice(2);
const val = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FW = +val('--w', 130), FH = +val('--h', 90);

function rng(seed) {
  let a = seed >>> 0;
  const f = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { f, int: (n) => Math.floor(f() * n), range: (lo, hi) => lo + Math.floor(f() * (hi - lo + 1)), shuffle: (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; } };
}
const cheb = (a, b) => Math.max(b.x0 - a.x1, a.x0 - b.x1, b.y0 - a.y1, a.y0 - b.y1);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function bauenEinmal(seed, N, bauweise, typ, skala) {
  const R = rng(seed);
  const mauer = typ === 'militaer';
  const A = (N * 170 + 500) * skala;
  const sw = clamp(Math.round(Math.sqrt(A * 1.8)), 50, FW - 8), sh = clamp(Math.round(sw / 1.8), 34, FH - 8);
  const S = { x0: Math.floor((FW - sw) / 2), y0: Math.floor((FH - sh) / 2) };
  S.x1 = S.x0 + sw - 1; S.y1 = S.y0 + sh - 1;
  const m = mauer ? 2 : 1;
  const I = { x0: S.x0 + m, y0: S.y0 + m, x1: S.x1 - m, y1: S.y1 - m };
  const cy = Math.floor((I.y0 + I.y1) / 2);
  const grid = Array.from({ length: FH }, () => Array(FW).fill(':'));
  const fill = (r, c) => { for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (grid[y] && grid[y][x] !== undefined) grid[y][x] = c; };
  const hindernis = [];   // alles, was Gebäude meiden
  const LF = { x0: I.x1 - 14, x1: I.x1, y0: cy - 5, y1: cy + 4 };
  const Smax = LF.x0 - 2;
  hindernis.push({ rect: LF, art: 'landefeld' });
  const strassen = [];
  const strasse = (r, name) => { strassen.push({ rect: r, name }); hindernis.push({ rect: r, art: 'strasse' }); };
  const hs = { x0: I.x0, x1: LF.x0 - 1, y0: cy - 3, y1: cy + 2 };
  strasse(hs, 'haupt');
  // Platz
  const cx = I.x0 + Math.floor((Smax - I.x0) * (bauweise === 'rom' ? 0.5 : 0.45));
  const platz = bauweise === 'rom' ? { x0: cx - 8, x1: cx + 7, y0: cy - 6, y1: cy + 5 } : { x0: cx - 7, x1: cx + 6, y0: cy - 6, y1: cy + 5 };
  hindernis.push({ rect: platz, art: 'platz' });
  if (bauweise === 'rom') {
    strasse({ x0: cx - 2, x1: cx + 2, y0: I.y0, y1: I.y1 }, 'cardo');
    for (const sgn of [-1, 1]) { const yy = cy + sgn * 21; if (yy - 2 >= I.y0 + 3 && yy + 2 <= I.y1 - 3) strasse({ x0: I.x0, x1: Smax, y0: yy - 2, y1: yy + 1 }, 'quer'); }
    for (const sgn of [-1, 1]) { const xx = cx + sgn * 22; if (xx - 2 >= I.x0 + 6 && xx + 2 <= Smax - 4) strasse({ x0: xx - 2, x1: xx + 1, y0: I.y0, y1: I.y1 }, 'quer'); }
  } else {
    const k = clamp(Math.round(N / 3), 3, 8);
    const pos = [];
    for (let t = 0; t < 60 && pos.length < k; t++) {
      const x = R.range(I.x0 + 8, Smax - 6);
      if (Math.abs(x - cx) < 12 || pos.some((p) => Math.abs(p - x) < 13)) continue;
      pos.push(x);
    }
    for (const x of pos) for (const up of [true, false]) {
      if (R.f() < 0.25) continue;
      const len = R.range(12, 26);
      const r = up ? { x0: x, x1: x + 3, y1: hs.y0 - 1, y0: Math.max(I.y0, hs.y0 - len) } : { x0: x, x1: x + 3, y0: hs.y1 + 1, y1: Math.min(I.y1, hs.y1 + len) };
      if (r.y1 - r.y0 >= 8) strasse(r, 'abzweig');
    }
  }
  // Leitstücke am Platzrand (Generator 3×3, Antenne 2×2)
  const leit = [];
  const ecken = R.shuffle([[platz.x0 - 5, platz.y0 - 2], [platz.x1 + 3, platz.y0 - 2], [platz.x0 - 5, platz.y1 + 0], [platz.x1 + 3, platz.y1 + 0]]);
  const frei = (r, ausser) => r.x0 >= I.x0 && r.y0 >= I.y0 && r.x1 <= Smax && r.y1 <= I.y1 && hindernis.every((h) => h === ausser || cheb(r, h.rect) >= 2);
  const setzLeit = (c, w, h, art) => { for (const [ex, ey] of ecken) { const r = { x0: ex, y0: ey, x1: ex + w - 1, y1: ey + h - 1 }; if (frei(r)) { hindernis.push({ rect: r, art }); leit.push({ rect: r, c }); ecken.splice(ecken.findIndex((e) => e[0] === ex && e[1] === ey), 1); return; } } };
  setzLeit('Y', 3, 3, 'leit'); setzLeit('A', 2, 2, 'leit');
  // Parzellen: Cursor an allen Straßen- und Platzseiten
  const seiten = [];
  const lang = (r) => (r.x1 - r.x0) > (r.y1 - r.y0);
  for (const s of strassen) { if (lang(s.rect)) { seiten.push({ r: s.rect, side: 'n' }, { r: s.rect, side: 's' }); } else { seiten.push({ r: s.rect, side: 'w' }, { r: s.rect, side: 'e' }); } }
  for (const side of ['n', 's', 'w', 'e']) seiten.push({ r: platz, side, platz: true });
  for (const c of seiten) { const hz = c.side === 'n' || c.side === 's'; c.pos = (hz ? c.r.x0 : c.r.y0) + (c.platz ? 0 : R.range(1, 6)); c.end = hz ? c.r.x1 : c.r.y1; c.aktiv = true; }
  const gebaeude = [];
  const spannen = new Map(strassen.map((q) => [q.rect, []]));
  const gRect = (c, w, d) => {
    const r = c.r;
    if (c.side === 'n') return { x0: c.pos, x1: c.pos + w - 1, y1: r.y0 - 2, y0: r.y0 - 1 - d };
    if (c.side === 's') return { x0: c.pos, x1: c.pos + w - 1, y0: r.y1 + 2, y1: r.y1 + 1 + d };
    if (c.side === 'w') return { y0: c.pos, y1: c.pos + w - 1, x1: r.x0 - 2, x0: r.x0 - 1 - d };
    return { y0: c.pos, y1: c.pos + w - 1, x0: r.x1 + 2, x1: r.x1 + 1 + d };
  };
  let guard = 0;
  while (gebaeude.length < N && guard++ < 4000) {
    const akt = seiten.filter((c) => c.aktiv);
    if (!akt.length) break;
    // vom Platz nach außen wachsen: nächster freier Frontabschnitt zuerst (mit etwas Zufall)
    const pmx = (platz.x0 + platz.x1) / 2, pmy = (platz.y0 + platz.y1) / 2;
    const nah = (c) => { const hz = c.side === 'n' || c.side === 's'; const px = hz ? c.pos : (c.r.x0 + c.r.x1) / 2, py = hz ? (c.r.y0 + c.r.y1) / 2 : c.pos; return Math.abs(px - pmx) + Math.abs(py - pmy) + R.range(0, 8); };
    const c = akt.map((q) => ({ q, d: nah(q) })).sort((a, b) => a.d - b.d)[0].q;
    let ok = false;
    for (let v = 0; v < 3 && !ok; v++) {
      const w = R.range(v ? 6 : 7, v ? 9 : 13), d = R.range(v ? 6 : 6, v ? 8 : 9);
      const r = gRect(c, w, d);
      const hz = c.side === 'n' || c.side === 's';
      if ((hz ? r.x1 : r.y1) > c.end + 2) { c.aktiv = false; break; }
      if (process.env.PD) { const k = r.x0 < I.x0 || r.y0 < I.y0 || r.x1 > Smax || r.y1 > I.y1 ? 'raus' : hindernis.some((h) => cheb(r, h.rect) < 2) ? 'hindernis:' + hindernis.filter((h) => cheb(r, h.rect) < 2).map((h) => h.art).join('+') : gebaeude.some((g) => cheb(r, g.rect) < 2) ? 'gebaeude' : 'ok'; global.__z = global.__z || {}; global.__z[k] = (global.__z[k] || 0) + 1; }
      if (frei(r) && gebaeude.every((g) => cheb(r, g.rect) >= 2)) {
        gebaeude.push({ rect: r, side: c.side, w, d, typ: 'k' });
        if (spannen.has(c.r)) spannen.get(c.r).push(hz ? [r.x0, r.x1] : [r.y0, r.y1]);
        c.pos = (hz ? r.x1 : r.y1) + R.range(2, 4); ok = true;
      }
    }
    if (!ok && c.aktiv) { c.pos += 3; if (c.pos > c.end) c.aktiv = false; }
    if (gebaeude.length >= N) break;
  }
  // Zweite Reihe: Hinterhäuser mit 2 breiter Gasse zur nächsten Straße oder zum Platz
  const gassen = [];
  const quellen = strassen.map((q) => q.rect).concat([platz]);
  const Z = {};
  const nein = (k) => { Z[k] = (Z[k] || 0) + 1; };
  for (let t = 0; t < 3000 && gebaeude.length < N; t++) {
    const w = R.range(6, 10), d = R.range(6, 9);
    const x0 = R.range(I.x0, Math.max(I.x0, Smax - w)), y0 = R.range(I.y0, Math.max(I.y0, I.y1 - d));
    const r = { x0, y0, x1: x0 + w - 1, y1: y0 + d - 1 };
    if (!frei(r) || !gebaeude.every((g) => cheb(r, g.rect) >= 2) || !gassen.every((g) => cheb(r, g) >= 1)) { nein('platz'); continue; }
    let best = null;
    for (const q of quellen) { const dd = cheb(r, q); if (!best || dd < best.dd) best = { q, dd }; }
    if (best.dd > 14) { nein('weit'); continue; }
    const q = best.q, mx = Math.floor((r.x0 + r.x1) / 2), my = Math.floor((r.y0 + r.y1) / 2);
    const dx = Math.max(q.x0 - r.x1, r.x0 - q.x1), dy = Math.max(q.y0 - r.y1, r.y0 - q.y1);
    let side, gasse, span;
    if (dy >= dx) {
      if (q.x0 > mx || q.x1 < mx + 1) { nein('v-seite'); continue; }
      if (q.y1 < r.y0) { side = 's'; gasse = { x0: mx, x1: mx + 1, y0: q.y1 + 1, y1: r.y0 - 1 }; }
      else if (q.y0 > r.y1) { side = 'n'; gasse = { x0: mx, x1: mx + 1, y0: r.y1 + 1, y1: q.y0 - 1 }; }
      else { nein('v-lage'); continue; }
      span = [gasse.x0, gasse.x1];
    } else {
      if (q.y0 > my || q.y1 < my + 1) { nein('h-seite'); continue; }
      if (q.x1 < r.x0) { side = 'e'; gasse = { x0: q.x1 + 1, x1: r.x0 - 1, y0: my, y1: my + 1 }; }
      else if (q.x0 > r.x1) { side = 'w'; gasse = { x0: r.x1 + 1, x1: q.x0 - 1, y0: my, y1: my + 1 }; }
      else { nein('h-lage'); continue; }
      span = [gasse.y0, gasse.y1];
    }
    if (gasse.x1 < gasse.x0 || gasse.y1 < gasse.y0) continue;
    if (gebaeude.some((g) => cheb(gasse, g.rect) < 1) || hindernis.some((h) => h.rect !== q && cheb(gasse, h.rect) < 1)) { nein('gasse-blockiert'); continue; }
    nein('OK');
    gebaeude.push({ rect: r, side, w, d, typ: 'k', hinterhaus: true });
    gassen.push(gasse); hindernis.push({ rect: gasse, art: 'gasse' });
    if (spannen.has(q)) spannen.get(q).push(span);
  }
  if (process.env.PD) console.error('zweite Reihe', JSON.stringify(Z));
  // Straßen kürzen: nur so weit, wie Häuser und Gassen daran hängen (+4), solange das Netz verbunden bleibt
  const verbunden = (rects) => { const seen = new Set([0]); const stk = [0]; while (stk.length) { const i = stk.pop(); rects.forEach((q, j) => { if (!seen.has(j) && cheb(rects[i], q) <= 1) { seen.add(j); stk.push(j); } }); } return seen.size === rects.length; };
  const netz = () => strassen.map((q) => q.rect).concat([platz, LF]);
  for (const st of strassen.slice()) {
    const sp = spannen.get(st.rect) || [];
    if (!sp.length) {
      if (st.name === 'haupt') continue;
      const i = strassen.indexOf(st); strassen.splice(i, 1);
      if (!verbunden(netz())) strassen.splice(i, 0, st); else { const hi = hindernis.findIndex((h) => h.rect === st.rect); if (hi >= 0) hindernis.splice(hi, 1); }
      continue;
    }
    const hz = lang(st.rect), lo = Math.min(...sp.map((v) => v[0])) - 4, hi = Math.max(...sp.map((v) => v[1])) + 4;
    const alt = { ...st.rect };
    if (hz) { st.rect.x0 = Math.max(st.rect.x0, lo); if (st.name !== 'haupt') st.rect.x1 = Math.min(st.rect.x1, hi); }
    else { st.rect.y0 = Math.max(st.rect.y0, lo); st.rect.y1 = Math.min(st.rect.y1, hi); }
    if (!verbunden(netz())) Object.assign(st.rect, alt);
  }
  // endgültige Fläche: Umriss aller Inhalte plus Rand (Mauer: 4, sonst 3)
  {
    const teile = strassen.map((q) => q.rect).concat([platz, LF], leit.map((l) => l.rect), gebaeude.map((g) => g.rect), gassen);
    const mg = mauer ? 4 : 3;
    S.x0 = Math.max(1, Math.min(...teile.map((q) => q.x0)) - mg); S.y0 = Math.max(1, Math.min(...teile.map((q) => q.y0)) - mg);
    S.x1 = Math.min(FW - 2, Math.max(...teile.map((q) => q.x1)) + mg); S.y1 = Math.min(FH - 2, Math.max(...teile.map((q) => q.y1)) + mg);
    fill(S, '.');
    for (const g of gassen) fill(g, '-');
  }
  // Funktionsgebäude: Kommando am Platz, Lager nahe Landefeld, Werkstatt, Quartiere
  const pm = { x: (platz.x0 + platz.x1) / 2, y: (platz.y0 + platz.y1) / 2 };
  const mitte = (g) => ({ x: (g.rect.x0 + g.rect.x1) / 2, y: (g.rect.y0 + g.rect.y1) / 2 });
  const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const F = Math.min(gebaeude.length, Math.max(3, Math.round(N * 0.35)));
  const frei2 = gebaeude.slice();
  const nimm = (cmp, typBuch) => { if (!frei2.length) return; frei2.sort(cmp); const g = frei2.shift(); g.typ = typBuch; };
  const lfm = { x: (LF.x0 + LF.x1) / 2, y: (LF.y0 + LF.y1) / 2 };
  nimm((a, b) => dist(mitte(a), pm) - dist(mitte(b), pm), 'K');
  nimm((a, b) => dist(mitte(a), lfm) - dist(mitte(b), lfm), 'L');
  const rest = R.shuffle(['W', 'Q', 'Q', 'C', 'H', 'L']);
  for (let i = 2; i < F; i++) nimm(() => R.f() - 0.5, rest[(i - 2) % rest.length]);
  // Zeichnen
  for (const s of strassen) fill(s.rect, '=');
  fill(platz, '+');
  fill({ x0: cx - 1, x1: cx + 1, y0: cy - 1, y1: cy + 1 }, 'm');
  for (const l of leit) fill(l.rect, l.c);
  fill(LF, ',');
  grid[cy][Math.floor((LF.x0 + LF.x1) / 2)] = 'P';
  for (const g of gebaeude) {
    const r = g.rect;
    fill(r, '#');
    if (g.typ !== 'k') fill({ x0: r.x0 + 1, y0: r.y0 + 1, x1: r.x1 - 1, y1: r.y1 - 1 }, g.typ);
    // Tür an der Straßenseite, 2 breit, Mitte
    const mx = Math.floor((r.x0 + r.x1) / 2), my = Math.floor((r.y0 + r.y1) / 2);
    const tur = g.side === 'n' ? [[mx, r.y1], [mx + 1, r.y1]] : g.side === 's' ? [[mx, r.y0], [mx + 1, r.y0]] : g.side === 'w' ? [[r.x1, my], [r.x1, my + 1]] : [[r.x0, my], [r.x0, my + 1]];
    g.tueren = tur;
    for (const [x, y] of tur) grid[y][x] = g.typ === 'k' ? 'x' : 'D';
  }
  // Mauer, Tor, Türme
  if (mauer) {
    for (let x = S.x0; x <= S.x1; x++) { grid[S.y0][x] = 'M'; grid[S.y1][x] = 'M'; grid[S.y0 + 1][x] = grid[S.y0 + 1][x] === '.' ? 'M' : grid[S.y0 + 1][x]; grid[S.y1 - 1][x] = grid[S.y1 - 1][x] === '.' ? 'M' : grid[S.y1 - 1][x]; }
    for (let y = S.y0; y <= S.y1; y++) { grid[y][S.x0] = 'M'; grid[y][S.x1] = 'M'; grid[y][S.x0 + 1] = 'M'; grid[y][S.x1 - 1] = 'M'; }
    for (let y = cy - 2; y <= cy + 1; y++) { grid[y][S.x0] = 'g'; grid[y][S.x0 + 1] = 'g'; }
    for (const [ex, ey] of [[S.x0, S.y0], [S.x1 - 2, S.y0], [S.x0, S.y1 - 2], [S.x1 - 2, S.y1 - 2]]) fill({ x0: ex, y0: ey, x1: ex + 2, y1: ey + 2 }, 'T');
  }
  // Deckung: weltliche Objekte, Platz-Ring, Straßenränder (selten), Landefeld
  const setze = (x, y, w) => { for (let i = 0; i < w; i++) if (grid[y] && (grid[y][x + i] === '=' || grid[y][x + i] === '+' || grid[y][x + i] === ',')) grid[y][x + i] = 'o'; };
  for (const [dx, dy] of [[-6, -4], [4, -4], [-6, 3], [4, 3], [-1, -5], [-1, 4]]) setze(cx + dx, cy + dy, 2);
  let deck = 0;
  for (const s of strassen) {
    const r = s.rect, hz = lang(r);
    for (let p = (hz ? r.x0 : r.y0) + 8; p < (hz ? r.x1 : r.y1) - 8; p += R.range(9, 15)) {
      if (R.f() < 0.55) continue;
      const nahPlatz = hz ? (p > platz.x0 - 4 && p < platz.x1 + 4) : (p > platz.y0 - 4 && p < platz.y1 + 4);
      if (nahPlatz) continue;
      if (hz) setze(p, R.f() < 0.5 ? r.y0 : r.y1, 2); else setze(R.f() < 0.5 ? r.x0 : r.x1, p, 1);
      deck++;
    }
  }
  setze(LF.x0 + 1, LF.y0, 2); setze(LF.x1 - 2, LF.y1, 2);
  if (process.env.PD) console.error(JSON.stringify(global.__z), 'Cursor aktiv', seiten.filter((c) => c.aktiv).length, '/', seiten.length);
  return { skala, grid, S, I, cy, gebaeude, strassen, platz, LF, mauer, N, deck, R, bauweise, typ, sw: S.x1 - S.x0 + 1, sh: S.y1 - S.y0 + 1, start: [hs.x0, cy] };
}

// wächst, bis die Zielzahl an Gebäuden steht (oder das Feld voll ist)
function bauen(seed, N, bauweise, typ) {
  let best = null;
  for (let skala = 0.8; skala <= 3.6; skala *= 1.06) {
    let B; try { B = bauenEinmal(seed, N, bauweise, typ, skala); } catch (e) { break; }
    if (!best || B.gebaeude.length > best.gebaeude.length) best = B;
    if (B.gebaeude.length >= N) return B;
    if (B.sw >= FW - 8 && B.sh >= FH - 8) break;
  }
  return best;
}

function kennzahlen(B) {
  const { grid, S, gebaeude } = B;
  const passier = (c) => '.=+g,PDKLWQCH-'.includes(c);
  // Erreichbarkeit vom Tor (Militär) bzw. westlichem Straßenanfang (Handel)
  const start = B.mauer ? [S.x0, B.cy] : B.start;
  const seen = new Set(); const st = [start];
  const key = (x, y) => y * FW + x;
  while (st.length) {
    const [x, y] = st.pop(); if (x < 0 || y < 0 || x >= FW || y >= FH) continue;
    const k = key(x, y); if (seen.has(k)) continue;
    const c = grid[y][x]; if (!(passier(c) || c === ':' && false)) continue;
    if (c !== 'g' && B.mauer && (x < S.x0 || x > S.x1 || y < S.y0 || y > S.y1)) continue;
    seen.add(k);
    st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  const funktion = gebaeude.filter((g) => g.typ !== 'k');
  const erreichbar = funktion.filter((g) => g.tueren.some(([x, y]) => seen.has(key(x, y))) || g.tueren.some(([x, y]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has(key(x + dx, y + dy))))).length;
  let sicht = 0;
  const offen = (c) => c === '=' || c === '+' || c === '.' || c === ',';
  for (let y = S.y0; y <= S.y1; y++) { let run = 0; for (let x = S.x0; x <= S.x1; x++) { run = (grid[y][x] === '=' || grid[y][x] === '+') ? run + 1 : 0; sicht = Math.max(sicht, run); } }
  for (let x = S.x0; x <= S.x1; x++) { let run = 0; for (let y = S.y0; y <= S.y1; y++) { run = (grid[y][x] === '=' || grid[y][x] === '+') ? run + 1 : 0; sicht = Math.max(sicht, run); } }
  let strasse = 0, platz = 0, bebaut = 0, flaeche = 0;
  for (let y = S.y0; y <= S.y1; y++) for (let x = S.x0; x <= S.x1; x++) { flaeche++; const c = grid[y][x]; if (c === '=') strasse++; else if (c === '+') platz++; else if ('#xDKLWQCHYAm'.includes(c)) bebaut++; }
  return { haeuser: gebaeude.length, ziel: B.N, funktion: funktion.length, erreichbar, sicht, flaeche: B.sw * B.sh, breite: B.sw, hoehe: B.sh,
    anteilStrasse: strasse / flaeche, anteilPlatz: platz / flaeche, anteilBebaut: bebaut / flaeche, deckungStrasse: B.deck };
}

function ausgeben(seed, N, bw, typ) {
  const B = bauen(seed, N, bw, typ), K = kennzahlen(B), S = B.S;
  const z = [];
  for (let y = Math.max(0, S.y0 - 2); y <= Math.min(FH - 1, S.y1 + 2); y++) z.push(B.grid[y].slice(Math.max(0, S.x0 - 3), S.x1 + 4).join(''));
  console.log(`Seed ${seed} · ${bw} · ${typ} · Ziel ${N} Gebäude: gebaut ${K.haeuser} (davon betretbar ${K.funktion}, erreichbar ${K.erreichbar}) · Fläche ${K.breite}×${K.hoehe}`);
  console.log(`  Straße ${(K.anteilStrasse * 100).toFixed(0)} % · Platz ${(K.anteilPlatz * 100).toFixed(0)} % · bebaut ${(K.anteilBebaut * 100).toFixed(0)} % · längste freie Bahn ${K.sicht} · Deckung an Straßen ${K.deckungStrasse}`);
  console.log(z.join('\n'));
  console.log();
}

if (args.includes('--sweep')) {
  const n = +val('--sweep', 40);
  console.log('Typ/Volk | Ziel | gebaut Ø | betretbar erreichbar | Fläche Ø | Straße % | bebaut % | längste Bahn Ø (max)');
  for (const [bw, typ] of [['rom', 'handel'], ['rom', 'militaer'], ['germanen', 'handel'], ['germanen', 'militaer']]) for (const N of [8, 14, 20]) {
    let g = 0, fe = 0, ff = 0, fl = 0, sp = 0, bb = 0, sb = 0, sm = 0;
    for (let s = 1; s <= n; s++) { const K = kennzahlen(bauen(s, N, bw, typ)); g += K.haeuser; fe += K.erreichbar; ff += K.funktion; fl += K.flaeche; sp += K.anteilStrasse; bb += K.anteilBebaut; sb += K.sicht; sm = Math.max(sm, K.sicht); }
    console.log(`${bw}/${typ} | ${N} | ${(g / n).toFixed(1)} | ${fe}/${ff} | ${Math.round(fl / n)} | ${(sp / n * 100).toFixed(0)} | ${(bb / n * 100).toFixed(0)} | ${(sb / n).toFixed(0)} (${sm})`);
  }
} else {
  ausgeben(+val('--seed', 1), +val('--haeuser', 14), val('--bauweise', 'rom'), val('--typ', 'handel'));
  console.log('Legende: = Straße · + Platz · . Boden · , Landefeld · P Abholpunkt · m Monument · Y Generator · A Antenne · # Gebäude/Kulisse · x Kulissentür · D Tür · K Kommando · L Lager · W Werkstatt · Q Quartiere · C Kantine · M Mauer · T Turm · g Tor · o Deckungsobjekt · : Gelände');
}
