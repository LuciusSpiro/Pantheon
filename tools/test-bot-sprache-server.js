'use strict';
// BOT-04 D1: Sprache und Textzeile gegen den ECHTEN Server: Matcher -> bot.befehl (quelle sprache / text) über eine Net-Brücke -> Annahme -> Server-Bots -> bot.antwort -> Untertitel der Sprache,
// Quittung und „gilt“ im Menü. Echtes Game mit drei Server-Bots (Navigation, Ops, Technik), kein Bord-Bot. Die Brücke antwortet synchron: die Antwort kommt noch IM send an (der Menü-Eintrag muss schon da sein).
//   node tools/test-bot-sprache-server.js
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const { Game } = require('../server/game.js');
const Station = require('../server/sim/station.js');
const space = require('../server/sim/space.js');
const BotSpieler = require('../server/bots/spieler.js');
const Lauf = require('../server/bots/lauf.js');
const { STOP, HALF, QUARTER, FULL } = require('../server/bots/kern.js');
const BS = require('../public/js/bot-sprache.js');
const BM = require('../public/js/bot-menue.js');
const TK = require('../public/js/pult-befehl-tokens.js');
const M = require('../shared/bot-matcher.js');
const Protocol = require('../shared/protocol.js');
const KANON = require('../content/bots/kanon.json');
const MUSTER = require('../content/bots/muster.json');
const TEXTE = require('../content/bots/texte.json');

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };
const section = (t) => console.log('\n[' + t + ']');
const tick = () => new Promise((r) => setImmediate(r));
M.setzeMuster(Object.assign({}, MUSTER, { kanon: KANON }));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-botsprserver-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });

const STATION = { navigation: 'helm', ops: 'weapons', technik: 'technik' };
const mkConn = () => ({ inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } });
function partie() {
  const dir = path.join(TMP, 'w'); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  g.botZufall = (() => { let a = 42; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const c = mkConn(); g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'K0', color: 0 });
  for (const r of ['navigation', 'ops', 'technik']) BotSpieler.botHinzufuegen(g, null, r);
  g.lobbyOpts.startMission = 'arena_space';
  g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) { g.arena.nextAt = 1e9; g.space.enemies = []; }
  const P = { g, c, fest: [] };
  lauf(P, 40, () => ['navigation', 'ops', 'technik'].every((r) => Station.stationOf(bot(P, r)) === STATION[r])); lauf(P, 1);
  return P;
}
function tickSim(P) {
  const g = P.g;
  for (const e of P.fest) if (g.space.enemies.includes(e)) { e.x = e.pin.x; e.y = e.pin.y; e.angle = e.pin.angle; e.vx = 0; e.vy = 0; e.fireT = -999; e.shields = [0, 0, 0, 0]; e.hp = e.hpMax; }
  g.space.projectiles = g.space.projectiles.filter((q) => q.kind === 'torpedo' || q.waffe || (q.kind !== 'enemy' && q.kind !== 'emp'));
  g.step(); if (g.wantsSnapshot()) g.snapshot();
}
const lauf = (P, sec, bis) => { const t1 = P.g.time + sec; while (P.g.time < t1) { tickSim(P); if (bis && bis()) return true; } return bis ? !!bis() : true; };
const bot = (P, rolle) => P.g.players.find((p) => p.bot && p.rolle === rolle);
const agent = (P, rolle) => Lauf.agent(P.g, bot(P, rolle));

// Net-Brücke: send -> handleMessage des Servers (stehende Uhr gegen das Rate-Fenster), die bot.antwort gehen noch im send an alle Zuhörer
function netBruecke(P) {
  let jetzt = 1e12;
  const N = { offen: true, gesendet: [], antworten: [], zuhoerer: [] };
  N.isOpen = () => N.offen;
  N.on = (fn) => { N.zuhoerer.push(fn); return () => { const i = N.zuhoerer.indexOf(fn); if (i >= 0) N.zuhoerer.splice(i, 1); }; };
  N.send = (msg) => {
    if (!N.offen) return false;
    N.gesendet.push(msg); jetzt += 5000;
    const n0 = P.c.inbox.length, echt = Date.now; Date.now = () => jetzt;
    try { P.g.handleMessage(P.c, JSON.parse(JSON.stringify(msg))); } finally { Date.now = echt; }
    for (const a of P.c.inbox.slice(n0).filter((x) => x.t === 'bot.antwort')) { N.antworten.push(a); for (const f of N.zuhoerer.slice()) f(a); }
    return true;
  };
  return N;
}
function client(P) {
  const net = netBruecke(P);
  const L = { sprUntertitel: [], menUntertitel: [], meldung: [] };
  let kern = null;
  const transport = BS.transportNet(net);
  const menue = BM.erzeuge({
    kanon: KANON, tokens: TK, uhr: () => Date.now(),
    senden: (m) => net.send(m) !== false,
    anzeige: { untertitel: (t, info) => L.menUntertitel.push({ text: t, info }), denied() {}, ton() {} },
    antwortenAnzeigen: () => !(kern && kern.istAn() && transport.netz === true),
    befehlTyp: Protocol.C.BOT_BEFEHL,
  });
  menue.synchron(P.g.players.map((p) => ({ id: p.id, bot: p.bot ? 1 : 0, rolle: p.rolle, connected: p.connected })), 'play');
  net.on((m) => { if (m.t === 'bot.antwort') menue.antwort(m); });
  const text = { v: '' };
  kern = BS.erzeuge(Object.assign({
    transport, matcher: () => M, stt: () => Promise.resolve(text.v),
    mikrofon: { start: () => Promise.resolve({ stop: async () => ({ blob: { size: 5000 }, mime: 'audio/webm', dauerMs: 800 }), abbruch() {} }) },
    audio: { spiele: () => Promise.resolve(null), stumm() {}, stopp() {} },
    anzeige: { aufnahme() {}, untertitel: (x, info) => { L.sprUntertitel.push({ text: x, info }); }, meldung: (x) => L.meldung.push(x) },
  }, BS.menueAnschluss(() => menue)));
  kern.schalte(true);
  return { net, menue, kern, L, text, sprich: async (t) => { text.v = t; kern.tasteRunter(); await tick(); return kern.tasteHoch(); } };
}

(async () => {
  const P = partie(); const { g } = P;
  // freie Lage: Schiff frei, Stopp (wie tools/test-bot-befehle-*.js)
  const s = g.ship; s.docked = false; s.dockedAt = null; s.dockArmed = true; s.x = 1100; s.y = 1500; s.angle = 0; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.stage = STOP; s.helm.autoStop = false; lauf(P, 1.5);
  const C = client(P);

  section('a) Textzeile: Matcher -> Annahme -> Wirkung -> Untertitel, Quittung, „gilt“');
  {
    ok(await C.kern.sendeText('Schub halbe Kraft') === true, 'Text „Schub halbe Kraft“ gesendet');
    const m = C.net.gesendet[0], a = C.net.antworten[0];
    ok(m.quelle === 'text' && m.an === 'navigation' && m.befehl === 'nav.schub' && m.args.stufe === 'halb', 'bot.befehl quelle text, an navigation, nav.schub halb');
    ok(C.net.antworten.length === 1 && a.status === 'ok' && a.textId === 'nav.schub.ok' && a.botId === bot(P, 'navigation').botId, 'Server-Annahme: ok (nicht abgelehnt quelle), Antwort vom Navigations-Bot');
    lauf(P, 3); ok(g.ship.helm.stage === HALF, 'Wirkung am Zustand: Schubstufe halb (' + g.ship.helm.stage + ')');
    ok(C.L.sprUntertitel.length === 1 && TEXTE['nav.schub.ok'].includes(C.L.sprUntertitel[0].text) && C.L.menUntertitel.length === 0, 'genau ein Untertitel, von der Sprache, Text aus dem Vorrat: „' + (C.L.sprUntertitel[0] && C.L.sprUntertitel[0].text) + '“');
    ok(C.menue.crew()[0].quittung === 'aye' && C.menue.giltVon('navigation').key === 'nav.schub:stufe' && C.menue.giltVon('navigation').wert === 'halb' && C.menue.giltVon('navigation').sprech === 'Halbe Kraft voraus', 'Menü: Quittung „aye“, „gilt“ Navigation: nav.schub halb „Halbe Kraft voraus“');
  }
  section('b) Sprechtaste: Schilde, Feuer, Stopp');
  {
    ok(await C.sprich('Schilde Heck') === true, 'Sprechtaste: „Schilde Heck“');
    let m = C.net.gesendet[C.net.gesendet.length - 1], a = C.net.antworten[C.net.antworten.length - 1];
    ok(m.quelle === 'sprache' && m.befehl === 'tech.schild' && m.args.sektor === 'heck' && a.status === 'ok' && a.textId === 'tech.schild.ok', 'bot.befehl quelle sprache, Antwort ok');
    lauf(P, 2); ok(agent(P, 'technik').absicht.halten.schild === 2, 'Wirkung: der Technik-Bot hält Schild Heck (Sektor 2)');
    ok(C.menue.giltVon('technik').key === 'tech.schild:sektor' && C.menue.giltVon('technik').wert === 'heck' && C.menue.giltVon('technik').sprech === 'Schilde Heck', '„gilt“ Technik: Schilde Heck');
    // Feuer: mit Gegner im Szenario; zuerst halt, dann frei (Absicht des Ops-Bots)
    const e = space.spawnEnemy(g, 'korvette', { x: g.ship.x + 500, y: g.ship.y, facing: Math.PI }); e.pin = { x: e.x, y: e.y, angle: e.angle }; P.fest.push(e);
    lauf(P, 3);
    ok(await C.sprich('Feuer einstellen') === true && C.net.antworten[C.net.antworten.length - 1].status === 'ok' && agent(P, 'ops').absicht.feuer === 'halt', 'Sprache: „Feuer einstellen“ -> Ops-Bot feuer halt');
    ok(await C.sprich('Feuer frei Bugwaffen') === true, 'Sprache: „Feuer frei Bugwaffen“');
    a = C.net.antworten[C.net.antworten.length - 1];
    ok(a.status === 'ok' && agent(P, 'ops').absicht.feuer === 'frei' && agent(P, 'ops').absicht.waffen === 'bug', 'Wirkung: Ops-Bot feuer frei, Waffen bug (' + agent(P, 'ops').absicht.feuer + ', ' + agent(P, 'ops').absicht.waffen + ')');
    ok(C.menue.giltVon('ops').key === 'ops.feuer_frei:waffen' && C.menue.giltVon('ops').wert === 'bug' && C.menue.giltVon('ops').sprech === 'Feuer frei Bugwaffen', '„gilt“ Ops: Feuer frei Bugwaffen');
    await C.kern.sendeText('Feuer frei'); ok(agent(P, 'ops').absicht.feuer === 'frei' && agent(P, 'ops').absicht.waffen === null, 'Text „Feuer frei“: alle Waffen (waffen null)');
    await C.kern.sendeText('Volle Kraft voraus'); lauf(P, 3);
    ok(g.ship.helm.stage === FULL || g.ship.helm.stage === QUARTER + 3, 'Text: Schub voll -> Stufe ' + g.ship.helm.stage);
    ok(await C.sprich('Alle Maschinen stopp') === true && C.net.antworten[C.net.antworten.length - 1].textId === 'nav.stopp.ok', 'Sprache: „Alle Maschinen stopp“ -> nav.stopp ok');
    ok(g.ship.helm.stage === STOP && g.ship.helm.autoStop === true && !agent(P, 'navigation').absicht.befehl && agent(P, 'navigation').befehlGrund === 'stopp', 'Wirkung: Maschinen stopp (Allstopp, Schub-Absicht aufgegeben)');
    ok(C.menue.giltVon('navigation').key === 'nav.stopp', '„gilt“ Navigation: Alle Maschinen stopp');
  }
  section('c) Ablehnung als Untertitel: Bord-Befehl, niemand unten');
  {
    const gilt0 = C.menue.giltVon('navigation'), u0 = C.L.sprUntertitel.length, n0 = C.net.antworten.length;
    ok(await C.kern.sendeText('Sensor') === true, 'Text „Sensor“ gesendet');
    const m = C.net.gesendet[C.net.gesendet.length - 1], a = C.net.antworten[n0];
    ok(m.an === 'bord' && m.befehl === 'bord.sensor' && C.net.antworten.length === n0 + 1 && a.status === 'abgelehnt' && a.textId === 'bord.sensor.abgelehnt.kein_ziel', 'Server: abgelehnt kein_ziel, niemand unten (BOT-02: der Bot an Bord nimmt den Befehl an) (' + (a && a.textId) + ')');
    ok(C.L.sprUntertitel.length === u0 + 1 && TEXTE['bord.sensor.abgelehnt.kein_ziel'].includes(C.L.sprUntertitel[u0].text), 'Untertitel der Sprache: „' + (C.L.sprUntertitel[u0] && C.L.sprUntertitel[u0].text) + '“');
    ok(C.menue.crew()[0].quittung === 'nein' && C.menue.giltVon('navigation') === gilt0 && C.menue.giltVon('bord') === null, 'Menü: Quittung „nein“ (abgelehnt), kein „gilt“ für Bord');
    const a2n = C.net.antworten.length;
    await C.sprich('Schilde Oben'); ok(C.net.antworten.length === a2n, 'unklarer Satz: nichts gesendet, keine Server-Antwort');
  }
  section('d) Verbindung getrennt: keine falsche Erfolgsmeldung');
  {
    C.net.offen = false; const n0 = C.net.gesendet.length;
    ok(await C.kern.sendeText('Schilde Bug') === false && C.net.gesendet.length === n0 && C.L.meldung.includes(BS.TEXT.keinBotServer), 'Net zu: nichts gesendet, Meldung „Kein Bot-Server verbunden.“');
    ok(C.menue.crew()[0].quittung !== 'gesendet', 'keine Quittung „gesendet“ für einen nicht gesendeten Befehl');
  }
  ok(g.errors === 0, 'Server: keine Fehler gezählt (' + g.errors + ')');
  console.log('\n' + (fails ? 'FEHLER: ' + fails + ' von ' + n : 'test-bot-sprache-server: ' + n + ' Pruefungen gruen'));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FEHLER ' + (e && e.stack || e)); process.exit(1); });
