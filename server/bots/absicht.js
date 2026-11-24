'use strict';
// BOT-01 B3: Absichtszustand je Bot (Server-Zustand, nie im Spielerobjekt und nie im Snapshot). Paket C haengt hier die Befehle des Menschen ein (bot.befehl), die Registry steht in server/bots/befehle/.
//   neueAbsicht(rolle)   leere Absicht: Standardverhalten der Rolle, Zustand 'unterwegs'
//   befehlSetzen(absicht, befehl)   BOT-01 C2a: ein Befehl des Captains gilt (befehl = { name, args, seit, szene, ... }), standard = false
//   befehlEnde(absicht)             der Befehl ist erledigt, abgebrochen oder verworfen: zurueck zum Standardverhalten (standard = true, wenn auch sonst nichts gehalten wird); die Ausfuehrung liegt im Agenten (mannschaft.js)
//   feuerSetzen(absicht, feuer, waffen)  BOT-01 C2b (ops): Feuerzustand 'frei' | 'halt' und die Waffengruppe (null = alle) halten
//   haltenSetzen(absicht, name, wert)    BOT-01 C2b (technik): eine Einstellung halten (prio, schild); haltenEnde nimmt eine (oder alle) zurueck
//   alleEnde(absicht)                    BOT-01 C2b: alles Gehaltene verwerfen (bot.automatik, Mensch uebernimmt): Standardverhalten
// Zustaende des Bots (zustand):
//   unterwegs   der Bot geht zu seiner Station (oder wartet, bis er sie betreten darf)
//   an_station  der Bot haelt seine Station und tut die Dienstpflicht der Rolle
//   wartet      ein Mensch haelt die Station des Bots: der Bot sendet fuer sie nichts, bis der Mensch geht (Mensch gewinnt, bots/weichen.js)
const ZUSTAENDE = ['unterwegs', 'an_station', 'wartet'];

function neueAbsicht(rolle) {
  return { rolle, zustand: 'unterwegs', standard: true, befehl: null, seit: null, feuer: null, waffen: null, halten: {} };
}

// standard = nichts Gehaltenes mehr: kein Befehl, kein Feuerzustand, keine Technik-Einstellung
const standardNeu = (a) => { a.standard = !a.befehl && !a.feuer && Object.keys(a.halten).length === 0; return a; };

function befehlSetzen(absicht, befehl) { absicht.befehl = befehl; absicht.standard = false; return absicht; }
function befehlEnde(absicht) { absicht.befehl = null; return standardNeu(absicht); }
function feuerSetzen(absicht, feuer, waffen) { absicht.feuer = feuer; absicht.waffen = waffen || null; return standardNeu(absicht); }
function haltenSetzen(absicht, name, wert) { absicht.halten[name] = wert; absicht.standard = false; return absicht; }
function haltenEnde(absicht, name) { if (name === undefined) absicht.halten = {}; else delete absicht.halten[name]; return standardNeu(absicht); }
function alleEnde(absicht) { absicht.befehl = null; absicht.feuer = null; absicht.waffen = null; absicht.halten = {}; return standardNeu(absicht); }

module.exports = { ZUSTAENDE, neueAbsicht, befehlSetzen, befehlEnde, feuerSetzen, haltenSetzen, haltenEnde, alleEnde };
