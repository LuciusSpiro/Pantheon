// CHA-01 Designer, Modus System: Tokens der „Kleiderkammer“ (Richtung B, Kai 2026-10-31): Charakterliste, Charaktererstellung, Spind.
// Globales `PultKammer` (in Node als Modul, für tools/test-kammer-tokens.js). Nur Daten und kleine reine Hilfen: kein Zustand, kein Netz, keine Regeln.
// Was ein Charakter tragen darf, was gesperrt ist und was gespeichert wird, entscheiden Katalog, shared/charakter.js und der Server;
// die Anzeige fragt hier nur „wie sieht das aus“ und „wo liegt es“.
// Gestaltungsnotiz: vault Pantheon/„Auftrag CHA-01 – Tokens“. Referenzzeichnung im echten Pult-Rahmen: public/kammer-preview.html (?pult=rom|germanen),
// Bilder mit node tools/sicht-kammer.js. Startmenü und Lobby: public/js/menue-tokens.js, Namensmarke: public/js/namensmarke-tokens.js.
//
//   PultKammer.TOKENS              { FARBE, FARBE_SKIN, MASS, ZIFFERNBLOCK, NUMPAD, PLATZ, HERKUNFT, STATUS, TEXT, FN }
//   PultKammer.farben(skinId)      -> FARBE mit den Flächen des Skins ('rom' | 'germanen'); Funktionsfarben gleich in allen Skins
//   PultKammer.rahmen(S?)          -> { anzeige, pult } wie Pult.rahmen sie liefert (S = Statusleiste, Standard MASS.S)
//   PultKammer.ziffernblock(art, pultRect?) -> [{ taste, platz, rect, leer }] für art 'spind' | 'erstellung' (leere Tasten mit leer: true)
//   PultKammer.kacheln(anzeigeRect, n) -> Rechtecke der Teile-Kacheln (5 × 2, Bild oben, zwei Zeilen Text unten)
//   PultKammer.karten(anzeigeRect)  -> 4 Rechtecke der Charakterkarten mit { bild } (Porträtfenster)
//   PultKammer.figur(anzeigeRect)   -> Figurfenster rechts in der Anzeige (Erstellung: Nahansicht, Spind: ganze Figur)
//   PultKammer.muster(x, y, n)      -> Rechtecke der Farbmuster einer Zeile (Haut, Haar)
//   PultKammer.herkunft(teil)       -> { gesperrt, kappe ('H' | 'F' | null), sub } aus teil.herkunft ('frei' | 'haendler' | 'fund'), teil.preis, teil.volk
//   PultKammer.text(vorlage, werte), PultKammer.kontrast(a, b)
//
// Regeln (kurz, ausführlich in der Notiz):
//   - Die Kammer ist eine Pult-Station: Pult.rahmen, Pult.knopf, Pult.titel, Pult.zelle. Keine eigenen Knöpfe, keine eigene Schrift (Pixelschrift art.js).
//   - Messing (FN.nav) = Plätze und „getragen“, Bernstein (FN.drive) = Abschluss (Speichern, Anziehen, in die Lobby), Creme (FN.cmd) = Farben und Charakter,
//     Rot (FN.weapon) nur Löschen. Das gilt in beiden Skins.
//   - Ziffernblock = Körper. Spind: 8 Kopfbedeckung, 4 Handschuhe, 5 Oberteil, 6 Umhang, 2 Hose, 0 Schuhe. Erstellung: 8 Frisur, 5 Gesicht, 2 Bart
//     (die Kopfspalte von oben nach unten), daneben 9 Haarfarbe, 6 Hautton. Unbelegte Tasten zeichnen als Pult.zelle 'leer', damit der Block lesbar bleibt.
//   - Kachelzustände: normal (1-px-Rand), Cursor (doppelter Rand Messing innen, Creme außen, wie der aktive Knopf), getragen (2-px-Leiste oben + Name
//     in Messing), gesperrt (Schraffur, Bild grau, Kappe H/F, Herkunft als Text). Jeder Zustand hat eine Form, nicht nur eine Farbe.
//   - Haut- und Haarfarben kommen aus dem Katalog (content/katalog/charakter.json farben), nie aus diesen Tokens; ein Muster hat immer `musterRand`.
//   - Figur- und Porträtfenster: liegt dort die 3D-Figur (#world3d unter dem HUD), löscht das HUD das Fenster (clearRect) statt es zu füllen;
//     `figurGrund` ist dann die Hintergrundfarbe der Anprobe-Szene.
//   - Farbwerte stehen nur zwischen „// <tokens>“ und „// </tokens>“ (tools/check-terminal-farben.js prüft diese Datei mit).
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PultKammer = api;
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
  const ROM = SKIN.rom, GER = SKIN.germanen;

  // Farben nach Rolle (Skin rom). Kontrastwerte gemessen mit kontrast(), Prüfung in tools/test-kammer-tokens.js.
  const FARBE = {
    grund: ROM.screenBg,          // Anzeige
    pultGrund: ROM.bg,            // Pult unten (Farbmuster liegen darauf)
    kachel: ROM.off,              // Kachel- und Kartenkörper: Creme 14,1 · Dim 6,3 · Messing 6,2
    kachelRand: ROM.offLine,      // 1-px-Rand, nur Ordnung
    text: ROM.text,               // Teilename, Kartenzeilen
    dim: ROM.dim,                 // Volk, Herkunft, Hinweise, Körper-Zeile
    ink: ROM.ink,                 // Schrift auf voller Funktionsfläche
    platz: FN.nav,                // Messing: Platztitel, Ziffernblock, Leiste „getragen“, innerer Cursor-Rand, gewählter Name
    cursor: ROM.text,             // äußerer Cursor-Rand (Creme, wie der aktive Knopf)
    abschluss: FN.drive,          // Bernstein: Speichern, Anziehen, „Mit … in die Lobby“
    farbe: FN.cmd,                // Creme: Spalte FARBE / CHARAKTER
    loeschen: FN.weapon,          // nur „Löschen …“
    // gesperrt (Händler, Fund): Fläche, Schraffur, Kappe mit H/F, Bild grau abgedunkelt (MASS.gesperrt.bild)
    gesperrtGrund: '#0C111E',
    gesperrtSchraffur: '#1C2638',
    gesperrtKappe: '#8A93A3',     // FN.locked aufgehellt: ink darauf 6,0 (auf FN.locked selbst nur 4,0)
    gesperrtKappeText: ROM.ink,
    // dunkle Tastenkappe in der Anzeige (Kartennummer, Q/E am Figurfenster), gewählt hell
    kappe: '#2A2F3D', kappeText: ROM.text,
    kappeWahl: ROM.text, kappeWahlText: ROM.ink,
    // freier Platz der Charakterliste: schraffiert, gestrichelt, Text Dim (FN.locked als Text wäre 3,4:1)
    freiSchraffur: '#141B2B',
    // Figurfenster (Hintergrund der Anprobe-Szene bzw. des Bildes)
    figurGrund: '#000413',
    // Farbmuster: Rand immer (dunkles Haar verschwindet sonst auf dem Pult), Auswahl doppelt in Creme
    musterRand: '#5E6F8F',        // 3,5:1 auf Pult-Grund (Grafik)
    musterWahl: ROM.text,
  };
  // Skin germanen: Flächen und Neutrale wechseln, Funktionsfarben bleiben
  const FARBE_SKIN = {
    rom: {},
    germanen: {
      grund: GER.screenBg, pultGrund: GER.bg, kachel: GER.plate, kachelRand: GER.iron,   // Creme 12,3 · Dim 4,9 · Messing 6,0 auf der Platte
      text: GER.text, dim: GER.dim, ink: GER.ink, cursor: GER.text, kappeText: GER.text, kappeWahl: GER.text, kappeWahlText: GER.ink, musterWahl: GER.text,
      gesperrtGrund: '#171513', gesperrtSchraffur: '#2C2824', gesperrtKappeText: GER.ink,
      kappe: GER.offLine, freiSchraffur: '#221F1B', figurGrund: '#0A0807', musterRand: '#6E655A',
    },
  };

  // Maße in Spielpixeln (640×360). Rechtecke relativ zur Anzeige bzw. zum Pult aus Pult.rahmen.
  const MASS = {
    S: 236,                                    // Statusleiste (wie Mockup B): Anzeige 224 hoch, Pult 88 hoch
    kachel: { x: 8, y: 6, titelH: 13, w: 72, bild: 62, text: 22, fuge: 6, spalten: 5, zeilen: 2, hinweisUnten: 12 },
    cursor: { innen: 1, aussen: 3 },           // Abstand der beiden Cursor-Ränder nach außen (1 px Messing, 1 px Creme)
    getragen: 2,                               // Leiste oben auf der Kachel
    gesperrt: { kappe: { x: 3, y: 3, w: 13, h: 12, schraeg: 2 }, schraffur: 3, bild: { grau: 1, hell: 0.28, deckkraft: 0.9 } },
    textZeile: { name: 3, sub: 12 },           // y der zwei Textzeilen unter dem Bild
    figur: { x: 404, y: 6, rechts: 8, unten: 6, kappe: 13, kappeAbstand: 6, nameH: 12 },   // Figurfenster rechts in der Anzeige (Breite = Rest, 160 × 212); oben Namenszeile, unten Q/E
    figurBild: { nah: { w: 150, h: 150 }, ganz: { w: 120, h: 184 } },             // Erstellung: Nahansicht (Kopf, Schultern), Spind: ganze Figur; zwischen Namenszeile und Q/E
    liste: { y: 8, w: 132, fuge: 8, unten: 8, kappe: 13 },                         // 4 Karten, zentriert; Porträt quadratisch w − 2
    ziffernblock: { w: 82, h: 15, fuge: 3, titelH: 13 },
    spalten: { block: { x: 0, w: 252 }, mitte: { x: 268, w: 150 }, abschluss: { x: 436, w: 136 } },   // im Pult
    knopf: { h: 15, hauptH: 22, fuge: 4 },
    muster: { w: 15, h: 11, fuge: 4, label: 34, zeile: 20, wahl: 2 },           // wahl = Abstand des Creme-Rands um das gewählte Muster
  };

  // Ziffernblock = Körper. Lage der Tasten: [Spalte, Zeile, Breite in Spalten] wie der echte Ziffernblock (0 breit unter 1 und 2).
  const NUMPAD = { 7: [0, 0], 8: [1, 0], 9: [2, 0], 4: [0, 1], 5: [1, 1], 6: [2, 1], 1: [0, 2], 2: [1, 2], 3: [2, 2], 0: [0, 3, 2] };
  const ZIFFERNBLOCK = {
    spind: { 8: 'kopf', 4: 'haende', 5: 'oberteil', 6: 'umhang', 2: 'hose', 0: 'schuhe' },        // Mittelspalte Kopf → Füße, Hände und Umhang daneben
    erstellung: { 8: 'frisur', 5: 'gesicht', 2: 'bart', 9: 'haar', 6: 'haut' },                    // Kopfspalte oben → unten, Farben rechts daneben
  };
  // Plätze: Schlüssel wie im Katalog (Bericht CHA-01, Schnittstelle). Langname im Katalog hat Vorrang; kurz = Beschriftung im Ziffernblock (≤ 70 px).
  const PLATZ = {
    kopf: { name: 'Kopfbedeckung', kurz: 'Kopfbed.', gruppe: 'outfit' },
    oberteil: { name: 'Oberteil', kurz: 'Oberteil', gruppe: 'outfit' },
    hose: { name: 'Hose', kurz: 'Hose', gruppe: 'outfit' },
    schuhe: { name: 'Schuhe', kurz: 'Schuhe', gruppe: 'outfit' },
    haende: { name: 'Handschuhe', kurz: 'Handsch.', gruppe: 'outfit' },
    umhang: { name: 'Umhang', kurz: 'Umhang', gruppe: 'outfit' },
    gesicht: { name: 'Gesicht', kurz: 'Gesicht', gruppe: 'charakter' },
    frisur: { name: 'Frisur', kurz: 'Frisur', gruppe: 'charakter' },
    bart: { name: 'Bart', kurz: 'Bart', gruppe: 'charakter' },
    haar: { name: 'Haarfarbe', kurz: 'Haarfarbe', gruppe: 'farbe' },
    haut: { name: 'Hautton', kurz: 'Hautton', gruppe: 'farbe' },
  };
  // Herkunft der Outfit-Teile (Katalog teil.herkunft). In CHA-01 alles 'frei'; die Form der gesperrten Kachel steht schon.
  const HERKUNFT = {
    frei: { gesperrt: false, kappe: null, sub: '{volk}' },
    haendler: { gesperrt: true, kappe: 'H', sub: 'Händler {preis}', wort: 'Händler' },
    fund: { gesperrt: true, kappe: 'F', sub: 'Fund', wort: 'Fund' },
  };
  // Statusleiste je Bildschirm (Pult.rahmen zeichnet heute nur die Schiffsleiste: Option `status` ergänzen). Spind: null = Schiffsleiste wie an jeder Station.
  const STATUS = {
    liste: [{ l: 'GEWÄHLT', fn: 'cmd', w: 1.3 }, { l: 'PLÄTZE', fn: 'nav', w: 0.8 }, { l: 'SAMMLUNG', fn: 'nav', w: 1 }, { l: 'RAUM', fn: 'neutral', w: 0.8 }],
    erstellung: [{ l: 'NAME', fn: 'cmd', w: 1.3 }, { l: 'GESICHT', fn: 'nav', w: 1 }, { l: 'HAAR', fn: 'nav', w: 0.9 }, { l: 'HAUT', fn: 'nav', w: 0.8 }],
    spind: null,
  };
  const TEXT = {
    saeule: { liste: 'CHARAKTER', erstellung: 'CHARAKTER', spind: 'SPIND' },
    spalte: { platz: 'PLATZ · ZIFFERNBLOCK = KÖRPER', kopf: 'KOPF · ZIFFERNBLOCK', farbe: 'FARBE', herkunft: 'HERKUNFT', charakter: 'CHARAKTER', waehlen: 'WÄHLEN', weiter: 'WEITER', umziehen: 'UMZIEHEN' },
    kachelTitel: { spind: '{platz} · {n} frei', erstellung: '{platz} · {n} zur Wahl' },
    hinweis: { spind: '←→↑↓ Teil · Enter anziehen', erstellung: '←→↑↓ wählen · die Figur zeigt es sofort' },
    drehen: 'drehen', frei: 'FREI', freiHinweis: 'N legt hier an', anprobe: 'Anprobe', neu: 'neu',
    knopf: { neu: 'Neu anlegen', umbenennen: 'Umbenennen', loeschen: 'Löschen …', platz: 'Platz', blaettern: 'blättern', lobby: 'In die Lobby',
      name: 'Name ändern', zuruecksetzen: 'Zurücksetzen', speichern: 'Speichern', anziehen: 'Anziehen', ablegen: 'Ablegen' },
    nameIstSpieler: 'Name = Spielername', muster: { haar: 'Haar', haut: 'Haut' }, musterHinweis: '9 / 6 öffnen die Muster groß',
    herkunftLegende: { frei: 'frei · alles in CHA-01', haendler: 'beim Händler', fund: 'als Fund' },
    keine: 'keine', keiner: 'keiner',
  };
  // </tokens>

  const TOKENS = { FARBE, FARBE_SKIN, MASS, ZIFFERNBLOCK, NUMPAD, PLATZ, HERKUNFT, STATUS, TEXT, FN };

  // ================================================================= Hilfen (rein)
  function farben(skinId) { return Object.assign({}, FARBE, FARBE_SKIN[skinId] || {}); }
  // Rechtecke wie Pult.rahmen (pult.js): Anzeige oben, Pult unter der Statusleiste
  function rahmen(S) {
    S = S || MASS.S;
    return { S, anzeige: { x: 62, y: 6, w: 572, h: S - 12 }, pult: { x: 62, y: S + 22, w: 572, h: 346 - (S + 22) } };
  }
  // Ziffernblock: Tasten mit Platz und Rechteck im Pult (Spalte block, unter dem Titel). Unbelegte Tasten 1–9 mit leer: true (als 'leer' zeichnen),
  // die 0 nur, wenn belegt.
  function ziffernblock(art, pult) {
    const m = MASS.ziffernblock, sp = MASS.spalten.block, b = pult || rahmen().pult, belegt = ZIFFERNBLOCK[art] || {};
    const x0 = b.x + sp.x, y0 = b.y + m.titelH;
    return Object.keys(NUMPAD).filter((t) => t !== '0' || belegt[t]).map((t) => {
      const [s, z, br] = NUMPAD[t], w = (br || 1) * m.w + ((br || 1) - 1) * m.fuge;
      return { taste: t, platz: belegt[t] || null, leer: !belegt[t], rect: { x: x0 + s * (m.w + m.fuge), y: y0 + z * (m.h + m.fuge), w, h: m.h } };
    });
  }
  // Teile-Kacheln in der Anzeige: n Stück, zeilenweise; jede { x, y, w, h, bild: { x, y, w, h } }
  function kacheln(a, n) {
    const k = MASS.kachel, out = [], h = k.bild + k.text;
    for (let i = 0; i < Math.min(n, k.spalten * k.zeilen); i++) {
      const x = a.x + k.x + (i % k.spalten) * (k.w + k.fuge), y = a.y + k.y + k.titelH + 2 + Math.floor(i / k.spalten) * (h + k.fuge);
      out.push({ x, y, w: k.w, h, bild: { x: x + 1, y: y + 1, w: k.w - 2, h: k.bild } });
    }
    return out;
  }
  // Charakterkarten der Liste: 4 Stück, zentriert; bild = Porträtfenster (quadratisch)
  function karten(a) {
    const l = MASS.liste, gesamt = 4 * l.w + 3 * l.fuge, x0 = a.x + Math.floor((a.w - gesamt) / 2), h = a.h - l.y - l.unten;
    return [0, 1, 2, 3].map((i) => { const x = x0 + i * (l.w + l.fuge), y = a.y + l.y; return { x, y, w: l.w, h, bild: { x: x + 1, y: y + 1, w: l.w - 2, h: l.w - 2 } }; });
  }
  function figur(a) { const f = MASS.figur; return { x: a.x + f.x, y: a.y + f.y, w: a.w - f.x - f.rechts, h: a.h - f.y - f.unten }; }
  function muster(x, y, n) { const m = MASS.muster, out = []; for (let i = 0; i < n; i++) out.push({ x: x + m.label + i * (m.w + m.fuge), y, w: m.w, h: m.h }); return out; }
  function herkunft(teil) {
    const h = HERKUNFT[(teil && teil.herkunft) || 'frei'] || HERKUNFT.frei;
    return { gesperrt: h.gesperrt, kappe: h.kappe, sub: text(h.sub, { volk: (teil && teil.volk) || '–', preis: teil && teil.preis != null ? teil.preis : '' }).trim() };
  }
  function text(vorlage, werte) { return String(vorlage).replace(/\{(\w+)\}/g, (_, k) => (werte && werte[k] != null ? werte[k] : '')); }
  function lum(h) { const n = parseInt(String(h).slice(1, 7), 16); return [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0); }
  function kontrast(a, b) { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); }

  return { TOKENS, farben, rahmen, ziffernblock, kacheln, karten, figur, muster, herkunft, text, kontrast };
});
