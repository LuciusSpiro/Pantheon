// OPS-01 A: Ausrichtung der Raumkarten – EINE Stelle für „Schiff oben“ (Standard: der Bug zeigt immer nach oben, links bleibt links, wie am Steuer)
// und „Norden oben“ (wie bisher). Gilt je Karte ('weapons' = Taktikkarte der Ops, 'lage' = Lagekarte des Captains) und je Spieler (Clientzustand,
// bleibt im Browser; der Server weiß nichts davon). Ops und Captain rufen diese Funktionen direkt auf, es gibt keinen Stationsparameter:
//   Kartenlogik.optionen(karte, view) -> { rot, nordmarke } für Render.drawTactical (rot in Bogenmaß, Norden oben = 0)
//   Kartenlogik.umschalten(karte) / .setze(karte, 'schiff'|'norden') / .ausrichtung(karte) / .name(karte)
// Konvention von rot (wie drawFrontView): Weltrichtung a erscheint auf dem Schirm als a + rot; Bug oben heißt a + rot = −90° bei a = Schiffskurs.
// Gezeichnet und angeklickt wird mit demselben rot (Render.drawSpace: toS/toW), deshalb trifft ein Klick in beiden Ausrichtungen dasselbe Objekt.
(function () {
  'use strict';

  const KARTEN = ['weapons', 'lage'];
  const NAMEN = { schiff: 'Schiff oben', norden: 'Norden oben' };
  const SPEICHER = 'pantheon.kartenausrichtung';
  const wahl = { weapons: 'schiff', lage: 'schiff' };

  // gemerkte Wahl lesen/schreiben: nur Anzeigevorliebe, localStorage kann fehlen oder werfen (privates Fenster) – dann gilt der Standard
  function laden() {
    try {
      const roh = window.localStorage && window.localStorage.getItem(SPEICHER);
      const v = roh ? JSON.parse(roh) : null;
      if (v && typeof v === 'object') for (const k of KARTEN) if (NAMEN[v[k]]) wahl[k] = v[k];
    } catch (e) { /* Standard */ }
  }
  function speichern() {
    try { if (window.localStorage) window.localStorage.setItem(SPEICHER, JSON.stringify(wahl)); } catch (e) { /* nur Komfort */ }
  }
  laden();

  const bekannt = (karte) => KARTEN.indexOf(karte) >= 0;
  function ausrichtung(karte) { return bekannt(karte) ? wahl[karte] : 'norden'; }
  function setze(karte, wert) {
    if (!bekannt(karte) || !NAMEN[wert]) return false;
    wahl[karte] = wert; speichern();
    return true;
  }
  function umschalten(karte) {
    if (!bekannt(karte)) return null;
    setze(karte, wahl[karte] === 'schiff' ? 'norden' : 'schiff');
    return wahl[karte];
  }
  function name(karte) { return NAMEN[ausrichtung(karte)]; }

  // Drehung der Karte: gleiches Schiff wie in Render.drawSpace (view.ship = vorhergesagtes Schiff, sonst Snapshot)
  function rot(karte, view) {
    if (ausrichtung(karte) !== 'schiff') return 0;
    const ship = (view && (view.ship || (view.state && view.state.ship))) || {};
    return -(+ship.angle || 0) - Math.PI / 2;
  }
  function optionen(karte, view) { return { rot: rot(karte, view), nordmarke: ausrichtung(karte) === 'schiff' }; }

  window.Kartenlogik = { KARTEN, ausrichtung, setze, umschalten, name, rot, optionen };
})();
