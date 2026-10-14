// SL5 (CONCEPT-SL5): Signal entschlüsseln – Anzeige und Eingabe der Ops (Taktik-Konsole). Globales `Entschluesseln`.
// Frontend-Layer: liest nur den Snapshot `en` ({ i, z, n, f, s, h, q }: z 0 = Signal liegt an, 1 = Abstimmung läuft, 2 = fertig) und schickt
// weapons.entschl.start | stimme { dir } | stopp. Alle Regeln (Drift, Qualität, Schichten) liegen im Server (server/sim/entschluesseln.js).
// Bedienung: N öffnet die Abstimmung, A/D oder Pfeile halten die Richtung der Frequenz, Rücktaste bricht ab. Je sauberer das Signal, desto
// ruhiger die Kurve; Qualität 0–3 (Sterne) bestimmt, wie viele Schichten des Funkspruchs lesbar sind.
(function () {
  'use strict';
  const R = window.Render;
  const PAL = R.PAL;
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d || 0);
  let dirHeld = 0, heldKey = null;

  function en(state) { return state && state.en ? state.en : null; }
  function aktiv(state) { return !!en(state); }
  function laeuft(state) { const e = en(state); return !!e && e.z === 1; }

  // deterministisches Rauschen aus Zeit und Spalte (kein Math.random: ruhiges Bild bei gleichem Zustand)
  function rausch(i, t) { const v = Math.sin(i * 12.9898 + Math.floor(t * 18) * 78.233) * 43758.5453; return v - Math.floor(v) - 0.5; }

  function send(view, c, extra) { try { view.send(Object.assign({ t: 'cmd', c }, extra || {})); } catch (e) { /* Anzeige: nie werfen */ } }
  function stimme(view, dir) { if (dir !== dirHeld) { dirHeld = dir; send(view, 'weapons.entschl.stimme', { dir }); } }

  // rect = Fläche der Taktikkarte; zeichnet ein Fenster darüber
  function draw(ctx, view, rect) {
    const e = en(view.state);
    if (!e) return;
    const w = 330, h = 196, x = rect.x + Math.round((rect.w - w) / 2), y = rect.y + 34;
    R.panel(ctx, x, y, w, h, { style: 'screen', title: 'SIGNAL ENTSCHLÜSSELN' });
    const ix = x + 10, iw = w - 20;
    let yy = y + 20;
    const s = e.z === 1 ? num(e.s) : e.z === 2 ? 1 : 0;
    // Kurve: Rauschen (laut bei schwachem Signal) über einer sauberen Welle (steigt mit der Signalstärke)
    const ch = 50, cy = yy + ch / 2;
    ctx.fillStyle = 'rgba(11,14,26,0.9)'; ctx.fillRect(ix, yy, iw, ch);
    ctx.strokeStyle = e.z === 2 ? PAL.moss : PAL.mint; ctx.lineWidth = 1; ctx.beginPath();
    const t = view.time || 0;
    for (let i = 0; i <= iw; i += 2) {
      const sig = Math.sin(i * 0.12 + t * 6) * 18 * s;
      const nz = e.z === 0 ? rausch(i, t) * 40 : rausch(i, t) * (1 - s) * 46;
      const v = Math.max(-ch / 2 + 1, Math.min(ch / 2 - 1, sig + nz));
      if (i === 0) ctx.moveTo(ix + i, cy + v); else ctx.lineTo(ix + i, cy + v);
    }
    ctx.stroke();
    yy += ch + 6;
    if (e.z === 0) {
      R.text(ctx, 'Verschlüsseltes Signal liegt an (' + num(e.n, 1) + ' Schichten).', ix, yy, { color: PAL.amber }); yy += 12;
      R.text(ctx, 'Frequenz abstimmen, bis das Signal aus dem Rauschen tritt.', ix, yy, { color: PAL.panelLight }); yy += 16;
      R.button(ctx, ix, yy, 150, 16, 'Abstimmung öffnen', { hotkey: 'N', onClick: () => send(view, 'weapons.entschl.start') });
      return;
    }
    if (e.z === 2) {
      const q = num(e.q);
      R.text(ctx, 'Entschlüsselt. Qualität ' + q + ' von 3', ix, yy, { color: q >= 3 ? PAL.moss : q ? PAL.mint : PAL.amber }); yy += 12;
      R.text(ctx, sterne(q), ix, yy, { color: PAL.amber }); yy += 12;
      R.text(ctx, q >= 3 ? 'Sauberes Signal: auch die zweite Schicht ist lesbar.' : q ? 'Mehr Schichten brauchen ein saubereres Signal.' : 'Nur Rauschen. Das Signal war zu unsauber.', ix, yy, { color: PAL.panelLight });
      return;
    }
    // läuft: Frequenzleiste, Signalstärke, Fortschritt
    R.text(ctx, 'FREQUENZ', ix, yy, { color: PAL.brass });
    const bx = ix + 62, bw = iw - 62;
    ctx.fillStyle = 'rgba(40,48,70,0.9)'; ctx.fillRect(bx, yy + 1, bw, 7);
    ctx.fillStyle = PAL.amber; ctx.fillRect(bx + Math.round(num(e.f, 0.5) * (bw - 3)), yy - 1, 3, 11);
    yy += 14;
    R.text(ctx, 'SIGNAL', ix, yy, { color: PAL.brass }); R.bar(ctx, bx, yy + 1, bw, 7, s, s > 0.65 ? PAL.mint : s > 0.3 ? PAL.amber : PAL.red); yy += 14;
    R.text(ctx, 'ENTSCHL.', ix, yy, { color: PAL.brass }); R.bar(ctx, bx, yy + 1, bw, 7, num(e.h), PAL.mint); yy += 14;
    R.text(ctx, 'Qualität bisher ' + sterne(num(e.q)) + '   ·   A/D oder Pfeile halten', ix, yy, { color: PAL.panelLight }); yy += 14;
    R.button(ctx, ix, yy, 28, 15, '◄', { onClick: () => { stimme(view, -1); setTimeout(() => stimme(view, 0), 160); } });
    R.button(ctx, ix + 32, yy, 28, 15, '►', { onClick: () => { stimme(view, 1); setTimeout(() => stimme(view, 0), 160); } });
    R.button(ctx, ix + iw - 120, yy, 120, 15, 'Abbrechen', { hotkey: '⌫', onClick: () => send(view, 'weapons.entschl.stopp') });
  }
  function sterne(q) { return '★'.repeat(Math.max(0, Math.min(3, q))) + '☆'.repeat(3 - Math.max(0, Math.min(3, q))); }

  // Tastatur: true = verbraucht. Nur aufrufen, wenn aktiv(state) (die Ops hat dann Vorrang vor Zuteilung A/D, Q/E und X).
  function key(code, down, view) {
    const e = en(view.state);
    if (!e) return false;
    if (down) {
      if (e.z === 0 && code === 'KeyN') { send(view, 'weapons.entschl.start'); return true; }
      if (e.z === 1) {
        if (code === 'ArrowLeft' || code === 'KeyA') { heldKey = code; stimme(view, -1); return true; }
        if (code === 'ArrowRight' || code === 'KeyD') { heldKey = code; stimme(view, 1); return true; }
        if (code === 'Backspace') { send(view, 'weapons.entschl.stopp'); return true; }
        if (code === 'KeyN') return true;
      }
      return false;
    }
    if (code === heldKey) { heldKey = null; stimme(view, 0); return e.z === 1; }
    return false;
  }
  function loslassen(view) { heldKey = null; if (dirHeld !== 0) stimme(view, 0); }

  window.Entschluesseln = { aktiv, laeuft, draw, key, loslassen };
})();
