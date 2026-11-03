'use strict';
// SYS-01 C1a-2 „Der Tod der Gegner“ (Kai, 2026-10-26, Systemmodell Zonen „Tod: Reaktor“):
//   systemZerstoert(game, e, id)  – ein System des Gegners ist eben zerstört geworden (space.trefferSystem, Testhilfe, Debug-Befehl).
//                                   Reaktor: Countdown startet wie bei der Lerche (reaktortod.dauer, dieselbe Formel, n = Ausfälle dieses Gegners).
//                                   Schildgenerator bei einem Entern-Ziel: Prise (Entern.onSchildgeneratorZero) und Abbruch eines laufenden Countdowns.
//                                   Rückgabe true = der Gegner ist jetzt treibend (der Aufrufer bricht ab).
//   tick(game, e, dt)             – Countdown mit dt (updateEnemies, auch Verfolgung und gestellte Gegner). Ist der Reaktor nicht mehr zerstört
//                                   (Reparatur, C2), endet der Countdown, der Zähler bleibt. Rückgabe true = abgelaufen: der Aufrufer stirbt (space.enemyDown).
//   treffer(game, e)              – GEG-01 B: jeder Treffer halbiert die Restzeit des laufenden Countdowns (ohne Mindestzeit; unter reaktorTod.restGrenze Rest 0 = Tod im nächsten tick).
//   sofort(e)                     – Tod ohne Countdown (Torpedo gegen einen Gegner aus systemModell.torpedoSofortTod.<klasse>, Config, bei Schild 0): alle Systeme zerstört, kein Kapern.
//   brechen(game, e, id)          – Testhilfe und Debug: System auf zerstört setzen und den Übergang wie im Spiel auswerten (wie systemZerstoert).
//   restZehntel(e)                – Restzeit des Countdowns in Zehntelsekunden für das anvisierte Ziel (-1 kein Countdown).
// Zustand je Gegner kompakt: e.rt = { n, rest } (n = Reaktorausfälle seit Erscheinen, rest = Restzeit in s, null = kein Countdown). Nicht im Weltstand.
// Kapern (Prise) ist ausgeschlossen, wenn der Gegner über den Reaktor stirbt (Countdown abgelaufen oder Sofort-Tod).
// Geltungsbereich (Kai-Entscheidung, C1a-2 Nacharbeit):
//   - Der Gegner-Countdown gilt IMMER, auch im Tutorial, in Übungen (mission.isDrill) und im Gottmodus: kein Gate wie bei der Lerche (reaktortod.gilt). Nur der Lerchen-Countdown hat das Gate.
//   - Gegner ohne Systemmodell (Störrelais 'relay') bleiben, wie sie sind: kein Reaktor, kein Countdown, kein Kapern; sie sterben bei hp = 0 über space.enemyDown.
//   - Die Wirkung des Sofort-Tods (Klassenliste) steht in shared/config.js (systemModell.torpedoSofortTod.<klasse>, Wahrheitswerte), live per `tune systemModell.torpedoSofortTod.<klasse> on|off`.
const Gsys = require('./gegnersystem.js');
const reaktortod = require('./reaktortod.js');
const Entern = require('./entern.js');

function zaehler(e) { if (!e.rt) e.rt = { n: 0, rest: null }; return e.rt; }
function reaktorZustand(e) { const r = Gsys.idVon(e, 'reaktor'); return r ? e.sys[r].z : null; }

// Der Reaktor ist eben zerstört geworden: Ausfallzähler +1, Countdown mit der Formel der Lerche
function reaktorZerstoert(game, e) {
  const z = zaehler(e);
  z.n += 1;
  z.rest = reaktortod.dauer(game, z.n);
}

function systemZerstoert(game, e, id) {
  const art = Gsys.artVon(e, id);
  if (art === 'schildgenerator') {
    if (Entern.onSchildgeneratorZero(game, e)) { abbrechen(e); return true; }
    return false;
  }
  if (art === 'reaktor') reaktorZerstoert(game, e);
  return false;
}

function brechen(game, e, id) {
  if (!e.sys || !e.sys[id]) return false;
  e.sys[id].i = 0; e.sys[id].z = 'broken';
  e.hp = Gsys.summe(e);
  return systemZerstoert(game, e, id);
}

function tick(game, e, dt) {
  const z = e.rt;
  if (!z || z.rest == null) return false;
  if (reaktorZustand(e) !== 'broken') { z.rest = null; return false; }   // gerettet: Countdown aus, der Zähler bleibt
  z.rest -= dt;
  if (z.rest > 0) return false;
  z.rest = null;
  return true;
}

// GEG-01 B: ein Waffentreffer auf den Gegner (Aufruf am Eingang von space.damageEnemy): läuft der Countdown, halbiert er die Restzeit, ohne Mindestzeit. Unter reaktorTod.restGrenze
// ist die Restzeit 0: tick() meldet im nächsten Takt den Tod (wie bei Ablauf, enemyDown). Der Treffer, der den Reaktor erst zerstört, läuft VOR dem Countdown und halbiert nichts.
function treffer(game, e) {
  const z = e.rt;
  if (!z || z.rest == null || reaktorZustand(e) !== 'broken') return;
  z.rest /= 2;
  if (z.rest < game.C.reaktorTod.restGrenze) z.rest = 0;
}

function sofort(e) {
  if (Gsys.hat(e)) for (const id of Gsys.ids(e)) { e.sys[id].i = 0; e.sys[id].z = 'broken'; }
  e.hp = 0;
  abbrechen(e);
}

function abbrechen(e) { if (e.rt) e.rt.rest = null; }

function restZehntel(e) { const z = e && e.rt; return z && z.rest != null ? Math.max(0, Math.round(z.rest * 10)) : -1; }

module.exports = { systemZerstoert, tick, treffer, sofort, brechen, restZehntel, abbrechen };
