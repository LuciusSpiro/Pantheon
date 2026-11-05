// SCA-01 P3: Scanner am Boden – Overlay und Eingabe des Scannenden. Globales `Scanner` (Muster entschluesseln.js).
// Frontend-Layer: liest nur den Snapshot des eigenen Spielers (players[me].action.kind === 'scan', players[me].sc = { f, s, h, q }) und schickt
// scan.stimme { dir } | scan.abbruch | slot.nutzen. Alle Regeln (Drift, Fortschritt, Qualität, Abbruch durch Treffer/Bewegung) liegen im Server (server/sim/scanner.js);
// der Client rechnet nichts. Das Zielband steht absichtlich nicht im Snapshot: der Spieler findet die Frequenz über die Signalstärke.
// Bedienung: A/D oder Pfeile links/rechts halten die Richtung, Esc oder Rücktaste brechen ab, die Slot-Taste des Scanners tut dasselbe über slot.nutzen.
// Während des Scans sind Bewegung, Schießen und alle anderen Tasten gesperrt (jede Bewegung oder Waffenaktion bricht den Scan serverseitig ab).
// Funktionsfarbe: Eisblau (PAL.ice, Sensoren); Rot ist Waffen/Gefahr, Bernstein am Boden Hitze.
(function () {
  'use strict';
  const R = window.Render;
  const PAL = R.PAL;
  const CMD_STIMME = (window.Shared_Protocol && window.Shared_Protocol.CMD_SCAN_STIMME) || 'scan.stimme';
  const CMD_ABBRUCH = (window.Shared_Protocol && window.Shared_Protocol.CMD_SCAN_ABBRUCH) || 'scan.abbruch';
  const CMD_SLOT = (window.Shared_Protocol && window.Shared_Protocol.CMD_SLOT_NUTZEN) || 'slot.nutzen';
  const ITEM_ID = 'scanner';
  const LINKS = ['KeyA', 'ArrowLeft'], RECHTS = ['KeyD', 'ArrowRight'];
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d || 0);
  const klemme = (v) => Math.max(0, Math.min(1, num(v)));

  // Zustand der Eingabe: gehaltene Richtungstasten und zuletzt gesendete Richtung
  const eingabe = { gehalten: {}, gesendet: 0 };

  // Das Overlay gilt nur für den eigenen Spieler und nur, solange der Server den Scan-Hold meldet
  function aktiv(me) { return !!(me && me.action && me.action.kind === 'scan'); }

  function richtungVon(gehalten) {
    const l = LINKS.some((c) => gehalten[c]), r = RECHTS.some((c) => gehalten[c]);
    return (r ? 1 : 0) - (l ? 1 : 0);
  }
  const stimmeMsg = (dir) => ({ t: 'cmd', c: CMD_STIMME, dir });
  // Richtung nur bei Änderung senden
  function richtungAbgleichen() {
    const d = richtungVon(eingabe.gehalten);
    if (d === eingabe.gesendet) return [];
    eingabe.gesendet = d;
    return [stimmeMsg(d)];
  }

  // Taste gedrückt/losgelassen, solange das Overlay aktiv ist (der Aufrufer prüft aktiv(me)).
  // e = { code, shiftKey, repeat }; hat = Loadout-Stand (Hud.loadoutStand) für die Slot-Tasten. Rückgabe { verbraucht, senden: [Nachrichten] };
  // im Overlay wird jede Taste verbraucht (nichts geht an die Bewegung, den Schuss oder den Waffenwechsel), die Ausnahmen stehen oben.
  function taste(e, down, hat) {
    const code = e && e.code;
    const T = window.Tasten;
    if (LINKS.includes(code) || RECHTS.includes(code)) {
      if (down) eingabe.gehalten[code] = true; else delete eingabe.gehalten[code];
      return { verbraucht: true, senden: richtungAbgleichen() };
    }
    if (!down) return { verbraucht: true, senden: [] };
    if (e.repeat) return { verbraucht: true, senden: [] };
    if (code === 'Escape' || code === 'Backspace') return { verbraucht: true, senden: [{ t: 'cmd', c: CMD_ABBRUCH }] };
    const sl = T && T.slotVon ? T.slotVon(e) : -1;
    if (sl >= 0 && T && !(T.reserviert && T.reserviert(code))) {
      const id = hat && Array.isArray(hat.slots) ? hat.slots[sl] : null;
      if (id === ITEM_ID) return { verbraucht: true, senden: [{ t: 'cmd', c: CMD_SLOT, slot: sl }] };   // dieselbe Taste wie beim Start = Abbruch (Server)
    }
    return { verbraucht: true, senden: [] };   // Schießen, Fremdwaffen-Slots, Bewegung, alles andere: geschluckt
  }

  // Jeden Frame (auch ohne Overlay): ist der Scan zu Ende oder der Fokus weg, wird die gehaltene Richtung zurückgenommen (dir 0)
  function abgleichen(me) {
    if (aktiv(me)) return [];
    return loslassen();
  }
  // Fokus-/Fensterwechsel, Overlay-Ende: alle Richtungstasten vergessen, dir 0 senden (falls nötig)
  function loslassen() {
    eingabe.gehalten = {};
    return richtungAbgleichen();
  }

  // Maus: Klick schießt am Boden – während des Scans geschluckt
  function schluckt(me) { return aktiv(me); }

  function sterne(q) { const k = Math.max(0, Math.min(3, Math.round(num(q)))); return '[' + '*'.repeat(k) + '-'.repeat(3 - k) + ']'; }   // (die Pixelschrift hat keine Sterne)
  // deterministisches Rauschen aus Zeit und Spalte (kein Math.random: ruhiges Bild bei gleichem Zustand)
  function rausch(i, t) { const v = Math.sin(i * 12.9898 + Math.floor(t * 18) * 78.233) * 43758.5453; return v - Math.floor(v) - 0.5; }

  // einfaches Scanner-Symbol (Peilring mit Punkt, 10×8) für die Ausrüstungsstation; x/y = linke obere Ecke
  function symbol(ctx, x, y, col) {
    ctx.fillStyle = col || PAL.ice;
    ctx.fillRect(x + 2, y, 6, 1); ctx.fillRect(x + 2, y + 7, 6, 1);
    ctx.fillRect(x, y + 2, 1, 4); ctx.fillRect(x + 9, y + 2, 1, 4);
    ctx.fillRect(x + 1, y + 1, 1, 1); ctx.fillRect(x + 8, y + 1, 1, 1); ctx.fillRect(x + 1, y + 6, 1, 1); ctx.fillRect(x + 8, y + 6, 1, 1);
    ctx.fillRect(x + 4, y + 3, 2, 2);
  }

  // Panel mittig-unten (nicht über der Figur, nicht über der Bodenleiste links x 4..174 und dem Siegel „Weltstand gesichert“ darüber, über einer ODA-Zeile)
  const VW = 640, VH = 360, W = 276, H = 112;
  function rechteck(view) {
    const H_ = window.Hud, oda = H_ && H_.odaHoehe ? H_.odaHoehe(view) : 0;
    return { x: Math.round((VW - W) / 2), y: VH - 8 - H - (oda ? oda + 4 : 0), w: W, h: H };
  }

  function draw(ctx, view) {
    const me = view && view.me;
    if (!aktiv(me)) return;
    const sc = me.sc || {};
    const s = klemme(sc.s), h = klemme(sc.h != null ? sc.h : me.action.progress);
    const r = rechteck(view), x = r.x, y = r.y;
    const Hh = window.Hud;
    R.panel(ctx, x, y, r.w, r.h, { style: 'screen', title: 'SCANNER – FREQUENZ ABSTIMMEN' });
    const ix = x + 10, iw = r.w - 20;
    let yy = y + 12;
    // Kurve: Rauschen (laut bei schwachem Signal) über einer sauberen Welle (steigt mit der Signalstärke)
    const ch = 30, cy = yy + ch / 2, t = view.time || 0;
    ctx.fillStyle = 'rgba(11,14,26,0.9)'; ctx.fillRect(ix, yy, iw, ch);
    ctx.strokeStyle = PAL.ice; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i <= iw; i += 2) {
      const sig = Math.sin(i * 0.12 + t * 6) * 11 * s;
      const nz = rausch(i, t) * (1 - s) * 28;
      const v = Math.max(-ch / 2 + 1, Math.min(ch / 2 - 1, sig + nz));
      if (i === 0) ctx.moveTo(ix + i, cy + v); else ctx.lineTo(ix + i, cy + v);
    }
    ctx.stroke();
    yy += ch + 5;
    const bx = ix + 62, bw = iw - 62;
    R.text(ctx, 'FREQUENZ', ix, yy, { color: PAL.brass });
    ctx.fillStyle = 'rgba(40,48,70,0.9)'; ctx.fillRect(bx, yy + 1, bw, 7);
    ctx.fillStyle = '#EAF6FA'; ctx.fillRect(bx + Math.round(klemme(sc.f != null ? sc.f : 0.5) * (bw - 3)), yy - 1, 3, 11);
    yy += 12;
    R.text(ctx, 'SIGNAL', ix, yy, { color: PAL.brass }); R.bar(ctx, bx, yy + 1, bw, 7, s, PAL.ice); yy += 12;
    R.text(ctx, 'SCAN', ix, yy, { color: PAL.brass }); R.bar(ctx, bx, yy + 1, bw, 7, h, PAL.ice); yy += 12;
    const fit = (txt, w) => (Hh && Hh.fit ? Hh.fit(txt, w, 1) : txt);
    R.text(ctx, fit('Qualität bisher ' + sterne(sc.q), iw), ix, yy, { color: PAL.ice }); yy += 11;
    R.text(ctx, fit('A/D stimmen · Esc Abbruch', iw), ix, yy, { color: PAL.panelLight });
  }

  window.Scanner = { aktiv, taste, abgleichen, loslassen, schluckt, draw, symbol, rechteck, richtungVon, sterne, ITEM_ID, W, H };
})();
