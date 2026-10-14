'use strict';
// SL5 (CONCEPT-SL5): Bausteine für die Ionenspur (Registry-Plugin, Logik in server/sim/spur.js).
//   spur_starten { id }        Aktion: Spur aus content/spuren/<id>.json beginnen. Ereignisse: spurGestartet, spurGelesen, spurEnde
//   spur_ende { id }           Prüfung: die Spur ist bis zum Ende gelesen (verborgene Kante enthüllt)
//   spur_gelesen { id, min? }  Prüfung: die Spur liegt mindestens im min-ten Hex der Wegliste (0-basiert) und ist dort gelesen
const S = () => require('../../sim/spur.js');

module.exports = (Registry) => {
  Registry.define({ id: 'spur_starten', art: 'aktion', ereignisse: ['spurGestartet', 'spurGelesen', 'spurEnde'],
    beschreibung: 'Ionenspur aufnehmen (content/spuren/<id>.json): Navigation fliegt den Spurkern jedes Hexes an, die Ops liest Kante und Alter, im letzten Hex wird die verborgene Kante enthüllt',
    params: { id: { typ: 'string', pflicht: true } },
    run(m, a) { const err = S().starten(m.game, a.id); if (err) m.game.countError('mission-hook', new Error('spur_starten: ' + err)); } });
  Registry.define({ id: 'spur_ende', art: 'pruefung', beschreibung: 'Spur bis zum Ende gelesen (verborgene Kante enthüllt)',
    params: { id: { typ: 'string', pflicht: true } },
    test: (m, a) => { const e = S().ergebnis(m.game, a.id); return !!(e && e.fertig); } });
  Registry.define({ id: 'spur_gelesen', art: 'pruefung', beschreibung: 'Spur liegt mindestens im Hex min (0-basiert) und ist dort gelesen',
    params: { id: { typ: 'string', pflicht: true }, min: { typ: 'number', min: 0, max: 20 } },
    test: (m, a) => { const e = S().ergebnis(m.game, a.id); return !!(e && (e.fertig || (e.gelesen && e.idx >= (a.min != null ? a.min : 0)))); } });
};
