'use strict';
// BOT-01 B3: Spielverhalten der Server-Bots. Ein Agent je Bot-Spieler (server/bots/lauf.js legt sie an), er erbt den Kern der Testbots (kern.js) und kennt nur die Standard-Dienstpflicht seiner Rolle:
//   navigation (Kern-Rolle helm)    Steuer-Konsole besetzen; im Gefecht helmFight (Strategie maneuver: Breitseite, Ausweichen vor Ladungen), sonst Kurs und Stufe halten, am Kartenrand zur Mitte.
//                                   Kein eigenes Reisen, Andocken oder Kurssetzen (Paket C: Befehle).
//   ops (Kern-Rolle weapons)        Ops-Konsole besetzen, fight (Ladepunkte, Lanze, Batterien, Zusatzwaffen); ein von anderen markiertes Ziel geht vor (waehleZiel).
//   technik (Kern-Rolle technik)    Technik-Konsole besetzen (eigene Rolle, kein Tab ueber den Captain-Platz), technikDienst: Schilde verteilen, Reparaturliste und Prioritaeten. Die Schrauber (sim/bots.js) arbeiten die Liste ab.
// Der Agent sendet alles ueber game.handleMessage(p.conn, msg), nie hello/ready/Loadout und nur Befehle der eigenen Station (erlaubt()). Mensch gewinnt: haelt ein Mensch die Station des Bots, ist der Zustand 'wartet' und der Bot sendet nichts fuer sie.
// Zustand (Absicht) lebt im Agenten, nie im Spielerobjekt oder Snapshot. Zufall und Mitspieler gehoeren dem Lauf des Games (zufall, kollegen), kein Modulzustand.
const Protocol = require('../../shared/protocol.js');
const Crew = require('../sim/crew.js');
const Station = require('../sim/station.js');
const { BotKern, DT } = require('./kern.js');
const Absicht = require('./absicht.js');

const KERN_ROLLE = { navigation: 'helm', ops: 'weapons', technik: 'technik' };
const STATION = { navigation: 'helm', ops: 'weapons', technik: 'technik' };
const ROLLEN = Object.keys(KERN_ROLLE);
const FRIST_FRISCH = 6;   // Ticks: aelterer Snapshot als das zaehlt nicht (Schutz vor einem Rest aus einer frueheren Partie)

class BotMannschaft extends BotKern {
  // spieler: das Server-Spielerobjekt des Bots (bot: true, rolle, conn mit conn.player); lauf: der Lauf des Games; opts: Kern-Optionen (pilot)
  constructor(game, spieler, lauf, opts) {
    super(game, Math.max(0, game.players.indexOf(spieler)), KERN_ROLLE[spieler.rolle], Object.assign({ pilot: 'maneuver' }, opts || {}));
    this.spieler = spieler; this.lauf = lauf;
    this.pid = spieler.id; this.conn = spieler.conn;   // kein hello/welcome: die Verbindung des Bots kennt den Spieler (conn.player)
    this.rolleBot = spieler.rolle; this.stationKind = STATION[spieler.rolle];
    this.absicht = Absicht.neueAbsicht(spieler.rolle);
    this.rng = lauf.rngFuer(spieler);
    this.befehle = 0; this.verworfen = 0;   // gesendete cmd; vom Wachposten abgewiesene Nachrichten (muss 0 bleiben)
    this.memo.gesendeteZiele = new Set();
  }
  zufall() { return this.rng(); }
  kollegen() { return this.lauf.liste(); }
  hello() { /* Server-Bots haben kein hello und kein ready (sie sind Spieler seit der Lobby) */ }

  // Wachposten: nur Eingabe, Aktion, Konsole verlassen, Ablegen und Befehle der eigenen Station (plus Tab). Nie hello, ready, lobbyBot, captain.*, Loadout, Debug.
  erlaubt(msg) {
    switch (msg && msg.t) {
      case 'input': case 'act': case 'leave': case 'drop': return true;
      case 'cmd': return typeof msg.c === 'string' && (msg.c === Protocol.CMD_STATION_TAB || msg.c.startsWith(this.stationKind + '.'));
      default: return false;
    }
  }
  send(msg) {
    if (this.spieler.conn !== this.conn || !this.erlaubt(msg)) { this.verworfen++; return; }
    if (msg.t === 'cmd') this.befehle++;
    super.send(msg);
  }
  cmd(c, extra) {
    if (c === 'weapons.target' && extra && extra.id != null) this.memo.gesendeteZiele.add(extra.id);
    super.cmd(c, extra);
  }

  // Zielwahl der Ops: ein von anderen markiertes Ziel (ship.target, das der Bot nie selbst gesendet hat) geht vor dem Kern (Ladung, Anflug, im Bogen, naechster). Sonst wie die Testbots.
  waehleZiel(S, enemies, M) {
    const t = S.ship.target;
    if (t != null && !this.memo.gesendeteZiele.has(t)) {
      const markiert = S.space.enemies.find((e) => e.id === t);
      if (markiert) return markiert;
    }
    return super.waehleZiel(S, enemies, M);
  }

  // Wer haelt meine Station? Ein Mensch am Ort (Konsole) oder als aktives Interface (Tab) -> wartet.
  menschHaeltStation() {
    const kind = this.stationKind;
    return !!this.game.players.find((o) => o !== this.spieler && !Crew.istBot(o) && o.connected && (o.console === kind || Station.stationOf(o) === kind));
  }
  zustandSetzen(z) {
    if (this.absicht.zustand === z) return;
    this.absicht.zustand = z; this.absicht.seit = this.game.time;
    if (z === 'wartet') { this.ix = null; if (this.actDown) this.act(false); this.input(0, 0); }
  }
  // von bots/weichen.js: ein Mensch hat die Station bekommen (Tab oder Konsole)
  weicht() { this.zustandSetzen('wartet'); this.waitT = 0; this.ix = null; }

  tick(S) {
    const p = this.me(S); const live = this.spieler;
    if (!p || live.conn !== this.conn || this.game.phase !== 'play' || S.phase !== 'play' || this.game.tick - S.tick > FRIST_FRISCH) return;
    if (this.menschHaeltStation()) { this.zustandSetzen('wartet'); return; }
    if (Station.stationOf(p) !== Station.stationOf(live)) return;   // der Snapshot ist aelter als ein Stationswechsel: erst mit dem naechsten handeln
    if (this.waitT > 0) { this.waitT -= DT; return; }
    if (p.downed) { this.input(0, 0); this.act(false); this.ix = null; return; }
    if (p.zone !== 'ship') return;   // ein Bot am Boden (Beamen mit Pad) hat hier nichts zu tun
    this.zustandSetzen(Station.stationOf(live) === this.stationKind ? 'an_station' : 'unterwegs');
    if (!this.enter(S, this.stationKind)) return;
    this.dienst(S, p);
  }

  dienst(S, p) {
    if (this.rolleBot === 'navigation') this.steuerDienst(S, p);
    else if (this.rolleBot === 'ops') this.opsDienst(S, p);
    else if (this.rolleBot === 'technik') this.technikDienst(S, p);
  }
  // Steuer: Reaktor-Notsprung, im Gefecht Breitseite und Ausweichen, sonst Kurs halten ohne ins Leere zu fliegen
  steuerDienst(S, p) {
    if (this.reaktorNotsprung(S, p)) return;
    if (S.space.enemies.some((e) => e.kind !== 'relay')) { this.helmFight(S, this.helmFocus(S)); return; }
    this.kursHalten(S);
  }
  // Kurs und Stufe nicht aendern; nur im Randstreifen der Karte zur Mitte drehen (randNachMitte), sonst Ruder 0
  kursHalten(S) {
    const turn = this.turnCmd(S, this.randNachMitte(S));
    if (turn !== this.helmSent.turn || turn !== 0) this.helm(turn, 0);
  }
  opsDienst(S, p) { this.fight(S, { scan: true }); }
}

module.exports = { BotMannschaft, ROLLEN, STATION, KERN_ROLLE };
