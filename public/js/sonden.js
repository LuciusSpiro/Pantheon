// SL4 (CONCEPT-SL4): Sonden – Anzeige und Bedienung (Frontend-Layer). Globales `SondenView`.
// Liest Snapshot space.so ([{ id, x, y, z, hp }], z 0 = fliegt, 1 = sendet) und inventory.sonde; schickt weapons.sonde.start (Ziel = Ops-Marke).
// Taste P (Taktik): Sonde zur Marke. Alle Regeln liegen im Server (server/sim/sonden.js).
(function () {
  'use strict';
  const R = window.Render;
  const PAL = R.PAL;
  const CFG = window.Shared_Config || {};
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d || 0);
  const RANGE = () => (CFG.sonden && CFG.sonden.reichweite) || 700;

  function liste(st) { return (st && st.space && st.space.so) || []; }
  function vorrat(st) { return num(st && st.inventory && st.inventory.sonde); }

  // in die Taktik-/Lagekarte: Sonde als Raute, Senderadius als gestrichelter Ring; toS = Welt -> Bildschirm, zoom = Pixel je Welteinheit
  function draw(ctx, st, toS, zoom, t) {
    for (const s of liste(st)) {
      const p = toS(s.x, s.y);
      const sends = s.z === 1;
      if (sends) {
        ctx.strokeStyle = 'rgba(127,224,194,' + (0.35 + 0.15 * Math.sin(t * 3)) + ')'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.arc(p.x, p.y, RANGE() * zoom, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
      const hp = num(s.hp, 1);
      ctx.fillStyle = hp > 0.5 ? PAL.mint : hp > 0.25 ? PAL.amber : PAL.red;
      ctx.beginPath(); ctx.moveTo(p.x, p.y - 5); ctx.lineTo(p.x + 4, p.y); ctx.lineTo(p.x, p.y + 5); ctx.lineTo(p.x - 4, p.y); ctx.closePath(); ctx.fill();
      R.text(ctx, sends ? 'Sonde' : 'Sonde →', p.x + 7, p.y - 4, { color: PAL.mint });
    }
  }

  // Schaltfläche am unteren Rand der Taktikkarte; cmd(c, extra) schickt den Befehl
  function drawButton(ctx, view, rect, cmd) {
    const st = view.state; const n = vorrat(st); const unterwegs = liste(st).length;
    const marke = st.ship && st.ship.markers && st.ship.markers.tactical;
    const x = rect.x + 4, y = rect.y + rect.h - 17;
    const max = (CFG.sonden && CFG.sonden.max) || 3;
    let reason = null;
    if (n < 1) reason = 'Keine Sonden im Vorrat (Hafen)';
    else if (!marke) reason = 'Erst Ziel markieren (rechte Maustaste)';
    else if (unterwegs >= max) reason = 'Höchstens ' + max + ' Sonden gleichzeitig';
    R.button(ctx, x, y, 150, 13, 'Sonde zur Marke (' + n + ')', { hotkey: 'P', disabled: !!reason, reason, onClick: () => cmd('weapons.sonde.start') });
  }

  window.SondenView = { draw, drawButton, vorrat, liste };
})();
