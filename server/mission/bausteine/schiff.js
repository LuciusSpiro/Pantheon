'use strict';
// SL3 (CONCEPT-SL3): Bausteine für die Lerche selbst als Registry-Plugin. Laufzeit: server/sim/szenenreset.js.
//   schiff_zuruecksetzen { x?, y?, winkel? }   Aktion: Szene von vorn (Lerche heil, Reaktor an, Gegner und Geschosse weg, Position)
//   reaktor_aus                                Prüfung: der Reaktor ist offline (z. B. nach dem Notfallsprung) oder zerstört
// Ereignis (missionEvent): emergency (Hülle auf 0, Notfallprotokoll; seit SL3 an Regiebücher gemeldet; Hook `on.emergency`).
let mod = null;
const sr = () => mod || (mod = require('../../sim/szenenreset.js'));

module.exports = (Registry) => {
  Registry.define({ id: 'schiff_zuruecksetzen', art: 'aktion', effekt: 'gegner',
    beschreibung: 'Szene von vorn: Lerche instand gesetzt (Hülle, Systeme, Reaktor, Schilde), Gegner und Geschosse des Raums weg, optional Position x,y und Blickrichtung (winkel, Bogenmaß)',
    params: { x: { typ: 'number', min: 0 }, y: { typ: 'number', min: 0 }, winkel: { typ: 'number' } },
    run(m, a) { sr().zuruecksetzen(m.game, { x: a.x, y: a.y, winkel: a.winkel }); } });
  Registry.define({ id: 'reaktor_aus', art: 'pruefung', beschreibung: 'Der Reaktor der Lerche ist offline (z. B. nach dem Notfallsprung) oder zerstört',
    params: {},
    test: (m) => sr().reaktorAus(m.game) });
};
