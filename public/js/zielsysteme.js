// SUND-04a-1 A: Zielsysteme der Ops in der Anzeige (gezielter Systemtreffer, V1: Antrieb). Globales `Zielsysteme`, in Node als Modul (Tests).
// Storage: store.werte = content/kampf/zielsysteme-werte.json (vom Server ausgeliefert, nur diese Datei): Systeme, Klassen, Stufen, Namen. Ohne die Datei gibt es keine
//   Anzeige und keinen Knopf (müll-fest). Der Zustand kommt aus dem Snapshot: enemies[].az (Stufe des Antriebs am GESCANNTEN Ziel, fehlt = voll), ship.zs (gewähltes Systemziel).
// Action: der Knopf „Systemziel“ der Ops sendet weapons.systemziel { id | null }; der Server entscheidet (gescannt, Klasse, Szene).
// Anzeige: Funktionsfarben der Pulte (Bernstein = Antrieb): `funktion` in den Daten, die Konsole übersetzt sie in ihre Farbe.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Zielsysteme = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const store = { werte: null };
  const W = () => (store.werte && typeof store.werte === 'object' ? store.werte : {});
  const systeme = () => { const s = W().systeme; return s && s.wert && typeof s.wert === 'object' ? s.wert : {}; };
  const ids = () => Object.keys(systeme());
  const info = (id) => systeme()[id] || null;
  // Systeme, die das Ziel (Klasse kind) hat und die die Ops anvisieren können (nur gescannte Ziele)
  function systemeFuer(target) {
    if (!target || !target.scanned || target.station || target.hidden || !target.kind) return [];
    return ids().filter((id) => (systeme()[id].klassen || []).indexOf(target.kind) >= 0);
  }
  // Stufe (0 voll …) eines Systems am gescannten Ziel; das Snapshot-Feld steht in den Daten (feld, Antrieb: az)
  function stufe(target, id) {
    const s = info(id);
    if (!s || !target || !target.scanned || !s.feld) return 0;
    const v = Number(target[s.feld]);
    return Number.isFinite(v) && v > 0 ? Math.min(v, (s.stufen || []).length - 1) : 0;
  }
  // { id, name, kurz, funktion, stufe, text (voll|beschädigt|ausgefallen), faktor, schaden: bool }
  function zustand(target, id) {
    const s = info(id);
    if (!s) return null;
    const st = stufe(target, id);
    const d = (s.stufen || [])[st] || {};
    return { id, name: String(s.name || id), kurz: String(s.kurz || s.name || id), funktion: String(s.funktion || ''), stufe: st, text: String(d.name || ''), faktor: d.faktor != null ? Number(d.faktor) : 1, schaden: st > 0 };
  }
  const gewaehlt = (state) => { const z = state && state.ship && state.ship.zs; return typeof z === 'string' && info(z) ? z : null; };
  // Zeilen des Ziel-Scans: je anvisierbares System { name, text, funktion, schaden, gewaehlt }
  function zeilen(state, target) {
    const g = gewaehlt(state);
    return systemeFuer(target).map((id) => Object.assign(zustand(target, id), { gewaehlt: g === id }));
  }
  function laden() {
    if (typeof fetch !== 'function') return;
    fetch('/content/kampf/zielsysteme-werte.json').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.werte && typeof j.werte === 'object') store.werte = j.werte; }).catch(() => { /* ohne Daten: keine Anzeige */ });
  }
  if (root && typeof root.document !== 'undefined') laden();
  return { store, ids, info, systemeFuer, stufe, zustand, gewaehlt, zeilen, laden };
});
