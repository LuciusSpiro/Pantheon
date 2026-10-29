// SUND-04b D (Designer): Referenzzeichnung des Auftragsbretts und des Abenteuer-Status im Flug-HUD. KEIN Spielcode: nur für public/auftrag-preview.html
// und die Mockups im Vault. Die Entwicklung darf sie als Vorlage nehmen (Geometrie, Reihenfolge, Farben nur über PultAuftrag.TOKENS), baut aber das
// Terminal selbst (terminal-ui.js, pult-terminal-tokens.js). Globales `AuftragReferenz`. Hängt an: Render, Pult, PultTerminal, KarteTokens, PultAuftrag.
//
// Modell m (Entwurf aus Paket C + Felder, die die Anzeige zusätzlich braucht, siehe Notiz „Auftrag SUND-04b – Tokens“):
//   { angebote: [{ id, titel, anlass, ort, von ('rom'|'ger'|'kon'), typen: [..], aus_geruecht: bool,
//                  vorschau: { schritte: [text | { text, gefahr }], gelingt: [Folge], scheitert: [Folge], gefahr: text | null }, rest }],
//     gewaehlt: id, laufend: { id, titel, schritt, schritte_gesamt, schritt_text, gefahr, rest } | null,
//     geruechte: [{ von, text, angebot (Id des Angebots, auf das es verweist) }], info: { angenommen: titel } | { grund: text } | null, amGeraet, zusehen }
(function () {
  'use strict';
  const T = window.PultTerminal, P = window.Pult, A = window.PultAuftrag, R = window.Render;
  const FA = A.TOKENS.FARBE, M = A.TOKENS.MASS;
  const txt = (c, s, x, y, col, o) => T.txt(c, s, x, y, col, o);
  const tw = (s, sc, sp) => T.tw(s, sc, sp);
  const titelO = { versal: true, sperr: 1 };
  const rect = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  const rand = (c, x, y, w, h, col) => { rect(c, x, y, w, 1, col); rect(c, x, y + h - 1, w, 1, col); rect(c, x, y, 1, h, col); rect(c, x + w - 1, y, 1, h, col); };
  function kuerzen(s, w, o) {
    s = String(s || ''); const m = (t) => (o && o.versal ? tw(t.toUpperCase(), 1, o.sperr || 0) : tw(t));
    if (m(s) <= w) return s;
    while (s.length > 1 && m(s + '…') > w) s = s.slice(0, -1).replace(/\s+$/, '');
    return s + '…';
  }

  // ---------------------------------------------------------------- Zeichen
  // Bake: Streifen 45° hell/rot (wie die Front-Bake der Lagekarte), 1 px Rahmen in Rot
  function bake(c, x, y, w, h, schritt) {
    schritt = schritt || M.bake.schritt;
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    rect(c, x, y, w, h, FA.gefahrHell);
    c.fillStyle = FA.gefahrRot; for (let d = -h; d < w + h; d += schritt * 2) for (let r = 0; r < h; r++) c.fillRect(x + d + r, y + r, schritt, 1);
    c.restore(); rand(c, x, y, w, h, FA.gefahrRot);
  }
  // Plakette: Buchstabe der Fraktion auf ihrer Haltungsfarbe (Karte). Auf voller Messingfläche mit 1 px ink-Rahmen.
  function plakette(c, x, y, fid, aufFlaeche) {
    const f = A.fraktion(fid), s = M.plakette;
    rect(c, x, y, s, s, f.feld); if (aufFlaeche) rand(c, x - 1, y - 1, s + 2, s + 2, FA.ink);
    txt(c, f.buchstabe, x + Math.floor(s / 2) + 1, y + 1, f.text, { align: 'center' });
    return x + s;
  }
  // Marke: Plakette + Pfeil(e) [+ Wort]; Farbe der Schrift = text (bzw. ink auf Messing)
  function marke(c, x, y, mk, o) {
    o = o || {};
    let e = plakette(c, x, y, mk.f, o.flaeche) + 2;
    e = txt(c, A.pfeile(mk.d), e, y + 1, o.flaeche ? FA.ink : FA.text);
    if (o.wort) e = txt(c, mk.wort, e + 3, y + 1, o.flaeche ? FA.ink : FA.text);
    return e;
  }
  function tag(c, x, y, s) {
    const t = M.tag, w = tw(s.toUpperCase(), 1, 1) + 2 * t.innen + 1;
    rand(c, x, y, w, t.h, FA.tagRand); txt(c, s, x + t.innen + 1, y + 2, FA.dim, titelO);
    return x + w;
  }
  function kappeZ(c, x, y, s, aufFlaeche) {
    const k = M.kappe, w = Math.max(k.w, tw(s) + 5);
    rect(c, x, y, w, k.h, aufFlaeche ? P.mix(FA.ink, FA.angebot, 0.3) : FA.kappe);
    txt(c, s, x + Math.round(w / 2), y + 1, FA.text, { align: 'center' });
    return x + w;
  }
  function geruechtBalken(c, x, y, h, col) { const g = M.geruecht; for (let i = 0; i < h; i += g.strich + g.luecke) rect(c, x, y + i, g.balken, Math.min(g.strich, h - i), col); }

  // ---------------------------------------------------------------- Karte (links)
  function karte(c, r, a, nr, gew, kompakt) {
    const L = M.liste, i = L.innen;
    if (gew) P.cham(c, r.x, r.y, r.w, r.h, FA.angebot, 0, 0, 4, 0);
    else { P.cham(c, r.x, r.y, r.w, r.h, FA.kachel, 0, 0, 4, 0); if (a.aus_geruecht) geruechtBalken(c, r.x, r.y, r.h, FA.angebot); else rect(c, r.x, r.y, L.balken, r.h, FA.angebot); }
    const ink = gew ? FA.ink : FA.text, sub = gew ? FA.ink : FA.dim;
    const y1 = r.y + (kompakt ? 4 : 5), y2 = r.y + (kompakt ? 15 : 18), y3 = r.y + (kompakt ? 26 : 31);
    const kx = kappeZ(c, r.x + i, y1 - 1, String(nr), gew);
    plakette(c, r.x + r.w - i - M.plakette, y1 - 1, a.von, gew);
    txt(c, kuerzen(a.titel, r.x + r.w - i - M.plakette - 6 - (kx + 5)), kx + 5, y1, ink);
    const v = A.verfall(a.rest);
    const vx = txt(c, v.kurz, r.x + r.w - i, y2, gew ? FA.ink : v.bald ? FA.bald : FA.dim, { align: 'right' });
    txt(c, kuerzen(A.typText(a.typen) + ' · ' + (a.ort || ''), r.w - 2 * i - tw(v.kurz) - 8), r.x + i, y2, sub);
    // Zeile 3: Marken beim Gelingen, dann (rechts) die Gefahr-Bake mit Wort
    let x = r.x + i;
    ((a.vorschau && a.vorschau.gelingt) || []).map(A.folge).filter((f) => f.marke).slice(0, 3).forEach((f) => { x = marke(c, x, y3, f.marke, { flaeche: gew }) + M.marke.luft + 2; });
    const gef = a.vorschau && a.vorschau.gefahr;
    if (gef) { const gx = r.x + r.w - i - tw('GEFAHR', 1, 1); txt(c, 'Gefahr', gx, y3 + 1, gew ? FA.ink : FA.gefahrText, titelO); bake(c, gx - M.bake.w - 4, y3, M.bake.w, M.bake.h); }
    return vx;
  }

  // ---------------------------------------------------------------- Detail (rechts)
  function folgenBlock(c, r, kopf, liste) {
    const fs = (liste || []).map(A.folge), mk = fs.filter((f) => f.marke), tx = fs.filter((f) => f.text);
    txt(c, kopf, r.x, r.y, FA.dim, titelO);
    // Marken rechtsbündig in der Kopfzeile: Plakette + Pfeil, überall gleich (Rom = Ruf, alle anderen = Haltung; das Wort steht im Tooltip)
    const breite = (m) => M.plakette + 2 + tw(A.pfeile(m.d));
    let x = r.x + r.w;
    for (let i = mk.length - 1; i >= 0; i--) { const m = mk[i].marke; x -= breite(m); marke(c, x, r.y - 1, m); x -= M.marke.luft + 2; }
    const zeilen = []; tx.forEach((f) => T.umbruch(f.text, r.w, 3).forEach((z) => zeilen.push(z)));
    const n = r.zeilen;
    zeilen.slice(0, n).forEach((z, i) => txt(c, i === n - 1 && zeilen.length > n ? kuerzen(z + ' …', r.w) : z, r.x, r.y + 11 + i * M.zeile, FA.text));
  }
  function detail(c, D, a, kompakt) {
    // Titel links, Auftraggeber rechts (Plakette + Name)
    const f = A.fraktion(a.von), nx = D.titel.x + D.titel.w;
    const e = nx - tw(f.name); txt(c, f.name, e, D.titel.y, FA.text);
    plakette(c, e - M.plakette - 4, D.titel.y - 1, a.von);
    const vx = txt(c, A.text('von'), e - M.plakette - 8, D.titel.y, FA.dim, { align: 'right' }) - tw(A.text('von'));
    txt(c, kuerzen(a.titel, vx - 10 - D.titel.x, titelO), D.titel.x, D.titel.y, FA.text, titelO);
    const anl = T.umbruch(a.anlass || '', D.anlass.w, Math.round(D.anlass.h / M.zeile));
    anl.forEach((z, i) => txt(c, z, D.anlass.x, D.anlass.y + i * M.zeile, FA.dim));
    // Typ-Marken, Ort, rechts Verfall
    let x = D.ort.x; (a.typen || []).forEach((t) => { x = tag(c, x, D.ort.y, A.typText([t])) + M.tag.luft; });
    txt(c, a.ort || '', x + 4, D.ort.y + 2, FA.text);
    const v = A.verfall(a.rest); txt(c, v.bald ? '! ' + v.lang : v.lang, D.ort.x + D.ort.w, D.ort.y + 2, v.bald ? FA.bald : FA.dim, { align: 'right' });
    rect(c, D.trenner.x, D.trenner.y, D.trenner.w, 1, FA.trenner);
    // Schritte
    const S = D.schritte, st = ((a.vorschau && a.vorschau.schritte) || []).map(A.schritt), max = M.detail.schritteMax;
    txt(c, A.text('schritte'), S.x, S.y, FA.dim, titelO);
    st.slice(0, st.length > max ? max - 1 : max).forEach((s, i) => {
      const y = S.y + 11 + i * M.zeile; txt(c, String(i + 1), S.x, y, FA.dim);
      let tx = S.x + 9; if (s.gefahr) { bake(c, tx, y, M.bakeKlein.w, M.bakeKlein.h, 2); tx += M.bakeKlein.w + 3; }
      txt(c, kuerzen(s.text, S.x + S.w - tx), tx, y, FA.text);
    });
    if (st.length > max) txt(c, A.text('mehrSchritte', { n: st.length - max + 1 }), S.x + 9, S.y + 11 + (max - 1) * M.zeile, FA.dim);
    folgenBlock(c, D.gelingt, A.text('gelingt'), a.vorschau && a.vorschau.gelingt);
    folgenBlock(c, D.scheitert, A.text('scheitert'), a.vorschau && a.vorschau.scheitert);
    // Gefahr: Bake + Wort + Text; ohne Gefahr ausdrücklich „kein Kampf angekündigt“ (Fairness: Gefahr wird angekündigt)
    const G = D.gefahr, gef = a.vorschau && a.vorschau.gefahr;
    if (gef) { bake(c, G.x, G.y, M.bake.w, M.bake.h); const gx = txt(c, A.text('gefahr'), G.x + M.bake.w + 5, G.y + 1, FA.gefahrText, titelO); txt(c, kuerzen(gef, G.x + G.w - gx - 8), gx + 8, G.y + 1, FA.text); }
    else txt(c, A.text('keineGefahr'), G.x, G.y + 1, FA.dim);
  }

  // ---------------------------------------------------------------- Laufend (Streifen oben), leer, Infozeile
  function laeuftStreifen(c, r, l) {
    const La = M.laeuft;
    P.cham(c, r.x, r.y, r.w, r.h, FA.kachel, 0, 0, 4, 0); rect(c, r.x, r.y, La.balken, r.h, FA.laeuft);
    const x0 = r.x + 10, y1 = r.y + 5, y2 = r.y + 18;
    const e = txt(c, A.text('laeuft'), x0, y1, FA.laeuft, titelO);
    const v = A.verfall(l.rest), fr = v.n <= 1 ? '! ' + A.text('fristBald') : A.text('frist', { n: v.n }) + (v.n === 1 ? ' Tätigkeit' : ' Tätigkeiten');
    const fe = r.x + r.w - 8; txt(c, fr, fe, y1, v.bald ? FA.bald : FA.text, { align: 'right' });
    txt(c, kuerzen(l.titel, fe - tw(fr) - 12 - (e + 8)), e + 8, y1, FA.text);
    const b = A.beats(l.schritt, l.schritte_gesamt), bw = Math.min(La.beatW, Math.floor((La.beatsMaxW - (b.length - 1) * La.beatLuft) / b.length));
    let x = x0; b.forEach((z) => {
      if (z === 'fertig') rect(c, x, y2, bw, La.beatH, FA.laeuft);
      else if (z === 'jetzt') { rect(c, x, y2, bw, La.beatH, FA.laeuft); rand(c, x - 1, y2 - 1, bw + 2, La.beatH + 2, FA.text); }
      else rand(c, x, y2, bw, La.beatH, FA.beatOffen);
      x += bw + La.beatLuft;
    });
    x += 6; x = txt(c, A.text('schritt', { i: l.schritt, n: l.schritte_gesamt }) + ' ·', x, y2 - 1, FA.dim) + 4;
    if (l.gefahr) { bake(c, x, y2 - 1, M.bakeKlein.w, M.bakeKlein.h, 2); x += M.bakeKlein.w + 3; }
    txt(c, kuerzen(l.schritt_text || '', r.x + r.w - 8 - x), x, y2 - 1, FA.text);
  }
  function leer(c, B, m) {
    const h = 58; P.cham(c, B.x, B.y, B.w, h, FA.kachelZu, 0, 0, 6, 0); rect(c, B.x, B.y, 3, h, FA.leerBalken);
    txt(c, A.text('leerTitel'), B.x + 14, B.y + 10, FA.text, titelO);
    T.umbruch(m.leerText || A.text('leerText'), B.w - 28, 3).forEach((z, i) => txt(c, z, B.x + 14, B.y + 25 + i * M.zeileLuft, FA.dim));
  }
  function info(c, I, m) {
    rect(c, I.x, I.y - 3, I.w, 1, FA.trenner);
    let y = I.y + 2;
    const i = m.info || {};
    if (i.grund) { txt(c, kuerzen(i.grund, I.w), I.x, y, FA.bald); y += M.zeileLuft; }
    else if (i.angenommen) { const e = txt(c, A.text('angenommen'), I.x, y, FA.laeuft, titelO); txt(c, A.text('angenommenText', { titel: i.angenommen }), e + 8, y, FA.text); y += M.zeileLuft; }
    (m.geruechte || []).slice(0, Math.floor((I.y + I.h - y) / M.zeileLuft)).forEach((g) => {
      geruechtBalken(c, I.x, y - 1, M.zeile, FA.angebot);
      let x = txt(c, A.text('geruecht'), I.x + 6, y, FA.angebot, titelO) + 6;
      x = plakette(c, x, y - 1, g.von) + 5;
      let rx = I.x + I.w;
      const ref = (m.angebote || []).findIndex((a) => a.id === g.angebot) + 1;   // Verweis per Id; die Nummer ist die Stelle am Brett
      if (ref) { rx = kappeZ(c, rx - M.kappe.w, y - 1, String(ref)) - M.kappe.w - 2; rx = txt(c, '→', rx, y, FA.dim, { align: 'right' }) - 4; }   // Verweis auf das Angebot
      txt(c, kuerzen(g.text, rx - x - 6), x, y, FA.text);
      y += M.zeileLuft;
    });
  }

  function brett(c, m) {
    const lauf = !!m.laufend, L = A.layout(lauf), B = L.bereich;
    txt(c, A.text('bereich'), B.x, L.titel.y, FA.angebot, titelO);
    if ((m.angebote || []).length) txt(c, A.text('hilfe', { wahl: '↑↓', an: 'Ent', ab: 'X' }), B.x + B.w, L.titel.y, FA.dim, { align: 'right' });   // ohne Angebot keine Tastenzeile (im Spiel: echte Kappen über PultTerminal.kappe)
    if (lauf) laeuftStreifen(c, L.laeuft, m.laufend);
    const an = m.angebote || [];
    if (!an.length) leer(c, lauf ? { x: B.x, y: L.liste[0].y, w: B.w } : B, m);
    else {
      an.slice(0, 3).forEach((a, i) => karte(c, L.liste[i], a, i + 1, a.id === m.gewaehlt, lauf));
      detail(c, L.detail, an.find((a) => a.id === m.gewaehlt) || an[0], lauf);
    }
    info(c, L.info, m);
    return L;
  }

  // ---------------------------------------------------------------- Pult unten: Bereichsknopf „Brett“, Annehmen, Ablehnen (Kontur), Hinweis
  function aktionen(c, m) {
    const TA = T.layout().aktionen, K = M.knopf.brett, py = TA.handel.y;
    c.fillStyle = P.SKINS.rom.bg; c.fillRect(K.x - 4, py - 2, K.w + 6, 15);   // Referenz: verdeckt die Linie des Titels MODULRAUM (im Spiel: modulTitel.w = MASS.knopf.modulTitelW)
    P.knopf(c, K.x, py, K.w, TA.handel.h, A.text('knopf'), { hotkey: 'O', fn: 'nav', active: true });
    const an = m.angebote || [], sel = an.find((a) => a.id === m.gewaehlt) || an[0];
    const gesperrt = !!m.laufend, kein = !sel;
    P.knopf(c, TA.haupt.x, TA.haupt.y, TA.haupt.w, TA.haupt.h, A.text('annehmen'), { hotkey: 'Ent', fn: 'nav', disabled: gesperrt || kein, reason: gesperrt ? A.text('gesperrtGrund', { titel: m.laufend.titel }) : null });
    if (gesperrt) txt(c, A.text('gesperrt'), TA.hinweis.x, TA.hinweis.y, FA.bald);
    else if (!kein) txt(c, A.text('kostetNichts'), TA.hinweis.x, TA.hinweis.y, FA.laeuft);
    P.knopf(c, TA.ausbau.x, TA.ausbau.y, TA.ausbau.w, TA.ausbau.h, A.text('ablehnen'), { hotkey: 'X', fn: 'neutral', kontur: true, disabled: kein });
    P.knopf(c, TA.teil.x, TA.teil.y, TA.teil.w, TA.teil.h, 'Angebot', { hotkey: '↑↓', fn: 'neutral', disabled: an.length < 2 });
  }

  // ---------------------------------------------------------------- Flug-HUD: schmaler Status unter dem Ziele-Kasten
  // l: { titel, schritt, schritte_gesamt, schritt_text, gefahr, rest, neu (frisch angenommen: ANGENOMMEN statt Frist) }
  function hud(c, y, l) {
    const H = M.hud, x = H.x;
    R.backdrop(c, x, y, H.w, H.h, H.alpha);
    rect(c, x, y, H.balken, H.h, FA.laeuft);
    const y1 = y + 3, y2 = y + 13, re = x + H.w - H.innen;
    const v = A.verfall(l.rest);
    const rechts = l.neu ? A.text('angenommen').toUpperCase() : (v.bald ? '! ' : '') + A.text('hudFrist', { n: v.n });   // „Frist 7“: Einheit Tätigkeiten (Tooltip/Hilfe), „!“ + Gelb ab 2
    const rcol = l.neu ? FA.laeuft : v.bald ? FA.bald : FA.hudDim;
    txt(c, rechts, re, y1, rcol, { align: 'right' });
    txt(c, kuerzen(l.titel, re - tw(rechts) - 6 - (x + H.innen)), x + H.innen, y1, FA.hudTitel);
    let bx = x + H.innen; A.beats(l.schritt, l.schritte_gesamt).forEach((z) => {
      if (z === 'offen') rand(c, bx, y2 + 1, H.beatW, H.beatH, FA.beatOffen); else rect(c, bx, y2 + 1, H.beatW, H.beatH, FA.laeuft);
      if (z === 'jetzt') rect(c, bx, y2 + H.beatH + 2, H.beatW, 1, FA.hudText);   // aktueller Beat: Strich darunter (Form, nicht nur Farbe)
      bx += H.beatW + H.beatLuft;
    });
    bx += 4; if (l.gefahr) { bake(c, bx, y2, M.bakeKlein.w, M.bakeKlein.h, 2); bx += M.bakeKlein.w + 3; }
    txt(c, kuerzen(l.schritt_text || '', re - bx), bx, y2, FA.hudText);
    return y + H.h;
  }

  window.AuftragReferenz = { brett, aktionen, hud, karte, detail, laeuftStreifen, info, leer, bake, plakette, marke, tag };
})();
