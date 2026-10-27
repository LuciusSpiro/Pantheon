'use strict';
// SUND-04a-3 STUB: Schnittstelle des Finale-Kerns (server/sim/finale.js) zum Boden-Teil (Schrein von Asgard). Das Paket Finale-Boden ersetzt diese Datei.
// bodenStarten(game) -> bool: bereitet Landung und Bodenszene vor; false = geht nicht (das Finale beginnt dann von vorn). Der Stub baut nichts und meldet ok:
// die Phase 'boden' steht dann ohne Szene (nur mit dem Orbit-Stub-Ersatz erreichbar; solange kriegslage-szene.finaleStarten null liefert, startet das Finale gar nicht).
// Tests ersetzen ihn über Finale.ersetzen('boden', { bodenStarten }).
function bodenStarten(game) { return true; }   // eslint-disable-line no-unused-vars

module.exports = { bodenStarten };
