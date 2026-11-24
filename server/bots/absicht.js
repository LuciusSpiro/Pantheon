'use strict';
// BOT-01 B3: Absichtszustand je Bot (Server-Zustand, nie im Spielerobjekt und nie im Snapshot). In B3 nur die Struktur und das Standardverhalten; Paket C haengt hier die Befehle des Menschen ein
// (bot.befehl: Ziel, Kurs, Halten ...), die Registry steht in server/bots/befehle/.
//   neueAbsicht(rolle)   leere Absicht: Standardverhalten der Rolle, Zustand 'unterwegs'
//   befehlSetzen(absicht, befehl)   BOT-01 C2a: ein Befehl des Captains gilt (befehl = { name, args, seit, szene, ... }), standard = false
//   befehlEnde(absicht)             der Befehl ist erledigt, abgebrochen oder verworfen: zurueck zum Standardverhalten (standard = true); die Ausfuehrung liegt im Agenten (mannschaft.js)
// Zustaende des Bots (zustand):
//   unterwegs   der Bot geht zu seiner Station (oder wartet, bis er sie betreten darf)
//   an_station  der Bot haelt seine Station und tut die Dienstpflicht der Rolle
//   wartet      ein Mensch haelt die Station des Bots: der Bot sendet fuer sie nichts, bis der Mensch geht (Mensch gewinnt, bots/weichen.js)
const ZUSTAENDE = ['unterwegs', 'an_station', 'wartet'];

function neueAbsicht(rolle) {
  return { rolle, zustand: 'unterwegs', standard: true, befehl: null, seit: null };
}

function befehlSetzen(absicht, befehl) { absicht.befehl = befehl; absicht.standard = false; return absicht; }
function befehlEnde(absicht) { absicht.befehl = null; absicht.standard = true; return absicht; }

module.exports = { ZUSTAENDE, neueAbsicht, befehlSetzen, befehlEnde };
