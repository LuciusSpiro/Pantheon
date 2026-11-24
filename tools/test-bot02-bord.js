'use strict';
// BOT-02 B1: der Bord-Dienst (Zusatzdienst eines vorhandenen Bots, keine Lobby-Rolle; server/bots/lauf.js bordBot/bordAktiv, mannschaft.js bordDienst, weichen.js, annahme.js, befehle/bord.js). Echtes Game, Server-Bots, Testgelaende Raumkampf.
//   1. Zuweisung je Bot-Kombination (Technik, sonst Ops, sonst Navigation; keine Bots: keiner), keine Lobby-Rolle, kein neues Feld am Spielerobjekt
//   2. Der Dienst startet erst, wenn ein MENSCH unten ist (zone away): Bot an der Transfer-Konsole (p.console transfer), die anderen Bots bleiben an ihren Stationen, technik.botAuto wird nie gesendet
//   3. Station-Automatik springt ein (Mensch + Technik-Bot, Mensch + Ops-Bot: 2 Koepfe); mit 4 Koepfen nicht (bestehende Kopfregel, hier festgehalten)
//   4. Ende: Aufstieg, Notrueckholung, Mensch unten trennt: der Bot gibt die Transfer-Konsole frei und geht an seine Station
//   5. Mensch gewinnt: ein Mensch betritt die Transfer-Konsole, der Bot weicht, geht an seine Station, kommt zurueck, wenn der Mensch geht; nie zwei Halter, keine Station doppelt (12 s, Tick fuer Tick)
//   6. Wachposten: transfer.* und captain.* nur im Bord-Dienst und nur fuer den Bord-Bot (Test und Quellscan)
//   7. bord.*-Befehle: ohne Bord-Bot kein_bot, mit nicht_jetzt (Geruest), Adressierung (an alle, Rolle, botId), bot.status im Dienst
//   8. Reine Menschenpartie unveraendert: Snapshots, Nachrichten, Zufallsstand identisch mit echtem und leerem Lauf (auch mit Mensch unten und an der Transfer-Konsole)
//   node tools/test-bot02-bord.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
process.chdir(path.join(__dirname, '..'));
const { Game } = require('../server/game.js');
const Station = require('../server/sim/station.js');
const interior = require('../server/sim/interior.js');
const away = require('../server/sim/away.js');
const W = require('../server/world.js');
const BotSpieler = require('../server/bots/spieler.js');
const Lauf = require('../server/bots/lauf.js');
const Weichen = require('../server/bots/weichen.js');
const Protocol = require('../shared/protocol.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-bot02bord-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
let seq = 0;

// ---------- Aufbau ----------
const mkConn = () => ({ inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } });
function mensch(g, i) {
  const c = mkConn(); g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'K' + i, color: i });
  return c;
}
// o.bots: Rollen; o.menschen: Zahl (1); o.start: false = Lobby
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
  if (o.start !== false) {
    g.lobbyOpts.startMission = 'arena_space';
    for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
    if (g.arena) { g.arena.nextAt = 1e9; g.space.enemies = []; }
  }
  return P;
}
const tick = (P) => { P.g.step(); if (P.g.wantsSnapshot()) P.g.snapshot(); };
const lauf = (P, sec, bis, jeTick) => { const t1 = P.g.time + sec; while (P.g.time < t1) { tick(P); if (jeTick) jeTick(); if (bis && bis()) return true; } return bis ? !!bis() : true; };
const botVon = (P, rolle) => P.g.players.find((p) => p.bot && p.rolle === rolle);
const agentVon = (P, rolle) => Lauf.agent(P.g, botVon(P, rolle));
const KONSOLE = { navigation: 'helm', ops: 'weapons', technik: 'technik' };
const sitzen = (P) => P.g.players.filter((p) => p.bot).every((p) => Station.stationOf(p) === KONSOLE[p.rolle]);
const cmds = (P, pid, prefix, ab) => P.spy.filter((s) => s.pid === pid && s.msg.t === 'cmd' && (!prefix || s.msg.c.startsWith(prefix)) && s.t >= (ab || 0));
function neben(g, p, konsole) {
  const ct = W.CONSOLE_TILES[konsole][0];
  const t = W.accessTiles(W.ship, W.shipWalkable, ct.x, ct.y)[0];
  const c = W.tileCenter(t.x, t.y); p.x = c.x; p.y = c.y; p.moving = false; p.input.mx = 0; p.input.my = 0;
  const dx = ct.x - t.x, dy = ct.y - t.y; p.dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
}
const eTaste = (g, conn) => { g.handleMessage(conn, { t: 'act', down: true }); g.handleMessage(conn, { t: 'act', down: false }); };
const haelt = (P, ort) => P.g.players.filter((p) => p.connected && (p.console === ort || Station.stationOf(p) === ort));
// Mensch nach unten (wie die anderen Bot-Tests: zone away) und wieder hoch (Schiffspad, wie der Aufstieg)
const runter = (p) => { p.zone = 'away'; };
const hoch = (g, p) => { interior.placeOnShipPad(g, p); };
// keine Konsole und keine Station doppelt gehalten
function doppelt(P) {
  for (const ort of ['helm', 'weapons', 'technik', 'captain', 'transfer']) if (haelt(P, ort).length > 1) return ort;
  return null;
}
// bot.befehl vom Menschen und die Antworten dazu
const echtJetzt = Date.now; let versatz = 0;   // die Annahme begrenzt auf 10 Befehle je Sekunde (Wanduhr): jeder Befehl des Tests bekommt 200 ms Abstand
function befehl(P, msg, conn) {
  Date.now = () => echtJetzt() + (versatz += 200);
  const c = conn || P.c; const n0 = c.inbox.length;
  P.g.handleMessage(c, Object.assign({ t: 'bot.befehl', quelle: 'menu' }, msg));
  return c.inbox.slice(n0).filter((o) => o.t === Protocol.C.BOT_ANTWORT);
}

// ---------- 1 Zuweisung ----------
section('1 Zuweisung: Technik-Bot, sonst Ops-Bot, sonst Navigations-Bot');
{
  const fall = [[['navigation', 'ops', 'technik'], 'technik'], [['ops', 'technik'], 'technik'], [['navigation', 'technik'], 'technik'], [['navigation', 'ops'], 'ops'], [['ops'], 'ops'], [['navigation'], 'navigation'], [['technik'], 'technik'], [[], null]];
  for (const [bots, soll] of fall) {
    const P = partie({ bots });
    const b = Lauf.bordBot(P.g);
    ok((b ? b.rolle : null) === soll, `Bots ${bots.join('+') || 'keine'}: Bord-Bot ${soll || 'keiner'}${b ? ' (' + b.rolle + ')' : ''}`);
  }
  const L = partie({ start: false });
  ok(BotSpieler.ROLLEN.join() === 'navigation,ops,technik' && BotSpieler.botHinzufuegen(L.g, null, 'bord') === false && !L.g.players.some((p) => p.bot), 'bord ist keine Lobby-Rolle: botHinzufuegen bord wird abgelehnt, ROLLEN unveraendert');
  // Spielerobjekt und Snapshot bleiben gleich (kein neues Feld)
  const P = partie({ bots: ['ops', 'technik'] });
  lauf(P, 40, () => sitzen(P));
  const tb = botVon(P, 'technik');
  const schluessel = (o) => Object.keys(o).sort().join();
  const vorher = schluessel(tb), snapVor = schluessel(P.g.snapshot().players.find((p) => p.id === tb.id));
  runter(P.h); lauf(P, 40, () => tb.console === 'transfer'); lauf(P, 1);
  ok(tb.console === 'transfer', 'Ausgangslage fuer den Feldvergleich: der Dienst laeuft');
  ok(schluessel(tb) === vorher, 'Spielerobjekt des Bots im Dienst: dieselben Felder wie davor');
  ok(!snapVor.split(',').some((k) => /bord/i.test(k)) && !schluessel(P.g.snapshot().players.find((p) => p.id === tb.id)).split(',').some((k) => /bord/i.test(k)), 'Snapshot-Eintrag des Bots traegt kein Bord-Feld');
  ok(agentVon(P, 'technik').spieler.rolle === 'technik' && agentVon(P, 'technik').absicht.rolle === 'technik', 'die Rolle des Bots bleibt technik, der Dienstzustand lebt im Agenten');
}

// ---------- 2 Beginn des Dienstes ----------
section('2 Der Dienst beginnt erst, wenn ein Mensch unten ist; der Bot steht an der Transfer-Konsole');
{
  const P = partie({ bots: ['navigation', 'ops', 'technik'] });
  const { g, h } = P;
  ok(lauf(P, 40, () => sitzen(P)), 'alle drei Bots sitzen an ihren Stationen (Mensch an Bord)');
  lauf(P, 5);
  const tb = botVon(P, 'technik');
  ok(!Lauf.bordAktiv(g, tb) && tb.console === 'technik', 'Mensch an Bord: kein Dienst, der Technik-Bot bleibt an der Technik');
  const ops = botVon(P, 'ops');
  ops.zone = 'away'; lauf(P, 3);
  ok(!Lauf.bordAktiv(g, tb), 'ein Bot unten (zone away) startet den Dienst nicht');
  hoch(g, ops); lauf(P, 40, () => sitzen(P));
  const t0 = g.time;
  runter(h);
  const da = lauf(P, 40, () => tb.console === 'transfer'); lauf(P, 1);
  ok(da && Station.stationOf(tb) === 'transfer', `Mensch unten: der Technik-Bot steht an der Transfer-Konsole (console transfer, stationOf transfer) nach ${(g.time - t0).toFixed(1)} s`);
  ok(Lauf.bordAktiv(g, tb) && !Lauf.bordAktiv(g, botVon(P, 'ops')) && !Lauf.bordAktiv(g, botVon(P, 'navigation')), 'genau der Technik-Bot haelt den Dienst');
  lauf(P, 6);
  ok(tb.console === 'transfer' && Station.stationOf(botVon(P, 'navigation')) === 'helm' && Station.stationOf(botVon(P, 'ops')) === 'weapons', 'er bleibt dort; Navigation und Ops bleiben an Steuer und Waffen');
  ok(!Station.stationBesetzt(g, 'technik') && haelt(P, 'transfer').length === 1, 'die Technik-Station ist frei, die Transfer-Konsole hat einen Halter');
  ok(cmds(P, tb.id, 'technik.botAuto').length === 0 && g.ship.botAutoChosen === false, 'technik.botAuto wurde nie gesendet (botAutoChosen bleibt aus)');
  ok(agentVon(P, 'technik').absicht.zustand === 'an_station', 'Agentenzustand an_station');
  ok(g.errors === 0, 'game.errors 0');
}
{
  for (const [bots, soll] of [[['ops', 'technik'], 'technik'], [['navigation', 'ops'], 'ops'], [['navigation'], 'navigation']]) {
    const P = partie({ bots });
    lauf(P, 40, () => sitzen(P));
    runter(P.h);
    const da = lauf(P, 40, () => botVon(P, soll).console === 'transfer'); lauf(P, 1);
    ok(da && haelt(P, 'transfer').length === 1 && haelt(P, 'transfer')[0] === botVon(P, soll), `Bots ${bots.join('+')}: ${soll} haelt die Transfer-Konsole, sonst niemand`);
    if (soll === 'navigation') ok(P.g.ship.helm.stage === 1, 'Navigations-Bot als einziger Bot: er verlaesst die Steuer mit Stufe Stopp (kern.js stellt sie vorher)');
    ok(P.g.errors === 0, '  game.errors 0');
  }
  const P0 = partie({ bots: [] });
  runter(P0.h); lauf(P0, 5);
  ok(Lauf.bordBot(P0.g) === null && P0.g.errors === 0 && Lauf.agenten(P0.g).length === 0, 'ohne Bots: kein Bord-Bot, kein Lauf, keine Fehler');
}

// ---------- 3 Station-Automatik ----------
section('3 Die Station-Automatik springt ein, wenn der Bot die Station verlaesst');
{
  const T = partie({ bots: ['technik'] });
  lauf(T, 40, () => sitzen(T)); lauf(T, 2);
  ok(T.g.ship.botAuto === false && Station.botAutomatikStandard(T.g) === false, 'Mensch + Technik-Bot an der Technik: Schrauber-Automatik aus (wie bisher)');
  runter(T.h); lauf(T, 40, () => botVon(T, 'technik').console === 'transfer'); lauf(T, 2);
  ok(Station.botAutomatikStandard(T.g) === true && T.g.ship.botAuto === true && T.g.ship.botAutoChosen === false, 'Technik-Bot im Dienst (2 Koepfe): botAutomatikStandard und ship.botAuto an, nicht festgeschrieben');
  ok(cmds(T, botVon(T, 'technik').id, 'technik.botAuto').length === 0, 'der Bot sendet kein technik.botAuto');
  hoch(T.g, T.h); lauf(T, 40, () => Station.stationOf(botVon(T, 'technik')) === 'technik'); lauf(T, 2);
  ok(T.g.ship.botAuto === false, 'Dienst vorbei, der Bot sitzt wieder an der Technik: Automatik wieder aus');
  const O = partie({ bots: ['ops'] });
  lauf(O, 40, () => sitzen(O)); lauf(O, 2);
  ok(Station.waffenAutomatikAktiv(O.g) === false, 'Mensch + Ops-Bot an den Waffen: keine Waffenautomatik');
  runter(O.h); lauf(O, 40, () => botVon(O, 'ops').console === 'transfer'); lauf(O, 2);
  ok(Station.waffenAutomatikAktiv(O.g) === true, 'Ops-Bot im Dienst (2 Koepfe): Waffenautomatik an');
  const V = partie({ bots: ['navigation', 'ops', 'technik'] });
  lauf(V, 40, () => sitzen(V)); runter(V.h); lauf(V, 40, () => botVon(V, 'technik').console === 'transfer'); lauf(V, 2);
  ok(V.g.ship.botAuto === false && Station.waffenAutomatikAktiv(V.g) === false && !Station.stationBesetzt(V.g, 'technik'), 'vier Koepfe: weiter keine Automatik (bestehende Kopfregel, nicht Teil von B1), die Technik-Station ist ohne Halter');
}

// ---------- 4 Ende des Dienstes ----------
section('4 Ende: Aufstieg, Notrueckholung, Trennung');
{
  const P = partie({ bots: ['navigation', 'ops', 'technik'] });
  const { g, h } = P; const tb = botVon(P, 'technik');
  let dopp = null; const pruefe = () => { const d = doppelt(P); if (d && !dopp) dopp = d + ' bei ' + g.time.toFixed(2); };
  lauf(P, 40, () => sitzen(P));
  runter(h); lauf(P, 40, () => tb.console === 'transfer'); lauf(P, 1);
  const t0 = g.time;
  hoch(g, h);
  ok(h.zone === 'ship' && !Lauf.bordAktiv(g, tb), 'Aufstieg: kein Mensch mehr unten, der Dienst endet');
  const zurueck = lauf(P, 40, () => Station.stationOf(tb) === 'technik', pruefe); lauf(P, 1);
  ok(zurueck && haelt(P, 'transfer').length === 0 && tb.console === 'technik', `der Bot gibt die Transfer-Konsole frei und sitzt nach ${(g.time - t0).toFixed(1)} s wieder an der Technik`);
  ok(sitzen(P) && !dopp, 'alle drei Bots an ihren Stationen, keine Station doppelt besetzt' + (dopp ? ' – ' + dopp : ''));
  runter(h); lauf(P, 40, () => tb.console === 'transfer'); lauf(P, 1);
  const fehler = away.recall(g, h.id);
  ok(fehler === null && h.zone === 'ship', 'Notrueckholung (away.recall) holt den Menschen aufs Schiff' + (fehler ? ' – ' + fehler : ''));
  ok(lauf(P, 40, () => Station.stationOf(tb) === 'technik', pruefe) && haelt(P, 'transfer').length === 0 && !dopp, 'der Dienst endet auch bei der Notrueckholung: Transfer frei, Bot an der Technik');
  g.support.recall = 0;
  runter(h); lauf(P, 40, () => tb.console === 'transfer');
  g.removeConnection(P.c); lauf(P, 2);
  ok(!Lauf.bordAktiv(g, tb), 'der Mensch unten trennt: kein Mensch mehr unten, der Dienst endet');
  ok(g.errors === 0, 'game.errors 0');
}

// ---------- 5 Mensch gewinnt ----------
section('5 Mensch an der Transfer-Konsole: der Bot weicht (12 s Tick fuer Tick, nie zwei Halter)');
{
  const P = partie({ bots: ['ops', 'technik'], menschen: 2 });
  const { g } = P; const a = P.h, b = P.conns[1].player, cb = P.conns[1]; const tb = botVon(P, 'technik');
  lauf(P, 40, () => sitzen(P));
  runter(a); lauf(P, 40, () => tb.console === 'transfer'); lauf(P, 1);
  ok(tb.console === 'transfer', 'Ausgangslage: der Technik-Bot haelt die Transfer-Konsole (Mensch A unten)');
  ok(Weichen.kannWeichen(g, 'transfer', b) === true && Weichen.kannWeichen(g, 'transfer', tb) === false, 'weichen.js: dem Menschen weicht der Bot an der Transfer-Konsole, einem Bot nie');
  neben(g, b, 'transfer');
  let doppeltGesehen = null; let tickSehen = 0;
  const pruefe = () => { tickSehen++; const d = doppelt(P); if (d && !doppeltGesehen) doppeltGesehen = d + ' bei ' + g.time.toFixed(2); };
  eTaste(g, cb); pruefe();
  ok(b.console === 'transfer' && tb.console !== 'transfer', 'E an der Konsole: Mensch B sitzt am Transfer, der Bot ist weg');
  const t0 = g.time;
  lauf(P, 12, null, pruefe);
  ok(!doppeltGesehen && tickSehen > 200, `12 s lang nie zwei Halter an einer Konsole, keine Station doppelt (${tickSehen} Ticks)${doppeltGesehen ? ' – ' + doppeltGesehen : ''}`);
  ok(b.console === 'transfer' && Station.stationOf(tb) === 'technik', 'der Mensch behaelt den Transfer, der Technik-Bot ist an seine Station zurueck und tut seine Rolle');
  ok(cmds(P, tb.id, 'transfer.', t0).length === 0 && cmds(P, tb.id, 'captain.', t0).length === 0, 'der Bot sendet waehrenddessen weder transfer.* noch captain.*');
  ok(Station.botAutomatikStandard(g) === false, 'Technik-Bot wieder an der Station: Schrauber-Automatik aus');
  g.handleMessage(cb, { t: 'leave' });
  ok(b.console === null, 'Mensch B verlaesst den Transfer');
  const wieder = lauf(P, 40, () => tb.console === 'transfer', pruefe);
  ok(wieder && !doppeltGesehen, 'der Bot uebernimmt den Transfer wieder (Mensch A ist weiter unten), nie zwei Halter');
  hoch(g, a); lauf(P, 40, () => Station.stationOf(tb) === 'technik');
  runter(a); lauf(P, 1);
  interior.enterConsole(g, b, 'technik');
  lauf(P, 40, () => tb.console === 'transfer', pruefe);
  ok(tb.console === 'transfer' && b.console === 'technik' && !doppeltGesehen, 'Mensch B sitzt an der Technik, der Bot haelt trotzdem den Transfer (sein Dienst ist nicht seine Station)');
  ok(g.errors === 0, 'game.errors 0');
}
{
  const P = partie({ bots: ['technik'], menschen: 2 });
  const { g } = P; const a = P.h, b = P.conns[1].player; const tb = botVon(P, 'technik');
  lauf(P, 40, () => sitzen(P));
  interior.enterConsole(g, b, 'transfer');
  let d = null;
  runter(a); lauf(P, 15, null, () => { if (!d) d = doppelt(P); });
  ok(b.console === 'transfer' && Station.stationOf(tb) === 'technik' && !d, 'Mensch B haelt den Transfer schon: der Bot bleibt an seiner Station, kein zweiter Halter');
  ok(agentVon(P, 'technik').absicht.zustand === 'an_station' && g.errors === 0, 'Zustand an_station (Station), keine Fehler');
}

// ---------- 6 Wachposten ----------
section('6 Wachposten: transfer.* und captain.* nur im Bord-Dienst');
{
  const P = partie({ bots: ['navigation', 'ops', 'technik'] });
  const { g } = P;
  lauf(P, 40, () => sitzen(P));
  const ag = { navigation: agentVon(P, 'navigation'), ops: agentVon(P, 'ops'), technik: agentVon(P, 'technik') };
  const nachr = (c) => ({ t: 'cmd', c });
  const zu = (a) => ['transfer.down', 'transfer.recall', 'transfer.ziel', 'captain.support', 'captain.scan', 'captain.order'].map((c) => a.erlaubt(nachr(c)));
  ok(Object.values(ag).every((a) => zu(a).every((x) => x === false)), 'Mensch an Bord (kein Dienst): kein Bot darf transfer.* oder captain.*');
  runter(P.h); lauf(P, 3);
  ok(zu(ag.technik).every((x) => x === true), 'Dienst laeuft: der Technik-Bot darf transfer.* und captain.*');
  ok([ag.navigation, ag.ops].every((a) => zu(a).every((x) => x === false)), 'die anderen Bots (kein Dienst) duerfen es weiter nicht');
  ok(ag.technik.erlaubt(nachr('technik.repair')) && !ag.technik.erlaubt(nachr('weapons.fire')) && !ag.technik.erlaubt(nachr('helm.stop')) && !ag.technik.erlaubt({ t: 'hello' }) && !ag.technik.erlaubt({ t: 'lobbyBot', op: 'add' }) && !ag.technik.erlaubt(nachr('transferdown')) && !ag.technik.erlaubt(nachr('captainsupport')), 'sonst unveraendert: eigene Station ja; fremde Stationen, hello, lobbyBot und Namen ohne Punkt nein');
  const v0 = ag.technik.verworfen; ag.technik.send({ t: 'cmd', c: 'weapons.fire' });
  ok(ag.technik.verworfen === v0 + 1, 'ein fremdes cmd wird vom Wachposten verworfen und gezaehlt');
  hoch(g, P.h); lauf(P, 2);
  ok(zu(ag.technik).every((x) => x === false), 'Dienst vorbei: transfer.* und captain.* wieder gesperrt');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'bots', 'mannschaft.js'), 'utf8');
  const erl = (/erlaubt\(msg\) \{[\s\S]*?\r?\n  \}/.exec(src) || [''])[0];
  ok(/BORD_PRAEFIXE = \['transfer\.', 'captain\.'\]/.test(src) && /this\.bordDienstLaeuft\(\) && BORD_PRAEFIXE\.some/.test(erl), 'Quellscan: BORD_PRAEFIXE = transfer. und captain., im Wachposten nur zusammen mit bordDienstLaeuft()');
  const freie = (src.match(/'(?:transfer|captain)\./g) || []).length;
  ok(freie === 2, `Quellscan: mannschaft.js nennt die Praefixe nur in BORD_PRAEFIXE (${freie} Fundstellen)`);
}

// ---------- 7 bord.*-Befehle ----------
section('7 bord.*: kein_bot ohne Bord-Bot, nicht_jetzt mit Geruest');
{
  const N = partie({ bots: [] });
  const r0 = ['bord.rueckholen', 'bord.sensor', 'bord.kuppel'].map((b) => befehl(N, { an: 'bord', befehl: b })[0]);
  ok(r0.every((r) => r && r.status === 'unmoeglich' && r.textId === `${r.befehl}.unmoeglich.kein_bot`), 'keine Bots: bord.rueckholen/sensor/kuppel -> unmoeglich kein_bot');
  const P = partie({ bots: ['navigation', 'ops', 'technik'] });
  lauf(P, 40, () => sitzen(P));
  const tb = botVon(P, 'technik');
  const antw = () => ['bord.rueckholen', 'bord.sensor', 'bord.kuppel'].map((b) => befehl(P, { an: 'bord', befehl: b }));
  let r = antw();
  ok(r.every((x) => x.length === 1 && x[0].status === 'abgelehnt' && x[0].textId === `${x[0].befehl}.abgelehnt.nicht_jetzt` && x[0].botId === tb.botId && typeof x[0].text === 'string'), 'mit Bots, Mensch an Bord: nicht_jetzt (Text vorhanden), Antwort vom Bord-Bot');
  runter(P.h); lauf(P, 40, () => tb.console === 'transfer');
  r = antw();
  ok(r.every((x) => x.length === 1 && x[0].textId === `${x[0].befehl}.abgelehnt.nicht_jetzt` && x[0].botId === tb.botId), 'Dienst laeuft: weiter nicht_jetzt (Geruest, B2 bis B4 fuellen)');
  const alle = befehl(P, { an: 'alle', befehl: 'bord.sensor' });
  ok(alle.length === 1 && alle[0].textId === 'bord.sensor.abgelehnt.adressat', 'an: alle schliesst bord aus (bord.sensor an alle: adressat)');
  const rolle = befehl(P, { an: 'technik', befehl: 'bord.sensor' });
  ok(rolle.length === 1 && rolle[0].textId === 'bord.sensor.abgelehnt.adressat', 'an: technik fuer einen bord-Befehl: adressat');
  ok(befehl(P, { an: botVon(P, 'technik').botId, befehl: 'bord.kuppel' })[0].textId === 'bord.kuppel.abgelehnt.nicht_jetzt', 'an: botId des Bord-Bots -> nicht_jetzt');
  ok(befehl(P, { an: botVon(P, 'ops').botId, befehl: 'bord.kuppel' })[0].textId === 'bord.kuppel.abgelehnt.adressat', 'an: botId eines anderen Bots -> adressat');
  const st = befehl(P, { an: 'alle', befehl: 'bot.status' });
  ok(st.length === 3 && st.every((x) => x.status === 'ok'), 'bot.status an alle: drei Antworten (bord kommt nicht als vierter Bot hinzu)');
  const stb = st.find((x) => x.botId === tb.botId);
  ok(stb && /Transfer/.test(stb.text), `bot.status des Bord-Bots im Dienst nennt den Transfer ("${stb && stb.text}")`);
  ok(!st.filter((x) => x.botId !== tb.botId).some((x) => /Transfer/.test(x.text || '')), 'die anderen Bots nennen ihn nicht');
  const tp = befehl(P, { an: 'technik', befehl: 'tech.prio', args: { ziel: 'feuer' } });
  ok(tp.length === 1 && tp[0].botId === tb.botId, 'Befehle der Rolle (tech.prio) gehen weiter an den Bord-Bot');
  ok(P.g.errors === 0, 'game.errors 0');
}

// ---------- 8 Reine Menschenpartie ----------
section('8 Reine Menschenpartie: der Lauf aendert nichts (auch mit Mensch unten und am Transfer)');
{
  const sha = (noop) => {
    const orig = Lauf.tick;
    if (noop) Lauf.tick = () => {};
    const oR = Math.random, oN = Date.now; let r = 12345; let tt = 1.7e12;
    Math.random = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff; };
    Date.now = () => (tt += 16);
    const h = crypto.createHash('sha1'); let nSnap = 0;
    try {
      for (const [start, seed, menschen] of [['arena_space', 5, 2], ['m3', 6, 2]]) {
        const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
        const g = new Game({ noStore: true, seed, worldDir: dir, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
        const cs = []; for (let i = 0; i < menschen; i++) { const c = { send: (o) => h.update(JSON.stringify(o)), sendRaw: (s) => h.update(s) }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'M' + i, name: 'M' + i, color: i }); cs.push(c); }
        g.lobbyOpts.startMission = start;
        for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
        for (let i = 0; i < 900; i++) {
          if (i === 100) interior.enterConsole(g, cs[0].player, 'transfer');
          if (i === 300) cs[1].player.zone = 'away';
          if (i === 500) g.handleMessage(cs[0], { t: 'leave' });
          if (i === 700) interior.placeOnShipPad(g, cs[1].player);
          g.step();
          if (g.wantsSnapshot()) { h.update(JSON.stringify(g.snapshot())); nSnap++; }
        }
        h.update(JSON.stringify([g.errors, g.time, g.rng(), g.players.map((p) => [p.x, p.y, p.console, p.station, p.zone])]));
        ok(Lauf.agenten(g).length === 0 && Lauf.bordBot(g) === null, `${start}: ohne Bots kein Lauf, kein Bord-Bot`);
      }
    } finally { Lauf.tick = orig; Math.random = oR; Date.now = oN; }
    return { hash: h.digest('hex'), nSnap };
  };
  const mit = sha(false), ohne = sha(true);
  ok(mit.nSnap > 100 && mit.hash === ohne.hash, `Menschenpartien (Mensch unten, am Transfer): Snapshots, Nachrichten, Zufallsstand und Spieler byte-gleich mit echtem und leerem Lauf (${mit.nSnap} Snapshots)`);
  console.log('  info  Hash ' + mit.hash + ' (fuer den Vergleich vorher/nachher, Basis 73f93ed0)');
}

console.log(fails ? `\ntest-bot02-bord: ${fails} FEHLER von ${n}` : `\ntest-bot02-bord: ${n}/${n} ok`);
process.exit(fails ? 1 : 0);
