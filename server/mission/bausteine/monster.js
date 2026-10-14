'use strict';
// SL7c (CONCEPT-SL7): Bausteine für die Monster-Station (Registry-Plugin, Logik in server/sim/monster.js).
//   pulte_gehackt         { min? }   Prüfung: mindestens min Pulte (Standard alle vier) der Monster-Station sind gehackt (Ereignis pultGehackt je Pult, pulteFertig am Ende)
//   monster_zuruecksetzen {}         Aktion: Monster und Pulte zurücksetzen (Wiederholung der Szene)
//   team_alle_verwundet   {}         Prüfung: das ganze Außenteam liegt am Boden (Szene wiederholt sich, Ausgang verloren)
// Ereignisse (missionEvent): monsterStation { map, pulte }, pultGehackt { map, anker, n, von }, pulteFertig { map }, monsterTreffer { pid }, monsterLaerm { art, x, y }.
const M = () => require('../../sim/monster.js');

module.exports = (Registry) => {
  Registry.define({ id: 'monster_zuruecksetzen', art: 'aktion', beschreibung: 'Monster-Station von vorn: Monster und Pulte zurück auf Anfang (Szene wiederholt sich)',
    params: {}, run(m) { M().zuruecksetzen(m.game); } });
  Registry.define({ id: 'pulte_gehackt', art: 'pruefung', beschreibung: 'Mindestens min Pulte der Monster-Station gehackt (Standard: alle; Ereignis pulteFertig)',
    params: { min: { typ: 'number', min: 1, max: 4 } },
    test: (m, a) => (a.min == null ? M().pulteFertig(m.game) : M().pulteErledigt(m.game) >= a.min) });
  Registry.define({ id: 'team_alle_verwundet', art: 'pruefung', beschreibung: 'Das gesamte Außenteam liegt verwundet am Boden (Monster-Station: Szene wiederholen)',
    params: {},
    test: (m) => M().alleVerwundet(m.game) });
};
