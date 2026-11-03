// KUL-03 D: Lagescheibe des Visiers (Draufsicht unten rechts, Mockup bplus-visier.html lagescheibe()). Schicht 'lage' (Rang 30) im Visier-Zeichner; eigene Datei, liest den Zustand direkt.
// Schiff oben (Bug = Kurs des eigenen Schiffs nach oben), Rand = reichweiteWelt (800), ALLE Kontakte rundum, auch hinter dem Schiff; was weiter weg liegt, klemmt am Rand.
// Kontakte nur als Punkte ohne Klassendetail (3-4 px): Gegner (Hellrot), Verbündete (Eisblau), Ziel der Ops (Bernstein, Consoles.targetOf), Sprungboje und Sprungpunkt (Messing), Station (Mint).
// Blickfeld des Schirms als Keil (±atan(W/2 · cos(Neigung) / F), aus Visier.kamera()), eigene Schilde als Ring um das Schiffssymbol (vier Seiten wie die Ops-Kennung). Keine Texte.
//   VisierLage.geometrie(kamera)            { cx, cy, R, rand, massstab } in Texturpixeln
//   VisierLage.abbilden(ship, wx, wy, geo)  Weltpunkt -> { x, y, d, geklemmt, f, r }; f voraus, r Steuerbord; Kurs dreht mit (Weltwinkel 0 = +x, Uhrzeigersinn, wie Visier.projiziereWelt)
//   VisierLage.keilGrad(kamera)             halber waagrechter Blickwinkel in Grad
//   VisierLage.schildStufen(ship)           [Bug, Steuerbord, Heck, Backbord] je 0..4 oder null ohne Schilde im Snapshot
//   VisierLage.kontakte(view)               Rohliste { art, id, x, y, ziel } (Weltpunkte, ohne Abbildung); art gegner | verbuendet | sprung | station | verborgen
//   VisierLage.plan(view, ship, kamera)     reine Lage { geo, kontakte[{ art, x, y, geklemmt, ziel }], keilGrad, schild, ship }
//   VisierLage.flaeche(kamera)              belegtes Rechteck { x, y, w, h } (Scheibe samt Rand), für Überlappungsproben
//   VisierLage.zeichne(ctx, view, plan, kamera)  die Schicht; meldet sich selbst an (Visier.registriereSchicht)
(function (root) {
  'use strict';

  const ok = Number.isFinite;
  const RAD = Math.PI / 180;
  const T = () => root.HauptschirmTokens.TOKENS;
  function rgba(hex, a) { const n = parseInt(String(hex).slice(1, 7), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
  let gemeldet = false;
  function melde(e) { if (gemeldet) return; gemeldet = true; try { if (root.Net && root.Net.reportError) root.Net.reportError('VisierLage', e); } catch (x) { /* egal */ } }
  const liste = (l) => (Array.isArray(l) ? l.filter((p) => p && ok(p.x) && ok(p.y)) : []);

  function geometrie(kam) {
    const LG = T().VISIER.lagescheibe;
    return { cx: kam.W + LG.cx, cy: kam.H + LG.cy, R: LG.radius, rand: LG.radius + LG.grund.plus, massstab: LG.radius / LG.reichweiteWelt };
  }
  function flaeche(kam) { const g = geometrie(kam); return { x: g.cx - g.rand, y: g.cy - g.rand, w: 2 * g.rand, h: 2 * g.rand }; }
  // Blickfeld auf der Flugebene: die Neigung staucht die Tiefe um cos(Neigung), also atan(W/2 * cp / F) (wie das Peilband, visier-leiste.js); ohne cp laege der Keil ~1 Grad zu breit (N1 B5)
  function keilGrad(kam) { return Math.atan((kam.W / 2) * kam.cp / kam.F) / RAD; }

  // Weltpunkt -> Scheibe: voraus oben, Steuerbord rechts. Außerhalb der Reichweite am Rand (R - randPad) geklemmt.
  function abbilden(ship, wx, wy, geo) {
    const LG = T().VISIER.lagescheibe, dx = wx - ship.x, dy = wy - ship.y, a = ship.angle || 0, ca = Math.cos(a), sa = Math.sin(a);
    const f = dx * ca + dy * sa, r = -dx * sa + dy * ca;
    let px = r * geo.massstab, py = -f * geo.massstab;
    const d = Math.hypot(px, py), grenze = geo.R - LG.randPad;
    const geklemmt = d > grenze;
    if (geklemmt) { px *= grenze / d; py *= grenze / d; }
    return { x: geo.cx + px, y: geo.cy + py, d: Math.hypot(dx, dy), geklemmt, f, r };
  }

  // Schildseiten 0..4 aus dem Snapshot (ship.shields.current / cap / alloc); 0 = offen (rot gestrichelt). Ohne Schilde im Snapshot: null (kein Ring).
  function schildStufen(ship) {
    const sh = ship && ship.shields, cur = sh && sh.current;
    if (!Array.isArray(cur) || cur.length < 4) return null;
    const out = [];
    for (let i = 0; i < 4; i++) {
      const c = Number(cur[i]); if (!ok(c) || c <= 0) { out.push(0); continue; }
      const cap = Array.isArray(sh.cap) ? Number(sh.cap[i]) : Number(sh.cap), al = Array.isArray(sh.alloc) ? Number(sh.alloc[i]) : Number(sh.alloc);
      const mx = Math.max(c, ok(cap) ? cap : 0, ok(al) ? al : 0);
      out.push(Math.max(1, Math.min(4, Math.ceil(c / mx * 4 - 1e-9))));
    }
    return out;
  }

  // Rohkontakte aus dem Snapshot (dieselben Listen wie die Frontsicht, Erkundung KUL-03 Frage 1)
  function kontakte(view) {
    const st = view && view.state; if (!st) return [];
    const sp = st.space || {}, out = [];
    let tg = null;
    try { tg = root.Consoles && root.Consoles.targetOf ? root.Consoles.targetOf(view) : null; } catch (e) { tg = null; }
    const zielId = tg && tg.id != null ? tg.id : (st.ship && st.ship.target != null ? st.ship.target : null);
    const istZiel = (id) => zielId != null && id === zielId;
    for (const e of liste(view.enemies)) out.push({ art: 'gegner', id: e.id, x: e.x, y: e.y, ziel: istZiel(e.id) });
    for (const e of liste(view.escorts)) out.push({ art: 'verbuendet', id: e.id, x: e.x, y: e.y, ziel: false });
    for (const b of liste(sp.jp)) out.push({ art: 'sprung', id: null, x: b.x, y: b.y, ziel: false });
    const mk = liste(sp.markers);
    for (const m of mk) if (m.kind === 'exit') out.push({ art: 'sprung', id: null, x: m.x, y: m.y, ziel: false });
    const STATION = { station: 1, buoy: 1, vaelen: 1, wreck: 1, relay: 1 };   // wie Render.stationOf: das eine Hauptobjekt 'station' (Mond/Planet sind Kulisse, Posten ohne)
    const so = mk.find((m) => m.kind !== 'dock' && !m.posten && STATION[m.kind]);
    if (so) out.push({ art: 'station', id: 'station', x: so.x, y: so.y, ziel: istZiel('station') });
    if (tg && tg.hidden && tg.id !== 'station' && ok(tg.x) && ok(tg.y)) out.push({ art: 'verborgen', id: tg.id, x: tg.x, y: tg.y, ziel: true });
    return out;
  }

  function plan(view, ship, kam) {
    ship = ship || (view && ((view.ship) || (view.state && view.state.ship)));
    if (!ship || !ok(ship.x) || !ok(ship.y) || !ok(ship.angle) || !kam) return null;
    const geo = geometrie(kam), st = view && view.state;
    const ks = kontakte(view).map((k) => { const q = abbilden(ship, k.x, k.y, geo); return { art: k.art, x: q.x, y: q.y, geklemmt: q.geklemmt, ziel: k.ziel, d: q.d }; });
    ks.sort((a, b) => (a.ziel ? 1 : 0) - (b.ziel ? 1 : 0));   // das Ziel zuletzt: liegt obenauf
    return { geo, kontakte: ks, keilGrad: keilGrad(kam), schild: schildStufen((st && st.ship) || ship), ship };
  }

  // ------------------------------------------------------------ Zeichnen
  function quadrat(ctx, x, y, px, farbe) { const h = px / 2; ctx.fillStyle = farbe; ctx.fillRect(Math.round(x - h), Math.round(y - h), px, px); }
  function raute(ctx, x, y, px, farbe) {   // Sprungboje: kleine Raute (Plus aus 3 + 3 Pixeln), von den quadratischen Punkten unterscheidbar
    const cx = Math.round(x), cy = Math.round(y), h = Math.floor(px / 2);
    ctx.fillStyle = farbe; ctx.fillRect(cx - h, cy, 2 * h + 1, 1); ctx.fillRect(cx, cy - h, 1, 2 * h + 1);
  }

  function schildring(ctx, x, y, stufen) {
    const S = T().VISIER.lagescheibe.schildring;
    for (let i = 0; i < 4; i++) {
      const mid = -Math.PI / 2 + i * Math.PI / 2, a0 = mid - Math.PI / 4 + S.luecke, a1 = mid + Math.PI / 4 - S.luecke, v = stufen[i];
      ctx.beginPath(); ctx.arc(x, y, S.radius, a0, a1);
      if (v <= 0) { ctx.strokeStyle = rgba(S.leer.farbe, S.leer.alpha); ctx.setLineDash(S.leer.strich); ctx.lineWidth = S.leer.breite; }
      else { ctx.strokeStyle = rgba(S.farbe, S.alphaGrund + v * S.alphaJeStufe); ctx.setLineDash([]); ctx.lineWidth = S.breiteGrund + v * S.breiteJeStufe; }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  function zeichne(ctx, view, L, kam) {
    const TK = root.HauptschirmTokens && root.HauptschirmTokens.TOKENS;
    if (!ctx || !TK || !TK.VISIER || !kam) return;
    const P = plan(view, L && L.ship, kam); if (!P) return;
    const LG = TK.VISIER.lagescheibe, g = P.geo, FA = TK.FARBE;
    ctx.fillStyle = rgba(LG.grund.farbe, LG.grund.alpha); ctx.beginPath(); ctx.arc(g.cx, g.cy, g.rand, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = LG.rand.breite; ctx.setLineDash([]);
    ctx.strokeStyle = rgba(LG.rand.farbe, LG.rand.alpha); ctx.beginPath(); ctx.arc(g.cx, g.cy, g.R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = rgba(LG.mitte.farbe, LG.mitte.alpha); ctx.beginPath(); ctx.arc(g.cx, g.cy, g.R * LG.mitte.anteil, 0, Math.PI * 2); ctx.stroke();
    // Blickfeld des Schirms (Keil)
    const kw = P.keilGrad * RAD;
    ctx.strokeStyle = rgba(LG.keil.farbe, LG.keil.alpha);
    ctx.beginPath(); ctx.moveTo(g.cx, g.cy); ctx.lineTo(g.cx - Math.sin(kw) * g.R, g.cy - Math.cos(kw) * g.R); ctx.moveTo(g.cx, g.cy); ctx.lineTo(g.cx + Math.sin(kw) * g.R, g.cy - Math.cos(kw) * g.R); ctx.stroke();
    // Kontakte: nur Punkte; innerhalb der Scheibe geclippt, geklemmte am Rand
    const PK = LG.punkt;
    for (const k of P.kontakte) {
      if (k.ziel) {   // Ziel der Ops: größerer Punkt in Bernstein mit offenem Rahmen darum, hebt sich von den roten Punkten ab
        const z = PK.ziel, h = Math.round(z.px / 2) + z.rahmen.pad;
        ctx.strokeStyle = rgba(z.farbe, z.rahmen.alpha); ctx.lineWidth = 1; ctx.strokeRect(Math.round(k.x) - h + 0.5, Math.round(k.y) - h + 0.5, 2 * h - 1, 2 * h - 1);
        quadrat(ctx, k.x, k.y, z.px, z.farbe); continue;
      }
      if (k.art === 'gegner') quadrat(ctx, k.x, k.y, PK.gegner.px, PK.gegner.farbe);
      else if (k.art === 'verbuendet') quadrat(ctx, k.x, k.y, PK.verbuendet.px, PK.verbuendet.farbe);
      else if (k.art === 'sprung') raute(ctx, k.x, k.y, PK.sprungboje.px + 2, PK.sprungboje.farbe);
      else if (k.art === 'station') quadrat(ctx, k.x, k.y, PK.station.px, PK.station.farbe);
    }
    if (P.schild) schildring(ctx, g.cx, g.cy, P.schild);
    const S = LG.schiff; ctx.fillStyle = S.farbe;
    ctx.fillRect(Math.round(g.cx + S.rumpf[0]), Math.round(g.cy + S.rumpf[1]), S.rumpf[2], S.rumpf[3]);
    ctx.fillRect(Math.round(g.cx + S.fluegel[0]), Math.round(g.cy + S.fluegel[1]), S.fluegel[2], S.fluegel[3]);
  }

  const API = { geometrie, flaeche, keilGrad, abbilden, schildStufen, kontakte, plan, zeichne };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.VisierLage = API;
  if (root.Visier && root.Visier.registriereSchicht) root.Visier.registriereSchicht('lage', 30, zeichne);
})(typeof window !== 'undefined' ? window : globalThis);
