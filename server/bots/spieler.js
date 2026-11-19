'use strict';
// BOT-01 B2: Bots als Spieler auf Slots (Vertrag Bot-Befehle §1). Action-Layer der Lobby: jede Nachricht lobbyBot { op } hat genau eine Funktion hier, game.js verteilt nur.
//   botHinzufuegen(game, spieler, rolle)         op 'add': neuer Bot auf dem kleinsten freien Platz (Lobby; Rolle gueltig und frei; hoechstens maxPlayers - 1 Bots, nie ueber maxPlayers Spieler)
//   botWuerfeln(game, spieler, pid)              op 'wuerfeln': neue Zufallskarte und Name, Platz/Id/Rolle/Farbe bleiben
//   botEntfernen(game, spieler, pid)             op 'weg': Bot aus der Lobby
//   botRolleWechseln(game, spieler, pid, rolle)  op 'rolle': Rolle auf eine freie wechseln
//   botVerdraengtFuerMensch(game)                ein Mensch tritt bei vollem Server bei: der zuletzt hinzugefuegte Bot raeumt (Lobby: weg; Partie: wird zum freien, nicht verbundenen Platz); sonst nichts
//   botsNachLetztemMenschenRaeumen(game)         Lobby ohne Mensch: alle Bots weg
// `spieler` ist der Mensch, der die Aenderung verlangt; Ablehnungen gehen als notice an ihn. Rueckgabe der Befehle: true = geaendert, false = abgelehnt (nichts geaendert).
// Bots tragen bot: true, rolle, botId (b0..b3), stimme (null, spaeter BOT-04/05) und keine clientId (clientId null; onHello sucht zusaetzlich nie unter Bots); Menschen tragen diese Felder nie. Bots bekommen nie Farbe 0 (die gehoert dem ersten Menschen, Kontingent-Frage).
// Zufall nur hier (Lobby, nie in der Simulation): game.botZufall (Tests) oder Math.random.
const Crew = require('../sim/crew.js');

let namenPool = [];
try { namenPool = require('../../content/bots/namen.json').namen || []; } catch (e) { namenPool = []; }

const ROLLEN = ['navigation', 'ops', 'technik'];
const BOT_IDS = ['b0', 'b1', 'b2', 'b3'];
const NUR_LOBBY = 'Bots lassen sich nur in der Lobby ändern.';

const bots = (game) => game.players.filter((p) => Crew.istBot(p));
const zufallVon = (game) => (typeof game.botZufall === 'function' ? game.botZufall : Math.random);
const botMitId = (game, pid) => game.players.find((p) => p.id === pid && Crew.istBot(p)) || null;
const rolleFrei = (game, rolle) => !bots(game).some((b) => b.rolle === rolle);
const verweigere = (game, spieler, text) => { if (spieler) game.notice(spieler, text); return false; };

function kleinsteFreieId(game) {
  const belegt = new Set(game.players.map((o) => o.id));
  let n = 1; while (belegt.has('p' + n)) n++;
  return 'p' + n;
}
function kleinsteFreieBotId(game) { return BOT_IDS.find((id) => !bots(game).some((b) => b.botId === id)) || null; }
// Bots nehmen die kleinste freie Farbe ab 1; Farbe 0 bleibt dem ersten Menschen (applyColorWish der Menschen bleibt unberuehrt)
function botFarbe(game) {
  const belegt = new Set(game.players.filter((o) => o.color != null).map((o) => o.color));
  for (let c = 1; c < game.C.maxPlayers; c++) if (!belegt.has(c)) return c;
  return null;
}
// die Karte gehört game.js (dort liegen Katalog und Kartenverteilung, tools/test-trefferbox.js): hier nur der Wunsch nach einer neuen Zufallskarte
const karteSetzen = (game, b) => game.botKarteWuerfeln(b, zufallVon(game), namenPool);
// Bot aus der Lobby nehmen, wie wenn ein Mensch die Lobby verlaesst (Karte raeumen, Spieler filtern, Telemetrie)
function ausLobbyNehmen(game, b) {
  game.raeumeKarte(b);
  game.players = game.players.filter((o) => o !== b);
  game.telemetrie.spielerWeg(b.id);
}

function botHinzufuegen(game, spieler, rolle) {
  if (game.phase !== 'lobby') return verweigere(game, spieler, NUR_LOBBY);
  if (!ROLLEN.includes(rolle)) return verweigere(game, spieler, 'Unbekannte Rolle.');
  if (!rolleFrei(game, rolle)) return verweigere(game, spieler, 'Diese Rolle ist schon mit einem Bot besetzt.');
  const farbe = botFarbe(game), botId = kleinsteFreieBotId(game);
  if (bots(game).length >= game.C.maxPlayers - 1 || game.players.length >= game.C.maxPlayers || farbe === null || botId === null) return verweigere(game, spieler, 'Kein Platz für einen weiteren Bot.');
  const id = kleinsteFreieId(game);
  const b = { id, clientId: null, name: id, color: farbe, ready: true, connected: true, conn: { send() {}, close() {}, bot: true }, lastSeq: 0,
    bot: true, rolle, botId, stimme: null };
  game.resetPlayer(b, game.players.length);
  game.players.push(b);
  karteSetzen(game, b);
  game.telemetrie.spielerBei(b.id, 'neu', false);
  game.log(`Bot ${b.name} (${b.id}, ${rolle}) hinzugefügt.`);
  return true;
}

function botWuerfeln(game, spieler, pid) {
  if (game.phase !== 'lobby') return verweigere(game, spieler, NUR_LOBBY);
  const b = botMitId(game, pid);
  if (!b) return verweigere(game, spieler, 'Das ist kein Bot.');
  karteSetzen(game, b);
  return true;
}

function botEntfernen(game, spieler, pid) {
  if (game.phase !== 'lobby') return verweigere(game, spieler, NUR_LOBBY);
  const b = botMitId(game, pid);
  if (!b) return verweigere(game, spieler, 'Das ist kein Bot.');
  ausLobbyNehmen(game, b);
  game.log(`Bot ${b.name} (${b.id}) entfernt.`);
  game.checkLobbyStart();
  return true;
}

function botRolleWechseln(game, spieler, pid, rolle) {
  if (game.phase !== 'lobby') return verweigere(game, spieler, NUR_LOBBY);
  const b = botMitId(game, pid);
  if (!b) return verweigere(game, spieler, 'Das ist kein Bot.');
  if (!ROLLEN.includes(rolle)) return verweigere(game, spieler, 'Unbekannte Rolle.');
  if (b.rolle === rolle) return false;
  if (!rolleFrei(game, rolle)) return verweigere(game, spieler, 'Diese Rolle ist schon mit einem Bot besetzt.');
  b.rolle = rolle;
  return true;
}

// Verteiler der Nachricht lobbyBot: je op genau eine der Funktionen oben, unbekannte op wird abgelehnt
function lobbyBotBefehl(game, spieler, msg) {
  switch (msg && msg.op) {
    case 'add': return botHinzufuegen(game, spieler, msg.rolle);
    case 'wuerfeln': return botWuerfeln(game, spieler, msg.pid);
    case 'weg': return botEntfernen(game, spieler, msg.pid);
    case 'rolle': return botRolleWechseln(game, spieler, msg.pid, msg.rolle);
    default: return verweigere(game, spieler, 'Unbekannter Bot-Befehl.');
  }
}

// Partie: der Platz bleibt in players (Indizes, Spawns), wird aber ein freier, nicht verbundener Platz, den der Uebernahmeweg in onHello nutzt
function zuFreiemPlatz(game, b) {
  game.platzFreigeben(b, 'abgang');
  b.connected = false; b.conn = null; b.clientId = null;
  delete b.bot; delete b.rolle; delete b.botId; delete b.stimme;
  game.karteVergessen(b);
  b.name = 'Crew ' + b.id.slice(1);
  game.telemetrie.spielerWeg(b.id);
  game.log(`Bot-Platz ${b.id} geräumt für einen Menschen.`);
}

function botVerdraengtFuerMensch(game) {
  if (game.players.length < game.C.maxPlayers || game.players.some((o) => !o.connected)) return false;
  let letzter = null;
  game.players.forEach((p) => { if (Crew.istBot(p)) letzter = p; });   // hoechster Slot-Index unter den Bots
  if (!letzter) return false;
  if (game.phase === 'lobby') { ausLobbyNehmen(game, letzter); game.log(`Bot ${letzter.name} (${letzter.id}) macht Platz für einen Menschen.`); }
  else zuFreiemPlatz(game, letzter);
  return true;
}

function botsNachLetztemMenschenRaeumen(game) {
  if (game.phase !== 'lobby' || Crew.menschen(game) > 0) return false;
  const alle = bots(game);
  for (const b of alle) ausLobbyNehmen(game, b);
  return alle.length > 0;
}

module.exports = { ROLLEN, lobbyBotBefehl, botHinzufuegen, botWuerfeln, botEntfernen, botRolleWechseln, botVerdraengtFuerMensch, botsNachLetztemMenschenRaeumen };
