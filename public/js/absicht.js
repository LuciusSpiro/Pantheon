// SUND-02b D: Strategische Optionen in der Anzeige (nur Freie Fahrt Sund). Globales `Absicht`, in Node als Modul (Tests).
// Storage: store.absicht = letzter Block world.absicht { frei, ab, angebot?, rest?, laufend? } (kommt nur bei Änderung; world.absicht = null ist das Löschsignal, wenn der Modus
//   endet; welcome und die Lobby leeren ebenfalls, sonst stünde ein altes Angebot in Kampagne oder Lobby). Gleich für alle Spieler (nur der Server schreibt).
// Action: modell() -> null | { frei, ab, angebot: [{ id, name, text, dauer }], rest, laufend: { id, name, text, rest, dauer } | null }, müll-fest (ohne Block keine Anzeige, kein Platzhalter).
// Das Terminal (terminal-ui.js, Bereich „Lage“) baut daraus sein Modell und sendet absicht.waehlen / absicht.ablehnen; der Server entscheidet alles.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Absicht = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const store = { absicht: null, texte: null };   // texte = content/flotte/absichten.json, Abschnitt anzeige (vom Server gelesen)
  function lesen(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'welcome') { store.absicht = null; return; }   // neue Verbindung: der Server sendet den Block neu (sentAbsichtKey wird zurückgesetzt)
    if (msg.t !== 'snap') return;
    if (msg.phase === 'lobby') { store.absicht = null; return; }
    if (msg.world && Object.prototype.hasOwnProperty.call(msg.world, 'absicht')) store.absicht = msg.world.absicht && typeof msg.world.absicht === 'object' ? msg.world.absicht : null;
  }
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const str = (v) => (typeof v === 'string' ? v : '');
  function karte(a) {
    if (!a || typeof a !== 'object' || !str(a.id) || !str(a.name)) return null;
    return { id: a.id, name: a.name, text: str(a.text), dauer: isNum(a.dauer) ? Math.max(0, Math.floor(a.dauer)) : 0 };
  }
  function modellAus(b) {
    if (!b || typeof b !== 'object') return null;
    const angebot = Array.isArray(b.angebot) ? b.angebot.map(karte).filter(Boolean).slice(0, 3) : [];
    const l = karte(b.laufend);
    return {
      frei: b.frei === 1 || b.frei === true, ab: str(b.ab),
      angebot, rest: isNum(b.rest) ? Math.max(0, Math.floor(b.rest)) : 0,
      laufend: l ? Object.assign(l, { rest: isNum(b.laufend.rest) ? Math.max(0, Math.floor(b.laufend.rest)) : 0 }) : null,
    };
  }
  const modell = () => modellAus(store.absicht);
  // Text aus der Datei; {name} -> Werte. Fehlt die Datei (noch nicht geladen), bleibt der Text leer (kein Platzhalter im Code).
  const text = (key, w) => String(((store.texte || {})[key]) == null ? '' : store.texte[key]).replace(/\{(\w+)\}/g, (m, k) => (w && w[k] != null ? String(w[k]) : m));
  const sprung = (n) => text(n === 1 ? 'sprung_eins' : 'sprung_mehr', { n });
  function laden() {
    if (typeof fetch !== 'function') return;
    fetch('/content/flotte/absichten.json').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.anzeige && typeof j.anzeige === 'object') store.texte = j.anzeige; }).catch(() => { /* ohne Texte: leere Beschriftungen */ });
  }

  (function haken() {
    const N = root && root.Net;
    if (!N || typeof N.on !== 'function') return;
    N.on(lesen);
    laden();
  })();

  return { store, lesen, modellAus, modell, text, sprung };
});
