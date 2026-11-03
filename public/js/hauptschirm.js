// KUL-02 A: Hauptschirm-Ansicht. Ein Zustand für die ganze Brücke: der Server hält ihn (game.hauptschirmAnsicht) und trägt ihn als ship.hs in den Snapshot
// (nur 'visier'; fehlt das Feld, gilt 'klassisch'). Jeder Zeichner liest ihn hier über ansichtVon(view), nichts wird als Parameter durchgereicht.
// Registry: je Ansicht EIN Zeichner. 'klassisch' registriert sitz.js (Frontsicht, ab KUL-02 C mit Himmelskulisse), 'visier' kommt mit KUL-03.
// Globales `Hauptschirm`.
(function () {
  'use strict';

  const ANSICHTEN = ['klassisch', 'visier'];
  const NAMEN = { klassisch: 'KLASSISCH', visier: 'VISIER' };
  const zeichner = {};

  // Aktive Ansicht aus dem Snapshot (view.state.ship.hs); alles Unbekannte = klassisch.
  function ansichtVon(view) {
    const hs = view && view.state && view.state.ship && view.state.ship.hs;
    return ANSICHTEN.includes(hs) ? hs : 'klassisch';
  }
  function andere(ansicht) { return ansicht === 'visier' ? 'klassisch' : 'visier'; }
  function registriere(ansicht, fn) { if (!ANSICHTEN.includes(ansicht)) throw new Error('Hauptschirm: unbekannte Ansicht ' + ansicht); zeichner[ansicht] = fn; }
  // Ruft den Zeichner der aktiven Ansicht (fehlt er, der klassische).
  function zeichne(ctx, view, rect) {
    const fn = zeichner[ansichtVon(view)] || zeichner.klassisch;
    if (fn) fn(ctx, view, rect);
  }

  window.Hauptschirm = { ANSICHTEN, NAMEN, ansichtVon, andere, registriere, zeichne };
})();
