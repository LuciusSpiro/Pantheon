// SL1B Kartenzeichen: gemeinsamer Zeichencode für die Hexkarte (starmap.js) und den Sektorplan des Captains (SL4).
// Reine Zeichenfunktionen und Tabellen (Farben, Symbol-Vokabular, Marken), kein Zustand, keine Netzlogik.
//   Kartenzeichen.COL / FRAKTION / EINFLUSS / SYMBOL_ICON / SYMBOL_NAME / ZUSTAND_NAME / ZUSTAND_FARBE   Tabellen
//   Kartenzeichen.MARKEN                      Marken-Typen { ziel, notruf, spur, fund, kontakt } -> { farbe, name, kurz }
//   Kartenzeichen.symbol(ctx, id, x, y, o)    Hex-/Sektor-Symbol (IconsB, sonst Ersatz); o: { farbe }
//   Kartenzeichen.hauptIcon(system)           Symbol-ID aus einem Karteneintrag (art, symbole, hafen, einfluss)
//   Kartenzeichen.einfluss(ctx, id, x, y)     Einflusszeichen (Gas, Nebel, Asteroiden …)
//   Kartenzeichen.boje(ctx, zustand, x, y, s) Sprungpunkt-Perle (aktiv | gesperrt | temporaer | ohne_strom)
//   Kartenzeichen.marke(ctx, typ, x, y, t, o) Marken-Plakette (Missionsziel, Notruf, Spur, Fund, Kontakt); o: { r, rest, gesamt, hier }
//   Kartenzeichen.markeText(typ, name)        Textzeile für Details/Legende
//   Kartenzeichen.hexPfad(ctx, x, y, s)       Hex-Umriss (flache Hexe, Radius s)
// Der Sektorplan (SL4) zeichnet seine Einträge { id, sym, x, y, quelle, alter?, bekannt } mit symbol() und seine Marken mit marke(),
// damit Hexkarte und Sektorplan dieselben Zeichen für dieselben Dinge benutzen.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(null);
  else root.Kartenzeichen = factory(root);
})(typeof self !== 'undefined' ? self : this, function (win) {
  'use strict';

  const COL = {
    tisch: '#0B0E1A', leer: '#0B0E1A', leerRand: '#2E3A4A', leerText: '#3C4A5E',
    unerkundet: '#141A2A', umriss: '#9AA6B8', text: '#F4EEDC', grau: '#9AA6B8',
    aktiv: '#FFC66B', gesperrt: '#FF8A4C', temporaer: '#A9D6E5', ohneStrom: '#9AA6B8', fern: '#7FD6C8',
    hier: '#7FE0C2', ziel: '#FFC66B', wahl: '#F4EEDC', route: '#FFC66B', messing: '#C9974A', warn: '#F2C94C',
  };
  // Fraktionsflächen gedeckt (helle Schrift ≥ 5,4:1). saum/rom/vorl aus hex.svg, die übrigen im selben Helligkeitsband.
  const FRAKTION = {
    saum: { farbe: '#4A4466', name: 'Konkordat' }, rom: { farbe: '#6B2E2E', name: 'Imperium Rom' },
    ger: { farbe: '#3F4A28', name: 'Germanen' }, pirat: { farbe: '#5C3A1E', name: 'Piraten' },
    frei: { farbe: '#33404F', name: 'herrenlos' }, neutral: { farbe: '#5A4A22', name: 'neutral' },
    vorl: { farbe: '#1F5555', name: 'Vorläufer' }, offen: { farbe: '#202734', name: 'unbekannt' },
  };
  const EINFLUSS = { gas: 'Gas', asteroiden: 'Asteroiden', nebel: 'Nebel', eruption: 'Eruption', gezeiten: 'Gezeiten',
    truemmerstrom: 'Trümmerstrom', daempfung: 'Dämpfung', minen: 'Minen' };
  // Symbol-Vokabular aus den Karten (limes.json, sund.json) -> IconsB.hex-ID
  const SYMBOL_ICON = { home: 'heimat', heimat: 'heimat', pantheon: 'schrein', schrein: 'schrein', ruin: 'ruine', ruine: 'ruine',
    pirate: 'piraten', piraten: 'piraten', fort: 'festung', festung: 'festung', wrack: 'wrack', boje: 'boje', hafen: 'hafen',
    gasriese: 'gasriese', asteroiden: 'asteroiden', nebel: 'nebel' };
  const SYMBOL_NAME = { home: 'Heimathafen', heimat: 'Heimathafen', pantheon: 'Schrein', schrein: 'Schrein', ruin: 'Ruine',
    ruine: 'Ruine', pirate: 'Piraten', piraten: 'Piraten', fort: 'Festung', festung: 'Festung', ally: 'Verbündete',
    target: 'Ziel', bomb: 'Sprengziel', wrack: 'Wrack', boje: 'Boje' };
  const ZUSTAND_NAME = { aktiv: 'aktiv', gesperrt: 'gesperrt', temporaer: 'temporär', ohne_strom: 'ohne Strom' };
  const ZUSTAND_FARBE = { aktiv: COL.aktiv, gesperrt: COL.gesperrt, temporaer: COL.temporaer, ohne_strom: COL.ohneStrom };
  // Marken (Server: server/sim/marken.js): Farbe der Plakette, Name, Kurzbuchstabe für die Legende
  const MARKEN = {
    ziel: { farbe: '#FFB347', name: 'Ziel', kurz: 'Z' },
    notruf: { farbe: '#FF6B5E', name: 'Notruf', kurz: '!' },
    spur: { farbe: '#7FD6C8', name: 'Spur', kurz: 'S' },
    fund: { farbe: '#A9D6E5', name: 'Fund', kurz: 'F' },
    kontakt: { farbe: '#B79CE0', name: 'Kontakt', kurz: 'K' },
  };

  const W = () => win || (typeof window !== 'undefined' ? window : {});
  function report(label, e) { try { const w = W(); if (w.Net && w.Net.reportError) w.Net.reportError(label, e); else if (typeof console !== 'undefined') console.warn(label, e); } catch (x) { /* egal */ } }
  function txt(ctx, s, x, y, o) { const w = W(); if (w.Render && w.Render.text) w.Render.text(ctx, s, x, y, o); }

  // ------------------------------------------------------------------ Icons (IconsB oder Ersatz)
  const maskCache = {};
  function maskSprite(mask, farbe) {
    const key = mask.join('|') + farbe;
    if (maskCache[key]) return maskCache[key];
    const n = mask.length, m = Math.max(...mask.map((r) => r.length));
    const c = document.createElement('canvas'); c.width = m + 2; c.height = n + 2;
    const g = c.getContext('2d');
    const dunkel = 'rgba(11,14,26,0.9)';
    const pal = { '#': farbe, '+': '#FFFFFF', 'o': dunkel, 'w': '#FFFFFF' };
    for (let y = 0; y < n; y++) for (let x = 0; x < mask[y].length; x++) {
      const ch = mask[y][x];
      if (!pal[ch]) continue;
      g.fillStyle = pal[ch]; g.fillRect(x + 1, y + 1, 1, 1);
    }
    return (maskCache[key] = c);
  }
  // Ruft ein IconsB-Icon; true, wenn gezeichnet. Formate: Masken-Array (wie ICONS), Funktion(ctx, x, y, opts),
  // Objekt { mask, color } oder IconsB.draw(ctx, gruppe, id, x, y, opts).
  function iconsB(ctx, gruppe, id, x, y, farbe) {
    const IB = W().IconsB;
    if (!IB) return false;
    try {
      // UI-ART (Stilblatt §5): IconsB.draw(ctx, gruppe, id, x, y, opts) -> bool, Standardfarben und Aliase dort
      if (typeof IB.draw === 'function' && typeof IB.has === 'function') return IB.has(gruppe, id) ? IB.draw(ctx, gruppe, id, x, y, {}) !== false : false;
      const g = IB[gruppe], src = g && g[id];
      if (Array.isArray(src)) { const sp = maskSprite(src, farbe); ctx.drawImage(sp, Math.round(x - sp.width / 2), Math.round(y - sp.height / 2)); return true; }
      if (typeof src === 'function') { src(ctx, x, y, { color: farbe, size: 12 }); return true; }
      if (src && Array.isArray(src.mask)) { const sp = maskSprite(src.mask, src.color || farbe); ctx.drawImage(sp, Math.round(x - sp.width / 2), Math.round(y - sp.height / 2)); return true; }
      if (typeof IB.draw === 'function' && src) { IB.draw(ctx, gruppe, id, x, y, { color: farbe }); return true; }
    } catch (e) { report('IconsB.' + gruppe + '.' + id, e); }
    return false;
  }
  // Einfacher Ersatz (Formen aus hex.svg, auf 12 px)
  function ersatzHex(ctx, id, x, y, farbe) {
    ctx.save();
    ctx.translate(Math.round(x) + 0.5, Math.round(y) + 0.5);
    ctx.strokeStyle = farbe; ctx.fillStyle = farbe; ctx.lineWidth = 1.5;
    const line = (pts, close) => { ctx.beginPath(); pts.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b))); if (close) ctx.closePath(); ctx.stroke(); };
    switch (id) {
      case 'heimat': ctx.strokeRect(-5, -5, 10, 10); ctx.fillStyle = COL.aktiv; ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, 7); ctx.fill(); break;
      case 'hafen': ctx.strokeRect(-4, -4, 8, 8); ctx.beginPath(); ctx.arc(0, 0, 1.5, 0, 7); ctx.fill(); break;
      case 'asteroiden': ctx.fillStyle = COL.grau; [[-3, 2, 3], [3, -2, 2.5], [3, 4, 1.8]].forEach(([a, b, r]) => { ctx.beginPath(); ctx.arc(a, b, r, 0, 7); ctx.fill(); }); break;
      case 'nebel': ctx.strokeStyle = COL.temporaer; line([[-6, -2], [-3, -4], [0, -2], [3, -4], [6, -2]]); line([[-6, 3], [-3, 1], [0, 3], [3, 1], [6, 3]]); break;
      case 'boje': ctx.strokeStyle = COL.aktiv; ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, 7); ctx.stroke(); line([[0, -6], [0, 6]]); break;
      case 'wrack': ctx.strokeStyle = COL.messing; line([[-5, 4], [-1, -4], [1, 0], [6, -3], [3, 5]], true); break;
      case 'ruine': case 'schrein': ctx.strokeStyle = '#B79CE0'; line([[0, -6], [6, 0], [0, 6], [-6, 0]], true); ctx.fillStyle = '#B79CE0'; ctx.fillRect(-1, -1, 3, 3); break;
      case 'piraten': ctx.strokeStyle = COL.gesperrt; line([[-4, -4], [4, 4]]); line([[4, -4], [-4, 4]]); ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, 7); ctx.stroke(); break;
      case 'festung': line([[-5, -5], [5, -5], [5, 1], [0, 6], [-5, 1]], true); break;
      case 'gasriese': ctx.beginPath(); ctx.arc(0, 0, 4, 0, 7); ctx.stroke(); line([[-7, 2], [7, -2]]); break;
      // ohne UI-ART-Icon (Stilblatt §5): Verbündete, Ziel, Sprengziel
      case 'ally': ctx.fillStyle = '#A9D6E5'; ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(5, 4); ctx.lineTo(-5, 4); ctx.closePath(); ctx.fill(); break;
      case 'target': ctx.strokeStyle = COL.aktiv; line([[-3, 6], [-3, -6]]); ctx.fillStyle = COL.aktiv; ctx.beginPath(); ctx.moveTo(-3, -6); ctx.lineTo(5, -3); ctx.lineTo(-3, 0); ctx.closePath(); ctx.fill(); break;
      case 'bomb': ctx.strokeStyle = COL.gesperrt; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; line([[Math.cos(a) * 2, Math.sin(a) * 2], [Math.cos(a) * 6, Math.sin(a) * 6]]); } break;
      default: ctx.fillStyle = farbe; ctx.beginPath(); ctx.arc(0, 0, 3, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
  function fraktionFarbe(fr) { const IB = W().IconsB; const f = IB && IB.FRAKTION && IB.FRAKTION[fr]; return (f && f.flaeche) || (FRAKTION[fr] || FRAKTION.offen).farbe; }
  function symbol(ctx, id, x, y, o) { const farbe = (o && o.farbe) || COL.text; if (!iconsB(ctx, 'hex', id, x, y, farbe)) ersatzHex(ctx, id, x, y, farbe); }
  function einfluss(ctx, id, x, y) {
    if (iconsB(ctx, 'einfluss', id, x, y, COL.temporaer)) return;
    const k = { gas: 'G', asteroiden: 'A', nebel: 'N', eruption: 'E', gezeiten: 'Z', truemmerstrom: 'T', daempfung: 'D', minen: 'M' }[id] || '·';
    txt(ctx, k, x, y - 3, { color: COL.temporaer, align: 'center' });
  }
  // Bojen-Perle auf der Karte: IconsB.perle(ctx, art, x, y, skala) oder Ersatz nach hex.svg (s = Durchmesser px)
  function boje(ctx, zustand, x, y, s) {
    const IB = W().IconsB;
    if (IB && typeof IB.perle === 'function' && IB.perle(ctx, zustand, x, y, s / 16) !== false) return;
    bojeErsatz(ctx, zustand, x, y, s);
  }
  function bojeErsatz(ctx, zustand, x, y, s) {
    const r = Math.max(2.5, s / 2);
    ctx.save();
    ctx.lineWidth = Math.max(1, r / 3);
    const f = ZUSTAND_FARBE[zustand] || COL.aktiv;
    if (zustand === 'gesperrt' || zustand === 'ohne_strom') {
      ctx.fillStyle = COL.tisch; ctx.strokeStyle = f;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (zustand === 'gesperrt') {
        const q = r * 0.5;
        ctx.beginPath(); ctx.moveTo(x - q, y - q); ctx.lineTo(x + q, y + q); ctx.moveTo(x + q, y - q); ctx.lineTo(x - q, y + q); ctx.stroke();
      }
    } else {
      ctx.fillStyle = f; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = COL.tisch; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.restore();
  }
  function hauptIcon(s) {
    for (const sym of s.symbole || []) if (SYMBOL_ICON[sym] === 'heimat') return 'heimat';
    const art = String(s.art || '').toLowerCase();
    if (/wrack/.test(art)) return 'wrack';
    if (/boje/.test(art)) return 'boje';
    if (/gasriese/.test(art)) return 'gasriese';
    if (/nebel/.test(art) || s.einfluss === 'nebel') return 'nebel';
    if (/asteroid|trümmer/.test(art)) return 'asteroiden';
    for (const sym of s.symbole || []) if (SYMBOL_ICON[sym]) return SYMBOL_ICON[sym];
    if (/ruine|relais|sternwarte/.test(art)) return 'ruine';
    if (s.hafen) return 'hafen';
    return 'system';
  }
  function hexPfad(ctx, x, y, s) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; const px = x + s * Math.cos(a), py = y + s * Math.sin(a); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.closePath();
  }

  // ------------------------------------------------------------------ Marken
  // Plakette mit Zeichen: Missionsziel (Fähnchen), Notruf (Warndreieck), Spur (Winkel), Fund (Raute), Kontakt (Sprechblase).
  // o: { r: Radius px (6), rest: Restzeit s, gesamt: Gesamtzeit s (Bogen um die Plakette), hier: Schiff im selben Hex (ruhig statt pulsierend) }
  function marke(ctx, typ, x, y, t, o) {
    const M = MARKEN[typ] || MARKEN.fund; const op = o || {};
    const r = Math.max(4, op.r || 6);
    const puls = op.hier || (typ !== 'notruf' && typ !== 'ziel') ? 1 : 0.65 + 0.35 * Math.abs(Math.sin((t || 0) * 3));
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    if (op.deckend) {   // SUND-01 F: deckende Scheibe (Alpha 1, r + 2) unter der Marke; der Puls gilt nur dem Ring, nicht Füllung und Zeichen
      ctx.fillStyle = COL.tisch; ctx.beginPath(); ctx.arc(0, 0, r + 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgb(11,14,26)'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = puls; ctx.strokeStyle = M.farbe; ctx.lineWidth = Math.max(1, r / 4);
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      ctx.globalAlpha = puls;
      ctx.fillStyle = 'rgba(11,14,26,0.92)'; ctx.strokeStyle = M.farbe; ctx.lineWidth = Math.max(1, r / 4);
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.strokeStyle = M.farbe; ctx.fillStyle = M.farbe; ctx.lineWidth = Math.max(1, r / 5); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const k = r / 6;
    ctx.beginPath();
    switch (typ) {
      case 'ziel': ctx.moveTo(-2 * k, 3.5 * k); ctx.lineTo(-2 * k, -3.5 * k); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-2 * k, -3.5 * k); ctx.lineTo(3.5 * k, -1.5 * k); ctx.lineTo(-2 * k, 0.5 * k); ctx.closePath(); ctx.fill(); break;
      case 'notruf': ctx.moveTo(0, -3.5 * k); ctx.lineTo(0.2 * k, 0.8 * k); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 3 * k, 0.9 * k, 0, 7); ctx.fill(); break;
      case 'spur': ctx.moveTo(-3 * k, -3 * k); ctx.lineTo(0, 0); ctx.lineTo(-3 * k, 3 * k); ctx.moveTo(0.5 * k, -3 * k); ctx.lineTo(3.5 * k, 0); ctx.lineTo(0.5 * k, 3 * k); ctx.stroke(); break;
      case 'kontakt': ctx.moveTo(-3.5 * k, -2.5 * k); ctx.lineTo(3.5 * k, -2.5 * k); ctx.lineTo(3.5 * k, 2 * k); ctx.lineTo(0, 2 * k); ctx.lineTo(-2 * k, 4 * k); ctx.lineTo(-2 * k, 2 * k); ctx.lineTo(-3.5 * k, 2 * k); ctx.closePath(); ctx.stroke(); break;
      default: ctx.moveTo(0, -3.5 * k); ctx.lineTo(3.5 * k, 0); ctx.lineTo(0, 3.5 * k); ctx.lineTo(-3.5 * k, 0); ctx.closePath(); ctx.fill();
    }
    if (op.gesamt > 0 && op.rest != null) {
      const q = Math.max(0, Math.min(1, op.rest / op.gesamt));
      ctx.globalAlpha = 1; ctx.strokeStyle = M.farbe; ctx.lineWidth = Math.max(1, r / 4);
      ctx.beginPath(); ctx.arc(0, 0, r + 2, -Math.PI / 2, -Math.PI / 2 + q * Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
  function markeText(typ, name) { const M = MARKEN[typ] || MARKEN.fund; return M.name + (name ? ': ' + name : ''); }

  return { COL, FRAKTION, EINFLUSS, SYMBOL_ICON, SYMBOL_NAME, ZUSTAND_NAME, ZUSTAND_FARBE, MARKEN,
    symbol, hauptIcon, einfluss, boje, bojeErsatz, fraktionFarbe, hexPfad, marke, markeText };
});
