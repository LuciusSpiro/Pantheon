'use strict';
// BOT-01 B3: Spielverhalten der Server-Bots (server/bots/lauf.js, mannschaft.js, weichen.js, absicht.js, befehle/). Echtes Game, Testgelaende Raumkampf (arena_space).
//   1. Besetzung und Wachposten: drei Bots sitzen binnen einer Frist an ihren Konsolen (Navigation helm, Ops weapons, Technik direkt an technik), kein hello/ready/Loadout/fremde Befehle, game.errors 0
//   2. Ops: ein von anderen markiertes Ziel geht vor (zwei Gegner im Bogen, der naehere ist im Ladevorgang: das markierte wird getroffen), eine Marke ausser Bogen bleibt stehen, sonst nach dem Kern
//   3. Navigation: Ausweichen vor einer Ladung, Randstreifen (zur Mitte drehen), im Gefecht helm.*
//   4. Technik: Reparaturliste und Schilde (technik.repair, technik.shield), Bot-Automatik der Schrauber aus
//   5. Mensch gewinnt: Tab auf die Station eines Bots, Konsole koerperlich betreten, danach sendet der Bot nichts mehr fuer sie; Mensch geht -> der Bot uebernimmt; zwei Menschen blockieren sich weiter
//   6. Voller Server: ein Mensch tritt bei, der letzte Bot raeumt, Agent weg, Station frei und besetzbar
//   7. Automatik-Schwellen (station.js): reine Menschenpartien liefern dieselben Werte wie vorher (1..4 Spieler, mit/ohne Besetzung), mit Bots wie beschrieben
//   8. Pause, Reset „alle weg“, Browser-Schluss: mit drei echten Bots wie mit null
//   9. Telemetrie: Bot-Slots in der Zeitreihe markiert, Auswertung f4 trennt Bots und Menschen
//  10. Reine Menschenpartie unveraendert: Lauf als No-op ersetzt ergibt dieselben Snapshots und Nachrichten (SHA1), kein neues Feld an game, kein Lauf; snapshot() = snapshotBauen()
//  11. Lebenszyklus der Agenten: Lobby keine, Start da, Partieende/Lobby weg, Neustart neu, Bot verdraengt weg
//  12. Quellscan: Bot-Logik nur in server/bots/, station.js/interior.js nur duenne Aufrufe, kern.js ohne Missionslogik
//   node tools/test-bot-lauf.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
process.chdir(path.join(__dirname, '..'));
const { Game } = require('../server/game.js');
const Crew = require('../server/sim/crew.js');
const Station = require('../server/sim/station.js');
const interior = require('../server/sim/interior.js');
const space = require('../server/sim/space.js');
const W = require('../server/world.js');
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const Testhilfe = require('./gegner-testhilfe.js');
const BotSpieler = require('../server/bots/spieler.js');
const Lauf = require('../server/bots/lauf.js');
const Weichen = require('../server/bots/weichen.js');
const Absicht = require('../server/bots/absicht.js');
const Befehle = require('../server/bots/befehle/index.js');
const Lesen = require('./auswertung/lesen.js');
const { kennzahlen } = require('./auswertung/kennzahlen.js');
const { bericht } = require('./auswertung/bericht.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-botlauf-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
let seq = 0;

// ---------- Aufbau ----------
const mkConn = () => ({ inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } });
function mensch(g, i, color) {
  const c = mkConn(); g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'K' + i, color: color === undefined ? i : color });
  return c;
}
// o.bots: Rollen; o.menschen: Zahl (1); o.start: Startmodus; o.wellen: true laesst die Wellen laufen (sonst keine Gegner ausser den gesetzten); o.env: Zusatz-Umgebung
function partie(o) {
  o = o || {};
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: o.seed || 7, env: Object.assign({ MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, o.env || {}), log: () => {} });
  g.botZufall = (() => { let a = 42; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const spy = []; const echt = g.handleMessage.bind(g);   // alles, was Bots senden (jede Bot-Verbindung traegt bot: true)
  g.handleMessage = (conn, msg) => { if (conn && conn.bot) spy.push({ pid: conn.player ? conn.player.id : null, rolle: conn.player ? conn.player.rolle : null, msg, t: g.time }); return echt(conn, msg); };
  const conns = []; for (let i = 0; i < (o.menschen || 1); i++) conns.push(mensch(g, i, i));
  for (const r of o.bots || []) BotSpieler.botHinzufuegen(g, null, r);
  const p = { g, conns, c: conns[0], h: conns[0].player, spy, fest: [] };
  if (o.start !== false) {
    g.lobbyOpts.startMission = o.start || 'arena_space';
    for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
    if (!o.wellen && g.arena) { g.arena.nextAt = 1e9; g.space.enemies = []; }
  }
  return p;
}
// Ein Tick: Schritt, Snapshot fuer das Broadcast (wie server/index.js), gesetzte Gegner festhalten
function tick(P) {
  const g = P.g;
  for (const e of P.fest) if (g.space.enemies.includes(e)) {
    e.x = e.pin.x; e.y = e.pin.y; e.angle = e.pin.angle; e.vx = 0; e.vy = 0; e.fireT = -999; e.shields = [0, 0, 0, 0];
    if (e.teleFix) e.tele = { kind: 'shot', left: e.teleFix.left, dur: 2, sector: e.teleFix.sector };
  }
  g.space.projectiles = g.space.projectiles.filter((q) => q.kind === 'torpedo' || q.waffe || (q.kind !== 'enemy' && q.kind !== 'emp'));
  g.step();
  if (g.wantsSnapshot()) g.snapshot();
}
const ticks = (P, k) => { for (let i = 0; i < k; i++) tick(P); };
const lauf = (P, sec, bis) => { const t1 = P.g.time + sec; while (P.g.time < t1) { tick(P); if (bis && bis()) return true; } return bis ? !!bis() : true; };
function fest(P, kind, x, y, o) {
  o = o || {};
  const e = space.spawnEnemy(P.g, kind, { x, y, facing: o.angle != null ? o.angle : Math.atan2(P.g.ship.y - y, P.g.ship.x - x) });
  e.pin = { x: e.x, y: e.y, angle: e.angle };
  if (o.tele) e.teleFix = { left: o.tele.left, sector: o.tele.sector };
  P.fest.push(e);
  return e;
}
const rel = (g, d, deg) => { const a = g.ship.angle + deg * Math.PI / 180; return { x: g.ship.x + Math.cos(a) * d, y: g.ship.y + Math.sin(a) * d }; };
const cmds = (P, pid, prefix, ab) => P.spy.filter((s) => s.pid === pid && s.msg.t === 'cmd' && (!prefix || s.msg.c.startsWith(prefix)) && s.t >= (ab || 0));
const botVon = (P, rolle) => P.g.players.find((p) => p.bot && p.rolle === rolle);
const agentVon = (P, rolle) => Lauf.agent(P.g, botVon(P, rolle));
const stationVon = (P, rolle) => Station.stationOf(botVon(P, rolle));
const KONSOLE = { navigation: 'helm', ops: 'weapons', technik: 'technik' };
const alleSitzen = (P) => ['navigation', 'ops', 'technik'].every((r) => !botVon(P, r) || stationVon(P, r) === KONSOLE[r]);
// Mensch neben eine Konsole stellen (Blick auf sie) und E druecken
function neben(g, p, konsole) {
  const ct = W.CONSOLE_TILES[konsole][0];
  const t = W.accessTiles(W.ship, W.shipWalkable, ct.x, ct.y)[0];
  const c = W.tileCenter(t.x, t.y); p.x = c.x; p.y = c.y; p.moving = false; p.input.mx = 0; p.input.my = 0;
  const dx = ct.x - t.x, dy = ct.y - t.y; p.dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
}
const eTaste = (g, conn) => { g.handleMessage(conn, { t: 'act', down: true }); g.handleMessage(conn, { t: 'act', down: false }); };

// ---------- 1 Besetzung und Wachposten ----------
section('1 Besetzung: drei Bots an ihren Konsolen, Wachposten, keine Fehler');
const P1 = partie({ bots: ['navigation', 'ops', 'technik'], wellen: true });
{
  const { g } = P1;
  ok(g.phase === 'play' && Crew.menschen(g) === 1 && Crew.koepfe(g) === 4, 'Partie laeuft: 1 Mensch, 4 Koepfe');
  ok(P1.g.players.filter((p) => p.bot).every((p) => p.conn && p.conn.player === p), 'jeder Bot erreicht ueber conn.player seinen Spieler (handleMessage findet ihn)');
  lauf(P1, 1);
  ok(Lauf.agenten(g).length === 3 && Lauf.agenten(g).map((a) => a.rolleBot).sort().join() === 'navigation,ops,technik', 'ein Agent je Bot (navigation, ops, technik)');
  ok(Lauf.agenten(g).every((a) => a.pid === a.spieler.id && a.conn === a.spieler.conn && a.absicht.zustand !== undefined), 'Agent kennt Spieler-Id und Verbindung (kein hello/welcome)');
  const t0 = g.time; const fertig = lauf(P1, 40, () => alleSitzen(P1)); lauf(P1, 1);
  ok(fertig, `alle drei sitzen nach ${(g.time - t0).toFixed(1)} s Spielzeit (Frist 40 s)`);
  ok(Station.stationOf(botVon(P1, 'technik')) === 'technik' && botVon(P1, 'technik').console === 'technik' && botVon(P1, 'technik').station === null, 'Technik-Bot an der Technik-Konsole als eigene Rolle (console technik, kein Tab)');
  ok(Lauf.agenten(g).every((a) => a.absicht.zustand === 'an_station'), 'Zustand an_station bei allen');
  lauf(P1, 75);   // erste Welle (Wellen laufen): Gefecht
  const erlaubtePraefixe = { navigation: ['helm.', Protocol.CMD_STATION_TAB], ops: ['weapons.', Protocol.CMD_STATION_TAB], technik: ['technik.', Protocol.CMD_STATION_TAB] };
  const verbote = P1.spy.filter((s) => !['input', 'act', 'cmd', 'leave', 'drop'].includes(s.msg.t) || (s.msg.t === 'cmd' && !erlaubtePraefixe[s.rolle].some((x) => s.msg.c === x || s.msg.c.startsWith(x))));
  ok(P1.spy.length > 100 && verbote.length === 0, `Bots senden nur input/act/leave/drop und Befehle der eigenen Station (${P1.spy.length} Nachrichten, ${verbote.length} fremde${verbote[0] ? ': ' + JSON.stringify(verbote[0].msg) : ''})`);
  ok(!P1.spy.some((s) => ['hello', 'ready', 'lobbyBot', 'debug', 'menu', 'world'].includes(s.msg.t)) && !P1.spy.some((s) => s.msg.t === 'cmd' && /^(captain|loadout|ausruestung|slot|karte|plan|abenteuer|kontingent)/.test(s.msg.c)), 'nie hello, ready, Lobby, Debug, Menue, captain.*, Loadout, Karte');
  ok(P1.g.players.filter((p) => p.bot).every((p) => p.clientId === null && !('lobbyWaffe' in p && p.lobbyWaffe)), 'Bots haben keine clientId und keine Loadout-Wahl (clientId null: keine Loadouts)');
  ok(Lauf.agenten(g).every((a) => a.verworfen === 0), 'der Wachposten hat nie etwas abgewiesen (verworfen 0)');
  ok(cmds(P1, botVon(P1, 'navigation').id, 'helm.').length > 5, 'Navigation sendet helm.*');
  ok(cmds(P1, botVon(P1, 'ops').id, 'weapons.').length > 5, 'Ops sendet weapons.*');
  ok(g.errors === 0, `game.errors ${g.errors} (Soll 0)`);
}

// ---------- 2 Ops: Zielwahl ----------
section('2 Ops: ein markiertes Ziel geht vor');
function opsLage() {
  const P = partie({ bots: ['ops'] });
  lauf(P, 30, () => stationVon(P, 'ops') === 'weapons');
  const g = P.g;
  // Positionen im Steuerbord-Bogen (nicht im Bug-Bogen): naeher und weiter weg
  const arc = (p) => space.inMountArc(g, 'stbd', p.x, p.y) && !space.inMountArc(g, 'bow', p.x, p.y);
  let a = null, b = null;
  for (const [d, deg] of [[230, 85], [250, 95], [220, 100]]) { const p = rel(g, d, deg); if (arc(p) && !a) a = p; }
  for (const [d, deg] of [[330, 75], [350, 90], [320, 105]]) { const p = rel(g, d, deg); if (arc(p) && !b) b = p; }
  return { P, a, b };
}
{
  const { P, a, b } = opsLage();
  const g = P.g;
  ok(!!a && !!b, 'Setup: zwei Positionen im Steuerbord-Bogen, nicht im Bug-Bogen');
  const ea = fest(P, 'korvette', a.x, a.y, { tele: { left: 5, sector: 1 } });   // der nahe Gegner laedt (Kern: laedt = Vorrang)
  const eb = fest(P, 'korvette', b.x, b.y);
  g.handleMessage(P.c, { t: 'cmd', c: 'weapons.target', id: eb.id });   // der Mensch ist nicht an Ops: Rechtepruefung weist ab -> direkt markieren (Server-Feld ship.target)
  ok(g.ship.target !== eb.id, 'Mensch ohne Ops-Station kann nicht markieren (Rechtepruefung)');
  space.weaponsTarget(g, eb.id);
  const ia = Testhilfe.gesamtIntegritaet(ea), ib = Testhilfe.gesamtIntegritaet(eb);
  lauf(P, 10);
  ok(g.ship.target === eb.id, 'die Marke bleibt auf dem markierten Ziel (der Bot setzt sie nicht auf den ladenden Gegner um)');
  ok(Testhilfe.gesamtIntegritaet(eb) < ib, 'das markierte (weitere) Ziel wird getroffen');
  ok(Testhilfe.gesamtIntegritaet(ea) === ia, 'der naehere, ladende Gegner nicht');
  ok(cmds(P, botVon(P, 'ops').id, 'weapons.fire').length > 0, 'Ops hat gefeuert (weapons.fire)');
  ok(g.errors === 0, 'game.errors 0');
}
{
  const { P, a } = opsLage();
  const g = P.g;
  const ea = fest(P, 'korvette', a.x, a.y);
  const hinten = rel(g, 500, 180);
  const eb = fest(P, 'korvette', hinten.x, hinten.y);
  const imBogen = ['bow', 'port', 'stbd'].some((m) => space.inMountArc(g, m, hinten.x, hinten.y));
  space.weaponsTarget(g, eb.id);
  const ia = Testhilfe.gesamtIntegritaet(ea);
  lauf(P, 20);
  ok(!imBogen && g.ship.target === eb.id, 'markiertes Ziel ausser Bogen: die Marke bleibt (der Kern haette auf den Gegner im Bogen umgesetzt)');
  ok(Testhilfe.gesamtIntegritaet(ea) < ia, 'geschossen wird nur im Bogen: der Gegner im Steuerbord-Bogen wird getroffen, nicht ins Leere');
}
{
  const { P, a } = opsLage();
  const g = P.g;
  const ea = fest(P, 'korvette', a.x, a.y);
  lauf(P, 12);
  ok(g.ship.target === ea.id && P.spy.some((s) => s.msg.c === 'weapons.target' && s.msg.id === ea.id), 'ohne fremde Marke waehlt der Bot selbst (Kern): nimmt den Gegner im Bogen und markiert ihn');
  const ia = Testhilfe.gesamtIntegritaet(ea);
  lauf(P, 15);
  ok(Testhilfe.gesamtIntegritaet(ea) < ia, 'und trifft ihn');
}

// ---------- 3 Navigation ----------
section('3 Navigation: Ausweichen, Randstreifen, Gefecht');
{
  const P = partie({ bots: ['navigation'] });
  lauf(P, 30, () => stationVon(P, 'navigation') === 'helm');
  const g = P.g;
  const pos = rel(g, 450, 60);
  fest(P, 'korvette', pos.x, pos.y, { tele: { left: 0.1, sector: 0 } });   // die Ladung steht kurz vor dem Einschlag (der Bot plant sein Ausweichen zwischen 0,1 und 0,65 s davor)
  lauf(P, 6);
  ok(cmds(P, botVon(P, 'navigation').id, 'helm.dodge').length > 0, 'Ladung kurz vor dem Einschlag: helm.dodge (dodgeTele)');
  ok(cmds(P, botVon(P, 'navigation').id, 'helm.').length > 3, 'im Gefecht sendet die Steuer helm.* (Breitseite, Stufe)');
  ok(g.errors === 0, 'game.errors 0');
}
{
  const P = partie({ bots: ['navigation'] });
  lauf(P, 30, () => stationVon(P, 'navigation') === 'helm');
  const g = P.g;
  g.ship.x = 90; g.ship.y = 700; g.ship.angle = Math.PI; g.ship.vx = 0; g.ship.vy = 0;
  g.ship.helm.stage = 3;
  const a0 = g.ship.angle;
  const n0 = cmds(P, botVon(P, 'navigation').id, 'helm.').length;
  lauf(P, 7);
  const dreht = Math.abs(Math.atan2(Math.sin(g.ship.angle - a0), Math.cos(g.ship.angle - a0)));
  ok(cmds(P, botVon(P, 'navigation').id, 'helm.').length > n0 && dreht > 0.3, `ohne Gegner am Kartenrand: dreht zur Mitte (${dreht.toFixed(2)} rad), flog nicht geradeaus ins Leere`);
  ok(!cmds(P, botVon(P, 'navigation').id, 'helm.throttle').length && !cmds(P, botVon(P, 'navigation').id, 'helm.jump').length, 'ohne Gegner keine Stufenwahl und kein Sprung (kein eigenes Reisen)');
}
{
  const P = partie({ bots: ['navigation'] });
  lauf(P, 30, () => stationVon(P, 'navigation') === 'helm');
  const g = P.g;
  const x = g.ship.x, y = g.ship.y; g.ship.helm.stage = 3;
  const t0 = g.time; lauf(P, 3);
  ok(cmds(P, botVon(P, 'navigation').id, 'helm.', t0).length <= 2 && !cmds(P, botVon(P, 'navigation').id, 'helm.throttle').length, 'mitten auf der Karte ohne Gegner: Kurs und Stufe bleiben, kaum Befehle (' + cmds(P, botVon(P, 'navigation').id, 'helm.', t0).length + ')');
  ok(g.ship.helm.stage === 3, 'Stufe unveraendert');
  void x; void y;
}

// ---------- 4 Technik ----------
section('4 Technik: Reparaturliste, Schilde, Bot-Automatik');
{
  const P = partie({ bots: ['technik'] });
  lauf(P, 30, () => stationVon(P, 'technik') === 'technik'); lauf(P, 4);
  const g = P.g;
  ok(g.ship.botAuto === false, 'mit Technik-Bot ist die Bot-Automatik der Schrauber aus (botAutomatikStandard), die Technik fuehrt die Liste selbst');
  interior.damageSystem(g, 'battery_port', 'broken');
  const pos = rel(g, 500, 60);
  const sek = g.ship.shields.alloc.indexOf(Math.min(...g.ship.shields.alloc));
  fest(P, 'korvette', pos.x, pos.y, { tele: { left: 5, sector: sek } });
  const alloc0 = g.ship.shields.alloc.slice();
  const t0 = g.time;
  lauf(P, 15);
  const bid = botVon(P, 'technik').id;
  ok(cmds(P, bid, 'technik.repair', t0).some((s) => s.msg.system === 'battery_port'), 'beschaedigtes System kommt per technik.repair auf die Reparaturliste');
  ok(cmds(P, bid, 'technik.shield', t0).length > 0 && g.ship.shields.alloc[sek] > alloc0[sek], `Schilde zur Bedrohung (Sektor ${sek}): technik.shield, Zuteilung ${alloc0[sek]} -> ${g.ship.shields.alloc[sek]}`);
  ok(botVon(P, 'technik').console === 'technik' && !cmds(P, bid, Protocol.CMD_STATION_TAB).length, 'die Technik wechselt dafuer nie die Station (kein Tab)');
  ok(g.errors === 0, 'game.errors 0');
}

// ---------- 5 Mensch gewinnt ----------
section('5 Mensch gewinnt');
{
  const P = partie({ bots: ['navigation', 'ops', 'technik'] });
  const { g, h, c } = P;
  lauf(P, 40, () => alleSitzen(P));
  ok(alleSitzen(P), 'Ausgangslage: alle drei Bots sitzen');
  // 5a Tab: der Mensch sitzt am Captain-Platz und schaltet mit Tab auf die naechste Station (Technik, von einem Bot gehalten)
  interior.enterConsole(g, h, 'captain');
  const technik = botVon(P, 'technik'); const t0 = g.time;
  const fehler = Station.tab(g, h, 1);
  ok(fehler === null && Station.stationOf(h) === 'technik' && technik.console === null, 'Tab auf Technik: der Mensch bekommt die Station, der Bot gibt sie frei');
  ok(agentVon(P, 'technik').absicht.zustand === 'wartet', 'Bot-Zustand wartet (im Agenten, nicht im Spieler)');
  ok(!('zustand' in technik) && !JSON.stringify(g.snapshot().players).includes('wartet'), 'der Wartezustand steht weder im Spielerobjekt noch im Snapshot');
  const n0 = P.spy.filter((s) => s.pid === technik.id && s.msg.t === 'cmd' && s.t >= t0).length;
  lauf(P, 8);
  ok(P.spy.filter((s) => s.pid === technik.id && s.msg.t === 'cmd' && s.t >= t0).length === n0 && Station.stationOf(h) === 'technik' && technik.console === null, 'solange der Mensch haelt: der Bot sendet keine cmd, bleibt weg von der Konsole');
  // Eingabe des Menschen schlaegt die Bot-Absicht: ein beschaedigtes System, der Mensch stellt es per technik.repair an die Liste (der Bot raeumt nichts weg)
  g.handleMessage(c, { t: 'cmd', c: 'technik.botAuto', on: false });
  interior.damageSystem(g, 'engines', 'broken');
  g.handleMessage(c, { t: 'cmd', c: 'technik.repair', system: 'engines', mode: 'flick' });
  lauf(P, 3);
  ok(g.ship.repairQueue.some((e) => e.system === 'engines') || g.ship.systems.engines !== 'broken', 'Mensch-Eingabe an derselben Station gilt (Reparaturliste des Menschen)');
  // 5b Mensch verlaesst: der Bot uebernimmt wieder
  g.handleMessage(c, { t: 'leave' });
  ok(Station.stationOf(h) === null, 'Mensch verlaesst die Konsole');
  const zurueck = lauf(P, 25, () => Station.stationOf(technik) === 'technik'); lauf(P, 1);
  ok(zurueck && agentVon(P, 'technik').absicht.zustand === 'an_station', 'der Bot uebernimmt die Technik wieder (wartet -> an_station)');
}
{
  // 5c koerperlich: der Mensch betritt die Steuer-Konsole, die der Navigations-Bot haelt
  const P = partie({ bots: ['navigation', 'ops'] });
  const { g, h, c } = P;
  lauf(P, 40, () => alleSitzen(P));
  const nav = botVon(P, 'navigation');
  ok(nav.console === 'helm', 'Ausgangslage: Navigations-Bot an der Steuer');
  neben(g, h, 'helm');
  const t0 = g.time;
  eTaste(g, c);
  ok(h.console === 'helm' && nav.console === null, 'E an der Konsole: der Mensch sitzt an der Steuer, der Bot ist weg');
  ok(agentVon(P, 'navigation').absicht.zustand === 'wartet', 'Zustand wartet');
  g.handleMessage(c, { t: 'cmd', c: 'helm.input', turn: 0.5, thrust: 0 });
  lauf(P, 6);
  ok(g.ship.helm.turn === 0.5, 'die Eingabe des Menschen bleibt stehen (der Bot ueberschreibt sie nicht)');
  ok(P.spy.filter((s) => s.pid === nav.id && s.msg.t === 'cmd' && s.t >= t0).length === 0, 'der Bot sendet keinen cmd mehr fuer die Station');
  // zwei Menschen blockieren sich weiter
  const c2 = mensch(g, 5, 3); const h2 = c2.player;
  ok(!!h2 && !h2.bot, 'zweiter Mensch an Bord');
  neben(g, h2, 'helm');
  eTaste(g, c2);
  ok(h.console === 'helm' && h2.console === null, 'Mensch gegen Mensch: der zweite wird blockiert wie bisher');
  ok(c2.inbox.some((m) => m.kind === 'notice' && /Konsole besetzt \(K0\)/.test(m.text)), 'Meldung „Konsole besetzt (K0)“ nur fuer Menschen');
  ok(Weichen.kannWeichen(g, 'helm', h2) === false && Weichen.weichtFuerMensch(g, 'helm', h2) === false, 'weichtFuerMensch: ein Mensch haelt die Station, nichts weicht');
  // der Mensch geht, der Bot uebernimmt (der zweite Mensch steht nur daneben)
  g.handleMessage(c, { t: 'leave' });
  ok(lauf(P, 25, () => nav.console === 'helm') && nav.console === 'helm', 'Mensch geht: der Bot sitzt wieder an der Steuer');
}
{
  // 5d Menschen blockieren sich bei Tab wie bisher (ohne Bots, Meldung „durch Name besetzt“)
  const P = partie({ bots: [], menschen: 2 });
  const { g, conns } = P; const [a, b] = conns.map((c) => c.player);
  interior.enterConsole(g, a, 'helm'); interior.enterConsole(g, b, 'captain');
  const e = Station.tab(g, b, -1);   // captain -> weapons (frei) ... dann weiter
  ok(e === null && Station.stationOf(b) === 'weapons', 'Tab zwischen Menschen: naechste freie Station');
  const e2 = Station.tab(g, a, -1);   // helm -> technik (frei)
  ok(e2 === null && Station.stationOf(a) === 'technik', 'Tab: freie Station wird genommen');
  interior.enterConsole(g, a, 'helm'); a.station = null;
  const e3 = Station.tab(g, b, -1);   // weapons -> helm ist durch a besetzt -> weiter (captain)
  ok(e3 === null && Station.stationOf(b) !== 'helm', 'Tab: von einem Menschen gehaltene Station wird uebersprungen');
  ok(Station.halter(g, 'helm', null) === a, 'der Mensch behaelt seine Station');
}
{
  // 5e Station.tab mit Bots: Meldung nur noch fuer Menschen, Bot-Stationen sind fuer Menschen frei
  const P = partie({ bots: ['ops'] });
  const { g, h } = P;
  lauf(P, 40, () => alleSitzen(P));
  interior.enterConsole(g, h, 'helm');
  const e = Station.tab(g, h, 1);   // helm -> weapons: vom Bot gehalten
  ok(e === null && Station.stationOf(h) === 'weapons' && botVon(P, 'ops').console === null, 'Tab von der Steuer auf Ops: der Bot weicht');
  Station.tab(g, h, 1);   // weapons -> captain
  ok(Station.stationOf(h) === 'captain', 'weiter auf Captain');
  ok(lauf(P, 25, () => Station.stationOf(botVon(P, 'ops')) === 'weapons'), 'der Bot kehrt zurueck, sobald der Mensch Ops verlassen hat (Tab weg)');
}

// ---------- 6 Voller Server ----------
section('6 Voller Server: Mensch tritt bei, der letzte Bot raeumt');
{
  const P = partie({ bots: ['navigation', 'ops', 'technik'] });
  const { g } = P;
  lauf(P, 40, () => alleSitzen(P));
  const technik = botVon(P, 'technik'); const agent = agentVon(P, 'technik');
  ok(g.players.length === 4 && !!agent && technik.console === 'technik', 'Ausgangslage: Server voll, Technik-Bot sitzt');
  const c2 = mensch(g, 9, 3); const h2 = c2.player;
  ok(!!h2 && !h2.bot && h2 === technik && g.players.length === 4, 'der Mensch bekommt den Platz des letzten Bots');
  ok(Lauf.agent(g, technik) === null && Lauf.agenten(g).length === 2, 'Agent des geraeumten Bots entfernt (sofort), zwei Agenten bleiben');
  ok(g.players.every((p) => Station.stationOf(p) !== 'technik'), 'Technik-Station ist frei');
  lauf(P, 3);
  ok(Lauf.agenten(g).length === 2 && !P.spy.some((s) => s.pid === technik.id && s.t > 0 && s.msg.t === 'cmd' && s.t >= g.time - 2.5), 'der geraeumte Bot sendet nichts mehr');
  neben(g, h2, 'technik');
  eTaste(g, c2);
  ok(h2.console === 'technik', 'der neue Mensch besetzt die Technik-Konsole');
  ok(g.errors === 0, 'game.errors 0');
}

// ---------- 7 Automatik-Schwellen ----------
section('7 Automatik-Schwellen');
{
  const C = CONFIG;
  // Vorher-Formeln (Stand be046b1e)
  const koepfe = (pl) => pl.filter((p) => p.connected).length;
  const haelt = (pl, kind) => pl.some((o) => o.connected && o.console && (o.station || o.console) === kind);
  const alt = { waffe: (pl) => koepfe(pl) <= C.waffenAutomatikMaxSpieler && !haelt(pl, 'weapons'), technik: (pl) => koepfe(pl) >= 1 && koepfe(pl) <= C.botAutomatikMaxSpieler };
  let gleich = 0, gesamt = 0;
  for (let k = 1; k <= 4; k++) {
    for (const belegung of [[], ['weapons'], ['technik'], ['helm'], ['weapons', 'technik'], ['captain', 'weapons', 'technik', 'helm']]) {
      const pl = Array.from({ length: k }, (_, i) => ({ id: 'p' + (i + 1), connected: true, console: belegung[i] || null, station: null }));
      const game = { C, players: pl };
      gesamt += 2;
      if (Station.waffenAutomatikAktiv(game) === alt.waffe(pl)) gleich++;
      if (Station.botAutomatikStandard(game) === alt.technik(pl)) gleich++;
      const getrennt = pl.map((p, i) => (i === 0 ? Object.assign({}, p, { connected: false }) : p));   // ein Getrennter zaehlt nicht
      gesamt += 2;
      if (Station.waffenAutomatikAktiv({ C, players: getrennt }) === alt.waffe(getrennt)) gleich++;
      if (Station.botAutomatikStandard({ C, players: getrennt }) === alt.technik(getrennt)) gleich++;
    }
  }
  ok(gleich === gesamt, `reine Menschenpartien (1 bis 4 Spieler, mit/ohne Besetzung, mit Getrennten): waffenAutomatikAktiv und botAutomatikStandard wie vorher (${gleich}/${gesamt})`);
  const bot = (rolle, console) => ({ id: 'b' + rolle, bot: true, rolle, connected: true, console, station: null });
  const mensch1 = (console) => ({ id: 'p1', connected: true, console, station: null });
  ok(Station.waffenAutomatikAktiv({ C, players: [mensch1(null), bot('ops', 'weapons')] }) === false, 'Ops durch einen Bot besetzt: keine Waffenautomatik (2 Koepfe)');
  ok(Station.waffenAutomatikAktiv({ C, players: [mensch1('weapons'), bot('ops', null)] }) === false, 'Ops durch einen Menschen besetzt: keine Automatik');
  ok(Station.waffenAutomatikAktiv({ C, players: [mensch1(null), bot('ops', null)] }) === true, 'Ops unbesetzt, 2 Koepfe: Automatik an wie bisher');
  ok(Station.waffenAutomatikAktiv({ C, players: [mensch1(null), bot('navigation', 'helm'), bot('ops', null)] }) === false, 'Ops unbesetzt, aber 3 Koepfe (Bots zaehlen): keine Automatik wie bisher bei 3 Spielern');
  ok(Station.botAutomatikStandard({ C, players: [mensch1(null), bot('technik', 'technik')] }) === false, 'Technik durch einen Bot besetzt: Standard-Automatik der Schrauber aus (2 Koepfe, sonst an)');
  ok(Station.botAutomatikStandard({ C, players: [mensch1(null), bot('technik', null)] }) === true, 'Technik-Bot noch unterwegs: unbesetzt, entscheidet die Kopfzahl (an bei 2)');
  ok(Station.botAutomatikStandard({ C, players: [mensch1('technik'), bot('ops', null)] }) === true, 'Technik durch einen Menschen: wie bisher nach Koepfen');
  ok(Station.botAutomatikStandard({ C, players: [mensch1(null), bot('navigation', null), bot('ops', null)] }) === false, 'unbesetzt und 3 Koepfe: aus');
  // lebendes Spiel (BOT-01 B3 Nacharbeit, Befund 1): Mensch + Technik-Bot. Der Server-Agent sendet technik.botAuto nie; botAuto folgt botAutomatikStandard (Bot an der Technik: aus, Mensch an der Technik: nach Koepfen)
  const P = partie({ bots: ['technik'] });
  const { g, h, c } = P;
  lauf(P, 40, () => stationVon(P, 'technik') === 'technik'); lauf(P, 4);
  const bid = botVon(P, 'technik').id; const ag = agentVon(P, 'technik');
  const folgtStandard = () => g.ship.botAuto === Station.botAutomatikStandard(g) && !g.ship.botAutoChosen;
  ok(g.ship.botAuto === false && folgtStandard(), 'Spiel: Technik-Bot haelt die Station, botAuto aus (= Standard, nicht gewaehlt)');
  // der Snapshot des Bots zeigt botAuto an (Rest aus der Zeit vor dem Platznehmen): der Testbot haette technik.botAuto { on:false } gesendet und die Wahl fuer die Partie festgeschrieben
  interior.damageSystem(g, 'battery_port', 'broken');
  const tStale = g.time;
  for (let i = 0; i < 12 * CONFIG.tickHz; i++) { tick(P); if (ag.lauf.snap) ag.lauf.snap.ship.botAuto = true; }
  ok(cmds(P, bid, 'technik.botAuto').length === 0 && !g.ship.botAutoChosen, 'Snapshot zeigt botAuto an: der Server-Agent sendet technik.botAuto nie, botAutoChosen bleibt aus');
  ok(cmds(P, bid, 'technik.repair', tStale).some((s) => s.msg.system === 'battery_port') && folgtStandard(), 'er fuehrt die Reparaturliste trotzdem (technik.repair) und botAuto bleibt beim Standard');
  ok(lauf(P, 120, () => g.ship.systems.battery_port !== 'broken'), 'die Schrauber arbeiten den Eintrag ab (battery_port nicht mehr zerstoert)');
  // Mensch uebernimmt die Technik -> Standard nach Koepfen (2 Koepfe: an)
  neben(g, h, 'technik'); eTaste(g, c); lauf(P, 3);
  ok(h.console === 'technik' && botVon(P, 'technik').console === null, 'Mensch uebernimmt die Technik, der Bot weicht');
  ok(g.ship.botAuto === true && folgtStandard(), 'Mensch an der Technik: botAuto = Standard nach Koepfen (an), nicht festgeschrieben');
  g.handleMessage(c, { t: 'leave' });
  ok(lauf(P, 30, () => stationVon(P, 'technik') === 'technik'), 'Mensch geht, der Bot sitzt wieder an der Technik'); lauf(P, 3);
  ok(g.ship.botAuto === false && folgtStandard(), 'Bot wieder an der Technik: botAuto = Standard (aus)');
  ok(cmds(P, bid, 'technik.botAuto').length === 0 && g.errors === 0, 'der Bot hat die ganze Partie lang kein technik.botAuto gesendet, game.errors 0');
  // der Bot raeumt (voller Server, ein zweiter Mensch tritt bei): Standard nach Koepfen (4 Koepfe: aus)
  const Q = partie({ bots: ['navigation', 'ops', 'technik'] });
  lauf(Q, 40, () => alleSitzen(Q)); lauf(Q, 2);
  ok(Q.g.ship.botAuto === false && !Q.g.ship.botAutoChosen, 'drei Bots: botAuto aus, nicht gewaehlt');
  const c2 = mensch(Q.g, 9, 3); lauf(Q, 3);
  ok(c2.player === botVon(Q, 'technik') || !Q.g.players.some((p) => p.bot && p.rolle === 'technik'), 'der Technik-Bot hat geraeumt (der Mensch bekam den Platz)');
  ok(Q.g.ship.botAuto === Station.botAutomatikStandard(Q.g) && !Q.g.ship.botAutoChosen, 'danach folgt botAuto dem Standard nach Koepfen (' + Q.g.ship.botAuto + '), nicht festgeschrieben');
}

// ---------- 8 Pause, Reset, Browser-Schluss ----------
section('8 Pause, „alle weg“, Browser-Schluss: mit drei echten Bots wie ohne');
{
  const menu = (g, c, op, on) => g.handleMessage(c, { t: 'menu', op, on });
  const pauseLauf = (bots) => {
    const P = partie({ bots, start: 'arena_space' }); const { g, c } = P; const log = [];
    lauf(P, 2);
    menu(g, c, 'pause', true); log.push(g.paused);
    const t0 = g.time; ticks(P, 60); log.push(g.time === t0);
    menu(g, c, 'pause', true); log.push(g.paused);
    menu(g, c, 'pause', false); log.push(g.paused);
    ticks(P, 30); log.push(g.time > t0);
    return log;
  };
  const a = pauseLauf([]), b = pauseLauf(['navigation', 'ops', 'technik']);
  ok(JSON.stringify(a) === JSON.stringify([true, true, true, false, true]) && JSON.stringify(a) === JSON.stringify(b), 'Solo-Pause: mit 0 und mit 3 Bots gleich: ' + JSON.stringify(b));
  const schluss = (bots) => {
    const P = partie({ bots }); const { g, c } = P; const log = [];
    lauf(P, 2); menu(g, c, 'pause', true); log.push(g.paused);
    g.removeConnection(c);
    const t0 = g.time; lauf(P, 1);
    log.push(g.paused, g.time > t0, g.emptyFor > 0.9, g.phase);
    lauf(P, 95);
    log.push(g.phase, g.players.length, Lauf.agenten(g).length);
    return log;
  };
  const s0 = schluss([]), s3 = schluss(['navigation', 'ops', 'technik']);
  ok(JSON.stringify(s0) === JSON.stringify(s3), 'Browser-Schluss in der Pause, Weiterlaufen, Leer-Uhr, Reset „alle weg“ nach 90 s: mit 3 Bots wie mit 0: ' + JSON.stringify(s3));
  ok(s3[0] === true && s3[1] === false && s3[2] === true && s3[3] === true && s3[5] === 'lobby' && s3[6] === 0 && s3[7] === 0, 'Pause endet, Zeit laeuft, nach emptyResetAfter Lobby ohne Spieler und ohne Agenten');
  // zerstoertOk: Bots druecken nie OK
  const P = partie({ bots: ['ops'], start: 'freie_fahrt' }); const { g, c } = P;   // ohne Navigation (Notsprung) stirbt die Lerche wie in test-crew-zaehlung
  lauf(P, 2);
  g.ship.docked = false; g.ship.dockedAt = null;
  require('../server/sim/bots.js').setBotAuto(g, false);   // wie test-crew-zaehlung: keine Schrauber-Rettung
  interior.damageSystem(g, 'reactor', 'broken');
  let k = 0; while (!g.ship.schiffZerstoert && k < 30 * 30) { tick(P); k++; }
  ok(!!g.zerstoertOffen && g.snapshot().ship.reaktorTod.wartet === 1, 'Schiff zerstoert: wartet 1 (nur der Mensch), Bots zaehlen nicht');
  g.handleMessage(c, { t: 'menu', op: 'zerstoertOk' });
  ok(g.phase === 'lobby' && Lauf.agenten(g).length === 0, 'der Mensch drueckt OK: Lobby, keine Agenten');
}

// ---------- 9 Telemetrie ----------
section('9 Telemetrie: Bot-Eingaben als Bot-Eingaben erkennbar, Auswertung trennt');
{
  const dir = path.join(TMP, 'tel'); fs.mkdirSync(dir, { recursive: true });
  const P = partie({ bots: ['navigation', 'ops'], env: { TELEMETRIE: 'an', TELEMETRIE_DIR: dir, TELEMETRIE_QUELLE: 'bot' }, wellen: true });
  lauf(P, 70);
  P.g.telemetrie.sessionBeenden('test');
  const datei = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f))[0];
  const zeilen = datei ? fs.readFileSync(datei, 'utf8').split('\n').filter(Boolean).map((z) => JSON.parse(z)) : [];
  const zr = zeilen.filter((z) => z.typ === 'zeitreihe');
  ok(zr.length > 10 && zr.every((z) => Array.isArray(z.bot) && z.bot.join() === 'false,true,true' && z.slots.join() === 'p1,p2,p3'), `Zeitreihe: bot je Slot (false,true,true) in ${zr.length} Fenstern`);
  const summe = (i) => zr.reduce((s, z) => s + z.ein_bew[i] + z.ein_akt[i], 0);
  ok(summe(1) > 0 && summe(2) > 0 && summe(0) === 0, `Eingaben stehen beim Bot-Slot (p2 ${summe(1)}, p3 ${summe(2)}), nicht beim Menschen (p1 ${summe(0)})`);
  const kopf = zeilen.find((z) => z.typ === 'kopf');
  ok(kopf && kopf.slots.filter((s) => s.bot === true).length === 2 && !('bot' in kopf.slots[0]), 'Kopf: slots[].bot nur bei den Bots');
  const pr = Lesen.ausText(zeilen.map((z) => JSON.stringify(z)).join('\n') + '\n');
  const kz = kennzahlen(pr);
  const f4 = kz.f4 || {};
  ok(f4.dabei && f4.dabei.p1 > 0 && !('p2' in f4.dabei) && !('p3' in f4.dabei) && !(f4.leerlauf && (f4.leerlauf.p2 || f4.leerlauf.p3)), 'f4: Menschen (p1) getrennt, Bot-Slots nicht unter dabei/leerlauf');
  ok(f4.bot && f4.bot.dabei && f4.bot.dabei.p2 > 0 && f4.bot.dabei.p3 > 0 && f4.bot.eingaben.p2 > 0 && f4.bot.eingaben.p3 > 0 && f4.bot.rolle.p2.helm > 0 && f4.bot.rolle.p3.weapons > 0, 'f4.bot: Zeit, Rollen (helm, weapons) und Eingaben je Bot-Slot');
  const text = bericht(kz, { svg: 'k.svg' });
  ok(/- Bot p2: dabei/.test(text) && /- Bot p3: dabei/.test(text) && /- p1: dabei/.test(text), 'Bericht: Menschen und Bots in getrennten Zeilen');
  ok(P.g.errors === 0, 'game.errors 0');
}

// ---------- 10 Reine Menschenpartie unveraendert ----------
section('10 Reine Menschenpartie: der Lauf aendert nichts');
{
  const sha = (noop) => {
    const orig = Lauf.tick;
    if (noop) Lauf.tick = () => {};
    const h = crypto.createHash('sha1'); const felder = []; let nSnap = 0;
    try {
      for (const [start, seed, menschen] of [['arena_space', 5, 2], ['m3', 6, 1]]) {
        const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
        const g = new Game({ noStore: true, seed, worldDir: dir, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
        const cs = []; for (let i = 0; i < menschen; i++) { const c = { send: (o) => h.update(JSON.stringify(o)), sendRaw: (s) => h.update(s) }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'M' + i, name: 'M' + i, color: i }); cs.push(c); }
        g.lobbyOpts.startMission = start;
        for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
        for (let i = 0; i < 900; i++) {
          if (i === 100) interior.enterConsole(g, cs[0].player, 'captain');
          if (i === 150) g.handleMessage(cs[0], { t: 'cmd', c: Protocol.CMD_STATION_TAB, dir: 1 });
          if (i === 200 && cs[1]) { interior.enterConsole(g, cs[1].player, 'helm'); g.handleMessage(cs[1], { t: 'cmd', c: Protocol.CMD_STATION_TAB, dir: 1 }); }
          g.step();
          if (g.wantsSnapshot()) { h.update(JSON.stringify(g.snapshot())); nSnap++; }
        }
        h.update(JSON.stringify([g.errors, g.time, g.rng(), g.players.map((p) => [p.x, p.y, p.console, p.station])]));
        felder.push(Object.keys(g).sort().join());
        ok(Lauf.agenten(g).length === 0, `${start}: ohne Bots kein Lauf, keine Agenten`);
      }
    } finally { Lauf.tick = orig; }
    return { hash: h.digest('hex'), nSnap, felder: felder.join('|') };
  };
  const mit = sha(false), ohne = sha(true);
  ok(mit.nSnap > 100 && mit.hash === ohne.hash, `Menschenpartien: Snapshots, Nachrichten, Zufallsstand und Spieler identisch mit echtem und mit leerem Lauf (${mit.nSnap} Snapshots)`);
  ok(mit.felder === ohne.felder, 'kein Feld an game durch den Lauf');
  const mk = () => new Game({ noStore: true, seed: 3, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const g1 = mk(), g2 = mk();
  let gleich = true;
  for (let i = 0; i < 120; i++) { g1.step(); g2.step(); if (g1.wantsSnapshot() && JSON.stringify(g1.snapshot()) !== JSON.stringify(g2.snapshotBauen())) gleich = false; }
  ok(gleich, 'snapshot() liefert byte-gleich den Inhalt von snapshotBauen() (der Lauf nimmt den fuers Broadcast gebauten Snapshot, baut keinen zweiten)');
  let aufrufe = 0; const bauen = g1.snapshotBauen.bind(g1); g1.snapshotBauen = () => { aufrufe++; return bauen(); };
  const P = partie({ bots: ['ops'] }); const gb = P.g; let b2 = 0; const bauen2 = gb.snapshotBauen.bind(gb); gb.snapshotBauen = () => { b2++; return bauen2(); };
  let snaps = 0; for (let i = 0; i < 200; i++) { gb.step(); if (gb.wantsSnapshot()) { gb.snapshot(); snaps++; } }
  ok(b2 === snaps, `mit Bots: ein Snapshot je Broadcast (${b2} Bauten fuer ${snaps} Broadcasts), kein zweiter fuer den Lauf`);
  void aufrufe;
}

// ---------- 11 Lebenszyklus ----------
section('11 Lebenszyklus der Agenten');
{
  const P = partie({ bots: ['navigation', 'ops'], start: false });
  const { g, c } = P;
  for (let i = 0; i < 60; i++) { g.step(); if (g.wantsSnapshot()) g.snapshot(); }
  ok(g.phase === 'lobby' && Lauf.agenten(g).length === 0 && P.spy.length === 0, 'Lobby: keine Agenten, die Bots tun nichts (keine Nachricht)');
  g.lobbyOpts.startMission = 'arena_space'; g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) { g.arena.nextAt = 1e9; }
  lauf(P, 1);
  const erste = Lauf.agenten(g);
  ok(g.phase === 'play' && erste.length === 2, 'Start: je Bot ein Agent');
  lauf(P, 30, () => alleSitzen(P));
  g.zurLobby();
  ok(g.phase === 'lobby' && Lauf.agenten(g).length === 0, 'Partieende (zurueck in die Lobby): Agenten weg');
  const n0 = P.spy.length; for (let i = 0; i < 60; i++) { g.step(); if (g.wantsSnapshot()) g.snapshot(); }
  ok(P.spy.length === n0, 'in der Lobby danach senden die Bots nichts');
  ok(g.players.filter((p) => p.bot).length === 2 && g.players.filter((p) => p.bot).every((p) => p.ready), 'die Bots bleiben auf ihren Plaetzen (ein Mensch ist da), bereit');
  g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = 1e9;
  lauf(P, 1);
  const zweite = Lauf.agenten(g);
  ok(zweite.length === 2 && zweite.every((a) => !erste.includes(a)), 'Neustart: neue Agenten');
  lauf(P, 30, () => alleSitzen(P));
  ok(alleSitzen(P), 'sie laufen wieder zu ihren Konsolen');
  const ops = botVon(P, 'ops');
  ok(Lauf.istServerBot(ops) && !Lauf.istServerBot(Object.assign({}, ops, { rolle: 'bord' })) && !Lauf.istServerBot(P.h), 'Server-Bot: bot, gueltige Rolle, verbunden, Verbindung kennt den Spieler');
  g.endGame();
  lauf(P, 1);
  ok(g.phase === 'end' && Lauf.agenten(g).length === 0, 'Phase end (Kampagnenende): keine Agenten');
  // Bot-Spieler ohne Rolle/ohne conn.player (synthetische Bots wie in test-crew-zaehlung) bekommen keinen Agenten
  const Q = partie({ bots: [], start: false }); const c2 = mensch(Q.g, 4, 2); c2.player.bot = true;
  Q.g.lobbyOpts.startMission = 'arena_space'; Q.g.handleMessage(Q.c, { t: 'ready', ready: true }); lauf(Q, 1);
  ok(Q.g.phase === 'play' && Lauf.agenten(Q.g).length === 0, 'synthetischer Bot ohne Rolle: kein Agent');
  // Befehle-Registry (C2b): navigation 7, ops 6, technik 5, bot 2, bord 3 (Geruest BOT-02 B1); ein Name ohne Eintrag liefert unbekannt
  const r = Befehle.befehl(g, ops, 'ops.quatsch', { id: 'e1' });
  const SOLL = { navigation: 7, ops: 6, technik: 5, bot: 2, bord: 3 };
  ok(r && r.ok === false && r.code === 'unbekannt' && Object.entries(Befehle.REGISTER).every(([rolle, reg]) => Object.keys(reg).length === SOLL[rolle]), 'Registry der Befehle: navigation 7, ops 6, technik 5, bot 2, bord 3 (Geruest, BOT-02 B1); ein unbekannter Name liefert unbekannt');
  ok(Befehle.befehl(g, ops, '__proto__', {}).code === 'unbekannt' && Befehle.befehl(g, null, 'x').code === 'unbekannt', 'unbekannt auch fuer __proto__ und ohne Bot');
  ok(Absicht.ZUSTAENDE.join() === 'unterwegs,an_station,wartet' && Absicht.neueAbsicht('ops').zustand === 'unterwegs', 'Absicht: Zustaende unterwegs, an_station, wartet');
}

// ---------- 12 Quellscan ----------
section('12 Quellscan');
{
  const lies = (f) => fs.readFileSync(f, 'utf8').split(/\r?\n/);
  const botZeilen = (f) => lies(f).map((z, i) => ({ z, i: i + 1 })).filter((x) => /Bot[A-Z]|istBot|\.bot\b/.test(x.z.replace(/\/\/.*$/, '')));
  const st = botZeilen('server/sim/station.js').filter((x) => !/BotWeichen|Crew\.istBot/.test(x.z));
  ok(st.length === 0, 'station.js: Bot-Bezug nur ueber BotWeichen und Crew.istBot in botAutomatikStandard' + (st[0] ? ' – ' + st[0].i + ': ' + st[0].z.trim() : ''));
  ok(lies('server/sim/station.js').filter((z) => /BotWeichen/.test(z)).length === 2 && lies('server/sim/station.js').filter((z) => /Crew\.istBot/.test(z)).length === 1, 'station.js: zwei Zeilen BotWeichen (laden, Tab), eine Zeile Crew.istBot');
  const io = botZeilen('server/sim/interior.js').filter((x) => !/BotWeichen/.test(x.z) && !/\bBots?\b.*(Konsole|haben|keine|Charakterkarte)/.test(x.z));
  ok(io.length === 0, 'interior.js: Bot-Bezug nur ueber BotWeichen' + (io[0] ? ' – ' + io[0].i + ': ' + io[0].z.trim() : ''));
  ok(lies('server/sim/interior.js').filter((z) => /BotWeichen/.test(z)).length === 3, 'interior.js: drei duenne Stellen (Laden, Aktionsliste consoleOccupant, performInteraction)');
  const g = lies('server/game.js').filter((z) => /BotLauf/.test(z));
  ok(g.length === 4, 'game.js: BotLauf an vier Stellen (laden, reset, Tick, snapshot): ' + g.length);
  const kern = lies('server/bots/kern.js').join('\n');
  ok(!/game\.mission|S\.mission\.(stage|objectives|active|flags|choice)|startMission|onEvent/.test(kern) && kern.split('\n').filter((z) => /S\.mission/.test(z)).every((z) => /needsAccept/.test(z)), 'kern.js: keine Missionslogik (nur der bekannte Rest acceptRadio)');
  ok(!/simAgents/.test(kern.replace(/\/\/.*$/gm, '').replace(/kollegen\(\) \{[^}]*\}/, '')) && (kern.match(/simRng\(\)/g) || []).length <= 3, 'kern.js: simAgents nur im Standard von kollegen(), simRng() nur noch im Standard von zufall()');
  const neu = ['server/bots/lauf.js', 'server/bots/mannschaft.js', 'server/bots/weichen.js', 'server/bots/absicht.js'].map((f) => lies(f).join('\n')).join('\n');
  ok(!/Math\.random|simRng|game\.rng/.test(neu.replace(/\/\/.*$/gm, '')), 'Lauf/Mannschaft/Weichen/Absicht: weder Math.random noch der Strom der Simulation (game.rng) noch der Modulhalter des Kerns');
  ok(!/\.filter\([^;\n]*connected[^;\n]*\)\s*\.(length|size)\b/.test(neu), 'keine Zaehlung per filter(connected).length');
  const gespiegelt = lies('server/bots/lauf.js').join('\n');
  ok(!/^(let|var)\s/m.test(gespiegelt) && /new WeakMap\(\)/.test(gespiegelt), 'lauf.js: kein veraenderlicher Modulzustand, Zustand je Game in WeakMap');
  const hatBoolFlag = /\b(function\s+\w+|\w+\s*\()\s*\([^)]*\b(mitBot|nurBot|istBot|botMode|bot)\b\s*[,)=]/.test(neu);
  ok(!hatBoolFlag, 'keine Bot-Flags als Parameter in den neuen Modulen');
}

// ---------- 13 Nacharbeit Befund 2: Marke des Captains ----------
section('13 Ops: die Marke des Captains (captain.anzeigeziel) geht vor');
{
  // die Lanze trifft nur, was auf der Strahllinie liegt: der ferne Gegner (auf der Linie) wird nur getroffen, wenn der Bot ihn waehlt; ohne Marke waehlte der Kern den naeheren
  const P = partie({ bots: ['ops'] });
  lauf(P, 30, () => stationVon(P, 'ops') === 'weapons');
  const { g, h, c } = P;
  interior.enterConsole(g, h, 'captain');
  const nah = [rel(g, 230, 85), rel(g, 250, 95), rel(g, 220, 100)].find((p) => space.inMountArc(g, 'stbd', p.x, p.y) && !space.inMountArc(g, 'bow', p.x, p.y)), fern = rel(g, 450, 0);   // der nahe im Steuerbord-Bogen (Kern: naechster im Bogen), der ferne auf der Strahllinie der Lanze
  const ea = fest(P, 'korvette', nah.x, nah.y); const eb = fest(P, 'korvette', fern.x, fern.y);
  ok(Station.stationOf(h) === 'captain', 'Setup: der Mensch sitzt als Captain');
  g.handleMessage(c, { t: 'cmd', c: 'captain.anzeigeziel', id: eb.id });
  ok(g.ship.capZiel && g.ship.capZiel.id === eb.id && g.ship.target !== eb.id, 'der Captain markiert den ferneren Gegner (ship.capZiel), ship.target bleibt unberuehrt');
  const ib = Testhilfe.gesamtIntegritaet(eb); const t0 = g.time;
  lauf(P, 25, () => Testhilfe.gesamtIntegritaet(eb) < ib);
  const bid = botVon(P, 'ops').id;
  ok(cmds(P, bid, 'weapons.target', t0).some((s) => s.msg.id === eb.id) && g.ship.target === eb.id, 'der Ops-Bot setzt weapons.target auf den markierten (fernen) Gegner');
  ok(Testhilfe.gesamtIntegritaet(eb) < ib, 'die Lanze trifft den markierten Gegner');
  ok(!cmds(P, bid, 'weapons.target', t0).some((s) => s.msg.id === ea.id), 'er schaltet den naeheren nicht auf');
  // die Marke stirbt: Rueckfall auf den Kern (naechster im Bogen)
  g.space.enemies = g.space.enemies.filter((e) => e !== eb); P.fest = P.fest.filter((e) => e !== eb);
  lauf(P, 8);
  ok(!g.ship.capZiel && g.ship.target === ea.id, 'Marke entfaellt (Gegner tot): die Marke ist weg und der Bot nimmt den Gegner im Bogen (Kern)');
  ok(g.errors === 0, 'game.errors 0');
}
{
  // Marke ausser Bogen: der Bot folgt ihr, schiesst aber nicht ins Leere und haengt nicht
  const P = partie({ bots: ['ops'] });
  lauf(P, 30, () => stationVon(P, 'ops') === 'weapons');
  const { g, h, c } = P; interior.enterConsole(g, h, 'captain');
  const arc = (p) => space.inMountArc(g, 'stbd', p.x, p.y) && !space.inMountArc(g, 'bow', p.x, p.y);
  const a = [rel(g, 230, 85), rel(g, 250, 95), rel(g, 220, 100)].find(arc);
  const ea = fest(P, 'korvette', a.x, a.y);
  const hinten = rel(g, 500, 180);
  const eb = fest(P, 'korvette', hinten.x, hinten.y);
  const imBogen = ['bow', 'port', 'stbd'].some((m) => space.inMountArc(g, m, hinten.x, hinten.y));
  g.handleMessage(c, { t: 'cmd', c: 'captain.anzeigeziel', id: eb.id });
  const ia = Testhilfe.gesamtIntegritaet(ea), ib = Testhilfe.gesamtIntegritaet(eb); const t0 = g.time;
  lauf(P, 25);
  const bid = botVon(P, 'ops').id;
  ok(!imBogen && g.ship.target === eb.id, 'Marke ausser Bogen: die Ops folgt ihr (ship.target = markierter Gegner)');
  ok(Testhilfe.gesamtIntegritaet(eb) === ib && !cmds(P, bid, 'weapons.charge', t0).some((s) => s.msg.on === true), 'keine Fehlschuesse: der markierte Gegner ausser Bogen wird nicht beschossen, keine Lanzenladung ins Leere');
  ok(Testhilfe.gesamtIntegritaet(ea) < ia, 'kein Haengenbleiben: die Batterie feuert weiter auf den Gegner im Bogen');
  ok(cmds(P, bid, 'weapons.target', t0).length <= 2, 'kein Hin und Her der Zielwahl (' + cmds(P, bid, 'weapons.target', t0).length + ' weapons.target)');
  ok(g.errors === 0, 'game.errors 0');
  // nicht aufschaltbar (ausser Sensoren): die Marke wird uebergangen statt weapons.target dauernd abgewiesen zu bekommen
  const weit = rel(g, 4000, 10); const ec = fest(P, 'korvette', weit.x, weit.y);
  g.ship.capZiel = { id: ec.id, scene: g.ship.scene };
  const agent = agentVon(P, 'ops'); const S = g.snapshot();
  const gewaehlt = agent.waehleZiel(S, agent.lebende(S), agent.mountsOf(S));
  ok(gewaehlt && gewaehlt.id !== ec.id, 'Marke ausserhalb der Sensoren wird nicht gewaehlt (weapons.target wuerde abgewiesen, fight() haengt sonst)');
}

// ---------- 14 Nacharbeit Befund 3: Navigation bei Aussenteam unten ----------
section('14 Navigation: Aussenteam unten, das Schiff haelt Kurs und Stufe');
{
  const lage = (away, tele) => {
    const P = partie({ bots: ['navigation', 'technik'] });   // BOT-02 B1: ein Technik-Bot haelt den Bord-Dienst, die Navigation bleibt mit Aussenteam unten am Steuer (allein haette sie den Dienst)
    lauf(P, 30, () => stationVon(P, 'navigation') === 'helm' && stationVon(P, 'technik') === 'technik');
    const g = P.g;
    g.ship.helm.stage = 3; g.ship.vx = 0; g.ship.vy = 0;
    const pos = rel(g, 450, 60);
    fest(P, 'korvette', pos.x, pos.y, tele ? { tele: { left: 0.1, sector: 0 } } : undefined);
    if (away) P.h.zone = 'away';
    return P;
  };
  const nav = (P) => botVon(P, 'navigation').id;
  const A = lage(true); const a0 = { x: A.g.ship.x, y: A.g.ship.y, ang: A.g.ship.angle }; const tA = A.g.time;
  lauf(A, 10);
  const helmA = cmds(A, nav(A), 'helm.', tA);
  const dAng = Math.abs(Math.atan2(Math.sin(A.g.ship.angle - a0.ang), Math.cos(A.g.ship.angle - a0.ang)));
  ok(!helmA.some((s) => s.msg.c === 'helm.throttle') && A.g.ship.helm.stage === 3, 'Aussenteam unten: keine Stufenwahl, die Stufe bleibt');
  ok(helmA.every((s) => s.msg.c === 'helm.input' && s.msg.turn === 0 && s.msg.thrust === 0), `nur Kurs halten (helm.input ohne Ruder, ${helmA.length} Befehle), kein Nachsetzen, keine Breitseite`);
  ok(dAng < 0.02, `der Kurs bleibt (${dAng.toFixed(3)} rad), keine Kreise`);
  const dist = Math.hypot(A.g.ship.x - a0.x, A.g.ship.y - a0.y);
  ok(dist > 5 && A.g.errors === 0, `das Schiff driftet nur durch die gehaltene Stufe (${dist.toFixed(0)} px in 10 s)`);
  const B = lage(false); const tB = B.g.time;
  lauf(B, 10);
  ok(cmds(B, nav(B), 'helm.', tB).some((s) => s.msg.c === 'helm.input' && s.msg.turn !== 0), 'Gegenprobe ohne Aussenteam: die Steuer manoevriert im Gefecht wie bisher (Ruder ungleich 0)');
  const D = lage(true, true); const tD = D.g.time;
  lauf(D, 4);
  ok(cmds(D, nav(D), 'helm.dodge', tD).length > 0, 'Aussenteam unten: Ausweichen vor einer Ladung bleibt erlaubt (helm.dodge)');
  // ein Bot im Aussenteam zaehlt wie ein Mensch
  const E = partie({ bots: ['navigation', 'ops'] });
  lauf(E, 40, () => alleSitzen(E)); E.g.ship.helm.stage = 3;
  const pe = E.g.ship.helm; const eg = rel(E.g, 450, 60); fest(E, 'korvette', eg.x, eg.y);
  botVon(E, 'ops').zone = 'away'; const tE = E.g.time;
  lauf(E, 5);
  ok(!cmds(E, nav(E), 'helm.', tE).some((s) => s.msg.turn !== 0), 'ein Bot im Aussenteam haelt die Navigation ebenso zurueck');
}

// ---------- 15 Nacharbeit Befund 4 und 5: Wachposten ----------
section('15 Wachposten: jede Nachricht eines Server-Agenten geht durch ihn');
{
  const P = partie({ bots: ['navigation', 'ops', 'technik'], wellen: true });
  lauf(P, 40, () => alleSitzen(P));
  const agent = agentVon(P, 'navigation');
  const spyN = () => P.spy.length;
  const verboten = [
    { t: 'hello', clientId: 'x', name: 'x', color: 0 }, { t: 'ready', ready: true }, { t: 'cmd', c: 'captain.anzeigeziel', id: 'e1' }, { t: 'cmd', c: 'captain.scan' },
    { t: 'debug' }, { t: 'shoot' }, { t: 'mark' }, { t: 'cmd', c: 'weapons.fire', mount: 'all' }, { t: 'cmd', c: 'technik.shield', sector: 0, delta: 1 },
    { t: 'schubs' }, { t: 'menu', op: 'pause', on: true }, { t: 'world' }, { t: 'lobbyBot' }, { t: 'lobbyOpt' }, { t: 'cmd' }, { t: 'cmd', c: 42 }, null, {},
  ];
  const v0 = agent.verworfen; const n0 = spyN(); const b0 = agent.befehle;
  const gesperrt = verboten.filter((m) => agent.erlaubt(m) === false).length;
  for (const m of verboten) agent.send(m);
  ok(gesperrt === verboten.length, `erlaubt() weist alle ${verboten.length} verbotenen Nachrichten ab (${gesperrt})`);
  ok(agent.verworfen - v0 === verboten.length && spyN() === n0 && agent.befehle === b0, `send() verwirft sie und zaehlt verworfen (${agent.verworfen - v0}), nichts erreicht handleMessage, kein Befehl gezaehlt`);
  agent.verworfen = 0;
  const erlaubt = [{ t: 'input', seq: 1, mx: 0, my: 0 }, { t: 'act', down: false }, { t: 'leave' }, { t: 'drop' }, { t: 'cmd', c: 'helm.input', turn: 0, thrust: 0 }, { t: 'cmd', c: Protocol.CMD_STATION_TAB, dir: 1 }];
  ok(erlaubt.every((m) => agent.erlaubt(m) === true), 'erlaubt() laesst Eingabe, Aktion, leave, drop, Befehle der eigenen Station und Tab durch');
  // Spion: jede Nachricht eines Agenten an game.handleMessage wurde vom Wachposten freigegeben und gezaehlt (auch das Stufenhalten vor leave)
  const frei = new Map(); const orig = new Map();
  for (const a of Lauf.agenten(P.g)) { frei.set(a.spieler.id, 0); orig.set(a, a.erlaubt.bind(a)); a.erlaubt = (m) => { const r = orig.get(a)(m); if (r) frei.set(a.spieler.id, frei.get(a.spieler.id) + 1); return r; }; }
  const s0 = P.spy.length; const befehle0 = new Map(Lauf.agenten(P.g).map((a) => [a.spieler.id, a.befehle]));
  lauf(P, 75);
  P.g.ship.helm.stage = 3; const sL = P.spy.length;
  agent.send({ t: 'leave' });   // Steuer verlassen: vorher stellt der Kern auf STOPP (helm.throttle)
  const neu = P.spy.slice(s0);
  const throttle = P.spy.slice(sL).filter((s) => s.pid === agent.spieler.id && s.msg.c === 'helm.throttle');
  ok(throttle.length === 1 && throttle[0].msg.set === 1 && P.g.ship.helm.stage === 1, 'Steuer verlassen: das Stufenhalten (helm.throttle STOPP) wird gesendet');
  let alle = true;
  for (const a of Lauf.agenten(P.g)) {
    const mine = neu.filter((s) => s.pid === a.spieler.id); const cm = mine.filter((s) => s.msg.t === 'cmd').length;
    if (mine.length !== frei.get(a.spieler.id) || a.befehle - befehle0.get(a.spieler.id) !== cm) alle = false;
  }
  ok(neu.length > 50 && alle, `jede Nachricht der drei Agenten an handleMessage (${neu.length}) wurde vom Wachposten freigegeben, der Zaehler befehle gleicht den gesendeten cmd`);
  ok(Lauf.agenten(P.g).every((a) => a.verworfen === 0), 'die Agenten selbst senden nichts Verbotenes (verworfen 0)');
  // Verbietet der Wachposten das Stufenhalten, erreicht es handleMessage nicht
  agent.erlaubt = (m) => !(m.t === 'cmd' && m.c === 'helm.throttle') && orig.get(agent)(m);
  lauf(P, 30, () => botVon(P, 'navigation').console === 'helm');
  P.g.ship.helm.stage = 3; const vv = agent.verworfen; const sn = spyN();
  ok(botVon(P, 'navigation').console === 'helm', 'Setup: der Navigations-Bot sitzt wieder an der Steuer');
  agent.send({ t: 'leave' });
  ok(agent.verworfen === vv + 1 && !P.spy.slice(sn).some((s) => s.msg.c === 'helm.throttle'), 'ein vom Wachposten abgewiesenes Stufenhalten erreicht handleMessage nicht');
  ok(P.g.errors === 0, 'game.errors 0');
}

// ---------- 16 Nacharbeit Testluecke (f): Mensch haelt die Station ueber Zeit ----------
section('16 Mensch haelt die Station, der Bot bleibt wartend');
{
  const P = partie({ bots: ['navigation', 'ops'] });
  const { g, h, c } = P;
  lauf(P, 40, () => alleSitzen(P));
  const nav = botVon(P, 'navigation'); const ag = agentVon(P, 'navigation');
  neben(g, h, 'helm'); eTaste(g, c);
  ok(h.console === 'helm' && ag.absicht.zustand === 'wartet', 'Mensch sitzt an der Steuer, der Bot wartet');
  const t0 = g.time; let immer = true, nie = true;
  for (let i = 0; i < 12 * CONFIG.tickHz; i++) { tick(P); if (ag.absicht.zustand !== 'wartet') immer = false; if (nav.console === 'helm') nie = false; }
  ok(immer, 'ueber 12 s Tick fuer Tick: Zustand bleibt wartet (nicht unterwegs)');
  ok(nie && h.console === 'helm', 'der Bot nimmt dem Menschen die Steuer nicht ab');
  ok(P.spy.filter((s) => s.pid === nav.id && s.t > t0).length === 0, 'der Bot sendet in der Zeit nichts (auch kein input, act, leave)');
  g.handleMessage(c, { t: 'leave' });
  ok(lauf(P, 30, () => nav.console === 'helm') && lauf(P, 1) && ag.absicht.zustand === 'an_station', 'erst nach Verlassen uebernimmt der Bot wieder (an_station)');
}

// ---------- 17 Nacharbeit Testluecke (g): Stale-Schutz ----------
section('17 Stale-Schutz: ein zu alter Snapshot wird nicht bearbeitet');
{
  const P = partie({ bots: ['technik'] });
  const { g } = P;
  lauf(P, 40, () => stationVon(P, 'technik') === 'technik'); lauf(P, 2);
  const ag = agentVon(P, 'technik'); const bid = botVon(P, 'technik').id;
  interior.damageSystem(g, 'battery_port', 'broken');
  const basis = JSON.parse(JSON.stringify(g.snapshot()));
  const mk = (tickAbstand) => { const S = JSON.parse(JSON.stringify(basis)); S.tick = g.tick - tickAbstand; S.time = g.time + 10; return S; };
  const n0 = P.spy.length;
  ag.tick(mk(7)); ag.tick(mk(50));
  ok(P.spy.length === n0, 'Snapshot aelter als 6 Ticks: der Agent handelt nicht (keine Nachricht)');
  ag.tick(mk(6));
  ok(P.spy.slice(n0).some((s) => s.pid === bid && s.msg.c === 'technik.repair' && s.msg.system === 'battery_port'), 'Snapshot genau an der Grenze (6 Ticks) und aktuell: der Agent handelt (technik.repair)');
}

console.log(fails ? `\ntest-bot-lauf: ${fails} FEHLER von ${n}` : `\ntest-bot-lauf: ${n}/${n} ok`);
process.exit(fails ? 1 : 0);
