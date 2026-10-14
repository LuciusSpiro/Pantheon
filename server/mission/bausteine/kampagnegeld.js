'use strict';
// SL9: Bausteine für die Geldposten der Kampagne Die Schuld der Lerche (Zahlen aus CONFIG.campaign.sund, Laufzeit: server/sim/kampagnegeld.js).
//   geld_zahlen { posten }   Aktion: den Posten (forderung | geldziel | soeldner | loesegeld) von den Marken abbuchen (nichts bei zu wenig; vorher geld_reicht prüfen)
//   geld_reicht { posten }   Prüfung: genug Marken für den Posten
// Textvariable {geld:posten} nennt die Zahl (z. B. „{geld:loesegeld} Marken“).
const POSTEN = ['forderung', 'geldziel', 'soeldner', 'loesegeld'];
let mod = null;
const kg = () => mod || (mod = require('../../sim/kampagnegeld.js'));

module.exports = (Registry) => {
  Registry.define({ id: 'geld_zahlen', art: 'aktion', ereignisse: ['marksPaid'],
    beschreibung: 'Posten der Kampagne bezahlen (forderung, geldziel, soeldner, loesegeld aus der Konfiguration); bei zu wenig Marken wird nichts gebucht',
    params: { posten: { typ: 'string', pflicht: true, werte: POSTEN } },
    run(m, a) { if (!kg().zahlen(m.game, a.posten)) m.game.countError('mission-hook', new Error('geld_zahlen: zu wenig Marken für ' + a.posten)); } });
  Registry.define({ id: 'geld_reicht', art: 'pruefung', beschreibung: 'Genug Marken für den Posten der Kampagne (forderung, geldziel, soeldner, loesegeld)',
    params: { posten: { typ: 'string', pflicht: true, werte: POSTEN } },
    test: (m, a) => kg().reicht(m.game, a.posten) });
};
