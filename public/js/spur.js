// SL5 (CONCEPT-SL5): Ionenspur – Anzeige und Bedienung der Ops (Frontend-Layer). Globales `SpurView`.
// Liest Snapshot space.sp ({ x, y, r, p }: Spurkern, Leseradius, Lesefortschritt; nur im Spur-Hex, solange die Spur ungelesen ist) und schickt
// weapons.spur.lesen. Alle Regeln (Wegliste, Teilung, Enthüllen) liegen im Server (server/sim/spur.js).
(function () {
  'use strict';
  const R = window.Render;
  const PAL = R.PAL;
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d || 0);

  function kern(st) { return (st && st.space && st.space.sp) || null; }

  // in die Taktik-/Lagekarte: Spurkern als Chevron-Ring mit Leseradius; toS = Welt -> Bildschirm, zoom = Pixel je Welteinheit
  function draw(ctx, st, toS, zoom, t) {
    const k = kern(st); if (!k) return;
    const p = toS(k.x, k.y);
    ctx.strokeStyle = 'rgba(127,214,200,' + (0.4 + 0.2 * Math.sin(t * 2.5)) + ')'; ctx.lineWidth = 1; ctx.setLineDash([2, 5]);
    ctx.beginPath(); ctx.arc(p.x, p.y, num(k.r, 350) * zoom, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = PAL.mint; ctx.lineWidth = 1.5;
    for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(p.x - 4 + i * 6, p.y - 4); ctx.lineTo(p.x + i * 6, p.y); ctx.lineTo(p.x - 4 + i * 6, p.y + 4); ctx.stroke(); }
    if (num(k.p) > 0) { ctx.beginPath(); ctx.arc(p.x, p.y, 9, -Math.PI / 2, -Math.PI / 2 + num(k.p) * Math.PI * 2); ctx.stroke(); }
    R.text(ctx, 'Ionenspur', p.x + 12, p.y - 4, { color: PAL.mint });
  }

  // Schaltfläche (nur wenn eine Spur zu lesen ist); cmd(c, extra) schickt den Befehl
  function drawButton(ctx, view, rect, cmd) {
    const st = view.state; const k = kern(st); if (!k) return;
    const ship = st.ship || {};
    const d = Math.hypot(num(ship.x) - k.x, num(ship.y) - k.y);
    const reason = d > num(k.r, 350) ? 'Zu weit vom Spurkern – Navigation anfliegen (' + Math.round(d) + ')' : null;
    const reading = num(k.p) > 0;
    R.button(ctx, rect.x + 4, rect.y + rect.h - 32, 150, 13, reading ? 'Lese Spur … ' + Math.round(num(k.p) * 100) + ' %' : 'Spur lesen', { hotkey: 'K', disabled: !!reason && !reading, reason, onClick: () => cmd('weapons.spur.lesen', { on: !reading }) });
  }

  window.SpurView = { draw, drawButton, kern };
})();
