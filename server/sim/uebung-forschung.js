'use strict';
// UEB-01 A1: Übungsplatz „Forschungsstation“ (Lobby-Modus arena_forschung). Das Regiebuch sl_forschung (Sund, Helix) startet direkt
// im Schritt gravimetrie, ohne Kampagnenkette und ohne Weltstand-Persistenz (g.weltstand ist hier nie persistent).
//   start(game)                      Ausgangszustand herstellen, Buch starten, Schritt gravimetrie
//   update(game)                     Tick: Szenenende (Schritt abliefern_anflug) und Neustart nach Verlust
//   neustart(game)                   Szene von vorn: Ausgangszustand erneut herstellen, Buch neu starten
//   forschungAusgangszustand(game)   Schiff am Helix, Crew an Bord, Zonen/Landepunkt/Monster/Pulte wie am Anfang (wiederholbar)
// Das Buch selbst bleibt unverändert. Szenenende = completeMission('erfolg') beim Erreichen von abliefern_anflug (kein Rückflug,
// keine Marken, kein Flag). Verlust: erst wenn die Engine das Team hochgeholt hat, sonst nach NEUSTART_MAX_WARTEN s trotzdem.
const Locations = require('../../shared/locations.js');
const interior = require('./interior.js');
const Monster = require('./monster.js');
const Zonen = require('./zonen.js');

const KIND = 'arena_forschung';
const BUCH = 'sl_forschung';
const ORT = 'helix';
const START_SCHRITT = 'gravimetrie';
const ENDE_SCHRITT = 'abliefern_anflug';
const LP_STATION = 'helix.station';
const NEUSTART_MAX_WARTEN = 30;   // s nach dem Verlust; Notrückholung der Engine dauert ca. 10 s

function arena() { return require('./arena.js'); }   // lazy: arena.js bindet dieses Modul beim Start ein
function stand(game) { return game.arena && game.arena.forschung; }

// Landepunkt der Station wieder ungescannt (Scan gehört zum Anfang der Szene)
function landepunktZuruecksetzen(game) {
  const ex = game.explore; if (!ex) return;
  let geaendert = ex.lpScan.delete(LP_STATION);
  if (LP_STATION in ex.mapsKnown && ex.mapsKnown[LP_STATION]) { ex.mapsKnown[LP_STATION] = false; geaendert = true; }
  if (geaendert) ex.version++;
}

// Der Ausgangszustand der Szene, eine Funktion für Start und Neustart. Wiederholbar: zweimal aufgerufen ergibt derselbe Zustand.
function forschungAusgangszustand(game) {
  const A = arena();
  for (const p of game.players) {
    if (p.downed) interior.revivePlayer(game, p);
    p.hp = game.C.player.hp;
    if (p.zone === 'away') interior.placeOnShipPad(game, p);
  }
  game.debugGoto(ORT, false);   // Schiff in die Szene Helix (setzt am Boden stehende Spieler an Bord), kein Anflug-Sprung
  const gv = Locations.get(ORT).scene.gravimetrie;
  const ship = game.ship;
  ship.x = gv.start.x; ship.y = gv.start.y; ship.angle = 0;
  ship.vx = 0; ship.vy = 0; ship.speed = 0; ship.turnVel = 0;
  if (ship.helm) { ship.helm.stage = 1; ship.helm.turn = 0; }
  A.repairShip(game);
  game.zonenSim = Zonen.neu();   // Zonen unbekannt, Gruppen wieder an, Zähler leer
  landepunktZuruecksetzen(game);
  Monster.zuruecksetzen(game);   // Monster und Pulte neu (einrichten() beim nächsten Landen)
  A.placeOnBridge(game);
}

function buchStarten(game) {
  const m = game.mission;
  m.startMission(BUCH);
  if (m.activeId !== BUCH) { game.countError('uebung-forschung', new Error('Buch ' + BUCH + ' startet nicht')); return false; }
  const err = m.forceStep(BUCH, START_SCHRITT);
  if (err) { game.countError('uebung-forschung', new Error(err)); return false; }
  return true;
}

function start(game) {
  const m = game.mission;
  const vorher = m.pending.length;
  m.startCampaign({ tutorial: false });
  m.pending.splice(vorher);   // Kampagnen-Gerücht gehört nicht in die Übung
  forschungAusgangszustand(game);
  game.arena = { kind: KIND, forschung: { start: game.time, versuch: 1, verlustAb: null, gemeldet: false } };
  buchStarten(game);
  game.oda('Übung Forschungsstation: Gravimetrie am Helix bis zum Finale. Kein Rückflug, kein Lohn.', null);
  game.log('Übungsplatz Forschungsstation gestartet.');
}

function neustart(game) {
  const F = stand(game);
  forschungAusgangszustand(game);
  F.versuch++; F.verlustAb = null;
  buchStarten(game);
  game.oda('Übung Forschungsstation: Szene von vorn.', null);
  game.log('Übungsplatz Forschungsstation: Neustart (Versuch ' + F.versuch + ').');
}

function szeneDurch(game) {
  const F = stand(game);
  if (F.gemeldet) return;
  F.gemeldet = true;
  game.oda('Übung Forschungsstation: Szene durch. Esc → „Partie beenden“ führt zurück in die Lobby.', null);
}

function update(game) {
  const F = stand(game);
  if (!F || game.phase !== 'play') return;
  const m = game.mission;
  const ms = m.missions[BUCH];
  if (ms && ms.state === 'done') {
    if (ms.ausgang === 'verloren') {
      if (F.verlustAb == null) F.verlustAb = game.time;
      const obenAlle = game.players.every((p) => p.zone !== 'away' && !p.downed);
      if (obenAlle || game.time - F.verlustAb >= NEUSTART_MAX_WARTEN) neustart(game);
    } else szeneDurch(game);
    return;
  }
  if (m.activeId === BUCH && m.step && m.step.id === ENDE_SCHRITT) {
    m.completeMission('erfolg');
    szeneDurch(game);
  }
}

module.exports = { KIND, BUCH, START_SCHRITT, ENDE_SCHRITT, start, update, neustart, forschungAusgangszustand };
