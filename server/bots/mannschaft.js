'use strict';
// BOT-01 B3: Spielverhalten der Server-Bots. Ein Agent je Bot-Spieler (server/bots/lauf.js legt sie an), er erbt den Kern der Testbots (kern.js) und kennt nur die Standard-Dienstpflicht seiner Rolle:
//   navigation (Kern-Rolle helm)    Steuer-Konsole besetzen; im Gefecht helmFight (Strategie maneuver: Breitseite, Ausweichen vor Ladungen), sonst Kurs und Stufe halten, am Kartenrand zur Mitte. Ist jemand im Aussenteam unten (zone away), nur Kurs halten und Ausweichen (Beamreichweite).
//                                   Reisen, Andocken und Kurssetzen nur auf Befehl des Captains (BOT-01 C2a: nav.kurs, nav.abstand, nav.andocken, nav.sprung, nav.schub als Absicht, siehe Abschnitt Befehle der Navigation unten).
//   ops (Kern-Rolle weapons)        Ops-Konsole besetzen, fight (Ladepunkte, Lanze, Batterien, Zusatzwaffen); die Marke des Captains (capZiel), dann ein von anderen markiertes Ziel geht vor (waehleZiel).
//   technik (Kern-Rolle technik)    Technik-Konsole besetzen (eigene Rolle, kein Tab ueber den Captain-Platz), technikDienst: Schilde verteilen, Reparaturliste und Prioritaeten. Die Schrauber (sim/bots.js) arbeiten die Liste ab; technik.botAuto sendet der Agent nie (botAutomatikStandard entscheidet).
// Der Agent sendet alles ueber game.handleMessage(p.conn, msg), nie hello/ready/Loadout und nur Befehle der eigenen Station (erlaubt()). Mensch gewinnt: haelt ein Mensch die Station des Bots, ist der Zustand 'wartet' und der Bot sendet nichts fuer sie.
// Zustand (Absicht) lebt im Agenten, nie im Spielerobjekt oder Snapshot. Zufall und Mitspieler gehoeren dem Lauf des Games (zufall, kollegen), kein Modulzustand.
const Protocol = require('../../shared/protocol.js');
const Crew = require('../sim/crew.js');
const Station = require('../sim/station.js');
const Space = require('../sim/space.js');
const Sonden = require('../sim/sonden.js');
const CaptainZiel = require('../sim/captainziel.js');
const { BotKern, DT, STOP, LANGSAM_ZIELE, dist, norm } = require('./kern.js');
const Absicht = require('./absicht.js');
const Navziel = require('./navziel.js');

const KERN_ROLLE = { navigation: 'helm', ops: 'weapons', technik: 'technik' };
const STATION = { navigation: 'helm', ops: 'weapons', technik: 'technik' };
const ROLLEN = Object.keys(KERN_ROLLE);
const ANKUNFT_OBJEKT = 200;   // BOT-01 C2a: nav.kurs auf ein Objekt (Gegner, Mine, Fund, Station): Ankunftsabstand in px (steer)
const ANKUNFT_BASIS = 150;   // nav.kurs auf die Basis: vor dem Liegeplatz anhalten (Andocken ab 80 px ist nav.andocken)
const ANKUNFT_VORHALT = 60;   // steer wird auf diesen Abstand weniger gesteuert: es bremst vor dem Ziel auf Stufe STOPP und kommt nie ganz an, angekommen ist der Bot ab dem Ankunftsabstand
const ABSTAND_STANDARD = 400;   // nav.abstand ohne meter: wie helmManeuver bisher
const ABSTAND_TOLERANZ = 40;   // nav.abstand an einem festen Punkt (Station, Fund): so genau haelt der Bot den Abstand
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
    this.befehlGrund = null;   // BOT-01 C2a: warum der letzte Befehl endete (angekommen, stopp, ziel_weg, mensch, aussenteam, szene, ...); nur fuer Tests und Berichte
    this.befehle = 0; this.verworfen = 0;   // gesendete cmd; vom Wachposten abgewiesene Nachrichten (muss 0 bleiben)
    this.memo.gesendeteZiele = new Set();
  }
  zufall() { return this.rng(); }
  kollegen() { return this.lauf.liste(); }
  // Die Schrauber-Automatik regelt botAutomatikStandard (Technik durch Bot besetzt: aus, sonst nach Koepfen); der Agent waehlt sie nie (kein technik.botAuto: das setzt botAutoChosen fuer die ganze Partie). Die Liste fuehrt er trotzdem.
  automatikAbschalten() { return false; }
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
    if (msg.t === 'cmd') this.befehle++;   // auch das Stufenhalten vor leave (kern.js send) laeuft durch diesen Wachposten
    super.send(msg);
  }
  cmd(c, extra) {
    if (c === 'weapons.target' && extra && extra.id != null && this.game.ship.target !== extra.id) this.memo.gesendeteZiele.add(extra.id);   // eine schon stehende (fremde) Marke wird nie zur eigenen
    super.cmd(c, extra);
  }

  // Zielwahl der Ops: erst die Marke des Captains (captain.anzeigeziel -> ship.capZiel, nur ein lebender Gegner, den die Ops auch aufschalten koennte), dann ein von anderen markiertes Ziel (ship.target, das der Bot nie selbst
  // gesendet hat), dann der Kern (Ladung, Anflug, im Bogen, naechster). Gefeuert wird weiter nur im Bogen (lanceFight, Batterien, Zusatzwaffen), die Marke erzwingt keinen Schuss ins Leere.
  waehleZiel(S, enemies, M) {
    const cz = CaptainZiel.gueltig(this.game);
    const capMarke = cz && enemies.find((e) => e.id === cz.id);
    if (capMarke && this.aufschaltbar(capMarke)) return capMarke;   // nicht aufschaltbar (ausser Sensoren): weapons.target wuerde abgewiesen, fight() hinge an der Zielwahl
    const t = this.game.ship.target;   // der Spielzustand, nicht der Snapshot: eine frische Marke eines Menschen darf nicht im alten Stand untergehen
    if (t != null && !this.memo.gesendeteZiele.has(t)) {
      const markiert = S.space.enemies.find((e) => e.id === t);
      if (markiert) return markiert;
    }
    return super.waehleZiel(S, enemies, M);
  }

  aufschaltbar(e) { return Math.hypot(this.game.ship.x - e.x, this.game.ship.y - e.y) <= Space.sensorReichweite(this.game) || !!Sonden.sieht(this.game, e.x, e.y); }

  // Wer haelt meine Station? Ein Mensch am Ort (Konsole) oder als aktives Interface (Tab) -> wartet.
  menschHaeltStation() {
    const kind = this.stationKind;
    return !!this.game.players.find((o) => o !== this.spieler && !Crew.istBot(o) && o.connected && (o.console === kind || Station.stationOf(o) === kind));
  }
  zustandSetzen(z) {
    if (this.absicht.zustand === z) return;
    this.absicht.zustand = z; this.absicht.seit = this.game.time;
    if (z === 'wartet') { this.befehlVerwerfen('mensch'); this.ix = null; if (this.actDown) this.act(false); this.input(0, 0); }
  }
  // von bots/weichen.js: ein Mensch hat die Station bekommen (Tab oder Konsole)
  weicht() { this.zustandSetzen('wartet'); this.waitT = 0; this.ix = null; }

  tick(S) {
    const p = this.me(S); const live = this.spieler;
    if (!p || live.conn !== this.conn || this.game.phase !== 'play' || S.phase !== 'play' || this.game.tick - S.tick > FRIST_FRISCH) return;
    if (this.menschHaeltStation()) { this.zustandSetzen('wartet'); this.befehlVerwerfen('mensch'); return; }
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
  // BOT-01 C2a: ein Befehl des Captains (absicht.befehl) geht dem Standardverhalten vor, nicht dem Notsprung. Bei Aussenteam unten endet er (ausser nav.schub: die Stufe bleibt).
  steuerDienst(S, p) {
    if (this.reaktorNotsprung(S, p)) return;
    if (this.aussenteamUnten()) {
      const b = this.absicht.befehl;
      if (b && b.name !== 'nav.schub') this.befehlVerwerfen('aussenteam');
      if (this.absicht.befehl) { this.schubHalten(S); return; }
      this.kursHaltenFuerAussenteam(S); return;
    }
    if (this.absicht.befehl && this.befehlAusfuehren(S)) return;
    if (S.space.enemies.some((e) => e.kind !== 'relay')) { this.helmFight(S, this.helmFocus(S)); return; }
    this.kursHalten(S);
  }
  // Ist irgendwer (Mensch oder Bot) im Aussenteam unten? Dann bleibt das Schiff in Beamreichweite (away.js „Zu weit vom Ziel“).
  aussenteamUnten() { return this.game.players.some((o) => o.zone === 'away'); }
  // Aussenteam unten: kein Nachsetzen, keine Breitseite; Stufe und Kurs bleiben, nur Ausweichen vor Ladungen und die Randkorrektur
  kursHaltenFuerAussenteam(S) {
    if (this.pilot() === 'maneuver') this.dodgeTele(S);
    this.kursHalten(S);
  }
  // Kurs und Stufe nicht aendern; nur im Randstreifen der Karte zur Mitte drehen (randNachMitte), sonst Ruder 0
  kursHalten(S) {
    const turn = this.turnCmd(S, this.randNachMitte(S));
    if (turn !== this.helmSent.turn || turn !== 0) this.helm(turn, 0);
  }
  opsDienst(S, p) { this.fight(S, { scan: true }); }

  // ---------- BOT-01 C2a: Befehle der Navigation ----------
  // Die Registry (befehle/navigation.js) prueft und setzt nur die Absicht (befehlSetzen) bzw. sendet die direkten Befehle (stoppen, ausweichenNun); ausgefuehrt wird sie hier, jeden Tick in steuerDienst.
  // Solange ein Befehl gilt, kaempft der Bot nicht um die Position (kein helmFight): er weicht Ladungen und Geschossen aus (dodgeTele, Reflex) und Felsen (steer), der Befehl des Captains gilt.
  // Ein Befehl endet (befehlVerwerfen): angekommen, Ziel weg, nav.stopp, anderer Befehl (befehlSetzen ersetzt), Mensch an der Station, Aussenteam unten, Szenenwechsel; danach gilt wieder das Standardverhalten.
  befehlSetzen(name, args, extra) {
    Absicht.befehlSetzen(this.absicht, Object.assign({ name, args: Object.assign({}, args), seit: this.game.time, szene: this.game.ship.scene }, extra));
    this.befehlGrund = null;
  }
  befehlVerwerfen(grund) {
    if (!this.absicht.befehl) return false;
    Absicht.befehlEnde(this.absicht); this.befehlGrund = grund;
    return true;
  }
  befehlAusfuehren(S) {
    const b = this.absicht.befehl;
    if (this.game.ship.scene !== b.szene) { this.befehlVerwerfen('szene'); return false; }
    switch (b.name) {
      case 'nav.kurs': return this.kursAusfuehren(S, b);
      case 'nav.abstand': return this.abstandAusfuehren(S, b);
      case 'nav.andocken': return this.andockenAusfuehren(S);
      case 'nav.sprung': return this.sprungAusfuehren(S);
      case 'nav.schub': this.schubHalten(S); return true;
      default: this.befehlVerwerfen('unbekannt'); return false;
    }
  }
  // Ziel verschwunden (markiertes Ziel zerstoert, Szene gewechselt): der Befehl endet, der Bot haelt an
  zielWeg(S) { this.anhalten('ziel_weg'); return true; }
  // Befehl beenden und das Schiff anhalten (Allstopp; angedockt steht es schon), sonst fliegt es mit der letzten Stufe weiter
  anhalten(grund) { this.befehlVerwerfen(grund); if (!this.game.ship.docked) this.cmd('helm.stop'); }
  // Ladungen (Telegraph) und nahe Geschosse: ausweichen wie im Gefecht, ohne Position zu kaempfen
  ausweichenImBefehl(S) {
    const sh = S.ship;
    if (this.pilot() === 'maneuver') this.dodgeTele(S);
    if (S.space.projectiles.some((q) => (q.kind === 'enemy' || q.kind === 'emp') && dist(q.x, q.y, sh.x, sh.y) < 90) && sh.dodgeCd === 0 && (this.memo.dodgeAt || 0) < S.time) { this.memo.dodgeAt = S.time + 1; this.cmd('helm.dodge', { dir: this.zufall() < 0.5 ? -1 : 1 }); }
  }
  kursAusfuehren(S, b) {
    const o = Navziel.standort(this.game, b.ziel, 'kurs');
    if (!o) return this.zielWeg(S);
    this.ausweichenImBefehl(S);
    const an = b.ziel.art === 'basis' ? ANKUNFT_BASIS : ANKUNFT_OBJEKT;
    this.steer(S, o.x, o.y, an - ANKUNFT_VORHALT, 130);
    if (dist(S.ship.x, S.ship.y, o.x, o.y) <= an) this.anhalten('angekommen');
    return true;
  }
  // Abstand halten: gegen einen Gegner die Breitseite auf den Abstand (helmManeuver), sonst den Abstand an einem festen Punkt (Station, Fund, Mine) mit steer
  abstandAusfuehren(S, b) {
    const o = Navziel.standort(this.game, b.ziel, 'abstand');
    if (!o) return this.zielWeg(S);
    const meter = b.meter || ABSTAND_STANDARD;
    const e = o.typ === 'enemy' ? S.space.enemies.find((q) => q.id === b.ziel.id) : null;
    this.ausweichenImBefehl(S);
    if (e) this.helmManeuver(S, e, Object.assign({ abstand: meter }, LANGSAM_ZIELE.includes(e.kind) ? { slow: true } : {}));
    else this.abstandAnPunkt(S, o, meter);
    return true;
  }
  abstandAnPunkt(S, o, meter) {
    const sh = S.ship; const d = dist(sh.x, sh.y, o.x, o.y);
    if (Math.abs(d - meter) <= ABSTAND_TOLERANZ) { this.helmS(S, this.turnCmd(S, 0), STOP); return; }
    const ux = d > 1 ? (sh.x - o.x) / d : 1, uy = d > 1 ? (sh.y - o.y) / d : 0;
    this.steer(S, o.x + ux * meter, o.y + uy * meter, 0, 90);
  }
  // Anflug und Andocken wie der Testbot (dock): den Liegeplatz langsam anfliegen, der Server dockt an (space.updateFlight). Angedockt: der Befehl ist erfuellt.
  andockenAusfuehren(S) {
    const live = this.game.ship;   // der Spielzustand, nicht der Snapshot: das Andocken geschieht im Server-Tick
    if (live.docked && live.dockedAt === live.scene) { this.befehlVerwerfen('angedockt'); return true; }
    const d = Navziel.dockLage(this.game);
    if (!d) { this.anhalten('kein_dock'); return true; }
    this.ausweichenImBefehl(S);
    this.steer(S, d.x, d.y, 0, 70);
    return true;
  }
  // Sprung: zum Sprungpunkt fliegen (flyClear: Abstand zur Station, Sprungpunkt der Kante), dann springen wie der Mensch an der Steuer (helm.jump bzw. helm.schnellsprung bei gewaehlter Route)
  sprungAusfuehren(S) {
    const j = this.game.ship.jump || {};
    if (this.game.reise) return true;
    if (!j.dest) { this.befehlVerwerfen('ziel_weg'); return false; }
    if (j.ready) { this.cmd(this.game.reisePlan ? 'helm.schnellsprung' : 'helm.jump'); return true; }
    this.ausweichenImBefehl(S);
    this.flyClear(S);
    return true;
  }
  // nav.schub: die Stufe des Captains halten (auch im Gefecht), Ruder wie beim Kurshalten
  schubHalten(S) {
    this.ausweichenImBefehl(S);
    this.helmS(S, this.turnCmd(S, this.randNachMitte(S)), this.absicht.befehl.stage);
  }
  // Direkte Befehle (die Registry prueft vorher Station, Lage und System): nav.stopp, nav.ausweichen
  stoppen() { this.befehlVerwerfen('stopp'); this.cmd('helm.stop'); }
  ausweichenNun() {
    const sh = this.game.ship;
    const e = this.game.space.enemies.slice().sort((a, b) => dist(a.x, a.y, sh.x, sh.y) - dist(b.x, b.y, sh.x, sh.y))[0];
    const rel = e ? norm(Math.atan2(e.y - sh.y, e.x - sh.x) - sh.angle) : null;
    this.cmd('helm.dodge', { dir: rel == null ? (this.zufall() < 0.5 ? -1 : 1) : (rel < 0 ? 1 : -1) });   // vom naechsten Gegner weg, sonst zufaellig
  }
}

module.exports = { BotMannschaft, ROLLEN, STATION, KERN_ROLLE };
