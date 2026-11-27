'use strict';
// TRA-01 B2 + C (Server): Erkennung der Trainingsziele (server/sim/training-erkennung.js) und Abzeichen (training.js).
//   node tools/test-training-erkennung.js
//   Pollen     je gepollter Größe (helm.stage, helm.turn, speed, jump.dest/jp, docked, markers.captain, Station/Tab): positiv, negativ (Wert unverändert, Bot statt Mensch, falsche Station, Andocken/Szenenwechsel)
//   Ereignis   allstopp, ausweichen, botBefehl, consoleEnter -> Ziel-Ids (echte Befehle über handleMessage); Bot als Auslöser zählt nicht
//   Dauer      ein erreichtes Ziel bleibt (Wert fällt zurück), trainingZiel genau einmal, Flag ziel_<id>, Neustart leert alles
//   Prüfung    Registry training_ziel: Checker nimmt das Buch an, lehnt unbekannte Ids und Nicht-intern-Bücher ab; mission.cond liest die Menge
//   Abzeichen  genau einmal je Versuch (EVT_ABZEICHEN { id, variante? }, ODA-Zeile), Neustart nach 8 s, neues Buch läuft, zweiter Durchlauf vergibt wieder
const fs = require('fs');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');
const Interior = require('../server/sim/interior.js');
const Training = require('../server/sim/training.js');
const Erk = require('../server/sim/training-erkennung.js');
const BotSpieler = require('../server/bots/spieler.js');
const Befehle = require('../server/bots/befehle/index.js');
const Checker = require('../server/mission/checker.js');

const DT = 1 / CONFIG.tickHz;
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, body) {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}

// Trainingspartie über den Lobby-Weg. o.bots: Rollen; o.sprache; o.sitz: Konsole des Menschen (Standard keine)
function partie(modus, o) {
  o = o || {};
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { if (this.inbox.length < 5000) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'T0', name: 'Tr0', color: 0 });
  for (const r of o.bots || []) BotSpieler.botHinzufuegen(g, null, r);
  g.handleMessage(c, { t: 'lobbyOpt', startMission: modus });
  if (o.sprache) g.handleMessage(c, { t: 'lobbyOpt', trainingSprache: true });
  g.handleMessage(c, { t: 'ready', ready: true });
  const odas = []; const o0 = g.oda.bind(g); g.oda = (t, x) => { odas.push(String(t)); return o0(t, x); };
  const ereignisse = []; const m0 = g.missionEvent.bind(g); g.missionEvent = (name, data) => { ereignisse.push({ name, data }); return m0(name, data); };
  const P = { g, c, h: c.player, odas, ereignisse };
  P.run = (sek, bis) => { for (let k = 0; k < Math.round(sek / DT); k++) { g.step(); if (bis && bis()) return true; } return !bis; };
  P.setze = (kind) => Interior.enterConsole(g, P.h, kind);
  P.cmd = (msg) => g.handleMessage(c, Object.assign({ t: 'cmd' }, msg));
  P.ziele = () => Erk.ziele(g).sort();
  P.hat = (id) => Erk.erreicht(g, id);
  P.ziel = (id) => ereignisse.filter((e) => e.name === 'trainingZiel' && e.data.id === id).length;
  P.poll = () => Erk.update(g);   // ein Pollen ohne Spieltick (deterministisch)
  P.abzeichen = () => c.inbox.filter((m) => m.t === 'event' && m.kind === Protocol.EVT_ABZEICHEN);
  return P;
}
// Auslöser fremder Hand: Spieler-Objekt zum Bot machen (Zustand bleibt, nur die Zählstelle sieht einen Bot)
const alsBot = (p) => { p.bot = true; p.rolle = 'navigation'; };

// ---------- Rahmen ----------
section('Rahmen', () => {
  const P = partie('training_fliegen');
  P.run(1);
  ok(P.g.arena.training.erreicht instanceof Set && P.ziele().length === 0, 'Start: Menge leer (Szene herrichten zählt nicht)');
  ok(P.g.errors === 0, 'g.errors 0');
  ok(Protocol.EVT_ABZEICHEN === 'abzeichen', 'Protokollkonstante EVT_ABZEICHEN = abzeichen');
  const snap = JSON.stringify(P.g.snapshotFor ? P.g.snapshotFor(P.h) : {});
  ok(!/erreicht|"erk"/.test(snap), 'kein neues Snapshot-Feld (erreicht/erk nicht im Snapshot)');
});

// ---------- Pollen: Temporegler ----------
section('tempo_hoch / tempo_runter (helm.stage)', () => {
  const P = partie('training_fliegen'); P.run(0.5); P.setze('helm'); P.run(0.2);
  P.run(2);
  ok(P.ziele().join() === 'konsole:helm', 'Wert unverändert (Stufe bleibt): kein Flugziel, nur konsole:helm vom Hinsetzen');
  P.cmd({ c: 'helm.throttle', delta: 1 }); P.run(0.2);
  ok(P.hat('tempo_hoch') && !P.hat('tempo_runter'), 'Temporegler hoch (am Steg, legt ab): tempo_hoch, nicht tempo_runter');
  ok(P.hat('ablegen') && !P.g.ship.docked, 'dabei: ablegen (docked true -> false)');
  P.cmd({ c: 'helm.throttle', delta: -1 }); P.run(0.2);
  ok(P.hat('tempo_runter'), 'Temporegler runter: tempo_runter');
  const Q = partie('training_fliegen'); Q.run(0.5); Q.setze('helm'); Q.run(0.2);
  Q.cmd({ c: 'helm.throttle', set: 4 }); Q.run(0.2);
  ok(Q.hat('tempo_hoch') && !Q.hat('tempo_runter'), 'set 4: tempo_hoch (Sprung um mehrere Stufen)');
  Q.cmd({ c: 'helm.stop' }); Q.run(0.2);
  ok(Q.hat('allstopp') && !Q.hat('tempo_runter'), 'Allstopp senkt die Stufe, zählt aber nur als allstopp, nicht als tempo_runter');
  const R = partie('training_fliegen'); R.run(0.5); R.setze('captain'); R.run(0.2);
  R.g.ship.docked = false; R.run(0.1); R.g.ship.helm.stage = 4; R.run(0.2);
  ok(!R.hat('tempo_hoch'), 'Mensch an der Captain-Station, nicht am Steuer: keine Flugziele');
  const S = partie('training_fliegen'); S.run(0.5); S.setze('helm'); S.run(0.2);
  S.g.ship.docked = false; S.run(0.1);
  alsBot(S.h); S.g.ship.helm.stage = 4; S.run(0.2);
  ok(!S.hat('tempo_hoch'), 'Bot statt Mensch am Steuer: kein tempo_hoch');
  const B = partie('training_fliegen', { bots: ['navigation'] }); B.run(0.5); B.setze('helm'); B.run(0.2);
  B.g.ship.docked = false; B.run(0.1);
  const bot = B.g.players.find((p) => p.bot); bot.console = 'helm'; bot.station = null; B.poll();
  B.g.ship.helm.stage = 4; B.poll();
  ok(!B.hat('tempo_hoch'), 'Mensch und Bot beide am Steuer (Bot sitzt an der Navigation): kein tempo_hoch');
  const A = partie('training_fliegen'); A.run(0.5); A.setze('helm'); A.run(0.2);
  A.g.ship.docked = false; A.poll(); A.g.ship.helm.stage = 4; A.g.ship.scene = 'andere'; A.poll();
  ok(!A.hat('tempo_hoch'), 'Szene wechselt im selben Tick (Stufe wird zurückgesetzt): kein Ziel');
  const D = partie('training_fliegen'); D.run(0.5); D.setze('helm'); D.run(0.2);
  D.g.ship.docked = false; D.poll(); D.g.ship.helm.stage = 4; D.poll(); D.g.ship.helm.stage = 1; D.g.ship.docked = true; D.poll();
  ok(!D.hat('tempo_runter'), 'Andocken stellt die Stufe auf Stopp: kein tempo_runter');
});

// ---------- Pollen: Ruder, Fahrt ----------
section('ruder / in_fahrt / gestoppt (helm.turn, speed)', () => {
  const P = partie('training_fliegen'); P.run(0.5); P.setze('helm'); P.run(0.2);
  P.g.ship.docked = false; P.run(0.1);
  P.cmd({ c: 'helm.input', turn: 0.3, thrust: 0 }); P.run(0.2);
  ok(!P.hat('ruder'), 'turn 0,3 unter RUDER_MIN: kein ruder');
  P.cmd({ c: 'helm.input', turn: -1, thrust: 0 }); P.run(0.2);
  ok(P.hat('ruder') && P.hat('ruder_backbord') && !P.hat('ruder_steuerbord'), 'turn -1: ruder + ruder_backbord');
  P.cmd({ c: 'helm.input', turn: 1, thrust: 0 }); P.run(0.2);
  ok(P.hat('ruder_steuerbord'), 'turn +1: ruder_steuerbord');
  P.cmd({ c: 'helm.input', turn: 0, thrust: 0 }); P.run(0.2);
  ok(P.hat('ruder') && P.hat('ruder_backbord'), 'Ruder zurück auf 0: Ziele bleiben (dauerhaft)');
  ok(!P.hat('in_fahrt') && !P.hat('gestoppt'), 'Schiff steht (speed 0), nie gefahren: kein in_fahrt, kein gestoppt');
  P.cmd({ c: 'helm.throttle', set: 5 });
  P.run(40, () => P.hat('in_fahrt'));
  ok(P.hat('in_fahrt') && P.g.ship.speed >= Erk.FAHRT_MIN, 'Stufe VOLL: in_fahrt bei speed >= FAHRT_MIN (' + Math.round(P.g.ship.speed) + ' px/s)');
  ok(!P.hat('gestoppt'), 'in Fahrt: noch nicht gestoppt');
  P.cmd({ c: 'helm.stop' });
  P.run(60, () => P.hat('gestoppt'));
  ok(P.hat('gestoppt') && P.g.ship.speed <= Erk.STEHT_MAX, 'nach Allstopp steht es: gestoppt (' + P.g.ship.speed.toFixed(1) + ' px/s)');
  const S = partie('training_fliegen'); S.run(0.5); S.setze('helm'); S.run(0.2); S.g.ship.docked = false;
  alsBot(S.h); S.g.ship.helm.turn = 1; S.g.ship.speed = 100; S.poll();
  ok(!S.hat('ruder') && !S.hat('in_fahrt'), 'Bot statt Mensch: weder ruder noch in_fahrt');
  const D = partie('training_fliegen'); D.run(0.5); D.setze('helm'); D.run(0.2);
  D.g.ship.helm.turn = 1; D.g.ship.speed = 100; D.poll();
  ok(!D.hat('ruder') && !D.hat('in_fahrt'), 'angedockt: weder ruder noch in_fahrt');
});

// ---------- Ereignisse ----------
section('allstopp / ausweichen (Ereignisse)', () => {
  const P = partie('training_fliegen'); P.run(0.5); P.setze('helm'); P.run(0.2); P.g.ship.docked = false; P.run(0.1);
  P.cmd({ c: 'helm.stop' });
  ok(P.hat('allstopp') && P.ziel('allstopp') === 1, 'helm.stop: allstopp, trainingZiel genau einmal');
  P.cmd({ c: 'helm.dodge', dir: 1 });
  ok(P.hat('ausweichen') && P.hat('ausweichen_rechts') && !P.hat('ausweichen_links'), 'helm.dodge rechts: ausweichen + ausweichen_rechts');
  P.g.ship.dodgeCd = 0; P.cmd({ c: 'helm.dodge', dir: -1 });
  ok(P.hat('ausweichen_links'), 'links: ausweichen_links');
  P.g.ship.dodgeCd = 0; P.cmd({ c: 'helm.dodge', dir: 1 });
  ok(P.ziel('ausweichen') === 1, 'zweites Ausweichen: trainingZiel nicht noch einmal');
  const Q = partie('training_fliegen'); Q.run(0.5); Q.setze('helm');
  Q.cmd({ c: 'helm.stop' });
  ok(!Q.hat('allstopp'), 'angedockt (Allstopp abgelehnt): kein Ziel');
  Q.g.ship.docked = false; alsBot(Q.h); Q.cmd({ c: 'helm.stop' }); Q.g.ship.dodgeCd = 0; Q.cmd({ c: 'helm.dodge', dir: 1 });
  ok(!Q.hat('allstopp') && !Q.hat('ausweichen'), 'Auslöser ist ein Bot: weder allstopp noch ausweichen');
});

section('botBefehl, konsole, tab (Ereignisse und Stationen)', () => {
  let jetzt = 1e12;
  const mit = (P, f) => { const echt = Date.now; jetzt += 5000; Date.now = () => jetzt; try { f(); } finally { Date.now = echt; } };
  const alt = Befehle.REGISTER.ops['ops.scan']; Befehle.REGISTER.ops['ops.scan'] = () => ({ ok: true });   // die Wirkung am Bot gehört nicht hierher
  process.on('exit', () => { Befehle.REGISTER.ops['ops.scan'] = alt; });
  const P = partie('training_captain', { bots: ['navigation', 'ops', 'technik'] }); P.run(0.5);
  P.setze('captain');
  ok(P.hat('konsole:captain') && P.ziel('konsole:captain') === 1, 'consoleEnter durch Menschen: konsole:captain');
  const bot = P.g.players.find((p) => p.bot && p.rolle === 'ops');
  ok(!P.ziele().some((z) => z.startsWith('konsole:') && z !== 'konsole:captain'), 'Bots, die ihre Konsole betreten, erzeugen kein konsole:-Ziel');
  mit(P, () => P.g.handleMessage(P.c, { t: 'bot.befehl', an: 'ops', befehl: 'ops.scan', quelle: 'menu' }));
  ok(P.hat('bot_befehl') && P.hat('bot_befehl:ops.scan') && P.hat('bot_befehl:ops.scan:menu') && P.hat('bot_quelle:menu') && !P.hat('bot_quelle:text'), 'ops.scan über Tafel: bot_befehl, :ops.scan, :ops.scan:menu, bot_quelle:menu');
  mit(P, () => P.g.handleMessage(P.c, { t: 'bot.befehl', an: 'ops', befehl: 'ops.scan', quelle: 'text' }));
  ok(P.hat('bot_befehl:ops.scan:text') && P.hat('bot_quelle:text'), 'dieselbe Aufgabe über Textzeile: bot_befehl:ops.scan:text');
  mit(P, () => P.g.handleMessage(P.c, { t: 'bot.befehl', an: 'navigation', befehl: 'ops.scan', quelle: 'taste' }));
  ok(!P.hat('bot_quelle:taste'), 'falscher Adressat (abgelehnt): kein Ziel');
  const n0 = P.ziele().length;
  mit(P, () => P.g.handleMessage(P.c, { t: 'bot.befehl', an: 'ops', befehl: 'ops.scan', quelle: 'menu' }));
  ok(P.ziele().length === n0 && P.ziel('bot_befehl:ops.scan') === 1, 'wiederholter Befehl: keine neuen Ziele, Ereignis nicht doppelt');
  // Tab: der Mensch an der Captain-Konsole schaltet auf die Steuer. Bot-Stationen weichen dem Menschen (BOT-01 B3).
  ok(!P.hat('tab_wechsel'), 'ohne Tab: kein tab_wechsel');
  P.poll();
  P.cmd({ c: 'station.tab', dir: 1 }); P.poll();
  ok(P.h.station && P.h.station !== 'captain' && P.hat('tab_wechsel') && P.hat('tab:' + P.h.station), 'echter Befehl station.tab (Bots weichen): tab_wechsel + tab:' + P.h.station);
  // deterministischer Tab: Station direkt setzen, wie station.tab es tut
  const Q = partie('training_fliegen'); Q.run(0.5); Q.setze('captain'); Q.poll();
  Q.poll(); ok(!Q.hat('tab_wechsel') && !Q.hat('tab:helm'), 'Station unverändert: kein tab_wechsel');
  Q.h.station = 'helm'; Q.poll();
  ok(Q.hat('tab_wechsel') && Q.hat('tab:helm') && !Q.hat('tab:captain'), 'Tab Captain -> Steuer: tab_wechsel + tab:helm');
  Q.h.station = null; Q.poll();
  ok(Q.hat('tab:captain'), 'Tab zurück zum Captain: tab:captain');
  const R = partie('training_fliegen'); R.run(0.5); R.setze('captain'); R.poll(); alsBot(R.h); R.h.station = 'helm'; R.poll();
  ok(!R.hat('tab_wechsel'), 'Bot statt Mensch wechselt die Station: kein tab_wechsel');
  const W = partie('training_fliegen'); W.run(0.5); W.setze('helm'); W.poll(); W.h.console = null; W.h.station = null; W.poll(); W.setze('technik'); W.poll();
  ok(!W.hat('tab_wechsel'), 'Konsole verlassen und andere betreten ist kein Tab: nur konsole:technik');
  ok(W.hat('konsole:helm') && W.hat('konsole:technik'), 'konsole:helm und konsole:technik');
  const E = partie('training_fliegen'); E.run(0.5);
  E.g.missionEvent('consoleEnter', { kind: 'helm' });
  ok(!E.ziele().some((z) => z.startsWith('konsole:')), 'consoleEnter ohne Spieler (p fehlt): kein Ziel');
});

// ---------- Pollen: Sprung, Andocken, Marker ----------
section('sprungziel_gewaehlt / sprungpunkt (jump.dest, jp, d)', () => {
  const P = partie('training_fliegen'); P.run(0.5); P.setze('captain'); P.run(0.2);
  P.poll();
  ok(!P.hat('sprungziel_gewaehlt'), 'kein Ziel gewählt: kein Ziel');
  P.g.ship.jump.dest = 'boje'; P.g._jumpAuto = true; P.poll();
  ok(!P.hat('sprungziel_gewaehlt'), 'Sprungpunkt-Automatik hat das Ziel gesetzt: zählt nicht');
  P.g.ship.jump.dest = null; P.g._jumpAuto = false; P.poll();
  P.g.ship.jump.dest = 'boje'; P.poll();
  ok(P.hat('sprungziel_gewaehlt'), 'Ziel vom Captain gewählt (Wechsel null -> Ziel, keine Automatik): sprungziel_gewaehlt');
  const Q = partie('training_fliegen'); Q.run(0.5); Q.setze('helm'); Q.poll();
  Q.g.ship.jump.dest = 'boje'; Q.poll();
  ok(!Q.hat('sprungziel_gewaehlt'), 'Ziel steht ohne Captain-Station (z. B. vom Modus gesetzt): kein Ziel');
  const R = partie('training_fliegen'); R.run(0.5); R.setze('captain'); R.poll(); alsBot(R.h);
  R.g.ship.jump.dest = 'boje'; R.poll();
  ok(!R.hat('sprungziel_gewaehlt'), 'Bot statt Mensch: kein Ziel');
  const S = partie('training_fliegen'); S.run(0.5); S.setze('captain'); S.run(0.1);
  S.cmd({ c: 'captain.selectDest', dest: 'hafen' }); S.run(0.1);
  S.poll();
  ok(S.g.ship.jump.dest === null || typeof S.g.ship.jump.dest === 'string', 'echter Befehl captain.selectDest läuft ohne Fehler durch (Ziel: ' + S.g.ship.jump.dest + ')');
  // Sprungpunkt: Schiff in den Radius setzen
  const T = partie('training_fliegen'); T.run(0.5); T.setze('helm'); T.g.ship.docked = false; T.run(0.2);
  const Sprung = require('../server/sim/sprung.js'); const Sektoren = require('../shared/sektoren.js');
  const here = Sektoren.hexVonOrt(T.g.ship.scene);
  const nach = Sektoren.nachbarn(here).find((h) => Sektoren.hatSzene(h) && Sektoren.ortVonHex(h) && Sektoren.spielbar(h) && (Sektoren.kante(Sektoren.kanteId(here, h)) || {}).art === 'open' && Sprung.tutorialZielErlaubt(T.g, h));
  const ziel = Sektoren.ortVonHex(nach);
  T.g.ship.jump.dest = ziel; T.g._jumpAuto = false;
  const lage = Sprung.sprungpunkt(T.g, nach);
  const sc = require('../shared/locations.js').get(T.g.ship.scene).scene;
  const zumRand = (l, d) => { const dx = sc.w / 2 - l.x, dy = sc.h / 2 - l.y, len = Math.hypot(dx, dy) || 1; return { x: l.x + dx / len * d, y: l.y + dy / len * d }; };   // von der Randlage zur Szenenmitte
  let q = zumRand(lage, 600); T.g.ship.x = q.x; T.g.ship.y = q.y; T.run(0.2);
  ok(T.g.ship.jump.jp && !T.hat('sprungpunkt'), 'Ziel gewählt, aber weit weg (' + T.g.ship.jump.d + ' px): kein sprungpunkt');
  q = zumRand(lage, 100); T.g.ship.x = q.x; T.g.ship.y = q.y; T.run(0.2);
  ok(T.hat('sprungpunkt') && T.g.ship.jump.d <= 250, 'im Radius (' + T.g.ship.jump.d + ' px): sprungpunkt');
  const U = partie('training_fliegen'); U.run(0.5); U.setze('captain'); U.g.ship.docked = false; U.run(0.2);
  U.g.ship.jump.dest = ziel; const l2 = Sprung.sprungpunkt(U.g, nach); q = zumRand(l2, 100); U.g.ship.x = q.x; U.g.ship.y = q.y; U.run(0.2);
  ok(!U.hat('sprungpunkt'), 'Mensch am Captain statt am Steuer: kein sprungpunkt');
});

section('andocken / ablegen (ship.docked)', () => {
  const P = partie('training_fliegen'); P.run(0.5); P.setze('helm'); P.poll();
  P.poll(); ok(!P.hat('ablegen') && !P.hat('andocken'), 'angedockt und unverändert: kein Ziel');
  P.g.ship.docked = false; P.poll();
  ok(P.hat('ablegen') && !P.hat('andocken'), 'docked true -> false: ablegen');
  P.g.ship.docked = true; P.poll();
  ok(P.hat('andocken'), 'docked false -> true: andocken');
  const Q = partie('training_fliegen'); Q.run(0.5); Q.setze('helm'); alsBot(Q.h); Q.poll(); Q.g.ship.docked = false; Q.poll(); Q.g.ship.docked = true; Q.poll();
  ok(!Q.hat('ablegen') && !Q.hat('andocken'), 'Bot statt Mensch: kein ablegen/andocken');
  const R = partie('training_fliegen'); R.run(0.5); R.setze('captain'); R.poll(); R.g.ship.docked = false; R.poll();
  ok(!R.hat('ablegen'), 'Mensch an der Captain-Station (nicht am Steuer): kein ablegen');
});

section('marker (ship.markers.captain)', () => {
  const P = partie('training_fliegen'); P.run(0.5); P.setze('captain'); P.run(0.2);
  P.run(1); ok(!P.hat('marker'), 'keine Marke: kein Ziel');
  P.cmd({ c: 'captain.marker', x: 500, y: 500 }); P.run(0.2);
  ok(P.hat('marker') && !!P.g.ship.markers.captain, 'captain.marker: marker');
  const Q = partie('training_fliegen'); Q.run(0.5); Q.setze('captain'); Q.poll(); alsBot(Q.h);
  Q.g.ship.markers.captain = { x: 1, y: 1 }; Q.poll();
  ok(!Q.hat('marker'), 'Bot statt Mensch: kein marker');
  const R = partie('training_fliegen'); R.run(0.5); R.setze('helm'); R.poll(); R.g.ship.markers.captain = { x: 1, y: 1 }; R.poll();
  ok(!R.hat('marker'), 'Mensch am Steuer statt am Captain: kein marker');
  const S = partie('training_fliegen'); S.g.ship.markers.captain = { x: 1, y: 1 }; S.run(0.5); S.setze('captain'); S.poll(); S.poll();
  ok(!S.hat('marker'), 'Marke steht schon vor der ersten Messung (Ausgangslage): kein Ziel');
});

// ---------- Dauer, Flag, Neustart ----------
section('Dauer, Flag, trainingZiel, Neustart', () => {
  const P = partie('training_fliegen'); P.run(0.5); P.setze('helm'); P.run(0.2); P.g.ship.docked = false; P.run(0.1);
  P.cmd({ c: 'helm.stop' });
  ok(P.g.mission.flags.ziel_allstopp === true, 'Buchflag ziel_allstopp gesetzt');
  ok(P.g.mission.cond({ check: { name: 'training_ziel', id: 'allstopp' } }) === true && P.g.mission.cond({ check: { name: 'training_ziel', id: 'tempo_hoch' } }) === false, 'mission.cond check training_ziel: erreicht true, anderes false');
  P.cmd({ c: 'helm.throttle', set: 4 }); P.cmd({ c: 'helm.throttle', set: 1 }); P.run(3);
  ok(P.hat('allstopp') && P.g.mission.cond({ check: { name: 'training_ziel', id: 'allstopp' } }), 'Ziel bleibt, auch nach vielen Ticks');
  P.cmd({ c: 'helm.input', turn: 1, thrust: 0 }); P.run(0.2);
  ok(P.g.mission.flags.ziel_ruder_steuerbord === true && P.ziel('ruder') === 1, 'Flag mit Zahlen/Unterstrich; trainingZiel ruder einmal trotz Dauerdruck');
  P.setze('captain');
  P.g.missionEvent('botBefehl', { befehl: 'ops.scan', an: 'ops', quelle: 'menu', botId: 'b1' });
  ok(P.g.mission.flags.ziel_bot_befehl_ops_scan === true, 'Flag aus bot_befehl:ops.scan -> ziel_bot_befehl_ops_scan');
  Training.neustart(P.g);
  ok(P.ziele().length === 0 && !P.g.mission.flags.ziel_allstopp && !P.g.mission.flags.ziel_bot_befehl_ops_scan && P.g.mission.cond({ check: { name: 'training_ziel', id: 'allstopp' } }) === false, 'Neustart: Menge leer, Flags weg, Prüfung false');
  P.poll();
  P.cmd({ c: 'helm.input', turn: 1, thrust: 0 }); P.setze('helm'); P.g.ship.docked = false; P.g.ship.helm.turn = 1; P.poll();
  ok(P.hat('ruder') && P.ziel('ruder') === 2, 'nach Neustart wieder erreichbar (zweites trainingZiel)');
  ok(P.g.errors === 0, 'g.errors 0 (' + P.g.errors + ')');
});

// ---------- Prüfung: Registry und Checker ----------
section('Registry training_ziel und Checker', () => {
  const Registry = require('../server/mission/registry.js');
  const e = Registry.get('training_ziel');
  ok(e && e.art === 'pruefung' && e.intern === true, 'training_ziel ist eine interne Prüfung der Registry');
  for (const id of ['tempo_hoch', 'ruder_backbord', 'allstopp', 'konsole:captain', 'tab:helm', 'bot_befehl', 'bot_befehl:ops.scan', 'bot_befehl:ops.scan:sprache', 'bot_quelle:text']) ok(Erk.istZielId(id), 'gültige Ziel-Id ' + id);
  for (const id of ['tempo_hocch', 'konsole:xx', 'tab:plan', 'bot_befehl:ops.gibtesnicht', 'bot_befehl:ops.scan:bogen', 'bot_quelle:bogen', '', null, 3]) ok(!Erk.istZielId(id), 'ungültige Ziel-Id ' + JSON.stringify(id));
  const basis = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'regiebuecher', 'tra_fliegen.regiebuch.json'), 'utf8'));
  const mitZiel = (id, mod) => { const d = JSON.parse(JSON.stringify(basis)); d.steps[0].objectives[0].done = { check: { name: 'training_ziel', id } }; if (mod) mod(d); return d; };
  const r0 = Checker.check(JSON.parse(JSON.stringify(basis)));
  const r1 = Checker.check(mitZiel('tempo_hoch'));
  ok(r0.ok && r1.ok, 'Checker akzeptiert ein internes Buch mit { check: training_ziel, id } (Platzhalter ok: ' + r0.ok + ', mit Prüfung: ' + r1.ok + (r1.ok ? '' : ' ' + JSON.stringify(r1.errors.slice(0, 2))) + ')');
  const r2 = Checker.check(mitZiel('tempo_hocch'));
  ok(!r2.ok && r2.errors.some((x) => x.code === 'PARAM-WERT'), 'Checker lehnt eine unbekannte Ziel-Id ab (PARAM-WERT)');
  const r3 = Checker.check(mitZiel('tempo_hoch', (d) => { d.kopf.art = 'auftrag'; }));
  ok(!r3.ok && r3.errors.some((x) => x.code === 'BAUSTEIN-INTERN'), 'Checker lehnt die Prüfung in einem Nicht-intern-Buch ab (BAUSTEIN-INTERN)');
  const r4 = Checker.check(mitZiel('tempo_hoch', (d) => { d.steps[0].objectives[0].done = { check: { name: 'training_ziel' } }; }));
  ok(!r4.ok, 'Checker lehnt training_ziel ohne id ab');
});

// ---------- Abzeichen ----------
section('Abzeichen und Neustart nach Erfolg', () => {
  for (const [modus, id, sprache, variante] of [['training_fliegen', 'fliegen', false, undefined], ['training_captain', 'captain', false, 'tafel'], ['training_captain', 'captain', true, 'sprache']]) {
    const P = partie(modus, { sprache }); P.run(1);
    const tr = P.g.arena.training; const buch = Training.buchFuer(P.g);   // TRA-01 E: Standardbuch oder Sprachvariante
    P.g.mission.flags.trainingFertig = true;
    P.run(1);
    ok(P.g.mission.missions[buch].ausgang === 'erfolg', modus + (sprache ? ' (Sprache)' : '') + ': Buch endet mit erfolg');
    const a = P.abzeichen();
    ok(a.length === 1 && a[0].id === id && a[0].variante === variante && ('variante' in a[0]) === (variante !== undefined), '  genau ein Ereignis abzeichen { id ' + id + (variante ? ', variante ' + variante : ', ohne variante') + ' } ' + JSON.stringify(a.map((x) => ({ id: x.id, variante: x.variante }))));
    ok(P.odas.filter((t) => /^Abzeichen erreicht: /.test(t)).length === 1 && P.odas.some((t) => t.startsWith('Abzeichen erreicht: ' + (id === 'fliegen' ? 'Fliegen' : 'Captain'))), '  ODA-Zeile „Abzeichen erreicht: …“ einmal: ' + P.odas.filter((t) => /^Abzeichen/.test(t)).join(' | '));
    P.run(5);
    ok(P.abzeichen().length === 1 && tr.versuch === 1, '  vor Ablauf der Frist (' + Training.NEUSTART_NACH_ERFOLG + ' s): keine zweite Meldung, noch kein Neustart');
    ok(Training.abzeichenVergeben(P.g, id) === false && P.abzeichen().length === 1, '  direkter zweiter Aufruf im selben Versuch: nichts gesendet');
    P.run(5, () => tr.versuch === 2);
    ok(tr.versuch === 2 && P.g.mission.activeId === buch && P.g.mission.missions[buch].state === 'active' && P.g.mission.step && P.g.mission.step.id === P.g.mission.def.steps[0].id, '  Neustart nach Erfolg: Versuch 2, neues Buch aktiv im ersten Schritt');
    ok(P.g.mission.flags.trainingFertig === false && tr.gemeldet === false && Erk.ziele(P.g).length === 0, '  Flag, Meldung und Ziele zurückgesetzt');
    ok(P.g.ship.docked === true && P.g.ship.scene === 'hafen' && P.g.players.every((p) => p.zone === 'ship'), '  Szene von vorn (angedockt am Hafen, Crew an Bord)');
    P.g.mission.flags.trainingFertig = true; P.run(1);
    ok(P.abzeichen().length === 2 && P.g.mission.missions[buch].ausgang === 'erfolg', '  zweiter Durchlauf vergibt wieder (2 Ereignisse)');
    P.run(10, () => tr.versuch === 3);
    ok(tr.versuch === 3 && P.g.mission.activeId === buch, '  und startet wieder neu (Versuch 3)');
    ok(P.g.errors === 0, '  g.errors 0 (' + P.g.errors + ')');
  }
  const Q = partie('training_fliegen'); Q.run(1);
  ok(Training.abzeichenVergeben(Q.g, 'gibtesnicht') === false && Q.abzeichen().length === 0, 'unbekanntes Abzeichen: nichts gesendet');
  const G = new Game({ noStore: true, worlds: false, seed: 3, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  ok(Training.abzeichenVergeben(G, 'fliegen') === false, 'ohne Trainingspartie: nichts gesendet, kein Wurf');
  const V = partie('training_fliegen'); V.run(1); V.g.mission.completeMission('verloren'); V.run(5);
  ok(V.abzeichen().length === 0, 'Ausgang verloren: kein Abzeichen');
});

console.log(`\ntest-training-erkennung: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
