// CHA-01 C: Oberfläche der Kleiderkammer – Charakterliste und Charaktererstellung (Frontend-Layer, Kais 3-Layer-Regel).
// Liest nur den Store von `Charaktere` (public/js/charaktere.js) und ruft bei Eingaben dessen Actions auf; hier steht keine Regel (Anzahl, Namen, Speicher),
// nur Darstellung und Tastenzuordnung. Gestaltung ausschließlich aus PultKammer.TOKENS (pult-kammer-tokens.js) und der Referenzzeichnung public/kammer-preview.html,
// Rahmen = Pult.rahmen (mit eigener Statusleiste, Option `status`). Bilder: Vorschau der Teile (Katalog), Porträt und Figur live über KammerBild (voxel/kammer.js).
// Globales `KammerUi`: zeichne(ctx, view) – eine Seite 'liste' | 'erstellung' je nach Store; taste(e) -> true, wenn die Taste verbraucht wurde (die Seite ist modal).
// CHA-01 D: der Spind an Bord ist eine Pult-Station (Konsole 'spind', consoles.js): spindZeichne(ctx, view) und spindTaste(e, view); Zustand im Store (sitzung.entwurf, modus 'spind'), Regeln in den spind*-Actions.
(function () {
  'use strict';
  const R = window.Render, P = window.Pult, PK = window.PultKammer, ME = window.Menue, C = window.Charaktere;
  const KT = PK.TOKENS, KM = KT.MASS, KX = KT.TEXT, FN = KT.FN;

  // Feste Texte dieser Oberfläche, die die Tokens nicht kennen (Test: jede Glyphe existiert in art.js)
  const TEXT = {
    liste: { voll: 'Alle 4 Plätze sind belegt. Erst einen Charakter löschen.', speicherFehler: 'NICHT GESPEICHERT: Charaktere gehen beim Schließen verloren', loeschFrage: 'LÖSCHEN? Entf bestätigt · Esc bricht ab', loeschKnopf: 'Sicher? Entf', frei: 'frei', bereitsGewaehlt: 'in der Lobby' },
    status: { keiner: '–', raum: '–' },
    erstellung: {
      name: 'NAME', namePlatz: 'Name eingeben', namenRegel: 'Name: 2–12 Zeichen, Buchstaben, Ziffern, Leerzeichen, Bindestrich', nameHinweis: 'F2 schreiben · Enter fertig', nameSpeichern: 'Enter speichert · Esc zurück',
      nameFertig: 'Enter speichert den Charakter', ohneName: 'Zuerst einen gültigen Namen eingeben', nurName: 'Umbenennen: nur der Name ändert sich', standard: 'Standard',
      figurHinweis: 'Standard-Outfit · Spind folgt', hinweisOhne3d: '←→↑↓ wählen · Vorschau ohne 3D', farbeWahl: '←→ Farbe', haar: 'Haarfarbe', haut: 'Hautton', farbName: '{platz} {n}',
    },
    spind: { angezogen: 'Angezogen', gesperrt: 'Gesperrt: nur anprobieren', ohne3d: '←→↑↓ Teil · Enter anziehen · Vorschau ohne 3D', nichtBereit: 'Charaktere noch nicht geladen' },
    volk: { lerche: 'Lerche', germanen: 'Germanen', rom: 'Rom', crew: 'Crew' },
  };
  const AKTION_SPIND = { kopf: 'charakter.spind.kopf', haende: 'charakter.spind.haende', oberteil: 'charakter.spind.oberteil', umhang: 'charakter.spind.umhang', hose: 'charakter.spind.hose', schuhe: 'charakter.spind.schuhe' };
  const AKTION = { frisur: 'charakter.erstellung.frisur', gesicht: 'charakter.erstellung.gesicht', bart: 'charakter.erstellung.bart', haar: 'charakter.erstellung.haar', haut: 'charakter.erstellung.haut' };

  // ---------------------------------------------------------------- Grundformen (Referenz kammer-preview.html)
  const rect = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  const rand = (c, x, y, w, h, col) => { rect(c, x, y, w, 1, col); rect(c, x, y + h - 1, w, 1, col); rect(c, x, y, 1, h, col); rect(c, x + w - 1, y, 1, h, col); };
  const dash = (c, x, y, w, h, col, s) => { c.fillStyle = col; for (let i = 0; i < w; i += s) { c.fillRect(x + i, y, 1, 1); c.fillRect(x + i, y + h - 1, 1, 1); } for (let i = 0; i < h; i += s) { c.fillRect(x, y + i, 1, 1); c.fillRect(x + w - 1, y + i, 1, 1); } };
  const hatch = (c, x, y, w, h, col, s) => { c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); c.fillStyle = col; for (let d = -h; d < w; d += s) for (let r = 0; r < h; r++) c.fillRect(x + d + r, y + r, 1, 1); c.restore(); };
  const txt = (c, s, x, y, col, align, scale) => { R.text(c, String(s), x, y, { color: col, align: align || 'left', scale: scale || 1, shadow: false }); return x + R.measure(String(s), scale || 1); };
  function txtSp(c, s, x, y, col, sp, scale, align) {
    const L = ME.sperrung(s, sp, scale || 1, (z, sk) => R.measure(z, sk));
    const x0 = align === 'center' ? x - Math.round(L.w / 2) : align === 'right' ? x - L.w : x;
    for (const z of L.zeichen) R.text(c, z.z, x0 + z.x, y, { color: col, scale: scale || 1, shadow: false });
    return x0 + L.w;
  }
  const kappeDunkel = (c, x, y, k, bg, ink) => { const w = Math.max(KM.liste.kappe, R.measure(k, 1) + 7); P.cham(c, x, y, w, 13, bg, 3, 0, 3, 0); txt(c, k, x + w / 2, y + 3, ink, 'center'); return x + w; };
  // Text, der in die Breite w passt (sonst mit Punkt gekürzt)
  function passend(s, w) { s = String(s); if (R.measure(s, 1) <= w) return s; while (s.length > 1 && R.measure(s + '.', 1) > w) s = s.slice(0, -1); return s + '.'; }

  // ---------------------------------------------------------------- Bilder
  const BILDER = {};   // Vorschaudatei -> Image
  function vorschau(datei) {
    if (!datei) return null;
    let im = BILDER[datei];
    if (!im) { im = BILDER[datei] = new Image(); im.src = '/voxel/sprites/' + datei; }
    return im.complete && im.naturalWidth ? im : null;
  }
  // Bild in das Rechteck einpassen (mittig, bei oben: oben bündig), geglättet (Quellbilder sind doppelt so groß wie das Fenster)
  function bildIn(c, im, r, oben) {
    if (!im) return;
    const sw = im.width || im.naturalWidth, sh = im.height || im.naturalHeight;
    const s = Math.min(r.w / sw, r.h / sh), w = sw * s, h = sh * s;
    c.save(); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.beginPath(); c.rect(r.x, r.y, r.w, r.h); c.clip();
    c.drawImage(im, Math.round(r.x + (r.w - w) / 2), Math.round(r.y + (oben ? 0 : (r.h - h) / 2)), Math.round(w), Math.round(h));
    c.restore();
  }
  const katalog = () => C.katalog();
  const teil = (platz, name) => ((katalog() && katalog().teile) || []).find((t) => t.id === platz + '/' + name) || null;
  const teilName = (platz, name) => { const t = teil(platz, name); return t ? t.name : String(name || ''); };
  const live3d = () => { const KB = window.KammerBild; return !!(KB && KB.moeglich()); };
  // Porträt (live) oder, solange es nicht da ist / ohne WebGL, der Ersatz: mit `platz` die Vorschau des Teils bzw. die Farbe der aktuellen Wahl dieses Platzes, sonst die Vorschau des Gesichts
  function portraet(c, r, karte, art, yaw, platz) {
    rect(c, r.x, r.y, r.w, r.h, F.figurGrund);
    const KB = window.KammerBild, b = live3d() ? KB.bild(karte, art, yaw) : null;
    if (b) { bildIn(c, b, r, art === 'nah'); return; }
    if (platz && C.FARB_PLAETZE.includes(platz)) {
      const f = farbeVon(platz, karte[platz]), m = Math.round(Math.min(r.w, r.h) * 0.2);
      rect(c, r.x + m, r.y + m, r.w - 2 * m, r.h - 2 * m, f); rand(c, r.x + m, r.y + m, r.w - 2 * m, r.h - 2 * m, F.musterRand);
      return;
    }
    const tp = platz && C.TEIL_PLAETZE.includes(platz) ? platz : 'gesicht', t = teil(tp, karte[tp]);
    bildIn(c, t && vorschau(t.vorschau), r, art === 'nah');
  }

  // ---------------------------------------------------------------- Rahmen
  let F = PK.farben('rom'), aktuellView = null;
  const MELDUNG_MS = 3500;
  // Meldung aus dem Store (sitzung.meldung = { grund, zeit }): nur der Text und die Anzeigedauer sind Sache der Oberfläche
  function meldungText() { const m = C.lies().sitzung.meldung; return m && Date.now() - m.zeit < MELDUNG_MS && TEXT.liste[m.grund] || null; }
  function zurueck() {
    const s = C.lies().sitzung;
    if (s.seite === 'erstellung') C.verwirfEntwurf();
    else if (aktuellView && aktuellView.actions.closeKammer) aktuellView.actions.closeKammer();
  }
  function pultRahmen(c, view, titel, status, anzeige) {
    const v = { state: { ship: {} }, send() {}, actions: { leave: zurueck } };
    return P.rahmen(c, v, { titel, S: KM.S, station: 'kammer', status, anzeige });
  }
  const statusFelder = (art, werte) => KT.STATUS[art].map((s, i) => Object.assign({}, s, { v: werte[i] }));
  const gross = (s) => String(s || '').toUpperCase();

  function ziffernblock(c, art, aktiv, titel, gesperrt) {
    const pr = PK.rahmen().pult, sp = KM.spalten.block;
    P.titel(c, pr.x + sp.x, pr.y, sp.w, titel, 'nav');
    for (const z of PK.ziffernblock(art, pr)) {
      const r = z.rect;
      if (z.leer) P.zelle(c, r.x, r.y, r.w, r.h, z.taste, '', '', 'nav', 'leer');
      else P.knopf(c, r.x, r.y, r.w, r.h, KT.PLATZ[z.platz].kurz, { hotkey: z.taste, aktion: (art === 'spind' ? AKTION_SPIND : AKTION)[z.platz], fn: KT.PLATZ[z.platz].gruppe === 'farbe' ? 'cmd' : 'nav', active: z.platz === aktiv, disabled: !!gesperrt, onClick: () => (art === 'spind' ? C.spindWaehlePlatz(z.platz) : C.waehlePlatz(z.platz)) });
    }
  }
  function spalteAbschluss(c, titel, knoepfe) {
    const pr = PK.rahmen().pult, sp = KM.spalten.abschluss, K = KM.knopf; let y = P.titel(c, pr.x + sp.x, pr.y, sp.w, titel, 'drive');
    knoepfe.forEach((k) => { const h = k.haupt ? K.hauptH : K.h; if (k.haupt) y = pr.y + pr.h - h - 2; P.knopf(c, pr.x + sp.x, y, sp.w, h, k.text, { hotkey: k.taste, aktion: k.aktion, fn: k.fn || 'drive', active: !!k.haupt, disabled: !!k.gesperrt, onClick: k.klick }); y += h + K.fuge; });
  }
  function cursorRahmen(c, k) { const A = KM.cursor; rand(c, k.x - A.innen, k.y - A.innen, k.w + 2 * A.innen, k.h + 2 * A.innen, F.platz); rand(c, k.x - A.aussen, k.y - A.aussen, k.w + 2 * A.aussen, k.h + 2 * A.aussen, F.cursor); }
  const klickFlaeche = (r, label, onClick) => R.ui.buttons.push({ x: r.x, y: r.y, w: r.w, h: r.h, label, onClick });

  // ---------------------------------------------------------------- Charakterliste
  function listeZeichnen(c, view) {
    const st = C.lies(), s = st.sitzung;
    const aktiv = st.liste.find((x) => x.id === st.gewaehlt);
    const code = (window.Net && Net.serverRoomCode) || null;
    const nOutfit = ((katalog() && katalog().teile) || []).filter((t) => t.gruppe === 'outfit').length;
    const g = pultRahmen(c, view, KX.saeule.liste, statusFelder('liste', [aktiv ? gross(aktiv.karte.name) : TEXT.status.keiner, st.liste.length + '/' + C.MAX, nOutfit + '/' + nOutfit, code || TEXT.status.raum]), (cc, a) => {
      PK.karten(a).forEach((k, i) => {
        const ch = st.liste[i], an = i === s.cursor;
        klickFlaeche(k, 'Charakter ' + (i + 1), () => C.setzeCursor(i));
        if (!ch) {
          rect(cc, k.x, k.y, k.w, k.h, F.kachel); hatch(cc, k.x, k.y, k.w, k.h, F.freiSchraffur, 4); dash(cc, k.x, k.y, k.w, k.h, F.kachelRand, 3);
          kappeDunkel(cc, k.x + 4, k.y + 4, String(i + 1), an ? F.kappeWahl : F.kappe, an ? F.kappeWahlText : F.dim);
          txtSp(cc, KX.frei, k.x + k.w / 2, k.y + 78, F.dim, 1, 2, 'center'); txt(cc, KX.freiHinweis, k.x + k.w / 2, k.y + 102, F.dim, 'center');
          if (an) cursorRahmen(cc, k);
          return;
        }
        const karte = ch.karte, getragen = ch.id === st.gewaehlt;
        rect(cc, k.x, k.y, k.w, k.h, F.kachel);
        portraet(cc, k.bild, karte, 'portraet');
        if (getragen) rect(cc, k.x, k.y, k.w, KM.getragen, F.platz);
        kappeDunkel(cc, k.x + 4, k.y + 4 + (getragen ? 2 : 0), String(i + 1), an ? F.kappeWahl : F.kappe, an ? F.kappeWahlText : F.kappeText);
        const ty = k.bild.y + k.bild.h + 4, bw = k.w - 12;
        txtSp(cc, gross(karte.name), k.x + 6, ty, getragen ? F.platz : F.text, 1);
        const bart = teilName('bart', karte.bart);
        txt(cc, passend(teilName('gesicht', karte.gesicht) + ' · ' + teilName('frisur', karte.frisur), bw), k.x + 6, ty + 13, F.text);
        txt(cc, passend(bart, bw), k.x + 6, ty + 23, F.text);
        txt(cc, passend(teilName('oberteil', karte.outfit.oberteil), bw), k.x + 6, ty + 33, F.dim);
        if (an) cursorRahmen(cc, k); else rand(cc, k.x, k.y, k.w, k.h, F.kachelRand);
        if (s.loeschFrage === ch.id) { rect(cc, k.x + 1, k.y + k.h - 14, k.w - 2, 13, F.loeschen); txt(cc, TEXT.liste.loeschKnopf, k.x + k.w / 2, k.y + k.h - 11, F.ink, 'center'); }
      });
    });
    const p = g.pult, S = KM.spalten, K = KM.knopf, voll = st.liste.length >= C.MAX, frei = !st.liste[s.cursor], fragt = !!s.loeschFrage;
    let y = P.titel(c, p.x + S.block.x, p.y, S.block.w, KX.spalte.charakter, 'nav');
    P.knopf(c, p.x, y, S.block.w, K.h, KX.knopf.neu, { hotkey: 'N', aktion: 'charakter.neu', fn: 'nav', disabled: voll, reason: TEXT.liste.voll, onClick: () => C.neuAnlegen() }); y += K.h + K.fuge;
    P.knopf(c, p.x, y, S.block.w, K.h, KX.knopf.umbenennen, { hotkey: 'F2', aktion: 'charakter.umbenennen', fn: 'nav', disabled: frei, onClick: () => C.beginneUmbenennen() }); y += K.h + K.fuge;
    P.knopf(c, p.x, y, S.block.w, K.h, fragt ? TEXT.liste.loeschKnopf : KX.knopf.loeschen, { hotkey: 'Entf', aktion: 'charakter.loeschen', fn: 'weapon', active: fragt, disabled: frei, onClick: () => C.loeschenAnfrage() });
    y = P.titel(c, p.x + S.mitte.x, p.y, S.mitte.w, KX.spalte.waehlen, 'cmd');
    const hw = (S.mitte.w - 4) / 2;
    P.knopf(c, p.x + S.mitte.x, y, hw, K.h, KX.knopf.platz, { hotkey: '1–4', fn: 'cmd' }); P.knopf(c, p.x + S.mitte.x + hw + 4, y, hw, K.h, KX.knopf.blaettern, { hotkey: '←→', fn: 'cmd' });
    txt(c, KX.nameIstSpieler, p.x + S.mitte.x, y + K.h + 8, F.dim);
    const meld = fragt ? { text: TEXT.liste.loeschFrage, farbe: F.loeschen } : (meldungText() ? { text: meldungText(), farbe: F.abschluss } : null);
    let my = y + K.h + 22;
    if (!st.speicherOk) { R.wrap(TEXT.liste.speicherFehler, S.mitte.w, 1).forEach((z, i) => txt(c, z, p.x + S.mitte.x, my + i * 10, FN.warn)); my += 10 * R.wrap(TEXT.liste.speicherFehler, S.mitte.w, 1).length + 4; }
    if (meld) R.wrap(meld.text, S.mitte.w, 1).forEach((z, i) => txt(c, z, p.x + S.mitte.x, my + i * 10, meld.farbe));
    spalteAbschluss(c, KX.spalte.weiter, [{ taste: 'Enter', aktion: 'charakter.uebernehmen', text: KX.knopf.lobby, haupt: true, klick: () => uebernehmen() }]);
  }

  // ---------------------------------------------------------------- Erstellung / Umbenennen
  function farbeVon(platz, i) {
    const f = C.farbenFuer(platz)[i];
    return !f ? F.figurGrund : typeof f === 'string' ? f : f.skin;
  }
  function kachel(c, k, t, zust) {
    const h = PK.herkunft(t), T = KM.textZeile;
    rect(c, k.x, k.y, k.w, k.h, F.kachel);
    if (h.gesperrt) {   // Händler/Fund: Schraffur, Bild grau, Kappe H/F, Herkunft als Text (in CHA-01 ist alles frei, die Form steht)
      const G = KM.gesperrt;
      rect(c, k.bild.x, k.bild.y, k.bild.w, k.bild.h, F.gesperrtGrund); hatch(c, k.bild.x, k.bild.y, k.bild.w, k.bild.h, F.gesperrtSchraffur, G.schraffur);
      c.save(); c.filter = 'grayscale(' + G.bild.grau + ') brightness(' + G.bild.hell + ')'; c.globalAlpha = G.bild.deckkraft; bildIn(c, vorschau(t.vorschau), k.bild); c.restore();
      P.cham(c, k.x + G.kappe.x, k.y + G.kappe.y, G.kappe.w, G.kappe.h, F.gesperrtKappe, G.kappe.schraeg, 0, G.kappe.schraeg, 0);
      txt(c, h.kappe, k.x + G.kappe.x + G.kappe.w / 2, k.y + G.kappe.y + 3, F.gesperrtKappeText, 'center');
      txt(c, passend(t.name, k.w - 6), k.x + 4, k.bild.y + k.bild.h + T.name, F.dim); txt(c, passend(h.sub, k.w - 6), k.x + 4, k.bild.y + k.bild.h + T.sub, F.dim);
      if (zust.cursor) cursorRahmen(c, k); else rand(c, k.x, k.y, k.w, k.h, F.kachelRand);
      return;
    }
    if (t.farbe) {   // Farbmuster groß
      rect(c, k.bild.x, k.bild.y, k.bild.w, k.bild.h, F.figurGrund);
      rect(c, k.bild.x + 8, k.bild.y + 6, k.bild.w - 16, k.bild.h - 12, t.farbe);
      if (t.schatten) rect(c, k.bild.x + 8, k.bild.y + k.bild.h - 6 - 14, k.bild.w - 16, 14, t.schatten);
      rand(c, k.bild.x + 8, k.bild.y + 6, k.bild.w - 16, k.bild.h - 12, F.musterRand);
    } else bildIn(c, vorschau(t.vorschau), k.bild);
    if (zust.getragen) rect(c, k.x, k.y, k.w, KM.getragen, F.platz);
    txt(c, passend(t.name, k.w - 6), k.x + 4, k.bild.y + k.bild.h + T.name, zust.getragen || zust.cursor ? F.platz : F.text);
    txt(c, passend(t.sub != null ? t.sub : h.sub, k.w - 6), k.x + 4, k.bild.y + k.bild.h + T.sub, F.dim);
    if (zust.cursor) cursorRahmen(c, k); else rand(c, k.x, k.y, k.w, k.h, F.kachelRand);
  }
  function figurFenster(c, a, e, name) {
    const f = PK.figur(a), M = KM.figur, b = KM.figurBild.nah;
    rect(c, f.x, f.y, f.w, f.h, F.figurGrund); rand(c, f.x, f.y, f.w, f.h, F.kachelRand);
    txtSp(c, gross(name) || '…', f.x + 6, f.y + 4, F.platz, 1);
    txt(c, e.modus === 'neu' ? KX.neu : KX.knopf.umbenennen, f.x + f.w - 6, f.y + 4, F.dim, 'right');
    const ky = f.y + f.h - M.kappe - M.kappeAbstand;
    portraet(c, { x: f.x + (f.w - b.w) / 2, y: f.y + M.nameH + Math.max(0, Math.floor((ky - f.y - M.nameH - b.h) / 2)), w: b.w, h: b.h }, C.entwurfKarte(), 'nah', e.yaw, e.modus === 'neu' ? e.platz : null);
    kappeDunkel(c, f.x + M.kappeAbstand, ky, 'Q', F.kappe, F.kappeText); kappeDunkel(c, f.x + f.w - M.kappeAbstand - 13, ky, 'E', F.kappe, F.kappeText);
    txt(c, KX.drehen, f.x + f.w / 2, ky + 3, F.dim, 'center');
  }
  // Namensfeld: Schreibmodus mit Schreibmarke (blinkt), Hinweis bei ungültigem Namen
  function namensfeld(c, x, y, w, e) {
    const aktiv = e.nameEdit, leer = !e.name;
    txt(c, TEXT.erstellung.name, x, y, F.platz);
    const bx = x + 34, by = y - 5;
    rect(c, bx, by, w - 34, 17, F.kachel);
    if (aktiv) { rand(c, bx - 1, by - 1, w - 32, 19, F.platz); rand(c, bx - 3, by - 3, w - 28, 23, F.cursor); } else rand(c, bx, by, w - 34, 17, F.kachelRand);
    const t = leer ? TEXT.erstellung.namePlatz : e.name;
    const ex = txt(c, t, bx + 6, y, leer ? F.dim : F.text);
    if (aktiv && Math.floor(performance.now() / 450) % 2 === 0) rect(c, leer ? bx + 6 : ex + 1, y - 1, 1, 9, F.cursor);
    const ys = by + 24;
    if (e.hinweis === 'name' || (e.hinweis && !aktiv)) { txt(c, '! ' + TEXT.erstellung.namenRegel, x, ys, F.abschluss); }
    else txt(c, e.modus === 'umbenennen' ? (aktiv ? TEXT.erstellung.nameSpeichern : TEXT.erstellung.nurName) : (aktiv ? TEXT.erstellung.nameHinweis : TEXT.erstellung.nameFertig), x, ys, F.dim);
  }
  function musterZeile(c, x, y, label, platz, wahl, aktiv) {
    txt(c, label, x, y + 2, aktiv ? F.platz : F.dim);
    const n = C.anzahlOptionen(platz);
    PK.muster(x, y, n).forEach((m, i) => {
      rect(c, m.x, m.y, m.w, m.h, farbeVon(platz, i)); rand(c, m.x, m.y, m.w, m.h, F.musterRand);
      if (i === wahl) { const d = KM.muster.wahl; rand(c, m.x - d, m.y - d, m.w + 2 * d, m.h + 2 * d, F.musterWahl); }
    });
  }
  function erstellungZeichnen(c, view) {
    const st = C.lies(), e = st.sitzung.entwurf;
    if (!e) return;
    const neu = e.modus === 'neu', k = e.karte, kat = katalog();
    const werte = [gross(e.name) || '…', teilName('gesicht', k.gesicht), (k.haar + 1) + '/' + C.anzahlOptionen('haar'), (k.haut + 1) + '/' + C.anzahlOptionen('haut')];
    const g = pultRahmen(c, view, KX.saeule.erstellung, statusFelder('erstellung', werte), (cc, a) => {
      const T = KM.kachel, platz = neu ? e.platz : null;
      let unten = a.y + T.y + T.titelH + 2;
      if (platz) {
        const farbe = C.FARB_PLAETZE.includes(platz);
        const n = C.anzahlOptionen(platz), wahl = C.wahlIndex(platz), std = (kat.plaetze.find((p) => p.id === platz) || {}).standard;
        P.titel(cc, a.x + T.x, a.y + T.y, KM.figur.x - T.x - 12, PK.text(KX.kachelTitel.erstellung, { platz: gross(KT.PLATZ[platz].name), n }), 'nav');
        const eintraege = farbe
          ? C.farbenFuer(platz).map((f, i) => ({ name: PK.text(TEXT.erstellung.farbName, { platz: KT.PLATZ[platz].name === 'Haarfarbe' ? 'Haar' : 'Haut', n: i + 1 }), sub: i === 0 ? TEXT.erstellung.standard : '', farbe: typeof f === 'string' ? f : f.skin, schatten: typeof f === 'string' ? null : f.skin_shadow }))
          : C.teileFuer(platz).map((t) => ({ name: t.name, sub: t.id === platz + '/' + std ? TEXT.erstellung.standard : TEXT.volk[t.volk] || '–', vorschau: t.vorschau, herkunft: 'frei' }));
        const ks = PK.kacheln(a, eintraege.length);
        ks.forEach((r, i) => { kachel(cc, r, eintraege[i], { cursor: i === wahl }); klickFlaeche(r, eintraege[i].name, () => C.setzeWahl(platz, i)); });
        unten = ks.length ? ks[ks.length - 1].y + ks[ks.length - 1].h : unten;
      } else {
        P.titel(cc, a.x + T.x, a.y + T.y, KM.figur.x - T.x - 12, gross(KX.knopf.umbenennen), 'nav');
        unten = a.y + T.y + T.titelH + 2 + 20;
      }
      namensfeld(cc, a.x + T.x, unten + 14, KM.figur.x - T.x - 12, e);
      txt(cc, platz ? (live3d() ? KX.hinweis.erstellung : TEXT.erstellung.hinweisOhne3d) : TEXT.erstellung.nurName, a.x + T.x, a.y + a.h - T.hinweisUnten, F.dim);
      figurFenster(cc, a, e, e.name);
    });
    ziffernblock(c, 'erstellung', neu ? e.platz : null, KX.spalte.kopf, !neu);
    const p = PK.rahmen().pult, S = KM.spalten.mitte;
    const y = P.titel(c, p.x + S.x, p.y, S.w, KX.spalte.farbe, 'cmd');
    musterZeile(c, p.x + S.x, y + 3, KX.muster.haar, 'haar', k.haar, neu && e.platz === 'haar');
    musterZeile(c, p.x + S.x, y + 3 + KM.muster.zeile, KX.muster.haut, 'haut', k.haut, neu && e.platz === 'haut');
    if (neu) txt(c, KX.musterHinweis, p.x + S.x, y + 3 + 2 * KM.muster.zeile + 2, F.dim);
    spalteAbschluss(c, KX.spalte.charakter, [
      { taste: 'F2', aktion: 'charakter.umbenennen', text: KX.knopf.name, fn: 'nav', klick: () => C.nameBearbeiten(true) },
      { taste: 'R', aktion: 'charakter.zuruecksetzen', text: KX.knopf.zuruecksetzen, fn: 'nav', klick: () => C.zuruecksetzen() },
      { taste: 'Enter', aktion: 'charakter.uebernehmen', text: KX.knopf.speichern, haupt: true, klick: () => C.speichereEntwurf() },
    ]);
  }

  // ---------------------------------------------------------------- Aktionen der Oberfläche (rufen nur Actions und melden)
  function uebernehmen() {
    const r = C.uebernimmOderNeu();
    if (r.ok && r.aktion === 'uebernommen' && aktuellView && aktuellView.actions.closeKammer) aktuellView.actions.closeKammer();
    return r;
  }

  // ---------------------------------------------------------------- Spind (Pult an Bord, CHA-01 D)
  // Kacheln des Platzes im Entwurf: getragen = das Teil, das der gewählte Charakter jetzt trägt; Cursor = Anprobe (Entwurf)
  function spindEintraege(e) {
    const getragen = (C.aktiveKarte() || { outfit: {} }).outfit[e.platz];
    return C.outfitTeileFuer(e.platz).map((t) => ({ name: t.name, volk: t.volk ? (TEXT.volk[t.volk] || '–') : '–', herkunft: t.herkunft || 'frei', preis: t.preis, vorschau: t.vorschau, getragen: t.id === e.platz + '/' + getragen }));
  }
  // Ganze Figur der Anprobe (live) oder, solange sie fehlt / ohne 3D, die Vorschau des Teils unter dem Cursor
  function spindFigur(c, a, e, name) {
    const f = PK.figur(a), M = KM.figur, b = KM.figurBild.ganz;
    rect(c, f.x, f.y, f.w, f.h, F.figurGrund); rand(c, f.x, f.y, f.w, f.h, F.kachelRand);
    txtSp(c, gross(name) || '…', f.x + 6, f.y + 4, F.platz, 1);
    txt(c, KX.anprobe, f.x + f.w - 6, f.y + 4, F.dim, 'right');
    const r = { x: f.x + (f.w - b.w) / 2, y: f.y + M.nameH, w: b.w, h: b.h }, KB = window.KammerBild, bi = live3d() ? KB.bild(C.spindKarte(), 'ganz', e.yaw) : null;
    if (bi) bildIn(c, bi, r, true);
    else { const t = ((katalog() && katalog().teile) || []).find((x) => x.id === e.platz + '/' + e.karte.outfit[e.platz]); bildIn(c, t && vorschau(t.vorschau), r); }
    const ky = f.y + f.h - M.kappe - M.kappeAbstand;
    kappeDunkel(c, f.x + M.kappeAbstand, ky, 'Q', F.kappe, F.kappeText); kappeDunkel(c, f.x + f.w - M.kappeAbstand - 13, ky, 'E', F.kappe, F.kappeText);
    txt(c, KX.drehen, f.x + f.w / 2, ky + 3, F.dim, 'center');
  }
  function spindZeichne(c, view) {
    aktuellView = view;
    F = PK.farben(P.skinId(view));
    const e = C.lies().sitzung.entwurf;
    const spind = e && e.modus === 'spind' ? e : null;
    P.rahmen(c, view, { titel: KX.saeule.spind, S: KM.S, station: 'spind', anzeige: (cc, a) => {
      const T = KM.kachel;
      if (!spind) { txt(cc, TEXT.spind.nichtBereit, a.x + T.x, a.y + T.y + 4, F.dim); return; }
      const eintraege = spindEintraege(spind), wahl = C.spindWahlIndex(spind.platz), frei = eintraege.filter((t) => t.herkunft === 'frei').length;
      P.titel(cc, a.x + T.x, a.y + T.y, KM.figur.x - T.x - 12, PK.text(KX.kachelTitel.spind, { platz: gross(KT.PLATZ[spind.platz].name), n: frei }), 'nav');
      PK.kacheln(a, eintraege.length).forEach((r, i) => { kachel(cc, r, eintraege[i], { cursor: i === wahl, getragen: eintraege[i].getragen }); klickFlaeche(r, eintraege[i].name, () => C.spindSetzeWahl(spind.platz, i)); });
      const hinweis = spind.hinweis === 'angezogen' ? { text: TEXT.spind.angezogen, farbe: F.abschluss } : spind.hinweis === 'gesperrt' ? { text: TEXT.spind.gesperrt, farbe: FN.warn } : { text: live3d() ? KX.hinweis.spind : TEXT.spind.ohne3d, farbe: F.dim };
      txt(cc, hinweis.text, a.x + T.x, a.y + a.h - T.hinweisUnten, hinweis.farbe);
      spindFigur(cc, a, spind, C.aktiverName());
    } });
    if (spind) ziffernblock(c, 'spind', spind.platz, KX.spalte.platz);
    const p = PK.rahmen().pult, S = KM.spalten.mitte, G = KM.gesperrt.kappe;
    let y = P.titel(c, p.x + S.x, p.y, S.w, KX.spalte.herkunft, 'cmd') + 2;
    txt(c, KX.herkunftLegende.frei, p.x + S.x + G.w + 5, y + 2, F.text); y += 17;
    [['H', KX.herkunftLegende.haendler], ['F', KX.herkunftLegende.fund]].forEach(([kz, t]) => {
      P.cham(c, p.x + S.x, y, G.w, G.h, F.gesperrtKappe, G.schraeg, 0, G.schraeg, 0); txt(c, kz, p.x + S.x + G.w / 2, y + 3, F.gesperrtKappeText, 'center');
      txt(c, t, p.x + S.x + G.w + 5, y + 2, F.dim); y += 17;
    });
    spalteAbschluss(c, KX.spalte.umziehen, [
      { taste: 'R', aktion: 'charakter.spind.zuruecksetzen', text: KX.knopf.zuruecksetzen, klick: () => C.spindZuruecksetzen() },
      { taste: 'Enter', aktion: 'charakter.uebernehmen', text: KX.knopf.anziehen, haupt: true, gesperrt: !spind, klick: () => C.speichereOutfit() },
    ]);
    P.zeichneHilfe(c);
    R.drawTooltip(c);
  }
  // true = Taste verbraucht. Esc und ? behandelt consoles.js (Pult-Station); hier nur Platz, Teil, Drehen, Zurücksetzen, Anziehen.
  function spindTaste(e, view) {
    const code = e.code, pfeil = code.indexOf('Arrow') === 0;
    if (e.repeat && !pfeil) return true;
    const en = C.lies().sitzung.entwurf;
    if (!en || en.modus !== 'spind') return true;
    const sp = KM.kachel.spalten;
    if (code === 'ArrowLeft' || code === 'KeyA') { C.spindBlaettere(-1); return true; }
    if (code === 'ArrowRight' || code === 'KeyD') { C.spindBlaettere(1); return true; }
    if (code === 'ArrowUp' || code === 'KeyW') { C.spindZeile(-1, sp); return true; }
    if (code === 'ArrowDown' || code === 'KeyS') { C.spindZeile(1, sp); return true; }
    if (passt(e, 'charakter.uebernehmen')) { C.speichereOutfit(); return true; }
    if (passt(e, 'charakter.spind.zuruecksetzen')) { C.spindZuruecksetzen(); return true; }
    if (passt(e, 'charakter.spind.drehenLinks')) { C.dreheFigur(-1); return true; }
    if (passt(e, 'charakter.spind.drehenRechts')) { C.dreheFigur(1); return true; }
    for (const platz of C.OUTFIT_PLAETZE) if (passt(e, AKTION_SPIND[platz])) { C.spindWaehlePlatz(platz); return true; }
    return true;
  }

  // ---------------------------------------------------------------- Zeichnen und Tasten
  function zeichne(c, view) {
    const s = C.lies().sitzung;
    aktuellView = view;
    F = PK.farben(P.skinId(null));
    R.ui.buttons.length = 0; R.ui.tooltip = null;
    if (s.seite === 'erstellung') erstellungZeichnen(c, view); else listeZeichnen(c, view);
    P.zeichneHilfe(c);
    R.drawTooltip(c);
  }

  const passt = (e, id) => !!(window.Tasten && Tasten.passt(e, id));
  function tasteListe(e) {
    const s = C.lies().sitzung, code = e.code;
    if (passt(e, 'allgemein.verlassen')) { if (s.loeschFrage) C.loeschenAbbrechen(); else zurueck(); return; }
    if (code === 'ArrowLeft' || code === 'KeyA') { C.bewegeCursor(-1); return; }
    if (code === 'ArrowRight' || code === 'KeyD') { C.bewegeCursor(1); return; }
    const d = /^(?:Digit|Numpad)([1-4])$/.exec(code);
    if (d) { C.setzeCursor(+d[1] - 1); return; }
    if (passt(e, 'charakter.uebernehmen')) { uebernehmen(); return; }
    if (passt(e, 'charakter.neu')) { C.neuAnlegen(); return; }
    if (passt(e, 'charakter.umbenennen')) { C.beginneUmbenennen(); return; }
    if (passt(e, 'charakter.loeschen')) { C.loeschenAnfrage(); return; }
  }
  function tasteErstellung(e) {
    const s = C.lies().sitzung, en = s.entwurf, code = e.code;
    if (!en) return;
    if (en.nameEdit) {   // Schreibmodus: alles, was ein Zeichen ist, geht ins Namensfeld (auch Ziffern und Q/E/R)
      if (code === 'Enter' || code === 'NumpadEnter') { C.nameBestaetigen(); return; }
      if (passt(e, 'charakter.umbenennen')) { C.nameFertig(); return; }
      if (code === 'Escape') { C.nameAbbrechen(); return; }
      if (code === 'Backspace') { C.nameLoeschen(); return; }
      if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) C.nameZeichen(e.key);
      return;
    }
    if (passt(e, 'allgemein.verlassen')) { C.verwirfEntwurf(); return; }
    if (passt(e, 'charakter.uebernehmen')) { C.speichereEntwurf(); return; }
    if (passt(e, 'charakter.umbenennen')) { C.nameBearbeiten(true); return; }
    if (passt(e, 'charakter.zuruecksetzen')) { C.zuruecksetzen(); return; }
    if (passt(e, 'charakter.drehenLinks')) { C.dreheFigur(-1); return; }
    if (passt(e, 'charakter.drehenRechts')) { C.dreheFigur(1); return; }
    if (en.modus !== 'neu') return;
    if (code === 'ArrowLeft' || code === 'KeyA') { C.blaettere(-1); return; }
    if (code === 'ArrowRight' || code === 'KeyD') { C.blaettere(1); return; }
    if (code === 'ArrowUp' || code === 'KeyW') { C.naechsterPlatz(-1); return; }
    if (code === 'ArrowDown' || code === 'KeyS') { C.naechsterPlatz(1); return; }
    for (const platz of C.PLAETZE) if (passt(e, AKTION[platz])) { C.waehlePlatz(platz); return; }
  }
  // true = Taste verbraucht (die Seite ist modal, nichts geht ins Spiel)
  function taste(e) {
    const s = C.lies().sitzung;
    if (!s.seite) return false;
    if (e.repeat && !(s.seite === 'erstellung' && (e.code === 'Backspace' || (e.key && e.key.length === 1) || e.code.indexOf('Arrow') === 0))) { e.preventDefault(); return true; }
    e.preventDefault();
    const edit = s.seite === 'erstellung' && s.entwurf && s.entwurf.nameEdit;
    if (!edit && passt(e, 'allgemein.hilfe')) { P.hilfeUmschalten(); return true; }
    if (P.hilfe && e.code === 'Escape') { P.hilfeUmschalten(); return true; }
    if (s.seite === 'erstellung') tasteErstellung(e); else tasteListe(e);
    return true;
  }

  window.KammerUi = { TEXT, zeichne, taste, spindZeichne, spindTaste, offen: () => !!C.lies().sitzung.seite };
})();
