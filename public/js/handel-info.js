// SUND-03b I: Informationshandel des Konkordats in der Anzeige (nur Freie Fahrt Sund, nur an Konkordat-Häfen). Globales `HandelInfo`, in Node als Modul (Tests).
// Storage: store.info = letzter Block world.info { th: [{ i, a, g?, b? }], l?: [{ s, x }] } (kommt nur bei Änderung; world.info = null ist das Löschsignal; welcome und die Lobby leeren ebenfalls).
//   Gleich für alle Spieler (nur der Server schreibt). store.werte = content/welt/handel-info-werte.json (Preise, Texte, Themenüberschriften; vom Server gelesen).
// Action: modell() -> null | { themen: [{ id, art, name, gerucht, beleg }], letzte: [{ stufe, text }], preise: { gerucht, beleg } }, müll-fest (ohne Block keine Anzeige, kein Platzhalter).
// Das Terminal (terminal-ui.js, Bereich „Information“) baut daraus sein Modell und sendet info.kaufen; der Server entscheidet alles.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HandelInfo = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const store = { info: null, werte: null };
  function lesen(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'welcome') { store.info = null; return; }   // neue Verbindung: der Server sendet den Block neu (sentInfoKey wird zurückgesetzt)
    if (msg.t !== 'snap') return;
    if (msg.phase === 'lobby') { store.info = null; return; }
    if (msg.world && Object.prototype.hasOwnProperty.call(msg.world, 'info')) store.info = msg.world.info && typeof msg.world.info === 'object' ? msg.world.info : null;
  }
  const str = (v) => (typeof v === 'string' ? v : '');
  const W = () => (store.werte && typeof store.werte === 'object' ? store.werte : {});
  const wert = (k, d) => { const w = W()[k]; return w && w.wert !== undefined ? w.wert : d; };
  const text = (key) => str((wert('texte', {}) || {})[key]);
  function thema(t) {
    if (!t || typeof t !== 'object' || !/^t\d$/.test(str(t.i)) || !str(t.a)) return null;
    const th = wert('themen', {}) || {};
    return { id: t.i, art: t.a, name: str((th[t.a] || {}).label) || t.a, gerucht: t.g === 1, beleg: t.b === 1 };
  }
  function modellAus(b) {
    if (!b || typeof b !== 'object') return null;
    const themen = Array.isArray(b.th) ? b.th.map(thema).filter(Boolean).slice(0, 3) : [];
    const letzte = Array.isArray(b.l) ? b.l.filter((q) => q && str(q.x)).map((q) => ({ stufe: q.s === 'b' ? 'beleg' : 'gerucht', text: q.x })).slice(0, 2) : [];
    const p = wert('preise', {}) || {};
    return { themen, letzte, preise: { gerucht: Number(p.gerucht) || 0, beleg: Number(p.beleg) || 0 } };
  }
  const modell = () => modellAus(store.info);
  function laden() {
    if (typeof fetch !== 'function') return;
    fetch('/content/welt/handel-info-werte.json').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.werte && typeof j.werte === 'object') store.werte = j.werte; }).catch(() => { /* ohne Texte: leere Beschriftungen */ });
  }

  (function haken() {
    const N = root && root.Net;
    if (!N || typeof N.on !== 'function') return;
    N.on(lesen);
    laden();
  })();

  return { store, lesen, modellAus, modell, text, wert };
});
