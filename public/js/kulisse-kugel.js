// KUL-02 B: Kugel- und Sternzeichner der Himmelskulisse (Richtung A „Tiefe“ aus KUL-01). REINER ZEICHNER ohne Spielwissen: kennt weder drawSpace noch Snapshot noch den
// Zustand hauptschirmAnsicht. Der klassische Hauptschirm (KUL-02 C) und das Visier (KUL-03) rufen dieselben Funktionen auf.
//   KulisseKugel.planet(art, radiusPx, seed, lichtWinkel)  -> Canvas (zwischengespeichert, Weltorientierung); art: fels | eis | wueste | ozean | gasriese
//   KulisseKugel.zeichnePlanet(ctx, art, x, y, radiusPx, seed, lichtWinkel, rot, abdunkeln)   rot in Bogenmaß (der Cache bleibt ungedreht), abdunkeln 0..1
//   KulisseKugel.stern(ctx, x, y, radiusPx, klasse, t)     klasse: gelb | orange | weiss | rot
//   KulisseKugel.randLicht(ctx, rect, winkel, klasse)      Randglühen am Bildrand in Peilung winkel (Bogenmaß, Bildschirmraum: 0 = rechts, +π/2 = unten)
//   KulisseKugel.sternfeld(ctx, rect, rot, seed)           Fixsterne, drehen mit rot um die Rechteckmitte
//   KulisseKugel.statistik() -> { gebaut, treffer, dunkelGebaut, eintraege }   Zähler für Tests/Messwert;  .leeren() / .setzeGrenze(n)
// Lichtwinkel: Richtung, IN der der Stern steht (Weltorientierung, y nach unten, Bogenmaß, 0 = +x). Die Lichtseite der Kugel zeigt dorthin.
// Tokens (optional, Paket T): window.HauptschirmTokens.kugel = {
//   radiusStufe (px, Standard 4), cacheMax (24), lichtStufen (Winkelschritte je Vollkreis, 24), blockMin (2), blockMax (4), blockTeiler (30: Block = R/Teiler),
//   kantenDunkel (0.82), arten: { fels|eis|wueste|ozean|gasriese: { ramp:[#hex..], land:[#hex..] (nur ozean), atm:'#hex', atmA:0..1 } },
//   sterne: { gelb|orange|weiss|rot: { core:'#hex', glow:'#hex' } }, sternfeld: { anzahl (320), farben: [vier Farben hell..dunkel] }, randLicht: { tiefe (px, 70), alpha (0.5) } }
// Fehlende Schlüssel fallen auf DEFAULT zurück. Wirkung auf bereits gebaute Kugeln: nach Tokenwechsel leeren() aufrufen.
(function (root) {
  'use strict';

  const DEFAULT = {
    radiusStufe: 4, cacheMax: 24, lichtStufen: 24, blockMin: 2, blockMax: 4, blockTeiler: 30, kantenDunkel: 0.82,
    arten: {
      fels: { ramp: ['#1E1A17', '#3A302A', '#5A4A3E', '#7E6A56', '#A68E72'], atm: '#C9B79A', atmA: 0.25 },
      eis: { ramp: ['#141E2A', '#2C4258', '#557A96', '#8FB4CA', '#D8E8F2'], atm: '#A9D6E5', atmA: 0.5 },
      wueste: { ramp: ['#2A1A0E', '#5A3418', '#8E5428', '#C07C40', '#E8B272'], atm: '#F2C08A', atmA: 0.35 },
      ozean: { ramp: ['#08142A', '#0F3256', '#1C5784', '#3A86B2', '#86C2DA'], land: ['#1C2E1A', '#2E4A26', '#4E6A36', '#7A8A50'], atm: '#8FD0EC', atmA: 0.6 },
      gasriese: { ramp: ['#2A1A12', '#58361F', '#8A5530', '#B87E48', '#DDB27A', '#F2DCB0'], atm: '#F0C88E', atmA: 0.55 },
    },
    sterne: { gelb: { core: '#FFF6DA', glow: '#FFD27A' }, orange: { core: '#FFE2B8', glow: '#FF9A4A' }, weiss: { core: '#F4F8FF', glow: '#BFD6FF' }, rot: { core: '#FFD0C0', glow: '#FF5A3C' } },
    sternfeld: { anzahl: 320, farben: ['#FFE8C0', '#CFE0FF', 'rgba(220,226,240,0.55)', 'rgba(180,190,210,0.3)'] },
    randLicht: { tiefe: 70, alpha: 0.5 },
  };
  const ARTEN = ['fels', 'eis', 'wueste', 'ozean', 'gasriese'];
  const KLASSEN = ['gelb', 'orange', 'weiss', 'rot'];

  function tok() {
    const t = (root.HauptschirmTokens && root.HauptschirmTokens.kugel) || {};
    return {
      radiusStufe: t.radiusStufe || DEFAULT.radiusStufe, cacheMax: t.cacheMax || DEFAULT.cacheMax, lichtStufen: t.lichtStufen || DEFAULT.lichtStufen,
      blockMin: t.blockMin || DEFAULT.blockMin, blockMax: t.blockMax || DEFAULT.blockMax, blockTeiler: t.blockTeiler || DEFAULT.blockTeiler, kantenDunkel: t.kantenDunkel || DEFAULT.kantenDunkel,
      arten: Object.assign({}, DEFAULT.arten, t.arten || {}), sterne: Object.assign({}, DEFAULT.sterne, t.sterne || {}),
      sternfeld: Object.assign({}, DEFAULT.sternfeld, t.sternfeld || {}), randLicht: Object.assign({}, DEFAULT.randLicht, t.randLicht || {}),
    };
  }

  // ------------------------------------------------------------ Farbe und Rauschen (deterministisch)
  function hex2rgb(h) { const n = parseInt(String(h).slice(1, 7), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function rgba(h, a) { const c = hex2rgb(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function hash3(x, y, z, s) { let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1442695041) | 0; h = (h ^ (h >>> 13)) * 1274126177; h ^= h >>> 16; return (h >>> 0) / 4294967296; }
  function vnoise(x, y, z, s) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const L = (a, b, t) => a + (b - a) * t;
    const n = (i, j, k) => hash3(xi + i, yi + j, zi + k, s);
    return L(L(L(n(0, 0, 0), n(1, 0, 0), u), L(n(0, 1, 0), n(1, 1, 0), u), v), L(L(n(0, 0, 1), n(1, 0, 1), u), L(n(0, 1, 1), n(1, 1, 1), u), v), w);
  }
  function fbm(x, y, z, s, o) { let a = 0, f = 1, amp = 0.5; for (let i = 0; i < o; i++) { a += amp * vnoise(x * f, y * f, z * f, s + i * 17); f *= 2.03; amp *= 0.5; } return a; }
  function rng(seed) { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

  // ------------------------------------------------------------ Kugel: reiner Pixelpuffer (ohne Canvas, gut testbar)
  // Rückgabe { daten: Uint8ClampedArray (RGBA), S, R, pad }. L = Lichtvektor (x rechts, y unten, z zum Betrachter).
  function kugelPixel(art, R, seed, lichtWinkel, T) {
    const P = T.arten[art] || T.arten.fels;
    const blk = Math.max(T.blockMin, Math.min(T.blockMax, Math.round(R / T.blockTeiler)));
    const pad = Math.ceil(R * 0.25) + 3, S = 2 * (R + pad);
    const daten = new Uint8ClampedArray(S * S * 4);
    const lx0 = Math.cos(lichtWinkel) * 0.9, ly0 = Math.sin(lichtWinkel) * 0.9, lz0 = 0.45, ll = Math.hypot(lx0, ly0, lz0), lx = lx0 / ll, ly = ly0 / ll, lz = lz0 / ll;
    const tilt = -0.25, ct = Math.cos(tilt), st = Math.sin(tilt);
    const ramp = P.ramp.map(hex2rgb), land = P.land ? P.land.map(hex2rgb) : null, atm = hex2rgb(P.atm);
    const nb = Math.ceil(S / blk) + 1, zelle = new Map();   // je Block einmal gerechnet: { v, dif, z, pal } oder null (außerhalb)
    function blockWerte(bi, bj) {
      const key = bj * nb + bi;
      if (zelle.has(key)) return zelle.get(key);
      const bx = bi * blk + blk / 2 + pad, by = bj * blk + blk / 2 + pad;
      const x = (bx - pad - R) / R, y = (by - pad - R) / R, rr = x * x + y * y;
      let res = null;
      if (rr <= 1) {
        const z = Math.sqrt(1 - rr), ax = Math.abs(x), ay = Math.abs(y), m = Math.max(ax, ay, z);
        let n = [x * 0.55 + (ax === m ? Math.sign(x) * 0.45 : 0), y * 0.55 + (ay === m ? Math.sign(y) * 0.45 : 0), z * 0.55 + (z === m ? 0.45 : 0)];
        const nl = Math.hypot(n[0], n[1], n[2]); n = [n[0] / nl, n[1] / nl, n[2] / nl];
        const dif = n[0] * lx + n[1] * ly + n[2] * lz;
        const yy = y * ct - z * st, zz = y * st + z * ct, xx = x, z2 = zz;
        let tone, pal = ramp;
        if (art === 'gasriese') {
          const turb = fbm(xx * 3, yy * 3, z2 * 3, seed, 4);
          tone = 0.12 + (Math.sin(yy * 9.5 + turb * 3.2 + Math.sin(yy * 3) * 1.2) * 0.5 + 0.5) * 0.88;
          const sx = xx - 0.32, sy = yy - 0.28, sd = Math.hypot(sx * 1.6, sy * 2.6);
          if (sd < 0.16 && z2 > 0) tone = 0.95 - sd * 2;
        } else {
          const h = fbm(xx * 2.2, yy * 2.2, z2 * 2.2, seed, 5);
          if (art === 'ozean') { if (h > 0.56 && land) { pal = land; tone = (h - 0.56) * 3.2; } else tone = 0.35 + h * 0.6; }
          else if (art === 'eis') tone = 0.45 + h * 0.7 + (Math.abs(yy) > 0.7 ? 0.3 : 0);
          else if (art === 'wueste') tone = 0.3 + h * 0.6 + Math.sin(yy * 14 + h * 5) * 0.06;
          else tone = 0.2 + h * 0.85 + (fbm(xx * 9, yy * 9, z2 * 9, seed + 3, 2) > 0.62 ? -0.25 : 0);
        }
        const light = Math.max(0, Math.min(1, dif * 1.05 + 0.02));
        res = { v: Math.max(0, Math.min(0.999, tone * (0.12 + light * 0.95))), dif, z, pal, light };
      }
      zelle.set(key, res);
      return res;
    }
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const i = (py * S + px) * 4;
        // Blockraster beginnt bei pad; davor liegt nur Rand (außerhalb der Kugel)
        const b = px >= pad && py >= pad ? blockWerte(Math.floor((px - pad) / blk), Math.floor((py - pad) / blk)) : null;
        if (!b) {
          // Atmosphärensaum außen (nur Lichtseite stärker)
          const dx = (px + 0.5 - pad - R) / R, dy = (py + 0.5 - pad - R) / R, dist = Math.hypot(dx, dy);
          if (dist < 1.18 && P.atmA > 0 && dist > 0) {
            const lit = Math.max(0, (dx / dist) * lx + (dy / dist) * ly + 0.35);
            const a = P.atmA * (1 - (dist - 1) / 0.18) ** 2 * Math.min(1, lit) * 0.8;
            if (a > 0.02) { daten[i] = atm[0]; daten[i + 1] = atm[1]; daten[i + 2] = atm[2]; daten[i + 3] = Math.round(a * 255); }
          }
          continue;
        }
        const pal = b.pal, th = BAYER[(py % 4) * 4 + (px % 4)];
        const col = pal[Math.min(pal.length - 1, Math.floor(b.v * (pal.length - 1) + th * 0.9))];
        let r = col[0], g = col[1], bl = col[2];
        if (b.light < 0.02) { r *= 0.3; g *= 0.3; bl *= 0.36; }
        const rim = Math.pow(1 - b.z, 3) * P.atmA * Math.max(0, b.dif + 0.3);
        r = Math.min(255, r + atm[0] * rim); g = Math.min(255, g + atm[1] * rim); bl = Math.min(255, bl + atm[2] * rim);
        if ((px - pad) % blk === 0 || (py - pad) % blk === 0) { r *= T.kantenDunkel; g *= T.kantenDunkel; bl *= T.kantenDunkel; }
        daten[i] = r; daten[i + 1] = g; daten[i + 2] = bl; daten[i + 3] = 255;
      }
    }
    return { daten, S, R, pad, blk };
  }

  // ------------------------------------------------------------ Zwischenspeicher (LRU)
  const cache = new Map();
  let grenze = 0, gebaut = 0, treffer = 0, dunkelGebaut = 0;
  let fabrik = null;   // optional: (w, h) -> Canvas (Tests ohne DOM)
  function neuesCanvas(w, h) {
    if (fabrik) return fabrik(w, h);
    const cv = root.document.createElement('canvas'); cv.width = w; cv.height = h; return cv;
  }
  function quantR(radiusPx, T) { return Math.max(T.radiusStufe, Math.round(radiusPx / T.radiusStufe) * T.radiusStufe); }
  function quantL(winkel, T) {
    const n = T.lichtStufen, t = Math.round(((((+winkel || 0) / (2 * Math.PI)) % 1) + 1) % 1 * n) % n;
    return t;
  }
  function eintrag(art, radiusPx, seed, lichtWinkel) {
    const T = tok();
    if (!ARTEN.includes(art)) art = 'fels';
    const R = quantR(radiusPx, T), stufe = quantL(lichtWinkel, T), key = art + '|' + R + '|' + (seed | 0) + '|' + stufe + '|' + T.lichtStufen;
    let e = cache.get(key);
    if (e) { cache.delete(key); cache.set(key, e); treffer++; return e; }
    const p = kugelPixel(art, R, seed | 0, stufe / T.lichtStufen * 2 * Math.PI, T);
    const cv = neuesCanvas(p.S, p.S), g = cv.getContext('2d'), img = g.createImageData(p.S, p.S);
    img.data.set(p.daten); g.putImageData(img, 0, 0);
    e = { cv, S: p.S, R: p.R, dunkel: new Map() };
    gebaut++;
    cache.set(key, e);
    const max = grenze || T.cacheMax;
    while (cache.size > max) cache.delete(cache.keys().next().value);
    return e;
  }

  function planet(art, radiusPx, seed, lichtWinkel) { return eintrag(art, radiusPx, seed, lichtWinkel).cv; }

  // Abgedunkelte Fassung (Stufen von 0,1) wird einmal je Eintrag erzeugt, nicht je Frame
  function dunkelFassung(e, a) {
    const k = Math.round(a * 10);
    let d = e.dunkel.get(k);
    if (!d) {
      d = neuesCanvas(e.S, e.S);
      const g = d.getContext('2d');
      g.drawImage(e.cv, 0, 0);
      g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(5,7,13,' + (k / 10) + ')'; g.fillRect(0, 0, e.S, e.S);
      e.dunkel.set(k, d); dunkelGebaut++;
    }
    return d;
  }
  function zeichnePlanet(ctx, art, x, y, radiusPx, seed, lichtWinkel, rot, abdunkeln) {
    const e = eintrag(art, radiusPx, seed, lichtWinkel);
    const T = tok(), f = Math.max(0.01, radiusPx) / e.R, quelle = abdunkeln > 0.05 ? dunkelFassung(e, Math.min(1, abdunkeln)) : e.cv;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    const s = e.S * f;
    ctx.drawImage(quelle, -s / 2, -s / 2, s, s);
    ctx.restore();
    void T;
  }

  // ------------------------------------------------------------ Stern als Effekt
  function stern(ctx, x, y, radiusPx, klasse, t) {
    const S = tok().sterne[klasse] || tok().sterne.gelb, r = Math.max(1, radiusPx);
    const puls = 1 + 0.04 * Math.sin((t || 0) * 1.7);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const [rr, a] of [[r * 9, 0.08], [r * 5, 0.14], [r * 2.6, 0.28], [r * 1.5, 0.5]]) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, rr * puls); g.addColorStop(0, rgba(S.glow, a)); g.addColorStop(1, rgba(S.glow, 0));
      ctx.fillStyle = g; ctx.fillRect(x - rr * puls, y - rr * puls, rr * puls * 2, rr * puls * 2);
    }
    ctx.fillStyle = rgba(S.glow, 0.35);
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4 + 0.2, L = r * (k % 2 ? 2.4 : 4.2);
      for (let s = r; s < L; s += 1) { ctx.globalAlpha = 0.9 * (1 - (s - r) / (L - r)); ctx.fillRect(Math.round(x + Math.cos(a) * s), Math.round(y + Math.sin(a) * s), 1, 1); }
    }
    ctx.globalAlpha = 1; ctx.restore();
    ctx.fillStyle = S.core; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(x - r * 0.15, y - r * 0.15, r * 0.6, 0, Math.PI * 2); ctx.fill();
  }

  // Sternlicht als Randglühen: der Strahl aus der Rechteckmitte in Peilung winkel trifft den Rand; dort sitzt ein weicher Verlauf, auf das Rechteck beschnitten
  function randLicht(ctx, rect, winkel, klasse) {
    const T = tok(), S = T.sterne[klasse] || T.sterne.gelb, cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2, dx = Math.cos(winkel), dy = Math.sin(winkel);
    let t = Infinity;
    if (dx > 1e-6) t = Math.min(t, (rect.x + rect.w - cx) / dx); else if (dx < -1e-6) t = Math.min(t, (rect.x - cx) / dx);
    if (dy > 1e-6) t = Math.min(t, (rect.y + rect.h - cy) / dy); else if (dy < -1e-6) t = Math.min(t, (rect.y - cy) / dy);
    const ex = cx + dx * t, ey = cy + dy * t, R = Math.max(10, T.randLicht.tiefe), a = T.randLicht.alpha;
    ctx.save();
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, R);
    g.addColorStop(0, rgba(S.glow, a)); g.addColorStop(0.35, rgba(S.glow, a * 0.4)); g.addColorStop(1, rgba(S.glow, 0));
    ctx.fillStyle = g; ctx.fillRect(ex - R, ey - R, R * 2, R * 2);
    ctx.fillStyle = rgba(S.core, 0.8); ctx.fillRect(Math.round(ex - 2), Math.round(ey - 2), 4, 4);
    ctx.restore();
  }

  // ------------------------------------------------------------ Sternfeld (fester Satz, vorab berechnet)
  const felder = new Map();
  function feld(seed, anzahl) {
    const key = (seed | 0) + '|' + anzahl;
    let f = felder.get(key);
    if (!f) {
      const R = rng(seed | 0 || 7), eimer = [[], [], [], []];
      for (let i = 0; i < anzahl; i++) {
        const x = (R() - 0.5) * 2, y = (R() - 0.5) * 2, b = R();
        eimer[b > 0.97 ? 0 : b > 0.9 ? 1 : b > 0.6 ? 2 : 3].push(x, y, b > 0.985 ? 2 : 1);
      }
      f = eimer; felder.set(key, f);
      if (felder.size > 8) felder.delete(felder.keys().next().value);
    }
    return f;
  }
  function sternfeld(ctx, rect, rot, seed) {
    const T = tok(), farben = T.sternfeld.farben, f = feld(seed, T.sternfeld.anzahl);
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2, D = Math.hypot(rect.w, rect.h) / 2, co = Math.cos(rot || 0), si = Math.sin(rot || 0);
    for (let k = 0; k < 4; k++) {
      const p = f[k]; if (!p.length) continue;
      ctx.fillStyle = farben[k] || farben[farben.length - 1];
      for (let i = 0; i < p.length; i += 3) {
        const u = p[i] * D, v = p[i + 1] * D, x = Math.round(cx + u * co - v * si), y = Math.round(cy + u * si + v * co);
        if (x < rect.x || y < rect.y || x >= rect.x + rect.w || y >= rect.y + rect.h) continue;
        ctx.fillRect(x, y, p[i + 2], p[i + 2]);
      }
    }
  }

  const API = {
    planet, zeichnePlanet, stern, randLicht, sternfeld, ARTEN, KLASSEN, DEFAULT,
    statistik() { return { gebaut, treffer, dunkelGebaut, eintraege: cache.size }; },
    leeren() { cache.clear(); felder.clear(); gebaut = 0; treffer = 0; dunkelGebaut = 0; },
    setzeGrenze(n) { grenze = n | 0; },
    setzeCanvasFabrik(f) { fabrik = f; },   // Tests ohne DOM
    kugelPixel(art, radiusPx, seed, lichtWinkel) { const T = tok(); return kugelPixel(art, quantR(radiusPx, T), seed | 0, quantL(lichtWinkel, T) / T.lichtStufen * 2 * Math.PI, T); },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.KulisseKugel = API;
})(typeof window !== 'undefined' ? window : globalThis);
