'use strict';
// SL8 (CONCEPT-SL8): Bausteine für Notrufe (Registry-Plugin, Logik in server/sim/notrufe.js).
//   notrufe_freischalten { ids, dauer? }   Aktion: Rufe aus content/notrufe/<id>.json (ids kommagetrennt) erscheinen auf der Hexkarte; dauer in Spielsekunden
//                                          (Standard CONFIG.notrufe.dauer). Ereignisse: notrufOffen, notrufAngenommen, notrufAbgelehnt, notrufAbgelaufen,
//                                          notrufVorOrt, notrufHinterhalt, notrufGemessen, notrufErledigt
//   notruf_erledigt { id }                 Prüfung: dieser Ruf ist geborgen bzw. der Hinterhalt abgewehrt
//   notrufe_erledigt { min }               Prüfung: mindestens min Rufe erledigt (Geldziel, Abspann)
const N = () => require('../../sim/notrufe.js');

module.exports = (Registry) => {
  Registry.define({ id: 'notrufe_freischalten', art: 'aktion', ereignisse: ['notrufOffen', 'notrufAngenommen', 'notrufAbgelehnt', 'notrufAbgelaufen', 'notrufVorOrt', 'notrufHinterhalt', 'notrufGemessen', 'notrufErledigt'],
    beschreibung: 'Notrufe schalten (ids kommagetrennt, content/notrufe): Marke auf der Hexkarte, Ablauf in Spielsekunden; Angebot, kein Zwang',
    params: { ids: { typ: 'string', pflicht: true }, dauer: { typ: 'number', min: 30, max: 7200 } },
    run(m, a) { const err = N().freischalten(m.game, a.ids, a.dauer); if (err) m.game.countError('mission-hook', new Error('notrufe_freischalten: ' + err)); } });
  Registry.define({ id: 'notruf_erledigt', art: 'pruefung', beschreibung: 'Der Notruf id ist erledigt (geborgen oder Hinterhalt abgewehrt)',
    params: { id: { typ: 'string', pflicht: true } },
    test: (m, a) => N().erledigt(m.game, a.id) });
  Registry.define({ id: 'notrufe_erledigt', art: 'pruefung', beschreibung: 'Mindestens min Notrufe erledigt',
    params: { min: { typ: 'number', min: 1, max: 20 } },
    test: (m, a) => N().anzahlErledigt(m.game) >= (a.min != null ? a.min : 1) });
};
