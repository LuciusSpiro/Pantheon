'use strict';
// SYS-01 C1a-1: reine Regeln der Integrität, gemeinsam für die Lerche (interior.js) und die Gegner (gegnersystem.js, Verbündete über denselben Pfad).
// Eine Quelle für Stufenfolge, Grundwert, Treffer-Fenster und Dauerdruck, damit alle Seiten dieselbe Regel haben (Konzept „Gleiche Regeln“).
// stufeVon: Stufe, die zu einer Integrität gehört (robust, ohne Schwelle): ≤ 0 -> zerstört, ab Maximum -> ok, dazwischen beschädigt.
// grundwertVon: Integrität, die zu einer Stufe gehört: ok = Maximum, beschädigt = anteil × Maximum, zerstört = 0.

const EPS = 1e-6;

// SYS-03 B-Nacharbeit: die Stufe wird nicht aus einer Schwelle (schwelle × Maximum) gelesen, sondern aus den drei Grundwerten: i ist nur noch der aus der Stufe abgeleitete Wert, ein
// `tune systemModell.reparatur.damaged` ≥ Schwelle lässt die Stufe deshalb nicht mehr kippen. eps: Rundung des Speichers (die Lerche rundet ship.integ auf 0,1).
function stufeVon(integ, max, eps) {
  if (!(integ > 0)) return 'broken';
  if (integ >= max - (eps > 0 ? eps : EPS)) return 'ok';
  return 'damaged';
}

function grundwertVon(state, max, anteil) {
  if (state === 'ok') return max;
  if (state === 'damaged') return max * anteil;
  return 0;
}

// SYS-03 B2: Stufenregel gemeinsam fuer Lerche, Gegner und Verbuendete (Direkttreffer = genau eine Stufe, unabhaengig von der Schadenszahl).
// naechsteStufe: ok -> beschaedigt -> zerstoert.
function naechsteStufe(state) { return state === 'ok' ? 'damaged' : 'broken'; }
function sysModell(game) { return (game && game.C && game.C.systemModell) || {}; }
// damagedAnteil: Grundwert der Stufe beschaedigt (systemModell.reparatur.damaged, Anteil des Maximums).
function damagedAnteil(game) { const v = Number((sysModell(game).reparatur || {}).damaged); return v > 0 ? v : 0.5; }

// Treffer-Fenster je System: ein System, das gerade eine Stufe verloren hat, verliert innerhalb des Fensters keine weitere (Salven im selben Moment brauchen nicht zwei Stufen auf).
// EINE Fensterlaenge je Treffer-Art (benannt, keine Flags): ART_STURM = Sturm-Nadeln (systemModell.sturm.trefferFenster_s, laenger: eine Salve aus vielen Nadeln ueber knapp eine halbe
// Sekunde soll ein System nur eine Stufe kosten), sonst die Standard-Art (systemModell.trefferFenster_s). Das Fenster stempelt nur Treffer (Stufenverlust durch Schuss, Mine, Dauerdruck, Torpedo),
// bewusst nicht Hitze, Feuer, EMP, Notrueckholung oder Debug-Setzer (Hinweis K6: die setzen den Zustand ohne Trefferweg).
const ART_STURM = 'sturm';
function fensterDauer(game, art, sys) {
  const M = sysModell(game);
  const sturm = art === ART_STURM && M.sturm && M.sturm.trefferFenster_s != null ? Number(M.sturm.trefferFenster_s) : NaN;   // fehlt der Sturm-Wert, gilt das Standard-Fenster
  const v = Number.isFinite(sturm) ? sturm : Number(M.trefferFenster_s);
  // SYS-03 D (Binär-Prüfung): der Reaktor hat ein eigenes, längeres Fenster (systemModell.reaktorFenster_s): zwei Stufen brauchen mindestens so viele Sekunden, gleich für Lerche ('reactor'), Gegner und Verbündete ('reaktor').
  const rf = sys === 'reactor' || sys === 'reaktor' ? Number(M.reaktorFenster_s) : NaN;
  const w = Number.isFinite(rf) && rf > v ? rf : v;
  return w > 0 ? w : 0;
}
// Stempel nach einem Stufenverlust: Ende des Fensters (nie kuerzer als ein laufendes laengeres Fenster, z. B. nach einem Sturm-Treffer). alt = bisheriger Stempel (oder null).
function fensterStempeln(game, alt, art, sys) {
  const bis = game.time + fensterDauer(game, art, sys);
  return alt != null && alt > bis ? alt : bis;
}
function imFenster(game, bis) { return bis != null && game.time < bis; }

// Torpedo-Durchschlag auf den Reaktor in ganzen Stufen (systemModell.torpedo.reaktorStufen: 1 = eine Stufe, 2 = zerstoert nach einem Torpedo, 0 = kein Durchschlag), Lerche und Gegner gleich.
function torpedoStufen(game) {
  const v = Number((sysModell(game).torpedo || {}).reaktorStufen);
  return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 1;
}

// Dauerdruck der Zonen (zonen.js, Lerche je Sektor; Gegner und Verbuendete je Koerper): Punkte ohne Schild sammeln sich im Zaehler z = { n, t }, eine Stufe je zonen.druckPunkte.
// Der Zaehler verfaellt (n = 0), sobald zonen.druckAbkling_s lang kein Druck mehr auf das Ziel wirkte. "Druck wirkt" heisst: Restpunkte ohne Schild erreichen ein System (druckSammeln). Haelt der Schild
// (Schild > 0, kein Resttreffer), wirkt kein Druck: auch dann laeuft die Frist ab. Der Verfall gilt ab dem naechsten Zugriff (druckStand liefert den Wert mit Verfall).
function druckConfig(game) { const Z = (game && game.C && game.C.zonen) || {}; return { K: Math.max(1, Number(Z.druckPunkte) || 6), abkling: Number(Z.druckAbkling_s) > 0 ? Number(Z.druckAbkling_s) : 3 }; }
function druckNeu() { return { n: 0, t: null }; }
// Zähler eines Ziels holen oder anlegen: Gegner/Verbündete haben einen (holder = Schiff, key 'druckZ'), die Lerche einen je Sektor (holder = zonen.js akk.sys, key = Sektor).
function druckZaehler(holder, key) { return holder[key] || (holder[key] = druckNeu()); }
// Zaehlerstand mit Verfall: laenger als druckAbkling_s kein Druck -> 0.
function druckStand(game, z) {
  if (z.t != null && game.time - z.t > druckConfig(game).abkling) { z.n = 0; z.t = null; }
  return z.n;
}
// Restpunkte ohne Schild aufnehmen (Druck wirkt, die Frist beginnt neu); true = eine Stufe ist faellig (Zaehler ist dann um druckPunkte kleiner).
function druckSammeln(game, z, punkte) {
  druckStand(game, z);
  z.t = game.time;
  const K = druckConfig(game).K;
  z.n = Math.min(K, z.n + punkte);
  if (z.n < K) return false;
  z.n -= K;
  return true;
}

module.exports = { stufeVon, grundwertVon, naechsteStufe, ART_STURM, fensterDauer, fensterStempeln, imFenster, damagedAnteil, torpedoStufen, druckNeu, druckZaehler, druckStand, druckSammeln };
