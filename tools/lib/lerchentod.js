'use strict';
// HYG-02 C: Erkennung „Lerche zerstört“ für die Bot-Läufe (tools/sim-headless.js, Modus kette).
// Nach dem Reaktor-Countdown (server/sim/reaktortod.js tod) setzt der Server game.zerstoertOffen und verwirft alle Befehle außer
// menu/ping/leave/debug, bis alle verbundenen Spieler OK gedrückt haben (zerstoertPruefen). Der Bot drückt nie OK; für Spieler ist das kein Softlock (Todesbildschirm mit OK).
// Reine Funktion, nur lesend, ohne Spielcode-Änderung: Server-Latch zerstoertOffen oder Snapshot ship.reaktorTod.tot.
function lerchenTod(game, snap) {
  if (game && game.zerstoertOffen) return true;
  const rt = snap && snap.ship && snap.ship.reaktorTod;
  return !!(rt && rt.tot);
}

// Abbruchtext des Laufs (Spielzeit des Todes in Sekunden, eine Nachkommastelle)
function lerchenTodGrund(zeit) {
  return `Lerche zerstört (Reaktor-Countdown) bei t=${(Math.round(zeit * 10) / 10).toFixed(1)} s`;
}

module.exports = { lerchenTod, lerchenTodGrund };
