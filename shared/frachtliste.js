// Frachtraum-Liste (Action-Layer der Anzeige): macht aus dem Snapshot-Feld `fracht` (lager = Waren-Arten, pers = Personen an Bord) die eine, überall
// gleiche Aufstellung "FRACHTRAUM 2/2: Deuterium, Evert Kroeger". Ops, Captain und Transfer-Terminal lesen dieselbe Funktion (kein eigenes Formatieren).
// UMD: window.Shared_Frachtliste / require. Reine Darstellung, keine Spielregel (Kapazität kommt aus Maps.CARGO_CAPACITY).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared_Frachtliste = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const ARTEN = { sprengstoff: 'Sprengstoff', deuterium: 'Deuterium', fracht: 'Fracht' };
  const artName = (a) => ARTEN[a] || String(a);

  // fracht = snapshot.fracht (kann fehlen), cap = Anzahl Frachtplätze.
  // -> { belegt, cap, frei, eintraege: [{ art: 'deuterium'|'sprengstoff'|'fracht'|'person', name, text }], titel, text }
  function frachtListe(fracht, cap) {
    const fr = fracht || {};
    const eintraege = [];
    for (const a of (fr.lager || [])) eintraege.push({ art: a, name: artName(a), text: artName(a) });
    for (const p of (fr.pers || [])) eintraege.push({ art: 'person', name: String(p.n || p.id || 'Person'), text: String(p.n || p.id || 'Person') });
    const c = Math.max(0, cap | 0);
    const belegt = eintraege.length;
    const frei = Math.max(0, c - belegt);
    const titel = 'FRACHTRAUM ' + belegt + '/' + c;
    const text = titel + ': ' + (belegt ? eintraege.map((e) => e.text).join(', ') : 'leer') + (belegt && frei ? ' · ' + frei + ' frei' : '');
    return { belegt, cap: c, frei, eintraege, titel, text };
  }

  return { frachtListe, artName };
});
