'use strict';
// SL0 (CONCEPT-SL0): Bausteine für Personen an Bord (Frachtraum der Lerche) als Registry-Plugin. Laufzeit: server/sim/personen-bord.js.
//   person_an_bord   { person? }          Prüfung: die Person (ohne Angabe irgendeine) liegt im Frachtraum
//   person_aufnehmen { person*, name? }   Aktion: Person sofort an Bord legen (Skript, Rückfall, Labor), belegt einen Frachtplatz und ein Bett
//   person_abgeben   { person* }          Aktion: Person sofort aus dem Frachtraum übergeben (Skript, z. B. nach einem Gespräch)
// Ereignisse (missionEvent): personAnBord { person, name, n }, personAbgegeben { person, name, ort, map }, npcRescued (Hochbeamen vom Boden, wie bei der Rettung).
// Die Ops beamt Personen an der Konsole (weapons.person / weapons.person_ab); Voraussetzung am Boden: Landepunkt gescannt (SL7b).
let mod = null;
const pb = () => mod || (mod = require('../../sim/personen-bord.js'));

module.exports = (Registry) => {
  Registry.define({ id: 'person_aufnehmen', art: 'aktion', ereignisse: ['personAnBord'],
    beschreibung: 'Person sofort in den Frachtraum der Lerche legen (belegt einen Frachtplatz, liegt auf einem Bett). Für Evert und andere Mitreisende; Frachtraum voll -> Fehler im Protokoll.',
    params: { person: { typ: 'string', pflicht: true }, name: { typ: 'text' } },
    run(m, a) {
      const nm = a.name != null ? m.tpl(a.name) : null;
      if (!pb().personAnBordLegen(m.game, a.person, nm)) m.game.countError('mission-hook', new Error('person_aufnehmen: Frachtraum voll oder kein Bett frei'));
    } });
  Registry.define({ id: 'person_abgeben', art: 'aktion', ereignisse: ['personAbgegeben'],
    beschreibung: 'Person sofort aus dem Frachtraum übergeben (Skript statt Ops-Beamen).',
    params: { person: { typ: 'string', pflicht: true } },
    run(m, a) { pb().personAbgeben(m.game, a.person); } });
  Registry.define({ id: 'person_an_bord', art: 'pruefung', beschreibung: 'Die Person (ohne Angabe: irgendeine) liegt im Frachtraum der Lerche',
    params: { person: { typ: 'string' } },
    test: (m, a) => pb().personAnBord(m.game, a.person != null ? a.person : null) });
};
