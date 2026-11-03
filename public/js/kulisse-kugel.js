// KUL-02 B: Kugel- und Sternzeichner der Himmelskulisse (Richtung A „Tiefe“ aus KUL-01). REINER ZEICHNER ohne Spielwissen: kennt weder drawSpace noch Snapshot noch den
// Zustand hauptschirmAnsicht. Der klassische Hauptschirm (KUL-02 C) und das Visier (KUL-03) rufen dieselben Funktionen auf.
//   KulisseKugel.planet(art, radiusPx, seed, lichtWinkel)  -> Canvas (zwischengespeichert, Weltorientierung); art: fels | eis | wueste | ozean | gasriese
//   KulisseKugel.zeichnePlanet(ctx, art, x, y, radiusPx, seed, lichtWinkel, rot, abdunkeln)   rot in Bogenmaß (der Cache bleibt ungedreht), abdunkeln 0..1
//   KulisseKugel.stern(ctx, x, y, radiusPx, klasse, t)     klasse: gelb | orange | weiss | rot
//   KulisseKugel.randLicht(ctx, rect, winkel, klasse)      Randglühen am Bildrand in Peilung winkel (Bogenmaß, Bildschirmraum: 0 = rechts, +π/2 = unten)
//   KulisseKugel.sternfeld(ctx, rect, rot, seed)           Fixsterne (Tokens STERNFELD, seed optional), drehen mit rot um die Rechteckmitte
//   KulisseKugel.statistik() -> { gebaut, treffer, dunkelGebaut, eintraege }   Zähler für Tests/Messwert;  .leeren() / .setzeGrenze(n)
// Lichtwinkel: Richtung, IN der der Stern steht (Weltorientierung, y nach unten, Bogenmaß, 0 = +x). Die Lichtseite der Kugel zeigt dorthin.
// Werte: window.HauptschirmTokens.TOKENS (Paket T, public/js/hauptschirm-tokens.js; in Node wird die Datei nachgeladen) – PLANET (Paletten), STERN (Klassen), STERNFELD, SONNE
// (Glühen, Strahlen, Lichtvektor), KUGEL (Blockraster, Dithering, Licht, Nacht, Saum, Randlicht), HIMMEL.kippung. DEFAULT enthält nur, was T nicht kennt (Zwischenspeicher, Winkelstufen,
// Tiefe des Randglühens). Wirkung auf bereits gebaute Kugeln: nach Tokenwechsel leeren() aufrufen.
(function (root) {
  'use strict';

  const DEFAULT = {
    radiusStufe: 4, cacheMax: 24, lichtStufen: 24,   // Zwischenspeicher: Radius in Stufen von 4 px, höchstens 24 Kugeln, 24 Lichtwinkel je Vollkreis
    randLicht: { tiefe: 70, alpha: 0.5 },            // Randglühen am Bildrand (T beschreibt nur den Stern selbst)
  };
  const ARTEN = ['fels', 'eis', 'wueste', 'ozean', 'gasriese'];
  const KLASSEN = ['gelb', 'orange', 'weiss', 'rot'];

  function tokens() {
    let T = root.HauptschirmTokens && root.HauptschirmTokens.TOKENS;
    if (!T && typeof require === 'function') { try { T = require('./hauptschirm-tokens.js').TOKENS; } catch (e) { /* ohne Tokens keine Kugeln */ } }
    if (!T) throw new Error('KulisseKugel: HauptschirmTokens fehlt (hauptschirm-tokens.js vor kulisse-kugel.js laden)');
    return T;
  }
  let tokCache = null;   // einmal aus den Tokens abgeleitet (leeren() verwirft ihn)
  function tok() {
    if (tokCache) return tokCache;
    const T = tokens(), K = T.KUGEL;
    return tokCache = {
      radiusStufe: DEFAULT.radiusStufe, cacheMax: DEFAULT.cacheMax, lichtStufen: DEFAULT.lichtStufen, randLicht: DEFAULT.randLicht,
      block: K.block, dither: K.dither.bayer4.map((v) => (v + 0.5) / 16), schwelle: K.dither.schwelle, licht: K.licht, nacht: K.nacht, saum: K.saum, randlicht: K.randlicht, rand: K.rand,
      kippung: T.HIMMEL.kippung, lichtZ: T.SONNE.lichtZ, planet: T.PLANET, stern: T.STERN, sonne: T.SONNE, sternfeld: T.STERNFELD,
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

  // ------------------------------------------------------------ Kugel: reiner Pixelpuffer (ohne Canvas, gut testbar)
  // Rückgabe { daten: Uint8ClampedArray (RGBA), S, R, pad }. L = Lichtvektor (x rechts, y unten, z zum Betrachter).
  function kugelPixel(art, R, seed, lichtWinkel, T) {
    const P = T.planet[art] || T.planet.fels;
    const blk = Math.max(T.block.min, Math.min(T.block.max, Math.round(R / T.block.pxJeBlock)));
    const pad = Math.ceil(R * T.rand.pad) + T.rand.padPx, S = 2 * (R + pad);
    const daten = new Uint8ClampedArray(S * S * 4);
    const lx0 = Math.cos(lichtWinkel), ly0 = Math.sin(lichtWinkel), lz0 = T.lichtZ, ll = Math.hypot(lx0, ly0, lz0), lx = lx0 / ll, ly = ly0 / ll, lz = lz0 / ll;
    const ct = Math.cos(T.kippung), st = Math.sin(T.kippung);
    const ramp = P.rampe.map(hex2rgb), land = P.land ? P.land.map(hex2rgb) : null, atm = hex2rgb(P.atm);
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
        const light = Math.max(0, Math.min(1, dif * T.licht.diffus + T.licht.versatz));
        res = { v: Math.max(0, Math.min(0.999, tone * (T.licht.grund + light * T.licht.faktor))), dif, z, pal, light };
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
          if (dist < 1 + T.saum.breite && P.atmAlpha > 0 && dist > 0) {
            const lit = Math.max(0, (dx / dist) * lx + (dy / dist) * ly + T.saum.lichtVersatz);
            const a = P.atmAlpha * (1 - (dist - 1) / T.saum.breite) ** 2 * Math.min(1, lit) * T.saum.faktor;
            if (a > T.saum.minAlpha) { daten[i] = atm[0]; daten[i + 1] = atm[1]; daten[i + 2] = atm[2]; daten[i + 3] = Math.round(a * 255); }
          }
          continue;
        }
        const pal = b.pal, th = T.dither[(py % 4) * 4 + (px % 4)];
        const col = pal[Math.min(pal.length - 1, Math.floor(b.v * (pal.length - 1) + th * T.schwelle))];
        let r = col[0], g = col[1], bl = col[2];
        if (b.light < T.nacht.unter) { r *= T.nacht.faktorRG; g *= T.nacht.faktorRG; bl *= T.nacht.faktorB; }
        const rim = Math.pow(1 - b.z, T.randlicht.exponent) * P.atmAlpha * Math.max(0, b.dif + T.randlicht.lichtVersatz);
        r = Math.min(255, r + atm[0] * rim); g = Math.min(255, g + atm[1] * rim); bl = Math.min(255, bl + atm[2] * rim);
        if ((px - pad) % blk === 0 || (py - pad) % blk === 0) { r *= T.block.kantenFaktor; g *= T.block.kantenFaktor; bl *= T.block.kantenFaktor; }
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
    const k = Math.round(a * 100);   // Stufen von 1 % (KUL-02 C: 22 % Abdunklung aus den Tokens genau, nicht auf 20 % gerundet)
    let d = e.dunkel.get(k);
    if (!d) {
      d = neuesCanvas(e.S, e.S);
      const g = d.getContext('2d');
      g.drawImage(e.cv, 0, 0);
      g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(5,7,13,' + (k / 100) + ')'; g.fillRect(0, 0, e.S, e.S);
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
    const T = tok(), SO = T.sonne, S = T.stern[klasse] || T.stern.gelb, r = Math.max(1, radiusPx), SR = SO.strahlen;
    const puls = 1 + 0.04 * Math.sin((t || 0) * 1.7);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const [f, a] of SO.gluehen) {
      const rr = r * f, g = ctx.createRadialGradient(x, y, 0, x, y, rr * puls); g.addColorStop(0, rgba(S.glut, a)); g.addColorStop(1, rgba(S.glut, 0));
      ctx.fillStyle = g; ctx.fillRect(x - rr * puls, y - rr * puls, rr * puls * 2, rr * puls * 2);
    }
    ctx.fillStyle = rgba(S.glut, SR.alpha);
    for (let k = 0; k < SR.anzahl; k++) {
      const a = k * 2 * Math.PI / SR.anzahl + SR.versatz, L = r * (k % 2 ? SR.kurz : SR.lang);
      for (let s = r; s < L; s += 1) { ctx.globalAlpha = SR.auslauf * (1 - (s - r) / (L - r)); ctx.fillRect(Math.round(x + Math.cos(a) * s), Math.round(y + Math.sin(a) * s), 1, 1); }
    }
    ctx.globalAlpha = 1; ctx.restore();
    ctx.fillStyle = S.kern; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = SO.glanz.farbe; ctx.beginPath(); ctx.arc(x + r * SO.glanz.versatz, y + r * SO.glanz.versatz, r * SO.glanz.radius, 0, Math.PI * 2); ctx.fill();
  }

  // Sternlicht als Randglühen: der Strahl aus der Rechteckmitte in Peilung winkel trifft den Rand; dort sitzt ein weicher Verlauf, auf das Rechteck beschnitten
  function randLicht(ctx, rect, winkel, klasse) {
    const T = tok(), S = T.stern[klasse] || T.stern.gelb, cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2, dx = Math.cos(winkel), dy = Math.sin(winkel);
    let t = Infinity;
    if (dx > 1e-6) t = Math.min(t, (rect.x + rect.w - cx) / dx); else if (dx < -1e-6) t = Math.min(t, (rect.x - cx) / dx);
    if (dy > 1e-6) t = Math.min(t, (rect.y + rect.h - cy) / dy); else if (dy < -1e-6) t = Math.min(t, (rect.y - cy) / dy);
    const ex = cx + dx * t, ey = cy + dy * t, R = Math.max(10, T.randLicht.tiefe), a = T.randLicht.alpha;
    ctx.save();
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, R);
    g.addColorStop(0, rgba(S.glut, a)); g.addColorStop(0.35, rgba(S.glut, a * 0.4)); g.addColorStop(1, rgba(S.glut, 0));
    ctx.fillStyle = g; ctx.fillRect(ex - R, ey - R, R * 2, R * 2);
    ctx.fillStyle = rgba(S.kern, 0.8); ctx.fillRect(Math.round(ex - 2), Math.round(ey - 2), 4, 4);
    ctx.restore();
  }

  // ------------------------------------------------------------ Sternfeld (fester Satz, vorab berechnet)
  const felder = new Map();
  function feld(seed, SF) {
    const key = (seed | 0) + '|' + SF.anzahl;
    let f = felder.get(key);
    if (!f) {
      const R = rng(seed | 0 || 7), kl = SF.klassen, eimer = kl.map(() => []);
      for (let i = 0; i < SF.anzahl; i++) {
        const x = (R() - 0.5) * 2, y = (R() - 0.5) * 2, b = R();
        let k = kl.findIndex((c) => b >= c.ab); if (k < 0) k = kl.length - 1;
        eimer[k].push(x, y, b > SF.grossAb ? SF.grossPx : SF.kleinPx);
      }
      f = eimer; felder.set(key, f);
      if (felder.size > 8) felder.delete(felder.keys().next().value);
    }
    return f;
  }
  function sternfeld(ctx, rect, rot, seed) {
    const T = tok(), SF = T.sternfeld, f = feld(seed == null ? SF.seed : seed, SF);
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2, D = SF.halbeKante, co = Math.cos(rot || 0), si = Math.sin(rot || 0);   // Punkte in ±halbeKante um die Mitte, gedreht um rot
    for (let k = 0; k < f.length; k++) {
      const p = f[k]; if (!p.length) continue;
      ctx.fillStyle = rgba(SF.klassen[k].farbe, SF.klassen[k].alpha);
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
    leeren() { cache.clear(); felder.clear(); tokCache = null; gebaut = 0; treffer = 0; dunkelGebaut = 0; },
    setzeGrenze(n) { grenze = n | 0; },
    setzeCanvasFabrik(f) { fabrik = f; },   // Tests ohne DOM
    kugelPixel(art, radiusPx, seed, lichtWinkel) { const T = tok(); return kugelPixel(art, quantR(radiusPx, T), seed | 0, quantL(lichtWinkel, T) / T.lichtStufen * 2 * Math.PI, T); },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.KulisseKugel = API;
})(typeof window !== 'undefined' ? window : globalThis);
