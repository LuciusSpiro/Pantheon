// KUL-02 Designer, Modus System: Tokens des Hauptschirms, klassische Ansicht mit Himmelskulisse (Richtung A „Tiefe“, KUL-01;
// Kai hat B+ gewählt, die klassische Ansicht bleibt per Umschalter, KUL-02). Vorbild: vault Pantheon/Mockups/KUL-01/a-tiefe.html,
// lib/kul.js, shots/a-*.png; Gestaltungsnotiz: vault Pantheon/„Auftrag KUL-01 – Designrichtungen“, Abschnitt Richtung A.
// Globales `HauptschirmTokens` (in Node als Modul, für tools/test-hauptschirm-tokens.js). NUR DATEN: kein Zeichencode, kein Zustand,
// keine Regeln. Welche Planeten, Sterne, Bojen und Gasriesen-Ringe es gibt, liefern shared/gen-sektor.js und shared/zonen.js; hier
// steht nur, wie sie auf dem Hauptschirm aussehen.
//
//   HauptschirmTokens.TOKENS   { SCHIRM, PAL, EIGEN, FARBE, TEXT, HIMMEL, STERNFELD, STERN, SONNE, PLANET, KUGEL, BOJE, GASRIESE, TAFEL, VISIER, KONTRAST }
//   VISIER (KUL-03, Richtung B+): Kamera, Himmel, Planeten unter der Ebene, Glas, Objekte, Leiste, Lagescheibe, Tafel, Skins (Mockup bplus-visier.html).
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
    // KUL-03 Visier (Mockup bplus-visier.html, B+ 2026-11-03)
    gegnerHell: '#FF5A4A',    // Gegner als FORM: Marke (Winkel), Punkt der Lagescheibe, Führungslinie, gegnerische Schüsse (Mockup '#FF5A4A'); Text bleibt PAL.red
    huelleSpur: '#2A1012',    // Spur des Hüllenbalkens in der Gegnermarke (Mockup rect '#2A1012')
    dunst: '#1A1E2C',         // Dunstfarbe ferner Modelle (Mockup modell() DU = [26, 30, 44])
    sternMarke: '#FFE6A0',    // Marke des Sterns am Peilband (Mockup render() marken '#FFE6A0')
    eisenPlatte: '#1A1614',   // Skin germanen: Platte von Leiste und Tafel (Mockup kul.js tafel() rgba(26,22,20,…))
    eisenRand: '#5A5048',     // Skin germanen: Eisenrand (Mockup kul.js tafel())
    eisenKerbe: '#2A221E',    // Skin germanen: Kerben im oberen Rand (Mockup kul.js tafel())
    eisenNiete: '#8A7A68',    // Skin germanen: Nieten in den Ecken (Mockup kul.js tafel())
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
    randNameMax: 9,               // Randpfeil-Label des Hauptschirms: Name höchstens so viele Zeichen („RABENPASS 1296“)
    konturPx: 1,                  // Kontur um Schrift über Bild (8 Richtungen)
    kopf: { kurs: 'KURS', tempo: 'TEMPO', ziel: 'SPRUNGZIEL', laedt: 'SPRUNG LÄDT', bereit: 'BEREIT' },   // bereit: Sprung geladen, keine Boje anzuzeigen (Wert Skala 2, Mint)
  };

  // ------------------------------------------------------------------ Himmelsschicht: Tiefe und Parallaxe
  const HIMMEL = {
    parallaxePlanet: 0.45,        // Planeten unter der Flugebene ziehen mit 45 % der Fahrt vorbei (Peilung stimmt, Entfernung gestaucht)
    parallaxeGasriesePlan: 1,     // Gasriese MIT Zonen liegt in der Ebene: seine Schichten sind Spielfläche (Sammelmission)
    radiusFaktor: 0.9,            // Planetenradius aus den Daten × 0.9 (Gasriese mit Zonen × 1)
    radiusFaktorGasriesePlan: 1,
    abdunklung: { farbe: EIGEN.tiefraum, alpha: 0.45, randPx: 1 },   // Scheibe über Planeten (nicht Gasriese mit Zonen): „liegt tiefer“. 2026-11-03 (Designer-Review KUL-02): 0,22 → 0,45; bei 0,22 war der Planet im Gefecht das hellste Objekt (Vergleichsbild gefecht-abdunklung-vergleich.png)
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
    sperreUnten: { halbB: 72 },   // Designer-Review KUL-02 (6): am Unterrand liegt das Randlicht nie näher als ±72 px an der Lerchenmitte (sonst liest es sich wie ein Treffer)
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
      saum: { farbe: EIGEN.tiefraum, alpha: 0.9, plus: 2 },   // dunkler Saum unter der Raute (Prüfer KUL-02 2c: Eisblau auf Ozeanplanet zu schwach): Raute um `plus` px größer
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
    // Schichtnamen zeichnet NUR render.js drawZonen (Hauptschirm), die Kulisse zeichnet die Linien. Position je Ring dynamisch (KUL-02 Nacharbeit N1):
    label: {
      skala: 2,
      schritt: 0.1,               // auf dem Ring in Schritten von 0,1 rad: der freie Punkt (nicht unter Tafeln, nicht am Rand, nicht auf anderen Namen), der der Lerche am nächsten liegt
      rand: 6,                    // Abstand der Namenskästen vom Bildrand (px)
    },
  };

  // ------------------------------------------------------------------ Ecktafeln (Mitte oben bleibt frei für die Szenenzeile)
  // Koordinaten relativ zur Tafel (x, y = linke obere Ecke). Rom-Skin: Grund 94 %, Farbstreifen oben 3 px und an der Außenkante 3 px,
  // innere untere Ecke 8 px abgeschrägt. Randpfeile weichen den Tafeln um `sperrAbstand` aus.
  const TAFEL = {
    grund: { farbe: PAL.space, alpha: 0.94 },   // 94 %: Asteroiden und Planeten schimmern sonst hinter den Zahlen (Designer-Review KUL-02)
    streifen: 3, aussenStreifen: 3, schraege: 8, rand: 6, sperrAbstand: 8,
    mitteFreiMin: 120,            // so viel Breite bleibt oben zwischen den Tafeln mindestens frei
    kappe: { hoehe: 9, padX: 3, schraege: 3, textY: 1, farbeText: FARBE.ink },
    links: {                      // Kurs | Tempo + Schubstufe (Bernstein)
      ecke: 'tl', x: 6, y: 6, w: 186, h: 64, farbe: FARBE.kurs,
      kurs: { kopfX: 8, kopfY: 7, wertX: 8, wertY: 19, skala: 3, format: '{kurs}°' },
      band: { x: 8, y: 50, w: 92, spanne: 40, teilung: 5, lang: 6, kurz: 3, alphaLang: 0.8, alphaKurz: 0.45, linieAlpha: 0.5, marke: 4, kappePad: 2, kappeH: 9 },   // kappe*: Himmelsrichtung als dunkler Buchstabe auf Bernstein-Kappe
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
      laden: { kopf: '{laedt} {prozent} %', balkenY: 57, balkenH: 5, spur: EIGEN.ladeSpur, farbe: FARBE.sprung, prozentFormat: '{prozent} %', prozentX: 8 },   // Prozentzahl beim Laden: Skala 2, rechtsbündig in der Bojenzeile, prozentX = Abstand vom rechten Rand   // Kopf zeigt beim Laden den Fortschritt
    },
  };

  // ------------------------------------------------------------------ Visier (KUL-03, Richtung B+): Blick vom Bug nach vorn auf Brückenhöhe
  // Quelle aller Werte: vault Pantheon/Mockups/KUL-01/bplus-visier.html mit lib/kul.js (kamera, tafel, kappe, schildring), Gestaltungsnotiz
  // „Auftrag KUL-01 – Designrichtungen“, Abschnitt „B+ (2026-11-03)“, und Auftrag KUL-03. Abweichungen vom Mockup stehen als „Mockup …“ dabei.
  // Maße in Texturpixeln, Welt-Maße heißen `welt…`. Leiste: y relativ zu ihrer Oberkante LY = SCHIRM.h − leiste.hoehe (negativ = darüber).
  // Lage (Peilung, Entfernung) rechnet der Zeichner aus dem Snapshot; Klassenlängen der Gegner kommen aus den Spieldaten, nicht von hier.
  const VISIER = {
    kamera: {
      auge: 90,                   // Augenhöhe über der Flugebene (Mockup kamera({ hoch: 90 }); B hatte 40). Brückenhöhe: Tiefe wird Höhe im Bild
      vor: 35,                    // Auge so weit vor dem Schiffsmittelpunkt, am Bug (Mockup vor: 35)
      neigung: 16,                // Grad nach unten (Mockup neig: 16; B 10,5)
      blickwinkel: 50,            // senkrechter Blickwinkel in Grad (Mockup vfov: 50). Brennweite F = (h / 2) / tan(25°) = 308,8 px
      horizontY: 55,              // Horizontzeile, abgeleitet h / 2 − tan(16°) · F = 55,45 von 288 (Test rechnet nach, ±1)
      tiefeMin: 30,               // Objekte erst ab dieser Tiefe im Bild (Mockup imBild: depth > 30)
    },
    himmel: {
      seed: 91, anzahl: 1100,     // Panorama-Fixsterne (Mockup himmel(): rng(91), 1100 Versuche); Farben und Größen = STERNFELD.klassen / grossAb / grossPx
      hoeheMitte: 0.62, hoeheSpanne: 90,   // Höhenwinkel = (Zufall − 0,62) × 90°, die meisten über dem Horizont (Mockup)
      seiteMax: 60,               // nur Sterne bis ±60° zur Blickrichtung (Mockup)
      untenAb: 0.9,               // unter dem Horizont nur helle Sterne, Helligkeit ≥ 0,9: man sieht durch die Ebene (Mockup)
      sonne: { sichtbarAbCos: 0.25, hoeheGrad: 5 },   // Stern als Sonne im Bild, wenn cos(Peilung) > 0,25; 5° über dem Horizont (Mockup). Kern und Glühen: SONNE
      licht: { y: -0.55, zGrund: 0.35, zFaktor: -0.5 },   // Lichtvektor der Kugeln [sin a, −0,55, 0,35 − 0,5 · cos a], Licht von oben (Mockup himmel())
    },
    planet: {
      radiusFaktor: 1,            // Radius = 1 × Kartenradius (Mockup groesse)
      tiefeFaktor: 1.25, tiefePlus: 40,   // Mittelpunkt 1,25 × R + 40 UNTER der Ebene: die Kugel liegt ganz unter Augenhöhe (Mockup planeten())
      tiefeMin: 80,               // Planeten erst ab Tiefe 80 zeichnen (Mockup depth > 80)
      sicherungPx: 6,             // Oberkante nie höher als Horizont + 6 (Mockup; Sicherung gegen die Kreis-Näherung der Kugel)
      block: { pxJeBlock: 28, min: 2, max: 4 },   // Blockraster R / 28, begrenzt 2..4 (Mockup round(Rs / 28); Draufsicht KUGEL.block 30). Übrige Kugelwerte: KUGEL
      kippung: -0.9,              // Achsneigung der Oberfläche (Mockup tilt: -0.9; Draufsicht HIMMEL.kippung −0,3)
    },
    glas: {                        // Flugebene als Glas über allem, was darunter liegt (Planeten, Sterne unter dem Horizont)
      schleier: { farbe: EIGEN.tiefraum, alpha: 0.34 },   // Mockup ebene(): Tiefraum zu 34 % vom Horizont bis zum Unterrand
      schein: { farbe: FARBE.sensor, hoehe: 11, alphaOben: 0, alphaUnten: 0.1 },   // Verlauf über der Horizontlinie (Mockup hz − 10 … hz + 1)
      horizont: { farbe: FARBE.sensor, alpha: 0.35, breite: 1 },                  // Horizontlinie 1 px (Mockup)
      ringe: {
        welt: [200, 400, 700],     // Entfernungsringe um das eigene Schiff (Mockup; Auftrag KUL-03)
        farbe: FARBE.sensor, alpha: 0.2, strich: [2, 4], breite: 1, segmente: 72, tiefeMin: 8,   // Mockup ellipse()
        // Ringwert bei −34° (Backbord voraus), 3 px über dem Ring, nur wenn ≥ 10 px über der Leiste. Skala 1 bewusst: Hilfe, keine Meldung (KUL-01 B+ Textskala)
        wert: { skala: 1, alpha: 0.75, winkelGrad: -34, ueber: 3, abstandLeiste: 10 },
      },
    },
    objekt: {
      gegner: {
        faktor: 1.6, minPx: 16, maxFaktor: 3.2,   // größer als maßstäblich: max(1,6; 16 px / Bildlänge), höchstens 3,2-fach (Mockup VERGR, MIN_PX, min(3.2, …))
        hebe: 6,                  // Modell steht 6 über der Ebene, der Schildring liegt auf ihr (Mockup hebe: 6)
        saum: { farbe: EIGEN.tiefraum, alpha: 0.85, px: 1 },   // dunkler Umriss um jedes Modell: überdeckte Schiffe bleiben zwei Formen (Mockup)
        dunst: { farbe: EIGEN.dunst, ab: 280, spanne: 1100, max: 0.38 },   // Anteil = (Tiefe − 280) / 1100, höchstens 38 % (Mockup)
        // Schildring als Fußpunkt flach auf der Ebene, Radius 0,62 × Länge, vier Seiten wie die Ops-Kennung, je ±0,62 rad (Mockup ringEbene())
        schildring: { radiusFaktor: 0.62, halbBogen: 0.62, farbe: FARBE.schild, alphaGrund: 0.35, alphaJeStufe: 0.15, breiteGrund: 1, breiteJeStufe: 0.5,
          leer: { farbe: FARBE.gefahr, alpha: 0.9, strich: [2, 3], breite: 1.5 } },
        // Ziel der Ops: vier Ecken um das Modell, Text darunter (Mockup)
        ziel: { farbe: FARBE.kurs, pad: 4, arm: 6, breite: 2, label: { format: 'ZIEL {entfernung}', skala: 2, abstand: 4 } },
      },
      marke: {                     // Gegnermarke fester Größe über jedem Schiff, unabhängig von der Entfernung (Mockup schilder.marke)
        w: 20, h: 10, abstand: 3,  // 20 × 10, 3 px über dem Modell
        huelle: { h: 3, farbe: FARBE.gefahr, spur: EIGEN.huelleSpur },   // Hüllenbalken über die volle Breite
        winkel: { halbB: 5, oben: 5, unten: 10, farbe: EIGEN.gegnerHell, farbeZiel: FARBE.kurs },   // Dreieck, Spitze nach unten (y 5..10 der Marke)
      },
      boje: {
        saum: { farbe: EIGEN.tiefraum, alpha: 0.8, px: 1 },
        sprung: {
          feld: { welt: 140, farbe: FARBE.sprung, alpha: 0.8, strich: [6, 4], breite: 1.5 },   // Sprungfeld als Ellipse (Mockup 0,8; Draufsicht BOJE.sprung.feld 0,75)
          saeule: { welt: 120, farbe: EIGEN.bojeGlut, alpha: 0.45, breiteJeK: 5 },   // Lichtsäule aus B, Verlauf 0 → 0,45 nach unten, Breite max(1, k · 5)
          glut: { farbe: FARBE.sprung, radius: 8, radiusJeK: 40, alpha: 0.45 },     // Leuchten am Fuß (Mockup)
          laenge: 40,             // Stellvertretermodell 40 lang (Mockup; Modell kommt mit KUL-04)
          label: { format: '{name} → {ziel}', skala: 2, abstand: 6, farbe: FARBE.sprung, entfernungSkala: 1, entfernungFarbe: FARBE.text },   // Entfernung Skala 1 (Mockup, Hilfe; die Tafel trägt sie in Skala 2)
        },
        nav: {
          saeule: { welt: 60, farbe: FARBE.sensor, alpha: 0.45, breiteJeK: 5 },
          glut: { farbe: FARBE.sensor, radius: 8, radiusJeK: 40, alpha: 0.45 },
          laenge: 18,
          label: { text: 'NAV', skala: 2, abstand: 5, farbe: FARBE.sensor },   // Mockup: NAV in Skala 2 (Draufsicht ohne Label, BOJE.nav.label)
        },
      },
      station: {
        saum: { farbe: EIGEN.tiefraum, alpha: 0.7, px: 1 },
        label: { skala: 2, farbe: FARBE.kurs, abstand: 6, entfernungSkala: 2, entfernungFarbe: FARBE.text },   // Name und Entfernung BEIDE Skala 2 (Auftrag KUL-03, Kai 2026-11-03; Mockup Entfernung Skala 1)
        // Dock-Ring am Ende des Andockarms: hintere Hälfte schwach unter, vordere über der Station (Mockup)
        dock: { welt: 70, farbe: FARBE.schild, alphaHinten: 0.35, alphaVorn: 0.9, strich: [4, 3], breite: 2,
          label: { format: 'DOCK-RING {entfernung}', skala: 2, unter: 0.3, abstand: 6 } },   // y = Ringmitte + 70 · k · 0,3 + 6 (Mockup)
      },
      schuss: { hoehe: 8, welt: 26, breiteJeK: 4, breiteMin: 1.5, breiteMax: 3, eigen: FARBE.kurs, gegner: EIGEN.gegnerHell },   // additiv, 26 lang, 8 über der Ebene (Mockup)
      beschriftung: {              // Schilder und Marken nach Rang setzen, ausweichen statt überdecken (Mockup render())
        rang: { ziel: 3, dock: 3, station: 2, sprungboje: 2, marke: 1, nav: 0 },
        schritt: 6, versuche: 14,  // weicht in 6-px-Schritten aus: Marken und Namen nach oben, ZIEL und DOCK-RING nach unten
        pad: 4, hoehe: 15, hoeheMitEntfernung: 24, hoeheMitEntfernung2: 31,   // Kasten = Textbreite + 4; mit Entfernung darunter (+16) in Skala 1 bzw. Skala 2
        fuehrung: { abVersatz: 5, alpha: 0.6, breite: 1 },   // Führungslinie zum Objekt bei Versatz > 5 px, Farbe des Schilds (Marke: gegnerHell)
        nurZielText: true,         // Gegner: nur das Ziel trägt Text, alle anderen nur die Marke (Entfernung liest man an den Ringen)
        sperren: ['tafelRechts', 'leiste', 'lagescheibe'],   // belegte Flächen (Mockup: Tafel + Leiste; Lagescheibe ergänzt, sie ragt 35 px über die Leiste)
      },
      randpfeil: {                 // Gegner voraus, aber außerhalb des Bildes (Mockup pfeile)
        rand: 12, form: [[7, 0], [-5, -6], [-2, 0], [-5, 6]], farbe: FARBE.gefahr,   // Spitze zeigt nach außen (Punkte für die rechte Seite, links gespiegelt)
        unterHorizont: 20, ueberLeiste: 52,   // y = Bildlage, begrenzt auf Horizont + 20 … Leiste − 52 (über der Lagescheibe)
        label: { skala: 2, dx: 4, dy: 9 },    // Entfernung in Skala 2, 4 px nach innen, 9 px tiefer
        hintenWelt: 40, hinten: false,        // voraus < 40: KEIN Pfeil, der Gegner steht nur in der Lagescheibe (Auftrag KUL-03 Abnahme 2; „HECK“ entfällt)
      },
      alarm: { farbe: FARBE.gefahr, breite: 3, laenge: 46 },   // je zwei Streifen links und rechts: unter dem Horizont und über der Leiste. „ALARM ROT“ entfällt (Auftrag KUL-03)
    },
    leiste: {
      hoeheMockup: 32,
      hoehe: 22,                  // 70 % der Mockup-Leiste: 32 × 0,7 = 22,4 → 22 (Auftrag KUL-03)
      // KONFLIKT: Skala 3 ist 21 px hoch und passt mit dem Streifen (2) nicht in 22 px. Vorschlag Designer: nur das Tempo-Feld links und der Kurs-Kasten
      // ragen 5 px über die Leiste (Hochfeld 27 = Streifen 2 + Luft 2 + Text 21 + Luft 2); das Band dazwischen bleibt 22 hoch.
      hochfeld: 27,
      streifen: 2, schraege: 10,  // Funktionsstreifen oben 2 px, obere Ecken 10 px abgeschrägt (Mockup cham(…, 10, 10, 0, 0))
      farbe: FARBE.kurs, farbeAlarm: FARBE.gefahr,   // Streifen Bernstein, bei Alarm Rot (Mockup)
      feldBreite: 130,            // linkes Hochfeld (Tempo + Schubstufe) bis x 130
      tempo: { x: 12, y: -1, skala: 3, farbe: FARBE.text },   // Creme wie Mockup (FN.cmd); y −1 relativ zur Leiste = im Hochfeld (Mockup ty = y0 + 7)
      stufe: { abstand: 8, y: -1, skala: 2, farbe: FARBE.kurs, maxBreite: 58 },   // Wort aus Consoles.helmInfo rechts neben dem Tempo, „STOPP“ = 58 px (Mockup ty − 1, +8)
      leiter: { y: 15, w: 6, h: 4, schritt: 8,   // Stufenleiter unter dem Wort, von links (R) nach rechts (VOLL) (Mockup 6 × 4, Schritt 8); Farben wie TAFEL.links.leiter
        an: FARBE.kurs, aus: EIGEN.lampeAus, stopp: EIGEN.lampeStopp, rueckAn: EIGEN.rueckAn, rueckAus: EIGEN.rueckAus },
      band: {                     // Peilband, winkeltreu: x = Mitte + tan(Peilung − Kurs) · F, eine Gradzahl steht unter dem, was dort liegt
        rand: 134,                // Band von x 134 bis 512 − 134 (Mockup 124; „STOPP“ neben dreistelligem Tempo braucht 12 + 51 + 8 + 58 = 129)
        teilung: 5, zahlAlle: 10, // Strich alle 5°, lang und mit Zahl alle 10°
        tickY: 2, lang: 4, kurz: 2, alphaLang: 0.9, alphaKurz: 0.55, farbe: FARBE.kurs,   // Mockup lang 5 / kurz 3; um 1 kürzer, damit Skala 2 in 22 px passt
        zahl: { y: 7, skala: 2, alpha: 0.9, abstandKasten: 3 },   // Gradzahl dreistellig, 0° als „N“; nicht neben dem Kasten (Mockup y0 + 11)
        nord: { text: 'N', farbe: FARBE.text },
      },
      kasten: { y: -3, h: 25, pad: 8, textY: -1, skala: 3, farbe: FARBE.kurs, grund: PAL.space, rand: FARBE.kurs, randBreite: 1, schraege: 3 },   // Kurs dreistellig im Kasten (Mockup Breite Text + 16, unten 3 px abgeschrägt)
      zeiger: { spitze: -4, basis: 1, halbB: 4, farbe: FARBE.kurs },   // Steuerstrich über der Bandmitte, y relativ zur Kasten-Oberkante (Mockup y0 − 1 … y0 + 4)
      marke: {                    // Marken über dem Band (Mockup)
        h: 6, halbB: 4,           // Dreieck, Spitze nach unten auf der Leistenkante
        aus: { radMax: 1.2, spitze: 7, ruecken: 2, h: 10 },   // außerhalb des Blickfelds (|a| > 1,2 rad oder neben dem Band): Pfeil am Bandende
        farbe: { ziel: FARBE.kurs, sprungboje: FARBE.sprung, station: FARBE.schild, stern: EIGEN.sternMarke },
      },
    },
    lagescheibe: {
      cx: -38, cy: -30, radius: 27,   // Mittelpunkt relativ zur rechten unteren Ecke (Mockup lagescheibe(c, sz, W − 38, H − 30, 27)); ragt über die Leiste
      reichweiteWelt: 800,            // Rand = 800 Welt (Mockup; Auftrag KUL-03), Kontakte dahinter am Rand (R − randPad)
      randPad: 2,
      grund: { farbe: PAL.space, alpha: 0.95, plus: 2 },   // Scheibe R + 2 (Mockup)
      rand: { farbe: FARBE.sensor, alpha: 0.5, breite: 1 },
      mitte: { anteil: 0.5, farbe: FARBE.sensor, alpha: 0.18 },   // Ring bei 400
      keil: { halbGrad: 40, farbe: FARBE.kurs, alpha: 0.35 },     // Blickfeld des Schirms: atan(256 / 308,8) = 39,7° (Test rechnet nach)
      punkt: { sprungboje: { farbe: FARBE.sprung, px: 3 }, station: { farbe: FARBE.schild, px: 4 }, ziel: { farbe: FARBE.kurs, px: 4 }, gegner: { farbe: EIGEN.gegnerHell, px: 3 } },
      // eigene Schilde als Ring der Ops-Kennung (kul.js schildring): vier Seiten, Lücke 0,16 rad, leer rot gestrichelt
      schildring: { radius: 7, farbe: FARBE.schild, luecke: 0.16, alphaGrund: 0.35, alphaJeStufe: 0.16, breiteGrund: 1, breiteJeStufe: 0.6,
        leer: { farbe: FARBE.gefahr, alpha: 0.85, strich: [1.5, 2.5], breite: 1.5 } },
      schiff: { farbe: FARBE.text, rumpf: [-1, -4, 2, 7], fluegel: [-3, 0, 6, 2] },   // Symbol der Lerche, Bug oben: Rechtecke [dx, dy, w, h] (Mockup)
    },
    // Tafeln: oben links bleibt FREI (keine Kurs-/Tempo-Tafel, Auftrag KUL-03). Oben rechts das Sprungziel = TAFEL.rechts aus hauptschirm-tafeln.js
    // (wiederverwendet, 170 × 64; Mockup eckeZiel 150 × 50 mit anderer Zeilenfolge). Hülle, Ort und Hex-Kennung zeigt das Visier nicht.
    tafel: { links: false, rechts: true },
    // Skins für Leiste und Tafel: gleiche Funktion und Funktionsfarben, andere Fläche (Brückenpulte). rom: Streifen und Schrägen wie TAFEL.
    skin: {
      rom: {
        platte: { farbe: PAL.space, alpha: 0.94 },   // Leiste Mockup 0,93; = TAFEL.grund 94 %, eine Deckung für Leiste und Tafel
        kappe: { form: 'flaeche' },                   // Kopf dunkel auf Funktionsfläche (TAFEL.kappe)
      },
      germanen: {                  // „Schmiede & Bernstein“: Eisenplatte mit Kerben und Nieten, Funktionsfarbe als Wolfszahn-Band (Mockup kul.js tafel())
        platte: { farbe: EIGEN.eisenPlatte, alpha: 0.94 },   // Mockup 0,9; auf 94 % wie TAFEL.grund (Designer-Review KUL-02: sonst schimmert das Bild durch)
        ecke: 4,                   // alle vier Ecken 4 px abgeschrägt
        rand: { farbe: EIGEN.eisenRand, breite: 1, einzug: 4 },
        kerbe: { farbe: EIGEN.eisenKerbe, start: 12, schritt: 14, px: 2 },
        niete: { farbe: EIGEN.eisenNiete, px: 2, einzug: 3 },
        wolfszahn: { start: 6, schritt: 6, zahn: [[0, 2, 4, 1], [1, 3, 2, 1]] },   // je Zahn zwei Rechtecke [dx, dy, w, h] in der Funktionsfarbe (statt Streifen)
        kappe: { form: 'buckel', radius: 4, kern: 2, kernFarbe: FARBE.ink, textX: 11 },   // Schildbuckel in Funktionsfarbe, Kopftext daneben in Funktionsfarbe (Skala 1)
      },
    },
  };

  // ------------------------------------------------------------------ Kontrast (Doku, Test misst nach)
  const KONTRAST = {
    grund: PAL.space,
    werte: { amber: 12.4, brass: 7.3, mint: 12.2, ice: 12.3, red: 4.7 },
    nurAbSkala2: ['red'],
    // KUL-03 Visier: Paare Schrift/Form auf Fläche. alpha = Deckung der Schrift, grundAlpha = Deckung der Fläche (dann zusätzlich über Weiß geprüft,
    // dem hellsten Bild dahinter). Über Bild liegt die Schrift auf ihrer Kontur (FARBE.kontur, 90 %). min: Text 4,5, Rot Skala 2 und Formen 3.
    visier: [
      { name: 'Tempo Creme, Leiste rom', farbe: PAL.star, grund: PAL.space, grundAlpha: 0.94, doku: 16.6, min: 4.5 },
      { name: 'Stufe Bernstein, Leiste rom', farbe: PAL.amber, grund: PAL.space, grundAlpha: 0.94, doku: 12.4, min: 4.5 },
      { name: 'Gradzahl Bernstein 90 %, rom', farbe: PAL.amber, alpha: 0.9, grund: PAL.space, grundAlpha: 0.94, doku: 10.2, min: 4.5 },
      { name: 'Kurs im Kasten', farbe: PAL.amber, grund: PAL.space, doku: 12.4, min: 4.5 },
      { name: 'Tempo Creme, Leiste germanen', farbe: PAL.star, grund: EIGEN.eisenPlatte, grundAlpha: 0.94, doku: 15.5, min: 4.5 },
      { name: 'Stufe Bernstein, germanen', farbe: PAL.amber, grund: EIGEN.eisenPlatte, grundAlpha: 0.94, doku: 11.6, min: 4.5 },
      { name: 'Gradzahl Bernstein 90 %, ger.', farbe: PAL.amber, alpha: 0.9, grund: EIGEN.eisenPlatte, grundAlpha: 0.94, doku: 9.5, min: 4.5 },
      { name: 'Sprungziel Messing, Tafel ger.', farbe: PAL.brass, grund: EIGEN.eisenPlatte, grundAlpha: 0.94, doku: 6.85, min: 4.5 },
      { name: 'Boje Creme, Tafel germanen', farbe: PAL.star, grund: EIGEN.eisenPlatte, grundAlpha: 0.94, doku: 15.5, min: 4.5 },
      { name: 'ZIEL/Station Bernstein, Bild', farbe: PAL.amber, grund: EIGEN.tiefraum, grundAlpha: 0.9, doku: 13.0, min: 4.5 },
      { name: 'Sprungboje Messing, Bild', farbe: PAL.brass, grund: EIGEN.tiefraum, grundAlpha: 0.9, doku: 7.7, min: 4.5 },
      { name: 'DOCK-RING Mint, Bild', farbe: PAL.mint, grund: EIGEN.tiefraum, grundAlpha: 0.9, doku: 12.8, min: 4.5 },
      { name: 'NAV Eisblau, Bild', farbe: PAL.ice, grund: EIGEN.tiefraum, grundAlpha: 0.9, doku: 12.9, min: 4.5 },
      { name: 'Entfernung Creme, Bild', farbe: PAL.star, grund: EIGEN.tiefraum, grundAlpha: 0.9, doku: 17.4, min: 4.5 },
      { name: 'Randpfeil Rot Skala 2, Bild', farbe: PAL.red, grund: EIGEN.tiefraum, grundAlpha: 0.9, doku: 4.9, min: 3 },
      { name: 'Ringwert Eisblau 75 %, Glas', farbe: PAL.ice, alpha: 0.75, grund: EIGEN.tiefraum, grundAlpha: 0.9, doku: 7.4, min: 4.5 },
      { name: 'Gegnermarke Hellrot, Glas', farbe: EIGEN.gegnerHell, grund: EIGEN.tiefraum, doku: 6.5, min: 3 },
      { name: 'Hüllenbalken Rot auf Spur', farbe: PAL.red, grund: EIGEN.huelleSpur, doku: 4.35, min: 3 },
      { name: 'Gegnerpunkt, Lagescheibe', farbe: EIGEN.gegnerHell, grund: PAL.space, doku: 6.2, min: 3 },
    ],
  };

  const TOKENS = { SCHIRM, PAL, EIGEN, FARBE, TEXT, HIMMEL, STERNFELD, STERN, SONNE, PLANET, KUGEL, BOJE, GASRIESE, TAFEL, VISIER, KONTRAST };
  return { TOKENS };
});
