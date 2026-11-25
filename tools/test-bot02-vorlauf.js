'use strict';
// BOT-02 B3: Vor dem Beamen: Posten, Scan, Stopp (server/bots/lauf.js Vorlauf, bordlage.js landescanOffen, mannschaft.js bordVorTransfer/landescanAuto/stoppFuerBeam, status.js). Echtes Game, Server-Bots, Ort methalle mit dem Landepunkt methalle.siedlung
// (echter Spielpfad: transfer.ziel/chooseLandepunkt, weapons.landescan, E halten auf dem Pad = selfbeam).
//   1. (a) Der Bord-Bot (Technik) steht an der Transfer-Konsole, bevor der Beam des Menschen endet (der Mensch laeuft mit echten Eingaben zum Pad); Zeitmessung. (i) Abnahme 7 in einer Szene: Scan fertig, Steuerung gestoppt, Bot am Transfer
//   2. (b) Mensch waehlt am Transfer und bleibt dort: der Bot wartet an seiner Station und geht erst, wenn die Konsole frei ist (nie zwei Halter)
//   3. (c) Ops-Bot scannt automatisch (ein Scan), (h) Mensch an Ops sperrt, bereits gescannt: kein Scan, kein Ops-Bot: kein Scan, ops.landescan auf Befehl
//   4. (d) Navigations-Bot stoppt das fahrende Schiff (canBeam danach ohne tooFast); ohne Navigations-Bot kein Stopp; ohne Landepunkt kein Stopp; nur Tempo, nie Position; Befehle im Vorlauf (in Reichweite)
//      V-2 Landepunkt ausserhalb der Beamreichweite: Vorlauf nur vorgemerkt, nav.kurs fliegt hin, bei Eintritt stoppt der Nav-Bot und der Bord-Bot geht zum Transfer; die Frist zaehlt nur in Reichweite
//      V-3 Standardort ohne gewaehlten Landepunkt: ein Mensch auf dem Pad bei zu schnellem Schiff (in Reichweite) loest den Stopp aus, danach gelingt E; ohne Mensch auf dem Pad und ausserhalb der Reichweite kein Stopp
//   5. (e) Bord-Bot = Ops-Bot (kein Technik-Bot): erst Scan, dann Transfer; der Navigations-Bot ist nie Bord-Bot (er haelt das Schiff an der Steuer an und bleibt dort)
//   6. (f) Abbruch: Landepunkt weg, Frist (60 s), Mensch beamt nie: der Bot kehrt zurueck, nie zwei Halter, kein zweiter Vorlauf fuer dasselbe Ziel, neue Wahl beginnt neu; nach dem Beam kein neuer Vorlauf
//      V-4 Gegner im Raum und Reaktor-Countdown beenden den Vorlauf (kein Stillstand), V-5 ein abgebrochener Beam beendet ihn nicht, V-6 ein bewusstloser Mensch haelt ihn nicht am Leben
//   7. bot.status, Quellscan, (g) reine Menschenpartie byte-gleich (mess-bot02-menschenpartie.js gegen den merge-base mit main)
//   Notsprung (V-1): tools/test-bot02-notsprung.js
//   Mutationsproben: Umgebungsvariable BOT_VOR_MUT (tools/mutation-bot02-vorlauf.js)
//   node tools/test-bot02-vorlauf.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
process.chdir(path.join(__dirname, '..'));
const { Game } = require('../server/game.js');
const Station = require('../server/sim/station.js');
const interior = require('../server/sim/interior.js');
const away = require('../server/sim/away.js');
const space = require('../server/sim/space.js');
const Physics = require('../shared/physics.js');
const Lpscan = require('../server/sim/lpscan.js');
const W = require('../server/world.js');
const BotSpieler = require('../server/bots/spieler.js');
const Lauf = require('../server/bots/lauf.js');
const Lage = require('../server/bots/bordlage.js');
const Status = require('../server/bots/status.js');
const { BotMannschaft } = require('../server/bots/mannschaft.js');
const { STOP } = require('../server/bots/kern.js');
const { bfs } = require('../server/util.js');
const Protocol = require('../shared/protocol.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const info = (t) => console.log('  info  ' + t);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-bot02vor-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
let seq = 0;
const LP = 'methalle.siedlung';
const BEAM = { x: 1349, y: 928 };   // Beam-Punkt des Landepunkts (Reichweite 360, Scanreichweite 900)

// ---------- Aufbau (wie tools/test-bot02-bord.js) ----------
const mkConn = () => ({ inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } });
function mensch(g, i) {
  const c = mkConn(); g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'K' + i, color: i });
  return c;
}
function partie(o) {
  o = o || {};
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: o.seed || 7, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  g.botZufall = (() => { let a = 42; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const spy = []; const echt = g.handleMessage.bind(g);
  g.handleMessage = (conn, msg) => { if (conn && conn.bot) spy.push({ pid: conn.player ? conn.player.id : null, msg, t: g.time }); return echt(conn, msg); };
  const conns = []; for (let i = 0; i < (o.menschen || 1); i++) conns.push(mensch(g, i));
  for (const r of o.bots || []) BotSpieler.botHinzufuegen(g, null, r);
  const P = { g, conns, c: conns[0], h: conns[0].player, spy };
  g.lobbyOpts.startMission = 'arena_space';
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) { g.arena.nextAt = 1e9; g.space.enemies = []; }
  return P;
}
const tick = (P) => { P.g.step(); if (P.g.wantsSnapshot()) P.g.snapshot(); };
const lauf = (P, sec, bis, jeTick) => { const t1 = P.g.time + sec; while (P.g.time < t1) { tick(P); if (jeTick) jeTick(); if (bis && bis()) return true; } return bis ? !!bis() : true; };
const botVon = (P, rolle) => P.g.players.find((p) => p.bot && p.rolle === rolle);
const agentVon = (P, rolle) => Lauf.agent(P.g, botVon(P, rolle));
const KONSOLE = { navigation: 'helm', ops: 'weapons', technik: 'technik' };
const sitzen = (P) => P.g.players.filter((p) => p.bot).every((p) => Station.stationOf(p) === KONSOLE[p.rolle]);
const cmds = (P, pid, prefix, ab) => P.spy.filter((s) => s.pid === pid && s.msg.t === 'cmd' && (!prefix || s.msg.c.startsWith(prefix)) && s.t >= (ab || 0));
const haelt = (P, ort) => P.g.players.filter((p) => p.connected && (p.console === ort || Station.stationOf(p) === ort));
function doppelt(P) { for (const ort of ['helm', 'weapons', 'technik', 'captain', 'transfer']) if (haelt(P, ort).length > 1) return ort; return null; }
const echtJetzt = Date.now; let versatz = 0;   // die Annahme begrenzt auf 10 Befehle je Sekunde (Wanduhr): jeder Befehl des Tests bekommt 200 ms Abstand
function befehl(P, msg) {
  Date.now = () => echtJetzt() + (versatz += 200);
  const n0 = P.c.inbox.length;
  P.g.handleMessage(P.c, Object.assign({ t: 'bot.befehl', quelle: 'menu' }, msg));
  return P.c.inbox.slice(n0).filter((o) => o.t === Protocol.C.BOT_ANTWORT);
}
const wanduhr = () => { Date.now = echtJetzt; };

// ---------- Mutationsproben (nur mit BOT_VOR_MUT; jede muss den Test rot machen) ----------
const MUT = process.env.BOT_VOR_MUT || '';
function laufKlasse() {   // die Klasse Lauf ist nicht exportiert: ueber eine Wegwerfpartie
  const P = partie({ bots: ['technik'] }); lauf(P, 1);
  return Object.getPrototypeOf(Lauf.agent(P.g, botVon(P, 'technik')).lauf);
}
if (MUT) {
  const proto = BotMannschaft.prototype; const L = laufKlasse();
  const mitSicht = (L, tun) => { const alt = L.vorlaufPruefen; L.vorlaufPruefen = function () { return tun.call(this, alt.bind(this)); }; };   // Wrapper um vorlaufPruefen
  if (MUT === 'vorlauf_aus') L.vorlaufPruefen = function () { this.vorlauf = null; };   // kein Vorlauf
  else if (MUT === 'frist_raus') { const alt = L.vorlaufPruefen; L.vorlaufPruefen = function () { const v = this.vorlauf; alt.call(this); if (v && !this.vorlauf && this.game.transferZiel === v.ziel && this.game.time - v.seit > Lauf.VORLAUF_FRIST) this.vorlauf = v; }; }   // die Frist endet den Vorlauf nicht
  else if (MUT === 'ziel_mehrfach') { const alt = L.vorlaufPruefen; L.vorlaufPruefen = function () { alt.call(this); if (!this.vorlauf) this.vorlaufZiel = null; }; }   // dasselbe Ziel beginnt nach dem Ende wieder
  else if (MUT === 'scan_auto_aus') proto.landescanAuto = () => false;
  else if (MUT === 'scan_doppelt') Lage.landescanOffen = (g) => !!g.transferZiel && !g.lpscan;   // auch ein gescannter Landepunkt wird wieder gescannt
  else if (MUT === 'scan_vor_transfer_raus') { const alt = proto.bordVorTransfer; proto.bordVorTransfer = function (S) { if (this.rolleBot === 'ops') return false; return alt.call(this, S); }; }
  else if (MUT === 'stopp_aus') proto.stoppFuerBeam = () => false;
  else if (MUT === 'stopp_immer') { L.beamVorbereitet = () => true; L.stoppNoetig = () => true; }   // auch ohne Landepunkt und ohne Beam
  else if (MUT === 'bereich_ignorieren') Lage.beamInReichweite = () => true;   // V-2: Vorlauf, Stopp und Sperre auch ausserhalb der Beamreichweite
  else if (MUT === 'frist_ausserhalb') mitSicht(L, function (alt) { const s0 = this.vorlauf && this.vorlauf.seit; alt(); if (this.vorlauf && s0 != null) this.vorlauf.seit = s0; });   // V-2: die Frist zaehlt auch ausserhalb der Reichweite
  else if (MUT === 'pad_signal_aus') Lage.padMenschZuSchnell = () => false;   // V-3: ein Mensch auf dem Pad loest keinen Stopp aus
  else if (MUT === 'pad_ohne_mensch') Lage.padMenschZuSchnell = (g) => g.ship.speed > g.C.ship.beamMaxSpeed && Lage.beamInReichweite(g);   // V-3: Stopp auch ohne Mensch auf dem Pad
  else if (MUT === 'pad_ohne_absicht') Lage.padMenschZuSchnell = (g) => g.ship.speed > g.C.ship.beamMaxSpeed && g.players.some((p) => p && p.connected && !p.bot && !p.downed && p.zone === 'ship' && away.onPad(g, p)) && Lage.beamInReichweite(g);   // S1: schon das blosse Stehen auf dem Pad gilt als Beamabsicht (alte Regel)
  else if (MUT === 'pad_verwirft') { const alt = proto.steuerDienst; proto.steuerDienst = function (S, p) { if (this.absicht.befehl && this.lauf.stoppNoetig() && !this.lauf.beamVorbereitet() && !this.aussenteamUnten()) this.befehlVerwerfen('aussenteam'); return alt.call(this, S, p); }; }   // S1: das Pad-Signal verwirft den laufenden Befehl des Menschen
  else if (MUT === 'gegner_ignorieren') mitSicht(L, function (alt) { const sp = this.game.space; const e = sp.enemies; sp.enemies = []; try { return alt(); } finally { sp.enemies = e; } });   // V-4: Gegner beenden den Vorlauf nicht
  else if (MUT === 'countdown_ignorieren') mitSicht(L, function (alt) { const sh = this.game.ship; const c = sh.reaktorCountdown; sh.reaktorCountdown = null; try { return alt(); } finally { if (sh.reaktorCountdown === null) sh.reaktorCountdown = c; } });   // V-4: Reaktor-Countdown beendet den Vorlauf nicht
  else if (MUT === 'abbruch_beendet') mitSicht(L, function (alt) { alt(); if (this.vorlauf && this.game.players.some((p) => p.hold && p.hold.kind === 'beam')) this.vorlauf = null; });   // V-5: ein haltender Mensch beendet den Vorlauf
  else if (MUT === 'downed_zaehlt') mitSicht(L, function (alt) { const aus = this.game.players.filter((p) => p.downed); for (const p of aus) p.downed = false; try { return alt(); } finally { for (const p of aus) p.downed = true; } });   // V-6: ein bewusstloser Mensch haelt den Vorlauf am Leben
  else if (MUT === 'mensch_gewinnt_raus') L.dienstLaeuft = function (sp) { return this.bordAktiv(sp); };   // der Dienst ruht nicht, wenn ein Mensch den Transfer haelt
  else if (MUT === 'vorlauf_nav_offen') proto.aussenteamUnten = function () { return this.game.players.some((o) => o.zone === 'away'); };   // Navigationsbefehle im Vorlauf nicht gesperrt
  else { console.log('unbekannte Mutation ' + MUT); process.exit(2); }
}

// ---------- Szene ----------
// Ort methalle, Schiff in Beamreichweite (dx vom Beam-Punkt), Mission sperrt das Beamen nicht. o.bots, o.menschen, o.stage (Fahrstufe des Schiffs)
function szene(o) {
  o = o || {};
  const P = partie({ bots: o.bots || ['navigation', 'ops', 'technik'], menschen: o.menschen || 1 });
  lauf(P, 40, () => sitzen(P));
  const g = P.g;
  space.enterScene(g, 'methalle', {}); lauf(P, 1);
  g.explore.known.add('methalle'); g.explore.version++;
  g.ship.x = BEAM.x - (o.dx == null ? 150 : o.dx); g.ship.y = BEAM.y; g.ship.vx = 0; g.ship.vy = 0;
  g.mission.beamDownBlocked = () => null;
  if (g.arena) { g.arena.nextAt = 1e9; g.space.enemies = []; }
  g.away.drones = [];
  lauf(P, 1);
  return P;
}
// der Mensch waehlt am Transfer den Landepunkt (Spielpfad: Konsole betreten, transfer.ziel); bleibt an der Konsole, bis verlassen(P)
function waehle(P, mensch) {
  const h = mensch || P.h; const conn = P.conns.find((c) => c.player === h);
  neben(P.g, h, 'transfer');   // der Mensch steht an der Konsole (nicht irgendwo im Schiff): der Weg zum Pad ist der echte
  interior.enterConsole(P.g, h, 'transfer');
  const n0 = conn.inbox.length;
  P.g.handleMessage(conn, { t: 'cmd', c: 'transfer.ziel', landepunkt: LP });
  return conn.inbox.slice(n0).filter((m) => m.kind === 'notice').map((m) => m.text);
}
const verlassen = (P, mensch) => { lauf(P, 0.1); const h = mensch || P.h; P.g.handleMessage(P.conns.find((c) => c.player === h), { t: 'leave' }); };
function neben(g, p, konsole) {   // wie test-bot02-bord.js: der Mensch steht neben der Konsole (E tippen betritt sie ueber den Spielpfad, der Bot weicht)
  const ct = W.CONSOLE_TILES[konsole][0];
  const t = W.accessTiles(W.ship, W.shipWalkable, ct.x, ct.y)[0];
  const c = W.tileCenter(t.x, t.y); p.x = c.x; p.y = c.y; p.moving = false; p.input.mx = 0; p.input.my = 0;
  const dx = ct.x - t.x, dy = ct.y - t.y; p.dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
}
const eTaste = (g, conn) => { g.handleMessage(conn, { t: 'act', down: true }); g.handleMessage(conn, { t: 'act', down: false }); };
const eDown = (P) => P.g.handleMessage(P.c, { t: 'act', down: true });
const eUp = (P) => P.g.handleMessage(P.c, { t: 'act', down: false });
let inputSeq = 5000;
// Der Mensch laeuft nach dem Verlassen der Konsole mit echten Eingaben (input) auf kuerzestem Weg (BFS wie die Bots) zum naechsten Pad, haelt dort E (act) und wartet auf die Landung (V-8: kein Modell, kein Setzen).
// -> { tE (s ab Aufruf bis E), tBot (s bis bot an der Transfer-Konsole, null = nicht), tLand, botBeiLandung (steht der Bot in dem Tick, in dem der Mensch unten ankommt, am Transfer) }; die Schleife laeuft, bis beide da sind.
// Der Mensch hier ist der SCHNELLSTE: kein Zoegern zwischen Verlassen der Konsole und E (Messung: das Pad liegt knapp 1 s von der Konsole).
function geheUndBeame(P, bot, jeTick) {
  const g = P.g, h = P.h; const t0 = g.time; const res = { tE: null, tBot: null, tLand: null, botBeiLandung: null };
  const istPad = (x, y) => W.SHIP_PADS.some((q) => q.x === x && q.y === y);
  while (g.time < t0 + 40 && (res.tLand === null || res.tBot === null)) {
    if (res.tE === null) {
      const weg = bfs((x, y) => W.shipWalkable(x, y), Physics.toTile(h.x, h.y), istPad, W.ship.w, W.ship.h, null, W.liftLinksFor(0));
      if (weg && weg.length) { const c = W.tileCenter(weg[0].x, weg[0].y); const dx = c.x - h.x, dy = c.y - h.y, l = Math.hypot(dx, dy) || 1; g.handleMessage(P.c, { t: 'input', seq: ++inputSeq, mx: dx / l, my: dy / l }); }
      else { g.handleMessage(P.c, { t: 'input', seq: ++inputSeq, mx: 0, my: 0 }); g.handleMessage(P.c, { t: 'act', down: true }); res.tE = g.time - t0; }
    }
    tick(P); if (jeTick) jeTick();
    if (res.tBot === null && bot.console === 'transfer') res.tBot = g.time - t0;
    if (h.zone === 'away' && res.tLand === null) { res.tLand = g.time - t0; res.botBeiLandung = bot.console === 'transfer'; }
  }
  return res;
}
const scans = (P) => cmds(P, botVon(P, 'ops') ? botVon(P, 'ops').id : -1, 'weapons.landescan');
const stopps = (P, rolle, ab) => cmds(P, botVon(P, rolle || 'navigation').id, 'helm.stop', ab);

// ---------- 1 (a) Posten vor dem Beamen, (i) Abnahme 7 ----------
section('1 Posten vor dem Beamen (3 Bots + 1 Mensch, der Mensch laeuft echt): der Bord-Bot geht zum Transfer; Abnahme 7 in einer Szene');
{
  const P = szene(); const { g, h } = P; const tb = botVon(P, 'technik'); const ag = agentVon(P, 'technik');
  ok(!Lauf.vorlaufLaeuft(g) && !Lauf.bordAktiv(g, tb) && tb.console === 'technik', 'Ausgangslage: kein Landepunkt, kein Vorlauf, der Technik-Bot sitzt an der Technik');
  g.ship.helm.stage = 2; lauf(P, 4);   // das Schiff faehrt (Fahrstufe 2)
  const v0 = g.ship.speed;
  const t0 = g.time;
  const fehler = waehle(P);
  ok(fehler.length === 0 && g.transferZiel && g.transferZiel.lp === LP, 'der Mensch waehlt den Landepunkt am Transfer (transfer.ziel): transferZiel gesetzt');
  lauf(P, 0.2);
  ok(Lauf.vorlaufLaeuft(g) && Lauf.bordAktiv(g, tb), 'Landepunkt gewaehlt, Mensch an Bord: der Vorlauf laeuft, der Dienst des Technik-Bots ist faellig (noch niemand unten, kein Beam)');
  ok(!Lage.untenMenschen(g).length && !g.ship.beaming && !(h.hold && h.hold.kind === 'beam'), 'dabei ist niemand unten und niemand beamt');
  // der Mensch hat die Konsole: der Bot wartet (b), der Ops-Bot scannt, der Navigations-Bot stoppt
  lauf(P, 14, () => Lpscan.gescannt(g, LP) && g.ship.speed <= g.C.ship.beamMaxSpeed && g.ship.helm.stage === STOP);
  ok(tb.console === 'technik' && Station.stationOf(tb) === 'technik', 'Mensch an der Transfer-Konsole: der Technik-Bot bleibt an der Technik (Mensch gewinnt)');
  ok(Lpscan.gescannt(g, LP) && scans(P).length === 1, `Landepunkt gescannt, genau ein Scan des Ops-Bots (${scans(P).length})`);
  ok(g.ship.helm.stage === STOP && g.ship.speed <= g.C.ship.beamMaxSpeed && stopps(P).length >= 1, `Schiff gestoppt: Stufe Stopp, Tempo ${g.ship.speed.toFixed(1)} (vorher ${v0.toFixed(1)}), ${stopps(P).length} helm.stop des Navigations-Bots`);
  ok(away.canBeam(g, 'down').ok, 'away.canBeam down: ok (kein tooFast, in Reichweite)');
  // der Mensch verlaesst die Konsole, laeuft mit echten Eingaben zum Pad und haelt E; der Technik-Bot geht zum Transfer
  verlassen(P); const tLeave = g.time;
  const w = geheUndBeame(P, tb);
  info(`Messung (echte Eingaben): der Mensch haelt E ${w.tE === null ? '-' : w.tE.toFixed(1)} s nach dem Verlassen der Konsole, der Technik-Bot ist ${w.tBot === null ? '-' : w.tBot.toFixed(1)} s danach am Transfer, der Mensch ist ${w.tLand === null ? '-' : w.tLand.toFixed(1)} s danach unten (Beam ${g.C.ship.beamTime} s)`);
  ok(w.tE !== null && w.tBot !== null && w.tLand !== null && w.tBot - w.tLand <= 1, `der Bot ist spaetestens 1 s nach der Landung des schnellsten Menschen am Transfer (Bot +${w.tBot === null ? '-' : w.tBot.toFixed(1)} s, Landung +${w.tLand === null ? '-' : w.tLand.toFixed(1)} s, beides ab dem Verlassen der Konsole; bei der Landung am Transfer: ${w.botBeiLandung})`);
  ok(w.tLand !== null && h.zone === 'away' && g.time - tLeave > 0, 'der Beam laeuft durch: der Mensch ist unten');
  lauf(P, 1);
  ok(Station.stationOf(tb) === 'transfer' && ag.absicht.zustand === 'an_station' && haelt(P, 'transfer').length === 1, 'der Technik-Bot steht an der Transfer-Konsole (an_station), genau ein Halter');
  // (i) Abnahme 7 als eine Szene
  lauf(P, 1);
  ok(tb.console === 'transfer' && Lauf.dienstLaeuft(g, tb) && Lpscan.gescannt(g, LP) && g.ship.helm.stage === STOP && g.ship.speed <= g.C.ship.beamMaxSpeed && g.ship.beaming === null,
    'Abnahme 7 (eine Szene, Mensch unten): der Bot steht an der Transfer-Konsole, die Steuerung ist gestoppt, der Landepunkt ist gescannt');
  ok(!Lauf.vorlaufLaeuft(g) && Lauf.bordAktiv(g, tb), 'mit dem Mensch unten gilt der Dienst wie bisher (der Vorlauf ist zu Ende), er laeuft weiter');
  // Aufstieg: Dienst zu Ende, der Vorlauf beginnt fuer dasselbe Ziel nicht neu
  interior.placeOnShipPad(g, h); eUp(P);
  lauf(P, 40, () => Station.stationOf(tb) === 'technik'); lauf(P, 2);
  ok(Station.stationOf(tb) === 'technik' && !Lauf.vorlaufLaeuft(g) && g.transferZiel && g.transferZiel.lp === LP, 'Aufstieg: der Bot ist wieder an der Technik, das Ziel gilt noch, aber es beginnt keinen neuen Vorlauf');
  ok(doppelt(P) === null && g.errors === 0 && agentVon(P, 'technik').verworfen === 0, 'nie zwei Halter, game.errors 0, Wachposten hat nichts verworfen');
}

// ---------- 2 (b) Mensch waehlt am Transfer, der Bot wartet ----------
section('2 Mensch bleibt am Transfer: der Bot wartet an seiner Station und geht erst, wenn die Konsole frei ist');
{
  const P = szene({ bots: ['ops', 'technik'] }); const { g } = P; const tb = botVon(P, 'technik');
  waehle(P);
  let d = null; lauf(P, 12, null, () => { if (!d) d = doppelt(P); });
  ok(Lauf.vorlaufLaeuft(g) && tb.console === 'technik' && haelt(P, 'transfer').length === 1 && haelt(P, 'transfer')[0] === P.h && !d, '12 s mit dem Menschen am Transfer: der Vorlauf laeuft, der Technik-Bot bleibt an der Technik, nur der Mensch haelt die Konsole');
  ok(!Lauf.dienstLaeuft(g, tb) && Lauf.bordAktiv(g, tb), 'der Dienst ist faellig, ruht aber (Mensch gewinnt)');
  verlassen(P);
  ok(lauf(P, 40, () => tb.console === 'transfer', () => { if (!d) d = doppelt(P); }) && !d, 'der Mensch geht: der Bot geht zum Transfer, nie zwei Halter');
  lauf(P, 2);   // der Mensch kehrt an die Konsole zurueck (E tippen, Spielpfad): der Bot weicht und geht an seine Station
  neben(g, P.h, 'transfer'); eTaste(g, P.c);
  ok(P.h.console === 'transfer' && lauf(P, 40, () => tb.console === 'technik', () => { if (!d) d = doppelt(P); }) && P.h.console === 'transfer' && !d, 'betritt der Mensch den Transfer wieder, weicht der Bot und geht an die Technik zurueck, nie zwei Halter');
}

// ---------- 3 (c) Ops-Bot scannt, (h) Sperren ----------
section('3 Auto-Scan des Ops-Bots: ein Scan; Mensch an Ops, bereits gescannt, kein Ops-Bot, ops.landescan auf Befehl');
{
  // c: Ops-Bot (nicht Bord-Bot) scannt von seiner Station, gescannt vor dem Beamen, nur ein Scan
  const P = szene({ bots: ['ops', 'technik'] }); const { g } = P; const ob = botVon(P, 'ops');
  waehle(P); lauf(P, 0.3);
  ok(!Lpscan.gescannt(g, LP) && Lage.landescanOffen(g), 'Landepunkt gewaehlt, noch nicht gescannt: der Scan ist offen (Lage.landescanOffen)');
  const gut = lauf(P, 12, () => Lpscan.gescannt(g, LP));
  ok(gut && Station.stationOf(ob) === 'weapons' && scans(P).length === 1, `der Ops-Bot scannt den Landepunkt von seiner Station aus (weapons.landescan, ${scans(P).length} Scan)`);
  lauf(P, 15);
  ok(scans(P).length === 1 && !g.lpscan && !Lage.landescanOffen(g), 'danach kein zweiter Scan');
  ok(agentVon(P, 'ops').verworfen === 0 && g.errors === 0, 'Wachposten hat nichts verworfen, game.errors 0');
}
{
  // h: Mensch B an Ops sperrt (der Bot wartet, scannt nie); B scannt selbst. Mensch A waehlt den Landepunkt
  const P = szene({ bots: ['ops', 'technik'], menschen: 2 }); const { g } = P; const b = P.conns[1].player, cb = P.conns[1];
  neben(g, b, 'weapons'); eTaste(g, cb); lauf(P, 3);
  waehle(P); verlassen(P);
  lauf(P, 15);
  ok(agentVon(P, 'ops').absicht.zustand === 'wartet' && scans(P).length === 0 && !Lpscan.gescannt(g, LP), 'Mensch an Ops: der Ops-Bot wartet und scannt nicht (Mensch gewinnt)');
  const fehler = (() => { const c = cb; const n0 = c.inbox.length; g.handleMessage(c, { t: 'cmd', c: 'weapons.landescan' }); return c.inbox.slice(n0).filter((m) => m.kind === 'notice').map((m) => m.text); })();
  lauf(P, 6);
  ok(fehler.length === 0 && Lpscan.gescannt(g, LP) && scans(P).length === 0, 'der Mensch scannt selbst (weapons.landescan), der Landepunkt ist gescannt, der Bot hat nichts gesendet');
}
{
  // bereits gescannt: kein Scan
  const P = szene({ bots: ['ops', 'technik'] }); const { g } = P;
  Lpscan.markieren(g, LP); waehle(P); lauf(P, 10);
  ok(Lpscan.gescannt(g, LP) && scans(P).length === 0 && Lauf.vorlaufLaeuft(g), 'Landepunkt schon gescannt: der Ops-Bot sendet keinen Scan (der Vorlauf laeuft trotzdem)');
}
{
  // kein Ops-Bot: der Mensch scannt selbst (Grenze), der Vorlauf stoerte nicht
  const P = szene({ bots: ['navigation', 'technik'] }); const { g } = P; const tb = botVon(P, 'technik');
  waehle(P); verlassen(P); lauf(P, 30, () => tb.console === 'transfer');
  ok(!Lpscan.gescannt(g, LP) && tb.console === 'transfer' && cmds(P, tb.id, 'weapons.').length === 0 && cmds(P, botVon(P, 'navigation').id, 'weapons.').length === 0, 'kein Ops-Bot: niemand scannt (der Mensch muss selbst), der Technik-Bot geht trotzdem zum Transfer');
  ok(lauf(P, 1) && Lage.landescanOffen(g), 'der Scan bleibt offen (Menschenaufgabe)');
}
{
  // ops.landescan auf Befehl bleibt: dieselbe Quelle (landescanSenden), ohne Vorlauf und mit gewaehltem Landepunkt
  const P = szene({ bots: ['ops', 'technik'] }); const { g } = P;
  lauf(P, 1);
  const r = befehl(P, { an: 'ops', befehl: 'ops.landescan' });
  ok(r.length === 1 && r[0].status === 'ok' && !!g.lpscan, 'ops.landescan auf Befehl (ohne Vorlauf, ohne Landepunkt): ok, der Scan laeuft');
  lauf(P, 6);
  ok(Lpscan.gescannt(g, LP) && scans(P).length === 1, 'der Befehl scannt den Landepunkt (ein Scan)');
  const r2 = befehl(P, { an: 'ops', befehl: 'ops.landescan' });
  ok(r2[0].status !== 'ok', 'noch einmal: nichts mehr zu scannen, das Spiel antwortet (nicht ok: ' + r2[0].status + ')');
  // bot.automatik loescht die Absicht, der Auto-Scan gehoert zum Standardverhalten und bleibt
  const Q = szene({ bots: ['ops', 'technik'] });
  befehl(Q, { an: 'ops', befehl: 'ops.feuer_halt' }); befehl(Q, { an: 'alle', befehl: 'bot.automatik' });
  waehle(Q); lauf(Q, 12, () => Lpscan.gescannt(Q.g, LP));
  ok(Lpscan.gescannt(Q.g, LP), 'bot.automatik (Standardverhalten) sperrt den Auto-Scan nicht: er gehoert dazu');
  const Q2 = szene({ bots: ['ops', 'technik'] });
  befehl(Q2, { an: 'ops', befehl: 'ops.feuer_halt' });
  waehle(Q2); lauf(Q2, 12, () => Lpscan.gescannt(Q2.g, LP));
  ok(Lpscan.gescannt(Q2.g, LP), 'auch mit Feuer halten (Befehl) scannt der Ops-Bot');
}

// ---------- 4 (d) Stopp ----------
section('4 Navigations-Bot stoppt das fahrende Schiff (nur Tempo); ohne Navigations-Bot, ohne Landepunkt: kein Stopp');
{
  const P = szene({ dx: 320 }); const { g } = P; const nb = botVon(P, 'navigation'); const ang = agentVon(P, 'navigation');
  g.ship.helm.stage = 3; lauf(P, 8);
  const v0 = g.ship.speed;
  ok(v0 > g.C.ship.beamMaxSpeed && away.canBeam(g, 'down').tooFast === true, `Ausgangslage: das Schiff faehrt (${v0.toFixed(0)} > ${g.C.ship.beamMaxSpeed}), canBeam liefert tooFast`);
  lauf(P, 6);
  ok(stopps(P).length === 0 && g.ship.helm.stage === 3, 'ohne Landepunkt stoppt der Navigations-Bot nicht (er haelt Kurs und Stufe wie bisher)');
  g.ship.x = BEAM.x - 100;   // die Fahrt bis hierher hat das Schiff aus der Reichweite getragen: zurueck in die Naehe des Landepunkts (nur der Ort, die Fahrt bleibt)
  const p0 = { x: g.ship.x, y: g.ship.y };
  waehle(P); verlassen(P); const tW = g.time;
  const stopp = lauf(P, 20, () => g.ship.helm.stage === STOP && g.ship.speed <= g.C.ship.beamMaxSpeed);
  const ch = away.canBeam(g, 'down');
  ok(stopp && stopps(P).length >= 1, `Landepunkt gewaehlt, das Schiff faehrt: der Navigations-Bot sendet helm.stop, Tempo ${g.ship.speed.toFixed(1)}, Stufe Stopp`);
  ok(ch.ok === true && !ch.tooFast, 'away.canBeam down danach: ok, kein tooFast ("Steuerung gestoppt")');
  // nur Tempo, nicht Position: das Schiff steht, der Bot fliegt nicht zum Landepunkt
  lauf(P, 5, () => !g.ship.helm.autoStop);   // der Allstopp laeuft aus
  const x1 = g.ship.x, y1 = g.ship.y; lauf(P, 8);
  ok(Math.hypot(g.ship.x - x1, g.ship.y - y1) < 3 && g.ship.helm.stage === STOP && cmds(P, nb.id, 'helm.', tW).every((s) => s.msg.c === 'helm.stop' || (s.msg.c === 'helm.input' && !s.msg.thrust)), 'das Schiff bleibt stehen, der Bot sendet nach der Wahl nur helm.stop und Ruder ohne Schub ');
  info(`Weg des Schiffs beim Anhalten ${Math.hypot(x1 - p0.x, y1 - p0.y).toFixed(0)} px`);
  ok(stopps(P).length <= 3, `kein Dauerfeuer von helm.stop (${stopps(P).length})`);
  // Befehle im Vorlauf (in Reichweite): nav.kurs und nav.schub sind nicht_jetzt, nav.stopp geht (V-2 unten: ausserhalb der Reichweite gilt das nicht)
  const Q = szene({ dx: 200 }); const gq = Q.g;
  gq.ship.markers.captain = { x: BEAM.x, y: BEAM.y + 100 };
  waehle(Q); verlassen(Q); lauf(Q, 2);
  ok(Lauf.vorlaufLaeuft(gq), 'Ausgangslage: Landepunkt in Reichweite, der Vorlauf laeuft');
  const kurs = befehl(Q, { an: 'navigation', befehl: 'nav.kurs', args: { ziel: 'marke' } })[0];
  ok(kurs && kurs.status === 'abgelehnt' && /nicht_jetzt/.test(kurs.textId), `Vorlauf in Reichweite: nav.kurs ist nicht_jetzt (${kurs && kurs.textId})`);
  const stp = befehl(Q, { an: 'navigation', befehl: 'nav.stopp' })[0];
  ok(stp && stp.status === 'ok', 'Vorlauf: nav.stopp geht weiter (ok)');
  const sch = befehl(Q, { an: 'navigation', befehl: 'nav.schub', args: { stufe: 'halb' } })[0];
  ok(sch && sch.status === 'abgelehnt' && /nicht_jetzt/.test(sch.textId), 'Vorlauf: nav.schub ist nicht_jetzt');
}
{
  // V-2: Landepunkt ausserhalb der Beamreichweite: der Vorlauf ist nur vorgemerkt (kein Dienst, kein Stopp, keine Sperre), der Mensch kann "Landepunkt waehlen, dann hinfliegen lassen"
  const Q = szene({ dx: 700 }); const gq = Q.g; const tbq = botVon(Q, 'technik'); const nbq = agentVon(Q, 'navigation');
  const range = () => away.beamSpot(gq).range, abst = () => Math.hypot(gq.ship.x - BEAM.x, gq.ship.y - BEAM.y);
  gq.ship.markers.captain = { x: BEAM.x, y: BEAM.y };
  waehle(Q); verlassen(Q); lauf(Q, 2);
  ok(abst() > range() && !!agentVon(Q, 'technik').lauf.vorlauf && !Lauf.vorlaufLaeuft(gq) && !Lauf.bordAktiv(gq, tbq) && !Lauf.beamVorbereitet(gq) && !nbq.aussenteamUnten(), `Landepunkt ausserhalb der Reichweite (${abst().toFixed(0)} > ${range()} px): der Vorlauf ist nur vorgemerkt, kein Dienst, keine Sperre`);
  const kurs = befehl(Q, { an: 'navigation', befehl: 'nav.kurs', args: { ziel: 'marke' } })[0];
  ok(kurs && kurs.status === 'ok', `nav.kurs (ziel marke) wird angenommen (${kurs && kurs.status})`);
  const d0 = abst(); lauf(Q, 4);
  ok(abst() < d0 - 20 && stopps(Q).length === 0 && tbq.console === 'technik' && Station.stationOf(tbq) === 'technik', `der Navigations-Bot fliegt hin (${d0.toFixed(0)} -> ${abst().toFixed(0)} px), kein helm.stop, der Technik-Bot bleibt an der Technik`);
  const drin = lauf(Q, 40, () => Lauf.vorlaufLaeuft(gq));
  ok(drin && abst() <= range() && nbq.absicht.befehl === null && nbq.befehlGrund === 'aussenteam', `bei Eintritt in die Reichweite (${abst().toFixed(0)} px) beginnt der Vorlauf, der Kurs des Menschen endet (Grund ${nbq.befehlGrund})`);
  const gestoppt = lauf(Q, 20, () => gq.ship.helm.stage === STOP && gq.ship.speed <= gq.C.ship.beamMaxSpeed && !gq.ship.helm.autoStop);
  ok(gestoppt && stopps(Q).length >= 1 && abst() <= range() && away.canBeam(gq, 'down').ok, `der Navigations-Bot stoppt das Schiff (${stopps(Q).length} helm.stop), es bleibt in Reichweite (${abst().toFixed(0)} px), canBeam down ist ok`);
  ok(lauf(Q, 40, () => tbq.console === 'transfer') && Lauf.dienstLaeuft(gq, tbq), 'der Bord-Bot geht jetzt zum Transfer (nicht frueher: ausserhalb der Reichweite wartet er an der Station, der Weg lohnt erst, wenn der Beam moeglich ist)');
  ok(Q.g.errors === 0 && doppelt(Q) === null, 'game.errors 0, nie zwei Halter');
}
{
  // V-2: die Frist zaehlt nur in Reichweite; ohne Navigations-Bot fliegt nichts
  const Q = szene({ bots: ['ops', 'technik'], dx: 900 }); const gq = Q.g; const tbq = botVon(Q, 'technik');
  waehle(Q); verlassen(Q); lauf(Q, 70);
  ok(!!agentVon(Q, 'technik').lauf.vorlauf && !Lauf.vorlaufLaeuft(gq) && tbq.console === 'technik' && scans(Q).length === 0, '70 s ausserhalb der Reichweite: der Vorlauf ist noch vorgemerkt (die Frist laeuft nicht), niemand scannt, der Bord-Bot bleibt an der Technik');
  gq.ship.x = BEAM.x - 150; gq.ship.y = BEAM.y; lauf(Q, 0.5);
  ok(Lauf.vorlaufLaeuft(gq) && lauf(Q, 40, () => tbq.console === 'transfer'), 'das Schiff kommt in Reichweite: der Vorlauf laeuft, der Bord-Bot geht zum Transfer');
}
{
  // ohne Navigations-Bot: kein Stopp, der Mensch erledigt es; tooFast bleibt
  const P = szene({ bots: ['ops', 'technik'], dx: 320 }); const { g } = P;
  g.ship.helm.stage = 3; lauf(P, 8); g.ship.x = BEAM.x - 100;
  waehle(P); verlassen(P); lauf(P, 15);
  const ch = away.canBeam(g, 'down');
  ok(g.ship.helm.stage === 3 && g.ship.speed > g.C.ship.beamMaxSpeed && ch.tooFast === true && cmds(P, botVon(P, 'ops').id, 'helm.').length === 0 && cmds(P, botVon(P, 'technik').id, 'helm.').length === 0, 'ohne Navigations-Bot stoppt niemand: Stufe bleibt, canBeam liefert tooFast (der Mensch erledigt es)');
}
{
  // V-3: ohne gewaehlten Landepunkt (Standardort): ein Mensch auf dem Schiffspad bei zu schnellem Schiff in Reichweite loest den Stopp des Navigations-Bots aus
  const P = partie({ bots: ['navigation', 'ops', 'technik'] }); const { g } = P; const tb = botVon(P, 'technik');
  lauf(P, 40, () => sitzen(P)); g.mission.beamDownBlocked = () => null;
  const sc = require('../shared/locations.js').get(g.ship.scene).scene; g.ship.x = sc.station.x; g.ship.y = sc.station.y; g.ship.vx = 0; g.ship.vy = 0;
  g.ship.helm.stage = 3; lauf(P, 4);
  ok(g.ship.speed > g.C.ship.beamMaxSpeed && !g.transferZiel && !away.onPad(g, P.h) && away.canBeam(g, 'down').tooFast === true, `Ausgangslage: Standardort, kein Landepunkt gewaehlt, Stufe 3 (Tempo ${g.ship.speed.toFixed(0)}), der Mensch steht nicht auf einem Pad: canBeam liefert tooFast`);
  lauf(P, 1.5);
  ok(stopps(P).length === 0 && g.ship.helm.stage === 3 && !Lauf.beamVorbereitet(g) && Lage.beamInReichweite(g), 'ohne Mensch auf dem Pad stoppt der Navigations-Bot nicht (das Schiff ist dabei in Reichweite)');
  g.ship.x = sc.station.x; g.ship.y = sc.station.y;
  interior.placeOnShipPad(g, P.h, 0); lauf(P, 0.3);
  ok(away.onPad(g, P.h) && !Lage.padMenschZuSchnell(g) && !Lauf.stoppNoetig(g), 'S1: Mensch auf dem Pad OHNE Beamabsicht (kein E, kein Versuch): kein Pad-Signal, kein Stopp-Bedarf');
  lauf(P, 1.5);
  ok(stopps(P).length === 0 && g.ship.helm.stage === 3, 'S1: auch nach 1,5 s steht das Schiff nicht auf Stopp (der Mensch steht nur dort)');
  eDown(P); eUp(P); lauf(P, 0.3);   // Beamversuch: scheitert am Tempo (tooFast), das ist die Absicht
  ok(away.onPad(g, P.h) && Lage.padMenschZuSchnell(g) && !Lauf.vorlaufLaeuft(g) && !Lauf.bordAktiv(g, tb) && !Lauf.beamVorbereitet(g), 'Mensch auf dem Pad, Schiff zu schnell: das Signal gilt NUR fuer den Stopp (kein Vorlauf, kein Bord-Dienst, kein beamVorbereitet)');
  const g1 = lauf(P, 20, () => g.ship.helm.stage === STOP && g.ship.speed <= g.C.ship.beamMaxSpeed && !g.ship.helm.autoStop);
  ok(g1 && stopps(P).length >= 1 && stopps(P).length <= 3, `der Navigations-Bot haelt das Schiff an (${stopps(P).length} helm.stop), Tempo ${g.ship.speed.toFixed(1)}`);
  eDown(P); const gelungen = lauf(P, 3, () => !!P.h.hold && P.h.hold.kind === 'beam');
  ok(gelungen && !away.canBeam(g, 'down').tooFast, 'danach gelingt E halten (selfbeam setzt den Halter, kein tooFast)');
  lauf(P, 6, () => P.h.zone === 'away');
  ok(P.h.zone === 'away', 'der Beam laeuft durch: der Mensch ist unten');
  // S1: ein laufender Befehl des Menschen bleibt wirksam, solange der Mensch nur auf dem Pad steht (Repro: nav.schub antwortet ok, wurde aber still mit Grund aussenteam verworfen, das Schiff stand)
  {
    const S1 = partie({ bots: ['navigation', 'ops', 'technik'] }); const gs = S1.g; 
    lauf(S1, 40, () => sitzen(S1)); gs.mission.beamDownBlocked = () => null; const ags = agentVon(S1, 'navigation');
    const scs = require('../shared/locations.js').get(gs.ship.scene).scene; gs.ship.x = scs.station.x - 150; gs.ship.y = scs.station.y; gs.ship.vx = 0; gs.ship.vy = 0;
    lauf(S1, 1); interior.placeOnShipPad(gs, S1.h, 0); lauf(S1, 0.5);
    ok(away.onPad(gs, S1.h) && Lage.beamInReichweite(gs) && gs.ship.speed === 0, 'S1 Ausgangslage: Schiff steht in Beamreichweite, der Mensch steht auf dem Pad (wie nach dem Aufstieg)');
    const a1 = befehl(S1, { an: 'navigation', befehl: 'nav.schub', args: { stufe: 'halb' } });
    ok(a1.length === 1 && /nav.schub.ok$/.test(a1[0].textId || ''), 'S1: nav.schub wird angenommen (' + JSON.stringify(a1.map((o) => o.textId)) + ')');
    let vmax = 0; lauf(S1, 8, null, () => { vmax = Math.max(vmax, gs.ship.speed); });
    ok(!!ags.absicht.befehl && ags.absicht.befehl.name === 'nav.schub' && ags.befehlGrund !== 'aussenteam', 'S1: der Befehl bleibt wirksam (nicht mit Grund aussenteam verworfen: ' + ags.befehlGrund + ')');
    ok(vmax > gs.C.ship.beamMaxSpeed && stopps(S1).length === 0 && gs.ship.helm.stage > STOP, `S1: das Schiff faehrt (Tempo bis ${vmax.toFixed(1)}), kein helm.stop, Stufe ${gs.ship.helm.stage}`);
    // mit Beamabsicht (Versuch am Tempo): Stopp, aber der Befehl wird nicht verworfen und neue Schubbefehle antworten ehrlich nicht_jetzt
    eDown(S1); eUp(S1); lauf(S1, 0.3);
    ok(Lage.padMenschZuSchnell(gs), 'S1: nach dem Beamversuch am Tempo gilt das Signal');
    const a2 = befehl(S1, { an: 'navigation', befehl: 'nav.schub', args: { stufe: 'voll' } });
    ok(a2.length === 1 && /nicht_jetzt/.test(a2[0].textId || ''), 'S1: mit Beamabsicht antwortet nav.schub ehrlich nicht_jetzt (' + JSON.stringify(a2.map((o) => o.textId)) + ')');
    lauf(S1, 20, () => gs.ship.helm.stage === STOP && gs.ship.speed <= gs.C.ship.beamMaxSpeed && !gs.ship.helm.autoStop);
    ok(stopps(S1).length >= 1 && ags.befehlGrund !== 'aussenteam' && !!ags.absicht.befehl, `S1: der Bot haelt das Schiff fuer den Beam an (${stopps(S1).length} helm.stop), verwirft aber den Befehl nicht (Grund ${ags.befehlGrund})`);
    wanduhr();
  }
  // ausserhalb der Reichweite: kein Stopp (V-2)
  const Q = partie({ bots: ['navigation', 'ops', 'technik'] }); const gq = Q.g;
  lauf(Q, 40, () => sitzen(Q)); gq.mission.beamDownBlocked = () => null;
  const scq = require('../shared/locations.js').get(gq.ship.scene).scene; gq.ship.x = scq.station.x - 1200; gq.ship.y = scq.station.y; gq.ship.vx = 0; gq.ship.vy = 0;
  gq.ship.helm.stage = 3; lauf(Q, 3);
  interior.placeOnShipPad(gq, Q.h, 0); lauf(Q, 4);
  ok(!away.canBeam(gq, 'down').ok && gq.ship.speed > gq.C.ship.beamMaxSpeed && stopps(Q).length === 0 && !Lage.padMenschZuSchnell(gq), 'ausserhalb der Beamreichweite: auch mit Mensch auf dem Pad kein Stopp (der Mensch kann nicht beamen, die Fahrt ist seine Sache)');
  const nur = partie({ bots: ['ops', 'technik'] }); const gn = nur.g; lauf(nur, 30);
  const scn = require('../shared/locations.js').get(gn.ship.scene).scene; gn.ship.x = scn.station.x; gn.ship.y = scn.station.y; gn.ship.vx = 0; gn.ship.vy = 0;
  gn.ship.helm.stage = 3; lauf(nur, 3); interior.placeOnShipPad(gn, nur.h, 0); lauf(nur, 4);
  ok(gn.ship.helm.stage === 3 && cmds(nur, botVon(nur, 'ops').id, 'helm.').length === 0, 'ohne Navigations-Bot stoppt auch das Pad-Signal niemanden');
}

// ---------- 5 (e) Bord-Bot ist der Ops-Bot ----------
section('5 Bord-Bot = Ops-Bot (kein Technik-Bot): erst Scan, dann Transfer; Navigations-Bot nie Bord-Bot');
{
  const P = szene({ bots: ['ops'] }); const { g } = P; const ob = botVon(P, 'ops'); let ersterTransfer = null, scanFertig = null, sawWeapons = false;
  ok(Lauf.bordBot(g) === ob, 'Ausgangslage: der Ops-Bot ist der Bord-Bot');
  waehle(P);
  const sehe = () => { if (ob.console === 'weapons' || Station.stationOf(ob) === 'weapons') sawWeapons = true; if (scanFertig === null && Lpscan.gescannt(g, LP)) scanFertig = g.time; if (ersterTransfer === null && ob.console === 'transfer') ersterTransfer = g.time; };
  lauf(P, 4, null, sehe);   // der Mensch bleibt an der Konsole: der Ops-Bot scannt von seiner Station
  verlassen(P);
  const wo = geheUndBeame(P, ob, sehe);
  lauf(P, 40, () => ersterTransfer !== null, sehe);
  // Messung, kein Soll auf die Landung: die Ops-Station liegt weit vom Transfer, der Bot beginnt den Weg erst, wenn der Mensch die Konsole verlaesst (Mensch gewinnt); er kommt NACH der Landung an (bekannte Grenze, Rueckbericht)
  ok(wo.tLand !== null && wo.tBot !== null && wo.tBot < 15, `Ops-Bot als Bord-Bot: erst Scan, dann am Transfer (Bot +${wo.tBot === null ? '-' : wo.tBot.toFixed(1)} s nach dem Verlassen der Konsole, bei der Landung am Transfer: ${wo.botBeiLandung}; Landung ab dem Verlassen der Konsole: ${wo.tLand === null ? '-' : wo.tLand.toFixed(1)} s)`);
  ok(ersterTransfer !== null && scanFertig !== null && scanFertig <= ersterTransfer && sawWeapons && scans(P).length === 1, `der Ops-Bot scannt zuerst (fertig bei ${scanFertig && scanFertig.toFixed(1)}), geht dann zum Transfer (da bei ${ersterTransfer && ersterTransfer.toFixed(1)}); ein Scan`);
  ok(Lpscan.gescannt(g, LP) && ob.console === 'transfer', 'am Transfer ist der Landepunkt gescannt');
  const st = befehl(P, { an: 'ops', befehl: 'bot.status' })[0];
  ok(st && /Transfer/.test(st.text), `bot.status am Transfer im Vorlauf: "${st && st.text}"`);
}
{
  // V-2: Landepunkt ausserhalb der Beamreichweite: der Ops-Bot als Bord-Bot bleibt an der Station (kein Scan, kein Weg), kommt das Schiff in Reichweite, scannt er und geht zum Transfer
  const P = szene({ bots: ['ops'], dx: 1000 }); const { g } = P; const ob = botVon(P, 'ops');
  waehle(P); verlassen(P); lauf(P, 20);
  ok(Station.stationOf(ob) === 'weapons' && scans(P).length === 0 && !Lauf.vorlaufLaeuft(g) && !Lage.landescanOffen(g) === !Lage.landescanOffen(g), 'Landepunkt zu weit: der Ops-Bord-Bot bleibt an der Ops-Station, kein Scan, kein Weg zum Transfer');
  g.ship.x = BEAM.x - 150; lauf(P, 0.5);
  ok(lauf(P, 40, () => ob.console === 'transfer') && scans(P).length === 1 && Lpscan.gescannt(g, LP), 'das Schiff kommt in Reichweite: der Ops-Bot scannt (ein Scan) und geht zum Transfer');
}
{
  // Nacharbeit 2: der Navigations-Bot ist nie Bord-Bot (einziger Bot): er haelt das Schiff an der Steuer an und bleibt dort, auch nach dem Beam; der Transfer bleibt frei
  const P = szene({ bots: ['navigation'], dx: 320 }); const { g } = P; const nb = botVon(P, 'navigation');
  g.ship.helm.stage = 3; lauf(P, 6); g.ship.x = BEAM.x - 100;
  waehle(P); verlassen(P);
  const wn = geheUndBeame(P, nb);
  lauf(P, 5);
  ok(wn.tLand !== null && wn.tBot === null && nb.console === 'helm' && haelt(P, 'transfer').length === 0 && Lauf.bordBot(g) === null, 'Navigations-Bot als einziger Bot: er bleibt an der Steuer (nie am Transfer), der Mensch landet, kein Bord-Bot');
  ok(g.ship.helm.stage === STOP && g.ship.speed <= g.C.ship.beamMaxSpeed + 1 && stopps(P).length >= 1, `er hat das Schiff im Vorlauf angehalten (Stufe Stopp, Tempo ${g.ship.speed.toFixed(1)}, ${stopps(P).length} helm.stop)`);
}

// ---------- 6 (f) Abbruch ----------
section('6 Abbruch: Landepunkt weg, Frist, Mensch beamt nie; ein Ziel beginnt den Vorlauf nur einmal');
{
  const P = szene({ bots: ['ops', 'technik'] }); const { g } = P; const tb = botVon(P, 'technik'); let d = null; const pr = () => { if (!d) d = doppelt(P); };
  ok(Lauf.VORLAUF_FRIST === 60, 'benannte Konstante VORLAUF_FRIST = 60 s');
  waehle(P); verlassen(P);
  ok(lauf(P, 40, () => tb.console === 'transfer', pr), 'Vorlauf: der Bot steht am Transfer');
  // Landepunkt abgewaehlt (das Spiel loescht transferZiel selbst bei Ortswechsel oder wenn die Karte weg ist)
  g.transferZiel = null; lauf(P, 0.3);
  ok(!Lauf.vorlaufLaeuft(g) && !Lauf.bordAktiv(g, tb), 'Landepunkt weg: der Vorlauf endet sofort');
  ok(lauf(P, 40, () => Station.stationOf(tb) === 'technik', pr) && tb.console === 'technik' && haelt(P, 'transfer').length === 0 && !d, 'der Bot geht zurueck an die Technik, der Transfer ist frei, nie zwei Halter');
  // neu gewaehlt: der Vorlauf beginnt neu
  waehle(P); verlassen(P); lauf(P, 0.1);
  ok(Lauf.vorlaufLaeuft(g) && lauf(P, 40, () => tb.console === 'transfer', pr), 'neuer Landepunkt: der Vorlauf beginnt neu, der Bot geht wieder zum Transfer');
  // Frist: der Mensch beamt nie
  const t1 = g.time; const zu = lauf(P, 80, () => !Lauf.vorlaufLaeuft(g), pr);
  const dauer = g.time - t1;
  ok(zu && dauer > 45 && dauer <= 61, `Frist: der Vorlauf endet nach der Frist ohne Beam (${dauer.toFixed(0)} s nach der Ankunft am Transfer, ab Wahl ${(g.time - t1 + 0).toFixed(0)} s)`);
  ok(lauf(P, 40, () => Station.stationOf(tb) === 'technik', pr) && haelt(P, 'transfer').length === 0 && !d, 'der Bot geht an die Technik zurueck, Stationen frei, nie zwei Halter');
  lauf(P, 30, null, pr);
  ok(!Lauf.vorlaufLaeuft(g) && tb.console === 'technik' && g.transferZiel && g.transferZiel.lp === LP, 'dasselbe Ziel beginnt keinen zweiten Vorlauf (der Bot bleibt an der Technik, auch mit gewaehltem Landepunkt)');
  // eine neue Wahl (auch derselbe Landepunkt) beginnt neu
  waehle(P); verlassen(P); lauf(P, 0.3);
  ok(Lauf.vorlaufLaeuft(g) && lauf(P, 40, () => tb.console === 'transfer', pr) && !d && g.errors === 0, 'neue Wahl desselben Landepunkts: neuer Vorlauf, der Bot geht wieder hin; keine Fehler');
}
{
  // Mensch unten (Beam erfolgt) beendet den Vorlauf; ein Mensch an Bord fehlt: kein Vorlauf
  const P = szene({ bots: ['ops', 'technik'], menschen: 2 }); const { g } = P; const tb = botVon(P, 'technik'); const a = P.h, b = P.conns[1].player;
  waehle(P); verlassen(P); lauf(P, 0.3);
  ok(Lauf.vorlaufLaeuft(g), 'zwei Menschen, Landepunkt gewaehlt: Vorlauf');
  a.zone = 'away'; lauf(P, 0.3);
  ok(!Lauf.vorlaufLaeuft(g) && Lauf.bordAktiv(g, tb), 'ein Mensch ist unten: der Vorlauf ist zu Ende, der Dienst gilt wie bisher');
  interior.placeOnShipPad(g, a); lauf(P, 40, () => Station.stationOf(tb) === 'technik'); lauf(P, 1);
  ok(!Lauf.vorlaufLaeuft(g) && Station.stationOf(tb) === 'technik', 'er kommt zurueck: kein neuer Vorlauf fuer dasselbe Ziel');
  // alle Menschen getrennt: kein Fehler
  g.removeConnection(P.conns[1]); g.removeConnection(P.c); lauf(P, 3);
  ok(g.errors === 0, 'alle Menschen getrennt: keine Fehler');
  void b;
}
{
  // ein Ziel, das das Spiel selbst setzt (Szenenstart, Arena), ist keine Wahl des Menschen: kein Vorlauf, auch nicht, wenn der Mensch spaeter den Transfer betritt
  const P = szene({ bots: ['ops', 'technik'] }); const { g } = P; const tb = botVon(P, 'technik');
  g.transferZiel = { lp: LP, scene: g.ship.scene }; g.setAwayMap(LP); lauf(P, 10);
  ok(!Lauf.vorlaufLaeuft(g) && tb.console === 'technik' && scans(P).length === 0, 'Ziel vom Spiel gesetzt, Mensch an Bord: kein Vorlauf, der Technik-Bot bleibt an der Technik, kein Scan');
  interior.enterConsole(g, P.h, 'transfer'); verlassen(P); lauf(P, 5);
  ok(!Lauf.vorlaufLaeuft(g) && tb.console === 'technik', 'der Mensch betritt den Transfer nur: auch dann kein Vorlauf fuer dieses Ziel');
}
{
  // Ohne Server-Bots gibt es keinen Lauf und damit keinen Vorlauf (reine Menschenpartie)
  const P = szene({ bots: [] }); const { g } = P;
  waehle(P); verlassen(P); lauf(P, 5);
  ok(!Lauf.vorlaufLaeuft(g) && !Lauf.beamVorbereitet(g) && g.errors === 0, 'reine Menschenpartie: kein Lauf, kein Vorlauf');
}

// ---------- 6b V-4 bis V-6 ----------
section('6b Vorlauf endet bei Gegnern und Reaktor-Countdown (V-4), ein abgebrochener Beam beendet ihn nicht (V-5), ein bewusstloser Mensch haelt ihn nicht (V-6)');
{
  // V-4 Gegner
  const P = szene({ bots: ['navigation', 'ops', 'technik'] }); const { g } = P; const tb = botVon(P, 'technik'); const nb = agentVon(P, 'navigation'); let d = null; const pr = () => { if (!d) d = doppelt(P); };
  waehle(P); verlassen(P);
  ok(lauf(P, 40, () => tb.console === 'transfer', pr) && Lauf.vorlaufLaeuft(g), 'Ausgangslage: Vorlauf, der Technik-Bot steht am Transfer');
  const e = space.spawnEnemy(g, 'korvette', { x: g.ship.x + 2500, y: g.ship.y, facing: 0 }); e.pin = { x: e.x, y: e.y, angle: e.angle };
  lauf(P, 0.5);
  ok(!Lauf.vorlaufLaeuft(g) && !Lauf.beamVorbereitet(g) && !nb.aussenteamUnten(), 'Gegner im Raum: der Vorlauf endet (Navigation kein Stillstand, keine Sperre)');
  ok(lauf(P, 40, () => Station.stationOf(tb) === 'technik', pr) && haelt(P, 'transfer').length === 0 && !d, 'der Bord-Bot geht zurueck an die Technik, nie zwei Halter');
  g.space.enemies = []; g.ship.x = BEAM.x - 150; g.ship.y = BEAM.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.helm.stage = STOP; lauf(P, 5);
  ok(!Lauf.vorlaufLaeuft(g) && tb.console === 'technik', 'Gegner weg: kein neuer Vorlauf fuer dasselbe Ziel');
  waehle(P); verlassen(P); lauf(P, 0.3);
  ok(Lauf.vorlaufLaeuft(g) && lauf(P, 40, () => tb.console === 'transfer', pr) && !d, 'neue Landepunktwahl nach Wegfall der Gegner: neuer Vorlauf, der Bot geht zum Transfer');
  // mit Gegnern gewaehlt: kein Vorlauf (das Ziel gilt als gesehen)
  g.transferZiel = null; lauf(P, 0.3); lauf(P, 40, () => Station.stationOf(tb) === 'technik');
  const e2 = space.spawnEnemy(g, 'korvette', { x: g.ship.x + 2500, y: g.ship.y, facing: 0 }); e2.pin = { x: e2.x, y: e2.y, angle: e2.angle };
  waehle(P); verlassen(P); lauf(P, 3);
  ok(!Lauf.vorlaufLaeuft(g) && tb.console === 'technik', 'Landepunkt bei Gegnern im Raum gewaehlt: kein Vorlauf');
  ok(Lage.gegnerImRaum([{ kind: 'relay' }]) === false && Lage.gegnerImRaum([{ kind: 'relay' }, { kind: 'korvette' }]) === true && Lage.gegnerImRaum([]) === false, 'Relais zaehlen nicht als Gegner (eine Definition, auch fuer den Steuer-Dienst)');
}
{
  // V-4 Reaktor-Countdown
  const P = szene({ bots: ['navigation', 'technik'] }); const { g } = P; const tb = botVon(P, 'technik'); let d = null; const pr = () => { if (!d) d = doppelt(P); };
  waehle(P); verlassen(P);
  ok(lauf(P, 40, () => tb.console === 'transfer', pr) && Lauf.vorlaufLaeuft(g), 'Vorlauf laeuft, der Technik-Bot steht am Transfer');
  g.ship.reaktorAusfaelle = 0; interior.damageSystem(g, 'reactor', 'broken'); lauf(P, 0.3);
  if (g.ship.reaktorCountdown) {
    ok(!Lauf.vorlaufLaeuft(g) && !Lauf.beamVorbereitet(g), `Reaktor-Countdown (${g.ship.reaktorCountdown.t.toFixed(0)} s): der Vorlauf endet`);
    ok(lauf(P, 40, () => Station.stationOf(tb) === 'technik' || !g.ship.reaktorCountdown, pr) && !d, 'der Bord-Bot verlaesst den Transfer, nie zwei Halter');
  } else ok(false, 'der Reaktor-Countdown laeuft in dieser Szene nicht (Aufbau)');
}
{
  // V-5 ein abgebrochener Beam beendet den Vorlauf nicht
  const P = szene({ bots: ['ops', 'technik'] }); const { g } = P; const tb = botVon(P, 'technik'); let d = null; const pr = () => { if (!d) d = doppelt(P); };
  waehle(P); verlassen(P);
  ok(lauf(P, 40, () => tb.console === 'transfer', pr), 'Vorlauf: der Bord-Bot steht am Transfer');
  interior.placeOnShipPad(g, P.h, 0); eDown(P); lauf(P, 1);
  ok(!!P.h.hold && P.h.hold.kind === 'beam' && Lauf.vorlaufLaeuft(g), 'der Mensch haelt E auf dem Pad: der Beam laeuft an, der Vorlauf auch');
  eUp(P); lauf(P, 3, null, pr);
  ok(!P.h.hold && P.h.zone === 'ship' && Lauf.vorlaufLaeuft(g) && tb.console === 'transfer' && !d, 'E zu frueh losgelassen: der Vorlauf bleibt, der Bord-Bot bleibt am Transfer (kein Pendeln)');
  eDown(P); const unten = lauf(P, 8, () => P.h.zone === 'away');
  ok(unten, 'zweiter Versuch: der Beam laeuft durch, der Mensch ist unten');
}
{
  // V-6 ein bewusstloser Mensch haelt den Vorlauf nicht am Leben
  const P = szene({ bots: ['ops', 'technik'], menschen: 2 }); const { g } = P; const tb = botVon(P, 'technik'); const a = P.h, b = P.conns[1].player;
  waehle(P); verlassen(P); lauf(P, 0.3);
  ok(Lauf.vorlaufLaeuft(g), 'zwei Menschen, Vorlauf');
  a.downed = true; lauf(P, 0.3);
  ok(Lauf.vorlaufLaeuft(g), 'einer bewusstlos, der andere aufrecht an Bord: der Vorlauf laeuft weiter');
  b.downed = true; lauf(P, 0.3);
  ok(!Lauf.vorlaufLaeuft(g) && !Lauf.bordAktiv(g, tb), 'beide bewusstlos: der Vorlauf endet');
  a.downed = false; b.downed = false; lauf(P, 3);
  ok(!Lauf.vorlaufLaeuft(g), 'wieder bei Bewusstsein: kein neuer Vorlauf fuer dasselbe Ziel');
}

// ---------- 7 Status, Quellscan, Menschenpartie ----------
section('7 bot.status im Vorlauf, Quellscan, reine Menschenpartie');
{
  const P = szene({ dx: 320 }); const { g } = P; const tb = botVon(P, 'technik');
  g.ship.helm.stage = 3; lauf(P, 6);
  const st = (an) => (befehl(P, { an, befehl: 'bot.status' })[0] || {}).text;
  waehle(P); lauf(P, 0.4);
  const sNav = st('navigation'), sOps = st('ops');
  ok(sNav === 'Halte das Schiff an.', `Navigation im Vorlauf: "${sNav}"`);
  ok(sOps === 'Scanne den Landepunkt.', `Ops im Vorlauf: "${sOps}"`);
  lauf(P, 12, () => Lpscan.gescannt(g, LP));
  verlassen(P); lauf(P, 0.6);
  const sTech1 = st('technik');
  ok(sTech1 === 'Gehe zum Transfer.' || sTech1 === 'Unterwegs zum Transfer.', `Technik (Bord-Bot) auf dem Weg: "${sTech1}"`);
  lauf(P, 40, () => tb.console === 'transfer'); lauf(P, 1);
  const sTech2 = st('technik');
  ok(sTech2 === 'Warte am Transfer auf das Beamen.', `Technik am Transfer im Vorlauf: "${sTech2}"`);
  const texte = ['Scanne den Landepunkt.', 'Halte das Schiff an.', 'Gehe zum Transfer.', 'Warte am Transfer auf das Beamen.'];
  ok(texte.every((t) => t.length <= Status.MAX && !/%|\{|\$/.test(t)), 'alle neuen Statustexte: hoechstens 90 Zeichen, ohne Argumente');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'bots', 'status.js'), 'utf8');
  ok(texte.every((t) => src.includes(t)), 'die Texte stehen in status.js');
}
{
  const lage = fs.readFileSync(path.join(__dirname, '..', 'server', 'bots', 'bordlage.js'), 'utf8').replace(/\/\/.*$/gm, '');
  ok(!/\.(cmd|send|emit|handleMessage|push|splice|add)\(/.test(lage) && !/\b(game|g|p|aw)\.[A-Za-z_.]+\s*(?:=(?!=)|\+=|-=)/.test(lage), 'Quellscan: bordlage.js liest nur (auch landescanOffen)');
  const reg = fs.readFileSync(path.join(__dirname, '..', 'server', 'bots', 'befehle', 'ops.js'), 'utf8').replace(/\/\/.*$/gm, '');
  ok(/landescanSenden\(\)/.test(reg) && !/'weapons\.landescan'/.test(reg), 'Quellscan: ops.landescan laeuft ueber landescanSenden (eine Quelle mit dem Auto-Scan)');
  const lf = fs.readFileSync(path.join(__dirname, '..', 'server', 'bots', 'lauf.js'), 'utf8').replace(/\/\/.*$/gm, '');
  ok(!/\b(game|g)\.[A-Za-z_.]+\s*=(?!=)/.test(lf.replace(/this\.game/g, '')) && !/transferZiel\s*=(?!=)/.test(lf), 'Quellscan: lauf.js schreibt weder game.transferZiel noch anderen Spielzustand');
}
{
  // Basis = Stand, auf dem der Zweig aufsetzt (git merge-base HEAD main, per git archive; kein fester Commit, kein stash/checkout), dasselbe Messskript fuer beide Baeume
  if (process.env.VORLAUF_OHNE_BASIS) { info('VORLAUF_OHNE_BASIS: Vergleich mit dem Basisstand uebersprungen (Mutationsprobe)'); wanduhr(); console.log(fails ? `\ntest-bot02-vorlauf: ${fails} FEHLER von ${n}` : `\ntest-bot02-vorlauf: ${n}/${n} ok`); process.exit(fails ? 1 : 0); }
  const B = require('./lib/bot02-basis.js').basisBaum(TMP);
  if (B.ref) {
    const BASIS = B.ref, baum = B.baum;
    const messen = (wurzel) => JSON.parse(cp.execFileSync(process.execPath, [path.join(__dirname, 'mess-bot02-menschenpartie.js'), wurzel], { encoding: 'utf8', env: Object.assign({}, process.env, { NODE_PATH: path.join(__dirname, '..', 'node_modules') }) }).trim().split('\n').pop());
    const alt = messen(baum), neu = messen(path.join(__dirname, '..'));
    ok(alt.snapshots > 300 && alt.errors === 0 && neu.errors === 0 && alt.hilfe === 1 && neu.hilfe === 1 && alt.hash === neu.hash && alt.snapshots === neu.snapshots, `Basis ${BASIS} gegen Stand (Menschenpartien inkl. Plattform mit Mensch unten): Hash gleich (${neu.hash.slice(0, 8)}, ${neu.snapshots} Snapshots, Fehler 0)`);
  } else console.log('  info  Basisvergleich uebersprungen: ' + B.grund);
}
wanduhr();

console.log(fails ? `\ntest-bot02-vorlauf: ${fails} FEHLER von ${n}` : `\ntest-bot02-vorlauf: ${n}/${n} ok`);
process.exit(fails ? 1 : 0);
