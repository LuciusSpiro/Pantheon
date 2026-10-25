'use strict';
// SUND-04a-1 A: Bausteine der Verfolgung (A6) als Registry-Plugin (Laufzeit: server/sim/verfolgung.js, gezielter Antriebstreffer: server/sim/zielsysteme.js).
//   verfolgung_an       { klasse?, volk?, name?, tempo?, wiederholung? }   Aktion: Zielschiff flieht Richtung Fluchtpunkt, lädt dort den Sprung auf
//   verfolgung_ende     {}                                                  Aktion: Szene als geschafft werten (Überspringen im Regiebuch)
//   verfolgung_ausgang  { was }                                             Prüfung: der Ausgang dieses Versuchs (gestellt | zerstoert | entkommen)
//   verfolgung_erfolg   {}                                                  Prüfung: gestellt oder zerstört
// Ereignisse (missionEvent): verfolgungStart, verfolgungSprungStart, verfolgungAusgang { was, klasse, name, volk, versuch }, zielsystemGetroffen { enemy|system, stufe, seite }.
// Nur am Ort des Schritts wirksam (wie spawn); das Laufzeitmodul wird erst beim Aufruf geladen. Ein Faden braucht den Baustein nicht: er ruft Verfolgung.starten direkt.
function verfolgung() { return require('../../sim/verfolgung.js'); }
const atLoc = (m) => !(m.step && m.step.loc && m.game.ship.scene !== m.step.loc);
const KLASSEN = ['frachter', 'raider', 'korvette', 'fregatte', 'kreuzer'];

module.exports = (Registry) => {
  Registry.define({ id: 'verfolgung_an', art: 'aktion', effekt: 'gegner',
    ereignisse: ['verfolgungStart', 'verfolgungSprungStart', 'verfolgungAusgang', 'zielsystemGetroffen', 'enemySpawn', 'enemyKilled'],
    beschreibung: 'Verfolgung (A6) einrichten: ein Zielschiff (klasse, Standard korvette; volk; name) flieht Richtung Fluchtpunkt (Sprungpunkt des Orts, sonst virtueller Punkt am Szenenrand) und lädt dort den Sprung auf (15 s, Hüllentreffer verzögern, ausgefallener Antrieb hält an). Die Crew stellt es: Ops visieren den Antrieb an (Systemziel) und treffen das Heck, oder sie stören die Sprungladung. wiederholung (Standard an): entkommt es, kommt nach 8 s ein neues',
    params: { klasse: { typ: 'string', werte: KLASSEN }, volk: { typ: 'string', werte: ['ger', 'rom', 'pirat'] }, name: { typ: 'string' }, tempo: { typ: 'number', min: 0.25, max: 0.9 }, wiederholung: { typ: 'bool' } },
    run(m, a) { if (atLoc(m)) verfolgung().starten(m.game, a); } });
  Registry.define({ id: 'verfolgung_ende', art: 'aktion', beschreibung: 'Verfolgung als geschafft werten (Überspringen im Regiebuch)', params: {},
    run(m) { if (atLoc(m)) verfolgung().erzwingen(m.game); } });
  Registry.define({ id: 'verfolgung_ausgang', art: 'pruefung', beschreibung: 'Die Verfolgung endete mit gestellt (Antrieb ausgefallen, Lerche am Ziel), zerstoert oder entkommen (gesprungen)',
    params: { was: { typ: 'string', pflicht: true, werte: ['gestellt', 'zerstoert', 'entkommen'] } },
    test: (m, a) => verfolgung().ausgangIst(m.game, a.was) });
  Registry.define({ id: 'verfolgung_erfolg', art: 'pruefung', beschreibung: 'Die Verfolgung ist geschafft (gestellt oder zerstört)', params: {},
    test: (m) => verfolgung().erfolg(m.game) });
};
