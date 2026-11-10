// LIV-02 P2 / Nacharbeit: Anzeige der Frage „Limit erhöhen?“ (Modell: kontingent-frage.js). Eine einzeilige, flache Leiste am unteren Rand des Spiels (Canvas-Einheiten x 356..630, y 343..359; zu Fuß weiter oben, wenn dort
// das Boden-Panel, die ODA-Zeile oder die Funkwahl steht, siehe Hud.kontingentLeiste), nur solange der Server die Frage stellt; ohne Frage wird nie ein Element angelegt.
// Das Element ist DOM (kein Canvas-Neubau), wird aber wie #lobbyCode mit Client.scale auf die Canvas-Fläche umgerechnet: Position und Größe folgen Skalenwechsel und Resize.
// Look wie das Siegel „Weltstand gesichert“: flacher dunkler Grund, 1 px Messingrand, kein Schatten, keine Innenlinie. Ja und Nein sind gleich gestaltet.
// Nicht modal: kein Backdrop, kein Fokusfang, keine Taste, keine Pause; Bedienung nur per Mausklick auf „Ja“ / „Nein“ (Knöpfe tabindex -1, Kontextmenü unterdrückt).
(function () {
  'use strict';
  const K = window.KontingentFrage;
  if (!K) return;
  const VW = 640;
  const STANDARD = { x: 356, y: 343, w: 274, h: 16 };   // Canvas-Einheiten (wie Hud.KONT_LEISTE); Hud.kontingentLeiste liefert zu Fuß eine höhere Lage über Client.kontingentLeiste
  let el = null, teile = null, wartetTimer = 0, schleife = false, lageKey = '', textKey = '';

  const senden = (msg) => { try { return window.Net && Net.send(msg); } catch (e) { return false; } };

  function bauen() {
    const css = document.createElement('style');
    css.textContent = [
      '#kontingentFrage{position:fixed;z-index:20;box-sizing:border-box;display:flex;align-items:center;gap:8px;padding:0 6px;overflow:hidden;white-space:nowrap;',
      'background:rgba(11,14,26,.85);color:#F4EEDC;font-family:monospace;line-height:1;border:1px solid #FFC66B;box-shadow:none}',
      '#kontingentFrage.kf-fehler{color:#F2C94C;border-color:#F2C94C}',
      '#kontingentFrage .kf-text{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}',
      '#kontingentFrage button{flex:none;cursor:pointer;font:inherit;box-sizing:border-box;border-radius:0;padding:0 10px;color:#F4EEDC;background:transparent;border:1px solid #8EA3B5}',
      '#kontingentFrage button:hover:not(:disabled){color:#FFC66B;border-color:#FFC66B}',
      '#kontingentFrage button:disabled{cursor:default;opacity:.55}',
    ].join('');
    document.head.appendChild(css);
    el = document.createElement('div');
    el.id = 'kontingentFrage'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', K.TEXT.titel);
    el.innerHTML = '<span class="kf-text" role="status"></span><button type="button" class="kf-ja" tabindex="-1"></button><button type="button" class="kf-nein" tabindex="-1"></button>';
    teile = { text: el.querySelector('.kf-text'), ja: el.querySelector('.kf-ja'), nein: el.querySelector('.kf-nein') };
    el.addEventListener('contextmenu', (e) => { if (e && e.preventDefault) e.preventDefault(); });
    teile.ja.addEventListener('click', (e) => { e.preventDefault(); if (K.freigeben(senden, Date.now())) zeichnen(); teile.ja.blur(); });
    teile.nein.addEventListener('click', (e) => { e.preventDefault(); if (K.ablehnen(senden, Date.now())) zeichnen(); teile.nein.blur(); });
    document.body.appendChild(el);
  }

  // Lage und Größe aus der Canvas-Fläche und Client.scale (wie #lobbyCode in client.js layout()); die Unterkante bleibt fest, bei kleiner Skala wächst die Leiste nach oben (Knopfhöhe mindestens 24 px)
  function plazieren() {
    if (!el) return;
    try {
      const cv = document.getElementById && document.getElementById('game');
      const r = cv ? cv.getBoundingClientRect() : { left: 0, top: 0, width: VW };
      const sc = (window.Client && Client.scale) || (r.width / VW) || 1;
      const l = (window.Client && Client.kontingentLeiste) || STANDARD;
      const font = Math.max(13, Math.round(8 * sc));
      const knopf = Math.max(24, Math.round(14 * sc));
      const hoch = Math.max(Math.round(l.h * sc), knopf + 2);
      const rechts = r.left + (l.x + l.w) * sc, unten = r.top + (l.y + l.h) * sc;
      const key = [Math.round(rechts), Math.round(unten), Math.round(l.w * sc), hoch, font, knopf].join(',');
      if (key === lageKey) return;
      lageKey = key; textKey = '';   // andere Größe: Kurzform neu prüfen
      const s = el.style;
      s.width = Math.round(l.w * sc) + 'px'; s.height = hoch + 'px';
      s.left = Math.round(rechts - l.w * sc) + 'px'; s.top = Math.round(unten - hoch) + 'px';
      s.fontSize = font + 'px';
      teile.ja.style.height = teile.nein.style.height = knopf + 'px';
    } catch (e) { /* nie in den Spielablauf */ }
  }

  function zeichnen() {
    const m = K.modell(Date.now());
    if (!m) { if (el) el.style.display = 'none'; return; }
    if (!el) bauen();
    el.style.display = '';
    el.className = m.fehler ? 'kf-fehler' : '';
    teile.ja.textContent = m.ja; teile.nein.textContent = m.nein;
    teile.ja.disabled = teile.nein.disabled = !m.aktiv;
    plazieren();
    // Eine Zeile, die Box wächst nie: passt der lange Text nicht in die Breite (kleine Skala), kommt die Kurzform
    const voll = m.fehler || m.text, kurz = m.fehler ? m.fehlerKurz : m.kurz;
    const key = lageKey + '|' + voll;
    if (key !== textKey) {
      textKey = key;
      teile.text.textContent = voll;
      if (typeof teile.text.scrollWidth === 'number' && teile.text.scrollWidth > teile.text.clientWidth + 1) teile.text.textContent = kurz;
    }
    // fehlt die Antwort, geben die Knöpfe nach der Wartezeit von selbst wieder frei
    clearTimeout(wartetTimer);
    if (m.wartet) wartetTimer = setTimeout(zeichnen, K.WARTE_MS + 50);
    nachfuehren();
  }

  // Solange die Leiste steht, folgt sie Skalenwechsel, Resize und der Lage, die das HUD je Frame meldet (zu Fuß ändert sie sich mit Panels)
  function nachfuehren() {
    if (schleife || typeof window.requestAnimationFrame !== 'function') return;
    schleife = true;
    const lauf = () => {
      if (!el || el.style.display === 'none') { schleife = false; return; }
      const alt = lageKey; plazieren();
      if (lageKey !== alt) zeichnen();
      window.requestAnimationFrame(lauf);
    };
    window.requestAnimationFrame(lauf);
  }

  if (window.Net && typeof Net.on === 'function') Net.on(() => zeichnen());   // nach kontingent-frage.js (Skriptreihenfolge): erst lesen, dann zeichnen
  window.KontingentFrageUi = { zeichnen, element: () => el };
})();
