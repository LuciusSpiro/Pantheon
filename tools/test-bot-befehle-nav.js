'use strict';
// BOT-01 C2a: die Navigations-Befehle des Katalogs v1 wirken im Server-Bot (server/bots/befehle/navigation.js, Ausfuehrung im Agenten mannschaft.js, Ziele navziel.js). Echtes Game, Server-Bots, Befehle ueber bot.befehl.
//   1. Registry: sieben Befehle, Rueckgabe { ok } / { ok:false, code } mit Codes aus gruende.json
//   2. nav.schub: Stufe setzen und halten (rueckwaerts, viertel, halb, dreiviertel, voll), auch im Gefecht; rueckwaerts faehrt wirklich rueckwaerts
//   3. nav.stopp und nav.ausweichen
//   4. nav.kurs (marke, ziel, objekt, basis): das Schiff kommt an (je zwei Seeds und Ausgangslagen), steht danach; Ziel verschwindet: Bot haelt an; kein_ziel
//   5. nav.abstand: haelt den Abstand ueber eine Wartezeit (Gegner: Breitseite, Station: fester Punkt), Standardwerte (Captain-Marke, dann Ops-Marke), kein_ziel
//   6. nav.andocken: Anflug und Andocken (zwei Ausgangslagen), kein_ziel ohne Dock, schon angedockt
//   7. nav.sprung: nur ziel marke (Wahl des Captains bleibt), hex/ziel/basis/objekt kein_ziel ohne Spielzustand; Sprung, Route; Stoersender/Transfer/Reise bei Annahme; Absicht endet bei Blockade und gekipptem Ziel
//   8. Ablehnungen: nicht_jetzt (Aussenteam unten: nur Stopp), system (Antrieb zerstoert), wartet (Mensch an der Steuer), jede Antwort mit passender textId
//   9. Mensch gewinnt: Absicht verworfen, Bot sendet nichts, Bot uebernimmt im Standardverhalten; Notsprung hat Vorrang; Aussenteam beendet jede Absicht (auch Schub); ein anderer Befehl ersetzt den Kurs
//  10. Absicht endet bei downed, Bot nicht an Bord, Szenenwechsel (auch Schub); Ausweichen im Befehl
//  11. Reine Menschenpartie: kein Bot-Code laeuft (der Byte-Vergleich ist der Golden-Lauf), Quellscan der Registries, Wachposten, Projektil-Reflex synchron
//   node tools/test-bot-befehle-nav.js
//   Mutationsproben: BOT_NAV_MUT=<name> node tools/test-bot-befehle-nav.js (muss rot sein, Namen und Wirkung in tools/mutation-bot-befehle-nav.js)
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
process.chdir(path.join(__dirname, '..'));
const { Game } = require('../server/game.js');
const Station = require('../server/sim/station.js');
const interior = require('../server/sim/interior.js');
const space = require('../server/sim/space.js');
const Sprung = require('../server/sim/sprung.js');
const W = require('../server/world.js');
const BotSpieler = require('../server/bots/spieler.js');
const Lauf = require('../server/bots/lauf.js');
const Navziel = require('../server/bots/navziel.js');
const { BotMannschaft } = require('../server/bots/mannschaft.js');
const Befehle = require('../server/bots/befehle/index.js');
const { STOP, QUARTER, HALF, THREEQ, FULL } = require('../server/bots/kern.js');
const GRUENDE = require('../content/bots/gruende.json');

const MUT = process.env.BOT_NAV_MUT || '';
if (MUT === 'mensch') { for (const k of ['befehlVerwerfen', 'alleVerwerfen']) { const alt = BotMannschaft.prototype[k]; BotMannschaft.prototype[k] = function (grund) { return grund === 'mensch' ? false : alt.call(this, grund); }; } }   // seit C2b geht die Menschenuebernahme ueber alleVerwerfen
if (MUT === 'kein_ziel') Navziel.aufloesen = () => ({ art: 'objekt', id: 'gibtsnicht' });
if (MUT === 'abstand') BotMannschaft.prototype.abstandAusfuehren = function () { return true; };
if (MUT === 'schub_ohne_fels') BotMannschaft.prototype.schubHalten = function (S) { this.ausweichenImBefehl(S); this.helmS(S, this.turnCmd(S, this.randNachMitte(S)), this.absicht.befehl.stage); };   // der alte Stand: kein Felsen-Ausweichen
if (MUT === 'schub_rueckwaerts_wie_viertel') { const reg = require('../server/bots/befehle/navigation.js'); const alt = reg['nav.schub']; reg['nav.schub'] = (game, bot, args) => alt(game, bot, args.stufe === 'rueckwaerts' ? Object.assign({}, args, { stufe: 'viertel' }) : args); }   // BOT-01 D: rueckwaerts landet auf der falschen Stufe
if (MUT === 'schub_rueckwaerts_vom_bug') { const alt = BotMannschaft.prototype.schubHalten; BotMannschaft.prototype.schubHalten = function (S) { const b = this.absicht.befehl; if (b.stage < STOP) { this.ausweichenImBefehl(S); this.helmS(S, 0, b.stage); return; } return alt.call(this, S); }; }   // BOT-01 D: rueckwaerts ohne Felsen- und Randsicht vom Heck
if (MUT === 'wachposten_auf') BotMannschaft.prototype.erlaubt = function () { return true; };
if (MUT === 'ausweichen_im_befehl_raus') BotMannschaft.prototype.ausweichenImBefehl = function () { /* kein Ausweichen im Befehl */ };
if (MUT === 'sprung_blockiert_raus') { const alt = BotMannschaft.prototype.sprungAusfuehren; BotMannschaft.prototype.sprungAusfuehren = function (S, b) { const j = this.game.ship.jump; const g0 = j.blockedReason; try { j.blockedReason = null; return alt.call(this, S, b); } finally { j.blockedReason = g0; } }; }
if (MUT === 'schub_aussenteam') { const alt = BotMannschaft.prototype.steuerDienst; BotMannschaft.prototype.steuerDienst = function (S, p) { const b = this.absicht.befehl; if (b && b.name === 'nav.schub') { const au = this.aussenteamUnten; this.aussenteamUnten = () => false; try { return alt.call(this, S, p); } finally { this.aussenteamUnten = au; } } return alt.call(this, S, p); }; }
if (MUT === 'sprung_hex') { const reg = require('../server/bots/befehle/navigation.js'); const alt = reg['nav.sprung']; reg['nav.sprung'] = (game, bot, args) => { const m = /^hex:([0-9]{4})$/.exec(args.ziel || ''); if (m) { Sprung.selectDest(game, m[1]); return alt(game, bot, { ziel: 'marke' }); } return alt(game, bot, args); }; }
if (MUT === 'jammer_reise_raus') { const reg = require('../server/bots/befehle/navigation.js'); const alt = reg['nav.sprung']; reg['nav.sprung'] = (game, bot, args) => { const r0 = game.reise, ja = Sprung.jammersPresent, ib = game.transfer.isBeaming; game.reise = null; Sprung.jammersPresent = () => false; game.transfer.isBeaming = () => false; try { return alt(game, bot, args); } finally { game.reise = r0; Sprung.jammersPresent = ja; game.transfer.isBeaming = ib; } }; }

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-botnav-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
let seq = 0;
const ALLE = [];   // jede Partie des Tests: am Ende muss der Wachposten keine Nachricht eines Bots abgewiesen haben (verworfen === 0)

// ---------- Aufbau ----------
const mkConn = () => ({ inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } });
// o.start: arena_space (Gegner nur die gesetzten) | free (Freie Fahrt, angedockt im Hafen); o.seed
function partie(o) {
  o = o || {};
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: o.seed || 7, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  g.botZufall = (() => { let a = 42; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const spy = []; const echt = g.handleMessage.bind(g);
  g.handleMessage = (conn, msg) => { if (conn && conn.bot) spy.push({ pid: conn.player ? conn.player.id : null, msg, t: g.time }); return echt(conn, msg); };
  const c = mkConn(); g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'K0', color: 0 });
  BotSpieler.botHinzufuegen(g, null, 'navigation');
  BotSpieler.botHinzufuegen(g, null, 'technik');   // BOT-02 B1: mit Aussenteam unten haelt ein Technik-Bot den Bord-Dienst, die Navigation bleibt am Steuer (als einziger Bot hat sie ihn)
  g.lobbyOpts.startMission = o.start || 'arena_space';
  g.handleMessage(c, { t: 'ready', ready: true });
  const P = { g, c, h: c.player, spy, fest: [], uhr: 1e12 }; ALLE.push(P);
  if (g.arena) { g.arena.nextAt = 1e9; g.space.enemies = []; }
  if (o.start === 'free') { g.space.enemies = []; g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; }
  lauf(P, 30, () => Station.stationOf(bot(P)) === 'helm'); lauf(P, 1);
  return P;
}
function tick(P) {
  const g = P.g;
  for (const e of P.fest) if (g.space.enemies.includes(e)) { e.x = e.pin.x; e.y = e.pin.y; e.angle = e.pin.angle; e.vx = 0; e.vy = 0; e.fireT = -999; e.shields = [0, 0, 0, 0]; }
  g.space.projectiles = g.space.projectiles.filter((q) => q.kind === 'torpedo' || q.waffe || (q.kind !== 'enemy' && q.kind !== 'emp'));
  g.step();
  if (g.wantsSnapshot()) g.snapshot();
}
const lauf = (P, sec, bis) => { const t1 = P.g.time + sec; while (P.g.time < t1) { tick(P); if (bis && bis()) return true; } return bis ? !!bis() : true; };
const bot = (P) => P.g.players.find((p) => p.bot && p.rolle === 'navigation');
const agent = (P) => Lauf.agent(P.g, bot(P));
const gegner = (P, kind, x, y) => { const e = space.spawnEnemy(P.g, kind, { x, y, facing: Math.atan2(P.g.ship.y - y, P.g.ship.x - x) }); e.pin = { x: e.x, y: e.y, angle: e.angle }; P.fest.push(e); return e; };
const weg = (P, e) => { P.g.space.enemies = P.g.space.enemies.filter((q) => q !== e); P.fest = P.fest.filter((q) => q !== e); };
const abst = (g, e) => Math.hypot(g.ship.x - e.x, g.ship.y - e.y);
const capZiel = (g, id) => { g.ship.capZiel = { id, scene: g.ship.scene }; };
// bot.befehl mit stehender Uhr (Rate-Fenster leer); liefert die textId der einen Antwort
function befehl(P, name, args, o) {
  o = o || {};
  P.uhr += 5000;
  const m = { t: 'bot.befehl', an: o.an || 'navigation', befehl: name, quelle: o.quelle || 'menu' }; if (args !== undefined) m.args = args;
  const n0 = P.c.inbox.length; const echt = Date.now; Date.now = () => P.uhr;
  try { P.g.handleMessage(P.c, m); } finally { Date.now = echt; }
  const a = P.c.inbox.slice(n0).filter((x) => x.t === 'bot.antwort');
  return a.length === 1 ? a[0].textId : 'ANTWORTEN:' + a.length;
}
const cmds = (P, prefix, ab) => P.spy.filter((s) => s.pid === bot(P).id && s.msg.t === 'cmd' && (!prefix || s.msg.c.startsWith(prefix)) && s.t >= (ab || 0));
const KONSOLE = 'helm';
function neben(g, p, konsole) {
  const ct = W.CONSOLE_TILES[konsole][0];
  const t = W.accessTiles(W.ship, W.shipWalkable, ct.x, ct.y)[0];
  const c = W.tileCenter(t.x, t.y); p.x = c.x; p.y = c.y; p.moving = false; p.input.mx = 0; p.input.my = 0;
  const dx = ct.x - t.x, dy = ct.y - t.y; p.dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
}
const eTaste = (g, conn) => { g.handleMessage(conn, { t: 'act', down: true }); g.handleMessage(conn, { t: 'act', down: false }); };
// das Schiff frei setzen (ungedockt) und ein paar Ticks laufen lassen, damit der Snapshot es kennt
function setze(P, x, y, angle) { const s = P.g.ship; s.docked = false; s.dockedAt = null; s.dockArmed = true; s.x = x; s.y = y; s.angle = angle || 0; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.stage = STOP; s.helm.autoStop = false; lauf(P, 1.5); }
const fehlerOk = (P) => P.g.errors === 0;

// ---------- 1 Registry ----------
section('1 Registry: sieben Befehle, Rueckgabeform, Codes aus gruende.json');
{
  const reg = Befehle.REGISTER.navigation;
  const namen = ['nav.kurs', 'nav.stopp', 'nav.schub', 'nav.ausweichen', 'nav.abstand', 'nav.andocken', 'nav.sprung'];
  ok(namen.every((x) => typeof reg[x] === 'function') && Object.keys(reg).length === 7, 'die Registry navigation traegt genau die sieben Befehle');
  const P = partie({});
  const codes = new Set();
  const probe = (name, args) => { const r = Befehle.befehl(P.g, bot(P), name, args); ok(r && (r.ok === true || (r.ok === false && typeof r.code === 'string')), `${name}: { ok } oder { ok:false, code } (${JSON.stringify(r)})`); if (r.code) codes.add(name + ':' + r.code); return r; };
  probe('nav.kurs', { ziel: 'marke' }); probe('nav.abstand', {}); probe('nav.andocken', {}); probe('nav.sprung', { ziel: 'marke' }); probe('nav.schub', { stufe: 'viertel' }); probe('nav.stopp', {}); probe('nav.ausweichen', {});
  ok(Array.from(codes).every((k) => GRUENDE.befehle[k.split(':')[0]].includes(k.split(':')[1])), 'jeder Code steht fuer seinen Befehl in gruende.json: ' + Array.from(codes).join(' '));
  ok(Befehle.befehl(P.g, bot(P), 'nav.schub', { stufe: 'dreiviertel' }).ok === true && Lauf.agent(P.g, bot(P)).absicht.befehl.name === 'nav.schub', 'der Befehl traegt die Absicht (name) im Agenten');
  ok(!JSON.stringify(P.g.snapshot()).includes('nav.schub') && !('absicht' in bot(P)), 'die Absicht steht weder im Snapshot noch im Spielerobjekt');
}

// ---------- 2 nav.schub ----------
section('2 nav.schub: Stufe setzen und halten');
{
  const P = partie({}); const { g } = P;
  setze(P, 1100, 1500, 0);
  const beob = (arg, soll, t) => { const a = befehl(P, 'nav.schub', { stufe: arg }); lauf(P, 3); ok(a === 'nav.schub.ok' && g.ship.helm.stage === soll, `${t}: Antwort ok, Stufe ${g.ship.helm.stage} (soll ${soll})`); };
  beob('voll', FULL, 'voll'); beob('halb', HALF, 'halb'); beob('dreiviertel', THREEQ, 'dreiviertel'); beob('viertel', QUARTER, 'viertel'); beob('rueckwaerts', STOP - 1, 'rueckwaerts (Index 0, die R-Stufe)');
  ok(HALF === STOP + 2 && THREEQ === STOP + 3 && FULL === STOP + 4 && QUARTER === STOP + 1, 'die Stufenindizes der Lerche: R, STOPP, 1/4, 1/2, 3/4, VOLL');
  for (const alt of [0, 1, 2, 3, 4, 5, 6, '3', 'null', 'stopp']) ok(befehl(P, 'nav.schub', { stufe: alt }) === 'nav.schub.abgelehnt.argument', `alte Stufe ${JSON.stringify(alt)} ist unbekannt: abgelehnt argument`);
  befehl(P, 'nav.schub', { stufe: 'halb' }); lauf(P, 2);
  const e = gegner(P, 'korvette', g.ship.x + 650, g.ship.y + 250);
  lauf(P, 12);
  ok(g.ship.helm.stage === HALF, `im Gefecht (Korvette da) bleibt die Stufe des Captains stehen (${g.ship.helm.stage}, ohne Befehl wuerde helmFight sie aendern)`);
  void e;
  ok(fehlerOk(P), 'game.errors leer');
}
{
  // K1b: nav.stopp im Gefecht (Absicht weg, helm.stop, Standardverhalten)
  const P = partie({}); const { g } = P;
  setze(P, 1100, 1500, 0);
  befehl(P, 'nav.schub', { stufe: 'halb' }); lauf(P, 2);
  const e = gegner(P, 'korvette', g.ship.x + 650, g.ship.y + 250); void e;
  lauf(P, 3);
  const t0 = g.time;
  ok(befehl(P, 'nav.stopp') === 'nav.stopp.ok', 'nav.stopp im Gefecht: ok');
  ok(!agent(P).absicht.befehl && agent(P).absicht.standard && agent(P).befehlGrund === 'stopp' && cmds(P, 'helm.stop', t0).length === 1, 'nav.stopp: Absicht verworfen (Grund stopp), ein helm.stop, Standardverhalten');
  lauf(P, 6);
  ok(!agent(P).absicht.befehl && agent(P).absicht.standard, 'danach haelt der Bot nichts mehr fest: helmFight regelt wieder (keine Dauer-Absicht STOPP)');
  ok(fehlerOk(P), 'game.errors leer');
}
{
  // K1a: nav.schub weicht Felsen aus (derselbe Wunschwinkel wie steer). Brocken auf der Bahn, volle Kraft: das Schiff beruehrt ihn nicht
  const P = partie({}); const { g } = P;
  setze(P, 300, 700, 0);
  g.space.asteroids = [{ id: 'fels1', x: 850, y: 700, r: 70, seed: 1 }]; g.asteroidsDirty = true;
  lauf(P, 1);
  befehl(P, 'nav.schub', { stufe: 'voll' });
  let min = 1e9; let ang = 0;
  lauf(P, 14, () => { min = Math.min(min, Math.hypot(g.ship.x - 850, g.ship.y - 700)); ang = Math.max(ang, Math.abs(g.ship.angle)); return false; });
  ok(min > 70 + 25 && ang > 0.05 && g.errors === 0, `nav.schub voll: der Brocken auf der Bahn wird umflogen (kleinster Abstand zur Mitte ${min.toFixed(0)} px > Radius 70 + 25, Kurs gedreht ${ang.toFixed(2)} rad)`);
}

{
  // BOT-01 D: rueckwaerts faehrt wirklich rueckwaerts (Heck voraus), Kurs und Andocken uebernehmen danach wieder
  const P = partie({}); const { g } = P;
  setze(P, 1100, 700, 0);
  const x0 = g.ship.x;
  befehl(P, 'nav.schub', { stufe: 'rueckwaerts' }); lauf(P, 6);
  const fwd = () => g.ship.vx * Math.cos(g.ship.angle) + g.ship.vy * Math.sin(g.ship.angle);
  ok(g.ship.helm.stage === STOP - 1 && fwd() < -15 && g.ship.x < x0 - 30 && agent(P).absicht.befehl && agent(P).absicht.befehl.name === 'nav.schub', `rueckwaerts: Stufe R, Fahrt ${fwd().toFixed(1)} px/s gegen den Bug, x ${x0.toFixed(0)} -> ${g.ship.x.toFixed(0)}, Absicht gehalten`);
  ok(/R.ckw.rts/.test(require('../server/bots/status.js').text(g, agent(P))), 'bot.status nennt die Rueckwaertsfahrt: ' + require('../server/bots/status.js').text(g, agent(P)));
  const e = gegner(P, 'korvette', g.ship.x + 1400, g.ship.y); capZiel(g, e.id);
  befehl(P, 'nav.kurs', { ziel: 'objekt:' + e.id }); lauf(P, 8);
  ok(g.ship.helm.stage >= QUARTER && fwd() > 10 && agent(P).absicht.befehl && agent(P).absicht.befehl.name === 'nav.kurs', `danach nav.kurs: ueberschreibt die Rueckwaertsstufe (Stufe ${g.ship.helm.stage}, Fahrt ${fwd().toFixed(1)} px/s voraus)`);
  befehl(P, 'nav.schub', { stufe: 'rueckwaerts' }); lauf(P, 3);
  ok(g.ship.helm.stage === STOP - 1, 'wieder rueckwaerts');
  g.ship.dodgeCd = 0; befehl(P, 'nav.ausweichen'); lauf(P, 2);
  ok(agent(P).absicht.befehl && agent(P).absicht.befehl.name === 'nav.schub' && g.ship.helm.stage === STOP - 1, 'Ausweichen rueckwaerts: die Absicht (Rueckwaertsstufe) bleibt');
  weg(P, e); befehl(P, 'nav.stopp');
  ok(g.ship.helm.stage === STOP && g.ship.helm.autoStop === true && !agent(P).absicht.befehl, 'nav.stopp aus der Rueckwaertsfahrt: Allstopp (Stufe STOPP, autoStop), Absicht weg');
  lauf(P, 15, () => g.ship.speed < 3);
  ok(g.ship.speed < 3, `das Schiff steht (${g.ship.speed.toFixed(1)} px/s)`);
  ok(fehlerOk(P), 'game.errors leer');
}
{
  // rueckwaerts weicht einem Felsen hinter dem Heck aus (Felsen und Rand werden vom Heck aus gesehen)
  const P = partie({}); const { g } = P;
  setze(P, 1400, 700, 0);
  g.space.asteroids = [{ id: 'fels2', x: 850, y: 700, r: 70, seed: 1 }]; g.asteroidsDirty = true;
  lauf(P, 1);
  befehl(P, 'nav.schub', { stufe: 'rueckwaerts' });
  let min = 1e9;
  lauf(P, 30, () => { min = Math.min(min, Math.hypot(g.ship.x - 850, g.ship.y - 700)); return false; });
  ok(min > 70 + 36 + 20 && g.errors === 0, `rueckwaerts: der Brocken hinter dem Heck wird umfahren (kleinster Abstand zur Mitte ${min.toFixed(0)} px > Radius 70 + 36 + 20)`);
}
{
  // rueckwaerts am Kartenrand: das Schiff dreht zur Mitte, statt aus der Karte zu fahren
  const P = partie({}); const { g } = P;
  setze(P, 400, 700, 0);   // Heck zeigt zur linken Kante (x = 0)
  befehl(P, 'nav.schub', { stufe: 'rueckwaerts' });
  let min = 1e9;
  lauf(P, 45, () => { min = Math.min(min, g.ship.x); return false; });
  ok(min > 20 && g.ship.x > 150 && g.errors === 0, `rueckwaerts Richtung Kartenrand: das Heck dreht zur Mitte, kleinster x ${min.toFixed(0)} px, nach 45 s wieder bei x ${g.ship.x.toFixed(0)}`);
}

// ---------- 3 nav.stopp, nav.ausweichen ----------
section('3 nav.stopp und nav.ausweichen');
{
  const P = partie({}); const { g } = P;
  setze(P, 1100, 1500, 0);
  befehl(P, 'nav.schub', { stufe: 'voll' }); lauf(P, 8);
  const v0 = g.ship.speed;
  ok(v0 > 60, `Schiff fliegt (${v0.toFixed(0)} px/s)`);
  const t0 = g.time;
  ok(befehl(P, 'nav.stopp') === 'nav.stopp.ok', 'nav.stopp: ok');
  ok(g.ship.helm.stage === STOP && g.ship.helm.autoStop === true && cmds(P, 'helm.stop', t0).length === 1 && agent(P).befehlGrund === 'stopp' && !agent(P).absicht.befehl && agent(P).absicht.standard, 'Allstopp (helm.stop), Schub-Absicht aufgegeben, Standardverhalten');
  lauf(P, 15, () => g.ship.speed < 3);
  ok(g.ship.speed < 3, `das Schiff steht (${g.ship.speed.toFixed(1)} px/s)`);
  const e = gegner(P, 'korvette', g.ship.x + 900, g.ship.y);
  befehl(P, 'nav.kurs', { ziel: 'objekt:' + e.id }); lauf(P, 4);
  const d0 = abst(g, e); befehl(P, 'nav.stopp'); lauf(P, 12);
  ok(!agent(P).absicht.befehl && agent(P).befehlGrund === 'stopp' && abst(g, e) > 300, `nav.stopp beendet den Kurs (Abstand ${d0.toFixed(0)} -> ${abst(g, e).toFixed(0)}, der Bot setzt nicht weiter nach)`);
  weg(P, e); lauf(P, 3);
  // ausweichen
  const t1 = g.time; g.ship.dodgeCd = 0;
  ok(befehl(P, 'nav.ausweichen') === 'nav.ausweichen.ok', 'nav.ausweichen: ok');
  ok(cmds(P, 'helm.dodge', t1).length === 1 && g.ship.dodgeCd > 0, `helm.dodge gesendet, die Ausweichrolle laeuft (Abklingzeit ${g.ship.dodgeCd.toFixed(1)} s)`);
  ok(befehl(P, 'nav.ausweichen') === 'nav.ausweichen.abgelehnt.nicht_jetzt', 'Ausweichrolle laedt noch: abgelehnt nicht_jetzt');
  befehl(P, 'nav.schub', { stufe: 'halb' }); lauf(P, 1); g.ship.dodgeCd = 0;
  befehl(P, 'nav.ausweichen'); ok(agent(P).absicht.befehl && agent(P).absicht.befehl.name === 'nav.schub', 'ein Ausweichen laesst die Absicht (Schub) stehen');
  ok(fehlerOk(P), 'game.errors leer');
}
{
  const P = partie({ start: 'free' }); const { g } = P;
  ok(g.ship.docked && befehl(P, 'nav.stopp') === 'nav.stopp.ok' && cmds(P, 'helm.stop').length === 0, 'angedockt: nav.stopp ok ohne Befehl (das Schiff steht schon)');
  ok(befehl(P, 'nav.ausweichen') === 'nav.ausweichen.abgelehnt.nicht_jetzt', 'angedockt: nav.ausweichen abgelehnt nicht_jetzt');
}

// ---------- 4 nav.kurs ----------
section('4 nav.kurs: das Schiff kommt an');
const KURS_AN = 200;
for (const [seed, dx, dy] of [[7, 700, 0], [11, -500, 600], [23, 100, -750]]) {
  for (const art of ['marke', 'ziel', 'objekt']) {
    const P = partie({ seed }); const { g } = P;
    setze(P, 1100, 1500, 0);
    const e = gegner(P, 'korvette', g.ship.x + dx, g.ship.y + dy);
    const arg = art === 'marke' ? 'marke' : art === 'ziel' ? 'ziel' : 'objekt:' + e.id;
    if (art === 'marke') capZiel(g, e.id); else if (art === 'ziel') g.ship.target = e.id;
    const d0 = abst(g, e); let dMin = d0; let angekommen = null; const t0 = g.time;
    const antwort = befehl(P, 'nav.kurs', { ziel: arg });
    lauf(P, 80, () => { dMin = Math.min(dMin, abst(g, e)); if (agent(P).befehlGrund === 'angekommen') { angekommen = abst(g, e); return true; } return false; });
    ok(antwort === 'nav.kurs.ok' && angekommen !== null && angekommen <= KURS_AN, `Seed ${seed}, ${art}: ok, angekommen nach ${(g.time - t0).toFixed(1)} s, Abstand ${d0.toFixed(0)} -> ${angekommen === null ? 'nie' : angekommen.toFixed(0)} (Ankunft <= ${KURS_AN})`);
    ok(fehlerOk(P) && agent(P).absicht.standard && !agent(P).absicht.befehl, 'Absicht danach beendet (Standardverhalten), keine Fehler');
  }
}
{
  // Basis (Hafen), zwei Ausgangslagen: ankommen und stehen
  for (const [seed, dx, dy, ang] of [[7, 650, 0, 0], [11, -250, 550, 2]]) {
    const P = partie({ seed, start: 'free' }); const { g } = P;
    setze(P, 700 + dx, 700 + dy, ang);
    const dock = Navziel.dockLage(g); const t0 = g.time;
    const antwort = befehl(P, 'nav.kurs', { ziel: 'basis' });
    const da = lauf(P, 80, () => agent(P).befehlGrund === 'angekommen');
    const d = Math.hypot(g.ship.x - dock.x, g.ship.y - dock.y);
    ok(antwort === 'nav.kurs.ok' && da && d <= 150, `Seed ${seed}, basis: angekommen nach ${(g.time - t0).toFixed(1)} s, ${d.toFixed(0)} px vom Liegeplatz (Ankunft <= 150)`);
    lauf(P, 10);
    ok(g.ship.speed < 10 && fehlerOk(P), `danach steht das Schiff (${g.ship.speed.toFixed(1)} px/s), keine Fehler`);
  }
}
{
  // Ziel verschwindet, kein_ziel
  const P = partie({}); const { g } = P;
  setze(P, 1100, 1500, 0);
  ok(befehl(P, 'nav.kurs', { ziel: 'marke' }) === 'nav.kurs.abgelehnt.kein_ziel', 'ohne Captain-Marke: abgelehnt kein_ziel');
  ok(befehl(P, 'nav.kurs', { ziel: 'ziel' }) === 'nav.kurs.abgelehnt.kein_ziel', 'ohne Ops-Marke: abgelehnt kein_ziel');
  ok(befehl(P, 'nav.kurs', { ziel: 'basis' }) === 'nav.kurs.abgelehnt.kein_ziel', 'im All ohne Station: basis abgelehnt kein_ziel');
  ok(befehl(P, 'nav.kurs', { ziel: 'hex:0306' }) === 'nav.kurs.abgelehnt.kein_ziel' && befehl(P, 'nav.kurs', { ziel: 'objekt:gibtsnicht' }) === 'nav.kurs.abgelehnt.kein_ziel', 'hex:<id> (anderer Sektor) und unbekanntes Objekt: kein_ziel');
  ok(!agent(P).absicht.befehl, 'abgelehnt: keine Absicht gesetzt');
  const e = gegner(P, 'korvette', g.ship.x + 1000, g.ship.y);
  capZiel(g, e.id);
  ok(befehl(P, 'nav.kurs', { ziel: 'marke' }) === 'nav.kurs.ok', 'Marke da: ok');
  lauf(P, 5);
  ok(g.ship.speed > 20, `unterwegs (${g.ship.speed.toFixed(0)} px/s)`);
  weg(P, e);
  lauf(P, 3);
  ok(agent(P).befehlGrund === 'ziel_weg' && !agent(P).absicht.befehl && agent(P).absicht.standard, 'Ziel zerstoert: die Absicht endet (ziel_weg)');
  lauf(P, 25, () => g.ship.speed < 3);
  ok(g.ship.speed < 3 && fehlerOk(P), `der Bot haelt an (${g.ship.speed.toFixed(1)} px/s)`);
}

// ---------- 5 nav.abstand ----------
section('5 nav.abstand: der Abstand wird gehalten');
{
  const messen = (P, e, sek, soll) => { const w = []; lauf(P, sek, () => { w.push(abst(P.g, e)); return false; }); const so = w.slice().sort((a, b) => a - b); return { min: so[0], max: so[so.length - 1], median: so[Math.floor(so.length / 2)] }; };
  for (const [seed, dx, dy, meter] of [[7, 900, 0, null], [11, -600, 700, 650]]) {
    const P = partie({ seed }); const { g } = P;
    setze(P, 1100, 1500, 0);
    const e = gegner(P, 'korvette', g.ship.x + dx, g.ship.y + dy); capZiel(g, e.id);
    const antwort = befehl(P, 'nav.abstand', meter ? { meter } : {});
    const soll = meter || 400;
    lauf(P, 50, () => Math.abs(abst(g, e) - soll) < 60);
    lauf(P, 10);
    const m = messen(P, e, 45, soll);
    ok(antwort === 'nav.abstand.ok' && agent(P).absicht.befehl && agent(P).absicht.befehl.name === 'nav.abstand', `Seed ${seed}: ok, Befehl gilt weiter (haelt, endet nicht von selbst)`);
    ok(Math.abs(m.median - soll) < 100 && m.min > soll * 0.45 && m.max < soll * 1.5, `Seed ${seed}: Abstand ${soll} ueber 45 s gehalten (Median ${m.median.toFixed(0)}, ${m.min.toFixed(0)} bis ${m.max.toFixed(0)}; die Breitseite kreist und taucht einmal je Umlauf ein, das tut helmManeuver auch ohne Befehl)`);
    ok(fehlerOk(P), 'game.errors leer');
  }
  // Station (fester Punkt): genauer
  for (const [seed, meter] of [[7, null], [11, 700]]) {
    const P = partie({ seed, start: 'free' }); const { g } = P;
    setze(P, 1100, 900, 3.0);
    const st = Navziel.stationLage(g); const soll = meter || 400;
    const antwort = befehl(P, 'nav.abstand', { ziel: 'basis', ...(meter ? { meter } : {}) });
    const w = []; lauf(P, 60, () => Math.abs(Math.hypot(g.ship.x - st.x, g.ship.y - st.y) - soll) < 45);
    lauf(P, 8); lauf(P, 25, () => { w.push(Math.hypot(g.ship.x - st.x, g.ship.y - st.y)); return false; });
    ok(antwort === 'nav.abstand.ok' && Math.min(...w) > soll - 60 && Math.max(...w) < soll + 60, `Seed ${seed}, Station: Abstand ${soll} ueber 25 s (${Math.min(...w).toFixed(0)} bis ${Math.max(...w).toFixed(0)}, Toleranz 60)`);
    ok(fehlerOk(P), 'game.errors leer');
  }
  // Standardwerte: ohne ziel erst Captain-Marke, dann Ops-Marke, sonst kein_ziel
  const P = partie({}); const { g } = P;
  setze(P, 1100, 1500, 0);
  ok(befehl(P, 'nav.abstand', {}) === 'nav.abstand.abgelehnt.kein_ziel', 'ohne Ziel und ohne Marken: abgelehnt kein_ziel');
  const a = gegner(P, 'korvette', g.ship.x + 800, g.ship.y), b = gegner(P, 'korvette', g.ship.x - 800, g.ship.y);
  g.ship.target = b.id;
  ok(befehl(P, 'nav.abstand', {}) === 'nav.abstand.ok' && agent(P).absicht.befehl.ziel.id === b.id, 'ohne ziel, nur Ops-Marke: die Ops-Marke');
  capZiel(g, a.id);
  befehl(P, 'nav.abstand', {}); ok(agent(P).absicht.befehl.ziel.id === a.id, 'ohne ziel mit Captain-Marke: die Captain-Marke geht vor');
  befehl(P, 'nav.abstand', { ziel: 'ziel' }); ok(agent(P).absicht.befehl.ziel.id === b.id, 'ziel = die Ops-Marke');
  ok(befehl(P, 'nav.abstand', { ziel: 'basis' }) === 'nav.abstand.abgelehnt.kein_ziel', 'basis ohne Station: kein_ziel');
}

// ---------- 6 nav.andocken ----------
section('6 nav.andocken: Anflug und Andocken');
for (const [seed, dx, dy, ang] of [[7, 700, 0, 0], [11, -400, 450, 2], [23, 150, -600, 4]]) {
  const P = partie({ seed, start: 'free' }); const { g } = P;
  setze(P, 700 + dx, 700 + dy, ang);
  const antwort = befehl(P, 'nav.andocken'); const t0 = g.time;
  const da = lauf(P, 120, () => g.ship.docked);
  lauf(P, 1);
  ok(antwort === 'nav.andocken.ok' && da && g.ship.dockedAt === 'hafen', `Seed ${seed}: das Schiff dockt an (${(g.time - t0).toFixed(1)} s, dockedAt ${g.ship.dockedAt})`);
  ok(agent(P).befehlGrund === 'angedockt' && !agent(P).absicht.befehl && fehlerOk(P), 'Befehl erledigt (angedockt), Absicht beendet, keine Fehler');
  ok(befehl(P, 'nav.andocken') === 'nav.andocken.ok' && !agent(P).absicht.befehl, 'schon angedockt: ok ohne neue Absicht');
}
{
  // BOT-01 D: aus der Rueckwaertsfahrt heraus uebernimmt nav.andocken die Stufen wieder und dockt an
  const P = partie({ seed: 7, start: 'free' }); const { g } = P;
  setze(P, 1400, 700, 0);
  befehl(P, 'nav.schub', { stufe: 'rueckwaerts' }); lauf(P, 4);
  ok(g.ship.helm.stage === STOP - 1 && g.ship.speed > 10, 'Aufbau: rueckwaerts unterwegs');
  const antwort = befehl(P, 'nav.andocken');
  const da = lauf(P, 120, () => g.ship.docked); lauf(P, 1);
  ok(antwort === 'nav.andocken.ok' && da && g.ship.dockedAt === 'hafen' && fehlerOk(P), 'aus der Rueckwaertsfahrt: nav.andocken ueberschreibt die Stufe und dockt an, keine Fehler');
}
{
  const P = partie({}); setze(P, 1100, 1500, 0);
  ok(befehl(P, 'nav.andocken') === 'nav.andocken.abgelehnt.kein_ziel' && !agent(P).absicht.befehl, 'im All ohne Dock: abgelehnt kein_ziel');
  const Q = partie({ start: 'free' }); setze(Q, 1300, 700, 0);
  Q.g.space.dockOk = false;
  ok(befehl(Q, 'nav.andocken') === 'nav.andocken.abgelehnt.kein_ziel', 'Besitzer verweigert das Andocken (dockOk false): kein_ziel');
}

// ---------- 7 nav.sprung ----------
section('7 nav.sprung');
{
  const vorbereiten = (seed) => {
    const P = partie({ seed, start: 'free' }); const { g } = P;
    g.explore.erkunde('0306'); g.explore.erkunde('0406'); g.explore.erkunde('0206');
    const p = Sprung.sprungpunkt(g, '0306'); setze(P, p.x - 500, p.y + 200, 0);
    return P;
  };
  {
    // marke: das vom Captain gewaehlte Ziel; einzelner Hop
    const P = vorbereiten(7); const { g } = P;
    ok(befehl(P, 'nav.sprung', { ziel: 'marke' }) === 'nav.sprung.abgelehnt.kein_ziel', 'marke ohne gewaehltes Sprungziel: kein_ziel');
    Sprung.selectDest(g, '0306'); lauf(P, 1);   // das tut der Captain (captain.selectDest), nicht die Registry
    const antwort = befehl(P, 'nav.sprung', { ziel: 'marke' }); const t0 = g.time;
    const gesprungen = lauf(P, 150, () => g.ship.scene !== 'hafen');
    ok(antwort === 'nav.sprung.ok' && gesprungen && g.ship.scene === 'splitter', `marke: der Bot fliegt zum Sprungpunkt und springt (Szene ${g.ship.scene} nach ${(g.time - t0).toFixed(1)} s)`);
    ok(cmds(P, 'helm.jump').length === 1 && cmds(P, 'helm.schnellsprung').length === 0, 'einzelner Hop: helm.jump');
    lauf(P, 2);
    ok(!agent(P).absicht.befehl && agent(P).befehlGrund === 'szene' && fehlerOk(P), 'danach keine Absicht mehr, keine Fehler');
  }
  {
    // Route (zwei Hops), vom Captain gewaehlt: helm.schnellsprung
    const P = vorbereiten(11); const { g } = P;
    Sprung.selectDest(g, '0406'); lauf(P, 1);
    ok(!!g.reisePlan && g.reisePlan.hops.join() === '0306,0406', 'Route 0306,0406 vom Captain gewaehlt');
    ok(befehl(P, 'nav.sprung', { ziel: 'marke' }) === 'nav.sprung.ok', 'marke mit gewaehlter Route: ok');
    lauf(P, 150, () => g.ship.scene !== 'hafen'); lauf(P, 12);
    ok(g.ship.scene === 'b7' && !g.reise && cmds(P, 'helm.schnellsprung').length === 1, `mit gewaehlter Route: helm.schnellsprung, alle Hops (Szene ${g.ship.scene})`);
  }
  {
    // W1: hex, ziel, basis, objekt waehlen nie ein Sprungziel; die Wahl des Captains bleibt, kein cmd des Bots
    const P = vorbereiten(7); const { g } = P;
    Sprung.selectDest(g, '0306'); lauf(P, 1);
    const dest0 = g.ship.jump.dest; const plan0 = JSON.stringify(g.reisePlan); const n0 = cmds(P).length;
    const a = ['hex:0406', 'hex:0306', 'hex:9999', 'ziel', 'basis', 'objekt:x'].map((z) => befehl(P, 'nav.sprung', { ziel: z }));
    ok(a.every((x) => x === 'nav.sprung.abgelehnt.kein_ziel'), 'hex:<id>, ziel, basis, objekt: kein_ziel (' + a.join(' ') + ')');
    ok(g.ship.jump.dest === dest0 && JSON.stringify(g.reisePlan) === plan0 && !agent(P).absicht.befehl && cmds(P).length === n0, `die Wahl des Captains bleibt (Ziel ${g.ship.jump.dest}, reisePlan unveraendert), keine Absicht, kein cmd des Bots`);
    // mit zwei Hops (reisePlan gesetzt): ein Mensch sendet hex:0206 - keine Ueberschreibung
    Sprung.selectDest(g, '0406'); lauf(P, 1);
    const plan1 = JSON.stringify(g.reisePlan);
    befehl(P, 'nav.sprung', { ziel: 'hex:0206' });
    ok(JSON.stringify(g.reisePlan) === plan1 && g.reisePlan.hops.join() === '0306,0406', 'Route des Captains bleibt bei hex:0206 stehen');
  }
  {
    // laufende Reise, Stoersender, Transfer bei der Annahme (die Vorpruefung, nicht der noch alte blockedReason): nicht_jetzt
    const P = vorbereiten(7); const { g } = P;
    Sprung.selectDest(g, '0306'); lauf(P, 1);
    g.reise = { hops: ['0306'], i: 0, t: 0, ziel: 'splitter', abbruch: false };
    ok(befehl(P, 'nav.sprung', { ziel: 'marke' }) === 'nav.sprung.abgelehnt.nicht_jetzt', 'laufende Reise: nicht_jetzt');
    g.reise = null;
    const j = space.spawnEnemy(g, 'korvette', { x: g.ship.x + 900, y: g.ship.y });   // Stoersender in der Szene, blockedReason noch vom Tick davor
    ok(Sprung.jammersPresent(g) && !/rsender/.test(g.ship.jump.blockedReason || ''), 'Aufbau: Stoersender da, blockedReason noch alt');
    ok(befehl(P, 'nav.sprung', { ziel: 'marke' }) === 'nav.sprung.abgelehnt.nicht_jetzt' && !agent(P).absicht.befehl, 'Stoersender bei Annahme: nicht_jetzt, keine Absicht');
    g.space.enemies = g.space.enemies.filter((q) => q !== j); lauf(P, 1);
    const ib = g.transfer.isBeaming; g.transfer.isBeaming = () => true;
    try { ok(befehl(P, 'nav.sprung', { ziel: 'marke' }) === 'nav.sprung.abgelehnt.nicht_jetzt' && !agent(P).absicht.befehl, 'Transfer laeuft bei Annahme: nicht_jetzt, keine Absicht'); } finally { g.transfer.isBeaming = ib; }
    ok(befehl(P, 'nav.sprung', { ziel: 'marke' }) === 'nav.sprung.ok', 'Gegenprobe: ohne Hindernis ok');
  }
  {
    // W2: ein Stoersender erscheint nach der Annahme - die Absicht endet, helmFight laeuft, das Schiff steht nicht still
    const P = vorbereiten(7); const { g } = P;
    Sprung.selectDest(g, '0306'); lauf(P, 1);
    ok(befehl(P, 'nav.sprung', { ziel: 'marke' }) === 'nav.sprung.ok', 'Sprung angenommen');
    lauf(P, 3);
    const e = gegner(P, 'korvette', g.ship.x + 700, g.ship.y); void e; const t0 = g.time;
    lauf(P, 5);
    ok(!agent(P).absicht.befehl && agent(P).befehlGrund === 'blockiert' && agent(P).absicht.standard, `Stoersender nach der Annahme: die Absicht endet (Grund ${agent(P).befehlGrund})`);
    const v = []; lauf(P, 30, () => { v.push(g.ship.speed); return false; });
    ok(Math.max(...v) > 10 && cmds(P, 'weapons.', t0).length + cmds(P, 'helm.', t0).length > 0, `der Bot kaempft wieder (helmFight): das Schiff steht nicht still (hoechstens ${Math.max(...v).toFixed(0)} px/s)`);
    ok(fehlerOk(P), 'game.errors leer');
  }
  {
    // W2: Transfer laeuft nach der Annahme (blockedReason "Transfer laeuft"): Absicht endet; Ziel kippt (Sprungpunkt-Automatik): Absicht endet
    const P = vorbereiten(7); const { g } = P;
    Sprung.selectDest(g, '0306'); lauf(P, 1);
    befehl(P, 'nav.sprung', { ziel: 'marke' }); lauf(P, 2);
    const ib = g.transfer.isBeaming; g.transfer.isBeaming = () => true;
    try { lauf(P, 2); } finally { g.transfer.isBeaming = ib; }
    ok(!agent(P).absicht.befehl && agent(P).befehlGrund === 'blockiert', `Sprung gesperrt nach der Annahme (Transfer): Absicht endet (${agent(P).befehlGrund})`);
    const Q = vorbereiten(7); const q = Q.g;
    Sprung.selectDest(q, '0306'); lauf(Q, 1);
    befehl(Q, 'nav.sprung', { ziel: 'marke' }); lauf(Q, 2);
    ok(!!agent(Q).absicht.befehl, 'Aufbau: Absicht laeuft');
    q.ship.jump.dest = 'b7'; lauf(Q, 2);   // das Ziel kippt (Sprungpunkt-Automatik jumpAutomatik setzt j.dest ebenso)
    ok(!agent(Q).absicht.befehl && agent(Q).befehlGrund === 'ziel_geaendert', `Ziel gekippt: Absicht endet (${agent(Q).befehlGrund}), der Bot springt nicht woandershin`);
    ok(cmds(Q, 'helm.jump').length === 0 && cmds(Q, 'helm.schnellsprung').length === 0 && fehlerOk(Q), 'kein Sprung gesendet, keine Fehler');
  }
}

// ---------- 8 Ablehnungen ----------
section('8 Ablehnungen: nicht_jetzt, system, wartet');
{
  const P = partie({}); const { g, h } = P;
  setze(P, 1100, 1500, 0);
  const e = gegner(P, 'korvette', g.ship.x + 800, g.ship.y); capZiel(g, e.id);
  const sieben = [['nav.kurs', { ziel: 'marke' }], ['nav.stopp'], ['nav.schub', { stufe: 'halb' }], ['nav.ausweichen'], ['nav.abstand', {}], ['nav.andocken', {}], ['nav.sprung', { ziel: 'marke' }]];
  // Aussenteam unten
  h.zone = 'away';
  const az = {}; for (const [nm, ar] of sieben) az[nm] = befehl(P, nm, ar);
  h.zone = 'ship';
  ok(['nav.kurs', 'nav.abstand', 'nav.andocken', 'nav.sprung', 'nav.schub'].every((nm) => az[nm] === nm + '.abgelehnt.nicht_jetzt'), 'Aussenteam unten (zone away): nav.kurs, nav.abstand, nav.andocken, nav.sprung und nav.schub (halb) abgelehnt nicht_jetzt');
  ok(['nav.stopp', 'nav.ausweichen'].every((nm) => az[nm] === nm + '.ok'), 'Aussenteam unten: nav.stopp und nav.ausweichen bleiben moeglich');
  h.zone = 'away';
  ok(befehl(P, 'nav.stopp') === 'nav.stopp.ok' && ['rueckwaerts', 'viertel', 'halb', 'dreiviertel', 'voll'].every((s) => befehl(P, 'nav.schub', { stufe: s }) === 'nav.schub.abgelehnt.nicht_jetzt') && !agent(P).absicht.befehl, 'Aussenteam unten: nur nav.stopp, jede Schubstufe (auch rueckwaerts) nicht_jetzt, keine Absicht');
  h.zone = 'ship';
  agent(P).befehlVerwerfen('test'); g.ship.dodgeCd = 0;
  // Antrieb zerstoert
  g.ship.systems.engines = 'broken';
  const sy = {}; for (const [nm, ar] of sieben) sy[nm] = befehl(P, nm, ar);
  g.ship.systems.engines = 'ok';
  ok(['nav.kurs', 'nav.schub', 'nav.ausweichen', 'nav.abstand', 'nav.andocken', 'nav.sprung'].every((nm) => sy[nm] === nm + '.unmoeglich.system'), 'Antrieb zerstoert: sechs Befehle unmoeglich system');
  ok(sy['nav.stopp'] === 'nav.stopp.ok', 'Antrieb zerstoert: nav.stopp bleibt ok (nichts zu bewegen)');
  agent(P).befehlVerwerfen('test');
  ok(!agent(P).absicht.befehl, 'abgelehnte Befehle setzen keine Absicht');
  // Bot noch unterwegs (nicht an der Steuer): direkte Befehle gehen nicht
  bot(P).console = null;
  ok(befehl(P, 'nav.stopp') === 'nav.stopp.abgelehnt.nicht_jetzt' && befehl(P, 'nav.ausweichen') === 'nav.ausweichen.abgelehnt.nicht_jetzt', 'Bot nicht an der Steuer: nav.stopp und nav.ausweichen abgelehnt nicht_jetzt');
}
{
  // wartet
  const P = partie({}); const { g, h, c } = P;
  setze(P, 1100, 1500, 0);
  const e = gegner(P, 'korvette', g.ship.x + 800, g.ship.y); capZiel(g, e.id);
  neben(g, h, 'helm'); eTaste(g, c); lauf(P, 1);
  ok(h.console === 'helm' && agent(P).absicht.zustand === 'wartet', 'Mensch sitzt an der Steuer, der Bot wartet');
  const sieben = [['nav.kurs', { ziel: 'marke' }], ['nav.stopp'], ['nav.schub', { stufe: 'halb' }], ['nav.ausweichen'], ['nav.abstand', {}], ['nav.andocken', {}], ['nav.sprung', { ziel: 'marke' }]];
  ok(sieben.every(([nm, ar]) => befehl(P, nm, ar) === nm + '.abgelehnt.wartet') && !agent(P).absicht.befehl, 'alle sieben Befehle: abgelehnt wartet, keine Absicht');
}

// ---------- 9 Mensch gewinnt, Vorrang, Ende der Absicht ----------
section('9 Mensch gewinnt, Notsprung, Aussenteam, Befehlswechsel');
{
  const P = partie({}); const { g, h, c } = P;
  setze(P, 1100, 1500, 0);
  const e = gegner(P, 'korvette', g.ship.x + 1400, g.ship.y); capZiel(g, e.id);
  befehl(P, 'nav.kurs', { ziel: 'marke' }); lauf(P, 4);
  ok(!!agent(P).absicht.befehl && g.ship.speed > 20 && cmds(P, 'helm.').length > 0, 'Kurs laeuft (Absicht gesetzt, der Bot sendet helm-Befehle)');
  neben(g, h, 'helm'); const t0 = g.time; eTaste(g, c);
  ok(h.console === 'helm' && agent(P).absicht.zustand === 'wartet', 'Mensch setzt sich an die Steuer');
  lauf(P, 0.2);
  ok(!agent(P).absicht.befehl && agent(P).absicht.standard && agent(P).befehlGrund === 'mensch', 'die Absicht ist verworfen (Mensch gewinnt)');
  g.handleMessage(c, { t: 'cmd', c: 'helm.throttle', set: STOP }); const sent = cmds(P, null, t0).length;
  lauf(P, 8);
  ok(cmds(P, null, t0).length === sent && g.ship.helm.stage === STOP, 'der Bot sendet nichts, die Eingabe des Menschen bleibt');
  g.handleMessage(c, { t: 'leave' });
  const zurueck = lauf(P, 25, () => Station.stationOf(bot(P)) === 'helm'); lauf(P, 1);
  ok(zurueck && agent(P).absicht.zustand === 'an_station' && !agent(P).absicht.befehl && agent(P).absicht.standard, 'Mensch geht: der Bot uebernimmt im Standardverhalten (kein alter Befehl)');
  lauf(P, 8);
  ok(!agent(P).absicht.befehl && fehlerOk(P), 'der alte Kurs wird nicht wieder aufgenommen (keine Absicht, keine Fehler)');
}
{
  // Notsprung hat Vorrang
  const P = partie({ start: 'free' }); const { g } = P;
  g.explore.erkunde('0306'); const p = Sprung.sprungpunkt(g, '0306'); setze(P, p.x - 600, p.y, 0);
  befehl(P, 'nav.schub', { stufe: 'halb' }); lauf(P, 2);
  const t0 = g.time; interior.damageSystem(g, 'reactor', 'broken'); g.ship.reaktorCountdown = { t: 6 }; lauf(P, 2);
  ok(cmds(P, 'helm.notsprung', t0).length >= 1, 'Reaktor-Countdown unter 8 s: der Bot loest den Notsprung aus, obwohl ein Befehl gilt');
}
{
  // Aussenteam beendet den Kurs, ein anderer Befehl ersetzt ihn
  const P = partie({}); const { g } = P;
  setze(P, 1100, 1500, 0);
  const e = gegner(P, 'korvette', g.ship.x + 1400, g.ship.y); capZiel(g, e.id);
  befehl(P, 'nav.kurs', { ziel: 'marke' }); lauf(P, 3);
  P.h.zone = 'away'; lauf(P, 1);   // echtes Aussenteam unten (zone away)
  ok(!agent(P).absicht.befehl && agent(P).befehlGrund === 'aussenteam', 'Aussenteam geht nach unten: der Kurs endet (nur Kurs halten wie bisher)');
  P.h.zone = 'ship'; lauf(P, 1);
  befehl(P, 'nav.schub', { stufe: 'voll' }); lauf(P, 4);
  ok(agent(P).absicht.befehl && agent(P).absicht.befehl.name === 'nav.schub' && g.ship.helm.stage === FULL && g.ship.speed > 40, 'Aufbau: Schub-Absicht laeuft (volle Kraft)');
  const ts = g.time; P.h.zone = 'away'; lauf(P, 1);
  ok(!agent(P).absicht.befehl && agent(P).befehlGrund === 'aussenteam' && cmds(P, 'helm.stop', ts).length === 1, 'Schub-Absicht, Aussenteam geht runter: die Absicht endet (Grund aussenteam), das Schiff wird angehalten (helm.stop)');
  lauf(P, 25); const x1 = g.ship.x, y1 = g.ship.y; lauf(P, 5);
  ok(g.ship.speed < 3 && Math.hypot(g.ship.x - x1, g.ship.y - y1) < 10 && !agent(P).absicht.befehl, `danach steht das Schiff (${g.ship.speed.toFixed(1)} px/s), keine neue Absicht: Beamreichweite bleibt`);
  ok(befehl(P, 'nav.schub', { stufe: 'voll' }) === 'nav.schub.abgelehnt.nicht_jetzt', 'mit Aussenteam unten: nav.schub voll abgelehnt');
  P.h.zone = 'ship'; lauf(P, 1);
  befehl(P, 'nav.kurs', { ziel: 'marke' }); const a1 = agent(P).absicht.befehl;
  befehl(P, 'nav.abstand', {}); const a2 = agent(P).absicht.befehl;
  befehl(P, 'nav.stopp');
  ok(a1.name === 'nav.kurs' && a2.name === 'nav.abstand' && !agent(P).absicht.befehl, 'ein neuer Navigationsbefehl ersetzt den alten, nav.stopp beendet ihn');
  ok(fehlerOk(P), 'game.errors leer');
}
{
  // Absicht endet mit dem Spiel: Lauf weg, neuer Lauf = neue Absicht
  const P = partie({}); setze(P, 1100, 1500, 0);
  const e = gegner(P, 'korvette', P.g.ship.x + 900, P.g.ship.y); capZiel(P.g, e.id);
  befehl(P, 'nav.kurs', { ziel: 'marke' });
  const alt = agent(P); P.g.reset && P.g.reset('test');
  lauf(P, 1);
  ok(Lauf.agent(P.g, bot(P)) !== alt, 'Reset: der Lauf (mit seinen Absichten) ist verworfen');
}

// ---------- 10 Absicht endet bei downed, nicht an Bord, Szenenwechsel; Ausweichen im Befehl ----------
section('10 Ende der Absicht (downed, nicht an Bord, Szene), Ausweichen im Befehl');
{
  for (const [name, args, extra] of [['nav.kurs', { ziel: 'marke' }, 'kurs'], ['nav.schub', { stufe: 'halb' }, 'schub']]) {
    // downed
    const P = partie({}); const { g } = P;
    setze(P, 1100, 1500, 0);
    const e = gegner(P, 'korvette', g.ship.x + 1400, g.ship.y); capZiel(g, e.id);
    befehl(P, name, args); lauf(P, 2);
    ok(!!agent(P).absicht.befehl, `${extra}: Absicht laeuft`);
    bot(P).downed = true; lauf(P, 1.5); bot(P).downed = false;
    ok(!agent(P).absicht.befehl && agent(P).befehlGrund === 'unten', `${extra}: Bot ist unten (downed): Absicht verworfen (Grund ${agent(P).befehlGrund})`);
    lauf(P, 4);
    ok(!agent(P).absicht.befehl, `${extra}: nach dem Aufstehen laeuft nichts von selbst weiter`);
    // nicht an Bord
    befehl(P, name, args); lauf(P, 2);
    ok(!!agent(P).absicht.befehl, `${extra}: neue Absicht laeuft`);
    bot(P).zone = 'away'; g.snapshot(); g.step(); bot(P).zone = 'ship'; lauf(P, 1);   // der Snapshot des Agenten kennt die Lage des Bots sofort (sonst endet die Absicht schon durch aussenteamUnten)
    ok(!agent(P).absicht.befehl && agent(P).befehlGrund === 'unten', `${extra}: Bot nicht an Bord (zone away): Absicht verworfen (Grund ${agent(P).befehlGrund})`);
    lauf(P, 4);
    ok(!agent(P).absicht.befehl && fehlerOk(P), `${extra}: danach keine Absicht, keine Fehler`);
    // Szenenwechsel (die Szene der Absicht ist nicht mehr die des Schiffs)
    befehl(P, name, args); lauf(P, 2);
    agent(P).absicht.befehl.szene = 'andere_szene'; lauf(P, 1);
    ok(!agent(P).absicht.befehl && agent(P).befehlGrund === 'szene', `${extra}: Szenenwechsel: Absicht verworfen (Grund ${agent(P).befehlGrund})`);
  }
}
{
  // ausweichenImBefehl: Geschoss nahe am Schiff waehrend nav.kurs: helm.dodge (der Befehl kaempft nicht, weicht aber aus)
  const P = partie({}); const { g } = P;
  setze(P, 1100, 1500, 0);
  const e = gegner(P, 'korvette', g.ship.x + 1500, g.ship.y); capZiel(g, e.id);
  befehl(P, 'nav.kurs', { ziel: 'marke' }); lauf(P, 2);
  g.ship.dodgeCd = 0; const t0 = g.time;
  for (let k = 0; k < 90; k++) {   // 3 s: ein Geschoss des Gegners dicht am Schiff (der Testlauf raeumt Geschosse sonst weg)
    for (const x of P.fest) if (g.space.enemies.includes(x)) { x.x = x.pin.x; x.y = x.pin.y; x.angle = x.pin.angle; x.vx = 0; x.vy = 0; x.fireT = -999; }
    g.space.projectiles = g.space.projectiles.filter((q) => q.kind !== 'enemy');
    g.space.projectiles.push({ id: g.nextId('pr'), kind: 'enemy', x: g.ship.x + 75, y: g.ship.y, angle: 0, speed: 0, ttl: 5, dmg: 0, owner: e.id });
    g.step(); if (g.wantsSnapshot()) g.snapshot();
  }
  g.space.projectiles = g.space.projectiles.filter((q) => q.kind !== 'enemy');
  ok(cmds(P, 'helm.dodge', t0).length >= 1 && !!agent(P).absicht.befehl, `nav.kurs: ein Geschoss dicht am Schiff loest helm.dodge aus (${cmds(P, 'helm.dodge', t0).length}x), der Kurs gilt weiter`);
  ok(fehlerOk(P), 'game.errors leer');
}

// ---------- 11 Menschenpartie, Quellscan, Wachposten, Projektil-Reflex ----------
section('11 Menschenpartie ohne Bot-Code, Quellscan der Registries, Wachposten, Projektil-Reflex');
{
  // Ohne Bots laeuft kein Bot-Code: kein Agent, keine Absicht, kein Aufruf von tick/steuerDienst/befehlSetzen. Der Byte-Vergleich der Menschenpartie (Nachrichten, Snapshots) ist der Golden-Lauf
  // (tools/golden-trace.js --all, diff gegen die Basis); ein Vergleich des Laufs mit sich selbst bewiese nichts.
  const zaehl = { tick: 0, steuerDienst: 0, befehlSetzen: 0 }; const alt = {};
  for (const k of Object.keys(zaehl)) { alt[k] = BotMannschaft.prototype[k]; BotMannschaft.prototype[k] = function (...a) { zaehl[k]++; return alt[k].apply(this, a); }; }
  let nSnap = 0; const antworten = [];
  try {
    for (const [start, seed] of [['arena_space', 5], ['m3', 6]]) {
      const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
      const g = new Game({ noStore: true, seed, worldDir: dir, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
      const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'M0', name: 'M0', color: 0 });
      g.lobbyOpts.startMission = start; g.handleMessage(c, { t: 'ready', ready: true });
      for (let i = 0; i < 400; i++) {
        if (i === 100) interior.enterConsole(g, c.player, 'helm');
        if (i === 150) g.handleMessage(c, { t: 'bot.befehl', an: 'navigation', befehl: 'nav.kurs', args: { ziel: 'marke' }, quelle: 'menu' });
        if (i === 200) g.handleMessage(c, { t: 'cmd', c: 'helm.throttle', set: 4 });
        g.step();
        if (g.wantsSnapshot()) { g.snapshot(); nSnap++; }
      }
      antworten.push(...c.inbox.filter((x) => x.t === 'bot.antwort').map((x) => x.textId));
      ok(Lauf.agenten(g).length === 0 && g.errors === 0, `${start}: ohne Bots kein Lauf, keine Agenten, keine Fehler`);
    }
  } finally { for (const k of Object.keys(alt)) BotMannschaft.prototype[k] = alt[k]; }
  ok(nSnap > 40 && zaehl.tick === 0 && zaehl.steuerDienst === 0 && zaehl.befehlSetzen === 0, `Menschenpartie (mit einem bot.befehl): kein Bot-Code laeuft (tick ${zaehl.tick}, steuerDienst ${zaehl.steuerDienst}, befehlSetzen ${zaehl.befehlSetzen}; ${nSnap} Snapshots)`);
  ok(antworten.every((x) => /\.unmoeglich\.kein_bot$/.test(x)) && antworten.length === 2, 'der bot.befehl ohne Bot wird nur beantwortet (unmoeglich kein_bot), setzt nichts: ' + antworten.join(' '));
}
{
  // Quellscan der Registries (server/bots/befehle/*.js): kein Zugriff, der Spielzustand aendert. Erlaubt sind nur diese lesenden Aufrufe von Spielmodulen; alles andere ist ein Befund.
  const ERLAUBT = new Set(['Navziel.aufloesen', 'Navziel.dockLage', 'Navziel.sprungGrundOffen', 'Station.stationOf', 'Sprung.jammersPresent', 'CaptainZiel.gueltig', 'Space.resolveTarget', 'Waffen.mountState', 'Lauf.agent', 'Lauf.dienstLaeuft', 'Lage.untenMenschen', 'Lage.anyAway', 'Lage.allesDowned', 'Lage.rueckholSperre', 'Lage.captainBelegt', 'Lage.supportSperre', 'Status.text', 'Math.max', 'Math.min', 'Math.round', 'Math.abs', 'Math.floor', 'Math.hypot', 'Object.keys', 'Object.assign', 'Object.entries', 'Object.freeze', 'Array.isArray', 'JSON.stringify', 'Number.isFinite', 'Number.isInteger', 'String.raw']);
  const scan = (quelle) => {
    const q = quelle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, "''");
    const funde = [];
    for (const m of q.matchAll(/\b([A-Z][A-Za-z]*)\.([a-zA-Z_]+)\(/g)) if (!ERLAUBT.has(m[1] + '.' + m[2])) funde.push('Aufruf ' + m[1] + '.' + m[2]);
    for (const m of q.matchAll(/\b(game|ship|sh|g|bot|p|s|space|state|mission|explore|transfer)\b(?:\.[A-Za-z_]+|\[[^\]]+\])+\s*(?:=(?!=)|\+=|-=|\*=|\/=|\+\+|--)/g)) if (!/^bot[[]''[\]]/.test(m[0])) funde.push('Zuweisung ' + m[0].trim());   // bot['name'] = ist das Eintragen in die Registry, kein Spielzustand
    for (const m of q.matchAll(/\.(cmd|send|emit|missionEvent|handleMessage|selectDest|push|splice|delete)\(/g)) funde.push('Aufruf .' + m[1] + '(');
    return funde;
  };
  const dir = path.join(__dirname, '..', 'server', 'bots', 'befehle');
  const dateien = fs.readdirSync(dir).filter((x) => x.endsWith('.js'));
  const funde = {}; for (const d of dateien) funde[d] = scan(fs.readFileSync(path.join(dir, d), 'utf8'));
  ok(dateien.length >= 5 && dateien.every((d) => funde[d].length === 0), 'Quellscan: keine Registry (' + dateien.join(' ') + ') ruft eine Spielfunktion mit Zustandsaenderung auf, schreibt Spielzustand oder sendet selbst' + Object.entries(funde).filter(([, v]) => v.length).map(([d, v]) => ' [' + d + ': ' + v.join(', ') + ']').join(''));
  ok(scan('Sprung.selectDest(game, h);').length >= 1 && scan('game.ship.x = 5;').length === 1 && scan('ship.jump.dest = 3;').length === 1 && scan('Besitz.uebernehmen(game);').length === 1 && scan('agent.cmd(1);').length === 1 && scan('const z = CaptainZiel.gueltig(game); // Sprung.selectDest(x)').length === 0, 'der Scan selbst erkennt Sprung.selectDest, Zuweisungen an game/ship, Besitz-Aufrufe und .cmd( (und ignoriert Kommentare)');
}
{
  // Wachposten: der Agent sendet nie Nachrichten ausserhalb seiner Station (captain.*, weapons.*, hello ...); jede Partie des Tests: verworfen === 0
  const P = partie({}); const a = agent(P); const t0 = P.g.time; const v0 = a.verworfen;
  a.send({ t: 'cmd', c: 'captain.selectDest', dest: 'splitter' }); a.send({ t: 'cmd', c: 'weapons.fire', mount: 'all' }); a.send({ t: 'hello', clientId: 'x' });
  ok(a.verworfen === v0 + 3 && P.spy.filter((x) => x.t >= t0 && x.msg.c === 'captain.selectDest').length === 0 && P.spy.filter((x) => x.msg.t === 'hello' && x.pid === bot(P).id).length === 0, 'Wachposten: captain.selectDest, weapons.fire und hello des Bots werden verworfen und kommen nie beim Spiel an');
  ok(a.befehle === 0 || P.spy.every((x) => x.pid !== bot(P).id || x.msg.t !== 'cmd' || /^(helm\.|station\.)/.test(x.msg.c) || x.msg.c === 'station.tab'), 'der Bot sendet nur helm.-Befehle (und station.tab)');
  const bad = []; for (const Q of ALLE) { if (Q === P) continue; const ag = Lauf.agent(Q.g, bot(Q)); if (ag && ag.verworfen !== 0) bad.push(ag.verworfen); const fremd = Q.spy.filter((x) => x.pid === (bot(Q) && bot(Q).id) && x.msg.t === 'cmd' && !/^(helm\.|station\.)/.test(x.msg.c)); if (fremd.length) bad.push(fremd[0].msg.c); }
  ok(bad.length === 0, `in allen ${ALLE.length - 1} Partien dieses Tests: kein Bot hat eine Nachricht ausserhalb seiner Station gesendet, der Wachposten hat nichts verworfen (verworfen === 0)${bad.length ? ' ' + bad.join(',') : ''}`);
}
{
  // K4: der Projektil-Reflex in mannschaft.js (ausweichenImBefehl) ist eine Kopie aus kern.js (helmFight); beide Bedingungen muessen im Wortlaut gleich bleiben (Schwelle 90 px, dodgeCd, Sperre 1 s)
  const zeile = (datei) => { const l = fs.readFileSync(path.join(__dirname, '..', 'server', 'bots', datei), 'utf8').split(/\r?\n/).filter((x) => x.includes("S.space.projectiles.some((q) => (q.kind === 'enemy'")); return l.map((x) => x.trim()); };
  const k = zeile('kern.js'), m = zeile('mannschaft.js');
  ok(k.length === 1 && m.length === 1 && k[0] === m[0] && /< 90\)/.test(k[0]), 'Projektil-Reflex: kern.js und mannschaft.js tragen dieselbe Bedingung (90 px, dodgeCd, Sperre)');
}

console.log(`\ntest-bot-befehle-nav: ${n - fails}/${n} ok`);
if (fails) process.exit(1);
