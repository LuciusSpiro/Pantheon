'use strict';
// BOT-01 C2b: die Befehle von Ops, Technik und Bot (Katalog v1) wirken im Server-Bot (server/bots/befehle/ops.js, technik.js, bot.js; Ausfuehrung im Agenten mannschaft.js; Statustext status.js).
// Echtes Game, Server-Bots (Navigation, Ops, Technik), Befehle ueber bot.befehl, Wirkung am Spielzustand beobachtet.
//   1. Registry: 13 Befehle (6 ops, 5 technik, 2 bot), Rueckgabeform, Codes aus gruende.json
//   2. ops.ziel: markiert, naechstes, objekt:<id> (Ziel gehalten gegen den Standard), Ziel zerstoert, kein_ziel; Station/Mine als Ziel (Marke steht, Feuer auf Gegner laeuft weiter, Mine wird beschossen)
//   3. ops.feuer_halt / ops.feuer_frei: kein Schuss ueber 20 s trotz Gegner im Bogen, danach wieder Feuer; waffen begrenzt die Gruppen; kein_ziel, system, nicht_jetzt
//   4. ops.scan, ops.landescan, ops.beamen: Wirkung (Scan, Halteprozesse), nicht_jetzt, system
//   5. tech.schild, tech.prio: gehalten gegen die Technik-Automatik (prioSperre), System-Prioritaet endet bei heilem System, Feuer/Leck bleiben; tech.reparieren, tech.energie, tech.ueberladen: Wirkung, nicht_jetzt, system
//   6. bot.status (Text nur dort), bot.automatik (alle Rollen, auch Navigation)
//   7. Ablehnungen: wartet, nicht_jetzt (nicht an der Konsole); jede Antwort mit passender textId
//   8. Mensch gewinnt (Absicht verworfen, Bot sendet nichts, danach Standard), Reaktor-Ausnahme der Prioritaet; die Prioritaet des Bots geht mit (Mensch, Raeumen, bewusstlos), Absichten enden bei downed
//   9. Reine Menschenpartie: kein Bot-Code laeuft (der Byte-Vergleich ist der Golden-Lauf). Den Quellscan der Registries (server/bots/befehle/*.js) fuehrt tools/test-bot-befehle-nav.js (Abschnitt 11) fuer alle Dateien
//   node tools/test-bot-befehle-ops-tech.js
//   Mutationsproben: BOT_OT_MUT=feuer_halt|schild|status|mensch|ziel_stumm|prio_sperre|system_aktiv|prio_bleibt|prio_endet_nie|unten node tools/test-bot-befehle-ops-tech.js (muss rot sein, siehe tools/mutation-bot-befehle-ops-tech.js)
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');
process.chdir(path.join(__dirname, '..'));

const MUT = process.env.BOT_OT_MUT || '';
// Mutation status: die Annahme uebernimmt den Registry-Text bei jedem Befehl (muss vor dem Laden des Spiels eingehaengt werden)
if (MUT === 'status') {
  const f = require.resolve('../server/bots/annahme.js');
  const alt = fs.readFileSync(f, 'utf8'); const neu = alt.replace("name !== 'bot.status' || ", '');
  if (neu === alt) throw new Error('Mutation status: Quelle nicht gefunden');
  const m = new Module(f, module); m.filename = f; m.paths = Module._nodeModulePaths(path.dirname(f)); require.cache[f] = m; m._compile(neu, f);
}
// Mutation system_aktiv: tech.prio prueft nicht, ob das System eingebaut ist
if (MUT === 'system_aktiv') {
  const f = require.resolve('../server/bots/befehle/technik.js');
  const alt = fs.readFileSync(f, 'utf8'); const neu = alt.replace('if (!interior.systemAktiv(game, wert)) return SYSTEM;', '');
  if (neu === alt) throw new Error('Mutation system_aktiv: Quelle nicht gefunden');
  const m = new Module(f, module); m.filename = f; m.paths = Module._nodeModulePaths(path.dirname(f)); require.cache[f] = m; m._compile(neu, f);
}
const { Game } = require('../server/game.js');
const Station = require('../server/sim/station.js');
const interior = require('../server/sim/interior.js');
const space = require('../server/sim/space.js');
const Fracht = require('../server/sim/fracht.js');
const W = require('../server/world.js');
const BotSpieler = require('../server/bots/spieler.js');
const Lauf = require('../server/bots/lauf.js');
const { BotMannschaft } = require('../server/bots/mannschaft.js');
const { BotKern, STOP } = require('../server/bots/kern.js');
const Befehle = require('../server/bots/befehle/index.js');
const Status = require('../server/bots/status.js');
const Alarm = require('../server/sim/alarm.js');
const GRUENDE = require('../content/bots/gruende.json');
const TEXTE = require('../content/bots/texte.json');

if (MUT === 'feuer_halt') BotMannschaft.prototype.feuerErlaubt = function (c, extra) { return extra || {}; };
if (MUT === 'schild') BotMannschaft.prototype.schildVerteilung = function (S) { return BotKern.prototype.schildVerteilung.call(this, S); };
// ziel_stumm: eine Nicht-Gegner-Marke legt das Feuer still (alter Stand); prio_sperre: die Standard-Prioritaeten laufen gegen die gehaltene; prio_bleibt: die Prioritaet des Bots bleibt im Schiff;
// prio_endet_nie: eine System-Prioritaet endet nicht; unten: bewusstlos/abwesend verwirft nichts
if (MUT === 'ziel_stumm') BotMannschaft.prototype.fightMitMarke = function () {};
if (MUT === 'prio_sperre') Object.defineProperty(BotMannschaft.prototype, 'prioSperre', { get() { return false; }, set() { /* nie sperren */ } });
if (MUT === 'prio_bleibt') BotMannschaft.prototype.prioritaetZuruecknehmen = function () { return false; };
if (MUT === 'prio_endet_nie') BotMannschaft.prototype.prioErledigt = function () { return false; };
if (MUT === 'unten') { const alt = BotMannschaft.prototype.alleVerwerfen; BotMannschaft.prototype.alleVerwerfen = function (grund) { return grund === 'unten' ? false : alt.call(this, grund); }; }
if (MUT === 'mensch') { const alt = BotMannschaft.prototype.alleVerwerfen; BotMannschaft.prototype.alleVerwerfen = function (grund) { return grund === 'mensch' ? false : alt.call(this, grund); }; }

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-botot-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
let seq = 0;

// ---------- Aufbau ----------
const mkConn = () => ({ inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } });
const STATION = { navigation: 'helm', ops: 'weapons', technik: 'technik' };
// o.start: arena_space (Gegner nur die gesetzten) | free (Freie Fahrt); o.seed; o.rollen: Bots (Standard alle drei)
function partie(o) {
  o = o || {};
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: o.seed || 7, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  g.botZufall = (() => { let a = 42; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const spy = []; const echt = g.handleMessage.bind(g);
  g.handleMessage = (conn, msg) => { if (conn && conn.bot) spy.push({ pid: conn.player ? conn.player.id : null, msg, t: g.time }); return echt(conn, msg); };
  const c = mkConn(); g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'K0', color: 0 });
  for (const r of o.rollen || ['navigation', 'ops', 'technik']) BotSpieler.botHinzufuegen(g, null, r);
  g.lobbyOpts.startMission = o.start || 'arena_space';
  g.handleMessage(c, { t: 'ready', ready: true });
  const P = { g, c, h: c.player, spy, fest: [], uhr: 1e12, lanze: 0 };
  const emitAlt = g.emit.bind(g); g.emit = (kind, data) => { if (kind === 'lance' && data && data.state !== 'charge') P.lanze++; return emitAlt(kind, data); };
  if (g.arena) { g.arena.nextAt = 1e9; g.space.enemies = []; }
  if (o.start === 'free') { g.space.enemies = []; g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; }
  const rollen = o.rollen || ['navigation', 'ops', 'technik'];
  lauf(P, 40, () => rollen.every((r) => Station.stationOf(bot(P, r)) === STATION[r])); lauf(P, 1);
  return P;
}
function tick(P) {
  const g = P.g;
  for (const e of P.fest) if (g.space.enemies.includes(e)) { e.x = e.pin.x; e.y = e.pin.y; e.angle = e.pin.angle; e.vx = 0; e.vy = 0; e.fireT = -999; e.shields = [0, 0, 0, 0]; e.hp = e.hpMax; if (e.pinSys) e.sys = JSON.parse(e.pinSys); }
  g.space.projectiles = g.space.projectiles.filter((q) => q.kind === 'torpedo' || q.waffe || (q.kind !== 'enemy' && q.kind !== 'emp'));
  g.step();
  if (g.wantsSnapshot()) g.snapshot();
}
const lauf = (P, sec, bis) => { const t1 = P.g.time + sec; while (P.g.time < t1) { tick(P); if (bis && bis()) return true; } return bis ? !!bis() : true; };
const bot = (P, rolle) => P.g.players.find((p) => p.bot && p.rolle === rolle);
const agent = (P, rolle) => Lauf.agent(P.g, bot(P, rolle));
// Gegner an Ort (relativ zum Schiff), fest (kein Feuer, keine Bewegung, unzerstoerbar)
const gegner = (P, kind, dx, dy) => { const s = P.g.ship; const e = space.spawnEnemy(P.g, kind, { x: s.x + dx, y: s.y + dy, facing: Math.atan2(-dy, -dx) }); e.pin = { x: e.x, y: e.y, angle: e.angle }; e.pinSys = e.sys ? JSON.stringify(e.sys) : null; P.fest.push(e); return e; };
const weg = (P, e) => { P.g.space.enemies = P.g.space.enemies.filter((q) => q !== e); P.fest = P.fest.filter((q) => q !== e); };
const capZiel = (g, id) => { g.ship.capZiel = { id, scene: g.ship.scene }; };
// bot.befehl mit stehender Uhr (Rate-Fenster leer); liefert die Antworten
function senden(P, name, args, o) {
  o = o || {};
  P.uhr += 5000;
  const m = { t: 'bot.befehl', an: o.an || 'ops', befehl: name, quelle: o.quelle || 'menu' }; if (args !== undefined) m.args = args;
  const n0 = P.c.inbox.length; const echt = Date.now; Date.now = () => P.uhr;
  try { P.g.handleMessage(P.c, m); } finally { Date.now = echt; }
  return P.c.inbox.slice(n0).filter((x) => x.t === 'bot.antwort');
}
const ROLLE_VON = (name) => (name.startsWith('ops.') ? 'ops' : name.startsWith('tech.') ? 'technik' : 'ops');
const befehl = (P, name, args, o) => { const a = senden(P, name, args, Object.assign({ an: ROLLE_VON(name) }, o)); return a.length === 1 ? a[0].textId : 'ANTWORTEN:' + a.length; };
const cmds = (P, rolle, prefix, ab) => P.spy.filter((s) => s.pid === bot(P, rolle).id && s.msg.t === 'cmd' && (!prefix || s.msg.c.startsWith(prefix)) && s.t >= (ab || 0));
const feuerCmds = (P, ab) => cmds(P, 'ops', null, ab).filter((s) => s.msg.c === 'weapons.charge' || s.msg.c === 'weapons.fire');
function neben(g, p, konsole) {
  const ct = W.CONSOLE_TILES[konsole][0];
  const t = W.accessTiles(W.ship, W.shipWalkable, ct.x, ct.y)[0];
  const c = W.tileCenter(t.x, t.y); p.x = c.x; p.y = c.y; p.moving = false; p.input.mx = 0; p.input.my = 0;
  const dx = ct.x - t.x, dy = ct.y - t.y; p.dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
}
const eTaste = (g, conn) => { g.handleMessage(conn, { t: 'act', down: true }); g.handleMessage(conn, { t: 'act', down: false }); };
const fehlerOk = (P) => P.g.errors === 0;
const frei = (P) => { const s = P.g.ship; s.docked = false; s.dockedAt = null; s.dockArmed = true; s.x = 1100; s.y = 1500; s.angle = 0; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.stage = 0; s.helm.autoStop = false; lauf(P, 1.5); holdStopp(P); lauf(P, 2); };
// Das Schiff bleibt auf STOPP, solange kein Navigationsbefehl gilt (BOT-01 C2a Nacharbeit: nav.schub 0 ist nav.stopp und haelt nichts mehr fest, der Standard kaempft sonst um die Position und verschiebt die Testlage)
function holdStopp(P) {
  const na = agent(P, 'navigation'); if (!na || na.holdStopp) return;
  na.holdStopp = true; const alt = na.steuerDienst;
  na.steuerDienst = function (S, p) { if (this.absicht.befehl) return alt.call(this, S, p); this.helmS(S, 0, STOP); };
}

// ---------- 1 Registry ----------
section('1 Registry: 13 Befehle, Rueckgabeform, Codes aus gruende.json');
{
  const R = Befehle.REGISTER;
  const ops = ['ops.ziel', 'ops.feuer_frei', 'ops.feuer_halt', 'ops.scan', 'ops.landescan', 'ops.beamen'];
  const tech = ['tech.prio', 'tech.reparieren', 'tech.schild', 'tech.energie', 'tech.ueberladen'];
  ok(ops.every((x) => typeof R.ops[x] === 'function') && Object.keys(R.ops).length === 6, 'die Registry ops traegt genau die sechs Befehle');
  ok(tech.every((x) => typeof R.technik[x] === 'function') && Object.keys(R.technik).length === 5, 'die Registry technik traegt genau die fuenf Befehle');
  ok(typeof R.bot['bot.status'] === 'function' && typeof R.bot['bot.automatik'] === 'function' && Object.keys(R.bot).length === 2 && Object.keys(R.bord).length === 0, 'die Registry bot traegt bot.status und bot.automatik, bord bleibt leer (BOT-02)');
  const P = partie({}); frei(P);
  const e = gegner(P, 'korvette', 500, 0);
  const codes = new Set();
  const probe = (rolle, name, args) => { const r = Befehle.befehl(P.g, bot(P, rolle), name, args); ok(r && (r.ok === true || (r.ok === false && typeof r.code === 'string')), `${name}: { ok } oder { ok:false, code } (${JSON.stringify(r)})`); if (r.code) codes.add(name + ':' + r.code); return r; };
  probe('ops', 'ops.ziel', { ziel: 'naechstes' }); probe('ops', 'ops.feuer_frei', {}); probe('ops', 'ops.feuer_halt', {}); probe('ops', 'ops.scan', {}); probe('ops', 'ops.landescan', {}); probe('ops', 'ops.beamen', { was: 'fracht' });
  probe('technik', 'tech.prio', { ziel: 'feuer' }); probe('technik', 'tech.reparieren', { system: 'engines' }); probe('technik', 'tech.schild', { sektor: 'bug' }); probe('technik', 'tech.energie', { system: 'engines', delta: -1 }); probe('technik', 'tech.ueberladen', {});
  probe('ops', 'bot.status', {}); probe('technik', 'bot.automatik', {});
  ok(Array.from(codes).every((k) => GRUENDE.befehle[k.split(':')[0]].includes(k.split(':')[1])), 'jeder Code steht fuer seinen Befehl in gruende.json: ' + Array.from(codes).join(' '));
  ok(!JSON.stringify(P.g.snapshot()).includes('ops.ziel') && !('absicht' in bot(P, 'ops')), 'die Absicht steht weder im Snapshot noch im Spielerobjekt');
  void e;
}

// ---------- 2 ops.ziel ----------
section('2 ops.ziel: markiert, naechstes, objekt, zerstoert, kein_ziel');
{
  const P = partie({}); const { g } = P; frei(P);
  ok(befehl(P, 'ops.ziel', { ziel: 'markiert' }) === 'ops.ziel.abgelehnt.kein_ziel', 'ohne Captain-Marke: markiert abgelehnt kein_ziel');
  ok(befehl(P, 'ops.ziel', { ziel: 'naechstes' }) === 'ops.ziel.abgelehnt.kein_ziel', 'ohne Gegner: naechstes abgelehnt kein_ziel');
  ok(befehl(P, 'ops.ziel', { ziel: 'objekt:gibtsnicht' }) === 'ops.ziel.abgelehnt.kein_ziel', 'unbekanntes Objekt: kein_ziel');
  ok(!agent(P, 'ops').absicht.befehl && agent(P, 'ops').absicht.standard, 'abgelehnt: keine Absicht gesetzt');
  const a = gegner(P, 'korvette', 600, 150), b = gegner(P, 'korvette', 800, -450);
  g.ship.target = a.id; capZiel(g, b.id);
  ok(befehl(P, 'ops.ziel', { ziel: 'markiert' }) === 'ops.ziel.ok' && agent(P, 'ops').absicht.befehl.id === b.id, 'markiert: ok, die Absicht haelt die Captain-Marke');
  lauf(P, 4);
  ok(g.ship.target === b.id && cmds(P, 'ops', 'weapons.target').some((s) => s.msg.id === b.id), 'markiert: die Ops-Marke steht auf der Captain-Marke (weapons.target gesendet)');
  ok(befehl(P, 'ops.ziel', { ziel: 'objekt:' + a.id }) === 'ops.ziel.ok', 'objekt:<id>: ok');
  lauf(P, 12);
  ok(g.ship.target === a.id && agent(P, 'ops').absicht.befehl.id === a.id, 'objekt: das Ziel steht auf a und bleibt 12 s dort, obwohl die Captain-Marke b waere (ohne Befehl waehlt der Standard die Marke)');
  ok(befehl(P, 'ops.ziel', { ziel: 'naechstes' }) === 'ops.ziel.ok' && agent(P, 'ops').absicht.befehl.id === a.id, 'naechstes: der naechste Gegner (a, 600 px, statt b, 800 px)');
  weg(P, a); lauf(P, 4);
  ok(agent(P, 'ops').befehlGrund === 'ziel_weg' && !agent(P, 'ops').absicht.befehl && agent(P, 'ops').absicht.standard, 'Ziel zerstoert: die Absicht endet (ziel_weg), Standardverhalten');
  ok(g.ship.target === b.id, 'danach waehlt der Standard die Captain-Marke');
  ok(fehlerOk(P), 'game.errors leer');
}
{
  // Station als Ziel (kein Gegner): die Marke steht UND der Bot feuert weiter auf den Gegner im Bogen (BOT-01 C2b Nacharbeit W1). Kontrolle: derselbe Aufbau ohne Befehl.
  // die Korvette liegt genau auf der Strahllinie der Lanze (in Blickrichtung des Schiffs), sonst trifft sie nie und die Lanze wartet auf einen Treffer
  const aufbau = () => { const P = partie({ start: 'free' }); frei(P); const w = P.g.ship.angle; const e = gegner(P, 'korvette', 450 * Math.cos(w), 450 * Math.sin(w)); return { P, e }; };
  const K = aufbau(); const tk = K.P.g.time; lauf(K.P, 20); const kontrolle = feuerCmds(K.P, tk).length;
  ok(kontrolle > 0, `Kontrolle (ohne Befehl): der Bot feuert auf die Korvette im Bogen (${kontrolle} Feuerbefehle)`);
  for (const via of ['objekt:station', 'markiert']) {
    const { P, e } = aufbau(); const { g } = P;
    if (via === 'markiert') capZiel(g, 'station');
    ok(befehl(P, 'ops.ziel', { ziel: via }) === 'ops.ziel.ok' && agent(P, 'ops').absicht.befehl.id === 'station', `ops.ziel ${via} auf die Station: ok`);
    const t0 = g.time; lauf(P, 20);
    const n = feuerCmds(P, t0).length;
    ok(g.ship.target === 'station', `${via}: die Marke steht auf der Station (ship.target ${g.ship.target})`);
    ok(n > 0 && n >= kontrolle * 0.5, `${via}: der Bot feuert weiter auf die Korvette (${n} Feuerbefehle, Kontrolle ${kontrolle}, ${P.lanze} Lanzenschuesse)`);
    ok(cmds(P, 'ops', 'weapons.target', t0).every((x) => x.msg.id === 'station'), `${via}: nie ein weapons.target auf den Gegner (die Marke wird nicht ueberschrieben)`);
    ok(!!agent(P, 'ops').absicht.befehl && fehlerOk(P), `${via}: der Befehl gilt weiter, game.errors leer`);
    befehl(P, 'ops.feuer_halt'); const t1 = g.time; lauf(P, 12);
    ok(feuerCmds(P, t1).length === 0 && g.ship.target === 'station', `${via}: feuer_halt sperrt auch dann (kein Feuerbefehl), die Marke bleibt`);
    void e;
  }
}
{
  // Mine als Ziel: der Bot feuert mit der Seitenbatterie darauf (feuer_halt sperrt)
  const P = partie({}); const { g } = P; frei(P);
  const s = g.ship;
  const [mine] = Alarm.minenSetzen(g, { n: 1, positionen: [{ x: s.x, y: s.y + 300 }] }); mine.gesehen = true; mine.ohneStrom = true;
  befehl(P, 'ops.feuer_halt');
  ok(befehl(P, 'ops.ziel', { ziel: 'objekt:' + mine.id }) === 'ops.ziel.ok', 'ops.ziel auf eine Mine: ok');
  const t0 = g.time; lauf(P, 10);
  ok(g.ship.target === mine.id && feuerCmds(P, t0).length === 0 && !!Alarm.mineById(g, mine.id), 'feuer_halt: die Marke steht auf der Mine, kein Schuss, die Mine bleibt');
  befehl(P, 'ops.feuer_frei', {}); const t1 = g.time; lauf(P, 20, () => !Alarm.mineById(g, mine.id));
  ok(!Alarm.mineById(g, mine.id) && cmds(P, 'ops', 'weapons.fire', t1).length > 0, 'feuer_frei: die Batterie schiesst auf die Mine, sie ist weg');
  lauf(P, 2);
  ok(agent(P, 'ops').befehlGrund === 'ziel_weg' && !agent(P, 'ops').absicht.befehl && fehlerOk(P), 'Mine zerstoert: der Befehl endet (ziel_weg), keine Fehler');
}

// ---------- 3 Feuer ----------
section('3 ops.feuer_halt / ops.feuer_frei: Feuerzustand und Waffengruppen');
{
  const P = partie({}); const { g } = P; frei(P);
  ok(befehl(P, 'ops.feuer_frei', {}) === 'ops.feuer_frei.abgelehnt.kein_ziel', 'ohne Ziel und ohne Gegner: feuer_frei abgelehnt kein_ziel');
  ok(!agent(P, 'ops').absicht.feuer, 'abgelehnt: kein Feuerzustand gesetzt');
  const e = gegner(P, 'korvette', 450, 0); g.ship.target = e.id;
  const t0 = g.time; lauf(P, 20);
  const grund = feuerCmds(P, t0).length;
  ok(grund > 0 && P.lanze > 0, `Standard: der Bot feuert auf den Gegner im Bug-Bogen (${grund} Feuerbefehle, ${P.lanze} Lanzenschuesse)`);
  // feuer_halt
  lauf(P, 12);   // Lanze neu laden lassen
  const l0 = P.lanze;
  ok(befehl(P, 'ops.feuer_halt') === 'ops.feuer_halt.ok' && agent(P, 'ops').absicht.feuer === 'halt', 'feuer_halt: ok, Zustand gehalten');
  const t1 = g.time; lauf(P, 20);
  const bow = g.ship.mount.bow;
  ok(feuerCmds(P, t1).length === 0 && P.lanze === l0 && !bow.charging, `feuer_halt: ueber 20 s bei Gegner im Bogen kein Feuerbefehl, kein Schuss (Lanze ${bow.charge.toFixed(2)} geladen, ${P.lanze - l0} Schuesse)`);
  // feuer_frei hebt auf
  const t2 = g.time;
  ok(befehl(P, 'ops.feuer_frei', {}) === 'ops.feuer_frei.ok' && agent(P, 'ops').absicht.feuer === 'frei' && agent(P, 'ops').absicht.waffen === null, 'feuer_frei ohne waffen: ok (= alle)');
  lauf(P, 15);
  ok(feuerCmds(P, t2).length > 0 && P.lanze > l0, `feuer_frei: der Bot feuert wieder (${feuerCmds(P, t2).length} Feuerbefehle, ${P.lanze - l0} Schuesse)`);
  ok(fehlerOk(P), 'game.errors leer');
}
{
  // waffen: Gruppen. Gegner querab: erst sehen, welche Seite feuert, dann die andere Gruppe sperren
  const seiten = {};
  for (const dy of [350, -350]) {
    const P = partie({}); const { g } = P; frei(P);
    const e = gegner(P, 'korvette', 0, dy); g.ship.target = e.id;
    befehl(P, 'ops.feuer_frei', {}); const t0 = g.time; lauf(P, 25);
    seiten[dy] = new Set(cmds(P, 'ops', 'weapons.fire', t0).map((s) => s.msg.mount));
  }
  const dyPort = Object.keys(seiten).find((k) => seiten[k].has('port') && !seiten[k].has('stbd'));
  const dyStbd = Object.keys(seiten).find((k) => seiten[k].has('stbd') && !seiten[k].has('port'));
  ok(!!dyPort && !!dyStbd, `Ausgangslage: querab feuert je Seite genau ihre Batterie (${JSON.stringify(Object.fromEntries(Object.entries(seiten).map(([k, v]) => [k, Array.from(v)])))})`);
  const lauf3 = (dy, waffen) => {
    const P = partie({}); const { g } = P; frei(P);
    const e = gegner(P, 'korvette', 0, Number(dy)); g.ship.target = e.id;
    const a = befehl(P, 'ops.feuer_frei', waffen ? { waffen } : {}); const t0 = g.time; lauf(P, 25);
    return { a, P, f: feuerCmds(P, t0).map((s) => s.msg.c + ':' + (s.msg.mount || 'bow')) };
  };
  for (const [dy, gut, schlecht, was] of [[dyPort, 'bb', ['stb', 'bug', 'torpedo'], 'Backbord-Gegner'], [dyStbd, 'stb', ['bb', 'bug', 'torpedo'], 'Steuerbord-Gegner']]) {
    const r = lauf3(dy, gut);
    ok(r.a === 'ops.feuer_frei.ok' && r.f.length > 0 && r.f.every((x) => x.startsWith('weapons.fire:')), `${was}, waffen ${gut}: ok, die Batterie feuert (${r.f.length} Befehle)`);
    for (const w of schlecht.filter((x) => x !== 'torpedo')) {
      const q = lauf3(dy, w);
      ok(q.a === 'ops.feuer_frei.ok' && q.f.length === 0, `${was}, waffen ${w}: ok, aber ueber 25 s kein Feuerbefehl (die Gruppe ${gut} ist gesperrt)`);
    }
    ok(befehl(r.P, 'ops.feuer_frei', { waffen: 'torpedo' }) === 'ops.feuer_frei.abgelehnt.nicht_jetzt', `${was}: waffen torpedo ohne Torpedowerfer: abgelehnt nicht_jetzt`);
  }
  const b = lauf3(dyPort, 'bug'); const alle = lauf3(dyPort, 'alle');
  ok(alle.f.length > 0 && b.f.length === 0, 'waffen alle = ohne Einschraenkung (feuert), waffen bug sperrt die Seitenbatterie');
  // Bug-Gegner: bug feuert die Lanze, bb nicht
  const P = partie({}); const { g } = P; frei(P);
  const e = gegner(P, 'korvette', 450, 0); g.ship.target = e.id;
  befehl(P, 'ops.feuer_frei', { waffen: 'bb' }); const t0 = g.time; lauf(P, 20);
  ok(feuerCmds(P, t0).length === 0, 'Bug-Gegner, waffen bb: die Bug-Lanze bleibt stumm');
  befehl(P, 'ops.feuer_frei', { waffen: 'bug' }); const t1 = g.time; lauf(P, 20);
  ok(cmds(P, 'ops', 'weapons.charge', t1).length > 0 && P.lanze > 0, `Bug-Gegner, waffen bug: die Lanze laedt und schiesst (${P.lanze} Schuesse)`);
  // system: alle Waffen ausgefallen
  const ws = interior.WEAPON_SYSTEMS.filter((s) => interior.systemAktiv(g, s)); const alt = ws.map((s) => g.ship.systems[s]);
  for (const s of ws) g.ship.systems[s] = 'broken';
  ok(befehl(P, 'ops.feuer_frei', {}) === 'ops.feuer_frei.unmoeglich.system', 'alle Waffen zerstoert: feuer_frei unmoeglich system');
  ws.forEach((s, i) => { g.ship.systems[s] = alt[i]; });
  g.ship.systems.battery_port = 'broken';
  ok(befehl(P, 'ops.feuer_frei', { waffen: 'bb' }) === 'ops.feuer_frei.unmoeglich.system' && befehl(P, 'ops.feuer_frei', { waffen: 'stb' }) === 'ops.feuer_frei.ok', 'Backbordbatterie zerstoert: waffen bb unmoeglich system, waffen stb ok');
  g.ship.systems.battery_port = 'ok';
  // kein_ziel mit Gegner nur in der Szene
  const Q = partie({}); frei(Q); const e2 = gegner(Q, 'korvette', 900, 300);
  ok(befehl(Q, 'ops.feuer_frei', {}) === 'ops.feuer_frei.ok', 'Gegner in der Szene ohne Marke: feuer_frei ok (kein_ziel nur ohne Ziel und ohne Gegner)');
  void e2;
  ok(fehlerOk(P) && fehlerOk(Q), 'game.errors leer');
}

// ---------- 4 Scan, Landescan, Beamen ----------
section('4 ops.scan, ops.landescan, ops.beamen');
{
  const P = partie({}); const { g } = P; frei(P);
  ok(befehl(P, 'ops.scan') === 'ops.scan.abgelehnt.nicht_jetzt', 'ohne Ziel: ops.scan abgelehnt nicht_jetzt');
  const e = gegner(P, 'korvette', 790, 0); g.ship.target = e.id;
  lauf(P, 6);
  ok(!e.scanned, 'Ausgangslage: bei 790 px scannt der Standard (Grenze 780) nicht');
  ok(befehl(P, 'ops.scan') === 'ops.scan.ok' && g.ship.tscan.on === true && !!agent(P, 'ops').absicht.halten.scan, 'ops.scan: ok, der Scan laeuft (tscan.on), der Agent haelt ihn');
  lauf(P, 8, () => e.scanned); lauf(P, 1);
  ok(e.scanned === true && !agent(P, 'ops').absicht.halten.scan, 'das Ziel ist gescannt, der Scan-Auftrag endet');
  const e2 = gegner(P, 'korvette', 1700, 0); g.ship.target = e2.id;
  ok(befehl(P, 'ops.scan') === 'ops.scan.abgelehnt.nicht_jetzt', 'Ziel zu weit fuer den Scan: nicht_jetzt');
  bot(P, 'ops').console = null;
  ok(befehl(P, 'ops.scan') === 'ops.scan.abgelehnt.nicht_jetzt' && befehl(P, 'ops.landescan') === 'ops.landescan.abgelehnt.nicht_jetzt' && befehl(P, 'ops.beamen', { was: 'fracht' }) === 'ops.beamen.abgelehnt.nicht_jetzt', 'Bot nicht an der Ops-Konsole: scan, landescan, beamen abgelehnt nicht_jetzt');
}
{
  // Landescan im Orbit der Methalle (Aufbau wie tools/test-lpscan.js)
  const P = partie({ start: 'free' }); const { g } = P;
  space.enterScene(g, 'methalle', {}); lauf(P, 0.5); g.explore.known.add('methalle'); g.explore.version++;
  const s = g.ship; s.docked = false; s.dockedAt = null; s.x = 100; s.y = 100; s.vx = 0; s.vy = 0; lauf(P, 0.5);
  ok(befehl(P, 'ops.landescan') === 'ops.landescan.abgelehnt.nicht_jetzt' && !g.lpscan, 'ausserhalb der Scanreichweite: ops.landescan abgelehnt nicht_jetzt');
  s.x = 1349 - 400; s.y = 928; s.vx = 0; s.vy = 0; lauf(P, 0.5);
  ok(befehl(P, 'ops.landescan') === 'ops.landescan.ok' && !!g.lpscan, 'in Reichweite: ok, der Landepunkt-Scan laeuft (game.lpscan)');
  lauf(P, 6, () => !g.lpscan);
  ok(!g.lpscan && g.explore.lpScan.has('methalle.siedlung'), 'nach der Haltezeit ist der Landepunkt gescannt');
  ok(befehl(P, 'ops.landescan') === 'ops.landescan.abgelehnt.nicht_jetzt', 'nichts mehr zu scannen: nicht_jetzt');
  ok(fehlerOk(P), 'game.errors leer');
}
{
  // Beamen: Fracht in Reichweite
  const P = partie({}); const { g } = P; frei(P);
  ok(befehl(P, 'ops.beamen', { was: 'fracht' }) === 'ops.beamen.abgelehnt.nicht_jetzt', 'keine Fracht in diesem Gebiet: nicht_jetzt');
  ok(befehl(P, 'ops.beamen', { was: 'person' }) === 'ops.beamen.abgelehnt.nicht_jetzt' && cmds(P, 'ops', 'weapons.person').length === 1, 'person ohne Landepunkt: weapons.person gesendet, nicht_jetzt');
  const pod = Fracht.podAblegen(g, g.ship.x + 60, g.ship.y, null, null);
  const vorher = Fracht.anBord(g);
  ok(befehl(P, 'ops.beamen', { was: 'fracht' }) === 'ops.beamen.ok' && !!Fracht.state(g).halt, 'Fracht in Reichweite: ok, der Beam-Halteprozess laeuft');
  ok(befehl(P, 'ops.beamen', { was: 'fracht' }) === 'ops.beamen.abgelehnt.nicht_jetzt', 'Transfer laeuft bereits: nicht_jetzt');
  lauf(P, 6, () => !Fracht.state(g).halt);
  ok(Fracht.anBord(g) === vorher + 1 && !Fracht.draussen(g).some((d) => d.id === pod.id), 'die Fracht ist an Bord');
  Fracht.podAblegen(g, g.ship.x + 60, g.ship.y, null, null);
  g.ship.systems.transfer = 'broken';
  ok(befehl(P, 'ops.beamen', { was: 'fracht' }) === 'ops.beamen.unmoeglich.system' && !Fracht.state(g).halt, 'Transfer zerstoert: unmoeglich system');
  g.ship.systems.transfer = 'ok';
  ok(fehlerOk(P), 'game.errors leer');
}

// ---------- 5 Technik ----------
section('5 Technik: schild, prio gehalten; reparieren, energie, ueberladen');
{
  // tech.schild: gehalten gegen die Verteilung nach Bedrohung
  const P = partie({}); const { g } = P; frei(P);
  const e = gegner(P, 'korvette', 500, 0);   // Bug-Seite: der Standard verlagert nach Bug (Sektor 0)
  lauf(P, 16);
  const vor = g.ship.shields.alloc.slice();
  ok(vor[0] >= 3 && vor[2] <= 1, `Ausgangslage: der Standard verlagert die Schilde nach Bug (${vor.join(',')})`);
  ok(befehl(P, 'tech.schild', { sektor: 'heck' }) === 'tech.schild.ok' && agent(P, 'technik').absicht.halten.schild === 2, 'tech.schild heck: ok, die Absicht haelt Sektor 2');
  lauf(P, 20);
  const nach = g.ship.shields.alloc.slice();
  ok(nach[2] >= 4 && nach[0] < vor[0], `Heck bekommt die Schilde (${vor.join(',')} -> ${nach.join(',')})`);
  lauf(P, 25);
  const spaet = g.ship.shields.alloc.slice();
  ok(spaet[2] >= 4 && spaet[2] >= nach[2] && spaet[0] <= nach[0], `die Einstellung haelt weitere 25 s gegen die Automatik (${spaet.join(',')}), obwohl der Gegner am Bug steht`);
  ok(befehl(P, 'tech.schild', { sektor: 'bug' }) === 'tech.schild.ok' && agent(P, 'technik').absicht.halten.schild === 0, 'ein Gegenbefehl ersetzt die Einstellung');
  lauf(P, 20);
  ok(g.ship.shields.alloc[0] >= 4, `Bug wieder voll (${g.ship.shields.alloc.join(',')})`);
  g.ship.systems.emitter_aft = 'broken';
  ok(befehl(P, 'tech.schild', { sektor: 'heck' }) === 'tech.schild.unmoeglich.system', 'Heck-Emitter zerstoert: unmoeglich system');
  g.ship.systems.emitter_aft = 'ok'; g.ship.systems.shields = 'broken';
  ok(befehl(P, 'tech.schild', { sektor: 'bug' }) === 'tech.schild.unmoeglich.system', 'Schilde zerstoert: unmoeglich system');
  g.ship.systems.shields = 'ok';
  ok(fehlerOk(P), 'game.errors leer');
}
{
  // tech.prio: Feuer brennt, kein Gegner: der Standard stellt "Feuer zuerst", der Befehl "Leck zuerst" bleibt
  const P = partie({}); const { g } = P; frei(P);
  const ct = W.CONSOLE_TILES.helm[0]; const t = W.accessTiles(W.ship, W.shipWalkable, ct.x, ct.y)[0];
  ok(interior.addFire(g, t.x, t.y), 'Ausgangslage: ein Feuer an Bord');
  lauf(P, 6);
  ok(g.ship.priority === 'fire', 'Standard: Feuer zuerst (ship.priority fire)');
  ok(befehl(P, 'tech.prio', { ziel: 'leck' }) === 'tech.prio.ok' && agent(P, 'technik').absicht.halten.prio.wert === 'breach', 'tech.prio leck: ok');
  lauf(P, 10);
  ok(g.ship.priority === 'breach', 'Leck zuerst: ship.priority breach');
  const brennt = () => { interior.addFire(g, t.x, t.y); return false; };   // das Feuer bleibt (die Schrauber loeschen es sonst)
  lauf(P, 25, brennt);
  ok(g.ship.priority === 'breach' && g.ship.fireList.length > 0, 'bleibt 25 s stehen, obwohl es brennt und der Standard Feuer zuerst setzen wuerde');
  ok(befehl(P, 'tech.prio', { ziel: 'feuer' }) === 'tech.prio.ok'); lauf(P, 4);
  ok(g.ship.priority === 'fire', 'feuer: ok, ship.priority fire');
  // System-Prioritaet: Schilde beschaedigt, vorn in der Liste
  g.ship.systems.thruster_port = 'damaged';
  ok(befehl(P, 'tech.prio', { ziel: 'engines' }) === 'tech.prio.abgelehnt.nicht_jetzt', 'Antrieb heil: nichts zu reparieren, nicht_jetzt');
  g.ship.systems.shields = 'broken';
  const kaputt = () => { g.ship.systems.shields = 'broken'; return false; };   // die Schrauber sollen es nicht reparieren (sonst endet die Prioritaet, siehe W3 unten)
  ok(befehl(P, 'tech.prio', { ziel: 'shields' }) === 'tech.prio.ok'); lauf(P, 6, kaputt);
  ok(g.ship.priority === 'shields' && g.ship.repairQueue.length > 0 && g.ship.repairQueue[0].system === 'shields', `System-Prioritaet: ship.priority shields, Reparaturliste ${JSON.stringify(g.ship.repairQueue.map((q) => q.system))}`);
  // Reaktor zerstoert: die Sonderreparatur geht vor, danach stellt der Bot die gehaltene Prioritaet wieder her
  g.ship.systems.reactor = 'broken'; lauf(P, 6, kaputt);
  ok(g.ship.priority === 'reactor', 'Reaktor zerstoert: Standard-Prioritaet Reaktor geht vor');
  g.ship.systems.reactor = 'ok'; lauf(P, 6, kaputt);
  ok(g.ship.priority === 'shields', 'Reaktor heil: die gehaltene Prioritaet kommt wieder');
  g.ship.systems.shields = 'ok'; g.ship.systems.thruster_port = 'ok';
  g.ship.systems.lafette_5 = 'ok';
  ok(befehl(P, 'tech.prio', { ziel: 'weapon_bow' }) === 'tech.prio.abgelehnt.nicht_jetzt', 'System heil: nicht_jetzt');
  ok(fehlerOk(P), 'game.errors leer');
}
{
  // prioSperre (Nacharbeit): der Befehl steht VOR dem ersten Feuer, memo.firePrio ist noch false: ohne Sperre setzte der Standard "Feuer zuerst" und der Agent stellte "Leck" zurueck (Hin und Her)
  const P = partie({}); const { g } = P; frei(P);
  ok(befehl(P, 'tech.prio', { ziel: 'leck' }) === 'tech.prio.ok', 'tech.prio leck (noch kein Feuer an Bord): ok');
  lauf(P, 4);
  const ct = W.CONSOLE_TILES.helm[0]; const t = W.accessTiles(W.ship, W.shipWalkable, ct.x, ct.y)[0];
  let wechsel = 0; const t0 = g.time;
  lauf(P, 25, () => { interior.addFire(g, t.x, t.y); if (g.ship.priority !== 'breach') wechsel++; return false; });
  ok(g.ship.fireList.length > 0 && wechsel === 0 && cmds(P, 'technik', 'technik.priority', t0).filter((x) => x.msg.target === 'fire').length === 0, `Leck zuerst gilt gegen den Standard (ship.priority nie ausser breach, ${wechsel} Abweichungen, kein technik.priority fire gesendet) trotz Feuer ohne Gegner`);
}
{
  // tech.prio auf ein nicht eingebautes System: direkter Registry-Aufruf (die Annahme laesst nur Systeme des Katalogs zu), Antwort system
  const P = partie({}); frei(P);
  const r = Befehle.befehl(P.g, bot(P, 'technik'), 'tech.prio', { ziel: 'lafette_5' });
  ok(!interior.systemAktiv(P.g, 'lafette_5') && r && r.ok === false && r.code === 'system', `nicht eingebaute Lafette: tech.prio -> system (${JSON.stringify(r)})`);
  ok(!agent(P, 'technik').absicht.halten.prio, 'abgelehnt: keine Prioritaet gesetzt');
}
{
  // W3: eine System-Prioritaet endet, sobald das System heil ist (Grund erledigt, Prioritaet zurueck); danach greift die Standard-Feuerprioritaet. Feuer/Leck bleiben gehalten (siehe oben).
  const P = partie({}); const { g } = P; frei(P);
  g.ship.systems.shields = 'damaged';
  ok(befehl(P, 'tech.prio', { ziel: 'shields' }) === 'tech.prio.ok', 'Schilde beschaedigt: tech.prio shields ok');
  lauf(P, 3);
  ok(g.ship.priority === 'shields' && /Schildgenerator/.test(Status.text(g, agent(P, 'technik'))), `System-Prioritaet gilt (ship.priority ${g.ship.priority}, Status "${Status.text(g, agent(P, 'technik'))}")`);
  g.ship.systems.shields = 'ok'; lauf(P, 4);
  const te = agent(P, 'technik');
  ok(!te.absicht.halten.prio && te.befehlGrund === 'erledigt' && g.ship.priority === null, `Schilde heil: die Prioritaet endet (Grund ${te.befehlGrund}, ship.priority ${g.ship.priority})`);
  ok(!/Schildgenerator|zuerst/.test(Status.text(g, te)), 'der Status nennt sie nicht mehr: "' + Status.text(g, te) + '"');
  const tiles = ['helm', 'weapons', 'technik'].map((k) => { const c = W.CONSOLE_TILES[k][0]; return W.accessTiles(W.ship, W.shipWalkable, c.x, c.y)[0]; });
  const t0 = g.time;
  lauf(P, 8, () => { for (const q of tiles) interior.addFire(g, q.x, q.y); return false; });
  ok(g.ship.priority === 'fire' && cmds(P, 'technik', 'technik.priority', t0).some((x) => x.msg.target === 'fire'), `mehrere Braende, kein Gegner: die Standard-Feuerprioritaet greift wieder (ship.priority ${g.ship.priority})`);
  ok(fehlerOk(P), 'game.errors leer');
}
{
  // tech.reparieren
  const P = partie({}); const { g } = P; frei(P);
  ok(befehl(P, 'tech.reparieren', { system: 'thruster_port' }) === 'tech.reparieren.abgelehnt.nicht_jetzt', 'heiles System: nicht_jetzt');
  ok(befehl(P, 'tech.reparieren', { system: 'lafette_5' }) === 'tech.reparieren.unmoeglich.system', 'nicht eingebaute Lafette: unmoeglich system');
  ok(befehl(P, 'tech.reparieren', { system: 'lafette_9' }) === 'tech.reparieren.unmoeglich.system', 'zweite nicht eingebaute Lafette: unmoeglich system');
  g.ship.systems.thruster_port = 'broken';
  const antwort = befehl(P, 'tech.reparieren', { system: 'thruster_port' });
  ok(antwort === 'tech.reparieren.ok' && g.ship.repairQueue.some((q) => q.system === 'thruster_port'), `thruster_port zerstoert: ok, steht sofort in der Reparaturliste ${JSON.stringify(g.ship.repairQueue)}`);
  const fertig = lauf(P, 240, () => g.ship.systems.thruster_port === 'ok');
  ok(fertig, `die Reparatur laeuft: thruster_port wieder heil nach ${(g.time).toFixed(0)} s Spielzeit`);
  ok(fehlerOk(P), 'game.errors leer');
  // Liste voll
  const Q = partie({}); frei(Q);
  for (const s of ['thruster_port', 'thruster_stbd', 'emitter_bow', 'emitter_aft']) Q.g.ship.systems[s] = 'damaged';
  Q.g.ship.systems.engines = 'damaged';
  Q.g.ship.repairQueue.length = 0;
  const r = ['thruster_port', 'thruster_stbd', 'emitter_bow', 'emitter_aft', 'engines'].map((s) => befehl(Q, 'tech.reparieren', { system: s }));
  ok(r.slice(0, 3).every((x) => x === 'tech.reparieren.ok') && r[3] === 'tech.reparieren.abgelehnt.nicht_jetzt', `Reparaturliste voll (drei Plaetze): der vierte Eintrag wird abgelehnt (${r.join(' ')})`);
}
{
  // tech.energie
  const P = partie({}); const { g } = P; frei(P);
  const pw0 = Object.assign({}, g.ship.power);
  ok(befehl(P, 'tech.energie', { system: 'engines', delta: -1 }) === 'tech.energie.ok' && g.ship.power.engines === pw0.engines - 1, `weniger Energie auf Antrieb: ok (${pw0.engines} -> ${g.ship.power.engines})`);
  lauf(P, 15);
  ok(g.ship.power.engines === pw0.engines - 1, 'die Einstellung bleibt 15 s stehen (die Technik-Automatik verteilt nie Energie)');
  ok(befehl(P, 'tech.energie', { system: 'engines', delta: 1 }) === 'tech.energie.ok' && g.ship.power.engines === pw0.engines, 'mehr Energie auf Antrieb: ok, zurueck');
  g.ship.power.shields = g.C.power.maxPerSystem;
  ok(befehl(P, 'tech.energie', { system: 'shields', delta: 1 }) === 'tech.energie.abgelehnt.nicht_jetzt' && g.ship.power.shields === g.C.power.maxPerSystem, 'Grenze erreicht: nicht_jetzt');
  g.ship.power.shields = pw0.shields;
  g.ship.systems.engines = 'broken';
  ok(befehl(P, 'tech.energie', { system: 'engines', delta: 1 }) === 'tech.energie.unmoeglich.system', 'Antrieb zerstoert: unmoeglich system');
  g.ship.systems.engines = 'ok';
  ok(cmds(P, 'technik', 'technik.power').length >= 2, 'gesendet wurde technik.power ueber den Wachposten');
  ok(fehlerOk(P), 'game.errors leer');
}
{
  // tech.ueberladen
  const P = partie({}); const { g } = P; frei(P);
  ok(befehl(P, 'tech.ueberladen') === 'tech.ueberladen.ok' && g.ship.reactorCtl.state === 'overload', 'tech.ueberladen: ok, der Reaktor ist ueberladen (ohne Rueckfrage des Servers)');
  ok(befehl(P, 'tech.ueberladen') === 'tech.ueberladen.abgelehnt.nicht_jetzt', 'schon ueberladen: nicht_jetzt');
  g.ship.reactorCtl.state = 'normal'; g.ship.systems.reactor = 'broken';
  ok(befehl(P, 'tech.ueberladen') === 'tech.ueberladen.unmoeglich.system', 'Reaktor zerstoert: unmoeglich system');
  g.ship.systems.reactor = 'ok';
  ok(fehlerOk(P), 'game.errors leer');
}

// ---------- 6 bot.status, bot.automatik ----------
section('6 bot.status und bot.automatik');
{
  const P = partie({}); const { g } = P; frei(P);
  const e = gegner(P, 'korvette', 450, 0); g.ship.target = e.id;
  const status = (an) => senden(P, 'bot.status', {}, { an });
  const a1 = status('ops'), a2 = status('technik'), a3 = status('navigation');
  const T = (a) => (a.length === 1 ? a[0].text : null);
  ok([a1, a2, a3].every((a) => a.length === 1 && a[0].status === 'ok' && a[0].textId === 'bot.status.ok' && typeof a[0].variante === 'number'), 'bot.status: je Bot eine Antwort ok mit textId bot.status.ok und variante');
  ok([a1, a2, a3].every((a) => T(a) && T(a).length <= 90 && !/\n/.test(T(a)) && !TEXTE['bot.status.ok'].includes(T(a)) && !T(a).includes('K0')), `der Text kommt aus dem Zustand, ist knapp (<= 90) und nennt keinen Spielernamen: "${T(a1)}" | "${T(a2)}" | "${T(a3)}"`);
  const alle = status('alle');
  ok(alle.length === 3 && alle.every((a) => a.botId && a.text), 'bot.status an alle: drei Antworten mit Text, je botId');
  befehl(P, 'ops.feuer_halt'); befehl(P, 'tech.schild', { sektor: 'heck' });
  const b1 = T(status('ops')), b2 = T(status('technik'));
  ok(/gehalten/.test(b1) && b1 !== T(a1), `der Text folgt dem Zustand: Ops "${b1}"`);
  ok(/Heck/.test(b2) && b2 !== T(a2), `der Text folgt dem Zustand: Technik "${b2}"`);
  befehl(P, 'ops.feuer_frei', { waffen: 'bb' });
  ok(/Backbord/.test(T(status('ops'))), 'Ops nennt die Waffengruppe: "' + T(status('ops')) + '"');
  // Satzanfang gross, echte Umlaute (Nacharbeit)
  g.ship.reactorCtl.state = 'overload';
  const tu = Status.text(g, agent(P, 'technik'));
  g.ship.reactorCtl.state = 'normal'; g.ship.systems.thruster_port = 'damaged';
  const tx = Status.text(g, agent(P, 'technik'));
  ok(/überladen/.test(tu) && /Schäden/.test(tx) && !/ueberl|Schaeden/.test(tu + tx), `Statustext: echte Umlaute ("${tu}" | "${tx}")`);
  g.ship.systems.thruster_port = 'ok';
  g.ship.systems.shields = 'damaged'; befehl(P, 'tech.prio', { ziel: 'shields' });
  const sg = Status.text(g, agent(P, 'technik'));
  ok(/^[A-ZÄÖÜ]/.test(sg) && /zuerst/.test(sg), `System-Prioritaet im Status mit grossem Anfang ("${sg}")`);
  g.ship.systems.shields = 'ok'; befehl(P, 'bot.automatik', undefined, { an: 'technik' }); lauf(P, 4);
  // kein Text bei anderen Befehlen: die Variante aus texte.json, nie der Registry-Text
  const orig = Befehle.REGISTER.ops['ops.scan'];
  Befehle.REGISTER.ops['ops.scan'] = () => ({ ok: true, text: 'GEHEIMER REGISTRY TEXT' });
  const x = senden(P, 'ops.scan', {}, { an: 'ops' });
  Befehle.REGISTER.ops['ops.scan'] = orig;
  ok(x.length === 1 && x[0].textId === 'ops.scan.ok' && TEXTE['ops.scan.ok'].includes(x[0].text), 'andere Befehle: der Registry-Text wird ignoriert, es bleibt die Variante aus texte.json');
  const y = senden(P, 'ops.feuer_halt', {}, { an: 'ops' });
  ok(y.length === 1 && TEXTE['ops.feuer_halt.ok'].includes(y[0].text), 'ops.feuer_halt: Text aus texte.json');
  // Zeilenumbrueche raus, Laenge begrenzt
  Befehle.REGISTER.bot['bot.status'] = () => ({ ok: true, text: 'Zeile eins\nZeile zwei\r\n' + 'x'.repeat(400) });
  const z = senden(P, 'bot.status', {}, { an: 'ops' });
  delete require.cache[require.resolve('../server/bots/befehle/bot.js')];
  Befehle.REGISTER.bot['bot.status'] = require('../server/bots/befehle/bot.js')['bot.status'];
  ok(z.length === 1 && !/[\r\n]/.test(z[0].text) && z[0].text.length <= 120 && z[0].text.startsWith('Zeile eins Zeile zwei'), 'Statustext: Zeilenumbrueche entfernt, Laenge begrenzt');
  // bot.status wartet auch: Antwort ok (kein wartet-Grund fuer bot.*)
  neben(g, P.h, 'weapons'); eTaste(g, P.c); lauf(P, 1);
  const w = status('ops');
  ok(agent(P, 'ops').absicht.zustand === 'wartet' && w.length === 1 && w[0].status === 'ok' && /warte/.test(w[0].text), 'Mensch an der Ops: bot.status antwortet trotzdem ("' + (w[0] && w[0].text) + '")');
  g.handleMessage(P.c, { t: 'leave' }); lauf(P, 30, () => Station.stationOf(bot(P, 'ops')) === 'weapons'); lauf(P, 1);
  ok(fehlerOk(P), 'game.errors leer');
}
{
  const P = partie({}); const { g } = P; frei(P);
  const e = gegner(P, 'korvette', 700, 0); capZiel(g, e.id);
  senden(P, 'nav.kurs', { ziel: 'marke' }, { an: 'navigation' });
  befehl(P, 'ops.ziel', { ziel: 'markiert' }); befehl(P, 'ops.feuer_halt'); befehl(P, 'ops.scan');
  befehl(P, 'tech.schild', { sektor: 'heck' }); befehl(P, 'tech.prio', { ziel: 'leck' });
  lauf(P, 8);
  const nav = agent(P, 'navigation'), op = agent(P, 'ops'), te = agent(P, 'technik');
  ok(nav.absicht.befehl && op.absicht.befehl && op.absicht.feuer === 'halt' && Object.keys(te.absicht.halten).length === 2 && g.ship.priority === 'breach', 'Ausgangslage: alle drei Rollen tragen eine Absicht');
  const a = senden(P, 'bot.automatik', {}, { an: 'alle' });
  ok(a.length === 3 && a.every((x) => x.status === 'ok' && x.textId === 'bot.automatik.ok'), 'bot.automatik an alle: drei Antworten ok');
  ok([nav, op, te].every((x) => x.absicht.standard && !x.absicht.befehl && !x.absicht.feuer && !x.absicht.waffen && Object.keys(x.absicht.halten).length === 0 && x.befehlGrund === 'automatik'), 'die Absicht aller drei Rollen ist geloescht (Navigation, Ops-Zustand, Technik-Einstellungen), Grund automatik');
  lauf(P, 12);
  ok(g.ship.priority !== 'breach', `die gehaltene Prioritaet ist zurueckgenommen (${g.ship.priority})`);
  const t0 = g.time; lauf(P, 20);
  ok(feuerCmds(P, t0).length > 0 || P.lanze > 0 || g.ship.target === e.id, 'Ops im Standard: Marke aufgeschaltet / feuert wieder');
  const e2 = senden(P, 'bot.automatik', {}, { an: 'b0' }), e3 = senden(P, 'bot.automatik', {}, { an: 'alle' });
  ok(e3.length === 3 && e3.every((x) => x.status === 'ok') && e2.length === 1 && e2[0].status === 'ok', 'bot.automatik ohne Absicht: ok (auch an eine botId)');
  ok(fehlerOk(P), 'game.errors leer');
}

// ---------- 7 Ablehnungen ----------
section('7 Ablehnungen: wartet, nicht_jetzt, textIds');
{
  const P = partie({}); const { g, h, c } = P; frei(P);
  const e = gegner(P, 'korvette', 450, 0); capZiel(g, e.id);
  neben(g, h, 'weapons'); eTaste(g, c); lauf(P, 1);
  ok(h.console === 'weapons' && agent(P, 'ops').absicht.zustand === 'wartet', 'Mensch sitzt an der Ops, der Bot wartet');
  const sechs = [['ops.ziel', { ziel: 'markiert' }], ['ops.feuer_frei', {}], ['ops.feuer_halt'], ['ops.scan'], ['ops.landescan'], ['ops.beamen', { was: 'fracht' }]];
  ok(sechs.every(([nm, ar]) => befehl(P, nm, ar) === nm + '.abgelehnt.wartet') && !agent(P, 'ops').absicht.befehl && !agent(P, 'ops').absicht.feuer, 'alle sechs Ops-Befehle: abgelehnt wartet, keine Absicht');
  ok(befehl(P, 'tech.schild', { sektor: 'bug' }) === 'tech.schild.ok', 'der Technik-Bot ist davon unberuehrt');
  g.handleMessage(c, { t: 'leave' });
  const Q = partie({}); frei(Q); neben(Q.g, Q.h, 'technik'); eTaste(Q.g, Q.c); lauf(Q, 1);
  const fuenf = [['tech.prio', { ziel: 'feuer' }], ['tech.reparieren', { system: 'engines' }], ['tech.schild', { sektor: 'bug' }], ['tech.energie', { system: 'engines', delta: 1 }], ['tech.ueberladen']];
  ok(agent(Q, 'technik').absicht.zustand === 'wartet' && fuenf.every(([nm, ar]) => befehl(Q, nm, ar) === nm + '.abgelehnt.wartet'), 'Mensch an der Technik: alle fuenf Technik-Befehle abgelehnt wartet');
  const R = partie({}); frei(R); bot(R, 'technik').console = null;
  ok(['tech.reparieren', 'tech.energie', 'tech.ueberladen'].every((nm) => befehl(R, nm, nm === 'tech.reparieren' ? { system: 'engines' } : nm === 'tech.energie' ? { system: 'engines', delta: 1 } : undefined) === nm + '.abgelehnt.nicht_jetzt'), 'Technik-Bot nicht an der Konsole: reparieren, energie, ueberladen abgelehnt nicht_jetzt');
}

// ---------- 8 Mensch gewinnt ----------
section('8 Mensch gewinnt: Absicht verworfen, Bot sendet nichts, danach Standard');
{
  const P = partie({}); const { g, h, c } = P; frei(P);
  const e = gegner(P, 'korvette', 450, 0); capZiel(g, e.id);
  befehl(P, 'ops.ziel', { ziel: 'markiert' }); befehl(P, 'ops.feuer_frei', { waffen: 'bug' }); lauf(P, 3);
  ok(!!agent(P, 'ops').absicht.befehl && agent(P, 'ops').absicht.feuer === 'frei' && agent(P, 'ops').absicht.waffen === 'bug', 'Ops traegt Ziel und Feuerzustand');
  neben(g, h, 'weapons'); const t0 = g.time; eTaste(g, c);
  ok(h.console === 'weapons' && agent(P, 'ops').absicht.zustand === 'wartet', 'Mensch setzt sich an die Ops');
  lauf(P, 0.3);
  const op = agent(P, 'ops');
  ok(!op.absicht.befehl && !op.absicht.feuer && !op.absicht.waffen && op.absicht.standard && op.befehlGrund === 'mensch', 'die Absicht (Ziel, Feuerzustand, Waffengruppe) ist verworfen (Mensch gewinnt)');
  const n1 = cmds(P, 'ops', null, t0).length; lauf(P, 10);
  ok(cmds(P, 'ops', null, t0).length === n1, 'der Ops-Bot sendet nichts, solange der Mensch an der Konsole sitzt');
  g.handleMessage(c, { t: 'leave' });
  const zurueck = lauf(P, 30, () => Station.stationOf(bot(P, 'ops')) === 'weapons'); lauf(P, 1);
  ok(zurueck && op.absicht.zustand === 'an_station' && op.absicht.standard && !op.absicht.feuer, 'Mensch geht: der Bot uebernimmt im Standardverhalten (kein alter Zustand)');
  const t1 = g.time; lauf(P, 15);
  ok(feuerCmds(P, t1).length > 0 || P.lanze > 0, 'Standard: der Bot feuert ohne Einschraenkung (Bug-Gegner, die Gruppe bug waere erlaubt, bb ist es nie)');
  ok(fehlerOk(P), 'game.errors leer');
}
{
  const P = partie({}); const { g, h, c } = P; frei(P);
  befehl(P, 'tech.schild', { sektor: 'heck' }); befehl(P, 'tech.prio', { ziel: 'leck' }); lauf(P, 8);
  const te = agent(P, 'technik');
  ok(Object.keys(te.absicht.halten).length === 2, 'Technik traegt Schild und Prioritaet');
  neben(g, h, 'technik'); const t0 = g.time; eTaste(g, c); lauf(P, 0.3);
  ok(h.console === 'technik' && te.absicht.zustand === 'wartet' && Object.keys(te.absicht.halten).length === 0 && te.absicht.standard && te.befehlGrund === 'mensch', 'Mensch setzt sich an die Technik: die Einstellungen sind verworfen (Mensch gewinnt)');
  g.handleMessage(c, { t: 'cmd', c: 'technik.priority', target: 'fire' }); const n1 = cmds(P, 'technik', null, t0).length;
  lauf(P, 10);
  ok(cmds(P, 'technik', null, t0).length === n1 && g.ship.priority === 'fire', 'der Technik-Bot sendet nichts, die Eingabe des Menschen bleibt');
  g.handleMessage(c, { t: 'leave' });
  const zurueck = lauf(P, 30, () => Station.stationOf(bot(P, 'technik')) === 'technik'); lauf(P, 1);
  ok(zurueck && te.absicht.standard && Object.keys(te.absicht.halten).length === 0 && fehlerOk(P), 'Mensch geht: Technik im Standardverhalten, keine alten Einstellungen, keine Fehler');
}
{
  // W2: die vom Bot gesetzte Prioritaet bleibt nicht im Schiff stehen, wenn ein Mensch uebernimmt
  const P = partie({}); const { g, h, c } = P; frei(P);
  befehl(P, 'tech.prio', { ziel: 'leck' }); lauf(P, 8);
  ok(g.ship.priority === 'breach', 'Ausgangslage: Leck zuerst steht im Schiff');
  neben(g, h, 'technik'); eTaste(g, c);
  ok(h.console === 'technik' && g.ship.priority === null, 'Mensch setzt sich an die Technik: die Prioritaet des Bots ist weg, bevor er sie sieht (sofort, ohne Tick)');
  lauf(P, 1); g.handleMessage(c, { t: 'leave' });
  const zurueck = lauf(P, 30, () => Station.stationOf(bot(P, 'technik')) === 'technik'); lauf(P, 40);
  ok(zurueck && g.ship.priority === null && agent(P, 'technik').absicht.standard, `Mensch geht, 40 s Standard: ship.priority ${g.ship.priority} (nicht mehr breach), keine Absicht`);
  // eine Prioritaet des Menschen bleibt unangetastet (auch wenn der Bot noch eine andere haelt)
  const te = agent(P, 'technik');
  Lauf.agent(g, bot(P, 'technik')).haltenSetzen('prio', { wert: 'breach' }); g.ship.priority = 'fire';
  ok(te.prioritaetZuruecknehmen() === false && g.ship.priority === 'fire', 'ship.priority ist nicht die gehaltene (Mensch gesetzt): bleibt unangetastet');
  te.alleVerwerfen('test');
  // Raeumen: ein Mensch verdraengt den Technik-Bot (letzter Platz)
  const Q = partie({}); frei(Q);
  befehl(Q, 'tech.prio', { ziel: 'leck' }); lauf(Q, 8);
  ok(Q.g.ship.priority === 'breach', 'Raeumen: Leck zuerst steht');
  ok(BotSpieler.botVerdraengtFuerMensch(Q.g) === true && Q.g.ship.priority === null, 'der Platz wird geraeumt: die Prioritaet des Bots ist weg');
  ok(fehlerOk(P) && fehlerOk(Q), 'game.errors leer');
}
{
  // Bewusstlos (downed): Ops- und Technik-Absichten und Haltezustaende enden (Grund unten), die Prioritaet geht zurueck; der Status meldet es
  const P = partie({}); const { g } = P; frei(P);
  const e = gegner(P, 'korvette', 450, 0); g.ship.target = e.id;
  befehl(P, 'ops.feuer_halt'); befehl(P, 'ops.ziel', { ziel: 'naechstes' }); befehl(P, 'tech.prio', { ziel: 'leck' }); befehl(P, 'tech.schild', { sektor: 'heck' }); lauf(P, 6);
  ok(g.ship.priority === 'breach' && agent(P, 'ops').absicht.feuer === 'halt', 'Ausgangslage: Feuerhalt, Ziel, Leck zuerst, Schild heck');
  const po = bot(P, 'ops'), pt = bot(P, 'technik');
  po.downed = true; pt.downed = true; lauf(P, 1);
  const op = agent(P, 'ops'), te = agent(P, 'technik');
  ok(op.absicht.standard && te.absicht.standard && !op.absicht.feuer && !op.absicht.befehl && Object.keys(te.absicht.halten).length === 0 && op.befehlGrund === 'unten' && te.befehlGrund === 'unten', 'bewusstlos: Ops- und Technik-Absichten sind verworfen (Grund unten)');
  ok(g.ship.priority === null, 'bewusstlos: die Prioritaet des Bots ist zurueckgenommen');
  ok(/Bewusstlos/.test(Status.text(g, op)) && /Bewusstlos/.test(Status.text(g, te)) && !/Feuer/.test(Status.text(g, op)), `Status: "${Status.text(g, op)}"`);
  po.downed = false; pt.downed = false; lauf(P, 3);
  const t0 = g.time; lauf(P, 15);
  ok(op.absicht.standard && g.ship.priority !== 'breach' && (feuerCmds(P, t0).length > 0 || P.lanze > 0), 'danach Standardverhalten: kein altes Feuerhalt, der Bot feuert wieder');
  // nicht an Bord (zone != ship)
  befehl(P, 'ops.feuer_halt'); befehl(P, 'tech.schild', { sektor: 'bug' });
  const zone0 = po.zone; po.zone = 'away'; pt.zone = 'away'; lauf(P, 0.3);
  const verworfen = op.absicht.standard && te.absicht.standard && op.befehlGrund === 'unten';
  const stext = Status.text(g, op);
  po.zone = zone0; pt.zone = zone0;
  ok(verworfen && /Nicht an Bord/.test(stext), `zone != ship: die Absichten enden (unten), Status "${stext}"`);
  ok(fehlerOk(P), 'game.errors leer');
}
{
  // Absicht endet mit dem Spiel
  const P = partie({}); frei(P);
  befehl(P, 'ops.feuer_halt'); const alt = agent(P, 'ops'); P.g.reset && P.g.reset('test'); lauf(P, 1);
  ok(Lauf.agent(P.g, bot(P, 'ops')) !== alt, 'Reset: der Lauf (mit seinen Absichten) ist verworfen');
}

// ---------- 9 Reine Menschenpartie ----------
section('9 Reine Menschenpartie ohne Bot-Code');
{
  // Ohne Bots laeuft kein Bot-Code: kein Agent, keine Absicht, kein Aufruf von tick/opsDienst/technikDienst/Absicht-Setzern; bot.befehl wird nur mit unmoeglich.kein_bot beantwortet. Der Byte-Vergleich der
  // Menschenpartie (Nachrichten, Snapshots) ist der Golden-Lauf (tools/golden-trace.js --all, diff gegen die Basis); ein Vergleich des Laufs mit sich selbst bewiese nichts.
  // Den Quellscan der Registries (server/bots/befehle/*.js, schaerfer: Aufrufe, Zuweisungen mit Klammern, .cmd/.send) fuehrt tools/test-bot-befehle-nav.js Abschnitt 11 fuer alle Dateien dort.
  const NAMEN = ['tick', 'opsDienst', 'technikDienst', 'befehlSetzen', 'feuerSetzen', 'haltenSetzen', 'prioritaetZuruecknehmen'];
  const zaehl = {}; const alt = {};
  for (const k of NAMEN) { zaehl[k] = 0; alt[k] = BotMannschaft.prototype[k]; BotMannschaft.prototype[k] = function (...a) { zaehl[k]++; return alt[k].apply(this, a); }; }
  let nSnap = 0; const antworten = [];
  try {
    for (const [start, seed] of [['arena_space', 5], ['m3', 6]]) {
      const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
      const g = new Game({ noStore: true, seed, worldDir: dir, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
      const c = mkConn(); g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'M0', name: 'M0', color: 0 });
      g.lobbyOpts.startMission = start; g.handleMessage(c, { t: 'ready', ready: true });
      for (let i = 0; i < 400; i++) {
        if (i === 100) interior.enterConsole(g, c.player, 'weapons');
        if (i === 150) for (const [an, bef, args] of [['ops', 'ops.ziel', { ziel: 'naechstes' }], ['ops', 'ops.feuer_halt'], ['technik', 'tech.schild', { sektor: 'heck' }], ['technik', 'tech.prio', { ziel: 'leck' }], ['alle', 'bot.automatik']]) g.handleMessage(c, { t: 'bot.befehl', an, befehl: bef, args, quelle: 'menu' });
        if (i === 200) g.handleMessage(c, { t: 'cmd', c: 'weapons.scan', on: true });
        g.step();
        if (g.wantsSnapshot()) { g.snapshot(); nSnap++; }
      }
      antworten.push(...c.inbox.filter((x) => x.t === 'bot.antwort').map((x) => x.textId));
      ok(Lauf.agenten(g).length === 0 && g.errors === 0, `${start}: ohne Bots kein Lauf, keine Agenten, keine Fehler`);
    }
  } finally { for (const k of NAMEN) BotMannschaft.prototype[k] = alt[k]; }
  ok(nSnap > 40 && NAMEN.every((k) => zaehl[k] === 0), `Menschenpartie (mit fuenf bot.befehl): kein Bot-Code laeuft (${NAMEN.map((k) => k + ' ' + zaehl[k]).join(', ')}; ${nSnap} Snapshots)`);
  ok(antworten.length === 10 && antworten.every((x) => /\.unmoeglich\.kein_bot$/.test(x)), 'jeder bot.befehl ohne Bot wird nur beantwortet (unmoeglich kein_bot), setzt nichts: ' + antworten.join(' '));
}

console.log(`\ntest-bot-befehle-ops-tech: ${n - fails}/${n} ok`);
if (fails) process.exit(1);
