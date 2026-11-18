'use strict';
// BOT-01 A1: zentrale Zählung der Mannschaft (server/sim/crew.js, Vertrag Bot-Befehle §2). Ohne Bots ändert sich nichts, drei Bots ändern bei den
// MENSCHEN-Regeln (Pause, Reset, Browser-Schluss, zerstoertOk, Kontingent) nichts.
//  1. Funktionen: menschen / koepfe / verbundene / istBot, tolerant (ohne Feld bot, ohne players)
//  2. Echtes Game, je mit 0 und mit 3 Bots (synthetische Spieler `bot = true`): Solo-Pause, Reset bei „alle weg“, Weiterlaufen bei Browser-Schluss
//  3. zerstoertOk: Bots drücken nie OK, die Einblendung schließt, wenn alle Menschen bestätigt haben
//  4. Kontingent: die Frage geht an den Menschen mit Farbe 0, nie an einen Bot (Grenze: hat ein Bot Farbe 0, gibt es keine Frage; Paket B verhindert das über die Farbvergabe)
//  5. Snapshot: `bot: 1` nur bei Bots; Client-Helfer menschenZahl; Telemetrie-Kopf
//  6. Quellscan (Boundary-Regel): keine Zählung per `.filter(... connected ...).length` außerhalb von server/sim/crew.js; NOCH_OFFEN = Dateien, die Paket A2 umstellt
//   node tools/test-crew-zaehlung.js
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const { Game } = require('../server/game.js');
const Crew = require('../server/sim/crew.js');
const Kontingent = require('../server/sim/kontingent.js');
const I = require('../server/sim/interior.js');
const BOTS = require('../server/sim/bots.js');
const Protocol = require('../shared/protocol.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-crew-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
let seq = 0;

// ---------- 1 Funktionen ----------
section('1 Funktionen');
{
  const mensch = (id, c) => ({ id, connected: c !== false });
  const bot = (id) => ({ id, bot: true, connected: true });
  const rein = { players: [mensch('p1'), mensch('p2'), mensch('p3', false)] };
  ok(Crew.menschen(rein) === 2 && Crew.koepfe(rein) === 2 && Crew.verbundene(rein).length === 2, 'reine Menschen: menschen == koepfe == 2 (ein Getrennter zählt nicht)');
  const mit = { players: [bot('b1'), mensch('p1'), bot('b2'), bot('b3')] };
  ok(Crew.menschen(mit) === 1 && Crew.koepfe(mit) === 4 && Crew.koepfe(mit) === Crew.menschen(mit) + 3, 'mit 3 Bots: koepfe = menschen + 3');
  ok(Crew.verbundene(mit).length === 4 && Crew.istBot(mit.players[0]) && !Crew.istBot(mit.players[1]), 'verbundene, istBot');
  const nurBots = { players: [bot('b1'), { id: 'b2', bot: true, connected: false }] };
  ok(Crew.menschen(nurBots) === 0 && Crew.koepfe(nurBots) === 1, 'nur Bots: menschen 0, getrennter Bot zählt nicht');
  ok(Crew.menschen({}) === 0 && Crew.koepfe({}) === 0 && Crew.menschen(null) === 0 && Crew.verbundene(undefined).length === 0, 'tolerant: ohne players, ohne game');
  ok(!Crew.istBot(null) && !Crew.istBot({}) && !Crew.istBot({ bot: false }), 'istBot: ohne Feld oder false kein Bot');
  ok(typeof Game.prototype.connectedCount === 'undefined' && typeof require('../server/sim/station.js').verbunden === 'undefined', 'connectedCount() und Station.verbunden() gibt es nicht mehr');
}

// ---------- Aufbau eines echten Games ----------
// menschen echte Clients, bots synthetische Bot-Spieler (eigene Fake-Verbindung, nie OK/Eingaben)
const mkConn = () => ({ inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } });
function setup(menschen, bots) {
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const conns = [], botConns = [];
  for (let i = 0; i < menschen; i++) { const c = mkConn(); g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'K' + i, color: i }); conns.push(c); }
  for (let i = 0; i < bots; i++) {
    const c = mkConn(); g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'B' + i, name: 'B' + i, color: menschen + i });
    c.player.bot = true; c.player.botId = 'b' + i; botConns.push(c);
  }
  g.handleMessage(conns[0], { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  for (const c of conns.concat(botConns)) g.handleMessage(c, { t: 'ready', ready: true });
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
  run(1); g.space.enemies = [];
  BOTS.setBotAuto(g, false);
  return { g, run, conns, botConns };
}
const menu = (g, c, op, on) => g.handleMessage(c, { t: 'menu', op, on });

// ---------- 2 Solo-Pause, Reset, Browser-Schluss ----------
section('2 Solo-Pause, „alle weg“, Browser-Schluss: mit 3 Bots exakt wie mit 0');
function pauseLauf(bots, zweiter) {
  const s = setup(1, bots), g = s.g, log = [];
  ok(g.phase === 'play' && Crew.koepfe(g) === 1 + bots && Crew.menschen(g) === 1, `[${bots} Bots] Partie läuft, ${Crew.menschen(g)} Mensch, ${Crew.koepfe(g)} Köpfe`);
  menu(g, s.conns[0], 'pause', true);
  log.push(g.paused);
  const t0 = g.time; s.run(2); log.push(g.time === t0);
  if (zweiter) {   // zweiter Mensch beendet die Pause (S1 §6); mit 3 Bots ist die Partie voll (4 Plätze), dort läuft dieser Schritt mit 2 Bots
    const c2 = mkConn();
    g.addConnection(c2); g.handleMessage(c2, { t: 'hello', clientId: 'K9', name: 'K9', color: 3 });
    log.push(g.paused); const t1 = g.time; s.run(1); log.push(g.time > t1);
    g.removeConnection(c2);
  }
  menu(g, s.conns[0], 'pause', true); log.push(g.paused);   // wieder genau ein Mensch: Pause geht
  menu(g, s.conns[0], 'pause', false); log.push(g.paused);
  return log;
}
{
  const a = pauseLauf(0, true), b = pauseLauf(2, true), c = pauseLauf(0, false), d = pauseLauf(3, false);
  ok(JSON.stringify(a) === JSON.stringify([true, true, false, true, true, false]), 'ohne Bots: Pause an, Zeit steht, 2. Mensch hebt auf, Zeit läuft, Pause wieder an/aus: ' + JSON.stringify(a));
  ok(JSON.stringify(a) === JSON.stringify(b), 'mit 2 Bots identisch (2. Mensch beendet die Pause): ' + JSON.stringify(b));
  ok(JSON.stringify(c) === JSON.stringify([true, true, true, false]) && JSON.stringify(c) === JSON.stringify(d), 'mit 3 Bots identisch zu 0 Bots (Pause an, Zeit steht, Pause an/aus): ' + JSON.stringify(d));
}
function browserSchluss(bots) {
  const s = setup(1, bots), g = s.g, log = [];
  menu(g, s.conns[0], 'pause', true); log.push(g.paused);
  g.removeConnection(s.conns[0]);   // Browser des Menschen schließt in der Solo-Pause
  const t0 = g.time; s.run(1);
  log.push(g.paused, g.time > t0, g.emptyFor > 0.9, g.phase);   // die Pause hebt sich auf, die Zeit läuft, die Leer-Uhr tickt
  s.run(95);   // emptyResetAfter 90 s: Reset, auch wenn Bots noch „verbunden“ sind
  log.push(g.phase, g.players.length);
  return log;
}
{
  const a = browserSchluss(0), b = browserSchluss(3);
  ok(a[0] === true && a[1] === false && a[2] === true && a[3] === true, 'ohne Bots: Browser-Schluss hebt die Pause auf, Zeit läuft, Leer-Uhr tickt: ' + JSON.stringify(a.slice(0, 4)));
  ok(a[4] === 'play' && a[5] === 'lobby' && a[6] === 0, 'ohne Bots: nach emptyResetAfter Reset in die Lobby, keine Spieler: ' + JSON.stringify(a.slice(4)));
  ok(JSON.stringify(a) === JSON.stringify(b), 'mit 3 Bots identisch (Weiterlaufen, Leer-Uhr, Reset „alle weg“): ' + JSON.stringify(b));
}

// ---------- 3 zerstoertOk ----------
section('3 zerstoertOk: Bots drücken nie OK');
function tod(menschen, bots) {
  const s = setup(menschen, bots), g = s.g;
  g.ship.docked = false; g.ship.dockedAt = null;
  I.damageSystem(g, 'reactor', 'broken');
  let k = 0; while (!g.ship.schiffZerstoert && k < 30 * 30) { g.step(); k++; }
  const snap = () => g.snapshot().ship.reaktorTod;
  return { s, g, snap, tot: !!g.ship.schiffZerstoert && !!g.zerstoertOffen };
}
{
  const { s, g, snap, tot } = tod(1, 3);
  ok(tot, 'Reaktor tot, Einblendung gelatcht (1 Mensch, 3 Bots)');
  ok(snap().wartet === 1, `Snapshot wartet ${snap().wartet} (Soll 1: nur der Mensch)`);
  menu(g, s.conns[0], 'zerstoertOk');
  ok(g.phase === 'lobby' && !g.zerstoertOffen, `Mensch gibt OK: Einblendung schließt, Lobby (phase ${g.phase})`);
}
{
  const { s, g, snap } = tod(2, 2);
  ok(snap().wartet === 2, `2 Menschen + 2 Bots: wartet ${snap().wartet} (Soll 2)`);
  menu(g, s.conns[0], 'zerstoertOk');
  ok(g.phase !== 'lobby' && snap().wartet === 1, 'nach dem OK von A: wartet 1, Partie steht noch');
  menu(g, s.conns[1], 'zerstoertOk');
  ok(g.phase === 'lobby', 'nach dem OK von B: Lobby');
}
{
  const { s, g } = tod(1, 3);
  g.removeConnection(s.conns[0]);
  ok(g.phase !== 'lobby' && !!g.zerstoertOffen, 'ohne verbundenen Menschen bleibt der Tod stehen (wie ohne Bots; Bots allein beenden nichts)');
}

// ---------- 4 Kontingent ----------
section('4 Kontingent: Frage an den Menschen mit Farbe 0');
{
  const gesendet = [];
  const spiel = (spieler) => ({ phase: 'play', env: { SPIELLEITER_LLM: 'live', LLM_LIVE: '1' }, kontingent: { frage: { offen: true } }, players: spieler, sendTo(conn, m) { gesendet.push({ conn: conn.name, m }); } });
  const sp = (id, color, o) => Object.assign({ id, color, connected: true, conn: { name: id } }, o);
  const botVorn = sp('b1', 1, { bot: true }), mensch = sp('p1', 0), bot0 = sp('b2', 0, { bot: true });
  gesendet.length = 0;
  ok(Kontingent.frageZustellen(spiel([botVorn, mensch])) === true && gesendet.length === 1 && gesendet[0].conn === 'p1' && gesendet[0].m.pid === 'p1', 'Bot zuerst im Array (Farbe 1), Mensch Farbe 0: die Frage geht an den Menschen');
  gesendet.length = 0;
  ok(Kontingent.frageZustellen(spiel([bot0, sp('b3', 2, { bot: true })])) === false && gesendet.length === 0, 'nur Bots, einer mit Farbe 0: keine Frage (bekannte Grenze: Paket B vergibt Farbe 0 nie an einen Bot)');
  gesendet.length = 0;
  ok(Kontingent.frageZustellen(spiel([bot0, sp('p2', 1)])) === false && gesendet.length === 0, 'Bot hat Farbe 0, Mensch Farbe 1: keine Frage (bekannte Grenze, siehe oben)');
  gesendet.length = 0;
  ok(Kontingent.frageZustellen(spiel([mensch]), bot0) === false && gesendet.length === 0, 'explizit für einen Bot mit Farbe 0 (nach dem welcome): keine Frage');
  gesendet.length = 0;
  ok(Kontingent.frageZustellen(spiel([sp('p1', 0), sp('p2', 1)])) === true && gesendet.length === 1 && gesendet[0].conn === 'p1', 'reine Menschen: unverändert, die Frage geht an Farbe 0');
}

// ---------- 5 Snapshot, Client-Helfer, Telemetrie ----------
section('5 Snapshot, Client-Helfer, Telemetrie');
{
  const mit = setup(1, 3), ohne = setup(2, 0);
  const sm = mit.g.snapshot().players, so = ohne.g.snapshot().players;
  ok(sm.filter((p) => p.bot === 1).length === 3 && sm.filter((p) => 'bot' in p).length === 3 && !('bot' in sm[0]), 'Snapshot: bot: 1 nur bei den 3 Bots');
  ok(so.every((p) => !('bot' in p)) && !JSON.stringify(ohne.g.snapshot()).includes('"bot"'), 'reine Menschenpartie: kein Feld bot im Snapshot (byte-gleich)');
  ok(Protocol.menschenZahl({ players: [{ connected: true }, { connected: true, bot: 1 }, { connected: false }, { bot: 1 }] }) === 1 && Protocol.menschenZahl({ players: [{}, {}] }) === 2 && Protocol.menschenZahl({}) === 0 && Protocol.menschenZahl(null) === 0, 'menschenZahl(state): Verbundene ohne bot (connected fehlt zählt als verbunden)');
  const Kopf = require('../server/telemetrie/kopf.js');
  const kopfVon = (g) => Kopf.baueKopf(g, { tuning: Kopf.tuningStand(g), quelle: 'mensch' });
  const k = kopfVon(mit.g), k0 = kopfVon(ohne.g);
  ok(k.slots.filter((x) => x.bot === true).length === 3 && k.slots.length === 4, 'Kopf: Slots der Bots tragen bot: true');
  ok(k0.slots.every((x) => !('bot' in x)), 'Kopf reiner Menschenpartie: kein Feld bot an den Slots');
}

// ---------- 6 Quellscan ----------
section('6 Quellscan: Zählung nur in crew.js');
{
  // Zählungen per .filter(...connected...).length / .size. Einzelprüfungen (p.zone === 'away' && p.connected) bleiben erlaubt.
  const ZAEHLUNG = /\.filter\([^;\n]*connected[^;\n]*\)\s*\.(length|size)\b|connectedCount|Station\.verbunden\b/;
  // Dateien, die Paket A2 auf crew.koepfe() / crew.menschen() umstellt; A2 leert diese Liste
  const NOCH_OFFEN = ['server/mission/registry.js', 'server/mission/spielleiter.js', 'server/sim/combat.js', 'server/sim/escort.js', 'server/sim/faden-szene.js', 'server/sim/finale-boden.js', 'server/sim/flotte.js', 'server/sim/interior.js', 'server/sim/kriegslage-szene.js', 'server/sim/lage-ausschnitt.js', 'server/sim/loadout.js', 'server/sim/mission.js', 'server/sim/reise-ereignis.js', 'server/sim/reise.js', 'server/sim/space.js', 'server/sim/squad.js'];
  const dateien = [];
  (function lauf(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) lauf(p); else if (e.name.endsWith('.js')) dateien.push(p.split(path.sep).join('/')); } })('server');
  const treffer = (f) => fs.readFileSync(f, 'utf8').split(/\r?\n/).map((z, i) => (ZAEHLUNG.test(z) ? i + 1 : 0)).filter(Boolean);
  const scharf = dateien.filter((f) => f !== 'server/sim/crew.js' && !NOCH_OFFEN.includes(f));
  const verstoesse = scharf.filter((f) => treffer(f).length).map((f) => f + ':' + treffer(f).join(','));
  ok(scharf.length > 20 && verstoesse.length === 0, `server/ (ohne crew.js und NOCH_OFFEN): keine Zählung per filter(connected).length${verstoesse.length ? ' – ' + verstoesse.join(' ') : ''}`);
  ok(['server/game.js', 'server/sim/station.js', 'server/sim/kontingent.js', 'server/telemetrie/protokoll.js', 'server/telemetrie/gefecht.js'].every((f) => scharf.includes(f)), 'game.js, station.js, kontingent.js, telemetrie/ sind scharf');
  const veraltet = NOCH_OFFEN.filter((f) => !fs.existsSync(f) || !treffer(f).length);
  ok(veraltet.length === 0, `NOCH_OFFEN enthält nur Dateien mit offener Zählung (A2 entfernt umgestellte)${veraltet.length ? ': ' + veraltet.join(' ') : ''}`);
  const alt = /\.filter\(\(?\w+\)? => \w+\.connected !== false\)\.length/;
  const client = ['public/js/client.js', 'public/js/hud.js', 'public/js/dev-mock.js'].filter((f) => fs.readFileSync(f, 'utf8').split(/\r?\n/).some((z) => alt.test(z)));
  ok(client.length === 0, 'Client (client.js, hud.js, dev-mock.js): Pause/Solo zählt über menschenZahl' + (client.length ? ': ' + client.join(' ') : ''));
}

console.log(`\ntest-crew-zaehlung: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
