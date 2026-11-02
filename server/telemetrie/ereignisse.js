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

const num = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const text = (v, n) => (v == null ? null : String(v).slice(0, n || 60));
const slot = (v) => (typeof v === 'string' && /^p[1-4]$/.test(v) ? v : null);   // nur Slot-Kennungen, sonst nichts

// Bus game.emit(kind, data)
const EMIT = {
  missionStart: { typ: 'mission_start', felder: (d) => ({ mission: text(d.id) }) },   // title weggelassen: Anzeigetext, kein Schlüssel
  missionDone: { typ: 'mission_ende', felder: (d) => ({ mission: text(d.id), ausgang: text(d.ausgang) }) },
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
