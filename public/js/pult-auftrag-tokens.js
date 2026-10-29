// SUND-04b D (Designer, Modus System): Tokens des Auftragsbretts im Hafenterminal (Freie Fahrt Sund) und des schmalen Abenteuer-Status im Flug-HUD.
// Globales `PultAuftrag` (in Node als Modul, für tools/test-auftrag-tokens.js). Nur Daten und kleine reine Hilfen: kein Zustand, kein Netz, keine Regeln.
// Was angeboten wird, was es bewirkt und ob Annehmen geht, entscheidet der Server; die Anzeige fragt hier nur „wie sieht das aus“ und „wo liegt es“.
// Gestaltungsnotiz: vault Pantheon/„Auftrag SUND-04b – Tokens“. Referenzzeichnung aller Zustände im echten Pult-Rahmen: public/auftrag-preview.html
// (Zeichnung in public/auftrag-referenz.js, kein Spielcode), Bilder mit node tools/sicht-auftrag.js.
//
// Nichts Neues, wo es schon etwas gibt: Grund, Kachel, Messing (Angebot), Mint (läuft), Gelb (gesperrt/bald), zerText (Gefahr als Text) kommen aus
// pult.js, pult-terminal-tokens.js und pult-systeme-tokens.js; Fraktionsbuchstabe und Haltungsfarbe der Plakette aus karte-tokens.js (wie auf der Lagekarte);
// das Gerücht ist gestrichelt wie im Bereich Information (zeichneInfo); die Gefahr-Bake ist die Warnbake der Front (KarteTokens FARBE.front).
//
//   PultAuftrag.TOKENS            { FARBE, FRAKTION, MASS, TEXT, TYP, FN }
//   PultAuftrag.layout(laeuft)    -> Rechtecke des Bretts im Schirm 640×360: { titel, liste[3], detail{…}, laeuft|null, info, knopf{brett, modulTitelW} }
//   PultAuftrag.fraktion(id)      -> { id, buchstabe, name, feld, text }   (id 'rom'|'ger'|'kon' oder Kürzel r/g/k; unbekannt -> neutral)
//   PultAuftrag.folge(e)          -> { marke: { f, d, art, wort } | null, text }   (Objekt { f, art, d, text } oder Zeichenkette „Ruf Rom +1“)
//   PultAuftrag.typText(typen)    -> 'Gerücht · Konvoi'
//   PultAuftrag.verfall(rest)     -> { kurz: 'noch 7', lang: 'verfällt nach 7 Tätigkeiten', bald: bool }
//   PultAuftrag.beats(schritt, gesamt) -> ['fertig', 'jetzt', 'offen', …]   (schritt 1-basiert)
//   PultAuftrag.schritt(s)        -> { text, gefahr }   (Zeichenkette oder { text, gefahr })
//   PultAuftrag.text(vorlage, werte), PultAuftrag.kontrast(a, b)
//
// Regeln (kurz, ausführlich in der Notiz):
//   - Messing heißt „Angebot“ (Balken links, Auswahlfläche, Bereichstitel), Mint heißt „läuft“ (wie die laufende Absicht), Gelb „gesperrt / verfällt bald“.
//   - Gefahr NIE nur als Farbe: immer Bake (Streifen hell/rot) + Wort GEFAHR bzw. im Schritt die kleine Bake. Roter Text nur in `gefahrText` (zerText).
//   - Folgen für Ruf/Haltung als Marke: Plakette (Buchstabe der Fraktion in ihrer Haltungsfarbe, wie auf der Karte) + Pfeil ▲/▼ (doppelt bei ±2) + Wort.
//     Richtung trägt der Pfeil, nicht die Farbe.
//   - Ablehnen kostet nichts: Kontur-Knopf (leise, kein Rot), darunter „Ablehnen kostet nichts“ in Mint wie „Umbauen ist frei“ in der Werft.
//   - Scheitern ist kein Strafbild: Überschrift in dim, Folgen in derselben Schrift wie beim Gelingen.
//   - Keine Spielernamen im Brett. Mehrspieler: „Crew hat angenommen“ in der Infozeile, Absage (zweite Antwort) in Gelb wie im Bereich Kurs.
//   - Farbwerte stehen nur zwischen „// <tokens>“ und „// </tokens>“ (tools/check-terminal-farben.js prüft diese Datei mit).
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PultAuftrag = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const P = root && root.Pult;
  const KT = root && root.KarteTokens;

  // ================================================================= TOKENS
  // <tokens>
  // Funktionsfarben und Skin rom (pult.js). Im Browser die echten Objekte; in Node der Spiegel (tools/test-auftrag-tokens.js prüft, dass er gleich ist).
  const FN = (P && P.FN) || { drive: '#FFC66B', shield: '#7FE0C2', weapon: '#E0473C', sensor: '#A9D6E5', nav: '#C9974A', cmd: '#F4EEDC', warn: '#F2C94C', neutral: '#8EA3B5', locked: '#6B7380' };
  const ROM = (P && P.SKINS && P.SKINS.rom) || { bg: '#0B0E1A', screenBg: '#070A14', text: '#F4EEDC', dim: '#8EA3B5', off: '#18202F', offLine: '#3A4A66', ink: '#0B0E1A' };
  // Karten-Grundfarben (karte-tokens.js PULT), Spiegel wie oben
  const PU = (KT && KT.FARBE && KT.FARBE.pult) || { tisch: '#0B0E1A', hell: '#F4EEDC', grau: '#9AA6B8', eis: '#A9D6E5', messing: '#C9974A', gold: '#FFC66B', rot: '#E0473C', warn: '#F2C94C', mint: '#7FE0C2', notruf: '#FF6B5E', stahlhell: '#8EA3B5' };
  const KF = (KT && KT.FARBE && KT.FARBE.fraktion) || {
    r: { id: 'rom', buchstabe: 'R', name: 'Rom', haltung: PU.mint },
    g: { id: 'ger', buchstabe: 'G', name: 'Germanen', haltung: PU.notruf },
    k: { id: 'saum', buchstabe: 'K', name: 'Konkordat', haltung: PU.eis },
    p: { id: 'pirat', buchstabe: 'P', name: 'Piraten', haltung: '#C2703D' },
    '-': { id: 'frei', buchstabe: '-', name: 'herrenlos', haltung: PU.grau },
  };

  // Farben nach Rolle (Skin rom: das Hafenterminal ist das der Lerche). Kontrast gemessen in tools/test-auftrag-tokens.js.
  const FARBE = {
    grund: ROM.screenBg,          // Schirm #070A14 (Detailspalte, Infozeile liegen direkt darauf)
    text: ROM.text,               // Titel, Folgen, Schritte
    dim: ROM.dim,                 // Anlass, Typ und Ort, Überschriften SCHRITTE / GELINGT / SCHEITERT
    ink: ROM.ink,                 // Schrift auf voller Messingfläche (gewählte Karte)
    kachel: '#1A2238',            // Angebotskarte, Laufend-Streifen (= PultTerminal FARBE.kachel)
    kachelZu: '#10151F',          // leerer Zustand (= PultTerminal FARBE.kachelZu)
    trenner: '#1C2638',           // Linie über der Infozeile und unter Ort/Verfall (= PultTerminal FARBE.trenner)
    leerBalken: '#5A667C',        // Balken links im leeren Zustand (= PultTerminal FARBE.platzZu)
    // Bedeutung
    angebot: FN.nav,              // Messing: Balken links an der Karte, volle Fläche = gewählt, Bereichstitel, Gerücht-Balken
    laeuft: FN.shield,            // Mint: LÄUFT, erledigte Beats, „Ablehnen kostet nichts“, ANGENOMMEN
    beatOffen: ROM.dim,           // Rand eines offenen Beats, hohl (Grafik 6,1:1 auf Kachel; platzZu wäre nur 2,7:1). Fertig = volle Mint-Fläche, jetzt = Mint + Rahmen in text
    bald: FN.warn,                // Gelb: verfällt bald / Frist läuft ab, „Ein Abenteuer läuft schon“, Absage
    gefahrRot: FN.weapon,         // Bake: rote Streifen (Grafik)
    gefahrHell: PU.hell,          // Bake: helle Streifen (wie die Front-Bake der Karte)
    gefahrText: '#FF6B5E',        // GEFAHR als Text (= PultSysteme zerText, = Notruf-Marke): 5,9:1 Kachel · 7,1:1 Grund
    tagRand: ROM.offLine,         // 1-px-Rand der Typ-Marke (Ordnung, keine Information)
    kappe: ROM.offLine,           // Fläche der Nummernkappe 1–3 (Text darauf in `text`)
    plaketteText: PU.tisch,       // Buchstabe in der Plakette (wie auf der Karte: dunkel auf Haltungsfarbe)
    // Flug-HUD (render.js PAL, Stil von Hud.drawObjectives)
    hudTitel: PU.gold,            // Titel des Abenteuers wie der Missionstitel (PAL.amber)
    hudText: PU.hell,             // aktueller Schritt (PAL.star)
    hudDim: PU.stahlhell,         // Frist (PAL.panelLight)
  };
  // Fraktionen der Anlässe (Plakette): Buchstabe, Name und Haltungsfarbe kommen aus KarteTokens (eine Quelle mit der Lagekarte)
  const FRAKTION = { rom: 'r', r: 'r', ger: 'g', g: 'g', kon: 'k', saum: 'k', k: 'k', pirat: 'p', p: 'p' };

  // Maße im Schirm 640×360 (Anzeige 62..634 × 6..232). Raster 2/4/8/12/16 wie PultTerminal.ABSTAND.
  const MASS = {
    bereich: { x: 70, y: 42, w: 558, h: 152 },   // = PultTerminal.layout().handel (Handel, Kurs, Information nutzen dasselbe Rechteck)
    info: { x: 70, y: 198, w: 558, h: 30 },      // = PultTerminal.layout().handelInfo: Infozeile, 3 Zeilen im Raster 10
    titelY: 29,                                  // Bereichstitel AUFTRAGSBRETT und Hilfe-Zeile (wie Handel: r.y − 13)
    liste: { w: 214, luft: 4, karteH: 46, karteHKompakt: 36, balken: 2, innen: 6 },
    spalte: 10,                                  // Abstand Liste → Detail
    laeuft: { h: 30, luft: 4, balken: 3, beatW: 22, beatH: 6, beatLuft: 2, beatsMaxW: 200 },
    // Detail: Titel + Auftraggeber · Anlass · Typ-Marken + Ort + Verfall · Trenner · GEFAHR · Schritte (links) | Gelingt / Scheitert (rechts)
    // Läuft ein Abenteuer, ist Annehmen gesperrt: Anlass und Folgen kürzen auf eine Zeile (voller Text als Tooltip).
    detail: { schritteW: 178, folgenX: 186, schritteMax: 4, folgeZeilen: 3, folgeZeilenKompakt: 2, anlassZeilen: 2, anlassZeilenKompakt: 1, schritteZeichen: 28 },
    zeile: 9, zeileLuft: 10,
    kappe: { w: 11, h: 9 },                      // Nummernkappe 1–3 (Taste)
    plakette: 9,                                 // Fraktionsbuchstabe 9×9 (wie die Kartenplakette, kleiner)
    marke: { h: 9, luft: 4 },                    // Plakette + Pfeil(e) + Wort
    tag: { h: 11, innen: 3, luft: 3 },           // Typ-Marke: 1-px-Rand, Versalien
    bake: { w: 13, h: 9, schritt: 3 },           // Gefahr-Bake (Streifen 45°, 3 px)
    bakeKlein: { w: 7, h: 7, schritt: 3 },       // Bake vor einem gefährlichen Schritt
    geruecht: { strich: 2, luecke: 2, balken: 2 },   // gestrichelter Balken links (wie zeichneInfo „Gerücht · unbestätigt“)
    // Pult unten: Knopf „Brett“ links neben Info/Kurs/Handel/Werft (die Zeile 424..628 ist voll). Die Linie des Titels MODULRAUM wird dafür kürzer.
    knopf: { brett: { x: 374, w: 48 }, modulTitelW: 104 },
    // Flug-HUD: Streifen unter dem Ziele-Kasten (Hud.drawObjectives, x 4, Breite 192, Hintergrund wie dort)
    hud: { x: 4, w: 192, h: 23, alpha: 0.62, balken: 2, beatW: 6, beatH: 5, beatLuft: 1, innen: 6 },
  };
  // </tokens>

  // Texte (Vorlagen mit {name}); der Server liefert die Inhalte, hier stehen nur die festen Beschriftungen des Bretts
  const TEXT = {
    bereich: 'Auftragsbrett', knopf: 'Brett',
    hilfe: '{wahl} wählen · {an} annehmen · {ab} ablehnen',
    gelingt: 'Gelingt', scheitert: 'Scheitert', schritte: 'Schritte', gefahr: 'Gefahr', keineGefahr: 'kein Kampf angekündigt',
    ort: 'Ort', von: 'Auftrag von',
    laeuft: 'Läuft', schritt: 'Schritt {i} von {n}', frist: 'Frist noch {n}', fristBald: 'Frist läuft ab',
    verfallLang: 'verfällt nach {n} Tätigkeiten', verfallEins: 'verfällt nach der nächsten Tätigkeit', verfallKurz: 'noch {n}', verfallBald: 'verfällt bald',
    annehmen: 'Annehmen', ablehnen: 'Ablehnen', kostetNichts: 'Ablehnen kostet nichts',
    gesperrt: 'Ein Abenteuer läuft schon', gesperrtGrund: 'Erst „{titel}“ abschließen',
    angenommen: 'Angenommen', angenommenText: 'Die Crew hat „{titel}“ angenommen.',
    geruecht: 'Gerücht', mehrSchritte: '+{n} weitere',
    leerTitel: 'Kein Angebot', leerText: 'Gerade liegt am Brett nichts aus. Nach der nächsten Tätigkeit oder dem nächsten Abenteuer gibt es wieder Angebote.',
    hudAbenteuer: 'Abenteuer', hudFrist: 'Frist {n}',
  };
  // Typ-Marken (Beat-Typen aus content/faeden/beats.json)
  const TYP = { konvoi: 'Konvoi', sabotage: 'Sabotage', geruecht: 'Gerücht', spur: 'Spur', geleit: 'Geleit', wiedersehen: 'Wiedersehen', bitte: 'Bitte', notruf: 'Notruf' };
  const TOKENS = { FARBE, FRAKTION, MASS, TEXT, TYP, FN };

  // ================================================================= Hilfen (rein)
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  function text(vorlage, werte) { return String(TEXT[vorlage] != null ? TEXT[vorlage] : vorlage).replace(/\{(\w+)\}/g, (m, k) => (werte && werte[k] != null ? String(werte[k]) : m)); }

  // Rechtecke. laeuft = true: oben der Laufend-Streifen über die volle Breite, Karten kompakt (36 statt 46)
  function layout(laeuft) {
    const B = MASS.bereich, Li = MASS.liste, La = MASS.laeuft;
    const y0 = laeuft ? B.y + La.h + La.luft : B.y, h0 = B.y + B.h - y0;
    const kh = laeuft ? Li.karteHKompakt : Li.karteH;
    const liste = [0, 1, 2].map((i) => ({ x: B.x, y: y0 + i * (kh + Li.luft), w: Li.w, h: kh }));
    const dx = B.x + Li.w + MASS.spalte, dw = B.x + B.w - dx, z = MASS.zeile, D = MASS.detail;
    const anl = laeuft ? D.anlassZeilenKompakt : D.anlassZeilen, fz = laeuft ? D.folgeZeilenKompakt : D.folgeZeilen;
    // Detail von oben nach unten: Titel + Auftraggeber, Anlass, Typ-Marken + Ort + Verfall, Trenner, GEFAHR (vor den Schritten: Gefahr wird angekündigt),
    // Schritte | Gelingt/Scheitert. Endet in beiden Fällen über der Infozeile (Test).
    let y = y0;
    const titel = { x: dx, y, w: dw, h: z }; y += z + 4;
    const anlass = { x: dx, y, w: dw, h: anl * z }; y += anl * z + 3;
    const ort = { x: dx, y, w: dw, h: MASS.tag.h }; y += MASS.tag.h + 3;
    const trenner = { x: dx, y, w: dw, h: 1 }; y += 4;
    const gefahr = { x: dx, y, w: dw, h: MASS.bake.h }; y += MASS.bake.h + 5;
    const fx = dx + D.folgenX, fw = dw - D.folgenX;
    const folgeH = z + 2 + fz * z;
    const schritte = { x: dx, y, w: D.schritteW, h: z + 2 + D.schritteMax * z };
    const gelingt = { x: fx, y, w: fw, h: folgeH, zeilen: fz };
    const scheitert = { x: fx, y: y + folgeH + 3, w: fw, h: folgeH, zeilen: fz };
    const detail = { x: dx, y: y0, w: dw, h: h0, unten: Math.max(schritte.y + schritte.h, scheitert.y + scheitert.h), titel, anlass, ort, trenner, gefahr, schritte, gelingt, scheitert };
    return {
      bereich: B, titel: { x: B.x, y: MASS.titelY, w: B.w, h: z }, liste, karteH: kh, detail,
      laeuft: laeuft ? { x: B.x, y: B.y, w: B.w, h: La.h } : null,
      info: MASS.info, knopf: MASS.knopf,
    };
  }

  function fraktion(id) {
    const k = FRAKTION[id] || (KF[id] ? id : '-');
    const f = KF[k] || KF['-'];
    return { id: f.id, buchstabe: f.buchstabe, name: f.name, feld: f.haltung, text: FARBE.plaketteText };
  }
  const NAMEN = { rom: 'rom', ger: 'ger', germanen: 'ger', konkordat: 'kon', kon: 'kon', piraten: 'pirat' };
  // Folge -> Marke oder Text. Objekt { f: 'rom', art: 'ruf'|'haltung', d: +1, text } oder Zeichenkette „Ruf Rom +1“ / „Haltung Germanen −1“; alles andere bleibt Text.
  function folge(e) {
    if (e && typeof e === 'object') {
      const d = isNum(e.d) ? Math.max(-2, Math.min(2, Math.round(e.d))) : 0;
      const f = !e.f ? null : FRAKTION[e.f] ? e.f : NAMEN[String(e.f).toLowerCase()] || null;
      return { marke: f && d ? { f, d, art: e.art === 'haltung' ? 'haltung' : 'ruf', wort: e.art === 'haltung' ? 'Haltung' : 'Ruf' } : null, text: typeof e.text === 'string' ? e.text : '' };
    }
    const s = String(e == null ? '' : e).trim();
    const m = /^(Ruf|Haltung)\s+(\w+)\s*([+\-−])\s*(\d)?$/i.exec(s);
    if (m) {
      const f = NAMEN[m[2].toLowerCase()];
      if (f) { const n = Math.min(2, +(m[4] || 1)), d = (m[3] === '+' ? 1 : -1) * n; return { marke: { f, d, art: /^h/i.test(m[1]) ? 'haltung' : 'ruf', wort: /^h/i.test(m[1]) ? 'Haltung' : 'Ruf' }, text: '' }; }
    }
    return { marke: null, text: s };
  }
  const pfeile = (d) => (d > 0 ? '▲' : '▼').repeat(Math.min(2, Math.abs(d)));
  function typText(typen) { return (Array.isArray(typen) ? typen : []).map((t) => TYP[t] || (String(t).charAt(0).toUpperCase() + String(t).slice(1))).filter(Boolean).join(' · '); }
  // Verfall in Tätigkeiten: bald = höchstens 2 (Gelb und „!“, Wort „verfällt bald“)
  function verfall(rest) {
    const n = isNum(rest) ? Math.max(0, Math.floor(rest)) : 0, bald = n <= 2;
    return { n, bald, kurz: bald ? '! ' + text('verfallKurz', { n }) : text('verfallKurz', { n }), lang: n <= 1 ? text('verfallEins') : text('verfallLang', { n }) };
  }
  function beats(schritt, gesamt) {
    const n = Math.max(1, Math.min(12, isNum(gesamt) ? Math.floor(gesamt) : 1)), i = Math.max(1, Math.min(n, isNum(schritt) ? Math.floor(schritt) : 1));
    const out = []; for (let k = 1; k <= n; k++) out.push(k < i ? 'fertig' : k === i ? 'jetzt' : 'offen'); return out;
  }
  function schritt(s) { return s && typeof s === 'object' ? { text: String(s.text || ''), gefahr: !!s.gefahr } : { text: String(s == null ? '' : s), gefahr: false }; }

  function lum(h) { const n = parseInt(String(h).slice(1, 7), 16); return [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0); }
  function kontrast(a, b) { const A = lum(FARBE[a] || a), B = lum(FARBE[b] || b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); }

  return { TOKENS, layout, fraktion, folge, pfeile, typText, verfall, beats, schritt, text, kontrast };
});
