// Kennungen auf den Raumkarten (Taktikkarte der Ops, Lagekarte des Captains): Volk = Form, Klasse = Größe, Kurs = Drehung, Farbe = Haltung
// (Aufrufer: rot feindlich, mint verbündet). Dazu der Schildring um jeden Gegner: vier Seiten Bug/Steuerbord/Heck/Backbord an ihrer echten Lage
// (dreht mit dem Schiff); Seiten mit mehreren Segmenten (shared/schilde.js: Fregatte, Kreuzer) werden der Länge nach in Teilbögen geteilt.
// Abgenommene Vorlage: Polygone und Regeln wie im Kennungsbogen (Kai, 2026-10). Globales window.Kennung; render.js zeichnet ohne dieses Modul
// wie bisher (Art-Sprite).
//
//   Kennung.zeichne(ctx, volk, klasse, x, y, winkel, farbe, massstab, opts?)   opts: { kante (Farbe der 1-px-Außenkante), kurs (false = ohne Kursstrich) }
//   Kennung.schildRing(ctx, x, y, radius, winkel, werteJeSegment, aufbau?, opts?)
//       werteJeSegment: flach wie e.shields (Bug, Steuerbord vorn->hinten, Heck, Backbord vorn->hinten); aufbau: Shared_Schilde.layout(...) –
//       fehlt er, gelten die Werte als [Bug, Steuerbord, Heck, Backbord]. opts: { einfach (je Seite nur ein Bogen mit dem schwächsten Wert),
//       dick (Grundstärke 1), alpha }
//       Werte: 0 = offen (rot gepunktet), angeschlagen = schwach (mint gedimmt), voll (Maximum des Segments) = stark (mint, dicker)
//   Kennung.radius(volk, klasse, massstab) -> Außenradius der Form in Pixeln (für Ring, Klickfläche, Beschriftung)
//   Kennung.hat(volk, klasse) -> true, wenn es für Volk und Klasse eine Form gibt
(function (root) {
  'use strict';
  // Polygone in Pixeln, Bug zeigt nach +x
  const KENNUNG = {
    ger: {   // Drachenboot: spitzer Bug, gegabeltes Heck, schlank
      raider: [[4, 0], [0, -2], [-4, -3], [-2, 0], [-4, 3], [0, 2]],
      korvette: [[6, 0], [3, -2], [-3, -3], [-6, -2], [-4, 0], [-6, 2], [-3, 3], [3, 2]],
      fregatte: [[8, 0], [5, -2], [2, -4], [-2, -4], [-5, -3], [-8, -2], [-6, 0], [-8, 2], [-5, 3], [-2, 4], [2, 4], [5, 2]],
      kreuzer: [[10, 0], [8, -1], [7, -3], [3, -5], [-4, -5], [-8, -3], [-10, -3], [-8, 0], [-10, 3], [-8, 3], [-4, 5], [3, 5], [7, 3], [8, 1]],
      frachter: [[6, 0], [4, -4], [-4, -4], [-7, -2], [-7, 2], [-4, 4], [4, 4]],
    },
    rom: {   // Galeere: Rammsporn vorn, gerades Heck, Ausleger an den Seiten
      raider: [[4, 0], [2, -1], [1, -3], [-3, -3], [-3, 3], [1, 3], [2, 1]],
      korvette: [[6, 0], [4, -1], [3, -2], [1, -2], [1, -4], [-3, -4], [-3, -2], [-6, -2], [-6, 2], [-3, 2], [-3, 4], [1, 4], [1, 2], [3, 2], [4, 1]],
      fregatte: [[8, 0], [6, -1], [5, -3], [2, -3], [2, -5], [-4, -5], [-4, -3], [-8, -3], [-8, 3], [-4, 3], [-4, 5], [2, 5], [2, 3], [5, 3], [6, 1]],
      kreuzer: [[10, 0], [8, -1], [7, -4], [3, -4], [3, -6], [-5, -6], [-5, -4], [-10, -4], [-10, 4], [-5, 4], [-5, 6], [3, 6], [3, 4], [7, 4], [8, 1]],
      frachter: [[6, -1], [6, 1], [5, 4], [-7, 4], [-7, -4], [5, -4]],
    },
    pirat: {   // zusammengeflickt: schief, gezackt
      raider: [[4, 0], [-1, -3], [-2, -1], [-4, -2], [-3, 1], [-1, 3]],
      korvette: [[6, 1], [3, -2], [-1, -4], [-2, -2], [-6, -3], [-5, 0], [-6, 3], [-1, 3]],
      fregatte: [[8, 1], [4, -3], [0, -5], [-2, -3], [-8, -4], [-6, 0], [-8, 4], [-2, 4], [2, 3]],
      kreuzer: [[10, 1], [6, -3], [1, -6], [-2, -4], [-10, -5], [-8, 0], [-10, 5], [-3, 5], [3, 4]],
      frachter: [[6, 0], [3, -4], [-5, -4], [-7, 0], [-5, 4], [4, 3]],
    },
  };
  const MINT = '#7FE0C2', RED = '#E0473C', KANTE = '#0B0E1A';
  const SCHRITTE = 64;   // Kurs in 64 Stufen (5,6 Grad) gerastert – pixelscharf und zwischenspeicherbar
  const cache = new Map();
  const CACHE_MAX = 800;

  function poly(volk, klasse) { return ((KENNUNG[volk] || KENNUNG.ger)[klasse] || KENNUNG.ger.korvette); }
  function hat(volk, klasse) { return !!(KENNUNG[volk] && KENNUNG[volk][klasse]); }
  function radius(volk, klasse, s) { const P = poly(volk, klasse); let r = 0; for (const [x, y] of P) r = Math.max(r, Math.hypot(x, y)); return r * (s || 1); }
  function inPoly(px, py, P) {
    let inn = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inn = !inn;
    }
    return inn;
  }
  function rgba(hex, a) {
    const h = String(hex).replace('#', '');
    if (h.length !== 6) return hex;
    return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')';
  }
  function puffer(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  // Zwischenbild pixelscharf übertragen (der Spiel-Kontext kann skaliert sein; Glättung würde die Form verwischen)
  function setzen(ctx, b, x, y) {
    const glatt = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(b.c, Math.round(x) - b.h, Math.round(y) - b.h);
    ctx.imageSmoothingEnabled = glatt;
  }
  function merken(key, bild) { if (cache.size >= CACHE_MAX) cache.clear(); cache.set(key, bild); return bild; }
  const stufe = (ang) => { const k = Math.round((ang || 0) / (Math.PI * 2) * SCHRITTE); return ((k % SCHRITTE) + SCHRITTE) % SCHRITTE; };

  // Form pixelscharf gedreht rastern: Füllung in farbe, außen 1 px dunkle Kante, kurzer Kursstrich (zwei Punkte) vor dem Bug
  function bildKennung(volk, klasse, k, farbe, s, kante, kurs) {
    const key = 'k|' + volk + '|' + klasse + '|' + k + '|' + farbe + '|' + s + '|' + kante + '|' + (kurs ? 1 : 0);
    const alt = cache.get(key); if (alt) return alt;
    const P = poly(volk, klasse).map(([x, y]) => [x * s, y * s]);
    const ang = k / SCHRITTE * Math.PI * 2, co = Math.cos(ang), si = Math.sin(ang);
    let nose = 0; for (const p of P) nose = Math.max(nose, p[0]);
    const R = Math.ceil(radius(volk, klasse, s)) + 2, H = R + 7, N = H * 2 + 1;
    const m = new Uint8Array(N * N);
    const idx = (dx, dy) => (dy + H) * N + (dx + H);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (inPoly(dx * co + dy * si, -dx * si + dy * co, P)) m[idx(dx, dy)] = 1;
    const c = puffer(N, N); const g = c.getContext('2d');
    if (kante) {
      g.fillStyle = kante;
      for (let dy = -R - 1; dy <= R + 1; dy++) for (let dx = -R - 1; dx <= R + 1; dx++) {
        if (m[idx(dx, dy)]) continue;
        if (m[idx(dx + 1, dy)] || m[idx(dx - 1, dy)] || m[idx(dx, dy + 1)] || m[idx(dx, dy - 1)]) g.fillRect(dx + H, dy + H, 1, 1);
      }
    }
    g.fillStyle = farbe;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (m[idx(dx, dy)]) g.fillRect(dx + H, dy + H, 1, 1);
    if (kurs) { g.fillStyle = rgba(farbe, 0.7); for (const d of [3, 5]) g.fillRect(Math.round(H + co * (nose + d)), Math.round(H + si * (nose + d)), 1, 1); }
    return merken(key, { c, h: H });
  }
  function zeichne(ctx, volk, klasse, x, y, winkel, farbe, massstab, opts) {
    const o = opts || {};
    const s = Math.max(0.5, Math.min(3, +massstab || 1));
    const b = bildKennung(KENNUNG[volk] ? volk : 'ger', klasse, stufe(winkel), farbe || RED, s, o.kante === undefined ? KANTE : o.kante, o.kurs !== false);
    setzen(ctx, b, x, y);
  }

  // Winkelbereiche [lo, hi] (relativ zur Schiffsachse, Steuerbord positiv) und Wert je Bogen. Bug/Heck: Viertelkreis; Seiten: n Teilbögen an der
  // Längslage der Segmente (Grenzen wie die Trefferzuordnung, Shared_Schilde.winkelBei). einfach: je Seite ein Bogen mit dem schwächsten Wert.
  function boegen(werte, aufbau, einfach) {
    const SC = root.Shared_Schilde;
    const v = Array.isArray(werte) ? werte : [];
    const segs = aufbau && aufbau.segs && aufbau.n === v.length ? aufbau.segs : [0, 1, 2, 3].map((q) => ({ seite: q, i: 0, n: 1, von: 0, bis: 1 }));
    const Q = Math.PI / 4;
    const seitenBereich = (seite) => (seite === 0 ? [-Q, Q] : seite === 2 ? [3 * Q, 5 * Q] : seite === 1 ? [Q, 3 * Q] : [-3 * Q, -Q]);
    if (einfach) {
      const per = [null, null, null, null];
      segs.forEach((g, i) => { const w = +v[i] || 0; per[g.seite] = per[g.seite] == null ? w : Math.min(per[g.seite], w); });
      return per.map((w, seite) => (w == null ? null : { lo: seitenBereich(seite)[0], hi: seitenBereich(seite)[1], w, teil: false })).filter(Boolean);
    }
    return segs.map((g, i) => {
      const [a, b] = seitenBereich(g.seite);
      let lo = a, hi = b;
      if (g.n > 1) {
        if ((g.seite === 1 || g.seite === 3) && SC && SC.winkelBei) { const w0 = SC.winkelBei(g.seite, g.von), w1 = SC.winkelBei(g.seite, g.bis); lo = Math.min(w0, w1); hi = Math.max(w0, w1); }
        else if (g.seite === 3) { lo = b - (b - a) * g.bis; hi = b - (b - a) * g.von; }   // Backbord: vorn liegt bei -45 Grad
        else { lo = a + (b - a) * g.von; hi = a + (b - a) * g.bis; }
      }
      return { lo, hi, w: +v[i] || 0, m: (aufbau && aufbau.max && +aufbau.max[i]) || 4, teil: g.n > 1 };
    });
  }
  function bildRing(rad, k, werte, aufbau, einfach, dick) {
    const B = boegen(werte, aufbau, einfach);
    const key = 'r|' + rad + '|' + k + '|' + dick + '|' + (einfach ? 1 : 0) + '|' + B.map((b) => b.lo.toFixed(3) + ':' + b.hi.toFixed(3) + ':' + b.w + ':' + b.m).join(',');
    const alt = cache.get(key); if (alt) return alt;
    const ang = k / SCHRITTE * Math.PI * 2;
    const R2 = rad + 2 + dick, N = R2 * 2 + 1;
    const c = puffer(N, N); const g = c.getContext('2d');
    const GAP = 7 * Math.PI / 180, GAP_TEIL = 3.5 * Math.PI / 180;
    const schwach = rgba(MINT, 0.5);
    for (let dy = -R2; dy <= R2; dy++) for (let dx = -R2; dx <= R2; dx++) {
      const d = Math.hypot(dx, dy);
      if (d < rad - 0.5 || d > rad + 1.5 + dick) continue;
      let rel = Math.atan2(dy, dx) - ang; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      let hit = null;
      for (const b of B) {
        let r = rel;
        if (b.hi > Math.PI && r < 0) r += Math.PI * 2;   // Heck-Bereich über ±180 Grad
        const gl = b.teil ? GAP_TEIL : GAP, gh = b.teil ? GAP_TEIL : GAP;
        // Lücke an den Sektorgrenzen (45/135 Grad) breit, zwischen Teilbögen einer Seite schmal
        const loG = Math.abs(Math.abs(b.lo) - Math.PI / 4) < 1e-3 || Math.abs(Math.abs(b.lo) - 3 * Math.PI / 4) < 1e-3 ? GAP : gl;
        const hiG = Math.abs(Math.abs(b.hi) - Math.PI / 4) < 1e-3 || Math.abs(Math.abs(b.hi) - 3 * Math.PI / 4) < 1e-3 || Math.abs(b.hi - 5 * Math.PI / 4) < 1e-3 ? GAP : gh;
        if (r >= b.lo + loG && r <= b.hi - hiG) { hit = b; break; }
      }
      if (!hit) continue;
      const voll = hit.w >= hit.m;   // Kai 2026-10-15: stark = Segment voll (relativ zum Maximum der Klasse)
      const w = voll ? 1 + dick : dick;
      if (d > rad - 0.5 + w) continue;
      if (hit.w <= 0) { if ((dx + dy + 300) % 3) continue; g.fillStyle = RED; }
      else g.fillStyle = voll ? MINT : schwach;
      g.fillRect(dx + R2, dy + R2, 1, 1);
    }
    return merken(key, { c, h: R2 });
  }
  function schildRing(ctx, x, y, rad, winkel, werte, aufbau, opts) {
    const o = opts || {};
    const b = bildRing(Math.max(4, Math.round(rad)), stufe(winkel), werte, aufbau || null, !!o.einfach, o.dick || 1);
    if (o.alpha != null && o.alpha < 1) { const a = ctx.globalAlpha; ctx.globalAlpha = a * o.alpha; setzen(ctx, b, x, y); ctx.globalAlpha = a; }
    else setzen(ctx, b, x, y);
  }

  root.Kennung = { KENNUNG, zeichne, schildRing, radius, hat, FARBE: { feind: RED, verbuendet: MINT } };
})(typeof self !== 'undefined' ? self : this);
