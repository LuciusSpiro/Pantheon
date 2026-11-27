'use strict';
// TRA-01 B2: Erkennung der Trainingsziele. Pro Tick (training.update) pollt dieses Modul den Spielzustand, dazu nimmt es drei Ereignisse
// (allstopp, ausweichen, botBefehl) und consoleEnter aus mission.js (onEvent -> Training.ereignis) entgegen. Jedes Ziel gilt DAUERHAFT, sobald es
// einmal erreicht ist (bis Neustart der Szene): game.arena.training.erreicht ist ein Set benannter Ziel-Ids. Für jedes neu erreichte Ziel
//   1. missionEvent('trainingZiel', { id })        (Telemetrie, Handler on.trainingZiel eines Buchs; mission.events ist je Schritt flüchtig, nicht dafür gedacht)
//   2. Buchflag ziel_<id>  (id mit [^a-z0-9_] -> '_': 'bot_befehl:ops.scan' -> ziel_bot_befehl_ops_scan); im Buch unter "erwartet" deklarieren
// Ein Regiebuch prüft ein Ziel mit der Prüfung (intern, nur Bücher mit kopf.art "intern"):
//   { "check": { "name": "training_ziel", "id": "tempo_hoch" } }      z. B. in objectives[].done oder steps[].next
// Menschen zählen, Bots nie: Flugziele nur, solange ein Mensch die Station Navigation (helm) aktiv hat und kein Bot an der Navigation sitzt;
// Captain-Ziele nur mit einem Menschen an der Captain-Station. Bots lösen keine Ziele aus (ihre Befehle sind botBefehl, vom Menschen gegeben).
// Zählstelle: crew.js (verbundene/istBot), Station: station.js (stationOf). Bewusst kein Darstellungswissen hier.
//
//   Ziel-Id                         erreicht, wenn
//   tempo_hoch                      ship.helm.stage steigt (Temporegler hoch; auch das erste W am Steg, das ablegt), Szene unverändert, nicht durch Andocken
//   tempo_runter                    ship.helm.stage sinkt, ohne dass Allstopp aktiv ist (X zählt nur als allstopp)
//   ruder                           |ship.helm.turn| >= RUDER_MIN (nicht angedockt)
//   ruder_backbord / _steuerbord    dasselbe mit Vorzeichen (turn < 0 Backbord, > 0 Steuerbord)
//   in_fahrt                        ship.speed >= FAHRT_MIN (nicht angedockt)
//   gestoppt                        in_fahrt war erreicht und ship.speed <= STEHT_MAX (nicht angedockt)
//   allstopp                        Ereignis allstopp { p } von einem Menschen (Annahme von helm.stop, game.js)
//   ausweichen                      Ereignis ausweichen { p, richtung } von einem Menschen
//   ausweichen_links / _rechts      dasselbe nach Richtung
//   sprungziel_gewaehlt             ship.jump.dest ändert sich auf ein Ziel, vom Menschen an der Captain-Station gewählt
//                                   (die Sprungpunkt-Automatik, ship._jumpAuto, und Ziele, die der Modus setzt, zählen nicht)
//   sprungpunkt                     mit gewähltem Ziel im Anflug-Radius des Sprungpunkts (sprung.amSprungpunkt, nicht angedockt)
//   andocken                        ship.docked wechselt false -> true
//   ablegen                         ship.docked wechselt true -> false
//   marker                          ship.markers.captain wird gesetzt (null -> Marke), Mensch an der Captain-Station
//   konsole:<kind>                  Ereignis consoleEnter: ein Mensch betritt die Konsole <kind> (helm, captain, weapons, technik …)
//   tab_wechsel                     ein Mensch schaltet per Tab die aktive Station (station.js, p.station)
//   tab:<kind>                      dasselbe, gelandet auf Station <kind>
//   bot_befehl                      Ereignis botBefehl: irgendein Bot-Befehl wurde angenommen (ok-Pfad von annahme.js)
//   bot_befehl:<befehl>             … dieser Befehl (z. B. bot_befehl:ops.scan, KATALOG von annahme.js)
//   bot_befehl:<befehl>:<quelle>    … dieser Befehl über diese Quelle (menu | taste | text | sprache)
//   bot_quelle:<quelle>             irgendein Befehl über diese Quelle
const Crew = require('./crew.js');

const RUDER_MIN = 0.5;       // |helm.turn| (Eingabe -1..1), ab dem „Ruder gelegt“ gilt
const FAHRT_MIN = 20;        // px/s: darüber ist das Schiff in Fahrt (Stufe VOLL der Lerche 130 px/s)
const STEHT_MAX = 2;         // px/s: darunter steht es
const FLAG_PRAEFIX = 'ziel_';

const FESTE_ZIELE = ['tempo_hoch', 'tempo_runter', 'ruder', 'ruder_backbord', 'ruder_steuerbord', 'in_fahrt', 'gestoppt', 'allstopp', 'ausweichen',
  'ausweichen_links', 'ausweichen_rechts', 'sprungziel_gewaehlt', 'sprungpunkt', 'andocken', 'ablegen', 'marker', 'tab_wechsel', 'bot_befehl'];
const QUELLEN = ['menu', 'taste', 'text', 'sprache'];

const lazy = (p) => { let m = null; return () => m || (m = require(p)); };
const Station = lazy('./station.js');
const Sprung = lazy('./sprung.js');
const Annahme = lazy('../bots/annahme.js');
const Protocol = lazy('../../shared/protocol.js');

function stand(game) { const T = game && game.arena && game.arena.training; return T && T.erreicht instanceof Set ? T : null; }
function flagName(id) { return FLAG_PRAEFIX + String(id).replace(/[^a-z0-9_]/g, '_'); }

// Ziel-Ids, die ein Buch nennen darf (Prüfer, Tests): feste Liste oder konsole:/tab:<Konsole>, bot_befehl:<Katalogbefehl>[:<Quelle>], bot_quelle:<Quelle>
function istZielId(id) {
  if (typeof id !== 'string') return false;
  if (FESTE_ZIELE.includes(id)) return true;
  const kreis = Protocol().STATION_KREIS; const konsolen = Protocol().CONSOLES;
  let m;
  if ((m = /^konsole:([a-z]+)$/.exec(id))) return konsolen.includes(m[1]);
  if ((m = /^tab:([a-z]+)$/.exec(id))) return kreis.includes(m[1]);
  if ((m = /^bot_quelle:([a-z]+)$/.exec(id))) return QUELLEN.includes(m[1]);
  if ((m = /^bot_befehl:([a-z]+\.[a-z_]+)(?::([a-z]+))?$/.exec(id))) return Annahme().KATALOG.has(m[1]) && (m[2] == null || QUELLEN.includes(m[2]));
  return false;
}

function zuruecksetzen(game) {
  const T = game && game.arena && game.arena.training; if (!T) return;
  T.erreicht = new Set(); T.erk = null;
  const flags = game.mission && game.mission.flags;
  if (flags) for (const k of Object.keys(flags)) if (k.startsWith(FLAG_PRAEFIX)) delete flags[k];
}
function erreicht(game, id) { const T = stand(game); return !!T && T.erreicht.has(id); }
function ziele(game) { const T = stand(game); return T ? [...T.erreicht] : []; }

// Neues Ziel setzen (einmal je Versuch): Menge, Flag, Missionsereignis
function markieren(game, id) {
  const T = stand(game);
  if (!T || T.erreicht.has(id)) return false;
  T.erreicht.add(id);
  if (game.mission && game.mission.flags) game.mission.flags[flagName(id)] = true;
  game.missionEvent('trainingZiel', { id });
  return true;
}

// ---------- Wer sitzt wo (nur Menschen zählen) ----------
const menschen = (game) => Crew.verbundene(game).filter((p) => !Crew.istBot(p));
const menschAn = (game, kind) => menschen(game).some((p) => Station().stationOf(p) === kind);
const botAn = (game, kind) => Crew.verbundene(game).some((p) => Crew.istBot(p) && Station().stationOf(p) === kind);
const menschFliegt = (game) => menschAn(game, 'helm') && !botAn(game, 'helm');
const istMensch = (p) => !!p && !Crew.istBot(p);

// ---------- Pollen ----------
function lesen(game) {
  const ship = game.ship; const h = ship.helm || {}; const j = ship.jump || {};
  const stationen = {};
  for (const p of menschen(game)) stationen[p.id] = Station().stationOf(p);
  return {
    stage: h.stage, autoStop: h.autoStop === true, turn: Number(h.turn) || 0, speed: Math.abs(Number(ship.speed) || 0),
    dest: j.dest || null, jp: j.jp || null, docked: !!ship.docked, scene: ship.scene,
    marker: !!(ship.markers && ship.markers.captain), stationen,
    fliegt: menschFliegt(game), kapitaen: menschAn(game, 'captain'), auto: game._jumpAuto === true,
  };
}

function pruefeTempo(game, s, v) {
  if (!v || !s.fliegt || s.scene !== v.scene || (s.docked && !v.docked)) return;   // Andocken und Szenenwechsel stellen die Stufe selbst auf Stopp
  if (typeof s.stage !== 'number' || typeof v.stage !== 'number') return;
  if (s.stage > v.stage) markieren(game, 'tempo_hoch');
  else if (s.stage < v.stage && !s.autoStop) markieren(game, 'tempo_runter');
}
function pruefeRuder(game, s) {
  if (!s.fliegt || s.docked || Math.abs(s.turn) < RUDER_MIN) return;
  markieren(game, 'ruder');
  markieren(game, s.turn < 0 ? 'ruder_backbord' : 'ruder_steuerbord');
}
function pruefeFahrt(game, s) {
  if (!s.fliegt || s.docked) return;
  if (s.speed >= FAHRT_MIN) markieren(game, 'in_fahrt');
  else if (s.speed <= STEHT_MAX && erreicht(game, 'in_fahrt')) markieren(game, 'gestoppt');
}
function pruefeSprung(game, s, v) {
  if (v && s.dest && s.dest !== v.dest && !s.auto && s.kapitaen) markieren(game, 'sprungziel_gewaehlt');
  if (s.fliegt && !s.docked && s.dest && s.jp && Sprung().amSprungpunkt(game, s.jp)) markieren(game, 'sprungpunkt');
}
function pruefeAndocken(game, s, v) {
  if (!v || !s.fliegt) return;
  if (!v.docked && s.docked) markieren(game, 'andocken');
  else if (v.docked && !s.docked) markieren(game, 'ablegen');
}
function pruefeMarker(game, s, v) {
  if (v && !v.marker && s.marker && s.kapitaen) markieren(game, 'marker');
}
function pruefeTab(game, s, v) {
  if (!v) return;
  for (const pid of Object.keys(s.stationen)) {
    const vor = v.stationen[pid]; const nun = s.stationen[pid];
    if (vor && nun && vor !== nun) { markieren(game, 'tab_wechsel'); markieren(game, 'tab:' + nun); }
  }
}

// Ein Tick: Zustand lesen, mit dem des letzten Ticks vergleichen. Der erste Tick nach (Neu-)Start ist nur Ausgangslage (v null).
function update(game) {
  const T = stand(game); if (!T) return;
  const v = T.erk; const s = lesen(game); T.erk = s;
  pruefeTempo(game, s, v);
  pruefeRuder(game, s);
  pruefeFahrt(game, s);
  pruefeSprung(game, s, v);
  pruefeAndocken(game, s, v);
  pruefeMarker(game, s, v);
  pruefeTab(game, s, v);
}

// ---------- Ereignisse (flüchtig: Pollen sähe sie nicht) ----------
const EREIGNIS = {
  allstopp(game, d) { if (istMensch(d.p)) markieren(game, 'allstopp'); },
  ausweichen(game, d) {
    if (!istMensch(d.p)) return;
    markieren(game, 'ausweichen');
    if (d.richtung === 'links' || d.richtung === 'rechts') markieren(game, 'ausweichen_' + d.richtung);
  },
  consoleEnter(game, d) { if (istMensch(d.p) && typeof d.kind === 'string') markieren(game, 'konsole:' + d.kind); },
  botBefehl(game, d) {
    if (typeof d.befehl !== 'string') return;
    markieren(game, 'bot_befehl');
    markieren(game, 'bot_befehl:' + d.befehl);
    if (typeof d.quelle === 'string') { markieren(game, 'bot_quelle:' + d.quelle); markieren(game, 'bot_befehl:' + d.befehl + ':' + d.quelle); }
  },
};
function ereignis(game, name, data) {
  if (!stand(game) || !Object.prototype.hasOwnProperty.call(EREIGNIS, name)) return;
  try { EREIGNIS[name](game, data || {}); } catch (e) { game.countError('training-erkennung', e); }
}

module.exports = { RUDER_MIN, FAHRT_MIN, STEHT_MAX, FLAG_PRAEFIX, FESTE_ZIELE, istZielId, flagName, zuruecksetzen, erreicht, ziele, update, ereignis };
