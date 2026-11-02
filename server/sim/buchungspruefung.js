'use strict';
// TEL-01 G: gemeinsame Regel der Buchungsdienste (geld.js, vorrat.js) für Unbekanntes (Grund, Art, Gut).
// Im Spiel gilt: Strenge gehört in den Test, nicht ins laufende Spiel. Ein unbekannter Grund/Gut/Art wird GEZÄHLT (game.countError) und die Buchung läuft
// genau wie vor dem Umbau. Nur im strengen Modus wirft es – den schalten allein die Tests ein (Geld.strengPruefen() / Vorrat.strengPruefen() oder die
// Umgebungsvariable BUCHUNGEN_STRENG=1), nie ein Parameter des Aufrufers.
let streng = process.env.BUCHUNGEN_STRENG === '1';
function strengPruefen(an) { streng = an !== false; }
function istStreng() { return streng; }
// where: Zählschlüssel für game.countError ('buchung-grund', 'buchung-gut', 'buchung-art')
function unbekannt(game, where, text) {
  if (streng) throw new Error(text);
  if (game && typeof game.countError === 'function') game.countError(where, new Error(text));
}
module.exports = { strengPruefen, istStreng, unbekannt };
