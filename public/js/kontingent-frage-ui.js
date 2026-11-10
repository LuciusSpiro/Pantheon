// LIV-02 P2: Anzeige der Frage „Limit erhöhen?“ (Modell: kontingent-frage.js). Kleines System-Popup oben über dem Spiel, nur solange der Server die Frage stellt;
// ohne Frage wird nie ein Element angelegt. Look der Systemanzeigen (Verbindungs-Overlay, Panel „screen“): Grund #0E1A1F, Messingrand, feine Minzlinie innen, Bernstein-Titel.
// Nicht modal: kein Backdrop, kein Fokusfang, keine Taste, keine Pause. Das Element ist klein und fängt nur auf sich selbst Mausklicks; Bedienung nur per Knopf „Ja“ / „Nein“.
(function () {
  'use strict';
  const K = window.KontingentFrage;
  if (!K) return;
  let el = null, teile = null, wartetTimer = 0;

  const senden = (msg) => { try { return window.Net && Net.send(msg); } catch (e) { return false; } };

  function bauen() {
    const css = document.createElement('style');
    css.textContent = [
      '#kontingentFrage{position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:20;box-sizing:border-box;max-width:min(420px,calc(100vw - 32px));padding:9px 14px 10px;',
      'background:#0E1A1F;color:#F4EEDC;font:13px/1.35 monospace;border:2px solid #C9974A;box-shadow:inset 0 0 0 2px #0E1A1F,inset 0 0 0 3px rgba(127,224,194,.25),0 4px 18px rgba(0,0,0,.55)}',
      '#kontingentFrage .kf-titel{color:#FFC66B;font-weight:bold;letter-spacing:.08em}',
      '#kontingentFrage .kf-text{margin:4px 0 8px}',
      '#kontingentFrage .kf-zeile{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '#kontingentFrage button{cursor:pointer;font:bold 13px monospace;min-width:56px;padding:5px 14px;border-radius:0;color:#F4EEDC;background:transparent;border:2px solid #8EA3B5}',
      '#kontingentFrage button.kf-ja{color:#1A1204;background:#FFC66B;border-color:#C9974A}',
      '#kontingentFrage button:hover:not(:disabled){filter:brightness(1.15)}',
      '#kontingentFrage button:focus-visible{outline:2px solid #F4EEDC;outline-offset:2px}',
      '#kontingentFrage button:disabled{cursor:default;opacity:.55}',
      '#kontingentFrage .kf-fehler{color:#F2C94C}',
    ].join('');
    document.head.appendChild(css);
    el = document.createElement('div');
    el.id = 'kontingentFrage'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-labelledby', 'kf-titel'); el.setAttribute('aria-describedby', 'kf-text');
    el.innerHTML = '<div class="kf-titel" id="kf-titel"></div><div class="kf-text" id="kf-text"></div>' +
      '<div class="kf-zeile"><button type="button" class="kf-ja"></button><button type="button" class="kf-nein"></button><span class="kf-fehler" role="status"></span></div>';
    teile = { titel: el.querySelector('.kf-titel'), text: el.querySelector('.kf-text'), ja: el.querySelector('.kf-ja'), nein: el.querySelector('.kf-nein'), fehler: el.querySelector('.kf-fehler') };
    teile.ja.addEventListener('click', (e) => { e.preventDefault(); if (K.freigeben(senden, Date.now())) zeichnen(); teile.ja.blur(); });
    teile.nein.addEventListener('click', (e) => { e.preventDefault(); if (K.ablehnen(senden, Date.now())) zeichnen(); teile.nein.blur(); });
    document.body.appendChild(el);
  }

  function zeichnen() {
    const m = K.modell(Date.now());
    if (!m) { if (el) el.style.display = 'none'; return; }
    if (!el) bauen();
    el.style.display = '';
    teile.titel.textContent = m.titel; teile.text.textContent = m.text;
    teile.ja.textContent = m.ja; teile.nein.textContent = m.nein;
    teile.ja.disabled = teile.nein.disabled = !m.aktiv;
    teile.fehler.textContent = m.fehler;
    // fehlt die Antwort, geben die Knöpfe nach der Wartezeit von selbst wieder frei
    clearTimeout(wartetTimer);
    if (m.wartet) wartetTimer = setTimeout(zeichnen, K.WARTE_MS + 50);
  }

  if (window.Net && typeof Net.on === 'function') Net.on(() => zeichnen());   // nach kontingent-frage.js (Skriptreihenfolge): erst lesen, dann zeichnen
  window.KontingentFrageUi = { zeichnen, element: () => el };
})();
