// SL4 (CONCEPT-SL4): Sektorplan des Captains – echte Sektoransicht mit Positionen plus Symbolliste. Globales `SektorplanView`.
// Frontend-Layer: zeichnet nur. Ortsfestes (Stern, Planeten, Station, Bojen, Zonen, Sprungpunkte) rechnet Shared_Sektorplan.objekte(hex) aus den
// Kartendaten (wie der Server); Schiffe (Momentaufnahme mit Alter) und Marken liefert world.sektoren.p, gesichtete Hexe world.sektoren.g,
// erkundete world.sektoren.e. Zeichen kommen aus Kartenzeichen (gemeinsam mit der Hexkarte, SL1B).
// Bedienung (Captain, Reiter 5): ◄ ► / A D wählen den Sektor, H = hier, linke Maustaste setzt eine Marke, rechte entfernt die nächste.
(function () {
  'use strict';
  const R = window.Render;
  const PAL = R.PAL;
  const KZ = () => window.Kartenzeichen || null;
  const PLAN = () => window.Shared_Sektorplan || null;
  const SEK = () => window.Shared_Sektoren || null;
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d || 0);
  const V = { sel: null, map: null, objs: [] };   // sel: gewählter Hex (null = hier); map: letzte Abbildung für Mausklicks

  function hexHier(st) { const S = SEK(); return S && st.ship ? S.hexVonOrt(st.ship.scene) : null; }
  // bekannte Hexe: erkundet (world.sektoren.e) und gesichtet (g), sortiert
  function bekannte(st) {
    const sek = (st.world && st.world.sektoren) || {};
    const set = new Set([].concat(sek.e || [], sek.g || []));
    const h = hexHier(st); if (h) set.add(h);
    return [...set].sort();
  }
  function auswahl(st) { const l = bekannte(st); return V.sel && l.includes(V.sel) ? V.sel : (hexHier(st) || l[0] || null); }
  function waehle(st, dir) {
    const l = bekannte(st); if (!l.length) return;
    const i = Math.max(0, l.indexOf(auswahl(st)));
    V.sel = l[(i + dir + l.length) % l.length];
  }
  function status(st, hex) {
    const sek = (st.world && st.world.sektoren) || {};
    if ((sek.e || []).includes(hex)) return 'erkundet';
    if ((sek.g || []).includes(hex)) return 'gesichtet';
    return hex === hexHier(st) ? 'hier' : 'unbekannt';
  }

  function sprites(ctx, o, x, y, r, t) {
    const kz = KZ();
    switch (o.sym) {
      case 'stern': {
        ctx.fillStyle = '#FFD27A'; ctx.beginPath(); ctx.arc(x, y, Math.max(3, r), 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(255,210,122,0.35)'; ctx.beginPath(); ctx.arc(x, y, Math.max(5, r * 1.6), 0, 7); ctx.stroke(); break;
      }
      case 'planet': case 'gasriese': {
        ctx.fillStyle = o.sym === 'gasriese' ? '#9C7B52' : '#3F6E8C'; ctx.beginPath(); ctx.arc(x, y, Math.max(3, r), 0, 7); ctx.fill();
        if (o.sym === 'gasriese') { ctx.strokeStyle = 'rgba(244,238,220,0.35)'; ctx.beginPath(); ctx.arc(x, y, Math.max(2, r * 0.6), 0, 7); ctx.stroke(); }
        break;
      }
      case 'station': case 'hafen': {
        if (kz && o.sym === 'hafen') kz.symbol(ctx, 'hafen', x, y, { farbe: PAL.amber });
        else { ctx.strokeStyle = PAL.brass; ctx.fillStyle = 'rgba(201,151,74,0.4)'; ctx.fillRect(x - 4, y - 4, 8, 8); ctx.strokeRect(x - 4.5, y - 4.5, 9, 9); }
        break;
      }
      case 'boje': { ctx.fillStyle = PAL.mint; ctx.beginPath(); ctx.arc(x, y, 2, 0, 7); ctx.fill(); break; }
      case 'zone': { ctx.strokeStyle = 'rgba(224,71,60,0.5)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(x, y, Math.max(4, r), 0, 7); ctx.stroke(); ctx.setLineDash([]); break; }
      case 'sprungpunkt': {
        if (kz) kz.boje(ctx, o.art === 'hidden' ? 'gesperrt' : 'aktiv', x, y, 7);
        else { ctx.strokeStyle = PAL.amber; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.stroke(); }
        break;
      }
      default: { ctx.fillStyle = PAL.panelLight; ctx.fillRect(x - 2, y - 2, 4, 4); }
    }
  }

  // Fläche area { x, y, w, h }; cmd(c, extra) schickt Befehle
  function draw(ctx, view, area, cmd) {
    const st = view.state; const P = PLAN();
    const hex = auswahl(st);
    V.map = null; V.objs = [];
    const S = SEK();
    if (!P || !S || !hex) { R.text(ctx, 'Noch kein Sektor bekannt.', area.x + 4, area.y + 6, { color: PAL.panelLight }); return 'Sektorplan'; }
    const sek = (st.world && st.world.sektoren) || {};
    const stat = status(st, hex);
    const name = S.hexName ? S.hexName(hex) : hex;
    R.button(ctx, area.x, area.y, 22, 14, '<', { hotkey: 'A', onClick: () => waehle(st, -1) });
    R.button(ctx, area.x + 26, area.y, 22, 14, '>', { hotkey: 'D', onClick: () => waehle(st, 1) });
    R.button(ctx, area.x + 52, area.y, 44, 14, 'Hier', { hotkey: 'H', disabled: !hexHier(st), onClick: () => { V.sel = null; } });
    R.text(ctx, hex + ' ' + name, area.x + 102, area.y + 3, { color: PAL.amber });
    R.text(ctx, stat === 'gesichtet' ? 'gesichtet (Sonde/Karte), nicht erkundet' : stat === 'erkundet' ? 'erkundet' : stat === 'hier' ? 'hier (noch nicht erkundet)' : 'unbekannt', area.x + area.w - 140, area.y + 3, { color: PAL.panelLight, align: 'right' });
    if (stat === 'unbekannt') { R.text(ctx, 'Dieser Sektor ist dem Plan unbekannt.', area.x + 4, area.y + 24, { color: PAL.panelLight }); return 'A/D Sektor wählen'; }

    const g = P.groesse(hex) || { w: 3000, h: 2200 };
    const listW = 150;
    const mx = area.x, my = area.y + 20, mw = area.w - listW - 6, mh = area.h - 22;
    const sc0 = Math.min(mw / g.w, mh / g.h);
    const ox0 = mx + Math.round((mw - g.w * sc0) / 2), oy0 = my + Math.round((mh - g.h * sc0) / 2);
    // TB1: Zoom/Pan (kartenansicht.js, nur Client-Ansicht); je Sektor eigener Schlüssel
    const KA = window.KartenAnsicht, mapRect = { x: mx, y: my, w: mw, h: mh };
    const ab = KA ? KA.anwenden('sektorplan:' + hex, mapRect, { x: ox0, y: oy0, w: g.w * sc0, h: g.h * sc0 }) : null;
    const sc = ab ? sc0 * ab.z : sc0;
    const ox = ab ? Math.round(ab.x(ox0)) : ox0, oy = ab ? Math.round(ab.y(oy0)) : oy0;
    ctx.save(); ctx.beginPath(); ctx.rect(mx, my, mw, mh); ctx.clip();
    const toS = (x, y) => ({ x: Math.round(ox + x * sc), y: Math.round(oy + y * sc) });
    V.map = { hex, sc, ox, oy, g, mx, my, mw, mh };
    ctx.fillStyle = 'rgba(11,14,26,0.9)'; ctx.fillRect(ox, oy, Math.round(g.w * sc), Math.round(g.h * sc));
    ctx.strokeStyle = 'rgba(127,224,194,0.25)'; ctx.lineWidth = 1; ctx.strokeRect(ox + 0.5, oy + 0.5, Math.round(g.w * sc), Math.round(g.h * sc));
    // ortsfeste Objekte
    const objs = P.objekte(hex); V.objs = objs;
    const t = view.time || 0;
    for (const o of objs) {
      const p = toS(o.x, o.y);
      sprites(ctx, o, p.x, p.y, num(o.r) * sc, t);
      if (o.sym === 'hafen' || o.sym === 'station' || o.sym === 'gasriese' || o.sym === 'sprungpunkt' || (o.sym === 'planet' && o.id === 'sta')) {   // Planet mit Bodenstation (Kantenstein) trägt seinen Namen
        const txt = (o.name || '').replace('Sprungpunkt ', '→ ');
        const w = R.measure ? R.measure(txt, 1) : txt.length * 6;
        if (o.sym === 'planet') R.text(ctx, txt, p.x, p.y + Math.max(3, num(o.r) * sc) + 4, { color: PAL.panelLight, align: 'center' });   // unter der Kugel (links daneben liegt die Lerche)
        else if (p.x + 8 + w > mx + mw) R.text(ctx, txt, p.x - 8, p.y - 4, { color: PAL.panelLight, align: 'right' });   // am rechten Rand nach links
        else R.text(ctx, txt, p.x + 8, p.y - 4, { color: PAL.panelLight });
      }
    }
    // Schiffe (Momentaufnahme mit Alter)
    const ps = (sek.p && sek.p.s) || [];
    const jetzt = num(st.time);
    const schiffe = ps.filter((s) => s[0] === hex);
    for (const s of schiffe) {
      const p = toS(num(s[2]), num(s[3]));
      ctx.fillStyle = PAL.red; ctx.beginPath(); ctx.moveTo(p.x, p.y - 5); ctx.lineTo(p.x + 4, p.y + 4); ctx.lineTo(p.x - 4, p.y + 4); ctx.closePath(); ctx.fill();
      R.text(ctx, s[1] + ' · ' + P.alterText(jetzt - num(s[4])), p.x + 7, p.y - 4, { color: PAL.red });
    }
    // Marken
    const marken = ((sek.p && sek.p.m) || []).filter((m) => m[1] === hex);
    const kz = KZ();
    for (const m of marken) {
      const p = toS(num(m[2]), num(m[3]));
      const typ = m[4] === 'marke' ? 'fund' : m[4];
      if (kz) kz.marke(ctx, typ, p.x, p.y, t, { r: 6, hier: true });
      else { ctx.fillStyle = PAL.amber; ctx.fillRect(p.x - 3, p.y - 3, 6, 6); }
    }
    // Hex-Marken (Missionsziel, Notruf, Spur … aus server/sim/marken.js, derselbe Mechanismus wie auf der Hexkarte): Plaketten am Sektor
    const hm = (window.StarMap ? window.StarMap.marken : ((st.world && st.world.marken) || [])).filter((q) => q.h === hex);   // StarMap hält die Marken (kommen nur bei Änderung)
    hm.forEach((q, i) => {
      const px = ox0 + 10 + i * 18, py = oy0 + 10;   // am Bildschirm fest (nicht mit Zoom/Pan wandernd)
      if (kz) kz.marke(ctx, q.t, px, py, t, { r: 6, rest: q.b, gesamt: q.g });
    });
    // eigenes Schiff
    if (hex === hexHier(st) && st.ship) {
      const p = toS(num(st.ship.x), num(st.ship.y));
      ctx.fillStyle = PAL.mint; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 7); ctx.fill();
      R.text(ctx, 'Lerche', p.x + 6, p.y - 4, { color: PAL.mint });
    }
    if (ab) KA.knopf(ctx, R, 'sektorplan:' + hex, mapRect);
    ctx.restore();   // Kartenausschnitt (Clip)
    // Symbolliste
    const lx = area.x + area.w - listW;
    R.text(ctx, 'SYMBOLE', lx, my, { color: PAL.brass });
    let y = my + 12;
    const namen = { stern: 'Stern', planet: 'Planet', gasriese: 'Gasriese', station: 'Station', hafen: 'Hafen', boje: 'Boje', sprungpunkt: 'Sprungpunkt', zone: 'Zone' };
    const zaehl = {};
    for (const o of objs) zaehl[o.sym] = (zaehl[o.sym] || 0) + 1;
    for (const k of Object.keys(zaehl)) {
      if (y > area.y + area.h - 12) break;
      sprites(ctx, { sym: k, art: 'open' }, lx + 5, y + 4, 3, t);
      R.text(ctx, (namen[k] || k) + (zaehl[k] > 1 ? ' × ' + zaehl[k] : ''), lx + 14, y, { color: PAL.star || '#F4EEDC' }); y += 11;
    }
    if (schiffe.length) { R.text(ctx, schiffe.length + ' Schiff' + (schiffe.length === 1 ? '' : 'e') + ' (Momentaufnahme)', lx, y, { color: PAL.red }); y += 11; }
    if (marken.length) { R.text(ctx, marken.length + ' Marke' + (marken.length === 1 ? '' : 'n'), lx, y, { color: PAL.amber }); y += 11; }
    y += 3;
    R.text(ctx, 'Linksklick: Marke', lx, Math.min(y, area.y + area.h - 22), { color: PAL.panelLight });
    R.text(ctx, 'Rechtsklick: entfernen', lx, Math.min(y + 10, area.y + area.h - 11), { color: PAL.panelLight });
    return 'A/D Sektor · H hier · Rad Zoom · Ziehen · 0 zurück · Klick: Marke';
  }

  // Mausklick im Plan -> true, wenn verbraucht. x, y in Bildschirmkoordinaten des Konsolenbilds
  function click(view, x, y, button, cmd) {
    const m = V.map; if (!m) return false;
    if (x < m.mx || y < m.my || x >= m.mx + m.mw || y >= m.my + m.mh) return false;   // TB1: nur im Kartenausschnitt (gezoomt ragt die Karte darüber hinaus)
    const wx = (x - m.ox) / m.sc, wy = (y - m.oy) / m.sc;
    if (wx < 0 || wy < 0 || wx > m.g.w || wy > m.g.h) return false;
    if (button === 2) {
      const marken = (((view.state.world || {}).sektoren || {}).p || {}).m || [];
      let best = null, bd = 14 / m.sc;
      for (const k of marken) { if (k[1] !== m.hex) continue; const d = Math.hypot(k[2] - wx, k[3] - wy); if (d < bd) { bd = d; best = k; } }
      if (best) cmd('captain.sektorplan.entfernen', { id: best[0] });
      return true;
    }
    cmd('captain.sektorplan.marke', { hex: m.hex, x: Math.round(wx), y: Math.round(wy) });
    return true;
  }

  function key(code, view) {
    const st = view.state;
    if (code === 'ArrowLeft' || code === 'KeyA') { waehle(st, -1); return true; }
    if (code === 'ArrowRight' || code === 'KeyD') { waehle(st, 1); return true; }
    if (code === 'KeyH') { V.sel = null; return true; }
    return false;
  }

  window.SektorplanView = { draw, click, key, auswahl, bekannte };
})();
