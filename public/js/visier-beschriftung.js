// KUL-03 B2: Beschriftung und Randpfeile des Visiers (Schicht 'beschriftung', Rang 15: über den Objekten aus visier-objekte.js, unter Leiste und Lagescheibe).
// Setzt Marken (Gegner), Schilder (Station, Dock-Ring, Sprungboje, Navboje, ZIEL) und Randpfeile in Rangfolge (Tokens VISIER.objekt.beschriftung.rang) auf freie Flächen:
// Rechteck-Kollision gegen schon Gesetztes und gegen gesperrte Flächen (Leiste, Lagescheibe, Sprungziel-Tafel, Szenenzeile, oben links), Ausweichen in 6-px-Schritten
// (Marken, Namen nach oben; ZIEL und DOCK-RING nach unten; dann seitlich neben den Anker, zuletzt die Gegenrichtung = über das eigene Objekt; beides nur für Schilder ab Rang Station, Marken und Navbojen entfallen stattdessen), höchstens `versuche` je Richtung, dann weglassen. Führungslinie ab 5 px Versatz.
// Deterministisch: gleiche Lage -> gleiches Ergebnis (Ordnung nach Rang, dann Objekt-id; kein Zufall, kein Zustand zwischen den Frames).
// NUR das Ziel der Ops trägt am Gegner Text („ZIEL 256“); alle anderen Gegner nur die Marke. Gegner hinter dem Schiff: weder Text noch Randpfeil (sie stehen in der Lagescheibe).
//   VisierBeschriftung.baue(view, plan, kamera, opt)  reine Lage { items[], pfeile[], sperren[], weggelassen } ohne Zeichnen; null ohne Schiff/Lage. opt: { lage (Standard VisierObjekte.letzte()), szene { x, y, w, h } }
//   VisierBeschriftung.setze(posten, sperren, kamera) das reine Setzen (Rang, Kollision, Ausweichen) für Tests
//   VisierBeschriftung.sperrFlaechen(view, kamera, szene)  gesperrte Rechtecke { name, x0, y0, x1, y1 }
//   VisierBeschriftung.zeichne(ctx, view, plan, kamera)    die Schicht; meldet sich selbst an (Visier.registriereSchicht)
(function (root) {
  'use strict';

  const ok = Number.isFinite;
  const TK = () => root.HauptschirmTokens.TOKENS;
  const VS = () => root.Visier;
  function rgba(hex, a) { const n = parseInt(String(hex).slice(1, 7), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
  let gemeldet = false;
  function melde(e) { if (gemeldet) return; gemeldet = true; try { if (root.Net && root.Net.reportError) root.Net.reportError('VisierBeschriftung', e); } catch (x) { /* egal */ } }

  function breite(str, skala) {   // Pixelbreite der Schrift (Render.measure, sonst 6 px je Zeichen und Skala wie die Pixelschrift)
    str = String(str == null ? '' : str);
    const R = root.Render;
    if (R && R.measure) { try { const w = R.measure(str, skala); if (ok(w)) return w; } catch (e) { /* Näherung */ } }
    return Math.max(0, str.length * 6 - 1) * skala;
  }
  const schnitt = (a, b) => !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);   // berühren zählt als Überlappung
  const imRect = (x, y, r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
  function streckeSchneidet(ax, ay, bx, by, r) {   // Strecke a-b durch das Rechteck (Liang-Barsky)
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dy = by - ay;
    for (const [pp, qq] of [[-dx, ax - r.x0], [dx, r.x1 - ax], [-dy, ay - r.y0], [dy, r.y1 - ay]]) {
      if (pp === 0) { if (qq < 0) return false; continue; }
      const t = qq / pp;
      if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return true;
  }
  function fuehrungVon(it, r, ab) {   // Führungslinie vom Anker zum nächsten Punkt des Schilds, erst ab ab px Versatz
    const qx = Math.max(r.x0, Math.min(r.x1, it.x)), qy = Math.max(r.y0, Math.min(r.y1, it.y));
    return Math.hypot(qx - it.x, qy - it.y) > ab ? { x: qx, y: qy } : null;
  }

  // ------------------------------------------------------------ gesperrte Flächen
  function sperrFlaechen(view, c, szene) {
    const T = TK(), V = T.VISIER, BS = V.objekt.beschriftung, W = c.W, H = c.H, out = [];
    const rect = (name, x, y, w, h, pad) => out.push({ name, x0: x - pad, y0: y - pad, x1: x + w + pad, y1: y + h + pad });
    const LS = V.leiste;
    // Leiste samt Marken am Peilband (Dreieck 6 hoch auf der Kante) und Hochfeld (Tempo, Kurs-Kasten, 27 hoch)
    rect('leiste', 0, H - Math.max(LS.hoehe + LS.marke.h, LS.hochfeld), W, H, 2);
    const LG = root.VisierLage;
    if (LG && LG.flaeche) { const f = LG.flaeche(c); rect('lagescheibe', f.x, f.y, f.w, f.h, 2); }
    else { const g = V.lagescheibe, r = g.radius + g.grund.plus; rect('lagescheibe', W + g.cx - r, H + g.cy - r, 2 * r, 2 * r, 2); }
    const TA = root.HauptschirmTafeln, TF = T.TAFEL;
    let rechts = null;
    try { if (TA && TA.lage) rechts = TA.lage(view, root.VisierLeiste && root.VisierLeiste.tafelOptionen ? root.VisierLeiste.tafelOptionen(szene) : null).rechts; else rechts = { x: W + TF.rechts.x - TF.rechts.w, y: TF.rechts.y, w: TF.rechts.w, h: TF.rechts.h }; } catch (e) { rechts = null; }
    if (rechts) rect('tafelRechts', rechts.x, rechts.y, rechts.w, rechts.h, TF.sperrAbstand);
    if (szene) rect('szene', szene.x, szene.y, szene.w, szene.h, 3);
    const F = BS.freiObenLinks;
    out.push({ name: 'obenLinks', x0: F.x, y0: F.y, x1: F.x + F.w, y1: F.y + F.h });
    for (const q of ringWerte(c)) out.push(Object.assign({ name: 'ringwert', nurSchilder: true }, q));   // Ringwerte (200/400/700): Schilder liegen nie darüber, Marken dürfen
    return out.filter((s) => BS.sperren.includes(s.name) || s.name === 'szene' || s.name === 'obenLinks' || s.name === 'ringwert');
  }
  function ringWerte(c) {   // Rechtecke der Ringbeschriftungen der Glasebene (Lage wie visier.js: bei -34 Grad, 3 px über dem Ring, nur wenn genug über der Leiste)
    const V = TK().VISIER, RG = V.glas.ringe, leisteY = c.H - V.leiste.hoehe, a = RG.wert.winkelGrad * Math.PI / 180, th = 7 * RG.wert.skala, out = [];
    for (const r of RG.welt) {
      const p = VS().projiziere(Math.sin(a) * r, Math.cos(a) * r, 0);
      if (!(p.ok && p.tiefe >= RG.tiefeMin && p.y - RG.wert.ueber - th < leisteY - RG.wert.abstandLeiste)) continue;
      const w = breite(String(r), RG.wert.skala), y = p.y - RG.wert.ueber - th;
      out.push({ x0: Math.round(p.x) - w / 2 - 1, x1: Math.round(p.x) + w / 2 + 1, y0: y - 1, y1: y + th + 1 });
    }
    return out;
  }
  function modellSperren(lage) {   // Bildrechtecke der Schiffe: Schilder stehen nicht auf Modellen (Marken schon: sie sitzen über dem Modell)
    const out = [];
    for (const o of (lage && lage.objekte) || []) if (o.art === 'gegner' && o.bb) out.push({ name: 'modell', nurSchilder: true, x0: o.bb.x0, y0: o.bb.y0, x1: o.bb.x1, y1: o.bb.y1 });
    return out;
  }

  // ------------------------------------------------------------ Setzen (rein)
  // posten: { id, rang, art, w, h, x (Mitte), y (Anker), richtung 'oben'|'unten', ... } oder Randpfeil { pfeil: true, id, rang, w, h, seite, x, y (Wunsch), x0 (Rect-Anfang), yMin }
  // Rückgabe { items (in Setzreihenfolge, mit rect), weggelassen[] }
  function setze(posten, sperren, c) {
    const BS = TK().VISIER.objekt.beschriftung, W = c.W, H = c.H;
    const reihe = posten.slice().sort((a, b) => (b.rang - a.rang) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
    const belegt = sperren.map((s) => ({ x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1, nurSchilder: !!s.nurSchilder }));
    const items = [], weggelassen = [];
    const frei = (r, it) => { for (const b of belegt) if (!(b.nurSchilder && (it.art === 'marke' || it.pfeil)) && schnitt(r, b)) return false; return true; };
    // Führungslinien laufen nie durch fremde Kästen, und kein später gesetzter Kasten liegt auf einer Führungslinie: sonst versucht das Setzen die nächste Lage (seitlich versetzt)
    const fuehrungFrei = (it, r) => {
      const f = it.pfeil ? null : fuehrungVon(it, r, BS.fuehrung.abVersatz);
      for (const g of items) {
        if (f && g.art !== 'marke' && !g.pfeil && !imRect(it.x, it.y, g.rect) && streckeSchneidet(it.x, it.y, f.x, f.y, g.rect)) return false;   // Kasten = Textkasten (Schild), keine Marke
        if (g.fuehrung && it.art !== 'marke' && !it.pfeil && !imRect(g.x, g.y, r) && streckeSchneidet(g.x, g.y, g.fuehrung.x, g.fuehrung.y, r)) return false;
      }
      return true;
    };
    for (const it of reihe) {
      if (!ok(it.x) || !ok(it.y) || !ok(it.w) || !ok(it.h)) { weggelassen.push(it.id); continue; }
      const p = it.pfeil ? -1 : it.richtung === 'unten' ? 1 : -1;
      let r = null, dyGewaehlt = 0;
      const versuch = (dy, dx) => {
        let y0, x0, x1;
        if (it.pfeil) { y0 = it.y - 6 + dy; x0 = it.x0; x1 = it.x0 + it.w; }
        else {
          y0 = (it.richtung === 'unten' ? it.y : it.y - it.h) + dy;
          x0 = it.x - it.w / 2 + (dx || 0); x1 = it.x + it.w / 2 + (dx || 0);
          if (x0 < 2) { x1 += 2 - x0; x0 = 2; } else if (x1 > W - 2) { x0 -= x1 - (W - 2); x1 = W - 2; }   // seitlich im Bild halten
        }
        const q = { x0, y0, x1, y1: y0 + it.h };
        if (q.y0 < (it.yMin != null ? it.yMin : 0) || q.y1 > H || q.x0 < 0 || q.x1 > W) return false;
        if (!frei(q, it) || !fuehrungFrei(it, q)) return false;
        r = q; dyGewaehlt = dy; return true;
      };
      let gesetzt = false;
      for (let k = 0; k <= BS.versuche && !gesetzt; k++) gesetzt = versuch(p * BS.schritt * k);
      // dann seitlich neben den Anker (nur wichtige Schilder ab Rang Station: Navbojen und Marken wandern nicht weit, sie entfallen), rechts vor links, mit bis zu 3 Schritten Höhenversatz
      const wichtig = it.wichtig !== undefined ? it.wichtig : it.rang >= BS.rang.station;
      if (!it.pfeil && wichtig) for (let k = 1; k <= Math.ceil(BS.versuche / 2) && !gesetzt; k++) for (const j of [0, 1, -1, 2, -2, 3, -3]) { if (versuch(p * BS.schritt * j, k * BS.schritt * 2) || versuch(p * BS.schritt * j, -k * BS.schritt * 2)) { gesetzt = true; break; } }
      if (!it.pfeil && wichtig) for (let k = 1; k <= BS.versuche && !gesetzt; k++) gesetzt = versuch(-p * BS.schritt * k);   // Gegenrichtung (z. B. ZIEL nach unten gesperrt -> über das Modell)
      if (!gesetzt) { weggelassen.push(it.id); continue; }
      belegt.push(r);
      const aus = Object.assign({}, it, { rect: r, dy: dyGewaehlt });
      if (!it.pfeil) {
        aus.fuehrung = fuehrungVon(it, r, BS.fuehrung.abVersatz);   // zum nächsten Punkt des Schilds am Anker
      }
      items.push(aus);
    }
    return { items, weggelassen };
  }

  // ------------------------------------------------------------ Lage (rein)
  function sprungName(view) {   // Name des gewählten Sprungziels (wie die Tafel), sonst null
    const TA = root.HauptschirmTafeln;
    try { const d = TA && TA.daten ? TA.daten(view) : null; return d && d.sprung ? d.sprung.name : null; } catch (e) { return null; }
  }
  function kurzName(name, hex) {
    const TA = root.HauptschirmTafeln, max = TK().TEXT.randNameMax;
    if (TA && TA.randLabel) { try { return TA.randLabel(name, hex, null); } catch (e) { /* Rückfall */ } }
    return String(name || '').toUpperCase().slice(0, max);
  }

  function baue(view, L, c, opt) {
    opt = opt || {};
    const st = view && view.state, VO = root.VisierObjekte;
    if (!st || !c || !VS() || !root.HauptschirmTokens) return null;
    let lage = opt.lage !== undefined ? opt.lage : (VO && VO.letzte ? VO.letzte() : null);
    if (!lage && VO && VO.baue) lage = VO.baue(view, L, c);
    const ship = lage && lage.ship;
    if (!ship || !ok(ship.x) || !ok(ship.y) || !ok(ship.angle)) return null;
    const T = TK(), V = T.VISIER, OB = V.objekt, BS = OB.beschriftung, RP = OB.randpfeil, W = c.W, H = c.H, LY = H - V.leiste.hoehe;
    const sperren = sperrFlaechen(view, c, opt.szene || null).concat(modellSperren(lage));
    const alarm = !!(st.ship && st.ship.alert === 'red'), rangDock = alarm ? BS.rangAlarm.dock : BS.rang.dock, rangStation = alarm ? BS.rangAlarm.station : BS.rang.station;   // im Gefecht weichen DOCK-RING und STATION den Gegnermarken
    const leisteOben = Math.min.apply(null, sperren.filter((s) => s.name === 'leiste').map((s) => s.y0).concat([LY]));
    const posten = [];
    const num = (v) => Math.round(v);
    const KH = root.KulisseHimmel, si = KH && KH.sichtVon ? KH.sichtVon(st) : { imSicht: () => true };

    const schild = (id, rang, art, text, farbe, x, y, richtung, sub) => {
      if (!ok(x) || !ok(y)) return;
      let w = breite(text, 2) + BS.pad, h = BS.hoehe;
      if (sub) { w = Math.max(w, breite(sub.text, sub.skala) + BS.pad); h = sub.skala >= 2 ? BS.hoeheMitEntfernung2 : BS.hoeheMitEntfernung; }
      posten.push({ id, rang, art, text, farbe, x, y, w, h, richtung, sub: sub || null, wichtig: art !== 'navboje' });
    };
    const imLage = new Set();
    let hatMarke = false, gewaehlt;   // gewaehlt: gewählte Sprungboje (Tafel-Ziel), einmal je Lage bestimmt

    for (const o of lage.objekte || []) {
      const mitteDraussen = o.art !== 'gegner' && o.p && !(o.p.x >= 0 && o.p.x <= W);   // Mittelpunkt außerhalb des Bildes (nur der Rand ragt herein): kein Schild am Bildrand, dafür der Randpfeil
      if (mitteDraussen) continue;
      if (o.e) imLage.add(o.e); if (o.m) imLage.add(o.m); if (o.j) imLage.add(o.j); if (o.h) imLage.add(o.h);
      if (o.art === 'gegner' && o.bb) {
        const m = VO.marke(o.bb), id = String(o.e.id);
        posten.push({ id: 'marke:' + id, rang: o.ziel ? BS.rang.ziel : BS.rang.marke, art: 'marke', o, x: m.cx, y: m.y1, w: V.objekt.marke.w, h: V.objekt.marke.h, richtung: 'oben', farbe: o.freund ? OB.gegner.freund.farbe : OB.marke.winkel.farbe });
        hatMarke = true;
        if (o.ziel && !o.freund) zielText('ziel:' + id, o.bb, o.entf);
      } else if (o.art === 'verborgen' && o.ziel && o.bb) {
        zielText('ziel:' + o.h.id, o.bb, Math.hypot(o.h.x - ship.x, o.h.y - ship.y));
      } else if (o.art === 'station' && o.hauptziel && o.bb) {
        const S = OB.station.label, nm = String(o.m.name || 'STATION').toUpperCase().slice(0, 18);
        schild('station', rangStation, 'station', nm, S.farbe, (o.bb.x0 + o.bb.x1) / 2, o.bb.y0 - S.abstand, 'oben', { text: String(num(o.entf)), skala: S.entfernungSkala, farbe: S.entfernungFarbe });
      } else if (o.art === 'dock') {
        const D = OB.station.dock, d = Math.hypot(o.m.x - ship.x, o.m.y - ship.y);
        const fern = VS().projiziere(o.p.r, o.p.f + o.R, 0), ringOben = fern.ok ? fern.y : Infinity;   // Oberkante des Rings im Bild: ragt der Ring über die Leiste, bleibt das Label (darüber geklemmt)
        const dy = o.p.y + D.welt * o.p.k * D.label.unter + D.label.abstand;
        schild('dock', rangDock, 'dock', D.label.format.replace('{entfernung}', String(num(d))), D.farbe, o.p.x, ringOben < leisteOben ? Math.min(dy, leisteOben - BS.hoehe - 1) : dy, 'unten', null);   // Ring an der Leiste: Label darüber klemmen statt streichen
      } else if (o.art === 'sprungboje' || o.art === 'navboje') {
        const sprung = o.art === 'sprungboje', B = sprung ? OB.boje.sprung : OB.boje.nav, p = o.p, top = VS().projiziere(p.r, p.f, B.laenge);
        const hw = Math.max(2, p.k * (sprung ? 10 : 6)), hh = hw * 1.4, ax = top.ok ? top.x : p.x, ay = (top.ok ? top.y - hh - 1 : p.y) - B.label.abstand;
        if (sprung) {
          const g = gewaehlteBoje(o.j);
          schild('boje:' + String(o.j.k != null ? o.j.k : num(o.j.x) + ',' + num(o.j.y)), BS.rang.sprungboje, 'sprungboje', g ? g.kurz : 'BOJE' + (o.j.n ? ' ' + o.j.n : ''), B.label.farbe, ax, ay, 'oben',
            { text: String(num(Math.hypot(o.j.x - ship.x, o.j.y - ship.y))), skala: B.label.entfernungSkala, farbe: B.label.entfernungFarbe });
        } else schild('nav:' + num(o.b.x) + ',' + num(o.b.y), BS.rang.nav, 'navboje', B.label.text, B.label.farbe, ax, ay, 'oben', null);
      } else if (o.art === 'sprungfeld') {
        const B = OB.boje.sprung, d = Math.hypot(o.m.x - ship.x, o.m.y - ship.y);
        schild('sprungpunkt:' + num(o.m.x) + ',' + num(o.m.y), BS.rang.sprungboje, 'sprungboje', String(o.m.name || 'SPRUNGPUNKT').toUpperCase().slice(0, 14), B.label.farbe, o.p.x, o.p.y - B.label.abstand, 'oben', { text: String(num(d)), skala: B.label.entfernungSkala, farbe: B.label.entfernungFarbe });
      }
    }
    function zielText(id, bb, entf) {
      const Z = OB.gegner.ziel;
      schild(id, BS.rang.ziel, 'ziel', Z.label.format.replace('{entfernung}', String(num(entf))), Z.farbe, (bb.x0 + bb.x1) / 2, bb.y1 + Z.pad + Z.label.abstand, 'unten', null);
    }
    function gewaehlteBoje(j) {   // die gewählte Sprungboje = die der Tafel und des Peilbands (HauptschirmTafeln.daten(view).sprung ist die Quelle; ohne Anflug keine)
      if (gewaehlt === undefined) {
        gewaehlt = null;
        const TA = root.HauptschirmTafeln;
        let sprung = null;
        try { sprung = TA && TA.daten ? (TA.daten(view) || {}).sprung : null; } catch (e) { sprung = null; }
        if (sprung && sprung.boje != null && sprung.entfernung != null) {
          const jp = Array.isArray(st.space && st.space.jp) ? st.space.jp.filter((b) => b && ok(b.x) && ok(b.y)) : [];
          const b = jp.find((q) => Math.round(Math.hypot(q.x - ship.x, q.y - ship.y)) === sprung.entfernung);
          if (b) gewaehlt = { j: b, kurz: kurzName(sprung.name, b.n) };
        }
      }
      return gewaehlt && gewaehlt.j === j ? gewaehlt : null;
    }

    // Randpfeile: voraus (Z >= hintenWelt), aber nicht im Bild; Gegner hinter dem Schiff nie, auch kein anderes Objekt hinter dem Schiff (dafür gibt es Peilband und Lagescheibe)
    const hz = VS().kamera().horizont, yMin = hz + RP.unterHorizont, yMax = LY - RP.ueberLeiste;
    const pfeil = (id, rang, farbe, wx, wy, text) => {
      if (!ok(wx) || !ok(wy)) return;
      const p = VS().projiziereWelt(ship, wx, wy, 0);
      if (!(p.f >= RP.hintenWelt)) return;
      const seite = p.r < 0 ? -1 : 1, x = seite < 0 ? RP.rand : W - RP.rand;
      const y = ok(p.y) ? Math.max(yMin, Math.min(yMax, Math.round(p.y))) : yMax;
      let w = 14, x0 = x - 7;
      if (text) {
        const tw = breite(text, RP.label.skala);
        w = Math.max(14, tw + RP.label.dx + 7);
        x0 = seite < 0 ? x - 7 : x + 7 - w;
      }
      posten.push({ pfeil: true, id, rang, art: 'pfeil', farbe, seite, x, y, x0, w, h: text ? 6 + RP.label.dy + 7 * RP.label.skala : 12, text: text || null, yMin: yMin - 6 });
    };
    const zielObj = lage.ziel;
    for (const e of view.enemies || []) {
      if (!e || imLage.has(e) || !ok(e.x) || !ok(e.y) || !si.imSicht(e, 0)) continue;
      const istZiel = !!(zielObj && !zielObj.hidden && !zielObj.station && zielObj.id === e.id);
      pfeil('gegner:' + e.id, istZiel ? BS.rang.ziel : BS.rang.marke, istZiel ? OB.gegner.ziel.farbe : RP.farbe, e.x, e.y,
        istZiel ? 'ZIEL ' + num(Math.hypot(e.x - ship.x, e.y - ship.y)) : null);   // nurZielText: andere Gegner nur der Pfeil
    }
    if (zielObj && zielObj.hidden && !zielObj.station && ok(zielObj.x) && ok(zielObj.y) && !imLage.has((st.space && st.space.hidden || []).find((h) => h && h.id === zielObj.id)))
      pfeil('verborgen:' + zielObj.id, BS.rang.ziel, OB.gegner.ziel.farbe, zielObj.x, zielObj.y, 'ZIEL ' + num(Math.hypot(zielObj.x - ship.x, zielObj.y - ship.y)));
    const sp = st.space || {}, STATION = { station: 1, buoy: 1, vaelen: 1, wreck: 1, relay: 1 };
    for (const m of Array.isArray(sp.markers) ? sp.markers : []) {
      if (!m || !ok(m.x) || !ok(m.y) || imLage.has(m)) continue;
      const d = num(Math.hypot(m.x - ship.x, m.y - ship.y));
      if (STATION[m.kind] && !m.posten) pfeil('station', rangStation, OB.station.label.farbe, m.x, m.y, String(m.name || 'STATION').toUpperCase().slice(0, T.TEXT.randNameMax) + ' ' + d);
      else if (m.kind === 'exit') pfeil('sprungpunkt:' + num(m.x) + ',' + num(m.y), BS.rang.sprungboje, OB.boje.sprung.label.farbe, m.x, m.y, String(m.name || 'SPRUNG').toUpperCase().slice(0, T.TEXT.randNameMax) + ' ' + d);
    }
    for (const j of Array.isArray(sp.jp) ? sp.jp : []) {   // nur die gewählte Sprungboje (wie die klassische Frontsicht), sonst zu viele Pfeile
      if (!j || !ok(j.x) || !ok(j.y) || imLage.has(j)) continue;
      const g = gewaehlteBoje(j);
      if (g) pfeil('boje:' + String(j.k != null ? j.k : num(j.x) + ',' + num(j.y)), BS.rang.sprungboje, OB.boje.sprung.label.farbe, j.x, j.y, g.kurz + ' ' + num(Math.hypot(j.x - ship.x, j.y - ship.y)));
    }

    const erg = setze(posten, sperren, c);
    return { items: erg.items.filter((i) => !i.pfeil), pfeile: erg.items.filter((i) => i.pfeil), sperren, weggelassen: erg.weggelassen, hatMarke };
  }

  // ------------------------------------------------------------ Zeichnen
  function textMitte(ctx, text, cx, y, farbe, skala) { const R = root.Render; if (R && R.textKontur) R.textKontur(ctx, text, Math.round(cx), Math.round(y), { color: farbe, align: 'center', scale: skala }); }

  function zeichne(ctx, view, L, c) {
    const TKS = root.HauptschirmTokens && root.HauptschirmTokens.TOKENS;
    if (!ctx || !TKS || !TKS.VISIER || !c) return;
    const V = TKS.VISIER, OB = V.objekt, BS = OB.beschriftung, RP = OB.randpfeil, VO = root.VisierObjekte;
    let szene = null;
    try {
      const H = root.Hud;
      if (H && H.szeneVon && H.szeneVon(view)) { const w = H.drawSzenenStrip(ctx, view, 6, { measure: true }); if (w > 0) szene = { x: Math.round((c.W - w) / 2), y: 6, w, h: H.szenenHoehe(view) }; }
    } catch (e) { szene = null; }
    const P = baue(view, L, c, { szene });
    if (!P) return;
    for (const it of P.items) {   // Führungslinien zuerst
      if (!it.fuehrung) continue;
      ctx.strokeStyle = rgba(it.art === 'marke' ? OB.marke.winkel.farbe : it.farbe, BS.fuehrung.alpha); ctx.lineWidth = BS.fuehrung.breite; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(Math.round(it.x) + 0.5, it.y); ctx.lineTo(Math.round(it.fuehrung.x) + 0.5, it.fuehrung.y); ctx.stroke();
    }
    for (const it of P.items) {
      const r = it.rect, cx = (r.x0 + r.x1) / 2;
      try {
        if (it.art === 'marke') VO.markeAn(ctx, it.o, cx, r.y0);
        else {
          textMitte(ctx, it.text, cx, r.y0 + 1, it.farbe, 2);
          if (it.sub) textMitte(ctx, it.sub.text, cx, r.y0 + 16, it.sub.farbe, it.sub.skala);
        }
      } catch (e) { melde(e); }
    }
    for (const a of P.pfeile) {
      try {
        const s = a.seite;
        ctx.save(); ctx.translate(a.x, Math.round(a.y + a.dy));
        ctx.beginPath(); RP.form.forEach((q, i) => { if (i) ctx.lineTo(q[0] * s, q[1]); else ctx.moveTo(q[0] * s, q[1]); }); ctx.closePath();
        ctx.fillStyle = a.farbe; ctx.fill(); ctx.strokeStyle = TKS.PAL.space; ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();
        if (a.text) {
          const R = root.Render, y = Math.round(a.y + a.dy) + RP.label.dy, tw = breite(a.text, RP.label.skala);
          if (R && R.textKontur) R.textKontur(ctx, a.text, Math.round(s < 0 ? a.x + RP.label.dx : a.x - RP.label.dx - tw), y, { color: a.farbe, align: 'left', scale: RP.label.skala });
        }
      } catch (e) { melde(e); }
    }
  }

  const API = { baue, setze, sperrFlaechen, zeichne, breite };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.VisierBeschriftung = API;
  if (root.Visier && root.Visier.registriereSchicht) root.Visier.registriereSchicht('beschriftung', 15, zeichne);
})(typeof window !== 'undefined' ? window : globalThis);
