// OPS-01 A: Ausrichtung der Raumkarten – EINE Stelle für „Schiff oben“ (Standard: der Bug zeigt immer nach oben, links bleibt links, wie am Steuer)
// und „Norden oben“ (wie bisher). Gilt je Karte ('weapons' = Taktikkarte der Ops, 'lage' = Lagekarte des Captains) und je Spieler (Clientzustand,
// bleibt im Browser; der Server weiß nichts davon). Ops und Captain rufen diese Funktionen direkt auf, es gibt keinen Stationsparameter:
//   Kartenlogik.optionen(karte, view) -> { rot, nordmarke } für Render.drawTactical (rot in Bogenmaß, Norden oben = 0)
//   Kartenlogik.zoomStufen(rect) / .zoomStandard(rect) / .zoomMin(rect) / .zoomIndex(stufen, zoom): Zoomgrenzen aus R.FRONT und der Kartenfläche (OPS-01 B, unten)
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

  // OPS-01 B: Sichtweite. Ops und Captain sehen dasselbe Gefecht gleich gut: der Standardausschnitt der Ops-Karte kommt aus der Frontsicht des Steuers (R.FRONT.fwd, .side),
  // nicht aus einer zweiten Zahl. Vorn UND hinten mindestens FRONT.fwd (Schiff in der Mitte, Bug oben), seitlich mindestens FRONT.side und die Seitenhälfte des Voxel-Hauptschirms
  // (sitz.js zeichneSchirm: SW 512 × SH 288, Zoom = SH / (fwd + back), Seitenhälfte = (SW / 2) / Zoom). Kleinster Zoom: Sensorreichweite (Render.sensorRange) in alle Richtungen.
  const VOXEL_SCHIRM = { w: 512, h: 288 };   // = SW, SH in sitz.js (der Test prüft es dort nach)
  const WAHL_STUFEN = [0.25, 0.35, 0.5, 0.75];   // die bisherigen festen Stufen, soweit sie zum Ausschnitt passen
  const R_ = () => window.Render;
  function voxelSeite() { const F = R_().FRONT; return (VOXEL_SCHIRM.w / 2) / (VOXEL_SCHIRM.h / (F.fwd + F.back)); }
  function zoomStandard(rect) {
    const F = R_().FRONT;
    return Math.min(rect.h / (2 * F.fwd), rect.w / (2 * Math.max(F.side, voxelSeite())));
  }
  function zoomMin(rect) {
    const r = R_().sensorRange({}) || 1400;
    return Math.min(rect.h, rect.w) / (2 * r);
  }
  // Stufenliste einer Kartenfläche: aufsteigend, ohne Duplikate und zu enge Nachbarn (Verhältnis < 1,15); kleinste Stufe und Standard bleiben immer drin
  function zoomStufen(rect) {
    const lo = zoomMin(rect), std = Math.max(lo, zoomStandard(rect));
    const fest = [lo, std];
    const frei = WAHL_STUFEN.filter((z) => z > lo && fest.every((a) => Math.max(a, z) / Math.min(a, z) >= 1.15));
    return fest.concat(frei).sort((a, b) => a - b);
  }
  // Index der Stufe, die zum Zoomwert passt (nächste im Verhältnis)
  function zoomIndex(stufen, zoom) {
    let b = 0;
    for (let i = 1; i < stufen.length; i++) if (Math.abs(Math.log(stufen[i] / zoom)) < Math.abs(Math.log(stufen[b] / zoom))) b = i;
    return b;
  }

  window.Kartenlogik = { zoomStufen, zoomStandard, zoomMin, zoomIndex, KARTEN, ausrichtung, setze, umschalten, name, rot, optionen };
})();
