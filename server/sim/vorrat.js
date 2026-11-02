'use strict';
// Vorrat: Verbrauchsgüter im Schiffslager (game.inventory.*). Der EINZIGE Schreibweg dafür (tools/test-buchungen.js erzwingt das); Marken laufen über geld.js.
//   Verbrauchsgüter: bolzen (= Torpedos), sonde, medipack, loeschgel, loeschgelCharges, ersatzteil, flickblech.
//   Zähler-Gegenstände im Inventar: tafel, ladung (Sprengstoff; NICHT das Frachtmodul server/sim/ladung.js).
//   Nicht hier: deko (Liste), Fracht (server/sim/ladung.js), p.medkit / p.carryCharges (Gegenstand am Spieler, kein Lager).
//
// Jede Änderung hat einen Grund (Schlüssel aus GRUENDE) und läuft durch genau EINE Kernfunktion (schreiben). Intention statt Flag:
//   entnehmen (nur wenn genug da, -> bool) · verbrauchen (nach dem Wächter des Aufrufers, unbedingt) · verbrauchenGanzzahlig (Sonden)
//   abziehenHoechstens (bis 0, -> abgezogen) · leeren (alles, -> Menge) · kappen (auf eine Obergrenze, -> weggenommen)
//   einlagern (dazu) · einlagernBis (dazu, höchstens Grenze) · standSetzen (Art 'stand': Anfang, Laden, Debug – keine Buchung der Wirtschaft)
// Rechnung je Funktion exakt wie die Aufrufstellen vor dem Umbau (Spielverhalten bit-gleich, auch bei Bruchteil-Beständen).
//
// Unbekanntes (Gut außerhalb GUETER, Grund, Art) wird im Spiel gezählt ('buchung-gut'/'buchung-grund'/'buchung-art') und gebucht wie vor dem Umbau;
// nur im strengen Modus der Tests wirft es (buchungspruefung.js). Das Gut 'marks' geht an geld.js (Ergebnis wie früher: die Marken ändern sich).
const Geld = require('./geld.js');
const Pruefung = require('./buchungspruefung.js');
const Haken = require('../telemetrie/haken.js');

const GUETER = Object.freeze(['bolzen', 'sonde', 'medipack', 'loeschgel', 'loeschgelCharges', 'ersatzteil', 'flickblech', 'tafel', 'ladung']);

const GRUENDE = Object.freeze([
  'start', 'laden', 'debug', 'migration',   // Stand setzen / Korrektur
  'kauf', 'bergung', 'fund', 'belohnung',   // Zugang
  'torpedo', 'sonde', 'nachschub', 'posten', 'mission', 'sprengung',   // Verbrauch
  'regal', 'bot', 'medkit',   // Entnahme und Rückgabe am Regal, Bot-Reparatur, Medipack am Mann
]);
const ARTEN = Object.freeze(['buchung', 'stand']);

const istMarken = (gut) => gut === 'marks';
function pruefeGrund(game, grund) { if (!GRUENDE.includes(grund)) Pruefung.unbekannt(game, 'buchung-grund', 'vorrat: unbekannter Grund ' + grund); }
// 'marks' ist kein Vorratsgut: es wird gezählt wie jedes Unbekannte. Die Funktionen, auf denen ein freier Schlüssel aus Regiebuch/Debug/Belohnung ankommt
// (entnehmen, verbrauchen, abziehenHoechstens, einlagern, standSetzen), leiten 'marks' danach an geld.js weiter (Ergebnis wie früher: die Marken ändern sich).
function pruefe(game, gut, grund) {
  if (!GUETER.includes(gut)) Pruefung.unbekannt(game, 'buchung-gut', 'vorrat: kein Vorratsgut ' + String(gut) + (istMarken(gut) ? ' (Marken: geld.js)' : ''));
  pruefeGrund(game, grund);
}

// Die Kernfunktion: jede Vorrats-Änderung läuft hier durch. art 'buchung' = Zu-/Abgang, 'stand' = Stand gesetzt (Anfang, Laden, Debug).
// neu ist schon so gerechnet, wie die Aufrufstelle es früher tat. (Gut 'marks' kommt nie hierher, es geht über geld.js.)
function schreiben(game, gut, art, grund, neu) {
  if (!ARTEN.includes(art)) Pruefung.unbekannt(game, 'buchung-art', 'vorrat: unbekannte Art ' + art);
  const vorher = game.inventory[gut];
  game.inventory[gut] = neu;
  Haken.buchung(game, gut, art, grund, neu - (Number(vorher) || 0), neu);   // TEL-01: hier protokollieren (B2: liest nur; ohne Session ein Zugriff)
  return neu;
}

// Bestand (roh, wie `inventory[gut] || 0`)
function stand(game, gut) { return game.inventory[gut] || 0; }

// Entnehmen, nur wenn genug da ist. true = entnommen, false = zu wenig (nichts gebucht).
function entnehmen(game, gut, n, grund) {
  pruefe(game, gut, grund);
  const have = stand(game, gut);
  if (!(have >= n)) return false;
  if (istMarken(gut)) Geld.abziehenHoechstens(game, n, grund); else schreiben(game, gut, 'buchung', grund, have - n);
  return true;
}

// Verbrauchen NACH dem Wächter des Aufrufers (z. B. `> 0`, `<= 0 -> return`): zieht unbedingt ab, auch bei Bruchteil-Beständen (0,5 -> -0,5), wie die alten `inventory.x--`.
function verbrauchen(game, gut, n, grund) {
  pruefe(game, gut, grund);
  if (istMarken(gut)) return Geld.abziehenGeprueft(game, n, grund);
  return schreiben(game, gut, 'buchung', grund, game.inventory[gut] - n);
}

// Verbrauchen auf ganzen Einheiten (Sonden): der Bestand zählt als floor(max(0, Bestand)), davon wird n abgezogen (wie der alte `vorrat(game) - 1`).
function verbrauchenGanzzahlig(game, gut, n, grund) {
  pruefe(game, gut, grund);
  const ganz = Math.max(0, Math.floor(Number(game.inventory && game.inventory[gut]) || 0));
  return schreiben(game, gut, 'buchung', grund, ganz - n);
}

// Abziehen bis höchstens 0 (Posten-Kosten, Regiebuch remove_item). -> tatsächlich abgezogene Menge
function abziehenHoechstens(game, gut, n, grund) {
  pruefe(game, gut, grund);
  if (istMarken(gut)) return Geld.abziehenHoechstens(game, n, grund);
  const have = Number(stand(game, gut));
  schreiben(game, gut, 'buchung', grund, Math.max(0, have - n));
  return have - game.inventory[gut];
}

// Den ganzen Bestand entnehmen (Löschgel-Restladung am Regal). -> entnommene Menge
function leeren(game, gut, grund) {
  pruefe(game, gut, grund);
  const had = stand(game, gut);
  schreiben(game, gut, 'buchung', grund, 0);
  return had;
}

// Auf eine Obergrenze zurücknehmen (Weltstand-Migration: Torpedolager höchstens lagerMax). Der Aufrufer prüft, dass der Bestand darüber liegt. -> weggenommene Menge
function kappen(game, gut, max, grund) {
  pruefe(game, gut, grund);
  const had = game.inventory[gut];
  schreiben(game, gut, 'buchung', grund, max);
  return had - max;
}

// Einlagern (Kauf, Bergung, Rückgabe am Regal, Belohnung). -> neuer Bestand
function einlagern(game, gut, n, grund) {
  pruefe(game, gut, grund);
  if (istMarken(gut)) return Geld.einnehmen(game, n, grund);
  return schreiben(game, gut, 'buchung', grund, stand(game, gut) + n);
}

// Einlagern, höchstens bis `grenze`, nie unter 0 (Regiebuch ladung_geben). -> neuer Bestand
function einlagernBis(game, gut, n, grenze, grund) {
  pruefe(game, gut, grund);
  const neu = Math.max(0, Math.min(grenze, stand(game, gut) + n));
  return schreiben(game, gut, 'buchung', grund, neu);
}

// Bestand setzen (Anfang, Weltstand laden, Debug): KEINE Buchung der Wirtschaft (Art 'stand'). n kommt fertig gerechnet vom Aufrufer.
function standSetzen(game, gut, n, grund) {
  pruefe(game, gut, grund);
  if (istMarken(gut)) return Geld.standSetzen(game, n, grund);
  return schreiben(game, gut, 'stand', grund, n);
}

module.exports = { GUETER, GRUENDE, stand, entnehmen, verbrauchen, verbrauchenGanzzahlig, abziehenHoechstens, leeren, kappen, einlagern, einlagernBis, standSetzen, strengPruefen: Pruefung.strengPruefen };
