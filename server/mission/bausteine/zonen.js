'use strict';
// SL6 (CONCEPT-SL6): Bausteine für Zonen mit Wirkung und Handelsware (Registry-Plugin, Logik in server/sim/zonen.js und ladung.js).
//   in_zone          { zone }          Prüfung: die Lerche liegt in der Zone (ID aus scene.zonen, z. B. gas0503_ring2)
//   zone_bekannt     { zone }          Prüfung: die Zone ist erkundet (Flug, Sonde, Ops-Scan)
//   zaehler_mindestens { id, min }     Prüfung: Zonen-Zähler (Ertrag 'zaehler:<id>', z. B. Boje) hat min erreicht
//   fracht_verkauft  { art?, min? }    Prüfung: mindestens min Einheiten (der Art) an Händler verkauft (seit Partiebeginn)
//   zonen_erkunden   { zone? }         Aktion: eine Zone (ohne Angabe alle der Szene) als erkundet markieren (Sonde, Skript)
//   zaehler_setzen   { id, wert }      Aktion: Zonen-Zähler setzen (Rücksetzen, Labor)
// Marken: credit_marks / marks_at_least in server/mission/registry.js (server/sim/geld.js).
const Z = () => require('../../sim/zonen.js');
const L = () => require('../../sim/ladung.js');
const ARTEN = ['sprengstoff', 'fracht', 'deuterium'];

module.exports = (Registry) => {
  Registry.define({ id: 'in_zone', art: 'pruefung', beschreibung: 'Die Lerche liegt in der Zone (Zonen-ID der Szene, SL6)',
    params: { zone: { typ: 'string', pflicht: true } },
    test: (m, a) => Z().state(m.game).in.includes(a.zone) });
  Registry.define({ id: 'zone_bekannt', art: 'pruefung', beschreibung: 'Die Zone ist erkundet (Flug hinein, Sonde, Ops-Scan)',
    params: { zone: { typ: 'string', pflicht: true } },
    test: (m, a) => Z().istBekannt(m.game, a.zone) });
  Registry.define({ id: 'zaehler_mindestens', art: 'pruefung', beschreibung: 'Zonen-Zähler (Ertrag zaehler:<id>, z. B. Aktivierung der Boje) hat min erreicht',
    params: { id: { typ: 'string', pflicht: true }, min: { typ: 'number', pflicht: true, min: 0 } },
    test: (m, a) => Z().zaehler(m.game, a.id) >= a.min });
  Registry.define({ id: 'fracht_verkauft', art: 'pruefung', beschreibung: 'Mindestens min Einheiten (der Art) an einen Händler verkauft (seit Partiebeginn)',
    params: { art: { typ: 'string', werte: ARTEN }, min: { typ: 'number', min: 1, max: 999 } },
    test: (m, a) => L().verkauft(m.game, a.art || null) >= (a.min != null ? a.min : 1) });
  Registry.define({ id: 'zonen_erkunden', art: 'aktion', ereignisse: ['zonenBekannt'],
    beschreibung: 'Zonen der Szene als erkundet markieren (zone = eine ID, ohne Angabe alle), z. B. nach einer Sonde',
    params: { zone: { typ: 'string' } },
    run(m, a) { Z().bekanntMachen(m.game, a.zone ? [a.zone] : 'alle'); } });
  Registry.define({ id: 'zaehler_setzen', art: 'aktion', beschreibung: 'Zonen-Zähler auf einen Wert setzen (Rücksetzen, Labor-Einstieg)',
    params: { id: { typ: 'string', pflicht: true }, wert: { typ: 'number', pflicht: true, min: 0 } },
    run(m, a) { Z().zaehlerSetzen(m.game, a.id, a.wert); } });
};
