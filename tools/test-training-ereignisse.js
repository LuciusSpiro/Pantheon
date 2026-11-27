'use strict';
// TRA-01 B1: die drei Training-Ereignisse (missionEvents, reine Zusaetze ohne Spielwirkung): allstopp { p }, ausweichen { p, richtung }, botBefehl { befehl, an, quelle, botId }.
// Je Ereignis: feuert bei Ausloesung mit den richtigen Feldern, feuert NICHT beim abgelehnten Versuch. botBefehl nur im ok-Pfad von server/bots/annahme.js (nie in den Registries).
//   node tools/test-training-ereignisse.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Game } = require('../server/game.js');
const BotSpieler = require('../server/bots/spieler.js');
const Befehle = require('../server/bots/befehle/index.js');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-trainereign-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
let seq = 0;
const mkConn = () => ({ inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } });
function partie(o) {
  o = o || {};
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = mkConn(); g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'K0', color: 0 });
  for (const r of o.bots || []) BotSpieler.botHinzufuegen(g, null, r);
  if (o.start !== false) {
    g.lobbyOpts.startMission = 'arena_space';
    g.handleMessage(c, { t: 'ready', ready: true });
    if (g.arena) { g.arena.nextAt = 1e9; g.space.enemies = []; }
  }
  const ereignisse = [];
  const orig = g.missionEvent.bind(g);
  g.missionEvent = (name, data) => { ereignisse.push({ name, data }); return orig(name, data); };
  return { g, c, h: c.player, ereignisse, von: (name) => ereignisse.filter((e) => e.name === name) };
}
let jetzt = 1e12;
const senden = (P, msg) => { const echt = Date.now; Date.now = () => jetzt; try { P.g.handleMessage(P.c, msg); } finally { Date.now = echt; } };
const ein = (P, msg) => { jetzt += 5000; senden(P, msg); };   // Rate-Fenster leer
const bef = (befehl, an, quelle, args) => ({ t: 'bot.befehl', an, befehl, quelle, args });
const haken = (reg, name, fn, was) => { const alt = Befehle.REGISTER[reg][name]; Befehle.REGISTER[reg][name] = fn; try { return was(); } finally { Befehle.REGISTER[reg][name] = alt; } };
const ticks = (P, s) => { for (let i = 0; i < s * 20; i++) P.g.step(); };

// ---------- allstopp ----------
section('allstopp');
{
  const P = partie();
  P.h.console = 'helm';
  senden(P, { t: 'cmd', c: 'helm.stop' });
  const e = P.von('allstopp');
  ok(e.length === 1 && e[0].data.p === P.h && P.g.ship.helm.autoStop === true, 'Helm-Befehl helm.stop: ein Ereignis allstopp { p } und Allstopp aktiv');
  ticks(P, 0.2);
  ok(P.von('allstopp').length === 1, 'Ereignis feuert einmal an der Annahme, nicht pro Tick');
  P.g.ship.docked = true; P.ereignisse.length = 0;
  senden(P, { t: 'cmd', c: 'helm.stop' });
  ok(P.von('allstopp').length === 0, 'abgelehnt (angedockt): kein Ereignis');
  P.g.ship.docked = false; P.h.console = 'captain';
  senden(P, { t: 'cmd', c: 'helm.stop' });
  ok(P.von('allstopp').length === 0, 'abgelehnt (falsche Konsole): kein Ereignis');
}

// ---------- ausweichen ----------
section('ausweichen');
{
  const P = partie();
  P.h.console = 'helm';
  senden(P, { t: 'cmd', c: 'helm.dodge', dir: 1 });
  let e = P.von('ausweichen');
  ok(e.length === 1 && e[0].data.p === P.h && e[0].data.richtung === 'rechts' && P.g.ship.dodgeCd > 0, 'helm.dodge dir 1: ein Ereignis ausweichen { p, richtung: rechts }');
  senden(P, { t: 'cmd', c: 'helm.dodge', dir: 1 });
  ok(P.von('ausweichen').length === 1, 'Abklingzeit (abgelehnt): kein zweites Ereignis');
  P.g.ship.dodgeCd = 0;
  senden(P, { t: 'cmd', c: 'helm.dodge', dir: -1 });
  e = P.von('ausweichen');
  ok(e.length === 2 && e[1].data.richtung === 'links', 'dir -1: richtung links');
  P.g.ship.dodgeCd = 0; P.g.ship.docked = true; P.ereignisse.length = 0;
  senden(P, { t: 'cmd', c: 'helm.dodge', dir: 1 });
  ok(P.von('ausweichen').length === 0, 'abgelehnt (angedockt): kein Ereignis');
}

// ---------- botBefehl ----------
section('botBefehl');
{
  const P = partie({ bots: ['navigation', 'ops', 'technik'] });
  const bot = P.g.players.find((p) => p.bot && p.rolle === 'ops');
  haken('ops', 'ops.scan', () => ({ ok: true }), () => {
    for (const q of ['menu', 'taste', 'text', 'sprache']) {
      P.ereignisse.length = 0;
      ein(P, bef('ops.scan', 'ops', q));
      const e = P.von('botBefehl');
      ok(e.length === 1 && e[0].data.befehl === 'ops.scan' && e[0].data.an === 'ops' && e[0].data.quelle === q && e[0].data.botId === bot.botId && !!bot.botId, 'ok-Pfad, quelle ' + q + ': botBefehl { befehl, an, quelle, botId }');
    }
    P.ereignisse.length = 0;
    ein(P, bef('ops.scan', 'ops', 'bogen'));
    ok(P.von('botBefehl').length === 0, 'ungueltige quelle (abgelehnt): kein Ereignis');
    ein(P, bef('ops.scan', 'navigation', 'menu'));
    ok(P.von('botBefehl').length === 0, 'falscher Adressat (abgelehnt): kein Ereignis');
    ein(P, bef('ops.unbekannt', 'ops', 'menu'));
    ok(P.von('botBefehl').length === 0, 'unbekannter Befehl: kein Ereignis');
    ein(P, bef('ops.scan', 'alle', 'menu'));
    ok(P.von('botBefehl').length === 0, 'an alle bei Rollenbefehl (abgelehnt adressat): kein Ereignis');
    jetzt += 5000; P.ereignisse.length = 0;
    for (let i = 0; i < 11; i++) senden(P, bef('ops.scan', 'ops', 'menu'));
    ok(P.von('botBefehl').length === 10, 'Rate: 10 angenommen = 10 Ereignisse, der 11. (rate) feuert nicht');
  });
  haken('ops', 'ops.scan', () => ({ ok: false, code: 'system' }), () => {
    P.ereignisse.length = 0;
    ein(P, bef('ops.scan', 'ops', 'menu'));
    ok(P.von('botBefehl').length === 0, 'Registry lehnt ab (system): kein Ereignis');
  });
  haken('ops', 'ops.scan', () => { throw new Error('test'); }, () => {
    P.ereignisse.length = 0; const err0 = P.g.errors;
    ein(P, bef('ops.scan', 'ops', 'menu'));
    ok(P.von('botBefehl').length === 0 && P.g.errors > err0, 'Registry wirft (fehler): kein Ereignis');
  });
}
{
  const P = partie({ bots: ['navigation'] });
  haken('ops', 'ops.scan', () => ({ ok: true }), () => { ein(P, bef('ops.scan', 'ops', 'menu')); });
  ok(P.von('botBefehl').length === 0, 'kein_bot (kein Ops-Bot in der Partie): kein Ereignis');
}
{
  const P = partie({ start: false, bots: ['ops'] });
  haken('ops', 'ops.scan', () => ({ ok: true }), () => { ein(P, bef('ops.scan', 'ops', 'menu')); });
  ok(P.g.phase !== 'play' && P.von('botBefehl').length === 0, 'Phase nicht play (abgelehnt): kein Ereignis');
}
{
  const P = partie();
  haken('ops', 'ops.scan', () => ({ ok: true }), () => { ein(P, bef('ops.scan', 'ops', 'menu')); });
  ok(P.von('botBefehl').length === 0, 'reine Menschenpartie ohne Bots: kein Ereignis');
}

// ---------- Quellscan ----------
section('Quellscan');
{
  const wurzel = path.join(__dirname, '..');
  const ann = fs.readFileSync(path.join(wurzel, 'server/bots/annahme.js'), 'utf8').replace(/\/\/.*$/gm, '');
  ok((ann.match(/missionEvent\('botBefehl'/g) || []).length === 1, 'annahme.js: genau ein missionEvent botBefehl');
  const reg = fs.readdirSync(path.join(wurzel, 'server/bots/befehle')).filter((f) => f.endsWith('.js'));
  ok(reg.length >= 5 && reg.every((f) => !/missionEvent/.test(fs.readFileSync(path.join(wurzel, 'server/bots/befehle', f), 'utf8'))), 'Registries unter server/bots/befehle/ rufen kein missionEvent');
  const game = fs.readFileSync(path.join(wurzel, 'server/game.js'), 'utf8');
  ok(/missionEvent\('allstopp'/.test(game) && /missionEvent\('ausweichen'/.test(game), 'game.js: allstopp und ausweichen an der Annahme des Helm-Befehls');
}

console.log(`\ntest-training-ereignisse: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
