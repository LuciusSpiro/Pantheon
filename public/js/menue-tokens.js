// CHA-01 Paket E, Designer, Modus System: Tokens des Startmenüs nach MEN-01 Richtung A „Rampe“ (Kai 2026-10-31): Key-Art vollflächig,
// Gold auf Fast-Schwarz, Daten auf deckenden Kacheln, Bildmarke „Vier Stufen“. Dazu aus der Empfehlung: Status-Stempel (AN BORD / NICHT BEREIT) und
// großer Raumcode aus Richtung C, schmale Statuszeile unten aus Richtung B.
// Globales `Menue` (in Node als Modul, für tools/test-kammer-tokens.js). Nur Daten und kleine reine Hilfen: kein Zustand, kein Netz, keine Regeln.
// Gestaltungsnotiz: vault Pantheon/„Auftrag CHA-01 – Tokens“. Referenzzeichnung: public/kammer-preview.html, Bilder mit node tools/sicht-kammer.js.
//
//   Menue.TOKENS                  { FARBE, BILD, VERLAUF, SCHRIFT, MASS, STEMPEL, MARKE, SCHRIFTZUG, TEXT, FN }
//   Menue.deckung(schirm, x, y)   -> Deckkraft der Abdunklung über dem Bild an (x, y) (0..1), aus VERLAUF[schirm]
//   Menue.unterlage(schirm, x, y, hell?) -> Hex-Farbe unter einem Text an (x, y) im schlimmsten Fall (Bild weiß, gedimmt mit BILD.hell[schirm])
//   Menue.ueber(farbe, deckkraft, unter) -> Hex-Farbe einer halbdeckenden Fläche über `unter`
//   Menue.raster(zeilen, s)       -> Rechtecke { x, y, w, h, kern } eines Pixelrasters (MARKE, SCHRIFTZUG) in Schritten zu s px, zeilenweise zusammengefasst
//   Menue.sperrung(s, sp, skala, measure) -> { w, zeichen: [{ z, x }] } Pixelschrift mit Sperrung (art.js kann keine Sperrung): Zeichen einzeln setzen
//   Menue.spieler(i)              -> { farbe, form } aus shared/protocol.js
//   Menue.text(vorlage, werte), Menue.kontrast(a, b)
//
// Regeln (kurz, ausführlich in der Notiz):
//   - Das Bild liegt als eigene Ebene UNTER dem HUD-Canvas (wie #world3d), CSS `filter: brightness(BILD.hell[schirm])`, object-fit cover.
//     Der Canvas bleibt dort durchsichtig und zeichnet nur die Abdunklung (VERLAUF) und die Daten. Kein Rahmen um das Bild.
//   - Gold (FN.drive) nur für Auswahl und den einen Hauptknopf je Bildschirm. Messing (FN.nav) für Gruppen, Marke, GASTGEBER. Mint = bereit, Gelb = nicht bereit.
//   - Daten stehen auf Kacheln (FARBE.kachel, Deckkraft 0,9 – der Test rechnet mit weißem Bild darunter) oder auf dem Verlauf an Stellen, die der Test
//     prüft (MASS.textzonen). Wer Text an eine neue Stelle über das Bild setzt, trägt die Zone dort ein.
//   - Schrift: nur Pixelschrift. art.js kann Skala 1–3 und keine Sperrung: Sperrung über sperrung() Zeichen für Zeichen, Skala 4 nur für den
//     Schriftzug, und der kommt als Raster (SCHRIFTZUG, gleiche Pixel wie art.js, der Test prüft das).
//   - Status nie nur als Farbe: Stempel mit Rand und Wort (AN BORD durchgezogen, NICHT BEREIT gestrichelt), GASTGEBER als volle Messingfläche.
//   - Die Karten der Lobby sind die Karten der Charakterliste (pult-kammer-tokens.js), schmaler, Name in Spielerfarbe, Form oben rechts.
//   - Farbwerte stehen nur zwischen „// <tokens>“ und „// </tokens>“ (tools/check-terminal-farben.js prüft diese Datei mit).
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Menue = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const P = root && root.Pult;
  const PROTO = (root && root.Shared_Protocol) || (typeof require === 'function' ? require('../../shared/protocol.js') : {});

  // ================================================================= TOKENS
  // <tokens>
  // Funktionsfarben der Pulte (pult.js); in Node der Spiegel (der Test prüft ihn)
  const FN = (P && P.FN) || { drive: '#FFC66B', shield: '#7FE0C2', weapon: '#E0473C', sensor: '#A9D6E5', nav: '#C9974A', cmd: '#F4EEDC', warn: '#F2C94C', neutral: '#8EA3B5', locked: '#6B7380' };

  // Palette A „Rampe“: Glut und Gold auf Fast-Schwarz. Kein Skin: das Startmenü ist kein Schiff.
  const FARBE = {
    grund: '#07070A',             // Fast-Schwarz, auch Farbe des Verlaufs
    kachel: '#09090C',            // deckende Kachel (Deckkraft MASS.kachelDeckkraft)
    kachelRand: '#3A3428',        // 1-px-Linie, nur Ordnung
    statuszeile: '#0E0E12',       // schmale Statuszeile unten, voll deckend
    text: FN.cmd,                 // Creme
    dim: '#B3A48E',               // gedämpft, warm (≥ 7,4 auf Kachel)
    gold: FN.drive,               // Auswahl, Hauptknopf, Raumcode
    messing: FN.nav,              // Gruppen, Marke, GASTGEBER
    tinte: '#120D0A',             // Schrift auf Gold und Messing
    bereit: FN.shield,            // Mint: an Bord / bereit
    nichtBereit: FN.warn,         // Gelb: nicht bereit, „wartet auf“
    karte: '#0D1018',             // Grund der Lobby-Karten (voll deckend, wie Kachel der Charakterliste)
    karteRand: '#3A4A66',         // = Pult rom offLine
    freiSchraffur: '#141B2B',     // freier Platz in der Lobby (wie Charakterliste)
    kappe: '#2A2F3D', kappeText: FN.cmd,   // dunkle Tastenkappe wie im Pult
    formPlatte: '#0B0E1A',        // Platte unter der Spielerform auf dem Porträt (wie Namensmarke)
    weiss: '#FFFFFF',             // nur für die Rechnung „schlimmster Fall Bild“ im Test
  };
  // Bild (Key-Art „Rampe“, Seed 5201, generiert, MEN-01): Datei, Helligkeit je Bildschirm (CSS brightness)
  const BILD = {
    datei: 'img/keyart-rampe.jpg', breite: 1536, hoehe: 864,
    hell: { titel: 0.95, menue: 0.7, lobby: 0.55, beitritt: 0.6 },
  };
  // Abdunklung über dem Bild: von links (Anteil der Breite → Deckkraft) und von unten (ab y bis 360, Deckkraft unten). Lesefläche links, Bild rechts.
  const VERLAUF = {
    titel: { links: [[0, 0.96], [0.34, 0.88], [0.62, 0]], unten: { ab: 250, bis: 0.85 } },
    menue: { links: [[0, 0.96], [0.42, 0.86], [0.66, 0]], unten: { ab: 250, bis: 0.85 } },
    lobby: { links: [[0, 0.96], [0.45, 0.82], [0.8, 0.2]], unten: { ab: 230, bis: 0.9 } },
    beitritt: { links: [[0, 0.96], [0.5, 0.86], [0.8, 0.3]], unten: { ab: 230, bis: 0.9 } },
  };
  // Typoskala (Pixelschrift art.js). sp = Sperrung in px je Zeichen (über sperrung()), versal = Text in Versalien setzen.
  const SCHRIFT = {
    text: { skala: 1 },                                   // Fließtext, Hinweise, Zeilen
    gruppe: { skala: 1, sp: 1, versal: true },            // SPIELEN, FORTSETZEN, RAUMCODE, CREW 3/4, Stempel
    claim: { skala: 1, sp: 1 },                           // „Eine Crew, ein Schiff.“ in Gold
    name: { skala: 1, sp: 1, versal: true },              // Namen auf Karten
    detail: { skala: 2 },                                 // Titel der Detailkachel, FREI
    modus: { skala: 3 },                                  // Modusname in der Lobby, Name des Einladenden
    raumcode: { skala: 3, sp: 3 },                        // großer Raumcode (Mockup Skala 4: art.js kann höchstens 3)
    schriftzug: { skala: 4, raster: true },               // PANTHEON im Titel: Raster SCHRIFTZUG
    zeile: 10,                                            // Zeilenabstand Skala 1
  };
  // Maße im Spielraster 640×360 (absolut)
  const MASS = {
    rand: 32, oben: 20,
    kachelDeckkraft: 0.9,
    lockup: { x: 32, y: 20, marke: 1, abstand: 6, schriftzugY: 5 },          // klein oben links: Marke 16 px + Schriftzug Skala 1
    charakter: { x: 520, y: 16, w: 104, h: 30, bild: 28 },                   // gewählter Charakter oben rechts (Titel, Menü)
    titel: { x: 40, marke: { y: 88, s: 3 }, schriftzug: { y: 160, s: 4 }, claim: 196, unterzeile: 210, knopf: { y: 252, w: 136 }, hinweise: 284, fuss: 340 },
    menue: { x: 32, y: 54, w: 220, gruppe: 13, zeile: 15, zeileSub: 22, fuge: 2, gruppenAbstand: 8, detail: { x: 384, y: 216, w: 240, h: 126 }, hinweise: 340 },
    lobby: {
      modus: { x: 32, y: 50 },
      raumcode: { x: 444, y: 16, w: 180, h: 92 },
      crew: { x: 32, y: 146, w: 112, h: 158, fuge: 10, bild: 94 },        // Karte wie Charakterliste, schmaler (112 statt 132); G: 8 px tiefer, damit zwei Chip-Reihen ≥ 10 px Abstand zu „CREW“ haben
      start: { x: 524, y: 146, w: 100, h: 158 },
      hinweise: 324,
    },
    statuszeile: { y: 342, h: 18, innen: 8, feldAbstand: 14 },               // aus Richtung B: Modus · Crew · Bereit · Raum
    knopf: { h: 20, schraeg: 4, kappeH: 14, kappeInnen: 3 },                  // Hauptknopf Gold mit eingesetzter Kappe in Tinte
    kappe: { h: 13, minW: 13, innen: 7, schraeg: 3 },
    cursor: { innen: 1, aussen: 3 },                                         // Cursor-Doppelrand wie in der Kleiderkammer: Messing nah, Creme außen
    // Raumcode-Eingang (Stil A): eine Kachel links; feld = Eingabefeld (DOM-Input, client.js), knopfY/fehlerY relativ zur Kachel
    eingang: { x: 32, y: 96, w: 300, h: 120, feld: { x: 42, y: 142, w: 150, h: 24 }, knopfY: 78, knopfW: 170, fehlerY: 104 },
    auswahl: { balken: 2, deckkraft: 0.12 },                                 // gewählte Zeile: Goldbalken links + Goldfläche
    karte: { kappe: 13, formPlatte: 13, form: 4, formDeckkraft: 0.85, nameY: 4, zeileY: 16 },
    // Textzonen über dem Bild (nicht auf Kachel): [schirm, x0, y0, x1, y1, farbe, mindestwert] – der Test prüft jede im schlimmsten Fall
    textzonen: [
      ['titel', 40, 196, 210, 205, 'gold', 4.5], ['titel', 40, 210, 200, 219, 'dim', 4.5], ['titel', 40, 284, 240, 297, 'dim', 4.5], ['titel', 40, 340, 200, 349, 'dim', 4.5],
      ['titel', 40, 160, 284, 188, 'text', 3],
      ['menue', 32, 54, 252, 250, 'text', 4.5], ['menue', 32, 54, 252, 250, 'dim', 4.5], ['menue', 32, 54, 252, 250, 'messing', 4.5], ['menue', 32, 340, 330, 349, 'dim', 4.5],
      ['lobby', 32, 50, 280, 59, 'messing', 4.5], ['lobby', 32, 63, 330, 84, 'text', 3], ['lobby', 32, 90, 260, 115, 'dim', 4.5], ['lobby', 32, 134, 120, 143, 'messing', 4.5],
      ['lobby', 32, 324, 470, 337, 'dim', 4.5],
      ['beitritt', 32, 50, 300, 135, 'dim', 4.5], ['beitritt', 32, 63, 330, 84, 'text', 3], ['beitritt', 32, 160, 300, 169, 'messing', 4.5], ['beitritt', 32, 324, 470, 337, 'dim', 4.5],
    ],
  };
  // Stempel (Richtung C): Rand + Wort, Versalien gesperrt (Sperrung 1). voll = Fläche statt Rand (Text dann in Tinte). GASTGEBER links bündig auf dem Porträt.
  const STEMPEL = {
    h: 15, rand: 2, innen: 6, textY: 4, strich: 3,   // strich = Teilung des gestrichelten Rands
    anBord: { farbe: 'bereit', wort: 'BEREIT' },   // Schlüssel bleibt, das Wort heißt wie der Knopf
    nichtBereit: { farbe: 'nichtBereit', wort: 'NICHT BEREIT', gestrichelt: true },   // gestrichelt = noch nicht fertig (Form, nicht nur Gelb)
    gastgeber: { farbe: 'messing', wort: 'GASTGEBER', voll: true },
  };
  // Bildmarke „Vier Stufen“ (16×16, = public/img/logo/marke.svg): # Messing, * Gold (Kern = die Crew)
  const MARKE = [
    '#######..#######', '#######..#######', '#######..#######', '#####......#####',
    '#####......#####', '###..........###', '###..........###', '.......**.......',
    '.......**.......', '###..........###', '###..........###', '#####......#####',
    '#####......#####', '#######..#######', '#######..#######', '#######..#######',
  ];
  // Schriftzug PANTHEON (Arbeitstitel), Pixelschrift art.js mit Sperrung 2, 61×7 (= public/img/logo/schriftzug.svg). Neuer Name: Raster neu erzeugen
  // (node tools/test-kammer-tokens.js --schriftzug WORT gibt es aus).
  const SCHRIFTZUG = {
    wort: 'PANTHEON', sperrung: 2,
    raster: [
      '####.....###....#...#...#####...#...#...#####....###....#...#',
      '#...#...#...#...##..#.....#.....#...#...#.......#...#...##..#',
      '#...#...#...#...#.#.#.....#.....#...#...#.......#...#...#.#.#',
      '####....#####...#..##.....#.....#####...####....#...#...#..##',
      '#.......#...#...#...#.....#.....#...#...#.......#...#...#...#',
      '#.......#...#...#...#.....#.....#...#...#.......#...#...#...#',
      '#.......#...#...#...#.....#.....#...#...#####....###....#...#',
    ],
  };
  const TEXT = {
    claim: 'Eine Crew, ein Schiff.', unterzeile: 'Koop für 1–4 Spieler im Browser', fuss: 'Arbeitstitel',
    gruppe: { spielen: 'SPIELEN', fortsetzen: 'FORTSETZEN', uebung: 'ÜBUNGSPLATZ' }, uebungRechts: 'ohne Weltstand',
    knopf: { spielen: 'Spielen', raum: 'Raum öffnen', anBord: 'Mit {name} an Bord' },
    charakterWechseln: 'C wechseln', raumcode: 'RAUMCODE', linkKopieren: 'Link kopieren', crew: 'CREW {n}/4', frei: 'FREI', laedtEin: 'L lädt ein',
    start: 'START', startSatz: ['sobald alle', 'bereit sind'], wartetAuf: 'wartet auf', einladung: 'EINLADUNG', holtDich: 'holt dich an Bord.',
    status: { modus: 'MODUS', crew: 'CREW', bereit: 'BEREIT', raum: 'RAUM', gastgeber: 'GASTGEBER' },
  };
  // </tokens>

  const TOKENS = { FARBE, BILD, VERLAUF, SCHRIFT, MASS, STEMPEL, MARKE, SCHRIFTZUG, TEXT, FN };
  const VW = 640, VH = 360;

  // ================================================================= Hilfen (rein)
  function hex(h) { const n = parseInt(String(h).slice(1, 7), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function ueber(farbe, a, unter) { const F = hex(farbe), U = hex(unter); return '#' + F.map((v, i) => Math.round(a * v + (1 - a) * U[i]).toString(16).padStart(2, '0')).join(''); }
  function stufe(stops, t) {
    if (t <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) { const [p0, a0] = stops[i - 1], [p1, a1] = stops[i]; return a0 + (a1 - a0) * (t - p0) / (p1 - p0); }
    return stops[stops.length - 1][1];
  }
  // Gesamtdeckung beider Verläufe (links, unten) an einem Punkt: 1 − (1 − a)(1 − b)
  function deckung(schirm, x, y) {
    const v = VERLAUF[schirm]; if (!v) return 0;
    const a = stufe(v.links, x / VW), u = v.unten, b = u && y > u.ab ? u.bis * (y - u.ab) / (VH - u.ab) : 0;
    return 1 - (1 - a) * (1 - b);
  }
  // Schlimmster Fall unter einem Text: weißes Bild, gedimmt wie der Bildschirm, darüber die Abdunklung
  function unterlage(schirm, x, y, hell) {
    const h = hell != null ? hell : BILD.hell[schirm] || 1, w = Math.round(255 * h), bild = '#' + [w, w, w].map((v) => v.toString(16).padStart(2, '0')).join('');
    return ueber(FARBE.grund, deckung(schirm, x, y), bild);
  }
  function raster(zeilen, s) {
    s = s || 1; const out = [];
    zeilen.forEach((row, r) => { let q = 0; while (q < row.length) { const ch = row[q]; if (ch === '.') { q++; continue; } let e = q; while (e < row.length && row[e] === ch) e++; out.push({ x: q * s, y: r * s, w: (e - q) * s, h: s, kern: ch === '*' }); q = e; } });
    return out;
  }
  function sperrung(s, sp, skala, measure) {
    s = String(s); skala = skala || 1; const zeichen = []; let x = 0;
    for (let i = 0; i < s.length; i++) { zeichen.push({ z: s[i], x }); x += measure(s[i], skala) + (1 + (sp || 0)) * skala; }
    return { w: Math.max(0, x - (1 + (sp || 0)) * skala), zeichen };
  }
  function spieler(i) { i = i || 0; return { farbe: (PROTO.PLAYER_COLORS || [])[i], form: (PROTO.PLAYER_SHAPES || [])[i] }; }
  function text(vorlage, werte) { return String(vorlage).replace(/\{(\w+)\}/g, (_, k) => (werte && werte[k] != null ? werte[k] : '')); }
  function lum(h) { return hex(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0); }
  function kontrast(a, b) { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); }

  return { TOKENS, deckung, unterlage, ueber, raster, sperrung, spieler, text, kontrast };
});
