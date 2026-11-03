// KUL-02 D2: Ecktafeln des klassischen Hauptschirms (Richtung A „Tiefe“, KUL-01). Links Kurs und Tempo/Schub (Bernstein), rechts das Sprungziel (Messing); die Mitte oben bleibt frei für die
// Szenenzeile. Nur Zeichnen: liest den Snapshot (ship.angle, speed, helm, jump; space.jp) und die Tokens (HauptschirmTokens.TOKENS.TAFEL / TEXT / FARBE), kennt kein Spielwissen.
// Aufruf: sitz.js (Zeichner 'klassisch') NACH Render.drawFrontView, damit die Tafeln über allem liegen. Die Sperrflächen gibt derselbe Zeichner als rect.sperren an drawFrontView,
// damit Randpfeile und Labels den Tafeln ausweichen (drawSpace cfg.sperren). Keine Hülle auf dem Hauptschirm (die bleibt am Pult).
//   HauptschirmTafeln.lage(view, opt)       { links, rechts|null, versetzt } Rechtecke in Texturpixeln; opt = { szeneBreite, szeneUnten } (Szenenzeile: Breite der Zeile, Unterkante samt Luft; 0 ohne Szene)
//   HauptschirmTafeln.sperren(view, opt)    Sperrflächen für Randpfeile und Labels (Tafeln + sperrAbstand), [] wenn nichts da ist
//   HauptschirmTafeln.zeichne(ctx, view, opt)  zeichnet die Tafeln; wirft nie (fehlende Daten: Strich statt Wert)
//   HauptschirmTafeln.daten(view)           die angezeigten Werte als Zahlen/Texte (Tests): { kurs, tempo, stufe, stufen, sprung: null | { name, boje, entfernung, peil, charge, ready, laedt } }
// Rechte Tafel ohne Sprungziel: sie ENTFÄLLT (kein „KEIN SPRUNGZIEL“): 170 × 64 Pixel Dauerfläche für „nichts“ wären in jedem Gefecht, im Tutorial und in jeder Mission ohne Sprung verlorener Platz;
// sobald der Captain ein Ziel wählt, erscheint die Tafel (das ist die Rückmeldung).
// Die Namen, Maße und Farben stehen alle in HauptschirmTokens (TAFEL, TEXT, FARBE, EIGEN); hier nur Zeichencode.
(function (root) {
  'use strict';

  const ok = Number.isFinite;
  const num = (v, d) => (typeof v === 'number' && ok(v) ? v : (d == null ? 0 : d));
  const T = () => root.HauptschirmTokens.TOKENS;
  const Rd = () => root.Render;
  function rgba(hex, a) { const n = parseInt(String(hex).slice(1, 7), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
  let gemeldet = false;
  function melde(e) { if (gemeldet) return; gemeldet = true; try { if (root.Net && root.Net.reportError) root.Net.reportError('HauptschirmTafeln', e); } catch (x) { /* egal */ } }

  // ------------------------------------------------------------ Daten (rein, aus dem Snapshot)
  function kompassGrad(ang) {
    const P = root.Shared_Physics;
    if (P && typeof P.kompassGrad === 'function') return P.kompassGrad(ang);
    return ((Math.round(ang * 180 / Math.PI + 90) % 360) + 360) % 360;
  }
  // Sprungziel: Name wie hud.js drawJumpLine (Render.locName), Boje des Ziels (jump.jp, sonst Zielhex, sonst die nächste), Entfernung aus den Positionen
  function zielHex(dest) {
    const s = String(dest);
    if (s.indexOf('leer-') === 0) return s.slice(5);
    if (/^\d{4}$/.test(s)) return s;
    try { const SS = root.Shared_Sektoren; return (SS && SS.hexVonOrt && SS.hexVonOrt(s)) || null; } catch (e) { return null; }
  }
  function sprungVon(view) {
    const st = view && view.state, ship = st && st.ship, j = ship && ship.jump;
    if (!j || !j.dest) return null;
    const R = Rd();
    let name = String(j.dest);
    try { if (R && R.locName) name = String(R.locName(st, j.dest)); } catch (e) { /* Kennung bleibt */ }
    const out = { name: name.toUpperCase(), boje: null, entfernung: null, peil: null, charge: Math.max(0, Math.min(1, num(j.charge))), ready: !!j.ready };
    out.laedt = out.charge > 0 && !out.ready;
    const jp = (st.space && Array.isArray(st.space.jp) ? st.space.jp : []).filter((b) => b && ok(b.x) && ok(b.y));
    if (j.anflug === true && jp.length && ok(ship.x) && ok(ship.y)) {   // Boje nur, wo sie angeflogen werden muss (Tutorial: Faltsprung von überall)
      const zh = zielHex(j.dest);
      let b = jp.find((q) => j.jp != null && q.k === j.jp) || jp.find((q) => zh && q.n === zh);
      if (!b) { let bd = Infinity; for (const q of jp) { const d = Math.hypot(q.x - ship.x, q.y - ship.y); if (d < bd) { bd = d; b = q; } } }
      out.boje = 'BOJE';
      out.entfernung = Math.round(Math.hypot(b.x - ship.x, b.y - ship.y));
      const p = Math.atan2(b.y - ship.y, b.x - ship.x) - num(ship.angle) - Math.PI / 2;   // Bug oben: Weltrichtung − Kurs − 90°
      out.peil = Math.atan2(Math.sin(p), Math.cos(p));   // nach (−π, π]
    }
    return out;
  }
  function daten(view) {
    const st = view && view.state, ship = (st && st.ship) || {};
    const C = root.Consoles;
    let hi = null;
    try { hi = C && C.helmInfo ? C.helmInfo(ship) : null; } catch (e) { hi = null; }
    const stufen = hi && Array.isArray(hi.stages) ? hi.stages : [];
    const stage = hi && ok(hi.stage) ? hi.stage : -1;
    return {
      kurs: ok(ship.angle) ? kompassGrad(ship.angle) : null,
      tempo: ok(ship.speed) ? Math.round(ship.speed) : null,
      stufe: hi && hi.names && hi.names[stage] != null ? String(hi.names[stage]) : null,
      stufen: { n: stufen.length, stage, stop: hi ? hi.stop : -1, werte: stufen },
      sprung: sprungVon(view),
    };
  }

  // ------------------------------------------------------------ Lage
  function lage(view, opt) {
    const TK = T(), TF = TK.TAFEL, W = TK.SCHIRM.w, H = TK.SCHIRM.h;
    const links = { x: TF.links.x, y: TF.links.y, w: TF.links.w, h: TF.links.h };
    const hatZiel = !!(view && view.state && view.state.ship && view.state.ship.jump && view.state.ship.jump.dest);
    const rechts = hatZiel ? { x: W + TF.rechts.x - TF.rechts.w, y: TF.rechts.y, w: TF.rechts.w, h: TF.rechts.h } : null;
    let versetzt = false;
    const sw = num(opt && opt.szeneBreite), su = num(opt && opt.szeneUnten);
    if (sw > 0 && su > 0) {   // die Szenenzeile (mittig, oben) passt nicht zwischen die Tafeln: beide rücken unter die Zeile
      const x0 = Math.round((W - sw) / 2), x1 = x0 + sw;
      const kollidiert = x0 < links.x + links.w + TF.rand || (rechts && x1 > rechts.x - TF.rand);
      if (kollidiert) {
        versetzt = true;
        links.y = Math.max(links.y, su);
        if (rechts) rechts.y = Math.max(rechts.y, su);
        if (links.y + links.h > H) links.y = H - links.h;
        if (rechts && rechts.y + rechts.h > H) rechts.y = H - rechts.h;
      }
    }
    return { links, rechts, versetzt };
  }
  function sperren(view, opt) {
    const a = T().TAFEL.sperrAbstand, L = lage(view, opt), out = [];
    for (const q of [L.links, L.rechts]) if (q) out.push({ x: q.x - a, y: q.y - a, w: q.w + 2 * a, h: q.h + 2 * a });
    return out;
  }

  // ------------------------------------------------------------ Zeichnen
  function poly(ctx, pts, farbe) {
    ctx.fillStyle = farbe; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath(); ctx.fill();
  }
  // Rom-Skin: Grund 86 %, Farbstreifen oben und an der Außenkante, die innere untere Ecke abgeschrägt
  function tafelGrund(ctx, q, ecke, farbe) {
    const TF = T().TAFEL, s = TF.schraege, { x, y, w, h } = q;
    poly(ctx, ecke === 'tl' ? [[x, y], [x + w, y], [x + w, y + h - s], [x + w - s, y + h], [x, y + h]] : [[x, y], [x + w, y], [x + w, y + h], [x + s, y + h], [x, y + h - s]], rgba(TF.grund.farbe, TF.grund.alpha));
    ctx.fillStyle = farbe;
    ctx.fillRect(x, y, w, TF.streifen);
    ctx.fillRect(ecke === 'tl' ? x : x + w - TF.aussenStreifen, y, TF.aussenStreifen, h);
  }
  // Kappe: Kopfzeile in Funktionsfarbe, Schrift in Grundfarbe (Skala 1)
  function kappe(ctx, str, x, y, farbe) {
    const K = T().TAFEL.kappe, R = Rd(), w = R.measure(str, T().TEXT.skalaKopf) + 2 * K.padX;
    poly(ctx, [[x, y], [x + w - K.schraege, y], [x + w, y + K.schraege], [x + w, y + K.hoehe], [x, y + K.hoehe]], farbe);
    R.text(ctx, str, x + K.padX, y + K.textY, { color: K.farbeText, scale: T().TEXT.skalaKopf, shadow: false });
    return w;
  }
  const txt = (ctx, str, x, y, farbe, skala, align) => Rd().text(ctx, str, x, y, { color: farbe, scale: skala, align: align || 'left', shadow: false });
  // Text auf höchstens maxB Pixel kürzen („…“ am Ende)
  function passend(str, skala, maxB) {
    const R = Rd();
    str = String(str);
    if (R.measure(str, skala) <= maxB) return str;
    while (str.length > 1 && R.measure(str + '…', skala) > maxB) str = str.slice(0, -1);
    return str + '…';
  }

  function zeichneLinks(ctx, q, d) {
    const TK = T(), TF = TK.TAFEL, L = TF.links, TX = TK.TEXT, F = TK.FARBE, R = Rd();
    tafelGrund(ctx, q, L.ecke, L.farbe);
    // KURS: Zahl mit Grad, Kursband ±40° mit N/O/S/W
    kappe(ctx, TX.kopf.kurs, q.x + L.kurs.kopfX, q.y + L.kurs.kopfY, L.farbe);
    txt(ctx, d.kurs != null ? L.kurs.format.replace('{kurs}', d.kurs) : '–', q.x + L.kurs.wertX, q.y + L.kurs.wertY, F.kurs, L.kurs.skala);
    if (d.kurs != null) {
      const B = L.band, bx = q.x + B.x, by = q.y + B.y, mid = bx + B.w / 2, px = B.w / (2 * B.spanne);
      ctx.save(); ctx.beginPath(); ctx.rect(bx, by - 2, B.w, 12); ctx.clip();
      for (let g = Math.floor((d.kurs - B.spanne - B.teilung) / B.teilung) * B.teilung; g <= d.kurs + B.spanne + B.teilung; g += B.teilung) {
        const x = Math.round(mid + (g - d.kurs) * px), gg = ((g % 360) + 360) % 360, card = { 0: 'N', 90: 'O', 180: 'S', 270: 'W' }[gg];
        if (card) txt(ctx, card, x, by + 2, F.kurs, TX.skalaKopf, 'center');
        else { const lang = gg % 10 === 0; ctx.fillStyle = rgba(F.kurs, lang ? B.alphaLang : B.alphaKurz); ctx.fillRect(x, by + (lang ? 3 : 6), 1, lang ? B.lang : B.kurz); }
      }
      ctx.restore();
      ctx.fillStyle = rgba(F.kurs, B.linieAlpha); ctx.fillRect(bx, by + 10, B.w, 1);
      poly(ctx, [[mid - B.marke, by - 3], [mid + B.marke, by - 3], [mid, by + 1]], F.kurs);
    }
    // TEMPO und Schubstufe (Wort wie das Fahrt-Pult, Consoles.helmInfo)
    kappe(ctx, TX.kopf.tempo, q.x + L.tempo.kopfX, q.y + L.tempo.kopfY, L.farbe);
    const tmax = q.w + L.leiter.x - 4 - L.tempo.wertX;   // bis vor die Stufenleiter
    const tempoStr = d.tempo != null ? String(d.tempo) : '–';
    txt(ctx, tempoStr, q.x + L.tempo.wertX, q.y + L.tempo.wertY, F.kurs, R.measure(tempoStr, L.tempo.skala) <= tmax ? L.tempo.skala : TX.skalaWert);
    if (d.stufe != null) txt(ctx, passend(d.stufe, L.stufe.skala, tmax), q.x + L.stufe.x, q.y + L.stufe.y, F.kurs, L.stufe.skala);
    // Stufenleiter: je Stufe eine Lampe von unten (Rückwärts, STOPP, Vorwärtsstufen), Rückwärts Orange, STOPP gedämpft
    const Lt = L.leiter, n = d.stufen.n;
    if (n > 0) {
      const schritt = n > 1 ? Math.min(Lt.schritt, Math.floor((q.h - Lt.untenAbstand - TF.streifen - 1 - Lt.h) / (n - 1))) : Lt.schritt, lx = q.x + q.w + Lt.x;
      for (let i = 0; i < n; i++) {
        const sv = d.stufen.werte[i], an = i <= d.stufen.stage;
        let f;
        if (sv < 0) f = i === d.stufen.stage ? Lt.rueckAn : Lt.rueckAus;
        else if (sv === 0) f = Lt.stopp;
        else f = an ? Lt.an : Lt.aus;
        ctx.fillStyle = f; ctx.fillRect(lx, q.y + q.h - Lt.untenAbstand - i * schritt, Lt.w, Lt.h);
      }
    }
  }

  function zeichneRechts(ctx, q, s) {
    const TK = T(), TF = TK.TAFEL, Rr = TF.rechts, TX = TK.TEXT, F = TK.FARBE;
    tafelGrund(ctx, q, Rr.ecke, Rr.farbe);
    const kopf = s.laedt ? Rr.laden.kopf.replace('{laedt}', TX.kopf.laedt).replace('{prozent}', Math.round(s.charge * 100)) : TX.kopf.ziel;
    kappe(ctx, kopf, q.x + Rr.ziel.kopfX, q.y + Rr.ziel.kopfY, Rr.farbe);
    txt(ctx, passend(s.name, Rr.ziel.skala, Rr.ziel.maxBreite), q.x + Rr.ziel.wertX, q.y + Rr.ziel.wertY, Rr.farbe, Rr.ziel.skala);
    if (s.boje != null) {
      txt(ctx, Rr.boje.format.replace('{boje}', s.boje).replace('{entfernung}', s.entfernung), q.x + Rr.boje.x, q.y + Rr.boje.y, Rr.boje.farbe, Rr.boje.skala);
      // Peilpfeil zur Boje: Ring und Pfeil, Bug oben
      const P = Rr.peil, px = q.x + q.w + P.x, py = q.y + P.y;
      ctx.strokeStyle = rgba(Rr.farbe, P.ringAlpha); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(px, py, P.ringRadius, 0, Math.PI * 2); ctx.stroke();
      ctx.save(); ctx.translate(px, py); ctx.rotate(s.peil);
      poly(ctx, [[P.spitze, 0], [-P.fluegel, -P.fluegel], [-P.kerbe, 0], [-P.fluegel, P.fluegel]], Rr.farbe);
      ctx.restore();
    } else if (s.ready) {
      txt(ctx, TX.kopf.bereit, q.x + Rr.boje.x, q.y + Rr.boje.y, F.schild, Rr.boje.skala);
    }
    if (s.charge > 0) {   // Ladestand: Spur und Balken, Anteil der Breite
      const bw = q.w - 2 * Rr.ziel.kopfX, by = q.y + Rr.laden.balkenY;
      ctx.fillStyle = Rr.laden.spur; ctx.fillRect(q.x + Rr.ziel.kopfX, by, bw, Rr.laden.balkenH);
      ctx.fillStyle = Rr.laden.farbe; ctx.fillRect(q.x + Rr.ziel.kopfX, by, Math.round(bw * s.charge), Rr.laden.balkenH);
    }
  }

  function zeichne(ctx, view, opt) {
    if (!ctx || !Rd() || !root.HauptschirmTokens) return;
    ctx.save();
    try {
      const L = lage(view, opt), d = daten(view);
      zeichneLinks(ctx, L.links, d);
      if (L.rechts && d.sprung) zeichneRechts(ctx, L.rechts, d.sprung);
    } catch (e) { melde(e); } finally { ctx.restore(); }
  }

  const API = { lage, sperren, zeichne, daten };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.HauptschirmTafeln = API;
})(typeof window !== 'undefined' ? window : globalThis);
