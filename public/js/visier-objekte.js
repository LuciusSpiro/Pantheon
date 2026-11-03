// KUL-03 B1: Objekte und Marken des Visiers (Schicht 'objekte', Rang 10, über der Glasebene aus visier.js). Zeichnet nach Tiefe (hinten zuerst):
// Gegner und Verbündete (Schildring flach auf der Ebene, Drehsprite auf die Ebene gelegt und gestaucht, Saum, Dunst, Marke fester Größe mit Hüllenbalken),
// Ziel der Ops (Klammern + „ZIEL <Entfernung>“, die einzige Textmarke), Bojen und Sprungpunkte (Lichtsäule, Sprungfeld), Stationen, Dock-Ring,
// dazu grob (KUL-04: Redesign) Asteroiden, Projektile, Strahlen, Minen, Tele-Ladungen, Fracht, Bergung, Verborgenes.
// Beschriftungen mit Namen/Entfernung und Randpfeile sind B2. Der klassische Zeichner (render.js, drawSpace) kennt diese Datei nicht.
//   VisierObjekte.baue(view, plan, kamera)   reine Lage { objekte[] (hinten zuerst, mit tiefe/bb), schuesse[], striche[] } ohne Zeichnen; null ohne Schiff
//   VisierObjekte.groesse(laenge, k)         { faktor, welt, px }: max(1,6; 16 px / Bildlänge), höchstens 3,2-fach
//   VisierObjekte.dunst(tiefe)               Dunstanteil ab 280, höchstens 38 %
//   VisierObjekte.marke(bb)                  Rechteck der Gegnermarke (20 × 10, fest) über dem Modell
//   VisierObjekte.letzte()                   die zuletzt gezeichnete Lage (für B2: Beschriftung, Randpfeile)
// Koordinaten: Visier.projiziereWelt(ship, wx, wy, h); X = Steuerbord, Z = voraus (siehe visier.js). Alle Maße und Farben: HauptschirmTokens.TOKENS.VISIER.objekt.
(function (root) {
  'use strict';

  const ok = Number.isFinite;
  const TK = () => root.HauptschirmTokens.TOKENS;
  const VS = () => root.Visier;
  function rgba(hex, a) { const n = parseInt(String(hex).slice(1, 7), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
  let gemeldet = false;
  function melde(e) { if (gemeldet) return; gemeldet = true; try { if (root.Net && root.Net.reportError) root.Net.reportError('VisierObjekte', e); } catch (x) { /* egal */ } }

  // Längen in Welteinheiten, solange das Manifest die Sprites nicht kennt (Voxelwerk-Klassen; Sprite-Länge = Welt-Länge, 1 : 1 in der klassischen Frontsicht)
  const LAENGE = { raider: 32, korvette: 68, fregatte: 88, kreuzer: 104, frachter: 76, sentinel: 44, pylon: 36, relay: 24, scavenger: 44 };
  const KLASSE = { raider: 'jaeger', korvette: 'korvette', fregatte: 'fregatte', kreuzer: 'kreuzer' };   // Art.SPR_KLASSE (Draufsicht-Sprites)
  const SET = { raider: 'rostmeute', korvette: 'rostmeute', fregatte: 'nord', kreuzer: 'nord' };          // Art.SPR_STANDARD_SET
  const KENNUNG_KLASSE = { raider: 1, korvette: 1, fregatte: 1, kreuzer: 1, frachter: 1 };
  const STATION_ART = { station: 'port', buoy: 'buoy', vaelen: 'vaelen', wreck: 'wreck', relay: 'relay' };   // render.js STATION_ART ohne moon/planet (Kulisse, kommt aus dem Himmel)
  const STATION_MASS = { port: [250, 160], buoy: [140, 84], vaelen: [300, 140], wreck: [320, 150], relay: [240, 240] };   // Spritegröße (art.js drawStation)
  const FEIND = /^(enemy|emp|etorpedo|estreu|sperr)/;

  // ------------------------------------------------------------ reine Maße
  function groesse(laenge, k) {
    const G = TK().VISIER.objekt.gegner, faktor = Math.min(G.maxFaktor, Math.max(G.faktor, G.minPx / Math.max(1e-6, laenge * k)));
    return { faktor, welt: laenge * faktor, px: laenge * faktor * k };
  }
  function dunst(tiefe) { const D = TK().VISIER.objekt.gegner.dunst; return Math.max(0, Math.min(D.max, (tiefe - D.ab) / D.spanne)); }
  function marke(bb) {
    const M = TK().VISIER.objekt.marke, cx = (bb.x0 + bb.x1) / 2;
    return { x0: cx - M.w / 2, y0: bb.y0 - M.abstand - M.h, x1: cx + M.w / 2, y1: bb.y0 - M.abstand, cx };
  }
  // Höhenstauchung des Sprites auf der Ebene: Bildneigung der Ebene am Fußpunkt (px senkrecht je Welteinheit voraus / px waagerecht je Welteinheit), begrenzt
  function stauch(r, f, k) {
    const S = TK().VISIER.objekt.gegner.stauch, a = VS().projiziere(r, f, 0), b = VS().projiziere(r, f + 10, 0);
    if (!(a.ok && b.ok && k > 0)) return S.fest;
    return Math.max(S.min, Math.min(S.max, Math.abs(a.y - b.y) / 10 / k));
  }

  // ------------------------------------------------------------ Sprites (Art) und Rückfall (Kennung)
  function spriteVon(kind, freund) {
    const A = root.Art, klasse = KLASSE[kind];
    if (!klasse || !A || !A.hasEnemySprite) return null;
    let da = false;
    try { da = A.hasEnemySprite(kind, freund ? 'rom' : undefined); } catch (e) { return null; }
    if (!da) return null;
    const m = A.spriteManifest && A.spriteManifest(), set = freund ? 'rom' : SET[kind];
    const info = m && m.sprites && (m.sprites[klasse + '/' + set] || m.sprites[klasse + '/nord']);
    return info ? { info, set } : null;
  }
  const silCache = new Map();
  function silhouette(kind, freund, stufe, farbe, info) {   // Umriss des Sprites einfarbig (einmal je Klasse/Stufe), für Saum und Dunst
    if (typeof document === 'undefined') return null;
    const key = kind + '|' + (freund ? 1 : 0) + '|' + stufe + '|' + farbe;
    let c = silCache.get(key);
    if (c) return c;
    if (silCache.size > 600) silCache.clear();
    const SZ = Math.max(info.frame[0], info.frame[1]) + 8;
    c = document.createElement('canvas'); c.width = c.height = SZ;
    const g = c.getContext('2d');
    try {
      root.Art.drawEnemy(g, kind, SZ / 2, SZ / 2, stufe / 64 * Math.PI * 2, { hpFrac: 1, hitT: 99, time: 0, fraktion: freund ? 'rom' : undefined });
      g.globalCompositeOperation = 'source-in'; g.fillStyle = farbe; g.fillRect(0, 0, SZ, SZ);
    } catch (e) { melde(e); }
    silCache.set(key, c);
    return c;
  }

  // ------------------------------------------------------------ Lage (rein)
  function boden(ship, wx, wy) { return VS().projiziereWelt(ship, wx, wy, 0); }
  function imBild(p, rand, c, leisteY) { return p.ok && p.x > -rand && p.x < c.W + rand && p.y < leisteY; }

  function asteroiden(st) {   // wie render.js brockenJetzt: bewegte Brocken zur Spielzeit
    const list = (st.space && st.space.asteroids) || [], D = root.Shared_Drift;
    if (!Array.isArray(list)) return [];
    if (!D || !D.bewegt(list)) return list;
    const seit = st._empfangen && typeof performance !== 'undefined' ? Math.max(0, Math.min(0.25, (performance.now() - st._empfangen) / 1000)) : 0;
    return D.jetzt(list, (+st.time || 0) + seit);
  }

  function baue(view, L, c) {
    const st = view && view.state, ship = L && L.ship;
    if (!st || !ship || !ok(ship.x) || !ok(ship.y) || !ok(ship.angle) || !VS()) return null;
    const TKS = TK(), OB = TKS.VISIER.objekt, G = OB.gegner, leisteY = c.H - TKS.VISIER.leiste.hoehe - 4;
    const sp = st.space || {}, KH = root.KulisseHimmel;
    const si = KH && KH.sichtVon ? KH.sichtVon(st) : { sc: {}, fog: false, imSicht: () => true };
    let ziel = null;
    try { ziel = root.Consoles && root.Consoles.targetOf ? root.Consoles.targetOf(view) : null; } catch (e) { ziel = null; }
    const aus = { objekte: [], schuesse: [], striche: [], ship, ziel };
    const O = aus.objekte, num = (v) => (ok(v) ? v : 0);

    const schiff = (e, freund) => {
      if (!e || !ok(e.x) || !ok(e.y) || !si.imSicht(e, 0)) return;
      const p = VS().projiziereWelt(ship, e.x, e.y, 0);
      if (!imBild(p, 0, c, leisteY)) return;
      const kind = e.kind, sprite = spriteVon(kind, freund), L0 = (sprite && sprite.info.lengthPx) || LAENGE[kind] || 40;
      const gr = groesse(L0, p.k), hp = e.hpMax > 0 ? Math.max(0, Math.min(1, e.hp / e.hpMax)) : 1;
      const ph = VS().projiziereWelt(ship, e.x, e.y, G.hebe), sq = stauch(p.r, p.f, p.k);
      const th = (num(e.angle) - ship.angle - Math.PI / 2);   // Leinwandwinkel: Bug nach oben = voraus
      const ct = Math.cos(th), sn = Math.sin(th), hl = gr.px / 2, hw = Math.max(gr.px * 0.18, sprite ? sprite.info.widthPx * (gr.px / L0) / 2 : 0);
      const ex = Math.abs(ct) * hl + Math.abs(sn) * hw, ey = (Math.abs(sn) * hl + Math.abs(ct) * hw) * sq;
      const bb = { x0: ph.x - ex, x1: ph.x + ex, y0: ph.y - ey, y1: ph.y + ey };
      O.push({ art: 'gegner', e, freund, tiefe: p.tiefe, p, ph, sprite, kind, laenge: L0, gr, hp, sq, th, bb, dunst: dunst(p.tiefe),
        ziel: !!(ziel && !ziel.hidden && !ziel.station && ziel.id === e.id), entf: Math.hypot(e.x - ship.x, e.y - ship.y) });
    };
    for (const e of view.enemies || []) schiff(e, false);
    for (const e of view.escorts || []) schiff(e, true);

    // Orte: Stationen, Dock-Ring, Sprungpunkte
    for (const m of sp.markers || []) {
      if (!m || !ok(m.x) || !ok(m.y)) continue;
      const p = boden(ship, m.x, m.y);
      if (m.kind === 'dock' || m.kind === 'exit') {
        const R = Math.max(1, m.r || (m.kind === 'dock' ? 70 : 140));
        if (p.ok && p.x > -R * p.k - 40 && p.x < c.W + R * p.k + 40) O.push({ art: m.kind === 'dock' ? 'dock' : 'sprungfeld', tiefe: p.tiefe, p, R, m });
        continue;
      }
      const art = STATION_ART[m.kind];
      if (!art) continue;
      const mass = STATION_MASS[art], sc = stationMass(), s = p.k * sc, sq = stauch(p.r, p.f, p.k);
      if (!p.ok || p.x < -mass[0] * s || p.x > c.W + mass[0] * s) continue;
      const bb = { x0: p.x - mass[0] * s / 2, x1: p.x + mass[0] * s / 2, y0: p.y - mass[1] * s * sq / 2, y1: p.y + mass[1] * s * sq / 2 };
      O.push({ art: 'station', tiefe: p.tiefe, p, m, kindArt: art, s, sq, bb, hauptziel: !m.posten, ziel: !!(ziel && ziel.station && !m.posten && ziel.x === m.x && ziel.y === m.y), entf: Math.hypot(m.x - ship.x, m.y - ship.y) });
    }
    // Sprungbojen (bekannte) und Navigationsbojen der Szene
    for (const j of Array.isArray(sp.jp) ? sp.jp : []) {
      if (!j || !ok(j.x) || !ok(j.y)) continue;
      const p = boden(ship, j.x, j.y);
      if (imBild(p, 40, c, c.H + 80)) O.push({ art: 'sprungboje', tiefe: p.tiefe, p, j });
    }
    for (const b of Array.isArray(si.sc.bojen) ? si.sc.bojen : []) {
      if (!b || !ok(b.x) || !ok(b.y) || !si.imSicht(b, 0)) continue;
      const p = boden(ship, b.x, b.y);
      if (imBild(p, 40, c, c.H + 80)) O.push({ art: 'navboje', tiefe: p.tiefe, p, b });
    }
    // KUL-04: Redesign – grobe Marken
    const GR = OB.grob;
    for (const a of asteroiden(st)) {
      if (!a || !ok(a.x) || !ok(a.y) || !si.imSicht(a, a.r || 0)) continue;
      const p = boden(ship, a.x, a.y), r = Math.max(4, a.r || 20);
      if (p.ok && p.x > -r * p.k - 4 && p.x < c.W + r * p.k + 4) O.push({ art: 'asteroid', tiefe: p.tiefe, p, a, r });
    }
    for (const m of sp.mines || []) { if (m && ok(m.x) && ok(m.y)) { const p = boden(ship, m.x, m.y); if (imBild(p, 20, c, c.H + 40)) O.push({ art: 'mine', tiefe: p.tiefe, p, m }); } }
    for (const f of (st.fracht && st.fracht.draussen) || []) { if (f && ok(f.x) && ok(f.y)) { const p = boden(ship, f.x, f.y); if (imBild(p, 20, c, c.H + 40)) O.push({ art: 'fracht', tiefe: p.tiefe, p, f }); } }
    for (const v of sp.salvage || []) { if (v && ok(v.x) && ok(v.y)) { const p = boden(ship, v.x, v.y); if (imBild(p, 20, c, c.H + 40)) O.push({ art: 'bergung', tiefe: p.tiefe, p, v }); } }
    for (const h of sp.hidden || []) { if (h && ok(h.x) && ok(h.y)) { const p = boden(ship, h.x, h.y); if (imBild(p, 20, c, c.H + 40)) O.push({ art: 'verborgen', tiefe: p.tiefe, p, h, ziel: !!(ziel && ziel.hidden && !ziel.station && ziel.id === h.id) }); } }
    O.sort((a, b) => b.tiefe - a.tiefe);

    // Projektile und Strahlen (Höhe wie im Snapshot: Ebene + schuss.hoehe)
    const S = OB.schuss;
    for (const pr of view.spaceProjectiles || []) {
      if (!pr || !ok(pr.x) || !ok(pr.y)) continue;
      const a = VS().projiziereWelt(ship, pr.x, pr.y, S.hoehe);
      if (!a.ok || a.y > c.H) continue;
      const w = num(pr.angle), b = VS().projiziereWelt(ship, pr.x - Math.cos(w) * S.welt, pr.y - Math.sin(w) * S.welt, S.hoehe);
      aus.schuesse.push({ a, b, feind: FEIND.test(String(pr.kind || '')), kind: pr.kind });
    }
    for (const be of sp.beams || []) {
      if (!be || !ok(be.x1) || !ok(be.y1) || !ok(be.x2) || !ok(be.y2)) continue;
      const a = VS().projiziereWelt(ship, be.x1, be.y1, S.hoehe), b = VS().projiziereWelt(ship, be.x2, be.y2, S.hoehe);
      if (a.ok && b.ok) aus.striche.push({ a, b, feind: FEIND.test(String(be.kind || '')) || /^enemy/.test(String(be.kind || '')) });
    }
    return aus;
  }
  let stationSkala = null;
  function stationMass() {   // wie render.js STATION_SPRITE_SCALE: Heck der angedockten Lerche am Armende
    if (stationSkala != null) return stationSkala;
    const C = root.Shared_Config, p = C && C.scenes && C.scenes.port;
    if (!p || !p.start || !p.station) return (stationSkala = 1);
    return (stationSkala = Math.max(0.5, (Math.hypot(p.start.x - p.station.x, p.start.y - p.station.y) - 36) / 110));
  }

  // ------------------------------------------------------------ Zeichnen
  // Bogen auf der Ebene um (r0 Steuerbord, f0 voraus), Winkel a0..a1 vom Bug aus Richtung Steuerbord; Pfad, Aufrufer streicht
  function bogenPfad(ctx, r0, f0, R, a0, a1, n, tiefeMin) {
    let neu = true;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n, p = VS().projiziere(r0 + Math.sin(a) * R, f0 + Math.cos(a) * R, 0);
      if (!(p.tiefe >= tiefeMin)) { neu = true; continue; }
      if (neu) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      neu = false;
    }
  }
  function raute(ctx, x, y, hw, hh) { ctx.beginPath(); ctx.moveTo(x, y - hh); ctx.lineTo(x + hw, y); ctx.lineTo(x, y + hh); ctx.lineTo(x - hw, y); ctx.closePath(); }

  function seitenStufen(e) {   // Schildstufen 0..4 je Seite (Bug, Steuerbord, Heck, Backbord) aus e.shields; null ohne Schilde
    const sh = e.shields;
    if (!Array.isArray(sh) || !sh.length) return null;
    const SC = root.Shared_Schilde, C = root.Shared_Config, lay = SC && SC.layout && C ? SC.layout(C, e.kind) : null;
    const mx = Array.isArray(e.shieldsMax) && e.shieldsMax.length === sh.length ? e.shieldsMax : lay && lay.n === sh.length ? lay.max : null;
    const out = [0, 0, 0, 0], seiten = lay && lay.n === sh.length ? lay.seiten : sh.length === 4 ? [[0], [1], [2], [3]] : [[0], [1], [2], [3]];
    for (let s = 0; s < 4; s++) {
      let v = 0, m = 0;
      for (const i of seiten[s] || []) { v += +sh[i] || 0; m += mx ? +mx[i] || 0 : 4; }
      out[s] = v <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil(v / (m || 4) * 4)));
    }
    return out;
  }

  function schildring(ctx, o, ship) {
    const SR = TK().VISIER.objekt.gegner.schildring, tm = TK().VISIER.glas.ringe.tiefeMin, werte = seitenStufen(o.e);
    if (!werte) return;
    const R = o.gr.welt * SR.radiusFaktor, rel = (+o.e.angle || 0) - ship.angle;
    for (let i = 0; i < 4; i++) {
      const mid = rel + i * Math.PI / 2, v = werte[i];
      bogenPfad(ctx, o.p.r, o.p.f, R, mid - SR.halbBogen, mid + SR.halbBogen, 10, tm);
      if (v <= 0) { ctx.setLineDash(SR.leer.strich); ctx.strokeStyle = rgba(SR.leer.farbe, SR.leer.alpha); ctx.lineWidth = SR.leer.breite; }
      else { ctx.setLineDash([]); ctx.strokeStyle = rgba(o.freund ? TK().VISIER.objekt.gegner.freund.farbe : SR.farbe, Math.min(1, SR.alphaGrund + v * SR.alphaJeStufe)); ctx.lineWidth = SR.breiteGrund + v * SR.breiteJeStufe; }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  function gegner(ctx, o, ship, t) {
    const G = TK().VISIER.objekt.gegner, e = o.e, hl = o.gr.px;
    schildring(ctx, o, ship);
    // Tele-Ladung: Ring auf der Ebene um den ladenden Gegner (KUL-04: Redesign)
    if (e.tele && !o.freund) {
      const TL = TK().VISIER.objekt.grob.tele, left = Math.max(0, +e.tele.left || 0), dur = Math.max(0.1, +e.tele.dur || left || 1), puls = 0.55 + 0.45 * Math.sin(t * (6 + 6 * (1 - left / dur)));
      bogenPfad(ctx, o.p.r, o.p.f, o.gr.welt * TL.radiusFaktor + 10, 0, Math.PI * 2, 28, 8);
      ctx.setLineDash(TL.strich); ctx.strokeStyle = rgba(TL.farbe, TL.alpha * puls); ctx.lineWidth = TL.breite; ctx.stroke(); ctx.setLineDash([]);
    }
    // Modell: Drehsprite auf die Ebene gelegt (Bug nach oben = voraus), sonst Kennung; nie ein Wurf
    const th = o.th, stufe = Math.round(th / (Math.PI * 2) * 64) & 63, x = Math.round(o.ph.x), y = Math.round(o.ph.y);
    ctx.save();
    try {
      let gezeichnet = false;
      if (o.sprite) {
        const s = o.gr.px / o.laenge, info = o.sprite.info, fr = o.freund ? 'rom' : undefined;
        const sil = silhouette(o.kind, o.freund, stufe, G.saum.farbe, info);
        ctx.imageSmoothingEnabled = true;
        if (sil) {
          const SZ = sil.width;
          ctx.globalAlpha = G.saum.alpha;
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            ctx.save(); ctx.translate(x + dx * G.saum.px, y + dy * G.saum.px); ctx.scale(s, s * o.sq); ctx.drawImage(sil, -SZ / 2, -SZ / 2); ctx.restore();
          }
          ctx.globalAlpha = 1;
        }
        ctx.save(); ctx.translate(x, y); ctx.scale(s, s * o.sq);
        gezeichnet = root.Art.drawEnemy(ctx, o.kind, 0, 0, stufe / 64 * Math.PI * 2, { hpFrac: o.hp, hitT: 99, time: t, tele: null, fraktion: fr }) !== false;
        ctx.restore();
        if (gezeichnet && o.dunst > 0.01) {
          const dsil = silhouette(o.kind, o.freund, stufe, G.dunst.farbe, info);
          if (dsil) { ctx.globalAlpha = o.dunst; ctx.save(); ctx.translate(x, y); ctx.scale(s, s * o.sq); ctx.drawImage(dsil, -dsil.width / 2, -dsil.height / 2); ctx.restore(); ctx.globalAlpha = 1; }
        }
      }
      if (!gezeichnet) {   // Rückfall: Kennung (Volk Rom für Verbündete, sonst Germanen), Größe aus der Bildlänge
        const K = root.Kennung;
        if (K && K.zeichne) {
          const volk = o.freund ? 'rom' : (e.vk || 'ger'), klasse = KENNUNG_KLASSE[o.kind] ? o.kind : 'korvette', rad = Math.max(1, K.radius(volk, klasse, 1));
          ctx.imageSmoothingEnabled = false;
          ctx.translate(x, y); ctx.scale(1, o.sq);
          K.zeichne(ctx, volk, klasse, 0, 0, th, o.freund ? G.freund.farbe : TK().VISIER.objekt.marke.winkel.farbe, Math.max(0.5, Math.min(3, hl / 2 / rad)));
        }
      }
    } catch (err) { melde(err); } finally { ctx.restore(); }
  }

  function markeZeichnen(ctx, o) {
    const M = TK().VISIER.objekt.marke, r = marke(o.bb), mx = Math.round(r.cx), my = Math.round(r.y0), W = M.w, h = M.huelle.h;
    const farbe = o.freund ? TK().VISIER.objekt.gegner.freund.farbe : o.ziel ? M.winkel.farbeZiel : M.winkel.farbe;
    ctx.fillStyle = M.huelle.spur; ctx.fillRect(mx - W / 2, my, W, h);
    ctx.fillStyle = o.freund ? TK().VISIER.objekt.gegner.freund.huelle : M.huelle.farbe; ctx.fillRect(mx - W / 2, my, Math.round(W * o.hp), h);
    ctx.fillStyle = farbe; ctx.beginPath(); ctx.moveTo(mx - M.winkel.halbB, my + M.winkel.oben); ctx.lineTo(mx + M.winkel.halbB, my + M.winkel.oben); ctx.lineTo(mx, my + M.winkel.unten); ctx.closePath(); ctx.fill();
  }
  function zielZeichnen(ctx, bb, entf) {   // Klammern um das Ziel und „ZIEL <Entfernung>“ in Skala 2 (die einzige Textmarke)
    const Z = TK().VISIER.objekt.gegner.ziel, X0 = bb.x0 - Z.pad, X1 = bb.x1 + Z.pad, Y0 = bb.y0 - Z.pad, Y1 = bb.y1 + Z.pad;
    ctx.strokeStyle = Z.farbe; ctx.lineWidth = Z.breite; ctx.setLineDash([]);
    for (const [qx, qy, dx, dy] of [[X0, Y0, 1, 1], [X1, Y0, -1, 1], [X1, Y1, -1, -1], [X0, Y1, 1, -1]]) { ctx.beginPath(); ctx.moveTo(qx + dx * Z.arm, qy); ctx.lineTo(qx, qy); ctx.lineTo(qx, qy + dy * Z.arm); ctx.stroke(); }
    const R = root.Render;
    if (R && R.textKontur) R.textKontur(ctx, Z.label.format.replace('{entfernung}', String(Math.round(entf))), Math.round((bb.x0 + bb.x1) / 2), Math.round(Y1 + Z.label.abstand), { color: Z.farbe, align: 'center', scale: Z.label.skala });
  }

  function saeule(ctx, p, welt, ship, o, farbe, alpha, breiteJeK) {   // Lichtsäule von der Spitze (0) zum Fuß (alpha)
    const top = VS().projiziere(p.r, p.f, welt);
    if (!top.ok || !(p.y > top.y)) return;
    const g = ctx.createLinearGradient(0, top.y, 0, p.y), bw = Math.max(1, Math.round(p.k * breiteJeK));
    g.addColorStop(0, rgba(farbe, 0)); g.addColorStop(1, rgba(farbe, alpha));
    ctx.fillStyle = g; ctx.fillRect(Math.round(p.x - bw / 2), top.y, bw, p.y - top.y);
  }
  function glut(ctx, p, G) {
    const rr = G.radius + p.k * G.radiusJeK, g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
    g.addColorStop(0, rgba(G.farbe, G.alpha)); g.addColorStop(1, rgba(G.farbe, 0));
    ctx.fillStyle = g; ctx.fillRect(p.x - rr, p.y - rr, rr * 2, rr * 2);
  }
  function boje(ctx, o, sprung) {   // schlichte Stellvertreterform: Mast, Raute; Lichtsäule und Glut am Fuß
    const OB = TK().VISIER.objekt.boje, B = sprung ? OB.sprung : OB.nav, p = o.p, K = TK(), top = VS().projiziere(p.r, p.f, B.laenge);
    if (sprung) {
      bogenPfad(ctx, p.r, p.f, B.feld.welt, 0, Math.PI * 2, 36, 8);
      ctx.setLineDash(B.feld.strich); ctx.strokeStyle = rgba(B.feld.farbe, B.feld.alpha); ctx.lineWidth = B.feld.breite; ctx.stroke(); ctx.setLineDash([]);
    }
    saeule(ctx, p, B.saeule.welt, null, o, B.saeule.farbe, B.saeule.alpha, B.saeule.breiteJeK);
    glut(ctx, p, B.glut);
    if (top.ok) {
      const hw = Math.max(2, p.k * (sprung ? 10 : 6)), hh = hw * 1.4;
      ctx.strokeStyle = rgba(OB.saum.farbe, OB.saum.alpha); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(top.x, top.y + hh); ctx.stroke();
      ctx.strokeStyle = rgba(sprung ? K.FARBE.sprung : K.FARBE.sensor, 1); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(top.x, top.y + hh); ctx.stroke();
      raute(ctx, top.x, top.y, hw + 1, hh + 1); ctx.fillStyle = rgba(OB.saum.farbe, OB.saum.alpha); ctx.fill();
      raute(ctx, top.x, top.y, hw, hh); ctx.fillStyle = sprung ? K.EIGEN.bojeKern : K.FARBE.sensor; ctx.fill();
    }
  }
  function sprungfeld(ctx, o) {
    const B = TK().VISIER.objekt.boje.sprung.feld;
    bogenPfad(ctx, o.p.r, o.p.f, o.R, 0, Math.PI * 2, 36, 8);
    ctx.setLineDash(B.strich); ctx.strokeStyle = rgba(B.farbe, B.alpha); ctx.lineWidth = B.breite; ctx.stroke(); ctx.setLineDash([]);
  }
  function dock(ctx, o) {   // Dock-Ring: hintere Hälfte schwach, vordere stark
    const D = TK().VISIER.objekt.station.dock;
    ctx.setLineDash(D.strich); ctx.lineWidth = D.breite;
    bogenPfad(ctx, o.p.r, o.p.f, o.R, 0, Math.PI * 2, 36, 8); ctx.strokeStyle = rgba(D.farbe, D.alphaHinten); ctx.stroke();
    bogenPfad(ctx, o.p.r, o.p.f, o.R, Math.PI / 2, Math.PI * 1.5, 18, 8); ctx.strokeStyle = rgba(D.farbe, D.alphaVorn); ctx.stroke();   // Hälfte zum Schiff hin (Z kleiner)
    ctx.setLineDash([]);
  }
  function station(ctx, o, t) {
    const A = root.Art, p = o.p;
    ctx.save();
    try {
      ctx.imageSmoothingEnabled = true;
      ctx.translate(Math.round(p.x), Math.round(p.y)); ctx.scale(o.s, o.s * o.sq);
      if (!(A && A.drawStation && A.drawStation(ctx, o.kindArt, 0, 0, { time: t, name: o.m.name }) !== false)) throw new Error('Art.drawStation');
    } catch (e) {
      ctx.restore(); ctx.save();
      const bb = o.bb; ctx.fillStyle = rgba(TK().FARBE.schild, 0.5); ctx.fillRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
    } finally { ctx.restore(); }
  }

  // KUL-04: Redesign – die groben Marken
  function asteroid(ctx, o) {
    const A = TK().VISIER.objekt.grob.asteroid, p = o.p, r = Math.min(260, Math.max(A.minPx / 2, o.r * p.k)), hh = r * 0.85;
    if (r > 6) { bogenPfad(ctx, p.r, p.f, o.r * 0.9, 0, Math.PI * 2, 20, 8); ctx.strokeStyle = rgba(A.fuss.farbe, A.fuss.alpha); ctx.lineWidth = 1; ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(p.x, p.y - hh); ctx.lineTo(p.x + r, p.y - hh * 0.15); ctx.lineTo(p.x + r * 0.55, p.y + hh * 0.8); ctx.lineTo(p.x - r * 0.6, p.y + hh * 0.75); ctx.lineTo(p.x - r, p.y - hh * 0.2); ctx.closePath();
    ctx.fillStyle = rgba(A.farbe, A.alpha); ctx.fill(); ctx.strokeStyle = rgba(A.saum, 0.8); ctx.lineWidth = 1; ctx.stroke();
    if (r > 5) { ctx.beginPath(); ctx.moveTo(p.x, p.y - hh); ctx.lineTo(p.x + r, p.y - hh * 0.15); ctx.lineTo(p.x, p.y + hh * 0.1); ctx.lineTo(p.x - r, p.y - hh * 0.2); ctx.closePath(); ctx.fillStyle = rgba(A.hell, 0.55); ctx.fill(); }
  }
  function kleinMarke(ctx, p, G, farbe, hoehe, t, strichRing) {   // Raute über der Ebene, optional Fußring und Säule
    const hw = Math.max(G.minPx / 2, G.welt * p.k / 2), top = VS().projiziere(p.r, p.f, hoehe);
    const q = top.ok ? top : p;
    raute(ctx, q.x, q.y, hw + 1, hw * 1.3 + 1); ctx.fillStyle = rgba(TK().EIGEN.tiefraum, 0.8); ctx.fill();
    raute(ctx, q.x, q.y, hw, hw * 1.3); ctx.fillStyle = farbe; ctx.fill();
    return hw;
  }
  function mine(ctx, o, t) {
    const M = TK().VISIER.objekt.grob.mine, tot = o.m.s === 0, farbe = tot ? M.aus : M.farbe;
    bogenPfad(ctx, o.p.r, o.p.f, M.welt, 0, Math.PI * 2, 16, 8); ctx.setLineDash(M.fuss.strich); ctx.strokeStyle = rgba(farbe, M.fuss.alpha); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
    kleinMarke(ctx, o.p, M, farbe, M.welt * 0.6, t);
  }
  function fracht(ctx, o, t, G, farbe) {
    saeule(ctx, o.p, G.saeule.welt, null, o, farbe, G.saeule.alpha, 4);
    kleinMarke(ctx, o.p, G, farbe, 8, t);
  }

  function zeichneObjekte(ctx, view, L, c) {
    const aus = baue(view, L, c);
    letzteLage = aus;
    if (!aus) return;
    const t = (view && +view.time) || 0, ship = aus.ship, OB = TK().VISIER.objekt, GR = OB.grob;
    for (const o of aus.objekte) {
      try {
        switch (o.art) {
          case 'gegner': gegner(ctx, o, ship, t); break;
          case 'station': station(ctx, o, t); break;
          case 'dock': dock(ctx, o); break;
          case 'sprungfeld': sprungfeld(ctx, o); break;
          case 'sprungboje': boje(ctx, o, true); break;
          case 'navboje': boje(ctx, o, false); break;
          case 'asteroid': asteroid(ctx, o); break;
          case 'mine': mine(ctx, o, t); break;
          case 'fracht': fracht(ctx, o, t, GR.fracht, GR.fracht.farbe); break;
          case 'bergung': fracht(ctx, o, t, GR.bergung, GR.bergung.farbe); break;
          case 'verborgen': kleinMarke(ctx, o.p, GR.verborgen, o.h.found ? GR.verborgen.gefunden : GR.verborgen.farbe, 6, t); break;
        }
      } catch (e) { melde(e); }
    }
    // Strahlen und Projektile, additiv (KUL-04: Redesign)
    const S = OB.schuss;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    for (const b of aus.striche) { ctx.strokeStyle = b.feind ? S.gegner : S.eigen; ctx.lineWidth = Math.min(S.breiteMax, Math.max(S.breiteMin, b.a.k * S.breiteJeK)); ctx.beginPath(); ctx.moveTo(b.a.x, b.a.y); ctx.lineTo(b.b.x, b.b.y); ctx.stroke(); }
    for (const s of aus.schuesse) { ctx.strokeStyle = s.feind ? S.gegner : S.eigen; ctx.lineWidth = Math.min(S.breiteMax, Math.max(S.breiteMin, s.a.k * S.breiteJeK)); ctx.beginPath(); ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); ctx.stroke(); }
    ctx.restore();
    // Marken über den Modellen (nach allen Objekten, damit kein Schiff sie überdeckt), dann das Ziel
    for (const o of aus.objekte) {
      if (o.art === 'gegner') { try { markeZeichnen(ctx, o); } catch (e) { melde(e); } }
    }
    for (const o of aus.objekte) {
      if (o.ziel && o.bb && (o.art === 'gegner' || o.art === 'station')) zielZeichnen(ctx, o.bb, o.entf);
      else if (o.ziel && o.art === 'verborgen') zielZeichnen(ctx, { x0: o.p.x - 8, x1: o.p.x + 8, y0: o.p.y - 14, y1: o.p.y + 4 }, Math.hypot(o.h.x - ship.x, o.h.y - ship.y));
    }
  }
  let letzteLage = null;

  const API = { silCacheGroesse: () => silCache.size, baue, groesse, dunst, marke, stauch, seitenStufen, letzte: () => letzteLage, zeichne: zeichneObjekte };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.VisierObjekte = API;
  if (root.Visier && root.Visier.registriereSchicht) root.Visier.registriereSchicht('objekte', 10, zeichneObjekte);
})(typeof window !== 'undefined' ? window : globalThis);
