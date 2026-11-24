'use strict';
// BOT-02 B3-Nacharbeit 2 (Review V-1, Entscheidung des Leiters): der Navigations-Bot uebernimmt NIE den Bord-Dienst, sein Notsprung geht von der Steuer aus (Weg Transfer-Steuer 10 s, Countdowns 10/5/2,5 s sind von dort nicht zu schaffen). Echtes Game (Freie Fahrt, Server-Bots):
//   1. nur Navigation, ein Mensch unten (Mess-Fall b2): der Bot bleibt am Steuer; Countdown 20 s, 10 s und 5 s: er springt, die Lerche lebt, der Mensch kommt mit (Notrueckholung)
//   2. Vorlauf-Variante: nur Navigation, Landepunkt gewaehlt, Mensch an Bord (Vorlauf in Reichweite): der Bot haelt das Schiff an der Steuer an; Countdown 10 s: Notsprung, die Lerche lebt
//   3. Mensch haelt das Steuer: der Bot wartet (kein helm.notsprung, nie zwei Halter an der Steuer)
//   4. Technik haelt den Bord-Dienst (Mess-Fall b1): der Navigations-Bot springt von seinem Posten
//   Mutationsproben: BOT_NS_MUT (tools/mutation-bot02-vorlauf.js): nav_bord (der Navigations-Bot haelt wieder den Bord-Dienst)
//   node tools/test-bot02-notsprung.js
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const { Game } = require('../server/game.js');
const Station = require('../server/sim/station.js');
const interior = require('../server/sim/interior.js');
const Space = require('../server/sim/space.js');
const Sprung = require('../server/sim/sprung.js');
const W = require('../server/world.js');
const BotSpieler = require('../server/bots/spieler.js');
const Lauf = require('../server/bots/lauf.js');
const { STOP } = require('../server/bots/kern.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const info = (t) => console.log('  info  ' + t);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-bot02ns-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
let seq = 0;
const LP = 'methalle.siedlung';
const KONSOLE = { navigation: 'helm', ops: 'weapons', technik: 'technik' };

function partie(bots, menschen) {
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  g.botZufall = (() => { let a = 42; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const spy = []; const echt = g.handleMessage.bind(g);
  g.handleMessage = (conn, msg) => { if (conn && conn.bot) spy.push({ pid: conn.player ? conn.player.id : null, rolle: conn.player ? conn.player.rolle : null, msg, t: g.time }); return echt(conn, msg); };
  const conns = [];
  for (let i = 0; i < (menschen || 1); i++) { const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'K' + i, color: i }); conns.push(c); }
  for (const r of bots) BotSpieler.botHinzufuegen(g, null, r);
  g.lobbyOpts.startMission = 'free';
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  g.space.enemies = []; g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0;
  const ereignisse = [];
  const emit = g.emit.bind(g);
  g.emit = (name, data) => { if (['notsprung', 'squadRecall', 'schiffZerstoert'].includes(name)) ereignisse.push({ t: g.time, name, data }); return emit(name, data); };
  const P = { g, c: conns[0], h: conns[0].player, spy, ereignisse };
  lauf(P, 40, () => g.players.filter((p) => p.bot).every((p) => Station.stationOf(p) === KONSOLE[p.rolle])); lauf(P, 1);
  return P;
}
const tick = (P) => { P.g.step(); if (P.g.wantsSnapshot()) P.g.snapshot(); };
const lauf = (P, sec, bis, jeTick) => { const t1 = P.g.time + sec; while (P.g.time < t1) { tick(P); if (jeTick) jeTick(); if (bis && bis()) return true; } return bis ? !!bis() : true; };
const botVon = (P, rolle) => P.g.players.find((p) => p.bot && p.rolle === rolle);
const notsprungCmds = (P) => P.spy.filter((s) => s.msg.t === 'cmd' && s.msg.c === 'helm.notsprung');
const hat = (P, ev) => P.ereignisse.find((e) => e.name === ev);
const haelt = (P, ort) => P.g.players.filter((p) => p.connected && (p.console === ort || Station.stationOf(p) === ort));
// Reaktor zerstoeren: n = Zahl der frueheren Ausfaelle (0: Countdown 20 s, 1: 10 s, 2: 5 s). Der Weg von der Transfer-Konsole zur Steuer dauert rund 10 s (Messung unten): vom Transfer aus rettet nur der erste Ausfall (20 s)
const reaktorBrechen = (P, n) => { P.g.ship.reaktorAusfaelle = n == null ? 0 : n; interior.damageSystem(P.g, 'reactor', 'broken'); return P.g.ship.reaktorCountdown ? P.g.ship.reaktorCountdown.t : null; };

// Freie Fahrt am Sprungpunkt (wie tools/mess-bot02-notsprung.js): der Notsprung hat ein Ziel
function amSprungpunkt(P) {
  const { g } = P;
  g.explore.erkunde('0306'); const sp = Sprung.sprungpunkt(g, '0306');
  const s = g.ship; s.docked = false; s.dockedAt = null; s.dockArmed = true; s.x = sp.x - 600; s.y = sp.y; s.angle = 0; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.stage = STOP; s.helm.autoStop = false;
  lauf(P, 1.5);
}
// Ort methalle (Landepunkt methalle.siedlung), Schiff in Beamreichweite; der Notsprung geht von dort (Hex des Orts)
function amLandepunkt(P) {
  const { g } = P;
  Space.enterScene(g, 'methalle', {}); lauf(P, 1);
  g.explore.known.add('methalle'); g.explore.version++;
  g.ship.x = 1349 - 150; g.ship.y = 928; g.ship.vx = 0; g.ship.vy = 0;
  g.mission.beamDownBlocked = () => null;
  g.space.enemies = []; g.away.drones = [];
  lauf(P, 1);
}
function waehle(P) {
  interior.enterConsole(P.g, P.h, 'transfer');
  P.g.handleMessage(P.c, { t: 'cmd', c: 'transfer.ziel', landepunkt: LP });
}
const verlassen = (P) => { lauf(P, 0.1); P.g.handleMessage(P.c, { t: 'leave' }); };
function neben(g, p, konsole) {
  const ct = W.CONSOLE_TILES[konsole][0];
  const t = W.accessTiles(W.ship, W.shipWalkable, ct.x, ct.y)[0];
  const c = W.tileCenter(t.x, t.y); p.x = c.x; p.y = c.y; p.moving = false; p.input.mx = 0; p.input.my = 0;
  const dx = ct.x - t.x, dy = ct.y - t.y; p.dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
}

// ---------- Mutationsprobe ----------
const MUT = process.env.BOT_NS_MUT || '';
if (MUT) {
  if (MUT === 'nav_bord') {   // der Navigations-Bot haelt den Bord-Dienst, sobald ein Mensch unten ist (wie vor Nacharbeit 2)
    const P0 = partie(['navigation']); lauf(P0, 1);
    const L = Object.getPrototypeOf(Lauf.agent(P0.g, botVon(P0, 'navigation')).lauf);
    const alt = L.dienstLaeuft;
    L.dienstLaeuft = function (sp) { if (sp && sp.rolle === 'navigation') return this.game.players.some((o) => o && !o.bot && o.connected && o.zone === 'away') && !this.game.players.some((o) => o && !o.bot && o.connected && o.console === 'transfer'); return alt.call(this, sp); };
  } else { console.log('unbekannte Mutation ' + MUT); process.exit(2); }
}

// ---------- 1 Mess-Fall b2 ----------
section('1 Nur Navigation, ein Mensch unten: der Bot bleibt am Steuer und springt (Countdown 20, 10 und 5 s)');
for (const [n, cdSoll] of [[0, 20], [1, 10], [2, 5]]) {
  const P = partie(['navigation']); const { g } = P; const nb = botVon(P, 'navigation');
  amSprungpunkt(P);
  P.h.zone = 'away'; lauf(P, 12);
  ok(Lauf.bordBot(g) === null && !Lauf.bordAktiv(g, nb) && nb.console === 'helm', `Countdown ${cdSoll} s: Ausgangslage: kein Bord-Bot, der Navigations-Bot sitzt an der Steuer (Mensch unten)`);
  const cd = reaktorBrechen(P, n); const t0 = g.time;
  lauf(P, 25, () => g.ship.schiffZerstoert || (hat(P, 'notsprung') && g.time - hat(P, 'notsprung').t > 3));
  const ns = hat(P, 'notsprung');
  ok(cd === cdSoll && !!ns && !g.ship.schiffZerstoert, `Countdown ${cd} s: der Bot springt (nach ${ns ? (ns.t - t0).toFixed(1) : '-'} s), die Lerche lebt`);
  ok(notsprungCmds(P).length >= 1 && notsprungCmds(P).every((s) => s.rolle === 'navigation') && !!hat(P, 'squadRecall') && P.h.zone === 'ship', 'helm.notsprung vom Navigations-Bot, der Notsprung holt den Menschen zurueck (Notrueckholung)');
  ok(g.errors === 0 && Lauf.agent(g, nb).verworfen === 0, 'game.errors 0, der Wachposten hat nichts verworfen');
}

// ---------- 2 Vorlauf-Variante ----------
section('2 Vorlauf: nur Navigation, Landepunkt gewaehlt, Mensch an Bord: Stopp an der Steuer, Countdown 10 s -> Notsprung');
{
  const P = partie(['navigation']); const { g } = P; const nb = botVon(P, 'navigation');
  amLandepunkt(P);
  g.ship.helm.stage = 3; lauf(P, 3);
  waehle(P); verlassen(P);
  lauf(P, 15);
  ok(Lauf.vorlaufLaeuft(g) && nb.console === 'helm' && !Lauf.bordAktiv(g, nb) && g.ship.speed <= g.C.ship.beamMaxSpeed, 'Vorlauf in Reichweite: der Navigations-Bot bleibt an der Steuer und hat das Schiff angehalten, kein Bord-Dienst');
  const t0 = g.time; reaktorBrechen(P, 1);
  lauf(P, 25, () => g.ship.schiffZerstoert || (hat(P, 'notsprung') && g.time - hat(P, 'notsprung').t > 3));
  const ns = hat(P, 'notsprung');
  ok(!!ns && !g.ship.schiffZerstoert, `der Bot springt (nach ${ns ? (ns.t - t0).toFixed(1) : '-'} s), die Lerche lebt`);
  ok(notsprungCmds(P).length >= 1 && g.errors === 0, 'helm.notsprung gesendet, game.errors 0');
}

// ---------- 3 Mensch haelt das Steuer ----------
section('3 Ein Mensch haelt das Steuer: der Bot wartet (kein helm.notsprung, nie zwei Halter an der Steuer)');
{
  const P = partie(['navigation']); const { g } = P;
  amSprungpunkt(P);
  neben(g, P.h, 'helm'); g.handleMessage(P.c, { t: 'act', down: true }); g.handleMessage(P.c, { t: 'act', down: false });
  lauf(P, 5, () => P.h.console === 'helm');
  ok(P.h.console === 'helm', 'der Mensch sitzt an der Steuer');
  reaktorBrechen(P, 0);
  let doppelt = false; lauf(P, 8, null, () => { if (haelt(P, 'helm').length > 1) doppelt = true; });
  ok(notsprungCmds(P).length === 0 && P.h.console === 'helm' && !doppelt, 'Countdown, der Mensch haelt die Steuer: der Bot sendet keinen Notsprung, nie zwei Halter an der Steuer');
}

// ---------- 4 Technik haelt den Bord-Dienst ----------
section('4 Technik haelt den Bord-Dienst (Mess-Fall b1): der Navigations-Bot springt von seinem Posten');
{
  const P = partie(['navigation', 'technik']); const { g } = P; const tb = botVon(P, 'technik');
  amSprungpunkt(P);
  P.h.zone = 'away'; lauf(P, 8, () => tb.console === 'transfer');
  ok(Lauf.bordBot(g) === tb, 'der Technik-Bot ist der Bord-Bot');
  reaktorBrechen(P);
  lauf(P, 25, () => g.ship.schiffZerstoert || (hat(P, 'notsprung') && g.time - hat(P, 'notsprung').t > 3));
  ok(!!hat(P, 'notsprung') && !g.ship.schiffZerstoert && notsprungCmds(P).every((s) => s.rolle === 'navigation'), 'der Navigations-Bot springt, die Lerche lebt');
}

console.log(fails ? `\ntest-bot02-notsprung: ${fails} FEHLER von ${n}` : `\ntest-bot02-notsprung: ${n}/${n} ok`);
void info; void STOP;
process.exit(fails ? 1 : 0);
