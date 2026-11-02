'use strict';
// Geld (Marken) als benannte Regeln (CONCEPT-SL6/SL8/SL9). Der EINZIGE Schreibweg für game.inventory.marks (tools/test-buchungen.js erzwingt das);
// die Regiebuch-Bausteine (marks_at_least, credit_marks, pay_marks in server/mission/registry.js) und alle Händler-/Notruf-/Lösegeld-Pfade rufen diese Funktionen.
// Speicher: game.inventory.marks (ganze Zahl, Weltstand speichert sie bereits).
// (Nicht zu verwechseln mit server/sim/marken.js: das sind die Hex-Marken der Sternkarte, SL1B.)
//
// Jede Änderung hat einen Grund (Schlüssel aus GRUENDE) und läuft durch genau EINE Kernfunktion (schreiben). Intention statt Flag:
//   mit Ereignis (sfx/missionEvent, das Regiebuch reagiert darauf):  gutschreiben, abbuchen, gutschreibenSkript
//   still (so wie die Stelle vor dem Umbau war, kein Ereignis):      einnehmen (Beute/Fund), erstatten, bezahlen (Händler), abziehenGeprueft, abziehenHoechstens
//   Stand ohne Wirtschaft (Anfang, Laden, Test, Debug):              standSetzen (Art 'stand', keine Buchung)
// Neue Ereignisse an einer bisher stillen Stelle ändern den Ereignisstrom (Missionsschritte!) und sind tabu.

// Gründe. Unbekanntes (Grund/Art) wird im Spiel gezählt ('buchung-grund'/'buchung-art', buchungspruefung.js) und läuft wie früher; im strengen Modus der Tests wirft es.
// Die Regiebuch-Gutschrift mit freiem Text nutzt 'skript' (der Text bleibt im Ereignis).
const GRUENDE = Object.freeze([
  'start', 'testmarken', 'debug', 'laden', 'kampagne', 'migration',   // Stand setzen
  'abschuss', 'bergung', 'entern', 'erkundung', 'belohnung', 'notruf', 'verkauf', 'ueberhang', 'skript',   // Einnahmen
  'kauf', 'info', 'werft', 'notfall', 'mission', 'forderung', 'geldziel', 'soeldner', 'loesegeld',   // Ausgaben
]);
const ARTEN = Object.freeze(['buchung', 'stand']);
const Pruefung = require('./buchungspruefung.js');
const pruefeGrund = (game, grund) => { if (!GRUENDE.includes(grund)) Pruefung.unbekannt(game, 'buchung-grund', 'geld: unbekannter Grund ' + grund); };

// Die Kernfunktion: jede Marken-Änderung läuft hier durch. art 'buchung' = Wirtschaft (Einnahme/Ausgabe), 'stand' = Stand gesetzt (Anfang, Laden, Test, Debug).
// neu ist schon so gerechnet, wie die Aufrufstelle es früher tat (Rundung/Clamping bleiben bit-gleich).
function schreiben(game, art, grund, neu) {
  if (!ARTEN.includes(art)) Pruefung.unbekannt(game, 'buchung-art', 'geld: unbekannte Art ' + art);
  pruefeGrund(game, grund);
  const vorher = game.inventory.marks;
  game.inventory.marks = neu;
  // TEL-01: hier protokollieren (art, grund, vorher, neu)
  return neu;
}

function stand(game) { return Math.max(0, Math.floor(Number(game.inventory && game.inventory.marks) || 0)); }

// Prüfung: mindestens n Marken
function mindestens(game, n) { return stand(game) >= Math.max(0, Number(n) || 0); }

// Gutschreiben (Verkauf, Notruf-Lohn). grund: Schlüssel aus GRUENDE. Sendet sfx 'discovery' + missionEvent 'marksCredited'.
// Gibt den neuen Stand zurück. n <= 0 bucht nichts.
function gutschreiben(game, n, grund) { return gutschreibenMitEreignis(game, n, grund, grund); }

// Gutschrift aus dem Regiebuch (credit_marks): der Text des Skripts bleibt als grund im Ereignis, in der Buchung steht 'skript'.
function gutschreibenSkript(game, n, text) { return gutschreibenMitEreignis(game, n, 'skript', text); }

function gutschreibenMitEreignis(game, n, grund, ereignisGrund) {
  const k = Math.max(0, Math.floor(Number(n) || 0));
  if (!k) { pruefeGrund(game, grund); return stand(game); }
  schreiben(game, 'buchung', grund, stand(game) + k);
  game.emit('sfx', { name: 'discovery', volume: 0.5 });
  game.missionEvent('marksCredited', { n: k, grund: ereignisGrund || null, marks: game.inventory.marks });
  return game.inventory.marks;
}

// Abbuchen, nur wenn genug da ist. Rückgabe true = gebucht, false = zu wenig (nichts gebucht). Sendet missionEvent 'marksPaid'.
function abbuchen(game, n, grund) {
  const k = Math.max(0, Math.floor(Number(n) || 0));
  if (stand(game) < k) { pruefeGrund(game, grund); return false; }
  schreiben(game, 'buchung', grund, stand(game) - k);
  if (k) game.missionEvent('marksPaid', { n: k, grund: grund || null, marks: game.inventory.marks });
  return true;
}

// ---- stille Varianten: exakt die Rechnung der Stellen vor dem Umbau, KEIN sfx/missionEvent (nie eins ergänzen) ----

// Beute, Fund, Bergung, Erstbesuch, Belohnung: Marken kommen dazu (ungerundet wie bisher). -> neuer Stand
function einnehmen(game, n, grund) { return schreiben(game, 'buchung', grund, game.inventory.marks + n); }

// Rückerstattung (Migration alter Spielstände, Torpedo-Überhang): wie einnehmen, aber fachlich eine Erstattung. -> neuer Stand
function erstatten(game, n, grund) { return schreiben(game, 'buchung', grund, game.inventory.marks + n); }

// Händlerzahlung (Shop, Handelsinfo): zahlt nur, wenn der Stand reicht (Vergleich ungerundet wie bisher). true = bezahlt, false = nichts gebucht.
function bezahlen(game, preis, grund) {
  if (game.inventory.marks < preis) { pruefeGrund(game, grund); return false; }
  schreiben(game, 'buchung', grund, game.inventory.marks - preis);
  return true;
}

// Abzug nach einer Prüfung des Aufrufers (Handelsinfo: der Wächter steht dort vor der Wirkung, die Marken werden danach bedingungslos abgezogen). -> neuer Stand
function abziehenGeprueft(game, n, grund) { return schreiben(game, 'buchung', grund, game.inventory.marks - n); }

// Abzug mit Untergrenze 0 (Notfallprotokoll, Regiebuch pay_marks). -> tatsächlich abgezogener Betrag
function abziehenHoechstens(game, n, grund) {
  const vorher = game.inventory.marks;
  schreiben(game, 'buchung', grund, Math.max(0, vorher - n));
  return vorher - game.inventory.marks;
}

// Stand setzen (Spielstart, Weltstand laden, Testmarken, Debug, Kampagnen-Einstieg): KEINE Buchung der Wirtschaft (Art 'stand'). n kommt fertig gerechnet vom Aufrufer.
function standSetzen(game, n, grund) { return schreiben(game, 'stand', grund, n); }

module.exports = { GRUENDE, stand, mindestens, gutschreiben, gutschreibenSkript, abbuchen, einnehmen, erstatten, bezahlen, abziehenGeprueft, abziehenHoechstens, standSetzen, strengPruefen: Pruefung.strengPruefen };
