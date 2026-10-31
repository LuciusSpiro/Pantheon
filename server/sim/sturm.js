'use strict';
// SYS-02a (Kai 2026-10-28): Sturm = Unterdrückungswaffe. Gleiche Regel für die Lerche gegen Gegner und Gegner gegen die Lerche (Verbündete wie Gegner).
//   - Schildregeneration unterdrücken (systemModell.sturm.regenSperre_s je Sektor/Segment, SYS-03 C1), kaum Schildschaden (schildFaktor): der Sturm nutzt volle Schilde nicht ab.
//   - Reparatursperre: ein Sturm-Treffer in einer Zone sperrt die Reparatur aller Systeme dieser Zone für reparaturSperre_s (Fortschritt laufender Reparaturen sofort 0).
//   - SYS-03 B2: Bei Schild 0 zählt ein Sturm-Treffer als Direkttreffer (eine Stufe, Treffer-Fenster), bei 0 < Schild ≤ sturm.niedrig mit Chance sturm.systemChance eine Stufe. Gegen vollen Schild kein Systemschaden. Keine Punktfaktoren mehr.
//   - Treffer-Fenster: ein System, das ein Sturm-Treffer eine Stufe gekostet hat, ist für sturm.trefferFenster_s (länger als das Standard-Fenster, integritaet.js ART_STURM) gegen weitere Treffer geschützt: eine Salve aus vielen Nadeln kostet es nur eine Stufe.
//   - Ausnahme (bewusst, Softlock-Schutz): die ODA-Notreparatur (interior.js, emergencyRepair.brokenDelay 45 s, nur ohne Ersatzteile und ohne Arbeitenden) beachtet die Sperre nicht.
// Es GILT CONFIG.systemModell.sturm (live per `tune systemModell.sturm.<wert>`); die Katalogwerte (sturmbatterie.sturm) sind nur der Rückfallwert, wenn dort nichts steht.
const Katalog = require('../../shared/schiffskatalog.js');

function wert(game, key) {
  const c = game && game.C && game.C.systemModell && game.C.systemModell.sturm;
  if (c && typeof c[key] === 'number' && Number.isFinite(c[key])) return c[key];
  return Number(Katalog.waffe('sturmbatterie').sturm[key]);
}
// SYS-03 C1: Regenerationssperre der Schilde nach einem Sturm-Treffer (s, je Sektor/Segment). NUR in der Config (systemModell.sturm.regenSperre_s), kein Katalog-Rückfall.
function regenSperre(game) { const c = game && game.C && game.C.systemModell && game.C.systemModell.sturm; const v = c && Number(c.regenSperre_s); return v > 0 ? v : 0; }
function reparaturSperre(game) { const v = wert(game, 'reparaturSperre_s'); return v > 0 ? v : 0; }

module.exports = { wert, reparaturSperre, regenSperre };
