// KUL-02 Designer, Modus System: Tokens des Hauptschirms, klassische Ansicht mit Himmelskulisse (Richtung A „Tiefe“, KUL-01;
// Kai hat B+ gewählt, die klassische Ansicht bleibt per Umschalter, KUL-02). Vorbild: vault Pantheon/Mockups/KUL-01/a-tiefe.html,
// lib/kul.js, shots/a-*.png; Gestaltungsnotiz: vault Pantheon/„Auftrag KUL-01 – Designrichtungen“, Abschnitt Richtung A.
// Globales `HauptschirmTokens` (in Node als Modul, für tools/test-hauptschirm-tokens.js). NUR DATEN: kein Zeichencode, kein Zustand,
// keine Regeln. Welche Planeten, Sterne, Bojen und Gasriesen-Ringe es gibt, liefern shared/gen-sektor.js und shared/zonen.js; hier
// steht nur, wie sie auf dem Hauptschirm aussehen.
//
//   HauptschirmTokens.TOKENS   { SCHIRM, PAL, EIGEN, FARBE, TEXT, HIMMEL, STERNFELD, STERN, SONNE, PLANET, KUGEL, BOJE, GASRIESE, TAFEL, KONTRAST }
//
// Regeln (kurz):
//   - Maße in Texturpixeln der Hauptschirmtextur 512 × 288 (sitz.js SW/SH). Welt-Maße (Sprungfeld 140) sind als `welt` benannt.
//   - Farben: Funktionsfarben und Grund aus render.js PAL (im Browser das echte Objekt, in Node der Spiegel, der Test vergleicht).
//     Neue Werte nur in EIGEN (Einzelfarben mit Zweck), PLANET und STERN (Paletten der Himmelskörper). Alle anderen Stellen verweisen darauf.
//   - Keine rgba-Strings: Deckung steht als eigene Zahl daneben ({ farbe, alpha }), damit der Test jede Farbe zurückverfolgen kann.
//   - Text auf dem Hauptschirm: was die Crew lesen soll, mindestens Skala 2 (Ops-Platz: ein Texturpixel ≈ ein Bildpixel).
//     Skala 1 nur für Tafelköpfe (dunkle Schrift auf voller Funktionsfläche).
//   - Kontrast (WCAG 2.1) der Funktionsfarben auf dem Tafelgrund PAL.space #0B0E1A (gemessen, Test prüft nach):
//       Bernstein 12,4:1 · Messing 7,3:1 · Mint 12,2:1 · Eisblau 12,3:1 · Rot 4,7:1 (Rot nur ab Skala 2 oder als Form)
//     Kappe: PAL.space auf Messing 7,3:1, auf Bernstein 12,4:1.
//   - Farbwerte stehen nur zwischen „// <tokens>“ und „// </tokens>“ (gleiche Konvention wie tools/check-terminal-farben.js).
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HauptschirmTokens = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const RP = root && root.Render && root.Render.PAL;

  // <tokens>
  // ------------------------------------------------------------------ Palette (render.js PAL, gespiegelt, nicht neu)
  const PAL = RP || {
    brass: '#C9974A', panel: '#4F6178', panelLight: '#8EA3B5', mint: '#7FE0C2', amber: '#FFC66B', warn: '#F2C94C', red: '#E0473C',
    space: '#0B0E1A', star: '#F4EEDC', ice: '#A9D6E5', dark: '#151B2B', grey: '#6B7380',
  };

  // ------------------------------------------------------------------ Neue Einzelfarben (je mit Zweck)
  const EIGEN = {
    tiefraum: '#05070D',      // Himmelsgrund (Mockup SPACE), Abdunklung der Planeten, Kontur der Schrift über Bild
    lampeAus: '#18202F',      // Stufenleiter: Stufe nicht erreicht (= pult.js SKINS.rom.off)
    lampeStopp: '#3A4A66',    // Stufenleiter: Stufe STOPP (= pult.js SKINS.rom.offLine)
    rueckAn: '#F08A3C',       // Stufenleiter: Rückwärts aktiv (Orange, absichtlich nicht Bernstein: R ist keine Vorausfahrt)
    rueckAus: '#2A1E18',      // Stufenleiter: Rückwärts nicht aktiv
    ladeSpur: '#18202F',      // Ladebalken Sprung: Spur (= lampeAus)
    bojeKern: '#FFE9C2',      // Raute der Sprungboje (heller Messington, 16,2:1 auf Tafelgrund)
    bojeGlut: '#FFE2A8',      // inneres Glühen der Boje (Mitte des Verlaufs)
    sternWarm: '#FFE8C0',     // Fixstern hell, warm
    sternKalt: '#CFE0FF',     // Fixstern hell, kalt
    sternMittel: '#DCE2F0',   // Fixstern mittel (mit alpha)
    sternFern: '#B4BED2',     // Fixstern schwach (mit alpha)
    lichtpunkt: '#FFFFFF',    // Glanzpunkt im Kern der Sonne
    gasDunst: '#F0C88E',      // Dunst der Hochatmosphäre um den Gasriesen (= PLANET.gasriese.atm)
    gasLinie: '#F2DCB0',      // Höhenlinien und Schichtnamen des Gasriesen (14,3:1 auf Tafelgrund)
  };

  // ------------------------------------------------------------------ Palette der Sterne (Klassen aus gen-sektor.js KIND_STERN)
  const STERN = {
    gelb: { kern: '#FFF6DA', glut: '#FFD27A' },
    orange: { kern: '#FFE2B8', glut: '#FF9A4A' },
    weiss: { kern: '#F4F8FF', glut: '#BFD6FF' },
    rot: { kern: '#FFD0C0', glut: '#FF5A3C' },
  };

  // ------------------------------------------------------------------ Paletten der Planeten (Typen aus gen-sektor.js KIND_PLANET + gasriese)
  // rampe: dunkel → hell, Index nach Licht × Ton mit Dithering. land: zweite Rampe (Ozean: Kontinente). atm/atmAlpha: Saum und Randlicht.
  const PLANET = {
    fels: { rampe: ['#1E1A17', '#3A302A', '#5A4A3E', '#7E6A56', '#A68E72'], atm: '#C9B79A', atmAlpha: 0.25 },
    eis: { rampe: ['#141E2A', '#2C4258', '#557A96', '#8FB4CA', '#D8E8F2'], atm: '#A9D6E5', atmAlpha: 0.5 },
    wueste: { rampe: ['#2A1A0E', '#5A3418', '#8E5428', '#C07C40', '#E8B272'], atm: '#F2C08A', atmAlpha: 0.35 },
    ozean: { rampe: ['#08142A', '#0F3256', '#1C5784', '#3A86B2', '#86C2DA'], land: ['#1C2E1A', '#2E4A26', '#4E6A36', '#7A8A50'], atm: '#8FD0EC', atmAlpha: 0.6 },
    gasriese: { rampe: ['#2A1A12', '#58361F', '#8A5530', '#B87E48', '#DDB27A', '#F2DCB0'], atm: '#F0C88E', atmAlpha: 0.55 },
  };

  // ------------------------------------------------------------------ Farben nach Rolle (Funktionsfarben, Brückenpulte)
  const FARBE = {
    grund: EIGEN.tiefraum,        // Himmelsgrund des Hauptschirms
    kurs: PAL.amber,              // Bernstein: Kurs und Schub (Antrieb/Fahrt), Ecke links
    sprung: PAL.brass,            // Messing: Sprungziel und Sprungbojen (Navigation), Ecke rechts
    sensor: PAL.ice,              // Eisblau: Navigationsbojen (Sensorik)
    schild: PAL.mint,             // Mint: Schilde
    gefahr: PAL.red,              // Rot: Gegner und Alarm (Text nur ab Skala 2)
    text: PAL.star,               // Creme: Werte ohne Funktionsfarbe (Boje + Entfernung)
    dim: PAL.panelLight,          // Nebeninfo
    ink: PAL.space,               // Schrift auf voller Funktionsfläche (Kappe)
    kontur: { farbe: EIGEN.tiefraum, alpha: 0.9 },   // 8-fach-Kontur um Schrift über Bild (Bojen-, Schicht-, Randpfeil-Labels)
  };
  // </tokens>

  // ------------------------------------------------------------------ Schirm
  const SCHIRM = {
    w: 512, h: 288,               // sitz.js SW/SH
    voraus: 700, zurueck: 120,    // Ausschnitt der Draufsicht (Kai 2026-10-22), Zoom = h / (voraus + zurueck)
  };

  // ------------------------------------------------------------------ Schrift (Pixelschrift art.js, Skala = ganzzahliger Faktor)
  const TEXT = {
    skalaBeschriftung: 2,         // alle Labels auf dem Schirm: Randpfeile („SPRUNG 1200“), DOCK-RING, Sprungboje, Schichtnamen, ZIEL
    skalaKopf: 1,                 // Tafelköpfe (KURS, TEMPO, SPRUNGZIEL) auf Funktionsfläche
    skalaGross: 3,                // Kurs und Tempo
    skalaWert: 2,                 // Schubstufe, Sprungziel, Boje + Entfernung, Ladezustand
    konturPx: 1,                  // Kontur um Schrift über Bild (8 Richtungen)
    kopf: { kurs: 'KURS', tempo: 'TEMPO', ziel: 'SPRUNGZIEL', laedt: 'SPRUNG LÄDT', bereit: 'BEREIT' },   // bereit: Sprung geladen, keine Boje anzuzeigen (Wert Skala 2, Mint)
  };

  // ------------------------------------------------------------------ Himmelsschicht: Tiefe und Parallaxe
  const HIMMEL = {
    parallaxePlanet: 0.45,        // Planeten unter der Flugebene ziehen mit 45 % der Fahrt vorbei (Peilung stimmt, Entfernung gestaucht)
    parallaxeGasriesePlan: 1,     // Gasriese MIT Zonen liegt in der Ebene: seine Schichten sind Spielfläche (Sammelmission)
    radiusFaktor: 0.9,            // Planetenradius aus den Daten × 0.9 (Gasriese mit Zonen × 1)
    radiusFaktorGasriesePlan: 1,
    abdunklung: { farbe: EIGEN.tiefraum, alpha: 0.22, randPx: 1 },   // Scheibe über Planeten (nicht Gasriese mit Zonen): „liegt tiefer“
    kippung: -0.3,                // Achsneigung der Planetenoberfläche (Bänder, Polkappen)
  };

  // ------------------------------------------------------------------ Fixsterne (unendlich fern, drehen mit dem Kurs)
  const STERNFELD = {
    seed: 5, anzahl: 300, halbeKante: 700,   // Punkte in ±700 um die Schirmmitte, gedreht um −Kurs
    // Helligkeitsklassen: Zufallswert b ≥ ab → diese Farbe. Erste passende gewinnt (absteigend).
    klassen: [
      { ab: 0.97, farbe: EIGEN.sternWarm, alpha: 1 },
      { ab: 0.9, farbe: EIGEN.sternKalt, alpha: 1 },
      { ab: 0.6, farbe: EIGEN.sternMittel, alpha: 0.55 },
      { ab: 0, farbe: EIGEN.sternFern, alpha: 0.3 },
    ],
    grossAb: 0.985, grossPx: 2, kleinPx: 1,
  };

  // ------------------------------------------------------------------ Stern als Randlicht (nur Richtung, am Bildrand in seiner Peilung)
  const SONNE = {
    randAbstand: 14,              // Mittelpunkt so weit vom Bildrand
    radius: 6,                    // Kern
    // Glühen: [Radius × Kern, alpha], additiv (lighter), außen nach innen
    gluehen: [[9, 0.08], [5, 0.14], [2.6, 0.28], [1.5, 0.5]],
    strahlen: { anzahl: 8, versatz: 0.2, lang: 4.2, kurz: 2.4, alpha: 0.35, auslauf: 0.9 },   // gestufte Pixelstrahlen, lang/kurz abwechselnd (× Kern)
    glanz: { farbe: EIGEN.lichtpunkt, radius: 0.6, versatz: -0.15 },   // heller Fleck im Kern (× Kern)
    lichtZ: 0.55,                 // Lichtvektor der Kugeln: (dx, dy) zur Sonne im Bild, z zum Betrachter
    lichtOhneStern: [0.5, -0.5, 0.6],
  };

  // ------------------------------------------------------------------ Kugelzeichner (Planeten): Blockraster, Dithering, Licht
  const KUGEL = {
    // Blockraster (Voxel-Look): Blockgröße = runde(R / pxJeBlock), begrenzt auf [min, max]. KUL-02 B verlangt Blockraster.
    block: { pxJeBlock: 30, min: 2, max: 4, kantenFaktor: 0.82 },
    dither: { bayer4: [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5], schwelle: 0.9 },   // geordnetes Dithering 4 × 4, (v + 0,5) / 16
    licht: { grund: 0.12, faktor: 0.95, diffus: 1.05, versatz: 0.02 },   // Helligkeit = Ton × (grund + Licht × faktor)
    nacht: { unter: 0.02, faktorRG: 0.18, faktorB: 0.2 },                 // Nachtseite: Rampe abdunkeln, leicht blau
    saum: { breite: 0.18, faktor: 0.8, lichtVersatz: 0.35, minAlpha: 0.02 },   // Atmosphäre außen (× R), nur Lichtseite stark
    randlicht: { exponent: 3, lichtVersatz: 0.3 },                         // Atmosphäre auf der Scheibe am Rand der Lichtseite
    rand: { pad: 0.25, padPx: 3 },                                         // Zwischenspeicher-Bild: R + pad × R + padPx
    minRadius: 2,
  };

  // ------------------------------------------------------------------ Bojen (Leuchtmarken in der Ebene, ohne Kollision)
  const BOJE = {
    sprung: {
      farbe: FARBE.sprung,
      feld: { welt: 140, strich: [6, 4], linie: 1.5, alpha: 0.75 },        // Sprungfeld als gestrichelter Ring (Weltradius 140)
      feldGlut: { alpha: 0.22, kastenPx: 60 },                             // Verlauf Messing alpha → 0 bis zum Feldrand
      glut: { radius: 12, mitte: EIGEN.bojeGlut, alphaMitte: 0.9 },        // Leuchtpunkt: bojeGlut → Messing 0
      raute: { farbe: EIGEN.bojeKern, halbB: 4, halbH: 5 },
      label: { skala: 2, abstandUeberFeld: 18, farbe: FARBE.sprung, format: '{name} → {ziel}' },
    },
    nav: {
      farbe: FARBE.sensor,
      glut: { radius: 12, mitte: EIGEN.bojeGlut, alphaMitte: 0.9 },
      raute: { farbe: FARBE.sensor, halbB: 4, halbH: 5 },
      label: null,                // Zierde: kein Label (Skala 1 unlesbar, Skala 2 zu laut für Deko)
    },
  };

  // ------------------------------------------------------------------ Gasriese mit Zonen: Dunst und Höhenlinien (Ringe aus shared/zonen.js)
  const GASRIESE = {
    dunst: { farbe: EIGEN.gasDunst, bisRadius: 1.9, stopps: [[0, 0.28], [0.5, 0.09], [1, 0]] },   // Verlauf von R bis 1,9 R
    // Linienstil je Grenze, von außen nach innen: Index 0,1 = äußere Grenzen (Hochatmosphäre, Wolkendecke), dann innere.
    linie: [
      { farbe: EIGEN.gasLinie, alpha: 0.55, strich: [5, 4], breite: 1 },
      { farbe: EIGEN.gasLinie, alpha: 0.55, strich: [5, 4], breite: 1 },
      { farbe: EIGEN.gasLinie, alpha: 0.4, strich: [2, 4], breite: 1 },
      { farbe: EIGEN.gasLinie, alpha: 0.4, strich: [2, 4], breite: 1 },
    ],
    label: {
      skala: 2, farbe: EIGEN.gasLinie, abstandY: -10, grenzen: 3,          // Namen an den äußeren drei Grenzen, Großbuchstaben
      winkel: [0.62, -0.42, 0.5],                                          // Position auf der Linie (rad, vom unteren Pol)
      freiOben: 76, freiUnten: 14, freiSeite: 80,                          // nur zeichnen, wenn so weit von Tafeln und Rand entfernt
    },
  };

  // ------------------------------------------------------------------ Ecktafeln (Mitte oben bleibt frei für die Szenenzeile)
  // Koordinaten relativ zur Tafel (x, y = linke obere Ecke). Rom-Skin: Grund 86 %, Farbstreifen oben 3 px und an der Außenkante 3 px,
  // innere untere Ecke 8 px abgeschrägt. Randpfeile weichen den Tafeln um `sperrAbstand` aus.
  const TAFEL = {
    grund: { farbe: PAL.space, alpha: 0.86 },
    streifen: 3, aussenStreifen: 3, schraege: 8, rand: 6, sperrAbstand: 8,
    mitteFreiMin: 120,            // so viel Breite bleibt oben zwischen den Tafeln mindestens frei
    kappe: { hoehe: 9, padX: 3, schraege: 3, textY: 1, farbeText: FARBE.ink },
    links: {                      // Kurs | Tempo + Schubstufe (Bernstein)
      ecke: 'tl', x: 6, y: 6, w: 186, h: 64, farbe: FARBE.kurs,
      kurs: { kopfX: 8, kopfY: 7, wertX: 8, wertY: 19, skala: 3, format: '{kurs}°' },
      band: { x: 8, y: 50, w: 92, spanne: 40, teilung: 5, lang: 6, kurz: 3, alphaLang: 0.8, alphaKurz: 0.45, linieAlpha: 0.5, marke: 4 },
      tempo: { kopfX: 108, kopfY: 7, wertX: 108, wertY: 19, skala: 3 },
      stufe: { x: 108, y: 46, skala: 2 },   // Wort aus den Schiffsdaten (stageNames, wie das Fahrt-Pult), keine Kopie hier; breitestes „STOPP“ 58 px
      leiter: { x: -16, w: 10, h: 6, schritt: 8, untenAbstand: 10,     // x relativ zur rechten Kante; 6 Lampen von unten (R) nach oben (VOLL)
        an: FARBE.kurs, aus: EIGEN.lampeAus, stopp: EIGEN.lampeStopp, rueckAn: EIGEN.rueckAn, rueckAus: EIGEN.rueckAus },
    },
    rechts: {                     // Sprungziel (Messing)
      ecke: 'tr', x: -6, y: 6, w: 170, h: 64, farbe: FARBE.sprung,     // x negativ = Abstand der rechten Kante vom Schirmrand
      ziel: { kopfX: 8, kopfY: 7, wertX: 8, wertY: 19, skala: 2, maxBreite: 130 },   // Name, der breiter ist, wird gekürzt (… am Ende)
      boje: { x: 8, y: 37, skala: 2, farbe: FARBE.text, format: '{boje} · {entfernung}' },
      peil: { x: -20, y: 26, ringRadius: 10, ringAlpha: 0.5, spitze: 9, fluegel: 5, kerbe: 2 },   // x relativ zur rechten Kante
      laden: { kopf: '{laedt} {prozent} %', balkenY: 57, balkenH: 3, spur: EIGEN.ladeSpur, farbe: FARBE.sprung },   // Kopf zeigt beim Laden den Fortschritt
    },
  };

  // ------------------------------------------------------------------ Kontrast (Doku, Test misst nach)
  const KONTRAST = {
    grund: PAL.space,
    werte: { amber: 12.4, brass: 7.3, mint: 12.2, ice: 12.3, red: 4.7 },
    nurAbSkala2: ['red'],
  };

  const TOKENS = { SCHIRM, PAL, EIGEN, FARBE, TEXT, HIMMEL, STERNFELD, STERN, SONNE, PLANET, KUGEL, BOJE, GASRIESE, TAFEL, KONTRAST };
  return { TOKENS };
});
