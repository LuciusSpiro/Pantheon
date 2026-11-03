'use strict';
// KUL-02 A: Hauptschirm-Ansicht. EIN Zustand für die ganze Brücke: 'klassisch' (Draufsicht) oder 'visier' (Blick vom Bug, KUL-03).
// Wer am Steuer sitzt, schaltet um; alle Clients lesen dieselbe Ansicht aus dem Snapshot (ship.hs, nur bei 'visier', klassisch = Feld fehlt).
//   - Zustand am game-Objekt (game.hauptschirmAnsicht), NICHT an ship.scene: überlebt Sprung und Sektorwechsel. Flüchtig, nicht im Weltstand.
//   - Setzen nur über ansichtSetzen (Rechteprüfung hier, zusätzlich zur Stationsprüfung des Präfixes helm. in game.onCmd).
// Befehl: helm.hauptschirm { ansicht } (game.js). Snapshot: ship.hs.
const Station = require('./station.js');
const Protocol = require('../../shared/protocol.js');

const ANSICHTEN = Protocol.HAUPTSCHIRM_ANSICHTEN;
const STANDARD = 'klassisch';

function ansichtVon(game) { return game.hauptschirmAnsicht || STANDARD; }

// Rückgabe: Fehlertext oder null.
function ansichtSetzen(game, p, ansicht) {
  if (!ANSICHTEN.includes(ansicht)) return 'Unbekannte Ansicht.';
  if (Station.stationOf(p) !== 'helm') return 'Nur der Steuer schaltet den Hauptschirm um.';
  // Hook Spielprotokoll (TEL-01, später): hier festhalten, wer wann welche Ansicht gewählt hat (p, ansicht, game.time); noch nicht gebaut.
  game.hauptschirmAnsicht = ansicht;
  return null;
}

// Neue Partie (Lobby, Neustart, Laden, Moduswechsel): zurück auf klassisch. Sprung/Sektorwechsel ruft das NICHT auf.
function zuruecksetzen(game) { game.hauptschirmAnsicht = STANDARD; }

// Snapshot-Zeile ship.hs: nur 'visier' wird übertragen; klassisch = Feld fehlt (spart Snapshot-Budget).
function snapshot(game) { return ansichtVon(game) === 'klassisch' ? null : ansichtVon(game); }

module.exports = { ANSICHTEN, ansichtSetzen, ansichtVon, snapshot, zuruecksetzen };
