// BOT-04 C: winziger Lader der Bot-Sprache. Ist die Sprache aus (Standard), tut dieses Skript nichts: kein Mikrofon, kein Netzaufruf, kein weiteres Skript.
// An wird sie durch den Schalter in den Optionen (Spielmenü > Optionen > Bot-Sprache, gemerkt in localStorage 'pantheon.botsprache') oder durch die Adresse
// ?botsprache=1 · ?botmock=ws://localhost:8710 (Mock-Server) · ?botmessung=1 (Messmodus). Erst dann wird js/bot-sprache.js nachgeladen.
// Globales `BotSpracheStart`: an() · setze(bool) · umschalten()
(function () {
  'use strict';
  const KEY = 'pantheon.botsprache';
  let params;
  try { params = new URLSearchParams(window.location.search); } catch (e) { params = new URLSearchParams(''); }
  const lsGet = () => { try { return window.localStorage.getItem(KEY); } catch (e) { return null; } };
  const lsSet = (v) => { try { window.localStorage.setItem(KEY, v); } catch (e) { /* nur diese Sitzung */ } };
  let geladen = null, wunsch = lsGet() === '1' || params.get('botsprache') === '1' || params.get('botmock') !== null || params.get('botmessung') === '1';

  function laden() {
    if (geladen) return geladen;
    geladen = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'js/bot-sprache.js';
      s.onload = () => resolve(window.BotSprache);
      s.onerror = () => { geladen = null; reject(new Error('bot-sprache.js nicht geladen')); };
      document.head.appendChild(s);
    });
    return geladen;
  }
  function setze(an) {
    wunsch = !!an; lsSet(wunsch ? '1' : '0');
    if (wunsch) return laden().then((m) => m.starte(window)).catch(() => { wunsch = false; });
    if (window.BotSprache) window.BotSprache.stoppe();
    return Promise.resolve();
  }
  // TRA-01 Nacharbeit P2: Ist die Sprache aus, tun Sprechtaste ^ und Textzeile # nichts. Im Training (Captain mit Sprache) sagt dann eine Meldung (Hud.pushNotice, wie die übrigen Hinweise), wie es weitergeht.
  const AUS_TEXT = 'Bot-Sprache ist aus: Esc, Optionen, Bot-Sprache. Oder Befehlstafel (B).';
  let letzteMeldung = 0;
  function ausMeldung(e) {
    try {
      if (wunsch || e.repeat) return;
      const T = window.Tasten, passt = (id, code) => (T && T.passt ? T.passt(e, id) : e.code === code);
      if (!(passt('allgemein.sprechen', 'Backquote') || passt('allgemein.botText', 'Backslash'))) return;
      const a = document.activeElement; if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
      const st = window.Client && window.Client.state, TH = window.TrainingHud;
      if (!(st && TH && TH.istTraining(st.mission)) || !window.Hud) return;
      const jetzt = Date.now(); if (jetzt - letzteMeldung < 3000) return; letzteMeldung = jetzt;
      window.Hud.pushNotice(AUS_TEXT, window.Render && window.Render.PAL ? window.Render.PAL.warn : undefined, 4);
    } catch (err) { /* nur eine Meldung weniger */ }
  }
  if (typeof window.addEventListener === 'function') window.addEventListener('keydown', ausMeldung, true);
  window.BotSpracheStart = { an: () => wunsch, setze, umschalten: () => setze(!wunsch), ausMeldung, AUS_TEXT };
  if (wunsch) laden().then((m) => m.starte(window)).catch(() => { wunsch = false; });
})();
