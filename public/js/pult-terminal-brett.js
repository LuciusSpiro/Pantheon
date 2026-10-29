// SUND-04b D: Frontend-Layer des Auftragsbretts (Terminal-Bereich „Brett“) und des Abenteuer-Status im Flug-HUD. Ergänzt `PultTerminal` um zeichneBrett und zeichneAbenteuerHud.
// Zeichnet nur: Geometrie und Farben kommen aus PultAuftrag (public/js/pult-auftrag-tokens.js, Designer), die Daten aus dem Modell, das terminal-ui.js bzw. hud.js aus Brett.modell() baut
// (Angebote tragen nr, kappe und onClick). Kein Netz, kein Zustand, keine Regeln. Titel, Anlass, Gerüchte und Schritte sind Modelltext: sie gehen nur als Text auf die Zeichenfläche, nie als HTML.
// Vorlage und Zielbilder: public/auftrag-referenz.js / auftrag-preview.html (Referenz, kein Spielcode) und vault Pantheon/Mockups/SUND-04b.
// Hängt an: Render, Pult, PultTerminal (pult-terminal-tokens.js), PultAuftrag. Keine Farbwerte und keine Maße hier (tools/check-terminal-farben.js, Dateiname enthält „terminal“): nur PultAuftrag.TOKENS (FARBE, MASS).
// Jede Textzeile ist gekürzt: R.wrap bricht nur an Leerzeichen, ein langes Wort ohne Leerzeichen liefe sonst über den Rand (umbr kappt jede Zeile mit kuerzen).
//
//   PultTerminal.zeichneBrett(ctx, b)          b: { titel, hilfe, laufend: Brett-laufend | null, gewaehlt: id, angebote: [Angebot + { nr, kappe, onClick }], geruechte, scheitern, leerText, info: { grund } | { angenommen: titel } | null }
//   PultTerminal.zeichneAbenteuerHud(ctx, y, l)  l: Brett-laufend + { neu } (eben angenommen); gibt die Unterkante zurück
(function () {
  'use strict';
  const T = window.PultTerminal, P = window.Pult, A = window.PultAuftrag, R = window.Render;
  if (!T || !P || !A || !R) return;
  const FA = A.TOKENS.FARBE, M = A.TOKENS.MASS, Z = M.detail, LI = M.liste, LA = M.laeuft, H = M.hud, IT = M.infoText;
  const txt = (c, s, x, y, col, o) => T.txt(c, s, x, y, col, o);
  const tw = (s, sc, sp) => T.tw(s, sc, sp);
  const titelO = { versal: true, sperr: 1 };
  const UEBER = 1;   // Plakette und Kappe liegen 1 px über der Textzeile
  const rect = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  const rand = (c, x, y, w, h, col) => { rect(c, x, y, w, 1, col); rect(c, x, y + h - 1, w, 1, col); rect(c, x, y, 1, h, col); rect(c, x + w - 1, y, 1, h, col); };
  // Text auf die Breite kürzen (mit „…“); versal: Messung wie Versalien mit Sperrung
  function kuerzen(s, w, o) {
    s = String(s || ''); const m = (t) => (o && o.versal ? tw(t.toUpperCase(), 1, o.sperr || 0) : tw(t));
    if (m(s) <= w) return s;
    while (s.length > 1 && m(s + '…') > w) s = s.slice(0, -1).replace(/\s+$/, '');
    return s + '…';
  }
  // Umbruch nach Pixelbreite, höchstens n Zeilen, JEDE Zeile höchstens w breit (R.wrap trennt nur an Leerzeichen: ein 40-Zeichen-Wort bliebe sonst eine überbreite Zeile)
  const umbr = (s, w, n) => T.umbruch(s, w, n).map((z) => kuerzen(z, w));
  // Titel in Versalien mit Sperrung; passt er so nicht, in normaler Schreibweise ohne Sperrung, erst dann gekürzt
  function titelZeichnen(c, s, x, y, w, col) {
    s = String(s || '');
    return tw(s.toUpperCase(), 1, titelO.sperr) <= w ? txt(c, s, x, y, col, titelO) : txt(c, kuerzen(s, w), x, y, col);
  }
  // Fläche mit Tooltip (kein Klick): der volle Wortlaut, wo die Zeile nur die Plakette oder einen Teil trägt
  function tip(r, text) {
    if (!text || !R.ui || !R.ui.buttons) return;
    const t = kuerzen(text, 600);
    R.ui.buttons.push({ x: r.x, y: r.y, w: r.w, h: r.h, label: t, disabled: false, onClick: null, hotkey: null });
    const m = R.ui.mouse;
    if (m && m.x >= r.x && m.y >= r.y && m.x < r.x + r.w && m.y < r.y + r.h) R.ui.tooltip = { text: t, x: m.x, y: m.y };
  }

  // ---------------------------------------------------------------- Zeichen
  // Bake: Streifen 45° hell/rot (die Warnbake der Front von der Lagekarte), 1 px Rahmen in Rot. Gefahr steht nie nur als Farbe: immer mit dem Wort oder im Schritt mit der kleinen Bake.
  function bake(c, x, y, w, h, schritt) {
    schritt = schritt || M.bake.schritt;
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    rect(c, x, y, w, h, FA.gefahrHell);
    c.fillStyle = FA.gefahrRot; for (let d = -h; d < w + h; d += schritt * 2) for (let r = 0; r < h; r++) c.fillRect(x + d + r, y + r, schritt, 1);
    c.restore(); rand(c, x, y, w, h, FA.gefahrRot);
  }
  // Plakette: Buchstabe der Fraktion auf ihrer Haltungsfarbe; auf voller Messingfläche mit 1 px ink-Rahmen (G läge dort bei 1,1:1)
  function plakette(c, x, y, fid, aufFlaeche) {
    const f = A.fraktion(fid), s = M.plakette;
    rect(c, x, y, s, s, f.feld); if (aufFlaeche) rand(c, x - 1, y - 1, s + 2, s + 2, FA.ink);
    txt(c, f.buchstabe, x + Math.floor(s / 2) + 1, y + 1, f.text, { align: 'center' });
    return x + s;
  }
  // Marke: Plakette + Pfeil(e); die Richtung trägt der Pfeil, nicht die Farbe
  function marke(c, x, y, mk, o) {
    o = o || {};
    let e = plakette(c, x, y, mk.f, o.flaeche) + M.marke.pfeil;
    e = txt(c, A.pfeile(mk.d), e, y + 1, o.flaeche ? FA.ink : FA.text);
    return e;
  }
  function kappeZ(c, x, y, s, aufFlaeche) {
    const k = M.kappe, w = Math.max(k.w, tw(s) + k.pad);
    rect(c, x, y, w, k.h, aufFlaeche ? FA.kappeGew : FA.kappe);
    txt(c, s, x + Math.round(w / 2), y + 1, FA.text, { align: 'center' });
    return x + w;
  }
  function geruechtBalken(c, x, y, h, col) { const g = M.geruecht; for (let i = 0; i < h; i += g.strich + g.luecke) rect(c, x, y + i, g.balken, Math.min(g.strich, h - i), col); }
  // Zeile 2 der Karte: Typen und Ort; passen nicht alle Typen neben den Ort, entfallen die hinteren (der Ort bleibt)
  function typOrt(a, w) {
    const ort = a.ortname || '', typen = Array.isArray(a.typen) ? a.typen : [];
    for (let k = typen.length; k > 0; k--) { const s = A.typText(typen.slice(0, k)) + (ort ? ' · ' + ort : ''); if (tw(s) <= w) return s; }
    return kuerzen(ort || A.typText(typen), w);
  }
  const klick = (b) => { if (b.onClick && R.ui && R.ui.buttons) R.ui.buttons.push(b); };

  // ---------------------------------------------------------------- Karte (links)
  function karte(c, r, a, gew, kompakt) {
    const i = LI.innen;
    if (gew) P.cham(c, r.x, r.y, r.w, r.h, FA.angebot, 0, 0, LI.cham, 0);
    else { P.cham(c, r.x, r.y, r.w, r.h, FA.kachel, 0, 0, LI.cham, 0); if (a.aus_geruecht) geruechtBalken(c, r.x, r.y, r.h, FA.angebot); else rect(c, r.x, r.y, LI.balken, r.h, FA.angebot); }
    const ink = gew ? FA.ink : FA.text, sub = gew ? FA.ink : FA.dim;
    const zl = kompakt ? LI.zeilen.kompakt : LI.zeilen.normal, y1 = r.y + zl[0], y2 = r.y + zl[1], y3 = r.y + zl[2];
    const kx = kappeZ(c, r.x + i, y1 - UEBER, a.kappe || String(a.nr), gew);
    plakette(c, r.x + r.w - i - M.plakette, y1 - UEBER, a.von, gew);
    txt(c, kuerzen(a.titel, r.x + r.w - i - M.plakette - LI.titelLuft - (kx + LI.kappeLuft)), kx + LI.kappeLuft, y1, ink);
    const v = A.verfall(a.rest);
    txt(c, v.kurz, r.x + r.w - i, y2, gew ? FA.ink : v.bald ? FA.bald : FA.dim, { align: 'right' });
    txt(c, typOrt(a, r.w - 2 * i - tw(v.kurz) - LI.rechtsLuft), r.x + i, y2, sub);
    // Zeile 3: Marken beim Gelingen, dann rechts die Gefahr-Bake mit Wort
    let x = r.x + i;
    ((a.vorschau && a.vorschau.gelingt) || []).map(A.folge).filter((f) => f.marke).slice(0, LI.markenMax).forEach((f) => { x = marke(c, x, y3, f.marke, { flaeche: gew }) + M.marke.karte; });
    if (a.vorschau && a.vorschau.gefahr) { const gx = r.x + r.w - i - tw('GEFAHR', 1, 1); txt(c, 'Gefahr', gx, y3 + 1, gew ? FA.ink : FA.gefahrText, titelO); bake(c, gx - M.bake.w - 4, y3, M.bake.w, M.bake.h); }
    klick({ x: r.x, y: r.y, w: r.w, h: r.h, label: a.titel, onClick: a.onClick, disabled: false });
  }

  // ---------------------------------------------------------------- Detail (rechts)
  // Inhalt einer Folgenliste: die Marken (Ruf/Haltung) und die Sätze, schon in Zeilen der Breite w
  function folgenInhalt(liste, w) {
    const fs = (liste || []).map(A.folge), zeilen = [];
    fs.filter((f) => f.text).forEach((f) => umbr(f.text, w, Z.folgeZeilen).forEach((z) => zeilen.push(z)));
    const mk = fs.filter((f) => f.marke).map((f) => f.marke);
    return { mk, zeilen, rows: (mk.length ? 1 : 0) + zeilen.length };
  }
  // Markenzeile: „Ruf [K]▲▲ · Haltung [G]▼“, das Wort in dim vor der ersten Marke der Art, jede Marke mit Tooltip („Ruf Konkordat +2“); was nicht mehr danebenpasst, entfällt (der Tooltip der Karte zeigt den Rest nicht, die Sätze nennen ihn)
  function markenZeile(c, x0, y, w, mk) {
    let x = x0, art = null; const ende = x0 + w, luft = M.marke.luft, punkt = tw('·');
    for (const m of mk) {
      const neu = m.art !== art, wort = A.text(m.art === 'haltung' ? 'haltung' : 'ruf');
      const sep = art === null ? 0 : neu ? 2 * luft + punkt : luft;
      if (x + sep + (neu ? tw(wort) + luft : 0) + M.plakette + M.marke.pfeil + tw(A.pfeile(m.d)) > ende) break;
      if (art !== null && neu) txt(c, '·', x + luft, y, FA.dim);
      x += sep;
      if (neu) x = txt(c, wort, x, y, FA.dim) + luft;
      const mx = x; x = marke(c, x, y - UEBER, m);
      tip({ x: mx, y: y - UEBER, w: x - mx, h: M.marke.h }, A.markeText(m));
      art = m.art;
    }
  }
  // Block Gelingt/Scheitert: Überschrift, Markenzeile (verdrängt bei Platzmangel einen Satz), Sätze; n = Zeilen darunter, satz = letzte Zeile in dim (Scheitern-Satz des Servers)
  function folgenBlock(c, x, y, w, kopf, inh, n, satz) {
    txt(c, kopf, x, y, FA.dim, titelO);
    let yy = y + Z.kopfH, rest = n;
    if (inh.mk.length && rest > 0) { markenZeile(c, x, yy, w, inh.mk); yy += M.zeile; rest--; }
    inh.zeilen.slice(0, rest).forEach((z, i) => { txt(c, i === rest - 1 && inh.zeilen.length > rest ? kuerzen(z + ' …', w) : z, x, yy + i * M.zeile, FA.text); });
    if (satz) { const sy = yy + Math.min(rest, inh.zeilen.length) * M.zeile; txt(c, kuerzen(satz, w), x, sy, FA.dim); tip({ x, y: sy, w, h: M.zeile }, satz); }
  }
  function detail(c, D, a, scheitern) {
    const f = A.fraktion(a.von), nx = D.titel.x + D.titel.w;
    const e = nx - tw(f.name); txt(c, f.name, e, D.titel.y, FA.text);
    plakette(c, e - M.plakette - Z.vonPlak, D.titel.y - UEBER, a.von);
    const vx = txt(c, A.text('von'), e - M.plakette - Z.vonText, D.titel.y, FA.dim, { align: 'right' }) - tw(A.text('von'));
    titelZeichnen(c, a.titel, D.titel.x, D.titel.y, vx - Z.titelLuft - D.titel.x, FA.text);
    umbr(a.anlass || '', D.anlass.w, Math.round(D.anlass.h / M.zeile)).forEach((z, i) => txt(c, z, D.anlass.x, D.anlass.y + i * M.zeile, FA.dim));
    // Typ-Marken (die der Server schickt), dann der Ort, rechts der Verfall; die Marken lassen dem Ort mindestens tagMin Platz
    const v = A.verfall(a.rest), vt = v.bald ? '! ' + v.lang : v.lang, ende = D.ort.x + D.ort.w - tw(vt) - Z.nach;
    let x = D.ort.x;
    (a.typen || []).forEach((t) => {
      const s = A.typText([t]), w = tw(s.toUpperCase(), 1, 1) + 2 * M.tag.innen + 1;
      if (x + w + Z.tagMin > ende) return;
      rand(c, x, D.ort.y, w, M.tag.h, FA.tagRand); txt(c, s, x + M.tag.innen + 1, D.ort.y + M.tag.textY, FA.dim, titelO); x += w + M.tag.luft;
    });
    const ox = x + (x > D.ort.x ? Z.typLuft : 0);
    txt(c, kuerzen(a.ortname || '', ende - ox), ox, D.ort.y + M.tag.textY, FA.text);   // ein langer Ortsname (bis 40 Zeichen) weicht dem Verfall
    txt(c, vt, D.ort.x + D.ort.w, D.ort.y + M.tag.textY, v.bald ? FA.bald : FA.dim, { align: 'right' });
    rect(c, D.trenner.x, D.trenner.y, D.trenner.w, 1, FA.trenner);
    // Schritte (höchstens 4, sonst „+n weitere“), gefährliche mit kleiner Bake, eine Bitte mit „· Wahl“ und ihren Optionen samt Marken im Tooltip
    const S = D.schritte, st = ((a.vorschau && a.vorschau.schritte) || []).map(A.schritt), max = Z.schritteMax;
    txt(c, A.text('schritte'), S.x, S.y, FA.dim, titelO);
    st.slice(0, st.length > max ? max - 1 : max).forEach((s, i) => {
      const y = S.y + Z.kopfH + i * M.zeile; txt(c, String(i + 1), S.x, y, FA.dim);
      let tx = S.x + Z.schrittX; if (s.gefahr) { bake(c, tx, y, M.bakeKlein.w, M.bakeKlein.h, M.bakeKlein.schritt); tx += M.bakeKlein.w + M.bakeKlein.luft; }
      const zusatz = s.wahl ? ' · ' + A.text('wahl') : '';
      const te = txt(c, kuerzen(s.text, S.x + S.w - tx - tw(zusatz)), tx, y, FA.text);
      if (zusatz) { txt(c, zusatz, te, y, FA.dim); tip({ x: S.x, y, w: S.w, h: M.zeile }, A.wahlText(s.wahl)); }
    });
    if (st.length > max) txt(c, A.text('mehrSchritte', { n: st.length - max + 1 }), S.x + Z.schrittX, S.y + Z.kopfH + (max - 1) * M.zeile, FA.dim);
    // Gelingt | Scheitert: ohne laufendes Abenteuer 6 Zeilen für beide; der Scheitern-Satz des Servers steht als letzte Zeile unter SCHEITERT, braucht Scheitert höchstens 2 Zeilen, bekommt Gelingt bis zu 4
    const vs = a.vorschau || {}, G = D.gelingt, Sc = D.scheitert, kompakt = G.zeilen < Z.folgeZeilen;
    const gi = folgenInhalt(vs.gelingt, G.w), si = folgenInhalt(vs.scheitert, Sc.w), satz = !kompakt && scheitern ? scheitern : '';
    let gn = G.zeilen, sn = Sc.zeilen;
    if (!kompakt) {
      const gesamt = Math.floor((Sc.y + Sc.h - G.y - 2 * Z.kopfH - Z.folgeLuft) / M.zeile), eigen = Math.min(satz ? gesamt - Z.folgeZeilen - 1 : Sc.zeilen, si.rows);
      sn = eigen; gn = Math.min(Z.folgeMax, gesamt - eigen - (satz ? 1 : 0));
    }
    folgenBlock(c, G.x, G.y, G.w, A.text('gelingt'), gi, gn);
    folgenBlock(c, Sc.x, kompakt ? Sc.y : G.y + Z.kopfH + gn * M.zeile + Z.folgeLuft, Sc.w, A.text('scheitert'), si, sn, satz);
    // Gefahr: Bake + Wort + der gefährliche Schritt; ohne Gefahr ausdrücklich „kein Kampf angekündigt“ (Gefahr wird angekündigt)
    const Ge = D.gefahr;
    if (vs.gefahr) { bake(c, Ge.x, Ge.y, M.bake.w, M.bake.h); const gx = txt(c, A.text('gefahr'), Ge.x + M.bake.w + Z.gefahrX, Ge.y + 1, FA.gefahrText, titelO); txt(c, kuerzen(vs.gefahrText || '', Ge.x + Ge.w - gx - Z.gefahrText), gx + Z.gefahrText, Ge.y + 1, FA.text); }
    else txt(c, A.text('keineGefahr'), Ge.x, Ge.y + 1, FA.dim);
  }

  // ---------------------------------------------------------------- Laufend (Streifen oben), leer, Infozeile
  // Zustand „wartet“ (der Start des nächsten Schritts steht noch aus): rest ist die Zahl der Tätigkeiten bis dahin, keine Frist (Server restLaufend). Rechts steht dann „beginnt in n Tätigkeiten“ in dim,
  // und der Beat „jetzt“ ist hohl (Doppelrahmen), nicht voll: die Form trägt den Unterschied zu „läuft“, nicht die Farbe.
  function laeuftStreifen(c, r, l) {
    const wartet = l.ph !== 'laeuft';
    P.cham(c, r.x, r.y, r.w, r.h, FA.kachel, 0, 0, LI.cham, 0); rect(c, r.x, r.y, LA.balken, r.h, FA.laeuft);
    const x0 = r.x + LA.x, y1 = r.y + LA.y1, y2 = r.y + LA.y2;
    const e = txt(c, A.text('laeuft'), x0, y1, FA.laeuft, titelO);
    const v = A.verfall(l.rest), fe = r.x + r.w - LA.rand;
    const fr = wartet ? A.beginnt(l.rest) : v.n <= 1 ? '! ' + A.text('fristBald') : A.text('frist', { n: v.n }) + (v.n === 1 ? ' Tätigkeit' : ' Tätigkeiten');
    txt(c, fr, fe, y1, wartet ? FA.dim : v.bald ? FA.bald : FA.text, { align: 'right' });
    txt(c, kuerzen(l.titel, fe - tw(fr) - LA.fristLuft - (e + LA.titelLuft)), e + LA.titelLuft, y1, FA.text);
    const b = A.beats(l.schritt, l.schritte_gesamt), bw = Math.min(LA.beatW, Math.floor((LA.beatsMaxW - (b.length - 1) * LA.beatLuft) / b.length));
    let x = x0; b.forEach((z) => {
      if (z === 'fertig') rect(c, x, y2, bw, LA.beatH, FA.laeuft);
      else if (z === 'jetzt' && !wartet) { rect(c, x, y2, bw, LA.beatH, FA.laeuft); rand(c, x - 1, y2 - 1, bw + 2, LA.beatH + 2, FA.text); }
      else if (z === 'jetzt') { rand(c, x, y2, bw, LA.beatH, FA.beatOffen); rand(c, x - 1, y2 - 1, bw + 2, LA.beatH + 2, FA.text); }
      else rand(c, x, y2, bw, LA.beatH, FA.beatOffen);
      x += bw + LA.beatLuft;
    });
    x += LA.beatsLuft; x = txt(c, A.text('schritt', { i: l.schritt, n: l.schritte_gesamt }) + ' ·', x, y2 - UEBER, FA.dim) + LA.schrittLuft;
    if (l.gefahr) { bake(c, x, y2 - UEBER, M.bakeKlein.w, M.bakeKlein.h, M.bakeKlein.schritt); x += M.bakeKlein.w + M.bakeKlein.luft; }
    txt(c, kuerzen(l.schritt_text || '', r.x + r.w - LA.rand - x), x, y2 - UEBER, FA.text);
  }
  function leer(c, B, b) {
    const E = M.leer; P.cham(c, B.x, B.y, B.w, E.h, FA.kachelZu, 0, 0, E.cham, 0); rect(c, B.x, B.y, E.balken, E.h, FA.leerBalken);
    txt(c, A.text('leerTitel'), B.x + E.x, B.y + E.titelY, FA.text, titelO);
    umbr(b.leerText || A.text('leerText'), B.w - 2 * E.x, E.zeilen).forEach((z, i) => txt(c, z, B.x + E.x, B.y + E.textY + i * M.zeileLuft, FA.dim));
  }
  function infozeile(c, I, b) {
    rect(c, I.x, I.y - IT.trenner, I.w, 1, FA.trenner);
    let y = I.y + IT.y;
    const i = b.info || {};
    if (i.grund) { txt(c, kuerzen(i.grund, I.w), I.x, y, FA.bald); y += M.zeileLuft; }   // Absage des Servers (zweite Antwort, kein Platz …): Gelb, ersetzt die erste Zeile
    else if (i.angenommen) { const e = txt(c, A.text('angenommen'), I.x, y, FA.laeuft, titelO); txt(c, kuerzen(A.text('angenommenText', { titel: i.angenommen }), I.x + I.w - e - IT.nach), e + IT.nach, y, FA.text); y += M.zeileLuft; }
    (b.geruechte || []).slice(0, Math.max(0, Math.floor((I.y + I.h - y) / M.zeileLuft))).forEach((g) => {
      geruechtBalken(c, I.x, y - 1, M.zeile, FA.angebot);
      let x = txt(c, A.text('geruecht'), I.x + IT.balken, y, FA.angebot, titelO) + IT.balken;
      x = plakette(c, x, y - 1, g.von) + IT.plaketteLuft;
      let rx = I.x + I.w;
      const ref = (b.angebote || []).findIndex((a) => a.id === g.angebot) + 1;   // Verweis per Id; die Nummer ist die Stelle am Brett
      if (ref) { rx = kappeZ(c, rx - M.kappe.w, y - 1, (b.angebote[ref - 1].kappe) || String(ref)) - M.kappe.w - IT.kappeLuft; rx = txt(c, '→', rx, y, FA.dim, { align: 'right' }) - IT.pfeil; }
      txt(c, kuerzen(g.text, rx - x - IT.luft), x, y, FA.text);
      y += M.zeileLuft;
    });
  }

  function zeichneBrett(c, b) {
    const an = (b.angebote || []).slice(0, LI.max), lauf = !!b.laufend, L = A.layout(lauf), B = L.bereich;
    txt(c, b.titel || A.text('bereich'), B.x, L.titel.y, FA.angebot, titelO);
    if (an.length && b.hilfe) txt(c, b.hilfe, B.x + B.w, L.titel.y, FA.dim, { align: 'right' });   // ohne Angebot keine Tastenzeile
    if (lauf) laeuftStreifen(c, L.laeuft, b.laufend);
    if (!an.length) leer(c, lauf ? { x: B.x, y: L.liste[0].y, w: B.w } : B, b);
    else {
      an.forEach((a, i) => karte(c, L.liste[i], a, a.id === b.gewaehlt, lauf));
      detail(c, L.detail, an.find((a) => a.id === b.gewaehlt) || an[0], b.scheitern);
    }
    infozeile(c, L.info, Object.assign({}, b, { angebote: an }));
    return L;
  }

  // ---------------------------------------------------------------- Flug-HUD: schmaler Status unter dem Ziele-Kasten (Streifen 192 × 23, Hintergrund wie der Ziele-Kasten)
  function zeichneAbenteuerHud(c, y, l) {
    const x = H.x, wartet = l.ph !== 'laeuft';
    R.backdrop(c, x, y, H.w, H.h, H.alpha);
    rect(c, x, y, H.balken, H.h, FA.laeuft);
    const y1 = y + H.y1, y2 = y + H.y2, re = x + H.w - H.innen;
    const v = A.verfall(l.rest);
    // rechts: eben angenommen (mint), sonst die Frist (ab 2 Tätigkeiten „!“ in Gelb); wartet das Abenteuer auf den nächsten Schritt, ist rest keine Frist: dim „in n“ (Tätigkeiten bis zum Schritt)
    const rechts = l.neu ? A.text('angenommen').toUpperCase() : wartet ? A.beginnt(l.rest, true) : (v.bald ? '! ' : '') + A.text('hudFrist', { n: v.n });
    const rcol = l.neu ? FA.laeuft : wartet ? FA.hudDim : v.bald ? FA.bald : FA.hudDim;
    txt(c, rechts, re, y1, rcol, { align: 'right' });
    txt(c, kuerzen(l.titel, re - tw(rechts) - H.titelLuft - (x + H.innen)), x + H.innen, y1, FA.hudTitel);
    const b = A.beats(l.schritt, l.schritte_gesamt), bw = A.hudBeatW(b.length);
    let bx = x + H.innen; b.forEach((z) => {
      if (z === 'offen' || (z === 'jetzt' && wartet)) rand(c, bx, y2 + UEBER, bw, H.beatH, z === 'jetzt' ? FA.hudText : FA.beatOffen); else rect(c, bx, y2 + UEBER, bw, H.beatH, FA.laeuft);
      if (z === 'jetzt') rect(c, bx, y2 + H.beatH + 2 * UEBER, bw, 1, FA.hudText);   // aktueller Beat: Strich darunter (Form, nicht nur Farbe); wartend zusätzlich hohl
      bx += bw + H.beatLuft;
    });
    bx += H.schrittLuft; if (l.gefahr) { bake(c, bx, y2, M.bakeKlein.w, M.bakeKlein.h, M.bakeKlein.schritt); bx += M.bakeKlein.w + M.bakeKlein.luft; }
    txt(c, kuerzen(l.schritt_text || '', re - bx), bx, y2, FA.hudText);
    return y + H.h;
  }

  T.zeichneBrett = zeichneBrett;
  T.zeichneAbenteuerHud = zeichneAbenteuerHud;
})();
