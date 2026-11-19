'use strict';
// BOT-01 B3: Mensch gewinnt. Wer als Mensch eine Station verlangt, die ein Bot haelt, bekommt sie; der Bot gibt sie frei und wartet (Zustand 'wartet' im Agenten, bots/lauf.js).
// Menschen blockieren einander wie bisher: nur Bots weichen. Nur die Stationen, die Bots besetzen (helm, weapons, technik); captain und alle Orte (transfer, spind ...) beruehrt das nie.
//   kannWeichen(game, kind, mensch)    nur lesen: wuerde der Bot (und nur Bots) an kind weichen? (Aktionsliste „Konsole besetzt“ in interior.js)
//   weichtFuerMensch(game, kind, mensch)  der Bot gibt die Station frei (game.platzFreigeben); true = die Station ist jetzt frei fuer den Menschen
// Aufrufer: Station.tab (Tab auf eine Bot-Station), interior.consoleOccupant (Aktionsliste) und interior.performInteraction (Konsole betreten).
// Wieder uebernehmen: der Agent prueft jeden Tick, ob ein Mensch seine Station haelt, und geht zurueck, sobald nicht (kein Aufruf noetig).
const Crew = require('../sim/crew.js');

const BOT_STATIONEN = ['helm', 'weapons', 'technik'];
// station.js laedt dieses Modul: Station und Lauf erst beim Aufruf (kein Zirkelbezug beim Laden)
const stationOf = (o) => require('../sim/station.js').stationOf(o);

// Halter einer Station wie interior.consoleOccupant: der Ort (Konsole) oder das aktive Interface (Tab)
function halterVon(game, kind, mensch) {
  return game.players.filter((o) => o !== mensch && o.connected && (o.console === kind || stationOf(o) === kind));
}

function kannWeichen(game, kind, mensch) {
  if (!mensch || Crew.istBot(mensch) || !BOT_STATIONEN.includes(kind)) return false;
  const halter = halterVon(game, kind, mensch);
  return halter.length > 0 && halter.every(Crew.istBot);
}

function weichtFuerMensch(game, kind, mensch) {
  if (!kannWeichen(game, kind, mensch)) return false;
  const Lauf = require('./lauf.js');
  for (const b of halterVon(game, kind, mensch)) { game.platzFreigeben(b, 'mensch'); Lauf.wartet(game, b); }
  return true;
}

module.exports = { BOT_STATIONEN, kannWeichen, weichtFuerMensch };
