'use strict';
// Vorrat: Verbrauchsgüter im Schiffslager (game.inventory.*). Der EINZIGE Schreibweg dafür (tools/test-buchungen.js erzwingt das); Marken laufen über geld.js.
//   Verbrauchsgüter: bolzen (= Torpedos), sonde, medipack, loeschgel, loeschgelCharges, ersatzteil, flickblech.
//   Über denselben Weg laufen die Zähler-Gegenstände im Inventar (tafel, ladung): das Regiebuch und die Debugbefehle kennen den Schlüssel nur als Text.
//   Nicht hier: deko (Liste), Fracht (server/sim/ladung.js), p.medkit / p.carryCharges (Gegenstand am Spieler, kein Lager).
//
// Jede Änderung hat einen Grund (Schlüssel aus GRUENDE) und läuft durch genau EINE Kernfunktion (schreiben). Intention statt Flag:
//   entnehmen (nur wenn genug da, -> bool) · abziehenHoechstens (bis 0, -> abgezogen) · leeren (alles, -> Menge) · einlagern (dazu)
//   standSetzen (Art 'stand': Laden, Debug – keine Buchung der Wirtschaft)
// Rechnung je Funktion exakt wie die Aufrufstellen vor dem Umbau (Spielverhalten bit-gleich).

const GUETER = Object.freeze(['bolzen', 'sonde', 'medipack', 'loeschgel', 'loeschgelCharges', 'ersatzteil', 'flickblech']);

// Gründe (Programmierfehler bei Unbekanntem: wirft)
const GRUENDE = Object.freeze([
  'laden', 'debug', 'migration',   // Stand setzen / Korrektur
  'kauf', 'bergung', 'fund', 'belohnung',   // Zugang
  'torpedo', 'sonde', 'nachschub', 'posten', 'mission',   // Verbrauch
  'regal', 'bot', 'medkit',   // Entnahme und Rückgabe am Regal, Bot-Reparatur, Medipack am Mann
]);
const ARTEN = Object.freeze(['buchung', 'stand']);

function pruefeGrund(grund) { if (!GRUENDE.includes(grund)) throw new Error('vorrat: unbekannter Grund ' + grund); }
function pruefeGut(gut) {
  if (typeof gut !== 'string' || !gut || gut === 'marks' || gut === 'deko') throw new Error('vorrat: kein Vorratsschlüssel ' + gut + ' (Marken: geld.js, Deko: Liste)');
}

// Die Kernfunktion: jede Vorrats-Änderung läuft hier durch. art 'buchung' = Zu-/Abgang, 'stand' = Stand gesetzt (Laden, Debug).
// neu ist schon so gerechnet, wie die Aufrufstelle es früher tat.
function schreiben(game, gut, art, grund, neu) {
  pruefeGut(gut);
  if (!ARTEN.includes(art)) throw new Error('vorrat: unbekannte Art ' + art);
  pruefeGrund(grund);
  const vorher = game.inventory[gut];
  game.inventory[gut] = neu;
  // TEL-01: hier protokollieren (gut, art, grund, vorher, neu)
  return neu;
}

// Bestand (roh, wie `inventory[gut] || 0`)
function stand(game, gut) { return game.inventory[gut] || 0; }

// Entnehmen, nur wenn genug da ist. true = entnommen, false = zu wenig (nichts gebucht).
function entnehmen(game, gut, n, grund) {
  pruefeGut(gut); pruefeGrund(grund);
  const have = stand(game, gut);
  if (!(have >= n)) return false;
  schreiben(game, gut, 'buchung', grund, have - n);
  return true;
}

// Abziehen bis höchstens 0 (Posten-Kosten, Regiebuch remove_item). -> tatsächlich abgezogene Menge
function abziehenHoechstens(game, gut, n, grund) {
  pruefeGut(gut); pruefeGrund(grund);
  const have = Number(stand(game, gut));
  schreiben(game, gut, 'buchung', grund, Math.max(0, have - n));
  return have - game.inventory[gut];
}

// Den ganzen Bestand entnehmen (Löschgel-Restladung am Regal). -> entnommene Menge
function leeren(game, gut, grund) {
  pruefeGut(gut); pruefeGrund(grund);
  const had = stand(game, gut);
  schreiben(game, gut, 'buchung', grund, 0);
  return had;
}

// Einlagern (Kauf, Bergung, Rückgabe am Regal, Belohnung). -> neuer Bestand
function einlagern(game, gut, n, grund) {
  pruefeGut(gut); pruefeGrund(grund);
  return schreiben(game, gut, 'buchung', grund, stand(game, gut) + n);
}

// Bestand setzen (Weltstand laden, Debug): KEINE Buchung der Wirtschaft (Art 'stand'). n kommt fertig gerechnet vom Aufrufer.
function standSetzen(game, gut, n, grund) { return schreiben(game, gut, 'stand', grund, n); }

module.exports = { GUETER, GRUENDE, stand, entnehmen, abziehenHoechstens, leeren, einlagern, standSetzen };
