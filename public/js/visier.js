// KUL-03 A: Zeichner der Hauptschirm-Ansicht 'visier' (Richtung B+ aus KUL-01): Blick vom Bug nach vorn auf Brückenhöhe. Paket A: Kamera und Projektion, Himmel (Panorama-Sternfeld,
// Stern über dem Horizont), Planeten UNTER der Flugebene, Glasebene (Schleier, Horizontlinie, Entfernungsringe). Gegner, Bojen, Station (B), Leiste (C), Lagescheibe (D), Skins (E) setzen auf
// projiziere() auf. Mathe und Optik nach vault Pantheon/Mockups/KUL-01/bplus-visier.html mit lib/kul.js (kamera, himmel, planeten, ebene). Eigene Datei: der klassische Zeichner, render.js und
// drawSpace kennen das Visier nicht; der Zeichner liest den Zustand direkt aus view und meldet sich selbst an (Hauptschirm.registriere('visier', …), vor sitz.js geladen).
//   Visier.projiziere(X, Z, hoehe)         Punkt relativ zum Schiff (X Steuerbord, Z voraus, hoehe über der Ebene, unten negativ) -> Texturpixel { x, y, tiefe, k, ok }; rein, ohne Zeichnen
//   Visier.projiziereWelt(ship, wx, wy, h)  Weltpunkt (ship { x, y, angle } wie view.ship: Bogenmaß, 0 = +x, im Uhrzeigersinn) -> dasselbe plus { f, r }; dreht mit dem Kurs ein
//   Visier.planetLage(X, Z, radius)         Lage und Radius eines Planeten im Bild inkl. Sicherung (Oberkante des Saums, 1,18 R, höchstens Horizont + 6): { x, y, r, tiefe, ok, geklemmt }
//   Visier.schiffVon(view)                  das Schiff des Bildes (view.ship interpoliert, sonst Snapshot): eine Quelle fuer Bild, Objekte, Lagescheibe und Peilband
//   Visier.plan(view)                       reine Lage der Teile { fog, sterne[], planeten[] }; null ohne Schiff
//   Visier.zeichne(ctx, view, rect)         der Zeichner; Visier.kamera() liefert { F, horizont, … } aus den Tokens
// Kurs-Konvention: Weltwinkel 0 = +x (Osten), y nach unten, Uhrzeigersinn positiv (Kompass Nord = 0: Shared_Physics.kompassGrad); Steuerbord = Bug + 90° im Uhrzeigersinn.
// Alle Maße und Farben: HauptschirmTokens.TOKENS.VISIER (Kamera, Himmel, Planet, Glas), SONNE, STERNFELD, FARBE, SCHIRM.
(function (root) {
  'use strict';

  const ok = Number.isFinite;
  const RAD = Math.PI / 180;
  const T = () => root.HauptschirmTokens.TOKENS;
  function rgba(hex, a) { const n = parseInt(String(hex).slice(1, 7), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
  let gemeldet = false;
  function melde(e) { if (gemeldet) return; gemeldet = true; try { if (root.Net && root.Net.reportError) root.Net.reportError('Visier', e); } catch (x) { /* egal */ } }

  // ------------------------------------------------------------ Kamera (aus den Tokens, einmal je Tokensatz abgeleitet)
  let kamCache = null, kamFuer = null;
  function kamera() {
    const TK = T();
    if (kamCache && kamFuer === TK) return kamCache;
    const K = TK.VISIER.kamera, W = TK.SCHIRM.w, H = TK.SCHIRM.h, P = K.neigung * RAD;
    kamCache = { W, H, F: (H / 2) / Math.tan(K.blickwinkel * RAD / 2), cp: Math.cos(P), sp: Math.sin(P), auge: K.auge, vor: K.vor, tiefeMin: K.tiefeMin };
    kamCache.horizont = H / 2 - Math.tan(P) * kamCache.F;
    kamFuer = TK;
    return kamCache;
  }

  // Punkt relativ zum Schiff: X Steuerbord, Z voraus, hoehe über der Flugebene -> Bildpunkt. tiefe = Abstand entlang der Blickachse, k = Bildmaßstab (px je Welteinheit).
  // ok: vor der Kamera und mindestens tiefeMin (Tokens) entfernt.
  function projiziere(X, Z, hoehe) {
    const c = kamera(), y = (hoehe || 0) - c.auge, ff = Z - c.vor;
    const tiefe = ff * c.cp - y * c.sp, up = y * c.cp + ff * c.sp;
    const k = c.F / tiefe;
    return { x: c.W / 2 + X * k, y: c.H / 2 - up * k, tiefe, k, ok: ok(tiefe) && tiefe >= c.tiefeMin };
  }
  // Weltpunkt -> Bild: f voraus und r Steuerbord aus dem Kurs des Schiffs
  function projiziereWelt(ship, wx, wy, hoehe) {
    const dx = wx - ship.x, dy = wy - ship.y, a = ship.angle || 0, ca = Math.cos(a), sa = Math.sin(a);
    const f = dx * ca + dy * sa, r = -dx * sa + dy * ca;
    const p = projiziere(r, f, hoehe);
    p.f = f; p.r = r;
    return p;
  }

  // Planet im Bild: Radius = 1 × Kartenradius, Mittelpunkt 1,25 × R + 40 UNTER der Ebene (die Kugel liegt ganz unter Augenhöhe, beim Anflug rutscht sie nach unten aus dem Bild).
  // Sicherung gegen die Kreis-Näherung: Oberkante nie höher als Horizont + sicherungPx (Kugel notfalls nach unten schieben). ok = Mittelpunkt mindestens planet.tiefeMin tief.
  function planetLage(X, Z, radius) {
    const PL = T().VISIER.planet, c = kamera();
    const R = radius * PL.radiusFaktor, tief = R * PL.tiefeFaktor + PL.tiefePlus, p = projiziere(X, Z, -tief);
    const r = R * p.k;
    // Sichtbarer Aussenradius = Kugel plus Atmosphaerensaum (KulisseKugel malt bis (1 + KUGEL.saum.breite) * R, oben mit starkem Alpha): die Sicherung rechnet mit ihm, nicht mit dem Koerper (N1 B3)
    const ra = r * (1 + T().KUGEL.saum.breite);
    let y = p.y, geklemmt = false;
    if (y - ra < c.horizont + PL.sicherungPx) { y = c.horizont + PL.sicherungPx + ra; geklemmt = true; }
    return { x: p.x, y, r, tiefe: p.tiefe, ok: p.tiefe > PL.tiefeMin && r > 0 && ok(r) && ok(y) && ok(p.x), geklemmt };
  }

  // ------------------------------------------------------------ Panorama-Fixsterne (einmal berechnet; je Frame nur Peilung und Höhe)
  let sternFeld = null, sternFuer = null;
  function rng(seed) { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function panorama() {
    const TK = T();
    if (sternFeld && sternFuer === TK) return sternFeld;
    const H = TK.VISIER.himmel, SF = TK.STERNFELD, R = rng(H.seed), kl = SF.klassen, eimer = kl.map(() => []);
    for (let i = 0; i < H.anzahl; i++) {
      const az = R() * 360, el = (R() - H.hoeheMitte) * H.hoeheSpanne, b = R();
      let k = kl.findIndex((c) => b >= c.ab); if (k < 0) k = kl.length - 1;
      eimer[k].push({ az, tanEl: Math.tan(el * RAD), unten: false, b, px: b > SF.grossAb ? SF.grossPx : SF.kleinPx });
    }
    sternFuer = TK;
    return sternFeld = eimer;
  }

  // ------------------------------------------------------------ Lage (rein, ohne Zeichnen)
  // DAS Schiff des Bildes: view.ship (zwischen zwei Snapshots interpoliert, client.js) vor dem neuesten Snapshot-Schiff. Bild, Objekte, Lagescheibe UND Peilband lesen es hier (KUL-03 N1 B1):
  // sonst liegt das Band in der Wende 3-5 Grad neben dem Bild.
  function schiffVon(view) { return (view && view.ship) || (view && view.state && view.state.ship) || null; }
  function plan(view) {
    const KH = root.KulisseHimmel, st = view && view.state, ship = schiffVon(view);
    if (!st || !ship || !ok(ship.x) || !ok(ship.y) || !ok(ship.angle)) return null;
    const TK = T(), V = TK.VISIER, VH = V.himmel;
    const si = KH && KH.sichtVon ? KH.sichtVon(st) : { sc: {}, fog: false, imSicht: () => true };   // gleiche Nebelregel wie klassisch (kulisse-himmel.js)
    const pts = KH && KH.punkte ? KH.punkte : (l) => (Array.isArray(l) ? l.filter((p) => p && ok(p.x) && ok(p.y)) : []);
    const seed = KH && KH.seedVon ? KH.seedVon : (p, i) => (p.seed != null ? p.seed | 0 : (Math.round(p.x) * 7 + Math.round(p.y) * 13 + i * 101) | 0);
    const sc = si.sc || {}, aus = { fog: si.fog, ship, sterne: [], planeten: [], licht: null };
    const sterne = pts(sc.stern).filter((s) => si.imSicht(s, 0));
    let best = Infinity, lichtA = null;
    const c = kamera();
    for (const s of sterne) {
      const q = projiziereWelt(ship, s.x, s.y, 0), d = Math.hypot(s.x - ship.x, s.y - ship.y), peil = Math.atan2(q.r, q.f);   // Bogenmaß, 0 = Bug, + = Steuerbord
      const x = c.W / 2 + Math.tan(peil) * c.F, y = c.horizont - Math.tan(VH.sonne.hoeheGrad * RAD) * c.F;
      aus.sterne.push({ x, y, peil, klasse: s.klasse, sichtbar: Math.cos(peil) > VH.sonne.sichtbarAbCos, wx: s.x, wy: s.y });
      if (d < best) { best = d; lichtA = peil; }
    }
    // Lichtvektor im Bild: von oben, seitlich nach dem Stern (Mockup [sin a, −0,55, …]). Die Kugel kennt nur einen Lichtwinkel (z fest aus SONNE.lichtZ), also Winkel aus (x, y).
    aus.licht = lichtA == null ? Math.atan2(TK.SONNE.lichtOhneStern[1], TK.SONNE.lichtOhneStern[0]) : Math.atan2(VH.licht.y, Math.sin(lichtA));
    pts(sc.planeten).forEach((p, i) => {
      const r0 = ok(p.r) && p.r > 0 ? p.r : 0; if (!r0) return;
      if (si.fog && !si.imSicht(p, r0)) return;
      const q = projiziereWelt(ship, p.x, p.y, 0), L = planetLage(q.r, q.f, r0);
      if (!L.ok || q.f <= 0) return;
      aus.planeten.push({ art: p.art, x: L.x, y: L.y, r: L.r, tiefe: L.tiefe, geklemmt: L.geklemmt, seed: seed(p, i), wx: p.x, wy: p.y });
    });
    aus.planeten.sort((a, b) => b.tiefe - a.tiefe);   // fern zuerst
    return aus;
  }

  // Kugeln wachsen stetig, der Zwischenspeicher baut sie aber je Radiusstufe: Stufen geometrisch (≈ 12 %), die Zeichnung skaliert auf den echten Radius (kein Neuaufbau je 4 px Wachstum)
  // Obergrenze VISIER.planet.kugelMaxPx (320): groessere Kugeln skaliert die Zeichnung hoch (Pixel-Look, Blockraster wird groeber), der Zwischenspeicher baut nie mehr als ~800 x 800 px je Eintrag
  // (~2,6 MB, bei cacheMax 24 hoechstens ~62 MB statt 140 MB) und baut beim Anflug oberhalb der Grenze nichts mehr neu (N1 B6)
  let stufenCache = null, stufenFuer = null;
  function stufen() {
    const TK = T();
    if (stufenCache && stufenFuer === TK) return stufenCache;
    const l = [], max = TK.VISIER.planet.kugelMaxPx;
    for (let r = 12; r <= max; r = Math.max(r + 4, Math.round(r * 1.12 / 4) * 4)) l.push(r);
    stufenFuer = TK;
    return stufenCache = l;
  }
  function stufeFuer(r) { const S = stufen(); let b = S[0]; for (const s of S) { if (s <= r * 1.06) b = s; else break; } return b; }

  // ------------------------------------------------------------ Zeichnen
  function himmel(ctx, view, L, c) {
    const TK = T(), V = TK.VISIER, VH = V.himmel, SF = TK.STERNFELD, ship = L.ship, W = c.W, H = c.H, hz = c.horizont;
    ctx.fillStyle = TK.FARBE.grund; ctx.fillRect(0, 0, W, H);
    if (!L.fog) {   // Panorama: Sterne in Peilung und Höhe, unter dem Horizont nur helle (man sieht durch die Ebene)
      const hdg = ship.angle / RAD, F = c.F;
      const feld = panorama();
      for (let k = 0; k < feld.length; k++) {
        const kl = SF.klassen[k]; ctx.fillStyle = rgba(kl.farbe, kl.alpha);
        for (const s of feld[k]) {
          const a = ((s.az - hdg) % 360 + 540) % 360 - 180; if (a > VH.seiteMax || a < -VH.seiteMax) continue;
          const ar = a * RAD, x = W / 2 + Math.tan(ar) * F, y = hz - s.tanEl * F / Math.cos(ar);
          if (y > hz && s.b < VH.untenAb) continue;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          ctx.fillRect(Math.round(x), Math.round(y), s.px, s.px);
        }
      }
    }
    const K = root.KulisseKugel, t = view.time || 0;
    if (K) for (const s of L.sterne) { if (s.sichtbar && s.x > -12 && s.x < W + 12) K.stern(ctx, s.x, s.y, TK.SONNE.radius, s.klasse, t); }
    // Planeten unter der Ebene (volle Helligkeit, das Glas dunkelt sie ab)
    if (K) {
      for (const p of L.planeten) {
        if (p.x + p.r * 1.3 < 0 || p.x - p.r * 1.3 > W || p.y - p.r > H) continue;
        const b = stufeFuer(p.r), s = p.r / b;
        ctx.save();
        try {
          ctx.translate(p.x, p.y); ctx.scale(s, s);
          K.zeichnePlanet(ctx, p.art, 0, 0, b, p.seed, L.licht, 0, 0);
        } finally { ctx.restore(); }
      }
    }
  }

  function glas(ctx, c) {
    const G = T().VISIER.glas, W = c.W, H = c.H, hz = c.horizont, hy = Math.round(hz);
    ctx.fillStyle = rgba(G.schleier.farbe, G.schleier.alpha); ctx.fillRect(0, hz, W, H - hz);
    const g = ctx.createLinearGradient(0, hz - G.schein.hoehe + 1, 0, hz + 1);
    g.addColorStop(0, rgba(G.schein.farbe, G.schein.alphaOben)); g.addColorStop(1, rgba(G.schein.farbe, G.schein.alphaUnten));
    ctx.fillStyle = g; ctx.fillRect(0, hz - G.schein.hoehe + 1, W, G.schein.hoehe);
    ctx.fillStyle = rgba(G.horizont.farbe, G.horizont.alpha); ctx.fillRect(0, hy, W, G.horizont.breite);
    const RG = G.ringe, R = root.Render, TK = T(), leisteY = H - TK.VISIER.leiste.hoehe;
    ctx.strokeStyle = rgba(RG.farbe, RG.alpha); ctx.lineWidth = RG.breite;
    for (const r of RG.welt) {
      ctx.setLineDash(RG.strich); ctx.beginPath();
      let neu = true;
      for (let i = 0; i <= RG.segmente; i++) {
        const a = i / RG.segmente * Math.PI * 2, p = projiziere(Math.sin(a) * r, Math.cos(a) * r, 0);   // Ring um das Schiff: X Steuerbord, Z voraus
        if (!(p.tiefe >= RG.tiefeMin)) { neu = true; continue; }
        if (neu) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        neu = false;
      }
      ctx.stroke(); ctx.setLineDash([]);
      if (R && R.textKontur) {   // Ringwert bei −34° (Backbord voraus), 3 px über dem Ring, nur wenn genug über der Leiste (Skala 1: Hilfe, keine Meldung)
        const a = RG.wert.winkelGrad * RAD, p = projiziere(Math.sin(a) * r, Math.cos(a) * r, 0);
        const th = 7 * RG.wert.skala;
        if (p.tiefe >= RG.tiefeMin && p.y - RG.wert.ueber - th < leisteY - RG.wert.abstandLeiste) R.textKontur(ctx, String(r), Math.round(p.x), Math.round(p.y - RG.wert.ueber - th), { color: rgba(RG.farbe, RG.wert.alpha), align: 'center', scale: RG.wert.skala });
      }
    }
  }

  // Schichten über der Glasebene, aufsteigend nach Rang (Objekte 10, Leiste 20, Lagescheibe 30); fn(ctx, view, plan, kamera)
  const schichten = [];
  function registriereSchicht(name, rang, fn) {
    const i = schichten.findIndex(s => s.name === name);
    if (i >= 0) schichten.splice(i, 1);
    schichten.push({ name, rang, fn });
    schichten.sort((a, b) => a.rang - b.rang);
  }

  function zeichne(ctx, view, rect) {
    const TK = root.HauptschirmTokens && root.HauptschirmTokens.TOKENS;
    if (!ctx || !TK || !TK.VISIER) return;
    ctx.save();
    try {
      const c = kamera();
      ctx.beginPath(); ctx.rect(0, 0, c.W, c.H); ctx.clip();
      ctx.imageSmoothingEnabled = false;
      const L = plan(view);
      if (!L) { ctx.fillStyle = TK.FARBE.grund; ctx.fillRect(0, 0, c.W, c.H); return; }
      const j = view.state.ship && view.state.ship.jump;
      if (j && j.reise) {   // Hyperraum: Grund und Tunnelanimation (wie drawFrontView), keine Kulisse
        ctx.fillStyle = TK.FARBE.grund; ctx.fillRect(0, 0, c.W, c.H);
        if (root.Render && root.Render.hyperraum) root.Render.hyperraum(ctx, view, { x: 0, y: 0, w: c.W, h: c.H });
        return;
      }
      himmel(ctx, view, L, c);
      glas(ctx, c);
      for (const sch of schichten) {   // Objekte, Leiste, Lagescheibe: je eine eigene Datei, meldet sich mit registriereSchicht an
        ctx.save();
        try { sch.fn(ctx, view, L, c); } catch (e) { melde(e); } finally { ctx.restore(); }
      }
    } catch (e) { melde(e); } finally { ctx.restore(); }
  }

  const API = { registriereSchicht, zeichne, plan, projiziere, projiziereWelt, planetLage, schiffVon, kamera, stufeFuer };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.Visier = API;
  if (root.Hauptschirm && root.Hauptschirm.registriere) root.Hauptschirm.registriere('visier', zeichne);
})(typeof window !== 'undefined' ? window : globalThis);
