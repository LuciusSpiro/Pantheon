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
// TRA-01 E (Captain-Training), eigene Ziele:
//   bot_name / bot_name:<quelle>    ein Befehl an einen Bot mit Namen (an = botId b0..b3 statt Rolle: "Livia, …"), nach Quelle
//   ziel_angewaehlt:<kennung>[:<quelle>]  ops.ziel hat das Übungsziel <kennung> (a | b, game.arena.training.uebung, training-captain.js) angewählt: objekt:<id>, markiert (Captain-Anzeigeziel) oder naechstes; mit Quelle
//   bot_gespraech                   ein Mensch hat ein Gespräch mit einem Bot begonnen (Ö/Ä, Nachricht bot.gespraech; auch wenn der Dienst nicht erreichbar ist: der Versuch zählt)
//   abschuss                        ein Übungsziel (tag training) wurde zerstört (Ereignis enemyKilled)
//   marke_erreicht                  nach bot_befehl:nav.kurs: das Schiff ist (nicht angedockt) höchstens ANFLUG_R px von der Captain-Marke entfernt
//   repariert[:<quelle>]            ein mit tech.reparieren befohlenes, beschädigtes System ist wieder heil (Befehl: nur der ok-Pfad, args.system; Eigenreparatur ohne Befehl zählt nicht); mit Quelle des Befehls
//   sprung                          normaler Sprung (jumped ohne laufende Reise) – wer ihn befohlen hat, sagt bot_befehl:nav.sprung
//   schnellsprung                   Reise (game.reise) mit mindestens SCHNELL_MIN_HOPS Hops ist ohne Abbruch am letzten Hop angekommen
// vergessen(game, praefix) nimmt Ziele wieder zurück (Buchaktion training_vergessen): ein Schritt kann damit eine frische Handlung verlangen (z. B. Feuer halt NACH Feuer frei).
const Crew = require('./crew.js');

const RUDER_MIN = 0.5;       // |helm.turn| (Eingabe -1..1), ab dem „Ruder gelegt“ gilt
const FAHRT_MIN = 20;        // px/s: darüber ist das Schiff in Fahrt (Stufe VOLL der Lerche 130 px/s)
const STEHT_MAX = 2;         // px/s: darunter steht es
const ANFLUG_R = 220;        // px: nav.kurs auf die Captain-Marke gilt als angekommen (der Bot hält ab 200 px, mannschaft.js ANKUNFT_OBJEKT)
const SCHNELL_MIN_HOPS = 2;  // ein Schnellsprung über einen einzelnen Hop ist ein normaler Sprung
const BOT_ID = /^b[0-3]$/;
const FLAG_PRAEFIX = 'ziel_';

const FESTE_ZIELE = ['tempo_hoch', 'tempo_runter', 'ruder', 'ruder_backbord', 'ruder_steuerbord', 'in_fahrt', 'gestoppt', 'allstopp', 'ausweichen',
  'ausweichen_links', 'ausweichen_rechts', 'sprungziel_gewaehlt', 'sprungpunkt', 'andocken', 'ablegen', 'marker', 'tab_wechsel', 'bot_befehl',
  'bot_name', 'bot_gespraech', 'abschuss', 'marke_erreicht', 'repariert', 'sprung', 'schnellsprung'];
const QUELLEN = ['menu', 'taste', 'text', 'sprache'];

const lazy = (p) => { let m = null; return () => m || (m = require(p)); };
const Station = lazy('./station.js');
const Sprung = lazy('./sprung.js');
const Annahme = lazy('../bots/annahme.js');
const Protocol = lazy('../../shared/protocol.js');
const Sektoren = lazy('../../shared/sektoren.js');
const CaptainZiel = lazy('./captainziel.js');
const { dist } = require('../util.js');

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
  if ((m = /^bot_name:([a-z]+)$/.exec(id))) return QUELLEN.includes(m[1]);
  if (/^ziel_angewaehlt:[a-z]+$/.test(id)) return true;
  if ((m = /^(ziel_angewaehlt:[a-z]+|repariert):([a-z]+)$/.exec(id))) return QUELLEN.includes(m[2]);
  if ((m = /^bot_befehl:([a-z]+\.[a-z_]+)(?::([a-z]+))?$/.exec(id))) return Annahme().KATALOG.has(m[1]) && (m[2] == null || QUELLEN.includes(m[2]));
  return false;
}

function zuruecksetzen(game) {
  const T = game && game.arena && game.arena.training; if (!T) return;
  T.erreicht = new Set(); T.erk = null; T.repariere = [];
  const flags = game.mission && game.mission.flags;
  if (flags) for (const k of Object.keys(flags)) if (k.startsWith(FLAG_PRAEFIX)) delete flags[k];
}
// Ziele mit diesem Präfix zurücknehmen (Menge und Buchflag); die Prüfung training_ziel meldet sie wieder als offen. -> Anzahl
function vergessen(game, praefix) {
  const T = stand(game); if (!T) return 0;
  let n = 0;
  for (const id of [...T.erreicht]) if (id === praefix || id.startsWith(praefix + ':')) { T.erreicht.delete(id); n++; if (game.mission && game.mission.flags) delete game.mission.flags[flagName(id)]; }
  return n;
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
// Reise (Schnellsprung): Zahl der Hops, Abbruch und der Ort des letzten Hops (nur lesen: game.reise, reise.js)
function reiseLesen(game) {
  const r = game.reise; if (!r) return null;
  const letzter = r.hops[r.hops.length - 1];
  return { n: r.hops.length, abbruch: r.abbruch === true, ziel: letzter ? Sektoren().ortVonHex(letzter) : null };
}
function lesen(game) {
  const ship = game.ship; const h = ship.helm || {}; const j = ship.jump || {};
  const stationen = {};
  for (const p of menschen(game)) stationen[p.id] = Station().stationOf(p);
  return {
    stage: h.stage, autoStop: h.autoStop === true, turn: Number(h.turn) || 0, speed: Math.abs(Number(ship.speed) || 0),
    dest: j.dest || null, jp: j.jp || null, docked: !!ship.docked, scene: ship.scene,
    marker: !!(ship.markers && ship.markers.captain), stationen,
    fliegt: menschFliegt(game), kapitaen: menschAn(game, 'captain'), auto: game._jumpAuto === true,
    markerPos: ship.markers && ship.markers.captain || null, reise: reiseLesen(game),
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

// TRA-01 E: Anflug an die Captain-Marke nach nav.kurs; Reise (Schnellsprung) angekommen; befohlene Reparatur geheilt
function pruefeAnflug(game, s) {
  if (!s.markerPos || s.docked || !erreicht(game, 'bot_befehl:nav.kurs')) return;
  if (dist(game.ship.x, game.ship.y, s.markerPos.x, s.markerPos.y) <= ANFLUG_R) markieren(game, 'marke_erreicht');
}
function pruefeReise(game, s, v) {
  if (v && v.reise && !s.reise && v.reise.n >= SCHNELL_MIN_HOPS && !v.reise.abbruch && v.reise.ziel && s.scene === v.reise.ziel) markieren(game, 'schnellsprung');
}
function pruefeReparatur(game) {
  const T = stand(game); const sys = game.ship.systems || {};
  T.repariere = T.repariere.filter((r) => {
    if (sys[r.system] !== 'ok') return true;
    markieren(game, 'repariert'); if (r.quelle) markieren(game, 'repariert:' + r.quelle);
    return false;
  });
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
  pruefeAnflug(game, s);
  pruefeReise(game, s, v);
  pruefeReparatur(game);
}

// ---------- Ereignisse (flüchtig: Pollen sähe sie nicht) ----------
// Kennung (a | b) des Übungsziels mit dieser Objekt-Id oder null (game.arena.training.uebung: kennung -> { id })
function kennungVon(game, id) {
  const u = stand(game).uebung || {};
  return Object.keys(u).find((k) => u[k] && u[k].id === id) || null;
}
// ops.ziel (ok-Pfad): welches Übungsziel wurde angewählt? objekt:<id>; markiert = Captain-Anzeigeziel; naechstes = das dem Schiff nächste Objekt
function zielAngewaehlt(game, args, quelle) {
  const z = args && args.ziel; let id = null; let m;
  if (z === 'markiert') { const cz = CaptainZiel().gueltig(game); id = cz ? cz.id : null; }
  else if (z === 'naechstes') {
    const sh = game.ship; const e = game.space.enemies.slice().sort((a, b) => dist(a.x, a.y, sh.x, sh.y) - dist(b.x, b.y, sh.x, sh.y))[0];
    id = e ? e.id : null;
  } else if ((m = /^objekt:(.+)$/.exec(String(z)))) id = m[1];
  const k = id == null ? null : kennungVon(game, id);
  if (!k) return;
  markieren(game, 'ziel_angewaehlt:' + k);
  if (typeof quelle === 'string') markieren(game, 'ziel_angewaehlt:' + k + ':' + quelle);
}
// tech.reparieren (ok-Pfad): nur ein jetzt beschädigtes System zählt, geheilt wird es im Pollen (pruefeReparatur)
function reparaturMerken(game, args, quelle) {
  const s = args && args.system; const st = s && (game.ship.systems || {})[s];
  const T = stand(game);
  if (typeof st === 'string' && st !== 'ok' && !T.repariere.some((r) => r.system === s)) T.repariere.push({ system: s, quelle: typeof quelle === 'string' ? quelle : null });
}

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
    if (BOT_ID.test(d.an)) { markieren(game, 'bot_name'); if (typeof d.quelle === 'string') markieren(game, 'bot_name:' + d.quelle); }
    if (d.befehl === 'ops.ziel') zielAngewaehlt(game, d.args, d.quelle);
    if (d.befehl === 'tech.reparieren') reparaturMerken(game, d.args, d.quelle);
  },
  botGespraech(game, d) { if (istMensch(d.p)) markieren(game, 'bot_gespraech'); },
  jumped(game) { if (!game.reise) markieren(game, 'sprung'); },
  enemyKilled(game, d) { if (d.enemy && d.enemy.tag === 'training') markieren(game, 'abschuss'); },
};
function ereignis(game, name, data) {
  if (!stand(game) || !Object.prototype.hasOwnProperty.call(EREIGNIS, name)) return;
  try { EREIGNIS[name](game, data || {}); } catch (e) { game.countError('training-erkennung', e); }
}

module.exports = { RUDER_MIN, FAHRT_MIN, STEHT_MAX, ANFLUG_R, SCHNELL_MIN_HOPS, FLAG_PRAEFIX, FESTE_ZIELE, istZielId, flagName, zuruecksetzen, vergessen, erreicht, ziele, update, ereignis };
