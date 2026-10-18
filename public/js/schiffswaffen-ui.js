// PAN-01 C: Darstellung der Schiffswaffen im Client – Taktik-Symbole (Masken aus shared/schiffskatalog.js), Zuordnung Mount -> Katalogwaffe,
// Platzhalter-Silhouetten für die Lafette in der Innenansicht (bis das Voxelwerk die echten Modelle liefert). Globales `SchiffsUI`.
// Klassisches Skript, hängt nur an window.Shared_Schiffskatalog, wirft nie (ohne Katalog sind alle Funktionen No-ops).
//
//   SchiffsUI.waffeVon(mount)          Katalogeintrag der Waffe eines ship.mounts[]-Eintrags (fehlendes typ = Startbestückung des Platzes)
//   SchiffsUI.platzVon(mount)          Ziffernblock-Platz 1–9
//   SchiffsUI.mountAmPlatz(ship, p)    Mount-Eintrag auf Platz p oder null
//   SchiffsUI.draw(ctx, symbolId, x, y, { scale, color, alpha })   Pixelmaske (Mitte x/y), Format wie IconsB.draw
//   SchiffsUI.drawWaffe(ctx, waffeId, x, y, opts)                  Symbol der Waffe, Standardfarbe = Projektilfarbe des Katalogs
//   SchiffsUI.lafette(ctx, waffeId, x, y, { scale, alpha })        Platzhalter-Silhouette (Mitte x/y, rund 22 px hoch)
(function (root) {
  'use strict';
  var KAT = root.Shared_Schiffskatalog || null;
  var hasDom = typeof document !== 'undefined' && !!document.createElement;
  var UI = { errors: 0 };

  function warn(where, e) {
    UI.errors++;
    if (UI.errors < 20) { try { console.warn('[SchiffsUI] ' + where + ':', e && e.message ? e.message : e); } catch (_) { /* egal */ } }
  }
  function hex2rgb(h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function c255(v) { v = Math.round(v); return v < 0 ? 0 : v > 255 ? 255 : v; }
  function rgb2hex(r, g, b) { return '#' + ((1 << 24) | (c255(r) << 16) | (c255(g) << 8) | c255(b)).toString(16).slice(1); }
  function shade(h, f) {
    var c = hex2rgb(h);
    if (f >= 0) return rgb2hex(c[0] + (255 - c[0]) * f, c[1] + (255 - c[1]) * f, c[2] + (255 - c[2]) * f);
    return rgb2hex(c[0] * (1 + f), c[1] * (1 + f), c[2] * (1 + f));
  }
  function mix(a, b, t) {
    var x = hex2rgb(a), y = hex2rgb(b);
    return rgb2hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
  }

  // ---------------------------------------------------------------- Zuordnung
  UI.platzVon = function (m) {
    if (!m || !KAT) return null;
    var p = KAT.platzVonMount(m.id);
    return p == null ? null : p;
  };
  UI.waffeVon = function (m) {
    if (!m || !KAT) return null;
    if (m.typ && KAT.BY_ID[m.typ]) return KAT.BY_ID[m.typ];
    var p = UI.platzVon(m);
    var id = p != null ? KAT.START_BESTUECKUNG[p] : null;
    return id ? KAT.BY_ID[id] || null : null;
  };
  UI.mountAmPlatz = function (ship, platz) {
    var list = (ship && ship.mounts) || [];
    for (var i = 0; i < list.length; i++) if (UI.platzVon(list[i]) === platz) return list[i];
    return null;
  };
  UI.farbe = function (waffe) { return (waffe && waffe.projektil && waffe.projektil.farbe) || '#F4EEDC'; };

  // ---------------------------------------------------------------- Symbole (10×10-Maske, beim Zeichnen 12×12 mit Pixel-Outline)
  var cache = new Map();
  function sprite(symbolId, color) {
    if (!hasDom || !KAT || !KAT.SYMBOLE[symbolId]) return null;
    var key = symbolId + '|' + color;
    var c = cache.get(key);
    if (c) return c;
    c = document.createElement('canvas'); c.width = 12; c.height = 12;
    var g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    var map = { '#': color, '+': shade(color, 0.45), 'o': shade(color, -0.55), 'w': shade(color, 0.7) };
    var rows = KAT.SYMBOLE[symbolId];
    for (var r = 0; r < rows.length; r++) for (var q = 0; q < rows[r].length; q++) {
      var col = map[rows[r][q]];
      if (col) { g.fillStyle = col; g.fillRect(1 + q, 1 + r, 1, 1); }
    }
    // Outline: ein Pixel Rand in dunkler Mischfarbe um alle gesetzten Pixel
    var id = g.getImageData(0, 0, 12, 12), d = id.data, op = new Uint8Array(144), rgb = hex2rgb(mix('#0B0E1A', color, 0.12)), i, x, y;
    for (i = 0; i < 144; i++) op[i] = d[i * 4 + 3] > 40 ? 1 : 0;
    for (y = 0; y < 12; y++) for (x = 0; x < 12; x++) {
      i = y * 12 + x;
      if (op[i]) continue;
      if ((x > 0 && op[i - 1]) || (x < 11 && op[i + 1]) || (y > 0 && op[i - 12]) || (y < 11 && op[i + 12])) { d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; d[i * 4 + 3] = 255; }
    }
    g.putImageData(id, 0, 0);
    if (cache.size > 80) cache.clear();
    cache.set(key, c);
    return c;
  }
  UI.draw = function (ctx, symbolId, x, y, opts) {
    try {
      opts = opts || {};
      var spr = sprite(symbolId, opts.color || '#F4EEDC');
      if (!spr) return false;
      var s = opts.scale || 1, a0 = ctx.globalAlpha;
      if (opts.alpha != null) ctx.globalAlpha = a0 * opts.alpha;
      var sm = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
      if (s === 1) ctx.drawImage(spr, Math.round(x - 6), Math.round(y - 6));
      else ctx.drawImage(spr, Math.round(x - 6 * s), Math.round(y - 6 * s), Math.round(12 * s), Math.round(12 * s));
      ctx.imageSmoothingEnabled = sm; ctx.globalAlpha = a0;
      return true;
    } catch (e) { warn('draw', e); return false; }
  };
  UI.drawWaffe = function (ctx, waffeId, x, y, opts) {
    var w = KAT && KAT.BY_ID[waffeId];
    if (!w) return false;
    opts = opts || {};
    return UI.draw(ctx, w.symbol, x, y, { scale: opts.scale, alpha: opts.alpha, color: opts.color || UI.farbe(w) });
  };

  // ---------------------------------------------------------------- Lafetten-Platzhalter (Innenansicht)
  // Von oben gesehen, Mündung nach oben; je Waffenart eine eigene Silhouette. Farben: Metall neutral, Akzent = Projektilfarbe des Katalogs.
  function R(c, x, y, w, h, col) { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), w, h); }
  function disc(c, x, y, r, col) { c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
  var METALL = '#8EA3B5', METALL_D = '#4F6178', METALL_H = '#C7D3DD', SOCKEL = '#2E3A4A';
  var DRAW = {
    standardbatterie: function (c, ak) {   // Rohrbündel: vier gleiche Rohre
      R(c, -9, 3, 18, 6, SOCKEL); R(c, -9, 3, 18, 1, METALL_D);
      for (var i = 0; i < 4; i++) { var x = -8 + i * 5; R(c, x, -9, 3, 14, METALL); R(c, x, -9, 1, 14, METALL_H); R(c, x, -10, 3, 2, ak); }
    },
    sturmbatterie: function (c, ak) {   // viele dünne Rohre
      R(c, -9, 4, 18, 5, SOCKEL); R(c, -9, 4, 18, 1, METALL_D);
      for (var i = 0; i < 8; i++) { var x = -8 + i * 2.2; R(c, x, -10, 1, 15, METALL); R(c, x, -11, 1, 2, ak); }
    },
    streubatterie: function (c, ak) {   // Werfer mit Kugeln
      R(c, -9, 4, 18, 5, SOCKEL); R(c, -9, 4, 18, 1, METALL_D);
      R(c, -5, -3, 10, 9, METALL); R(c, -5, -3, 10, 1, METALL_H); R(c, -3, -2, 6, 6, '#1B2330');
      disc(c, -6, -7, 2.4, ak); disc(c, 0, -9, 2.4, ak); disc(c, 6, -7, 2.4, ak);
      disc(c, -6.6, -7.6, 0.8, METALL_H); disc(c, -0.6, -9.6, 0.8, METALL_H); disc(c, 5.4, -7.6, 0.8, METALL_H);
    },
    lanzenbatterie: function (c, ak) {   // zwei Lanzen
      R(c, -9, 5, 18, 5, SOCKEL); R(c, -9, 5, 18, 1, METALL_D);
      for (var i = 0; i < 2; i++) { var x = -7 + i * 9; R(c, x, -9, 5, 15, METALL); R(c, x + 1, -9, 1, 15, METALL_H); R(c, x + 1, -11, 3, 3, ak); R(c, x + 2, -12, 1, 2, '#FFFFFF'); }
      R(c, -2, 0, 4, 2, ak);
    },
    lanze: function (c, ak) {   // eine lange, dicke Lanze mit Ring
      R(c, -8, 5, 16, 5, SOCKEL); R(c, -8, 5, 16, 1, METALL_D);
      R(c, -3, -9, 6, 15, METALL); R(c, -2, -9, 1, 15, METALL_H);
      for (var i = 0; i < 3; i++) R(c, -4, -4 + i * 4, 8, 1, METALL_D);
      R(c, -2, -12, 4, 4, ak); R(c, -1, -13, 2, 2, '#FFFFFF');
    },
    standardkanone: function (c, ak) {   // ein kurzes, dickes Rohr mit Mündungsbremse
      R(c, -9, 3, 18, 6, SOCKEL); R(c, -9, 3, 18, 1, METALL_D);
      R(c, -3, -7, 6, 12, METALL); R(c, -3, -7, 1, 12, METALL_H);
      R(c, -5, -9, 10, 3, METALL_D); R(c, -4, -9, 8, 1, METALL_H); R(c, -2, -10, 4, 2, ak);
      R(c, -5, 0, 2, 4, METALL_D); R(c, 3, 0, 2, 4, METALL_D);
    },
    torpedowerfer: function (c, ak) {   // Schacht mit Torpedo, Flamme am Ende
      R(c, -8, -4, 16, 14, SOCKEL); R(c, -8, -4, 16, 1, METALL_D); R(c, -8, -4, 2, 14, METALL_D); R(c, 6, -4, 2, 14, METALL_D);
      R(c, -4, -9, 8, 16, METALL); R(c, -4, -9, 1, 16, METALL_H);
      R(c, -3, -11, 6, 3, ak); R(c, -2, -12, 4, 2, '#FFE3A8');   // Spitze
      R(c, -6, 3, 3, 4, METALL_D); R(c, 3, 3, 3, 4, METALL_D);   // Flossen
      R(c, -2, 7, 4, 3, '#F08A3C'); R(c, -1, 9, 2, 2, '#FFE3A8');
    },
    abwehrturm: function (c, ak) {   // runder Drehturm mit zwei kurzen Rohren
      disc(c, 0, 2, 9, SOCKEL); disc(c, 0, 2, 7, METALL_D); disc(c, 0, 2, 5, METALL); disc(c, -1, 1, 1.6, METALL_H);
      R(c, -5, -8, 2, 8, METALL); R(c, 3, -8, 2, 8, METALL); R(c, -5, -9, 2, 2, ak); R(c, 3, -9, 2, 2, ak);
      for (var i = 0; i < 6; i++) { var a = i / 6 * Math.PI * 2; R(c, Math.cos(a) * 9 - 0.5, 2 + Math.sin(a) * 9 - 0.5, 1, 1, ak); }
    },
  };
  UI.hatLafette = function (waffeId) { return !!DRAW[waffeId]; };
  UI.lafette = function (ctx, waffeId, x, y, opts) {
    try {
      var w = KAT && KAT.BY_ID[waffeId];
      var fn = DRAW[waffeId];
      if (!w || !fn) return false;
      opts = opts || {};
      var s = opts.scale || 1, a0 = ctx.globalAlpha;
      ctx.save();
      if (opts.alpha != null) ctx.globalAlpha = a0 * opts.alpha;
      ctx.translate(Math.round(x), Math.round(y)); if (s !== 1) ctx.scale(s, s);
      fn(ctx, UI.farbe(w));
      ctx.restore();
      return true;
    } catch (e) { warn('lafette', e); return false; }
  };

  root.SchiffsUI = UI;
})(typeof self !== 'undefined' ? self : this);
