'use strict';
// BOT-01 B3: der Lauf der Server-Bots (Action-Layer). Je Game eine Instanz, Zustand NUR dort (WeakMap, nie ein Feld an game, nie Modulzustand der Partie): Agenten (mannschaft.js), Zufallsstrom, letzter Snapshot.
//   tick(game)                      einmal je Spieltick (Ende von tickKern, gerufen ueber safe('botlauf')): Agenten abgleichen, jeden Agenten mit dem zuletzt gebauten Snapshot arbeiten lassen
//   beenden(game)                   Lauf des Games verwerfen (Game.reset: Lobby, Partieende, Neustart)
//   snapshotMerken(game, snap)      Game.snapshot() meldet den fuer den Broadcast ohnehin gebauten Snapshot (nur wenn ein Lauf existiert; sonst nichts)
//   optionenSetzen(game, opts)      Kern-Optionen der Agenten dieses Games (nur Werkzeuge: pilot nose|maneuver)
//   entfernen(game, spieler)        Agent weg (Bot geraeumt, verdraengt, entfernt)
//   wartet(game, spieler)           der Agent weicht einem Menschen (bots/weichen.js)
//   prioritaetLoesen(game, spieler) BOT-01 C2b: die vom Bot gesetzte Prioritaet der Technik zuruecknehmen, bevor ein Mensch die Station hat oder der Platz geraeumt wird (weichen.js, spieler.js)
//   bordBot(game)                   BOT-02 B1: der Bot, der den Bord-Dienst haelt (Technik, sonst Ops, sonst Navigation; null ohne Server-Bots). Rein aus den Spielern, kein Zustand
//   bordAktiv(game, spieler)        BOT-02 B1: der Bord-Dienst dieses Bots laeuft (er ist der Bord-Bot und mindestens ein MENSCH ist im Aussenteam unten, zone away); Bots unten zaehlen nicht
//   agent(game, spieler), agenten(game)   Zugriff (Tests, Werkzeug)
// Snapshot: der Server baut game.snapshot() nur alle net.snapEvery Ticks fuer das Broadcast (er ist fuer alle Spieler gleich, kein snapshot(forPlayer)). Der Lauf nimmt diesen und baut keinen zweiten (snapshot() hat Seiteneffekte:
// Zaehler und Sendeschluessel). Die Agenten arbeiten jeden Tick mit dem letzten Stand (wie die Testbots, nur ein Tick aelter). Ohne Bot-Spieler in einer laufenden Partie gibt es keinen Lauf: tick() kehrt nach einer Schleife ueber players zurueck.
// Lebenszyklus: Lobby und Partieende (phase != play) kennen keine Agenten; ein neuer Start (neue runId) legt sie neu an; geraeumte/entfernte Bots verlieren ihren Agenten beim naechsten Tick (und sofort ueber entfernen()).
// Zufall: je Agent ein eigener Strom aus Spielseed und Platz (makeRng), nie der Strom der Simulation (game.rng) und nie der Modulhalter des Kerns.
const { makeRng } = require('../util.js');
const { BotMannschaft, ROLLEN } = require('./mannschaft.js');

const LAEUFE = new WeakMap();   // game -> Lauf
const OPTIONEN = new WeakMap();   // game -> Kern-Optionen der Agenten (Werkzeuge: pilot), vor dem ersten Tick gesetzt

const istServerBot = (p) => !!(p && p.bot && ROLLEN.includes(p.rolle) && p.connected && p.conn && p.conn.player === p);
const hatServerBots = (game) => game.players.some(istServerBot);

// BOT-02 B1: Bord-Dienst = Zusatzdienst eines vorhandenen Bots (keine Lobby-Rolle, kein Slot). Zuweisung: Technik-Bot, sonst Ops-Bot, sonst Navigations-Bot (der Navigations-Bot bleibt am Steuer, solange es einen anderen gibt).
const BORD_REIHE = ['technik', 'ops', 'navigation'];
function bordBot(game) {
  for (const rolle of BORD_REIHE) { const b = game.players.find((p) => istServerBot(p) && p.rolle === rolle); if (b) return b; }
  return null;
}
const menschUnten = (game) => game.players.some((p) => p && p.connected && !p.bot && p.zone === 'away');
function bordAktiv(game, spieler) { return !!spieler && game.phase === 'play' && bordBot(game) === spieler && menschUnten(game); }

class Lauf {
  constructor(game) {
    this.game = game; this.runId = game.runId; this.agentenMap = new Map(); this.snap = null; this.cache = null;
  }
  // BOT-01 C2b: die vom Bot gesetzte Prioritaet der Technik zuruecknehmen (nur wenn ship.priority noch der gehaltene Wert ist; eine Prioritaet des Menschen bleibt). true = zurueckgenommen
  prioritaetLoesen(wert) {
    const ship = this.game.ship;
    if (!ship || ship.priority !== wert) return false;
    ship.priority = null;
    return true;
  }
  bordAktiv(spieler) { return bordAktiv(this.game, spieler); }   // BOT-02 B1: fuer den Agenten (mannschaft.js laedt dieses Modul nicht, Zirkelbezug)
  rngFuer(spieler) { return makeRng((((this.game.seed >>> 0) * 7919 + 311 + this.game.players.indexOf(spieler) * 101) >>> 0)); }
  liste() { return this.cache || (this.cache = Array.from(this.agentenMap.values())); }
  anlegen(spieler) { this.agentenMap.set(spieler.id, new BotMannschaft(this.game, spieler, this, OPTIONEN.get(this.game))); this.cache = null; }
  loeschen(id) { if (this.agentenMap.delete(id)) this.cache = null; }
  leeren() { this.agentenMap.clear(); this.cache = null; }
  // Agenten und Bot-Spieler in Einklang bringen (neue Partie, neuer Bot, Bot weg)
  abgleichen() {
    const g = this.game;
    if (g.runId !== this.runId) { this.leeren(); this.runId = g.runId; this.snap = null; }
    for (const [id, a] of this.agentenMap) if (g.players.indexOf(a.spieler) < 0 || !istServerBot(a.spieler) || a.rolleBot !== a.spieler.rolle || a.conn !== a.spieler.conn) this.loeschen(id);
    for (const p of g.players) if (istServerBot(p) && !this.agentenMap.has(p.id)) this.anlegen(p);
  }
  schritt() {
    const S = this.snap;
    if (!S) return;
    for (const a of this.liste()) this.game.safe('botlauf:' + a.rolleBot, () => a.tick(S));
  }
}

function tick(game) {
  let lauf = LAEUFE.get(game);
  if (game.phase !== 'play' || !hatServerBots(game)) { if (lauf) LAEUFE.delete(game); return; }
  if (!lauf) { lauf = new Lauf(game); LAEUFE.set(game, lauf); }
  lauf.abgleichen();
  lauf.schritt();
}
function beenden(game) { LAEUFE.delete(game); }   // reset(): Partieende, Lobby, Neustart
function snapshotMerken(game, snap) { const lauf = LAEUFE.get(game); if (lauf) lauf.snap = snap; }
function optionenSetzen(game, opts) { OPTIONEN.set(game, Object.assign({}, opts)); }   // Werkzeuge (tools/sim-headless.js arena --pilot)
function entfernen(game, spieler) { const lauf = LAEUFE.get(game); if (lauf && spieler) lauf.loeschen(spieler.id); }
function wartet(game, spieler) { const a = agent(game, spieler); if (a) a.weicht(); }
function prioritaetLoesen(game, spieler) { const a = agent(game, spieler); return a ? a.prioritaetZuruecknehmen() : false; }
function agent(game, spieler) { const lauf = LAEUFE.get(game); return lauf && spieler ? lauf.agentenMap.get(spieler.id) || null : null; }
function agenten(game) { const lauf = LAEUFE.get(game); return lauf ? lauf.liste().slice() : []; }

module.exports = { tick, beenden, snapshotMerken, optionenSetzen, entfernen, wartet, prioritaetLoesen, agent, agenten, istServerBot, bordBot, bordAktiv };
