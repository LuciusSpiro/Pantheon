'use strict';
// SL9 (CONCEPT-SL9): Geldposten der Kampagne „Die Schuld der Lerche“ aus CONFIG.campaign.sund (Zahlen stellt das Studio nach Spieleabend 3 nach).
//   forderung  Forderung der Piraten (Kapitel 5), geldziel  Marken beim Eintritt in Kapitel 8,
//   soeldner   Preis der Söldner aus Altrost (Kapitel 9B), loesegeld  Lösegeld mit Aufschlag bei der Übergabe (Kapitel 9A, +30 %)
//   betrag(game, posten)    -> Zahl (0 bei unbekanntem Posten)
//   reicht(game, posten)    -> bool, genug Marken für den Posten
//   zahlen(game, posten)    -> bool, gebucht (false: zu wenig, nichts gebucht); Ereignis marksPaid { grund: posten }
const Geld = require('./geld.js');
const POSTEN = ['forderung', 'geldziel', 'soeldner', 'loesegeld'];

function betrag(game, posten) {
  const s = (game.C && game.C.campaign && game.C.campaign.sund) || {};
  return POSTEN.includes(posten) ? Math.max(0, Math.floor(Number(s[posten]) || 0)) : 0;
}
function reicht(game, posten) { return Geld.mindestens(game, betrag(game, posten)); }
function zahlen(game, posten) { return Geld.abbuchen(game, betrag(game, posten), posten); }

module.exports = { POSTEN, betrag, reicht, zahlen };
