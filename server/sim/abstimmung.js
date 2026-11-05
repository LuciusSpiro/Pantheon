'use strict';
// Frequenzabstimmung (SL5 Entschlüsseln der Ops, SCA-01 Scanner am Boden): die reine Rechnung, von beiden Modulen geteilt. Kein Zustand, keine Module.
// Der Zustandsträger `e` hat die Felder f (Frequenz), ziel, zv, zt (Zielband, Geschwindigkeit, Restzeit bis zum Richtungswechsel), dir, t, s, halt.
// Die Reihenfolge und Zahl der rng()-Aufrufe ist Teil des Vertrags (Golden Trace des Ops-Pfads): anlaufStellung 1 Aufruf, schritt 0 oder 2 Aufrufe (nur bei zt <= 0).
//
//   anlaufStellung(e, C, rng)       Zielband zufällig, Frequenz auf der gegenüberliegenden Seite, Zeiger und Drift zurück
//   schritt(e, dt, C, fak, rng)     t, Frequenz (dir), Zielband-Drift mit Reflexion (fak = Verstärkung), Signalstärke s, Fortschritt halt
//   qualitaetAus(C, r)              Anteil sauberer Zeit r -> Qualität 0..3 (Schwellen qSchwellen)
//   schaetzung(e, C)                laufende Qualitätsschätzung (0 vor minLauf)
//   abbruchQualitaet(e, C)          Qualität beim Beenden vor dem Ziel: aus dem Verlauf, höchstens floor(halt · 3), 0 vor minLauf
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function qualitaetAus(C, r) {
  const t = C.qSchwellen;
  return r >= t[2] ? 3 : r >= t[1] ? 2 : r >= t[0] ? 1 : 0;
}

function anlaufStellung(e, C, rng) {
  e.t = 0; e.halt = 0; e.dir = 0;
  e.ziel = C.zielMin + rng() * (C.zielMax - C.zielMin);
  e.f = e.ziel < 0.5 ? C.startF + 0.2 : C.startF - 0.2;   // das Band liegt nie bei der Startstellung
  e.zv = 0; e.zt = 0;
}

function schritt(e, dt, C, fak, rng) {
  e.t += dt;
  e.f = clamp(e.f + e.dir * C.rate * dt, 0, 1);
  e.zt -= dt;
  if (e.zt <= 0) { e.zt = 2 + rng() * 2; e.zv = (rng() * 2 - 1) * C.driftV; }
  e.ziel += e.zv * fak * dt;
  if (e.ziel < C.zielMin) { e.ziel = C.zielMin; e.zv = Math.abs(e.zv); }
  if (e.ziel > C.zielMax) { e.ziel = C.zielMax; e.zv = -Math.abs(e.zv); }
  e.s = clamp(1 - Math.abs(e.f - e.ziel) / C.weitBand, 0, 1);
  e.halt = Math.min(1, e.halt + (dt / C.dauer) * e.s);
}

function schaetzung(e, C) { return e.t >= C.minLauf ? qualitaetAus(C, (e.halt * C.dauer) / e.t) : 0; }
function abbruchQualitaet(e, C) {
  const r = e.t > 0 ? (e.halt * C.dauer) / e.t : 0;
  return Math.min(e.t < C.minLauf ? 0 : qualitaetAus(C, r), Math.floor(e.halt * 3));
}

module.exports = { qualitaetAus, anlaufStellung, schritt, schaetzung, abbruchQualitaet };
