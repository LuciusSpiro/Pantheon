'use strict';
// BOT-05 A1: die Stammcrew der Bots (content/bots/figuren.json). Jeder Bot ist eine feste Figur: botId = Figur, nicht Platz; Name, Karte, Stimme und Persoenlichkeit sind in jeder Partie gleich.
//   FIGUREN                 die Figuren in Dateireihenfolge (eingefroren)
//   figurMitId(botId)       Figur oder null
//   erstFreieFigur(belegt)  erste Figur, deren botId nicht in `belegt` (Liste oder Set) steht, sonst null
// Die Datei wird beim Laden geprueft (shared/bot-figuren.js); bei jedem Fehler wirft dieses Modul, der Server startet nicht (kein stilles Weiterlaufen).
const BotFiguren = require('../../shared/bot-figuren.js');

function lade() {
  const daten = require('../../content/bots/figuren.json');
  const fehler = BotFiguren.pruefeFiguren(daten, require('../../content/katalog/charakter.json'), require('../../content/bots/stimmen.json'));
  if (fehler.length) throw new Error('content/bots/figuren.json ungueltig:\n  ' + fehler.join('\n  '));
  return Object.freeze(daten.figuren.map((x) => Object.freeze(x)));
}
const FIGUREN = lade();

const figurMitId = (botId) => FIGUREN.find((x) => x.botId === botId) || null;
const erstFreieFigur = (belegt) => { const b = new Set(belegt); return FIGUREN.find((x) => !b.has(x.botId)) || null; };

module.exports = { FIGUREN, figurMitId, erstFreieFigur };
