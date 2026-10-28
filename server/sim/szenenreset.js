'use strict';
// SL3 (CONCEPT-SL3 §3.3): Szene von vorn. Stellt die Lerche für eine Wiederholung her (Hülle, Systeme, Reaktor, Schilde, Brände/Lecks),
// räumt Gegner und Geschosse des Raums ab und setzt die Position. Gleiche Regeln wie im Spiel, nur ein harter Neustart der Szene
// (die Kampagne scheitert nie, Szenen dürfen scheitern und wiederholen sich, CONTRACT-SL §1).
//   zuruecksetzen(game, { x?, y?, winkel? })   -> { x, y }
//   reaktorAus(game)                           Prüfung: Reaktor offline (Notfallsprung, Überlast) oder zerstört
const Fracht = require('./fracht.js');

function zuruecksetzen(game, o) {
  const opt = o || {};
  const ship = game.ship; const sp = game.space;
  require('./interior.js').integritaetVoll(game);   // SYS-01 A1a: Integrität aller Systeme auf Maximum (keine Hülle mehr)
  for (const k of Object.keys(ship.systems)) ship.systems[k] = 'ok';
  ship.offline = {}; ship.fragile = {};
  ship.fireList = []; ship.breachList = [];
  require('./reaktortod.js').zuruecksetzen(game);   // SYS-01 A2a: neu aufgestellte Lerche = Ausfallzähler 0, kein Countdown, nicht zerstört
  const rc = ship.reactorCtl;
  if (rc) { rc.state = 'online'; rc.overloadLeft = 0; rc.warned = false; rc.switches = { A: false, B: false }; rc.restartProgress = 0; rc.aloneT = 0; rc.offlineT = 0; rc.needBot = null; }
  const sh = ship.shields;
  if (sh && Array.isArray(sh.alloc)) sh.current = sh.alloc.slice();
  sp.enemies = []; sp.projectiles = sp.projectiles.filter((p) => p.kind === 'ally');
  require('./gegnersprung.js').szeneVerlassen(game);   // SYS-01 C Nacharbeit: Szene von vorn = ohne die Notfallsprung-Regeln der alten Szene
  if (Fracht.state(game).halt) Fracht.beamStop(game, 'szene');
  ship.docked = false;
  ship.vx = 0; ship.vy = 0; ship.speed = 0; ship.turnVel = 0;
  if (ship.jump) { ship.jump.dest = null; ship.jump.charge = 0; ship.jump.ready = false; }
  game.notsprungVon = null; game.notsprungT = -1;
  if (Number.isFinite(opt.x)) ship.x = opt.x;
  if (Number.isFinite(opt.y)) ship.y = opt.y;
  if (Number.isFinite(opt.winkel)) ship.angle = opt.winkel;
  game.oda('Szene von vorn: Schiff instand gesetzt, Gegner abgezogen.', null);
  return { x: ship.x, y: ship.y };
}

function reaktorAus(game) {
  const ship = game.ship; const rc = ship.reactorCtl;
  return !!((rc && rc.state === 'offline') || ship.systems.reactor === 'broken' || ship.systems.reactor === 'offline');
}

module.exports = { zuruecksetzen, reaktorAus };
