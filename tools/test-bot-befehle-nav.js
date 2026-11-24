'use strict';
// BOT-01 C2a: die Navigations-Befehle des Katalogs v1 wirken im Server-Bot (server/bots/befehle/navigation.js, Ausfuehrung im Agenten mannschaft.js, Ziele navziel.js). Echtes Game, Server-Bots, Befehle ueber bot.befehl.
//   1. Registry: sieben Befehle, Rueckgabe { ok } / { ok:false, code } mit Codes aus gruende.json
//   2. nav.schub: Stufe setzen und halten (Schub n, halb, voll), auch im Gefecht
//   3. nav.stopp und nav.ausweichen
//   4. nav.kurs (marke, ziel, objekt, basis): das Schiff kommt an (je zwei Seeds und Ausgangslagen), steht danach; Ziel verschwindet: Bot haelt an; kein_ziel
//   5. nav.abstand: haelt den Abstand ueber eine Wartezeit (Gegner: Breitseite, Station: fester Punkt), Standardwerte (Captain-Marke, dann Ops-Marke), kein_ziel
//   6. nav.andocken: Anflug und Andocken (zwei Ausgangslagen), kein_ziel ohne Dock, schon angedockt
//   7. nav.sprung: Sprung (marke, hex mit Route), kein_ziel, nicht_jetzt
//   8. Ablehnungen: nicht_jetzt (Aussenteam unten), system (Antrieb zerstoert), wartet (Mensch an der Steuer), jede Antwort mit passender textId
//   9. Mensch gewinnt: Absicht verworfen, Bot sendet nichts, Bot uebernimmt im Standardverhalten; Notsprung hat Vorrang; Aussenteam beendet den Kurs; ein anderer Befehl ersetzt den Kurs
//  10. Reine Menschenpartie unveraendert (Nachrichten, Snapshots byte-gleich mit leerem Lauf)
//   node tools/test-bot-befehle-nav.js
//   Mutationsproben: BOT_NAV_MUT=mensch|kein_ziel|abstand node tools/test-bot-befehle-nav.js (muss rot sein, siehe tools/mutation-bot-befehle-nav.js)
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
const { STOP, HALF, FULL } = require('../server/bots/kern.js');
const GRUENDE = require('../content/bots/gruende.json');

const MUT = process.env.BOT_NAV_MUT || '';
if (MUT === 'mensch') { const alt = BotMannschaft.prototype.befehlVerwerfen; BotMannschaft.prototype.befehlVerwerfen = function (grund) { return grund === 'mensch' ? false : alt.call(this, grund); }; }
if (MUT === 'kein_ziel') Navziel.aufloesen = () => ({ art: 'objekt', id: 'gibtsnicht' });
if (MUT === 'abstand') BotMannschaft.prototype.abstandAusfuehren = function () { return true; };

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-botnav-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
let seq = 0;

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
  g.lobbyOpts.startMission = o.start || 'arena_space';
  g.handleMessage(c, { t: 'ready', ready: true });
  const P = { g, c, h: c.player, spy, fest: [], uhr: 1e12 };
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
  probe('nav.kurs', { ziel: 'marke' }); probe('nav.abstand', {}); probe('nav.andocken', {}); probe('nav.sprung', { ziel: 'marke' }); probe('nav.schub', { stufe: 2 }); probe('nav.stopp', {}); probe('nav.ausweichen', {});
  ok(Array.from(codes).every((k) => GRUENDE.befehle[k.split(':')[0]].includes(k.split(':')[1])), 'jeder Code steht fuer seinen Befehl in gruende.json: ' + Array.from(codes).join(' '));
  ok(Befehle.befehl(P.g, bot(P), 'nav.schub', { stufe: 3 }).ok === true && Lauf.agent(P.g, bot(P)).absicht.befehl.name === 'nav.schub', 'der Befehl traegt die Absicht (name) im Agenten');
  ok(!JSON.stringify(P.g.snapshot()).includes('nav.schub') && !('absicht' in bot(P)), 'die Absicht steht weder im Snapshot noch im Spielerobjekt');
}

// ---------- 2 nav.schub ----------
section('2 nav.schub: Stufe setzen und halten');
{
  const P = partie({}); const { g } = P;
  setze(P, 1100, 1500, 0);
  const beob = (arg, soll, t) => { const a = befehl(P, 'nav.schub', { stufe: arg }); lauf(P, 3); ok(a === 'nav.schub.ok' && g.ship.helm.stage === soll, `${t}: Antwort ok, Stufe ${g.ship.helm.stage} (soll ${soll})`); };
  beob(2, STOP + 2, 'Schub zwei = halbe Kraft'); beob('voll', FULL, 'voll'); beob('halb', HALF, 'halb'); beob(0, STOP, 'Schub null = STOPP'); beob(1, STOP + 1, 'Schub eins'); beob(6, FULL, 'Schub sechs = volle Kraft (mehr gibt die Lerche nicht)');
  befehl(P, 'nav.schub', { stufe: 'halb' }); lauf(P, 2);
  const e = gegner(P, 'korvette', g.ship.x + 650, g.ship.y + 250);
  lauf(P, 12);
  ok(g.ship.helm.stage === HALF, `im Gefecht (Korvette da) bleibt die Stufe des Captains stehen (${g.ship.helm.stage}, ohne Befehl wuerde helmFight sie aendern)`);
  void e;
  ok(fehlerOk(P), 'game.errors leer');
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
  befehl(P, 'nav.schub', { stufe: 2 }); lauf(P, 1); g.ship.dodgeCd = 0;
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
    const P = vorbereiten(7); const { g } = P;
    const antwort = befehl(P, 'nav.sprung', { ziel: 'hex:0306' }); const t0 = g.time;
    const gesprungen = lauf(P, 150, () => g.ship.scene !== 'hafen');
    ok(antwort === 'nav.sprung.ok' && gesprungen && g.ship.scene === 'splitter', `hex:0306: der Bot fliegt zum Sprungpunkt und springt (Szene ${g.ship.scene} nach ${(g.time - t0).toFixed(1)} s)`);
    ok(cmds(P, 'helm.jump').length === 1 && cmds(P, 'helm.schnellsprung').length === 0, 'einzelner Hop: helm.jump');
    lauf(P, 2);
    ok(!agent(P).absicht.befehl && agent(P).befehlGrund === 'szene' && fehlerOk(P), 'danach keine Absicht mehr, keine Fehler');
  }
  {
    const P = vorbereiten(11); const { g } = P;
    const antwort = befehl(P, 'nav.sprung', { ziel: 'hex:0406' });
    ok(antwort === 'nav.sprung.ok' && !!g.reisePlan && g.reisePlan.hops.join() === '0306,0406', 'hex:0406 (zwei Hops): Route gewaehlt wie vom Captain (captain.selectDest)');
    lauf(P, 150, () => g.ship.scene !== 'hafen'); lauf(P, 12);
    ok(g.ship.scene === 'b7' && !g.reise && cmds(P, 'helm.schnellsprung').length === 1, `mit gewaehlter Route: helm.schnellsprung, alle Hops (Szene ${g.ship.scene})`);
  }
  {
    const P = vorbereiten(7); const { g } = P;
    ok(befehl(P, 'nav.sprung', { ziel: 'marke' }) === 'nav.sprung.abgelehnt.kein_ziel', 'marke ohne gewaehltes Sprungziel: kein_ziel');
    Sprung.selectDest(g, '0306'); lauf(P, 1);
    ok(befehl(P, 'nav.sprung', { ziel: 'marke' }) === 'nav.sprung.ok', 'marke mit gewaehltem Sprungziel: ok');
    lauf(P, 150, () => g.ship.scene !== 'hafen');
    ok(g.ship.scene === 'splitter', 'das gewaehlte Sprungziel wird angesprungen');
    ok(befehl(P, 'nav.sprung', { ziel: 'ziel' }) === 'nav.sprung.abgelehnt.kein_ziel' && befehl(P, 'nav.sprung', { ziel: 'basis' }) === 'nav.sprung.abgelehnt.kein_ziel', 'ziel und basis sind keine Sektoren: kein_ziel');
    ok(befehl(P, 'nav.sprung', { ziel: 'hex:9999' }) === 'nav.sprung.abgelehnt.kein_ziel', 'unbekannter Hex: kein_ziel');
  }
  {
    const P = vorbereiten(7); const { g } = P;
    g.reise = { hops: ['0306'], i: 0, t: 0, ziel: 'splitter', abbruch: false };
    ok(befehl(P, 'nav.sprung', { ziel: 'hex:0306' }) === 'nav.sprung.abgelehnt.nicht_jetzt', 'laufende Reise: nicht_jetzt');
    g.reise = null;
  }
}

// ---------- 8 Ablehnungen ----------
section('8 Ablehnungen: nicht_jetzt, system, wartet');
{
  const P = partie({}); const { g, h } = P;
  setze(P, 1100, 1500, 0);
  const e = gegner(P, 'korvette', g.ship.x + 800, g.ship.y); capZiel(g, e.id);
  const sieben = [['nav.kurs', { ziel: 'marke' }], ['nav.stopp'], ['nav.schub', { stufe: 2 }], ['nav.ausweichen'], ['nav.abstand', {}], ['nav.andocken', {}], ['nav.sprung', { ziel: 'marke' }]];
  // Aussenteam unten
  h.zone = 'away';
  const az = {}; for (const [nm, ar] of sieben) az[nm] = befehl(P, nm, ar);
  h.zone = 'ship';
  ok(['nav.kurs', 'nav.abstand', 'nav.andocken', 'nav.sprung'].every((nm) => az[nm] === nm + '.abgelehnt.nicht_jetzt'), 'Aussenteam unten: nav.kurs, nav.abstand, nav.andocken, nav.sprung abgelehnt nicht_jetzt');
  ok(['nav.stopp', 'nav.schub', 'nav.ausweichen'].every((nm) => az[nm] === nm + '.ok'), 'Aussenteam unten: nav.stopp, nav.schub, nav.ausweichen bleiben moeglich');
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
  const sieben = [['nav.kurs', { ziel: 'marke' }], ['nav.stopp'], ['nav.schub', { stufe: 2 }], ['nav.ausweichen'], ['nav.abstand', {}], ['nav.andocken', {}], ['nav.sprung', { ziel: 'marke' }]];
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
  agent(P).aussenteamUnten = () => true; lauf(P, 1);
  ok(!agent(P).absicht.befehl && agent(P).befehlGrund === 'aussenteam', 'Aussenteam geht nach unten: der Kurs endet (nur Kurs halten wie bisher)');
  befehl(P, 'nav.schub', { stufe: 'voll' }); lauf(P, 3);
  ok(agent(P).absicht.befehl && agent(P).absicht.befehl.name === 'nav.schub' && g.ship.helm.stage === FULL, 'Aussenteam unten: nav.schub bleibt als Absicht und die Stufe steht');
  delete agent(P).aussenteamUnten;
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

// ---------- 10 Reine Menschenpartie ----------
section('10 Reine Menschenpartie unveraendert');
{
  const sha = (noop) => {
    const orig = Lauf.tick; if (noop) Lauf.tick = () => {};
    const h = crypto.createHash('sha1'); let nSnap = 0;
    try {
      for (const [start, seed] of [['arena_space', 5], ['m3', 6]]) {
        const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
        const g = new Game({ noStore: true, seed, worldDir: dir, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
        const c = { send: (o) => h.update(JSON.stringify(o)), sendRaw: (s) => h.update(s) }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'M0', name: 'M0', color: 0 });
        g.lobbyOpts.startMission = start; g.handleMessage(c, { t: 'ready', ready: true });
        for (let i = 0; i < 700; i++) {
          if (i === 100) interior.enterConsole(g, c.player, 'helm');
          if (i === 150) g.handleMessage(c, { t: 'bot.befehl', an: 'navigation', befehl: 'nav.kurs', args: { ziel: 'marke' }, quelle: 'menu' });
          if (i === 200) g.handleMessage(c, { t: 'cmd', c: 'helm.throttle', set: 4 });
          g.step();
          if (g.wantsSnapshot()) { h.update(JSON.stringify(g.snapshot())); nSnap++; }
        }
        h.update(JSON.stringify([g.errors, g.time, g.ship.x, g.ship.y, g.players.map((p) => [p.x, p.y, p.console])]));
        ok(Lauf.agenten(g).length === 0, `${start}: ohne Bots kein Lauf, keine Agenten`);
      }
    } finally { Lauf.tick = orig; }
    return { hash: h.digest('hex'), nSnap };
  };
  const mit = sha(false), ohne = sha(true);
  ok(mit.nSnap > 60 && mit.hash === ohne.hash, `Menschenpartie (mit einem bot.befehl): Snapshots und Nachrichten identisch mit echtem und mit leerem Lauf (${mit.nSnap} Snapshots)`);
  const quelle = fs.readFileSync(path.join(__dirname, '..', 'server', 'bots', 'befehle', 'navigation.js'), 'utf8');
  ok(!/game\.(ship|space)\.[a-zA-Z.]+\s*=[^=]/.test(quelle) && !/\.cmd\(|handleMessage/.test(quelle), 'Quellscan: die Registry schreibt nie Spielzustand und sendet nie selbst (nur Absicht und Agent-Methoden)');
}

console.log(`\ntest-bot-befehle-nav: ${n - fails}/${n} ok`);
if (fails) process.exit(1);
