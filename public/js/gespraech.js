// SL2 Gespräche und belebte Außenposten (Client): Sprechblasen über den Köpfen, Gesprächsfenster unten, Passanten (Kulisse), Gebäudeschilder.
// Datenquellen (Server): Snapshot `gp` { id, nid, n, x, y, t, z, zn, w?: [[optionId, Text]], a? } nur während eines Gesprächs; Ereignis awayMap
// mit `ku` und `seed` (Passanten, Schilder; shared/kulisse.js rechnet Ort und Spruch aus Seed + Zeit, nichts davon steht im Snapshot).
//   Gespraech.aktiv(st)                      läuft ein Gespräch?
//   Gespraech.kulisse(st, zeit)              Passanten der aktuellen Außenkarte als NSC-Liste (für view.npcs; k: 1, blase?)
//   Gespraech.schilder(st)                   [{ name, x, y, hoehe }] Gebäudeschilder der Karte (Pixel der Außenkarte)
//   Gespraech.blase(ctx, text, x, y, o)      Sprechblase mit Spitze nach unten bei (x, y) = Kopfhöhe
//   Gespraech.fenster(ctx, st)               Gesprächsfenster (Name, Text, Zeilenzähler, Wahl 1/2/…)
//   Gespraech.taste(code, send)              E/Enter/Leertaste = weiter, 1–4 = Wahl, Esc = verlassen; true, wenn die Taste verbraucht ist
(function () {
  'use strict';
  const R = () => window.Render;
  const VW = 640, VH = 360;
  const FARBE = { rahmen: '#C9974A', grund: 'rgba(14,26,31,0.94)', text: '#F4EEDC', name: '#FFC66B', hinweis: '#8EA3B5', wahl: '#7FE0C2' };

  function aktiv(st) { return !!(st && st.gp); }

  function karteVon(st) {
    const id = st && st.away && st.away.map;
    const M = window.Shared_Maps;
    return id && M ? M[id] : null;
  }

  // Passanten der Außenkarte: Position und Spruch aus Seed und Zeit (kein Snapshot)
  function kulisse(st, zeit) {
    const K = window.Shared_Kulisse; const m = karteVon(st);
    if (!K || !m || !m.ku) return [];
    try { return K.figuren(m.ku, { seed: m.seed, plaetze: m.plaetze, anker: m.anker }, zeit); } catch (e) { if (window.Net) Net.reportError('Gespraech.kulisse', e); return []; }
  }
  function schilder(st) {
    const m = karteVon(st);
    if (!m || !m.ku || !Array.isArray(m.ku.orte) || !Array.isArray(m.plaetze)) return [];
    const out = [];
    for (const o of m.ku.orte) {
      const p = m.plaetze.find((q) => q && q[0] === o.platz);
      if (p) out.push({ name: o.name, x: (p[2] + p[4] / 2) * 32, y: (p[3] + p[5] / 2) * 32, hoehe: o.hoehe || 70 });
    }
    return out;
  }

  // Sprechblase: Text in Zeilen, Spitze unten; (x, y) = Punkt über dem Kopf
  function blase(ctx, str, x, y, o) {
    const Rd = R(); if (!Rd || !str) return;
    const maxW = (o && o.breite) || 120;
    const zeilen = Rd.wrap(String(str), maxW, 1).slice(0, 4);
    let w = 0; for (const z of zeilen) w = Math.max(w, Rd.measure(z, 1));
    w += 10; const h = zeilen.length * 10 + 8;
    const bx = Math.round(Math.max(2, Math.min(VW - w - 2, x - w / 2)));
    const by = Math.round(Math.max(2, y - h - 6));
    ctx.save();
    ctx.fillStyle = 'rgba(244,238,220,0.96)'; ctx.fillRect(bx, by, w, h);
    ctx.fillStyle = 'rgba(11,14,26,0.55)'; ctx.fillRect(bx, by + h, w, 1);
    ctx.beginPath(); ctx.moveTo(Math.round(x) - 4, by + h); ctx.lineTo(Math.round(x), by + h + 6); ctx.lineTo(Math.round(x) + 4, by + h); ctx.closePath();
    ctx.fillStyle = 'rgba(244,238,220,0.96)'; ctx.fill();
    ctx.restore();
    zeilen.forEach((z, i) => Rd.text(ctx, z, bx + 5, by + 4 + i * 10, { color: '#1B2330', shadow: false }));
  }

  // Gesprächsfenster unten in der Bildmitte: für alle am Ort sichtbar. Wahl: 1, 2, … wählen; sonst E / Enter / Leertaste = weiter
  function fenster(ctx, st) {
    const gp = st && st.gp; const Rd = R();
    if (!gp || !Rd) return;
    const w = 420, x = Math.round((VW - w) / 2);
    const zeilen = Rd.wrap(gp.t || '', w - 20, 1).slice(0, 5);
    const wahl = Array.isArray(gp.w) ? gp.w : null;
    const h = 24 + zeilen.length * 10 + (wahl ? wahl.length * 12 + 6 : 14);
    const y = VH - h - 22;
    ctx.save();
    ctx.fillStyle = FARBE.grund; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = FARBE.rahmen; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
    Rd.text(ctx, String(gp.n || '').toUpperCase(), x + 10, y + 6, { color: FARBE.name });
    if (!wahl && gp.zn > 1) Rd.text(ctx, gp.z + '/' + gp.zn, x + w - 10, y + 6, { color: FARBE.hinweis, align: 'right' });
    let yy = y + 20;
    for (const z of zeilen) { Rd.text(ctx, z, x + 10, yy, { color: FARBE.text }); yy += 10; }
    yy += 4;
    if (wahl) {
      wahl.forEach((o, i) => { Rd.text(ctx, (i + 1) + '  ' + o[1], x + 14, yy, { color: FARBE.wahl }); yy += 12; });
    } else {
      Rd.text(ctx, gp.a ? 'E: Gespräch beenden' : 'E: weiter', x + w - 10, yy, { color: FARBE.hinweis, align: 'right' });
    }
  }

  // Tasten: true = verbraucht. send({ t: 'cmd', c: … }) kommt vom Client
  function taste(code, send, st) {
    const gp = st && st.gp;
    if (!gp) return false;
    if (code === 'Escape') { send({ t: 'cmd', c: 'gespraech.end' }); return true; }
    if (Array.isArray(gp.w)) {
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
      if (m) { const o = gp.w[Number(m[1]) - 1]; if (o) send({ t: 'cmd', c: 'gespraech.pick', opt: o[0] }); return true; }
      return code === 'KeyE' || code === 'Enter' || code === 'Space' || code === 'NumpadEnter';   // in der Wahl: erst wählen
    }
    if (code === 'KeyE' || code === 'Enter' || code === 'Space' || code === 'NumpadEnter') { send({ t: 'cmd', c: 'gespraech.next' }); return true; }
    return false;
  }

  window.Gespraech = { aktiv, kulisse, schilder, blase, fenster, taste };
})();
