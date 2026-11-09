// LIV-01 A2: Anzeige der Kontingent-Meldung (Modell: kontingent.js). Ein schmaler DOM-Streifen oben über dem Spiel, nur solange world.kontingent.erreicht gilt;
// ohne Live-Modus (kein Block) wird nie ein Element angelegt. Eckig, Messing und Bernstein wie die Pulte; die Tastenkappe zeigt die echte Taste (Tasten, Aktion allgemein.kontingentFreigeben, umbelegbar).
// Blockiert nichts: der Streifen fängt nur auf dem Knopf Mausklicks, alles andere geht durch (pointer-events), kein Fokusfang, keine modale Sperre.
// Bedient wird per Knopf oder Taste, aber nur an der Captain-Konsole; alle anderen sehen die Meldung mit gesperrtem Knopf und dem Hinweis „Nur an der Captain-Konsole“.
(function () {
  'use strict';
  const K = window.Kontingent;
  if (!K) return;
  const AKTION = 'allgemein.kontingentFreigeben';
  let el = null, teile = null, wartetTimer = 0;

  const state = () => (window.Client && Client.state) || null;
  const ich = () => { const s = state(); return s && s.players ? s.players.find((p) => p.id === Client.pid) || null : null; };
  // dieselbe Ableitung wie der Server (Station.stationOf: aktives Interface, p.station oder die Konsole): Consoles.stationOf (consoles.js, lädt vor dieser Datei)
  const konsole = () => { const m = ich(); return m && window.Consoles && Consoles.stationOf ? Consoles.stationOf(m) : null; };
  const sichtbar = () => { const s = state(); return !!s && s.phase !== 'lobby' && !!ich(); };
  const kappe = () => { try { return window.Tasten && Tasten.belegung(AKTION).length ? Tasten.kappe(AKTION) : '–'; } catch (e) { return '–'; } };
  const senden = (msg) => { try { return window.Net && Net.send(msg); } catch (e) { return false; } };

  function bauen() {
    const css = document.createElement('style');
    css.textContent = [
      '#kontingent{position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:20;box-sizing:border-box;max-width:min(560px,calc(100vw - 32px));padding:8px 14px 9px;',
      'background:#14110A;color:#F4EEDC;font:13px/1.35 monospace;border:2px solid #C9974A;pointer-events:none;',
      'clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px);box-shadow:0 0 0 1px #0B0E1A,0 4px 18px rgba(0,0,0,.55)}',
      '#kontingent .k-kopf{display:flex;align-items:center;gap:10px;color:#FFC66B;font-weight:bold;letter-spacing:.12em;text-transform:uppercase}',
      '#kontingent .k-lampe{width:10px;height:10px;background:#FFC66B;box-shadow:0 0 8px #FFC66B;flex:none}',
      '#kontingent .k-zahl{margin-left:auto;color:#F4EEDC;letter-spacing:.04em;text-transform:none}',
      '#kontingent .k-text{margin:4px 0 7px;color:#D9CFB4}',
      '#kontingent .k-zeile{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '#kontingent button{pointer-events:auto;cursor:pointer;font:bold 13px monospace;color:#1A1204;background:#FFC66B;border:2px solid #C9974A;padding:5px 12px;border-radius:0;',
      'clip-path:polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)}',
      '#kontingent button:hover:not(:disabled){background:#FFD98F}',
      '#kontingent button:focus-visible{outline:2px solid #F4EEDC;outline-offset:2px}',
      '#kontingent button:disabled{cursor:default;color:#8A7A55;background:#2A2416;border-color:#5C4A28}',
      '#kontingent .k-kappe{display:inline-block;min-width:22px;padding:1px 6px;margin-left:8px;text-align:center;color:#FFC66B;background:#0B0E1A;border:1px solid #C9974A;font-weight:bold}',
      '#kontingent button:disabled .k-kappe{color:#8A7A55;border-color:#5C4A28}',
      '#kontingent .k-info{color:#D9CFB4}',
      '#kontingent .k-info.ok{color:#7FE0C2}',
      '#kontingent .k-info.nein{color:#FFC66B}',
    ].join('');
    document.head.appendChild(css);
    el = document.createElement('div');
    el.id = 'kontingent'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<div class="k-kopf"><span class="k-lampe"></span><span class="k-titel"></span><span class="k-zahl"></span></div><div class="k-text"></div>' +
      '<div class="k-zeile"><button type="button" class="k-knopf" tabindex="-1"><span class="k-knopftext"></span><span class="k-kappe"></span></button><span class="k-info"></span></div>';
    teile = { titel: el.querySelector('.k-titel'), zahl: el.querySelector('.k-zahl'), text: el.querySelector('.k-text'), knopf: el.querySelector('.k-knopf'), knopftext: el.querySelector('.k-knopftext'), kappe: el.querySelector('.k-kappe'), info: el.querySelector('.k-info') };
    teile.knopf.addEventListener('click', (e) => { e.preventDefault(); freigeben(); teile.knopf.blur(); });
    document.body.appendChild(el);
  }

  function modell() { return sichtbar() ? K.modell(konsole(), Date.now()) : null; }
  function zeichnen() {
    const m = modell();
    if (!m) { if (el) el.style.display = 'none'; return; }
    if (!el) bauen();
    el.style.display = '';
    teile.titel.textContent = m.titel; teile.zahl.textContent = m.verbrauch + ' Tokens'; teile.text.textContent = m.text;
    teile.knopftext.textContent = m.knopf; teile.kappe.textContent = kappe();
    teile.knopf.disabled = !m.aktiv;
    teile.knopf.title = m.aktiv ? '' : (m.hinweis || m.antwort && m.antwort.text || '');
    const info = m.antwort ? m.antwort : m.hinweis ? { ok: null, text: m.hinweis } : { ok: null, text: '' };
    teile.info.textContent = info.text; teile.info.className = 'k-info' + (info.ok === true ? ' ok' : info.ok === false ? ' nein' : '');
    // fehlt die Antwort, gibt der Knopf nach der Wartezeit von selbst wieder frei
    clearTimeout(wartetTimer);
    if (m.wartet) wartetTimer = setTimeout(zeichnen, K.WARTE_MS + 50);
  }
  function freigeben() {
    if (K.freigeben(senden, konsole(), Date.now())) zeichnen();
    return true;
  }
  // Taste (client.js, vor den Konsolentasten): wahr = Taste verbraucht (nur solange die Meldung offen ist)
  function taste(e) {
    if (!window.Tasten || !Tasten.passt(e, AKTION) || !modell()) return false;
    e.preventDefault();
    if (!e.repeat) freigeben();
    return true;
  }

  if (window.Net && typeof Net.on === 'function') Net.on(() => zeichnen());   // nach kontingent.js (Skriptreihenfolge): erst lesen, dann zeichnen
  window.KontingentUi = { taste, zeichnen, konsole, element: () => el };
})();
