// SL10 (CONCEPT-SL10): Glyphen/Sternkarte-Minispiel und Anzeige der Boje-Aktivierung. Globale `Glyphen` und `BojeHud`.
// Frontend-Layer: liest nur die Snapshot-Felder `gl` ({ i, z, w, v, t, f, m, q }) und `bj` ({ z, f, e, n, g?, w? }) und schickt
// weapons.glyphen.waehle { i } | senden. Alle Regeln (Muster, Rückmeldung, Qualität, Fortschritt) liegen im Server (server/sim/glyphen.js, boje.js).
// Ops: Glyphenfeld 3×3 über der Taktikkarte (Pfeiltasten bewegen den Cursor, Leertaste setzt/löst einen Stern, Enter sendet, Klick wie Leertaste).
// Captain: sieht die Konstellation (Muster mit Verbindungslinien) und sagt sie der Ops an (Kommunikation ist das Spiel).
(function () {
  'use strict';
  const R = window.Render;
  const PAL = R.PAL;
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d || 0);
  let cursor = 4;

  const gl = (state) => (state && state.gl) || null;
  const aktiv = (state) => { const g = gl(state); return !!g && g.z === 1; };

  function send(view, c, extra) { try { view.send(Object.assign({ t: 'cmd', c }, extra || {})); } catch (e) { /* Anzeige: nie werfen */ } }

  function sternPos(x, y, size, i) { return { x: x + (i % 3) * size + size / 2, y: y + Math.floor(i / 3) * size + size / 2 }; }
  function stern(ctx, p, r, col, voll) {
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.45 : r; const px = p.x + Math.cos(a) * rr, py = p.y + Math.sin(a) * rr; if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
    ctx.closePath(); if (voll) ctx.fill(); else ctx.stroke();
  }

  // Ops: Glyphenfeld
  function drawOps(ctx, view, rect) {
    const g = gl(view.state); if (!g || g.z !== 1) return;
    const w = 220, h = 222, x = rect.x + rect.w - w - 8, y = rect.y + 20;
    R.panel(ctx, x, y, w, h, { style: 'screen', title: 'VORLÄUFER-ADRESSE' });
    const size = 44, gx = x + (w - size * 3) / 2, gy = y + 22;
    ctx.fillStyle = 'rgba(11,14,26,0.9)'; ctx.fillRect(gx - 4, gy - 4, size * 3 + 8, size * 3 + 8);
    for (let i = 0; i < 9; i++) {
      const p = sternPos(gx, gy, size, i);
      const an = g.w && g.w[i] === '1';
      R.button(ctx, p.x - size / 2 + 2, p.y - size / 2 + 2, size - 4, size - 4, '', { active: an, onClick: () => { cursor = i; send(view, 'weapons.glyphen.waehle', { i }); } });   // Klick = Stern setzen/lösen
      if (i === cursor) { ctx.strokeStyle = PAL.amber; ctx.strokeRect(p.x - size / 2 + 2.5, p.y - size / 2 + 2.5, size - 5, size - 5); }
      stern(ctx, p, 12, an ? PAL.mint : '#4A5878', an);
    }
    let yy = gy + size * 3 + 8;
    const rueck = g.t != null ? 'Letzter Versuch: ' + g.t + ' richtig, ' + num(g.f) + ' falsch' : 'Der Captain sieht die Konstellation.';
    R.text(ctx, rueck, x + 10, yy, { color: g.t != null ? PAL.amber : PAL.panelLight }); yy += 12;
    R.text(ctx, 'Versuche: ' + num(g.v), x + 10, yy, { color: PAL.panelLight }); yy += 11;
    R.text(ctx, 'Pfeile: Cursor · Leertaste: Stern', x + 10, yy, { color: PAL.panelLight }); yy += 14;
    R.button(ctx, x + 10, yy, 100, 14, 'Senden', { hotkey: 'Enter', onClick: () => send(view, 'weapons.glyphen.senden') });
  }

  // Captain: Konstellation
  function drawCaptain(ctx, view) {
    const g = gl(view.state); if (!g || g.z !== 1 || !g.m) return;
    const w = 190, h = 176, x = 640 / 2 - w / 2, y = 58;
    R.panel(ctx, x, y, w, h, { style: 'screen', title: 'KONSTELLATION' });
    const size = 40, gx = x + (w - size * 3) / 2, gy = y + 22;
    ctx.fillStyle = 'rgba(11,14,26,0.9)'; ctx.fillRect(gx - 4, gy - 4, size * 3 + 8, size * 3 + 8);
    const pts = [];
    for (let i = 0; i < 9; i++) if (g.m[i] === '1') pts.push(sternPos(gx, gy, size, i));
    ctx.strokeStyle = 'rgba(127,224,194,0.5)'; ctx.lineWidth = 1; ctx.beginPath();
    pts.forEach((p, k) => { if (k === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }); ctx.stroke();
    for (let i = 0; i < 9; i++) stern(ctx, sternPos(gx, gy, size, i), g.m[i] === '1' ? 11 : 5, g.m[i] === '1' ? PAL.amber : '#3A4560', g.m[i] === '1');
    R.text(ctx, 'Sagt der Ops die Sterne an (Reihe, Spalte).', x + 8, gy + size * 3 + 8, { color: PAL.panelLight });
    R.text(ctx, 'Versuche der Ops: ' + num(g.v), x + 8, gy + size * 3 + 20, { color: PAL.panelLight });
  }

  function drawFor(ctx, view, c) {
    if (c === 'weapons') drawOps(ctx, view, { x: 10, y: 26, w: 620, h: 292 });
    else if (c === 'captain') drawCaptain(ctx, view);
  }

  // Tastatur der Ops (nur wenn aktiv(state)): true = verbraucht
  function key(code, down, view) {
    if (!down || !aktiv(view.state)) return false;
    const dx = { ArrowLeft: -1, ArrowRight: 1 }[code] || 0, dy = { ArrowUp: -3, ArrowDown: 3 }[code] || 0;
    if (dx || dy) { const k = cursor + dx + dy; if (k >= 0 && k < 9 && !(dx && Math.floor(k / 3) !== Math.floor(cursor / 3))) cursor = k; return true; }
    if (code === 'Space') { send(view, 'weapons.glyphen.waehle', { i: cursor }); return true; }
    if (code === 'Enter' || code === 'NumpadEnter') { send(view, 'weapons.glyphen.senden'); return true; }
    return false;
  }

  window.Glyphen = { aktiv, drawFor, key };

  // ---------------------------------------------------------------- Boje: Aktivierung (alle Raumkonsolen)
  // Technik: Energiepunkte frei halten; Navigation: im Feld bleiben; Ops: Adresse; Captain: Fortschritt und Wettlauf.
  const BojeHud = {
    draw(ctx, view) {
      const b = view.state && view.state.bj;
      if (!b) return;
      const w = 270, h = 52, x = 640 - w - 8, y = 360 - 17 - h - 3;
      ctx.fillStyle = 'rgba(11,14,26,0.86)'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = b.g ? PAL.moss : PAL.brass; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      R.text(ctx, b.g ? 'VORLÄUFER-BOJE: ERWACHT' : 'VORLÄUFER-BOJE', x + 4, y + 3, { color: b.g ? PAL.moss : PAL.amber });
      if (b.w) R.text(ctx, 'Piraten: Welle ' + b.w, x + w - 4, y + 3, { color: PAL.red, align: 'right' });
      R.bar(ctx, x + 4, y + 14, w - 8, 6, Math.min(1, num(b.z) / 100), b.g ? PAL.moss : PAL.mint);
      const e = num(b.e), n = num(b.n, 4);
      R.text(ctx, 'Adresse ' + (b.f ? 'ja' : 'fehlt (Ops)') + ' · Energie frei ' + e + '/' + n, x + 4, y + 24, { color: b.f && e >= n ? PAL.mint : PAL.amber });
      if (e < n) R.text(ctx, 'Technik: Module herunterfahren', x + 4, y + 36, { color: PAL.amber });
    },
  };
  window.BojeHud = BojeHud;
})();
