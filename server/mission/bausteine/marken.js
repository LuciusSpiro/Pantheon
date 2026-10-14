'use strict';
// SL1B (Team KARTE): Bausteine der Hex-Marken. Laufzeit in server/sim/marken.js.
//   hex_marke_setzen    { id*, typ*, hex*, sym?, ticks? }   Marke auf der Hexkarte (typ notruf|spur|fund|kontakt; hex: SSZZ oder Ort-ID; ticks: Ablauf)
//   hex_marke_entfernen { id* }                            Marke entfernen
//   hex_marke_da        { id* }                            Prüfung: Marke steht noch
// Missionsziele (typ ziel) braucht niemand zu setzen: Fokus-Auftrag und `objectives[].hex` erscheinen von selbst.
function marken() { try { return require('../../sim/marken.js'); } catch (e) { return null; } }

module.exports = (Registry) => {
  Registry.define({ id: 'hex_marke_setzen', art: 'aktion',
    beschreibung: 'Marke auf der Hexkarte setzen (notruf, spur, fund, kontakt); ersetzt eine Marke gleicher Id. ticks: verschwindet nach so vielen Ticks',
    params: { id: { typ: 'string', pflicht: true }, typ: { typ: 'string', pflicht: true, werte: ['notruf', 'spur', 'fund', 'kontakt'] }, hex: { typ: 'string', pflicht: true },
      sym: { typ: 'string' }, ticks: { typ: 'number', min: 1 } },
    run(m, a) {
      const M = marken(); if (!M) return;
      const r = M.setze(m.game, { id: a.id, typ: a.typ, hex: a.hex, sym: a.sym, ticks: a.ticks });
      if (r) m.game.countError('mission-marken', new Error(r));
    } });
  Registry.define({ id: 'hex_marke_entfernen', art: 'aktion', beschreibung: 'Marke von der Hexkarte nehmen',
    params: { id: { typ: 'string', pflicht: true } },
    run(m, a) { const M = marken(); if (M) M.entferne(m.game, a.id); } });
  Registry.define({ id: 'hex_marke_da', art: 'pruefung', beschreibung: 'Die Marke steht auf der Hexkarte',
    params: { id: { typ: 'string', pflicht: true } },
    test: (m, a) => { const M = marken(); return !!(M && M.da(m.game, a.id)); } });
};
