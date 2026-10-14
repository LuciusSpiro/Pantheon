'use strict';
// EK8 (CONTRACT-EK8): Bausteine für die Kampagnenkette (Registry-Plugin).
//   fracht_zuteilen { art, n? }   Aktion: n Ladungen (Standard 1) der Art direkt in den Frachtraum legen, soweit Platz ist
//                                 (Belohnung „Behaltet einen Teil“, Ersatz einer verlorenen Sprengladung). Ereignis frachtAnBord.
// Die übrigen Wege der Kette laufen über vorhandene Bausteine (fracht_*, sperrriegel_oeffnen, welt_fakt, npc_gedaechtnis, chronik).
const ARTEN = ['sprengstoff', 'fracht', 'deuterium'];   // SL6: Deuterium
const fracht = () => require('../../sim/fracht.js');

module.exports = (Registry) => {
  Registry.define({ id: 'fracht_zuteilen', art: 'aktion', ereignisse: ['frachtAnBord'],
    beschreibung: 'n Ladungen (Standard 1) der Art direkt in den Frachtraum der Lerche legen (Belohnung, Ersatz einer verlorenen Sprengladung); ohne freien Platz wird nur gelegt, was hineinpasst',
    params: { art: { typ: 'string', pflicht: true, werte: ARTEN }, n: { typ: 'number', min: 1, max: 4 } },
    run(m, a) {
      const g = m.game; const F = fracht();
      for (let i = 0; i < (a.n != null ? a.n : 1); i++) if (!F.anBordLegen(g, a.art)) break;
    } });
};
