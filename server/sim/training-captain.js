'use strict';
// TRA-01 E: Captain-Training (Action-Layer). Ein Mensch an der Captain-Konsole führt drei Bots (Livia Navigation, Cassius Ops, Titus Technik). Der Rahmen steht in training.js (Tabelle TRAININGSMODI:
// bots, konsole, halter), die Ziele in training-erkennung.js, der Ablauf in den Regiebüchern tra_captain / tra_captain_sprache (erzeugt von tools/gen-tra-captain.js).
//   botsAnlegen(game, rollen)   Lobby-Phase (vor phase 'play': danach lehnt botHinzufuegen ab): Bots in dieser Reihenfolge anlegen (training.js räumt vorher alle Lobby-Bots: die Figuren ergeben sich aus der Reihenfolge) und als Trainings-Bots markieren (trainingBot)
//   botsNachTrainingRaeumen(game) Weg in die Lobby: die Trainings-Bots (trainingBot) verlassen die Lobby; vom Menschen gesetzte Bots bleiben
//   konsoleBesetzen(game, kind) der (erste) Mensch setzt sich an die Konsole kind
//   neuAufsetzen(game)          Neustart: Übungsziele weg, Befehle und Feuerzustand der Bots verworfen
//   AKTIONEN                    benannte Buchaktionen (Baustein training_aktion): uebungsziele, uebungsziele_weg, schaeden
//   HALTER                      je Tick laufende Wächter (Tabellenfeld halter): feuersperre, uebungsziele, reiseruhe, sicherheitsstopp, reparaturnachlegen
// Übungsziele: zwei Störrelais (hp 2, schießen nie), stationär (orbitDir 0) auf dem Ring um den Stationspunkt, ohne Beute und Marken; game.arena.training.uebung = { a: { id, tot }, b: { id, tot } }
// (Objekt-Id, Zeitpunkt des Abschusses). Nach einem Abschuss rückt nach NACHRUECK_S s ein neues Ziel an dieselbe Stelle nach, damit man wiederholen kann.
const Crew = require('./crew.js');

const lazy = (p) => { let m = null; return () => m || (m = require(p)); };   // schwere Module erst beim Gebrauch (training.js wird früh geladen)
const Station = lazy('./station.js');
const Lauf = lazy('../bots/lauf.js');
const BotSpieler = lazy('../bots/spieler.js');
const Space = lazy('./space.js');
const Interior = lazy('./interior.js');

// Winkel um den Stationspunkt (Ring relayOrbit, config combat): nicht 0 (dort liegt der Liegeplatz), links der Station ober- und unterhalb
const UEBUNGSZIELE = [{ kennung: 'a', winkel: -2.0 }, { kennung: 'b', winkel: 2.0 }];
const NACHRUECK_S = 3;
const SCHAEDEN = ['engines', 'transfer', 'weapon_bow', 'shields'];   // gleichzeitig beschädigt (damaged): der Technik-Bot braucht zusammen etwa eine Minute, tech.reparieren zieht ein System nach vorn
const RAND_ABSTAND = 300;   // px vom Szenenrand: unbeaufsichtigte Fahrt wird hier angehalten
const FAHRT_AB = 5;         // px/s: darunter steht das Schiff
const REPARATUR_NEU_S = 20; // s, die alle vier Systeme heil sind, ohne dass der Befehl tech.reparieren gelang: dann werden sie erneut beschädigt (Zeit, den Befehl zu geben)

const stand = (game) => game.arena && game.arena.training || null;
const botMitRolle = (game, rolle) => game.players.find((p) => Crew.istBot(p) && p.rolle === rolle) || null;
const agentMitRolle = (game, rolle) => { const b = botMitRolle(game, rolle); return b ? Lauf().agent(game, b) : null; };

function botsAnlegen(game, rollen) {
  for (const rolle of rollen) {
    if (!BotSpieler().botHinzufuegen(game, null, rolle)) continue;
    const b = botMitRolle(game, rolle); if (b) b.trainingBot = true;
  }
}
function botsNachTrainingRaeumen(game) {
  return BotSpieler().botsRaeumen(game, game.players.filter((p) => p.trainingBot));
}

function konsoleBesetzen(game, kind) {
  const mensch = Crew.verbundene(game).find((p) => !Crew.istBot(p));
  if (mensch && mensch.zone === 'ship') Interior().enterConsole(game, mensch, kind);
}

// ---------- Übungsziele ----------
function uebungszielSpawnen(game, z) {
  const sp = Space(); const st = sp.stationPoint(game); const r = game.C.combat.relayOrbit;
  const e = sp.spawnEnemy(game, 'relay', { x: st.x + Math.cos(z.winkel) * r, y: st.y + Math.sin(z.winkel) * r, orbitA: z.winkel, tag: 'training' });
  e.orbitDir = 0;      // steht still auf dem Ring (space.js dreht den Winkel sonst weiter)
  e.ohneBeute = true;  // keine Marken für den Abschuss
  return e;
}
function uebungszieleStellen(game) {
  const T = stand(game); if (!T) return;
  T.uebung = {}; T.uebungOrt = game.ship.scene;
  for (const z of UEBUNGSZIELE) T.uebung[z.kennung] = { id: uebungszielSpawnen(game, z).id, tot: null };
}
function uebungszieleWeg(game) {
  const T = stand(game); if (!T || !T.uebung) return;
  const ids = new Set(Object.values(T.uebung).map((u) => u.id));
  game.space.enemies = game.space.enemies.filter((e) => !ids.has(e.id));
  T.uebung = null; T.uebungOrt = null;
}
function uebungszieleHalten(game) {
  const T = stand(game); if (!T || !T.uebung || game.ship.scene !== T.uebungOrt) return;
  for (const z of UEBUNGSZIELE) {
    const u = T.uebung[z.kennung]; if (!u) continue;
    if (game.space.enemies.some((e) => e.id === u.id)) continue;
    if (u.tot == null) u.tot = game.time;
    else if (game.time - u.tot >= NACHRUECK_S) { u.id = uebungszielSpawnen(game, z).id; u.tot = null; }
  }
}

// ---------- Schäden ----------
function schaedenSetzen(game) {
  game.odaSeen.add('firstDamaged'); game.odaSeen.add('firstBroken');   // wie ship_incident quiet: die Ersthinweise "E halten: flicken" gelten dem Bordeinsatz, nicht dem Captain
  for (const s of SCHAEDEN) Interior().damageSystem(game, s, 'damaged', { quiet: true });
}

// Ansagen des Spiels, die dem Captain-Training widersprechen: "Faltsprung bereit – Steuer: F drücken!" (Livia springt auf Befehl; mission.js jumpReady, Schlüssel je Schritt und Szene)
function ansagenStummschalten(game) {
  const buch = game.mission.def && game.mission.def.steps ? game.mission.def : null;
  const schritte = buch ? buch.steps.map((s) => s.id) : [];
  for (const sc of ['hafen', 'splitter', 'b7', 'vaelen', 'wrack']) for (const st of ['free'].concat(schritte)) game.odaSeen.add('jumpReady_' + st + '_' + sc);
}

// ---------- Wächter ----------
// Der Ops-Bot feuert von selbst auf jedes aufschaltbare Ziel: bis ops.feuer_frei steht sein Feuerzustand auf halt. Verwirft ihn etwas (bot.automatik, Tab des Menschen über die Ops-Konsole), setzt der Wächter ihn zurück.
function feuersperreHalten(game) {
  const a = agentMitRolle(game, 'ops');
  if (a && a.absicht && a.absicht.feuer == null) a.feuerSetzen('halt', null);
}
// Der Schnellsprung kann mit einer Zufallsbegegnung enden (reise.js abfangen: Jäger). Im Training nie: Zähler -1 macht die Wahrscheinlichkeit der neutralen Sektoren (0,08 + 0,08 * Zähler) zu 0.
function reiseRuheHalten(game) { game._reiseOhne = -1; }
// Tab zum Steuer verwirft den Kurs des Bots, die Schubstufe bleibt: das Schiff liefe unbeaufsichtigt weiter. Kein Mensch am Steuer, kein Kurs des Navigations-Bots, in Fahrt und am Szenenrand: Allstopp.
function sicherheitsstoppPruefen(game) {
  const sh = game.ship;
  if (sh.docked || !sh.helm || sh.helm.autoStop || Math.abs(Number(sh.speed) || 0) < FAHRT_AB || game.reise) return;
  if (Crew.verbundene(game).some((p) => !Crew.istBot(p) && Station().stationOf(p) === 'helm')) return;
  const nav = agentMitRolle(game, 'navigation');
  if (nav && nav.absicht && nav.absicht.befehl) return;
  const w = game.space.w, h = game.space.h;
  if (sh.x > RAND_ABSTAND && sh.x < w - RAND_ABSTAND && sh.y > RAND_ABSTAND && sh.y < h - RAND_ABSTAND) return;
  Space().helmStop(game);
}

// Reparatur ohne Sackgasse: Titus repariert alle Systeme in etwa einer Minute selbst. Ist im Schritt reparatur das Ziel noch offen und alles heil, legt der Wächter nach REPARATUR_NEU_S s neue Schäden nach.
function reparaturNachlegen(game) {
  const T = stand(game); if (!T) return;
  const offen = game.mission.step && game.mission.step.id === 'reparatur' && !(T.erreicht && T.erreicht.has('repariert'));
  const heil = SCHAEDEN.every((s) => game.ship.systems[s] === 'ok');
  if (!offen || !heil) { T.heilSeit = null; return; }
  if (T.heilSeit == null) T.heilSeit = game.time;
  if (game.time - T.heilSeit < REPARATUR_NEU_S) return;
  T.heilSeit = null;
  schaedenSetzen(game);
  game.oda(game.mission.tpl('@reparatur.nochmal'), null);
}

const HALTER = { feuersperre: feuersperreHalten, uebungsziele: uebungszieleHalten, reiseruhe: reiseRuheHalten, sicherheitsstopp: sicherheitsstoppPruefen, reparaturnachlegen: reparaturNachlegen };
const AKTIONEN = { uebungsziele: uebungszieleStellen, uebungsziele_weg: uebungszieleWeg, schaeden: schaedenSetzen };

// Neustart: die Szene wird neu aufgebaut (enterScene räumt die Gegner); Absicht der Bots zurück auf Standard (Befehl, Feuer, gehaltene Technik)
function neuAufsetzen(game) {
  uebungszieleWeg(game);
  for (const b of game.players) if (Crew.istBot(b)) { const a = Lauf().agent(game, b); if (a) a.automatik(); }
}

module.exports = { UEBUNGSZIELE, NACHRUECK_S, SCHAEDEN, RAND_ABSTAND, REPARATUR_NEU_S, botsAnlegen, botsNachTrainingRaeumen, konsoleBesetzen, ansagenStummschalten, neuAufsetzen, uebungszieleStellen, uebungszieleWeg, uebungszieleHalten, schaedenSetzen, sicherheitsstoppPruefen, AKTIONEN, HALTER };
