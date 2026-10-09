'use strict';
// W1 AP1 (Netzbudget): Snapshot-Form. Felder mit Standardwert fallen aus dem Snapshot weg; Leser behandeln
// „Feld fehlt“ wie den Standard (Doku je Feld in shared/protocol.js).
//
// ohneStandard(obj, standards) entfernt aus obj (in place) jedes Feld, dessen Wert gleich dem Standard ist, und gibt obj
// zurück. Vergleich mit === (null, false, 0, 'ok' …); ein Feld, das in standards nicht vorkommt, bleibt immer.

function ohneStandard(obj, standards) {
  if (!obj || !standards) return obj;
  for (const k in standards) if (k in obj && obj[k] === standards[k]) delete obj[k];
  return obj;
}

// Standardwerte der Gegner (away.drones[], nur Kampf v2 / droneSnap). alive: nur false wird gesendet (liegt/aus).
const GEGNER = Object.freeze({ asleep: false, cr: false, ghost: null, aim: null, alive: true });
// Standardwerte der Spieler (players[], combat.playerSnap). zs fehlt = 'ok' gilt nur, wenn die B2-Felder (ht) da sind.
const SPIELER = Object.freeze({ bleed: null, cr: false, zs: 'ok', ov: 0, bt: 0, fl: false });

module.exports = { ohneStandard, GEGNER, SPIELER };
