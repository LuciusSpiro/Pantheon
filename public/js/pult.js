// Pult-Baukasten (Kai 2026-10-15): Brückenpulte mit Skin je Volk. Globales `Pult`.
// GLEICH für alle Völker: Aufbau (Anzeige oben, Statusleiste, Säule links, Pult unten), Tasten, Funktionsfarben, Inhalt.
// JE SKIN: Formen, Material, neutrale Farben, Schmuck. Skins: 'rom' (die Lerche, eckiges Messing-Pult) und 'germanen'
// („Schmiede & Bernstein“). Der Skin hängt an der Schiffsklasse (CONFIG.shipClasses.<klasse>.pult), zum Ansehen
// überschreibbar mit ?pult=germanen bzw. localStorage 'pantheon.pult'.
// Während ein Pult zeichnet, ersetzt Pult.mitSkin() R.button – auch eingebettete Ansichten (Sektorplan, Fracht, Funk …)
// zeichnen ihre Knöpfe dann im Skin. Knöpfe behalten ihre Beschriftung als Suchnamen (Consoles.tryButton findet sie weiter).
(function () {
  'use strict';
  const R = window.Render;
  const PAL = R.PAL;
  const CFG = window.Shared_Config || {};
  const VW = 640, VH = 360;
  const FN = { drive: '#FFC66B', shield: '#7FE0C2', weapon: '#E0473C', sensor: '#A9D6E5', nav: '#C9974A', cmd: '#F4EEDC', warn: '#F2C94C', neutral: '#8EA3B5', locked: '#6B7380' };

  // ---------------------------------------------------------------- Grundformen (pixelscharf)
  function hex2rgb(h) { const n = parseInt(String(h).slice(1, 7), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function mix(a, b, t) { const A = hex2rgb(a), B = hex2rgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
  function rgba(h, a) { const [r, g, b] = hex2rgb(h); return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'; }
  function cham(c, x, y, w, h, col, tl = 0, tr = 0, br = 0, bl = 0) {
    c.fillStyle = col; x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    for (let r = 0; r < h; r++) {
      const li = Math.max(tl - r, bl - (h - 1 - r), 0), ri = Math.max(tr - r, br - (h - 1 - r), 0);
      if (w - li - ri > 0) c.fillRect(x + li, y + r, w - li - ri, 1);
    }
  }
  function rhomb(c, x, y, col) { c.fillStyle = col; [[2, 1], [1, 3], [0, 5], [1, 3], [2, 1]].forEach(([o, w], r) => c.fillRect(x + o, y + r, w, 1)); }
  function zigzag(c, x, y, w, col, t = 4) { c.fillStyle = col; for (let i = 0; i < w; i += t * 2) for (let r = 0; r < t; r++) c.fillRect(x + i + r, y + r, Math.max(1, (t - r) * 2 - 1 - r), 1); }
  function txt(c, s, x, y, col, align) { R.text(c, String(s), x, y, { color: col, align: align || 'left', shadow: false }); return x + (align ? 0 : R.measure(String(s), 1)); }
  function tw(s) { return R.measure(String(s), 1); }
  function hit(b) { const m = R.ui.mouse || {}; return m.x >= b.x && m.y >= b.y && m.x < b.x + b.w && m.y < b.y + b.h; }
  function rand(c, x, y, w, h, col) { c.fillStyle = col; c.fillRect(x, y, w, 1); c.fillRect(x, y + h - 1, w, 1); c.fillRect(x, y, 1, h); c.fillRect(x + w - 1, y, 1, h); }
  // Tastenkappe: alte Schreibweisen der Konsolen in Kurzform ('Sh+A' → '⇧A' gibt es in der Spielschrift nicht: bleibt 'Sh+A')
  function kappe(hk, aktion) {
    if (aktion && window.Tasten && Tasten.kappe) { try { const k = Tasten.kappe(aktion); if (k) return k; } catch (e) { /* alte Beschriftung */ } }
    return hk ? String(hk) : '';
  }

  // ---------------------------------------------------------------- Skins
  const SKINS = {};
  // ROM / LERCHE: eckiges Messing-Pult. Farbblöcke je Funktion, Säule mit 45°-Schrägen, dunkle Tastenkappe.
  SKINS.rom = {
    id: 'rom', name: 'Lerche', bg: '#0B0E1A', screenBg: '#070A14', text: '#F4EEDC', dim: '#8EA3B5', off: '#18202F', offLine: '#3A4A66', ink: '#0B0E1A', frame: '#C9974A', accent: '#FFC66B',
    saeule(c, S, titel, alarm) {
      const fr = alarm ? FN.weapon : this.frame;
      cham(c, 6, 6, 48, S + 8, fr, 12, 0, 0, 12);
      c.fillStyle = fr; c.fillRect(54, S, 84, 14);
      for (let r = 0; r < 7; r++) c.fillRect(54, S - 7 + r, r + 1, 1);
      c.fillStyle = this.bg; c.fillRect(6, 42, 48, 2); c.fillRect(6, 74, 48, 2);
      txt(c, '01', 49, 32, this.ink, 'right'); txt(c, '07', 49, 64, this.ink, 'right');
      txt(c, titel, 62, S + 4, this.ink);
      c.fillStyle = fr; c.fillRect(62, 351, 572, 2);
    },
    navBlock(c, x, y, w, h, key, sub, i, n, aktiv) {
      const fr = aktiv ? this.accent : this.frame;
      cham(c, x, y, w, h, fr, 0, i === 0 ? 6 : 0, 0, i === n - 1 ? 6 : 0);
      if (h < 28) { txt(c, key, x + w - 5, y + Math.floor((h - 7) / 2), this.ink, 'right'); return; }
      txt(c, key, x + w - 5, y + 4, this.ink, 'right'); txt(c, sub, x + w - 5, y + h - 10, mix(this.ink, fr, 0.35), 'right');
    },
    status(c, x, y, w, h, label, value, col) { cham(c, x, y, w, h, col); txt(c, label, x + 4, y + 4, this.ink); txt(c, value, x + w - 5, y + 4, this.ink, 'right'); },
    schirm(c, r) {
      c.fillStyle = this.frame; const k = 8, { x, y, w, h } = r;
      c.fillRect(x, y, k, 1); c.fillRect(x, y, 1, k); c.fillRect(x + w - k, y, k, 1); c.fillRect(x + w - 1, y, 1, k);
      c.fillRect(x, y + h - 1, k, 1); c.fillRect(x, y + h - k, 1, k); c.fillRect(x + w - k, y + h - 1, k, 1); c.fillRect(x + w - 1, y + h - k, 1, k);
    },
    titel(c, x, y, w, text, col) { c.fillStyle = col; c.fillRect(x, y, 3, 8); const e = txt(c, text, x + 6, y + 1, col); c.fillStyle = rgba(col, 0.35); c.fillRect(e + 4, y + 4, Math.max(0, x + w - e - 4), 1); },
    knopf(c, b, col, kz, text) {
      const { x, y, w, h } = b, hov = hit(b), ty = y + Math.floor((h - 7) / 2);
      const kw = kz ? Math.max(13, tw(kz) + 7) : 0;
      if (b.disabled) {
        // SUND-02b UI (Review A1, Bild 11): gesperrt = keine Fläche, gepunkteter Rand wie die gesperrten Zellen des Waffenkreuzes (Form statt nur Farbe);
        // vorher dunkle Fläche mit vollem Rand, das las wie ein zweitrangiger, aber bedienbarer Knopf
        const pkt = mix(this.offLine, this.dim, 0.4);
        c.fillStyle = this.bg; c.fillRect(x, y, w, h);
        c.fillStyle = pkt; for (let i = 0; i < w; i += 2) { c.fillRect(x + i, y, 1, 1); c.fillRect(x + i, y + h - 1, 1, 1); } for (let i = 0; i < h; i += 2) { c.fillRect(x, y + i, 1, 1); c.fillRect(x + w - 1, y + i, 1, 1); }
        if (kw) { txt(c, kz, x + kw / 2, ty, this.dim, 'center'); for (let i = 2; i < h - 2; i += 2) c.fillRect(x + kw, y + i, 1, 1); }
        txt(c, text, kw ? x + kw + 4 : x + w / 2, ty, mix(this.dim, this.bg, 0.2), kw ? undefined : 'center');
        return;
      }
      const body = b.hold != null ? mix(col, this.bg, 0.62) : hov ? mix(col, '#FFFFFF', 0.18) : col;
      if (kw) { cham(c, x, y, kw, h, mix(col, this.bg, 0.55), 3, 0, 0, 0); cham(c, x + kw + 1, y, w - kw - 1, h, body, 0, 0, 3, 0); }
      else cham(c, x, y, w, h, body, 0, 0, 3, 0);
      if (b.hold != null) cham(c, x + kw + 1, y, Math.round((w - kw - 1) * Math.max(0, Math.min(1, b.hold))), h, col);
      if (kw) txt(c, kz, x + kw / 2, ty, this.text, 'center');
      txt(c, text, kw ? x + kw + 5 : x + w / 2, ty, b.hold != null ? this.text : this.ink, kw ? undefined : 'center');
      if (b.active) rand(c, x - 2, y - 2, w + 4, h + 4, this.text);
    },
    segs(c, x, y, n, f, col, sw = 9, sh = 7) {
      for (let i = 0; i < n; i++) { const xx = x + i * (sw + 2); if (i < f) { c.fillStyle = col; c.fillRect(xx, y, sw, sh); } else { c.fillStyle = this.offLine; c.fillRect(xx, y, sw, sh); c.fillStyle = this.off; c.fillRect(xx + 1, y + 1, sw - 2, sh - 2); } }
      return x + n * (sw + 2);
    },
    lampe(c, x, y, col, an) { c.fillStyle = an ? col : this.offLine; c.fillRect(x, y, 6, 6); if (an) { c.fillStyle = rgba(col, 0.25); c.fillRect(x - 1, y - 1, 8, 8); c.fillStyle = col; c.fillRect(x, y, 6, 6); } },
    zeileHi(c, x, y, w, h, col) { c.fillStyle = rgba(col, 0.12); c.fillRect(x, y, w, h); c.fillStyle = col; c.fillRect(x, y, 2, h); },
    zelle(c, b, kz, label, sub, col, zustand, p, opts) {
      const { x, y, w, h } = b, kw = 12;
      if (zustand === 'leer') {
        c.fillStyle = this.offLine; for (let i = 0; i < w; i += 3) { c.fillRect(x + i, y, 1, 1); c.fillRect(x + i, y + h - 1, 1, 1); } for (let i = 0; i < h; i += 3) { c.fillRect(x, y + i, 1, 1); c.fillRect(x + w - 1, y + i, 1, 1); }
        txt(c, kz, x + 7, y + 3, this.offLine, 'center'); txt(c, label, x + kw + 4, y + 3, this.offLine); if (sub) txt(c, sub, x + kw + 4, y + 13, this.offLine); return;
      }
      if (zustand === 'off') { cham(c, x, y, w, h, this.offLine, 4, 0, 4, 0); cham(c, x + 1, y + 1, w - 2, h - 2, this.off, 3, 0, 3, 0); txt(c, kz, x + 7, y + 3, this.dim, 'center'); txt(c, label, x + kw + 4, y + 3, this.dim); if (sub) txt(c, sub, x + kw + 4, y + 13, this.dim); return; }
      const hold = zustand === 'hold';
      cham(c, x, y, kw, h, mix(col, this.bg, 0.55), 4, 0, 0, 0);
      cham(c, x + kw + 1, y, w - kw - 1, h, hold ? mix(col, this.bg, 0.62) : hit(b) ? mix(col, '#FFFFFF', 0.18) : col, 0, 0, 4, 0);
      if (hold) { c.fillStyle = mix(this.ink, col, 0.3); c.fillRect(x + kw + 1, y + h - 2, w - kw - 4, 2); c.fillStyle = (opts && opts.balken) || this.text; c.fillRect(x + kw + 1, y + h - 2, Math.round((w - kw - 4) * (p || 0)), 2); }
      txt(c, kz, x + 6, y + 3, this.text, 'center');
      txt(c, label, x + kw + 4, y + 3, hold ? this.text : this.ink); if (sub) txt(c, sub, x + kw + 4, y + 13, hold ? ((opts && opts.subFarbe) || col) : mix(this.ink, col, 0.3));   // SYS-01 B2: Cooldown-Sekunden in cdText (Creme), nicht in Rot (3,0:1)
      if (zustand === 'sel' || (hold && opts && opts.sel)) rand(c, x - 2, y - 2, w + 4, h + 4, this.text);   // SYS-01 B2: die Cooldown-Zelle (hold) behält den Auswahlrahmen
    },
  };
  // GERMANEN: „Schmiede & Bernstein“. Eisenplatten mit Kerben und Nieten, Wolfszahn, Ochsenblut, Bernstein.
  // Tastenkappe = Schildbuckel in der Funktionsfarbe, Körper dunkel.
  SKINS.germanen = {
    id: 'germanen', name: 'Germanen', bg: '#13110F', screenBg: '#0D0C0B', text: '#EDE3CF', dim: '#9A8F80', off: '#1D1A17', offLine: '#3B3632', ink: '#13110F',
    plate: '#27231F', iron: '#4C4741', ironHi: '#7A7268', frame: '#8E3A26', accent: '#E9A23B',
    saeule(c, S, titel, alarm) {
      const fr = alarm ? FN.weapon : this.frame;
      cham(c, 6, 6, 48, S + 8, this.iron, 14, 14, 0, 10);
      c.fillStyle = fr; c.fillRect(50, 20, 4, S - 6);
      for (let y = 24; y < S - 4; y += 10) { c.fillStyle = this.iron; for (let r = 0; r < 4; r++) c.fillRect(50, y + r, 4 - r, 1); }
      for (let y = 40; y < S; y += 22) { c.fillStyle = this.ironHi; c.fillRect(14, y, 2, 2); }
      rhomb(c, 26, 12, this.accent); zigzag(c, 10, 30, 38, fr, 3);
      c.fillStyle = this.iron; c.fillRect(54, S, 84, 14);
      for (let r = 0; r < 10; r++) c.fillRect(54, S - 10 + r, r + 1, 1);
      c.fillStyle = fr; c.fillRect(54, S + 12, 84, 2);
      txt(c, titel, 62, S + 3, this.accent);
      zigzag(c, 62, 349, 572, fr, 3);
    },
    navBlock(c, x, y, w, h, key, sub, i, n, aktiv) {
      cham(c, x, y, w, h, aktiv ? this.accent : this.iron, 4, 4, 4, 4); cham(c, x + 1, y + 1, w - 2, h - 2, this.plate, 3, 3, 3, 3);
      if (h < 28) { txt(c, key, x + w / 2, y + Math.floor((h - 7) / 2), this.accent, 'center'); return; }
      txt(c, key, x + w / 2, y + 4, this.accent, 'center'); txt(c, sub, x + w / 2, y + h - 10, this.dim, 'center');
    },
    status(c, x, y, w, h, label, value, col) { cham(c, x, y, w, h, this.plate, 2, 2, 2, 2); c.fillStyle = col; c.fillRect(x + 2, y + h - 2, w - 4, 2); txt(c, label, x + 5, y + 3, this.dim); txt(c, value, x + w - 6, y + 3, col, 'right'); },
    schirm(c, r) {
      const { x, y, w, h } = r;
      c.fillStyle = this.iron; c.fillRect(x, y, w, 2); c.fillRect(x, y + h - 2, w, 2); c.fillRect(x, y, 2, h); c.fillRect(x + w - 2, y, 2, h);
      [[x, y], [x + w - 8, y], [x, y + h - 8], [x + w - 8, y + h - 8]].forEach(([px, py]) => { cham(c, px, py, 8, 8, this.ironHi, 2, 2, 2, 2); c.fillStyle = this.plate; c.fillRect(px + 3, py + 3, 2, 2); });
    },
    titel(c, x, y, w, text, col) { rhomb(c, x, y + 1, col); const e = txt(c, text, x + 8, y + 1, col); c.fillStyle = this.iron; for (let i = e + 4; i < x + w; i += 3) c.fillRect(i, y + 4, 1, 1); },
    knopf(c, b, col, kz, text) {
      const { x, y, w, h } = b, off = !!b.disabled, hov = hit(b), ty = y + Math.floor((h - 7) / 2);
      const kw = kz ? Math.max(13, tw(kz) + 7) : 0, cut = Math.min(3, Math.floor(h / 4));
      if (b.active && !off) { cham(c, x - 2, y - 2, w + 4, h + 4, col, cut + 1, cut + 1, cut + 1, cut + 1); cham(c, x - 1, y - 1, w + 2, h + 2, this.bg, cut + 1, cut + 1, cut + 1, cut + 1); }
      cham(c, x, y, w, h, off ? this.off : b.active ? mix(this.plate, col, 0.22) : hov ? mix(this.plate, col, 0.12) : this.plate, cut, cut, cut, cut);
      if (kw) { cham(c, x + 1, y + 1, kw, h - 2, off ? this.offLine : col, cut, cut, cut, cut); if (!off) { c.fillStyle = mix(col, '#FFFFFF', 0.35); c.fillRect(x + 4, y + 2, kw - 6, 1); } txt(c, kz, x + 1 + kw / 2, ty, off ? this.dim : this.ink, 'center'); }
      txt(c, text, kw ? x + kw + 6 : x + w / 2, ty, off ? mix(this.dim, this.bg, 0.25) : this.text, kw ? undefined : 'center');
      if (!off && h >= 12) { c.fillStyle = b.hold != null ? this.offLine : rgba(col, 0.55); c.fillRect(x + kw + 4, y + h - 2, Math.max(0, w - kw - 8), 1); }
      if (b.hold != null && !off) { c.fillStyle = col; c.fillRect(x + kw + 4, y + h - 3, Math.round(Math.max(0, w - kw - 8) * Math.max(0, Math.min(1, b.hold))), 2); }
    },
    segs(c, x, y, n, f, col, sw = 9) { const step = Math.max(7, sw); for (let i = 0; i < n; i++) rhomb(c, x + i * step, y + 1, i < f ? col : this.offLine); return x + n * step; },
    lampe(c, x, y, col, an) { rhomb(c, x, y, an ? col : this.offLine); },
    zeileHi(c, x, y, w, h, col) { c.fillStyle = rgba(col, 0.1); c.fillRect(x, y, w, h); rhomb(c, x - 7, y + Math.floor(h / 2) - 2, col); },
    zelle(c, b, kz, label, sub, col, zustand, p, opts) {
      const { x, y, w, h } = b, kw = 13, leer = zustand === 'leer', off = zustand === 'off' || leer;
      if (zustand === 'sel' || (zustand === 'hold' && opts && opts.sel)) { cham(c, x - 2, y - 2, w + 4, h + 4, col, 4, 4, 4, 4); cham(c, x - 1, y - 1, w + 2, h + 2, this.bg, 4, 4, 4, 4); }
      if (leer) { cham(c, x, y, w, h, this.off, 3, 3, 3, 3); cham(c, x + 1, y + 1, w - 2, h - 2, this.bg, 2, 2, 2, 2); } else cham(c, x, y, w, h, off ? this.off : hit(b) ? mix(this.plate, col, 0.12) : this.plate, 3, 3, 3, 3);
      cham(c, x + 1, y + 1, kw, h - 2, off ? (leer ? this.off : this.offLine) : col, 3, 3, 3, 3);
      if (!off) { c.fillStyle = mix(col, '#FFFFFF', 0.35); c.fillRect(x + 4, y + 2, kw - 6, 1); }
      txt(c, kz, x + 1 + kw / 2, y + Math.floor((h - 7) / 2), off ? this.dim : this.ink, 'center');
      txt(c, label, x + kw + 5, y + 3, leer ? this.offLine : off ? mix(this.dim, this.bg, 0.2) : this.text); if (sub) txt(c, sub, x + kw + 5, y + 13, leer ? this.offLine : off ? this.dim : col);
      if (zustand === 'hold') { c.fillStyle = this.offLine; c.fillRect(x + kw + 5, y + h - 2, w - kw - 9, 1); c.fillStyle = (opts && opts.balken) || col; c.fillRect(x + kw + 5, y + h - 3, Math.round((w - kw - 9) * (p || 0)), 2); }
    },
  };

  // ---------------------------------------------------------------- Auswahl des Skins
  const PARAM = new URLSearchParams(location.search).get('pult');
  function skinId(view) {
    let id = PARAM;
    if (!id) { try { id = localStorage.getItem('pantheon.pult'); } catch (e) { /* egal */ } }
    if (!id) {
      const kl = (view && view.state && view.state.ship && view.state.ship.klasse) || 'lerche';
      const sc = (CFG.shipClasses || {})[kl] || (CFG.shipClasses || {}).lerche || {};
      id = sc.pult || 'rom';
    }
    return SKINS[id] ? id : 'rom';
  }

  // ---------------------------------------------------------------- Zeichnen
  let K = SKINS.rom;   // Skin des laufenden Pults
  let gezeichnet = null;   // { S, t } des zuletzt gezeichneten Pults (statusOben)
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let hilfe = false;
  // Knopf im Skin; registriert die Klickfläche wie R.button. opts: hotkey, disabled, gedimmt (gedimmt gezeichnet, aber anklickbar: der Grund steht trotzdem als Hinweis), reason, active, onClick, fn (Funktionsfarbe), text (Anzeige statt label), hold (0..1)
  // Kontur-Variante (Welle 5, K3): leiser Nebenknopf (Ablehnen) ohne Farbfläche: Hintergrund, 1-px-Rand in gedämpfter Funktionsfarbe, Kappe und Text in Hell. Gesperrt bleibt der gepunktete Rand des Skins.
  function knopfKontur(S, c, b, col, kz, text) {
    const { x, y, w, h } = b, ty = y + Math.floor((h - 7) / 2), kw = kz ? Math.max(13, tw(kz) + 7) : 0, lin = mix(col, S.bg, hit(b) ? 0.25 : 0.6);
    c.fillStyle = hit(b) ? mix(col, S.bg, 0.82) : S.bg; c.fillRect(x, y, w, h);
    rand(c, x, y, w, h, lin);
    if (kw) { c.fillStyle = lin; c.fillRect(x + kw, y + 2, 1, h - 4); txt(c, kz, x + kw / 2, ty, S.text, 'center'); }
    txt(c, text, kw ? x + kw + 5 : x + w / 2, ty, S.text, kw ? undefined : 'center');
  }
  function knopf(c, x, y, w, h, label, opts) {
    opts = opts || {};
    const b = { x, y, w, h, label, disabled: !!opts.disabled, reason: opts.reason, onClick: opts.onClick, hotkey: opts.hotkey || null, active: !!opts.active, hold: opts.hold };
    const col = FN[opts.fn] || (opts.color && opts.color !== PAL.star ? opts.color : null) || (opts.active ? FN.shield : FN.neutral);
    b.hotkey = kappe(opts.hotkey, opts.aktion) || null;
    if (opts.kontur && !b.disabled) knopfKontur(K, c, b, col, b.hotkey || '', opts.text != null ? opts.text : label);   // Welle 5 (K3): Kontur statt Fläche
    else K.knopf(c, b, col, b.hotkey || '', opts.text != null ? opts.text : label);
    R.ui.buttons.push(b);
    if (hit(b) && b.reason && (b.disabled || opts.gedimmt)) R.ui.tooltip = { text: b.reason, x: R.ui.mouse.x, y: R.ui.mouse.y };
    return b;
  }
  // R.button während fn durch den Skin-Knopf ersetzen (eingebettete Ansichten)
  function mitSkin(fn) {
    const alt = R.button;
    R.button = (c, x, y, w, h, label, opts) => knopf(c, x, y, w, h, label, opts);
    try { return fn(); } finally { R.button = alt; }
  }
  function zelle(c, x, y, w, h, kz, label, sub, fn, zustand, p, opts) {
    opts = opts || {};
    kz = kappe(kz, opts.aktion);
    // klickbar: eine gedimmte Zelle bleibt anklickbar (Terminal: leerer Platz)
    const b = { x, y, w, h, label: opts.label || label, disabled: (zustand === 'off' || zustand === 'leer') && !opts.klickbar, reason: opts.reason, onClick: opts.onClick, hotkey: kz };
    // Abnahme 12: Platz rechts für Symbol und Ladepunkte (opts.rechts px) freihalten: Texte kürzen statt vom Symbol überdecken lassen
    if (opts.rechts) {
      const aw = w - 13 - 5 - opts.rechts, kurz = { 'Magazin voll': 'Magazin', 'BATTERIE': 'BATT.', 'STANDARD': 'STAND.' };
      const fit = (t) => { if (t == null) return t; t = String(t); if (tw(t) <= aw) return t; if (kurz[t] && tw(kurz[t]) <= aw) return kurz[t]; while (t.length > 2 && tw(t + '.') > aw) t = t.slice(0, -1); return t + '.'; };
      label = fit(label); sub = fit(sub);
    }
    K.zelle(c, b, kz, label, sub, FN[fn] || fn, zustand, p, opts);
    if (zustand !== 'leer') { R.ui.buttons.push(b); if (hit(b) && b.reason && (b.disabled || zustand === 'off')) R.ui.tooltip = { text: b.reason, x: R.ui.mouse.x, y: R.ui.mouse.y }; }
    return b;
  }
  function titel(c, x, y, w, text, fn) { K.titel(c, x, y, w, text, FN[fn] || fn); return y + 13; }
  function segs(c, x, y, n, f, fn, sw, sh) { return K.segs(c, x, y, n, f, FN[fn] || fn, sw, sh); }
  function lampe(c, x, y, fn, an) { K.lampe(c, x, y, FN[fn] || fn, an); }
  function zeileHi(c, x, y, w, h, fn) { K.zeileHi(c, x, y, w, h, FN[fn] || fn); }

  // Statusleiste: Antrieb, Schilde, Hülle, Alarm – für jede Station gleich
  function status(c, view, S) {
    const ship = (view.state && view.state.ship) || {};
    const n = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d || 0);
    const hi = window.Consoles && Consoles.helmInfo ? Consoles.helmInfo(ship) : null;
    const sp = Math.round(n(ship.speed, Math.hypot(n(ship.vx), n(ship.vy))));
    const sh = (ship.shields && ship.shields.current) || [0, 0, 0, 0];
    const PS = window.PultSysteme;
    const sf = PS ? PS.statusFeld(ship) : null;   // SYS-01 A1c: Reaktor zerstört > Mitte offen > schwächste Seite (statt HÜLLE/SYS); Farbe aus den Tokens je Skin
    const sfCol = sf ? PS.farben(skinId(view))[sf.farbe] : FN.sensor;
    const alarm = ship.alert || 'normal';
    const L = [
      { l: 'ANTRIEB', v: (hi ? hi.names[hi.stage] : '–') + '·' + sp, fn: 'drive', w: 1 },
      { l: 'SCHILDE', v: [0, 1, 2, 3].map((i) => n(sh[i])).join(' '), fn: 'shield', w: 1 },
      { l: sf ? sf.l : 'ZONEN', v: sf ? sf.v : '–', col: sfCol, w: 1 },
      { l: 'ALARM', v: alarm === 'red' ? 'ROT' : alarm === 'yellow' ? 'GELB' : 'GRÜN', fn: alarm === 'red' ? 'weapon' : alarm === 'yellow' ? 'warn' : 'shield', w: 0.8 },
    ];
    let x = 142; const total = L.reduce((a, s) => a + s.w, 0), avail = 634 - x - (L.length - 1) * 3;
    L.forEach((s) => { const w = Math.round(avail * s.w / total); K.status(c, x, S, w, 14, s.l, s.v, s.col || FN[s.fn]); x += w + 3; });
    return alarm;
  }

  // Rahmen eines Pults: Grund, Anzeige-Fläche, Säule mit Navigation, Statusleiste. -> { anzeige, pult, S }
  // def: { titel, S, station, anzeige(ctx, rect) }
  function rahmen(c, view, def) {
    K = SKINS[skinId(view)];
    const S = def.S;
    gezeichnet = { S, station: def.station || '', t: nowMs() };   // für statusOben (Funkwahl): welches Pult in diesem Bild gezeichnet wurde
    c.fillStyle = K.bg; c.fillRect(0, 0, VW, VH);
    const anzeige = { x: 62, y: 6, w: 572, h: S - 12 };
    c.fillStyle = K.screenBg; c.fillRect(anzeige.x, anzeige.y, anzeige.w, anzeige.h);
    // SYS-01 A2b: Banderole „REAKTOR ZERSTÖRT“ über jeder Anzeige, solange der Countdown läuft; der Inhalt rückt um MASS.banderole.versatz nach unten
    const PS = window.PultSysteme, bd = PS ? PS.banderole((((view.state && view.state.ship) || {}).reaktorTod), def.station) : null;
    if (bd) banderoleZeichnen(c, view, anzeige, bd);
    const versatz = bd ? PS.TOKENS.MASS.banderole.versatz : 0;
    const inhalt = { x: anzeige.x, y: anzeige.y + versatz, w: anzeige.w, h: anzeige.h - versatz };
    if (def.anzeige) { c.save(); c.beginPath(); c.rect(inhalt.x, inhalt.y, inhalt.w, inhalt.h); c.clip(); try { mitSkin(() => def.anzeige(c, inhalt)); } finally { c.restore(); } }
    K.schirm(c, anzeige);
    const alarm = ((view.state && view.state.ship) || {}).alert === 'red';
    K.saeule(c, S, def.titel, alarm);
    status(c, view, S);
    // Navigation in der unteren Säule: Station wechseln, Verlassen, Hilfe (klickbar)
    const kreis = (window.Shared_Protocol && Shared_Protocol.STATION_KREIS) || ['helm', 'weapons', 'captain', 'technik'];
    const nav = [
      kreis.includes(def.station) ? ['Tab', 'station', 'Station wechseln', () => view.send({ t: 'cmd', c: (Shared_Protocol && Shared_Protocol.CMD_STATION_TAB) || 'station.tab', dir: 1 })] : null,
      ['Esc', 'zurück', 'Verlassen', () => view.actions.leave()],
      ['?', 'hilfe', 'Hilfe', () => { hilfe = !hilfe; }],
    ].filter(Boolean);
    const y0 = S + 20, nh = Math.floor((346 - y0 - (nav.length - 1) * 3) / nav.length);
    nav.forEach((nv, i) => {
      const b = { x: 6, y: y0 + i * (nh + 3), w: 48, h: nh, label: nv[2], onClick: nv[3] };
      K.navBlock(c, b.x, b.y, b.w, b.h, nv[0], nv[1], i, nav.length, nv[0] === '?' && hilfe);
      R.ui.buttons.push(b);
    });
    return { anzeige: inhalt, pult: { x: 62, y: S + 22, w: 572, h: 346 - (S + 22) }, S, skin: K };
  }

  // SYS-01 A2b: Banderole (Richtung C): rot, volle Breite, ink-Text. Links „REAKTOR ZERSTÖRT“ und der Zähler (zahlScale), dann der Ausfallzähler; rechts der Satz der Station.
  // Darunter ein Ablaufbalken: Restzeit in Creme auf dunkler Spur. Farben aus den Tokens je Skin, Maße aus MASS.banderole (keine Zahl hier).
  function banderoleZeichnen(c, view, a, bd) {
    const PS = window.PultSysteme, M = PS.TOKENS.MASS.banderole, T = PS.TOKENS.TEXT, F = PS.farben(skinId(view));
    const y = a.y, h = M.h, ink = F.banderoleText;
    c.fillStyle = F.banderole; c.fillRect(a.x, y, a.w, h);
    let x = a.x + 6;
    x = txt(c, T.banderole, x, y + 6, ink) + 8;
    R.text(c, bd.zahl, x, y + 3, { color: ink, scale: M.zahlScale, shadow: false });
    x += R.measure(bd.zahl, M.zahlScale) + 4;
    // Der Satz der Station hat Vorrang vor dem Ausfallzähler: passt beides nicht, bleibt die Sekundenangabe
    const frei = a.x + a.w - 6 - tw(bd.satz) - 12;
    x = x + tw(' s · ' + bd.ausfall) <= frei ? txt(c, ' s · ' + bd.ausfall, x, y + 6, ink) : txt(c, ' s', x, y + 6, ink);
    txt(c, bd.satz, a.x + a.w - 6, y + 6, ink, 'right');
    c.fillStyle = F.banderoleSpur; c.fillRect(a.x, y + h, a.w, M.ablauf);
    c.fillStyle = F.banderoleAblauf; c.fillRect(a.x, y + h, Math.round(a.w * bd.anteil), M.ablauf);
  }
  // Hilfe-Overlay: alle Knöpfe des Pults mit Taste und Sperrgrund (aus R.ui.buttons, daher immer aktuell)
  function zeichneHilfe(c) {
    if (!hilfe) return;
    const seen = new Set(), rows = [];
    for (const b of R.ui.buttons) { if (!b.hotkey || seen.has(b.label)) continue; seen.add(b.label); rows.push(b); }
    const w = 420, lh = 10, h = Math.min(300, 30 + rows.length * lh), x = (VW - w) / 2, y = 30;
    c.fillStyle = rgba(K.bg, 0.94); c.fillRect(x, y, w, h); rand(c, x, y, w, h, K.frame);
    txt(c, 'HILFE · Taste hält / drückt · ? schließt', x + 8, y + 6, K.accent);
    rows.slice(0, Math.floor((h - 30) / lh)).forEach((b, i) => {
      const yy = y + 22 + i * lh;
      txt(c, b.hotkey, x + 34, yy, K.text, 'right');
      txt(c, b.label, x + 42, yy, b.disabled ? K.dim : K.text);
      if (b.disabled && b.reason) txt(c, b.reason.slice(0, 40), x + w - 8, yy, FN.warn, 'right');
    });
  }
  function hilfeUmschalten() { hilfe = !hilfe; }
  // SUND-03b UI (M1): Oberkante der Statusleiste des Pults, das in diesem Bild gezeichnet wurde (y in 640×360), sonst null (Bordansicht ohne Konsole).
  // Das Pult meldet sich beim Zeichnen selbst (rahmen); ein Eintrag, der älter als ein paar Bilder ist, gilt nicht mehr (Konsole verlassen).
  function statusOben(view) { return gezeichnet && nowMs() - gezeichnet.t < 150 ? gezeichnet.S : null; }

  // Wie statusOben, mit Station: { S, station } (Funkwahl: Streifen statt Leiste an Konsolen mit Bedienflächen), sonst null
  function konsole(view) { return gezeichnet && nowMs() - gezeichnet.t < 150 ? { S: gezeichnet.S, station: gezeichnet.station } : null; }

  window.Pult = {
    FN, SKINS, skinId, rahmen, knopf, zelle, titel, segs, lampe, zeileHi, mitSkin, zeichneHilfe, hilfeUmschalten, statusOben, konsole, kappe,
    get skin() { return K; }, get hilfe() { return hilfe; },
    txt, tw, mix, rgba, cham, rhomb,
  };
})();
