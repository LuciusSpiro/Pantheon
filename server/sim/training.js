'use strict';
// TRA-01 A1: Rahmen der Trainingsmodi (Lobby-Modi training_fliegen, training_captain) nach dem Muster arena_forschung (UEB-01),
// aber tabellengesteuert: ein neuer Modus ist ein Eintrag in TRAININGSMODI, kein neuer if-Zweig im Spielcode.
//   TRAININGSMODI        Tabelle Modus -> { buch, ort, angedockt, consoleHelpAus, sprachwahl, startSchritt? }
//   KINDS                Schlüssel der Tabelle (arena.js hängt sie an seine KINDS)
//   istTraining(kind)    Ist dies ein Trainingsmodus?
//   hatSprachwahl(kind)  Kennt der Modus die Lobby-Option trainingSprache?
//   laeuft(game)         Läuft gerade eine Trainingspartie (game.arena.training gesetzt)?
//   consoleHelpAus(game) Soll die ODA-Zeile CONSOLE_HELP (mission.js, consoleEnter) unterbleiben?
//   start(game, kind)    Ausgangszustand herstellen, Platzhalter-/Trainingsbuch direkt starten (startMissionAb), ohne Kette
//   update(game)         Tick: Szenenende melden, Neustart nach Verlust
//   neustart(game)       Szene von vorn
// Direktstart ohne Kampagnenkette, ohne persistenten Weltstand (g.weltstand ist nie persistent, damit tutorialLaeuft true: Sprünge nur im
// Saumraum, bewusst), kein Testgeld (arena.istUebungsszene). Karte ist der Standard limes: kein Eintrag in UEBUNG_WELTEN (game.js).
// Neues Buch eintragen: Datei content/regiebuecher/<buch>.regiebuch.json mit kopf.art 'intern', in TRAININGSMODI unter buch nennen.
// game.arena.training = { modus, sprache, start, versuch, verlustAb, gemeldet }; Lobby-Option trainingSprache (nur Captain) landet in sprache.
const NEUSTART_MAX_WARTEN = 30;   // s nach dem Verlust (wie uebung-forschung.js)
const FERTIG_FLAG = 'trainingFertig';   // Buchflag (erwartet im Buch): gesetzt = Training geschafft, update() schließt das Buch mit erfolg ab

const TRAININGSMODI = {
  training_fliegen: { buch: 'tra_fliegen', ort: 'hafen', angedockt: true, consoleHelpAus: true, sprachwahl: false },
  training_captain: { buch: 'tra_captain', ort: 'hafen', angedockt: true, consoleHelpAus: true, sprachwahl: true },
};
const KINDS = Object.keys(TRAININGSMODI);

function arena() { return require('./arena.js'); }   // lazy: arena.js bindet dieses Modul beim Start ein
function istTraining(kind) { return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(TRAININGSMODI, kind); }
function hatSprachwahl(kind) { return istTraining(kind) && TRAININGSMODI[kind].sprachwahl === true; }
function stand(game) { return game && game.arena && game.arena.training || null; }
function laeuft(game) { return !!(game && game.arena && istTraining(game.arena.kind) && game.arena.training); }
function def(game) { const T = stand(game); return T ? TRAININGSMODI[T.modus] : null; }
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
  A.repairShip(game);
  A.placeOnBridge(game);
}

function buchStarten(game) {
  const m = game.mission; const d = def(game);
  if (d.startSchritt) m.startMissionAb(d.buch, d.startSchritt);   // optional: mitten im Buch beginnen (wie UEB-01)
  else m.startMission(d.buch);
  if (m.activeId !== d.buch) { game.countError('training', new Error('Buch ' + d.buch + ' startet nicht')); return false; }
  return true;
}

function start(game, kind) {
  const d = TRAININGSMODI[kind];
  const sprache = !!(d.sprachwahl && game.lobbyOpts && game.lobbyOpts.trainingSprache === true);
  game.arena = { kind, training: { modus: kind, sprache, start: game.time, versuch: 1, verlustAb: null, gemeldet: false } };
  ausgangszustand(game);
  buchStarten(game);
  game.log('Training gestartet: ' + kind + (sprache ? ' (mit Sprache)' : '') + '.');
}

function neustart(game) {
  const T = stand(game);
  ausgangszustand(game);
  T.versuch++; T.verlustAb = null; T.gemeldet = false;
  game.mission.flags[FERTIG_FLAG] = false;
  buchStarten(game);
  game.log('Training ' + T.modus + ': Neustart (Versuch ' + T.versuch + ').');
}

function szeneDurch(game) {
  const T = stand(game);
  if (T.gemeldet) return;
  T.gemeldet = true;
  game.oda('Training geschafft. Esc → „Partie beenden“ führt zurück in die Lobby.', null);
}

function update(game) {
  const T = stand(game);
  if (!T || game.phase !== 'play') return;
  const m = game.mission; const d = TRAININGSMODI[T.modus];
  const ms = m.missions[d.buch];
  if (ms && ms.state === 'done') {
    if (ms.ausgang === 'verloren') {
      if (T.verlustAb == null) T.verlustAb = game.time;
      const obenAlle = game.players.every((p) => p.zone !== 'away' && !p.downed);
      if (obenAlle || game.time - T.verlustAb >= NEUSTART_MAX_WARTEN) neustart(game);
    } else szeneDurch(game);
    return;
  }
  if (m.activeId === d.buch && m.flags[FERTIG_FLAG] === true) { m.completeMission('erfolg'); szeneDurch(game); }
}

module.exports = { TRAININGSMODI, KINDS, istTraining, hatSprachwahl, laeuft, consoleHelpAus, start, update, neustart };
