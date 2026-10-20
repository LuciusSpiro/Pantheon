// PAN-01 D: Hafenterminal (Handel und Werft in einem Gerät) im Pult-Stil, Richtung B „Waffenkreuz“ (Kai 2026-10-18). Globales `PultTerminal`.
// Designer, Modus System. Tokens + reine Zeichen-Bausteine auf ctx (Canvas 2D 640×360 wie die Pulte). Kein Netz, kein Zustand, keine Regeln:
// was frei ist, was es kostet und was die Vorschau zeigt, rechnet der Aufrufer (Action-Layer) und gibt es als Modell herein.
// Hängt an: Render (render.js), Pult (pult.js, Skin rom), optional Shared_Maps (Grundriss), Shared_Schiffskatalog + SchiffsUI (Waffensymbole), Tasten.
// Vorschau aller Zustände mit echten Katalogdaten: public/terminal-preview.html. Vertrag: CONTRACT-PAN01-D-GESTALTUNG.md.
//
// ---------------------------------------------------------------- API (Kurzfassung; Felder im Detail im CONTRACT)
//   PultTerminal.TOKENS                     Farbe, Schrift, Abstand, Raster, Zelle, Knopf (nur hier stehen Farbwerte, siehe tools/check-terminal-farben.js)
//   PultTerminal.layout(w, h)               -> Rechtecke aller Bereiche (640×360): { S, anzeige, plan, decks[3], rechts, kopf, platzKopf, liste, vorschau,
//                                              legende, pult, kreuzTitel, kreuz{1..9}, modulTitel, module{1..4}, energie, status, aktionen{handel, werft, haupt, hinweis, ausbau, teil} }
//   PultTerminal.zeichneTerminal(ctx, view, m)   ganzes Terminal aus einem Modell m (empfohlen; ruft die Bausteine unten in fester Ordnung)
//   Bausteine (alle: ctx, rect, daten; zeichnen nur, registrieren Klickflächen über Pult.knopf/Pult.zelle bzw. R.ui.buttons):
//     zeichneSchnitt(ctx, rect, z)          drei Decks nebeneinander, Bug oben; Platzmarken 1–9, Modulräume F1–F4; Zustände zu | offen | bestueckt | neu, gewählt
//     zeichneKopf(ctx, rect, k)             Ort, Art (Flottenbasis · Werft | Hafen), Marken
//     zeichnePlatzKopf(ctx, rect, p)        große Kappe (9 / F4) + Titel + Lage
//     zeichneTeilliste(ctx, rect, l)        Zeilen: Symbol, Name, Wirkungssatz, Energie, Zustand eingebaut | frei | kostet | gesperrt; gewählt = volle Fläche
//     zeichneVorschau(ctx, rect, v)         Zeilen vorher → nachher (Ladepool mit Segmenten, Energie), Seitenbestückung beider Seiten
//     zeichneStufen(ctx, rect, s)           Ausbaustufen 0–3, was Stufe n öffnet, Marken vorher → nachher
//     zeichneGesperrt(ctx, rect, g)         Werft gesperrt (Nicht-Werft-Hafen): Grund, Erklärung, nächste Werft; darunter Bestückung zur Ansicht
//     zeichneHandel(ctx, rect, infoRect, h) Handelsliste als Pult-Zellen (3 Spalten), Info zum gewählten Artikel (Rechtecke: layout().handel, .handelInfo)
//     zeichneKreuz(ctx, rects, z)           Waffenkreuz 3×3 wie an der Ops (Pult.zelle), Kappe = Ziffer
//     zeichneModulraeume(ctx, rects, z)     vier Modulräume als Pult-Zellen, Kappe F1–F4
//     zeichneBereich(ctx, rects, b)         Umschalter Handel / Werft (H / W)
//     zeichneAktionen(ctx, rects, a)        Hauptknopf (Ent Umbau bestätigen | F Freischalten | H Zum Handel), Hinweis, A Ausbau, ↑↓ Teil
//     zeichneStatus(ctx, rect, s)           Am Gerät: Spielerfarbe · Zusehen: Farben
//     symbolModul(ctx, id, x, y, o)         Pixel-Symbol frachtraum | krankenstation | werkstatt (10×10, Format wie SYMBOLE im Katalog)
//     symbolTeil(ctx, teil, x, y, o)        Waffe (Katalogsymbol über SchiffsUI) oder Modul
//   Hilfen: PultTerminal.txt(ctx, s, x, y, farbe, { align, scale, sperr }), tw(s, scale, sperr), umbruch(s, w, maxZeilen), kappe(aktion, ersatz), kontrast(a, b)
(function () {
  'use strict';
  const R = window.Render;
  const P = window.Pult;
  const VW = 640, VH = 360;

  // ================================================================= TOKENS (einzige Stelle mit Farbwerten für das Terminal)
  // <tokens>
  const FN = P.FN;                       // Funktionsfarben der Pulte: weapon Rot, shield Mint, nav Messing, warn Gelb, drive Bernstein, sensor Eisblau
  const SK = P.SKINS.rom;                // Skin rom (Lerche): bg, screenBg, text, dim, off, offLine, ink, frame
  const FARBE = {
    // Grund und Text (aus dem Skin)
    grund: SK.screenBg,                  // Schirm #070A14
    pultGrund: SK.bg,                    // Pult #0B0E1A
    text: SK.text,                       // #F4EEDC  17,4:1 auf Schirm
    dim: SK.dim,                         // #8EA3B5  7,6:1 auf Schirm
    ink: SK.ink,                         // Schrift auf voller Farbfläche
    // Flächen
    kachel: '#1A2238',                   // Teil frei / Artikel: Text 13,7:1, Dim 6,1:1
    kachelZu: '#10151F',                 // Teil kostet Marken / gesperrt
    textZu: '#76829A',                   // gesperrtes Teil auf kachelZu: 4,7:1 (Review 2026-10-20, vorher #6F7A8E 4,2:1)
    trenner: '#1C2638',                  // Linie zwischen Plan und rechter Spalte
    // Schiffsschnitt
    rumpf: '#0E1422',                    // Rumpffläche (Gänge liegen darin)
    raum: '#1A2438', raumLinie: '#34446A',
    raumZu: '#0A0E18', schraffurZu: '#2A3446',   // noch nicht ausgebaut: dunkel + Schraffur
    platzZu: '#5A667C',                  // gestrichelte Platzmarke + Ziffer, Strich der gesperrten Zellen (3,4:1 auf Schirm: Grafik)
    modulRaum: '#1B3B3A',                // Modulraum mit Modul (Mint 0,78 in den Grund gemischt)
    // Zustandsfarben (Funktion)
    waffe: FN.weapon,                    // eingebaut = roter Rand · wird eingebaut = volle rote Fläche
    modul: FN.shield,                    // frei / freigeschaltet / Modul / neu öffnend = Mint
    antrieb: FN.drive,                   // Energieverteilung: Antrieb (Bernstein), Schilde = modul (Mint), Waffen = waffe (Rot)
    preis: FN.nav,                       // kostet Marken = Messing (7,5:1)
    warn: FN.warn,                       // Werft gesperrt
    warnGrund: '#1A1608',                // Fläche des Sperrhinweises (Gelb darauf 11,9:1)
    spieler: (window.Shared_Protocol && Shared_Protocol.PLAYER_COLORS) || ['#56B4E9', '#E69F00', '#CC79A7', '#7FE0C2'],
  };
  const SPIELER_NAMEN = ['Blau', 'Orange', 'Pink', 'Mint'];
  // Zustand -> Darstellung (eine Regel für Plan, Liste, Kreuz)
  const ZUSTAND = {
    eingebaut: { rand: 'waffe', tag: 'EINGEBAUT', tagFarbe: 'modul' },
    gewaehlt: { flaeche: 'waffe', tagFarbe: 'ink' },
    frei: { flaeche: 'kachel', tag: 'FREI', tagFarbe: 'dim' },
    kostet: { flaeche: 'kachelZu', tagFarbe: 'preis' },
    gesperrt: { flaeche: 'kachelZu', strich: 'platzZu', tagFarbe: 'dim' },
  };
  // Schrift: Pixelschrift 5×7 aus art.js (Render.text). Rollen:
  const SCHRIFT = {
    titel: { scale: 1, sperr: 1, versal: true },      // Bereichstitel, Ort, Decks (Versalien, 1 px Sperrung)
    text: { scale: 1, sperr: 0 },                     // Namen, Wirkung (gemischte Schreibung)
    zahl: { scale: 2, sperr: 0 },                     // Zahlen, die zählen: Platzkappe, Marken, 840 → 240
    gross: { scale: 2, sperr: 0, versal: true },      // WERFT GESPERRT
    zeile: 9,                                         // Zeilenhöhe Fließtext (7 px Glyphe + 2)
    zeileLuft: 10,                                    // Zeilenhöhe Absatz
  };
  const ABSTAND = { xs: 2, s: 4, m: 8, l: 12, xl: 16, gutter: 8 };   // 4er-Raster mit 2er-Feinschritt
  // Raster Schiffsschnitt: Kachel 4 px, drei Decks nebeneinander (Oben, Mitte, Unten), Bug oben, Backbord links
  const RASTER = {
    kachel: 4, deckLaenge: 40, deckBreite: 13, bug: 39,
    deckX: [76, 146, 230], deckY: 26,                // linke Kante je Deck, Bugspitze
    deckReihenfolge: [1, 0, 2],                      // Deck-Index (Maps): Ober, Mittel, Unter
    deckKurz: ['MITTE', 'OBEN', 'UNTEN'],            // nach Deck-Index
    deckName: ['Mitteldeck', 'Oberdeck', 'Unterdeck'],
    trennerX: 304, rechtsX: 312, rechtsW: 316,
    marke: { w: 13, h: 11, abstand: 2 },             // Platzmarke am Rumpf
  };
  const ZELLE = { h: 18, luft: 3, kreuzW: 62, modulW: 76 };   // Pult-Zellen unten (Waffenkreuz wie Ops, nur flacher)
  const KNOPF = { h: 14, hauptH: 24, kleinH: 13, w: 160, halbW: 78, luft: 4 };
  const S = 238;                                     // Statusleiste (Anzeige oben 226 px hoch)
  // </tokens>
  const TOKENS = { FARBE, ZUSTAND, SCHRIFT, ABSTAND, RASTER, ZELLE, KNOPF, S, SPIELER_NAMEN, FN };

  // ================================================================= Hilfen
  const mix = P.mix, rgba = P.rgba;
  const F = (k) => (typeof k === 'string' && FARBE[k]) || k;   // Token-Name oder schon aufgelöster Wert
  function cham(c, x, y, w, h, col, tl, tr, br, bl) { P.cham(c, x, y, w, h, F(col), tl || 0, tr || 0, br || 0, bl || 0); }
  function rect(c, x, y, w, h, col) { c.fillStyle = F(col); c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
  function rand(c, x, y, w, h, col) { rect(c, x, y, w, 1, col); rect(c, x, y + h - 1, w, 1, col); rect(c, x, y, 1, h, col); rect(c, x + w - 1, y, 1, h, col); }
  function strich(c, x, y, w, h, col, step) { step = step || 3; c.fillStyle = F(col); for (let i = 0; i < w; i += step) { c.fillRect(x + i, y, 1, 1); c.fillRect(x + i, y + h - 1, 1, 1); } for (let i = 0; i < h; i += step) { c.fillRect(x, y + i, 1, 1); c.fillRect(x + w - 1, y + i, 1, 1); } }
  function schraffur(c, x, y, w, h, col, step) { step = step || 3; c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); c.fillStyle = F(col); for (let d = -h; d < w; d += step) for (let r = 0; r < h; r++) c.fillRect(x + d + r, y + r, 1, 1); c.restore(); }
  function hit(b) { const m = (R.ui && R.ui.mouse) || {}; return m.x >= b.x && m.y >= b.y && m.x < b.x + b.w && m.y < b.y + b.h; }
  function klick(b) { if (b.onClick || b.hotkey) R.ui.buttons.push(b); if (hit(b) && b.disabled && b.reason) R.ui.tooltip = { text: b.reason, x: R.ui.mouse.x, y: R.ui.mouse.y }; return b; }

  // Text: Pixelschrift, optional Sperrung (Zeichen einzeln) und Versalien
  function tw(s, scale, sperr) {
    s = String(s == null ? '' : s); scale = scale || 1; sperr = sperr || 0;
    if (!sperr) return R.measure(s, scale);
    let w = 0; for (let i = 0; i < s.length; i++) w += R.measure(s[i], scale) + (i < s.length - 1 ? sperr * scale + scale : 0);
    return w;
  }
  function txt(c, s, x, y, col, o) {
    o = o || {}; s = String(s == null ? '' : s); if (!s) return x;
    const scale = o.scale || 1, sperr = o.sperr || 0; if (o.versal) s = s.toUpperCase();
    const w = tw(s, scale, sperr);
    let dx = o.align === 'center' ? x - Math.round(w / 2) : o.align === 'right' ? x - w : x;
    if (!sperr) { R.text(c, s, dx, y, { color: F(col), scale, shadow: false }); return dx + w; }
    for (let i = 0; i < s.length; i++) { R.text(c, s[i], dx, y, { color: F(col), scale, shadow: false }); dx += R.measure(s[i], scale) + sperr * scale + scale; }
    return dx;
  }
  const rolle = (name) => SCHRIFT[name];
  function txtRolle(c, s, x, y, col, name, align) { const r = rolle(name); return txt(c, s, x, y, col, { scale: r.scale, sperr: r.sperr, versal: r.versal, align }); }
  // Umbruch nach Pixelbreite, höchstens n Zeilen (letzte mit …)
  function umbruch(s, w, n) {
    const lines = R.wrap(String(s || ''), w, 1);
    if (!n || lines.length <= n) return lines;
    const out = lines.slice(0, n); let l = out[n - 1];
    while (l.length > 1 && R.measure(l + '…', 1) > w) l = l.slice(0, -1).replace(/\s+$/, '');
    out[n - 1] = l + '…'; return out;
  }
  // Kappe: echte Taste aus tasten.js, wenn die Aktion dort steht, sonst Ersatzbeschriftung (Tasten.kappe liefert für unbekannte Aktionen '–')
  function kappe(aktion, ersatz) {
    try { if (aktion && window.Tasten && Tasten.belegung && Tasten.belegung(aktion).length) return Tasten.kappe(aktion); } catch (e) { /* Ersatz */ }
    return ersatz || '';
  }
  // WCAG-Kontrast zweier Hex-Farben
  function lum(h) { const n = parseInt(String(h).slice(1, 7), 16); return [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0); }
  function kontrast(a, b) { const A = lum(F(a)), B = lum(F(b)); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); }

  // ================================================================= Symbole der Module (eigene Pixel, 10×10, Format wie SYMBOLE in shared/schiffskatalog.js)
  // '#' Hauptfarbe · '+' hell · 'o' dunkel · 'w' Akzent. Beim Zeichnen 12×12 mit 1 px Outline, wie SchiffsUI.draw.
  const SYMBOLE_MODUL = {
    frachtraum: ['..........', '...####...', '...#++#...', '...#oo#...', '...####...', '####.####.', '#++#.#++#.', '#oo#.#oo#.', '####.####.', '..........'],
    krankenstation: ['..........', '...####...', '...#ww#...', '####ww####', '#wwwwwwww#', '#wwwwwwww#', '####ww####', '...#ww#...', '...####...', '..........'],
    werkstatt: ['.#...#....', '.#...#....', '.##+##....', '..###.....', '...##.....', '....##....', '.....#+...', '......#+..', '.......##.', '........#.'],
  };
  const spriteCache = new Map();
  function hex2rgb(h) { const n = parseInt(String(h).slice(1, 7), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function maskeSprite(rows, col, key) {
    const k = key + '|' + col; let cv = spriteCache.get(k); if (cv) return cv;
    cv = document.createElement('canvas'); cv.width = 12; cv.height = 12; const g = cv.getContext('2d');
    const map = { '#': col, '+': mix(col, FARBE.text, 0.45), 'o': mix(col, FARBE.ink, 0.55), 'w': mix(col, FARBE.text, 0.7) };
    rows.forEach((row, r) => { for (let q = 0; q < row.length; q++) { const cc = map[row[q]]; if (cc) { g.fillStyle = cc; g.fillRect(1 + q, 1 + r, 1, 1); } } });
    const id = g.getImageData(0, 0, 12, 12), d = id.data, op = new Uint8Array(144), o = hex2rgb(mix(FARBE.ink, col, 0.12));
    for (let i = 0; i < 144; i++) op[i] = d[i * 4 + 3] > 40 ? 1 : 0;
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) { const i = y * 12 + x; if (op[i]) continue; if ((x > 0 && op[i - 1]) || (x < 11 && op[i + 1]) || (y > 0 && op[i - 12]) || (y < 11 && op[i + 12])) { d[i * 4] = o[0]; d[i * 4 + 1] = o[1]; d[i * 4 + 2] = o[2]; d[i * 4 + 3] = 255; } }
    g.putImageData(id, 0, 0); spriteCache.set(k, cv); return cv;
  }
  // Mitte x/y; o { scale, color }
  function symbolModul(c, id, x, y, o) {
    o = o || {}; const rows = SYMBOLE_MODUL[id]; if (!rows) return false;
    const s = o.scale || 1, spr = maskeSprite(rows, F(o.color || 'modul'), id), sm = c.imageSmoothingEnabled; c.imageSmoothingEnabled = false;
    c.drawImage(spr, Math.round(x - 6 * s), Math.round(y - 6 * s), 12 * s, 12 * s); c.imageSmoothingEnabled = sm; return true;
  }
  function symbolTeil(c, teil, x, y, o) {
    o = o || {};
    if (teil.art === 'modul') return symbolModul(c, teil.id, x, y, o);
    if (window.SchiffsUI) return SchiffsUI.drawWaffe(c, teil.id, x, y, { scale: o.scale, color: F(o.color || 'waffe') });
    return false;
  }

  // ================================================================= Layout (alle Rechtecke; w/h für spätere andere Größen, heute 640×360)
  function layout(w, h) {
    w = w || VW; h = h || VH;
    const A = { x: 62, y: 6, w: 572, h: S - 12 };
    const RX = RASTER.rechtsX, RW = RASTER.rechtsW;
    const py = S + 22;                                  // Pult-Oberkante (wie Pult.rahmen)
    const L = {
      S, anzeige: A,
      plan: { x: A.x, y: A.y, w: RASTER.trennerX - A.x, h: A.h },
      decks: RASTER.deckReihenfolge.map((d, i) => ({ deck: d, x: RASTER.deckX[i], y: RASTER.deckY, w: RASTER.deckBreite * RASTER.kachel, h: RASTER.deckLaenge * RASTER.kachel })),
      legende: { x: 72, y: 214, w: 224, h: 10 },
      rechts: { x: RX, y: A.y + 4, w: RW, h: A.h - 8 },
      kopf: { x: RX, y: 10, w: RW, h: 14 },
      platzKopf: { x: RX, y: 26, w: RW, h: 22 },
      liste: { x: RX, y: 52, w: RW, h: 146 },
      vorschau: { x: RX, y: 201, w: RW, h: 28 },
      handel: { x: 70, y: 42, w: 558, h: 152 },
      handelInfo: { x: 70, y: 198, w: 558, h: 30 },
      pult: { x: 62, y: py, w: 572, h: 346 - py },
      kreuzTitel: { x: 62, y: py - 4, w: 192 },
      modulTitel: { x: 266, y: py - 4, w: 154 },
      kreuz: {}, module: {},
      energie: { x: 266, y: py + 54, w: 154, h: 9 },
      status: { x: 62, y: py + 76, w: 400, h: 9 },
      aktionen: {
        handel: { x: 474, y: py - 4, w: KNOPF.halbW, h: KNOPF.h }, werft: { x: 474 + KNOPF.halbW + KNOPF.luft, y: py - 4, w: KNOPF.halbW, h: KNOPF.h },
        haupt: { x: 474, y: py + 22, w: KNOPF.w, h: KNOPF.hauptH }, hinweis: { x: 474, y: py + 50, w: KNOPF.w, h: 9 },
        ausbau: { x: 474, y: py + 64, w: KNOPF.halbW, h: KNOPF.kleinH }, teil: { x: 474 + KNOPF.halbW + KNOPF.luft, y: py + 64, w: KNOPF.halbW, h: KNOPF.kleinH },
      },
    };
    // Waffenkreuz: Ziffernblock 7 8 9 / 4 5 6 / 1 2 3
    for (let p = 1; p <= 9; p++) { const ix = (p - 1) % 3, iy = 2 - Math.floor((p - 1) / 3); L.kreuz[p] = { x: 62 + ix * (ZELLE.kreuzW + ZELLE.luft), y: py + 10 + iy * (ZELLE.h + 2), w: ZELLE.kreuzW, h: ZELLE.h }; }
    for (let m = 1; m <= 4; m++) { const ix = (m - 1) % 2, iy = Math.floor((m - 1) / 2); L.module[m] = { x: 266 + ix * (ZELLE.modulW + 2), y: py + 10 + iy * (ZELLE.h + 2), w: ZELLE.modulW, h: ZELLE.h }; }
    return L;
  }

  // ================================================================= Schiffsschnitt
  // Geometrie aus Shared_Maps (SHIP_ROOMS, WAFFENPLAETZE, MODUL_RAEUME); ohne Maps zeichnet nur der Rumpf.
  const GANG = /^(gang|heckgang|weg_|lafetten_mitte|gang_ober|heckgang_ober)/;
  function deckRumpf(d) { return d === 0 ? { x0: 0, x1: 39 } : { x0: 6, x1: 39 }; }
  // Kachel (x längs, ly quer) -> Pixel im Deckrechteck (Bug oben, Backbord links)
  function kp(D, x, ly) { const k = RASTER.kachel; return { x: D.x + ly * k, y: D.y + (RASTER.bug - x) * k }; }
  function raumRect(D, r) { const k = RASTER.kachel, ly0 = r.y0 % 16, ly1 = r.y1 % 16; const p = kp(D, r.x1, ly0); return { x: p.x, y: p.y, w: (ly1 - ly0 + 1) * k, h: (r.x1 - r.x0 + 1) * k }; }
  // z: { stufe, plaetze { 1..9: { zustand: 'zu'|'offen'|'bestueckt'|'neu', waffe } }, module { 1..4: { zustand: 'zu'|'offen'|'bestueckt'|'neu', modul } },
  //      gewaehlt: 9 | 'F4' | null, deck: Deck-Index hervorheben | null, gesperrt: bool (alles grau), hier: Raum-Id des Terminals ('meeting') }
  function zeichneSchnitt(c, L, z) {
    const M = window.Shared_Maps, k = RASTER.kachel;
    const rooms = (M && M.SHIP_ROOMS) || [];
    L.decks.forEach((D) => {
      const d = D.deck, sel = z.deck === d;
      txtRolle(c, RASTER.deckKurz[d], D.x + D.w / 2, 12, sel ? 'text' : 'dim', 'titel', 'center');
      if (sel) rect(c, D.x + 6, 22, D.w - 12, 1, 'text');
      // Rumpf: Bugspitze abgeschrägt
      const ru = deckRumpf(d), top = kp(D, ru.x1, 0).y, hgt = (ru.x1 - ru.x0 + 1) * k;
      cham(c, D.x, top, D.w, hgt, F('rumpf'), 14, 14, 2, 2);
      rooms.filter((r) => r.deck === d && r.kind !== 'lift' && !GANG.test(r.id)).forEach((r) => {
        const Q = raumRect(D, r), zu = (r.stufe || 0) > (z.stufe || 0);
        const mr = r.kind === 'modul' ? (z.module || {})[r.modul] || {} : null;
        const neu = mr && mr.zustand === 'neu';
        if (zu) {
          rect(c, Q.x + 1, Q.y + 1, Q.w - 2, Q.h - 2, 'raumZu'); schraffur(c, Q.x + 1, Q.y + 1, Q.w - 2, Q.h - 2, neu ? 'modul' : 'schraffurZu', 3);
          if (neu) rand(c, Q.x, Q.y, Q.w, Q.h, 'modul');
          return;
        }
        const voll = mr && mr.modul && !z.gesperrt;
        rect(c, Q.x + 1, Q.y + 1, Q.w - 2, Q.h - 2, voll ? 'modulRaum' : 'raum'); rand(c, Q.x + 1, Q.y + 1, Q.w - 2, Q.h - 2, voll ? mix(FARBE.modul, FARBE.grund, 0.5) : 'raumLinie');
        if (mr) {
          if (mr.modul) symbolModul(c, mr.modul, Q.x + Q.w / 2, Q.y + 9, { color: z.gesperrt ? 'dim' : 'modul' });
          txt(c, 'F' + r.modul, Q.x + Q.w / 2, Q.y + Q.h - 9, mr.modul && !z.gesperrt ? 'modul' : 'dim', { align: 'center' });
          if (z.gewaehlt === 'F' + r.modul) rand(c, Q.x - 1, Q.y - 1, Q.w + 2, Q.h + 2, 'text');
        }
        if (z.hier && r.id === z.hier) { rect(c, Q.x + Q.w / 2 - 2, Q.y + Q.h / 2 - 6, 5, 5, 'text'); txt(c, 'HIER', Q.x + Q.w / 2, Q.y + Q.h / 2 + 2, 'text', { align: 'center' }); }
      });
    });
    // Platzmarken: Seitenplätze außen am Rumpf (Bb links, Stb rechts), Bug und Heck innen. Überlappung je Seite auflösen (Abstand ≥ Markenhöhe + 2).
    const plaetze = (M && M.WAFFENPLAETZE) || [];
    const mk = RASTER.marke, marken = [];
    plaetze.forEach((pl) => {
      const d = M.deckOf(pl.y), D = L.decks.find((q) => q.deck === d); if (!D) return;
      const ly = pl.y % 16, p = kp(D, pl.x, ly);
      let x = p.x + k / 2 - Math.round(mk.w / 2), y = p.y + k / 2 - Math.round(mk.h / 2);
      if (pl.art === 'seite') x = ly < 6 ? D.x - mk.w - 2 : D.x + D.w + 2;
      marken.push({ pl, x, y, seite: pl.art === 'seite' ? d + (ly < 6 ? 'b' : 's') : null });
    });
    const gruppen = {}; marken.forEach((m) => { if (m.seite) (gruppen[m.seite] = gruppen[m.seite] || []).push(m); });
    Object.values(gruppen).forEach((g) => { g.sort((a, b) => a.y - b.y); for (let i = 1; i < g.length; i++) if (g[i].y < g[i - 1].y + mk.h + mk.abstand) g[i].y = g[i - 1].y + mk.h + mk.abstand; });
    marken.forEach((m) => zeichneMarke(c, m.x, m.y, m.pl.platz, ((z.plaetze || {})[m.pl.platz]) || {}, z));
  }
  function zeichneMarke(c, x, y, platz, p, z) {
    const mk = RASTER.marke, w = mk.w, h = mk.h, s = String(platz);
    if (p.zustand === 'zu' || !p.zustand) { rect(c, x, y, w, h, 'grund'); strich(c, x, y, w, h, 'platzZu', 2); txt(c, s, x + w / 2 + 1, y + 2, 'platzZu', { align: 'center' }); return; }
    if (p.zustand === 'neu') { rect(c, x, y, w, h, 'grund'); schraffur(c, x + 1, y + 1, w - 2, h - 2, rgba(FARBE.modul, 0.55), 3); rand(c, x, y, w, h, 'modul'); txt(c, s, x + w / 2 + 1, y + 2, 'text', { align: 'center' }); return; }
    if (z.gesperrt) { rect(c, x, y, w, h, SK.off); rand(c, x, y, w, h, SK.offLine); txt(c, s, x + w / 2 + 1, y + 2, 'dim', { align: 'center' }); return; }
    const voll = p.zustand === 'bestueckt';
    cham(c, x, y, w, h, voll ? FARBE.waffe : FARBE.grund, 0, 0, 3, 0); if (!voll) rand(c, x, y, w, h, 'waffe');
    txt(c, s, x + w / 2 + 1, y + 2, voll ? 'ink' : 'waffe', { align: 'center' });
    if (z.gewaehlt === platz) rand(c, x - 2, y - 2, w + 4, h + 4, 'text');
  }
  // Legende unter dem Plan (für Zuschauer ohne Vorwissen)
  function zeichneLegende(c, r, mitNeu, nurAnsicht) {
    let x = r.x;
    if (nurAnsicht) { txt(c, 'nur Ansicht · die Werft ist hier gesperrt', x, r.y + 1, 'dim'); return; }
    const eintrag = (zeichne, text) => { zeichne(x, r.y); x = txt(c, text, x + 13, r.y + 1, 'dim') + 10; };
    eintrag((xx, yy) => cham(c, xx, yy, 9, 9, FARBE.waffe, 0, 0, 2, 0), 'bestückt');
    eintrag((xx, yy) => rand(c, xx, yy, 9, 9, 'waffe'), 'frei');
    if (mitNeu) eintrag((xx, yy) => { schraffur(c, xx + 1, yy + 1, 7, 7, 'modul', 3); rand(c, xx, yy, 9, 9, 'modul'); }, 'öffnet');
    else eintrag((xx, yy) => { rect(c, xx, yy, 9, 9, 'raumZu'); schraffur(c, xx, yy, 9, 9, 'schraffurZu', 3); strich(c, xx, yy, 9, 9, 'platzZu', 2); }, 'nicht ausgebaut');
  }

  // ================================================================= rechte Spalte
  // k: { ort, art: 'werft'|'hafen', marken, gesperrt }
  function zeichneKopf(c, r, k) {
    const e = txtRolle(c, k.ort || '', r.x, r.y + 2, k.gesperrt ? 'warn' : 'preis', 'titel');
    txt(c, k.art === 'werft' ? 'FLOTTENBASIS · WERFT' : 'HAFEN', e + 8, r.y + 2, 'dim');
    const mw = txt(c, String(k.marken == null ? '' : k.marken), r.x + r.w, r.y, 'text', { scale: 2, align: 'right' });
    txt(c, 'MARKEN', r.x + r.w - tw(String(k.marken), 2) - 6, r.y + 6, 'dim', { align: 'right' }); return mw;
  }
  // p: { kappe: '9' | 'F4', titel, lage, fn: 'waffe'|'modul' }
  function zeichnePlatzKopf(c, r, p) {
    const col = F(p.fn || 'waffe'), kw = Math.max(24, tw(p.kappe, 2) + 10);
    cham(c, r.x, r.y, kw, 22, col, 0, 0, 4, 0); txt(c, p.kappe, r.x + kw / 2, r.y + 4, 'ink', { scale: 2, align: 'center' });
    txtRolle(c, p.titel, r.x + kw + 8, r.y + 2, 'text', 'titel'); txt(c, p.lage || '', r.x + kw + 8, r.y + 13, 'dim');
  }
  // l: { teile: [{ id, art: 'waffe'|'modul', name, wirkung, energie (Text), zustand: 'eingebaut'|'frei'|'kostet'|'gesperrt', preis, grund, onClick }], gewaehlt: id,
  //      fn: 'waffe'|'modul' (Farbe der Auswahlfläche) }
  // Zeile: Zeile 1 Name links, rechts Energie (dim) und Zustand; darunter der Wirkungssatz über die volle Breite (2 Zeilen, die gewählte Zeile 3).
  function zeichneTeilliste(c, r, l) {
    const teile = l.teile || [], n = Math.max(1, teile.length), luft = 2, zl = SCHRIFT.zeile;
    const tx0 = 36, textW = r.w - tx0 - 8;
    // Höhe je Zeile: so viele Wirkungszeilen, wie der Text braucht (höchstens 2, gewählt 3), solange die Liste in r.h passt
    const braucht = teile.map((t) => Math.max(1, R.wrap(String(t.wirkung || ''), textW, 1).length));
    const hoehe = (maxN, maxSel) => teile.map((t, i) => 13 + Math.min(braucht[i], t.id === l.gewaehlt ? maxSel : maxN) * zl + 3);
    const passt = (h) => h.reduce((a, b) => a + b, 0) + (n - 1) * luft <= r.h;
    let hs = hoehe(2, 3); if (!passt(hs)) hs = hoehe(2, 2);
    if (!passt(hs)) hs = hoehe(1, 2);   // Zwischenstufe: nur der gewählte Eintrag behält zwei Zeilen
    if (!passt(hs)) hs = hoehe(1, 1);
    const sel = F(l.fn || 'waffe');
    let y = r.y;
    teile.forEach((t, i) => {
      const x = r.x, w = r.w, rh = hs[i], gew = t.id === l.gewaehlt, frei = t.zustand === 'frei' || t.zustand === 'eingebaut';
      const b = { x, y, w, h: rh, label: t.name, onClick: t.onClick, disabled: false };
      if (gew) cham(c, x, y, w, rh, sel, 0, 0, 6, 0);
      else { cham(c, x, y, w, rh, frei ? FARBE.kachel : FARBE.kachelZu, 0, 0, 6, 0); if (hit(b)) rand(c, x, y, w, rh, mix(sel, FARBE.grund, 0.4)); }
      if (t.zustand === 'eingebaut' && !gew) rect(c, x, y, 3, rh, sel);
      if (t.zustand === 'gesperrt' && !gew) strich(c, x, y, w, rh, 'platzZu', 2);
      // Kontrast: nur „gesperrt“ nimmt textZu; „kostet“ liest wie „frei“ (Name text, Wirkung dim), gewählt = ink auf der Auswahlfläche
      const kostet = t.zustand === 'kostet';
      const ink = gew ? 'ink' : (frei || kostet) ? 'text' : 'textZu', sub = gew ? FARBE.ink : (frei || kostet) ? FARBE.dim : FARBE.textZu;
      symbolTeil(c, t, x + 18, y + 15, { scale: 2, color: gew ? mix(FARBE.ink, sel, 0.12) : frei ? sel : kostet ? FARBE.dim : FARBE.textZu });
      if (hit(b) && t.wirkung) R.ui.tooltip = { text: t.wirkung, x: R.ui.mouse.x, y: R.ui.mouse.y };   // voller Wirkungssatz, wenn die Liste ihn kürzen musste
      const tx = x + tx0;
      txt(c, t.name, tx, y + 3, ink);
      const zeilen = Math.round((rh - 16) / zl);
      umbruch(t.wirkung, textW, zeilen).forEach((z, j) => txt(c, z, tx, y + 13 + j * zl, sub));
      // rechts in Zeile 1: Energie, Zustand (bei „kostet“ mit Kappe F davor)
      let zx = x + w - 6;
      const tag = t.zustand === 'eingebaut' ? 'EINGEBAUT' : t.zustand === 'frei' ? 'FREI' : t.zustand === 'kostet' ? (t.preis + ' M') : (t.grund || 'GESPERRT');
      const tagCol = gew ? 'ink' : t.zustand === 'eingebaut' ? 'modul' : t.zustand === 'frei' ? 'dim' : t.zustand === 'kostet' ? 'preis' : 'dim';
      txt(c, tag, zx, y + 3, tagCol, { align: 'right' }); zx -= tw(tag);
      if (t.zustand === 'kostet') { const kz = kappe('terminal.freischalten', 'F'), kw = tw(kz) + 6; zx -= kw + 4; cham(c, zx, y + 2, kw, 9, gew ? mix(FARBE.ink, sel, 0.3) : mix(FARBE.preis, FARBE.grund, 0.55), 2, 0, 0, 0); txt(c, kz, zx + kw / 2, y + 3, 'text', { align: 'center' }); }
      if (t.energie) txt(c, t.energie, zx - 8, y + 3, gew ? sub : frei ? 'dim' : 'textZu', { align: 'right' });
      klick(b);
      y += rh + luft;
    });
  }
  // v: { titel ('VORSCHAU'), fn, zeilen: [{ label, vorher, nachher, segs: max | null, fn }], seiten: [{ label: 'BB', text, neu: bool }] }
  function zeichneVorschau(c, r, v) {
    if (!(v.zeilen || []).length && !(v.seiten || []).length) return;   // nichts zu zeigen: auch keinen Titel
    txtRolle(c, v.titel || 'VORSCHAU', r.x, r.y, v.fn || 'waffe', 'titel');
    const halb = Math.floor(r.w / 2) - 4;
    (v.zeilen || []).slice(0, 2).forEach((z, i) => {
      const y = r.y + 12 + i * 11; let x = txt(c, z.label, r.x, y, z.fn || 'modul') + 6;
      if (z.verteilung) {   // Energieverteilung A S W: Buchstabe in Funktionsfarbe, die geänderte Stelle nachher in text, der Rest dim
        const V = z.verteilung, K3 = [['A', 'antrieb'], ['S', 'modul'], ['W', 'waffe']];
        const teil = (arr, ref) => K3.forEach(([k, col], q) => { x = txt(c, k, x, y, col); x = txt(c, String(arr[q]), x, y, ref && ref[q] !== arr[q] ? 'text' : 'dim') + 4; });
        teil(V.vorher, null); x = txt(c, '→', x, y, 'dim') + 4; teil(V.nachher, V.vorher);
        return;
      }
      if (z.segs) { x = P.segs(c, x, y, z.segs, Math.min(z.segs, +z.nachher || 0), z.fn === 'dim' ? FARBE.dim : F(z.fn || 'modul'), 8, 7) + 4; }
      const gleich = String(z.vorher) === String(z.nachher);
      x = txt(c, z.vorher + ' → ' + z.nachher, x, y, gleich ? 'dim' : 'text');
      if (gleich && z.gleichText !== false) txt(c, z.gleichText || 'gleich', x + 6, y, 'dim');
    });
    // Seiten: [{ label: 'STB', teile: [{ t: '6 Standard' }, { t: '9 Streu', neu: true }] }] – das neue Teil in der Farbe der Auswahl
    (v.seiten || []).slice(0, 2).forEach((s, i) => {
      const y = r.y + 12 + i * 11; let x = r.x + halb + 8;
      const neu = (s.teile || []).some((q) => q.neu);
      txt(c, s.label, x, y, neu ? 'text' : 'dim'); x += Math.max(22, tw(s.label) + 4);   // BUG, HECK sind breiter als BB und STB
      (s.teile || [{ t: s.text }]).forEach((q, j) => { if (j) x = txt(c, ' · ', x, y, 'dim'); x = txt(c, q.t, x, y, q.neu ? (v.fn || 'waffe') : neu ? 'text' : 'dim'); });
    });
  }
  // s: { stufe (gekauft), ziel, stufen: [{ waffen, module, preis }], oeffnet: [{ kappe, text }], marken: [vorher, nachher], hinweis, energie }
  function zeichneStufen(c, r, s) {
    txtRolle(c, 'AUSBAUSTUFE', r.x, r.y, 'dim', 'titel');
    const n = s.stufen.length, tw4 = Math.floor((r.w - (n - 1) * 4) / n);
    s.stufen.forEach((st, i) => {
      const x = r.x + i * (tw4 + 4), y = r.y + 12, hat = i <= s.stufe, ziel = i === s.ziel;
      cham(c, x, y, tw4, 30, ziel ? FARBE.modul : hat ? FARBE.modulRaum : FARBE.kachelZu, 0, 0, 5, 0);
      txt(c, String(i), x + 6, y + 5, ziel ? 'ink' : hat ? 'modul' : 'dim', { scale: 2 });
      txt(c, st.waffen + ' WAFFEN', x + 22, y + 5, ziel ? 'ink' : hat ? 'text' : 'dim'); txt(c, st.module + ' MODULE', x + 22, y + 16, ziel ? 'ink' : hat ? 'text' : 'dim');
      txt(c, hat ? 'GEKAUFT' : st.preis + ' M', x + tw4 - 2, y + 34, hat ? 'modul' : 'preis', { align: 'right' });
    });
    if (s.voll) { txt(c, s.hinweis || 'Das Schiff ist voll ausgebaut.', r.x, r.y + 60, 'modul'); return; }   // alles gekauft: nur dieser Satz, kein „öffnet“, keine Marken
    if (s.ziel == null) return;
    txtRolle(c, 'STUFE ' + s.ziel + ' ÖFFNET', r.x, r.y + 60, 'modul', 'titel');
    (s.oeffnet || []).forEach((o, i) => { const y = r.y + 74 + i * 13; const kw = Math.max(18, tw(o.kappe) + 8); cham(c, r.x, y - 2, kw, 11, FARBE.modul, 0, 0, 2, 0); txt(c, o.kappe, r.x + kw / 2, y, 'ink', { align: 'center' }); txt(c, o.text, r.x + kw + 6, y, 'text'); });
    const y2 = r.y + 74 + (s.oeffnet || []).length * 13 + 4;
    umbruch(s.hinweis || '', r.w, 2).forEach((z, i) => txt(c, z, r.x, y2 + i * SCHRIFT.zeileLuft, 'dim'));
    const y3 = r.y + r.h - 22;
    txt(c, 'MARKEN', r.x, y3 + 5, 'dim'); txt(c, s.marken[0] + ' → ' + s.marken[1], r.x + 44, y3, 'text', { scale: 2 });
    if (s.energie) { txt(c, 'ENERGIE', r.x + 180, y3 + 5, 'dim'); txt(c, s.energie, r.x + 180, y3 + 15, 'dim'); }
  }
  // g: { titel ('WERFT GESPERRT'), grund ('Nur an Flottenbasen.'), text, bestueckung: [{ kappe, name, fn }] }
  function zeichneGesperrt(c, r, g) {
    const h = 86; cham(c, r.x, r.y, r.w, h, F('warnGrund'), 0, 0, 6, 0); rect(c, r.x, r.y, 3, h, 'warn');
    txtRolle(c, g.titel || 'WERFT GESPERRT', r.x + 14, r.y + 12, 'warn', 'titel');
    txt(c, g.grund || '', r.x + 14, r.y + 32, 'text');
    umbruch(g.text || '', r.w - 28, 4).forEach((z, i) => txt(c, z, r.x + 14, r.y + 46 + i * SCHRIFT.zeileLuft, 'dim'));
    const y = r.y + h + 12; txt(c, 'Bestückung (nur Ansicht)', r.x, y, 'dim');
    // links Waffen, rechts Module
    const list = g.bestueckung || [];
    [list.filter((b) => b.fn !== 'modul'), list.filter((b) => b.fn === 'modul')].forEach((sp, j) => sp.forEach((b, i) => {
      const x = r.x + j * Math.floor(r.w / 2), yy = y + 14 + i * 11; txt(c, b.kappe, x + 8, yy, b.fn || 'waffe', { align: 'center' }); txt(c, b.name, x + 20, yy, 'dim');
    }));
  }
  // h: { artikel: [{ id, name, art ('Vorrat'|'Ausrüstung'|'Deko'), preis, besitz, grund, guenstiger, onClick }], gewaehlt: id, info: { text, grund } }
  function zeichneHandel(c, r, info, h) {
    const cols = 3, luft = 4, cw = Math.floor((r.w - (cols - 1) * luft) / cols), ch = 22;
    txtRolle(c, 'HANDEL', r.x, r.y - 13, 'preis', 'titel'); txt(c, kappe('terminal.teil', '↑↓') + ' wählen · ' + kappe('terminal.kaufen', 'Ent') + ' kaufen', r.x + r.w, r.y - 13, 'dim', { align: 'right' });
    (h.artikel || []).forEach((a, i) => {
      const x = r.x + (i % cols) * (cw + luft), y = r.y + Math.floor(i / cols) * (ch + 3); if (y + ch > r.y + r.h) return;
      const gew = a.id === h.gewaehlt, zu = !!a.grund, b = { x, y, w: cw, h: ch, label: a.name, onClick: a.onClick, disabled: zu, reason: a.grund };
      if (gew) cham(c, x, y, cw, ch, zu ? SK.offLine : FARBE.preis, 0, 0, 4, 0);
      else { cham(c, x, y, cw, ch, zu ? FARBE.kachelZu : FARBE.kachel, 0, 0, 4, 0); rect(c, x, y, 2, ch, zu ? SK.offLine : FARBE.preis); }
      const ink = gew ? (zu ? 'text' : 'ink') : zu ? 'textZu' : 'text';
      // Unterzeile nur Art und Besitz (gekürzt); der Grund steht einmal in der Infozeile (h.info.grund), gesperrte Kacheln dimmen nur über Fläche und Preis
      txt(c, a.name, x + 7, y + 3, ink); txt(c, umbruch(a.art + (a.besitz ? ' · ' + a.besitz : ''), cw - 14, 1)[0] || '', x + 7, y + 12, gew ? (zu ? 'text' : 'ink') : 'dim');
      txt(c, a.preis + ' M', x + cw - 5, y + 3, gew ? ink : zu ? 'textZu' : a.guenstiger ? 'modul' : 'preis', { align: 'right' });
      klick(b);
    });
    if (h.info) { rect(c, info.x, info.y - 3, info.w, 1, 'trenner'); umbruch(h.info.text, info.w - 200, 2).forEach((z, i) => txt(c, z, info.x, info.y + 2 + i * SCHRIFT.zeileLuft, 'text')); if (h.info.grund) txt(c, h.info.grund, info.x + info.w, info.y + 2, 'warn', { align: 'right' }); }
  }

  // ================================================================= Pult unten
  // z: { plaetze { 1..9: { zustand, waffe (Katalog-Id), stufe } }, gewaehlt, gesperrt, onPlatz(k) }
  function zeichneKreuz(c, L, z) {
    P.titel(c, L.kreuzTitel.x, L.kreuzTitel.y, L.kreuzTitel.w, 'WAFFENPLATZ', 'weapon');
    const KAT = window.Shared_Schiffskatalog;
    for (let p = 1; p <= 9; p++) {
      const r = L.kreuz[p], pl = (z.plaetze || {})[p] || {}, kz = kappe('terminal.platz' + p, String(p));
      if (pl.zustand === 'zu' || pl.zustand === 'neu' || !pl.zustand) {
        const neu = pl.zustand === 'neu';
        strich(c, r.x, r.y, r.w, r.h, neu ? 'modul' : 'platzZu', 3); txt(c, kz, r.x + 6, r.y + 5, neu ? 'modul' : 'textZu', { align: 'center' });
        txt(c, neu ? 'NEU' : pl.stufe ? 'Stufe ' + pl.stufe : 'ZU', r.x + 16, r.y + 5, neu ? 'modul' : 'textZu');
        continue;
      }
      const w = pl.waffe && KAT ? KAT.BY_ID[pl.waffe] : null;
      const zustand = z.gesperrt ? 'off' : pl.zustand === 'offen' ? 'off' : p === z.gewaehlt ? 'sel' : 'normal';
      P.zelle(c, r.x, r.y, r.w, r.h, kz, w ? w.kurz : 'leer', null, 'weapon', zustand, 0, { label: 'Platz ' + p, rechts: 1, onClick: z.onPlatz ? () => z.onPlatz(p) : null, reason: z.gesperrt ? z.grund : null });
      if (zustand === 'off' && p === z.gewaehlt && !z.gesperrt) rand(c, r.x - 2, r.y - 2, r.w + 4, r.h + 4, 'text');   // gewählter leerer Platz
    }
  }
  // z: { module { 1..4: { zustand, modul, stufe } }, gewaehlt ('F2'), gesperrt, onModul(n), energie: 'Module 3 · frei 5' }
  function zeichneModulraeume(c, L, z) {
    P.titel(c, L.modulTitel.x, L.modulTitel.y, L.modulTitel.w, 'MODULRAUM', 'shield');
    const KAT = window.Shared_Schiffskatalog, NAMEN = (KAT && KAT.MODUL_NAMEN) || {};
    const KURZ = { frachtraum: 'FRACHT', krankenstation: 'KRANKEN', werkstatt: 'WERKST.' };
    for (let m = 1; m <= 4; m++) {
      const r = L.module[m], mr = (z.module || {})[m] || {}, kz = kappe('terminal.modul' + m, 'F' + m);
      if (mr.zustand === 'zu' || mr.zustand === 'neu' || !mr.zustand) {
        const neu = mr.zustand === 'neu';
        strich(c, r.x, r.y, r.w, r.h, neu ? 'modul' : 'platzZu', 3); txt(c, kz, r.x + 8, r.y + 5, neu ? 'modul' : 'textZu', { align: 'center' });
        txt(c, neu ? 'NEU' : mr.stufe ? 'Stufe ' + mr.stufe : 'ZU', r.x + 20, r.y + 5, neu ? 'modul' : 'textZu');
        continue;
      }
      const zustand = z.gesperrt || !mr.modul ? 'off' : z.gewaehlt === 'F' + m ? 'sel' : 'normal';
      P.zelle(c, r.x, r.y, r.w, r.h, kz, mr.modul ? KURZ[mr.modul] || NAMEN[mr.modul] : 'leer', null, 'shield', zustand, 0, { label: 'Modulraum ' + m, onClick: z.onModul ? () => z.onModul(m) : null });
      if (zustand === 'off' && z.gewaehlt === 'F' + m && !z.gesperrt) rand(c, r.x - 2, r.y - 2, r.w + 4, r.h + 4, 'text');
    }
    if (z.energie) txt(c, z.energie, L.energie.x, L.energie.y, 'dim');
  }
  // b: { bereich: 'handel'|'werft', werftZu: bool (Nicht-Werft-Hafen), onBereich(b) }
  function zeichneBereich(c, A, b) {
    P.knopf(c, A.handel.x, A.handel.y, A.handel.w, A.handel.h, 'Handel', { hotkey: kappe('terminal.handel', 'H'), fn: 'nav', active: b.bereich === 'handel', onClick: b.onBereich ? () => b.onBereich('handel') : null });
    P.knopf(c, A.werft.x, A.werft.y, A.werft.w, A.werft.h, 'Werft', { hotkey: kappe('terminal.werft', 'W'), fn: b.werftZu ? 'neutral' : 'nav', text: b.werftZu ? 'Werft · zu' : 'Werft', active: b.bereich === 'werft', onClick: b.onBereich ? () => b.onBereich('werft') : null });
  }
  // a: { haupt: { art: 'umbau'|'freischalten'|'stufe'|'kaufen'|'handel', text, disabled, grund, onClick }, hinweis: { text, fn }, ausbau: { active, disabled, onClick }, teil: { disabled, onClick } }
  const HAUPT = {
    umbau: { aktion: 'terminal.bestaetigen', taste: 'Ent', fn: 'weapon' }, modul: { aktion: 'terminal.bestaetigen', taste: 'Ent', fn: 'shield' },
    freischalten: { aktion: 'terminal.freischalten', taste: 'F', fn: 'nav' }, kaufen: { aktion: 'terminal.kaufen', taste: 'Ent', fn: 'nav' },
    handel: { aktion: 'terminal.handel', taste: 'H', fn: 'nav' },
  };
  function zeichneAktionen(c, A, a) {
    const h = a.haupt || {}, d = HAUPT[h.art] || HAUPT.umbau;
    P.knopf(c, A.haupt.x, A.haupt.y, A.haupt.w, A.haupt.h, h.label || h.text, { hotkey: kappe(d.aktion, d.taste), fn: d.fn, text: h.text, disabled: !!h.disabled, reason: h.grund, onClick: h.onClick });
    if (a.hinweis) txt(c, a.hinweis.text, A.hinweis.x, A.hinweis.y, a.hinweis.fn || 'dim');
    const au = a.ausbau || {}, te = a.teil || {};
    P.knopf(c, A.ausbau.x, A.ausbau.y, A.ausbau.w, A.ausbau.h, 'Ausbau', { hotkey: kappe('terminal.ausbau', 'A'), fn: 'neutral', active: !!au.active, disabled: !!au.disabled, reason: au.grund, onClick: au.onClick });
    P.knopf(c, A.teil.x, A.teil.y, A.teil.w, A.teil.h, 'Teil', { hotkey: kappe('terminal.teil', '↑↓'), fn: 'neutral', disabled: !!te.disabled, reason: te.grund, onClick: te.onClick });
  }
  // s: { amGeraet: Farbindex 0–3 | null, zusehen: [Farbindex] }
  function zeichneStatus(c, r, s) {
    let x = txt(c, 'AM GERÄT', r.x, r.y, 'dim') + 5;
    const farbe = (i) => { rect(c, x, r.y, 7, 7, FARBE.spieler[i]); x = txt(c, SPIELER_NAMEN[i], x + 10, r.y, 'text') + 8; };
    if (s.amGeraet != null) farbe(s.amGeraet); else x = txt(c, 'frei', x, r.y, 'dim') + 8;
    if ((s.zusehen || []).length) { x = txt(c, '· ZUSEHEN', x, r.y, 'dim') + 5; s.zusehen.forEach(farbe); }
  }

  // ================================================================= ganzes Terminal
  // m: { bereich: 'werft'|'handel', ansicht: 'platz'|'modul'|'stufe'|'gesperrt' (nur Werft), kopf, schnitt, platzKopf, liste, vorschau, stufen, gesperrt, handel,
  //      kreuz, module, aktionen, status, bereichUmschalter }   (Felder je Baustein wie oben)
  function zeichneTerminal(c, view, m) {
    const L = layout(VW, VH);
    const neu = m.ansicht === 'stufe';
    const g = P.rahmen(c, view, { titel: m.titel || 'TERMINAL', S, station: 'shop', anzeige: (cc) => {
      if (m.bereich === 'handel') { zeichneKopf(cc, { x: 70, y: 10, w: 558, h: 14 }, m.kopf); zeichneHandel(cc, L.handel, L.handelInfo, m.handel || {}); return; }
      zeichneSchnitt(cc, L, m.schnitt || {});
      zeichneLegende(cc, L.legende, neu, m.ansicht === 'gesperrt');
      rect(cc, RASTER.trennerX, 12, 1, 214, 'trenner');
      zeichneKopf(cc, L.kopf, m.kopf || {});
      if (m.ansicht === 'gesperrt') { zeichneGesperrt(cc, { x: L.rechts.x, y: 32, w: L.rechts.w, h: 190 }, m.gesperrt || {}); return; }
      if (neu) { zeichneStufen(cc, { x: L.rechts.x, y: 30, w: L.rechts.w, h: 196 }, m.stufen); return; }
      if (m.platzKopf) zeichnePlatzKopf(cc, L.platzKopf, m.platzKopf);
      if (m.liste) zeichneTeilliste(cc, L.liste, m.liste);
      if (m.vorschau) zeichneVorschau(cc, L.vorschau, m.vorschau);
    } });
    zeichneKreuz(c, L, m.kreuz || {});
    zeichneModulraeume(c, L, m.module || {});
    zeichneBereich(c, L.aktionen, m.bereichUmschalter || { bereich: m.bereich });
    zeichneAktionen(c, L.aktionen, m.aktionen || {});
    zeichneStatus(c, L.status, m.status || {});
    if (m.rahmenFarbe != null && FARBE.spieler[m.rahmenFarbe]) rand(c, L.anzeige.x, L.anzeige.y, L.anzeige.w, L.anzeige.h, FARBE.spieler[m.rahmenFarbe]);   // Zuschauer: 1-px-Rahmen in der Farbe des Nutzers am Gerät
    P.zeichneHilfe(c);
    return { layout: L, rahmen: g };
  }

  window.PultTerminal = {
    TOKENS, SYMBOLE_MODUL, layout, zeichneTerminal,
    zeichneSchnitt, zeichneLegende, zeichneKopf, zeichnePlatzKopf, zeichneTeilliste, zeichneVorschau, zeichneStufen, zeichneGesperrt, zeichneHandel,
    zeichneKreuz, zeichneModulraeume, zeichneBereich, zeichneAktionen, zeichneStatus, symbolModul, symbolTeil,
    txt, tw, umbruch, kappe, kontrast,
  };
})();
