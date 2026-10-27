// SYS-01 Designer, Modus System: Tokens der Systemanzeige „Zonenkreuz“ (Richtung B, Kai 2026-10-27; dazu Bresche aus A, Banderole aus C).
// Globales `PultSysteme` (in Node als Modul, für tools/test-systeme-tokens.js). Nur Daten und kleine reine Hilfen: kein Zustand, keine Regeln,
// kein Netz. Was zerstört, offen, anvisiert ist, rechnet der Action-Layer; die Anzeige fragt hier nur „wie sieht das aus“.
// Gestaltungsnotiz: vault Pantheon/„Auftrag SYS-01 – Tokens“. Referenz-Sicht aller Zustände im echten Pult-Rahmen: public/systeme-preview.html.
//
//   PultSysteme.TOKENS          { FARBE, FARBE_SKIN, ZUSTAND, MASS, ABSTAND, ZEICHEN, TEXT, FN }
//   PultSysteme.farben(skinId)  -> FARBE mit den Flächen des Skins ('rom' | 'germanen'); Zustandsfarben sind in allen Skins gleich
//   PultSysteme.zustand(i, max, offline?) -> 'ok' | 'besch' | 'zer' | 'offline'   (beschädigt = höchstens die Hälfte, Annahme Designrichtungen)
//   PultSysteme.lage(rect, m)   -> Kacheln { bug, stb, heck, bb, mitte } des Kreuzes, Bug oben; m = MASS.kreuz.<station>
//   PultSysteme.kontrast(a, b)  -> WCAG-2.1-Kontrast zweier Hex-Farben
//
// Regeln (kurz, ausführlich in der Notiz):
//   - Rot (zer, zerText) heißt Gefahr/zerstört, Bernstein heißt „Weg frei / Ziel gewählt“, Mint heißt Schild, Gelb beschädigt, Creme heil.
//   - Roter TEXT auf Kacheln nie in FN.weapon (4,0–4,4:1), immer `zerText` (≥ 5,9:1). FN.weapon nur für Flächen, Ränder, Pips, Balken.
//   - Text auf voller roter Fläche (Banderole, bereite Waffe, Reaktor-Kachel klein) ist `ink`, nie Creme (Creme auf Rot 3,5:1).
//   - Jeder Zustand steht zusätzlich als Form oder Wort (gestrichelt + LEER, Schraffur + ZU, zer. / zerstört, AUS), nie nur als Farbe.
//   - Farbwerte stehen nur zwischen „// <tokens>“ und „// </tokens>“ (tools/check-terminal-farben.js prüft diese Datei mit).
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PultSysteme = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const P = root && root.Pult;

  // ================================================================= TOKENS
  // <tokens>
  // Funktionsfarben und Skins der Pulte (pult.js). Im Browser die echten Objekte; in Node der Spiegel (der Test prüft, dass er gleich ist).
  const FN = (P && P.FN) || { drive: '#FFC66B', shield: '#7FE0C2', weapon: '#E0473C', sensor: '#A9D6E5', nav: '#C9974A', cmd: '#F4EEDC', warn: '#F2C94C', neutral: '#8EA3B5', locked: '#6B7380' };
  const SKIN = (P && P.SKINS) || {
    rom: { bg: '#0B0E1A', screenBg: '#070A14', text: '#F4EEDC', dim: '#8EA3B5', off: '#18202F', offLine: '#3A4A66', ink: '#0B0E1A' },
    germanen: { bg: '#13110F', screenBg: '#0D0C0B', text: '#EDE3CF', dim: '#9A8F80', off: '#1D1A17', offLine: '#3B3632', ink: '#13110F', plate: '#27231F', iron: '#4C4741' },
  };
  const ROM = SKIN.rom;

  // Farben nach Rolle (Skin rom). Kontrastwerte: gemessen mit kontrast(), Prüfung in tools/test-systeme-tokens.js.
  const FARBE = {
    // Grund und Kacheln
    grund: ROM.screenBg,          // Anzeige #070A14
    kachel: '#141B2B',            // Zone mit Systemen: Creme 14,8 · Dim 6,6 · zerText 6,2 · Gelb 10,8 · Mint 10,9 · Bernstein 11,1
    kachelRand: '#2A3550',        // 1-px-Rand der vollen Zone (Ordnung, keine Information)
    kachelLeer: '#24121A',        // leere Zone (alle Systeme zerstört): Creme 15,4 · zerText 6,4; Rand gestrichelt in `zer`
    kachelReaktor: '#3A1214',     // Mitte bei zerstörtem Reaktor (groß): Creme 14,2 · zerText 5,9; Rand `zer`
    text: ROM.text,               // Creme, Systemname heil
    dim: ROM.dim,                 // Beschriftung (BUG, Legende), Systeme hinter „ZU“
    ink: ROM.ink,                 // Schrift auf voller Funktionsfläche
    // Zustand der Systeme (Pips und Name)
    ok: ROM.text,                 // heil: Creme
    besch: FN.warn,               // beschädigt (≤ halbe Integrität): Gelb
    zer: FN.weapon,               // zerstört: Fläche, Rand, Pip-Strich, Balken (#E0473C, als Grafik 4,2:1 auf Kachel)
    zerText: '#FF6B5E',           // zerstört als TEXT („zer.“, „zerstört“, LEER, ZU, REAKTOR): 6,2 Kachel · 6,4 leer · 5,9 Reaktor · 7,1 Grund
    offline: FN.locked,           // Reaktor offline nach Notfallsprung: Pips hohl in dieser Farbe (3,6:1 Grafik), Wort AUS in `dim`
    pipLeer: '#5E6F8F',           // verlorener Integritätspunkt (3,4:1 auf Kachel, vorher offLine 1,9:1: Lücken waren kaum zu sehen)
    // Schildschichten (übereinander: äußere Reihe = äußere Schicht, beide müssen fallen)
    schild: FN.shield,            // Segment geladen
    schildLeer: ROM.off,          // Segment leer: Fläche off …
    schildLeerRand: ROM.offLine,  // … mit Rand offLine (wie Pult.segs)
    schildUnt: '#2A1416',         // Schicht unterdrückt (Sturm): dunkelrote Fläche …
    schildUntStrich: FN.weapon,   // … mit roter Schraffur (Schritt MASS.schraffurUnt)
    // Mitte zu / offen
    zuSchraffur: '#3F4B5B',       // Schraffur über der geschlossenen Mitte (Dim 35 % in Kachel; Textur, 1,9:1)
    zuText: '#FF6B5E',            // „ZU“ (= zerText), auf Grund-Fleck
    wandGegner: FN.drive,         // offene Wand zur Mitte beim Gegner: Bernstein = Weg frei
    wandEigen: FN.weapon,         // offene Wand zur Mitte bei uns: Rot = Gefahr
    seiteZugewandt: FN.drive,     // Rahmen um die Zone, die uns das Ziel zeigt
    // Systemziel (Ops, Taste 0) und gezielter Treffer gegen uns (Technik)
    systemziel: FN.drive,         // Name und Marke des anvisierten Systems
    systemzielZeile: '#484139',   // Zeilenfläche (Bernstein 22 % in Kachel): Bernstein darauf 6,5 · Creme 8,7
    gezielt: '#FF6B5E',           // Gegner zielt auf dieses System: Zeichen → und Name (= zerText)
    gezieltZeile: '#39232E',      // Zeilenfläche (Rot 18 % in Kachel): zerText 5,2 · Creme 12,5
    // Bresche auf der Taktikkarte (leere Zone: Keil vom Schildring zum Kern)
    brescheGegner: FN.drive,      // Gegner: Bernstein wie die offene Wand (Rot auf roter Kennung verschwindet), 12,3:1 auf Karte
    brescheEigen: FN.weapon,      // eigenes Schiff: Rot, 4,7:1 auf Karte
    // Reaktor-Countdown: Banderole über jeder Anzeige
    banderole: FN.weapon,         // volle Fläche
    banderoleText: ROM.ink,       // alle Texte darauf (4,7:1), auch die zweite Zeile
    banderoleSpur: '#3A1214',     // Ablaufbalken darunter: Spur …
    banderoleAblauf: ROM.text,    // … Restzeit in Creme (11,9:1 zur Spur; Rot an Rot lief in die Banderole)
    // Cooldown je Waffenzelle (Pult.zelle Zustand 'hold')
    cdFlaeche: '#5C2427',         // = mix(weapon, bg, 0,62), wie Pult.zelle hold
    cdSpur: '#4B1F24',            // Balkenspur unten
    cdBalken: ROM.text,           // gefüllter Anteil
    cdText: ROM.text,             // Sekunden „1,4 s“: Creme 10,4:1 (Rot darauf nur 3,0:1, Hellrot 4,3:1)
    cdBesch: FN.warn,             // Sekunden einer beschädigten Waffe: Gelb 7,6:1
    bereit: FN.weapon,            // bereit = volle rote Fläche, Text ink 4,7:1
    // Statusleiste (Feld statt HÜLLE): Fläche je Lage, Text ink (Skin rom) bzw. Farbe (Skin germanen)
    statusVoll: FN.sensor,        // ZONEN VOLL
    statusBesch: FN.warn,         // ZONEN BB 2/4
    statusOffen: FN.weapon,       // MITTE BB OFFEN
    statusReaktor: FN.weapon,     // REAKTOR 6,4 s
  };
  // Skin germanen: nur die Flächen wechseln, Zustände bleiben (Funktion gleich in allen Skins)
  const FARBE_SKIN = {
    rom: {},
    germanen: {
      grund: SKIN.germanen.screenBg, kachel: SKIN.germanen.plate, kachelRand: SKIN.germanen.iron,   // Creme 12,3 · Dim 4,9 · zerText 5,6 auf Platte
      text: SKIN.germanen.text, ok: SKIN.germanen.text, dim: SKIN.germanen.dim, ink: SKIN.germanen.ink,
      schildLeer: SKIN.germanen.off, schildLeerRand: SKIN.germanen.offLine, banderoleText: SKIN.germanen.ink, cdBalken: SKIN.germanen.text, cdText: SKIN.germanen.text,
      banderoleAblauf: SKIN.germanen.text,
    },
  };

  // Zustand -> Darstellung (eine Regel für Technik, Ziel-Scan, Steuer)
  const ZUSTAND = {
    ok: { pip: 'ok', name: 'text' },
    besch: { pip: 'besch', name: 'text' },                         // Name bleibt Creme, die Pips sagen „beschädigt“
    zer: { pip: 'zer', pipForm: 'strich', name: 'zerText', wort: 'zerstoert' },
    offline: { pip: 'offline', pipForm: 'hohl', name: 'dim', wort: 'offline' },
    hinterZu: { name: 'dim' },                                      // Systeme der geschlossenen Mitte (Gegner): sichtbar, nicht wählbar
  };

  // Maße in Spielpixeln (640×360). Kreuz: Anteile der Kachelbreiten/-höhen und Abstände je Station.
  //   ws = Breite Bb/Stb als Anteil, hb = Höhe Bug/Heck als Anteil, gap = Fuge zwischen Kacheln, schild = Dicke einer Schildschicht,
  //   schichtFuge = Fuge zwischen zwei Schichten, pip = { w, h, fuge }, zeile = Zeilenhöhe Text, zweiZeilig = Kachelbreite, ab der Name und Pips untereinander stehen
  const MASS = {
    kreuz: {
      technik: { dx: 98, dy: 16, w: 378, h: 166, ws: 0.32, hb: 0.25, gap: 4, schild: 3, schichtFuge: 1, pip: { w: 4, h: 5, fuge: 1 }, zeile: 10, zweiZeilig: 66, text: 'lang', tasten: true, zahlScale: 2 },
      ziel: { dx: 6, w: -12, h: 116, ws: 0.31, hb: 0.22, gap: 4, schild: 2, schichtFuge: 1, pip: { w: 2, h: 5, fuge: 1 }, pipZweiZeilig: { w: 2, h: 3, fuge: 1 }, zeile: 10, zeileZweiZeilig: 16, zweiZeilig: 66, text: 'kurz' },
      steuer: { w: 58, h: 58, ws: 0.28, hb: 0.27, gap: 2, schild: 2, schichtFuge: 1, block: { w: 4, h: 3, fuge: 1 }, text: null },
    },
    technikS: 200,                 // Statusleiste der Technik (Anzeige 188 px hoch), wie im Mockup
    zielKastenW: 158,              // unverändert: Taktikkarte 404 px (B braucht keinen breiteren Zielkasten)
    innen: 4,                      // Innenabstand Text in der Kachel
    seiteRahmen: 2,                // Abstand des Bernstein-Rahmens der zugewandten Seite
    wand: 2,                       // Dicke der offenen Wand zur Mitte (ragt 3 px in die Fuge)
    systemzielMarke: 2,            // Strich links an der Zeile des Systemziels / des gezielten Systems
    schraffurZu: 4, schraffurUnt: 2,
    banderole: { h: 18, ablauf: 2, zahlScale: 2 },   // über der Anzeige (y 6), volle Breite 572
    cdBalken: 2,                   // Höhe Cooldown-Balken in der Zelle (wie Halten der Lanze)
    bresche: { halbwinkel: 0.6, deckkraft: 0.35, kante: 1 },   // Keil auf der Karte: Winkel wie die Schildseite (±0,6 rad), Fläche transparent, Kante voll
  };
  const ABSTAND = { xs: 2, s: 4, m: 8, l: 12, xl: 16 };   // 4er-Raster mit 2er-Feinschritt (wie Terminal)

  // Zeichen und feste Wörter (Pixelschrift art.js: alle Zeichen vorhanden)
  const ZEICHEN = { gezielt: '→', trenner: '·', bug: 'BUG', zu: 'ZU', leer: 'LEER', zerKurz: 'zer.', zerLang: 'zerstört', offline: 'AUS', bereit: 'bereit', sekunde: ' s' };
  const TEXT = {
    zone: { bug: 'BUG', stb: 'STB', heck: 'HECK', bb: 'BB', mitte: 'MITTE' },
    zoneLang: { bug: 'Bug', stb: 'Steuerbord', heck: 'Heck', bb: 'Backbord', mitte: 'Mitte' },
    statusLabel: { zonen: 'ZONEN', mitte: 'MITTE', reaktor: 'REAKTOR' },
    statusVoll: 'VOLL', offen: 'OFFEN',
    mitteZu: 'Mitte zu · {zone} leeren', mitteOffen: 'Mitte offen über {zone}',
    banderole: 'REAKTOR ZERSTÖRT', ausfall: '{n}. Ausfall · nächster {s} s',
    gezielt: '{wer} zielt {zeichen} {system}',
  };
  // </tokens>

  const TOKENS = { FARBE, FARBE_SKIN, ZUSTAND, MASS, ABSTAND, ZEICHEN, TEXT, FN };

  // ================================================================= Hilfen (rein)
  function farben(skinId) { return Object.assign({}, FARBE, FARBE_SKIN[skinId] || {}); }
  function zustand(i, max, offline) { if (offline) return 'offline'; if (!(i > 0)) return 'zer'; return i <= max / 2 ? 'besch' : 'ok'; }
  // Kacheln des Kreuzes, Bug oben (wie Werft-Terminal und Ziffernblock): Bb links über die ganze Höhe, Stb rechts, Bug/Mitte/Heck in der Mittelspalte
  function lage(b, m) {
    const g = m.gap, ws = Math.round(b.w * m.ws), wc = b.w - 2 * ws - 2 * g, hb = Math.round(b.h * m.hb), hm = b.h - 2 * hb - 2 * g;
    return {
      bb: { x: b.x, y: b.y, w: ws, h: b.h, kante: 'l' },
      stb: { x: b.x + ws + g + wc + g, y: b.y, w: ws, h: b.h, kante: 'r' },
      bug: { x: b.x + ws + g, y: b.y, w: wc, h: hb, kante: 'o' },
      heck: { x: b.x + ws + g, y: b.y + hb + g + hm + g, w: wc, h: hb, kante: 'u' },
      mitte: { x: b.x + ws + g, y: b.y + hb + g, w: wc, h: hm },
    };
  }
  function text(vorlage, werte) { return String(vorlage).replace(/\{(\w+)\}/g, (_, k) => (werte && werte[k] != null ? werte[k] : '')); }
  function lum(h) { const n = parseInt(String(h).slice(1, 7), 16); return [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0); }
  function kontrast(a, b) { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); }

  return { TOKENS, farben, zustand, lage, text, kontrast };
});
