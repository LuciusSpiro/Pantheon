'use strict';
// TEL-01 A: Übersetzer der beiden Ereignisbusse (Game.emit und Game.missionEvent) in Protokollzeilen.
// Eine Tabelle je Bus: Name des Ereignisses -> { typ, felder(daten, ctx) }.
//   typ      Name der Protokollzeile (Schema-Name, snake_case)
//   felder   baut NUR flache Felder (Zahl, Text, Wahrheitswert, null, Liste davon) aus den Daten des Busses.
//            Positivliste: nichts wird "durchgereicht". Spieler als Slot (p.id), nie das Spielerobjekt, sein Name, seine Charakterkarte oder die clientId.
//            Rückgabe null = diese Instanz nicht protokollieren.
//   ctx      { game, dienst } (Lesen von Spielzustand, z. B. Zahlen; kein Schreiben ins Spiel, kein Zufall)
// Unbekannte Namen werden ignoriert. sfx, oda und notice gehören nicht hierher (kein Spielereignis).
//
// So hängt Paket B ein Ereignis ein (Beispiel: Welle kommt, Bus missionEvent):
//   MISSION.welleKommt = { typ: 'welle_kommt', felder: (d) => ({ nr: num(d.n), gegner: num(d.count) }) };

const { num, txt: text, slotVon: slot } = require('./hilfen.js');

// Bus game.emit(kind, data)
const EMIT = {
  // missionStart/missionDone: seit TEL-01 B1 szene_start/szene_ende mit Modus (telemetrie/gefecht.js, direkt in mission.js), nicht mehr hier
  // Partie beendet (Menü, Zerstörung, Server): merkt den Grund für session_ende. byName gehört NICHT ins Protokoll.
  sessionEnded: { typ: 'partie_beendet', felder: (d, ctx) => {
    const grund = d.grund ? text(d.grund) : (d.by ? 'spieler' : 'server');
    ctx.dienst.grundVormerken(grund);
    return { von: slot(d.by), gesichert: !!d.saved, grund };
  } },
};

// Bus game.missionEvent(name, data)  (Paket B füllt)
const MISSION = {};

module.exports = { EMIT, MISSION, num, text, slot };
