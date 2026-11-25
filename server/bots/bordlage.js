'use strict';
// BOT-02 B2: die Lage des Bord-Dienstes, nur lesen (Spielzustand wird nie geschrieben). Eine Quelle fuer die Registry (befehle/bord.js: Annahme bord.*) und den Agenten (mannschaft.js: Automatik, Rueckholung, Laufweg zur Captain-Konsole).
//   untenMenschen(game)           verbundene Menschen im Aussenteam (zone away); Bots am Boden gibt es hier nicht und zaehlen nie
//   allesDowned(game)             mindestens ein Mensch unten und ALLE Menschen unten sind downed (Notrueckholung-Lage)
//   rueckholZiel(game, befehl)    pid fuer transfer.recall: der erste Mensch unten, der downed ist (die Lage), mit Befehl auch ohne Verwundete: der Verwundetste (niedrigster Anteil), sonst der erste
//   rueckholSperre(game)          null oder 'transfer' (Transfer ausgefallen/kaputt, auch nach dem Durchbrennen) | 'abklingzeit' (game.support.recall laeuft)
//   anyAway(game)                 jemand (wie away.anyAway) ist unten: Voraussetzung von captain.support
//   rueckholAutomatik(game)       darf der Bot von selbst zurueckholen? Nur wo das Spiel es nicht selbst regelt: auf v2-Karten (Combat.isV2 und away.active, wie combat.update/updateSquadRecall) laufen Gefangennahme/Ausbruch,
//                                 squadRecall (Wartezeit, Haescher), Statistik und Telemetrie der Notrueckholung; der Bot kaeme ihnen zuvor. Dort holt nur der Befehl bord.rueckholen zurueck
//   captainBelegt(game, bot)      ein anderer Spieler haelt die Captain-Konsole: als Station (Tab, Station.halter) ODER am Ort (o.console 'captain', auch wenn er per Tab eine andere Station aktiv hat: er haelt die Konsole trotzdem, interior.js); der Mensch gewinnt, der Bot geht nicht hin
//   supportSperre(game, kind)     null oder 'abklingzeit' (game.support.sensor/kuppel) | 'wirkung' (Kuppel noch aktiv)
//   gesundheit(game, p)           Anteil 0..1: auf v2-Karten die Schildsegmente (p.shield), sonst p.hp
//   kuppelNoetig(game)            ein aufrechter Mensch unten unter 50 % Gesundheit (die Automatik setzt die Kuppel nur zusammen mit gegnerAktiv, mannschaft.js bordWegWaehlen)
//   landescanOffen(game)          BOT-02 B3: der gewaehlte Landepunkt (game.transferZiel) ist noch nicht gescannt und der Scan laeuft oder ist jetzt moeglich (Landepunkt in Scanreichweite, lpscan.ziele): die EINE Frage fuer den Auto-Scan des Ops-Bots und den Scan-Vorlauf des Bord-Bots
//   beamInReichweite(game)        BOT-02 B3-Nacharbeit: das Schiff liegt in der Beamreichweite des Transferpunkts, den auch away.canBeam nutzt (away.beamSpot: gewaehlter Landepunkt, sonst Standardort); die EINE Quelle fuer Vorlauf, Stopp und Sperre
//   padMenschZuSchnell(game)      BOT-02 B3-Nacharbeit: ein Mensch (verbunden, kein Bot, nicht downed) steht auf einem Schiffspad UND will beamen (haelt E oder hatte in den letzten 20 s einen Beamversuch mit tooFast), das Schiff faehrt schneller als beamMaxSpeed und liegt in Beamreichweite: das Tempo verhindert es (Signal nur fuer den Stopp des Navigations-Bots)
//   gegnerImRaum(enemies)         BOT-02 B3-Nacharbeit: feindliche Gegner im Raum (ohne Relais); die EINE Definition fuer den Steuer-Dienst (Gefecht) und das Ende des Vorlaufs (enemies: game.space.enemies oder S.space.enemies)
//   gegnerAktiv(game)             unten sind Gegner aktiv: ein Trupp ist alarmiert oder eine wache Drohne ist nah (NAH_PX) an einem aufrechten Menschen unten
const Station = require('../sim/station.js');
const Combat = require('../sim/combat.js');
const Lpscan = require('../sim/lpscan.js');
const Away = require('../sim/away.js');

const NAH_PX = 480;   // eine wache Drohne in diesem Abstand (15 Kacheln) zu einem aufrechten Menschen zaehlt als aktiver Gegner, auch ohne Alarm des Trupps
const KUPPEL_SCHWELLE = 0.5;
const aus = (st) => st === 'broken' || st === 'offline';

const untenMenschen = (game) => game.players.filter((p) => p && p.connected && !p.bot && p.zone === 'away');
const aufrecht = (game) => untenMenschen(game).filter((p) => !p.downed);
function allesDowned(game) { const u = untenMenschen(game); return u.length > 0 && u.every((p) => p.downed); }
// combat.js update (aus away.js nur bei isV2 und away.active) ruft updateSquadRecall: dort regelt das Spiel die Rueckholung der liegenden Mannschaft selbst
const rueckholAutomatik = (game) => !(Combat.isV2(game) && game.away && game.away.active);

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
const captainBelegt = (game, bot) => !!Station.halter(game, 'captain', bot) || game.players.some((o) => o && o !== bot && o.connected && o.console === 'captain');
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

// BOT-02 B3: nur lesen. Gescannt (auch Handkarten) oder nicht scannbar (zu weit, ohne Beam-Punkt, angedockt): nicht offen; ein laufender Scan gilt als offen, solange sein Landepunkt noch nicht gescannt ist
function landescanOffen(game) {
  const z = game.transferZiel;
  if (!z || !z.lp || Lpscan.gescannt(game, z.lp)) return false;
  return !!game.lpscan || Lpscan.ziele(game).some((l) => l.id === z.lp);
}

function beamInReichweite(game) {
  const sp = Away.beamSpot(game);
  return !!sp && Math.hypot(game.ship.x - sp.x, game.ship.y - sp.y) <= sp.range;
}
// Beamabsicht eines Menschen auf dem Pad (S1): er haelt E (hold beam) oder hat gerade einen Beamversuch am Tempo scheitern sehen (away.tooFastHint setzt ship.tooFastOdaAt, einmal je 20 s). Nur auf dem Pad zu stehen zaehlt nicht: nach dem Aufstieg steht jeder dort.
const TOOFAST_FENSTER = 20;   // s, wie die Sperre von away.tooFastHint
const beamAbsicht = (game, p) => (!!p.hold && p.hold.kind === 'beam') || (game.ship.tooFastOdaAt != null && game.time - game.ship.tooFastOdaAt < TOOFAST_FENSTER);
function padMenschZuSchnell(game) {
  if (!(game.ship.speed > game.C.ship.beamMaxSpeed)) return false;
  const will = game.players.some((p) => p && p.connected && !p.bot && !p.downed && p.zone === 'ship' && Away.onPad(game, p) && beamAbsicht(game, p));
  return will && beamInReichweite(game);
}
const gegnerImRaum = (enemies) => (enemies || []).some((e) => e && e.kind !== 'relay');

module.exports = { NAH_PX, landescanOffen, beamInReichweite, padMenschZuSchnell, gegnerImRaum, KUPPEL_SCHWELLE, untenMenschen, allesDowned, rueckholZiel, rueckholSperre, rueckholAutomatik, anyAway, captainBelegt, supportSperre, gesundheit, kuppelNoetig, gegnerAktiv };
