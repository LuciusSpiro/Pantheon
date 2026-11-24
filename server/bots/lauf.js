'use strict';
// BOT-01 B3: der Lauf der Server-Bots (Action-Layer). Je Game eine Instanz, Zustand NUR dort (WeakMap, nie ein Feld an game, nie Modulzustand der Partie): Agenten (mannschaft.js), Zufallsstrom, letzter Snapshot.
//   tick(game)                      einmal je Spieltick (Ende von tickKern, gerufen ueber safe('botlauf')): Agenten abgleichen, jeden Agenten mit dem zuletzt gebauten Snapshot arbeiten lassen
//   beenden(game)                   Lauf des Games verwerfen (Game.reset: Lobby, Partieende, Neustart)
//   snapshotMerken(game, snap)      Game.snapshot() meldet den fuer den Broadcast ohnehin gebauten Snapshot (nur wenn ein Lauf existiert; sonst nichts)
//   optionenSetzen(game, opts)      Kern-Optionen der Agenten dieses Games (nur Werkzeuge: pilot nose|maneuver)
//   entfernen(game, spieler)        Agent weg (Bot geraeumt, verdraengt, entfernt)
//   wartet(game, spieler)           der Agent weicht einem Menschen (bots/weichen.js)
//   prioritaetLoesen(game, spieler) BOT-01 C2b: die vom Bot gesetzte Prioritaet der Technik zuruecknehmen, bevor ein Mensch die Station hat oder der Platz geraeumt wird (weichen.js, spieler.js)
//   bordBot(game)                   BOT-02 B1: der Bot, der den Bord-Dienst haelt (Technik, sonst Ops; NIE der Navigations-Bot: sein Notsprung geht von der Steuer aus und ist wichtiger als Rueckholung und Ansagen; nur Navigation = kein Bord-Bot, dann regelt die Automatik des Spiels die Rueckholung; bewusstlose und unten stehende Bots uebersprungen; null ohne Server-Bots). Rein aus den Spielern,
//                                   nur der Haelter wird waehrend eines Dienstes im Lauf gemerkt (Hysterese: ein wieder aufstehender Bot uebernimmt nicht zurueck, solange der Haelter gueltig ist)
//   bordAktiv(game, spieler)        BOT-02 B1: der Bord-Dienst dieses Bots ist faellig (er ist der Bord-Bot und ein MENSCH ist unten (zone away), beamt gerade runter oder der Vorlauf laeuft (B3)); Bots unten zaehlen nicht
//   vorlaufLaeuft(game)             BOT-02 B3: der Vorlauf vor dem Beamen laeuft: ein Landepunkt ist gewaehlt (game.transferZiel), mindestens ein Mensch (nicht bewusstlos) ist an Bord, keiner unten, keine feindlichen Gegner im Raum, kein Reaktor-Countdown
//                                   UND das Schiff liegt in Beamreichweite (bordlage.js beamInReichweite; ausserhalb ist der Vorlauf nur vorgemerkt: kein Stopp, keine Sperre, der Bord-Bot bleibt an der Station, die Frist steht). Er endet, wenn der Landepunkt weg ist,
//                                   ein Mensch runtergebeamt ist (unten), Gegner oder Countdown da sind, kein Mensch an Bord ist oder VORLAUF_FRIST (in Reichweite) abgelaufen ist. Ein Mensch, der den Beam abbricht, beendet ihn NICHT. Ein Landepunkt, dessen Vorlauf endete, beginnt keinen zweiten; ein neu gewaehlter schon. Zustand nur im Lauf, nie am Spiel. Zaehlt als Dienstbedarf
//   beamVorbereitet(game)           BOT-02 B3: Vorlauf ODER ein Mensch beamt gerade runter (Navigations-Bot am Steuer: Schiff stoppen und halten, wie bei Aussenteam unten; Sperre der Navigationsbefehle)
//   stoppNoetig(game)               BOT-02 B3-Nacharbeit: beamVorbereitet ODER ein Mensch steht auf einem Schiffspad und das Schiff ist in Reichweite zu schnell (bordlage.js padMenschZuSchnell): NUR der Stopp des Navigations-Bots, nie Vorlauf, nie Bord-Dienst
//   dienstLaeuft(game, spieler)     BOT-02 B1: bordAktiv, kein verbundener Mensch an der Transfer-Konsole (Mensch gewinnt, der Dienst ruht) : die EINE Quelle fuer Agent, Wachposten und Station-Automatik
//   bordDienstHaelt(game)           BOT-02 B4: ein Bord-Bot haelt den Dienst wirklich (bordBot + dienstLaeuft; ueber weichen.js bordBotHaelt fuer away.js: die ODA schweigt, der Bot sagt die Codefolge an)
//   stationVertreten(game, kind)    BOT-02 B1: der Bord-Bot haelt den Dienst wirklich (dienstLaeuft) und die Station seiner Rolle ist kind (helm, weapons, technik): die Station ist vertreten, nicht verwaist (station.js ueber weichen.js)
//   agent(game, spieler), agenten(game)   Zugriff (Tests, Werkzeug)
// Snapshot: der Server baut game.snapshot() nur alle net.snapEvery Ticks fuer das Broadcast (er ist fuer alle Spieler gleich, kein snapshot(forPlayer)). Der Lauf nimmt diesen und baut keinen zweiten (snapshot() hat Seiteneffekte:
// Zaehler und Sendeschluessel). Die Agenten arbeiten jeden Tick mit dem letzten Stand (wie die Testbots, nur ein Tick aelter). Ohne Bot-Spieler in einer laufenden Partie gibt es keinen Lauf: tick() kehrt nach einer Schleife ueber players zurueck.
// Lebenszyklus: Lobby und Partieende (phase != play) kennen keine Agenten; ein neuer Start (neue runId) legt sie neu an; geraeumte/entfernte Bots verlieren ihren Agenten beim naechsten Tick (und sofort ueber entfernen()).
// Zufall: je Agent ein eigener Strom aus Spielseed und Platz (makeRng), nie der Strom der Simulation (game.rng) und nie der Modulhalter des Kerns.
const { makeRng } = require('../util.js');
const { BotMannschaft, ROLLEN, STATION } = require('./mannschaft.js');
const Lage = require('./bordlage.js');

const LAEUFE = new WeakMap();   // game -> Lauf
const OPTIONEN = new WeakMap();   // game -> Kern-Optionen der Agenten (Werkzeuge: pilot), vor dem ersten Tick gesetzt

const istServerBot = (p) => !!(p && p.bot && ROLLEN.includes(p.rolle) && p.connected && p.conn && p.conn.player === p);
const hatServerBots = (game) => game.players.some(istServerBot);

// BOT-02 B1: Bord-Dienst = Zusatzdienst eines vorhandenen Bots (keine Lobby-Rolle, kein Slot). Zuweisung: Technik-Bot, sonst Ops-Bot. Der Navigations-Bot uebernimmt NIE den Bord-Dienst (Entscheidung des Leiters, Nacharbeit 2): der Notsprung ist seine Aufgabe und nur von der Steuer aus erreichbar (der Weg Transfer-Steuer dauert 10 s,
// die Countdowns 10/5/2,5 s sind von dort nicht zu schaffen); die Lerche zu retten geht vor Rueckholung und Ansagen. Gibt es nur den Navigations-Bot, gibt es keinen Bord-Dienst (bord.* antwortet kein_bot, keine Ansagen, die ODA-Codehilfe funkt wie ohne Bord-Bot);
// die Rueckholung regelt dann die Automatik des Spiels (v1 Aufwachen nach 15 s, v2 squadRecall). Bewusste Einschraenkung.
const BORD_REIHE = ['technik', 'ops'];
const menschUnten = (game) => game.players.some((p) => p && p.connected && !p.bot && p.zone === 'away');
// B-5: der Dienst beginnt schon beim Beamen, damit der Bot beim Landen am Transfer steht. Ausloeser ohne Spielzustand zu aendern: ein Mensch haelt E auf dem Schiffspad (p.hold beam, Richtung down; interior selfbeam)
// oder die Konsole hat den Beamvorgang gestartet (ship.beaming, Richtung down; away.consoleBeam loescht dabei p.hold). Bricht der Mensch ab, ist beides weg und der Dienst endet.
const menschBeamtRunter = (game) => {
  const b = game.ship && game.ship.beaming;
  if (b && b.dir === 'down' && b.pids.some((id) => { const p = game.playerById(id); return !!p && p.connected && !p.bot; })) return true;
  return game.players.some((p) => p && p.connected && !p.bot && p.zone === 'ship' && p.hold && p.hold.kind === 'beam' && p.hold.dir === 'down');
};
// BOT-02 B3: Vorlauf vor dem Beamen. Ein gewaehlter Landepunkt (game.transferZiel, wird bei jeder Wahl ein neues Objekt) und ein Mensch an Bord: der Bord-Bot geht schon jetzt zum Transfer (der Beam dauert nur ca. 3 s, der Weg ist laenger).
// Ohne Beam darf er nicht ewig laufen: nach VORLAUF_FRIST s endet er, der Bot geht an seine Station; dasselbe Ziel beginnt keinen zweiten Vorlauf (vorlaufZiel), erst eine neue Wahl. Der Zustand steht nur im Lauf (Lauf.vorlaufPruefen, je Tick).
// 60 s: Wahl am Transfer, Weg zum Pad (ca. 4 s) und E-Halten (ca. 4,5 s) brauchen zusammen unter 15 s; eine laengere Frist legte im Gefecht-Umfeld und beim zoegernden Menschen Schiff und Bord-Bot zu lange still (Review V-4). Die Frist laeuft nur in Beamreichweite (ausserhalb ist der Vorlauf nur vorgemerkt)
const VORLAUF_FRIST = 60;   // s: spaetestens dann (ab Eintritt in die Beamreichweite, nie ohne Mensch an Bord) endet der Vorlauf ohne Beam
// ein Mensch an Bord, der etwas tun kann (bewusstlos zaehlt nicht: er haelt den Vorlauf nicht am Leben, Review V-6)
const menschAnBord = (game) => game.players.some((p) => p && p.connected && !p.bot && !p.downed && p.zone === 'ship');
const vorlaufLaeuft = (game) => { const lauf = LAEUFE.get(game); return !!lauf && game.phase === 'play' && !!lauf.vorlauf && lauf.vorlauf.ziel === game.transferZiel && Lage.beamInReichweite(game); };
const beamVorbereitet = (game) => vorlaufLaeuft(game) || menschBeamtRunter(game);
const stoppNoetig = (game) => beamVorbereitet(game) || Lage.padMenschZuSchnell(game);
const dienstBedarf = (game) => game.phase === 'play' && (menschUnten(game) || menschBeamtRunter(game) || vorlaufLaeuft(game));
const menschHaeltTransfer = (game) => game.players.some((o) => o && !o.bot && o.connected && o.console === 'transfer');
// ein Bot kann den Dienst halten: Server-Bot, bei Bewusstsein, an Bord (B-3)
const dienstFaehig = (p) => istServerBot(p) && !p.downed && p.zone === 'ship';
function bordBot(game) {
  const lauf = LAEUFE.get(game);
  const h = lauf && lauf.bordHalter;
  if (h && game.players.includes(h) && dienstFaehig(h)) return h;   // Hysterese: wer den Dienst haelt, behaelt ihn (kein Wechsel beim Aufstehen eines Bots mit hoeherem Rang)
  let b = null;
  for (const rolle of BORD_REIHE) { b = game.players.find((p) => dienstFaehig(p) && p.rolle === rolle) || null; if (b) break; }
  if (lauf) lauf.bordHalter = b && dienstBedarf(game) ? b : null;
  return b;
}
function bordAktiv(game, spieler) { return !!spieler && game.phase === 'play' && bordBot(game) === spieler && dienstBedarf(game); }
function dienstLaeuft(game, spieler) { return bordAktiv(game, spieler) && !menschHaeltTransfer(game); }
function bordDienstHaelt(game) { const b = bordBot(game); return !!b && dienstLaeuft(game, b); }   // BOT-02 B4: irgendein Bord-Bot haelt den Dienst (weichen.js bordBotHaelt; away.js: die ODA schweigt)
function stationVertreten(game, kind) {
  const b = bordBot(game);
  return !!b && STATION[b.rolle] === kind && dienstLaeuft(game, b);
}

class Lauf {
  constructor(game) {
    this.game = game; this.runId = game.runId; this.agentenMap = new Map(); this.snap = null; this.cache = null;
    this.bordHalter = null;   // BOT-02 B1: der Bot, der den laufenden Dienst haelt (Hysterese, nur waehrend des Dienstes)
    this.vorlauf = null; this.vorlaufZiel = null;   // BOT-02 B3: { ziel, seit } waehrend des Vorlaufs; das Ziel (game.transferZiel), dessen Vorlauf zuletzt begann (ein Ziel beginnt ihn nur einmal)
  }
  // BOT-01 C2b: die vom Bot gesetzte Prioritaet der Technik zuruecknehmen (nur wenn ship.priority noch der gehaltene Wert ist; eine Prioritaet des Menschen bleibt). true = zurueckgenommen
  prioritaetLoesen(wert) {
    const ship = this.game.ship;
    if (!ship || ship.priority !== wert) return false;
    ship.priority = null;
    return true;
  }
  // BOT-02 B3: den Vorlauf nachfuehren (einmal je Tick vor den Agenten, nur Lauf-Zustand). Beginn: Landepunkt gewaehlt, Mensch an Bord, niemand unten oder beamend, keine Gegner, kein Reaktor-Countdown, dieser Landepunkt noch nicht dran gewesen.
  // Beginn nur, wenn ein Mensch an der Transfer-Konsole steht, wenn der neue Landepunkt zum ersten Mal auffaellt (Spielpfad transfer.ziel); setzt das Spiel selbst ein Ziel (Szenenstart, Arena), gibt es keinen Vorlauf.
  // Bekannte Grenze (Review V-7): setzt das Spiel ein Ziel, waehrend ein Mensch zufaellig an der Transfer-Konsole steht, sieht der Lauf das als Wahl des Menschen (Heuristik: gewaehlt hat ihn ein Mensch an der Konsole); es gibt dann einen unnoetigen Vorlauf (endet mit der Frist).
  // Ende: Landepunkt weg oder neu gewaehlt, Mensch unten (dann gilt der Dienst wie bisher), Gegner oder Reaktor-Countdown, kein Mensch an Bord, Frist; das Ziel bleibt als erledigt vermerkt. Ein abgebrochener Beam (E zu frueh losgelassen) beendet ihn nicht: runtergebeamt ist nur beim Beginn ein Ausschluss.
  // Ausserhalb der Beamreichweite bleibt er vorgemerkt (vorlaufLaeuft false), die Frist steht.
  vorlaufPruefen() {
    const g = this.game; const z = g.transferZiel;
    if (!z) { this.vorlauf = null; this.vorlaufZiel = null; return; }
    if (this.vorlauf && this.vorlauf.ziel !== z) this.vorlauf = null;
    const frei = menschAnBord(g) && !menschUnten(g) && !Lage.gegnerImRaum(g.space && g.space.enemies) && !g.ship.reaktorCountdown;
    if (this.vorlauf) {
      if (!frei || g.time - this.vorlauf.seit > VORLAUF_FRIST) this.vorlauf = null;
      else if (!Lage.beamInReichweite(g)) this.vorlauf.seit = g.time;   // die Frist zaehlt nur in Reichweite
      return;
    }
    if (z === this.vorlaufZiel) return;
    this.vorlaufZiel = z;   // jedes Ziel wird nur beim ersten Sehen beurteilt (ein Ziel, das das Spiel selbst setzt, etwa beim Start einer Szene, beginnt spaeter keinen Vorlauf)
    if (frei && !menschBeamtRunter(g) && menschHaeltTransfer(g)) this.vorlauf = { ziel: z, seit: g.time };   // gewaehlt hat ihn ein Mensch: transfer.ziel gibt es nur an der Transfer-Konsole
  }
  vorlaufLaeuft() { return vorlaufLaeuft(this.game); }
  beamVorbereitet() { return beamVorbereitet(this.game); }
  stoppNoetig() { return stoppNoetig(this.game); }
  bordAktiv(spieler) { return bordAktiv(this.game, spieler); }   // BOT-02 B1: fuer den Agenten (mannschaft.js laedt dieses Modul nicht, Zirkelbezug)
  dienstLaeuft(spieler) { return dienstLaeuft(this.game, spieler); }
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
    this.vorlaufPruefen();
    if (!dienstBedarf(this.game)) this.bordHalter = null;   // Dienst zu Ende: beim naechsten gilt wieder die Reihe
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

module.exports = { tick, beenden, snapshotMerken, optionenSetzen, entfernen, wartet, prioritaetLoesen, agent, agenten, istServerBot, bordBot, bordAktiv, dienstLaeuft, bordDienstHaelt, stationVertreten, vorlaufLaeuft, beamVorbereitet, stoppNoetig, VORLAUF_FRIST };
