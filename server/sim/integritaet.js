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

// SYS-03 B2: Stufenregel gemeinsam fuer Lerche, Gegner und Verbuendete (Direkttreffer = genau eine Stufe, unabhaengig von der Schadenszahl).
// naechsteStufe: ok -> beschaedigt -> zerstoert. fensterDauer/imFenster: Treffer-Fenster (systemModell.trefferFenster_s, eine Quelle), t = Zeitpunkt des letzten Stufenverlusts.
// damagedAnteil: Grundwert der Stufe beschaedigt (systemModell.reparatur.damaged, Anteil des Maximums). stufenAusAnteil: Torpedo-Durchschlag (systemModell.torpedo.reaktorAnteil)
// in Stufen: eine Stufe = 1 - damagedAnteil des Maximums (0,5 = eine Stufe, 1 = zerstoert), mindestens eine.
function naechsteStufe(state) { return state === 'ok' ? 'damaged' : 'broken'; }
function sysModell(game) { return (game && game.C && game.C.systemModell) || {}; }
function fensterDauer(game) { const v = Number(sysModell(game).trefferFenster_s); return v > 0 ? v : 0; }
function imFenster(game, t) {
  if (t == null) return false;
  const d = game.time - t;
  return d >= 0 && d < fensterDauer(game);
}
function damagedAnteil(game) { const v = Number((sysModell(game).reparatur || {}).damaged); return v > 0 ? v : 0.5; }
function stufenAusAnteil(game, anteil) { return Math.max(1, Math.floor(Number(anteil) / (1 - damagedAnteil(game)) + 1e-9)); }

module.exports = { zustandVon, grundwertVon, naechsteStufe, fensterDauer, imFenster, damagedAnteil, stufenAusAnteil };
