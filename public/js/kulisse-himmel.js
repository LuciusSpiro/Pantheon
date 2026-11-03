// KUL-02 C: Himmelsschicht des klassischen Hauptschirms (Richtung A „Tiefe“, KUL-01). Zeichnet Sternfeld, Stern als Randlicht in seiner Peilung, Planeten UNTER der Flugebene
// (Parallaxe 0,45), Gasriesen-Dunst mit Höhenlinien (ohne Namen: die Schichtnamen zeichnet drawZonen) und Navigationsbojen als Leuchtmarken. Nur Zeichnen: liest die Szene (Shared_Locations, scene.stern / planeten / bojen / zonen)
// und das Schiff aus dem Snapshot, kennt kein Spielwissen und ändert nichts am Spiel (Planeten, Sterne und Bojen sind reine Kulisse, keine Kollision).
// Aufruf: Render.drawFrontView ruft über rect.himmel (sitz.js, Zeichner 'klassisch') nach dem Sternenhimmel und vor allen Spielobjekten KulisseHimmel.zeichne(ctx, view, rect).
// rect ist DASSELBE Fenster wie bei drawFrontView; die Projektion kommt aus Render.frontProjektion (gleiche Mathe wie drawSpace).
//   KulisseHimmel.zeichne(ctx, view, rect)   zeichnet die Schicht (nichts im Hyperraum; im Nebel ohne Grund und Sternfeld, den Nebel legt drawFrontView drüber)
//   KulisseHimmel.plan(view, rect)           reine Lage der Teile in Texturpixeln { fog, sterne[], planeten[], gas[], bojen[], sprung[] } (Tests, Messung); null ohne Schiff
//   KulisseHimmel.randPunkt(sicht, ox, oy, winkel, abstand)   Treffpunkt des Strahls aus (ox, oy) auf dem um abstand eingerückten Rechteck
// Alle Werte (Parallaxe, Radiusfaktor, Abdunklung, Farben, Linienstile) stehen in HauptschirmTokens.TOKENS (HIMMEL, STERNFELD, SONNE, BOJE, GASRIESE, FARBE, TEXT).
(function (root) {
  'use strict';

  const ok = Number.isFinite;
  const T = () => root.HauptschirmTokens.TOKENS;
  function rgba(hex, a) { const n = parseInt(String(hex).slice(1, 7), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
  let gemeldet = false;
  function melde(e) { if (gemeldet) return; gemeldet = true; try { if (root.Net && root.Net.reportError) root.Net.reportError('KulisseHimmel', e); } catch (x) { /* egal */ } }

  // Strahl aus (ox, oy) in Richtung winkel bis zum Rand des Rechtecks, um abstand nach innen gerückt (Mittelpunkt des Sterns)
  function randPunkt(sicht, ox, oy, winkel, abstand) {
    const x0 = sicht.x + abstand, x1 = sicht.x + sicht.w - abstand, y0 = sicht.y + abstand, y1 = sicht.y + sicht.h - abstand;
    const dx = Math.cos(winkel), dy = Math.sin(winkel);
    let t = Infinity;
    if (dx > 1e-6) t = Math.min(t, (x1 - ox) / dx); else if (dx < -1e-6) t = Math.min(t, (x0 - ox) / dx);
    if (dy > 1e-6) t = Math.min(t, (y1 - oy) / dy); else if (dy < -1e-6) t = Math.min(t, (y0 - oy) / dy);
    if (!(t >= 0) || !ok(t)) t = 0;
    return { x: ox + dx * t, y: oy + dy * t };
  }

  function szeneVon(st) {
    const SL = root.Shared_Locations, ship = st && st.ship;
    const loc = SL && SL.get && ship && ship.scene != null ? SL.get(ship.scene) : null;
    return { loc, sc: (loc && loc.scene) || {} };
  }
  const punkte = (l) => (Array.isArray(l) ? l.filter((p) => p && ok(p.x) && ok(p.y)) : []);
  const seedVon = (p, i) => (p.seed != null ? p.seed | 0 : (Math.round(p.x) * 7 + Math.round(p.y) * 13 + i * 101) | 0);

  // ------------------------------------------------------------ Lage (rein, ohne Zeichnen)
  function plan(view, rect) {
    const R = root.Render, st = view && view.state, ship = st && st.ship;
    if (!R || !R.frontProjektion || !rect || !ship || !ok(ship.x) || !ok(ship.y)) return null;
    const TK = T(), H = TK.HIMMEL, P = R.frontProjektion(view, rect), { zoom, rot, toS } = P;
    const sicht = rect.sicht || rect, { loc, sc } = szeneVon(st);
    const fog = !!(loc && (loc.fog || loc.kind === 'nebula'));
    const aus = { fog, P, sicht, sterne: [], planeten: [], gas: [], bojen: [], sprung: [] };
    // Nebel: Sicht halbiert (wie drawFrontView/inFog, R.FRONT.fwd × 0,5): was weiter weg liegt, gehört nicht ins Bild (kein Planet, Stern oder Boje unter dem Schleier)
    const sicht2 = fog ? (R.FRONT ? R.FRONT.fwd : 700) * 0.5 : Infinity;
    const imSicht = (p, r) => Math.hypot(p.x - ship.x, p.y - ship.y) - (r || 0) <= sicht2;
    const sterne = punkte(sc.stern).filter((s) => imSicht(s, 0));
    const SU = TK.SONNE.sperreUnten;
    for (const s of sterne) {
      const w = Math.atan2(s.y - ship.y, s.x - ship.x), a = w + rot;   // Peilung der Karte, ins Bild gedreht
      const e = randPunkt(sicht, P.cx, P.cy, a, TK.SONNE.randAbstand);
      let versetzt = false;
      if (SU && e.y >= sicht.y + sicht.h - TK.SONNE.randAbstand - 0.5 && Math.abs(e.x - P.cx) < SU.halbB) {   // Randlicht unten neben der Lerche liest sich wie ein Treffer: seitlich herausschieben
        e.x = P.cx + (e.x >= P.cx ? 1 : -1) * SU.halbB; versetzt = true;
      }
      aus.sterne.push({ winkel: a, x: e.x, y: e.y, klasse: s.klasse, wx: s.x, wy: s.y, versetzt });
    }
    const hatZonen = Array.isArray(sc.zonen) && sc.zonen.length > 0;   // drawZonen zeichnet diese Gasriesen mit Ringen selbst (Parallaxe 1)
    punkte(sc.planeten).forEach((p, i) => {
      const r = ok(p.r) && p.r > 0 ? p.r : 0; if (!r) return;
      if (fog && !imSicht(p, r)) return;
      if (p.art === 'gasriese' && hatZonen) {
        const c = toS(p.x, p.y), R1 = r * H.radiusFaktorGasriesePlan * zoom;
        // Sichtbarkeit wie drawZonen: sichtbarFuer 'karte' erst nach dem Erkunden (st.zonen.bk), abgeschaltete Schaltgruppen (au) nie; Linienstil k zählt über alle Grenzen, nicht nur die sichtbaren
        const Z = root.Shared_Zonen, zst = st.zonen || {}, vis = { ops: false, bekannt: new Set(zst.bk || []), alle: new Set(zst.sv || []) }, abg = new Set(zst.au || []);
        const ringe = (sc.zonen || []).filter((z) => z && z.form === 'ring' && z.name && ok(z.r1) && z.x === p.x && z.y === p.y).sort((a, b) => b.r1 - a.r1).slice(0, TK.GASRIESE.linie.length);
        const zeigen = (z) => !(z.gruppe && abg.has(z.gruppe)) && (!Z || !Z.sichtbar || Z.sichtbar(z, vis));
        aus.gas.push({ x: c.x, y: c.y, r: R1, linien: ringe.map((z, k) => ({ name: String(z.name).toUpperCase(), r: z.r1 * zoom, k, z })).filter((l) => zeigen(l.z)).map((l) => ({ name: l.name, r: l.r, k: l.k })) });
        return;
      }
      const par = H.parallaxePlanet, c = toS(ship.x + (p.x - ship.x) * par, ship.y + (p.y - ship.y) * par), rpx = H.radiusFaktor * r * zoom;
      let licht = Math.atan2(TK.SONNE.lichtOhneStern[1], TK.SONNE.lichtOhneStern[0]), best = Infinity;   // Weltorientierung: Richtung zum nächsten Stern
      for (const s of sterne) { const d = Math.hypot(s.x - p.x, s.y - p.y); if (d < best) { best = d; licht = Math.atan2(s.y - p.y, s.x - p.x); } }
      aus.planeten.push({ art: p.art, x: c.x, y: c.y, r: rpx, seed: seedVon(p, i), licht, wx: p.x, wy: p.y });
    });
    for (const b of punkte(sc.bojen)) { if (!imSicht(b, 0)) continue; const c = toS(b.x, b.y); aus.bojen.push({ x: c.x, y: c.y, wx: b.x, wy: b.y }); }
    const jp = st.space && st.space.jp;
    for (const j of punkte(jp)) { const c = toS(j.x, j.y); aus.sprung.push({ x: c.x, y: c.y }); }
    return aus;
  }

  // ------------------------------------------------------------ Zeichnen
  const sichtbar = (sicht, x, y, rr) => x + rr >= sicht.x && x - rr <= sicht.x + sicht.w && y + rr >= sicht.y && y - rr <= sicht.y + sicht.h;

  function zeichne(ctx, view, rect) {
    const R = root.Render, K = root.KulisseKugel;
    if (!ctx || !R || !K || !root.HauptschirmTokens) return;
    const j = view && view.state && view.state.ship && view.state.ship.jump;
    if (j && j.reise) return;   // Hyperraum: drawFrontView legt die Tunnelanimation drüber, die Kulisse spart sich die Arbeit
    ctx.save();
    try {
      const L = plan(view, rect); if (!L) return;
      const TK = T(), sicht = L.sicht, H = TK.HIMMEL, t = view.time || 0, P = L.P;
      ctx.beginPath(); ctx.rect(sicht.x, sicht.y, sicht.w, sicht.h); ctx.clip();
      if (!L.fog) {   // im Nebel bleibt der Nebelhimmel von drawSpace, sonst Himmelsgrund der Tokens und Fixsterne (drehen mit dem Kurs)
        ctx.fillStyle = TK.FARBE.grund; ctx.fillRect(sicht.x, sicht.y, sicht.w, sicht.h);
        K.sternfeld(ctx, sicht, P.rot, TK.STERNFELD.seed);
      }
      // Gasriese mit Zonen: Dunst um die Scheibe und Höhenlinien der erkundeten Schichten (nur Linien, keine Namen); die Scheibe selbst zeichnet drawZonen
      for (const g of L.gas) {
        const D = TK.GASRIESE.dunst, rr = g.r * D.bisRadius;
        if (!sichtbar(sicht, g.x, g.y, rr)) continue;
        const gr = ctx.createRadialGradient(g.x, g.y, g.r, g.x, g.y, rr);
        for (const [o, a] of D.stopps) gr.addColorStop(o, rgba(D.farbe, a));
        ctx.fillStyle = gr; ctx.fillRect(sicht.x, sicht.y, sicht.w, sicht.h);
        for (const li of g.linien) {
          const S = TK.GASRIESE.linie[li.k] || TK.GASRIESE.linie[TK.GASRIESE.linie.length - 1];
          ctx.strokeStyle = rgba(S.farbe, S.alpha); ctx.lineWidth = S.breite; ctx.setLineDash(S.strich);
          ctx.beginPath(); ctx.arc(g.x, g.y, li.r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);   // der Name steht NICHT hier: ihn setzt render.js drawZonen (dynamisch, frei von Tafeln und Rand)
        }
      }
      // Planeten unter der Ebene (abgedunkelt, vom Stern beleuchtet, mit dem Kurs gedreht)
      ctx.imageSmoothingEnabled = false;
      for (const p of L.planeten) {
        if (!sichtbar(sicht, p.x, p.y, p.r * 1.3)) continue;
        K.zeichnePlanet(ctx, p.art, p.x, p.y, p.r, p.seed, p.licht, P.rot, H.abdunklung.alpha);
      }
      // Sterne als Randlicht in ihrer Peilung
      for (const s of L.sterne) K.stern(ctx, s.x, s.y, TK.SONNE.radius, s.klasse, t);
      // Sprungpunkt-Bojen: nur ein weiches Glühen unterlegt, Ring, Raute und Beschriftung zeichnet drawSpace (StarMap) als Spielobjekt
      const BS = TK.BOJE.sprung;
      for (const b of L.sprung) {
        const rr = BS.feld.welt * P.zoom;
        if (!sichtbar(sicht, b.x, b.y, rr)) continue;
        const gr = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, rr);
        gr.addColorStop(0, rgba(BS.farbe, BS.feldGlut.alpha)); gr.addColorStop(1, rgba(BS.farbe, 0));
        ctx.fillStyle = gr; ctx.fillRect(b.x - rr, b.y - rr, rr * 2, rr * 2);
      }
      // Navigationsbojen: Leuchtmarken in der Ebene (Eisblau), ohne Beschriftung
      const BN = TK.BOJE.nav;
      for (const b of L.bojen) {
        if (!sichtbar(sicht, b.x, b.y, BN.glut.radius)) continue;
        const gr = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, BN.glut.radius);
        gr.addColorStop(0, rgba(BN.glut.mitte, BN.glut.alphaMitte)); gr.addColorStop(1, rgba(BN.farbe, 0));
        ctx.fillStyle = gr; ctx.fillRect(b.x - BN.glut.radius, b.y - BN.glut.radius, BN.glut.radius * 2, BN.glut.radius * 2);
        const rt = BN.raute, sm = BN.saum;
        if (sm) { ctx.fillStyle = rgba(sm.farbe, sm.alpha); ctx.beginPath(); ctx.moveTo(b.x, b.y - rt.halbH - sm.plus); ctx.lineTo(b.x + rt.halbB + sm.plus, b.y); ctx.lineTo(b.x, b.y + rt.halbH + sm.plus); ctx.lineTo(b.x - rt.halbB - sm.plus, b.y); ctx.closePath(); ctx.fill(); }
        ctx.fillStyle = rt.farbe; ctx.beginPath(); ctx.moveTo(b.x, b.y - rt.halbH); ctx.lineTo(b.x + rt.halbB, b.y); ctx.lineTo(b.x, b.y + rt.halbH); ctx.lineTo(b.x - rt.halbB, b.y); ctx.closePath(); ctx.fill();
      }
    } catch (e) { melde(e); } finally { ctx.restore(); }
  }

  const API = { zeichne, plan, randPunkt };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.KulisseHimmel = API;
})(typeof window !== 'undefined' ? window : globalThis);
