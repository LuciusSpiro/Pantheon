'use strict';
// TRA-01 A1: Rahmen der Trainingsmodi (Lobby-Modi training_fliegen, training_captain) nach dem Muster arena_forschung (UEB-01),
// aber tabellengesteuert: ein neuer Modus ist ein Eintrag in TRAININGSMODI, kein neuer if-Zweig im Spielcode.
//   TRAININGSMODI        Tabelle Modus -> { buch, ort, angedockt, consoleHelpAus, sprachwahl, abzeichen, startSchritt?, buchSprache?, bots?, konsole?, vorerkunden?, halter? }
//                        TRA-01 E (Captain): buchSprache = Buch der Sprachvariante (Lobby-Option trainingSprache), bots = Rollen der Bots (vor dem Start angelegt, botsVorStart),
//                        konsole = Konsole, an die sich der Mensch setzt, vorerkunden = { hex: [...], kanten: [[a, b], ...] } (Sprungvorerkundung, explore.vorerkunden),
//                        halter = je Tick laufende Wächter aus training-captain.js (HALTER)
//   KINDS                Schlüssel der Tabelle (arena.js hängt sie an seine KINDS)
//   istTraining(kind)    Ist dies ein Trainingsmodus?
//   hatSprachwahl(kind)  Kennt der Modus die Lobby-Option trainingSprache?
//   laeuft(game)         Läuft gerade eine Trainingspartie (game.arena.training gesetzt)?
//   buchFuer(game)       Id des laufenden Trainingsbuchs (Standardbuch oder Sprachvariante buchSprache)
//   consoleHelpAus(game) Soll die ODA-Zeile CONSOLE_HELP (mission.js, consoleEnter) unterbleiben?
//   botsVorStart(game)   TRA-01 E: Aufruf am Anfang von startGame (Lobby-Phase), Rückgabe false = Start abgelehnt (refuseStart). Trainingsmodi sind Ein-Spieler-Modi: mehr als ein Mensch -> abgelehnt;
//                        sonst alle Lobby-Bots räumen und die Bots des Modus (Tabellenfeld bots) in fester Reihenfolge neu anlegen (Fliegen: keine). Anderer Modus oder gewählter Weltstand: ohne Wirkung, true
//   botsNachTrainingRaeumen(game)  Weg in die Lobby (game.js zurLobby): die Trainings-Bots verlassen die Lobby
//   buchflagsZuruecksetzen(game)   Neustart: alle erwartet-Flags des Trainingsbuchs zurück auf ihren Standard
//   start(game, kind)    Ausgangszustand herstellen, Platzhalter-/Trainingsbuch direkt starten (startMissionAb), ohne Kette
//   update(game)         Tick: Erkennung pollen (training-erkennung.js), Szenenende melden, Neustart nach Verlust und NEUSTART_NACH_ERFOLG s nach Erfolg
//   ereignis(game, n, d) Weiterleitung von mission.onEvent an die Erkennung (flüchtige Ereignisse)
//   neustart(game)       Szene von vorn
//   vorerkundenAnwenden(game)  Tabellenfeld vorerkunden { hexe, kanten } (explore.vorerkunden): Start und Neustart; ohne Feld nichts
//   reiseWerteSetzen(game)     Tabellenfeld reise (Überlagerung von C.reise in game.reiseWerte, z. B. kein Abfangen im Schnellsprung); Start
//   sprungzielSetzen(game, ort)  Der Modus setzt das Sprungziel (selectDest, zählt nicht als sprungziel_gewaehlt); Buch-Aktion training_sprungziel
//   abzeichenVergeben(game, id)  Abzeichen-Meldung (Broadcast EVT_ABZEICHEN { id, variante? }) plus ODA-Zeile, genau einmal je Versuch
// Direktstart ohne Kampagnenkette, ohne persistenten Weltstand (g.weltstand ist nie persistent, damit tutorialLaeuft true: Sprünge nur im
// Saumraum, bewusst), kein Testgeld (arena.istUebungsszene). Karte ist der Standard limes: kein Eintrag in UEBUNG_WELTEN (game.js).
// Neues Buch eintragen: Datei content/regiebuecher/<buch>.regiebuch.json mit kopf.art 'intern', in TRAININGSMODI unter buch nennen.
// game.arena.training = { modus, sprache, start, versuch, verlustAb, gemeldet, erfolgAb, abzeichenVersuch, erreicht, erk, repariere, uebung, uebungOrt }; Lobby-Option trainingSprache (nur Captain) landet in sprache.
// Tabellenfelder (optional): vorerkunden { hexe: [Hex…], kanten: [Kanten-Id…] } und reise { feindChance, neutralChance, … } (TRA-01 D, Fliegen; Captain nutzt dieselben Felder).
//   erreicht = Set der erkannten Ziel-Ids, erk = Ausgangslage des letzten Ticks, repariere = befohlene Reparaturen (alles training-erkennung.js), uebung = Übungsziele (training-captain.js); kein Snapshot-Feld.
const Erkennung = require('./training-erkennung.js');
const Crew = require('./crew.js');
const lazy = (p) => { let m = null; return () => m || (m = require(p)); };
const Captain = lazy('./training-captain.js');   // TRA-01 E: Bots, Übungsziele, Wächter (schwere Abhängigkeiten erst beim Gebrauch)
const NEUSTART_MAX_WARTEN = 30;   // s nach dem Verlust (wie uebung-forschung.js)
const NEUSTART_NACH_ERFOLG = require('../../shared/protocol.js').TRAINING_NEUSTART_S;   // s nach Erfolg (8; der Client zeigt dieselbe Zahl) und Abzeichen-Meldung: Szene von vorn, damit man wiederholen kann
const FERTIG_FLAG = 'trainingFertig';   // Buchflag (erwartet im Buch): gesetzt = Training geschafft, update() schließt das Buch mit erfolg ab

const TRAININGSMODI = {
  training_fliegen: { buch: 'tra_fliegen', ort: 'hafen', angedockt: true, consoleHelpAus: true, sprachwahl: false, abzeichen: 'fliegen',
    vorerkunden: { hexe: ['0206', '0306', '0406', '0405', '0207'], kanten: ['0206-0306', '0306-0406', '0306-0405', '0206-0207'] },   // Faltsprung der Übung hafen <-> vaelen (0207, ruhig: Händler, keine Brocken), Schnellsprung hafen -> b7 über splitter (nur Zwischenhalt) und zurück: erkundete Hexe, bekannte Bojen
    reise: { feindChance: 0, neutralChance: 0, neutralPlus: 0, neutralMax: 0 } },   // kein Abfangen im Schnellsprung: Fliegen ist gegnerfrei
  training_captain: { buch: 'tra_captain', buchSprache: 'tra_captain_sprache', ort: 'hafen', angedockt: true, consoleHelpAus: true, sprachwahl: true, abzeichen: 'captain',
    bots: ['navigation', 'ops', 'technik'], konsole: 'captain', halter: ['feuersperre', 'uebungsziele', 'reiseruhe', 'sicherheitsstopp', 'reparaturnachlegen'],
    // Saumraum: hafen (0206) -> splitter (0306) -> b7 (0406), wrack (0405), vaelen (0207): Schnellsprung braucht erkundete Hexe und bekannte Bojen (E0 F4)
    vorerkunden: { hexe: ['0206', '0306', '0406', '0405', '0207'], kanten: ['0206-0306', '0306-0406', '0306-0405', '0405-0406', '0206-0207'] } },
};
// Abzeichen: Name für die ODA-Zeile; Varianten (nur Captain: Tafel/Tasten oder Sprache) mit Anhang. Ohne Wirkung im Spiel, der Client merkt sie sich.
const ABZEICHEN = {
  fliegen: { name: 'Fliegen' },
  captain: { name: 'Captain', varianten: { tafel: 'Befehlstafel', sprache: 'mit Sprache' } },
};
const KINDS = Object.keys(TRAININGSMODI);

const Protocol = require('../../shared/protocol.js');
function arena() { return require('./arena.js'); }   // lazy: arena.js bindet dieses Modul beim Start ein
function istTraining(kind) { return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(TRAININGSMODI, kind); }
function hatSprachwahl(kind) { return istTraining(kind) && TRAININGSMODI[kind].sprachwahl === true; }
function stand(game) { return game && game.arena && game.arena.training || null; }
function laeuft(game) { return !!(game && game.arena && istTraining(game.arena.kind) && game.arena.training); }
function def(game) { const T = stand(game); return T ? TRAININGSMODI[T.modus] : null; }
// Buch der laufenden Partie: die Sprachvariante, wenn der Modus eines hat und trainingSprache gewählt war, sonst das Standardbuch
function buchFuer(game) { const d = def(game); return game.arena.training.sprache && d.buchSprache ? d.buchSprache : d.buch; }
function consoleHelpAus(game) { const d = def(game); return !!(d && d.consoleHelpAus); }

// Der Ausgangszustand der Szene, eine Funktion für Start und Neustart (wiederholbar)
function ausgangszustand(game) {
  const A = arena();
  const interior = require('./interior.js');
  const space = require('./space.js');
  const Locations = require('../../shared/locations.js');
  const d = def(game);
  for (const p of game.players) {
    if (p.downed) interior.revivePlayer(game, p);
    p.hp = game.C.player.hp;
    if (p.zone === 'away') interior.placeOnShipPad(game, p);
  }
  const loc = Locations.get(d.ort) ? d.ort : 'hafen';
  const ex = game.explore;   // Ort still bekannt/besucht (keine Erstbesuch-Ansage, keine Marken)
  if (!ex.known.has(loc)) { ex.known.add(loc); ex.version++; }
  if (!ex.visited.has(loc)) { ex.visited.add(loc); ex.version++; }
  space.enterScene(game, loc, { docked: d.angedockt === true });
  vorerkundenAnwenden(game);
  A.repairShip(game);
  A.placeOnBridge(game);
  if (d.konsole) Captain().konsoleBesetzen(game, d.konsole);   // TRA-01 E: Mensch an die Konsole (Captain), nach placeOnBridge
}

// TRA-01 E: Aufruf am Anfang von startGame (Lobby-Phase, vor Loadout.slotzahlFestsetzen): Trainingsmodi mit Tabellenfeld bots bekommen ihre Bots; nur danach lässt botHinzufuegen die Phase 'play' nicht ab
function botsVorStart(game) {
  const kind = game.lobbyOpts && game.lobbyOpts.startMission;
  if (!istTraining(kind) || game.lobbyOpts.world) return true;   // ein gewählter Weltstand setzt die Partie fort (startGame), kein Trainingsstart
  if (Crew.menschen(game) > 1) { game.refuseStart('Training ist ein Ein-Spieler-Modus: Mit mehreren Spielern startet es nicht.'); return false; }
  require('../bots/spieler.js').alleBotsRaeumen(game);
  if (TRAININGSMODI[kind].bots) Captain().botsAnlegen(game, TRAININGSMODI[kind].bots);
  return true;
}
// Weg in die Lobby: nur Trainings-Bots (Markierung trainingBot) gehen; ohne solche Bots wird training-captain.js nicht geladen
function botsNachTrainingRaeumen(game) {
  return game.players.some((p) => p.trainingBot) ? Captain().botsNachTrainingRaeumen(game) : 0;
}

// Start-Setup aus der Tabelle (TRA-01 D): Hexe/Bojen still als erkundet vormerken, damit der Schnellsprung eine Route findet (explore.vorerkunden, SUND-01 E)
function vorerkundenAnwenden(game) {
  const d = def(game); const v = d && d.vorerkunden;
  if (v) game.explore.vorerkunden(v.hexe, v.kanten);
}
// Überlagerung von C.reise für diese Partie (Reise.reset leert sie beim Verlassen)
function reiseWerteSetzen(game) {
  const d = def(game);
  game.reiseWerte = d && d.reise ? Object.assign({}, d.reise) : null;
}
// Der Modus setzt das Sprungziel (Buch-Aktion training_sprungziel). Der Mensch am Steuer wählt nie selbst; der Wechsel des Ziels zählt nicht als sprungziel_gewaehlt.
// Rückgabe: Fehlertext von selectDest | null
function sprungzielSetzen(game, ort) {
  const err = require('./space.js').selectDest(game, ort);
  if (err) { game.countError('training', new Error('Sprungziel ' + ort + ': ' + err)); return err; }
  const T = stand(game);
  if (T && T.erk) T.erk.dest = game.ship.jump.dest || null;   // Ausgangslage nachziehen: das Pollen sieht keine Zielwahl
  return null;
}

function buchStarten(game) {
  const m = game.mission; const d = def(game);
  const buch = buchFuer(game);
  if (d.startSchritt) m.startMissionAb(buch, d.startSchritt);   // optional: mitten im Buch beginnen (wie UEB-01)
  else m.startMission(buch);
  if (m.activeId !== buch) { game.countError('training', new Error('Buch ' + buch + ' startet nicht')); return false; }
  return true;
}

function start(game, kind) {
  const d = TRAININGSMODI[kind];
  const sprache = !!(d.sprachwahl && game.lobbyOpts && game.lobbyOpts.trainingSprache === true);
  game.arena = { kind, training: { modus: kind, sprache, start: game.time, versuch: 1, verlustAb: null, gemeldet: false, erfolgAb: null, abzeichenVersuch: 0 } };
  reiseWerteSetzen(game);
  ausgangszustand(game);
  Erkennung.zuruecksetzen(game);   // nach dem Ausgangszustand: was beim Herrichten der Szene geschah, zählt nicht
  buchStarten(game);
  if (d.bots) Captain().ansagenStummschalten(game);   // TRA-01 E: nach dem Start des Buchs (Schrittnamen), Schlüssel gelten für die Partie
  game.log('Training gestartet: ' + kind + (sprache ? ' (mit Sprache)' : '') + '.');
}

// Alle Flags, die das Buch unter erwartet deklariert, auf ihren Standard (applyExpected setzt nur fehlende Flags): ein zweiter Versuch beginnt mit leerer Checkliste
function buchflagsZuruecksetzen(game) {
  const buch = game.mission.loadDef(buchFuer(game));
  for (const [k, v] of Object.entries((buch && buch.erwartet) || {})) game.mission.flags[k] = v;
}

function neustart(game) {
  const T = stand(game);
  if (def(game).bots) Captain().neuAufsetzen(game);   // TRA-01 E: Übungsziele weg, Absicht der Bots zurück (die Bots bleiben)
  ausgangszustand(game);
  T.versuch++; T.verlustAb = null; T.gemeldet = false; T.erfolgAb = null;
  buchflagsZuruecksetzen(game);   // enthält FERTIG_FLAG
  Erkennung.zuruecksetzen(game);
  buchStarten(game);
  game.log('Training ' + T.modus + ': Neustart (Versuch ' + T.versuch + ').');
}

// Abzeichen für das geschaffte Training: Broadcast + ODA-Zeile, einmal je Versuch (auch bei direktem Aufruf). Rückgabe: wurde gesendet?
function abzeichenVergeben(game, id) {
  const T = stand(game); const a = ABZEICHEN[id];
  if (!T || !a || T.abzeichenVersuch === T.versuch) return false;
  T.abzeichenVersuch = T.versuch;
  const variante = a.varianten ? (T.sprache ? 'sprache' : 'tafel') : null;
  game.emit(Protocol.EVT_ABZEICHEN, variante ? { id, variante } : { id });
  game.oda('Abzeichen erreicht: ' + a.name + (variante ? ' (' + a.varianten[variante] + ')' : '') + '.', null);
  return true;
}

// TRA-01 E: benannte Buchaktion (Baustein training_aktion) aus training-captain.js; kennt der Modus sie nicht, ist es ein Fehler des Buchs
function aktion(game, name) {
  const fn = Captain().AKTIONEN[name];
  if (!fn) { game.countError('training', new Error('Unbekannte Trainingsaktion ' + name)); return false; }
  fn(game); return true;
}

function szeneDurch(game) {
  const T = stand(game);
  if (T.gemeldet) return;
  T.gemeldet = true; T.erfolgAb = game.time;
  game.oda('Training geschafft. In ' + NEUSTART_NACH_ERFOLG + ' s geht es von vorn los; Esc → „Partie beenden“ führt zurück in die Lobby.', null);
  abzeichenVergeben(game, def(game).abzeichen);
}

// Erkennung nie den Tick abbrechen lassen
function erkennen(game) { try { Erkennung.update(game); } catch (e) { game.countError('training-erkennung', e); } }
function ereignis(game, name, data) { if (laeuft(game)) Erkennung.ereignis(game, name, data); }

// TRA-01 E: die Wächter des Modus (Tabellenfeld halter), nie den Tick abbrechen lassen
function halten(game, d) {
  if (!d.halter) return;
  for (const name of d.halter) { try { Captain().HALTER[name](game); } catch (e) { game.countError('training-halter', e); } }
}

function update(game) {
  const T = stand(game);
  if (!T || game.phase !== 'play') return;
  const m = game.mission; const d = TRAININGSMODI[T.modus]; const buch = buchFuer(game);
  const ms = m.missions[buch];
  if (ms && ms.state === 'done') {
    if (ms.ausgang === 'verloren') {
      if (T.verlustAb == null) T.verlustAb = game.time;
      const obenAlle = game.players.every((p) => p.zone !== 'away' && !p.downed);
      if (obenAlle || game.time - T.verlustAb >= NEUSTART_MAX_WARTEN) neustart(game);
    } else {
      szeneDurch(game);
      if (game.time - T.erfolgAb >= NEUSTART_NACH_ERFOLG) neustart(game);
    }
    return;
  }
  if (m.activeId === buch) { erkennen(game); halten(game, d); }
  if (m.activeId === buch && m.flags[FERTIG_FLAG] === true) { m.completeMission('erfolg'); szeneDurch(game); }
}

module.exports = { TRAININGSMODI, ABZEICHEN, NEUSTART_NACH_ERFOLG, KINDS, istTraining, hatSprachwahl, laeuft, consoleHelpAus, buchFuer, botsVorStart, botsNachTrainingRaeumen, buchflagsZuruecksetzen, start, update, ereignis, neustart, abzeichenVergeben, aktion, vorerkundenAnwenden, reiseWerteSetzen, sprungzielSetzen };
