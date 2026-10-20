// SUND-01 C Design: Tokens der Übersichtskarte Sund (Wissen von Rom). Richtung „Meldetafel“ mit Sichtgrenze und Dunkel aus der
// „Lichtkarte“ (Kai 2026-10-18). Spezifikation: CONCEPT-SUND01-KARTE.md. Nur Daten und kleine reine Hilfsfunktionen, kein Zustand,
// kein Zeichnen, keine Netzlogik. Farben sind die vorhandenen Pult-Farben (art.js PAL, render.js PAL, icons-b.js PAL, kartenzeichen.js
// COL); hier stehen sie nur unter ihrer Rolle auf der Karte. Neue Werte gibt es nur für Muster, Dunkel und Maße.
//
//   KarteTokens.FARBE      Rollenfarben (Wissen, Fraktion, Phase, Front, Sicht, Dunkel, Plakette, Meldeliste, Funk)
//   KarteTokens.MUSTER     Besitzermuster je Fraktion als 8×8-Maske ('#' = Pixel), Deckkraft hell/im Dunkel
//   KarteTokens.MASS       Maße in Spielpixeln (Plakette, Lampen, Phasenfeld, Abstände, Hexradius-Bereiche, Linien, Seitenleiste)
//   KarteTokens.TEXT       Texte (Phasen-Kürzel und Langform, Stärkeklassen, Wissensstufen, Meldeliste, Legende, Funkvorlagen)
//   KarteTokens.STAERKE    Stärkeklasse 1..3 -> { lampen, name }
//   KarteTokens.WERTE      Anzeige-Grenzen (Altstand-Höchstalter, Listenlänge …); Sichtweite und Verzögerung kommen vom Server
//   Hilfen (rein):  wissensstufe(alter, vz) · lampen(k) · staerkeName(k) · phaseFeld(p, fraktion, stufe, alter) · alterText(a)
//                   bereich(s) · hexReihenfolge(karte) · alterZeichen(a) · alterLesen(c) · hxLesen(hx, codes) · vorlage(id, werte)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KarteTokens = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------------ Pult-Grundfarben (gespiegelt, nicht neu)
  const PULT = {
    tisch: '#0B0E1A',     // art.js tiefraum, kartenzeichen COL.tisch
    tief: '#141A2A',      // icons-b PAL.tief
    stahl: '#2E3A4A',     // icons-b PAL.stahl
    aus: '#3A4A66',       // Knopf „aus“ (offLine)
    lampeAus: '#18202F',  // Knopf „aus“ (off)
    hell: '#F4EEDC',      // sternweiss
    grau: '#9AA6B8',      // gedaempft
    leise: '#6F7E91',     // Text im Dunkel (Lichtkarte)
    stahlhell: '#8EA3B5', // paneelHell
    eis: '#A9D6E5',       // Funktionsfarbe Sensoren
    messing: '#C9974A',   // Funktionsfarbe Navigation, Abschnittsköpfe
    gold: '#FFC66B',      // bernstein, Namen, Kanten
    rot: '#E0473C',       // alarmrot, Gefahr
    warn: '#F2C94C',      // warngelb
    mint: '#7FE0C2',      // eigen / bereit
    rost: '#C2703D',      // rostsand, Piraten
    glut: '#FF8A4C',      // gesperrt
    notruf: '#FF6B5E',    // kartenzeichen MARKEN.notruf
  };

  // ------------------------------------------------------------------ Farben nach Rolle
  const FARBE = {
    pult: PULT,
    // Fraktionen: Buchstabe + Haltungsfarbe (Plakette) + Fläche (wie icons-b FRAKTION). Kürzel = Code im Anzeigeblock.
    fraktion: {
      r: { id: 'rom', buchstabe: 'R', name: 'Rom', haltung: PULT.mint, flaeche: '#6B2E2E', muster: 'rom', fahne: '#C8574F' },
      // Germanen: Hellrot (= Notruf-Marke) statt Alarmrot, weil Alarmrot unter Protanopie so dunkel wird, dass das dunkle „G“ verschwindet
      g: { id: 'ger', buchstabe: 'G', name: 'Germanen', haltung: PULT.notruf, flaeche: '#3F4A28', muster: 'ger', fahne: '#8FA35A' },
      k: { id: 'saum', buchstabe: 'K', name: 'Konkordat', haltung: PULT.eis, flaeche: '#4A4466', muster: 'saum', fahne: '#9A90C8' },
      p: { id: 'pirat', buchstabe: 'P', name: 'Piraten', haltung: PULT.rost, flaeche: '#5C3A1E', muster: 'pirat', fahne: PULT.rost },
      '-': { id: 'frei', buchstabe: '-', name: 'herrenlos', haltung: PULT.grau, flaeche: '#33404F', muster: 'frei', fahne: PULT.grau },
      v: { id: 'vorl', buchstabe: 'V', name: 'Vorläufer', haltung: '#B79CE0', flaeche: '#1F5555', muster: 'vorl', fahne: '#B79CE0' },
    },
    // Wissensstufen der Plakette (Form trägt die Stufe, nicht die Farbe)
    wissen: {
      jetzt: { buchstabeFeld: 'haltung', buchstabeText: PULT.tisch, lampe: PULT.hell, rahmenMisch: 0.35 },          // eigen, exakt
      gesehen: { buchstabeFeld: 'haltung', buchstabeText: PULT.tisch, lampe: PULT.hell, lampeRaster: PULT.aus, rahmenMisch: 0.35 }, // Stand T−vz
      alt: { buchstabeFeld: null, buchstabeText: PULT.grau, lampeUmriss: PULT.grau, rahmen: PULT.aus, alterText: PULT.grau },     // Altstand
    },
    // Phasenfeld rechts in der Plakette
    phase: {
      s: { bg: PULT.warn, fg: PULT.tisch },               // sammelt
      m: { bg: 'haltung', fg: PULT.tisch, pfeil: true },  // marschiert (Pfeil = Kurs); feindlich Rot, eigen Mint
      b: { bg: PULT.notruf, fg: PULT.tisch },             // belagert (Hellrot, Protanopie)
      u: { bg: 'haltung', fg: PULT.tisch, pfeil: true },  // unterwegs (Patrouille, Beanspruchen)
      r: { bg: PULT.stahlhell, fg: PULT.tisch, pfeil: true }, // Rückzug
      h: null,                                            // hält Stellung: kein Phasenfeld
    },
    plakette: { grund: PULT.tisch, lampeLeer: PULT.lampeAus },
    // Front: Warnbake auf der Hexseite Rom | Germanen
    front: { a: PULT.hell, b: PULT.rot, unterlage: PULT.tisch },
    // Sichtgrenze (Funktionsfarbe Sensoren) und Dunkel außerhalb der Sicht
    sicht: { linie: PULT.eis, unterlage: PULT.tisch },
    dunkel: {
      abdunklung: 'rgba(4,6,12,0.62)',
      korn: { hell: 'rgba(244,238,220,0.07)', dunkel: 'rgba(0,0,0,0.35)', anzahl: 30, kachel: 16, seed: 7 },
      name: PULT.leise, inhaltAlpha: 0.45,
    },
    belagerung: { rahmen: PULT.hell, rahmenStrich: PULT.rot, unterlage: PULT.tisch },   // gestreift wie die Bake
    vermutet: { linie: PULT.hell, unterlage: PULT.tisch, marke: PULT.hell },
    meldeliste: {
      kopf: PULT.messing, neu: PULT.rot, gewaehlt: 'rgba(244,238,220,0.10)', gewaehltKante: PULT.hell,
      textNeu: PULT.hell, textGesehen: '#C9D2DC', textAlt: PULT.grau, mehr: PULT.grau,
    },
    ortsinfo: { jetzt: PULT.mint, gesehen: PULT.eis, alt: PULT.grau, unbekannt: PULT.grau },
    funk: { akzentFeind: PULT.rot, akzentLage: PULT.messing, kopf: PULT.gold, text: PULT.hell },
  };

  // ------------------------------------------------------------------ Besitzermuster (Farbenblind: zweites Merkmal neben der Fläche)
  // 8×8-Kachel, '#' = Pixel in Hell. Kräftiger als icons-b (dort 0,16, 1 Linie je 8 px): Linien je 4 px, Deckkraft 0,30.
  // Im Dunkel wird das Muster nach der Abdunklung erneut mit `dunkel` gezeichnet, damit der zuletzt bekannte Besitzer lesbar bleibt.
  const MUSTER = {
    rom: { name: 'waagrecht', hell: 0.30, dunkel: 0.24, kachel: [
      '........', '########', '........', '........', '........', '########', '........', '........'] },
    ger: { name: 'senkrecht', hell: 0.30, dunkel: 0.24, kachel: [
      '.#...#..', '.#...#..', '.#...#..', '.#...#..', '.#...#..', '.#...#..', '.#...#..', '.#...#..'] },
    saum: { name: 'keins', hell: 0, dunkel: 0, kachel: null },
    pirat: { name: 'punkte', hell: 0.30, dunkel: 0.24, kachel: [
      '........', '.##.....', '.##.....', '........', '........', '.....##.', '.....##.', '........'] },
    frei: { name: 'kreuze', hell: 0.22, dunkel: 0.18, kachel: [
      '........', '...#....', '..###...', '...#....', '........', '........', '........', '........'] },
    vorl: { name: 'rauten', hell: 0.22, dunkel: 0.18, kachel: [
      '...#....', '..#.#...', '...#....', '........', '........', '........', '........', '........'] },
  };

  // ------------------------------------------------------------------ Maße (Spielpixel; Konsole 640×360, Schrift 5×7, Zeile 10)
  const MASS = {
    plakette: {
      hoehe: 9, rahmen: 1, unterlage: 1,          // 1 px dunkler Rand um die Plakette (deckt Muster und Kanten)
      buchstabe: { breite: 7 },                    // Feld innen 7×7
      lampe: { breite: 3, hoehe: 5, abstand: 1, anzahl: 3, oben: 2 },
      phase: { minBreite: 8, polster: 3 },         // Breite = max(8, Textbreite + 3); Pfeil 7 px
      breiteOhnePhase: 22,                         // 1 + 7 + 1 + 3·(3+1) + 1
      breiteMitPhase: 30,                          // + 8
      kurz: { breite: 9 },                         // Bereich „knapp“: nur Buchstabenfeld + Rahmen
      // Lage im Hex (s = Hexradius, h3 = √3·s): Mitte x = p.x, Mitte y = p.y + round(−0.36·h3) (oberes Band, frei, seit die Koordinate
      // entfällt); mit Notruf-Marke im Hex 9 px nach links. Die Hafenklasse steht auf Symbolhöhe rechts neben dem Symbol (hafenDy −4; bei s < 30 entfallen dafür die Nebensymbole, SUND-01 F).
      // Zweite Plakette (nur Belagerung): Verteidiger ersetzt Hafensymbol und Klasse, Mitte (p.x, p.y + 1), im Belagerungsrahmen.
      anker: { dy: -0.36, dx: 0, dxNotruf: -9, hafenDy: -4, verteidigerDy: 1 },
      maxJeHex: 2, mehrChip: { breite: 11, hoehe: 9 },   // „+1“ bei mehr als zwei Plaketten
    },
    kurs: { pfeil: 0.2, pfeilMin: 5, abstandRand: 6 },   // Pfeil 6 px innen vor der Hexseite, Größe max(5, 0.2·s): eigene Flotte hinaus zum nächsten Hex (n), fremde hinein von der Seite, aus der sie kam (v)
    vermutet: { strich: [4, 3], breite: 1, unterlage: 3, marke: { breite: 8, hoehe: 10 }, maxHexe: 3 },
    front: { breite: 5, unterlage: 8, segment: 4, ueberstand: 0.28 },   // Streifen hell/rot, je 4 px; Seite um 28 % verlängert
    sicht: { breite: 2, unterlage: 4 },
    belagerung: { rahmen: 2, unterlage: 4, abstandX: 3, abstandY: 4, strich: [3, 3] },   // Rahmen um die Verteidiger-Plakette, Hell mit roten Strichen
    // Hexradius-Bereiche: voll = ganze Plakette, knapp = Kurzplakette (Buchstabe, Phase als Rahmenfarbe), kompakt = HUD-Ausschnitt
    hexradius: { voll: 22, knapp: 14, ausgang: 23.6, nahMax: 40, nebenMin: 30 },
    // Ausgangsansicht der Sternkarte im Modus Freie Fahrt (siehe Konzept §8)
    ansicht: { seitenleiste: 0, ring: false, nahSpruenge: 2 },
    // rechte Spalte der Captain-Konsole (consoles.js capStar: rx = a.x + 420, rw = 196)
    spalte: {
      zeile: 10, kopf: 11, abschnitt: 4,
      meldung: { zeile: 12, max: 5, textX: 40, plaketteX: 2 },
      legende: { zeile: 12, zeilen: 3 },
    },
    notruf: { r: 0.2, rMin: 5, rMax: 9 },   // wie starmap.js Marken
  };

  // ------------------------------------------------------------------ Stärkeklassen (Server liefert k = 1..3, Schwellen in sund-sim-werte.json)
  const STAERKE = {
    1: { lampen: 1, name: 'klein' },
    2: { lampen: 2, name: 'mittel' },
    3: { lampen: 3, name: 'groß' },
  };

  // ------------------------------------------------------------------ Anzeige-Grenzen
  const WERTE = {
    altMax: 12,         // Altstand-Plaketten älter als so viele Ticks entfallen (Meldeliste auch)
    meldungAlter: 3,    // Ereigniszeilen ohne Flotte (Hafen gefallen …) bleiben so viele Ticks in der Liste
    neuTicks: 1,        // „neu“-Strich in der Meldeliste: Meldung aus dem letzten Tick
    flottenMax: 12,     // höchstens so viele Flotten im Anzeigeblock (nach Rang)
    meldungenMax: 6,
    funkDauer: 6,       // Sekunden Einblendung (hud.js radioFlash)
  };

  // ------------------------------------------------------------------ Texte
  const TEXT = {
    phase: {
      s: { kurz: 'S', lang: 'sammelt sich', liste: 'sammelt' },
      m: { kurz: 'M', lang: 'marschiert', liste: '→' },
      b: { kurz: 'B', lang: 'belagert', liste: 'belagert' },
      u: { kurz: '>', lang: 'unterwegs', liste: '→' },
      r: { kurz: '<', lang: 'zieht sich zurück', liste: 'Rückzug →' },
      h: { kurz: '', lang: 'hält Stellung', liste: 'steht' },
    },
    wissen: {
      jetzt: 'eigen, aktuell',
      gesehen: 'gesehen, Stand Tick {t}',
      alt: 'außer Sicht, Stand vor {a} Ticks',
      unbekannt: 'außer Sicht, nie gesehen (Kartenstand)',
    },
    ziel: { unbekannt: 'Ziel unbekannt', vermutet: 'Ziel vermutlich {ziel}', bekannt: 'Ziel {ziel}' },
    meldeliste: {
      kopf: 'MELDUNGEN · STAND T-{vz}', leer: 'Keine Flotten gemeldet.', mehr: '+{n} weitere',
      sammelt: '{ort} · sammelt seit {d}', marsch: '{ort} → {nach} ?', unterwegs: '{ort} → {nach}', kam: '{von} → {ort}',
      belagert: '{ort} · belagert', steht: '{ort}', alt: '{ort} · vor {a} Ticks',
      hafenGefallen: '{ort} gefallen', hafenHaelt: '{ort} hält', postenNeu: 'Posten {ort}', postenWeg: 'Posten {ort} verloren',
    },
    ortsinfo: { aussenKnoten: 'Nächster Knoten: {n} Sprünge', sicht: 'Sicht reicht {w} Sprünge' },
    legende: {
      jetzt: 'jetzt', gesehen: 'T-1', alt: 'alt',
      phasen: 'S sammelt · ▶ Kurs · B belagert',
      front: 'Front', sicht: 'Sicht', dunkel: 'außer Sicht', dunkelKurz: 'dunkel',   // dunkelKurz: schmale Spalte (Pult), SUND-01 C
    },
    // Funkvorlagen (feste Texte, kein LLM). {von} = Knoten, der es gesehen hat (Posten X, Wache X, Lerche).
    funk: {
      von: { posten: 'Posten {ort}', hafen: 'Hafen {ort}', flotte: 'Flotte bei {ort}', lerche: 'Sensoren Lerche' },
      sammeln: 'Germanische Flotte sammelt sich bei {ort}. Stärke {klasse}, Ziel unbekannt.',
      marsch: 'Germanische Flotte ({klasse}) bricht von {ort} auf, Kurs {nach}. Ziel vermutlich {ziel}.',
      belagerung: '{ziel} wird belagert. Germanische Flotte, Stärke {klasse}.',
      gefallen: '{ziel} ist gefallen.',
      gehalten: '{ziel} hat die Belagerung abgewehrt.',
      log: { sammeln: 'Germanische Flotte sammelt sich ({klasse}). Tick {t}.', marsch: 'Germanische Flotte marschiert, Kurs {nach} ({klasse}). Tick {t}.',
        belagerung: 'Belagert ({klasse}). Tick {t}.', gefallen: 'Gefallen. Tick {t}.', gehalten: 'Belagerung abgewehrt. Tick {t}.' },
    },
  };

  // ------------------------------------------------------------------ Hilfen (rein)
  // Wissensstufe aus dem Alter in Ticks: 0 = jetzt (eigen), ≤ vz = gesehen, sonst alt; null = unbekannt.
  function wissensstufe(alter, vz) {
    if (alter == null) return 'unbekannt';
    if (alter <= 0) return 'jetzt';
    return alter <= (vz || 1) ? 'gesehen' : 'alt';
  }
  function lampen(k) { return (STAERKE[k] || STAERKE[1]).lampen; }
  function staerkeName(k) { return (STAERKE[k] || STAERKE[1]).name; }
  // Phasenfeld der Plakette: { text } oder { pfeil: true }, mit bg/fg; null = kein Feld. Altstand zeigt statt der Phase das Alter.
  function phaseFeld(p, fraktion, stufe, alter) {
    if (stufe === 'alt') return { text: alterText(alter), bg: null, fg: FARBE.wissen.alt.alterText };
    const f = FARBE.phase[p];
    if (!f) return null;
    const hal = (FARBE.fraktion[fraktion] || FARBE.fraktion['-']).haltung;
    return { text: f.pfeil ? null : TEXT.phase[p].kurz, pfeil: !!f.pfeil, bg: f.bg === 'haltung' ? hal : f.bg, fg: f.fg };
  }
  function alterText(a) { return a > 99 ? '99' : String(a); }
  // Hexradius-Bereich: 'voll' | 'knapp' | 'kompakt'
  function bereich(s) { return s >= MASS.hexradius.voll ? 'voll' : s >= MASS.hexradius.knapp ? 'knapp' : 'kompakt'; }
  // Reihenfolge der Hexe im Feld hx des Anzeigeblocks: Codes der Karte, aufsteigend sortiert
  function hexReihenfolge(karte) { return Object.keys((karte && karte.hexe) || {}).sort(); }
  // Alter im Anzeigeblock: e = jetzt, 1–9 a–d f–z = Ticks (das e fehlt: es heißt „jetzt“; z = 34 und mehr), ? = nie gesehen. Gemeinsame Quelle für Server und Client.
  const ALTER_ZEICHEN = '123456789abcdfghijklmnopqrstuvwxyz';
  function alterZeichen(a) { if (a == null) return '?'; if (a <= 0) return 'e'; return ALTER_ZEICHEN[Math.min(a, ALTER_ZEICHEN.length) - 1]; }
  function alterLesen(c) { if (c === 'e') return 0; if (c === '?' || c === undefined) return null; const i = ALTER_ZEICHEN.indexOf(c); return i < 0 ? null : i + 1; }
  // hx: je Hex zwei Zeichen. 1. Besitzer (r g k p - v; groß = Posten im Hex), 2. Alter (alterZeichen).
  // -> { code: { f, posten, alter } } (alter: 0 jetzt, n Ticks, null unbekannt). Ungültige Zeichen ergeben null-Felder, nie Fehler.
  function hxLesen(hx, codes) {
    const out = {};
    const s = String(hx || '');
    for (let i = 0; i < codes.length; i++) {
      const b = s[2 * i], a = s[2 * i + 1];
      if (b === undefined) break;
      const lo = b.toLowerCase();
      const alter = alterLesen(a);
      out[codes[i]] = { f: FARBE.fraktion[lo] ? lo : null, posten: b !== lo, alter };
    }
    return out;
  }
  // Textvorlage füllen: vorlage('funk.sammeln', { ort: 'Ulfsvakt', klasse: 'groß' })
  function vorlage(id, werte) {
    let t = TEXT;
    for (const k of String(id).split('.')) t = t && t[k];
    if (typeof t !== 'string') return '';
    return t.replace(/\{(\w+)\}/g, (m, k) => (werte && werte[k] != null ? String(werte[k]) : m));
  }

  return { PULT, FARBE, MUSTER, MASS, STAERKE, WERTE, TEXT, wissensstufe, lampen, staerkeName, phaseFeld, alterText, alterZeichen, alterLesen, bereich, hexReihenfolge, hxLesen, vorlage };
});
