// SL8 (CONCEPT-SL8): Notrufe – Captain-Reiter „Notrufe“, Ops-Knopf zum Entschlüsseln, Ruf-Ort in der Taktikkarte. Globales `NotrufView`.
// Frontend-Layer: liest Snapshot nr ([{ i, h, k: 'k'|'v', z, r, f? }], f nur für den Fokus: { b: Behauptung, n: Absender, q: [Fragen], a: [[i, Antwort]],
// s: Messwerte, e: Entschlüssel-Qualität }) und space.nro ({ x, y, p, r }); schickt captain.notruf.* bzw. weapons.notruf.entschluesseln.
// Alle Regeln liegen im Server (server/sim/notrufe.js). Die Marke auf der Hexkarte zeichnet starmap.js aus world.marken.
// Captain: W/S oder Pfeile wählen, Q/E/R/F fragen, Enter hinfliegen, X ablehnen. Ops: I öffnet das verschlüsselte Signal des gewählten/ersten Rufs.
(function () {
  'use strict';
  const R = window.Render;
  const PAL = R.PAL;
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d || 0);
  const ZUSTAND = ['offen', 'angenommen', 'vor Ort'];

  function liste(st) { return (st && st.nr) || []; }
  function fokus(st) { return liste(st).find((r) => r.f) || null; }
  function hexName(h) { const S = window.Shared_Sektoren; return S && S.hexName ? S.hexName(h) : h; }
  function zeit(s) { s = Math.max(0, Math.round(num(s))); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

  const FRAGE_TASTEN = ['KeyQ', 'KeyE', 'KeyR', 'KeyF'];   // Fragen 1–4 (die Ziffern schalten die Reiter)
  const V = { sel: 0 };
  function aktuell(st) { const l = liste(st); const f = fokus(st); return f || l[Math.min(V.sel, l.length - 1)] || null; }

  // Captain-Reiter. area { x, y, w, h }; cmd(c, extra) schickt Befehle. -> Hilfetext
  function drawCaptain(ctx, view, area, cmd) {
    const st = view.state; const l = liste(st);
    if (!l.length) { R.text(ctx, 'Keine Notrufe. Rufe erscheinen hier und auf der Hexkarte; man muss keinem folgen.', area.x + 4, area.y + 6, { color: PAL.panelLight }); return 'Notrufe'; }
    const lw = 190;
    R.text(ctx, 'NOTRUFE', area.x, area.y, { color: PAL.brass });
    let y = area.y + 14;
    const sel = aktuell(st);
    l.forEach((r, i) => {
      const isSel = sel && sel.i === r.i;
      ctx.fillStyle = isSel ? 'rgba(255,198,107,0.18)' : 'rgba(255,255,255,0.04)'; ctx.fillRect(area.x, y - 2, lw, 24);
      R.text(ctx, (r.k === 'k' ? '! ' : '? ') + hexName(r.h), area.x + 4, y, { color: isSel ? PAL.amber : PAL.star || '#F4EEDC' });
      R.text(ctx, ZUSTAND[r.z] + (r.r != null ? ' · noch ' + zeit(r.r) : ''), area.x + 4, y + 10, { color: r.r != null && r.r < 90 ? PAL.red : PAL.panelLight });
      R.button(ctx, area.x + lw - 40, y, 36, 18, 'Wahl', { onClick: () => { V.sel = i; cmd('captain.notruf.fokus', { id: r.i }); } });
      y += 28;
    });
    if (!sel) return 'W/S wählen';
    if (!sel.f && performance.now() - (V.ask || 0) > 500) { V.ask = performance.now(); cmd('captain.notruf.fokus', { id: sel.i }); }   // Details nur für den Fokus
    const f = sel.f || {};
    const px = area.x + lw + 12, pw = area.w - lw - 14;
    let py = area.y;
    R.text(ctx, (sel.k === 'k' ? 'KLARER RUF' : 'VERSCHLÜSSELTER RUF') + ' · ' + hexName(sel.h), px, py, { color: PAL.amber }); py += 14;
    if (f.b) {
      R.text(ctx, (f.n || 'Absender') + ':', px, py, { color: PAL.mint }); py += 11;
      for (const t of R.wrap(f.b, pw, 1)) { R.text(ctx, t, px, py, { color: PAL.star || '#F4EEDC' }); py += 10; }
    } else { for (const t of R.wrap('Der Absender ist nicht zu verstehen. Die Ops muss das Signal entschlüsseln (Taktik, Taste I).', pw, 1)) { R.text(ctx, t, px, py, { color: PAL.panelLight }); py += 10; } py += 2; }
    if (f.e != null) { R.text(ctx, 'Signalqualität ' + f.e + ' von 3 – Indizien bei der Ops.', px, py, { color: PAL.panelLight }); py += 11; }
    if (f.s) { for (const t of R.wrap('Sonde: ' + f.s, pw, 1)) { R.text(ctx, t, px, py, { color: PAL.mint }); py += 10; } }
    py += 4;
    (f.q || []).forEach((q, i) => {
      const done = (f.a || []).some((a) => a[0] === i);
      R.button(ctx, px, py, pw, 14, q + (done ? ' (gefragt)' : ''), { hotkey: FRAGE_TASTEN[i].slice(3), onClick: () => cmd('captain.notruf.befragen', { id: sel.i, i }) });
      py += 16;
    });
    for (const a of (f.a || []).slice(-2)) { for (const t of R.wrap('„' + (f.q || [])[a[0]] + '“ – ' + a[1], pw, 1).slice(0, 2)) { R.text(ctx, t, px, py, { color: PAL.panelLight }); py += 10; } }
    const by = area.y + area.h - 18;
    R.button(ctx, px, by, 120, 15, 'Hinfliegen', { hotkey: 'Ent', onClick: () => cmd('captain.notruf.hinfliegen', { id: sel.i }) });
    R.button(ctx, px + 126, by, 120, 15, 'Ignorieren', { hotkey: 'X', disabled: sel.z === 2, onClick: () => cmd('captain.notruf.ablehnen', { id: sel.i }) });
    return 'W/S wählen · Q/E/R/F fragen · Enter hinfliegen · X ignorieren (kostet nichts)';
  }

  function key(code, view, cmd) {
    const st = view.state; const l = liste(st); const sel = aktuell(st);
    if (!l.length) return false;
    if (code === 'ArrowUp' || code === 'KeyW') { V.sel = (V.sel + l.length - 1) % l.length; cmd('captain.notruf.fokus', { id: l[V.sel].i }); return true; }
    if (code === 'ArrowDown' || code === 'KeyS') { V.sel = (V.sel + 1) % l.length; cmd('captain.notruf.fokus', { id: l[V.sel].i }); return true; }
    if (!sel) return false;
    if (code === 'Enter' || code === 'NumpadEnter') { cmd('captain.notruf.hinfliegen', { id: sel.i }); return true; }
    if (code === 'KeyX' && sel.z !== 2) { cmd('captain.notruf.ablehnen', { id: sel.i }); return true; }
    const fi = FRAGE_TASTEN.indexOf(code); if (fi >= 0 && sel.f && sel.f.q && sel.f.q[fi]) { cmd('captain.notruf.befragen', { id: sel.i, i: fi }); return true; }   // Ziffern wechseln den Reiter
    return false;
  }

  // Ops: Knopf „Notruf entschlüsseln“ für den ersten verschlüsselten, noch ungeöffneten Ruf (oder den Fokus)
  function opsZiel(st) { return liste(st).find((r) => r.k === 'v' && r.z < 3 && !(r.f && r.f.e != null) && !(r.f && r.f.b)) || null; }
  function drawButton(ctx, view, rect, cmd) {
    const st = view.state; const r = opsZiel(st); if (!r) return;
    const busy = !!(st.en && st.en.z !== 2);
    R.button(ctx, rect.x + rect.w - 154, rect.y + rect.h - 32, 150, 13, 'Notruf ' + r.h + ' öffnen', { hotkey: 'I', disabled: busy, reason: busy ? 'Ein Signal wird gerade abgestimmt' : null, onClick: () => cmd('weapons.notruf.entschluesseln', { id: r.i }) });
  }
  function opsKey(code, view, cmd) {
    if (code !== 'KeyI') return false;
    const r = opsZiel(view.state); if (!r) return false;
    cmd('weapons.notruf.entschluesseln', { id: r.i }); return true;
  }

  // Ruf-Ort in der Taktik-/Lagekarte (neutral, ohne Wahrheit): Ring mit Bergungsradius und Fortschritt
  function draw(ctx, st, toS, zoom, t) {
    const o = st && st.space && st.space.nro; if (!o) return;
    const p = toS(o.x, o.y);
    ctx.strokeStyle = 'rgba(255,107,94,' + (0.5 + 0.3 * Math.sin(t * 4)) + ')'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(6, num(o.r, 140) * zoom), 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#FF6B5E'; ctx.fillRect(p.x - 1.5, p.y - 5, 3, 7); ctx.fillRect(p.x - 1.5, p.y + 4, 3, 3);
    if (num(o.p) > 0) { ctx.strokeStyle = PAL.mint; ctx.beginPath(); ctx.arc(p.x, p.y, 10, -Math.PI / 2, -Math.PI / 2 + num(o.p) * Math.PI * 2); ctx.stroke(); }
    R.text(ctx, 'Notruf', p.x + 12, p.y - 4, { color: '#FF6B5E' });
  }

  window.NotrufView = { drawCaptain, key, drawButton, opsKey, draw, liste };
})();
