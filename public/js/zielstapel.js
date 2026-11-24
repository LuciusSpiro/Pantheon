// SPT-02 6 „Scan-Anzeige Stapel“ (Kai 2026-11-24, Richtung B): die Systeme des gescannten Gegners im Zielkasten als Symbole statt Kürzel (WBg, ESt, Antr …).
// Globales `Zielstapel`, in Node als Modul (Test). Reine Zeichen- und Namenslogik, kein Zustand, keine Netzzugriffe, keine Regeln über Schaden oder Zugriff:
// Zustand, Prozent und Wahl kommen vom Server (Zonenkreuz.modellZiel), die Art eines Systems aus content/kampf/gegner-systeme.json, die Waffe je Platz aus target.weapons.
//   Zielstapel.info(d, target)          Beschreibung eines Systems: { maske, art, farbe, nr, kurzName (Knopf), langName (Tooltip) }
//   Zielstapel.gruppiere(list, target)  gleiche Arten einer Seite zu einer Zeile: [{ maske, info, es }] (Reihenfolge der Systeme)
//   Zielstapel.inhalt(target, opt)      Zeilen-Funktion für Zonenkreuz.zeichne (Parameter inhalt): Symbol, Zahl bei mehreren, je Einheit ein Balkenstück;
//                                        opt.symbol(c, maske, mx, my, farbe) zeichnet das Symbol (Mitte), opt.zellen sammelt die Flächen für den Tooltip
//   Zielstapel.tooltipText(info, e)     „Batterie · Steuerbord 2“ + Zeilenumbruch + „beschädigt · 40 %“ (nur hier steht der Prozentwert)
//   Zielstapel.tooltipSetzen(R, zellen) setzt R.ui.tooltip für die Fläche unter der Maus
//   Zielstapel.symbolZeichnen(c, maske, mx, my, farbe)   Waffe über SchiffsUI, alle anderen Arten über PultTerminal.symbolModul
// Darstellung (Mockup vault/Pantheon/Mockups/SPT-02-C/b-stapel.html): Zerstört = Kreuz über dem Symbol und 1-px-Strich in Rot (Form, nicht nur Farbe); Systemziel = Rahmen um das
// Balkenstück plus Marke an der Zeile; nicht wählbare Zeilen gedimmt; passt nicht alles, steht „+n“ unten links. Farben aus PultSysteme.TOKENS, Maße aus MASS.stapel.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Zielstapel = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const req = (p) => (typeof require === 'function' ? require(p) : null);
  const PS = root.PultSysteme || req('./pult-systeme-tokens.js');
  const SCH = root.Shared_Schiffskatalog || req('../../shared/schiffskatalog.js');
  const TOK = PS.TOKENS, FN = TOK.FN, TEXT = TOK.TEXT, MASS = TOK.MASS.stapel;
  const fmt = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
  const WAFFEN_VORSATZ = /^Standard/;   // Standardkanone / Standardbatterie heißen im Zielkasten Kanone / Batterie (wie das Katalogsymbol der Ops-Waffenzellen)

  // ---------------------------------------------------------------- Art -> Symbolmaske und Funktionsfarbe
  // Maske: 'waffe:<Katalog-Id>' (Symbol über SchiffsUI.drawWaffe) oder eine Id aus PultTerminal.SYMBOLE_MODUL (emitter, antrieb, reaktor, schildgenerator, frachtraum …)
  const ART_MASKE = { emitter: 'emitter', antrieb: 'antrieb', reaktor: 'reaktor', schildgenerator: 'schildgenerator' };
  const ART_FARBE = { waffe: FN.weapon, emitter: FN.shield, schildgenerator: FN.shield, reaktor: FN.shield, antrieb: FN.drive, modul: FN.neutral };
  // Katalog-Id der Waffe am Platz des Ziels: target.weapons = [{ platz, typ }]; fehlt die Angabe (Jäger ohne Plätze), gilt die Standardwaffe des Platzes (Bug: Kanone, Seite: Batterie)
  function waffeId(d, target) {
    const echt = d.platzName != null ? d.platzName : d.platz != null ? d.platz : null, platz = echt != null ? echt : 'bug';
    const wp = echt != null ? ((target && target.weapons) || []).find((w) => w && w.platz === echt) : null;
    const eintrag = SCH && SCH.eintragVon ? (wp && wp.typ && SCH.eintragVon(wp.typ, platz)) || SCH.eintragVon('batterie', platz) : null;
    return eintrag ? eintrag.id : 'standardkanone';
  }
  function info(d, target) {
    const art = d.art || 'reaktor', zone = d.zone || 'mitte';
    let maske, art0;
    if (art === 'waffe') { const id = waffeId(d, target); maske = 'waffe:' + id; art0 = id; }
    else if (art === 'modul') { maske = d.modul || 'reaktor'; art0 = null; }
    else { maske = ART_MASKE[art] || 'reaktor'; art0 = null; }
    const nr = (/(\d)$/.exec(d.kurz || '') || [])[1] || '';
    let name;
    if (art === 'waffe') { const w = SCH && SCH.BY_ID && SCH.BY_ID[art0]; name = w ? String(w.name).replace(WAFFEN_VORSATZ, '').replace(/^./, (ch) => ch.toUpperCase()) : 'Waffe'; }
    else if (art === 'emitter') name = TEXT.stapel.emitter;
    else name = String(d.name || art);
    const seite = art !== 'antrieb' && zone !== 'mitte';
    const zk = TEXT.seiteKurz, zl = TEXT.zoneLang;
    return { d, art, maske, nr, farbe: ART_FARBE[art] || FN.neutral, name,
      kurzName: name + (seite ? ' ' + zk[zone] + (nr ? ' ' + nr : '') : ''),
      langName: name + (seite ? ' · ' + zl[zone] + (nr ? ' ' + nr : '') : '') };
  }
  // Zustand als Wort für den Tooltip (Prozent nur hier)
  const sehrBesch = (e) => e.zust === 'besch' || e.pct <= 50;
  function zustandText(e) {
    const Z = TEXT.stapel.zustand;
    if (e.zust === 'zer') return Z.zer;
    if (e.zust === 'offline') return Z.offline;
    return fmt(sehrBesch(e) ? Z.besch : Z.ok, { p: e.pct });
  }
  const tooltipText = (inf, e) => inf.langName + '\n' + zustandText(e);

  // ---------------------------------------------------------------- Gruppen und Fluss
  // Gleiche Arten einer Seite (gleiche Maske) fallen in eine Zeile; die Reihenfolge ist die der Systeme
  function gruppiere(list, target) {
    const gruppen = [];
    list.forEach((e) => { const I = info(e, target); let g = gruppen.find((q) => q.maske === I.maske); if (!g) gruppen.push(g = { maske: I.maske, info: I, es: [] }); g.es.push(e); });
    return gruppen;
  }
  // Verteilt n Zeilen der Höhe lh auf so viele Spalten, wie die Höhe verlangt (die Mitte des Kreuzers hat fünf Arten), höchstens so viele, wie die Breite zulässt (Spalte mind.
  // MASS.stapel.spalteMin); was dann nicht passt, fällt in „+n“ (das Mockup ließ die Spalten unbegrenzt wachsen: ein „+n“ war dort nie erreichbar)
  function fluss(n, body, lh, frei) {
    const rows = Math.max(1, Math.floor((frei - 4 + 1) / lh)), breit = body.w - 4 + 2, maxCols = Math.max(1, Math.floor(breit / MASS.spalteMin));
    const cols = Math.min(maxCols, Math.max(1, Math.ceil(n / rows)));
    return { rows, cols, colW: Math.floor(breit / cols), cap: rows * cols };
  }

  // ---------------------------------------------------------------- Zeichnen
  // Symbol (Mitte mx/my, 12×12): Waffe über SchiffsUI, die übrigen Arten über PultTerminal.symbolModul
  function symbolZeichnen(c, maske, mx, my, farbe) {
    if (maske.indexOf('waffe:') === 0) { const UI = root.SchiffsUI; return !!(UI && UI.drawWaffe(c, maske.slice(6), mx, my, { color: farbe })); }
    const PT = root.PultTerminal; return !!(PT && PT.symbolModul(c, maske, mx, my, { color: farbe }));
  }
  // Kreuz über dem Symbol (10×10 Diagonalen): „zerstört“ als Form
  function kreuzUeber(c, x, y, col) { c.fillStyle = col; for (let i = 0; i < 10; i++) { c.fillRect(x + 1 + i, y + 1 + i, 1, 1); c.fillRect(x + 10 - i, y + 1 + i, 1, 1); } }
  // Balkenstück einer Einheit: Spur, Anteil in Zustandsfarbe; zerstört = 1-px-Strich in Rot
  function miniBalken(c, F, rc, x, y, w, h, e) {
    if (e.zust === 'zer') { rc(x, y + h - 1, w, 1, F.zer); return; }
    rc(x, y, w, h, F.pipLeer); rc(x, y, Math.max(1, Math.round(w * Math.min(100, e.pct) / 100)), h, sehrBesch(e) ? F.besch : F.ok);
  }
  // Zeilen-Funktion für Zonenkreuz.zeichne (Parameter inhalt). opt: { symbol (Standard symbolZeichnen), zellen (Array für den Tooltip) }
  function inhalt(target, opt) {
    opt = opt || {};
    const symbol = opt.symbol || symbolZeichnen;
    return function (list, body, zn, zu, leerWort, api) {
      const c = api.c, F = api.F, rc = api.rc, rand = api.rand, o = api.o, lh = MASS.zeile, S = MASS.symbol;
      const gruppen = gruppiere(list, target);
      const f = fluss(gruppen.length, body, lh, body.h - (leerWort ? 10 : 0));
      gruppen.slice(0, f.cap).forEach((g, k) => {
        const col = Math.floor(k / f.rows), row = k % f.rows;
        const x = body.x + 2 + col * f.colW, y = body.y + 3 + row * lh, w = f.colW - 2;
        const selE = g.es.find((e) => e.id === o.selId);
        if (selE) { rc(x - 1, y - 2, w + 1, lh - 1, F.systemzielZeile); rc(x - 1, y - 2, MASS.rand, lh - 1, F.systemziel); }
        const alleZer = g.es.every((e) => e.zust === 'zer'), dim = (zu || g.es.every((e) => e.hinter)) && !selE && !alleZer;
        if (dim) c.globalAlpha = 0.6;
        symbol(c, g.maske, x + 1 + S / 2, y - 1 + S / 2, alleZer ? F.stapelZer : g.info.farbe);
        if (alleZer) kreuzUeber(c, x + 1, y - 1, F.zerText);
        let bx = x + 15;
        if (g.es.length > 1) { api.txt(g.es.length, bx, y + 1, F.text); bx += api.tw(String(g.es.length)) + 2; }
        // Balkenstücke: je Einheit eines, Breite aus der Restbreite
        const n = g.es.length, sw = Math.max(MASS.balkenMin, Math.floor((x + w - bx - (n - 1)) / n));
        g.es.forEach((e, i) => {
          const sx = bx + i * (sw + 1);
          miniBalken(c, F, rc, sx, y + 2, sw, MASS.balkenH, e);
          if (e.id === o.selId) rand(sx - 1, y + 1, sw + 2, MASS.balkenH + 2, F.systemziel);
          if (opt.zellen) opt.zellen.push({ x: sx - 1, y: y - 2, w: sw + 2, h: lh - 1, e, info: info(e, target) });
        });
        c.globalAlpha = 1;
      });
      if (gruppen.length > f.cap) api.txt('+' + (gruppen.length - f.cap), body.x + 4, body.y + body.h - 10, F.dim);
    };
  }
  // Tooltip der Fläche unter der Maus (R.ui.mouse); Zeilenumbruch im Text, Anzeige in Render.drawTooltip
  function tooltipSetzen(R, zellen) {
    const m = R && R.ui && R.ui.mouse; if (!m || !zellen) return null;
    const z = zellen.find((q) => m.x >= q.x && m.y >= q.y && m.x < q.x + q.w && m.y < q.y + q.h);
    if (!z) return null;
    R.ui.tooltip = { text: tooltipText(z.info, z.e), x: m.x, y: m.y };
    return z;
  }
  return { info, gruppiere, fluss, inhalt, tooltipText, zustandText, tooltipSetzen, symbolZeichnen, kreuzUeber, ART_MASKE, ART_FARBE };
});
