'use strict';
// BOT-01 B3: Spielverhalten der Server-Bots. Ein Agent je Bot-Spieler (server/bots/lauf.js legt sie an), er erbt den Kern der Testbots (kern.js) und kennt nur die Standard-Dienstpflicht seiner Rolle:
//   navigation (Kern-Rolle helm)    Steuer-Konsole besetzen; im Gefecht helmFight (Strategie maneuver: Breitseite, Ausweichen vor Ladungen), sonst Kurs und Stufe halten, am Kartenrand zur Mitte. Ist jemand im Aussenteam unten (zone away), nur Kurs halten und Ausweichen (Beamreichweite).
//                                   Reisen, Andocken und Kurssetzen nur auf Befehl des Captains (BOT-01 C2a: nav.kurs, nav.abstand, nav.andocken, nav.sprung, nav.schub als Absicht, siehe Abschnitt Befehle der Navigation unten).
//   ops (Kern-Rolle weapons)        Ops-Konsole besetzen, fight (Ladepunkte, Lanze, Batterien, Zusatzwaffen); die Marke des Captains (capZiel), dann ein von anderen markiertes Ziel geht vor (waehleZiel).
//   technik (Kern-Rolle technik)    Technik-Konsole besetzen (eigene Rolle, kein Tab ueber den Captain-Platz), technikDienst: Schilde verteilen, Reparaturliste und Prioritaeten. Die Schrauber (sim/bots.js) arbeiten die Liste ab; technik.botAuto sendet der Agent nie (botAutomatikStandard entscheidet).
// BOT-01 C2b: ops und technik tragen Befehle als Absicht (absicht.befehl ops.ziel, absicht.feuer/waffen, absicht.halten scan/prio/schild); Einmal-Aktionen gehen ueber einmalig(), bot.automatik loescht alles.
// BOT-02 B1: Bord-Dienst (Zusatzdienst, siehe lauf.js bordBot/dienstLaeuft): ist ein Mensch im Aussenteam unten oder beamt gerade runter, geht der Bord-Bot zur Transfer-Konsole (Ort, kein Tab) und haelt sie; sein Rollenverhalten ruht, die Station-Automatik
// springt ein (station.js, ueber weichen.js vertreten). Der Wachposten erlaubt ihm dann genau die Befehle aus BORD_BEFEHLE (Whitelist, keine Praefixe). Ende: kein Mensch mehr unten -> leave und zurueck an die Station. Ein Mensch an der Transfer-Konsole
// gewinnt (weichen.js): der Dienst ruht (dienstLaeuft false), der Bot geht an seine Station.
// Der Agent sendet alles ueber game.handleMessage(p.conn, msg), nie hello/ready/Loadout und nur Befehle der eigenen Station (erlaubt()). Mensch gewinnt: haelt ein Mensch die Station des Bots, ist der Zustand 'wartet' und der Bot sendet nichts fuer sie.
// Zustand (Absicht) lebt im Agenten, nie im Spielerobjekt oder Snapshot. Zufall und Mitspieler gehoeren dem Lauf des Games (zufall, kollegen), kein Modulzustand.
const Protocol = require('../../shared/protocol.js');
const Crew = require('../sim/crew.js');
const Station = require('../sim/station.js');
const Space = require('../sim/space.js');
const Sonden = require('../sim/sonden.js');
const CaptainZiel = require('../sim/captainziel.js');
const Katalog = require('../../shared/schiffskatalog.js');
const { BotKern, DT, STOP, LANGSAM_ZIELE, BOT_SCHILD_SEKTOR_MAX, dist, norm } = require('./kern.js');
const Absicht = require('./absicht.js');
const Navziel = require('./navziel.js');
const Lage = require('./bordlage.js');

const KERN_ROLLE = { navigation: 'helm', ops: 'weapons', technik: 'technik' };
const STATION = { navigation: 'helm', ops: 'weapons', technik: 'technik' };
const ROLLEN = Object.keys(KERN_ROLLE);
const ANKUNFT_OBJEKT = 200;   // BOT-01 C2a: nav.kurs auf ein Objekt (Gegner, Mine, Fund, Station): Ankunftsabstand in px (steer)
const ANKUNFT_BASIS = 150;   // nav.kurs auf die Basis: vor dem Liegeplatz anhalten (Andocken ab 80 px ist nav.andocken)
const ANKUNFT_VORHALT = 60;   // steer wird auf diesen Abstand weniger gesteuert: es bremst vor dem Ziel auf Stufe STOPP und kommt nie ganz an, angekommen ist der Bot ab dem Ankunftsabstand
const ABSTAND_STANDARD = 400;   // nav.abstand ohne meter: wie helmManeuver bisher
const ABSTAND_TOLERANZ = 40;   // nav.abstand an einem festen Punkt (Station, Fund): so genau haelt der Bot den Abstand
const PRIO_DAUERHAFT = ['fire', 'breach'];   // tech.prio feuer/leck gelten bis bot.automatik, Gegenbefehl oder Mensch; eine System-Prioritaet endet, wenn das System heil ist
// BOT-02 B1: Whitelist der Befehle, die nur der Bord-Dienst senden darf (Wachposten), nie die normale Rolle. Exakte Namen, keine Praefixe: B1 braucht nur die Rueckholung und die Unterstuetzung (captain.support, serverseitig nur an der
// Captain-Konsole; der Bot laeuft dafuer ab B2 dorthin). transfer.down/up/ziel/supply und alle uebrigen captain.* bleiben gesperrt, auch im Dienst. B2/B3 erweitern die Liste bei Bedarf einzeln, nie per Praefix.
const BORD_BEFEHLE = ['transfer.recall', 'captain.support'];
const SENSOR_PAUSE = 60;   // BOT-02 B2: der Bord-Bot setzt den Sensor selbst hoechstens einmal je 60 s (die Abklingzeit des Spiels sind 30 s)
const WEG_FRIST = 45;   // s: laeuft der Bot so lange zur Captain-Konsole, ohne dass er sendet (Weg versperrt), gibt er auf
const BORD_BEFEHL_FRIST = 20;   // s: ein Befehl bord.rueckholen, der nicht ausgefuehrt werden kann, verfaellt
const SENDE_PAUSE = 2;   // s: zwischen zwei Versuchen, transfer.recall zu senden
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
    this.festesZiel = null;   // BOT-01 C2b: waehrend fightMitMarke das Feuerziel (Gegner), sonst null
    this.bordBegonnen = false;   // BOT-02 B1: der laufende Bord-Dienst hat die Absicht der Rolle schon verworfen
    // BOT-02 B2: Zustand des Bord-Dienstes (nur Agent, nie Spielzustand). befehl { art: rueckholen|sensor|kuppel, seit } vom Menschen (Registry befehle/bord.js); weg { art, seit, grund: befehl|auto } = der Bot geht zur Captain-Konsole
    // und sendet captain.support; tun = was der Bot gerade tut (rueckholen | captain | null, fuer bot.status); sensorAuto = Zeit der letzten Sensor-Automatik; nichtVor = nach einem Fehlschlag kein neuer Weg vor dieser Zeit.
    this.bord = { befehl: null, weg: null, tun: null, sensorAuto: -1e9, nichtVor: 0, rueckholAt: 0 };
    this.prioSperre = false;   // BOT-01 C2b: waehrend queueRepairs mit gehaltener tech.prio unterdrueckt cmd die Standard-Prioritaeten
  }
  zufall() { return this.rng(); }
  kollegen() { return this.lauf.liste(); }
  // Die Schrauber-Automatik regelt botAutomatikStandard (Technik durch Bot besetzt: aus, sonst nach Koepfen); der Agent waehlt sie nie (kein technik.botAuto: das setzt botAutoChosen fuer die ganze Partie). Die Liste fuehrt er trotzdem.
  automatikAbschalten() { return false; }
  hello() { /* Server-Bots haben kein hello und kein ready (sie sind Spieler seit der Lobby) */ }

  // Wachposten: nur Eingabe, Aktion, Konsole verlassen, Ablegen und Befehle der eigenen Station (plus Tab; im Bord-Dienst die Whitelist BORD_BEFEHLE). Nie hello, ready, lobbyBot, sonstige captain.*/transfer.*, Loadout, Debug.
  erlaubt(msg) {
    switch (msg && msg.t) {
      case 'input': case 'act': case 'leave': case 'drop': return true;
      case 'cmd': return typeof msg.c === 'string' && (msg.c === Protocol.CMD_STATION_TAB || msg.c.startsWith(this.stationKind + '.') || (this.bordDienstLaeuft() && BORD_BEFEHLE.includes(msg.c)));
      default: return false;
    }
  }
  send(msg) {
    if (this.spieler.conn !== this.conn || !this.erlaubt(msg)) { this.verworfen++; return; }
    if (msg.t === 'cmd') this.befehle++;   // auch das Stufenhalten vor leave (kern.js send) laeuft durch diesen Wachposten
    super.send(msg);
  }
  cmd(c, extra) {
    if (this.rolleBot === 'ops' && (c === 'weapons.charge' || c === 'weapons.fire')) { extra = this.feuerErlaubt(c, extra); if (!extra) return; }   // BOT-01 C2b: ops.feuer_halt / ops.feuer_frei waffen (kern.js fight() bleibt unveraendert)
    if (c === 'technik.priority' && this.prioSperre) return;   // BOT-01 C2b: tech.prio gilt gegen die Standard-Prioritaeten der Technik
    if (c === 'weapons.target' && extra && extra.id != null && this.game.ship.target !== extra.id) this.memo.gesendeteZiele.add(extra.id);   // eine schon stehende (fremde) Marke wird nie zur eigenen
    super.cmd(c, extra);
  }

  // Zielwahl der Ops: erst die Marke des Captains (captain.anzeigeziel -> ship.capZiel, nur ein lebender Gegner, den die Ops auch aufschalten koennte), dann ein von anderen markiertes Ziel (ship.target, das der Bot nie selbst
  // gesendet hat), dann der Kern (Ladung, Anflug, im Bogen, naechster). Gefeuert wird weiter nur im Bogen (lanceFight, Batterien, Zusatzwaffen), die Marke erzwingt keinen Schuss ins Leere.
  waehleZiel(S, enemies, M) {
    if (this.festesZiel != null) { const f = enemies.find((q) => q.id === this.festesZiel); if (f) return f; }   // fightMitMarke: das Feuerziel steht schon fest (die Marke liegt auf einem Nicht-Gegner)
    const b = this.absicht.befehl;   // BOT-01 C2b: ein gesetztes Ziel (ops.ziel) geht allem vor, solange der Gegner lebt und aufschaltbar ist
    if (b && b.name === 'ops.ziel') { const e = enemies.find((q) => q.id === b.id); if (e && this.aufschaltbar(e)) return e; }
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
    if (z === 'wartet') { this.alleVerwerfen('mensch'); this.ix = null; if (this.actDown) this.act(false); this.input(0, 0); }
  }
  // von bots/weichen.js: ein Mensch hat die Station bekommen (Tab oder Konsole)
  weicht() { this.zustandSetzen('wartet'); this.waitT = 0; this.ix = null; }

  tick(S) {
    const p = this.me(S); const live = this.spieler;
    if (!p || live.conn !== this.conn || this.game.phase !== 'play' || S.phase !== 'play' || this.game.tick - S.tick > FRIST_FRISCH) return;
    const dienst = this.bordDienstLaeuft();   // lauf.js dienstLaeuft: Mensch unten oder beamt, kein Mensch an der Transfer-Konsole (der gewinnt: der Dienst ruht, der Bot tut seine Rolle)
    if (!dienst) { this.bordBegonnen = false; this.bordLoeschen(); }   // B2: ohne Dienst auch kein Befehl und kein Weg; auch solange ein Mensch den Transfer haelt: beim Wiederbeginn endet das in der Zwischenzeit Gesetzte
    if (!dienst && this.menschHaeltStation()) {   // BOT-02 B1: mit Bord-Dienst steht der Bot nicht an seiner Station, ein Mensch dort stoert ihn nicht
      this.zustandSetzen('wartet'); this.alleVerwerfen('mensch');
      if (live.console && live.console !== this.stationKind) this.send({ t: 'leave' });   // Dienst zu Ende, ein Mensch sitzt inzwischen an der Station des Bots: die Transfer-Konsole freigeben, nicht dort stehen bleiben
      return;
    }
    if (Station.stationOf(p) !== Station.stationOf(live)) return;   // der Snapshot ist aelter als ein Stationswechsel: erst mit dem naechsten handeln
    if (this.waitT > 0) { this.waitT -= DT; return; }
    if (p.downed) { this.alleVerwerfen('unten'); this.input(0, 0); this.act(false); this.ix = null; return; }
    if (p.zone !== 'ship') { this.alleVerwerfen('unten'); return; }   // ein Bot am Boden (Beamen mit Pad) hat hier nichts zu tun; Befehle und Haltezustaende enden (BOT-01 C2b: auch die Prioritaet der Technik)
    if (dienst) { this.bordDienst(S); return; }
    this.zustandSetzen(Station.stationOf(live) === this.stationKind ? 'an_station' : 'unterwegs');
    if (!this.enter(S, this.stationKind)) return;
    this.dienst(S, p);
  }

  // BOT-02 B1: Bord-Dienst. Ein Mensch im Aussenteam unten und dieser Bot ist der Bord-Bot (lauf.js)
  bordDienstLaeuft() { return this.lauf.dienstLaeuft(this.spieler); }   // eine Quelle (lauf.js): Bord-Bot, Dienst faellig, kein Mensch an der Transfer-Konsole
  // Zur Transfer-Konsole gehen und dort bleiben; das Rollenverhalten ruht (Haelt ein Mensch die Transfer-Konsole, laeuft der Dienst nicht: Mensch gewinnt, weichen.js).
  // Beim Beginn endet alles Gehaltene der Rolle (Befehle, Prioritaet), die Station-Automatik uebernimmt (Technik: botAutomatikStandard, Ops: waffenAutomatikAktiv, beides ueber weichen.js vertreten, auch bei mehr als zwei Koepfen); technik.botAuto sendet der Agent nie.
  // BOT-02 B2: am Transfer holt der Bot zurueck (transfer.recall: Lage alle Menschen unten downed, oder Befehl) und geht auf Befehl bzw. Automatik zur Captain-Konsole (captain.support gilt serverseitig nur dort) und danach zurueck.
  // Die Rueckholung geht dem Laufweg immer vor: ist die Lage da oder ein Befehl bord.rueckholen gesetzt, bleibt der Bot am Transfer bzw. laeuft sofort zurueck; ein Weg beginnt nie, wenn alle Menschen unten downed sind.
  bordDienst(S) {
    if (!this.bordBegonnen) { this.alleVerwerfen('bord'); this.bordBegonnen = true; }
    const b = this.bord;
    const pid = this.bordRueckholBedarf();
    if (pid !== null) b.weg = null;
    else { this.bordWegPruefen(); if (!b.weg) this.bordWegWaehlen(); }
    if (b.weg) {
      b.tun = 'captain';
      const da = this.enter(S, 'captain');
      this.zustandSetzen(da ? 'an_station' : 'unterwegs');
      if (da) this.bordUnterstuetzen();
      return true;
    }
    b.tun = pid !== null ? 'rueckholen' : null;
    const da = this.enter(S, 'transfer');
    this.zustandSetzen(da ? 'an_station' : 'unterwegs');
    if (da && pid !== null) this.bordRueckholen(pid);
    return true;
  }
  // Registry (befehle/bord.js): der Befehl des Menschen als Absicht; ersetzt einen vorherigen. rueckholen geht dem Weg vor (bordDienst bricht einen laufenden Weg ab).
  bordBefehlSetzen(art) {
    this.bord.befehl = { art, seit: this.game.time };
    this.befehlGrund = null;
  }
  // Befehl, Weg und Anzeige weg (Dienst zu Ende, bot.automatik, Mensch uebernimmt); die Sensor-Pause bleibt. true = es gab etwas
  bordLoeschen() {
    const b = this.bord; const hatte = !!(b.befehl || b.weg);
    b.befehl = null; b.weg = null; b.tun = null;
    return hatte;
  }
  // pid des Menschen, den der Bot jetzt per transfer.recall holt, oder null. Befehl bord.rueckholen: sofort, auch wenn noch jemand aufrecht ist (verfaellt, wenn niemand mehr unten ist, der Transfer gesperrt ist oder
  // nach BORD_BEFEHL_FRIST). Automatik: erst wenn ALLE Menschen unten downed sind (die Lage bleibt bestehen: der Bot sendet nur ohne bekannte Sperre, nach Ablauf der Abklingzeit setzt er nach).
  bordRueckholBedarf() {
    const b = this.bord; const g = this.game;
    if (b.befehl && b.befehl.art === 'rueckholen') {
      const pid = Lage.rueckholZiel(g, true);
      if (pid === null || Lage.rueckholSperre(g) || g.time - b.befehl.seit > BORD_BEFEHL_FRIST) b.befehl = null;
      else return pid;
    }
    return Lage.allesDowned(g) ? Lage.rueckholZiel(g, false) : null;
  }
  bordRueckholen(pid) {
    const b = this.bord; const t = this.game.time;
    if (Lage.rueckholSperre(this.game) || t < b.rueckholAt) return;   // bekannte Sperre (Abklingzeit, Transfer aus): nichts senden, kein Dauerfeuer
    b.rueckholAt = t + SENDE_PAUSE;
    const fehler = this.einmalig('transfer.recall', { pid });
    if (!fehler && b.befehl && b.befehl.art === 'rueckholen') b.befehl = null;
  }
  // der Weg zur Captain-Konsole gilt nur, solange er sicher und sinnvoll ist (sonst zurueck zum Transfer)
  bordWegPruefen() {
    const b = this.bord; const g = this.game;
    if (!b.weg) return;
    const w = b.weg;
    if (Lage.captainBelegt(g, this.spieler) || !Lage.anyAway(g) || Lage.allesDowned(g) || Lage.supportSperre(g, w.art) || g.time - w.seit > WEG_FRIST) this.bordWegAufgeben(g.time - w.seit > WEG_FRIST ? 5 : 0);
  }
  bordWegAufgeben(pause) {
    const b = this.bord; const art = b.weg && b.weg.art;
    if (b.befehl && b.befehl.art === art) b.befehl = null;
    b.weg = null; b.nichtVor = this.game.time + (pause || 0);
  }
  // einen Weg beginnen: der Befehl des Menschen, sonst die Automatik (Kuppel vor Sensor). Nie, wenn alle unten downed sind, ein Mensch die Captain-Konsole haelt oder niemand unten ist.
  bordWegWaehlen() {
    const b = this.bord; const g = this.game; const t = g.time;
    if (t < b.nichtVor) return;
    const bf = b.befehl && (b.befehl.art === 'sensor' || b.befehl.art === 'kuppel') ? b.befehl.art : null;
    const frei = Lage.anyAway(g) && !Lage.allesDowned(g) && !Lage.captainBelegt(g, this.spieler);
    if (bf) {
      if (!frei || Lage.supportSperre(g, bf)) { b.befehl = null; return; }   // Lage hat sich geaendert: der Befehl verfaellt
      b.weg = { art: bf, seit: t, grund: 'befehl' };
      return;
    }
    if (!frei) return;
    if (Lage.kuppelNoetig(g) && !Lage.supportSperre(g, 'kuppel')) b.weg = { art: 'kuppel', seit: t, grund: 'auto' };
    else if (Lage.gegnerAktiv(g) && !Lage.supportSperre(g, 'sensor') && t - b.sensorAuto >= SENSOR_PAUSE) b.weg = { art: 'sensor', seit: t, grund: 'auto' };
  }
  // An der Captain-Konsole: captain.support senden (Einmal-Aktion, Antwort des Spiels), danach ist der Weg zu Ende und der Bot geht zum Transfer zurueck
  bordUnterstuetzen() {
    const b = this.bord; const w = b.weg;
    const fehler = this.einmalig('captain.support', { kind: w.art });
    if (w.art === 'sensor') b.sensorAuto = this.game.time;   // auch nach einem Befehl: die Automatik setzt danach nicht gleich nach
    if (b.befehl && b.befehl.art === w.art) b.befehl = null;
    b.weg = null;
    if (fehler) b.nichtVor = this.game.time + 5;
  }

  dienst(S, p) {
    if (this.rolleBot === 'navigation') this.steuerDienst(S, p);
    else if (this.rolleBot === 'ops') this.opsDienst(S, p);
    else if (this.rolleBot === 'technik') this.technikDienst(S, p);
  }
  // Steuer: Reaktor-Notsprung, im Gefecht Breitseite und Ausweichen, sonst Kurs halten ohne ins Leere zu fliegen
  // BOT-01 C2a: ein Befehl des Captains (absicht.befehl) geht dem Standardverhalten vor, nicht dem Notsprung. Bei Aussenteam unten endet jeder Navigationsbefehl (Beamreichweite, Bericht 8.3 Nr. 3); eine Schub-Absicht
  // haelt dabei das Schiff an (helm.stop), ein Kurs bleibt wie bisher stehen (Kurs und Stufe halten).
  steuerDienst(S, p) {
    if (this.reaktorNotsprung(S, p)) return;
    const b = this.absicht.befehl;
    if (b && b.name.startsWith('nav.') && this.game.ship.scene !== b.szene) this.befehlVerwerfen('szene');
    if (this.aussenteamUnten()) {
      const a = this.absicht.befehl;
      if (a && a.name === 'nav.schub') this.anhalten('aussenteam');
      else if (a) this.befehlVerwerfen('aussenteam');
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
  // BOT-01 C2b: Ops. Standard: feuern auf die Marke, sonst den naechsten im Bogen (fight). Gehalten werden ein gesetztes Ziel (ops.ziel), der Feuerzustand (ops.feuer_frei/halt, Gruppe in absicht.waffen)
  // und ein laufender Scan (ops.scan); gesendet wird weiter nur ueber cmd (Wachposten), das Feuer filtert feuerErlaubt.
  opsDienst(S, p) {
    this.scanHalten(S);
    const b = this.absicht.befehl;
    if (b && b.name === 'ops.ziel' && this.zielHalten(S, b)) return;
    this.fight(S, { scan: true });
  }
  // Das gesetzte Ziel gilt bis es zerstoert ist (oder die Szene wechselt). Gegner: false (waehleZiel haelt es, fight() laeuft wie sonst). Kein Gegner (Station, Fund): nur die Marke halten (weapons.target),
  // gefeuert wird weiter auf Gegner (fightMitMarke), nie auf die Station oder den Fund. Mine: Marke halten und mit den Batterien darauf feuern, solange sie im Bogen liegt, sonst wie bei der Station. true = dieser Tick ist erledigt.
  zielHalten(S, b) {
    if (this.game.ship.scene !== b.szene) { this.befehlVerwerfen('szene'); return false; }
    const rt = Space.resolveTarget(this.game, b.id);
    if (!rt) { this.befehlVerwerfen('ziel_weg'); return false; }
    if (rt.type === 'enemy') return false;
    if (this.game.ship.target !== b.id && (rt.type !== 'mine' || this.aufschaltbar(rt)) && (this.memo.markeAt || 0) < S.time) { this.memo.markeAt = S.time + 0.5; this.cmd('weapons.target', { id: b.id }); }
    if (rt.type === 'mine' && this.mineFeuern(S, rt)) return true;
    this.fightMitMarke(S);
    return true;
  }
  // Kampf auf Gegner, waehrend ship.target (die Marke) auf einem Nicht-Gegner liegt: fight() bekommt eine Kopie des Snapshots, in der das Ziel der gewaehlte Gegner ist, und sendet deshalb kein weapons.target
  // (die Marke bleibt stehen). Ohne Scan und ohne Systemziel (beides haengt am Ziel im Spiel). kern.js bleibt unveraendert.
  fightMitMarke(S) {
    const enemies = this.lebende(S);
    if (!enemies.length) { this.fight(S); return; }   // nur die Lanze loslassen
    const t = this.waehleZiel(S, enemies, this.mountsOf(S));
    this.festesZiel = t.id;
    try { this.fight(Object.assign({}, S, { ship: Object.assign({}, S.ship, { target: t.id }) }), { zonen: false }); } finally { this.festesZiel = null; }
  }
  // Mine als Ziel: die Seitenbatterien feuern darauf (das Spiel waehlt die angewaehlte Mine, wenn sie im Bogen liegt); die Lanze und der Torpedowerfer treffen nur Gegner. true = Schuss gesendet.
  mineFeuern(S, rt) {
    if (this.game.ship.target !== rt.id || (this.memo.batAt || 0) >= S.time) return false;
    const M = this.mountsOf(S);
    const bat = ['port', 'stbd'].filter((id) => M[id] && M[id].charge >= 1 && !(M[id].salvo > 0) && M[id].state !== 'broken' && this.inArcM(S, M[id], rt, 6));
    if (!bat.length) return false;
    this.memo.batAt = S.time + 0.3;
    this.cmd('weapons.fire', { mount: bat.length === 2 ? 'all' : bat[0] });
    return true;
  }
  // ops.scan: der Scan haelt nur kurz (tscan.holdTimeout), der Agent haelt ihn wie ein Mensch (S halten) bis das Ziel gescannt ist, das Ziel wechselt oder die Frist ablaeuft
  scanHalten(S) {
    const h = this.absicht.halten.scan;
    if (!h) return;
    const e = S.space.enemies.find((q) => q.id === h.id);
    if (S.time > h.bis || this.game.ship.target !== h.id || (e && e.scanned)) { Absicht.haltenEnde(this.absicht, 'scan'); return; }
    if ((this.memo.scanBefAt || 0) < S.time) { this.memo.scanBefAt = S.time + 0.3; this.cmd('weapons.scan', { on: true }); }
  }
  naechsterGegner() {
    const sh = this.game.ship;
    return this.game.space.enemies.filter((e) => this.aufschaltbar(e)).sort((a, b) => dist(a.x, a.y, sh.x, sh.y) - dist(b.x, b.y, sh.x, sh.y))[0] || null;
  }
  // Waffengruppen der Befehle (Katalog v1): bug = Plaetze vorn, bb/stb = Seiten, torpedo = Torpedowerfer; Heck-Waffen (und der Turm) zaehlen nur zu 'alle'
  waffenGruppe(id) {
    const platz = Katalog.platzVonMount(id);
    if (platz == null) return null;
    const w = Katalog.waffe((this.game.ship.waffen || {})[platz]);
    if (w && w.art === 'torpedo') return 'torpedo';
    const seite = Katalog.PLATZ[platz].seite;
    return seite === 'vorn' ? 'bug' : seite === 'Bb' ? 'bb' : seite === 'Stb' ? 'stb' : null;
  }
  gruppeMounts(gruppe) { return Space.mountIds(this.game).filter((id) => this.waffenGruppe(id) === gruppe); }
  // Filter fuer weapons.charge / weapons.fire: null = nicht senden. feuer 'halt' sperrt alles, waffen beschraenkt auf eine Gruppe ('all' wird auf die erlaubten Batterien verkleinert).
  // Bekannt und harmlos: laedt die Lanze schon, wenn der Befehl kommt (waffen ausser bug, oder halt), wird auch ihr Loslassen (weapons.charge on:false) gefiltert; sie bleibt auf der erreichten power stehen (Feuer erst wieder auf Befehl).
  feuerErlaubt(c, extra) {
    const a = this.absicht;
    if (a.feuer === 'halt') return null;
    if (!a.waffen) return extra || {};
    const ok = (id) => this.waffenGruppe(id) === a.waffen;
    if (c === 'weapons.charge') return ok((extra && extra.mount) || 'bow') ? extra : null;
    const mount = extra && extra.mount;
    if (mount === 'all') { const ids = ['port', 'stbd'].filter(ok); return ids.length === 2 ? extra : ids.length ? Object.assign({}, extra, { mount: ids[0] }) : null; }
    return ok(mount) ? extra : null;
  }
  // Technik: schild (Sektor 0 bis 3) und prio ({ wert }) in absicht.halten
  schildVerteilung(S) {
    const sec = this.absicht.halten.schild;
    if (sec === undefined) { super.schildVerteilung(S); return; }
    this.schildHalten(S, sec);
  }
  // Schilde auf den gewaehlten Sektor verlagern (ein Punkt je Sekunde wie ein Mensch, auch ohne Gegner), bis er die Bot-Obergrenze oder die Kappe des Emitters erreicht; die anderen Seiten geben ab (zuerst die gegenueber)
  schildHalten(S, sec) {
    const sh = S.ship; const m = this.memo;
    if ((m.shieldAt || 0) >= S.time) return;
    const al = sh.shields.alloc; const cap = (sh.shields.cap || [8, 8, 8, 8]);
    const ziel = Math.min(cap[sec], BOT_SCHILD_SEKTOR_MAX);
    if (al[sec] >= ziel) return;
    m.shieldAt = S.time + 1;
    const pool = sh.shields.pool != null ? sh.shields.pool : 8;
    const used = al.reduce((x, y) => x + y, 0);
    if (used < pool) { this.technikCmd(S, 'technik.shield', { sector: sec, delta: 1 }); return; }
    const opp = (sec + 2) % 4;
    const donor = [0, 1, 2, 3].filter((i) => i !== sec && al[i] > 0).sort((x, y) => (y === opp ? 1 : 0) - (x === opp ? 1 : 0) || al[y] - al[x])[0];
    if (donor == null) return;
    this.technikCmd(S, 'technik.shield', { sector: donor, delta: -1 });
    this.technikCmd(S, 'technik.shield', { sector: sec, delta: 1 });
  }
  // Prioritaet halten: die Standard-Prioritaeten (Feuer zuerst, Reaktor) werden unterdrueckt (prioSperre in cmd), sonst ueberschriebe der naechste Tick sie. Ist der Reaktor zerstoert, gilt der Standard
  // (die Sonderreparatur geht vor); danach stellt der Agent die gehaltene Prioritaet wieder her. bot.automatik loest die Prioritaet wieder (prioLoesen).
  // Eine System-Prioritaet endet, sobald das System heil ist (das Spiel nimmt sie nur einmal, queueFront); Feuer und Leck bleiben gehalten.
  // m.prioLoesen = die Prioritaet (Wert), die der Agent am Captain/Technik-Platz noch zuruecknehmen muss (bot.automatik, System heil).
  queueRepairs(S) {
    const m = this.memo;
    this.prioErledigt();
    if (m.prioLoesen) {
      if (this.game.ship.priority !== m.prioLoesen) m.prioLoesen = false;   // schon anders (Mensch, Standard): nichts zuruecknehmen
      else if (this.technikCmd(S, 'technik.priority', { target: null })) { m.prioLoesen = false; m.firePrio = false; }
    }
    const prio = this.absicht.halten.prio;
    if (!prio || this.game.ship.systems.reactor === 'broken') { super.queueRepairs(S); return; }
    this.prioSperre = true;
    try { super.queueRepairs(S); } finally { this.prioSperre = false; }
    if (this.game.ship.priority !== prio.wert && (m.prioAt || 0) < S.time) { m.prioAt = S.time + 1; this.technikCmd(S, 'technik.priority', { target: prio.wert }); }
  }
  prioErledigt() {
    const h = this.absicht.halten.prio;
    if (!h || PRIO_DAUERHAFT.includes(h.wert) || this.game.ship.systems[h.wert] !== 'ok') return false;
    Absicht.haltenEnde(this.absicht, 'prio'); this.befehlGrund = 'erledigt'; this.memo.prioLoesen = h.wert;
    return true;
  }
  // Die vom Bot gesetzte Prioritaet (halten.prio) zuruecknehmen, ohne dass der Bot etwas sendet: ein Mensch uebernimmt, der Platz wird geraeumt, der Bot faellt aus oder ist nicht an Bord.
  // Der Server schreibt es (Lauf.prioritaetLoesen); eine Prioritaet, die ein Mensch gesetzt hat (ship.priority anders als gehalten), bleibt unangetastet. true = zurueckgenommen.
  prioritaetZuruecknehmen() {
    const h = this.absicht.halten.prio;
    if (!h) return false;
    this.memo.prioLoesen = false;
    if (!this.lauf.prioritaetLoesen(h.wert)) return false;
    this.memo.firePrio = false;
    return true;
  }
  // Einmal-Aktion: sendet cmd ueber den Wachposten und liefert die Antwort des Spiels (Text der Ablehnung) oder null = angenommen. Die Verbindung des Bots hoert dabei kurz die notice mit.
  einmalig(c, extra) {
    const texte = []; const conn = this.conn; const alt = conn.send; const n0 = this.befehle;
    conn.send = (o) => { if (o && o.t === 'event' && o.kind === 'notice' && o.pid === this.pid) texte.push(o.text); };
    try { this.send(Object.assign({ t: 'cmd', c }, extra || {})); } finally { conn.send = alt; }
    if (this.befehle === n0) return 'Nicht gesendet.';
    return texte.length ? texte[0] : null;
  }
  // bot.automatik: alles Gehaltene weg (Befehl, Feuerzustand, Technik-Einstellungen), Standardverhalten; die gehaltene Prioritaet der Technik wird zurueckgenommen
  automatik() {
    const prio = this.absicht.halten.prio;
    this.alleVerwerfen('automatik');
    if (prio) this.memo.prioLoesen = prio.wert;
  }
  // Alles Gehaltene verwerfen (Mensch uebernimmt, bot.automatik); true = es gab etwas
  alleVerwerfen(grund) {
    const a = this.absicht;
    if (grund !== 'automatik') this.prioritaetZuruecknehmen();   // Mensch, Raeumen, unten: der Bot sendet nichts mehr, der Server nimmt seine Prioritaet zurueck (bot.automatik nimmt sie selbst per cmd zurueck)
    const hatte = !!(a.befehl || a.feuer || Object.keys(a.halten).length);
    if (grund !== 'bord') this.bordLoeschen();   // BOT-02 B2: der Beginn des Dienstes verwirft den Befehl nicht (er kann im selben Tick angenommen worden sein)
    Absicht.alleEnde(a);
    if (hatte) this.befehlGrund = grund;
    return hatte;
  }
  feuerSetzen(feuer, waffen) { Absicht.feuerSetzen(this.absicht, feuer, waffen); this.befehlGrund = null; }
  haltenSetzen(name, wert) { Absicht.haltenSetzen(this.absicht, name, wert); this.befehlGrund = null; }

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
      case 'nav.sprung': return this.sprungAusfuehren(S, b);
      case 'nav.schub': this.schubHalten(S); return true;
      default: this.befehlVerwerfen('unbekannt'); return false;
    }
  }
  // Ziel verschwunden (markiertes Ziel zerstoert, Szene gewechselt): der Befehl endet, der Bot haelt an
  zielWeg(S) { this.anhalten('ziel_weg'); return true; }
  // Befehl beenden und das Schiff anhalten (Allstopp; angedockt steht es schon), sonst fliegt es mit der letzten Stufe weiter
  anhalten(grund) { this.befehlVerwerfen(grund); if (!this.game.ship.docked) this.cmd('helm.stop'); }
  // Ladungen (Telegraph) und nahe Geschosse: ausweichen wie im Gefecht, ohne Position zu kaempfen. Der Projektil-Reflex ist eine Kopie aus kern.js helmFight (90 px, dodgeCd, 1 s Sperre, Golden-Basis): beide Stellen synchron halten
  // (tools/test-bot-befehle-nav.js vergleicht die Schwellen aus den Quelltexten).
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
  // Der Befehl endet (Standardverhalten, im Gefecht helmFight), wenn das gewaehlte Ziel kippt (Sprungpunkt-Automatik, Captain waehlt neu) oder die Lage den Sprung sperrt (Stoersender, Antrieb ohne Energie, Aussenteam, Transfer, Missionssperre).
  sprungAusfuehren(S, b) {
    const j = this.game.ship.jump || {};
    if (this.game.reise) return true;
    if (!j.dest) { this.befehlVerwerfen('ziel_weg'); return false; }
    if (j.dest !== b.dest) { this.befehlVerwerfen('ziel_geaendert'); return false; }
    if (!Navziel.sprungGrundOffen(j.blockedReason)) { this.befehlVerwerfen('blockiert'); return false; }
    if (j.ready) { this.cmd(this.game.reisePlan ? 'helm.schnellsprung' : 'helm.jump'); return true; }
    this.ausweichenImBefehl(S);
    this.flyClear(S);
    return true;
  }
  // nav.schub: die Stufe des Captains halten (auch im Gefecht), Kurs halten, am Kartenrand zur Mitte, Felsen ausweichen (freierWinkel wie steer), Ladungen und Geschossen ausweichen. Schub 0 ist nav.stopp und keine Absicht.
  schubHalten(S) {
    this.ausweichenImBefehl(S);
    const sh = S.ship;
    const stage = this.absicht.befehl.stage;
    if (stage < STOP) {   // rueckwaerts: das Heck fliegt voraus; Kartenrand und Felsen werden vom Heck aus gesehen, das Ruder dreht das Heck mit dem Bug
      const r = this.randNachMitte(S);
      const flug = sh.angle + Math.PI;
      const wunsch = this.freierWinkel(S, flug + (r === 0 ? 0 : norm(r - Math.PI)), 280);
      this.helmS(S, this.turnCmd(S, norm(wunsch - flug)), stage);
      return;
    }
    const wunsch = this.freierWinkel(S, sh.angle + this.randNachMitte(S), 280);
    this.helmS(S, this.turnCmd(S, norm(wunsch - sh.angle)), stage);
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
