'use strict';
// SYS-01 C2b: Szenenbaustein gegner_notfallsprung (Laufzeit: server/sim/gegnersprung.js, Werte: content/kampf/gegnersprung-werte.json).
//   gegner_notfallsprung  { ziel, ausloeser, prozent?, verzoegerung_s? }   Aktion: ein Gegner (Tag oder Klasse) lädt den Notfallsprung, sobald der Auslöser erfüllt ist,
//                                                                           und entkommt nach verzoegerung_s (ohne Beute, ohne Abschuss). Ohne diesen Baustein flieht kein Gegner.
// Ereignis: enemyEscaped { enemy }. Nur am Ort des Schritts wirksam (wie spawn), wie die übrigen Gegner-Bausteine.
const W = require('../../../content/kampf/gegnersprung-werte.json').werte;
const AUSLOESER = W.ausloeser.wert;
const atLoc = (m) => !(m.step && m.step.loc && m.game.ship.scene !== m.step.loc);

module.exports = (Registry) => {
  Registry.define({ id: 'gegner_notfallsprung', art: 'aktion', effekt: 'gegner', ereignisse: ['enemyEscaped'],
    beschreibung: 'Gegner (Tag oder Klasse) lädt den Notfallsprung, sobald der Auslöser erfüllt ist (reaktor_zerstoert, integritaet_unter mit prozent, sofort), und entkommt nach verzoegerung_s. Konkurriert mit dem Reaktor-Countdown (beide laufen gleichzeitig, wer zuerst abläuft gewinnt): ist die Ladung kürzer als der Rest, entkommt er, sonst stirbt er.',
    params: {
      ziel: { typ: 'string', pflicht: true },
      ausloeser: { typ: 'string', pflicht: true, werte: AUSLOESER },
      prozent: { typ: 'number', min: 1, max: 99 },
      verzoegerung_s: { typ: 'number', min: W.verzoegerung_s.min, max: W.verzoegerung_s.max },
    },
    run(m, a) { if (atLoc(m)) require('../../sim/gegnersprung.js').regel(m.game, a); } });
};
