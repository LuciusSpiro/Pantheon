'use strict';
// BOT-01 B3: Mensch gewinnt. Wer als Mensch eine Station verlangt, die ein Bot haelt, bekommt sie; der Bot gibt sie frei und wartet (Zustand 'wartet' im Agenten, bots/lauf.js).
// Menschen blockieren einander wie bisher: nur Bots weichen. Nur die Stationen, die Bots besetzen (helm, weapons, technik) und die Transfer-Konsole im Bord-Dienst (BOT-02 B1); captain und alle anderen Orte (spind ...) beruehrt das nie.
// BOT-02 B1: auch die Transfer-Konsole (Ort ohne Tab) gehoert dazu, wenn ein Bot sie im Bord-Dienst haelt (nur dann steht dort ein Bot); der Dienst ruht, bis der Mensch geht (mannschaft.js).
//   kannWeichen(game, kind, mensch)    nur lesen: wuerde der Bot (und nur Bots) an kind weichen? (Aktionsliste „Konsole besetzt“ in interior.js)
//   weichtFuerMensch(game, kind, mensch)  der Bot gibt die Station frei (game.platzFreigeben); true = die Station ist jetzt frei fuer den Menschen
//   bordBotHaelt(game)                 BOT-02 B4: ein Bord-Bot haelt den Dienst wirklich (lauf.js bordDienstHaelt); away.js: die ODA funkt die Codetabelle dann nicht, der Bot sagt sie an
//   vertreten(game, kind)              BOT-02 B1: ein Bord-Bot haelt den Dienst wirklich und die Station seiner Rolle ist kind (lauf.js stationVertreten); station.js zaehlt sie dann als vertreten (Automatik nach Kopfregel ODER vertreten)
// Aufrufer: Station.tab (Tab auf eine Bot-Station), interior.consoleOccupant (Aktionsliste) und interior.performInteraction (Konsole betreten).
// Wieder uebernehmen: der Agent prueft jeden Tick, ob ein Mensch seine Station haelt, und geht zurueck, sobald nicht (kein Aufruf noetig).
const Crew = require('../sim/crew.js');

const BOT_STATIONEN = ['helm', 'weapons', 'technik'];
const BOT_ORTE = BOT_STATIONEN.concat('transfer');   // Orte, an denen ein Bot einem Menschen weicht
// station.js laedt dieses Modul: Station und Lauf erst beim Aufruf (kein Zirkelbezug beim Laden)
const stationOf = (o) => require('../sim/station.js').stationOf(o);

// Halter einer Station wie interior.consoleOccupant: der Ort (Konsole) oder das aktive Interface (Tab)
function halterVon(game, kind, mensch) {
  return game.players.filter((o) => o !== mensch && o.connected && (o.console === kind || stationOf(o) === kind));
}

function kannWeichen(game, kind, mensch) {
  if (!mensch || Crew.istBot(mensch) || !BOT_ORTE.includes(kind)) return false;
  const halter = halterVon(game, kind, mensch);
  return halter.length > 0 && halter.every(Crew.istBot);
}

function weichtFuerMensch(game, kind, mensch) {
  if (!kannWeichen(game, kind, mensch)) return false;
  const Lauf = require('./lauf.js');
  for (const b of halterVon(game, kind, mensch)) { Lauf.prioritaetLoesen(game, b); game.platzFreigeben(b, 'mensch'); Lauf.wartet(game, b); }   // BOT-01 C2b: die Prioritaet des Bots ist weg, bevor der Mensch sie sieht
  return true;
}

// station.js (Automatik-Schwellen) fragt hier, ob der Bord-Dienst eines Bots die Station verwaist hat; Lauf erst beim Aufruf (Zirkelbezug), der Bot-Bezug bleibt in diesem Modul
function vertreten(game, kind) { return require('./lauf.js').stationVertreten(game, kind); }

// BOT-02 B4: haelt ein Bord-Bot den Dienst (Mensch unten, kein Mensch an der Transfer-Konsole)? away.js laesst dann die ODA die Codetabelle nicht funken, der Bot sagt sie an (ansagen.js)
function bordBotHaelt(game) { return require('./lauf.js').bordDienstHaelt(game); }

module.exports = { BOT_STATIONEN, BOT_ORTE, kannWeichen, weichtFuerMensch, vertreten, bordBotHaelt };
