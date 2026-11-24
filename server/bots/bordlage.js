'use strict';
// BOT-02 B2: die Lage des Bord-Dienstes, nur lesen (Spielzustand wird nie geschrieben). Eine Quelle fuer die Registry (befehle/bord.js: Annahme bord.*) und den Agenten (mannschaft.js: Automatik, Rueckholung, Laufweg zur Captain-Konsole).
//   untenMenschen(game)           verbundene Menschen im Aussenteam (zone away); Bots am Boden gibt es hier nicht und zaehlen nie
//   allesDowned(game)             mindestens ein Mensch unten und ALLE Menschen unten sind downed (Notrueckholung-Lage)
//   rueckholZiel(game, befehl)    pid fuer transfer.recall: der erste Mensch unten, der downed ist (die Lage), mit Befehl auch ohne Verwundete: der Verwundetste (niedrigster Anteil), sonst der erste
//   rueckholSperre(game)          null oder 'transfer' (Transfer ausgefallen/kaputt, auch nach dem Durchbrennen) | 'abklingzeit' (game.support.recall laeuft)
//   anyAway(game)                 jemand (wie away.anyAway) ist unten: Voraussetzung von captain.support
//   captainBelegt(game, bot)      ein anderer Spieler haelt die Captain-Station (Ort oder Tab): der Mensch gewinnt, der Bot geht nicht hin
//   supportSperre(game, kind)     null oder 'abklingzeit' (game.support.sensor/kuppel) | 'wirkung' (Kuppel noch aktiv)
//   gesundheit(game, p)           Anteil 0..1: auf v2-Karten die Schildsegmente (p.shield), sonst p.hp
//   kuppelNoetig(game)            ein aufrechter Mensch unten unter 50 % Gesundheit
//   gegnerAktiv(game)             unten sind Gegner aktiv: ein Trupp ist alarmiert oder eine wache Drohne ist nah (NAH_PX) an einem aufrechten Menschen unten
const Station = require('../sim/station.js');
const Combat = require('../sim/combat.js');

const NAH_PX = 480;   // eine wache Drohne in diesem Abstand (15 Kacheln) zu einem aufrechten Menschen zaehlt als aktiver Gegner, auch ohne Alarm des Trupps
const KUPPEL_SCHWELLE = 0.5;
const aus = (st) => st === 'broken' || st === 'offline';

const untenMenschen = (game) => game.players.filter((p) => p && p.connected && !p.bot && p.zone === 'away');
const aufrecht = (game) => untenMenschen(game).filter((p) => !p.downed);
function allesDowned(game) { const u = untenMenschen(game); return u.length > 0 && u.every((p) => p.downed); }

function gesundheit(game, p) {
  if (Combat.isV2(game) && p.shield && p.shield.max > 0) return p.shield.seg / p.shield.max;
  return game.C.player.hp > 0 ? p.hp / game.C.player.hp : 0;
}
// mit Befehl (Captain entscheidet): zuerst die Bewusstlosen, dann der Verwundetste; ohne Befehl wird die Lage vorausgesetzt (alle downed): der erste in Spielerreihenfolge
function rueckholZiel(game, befehl) {
  const u = untenMenschen(game);
  if (!u.length) return null;
  const down = u.filter((p) => p.downed);
  if (down.length) return down[0].id;
  if (!befehl) return null;
  return u.slice().sort((a, b) => gesundheit(game, a) - gesundheit(game, b))[0].id;
}
function rueckholSperre(game) {
  if (aus(game.ship.systems.transfer)) return 'transfer';
  if (game.support.recall > 0) return 'abklingzeit';
  return null;
}

const anyAway = (game) => game.players.some((p) => p && p.zone === 'away');
const captainBelegt = (game, bot) => !!Station.halter(game, 'captain', bot);
function supportSperre(game, kind) {
  if (!game.support || !(kind === 'sensor' || kind === 'kuppel')) return 'abklingzeit';
  if (game.support[kind] > 0) return 'abklingzeit';
  if (kind === 'kuppel' && game.away.kuppelHp > 0 && game.time < game.away.kuppelUntil) return 'wirkung';
  return null;
}

const kuppelNoetig = (game) => aufrecht(game).some((p) => gesundheit(game, p) < KUPPEL_SCHWELLE);
function gegnerAktiv(game) {
  const aw = game.away; const stehend = aufrecht(game);
  if (!aw || !stehend.length) return false;
  const lebend = (aw.drones || []).filter((e) => e && e.alive && !e.asleep);
  if (!lebend.length) return false;
  const alarm = Object.values(aw.squads || {}).some((s) => s && s.alert && lebend.some((e) => e.squad === s.name));
  return alarm || lebend.some((e) => stehend.some((p) => Math.hypot(e.x - p.x, e.y - p.y) <= NAH_PX));
}

module.exports = { NAH_PX, KUPPEL_SCHWELLE, untenMenschen, allesDowned, rueckholZiel, rueckholSperre, anyAway, captainBelegt, supportSperre, gesundheit, kuppelNoetig, gegnerAktiv };
