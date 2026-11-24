'use strict';
// BOT-01 B3 / BOT-02 B2: Registry der Bot-Befehle fuer den Bord-Dienst (Katalog v1: bord.rueckholen, bord.sensor, bord.kuppel). Jede Funktion: (game, bot, args) => { ok: true | false, code?, text? }
// Gilt wie in den anderen Registries: nur lesen, nie Spielzustand schreiben (Quellscan tools/test-bot-befehle-nav.js). Die Registry prueft die Voraussetzungen (Lage: server/bots/bordlage.js) und setzt nur die Absicht
// des Agenten (agent.bordBefehlSetzen); gesendet wird im Agenten (mannschaft.js bordDienst) als cmd durch den Wachposten (transfer.recall, captain.support, nur im Bord-Dienst).
// Codes (content/bots/gruende.json): kein_ziel (niemand unten), nicht_jetzt (der Dienst laeuft nicht, ein Mensch haelt Transfer bzw. Captain-Konsole, Abklingzeit, Transfer ausgefallen, die Rueckholung geht vor).
//   bord.rueckholen   holt EINEN Menschen zurueck (siehe Lage.rueckholZiel): game.support.recall (60 s) und das Durchbrennen des Transfers erlauben ohnehin nur einen Aufruf; bleiben weitere Menschen verwundet unten, holt sie die Notrueckholung des Spiels (combat.js squadRecall)
//   bord.sensor, bord.kuppel   der Bot laeuft zur Captain-Konsole (captain.support gilt serverseitig nur dort), sendet und kehrt zum Transfer zurueck
const Lauf = require('../lauf.js');
const Lage = require('../bordlage.js');

const NICHT_JETZT = { ok: false, code: 'nicht_jetzt' };
const KEIN_ZIEL = { ok: false, code: 'kein_ziel' };
const OK = { ok: true };

// gemeinsame Vorpruefung: der Dienst laeuft und niemand ist unten -> kein_ziel; sonst der Agent
function vorab(game, bot, art) {
  const agent = Lauf.agent(game, bot);
  if (!agent) return { fehler: NICHT_JETZT };
  if (art === 'rueckholen' ? !Lage.untenMenschen(game).length : !Lage.anyAway(game)) return { fehler: KEIN_ZIEL };
  if (!Lauf.dienstLaeuft(game, bot)) return { fehler: NICHT_JETZT };   // Mensch an Bord (kein Dienst) oder ein Mensch haelt den Transfer (der gewinnt)
  return { agent };
}

const bord = {};

bord['bord.rueckholen'] = (game, bot) => {
  const v = vorab(game, bot, 'rueckholen');
  if (v.fehler) return v.fehler;
  if (Lage.rueckholSperre(game)) return NICHT_JETZT;   // Transfer ausgefallen oder Abklingzeit
  v.agent.bordBefehlSetzen('rueckholen');
  return OK;
};

function unterstuetzung(art) {
  return (game, bot) => {
    const v = vorab(game, bot, art);
    if (v.fehler) return v.fehler;
    if (Lage.captainBelegt(game, bot)) return NICHT_JETZT;   // ein Mensch haelt die Captain-Konsole: der Mensch gewinnt, der Bot geht nicht hin
    if (Lage.supportSperre(game, art)) return NICHT_JETZT;   // Abklingzeit (kein Weg fuer nichts)
    if (Lage.allesDowned(game)) return NICHT_JETZT;   // die Rueckholung geht dem Laufweg vor
    v.agent.bordBefehlSetzen(art);
    return OK;
  };
}
bord['bord.sensor'] = unterstuetzung('sensor');
bord['bord.kuppel'] = unterstuetzung('kuppel');

module.exports = bord;
