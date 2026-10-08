// Pantheon – Art-Modul (Team ART). Vertrag: CONTRACT.md §10 (API) und §12 (Grafikvorgaben).
// Klassisches Skript, kein ES-Modul. Alles prozedural, gecacht in Offscreen-Canvases, keine externen Dateien.
// Zeichnen pro Frame nur aus Caches (drawImage); Sprites entstehen lazy beim ersten Gebrauch.
// Unbekannte kinds -> Magenta-Platzhalter, nie werfen. Abgefangene Fehler werden gezählt (Art.errors).
(function (root) {
  'use strict';

  var TILE = 32;
  var hasDom = typeof document !== 'undefined' && !!document.createElement;

  // ---------------------------------------------------------------------------------------------
  // Palette (§12) + abgeleitete Töne
  // ---------------------------------------------------------------------------------------------
  var PAL = {
    holz: '#8A5A3B', messing: '#C9974A', terrakotta: '#B4573E', stahl: '#2E3A4A', paneel: '#4F6178',
    paneelHell: '#8EA3B5', mint: '#7FE0C2', bernstein: '#FFC66B', warngelb: '#F2C94C', alarmrot: '#E0473C',
    funke: '#FFF1B8', rauch: '#5A5560', tiefraum: '#0B0E1A', nebel: '#2A2350', sternweiss: '#F4EEDC',
    moos: '#5E8C4A', rostsand: '#C2703D', eisblau: '#A9D6E5',
    haut0: '#F1C7A0', haut1: '#C68A5E', haut2: '#7A4A2E',
    spieler0: '#56B4E9', spieler1: '#E69F00', spieler2: '#CC79A7',
    outline: '#1B2230', outlineWarm: '#2B1D1A', outlineRust: '#1E1612',
  };
  var PLAYER = ['#56B4E9', '#E69F00', '#CC79A7'];
  var PLAYER_SHAPES = ['circle', 'triangle', 'diamond'];

  // ---------------------------------------------------------------------------------------------
  // Farb-Helfer
  // ---------------------------------------------------------------------------------------------
  function clamp255(v) { v = Math.round(v); return v < 0 ? 0 : v > 255 ? 255 : v; }
  function hex2rgb(h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgb2hex(r, g, b) {
    return '#' + ((1 << 24) | (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b)).toString(16).slice(1);
  }
  var shadeMemo = {};
  // f > 0 aufhellen Richtung Weiß, f < 0 abdunkeln
  function shade(h, f) {
    var k = h + '|' + f;
    if (shadeMemo[k]) return shadeMemo[k];
    var c = hex2rgb(h), r;
    if (f >= 0) r = rgb2hex(c[0] + (255 - c[0]) * f, c[1] + (255 - c[1]) * f, c[2] + (255 - c[2]) * f);
    else r = rgb2hex(c[0] * (1 + f), c[1] * (1 + f), c[2] * (1 + f));
    shadeMemo[k] = r;
    return r;
  }
  function mix(a, b, t) {
    var x = hex2rgb(a), y = hex2rgb(b);
    return rgb2hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
  }
  function rgba(h, a) { var c = hex2rgb(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  // ---------------------------------------------------------------------------------------------
  // Zufall (seeded) + Hash
  // ---------------------------------------------------------------------------------------------
  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(x, y, s) {
    var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul((s | 0) + 1, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // ---------------------------------------------------------------------------------------------
  // Canvas, Cache, Fehlerzählung
  // ---------------------------------------------------------------------------------------------
  function mk(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    c.g = g;
    return c;
  }
  var cache = new Map();
  var warnCount = 0;
  function warn(where, e) {
    Art.errors++;
    if (warnCount++ < 30) { try { console.warn('[Art] ' + where + ':', e && e.message ? e.message : e); } catch (_) {} }
  }
  function cached(key, w, h, fn) {
    var c = cache.get(key);
    if (c) return c;
    c = mk(w, h);
    try { fn(c.g, c); } catch (e) { warn('build ' + key, e); missing(c.g, 0, 0, c.width, c.height); }
    cache.set(key, c);
    return c;
  }
  // kleiner LRU-artiger Cache für Texte/Panels (Größe begrenzt)
  // Verdrängte Canvases kommen in einen Pool und werden wiederverwendet: Texte mit wechselnden Zahlen
  // (Tempo, Abstand, Abklingzeiten …) erzeugten sonst ~30 neue Canvas-Elemente pro Sekunde.
  function SmallCache(max) { this.max = max; this.m = new Map(); this.pool = []; }
  SmallCache.prototype.get = function (k) { return this.m.get(k); };
  SmallCache.prototype.set = function (k, v) {
    if (this.m.size >= this.max) {
      var first = this.m.keys().next().value, old = this.m.get(first);
      this.m.delete(first);
      if (old && old.g && this.pool.length < 64) this.pool.push(old);
    }
    this.m.set(k, v);
  };
  // Canvas aus dem Pool (geleert, neue Größe) oder neu
  SmallCache.prototype.make = function (w, h) {
    var c = this.pool.pop();
    if (!c) return mk(w, h);
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));   // setzt auch den Inhalt zurück
    c.g.setTransform(1, 0, 0, 1, 0, 0); c.g.globalAlpha = 1; c.g.globalCompositeOperation = 'source-over';
    c.g.imageSmoothingEnabled = false;
    return c;
  };

  function missing(ctx, x, y, w, h) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,0,255,0.25)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#FF00FF';
    ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1);
    ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
    var n = Math.min(w, h);
    for (var i = 0; i < n; i += 2) { ctx.fillRect(x + (i * w / n) | 0, y + (i * h / n) | 0, 1, 1); }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------------------------
  // Pixel-Primitive (zeichnen in Cache-Kontexte, scharf, ohne Antialiasing)
  // ---------------------------------------------------------------------------------------------
  function R(g, x, y, w, h, col) { g.fillStyle = col; g.fillRect(x | 0, y | 0, w | 0, h | 0); }
  function P(g, x, y, col) { g.fillStyle = col; g.fillRect(x | 0, y | 0, 1, 1); }
  function ell(g, cx, cy, rx, ry, col) {            // gefüllte Ellipse, pixelgenau
    g.fillStyle = col;
    var y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
    for (var y = y0; y <= y1; y++) {
      var dy = (y + 0.5 - cy) / ry;
      if (dy < -1 || dy > 1) continue;
      var dx = rx * Math.sqrt(1 - dy * dy);
      var a = Math.round(cx - dx), b = Math.round(cx + dx);
      if (b > a) g.fillRect(a, y, b - a, 1);
    }
  }
  function line(g, x0, y0, x1, y1, col) {           // Bresenham
    g.fillStyle = col;
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    var dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
    for (var i = 0; i < 2000; i++) {
      g.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  function numSort(a, b) { return a - b; }
  function poly(g, pts, col) {                      // Scanline-Polygonfüllung (even-odd), pts flach [x,y,...]
    var n = pts.length >> 1;
    if (n < 3) return;
    var minY = Infinity, maxY = -Infinity, i, j;
    for (i = 0; i < n; i++) { var yy = pts[2 * i + 1]; if (yy < minY) minY = yy; if (yy > maxY) maxY = yy; }
    g.fillStyle = col;
    var xs = [];
    for (var y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      var sy = y + 0.5;
      xs.length = 0;
      for (i = 0, j = n - 1; i < n; j = i++) {
        var yi = pts[2 * i + 1], yj = pts[2 * j + 1];
        if ((yi > sy) !== (yj > sy)) {
          var xi = pts[2 * i], xj = pts[2 * j];
          xs.push(xi + (sy - yi) * (xj - xi) / (yj - yi));
        }
      }
      xs.sort(numSort);
      for (var k = 0; k + 1 < xs.length; k += 2) {
        var a = Math.round(xs[k]), b = Math.round(xs[k + 1]);
        if (b > a) g.fillRect(a, y, b - a, 1);
      }
    }
  }
  // Ellipse als Punktliste (für gedrehte Formen)
  function ellPts(cx, cy, rx, ry, n) {
    var out = [];
    n = n || 20;
    for (var i = 0; i < n; i++) { var a = i / n * Math.PI * 2; out.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry); }
    return out;
  }
  // dicke Linie als Viereck-Polygon
  function thick(x0, y0, x1, y1, w) {
    var dx = x1 - x0, dy = y1 - y0, L = Math.sqrt(dx * dx + dy * dy) || 1, nx = -dy / L * w / 2, ny = dx / L * w / 2;
    return [x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny];
  }
  // Pixel-Outline um alle deckenden Pixel (4er-Nachbarschaft, optional diagonal)
  function outline(c, col, diag) {
    var g = c.g || c.getContext('2d'), w = c.width, h = c.height;
    var id = g.getImageData(0, 0, w, h), d = id.data, op = new Uint8Array(w * h), i, x, y;
    for (i = 0; i < w * h; i++) op[i] = d[i * 4 + 3] > 40 ? 1 : 0;
    var rgb = hex2rgb(col);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      if (op[i]) continue;
      var hit = (x > 0 && op[i - 1]) || (x < w - 1 && op[i + 1]) || (y > 0 && op[i - w]) || (y < h - 1 && op[i + w]);
      if (!hit && diag) hit = (x > 0 && y > 0 && op[i - w - 1]) || (x < w - 1 && y > 0 && op[i - w + 1]) ||
        (x > 0 && y < h - 1 && op[i + w - 1]) || (x < w - 1 && y < h - 1 && op[i + w + 1]);
      if (hit) { d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; d[i * 4 + 3] = 255; }
    }
    g.putImageData(id, 0, 0);
  }
  // Silhouette (alle deckenden Pixel einfarbig) – für Treffer-Blitz
  function silhouette(src, col) {
    var c = mk(src.width, src.height);
    c.g.drawImage(src, 0, 0);
    c.g.globalCompositeOperation = 'source-in';
    c.g.fillStyle = col;
    c.g.fillRect(0, 0, c.width, c.height);
    c.g.globalCompositeOperation = 'source-over';
    return c;
  }
  // Pixelraster aus Strings: rows = ['..ab', ...], map = { a: '#hex' }
  function grid(g, x, y, rows, map) {
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      for (var q = 0; q < row.length; q++) {
        var col = map[row[q]];
        if (col) { g.fillStyle = col; g.fillRect(x + q, y + r, 1, 1); }
      }
    }
  }
  function flipH(src) {
    var c = mk(src.width, src.height);
    c.g.translate(src.width, 0); c.g.scale(-1, 1); c.g.drawImage(src, 0, 0);
    return c;
  }
  // weicher Lichtkreis (gecacht), additiv gezeichnet
  function glowSprite(col, r) {
    r = Math.max(2, Math.round(r));
    return cached('glow|' + col + '|' + r, r * 2, r * 2, function (g) {
      var gr = g.createRadialGradient(r, r, 0, r, r, r);
      gr.addColorStop(0, rgba(col, 0.9));
      gr.addColorStop(0.35, rgba(col, 0.45));
      gr.addColorStop(1, rgba(col, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, r * 2, r * 2);
    });
  }
  function glow(ctx, x, y, col, r, a) {
    if (a <= 0) return;
    var s = glowSprite(col, r);
    var op = ctx.globalCompositeOperation, ga = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = ga * Math.min(1, a);
    ctx.drawImage(s, Math.round(x - s.width / 2), Math.round(y - s.height / 2));
    ctx.globalAlpha = ga;
    ctx.globalCompositeOperation = op;
  }
  function frameOf(t, fps, n) { var f = Math.floor((t || 0) * fps) % n; return f < 0 ? f + n : f; }
  function blit(ctx, img, x, y) { ctx.drawImage(img, Math.round(x), Math.round(y)); }

  // ---------------------------------------------------------------------------------------------
  // Pixelfont 5×7 (+ Unterlängen). Glyph: optionale Startzeile als erste Ziffer, Zeilen mit '/'.
  // Zeile 0–6 = Versalhöhe, 7–8 = Unterlänge. Proportional: Breite = längste Zeile.
  // ---------------------------------------------------------------------------------------------
  var GLYPHS = {
    'A': '.###./#...#/#...#/#####/#...#/#...#/#...#',
    'B': '####./#...#/#...#/####./#...#/#...#/####.',
    'C': '.###./#...#/#..../#..../#..../#...#/.###.',
    'D': '####./#...#/#...#/#...#/#...#/#...#/####.',
    'E': '#####/#..../#..../####./#..../#..../#####',
    'F': '#####/#..../#..../####./#..../#..../#....',
    'G': '.###./#...#/#..../#.###/#...#/#...#/.####',
    'H': '#...#/#...#/#...#/#####/#...#/#...#/#...#',
    'I': '###/.#./.#./.#./.#./.#./###',
    'J': '..###/...#./...#./...#./#..#./#..#./.##..',
    'K': '#...#/#..#./#.#../##.../#.#../#..#./#...#',
    'L': '#..../#..../#..../#..../#..../#..../#####',
    'M': '#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#',
    'N': '#...#/##..#/#.#.#/#..##/#...#/#...#/#...#',
    'O': '.###./#...#/#...#/#...#/#...#/#...#/.###.',
    'P': '####./#...#/#...#/####./#..../#..../#....',
    'Q': '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#',
    'R': '####./#...#/#...#/####./#.#../#..#./#...#',
    'S': '.####/#..../#..../.###./....#/....#/####.',
    'T': '#####/..#../..#../..#../..#../..#../..#..',
    'U': '#...#/#...#/#...#/#...#/#...#/#...#/.###.',
    'V': '#...#/#...#/#...#/#...#/#...#/.#.#./..#..',
    'W': '#...#/#...#/#...#/#.#.#/#.#.#/#.#.#/.#.#.',
    'X': '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
    'Y': '#...#/#...#/.#.#./..#../..#../..#../..#..',
    'Z': '#####/....#/...#./..#../.#.../#..../#####',
    // M0: Versal-Umlaute in voller Versalhöhe; '^' = Punkte eine Zeile ÜBER der Versalhöhe (Kopfzeile TEXT_HEAD)
    'Ä': '^#...#/.###./#...#/#...#/#####/#...#/#...#/#...#',
    'Ö': '^#...#/.###./#...#/#...#/#...#/#...#/#...#/.###.',
    'Ü': '^.#.#./#...#/#...#/#...#/#...#/#...#/#...#/.###.',
    'a': '2.###./....#/.####/#...#/.####',
    'b': '#..../#..../####./#...#/#...#/#...#/####.',
    'c': '2.###./#..../#..../#...#/.###.',
    'd': '....#/....#/.####/#...#/#...#/#...#/.####',
    'e': '2.###./#...#/#####/#..../.###.',
    'f': '..##/.#../####/.#../.#../.#../.#..',
    'g': '2.####/#...#/#...#/.####/....#/.###.',
    'h': '#..../#..../####./#...#/#...#/#...#/#...#',
    'i': '#/./#/#/#/#/#',
    'j': '..#/.../..#/..#/..#/..#/#.#/.#.',
    'k': '#.../#.../#..#/#.#./##../#.#./#..#',
    'l': '##./.#./.#./.#./.#./.#./..#',
    'm': '2##.#./#.#.#/#.#.#/#.#.#/#...#',
    'n': '2####./#...#/#...#/#...#/#...#',
    'o': '2.###./#...#/#...#/#...#/.###.',
    'p': '2####./#...#/#...#/####./#..../#....',
    'q': '2.####/#...#/#...#/.####/....#/....#',
    'r': '2#.##/##../#.../#.../#...',
    's': '2.####/#..../.###./....#/####.',
    't': '.#../.#../####/.#../.#../.#../..##',
    'u': '2#...#/#...#/#...#/#...#/.####',
    'v': '2#...#/#...#/#...#/.#.#./..#..',
    'w': '2#...#/#...#/#.#.#/#.#.#/.#.#.',
    'x': '2#...#/.#.#./..#../.#.#./#...#',
    'y': '2#...#/#...#/#...#/.####/....#/.###.',
    'z': '2#####/...#./..#../.#.../#####',
    'ä': '.#.#./...../.###./....#/.####/#...#/.####',
    'ö': '.#.#./...../.###./#...#/#...#/#...#/.###.',
    'ü': '.#.#./...../#...#/#...#/#...#/#...#/.####',
    'ß': '.##../#..#./#..#./#.##./#...#/#...#/#.##.',
    '0': '.###./#...#/#..##/#.#.#/##..#/#...#/.###.',
    '1': '..#../.##../..#../..#../..#../..#../.###.',
    '2': '.###./#...#/....#/...#./..#../.#.../#####',
    '3': '####./....#/....#/.###./....#/....#/####.',
    '4': '...#./..##./.#.#./#..#./#####/...#./...#.',
    '5': '#####/#..../####./....#/....#/#...#/.###.',
    '6': '.###./#..../#..../####./#...#/#...#/.###.',
    '7': '#####/....#/...#./..#../.#.../.#.../.#...',
    '8': '.###./#...#/#...#/.###./#...#/#...#/.###.',
    '9': '.###./#...#/#...#/.####/....#/....#/.###.',
    '.': '6#',
    ',': '6.#/#.',
    ':': '2#/./././#',
    ';': '2.#/../../.#/#.',
    '!': '#/#/#/#/#/./#',
    '?': '.###./#...#/....#/...#./..#../...../..#..',
    '-': '3####',
    '–': '3#####',
    '—': '3#######',
    '−': '3#####',
    '+': '1..#../..#../#####/..#../..#..',
    '×': '1#...#/.#.#./..#../.#.#./#...#',
    '=': '2#####/...../#####',
    '/': '....#/...#./...#./..#../.#.../.#.../#....',
    '\\': '#..../.#.../.#.../..#../...#./...#./....#',
    '(': '.#/#./#./#./#./#./.#',
    ')': '#./.#/.#/.#/.#/.#/#.',
    '[': '##/#./#./#./#./#./##',
    ']': '##/.#/.#/.#/.#/.#/##',
    '%': '##..#/##..#/...#./..#../.#.../#..##/#..##',
    '°': '.#./#.#/.#.',
    '·': '3#',
    '•': '2.#./###/.#.',
    '…': '6#.#.#',
    '"': '#.#/#.#',
    "'": '#/#',
    '„': '6.#.#/#.#.',
    '“': '.#.#/#.#.',
    '”': '#.#./.#.#',
    '‚': '6.#/#.',
    '‘': '.#/#.',
    '’': '#./.#',
    '<': '...#/..#./.#../#.../.#../..#./...#',
    '>': '#.../.#../..#./...#/..#./.#../#...',
    '_': '7#####',
    '#': '1.#.#./#####/.#.#./#####/.#.#.',
    '*': '1#.#.#/.###./#####/.###./#.#.#',
    '&': '.##../#..#./#.#../.#.../#.#.#/#..#./.##.#',
    '@': '.###./#...#/#.###/#.#.#/#.###/#..../.###.',
    '€': '..###/.#.../####./.#.../####./.#.../..###',
    '$': '..#../.####/#.#../.###./..#.#/####./..#..',
    '|': '#/#/#/#/#/#/#',
    '~': '3.#.#/#.#.',
    '^': '.#./#.#',
    '→': '1..#../...#./#####/...#./..#..',
    '←': '1..#../.#.../#####/.#.../..#..',
    '↑': '..#../.###./#.#.#/..#../..#../..#../..#..',
    '↓': '..#../..#../..#../..#../#.#.#/.###./..#..',
    '▲': '2..#../.###./#####',
    '▼': '2#####/.###./..#..',
    '♥': '1.#.#./#####/#####/.###./..#..',
    '₂': '4##./..#/.#./###',
    '²': '##./..#/.#./###',
    '³': '###/.##/..#/###',
  };
  var FONT_H = 9, LINE_H = 10;
  var TEXT_HEAD = 1;   // M0: 1 px Kopfraum im Textsprite für die Punkte der Versal-Umlaute (drawText gleicht aus)
  var glyphData = {};
  function parseGlyph(ch) {
    if (glyphData[ch]) return glyphData[ch];
    var src = GLYPHS[ch];
    if (src === undefined) {
      if (ch === ' ') { glyphData[ch] = { w: 3, top: 0, rows: [] }; return glyphData[ch]; }
      if (ch === ' ') { glyphData[ch] = { w: 3, top: 0, rows: [] }; return glyphData[ch]; }
      var up = ch.toUpperCase();
      if (up !== ch && GLYPHS[up]) return parseGlyph(up);
      // unbekanntes Zeichen: kleines Kästchen
      glyphData[ch] = { w: 4, top: 1, rows: ['####', '#..#', '#..#', '#..#', '#..#', '####'] };
      return glyphData[ch];
    }
    var top = 0;
    if (src[0] === '^') { top = -1; src = src.slice(1); }
    else if (/^[0-9]/.test(src) && src.length > 1 && src[1] !== '/') { top = +src[0]; src = src.slice(1); }
    var rows = src.split('/'), w = 0;
    for (var i = 0; i < rows.length; i++) w = Math.max(w, rows[i].length);
    glyphData[ch] = { w: w, top: top, rows: rows };
    return glyphData[ch];
  }
  function lineWidth(s) {
    var w = 0;
    for (var i = 0; i < s.length; i++) { w += parseGlyph(s[i]).w + (i < s.length - 1 ? 1 : 0); }
    return w;
  }
  function measureText(text, scale) {
    text = text == null ? '' : String(text);
    var lines = text.split('\n'), w = 0;
    for (var i = 0; i < lines.length; i++) w = Math.max(w, lineWidth(lines[i]));
    return w * (scale || 1);
  }
  var textCache = new SmallCache(600);
  function textSprite(text, color, shadow) {
    var key = text + '\u0001' + color + '\u0001' + (shadow || '');
    var c = textCache.get(key);
    if (c) return c;
    var lines = text.split('\n'), w = 1;
    for (var i = 0; i < lines.length; i++) w = Math.max(w, lineWidth(lines[i]));
    var sh = shadow ? 1 : 0;
    c = textCache.make(w + sh, lines.length * LINE_H + sh + TEXT_HEAD);
    var g = c.g;
    function paint(col, ox, oy) {
      g.fillStyle = col;
      for (var l = 0; l < lines.length; l++) {
        var s = lines[l], x = 0;
        for (var k = 0; k < s.length; k++) {
          var gl = parseGlyph(s[k]);
          for (var r = 0; r < gl.rows.length; r++) {
            var row = gl.rows[r];
            for (var q = 0; q < row.length; q++) if (row[q] === '#') g.fillRect(x + q + ox, l * LINE_H + gl.top + r + oy + TEXT_HEAD, 1, 1);
          }
          x += gl.w + 1;
        }
      }
    }
    if (shadow) paint(shadow, 1, 1);
    paint(color, 0, 0);
    textCache.set(key, c);
    return c;
  }
  function drawText(ctx, text, x, y, opts) {
    opts = opts || {};
    text = text == null ? '' : String(text);
    if (!text) return 0;
    var scale = opts.scale === 2 ? 2 : opts.scale === 3 ? 3 : 1;
    var color = opts.color || PAL.sternweiss;
    var shadow = opts.shadow ? (typeof opts.shadow === 'string' ? opts.shadow : 'rgba(11,14,26,0.85)') : null;
    var spr = textSprite(text, color, shadow);
    var w = (spr.width - (shadow ? 1 : 0)) * scale;
    var dx = x;
    if (opts.align === 'center') dx = x - Math.round(w / 2);
    else if (opts.align === 'right') dx = x - w;
    var dy = Math.round(y) - TEXT_HEAD * scale;
    if (scale === 1) ctx.drawImage(spr, Math.round(dx), dy);
    else ctx.drawImage(spr, Math.round(dx), dy, spr.width * scale, spr.height * scale);
    return w;
  }

  // ---------------------------------------------------------------------------------------------
  // Icons 12×12 (10×10-Maske + Outline). '#' Hauptfarbe, '+' hell, 'o' dunkel, 'w' weiß-ish
  // ---------------------------------------------------------------------------------------------
  var ICONS = {
    reactor: ['...####...', '..#....#..', '.#..++..#.', '#..+ww+..#', '#.+wwww+.#', '#.+wwww+.#', '#..+ww+..#', '.#..++..#.', '..#....#..', '...####...'],
    engines: ['oooooo....', 'o####o....', 'o#++#o+...', 'o####o++..', 'o#++#o+ww+', 'o####o+ww+', 'o#++#o++..', 'o####o+...', 'oooooo....', '..........'],
    shields: ['.########.', '#++++++++#', '#+######+#', '#+######+#', '#+######+#', '.#+####+#.', '.#+####+#.', '..#+##+#..', '...#++#...', '....##....'],
    weapons: ['....##....', '..##++##..', '.#..##..#.', '.#..##..#.', '#++####++#', '#++####++#', '.#..##..#.', '.#..##..#.', '..##++##..', '....##....'],
    life: ['....#.....', '...##.....', '..#++#....', '..#+#..#..', '.#++#.##..', '.#+#.#+#..', '.##.#++#..', '..##+##...', '...###....', '....#.....'],
    transfer: ['.#......#.', '#+#....#+#', '.#......#.', '...#..#...', '..#+##+#..', '..#+##+#..', '...#..#...', '.#......#.', '#+#....#+#', '.#......#.'],
    fire: ['....#.....', '...##.....', '...#+#..#.', '..#++#.##.', '.#++++##..', '.#+ww++#..', '#+wwww+#..', '#+wwww++#.', '.#+ww++#..', '..####....'],
    breach: ['#.......#.', '.#..#..#..', '..#.#.#...', '...ooo....', '#.ooooo.##', '..ooooo...', '...ooo....', '..#.#.#...', '.#..#..#..', '#.......#.'],
    o2: ['..####....', '.#....#...', '#..##..#..', '#.#..#.#..', '#.#..#.#..', '#..##..#..', '.#....#.##', '..####...#', '........#.', '.......###'],
    hull: ['##########', '#++++#+++#', '#+##+#+#+#', '##########', '#+#+++#++#', '#+#+##++##', '##########', '#++++#+++#', '#+##+#+#+#', '##########'],
    marks: ['..######..', '.#++++++#.', '#++####++#', '#+#+##+#+#', '#+#+##+#+#', '#+#+##+#+#', '#+#+##+#+#', '#++####++#', '.#++++++#.', '..######..'],
    circle: ['...####...', '.########.', '.########.', '##########', '##########', '##########', '##########', '.########.', '.########.', '...####...'],
    triangle: ['....##....', '....##....', '...####...', '...####...', '..######..', '..######..', '.########.', '.########.', '##########', '##########'],
    diamond: ['....##....', '...####...', '..######..', '.########.', '##########', '##########', '.########.', '..######..', '...####...', '....##....'],
    kreis: ['...####...', '.##....##.', '.#......#.', '#........#', '#........#', '#........#', '#........#', '.#......#.', '.##....##.', '...####...'],
    dreieck: ['....##....', '....##....', '...#..#...', '...#..#...', '..#....#..', '..#....#..', '.#......#.', '.#......#.', '#........#', '##########'],
    raute: ['....##....', '...#..#...', '..#....#..', '.#......#.', '#........#', '#........#', '.#......#.', '..#....#..', '...#..#...', '....##....'],
    stern: ['....##....', '....##....', '...####...', '##########', '.########.', '..######..', '..######..', '.###..###.', '.##....##.', '##......##'],
    welle: ['..........', '..........', '.##....##.', '#..#..#..#', '....##....', '..........', '.##....##.', '#..#..#..#', '....##....', '..........'],
    kreuz: ['##......##', '###....###', '.###..###.', '..######..', '...####...', '...####...', '..######..', '.###..###.', '###....###', '##......##'],
    lock: ['...####...', '..#....#..', '..#....#..', '..#....#..', '.########.', '.##++++##.', '.##+oo+##.', '.##++o+##.', '.##++++##.', '.########.'],
    arrow: ['....#.....', '....##....', '....###...', '#########.', '##########', '##########', '#########.', '....###...', '....##....', '....#.....'],
    ersatzteil: ['...#..#...', '..######..', '.##++++##.', '.#+#oo#+#.', '##+o..o+##', '##+o..o+##', '.#+#oo#+#.', '.##++++##.', '..######..', '...#..#...'],
    warn: ['....##....', '....##....', '...#oo#...', '...#oo#...', '..##oo##..', '..##oo##..', '.###..###.', '.###oo###.', '##########', '##########'],
    check: ['..........', '.........#', '........##', '.......##.', '#.....##..', '##...##...', '.##.##....', '..###.....', '...#......', '..........'],
    oda: ['..######..', '.#++++++#.', '#+o+..+o+#', '#+oo++oo+#', '#++++++++#', '#+######+#', '#+#+..+#+#', '.#######..', '..#.......', '.#........'],
    radio: ['.......#..', '..#....#..', '.#.#..#...', '#...#.#...', '.....##...', '....######', '....#++++#', '....#+oo+#', '....#++++#', '....######'],
    bot: ['....#.....', '....#.....', '.########.', '.#++++++#.', '.#o+##+o#.', '.#++++++#.', '.########.', '..######..', '.#+#+#+#+.', '.########.'],
    heart: ['..........', '.##...##..', '#++#.#++#.', '#+++#+++#.', '#+++++++#.', '.#+++++#..', '..#+++#...', '...#+#....', '....#.....', '..........'],
    medipack: ['...####...', '..#....#..', '##########', '#++++++++#', '#+++##+++#', '#+######+#', '#+######+#', '#+++##+++#', '#++++++++#', '##########'],
    star: ['....#.....', '....#.....', '...###....', '#########.', '.#######..', '..#####...', '..##.##...', '.##...##..', '.#.....#..', '..........'],
  };
  var ICON_COLORS = {
    reactor: PAL.mint, engines: PAL.bernstein, shields: PAL.eisblau, weapons: PAL.alarmrot, life: '#8FD06A',
    transfer: PAL.mint, fire: '#F08A3C', breach: PAL.eisblau, o2: PAL.eisblau, hull: PAL.paneelHell, marks: PAL.messing,
    circle: PLAYER[0], triangle: PLAYER[1], diamond: PLAYER[2], kreis: PAL.sternweiss, dreieck: PAL.sternweiss,
    raute: PAL.sternweiss, stern: PAL.sternweiss, welle: PAL.sternweiss, kreuz: PAL.sternweiss, lock: PAL.messing,
    arrow: PAL.bernstein, ersatzteil: PAL.messing, warn: PAL.warngelb, check: PAL.mint, oda: PAL.mint, radio: PAL.bernstein,
    bot: PAL.messing, heart: PAL.alarmrot, medipack: PAL.sternweiss, star: PAL.bernstein,
  };
  function iconSprite(name, col) {
    return cached('icon|' + name + '|' + col, 12, 12, function (g, c) {
      var m = ICONS[name];
      var map = { '#': col, '+': shade(col, 0.45), 'o': shade(col, -0.55), 'w': '#FFFFFF' };
      if (name === 'fire') { map['+'] = PAL.bernstein; map.w = PAL.funke; }
      if (name === 'reactor') { map.w = '#E8FFF8'; }
      if (name === 'medipack') { map['#'] = shade(col, -0.25); map['+'] = col; map.o = PAL.mint; }
      if (name === 'breach') { map.o = PAL.tiefraum; }
      if (name === 'warn') { map.o = PAL.outline; }
      grid(g, 1, 1, m, map);
      outline(c, mix(PAL.outline, col, 0.12));
    });
  }
  function drawIcon(ctx, name, x, y, opts) {
    opts = opts || {};
    if (!ICONS[name]) { missing(ctx, Math.round(x - 6), Math.round(y - 6), 12, 12); return; }
    var col = opts.color || ICON_COLORS[name] || PAL.sternweiss;
    var spr = iconSprite(name, col);
    var ang = opts.angle;
    if (ang == null && opts.dir) ang = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[opts.dir];
    var s = opts.scale || 1;
    if (ang) {
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      ctx.rotate(ang);
      ctx.drawImage(spr, -6 * s, -6 * s, 12 * s, 12 * s);
      ctx.restore();
    } else if (s !== 1) ctx.drawImage(spr, Math.round(x - 6 * s), Math.round(y - 6 * s), 12 * s, 12 * s);
    else ctx.drawImage(spr, Math.round(x - 6), Math.round(y - 6));
  }

  // ---------------------------------------------------------------------------------------------
  // Panels „Instrumententafel“
  // ---------------------------------------------------------------------------------------------
  var panelCache = new SmallCache(160);
  function rivet(g, x, y) { P(g, x, y, '#F1D9A0'); P(g, x + 1, y, PAL.messing); P(g, x, y + 1, PAL.messing); P(g, x + 1, y + 1, '#6E4E22'); }
  function buildPanel(w, h, style, title) {
    var c = mk(w, h), g = c.g;
    var br = PAL.messing, brL = '#E8C27A', brD = '#7A5A28', ol = '#20180F';
    if (style === 'plain') {
      R(g, 1, 1, w - 2, h - 2, 'rgba(22,28,40,0.94)');
      R(g, 1, 0, w - 2, 1, PAL.outline); R(g, 1, h - 1, w - 2, 1, PAL.outline); R(g, 0, 1, 1, h - 2, PAL.outline); R(g, w - 1, 1, 1, h - 2, PAL.outline);
      R(g, 1, 1, w - 2, 1, PAL.paneel); R(g, 1, 1, 1, h - 2, PAL.paneel);
      R(g, 1, h - 2, w - 2, 1, '#151B26'); R(g, w - 2, 1, 1, h - 2, '#151B26');
    } else {
      // Messingrahmen mit abgeschrägten Ecken
      R(g, 2, 0, w - 4, h, ol); R(g, 0, 2, w, h - 4, ol); R(g, 1, 1, w - 2, h - 2, ol);
      R(g, 2, 1, w - 4, h - 2, br); R(g, 1, 2, w - 2, h - 4, br);
      R(g, 2, 1, w - 4, 1, brL); R(g, 1, 2, 1, h - 4, brL);
      R(g, 2, h - 2, w - 4, 1, brD); R(g, w - 2, 2, 1, h - 4, brD);
      var inset = 4;
      var iw = w - inset * 2, ih = h - inset * 2;
      if (style === 'screen') {
        R(g, inset - 1, inset - 1, iw + 2, ih + 2, '#3A2A12');
        R(g, inset, inset, iw, ih, '#0E1D1C');
        var gr = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, Math.max(w, h) * 0.7);
        gr.addColorStop(0, 'rgba(127,224,194,0.10)');
        gr.addColorStop(1, 'rgba(0,0,0,0.25)');
        g.fillStyle = gr; g.fillRect(inset, inset, iw, ih);
        for (var yy = inset; yy < inset + ih; yy += 2) R(g, inset, yy, iw, 1, 'rgba(0,0,0,0.18)');
        // Ecken des Röhrenschirms abrunden
        R(g, inset, inset, 2, 1, '#3A2A12'); R(g, inset, inset, 1, 2, '#3A2A12');
        R(g, inset + iw - 2, inset, 2, 1, '#3A2A12'); R(g, inset + iw - 1, inset, 1, 2, '#3A2A12');
        R(g, inset, inset + ih - 1, 2, 1, '#3A2A12'); R(g, inset, inset + ih - 2, 1, 2, '#3A2A12');
        R(g, inset + iw - 2, inset + ih - 1, 2, 1, '#3A2A12'); R(g, inset + iw - 1, inset + ih - 2, 1, 2, '#3A2A12');
        R(g, inset + 2, inset + 1, Math.max(0, iw - 4), 1, 'rgba(127,224,194,0.25)');
      } else {
        R(g, inset - 1, inset - 1, iw + 2, ih + 2, '#3A2A12');
        R(g, inset, inset, iw, ih, PAL.stahl);
        R(g, inset, inset, iw, 1, '#3B4A5E');
        R(g, inset, inset + ih - 1, iw, 1, '#232D3B');
        for (var yy2 = inset + 3; yy2 < inset + ih; yy2 += 16) R(g, inset + 1, yy2, iw - 2, 1, 'rgba(255,255,255,0.03)');
      }
      // Nieten
      rivet(g, 2, 2); rivet(g, w - 4, 2); rivet(g, 2, h - 4); rivet(g, w - 4, h - 4);
      if (w > 80) for (var rx = 24; rx < w - 24; rx += 32) { rivet(g, rx, 1); rivet(g, rx, h - 3); }
      if (h > 80) for (var ry = 24; ry < h - 24; ry += 32) { rivet(g, 1, ry); rivet(g, w - 3, ry); }
    }
    if (title) {
      var tw = lineWidth(String(title)) + 10;
      var tx = 8;
      R(g, tx - 1, -0, tw + 2, 12, ol);
      R(g, tx, 0, tw, 11, style === 'plain' ? PAL.paneel : '#E3B565');
      R(g, tx, 0, tw, 1, '#F6D9A0');
      R(g, tx, 10, tw, 1, style === 'plain' ? '#36435A' : '#8A6530');
      g.drawImage(textSprite(String(title), style === 'plain' ? PAL.sternweiss : '#2B1D1A', null), tx + 5, 2 - TEXT_HEAD);
    }
    return c;
  }
  function drawPanel(ctx, x, y, w, h, opts) {
    opts = opts || {};
    w = Math.max(8, Math.round(w)); h = Math.max(8, Math.round(h));
    var style = opts.style === 'screen' || opts.style === 'plain' ? opts.style : 'brass';
    var key = style + '|' + w + '|' + h + '|' + (opts.title || '');
    var c = panelCache.get(key);
    if (!c) { c = buildPanel(w, h, style, opts.title); panelCache.set(key, c); }
    ctx.drawImage(c, Math.round(x), Math.round(y));
  }

  var Art = { errors: 0 };

  // ---------------------------------------------------------------------------------------------
  // KACHELN
  // ---------------------------------------------------------------------------------------------
  var FLOOR_CH = { '.': 'metal', ',': 'wood', '=': 'grate', '_': 'grate', 'N': 'metal', 'Q': 'metal', 'd': 'metal', 'P': 'metal', 'D': 'door', 'a': 'metal' };
  function isWallCh(c) { return c === '#' || c === 'V'; }   // M1: 'V' = dünne Wand im Wrack
  function isVoidCh(c) { return c === ' ' || c === '~' || c === undefined || c === null || c === ''; }
  function isOpenCh(c) { return !isWallCh(c) && !isVoidCh(c); }
  function envAt(env, x, y) {
    try { return env && env.map && env.map.at ? env.map.at(x, y) : ' '; } catch (e) { return ' '; }
  }
  // Biom-Code: 0 = Schiff, 1 = Bojenplattform, 2 = Wrack (M1). Wahrheitswert wie früher „plat“.
  function biomeOf(env) {
    if (env && env.biome === 'wreck') return 2;
    var m = env && env.map;
    if (!m) return 0;
    if (m.id === 'wreck') return 2;
    if (m.id === 'platform') return 1;
    if (m.id === 'ship') return 0;
    return m.at && (m.at(0, 0) === '~') ? 1 : 0;
  }

  // --- Böden ----------------------------------------------------------------------------------
  function floorMetal(g, v, plat) {
    if (plat === 2) { floorWreck(g, v, false); return; }
    var base = plat ? '#46566B' : '#56677E', hi = plat ? '#58697F' : '#6C7F96', lo = plat ? '#344255' : '#3F4D61', seam = plat ? '#28323F' : '#323E4F';
    var r = rng(1000 + v * 17 + (plat ? 500 : 0));
    R(g, 0, 0, 32, 32, base);
    for (var py = 0; py < 2; py++) for (var px = 0; px < 2; px++) {
      var x = px * 16, y = py * 16, tone = r() < 0.3 ? shade(base, -0.06) : (r() < 0.2 ? shade(base, 0.04) : base);
      R(g, x, y, 16, 16, tone);
      R(g, x, y, 16, 1, hi); R(g, x, y, 1, 16, hi);
      R(g, x, y + 15, 16, 1, seam); R(g, x + 15, y, 1, 16, seam);
      R(g, x + 1, y + 14, 14, 1, lo);
      if (plat) {
        // Riffelblech (Tränenmuster)
        for (var yy = 3; yy < 14; yy += 4) for (var xx = 3 + ((yy >> 2) & 1) * 2; xx < 14; xx += 4) {
          P(g, x + xx, y + yy, hi); P(g, x + xx + 1, y + yy + 1, lo);
        }
      } else {
        P(g, x + 2, y + 2, '#8FA2B6'); P(g, x + 13, y + 2, '#8FA2B6'); P(g, x + 2, y + 13, lo); P(g, x + 13, y + 13, lo);
      }
    }
    // Gebrauchsspuren
    var n = 2 + (r() * 3 | 0);
    for (var i = 0; i < n; i++) { var sx = r() * 28 | 0, sy = r() * 30 | 0; R(g, sx, sy, 2 + (r() * 3 | 0), 1, shade(base, -0.1)); }
  }
  function floorWood(g, v) {
    var tones = ['#8A5A3B', '#94633F', '#7F5236', '#8F5E3C', '#86573A'];
    var r = rng(2000 + v * 31);
    for (var p = 0; p < 4; p++) {
      var y = p * 8, t = tones[(r() * tones.length) | 0];
      R(g, 0, y, 32, 8, t);
      R(g, 0, y, 32, 1, shade(t, 0.14));
      R(g, 0, y + 7, 32, 1, '#5A3824');
      // Maserung
      for (var k = 0; k < 3; k++) {
        var gx = r() * 28 | 0, gy = y + 2 + (r() * 4 | 0);
        R(g, gx, gy, 3 + (r() * 6 | 0), 1, shade(t, -0.12));
      }
      if (r() < 0.25) { var kx = 4 + r() * 24 | 0; P(g, kx, y + 3, shade(t, -0.25)); P(g, kx + 1, y + 3, shade(t, -0.15)); }
      // Stoß
      var ex = 4 + (r() * 24 | 0);
      R(g, ex, y + 1, 1, 6, '#5A3824');
      if (r() < 0.3) { P(g, ex - 2, y + 3, '#5E3B26'); P(g, ex + 2, y + 4, '#5E3B26'); }
    }
  }
  function floorGrate(g, v, plat) {
    if (plat === 2) { floorWreck(g, v, true); return; }
    R(g, 0, 0, 32, 32, '#161C26');
    var r = rng(3000 + v * 13);
    // Rohre unter dem Gitter
    if (v === 0 && !plat) { R(g, 0, 19, 32, 5, '#4A2A22'); R(g, 0, 19, 32, 1, '#7E3A28'); }
    if (v === 2) { R(g, 0, 7, 32, 3, plat ? '#24404A' : '#1F4A40'); R(g, 0, 7, 32, 1, plat ? '#4E7A8A' : '#3E9C80'); }
    // Gitterstäbe
    var bar = plat ? '#4A586B' : '#4E5F75', barHi = plat ? '#63748A' : '#66798F', barLo = '#2A3442';
    for (var x = 0; x < 32; x += 4) { R(g, x, 0, 1, 32, bar); }
    for (var y = 0; y < 32; y += 8) { R(g, 0, y, 32, 2, bar); R(g, 0, y, 32, 1, barHi); R(g, 0, y + 2, 32, 1, barLo); }
    // Rahmen
    R(g, 0, 0, 32, 1, barHi); R(g, 0, 0, 1, 32, barHi); R(g, 31, 0, 1, 32, barLo); R(g, 0, 31, 32, 1, barLo);
    P(g, 2, 2, '#9FB2C4'); P(g, 29, 2, '#9FB2C4'); P(g, 2, 29, barLo); P(g, 29, 29, barLo);
    if (r() < 0.5) R(g, 12 + (r() * 10 | 0), 13, 3, 1, 'rgba(255,198,107,0.35)');
  }
  function addFloorShadow(g, sN, sW, sNW) {
    if (sN) { var a = [0.42, 0.3, 0.2, 0.12, 0.06]; for (var i = 0; i < a.length; i++) R(g, 0, i, 32, 1, 'rgba(11,14,26,' + a[i] + ')'); }
    if (sW) { var b = [0.28, 0.16, 0.07]; for (var j = 0; j < b.length; j++) R(g, j, sN ? 5 : 0, 1, sN ? 27 : 32, 'rgba(11,14,26,' + b[j] + ')'); }
    if (sNW && !sN && !sW) { R(g, 0, 0, 3, 3, 'rgba(11,14,26,0.25)'); }
  }
  function floorSprite(type, v, plat, sN, sW, sNW) {
    var key = 'floor|' + type + '|' + v + '|' + (+plat) + '|' + (sN ? 1 : 0) + (sW ? 1 : 0) + (sNW ? 1 : 0);
    return cached(key, 32, 32, function (g) {
      if (type === 'grateLit') floorGrateLit(g, v);
      else if (type === 'gunDeck') floorGunDeck(g, v);
      else if (type.indexOf('q_') === 0) floorQuarter(g, type.slice(2), v);
      else if (type === 'wood') floorWood(g, v);
      else if (type === 'grate') floorGrate(g, v, plat);
      else floorMetal(g, v, plat);
      addFloorShadow(g, sN, sW, sNW);
    });
  }
  var floorForMemo = new Map();
  function floorTypeAround(env) {
    var m = env.map, key = (m && m.id || '?') + ':' + env.tx + ':' + env.ty;
    var hit = floorForMemo.get(key);
    if (hit) return hit;
    var counts = { metal: 0, wood: 0, grate: 0 };
    var d = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1], [-2, 0], [2, 0], [0, 2]];
    for (var i = 0; i < d.length; i++) {
      var c = envAt(env, env.tx + d[i][0], env.ty + d[i][1]);
      var t = FLOOR_CH[c];
      if (t && t !== 'door') counts[t] += i < 4 ? 2 : 1;
    }
    var best = 'metal';
    if (counts.wood > counts[best]) best = 'wood';
    if (counts.grate > counts[best]) best = 'grate';
    floorForMemo.set(key, best);
    return best;
  }
  function drawFloorAt(ctx, type, px, py, env, plat) {
    var tx = env.tx | 0, ty = env.ty | 0;
    var n = envAt(env, tx, ty - 1), w = envAt(env, tx - 1, ty), nw = envAt(env, tx - 1, ty - 1);
    var sN = isWallCh(n), sW = isWallCh(w), sNW = isWallCh(nw);
    var v = (hash2(tx, ty, 7) * 4) | 0;
    if (plat === 2) v = (hash2(tx, ty, 7) * 16) | 0;
    var qs = env.roomStyle && env.roomStyle.floor;   // M1: Quartier-Bodenstil
    if (qs && QUARTER_FLOORS[qs] && (type === 'wood' || type === 'metal')) type = 'q_' + qs;
    if (plat && type === 'metal' && hash2(tx, ty, 9) < 0.07) type = 'grate';
    var room = type === 'grate' ? shipRoomAt(env, tx, ty) : null;   // M3a: Raum aus dem Schiffslayout
    var engRoom = room && room.kind === 'engine' ? room : null;
    var eng = !!engRoom, gun = !eng && isGunDeck(room);
    if (eng) type = 'grateLit';   // M0: Bodenlicht in Bernstein unter dem Gitter
    else if (gun) type = 'gunDeck';   // M3a: Batteriedecks als Geschützdeck
    ctx.drawImage(floorSprite(type, v, plat, sN, sW, sNW), px, py);
    if (eng) { if (!engineFloorDetailM3(ctx, px, py, tx, ty, env.time || 0, engRoom)) engineFloorDetail(ctx, px, py, tx, ty, env.time || 0, engRoom); }
    else if (gun) gunDeckDetail(ctx, px, py, tx, ty, env.time || 0, room);
  }

  // --- Wände (3/4-Ansicht: Kappe + Front) -------------------------------------------------------
  var CAP_H = 12;
  function faceKindFor(env, tx, ty, plat) {
    if (plat === 2) return 'wreck';
    if (plat) return 'plat';
    var c = envAt(env, tx, ty + 1);
    var t = FLOOR_CH[c];
    if (t === 'wood') return 'wood';
    if (t === 'grate') return 'grate';
    if (t === 'metal') return 'metal';
    // Objekt/Tür unter der Wand: Raumtyp der Umgebung
    return floorTypeAround({ map: env.map, tx: tx, ty: ty + 1 });
  }
  function buildWall(g, k) {
    var plat = k.plat;
    var capBase = plat ? '#2A3542' : '#2E3946', capIn = plat ? '#333F4E' : '#384555', capRim = plat ? '#7D97AD' : '#7A8DA4';
    if (plat === 2) { capBase = '#1D232C'; capIn = '#242B35'; capRim = '#56606C'; }
    var capH = k.face ? CAP_H : 32;
    // Kappe
    R(g, 0, 0, 32, capH, capBase);
    R(g, 2, 2, 28, capH - 4 > 0 ? capH - 4 : 1, capIn);
    if (!k.face) {
      // Längsfuge + Nieten auf großen Kappen
      R(g, 2, 15, 28, 1, capBase); R(g, 15, 2, 1, 28, capBase);
      P(g, 4, 4, '#4C5A6C'); P(g, 27, 4, '#4C5A6C'); P(g, 4, 27, '#4C5A6C'); P(g, 27, 27, '#4C5A6C');
    } else {
      P(g, 4, 5, '#4C5A6C'); P(g, 27, 5, '#4C5A6C');
    }
    // Ränder zu offenen Nachbarn (Licht von oben links)
    if (k.oN) { R(g, 0, 0, 32, 1, capRim); }
    if (k.oW) { R(g, 0, 0, 1, capH, capRim); }
    if (k.oE) { R(g, 31, 0, 1, capH, shade(capRim, -0.3)); }
    if (!k.face && k.oS) { R(g, 0, 31, 32, 1, '#1A212C'); R(g, 0, 30, 32, 1, shade(capRim, -0.35)); }
    // Außenhülle zu Leere/Weltraum
    var hullCol = plat === 2 ? '#6E3A22' : plat ? '#F2C94C' : PAL.terrakotta, edge = '#121822';
    if (k.vN) { R(g, 0, 0, 32, 2, edge); if (plat) { for (var i = 0; i < 32; i += 6) R(g, i, 3, 3, 1, hullCol); } else R(g, 0, 3, 32, 1, hullCol); }
    if (k.vS && !k.face) { R(g, 0, 30, 32, 2, edge); if (plat) { for (var i2 = 0; i2 < 32; i2 += 6) R(g, i2, 28, 3, 1, hullCol); } else R(g, 0, 28, 32, 1, hullCol); }
    if (k.vW) { R(g, 0, 0, 2, capH, edge); if (plat) { for (var j = 0; j < capH; j += 6) R(g, 3, j, 1, 3, hullCol); } else R(g, 3, k.vN ? 3 : 0, 1, capH - (k.vN ? 3 : 0) - (k.vS && !k.face ? 4 : 0), hullCol); }
    if (k.vE) { R(g, 30, 0, 2, capH, edge); if (plat) { for (var j2 = 0; j2 < capH; j2 += 6) R(g, 28, j2, 1, 3, hullCol); } else R(g, 28, k.vN ? 3 : 0, 1, capH - (k.vN ? 3 : 0) - (k.vS && !k.face ? 4 : 0), hullCol); }
    if (k.face) {
      R(g, 0, capH - 1, 32, 1, capRim);          // vordere Kappenkante im Licht
      var y0 = capH, fh = 32 - capH;
      if (k.face === 'wood') {
        var tones = ['#7A4E33', '#6E4630', '#835537', '#744A31'];
        for (var bx = 0; bx < 32; bx += 4) {
          var t = tones[(bx >> 2) % 4];
          R(g, bx, y0, 4, fh, t);
          R(g, bx, y0, 1, fh, shade(t, 0.12));
          R(g, bx + 3, y0, 1, fh, shade(t, -0.18));
        }
        R(g, 0, y0, 32, 3, '#5E6E80'); R(g, 0, y0, 32, 1, '#7F92A6');          // Lichtleiste-Gehäuse
        R(g, 0, y0 + 8, 32, 2, PAL.messing); R(g, 0, y0 + 8, 32, 1, '#EAC786'); R(g, 0, y0 + 10, 32, 1, '#6E4E22'); // Messingleiste
        P(g, 8, y0 + 13, '#4A2E1E'); P(g, 24, y0 + 13, '#4A2E1E');
      } else if (k.face === 'grate') {
        R(g, 0, y0, 32, fh, '#3A4759');
        R(g, 0, y0, 32, 3, '#4C5C70'); R(g, 0, y0, 32, 1, '#6A7E96');
        R(g, 15, y0 + 3, 1, fh - 3, '#2B3646'); R(g, 16, y0 + 3, 1, fh - 3, '#4A5A6E');
        // Rohrleitung
        R(g, 0, y0 + 6, 32, 5, '#7E3A28'); R(g, 0, y0 + 6, 32, 2, PAL.terrakotta); R(g, 0, y0 + 6, 32, 1, '#D77A5C');
        R(g, 6, y0 + 5, 3, 7, PAL.messing); R(g, 6, y0 + 5, 1, 7, '#EAC786'); R(g, 22, y0 + 5, 3, 7, PAL.messing); R(g, 22, y0 + 5, 1, 7, '#EAC786');
        R(g, 0, y0 + 13, 32, 2, '#2E6E5C'); R(g, 0, y0 + 13, 32, 1, PAL.mint);
      } else if (QUARTER_FACE[k.face]) {
        QUARTER_FACE[k.face](g, y0, fh);
      } else if (k.face === 'wreck') {
        wallFaceWreck(g, y0, fh, k);
      } else if (k.face === 'plat') {
        R(g, 0, y0, 32, fh, '#3B4A5E');
        R(g, 0, y0, 32, 3, '#4B5C72'); R(g, 0, y0, 32, 1, '#7D97AD');
        R(g, 0, y0 + 3, 1, fh - 3, '#56687F'); R(g, 15, y0 + 3, 1, fh - 3, '#2C3848'); R(g, 16, y0 + 3, 1, fh - 3, '#56687F');
        for (var cx = -4; cx < 32; cx += 8) { for (var q = 0; q < 3; q++) { R(g, cx + q, y0 + 12 + q, 4, 1, '#F2C94C'); R(g, cx + q + 4, y0 + 12 + q, 4, 1, '#1F2630'); } }
        R(g, 0, y0 + 11, 32, 1, '#2C3848'); R(g, 0, y0 + 15, 32, 1, '#2C3848');
        P(g, 4, y0 + 6, PAL.eisblau); P(g, 20, y0 + 6, PAL.eisblau);
      } else {
        R(g, 0, y0, 32, fh, PAL.paneel);
        R(g, 0, y0, 32, 3, '#5E7088'); R(g, 0, y0, 32, 1, '#8195AC');
        R(g, 15, y0 + 3, 1, fh - 3, '#3B4A5E'); R(g, 16, y0 + 3, 1, fh - 3, '#647891'); R(g, 0, y0 + 3, 1, fh - 3, '#647891');
        R(g, 0, y0 + 10, 32, 1, '#3E4D61'); R(g, 0, y0 + 11, 32, 1, '#5E7088');
        P(g, 3, y0 + 6, '#93A6BA'); P(g, 12, y0 + 6, '#93A6BA'); P(g, 19, y0 + 6, '#93A6BA'); P(g, 28, y0 + 6, '#93A6BA');
        R(g, 5, y0 + 13, 6, 2, '#3E4D61'); R(g, 21, y0 + 13, 6, 2, '#3E4D61');  // Lüftungsschlitze
      }
      // Sockelleiste
      R(g, 0, 29, 32, 2, k.face === 'wood' ? '#4A2E1E' : '#28313F'); R(g, 0, 31, 32, 1, '#161B24');
      // Bullauge
      if (k.port) {
        var pcx = 16, pcy = y0 + 9;
        ell(g, pcx, pcy, 7, 7, '#5A4018'); ell(g, pcx, pcy, 6, 6, PAL.messing); ell(g, pcx - 0.5, pcy - 0.5, 5, 5, '#EAC786');
        ell(g, pcx, pcy, 4.6, 4.6, '#0C1226'); ell(g, pcx + 1, pcy + 1, 3, 3, '#141D3A');
        var r = rng(k.port * 97);
        for (var s = 0; s < 3; s++) P(g, pcx - 3 + (r() * 6 | 0), pcy - 3 + (r() * 6 | 0), s === 0 ? PAL.sternweiss : '#8FA0C8');
        P(g, pcx - 3, pcy - 2, '#6A86A8'); P(g, pcx - 2, pcy - 3, '#6A86A8');
      }
    }
    if (plat === 2) wreckWallDamage(g, k, capH);
    // Ecken zur Leere abschrägen (Bugform, abgerundete Außenkanten)
    function cut(corner) {
      var C = 9;
      for (var yy = 0; yy < C; yy++) {
        var len = C - yy;
        var y = (corner === 'NE' || corner === 'NW') ? yy : 31 - yy;
        var x = (corner === 'NE' || corner === 'SE') ? 32 - len : 0;
        g.clearRect(x, y, len, 1);
        var ex = (corner === 'NE' || corner === 'SE') ? x - 1 : len;
        P(g, ex, y, edge);
        P(g, (corner === 'NE' || corner === 'SE') ? ex - 1 : ex + 1, y, edge);
        P(g, (corner === 'NE' || corner === 'SE') ? ex - 2 : ex + 2, y, plat ? '#F2C94C' : PAL.terrakotta);
      }
    }
    if (k.cNE) cut('NE');
    if (k.cNW) cut('NW');
    if (k.cSE) cut('SE');
    if (k.cSW) cut('SW');
  }
  function wallSprite(env, tx, ty, plat) {
    var at = function (dx, dy) { return envAt(env, tx + dx, ty + dy); };
    var n = at(0, -1), s = at(0, 1), e = at(1, 0), w = at(-1, 0);
    var k = {
      plat: plat,
      oN: isOpenCh(n), oS: isOpenCh(s), oE: isOpenCh(e), oW: isOpenCh(w),
      vN: isVoidCh(n), vS: isVoidCh(s), vE: isVoidCh(e), vW: isVoidCh(w),
      face: null, port: 0, v: plat === 2 ? ((hash2(tx, ty, 21) * 4) | 0) : 0,
    };
    if (k.oS) k.face = faceKindFor(env, tx, ty, plat);
    if (k.face && !plat) {   // M1: Wandstil eines Quartiers (direkt übergeben oder vom Boden darunter gemerkt)
      var ws = (env.roomStyle && env.roomStyle.wall) || roomStyleMemo.get(tx + ',' + (ty + 1));
      if (ws && QUARTER_WALLS[ws]) k.face = QUARTER_WALLS[ws];
    }
    k.cNE = k.vN && k.vE && isVoidCh(at(1, -1));
    k.cNW = k.vN && k.vW && isVoidCh(at(-1, -1));
    k.cSE = k.vS && k.vE && isVoidCh(at(1, 1)) && !k.face;
    k.cSW = k.vS && k.vW && isVoidCh(at(-1, 1)) && !k.face;
    if (k.face && k.vN && !plat && (tx % 3 === 1) && !isOpenCh(at(0, 1)) === false && FLOOR_CH[s]) k.port = 1 + (tx % 7);
    if (k.face && k.vN && plat && (tx % 4 === 2) && FLOOR_CH[s]) k.port = 1 + (tx % 5);
    var key = 'wall|' + (+plat) + '|' + k.face + '|' + (+k.oN) + (+k.oS) + (+k.oE) + (+k.oW) + (+k.vN) + (+k.vS) + (+k.vE) + (+k.vW) +
      (+k.cNE) + (+k.cNW) + (+k.cSE) + (+k.cSW) + '|' + k.port + '|' + k.v;
    return { spr: cached(key, 32, 32, function (g) { buildWall(g, k); }), face: !!k.face };
  }
  // Lichtleiste (Wandleiste) – reagiert auf Alarmstufe
  var stripMemo = {};
  function stripColor(alert, time) {
    var col, a;
    if (alert === 'red') { col = PAL.alarmrot; a = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(time * Math.PI * 2)); }
    else if (alert === 'yellow') { col = PAL.warngelb; a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * Math.PI)); }
    else { col = PAL.bernstein; a = 0.7; }
    var q = Math.round(a * 12);
    var key = col + q;
    return stripMemo[key] || (stripMemo[key] = rgba(col, q / 12));
  }

  // --- Türen, Pads, Weltraum --------------------------------------------------------------------
  function doorSprite(orient, plat, floorType, v) {
    return cached('door|' + orient + '|' + (+plat) + '|' + floorType + '|' + v, 32, 32, function (g) {
      if (floorType === 'wood') floorWood(g, v); else if (floorType === 'grate') floorGrate(g, v, plat); else floorMetal(g, v, plat);
      var capBase = plat ? '#2A3542' : '#2E3946', rim = plat ? '#7D97AD' : '#7A8DA4', jamb = plat ? '#3B4A5E' : PAL.paneel;
      if (orient === 'h') {
        // Durchgang in horizontaler Wand: Sturz oben, Pfosten seitlich
        R(g, 0, 0, 32, 6, capBase); R(g, 0, 0, 32, 1, rim); R(g, 0, 5, 32, 1, rim);
        R(g, 13, 2, 6, 2, '#1A3A33'); R(g, 14, 2, 4, 1, PAL.mint); // Statuslicht offen
        for (var i = 0; i < 26; i++) R(g, 3, 6 + i, 26, 1, 'rgba(11,14,26,' + Math.max(0, 0.35 - i * 0.03) + ')');
        R(g, 0, 6, 4, 26, jamb); R(g, 0, 6, 1, 26, rim); R(g, 3, 6, 1, 26, '#2A3442');
        R(g, 28, 6, 4, 26, jamb); R(g, 28, 6, 1, 26, '#2A3442'); R(g, 31, 6, 1, 26, shade(rim, -0.3));
        R(g, 4, 6, 2, 24, PAL.messing); R(g, 4, 6, 1, 24, '#EAC786'); R(g, 26, 6, 2, 24, '#8A6530'); R(g, 27, 6, 1, 24, PAL.messing);
        for (var x = 6; x < 26; x += 4) { R(g, x, 29, 2, 2, PAL.warngelb); R(g, x + 2, 29, 2, 2, '#232A35'); }
      } else {
        // Durchgang in vertikaler Wand: Schwelle mit Warnstreifen, Laufschienen
        R(g, 0, 0, 32, 3, '#1E2631'); R(g, 0, 29, 32, 3, capBase); R(g, 0, 29, 32, 1, rim);
        R(g, 0, 3, 32, 2, 'rgba(11,14,26,0.35)');
        for (var y = 5; y < 29; y += 4) { R(g, 1, y, 2, 2, PAL.warngelb); R(g, 1, y + 2, 2, 2, '#232A35'); R(g, 29, y, 2, 2, PAL.warngelb); R(g, 29, y + 2, 2, 2, '#232A35'); }
        R(g, 15, 3, 2, 26, 'rgba(11,14,26,0.25)');
        R(g, 6, 0, 20, 2, PAL.messing); R(g, 6, 0, 20, 1, '#EAC786');
        R(g, 14, 30, 4, 1, PAL.mint);
      }
    });
  }
  function padSprite(f, plat) {
    return cached('pad|' + f + '|' + (+plat), 32, 32, function (g) {
      var pulse = 0.5 + 0.5 * Math.sin(f / 8 * Math.PI * 2);
      ell(g, 16, 17.5, 14, 12, '#1E2631');                       // Sockel (3/4-Dicke)
      ell(g, 16, 16, 14, 12, '#7A5A28');
      ell(g, 16, 15.5, 13, 11, PAL.messing);
      ell(g, 15.5, 15, 12, 10, '#E3B565');
      ell(g, 16, 15.5, 10.5, 8.6, '#3A2A12');
      ell(g, 16, 15.5, 10, 8, '#25303E');
      ell(g, 16, 15.5, 7.5, 6, '#2C5E52');
      ell(g, 16, 15.5, 6.5, 5, '#1B2A2E');
      ell(g, 16, 15.5, 4.5, 3.5, mix('#2C5E52', PAL.mint, pulse));
      ell(g, 16, 15.5, 2.5, 2, mix(PAL.mint, '#E8FFF8', pulse));
      // Bernstein-Lichter am Ring
      var lit = mix('#8A6530', PAL.bernstein, 0.4 + 0.6 * pulse);
      P(g, 16, 4, lit); P(g, 16, 27, lit); P(g, 3, 15, lit); P(g, 28, 15, lit);
      P(g, 7, 7, '#F6D9A0'); P(g, 8, 6, '#F6D9A0');
      // Rillen
      for (var a = 0; a < 6; a++) { var an = a / 6 * Math.PI * 2 + f * 0.1; P(g, 16 + Math.cos(an) * 8.5, 15.5 + Math.sin(an) * 7, plat ? PAL.eisblau : PAL.mint); }
    });
  }
  function spaceSprite(v, tw) {
    return cached('space|' + v + '|' + tw, 32, 32, function (g) {
      R(g, 0, 0, 32, 32, PAL.tiefraum);
      var r = rng(4000 + v * 7);
      var n = 1 + (r() * 3 | 0);
      for (var i = 0; i < n; i++) {
        var x = r() * 32 | 0, y = r() * 32 | 0, b = r();
        P(g, x, y, b > 0.7 ? PAL.sternweiss : b > 0.35 ? '#8E94B8' : '#4B5078');
      }
      if (r() < 0.35) {
        var sx = 4 + (r() * 24 | 0), sy = 4 + (r() * 24 | 0), on = tw ? 0.4 : 1;
        P(g, sx, sy, PAL.sternweiss);
        if (on > 0.5) { P(g, sx - 1, sy, '#9AA0C8'); P(g, sx + 1, sy, '#9AA0C8'); P(g, sx, sy - 1, '#9AA0C8'); P(g, sx, sy + 1, '#9AA0C8'); }
      }
    });
  }

  // Merker für 2×2-/Mehrkachel-Objekte: drawTile merkt sich die Lage, drawObject liest sie an derselben Pixelposition.
  var tileMemo = new Map();
  function memoKey(px, py) { return (Math.round(px) * 8192 + Math.round(py)) | 0; }

  function drawTile(ctx, ch, px, py, env) {
    env = env || {};
    px = Math.round(px); py = Math.round(py);
    var tx = env.tx | 0, ty = env.ty | 0, time = env.time || 0;
    if (isKeshEnv(env)) { drawTileKesh(ctx, ch, px, py, env); return; }   // M2: Mond Kesh
    var plat = biomeOf(env);
    if (ch === ' ' || ch === undefined || ch === null) return;           // Leere: nichts (Sternenhimmel des Clients scheint durch)
    if (plat === 0 && env.map && env.map.id === 'ship') rememberRoomStyle(env, tx, ty, ch);   // M1: Wandstil für die Wand darüber
    if (ch === 'V') {   // M1: dünne Wand (Wrack) – als Wand zeichnen, Lage für drawObject('wall_weak') merken
      var wv = wallSprite(env, tx, ty, plat);
      ctx.drawImage(wv.spr, px, py);
      tileMemo.set(memoKey(px, py), { ch: 'V', spr: wv.spr, face: wv.face, v: (hash2(tx, ty, 7) * 8) | 0 });
      if (wv.face) wreckStrip(ctx, px, py, tx, ty, time);
      return;
    }
    if (ch === '~') {
      var v = (hash2(tx, ty, 3) * 8) | 0;
      var tw = ((time * 1.3 + hash2(tx, ty, 5) * 4) | 0) % 2;
      ctx.drawImage(spaceSprite(v, tw), px, py);
      return;
    }
    if (ch === '#') {
      var w = wallSprite(env, tx, ty, plat);
      ctx.drawImage(w.spr, px, py);
      if (w.face && plat === 2) { wreckStrip(ctx, px, py, tx, ty, time); return; }
      if (w.face) {
        if (isEngineBackWall(env, tx, ty)) engineWallDetail(ctx, px, py, tx, time, env.alert);   // M0
        ctx.fillStyle = stripColor(env.alert, time);
        ctx.fillRect(px, py + CAP_H + 1, 32, 1);
        if (env.alert === 'red' || env.alert === 'yellow') ctx.fillRect(px + 4, py + CAP_H + 2, 24, 1);
      }
      return;
    }
    if (ch === '^' || ch === '!' || ch === ':') { drawDeckTileM4(ctx, ch, px, py, env, plat); return; }   // M4: Lift, Leiter, Mosaik
    var ft = FLOOR_CH[ch];
    if (ft === 'door') {
      var orient = (isWallCh(envAt(env, tx - 1, ty)) && isWallCh(envAt(env, tx + 1, ty))) ? 'h' : 'v';
      var ftd = floorTypeAround(env);
      ctx.drawImage(doorSprite(orient, plat, ftd, (hash2(tx, ty, 7) * 4) | 0), px, py);
      return;
    }
    if (ft) {
      drawFloorAt(ctx, ft === 'door' ? 'metal' : ft, px, py, env, plat);
      if (ch === 'P') ctx.drawImage(padSprite(frameOf(time, 6, 8), plat), px, py);
      if (plat === 2) wreckFloorDetail(ctx, px, py, tx, ty, time);
      return;
    }
    // Objektkachel: passenden Boden darunter, Lage für Mehrkachel-Objekte merken
    drawFloorAt(ctx, floorTypeAround(env), px, py, env, plat);
    if (ch === 'b' || ch === 'm' || ch === 'L' || ch === 'Y') {
      var info = { ch: ch };
      if (ch === 'b') { info.qx = envAt(env, tx - 1, ty) === 'b' ? 1 : 0; info.qy = envAt(env, tx, ty - 1) === 'b' ? 1 : 0; }
      if (ch === 'Y') { info.qx = envAt(env, tx - 1, ty) === 'Y' ? 1 : 0; info.qy = envAt(env, tx, ty - 1) === 'Y' ? 1 : 0; }
      if (ch === 'm') { info.l = envAt(env, tx - 1, ty) === 'm'; info.r = envAt(env, tx + 1, ty) === 'm'; }
      if (ch === 'L') { info.orient = (isWallCh(envAt(env, tx, ty - 1)) && isWallCh(envAt(env, tx, ty + 1))) ? 'v' : 'h'; }
      tileMemo.set(memoKey(px, py), info);
      if (tileMemo.size > 4000) tileMemo.clear();
    }
  }

  // ---------------------------------------------------------------------------------------------
  // OBJEKTE (Sprites 32×48: untere 32 px = Kachel, obere 16 px = Überstand)
  // ---------------------------------------------------------------------------------------------
  var OH = 16;   // Überstand nach oben
  function finish(c, ol, sh) {   // Outline + Bodenschatten (hinter das Objekt)
    outline(c, ol || PAL.outline);
    if (sh) {
      var g = c.g;
      g.globalCompositeOperation = 'destination-over';
      ell(g, sh[0], sh[1], sh[2], sh[3], 'rgba(11,14,26,0.35)');
      g.globalCompositeOperation = 'source-over';
    }
  }
  function screenGlass(g, x, y, w, h, base) {
    R(g, x, y, w, h, base || '#0E1D1C');
    P(g, x, y, '#2A2014'); P(g, x + w - 1, y, '#2A2014'); P(g, x, y + h - 1, '#2A2014'); P(g, x + w - 1, y + h - 1, '#2A2014');
  }
  function scanlines(g, x, y, w, h) { for (var yy = y + 1; yy < y + h; yy += 2) R(g, x, yy, w, 1, 'rgba(0,0,0,0.22)'); }
  function led(g, x, y, col, on) { P(g, x, y, on ? col : shade(col, -0.6)); if (on) P(g, x, y - 1, shade(col, 0.5)); }

  // --- Konsolen ---------------------------------------------------------------------------------
  var CONSOLE_STYLE = {
    console_helm: { body: '#4F6178', scr: PAL.mint },
    console_captain: { body: '#4F6178', scr: PAL.bernstein },
    console_weapons: { body: '#4F6178', scr: '#FF8A5C' },
    console_transfer: { body: '#4F6178', scr: PAL.mint },
    terminal_shop: { body: '#8A4A35', scr: PAL.bernstein },
    terminal_spare: { body: '#4A5260', scr: '#3A4250' },   // Brückenumbau: freies Terminal, ausgeschaltet
  };
  function buildConsole(g, c, kind, f, active) {
    var st = CONSOLE_STYLE[kind], body = st.body, scr = st.scr;
    var lit = active ? 1 : 0.72;
    var bL = shade(body, 0.22), bD = shade(body, -0.3);
    // Gehäuse unten
    R(g, 3, 30, 26, 16, body);
    R(g, 3, 30, 26, 1, bL); R(g, 3, 30, 1, 16, bL); R(g, 28, 30, 1, 16, bD);
    R(g, 3, 44, 26, 2, bD);
    // Pult (schräge Bedienfläche)
    R(g, 2, 25, 28, 6, shade(body, 0.32)); R(g, 2, 25, 28, 1, shade(body, 0.5)); R(g, 2, 30, 28, 1, bD);
    // Lüftung + Plakette
    for (var vx = 7; vx < 25; vx += 3) R(g, vx, 39, 2, 3, shade(body, -0.38));
    R(g, 12, 33, 8, 4, PAL.messing); R(g, 12, 33, 8, 1, '#EAC786'); R(g, 13, 35, 6, 1, '#6E4E22');
    // Röhrenschirm im Messingrahmen
    R(g, 7, 5, 18, 21, '#3A4759');                 // Röhrengehäuse
    R(g, 6, 7, 20, 18, '#7A5A28');
    R(g, 7, 6, 18, 19, PAL.messing); R(g, 7, 6, 18, 1, '#F1D9A0'); R(g, 7, 6, 1, 19, '#EAC786'); R(g, 24, 7, 1, 18, '#8A6530'); R(g, 7, 24, 18, 1, '#6E4E22');
    var sx = 9, sy = 8, sw = 14, sh = 14;
    screenGlass(g, sx, sy, sw, sh, active ? '#10261F' : '#0C1A18');
    var sc = mix(shade(scr, -0.55), scr, lit), scD = shade(sc, -0.45);
    // Bildschirminhalt
    if (kind === 'console_helm') {
      ell(g, 16, 15, 6, 6, scD); ell(g, 16, 15, 5, 5, active ? '#10261F' : '#0C1A18');
      ell(g, 16, 15, 3, 3, scD); ell(g, 16, 15, 2, 2, active ? '#10261F' : '#0C1A18');
      var a = f / 8 * Math.PI * 2;
      line(g, 16, 15, 16 + Math.cos(a) * 5, 15 + Math.sin(a) * 5, sc);
      line(g, 16, 15, 16 + Math.cos(a - 0.4) * 5, 15 + Math.sin(a - 0.4) * 5, scD);
      P(g, 19, 12, f % 4 < 2 ? sc : scD); P(g, 13, 18, sc);
      // Steuerjoch
      R(g, 9, 27, 14, 2, '#2E3946'); R(g, 9, 26, 2, 3, PAL.messing); R(g, 21, 26, 2, 3, PAL.messing); R(g, 15, 27, 2, 2, PAL.messing);
    } else if (kind === 'console_captain') {
      for (var gx = sx + 1; gx < sx + sw; gx += 4) R(g, gx, sy + 1, 1, sh - 2, scD);
      for (var gy = sy + 2; gy < sy + sh; gy += 4) R(g, sx + 1, gy, sw - 2, 1, scD);
      P(g, 11, 18, sc); P(g, 13, 16, sc); P(g, 15, 15, sc); P(g, 17, 13, sc); P(g, 19, 11, sc);
      R(g, 19 + (f % 2), 10, 2, 2, f % 2 ? PAL.sternweiss : sc);
      // Papiere/Knöpfe am Pult
      R(g, 5, 26, 5, 3, '#E8DCC0'); R(g, 6, 27, 3, 1, '#9C8E70');
      R(g, 22, 26, 2, 2, PAL.alarmrot); R(g, 25, 26, 2, 2, PAL.warngelb);
    } else if (kind === 'console_weapons') {
      R(g, 16, sy + 1, 1, sh - 2, scD); R(g, sx + 1, 15, sw - 2, 1, scD);
      ell(g, 16, 15, 4, 4, sc); ell(g, 16, 15, 3, 3, active ? '#10261F' : '#0C1A18');
      var bx = 12 + ((f * 3) % 9), by = 10 + ((f * 5) % 9);
      P(g, bx, by, f % 2 ? PAL.sternweiss : sc);
      R(g, sx + 1, sy + sh - 2, Math.round((sw - 2) * ((f % 8) + 1) / 8), 1, PAL.bernstein);
      // Hebel mit roten Knäufen
      R(g, 8, 23 - (f % 4 === 0 ? 1 : 0), 1, 5, '#8EA3B5'); R(g, 7, 22 - (f % 4 === 0 ? 1 : 0), 3, 2, PAL.alarmrot);
      R(g, 23, 23, 1, 5, '#8EA3B5'); R(g, 22, 22, 3, 2, PAL.alarmrot);
    } else if (kind === 'console_transfer') {
      var rr = (f % 4) + 1;
      ell(g, 16, 15, rr + 2, rr + 1, sc); ell(g, 16, 15, rr + 1, rr, active ? '#10261F' : '#0C1A18');
      ell(g, 16, 15, 1.5, 1.5, PAL.sternweiss);
      P(g, 11, 11, sc); P(g, 21, 11, sc); P(g, 16, 20, sc);
      R(g, 6, 27, 20, 1, '#2E3946'); R(g, 8 + (f % 8) * 2, 26, 2, 3, PAL.mint);
    } else if (kind === 'terminal_spare') {
      // aus: dunkles Glas, nur ein schwacher Reflex, Staubkorn; Pult mit Abdeckklappe
      R(g, sx, sy, sw, sh, '#05080C'); R(g, sx + 2, sy + 2, 3, 1, 'rgba(142,163,181,0.25)'); P(g, sx + 9, sy + 10, 'rgba(142,163,181,0.15)');
      R(g, 8, 26, 16, 2, '#2E3946'); R(g, 8, 26, 16, 1, '#5A6372');
    } else {
      // Hafenterminal: Marken-Symbol + Laufschrift
      ell(g, 13, 13, 3, 3, sc); ell(g, 13, 13, 2, 2, scD); P(g, 13, 13, sc);
      for (var l = 0; l < 3; l++) R(g, 18, 11 + l * 3, 3 + ((l + f) % 3), 1, sc);
      R(g, 11, 18, ((f % 8) + 2), 1, sc);
      R(g, 4, 0, 24, 6, '#5A3020'); R(g, 5, 1, 22, 4, '#2B1D1A');
      for (var k = 0; k < 5; k++) P(g, 7 + k * 4, 3, (k + f) % 5 === 0 ? PAL.funke : PAL.bernstein);
      R(g, 9, 26, 3, 3, PAL.messing); R(g, 20, 26, 6, 2, '#1B2230');
    }
    if (kind === 'terminal_spare') { led(g, 17, 29, PAL.alarmrot, f % 8 < 2); finish(c, PAL.outline, [16, 45, 13, 3]); return; }   // nur Standby-Lämpchen
    scanlines(g, sx, sy, sw, sh);
    P(g, sx + 1, sy + 1, 'rgba(255,255,255,0.35)'); P(g, sx + 2, sy + 1, 'rgba(255,255,255,0.2)');
    // Blinklichter
    var pat = [1, 0, 1, 1, 0, 1, 0, 0];
    led(g, 11, 29, PAL.mint, pat[f % 8] || active);
    led(g, 14, 29, PAL.bernstein, pat[(f + 3) % 8]);
    led(g, 17, 29, PAL.alarmrot, pat[(f + 5) % 8] && f % 2 === 0);
    led(g, 20, 29, PAL.mint, pat[(f + 1) % 8]);
    finish(c, PAL.outline, [16, 45, 13, 3]);
  }
  function drawConsole(ctx, kind, px, py, o) {
    var f = frameOf(o.time, 4, 8), act = o.active ? 1 : 0;
    var spr = cached('obj|' + kind + '|' + f + '|' + act, 32, 48, function (g, c) { buildConsole(g, c, kind, f, act); });
    ctx.drawImage(spr, px, py - OH);
    var sc = CONSOLE_STYLE[kind].scr;
    glow(ctx, px + 16, py - OH + 15, sc, act ? 16 : 11, act ? 0.38 : 0.16 + 0.04 * Math.sin((o.time || 0) * 3));
  }

  // --- Regal ------------------------------------------------------------------------------------
  // M0: Füllstufe aus opts.fill (0..1). Ohne fill = voll (rückwärtskompatibel).
  function shelfStage(fill) {
    if (fill == null || typeof fill !== 'number' || !(fill >= 0)) return 'full';
    if (fill >= 0.67) return 'full';
    if (fill >= 0.34) return 'half';
    if (fill > 0) return 'low';
    return 'empty';
  }
  var SHELF_SLOTS = { ersatzteil: 3, loeschgel: 4, flickblech: 3, bolzen: 2, medipack: 2 };
  function shelfItems(g, item, y, slots) {   // y = Brettoberkante; slots = Liste der belegten Plätze
    var i, k;
    if (!slots) { slots = []; for (k = 0; k < (SHELF_SLOTS[item] || 0); k++) slots.push(k); }
    for (k = 0; k < slots.length; k++) {
      i = slots[k];
      if (item === 'ersatzteil') {
        var cx = 8 + i * 8, cy = y - 4;
        ell(g, cx, cy, 3.6, 3.6, '#8A6530'); ell(g, cx, cy, 3, 3, PAL.messing);
        P(g, cx - 4, cy, PAL.messing); P(g, cx + 3, cy, PAL.messing); P(g, cx, cy - 4, '#EAC786'); P(g, cx, cy + 3, '#8A6530');
        P(g, cx - 1, cy - 1, '#3A2A12'); P(g, cx, cy - 1, '#3A2A12'); P(g, cx - 1, cy, '#3A2A12'); P(g, cx, cy, '#3A2A12');
        P(g, cx - 2, cy - 2, '#F1D9A0');
      } else if (item === 'loeschgel') {
        var x = 6 + i * 5;
        R(g, x, y - 8, 4, 8, '#C8433A'); R(g, x, y - 8, 1, 8, '#E86A5C'); R(g, x + 3, y - 8, 1, 8, '#8A2A24');
        R(g, x, y - 5, 4, 2, PAL.mint); R(g, x + 1, y - 10, 2, 2, '#2B3442');
      } else if (item === 'flickblech') {
        var yy = y - 2 - i * 2;
        R(g, 5 + (i % 2), yy, 21, 2, i % 2 ? '#8EA3B5' : '#A9BACB'); R(g, 5 + (i % 2), yy, 21, 1, '#C8D6E2');
        P(g, 7 + (i % 2), yy, '#4F6178'); P(g, 23 + (i % 2), yy, '#4F6178');
      } else if (item === 'bolzen') {
        var by = y - 3 - i * 3, bx = 5 + i * 2;
        R(g, bx, by, 15, 3, PAL.messing); R(g, bx, by, 15, 1, '#F1D9A0'); R(g, bx + 15, by, 3, 3, PAL.alarmrot); P(g, bx + 18, by + 1, PAL.alarmrot);
        R(g, bx, by, 2, 3, '#6E4E22');
      } else if (item === 'medipack') {
        var mx = 5 + i * 11;
        R(g, mx, y - 7, 9, 7, '#EDE6D6'); R(g, mx, y - 7, 9, 1, '#FFFFFF'); R(g, mx + 8, y - 7, 1, 7, '#B8AE98');
        R(g, mx + 4, y - 6, 1, 5, '#3FB894'); R(g, mx + 2, y - 4, 5, 1, '#3FB894');
      }
    }
  }
  // umgekipptes Teil (Stufe „halb“): liegt schräg/flach am rechten Brettende
  function shelfTipped(g, item, y) {
    if (item === 'ersatzteil') { ell(g, 22, y - 2, 4, 1.6, '#8A6530'); ell(g, 22, y - 2.5, 3.4, 1.2, PAL.messing); P(g, 22, y - 3, '#3A2A12'); P(g, 20, y - 3, '#F1D9A0'); }
    else if (item === 'loeschgel') { R(g, 17, y - 4, 8, 4, '#C8433A'); R(g, 17, y - 4, 8, 1, '#E86A5C'); R(g, 20, y - 4, 2, 4, PAL.mint); R(g, 25, y - 3, 2, 2, '#2B3442'); }
    else if (item === 'flickblech') { line(g, 14, y - 1, 26, y - 7, '#A9BACB'); line(g, 14, y - 2, 26, y - 8, '#C8D6E2'); line(g, 15, y - 1, 26, y - 6, '#8EA3B5'); }
    else if (item === 'bolzen') { line(g, 13, y - 1, 25, y - 6, PAL.messing); line(g, 13, y - 2, 25, y - 7, '#F1D9A0'); R(g, 25, y - 8, 3, 3, PAL.alarmrot); }
    else if (item === 'medipack') { R(g, 17, y - 4, 9, 4, '#EDE6D6'); R(g, 17, y - 4, 9, 1, '#FFFFFF'); R(g, 21, y - 4, 1, 4, '#3FB894'); R(g, 19, y - 3, 5, 1, '#3FB894'); }
  }
  // Belegung je Stufe: [Brett oben, Mitte, unten] als Slot-Listen
  function shelfLayout(item, stage) {
    var n = SHELF_SLOTS[item] || 0, all = [], k;
    for (k = 0; k < n; k++) all.push(k);
    if (stage === 'full') return { boards: [all, all, all], tipped: -1 };
    if (stage === 'half') return { boards: [all.filter(function (s) { return s !== 1; }), all.slice(0, 1), []], tipped: 1 };
    if (stage === 'low') return { boards: [[], [], all.slice(0, 1)], tipped: -1 };
    return { boards: [[], [], []], tipped: -1 };
  }
  function buildShelf(g, c, item, stage) {
    stage = stage || 'full';
    // Rückwand
    R(g, 4, 6, 24, 38, '#2A3442'); R(g, 4, 6, 24, 1, '#3A4759');
    for (var yy = 10; yy < 44; yy += 6) R(g, 5, yy, 22, 1, '#25303D');
    // Bretter
    var boards = [17, 29, 41], lay = shelfLayout(item, stage);
    for (var i = 0; i < boards.length; i++) {
      var by = boards[i];
      shelfItems(g, item, by, lay.boards[i]);
      if (lay.tipped === i) shelfTipped(g, item, by);
      R(g, 3, by, 26, 3, '#6C7F96'); R(g, 3, by, 26, 1, '#9FB2C4'); R(g, 3, by + 2, 26, 1, '#3F4D61');
      if (stage === 'empty' || stage === 'low') {   // Staub auf leeren Brettern
        var r = rng(77 + i * 13 + item.length);
        for (var d = 0; d < 7; d++) P(g, 5 + r() * 22, by - (r() < 0.5 ? 0 : 1), r() < 0.5 ? '#7E8796' : '#5F6878');
        R(g, 6 + (r() * 14 | 0), by, 4, 1, '#B7C2CE');
      }
    }
    // Pfosten
    R(g, 2, 4, 3, 43, '#55667D'); R(g, 2, 4, 1, 43, '#8EA3B5'); R(g, 27, 4, 3, 43, '#46566B'); R(g, 29, 4, 1, 43, '#2E3946');
    R(g, 2, 4, 28, 2, '#6C7F96'); R(g, 2, 4, 28, 1, '#9FB2C4');
    // Statuslämpchen-Gehäuse (Licht selbst wird pro Frame gezeichnet)
    R(g, 22, 1, 6, 4, '#2E3946'); R(g, 22, 1, 6, 1, '#55667D'); R(g, 23, 2, 4, 2, '#1A1F28');
    if (stage === 'empty') {
      // Spinnweben in der Ecke + „LEER“-Schild am mittleren Brett
      line(g, 5, 7, 11, 7, 'rgba(220,226,232,0.55)'); line(g, 5, 7, 5, 13, 'rgba(220,226,232,0.55)'); line(g, 5, 7, 10, 12, 'rgba(220,226,232,0.45)');
      line(g, 8, 7, 5, 10, 'rgba(220,226,232,0.35)');
      R(g, 3, 31, 26, 10, '#E8DCC0'); R(g, 3, 31, 26, 1, '#FFF6E0'); R(g, 3, 40, 26, 1, '#9C8E70');
      R(g, 3, 31, 1, 10, PAL.alarmrot); R(g, 28, 31, 1, 10, PAL.alarmrot);
      P(g, 8, 30, '#2B1D1A'); P(g, 23, 30, '#2B1D1A');   // Aufhänger
      g.drawImage(textSprite('LEER', PAL.alarmrot, null), 5, 33 - TEXT_HEAD);
    }
    // Etikett
    R(g, 12, 44, 8, 3, PAL.messing); R(g, 12, 44, 8, 1, '#EAC786');
    var labelCol = { ersatzteil: PAL.messing, loeschgel: '#C8433A', flickblech: '#A9BACB', bolzen: PAL.alarmrot, medipack: PAL.mint }[item];
    if (labelCol) R(g, 15, 45, 2, 1, labelCol);
    finish(c, PAL.outline, null);
  }
  function drawShelf(ctx, px, py, o) {
    var item = o.item || 'leer', stage = shelfStage(o.fill), t = o.time || 0;
    var spr = cached('obj|shelf|' + item + '|' + stage, 32, 48, function (g, c) { buildShelf(g, c, item, stage); });
    ctx.drawImage(spr, px, py - OH);
    // Statuslämpchen: voll/halb Mint, fast leer Bernstein blinkend, leer Alarmrot
    var lx = px + 24, ly = py - OH + 2, col = PAL.mint, on = true;
    if (stage === 'low') { col = PAL.bernstein; on = ((t * 2.5) | 0) % 2 === 0; }
    else if (stage === 'empty') { col = PAL.alarmrot; on = ((t * 1.2) | 0) % 3 !== 2; }
    ctx.fillStyle = on ? col : shade(col, -0.55); ctx.fillRect(lx, ly, 2, 2);
    if (on) { ctx.fillStyle = shade(col, 0.6); ctx.fillRect(lx, ly, 1, 1); }
    if (on && stage !== 'full' && stage !== 'half') glow(ctx, lx + 1, ly + 1, col, 7, stage === 'empty' ? 0.45 : 0.35);
  }

  // --- Maschinenraum (M0): Rohrbündel, Werkbank, Kontrollpult, Fass/Kabeltrommel ------------
  function flange(g, x, y, w, col) { R(g, x - 1, y, w + 2, 2, col || PAL.messing); R(g, x - 1, y, w + 2, 1, '#F1D9A0'); }
  function buildPipes(g, c, v, f) {
    var pc = v ? ['#55667D', PAL.terrakotta, PAL.messing] : [PAL.terrakotta, PAL.messing, '#55667D'];
    sysBase(g, 3, 26, 41);
    for (var i = 0; i < 3; i++) {
      var x = 6 + i * 7, col = pc[i];
      R(g, x, 4, 5, 38, shade(col, -0.25)); R(g, x, 4, 2, 38, col); R(g, x, 4, 1, 38, shade(col, 0.35));
      flange(g, x, 9 + i * 3, 5); flange(g, x, 37, 5);
    }
    // Ventilblock
    R(g, 7, 20, 18, 12, '#3A4759'); R(g, 7, 20, 18, 1, '#8EA3B5'); R(g, 7, 20, 1, 12, '#6C7F96'); R(g, 24, 20, 1, 12, '#232B36');
    R(g, 9, 29, 14, 2, '#2A3442');
    // Handrad (rot) mit Speichen, dreht in Frames
    ell(g, 16, 25, 5, 5, '#8A2A24'); ell(g, 16, 25, 4, 4, PAL.alarmrot); ell(g, 16, 25, 2.6, 2.6, '#3A4759');
    var a = f * Math.PI / 8;
    for (var s = 0; s < 3; s++) { var an = a + s * Math.PI * 2 / 3; line(g, 16, 25, 16 + Math.cos(an) * 4, 25 + Math.sin(an) * 4, '#F08A7C'); }
    P(g, 16, 25, PAL.messing);
    // Manometer
    ell(g, 23, 17, 3, 3, PAL.messing); ell(g, 23, 17, 2.2, 2.2, '#F4EEDC');
    var na = -2.4 + (f % 4) * 0.12;
    line(g, 23, 17, 23 + Math.cos(na) * 2, 17 + Math.sin(na) * 2, PAL.alarmrot);
    // Dampfdüse oben
    R(g, 24, 6, 5, 3, '#55667D'); R(g, 27, 4, 2, 3, PAL.messing);
    finish(c, PAL.outline, [16, 45, 13, 3]);
  }
  function buildWorkbench(g, c) {
    var top = '#A06D48', topL = '#C08C5E', edge = '#6E4630';
    // Lochwand mit Werkzeug (Überstand)
    R(g, 4, 2, 24, 18, '#5A4434'); R(g, 4, 2, 24, 1, '#7A5E48');
    for (var yy = 4; yy < 19; yy += 3) for (var xx = 6; xx < 27; xx += 3) P(g, xx, yy, '#3A2A20');
    R(g, 7, 5, 1, 9, '#8EA3B5'); R(g, 6, 4, 3, 2, '#8EA3B5');                   // Schraubenschlüssel
    R(g, 12, 5, 4, 3, '#55667D'); R(g, 13, 8, 2, 8, '#8A5A3B');                  // Hammer
    R(g, 19, 5, 1, 10, '#8EA3B5'); R(g, 18, 14, 3, 3, PAL.alarmrot);             // Schraubendreher
    R(g, 23, 6, 3, 6, PAL.messing); R(g, 23, 12, 3, 2, '#2B3442');               // Ölkanne
    // Arbeitsplatte
    R(g, 1, 20, 30, 9, top); R(g, 1, 20, 30, 1, topL); R(g, 1, 28, 30, 1, edge);
    for (var k = 0; k < 3; k++) R(g, 4 + k * 9, 22 + (k % 2), 5, 1, shade(top, -0.12));
    // Schraubstock links
    R(g, 2, 15, 9, 6, '#55667D'); R(g, 2, 15, 9, 1, '#8EA3B5'); R(g, 5, 16, 1, 4, '#2E3946');
    R(g, 0, 18, 3, 1, '#C8D6E2'); R(g, 11, 17, 3, 1, '#C8D6E2');
    // Werkstück: Zahnrad
    ell(g, 21, 23, 3, 1.5, '#8A6530'); ell(g, 21, 22.5, 2.5, 1, PAL.messing);
    // Front mit Schubladen
    R(g, 2, 29, 28, 16, '#7A4E33'); R(g, 2, 29, 28, 1, '#9A6844');
    R(g, 3, 31, 12, 6, '#6E4630'); R(g, 17, 31, 12, 6, '#6E4630'); R(g, 3, 38, 26, 6, '#6E4630');
    R(g, 8, 33, 3, 1, PAL.messing); R(g, 22, 33, 3, 1, PAL.messing); R(g, 15, 40, 3, 1, PAL.messing);
    finish(c, PAL.outlineWarm, [16, 45, 14, 3]);
  }
  function buildControlDesk(g, c, f) {
    var body = '#4F6178', bL = '#6C7F96', bD = '#33404F';
    R(g, 3, 28, 26, 18, body); R(g, 3, 28, 26, 1, bL); R(g, 3, 28, 1, 18, bL); R(g, 28, 28, 1, 18, bD);
    R(g, 3, 44, 26, 2, bD);
    // schräge Pultplatte
    R(g, 1, 16, 30, 13, '#5E7088'); R(g, 1, 16, 30, 1, '#93A6BA'); R(g, 1, 28, 30, 1, bD);
    // zwei Rundinstrumente mit zitternden Zeigern
    for (var i = 0; i < 2; i++) {
      var cx = 7 + i * 9, cy = 21;
      ell(g, cx, cy, 3.6, 3.6, PAL.messing); ell(g, cx, cy, 2.8, 2.8, '#F4EEDC');
      var na = -2.2 + i * 0.9 + ((f + i * 3) % 4) * 0.15;
      line(g, cx, cy, cx + Math.cos(na) * 2.4, cy + Math.sin(na) * 2.4, PAL.alarmrot);
    }
    // Phosphorschirm mit Wellenlinie
    R(g, 21, 18, 8, 7, '#0E1D1C'); R(g, 20, 17, 10, 1, PAL.messing); R(g, 20, 25, 10, 1, '#8A6530');
    for (var x = 0; x < 8; x++) P(g, 21 + x, 21 + Math.round(Math.sin((x + f) * 0.9) * 2), PAL.mint);
    // Kippschalter-Reihe
    for (var k = 0; k < 8; k++) { R(g, 3 + k * 3, 26, 2, 2, '#2B3442'); P(g, 3 + k * 3, (k + f) % 3 ? 25 : 27, '#C8D6E2'); }
    // Lämpchen
    var pat = [1, 0, 1, 1, 0, 0, 1, 0];
    led(g, 8, 31, PAL.mint, pat[f % 8]); led(g, 12, 31, PAL.bernstein, pat[(f + 2) % 8]); led(g, 16, 31, PAL.alarmrot, pat[(f + 5) % 8] && f % 2);
    led(g, 20, 31, PAL.mint, pat[(f + 3) % 8]);
    R(g, 11, 36, 10, 4, PAL.messing); R(g, 11, 36, 10, 1, '#EAC786'); R(g, 12, 38, 8, 1, '#6E4E22');
    finish(c, PAL.outline, [16, 45, 13, 3]);
  }
  function buildBarrel(g, c, v) {
    if (!v) {   // Ölfass
      var b = '#C2703D', bL = '#E08A50', bD = '#8A4A26';
      R(g, 7, 22, 18, 22, b); R(g, 7, 22, 3, 22, bL); R(g, 22, 22, 3, 22, bD);
      [26, 33, 40].forEach(function (y) { R(g, 6, y, 20, 2, '#7A3E20'); R(g, 6, y, 20, 1, '#D08048'); });
      ell(g, 16, 22, 9, 3, bD); ell(g, 16, 21.5, 8, 2.4, '#A85A30'); ell(g, 12, 21, 1.5, 0.8, '#2B1D1A');
      R(g, 12, 34, 8, 4, '#2B1D1A'); R(g, 13, 35, 6, 2, PAL.warngelb);   // Warnetikett
      R(g, 20, 44, 6, 2, 'rgba(30,22,18,0.55)');                          // Tropfspur
    } else {    // Kabeltrommel
      ell(g, 16, 33, 12, 11, '#6E4630'); ell(g, 16, 33, 11, 10, '#9A6844'); ell(g, 15, 32, 9, 8, '#B88358');
      ell(g, 16, 33, 8, 7, '#7E3A28');
      for (var r = 7; r > 2; r -= 2) ell(g, 16, 33, r, r * 0.88, r % 4 === 1 ? PAL.terrakotta : '#2E6E5C');
      ell(g, 16, 33, 2.5, 2.2, '#5A3824'); P(g, 16, 33, PAL.messing);
      line(g, 24, 30, 30, 44, PAL.terrakotta); line(g, 25, 30, 31, 44, '#7E3A28');
    }
    finish(c, PAL.outlineWarm, [16, 45, 11, 3]);
  }
  // Dampfwölkchen aus Ventilen: in Schüben (alle ~3 s) aufsteigende helle Puffs
  function drawSteam(ctx, x, y, t, seed) {
    var cyc = 3.2 + (seed % 3) * 0.6, ph = (t + seed * 0.37) % cyc;
    if (ph > 1.6) return;
    var ga = ctx.globalAlpha;
    for (var i = 0; i < 4; i++) {
      var p = ph / 1.6 - i * 0.18;
      if (p < 0 || p > 1) continue;
      var rad = 1.5 + p * 4, sx = x + p * 5 + Math.sin(p * 6 + i) * 1.5, sy = y - p * 18;
      ctx.globalAlpha = ga * (1 - p) * 0.7;
      var pf = puffSprite(rad, '#D8E2EA');
      ctx.drawImage(pf, Math.round(sx - pf.width / 2), Math.round(sy - pf.height / 2));
    }
    ctx.globalAlpha = ga;
  }

  // --- Maschinenraum-Kulisse in den Kacheln (nicht blockierend) --------------------------------
  // M3a: Maschinenräume kommen aus dem Schiffslayout (Shared_Maps.roomAt, Räume mit kind 'engine'); die Wandkacheln
  // direkt über einem Maschinenraum tragen Rohre/Manometer. Ohne Raumdaten (Maps fehlt) gibt es keine Kulisse – Art läuft weiter.
  function shipRoomAt(env, tx, ty) {
    var m = env && env.map;
    if (!m || m.id !== 'ship') return null;
    var M = root.Shared_Maps;
    if (!M || typeof M.roomAt !== 'function') return null;
    try { return M.roomAt(tx, ty) || null; } catch (e) { return null; }
  }
  function engineRoomAt(env, tx, ty) { var r = shipRoomAt(env, tx, ty); return r && r.kind === 'engine' ? r : null; }
  function isEngineBackWall(env, tx, ty) { return !engineRoomAt(env, tx, ty) && !!engineRoomAt(env, tx, ty + 1); }
  function inEngineRoom(env, tx, ty) { return !!engineRoomAt(env, tx, ty) || isEngineBackWall(env, tx, ty); }
  // Kabeltrassen und Decals: Schlüssel relativ zur linken oberen Innenkachel des Raums (+1), d. h. "1,1" = (x0,y0).
  // Für den alten Maschinenraum (x0 1, y0 1) entspricht das den bisherigen Kachelkoordinaten.
  var ENGINE_CABLES = { '1,6': 'hs', '2,6': 'h', '3,6': 'hn', '4,6': 'h', '5,6': 'h', '6,6': 'h', '3,5': 'v', '1,7': 'v' };
  var ENGINE_DECALS = {
    '2,1': 'toolbox', '5,2': 'oil', '2,2': 'bolts', '4,3': 'vent', '6,3': 'drip', '2,5': 'hazard', '4,5': 'hazard', '5,7': 'coil',
    '3,8': 'oil', '2,9': 'parts', '5,9': 'bucket', '3,10': 'vent', '6,10': 'toolbox', '2,11': 'coil', '4,11': 'bolts', '2,8': 'hazardE',
  };
  function cableSprite(kind) {
    return cached('ecable|' + kind, 32, 32, function (g) {
      var cols = [PAL.terrakotta, '#2E6E5C', PAL.messing];
      if (kind === 'h' || kind === 'hn' || kind === 'hs') {
        R(g, 0, 21, 32, 7, 'rgba(11,14,26,0.55)'); R(g, 0, 21, 32, 1, '#5E6E80');
        for (var i = 0; i < 3; i++) { R(g, 0, 22 + i * 2, 32, 1, cols[i]); }
        for (var x = 3; x < 32; x += 10) R(g, x, 21, 2, 7, '#3A4759');
      }
      if (kind === 'hn' || kind === 'hs' || kind === 'v') {
        var y0 = kind === 'hs' ? 21 : 0, y1 = kind === 'hn' ? 21 : 32;
        R(g, 12, y0, 7, y1 - y0, 'rgba(11,14,26,0.55)'); R(g, 12, y0, 1, y1 - y0, '#5E6E80');
        for (var j = 0; j < 3; j++) R(g, 13 + j * 2, y0, 1, y1 - y0, cols[j]);
        for (var yy = y0 + 4; yy < y1; yy += 10) R(g, 12, yy, 7, 2, '#3A4759');
      }
    });
  }
  function decalSprite(kind) {
    return cached('edecal|' + kind, 32, 32, function (g) {
      if (kind === 'oil') { ell(g, 14, 18, 7, 3, 'rgba(20,16,14,0.55)'); ell(g, 19, 21, 4, 2, 'rgba(20,16,14,0.45)'); P(g, 12, 17, 'rgba(160,140,200,0.5)'); P(g, 13, 17, 'rgba(120,200,190,0.45)'); }
      else if (kind === 'drip') { ell(g, 22, 10, 3, 1.5, 'rgba(20,16,14,0.5)'); P(g, 22, 6, 'rgba(20,16,14,0.5)'); }
      else if (kind === 'bolts') { var r = rng(55); for (var i = 0; i < 6; i++) { var x = 6 + r() * 20, y = 8 + r() * 18; R(g, x, y, 2, 1, PAL.messing); P(g, x, y, '#F1D9A0'); } }
      else if (kind === 'vent') { R(g, 8, 10, 16, 12, '#232B36'); R(g, 8, 10, 16, 1, '#6C7F96'); for (var v = 12; v < 22; v += 2) R(g, 9, v, 14, 1, '#3A4759'); glowLines(g); }
      else if (kind === 'hazard') { for (var h = 0; h < 32; h += 4) { R(g, h, 0, 2, 3, PAL.warngelb); R(g, h + 2, 0, 2, 3, '#232A35'); } }
      else if (kind === 'hazardE') { for (var e = 0; e < 32; e += 4) { R(g, 0, e, 3, 2, PAL.warngelb); R(g, 0, e + 2, 3, 2, '#232A35'); } }
      else if (kind === 'toolbox') {
        R(g, 7, 6, 14, 8, '#B4573E'); R(g, 7, 6, 14, 1, '#D77A5C'); R(g, 7, 13, 14, 1, '#7E3A28'); R(g, 11, 4, 6, 2, '#2E3946'); R(g, 13, 9, 2, 2, PAL.messing);
        R(g, 22, 12, 6, 1, '#8EA3B5'); R(g, 27, 11, 2, 3, '#8EA3B5');
      } else if (kind === 'coil') { ell(g, 16, 16, 7, 4, '#2E6E5C'); ell(g, 16, 16, 5, 2.6, 'rgba(0,0,0,0)'); ell(g, 16, 16, 4, 2, '#161C26'); ell(g, 16, 15, 6, 3.4, PAL.mint); ell(g, 16, 15, 4, 2, '#1E2631'); }
      else if (kind === 'parts') { R(g, 8, 8, 12, 8, '#8A5A3B'); R(g, 8, 8, 12, 1, '#B88358'); R(g, 9, 9, 10, 3, '#3A2A1A'); ell(g, 12, 10, 2, 1, PAL.messing); ell(g, 16, 10, 2, 1, '#8EA3B5'); }
      else if (kind === 'bucket') { ell(g, 20, 20, 5, 2, '#3A4759'); R(g, 15, 20, 10, 7, '#55667D'); R(g, 15, 20, 2, 7, '#8EA3B5'); ell(g, 20, 20, 4, 1.5, '#1E2631'); R(g, 18, 17, 5, 3, '#E8DCC0'); }
    });
  }
  function glowLines(g) { R(g, 10, 15, 12, 1, 'rgba(255,198,107,0.35)'); }
  // Bodenlicht in Bernstein unter dem Gitter (gebacken), plus leises Flackern pro Frame
  function floorGrateLit(g, v) {
    // gleichmäßiges warmes Unterlicht (keine Kachel-Inseln), Lampen nur in einzelnen Kacheln
    R(g, 0, 0, 32, 32, '#1C1814');
    R(g, 0, 0, 32, 32, 'rgba(255,170,80,0.10)');
    if (v === 0) { R(g, 0, 19, 32, 5, '#4A2A22'); R(g, 0, 19, 32, 1, '#7E3A28'); }
    if (v === 2) { R(g, 0, 7, 32, 3, '#1F4A40'); R(g, 0, 7, 32, 1, '#3E9C80'); }
    if (v === 1) {   // Bodenlampe in Bernstein unter dem Gitter (jede vierte Kachel)
      var lx = v === 1 ? 10 : 20, ly = v === 1 ? 12 : 22;
      var gr = g.createRadialGradient(lx, ly, 1, lx, ly, 11);
      gr.addColorStop(0, 'rgba(255,198,107,0.7)'); gr.addColorStop(1, 'rgba(255,198,107,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
      R(g, lx - 2, ly - 1, 4, 2, PAL.bernstein); P(g, lx - 1, ly - 1, PAL.funke);
    }
    var bar = '#4E5F75', barHi = '#66798F', barLo = '#2A3442';
    for (var x = 0; x < 32; x += 4) R(g, x, 0, 1, 32, bar);
    for (var y = 0; y < 32; y += 8) { R(g, 0, y, 32, 2, bar); R(g, 0, y, 32, 1, barHi); R(g, 0, y + 2, 32, 1, barLo); }
    R(g, 0, 0, 32, 1, barHi); R(g, 0, 0, 1, 32, barHi); R(g, 31, 0, 1, 32, barLo); R(g, 0, 31, 32, 1, barLo);
    P(g, 2, 2, '#C8B48A'); P(g, 29, 2, '#C8B48A');
  }
  // Wand oben im Maschinenraum: Rohre, Flansche, Manometer mit zitternden Zeigern, Ventile mit Dampf
  function gaugeSprite() {
    return cached('egauge', 14, 14, function (g) {
      ell(g, 7, 7, 6, 6, '#5A4018'); ell(g, 7, 7, 5.4, 5.4, PAL.messing); ell(g, 6.6, 6.6, 4.4, 4.4, '#EAC786');
      ell(g, 7, 7, 4, 4, '#F4EEDC');
      for (var i = 0; i < 5; i++) { var a = -2.6 + i * 0.65; P(g, 7 + Math.cos(a) * 3.2, 7 + Math.sin(a) * 3.2, '#2B1D1A'); }
      P(g, 9, 9, PAL.alarmrot); P(g, 10, 8, PAL.alarmrot);
    });
  }
  function engineWallDetail(ctx, px, py, tx, t, alert) {
    var y0 = py + CAP_H;
    var kind = tx % 3;
    if (kind === 1) {    // Manometer
      ctx.drawImage(gaugeSprite(), px + 9, y0 + 1);
      var jitter = Math.sin(t * 23 + tx) * 0.12 + Math.sin(t * 7.3 + tx * 2) * 0.08;
      var base = alert === 'red' ? 0.9 : -0.6 + tx * 0.15;
      var a = base + jitter, cx = px + 16, cy = y0 + 8;
      ctx.fillStyle = PAL.alarmrot;
      for (var k = 1; k <= 3; k++) ctx.fillRect(Math.round(cx + Math.cos(a - Math.PI / 2) * k), Math.round(cy + Math.sin(a - Math.PI / 2) * k), 1, 1);
      ctx.fillStyle = '#2B1D1A'; ctx.fillRect(cx, cy, 1, 1);
    } else if (kind === 2) {   // Ventilrad + Flansch
      ctx.fillStyle = PAL.messing; ctx.fillRect(px + 4, y0 + 5, 3, 8); ctx.fillRect(px + 25, y0 + 5, 3, 8);
      ctx.fillStyle = '#8A2A24'; ctx.fillRect(px + 12, y0 + 2, 8, 8);
      ctx.fillStyle = PAL.alarmrot; ctx.fillRect(px + 13, y0 + 3, 6, 6);
      ctx.fillStyle = '#3A4759'; ctx.fillRect(px + 15, y0 + 5, 2, 2);
      drawSteam(ctx, px + 20, y0 + 3, t, tx);
    } else {   // Fallrohr bis zum Boden
      ctx.fillStyle = '#3A4759'; ctx.fillRect(px + 20, y0, 5, 32 - CAP_H);
      ctx.fillStyle = '#6C7F96'; ctx.fillRect(px + 20, y0, 2, 32 - CAP_H);
      ctx.fillStyle = PAL.messing; ctx.fillRect(px + 19, y0 + 4, 7, 2); ctx.fillRect(px + 19, y0 + 14, 7, 2);
      ctx.fillStyle = '#2E6E5C'; ctx.fillRect(px + 6, y0 + 2, 6, 4); ctx.fillStyle = PAL.mint; ctx.fillRect(px + 7, y0 + 3, 2, 2);
    }
  }
  function engineFloorDetail(ctx, px, py, tx, ty, t, room) {
    var key = room ? (tx - room.x0 + 1) + ',' + (ty - room.y0 + 1) : null;
    // Flackern des Bodenlichts (leise, je Kachel phasenversetzt)
    var v = (hash2(tx, ty, 7) * 4) | 0;
    if (v === 1) {
      var fl = 0.10 + 0.08 * (0.5 + 0.5 * Math.sin(t * 1.7 + tx * 1.3 + ty * 0.7));
      glow(ctx, px + (v === 1 ? 10 : 20), py + (v === 1 ? 12 : 22), PAL.bernstein, 12, fl);
    }
    var cab = key && ENGINE_CABLES[key];
    if (cab) ctx.drawImage(cableSprite(cab), px, py);
    var dec = key && ENGINE_DECALS[key];
    if (dec) ctx.drawImage(decalSprite(dec), px, py);
  }

  // --- Koje -------------------------------------------------------------------------------------
  function symbolPix(g, shape, x, y, col) {   // kleines Formsymbol 5×5
    var m = {
      circle: ['.###.', '#####', '#####', '#####', '.###.'],
      triangle: ['..#..', '.###.', '.###.', '#####', '#####'],
      diamond: ['..#..', '.###.', '#####', '.###.', '..#..'],
    }[shape] || [];
    grid(g, x, y, m, { '#': col });
  }
  function buildBed(g, c, color) {
    var pc = color === 3 ? PAL.moos : (PLAYER[color] || PLAYER[0]), pL = shade(pc, 0.3), pD = shade(pc, -0.3);   // 3 = Gästequartier
    var wood = '#7A4E33', woodL = '#9A6844', woodD = '#5A3824';
    // Kopfteil
    R(g, 3, 6, 26, 12, wood); R(g, 3, 6, 26, 1, woodL); R(g, 3, 6, 1, 12, woodL); R(g, 28, 6, 1, 12, woodD);
    R(g, 6, 9, 20, 6, woodD); R(g, 7, 10, 18, 4, '#6E4630');
    R(g, 2, 4, 3, 4, PAL.messing); R(g, 27, 4, 3, 4, PAL.messing); P(g, 2, 4, '#F1D9A0'); P(g, 27, 4, '#F1D9A0');
    // Matratze/Rahmen
    R(g, 3, 18, 26, 28, woodD);
    R(g, 4, 18, 24, 26, '#E8DCC0');
    // Kissen
    R(g, 6, 19, 20, 7, '#F4EEDC'); R(g, 6, 19, 20, 1, '#FFFFFF'); R(g, 6, 25, 20, 1, '#C8BCA0'); R(g, 15, 20, 1, 5, '#D8CCB0');
    // Decke
    R(g, 4, 27, 24, 17, pc);
    R(g, 4, 27, 24, 3, pL); R(g, 4, 30, 24, 1, pD);
    R(g, 4, 31, 2, 13, pD); R(g, 26, 31, 2, 13, pD);
    for (var q = 33; q < 44; q += 4) R(g, 7, q, 18, 1, shade(pc, -0.12));
    if (color === 3) { R(g, 13, 35, 7, 3, '#E8DCC0'); R(g, 14, 36, 5, 1, PAL.messing); }   // Gast: gefaltete Decke mit Messingband
    else symbolPix(g, PLAYER_SHAPES[color] || 'circle', 14, 34, PAL.sternweiss);
    // Fußteil
    R(g, 3, 43, 26, 4, wood); R(g, 3, 43, 26, 1, woodL);
    finish(c, PAL.outlineWarm, null);
  }

  // --- Systempunkte -----------------------------------------------------------------------------
  function sysBase(g, x, w, y) {  // Sockelplatte
    R(g, x, y, w, 5, '#2E3946'); R(g, x, y, w, 1, '#55667D'); R(g, x + 1, y + 4, w - 2, 1, '#1E2631');
    for (var i = x + 2; i < x + w - 2; i += 4) { P(g, i, y + 2, PAL.warngelb); P(g, i + 1, y + 2, PAL.warngelb); }
  }
  function buildSystem(g, c, kind, state, f, red) {
    var ok = state === 'ok', dmg = state === 'damaged', brk = state === 'broken';
    var flick = dmg ? ([1, 1, 0.4, 1, 0.7, 1, 0.2, 0.9][f]) : 1;
    var pulse = 0.5 + 0.5 * Math.sin(f / 8 * Math.PI * 2);
    var steel = '#55667D', steelL = '#8EA3B5', steelD = '#3A4759';
    var i;
    if (kind === 'sys_reactor') {
      sysBase(g, 3, 26, 41);
      R(g, 6, 13, 20, 29, steel); R(g, 6, 13, 3, 29, steelL); R(g, 23, 13, 3, 29, steelD);
      // Sichtfenster mit Kern
      var coreHi = red ? '#FF8A6C' : PAL.mint, coreLo = red ? '#5E2C2A' : '#2C5E52';
      var core = brk ? '#4A1E1E' : mix(coreLo, coreHi, (0.55 + 0.45 * pulse) * flick);
      R(g, 10, 18, 12, 18, brk ? '#1A1214' : (red ? '#3A1614' : '#123A33'));
      R(g, 13, 18, 6, 18, core); R(g, 15, 18, 2, 18, brk ? '#6A2A20' : mix(coreHi, red ? '#FFE8E0' : '#E8FFF8', pulse * flick));
      if (!brk) for (i = 0; i < 3; i++) P(g, 12 + ((f + i * 3) % 8), 34 - ((f * 2 + i * 5) % 16), red ? '#FFE8E0' : '#E8FFF8');
      if (dmg) { line(g, 11, 20, 14, 25, '#C8F5E6'); line(g, 14, 25, 12, 30, '#C8F5E6'); }
      if (brk) { line(g, 10, 19, 15, 27, '#2B1D1A'); line(g, 15, 27, 12, 35, '#2B1D1A'); line(g, 18, 20, 21, 30, '#2B1D1A'); R(g, 13, 26, 6, 4, '#E0473C'); }
      // Messingringe
      [13, 24, 37].forEach(function (yy) { R(g, 5, yy, 22, 3, PAL.messing); R(g, 5, yy, 22, 1, '#F1D9A0'); R(g, 5, yy + 2, 22, 1, '#7A5A28'); });
      // Kuppel + Rohre
      ell(g, 16, 12, 10, 5, steelD); ell(g, 16, 11, 9, 4, steel); ell(g, 14, 10, 4, 2, steelL);
      R(g, 13, 3, 6, 6, steelD); R(g, 13, 3, 2, 6, steelL); R(g, 12, 2, 8, 2, PAL.messing);
      R(g, 0, 28, 6, 4, PAL.terrakotta); R(g, 0, 28, 6, 1, '#D77A5C'); R(g, 26, 20, 6, 4, PAL.terrakotta); R(g, 26, 20, 6, 1, '#D77A5C');
    } else if (kind === 'sys_engines') {
      sysBase(g, 2, 28, 41);
      R(g, 3, 14, 26, 28, steel); R(g, 3, 14, 26, 2, steelL); R(g, 3, 14, 2, 28, steelL); R(g, 27, 14, 2, 28, steelD);
      // Turbinenring + Rotor
      ell(g, 16, 28, 11, 11, '#7A5A28'); ell(g, 16, 28, 10, 10, PAL.messing); ell(g, 15.5, 27.5, 9, 9, '#EAC786');
      ell(g, 16, 28, 8.5, 8.5, '#1E1A18');
      var hot = brk ? 0.05 : (0.55 + 0.45 * pulse) * flick;
      ell(g, 16, 28, 7, 7, mix('#3A2410', '#FF9A3C', hot));
      ell(g, 16, 28, 4, 4, mix('#3A2410', PAL.funke, hot));
      var rot = brk ? 0 : (dmg ? Math.floor(f / 2) : f) * Math.PI / 8;
      for (i = 0; i < 6; i++) {
        var a = rot + i * Math.PI / 3;
        line(g, 16 + Math.cos(a) * 2, 28 + Math.sin(a) * 2, 16 + Math.cos(a + 0.5) * 7.5, 28 + Math.sin(a + 0.5) * 7.5, '#2E3946');
      }
      ell(g, 16, 28, 2, 2, steelL);
      // Auspuffrohre
      R(g, 6, 4, 5, 11, steelD); R(g, 6, 4, 2, 11, steelL); R(g, 5, 3, 7, 2, PAL.messing);
      R(g, 21, 6, 5, 9, steelD); R(g, 21, 6, 2, 9, steelL); R(g, 20, 5, 7, 2, PAL.messing);
      R(g, 4, 17, 3, 2, PAL.warngelb); R(g, 25, 17, 3, 2, PAL.warngelb);
    } else if (kind === 'sys_shields') {
      sysBase(g, 5, 22, 41);
      R(g, 9, 30, 14, 12, steel); R(g, 9, 30, 2, 12, steelL); R(g, 21, 30, 2, 12, steelD);
      R(g, 7, 28, 18, 3, PAL.messing); R(g, 7, 28, 18, 1, '#F1D9A0');
      // Käfig + Kugel
      var orb = brk ? '#2E3A4A' : mix('#4E7A8A', PAL.eisblau, (0.5 + 0.5 * pulse) * flick);
      ell(g, 16, 17, 8, 8, brk ? '#1E2631' : '#2E4A5A');
      ell(g, 16, 17, 7, 7, orb); ell(g, 14, 15, 3, 3, brk ? '#3A4759' : '#E8F8FF');
      if (brk) { line(g, 12, 13, 17, 19, '#11161E'); line(g, 17, 19, 15, 23, '#11161E'); line(g, 17, 19, 21, 17, '#11161E'); }
      R(g, 8, 8, 2, 21, PAL.messing); R(g, 22, 8, 2, 21, '#8A6530'); R(g, 15, 6, 2, 3, PAL.messing);
      ell(g, 16, 8, 8, 2, '#8A6530'); ell(g, 16, 8, 6, 1, '#2E3946');
      // umlaufende Ringe
      if (!brk) {
        var ph = (dmg ? Math.floor(f / 2) * 2 : f) / 8 * Math.PI * 2;
        for (i = 0; i < 10; i++) {
          var an = ph + i / 10 * Math.PI * 2;
          var rx = 16 + Math.cos(an) * 12, ry = 17 + Math.sin(an) * 4;
          P(g, rx, ry, Math.sin(an) > 0 ? PAL.mint : '#3E9C80');
        }
      }
    } else if (kind === 'sys_weapons') {
      sysBase(g, 2, 28, 41);
      R(g, 3, 12, 26, 30, '#4A5568'); R(g, 3, 12, 26, 2, steelL); R(g, 3, 12, 2, 30, steelL); R(g, 27, 12, 2, 30, steelD);
      // Kondensatorröhren
      for (i = 0; i < 3; i++) {
        var tx = 6 + i * 7;
        R(g, tx, 16, 6, 20, '#1E2631');
        var lvl = brk ? 0 : Math.max(0, Math.min(1, ((f + i * 3) % 8) / 7)) * flick;
        var hgt = Math.round(18 * lvl);
        R(g, tx + 1, 35 - hgt, 4, hgt, PAL.bernstein); R(g, tx + 1, 35 - hgt, 1, hgt, PAL.funke);
        R(g, tx - 1, 15, 8, 2, PAL.messing); R(g, tx - 1, 35, 8, 2, PAL.messing);
      }
      // Warnstreifen
      for (i = 3; i < 29; i += 4) { R(g, i, 38, 2, 3, PAL.warngelb); R(g, i + 2, 38, 2, 3, '#232A35'); }
      // Lampe
      R(g, 13, 6, 6, 6, steelD); ell(g, 16, 7, 3, 3, brk ? '#4A1E1E' : (f % 4 < 2 ? PAL.alarmrot : '#8A2A24'));
      R(g, 0, 22, 3, 3, PAL.terrakotta); R(g, 29, 26, 3, 3, PAL.terrakotta);
    } else if (kind === 'sys_transfer') {
      sysBase(g, 3, 26, 41);
      ell(g, 16, 39, 12, 4, steelD); ell(g, 16, 38, 11, 3.5, steel); ell(g, 16, 38, 8, 2.5, '#2C5E52');
      // drei Zinken
      R(g, 5, 18, 3, 21, steel); R(g, 5, 18, 1, 21, steelL); R(g, 24, 18, 3, 21, steelD); R(g, 15, 14, 3, 22, steel); R(g, 15, 14, 1, 22, steelL);
      R(g, 4, 16, 5, 3, PAL.messing); R(g, 23, 16, 5, 3, PAL.messing); R(g, 14, 12, 5, 3, PAL.messing);
      // schwebender Ring
      if (!brk) {
        var by = 26 + Math.round(Math.sin(f / 8 * Math.PI * 2) * 2);
        var ringC = mix('#3E9C80', PAL.mint, flick);
        ell(g, 16, by, 10, 3.5, ringC); ell(g, 16, by, 8, 2.2, 'rgba(0,0,0,0)');
        g.clearRect(8, by - 1, 16, 2);
        R(g, 7, by - 1, 2, 2, ringC); R(g, 23, by - 1, 2, 2, ringC);
        P(g, 16, by + 3, '#E8FFF8'); P(g, 16, by - 3, '#3E9C80');
        if (f % 3 === 0) P(g, 11 + f, 20 + (f % 5), '#E8FFF8');
      } else {
        ell(g, 16, 37, 9, 2.5, '#2E3A4A'); R(g, 9, 34, 14, 2, '#3A4759');
      }
    } else if (kind === 'sys_life') {
      sysBase(g, 2, 28, 41);
      // Algentank
      R(g, 4, 10, 16, 32, steelD);
      R(g, 5, 13, 14, 26, brk ? '#20302A' : '#2F6B4A');
      R(g, 5, 13, 14, 3, brk ? '#2A3A30' : '#4E9A62');
      if (!brk) {
        for (i = 0; i < 4; i++) { var bx = 7 + i * 3, byy = 37 - ((f * 3 + i * 7) % 22); P(g, bx, byy, '#C8F5E6'); }
        line(g, 8, 38, 9, 26, PAL.moos); line(g, 9, 26, 8, 20, '#7FAE66'); line(g, 14, 38, 15, 28, PAL.moos); line(g, 15, 28, 16, 22, '#7FAE66');
        P(g, 7, 24, '#9FCC7A'); P(g, 10, 22, '#9FCC7A'); P(g, 16, 25, '#9FCC7A');
      } else { R(g, 7, 30, 10, 8, '#3A3A2A'); }
      R(g, 5, 13, 1, 26, 'rgba(255,255,255,0.35)');
      R(g, 3, 9, 18, 3, PAL.messing); R(g, 3, 9, 18, 1, '#F1D9A0'); R(g, 3, 39, 18, 3, PAL.messing);
      // Lüfterkasten
      R(g, 20, 20, 10, 21, steel); R(g, 20, 20, 10, 1, steelL); R(g, 29, 20, 1, 21, steelD);
      ell(g, 25, 28, 4, 4, '#1E2631');
      var fr = brk ? 0 : (dmg ? Math.floor(f / 2) : f);
      for (i = 0; i < 4; i++) { var an2 = fr * Math.PI / 6 + i * Math.PI / 2; line(g, 25, 28, 25 + Math.cos(an2) * 3, 28 + Math.sin(an2) * 3, steelL); }
      R(g, 22, 35, 6, 2, PAL.moos);
      R(g, 7, 4, 3, 6, steel); R(g, 6, 3, 5, 2, PAL.messing);
    }
    // Statuslampe
    var lc = ok ? PAL.mint : dmg ? (f % 2 ? PAL.warngelb : '#6A5A20') : (f % 2 ? PAL.alarmrot : '#5A1E1E');
    R(g, 26, 40, 3, 2, lc); P(g, 26, 40, shade(lc, 0.5));
    if (brk) {   // Brandspuren
      var r = rng(kind.length * 31);
      for (i = 0; i < 14; i++) P(g, 4 + r() * 24, 10 + r() * 30, 'rgba(20,14,12,0.55)');
    }
    finish(c, PAL.outline, [16, 45, 13, 3]);
  }
  function drawSystem(ctx, kind, px, py, o) {
    var state = o.state === 'damaged' || o.state === 'broken' ? o.state : 'ok';
    var t = o.time || 0;
    var f = frameOf(t, state === 'ok' ? 8 : 6, 8);
    var red = kind === 'sys_reactor' && o.alert === 'red';
    var key = 'obj|' + kind + '|' + state + '|' + f + (red ? '|r' : '');
    var spr = cached(key, 32, 48, function (g, c) { buildSystem(g, c, kind, state, f, red); });
    ctx.drawImage(spr, px, py - OH);
    if (kind === 'sys_reactor' && state !== 'broken') {   // M0: pulsierender Kern-Schein
      var pr = 0.5 + 0.5 * Math.sin(t * 2.6);
      glow(ctx, px + 16, py - OH + 27, red ? '#FF6A4C' : PAL.mint, 20 + Math.round(pr * 8), (state === 'ok' ? 0.2 : 0.1) + 0.2 * pr);
    }
    var gc = { sys_reactor: PAL.mint, sys_engines: '#FF9A3C', sys_shields: PAL.eisblau, sys_weapons: PAL.bernstein, sys_transfer: PAL.mint, sys_life: '#8FD06A' }[kind];
    if (state !== 'broken') glow(ctx, px + 16, py + 10, gc, 18, state === 'ok' ? 0.22 : 0.12 * (1 + Math.sin(t * 17)));
    // M3a: Funken/Rauch/Feuer und Zustandsmarke zeichnet stationDecor (drawSystemLegacy)
    return { spr: spr, key: key };
  }

  // --- Möbel, Kisten, Pflanzen ------------------------------------------------------------------
  function buildTable(g, c, l, r, f) {
    var top = '#A06D48', topL = '#B88358', edge = '#6E4630', leg = '#5A3824';
    var x0 = l ? 0 : 2, x1 = r ? 32 : 30;
    // Hocker vorne
    ell(g, 16, 44, 5, 2.2, '#5A3824'); ell(g, 16, 43, 5, 2.2, PAL.messing); ell(g, 15, 42.6, 3, 1, '#EAC786');
    // Beine
    if (!l) R(g, 3, 34, 3, 9, leg);
    if (!r) R(g, 26, 34, 3, 9, leg);
    // Platte
    R(g, x0, 22, x1 - x0, 12, top); R(g, x0, 22, x1 - x0, 1, topL);
    R(g, x0, 34, x1 - x0, 4, edge); R(g, x0, 37, x1 - x0, 1, '#4A2E1E');
    for (var gx = x0 + 3; gx < x1 - 2; gx += 7) R(g, gx, 26 + (gx % 3), 4, 1, '#8F5E3C');
    // Tischdeko
    if (!l) {
      ell(g, 13, 28, 5, 3, '#E8DCC0'); ell(g, 13, 28, 3.6, 2, '#F4EEDC'); P(g, 12, 27, '#E0473C'); P(g, 14, 28, '#F2C94C'); P(g, 13, 29, PAL.moos);
      R(g, 22, 25, 4, 5, '#E8DCC0'); R(g, 26, 26, 1, 2, '#E8DCC0'); R(g, 22, 25, 4, 1, '#7A4E33');
    } else {
      R(g, 6, 25, 4, 5, '#5BA8D8'); R(g, 10, 26, 1, 2, '#5BA8D8'); R(g, 6, 25, 4, 1, '#3A2A1A');
      R(g, 17, 26, 7, 4, '#E8DCC0'); R(g, 18, 27, 5, 1, '#B4573E'); R(g, 18, 28, 3, 1, '#9C8E70');
      R(g, 27, 24, 2, 5, '#F4EEDC'); P(g, 27, 23 - (f % 2), '#FFC66B');
    }
    finish(c, PAL.outlineWarm, [16, 40, 14, 3]);
  }
  function buildPlant(g, c, f, small) {
    var s = small ? 0.75 : 1, cx = 16;
    var potTop = small ? 36 : 33;
    R(g, cx - 6 * s, potTop, 12 * s, 11 * s - 1, PAL.terrakotta);
    R(g, cx - 7 * s, potTop - 1, 14 * s, 3, '#D77A5C'); R(g, cx - 7 * s, potTop + 1, 14 * s, 1, '#8A3E2A');
    R(g, cx - 6 * s, potTop + 3, 2, 8 * s - 2, '#D77A5C'); R(g, cx + 6 * s - 2, potTop + 3, 2, 8 * s - 2, '#8A3E2A');
    var sway = f % 2;
    var leaves = small ?
      [[16, 26, 4, 5], [11, 30, 4, 3], [21, 29, 4, 3], [14, 22, 3, 4], [19, 23, 3, 3]] :
      [[16, 20, 6, 7], [9, 25, 5, 4], [23, 24, 5, 4], [12, 14, 4, 5], [21, 15, 4, 5], [16, 9, 3, 5], [7, 18, 3, 3], [25, 19, 3, 3]];
    for (var i = 0; i < leaves.length; i++) {
      var L = leaves[i], dx = (i % 2 ? sway : -sway) * (L[1] < 20 ? 1 : 0);
      ell(g, L[0] + dx, L[1] + 1, L[2], L[3], '#3F6532');
      ell(g, L[0] + dx, L[1], L[2], L[3], PAL.moos);
      ell(g, L[0] + dx - 1, L[1] - 1, L[2] * 0.5, L[3] * 0.5, '#7FAE66');
    }
    if (!small) { P(g, 14, 12, '#F2C94C'); P(g, 22, 22, '#F2C94C'); }
    finish(c, PAL.outlineWarm, [16, small ? 46 : 45, small ? 6 : 8, 2]);
  }
  function buildCrate(g, c, v) {
    var w = '#9A6844', wl = '#B88358', wd = '#6E4630';
    // Deckel
    R(g, 3, 20, 26, 8, wl); R(g, 3, 20, 26, 1, '#D0A070');
    R(g, 3, 23, 26, 1, w);
    // Front
    R(g, 3, 28, 26, 18, w);
    for (var y = 28; y < 46; y += 6) R(g, 3, y + 5, 26, 1, wd);
    line(g, 4, 29, 27, 44, wd); line(g, 4, 30, 27, 45, '#835537');
    R(g, 3, 28, 26, 1, wd);
    // Messingecken
    [[3, 20], [26, 20], [3, 43], [26, 43]].forEach(function (p) { R(g, p[0], p[1], 3, 3, PAL.messing); P(g, p[0], p[1], '#F1D9A0'); });
    // Schablonenschrift
    if (v) { R(g, 11, 33, 10, 5, 'rgba(43,29,26,0.45)'); R(g, 12, 34, 8, 3, wl); R(g, 13, 35, 6, 1, wd); }
    else { R(g, 13, 32, 6, 1, '#3A2416'); R(g, 15, 30, 2, 5, '#3A2416'); }
    finish(c, PAL.outlineWarm, [16, 46, 14, 2]);
  }

  // --- Bojenkern (2×2), Sonde, verriegelte Tür ---------------------------------------------------
  function buildBuoyCore(g, c, f) {   // 64×80, Kern zentriert bei (32, 48)
    var pulse = 0.5 + 0.5 * Math.sin(f / 8 * Math.PI * 2);
    // Sockelplatte (achteckig)
    var oct = [10, 34, 22, 22, 42, 22, 54, 34, 54, 62, 42, 74, 22, 74, 10, 62];
    poly(g, [8, 36, 22, 24, 42, 24, 56, 36, 56, 66, 42, 78, 22, 78, 8, 66], '#1E2631');
    poly(g, oct, '#3B4A5E');
    poly(g, [12, 35, 23, 24, 41, 24, 52, 35, 52, 37, 12, 37], '#55687F');
    for (var i = 0; i < 8; i++) { var a = i / 8 * Math.PI * 2; P(g, 32 + Math.cos(a) * 19, 49 + Math.sin(a) * 19, i % 2 ? PAL.warngelb : '#232A35'); }
    ell(g, 32, 50, 15, 11, '#232D3B');
    ell(g, 32, 50, 13, 9, mix('#1E3A44', '#2E6E7C', pulse));
    // Streben
    [[14, 36], [50, 36], [18, 66], [46, 66]].forEach(function (p) { line(g, p[0], p[1], 32, 34, '#6C7F96'); line(g, p[0] + 1, p[1], 33, 34, '#3B4A5E'); });
    // Kristallsäule
    poly(g, [32, 8, 40, 22, 38, 50, 32, 56, 26, 50, 24, 22], '#5C7E93');
    poly(g, [32, 8, 32, 56, 26, 50, 24, 22], mix('#8FC4D8', PAL.eisblau, pulse));
    poly(g, [32, 10, 29, 22, 30, 44, 32, 50], '#E8F8FF');
    poly(g, [40, 22, 38, 50, 34, 30], '#3E5A6E');
    // Ringe
    ell(g, 32, 30, 14, 4, 'rgba(0,0,0,0)');
    for (var k = 0; k < 16; k++) {
      var an = k / 16 * Math.PI * 2 + f / 8 * Math.PI;
      var rx = 32 + Math.cos(an) * 14, ry = 30 + Math.sin(an) * 4;
      if (Math.sin(an) > -0.2 || (k % 2 === 0)) R(g, rx, ry, 2, 1, Math.sin(an) > 0 ? PAL.mint : '#2E6E5C');
    }
    // Kernlicht
    ell(g, 32, 50, 5, 4, mix(PAL.mint, '#E8FFF8', pulse));
    finish(c, PAL.outline, null);
  }
  function buildSonde(g, c, f, disabled) {
    var pulse = 0.5 + 0.5 * Math.sin(f / 4 * Math.PI * 2);
    // Sockel
    poly(g, [5, 40, 27, 40, 30, 46, 2, 46], '#232D3B'); poly(g, [6, 39, 26, 39, 28, 43, 4, 43], '#3B4656');
    // Kristallkörper
    var cA = disabled ? '#5E6670' : PAL.eisblau, cB = disabled ? '#3E444C' : '#5C7E93', cC = disabled ? '#7A828C' : '#E8F8FF';
    poly(g, [16, 0, 26, 12, 24, 40, 8, 40, 6, 12], cB);
    poly(g, [16, 0, 16, 40, 8, 40, 6, 12], cA);
    poly(g, [16, 2, 10, 13, 11, 30, 14, 38], cC);
    poly(g, [26, 12, 24, 40, 19, 24], disabled ? '#2E343C' : '#3E5A6E');
    // Mechanikband
    R(g, 5, 20, 22, 9, '#3B4656'); R(g, 5, 20, 22, 1, '#6C7A8C'); R(g, 5, 28, 22, 1, '#232A35');
    P(g, 7, 24, '#8EA3B5'); P(g, 25, 24, '#8EA3B5');
    // Auge / Anzeige
    if (!disabled) {
      ell(g, 16, 24, 4, 3, '#2A0E0E');
      ell(g, 16, 24, 3, 2, mix('#8A2A24', PAL.alarmrot, pulse));
      P(g, 16, 24, '#FFE2D8'); P(g, 15, 23, '#FFE2D8');
    } else {
      ell(g, 16, 24, 4, 3, '#1A1E24'); R(g, 13, 24, 6, 1, '#3A3F48');
    }
    // Splitter
    if (!disabled) { var o = f % 4; P(g, 3, 8 + o, PAL.eisblau); P(g, 28, 14 - o, PAL.eisblau); }
    finish(c, '#141A24', [16, 45, 13, 2]);
  }
  function buildLockedDoor(g, c, orient, open) {
    var capBase = '#2A3542', rim = '#7D97AD';
    if (open) {
      if (orient === 'v') {
        R(g, 0, 0, 32, 4, capBase); R(g, 0, 3, 32, 1, rim); R(g, 0, 28, 32, 4, capBase); R(g, 0, 28, 32, 1, rim);
        R(g, 14, 1, 4, 2, PAL.mint);
        for (var y = 4; y < 28; y += 4) { R(g, 0, y, 2, 2, PAL.warngelb); R(g, 30, y, 2, 2, PAL.warngelb); }
      } else {
        R(g, 0, 0, 4, 32, capBase); R(g, 3, 0, 1, 32, rim); R(g, 28, 0, 4, 32, capBase); R(g, 28, 0, 1, 32, rim);
        R(g, 1, 14, 2, 4, PAL.mint);
      }
      return;
    }
    // geschlossen: kalte, schwere Schotttür (wirkt wie Wandstück mit Front)
    R(g, 0, 0, 32, CAP_H, capBase); R(g, 0, 0, 32, 1, rim); R(g, 0, CAP_H - 1, 32, 1, rim);
    R(g, 2, 2, 28, CAP_H - 4, '#333F4E');
    var y0 = CAP_H;
    R(g, 0, y0, 32, 32 - y0, '#4A5A70');
    R(g, 0, y0, 32, 1, '#8EA3B5');
    R(g, 15, y0, 2, 32 - y0, '#232A35');
    for (var x = 0; x < 32; x += 6) { R(g, x, y0 + 13, 3, 3, PAL.warngelb); R(g, x + 3, y0 + 13, 3, 3, '#1F2630'); }
    R(g, 11, y0 + 3, 10, 7, '#1E2631'); R(g, 12, y0 + 4, 8, 5, '#3A1414');
    R(g, 14, y0 + 5, 4, 3, PAL.alarmrot); P(g, 14, y0 + 5, '#FFB0A0');
    R(g, 0, 29, 32, 3, '#232A35');
  }

  // --- Deko -------------------------------------------------------------------------------------
  function buildPoster(g, c) {
    R(g, 9, 38, 2, 9, '#5A3824'); R(g, 21, 38, 2, 9, '#5A3824'); line(g, 16, 38, 16, 46, '#5A3824');
    R(g, 5, 14, 22, 26, PAL.messing); R(g, 5, 14, 22, 1, '#F1D9A0'); R(g, 26, 14, 1, 26, '#7A5A28');
    R(g, 7, 16, 18, 22, '#1A1F3E');
    var r = rng(77);
    for (var i = 0; i < 9; i++) P(g, 8 + r() * 16, 17 + r() * 20, i % 3 ? '#8E94B8' : PAL.sternweiss);
    line(g, 9, 34, 14, 26, PAL.bernstein); line(g, 14, 26, 20, 28, PAL.bernstein); line(g, 20, 28, 23, 19, PAL.bernstein);
    P(g, 14, 26, PAL.funke); P(g, 20, 28, PAL.funke); P(g, 23, 19, PAL.mint);
    ell(g, 11, 21, 2, 2, PAL.terrakotta);
    finish(c, PAL.outlineWarm, [16, 46, 8, 2]);
  }
  function buildLamp(g, c) {
    ell(g, 16, 45, 5, 2, '#7A5A28'); ell(g, 16, 44, 5, 2, PAL.messing);
    R(g, 15, 18, 2, 26, '#8A6530'); R(g, 15, 18, 1, 26, PAL.messing);
    poly(g, [9, 18, 23, 18, 20, 9, 12, 9], '#E3B565');
    poly(g, [10, 17, 15, 17, 14, 10, 12.5, 10], '#F6D9A0');
    R(g, 9, 18, 14, 2, '#8A6530');
    R(g, 13, 20, 6, 2, '#FFE9B0');
    finish(c, PAL.outlineWarm, [16, 46, 7, 2]);
  }
  function buildRug(g, c) {
    var cols = [PAL.terrakotta, '#5BA8A0', PAL.bernstein, PAL.moos, '#B66A8E', '#C9974A'];
    R(g, 2, 24, 28, 20, '#5A3824');
    for (var y = 0; y < 3; y++) for (var x = 0; x < 4; x++) {
      var col = cols[(x * 2 + y * 3) % cols.length];
      R(g, 3 + x * 7, 25 + y * 6, 6, 5, col);
      R(g, 3 + x * 7, 25 + y * 6, 6, 1, shade(col, 0.25));
      if ((x + y) % 2) { P(g, 5 + x * 7, 27 + y * 6, shade(col, -0.3)); P(g, 7 + x * 7, 27 + y * 6, shade(col, -0.3)); }
    }
    for (var fx = 3; fx < 30; fx += 2) { P(g, fx, 23, '#E8DCC0'); P(g, fx, 44, '#E8DCC0'); }
  }

  function drawObject(ctx, kind, px, py, opts) {
    var o = opts || {};
    px = Math.round(px); py = Math.round(py);
    var t = o.time || 0, spr, memo;
    switch (kind) {
      case 'console_helm': case 'console_captain': case 'console_weapons': case 'console_transfer': case 'terminal_shop':
        drawConsole(ctx, kind, px, py, o); return;
      case 'terminal_spare': {   // ausgeschaltet: kein Leuchten
        var tf = frameOf(o.time, 1, 8);
        spr = cached('obj|terminal_spare|' + tf, 32, 48, function (g, c) { buildConsole(g, c, 'terminal_spare', tf, 0); });
        ctx.drawImage(spr, px, py - OH); return;
      }
      case 'shelf':
        drawShelf(ctx, px, py, o); return;
      case 'pipes': {
        var pv = o.variant ? 1 : 0, pfr = frameOf(t + px * 0.01, 3, 16);
        spr = cached('obj|pipes|' + pv + '|' + pfr, 32, 48, function (g, c) { buildPipes(g, c, pv, pfr); });
        ctx.drawImage(spr, px, py - OH);
        drawSteam(ctx, px + 28, py - OH + 3, t, (px >> 5) + pv);
        return;
      }
      case 'workbench':
        spr = cached('obj|workbench', 32, 48, buildWorkbench);
        ctx.drawImage(spr, px, py - OH);
        glow(ctx, px + 16, py - OH + 10, PAL.bernstein, 14, 0.12);
        return;
      case 'control_desk': {
        var cf = frameOf(t + px * 0.003, 6, 8);
        spr = cached('obj|control_desk|' + cf, 32, 48, function (g, c) { buildControlDesk(g, c, cf); });
        ctx.drawImage(spr, px, py - OH);
        glow(ctx, px + 25, py - OH + 21, PAL.mint, 9, 0.22 + 0.06 * Math.sin(t * 3));
        return;
      }
      case 'barrel': {
        var bv = o.variant ? 1 : 0;
        spr = cached('obj|barrel|' + bv, 32, 48, function (g, c) { buildBarrel(g, c, bv); });
        ctx.drawImage(spr, px, py - OH); return;
      }
      case 'bed': {
        var col = (o.color | 0) === 3 ? 3 : (((o.color | 0) % 3) + 3) % 3;
        spr = cached('obj|bed|' + col, 32, 48, function (g, c) { buildBed(g, c, col); });
        ctx.drawImage(spr, px, py - OH); return;
      }
      // M3a: neue/überarbeitete Stationen (CONTRACT-M3 §12); alte Stationen mit derselben Zustandsdekoration
      case 'sys_reactor': case 'sys_engines': case 'sys_shields': case 'sys_thruster': case 'sys_battery': case 'sys_emitter': case 'sys_weapon_bow':
        drawSystemM3(ctx, kind, px, py, o); return;
      case 'sys_weapons': case 'sys_transfer': case 'sys_life':
        drawSystemLegacy(ctx, kind, px, py, o); return;
      case 'table': {
        memo = tileMemo.get(memoKey(px, py));
        var l = o.left != null ? !!o.left : !!(memo && memo.ch === 'm' && memo.l);
        var r = o.right != null ? !!o.right : !!(memo && memo.ch === 'm' && memo.r);
        var tf = frameOf(t, 3, 2);
        spr = cached('obj|table|' + (+l) + (+r) + '|' + tf, 32, 48, function (g, c) { buildTable(g, c, l, r, tf); });
        ctx.drawImage(spr, px, py - OH); return;
      }
      case 'plant': case 'deco_pflanze': {
        var small = kind === 'deco_pflanze', pf = frameOf(t + px * 0.01, 1.2, 2);
        spr = cached('obj|' + kind + '|' + pf, 32, 48, function (g, c) { buildPlant(g, c, pf, small); });
        ctx.drawImage(spr, px, py - OH); return;
      }
      case 'crate': {
        var cv = o.variant ? 1 : 0;
        spr = cached('obj|crate|' + cv, 32, 48, function (g, c) { buildCrate(g, c, cv); });
        ctx.drawImage(spr, px, py - OH); return;
      }
      case 'buoy_core': {
        memo = tileMemo.get(memoKey(px, py));
        var bf = frameOf(t, 6, 8);
        var core = cached('obj|buoy_core|' + bf, 64, 80, function (g, c) { buildBuoyCore(g, c, bf); });
        var qx = o.qx != null ? o.qx : memo && memo.ch === 'b' ? memo.qx : -1;
        var qy = o.qy != null ? o.qy : memo && memo.ch === 'b' ? memo.qy : -1;
        if (qx < 0) {  // ohne Lageinfo: verkleinerter Kern in einer Kachel
          ctx.drawImage(core, px, py - 8, 32, 40);
        } else if (qy === 0) {
          ctx.drawImage(core, qx * 32, 0, 32, 48, px, py - OH, 32, 48);
        } else {
          ctx.drawImage(core, qx * 32, 48, 32, 32, px, py, 32, 32);
        }
        if (qx === 1 && qy === 1 || qx < 0) glow(ctx, qx < 0 ? px + 16 : px, qx < 0 ? py + 8 : py - 8, PAL.mint, 30, 0.25 + 0.1 * Math.sin(t * 2.5));
        return;
      }
      case 'sonde': {
        var dis = !!o.disabled, sf = frameOf(t, 4, 4);
        spr = cached('obj|sonde|' + (+dis) + '|' + sf, 32, 48, function (g, c) { buildSonde(g, c, sf, dis); });
        ctx.drawImage(spr, px, py - OH);
        if (!dis) glow(ctx, px + 16, py - OH + 24, PAL.alarmrot, 10, 0.3 + 0.2 * Math.sin(t * 4));
        return;
      }
      case 'door_locked': {
        memo = tileMemo.get(memoKey(px, py));
        var orient = o.orient || (memo && memo.ch === 'L' ? memo.orient : 'v');
        var open = !!(o.open || o.disabled);
        spr = cached('obj|door_locked|' + orient + '|' + (+open), 32, 32, function (g, c) { buildLockedDoor(g, c, orient, open); });
        ctx.drawImage(spr, px, py);
        if (!open) glow(ctx, px + 16, py + CAP_H + 6, PAL.alarmrot, 8, 0.25 + 0.15 * Math.sin(t * 5));
        return;
      }
      case 'deco_poster':
        spr = cached('obj|deco_poster', 32, 48, buildPoster); ctx.drawImage(spr, px, py - OH); return;
      case 'deco_lampe':
        spr = cached('obj|deco_lampe', 32, 48, buildLamp); ctx.drawImage(spr, px, py - OH);
        glow(ctx, px + 16, py - OH + 22, PAL.bernstein, 22, 0.35 + 0.04 * Math.sin(t * 2));
        return;
      case 'deco_teppich':
        spr = cached('obj|deco_teppich', 32, 48, buildRug); ctx.drawImage(spr, px, py - OH); return;
      default:
        if (!drawObjectM4(ctx, kind, px, py, o) && !drawObjectM1(ctx, kind, px, py, o) && !drawObjectKesh(ctx, kind, px, py, o)) missing(ctx, px, py, 32, 32);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // M4 Stufe 1 „Zwei Decks“ (Team DECKS): schlichte 2D-Zeichnung der neuen Kachelarten für ?render=2d.
  // Bodenkacheln (drawTile): '^' Liftplattform, '!' Notleiter, ':' Mosaikboden. Objekte (drawObject): light_shaft, window,
  // trophy_niche, shrine, med_bed, bath, bench, sideboard. Alles in der Kachel (32×32), gecacht.
  function drawDeckTileM4(ctx, ch, px, py, env, plat) {
    var time = env.time || 0;
    if (ch === ':') {   // Mosaik: karierter heller Boden mit feinem Rand
      var v = ((env.tx | 0) + (env.ty | 0)) % 2;
      ctx.drawImage(cached('m4|mosaic|' + v, 32, 32, function (g) {
        R(g, 0, 0, 32, 32, '#C9B79A');
        for (var y = 0; y < 4; y++) for (var x = 0; x < 4; x++) if ((x + y + v) % 2) R(g, x * 8, y * 8, 8, 8, '#B19C7C');
        R(g, 0, 0, 32, 1, '#DCCDB2'); R(g, 0, 0, 1, 32, '#DCCDB2');
        R(g, 12, 12, 8, 8, '#9E4A36'); R(g, 14, 14, 4, 4, '#D9A441');   // kleines Mittelornament
      }), px, py);
      return;
    }
    drawFloorAt(ctx, 'metal', px, py, env, plat);
    if (ch === '!') {   // Notleiter: Schachtöffnung mit Sprossen
      ctx.drawImage(cached('m4|ladder', 32, 32, function (g) {
        R(g, 6, 2, 20, 28, '#1A1E26');
        R(g, 6, 2, 3, 28, '#8A6A3A'); R(g, 23, 2, 3, 28, '#8A6A3A');
        for (var y = 5; y < 30; y += 5) { R(g, 9, y, 14, 2, '#C9A25A'); R(g, 9, y + 2, 14, 1, '#4A3820'); }
        R(g, 5, 1, 22, 1, '#F2C94C');
      }), px, py);
      return;
    }
    // Lift: Gitterplattform mit Pfeilen hoch/runter; Pfeile blinken leicht
    var blink = ((time * 2) | 0) % 2;
    ctx.drawImage(cached('m4|lift|' + blink, 32, 32, function (g) {
      R(g, 1, 1, 30, 30, '#2C333F');
      for (var i = 3; i < 30; i += 4) { R(g, i, 2, 1, 28, '#465063'); R(g, 2, i, 28, 1, '#465063'); }
      R(g, 1, 1, 30, 1, '#C9A25A'); R(g, 1, 30, 30, 1, '#6A5230'); R(g, 1, 1, 1, 30, '#C9A25A'); R(g, 30, 1, 1, 30, '#6A5230');
      var col = blink ? '#7FE0C2' : '#5FB89E';
      for (var k = 0; k < 4; k++) { R(g, 15 - k, 5 + k, 2 + k * 2, 1, col); R(g, 15 - k, 26 - k, 2 + k * 2, 1, col); }   // ▲ ▼
      R(g, 15, 9, 2, 4, col); R(g, 15, 19, 2, 4, col);
    }), px, py);
  }
  function drawObjectM4(ctx, kind, px, py, o) {
    var spr = null;
    switch (kind) {
      case 'light_shaft': spr = cached('m4|shaft', 32, 32, function (g) {
        R(g, 0, 0, 32, 32, '#6E5A3E'); R(g, 3, 3, 26, 26, '#9FD3E0'); R(g, 3, 3, 26, 2, '#E8F8FF');
        R(g, 6, 8, 10, 1, '#D8F0F8'); R(g, 14, 18, 12, 1, '#D8F0F8');
        R(g, 0, 0, 32, 2, '#C9A25A'); R(g, 0, 30, 32, 2, '#8A6A3A');   // Geländer
      }); break;
      case 'window': spr = cached('m4|window', 32, 32, function (g) {
        R(g, 0, 0, 32, 32, '#3A3F4C'); R(g, 3, 4, 26, 24, '#0E1630');
        R(g, 7, 9, 1, 1, '#F4EEDC'); R(g, 20, 14, 1, 1, '#F4EEDC'); R(g, 13, 22, 1, 1, '#BFD8FF');
        R(g, 3, 4, 26, 1, '#5A6A8A'); R(g, 15, 4, 2, 24, '#8A6A3A');
      }); break;
      case 'trophy_niche': spr = cached('m4|trophy', 32, 32, function (g) {
        R(g, 3, 2, 26, 28, '#E6DCC6'); R(g, 7, 6, 18, 18, '#4A3828'); R(g, 7, 6, 18, 2, '#B19C7C');
        ell(g, 16, 16, 4, 5, '#D9A441'); R(g, 12, 22, 8, 2, '#8A6A3A'); R(g, 3, 28, 26, 2, '#B19C7C');
      }); break;
      case 'shrine': spr = cached('m4|shrine', 32, 32, function (g) {
        R(g, 6, 8, 20, 22, '#E6DCC6'); R(g, 4, 4, 24, 5, '#9E4A36'); R(g, 10, 13, 12, 12, '#4A3828');
        ell(g, 16, 19, 2, 3, '#F2A33C'); R(g, 15, 22, 2, 3, '#C9A25A'); R(g, 6, 28, 20, 2, '#B19C7C');
      }); break;
      case 'med_bed': spr = cached('m4|medbed', 32, 32, function (g) {
        R(g, 4, 3, 24, 26, '#8A9AA8'); R(g, 6, 5, 20, 22, '#F4EEDC'); R(g, 8, 6, 16, 6, '#DCE6EE');
        R(g, 14, 16, 4, 8, '#9E4A36'); R(g, 12, 18, 8, 4, '#9E4A36');   // rotes Kreuz
      }); break;
      case 'bath': spr = cached('m4|bath', 32, 32, function (g) {
        R(g, 2, 2, 28, 28, '#E6DCC6'); R(g, 5, 5, 22, 22, '#4E8FA6'); R(g, 5, 5, 22, 2, '#9FD3E0'); R(g, 8, 14, 8, 1, '#BFE6F0');
      }); break;
      case 'bench': spr = cached('m4|bench', 32, 32, function (g) {
        R(g, 3, 12, 26, 9, '#8A5A36'); R(g, 3, 12, 26, 2, '#B07A4C'); R(g, 5, 21, 3, 6, '#5A3824'); R(g, 24, 21, 3, 6, '#5A3824');
      }); break;
      case 'sideboard': spr = cached('m4|sideboard', 32, 32, function (g) {
        R(g, 2, 6, 28, 22, '#6A4228'); R(g, 2, 6, 28, 3, '#E6DCC6'); R(g, 4, 12, 11, 14, '#7E5232'); R(g, 17, 12, 11, 14, '#7E5232');
        R(g, 13, 18, 2, 2, '#D9A441'); R(g, 17, 18, 2, 2, '#D9A441'); ell(g, 9, 4, 3, 2, '#9E4A36');   // Amphore
      }); break;
      default: return false;
    }
    ctx.drawImage(spr, px, py);
    return true;
  }

  // ---------------------------------------------------------------------------------------------
  // FIGUREN (24×40, Füße bei (12, 39))
  // ---------------------------------------------------------------------------------------------
  var CREW = [
    { skin: '#F1C7A0', hair: '#6B3F26', hairL: '#9A6340', shirt: '#56B4E9', shirtL: '#8FD0F2', shirtD: '#2F7FB0', style: 'short', shape: 'circle' },
    { skin: '#9C6440', hair: '#2E2233', hairL: '#4A3A50', shirt: '#E69F00', shirtL: '#F5BE45', shirtD: '#A86F00', style: 'band', shape: 'triangle' },
    { skin: '#F8DCC4', hair: '#B4573E', hairL: '#E07A50', shirt: '#CC79A7', shirtL: '#E6A3C8', shirtD: '#94507A', style: 'long', shape: 'diamond' },
  ];
  var TECH = { skin: '#C68A5E', hair: '#9A9AA4', hairL: '#C8C8D0', shirt: '#5E8C4A', shirtL: '#7FAE66', shirtD: '#3F6532', style: 'cap', shape: null, beard: true };
  var PANTS = '#2E3A4A', PANTS_D = '#1F2833', BOOTS = '#4A2E22', BELT = '#C9974A';
  function sym3(g, shape, x, y, col) {
    var m = { circle: ['.#.', '###', '.#.'], triangle: ['.#.', '###', '###'], diamond: ['.#.', '#.#', '.#.'] }[shape];
    if (m) grid(g, x, y, m, { '#': col });
  }
  function wrench(g, x, y, ang) {   // kleiner Schraubenschlüssel ab (x,y) in Richtung ang
    var dx = Math.cos(ang), dy = Math.sin(ang);
    for (var i = 0; i < 6; i++) P(g, x + dx * i, y + dy * i, i < 5 ? '#A9BACB' : '#6C7F96');
    var hx = x + dx * 6, hy = y + dy * 6;
    P(g, hx - dy, hy + dx, '#C8D6E2'); P(g, hx + dy, hy - dx, '#C8D6E2'); P(g, hx + dx, hy + dy, '#6C7F96');
  }
  function buildHuman(g, c, S, dir, pose, f, closedEyes) {
    var skinD = shade(S.skin, -0.18);
    var walk = pose === 'walk' || pose === 'carrywalk';
    var bob = 0, lLift = 0, rLift = 0, swing = 0;
    if (walk) { bob = (f % 2 === 1) ? -1 : 0; lLift = f === 1 ? 2 : 0; rLift = f === 3 ? 2 : 0; swing = f === 1 ? 1 : f === 3 ? -1 : 0; }
    if (pose === 'idle' && f === 1) bob = 1;
    if (pose === 'console') bob = 0;
    var B = bob;
    var sit = pose === 'sit';
    if (sit) B = 4 + (f === 1 ? 1 : 0);   // M1: sitzt (Oberkörper tiefer, leichtes Atmen)
    var arms = pose === 'carry' || pose === 'carrywalk' ? 'up' : pose === 'console' || sit ? 'fwd' : pose === 'repair' ? 'repair' : 'side';

    if (dir === 'right') {
      // ---- Seitenansicht (nach rechts) ----
      // Beine
      var fl = walk ? (f === 1 ? 2 : f === 3 ? -2 : 0) : 0;
      function sideLeg(ox, lift, dark) {
        R(g, 10 + ox, 30, 4, 6 - lift, dark ? PANTS_D : PANTS);
        R(g, 10 + ox, 36 - lift, 5, 3, dark ? '#3A2218' : BOOTS);
        P(g, 14 + ox, 36 - lift, dark ? '#3A2218' : '#6A4232');
      }
      if (sit) {   // Oberschenkel waagrecht nach vorn, Unterschenkel senkrecht
        R(g, 9, 32, 9, 4, PANTS); R(g, 9, 32, 9, 1, '#3B4A5E');
        R(g, 15, 35, 3, 2, PANTS_D); R(g, 15, 37, 5, 2, BOOTS); P(g, 19, 37, '#6A4232');
      } else {
        sideLeg(-fl, f === 3 && walk ? 1 : 0, true);
        sideLeg(fl, f === 1 && walk ? 1 : 0, false);
      }
      // Rumpf
      R(g, 8, 20 + B, 8, 9, S.shirt); R(g, 8, 20 + B, 2, 9, S.shirtD); R(g, 14, 20 + B, 2, 9, S.shirtL);
      R(g, 8, 28 + B, 8, 2, BELT); P(g, 15, 28 + B, '#F1D9A0');
      if (S.beard) { R(g, 8, 27 + B, 3, 2, '#3A3020'); }
      // Kopf
      R(g, 7, 7 + B, 11, 12, S.skin); R(g, 8, 18 + B, 9, 1, S.skin); R(g, 11, 19 + B, 3, 1, skinD);
      P(g, 18, 13 + B, S.skin); P(g, 18, 14 + B, skinD);             // Nase
      if (closedEyes) { P(g, 15, 12 + B, '#2B1D1A'); P(g, 16, 13 + B, '#2B1D1A'); }
      else { R(g, 15, 11 + B, 1, 2, '#2B1D1A'); }
      P(g, 15, 15 + B, '#E89A7A'); P(g, 16, 16 + B, skinD);
      // Haare
      if (S.style === 'cap') {
        R(g, 6, 3 + B, 12, 5, S.shirtD); R(g, 7, 3 + B, 9, 1, S.shirt); R(g, 12, 7 + B, 8, 2, shade(S.shirtD, -0.2));
        R(g, 6, 8 + B, 4, 6, S.hair); P(g, 7, 9 + B, S.hairL);
        R(g, 12, 15 + B, 5, 3, S.hair); P(g, 17, 16 + B, S.hair);
      } else {
        R(g, 6, 3 + B, 12, 5, S.hair); R(g, 6, 8 + B, 5, 6, S.hair); R(g, 8, 4 + B, 5, 1, S.hairL);
        R(g, 13, 7 + B, 4, 1, S.hair);
        if (S.style === 'long') { R(g, 5, 8 + B, 5, 12, S.hair); R(g, 6, 10 + B, 1, 8, S.hairL); }
        if (S.style === 'band') { R(g, 6, 7 + B, 12, 2, BELT); R(g, 15, 7 + B, 3, 2, PAL.mint); P(g, 7, 7 + B, '#F1D9A0'); }
      }
      // Arm (nah)
      if (arms === 'up') {
        R(g, 11, 8 + B, 3, 13, S.shirt); R(g, 11, 8 + B, 1, 13, S.shirtL); R(g, 11, 6 + B, 3, 2, S.skin);
      } else if (arms === 'fwd') {
        var hy = f === 1 ? 1 : 0;
        R(g, 10, 21 + B, 3, 3, S.shirt); R(g, 12, 23 + B, 5, 2, S.shirt); R(g, 17, 23 + B - hy, 2, 2, S.skin);
      } else if (arms === 'repair') {
        var ang = [-0.9, 0, 0.8][f % 3];
        R(g, 10, 21 + B, 3, 3, S.shirt);
        var ex = 13 + Math.cos(ang) * 3, ey = 23 + B + Math.sin(ang) * 3;
        R(g, 12, 22 + B, 2, 2, S.shirt); R(g, ex, ey, 2, 2, S.skin);
        wrench(g, ex + 1, ey, ang - 0.3);
      } else {
        R(g, 10 + swing, 21 + B, 3, 5, S.shirt); R(g, 10 + swing, 21 + B, 1, 5, S.shirtL); R(g, 10 + swing, 26 + B, 3, 2, S.skin);
      }
      if (S.shape && arms !== 'up') sym3(g, S.shape, 10 + (arms === 'side' ? swing : 0), 21 + B, PAL.sternweiss);
      return;
    }

    // ---- Front- / Rückansicht ----
    var back = dir === 'up';
    // Beine + Stiefel
    if (sit && back) {
      // von hinten: Beine verdeckt, nur Stiefelspitzen seitlich
      R(g, 5, 36, 3, 2, BOOTS); R(g, 16, 36, 3, 2, BOOTS);
    } else if (sit) {
      // von vorn: Knie zum Betrachter (kurz), Stiefel darunter
      R(g, 6, 33, 5, 3, PANTS); R(g, 13, 33, 5, 3, PANTS); R(g, 6, 33, 5, 1, '#3B4A5E'); R(g, 13, 33, 5, 1, '#3B4A5E');
      R(g, 6, 36, 5, 3, BOOTS); R(g, 13, 36, 5, 3, BOOTS); P(g, 7, 36, '#6A4232'); P(g, 14, 36, '#6A4232');
    } else {
      R(g, 7, 30, 4, 6 - lLift, PANTS); R(g, 13, 30, 4, 6 - rLift, PANTS);
      R(g, 7, 30, 1, 6 - lLift, '#3B4A5E'); R(g, 16, 30, 1, 6 - rLift, PANTS_D);
      R(g, 6, 36 - lLift, 5, 3, BOOTS); R(g, 13, 36 - rLift, 5, 3, BOOTS);
      P(g, 7, 36 - lLift, '#6A4232'); P(g, 14, 36 - rLift, '#6A4232');
    }
    // Rumpf
    R(g, 6, 20 + B, 12, 9, S.shirt);
    R(g, 6, 20 + B, 2, 9, S.shirtL); R(g, 16, 20 + B, 2, 9, S.shirtD);
    R(g, 6, 28 + B, 12, 2, BELT);
    if (!back) { R(g, 11, 28 + B, 2, 2, '#F1D9A0'); R(g, 10, 20 + B, 4, 1, S.skin); P(g, 11, 21 + B, S.skin); P(g, 12, 21 + B, S.skin); }
    if (S.style === 'cap' && !back) { R(g, 14, 25 + B, 3, 3, '#6E4E22'); P(g, 15, 25 + B, '#A9BACB'); }
    if (S.shape) {
      if (back) symbolPix(g, S.shape, 10, 22 + B, PAL.sternweiss);
      else symbolPix(g, S.shape, 7, 21 + B, PAL.sternweiss);
    }
    // Kopf
    R(g, 6, 7 + B, 12, 12, S.skin); R(g, 7, 19 + B, 10, 0, S.skin);
    R(g, 10, 19 + B, 4, 1, skinD);
    if (!back) {
      if (closedEyes) {
        P(g, 8, 12 + B, '#2B1D1A'); P(g, 9, 13 + B, '#2B1D1A'); P(g, 9, 12 + B, '#2B1D1A'); P(g, 8, 13 + B, '#2B1D1A');
        P(g, 14, 12 + B, '#2B1D1A'); P(g, 15, 13 + B, '#2B1D1A'); P(g, 15, 12 + B, '#2B1D1A'); P(g, 14, 13 + B, '#2B1D1A');
      } else {
        R(g, 9, 12 + B, 1, 2, '#2B1D1A'); R(g, 14, 12 + B, 1, 2, '#2B1D1A');
        P(g, 9, 12 + B, '#4A3A30');
      }
      P(g, 7, 15 + B, '#E89A7A'); P(g, 16, 15 + B, '#E89A7A');
      R(g, 11, 16 + B, 2, 1, skinD);
    }
    // Haare
    if (S.style === 'cap') {
      R(g, 5, 3 + B, 14, 5, S.shirtD); R(g, 6, 3 + B, 10, 1, S.shirt); R(g, 11, 4 + B, 2, 2, BELT);
      if (!back) { R(g, 5, 8 + B, 14, 2, shade(S.shirtD, -0.2)); R(g, 5, 10 + B, 2, 4, S.hair); R(g, 17, 10 + B, 2, 4, S.hair); }
      else { R(g, 5, 8 + B, 14, 9, S.hair); R(g, 7, 9 + B, 3, 1, S.hairL); }
      if (S.beard && !back) { R(g, 7, 15 + B, 10, 3, S.hair); R(g, 9, 18 + B, 6, 1, S.hair); R(g, 10, 16 + B, 4, 1, shade(S.skin, -0.3)); }
    } else if (back) {
      R(g, 5, 3 + B, 14, 15, S.hair); R(g, 7, 4 + B, 4, 1, S.hairL); R(g, 13, 6 + B, 3, 1, S.hairL); R(g, 8, 10 + B, 1, 4, S.hairL);
      if (S.style === 'long') { R(g, 4, 7 + B, 16, 14, S.hair); R(g, 7, 12 + B, 1, 7, S.hairL); R(g, 15, 11 + B, 1, 6, S.hairL); }
      if (S.style === 'band') { R(g, 5, 7 + B, 14, 2, BELT); P(g, 11, 7 + B, '#F1D9A0'); }
    } else {
      R(g, 5, 3 + B, 14, 5, S.hair); R(g, 7, 4 + B, 3, 1, S.hairL); P(g, 7, 5 + B, S.hairL);
      if (S.style === 'short') { R(g, 6, 8 + B, 4, 1, S.hair); R(g, 13, 8 + B, 5, 1, S.hair); R(g, 5, 8 + B, 2, 5, S.hair); R(g, 17, 8 + B, 2, 4, S.hair); }
      if (S.style === 'long') { R(g, 5, 8 + B, 6, 2, S.hair); R(g, 14, 8 + B, 4, 1, S.hair); R(g, 4, 7 + B, 3, 13, S.hair); R(g, 17, 7 + B, 3, 13, S.hair); R(g, 5, 9 + B, 1, 9, S.hairL); }
      if (S.style === 'band') { R(g, 5, 7 + B, 14, 2, BELT); R(g, 7, 7 + B, 3, 2, PAL.mint); R(g, 14, 7 + B, 3, 2, PAL.mint); P(g, 7, 7 + B, '#E8FFF8'); P(g, 14, 7 + B, '#E8FFF8'); R(g, 5, 9 + B, 1, 4, S.hair); R(g, 18, 9 + B, 1, 4, S.hair); }
    }
    // Arme
    if (arms === 'up') {
      R(g, 3, 6 + B, 2, 15, S.shirt); R(g, 19, 6 + B, 2, 15, S.shirt); R(g, 3, 6 + B, 1, 15, S.shirtL); R(g, 20, 6 + B, 1, 15, S.shirtD);
      R(g, 3, 4 + B, 2, 2, S.skin); R(g, 19, 4 + B, 2, 2, S.skin);
    } else if (arms === 'fwd') {
      if (back) {
        R(g, 4, 21 + B, 2, 3, S.shirt); R(g, 18, 21 + B, 2, 3, S.shirt);
        R(g, 5, 23 + B - (f === 1 ? 1 : 0), 2, 2, S.shirt); R(g, 17, 23 + B - (f === 0 ? 1 : 0), 2, 2, S.shirt);
      } else {
        R(g, 4, 21 + B, 2, 4, S.shirt); R(g, 18, 21 + B, 2, 4, S.shirt);
        R(g, 6, 24 + B - (f === 1 ? 1 : 0), 3, 2, S.skin); R(g, 15, 24 + B - (f === 0 ? 1 : 0), 3, 2, S.skin);
      }
    } else if (arms === 'repair') {
      R(g, 4, 21 + B, 2, 5, S.shirt); R(g, 4, 26 + B, 2, 2, S.skin);
      var hyy = [16, 22, 27][f % 3];
      R(g, 18, 21 + B, 2, Math.max(2, hyy - 21), S.shirt);
      R(g, 18, hyy + B, 2, 2, S.skin);
      wrench(g, 20, hyy + B, [-1.2, -0.2, 0.7][f % 3]);
    } else {
      R(g, 4, 21 + B + swing, 2, 5, S.shirt); R(g, 18, 21 + B - swing, 2, 5, S.shirt);
      R(g, 4, 21 + B + swing, 1, 5, S.shirtL); R(g, 19, 21 + B - swing, 1, 5, S.shirtD);
      R(g, 4, 26 + B + swing, 2, 2, S.skin); R(g, 18, 26 + B - swing, 2, 2, S.skin);
    }
  }
  function humanSprite(S, sid, dir, pose, f, closed) {
    var d = dir === 'left' ? 'right' : dir;
    var key = 'hum|' + sid + '|' + d + '|' + pose + '|' + f + '|' + (closed ? 1 : 0);
    var base = cached(key, 24, 40, function (g, c) { buildHuman(g, c, S, d, pose, f, closed); outline(c, PAL.outlineWarm); });
    if (dir !== 'left') return base;
    var k2 = key + '|L', hit = cache.get(k2);
    if (!hit) { hit = flipH(base); cache.set(k2, hit); }
    return hit;
  }
  function downedSprite(S, sid) {
    return cached('hum|' + sid + '|downed', 40, 24, function (g) {
      var src = humanSprite(S, sid, 'down', 'idle', 0, true);
      g.translate(40, 0); g.rotate(Math.PI / 2); g.drawImage(src, 0, 0);
    });
  }
  // M2 §15: Duck-Pose (kniend). Oberkörper und Kopf der Standpose 10 px tiefer, Knie und Stiefel seitlich sichtbar.
  function crouchSprite(S, sid, dir, pose, f) {
    var d = dir === 'left' ? 'right' : dir;
    var key = 'hum|' + sid + '|crouch|' + d + '|' + pose + '|' + f;
    var base = cached(key, 24, 40, function (g, c) {
      var src = humanSprite(S, sid, d, pose, f, false);
      var side = d === 'right', back = d === 'up';
      var KL = '#3B4A5E';
      // Kopf + Rumpf (Zeilen 0..29 der Standpose) 8 px tiefer
      g.drawImage(src, 0, 0, 24, 30, 0, 8, 24, 30);
      // Beine angewinkelt
      if (side) {
        g.fillStyle = BOOTS; g.fillRect(4, 37, 6, 2);                                   // hinteres Knie am Boden
        g.fillStyle = PANTS; g.fillRect(9, 33, 9, 3); g.fillStyle = KL; g.fillRect(9, 33, 9, 1);   // Oberschenkel nach vorn
        g.fillStyle = PANTS; g.fillRect(15, 35, 3, 3);                                  // Schienbein
        g.fillStyle = BOOTS; g.fillRect(14, 37, 7, 2); g.fillStyle = '#6A4232'; g.fillRect(19, 37, 2, 1);
      } else if (back) {
        g.fillStyle = BOOTS; g.fillRect(4, 37, 6, 2); g.fillRect(14, 37, 6, 2);
      } else {
        g.fillStyle = PANTS; g.fillRect(4, 33, 6, 4); g.fillRect(14, 33, 6, 4);          // Knie zum Betrachter
        g.fillStyle = KL; g.fillRect(4, 33, 6, 1); g.fillRect(14, 33, 6, 1);
        g.fillStyle = PANTS_D; g.fillRect(9, 34, 1, 3); g.fillRect(14, 34, 1, 3);
        g.fillStyle = BOOTS; g.fillRect(4, 37, 6, 2); g.fillRect(14, 37, 6, 2);
        g.fillStyle = '#6A4232'; g.fillRect(5, 37, 1, 1); g.fillRect(15, 37, 1, 1);
      }
      outline(c, PAL.outlineWarm);
    });
    if (dir !== 'left') return base;
    var k2 = key + '|L', hit = cache.get(k2);
    if (!hit) { hit = flipH(base); cache.set(k2, hit); }
    return hit;
  }
  function shadowSprite(w) {
    return cached('shadow|' + w, w + 2, 6, function (g) { ell(g, (w + 2) / 2, 3, w / 2, 2.2, 'rgba(11,14,26,0.38)'); });
  }
  var scratch = null;
  function getScratch(w, h) {
    if (!scratch || scratch.width < w || scratch.height < h) scratch = mk(Math.max(w, scratch ? scratch.width : 0), Math.max(h, scratch ? scratch.height : 0));
    scratch.g.clearRect(0, 0, scratch.width, scratch.height);
    return scratch;
  }
  // Sprite mit Effekten (Blitz, Beamen) zeichnen
  function drawFxSprite(ctx, spr, dx, dy, o) {
    var beam = o.beam || 0, flash = o.flash ? (typeof o.flash === 'number' ? o.flash : 1) : 0;
    if (beam <= 0 && flash <= 0) { ctx.drawImage(spr, dx, dy); return; }
    if (beam >= 1) return;
    var s = getScratch(spr.width, spr.height), g = s.g;
    g.globalCompositeOperation = 'source-over';
    g.drawImage(spr, 0, 0);
    if (flash > 0) { g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(255,255,255,' + Math.min(0.85, flash) + ')'; g.fillRect(0, 0, spr.width, spr.height); }
    if (beam > 0) {
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = rgba(PAL.mint, Math.min(0.85, beam * 1.4));
      g.fillRect(0, 0, spr.width, spr.height);
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = '#000';
      for (var y = 0; y < spr.height; y += 2) {
        if (hash2(y, 1, 99) < beam * 1.15) g.fillRect(0, y, spr.width, 2);
        else if (hash2(y, 2, 98) < beam) g.fillRect(hash2(y, 3, 97) * spr.width, y, spr.width * beam, 1);
      }
    }
    g.globalCompositeOperation = 'source-over';
    ctx.drawImage(s, 0, 0, spr.width, spr.height, dx, dy, spr.width, spr.height);
  }
  function beamColumn(ctx, x, y, beam, t, h) {
    if (beam <= 0) return;
    var a = Math.sin(Math.min(1, beam) * Math.PI) * 0.9 + 0.1;
    var op = ctx.globalCompositeOperation, ga = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = ga * a * 0.55;
    ctx.fillStyle = PAL.mint;
    ctx.fillRect(Math.round(x - 7), Math.round(y - h), 14, h);
    ctx.globalAlpha = ga * a * 0.8;
    ctx.fillRect(Math.round(x - 2), Math.round(y - h - 4), 4, h + 4);
    ctx.globalAlpha = ga * a;
    ctx.fillStyle = '#E8FFF8';
    for (var i = 0; i < 7; i++) {
      var sx = x - 8 + hash2(i, 5, 1) * 16, sy = y - ((t * 40 + hash2(i, 6, 1) * h) % h);
      ctx.fillRect(Math.round(sx), Math.round(sy), 1, 2);
    }
    ctx.globalAlpha = ga; ctx.globalCompositeOperation = op;
    glow(ctx, x, y - 4, PAL.mint, 14, a * 0.6);
  }
  function resolvePose(o) {
    var t = o.time || 0, carry = o.carry || o.action === 'carry';
    if (o.action === 'repair') return { pose: 'repair', f: frameOf(t, 7, 3) };
    if (o.action === 'console') return { pose: 'console', f: frameOf(t, 3, 2) };
    if (o.action === 'sit') return { pose: 'sit', f: frameOf(t, 1.2, 2) };
    if (carry) return o.moving ? { pose: 'carrywalk', f: frameOf(t, 8, 4) } : { pose: 'carry', f: 0 };
    if (o.moving) return { pose: 'walk', f: frameOf(t, 8, 4) };
    return { pose: 'idle', f: frameOf(t, 1.6, 2) };
  }
  function normDir(d) { return d === 'up' || d === 'left' || d === 'right' ? d : 'down'; }
  function drawHumanoid(ctx, S, sid, x, y, o) {
    x = Math.round(x); y = Math.round(y);
    var t = o.time || 0;
    if (o.downed) {
      ctx.drawImage(shadowSprite(30), x - 16, y - 3);
      drawFxSprite(ctx, downedSprite(S, sid), x - 20, y - 20, o);
      var pz = 0.6 + 0.4 * Math.sin(t * 5);
      if (o.shieldMax == null) drawIcon(ctx, 'heart', x, y - 30 - Math.round(pz * 2), { color: PAL.alarmrot });   // M2/v2: Medi-Kreuz zeichnet der Client
      else { ctx.fillStyle = '#2A2226'; ctx.fillRect(x + 12, y - 9, 5, 2); ctx.fillRect(x + 12, y - 8, 2, 3); ctx.fillStyle = '#8EA3B5'; ctx.fillRect(x + 13, y - 9, 3, 1); }   // Pistole in der Hand
      for (var i = 0; i < 3; i++) {
        var a = t * 3 + i * 2.09;
        ctx.fillStyle = PAL.bernstein;
        ctx.fillRect(Math.round(x + Math.cos(a) * 9), Math.round(y - 20 + Math.sin(a) * 3), 1, 1);
      }
      return;
    }
    var p = resolvePose(o), dir = normDir(o.dir);
    if (o.crouch && !o.action) p = { pose: o.moving ? 'walk' : 'idle', f: o.moving ? frameOf(t, 5, 4) : 0 };   // M2 §15: geduckt (langsames Watscheln)
    else if (o.crouch && p.pose === 'carrywalk') p = { pose: 'carry', f: 0 };
    var spr = o.crouch ? crouchSprite(S, sid, dir, p.pose, p.f) : humanSprite(S, sid, dir, p.pose, p.f, false);
    if (!(o.beam >= 1)) ctx.drawImage(shadowSprite(14), x - 8, y - 3);
    if (p.pose === 'sit') ctx.drawImage(stoolSprite(), x - 11, y - 10);   // M1: Hocker unter der sitzenden Figur
    drawFxSprite(ctx, spr, x - 12, y - 39, o);
    if (o.carry && !(o.beam >= 0.5)) drawItem(ctx, o.carry, x, y - 44 + (p.pose === 'carrywalk' && p.f % 2 ? -1 : 0), { time: t });
    if (o.beam > 0) beamColumn(ctx, x, y, o.beam, t, 46);
  }
  function drawCharacter(ctx, x, y, opts) {
    var o = opts || {};
    var c = ((o.color | 0) % 3 + 3) % 3;
    if (o.shieldRing && o.shieldMax > 0 && !o.downed) drawShieldRingPix(ctx, Math.round(x), Math.round(y), o.shieldSeg, o.shieldMax);   // M2, optional
    drawHumanoid(ctx, CREW[c], 'c' + c, x, y, o);
    if (o.shieldHitT != null && o.shieldHitT >= 0 && o.shieldHitT < 0.35 && !o.downed) drawShieldBubble(ctx, Math.round(x), Math.round(y) - (o.crouch ? 12 : 17), +o.shieldHitT, 1);   // M2: Hex-Flackern
  }
  function drawNpc(ctx, x, y, opts) {
    drawHumanoid(ctx, TECH, 'tech', x, y, opts || {});
  }

  // --- Schrauber-Bots ---------------------------------------------------------------------------
  var BOTPAL = [
    { b: '#C9974A', l: '#EAC786', d: '#8A6530', eye: PAL.mint },
    { b: '#7FE0C2', l: '#C8F5E6', d: '#3E9C80', eye: PAL.bernstein },
    { b: '#B4573E', l: '#D77A5C', d: '#7E3A28', eye: PAL.mint },
  ];
  function buildBot(g, c, v, dir, f, working, moving) {
    var C = BOTPAL[v] || BOTPAL[0];
    var bob = moving && f % 2 ? -1 : 0, B = bob;
    var tread = '#4F6178', treadL = '#6C7F96', treadD = '#2E3946';
    var blink = f === 3 && !moving && !working;
    if (dir === 'right') {
      // Kette
      R(g, 2, 19, 18, 6, tread); R(g, 2, 19, 18, 1, treadL); R(g, 2, 24, 18, 1, treadD);
      [5, 11, 17].forEach(function (wx) { ell(g, wx, 22, 2.2, 2.2, treadD); var a = (moving ? f : 0) * Math.PI / 4; P(g, wx + Math.round(Math.cos(a) * 1.5), 22 + Math.round(Math.sin(a) * 1.5), treadL); });
      // Körper
      R(g, 6, 6 + B, 10, 14, C.b); R(g, 6, 6 + B, 10, 1, C.l); R(g, 6, 6 + B, 1, 14, C.l); R(g, 15, 7 + B, 1, 13, C.d);
      R(g, 6, 15 + B, 10, 1, C.d);
      R(g, 11, 9 + B, 5, 5, '#1B2230'); R(g, 13, 10 + B, 2, blink ? 1 : 2, C.eye);
      // Antenne
      R(g, 9, 1 + B, 1, 5, '#2B1D1A'); R(g, 8, 0 + B, 3, 2, f % 4 < 2 ? C.eye : shade(C.eye, -0.4));
      // Werkzeugarm
      var ext = working ? (f % 2 ? 3 : 1) : 0;
      R(g, 16, 13 + B, 2 + ext, 2, '#8EA3B5'); R(g, 18 + ext, 12 + B - (working && f % 2 ? 1 : 0), 2, 4, '#6C7F96'); P(g, 19 + ext, 12 + B, '#C8D6E2');
      return;
    }
    var back = dir === 'up';
    R(g, 3, 19, 16, 6, tread); R(g, 3, 19, 16, 1, treadL); R(g, 3, 24, 16, 1, treadD);
    for (var sx = 3 + ((moving ? f : 0) % 3); sx < 19; sx += 3) R(g, sx, 20, 1, 4, treadD);
    R(g, 4, 6 + B, 14, 14, C.b); R(g, 4, 6 + B, 14, 1, C.l); R(g, 4, 6 + B, 1, 14, C.l); R(g, 17, 7 + B, 1, 13, C.d);
    R(g, 4, 15 + B, 14, 1, C.d);
    if (!back) {
      R(g, 5, 9 + B, 12, 5, '#1B2230');
      R(g, 7, 10 + B + (blink ? 1 : 0), 3, blink ? 1 : 2, C.eye); R(g, 12, 10 + B + (blink ? 1 : 0), 3, blink ? 1 : 2, C.eye);
      R(g, 9, 17 + B, 4, 1, C.d); P(g, 6, 17 + B, PAL.alarmrot);
    } else {
      R(g, 7, 9 + B, 8, 5, C.d); for (var vy = 10; vy < 14; vy += 2) R(g, 8, vy + B, 6, 1, shade(C.d, -0.3));
      P(g, 6, 17 + B, '#E8FFF8');
    }
    R(g, 10, 1 + B, 1, 5, '#2B1D1A'); R(g, 9, 0 + B, 3, 2, f % 4 < 2 ? C.eye : shade(C.eye, -0.4));
    // Arme: links klein, rechts Werkzeugarm
    R(g, 2, 13 + B, 2, 4, '#8EA3B5');
    var up = working && f % 2;
    R(g, 18, 12 + B, 2, 3, '#8EA3B5');
    R(g, 19, up ? 8 + B : 15 + B, 2, 4, '#6C7F96'); P(g, 20, up ? 8 + B : 18 + B, '#C8D6E2');
  }
  function drawBot(ctx, x, y, opts) {
    var o = opts || {};
    x = Math.round(x); y = Math.round(y);
    var t = o.time || 0, v = ((o.variant | 0) % 3 + 3) % 3, dir = normDir(o.dir);
    var d = dir === 'left' ? 'right' : dir;
    var f = frameOf(t, o.moving ? 8 : o.working ? 6 : 2, 4);
    var w = o.working ? 1 : 0, m = o.moving ? 1 : 0;
    var key = 'bot|' + v + '|' + d + '|' + f + '|' + w + m;
    var spr = cached(key, 22, 26, function (g, c) { buildBot(g, c, v, d, f, !!w, !!m); outline(c, PAL.outlineWarm); });
    if (dir === 'left') { var k2 = key + '|L'; var h = cache.get(k2); if (!h) { h = flipH(spr); cache.set(k2, h); } spr = h; }
    ctx.drawImage(shadowSprite(16), x - 9, y - 3);
    drawFxSprite(ctx, spr, x - 11, y - 25, o);
    if (o.working) {
      var tx = dir === 'left' ? x - 10 : dir === 'right' ? x + 10 : x + 9;
      var ty = y - 14 + (dir === 'up' ? -4 : 0);
      if (frameOf(t, 6, 3) !== 2) drawFx(ctx, 'sparks', tx, ty, (t * 2.5) % 0.4, { small: true });
    }
    if (o.carry) drawItem(ctx, o.carry, x, y - 32, { time: t });
  }

  // --- Kustoden-Drohne --------------------------------------------------------------------------
  function buildDrone(g, c, f) {
    var cx = 13, cy = 15;
    var ice = PAL.eisblau, iceD = '#5C7E93', iceL = '#E8F8FF', steel = '#3B4656';
    // Splitter (oben, seitlich, unten)
    var wob = [0, 1, 0, -1][f];
    poly(g, [cx, 1 + wob, cx + 4, cy - 3, cx - 4, cy - 3], iceD);
    poly(g, [cx, 1 + wob, cx, cy - 3, cx - 4, cy - 3], ice);
    P(g, cx - 1, 5 + wob, iceL);
    poly(g, [1, cy - 2 - wob, cx - 6, cy - 2, cx - 6, cy + 2], ice);
    poly(g, [25, cy - 2 + wob, cx + 6, cy - 2, cx + 6, cy + 2], iceD);
    poly(g, [cx - 3, cy + 5, cx + 3, cy + 5, cx, 27], iceD);
    poly(g, [cx - 3, cy + 5, cx, cy + 5, cx, 27], ice);
    // Kernring
    ell(g, cx, cy, 7, 7, '#232A35'); ell(g, cx, cy, 6, 6, steel); ell(g, cx - 1, cy - 1, 4, 4, '#55607A');
    for (var i = 0; i < 6; i++) { var a = i / 6 * Math.PI * 2 + f * 0.26; P(g, cx + Math.cos(a) * 5.5, cy + Math.sin(a) * 5.5, i % 2 ? '#7A8AA0' : '#2A303C'); }
    // Auge
    ell(g, cx, cy, 3, 3, '#2A0E0E');
    ell(g, cx, cy, 2.2, 2.2, f % 2 ? PAL.alarmrot : '#C83A30');
    P(g, cx - 1, cy - 1, '#FFE2D8');
  }
  function buildDroneWreck(g, c) {
    poly(g, [2, 10, 8, 6, 12, 11, 6, 13], '#5C7E93');
    poly(g, [14, 12, 20, 4, 22, 9, 18, 13], '#4A5A6A');
    ell(g, 12, 9, 5, 3.5, '#2A303C'); ell(g, 12, 8.5, 3.5, 2.5, '#3B4656');
    ell(g, 12, 9, 1.5, 1, '#3A1414');
    P(g, 5, 9, '#8FA6B4'); P(g, 19, 7, '#7A8E9C');
    outline(c, '#141A24');
  }
  function drawDrone(ctx, x, y, opts) {
    var o = opts || {};
    x = Math.round(x); y = Math.round(y);
    var t = o.time || 0;
    if (o.kind === 'scavenger') {   // M1: Plünderer im Wrack; M2: Zielpose, ungeschützt
      drawScavenger(ctx, x, y, o);
      if (o.alive !== false && !o.crouch && (o.aiming || o.shieldSeg === 0)) scavengerExtras(ctx, x, y, o, t);   // geduckt: keine Ziel-Pose
      return;
    }
    if (o.kind === 'warden') { drawWarden(ctx, x, y, o); return; }   // M2: Wächter „Lamassu“
    if (o.alive === false) {
      ctx.drawImage(shadowSprite(18), x - 10, y - 3);
      ctx.drawImage(cached('drone|wreck', 26, 16, buildDroneWreck), x - 13, y - 12);
      drawFx(ctx, 'smoke', x + 2, y - 10, t, { small: true });
      return;
    }
    var f = frameOf(t, 5, 4);
    var spr = cached('drone|' + f, 27, 29, function (g, c) { buildDrone(g, c, f); outline(c, '#141A24'); });
    var bob = Math.round(Math.sin(t * 3) * 2);
    var hov = 12 + bob;
    var sw = 14 - bob;
    ctx.drawImage(shadowSprite(sw), x - (sw + 2) / 2, y - 3);
    var dx = x - 13, dy = y - 29 - hov + 10;
    if (o.revealed) {
      var sil = cache.get('drone|sil|' + f);
      if (!sil) { sil = silhouette(spr, PAL.alarmrot); cache.set('drone|sil|' + f, sil); }
      var ga = ctx.globalAlpha;
      ctx.globalAlpha = ga * (0.55 + 0.45 * Math.sin(t * 6));
      ctx.drawImage(sil, dx - 1, dy); ctx.drawImage(sil, dx + 1, dy); ctx.drawImage(sil, dx, dy - 1); ctx.drawImage(sil, dx, dy + 1);
      ctx.globalAlpha = ga;
    }
    drawFxSprite(ctx, spr, dx, dy, { flash: o.hit ? (typeof o.hit === 'number' ? o.hit : 1) : 0 });
    glow(ctx, x, dy + 15, PAL.alarmrot, 10, 0.35 + 0.15 * Math.sin(t * 8));
  }

  // --- Gegenstände 16×16 ------------------------------------------------------------------------
  function buildItem(g, c, kind) {
    var i;
    switch (kind) {
      case 'ersatzteil':
        ell(g, 8, 8, 6, 6, '#8A6530'); ell(g, 8, 8, 5, 5, PAL.messing); ell(g, 7, 7, 3, 3, '#EAC786');
        for (i = 0; i < 8; i++) { var a = i / 8 * Math.PI * 2; R(g, 7.5 + Math.cos(a) * 6.2, 7.5 + Math.sin(a) * 6.2, 2, 2, i < 4 ? PAL.messing : '#8A6530'); }
        ell(g, 8, 8, 2.2, 2.2, '#3A2A12'); P(g, 6, 5, '#F6E6C0');
        break;
      case 'loeschgel':
        R(g, 4, 4, 8, 11, '#C8433A'); R(g, 4, 4, 2, 11, '#E86A5C'); R(g, 11, 4, 1, 11, '#8A2A24');
        R(g, 4, 8, 8, 3, PAL.mint); R(g, 4, 8, 8, 1, '#C8F5E6');
        R(g, 6, 1, 4, 3, '#2B3442'); R(g, 9, 1, 4, 2, '#2B3442'); P(g, 12, 3, '#2B3442');
        P(g, 5, 13, '#E86A5C');
        break;
      case 'flickblech':
        poly(g, [2, 4, 13, 2, 14, 12, 3, 14], '#8EA3B5');
        poly(g, [2, 4, 13, 2, 13, 4, 3, 6], '#C8D6E2');
        poly(g, [11, 12, 14, 12, 14, 9], '#4F6178');
        P(g, 4, 6, '#3B4A5E'); P(g, 11, 4, '#3B4A5E'); P(g, 4, 12, '#3B4A5E'); P(g, 12, 10, '#3B4A5E');
        line(g, 5, 9, 9, 8, '#A9BACB');
        break;
      case 'bolzen':
        poly(g, thick(3, 13, 11, 5, 4), PAL.messing);
        poly(g, thick(3, 12, 10, 5, 1.5), '#F1D9A0');
        poly(g, [11, 3, 14, 2, 13, 5, 10, 7, 9, 6], PAL.alarmrot);
        poly(g, [1, 11, 4, 11, 4, 15, 3, 15], '#6E4E22'); poly(g, [3, 14, 6, 14, 6, 15, 2, 15], '#6E4E22');
        P(g, 13, 3, '#FFB0A0');
        break;
      case 'medipack':
        R(g, 2, 4, 12, 10, '#EDE6D6'); R(g, 2, 4, 12, 1, '#FFFFFF'); R(g, 13, 4, 1, 10, '#B8AE98'); R(g, 2, 13, 12, 1, '#B8AE98');
        R(g, 6, 2, 4, 2, '#8A8070'); R(g, 7, 2, 2, 1, '#B8AE98');
        R(g, 7, 6, 2, 6, '#3FB894'); R(g, 5, 8, 6, 2, '#3FB894');
        break;
      case 'datenkern':
        R(g, 3, 3, 10, 10, '#232A35'); R(g, 3, 3, 10, 1, '#55607A');
        poly(g, [8, 1, 12, 8, 8, 15, 4, 8], '#5C7E93');
        poly(g, [8, 1, 8, 15, 4, 8], PAL.eisblau);
        poly(g, [8, 3, 6, 8, 8, 12], '#E8F8FF');
        R(g, 7, 7, 3, 2, PAL.alarmrot); P(g, 7, 7, '#FFE2D8');
        R(g, 2, 7, 2, 2, PAL.messing); R(g, 12, 7, 2, 2, PAL.messing);
        break;
      case 'pflanze':
        R(g, 5, 10, 6, 5, PAL.terrakotta); R(g, 4, 9, 8, 2, '#D77A5C');
        ell(g, 8, 6, 4, 3, PAL.moos); ell(g, 5, 5, 2, 2, '#7FAE66'); ell(g, 11, 5, 2, 2, PAL.moos); ell(g, 7, 4, 1.5, 1.5, '#9FCC7A');
        break;
      case 'poster':
        R(g, 3, 2, 10, 12, PAL.messing); R(g, 4, 3, 8, 10, '#1A1F3E');
        P(g, 5, 5, PAL.sternweiss); P(g, 9, 4, '#8E94B8'); P(g, 10, 9, PAL.sternweiss); line(g, 5, 11, 8, 7, PAL.bernstein); line(g, 8, 7, 11, 6, PAL.bernstein);
        break;
      case 'lampe':
        poly(g, [3, 7, 13, 7, 11, 1, 5, 1], '#E3B565'); R(g, 7, 7, 2, 7, '#8A6530'); R(g, 4, 14, 8, 1, PAL.messing); R(g, 6, 8, 4, 1, '#FFE9B0');
        break;
      case 'teppich':
        R(g, 1, 4, 14, 9, '#5A3824');
        R(g, 2, 5, 4, 3, PAL.terrakotta); R(g, 6, 5, 4, 3, '#5BA8A0'); R(g, 10, 5, 4, 3, PAL.bernstein);
        R(g, 2, 8, 4, 4, PAL.moos); R(g, 6, 8, 4, 4, '#B66A8E'); R(g, 10, 8, 4, 4, PAL.messing);
        break;
      case 'werkzeuggurt':
        R(g, 1, 7, 14, 3, '#7A4E33'); R(g, 1, 7, 14, 1, '#9A6844'); R(g, 7, 6, 3, 5, PAL.messing);
        R(g, 2, 10, 3, 4, '#5A3824'); R(g, 11, 10, 3, 4, '#5A3824'); wrench(g, 3, 9, -1.4); R(g, 12, 3, 1, 7, '#A9BACB');
        break;
      case 'seitenturm':
        ell(g, 8, 10, 5, 4, '#4F6178'); ell(g, 8, 9, 4, 3, '#8EA3B5'); R(g, 8, 3, 7, 3, '#55667D'); R(g, 13, 3, 2, 3, PAL.mint);
        break;
      case 'schildpool':
        grid(g, 3, 2, ICONS.shields, { '#': PAL.eisblau, '+': '#E8F8FF' });
        break;
      case 'schrauber3':
        R(g, 3, 4, 10, 8, PAL.messing); R(g, 4, 6, 8, 3, '#1B2230'); R(g, 5, 7, 2, 1, PAL.mint); R(g, 9, 7, 2, 1, PAL.mint); R(g, 2, 12, 12, 3, '#4F6178'); R(g, 7, 1, 1, 3, '#2B1D1A');
        break;
      default:
        if (!buildItemM1(g, kind) && !buildItemM2(g, kind)) return false;
    }
    outline(c, PAL.outlineWarm);
    return true;
  }
  var ITEM_KINDS = { ersatzteil: 1, loeschgel: 1, flickblech: 1, bolzen: 1, medipack: 1, datenkern: 1, pflanze: 1, poster: 1, lampe: 1, teppich: 1, werkzeuggurt: 1, seitenturm: 1, schildpool: 1, schrauber3: 1,
    // M1: neue Deko (Inventar-Icons), versteckte Objekte im Raum
    buecherregal: 1, aquarium: 1, sessel: 1, sternkarte: 1, trophaee_boje: 1, kristalllampe: 1, cache: 1, beacon: 1, lore: 1, bolzenwerfer: 1 };
  function drawItem(ctx, kind, x, y, opts) {
    var o = opts || {};
    if (kind && typeof kind === 'object') kind = kind.kind || kind.id;
    if (typeof kind === 'string' && kind.indexOf('deco_') === 0) kind = kind.slice(5);
    x = Math.round(x); y = Math.round(y);
    if (!ITEM_KINDS[kind]) { missing(ctx, x - 8, y - 8, 16, 16); return; }
    var spr = cached('item|' + kind, 18, 18, function (g, c) {
      g.translate(1, 1);
      buildItem(g, c, kind);
      g.setTransform(1, 0, 0, 1, 0, 0);
    });
    var s = o.scale || 1;
    if (o.ground) ctx.drawImage(shadowSprite(10), x - 6, y + 5);
    var bob = o.bob ? Math.round(Math.sin((o.time || 0) * 3) * 1) : 0;
    if (s !== 1) ctx.drawImage(spr, x - 9 * s, y - 9 * s + bob, 18 * s, 18 * s);
    else ctx.drawImage(spr, x - 9, y - 9 + bob);
    if (kind === 'datenkern') glow(ctx, x, y + bob, PAL.eisblau, 10 * s, 0.35 + 0.15 * Math.sin((o.time || 0) * 4));
    else if (ITEM_GLOW[kind]) itemGlowM1(ctx, kind, x, y + bob, s, o.time || 0);
  }

  // ---------------------------------------------------------------------------------------------
  // EFFEKTE. Schleifen-Effekte nutzen t modulo Periode; Einmal-Effekte (explosion, strike, muzzle)
  // deuten t als Alter in Sekunden (0 = Beginn) und zeichnen danach nichts mehr.
  // ---------------------------------------------------------------------------------------------
  function buildFlame(g, f, s) {
    var r = rng(500 + f * 13);
    var W = 24 * s, H = 30 * s, cx = W / 2, base = H - 3 * s;
    var tongues = [[-5, 0.7], [5, 0.75], [0, 1]];
    var cols = ['#C8342C', '#F08A3C', '#FFC66B', '#FFF1B8'];
    for (var layer = 0; layer < 4; layer++) {
      for (var i = 0; i < tongues.length; i++) {
        var T = tongues[i], sc = 1 - layer * 0.24;
        var tipH = (H - 6 * s) * T[1] * sc * (0.85 + r() * 0.3);
        var bw = (6.5 - layer * 1.3) * s * (T[0] === 0 ? 1.2 : 0.9);
        var bx = cx + T[0] * s * sc, sway = (r() - 0.5) * 4 * s;
        poly(g, [bx - bw, base, bx - bw * 0.7, base - tipH * 0.45, bx + sway, base - tipH, bx + bw * 0.7, base - tipH * 0.45, bx + bw, base], cols[layer]);
      }
      ell(g, cx, base - 1 * s, (9 - layer * 2) * s, (3 - layer * 0.6) * s, cols[layer]);
    }
    for (var e = 0; e < 3; e++) P(g, cx - 6 * s + r() * 12 * s, base - H * 0.6 - r() * H * 0.3, r() < 0.5 ? PAL.funke : PAL.bernstein);
  }
  function puffSprite(rad, col) {
    rad = Math.max(1, Math.round(rad));
    return cached('puff|' + rad + '|' + col, rad * 2 + 2, rad * 2 + 2, function (g) {
      ell(g, rad + 1, rad + 1, rad, rad, col);
      ell(g, rad + 0.5, rad + 0.3, rad * 0.6, rad * 0.55, shade(col, 0.15));
    });
  }
  function boomSprite(f) {   // Explosion, 8 Phasen
    return cached('boom|' + f, 48, 48, function (g) {
      var p = f / 7, r = rng(900 + f);
      if (f < 2) { ell(g, 24, 24, 6 + f * 6, 6 + f * 6, '#FFFFFF'); ell(g, 24, 24, 4 + f * 4, 4 + f * 4, PAL.funke); return; }
      var R0 = 8 + p * 14;
      var cols = f < 5 ? ['#C8342C', '#F08A3C', '#FFC66B', '#FFF1B8'] : ['#4A3A3A', '#6A5050', '#B4573E', '#F08A3C'];
      for (var k = 0; k < 4; k++) {
        var rr = R0 * (1 - k * 0.22);
        for (var b = 0; b < 6; b++) {
          var a = b / 6 * Math.PI * 2 + f;
          ell(g, 24 + Math.cos(a) * rr * 0.35, 24 + Math.sin(a) * rr * 0.35, rr * 0.6, rr * 0.6, cols[k]);
        }
      }
      if (f >= 5) { g.globalCompositeOperation = 'destination-out'; ell(g, 24, 24, R0 * 0.45 * (f - 4) / 3, R0 * 0.45 * (f - 4) / 3, '#000'); g.globalCompositeOperation = 'source-over'; }
      for (var d = 0; d < 6; d++) { var ang = r() * 6.28, dist = R0 + r() * 6; P(g, 24 + Math.cos(ang) * dist, 24 + Math.sin(ang) * dist, PAL.funke); }
    });
  }
  function drawFx(ctx, kind, x, y, t, opts) {
    var o = opts || {};
    t = t || 0;
    x = Math.round(x); y = Math.round(y);
    var i, a, p, ga = ctx.globalAlpha;
    switch (kind) {
      case 'fire': {
        var s = o.small ? 0.6 : 1, f = frameOf(t + (x * 0.031 + y * 0.017), 10, 6);
        var spr = cached('flame|' + f + '|' + s, 24 * s, 30 * s, function (g, c) { buildFlame(g, f, s); outline(c, '#5A1A12'); });
        glow(ctx, x, y - 4 * s, '#F08A3C', 22 * s, 0.45 + 0.1 * Math.sin(t * 13));
        ctx.drawImage(spr, Math.round(x - spr.width / 2), Math.round(y + 8 * s - spr.height));
        return;
      }
      case 'breach': {
        var hole = cached('breachhole', 30, 24, function (g, c) {
          poly(g, [4, 12, 9, 5, 15, 7, 21, 3, 26, 9, 24, 16, 18, 20, 11, 19, 6, 17], '#3A4759');
          poly(g, [7, 12, 10, 7, 15, 9, 20, 6, 23, 10, 22, 15, 17, 17, 11, 16], PAL.tiefraum);
          P(g, 13, 11, PAL.sternweiss); P(g, 18, 13, '#8E94B8'); P(g, 16, 9, '#4B5078');
          line(g, 4, 12, 0, 10, '#2A3442'); line(g, 26, 9, 29, 5, '#2A3442'); line(g, 18, 20, 20, 23, '#2A3442'); line(g, 9, 5, 7, 1, '#2A3442');
          outline(c, '#151B24');
        });
        ctx.drawImage(hole, x - 15, y - 12);
        ctx.fillStyle = 'rgba(169,214,229,0.8)';
        for (i = 0; i < 10; i++) {
          a = hash2(i, 1, 4) * Math.PI * 2;
          p = (t * 1.2 + hash2(i, 2, 4)) % 1;
          var d = 26 * (1 - p);
          ctx.globalAlpha = ga * (0.3 + 0.7 * p);
          var px2 = x + Math.cos(a + p * 0.8) * d, py2 = y + Math.sin(a + p * 0.8) * d * 0.7;
          ctx.fillRect(Math.round(px2), Math.round(py2), p > 0.6 ? 1 : 2, 1);
        }
        ctx.globalAlpha = ga;
        glow(ctx, x, y, PAL.eisblau, 16, 0.12 + 0.06 * Math.sin(t * 7));
        return;
      }
      case 'sparks': {
        var age = t % 0.6, n = o.small ? 5 : 9;
        var seed = Math.floor(t / 0.6) + (o.seed | 0);
        for (i = 0; i < n; i++) {
          var vx = (hash2(i, seed, 11) - 0.5) * 90, vy = -30 - hash2(i, seed, 12) * 60;
          var sx = x + vx * age, sy = y + vy * age + 160 * age * age;
          var life = 1 - age / 0.6;
          if (life <= 0) continue;
          ctx.fillStyle = life > 0.6 ? PAL.funke : life > 0.3 ? PAL.bernstein : '#F08A3C';
          ctx.fillRect(Math.round(sx), Math.round(sy), 1, 1);
          if (life > 0.5) ctx.fillRect(Math.round(sx - vx * 0.02), Math.round(sy - vy * 0.02), 1, 1);
        }
        if (age < 0.08) glow(ctx, x, y, PAL.funke, 8, 0.7);
        return;
      }
      case 'smoke': {
        var np = o.small ? 3 : 6, hgt = o.small ? 16 : 34;
        for (i = 0; i < np; i++) {
          p = (t * (o.small ? 0.6 : 0.45) + i / np) % 1;
          var rad = (o.small ? 2 : 3) + p * (o.small ? 3 : 7);
          var sx2 = x + Math.sin(p * 5 + i) * 3 + p * 4, sy2 = y - p * hgt;
          ctx.globalAlpha = ga * (1 - p) * 0.75;
          var pf = puffSprite(rad, p < 0.3 ? '#6E6872' : PAL.rauch);
          ctx.drawImage(pf, Math.round(sx2 - pf.width / 2), Math.round(sy2 - pf.height / 2));
        }
        ctx.globalAlpha = ga;
        return;
      }
      case 'beam':
        beamColumn(ctx, x, y, o.p != null ? o.p : 0.5, t, o.h || 46);
        return;
      case 'strike': {
        var delay = o.delay || 1.5, rr2 = o.r || 80;
        if (t < delay) {
          var pul = 0.5 + 0.5 * Math.sin(t * 12);
          ctx.globalAlpha = ga * (0.45 + 0.4 * pul);
          var segs = 24, rot = t * 1.5;
          ctx.fillStyle = t > delay - 0.5 ? PAL.alarmrot : PAL.bernstein;
          for (i = 0; i < segs; i++) {
            if (i % 2) continue;
            for (var k = 0; k < 4; k++) {
              a = rot + (i + k / 4) / segs * Math.PI * 2;
              ctx.fillRect(Math.round(x + Math.cos(a) * rr2), Math.round(y + Math.sin(a) * rr2 * 0.6), 2, 1);
            }
          }
          var inner = rr2 * (1 - t / delay);
          for (i = 0; i < 16; i++) { a = i / 16 * Math.PI * 2; ctx.fillRect(Math.round(x + Math.cos(a) * inner), Math.round(y + Math.sin(a) * inner * 0.6), 1, 1); }
          ctx.fillRect(x - 6, y, 13, 1); ctx.fillRect(x, y - 4, 1, 9);
          ctx.globalAlpha = ga;
        } else if (t < delay + 0.9) {
          var q = (t - delay) / 0.9;
          var op = ctx.globalCompositeOperation;
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = ga * (1 - q);
          ctx.fillStyle = PAL.bernstein; ctx.fillRect(x - Math.round(10 * (1 - q)) - 2, y - 400, Math.round(20 * (1 - q)) + 4, 400);
          ctx.fillStyle = '#FFFFFF'; ctx.fillRect(x - Math.round(4 * (1 - q)) - 1, y - 400, Math.round(8 * (1 - q)) + 2, 400);
          ctx.globalCompositeOperation = op;
          ctx.globalAlpha = ga * (1 - q);
          ctx.fillStyle = PAL.funke;
          var sr = rr2 * q;
          for (i = 0; i < 48; i++) { a = i / 48 * Math.PI * 2; ctx.fillRect(Math.round(x + Math.cos(a) * sr), Math.round(y + Math.sin(a) * sr * 0.6), 2, 1); }
          ctx.globalAlpha = ga;
          drawFx(ctx, 'explosion', x, y, t - delay, { r: 26 });
        }
        return;
      }
      case 'explosion': {
        if (t < 0 || t >= 0.8) return;
        var fr = Math.min(7, Math.floor(t / 0.1));
        var scl = (o.r || 20) / 20;
        glow(ctx, x, y, '#F08A3C', 30 * scl, (1 - t / 0.8) * 0.8);
        var bs = boomSprite(fr);
        ctx.drawImage(bs, Math.round(x - 24 * scl), Math.round(y - 24 * scl), Math.round(48 * scl), Math.round(48 * scl));
        return;
      }
      case 'muzzle': {
        if (t < 0 || t > 0.15) return;
        var mq = 1 - t / 0.15, ang = o.angle || 0;
        glow(ctx, x, y, PAL.bernstein, 10, mq);
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
        ctx.fillStyle = PAL.funke; ctx.fillRect(0, -1, Math.round(8 * mq) + 2, 2);
        ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, -1, Math.round(4 * mq) + 1, 2); ctx.fillRect(1, -3, 1, 6);
        ctx.restore();
        return;
      }
      case 'repair': {
        for (i = 0; i < 4; i++) {
          p = (t * 0.9 + i / 4) % 1;
          ctx.globalAlpha = ga * (1 - p);
          var rx = x + Math.sin(i * 2.3 + p * 3) * 8, ry = y - p * 20;
          if (i % 2) drawIcon(ctx, 'ersatzteil', rx, ry, { color: PAL.messing });
          else { ctx.fillStyle = PAL.mint; ctx.fillRect(Math.round(rx - 2), Math.round(ry), 5, 1); ctx.fillRect(Math.round(rx), Math.round(ry - 2), 1, 5); }
        }
        ctx.globalAlpha = ga;
        return;
      }
      case 'heal': {
        for (i = 0; i < 5; i++) {
          p = (t * 0.8 + i / 5) % 1;
          ctx.globalAlpha = ga * (1 - p);
          var hx = x + Math.sin(i * 1.9) * 9, hy = y - p * 24;
          ctx.fillStyle = '#3FB894'; ctx.fillRect(Math.round(hx - 2), Math.round(hy - 1), 5, 3); ctx.fillRect(Math.round(hx - 1), Math.round(hy - 2), 3, 5);
          ctx.fillStyle = '#C8F5E6'; ctx.fillRect(Math.round(hx - 1), Math.round(hy), 3, 1); ctx.fillRect(Math.round(hx), Math.round(hy - 1), 1, 3);
        }
        ctx.globalAlpha = ga;
        glow(ctx, x, y - 6, PAL.mint, 14, 0.2);
        return;
      }
      default:
        if (!drawFxM2(ctx, kind, x, y, t, o)) missing(ctx, x - 8, y - 8, 16, 16);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // RAUM: Schiff, Gegner (gedreht vorgerendert in 64 Stufen, scharf per Scanline-Füllung)
  // ---------------------------------------------------------------------------------------------
  var ROT_STEPS = 64;
  function rotBucket(angle) { var b = Math.round(((angle || 0) / (Math.PI * 2)) * ROT_STEPS) % ROT_STEPS; return b < 0 ? b + ROT_STEPS : b; }
  // Zeichen-Kontext für gedrehte Formen in lokalen Koordinaten
  function Rot(g, cx, cy, ang, map) {
    var co = Math.cos(ang), si = Math.sin(ang);
    function tf(pts) {
      var out = new Array(pts.length);
      for (var i = 0; i < pts.length; i += 2) {
        var l = map(pts[i], pts[i + 1]);
        out[i] = cx + l[0] * co - l[1] * si;
        out[i + 1] = cy + l[0] * si + l[1] * co;
      }
      return out;
    }
    return {
      poly: function (pts, col) { poly(g, tf(pts), col); },
      ell: function (x, y, rx, ry, col, n) { var l = map(x, y); var sc = map(x + rx, y + ry); var lrx = Math.abs(sc[0] - l[0]), lry = Math.abs(sc[1] - l[1]); var pts = ellPts(l[0], l[1], lrx, lry, n || 20); var out = []; for (var i = 0; i < pts.length; i += 2) out.push(cx + pts[i] * co - pts[i + 1] * si, cy + pts[i] * si + pts[i + 1] * co); poly(g, out, col); },
      ellL: function (lx, ly, rx, ry, col, n) { var pts = ellPts(lx, ly, rx, ry, n || 20); var out = []; for (var i = 0; i < pts.length; i += 2) out.push(cx + pts[i] * co - pts[i + 1] * si, cy + pts[i] * si + pts[i + 1] * co); poly(g, out, col); },
      line: function (x0, y0, x1, y1, w, col) { var a = map(x0, y0), b = map(x1, y1); var u = map(x0 + 1, y0); var k = Math.abs(u[0] - a[0]) || 1; var q = thick(a[0], a[1], b[0], b[1], Math.max(1, w * k)); var out = []; for (var i = 0; i < q.length; i += 2) out.push(cx + q[i] * co - q[i + 1] * si, cy + q[i] * si + q[i + 1] * co); poly(g, out, col); },
      dot: function (x, y, col) { var l = map(x, y); P(g, cx + l[0] * co - l[1] * si, cy + l[0] * si + l[1] * co, col); },
      pt: function (x, y) { var l = map(x, y); return [cx + l[0] * co - l[1] * si, cy + l[0] * si + l[1] * co]; },
    };
  }
  // Lerche: Koordinaten aus concept/tactical.svg (Bug +x), Maßstab ≈ 72 px Länge
  var SHIP_K = 0.066;
  var SHIP_KY = 0.082;
  function shipMap(X, Y) { return [(X - 578) * SHIP_K, (Y - 280) * SHIP_KY]; }
  function bez(p0, p1, p2, p3, n) {
    var out = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n, u = 1 - t;
      out.push(u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]);
    }
    return out;
  }
  var NOSE_TOP = bez([768, 178], [900, 180], [1050, 212], [1124, 280], 10);
  var NOSE_BOT = bez([1124, 280], [1050, 348], [900, 380], [768, 382], 10);
  function buildShip(g, c, ang) {
    var S = Rot(g, 50, 50, ang, shipMap);
    var hull = '#8EA3B5', hullL = '#B5C6D3', hullD = '#5E7088', fin = '#6C7F96', finL = '#8EA3B5';
    // Flügel
    S.poly([620, 180, 392, 180, 290, 62, 372, 62], fin);
    S.poly([620, 380, 392, 380, 290, 498, 372, 498], hullD);
    S.poly([570, 172, 420, 172, 340, 82, 372, 82], finL);
    S.poly([470, 150, 530, 150, 470, 100, 420, 100], PAL.terrakotta);
    S.poly([470, 410, 530, 410, 470, 460, 420, 460], '#8A3E2A');
    // Flügelgondeln
    S.poly([250, 50, 412, 50, 422, 62, 412, 74, 250, 74, 242, 62], hull);
    S.poly([250, 50, 412, 50, 418, 58, 246, 58], hullL);
    S.poly([250, 486, 412, 486, 422, 498, 412, 510, 250, 510, 242, 498], hullD);
    // Canards
    S.poly([880, 182, 836, 136, 816, 136, 840, 184], fin);
    S.poly([880, 378, 836, 424, 816, 424, 840, 376], hullD);
    // Ringstreben
    S.line(90, 228, 60, 128, 20, '#4F6178');
    S.line(90, 332, 60, 432, 20, '#3B4A5E');
    // Antriebsmodul
    S.poly([84, 222, 100, 206, 264, 206, 264, 354, 100, 354, 84, 338], hull);
    S.poly([90, 222, 104, 210, 264, 210, 264, 246, 90, 246], hullL);
    S.poly([90, 320, 264, 320, 264, 354, 100, 354, 86, 338], hullD);
    // Haupthülle
    S.poly([300, 176, 732, 176, 756, 200, 756, 360, 732, 384, 300, 384, 276, 360, 276, 200], hull);
    S.poly([300, 180, 732, 180, 752, 200, 752, 236, 280, 236, 280, 200], hullL);
    S.poly([280, 326, 752, 326, 752, 360, 732, 380, 300, 380, 280, 360], hullD);
    // Bug
    var nose = NOSE_TOP.concat(NOSE_BOT);
    S.poly(nose, hull);
    var nt = NOSE_TOP.slice(0, 16).concat([1000, 236, 768, 236]);
    S.poly(nt, hullL);
    var nb = [768, 326, 1010, 326].concat(NOSE_BOT.slice(6));
    S.poly(nb, hullD);
    // Fugen zwischen Modulen
    S.line(270, 214, 270, 346, 12, '#1B2230');
    S.line(762, 190, 762, 370, 12, '#1B2230');
    S.line(380, 186, 380, 374, 8, '#5E7088');
    S.line(526, 186, 526, 374, 8, '#5E7088');
    // Terrakotta-Zierstreifen
    S.line(100, 268, 1080, 268, 20, PAL.terrakotta);
    S.line(100, 292, 1060, 292, 10, '#4F6178');
    // Fenster
    [560, 620, 680].forEach(function (wx) { S.poly([wx, 198, wx + 26, 198, wx + 26, 216, wx, 216], PAL.bernstein); S.poly([wx, 344, wx + 26, 344, wx + 26, 362, wx, 362], '#D9A04E'); });
    // Kuppel
    S.ell(985, 280, 92, 72, '#8A6530', 24);
    S.ell(985, 280, 82, 62, PAL.bernstein, 24);
    S.ell(965, 266, 44, 30, '#FFF1C9', 16);
    // Reaktoröffnung
    S.ell(182, 280, 40, 40, PAL.messing, 14);
    S.ell(182, 280, 22, 22, PAL.mint, 10);
    // Ring (übertrieben dick für Lesbarkeit)
    S.ellL(-34.2, 0, 2.8, 14.4, '#7A5A28', 32);
    S.ellL(-34.4, -0.3, 2.3, 13.8, PAL.messing, 32);
    S.ellL(-34.0, 0, 1.2, 12, PAL.mint, 32);
    S.ellL(-33.9, 0, 0.45, 10.8, '#2C5E52', 24);
    // M3a: Batterien an beiden Flanken (je 4 Rohre nach außen), Lanze am Bug
    [-1, 1].forEach(function (sg) {
      var ey = 280 + sg * 104, oy = 280 + sg * 150, ty = 280 + sg * 200;
      S.poly([630, ey, 760, ey, 742, oy, 648, oy], sg < 0 ? '#5E7088' : '#3B4A5E');   // Sponson
      S.poly([630, ey, 760, ey, 756, ey + sg * 12, 634, ey + sg * 12], '#2E3946');
      for (var k = 0; k < 4; k++) {
        var tx = 656 + k * 26;
        S.line(tx, oy, tx, ty, 18, '#2E3946');
        S.line(tx - 3, oy, tx - 3, ty, 8, '#8EA3B5');
        S.line(tx, ty - sg * 8, tx, ty + sg * 4, 26, PAL.messing);
      }
      S.line(640, oy, 752, oy, 22, PAL.messing);                   // Messingleiste
    });
    // Lanze: langer Lauf vor dem Bug, Fokusringe, Mint-Linse
    S.line(1080, 280, 1262, 280, 40, '#3B4A5E');
    S.line(1080, 272, 1262, 272, 16, '#8EA3B5');
    [1120, 1168, 1214].forEach(function (rx) { S.line(rx, 250, rx, 310, 22, PAL.messing); });
    S.ell(1268, 280, 14, 26, '#2C5E52', 10);
    S.ell(1272, 280, 9, 18, PAL.mint, 10);
    outline(c, PAL.outline);
  }
  function shipSprite(b) {
    return cached('ship|' + b, 100, 100, function (g, c) { buildShip(g, c, b / ROT_STEPS * Math.PI * 2); });
  }
  function flameSprite(f) {
    return cached('thrust|' + f, 24, 12, function (g) {
      var r = rng(70 + f);
      var L = 22 - r() * 4;
      poly(g, [0, 1, L * 0.6, 3, L, 6, L * 0.6, 9, 0, 11], 'rgba(255,198,107,0.55)');
      poly(g, [0, 3, L * 0.45, 4.5, L * 0.75, 6, L * 0.45, 7.5, 0, 9], PAL.bernstein);
      poly(g, [0, 4.5, L * 0.3, 5.3, L * 0.45, 6, L * 0.3, 6.7, 0, 7.5], '#FFF7E0');
    });
  }
  function drawShip(ctx, x, y, angle, opts) {
    var o = opts || {};
    var t = o.time || 0, ang = angle || 0, b = rotBucket(ang);
    var bang = b / ROT_STEPS * Math.PI * 2;
    var co = Math.cos(bang), si = Math.sin(bang);
    function W(lx, ly) { return [x + lx * co - ly * si, y + lx * si + ly * co]; }
    // Schubflamme hinter dem Ring
    var th = Math.max(0, Math.min(1, o.thrust || 0));
    var rp = W(-35, 0);
    glow(ctx, rp[0], rp[1], PAL.bernstein, 10 + th * 12, 0.35 + th * 0.4);
    if (th > 0.02) {
      ctx.save();
      ctx.translate(rp[0], rp[1]); ctx.rotate(bang + Math.PI);
      var fl = flameSprite(frameOf(t, 14, 4));
      var len = 6 + th * 22;
      var op = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(fl, 0, -6, Math.round(len), 12);
      ctx.globalCompositeOperation = op;
      ctx.restore();
    }
    var spr = shipSprite(b);
    ctx.drawImage(spr, Math.round(x - 50), Math.round(y - 50));
    // Positionslichter (Backbord rot, Steuerbord mint)
    var blink = (t % 1.2) < 0.6;
    var red = W(shipMap(414, 62)[0], shipMap(414, 62)[1]), mint = W(shipMap(414, 498)[0], shipMap(414, 498)[1]);
    glow(ctx, red[0], red[1], PAL.alarmrot, 7, blink ? 0.9 : 0.35);
    glow(ctx, mint[0], mint[1], PAL.mint, 7, blink ? 0.35 : 0.9);
    ctx.fillStyle = blink ? '#FFD0C4' : '#C8605A'; ctx.fillRect(Math.round(red[0]), Math.round(red[1]), 1, 1);
    ctx.fillStyle = blink ? '#8FD0B8' : '#E8FFF8'; ctx.fillRect(Math.round(mint[0]), Math.round(mint[1]), 1, 1);
    var cup = W(shipMap(985, 280)[0], shipMap(985, 280)[1]);
    glow(ctx, cup[0], cup[1], PAL.bernstein, 6, 0.18);
    // M3a: Linse der Lanze glimmt (nicht bei zerstörter Bug-Waffe), Schäden außen sichtbar, Schildstoß
    var lst = o.systems && o.systems.weapon_bow;
    if (lst !== 'broken') { var lz = W(shipMap(1272, 280)[0], shipMap(1272, 280)[1]); glow(ctx, lz[0], lz[1], PAL.mint, 5, lst === 'damaged' ? 0.2 + 0.2 * Math.sin(t * 17) : 0.35 + 0.15 * Math.sin(t * 3)); }
    drawShipDamage(ctx, W, bang, o, t);
    if (o.burst && o.burst.sector != null) {
      var bd = o.burst.duration > 0 ? o.burst.duration : 1.5;
      drawBurst(ctx, x, y, { angle: ang, sector: o.burst.sector, r: o.burstR || 46, duration: bd, age: o.burst.age != null ? o.burst.age : bd - (o.burst.left || 0),
        perfect: !!o.burst.perfect, perfectAge: o.burst.perfectAge, time: t });
    }
    // Treffer-Blitz im Sektor
    if (o.hitSector != null && o.hitT != null && o.hitT >= 0 && o.hitT < 0.45) {
      var q = 1 - o.hitT / 0.45;
      var secAng = [0, Math.PI / 2, Math.PI, -Math.PI / 2][o.hitSector | 0] || 0;
      var shielded = o.shields && o.shields[o.hitSector | 0] > 0;
      var rad = shielded ? 44 : ([34, 15, 34, 15][o.hitSector | 0] || 20);
      var hp = W(Math.cos(secAng) * rad, Math.sin(secAng) * rad);
      if (shielded) {
        ctx.fillStyle = rgba(PAL.eisblau, 0.9 * q);
        for (var i = -6; i <= 6; i++) {
          var aa = bang + secAng + i * 0.07;
          var rr = 44 + (i % 2 ? 1 : 0);
          ctx.fillRect(Math.round(x + Math.cos(aa) * rr), Math.round(y + Math.sin(aa) * rr * 0.92), 2, 1);
        }
        glow(ctx, hp[0], hp[1], PAL.eisblau, 16, q * 0.8);
      } else {
        glow(ctx, hp[0], hp[1], '#F08A3C', 14, q);
        drawFx(ctx, 'sparks', hp[0], hp[1], (1 - q) * 0.45, { seed: 3 });
      }
    }
  }

  // Rostmeute-Jäger (aus concept/raider.svg, gespiegelt: Bug +x)
  var RAIDER_K = 0.46;
  function raiderMap(X, Y) { return [(40 - X) * RAIDER_K, (Y - 40) * RAIDER_K]; }
  function buildRaider(g, c, ang) {
    var S = Rot(g, 24, 24, ang, raiderMap);
    S.poly([44, 14, 62, 10, 66, 22, 50, 30], '#5A4A40');
    S.poly([44, 14, 62, 10, 63, 14, 46, 18], '#7A6656');
    S.poly([40, 50, 64, 46, 70, 66, 48, 70, 42, 62], PAL.rostsand);
    S.poly([44, 60, 66, 57, 70, 66, 48, 70], '#7A3E22');
    S.poly([58, 20, 70, 20, 70, 32, 58, 32], '#3A2E28');
    S.poly([60, 44, 72, 44, 72, 60, 60, 60], '#4F6178');
    S.poly([4, 41, 22, 36, 28, 28, 50, 24, 64, 30, 66, 50, 52, 54, 28, 52, 22, 45], PAL.rostsand);
    S.poly([28, 29, 50, 25, 63, 31, 63, 35, 28, 34], '#E0915A');
    S.poly([22, 45, 28, 48, 52, 50, 66, 47, 66, 50, 52, 54, 28, 52], '#7A3E22');
    S.poly([4, 41, 22, 36, 22, 45], '#E6D3B8');
    S.poly([4, 41, 22, 40, 22, 45], '#8C7C6A');
    S.poly([30, 32, 44, 30, 46, 46, 32, 46], '#4F6178');
    S.poly([31, 33, 43, 31, 43, 35, 31, 37], '#8EA3B5');
    S.poly([54, 30, 62, 32, 62, 44, 54, 46], PAL.terrakotta);
    S.dot(56, 34, '#1E1612'); S.dot(60, 41, '#1E1612');
    for (var i = 0; i < 6; i++) { S.dot(28 + i * 0.7, 30 + i * 3, PAL.warngelb); S.dot(50.3 + i * 0.4, 26 + i * 5, PAL.warngelb); }
    S.ell(26, 39, 2.6, 2.6, PAL.alarmrot, 10);
    S.dot(26, 39, '#FFE2D8');
    S.line(50, 14, 46, 6, 1.2, '#8C7C6A');
    S.dot(46, 6, PAL.alarmrot);
    outline(c, PAL.outlineRust);
  }
  // Kanonenboot (eigener Entwurf, Bug +x, ≈ 64 px)
  function idMap(X, Y) { return [X, Y]; }
  function buildGunboat(g, c, ang) {
    var S = Rot(g, 50, 50, ang, idMap);
    var rust = PAL.rostsand, rustL = '#E0915A', rustD = '#7A3E22', dark = '#3A2E28';
    // Triebwerke
    [-9, 0, 9].forEach(function (yy) { S.poly([-38, yy - 3, -31, yy - 3, -31, yy + 3, -38, yy + 3], dark); S.poly([-38, yy - 3, -31, yy - 3, -31, yy - 2, -38, yy - 2], '#5A4A40'); });
    // Sponsons mit Breitseiten-Geschützen
    S.poly([-24, -12, 12, -12, 9, -19, -21, -19], rustD);
    S.poly([-24, 12, 12, 12, 9, 19, -21, 19], rustD);
    [-14, 2].forEach(function (xx) {
      S.line(xx, -16, xx, -25, 2.4, '#2E3946'); S.line(xx + 3, -16, xx + 3, -24, 2.4, '#2E3946');
      S.ellL(xx + 1.5, -16, 4, 4, '#4F6178', 12); S.ellL(xx + 1, -16.5, 2, 2, '#8EA3B5', 8);
      S.line(xx, 16, xx, 25, 2.4, '#2E3946'); S.line(xx + 3, 16, xx + 3, 24, 2.4, '#2E3946');
      S.ellL(xx + 1.5, 16, 4, 4, '#3B4A5E', 12); S.ellL(xx + 1, 15.5, 2, 2, '#6C7F96', 8);
    });
    // Rumpf
    S.poly([-30, -12, 18, -14, 30, -8, 34, 0, 30, 8, 18, 14, -30, 12, -34, 6, -34, -6], rust);
    S.poly([-30, -12, 18, -14, 28, -9, 20, -9, -32, -7], rustL);
    S.poly([-32, 7, 20, 9, 28, 9, 18, 14, -30, 12], rustD);
    // Rammpflug
    S.poly([30, -8, 38, -3, 41, 0, 38, 3, 30, 8, 33, 0], '#8C7C6A');
    S.poly([30, -8, 38, -3, 41, 0, 33, 0], '#E6D3B8');
    // Panzerplatten + Flicken
    S.poly([-22, -9, -6, -10, -6, -3, -22, -3], '#9A5A34');
    S.poly([10, 3, 22, 3, 22, 9, 10, 10], '#5A6670');
    S.dot(12, 5, '#2E3946'); S.dot(20, 5, '#2E3946'); S.dot(12, 8, '#2E3946'); S.dot(20, 8, '#2E3946');
    // Brückenturm
    S.poly([-8, -6, 8, -6, 11, 0, 8, 6, -8, 6], dark);
    S.poly([-6, -4, 7, -4, 9, 0, 7, 4, -6, 4], '#5A4A40');
    S.poly([3, -3, 7, -3, 8, 0, 7, 3, 3, 3], '#4F6178');
    S.dot(6, -1, PAL.alarmrot); S.dot(6, 1, PAL.alarmrot);
    // Warnstreifen
    for (var i = -26; i < 14; i += 4) { S.dot(i, 11, PAL.warngelb); S.dot(i + 1, 11, PAL.warngelb); }
    // Antenne
    S.line(-14, -6, -20, -12, 1, '#8C7C6A'); S.dot(-20, -12, PAL.alarmrot);
    outline(c, PAL.outlineRust);
  }
  function enemySprite(kind, b) {
    if (kind === 'raider') return cached('raider|' + b, 48, 48, function (g, c) { buildRaider(g, c, b / ROT_STEPS * Math.PI * 2); });
    return cached('gunboat|' + b, 100, 100, function (g, c) { buildGunboat(g, c, b / ROT_STEPS * Math.PI * 2); });
  }
  function drawEnemy(ctx, kind, x, y, angle, opts) {
    var o = opts || {};
    if (o.tele && typeof o.tele === 'object') {   // M3a: Ladeglühen (Alternative: Art.drawTele selbst aufrufen)
      drawTele(ctx, x, y, { left: o.tele.left, dur: o.tele.dur, kind: o.tele.kind, r: TELE_R[kind] || 20, time: o.time });
    }
    if (kind === 'sentinel' || kind === 'pylon') { drawEnemyM1(ctx, kind, x, y, angle, o); teleGlowOver(ctx, kind, x, y, o); return; }   // M1
    if (kind !== 'raider' && kind !== 'gunboat') { missing(ctx, Math.round(x - 14), Math.round(y - 14), 28, 28); return; }
    var t = o.time || 0, b = rotBucket(angle), bang = b / ROT_STEPS * Math.PI * 2;
    var co = Math.cos(bang), si = Math.sin(bang);
    function W(lx, ly) { return [x + lx * co - ly * si, y + lx * si + ly * co]; }
    var spr = enemySprite(kind, b), half = spr.width / 2;
    // Triebwerksglühen
    var engines = kind === 'raider' ? [raiderMap(72, 26), raiderMap(73, 52)] : [[-39, -9], [-39, 0], [-39, 9]];
    for (var i = 0; i < engines.length; i++) {
      var e = W(engines[i][0], engines[i][1]);
      glow(ctx, e[0], e[1], PAL.warngelb, kind === 'raider' ? 6 : 8, 0.55 + 0.25 * Math.sin(t * 20 + i));
    }
    var dx = Math.round(x - half), dy = Math.round(y - half);
    ctx.drawImage(spr, dx, dy);
    if (o.hitT != null && o.hitT >= 0 && o.hitT < 0.18) {
      var sk = kind + '|sil|' + b, sil = cache.get(sk);
      if (!sil) { sil = silhouette(spr, '#FFFFFF'); cache.set(sk, sil); }
      var ga = ctx.globalAlpha; ctx.globalAlpha = ga * (1 - o.hitT / 0.18) * 0.85; ctx.drawImage(sil, dx, dy); ctx.globalAlpha = ga;
    }
    var eye = kind === 'raider' ? W(raiderMap(26, 39)[0], raiderMap(26, 39)[1]) : W(6, 0);
    glow(ctx, eye[0], eye[1], PAL.alarmrot, kind === 'raider' ? 6 : 7, 0.5 + 0.3 * Math.sin(t * 6));
    var hp = o.hpFrac == null ? 1 : o.hpFrac;
    if (hp < 0.6) { var sp = W(kind === 'raider' ? -2 : -10, kind === 'raider' ? 2 : -4); drawFx(ctx, 'smoke', sp[0], sp[1], t + x * 0.01, { small: true }); }
    if (hp < 0.3) { var fp = W(kind === 'raider' ? 3 : 8, kind === 'raider' ? -2 : 5); drawFx(ctx, 'fire', fp[0], fp[1], t, { small: true }); }
    teleGlowOver(ctx, kind, x, y, o);
  }

  // ---------------------------------------------------------------------------------------------
  // S2: Schützlinge (CONTRACT-S2 §7). Bug +x, gedreht vorgerendert in ROT_STEPS Stufen wie die Gegner.
  // drawEscort(ctx, kind, x, y, angle, { hpFrac, hitT, time, distress, state })
  //   kind 'frachter' (Konkordat „Kontor“, ~72×28) | 'karawane' (Vaelen, ~48×36 + 2 Kapseln) | 'bergungsboot' (~40×32)
  //   state 'kampfunfaehig' -> grau-dunkles Wrack (eigene Sprites, ohne Triebwerk und Ring)
  // Eigener begrenzter Cache (escortCache), damit drehende Schützlinge den Gesamt-Cache nicht aufblähen.
  // ---------------------------------------------------------------------------------------------
  var ESCORT = {
    frachter: { size: 90, ring: 46, engines: [[-40, -6], [-40, 0], [-40, 6]], smoke: [-6, -5], fire: [10, 6], lights: [[34, -2], [-20, -13], [-20, 13]] },
    karawane: { size: 124, ring: 40, engines: [[-21, -4], [-21, 4]], smoke: [2, -6], fire: [-8, 5], lights: [[2, -19], [2, 19], [-36, 0], [-52, 0]] },
    bergungsboot: { size: 68, ring: 32, engines: [[-21, -5], [-21, 5]], smoke: [-6, 3], fire: [4, -4], lights: [[18, -14], [-14, -14], [-14, 14]] },
  };
  var escortCache = new SmallCache(200);
  function buildFrachter(g, c, ang, cx) {
    var S = Rot(g, cx, cx, ang, idMap), st = PAL.stahl, pa = PAL.paneel, paL = PAL.paneelHell, ms = PAL.messing;
    // Triebwerksblock
    [-6, 0, 6].forEach(function (yy) { S.poly([-40, yy - 2.5, -34, yy - 2.5, -34, yy + 2.5, -40, yy + 2.5], '#1E2631'); S.poly([-40, yy - 2.5, -34, yy - 2.5, -34, yy - 1.5, -40, yy - 1.5], pa); });
    S.poly([-35, -10, -28, -11, -28, 11, -35, 10], st);
    S.poly([-35, -10, -28, -11, -28, -7, -35, -6], pa);
    // Kiel
    S.poly([-30, -3, 22, -3, 22, 3, -30, 3], '#1E2631');
    // Vier Containermodule je Seite
    var mods = [[-28, -15], [-14, -1], [0, 13]];
    var tints = [[st, pa], [pa, paL], [st, pa]];
    mods.forEach(function (m, i) {
      [-1, 1].forEach(function (sg) {
        var y0 = sg < 0 ? -14 : 3, y1 = sg < 0 ? -3 : 14;
        var body = sg < 0 ? tints[i][1] : tints[i][0];
        S.poly([m[0], y0, m[1], y0, m[1], y1, m[0], y1], body);
        S.poly(sg < 0 ? [m[0], y0, m[1], y0, m[1], y0 + 2, m[0], y0 + 2] : [m[0], y1 - 2, m[1], y1 - 2, m[1], y1, m[0], y1], sg < 0 ? shade(body, 0.25) : shade(body, -0.3));
        for (var rx = m[0] + 3; rx < m[1] - 1; rx += 3) S.line(rx, y0 + 1, rx, y1 - 1, 0.6, shade(body, -0.22));   // Sicken
        S.line(m[0] + 0.5, y0, m[0] + 0.5, y1, 1.2, ms); S.line(m[1] - 0.5, y0, m[1] - 0.5, y1, 1.2, ms);         // Messingbänder
      });
    });
    // Vierter Container quer hinter dem Brückenhaus (mittig)
    S.poly([14, -9, 19, -9, 19, 9, 14, 9], pa); S.line(14.5, -9, 14.5, 9, 1, ms); S.line(18.5, -9, 18.5, 9, 1, ms);
    // Registriernummern-Streifen (Sternweiß mit „Ziffern“)
    S.poly([-26, -12, -16, -12, -16, -9, -26, -9], PAL.sternweiss);
    [-25, -23, -20, -18].forEach(function (dx, k) { S.line(dx, -11.5, dx, -9.5, 0.8, st); if (k % 2) S.dot(dx + 1, -10.5, st); });
    S.poly([2, 10, 11, 10, 11, 12, 2, 12], PAL.sternweiss);
    [3, 5, 8, 10].forEach(function (dx) { S.dot(dx, 11, st); });
    // Brückenhaus am Bug (Kasten, angeschrägt)
    S.poly([19, -10, 30, -10, 36, -5, 36, 5, 30, 10, 19, 10], pa);
    S.poly([19, -10, 30, -10, 34, -6, 19, -6], paL);
    S.poly([19, 7, 33, 6, 30, 10, 19, 10], st);
    S.poly([29, -5, 33, -3, 33, 3, 29, 5], PAL.eisblau);
    S.poly([29, -5, 31, -4, 31, -1, 29, -1], '#E4F4FA');
    S.line(20, -10, 20, 10, 1.2, ms);
    // Antenne
    S.line(23, -2, 16, -2, 0.8, paL); S.dot(16, -2, PAL.bernstein);
    outline(c, PAL.outline);
  }
  function buildKarawane(g, c, ang, cx) {
    var S = Rot(g, cx, cx, ang, idMap), mo = PAL.moos, ho = PAL.holz, te = PAL.terrakotta, ms = PAL.messing;
    // Schleppleinen zu den Kapseln
    S.line(-20, 0, -58, 0, 1, '#4A3524');
    S.line(-20, -1, -58, -1, 0.5, shade(ho, 0.2));
    // Anhängerkapseln (rund, Holz/Terrakotta mit Messingring)
    [-36, -52].forEach(function (kx, k) {
      S.ellL(kx, 0, 7, 6, ho, 18);
      S.ellL(kx - 0.5, -1, 5.5, 4, k ? te : shade(ho, 0.2), 16);
      S.ellL(kx - 1.5, -2.5, 2.5, 1.5, shade(te, 0.3), 10);
      S.line(kx, -6, kx, 6, 1, ms);
    });
    // Segelfinnen oben/unten (Moos-Segel mit Holzrippen)
    [-1, 1].forEach(function (sg) {
      S.poly([-14, sg * 7, 8, sg * 7, 3, sg * 19, -6, sg * 18, -16, sg * 12], sg < 0 ? mo : shade(mo, -0.25));
      S.poly([-12, sg * 8, 6, sg * 8, 4, sg * 11, -13, sg * 11], sg < 0 ? shade(mo, 0.25) : mo);
      S.line(-10, sg * 8, -5, sg * 17, 1, ho); S.line(-2, sg * 8, 1, sg * 18, 1, ho); S.line(5, sg * 8, 3, sg * 18, 1, ho);
      S.line(-6, sg * 18, 3, sg * 19, 1.2, shade(ho, -0.2));
    });
    // Rumpf: gerundet, Holz mit Terrakotta-Dachplatten
    S.ellL(2, 0, 21, 9, shade(ho, -0.25), 28);
    S.ellL(2, -0.5, 20, 8, ho, 28);
    S.ellL(1, -2.5, 16, 4, shade(ho, 0.22), 24);
    for (var px = -12; px <= 12; px += 6) S.poly([px, -4, px + 5, -4, px + 5, 4, px, 4], (px / 6) % 2 ? te : shade(te, -0.18));
    S.line(-16, 0, 20, 0, 0.8, shade(te, -0.4));
    // Moos-Bewuchs an den Kanten
    [[-14, -6], [-8, 7], [9, -7], [14, 6], [-18, 2]].forEach(function (p) { S.ellL(p[0], p[1], 2.2, 1.4, mo, 8); });
    // Bugkanzel
    S.ellL(19, 0, 5, 4.5, ms, 14);
    S.ellL(19.5, 0, 3.5, 3, PAL.eisblau, 12);
    S.dot(19, -1, '#E4F4FA');
    // Heck mit zwei Düsen
    S.poly([-21, -6, -17, -6, -17, 6, -21, 6], '#3A2A20');
    S.dot(-21, -4, ms); S.dot(-21, 4, ms);
    outline(c, PAL.outlineWarm);
  }
  function buildBergungsboot(g, c, ang, cx) {
    var S = Rot(g, cx, cx, ang, idMap), st = PAL.stahl, pa = PAL.paneel, paL = PAL.paneelHell, ms = PAL.messing, wg = PAL.warngelb;
    // Ausleger-Pontons
    [-1, 1].forEach(function (sg) {
      S.poly([-16, sg * 11, 8, sg * 11, 11, sg * 13.5, 8, sg * 16, -16, sg * 16, -18, sg * 13.5], sg < 0 ? pa : st);
      S.poly([-16, sg * 11, 8, sg * 11, 9, sg * 12, -17, sg * 12], sg < 0 ? paL : pa);
      S.line(-6, sg * 6, -6, sg * 11, 2, st); S.line(4, sg * 6, 4, sg * 11, 2, st);
    });
    // Triebwerke
    S.poly([-22, -8, -17, -8, -17, -2, -22, -2], '#1E2631'); S.poly([-22, 2, -17, 2, -17, 8, -22, 8], '#1E2631');
    // Rumpf (gedrungen)
    S.poly([-18, -8, 10, -8, 16, -4, 16, 4, 10, 8, -18, 8], pa);
    S.poly([-18, -8, 10, -8, 14, -5, -18, -5], paL);
    S.poly([-18, 5, 14, 5, 10, 8, -18, 8], st);
    // Rammbügel mit Warnstreifen am Bug
    S.poly([15, -6, 19, -4, 19, 4, 15, 6], st);
    for (var k = -5; k < 5; k += 2) S.poly([15, k, 19, k + 1.4, 19, k + 2.4, 15, k + 1], wg);
    // Warnstreifen am Heck
    for (var j = -17; j < -9; j += 3) S.poly([j, 5.5, j + 1.5, 5.5, j + 2.5, 7.5, j + 1, 7.5], wg);
    // Kanzel
    S.ellL(6, 0, 5, 4, ms, 14); S.ellL(6.5, 0, 3.5, 2.8, PAL.eisblau, 12); S.dot(6, -1, '#E4F4FA');
    // Kran: Drehteller, Ausleger schräg nach vorn-backbord, Greifklaue
    S.ellL(-6, -2, 4, 4, ms, 14); S.ellL(-6, -2, 2, 2, shade(ms, -0.35), 10);
    S.line(-6, -2, 20, -14, 3, st);
    S.line(-6, -3, 20, -15, 1, wg);
    S.line(4, -7, 4, -11, 1, paL);
    S.poly([19, -17, 24, -18, 26, -15, 23, -14], ms);
    S.poly([19, -11, 24, -10, 26, -13, 23, -14], ms);
    S.dot(21, -14, st);
    outline(c, PAL.outline);
  }
  // Wrack: entsättigt + abgedunkelt, Brandflecken (deterministisch je kind)
  function wreckify(c, seed) {
    var g = c.g, w = c.width, h = c.height, id = g.getImageData(0, 0, w, h), d = id.data;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 40) continue;
      var l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
      var v = 26 + l * 0.42;
      d[i] = v * 0.98; d[i + 1] = v; d[i + 2] = v * 1.08;
    }
    var r = rng(seed);
    for (var k = 0; k < 14; k++) {
      var bx = (w * 0.25 + r() * w * 0.5) | 0, by = (h * 0.3 + r() * h * 0.4) | 0, br = 1 + (r() * 3) | 0;
      for (var yy = -br; yy <= br; yy++) for (var xx = -br; xx <= br; xx++) {
        if (xx * xx + yy * yy > br * br) continue;
        var px = bx + xx, py = by + yy; if (px < 0 || py < 0 || px >= w || py >= h) continue;
        var j = (py * w + px) * 4; if (d[j + 3] < 40) continue;
        d[j] = 18; d[j + 1] = 17; d[j + 2] = 20;
      }
    }
    g.putImageData(id, 0, 0);
  }
  function escortSprite(kind, b, wreck) {
    var key = kind + '|' + b + (wreck ? '|w' : ''), c = escortCache.get(key);
    if (c) return c;
    var sz = ESCORT[kind].size, ang = b / ROT_STEPS * Math.PI * 2;
    c = escortCache.make(sz, sz);
    try {
      if (kind === 'frachter') buildFrachter(c.g, c, ang, sz / 2);
      else if (kind === 'karawane') buildKarawane(c.g, c, ang, sz / 2);
      else buildBergungsboot(c.g, c, ang, sz / 2);
      if (wreck) wreckify(c, kind.length * 131 + 7);
    } catch (e) { warn('build escort ' + key, e); missing(c.g, 0, 0, sz, sz); }
    escortCache.set(key, c);
    return c;
  }
  function escortSilhouette(kind, b, spr) {
    var key = kind + '|' + b + '|sil', c = escortCache.get(key);
    if (c) return c;
    c = escortCache.make(spr.width, spr.height);
    c.g.drawImage(spr, 0, 0);
    c.g.globalCompositeOperation = 'source-in';
    c.g.fillStyle = PAL.eisblau;
    c.g.fillRect(0, 0, c.width, c.height);
    c.g.globalCompositeOperation = 'source-over';
    escortCache.set(key, c);
    return c;
  }
  // Gestrichelter Schutzring in Pixeln: 24 Striche, langsam drehend
  function escortRing(ctx, x, y, r, col, a, t) {
    if (a <= 0) return;
    var ga = ctx.globalAlpha, n = 24, rot = (t || 0) * 0.25;
    ctx.globalAlpha = ga * Math.min(1, a);
    ctx.fillStyle = col;
    for (var i = 0; i < n; i++) {
      var a0 = rot + i / n * Math.PI * 2;
      for (var s = 0; s < 4; s++) {
        var aa = a0 + s * (Math.PI * 2 / n) * 0.13;
        ctx.fillRect(Math.round(x + Math.cos(aa) * r), Math.round(y + Math.sin(aa) * r), 2, 1);
      }
    }
    ctx.globalAlpha = ga;
  }
  function drawEscort(ctx, kind, x, y, angle, opts) {
    var o = opts || {};
    var def = ESCORT[kind];
    if (!def) { missing(ctx, Math.round(x - 16), Math.round(y - 16), 32, 32); return; }
    var t = o.time || 0, b = rotBucket(angle), bang = b / ROT_STEPS * Math.PI * 2;
    var co = Math.cos(bang), si = Math.sin(bang);
    function W(lx, ly) { return [x + lx * co - ly * si, y + lx * si + ly * co]; }
    var wreck = o.state === 'kampfunfaehig';
    var hp = o.hpFrac == null ? 1 : Math.max(0, Math.min(1, +o.hpFrac || 0));
    // Schutzring: dezent eisblau; bei Notruf pulsierend Eisblau -> Bernstein
    if (!wreck) {
      if (o.distress) {
        var p = 0.5 + 0.5 * Math.sin(t * 6);
        var col = mix(PAL.eisblau, PAL.bernstein, p);
        escortRing(ctx, x, y, def.ring + 2 * p, col, 0.55 + 0.4 * p, t * 2);
        escortRing(ctx, x, y, def.ring + 5 + 3 * p, col, 0.25 * p, -t * 2);
      } else {
        escortRing(ctx, x, y, def.ring, PAL.eisblau, 0.32, t);
      }
      // Triebwerksglühen (eisblau)
      for (var i = 0; i < def.engines.length; i++) {
        var e = W(def.engines[i][0], def.engines[i][1]);
        glow(ctx, e[0], e[1], PAL.eisblau, kind === 'frachter' ? 7 : 6, 0.5 + 0.2 * Math.sin(t * 14 + i * 1.7));
      }
    }
    var spr = escortSprite(kind, b, wreck), half = spr.width / 2;
    var dx = Math.round(x - half), dy = Math.round(y - half);
    ctx.drawImage(spr, dx, dy);
    if (!wreck && o.hitT != null && o.hitT >= 0 && o.hitT < 0.18) {
      var sil = escortSilhouette(kind, b, spr);
      var ga = ctx.globalAlpha; ctx.globalAlpha = ga * (1 - o.hitT / 0.18) * 0.85; ctx.drawImage(sil, dx, dy); ctx.globalAlpha = ga;
    }
    // Lichter: Frachter Positionslichter, Karawane Bernstein-Laternen (flackernd), Bergungsboot Warnleuchten
    if (!wreck) {
      for (var k = 0; k < def.lights.length; k++) {
        var lp = W(def.lights[k][0], def.lights[k][1]);
        if (kind === 'karawane') glow(ctx, lp[0], lp[1], PAL.bernstein, 6, 0.55 + 0.25 * Math.sin(t * 9 + k * 2.1) * Math.sin(t * 3.3 + k));
        else if (kind === 'bergungsboot') glow(ctx, lp[0], lp[1], k ? PAL.warngelb : PAL.bernstein, 5, ((t * 1.6 + k * 0.5) % 1) < 0.5 ? 0.85 : 0.15);
        else glow(ctx, lp[0], lp[1], k === 0 ? PAL.eisblau : PAL.bernstein, 5, ((t % 1.4) < 0.7) === (k === 1) ? 0.9 : 0.3);
      }
    }
    // Zustände
    var sp = W(def.smoke[0], def.smoke[1]), fp = W(def.fire[0], def.fire[1]);
    if (wreck) {
      drawFx(ctx, 'smoke', sp[0], sp[1], t * 0.6 + x * 0.01, { small: true });
      if ((t * 0.7 + (x | 0) * 0.13) % 2 < 0.25) drawFx(ctx, 'sparks', fp[0], fp[1], ((t * 0.7) % 2) * 1.6, { small: true, seed: 5 });
      glow(ctx, fp[0], fp[1], '#F08A3C', 5, 0.25 + 0.15 * Math.sin(t * 5));
      return;
    }
    if (hp < 0.6) drawFx(ctx, 'smoke', sp[0], sp[1], t + x * 0.01, { small: true });
    if (hp < 0.3) drawFx(ctx, 'fire', fp[0], fp[1], t, { small: true });
  }

  // --- Asteroiden -------------------------------------------------------------------------------
  function drawAsteroid(ctx, x, y, r, seed) {
    r = Math.max(4, Math.min(120, Math.round(r || 20)));
    seed = (seed | 0);
    var key = 'ast|' + seed + '|' + r, size = r * 2 + 8;
    var spr = cached(key, size, size, function (g, c) {
      var rnd = rng(seed * 7919 + 13);
      var tint = seed % 3;
      var base = tint === 0 ? '#6B6058' : tint === 1 ? '#7A5A48' : '#5A5E68';
      var cx = size / 2, cy = size / 2, n = 9 + (seed % 5), pts = [], k;
      for (k = 0; k < n; k++) {
        var a = k / n * Math.PI * 2 + rnd() * 0.3, rr = r * (0.78 + rnd() * 0.26);
        pts.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.92);
      }
      function scaled(s, ox, oy) { var o = []; for (var i = 0; i < pts.length; i += 2) o.push(cx + (pts[i] - cx) * s + ox, cy + (pts[i + 1] - cy) * s + oy); return o; }
      poly(g, pts, shade(base, -0.35));
      poly(g, scaled(0.9, -r * 0.06, -r * 0.07), base);
      poly(g, scaled(0.55, -r * 0.2, -r * 0.22), shade(base, 0.16));
      poly(g, scaled(0.25, -r * 0.3, -r * 0.32), shade(base, 0.3));
      var nc = 1 + Math.floor(r / 10) + (seed % 2);
      for (k = 0; k < nc; k++) {
        var ca = rnd() * Math.PI * 2, cd = rnd() * r * 0.55, cr = 1.5 + rnd() * r * 0.18;
        var ccx = cx + Math.cos(ca) * cd, ccy = cy + Math.sin(ca) * cd;
        ell(g, ccx + 0.6, ccy + 0.6, cr, cr * 0.8, shade(base, 0.2));
        ell(g, ccx, ccy, cr, cr * 0.8, shade(base, -0.3));
      }
      if (tint === 1) for (k = 0; k < 3; k++) P(g, cx + (rnd() - 0.5) * r, cy + (rnd() - 0.5) * r, PAL.rostsand);
      if (tint === 2) for (k = 0; k < 2; k++) P(g, cx + (rnd() - 0.5) * r, cy + (rnd() - 0.5) * r, PAL.eisblau);
      outline(c, '#1A161C');
    });
    ctx.drawImage(spr, Math.round(x - size / 2), Math.round(y - size / 2));
  }

  // --- Stationen --------------------------------------------------------------------------------
  function buildPort(g, c) {
    var cx = 125, cy = 80;
    // Solarflügel links
    [-1, 1].forEach(function (sgn) {
      var y0 = cy + sgn * 26 - (sgn < 0 ? 18 : 0);
      R(g, 6, y0, 44, 18, '#1E2A50');
      for (var x = 6; x < 50; x += 6) R(g, x, y0, 1, 18, '#3A4A80');
      R(g, 6, y0 + 8, 44, 1, '#3A4A80'); R(g, 7, y0 + 1, 42, 1, '#5A6AA8');
      R(g, 50, cy + sgn * 16 - 2, 10, 3, '#4F6178');
    });
    R(g, 48, cy - 2, 12, 4, '#4F6178');
    // Ring
    ell(g, cx, cy, 72, 72, '#3B4A5E');
    ell(g, cx, cy, 70, 70, '#8EA3B5');
    ell(g, cx - 1, cy - 2, 66, 66, '#B5C6D3');
    ell(g, cx, cy, 64, 64, '#6C7F96');
    g.globalCompositeOperation = 'destination-out'; ell(g, cx, cy, 56, 56, '#000'); g.globalCompositeOperation = 'source-over';
    ell(g, cx, cy, 57, 57, 'rgba(0,0,0,0)');
    for (var i = 0; i < 36; i++) {
      var a = i / 36 * Math.PI * 2;
      if (i % 3 === 0) { line(g, cx + Math.cos(a) * 57, cy + Math.sin(a) * 57, cx + Math.cos(a) * 71, cy + Math.sin(a) * 71, '#4F6178'); continue; }
      R(g, cx + Math.cos(a) * 63 - 1, cy + Math.sin(a) * 63 - 1, 2, 2, (i * 7) % 5 === 0 ? '#5A4A30' : PAL.bernstein);
    }
    // Speichen
    for (var s = 0; s < 4; s++) {
      var sa = s / 4 * Math.PI * 2 + Math.PI / 4;
      var p = thick(cx + Math.cos(sa) * 20, cy + Math.sin(sa) * 20, cx + Math.cos(sa) * 58, cy + Math.sin(sa) * 58, 6);
      poly(g, p, '#55667D');
      var p2 = thick(cx + Math.cos(sa) * 20, cy + Math.sin(sa) * 20, cx + Math.cos(sa) * 58, cy + Math.sin(sa) * 58, 2);
      poly(g, p2, '#8EA3B5');
    }
    // Andockarm rechts
    R(g, cx + 66, cy - 6, 40, 12, '#6C7F96'); R(g, cx + 66, cy - 6, 40, 3, '#B5C6D3'); R(g, cx + 66, cy + 4, 40, 2, '#3B4A5E');
    for (var d = cx + 70; d < cx + 104; d += 6) R(g, d, cy - 2, 3, 4, PAL.bernstein);
    R(g, cx + 104, cy - 11, 6, 22, PAL.messing); R(g, cx + 104, cy - 11, 2, 22, '#EAC786');
    for (var h = cy - 9; h < cy + 10; h += 4) R(g, cx + 108, h, 2, 2, PAL.warngelb);
    // Nabe
    ell(g, cx, cy, 24, 24, '#3B4A5E'); ell(g, cx, cy, 22, 22, '#8EA3B5'); ell(g, cx - 2, cy - 2, 18, 18, '#B5C6D3');
    ell(g, cx, cy, 14, 14, '#7A5A28'); ell(g, cx, cy, 12, 12, PAL.messing); ell(g, cx, cy, 8, 8, '#1E3A34'); ell(g, cx, cy, 5, 5, PAL.mint);
    // Schriftzug
    g.drawImage(textSprite('HAFEN', '#2B1D1A', null), cx - 13, cy + 28 - TEXT_HEAD);
    R(g, cx - 18, cy + 26, 36, 1, PAL.terrakotta); R(g, cx - 18, cy + 37, 36, 1, PAL.terrakotta);
    outline(c, PAL.outline);
  }
  function buildBuoyStation(g, c) {
    var M = root.Shared_Maps && root.Shared_Maps.PLATFORM_ROWS;
    var s = 4, ox = 4, oy = 6;
    if (M) {
      for (var y = 0; y < M.length; y++) for (var x = 0; x < M[y].length; x++) {
        var ch = M[y][x];
        if (ch === '~' || ch === ' ') continue;
        var col = ch === '#' ? '#2E3946' : ch === 'b' ? PAL.mint : ch === 'L' ? '#4A5A70' : ch === 'P' ? PAL.messing : ch === 'Z' ? PAL.eisblau : ((x + y) % 2 ? '#56677E' : '#4E5F76');
        R(g, ox + x * s, oy + y * s, s, s, col);
        if (ch === '#') R(g, ox + x * s, oy + y * s, s, 1, '#4C5A6C');
      }
    } else {
      poly(g, [20, 10, 110, 10, 128, 30, 128, 60, 110, 76, 20, 76, 4, 60, 4, 30], '#56677E');
    }
    // Masten + Bojenlicht
    R(g, 60, 0, 2, 32, '#8EA3B5'); R(g, 59, 0, 4, 2, '#4F6178');
    R(g, 120, 40, 14, 2, '#8EA3B5');
    for (var i = 0; i < 128; i += 8) { R(g, ox + i, oy - 2, 4, 1, PAL.warngelb); }
    outline(c, PAL.outline);
  }
  function drawStation(ctx, kind, x, y, opts) {
    var o = opts || {}, t = o.time || 0;
    x = Math.round(x); y = Math.round(y);
    if (kind === 'port') {
      var spr = cached('station|port', 250, 160, buildPort);
      ctx.drawImage(spr, x - 125, y - 80);
      var bl = (t % 1.5) < 0.4;
      glow(ctx, x + 108, y - 11, PAL.alarmrot, 7, bl ? 0.9 : 0.2);
      glow(ctx, x + 108, y + 11, PAL.mint, 7, bl ? 0.2 : 0.9);
      glow(ctx, x, y, PAL.mint, 14, 0.35 + 0.1 * Math.sin(t * 2));
      for (var i = 0; i < 4; i++) { var a = i / 4 * Math.PI * 2 + t * 0.2; glow(ctx, x + Math.cos(a) * 72, y + Math.sin(a) * 72, PAL.bernstein, 5, 0.5); }
    } else if (kind === 'buoy') {
      var b = cached('station|buoy', 140, 84, buildBuoyStation);
      ctx.drawImage(b, x - 70, y - 42);
      var bx = x - 70 + 4 + 15 * 4, by = y - 42 + 6 + 7 * 4;
      glow(ctx, bx, by, PAL.mint, 18, 0.45 + 0.2 * Math.sin(t * 2.5));
      glow(ctx, x - 70 + 61, y - 42, PAL.alarmrot, 6, (t % 3) < 0.3 ? 0.8 : 0.1);   // stumme Boje: seltenes Blinken
    } else if (kind === 'vaelen' || kind === 'wreck' || kind === 'relay') {
      drawStationM1(ctx, kind, x, y, t, o);
    } else if (kind === 'moon') {   // M2: Mond Kesh
      drawMoon(ctx, x, y, t);
    } else {
      missing(ctx, x - 16, y - 16, 32, 32);
    }
  }

  // --- Projektile & Strahlen --------------------------------------------------------------------
  function projSprite(kind) {
    return cached('proj|' + kind, 14, 8, function (g, c) {
      if (kind === 'enemy') { ell(g, 7, 4, 4, 2.5, '#E0473C'); ell(g, 8, 4, 2.5, 1.6, '#FFB070'); P(g, 9, 4, '#FFF1B8'); R(g, 1, 3, 3, 2, 'rgba(224,71,60,0.5)'); }
      else if (kind === 'bolzen') { R(g, 2, 3, 8, 3, PAL.messing); R(g, 2, 3, 8, 1, '#F1D9A0'); R(g, 10, 3, 2, 3, PAL.alarmrot); P(g, 12, 4, PAL.alarmrot); R(g, 1, 2, 2, 5, '#6E4E22'); }
      else if (kind === 'blaster') { R(g, 2, 3, 9, 2, PAL.mint); R(g, 5, 3, 6, 2, '#E8FFF8'); }
      else if (kind === 'drone') { poly(g, [2, 4, 7, 2, 12, 4, 7, 6], PAL.eisblau); poly(g, [5, 4, 8, 3, 11, 4, 8, 5], PAL.alarmrot); }
      else return;
      if (kind !== 'blaster') outline(c, kind === 'bolzen' ? PAL.outlineWarm : '#3A1414');
    });
  }
  var PROJ_GLOW = { enemy: PAL.alarmrot, bolzen: PAL.bernstein, blaster: PAL.mint, drone: PAL.alarmrot };
  function drawProjectile(ctx, kind, x, y, angle, t) {
    if (kind === 'pistol' || kind === 'warden') { drawProjectileM2(ctx, kind, x, y, angle, t); return; }   // M2
    if (!PROJ_GLOW[kind]) { missing(ctx, Math.round(x - 4), Math.round(y - 4), 8, 8); return; }
    var spr = projSprite(kind);
    glow(ctx, x, y, PROJ_GLOW[kind], kind === 'bolzen' ? 5 : 7, 0.6);
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate(angle || 0);
    if (kind === 'bolzen') {
      var fl = frameOf(t || 0, 20, 2);
      ctx.fillStyle = fl ? PAL.funke : PAL.bernstein; ctx.fillRect(-10, -1, fl ? 4 : 3, 2);
      ctx.fillStyle = 'rgba(255,198,107,0.5)'; ctx.fillRect(-13, -1, 3, 2);
    }
    ctx.drawImage(spr, -7, -4);
    ctx.restore();
  }
  function drawBeam(ctx, x1, y1, x2, y2, kind, ttl, opts) {
    if (kind === 'lance' || kind === 'battery' || kind === 'enemy_heavy' || kind === 'bolzen') { drawBeamM3(ctx, x1, y1, x2, y2, kind, ttl, opts); return; }   // M3a
    var a = ttl == null ? 1 : Math.max(0, Math.min(1, ttl / 0.25));
    if (a <= 0) return;
    var dx = x2 - x1, dy = y2 - y1, L = Math.sqrt(dx * dx + dy * dy);
    if (L < 1) return;
    if (kind === 'phase') { drawPhaseBeam(ctx, x1, y1, x2, y2, a, L); return; }   // M1
    var ang = Math.atan2(dy, dx), lanze = kind !== 'seitenturm';
    if (kind !== 'lanze' && kind !== 'seitenturm') { missing(ctx, Math.round(x1), Math.round(y1), 8, 8); }
    var col = lanze ? PAL.bernstein : PAL.mint;
    var op = ctx.globalCompositeOperation, ga = ctx.globalAlpha;
    ctx.save();
    ctx.translate(x1, y1); ctx.rotate(ang);
    ctx.globalCompositeOperation = 'lighter';
    var w = lanze ? 7 : 4;
    ctx.globalAlpha = ga * a * 0.3; ctx.fillStyle = col; ctx.fillRect(0, -Math.round(w * a) / 2 - 1, L, Math.round(w * a) + 2);
    ctx.globalAlpha = ga * a * 0.85; ctx.fillRect(0, -1, L, lanze ? 3 : 2);
    ctx.globalAlpha = ga * a; ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, L, 1);
    ctx.restore();
    ctx.globalCompositeOperation = op; ctx.globalAlpha = ga;
    glow(ctx, x2, y2, col, lanze ? 14 : 9, a);
    glow(ctx, x1, y1, col, lanze ? 9 : 6, a * 0.8);
  }

  // --- Sternenfeld ------------------------------------------------------------------------------
  function starLayer(idx, tw) {
    return cached('stars|' + idx + '|' + tw, 256, 256, function (g) {
      var r = rng(31 + idx * 101), n = [90, 45, 16][idx], i;
      for (i = 0; i < n; i++) {
        var x = r() * 256 | 0, y = r() * 256 | 0, b = r();
        if (idx === 0) P(g, x, y, b > 0.8 ? '#6A6E96' : b > 0.4 ? '#454A70' : '#33375A');
        else if (idx === 1) {
          var col = b > 0.9 ? '#FFD9A0' : b > 0.8 ? '#A9D6E5' : b > 0.3 ? '#B8BCD8' : '#7A7EA8';
          P(g, x, y, col);
          if (b > 0.93) { P(g, x + 1, y, shade(col, -0.4)); }
        } else {
          var on = ((i + tw) % 3) !== 0;
          var c2 = b > 0.75 ? '#FFE9C0' : b > 0.5 ? '#CDEFF7' : PAL.sternweiss;
          P(g, x, y, c2);
          if (on) { P(g, x - 1, y, shade(c2, -0.5)); P(g, x + 1, y, shade(c2, -0.5)); P(g, x, y - 1, shade(c2, -0.5)); P(g, x, y + 1, shade(c2, -0.5)); }
          if (on && b > 0.85) { P(g, x - 2, y, shade(c2, -0.75)); P(g, x + 2, y, shade(c2, -0.75)); P(g, x, y - 2, shade(c2, -0.75)); P(g, x, y + 2, shade(c2, -0.75)); }
        }
      }
    });
  }
  function nebulaLayer() {
    return cached('nebula', 512, 512, function (g) {
      var r = rng(4242);
      var cols = ['#2A2350', '#2A2350', '#1E3A44', '#3A2440', '#2A2350'];
      for (var i = 0; i < 16; i++) {
        var x = r() * 512, y = r() * 512, rad = 60 + r() * 120, col = cols[i % cols.length], a = 0.18 + r() * 0.2;
        for (var ox = -512; ox <= 512; ox += 512) for (var oy = -512; oy <= 512; oy += 512) {
          var gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
          gr.addColorStop(0, rgba(col, a)); gr.addColorStop(1, rgba(col, 0));
          g.fillStyle = gr; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
        }
      }
    });
  }
  function tileLayer(ctx, img, camX, camY, f, w, h, size) {
    var ox = -(((camX * f) % size) + size) % size, oy = -(((camY * f) % size) + size) % size;
    ox = Math.round(ox); oy = Math.round(oy);
    for (var y = oy; y < h; y += size) for (var x = ox; x < w; x += size) ctx.drawImage(img, x, y);
  }
  function drawStarfield(ctx, camX, camY, w, h, t, opts) {
    camX = camX || 0; camY = camY || 0; w = w || 640; h = h || 360;
    var fog = opts && opts.fog;
    ctx.fillStyle = fog ? '#121424' : PAL.tiefraum;
    ctx.fillRect(0, 0, w, h);
    tileLayer(ctx, nebulaLayer(), camX, camY, 0.04, w, h, 512);
    if (fog) {   // M1: Nebel – dichte graue Schwaden, Sterne nur gedämpft
      tileLayer(ctx, fogLayer(0), camX + (t || 0) * 3, camY, 0.08, w, h, 256);
      var ga = ctx.globalAlpha;
      ctx.globalAlpha = ga * 0.45;
      tileLayer(ctx, starLayer(1, 0), camX + 97, camY + 41, 0.25, w, h, 256);
      tileLayer(ctx, starLayer(2, frameOf(t || 0, 1.5, 3)), camX + 31, camY + 177, 0.5, w, h, 256);
      ctx.globalAlpha = ga;
      tileLayer(ctx, fogLayer(1), camX - (t || 0) * 5, camY + 60, 0.35, w, h, 256);
      return;
    }
    tileLayer(ctx, starLayer(0, 0), camX, camY, 0.1, w, h, 256);
    tileLayer(ctx, starLayer(1, 0), camX + 97, camY + 41, 0.25, w, h, 256);
    tileLayer(ctx, starLayer(2, frameOf(t || 0, 1.5, 3)), camX + 31, camY + 177, 0.5, w, h, 256);
  }

  // --- Lichtstimmung ----------------------------------------------------------------------------
  function vignette(col, strength) {
    return cached('vign|' + col + '|' + strength, 320, 180, function (g) {
      var gr = g.createRadialGradient(160, 90, 60, 160, 90, 200);
      gr.addColorStop(0, rgba(col, 0)); gr.addColorStop(1, rgba(col, strength));
      g.fillStyle = gr; g.fillRect(0, 0, 320, 180);
    });
  }
  function drawOverlay(ctx, w, h, opts) {
    var o = opts || {}, t = o.time || 0;
    w = w || 640; h = h || 360;
    var ga = ctx.globalAlpha;
    var prevSmooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    if (o.rooms && o.rooms.length) roomLights(ctx, o.rooms, t);   // M1: Lichtfarbe je Quartier
    if (o.wreck) wreckOverlay(ctx, w, h, t);                       // M1: Wrack – dunkel, flackerndes Notlicht
    if (o.alert === 'red') {
      ctx.fillStyle = 'rgba(11,14,26,0.35)'; ctx.fillRect(0, 0, w, h);
      var pr = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
      ctx.fillStyle = rgba(PAL.alarmrot, 0.06 + 0.12 * pr); ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = ga * (0.6 + 0.4 * pr);
      ctx.drawImage(vignette(PAL.alarmrot, 0.5), 0, 0, w, h);
      ctx.globalAlpha = ga;
    } else if (o.alert === 'yellow') {
      var py = 0.5 + 0.5 * Math.sin(t * Math.PI);
      ctx.fillStyle = rgba(PAL.warngelb, 0.08 * py); ctx.fillRect(0, 0, w, h);
      ctx.drawImage(vignette(PAL.tiefraum, 0.38), 0, 0, w, h);
    } else {
      ctx.fillStyle = 'rgba(255,198,107,0.035)'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(vignette(PAL.tiefraum, 0.38), 0, 0, w, h);
    }
    if (o.fog) fogOverlay(ctx, w, h, t, typeof o.fog === 'number' ? Math.max(0, Math.min(1, o.fog)) : 1);   // M1: Nebel
    if (o.dim) { ctx.fillStyle = 'rgba(11,14,26,' + Math.max(0, Math.min(1, o.dim)) + ')'; ctx.fillRect(0, 0, w, h); }
    ctx.imageSmoothingEnabled = prevSmooth;
  }

  // =============================================================================================
  // M1 – Quartier-Stile, Wrack-Biom, neue Objekte/Deko, Raumobjekte, Nebel, Icons (CONTRACT-M1 §11)
  // =============================================================================================

  // --- Quartiere: Böden und Wände ---------------------------------------------------------------
  var QUARTER_FLOORS = { holz_hell: 1, holz_dunkel: 1, teppich_rot: 1, teppich_blau: 1, fliesen: 1 };
  var QUARTER_WALLS = { holz: 'wood', paneel: 'metal', tapete_gruen: 'tap_g', tapete_creme: 'tap_c' };
  var roomStyleMemo = new Map();   // 'tx,ty' -> Wandstil (für die Wandkachel direkt darüber)
  function rememberRoomStyle(env, tx, ty, ch) {
    if (ch === '#') return;
    var k = tx + ',' + ty, ws = env.roomStyle && env.roomStyle.wall;
    if (ws) { if (roomStyleMemo.get(k) !== ws) roomStyleMemo.set(k, ws); }
    else if (roomStyleMemo.size && roomStyleMemo.has(k)) roomStyleMemo.delete(k);
  }
  function woodPlanks(g, v, tones, seam, seed) {
    var r = rng(seed + v * 31);
    for (var p = 0; p < 4; p++) {
      var y = p * 8, t = tones[(r() * tones.length) | 0];
      R(g, 0, y, 32, 8, t);
      R(g, 0, y, 32, 1, shade(t, 0.14));
      R(g, 0, y + 7, 32, 1, seam);
      for (var k = 0; k < 3; k++) R(g, r() * 28 | 0, y + 2 + (r() * 4 | 0), 3 + (r() * 6 | 0), 1, shade(t, -0.12));
      if (r() < 0.25) { var kx = 4 + r() * 24 | 0; P(g, kx, y + 3, shade(t, -0.28)); P(g, kx + 1, y + 3, shade(t, -0.16)); }
      var ex = 4 + (r() * 24 | 0);
      R(g, ex, y + 1, 1, 6, seam);
    }
  }
  function carpet(g, v, base, lat, dot1, dot2) {
    R(g, 0, 0, 32, 32, base);
    var r = rng(5100 + v * 7);
    for (var i = 0; i < 40; i++) P(g, r() * 32, r() * 32, shade(base, r() < 0.5 ? 0.06 : -0.08));   // Flor
    // Rautengitter (nahtlos auf 32 px)
    for (var d = 0; d < 32; d++) {
      P(g, d, (d + 16) % 32, lat); P(g, d, (48 - d) % 32, lat);
    }
    // Ornament in der Mitte und an den Ecken
    function orn(cx, cy) {
      P(g, cx, cy, dot1); P(g, cx - 1, cy, dot2); P(g, cx + 1, cy, dot2); P(g, cx, cy - 1, dot2); P(g, cx, cy + 1, dot2);
      P(g, cx - 2, cy, shade(base, -0.2)); P(g, cx + 2, cy, shade(base, -0.2));
    }
    orn(16, 16); orn(0, 0); orn(32, 0); orn(0, 32); orn(32, 32);
    P(g, 16, 2, dot2); P(g, 16, 30, dot2); P(g, 2, 16, dot2); P(g, 30, 16, dot2);
  }
  function floorQuarter(g, style, v) {
    if (style === 'holz_hell') woodPlanks(g, v, ['#B88358', '#C08C5E', '#AE7A50', '#C49262', '#B4804F'], '#7A5236', 6100);
    else if (style === 'holz_dunkel') woodPlanks(g, v, ['#5E3B26', '#664029', '#583722', '#6A442B', '#5A3924'], '#38220F', 6200);
    else if (style === 'teppich_rot') carpet(g, v, '#8E3A34', '#A9524A', PAL.messing, '#C46A5C');
    else if (style === 'teppich_blau') carpet(g, v, '#2F4A78', '#43629A', PAL.messing, '#7FA6D0');
    else if (style === 'fliesen') {
      var a = '#E8DCC0', b = '#9FBFA8', grout = '#8E8270';
      R(g, 0, 0, 32, 32, grout);
      for (var q = 0; q < 4; q++) {
        var x = (q % 2) * 16, y = (q >> 1) * 16, col = (q === 0 || q === 3) ? a : b;
        R(g, x + 1, y + 1, 14, 14, col);
        R(g, x + 1, y + 1, 14, 1, shade(col, 0.35)); R(g, x + 1, y + 1, 1, 14, shade(col, 0.2));
        R(g, x + 1, y + 14, 14, 1, shade(col, -0.12));
        P(g, x + 3, y + 3, '#FFFFFF');
      }
      if (v === 2) { P(g, 22, 6, '#7A6E5C'); P(g, 23, 7, '#7A6E5C'); }
    } else floorWood(g, v);
  }
  function wallpaper(g, y0, fh, base, stripe, motif, wain) {
    R(g, 0, y0, 32, 3, '#5E6E80'); R(g, 0, y0, 32, 1, '#7F92A6');            // Lichtleiste-Gehäuse
    R(g, 0, y0 + 3, 32, 9, base);
    for (var x = 2; x < 32; x += 8) R(g, x, y0 + 3, 2, 9, stripe);
    for (var mx = 6; mx < 32; mx += 8) { P(g, mx, y0 + 6, motif); P(g, mx - 1, y0 + 7, motif); P(g, mx + 1, y0 + 7, motif); P(g, mx, y0 + 8, shade(motif, -0.25)); }
    R(g, 0, y0 + 11, 32, 2, PAL.messing); R(g, 0, y0 + 11, 32, 1, '#EAC786');  // Messing-Stuhlleiste
    R(g, 0, y0 + 13, 32, 29 - (y0 + 13), wain);
    for (var px = 1; px < 32; px += 8) { R(g, px, y0 + 14, 6, 2, shade(wain, 0.14)); R(g, px, y0 + 14, 1, 2, shade(wain, 0.25)); }
  }
  var QUARTER_FACE = {
    tap_g: function (g, y0, fh) { wallpaper(g, y0, fh, '#4E7A55', '#44704B', '#8FC48A', '#6E4630'); },
    tap_c: function (g, y0, fh) { wallpaper(g, y0, fh, '#E3D3AE', '#D4C29A', '#B4573E', '#7A4E33'); },
  };

  // --- Wrack: Böden, Wände, Notlicht -------------------------------------------------------------
  function floorWreck(g, v, grate) {
    var r = rng(7000 + v * 23 + (grate ? 300 : 0));
    var base = '#2C333D', hi = '#3A434F', lo = '#20262E', seam = '#171B22';
    if (grate) {
      R(g, 0, 0, 32, 32, '#1A1F27');
      if (v % 3 === 0) { R(g, 0, 18, 32, 4, '#3A1E16'); R(g, 0, 18, 32, 1, '#5A2E20'); }
      if (v % 4 === 1) { R(g, 0, 8, 32, 3, '#1E3A34'); R(g, 0, 8, 32, 1, '#2E5E52'); }
      var bar = '#3A434F', barHi = '#525C6A';
      for (var x = 0; x < 32; x += 4) if (!(v === 5 && x > 12 && x < 24)) R(g, x, 0, 2, 32, bar);
      for (var y = 0; y < 32; y += 8) { R(g, 0, y, 32, 2, bar); R(g, 0, y, 32, 1, barHi); }
      R(g, 0, 0, 32, 1, barHi); R(g, 0, 31, 32, 1, '#151920');
      if (v === 5) { line(g, 13, 8, 18, 15, bar); line(g, 22, 16, 18, 22, bar); }       // verbogene Stäbe
      for (var k = 0; k < 4; k++) P(g, r() * 32, r() * 32, '#6E3A22');
      return;
    }
    base = '#333B47'; hi = '#434D5A';
    R(g, 0, 0, 32, 32, base);
    if (v >= 8) v = (v % 2) ? 0 : 7;   // die Hälfte der Kacheln ohne großen Schaden
    for (var py = 0; py < 2; py++) for (var px = 0; px < 2; px++) {
      var x0 = px * 16, y0 = py * 16, tone = r() < 0.35 ? shade(base, -0.1) : base;
      R(g, x0, y0, 16, 16, tone);
      R(g, x0, y0, 16, 1, hi); R(g, x0, y0, 1, 16, hi);
      R(g, x0, y0 + 15, 16, 1, seam); R(g, x0 + 15, y0, 1, 16, seam);
      if (r() < 0.7) P(g, x0 + 2, y0 + 2, '#55606E');
    }
    // Rost und Schmutz
    for (var i = 0; i < 10; i++) P(g, r() * 32, r() * 32, r() < 0.5 ? '#5A3222' : lo);
    if (v === 1 || v === 6) {   // Riss
      var cx = 4 + r() * 10, cy = 4 + r() * 10;
      for (var s = 0; s < 3; s++) { var nx = cx + 4 + r() * 6, ny = cy + 2 + r() * 8; line(g, cx, cy, nx, ny, '#0C0F14'); cx = nx; cy = ny; }
    } else if (v === 2) {       // Brandfleck
      ell(g, 16, 17, 10, 7, 'rgba(10,8,8,0.55)'); ell(g, 15, 16, 6, 4, 'rgba(10,8,8,0.5)'); P(g, 14, 15, '#4A2A1A');
    } else if (v === 3) {       // Rostpfütze
      ell(g, 18, 20, 8, 4, '#4A2A1C'); ell(g, 17, 19, 6, 2.6, '#5E3424'); P(g, 15, 18, '#8A5A3A');
    } else if (v === 4) {       // fehlende Platte, Kabel darunter
      R(g, 16, 16, 16, 16, '#07090E');
      R(g, 16, 22, 16, 2, PAL.terrakotta); R(g, 16, 26, 16, 1, '#2E6E5C'); R(g, 16, 19, 16, 1, '#55606E');
      R(g, 16, 16, 16, 1, '#4C5664'); R(g, 16, 16, 1, 16, '#4C5664');
    } else if (v === 7) {       // lose Bolzen, Schmierspur
      for (var b = 0; b < 4; b++) { var bx = 4 + r() * 24, by = 4 + r() * 24; R(g, bx, by, 2, 1, '#6E6250'); }
      R(g, 6, 24, 14, 1, 'rgba(10,8,8,0.5)');
    }
  }
  function wallFaceWreck(g, y0, fh, k) {
    var r = rng(7700 + k.v * 11);
    R(g, 0, y0, 32, fh, '#2A323D');
    R(g, 0, y0, 32, 2, '#353F4C'); R(g, 0, y0, 32, 1, '#4A5563');
    R(g, 15, y0 + 2, 1, fh - 2, '#1A1F27'); R(g, 16, y0 + 2, 1, fh - 2, '#3A4450');
    // Notlicht-Gehäuse (Glas wird pro Frame eingefärbt)
    R(g, 11, y0 + 3, 10, 4, '#14181E'); R(g, 12, y0 + 4, 8, 2, '#3A1414');
    // Roststreifen + Brandspuren
    for (var i = 0; i < 3; i++) { var x = 2 + r() * 28 | 0, L = 4 + r() * 10 | 0; R(g, x, y0 + 7, 1, L, '#5A3020'); P(g, x, y0 + 7 + L, '#7A3E22'); }
    if (k.v === 1) { ell(g, 24, y0 + 12, 6, 5, 'rgba(8,6,6,0.6)'); }
    if (k.v === 2) { R(g, 3, y0 + 9, 9, 8, '#0A0C10'); R(g, 5, y0 + 9, 2, 8, '#55606E'); R(g, 8, y0 + 9, 2, 8, '#7E3A28'); R(g, 3, y0 + 12, 9, 1, PAL.messing); }   // offene Verkleidung, Rohre
    if (k.v === 3) { R(g, 20, y0 + 10, 8, 2, '#1A1F27'); R(g, 20, y0 + 13, 8, 2, '#1A1F27'); }
    P(g, 3, y0 + 4, '#55606E'); P(g, 28, y0 + 4, '#55606E');
  }
  function wreckWallDamage(g, k, capH) {
    var r = rng(7900 + k.v * 17 + (k.face ? 5 : 0));
    for (var i = 0; i < 6; i++) P(g, 2 + r() * 28, 2 + r() * (capH - 4), r() < 0.5 ? '#3A2218' : '#161A20');
    if (k.v === 0 && k.oN) { R(g, 6, 0, 5, 1, '#161A20'); R(g, 7, 1, 3, 1, '#161A20'); }    // abgebrochene Kante
    if (k.v === 2 && k.oN) { R(g, 20, 0, 4, 2, '#161A20'); }
  }
  function wreckFlicker(tx, ty, t) {   // 0..1, unregelmäßiges Flackern je Lampe
    var slot = Math.floor(t * 9 + hash2(tx, ty, 41) * 50);
    var dead = hash2(tx, slot, 43) < 0.18;
    return dead ? 0.12 : 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 2.2 + tx));
  }
  function wreckStrip(ctx, px, py, tx, ty, t) {
    ctx.fillStyle = 'rgba(224,71,60,0.14)';
    ctx.fillRect(px, py + CAP_H + 1, 32, 1);
    if (hash2(tx, ty, 39) < 0.4) {   // Notlampe
      var f = wreckFlicker(tx, ty, t);
      ctx.fillStyle = f > 0.3 ? '#FF6A4C' : '#5A1A14';
      ctx.fillRect(px + 12, py + CAP_H + 4, 8, 2);
      if (f > 0.3) { ctx.fillStyle = '#FFD0C4'; ctx.fillRect(px + 14, py + CAP_H + 4, 3, 1); }
      glow(ctx, px + 16, py + CAP_H + 6, PAL.alarmrot, 26, 0.32 * f);
    }
  }
  function wreckFloorDetail(ctx, px, py, tx, ty, t) {
    var h = hash2(tx, ty, 45);
    if (h < 0.05) {   // Funken aus offenem Kabel
      var cyc = (t * 0.7 + h * 40) % 2.8;
      if (cyc < 0.5) drawFx(ctx, 'sparks', px + 22, py + 22, cyc, { small: true, seed: tx * 7 + ty });
    } else if (h > 0.96) {   // Bodenmarkierung Notausgang (schwach leuchtend)
      ctx.fillStyle = 'rgba(127,224,194,' + (0.18 + 0.1 * Math.sin(t * 3 + tx)).toFixed(2) + ')';
      ctx.fillRect(px + 10, py + 14, 12, 2); ctx.fillRect(px + 18, py + 12, 2, 6);
    }
  }
  function stoolSprite() {
    return cached('stool', 22, 12, function (g, c) {
      R(g, 4, 4, 2, 7, '#5A3824'); R(g, 16, 4, 2, 7, '#5A3824'); R(g, 10, 5, 2, 6, '#4A2E1E');
      ell(g, 11, 3.5, 10, 2.6, '#7A5A28'); ell(g, 11, 3, 10, 2.4, PAL.messing); ell(g, 9, 2.6, 4, 1, '#EAC786');
      outline(c, PAL.outlineWarm);
    });
  }

  // --- Reaktorschalter (Messinghebel) -----------------------------------------------------------
  // opts: held (Hebel unten), reactorState 'online'|'overload'|'offline', id 'A'|'B', progress 0..1
  function buildReactorSwitch(g, c, state, held, id) {
    sysBase(g, 3, 26, 41);
    // Wandkasten (Messing, vernietet)
    R(g, 5, 8, 22, 34, '#7A5A28'); R(g, 6, 9, 20, 32, PAL.messing);
    R(g, 6, 9, 20, 1, '#F1D9A0'); R(g, 6, 9, 1, 32, '#EAC786'); R(g, 25, 10, 1, 31, '#8A6530'); R(g, 6, 40, 20, 1, '#6E4E22');
    rivet(g, 7, 10); rivet(g, 23, 10); rivet(g, 7, 37); rivet(g, 23, 37);
    // Manometer oben
    ell(g, 16, 15, 5, 5, '#5A4018'); ell(g, 16, 15, 4.2, 4.2, '#F4EEDC');
    R(g, 12, 15, 2, 1, '#5E8C4A'); R(g, 18, 13, 2, 1, PAL.alarmrot); R(g, 19, 14, 1, 1, PAL.alarmrot);
    var na = state === 'overload' ? -0.4 : state === 'offline' ? 2.6 : -1.6;
    line(g, 16, 15, 16 + Math.cos(na) * 3.4, 15 + Math.sin(na) * 3.4, '#2B1D1A');
    // Hebelschlitz + Warnstreifen
    R(g, 14, 22, 4, 16, '#1E1612'); R(g, 14, 22, 4, 1, '#3A2A12');
    for (var y = 23; y < 38; y += 4) { R(g, 20, y, 2, 2, PAL.warngelb); R(g, 20, y + 2, 2, 2, '#2B1D1A'); }
    // Hebel (oben = Ruhe, unten = gehalten)
    var ky = held ? 35 : 22;
    R(g, 15, Math.min(ky, 29), 2, Math.abs(ky - 29) + 1, '#C8D6E2'); R(g, 15, Math.min(ky, 29), 1, Math.abs(ky - 29) + 1, '#F4F8FA');
    ell(g, 16, 29, 2.6, 2.6, '#3A4759'); P(g, 16, 29, PAL.messing);
    ell(g, 16, ky, 3.4, 3, '#8A2A24'); ell(g, 16, ky - 0.5, 2.8, 2.4, PAL.alarmrot); P(g, 15, ky - 1, '#FFB0A0');
    // Lampengehäuse (Farbe pro Frame)
    R(g, 21, 18, 4, 4, '#2B1D1A');
    // Plakette mit Buchstabe
    R(g, 7, 29, 7, 9, '#2B1D1A'); R(g, 7, 29, 7, 1, '#4A3A28');
    if (id) g.drawImage(textSprite(String(id).slice(0, 1), '#F1D9A0', null), 8, 30 - TEXT_HEAD);
    finish(c, PAL.outlineWarm, [16, 45, 13, 3]);
  }
  function drawReactorSwitch(ctx, px, py, o) {
    var t = o.time || 0, held = !!o.held;
    var st = o.reactorState === 'overload' || o.reactorState === 'offline' ? o.reactorState : 'online';
    var id = o.id === 'A' || o.id === 'B' ? o.id : (o.label || '');
    var spr = cached('obj|rswitch|' + st + '|' + (+held) + '|' + id, 32, 48, function (g, c) { buildReactorSwitch(g, c, st, held, id); });
    ctx.drawImage(spr, px, py - OH);
    var lx = px + 22, ly = py - OH + 19, col, on = true;
    if (st === 'offline') { col = PAL.alarmrot; on = (t * 2.5 % 1) < 0.55; }
    else if (st === 'overload') { col = PAL.bernstein; on = (t * 4 % 1) < 0.5; }
    else col = PAL.mint;
    if (held) { col = PAL.mint; on = (t * 6 % 1) < 0.7; }
    ctx.fillStyle = on ? col : shade(col, -0.6); ctx.fillRect(lx, ly, 2, 2);
    if (on) { ctx.fillStyle = shade(col, 0.6); ctx.fillRect(lx, ly, 1, 1); glow(ctx, lx + 1, ly + 1, col, st === 'online' && !held ? 8 : 14, st === 'online' && !held ? 0.35 : 0.7); }
    if (st === 'offline' && !held) glow(ctx, px + 16, py - OH + 26, PAL.alarmrot, 26, on ? 0.32 : 0.1);   // „hier anfassen“
    if (held) glow(ctx, px + 16, py + 19, PAL.mint, 16, 0.3);
    if (o.progress > 0) {   // Neustart-Fortschritt als 3 Lämpchen
      for (var i = 0; i < 3; i++) {
        var lit = o.progress >= (i + 1) / 3 - 0.001;
        ctx.fillStyle = lit ? PAL.mint : '#1E3A34'; ctx.fillRect(px + 10 + i * 5, py - OH + 5, 3, 2);
      }
    }
  }

  // --- Planungstisch (2×2) ----------------------------------------------------------------------
  function buildPlanTable(g, c, f, active) {   // 64×80; Tischfläche y18–64, Front bis 72, Beine bis 78
    var wood = '#8A5A3B', woodL = '#B88358', woodD = '#5A3824';
    // Beine + Querstrebe
    R(g, 6, 66, 5, 12, woodD); R(g, 53, 66, 5, 12, woodD); R(g, 6, 66, 2, 12, '#7A4E33'); R(g, 53, 66, 2, 12, '#7A4E33');
    R(g, 11, 72, 42, 2, '#4A2E1E');
    // Platte + Front
    R(g, 2, 18, 60, 48, wood); R(g, 2, 18, 60, 1, woodL); R(g, 2, 18, 1, 48, woodL); R(g, 61, 19, 1, 47, woodD);
    for (var gy = 22; gy < 64; gy += 7) R(g, 4, gy, 56, 1, shade(wood, -0.08));
    R(g, 2, 64, 60, 7, '#6E4630'); R(g, 2, 64, 60, 1, '#9A6844'); R(g, 2, 70, 60, 1, '#3A2416');
    R(g, 26, 66, 12, 3, PAL.messing); R(g, 26, 66, 12, 1, '#EAC786');   // Messingschild
    // Messingrahmen um die Sternkarte
    R(g, 7, 22, 50, 38, '#7A5A28'); R(g, 8, 23, 48, 36, PAL.messing); R(g, 8, 23, 48, 1, '#F1D9A0'); R(g, 8, 23, 1, 36, '#EAC786');
    var glass = active ? '#10283A' : '#0C1A26';
    R(g, 10, 25, 44, 32, glass);
    // Sternkarte: Raster, Orte, Routen
    var grid1 = active ? '#1E4458' : '#16313F';
    for (var x = 12; x < 54; x += 6) R(g, x, 25, 1, 32, grid1);
    for (var y = 27; y < 57; y += 6) R(g, 10, y, 44, 1, grid1);
    var pts = [[15, 47], [22, 38], [30, 33], [26, 50], [38, 41], [45, 34], [50, 46]];
    var col = active ? PAL.mint : mix(PAL.mint, glass, 0.35);
    var links = [[0, 1], [1, 2], [1, 3], [2, 4], [3, 4], [4, 5], [4, 6]];
    links.forEach(function (l) { var a = pts[l[0]], b = pts[l[1]]; line(g, a[0], a[1], b[0], b[1], shade(col, -0.35)); });
    pts.forEach(function (p, i) {
      var tw = (i + f) % 4 === 0;
      R(g, p[0] - 1, p[1] - 1, 3, 3, i === 5 ? PAL.bernstein : col);
      P(g, p[0], p[1], tw ? '#FFFFFF' : PAL.sternweiss);
    });
    // Nebel-Fleck und Asteroiden-Punkte
    ell(g, 44, 44, 5, 3, active ? 'rgba(154,144,200,0.45)' : 'rgba(154,144,200,0.25)');
    P(g, 28, 36, '#8E94B8'); P(g, 31, 37, '#8E94B8'); P(g, 29, 38, '#8E94B8');
    // Abtastlinie
    var sx = 10 + ((f * 6) % 44);
    R(g, sx, 25, 1, 32, active ? 'rgba(127,224,194,0.45)' : 'rgba(127,224,194,0.18)');
    scanlines(g, 10, 25, 44, 32);
    P(g, 11, 26, 'rgba(255,255,255,0.4)'); P(g, 12, 26, 'rgba(255,255,255,0.25)');
    // Kleinkram am Rand: Zirkel, Kaffeebecher, Notizkarte
    R(g, 3, 30, 3, 4, '#E8DCC0'); R(g, 58, 50, 3, 4, '#5BA8D8'); P(g, 59, 49, '#3A2A1A');
    line(g, 57, 25, 60, 31, '#C8D6E2'); line(g, 57, 25, 55, 31, '#C8D6E2'); P(g, 57, 25, PAL.messing);
    finish(c, PAL.outlineWarm, [32, 77, 28, 3]);
  }
  function drawPlanTable(ctx, px, py, o) {
    var t = o.time || 0, act = o.active ? 1 : 0, f = frameOf(t, 3, 8);
    var memo = tileMemo.get(memoKey(px, py));
    var spr = cached('obj|plan_table|' + f + '|' + act, 64, 80, function (g, c) { buildPlanTable(g, c, f, act); });
    var qx = o.qx != null ? o.qx : memo && memo.ch === 'Y' ? memo.qx : -1;
    var qy = o.qy != null ? o.qy : memo && memo.ch === 'Y' ? memo.qy : -1;
    if (qx < 0) {   // ohne Lageinfo: ganzer Tisch verkleinert auf eine Kachel
      ctx.drawImage(spr, px, py - 8, 32, 40);
      return;
    }
    if (qy === 0) ctx.drawImage(spr, qx * 32, 0, 32, 48, px, py - OH, 32, 48);
    else ctx.drawImage(spr, qx * 32, 48, 32, 32, px, py, 32, 32);
    if (qx === 1 && qy === 1) {   // Schein der Karte (Mitte des Tischs = oben links dieser Kachel)
      var cx = px, cy = py - 10;
      glow(ctx, cx, cy, PAL.mint, act ? 40 : 26, act ? 0.42 + 0.06 * Math.sin(t * 2) : 0.16);
      if (act) glow(ctx, cx, cy - 4, PAL.eisblau, 18, 0.25);
      if (act) {   // Holo-Funken steigen auf
        ctx.fillStyle = PAL.mint;
        for (var i = 0; i < 6; i++) {
          var p = (t * 0.5 + i / 6) % 1;
          ctx.globalAlpha = (1 - p) * 0.8;
          ctx.fillRect(Math.round(cx - 18 + hash2(i, 3, 61) * 36), Math.round(cy + 8 - p * 22), 1, 1);
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  // --- Neue Deko (Quartiere) --------------------------------------------------------------------
  function buildBookshelf(g, c) {
    var w = '#7A4E33', wl = '#9A6844', wd = '#4A2E1E';
    R(g, 4, 2, 24, 44, wd); R(g, 5, 3, 22, 42, '#3A2416');
    R(g, 4, 2, 24, 2, wl); R(g, 4, 2, 2, 44, w); R(g, 26, 2, 2, 44, w);
    var books = ['#B4573E', '#5E8C4A', '#A9D6E5', '#FFC66B', '#3A3470', '#E8DCC0', '#CC79A7', '#C9974A', '#2E6E5C'];
    var r = rng(812);
    [14, 26, 38].forEach(function (sy) {
      R(g, 5, sy, 22, 2, wl); R(g, 5, sy + 1, 22, 1, w);
      var x = 6;
      while (x < 25) {
        var bw = 2 + (r() * 2 | 0), bh = 7 + (r() * 3 | 0), col = books[(r() * books.length) | 0];
        if (r() < 0.12 && x < 21) { poly(g, [x, sy, x + 2, sy, x + 7, sy - 6, x + 5, sy - 7], col); x += 7; continue; }   // schräges Buch
        R(g, x, sy - bh, bw, bh, col); R(g, x, sy - bh, 1, bh, shade(col, 0.25)); P(g, x, sy - bh + 2, shade(col, -0.35));
        x += bw;
      }
    });
    finish(c, PAL.outlineWarm, [16, 46, 13, 2]);
  }
  function buildAquarium(g, c, f) {
    // Unterschrank
    R(g, 3, 34, 26, 12, '#6E4630'); R(g, 3, 34, 26, 1, '#9A6844'); R(g, 4, 37, 11, 7, '#5A3824'); R(g, 17, 37, 11, 7, '#5A3824');
    P(g, 13, 40, PAL.messing); P(g, 18, 40, PAL.messing);
    // Becken
    R(g, 3, 12, 26, 22, '#1E3A44');
    var gr = g.createLinearGradient(0, 13, 0, 33);
    gr.addColorStop(0, '#5BB8C8'); gr.addColorStop(1, '#2E6E7C');
    g.fillStyle = gr; g.fillRect(4, 14, 24, 19);
    R(g, 4, 14, 24, 1, '#A9E6EE');
    R(g, 4, 30, 24, 3, '#C9A870'); P(g, 8, 30, '#E8DCC0'); P(g, 20, 31, '#8A6530');   // Sand
    // Wasserpflanzen (wiegen)
    var sw = [0, 1, 0, -1][f % 4];
    line(g, 7, 30, 7 + sw, 20, PAL.moos); line(g, 8, 30, 9 + sw, 23, '#7FAE66');
    line(g, 24, 30, 24 - sw, 18, PAL.moos); line(g, 25, 30, 26 - sw, 22, '#7FAE66');
    ell(g, 16, 30, 3, 1.6, '#6B6058');   // Stein
    // Fische
    var fx1 = 6 + ((f * 2) % 16), fx2 = 24 - ((f * 3) % 18);
    R(g, fx1, 19, 4, 2, '#F08A3C'); P(g, fx1 - 1, 19, '#F08A3C'); P(g, fx1 - 1, 20, '#F08A3C'); P(g, fx1 + 3, 19, '#1B2230');
    R(g, fx2, 25, 3, 2, PAL.mint); P(g, fx2 + 3, 25, PAL.mint); P(g, fx2 + 3, 26, PAL.mint); P(g, fx2, 25, '#1B2230');
    // Blasen
    for (var i = 0; i < 3; i++) { var by = 29 - ((f * 2 + i * 5) % 15); P(g, 17 + (i % 2), by, '#E8F8FF'); }
    // Glanz + Messingdeckel
    R(g, 6, 15, 1, 8, 'rgba(255,255,255,0.35)');
    R(g, 2, 10, 28, 3, PAL.messing); R(g, 2, 10, 28, 1, '#F1D9A0'); R(g, 2, 12, 28, 1, '#6E4E22');
    finish(c, PAL.outlineWarm, [16, 46, 13, 2]);
  }
  function buildArmchair(g, c) {
    var b = '#8E3A34', bl = '#B4574C', bd = '#5E2420';
    // Füße
    R(g, 6, 43, 2, 3, '#3A2416'); R(g, 24, 43, 2, 3, '#3A2416');
    // Rückenlehne
    R(g, 6, 14, 20, 16, b); R(g, 6, 14, 20, 2, bl); R(g, 8, 17, 16, 10, shade(b, -0.08));
    for (var x = 10; x < 24; x += 4) P(g, x, 22, PAL.messing);   // Knöpfe (Chesterfield)
    // Armlehnen
    R(g, 3, 24, 6, 18, b); R(g, 23, 24, 6, 18, b); R(g, 3, 24, 6, 2, bl); R(g, 23, 24, 6, 2, bl); R(g, 28, 26, 1, 16, bd);
    // Sitzkissen + Front
    R(g, 8, 29, 16, 7, bl); R(g, 8, 29, 16, 1, '#D07A6E');
    R(g, 3, 36, 26, 7, bd); R(g, 3, 36, 26, 1, b);
    for (var s = 5; s < 29; s += 3) P(g, s, 37, PAL.messing);
    // Kissen in Moosgrün
    R(g, 18, 25, 5, 5, PAL.moos); R(g, 18, 25, 5, 1, '#7FAE66');
    finish(c, PAL.outlineWarm, [16, 46, 14, 2]);
  }
  function buildStarChart(g, c) {
    // Staffelei
    line(g, 9, 46, 13, 12, '#5A3824'); line(g, 23, 46, 19, 12, '#5A3824'); line(g, 16, 46, 16, 30, '#4A2E1E');
    R(g, 8, 36, 16, 2, '#7A4E33');
    // Pergament-Karte
    R(g, 5, 10, 22, 26, '#C9A870'); R(g, 6, 11, 20, 24, '#E8DCC0'); R(g, 6, 11, 20, 1, '#F4EEDC');
    var r = rng(431);
    for (var i = 0; i < 9; i++) P(g, 7 + r() * 18, 12 + r() * 22, '#5A3824');
    // Sternbilder (Terrakotta-Tinte)
    line(g, 9, 30, 13, 24, PAL.terrakotta); line(g, 13, 24, 18, 26, PAL.terrakotta); line(g, 18, 26, 23, 16, PAL.terrakotta);
    line(g, 10, 15, 14, 18, '#8A5A3B');
    // Windrose
    P(g, 21, 30, '#2B1D1A'); P(g, 20, 30, '#8A5A3B'); P(g, 22, 30, '#8A5A3B'); P(g, 21, 29, '#8A5A3B'); P(g, 21, 31, '#8A5A3B'); P(g, 21, 28, PAL.terrakotta);
    R(g, 12, 9, 8, 2, PAL.messing);   // Klemme
    finish(c, PAL.outlineWarm, [16, 46, 9, 2]);
  }
  function buildTrophy(g, c, f) {
    // Sockel
    R(g, 7, 34, 18, 12, '#5A3824'); R(g, 7, 34, 18, 1, '#8A5A3B'); R(g, 6, 44, 20, 2, '#3A2416');
    R(g, 11, 37, 10, 4, PAL.messing); R(g, 11, 37, 10, 1, '#F1D9A0'); R(g, 12, 39, 8, 1, '#8A6530');
    // Bojenmodell: Ring mit Kristallkern
    R(g, 15, 24, 2, 10, '#8EA3B5');
    ell(g, 16, 22, 8, 3, '#8A6530'); ell(g, 16, 21.5, 7, 2.4, PAL.messing); ell(g, 16, 21.5, 5, 1.4, '#3A2A12');
    var pulse = f % 2;
    poly(g, [16, 10, 20, 18, 16, 24, 12, 18], '#5C7E93');
    poly(g, [16, 10, 16, 24, 12, 18], pulse ? PAL.mint : '#5FC4A6');
    P(g, 15, 14, '#E8FFF8');
    finish(c, PAL.outlineWarm, [16, 46, 10, 2]);
  }
  function buildCrystalLamp(g, c) {
    // Sockel (Vaelen: Indigo, Silber)
    ell(g, 16, 44, 7, 2.4, '#1E1A3A'); ell(g, 16, 43, 7, 2.4, '#3A3470'); ell(g, 15, 42.5, 4, 1, '#6E66B0');
    R(g, 14, 34, 4, 9, '#C8D6E2'); R(g, 14, 34, 1, 9, '#F4F8FA');
    // Kristall-Cluster
    poly(g, [16, 6, 21, 18, 19, 34, 13, 34, 11, 18], '#5C7E93');
    poly(g, [16, 6, 16, 34, 13, 34, 11, 18], PAL.eisblau);
    poly(g, [16, 8, 13, 18, 14, 30, 16, 32], '#E8F8FF');
    poly(g, [9, 20, 12, 24, 12, 34, 8, 34, 7, 26], '#6E66B0');
    poly(g, [9, 20, 10, 34, 8, 34, 7, 26], '#9A90E0');
    poly(g, [23, 16, 25, 24, 23, 34, 20, 34, 20, 22], '#3A3470');
    poly(g, [23, 16, 22, 34, 20, 34, 20, 22], '#6E66B0');
    finish(c, '#141A30', [16, 46, 8, 2]);
  }

  // --- Wrack-Objekte -----------------------------------------------------------------------------
  function buildSalvage(g, c, done) {
    var body = '#3E6E6A', bl = '#5A9690', bd = '#25443F', rust = '#7A3E22';
    // Deckel/Oberseite
    R(g, 3, 18, 26, 9, done ? '#1A2422' : bl); R(g, 3, 18, 26, 1, done ? '#2A3836' : '#8AC4BC');
    if (done) { R(g, 5, 20, 22, 6, '#0C1210'); poly(g, [3, 18, 29, 18, 31, 10, 5, 10], body); R(g, 5, 10, 26, 1, bl); }   // Klappe offen
    // Front mit Wellblech
    R(g, 3, 27, 26, 19, body);
    for (var x = 5; x < 28; x += 3) { R(g, x, 28, 1, 17, bd); R(g, x + 1, 28, 1, 17, bl); }
    R(g, 3, 27, 26, 1, bd); R(g, 3, 44, 26, 2, bd);
    // Rost
    var r = rng(915);
    for (var i = 0; i < 14; i++) P(g, 3 + r() * 26, 27 + r() * 18, r() < 0.6 ? rust : '#9A5A34');
    R(g, 3, 40, 7, 4, rust); R(g, 22, 29, 5, 3, rust);
    // Verriegelung + Warnstreifen
    R(g, 13, 30, 6, 9, '#2E3946'); R(g, 14, 31, 4, 7, done ? '#1E2631' : PAL.messing);
    if (!done) { R(g, 15, 33, 2, 3, '#6E4E22'); }
    for (var s = 3; s < 29; s += 4) { R(g, s, 25, 2, 2, PAL.warngelb); R(g, s + 2, 25, 2, 2, '#232A35'); }
    // Lampengehäuse
    R(g, 24, 20, 4, 3, '#1E1612');
    finish(c, PAL.outlineRust, [16, 46, 14, 2]);
  }
  function buildLoreTerminal(g, c, f, read) {
    var body = '#4A4238', bl = '#6A5E50', bd = '#2E2822';
    // Kabel hängen herab
    line(g, 6, 10, 4, 44, '#2E6E5C'); line(g, 26, 12, 28, 42, PAL.terrakotta);
    // Gehäuse
    R(g, 5, 28, 22, 18, body); R(g, 5, 28, 22, 1, bl); R(g, 26, 28, 1, 18, bd);
    R(g, 4, 24, 24, 5, bl); R(g, 4, 24, 24, 1, '#8A7C6A');
    R(g, 7, 4, 18, 21, bd); R(g, 8, 5, 16, 19, '#3A332C');
    // Bildschirm
    var scr = read ? PAL.mint : PAL.bernstein;
    R(g, 9, 7, 14, 14, '#0E1410');
    var flick = [1, 1, 0.5, 1, 0.8, 0.2, 1, 0.9][f];
    var lc = mix('#0E1410', scr, 0.35 + 0.6 * flick);
    for (var l = 0; l < 4; l++) R(g, 10, 9 + l * 3, 4 + ((l * 5 + f) % 8), 1, lc);
    if (f % 2) R(g, 10 + ((f * 3) % 10), 18, 2, 1, scr);   // Cursor
    line(g, 15, 7, 21, 20, 'rgba(200,220,210,0.35)');       // Sprung im Glas
    line(g, 21, 20, 23, 15, 'rgba(200,220,210,0.25)');
    scanlines(g, 9, 7, 14, 14);
    // Tastatur, Staub
    for (var k = 0; k < 6; k++) R(g, 7 + k * 3, 25, 2, 2, '#2E2822');
    var r = rng(77 + 3);
    for (var i = 0; i < 10; i++) P(g, 5 + r() * 22, 28 + r() * 17, '#5E5448');
    R(g, 10, 36, 12, 4, '#2E2822'); R(g, 11, 37, 10, 2, '#6E4E22');
    finish(c, PAL.outlineRust, [16, 46, 13, 2]);
  }
  function buildDebris(g, c, v) {
    var steel = '#3E4754', steelL = '#5E6878', rust = '#6E3A22';
    if (!v) {
      poly(g, [2, 40, 12, 22, 18, 26, 9, 44], steel); poly(g, [2, 40, 12, 22, 13, 24, 4, 41], steelL);    // Platte
      poly(g, thick(6, 18, 28, 38, 4), '#55606E'); poly(g, thick(6, 17, 28, 37, 1.5), '#7A8494');        // Träger
      poly(g, [16, 44, 30, 44, 28, 34, 20, 32], rust); poly(g, [20, 32, 28, 34, 27, 36, 20, 35], '#9A5A34');
      line(g, 12, 30, 22, 46, PAL.terrakotta); line(g, 13, 30, 24, 45, '#2E6E5C');                          // Kabel
      for (var i = 8; i < 28; i += 5) P(g, i, 18 + (i - 6) * 0.9, '#2A303A');
    } else {
      poly(g, [4, 44, 6, 30, 16, 24, 28, 30, 30, 44], '#2A303A');
      poly(g, [6, 30, 16, 24, 28, 30, 16, 34], steelL);
      poly(g, thick(4, 20, 26, 26, 3), rust);
      R(g, 9, 34, 6, 8, steel); R(g, 18, 33, 8, 9, '#4A5563'); R(g, 18, 33, 8, 1, steelL);
      line(g, 22, 20, 14, 10, '#55606E'); line(g, 23, 20, 15, 10, '#3A4450');                               // abstehendes Rohr
      ell(g, 14, 10, 2, 2, '#55606E'); ell(g, 14, 10, 1, 1, '#0A0C10');
    }
    finish(c, '#14181E', [16, 45, 14, 3]);
  }
  function drawWallWeak(ctx, px, py, o) {
    var t = o.time || 0, memo = tileMemo.get(memoKey(px, py));
    var v = memo && memo.ch === 'V' ? memo.v : 3;
    if (o.open) {
      ctx.drawImage(floorSprite('metal', v, 2, false, false, false), px, py);
      var hole = cached('obj|wall_weak_open', 32, 48, function (g, c) {
        // ausgeschnittene Kanten (Wandreste links/rechts), herausgeschnittenes Stück am Boden
        R(g, 0, 16, 5, 32, '#1D232C'); R(g, 27, 16, 5, 32, '#1D232C'); R(g, 0, 16, 32, 5, '#1D232C');
        R(g, 0, 16, 32, 1, '#56606C'); R(g, 4, 21, 1, 27, '#2A323D'); R(g, 27, 21, 1, 27, '#2A323D');
        for (var y = 21; y < 46; y += 3) { P(g, 5, y, '#3A2218'); P(g, 26, y + 1, '#3A2218'); }
        poly(g, [8, 40, 22, 36, 26, 44, 10, 46], '#2A323D'); poly(g, [8, 40, 22, 36, 22, 38, 9, 42], '#4A5563');
        finish(c, '#14181E', null);
      });
      ctx.drawImage(hole, px, py - OH);
      // Schnittkanten glühen nach
      var hot = 0.35 + 0.15 * Math.sin(t * 3);
      ctx.fillStyle = 'rgba(255,138,60,' + hot.toFixed(2) + ')';
      ctx.fillRect(px + 5, py + 5, 1, 27); ctx.fillRect(px + 26, py + 5, 1, 27); ctx.fillRect(px + 5, py + 5, 22, 1);
      glow(ctx, px + 16, py + 8, '#F08A3C', 12, hot * 0.6);
      return;
    }
    if (memo && memo.ch === 'V') ctx.drawImage(memo.spr, px, py);
    else { var w = cached('obj|wall_weak_base', 32, 32, function (g) { buildWall(g, { plat: 2, face: 'wreck', oN: true, oS: true, v: 3 }); }); ctx.drawImage(w, px, py); }
    // dünne, verbeulte Platte mit Rissen und fehlenden Nieten
    var cr = cached('obj|wall_weak_cracks', 32, 32, function (g) {
      R(g, 4, 14, 24, 15, 'rgba(90,100,112,0.35)'); R(g, 4, 14, 24, 1, 'rgba(160,170,180,0.4)');
      line(g, 9, 15, 13, 21, '#0A0C10'); line(g, 13, 21, 11, 27, '#0A0C10'); line(g, 13, 21, 19, 23, '#0A0C10'); line(g, 19, 23, 24, 17, '#0A0C10');
      P(g, 6, 16, '#0A0C10'); P(g, 25, 16, '#55606E'); P(g, 6, 27, '#55606E'); P(g, 25, 27, '#0A0C10');
      ell(g, 17, 22, 4, 3, 'rgba(10,12,16,0.35)');
    });
    ctx.drawImage(cr, px, py);
    if (o.marked) {   // per Weitscan markiert: Hohlraum dahinter – pulsierende Bernstein-Umrandung + Schraffur
      var p = 0.5 + 0.5 * Math.sin(t * 4);
      ctx.fillStyle = rgba(PAL.bernstein, 0.55 + 0.45 * p);
      var dash = Math.floor(t * 8) % 4;
      for (var i = 0; i < 32; i += 4) {
        if (((i >> 2) + dash) % 2) continue;
        ctx.fillRect(px + i, py + 2, 3, 1); ctx.fillRect(px + i, py + 30, 3, 1);
        ctx.fillRect(px + 1, py + i, 1, 3); ctx.fillRect(px + 30, py + i, 1, 3);
      }
      ctx.fillStyle = rgba(PAL.bernstein, 0.18 + 0.12 * p);
      for (var d = 0; d < 28; d += 6) { for (var k = 0; k < 10; k++) ctx.fillRect(px + 4 + d + k * 0.5 | 0, py + 15 + k, 1, 1); }
      glow(ctx, px + 16, py + 20, PAL.bernstein, 18, 0.25 + 0.2 * p);
      drawIcon(ctx, 'widescan', px + 16, py - 6 - Math.round(p * 2), { color: PAL.bernstein });
    }
  }

  // --- Plünderer (rostige Drohne mit Greifarm) --------------------------------------------------
  function buildScavenger(g, c, f) {
    var rust = PAL.rostsand, rl = '#E0915A', rd = '#7A3E22', steel = '#4F5A68';
    var claw = f % 4 < 2 ? 0 : 1;
    // Greifarm (hängt unten)
    R(g, 13, 19, 2, 6, steel); R(g, 13, 19, 1, 6, '#8EA3B5');
    line(g, 14, 25, 10 - claw, 29, '#8EA3B5'); line(g, 14, 25, 18 + claw, 29, '#8EA3B5');
    P(g, 11 - claw, 29, '#C8D6E2'); P(g, 17 + claw, 29, '#C8D6E2');
    // Schubdüsen seitlich
    R(g, 1, 11, 5, 5, steel); R(g, 22, 11, 5, 5, steel); R(g, 1, 11, 5, 1, '#8EA3B5'); R(g, 22, 11, 5, 1, '#8EA3B5');
    // Rumpf (achteckig, geflickt)
    poly(g, [8, 4, 20, 4, 24, 9, 24, 18, 20, 21, 8, 21, 4, 18, 4, 9], rust);
    poly(g, [8, 4, 20, 4, 23, 8, 5, 8], rl);
    poly(g, [4, 16, 24, 16, 24, 18, 20, 21, 8, 21, 4, 18], rd);
    R(g, 6, 10, 5, 4, '#5A6670'); P(g, 6, 10, '#2E3946'); P(g, 10, 13, '#2E3946');   // Flicken
    for (var i = 5; i < 23; i += 3) P(g, i, 15, PAL.warngelb);
    // Auge (gelb-orange)
    ell(g, 16, 11, 3.4, 3.2, '#2A1608'); ell(g, 16, 11, 2.4, 2.2, f % 2 ? PAL.warngelb : '#E0A030'); P(g, 15, 10, '#FFF1B8');
    // Antenne verbogen
    line(g, 9, 4, 6, 0, '#8C7C6A'); P(g, 6, 0, PAL.alarmrot);
  }
  function drawScavenger(ctx, x, y, o) {
    var t = o.time || 0;
    if (o.alive === false) {
      ctx.drawImage(shadowSprite(18), x - 10, y - 3);
      var wr = cached('scav|wreck', 26, 16, function (g, c) {
        poly(g, [2, 11, 9, 5, 14, 10, 7, 14], PAL.rostsand); poly(g, [13, 12, 20, 5, 24, 9, 18, 14], '#7A3E22');
        ell(g, 12, 9, 4, 3, '#4F5A68'); P(g, 12, 9, '#2A1608'); line(g, 18, 13, 24, 15, '#8EA3B5');
        outline(c, PAL.outlineRust);
      });
      ctx.drawImage(wr, x - 13, y - 12);
      drawFx(ctx, 'smoke', x + 2, y - 10, t, { small: true });
      return;
    }
    var f = frameOf(t, 6, 4);
    var spr = cached('scav|' + f, 30, 32, function (g, c) { g.translate(1, 1); buildScavenger(g, c, f); g.setTransform(1, 0, 0, 1, 0, 0); outline(c, PAL.outlineRust); });
    var bob = Math.round(Math.sin(t * 3.4) * 2), hov = 10 + bob;
    if (!o.crouch) ctx.drawImage(shadowSprite(14 - bob), x - (16 - bob) / 2, y - 3);
    var dx = x - 15, dy = y - 32 - hov + 10;
    if (o.crouch) {
      // M2 §15: geduckt – abgesetzt hinter der Deckung, Düsen aus, flach zusammengezogen
      ctx.drawImage(shadowSprite(20), x - 11, y - 3);
      ctx.save();
      ctx.translate(x, y); ctx.scale(1, 0.68); ctx.translate(-x, -y);
      drawFxSprite(ctx, spr, dx, y - 31, { flash: o.hit ? (typeof o.hit === 'number' ? o.hit : 1) : 0 });
      ctx.restore();
      glow(ctx, dx + 17, y - 13, PAL.warngelb, 6, 0.25 + 0.1 * Math.sin(t * 3));
      return;
    }
    glow(ctx, dx + 4, dy + 16, '#F08A3C', 6, 0.5 + 0.3 * Math.sin(t * 20));
    glow(ctx, dx + 26, dy + 16, '#F08A3C', 6, 0.5 + 0.3 * Math.sin(t * 20 + 1));
    if (o.revealed) {
      var sil = cache.get('scav|sil|' + f);
      if (!sil) { sil = silhouette(spr, PAL.alarmrot); cache.set('scav|sil|' + f, sil); }
      var ga = ctx.globalAlpha;
      ctx.globalAlpha = ga * (0.55 + 0.45 * Math.sin(t * 6));
      ctx.drawImage(sil, dx - 1, dy); ctx.drawImage(sil, dx + 1, dy); ctx.drawImage(sil, dx, dy - 1); ctx.drawImage(sil, dx, dy + 1);
      ctx.globalAlpha = ga;
    }
    drawFxSprite(ctx, spr, dx, dy, { flash: o.hit ? (typeof o.hit === 'number' ? o.hit : 1) : 0 });
    glow(ctx, dx + 17, dy + 12, PAL.warngelb, 8, 0.35 + 0.15 * Math.sin(t * 7));
  }

  function drawObjectM1(ctx, kind, px, py, o) {
    var t = o.time || 0, spr, f;
    switch (kind) {
      case 'reactor_switch': drawReactorSwitch(ctx, px, py, o); return true;
      case 'plan_table': drawPlanTable(ctx, px, py, o); return true;
      case 'deco_buecherregal':
        spr = cached('obj|deco_buecherregal', 32, 48, buildBookshelf); ctx.drawImage(spr, px, py - OH); return true;
      case 'deco_aquarium':
        f = frameOf(t + px * 0.01, 4, 8);
        spr = cached('obj|deco_aquarium|' + f, 32, 48, function (g, c) { buildAquarium(g, c, f); });
        ctx.drawImage(spr, px, py - OH);
        glow(ctx, px + 16, py - OH + 22, '#5BB8C8', 16, 0.22 + 0.04 * Math.sin(t * 1.7));
        return true;
      case 'deco_sessel':
        spr = cached('obj|deco_sessel', 32, 48, buildArmchair); ctx.drawImage(spr, px, py - OH); return true;
      case 'deco_sternkarte':
        spr = cached('obj|deco_sternkarte', 32, 48, buildStarChart); ctx.drawImage(spr, px, py - OH); return true;
      case 'deco_trophaee_boje':
        f = frameOf(t, 1.5, 2);
        spr = cached('obj|deco_trophaee_boje|' + f, 32, 48, function (g, c) { buildTrophy(g, c, f); });
        ctx.drawImage(spr, px, py - OH);
        glow(ctx, px + 16, py - OH + 17, PAL.mint, 10, 0.25 + 0.1 * Math.sin(t * 2.5));
        return true;
      case 'deco_kristalllampe': {
        spr = cached('obj|deco_kristalllampe', 32, 48, buildCrystalLamp); ctx.drawImage(spr, px, py - OH);
        glow(ctx, px + 16, py - OH + 20, PAL.eisblau, 26, 0.38 + 0.06 * Math.sin(t * 1.3));
        glow(ctx, px + 12, py - OH + 30, '#9A90E0', 12, 0.25);
        // Glitzern: kurze Funkelpunkte rund um den Kristall
        for (var i = 0; i < 5; i++) {
          var ph = (t * 1.1 + i * 0.37) % 1;
          if (ph > 0.35) continue;
          var sx = px + 8 + hash2(i, Math.floor(t * 1.1 + i * 0.37), 71) * 16, sy = py - OH + 6 + hash2(i, Math.floor(t * 1.1 + i * 0.37), 73) * 28;
          var a = 1 - ph / 0.35;
          ctx.fillStyle = rgba('#FFFFFF', a); ctx.fillRect(Math.round(sx), Math.round(sy), 1, 1);
          if (a > 0.5) { ctx.fillStyle = rgba(PAL.eisblau, a * 0.8); ctx.fillRect(Math.round(sx) - 1, Math.round(sy), 3, 1); ctx.fillRect(Math.round(sx), Math.round(sy) - 1, 1, 3); }
        }
        return true;
      }
      case 'salvage': {
        var dn = !!o.done;
        spr = cached('obj|salvage|' + (+dn), 32, 48, function (g, c) { buildSalvage(g, c, dn); });
        ctx.drawImage(spr, px, py - OH);
        var on = dn ? true : (t * 2 % 1) < 0.5, col = dn ? PAL.mint : PAL.bernstein;
        ctx.fillStyle = on ? col : shade(col, -0.6); ctx.fillRect(px + 25, py - OH + 21, 2, 1);
        if (on) glow(ctx, px + 26, py - OH + 21, col, dn ? 6 : 12, dn ? 0.4 : 0.7);
        return true;
      }
      case 'lore_terminal': {
        var rd = !!(o.done || o.read);
        f = frameOf(t + px * 0.01, 7, 8);
        spr = cached('obj|lore_terminal|' + f + '|' + (+rd), 32, 48, function (g, c) { buildLoreTerminal(g, c, f, rd); });
        ctx.drawImage(spr, px, py - OH);
        glow(ctx, px + 16, py - OH + 14, rd ? PAL.mint : PAL.bernstein, 14, 0.2 + 0.12 * Math.abs(Math.sin(t * 9 + px)));
        return true;
      }
      case 'wall_weak': drawWallWeak(ctx, px, py, o); return true;
      case 'debris': {
        var dv = o.variant != null ? (o.variant ? 1 : 0) : ((px >> 5) + (py >> 5)) % 2;
        spr = cached('obj|debris|' + dv, 32, 48, function (g, c) { buildDebris(g, c, dv); });
        ctx.drawImage(spr, px, py - OH);
        var cyc = (t * 0.5 + px * 0.013) % 3.2;
        if (dv === 0 && cyc < 0.5) drawFx(ctx, 'sparks', px + 17, py + 4, cyc, { small: true, seed: px });
        return true;
      }
      case 'scavenger': drawScavenger(ctx, px + 16, py + 28, o); return true;
    }
    return false;
  }

  // --- Gegenstände M1 (16×16) ------------------------------------------------------------------
  function buildItemM1(g, kind) {
    switch (kind) {
      case 'buecherregal':
        R(g, 3, 1, 10, 14, '#4A2E1E'); R(g, 3, 1, 10, 1, '#9A6844');
        R(g, 4, 7, 8, 1, '#9A6844'); R(g, 4, 13, 8, 1, '#9A6844');
        [['#B4573E', 4], ['#5E8C4A', 6], ['#A9D6E5', 8], ['#FFC66B', 10]].forEach(function (b) { R(g, b[1], 3, 2, 4, b[0]); });
        [['#3A3470', 4], ['#E8DCC0', 6], ['#CC79A7', 8]].forEach(function (b) { R(g, b[1], 9, 2, 4, b[0]); });
        return true;
      case 'aquarium':
        R(g, 2, 12, 12, 3, '#6E4630'); R(g, 2, 3, 12, 9, '#2E6E7C'); R(g, 2, 3, 12, 1, '#A9E6EE');
        R(g, 2, 10, 12, 2, '#C9A870'); R(g, 5, 6, 3, 2, '#F08A3C'); P(g, 4, 6, '#F08A3C'); R(g, 10, 8, 2, 1, PAL.mint);
        line(g, 12, 10, 12, 5, PAL.moos); R(g, 1, 2, 14, 1, PAL.messing);
        return true;
      case 'sessel':
        R(g, 3, 3, 10, 7, '#8E3A34'); R(g, 3, 3, 10, 1, '#B4574C'); R(g, 1, 7, 3, 6, '#8E3A34'); R(g, 12, 7, 3, 6, '#8E3A34');
        R(g, 4, 9, 8, 3, '#B4574C'); R(g, 1, 12, 14, 2, '#5E2420'); P(g, 6, 6, PAL.messing); P(g, 9, 6, PAL.messing);
        return true;
      case 'sternkarte':
        R(g, 2, 3, 12, 10, '#E8DCC0'); R(g, 1, 2, 2, 12, '#C9A870'); R(g, 13, 2, 2, 12, '#C9A870');
        line(g, 4, 10, 7, 6, PAL.terrakotta); line(g, 7, 6, 11, 8, PAL.terrakotta); P(g, 11, 5, '#5A3824'); P(g, 5, 5, '#5A3824');
        return true;
      case 'trophaee_boje':
        R(g, 4, 11, 8, 4, '#5A3824'); R(g, 5, 12, 6, 1, PAL.messing); R(g, 7, 8, 2, 3, '#8EA3B5');
        ell(g, 8, 8, 5, 1.6, PAL.messing); poly(g, [8, 1, 11, 6, 8, 9, 5, 6], '#5C7E93'); poly(g, [8, 1, 8, 9, 5, 6], PAL.mint);
        return true;
      case 'kristalllampe':
        R(g, 6, 12, 4, 3, '#3A3470'); poly(g, [8, 1, 11, 7, 10, 12, 6, 12, 5, 7], '#5C7E93'); poly(g, [8, 1, 8, 12, 6, 12, 5, 7], PAL.eisblau);
        poly(g, [3, 7, 5, 9, 5, 12, 3, 12], '#9A90E0'); poly(g, [12, 6, 13, 9, 12, 12, 10, 12], '#6E66B0'); P(g, 7, 4, '#FFFFFF');
        return true;
      case 'cache':
        R(g, 2, 5, 12, 9, '#3E6E6A'); R(g, 2, 5, 12, 2, '#5A9690'); R(g, 2, 13, 12, 1, '#25443F');
        for (var x = 4; x < 13; x += 3) R(g, x, 7, 1, 6, '#25443F');
        R(g, 6, 3, 4, 2, '#4F6178'); R(g, 11, 8, 2, 2, PAL.mint); P(g, 3, 11, '#7A3E22'); P(g, 9, 12, '#7A3E22');
        return true;
      case 'beacon':
        R(g, 7, 5, 2, 9, '#8EA3B5'); R(g, 7, 5, 1, 9, '#C8D6E2'); R(g, 5, 13, 6, 2, '#4F6178');
        ell(g, 8, 7, 5, 1.6, PAL.messing); ell(g, 8, 7, 3.6, 0.8, '#3A2A12');
        R(g, 6, 1, 4, 3, PAL.bernstein); P(g, 7, 1, PAL.funke);
        return true;
      case 'lore':
        poly(g, [5, 14, 6, 3, 8, 1, 10, 3, 11, 14], '#4A4238'); poly(g, [5, 14, 6, 3, 8, 1, 8, 14], '#6A5E50');
        R(g, 7, 5, 2, 1, PAL.bernstein); R(g, 7, 7, 2, 2, PAL.bernstein); R(g, 6, 10, 4, 1, PAL.bernstein); R(g, 3, 14, 10, 1, '#2E2822');
        return true;
      case 'bolzenwerfer':
        R(g, 2, 9, 9, 4, '#4F6178'); R(g, 2, 9, 9, 1, '#8EA3B5'); R(g, 10, 8, 4, 2, PAL.messing); R(g, 4, 13, 3, 2, '#3A4759');
        poly(g, thick(5, 9, 13, 3, 2), PAL.messing); P(g, 13, 3, PAL.alarmrot);
        return true;
    }
    return false;
  }
  var ITEM_GLOW = { kristalllampe: PAL.eisblau, cache: PAL.mint, beacon: PAL.bernstein, lore: PAL.bernstein, trophaee_boje: PAL.mint };
  function itemGlowM1(ctx, kind, x, y, s, t) {
    var col = ITEM_GLOW[kind];
    if (kind === 'beacon') {   // Leitbake: Signalringe
      glow(ctx, x, y - 5 * s, col, 10 * s, 0.5 + 0.3 * Math.sin(t * 5));
      var p = (t * 0.8) % 1, rr = (6 + p * 16) * s;
      ctx.fillStyle = rgba(col, (1 - p) * 0.8);
      for (var i = 0; i < 16; i++) { var a = i / 16 * Math.PI * 2; ctx.fillRect(Math.round(x + Math.cos(a) * rr), Math.round(y + Math.sin(a) * rr * 0.8), 1, 1); }
      return;
    }
    if (kind === 'cache') { glow(ctx, x + 4 * s, y, col, 7 * s, (t * 1.5 % 1) < 0.5 ? 0.6 : 0.15); return; }
    glow(ctx, x, y, col, 9 * s, 0.3 + 0.1 * Math.sin(t * 3));
  }

  // --- Gegner M1: Kustoden-Wächter (kristallin, Leuchtring) und Pylon (Säule mit Schildfront) ----
  function arcPts(cx, cy, r0, r1, a0, a1, n) {
    var out = [], i, a;
    for (i = 0; i <= n; i++) { a = a0 + (a1 - a0) * i / n; out.push(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); }
    for (i = n; i >= 0; i--) { a = a0 + (a1 - a0) * i / n; out.push(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); }
    return out;
  }
  function buildSentinel(g, c, ang) {
    var S = Rot(g, 28, 28, ang, idMap);
    for (var k = 0; k < 6; k++) {
      var a = k / 6 * Math.PI * 2 + Math.PI / 6, ca = Math.cos(a), sa = Math.sin(a), px = -sa, py = ca;
      var r0 = 7, r1 = k === 0 || k === 5 ? 21 : 18, w = 4;
      S.poly([ca * r0 + px * w, sa * r0 + py * w, ca * r1, sa * r1, ca * r0 - px * w, sa * r0 - py * w], '#5C7E93');
      S.poly([ca * r0 + px * w, sa * r0 + py * w, ca * r1, sa * r1, ca * (r0 + 2), sa * (r0 + 2)], PAL.eisblau);
      S.poly([ca * (r0 + 3) + px * 1.5, sa * (r0 + 3) + py * 1.5, ca * (r1 - 3), sa * (r1 - 3), ca * (r0 + 4), sa * (r0 + 4)], '#E8F8FF');
    }
    // Bugdorn (Blickrichtung)
    S.poly([8, -3, 24, 0, 8, 3], '#6E66B0'); S.poly([8, -3, 24, 0, 10, 0], '#9A90E0');
    var hex = []; for (var h = 0; h < 6; h++) { var ha = h / 6 * Math.PI * 2; hex.push(Math.cos(ha) * 10, Math.sin(ha) * 10); }
    S.poly(hex, '#2A2350');
    var hex2 = []; for (var h2 = 0; h2 < 6; h2++) { var hb = h2 / 6 * Math.PI * 2; hex2.push(Math.cos(hb) * 7.5, Math.sin(hb) * 7.5); }
    S.poly(hex2, '#3A3470');
    S.ellL(3, 0, 3, 3, '#0E1D1C', 10); S.ellL(3, 0, 2, 2, PAL.mint, 8); S.dot(2, -1, '#E8FFF8');
    outline(c, '#141A30');
  }
  function buildPylon(g, c, ang) {
    var S = Rot(g, 24, 24, ang, idMap);
    var oct = []; for (var i = 0; i < 8; i++) { var a = i / 8 * Math.PI * 2 + Math.PI / 8; oct.push(Math.cos(a) * 14, Math.sin(a) * 14); }
    S.poly(oct, '#2E3946');
    var oct2 = []; for (var j = 0; j < 8; j++) { var b = j / 8 * Math.PI * 2 + Math.PI / 8; oct2.push(Math.cos(b) * 12, Math.sin(b) * 12); }
    S.poly(oct2, '#3B4656');
    // Schildprojektor-Platten vorn (Bug +x)
    S.poly(arcPts(0, 0, 13, 18, -0.9, 0.9, 8), '#5C7E93');
    S.poly(arcPts(0, 0, 14, 17, -0.8, 0.8, 8), '#8FC4D8');
    S.poly(arcPts(0, 0, 15.5, 16.5, -0.7, 0.7, 6), '#E8F8FF');
    // Säulenkopf (Stein, Indigo) mit Kristallspitze
    var hx = []; for (var k = 0; k < 6; k++) { var c2 = k / 6 * Math.PI * 2; hx.push(Math.cos(c2) * 8, Math.sin(c2) * 8); }
    S.poly(hx, '#4A4A6A');
    S.poly([-8, 0, -4, -7, 4, -7, 8, 0, 0, 0], '#5E5E80');
    S.poly([0, -4, 4, 0, 0, 4, -4, 0], '#5C7E93'); S.poly([0, -4, 0, 4, -4, 0], PAL.eisblau); S.dot(-1, -1, '#E8F8FF');
    // Runenpunkte
    for (var r = 0; r < 8; r++) { var ra = r / 8 * Math.PI * 2; S.dot(Math.cos(ra) * 10.5, Math.sin(ra) * 10.5, r % 2 ? '#2E6E5C' : PAL.mint); }
    outline(c, '#141A24');
  }
  function drawEnemyM1(ctx, kind, x, y, angle, o) {
    var t = o.time || 0, b = rotBucket(angle), bang = b / ROT_STEPS * Math.PI * 2;
    var size = kind === 'sentinel' ? 56 : 48, half = size / 2;
    var spr = cached(kind + '|' + b, size, size, function (g, c) { (kind === 'sentinel' ? buildSentinel : buildPylon)(g, c, b / ROT_STEPS * Math.PI * 2); });
    var dx = Math.round(x - half), dy = Math.round(y - half);
    var sh = o.shields, sm = o.shieldsMax;
    if (kind === 'sentinel') {
      glow(ctx, x, y, '#6E66B0', 26, 0.3);
      ctx.drawImage(spr, dx, dy);
      // rotierender Leuchtring
      var n = 24, rr = 23, rot = t * 1.4;
      for (var i = 0; i < n; i++) {
        var a = rot + i / n * Math.PI * 2;
        ctx.fillStyle = i % 3 === 0 ? '#E8F8FF' : i % 2 ? PAL.mint : PAL.eisblau;
        ctx.fillRect(Math.round(x + Math.cos(a) * rr), Math.round(y + Math.sin(a) * rr * 0.92), i % 3 === 0 ? 2 : 1, 1);
      }
      glow(ctx, x + Math.cos(bang) * 3, y + Math.sin(bang) * 3, PAL.mint, 10, 0.5 + 0.25 * Math.sin(t * 5));
    } else {
      ctx.drawImage(spr, dx, dy);
      // Schildfront: Energiebogen vor dem Bug, Stärke aus shields[0]/shieldsMax[0]
      var frac = sh && sm && sm[0] ? Math.max(0, Math.min(1, sh[0] / sm[0])) : (sh ? (sh[0] > 0 ? 1 : 0) : 1);
      var fl = 0.75 + 0.25 * Math.sin(t * 9);
      ctx.fillStyle = rgba(PAL.eisblau, (0.25 + 0.65 * frac) * fl);
      for (var k = -14; k <= 14; k++) {
        var aa = bang + k * 0.075, r2 = 21 + (k % 2 ? 0 : 1);
        if (frac <= 0 && (k + Math.floor(t * 10)) % 3) continue;
        ctx.fillRect(Math.round(x + Math.cos(aa) * r2), Math.round(y + Math.sin(aa) * r2), 2, 1);
        if (frac > 0.5) ctx.fillRect(Math.round(x + Math.cos(aa) * (r2 + 2)), Math.round(y + Math.sin(aa) * (r2 + 2)), 1, 1);
      }
      if (frac > 0) glow(ctx, x + Math.cos(bang) * 20, y + Math.sin(bang) * 20, PAL.eisblau, 16, 0.35 * frac * fl);
      glow(ctx, x, y, PAL.eisblau, 10, 0.4 + 0.2 * Math.sin(t * 3));
    }
    if (o.hitT != null && o.hitT >= 0 && o.hitT < 0.18) {
      var sk = kind + '|sil|' + b, sil = cache.get(sk);
      if (!sil) { sil = silhouette(spr, '#FFFFFF'); cache.set(sk, sil); }
      var ga = ctx.globalAlpha; ctx.globalAlpha = ga * (1 - o.hitT / 0.18) * 0.85; ctx.drawImage(sil, dx, dy); ctx.globalAlpha = ga;
    }
    var hp = o.hpFrac == null ? 1 : o.hpFrac;
    if (hp < 0.6) drawFx(ctx, 'smoke', x - 3, y - 2, t + x * 0.01, { small: true });
    if (hp < 0.3) drawFx(ctx, 'sparks', x + 4, y - 4, (t * 1.5) % 0.6, { small: true });
  }

  // --- Stationen M1: Vaelen-Karawane, Wrack „Zaunkönig“, Kustoden-Relais -------------------------
  var VAELEN_SHIPS = [   // x, y, rx, ry, Rumpf, Segel
    [34, 82, 26, 13, PAL.eisblau, PAL.terrakotta], [92, 66, 30, 15, '#3A3470', PAL.bernstein], [154, 78, 34, 17, PAL.eisblau, PAL.mint],
    [214, 62, 26, 13, '#3A3470', '#CC79A7'], [266, 80, 24, 12, PAL.eisblau, PAL.moos],
  ];
  var VAELEN_LIGHTS = [];
  function buildVaelen(g, c) {
    var i, s;
    VAELEN_LIGHTS.length = 0;
    // Kupplungen (Röhren + Kabel) zwischen den Schiffen
    for (i = 0; i + 1 < VAELEN_SHIPS.length; i++) {
      var a = VAELEN_SHIPS[i], b = VAELEN_SHIPS[i + 1];
      poly(g, thick(a[0] + a[2] - 4, a[1], b[0] - b[2] + 4, b[1], 7), '#5A4018');
      poly(g, thick(a[0] + a[2] - 4, a[1], b[0] - b[2] + 4, b[1], 5), PAL.messing);
      poly(g, thick(a[0] + a[2] - 4, a[1] - 1.5, b[0] - b[2] + 4, b[1] - 1.5, 1.2), '#EAC786');
      line(g, a[0] + a[2] - 8, a[1] + 8, b[0] - b[2] + 8, b[1] + 8, '#2A2350');
      VAELEN_LIGHTS.push([(a[0] + a[2] + b[0] - b[2]) / 2, (a[1] + b[1]) / 2 - 3, PAL.bernstein]);
    }
    for (i = 0; i < VAELEN_SHIPS.length; i++) {
      s = VAELEN_SHIPS[i];
      var x = s[0], y = s[1], rx = s[2], ry = s[3], hull = s[4], sail = s[5];
      var dark = hull === PAL.eisblau ? '#5C7E93' : '#2A2350', light = hull === PAL.eisblau ? '#E8F8FF' : '#6E66B0';
      // Segel / Sonnensegel über dem Rumpf
      poly(g, [x - rx * 0.5, y - ry + 2, x + rx * 0.2, y - ry - 22, x + rx * 0.45, y - ry + 2], shade(sail, -0.25));
      poly(g, [x - rx * 0.5, y - ry + 2, x + rx * 0.2, y - ry - 22, x + rx * 0.05, y - ry + 2], sail);
      line(g, x + rx * 0.2, y - ry - 22, x + rx * 0.2, y - ry + 2, '#5A4018');
      P(g, x + rx * 0.2, y - ry - 23, PAL.bernstein);
      // Frachtkapseln unten
      for (var k = 0; k < 3; k++) {
        var cx = x - rx * 0.5 + k * rx * 0.5, col = [PAL.terrakotta, PAL.bernstein, PAL.mint, '#CC79A7', PAL.moos][(i + k) % 5];
        R(g, cx - 4, y + ry - 3, 8, 7, shade(col, -0.2)); R(g, cx - 4, y + ry - 3, 8, 2, col);
      }
      // Rumpf
      ell(g, x, y + 1, rx, ry, dark);
      ell(g, x - 1, y, rx - 1, ry - 1, hull);
      ell(g, x - rx * 0.25, y - ry * 0.35, rx * 0.6, ry * 0.35, light);
      // Bug-Spitze rechts
      poly(g, [x + rx - 6, y - 5, x + rx + 9, y, x + rx - 6, y + 5], dark);
      poly(g, [x + rx - 6, y - 5, x + rx + 9, y, x + rx - 4, y], light);
      // Bänder + Fenster
      R(g, x - rx + 4, y + 2, rx * 2 - 8, 2, PAL.messing);
      for (var w = -rx + 8; w < rx - 6; w += 7) { R(g, x + w, y - 3, 3, 2, PAL.bernstein); VAELEN_LIGHTS.push([x + w + 1, y - 2, PAL.bernstein]); }
      // Kuppel auf dem mittleren Schiff
      if (i === 2) { ell(g, x + 4, y - ry + 1, 10, 6, '#8A6530'); ell(g, x + 4, y - ry, 9, 5, PAL.bernstein); ell(g, x + 1, y - ry - 2, 4, 2, '#FFF1C9'); VAELEN_LIGHTS.push([x + 4, y - ry, PAL.bernstein]); }
      // Wimpel
      line(g, x - rx + 2, y - 4, x - rx - 8, y - 10, '#5A4018');
      poly(g, [x - rx - 8, y - 10, x - rx - 16, y - 8, x - rx - 8, y - 6], ['#CC79A7', PAL.mint, PAL.bernstein][i % 3]);
      VAELEN_LIGHTS.push([x + rx + 8, y, i % 2 ? PAL.mint : PAL.alarmrot]);
    }
    outline(c, '#1A1638');
  }
  function buildWreckStation(g, c) {
    function rot(pts, cx, cy, a) { var co = Math.cos(a), si = Math.sin(a), out = []; for (var i = 0; i < pts.length; i += 2) { var dx = pts[i] - cx, dy = pts[i + 1] - cy; out.push(cx + dx * co - dy * si, cy + dx * si + dy * co); } return out; }
    var hull = '#4A5563', hullL = '#6A7584', hullD = '#2E3640', rust = '#7A3E22';
    // Heckteil (leicht nach oben gekippt)
    var ra = -0.12, rcx = 150, rcy = 75;
    poly(g, rot([22, 50, 140, 46, 148, 58, 146, 100, 140, 104, 22, 100, 12, 90, 12, 60], rcx, rcy, ra), hullD);
    poly(g, rot([24, 52, 138, 48, 144, 58, 142, 96, 24, 96, 16, 88, 16, 62], rcx, rcy, ra), hull);
    poly(g, rot([24, 52, 138, 48, 144, 58, 16, 62], rcx, rcy, ra), hullL);
    // Triebwerke
    [60, 75, 90].forEach(function (yy) { poly(g, rot([2, yy - 5, 14, yy - 6, 14, yy + 6, 2, yy + 5], rcx, rcy, ra), '#2A303A'); });
    // Container an Deck
    var cols = ['#3E6E6A', '#8A5A3B', '#5A6670', '#7A3E22', '#3E6E6A'];
    for (var i = 0; i < 5; i++) for (var j = 0; j < 2; j++) {
      var x = 34 + i * 20, y = 60 + j * 16;
      poly(g, rot([x, y, x + 17, y, x + 17, y + 13, x, y + 13], rcx, rcy, ra), cols[(i + j * 2) % 5]);
      poly(g, rot([x, y, x + 17, y, x + 17, y + 2, x, y + 2], rcx, rcy, ra), shade(cols[(i + j * 2) % 5], 0.25));
    }
    // Bruchkante Heck: Spanten
    for (var s = 0; s < 6; s++) { var yy = 50 + s * 9; poly(g, rot([140 + (s % 2) * 4, yy, 152 + (s % 3) * 3, yy + 1, 152 + (s % 3) * 3, yy + 4, 140, yy + 4], rcx, rcy, ra), '#0A0C10'); line(g, rot([146, yy], rcx, rcy, ra)[0], rot([146, yy], rcx, rcy, ra)[1], rot([154, yy + 2], rcx, rcy, ra)[0], rot([154, yy + 2], rcx, rcy, ra)[1], '#6A7584'); }
    // Bugteil (nach unten gekippt, versetzt)
    var fa = 0.16;
    poly(g, rot([176, 52, 270, 52, 306, 70, 306, 84, 270, 104, 176, 104, 170, 92, 172, 62], 240, 78, fa), hullD);
    poly(g, rot([178, 54, 268, 54, 302, 71, 302, 83, 268, 100, 178, 100, 174, 90, 175, 64], 240, 78, fa), hull);
    poly(g, rot([178, 54, 268, 54, 302, 71, 175, 64], 240, 78, fa), hullL);
    // Brückenfenster (tot) + Zierstreifen
    poly(g, rot([272, 66, 290, 70, 290, 76, 272, 76], 240, 78, fa), '#141A22');
    poly(g, rot([178, 82, 300, 80, 300, 83, 178, 85], 240, 78, fa), PAL.terrakotta);
    // Rostflecken + Löcher
    var r = rng(4711);
    for (var k = 0; k < 40; k++) { var px2 = 20 + r() * 280, py2 = 54 + r() * 46; P(g, px2, py2, r() < 0.6 ? rust : '#9A5A34'); }
    ell(g, 210, 88, 6, 4, '#0A0C10'); ell(g, 90, 92, 5, 3, '#0A0C10');
    // Trümmer in der Lücke
    poly(g, [156, 70, 166, 66, 168, 74, 158, 76], '#3E4754'); poly(g, [160, 90, 170, 94, 164, 100], rust); poly(g, [152, 40, 158, 38, 160, 44], '#5A6670');
    poly(g, [168, 112, 176, 110, 174, 118], '#3E4754'); line(g, 150, 80, 176, 86, PAL.terrakotta);
    // Schriftzug (verblasst)
    g.globalAlpha = 0.6; g.drawImage(textSprite('ZAUNK', '#C8B48A', null), 200, 58 - TEXT_HEAD); g.globalAlpha = 1;
    outline(c, PAL.outlineRust);
  }
  var WRECK_LIGHTS = [[40, 58], [128, 52], [196, 62], [286, 76], [150, 72]];
  function buildRelay(g, c) {
    var cx = 120, cy = 120, k, a;
    // Kristallspitzen (6 groß, 6 klein dazwischen)
    for (k = 0; k < 12; k++) {
      a = k / 12 * Math.PI * 2 - Math.PI / 2;
      var big = k % 2 === 0, r0 = 38, r1 = big ? 108 : 70, w = big ? 11 : 6;
      var ca = Math.cos(a), sa = Math.sin(a), px = -sa, py = ca;
      poly(g, [cx + ca * r0 + px * w, cy + sa * r0 + py * w, cx + ca * r1, cy + sa * r1, cx + ca * r0 - px * w, cy + sa * r0 - py * w], big ? '#5C7E93' : '#3A3470');
      poly(g, [cx + ca * r0 + px * w, cy + sa * r0 + py * w, cx + ca * r1, cy + sa * r1, cx + ca * (r0 + 6), cy + sa * (r0 + 6)], big ? PAL.eisblau : '#6E66B0');
      if (big) poly(g, [cx + ca * (r0 + 8) + px * 3, cy + sa * (r0 + 8) + py * 3, cx + ca * (r1 - 12), cy + sa * (r1 - 12), cx + ca * (r0 + 10), cy + sa * (r0 + 10)], '#E8F8FF');
    }
    // Sechseckige Plattform
    var hex = []; for (k = 0; k < 6; k++) { a = k / 6 * Math.PI * 2; hex.push(cx + Math.cos(a) * 46, cy + Math.sin(a) * 46); }
    poly(g, hex, '#1E1A3A');
    var hex2 = []; for (k = 0; k < 6; k++) { a = k / 6 * Math.PI * 2; hex2.push(cx + Math.cos(a) * 42, cy + Math.sin(a) * 42); }
    poly(g, hex2, '#2A2350');
    var hex3 = []; for (k = 0; k < 6; k++) { a = k / 6 * Math.PI * 2 + Math.PI / 6; hex3.push(cx + Math.cos(a) * 30, cy + Math.sin(a) * 30); }
    poly(g, hex3, '#3A3470');
    // Runenlinien
    for (k = 0; k < 6; k++) {
      a = k / 6 * Math.PI * 2 + Math.PI / 6;
      line(g, cx + Math.cos(a) * 24, cy + Math.sin(a) * 24, cx + Math.cos(a) * 40, cy + Math.sin(a) * 40, '#2E6E5C');
      P(g, cx + Math.cos(a) * 36, cy + Math.sin(a) * 36, PAL.mint);
    }
    // Kern
    ell(g, cx, cy, 20, 20, '#141230'); ell(g, cx, cy, 17, 17, '#6E66B0'); ell(g, cx, cy, 15, 15, '#1E1A3A'); ell(g, cx, cy, 10, 10, '#2E6E5C'); ell(g, cx, cy, 6, 6, PAL.mint); ell(g, cx - 2, cy - 2, 2.5, 2.5, '#E8FFF8');
    outline(c, '#100E24');
  }
  function drawStationM1(ctx, kind, x, y, t, o) {
    var i, spr;
    if (kind === 'vaelen') {
      spr = cached('station|vaelen', 300, 140, buildVaelen);
      ctx.drawImage(spr, x - 150, y - 70);
      for (i = 0; i < VAELEN_LIGHTS.length; i++) {
        var L = VAELEN_LIGHTS[i];
        glow(ctx, x - 150 + L[0], y - 70 + L[1], L[2], 6, 0.35 + 0.25 * Math.sin(t * 2.3 + i * 1.7));
      }
    } else if (kind === 'wreck') {
      spr = cached('station|wreck', 320, 150, buildWreckStation);
      ctx.drawImage(spr, x - 160, y - 75);
      for (i = 0; i < WRECK_LIGHTS.length; i++) {
        var W = WRECK_LIGHTS[i], f = wreckFlicker(i, 3, t);
        if ((t * 0.8 + i * 0.3) % 2 < 1.2) glow(ctx, x - 160 + W[0], y - 75 + W[1], PAL.alarmrot, 7, 0.6 * f);
      }
      var cyc = t % 2.4;
      if (cyc < 0.6) drawFx(ctx, 'sparks', x - 160 + 152, y - 75 + 66, cyc, { seed: 9 });
    } else {
      spr = cached('station|relay', 240, 240, buildRelay);
      ctx.drawImage(spr, x - 120, y - 120);
      var pr = 0.5 + 0.5 * Math.sin(t * 1.6);
      glow(ctx, x, y, PAL.mint, 30 + Math.round(pr * 10), 0.35 + 0.25 * pr);
      var n = 30, rr = 34;
      for (i = 0; i < n; i++) {
        var a = -t * 0.6 + i / n * Math.PI * 2;
        ctx.fillStyle = i % 5 === 0 ? '#E8FFF8' : PAL.mint;
        if (i % 2 === 0) ctx.fillRect(Math.round(x + Math.cos(a) * rr), Math.round(y + Math.sin(a) * rr), 1, 1);
      }
      for (i = 0; i < 6; i++) {   // Spitzen leuchten der Reihe nach
        var sa = i / 6 * Math.PI * 2 - Math.PI / 2, ph = (t * 0.7 - i / 6) % 1;
        if (ph < 0) ph += 1;
        glow(ctx, x + Math.cos(sa) * 100, y + Math.sin(sa) * 100, PAL.eisblau, 12, ph < 0.25 ? (1 - ph / 0.25) * 0.8 : 0.1);
      }
    }
  }

  // --- Phasenstrahl: zwei versetzte Strahlen, Bernstein-Weiß ------------------------------------
  function drawPhaseBeam(ctx, x1, y1, x2, y2, a, L) {
    var ang = Math.atan2(y2 - y1, x2 - x1);
    var op = ctx.globalCompositeOperation, ga = ctx.globalAlpha;
    ctx.save();
    ctx.translate(x1, y1); ctx.rotate(ang);
    ctx.globalCompositeOperation = 'lighter';
    for (var s = -1; s <= 1; s += 2) {
      var oy = s * 2.5, start = s > 0 ? 3 : 0;   // zweiter Strahl leicht versetzt
      ctx.globalAlpha = ga * a * 0.3; ctx.fillStyle = PAL.bernstein; ctx.fillRect(start, oy - 2, L - start, 4);
      ctx.globalAlpha = ga * a * 0.9; ctx.fillRect(start, oy - 1, L - start, 2);
      ctx.globalAlpha = ga * a; ctx.fillStyle = '#FFF7E0'; ctx.fillRect(start, Math.round(oy), L - start, 1);
    }
    // Phasenknoten entlang des Strahls
    ctx.globalAlpha = ga * a; ctx.fillStyle = '#FFFFFF';
    for (var k = 8; k < L; k += 14) ctx.fillRect(k, -3, 1, 6);
    ctx.restore();
    ctx.globalCompositeOperation = op; ctx.globalAlpha = ga;
    glow(ctx, x2, y2, PAL.bernstein, 12, a);
    glow(ctx, x2, y2, '#FFFFFF', 5, a * 0.7);
    glow(ctx, x1, y1, PAL.bernstein, 7, a * 0.8);
  }

  // --- Nebel, Raumlicht, Wrack-Stimmung ---------------------------------------------------------
  function fogLayer(idx) {
    return cached('fog|' + idx, 256, 256, function (g) {
      var r = rng(900 + idx * 77);
      var cols = idx ? ['#6A6680', '#5A5570', '#7A7490'] : ['#3A3650', '#4A4660', '#2A2350'];
      for (var i = 0; i < (idx ? 9 : 12); i++) {
        var x = r() * 256, y = r() * 256, rad = 40 + r() * 70, col = cols[i % cols.length], a = (idx ? 0.12 : 0.28) + r() * 0.15;
        for (var ox = -256; ox <= 256; ox += 256) for (var oy = -256; oy <= 256; oy += 256) {
          var gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
          gr.addColorStop(0, rgba(col, a)); gr.addColorStop(1, rgba(col, 0));
          g.fillStyle = gr; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
        }
      }
    });
  }
  function fogOverlay(ctx, w, h, t, k) {
    var ga = ctx.globalAlpha;
    ctx.fillStyle = 'rgba(70,66,92,' + (0.16 * k).toFixed(3) + ')'; ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = ga * 0.9 * k;
    tileLayer(ctx, fogLayer(1), t * 10, t * 3, 1, w, h, 256);
    ctx.globalAlpha = ga * 0.6 * k;
    tileLayer(ctx, fogLayer(0), -t * 6 + 90, t * 2 + 40, 1, w, h, 256);
    ctx.globalAlpha = ga * k;
    ctx.drawImage(vignette('#4A4660', 0.65), 0, 0, w, h);
    ctx.globalAlpha = ga;
  }
  var ROOM_LIGHT = { warm: ['#FFB870', 0.07, 0.22], mint: [PAL.mint, 0.08, 0.2], bernstein: [PAL.bernstein, 0.12, 0.3] };
  function roomLights(ctx, rooms, t) {
    var ga = ctx.globalAlpha, op = ctx.globalCompositeOperation;
    for (var i = 0; i < rooms.length; i++) {
      var r = rooms[i];
      if (!r) continue;
      var x0 = Math.min(r.x0, r.x1), y0 = Math.min(r.y0, r.y1), w = Math.abs(r.x1 - r.x0), h = Math.abs(r.y1 - r.y0);
      if (!(w > 0 && h > 0)) continue;
      if (r.light === 'aus') {
        ctx.fillStyle = 'rgba(11,14,26,0.5)'; ctx.fillRect(x0, y0, w, h);
        continue;
      }
      var L = ROOM_LIGHT[r.light] || ROOM_LIGHT.warm;
      ctx.fillStyle = rgba(L[0], L[1]); ctx.fillRect(x0, y0, w, h);
      // Lichtinsel (gecachter Glow, gestreckt auf den Raum)
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = ga * L[2] * (0.94 + 0.06 * Math.sin(t * 1.3 + i));
      ctx.drawImage(glowSprite(L[0], 64), x0 - w * 0.1, y0 - h * 0.15, w * 1.2, h * 1.2);
      ctx.globalAlpha = ga; ctx.globalCompositeOperation = op;
    }
  }
  function wreckOverlay(ctx, w, h, t) {
    var f = wreckFlicker(7, 7, t);
    ctx.fillStyle = 'rgba(6,8,14,0.16)'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(224,71,60,' + (0.025 + 0.035 * f).toFixed(3) + ')'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(vignette('#05060A', 0.55), 0, 0, w, h);
  }

  // --- Icons M1 ---------------------------------------------------------------------------------
  var PIN_BASE_TAIL = ['..######..', '...####...', '....##....', '....##....'];
  Object.assign(ICONS, {
    marker: ['....##....', '...####...', '..##++##..', '.##+..+##.', '##+.ww.+##', '##+.ww.+##', '.##+..+##.', '..##++##..', '...####...', '....##....'],
    scan: ['..####....', '.#++++#...', '#+o..o+#..', '#+.ww.+#..', '#+.ww.+#..', '#+o..o+#..', '.#++++#...', '..####.#..', '.......##.', '........##'],
    widescan: ['..######..', '.#......#.', '#..####..#', '#.#....#.#', '#.#.ww.#.#', '#.#.ww.#.#', '#.#....#.#', '#..####..#', '.#......#.', '..######..'],
    overload: ['.....###..', '....###...', '...###....', '..###.....', '.#######..', '..#####...', '....###...', '...###....', '..##......', '.#........'],
    loc_port: ['...####...', '.##....##.', '.#..##..#.', '#..#++#..#', '#.#+ww+#.#', '#.#+ww+#.#', '#..#++#..#', '.#..##..#.', '.##....##.', '...####...'],
    loc_asteroids: ['..........', '.###......', '#+++#.....', '#+o+#..##.', '.###..#++#', '......#+o#', '..##...##.', '.#++#.....', '.#o+#.....', '..##......'],
    loc_buoy: ['#..####..#', '.#......#.', '#..#..#..#', '...#++#...', '...#ww#...', '..######..', '..#++++#..', '...####...', '....##....', '...####...'],
    loc_trader: ['..........', '.##....##.', '#++#..#++#', '#++####++#', '#oo#..#oo#', '.##....##.', '....##....', '...#++#...', '...#oo#...', '....##....'],
    loc_wreck: ['..........', '.####.....', '#++++#.#..', '#+oo+.#+##', '#++++..#+#', '.####.#oo#', '......#++#', '.......##.', '..#.......', '.#..#.....'],
    loc_nebula: ['..........', '...###....', '..#+++#...', '.#++++####', '#++++++++#', '#+++++++o#', '.#oooooo#.', '..######..', '..........', '..........'],
    loc_relay: ['....##....', '...#++#...', '...#+w#...', '..#++w+#..', '..#+w++#..', '.#++w++o#.', '.#+w+++o#.', '..#+++o#..', '...#++#...', '.########.'],
    loc_unknown: ['...####...', '..#++++#..', '.#+#..#+#.', '.....#+#..', '....#+#...', '....#+#...', '.....#....', '....###...', '....#+#...', '....###...'],
    pin_ziel: ['..######..', '.###oo###.', '##o####o##', '##o#oo#o##', '##o####o##', '.###oo###.'].concat(PIN_BASE_TAIL),
    pin_gefahr: ['..######..', '.###oo###.', '####oo####', '####oo####', '##########', '.###oo###.'].concat(PIN_BASE_TAIL),
    pin_landeplatz: ['..######..', '.##o##o##.', '###o##o###', '###oooo###', '###o##o###', '.##o##o##.'].concat(PIN_BASE_TAIL),
    pin_treffpunkt: ['..######..', '.###oo###.', '##########', '##oo##oo##', '##oo##oo##', '.########.'].concat(PIN_BASE_TAIL),
    pin_frage: ['..######..', '.##ooo###.', '#####oo###', '####oo####', '##########', '.###oo###.'].concat(PIN_BASE_TAIL),
  });
  Object.assign(ICON_COLORS, {
    marker: PAL.mint, scan: PAL.mint, widescan: PAL.eisblau, overload: PAL.warngelb,
    loc_port: PAL.messing, loc_asteroids: PAL.rostsand, loc_buoy: PAL.mint, loc_trader: PAL.eisblau, loc_wreck: PAL.rostsand,
    loc_nebula: '#9A90C8', loc_relay: PAL.eisblau, loc_unknown: PAL.bernstein,
    pin_ziel: PAL.bernstein, pin_gefahr: PAL.alarmrot, pin_landeplatz: PAL.mint, pin_treffpunkt: PAL.eisblau, pin_frage: PAL.sternweiss,
  });

  // =============================================================================================
  // M2 „Schildwall“: Mond Kesh (Kustoden-Ruine), Kampf v2. CONTRACT-M2 §10
  // Farbregeln: Schild-Cyan nur für Schilde, Leuchtrot nur für feindliches Zielen/Feuer,
  // Violett nur für Vorläufer-(Kustoden-)Technik.
  // =============================================================================================
  var VIO = '#B57CFF', VIO_D = '#5A3E86', VIO_L = '#E8D8FF', SHIELD = '#7FF3FF';
  var KS = {
    sand: '#8C806A', sandL: '#A3967D', sandD: '#766A57', sandDD: '#62584A',
    flag: '#524D5C', flagL: '#625D6E', flagD: '#45404F', seam: '#35313F',
    rockCap: '#332C29', rockCapL: '#3F3632', rockCapD: '#27211E', rockFace: '#2B2421', rockFaceL: '#463B34', rockFaceD: '#1C1715', rockRim: '#6A5A4C',
    wallCap: '#3E3748', wallCapL: '#4C4458', wallCapD: '#2E2838', wallFace: '#665A6C', wallFaceL: '#7C7082', mortar: '#2E2834', wallRim: '#A096AC',
    stone: '#A89C8A', stoneL: '#C4B8A4', stoneD: '#857A6C', stoneFace: '#6C6272', stoneFaceD: '#4F4758', edge: '#F4EAD2',
    basalt: '#5A5068', basaltL: '#7A7088', basaltFace: '#40384E',
  };
  var KESH_OBJ_CH = { o: 1, I: 1, r: 1, k: 1, G: 1, T: 1 };
  function isKeshEnv(env) { return !!env && (env.biome === 'kesh' || !!(env.map && env.map.id === 'kesh')); }
  function keshTallCh(c) { return c === 'R' || c === '#' || c === ' ' || c === undefined || c === null || c === ''; }
  function keshFaceBelow(c) { return !keshTallCh(c) && c !== 'r' && c !== 'G'; }
  function keshOpenCh(c) { return !keshTallCh(c) && c !== 'r' && c !== 'G'; }
  function shadowBehind(c, fn) {   // Bodenschatten hinter bereits gezeichnetes Objekt legen
    var g = c.g;
    g.globalCompositeOperation = 'destination-over';
    fn(g);
    g.globalCompositeOperation = 'source-over';
  }

  // --- Kacheln --------------------------------------------------------------------------------
  function keshSandSprite(v) {
    return cached('kesh|sand|' + v, 32, 32, function (g) {
      var r = rng(8100 + v * 13);
      R(g, 0, 0, 32, 32, KS.sand);
      for (var i = 0; i < 46; i++) P(g, r() * 32, r() * 32, r() < 0.5 ? KS.sandL : KS.sandD);
      // Windrippel
      for (var k = 0; k < 3; k++) {
        var y = 4 + k * 10 + (r() * 4 | 0), x = r() * 20 | 0, L = 7 + (r() * 9 | 0);
        for (var q = 0; q < L; q++) { var yy = y + Math.round(Math.sin((x + q) * 0.5) * 1); P(g, x + q, yy, KS.sandL); P(g, x + q, yy + 1, KS.sandD); }
      }
      if (v === 5 || v === 2) {   // Kiesel
        var px = 6 + (r() * 18 | 0), py = 6 + (r() * 18 | 0);
        ell(g, px + 0.5, py + 1.5, 2.6, 1.6, KS.sandDD); ell(g, px, py, 2.2, 1.6, KS.stoneD); P(g, px - 1, py - 1, KS.stoneL);
      }
      if (v === 7) { ell(g, 16, 17, 7, 3.5, KS.sandD); ell(g, 16, 16, 6, 2.6, '#7E725E'); R(g, 11, 14, 8, 1, KS.sandL); }   // kleiner Krater
    });
  }
  function keshRuinSprite(v) {
    return cached('kesh|ruin|' + v, 32, 32, function (g) {
      var r = rng(8300 + v * 17);
      R(g, 0, 0, 32, 32, KS.seam);
      for (var row = 0; row < 2; row++) {
        var off = (row + v) % 2 ? 8 : 0;
        for (var col = -1; col < 2; col++) {
          var x = col * 16 + off, y = row * 16, w = 15, h = 15;
          var tone = r() < 0.3 ? shade(KS.flag, -0.06) : r() < 0.25 ? shade(KS.flag, 0.05) : KS.flag;
          R(g, x, y, w, h, tone);
          R(g, x, y, w, 1, KS.flagL); R(g, x, y, 1, h, KS.flagL);
          R(g, x, y + h - 1, w, 1, KS.flagD); R(g, x + w - 1, y, 1, h, KS.flagD);
          for (var s = 0; s < 4; s++) P(g, x + 2 + r() * 11, y + 2 + r() * 11, r() < 0.5 ? KS.flagD : KS.flagL);
        }
      }
      if (v === 1) { line(g, 3, 20, 9, 26, KS.seam); line(g, 9, 26, 12, 25, KS.seam); }           // Riss
      if (v === 3) {   // eingelassene Kustoden-Leitlinie (Vorläufer, gedämpft)
        R(g, 5, 23, 22, 1, mix(KS.flag, VIO, 0.35)); R(g, 15, 20, 2, 7, mix(KS.flag, VIO, 0.35)); P(g, 16, 23, mix(KS.flag, VIO, 0.75));
      }
      if (v === 5) {   // geschnitzte Rosette (Kustoden-Ornament)
        ell(g, 8, 8, 4, 4, KS.flagD); ell(g, 8, 8, 3, 3, KS.flag); P(g, 8, 5, KS.flagD); P(g, 8, 11, KS.flagD); P(g, 5, 8, KS.flagD); P(g, 11, 8, KS.flagD); P(g, 8, 8, KS.flagL);
      }
      if (v === 6) { ell(g, 24, 26, 9, 4, KS.sandD); ell(g, 24, 25, 8, 3, KS.sand); P(g, 21, 24, KS.sandL); P(g, 27, 25, KS.sandL); }   // Sandverwehung
    });
  }
  function buildKeshWall(g, rock, k) {
    var capH = k.face ? CAP_H : 32, i, x;
    var r = rng((rock ? 7100 : 7300) + k.v * 31 + (k.face ? 7 : 0));
    if (rock) {
      R(g, 0, 0, 32, capH, KS.rockCap);
      for (i = 0; i < 6; i++) {
        var bx = r() * 26 | 0, by = r() * Math.max(1, capH - 4) | 0, bw = 4 + (r() * 6 | 0), bh = Math.min(3 + (r() * 3 | 0), capH - by);
        R(g, bx, by, bw, bh, KS.rockCapL); R(g, bx + 1, by + bh - 1, bw, 1, KS.rockCapD);
      }
      for (i = 0; i < 5; i++) P(g, r() * 32, r() * capH, KS.rockCapD);
      if (k.oN) { for (x = 0; x < 32; x++) { P(g, x, 0, KS.rockRim); if (r() < 0.3) P(g, x, 1, shade(KS.rockRim, -0.25)); } }
      if (k.oW) { for (i = 0; i < capH; i++) { P(g, 0, i, KS.rockRim); if (r() < 0.3) P(g, 1, i, shade(KS.rockRim, -0.25)); } }
      if (k.oE) R(g, 31, 0, 1, capH, shade(KS.rockRim, -0.45));
      if (!k.face && k.oS) R(g, 0, 31, 32, 1, KS.rockFaceD);
      if (k.face) {
        R(g, 0, capH, 32, 32 - capH, KS.rockFace);
        for (x = 0; x < 32; x++) {   // gezackte Oberkante der Felsfront
          var jag = r() < 0.35 ? 1 : 0;
          P(g, x, capH - 1 + jag, KS.rockRim);
          if (jag) P(g, x, capH - 1, KS.rockCap);
        }
        for (i = 0; i < 5; i++) { var fx = r() * 26 | 0, fy = capH + 2 + (r() * 14 | 0); R(g, fx, fy, 3 + (r() * 6 | 0), 2, KS.rockFaceL); R(g, fx + 1, fy + 2, 3 + (r() * 4 | 0), 1, KS.rockFaceD); }
        R(g, 0, capH + 7, 32, 1, KS.rockFaceD); R(g, 0, capH + 13, 32, 1, KS.rockFaceD);
        R(g, 0, 30, 32, 2, KS.rockFaceD);
        if (k.v % 2 === 0) { ell(g, 8 + k.v * 4, 31, 7, 2, KS.sandD); ell(g, 8 + k.v * 4, 31, 6, 1.4, KS.sand); }   // Sand am Fuß
      }
      return;
    }
    // Ruinenmauer: Quader von oben (Kappe), Front mit zwei Steinlagen
    R(g, 0, 0, 32, capH, KS.wallCapD);
    var slabs = capH >= 32 ? [[0, 0, 15, 15], [16, 0, 16, 15], [0, 16, 20, 16], [21, 16, 11, 16]] : [[0, 0, 13 + k.v * 2, capH], [14 + k.v * 2, 0, 18 - k.v * 2, capH]];
    slabs.forEach(function (s) {
      R(g, s[0], s[1], s[2] - 1, s[3] - 1, KS.wallCap);
      R(g, s[0], s[1], s[2] - 1, 1, KS.wallCapL); R(g, s[0], s[1], 1, s[3] - 1, KS.wallCapL);
    });
    if (k.oN) R(g, 0, 0, 32, 1, KS.wallRim);
    if (k.oW) R(g, 0, 0, 1, capH, KS.wallRim);
    if (k.oE) R(g, 31, 0, 1, capH, shade(KS.wallRim, -0.35));
    if (!k.face && k.oS) { R(g, 0, 31, 32, 1, KS.mortar); R(g, 0, 30, 32, 1, shade(KS.wallRim, -0.3)); }
    if (k.face) {
      R(g, 0, capH - 1, 32, 1, KS.wallRim);   // vordere Kappenkante im Licht
      var y0 = capH;
      R(g, 0, y0, 32, 32 - y0, KS.wallFace);
      // zwei Steinlagen
      var c1 = (4 + k.v * 5) % 16, c2 = (c1 + 8) % 16;
      R(g, 0, y0, 32, 1, KS.wallFaceL); R(g, 0, y0 + 9, 32, 1, KS.mortar); R(g, 0, y0 + 10, 32, 1, KS.wallFaceL);
      for (x = c1; x < 32; x += 16) { R(g, x, y0, 1, 9, KS.mortar); P(g, x + 1, y0 + 1, KS.wallFaceL); }
      for (x = c2; x < 32; x += 16) { R(g, x, y0 + 10, 1, 8, KS.mortar); }
      R(g, 0, 29, 32, 1, KS.mortar); R(g, 0, 30, 32, 2, '#1E1A24');
      if (k.v === 0) {   // Vorläufer-Glyphe: geflügelte Scheibe, violett eingelegt
        var cx = 16;
        R(g, cx - 6, y0 + 4, 4, 1, VIO_D); R(g, cx + 3, y0 + 4, 4, 1, VIO_D); R(g, cx - 5, y0 + 5, 3, 1, VIO_D); R(g, cx + 3, y0 + 5, 3, 1, VIO_D);
        R(g, cx - 1, y0 + 3, 3, 3, VIO_D); P(g, cx, y0 + 4, VIO);
      } else if (k.v === 1) {   // Kustoden-Rosettenfries
        for (x = 3; x < 32; x += 8) { R(g, x, y0 + 3, 3, 3, '#857A6C'); P(g, x + 1, y0 + 4, '#B4A88E'); P(g, x + 1, y0 + 2, KS.mortar); }
      } else if (k.v === 2) {   // Riss
        line(g, 20, y0 + 1, 17, y0 + 8, KS.mortar); line(g, 17, y0 + 11, 19, y0 + 16, KS.mortar);
      }
      if (k.v !== 1) { ell(g, 25 - k.v * 5, 31, 6, 1.6, KS.sandD); }   // Sand am Fuß
    }
  }
  function keshWallSprite(env, tx, ty, rock) {
    var at = function (dx, dy) { return envAt(env, tx + dx, ty + dy); };
    var k = {
      oN: keshOpenCh(at(0, -1)), oS: keshOpenCh(at(0, 1)), oE: keshOpenCh(at(1, 0)), oW: keshOpenCh(at(-1, 0)),
      face: keshFaceBelow(at(0, 1)), v: (hash2(tx, ty, 23) * 4) | 0,
    };
    var key = 'kesh|wall|' + (rock ? 'R' : 'W') + '|' + (+k.oN) + (+k.oS) + (+k.oE) + (+k.oW) + (+k.face) + '|' + k.v;
    return cached(key, 32, 32, function (g) { buildKeshWall(g, rock, k); });
  }
  function keshSandAround(env, tx, ty) {
    var s = 0, n = 0, d = [[0, 1], [-1, 0], [1, 0], [0, -1]];
    for (var i = 0; i < 4; i++) { var c = envAt(env, tx + d[i][0], ty + d[i][1]); if (c === '.' || c === 'P') s++; else if (c === ',' || c === 'a' || c === 'b' || c === 'c' || c === 'L') n++; }
    return s > n;
  }
  function drawTileKesh(ctx, ch, px, py, env) {
    if (ch === ' ' || ch === undefined || ch === null || ch === '') return;
    var tx = env.tx | 0, ty = env.ty | 0, time = env.time || 0;
    if (ch === 'R' || ch === '#') { ctx.drawImage(keshWallSprite(env, tx, ty, ch === 'R'), px, py); return; }
    var sand = ch === '.' || ch === 'P';
    if (KESH_OBJ_CH[ch]) sand = keshSandAround(env, tx, ty);   // Objektzeichen: nur passender Boden (Objekt via drawObject)
    var hv = (hash2(tx, ty, 41) * 24) | 0;
    var v = sand ? hv % 8 : (hv < 8 ? hv : (hv & 1 ? 0 : 2));   // Ruinenboden: Verzierungen selten
    ctx.drawImage(sand ? keshSandSprite(v) : keshRuinSprite(v), px, py);
    if (keshTallCh(envAt(env, tx, ty - 1))) {   // Schlagschatten der Mauer/des Felsens darüber (Höhe lesbar)
      ctx.fillStyle = 'rgba(11,10,18,0.42)'; ctx.fillRect(px, py, 32, 4);
      ctx.fillStyle = 'rgba(11,10,18,0.22)'; ctx.fillRect(px, py + 4, 32, 4);
    }
    if (keshTallCh(envAt(env, tx - 1, ty))) { ctx.fillStyle = 'rgba(11,10,18,0.22)'; ctx.fillRect(px, py, 3, 32); }
    if (ch === 'P') ctx.drawImage(padSprite(frameOf(time, 6, 8), 1), px, py);
  }

  // --- Objekte (32 breit; Kachel beginnt bei Sprite-y = Überstand) -----------------------------
  function buildCoverLow(g, c, l, r, v) {
    var T = 16, x0 = l ? 0 : 2, x1 = r ? 32 : 30, w = x1 - x0, rr = rng(8500 + v * 7 + (l ? 3 : 0) + (r ? 5 : 0)), x;
    var topY = T + 9, frontY = T + 18, faceB = T + 27;
    R(g, x0, topY, w, frontY - topY, KS.stone);
    R(g, x0, topY, w, 1, KS.stoneL);
    for (x = x0 + 4 + v * 3; x < x1 - 2; x += 11) { R(g, x, topY + 1, 1, frontY - topY - 1, KS.stoneD); }   // Fugen oben
    for (var s = 0; s < 6; s++) P(g, x0 + 1 + rr() * (w - 2), topY + 2 + rr() * 6, rr() < 0.5 ? KS.stoneD : KS.stoneL);
    R(g, x0, frontY, w, 1, KS.edge);                                  // helle Oberkante (Vorderkante)
    R(g, x0, frontY + 1, w, faceB - frontY, KS.stoneFace);            // niedrige Front
    R(g, x0, frontY + 1, w, 1, shade(KS.stoneFace, 0.15));
    R(g, x0, frontY + 5, w, 1, KS.stoneFaceD);
    for (x = x0 + 7 + v * 2; x < x1 - 1; x += 12) { R(g, x, frontY + 1, 1, 4, KS.stoneFaceD); R(g, x + 6, frontY + 6, 1, faceB - frontY - 6, KS.stoneFaceD); }
    R(g, x0, faceB, w, 1, KS.stoneFaceD);
    if (v === 1) { for (x = x0 + 3; x < x1 - 2; x += 4) { P(g, x, frontY + 3, KS.stoneFaceD); P(g, x + 1, frontY + 2, KS.stoneFaceD); } }   // Zickzack-Fries
    // ausgebrochene Kanten (Mauerreste): Kerben in der Oberseite, schräge Enden
    for (var n = 0; n < 2; n++) { var nx = x0 + 3 + (rr() * (w - 8) | 0); g.clearRect(nx, topY, 2 + (rr() * 3 | 0), 1 + (rr() < 0.5 ? 1 : 0)); }
    if (!l) { g.clearRect(x0, topY, 2, 2); P(g, x0, topY + 2, KS.stoneL); R(g, x0, frontY + 1, 1, faceB - frontY, KS.stoneFaceD); }
    if (!r) { g.clearRect(x1 - 2, topY, 2, 3); R(g, x1 - 1, frontY + 1, 1, faceB - frontY, KS.stoneFaceD); }
    // Sand am Fuß
    for (x = x0; x < x1; x++) if (rr() < 0.35) P(g, x, faceB, KS.sandD);
    outline(c, '#1E1A20');
    shadowBehind(c, function (g2) { R(g2, l ? 0 : 2, faceB + 1, (r ? 32 : 30) - (l ? 0 : 2), 3, 'rgba(11,14,26,0.4)'); });
  }
  function buildPillar(g, c) {   // 32×64, Kachel ab Sprite-y 32
    var T = 32;
    // Sockel
    R(g, 4, T + 18, 24, 3, KS.stone); R(g, 4, T + 18, 24, 1, KS.stoneL); R(g, 4, T + 21, 24, 1, KS.edge);
    R(g, 4, T + 22, 24, 6, KS.stoneFace); R(g, 4, T + 27, 24, 1, KS.stoneFaceD);
    // Schaft (kanneliert)
    var top = 20, bot = T + 18;
    R(g, 9, top, 14, bot - top, '#7E7488');
    R(g, 9, top, 2, bot - top, '#9C92A8'); R(g, 21, top, 2, bot - top, '#544C60');
    for (var fx = 12; fx < 21; fx += 3) { R(g, fx, top, 1, bot - top, '#686076'); P(g, fx + 1, top + 2, '#8E84A0'); }
    // Vorläufer-Band (violett eingelegt)
    R(g, 9, top + 14, 14, 4, '#3A2E50'); R(g, 9, top + 15, 14, 2, VIO_D); R(g, 11, top + 15, 10, 1, VIO); P(g, 16, top + 16, VIO_L);
    // Kapitell mit Voluten
    R(g, 5, 12, 22, 4, KS.stone); R(g, 5, 12, 22, 1, KS.stoneL); R(g, 5, 16, 22, 1, KS.edge);
    R(g, 5, 17, 22, 3, KS.stoneFace); R(g, 6, 19, 20, 1, KS.stoneFaceD);
    ell(g, 6, 18, 2, 2, KS.stoneFaceD); ell(g, 25, 18, 2, 2, KS.stoneFaceD); P(g, 6, 18, KS.stoneL); P(g, 25, 18, KS.stoneL);
    outline(c, '#1E1A20');
    shadowBehind(c, function (g2) { ell(g2, 17, T + 28, 14, 3.5, 'rgba(11,14,26,0.42)'); });
  }
  function buildJammer(g, c, on) {   // 32×56, Kachel ab Sprite-y 24 – Plünderer-Technik (Rost, Warngelb)
    var T = 24, rust = on ? '#9A5A34' : '#5E4234', rustL = on ? '#C27A48' : '#74584A', rustD = on ? '#6A3A20' : '#3E2C24', steel = on ? '#6B7380' : '#4A4E56';
    line(g, 16, T + 14, 5, T + 28, steel); line(g, 16, T + 14, 27, T + 28, steel); line(g, 16, T + 14, 16, T + 29, shade(steel, -0.3));
    R(g, 7, T + 4, 18, 14, rust); R(g, 7, T + 4, 18, 2, rustL); R(g, 7, T + 17, 18, 1, rustD); R(g, 24, T + 5, 1, 12, rustD);
    R(g, 9, T + 8, 9, 6, '#2A2226');
    for (var yy = T + 9; yy < T + 14; yy += 2) R(g, 10, yy, 7, 1, on ? '#4A3A30' : '#332A28');
    for (var sx = 7; sx < 25; sx += 4) { R(g, sx, T + 15, 2, 2, on ? PAL.warngelb : '#7A6A3A'); R(g, sx + 2, T + 15, 2, 2, '#2A2226'); }
    R(g, 20, T + 8, 3, 2, on ? '#E0A030' : '#4A4038');   // Schalter
    // Mast + Schüssel
    R(g, 15, 6, 2, T + 4 - 6, steel); R(g, 15, 6, 1, T - 2, shade(steel, 0.35));
    R(g, 11, 14, 10, 1, steel);
    poly(g, [6, 9, 12, 5, 13, 13, 8, 15], on ? '#8A929E' : '#5A5E66'); poly(g, [7, 10, 11, 7, 12, 12, 9, 13], on ? '#B8C0CA' : '#6E727A'); P(g, 10, 10, '#2A2226');
    R(g, 13, 1, 6, 5, '#2A2226'); R(g, 14, 2, 4, 3, on ? PAL.warngelb : '#3A3F47');
    // Kabel zum Boden
    line(g, 7, T + 12, 3, T + 22, '#2A2226'); line(g, 3, T + 22, 2, T + 28, '#2A2226');
    if (!on) { line(g, 24, T + 6, 28, T + 3, '#2A2226'); P(g, 28, T + 3, '#7A6A3A'); }   // abgerissenes Kabel
    outline(c, PAL.outlineRust);
    shadowBehind(c, function (g2) { ell(g2, 16, T + 28, 13, 3, 'rgba(11,14,26,0.4)'); });
  }
  function buildArchKey(g, c, lv) {   // 32×48, lv 0..4 Leuchtstufe des Kristalls
    var T = 16, k = lv / 4;
    R(g, 3, T + 12, 26, 8, KS.basalt); R(g, 3, T + 12, 26, 1, KS.basaltL);
    R(g, 3, T + 19, 26, 1, KS.edge);                                   // helle Oberkante wie alle niedrigen Deckungen
    R(g, 3, T + 20, 26, 7, KS.basaltFace); R(g, 3, T + 26, 26, 1, '#2C2638');
    g.clearRect(3, T + 12, 2, 1); g.clearRect(27, T + 12, 2, 1);
    // Rune auf der Front
    var rc = mix(VIO_D, VIO, k);
    R(g, 13, T + 22, 6, 1, rc); R(g, 15, T + 21, 2, 5, rc); P(g, 12, T + 23, rc); P(g, 19, T + 23, rc);
    // Fassung + Schlüsselkristall
    ell(g, 16, T + 15, 6, 2.5, '#2C2638'); ell(g, 16, T + 14.5, 5, 2, '#3E3450');
    var c0 = mix('#3A2A5A', VIO, k), c1 = mix(VIO_D, VIO_L, k), c2 = mix('#2A1E42', VIO_D, k);
    poly(g, [16, T - 8, 21, T + 4, 16, T + 15, 11, T + 4], c0);
    poly(g, [16, T - 8, 16, T + 15, 11, T + 4], c1);
    poly(g, [16, T + 4, 21, T + 4, 16, T + 15], c2);
    P(g, 14, T - 2, k > 0.5 ? '#FFFFFF' : mix(VIO_L, VIO_D, 0.3));
    outline(c, '#17121F');
    shadowBehind(c, function (g2) { R(g2, 3, T + 27, 26, 3, 'rgba(11,14,26,0.4)'); });
  }
  function buildGate(g, c, half, open) {   // 32×48, half: L|R|S (einteilig)
    var T = 16, seamX = half === 'L' ? 31 : half === 'R' ? 0 : -1, outerX = half === 'L' ? 0 : half === 'R' ? 31 : -1;
    var metal = '#2E2A3C', metalL = '#443E58', metalD = '#1E1A28';
    if (!open) {
      // Sturz (Kappe) wie Mauer, Torflügel als Front
      R(g, 0, T, 32, CAP_H, KS.wallCapD); R(g, 0, T, 32, CAP_H - 1, KS.wallCap); R(g, 0, T, 32, 1, KS.wallCapL); R(g, 0, T + CAP_H - 1, 32, 1, KS.wallRim);
      R(g, 0, T + CAP_H, 32, 32 - CAP_H, metal);
      R(g, 0, T + CAP_H, 32, 1, metalL);
      for (var by = T + CAP_H + 5; by < T + 30; by += 6) { R(g, 0, by, 32, 1, metalD); R(g, 0, by + 1, 32, 1, metalL); }
      // Reliefrauten
      for (var rx = 4; rx < 30; rx += 9) { poly(g, [rx + 3, T + 15, rx + 6, T + 19, rx + 3, T + 23, rx, T + 19], '#3A3450'); P(g, rx + 3, T + 19, VIO_D); }
      if (seamX >= 0) { R(g, seamX, T + CAP_H, 1, 32 - CAP_H, VIO); R(g, seamX === 0 ? 1 : 30, T + CAP_H, 1, 32 - CAP_H, VIO_D); }
      R(g, 0, T + 30, 32, 2, '#16121E');
    } else {
      // offen: Pfosten außen, eingefahrener Flügel, Schwelle
      if (outerX >= 0) {
        var ox = half === 'L' ? 0 : 26;
        R(g, ox, T, 6, 32, KS.wallFace); R(g, ox, T, 6, 2, KS.wallRim); R(g, half === 'L' ? ox + 5 : ox, T, 1, 32, KS.mortar);
        R(g, half === 'L' ? 6 : 24, T + 2, 2, 28, metal); R(g, half === 'L' ? 6 : 25, T + 2, 1, 28, VIO_D);
      }
      for (var tx2 = 0; tx2 < 32; tx2 += 3) R(g, tx2, T + 29, 2, 1, VIO_D);
    }
    // Torbogen mit geflügelter Scheibe (Kustoden-Ornament), ragt über die Kachel
    R(g, 0, T - 9, 32, 9, KS.stoneFace); R(g, 0, T - 9, 32, 1, KS.stoneL); R(g, 0, T - 1, 32, 1, KS.stoneFaceD);
    var wingDir = half === 'L' ? -1 : 1, dcx = half === 'L' ? 32 : half === 'R' ? 0 : 16;
    for (var f = 0; f < 4; f++) {
      var len = 22 - f * 4, yy = T - 7 + f * 2;
      if (half === 'S') { R(g, dcx - len / 2 - 4, yy, len / 2, 1, KS.stone); R(g, dcx + 4, yy, len / 2, 1, KS.stone); }
      else R(g, wingDir < 0 ? dcx - 4 - len : dcx + 4, yy, len, 1, f % 2 ? KS.stoneD : KS.stone);
    }
    ell(g, dcx, T - 5, 4, 3.5, KS.stoneD); ell(g, dcx, T - 5, 2.6, 2.4, VIO_D); ell(g, dcx, T - 5, 1.4, 1.4, VIO);
    outline(c, '#17121F');
  }
  function buildPedestal(g, c, taken) {   // Tafelsockel 32×48
    var T = 16;
    R(g, 4, T + 11, 24, 8, KS.stone); R(g, 4, T + 11, 24, 1, KS.stoneL);
    R(g, 4, T + 19, 24, 1, KS.edge);
    R(g, 4, T + 20, 24, 7, KS.stoneFace); R(g, 4, T + 26, 24, 1, KS.stoneFaceD);
    for (var x = 6; x < 27; x += 5) R(g, x, T + 22, 3, 2, KS.stoneFaceD);   // Fries
    g.clearRect(4, T + 11, 1, 1); g.clearRect(27, T + 11, 1, 1);
    if (!taken) {
      // Keilschrift-Tafel (Lehm, Gold) auf kleinem Ständer
      R(g, 13, T + 12, 6, 3, KS.stoneD);
      R(g, 10, T - 3, 12, 16, '#6E3E22'); R(g, 11, T - 2, 10, 14, '#A86A42'); R(g, 11, T - 2, 10, 1, '#C88A5E'); R(g, 11, T - 2, 1, 14, '#C88A5E');
      for (var ry = 0; ry < 4; ry++) for (var cx = 0; cx < 3; cx++) {
        var wx = 12 + cx * 3 + (ry % 2), wy = T + ry * 3;
        P(g, wx, wy, '#F2C45A'); P(g, wx + 1, wy, '#D9A441'); P(g, wx, wy + 1, '#9A6A2A');
      }
    } else {
      for (var dx = 10; dx < 22; dx += 2) { P(g, dx, T + 12, KS.stoneL); P(g, dx, T + 17, KS.stoneL); }
      P(g, 10, T + 14, KS.stoneL); P(g, 21, T + 14, KS.stoneL); P(g, 10, T + 16, KS.stoneL); P(g, 21, T + 16, KS.stoneL);
    }
    outline(c, '#1E1A20');
    shadowBehind(c, function (g2) { R(g2, 4, T + 27, 24, 3, 'rgba(11,14,26,0.4)'); });
  }
  function drawObjectKesh(ctx, kind, px, py, o) {
    var t = o.time || 0, spr, i, a;
    px = Math.round(px); py = Math.round(py);
    switch (kind) {
      case 'cover_low': {
        var l = o.left ? 1 : 0, r = o.right ? 1 : 0, v = ((o.variant | 0) % 3 + 3) % 3;
        spr = cached('kesh|cover|' + l + r + '|' + v, 32, 48, function (g, c) { buildCoverLow(g, c, l, r, v); });
        ctx.drawImage(spr, px, py - 16);
        return true;
      }
      case 'pillar':
        spr = cached('kesh|pillar', 32, 64, buildPillar);
        ctx.drawImage(spr, px, py - 32);
        glow(ctx, px + 16, py - 32 + 36, VIO, 7, 0.25 + 0.12 * Math.sin(t * 2 + px * 0.05));
        return true;
      case 'jammer': {
        var on = !o.off;
        spr = cached('kesh|jammer|' + (+on), 32, 56, function (g, c) { buildJammer(g, c, on); });
        ctx.drawImage(spr, px, py - 24);
        if (on) {
          var bl = frameOf(t, 3, 2) === 0;
          glow(ctx, px + 16, py - 24 + 3, PAL.warngelb, 9, bl ? 0.85 : 0.25);
          // Störwellen (Ringe) aus der Antenne
          for (i = 0; i < 2; i++) {
            var p = (t * 0.9 + i * 0.5) % 1, rad = 5 + p * 18;
            ctx.fillStyle = rgba('#F0A040', 0.65 * (1 - p));
            for (a = 0; a < 14; a++) {
              var an = Math.PI * 1.05 + a / 13 * Math.PI * 0.9;
              ctx.fillRect(Math.round(px + 16 + Math.cos(an) * rad), Math.round(py - 21 + Math.sin(an) * rad * 0.8), 1, 1);
            }
          }
        } else if ((t * 0.7 + px * 0.01) % 2.4 < 0.5) drawFx(ctx, 'sparks', px + 28, py - 21, (t * 0.7) % 0.6, { small: true, seed: 3 });
        return true;
      }
      case 'archive_key': {
        var kt = Math.max(0, Math.min(1, +o.t || 0)), done = !!o.open;
        var lv = done ? 4 : Math.min(4, Math.floor(kt * 4 + 0.001));
        spr = cached('kesh|archkey|' + lv, 32, 48, function (g, c) { buildArchKey(g, c, lv); });
        ctx.drawImage(spr, px, py - 16);
        // Fortschrittsring: 8 Lichtpunkte um die Fassung
        var lit = done ? 8 : Math.floor(kt * 8 + 0.001);
        for (i = 0; i < 8; i++) {
          a = -Math.PI / 2 + i / 8 * Math.PI * 2;
          var qx = Math.round(px + 16 + Math.cos(a) * 11), qy = Math.round(py + 15 + Math.sin(a) * 4);
          ctx.fillStyle = i < lit ? VIO_L : '#2C2638'; ctx.fillRect(qx, qy, 2, 1);
          if (i < lit) { ctx.fillStyle = VIO; ctx.fillRect(qx, qy + 1, 2, 1); }
        }
        var pulse = 0.5 + 0.5 * Math.sin(t * (kt > 0 && !done ? 9 : 2));
        glow(ctx, px + 16, py + 4, VIO, done ? 16 : 8 + Math.round(kt * 6), done ? 0.6 : 0.18 + 0.5 * kt * (0.7 + 0.3 * pulse));
        return true;
      }
      case 'vault_gate': {
        var half = o.left && !o.right ? 'L' : o.right && !o.left ? 'R' : 'S', op = o.open ? 1 : 0;
        spr = cached('kesh|gate|' + half + '|' + op, 32, 48, function (g, c) { buildGate(g, c, half, !!op); });
        ctx.drawImage(spr, px, py - 16);
        var dcx = half === 'L' ? px + 32 : half === 'R' ? px : px + 16;
        if (half !== 'R') glow(ctx, dcx, py - 5, VIO, 8, op ? 0.55 : 0.3 + 0.15 * Math.sin(t * 2));
        if (!op && half !== 'S') glow(ctx, half === 'L' ? px + 31 : px, py + 22, VIO, 10, 0.25 + 0.2 * Math.sin(t * 2.4));
        return true;
      }
      case 'tablet_pedestal': {
        var tk = o.taken ? 1 : 0;
        spr = cached('kesh|pedestal|' + tk, 32, 48, function (g, c) { buildPedestal(g, c, !!tk); });
        ctx.drawImage(spr, px, py - 16);
        if (!tk) {
          glow(ctx, px + 16, py + 4, PAL.bernstein, 14, 0.28 + 0.14 * Math.sin(t * 3));
          var sp = (t * 1.3) % 1;   // Glitzern auf der Goldschrift
          if (sp < 0.3) { ctx.fillStyle = rgba('#FFF1B8', 1 - sp / 0.3); ctx.fillRect(px + 13 + ((Math.floor(t * 1.3) * 5) % 7), py + 1 + ((Math.floor(t * 1.3) * 3) % 9), 1, 1); }
        }
        return true;
      }
    }
    return false;
  }

  // --- Wächter „Lamassu“ (geflügelter Stier, ~2×2 Kacheln) --------------------------------------
  var WARDEN_PAL = {
    awake: { body: '#7C7090', light: '#9E92B0', dark: '#564C68', deep: '#3C344C', wing: '#6E6284', wingL: '#9488A8', wingE: '#BCB2CC', beard: '#4A405C', beardL: '#6A6080',
      crown: '#B8873E', crownL: '#E3B565', crownD: '#7A5A28', hoof: '#2E2838', rune: VIO, runeD: VIO_D, face: '#A89CB8' },
    asleep: { body: '#443C52', light: '#544A64', dark: '#332C40', deep: '#262030', wing: '#3E3650', wingL: '#4C4460', wingE: '#5E5672', beard: '#2C2638', beardL: '#3A3248',
      crown: '#5E4A2E', crownL: '#7A6440', crownD: '#3E3020', hoof: '#1E1A26', rune: '#4A3A66', runeD: '#3A2E52', face: '#564C64' },
  };
  function featherWing(g, C, pts, rows) {   // Flügel: Grundfläche + Federreihen (assyrisch, waagerecht gebändert)
    poly(g, pts, C.wing);
    var minY = 1e9, maxY = -1e9, i;
    for (i = 1; i < pts.length; i += 2) { minY = Math.min(minY, pts[i]); maxY = Math.max(maxY, pts[i]); }
    var tmp = mk(76, 64);
    poly(tmp.g, pts, '#000');
    var d = tmp.g.getImageData(0, 0, 76, 64).data;
    for (var y = Math.ceil(minY); y <= maxY; y++) {
      var band = Math.floor((y - minY) / rows) % 2;
      for (var x = 0; x < 76; x++) {
        if (d[(y * 76 + x) * 4 + 3] < 128) continue;
        if ((y - minY) % rows === 0) P(g, x, y, C.wingE);
        else if (band && ((x + y) % 3 === 0)) P(g, x, y, C.wingL);
      }
    }
  }
  function beardRows(g, C, x0, y0, w, h) {
    R(g, x0, y0, w, h, C.beard);
    for (var y = y0 + 1; y < y0 + h; y += 2) for (var x = x0 + ((y >> 1) & 1); x < x0 + w; x += 2) P(g, x, y, C.beardL);
  }
  function buildWarden(g, c, view, C) {   // 76×64, Füße bei y≈60
    if (view === 'side') {
      featherWing(g, C, [44, 30, 50, 22, 44, 12, 30, 5, 14, 2, 4, 4, 10, 10, 22, 16, 30, 24, 34, 30], 3);
      line(g, 12, 32, 6, 42, C.dark); ell(g, 6, 43, 2, 3, C.beard);                 // Schwanz
      R(g, 20, 42, 6, 15, C.deep); R(g, 50, 42, 6, 15, C.deep);                         // ferne Beine
      ell(g, 36, 37, 25, 12, C.dark); ell(g, 36, 35, 24, 10, C.body); ell(g, 33, 31, 18, 4, C.light);
      ell(g, 56, 35, 8, 10, C.body); ell(g, 55, 32, 5, 4, C.light);
      R(g, 14, 42, 7, 15, C.body); R(g, 14, 42, 2, 15, C.light); R(g, 55, 42, 7, 15, C.body); R(g, 55, 42, 2, 15, C.light);
      R(g, 13, 56, 9, 4, C.hoof); R(g, 54, 56, 9, 4, C.hoof); R(g, 19, 56, 8, 4, C.hoof); R(g, 49, 56, 8, 4, C.hoof);
      for (var lx = 0; lx < 3; lx++) { P(g, 16 + lx * 2, 47, C.dark); P(g, 57 + lx * 2, 47, C.dark); }      // Fesselbänder
      beardRows(g, C, 57, 21, 9, 15); g.clearRect(65, 34, 1, 2);
      R(g, 58, 10, 9, 12, C.face); R(g, 58, 10, 2, 12, C.light);
      R(g, 67, 14, 2, 3, C.face); P(g, 67, 17, C.dark);                                // Nase
      R(g, 62, 13, 3, 2, C.deep);                                                       // Augenhöhle
      R(g, 58, 13, 2, 5, C.beard);                                                      // Haar/Ohr
      R(g, 57, 1, 11, 10, C.crown); R(g, 57, 1, 11, 1, C.crownL); R(g, 57, 4, 11, 1, C.crownD); R(g, 57, 7, 11, 1, C.crownD);
      for (var hx = 58; hx < 68; hx += 3) P(g, hx, 0, C.crownL);
      P(g, 66, 5, C.crownL); P(g, 66, 8, C.crownL);                                     // Hörner am Kronenrand
      // Runen auf der Flanke
      R(g, 30, 36, 9, 1, C.runeD); R(g, 34, 33, 1, 7, C.runeD); P(g, 34, 36, C.rune); P(g, 30, 36, C.rune); P(g, 38, 36, C.rune);
    } else if (view === 'front') {
      featherWing(g, C, [30, 28, 24, 18, 14, 8, 4, 3, 2, 8, 8, 16, 16, 24, 26, 34], 3);
      featherWing(g, C, [46, 28, 52, 18, 62, 8, 72, 3, 74, 8, 68, 16, 60, 24, 50, 34], 3);
      ell(g, 38, 40, 17, 10, C.dark); ell(g, 38, 38, 16, 9, C.body);
      R(g, 27, 42, 8, 15, C.body); R(g, 27, 42, 2, 15, C.light); R(g, 41, 42, 8, 15, C.body); R(g, 47, 42, 2, 15, C.dark);
      R(g, 26, 56, 10, 4, C.hoof); R(g, 40, 56, 10, 4, C.hoof);
      ell(g, 38, 34, 13, 9, C.body); ell(g, 36, 32, 8, 5, C.light);
      beardRows(g, C, 32, 21, 12, 14); g.clearRect(32, 34, 1, 1); g.clearRect(43, 34, 1, 1);
      R(g, 32, 10, 12, 12, C.face); R(g, 32, 10, 2, 12, C.light);
      R(g, 34, 14, 3, 2, C.deep); R(g, 39, 14, 3, 2, C.deep); R(g, 37, 15, 2, 4, C.light); P(g, 37, 19, C.dark);
      R(g, 31, 1, 14, 10, C.crown); R(g, 31, 1, 14, 1, C.crownL); R(g, 31, 4, 14, 1, C.crownD); R(g, 31, 7, 14, 1, C.crownD);
      for (var cx = 32; cx < 45; cx += 3) P(g, cx, 0, C.crownL);
      P(g, 31, 5, C.crownL); P(g, 44, 5, C.crownL);
      R(g, 34, 38, 8, 1, C.runeD); R(g, 37, 36, 2, 5, C.runeD); P(g, 38, 38, C.rune);
    } else {   // back
      featherWing(g, C, [32, 30, 24, 18, 14, 8, 4, 2, 2, 8, 8, 18, 18, 28, 28, 36], 3);
      featherWing(g, C, [44, 30, 52, 18, 62, 8, 72, 2, 74, 8, 68, 18, 58, 28, 48, 36], 3);
      R(g, 27, 42, 8, 15, C.body); R(g, 41, 42, 8, 15, C.body); R(g, 27, 42, 2, 15, C.light);
      R(g, 26, 56, 10, 4, C.hoof); R(g, 40, 56, 10, 4, C.hoof);
      ell(g, 38, 38, 17, 11, C.dark); ell(g, 38, 36, 16, 9, C.body); ell(g, 35, 33, 9, 4, C.light);
      line(g, 38, 44, 38, 52, C.dark); ell(g, 38, 53, 2, 3, C.beard);                    // Schwanz
      R(g, 32, 12, 12, 10, C.beard); for (var by = 13; by < 22; by += 2) R(g, 33, by, 10, 1, C.beardL);   // Haar hinten
      R(g, 31, 2, 14, 10, C.crown); R(g, 31, 2, 14, 1, C.crownL); R(g, 31, 5, 14, 1, C.crownD); R(g, 31, 8, 14, 1, C.crownD);
      // Kern auf dem Rücken (verwundbar von hinten)
      ell(g, 38, 33, 4, 3, C.deep); ell(g, 38, 33, 3, 2, C.runeD); P(g, 38, 33, C.rune);
    }
    outline(c, '#120E18');
  }
  function buildWardenWreck(g, c) {   // 76×40
    ell(g, 38, 30, 26, 7, '#2E2838');
    poly(g, [10, 30, 22, 18, 34, 22, 30, 32], '#564C68'); poly(g, [40, 32, 46, 20, 62, 22, 66, 32], '#4A4060');
    poly(g, [4, 26, 14, 14, 20, 16, 12, 28], '#6E6284'); for (var y = 16; y < 28; y += 3) line(g, 8, y + 6, 16, y, '#9488A8');
    R(g, 46, 8, 11, 9, '#7A5A28'); R(g, 46, 8, 11, 1, '#B8873E'); R(g, 46, 11, 11, 1, '#5E4A2E');     // Krone liegt
    ell(g, 32, 26, 5, 3, '#7C7090'); ell(g, 56, 30, 4, 2, '#7C7090'); ell(g, 24, 33, 3, 2, '#9E92B0');
    P(g, 36, 25, VIO_D); P(g, 52, 27, VIO_D);
    outline(c, '#120E18');
  }
  var WARDEN_SHIELD_ARC = 120 * Math.PI / 180;
  function wardenView(f) {
    var dx = Math.cos(f), dy = Math.sin(f);
    if (Math.abs(dx) >= Math.abs(dy) * 0.8) return dx >= 0 ? 'right' : 'left';
    return dy > 0 ? 'front' : 'back';
  }
  function wardenSprite(view, sleep) {
    var base = view === 'left' ? 'right' : view;
    var bv = base === 'right' ? 'side' : base;
    var key = 'warden|' + bv + '|' + (+sleep);
    var spr = cached(key, 76, 64, function (g, c) { buildWarden(g, c, bv, sleep ? WARDEN_PAL.asleep : WARDEN_PAL.awake); });
    if (view !== 'left') return spr;
    var k2 = key + '|L', h = cache.get(k2);
    if (!h) { h = flipH(spr); cache.set(k2, h); }
    return h;
  }
  function drawWarden(ctx, x, y, o) {
    var t = o.time || 0;
    if (o.alive === false) {
      ctx.drawImage(shadowSprite(52), x - 27, y - 3);
      ctx.drawImage(cached('warden|wreck', 76, 40, buildWardenWreck), x - 38, y - 36);
      drawFx(ctx, 'smoke', x + 4, y - 18, t, { small: true });
      if ((t * 0.6) % 2 < 0.25) { ctx.fillStyle = rgba(VIO, 0.8); ctx.fillRect(x - 6 + ((Math.floor(t * 0.6) * 7) % 14), y - 14, 1, 1); }
      return;
    }
    var f = +o.facing || 0, sleep = !!o.asleep && !o.wake, view = wardenView(f);
    var spr = wardenSprite(view, sleep);
    var breathe = sleep ? 0 : Math.round(Math.sin(t * 1.6) * 0.6);
    ctx.drawImage(shadowSprite(56), x - 29, y - 4);
    var dx = x - 38, dy = y - 60 + breathe;
    if (o.revealed && !sleep) {
      var sk = 'warden|sil|' + view, sil = cache.get(sk);
      if (!sil) { sil = silhouette(spr, VIO); cache.set(sk, sil); }
      var ga = ctx.globalAlpha;
      ctx.globalAlpha = ga * (0.45 + 0.35 * Math.sin(t * 6));
      ctx.drawImage(sil, dx - 1, dy); ctx.drawImage(sil, dx + 1, dy); ctx.drawImage(sil, dx, dy - 1); ctx.drawImage(sil, dx, dy + 1);
      ctx.globalAlpha = ga;
    }
    drawFxSprite(ctx, spr, dx, dy, { flash: o.hit ? (typeof o.hit === 'number' ? o.hit : 1) : 0 });
    // Augen, Runen, Frontschild
    var pulse = 0.5 + 0.5 * Math.sin(t * 3);
    if (sleep) {
      glow(ctx, x, dy + 36, VIO, 8, 0.08 + 0.06 * pulse);
      return;
    }
    var eyes = view === 'right' ? [[dx + 63, dy + 13]] : view === 'left' ? [[dx + 76 - 65, dy + 13]] : view === 'front' ? [[dx + 35, dy + 14], [dx + 40, dy + 14]] : [];
    for (var i = 0; i < eyes.length; i++) {
      ctx.fillStyle = VIO_L; ctx.fillRect(eyes[i][0], eyes[i][1], 2, 2);
      glow(ctx, eyes[i][0] + 1, eyes[i][1] + 1, VIO, 6, 0.6 + 0.3 * pulse);
    }
    if (view === 'back') glow(ctx, dx + 38, dy + 33, VIO, 7, 0.35 + 0.3 * pulse);   // Rückenkern
    else glow(ctx, view === 'front' ? dx + 38 : view === 'right' ? dx + 34 : dx + 42, dy + 37, VIO, 6, 0.2 + 0.2 * pulse);
    drawWardenShield(ctx, x, y, f, t, view);
  }
  // Frontschild: Bogen aus Sechseckplatten vor dem Wächter, in Blickrichtung (Bodenebene + Höhe)
  function drawWardenShield(ctx, x, y, f, t, view) {
    var n = 6, rx = 36, ry = 17, cy = y - 20;
    var ga = ctx.globalAlpha;
    for (var i = 0; i < n; i++) {
      var a = f - WARDEN_SHIELD_ARC / 2 + (i + 0.5) / n * WARDEN_SHIELD_ARC;
      var hx = Math.round(x + Math.cos(a) * rx), hy = Math.round(cy + Math.sin(a) * ry);
      if (view === 'back' && Math.sin(a) < 0.2) continue;   // hinter dem Körper verdeckt
      var fl = 0.7 + 0.3 * Math.sin(t * 5 + i * 1.3);
      // Sechseckplatte 9×11: Füllung + heller Rand
      ctx.globalAlpha = ga * fl * 0.45;
      ctx.fillStyle = VIO; ctx.fillRect(hx - 3, hy - 5, 7, 11); ctx.fillRect(hx - 4, hy - 3, 9, 7);
      ctx.globalAlpha = ga * fl;
      ctx.fillStyle = VIO_L;
      ctx.fillRect(hx - 2, hy - 6, 5, 1); ctx.fillRect(hx - 2, hy + 6, 5, 1);
      ctx.fillRect(hx - 4, hy - 4, 1, 3); ctx.fillRect(hx + 4, hy - 4, 1, 3);
      ctx.fillRect(hx - 4, hy + 2, 1, 3); ctx.fillRect(hx + 4, hy + 2, 1, 3);
      ctx.fillRect(hx - 3, hy - 5, 1, 1); ctx.fillRect(hx + 3, hy - 5, 1, 1); ctx.fillRect(hx - 3, hy + 5, 1, 1); ctx.fillRect(hx + 3, hy + 5, 1, 1);
    }
    ctx.globalAlpha = ga;
    glow(ctx, x + Math.cos(f) * rx, cy + Math.sin(f) * ry, VIO, 18, 0.35);
  }

  // --- Plünderer: Zielpose, ungeschützt (Schild 0) ----------------------------------------------
  function scavengerExtras(ctx, x, y, o, t) {
    var bob = Math.round(Math.sin(t * 3.4) * 2);
    var dx = x - 15, dy = y - 32 - bob;   // wie drawScavenger
    if (o.aiming) {
      var ang = o.aimAngle != null && isFinite(o.aimAngle) ? +o.aimAngle : Math.PI / 2;
      var pvx = x, pvy = y - 13 - bob;
      var ex = pvx + Math.cos(ang) * 9, ey = pvy + Math.sin(ang) * 6;
      ctx.fillStyle = '#2A2226'; ctx.fillRect(pvx - 2, pvy - 2, 5, 4);
      var steps = 9;
      for (var i = 0; i <= steps; i++) {
        var qx = Math.round(pvx + (ex - pvx) * i / steps), qy = Math.round(pvy + (ey - pvy) * i / steps);
        ctx.fillStyle = '#2A2226'; ctx.fillRect(qx - 1, qy - 1, 3, 3);
        ctx.fillStyle = '#8EA3B5'; ctx.fillRect(qx, qy - 1, 1, 1);
      }
      var ch = 0.5 + 0.5 * Math.sin(t * 14);
      ctx.fillStyle = PAL.alarmrot; ctx.fillRect(Math.round(ex) - 1, Math.round(ey) - 1, 2, 2);
      glow(ctx, ex, ey, PAL.alarmrot, 6, 0.45 + 0.35 * ch);
      // Auge wird rot (feindliches Zielen)
      ctx.fillStyle = PAL.alarmrot; ctx.fillRect(dx + 16, dy + 11, 3, 3);
      ctx.fillStyle = '#FFD8CC'; ctx.fillRect(dx + 16, dy + 11, 1, 1);
      glow(ctx, dx + 17, dy + 12, PAL.alarmrot, 7, 0.5);
    }
    if (o.shieldSeg === 0) {   // ungeschützt: Funken + Rauchfaden
      var cyc = (t * 1.1 + x * 0.01) % 1.4;
      if (cyc < 0.5) drawFx(ctx, 'sparks', dx + 8 + ((Math.floor(t * 1.1) * 9) % 14), dy + 12, cyc, { small: true, seed: x | 0 });
      drawFx(ctx, 'smoke', dx + 20, dy + 6, t + x * 0.01, { small: true });
    }
  }

  // --- Spieler: Schildblase (Hex-Flackern), optionaler Segmentring ------------------------------
  function shieldBubbleSprite(v) {
    return cached('shbub|' + v, 34, 50, function (g) {
      var cx = 17, cy = 25, rx = 15, ry = 23, s = 6;
      g.strokeStyle = rgba(SHIELD, 0.85); g.lineWidth = 1;
      for (var row = -5; row <= 5; row++) {
        if (v === 1 && row % 2 === 0) continue;
        for (var col = -3; col <= 3; col++) {
          var hx = cx + col * s * 1.5, hy = cy + row * s * 0.87 + ((col & 1) ? s * 0.43 : 0);
          var pts = [];
          for (var k = 0; k < 6; k++) { var a = k / 6 * Math.PI * 2; pts.push(Math.round(hx + Math.cos(a) * s * 0.55), Math.round(hy + Math.sin(a) * s * 0.5)); }
          for (k = 0; k < 6; k++) { var k2 = (k + 1) % 6; line(g, pts[k * 2], pts[k * 2 + 1], pts[k2 * 2], pts[k2 * 2 + 1], rgba(SHIELD, 0.9)); }
        }
      }
      g.globalCompositeOperation = 'destination-in';
      ell(g, cx, cy, rx, ry, '#000');
      g.globalCompositeOperation = 'source-over';
      g.globalCompositeOperation = 'destination-over';
      ell(g, cx, cy, rx, ry, rgba(SHIELD, 0.22));
      g.globalCompositeOperation = 'source-over';
      var e = ellPts(cx, cy, rx, ry, 64);
      for (var i = 0; i < e.length; i += 2) P(g, e[i], e[i + 1], i % 8 < 4 ? SHIELD : rgba('#FFFFFF', 0.9));
    });
  }
  function drawShieldBubble(ctx, x, y, age, scale) {
    var a = Math.max(0, Math.min(1, 1 - age / 0.35));
    if (a <= 0) return;
    var v = Math.floor(age * 30) % 2, spr = shieldBubbleSprite(v), s = scale || 1;
    var ga = ctx.globalAlpha;
    ctx.globalAlpha = ga * a * (v ? 0.75 : 1);
    if (s === 1) ctx.drawImage(spr, Math.round(x - 17), Math.round(y - 25));
    else ctx.drawImage(spr, Math.round(x - 17 * s), Math.round(y - 25 * s), Math.round(34 * s), Math.round(50 * s));
    ctx.globalAlpha = ga;
    glow(ctx, x, y, SHIELD, 12, 0.35 * a);
  }
  function drawShieldRingPix(ctx, x, y, seg, max) {   // Bodenring aus Würfeln (nur mit opts.shieldRing)
    max = Math.max(1, Math.min(8, max | 0)); seg = Math.max(0, Math.min(max, seg | 0));
    for (var i = 0; i < max; i++) {
      var a = Math.PI / 2 + (i + 0.5) / max * Math.PI * 2, qx = Math.round(x + Math.cos(a) * 12), qy = Math.round(y + Math.sin(a) * 5);
      if (i < seg) { ctx.fillStyle = SHIELD; ctx.fillRect(qx - 1, qy - 1, 3, 2); ctx.fillStyle = '#E8FFFF'; ctx.fillRect(qx - 1, qy - 1, 1, 1); }
      else { ctx.fillStyle = 'rgba(142,163,181,0.7)'; ctx.fillRect(qx - 1, qy - 1, 3, 1); ctx.fillRect(qx - 1, qy, 1, 1); ctx.fillRect(qx + 1, qy, 1, 1); }
    }
  }

  // --- Effekte M2 (p = Fortschritt 0..1, sonst Zeit-Schleife) -----------------------------------
  function drawFxM2(ctx, kind, x, y, t, o) {
    var p = o.p != null && isFinite(o.p) ? Math.max(0, Math.min(1, +o.p)) : (t % 1), i, a, ga = ctx.globalAlpha;
    switch (kind) {
      case 'shield_hit': {
        drawShieldBubble(ctx, x, y, p * 0.35, 1 + p * 0.12);
        ctx.fillStyle = rgba('#E8FFFF', 1 - p);
        for (i = 0; i < 6; i++) { a = i / 6 * Math.PI * 2 + 0.4; var d = 6 + p * 14; ctx.fillRect(Math.round(x + Math.cos(a) * d), Math.round(y + Math.sin(a) * d * 1.3), 1, 1); }
        return true;
      }
      case 'shield_break': {
        if (p < 0.25) {
          var q = p / 0.25, e = ellPts(x, y, 10 + q * 10, 14 + q * 12, 28);
          ctx.fillStyle = rgba(SHIELD, 1 - q);
          for (i = 0; i < e.length; i += 2) ctx.fillRect(Math.round(e[i]), Math.round(e[i + 1]), 1, 1);
          glow(ctx, x, y, SHIELD, 16, 0.6 * (1 - q));
        }
        for (i = 0; i < 12; i++) {   // Würfelsplitter fliegen weg, fallen
          a = hash2(i, 3, 61) * Math.PI * 2;
          var sp = 14 + hash2(i, 4, 61) * 22;
          var cx = x + Math.cos(a) * sp * p, cy = y + Math.sin(a) * sp * p * 0.8 + 26 * p * p;
          ctx.globalAlpha = ga * (1 - p * 0.9);
          var sz = i % 3 === 0 ? 3 : 2;
          ctx.fillStyle = SHIELD; ctx.fillRect(Math.round(cx), Math.round(cy), sz, sz);
          ctx.fillStyle = '#E8FFFF'; ctx.fillRect(Math.round(cx), Math.round(cy), 1, 1);
          if (sz === 3) { ctx.fillStyle = '#3E9CA8'; ctx.fillRect(Math.round(cx) + 1, Math.round(cy) + 2, 2, 1); }
        }
        ctx.globalAlpha = ga;
        return true;
      }
      case 'cover_hit': {
        if (p < 0.15) glow(ctx, x, y, PAL.funke, 7, 0.8 * (1 - p / 0.15));
        var cols = [KS.stoneL, KS.stone, KS.stoneD, KS.stoneFace];
        for (i = 0; i < 8; i++) {
          a = -Math.PI / 2 + (hash2(i, 7, 62) - 0.5) * 2.4;
          var v0 = 18 + hash2(i, 8, 62) * 26;
          var sx = x + Math.cos(a) * v0 * p, sy = y + Math.sin(a) * v0 * p + 34 * p * p;
          ctx.globalAlpha = ga * (1 - p);
          ctx.fillStyle = cols[i % 4]; ctx.fillRect(Math.round(sx), Math.round(sy), i % 2 ? 2 : 1, 2);
        }
        ctx.globalAlpha = ga * (1 - p) * 0.6;
        var pf = puffSprite(2 + p * 5, '#A89C8A');
        ctx.drawImage(pf, Math.round(x - pf.width / 2), Math.round(y - 2 - p * 8 - pf.height / 2));
        ctx.globalAlpha = ga;
        return true;
      }
      case 'muzzle_aim': {   // anschwellendes Glühen vor dem Schuss (feindlich -> Leuchtrot)
        var r0 = 3 + Math.round(p * 9);
        glow(ctx, x, y, PAL.alarmrot, r0 + 4, 0.3 + 0.6 * p);
        for (i = 0; i < 4; i++) {
          a = i / 4 * Math.PI * 2 + t * 6;
          var dd = 3 + 10 * (1 - ((p * 3 + i / 4) % 1));
          ctx.fillStyle = rgba(PAL.alarmrot, 0.4 + 0.6 * p); ctx.fillRect(Math.round(x + Math.cos(a) * dd), Math.round(y + Math.sin(a) * dd), 1, 1);
        }
        ctx.fillStyle = p > 0.75 && frameOf(t, 20, 2) ? '#FFFFFF' : '#FFB070';
        var cs = p > 0.5 ? 2 : 1;
        ctx.fillRect(Math.round(x) - (cs >> 1), Math.round(y) - (cs >> 1), cs, cs);
        return true;
      }
      case 'warden_deflect': {
        var n = 5;
        for (i = 0; i < n; i++) {
          a = -Math.PI / 2 + (i - 2) * 0.5;
          var hx = Math.round(x + Math.cos(a) * (6 + p * 4)), hy = Math.round(y + Math.sin(a) * (6 + p * 4) + 4);
          ctx.globalAlpha = ga * (1 - p);
          ctx.fillStyle = VIO; ctx.fillRect(hx - 2, hy - 3, 4, 1); ctx.fillRect(hx - 2, hy + 3, 4, 1); ctx.fillRect(hx - 3, hy - 2, 1, 5); ctx.fillRect(hx + 2, hy - 2, 1, 5);
          ctx.fillStyle = VIO_L; ctx.fillRect(hx - 1, hy - 1, 2, 2);
        }
        ctx.globalAlpha = ga * (1 - p);
        ctx.fillStyle = '#FFFFFF'; ctx.fillRect(x - 1, y - 6 - Math.round(p * 4), 2, 12); ctx.fillRect(x - 6 - Math.round(p * 4), y - 1, 12 + Math.round(p * 8), 2);
        ctx.globalAlpha = ga;
        glow(ctx, x, y, VIO, 14, 0.7 * (1 - p));
        return true;
      }
      case 'revive': {
        var e2 = ellPts(x, y, 8 + p * 16, 3 + p * 6, 32);
        ctx.fillStyle = rgba(PAL.mint, 1 - p);
        for (i = 0; i < e2.length; i += 2) ctx.fillRect(Math.round(e2[i]), Math.round(e2[i + 1]), 2, 1);
        for (i = 0; i < 5; i++) {
          var q2 = (p * 1.4 + i * 0.17) % 1, mx = x - 10 + i * 5, my = y - 4 - q2 * 34;
          ctx.globalAlpha = ga * (1 - q2) * (1 - p * 0.5);
          if (i % 2) { ctx.fillStyle = PAL.mint; ctx.fillRect(Math.round(mx) - 2, Math.round(my), 5, 1); ctx.fillRect(Math.round(mx), Math.round(my) - 2, 1, 5); }
          else { ctx.fillStyle = SHIELD; ctx.fillRect(Math.round(mx), Math.round(my), 2, 2); }
        }
        ctx.globalAlpha = ga;
        glow(ctx, x, y - 10, PAL.mint, 16, 0.4 * (1 - p));
        return true;
      }
      case 'order_pillar': {
        var col = typeof o.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.color) ? o.color : PAL.mint;
        var h = Math.max(40, Math.min(240, Math.round((+o.height || 120) / 20) * 20));
        var spr = cached('opil|' + col + '|' + h, 16, h, function (g) {
          for (var yy = 0; yy < h; yy++) {
            var k = yy / h;   // 0 oben, 1 unten
            g.fillStyle = rgba(col, 0.08 + 0.32 * k); g.fillRect(2, yy, 12, 1);
            g.fillStyle = rgba(col, 0.25 + 0.6 * k); g.fillRect(6, yy, 4, 1);
            g.fillStyle = rgba('#FFFFFF', 0.2 + 0.7 * k); g.fillRect(7, yy, 2, 1);
          }
        });
        var pu = 0.75 + 0.25 * Math.sin(t * 3);
        ctx.globalAlpha = ga * pu;
        ctx.drawImage(spr, Math.round(x - 8), Math.round(y - h));
        ctx.globalAlpha = ga;
        var e3 = ellPts(x, y, 11, 4, 24);
        for (i = 0; i < e3.length; i += 2) { if (((i >> 1) + Math.floor(t * 8)) % 3 === 0) continue; ctx.fillStyle = col; ctx.fillRect(Math.round(e3[i]), Math.round(e3[i + 1]), 1, 1); }
        for (i = 0; i < 4; i++) {   // aufsteigende Funken
          var q3 = (t * 0.6 + i * 0.25) % 1;
          ctx.fillStyle = rgba(col, 1 - q3); ctx.fillRect(Math.round(x - 4 + i * 3), Math.round(y - q3 * h * 0.8), 1, 2);
        }
        glow(ctx, x, y - 2, col, 12, 0.45 * pu);
        return true;
      }
    }
    return false;
  }

  // --- Projektile M2 -----------------------------------------------------------------------------
  function drawProjectileM2(ctx, kind, x, y, angle, t) {
    var ca = Math.cos(angle || 0), sa = Math.sin(angle || 0), i;
    if (kind === 'warden') {   // dick, langsam, violett-weiß, mit Schweif
      for (i = 3; i >= 1; i--) {
        var tx = x - ca * i * 5, ty = y - sa * i * 5;
        ctx.fillStyle = rgba(VIO, 0.55 - i * 0.13); ctx.fillRect(Math.round(tx) - 3 + i, Math.round(ty) - 3 + i, 7 - i * 2, 7 - i * 2);
      }
      glow(ctx, x, y, VIO, 13, 0.75 + 0.15 * Math.sin((t || 0) * 20));
      var orb = cached('proj|warden', 12, 12, function (g) {
        ell(g, 6, 6, 5.5, 5.5, VIO_D); ell(g, 6, 6, 4.5, 4.5, VIO); ell(g, 6, 6, 3, 3, VIO_L); ell(g, 5.5, 5.5, 1.6, 1.6, '#FFFFFF');
      });
      ctx.drawImage(orb, Math.round(x) - 6, Math.round(y) - 6);
      return;
    }
    // pistol: kurzer Mint-Bolzen (Spielerwaffe, kleiner als Blaster)
    var spr = cached('proj|pistol', 10, 6, function (g) { R(g, 1, 2, 7, 2, PAL.mint); R(g, 4, 2, 4, 2, '#E8FFF8'); P(g, 8, 2, '#FFFFFF'); P(g, 0, 2, '#3E9C80'); });
    glow(ctx, x, y, PAL.mint, 5, 0.55);
    ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.rotate(angle || 0); ctx.drawImage(spr, -5, -3); ctx.restore();
  }

  // --- Raumszene: Mond Kesh -----------------------------------------------------------------------
  var MOON_R = 170, MOON_RUIN = [232, 214];
  function buildMoon(g, c) {   // 400×400
    var W = 400, cx = 200, cy = 200, Rr = MOON_R;
    var ramp = ['#100E15', '#221E28', '#36303A', '#4C4448', '#665C58', '#837666', '#A39378', '#C2B292', '#DCCFAE'].map(hex2rgb);
    var r = rng(4242), craters = [];
    for (var i = 0; i < 34; i++) {
      var a = r() * Math.PI * 2, d = Math.sqrt(r()) * Rr * 0.95, cr = 4 + Math.pow(r(), 2.2) * 30;
      craters.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d, cr]);
    }
    craters.push([MOON_RUIN[0] + 4, MOON_RUIN[1] + 2, 16]);
    var L = [-0.62, -0.42, 0.66], bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    var id = g.createImageData(W, W), D = id.data;
    for (var y = 0; y < W; y++) for (var x = 0; x < W; x++) {
      var nx = (x + 0.5 - cx) / Rr, ny = (y + 0.5 - cy) / Rr, q = nx * nx + ny * ny;
      if (q > 1) continue;
      var nz = Math.sqrt(1 - q);
      var lam = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      var b = 0.06 + lam * 0.94;
      // großflächige Maria + feines Rauschen
      b *= 0.86 + 0.14 * Math.sin(x * 0.031 + Math.sin(y * 0.023) * 2.1) * Math.cos(y * 0.027 - x * 0.011);
      b += (hash2(x >> 1, y >> 1, 77) - 0.5) * 0.06;
      for (var k = 0; k < craters.length; k++) {
        var C = craters[k], ddx = x - C[0], ddy = y - C[1], dd = Math.sqrt(ddx * ddx + ddy * ddy) / C[2];
        if (dd > 1.25) continue;
        var dirl = (ddx * L[0] + ddy * L[1]) / (C[2] * dd + 0.001);
        if (dd < 1) b *= 0.78 - 0.18 * dirl * dd;          // Kraterboden: Schatten auf der Lichtseite des Randes
        else b *= 1 + 0.32 * (-dirl) * (1.25 - dd) * 4 * 0.25; // Wall: gegenüberliegender Rand hell
      }
      var limb = q > 0.94 ? 0.85 : 1;
      b *= limb;
      var lv = b * (ramp.length - 1) + (bayer[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * 0.9;
      lv = Math.max(0, Math.min(ramp.length - 1, Math.round(lv)));
      var col = ramp[lv], o4 = (y * W + x) * 4;
      D[o4] = col[0]; D[o4 + 1] = col[1]; D[o4 + 2] = col[2]; D[o4 + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    // Kustoden-Ruine: Grundriss aus Mauerlinien (hell) + violette Fugen
    var rx = MOON_RUIN[0], ry = MOON_RUIN[1];
    var walls = [[-12, -8, 24, 1], [-12, -8, 1, 14], [11, -8, 1, 16], [-12, 6, 10, 1], [2, 8, 10, 1], [-6, -3, 1, 6], [4, -3, 6, 1], [-18, 12, 6, 1], [14, -12, 4, 4]];
    walls.forEach(function (w) { R(g, rx + w[0], ry + w[1], w[2], w[3], '#EADFC2'); R(g, rx + w[0] + 1, ry + w[1] + 1, w[2], w[3], '#5A5048'); });
    P(g, rx, ry, VIO); P(g, rx - 1, ry + 1, VIO_D); P(g, rx + 6, ry - 2, VIO); P(g, rx - 9, ry + 3, VIO_D);
    // Landezone (Schleifspuren der Plünderer)
    line(g, rx - 34, ry + 30, rx - 14, ry + 14, '#C2B292'); R(g, rx - 38, ry + 30, 6, 4, '#7A6A56'); P(g, rx - 36, ry + 31, PAL.warngelb);
  }
  function drawMoon(ctx, x, y, t) {
    var spr = cached('station|moon', 400, 400, buildMoon);
    ctx.drawImage(spr, Math.round(x) - 200, Math.round(y) - 200);
    var rx = x - 200 + MOON_RUIN[0], ry = y - 200 + MOON_RUIN[1];
    var pu = 0.5 + 0.5 * Math.sin(t * 1.4);
    glow(ctx, rx, ry, VIO, 22, 0.25 + 0.25 * pu);
    glow(ctx, rx, ry, VIO_L, 6, 0.3 + 0.3 * pu);
    for (var i = 0; i < 4; i++) {
      var ph = (t * 0.8 + i * 0.25) % 1;
      if (ph > 0.4) continue;
      ctx.fillStyle = rgba(VIO_L, 1 - ph / 0.4);
      ctx.fillRect(Math.round(rx - 10 + hash2(i, Math.floor(t * 0.8 + i * 0.25), 5) * 20), Math.round(ry - 8 + hash2(i, Math.floor(t * 0.8 + i * 0.25), 6) * 16), 1, 1);
    }
  }

  // --- Icons + Gegenstände M2 ---------------------------------------------------------------------
  Object.assign(ICONS, {
    loc_moon: ['...####...', '.##++++##.', '.#++o+++#.', '#++++++o+#', '#+oo++++w#', '#+oo++++##', '#++++o+o+#', '.#++++++#.', '.##+++o##.', '...####...'],
  });
  Object.assign(ICON_COLORS, { loc_moon: '#C2B292' });
  ITEM_KINDS.tafel = 1;
  ITEM_GLOW.tafel = PAL.bernstein;
  function buildItemM2(g, kind) {
    if (kind !== 'tafel') return false;
    R(g, 3, 1, 10, 14, '#6E3E22'); R(g, 4, 2, 8, 12, '#A86A42'); R(g, 4, 2, 8, 1, '#C88A5E'); R(g, 4, 2, 1, 12, '#C88A5E');
    for (var ry = 0; ry < 4; ry++) for (var cx = 0; cx < 2; cx++) { var wx = 5 + cx * 3 + (ry % 2), wy = 4 + ry * 3; P(g, wx, wy, '#F2C45A'); P(g, wx + 1, wy, '#D9A441'); P(g, wx, wy + 1, '#9A6A2A'); }
    return true;
  }

  // =============================================================================================
  // M3a „Breitseite & Schaden“ (Team ART, CONTRACT-M3 §12)
  // Stationen (Düse, Batterie, Emitter, Lanzenkammer, Reaktor/Schildgenerator mittschiffs, Triebwerk am Heck),
  // Zustände dreifach codiert (Farbe + Muster + Kürzel), Stationsplakette, Geschützdeck, Strahlen, Ladeglühen, Schildstoß.
  // =============================================================================================
  var M3C = { burst: '#E8F8FF', enemy: '#FF5A4A', besch: '#F2C94C', flick: '#F08A3C', aus: '#E0473C', ok: '#7FE0C2', emp: '#A9D6E5', erfolg: '#8FD06A' };
  var SIDE_LABEL = { port: 'BB', stbd: 'STB', bow: 'BUG', aft: 'HECK', mid: 'MITTE' };
  // Farbe je Seite (Emitter-Spulen, Plakettenstreifen): Bb Bernstein, Stb Mint, Bug Stoß-Weiß, Heck Eisblau, Mitte Messing
  var SIDE_COL = { port: PAL.bernstein, stbd: PAL.mint, bow: '#E8F8FF', aft: PAL.eisblau, mid: PAL.messing };
  var SYS_SIDE = {
    reactor: 'mid', shields: 'mid', life: 'mid', transfer: 'stbd', engines: 'aft', emitter_aft: 'aft', weapon_bow: 'bow', emitter_bow: 'bow',
    thruster_port: 'port', battery_port: 'port', emitter_port: 'port', thruster_stbd: 'stbd', battery_stbd: 'stbd', emitter_stbd: 'stbd',
  };
  var KIND_SIDE = { sys_reactor: 'mid', sys_shields: 'mid', sys_life: 'mid', sys_engines: 'aft', sys_weapon_bow: 'bow', sys_transfer: 'stbd', sys_weapons: 'mid' };
  var SIDE_ALIAS = {
    0: 'bow', 1: 'stbd', 2: 'aft', 3: 'port', '-1': 'mid', bb: 'port', backbord: 'port', stb: 'stbd', steuerbord: 'stbd', starboard: 'stbd',
    bug: 'bow', heck: 'aft', mitte: 'mid', mittschiffs: 'mid', centre: 'mid', center: 'mid',
  };
  function normSide(s) {
    if (s == null) return null;
    var k = String(s).toLowerCase();
    if (SIDE_LABEL[k]) return k;
    return SIDE_ALIAS[k] || null;
  }
  function sideOf(kind, o) { return normSide(o.side) || (o.system && SYS_SIDE[o.system]) || KIND_SIDE[kind] || 'mid'; }
  function normState(s) { return s === 'damaged' || s === 'broken' || s === 'offline' ? s : 'ok'; }
  // Kürzel: zerstört > EMP > geflickt > beschädigt > ok
  function stateCode(state, fragile) {
    state = normState(state);
    if (state === 'broken') return 'aus';
    if (state === 'offline') return 'emp';
    if (fragile) return 'flick';
    if (state === 'damaged') return 'besch';
    return 'ok';
  }
  var STATE_TXT = { ok: 'OK', besch: 'BESCH', aus: 'AUS', flick: 'FLICK', emp: 'EMP' };
  var STATE_COL = { ok: M3C.ok, besch: M3C.besch, aus: M3C.aus, flick: M3C.flick, emp: M3C.emp };

  // --- Mini-Schrift 3×5 für Plaketten und Zustandsmarken ---------------------------------------
  var TINY = {
    A: '.#./#.#/###/#.#/#.#', B: '##./#.#/##./#.#/##.', C: '.##/#../#../#../.##', D: '##./#.#/#.#/#.#/##.', E: '###/#../##./#../###',
    F: '###/#../##./#../#..', G: '.##/#../#.#/#.#/.##', H: '#.#/#.#/###/#.#/#.#', I: '###/.#./.#./.#./###', J: '..#/..#/..#/#.#/.#.',
    K: '#.#/#.#/##./#.#/#.#', L: '#../#../#../#../###', M: '#...#/##.##/#.#.#/#...#/#...#', N: '#..#/##.#/#.##/#..#/#..#',
    O: '###/#.#/#.#/#.#/###', P: '##./#.#/##./#../#..', R: '##./#.#/##./#.#/#.#', S: '.##/#../.#./..#/##.', T: '###/.#./.#./.#./.#.',
    U: '#.#/#.#/#.#/#.#/###', V: '#.#/#.#/#.#/#.#/.#.', W: '#...#/#...#/#.#.#/#.#.#/.#.#.', X: '#.#/#.#/.#./#.#/#.#', Y: '#.#/#.#/.#./.#./.#.',
    Z: '###/..#/.#./#../###', '0': '###/#.#/#.#/#.#/###', '1': '.#./##./.#./.#./###', '2': '##./..#/.#./#../###', '3': '##./..#/.#./..#/##.',
    '4': '#.#/#.#/###/..#/..#', '5': '###/#../##./..#/##.', '6': '.##/#../###/#.#/###', '7': '###/..#/.#./.#./.#.', '8': '###/#.#/###/#.#/###',
    '9': '###/#.#/###/..#/##.', '-': '.../.../###/.../...', '+': '.../.#./###/.#./...', '/': '..#/..#/.#./#../#..', '.': '.../.../.../.../.#.',
  };
  var tinyData = {};
  function tinyGlyph(ch) {
    if (tinyData[ch]) return tinyData[ch];
    var src = TINY[ch] || TINY[String(ch).toUpperCase()];
    var rows = src ? src.split('/') : (ch === ' ' ? [] : ['###', '#.#', '#.#', '#.#', '###']);
    var w = ch === ' ' ? 2 : 0;
    for (var i = 0; i < rows.length; i++) w = Math.max(w, rows[i].length);
    return (tinyData[ch] = { w: w, rows: rows });
  }
  function tinyW(s) { s = String(s); var w = 0; for (var i = 0; i < s.length; i++) w += tinyGlyph(s[i]).w + (i < s.length - 1 ? 1 : 0); return w; }
  function tinyText(g, s, x, y, col) {
    s = String(s); g.fillStyle = col;
    for (var i = 0; i < s.length; i++) {
      var gl = tinyGlyph(s[i]);
      for (var r = 0; r < gl.rows.length; r++) for (var q = 0; q < gl.rows[r].length; q++) if (gl.rows[r][q] === '#') g.fillRect(x + q, y + r, 1, 1);
      x += gl.w + 1;
    }
  }

  // --- Zustandsmuster (7×7 o. ä.): Farbe + Muster ---------------------------------------------
  function statePattern(g, x, y, s, code) {
    var i, j;
    if (code === 'besch') {   // gelb schraffiert
      for (j = 0; j < s; j++) for (i = 0; i < s; i++) P(g, x + i, y + j, ((i + j) % 4) < 2 ? M3C.besch : '#3A3218');
    } else if (code === 'aus') {   // rotes X
      R(g, x, y, s, s, '#4A1614');
      for (i = 0; i < s; i++) { P(g, x + i, y + i, M3C.aus); P(g, x + s - 1 - i, y + i, M3C.aus); if (i < s - 1) { P(g, x + i + 1, y + i, '#FF8A7C'); P(g, x + s - 2 - i, y + i, '#FF8A7C'); } }
    } else if (code === 'flick') {   // Klebeband: diagonaler Streifen
      R(g, x, y, s, s, '#3A2414');
      for (j = 0; j < s; j++) for (i = 0; i < s; i++) { var d = i + j - (s - 1); if (d >= -1 && d <= 1) P(g, x + i, y + j, d === -1 ? '#FFC08A' : M3C.flick); }
    } else if (code === 'emp') {   // eisblau gepunktet
      R(g, x, y, s, s, '#1A2A36');
      for (j = 0; j < s; j++) for (i = 0; i < s; i++) if ((i + j) % 2 === 0) P(g, x + i, y + j, M3C.emp);
    } else {   // ok: mint mit Haken
      R(g, x, y, s, s, '#1E4A40');
      var ck = [[1, 3], [2, 4], [3, 3], [4, 2], [5, 1]];
      for (i = 0; i < ck.length; i++) if (ck[i][0] < s && ck[i][1] < s) { P(g, x + ck[i][0], y + ck[i][1], M3C.ok); P(g, x + ck[i][0], y + ck[i][1] + 1, M3C.ok); }
    }
  }
  // Zustandsmarke (Chip, 9 px hoch): Rahmen in Zustandsfarbe, Muster-Quadrat, Kürzel
  function chipSprite(code) {
    var txt = STATE_TXT[code] || 'OK', col = STATE_COL[code] || M3C.ok;
    var w = 2 + 7 + 2 + tinyW(txt) + 2;
    return cached('m3chip|' + code, w, 9, function (g) {
      R(g, 0, 0, w, 9, col); R(g, 1, 1, w - 2, 7, '#121826');
      statePattern(g, 1, 1, 7, code);
      R(g, 8, 1, 1, 7, shade(col, -0.5));
      tinyText(g, txt, 10, 2, code === 'aus' ? '#FF7A6E' : col);
    });
  }
  // Stationsplakette (Messing, Kürzel BB/STB/BUG/HECK/MITTE, Farbstreifen der Seite)
  function badgeSprite(side) {
    var txt = SIDE_LABEL[side] || '?', w = tinyW(txt) + 9;
    return cached('m3badge|' + side, w, 9, function (g) {
      R(g, 1, 0, w - 2, 9, '#2B1D1A'); R(g, 0, 1, w, 7, '#2B1D1A');
      R(g, 1, 1, w - 2, 7, PAL.messing); R(g, 1, 1, w - 2, 1, '#F1D9A0'); R(g, 1, 7, w - 2, 1, '#7A5A28');
      R(g, 2, 2, 2, 5, SIDE_COL[side] || PAL.messing); R(g, 2, 2, 2, 1, shade(SIDE_COL[side] || PAL.messing, 0.4));
      tinyText(g, txt, 6, 2, '#2B1D1A');
      P(g, w - 2, 4, '#6E4E22');
    });
  }
  // drawStationBadge(g, side, x, y, state, opts): x = Mitte, y = Oberkante. state (optional) hängt ein Zustandsquadrat an.
  // opts.fragile markiert geflickt. Rückgabe: Gesamtbreite in px.
  function drawStationBadge(ctx, side, x, y, state, opts) {
    var o = opts || {};
    var sd = normSide(side) || 'mid';
    var b = badgeSprite(sd);
    var hasState = state != null || o.fragile;
    var code = hasState ? stateCode(state, o.fragile) : null;
    var total = b.width + (hasState ? 10 : 0);
    var x0 = Math.round(x - total / 2), y0 = Math.round(y);
    ctx.drawImage(b, x0, y0);
    if (hasState) {
      var sq = cached('m3sq|' + code, 9, 9, function (g) { R(g, 0, 0, 9, 9, STATE_COL[code]); R(g, 1, 1, 7, 7, '#121826'); statePattern(g, 1, 1, 7, code); });
      ctx.drawImage(sq, x0 + b.width + 1, y0);
    }
    return total;
  }
  // drawStateTag(g, state, x, y, opts): Zustandsmarke mit Kürzel. opts.fragile, opts.align ('center' Standard | 'left').
  function drawStateTag(ctx, state, x, y, opts) {
    var o = opts || {};
    var spr = chipSprite(stateCode(state, o.fragile));
    var dx = o.align === 'left' ? x : x - spr.width / 2;
    ctx.drawImage(spr, Math.round(dx), Math.round(y));
    return spr.width;
  }

  // --- Overlay je Zustand, auf das Stationssprite maskiert --------------------------------------
  function tapeStrip(g, x0, y0, x1, y1, w) {
    poly(g, thick(x0, y0 + 1, x1, y1 + 1, w), '#8A4A1A');
    poly(g, thick(x0, y0, x1, y1, w), M3C.flick);
    line(g, x0, y0 - w / 2 + 0.5, x1, y1 - w / 2 + 0.5, '#FFC08A');
    var n = Math.max(2, Math.round(Math.abs(x1 - x0) / 4));
    for (var i = 1; i < n; i++) { var t = i / n; P(g, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, '#C8682A'); }
    // ausgefranste Enden
    P(g, x0 - 1, y0 - 1, M3C.flick); P(g, x1 + 1, y1 + 1, M3C.flick);
  }
  function stateOverlay(base, baseKey, state, fragile, bx) {
    if (state === 'ok' && !fragile) return null;
    var key = baseKey + '|ov|' + state + '|' + (fragile ? 1 : 0);
    return cached(key, base.width, base.height, function (g, c) {
      var w = c.width, h = c.height, k, d;
      bx = bx || 0;
      if (state === 'damaged') {   // gelbe Schraffur, maskiert
        for (k = -h; k < w; k += 7) for (d = 0; d < 2; d++) line(g, k + d, h, k + d + h, 0, 'rgba(242,201,76,0.42)');
      } else if (state === 'broken') {
        R(g, 0, 0, w, h, 'rgba(11,14,26,0.5)');
        for (k = -h; k < w; k += 9) line(g, k, h, k + h, 0, 'rgba(224,71,60,0.18)');
      } else if (state === 'offline') {
        R(g, 0, 0, w, h, 'rgba(169,214,229,0.28)');
        for (k = 0; k < h; k += 3) R(g, 0, k, w, 1, 'rgba(11,14,26,0.35)');
      }
      if (state !== 'ok') { g.globalCompositeOperation = 'destination-in'; g.drawImage(base, 0, 0); g.globalCompositeOperation = 'source-over'; }
      if (fragile && state !== 'broken') {   // Klebeband über dem Gehäuse
        tapeStrip(g, bx + 5, 30, bx + 27, 20, 4);
        tapeStrip(g, bx + 8, 38, bx + 24, 38, 3);
      }
      if (state === 'broken') {   // rotes X
        poly(g, thick(bx + 5, 9, bx + 27, 41, 5), '#2B0E0C'); poly(g, thick(bx + 27, 9, bx + 5, 41, 5), '#2B0E0C');
        poly(g, thick(bx + 5, 9, bx + 27, 41, 3), M3C.aus); poly(g, thick(bx + 27, 9, bx + 5, 41, 3), M3C.aus);
        line(g, bx + 6, 9, bx + 27, 40, '#FF8A7C');
      }
    });
  }

  // --- Stationen (32×48; Triebwerk 44×48) -------------------------------------------------------
  var STEEL = '#55667D', STEEL_L = '#8EA3B5', STEEL_D = '#3A4759';
  function statusLamp(g, x, y, state, f) {
    var lc = state === 'ok' ? PAL.mint : state === 'damaged' ? (f % 2 ? M3C.besch : '#6A5A20') : (f % 2 ? M3C.aus : '#5A1E1E');
    R(g, x, y, 3, 2, lc); P(g, x, y, shade(lc, 0.5));
  }
  function scorch(g, seed, x0, y0, w, h) { var r = rng(seed); for (var i = 0; i < 16; i++) P(g, x0 + r() * w, y0 + r() * h, 'rgba(20,14,12,0.6)'); }

  function buildReactorM3(g, c, state, f, red) {
    var brk = state === 'broken', dmg = state === 'damaged', i;
    var flick = dmg ? [1, 1, 0.4, 1, 0.7, 1, 0.2, 0.9][f] : 1, pulse = 0.5 + 0.5 * Math.sin(f / 8 * Math.PI * 2);
    sysBase(g, 2, 28, 41);
    // Leitungen nach links/rechts (gehen in die Bodenkabel über)
    R(g, 0, 31, 5, 5, '#7E3A28'); R(g, 0, 31, 5, 1, '#D77A5C'); R(g, 27, 31, 5, 5, '#7E3A28'); R(g, 27, 31, 5, 1, '#D77A5C');
    // Stützen
    R(g, 4, 13, 3, 29, STEEL_D); R(g, 4, 13, 1, 29, STEEL_L); R(g, 25, 13, 3, 29, '#2E3946'); R(g, 25, 13, 1, 29, STEEL);
    // Kernsäule aus Glas
    var coreHi = red ? '#FF8A6C' : PAL.mint, coreLo = red ? '#5E2C2A' : '#2C5E52', hot = red ? '#FFE8E0' : '#E8FFF8';
    R(g, 8, 10, 16, 31, brk ? '#1A1214' : (red ? '#3A1614' : '#0F2E29'));
    R(g, 12, 10, 8, 31, brk ? '#3A1A1A' : mix(coreLo, coreHi, (0.5 + 0.5 * pulse) * flick));
    R(g, 14, 10, 4, 31, brk ? '#5A2420' : mix(coreHi, hot, pulse * flick));
    if (!brk) for (i = 0; i < 4; i++) P(g, 10 + ((f * 3 + i * 5) % 12), 39 - ((f * 4 + i * 9) % 28), hot);
    R(g, 9, 11, 1, 29, 'rgba(255,255,255,0.35)');
    // Messingringe
    [10, 20, 30, 38].forEach(function (yy) { R(g, 6, yy, 20, 3, PAL.messing); R(g, 6, yy, 20, 1, '#F1D9A0'); R(g, 6, yy + 2, 20, 1, '#7A5A28'); P(g, 8, yy + 1, '#6E4E22'); P(g, 23, yy + 1, '#6E4E22'); });
    // Kuppel + Abluft
    ell(g, 16, 9, 11, 5, STEEL_D); ell(g, 16, 8, 10, 4, STEEL); ell(g, 13, 7, 4, 2, STEEL_L);
    R(g, 12, 1, 8, 5, STEEL_D); R(g, 12, 1, 2, 5, STEEL_L); R(g, 11, 0, 10, 2, PAL.messing);
    // Manometer
    ell(g, 28, 22, 3, 3, PAL.messing); ell(g, 28, 22, 2, 2, '#F4EEDC');
    var na = (brk ? 0.6 : -2.2 + (f % 4) * 0.12);
    line(g, 28, 22, 28 + Math.cos(na) * 2, 22 + Math.sin(na) * 2, PAL.alarmrot);
    if (dmg) { line(g, 9, 14, 12, 19, '#C8F5E6'); line(g, 12, 19, 10, 25, '#C8F5E6'); }
    if (brk) { line(g, 9, 13, 15, 22, '#2B1D1A'); line(g, 15, 22, 11, 34, '#2B1D1A'); line(g, 19, 14, 22, 27, '#2B1D1A'); R(g, 13, 23, 6, 4, M3C.aus); scorch(g, 71, 4, 8, 24, 32); }
    statusLamp(g, 3, 40, state, f);
    finish(c, PAL.outline, [16, 45, 14, 3]);
  }
  function buildShieldsM3(g, c, state, f) {
    var brk = state === 'broken', dmg = state === 'damaged', i, k;
    var flick = dmg ? [1, 0.5, 1, 0.3, 1, 0.8, 0.2, 1][f] : 1, pulse = 0.5 + 0.5 * Math.sin(f / 8 * Math.PI * 2);
    sysBase(g, 3, 26, 41);
    // Seitliche Kondensatoren
    [3, 25].forEach(function (x, s) {
      R(g, x, 20, 4, 21, s ? '#2E3946' : STEEL_D); R(g, x, 20, 4, 1, STEEL_L); R(g, x - 1, 19, 6, 2, PAL.messing);
      R(g, x + 1, 24, 2, 3, brk ? '#2E3A4A' : mix('#2E4A5A', PAL.eisblau, flick * (0.5 + 0.5 * pulse)));
    });
    // Sockeltrommel
    R(g, 7, 32, 18, 10, STEEL); R(g, 7, 32, 2, 10, STEEL_L); R(g, 23, 32, 2, 10, STEEL_D); R(g, 6, 31, 20, 2, PAL.messing); R(g, 6, 31, 20, 1, '#F1D9A0');
    // Spindel
    R(g, 15, 7, 3, 25, STEEL_D); R(g, 15, 7, 1, 25, STEEL_L);
    // drei Spulenringe mit umlaufenden Lichtpunkten
    for (k = 0; k < 3; k++) {
      var yy = 13 + k * 6, rx = 11 - k, lit = !brk && (!dmg || (f + k) % 3 !== 0);
      ell(g, 16, yy + 1, rx, 3, '#2E3946'); ell(g, 16, yy, rx, 2.6, lit ? '#4E7A8A' : '#2E3A4A'); ell(g, 16, yy, rx - 3, 1.2, '#1E2631');
      if (lit) for (i = 0; i < 6; i++) {
        var an = (k % 2 ? -1 : 1) * f / 8 * Math.PI * 2 + i / 6 * Math.PI * 2;
        P(g, 16 + Math.cos(an) * (rx - 0.5), yy + Math.sin(an) * 2.2, Math.sin(an) > 0 ? '#E8F8FF' : PAL.eisblau);
      }
    }
    // Kugel oben
    ell(g, 16, 5, 5, 5, brk ? '#1E2631' : '#2E4A5A');
    ell(g, 16, 5, 4, 4, brk ? '#2E3A4A' : mix('#4E7A8A', '#E8F8FF', (0.4 + 0.6 * pulse) * flick));
    if (!brk) P(g, 14, 3, '#FFFFFF');
    if (dmg) { line(g, 6, 14, 9, 18, '#C8F5E6'); }
    if (brk) { line(g, 13, 2, 17, 7, '#11161E'); line(g, 17, 7, 15, 9, '#11161E'); scorch(g, 83, 5, 10, 22, 30); }
    statusLamp(g, 26, 40, state, f);
    finish(c, PAL.outline, [16, 45, 13, 3]);
  }
  // Triebwerk am Heck: 44×48, Gehäuse rechts (x 12–43 = Kachel), Düsenglocke links ragt in die Heckwand
  function buildEnginesM3(g, c, state, f) {
    var brk = state === 'broken', dmg = state === 'damaged', i, ox = 12;
    var flick = dmg ? [1, 1, 0.4, 1, 0.7, 1, 0.2, 0.9][f] : 1, pulse = 0.5 + 0.5 * Math.sin(f / 8 * Math.PI * 2);
    var hot = brk ? 0.05 : (0.55 + 0.45 * pulse) * flick;
    // Düsenglocke
    poly(g, [0, 14, ox + 2, 21, ox + 2, 39, 0, 46], STEEL_D);
    poly(g, [0, 14, ox + 2, 21, ox + 2, 24, 0, 18], STEEL_L);
    poly(g, [0, 42, ox + 2, 36, ox + 2, 39, 0, 46], '#2E3946');
    ell(g, 2, 30, 3, 15, '#7A5A28'); ell(g, 2, 30, 2.2, 14, PAL.messing); ell(g, 2.6, 30, 1.6, 12, '#1E1A18');
    ell(g, 2.8, 30, 1, 9, mix('#3A2410', '#FF9A3C', hot));
    R(g, 6, 20, 2, 20, PAL.messing); R(g, 6, 20, 1, 20, '#F1D9A0');
    sysBase(g, ox + 1, 30, 41);
    // Gehäuse
    R(g, ox + 2, 12, 28, 30, STEEL); R(g, ox + 2, 12, 28, 2, STEEL_L); R(g, ox + 2, 12, 2, 30, STEEL_L); R(g, ox + 28, 12, 2, 30, STEEL_D);
    // Turbine
    var cx = ox + 16, cy = 27;
    ell(g, cx, cy, 11, 11, '#7A5A28'); ell(g, cx, cy, 10, 10, PAL.messing); ell(g, cx - 0.5, cy - 0.5, 9, 9, '#EAC786');
    ell(g, cx, cy, 8.5, 8.5, '#1E1A18');
    ell(g, cx, cy, 7, 7, mix('#3A2410', '#FF9A3C', hot)); ell(g, cx, cy, 4, 4, mix('#3A2410', PAL.funke, hot));
    var rot = brk ? 0 : (dmg ? Math.floor(f / 2) : f) * Math.PI / 8;
    for (i = 0; i < 6; i++) { var a = rot + i * Math.PI / 3; line(g, cx + Math.cos(a) * 2, cy + Math.sin(a) * 2, cx + Math.cos(a + 0.5) * 7.5, cy + Math.sin(a + 0.5) * 7.5, '#2E3946'); }
    ell(g, cx, cy, 2, 2, STEEL_L);
    // Treibstoffleitungen oben (Überstand)
    R(g, ox + 5, 3, 5, 10, STEEL_D); R(g, ox + 5, 3, 2, 10, STEEL_L); R(g, ox + 4, 2, 7, 2, PAL.messing);
    R(g, ox + 21, 5, 5, 8, STEEL_D); R(g, ox + 21, 5, 2, 8, STEEL_L); R(g, ox + 20, 4, 7, 2, PAL.messing);
    R(g, ox + 12, 7, 8, 3, PAL.terrakotta); R(g, ox + 12, 7, 8, 1, '#D77A5C');
    for (i = 0; i < 6; i++) { R(g, ox + 3 + i * 4, 15, 2, 2, i % 2 ? '#232A35' : M3C.besch); }
    if (dmg) { line(g, ox + 5, 30, ox + 9, 36, '#2B1D1A'); }
    if (brk) { line(g, cx - 6, cy - 4, cx + 3, cy + 5, '#11161E'); scorch(g, 97, ox + 3, 12, 26, 30); }
    statusLamp(g, ox + 26, 40, state, f);
    finish(c, PAL.outline, [ox + 14, 45, 16, 3]);
  }
  // Manövrierdüse: Ausrichtung nach side (Bb: Glocke nach oben in die Außenwand, Stb: Glocke zur Kamera/nach unten,
  // Bug/Heck: seitlich)
  function buildThruster(g, c, side, state, f) {
    var brk = state === 'broken', dmg = state === 'damaged', i;
    var flick = dmg ? [1, 0.3, 1, 1, 0.5, 1, 0.2, 0.8][f] : 1, pulse = 0.5 + 0.5 * Math.sin(f / 8 * Math.PI * 2);
    var hot = brk ? 0 : (0.45 + 0.55 * pulse) * flick, hotCol = mix('#3A2410', PAL.bernstein, hot), coreCol = mix('#3A2410', PAL.funke, hot);
    sysBase(g, 4, 24, 41);
    // Treibstoffleitungen
    R(g, 1, 30, 6, 3, PAL.terrakotta); R(g, 1, 30, 6, 1, '#D77A5C'); R(g, 25, 33, 6, 3, '#2E6E5C'); R(g, 25, 33, 6, 1, '#3E9C80');
    function tank(y0, y1) {
      R(g, 8, y0, 16, y1 - y0, STEEL); R(g, 8, y0, 3, y1 - y0, STEEL_L); R(g, 21, y0, 3, y1 - y0, STEEL_D);
      [y0 + 3, y1 - 5].forEach(function (yy) { R(g, 7, yy, 18, 2, PAL.messing); R(g, 7, yy, 18, 1, '#F1D9A0'); });
      ell(g, 16, y0 + Math.round((y1 - y0) / 2), 2.5, 2.5, PAL.messing); ell(g, 16, y0 + Math.round((y1 - y0) / 2), 1.6, 1.6, '#F4EEDC');
      P(g, 16, y0 + Math.round((y1 - y0) / 2) - 1, PAL.alarmrot);
    }
    if (side === 'stbd') {
      tank(6, 25);
      ell(g, 16, 6, 8, 3, STEEL_D); ell(g, 16, 5.5, 7, 2.2, STEEL_L);
      R(g, 6, 24, 20, 3, PAL.messing); R(g, 6, 24, 20, 1, '#F1D9A0');            // Kardanring
      ell(g, 16, 34, 10, 8, '#7A5A28'); ell(g, 16, 33.5, 9, 7, PAL.messing); ell(g, 15.5, 33, 8, 6, '#EAC786');
      ell(g, 16, 34, 7, 5.4, '#1E1A18'); ell(g, 16, 34, 5, 3.6, hotCol); ell(g, 16, 34, 2, 1.5, coreCol);
    } else if (side === 'bow' || side === 'aft') {
      var dr = side === 'aft' ? -1 : 1, nx = dr > 0 ? 20 : 2;
      tank(14, 40);
      poly(g, dr > 0 ? [22, 20, 31, 15, 31, 37, 22, 32] : [10, 20, 1, 15, 1, 37, 10, 32], STEEL_D);
      ell(g, dr > 0 ? 30 : 2, 26, 2.5, 11, PAL.messing); ell(g, dr > 0 ? 30 : 2, 26, 1.5, 9, '#1E1A18'); ell(g, dr > 0 ? 30 : 2, 26, 0.8, 6, hotCol);
      R(g, nx, 12, 10, 2, PAL.messing);
    } else {
      // Bb (Standard): Glocke nach oben, Öffnung nach oben
      poly(g, [6, 4, 26, 4, 20, 19, 12, 19], STEEL_D); poly(g, [6, 4, 10, 4, 13, 19, 12, 19], STEEL_L); poly(g, [22, 4, 26, 4, 20, 19, 19, 19], '#2E3946');
      ell(g, 16, 4, 10, 3, '#7A5A28'); ell(g, 16, 4, 9, 2.4, PAL.messing); ell(g, 16, 4.4, 7.5, 1.8, '#1E1A18'); ell(g, 16, 4.6, 5, 1.2, hotCol);
      R(g, 10, 18, 12, 3, PAL.messing); R(g, 10, 18, 12, 1, '#F1D9A0');
      tank(21, 41);
    }
    if (dmg) { line(g, 9, 30, 12, 36, '#2B1D1A'); P(g, 23, 28, '#2B1D1A'); }
    if (brk) scorch(g, 113 + side.length, 6, 4, 20, 36);
    statusLamp(g, 25, 40, state, f);
    finish(c, PAL.outline, [16, 45, 12, 3]);
  }
  // Batterie mit 4 Rohren (Bb: Rohre nach oben zur Außenwand, Stb: Rohre zur Kamera). Beschädigt: 2 Rohre dunkel.
  function buildBattery(g, c, side, state, f) {
    var brk = state === 'broken', dmg = state === 'damaged', i;
    var nDark = brk ? 4 : dmg ? 2 : 0;
    sysBase(g, 2, 28, 41);
    if (side !== 'stbd') {
      R(g, 3, 25, 26, 16, '#4A5568'); R(g, 3, 25, 26, 2, STEEL_L); R(g, 3, 25, 2, 16, STEEL_L); R(g, 27, 25, 2, 16, STEEL_D);
      for (i = 0; i < 4; i++) {
        var x = 5 + i * 6, dark = i >= 4 - nDark;
        R(g, x, 4, 4, 22, dark ? '#262B33' : '#5E6E80'); R(g, x, 4, 1, 22, dark ? '#343A44' : '#9FB2C4'); R(g, x + 3, 4, 1, 22, dark ? '#16191F' : STEEL_D);
        R(g, x - 1, 11, 6, 1, dark ? '#20242C' : STEEL_D); R(g, x - 1, 17, 6, 1, dark ? '#20242C' : STEEL_D);
        R(g, x - 1, 2, 6, 3, dark ? '#4A3E26' : PAL.messing); R(g, x - 1, 2, 6, 1, dark ? '#5A4A2A' : '#F1D9A0'); R(g, x + 1, 2, 2, 1, '#11161E');
        var lit = !dark && ((f + i * 2) % 8) < 5;
        R(g, x, 29, 4, 3, '#1E2631'); R(g, x + 1, 30, 2, 1, lit ? PAL.bernstein : (dark ? '#2A1A14' : '#5A4018'));
        if (lit) P(g, x + 1, 29, PAL.funke);
        if (dark) { P(g, x, 5, '#0E0C0C'); P(g, x + 2, 6, '#0E0C0C'); P(g, x + 1, 8, 'rgba(20,14,12,0.7)'); R(g, x + 1, 30, 2, 1, dmg && !brk ? '#3A1614' : '#2A1A14'); }
      }
      // Munitionszuführung
      R(g, 4, 34, 24, 4, '#7A5A28'); R(g, 4, 34, 24, 1, PAL.messing);
      for (i = 0; i < 8; i++) { R(g, 5 + i * 3, 35, 2, 2, (i >= 8 - nDark * 2) ? '#5A4A2A' : '#E3B565'); P(g, 5 + i * 3, 35, '#F1D9A0'); }
    } else {
      R(g, 3, 9, 26, 19, '#4A5568'); R(g, 3, 9, 26, 5, '#6C7F96'); R(g, 3, 9, 26, 1, '#9FB2C4'); R(g, 3, 9, 2, 19, STEEL_L); R(g, 27, 9, 2, 19, STEEL_D);
      R(g, 4, 19, 24, 4, '#7A5A28'); R(g, 4, 19, 24, 1, PAL.messing);
      for (var k = 0; k < 8; k++) { R(g, 5 + k * 3, 20, 2, 2, (k >= 8 - nDark * 2) ? '#5A4A2A' : '#E3B565'); P(g, 5 + k * 3, 20, '#F1D9A0'); }
      for (i = 0; i < 4; i++) {
        var x2 = 5 + i * 6, dark2 = i >= 4 - nDark;
        R(g, x2, 27, 4, 8, dark2 ? '#262B33' : '#5E6E80'); R(g, x2, 27, 1, 8, dark2 ? '#343A44' : '#9FB2C4'); R(g, x2 + 3, 27, 1, 8, dark2 ? '#16191F' : STEEL_D);
        ell(g, x2 + 2, 37, 3, 3, dark2 ? '#4A3E26' : PAL.messing); ell(g, x2 + 1.6, 36.6, 2.2, 2.2, dark2 ? '#5A4A2A' : '#EAC786');
        ell(g, x2 + 2, 37, 1.6, 1.6, '#11161E');
        var lit2 = !dark2 && ((f + i * 2) % 8) < 5;
        R(g, x2 + 1, 11, 2, 2, lit2 ? PAL.bernstein : (dark2 ? '#2A1A14' : '#5A4018'));
        if (lit2) P(g, x2 + 1, 11, PAL.funke);
        if (dark2) { P(g, x2 + 1, 39, '#0E0C0C'); P(g, x2 + 3, 35, 'rgba(20,14,12,0.7)'); }
      }
    }
    if (brk) scorch(g, 131 + side.length, 3, 4, 26, 34);
    statusLamp(g, 26, 41, state, f);
    finish(c, PAL.outline, [16, 45, 14, 3]);
  }
  // Emitter-Spule: Wicklung und Kopf in der Farbe der Seite, Schüssel zeigt nach außen
  function buildEmitter(g, c, side, state, f) {
    var brk = state === 'broken', dmg = state === 'damaged', k;
    var sc = SIDE_COL[side] || PAL.mint;
    var flick = dmg ? [1, 0.4, 1, 0.8, 0.2, 1, 0.6, 1][f] : 1, pulse = 0.5 + 0.5 * Math.sin(f / 8 * Math.PI * 2);
    var on = brk ? 0 : flick;
    sysBase(g, 5, 22, 41);
    R(g, 7, 38, 18, 4, STEEL_D); R(g, 7, 38, 18, 1, STEEL_L);
    // Säule mit Wicklung (Lauflicht nach oben)
    R(g, 11, 16, 10, 23, STEEL_D); R(g, 11, 16, 2, 23, STEEL_L);
    for (k = 0; k < 6; k++) {
      var yy = 35 - k * 4, lit = !brk && ((k - f + 16) % 6) < 2;
      var cc = lit ? mix(shade(sc, -0.35), sc, on) : '#9A5A2A';
      R(g, 9, yy, 14, 2, cc); R(g, 9, yy, 14, 1, lit ? shade(sc, 0.45) : '#C8873A'); P(g, 9, yy + 1, '#5A3418'); P(g, 22, yy + 1, '#5A3418');
    }
    var head = brk ? '#2E3A4A' : mix(shade(sc, -0.6), sc, (0.45 + 0.55 * pulse) * on);
    var hi = brk ? '#3A4759' : mix(sc, '#FFFFFF', 0.5 * on);
    if (side === 'stbd') {   // Schüssel zur Kamera
      R(g, 13, 14, 6, 4, STEEL);
      ell(g, 16, 10, 10, 9, '#7A5A28'); ell(g, 15.6, 9.6, 9, 8, PAL.messing); ell(g, 16, 10, 7, 6, '#1E2631');
      ell(g, 16, 10, 3.5, 3, head); P(g, 15, 9, hi);
      for (k = 0; k < 4; k++) { var an = k * Math.PI / 2 + 0.785; line(g, 16 + Math.cos(an) * 4, 10 + Math.sin(an) * 3.5, 16 + Math.cos(an) * 6.5, 10 + Math.sin(an) * 5.5, STEEL_L); }
    } else if (side === 'bow' || side === 'aft') {   // Schüssel im Profil, nach rechts (Bug) / links (Heck)
      var dr = side === 'aft' ? -1 : 1, hx = 16 + dr * 5;
      R(g, 12, 9, 8, 8, STEEL); R(g, 12, 9, 8, 1, STEEL_L);
      ell(g, hx, 11, 3.2, 10, '#7A5A28'); ell(g, hx - dr * 0.4, 11, 2.4, 9, PAL.messing); ell(g, hx + dr * 0.8, 11, 1.4, 7, '#1E2631');
      R(g, dr > 0 ? hx + 1 : hx - 7, 10, 7, 2, STEEL_L);
      ell(g, dr > 0 ? hx + 8 : hx - 8, 11, 2, 2, head); P(g, dr > 0 ? hx + 8 : hx - 8, 10, hi);
    } else {   // Bb/Mitte: Schüssel nach oben
      R(g, 14, 8, 4, 9, STEEL); R(g, 14, 8, 1, 9, STEEL_L);
      ell(g, 16, 8, 11, 4, '#7A5A28'); ell(g, 16, 7.5, 10, 3.2, PAL.messing); ell(g, 16, 7.6, 8, 2.4, '#1E2631');
      ell(g, 16, 7.6, 4, 1.3, head);
      R(g, 15, 0, 2, 7, STEEL_L); ell(g, 16, 1, 1.6, 1.6, head); P(g, 15, 0, hi);
    }
    // Seitenlampe am Sockel
    R(g, 8, 39, 3, 2, brk ? '#2E3A4A' : sc); P(g, 8, 39, brk ? '#3A4759' : shade(sc, 0.5));
    if (dmg) { line(g, 12, 22, 15, 27, '#2B1D1A'); }
    if (brk) scorch(g, 151 + side.length, 6, 6, 20, 32);
    statusLamp(g, 24, 39, state, f);
    finish(c, PAL.outline, [16, 45, 12, 3]);
  }
  // Lanzenkammer (Bug-Waffe): liegender Zylinder Richtung Bug (+x), Ladekondensatoren oben
  function buildWeaponBow(g, c, state, f) {
    var brk = state === 'broken', dmg = state === 'damaged', i;
    var flick = dmg ? [1, 1, 0.3, 1, 0.6, 1, 0.2, 1][f] : 1, pulse = 0.5 + 0.5 * Math.sin(f / 8 * Math.PI * 2);
    sysBase(g, 1, 30, 41);
    R(g, 4, 30, 6, 11, STEEL_D); R(g, 4, 30, 1, 11, STEEL_L); R(g, 22, 30, 6, 11, STEEL_D); R(g, 22, 30, 1, 11, STEEL_L);
    // Ladekondensatoren (Überstand)
    for (i = 0; i < 4; i++) {
      R(g, 4 + i * 6, 3, 5, 12, '#1E2631'); R(g, 3 + i * 6, 2, 7, 2, PAL.messing); R(g, 3 + i * 6, 2, 7, 1, '#F1D9A0');
      var lv = brk ? 0 : Math.min(1, ((f + i * 2) % 8) / 6) * flick, hh = Math.round(9 * lv);
      if (hh > 0) { R(g, 5 + i * 6, 14 - hh, 3, hh, PAL.mint); R(g, 5 + i * 6, 14 - hh, 1, hh, '#E8FFF8'); }
    }
    // Kammer
    R(g, 1, 14, 29, 17, '#4A5568'); R(g, 1, 14, 29, 4, '#6C7F96'); R(g, 1, 14, 29, 1, '#9FB2C4'); R(g, 1, 29, 29, 2, '#2E3946');
    R(g, 3, 20, 24, 5, brk ? '#1A1214' : '#0F2E29');
    R(g, 3, 21, 24, 3, brk ? '#2A1A1A' : mix('#2C5E52', PAL.mint, (0.4 + 0.6 * pulse) * flick));
    if (!brk) { var p0 = 3 + ((f * 3) % 22); R(g, p0, 21, 3, 3, '#E8FFF8'); }
    [7, 14, 21].forEach(function (x) { R(g, x, 13, 3, 19, PAL.messing); R(g, x, 13, 1, 19, '#F1D9A0'); R(g, x + 2, 13, 1, 19, '#7A5A28'); });
    // Mündung mit Linse (Richtung Bug)
    R(g, 27, 15, 5, 15, STEEL_D); R(g, 27, 15, 5, 1, STEEL_L);
    ell(g, 30, 22, 2, 5, brk ? '#2E3A4A' : mix('#2C5E52', '#E8F8FF', pulse * flick)); P(g, 30, 19, brk ? '#3A4759' : '#FFFFFF');
    for (i = 3; i < 27; i += 4) { R(g, i, 33, 2, 2, M3C.besch); R(g, i + 2, 33, 2, 2, '#232A35'); }
    if (dmg) { line(g, 4, 21, 9, 24, '#C8F5E6'); }
    if (brk) { line(g, 5, 20, 12, 25, '#11161E'); line(g, 16, 20, 20, 25, '#11161E'); scorch(g, 171, 2, 6, 28, 30); }
    statusLamp(g, 12, 37, state, f);
    finish(c, PAL.outline, [16, 45, 15, 3]);
  }
  var M3_SYS = { sys_reactor: 1, sys_shields: 1, sys_engines: 1, sys_thruster: 1, sys_battery: 1, sys_emitter: 1, sys_weapon_bow: 1 };
  var M3_GLOW = { sys_reactor: PAL.mint, sys_shields: PAL.eisblau, sys_engines: '#FF9A3C', sys_thruster: PAL.bernstein, sys_battery: PAL.bernstein, sys_weapon_bow: PAL.mint };
  // Zustandsdekor über einem Stationssprite: maskiertes Muster, Effekte, Kürzel, optional Plakette
  function stationDecor(ctx, spr, key, px, py, o, kind, side, state, fragile, bx) {
    var t = o.time || 0;
    var ov = stateOverlay(spr, key, state, fragile, bx);
    var x0 = px - (bx || 0);
    if (ov) ctx.drawImage(ov, x0, py - OH);
    if (state === 'damaged') {
      var cyc = (t * 0.9 + px * 0.013) % 1.6;
      if (cyc < 0.45) drawFx(ctx, 'sparks', px + 9 + ((t * 3 | 0) % 3) * 6, py + 4 - ((t * 5 | 0) % 2) * 6, cyc, { small: true });
      drawFx(ctx, 'smoke', px + 20, py - 8, t, { small: true });
    } else if (state === 'broken') {
      drawFx(ctx, 'smoke', px + 16, py - 14, t, {});
      drawFx(ctx, 'fire', px + 16, py + 6, t, { small: true });
    } else if (state === 'offline') {
      for (var i = 0; i < 4; i++) {
        var a = hash2(i, (t * 8) | 0, 31) * Math.PI * 2, rr = 6 + hash2(i, (t * 8) | 0, 32) * 10;
        ctx.fillStyle = i % 2 ? '#E8F8FF' : M3C.emp;
        ctx.fillRect(Math.round(px + 16 + Math.cos(a) * rr), Math.round(py - 2 + Math.sin(a) * rr), 1, 1);
      }
    }
    var code = stateCode(state, fragile);
    // Kürzel-Marke über der Station nur auf Wunsch (opts.tag = true|'auto': nicht bei ok, 'always': immer) –
    // der Client beschriftet die Stationen selbst (Seitenmarke + Zustand), sonst doppelt.
    if (o.tag && (code !== 'ok' || o.tag === 'always')) {
      var bob = code === 'aus' && ((t * 2) | 0) % 2 === 0 ? -1 : 0;
      drawStateTag(ctx, state, px + 16, py - OH - 10 + bob, { fragile: fragile });
    }
    if (o.badge) drawStationBadge(ctx, side, px + 16, py + 23, null);
  }
  function drawSystemM3(ctx, kind, px, py, o) {
    var state = normState(o.state), fragile = !!o.fragile && state !== 'broken', side = sideOf(kind, o);
    var t = o.time || 0, sprState = state === 'offline' ? 'ok' : state;
    var f = state === 'broken' || state === 'offline' ? 0 : frameOf(t + (px & 63) * 0.011, state === 'ok' ? 8 : 6, 8);
    var red = kind === 'sys_reactor' && o.alert === 'red';
    var wide = kind === 'sys_engines', bx = wide ? 12 : 0;
    var key = 'm3|' + kind + '|' + side + '|' + sprState + '|' + f + (red ? '|r' : '');
    var spr = cached(key, wide ? 44 : 32, 48, function (g, c) {
      if (kind === 'sys_reactor') buildReactorM3(g, c, sprState, f, red);
      else if (kind === 'sys_shields') buildShieldsM3(g, c, sprState, f);
      else if (kind === 'sys_engines') buildEnginesM3(g, c, sprState, f);
      else if (kind === 'sys_thruster') buildThruster(g, c, side, sprState, f);
      else if (kind === 'sys_battery') buildBattery(g, c, side, sprState, f);
      else if (kind === 'sys_emitter') buildEmitter(g, c, side, sprState, f);
      else buildWeaponBow(g, c, sprState, f);
    });
    // Glühen hinter/unter der Station
    var gc = kind === 'sys_emitter' ? SIDE_COL[side] : M3_GLOW[kind];
    if (state === 'ok' || state === 'damaged') {
      var ga = state === 'ok' ? 0.2 : 0.1 * (1 + Math.sin(t * 17));
      glow(ctx, px + 16, py + 10, gc, 18, ga);
    }
    ctx.drawImage(spr, px - bx, py - OH);
    if (state !== 'broken' && state !== 'offline') {
      var pr = 0.5 + 0.5 * Math.sin(t * 2.6);
      if (kind === 'sys_reactor') glow(ctx, px + 16, py - OH + 25, red ? '#FF6A4C' : PAL.mint, 18 + Math.round(pr * 8), (state === 'ok' ? 0.22 : 0.1) + 0.18 * pr);
      else if (kind === 'sys_shields') glow(ctx, px + 16, py - OH + 6, '#E8F8FF', 9, 0.25 + 0.2 * pr);
      else if (kind === 'sys_emitter') glow(ctx, px + 16, py - OH + 9, gc, 9, 0.3 + 0.25 * pr);
      else if (kind === 'sys_engines') { glow(ctx, px + 16, py - OH + 27, '#FF9A3C', 12, 0.25 + 0.15 * pr); glow(ctx, px - 9, py - OH + 30, PAL.bernstein, 12, 0.3 + 0.2 * pr); }
      else if (kind === 'sys_weapon_bow') glow(ctx, px + 30, py - OH + 22, PAL.mint, 8, 0.3 + 0.25 * pr);
      else if (kind === 'sys_thruster') glow(ctx, px + 16, py - OH + (side === 'stbd' ? 34 : 6), PAL.bernstein, 8, 0.2 + 0.2 * pr);
    }
    stationDecor(ctx, spr, key, px, py, o, kind, side, state, fragile, bx);
  }
  // Alte Stationen (Lebenserhaltung, Transfer, Altname Waffen) bekommen dieselbe Zustandsdekoration
  function drawSystemLegacy(ctx, kind, px, py, o) {
    var res = drawSystem(ctx, kind, px, py, o);
    var state = normState(o.state);
    if (res && res.spr) stationDecor(ctx, res.spr, res.key, px, py, o, kind, sideOf(kind, o), state, !!o.fragile && state !== 'broken', 0, true);
  }

  // --- Geschützdeck (Batteriedecks): Gitterboden mit rotem Gefechtslicht + Bodendeko --------------
  function isGunDeck(room) { return !!room && typeof room.id === 'string' && room.id.indexOf('batterie') === 0; }
  function floorGunDeck(g, v) {
    R(g, 0, 0, 32, 32, '#13161D');
    R(g, 0, 0, 32, 32, 'rgba(224,71,60,0.07)');
    if (v === 0) { R(g, 0, 18, 32, 5, '#3A2A22'); R(g, 0, 18, 32, 1, '#6E3A28'); }
    if (v === 2) { R(g, 9, 0, 4, 32, '#232B36'); R(g, 9, 0, 1, 32, '#3A4759'); }
    // Rautengitter
    var bar = '#4A5568', hi = '#64738A', lo = '#262E3A';
    for (var y = 0; y < 32; y += 4) for (var x = 0; x < 32; x += 4) { var o = ((y >> 2) & 1) * 2; R(g, x + o, y, 2, 1, bar); P(g, x + o, y, hi); P(g, x + o + 1, y + 1, lo); }
    // Rahmen + Eckbolzen in Messing
    R(g, 0, 0, 32, 1, hi); R(g, 0, 0, 1, 32, hi); R(g, 31, 0, 1, 32, lo); R(g, 0, 31, 32, 1, lo);
    P(g, 2, 2, PAL.messing); P(g, 29, 2, PAL.messing); P(g, 2, 29, '#7A5A28'); P(g, 29, 29, '#7A5A28');
  }
  // Layout relativ zur oberen linken Raumkachel. Für das Stb-Deck wird die Zeile gespiegelt (Station unten).
  var GUNDECK_DECALS = { '0,1': 'rail_e', '1,1': 'rail', '2,1': 'rail', '3,1': 'rail', '4,1': 'rail', '5,1': 'rail', '6,1': 'rail', '7,1': 'rail_w',
    '0,2': 'ammo', '1,2': 'ammo_open', '3,2': 'shells', '6,2': 'ammo_open', '7,2': 'ammo' };
  function gunDeckDetail(ctx, px, py, tx, ty, t, room) {
    var stb = room.id.indexOf('stb') >= 0;
    var dy = stb ? room.y1 - ty : ty - room.y0, dx = tx - room.x0;
    var dec = GUNDECK_DECALS[dx + ',' + dy];
    if (dec) ctx.drawImage(gunDecalSprite(dec, stb), px, py);
    // rotes Gefechtslicht, leise pulsierend
    if (dy === 1 && dx % 3 === 1) glow(ctx, px + 16, py + 16, PAL.alarmrot, 14, 0.08 + 0.05 * Math.sin(t * 2 + dx));
  }
  function gunDecalSprite(kind, flip) {
    return cached('gundecal|' + kind + '|' + (+flip), 32, 32, function (g) {
      var i;
      if (kind.indexOf('rail') === 0) {   // Munitionsschiene (Messing) mit Schwellen
        var x0 = kind === 'rail_e' ? 10 : 0, x1 = kind === 'rail_w' ? 22 : 32;
        for (i = x0 + 2; i < x1; i += 6) R(g, i, 12, 2, 9, '#2E3946');
        R(g, x0, 13, x1 - x0, 2, PAL.messing); R(g, x0, 13, x1 - x0, 1, '#F1D9A0');
        R(g, x0, 18, x1 - x0, 2, PAL.messing); R(g, x0, 18, x1 - x0, 1, '#F1D9A0');
        if (kind !== 'rail') { var ex = kind === 'rail_e' ? x0 : x1 - 3; R(g, ex, 11, 3, 11, '#7A5A28'); R(g, ex, 11, 3, 1, PAL.messing); }
        // ein Geschoss auf der Schiene
        if (kind === 'rail') { R(g, 12, 14, 7, 4, '#C9974A'); R(g, 12, 14, 7, 1, '#F1D9A0'); R(g, 19, 14, 2, 4, PAL.alarmrot); }
      } else if (kind === 'ammo' || kind === 'ammo_open') {   // flache Munitionskiste (Bodendeko)
        var y0 = flip ? 6 : 8;
        R(g, 5, y0 + 2, 22, 16, 'rgba(11,14,26,0.45)');
        R(g, 4, y0, 22, 15, '#4E5A34'); R(g, 4, y0, 22, 1, '#6E7C48'); R(g, 4, y0 + 14, 22, 1, '#2E361E'); R(g, 4, y0, 1, 15, '#6E7C48'); R(g, 25, y0, 1, 15, '#2E361E');
        if (kind === 'ammo_open') {
          R(g, 6, y0 + 2, 18, 11, '#2A2E1E');
          for (i = 0; i < 6; i++) { var sx = 7 + i * 3; R(g, sx, y0 + 3, 2, 9, '#B8862E'); R(g, sx, y0 + 3, 2, 2, PAL.alarmrot); P(g, sx, y0 + 5, '#F1D9A0'); }
        } else {
          R(g, 4, y0 + 6, 22, 2, '#3A4428'); R(g, 7, y0 + 3, 7, 2, M3C.besch); R(g, 16, y0 + 3, 2, 2, M3C.besch);
          R(g, 5, y0 + 1, 2, 2, PAL.messing); R(g, 23, y0 + 1, 2, 2, PAL.messing); R(g, 5, y0 + 12, 2, 2, PAL.messing); R(g, 23, y0 + 12, 2, 2, PAL.messing);
        }
      } else if (kind === 'shells') {   // lose Hülsen
        var r = rng(77);
        for (i = 0; i < 5; i++) { var hx = 6 + r() * 18, hy = 8 + r() * 14; R(g, hx, hy, 5, 2, '#B8862E'); P(g, hx, hy, '#F1D9A0'); P(g, hx + 4, hy + 1, '#6E4E22'); }
      }
    });
  }

  // --- Maschinenräume: Kabeltrassen je Raum (Maske N/E/S/W) und Bodendeko -------------------------
  var ENGINE_LAYOUT = {
    antrieb: {
      cables: { '0,2': 'NS', '0,3': 'NS', '0,4': 'NS', '1,5': 'EW', '2,5': 'EW' },
      decals: { '1,0': 'toolbox', '2,1': 'bolts', '1,2': 'oil', '2,3': 'vent', '2,4': 'hazard', '2,6': 'hazard', '0,7': 'drip', '1,8': 'coil', '2,8': 'parts', '0,9': 'bucket', '1,10': 'bolts' },
    },
    maschinenraum: {
      cables: {
        '0,1': 'NS', '0,2': 'NS', '0,3': 'NS', '0,4': 'NS', '0,5': 'NEW', '1,5': 'EW', '2,5': 'NESW', '3,5': 'EW', '4,5': 'ESW',
        '2,3': 'NS', '2,4': 'NS', '2,6': 'NS', '2,7': 'NS', '4,6': 'NS', '4,7': 'NS', '4,8': 'NS', '4,9': 'NS',
      },
      trunk: { '2,3': 1, '2,4': 2, '2,5': 3, '2,6': 4, '2,7': 5 },
      decals: {
        '1,0': 'toolbox', '2,0': 'vent', '1,2': 'hazardW', '3,2': 'hazardE', '1,3': 'oil', '3,3': 'bolts', '1,7': 'coil', '3,7': 'parts',
        '1,8': 'hazardW', '3,8': 'hazardE', '1,9': 'bucket', '3,9': 'vent', '2,10': 'drip',
      },
    },
  };
  function cableMaskSprite(mask) {
    return cached('ecablem|' + mask, 32, 32, function (g) {
      var cols = [PAL.terrakotta, '#2E6E5C', PAL.messing];
      var N = mask.indexOf('N') >= 0, E = mask.indexOf('E') >= 0, S = mask.indexOf('S') >= 0, W = mask.indexOf('W') >= 0, j;
      if (E || W) {
        var x0 = W ? 0 : 12, x1 = E ? 32 : 19;
        R(g, x0, 21, x1 - x0, 7, 'rgba(11,14,26,0.55)'); R(g, x0, 21, x1 - x0, 1, '#5E6E80');
        for (j = 0; j < 3; j++) R(g, x0, 22 + j * 2, x1 - x0, 1, cols[j]);
        for (var x = x0 + 3; x < x1; x += 10) R(g, x, 21, 2, 7, STEEL_D);
      }
      if (N || S) {
        var y0 = N ? 0 : 21, y1 = S ? 32 : 28;
        R(g, 12, y0, 7, y1 - y0, 'rgba(11,14,26,0.55)'); R(g, 12, y0, 1, y1 - y0, '#5E6E80');
        for (j = 0; j < 3; j++) R(g, 13 + j * 2, y0, 1, y1 - y0, cols[j]);
        for (var yy = y0 + 4; yy < y1; yy += 10) R(g, 12, yy, 7, 2, STEEL_D);
      }
      if ((N || S) && (E || W)) { R(g, 11, 20, 9, 9, '#2E3946'); R(g, 11, 20, 9, 1, STEEL_L); R(g, 13, 22, 5, 5, '#1E2631'); P(g, 15, 24, PAL.mint); }
    });
  }
  var LEGACY_CABLE = { h: 'EW', v: 'NS', hn: 'NEW', hs: 'ESW' };
  function engineFloorDetailM3(ctx, px, py, tx, ty, t, room) {
    var lay = ENGINE_LAYOUT[room.id];
    if (!lay) return false;
    var key = (tx - room.x0) + ',' + (ty - room.y0);
    var v = (hash2(tx, ty, 7) * 4) | 0;
    if (v === 1) glow(ctx, px + 10, py + 12, PAL.bernstein, 12, 0.10 + 0.08 * (0.5 + 0.5 * Math.sin(t * 1.7 + tx * 1.3 + ty * 0.7)));
    var cab = lay.cables[key];
    if (cab) ctx.drawImage(cableMaskSprite(cab), px, py);
    var dec = lay.decals[key];
    if (dec) ctx.drawImage(dec === 'hazardW' ? hazardWSprite() : decalSprite(dec), px, py);
    // Energiestamm Reaktor -> Schildgenerator: Lichtpuls läuft durch die Leitung
    var tr = lay.trunk && lay.trunk[key];
    if (tr) {
      var ph = (t * 1.6 - tr * 0.22) % 1; if (ph < 0) ph += 1;
      glow(ctx, px + 16, py + 6 + ph * 22, PAL.mint, 8, 0.35 * (1 - Math.abs(ph - 0.5) * 2) + 0.06);
    }
    return true;
  }
  function hazardWSprite() {
    return cached('edecal|hazardW', 32, 32, function (g) { for (var e = 0; e < 32; e += 4) { R(g, 29, e, 3, 2, PAL.warngelb); R(g, 29, e + 2, 3, 2, '#232A35'); } });
  }

  // --- Außenansicht: Schäden an den Systemen ----------------------------------------------------
  // lokale Lage (px, Bug +x, Backbord -y) im Schiffssprite
  var SYS_EXT = {
    reactor: [-6, -2], shields: [2, 2], life: [-12, 3], transfer: [-13, -3], engines: [-31, 0], emitter_aft: [-25, -5],
    thruster_port: [-16, -17], thruster_stbd: [-16, 17], battery_port: [7, -11], battery_stbd: [7, 11],
    emitter_port: [-1, -8], emitter_stbd: [-1, 8], weapon_bow: [36, 0], emitter_bow: [24, 4],
  };
  function fragileSet(fr) {
    var out = {};
    if (Array.isArray(fr)) for (var i = 0; i < fr.length; i++) out[fr[i]] = true;
    else if (fr && typeof fr === 'object') for (var k in fr) if (fr[k]) out[k] = true;
    return out;
  }
  function drawShipDamage(ctx, W, bang, o, t) {
    var sys = o.systems;
    if (!sys || typeof sys !== 'object') return;
    var fr = fragileSet(o.fragile);
    var bx = -Math.cos(bang), by = -Math.sin(bang);   // Rauch treibt nach achtern
    var ga = ctx.globalAlpha, k = 0;
    for (var id in SYS_EXT) {
      var st = sys[id];
      k++;
      if (st !== 'damaged' && st !== 'broken') { if (fr[id]) { var pf = W(SYS_EXT[id][0], SYS_EXT[id][1]); if (((t * 1.5 + k) | 0) % 3 === 0) { ctx.fillStyle = M3C.flick; ctx.fillRect(Math.round(pf[0]), Math.round(pf[1]), 1, 1); } } continue; }
      var p = W(SYS_EXT[id][0], SYS_EXT[id][1]), brk = st === 'broken';
      var n = brk ? 7 : 4, len = brk ? 26 : 14;
      for (var i = 0; i < n; i++) {
        var q = (t * (brk ? 0.9 : 0.7) + i / n + k * 0.13) % 1;
        var sx = p[0] + bx * q * len + Math.sin(q * 6 + i + k) * 1.5 * -by, sy = p[1] + by * q * len + Math.sin(q * 6 + i + k) * 1.5 * bx;
        ctx.globalAlpha = ga * (1 - q) * (brk ? 0.85 : 0.65);
        var ps = puffSprite((brk ? 2 : 1.5) + q * (brk ? 3.5 : 2.5), q < 0.25 && brk ? '#8A8290' : '#7A7480');
        ctx.drawImage(ps, Math.round(sx - ps.width / 2), Math.round(sy - ps.height / 2));
      }
      ctx.globalAlpha = ga;
      if (brk) {
        glow(ctx, p[0], p[1], '#F08A3C', 9, 0.6 + 0.3 * Math.sin(t * 13 + k));
        ctx.fillStyle = ((t * 6 + k) | 0) % 2 ? PAL.bernstein : '#F08A3C'; ctx.fillRect(Math.round(p[0]) - 1, Math.round(p[1]), 2, 1);
        if (((t * 2 + k * 0.3) | 0) % 2 === 0) { ctx.fillStyle = M3C.aus; ctx.fillRect(Math.round(p[0]), Math.round(p[1]) - 1, 1, 1); }
      } else glow(ctx, p[0], p[1], M3C.besch, 5, 0.3 + 0.3 * Math.sin(t * 9 + k));
      var cyc = (t * (brk ? 1.3 : 0.9) + k * 0.37) % 1.1;
      if (cyc < 0.4) drawFx(ctx, 'sparks', p[0], p[1], cyc, { small: true, seed: k });
    }
  }

  // --- Schildstoß (Captain): weißer Sektorbogen, perfekt mit Ring --------------------------------
  // drawBurst(ctx, cx, cy, opts): opts.angle (Schiffswinkel in Bildschirmkoordinaten), opts.sector 0..3, opts.r (46),
  // opts.age (s seit Start) ODER opts.left (Restdauer), opts.duration (1.5), opts.perfect (bool), opts.perfectAge (s seit perfektem Treffer),
  // opts.perfectWindow (0.5), opts.time
  function arcDots(ctx, cx, cy, r, a0, a1, step) {
    var n = Math.max(2, Math.ceil(Math.abs(a1 - a0) * r / (step || 1)));
    for (var i = 0; i <= n; i++) { var a = a0 + (a1 - a0) * i / n; ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1); }
  }
  function drawBurst(ctx, cx, cy, opts) {
    var o = opts || {};
    var dur = o.duration > 0 ? o.duration : 1.5;
    var age = o.age != null ? +o.age : (o.left != null ? dur - (+o.left) : 0);
    if (!(age >= 0) || age > dur) return;
    var r = o.r > 0 ? o.r : 46, sec = ((o.sector | 0) % 4 + 4) % 4, t = o.time || 0;
    var mid = (o.angle || 0) + sec * Math.PI / 2, half = Math.PI / 4 - 0.06;
    var pw = o.perfectWindow > 0 ? o.perfectWindow : 0.5;
    var q = age / dur, a = age < 0.08 ? age / 0.08 : 1 - Math.max(0, (age - pw) / (dur - pw)) * 0.8;
    var ga = ctx.globalAlpha, op = ctx.globalCompositeOperation;
    var thick = age < pw ? 4 : 2, flare = age < pw ? 0.75 + 0.25 * Math.sin(t * 30) : 1;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = M3C.burst;
    for (var k = 0; k < thick; k++) { ctx.globalAlpha = ga * a * flare * (k === 0 ? 1 : 0.7 - k * 0.12); arcDots(ctx, cx, cy, r + 2 + k, mid - half, mid + half, 1); }
    // äußere Kante bläulich, Funken auf dem Bogen
    ctx.fillStyle = PAL.eisblau; ctx.globalAlpha = ga * a * 0.5; arcDots(ctx, cx, cy, r + 2 + thick, mid - half * 0.9, mid + half * 0.9, 2);
    ctx.fillStyle = '#FFFFFF';
    for (var s = 0; s < 6; s++) { var sa = mid - half + (hash2(s, (t * 12) | 0, 41)) * half * 2; ctx.globalAlpha = ga * a; ctx.fillRect(Math.round(cx + Math.cos(sa) * (r + 3)), Math.round(cy + Math.sin(sa) * (r + 3)), 1, 1); }
    ctx.globalAlpha = ga; ctx.globalCompositeOperation = op;
    glow(ctx, cx + Math.cos(mid) * (r + 3), cy + Math.sin(mid) * (r + 3), M3C.burst, 14, a * 0.5 * (1 - q * 0.5));
    if (o.perfect) {
      var pa = o.perfectAge != null ? +o.perfectAge : age;
      if (pa >= 0 && pa < 0.7) {
        var pq = pa / 0.7, rr = r + 4 + pq * 26;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = M3C.burst; ctx.globalAlpha = ga * (1 - pq);
        arcDots(ctx, cx, cy, rr, 0, Math.PI * 2, 1.5); arcDots(ctx, cx, cy, rr - 1, 0, Math.PI * 2, 3);
        ctx.fillStyle = PAL.mint; ctx.globalAlpha = ga * (1 - pq) * 0.7; arcDots(ctx, cx, cy, rr * 0.82, mid - half, mid + half, 1);
        // Sternfunkeln am Sektor
        ctx.fillStyle = '#FFFFFF'; ctx.globalAlpha = ga * (1 - pq);
        var px = Math.round(cx + Math.cos(mid) * (r + 4)), py = Math.round(cy + Math.sin(mid) * (r + 4)), L = Math.round(3 + (1 - pq) * 5);
        ctx.fillRect(px - L, py, L * 2 + 1, 1); ctx.fillRect(px, py - L, 1, L * 2 + 1);
        ctx.globalAlpha = ga; ctx.globalCompositeOperation = op;
        glow(ctx, px, py, '#FFFFFF', 12, 1 - pq);
      }
    }
  }

  // --- Ladeglühen an Gegnern (tele): pulsierend, rot gestrichelt, Fortschrittsbogen ---------------
  // drawTele(ctx, x, y, opts): opts.left, opts.dur (Restzeit/Gesamtdauer der Ladung), opts.kind ('shot'|'emp'),
  // opts.r (Radius, Standard 20), opts.time, optional opts.toX/opts.toY (gestrichelte Linie zum Ziel), opts.lineLen (max. Länge)
  var TELE_R = { raider: 14, gunboat: 26, sentinel: 24, pylon: 20 };
  // rotes Glühen ÜBER dem Gegnersprite (der Gegner selbst „lädt sich auf“)
  function teleGlowOver(ctx, kind, x, y, o) {
    var te = o && o.tele;
    if (!te || typeof te !== 'object') return;
    var dur = te.dur > 0 ? +te.dur : 2, left = te.left == null ? dur : Math.max(0, Math.min(dur, +te.left || 0)), p = 1 - left / dur, t = o.time || 0;
    var pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * (2 + p * 8));
    glow(ctx, x, y, M3C.enemy, Math.round((TELE_R[kind] || 20) * 0.7), (0.1 + 0.35 * p) * (0.5 + 0.5 * pulse));
  }
  function drawTele(ctx, x, y, opts) {
    var o = opts || {};
    var dur = o.dur > 0 ? +o.dur : 2, left = o.left == null ? dur : Math.max(0, Math.min(dur, +o.left || 0));
    var p = 1 - left / dur, t = o.time || 0;
    var r = Math.max(6, Math.min(80, Math.round(o.r || 20)));
    var emp = o.kind === 'emp';
    var freq = 2 + p * 8, pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * freq);
    var ga = ctx.globalAlpha, op = ctx.globalCompositeOperation;
    glow(ctx, x, y, M3C.enemy, Math.round(r * 0.9), 0.12 + 0.5 * p * (0.55 + 0.45 * pulse));
    if (emp) glow(ctx, x, y, PAL.eisblau, Math.round(r * 0.6), 0.15 + 0.35 * p * pulse);
    // gestrichelter Ring, zieht sich zusammen und dreht sich schneller
    var rr = r + Math.round(8 * (1 - p)), rot = t * (1.2 + p * 4), segs = 14;
    ctx.fillStyle = M3C.enemy;
    ctx.globalAlpha = ga * (0.55 + 0.45 * pulse);
    for (var i = 0; i < segs; i += 2) arcDots(ctx, x, y, rr, rot + i / segs * Math.PI * 2, rot + (i + 1) / segs * Math.PI * 2, 1);
    ctx.globalAlpha = ga * 0.5 * pulse; ctx.fillStyle = '#FFB0A6';
    for (var j = 1; j < segs; j += 4) arcDots(ctx, x, y, rr + 1, -rot + j / segs * Math.PI * 2, -rot + (j + 0.6) / segs * Math.PI * 2, 1);
    // Fortschritt (Countdown), voll = Schuss
    ctx.globalAlpha = ga; ctx.fillStyle = mix('#8A2A24', M3C.enemy, p);
    if (p > 0) { arcDots(ctx, x, y, r + 3, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2, 1); arcDots(ctx, x, y, r + 4, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2, 1); }
    // letzte halbe Sekunde: weißer Blitzring
    if (left < 0.5 && ((t * 16) | 0) % 2 === 0) { ctx.fillStyle = '#FFE8E4'; arcDots(ctx, x, y, r + 1, 0, Math.PI * 2, 2); }
    if (emp) { ctx.fillStyle = PAL.eisblau; for (var e = 0; e < 5; e++) { var ea = hash2(e, (t * 10) | 0, 17) * Math.PI * 2, er = r * (0.3 + 0.5 * hash2(e, (t * 10) | 0, 18)); ctx.fillRect(Math.round(x + Math.cos(ea) * er), Math.round(y + Math.sin(ea) * er), 1, 1); } }
    // gestrichelte Linie zum Ziel
    if (o.toX != null && o.toY != null) {
      var dx = o.toX - x, dy = o.toY - y, L = Math.sqrt(dx * dx + dy * dy);
      if (L > 1) {
        var ux = dx / L, uy = dy / L, maxL = Math.min(L, o.lineLen > 0 ? o.lineLen : L), off = (t * 40) % 8;
        ctx.fillStyle = M3C.enemy; ctx.globalAlpha = ga * (0.35 + 0.55 * p);
        for (var d = r + 4 + off; d < maxL; d += 8) for (var s = 0; s < 4 && d + s < maxL; s++) ctx.fillRect(Math.round(x + ux * (d + s)), Math.round(y + uy * (d + s)), 1, 1);
      }
    }
    ctx.globalAlpha = ga; ctx.globalCompositeOperation = op;
  }

  // --- Strahlen M3a: lance (weiß-mint, dick, Nachglühen), battery (Messing-Bolzen), enemy_heavy (rot) ---
  // ttl wie bisher (Server beamTtl 0.25 s); opts.ttlMax überschreibt die Gesamtdauer.
  function drawBeamM3(ctx, x1, y1, x2, y2, kind, ttl, o) {
    o = o || {};
    var tmax = o.ttlMax > 0 ? o.ttlMax : 0.25;
    var life = ttl == null ? 1 : Math.max(0, Math.min(1, ttl / tmax)), age = 1 - life;
    if (ttl != null && life <= 0) return;
    var dx = x2 - x1, dy = y2 - y1, L = Math.sqrt(dx * dx + dy * dy);
    if (L < 1) return;
    var ang = Math.atan2(dy, dx), op = ctx.globalCompositeOperation, ga = ctx.globalAlpha, i;
    ctx.save();
    ctx.translate(x1, y1); ctx.rotate(ang);
    ctx.globalCompositeOperation = 'lighter';
    if (kind === 'lance') {
      if (age < 0.45) {   // voller Strahl
        var a = age < 0.05 ? 1 : 1 - (age - 0.05) / 0.4 * 0.35, w = 9 + (age < 0.1 ? 3 : 0);
        ctx.globalAlpha = ga * a * 0.3; ctx.fillStyle = PAL.mint; ctx.fillRect(0, -Math.round(w / 2), L, w);
        ctx.globalAlpha = ga * a * 0.85; ctx.fillRect(0, -2, L, 5);
        ctx.globalAlpha = ga * a; ctx.fillStyle = '#E8FFF8'; ctx.fillRect(0, -1, L, 3);
        ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, L, 1);
        for (i = 6; i < L; i += 11) { ctx.globalAlpha = ga * a * 0.8; ctx.fillRect(i, -4, 1, 9); }
      } else {   // Nachglühen: dünne Mint-Linie, Restfunken
        var ag = (1 - (age - 0.45) / 0.55);
        ctx.globalAlpha = ga * ag * 0.7; ctx.fillStyle = PAL.mint; ctx.fillRect(0, -1, L, 2);
        ctx.globalAlpha = ga * ag * 0.25; ctx.fillRect(0, -3, L, 6);
        ctx.fillStyle = '#E8FFF8';
        for (i = 0; i < 10; i++) { var px = hash2(i, 3, 61) * L, py = (hash2(i, 4, 61) - 0.5) * 8 * (1 + age); ctx.globalAlpha = ga * ag; ctx.fillRect(Math.round(px), Math.round(py), 1, 1); }
      }
    } else if (kind === 'battery' || kind === 'bolzen') {
      var bolts = kind === 'bolzen' ? 1 : 2;
      ctx.globalAlpha = ga * 0.12 * life; ctx.fillStyle = PAL.messing; ctx.fillRect(0, 0, L, 1);
      for (var b = 0; b < bolts; b++) {
        var head = Math.min(1, age * 2.4 - b * 0.22);
        if (head <= 0 || head >= 1) continue;
        var hx = head * L, bl = Math.min(14, L * 0.12);
        ctx.globalAlpha = ga * 0.45; ctx.fillStyle = PAL.messing; ctx.fillRect(Math.round(hx - bl * 1.6), -1, Math.round(bl * 1.6), 3);
        ctx.globalAlpha = ga; ctx.fillStyle = '#E3B565'; ctx.fillRect(Math.round(hx - bl), -1, Math.round(bl), 2);
        ctx.fillStyle = '#FFF1C9'; ctx.fillRect(Math.round(hx - 3), -1, 3, 2); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(Math.round(hx - 1), 0, 1, 1);
      }
    } else {   // enemy_heavy
      var ah = age < 0.06 ? 1 : 1 - (age - 0.06) / 0.94, jit = ((age * 40) | 0) % 2;
      ctx.globalAlpha = ga * ah * 0.3; ctx.fillStyle = M3C.enemy; ctx.fillRect(0, -5, L, 10);
      ctx.globalAlpha = ga * ah * 0.9; ctx.fillRect(0, -2 + jit, L, 4);
      ctx.globalAlpha = ga * ah; ctx.fillStyle = '#FFD0C8'; ctx.fillRect(0, 0, L, 1);
      ctx.fillStyle = M3C.enemy;
      for (i = 4; i < L; i += 9) { ctx.globalAlpha = ga * ah * 0.8; var yy = ((hash2(i, (age * 30) | 0, 7) - 0.5) * 8) | 0; ctx.fillRect(i, yy, 2, 1); }
    }
    ctx.restore();
    ctx.globalCompositeOperation = op; ctx.globalAlpha = ga;
    if (kind === 'lance') {
      glow(ctx, x2, y2, PAL.mint, 16, age < 0.45 ? 1 : 0.4 * life);
      glow(ctx, x2, y2, '#FFFFFF', 7, age < 0.45 ? 0.8 : 0);
      glow(ctx, x1, y1, PAL.mint, 10, age < 0.45 ? 0.9 : 0.3 * life);
    } else if (kind === 'battery' || kind === 'bolzen') {
      if (age < 0.15) glow(ctx, x1, y1, PAL.bernstein, 7, 1 - age / 0.15);
      if (age > 0.38) { glow(ctx, x2, y2, PAL.bernstein, 9, life); if (age < 0.6) drawFx(ctx, 'sparks', x2, y2, (age - 0.38) * 1.5, { small: true, seed: (x2 | 0) }); }
    } else {
      glow(ctx, x2, y2, M3C.enemy, 14, life);
      glow(ctx, x1, y1, M3C.enemy, 9, life * 0.8);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // S1: Siegel „Weltstand gesichert“ (CONTRACT-S1 §7)
  // drawSeal(ctx, x, y, size, variant): x/y = Mittelpunkt, size = Durchmesser in px (8..96), variant 'ok'|'warn'.
  // Wachssiegel mit leicht unregelmäßigem Rand, Messingkante, eingeprägtem Ring; 'ok' trägt einen kleinen Lorbeerkranz
  // (unter 20 px eine Raute), 'warn' ist warnrot mit Ausrufezeichen. Je (size, variant) gecacht, Cache begrenzt (24).
  // ---------------------------------------------------------------------------------------------
  var SEAL_COL = { ok: '#9E1F27', warn: PAL.alarmrot };
  var sealCache = new SmallCache(36);
  function buildSeal(g, s, variant, stage) {
    if (stage == null) stage = 2;
    var base = SEAL_COL[variant], brass = PAL.messing, cx = s / 2, cy = s / 2;
    var Rr = s / 2 - 1;                                   // 1 px Rand für die Outline
    var rimW = Math.max(1, Math.round(s / 14));
    var lightDark = shade(base, -0.38), lightHi = shade(base, 0.22), ring = shade(base, -0.28);
    var brassHi = shade(brass, 0.35), brassLo = shade(brass, -0.35);
    for (var y = 0; y < s; y++) for (var x = 0; x < s; x++) {
      var dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.sqrt(dx * dx + dy * dy), a = Math.atan2(dy, dx);
      // Wachsrand: sanfte Ausbuchtungen (fest, aus dem Winkel)
      var edge = Rr * (0.93 + 0.07 * (0.5 + 0.5 * Math.sin(a * 7 + 0.6)) * (0.6 + 0.4 * Math.sin(a * 3 - 1.1)));
      if (d > edge) continue;
      var lit = -(dx + dy) / (Rr * 1.42);                 // Licht von oben links: -1..1
      var col;
      if (d > edge - rimW) col = lit > 0.35 ? brassHi : lit < -0.35 ? brassLo : brass;
      else if (stage === 0) {                             // S2 Stufe 0: nur der Messingrand, innen leer
        continue;
      } else {
        // weiche Kante per Schachbrett-Dither zwischen den Stufen
        var dz = ((x + y) & 1) ? 0.08 : -0.08;
        col = lit + dz > 0.6 ? lightHi : lit + dz < -0.55 ? lightDark : base;
        var rr = Rr * 0.7;                                // eingeprägter Innenring
        if (s >= 14 && Math.abs(d - rr) < 0.55) col = ring;
        else if (s >= 14 && Math.abs(d - (rr + 1)) < 0.5 && lit > 0) col = shade(base, 0.1);
      }
      P(g, x, y, col);
    }
    if (stage === 0) return;
    if (stage === 1) {                                    // S2 Stufe 1: halb geprägt – Prägebild nur in der unteren Hälfte
      g.save(); g.beginPath(); g.rect(0, Math.round(cy), s, s); g.clip();
      try { buildSealEmblem(g, s, variant, base, brass, cx, cy, Rr, lightDark, brassHi, brassLo); } finally { g.restore(); }
      return;
    }
    buildSealEmblem(g, s, variant, base, brass, cx, cy, Rr, lightDark, brassHi, brassLo);
  }
  function buildSealEmblem(g, s, variant, base, brass, cx, cy, Rr, lightDark, brassHi, brassLo) {
    if (variant === 'warn') {                             // Ausrufezeichen, hell mit Schatten
      var bw = Math.max(1, Math.round(s / 9)), top = Math.round(cy - Rr * 0.45), bot = Math.round(cy + Rr * 0.12);
      var dot = Math.max(1, bw), x0 = Math.round(cx - bw / 2);
      R(g, x0 + 1, top + 1, bw, bot - top, lightDark); R(g, x0 + 1, Math.round(cy + Rr * 0.28) + 1, dot, dot, lightDark);
      R(g, x0, top, bw, bot - top, PAL.sternweiss); R(g, x0, Math.round(cy + Rr * 0.28), dot, dot, PAL.sternweiss);
    } else if (s < 20) {                                  // klein: Messing-Raute
      var h = Math.max(2, Math.round(Rr * 0.38));
      poly(g, [cx, cy - h, cx + h, cy, cx, cy + h, cx - h, cy], brass);
      P(g, Math.round(cx - 1), Math.round(cy - h / 2), brassHi);
    } else {                                              // Lorbeerkranz: zwei Zweige, unten gekreuzt, oben offen
      var rl = Rr * 0.48, n = s >= 40 ? 7 : 5, lw = Math.max(1.2, s / 26), ll = Math.max(2.2, s / 11);
      for (var side = -1; side <= 1; side += 2) {
        for (var i = 0; i < n; i++) {
          var ang = Math.PI / 2 + side * (0.35 + i * (2.1 / (n - 1)) / 1.0) * 1;   // von unten (pi/2) zur Seite nach oben
          var px = cx + Math.cos(ang) * rl, py = cy + Math.sin(ang) * rl;
          var tx = -Math.sin(ang) * side, ty = Math.cos(ang) * side;               // Tangente, zeigt nach oben
          var ox = Math.cos(ang), oy = Math.sin(ang);                               // nach außen
          var sz = ll * (1 - i * 0.06);
          var tipX = px + (tx * 0.8 + ox * 0.6) * sz, tipY = py + (ty * 0.8 + oy * 0.6) * sz;
          var tipX2 = px + (tx * 0.8 - ox * 0.6) * sz, tipY2 = py + (ty * 0.8 - oy * 0.6) * sz;
          poly(g, thick(px, py, tipX, tipY, lw), i % 2 ? brass : brassHi);
          poly(g, thick(px, py, tipX2, tipY2, lw), brassLo);
        }
      }
      var by = Math.round(cy + rl);                       // Schleife unten
      R(g, Math.round(cx - lw), by - 1, Math.max(2, Math.round(lw * 2)), Math.max(2, Math.round(lw * 1.5)), brassHi);
      if (s >= 28) { var cd = Math.max(1, Math.round(s / 20)); R(g, Math.round(cx - cd / 2), Math.round(cy - cd / 2), cd, cd, brass); }
    }
  }
  // S2: opts.stage 0 = nur Rand, 1 = halb geprägt, 2 = fertig (Standard, wie bisher)
  function drawSeal(ctx, x, y, size, variant, opts) {
    var s = Math.round(+size || 16); if (!(s >= 8)) s = 8; if (s > 96) s = 96;
    var v = variant === 'warn' ? 'warn' : 'ok';
    var st = opts && opts.stage != null ? Math.max(0, Math.min(2, Math.round(+opts.stage) || 0)) : 2;
    var key = s + '|' + v + (st === 2 ? '' : '|' + st), c = sealCache.get(key);
    if (!c) {
      c = sealCache.make(s, s);
      try { buildSeal(c.g, s, v, st); outline(c, PAL.outlineWarm); } catch (e) { warn('build seal ' + key, e); missing(c.g, 0, 0, s, s); }
      sealCache.set(key, c);
    }
    ctx.drawImage(c, Math.round(x - s / 2), Math.round(y - s / 2));
  }

  // ---------------------------------------------------------------------------------------------
  // API (alle Aufrufe abgesichert: nie werfen, Fehler zählen)
  // ---------------------------------------------------------------------------------------------
  function safe(name, fn, fallback) {
    return function (ctx) {
      try { return fn.apply(null, arguments); }
      catch (e) {
        warn(name, e);
        try { if (ctx && ctx.globalAlpha !== undefined) { ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; } } catch (_) {}
        return fallback;
      }
    };
  }
  var inited = false;
  function init() {
    if (!hasDom) return false;
    if (inited) return true;
    try {
      for (var ch in GLYPHS) parseGlyph(ch);
      nebulaLayer(); starLayer(0, 0); starLayer(1, 0); starLayer(2, 0);
      for (var c = 0; c < 3; c++) humanSprite(CREW[c], 'c' + c, 'down', 'idle', 0, false);
      inited = true;
      return true;
    } catch (e) { warn('init', e); return false; }
  }

  Art.TILE = TILE;
  Art.version = '1.0';
  Art.palette = Object.assign({}, PAL);
  Art.playerColors = PLAYER.slice();
  Art.init = init;
  Art.drawTile = safe('drawTile', drawTile);
  Art.drawObject = safe('drawObject', drawObject);
  Art.drawCharacter = safe('drawCharacter', drawCharacter);
  Art.drawBot = safe('drawBot', drawBot);
  Art.drawNpc = safe('drawNpc', drawNpc);
  Art.drawDrone = safe('drawDrone', drawDrone);
  Art.drawItem = safe('drawItem', drawItem);
  Art.drawFx = safe('drawFx', drawFx);
  Art.drawShip = safe('drawShip', drawShip);
  Art.drawEnemy = safe('drawEnemy', drawEnemy);
  Art.drawAsteroid = safe('drawAsteroid', drawAsteroid);
  Art.drawStation = safe('drawStation', drawStation);
  Art.drawProjectile = safe('drawProjectile', drawProjectile);
  Art.drawBeam = safe('drawBeam', drawBeam);
  Art.drawStarfield = safe('drawStarfield', drawStarfield);
  Art.drawText = safe('drawText', drawText, 0);
  Art.measureText = function (text, scale) { try { return measureText(text, scale); } catch (e) { warn('measureText', e); return 0; } };
  Art.drawPanel = safe('drawPanel', drawPanel);
  Art.drawIcon = safe('drawIcon', drawIcon);
  Art.drawOverlay = safe('drawOverlay', drawOverlay);
  // M3a
  Art.drawStationBadge = safe('drawStationBadge', drawStationBadge, 0);
  Art.drawStateTag = safe('drawStateTag', drawStateTag, 0);
  Art.drawTele = safe('drawTele', drawTele);
  Art.drawBurst = safe('drawBurst', drawBurst);
  Art.sideLabel = function (side) { return SIDE_LABEL[normSide(side) || 'mid']; };
  Art.sideColor = function (side) { return SIDE_COL[normSide(side) || 'mid']; };
  Art.stateLabel = function (state, fragile) { return STATE_TXT[stateCode(state, fragile)]; };
  Art.stateColor = function (state, fragile) { return STATE_COL[stateCode(state, fragile)]; };
  // S1
  Art.drawSeal = safe('drawSeal', drawSeal);
  // S2
  Art.drawEscort = safe('drawEscort', drawEscort);
  Art.ESCORT_KINDS = ['frachter', 'karawane', 'bergungsboot'];
  Art.cacheSize = function () { return cache.size; };
  Art.LINE_H = LINE_H;

  if (!hasDom) {   // ohne DOM (z. B. Node): alle Zeichenfunktionen No-op
    ['drawTile', 'drawObject', 'drawCharacter', 'drawBot', 'drawNpc', 'drawDrone', 'drawItem', 'drawFx', 'drawShip', 'drawEnemy',
      'drawAsteroid', 'drawStation', 'drawProjectile', 'drawBeam', 'drawStarfield', 'drawText', 'drawPanel', 'drawIcon', 'drawOverlay',
      'drawStationBadge', 'drawStateTag', 'drawTele', 'drawBurst', 'drawSeal', 'drawEscort']
      .forEach(function (k) { Art[k] = function () { return 0; }; });
  }
  root.Art = Art;
})(typeof window !== 'undefined' ? window : this);
