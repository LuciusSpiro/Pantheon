'use strict';
// Geld (Marken) als benannte Regeln (CONCEPT-SL6/SL8/SL9). Eine Quelle für Gutschreiben, Abbuchen und Prüfen; die Regiebuch-Bausteine
// (marks_at_least, credit_marks, pay_marks in server/mission/registry.js) und alle Händler-/Notruf-/Lösegeld-Pfade rufen diese Funktionen.
// Speicher: game.inventory.marks (ganze Zahl, Weltstand speichert sie bereits).
// (Nicht zu verwechseln mit server/sim/marken.js: das sind die Hex-Marken der Sternkarte, SL1B.)

function stand(game) { return Math.max(0, Math.floor(Number(game.inventory && game.inventory.marks) || 0)); }

// Prüfung: mindestens n Marken
function mindestens(game, n) { return stand(game) >= Math.max(0, Number(n) || 0); }

// Gutschreiben (Verkauf, Notruf-Lohn, Belohnung aus dem Skript). grund: kurzer Schlüssel für Chronik/Test ('verkauf', 'notruf' …).
// Gibt den neuen Stand zurück. n <= 0 bucht nichts.
function gutschreiben(game, n, grund) {
  const k = Math.max(0, Math.floor(Number(n) || 0));
  if (!k) return stand(game);
  game.inventory.marks = stand(game) + k;
  game.emit('sfx', { name: 'discovery', volume: 0.5 });
  game.missionEvent('marksCredited', { n: k, grund: grund || null, marks: game.inventory.marks });
  return game.inventory.marks;
}

// Abbuchen, nur wenn genug da ist. Rückgabe true = gebucht, false = zu wenig (nichts gebucht).
function abbuchen(game, n, grund) {
  const k = Math.max(0, Math.floor(Number(n) || 0));
  if (stand(game) < k) return false;
  game.inventory.marks = stand(game) - k;
  if (k) game.missionEvent('marksPaid', { n: k, grund: grund || null, marks: game.inventory.marks });
  return true;
}

module.exports = { stand, mindestens, gutschreiben, abbuchen };
