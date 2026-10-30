'use strict';
// SYS-02a (Kai 2026-10-28): Sturm = Unterdrückungswaffe. Gleiche Regel für die Lerche gegen Gegner und Gegner gegen die Lerche (Verbündete wie Gegner).
//   - Schildregeneration unterdrücken (sturm.regenSperre, wie bisher), kaum Schildschaden (schildFaktor): der Sturm nutzt volle Schilde nicht ab.
//   - Reparatursperre: ein Sturm-Treffer in einer Zone sperrt die Reparatur aller Systeme dieser Zone für reparaturSperre_s (Fortschritt laufender Reparaturen sofort 0).
//   - Bei Schild ≤ sturm.niedrig oder 0 wirkt der Sturm-Schaden gegen das System × systemFaktor.
//   - Ausnahme (bewusst, Softlock-Schutz): die ODA-Notreparatur (interior.js, emergencyRepair.brokenDelay 45 s, nur ohne Ersatzteile und ohne Arbeitenden) beachtet die Sperre nicht.
// Es GILT CONFIG.systemModell.sturm (live per `tune systemModell.sturm.<wert>`); die Katalogwerte (sturmbatterie.sturm) sind nur der Rückfallwert, wenn dort nichts steht.
const Katalog = require('../../shared/schiffskatalog.js');

function wert(game, key) {
  const c = game && game.C && game.C.systemModell && game.C.systemModell.sturm;
  if (c && typeof c[key] === 'number' && Number.isFinite(c[key])) return c[key];
  return Number(Katalog.waffe('sturmbatterie').sturm[key]);
}
function reparaturSperre(game) { const v = wert(game, 'reparaturSperre_s'); return v > 0 ? v : 0; }
function systemFaktor(game) { const v = wert(game, 'systemFaktor'); return v > 0 ? v : 1; }

module.exports = { wert, reparaturSperre, systemFaktor };
