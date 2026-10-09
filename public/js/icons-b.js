// Pantheon – Icons B2/B3 (Team UI-ART). Vertrag: CONTRACT-B3 §8, CONTRACT-B2 §10, ART-PLAN §2.2/§6.
// Stil und Bedeutung: concept/buehnen/STILBLATT-SEKTOR.md. Vorschau: public/icons-b-preview.html.
// Klassisches Skript, keine Abhängigkeiten (art.js wird nicht vorausgesetzt), nie werfen.
//
// Format wie ICONS in art.js: 10×10-Maske, beim Zeichnen 12×12 mit Pixel-Outline.
//   '#' Hauptfarbe · '+' hell · 'o' dunkel · 'w' Akzent (je Icon in FARBE.akzent, sonst weiß-ish)
//
// API (alle Zeichenfunktionen fangen Fehler ab und geben true/false zurück):
//   IconsB.hex.<id> · IconsB.einfluss.<id> · IconsB.waffe.<id> · IconsB.status.<id>   (Masken)
//   IconsB.draw(ctx, gruppe, id, x, y, opts)   Mitte x/y; opts { scale, color, alpha }; Aliase (home → heimat …)
//   IconsB.has(gruppe, id) · IconsB.sprite(gruppe, id, color) → Canvas 12×12
//   IconsB.boje(ctx, zustand, x, y, s, winkel, opts)   Raumszene; zustand aktiv|gesperrt|temporaer|ohne_strom
//   IconsB.kante(ctx, ax, ay, bx, by, art, opts)       Kante der Sternkarte nach Stilblatt (Linie + Perle)
//   IconsB.perle(ctx, art, x, y, s)                    nur die Bojen-Perle auf der Kante
//   IconsB.hexFlaeche(ctx, pfad, fraktion, status, opts) Fläche + Muster + Status eines Hexes (pfad = [[x,y]…])
//   IconsB.muster(ctx, fraktion) → CanvasPattern|null
//   IconsB.wundePip(ctx, x, y, voll, size) · IconsB.wundenPips(ctx, x, y, n, max, size, gap) → Breite
//   IconsB.hitzebalken(ctx, x, y, w, h, hitze, opts)   hitze 0..1 (oder 0..100); opts { segmente, ueberhitzt, t }
//   Daten: IconsB.PAL, FRAKTION, HEXSTATUS, KANTE, BOJE, FARBE, ALIAS
(function (root) {
  'use strict';

  var hasDom = typeof document !== 'undefined' && !!document.createElement;
  var IconsB = root.IconsB || {};
  IconsB.errors = IconsB.errors || 0;

  // ---------------------------------------------------------------------------------------------
  // Palette (Deck, artdirector.md §5) + Spielfarben aus art.js
  // ---------------------------------------------------------------------------------------------
  var PAL = {
    dunkel: '#0B0E1A', tief: '#141A2A', stahl: '#2E3A4A', outline: '#1B2230',
    hell: '#F4EEDC', gedaempft: '#9AA6B8', eisblau: '#A9D6E5', gold: '#FFC66B', glut: '#FF8A4C', bronze: '#C9974A',
    fern: '#7FD6C8', vorlaeufer: '#B79CE0', rostsand: '#C2703D', alarmrot: '#E0473C', stahlhell: '#8EA3B5',
    lavendel: '#9A90C8', gift: '#B8C46A', gezeiten: '#C6D4EA',
    // Telegraf-Farben (ART-PLAN §1.7): Glut = Fläche, Weißgold = Präzision, Elektrisch-Blau = außer Gefecht
    weissgold: '#FFF1B8', elektrisch: '#6FB8FF',
  };
  IconsB.PAL = PAL;

  // ---------------------------------------------------------------------------------------------
  // Hex-Symbole ×11 (CONTRACT-B3 §8)
  // ---------------------------------------------------------------------------------------------
  IconsB.hex = {
    hafen: ['....##....', '.########.', '.#......#.', '.#.####.#.', '##.#ww#.##', '##.#ww#.##', '.#.####.#.', '.#......#.', '.########.', '....##....'],
    gasriese: ['...####...', '.##++++##.', '.########.', '#oooooooo#', '##########', '#++++++++#', '#oooooooo#', '.########.', '.##++++##.', '...####...'],
    ruine: ['....##....', '...####...', '..##..##..', '.##....##.', '##..ww..##', '##..ww..##', '.##....##.', '..##..##..', '...####...', '....##....'],
    piraten: ['#........#', '##......##', '.##....##.', '..##..##..', '...####...', '...####...', '..##..##..', '+##....##+', '++......++', '.+......+.'],
    asteroiden: ['.###......', '#+++#.....', '#++o#..##.', '.###..#++#', '......#+o#', '..##...##.', '.#++#.....', '.#+o#..##.', '..##..#+o#', '.......##.'],
    nebel: ['..........', '...###....', '..#+++#.##', '.#++w++#+#', '#+++++++##', '#++++w+++#', '#+w+++++o#', '.#oooooo#.', '..######..', '..........'],
    boje: ['....##....', '..######..', '.##.##.##.', '##..##..##', '#...##...#', '#...##...#', '##..##..##', '.##.##.##.', '..######..', '....##....'],
    heimat: ['....##....', '...####...', '..##++##..', '.##++++##.', '##++++++##', '.#++ww++#.', '.#++ww++#.', '.#++ww++#.', '.#++ww++#.', '.########.'],
    schrein: ['....##....', '....##....', '...#ww#...', '...#ww#...', '###wwww###', '###wwww###', '...#ww#...', '...#ww#...', '....##....', '....##....'],
    festung: ['##..##..##', '##..##..##', '##########', '#++++++++#', '#+##++##+#', '#+##++##+#', '#++++++++#', '#+++oo+++#', '#+++oo+++#', '##########'],
    wrack: ['..........', '.###......', '#+++##....', '#++++#.#..', '.##++#.##.', '.....##++#', '.....#+++#', '......###.', '..#.......', '#...#.....'],
  };

  // ---------------------------------------------------------------------------------------------
  // Einflüsse ×8 (Ids wie karte_limes.py: gas, asteroiden, truemmerstrom, eruption, gezeiten, nebel, daempfung, minen)
  // ---------------------------------------------------------------------------------------------
  IconsB.einfluss = {
    gas: ['..........', '....###...', '...#+++#..', '.###+++#o.', '#+++++++#.', '#++++++++#', '#oooooooo#', '.########.', '..o....o..', '.o..o..o..'],
    asteroiden: ['...##.....', '..#++#....', '.#++++#...', '#++oo++#..', '.#++++#...', '..#++#.##.', '...##.#++#', '......#+o#', '.......##.', '..........'],
    truemmerstrom: ['......#...', '##.#..##..', '......###.', '.##.######', '......###.', '#.##..##..', '......#...', '..#.##....', '..........', '##..#.###.'],
    eruption: ['......##..', '.....#ww#.', '....#w#...', '...#w#....', '..####....', '.#++++#...', '#++ww++#..', '#++ww++#..', '.#++++#...', '..####....'],
    gezeiten: ['..######..', '.#......#.', '#..####..#', '#.#....#.#', '#.#.ww.#.#', '#.#.ww.#.#', '#.#....#.#', '#..####..#', '.#......#.', '..######..'],
    nebel: ['..........', '.##....##.', '#..#..#..#', '....##....', '.##....##.', '#..#..#..#', '....##....', '.##....##.', '#..#..#..#', '....##....'],
    daempfung: ['..######..', '.##....##.', '##.....###', '#.....##.#', '#....##..#', '#...##...#', '#..##....#', '###.....##', '.##....##.', '..######..'],
    minen: ['#...##...#', '.#..##..#.', '..######..', '.##++++##.', '####ww####', '####ww####', '.##++++##.', '..######..', '.#..##..#.', '#...##...#'],
  };

  // ---------------------------------------------------------------------------------------------
  // Waffen ×7 (+ faust) – Seitenansicht, Mündung rechts (CONTRACT-B2 §1.1)
  // ---------------------------------------------------------------------------------------------
  IconsB.waffe = {
    pistole: ['..........', '..........', '..#######.', '..#++++++#', '..##o####.', '..##.#....', '.###......', '.##.......', '.##.......', '..........'],
    blaster: ['..........', '..........', '.########.', '.#++++++#w', '.###o####.', '..##.#....', '..##......', '..#.......', '..........', '..........'],
    sturmgewehr: ['..........', '....##....', '##########', '#++++++###', '##.###....', '#..###....', '....##....', '.....#....', '..........', '..........'],
    granatwerfer: ['..........', '..######..', '.#++++++##', '##+oo+++##', '##+oo+++##', '.#++++++##', '..######..', '...##.....', '..###.....', '..........'],
    lanze: ['..........', '...###....', '....#.....', '#########w', '##++++++#.', '#.#o#.....', '..##......', '..#.......', '..........', '..........'],
    nahkampf: ['........##', '.......#+#', '......#+#.', '.....#+#..', '....#+#...', '...#+#....', '.#.##.....', '..##......', '.#.#......', '#.........'],
    betaeuber: ['.......w.w', '......w.w.', '.######.w.', '.#++++###.', '.##o####..', '.##.#.....', '.##.......', '.##.......', '..........', '..........'],
    faust: ['..........', '..####....', '.#+#+##...', '.#+#+#+#..', '.#+#+#+##.', '.#+++++++#', '.#++++++#.', '..#++++#..', '...####...', '..........'],
  };

  // ---------------------------------------------------------------------------------------------
  // Zustände (snapshot zs/bt/ov): betaeubt, bewusstlos, gefesselt, gefangen, ueberhitzt, verwundet
  // ---------------------------------------------------------------------------------------------
  IconsB.status = {
    betaeubt: ['.#......#.', '#w#.##.#w#', '.#.#++#.#.', '..#+..+#..', '.#+.##.+#.', '.#+.#..+#.', '..#+..+#..', '.#.#++#.#.', '#w#....#w#', '.#......#.'],
    bewusstlos: ['..........', '.####.....', '...#......', '..#.......', '.####.###.', '.......#..', '......#...', '.....###..', '..........', '##########'],
    gefesselt: ['..........', '.###..###.', '#+++##+++#', '#+..##..+#', '#+..##..+#', '#+..##..+#', '#+++##+++#', '.###..###.', '..........', '..........'],
    gefangen: ['##########', '#+#+#+#+##', '#.#.#.#.##', '#.#.#.#.##', '#.#.#.#.##', '#.#.#.#.##', '#.#.#.#.##', '#.#.#.#.##', '#+#+#+#+##', '##########'],
    ueberhitzt: ['...##.....', '..#++#.#..', '..#++#..#.', '..#ww#.#..', '..#ww#..#.', '..#ww#.#..', '.#wwww#...', '#wwwwww#..', '#wwwwww#..', '.######...'],
    verwundet: ['....##....', '....##....', '...####...', '..##++##..', '.##++++##.', '.#++++++#.', '##++++++##', '.#++w+++#.', '.##++++##.', '..######..'],
  };

  // Wunden-Pip (Raute, ≠ Schild-Würfel) und Hitzesegment als Masken für eigene Darstellungen
  IconsB.pip = {
    voll: ['...#...', '..#+#..', '.#+++#.', '#+++++#', '.#+++#.', '..#+#..', '...#...'],
    leer: ['...#...', '..#.#..', '.#...#.', '#.....#', '.#...#.', '..#.#..', '...#...'],
  };

  // ---------------------------------------------------------------------------------------------
  // Farben je Icon: haupt ('#'), optional akzent ('w'), hell ('+'), dunkel ('o')
  // ---------------------------------------------------------------------------------------------
  IconsB.FARBE = {
    hex: {
      hafen: { haupt: PAL.hell, akzent: PAL.gold }, gasriese: { haupt: PAL.eisblau }, ruine: { haupt: PAL.vorlaeufer, akzent: PAL.vorlaeufer },
      piraten: { haupt: PAL.rostsand }, asteroiden: { haupt: PAL.gedaempft }, nebel: { haupt: PAL.lavendel, akzent: PAL.hell },
      boje: { haupt: PAL.gold }, heimat: { haupt: PAL.hell, hell: '#4A4466', akzent: PAL.gold }, schrein: { haupt: PAL.gold, akzent: PAL.weissgold },
      festung: { haupt: PAL.stahlhell }, wrack: { haupt: PAL.bronze },
    },
    einfluss: {
      gas: { haupt: PAL.gift }, asteroiden: { haupt: PAL.gedaempft }, truemmerstrom: { haupt: PAL.bronze },
      eruption: { haupt: PAL.glut, akzent: PAL.weissgold }, gezeiten: { haupt: PAL.gezeiten, akzent: PAL.gezeiten },
      nebel: { haupt: PAL.lavendel }, daempfung: { haupt: PAL.vorlaeufer }, minen: { haupt: PAL.alarmrot, akzent: PAL.weissgold },
    },
    waffe: {
      pistole: { haupt: PAL.hell }, blaster: { haupt: PAL.hell, akzent: PAL.gold }, sturmgewehr: { haupt: PAL.hell },
      granatwerfer: { haupt: PAL.glut }, lanze: { haupt: PAL.weissgold, akzent: '#FFFFFF' }, nahkampf: { haupt: PAL.hell },
      betaeuber: { haupt: PAL.elektrisch, akzent: '#DDF0FF' }, faust: { haupt: PAL.gedaempft },
    },
    status: {
      betaeubt: { haupt: PAL.elektrisch, akzent: '#DDF0FF' }, bewusstlos: { haupt: PAL.elektrisch }, gefesselt: { haupt: PAL.hell },
      gefangen: { haupt: PAL.gedaempft }, ueberhitzt: { haupt: PAL.glut, akzent: PAL.glut }, verwundet: { haupt: PAL.alarmrot, akzent: '#FFFFFF' },
    },
  };

  // Aliase: Symbol-Ids aus karte_limes.py / limes.json → Icon-Id
  IconsB.ALIAS = {
    hex: { home: 'heimat', pantheon: 'schrein', ruin: 'ruine', pirate: 'piraten', fort: 'festung', port: 'hafen', station: 'hafen',
      gas: 'gasriese', buoy: 'boje', wreck: 'wrack', nebula: 'nebel', asteroids: 'asteroiden' },
    einfluss: { gasriese: 'gas', truemmer: 'truemmerstrom', dämpfung: 'daempfung', mine: 'minen' },
    waffe: { pistol: 'pistole', karabiner: 'blaster', gewehr: 'sturmgewehr', granate: 'granatwerfer', klinge: 'nahkampf' },
    status: { betäubt: 'betaeubt', bt: 'betaeubt', ov: 'ueberhitzt', überhitzt: 'ueberhitzt' },
  };

  // ---------------------------------------------------------------------------------------------
  // Sternkarte: Fraktionsflächen, Hex-Status, Kanten, Bojen (Daten fürs Stilblatt; KARTE zeichnet)
  // ---------------------------------------------------------------------------------------------
  // muster: zweites Merkmal neben der Farbe (Farbsehschwäche). Alle hell, dünn, Deckkraft 0,16.
  IconsB.FRAKTION = {
    saum: { name: 'Konkordat (Saumraum)', flaeche: '#4A4466', muster: 'keins' },
    rom: { name: 'Rom', flaeche: '#6B2E2E', muster: 'waagrecht' },
    ger: { name: 'Germanen', flaeche: '#3F4A28', muster: 'senkrecht' },
    pirat: { name: 'Piraten (Rostmeute)', flaeche: '#5C3A1E', muster: 'punkte' },
    frei: { name: 'herrenlos (Grenzmark)', flaeche: '#33404F', muster: 'kreuze' },
    neutral: { name: 'neutral (Freihafen)', flaeche: '#5A4A22', muster: 'ringe' },
    vorl: { name: 'Vorläufer', flaeche: '#1F5555', muster: 'rauten' },
    offen: { name: 'Platzhalter', flaeche: '#202734', muster: 'keins' },
  };
  IconsB.FRAKTION.kontor = { name: 'Kontor (Germanen, Handel)', flaeche: IconsB.FRAKTION.ger.flaeche, muster: 'senkrecht' };
  IconsB.FRAKTION.rostmeute = IconsB.FRAKTION.pirat;
  IconsB.FRAKTION.konkordat = IconsB.FRAKTION.saum;

  // Vorrang: verborgen > leerraum > gesperrt > unerkundet > erkundet (STILBLATT §2)
  IconsB.HEXSTATUS = {
    erkundet: { flaeche: null, rand: 'rgba(244,238,220,0.35)', randBreite: 1.5, strich: null, koord: 'rgba(244,238,220,0.75)', name: PAL.hell },
    unerkundet: { flaeche: PAL.tief, rand: PAL.gedaempft, randBreite: 2, strich: [6, 6], koord: PAL.gedaempft, name: PAL.gedaempft },
    gesperrt: { flaeche: null, abdunkeln: 0.45, schraffur: true, rand: 'rgba(244,238,220,0.20)', randBreite: 1.5, strich: null, koord: 'rgba(244,238,220,0.55)', name: 'rgba(244,238,220,0.75)' },
    leerraum: { flaeche: PAL.dunkel, rand: PAL.stahl, randBreite: 1.5, strich: null, koord: PAL.stahl, name: null },
    verborgen: { flaeche: PAL.tief, rand: PAL.gedaempft, randBreite: 2, strich: [6, 6], koord: PAL.gedaempft, name: PAL.gedaempft, text: '?' },
  };

  // Kanten (Breiten bei Hexradius 60; KARTE skaliert mit opts.s). perle: Form der Bojen-Marke auf der Kantenmitte
  IconsB.KANTE = {
    open: { farbe: PAL.gold, breite: 7, strich: null, perle: 'punkt', boje: 'aktiv' },
    locked: { farbe: PAL.glut, breite: 7, strich: [10, 7], perle: 'kreuz', boje: 'gesperrt' },
    temp: { farbe: PAL.eisblau, breite: 5, strich: [3, 7], perle: 'raute', boje: 'temporaer' },
    ohne_strom: { farbe: PAL.gedaempft, breite: 7, strich: null, perle: 'ring', boje: 'ohne_strom' },
    far: { farbe: PAL.fern, breite: 3, strich: [3, 7], perle: 'kreuz', bogen: true, boje: 'gesperrt' },
    hidden: { farbe: PAL.gedaempft, breite: 3, strich: [2, 6], perle: null, nurDebug: true },
  };
  IconsB.KANTE.aktiv = IconsB.KANTE.open; IconsB.KANTE.gesperrt = IconsB.KANTE.locked; IconsB.KANTE.temporaer = IconsB.KANTE.temp;
  IconsB.BOJE = {
    aktiv: { farbe: PAL.gold, text: 'aktiv', perle: 'punkt' },
    gesperrt: { farbe: PAL.glut, text: 'gesperrt', perle: 'kreuz' },
    temporaer: { farbe: PAL.eisblau, text: 'temporär', perle: 'raute' },
    ohne_strom: { farbe: PAL.gedaempft, text: 'ohne Strom', perle: 'ring' },
  };

  // ---------------------------------------------------------------------------------------------
  // Helfer (bewusst lokal, art.js-Interna sind nicht exportiert)
  // ---------------------------------------------------------------------------------------------
  function warn(where, e) {
    IconsB.errors++;
    if (IconsB.errors < 20) { try { console.warn('[IconsB] ' + where + ':', e && e.message ? e.message : e); } catch (_) {} }
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
  function rgba(h, a) { var c = hex2rgb(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function mk(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.g = c.getContext('2d');
    c.g.imageSmoothingEnabled = false;
    return c;
  }
  function grid(g, x, y, rows, map) {
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      for (var q = 0; q < row.length; q++) {
        var col = map[row[q]];
        if (col) { g.fillStyle = col; g.fillRect(x + q, y + r, 1, 1); }
      }
    }
  }
  function outline(c, col) {
    var g = c.g, w = c.width, h = c.height;
    var id = g.getImageData(0, 0, w, h), d = id.data, op = new Uint8Array(w * h), i, x, y, rgb = hex2rgb(col);
    for (i = 0; i < w * h; i++) op[i] = d[i * 4 + 3] > 40 ? 1 : 0;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      if (op[i]) continue;
      if ((x > 0 && op[i - 1]) || (x < w - 1 && op[i + 1]) || (y > 0 && op[i - w]) || (y < h - 1 && op[i + w])) {
        d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; d[i * 4 + 3] = 255;
      }
    }
    g.putImageData(id, 0, 0);
  }
  var cache = new Map();
  function cached(key, w, h, fn) {
    var c = cache.get(key);
    if (c) return c;
    c = mk(w, h);
    try { fn(c.g, c); } catch (e) { warn('build ' + key, e); }
    cache.set(key, c);
    return c;
  }
  function safe(name, fn, fallback) {
    return function () {
      try { return fn.apply(null, arguments); } catch (e) { warn(name, e); return fallback; }
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Icons
  // ---------------------------------------------------------------------------------------------
  var GRUPPEN = ['hex', 'einfluss', 'waffe', 'status'];
  function resolve(gruppe, id) {
    var set = IconsB[gruppe];
    if (!set || GRUPPEN.indexOf(gruppe) < 0 || id == null) return null;
    if (set[id]) return id;
    var a = IconsB.ALIAS[gruppe] && IconsB.ALIAS[gruppe][id];
    return a && set[a] ? a : null;
  }
  function sprite(gruppe, id, color) {
    var rid = resolve(gruppe, id);
    if (!rid || !hasDom) return null;
    var f = (IconsB.FARBE[gruppe] && IconsB.FARBE[gruppe][rid]) || {};
    var col = color || f.haupt || PAL.hell;
    return cached(gruppe + '|' + rid + '|' + col, 12, 12, function (g, c) {
      var map = {
        '#': col,
        '+': color ? shade(col, 0.45) : (f.hell || shade(col, 0.45)),
        'o': f.dunkel || shade(col, -0.55),
        'w': color ? shade(col, 0.7) : (f.akzent || '#FFFFFF'),
      };
      grid(g, 1, 1, IconsB[gruppe][rid], map);
      outline(c, mix(PAL.outline, col, 0.12));
    });
  }
  function draw(ctx, gruppe, id, x, y, opts) {
    opts = opts || {};
    var spr = sprite(gruppe, id, opts.color);
    if (!spr) return false;
    var s = opts.scale || 1;
    var a0 = ctx.globalAlpha;
    if (opts.alpha != null) ctx.globalAlpha = a0 * opts.alpha;
    if (s === 1) ctx.drawImage(spr, Math.round(x - 6), Math.round(y - 6));
    else ctx.drawImage(spr, Math.round(x - 6 * s), Math.round(y - 6 * s), 12 * s, 12 * s);
    ctx.globalAlpha = a0;
    return true;
  }
  IconsB.has = function (gruppe, id) { return !!resolve(gruppe, id); };
  IconsB.resolve = resolve;
  IconsB.sprite = safe('sprite', sprite, null);
  IconsB.draw = safe('draw', draw, false);

  // ---------------------------------------------------------------------------------------------
  // Sternkarte: Muster, Hexfläche, Kanten, Perlen
  // ---------------------------------------------------------------------------------------------
  function musterKachel(art) {
    return cached('muster|' + art, 8, 8, function (g) {
      g.fillStyle = 'rgba(244,238,220,0.16)';
      if (art === 'waagrecht') { g.fillRect(0, 3, 8, 1); }
      else if (art === 'senkrecht') { g.fillRect(3, 0, 1, 8); }
      else if (art === 'punkte') { g.fillRect(1, 1, 2, 2); g.fillRect(5, 5, 2, 2); }
      else if (art === 'kreuze') { g.fillRect(3, 2, 1, 3); g.fillRect(2, 3, 3, 1); }
      else if (art === 'ringe') { g.fillRect(2, 2, 3, 1); g.fillRect(2, 4, 3, 1); g.fillRect(2, 3, 1, 1); g.fillRect(4, 3, 1, 1); }
      else if (art === 'rauten') { g.fillRect(3, 1, 1, 1); g.fillRect(2, 2, 1, 1); g.fillRect(4, 2, 1, 1); g.fillRect(3, 3, 1, 1); }
    });
  }
  var schraffurKachel = function () {
    return cached('schraffur', 8, 8, function (g) {
      g.fillStyle = 'rgba(11,14,26,0.55)';
      for (var i = 0; i < 8; i++) { g.fillRect(i, 7 - i, 1, 1); g.fillRect((i + 1) % 8, 7 - i, 1, 1); }
    });
  };
  function muster(ctx, fraktion) {
    if (!hasDom) return null;
    var f = IconsB.FRAKTION[fraktion];
    if (!f || f.muster === 'keins') return null;
    return ctx.createPattern(musterKachel(f.muster), 'repeat');
  }
  function pfadZiehen(ctx, pfad) {
    ctx.beginPath();
    for (var i = 0; i < pfad.length; i++) {
      var p = pfad[i];
      if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
    }
    ctx.closePath();
  }
  // status: erkundet | unerkundet | gesperrt | leerraum | verborgen. opts { s (Skala, 1 = Hexradius 60), ohneMuster }
  function hexFlaeche(ctx, pfad, fraktion, status, opts) {
    opts = opts || {};
    var st = IconsB.HEXSTATUS[status] || IconsB.HEXSTATUS.erkundet;
    var fr = IconsB.FRAKTION[fraktion] || IconsB.FRAKTION.offen;
    var s = opts.s || 1;
    ctx.save();
    pfadZiehen(ctx, pfad);
    ctx.fillStyle = st.flaeche || fr.flaeche;
    ctx.fill();
    if (!st.flaeche && !opts.ohneMuster) {
      var pat = muster(ctx, fraktion);
      if (pat) { ctx.fillStyle = pat; ctx.fill(); }
    }
    if (st.abdunkeln) { ctx.fillStyle = rgba(PAL.dunkel, st.abdunkeln); ctx.fill(); }
    if (st.schraffur) { ctx.fillStyle = ctx.createPattern(schraffurKachel(), 'repeat'); ctx.fill(); }
    ctx.strokeStyle = st.rand;
    ctx.lineWidth = Math.max(1, st.randBreite * s);
    ctx.setLineDash(st.strich ? st.strich.map(function (v) { return Math.max(2, v * s); }) : []);
    ctx.stroke();
    ctx.restore();
    return true;
  }
  // Bojen-Perle: punkt (aktiv), kreuz (gesperrt), raute (temporär), ring (ohne Strom)
  function perle(ctx, art, x, y, s) {
    var k = IconsB.KANTE[art] || IconsB.KANTE.open;
    var form = k.perle; if (!form) return false;
    s = s || 1;
    var r = Math.max(3, 8 * s), col = k.farbe;
    ctx.save();
    ctx.setLineDash([]);
    if (form === 'punkt') {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    } else if (form === 'kreuz') {
      ctx.fillStyle = PAL.dunkel; ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, 3 * s);
      ctx.beginPath(); ctx.arc(x, y, r + 1 * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      var d = r * 0.5; ctx.lineWidth = Math.max(1.5, 2.5 * s);
      ctx.beginPath(); ctx.moveTo(x - d, y - d); ctx.lineTo(x + d, y + d); ctx.moveTo(x + d, y - d); ctx.lineTo(x - d, y + d); ctx.stroke();
    } else if (form === 'raute') {
      var q = r * 1.25;
      ctx.fillStyle = col; ctx.strokeStyle = PAL.dunkel; ctx.lineWidth = Math.max(1, 1.5 * s);
      ctx.beginPath(); ctx.moveTo(x, y - q); ctx.lineTo(x + q, y); ctx.lineTo(x, y + q); ctx.lineTo(x - q, y); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (form === 'ring') {
      ctx.fillStyle = PAL.dunkel; ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, 3 * s);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
    return true;
  }
  // art: open|locked|temp|ohne_strom|far|hidden (auch aktiv|gesperrt|temporaer). opts { s, ohnePerle, bogen (Höhe px für far), debug }
  function kante(ctx, ax, ay, bx, by, art, opts) {
    opts = opts || {};
    var k = IconsB.KANTE[art];
    if (!k) return false;
    if (k.nurDebug && !opts.debug) return false;
    var s = opts.s || 1;
    ctx.save();
    ctx.strokeStyle = k.farbe;
    ctx.lineWidth = Math.max(1.5, k.breite * s);
    ctx.lineCap = 'round';
    ctx.setLineDash(k.strich ? k.strich.map(function (v) { return Math.max(2, v * s); }) : []);
    var mx = (ax + bx) / 2, my = (ay + by) / 2;
    ctx.beginPath();
    if (k.bogen) {
      var dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, hb = opts.bogen != null ? opts.bogen : len * 0.3;
      var cx = mx - dy / len * hb, cy = my + dx / len * hb;
      ctx.moveTo(ax, ay); ctx.quadraticCurveTo(cx, cy, bx, by); ctx.stroke();
      // Pfeilspitze am Ziel
      var tx = bx - cx, ty = by - cy, tl = Math.hypot(tx, ty) || 1, ux = tx / tl, uy = ty / tl, ph = Math.max(6, 14 * s);
      ctx.setLineDash([]); ctx.fillStyle = k.farbe;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - ux * ph - uy * ph * 0.5, by - uy * ph + ux * ph * 0.5);
      ctx.lineTo(bx - ux * ph + uy * ph * 0.5, by - uy * ph - ux * ph * 0.5); ctx.closePath(); ctx.fill();
      mx = 0.25 * ax + 0.5 * cx + 0.25 * bx; my = 0.25 * ay + 0.5 * cy + 0.25 * by;
    } else {
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    ctx.restore();
    if (!opts.ohnePerle) perle(ctx, art, mx, my, s);
    return true;
  }
  IconsB.muster = safe('muster', muster, null);
  IconsB.hexFlaeche = safe('hexFlaeche', hexFlaeche, false);
  IconsB.perle = safe('perle', perle, false);
  IconsB.kante = safe('kante', kante, false);

  // ---------------------------------------------------------------------------------------------
  // Boje in der Raumszene (CONTRACT-B3 §8). s = Maßstab wie Stationen (cam.zoom); das Sprite misst 96 Weltpx,
  // gezeichnet wird mindestens 26 px groß. winkel = Richtung zum Zielhex (Szenenwinkel, Bug rechts = 0).
  // opts { t (Sekunden, sonst Uhr), ziel (true = gewählt: Pfeil pulsiert), name (Zielhex, wird nicht gezeichnet) }
  // Zustände unterscheiden sich in Form UND Farbe:
  //   aktiv      Gold, Lampe voll + Glimmen, Ring geschlossen, Pfeil gefüllt
  //   gesperrt   Glut, Lampe als Kreuz, Ring gestrichelt, Pfeil durch Querbalken ersetzt
  //   temporaer  Eisblau, Lampe als Raute (blinkt), Ring gepunktet, Pfeil nur Umriss
  //   ohne_strom Grau, Lampe hohl, kein Ring/Glimmen, Pfeil fehlt, Körper gekippt
  // ---------------------------------------------------------------------------------------------
  function boje(ctx, zustand, x, y, s, winkel, opts) {
    opts = opts || {};
    var B = IconsB.BOJE[zustand] || IconsB.BOJE.ohne_strom;
    var col = B.farbe;
    var t = opts.t != null ? opts.t : (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    var size = Math.max(26, 96 * (s || 0.35));
    var R = size / 2, w = winkel || 0;
    var lw = Math.max(1.5, size / 24);
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.setLineDash([]);
    ctx.lineJoin = 'round';

    // Glimmen
    if (zustand === 'aktiv' || zustand === 'temporaer') {
      var p = zustand === 'aktiv' ? 0.30 + 0.12 * Math.sin(t * 2.4) : 0.18 + 0.10 * Math.sin(t * 6);
      var gr = ctx.createRadialGradient(0, 0, R * 0.1, 0, 0, R * 1.15);
      gr.addColorStop(0, rgba(col, p)); gr.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, R * 1.15, 0, Math.PI * 2); ctx.fill();
    }
    // Ring
    if (zustand !== 'ohne_strom') {
      ctx.strokeStyle = col; ctx.lineWidth = lw;
      if (zustand === 'gesperrt') ctx.setLineDash([R * 0.32, R * 0.2]);
      else if (zustand === 'temporaer') { ctx.setLineDash([R * 0.08, R * 0.16]); ctx.lineDashOffset = -t * R * 0.4; }
      ctx.beginPath(); ctx.arc(0, 0, R * 0.92, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
    }
    // Richtung
    ctx.save();
    ctx.rotate(w);
    var ax = R * 0.92, ah = R * 0.34;
    if (zustand === 'aktiv' || zustand === 'temporaer') {
      var pul = opts.ziel ? 1 + 0.12 * Math.sin(t * 5) : 1;
      ctx.beginPath(); ctx.moveTo(ax + ah * 0.9 * pul, 0); ctx.lineTo(ax - ah * 0.2, -ah * 0.7 * pul); ctx.lineTo(ax - ah * 0.2, ah * 0.7 * pul); ctx.closePath();
      ctx.fillStyle = zustand === 'aktiv' ? col : PAL.dunkel; ctx.fill();
      ctx.strokeStyle = zustand === 'aktiv' ? PAL.outline : col; ctx.lineWidth = Math.max(1, lw * 0.75); ctx.stroke();
    } else if (zustand === 'gesperrt') {
      ctx.fillStyle = col; ctx.strokeStyle = PAL.outline; ctx.lineWidth = Math.max(1, lw * 0.6);
      ctx.beginPath(); ctx.rect(ax - lw * 0.9, -ah * 0.75, lw * 1.8, ah * 1.5); ctx.fill(); ctx.stroke();
    }
    ctx.restore();

    // Körper (Achteck-Gehäuse mit Antennenmast), ohne Strom gekippt
    ctx.save();
    if (zustand === 'ohne_strom') ctx.rotate(0.22);
    var b = R * 0.52, i, a;
    ctx.beginPath();
    for (i = 0; i < 8; i++) { a = Math.PI / 8 + i * Math.PI / 4; ctx.lineTo(Math.cos(a) * b, Math.sin(a) * b); }
    ctx.closePath();
    ctx.fillStyle = zustand === 'ohne_strom' ? '#1A1F2B' : '#232C3B'; ctx.fill();
    ctx.strokeStyle = zustand === 'ohne_strom' ? '#5A6474' : mix(PAL.outline, col, 0.7);
    ctx.lineWidth = lw; ctx.stroke();
    // Paneelfugen
    ctx.strokeStyle = zustand === 'ohne_strom' ? '#2A3140' : '#3A465A'; ctx.lineWidth = Math.max(1, lw * 0.5);
    ctx.beginPath(); ctx.moveTo(-b * 0.92, 0); ctx.lineTo(-b * 0.55, 0); ctx.moveTo(b * 0.55, 0); ctx.lineTo(b * 0.92, 0); ctx.stroke();
    // Mast
    ctx.strokeStyle = zustand === 'ohne_strom' ? '#5A6474' : PAL.stahlhell; ctx.lineWidth = Math.max(1, lw * 0.6);
    ctx.beginPath(); ctx.moveTo(0, -b); ctx.lineTo(0, -b - R * 0.28); ctx.stroke();
    var mastLicht = zustand === 'ohne_strom' ? '#3A4250' : ((t * 1.5) % 1 < 0.5 ? col : shade(col, -0.5));
    ctx.fillStyle = mastLicht; ctx.beginPath(); ctx.arc(0, -b - R * 0.3, Math.max(1.2, lw * 0.7), 0, Math.PI * 2); ctx.fill();
    // Lampe
    var lr = b * 0.52;
    if (zustand === 'aktiv') {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, lr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = PAL.weissgold; ctx.beginPath(); ctx.arc(-lr * 0.25, -lr * 0.25, lr * 0.42, 0, Math.PI * 2); ctx.fill();
    } else if (zustand === 'gesperrt') {
      ctx.fillStyle = PAL.dunkel; ctx.beginPath(); ctx.arc(0, 0, lr, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, lw * 1.1); ctx.lineCap = 'round';
      var d = lr * 0.62;
      ctx.beginPath(); ctx.moveTo(-d, -d); ctx.lineTo(d, d); ctx.moveTo(d, -d); ctx.lineTo(-d, d); ctx.stroke();
    } else if (zustand === 'temporaer') {
      var on = (t * 2) % 1 < 0.7;
      ctx.fillStyle = on ? col : shade(col, -0.45); ctx.strokeStyle = PAL.dunkel; ctx.lineWidth = Math.max(1, lw * 0.5);
      ctx.beginPath(); ctx.moveTo(0, -lr * 1.15); ctx.lineTo(lr * 1.15, 0); ctx.lineTo(0, lr * 1.15); ctx.lineTo(-lr * 1.15, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else {
      ctx.fillStyle = PAL.dunkel; ctx.strokeStyle = PAL.gedaempft; ctx.lineWidth = Math.max(1, lw * 0.8);
      ctx.beginPath(); ctx.arc(0, 0, lr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
    return true;
  }
  IconsB.boje = safe('boje', boje, false);

  // ---------------------------------------------------------------------------------------------
  // B2-HUD: Wunden-Pips (Rauten; Schild bleibt Würfel) und Hitzebalken in Segmenten
  // ---------------------------------------------------------------------------------------------
  function wundePip(ctx, x, y, voll, size) {
    size = size || 10;
    var h = size / 2, cx = x + h, cy = y + h;
    ctx.save();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(x + size, cy); ctx.lineTo(cx, y + size); ctx.lineTo(x, cy); ctx.closePath();
    ctx.fillStyle = voll ? PAL.alarmrot : 'rgba(11,14,26,0.8)'; ctx.fill();
    if (voll) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.moveTo(cx, y + 2); ctx.lineTo(cx + h * 0.45, cy - h * 0.15); ctx.lineTo(cx, cy - h * 0.3); ctx.lineTo(cx - h * 0.45, cy - h * 0.15); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = voll ? '#FFB0A8' : PAL.alarmrot; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, y + 0.5); ctx.lineTo(x + size - 0.5, cy); ctx.lineTo(cx, y + size - 0.5); ctx.lineTo(x + 0.5, cy); ctx.closePath(); ctx.stroke();
    ctx.restore();
    return true;
  }
  function wundenPips(ctx, x, y, n, max, size, gap) {
    size = size || 10; gap = gap == null ? 3 : gap;
    max = Math.max(0, Math.min(8, max | 0)); n = Math.max(0, Math.min(max, n | 0));
    for (var i = 0; i < max; i++) wundePip(ctx, x + i * (size + gap), y, i < n, size);
    return max ? max * (size + gap) - gap : 0;
  }
  // Hitze 0..1 (Werte > 1 gelten als Prozent). Segmente füllen sich von links; Farbe kalt → warm → Glut, dazu wächst die
  // Segmenthöhe (Form). Überhitzt: alle Segmente Glut mit Schraffur, Rahmen blinkt, Überhitzt-Icon rechts davor.
  function hitzebalken(ctx, x, y, w, h, hitze, opts) {
    opts = opts || {};
    var v = +hitze || 0; if (v > 1) v = v / 100; v = v < 0 ? 0 : v > 1 ? 1 : v;
    var n = Math.max(2, Math.min(12, opts.segmente || 6));
    var ov = !!opts.ueberhitzt;
    var t = opts.t != null ? opts.t : (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    var gap = 1, sw = (w - gap * (n - 1)) / n;
    ctx.save();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(11,14,26,0.8)'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    for (var i = 0; i < n; i++) {
      var sx = Math.round(x + i * (sw + gap)), ex = Math.round(x + i * (sw + gap) + sw), bw = ex - sx;
      var anteil = ov ? 1 : Math.max(0, Math.min(1, v * n - i));
      var stufe = i / (n - 1);
      var col = ov ? PAL.glut : stufe < 0.5 ? mix(PAL.gedaempft, PAL.gold, stufe * 2) : mix(PAL.gold, PAL.glut, (stufe - 0.5) * 2);
      // Leerform: niedriger Strich unten
      ctx.fillStyle = rgba(col, 0.28); ctx.fillRect(sx, y + h - Math.max(1, Math.round(h * 0.25)), bw, Math.max(1, Math.round(h * 0.25)));
      if (anteil > 0) {
        var sh = Math.round(h * (0.55 + 0.45 * stufe));
        if (ov) sh = h;
        var fh = Math.max(1, Math.round(sh * anteil));
        ctx.fillStyle = col; ctx.fillRect(sx, y + h - fh, bw, fh);
        if (ov) {
          ctx.fillStyle = 'rgba(11,14,26,0.45)';
          for (var k = -h; k < bw; k += 3) for (var r = 0; r < h; r++) { var px = sx + k + r; if (px >= sx && px < ex) ctx.fillRect(px, y + h - 1 - r, 1, 1); }
        }
      }
    }
    if (ov) {
      ctx.strokeStyle = (t * 3) % 1 < 0.5 ? PAL.glut : PAL.weissgold; ctx.lineWidth = 1;
      ctx.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
    }
    ctx.restore();
    if (ov && opts.icon !== false) draw(ctx, 'status', 'ueberhitzt', x + w + 9, y + h / 2);
    return true;
  }
  IconsB.wundePip = safe('wundePip', wundePip, false);
  IconsB.wundenPips = safe('wundenPips', wundenPips, 0);
  IconsB.hitzebalken = safe('hitzebalken', hitzebalken, false);

  IconsB.cacheSize = function () { return cache.size; };
  IconsB.version = 1;
  if (!hasDom) {
    ['draw', 'boje', 'kante', 'perle', 'hexFlaeche', 'wundePip', 'hitzebalken'].forEach(function (k) { IconsB[k] = function () { return false; }; });
    IconsB.wundenPips = function () { return 0; };
    IconsB.sprite = IconsB.muster = function () { return null; };
  }
  root.IconsB = IconsB;
})(typeof window !== 'undefined' ? window : this);
