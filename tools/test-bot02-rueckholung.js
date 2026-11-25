'use strict';
// BOT-02 B2: der Bord-Bot holt zurueck und unterstuetzt (server/bots/bordlage.js, befehle/bord.js, mannschaft.js bordDienst, status.js, weichen.js). Echtes Game, Server-Bots, Testgelaende Raumkampf, Mensch "unten" ueber zone away.
//   1. Automatische Notrueckholung: transfer.recall erst, wenn ALLE Menschen unten downed sind; genau ein Aufruf, Abklingzeit, Transfer ausgefallen/durchgebrannt, mehrere Menschen (erster, danach Nachsetzen)
//   2. bord.rueckholen: ok / kein_ziel / nicht_jetzt, sofort auch bei aufrechten Menschen, Wahl des Ziels
//   3. bord.sensor / bord.kuppel: der Bot laeuft zur Captain-Konsole, sendet captain.support, kehrt zurueck (Wirkung am Spielzustand); Mensch an der Captain-Konsole, Abklingzeit, kein Ziel; Laufzeitmessung
//   4. Rueckholung geht dem Laufweg vor; Dienstende mitten im Weg; bot.automatik; Mensch gewinnt an der Captain-Konsole (weichen.js)
//   5. Automatik nach Regeln: Sensor bei aktiven Gegnern (hoechstens einmal je 60 s), Kuppel bei aktiven Gegnern und einem Menschen unter 50 % (hoechstens einmal je 60 s), insgesamt hoechstens ein Gang je 40 s (B2-Nacharbeit N-3)
//   5b. v2-Karten (N-1): die Automatik holt nicht zurueck (das Spiel regelt es: squadRecall), der Befehl schon; Captain-Konsole am Ort statt als Tab (N-2); SENDE_PAUSE isoliert und ehrlicher bot.status (N-4/N-7)
//   6. bot.status, Wachposten (nur die zwei erlaubten Kommandos, nie zwei Halter), Registry nur lesend, reine Menschenpartie byte-gleich (mess-bot02-menschenpartie.js)
//   Mutationsproben: Umgebungsvariable BOT_RUECK_MUT (siehe unten, tools/mutation-bot02-rueckholung.js)
//   node tools/test-bot02-rueckholung.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
process.chdir(path.join(__dirname, '..'));
const { Game } = require('../server/game.js');
const Station = require('../server/sim/station.js');
const interior = require('../server/sim/interior.js');
const away = require('../server/sim/away.js');
const Combat = require('../server/sim/combat.js');
const W = require('../server/world.js');
const BotSpieler = require('../server/bots/spieler.js');
const Lauf = require('../server/bots/lauf.js');
const Weichen = require('../server/bots/weichen.js');
const Lage = require('../server/bots/bordlage.js');
const Status = require('../server/bots/status.js');
const { BotMannschaft } = require('../server/bots/mannschaft.js');
const BordRegistry = require('../server/bots/befehle/bord.js');
const Protocol = require('../shared/protocol.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-bot02rueck-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
let seq = 0;

// ---------- Mutationsproben (nur mit BOT_RUECK_MUT; jede muss den Test rot machen) ----------
const MUT = process.env.BOT_RUECK_MUT || '';
const proto = BotMannschaft.prototype;
if (MUT === 'rueck_einer') Lage.allesDowned = (g) => Lage.untenMenschen(g).some((p) => p.downed);   // schon bei einem Verwundeten zurueckholen
else if (MUT === 'rueck_sperre_raus') Lage.rueckholSperre = () => null;   // Abklingzeit und Transfer-Ausfall ignorieren
else if (MUT === 'weg_vor_rueckholung') { const alt = proto.bordRueckholBedarf; proto.bordRueckholBedarf = function () { return this.bord.weg ? null : alt.call(this); }; proto.bordWegPruefen = () => {}; }   // der Laufweg geht vor
else if (MUT === 'mensch_captain') Lage.captainBelegt = () => false;   // Mensch an der Captain-Konsole wird ignoriert
else if (MUT === 'abklingzeit_raus') Lage.supportSperre = () => null;   // Weg trotz Abklingzeit
else if (MUT === 'sensor_ohne_gegner') Lage.gegnerAktiv = () => true;
else if (MUT === 'kuppel_immer') Lage.kuppelNoetig = (g) => Lage.untenMenschen(g).length > 0;
else if (MUT === 'sensor_pause_raus') { const alt = proto.bordUnterstuetzen; proto.bordUnterstuetzen = function () { alt.call(this); this.bord.sensorAuto = -1e9; }; }
else if (MUT === 'automatik_loescht_nicht') { const alt = proto.automatik; proto.automatik = function () { const b = Object.assign({}, this.bord); alt.call(this); this.bord = b; }; }
else if (MUT === 'bordloeschen_raus') proto.bordLoeschen = () => false;   // Dienstende und bot.automatik verwerfen Befehl und Weg nicht
else if (MUT === 'wachposten_auf') proto.erlaubt = () => true;
else if (MUT === 'rueckholen_befehl_ignoriert') proto.bordRueckholBedarf = function () { return Lage.allesDowned(this.game) ? Lage.rueckholZiel(this.game, false) : null; };
else if (MUT === 'registry_ok_immer') { BordRegistry['bord.rueckholen'] = () => ({ ok: true }); BordRegistry['bord.sensor'] = () => ({ ok: true }); BordRegistry['bord.kuppel'] = () => ({ ok: true }); }
else if (MUT === 'sofort_senden') { const alt = proto.bordRueckholen; proto.bordRueckholen = function (pid) { this.bord.rueckholAt = 0; alt.call(this, pid); }; Lage.rueckholSperre = () => null; }
else if (MUT === 'v2_auto') Lage.rueckholAutomatik = () => true;   // N-1: auch auf v2-Karten holt der Bot von selbst zurueck
else if (MUT === 'captain_ort_ignoriert') Lage.captainBelegt = (g, bot) => !!Station.halter(g, 'captain', bot);   // N-2: nur die aktive Station, nicht der Ort
else if (MUT === 'kuppel_ohne_gegner') Lage.gegnerAktiv = () => true;   // N-3: Kuppel (und Sensor) ohne Gegner
else if (MUT === 'kuppel_pause_raus') { const alt = proto.bordUnterstuetzen; proto.bordUnterstuetzen = function () { alt.call(this); this.bord.kuppelAuto = -1e9; }; }
else if (MUT === 'gang_pause_raus') { const alt = proto.bordWegWaehlen; proto.bordWegWaehlen = function () { alt.call(this); this.bord.autoGang = -1e9; }; }
else if (MUT === 'sende_pause_raus') { const alt = proto.bordRueckholen; proto.bordRueckholen = function (pid) { this.bord.rueckholAt = 0; alt.call(this, pid); }; }   // N-7: nur die Pause, die Sperre bleibt
else if (MUT === 'weichen_captain_raus') { const alt = Weichen.kannWeichen; Weichen.kannWeichen = (g, k, m) => (k === 'captain' ? false : alt(g, k, m)); }
else if (MUT) { console.log('unbekannte Mutation ' + MUT); process.exit(2); }

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
const runter = (p) => { p.zone = 'away'; };
const hoch = (g, p) => { interior.placeOnShipPad(g, p); };
function doppelt(P) { for (const ort of ['helm', 'weapons', 'technik', 'captain', 'transfer']) if (haelt(P, ort).length > 1) return ort; return null; }
const echtJetzt = Date.now; let versatz = 0;   // die Annahme begrenzt auf 10 Befehle je Sekunde (Wanduhr): jeder Befehl des Tests bekommt 200 ms Abstand
function befehl(P, msg, conn) {
  Date.now = () => echtJetzt() + (versatz += 200);
  const c = conn || P.c; const n0 = c.inbox.length;
  P.g.handleMessage(c, Object.assign({ t: 'bot.befehl', quelle: 'menu' }, msg));
  return c.inbox.slice(n0).filter((o) => o.t === Protocol.C.BOT_ANTWORT);
}
const bord = (P, name, an) => befehl(P, { an: an || 'bord', befehl: name })[0];
const isDown = (st) => st === 'broken' || st === 'offline';
const wanduhr = () => { Date.now = echtJetzt; };

// Szene: Mensch (bzw. zwei) unten, der Technik-Bot haelt den Transfer. o.menschen 2: Bots ops+technik; sonst alle drei.
function szene(o) {
  o = o || {};
  const P = partie({ bots: o.menschen > 1 ? ['ops', 'technik'] : ['navigation', 'ops', 'technik'], menschen: o.menschen || 1 });
  lauf(P, 40, () => sitzen(P));
  P.tb = botVon(P, 'technik'); P.ag = agentVon(P, 'technik'); P.a = P.h; P.b = P.conns[1] ? P.conns[1].player : null;
  P.g.away.drones = [];
  runter(P.a); if (P.b && !o.einer) runter(P.b);
  P.g.away.drones = [];
  lauf(P, 40, () => P.tb.console === 'transfer'); lauf(P, 1);
  P.g.away.drones = [];
  if (o.ruhe !== false) { P.g.support.kuppel = 999; P.g.support.sensor = 999; }   // Automatik der Unterstuetzung still (eigene Abschnitte pruefen sie)
  return P;
}
const recalls = (P, ab) => cmds(P, P.tb.id, 'transfer.recall', ab);
const supports = (P, ab) => cmds(P, P.tb.id, 'captain.support', ab);
// eine Drohne wach und still (kein Zielen: ausserhalb von aggroRange 160) im Abstand dx von p
function drohne(g, p, dx, extra) {
  const d = Object.assign({ id: 'x1', kind: 'drone', x: p.x + dx, y: p.y, hp: 6, dir: 'down', revealed: false, alive: true, home: { x: p.x + dx, y: p.y }, fireT: 0, wanderT: 1e9, wander: { x: p.x + dx, y: p.y } }, extra || {});
  g.away.drones = [d]; return d;
}

// ---------- 1 Automatische Notrueckholung ----------
section('1 Automatische Notrueckholung: erst wenn ALLE Menschen unten downed sind');
{
  const P = szene(); const { g, a, tb } = P;
  lauf(P, 5);
  ok(Lage.untenMenschen(g).length === 1 && !Lage.allesDowned(g) && recalls(P).length === 0, 'Ausgangslage: ein Mensch unten, aufrecht, der Bot haelt den Transfer, kein transfer.recall');
  a.hp = 15;   // schwer verwundet, aber aufrecht: keine Rueckholung (nur der Befehl holt)
  lauf(P, 8);
  ok(recalls(P).length === 0 && a.zone === 'away', 'aufrecht mit 15 % Gesundheit: keine Notrueckholung (Rueckholung erst bei downed)');
  a.hp = 100;
  const t0 = g.time; interior.downPlayer(g, a, 'test');
  const da = lauf(P, 5, () => a.zone === 'ship');
  const rc = recalls(P, t0);
  ok(da && rc.length === 1 && rc[0].msg.pid === a.id, `der Mensch unten ist downed: genau ein transfer.recall mit seiner pid, nach ${(g.time - t0).toFixed(1)} s ist er an Bord`);
  ok(!a.downed && Lauf.dienstLaeuft(g, tb) === false, 'er ist wiederbelebt an Bord, der Dienst endet');
  ok(g.support.recall > 55 && isDown(g.ship.systems.transfer), `Abklingzeit gesetzt (${g.support.recall.toFixed(0)} s), der Transfer ist durchgebrannt (${g.ship.systems.transfer})`);
  lauf(P, 70);
  ok(recalls(P, t0).length === 1 && P.ag.verworfen === 0 && g.errors === 0, 'danach kein weiterer Aufruf, keine verworfene Nachricht, keine Fehler');
  ok(lauf(P, 40, () => Station.stationOf(tb) === 'technik') && haelt(P, 'transfer').length === 0, 'der Bot sitzt wieder an der Technik, Transfer frei');
}
{
  // Abklingzeit: kein Senden gegen eine bekannte Sperre, nach Ablauf wird gesendet
  const P = szene(); const { g, a } = P;
  g.support.recall = 6;
  const t0 = g.time; interior.downPlayer(g, a, 'test');
  lauf(P, 5);
  ok(recalls(P, t0).length === 0 && a.zone === 'away', 'Abklingzeit laeuft (6 s): in den ersten 5 s kein transfer.recall (kein Dauerfeuer, keine Ablehnung des Spiels)');
  ok(lauf(P, 6, () => a.zone === 'ship') && recalls(P, t0).length === 1 && recalls(P, t0)[0].t >= t0 + 5.5, `nach Ablauf genau ein Aufruf (bei +${(recalls(P, t0)[0] || { t: 0 }).t - t0 > 0 ? (recalls(P, t0)[0].t - t0).toFixed(1) : '?'} s), der Mensch ist an Bord`);
  ok(P.ag.verworfen === 0 && g.errors === 0, 'keine Fehler');
}
{
  // Transfer ausgefallen: kein Senden, nach der Reparatur setzt der Bot nach
  const P = szene(); const { g, a } = P;
  g.ship.systems.transfer = 'broken';
  const t0 = g.time; interior.downPlayer(g, a, 'test');
  lauf(P, 6);
  ok(recalls(P, t0).length === 0 && a.zone === 'away', 'Transfer ausgefallen (broken): kein transfer.recall, Lage besteht');
  ok(P.tb.console === 'transfer' && Lauf.dienstLaeuft(g, P.tb), 'der Bot bleibt am Transfer');
  g.ship.systems.transfer = 'ok';
  ok(lauf(P, 5, () => a.zone === 'ship') && recalls(P, t0).length === 1, 'Transfer wieder ok: der Bot setzt nach, ein Aufruf, der Mensch ist an Bord');
}
{
  // mehrere Menschen unten: erst wenn ALLE downed sind, dann der erste; danach (nach Reparatur und Ablauf) der naechste
  const P = szene({ menschen: 2 }); const { g, a, b } = P;
  const t0 = g.time; interior.downPlayer(g, a, 'test');
  lauf(P, 8);
  ok(recalls(P, t0).length === 0 && a.zone === 'away' && b.zone === 'away' && !b.downed, 'A downed, B aufrecht: keine Notrueckholung (Rueckholung erst, wenn ALLE downed sind)');
  const erster = g.players.filter((p) => p.zone === 'away' && p.downed)[0];
  const t1 = g.time; interior.downPlayer(g, b, 'test');
  lauf(P, 4, () => recalls(P, t1).length > 0);
  const rc = recalls(P, t1);
  ok(rc.length === 1 && rc[0].msg.pid === erster.id && erster.zone === 'ship' && b.zone === 'away' && b.downed, 'alle downed: ein Aufruf, nur der erste (A) kommt hoch; B bleibt unten (der Transfer brennt durch, Abklingzeit)');
  lauf(P, 8);   // B bleibt downed (Selbstaufwachen erst nach autoReviveTime 15 s)
  ok(recalls(P, t1).length === 1 && b.downed && g.errors === 0, '8 s spaeter: kein zweiter Aufruf gegen die Sperre (Abklingzeit/Transfer aus), B weiter downed');
  ok(Lauf.dienstLaeuft(g, P.tb) && P.tb.console === 'transfer', 'der Dienst laeuft weiter (B ist unten), der Bot haelt den Transfer');
  g.ship.systems.transfer = 'ok'; g.support.recall = 0;
  ok(lauf(P, 5, () => b.zone === 'ship') && recalls(P, t1).length === 2 && recalls(P, t1)[1].msg.pid === b.id, 'Sperre weg: der Bot setzt nach, jetzt B (zweiter Aufruf)');
}

// ---------- 2 bord.rueckholen ----------
section('2 bord.rueckholen: sofort, auch bei aufrechten Menschen (Captain entscheidet)');
{
  const N = partie({ bots: ['navigation', 'ops', 'technik'] });
  lauf(N, 40, () => sitzen(N));
  const r = bord(N, 'bord.rueckholen');
  ok(r.status === 'abgelehnt' && r.textId === 'bord.rueckholen.abgelehnt.kein_ziel' && typeof r.text === 'string' && r.text.length > 0, `Mensch an Bord, niemand unten: abgelehnt kein_ziel (${r.text})`);
  const s = bord(N, 'bord.sensor'), k = bord(N, 'bord.kuppel');
  ok(s.textId === 'bord.sensor.abgelehnt.kein_ziel' && k.textId === 'bord.kuppel.abgelehnt.kein_ziel' && s.text && k.text, 'bord.sensor und bord.kuppel ohne jemanden unten: ebenfalls kein_ziel');
}
{
  const P = szene(); const { g, a, tb } = P;
  const t0 = g.time;
  const r = bord(P, 'bord.rueckholen');
  ok(r.status === 'ok' && r.textId === 'bord.rueckholen.ok' && r.botId === tb.botId, 'Mensch unten, aufrecht: ok (Antwort vom Bord-Bot)');
  ok(lauf(P, 3, () => a.zone === 'ship') && recalls(P, t0).length === 1 && recalls(P, t0)[0].msg.pid === a.id, `der Bot holt sofort zurueck (transfer.recall, ${(g.time - t0).toFixed(1)} s), auch ohne dass er verwundet ist`);
  ok(isDown(g.ship.systems.transfer) && g.support.recall > 55, 'Abklingzeit gesetzt, Transfer durchgebrannt');
}
{
  const P = szene(); const { g, a } = P;
  g.support.recall = 20;
  const r = bord(P, 'bord.rueckholen');
  lauf(P, 3);
  ok(r.status === 'abgelehnt' && r.textId === 'bord.rueckholen.abgelehnt.nicht_jetzt' && recalls(P).length === 0 && a.zone === 'away', 'Abklingzeit laeuft: abgelehnt nicht_jetzt, nichts gesendet');
  g.support.recall = 0; g.ship.systems.transfer = 'broken';
  const r2 = bord(P, 'bord.rueckholen');
  ok(r2.status === 'abgelehnt' && r2.textId === 'bord.rueckholen.abgelehnt.nicht_jetzt' && P.ag.bord.befehl === null, 'Transfer ausgefallen: abgelehnt nicht_jetzt, keine Absicht gesetzt');
}
{
  // Mensch haelt den Transfer: der Dienst ruht, der Mensch gewinnt
  const P = szene({ menschen: 2, einer: true }); const { g } = P;
  lauf(P, 40, () => P.tb.console === 'transfer');
  interior.enterConsole(g, P.b, 'transfer'); lauf(P, 3);
  const r = bord(P, 'bord.rueckholen');
  ok(r.status === 'abgelehnt' && r.textId === 'bord.rueckholen.abgelehnt.nicht_jetzt' && recalls(P).length === 0, 'ein Mensch haelt die Transfer-Konsole: nicht_jetzt (der Mensch gewinnt, der Dienst ruht)');
}
{
  // zwei Menschen unten: der Befehl holt EINEN (den Bewusstlosen, sonst den Verwundetsten)
  const P = szene({ menschen: 2 }); const { g, a, b } = P;
  a.hp = 100; b.hp = 40;
  const t0 = g.time; bord(P, 'bord.rueckholen');
  lauf(P, 3, () => recalls(P, t0).length > 0);
  ok(recalls(P, t0).length === 1 && recalls(P, t0)[0].msg.pid === b.id && b.zone === 'ship' && a.zone === 'away', 'beide aufrecht: der Befehl holt den Verwundetsten (B, 40 %), A bleibt unten');
  lauf(P, 10);
  ok(recalls(P, t0).length === 1 && Lauf.dienstLaeuft(g, P.tb), 'nur ein Aufruf (Abklingzeit, Transfer durchgebrannt), der Dienst laeuft fuer A weiter');
}
{
  const P = szene({ menschen: 2 }); const { g, a, b } = P;
  interior.downPlayer(g, b, 'test'); a.hp = 100;
  lauf(P, 1);
  const t0 = g.time; bord(P, 'bord.rueckholen');
  lauf(P, 3, () => recalls(P, t0).length > 0);
  ok(recalls(P, t0).length === 1 && recalls(P, t0)[0].msg.pid === b.id && b.zone === 'ship', 'einer downed, einer aufrecht: der Befehl holt den Bewusstlosen (B)');
}
{
  // Befehl, aber niemand mehr unten bevor der Bot sendet / Befehl verfaellt
  const P = szene(); const { g, a } = P;
  bord(P, 'bord.rueckholen'); hoch(g, a);
  lauf(P, 3);
  ok(recalls(P).length === 0 && P.ag.bord.befehl === null, 'der Mensch ist schon hoch, bevor der Bot sendet: kein transfer.recall, Befehl verfaellt (Dienstende)');
}

// ---------- 3 bord.sensor / bord.kuppel ----------
section('3 bord.sensor / bord.kuppel: zur Captain-Konsole, senden, zurueck');
let messung = null;
{
  const P = szene(); const { g, tb } = P;
  g.support.sensor = 0;
  const t0 = g.time; let tC = null, tS = null, tZ = null, d = null;
  const r = bord(P, 'bord.sensor');
  ok(r.status === 'ok' && r.textId === 'bord.sensor.ok', 'bord.sensor, Mensch unten, Abklingzeit bereit: ok');
  lauf(P, 1);
  const st = befehl(P, { an: 'technik', befehl: 'bot.status' })[0];
  ok(st && /Captain-Konsole/.test(st.text) && st.text.length <= 90, `bot.status waehrend des Weges: "${st && st.text}"`);
  lauf(P, 60, () => {
    if (tC === null && tb.console === 'captain') tC = g.time;
    if (tS === null && supports(P, t0).length) tS = g.time;
    if (tS !== null && tZ === null && tb.console === 'transfer') tZ = g.time;
    return tZ !== null;
  }, () => { if (!d) d = doppelt(P); });
  const cs = supports(P, t0);
  ok(cs.length === 1 && cs[0].msg.kind === 'sensor' && tC !== null && tS !== null && tZ !== null, `Weg: Captain-Konsole nach ${tC === null ? '?' : (tC - t0).toFixed(1)} s, captain.support sensor, zurueck am Transfer nach ${tZ === null ? '?' : (tZ - t0).toFixed(1)} s`);
  ok(g.support.sensor > 5 && g.away.sensorUntil > tS && g.away.sensorUntil - tS <= g.C.support.sensor.duration + 0.5, `Wirkung am Spielzustand: Abklingzeit ${g.support.sensor.toFixed(0)} s, sensorUntil gesetzt (Dauer ${g.C.support.sensor.duration} s)`);
  ok(!d && Lauf.dienstLaeuft(g, tb) && P.ag.bord.weg === null && P.ag.bord.befehl === null, 'nie zwei Halter einer Konsole; der Bot haelt wieder den Transfer, Weg und Befehl erledigt');
  ok(P.ag.verworfen === 0 && g.errors === 0 && recalls(P).length === 0, 'keine verworfene Nachricht, keine Fehler, keine Rueckholung');
  messung = { hin: tC - t0, rueck: tZ - tS, gesamt: tZ - t0, dauer: g.C.support.sensor.duration };
  console.log(`  info  Laufzeit Transfer -> Captain-Konsole ${messung.hin.toFixed(1)} s, Captain-Konsole -> Transfer ${messung.rueck.toFixed(1)} s, zusammen ${messung.gesamt.toFixed(1)} s; Sensor-Dauer ${messung.dauer} s (Rueckweg ${messung.rueck > messung.dauer ? 'LAENGER' : 'nicht laenger'} als die Wirkungsdauer)`);
  ok(messung.gesamt < 40, 'Hin- und Rueckweg dauern unter 40 s');
}
{
  const P = szene(); const { g, tb } = P;
  g.support.kuppel = 0;
  const t0 = g.time;
  const r = bord(P, 'bord.kuppel');
  ok(r.status === 'ok' && r.textId === 'bord.kuppel.ok', 'bord.kuppel: ok');
  ok(lauf(P, 40, () => supports(P, t0).length > 0) && supports(P, t0)[0].msg.kind === 'kuppel', 'der Bot laeuft zur Captain-Konsole und sendet captain.support kuppel');
  ok(g.away.kuppelHp === g.C.support.kuppel.absorb && g.away.kuppelUntil > g.time && g.support.kuppel > 40, `Wirkung am Spielzustand: kuppelHp ${g.away.kuppelHp}, kuppelUntil gesetzt, Abklingzeit ${g.support.kuppel.toFixed(0)} s`);
  ok(lauf(P, 40, () => tb.console === 'transfer') && supports(P, t0).length === 1 && g.errors === 0, 'danach zurueck am Transfer, ein Aufruf');
  const r2 = bord(P, 'bord.kuppel');
  ok(r2.status === 'abgelehnt' && r2.textId === 'bord.kuppel.abgelehnt.nicht_jetzt', 'Abklingzeit der Kuppel laeuft: abgelehnt nicht_jetzt');
}
{
  // Abklingzeit: abgelehnt, der Bot verlaesst den Transfer nicht
  const P = szene(); const { g, tb } = P;
  g.support.sensor = 20;
  let weg = false; const r = bord(P, 'bord.sensor');
  lauf(P, 6, null, () => { if (tb.console !== 'transfer') weg = true; });
  ok(r.status === 'abgelehnt' && r.textId === 'bord.sensor.abgelehnt.nicht_jetzt' && !weg && supports(P).length === 0, 'Abklingzeit laeuft: abgelehnt nicht_jetzt, der Bot bleibt Tick fuer Tick am Transfer (kein Weg fuer nichts)');
}
{
  // Mensch haelt die Captain-Konsole: der Mensch gewinnt
  const P = szene({ menschen: 2, einer: true }); const { g, tb } = P;
  g.support.sensor = 0; g.support.kuppel = 0;
  interior.enterConsole(g, P.b, 'captain');
  let weg = false;
  const r = bord(P, 'bord.sensor'), k = bord(P, 'bord.kuppel');
  lauf(P, 6, null, () => { if (tb.console !== 'transfer') weg = true; });
  ok(r.textId === 'bord.sensor.abgelehnt.nicht_jetzt' && k.textId === 'bord.kuppel.abgelehnt.nicht_jetzt' && !weg && supports(P).length === 0 && P.b.console === 'captain', 'Mensch an der Captain-Konsole: nicht_jetzt, der Bot geht nicht hin, kein Wegschieben');
  // auch als reiner Tab-Halter (Station captain ueber ein anderes Interface)
  P.b.console = 'helm'; P.b.station = 'captain';
  ok(Lage.captainBelegt(g, tb) === true && bord(P, 'bord.sensor').textId === 'bord.sensor.abgelehnt.nicht_jetzt', 'auch ein Mensch, dessen aktive Station captain ist (Tab), haelt die Captain-Station: nicht_jetzt');
  P.b.console = null; P.b.station = null;
}
{
  // alle unten downed und Rueckholung gesperrt: kein Weg
  const P = szene(); const { g, a, tb } = P;
  g.support.sensor = 0; g.support.kuppel = 0; g.support.recall = 40;
  interior.downPlayer(g, a, 'test');
  let weg = false;
  const r = bord(P, 'bord.sensor');
  lauf(P, 12, null, () => { if (tb.console !== 'transfer') weg = true; });
  ok(r.textId === 'bord.sensor.abgelehnt.nicht_jetzt' && !weg && supports(P).length === 0, 'alle unten downed (Rueckholung gesperrt): bord.sensor nicht_jetzt, der Bot bleibt am Transfer');
}

// ---------- 4 Rueckholung vor Laufweg, Dienstende, bot.automatik, Mensch gewinnt ----------
section('4 Die Rueckholung geht dem Laufweg vor; Dienstende mitten im Weg; bot.automatik; Mensch gewinnt');
{
  // Mensch wird mitten im Weg downed: der Bot kehrt um, holt zurueck, sendet kein captain.support
  const P = szene(); const { g, a, tb } = P;
  g.support.sensor = 0;
  const t0 = g.time; bord(P, 'bord.sensor');
  ok(lauf(P, 20, () => tb.console !== 'transfer' && tb.console !== 'captain' && !tb.lift), 'Ausgangslage: der Bot ist auf dem Weg (nicht am Transfer, noch nicht an der Captain-Konsole)');
  lauf(P, 1.5);
  interior.downPlayer(g, a, 'test');
  const t1 = g.time;
  ok(lauf(P, 40, () => a.zone === 'ship') && recalls(P, t1).length === 1 && recalls(P, t1)[0].msg.pid === a.id, `alle unten downed mitten im Weg: der Bot kehrt um und holt zurueck (${(g.time - t1).toFixed(1)} s)`);
  ok(supports(P, t0).length === 0 && g.support.sensor === 0 && g.errors === 0, 'es wurde kein captain.support gesendet (die Rueckholung ging vor), keine Fehler');
}
{
  // bord.rueckholen waehrend des Weges (Mensch aufrecht): Umkehr, Rueckholung
  const P = szene(); const { g, a, tb } = P;
  g.support.sensor = 0;
  const t0 = g.time; bord(P, 'bord.sensor');
  lauf(P, 20, () => tb.console !== 'transfer' && tb.console !== 'captain');
  const t1 = g.time; const r = bord(P, 'bord.rueckholen');
  ok(r.status === 'ok', 'bord.rueckholen waehrend des Weges: ok');
  ok(lauf(P, 40, () => a.zone === 'ship') && recalls(P, t1).length === 1 && supports(P, t0).length === 0, 'der Bot bricht den Weg ab, geht zum Transfer und holt zurueck; captain.support wurde nicht gesendet');
}
{
  // Dienstende mitten im Weg: der Bot geht an seine Station; der naechste Dienst beginnt ohne den alten Weg
  const P = szene(); const { g, a, tb } = P;
  g.support.sensor = 0;
  const t0 = g.time; bord(P, 'bord.sensor');
  lauf(P, 20, () => tb.console !== 'transfer' && tb.console !== 'captain');
  hoch(g, a);
  let d = null;
  const zur = lauf(P, 40, () => Station.stationOf(tb) === 'technik', () => { if (!d) d = doppelt(P); }); lauf(P, 1);
  ok(zur && haelt(P, 'transfer').length === 0 && haelt(P, 'captain').length === 0 && !d, 'Dienstende mitten im Weg: der Bot sitzt wieder an der Technik, keine Konsole bleibt belegt');
  ok(supports(P, t0).length === 0 && P.ag.bord.weg === null && P.ag.bord.befehl === null, 'kein captain.support gesendet, Weg und Befehl sind geloescht');
  g.support.sensor = 0; runter(a); g.away.drones = [];
  let aufCaptain = false;
  lauf(P, 40, () => tb.console === 'transfer', () => { if (tb.console === 'captain') aufCaptain = true; }); lauf(P, 8, null, () => { if (tb.console === 'captain') aufCaptain = true; });
  ok(tb.console === 'transfer' && !aufCaptain && supports(P, t0).length === 0, 'naechster Dienst: der Bot geht zum Transfer, nicht mehr zur Captain-Konsole (der alte Befehl ist weg)');
}
{
  // bot.automatik loescht Befehl und Weg
  const P = szene(); const { g, tb } = P;
  g.support.sensor = 0;
  const t0 = g.time; bord(P, 'bord.sensor');
  lauf(P, 20, () => tb.console !== 'transfer' && tb.console !== 'captain');
  const r = befehl(P, { an: 'technik', befehl: 'bot.automatik' })[0];
  ok(r && r.status === 'ok' && P.ag.bord.weg === null && P.ag.bord.befehl === null, 'bot.automatik mitten im Weg: ok, Befehl und Weg geloescht');
  ok(lauf(P, 40, () => tb.console === 'transfer') && supports(P, t0).length === 0 && g.support.sensor === 0, 'der Bot kehrt zum Transfer zurueck und sendet nichts');
}
{
  // Mensch gewinnt an der Captain-Konsole: ein Bot dort weicht (weichen.js), sonst nie
  const P = szene({ menschen: 2, einer: true }); const { g, tb } = P;
  const ohne = Weichen.kannWeichen(g, 'captain', P.b);
  interior.enterConsole(g, tb, 'captain');
  ok(ohne === false && Weichen.kannWeichen(g, 'captain', P.b) === true && Weichen.kannWeichen(g, 'captain', tb) === false, 'weichen.js: dem Menschen weicht ein Bot an der Captain-Konsole, einem Bot nie; ohne Bot dort nie');
  ok(Weichen.weichtFuerMensch(g, 'captain', P.b) === true && tb.console === null, 'der Bot gibt die Captain-Konsole frei, wenn der Mensch sie verlangt');
  interior.enterConsole(g, P.b, 'captain');
  ok(Weichen.kannWeichen(g, 'captain', tb) === false, 'ein Mensch an der Captain-Konsole: kein Weichen fuer Bots');
}
{
  // Mensch nimmt die Captain-Konsole, waehrend der Bot unterwegs ist: der Bot kehrt um, sendet nichts, schiebt den Menschen nicht weg
  const P = szene({ menschen: 2, einer: true }); const { g, tb } = P;
  g.support.sensor = 0;
  const t0 = g.time; bord(P, 'bord.sensor');
  lauf(P, 20, () => tb.console !== 'transfer' && tb.console !== 'captain');
  interior.enterConsole(g, P.b, 'captain');
  let d = null;
  ok(lauf(P, 40, () => tb.console === 'transfer', () => { if (!d) d = doppelt(P); }), 'ein Mensch setzt sich an die Captain-Konsole: der Bot kehrt zum Transfer zurueck');
  lauf(P, 5, null, () => { if (!d) d = doppelt(P); });
  ok(supports(P, t0).length === 0 && P.b.console === 'captain' && !d && g.errors === 0, 'kein captain.support vom Bot, der Mensch behaelt die Konsole, nie zwei Halter');
}

// ---------- 5 Automatik nach Regeln ----------
section('5 Automatik: Sensor bei aktiven Gegnern (hoechstens einmal je 60 s), Kuppel bei einem Menschen unter 50 %');
{
  const P = szene({ ruhe: false }); const { g, a, tb } = P;
  g.support.kuppel = 999;
  g.support.sensor = 0;
  lauf(P, 8);
  ok(supports(P).length === 0 && P.ag.bord.weg === null, 'keine Gegner unten: kein Sensor (Automatik ruhig)');
  drohne(g, a, 300, { asleep: true });
  lauf(P, 8);
  ok(supports(P).length === 0, 'Gegner schlaeft: kein Sensor');
  drohne(g, a, 900);
  lauf(P, 8);
  ok(supports(P).length === 0 && Lage.gegnerAktiv(g) === false, 'wache Drohne weit weg (900 px), Trupp nicht alarmiert: kein Sensor');
  const t0 = g.time;
  drohne(g, a, 300);
  ok(Lage.gegnerAktiv(g) === true, 'wache Drohne in 300 px: gegnerAktiv');
  ok(lauf(P, 40, () => supports(P, t0).length > 0) && supports(P, t0)[0].msg.kind === 'sensor', 'aktive Gegner unten, Mensch aufrecht, Abklingzeit bereit: der Bot laeuft zur Captain-Konsole und setzt den Sensor');
  const tS = supports(P, t0)[0].t;
  ok(g.away.sensorUntil > tS && g.support.sensor > 5, 'Wirkung am Spielzustand: sensorUntil gesetzt, Abklingzeit laeuft');
  ok(lauf(P, 40, () => tb.console === 'transfer'), 'danach zurueck am Transfer');
  // Abklingzeit des Spiels (30 s) vorbei, Gegner noch da: hoechstens einmal je 60 s
  g.support.sensor = 0;
  lauf(P, 30, null, () => { g.support.sensor = 0; });
  ok(supports(P, t0).length === 1, `weniger als 60 s nach dem ersten Sensor (${(g.time - tS).toFixed(0)} s): kein zweiter, obwohl die Abklingzeit des Spiels bereit ist`);
  ok(lauf(P, 40, () => supports(P, t0).length === 2, () => { g.support.sensor = 0; }) && supports(P, t0)[1].t - tS >= 59.5, `nach 60 s ein zweiter Sensor (+${supports(P, t0)[1] ? (supports(P, t0)[1].t - tS).toFixed(0) : '?'} s)`);
  ok(P.ag.verworfen === 0 && g.errors === 0, 'keine verworfenen Nachrichten, keine Fehler');
}
{
  // Mensch hat die Captain-Konsole: Automatik ruhig; alle downed: Automatik laeuft nicht los
  const P = szene({ menschen: 2, einer: true, ruhe: false }); const { g, a, tb } = P;
  g.support.kuppel = 0; g.support.sensor = 0;
  drohne(g, a, 300); a.hp = 30;
  interior.enterConsole(g, P.b, 'captain');
  let weg = false;
  lauf(P, 10, null, () => { if (tb.console !== 'transfer') weg = true; });
  ok(!weg && supports(P).length === 0, 'Gegner aktiv und Mensch unter 50 %, aber ein Mensch haelt die Captain-Konsole: die Automatik ist ruhig, der Bot bleibt am Transfer');
}
{
  const P = szene({ ruhe: false }); const { g, a, tb } = P;
  g.support.kuppel = 0; g.support.sensor = 0; g.support.recall = 999;
  drohne(g, a, 300);
  interior.downPlayer(g, a, 'test');
  let weg = false;
  lauf(P, 12, null, () => { g.away.drones[0] && (g.away.drones[0].x = a.x + 300); if (tb.console !== 'transfer') weg = true; });
  ok(!weg && supports(P).length === 0, 'der Mensch ist downed (alle unten downed, Rueckholung gesperrt): keine Automatik, der Bot bleibt am Transfer');
}
{
  const P = szene({ ruhe: false }); const { g, a, tb } = P;
  g.support.sensor = 999; g.support.kuppel = 0;
  a.hp = 60; drohne(g, a, 300);
  lauf(P, 8);
  ok(supports(P).length === 0 && Lage.kuppelNoetig(g) === false, 'Mensch aufrecht mit 60 %: keine Kuppel');
  const t0 = g.time; a.hp = 40;
  ok(lauf(P, 40, () => supports(P, t0).length > 0) && supports(P, t0)[0].msg.kind === 'kuppel', 'aktive Gegner, Mensch unten mit 40 % und aufrecht: der Bot setzt die Kuppel (Weg zur Captain-Konsole)');
  ok(g.away.kuppelHp === g.C.support.kuppel.absorb && g.support.kuppel > 40, 'Wirkung am Spielzustand: kuppelHp gesetzt, Abklingzeit laeuft');
  ok(lauf(P, 40, () => tb.console === 'transfer'), 'danach zurueck am Transfer');
  const n1 = supports(P, t0).length;
  lauf(P, 15);
  ok(supports(P, t0).length === n1, 'Kuppel aktiv und in der Abklingzeit: kein zweiter Aufruf');
  ok(P.ag.verworfen === 0 && g.errors === 0, 'keine Fehler');
}
{
  // Kuppel vor Sensor; Abklingzeit der Kuppel: kein Weg
  const P = szene({ ruhe: false }); const { g, a } = P;
  g.support.sensor = 0; g.support.kuppel = 0; a.hp = 30; drohne(g, a, 300);
  const t0 = g.time;
  lauf(P, 40, () => supports(P, t0).length > 0);
  ok(supports(P, t0)[0] && supports(P, t0)[0].msg.kind === 'kuppel', 'Gegner aktiv und Mensch unter 50 %: zuerst die Kuppel');
  const P2 = szene({ ruhe: false }); P2.g.support.kuppel = 20; P2.g.support.sensor = 999; P2.a.hp = 30; drohne(P2.g, P2.a, 300);
  let weg = false; lauf(P2, 8, null, () => { if (P2.tb.console !== 'transfer') weg = true; });
  ok(!weg && supports(P2).length === 0, 'Kuppel in der Abklingzeit: der Bot geht nicht los');
}
{
  // v2-Karten: Gesundheit = Schildsegmente (unter 50 % = 1 von 3)
  const P = szene(); const { g, a } = P;
  const alt = g.away.kampf; g.away.kampf = 'v2';
  a.shield = { seg: 3, max: 3 }; const voll = Lage.gesundheit(g, a);
  a.shield = { seg: 1, max: 3 };
  const einsV2 = Lage.gesundheit(g, a), noetigV2 = Lage.kuppelNoetig(g);
  a.shield = { seg: 2, max: 3 }; const zweiV2 = Lage.kuppelNoetig(g);
  g.away.kampf = alt; delete a.shield;
  ok(voll === 1 && Math.abs(einsV2 - 1 / 3) < 1e-9 && noetigV2 === true && zweiV2 === false && Combat.isV2(g) === false, 'auf v2-Karten zaehlen die Schildsegmente: 1 von 3 ist unter 50 %, 2 von 3 nicht');
  ok(Lage.gesundheit(g, a) === a.hp / g.C.player.hp, 'sonst gilt p.hp');
}

// ---------- 5b B2-Nacharbeit: v2-Karten, Captain-Konsole am Ort, Gesamtpause, SENDE_PAUSE ----------
section('5b v2-Karten (das Spiel regelt die Rueckholung), Captain-Konsole am Ort, Gesamtpause der Automatik, SENDE_PAUSE');
{
  // N-1: Bedingung als Funktion
  const P = szene(); const { g } = P;
  const v1 = Lage.rueckholAutomatik(g);
  Combat.ruesteV2(g, g.away); g.away.active = false; const v2aus = Lage.rueckholAutomatik(g);
  g.away.active = true; const v2an = Lage.rueckholAutomatik(g);
  ok(v1 === true && v2aus === true && v2an === false && Combat.isV2(g), 'rueckholAutomatik: v1 true; v2 und away.active (combat.update/squadRecall laufen) false; v2 ohne aktive Karte true');
}
{
  // N-1: echte v2-Karte (Plattform nach ruesteV2, wie das Spiel sie nach dem Tutorial umruestet): alle downed, der Bot sendet nichts, squadRecall des Spiels holt nach seiner Wartezeit zurueck
  const P = szene(); const { g, a, tb } = P;
  Combat.ruesteV2(g, g.away); g.away.active = true;
  lauf(P, 2);
  const t0 = g.time; Combat.woundPlayer(g, a, 'test');
  lauf(P, 4);
  ok(Combat.isV2(g) && Lage.allesDowned(g) && a.zone === 'away' && recalls(P, t0).length === 0, 'v2, alle unten downed: nach 4 s sendet der Bot nichts (transfer.recall), der Mensch liegt noch unten');
  const s = befehl(P, { an: 'technik', befehl: 'bot.status' })[0];
  ok(s && s.text === 'Team liegt, Rückholung läuft über das Schiff.', `bot.status auf v2 meldet den Ist-Zustand: "${s && s.text}"`);
  ok(P.tb.console === 'transfer' && Lauf.dienstLaeuft(g, tb), 'der Bot haelt weiter den Transfer');
  ok(lauf(P, 4, () => a.zone === 'ship') && recalls(P, t0).length === 0 && !a.downed, `das Spiel holt zurueck (squadRecall nach ${(g.time - t0).toFixed(1)} s, Wartezeit ${g.C.awayCombat.wounded.squadRecallDelay} s), ohne transfer.recall des Bots`);
  ok(g.away.stats.squadRecalls === 1 && g.errors === 0 && P.ag.verworfen === 0, 'aw.stats.squadRecalls = 1 (die Spielmechanik lief), keine Fehler');
}
{
  // N-1: der Befehl bord.rueckholen sendet auch auf v2
  const P = szene(); const { g, a } = P;
  Combat.ruesteV2(g, g.away); g.away.active = true;
  lauf(P, 2);
  const t0 = g.time; Combat.woundPlayer(g, a, 'test'); lauf(P, 1);
  const r = bord(P, 'bord.rueckholen');
  ok(r.status === 'ok' && lauf(P, 3, () => a.zone === 'ship') && recalls(P, t0).length === 1 && recalls(P, t0)[0].msg.pid === a.id, 'v2: bord.rueckholen auf Befehl sendet transfer.recall und holt zurueck (vor der Wartezeit des Spiels)');
}
{
  // N-2: ein Mensch AM ORT captain, per Tab eine andere Station aktiv: haelt die Konsole trotzdem
  const P = szene({ menschen: 2, einer: true }); const { g, a, tb } = P;
  g.support.sensor = 0; g.support.kuppel = 0;
  interior.enterConsole(g, P.b, 'captain'); P.b.station = 'helm';
  ok(P.b.console === 'captain' && Station.stationOf(P.b) === 'helm' && !Station.halter(g, 'captain', tb) && Lage.captainBelegt(g, tb) === true, 'Aufbau: B am Ort captain, Tab helm: Station.halter findet ihn nicht, captainBelegt schon');
  const r = bord(P, 'bord.kuppel'), r2 = bord(P, 'bord.sensor');
  ok(r.textId === 'bord.kuppel.abgelehnt.nicht_jetzt' && r2.textId === 'bord.sensor.abgelehnt.nicht_jetzt', 'bord.kuppel/bord.sensor: nicht_jetzt');
  a.hp = 30; drohne(g, a, 300);
  let weg = false;
  lauf(P, 60, null, () => { if (tb.console !== 'transfer' || P.ag.bord.weg) weg = true; });
  ok(!weg && supports(P).length === 0 && P.b.console === 'captain', '60 s mit Gegnern und einem Menschen bei 30 %: der Bot ist nie unterwegs, bleibt am Transfer (kein Pendeln vor der besetzten Konsole)');
}
{
  // N-2: der Mensch setzt sich (Ort captain, Tab helm), waehrend der Bot schon unterwegs ist
  const P = szene({ menschen: 2, einer: true }); const { g, tb } = P;
  g.support.sensor = 0;
  const t0 = g.time; bord(P, 'bord.sensor');
  lauf(P, 20, () => tb.console !== 'transfer' && tb.console !== 'captain');
  interior.enterConsole(g, P.b, 'captain'); P.b.station = 'helm';
  let d = null;
  ok(lauf(P, 40, () => tb.console === 'transfer', () => { if (!d) d = doppelt(P); }), 'Mensch am Ort captain (Tab helm) waehrend des Weges: der Bot kehrt um');
  ok(supports(P, t0).length === 0 && P.ag.bord.weg === null && P.b.console === 'captain' && !d, 'kein captain.support, der Mensch behaelt die Konsole, nie zwei Halter');
}
{
  // N-3: ohne Gegner keine Automatik, auch bei einem Menschen unter 50 % (auf v1 heilt nur das Medipack)
  const P = szene({ ruhe: false }); const { g, a } = P;
  g.support.kuppel = 0; a.hp = 40;
  let starts = 0, letzter = null;
  lauf(P, 180, null, () => { g.support.sensor = 999; a.hp = 40; const w = P.ag.bord.weg; if (w && w !== letzter) starts++; letzter = w; });
  ok(starts === 0 && supports(P).length === 0 && P.tb.console === 'transfer' && Lage.kuppelNoetig(g) === true && Lage.gegnerAktiv(g) === false, `0 Drohnen, Mensch bei 40 %, 180 s: ${starts} Gaenge, ${supports(P).length} captain.support (der Bot bleibt am Transfer)`);
}
{
  // N-3: mit Gegnern: Kuppel und Sensor teilen sich eine Gesamtpause (40 s je Gang), je Art 60 s
  const P = szene({ ruhe: false }); const { g, a } = P;
  drohne(g, a, 300);
  const starts = []; let letzter = null;
  lauf(P, 180, null, () => { g.support.sensor = 0; g.support.kuppel = 0; g.away.kuppelHp = 0; a.hp = 40; const w = P.ag.bord.weg; if (w && w !== letzter) starts.push({ t: g.time, art: w.art }); letzter = w; });
  const sp = supports(P); const luecke = (l) => l.slice(1).map((x, i) => x.t - l[i].t);
  const kup = sp.filter((s) => s.msg.kind === 'kuppel'), sen = sp.filter((s) => s.msg.kind === 'sensor');
  const minGang = Math.min(...luecke(sp.map((s) => ({ t: s.t })))), minK = Math.min(...luecke(kup)), minS = Math.min(...luecke(sen));
  // gezaehlt wird am Senden (captain.support): steht der Bot schon an der Konsole, beginnt und endet ein Gang im selben Tick (der Weg ist von aussen nie zu sehen)
  ok(sp.length >= 3 && sp.length <= 5 && minGang >= 38, `mit Gegnern: ${sp.length} Gaenge in 180 s (${sp.map((s) => s.msg.kind + '@' + s.t.toFixed(0)).join(' ')}), Abstand mindestens ${minGang.toFixed(1)} s (Gesamtpause 40 s)`);
  ok(kup.length >= 2 && sen.length >= 1 && minK >= 59.9 && (sen.length < 2 || minS >= 59.9), `Kuppel ${kup.length}x (Abstand mindestens ${minK.toFixed(1)} s), Sensor ${sen.length}x: je Art hoechstens einmal je 60 s`);
  ok(g.errors === 0 && P.ag.verworfen === 0, 'keine Fehler');
}
{
  // N-7: SENDE_PAUSE isoliert: das Spiel lehnt transfer.recall ab, ohne dass Abklingzeit oder Transfer-Ausfall bekannt sind (Lage.rueckholSperre bleibt null): der Bot wiederholt nur alle 2 s
  const P = szene(); const { g, a } = P;
  const alt = away.recall; away.recall = () => 'Test: abgelehnt.';
  try {
    const t0 = g.time; interior.downPlayer(g, a, 'test');
    lauf(P, 7);
    const l = recalls(P, t0); const n1 = l.length;
    const s = befehl(P, { an: 'technik', befehl: 'bot.status' })[0];
    ok(Lage.rueckholSperre(g) === null && n1 >= 3 && n1 <= 5 && a.zone === 'away', `Spiel lehnt ab, keine bekannte Sperre: in 7 s ${n1} Versuche (Pause 2 s), nicht Dauerfeuer`);
    ok(s && s.text === 'Hole das Team zurück.', `bot.status ohne Sperre: "${s && s.text}"`);
    const gaps = l.slice(1).map((x, i) => x.t - l[i].t);
    ok(gaps.length > 0 && gaps.every((x) => x >= 1.9), `Abstand zwischen zwei Versuchen mindestens 2 s (${gaps.map((x) => x.toFixed(1)).join(' ')})`);
  } finally { away.recall = alt; }
}
{
  // N-5: Annahme-Texte als Absicht, ohne Argumente
  const tx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'bots', 'texte.json'), 'utf8'));
  const ids = ['bord.rueckholen.ok', 'bord.sensor.ok', 'bord.kuppel.ok'];
  ok(ids.every((id) => Array.isArray(tx[id]) && tx[id].length === 2 && tx[id].every((t) => /^[^\s].{5,60}[.]$/.test(t) && !/steht|wird zurückgeholt|unterstützt|über dem/.test(t)) && /^Aye/.test(tx[id][0])), 'bord.*.ok: je zwei Varianten, Absicht statt Wirkung ("Kuppel steht" u. a. weg), erste mit Aye');
}

// ---------- 6 Status, Wachposten, Registry, Menschenpartie ----------
section('6 bot.status, Wachposten, Registry nur lesend, reine Menschenpartie');
{
  const P = szene(); const { g, a, tb } = P;
  const st = (an) => befehl(P, { an: an || 'technik', befehl: 'bot.status' })[0];
  ok(/Halte den Transfer/.test(st().text), `bot.status im Dienst: "${st().text}"`);
  g.support.recall = 999; interior.downPlayer(g, a, 'test'); lauf(P, 1);
  const s2 = st().text;
  ok(s2 === 'Transfer lädt, warte auf Rückholung.', `bot.status bei gesperrter Rueckholung (Abklingzeit): ehrlich, nicht "Hole das Team zurueck": "${s2}"`);
  g.support.recall = 0; g.ship.systems.transfer = 'broken'; lauf(P, 1);
  const s3 = st().text;
  ok(s3 === 'Transfer ausgefallen, warte auf die Reparatur.', `bot.status bei ausgefallenem Transfer: "${s3}"`);
  const texte = ['Hole das Team zurück.', 'Transfer lädt, warte auf Rückholung.', 'Transfer ausgefallen, warte auf die Reparatur.', 'Team liegt, Rückholung läuft über das Schiff.', 'Gehe zur Captain-Konsole, Sensor für das Team.', 'Gehe zur Captain-Konsole, Kuppel für das Team.', 'Halte den Transfer, bis das Team zurück ist.', 'Unterwegs zum Transfer.'];
  ok(texte.every((t) => t.length <= Status.MAX), 'alle Bord-Statustexte: hoechstens 90 Zeichen');
}
{
  // Wachposten: ueber alle Szenarien dieses Tests sendet der Bord-Bot im Dienst nur transfer.recall und captain.support (plus Stationsbefehle)
  const P = szene(); const { g, a, tb } = P;
  g.support.sensor = 0; g.support.kuppel = 0;
  bord(P, 'bord.sensor'); lauf(P, 40, () => supports(P).length > 0); lauf(P, 15);
  bord(P, 'bord.rueckholen'); lauf(P, 4, () => a.zone === 'ship');
  const namen = Array.from(new Set(cmds(P, tb.id).map((s) => s.msg.c)));
  ok(namen.every((c) => c === 'transfer.recall' || c === 'captain.support' || c.startsWith('technik.') || c === Protocol.CMD_STATION_TAB), `der Bord-Bot sendet nur transfer.recall, captain.support und Stationsbefehle (${namen.join(' ')})`);
  ok(P.ag.verworfen === 0, 'der Wachposten hat nichts verworfen');
  hoch(g, a); runter(a); g.away.drones = []; lauf(P, 40, () => tb.console === 'transfer');
  const v0 = P.ag.verworfen, b0 = P.ag.befehle;
  for (const c of ['transfer.down', 'transfer.up', 'transfer.ziel', 'transfer.supply', 'captain.scan', 'captain.order', 'captain.accept']) P.ag.send({ t: 'cmd', c });
  ok(P.ag.verworfen === v0 + 7 && P.ag.befehle === b0, 'andere transfer.*/captain.*-Kommandos werden im Dienst weiter verworfen');
  ok(P.ag.erlaubt({ t: 'cmd', c: 'transfer.recall' }) && P.ag.erlaubt({ t: 'cmd', c: 'captain.support' }) && !P.ag.erlaubt({ t: 'cmd', c: 'captain.support2' }), 'erlaubt(): die zwei Whitelist-Namen im Dienst, keine Namensvarianten');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'bots', 'mannschaft.js'), 'utf8');
  const wl = /const BORD_BEFEHLE = \[([^\]]*)\]/.exec(src);
  ok(!!wl && wl[1].split(',').map((x) => x.trim().replace(/'/g, '')).join() === 'transfer.recall,captain.support', 'Quellscan: BORD_BEFEHLE ist weiter genau transfer.recall und captain.support');
}
{
  // Registry: nur lesen (kein Spielzustand), nur ueber den Agenten
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'bots', 'befehle', 'bord.js'), 'utf8').replace(/\/\/.*$/gm, '');
  ok(!/\.(cmd|send|emit|handleMessage|einmalig)\(/.test(src) && !/\b(game|g)\.[A-Za-z_.]+\s*=(?!=)/.test(src), 'Quellscan: befehle/bord.js sendet nicht und schreibt keinen Spielzustand');
  const lage = fs.readFileSync(path.join(__dirname, '..', 'server', 'bots', 'bordlage.js'), 'utf8').replace(/\/\/.*$/gm, '');
  ok(!/\.(cmd|send|emit|handleMessage|push|splice)\(/.test(lage) && !/\b(game|g|p|aw)\.[A-Za-z_.]+\s*(?:=(?!=)|\+=|-=)/.test(lage), 'Quellscan: bordlage.js liest nur');
  const g0 = require('../shared/config.js');
  ok(!!g0, 'Konfiguration geladen');
}
{
  // gruende.json / texte.json: kein_ziel fuer alle drei Befehle samt Text
  const gr = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'bots', 'gruende.json'), 'utf8'));
  const tx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'bots', 'texte.json'), 'utf8'));
  const befehle = ['bord.rueckholen', 'bord.sensor', 'bord.kuppel'];
  ok(befehle.every((b) => gr.befehle[b].includes('kein_ziel') && Array.isArray(tx[`${b}.abgelehnt.kein_ziel`]) && tx[`${b}.abgelehnt.kein_ziel`].length >= 2 && tx[`${b}.abgelehnt.kein_ziel`].every((t) => !/%|\{|\$/.test(t))), 'gruende.json: kein_ziel fuer bord.*; texte.json: je zwei Texte ohne Argumente');
}
{
  // reine Menschenpartie byte-gleich: Basis (merge-base mit main) gegen diesen Stand (git archive, kein stash/checkout)
  // Basis = Stand, auf dem der Zweig aufsetzt (git merge-base HEAD main, per git archive; kein fester Commit, kein stash/checkout), dasselbe Messskript fuer beide Baeume
  const B = require('./lib/bot02-basis.js').basisBaum(TMP);
  if (B.ref) {
    const BASIS = B.ref, baum = B.baum;
    const messen = (wurzel) => JSON.parse(cp.execFileSync(process.execPath, [path.join(__dirname, 'mess-bot02-menschenpartie.js'), wurzel], { encoding: 'utf8', env: Object.assign({}, process.env, { NODE_PATH: path.join(__dirname, '..', 'node_modules') }) }).trim().split('\n').pop());
    const alt = messen(baum), neu = messen(path.join(__dirname, '..'));
    ok(alt.snapshots > 300 && alt.errors === 0 && neu.errors === 0 && alt.hash === neu.hash && alt.snapshots === neu.snapshots, `Basis ${BASIS} gegen Stand (drei Menschenpartien, Mensch unten und am Transfer): Hash gleich (${neu.hash.slice(0, 8)}, ${neu.snapshots} Snapshots, Fehler 0)`);
  } else console.log('  info  Basisvergleich uebersprungen: ' + B.grund);
}
wanduhr();

console.log(fails ? `\ntest-bot02-rueckholung: ${fails} FEHLER von ${n}` : `\ntest-bot02-rueckholung: ${n}/${n} ok`);
process.exit(fails ? 1 : 0);
