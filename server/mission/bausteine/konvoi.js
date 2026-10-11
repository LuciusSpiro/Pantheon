'use strict';
// EK3 Teil B (CONTRACT-EK3B): Bausteine der Konvoi-Szene als Registry-Plugin (Laufzeit: server/sim/konvoi.js).
//   konvoi_an       { n?, eskorte?, sieg?, ladung?, tempo?, beute_min?, wiederholung? }   Aktion: Konvoi einrichten (Transporter, Eskorte, Route, Sprung am Ende)
//   konvoi_ende     {}                                                                   Aktion: Szene als geschafft werten (Überspringen im Regiebuch)
//   konvoi_ausgang  { was }                                                              Prüfung: der Ausgang dieses Versuchs (gepluendert | aufgehalten | entkommen)
//   konvoi_erfolg   {}                                                                   Prüfung: gepluendert oder aufgehalten (je nach Siegbedingung)
//   konvoi_uebrig   { max? }                                                             Prüfung: höchstens max Transporter fahren noch (Standard 0)
// Ereignisse (missionEvent): konvoiKontakt, konvoiTransporterZerstoert { id, art, x, y, pod }, konvoiSprungStart, konvoiSprung, konvoiAlarm, konvoiAusgang { was, sieg, versuch }.
// Nur am Ort des Schritts wirksam (wie spawn); das schwere Modul wird erst beim Aufruf geladen.
function konvoi() { return require('../../sim/konvoi.js'); }
const atLoc = (m) => !(m.step && m.step.loc && m.game.ship.scene !== m.step.loc);
const ESKORTEN = ['voll', 'jaeger', 'korvette', 'keine'];
const ARTEN = ['sprengstoff', 'fracht'];

module.exports = (Registry) => {
  Registry.define({ id: 'konvoi_an', art: 'aktion', effekt: 'gegner',
    ereignisse: ['konvoiKontakt', 'konvoiTransporterZerstoert', 'konvoiSprung', 'konvoiAlarm', 'konvoiAusgang', 'enemySpawn', 'frachtAbgeworfen'],
    beschreibung: 'Konvoi-Szene (A15) einrichten: n Transporter (1–3, unbewaffnet, Klasse frachter) mit Eskorte (voll = Jäger und Korvette | jaeger | korvette | keine) fahren eine Route und springen am Ende. sieg: aufhalten (alle Transporter zerstören, bevor sie springen) oder pluendern (zerstörte Transporter lassen Fracht fallen, die Taktik beamt sie an Bord; beute_min Ladungen nötig, Standard n bis zur Kapazität des Frachtraums). Entkommt der Konvoi, kommt bei wiederholung (Standard an) nach 8 s ein neuer',
    params: { n: { typ: 'number', min: 1, max: 3 }, eskorte: { typ: 'string', werte: ESKORTEN }, sieg: { typ: 'string', werte: ['aufhalten', 'pluendern'] },
      ladung: { typ: 'string', werte: ARTEN }, tempo: { typ: 'number', min: 0.25, max: 0.9 }, beute_min: { typ: 'number', min: 1, max: 3 }, wiederholung: { typ: 'bool' } },
    run(m, a) { if (atLoc(m)) konvoi().an(m.game, a); } });
  Registry.define({ id: 'konvoi_ende', art: 'aktion', beschreibung: 'Konvoi-Szene als geschafft werten (Überspringen im Regiebuch)', params: {},
    run(m) { if (atLoc(m)) konvoi().erzwingen(m.game); } });
  Registry.define({ id: 'konvoi_ausgang', art: 'pruefung', beschreibung: 'Der Konvoi-Versuch endete mit gepluendert (Fracht an Bord), aufgehalten (alle Transporter zerstört) oder entkommen (Konvoi gesprungen)',
    params: { was: { typ: 'string', pflicht: true, werte: ['gepluendert', 'aufgehalten', 'entkommen'] } },
    test: (m, a) => konvoi().ausgangIst(m.game, a.was) });
  Registry.define({ id: 'konvoi_erfolg', art: 'pruefung', beschreibung: 'Die Siegbedingung der Konvoi-Szene ist erfüllt (gepluendert bzw. aufgehalten)', params: {},
    test: (m) => konvoi().erfolg(m.game) });
  Registry.define({ id: 'konvoi_uebrig', art: 'pruefung', beschreibung: 'Höchstens max (Standard 0) Transporter des Konvois fahren noch',
    params: { max: { typ: 'number', min: 0, max: 3 } },
    test: (m, a) => konvoi().uebrig(m.game) <= (a.max || 0) });
};
