'use strict';
// BOT-02 B1: der Bord-Dienst (Zusatzdienst eines vorhandenen Bots, keine Lobby-Rolle; server/bots/lauf.js bordBot/bordAktiv, mannschaft.js bordDienst, weichen.js, annahme.js, befehle/bord.js). Echtes Game, Server-Bots, Testgelaende Raumkampf.
//   1. Zuweisung je Bot-Kombination (Technik, sonst Ops, sonst Navigation; keine Bots: keiner), keine Lobby-Rolle, kein neues Feld am Spielerobjekt
//   2. Der Dienst startet, wenn ein Mensch unten ist (zone away) oder runterbeamt: Bot an der Transfer-Konsole (p.console transfer), die anderen Bots bleiben an ihren Stationen, technik.botAuto wird nie gesendet
//   3. Station-Automatik springt ein, auch mit 4 Koepfen (B-1: vertreten), nie ohne laufenden Dienst; Reine Menschenpartie unveraendert
//   4. Ende: Aufstieg, Notrueckholung, Mensch unten trennt: der Bot gibt die Transfer-Konsole frei und geht an seine Station
//   5. Mensch gewinnt: ein Mensch betritt die Transfer-Konsole, der Bot weicht, geht an seine Station, kommt zurueck, wenn der Mensch geht; nie zwei Halter, keine Station doppelt (12 s, Tick fuer Tick)
//   6. Wachposten: nur die Whitelist BORD_BEFEHLE (transfer.recall, captain.support) im Dienst und nur fuer den Bord-Bot; alles andere dort gesperrt (Test und Quellscan)
//   7. bord.*-Befehle: ohne Bord-Bot kein_bot, mit nicht_jetzt (Geruest), Adressierung (an alle, Rolle, botId), bot.status im Dienst; Rollenbefehle im Dienst nicht_jetzt (B-6)
//   8. Reine Menschenpartie unveraendert: Snapshots, Nachrichten, Zufallsstand identisch mit echtem und leerem Lauf (auch mit Mensch unten und an der Transfer-Konsole), und gegen den Stand, auf dem der Zweig aufsetzt (merge-base mit main)
//   9. Nacharbeit B-2/B-3/B-5/B-7: Dienstende mit Mensch an der Station, bewusstloser Bord-Bot (Wechsel, Hysterese), Dienstbeginn beim Beamen (Spielpfad E-Halten, Abbruch, Konsole), Absichten beim Wiederbeginn
//   node tools/test-bot02-bord.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
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
section('1 Zuweisung: Technik-Bot, sonst Ops-Bot; der Navigations-Bot nie (Nacharbeit 2)');
{
  const fall = [[['navigation', 'ops', 'technik'], 'technik'], [['ops', 'technik'], 'technik'], [['navigation', 'technik'], 'technik'], [['navigation', 'ops'], 'ops'], [['ops'], 'ops'], [['navigation'], null], [['technik'], 'technik'], [[], null]];
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
  for (const [bots, soll] of [[['ops', 'technik'], 'technik'], [['navigation', 'ops'], 'ops']]) {
    const P = partie({ bots });
    lauf(P, 40, () => sitzen(P));
    runter(P.h);
    const da = lauf(P, 40, () => botVon(P, soll).console === 'transfer'); lauf(P, 1);
    ok(da && haelt(P, 'transfer').length === 1 && haelt(P, 'transfer')[0] === botVon(P, soll), `Bots ${bots.join('+')}: ${soll} haelt die Transfer-Konsole, sonst niemand`);
    ok(P.g.errors === 0, '  game.errors 0');
  }
  const P0 = partie({ bots: [] });
  runter(P0.h); lauf(P0, 5);
  ok(Lauf.bordBot(P0.g) === null && P0.g.errors === 0 && Lauf.agenten(P0.g).length === 0, 'ohne Bots: kein Bord-Bot, kein Lauf, keine Fehler');
  {
    // Nacharbeit 2: nur der Navigations-Bot: kein Bord-Dienst, er bleibt am Steuer, bord.* antwortet kein_bot
    const N = partie({ bots: ['navigation'] }); const nb = botVon(N, 'navigation');
    lauf(N, 40, () => sitzen(N)); runter(N.h); lauf(N, 15);
    ok(Lauf.bordBot(N.g) === null && !Lauf.bordAktiv(N.g, nb) && !Lauf.bordDienstHaelt(N.g) && nb.console === 'helm' && haelt(N, 'transfer').length === 0, 'nur Navigation, Mensch unten: kein Bord-Bot, kein Bord-Dienst, der Bot bleibt am Steuer, der Transfer ist frei');
    const rr = befehl(N, { an: 'bord', befehl: 'bord.rueckholen' })[0];
    ok(rr && rr.status !== 'ok' && /kein_bot/.test(rr.textId || ''), `bord.rueckholen: kein_bot (${rr && rr.textId})`);
    ok(N.g.errors === 0 && agentVon(N, 'navigation').verworfen === 0, 'game.errors 0, nichts verworfen');
  }
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
  ok(V.g.ship.botAuto === true && V.g.ship.botAutoChosen === false && Station.botAutomatikStandard(V.g) === true && !Station.stationBesetzt(V.g, 'technik'), 'vier Koepfe, Technik-Bot im Dienst (B-1): die Schrauber-Automatik laeuft trotz Kopfregel, nicht festgeschrieben');
  ok(Station.waffenAutomatikAktiv(V.g) === false, 'vier Koepfe, Technik-Bot im Dienst: Ops ist besetzt (Ops-Bot an den Waffen), keine Waffenautomatik');
  hoch(V.g, V.h); lauf(V, 40, () => Station.stationOf(botVon(V, 'technik')) === 'technik'); lauf(V, 2);
  ok(V.g.ship.botAuto === false && Station.waffenAutomatikAktiv(V.g) === false, 'vier Koepfe, kein Dienst (Mensch wieder an Bord): wie vorher, keine Automatik');
  const V2 = partie({ bots: ['navigation', 'ops', 'technik'] });
  lauf(V2, 40, () => sitzen(V2)); lauf(V2, 2);
  ok(V2.g.ship.botAuto === false && Station.waffenAutomatikAktiv(V2.g) === false && Station.botAutomatikStandard(V2.g) === false, 'vier Koepfe, kein Dienst: weiter keine Automatik (Kopfregel)');
  // Ops im Dienst bei vier Koepfen: nur wenn der Ops-Bot den Dienst haelt (Technik-Bot bewusstlos, B-3), dann Waffenautomatik an
  const W3 = partie({ bots: ['navigation', 'ops', 'technik'] });
  lauf(W3, 40, () => sitzen(W3));
  const tw = botVon(W3, 'technik'); tw.downed = true; tw.downedFor = 0;
  runter(W3.h); lauf(W3, 40, () => botVon(W3, 'ops').console === 'transfer'); lauf(W3, 2);
  ok(Lauf.bordBot(W3.g) === botVon(W3, 'ops') && Station.waffenAutomatikAktiv(W3.g) === true && Station.stationBesetzt(W3.g, 'weapons') === false, 'vier Koepfe, Ops-Bot im Dienst: Waffenautomatik an (B-1), Ops-Station frei');
  const O4 = partie({ bots: ['navigation', 'ops', 'technik'] });
  lauf(O4, 40, () => sitzen(O4)); lauf(O4, 2);
  ok(Station.waffenAutomatikAktiv(O4.g) === false && Station.botAutomatikStandard(O4.g) === false, 'vier Koepfe, nur Mensch an Bord: wie bisher aus');
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
section('6 Wachposten: im Dienst nur die Whitelist (transfer.recall, captain.support), sonst nichts von transfer.*/captain.*');
{
  const P = partie({ bots: ['navigation', 'ops', 'technik'] });
  const { g } = P;
  lauf(P, 40, () => sitzen(P));
  const ag = { navigation: agentVon(P, 'navigation'), ops: agentVon(P, 'ops'), technik: agentVon(P, 'technik') };
  const nachr = (c) => ({ t: 'cmd', c });
  const ERLAUBT = ['transfer.recall', 'captain.support'];
  const GESPERRT = ['transfer.down', 'transfer.up', 'transfer.ziel', 'transfer.supply', 'captain.scan', 'captain.order', 'captain.selectDest', 'captain.anzeigeziel', 'transfer.', 'captain.', 'transfer.recall2'];
  const alle = ERLAUBT.concat(GESPERRT);
  ok(Object.values(ag).every((a) => alle.every((c) => a.erlaubt(nachr(c)) === false)), 'Mensch an Bord (kein Dienst): kein Bot darf eines der transfer.*/captain.*-Kommandos');
  runter(P.h); lauf(P, 3);
  ok(ERLAUBT.every((c) => ag.technik.erlaubt(nachr(c)) === true), 'Dienst laeuft: der Technik-Bot darf transfer.recall und captain.support');
  ok(GESPERRT.every((c) => ag.technik.erlaubt(nachr(c)) === false), 'Dienst laeuft: alles andere aus transfer.*/captain.* bleibt gesperrt (down, up, ziel, supply, sonstige captain.*, Praefixe, Namensvarianten)');
  const v0 = ag.technik.verworfen, b0 = ag.technik.befehle;
  for (const c of GESPERRT) ag.technik.send(nachr(c));
  ok(ag.technik.verworfen === v0 + GESPERRT.length && ag.technik.befehle === b0, `gesperrte Befehle im Dienst: send() verwirft jeden (verworfen +${ag.technik.verworfen - v0}), keiner geht raus`);
  const v1 = ag.technik.verworfen;
  for (const c of ERLAUBT) ag.technik.send(nachr(c));
  ok(ag.technik.verworfen === v1 && ag.technik.befehle === b0 + ERLAUBT.length, 'die zwei erlaubten kommen durch den Wachposten (nicht verworfen, gezaehlt)');
  ok([ag.navigation, ag.ops].every((a) => alle.every((c) => a.erlaubt(nachr(c)) === false)), 'die anderen Bots (kein Dienst) duerfen nichts davon');
  ok(ag.technik.erlaubt(nachr('technik.repair')) && !ag.technik.erlaubt(nachr('weapons.fire')) && !ag.technik.erlaubt(nachr('helm.stop')) && !ag.technik.erlaubt({ t: 'hello' }) && !ag.technik.erlaubt({ t: 'lobbyBot', op: 'add' }) && !ag.technik.erlaubt(nachr('transferdown')) && !ag.technik.erlaubt(nachr('captainsupport')), 'sonst unveraendert: eigene Station ja; fremde Stationen, hello, lobbyBot und Namen ohne Punkt nein');
  const v2 = ag.technik.verworfen; ag.technik.send({ t: 'cmd', c: 'weapons.fire' });
  ok(ag.technik.verworfen === v2 + 1, 'ein fremdes cmd wird vom Wachposten verworfen und gezaehlt');
  hoch(g, P.h); lauf(P, 2);
  ok(alle.every((c) => ag.technik.erlaubt(nachr(c)) === false), 'Dienst vorbei: auch die zwei erlaubten wieder gesperrt');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'bots', 'mannschaft.js'), 'utf8');
  const erl = (/erlaubt\(msg\) \{[\s\S]*?\r?\n  \}/.exec(src) || [''])[0];
  const wl = /const BORD_BEFEHLE = \[([^\]]*)\]/.exec(src);
  ok(!!wl && wl[1].split(',').map((x) => x.trim().replace(/'/g, '')).join() === 'transfer.recall,captain.support', 'Quellscan: BORD_BEFEHLE (benannte Whitelist) ist genau transfer.recall und captain.support');
  ok(/this\.bordDienstLaeuft\(\) && BORD_BEFEHLE\.includes\(msg\.c\)/.test(erl), 'Quellscan: der Wachposten oeffnet die Whitelist nur zusammen mit bordDienstLaeuft(), exakter Vergleich (includes)');
  const code = src.split(/\r?\n/).filter((z) => !/^\s*\/\//.test(z)).map((z) => z.replace(/\s\/\/.*$/, '')).join('\n');
  const nennt = (code.match(/['"](?:transfer|captain)\.[a-zA-Z]*['"]/g) || []).filter((x, i, l) => l.indexOf(x) === i);
  ok(nennt.every((x) => /^'(?:transfer\.recall|captain\.support)'$/.test(x)) && !/startsWith\(['"](?:transfer|captain)/.test(code), `Quellscan: im Code (ohne Kommentare) kommen transfer.*/captain.* nur als die zwei Whitelist-Namen vor, kein Praefix-Vergleich (${nennt.join(' ')})`);
}

// ---------- 7 bord.*-Befehle ----------
section('7 bord.*: kein_bot ohne Bord-Bot, kein_ziel ohne Menschen unten, nicht_jetzt (B2: Wirkung und Rueckholung in test-bot02-rueckholung.js)');
{
  const N = partie({ bots: [] });
  const r0 = ['bord.rueckholen', 'bord.sensor', 'bord.kuppel'].map((b) => befehl(N, { an: 'bord', befehl: b })[0]);
  ok(r0.every((r) => r && r.status === 'unmoeglich' && r.textId === `${r.befehl}.unmoeglich.kein_bot`), 'keine Bots: bord.rueckholen/sensor/kuppel -> unmoeglich kein_bot');
  const P = partie({ bots: ['navigation', 'ops', 'technik'] });
  lauf(P, 40, () => sitzen(P));
  const tb = botVon(P, 'technik');
  const antw = () => ['bord.rueckholen', 'bord.sensor', 'bord.kuppel'].map((b) => befehl(P, { an: 'bord', befehl: b }));
  let r = antw();
  ok(r.every((x) => x.length === 1 && x[0].status === 'abgelehnt' && x[0].textId === `${x[0].befehl}.abgelehnt.kein_ziel` && x[0].botId === tb.botId && typeof x[0].text === 'string'), 'mit Bots, Mensch an Bord (niemand unten): kein_ziel (Text vorhanden), Antwort vom Bord-Bot');
  runter(P.h); lauf(P, 40, () => tb.console === 'transfer'); lauf(P, 1);
  P.g.support.recall = 30; P.g.support.sensor = 30; P.g.support.kuppel = 30;   // Abklingzeiten: die bord.*-Befehle antworten nicht_jetzt (ohne Weg, ohne Rueckholung); die Wirkung prueft test-bot02-rueckholung.js
  r = antw();
  ok(r.every((x) => x.length === 1 && x[0].textId === `${x[0].befehl}.abgelehnt.nicht_jetzt` && x[0].botId === tb.botId), 'Dienst laeuft, Abklingzeiten laufen: nicht_jetzt');
  const alle = befehl(P, { an: 'alle', befehl: 'bord.sensor' });
  ok(alle.length === 1 && alle[0].textId === 'bord.sensor.abgelehnt.adressat', 'an: alle schliesst bord aus (bord.sensor an alle: adressat)');
  const rolle = befehl(P, { an: 'technik', befehl: 'bord.sensor' });
  ok(rolle.length === 1 && rolle[0].textId === 'bord.sensor.abgelehnt.adressat', 'an: technik fuer einen bord-Befehl: adressat');
  ok(befehl(P, { an: botVon(P, 'technik').botId, befehl: 'bord.kuppel' })[0].textId === 'bord.kuppel.abgelehnt.nicht_jetzt', 'an: botId des Bord-Bots -> nicht_jetzt');
  ok(befehl(P, { an: botVon(P, 'ops').botId, befehl: 'bord.kuppel' })[0].textId === 'bord.kuppel.abgelehnt.adressat', 'an: botId eines anderen Bots -> adressat');
  const st = befehl(P, { an: 'alle', befehl: 'bot.status' });
  ok(st.length === 3 && st.every((x) => x.status === 'ok'), 'bot.status an alle: drei Antworten (bord kommt nicht als vierter Bot hinzu)');
  const stb = st.find((x) => x.botId === tb.botId);
  ok(stb && /Transfer/.test(stb.text) && agentVon(P, 'technik').absicht.zustand === 'an_station' && tb.console === 'transfer', `bot.status des Bord-Bots im Dienst nennt den Transfer ("${stb && stb.text}"), Zustand an_station, Konsole transfer`);
  ok(!st.filter((x) => x.botId !== tb.botId).some((x) => /Transfer/.test(x.text || '')), 'die anderen Bots nennen ihn nicht');
  const tp = befehl(P, { an: 'technik', befehl: 'tech.prio', args: { ziel: 'feuer' } });
  ok(tp.length === 1 && tp[0].botId === tb.botId, 'Befehle der Rolle (tech.prio) gehen weiter an den Bord-Bot (Antwort kommt von ihm)');
  // B-6: im Dienst antworten die Rollen des Bord-Bots nicht_jetzt, nie ok; die Absicht bleibt leer
  ok(tp[0].status === 'abgelehnt' && tp[0].textId === 'tech.prio.abgelehnt.nicht_jetzt' && typeof tp[0].text === 'string' && !/\bok\b/i.test(tp[0].text) && !agentVon(P, 'technik').absicht.halten.prio, 'Dienst: tech.prio an den Bord-Bot -> abgelehnt nicht_jetzt (Status geprueft, kein ok), keine Absicht gesetzt');
  const rollen = [['technik', 'tech.reparieren', { system: 'engines' }], ['technik', 'tech.schild', { sektor: 'bug' }], ['technik', 'tech.energie', { system: 'engines', delta: '+1' }], ['technik', 'tech.ueberladen', {}]];
  const antR = rollen.map(([an, b, args]) => befehl(P, { an, befehl: b, args })[0]);
  ok(antR.every((x) => x && x.status !== 'ok' && !/\.ok$/.test(x.textId) && (x.status === 'abgelehnt' || x.status === 'unmoeglich')), `Dienst: weitere tech.*-Befehle an den Bord-Bot nie ok (${antR.map((x) => x && x.textId).join(', ')})`);
  ok(antR.filter((x) => x && x.textId.endsWith('.abgelehnt.nicht_jetzt')).length >= 2, 'Dienst: mindestens die Annahme-Befehle sind nicht_jetzt (Prueffall der Registry bleibt dahinter wirksam)');
  const stOk = befehl(P, { an: 'technik', befehl: 'bot.status' });
  ok(stOk.length === 1 && stOk[0].status === 'ok' && /Transfer/.test(stOk[0].text), 'Ausnahme bot.status: im Dienst weiter ok, mit Transfer-Text');
  const navR = befehl(P, { an: 'navigation', befehl: 'nav.stopp' });
  const opsR = befehl(P, { an: 'ops', befehl: 'ops.feuer_halt' });
  ok(navR[0].status === 'ok' && opsR[0].status === 'ok', 'die Bots ohne Dienst (Navigation, Ops) nehmen ihre Rollenbefehle weiter an (ok)');
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
  console.log('  info  Hash ' + mit.hash + ' (fuer den Vergleich vorher/nachher)');
  // Basis = Stand, auf dem der Zweig aufsetzt (git merge-base HEAD main, per git archive; kein fester Commit, kein stash/checkout), dasselbe Messskript fuer beide Baeume
  const B = require('./lib/bot02-basis.js').basisBaum(TMP);
  if (B.ref) {
    const BASIS = B.ref, baum = B.baum;
    const messen = (wurzel) => JSON.parse(cp.execFileSync(process.execPath, [path.join(__dirname, 'mess-bot02-menschenpartie.js'), wurzel], { encoding: 'utf8', env: Object.assign({}, process.env, { NODE_PATH: path.join(__dirname, '..', 'node_modules') }) }).trim().split('\n').pop());
    const alt = messen(baum), neu = messen(path.join(__dirname, '..'));
    ok(alt.snapshots > 300 && alt.errors === 0 && neu.errors === 0 && alt.hash === neu.hash && alt.snapshots === neu.snapshots, `Basisstand ${BASIS} gegen Stand (drei Menschenpartien, Mensch unten und am Transfer): Hash gleich (${neu.hash.slice(0, 8)}, ${neu.snapshots} Snapshots, Fehler 0)`);
  } else console.log('  info  Basisvergleich uebersprungen: ' + B.grund);
}

// ---------- 9 Nacharbeit ----------
section('9 Nacharbeit: Verwerfen, Dienstende mit Mensch an der Station, bewusstloser Bord-Bot, Beamen, Wiederbeginn, Raeumen');
const Loc = require('../shared/locations.js');
// Testsaeume fuer den Spielpfad des Beamens (Spielzustand wie ein Spieler ihn braucht, nichts am Dienst): die Mission sperrt die Plattform (Boje scannen), das Schiff steht ausserhalb der Beamreichweite
function beamBereit(P) {
  const g = P.g; g.mission.beamDownBlocked = () => null;
  const sc = Loc.get(g.ship.scene).scene; g.ship.x = sc.station.x; g.ship.y = sc.station.y; g.ship.speed = 0;
  return away.canBeam(g, 'down').ok;
}
{
  // 9a Verwerfen beim Dienstbeginn: Haltezustand (tech.prio), Prioritaet im Schiff, Feuerzustand der Ops
  const P = partie({ bots: ['navigation', 'ops', 'technik'] });
  lauf(P, 40, () => sitzen(P));
  const ag = agentVon(P, 'technik');
  const r = befehl(P, { an: 'technik', befehl: 'tech.prio', args: { ziel: 'feuer' } });
  lauf(P, 10, () => P.g.ship.priority === 'fire');
  ok(r[0].status === 'ok' && !!ag.absicht.halten.prio && P.g.ship.priority === 'fire', 'Vorher: tech.prio feuer gesetzt (absicht.halten.prio) und im Schiff (ship.priority fire)');
  runter(P.h); lauf(P, 3);
  ok(Object.keys(ag.absicht.halten).length === 0 && !ag.absicht.befehl && ag.befehlGrund === 'bord' && P.g.ship.priority === null, `Dienstbeginn verwirft das Gehaltene: absicht.halten leer, befehlGrund bord (${ag.befehlGrund}), die Prioritaet im Schiff ist zurueckgenommen (${P.g.ship.priority})`);
  const O = partie({ bots: ['ops'] });
  lauf(O, 40, () => sitzen(O));
  const ro = befehl(O, { an: 'ops', befehl: 'ops.feuer_halt' });
  const ao = agentVon(O, 'ops');
  ok(ro[0].status === 'ok' && ao.absicht.feuer === 'halt', 'Vorher: ops.feuer_halt gesetzt (absicht.feuer)');
  runter(O.h); lauf(O, 3);
  ok(!ao.absicht.feuer && ao.befehlGrund === 'bord', 'Dienstbeginn verwirft auch den Feuerzustand der Ops (befehlGrund bord)');
}
{
  // 9b B-2: Dienst zu Ende, ein Mensch sitzt inzwischen an der Station des Bots: der Bot bleibt nicht am Transfer stehen
  const P = partie({ bots: ['technik'], menschen: 2 });
  const { g } = P; const a = P.h, b = P.conns[1].player, cb = P.conns[1]; const tb = botVon(P, 'technik'); let ag;
  lauf(P, 40, () => sitzen(P)); ag = agentVon(P, 'technik');
  runter(a); lauf(P, 40, () => tb.console === 'transfer'); lauf(P, 1);
  interior.enterConsole(g, b, 'technik');
  ok(tb.console === 'transfer' && b.console === 'technik', 'Ausgangslage: der Bot haelt den Transfer im Dienst, Mensch B sitzt an seiner Technik');
  let d = null; const pruefe = () => { if (!d) d = doppelt(P); };
  hoch(g, a);
  const frei = lauf(P, 10, () => tb.console === null, pruefe); lauf(P, 8, null, pruefe);
  ok(frei && tb.console === null && haelt(P, 'transfer').length === 0 && ag.absicht.zustand === 'wartet', 'Dienst zu Ende, Mensch an der Technik: der Bot verlaesst die Transfer-Konsole (kein Haenger) und wartet');
  ok(b.console === 'technik' && !d && g.errors === 0, 'Mensch B behaelt die Technik, nie zwei Halter, keine Fehler');
  g.handleMessage(cb, { t: 'leave' });
  const zurueck = lauf(P, 40, () => Station.stationOf(tb) === 'technik'); lauf(P, 1);
  ok(zurueck && ag.absicht.zustand === 'an_station', 'Mensch B geht: der Bot setzt sich wieder an die Technik');
}
{
  // 9c B-3: bewusstloser Bord-Bot, Wechsel auf den naechsten, Hysterese
  const P = partie({ bots: ['navigation', 'ops', 'technik'] });
  const { g } = P; const tb = botVon(P, 'technik'), ob = botVon(P, 'ops');
  lauf(P, 40, () => sitzen(P));
  runter(P.h); lauf(P, 40, () => tb.console === 'transfer'); lauf(P, 1);
  let d = null, wechsel = 0, letzter = Lauf.bordBot(g);
  const pruefe = () => { if (!d) d = doppelt(P); const bb = Lauf.bordBot(g); if (bb !== letzter) { wechsel++; letzter = bb; } };
  interior.downPlayer(g, tb, 'test');
  ok(tb.downed && Lauf.bordBot(g) === ob && Lauf.dienstLaeuft(g, ob), 'Technik-Bot bewusstlos: der Ops-Bot ist Bord-Bot (Reihe Technik > Ops > Navigation, Bewusstlose uebersprungen)');
  const da = lauf(P, 40, () => ob.console === 'transfer', pruefe); lauf(P, 1, null, pruefe);
  ok(da && haelt(P, 'transfer').length === 1 && haelt(P, 'transfer')[0] === ob && !d, 'der Ops-Bot uebernimmt die Transfer-Konsole, nie zwei Halter');
  ok(!Station.stationBesetzt(g, 'weapons') && Station.waffenAutomatikAktiv(g) === true, 'Ops-Station verwaist, Waffenautomatik springt ein (vier Koepfe, B-1)');
  interior.revivePlayer(g, tb); wechsel = 0;
  lauf(P, 30, null, pruefe);
  ok(Station.stationOf(tb) === 'technik' && ob.console === 'transfer' && Lauf.bordBot(g) === ob && wechsel === 0 && !d, `Der Technik-Bot steht wieder auf, setzt sich an seine Technik und uebernimmt nicht zurueck (Hysterese: der Ops-Bot haelt sauber; Wechsel ${wechsel}, nie zwei Halter)`);
  hoch(g, P.h); lauf(P, 40, () => sitzen(P), pruefe);
  ok(sitzen(P) && haelt(P, 'transfer').length === 0 && Lauf.bordBot(g) === tb, 'Dienst zu Ende: alle drei Bots an ihren Stationen; beim naechsten Dienst gilt wieder die Reihe (Technik-Bot)');
  runter(P.h); lauf(P, 40, () => tb.console === 'transfer');
  ok(tb.console === 'transfer' && Lauf.bordBot(g) === tb && !d && g.errors === 0, 'naechster Dienst: der Technik-Bot haelt ihn wieder, keine Fehler');
  // alle bewusstlos: kein Bord-Bot, keine Fehler
  for (const p of g.players.filter((q) => q.bot)) interior.downPlayer(g, p, 'test');
  lauf(P, 3);
  ok(Lauf.bordBot(g) === null && g.errors === 0 && haelt(P, 'transfer').length === 0, 'alle Bots bewusstlos: kein Bord-Bot, Transfer frei, keine Fehler');
}
{
  // 9d B-5: der Dienst beginnt beim Beamen (Spielpfad: E halten auf dem Pad, selfbeam -> p.hold beam -> executeBeam)
  const P = partie({ bots: ['navigation', 'ops', 'technik'] });
  const { g } = P; const tb = botVon(P, 'technik'); let ag;
  lauf(P, 40, () => sitzen(P)); ag = agentVon(P, 'technik');
  ok(beamBereit(P), 'Testsaum: Beamen moeglich (canBeam down)');
  interior.placeOnShipPad(g, P.h, 0); lauf(P, 1);
  ok(!Lauf.bordAktiv(g, tb), 'Mensch steht nur auf dem Pad: kein Dienst');
  g.handleMessage(P.c, { t: 'act', down: true });
  lauf(P, 0.2);
  ok(P.h.hold && P.h.hold.kind === 'beam' && P.h.hold.dir === 'down' && P.h.zone === 'ship', 'Mensch haelt E auf dem Pad: p.hold beam (down), noch an Bord');
  ok(Lauf.bordAktiv(g, tb), 'Beamstart (E-Halten): der Dienst ist faellig, bevor der Mensch unten ist');
  lauf(P, 1);
  ok(Station.stationOf(tb) !== 'technik' && (tb.console === 'transfer' || ag.absicht.zustand === 'unterwegs'), `Der Bot geht los (Konsole ${tb.console}, Zustand ${ag.absicht.zustand})`);
  // Abbruch: E loslassen, Beam ab, Dienst endet, der Bot geht zurueck
  g.handleMessage(P.c, { t: 'act', down: false });
  lauf(P, 0.2);
  ok(!P.h.hold && P.h.zone === 'ship' && !Lauf.bordAktiv(g, tb), 'E losgelassen: Beam abgebrochen (hold weg), der Dienst endet');
  const zur = lauf(P, 40, () => Station.stationOf(tb) === 'technik'); lauf(P, 1);
  ok(zur && tb.console === 'technik' && ag.absicht.zustand === 'an_station' && haelt(P, 'transfer').length === 0, 'der Bot sitzt wieder an der Technik, Transfer frei');
  // vollstaendiger Beam: E halten bis zum Ende, der Mensch landet unten, der Bot steht am Transfer
  const t0 = g.time;
  g.handleMessage(P.c, { t: 'act', down: true });
  const unten = lauf(P, 8, () => P.h.zone === 'away');
  const tLand = g.time - t0; const amTransfer = tb.console === 'transfer';
  ok(unten && P.h.zone === 'away', `Beamsequenz bis zum Ende (Spielpfad, ${tLand.toFixed(1)} s): der Mensch ist unten`);
  console.log('  info  beim Landen: Bord-Bot an der Transfer-Konsole ' + (amTransfer ? 'ja' : 'nein, Zustand ' + ag.absicht.zustand));
  ok(lauf(P, 40, () => tb.console === 'transfer') && Lauf.dienstLaeuft(g, tb), 'der Dienst laeuft nach der Landung weiter, der Bot haelt den Transfer');
  g.handleMessage(P.c, { t: 'act', down: false });
  hoch(g, P.h); lauf(P, 40, () => Station.stationOf(tb) === 'technik');
  ok(Station.stationOf(tb) === 'technik' && g.errors === 0, 'Aufstieg: Dienst zu Ende, keine Fehler');
}
{
  // 9d2 B-5 ueber die Konsole (transfer.down, away.consoleBeam): Mensch B am Transfer gewinnt, geht er, uebernimmt der Bot waehrend des laufenden Beams
  const P = partie({ bots: ['navigation', 'technik'], menschen: 2 });
  const { g } = P; const a = P.h, b = P.conns[1].player, cb = P.conns[1]; const tb = botVon(P, 'technik');
  lauf(P, 40, () => sitzen(P));
  beamBereit(P);
  interior.placeOnShipPad(g, a, 0); interior.enterConsole(g, b, 'transfer');
  lauf(P, 1);
  g.handleMessage(cb, { t: 'cmd', c: 'transfer.down' });
  ok(g.ship.beaming && g.ship.beaming.dir === 'down' && g.ship.beaming.pids.includes(a.id), 'Konsolen-Beam (transfer.down) laeuft: ship.beaming down mit dem Menschen auf dem Pad');
  ok(Lauf.bordAktiv(g, tb) && !Lauf.dienstLaeuft(g, tb) && Station.stationOf(tb) === 'technik', 'Beam laeuft: der Dienst ist faellig, ruht aber, solange ein Mensch den Transfer haelt (der Bot bleibt an der Technik)');
  g.handleMessage(cb, { t: 'leave' }); lauf(P, 0.3);
  ok(g.ship.beaming && Lauf.dienstLaeuft(g, tb), 'Mensch B verlaesst die Konsole waehrend des Beams: der Dienst laeuft');
  ok(lauf(P, 10, () => a.zone === 'away') && lauf(P, 40, () => tb.console === 'transfer'), 'der Beam endet unten, der Bot haelt den Transfer');
}
{
  // 9e B-7: Wiederbeginn nach Mensch am Transfer verwirft das in der Zwischenzeit Gesetzte
  const P = partie({ bots: ['technik'], menschen: 2 });
  const { g } = P; const a = P.h, b = P.conns[1].player, cb = P.conns[1]; const tb = botVon(P, 'technik'); let ag;
  lauf(P, 40, () => sitzen(P)); ag = agentVon(P, 'technik');
  runter(a); lauf(P, 40, () => tb.console === 'transfer');
  neben(g, b, 'transfer'); eTaste(g, cb);
  lauf(P, 40, () => Station.stationOf(tb) === 'technik');
  const r = befehl(P, { an: 'technik', befehl: 'tech.prio', args: { ziel: 'feuer' } });
  lauf(P, 5, () => g.ship.priority === 'fire');
  ok(r[0].status === 'ok' && !!ag.absicht.halten.prio, 'Mensch haelt den Transfer, der Bot an der Technik nimmt tech.prio an (ok, Absicht gesetzt)');
  g.handleMessage(cb, { t: 'leave' });
  ok(lauf(P, 40, () => tb.console === 'transfer') && Object.keys(ag.absicht.halten).length === 0 && ag.befehlGrund === 'bord' && g.ship.priority === null, 'Mensch geht, der Bot kehrt in den Dienst zurueck: das Gesetzte endet (bordBegonnen zurueckgesetzt), Prioritaet im Schiff weg');
}
{
  // 9f der Bord-Bot wird im Dienst geraeumt (Verdraengen fuer einen neuen Menschen): Konsole frei, kein Haenger, der naechste Bot uebernimmt
  const P = partie({ bots: ['navigation', 'ops', 'technik'] });
  const { g } = P; const tb = botVon(P, 'technik'), ob = botVon(P, 'ops');
  lauf(P, 40, () => sitzen(P));
  runter(P.h); lauf(P, 40, () => tb.console === 'transfer'); lauf(P, 1);
  const c2 = mensch(g, 1); const p2 = c2.player;
  ok(p2 && p2.connected && !p2.bot && !tb.bot && tb.connected, 'der neue Mensch verdraengt den letzten Bot (Technik) mitten im Dienst und uebernimmt seinen Platz');
  let d = null; lauf(P, 3, null, () => { if (!d) d = doppelt(P); });
  ok(haelt(P, 'transfer').every((x) => x !== tb) && Lauf.agent(g, tb) === null && g.errors === 0, 'der geraeumte Bot haelt nichts mehr, sein Agent ist weg, keine Fehler');
  ok(lauf(P, 40, () => ob.console === 'transfer', () => { if (!d) d = doppelt(P); }) && Lauf.bordBot(g) === ob && !d, 'der Ops-Bot ist jetzt Bord-Bot und haelt den Transfer (kein Haenger, nie zwei Halter)');
  hoch(g, P.h); lauf(P, 40, () => Station.stationOf(ob) === 'weapons');
  ok(Station.stationOf(ob) === 'weapons' && g.errors === 0, 'Dienst zu Ende: der Ops-Bot ist wieder an den Waffen');
}

{
  // 9g Trennung des Menschen unten (zweiter Mensch bleibt): der Bot gibt den Transfer frei UND ist wieder an seiner Station
  const P = partie({ bots: ['navigation', 'technik'], menschen: 2 });
  const { g } = P; const tb = botVon(P, 'technik'); let ag;
  lauf(P, 40, () => sitzen(P)); ag = agentVon(P, 'technik');
  runter(P.h); lauf(P, 40, () => tb.console === 'transfer'); lauf(P, 1);
  ok(tb.console === 'transfer' && g.players.filter((p) => p.connected && !p.bot).length === 2, 'Ausgangslage: Mensch 1 unten, der Bot haelt den Transfer, ein zweiter Mensch ist an Bord');
  let d = null;
  g.removeConnection(P.c);
  const zur = lauf(P, 40, () => Station.stationOf(tb) === 'technik', () => { if (!d) d = doppelt(P); }); lauf(P, 1);
  ok(zur && haelt(P, 'transfer').length === 0 && tb.console === 'technik' && ag.absicht.zustand === 'an_station' && !d, 'Trennung: der Bot gibt den Transfer frei UND ist wieder an der Technik (p.console technik, Zustand an_station)');
  ok(g.errors === 0, 'game.errors 0');
}

console.log(fails ? `\ntest-bot02-bord: ${fails} FEHLER von ${n}` : `\ntest-bot02-bord: ${n}/${n} ok`);
process.exit(fails ? 1 : 0);
