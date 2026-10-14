'use strict';
// SL7b (CONCEPT-SL7): Bausteine für den Landepunkt-Scan (Registry-Plugin, Logik in server/sim/lpscan.js).
//   landepunkt_gescannt   { lp }   Prüfung: die Ops hat den Landepunkt gescannt (Karte liegt auf dem Planungstisch)
//   landepunkt_scannen    { lp }   Aktion: Scan als erledigt setzen (Skript, Labor-Einstieg, Bots); Ereignis landepunktGescannt { lp }
const L = () => require('../../sim/lpscan.js');

module.exports = (Registry) => {
  Registry.define({ id: 'landepunkt_gescannt', art: 'pruefung', beschreibung: 'Die Ops hat den Landepunkt gescannt (seine Karte liegt am Planungstisch)',
    params: { lp: { typ: 'landepunkt', pflicht: true } },
    test: (m, a) => L().gescannt(m.game, a.lp) });
  Registry.define({ id: 'landepunkt_scannen', art: 'aktion', ereignisse: ['landepunktGescannt'],
    beschreibung: 'Landepunkt als gescannt markieren (ohne Ops-Scan, z. B. Labor oder Skript); sendet die Karte an den Planungstisch',
    params: { lp: { typ: 'landepunkt', pflicht: true } },
    run(m, a) { L().markieren(m.game, a.lp); if (typeof m.game.syncPlanMaps === 'function') m.game.syncPlanMaps(); } });
};
