'use strict';
// SYS-01 C1a-1: reine Regeln der Integrität, gemeinsam für die Lerche (interior.js) und die Gegner (gegnersystem.js).
// Eine Quelle für Schwellen und Grundwert, damit beide Seiten dieselbe Regel haben (Konzept „Gleiche Regeln“).
// zustandVon: Integrität ≤ 0 -> zerstört; unter schwelle × Maximum -> beschädigt; sonst ok.
// grundwertVon: Integrität, die zu einem Zustand gehört: ok = Maximum, beschädigt = anteil × Maximum, zerstört = 0.

function zustandVon(integ, max, schwelle) {
  if (!(integ > 0)) return 'broken';
  if (integ < schwelle * max) return 'damaged';
  return 'ok';
}

function grundwertVon(state, max, anteil) {
  if (state === 'ok') return max;
  if (state === 'damaged') return max * anteil;
  return 0;
}

module.exports = { zustandVon, grundwertVon };
