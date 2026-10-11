'use strict';
// EK3 Teil A (CONTRACT-EK3 §5): Bausteine für Fracht (Ladung) und Frachtraum als Registry-Plugin (server/sim/fracht.js).
//   fracht_abwerfen   { art?, x?, y? }      Aktion: Fracht im Raum ablegen (ohne Angabe 160 px vor der Lerche)
//   fracht_abnehmer   { ort?, name? }       Aktion: Auftraggeber festlegen, bei dem die Taktik abliefern darf (ohne ort: jede Station)
//   fracht_abliefern  { art?, n? }          Aktion: Ladung aus dem Frachtraum sofort übergeben (Skript, z. B. nach einem Gespräch)
//   fracht_an_bord    { art?, min? }        Prüfung: mindestens min (Standard 1) Ladungen (der Art) im Frachtraum
//   fracht_abgeliefert{ art?, min? }        Prüfung: mindestens min (Standard 1) Ladungen (der Art) abgeliefert (seit Partiebeginn)
// Ereignisse (missionEvent): frachtAbgeworfen { id, art, x, y }, frachtAnBord { art, n, id }, frachtAbgeliefert { n, arten, ort, name }.
// Der Abnehmer ist Laufzeit (nicht im Weltstand); das Regiebuch setzt ihn mit der Szene neu.
let frachtMod = null;
const fracht = () => frachtMod || (frachtMod = require('../../sim/fracht.js'));
const ARTEN = ['sprengstoff', 'fracht'];

module.exports = (Registry) => {
  Registry.define({ id: 'fracht_abwerfen', art: 'aktion', ereignisse: ['frachtAbgeworfen'],
    beschreibung: 'Fracht (Ladung) im Raum ablegen, die die Taktik an Bord beamen kann (sprengstoff | fracht). Ohne x/y 160 px vor der Lerche. Bleibt bis zum Systemwechsel liegen.',
    params: { art: { typ: 'string', werte: ARTEN }, x: { typ: 'number' }, y: { typ: 'number' } },
    run(m, a) {
      const g = m.game; const sh = g.ship;
      const x = a.x != null ? a.x : sh.x + 160, y = a.y != null ? a.y : sh.y;
      if (!fracht().fracht_abwerfen(g, x, y, a.art || null)) g.countError('mission-hook', new Error('fracht_abwerfen: nicht abgelegt'));
    } });
  Registry.define({ id: 'fracht_abnehmer', art: 'aktion',
    beschreibung: 'Auftraggeber für die Ablieferung festlegen: nur an diesem Ort (ort) liefert die Taktik ab, name erscheint am Taktik-Bildschirm. Ohne ort nimmt jede Station Fracht an.',
    params: { ort: { typ: 'loc' }, name: { typ: 'text' } },
    run(m, a) { fracht().setAbnehmer(m.game, a.ort || null, a.name != null ? m.tpl(a.name) : null); } });
  Registry.define({ id: 'fracht_abliefern', art: 'aktion', ereignisse: ['frachtAbgeliefert'],
    beschreibung: 'Ladung aus dem Frachtraum sofort übergeben (Skript statt Taktik-Beamen), art/n begrenzen die Auswahl',
    params: { art: { typ: 'string', werte: ARTEN }, n: { typ: 'number', min: 1, max: 4 } },
    run(m, a) { fracht().skriptAbliefern(m.game, a.art || null, a.n != null ? a.n : null); } });

  Registry.define({ id: 'fracht_an_bord', art: 'pruefung', beschreibung: 'Mindestens min Ladungen (der Art) im Frachtraum der Lerche',
    params: { art: { typ: 'string', werte: ARTEN }, min: { typ: 'number', min: 1, max: 4 } },
    test: (m, a) => fracht().anBord(m.game, a.art || null) >= (a.min != null ? a.min : 1) });
  Registry.define({ id: 'fracht_abgeliefert', art: 'pruefung', beschreibung: 'Mindestens min Ladungen (der Art) in dieser Partie abgeliefert',
    params: { art: { typ: 'string', werte: ARTEN }, min: { typ: 'number', min: 1, max: 99 } },
    test: (m, a) => fracht().abgeliefert(m.game, a.art || null) >= (a.min != null ? a.min : 1) });
};
