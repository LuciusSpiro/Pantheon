'use strict';
// SYS-01 A2a Bot-Test (Abnahme 6): Ein Technik-Bot (Schrauber, server/sim/bots.js) rettet den ersten Reaktorausfall allein, zwei Bots den zweiten,
// den dritten nicht mehr. „Zwei Bots“ = zwei Spieler an der Sonderreparatur (gescriptet: Halten am Reaktor, wie es die Spieler-Bots tun); der
// Der Bot-Faktor des Schraubers gilt nicht für die Sonderreparatur (12 s). Die Zeiten und Ergebnisse stehen in den info-Zeilen.
//   node tools/test-reaktortod-bot.js
const path = require('path');
const fs = require('fs');
const os = require('os');
process.chdir(path.join(__dirname, '..'));
const { Game } = require('../server/game.js');
const I = require('../server/sim/interior.js');
const Space = require('../server/sim/space.js');
const W = require('../server/world.js');
const BOTS = require('../server/sim/bots.js');
const Reaktortod = require('../server/sim/reaktortod.js');

let fails = 0;
let n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const info = (t) => console.log('  info ' + t);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-reaktortod-bot-'));
let seq = 0;

function setup(spieler) {
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const conns = [];
  for (let i = 0; i < spieler; i++) {
    const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'K' + i, color: i }); conns.push(c);
  }
  g.handleMessage(conns[0], { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  for (let k = 0; k < 30; k++) g.step();
  g.space.enemies = [];
  return { g, conns };
}
const brechen = (g) => I.damageSystem(g, 'reactor', 'broken');
function reparieren(g) { I.repairSystem(g, 'reactor', 'player', 'flick'); Space.reactorOnline(g, 'Test'); }
const SCHRITT = 1 / 30;
// Läuft die Zeit bis zum Ausgang: 'gerettet' (Reaktor nicht mehr zerstört) oder 'tot'. Rückgabe { ausgang, t }
function ausgang(g, max) {
  let k = 0;
  while (k < Math.round(max * 30)) {
    if (g.ship.schiffZerstoert) return { ausgang: 'tot', t: k * SCHRITT };
    if (g.ship.systems.reactor !== 'broken') return { ausgang: 'gerettet', t: k * SCHRITT };
    g.step(); k++;
  }
  return { ausgang: g.ship.schiffZerstoert ? 'tot' : 'offen', t: k * SCHRITT };
}
function ankern(g, p) {
  const st = W.STATIONS.find((s) => s.system === 'reactor'); const c = W.tileCenter(st.x, st.y);
  p.x = c.x; p.y = c.y; p.zone = 'ship'; p.console = null; p.hold = null; p.moving = false; p.input.mx = 0; p.input.my = 0;
}
// Vorbereitung: nr-1 Ausfälle mit Rettung dazwischen, danach der nr-te (Zähler läuft weiter)
function ausfall(g, nr) { for (let i = 1; i < nr; i++) { brechen(g); reparieren(g); } brechen(g); }

// Zeit, bis ein Schrauber an der Sonderreparatur arbeitet (Laufweg von der Ruhebank): wird mitgemessen
const arbeitsDauer = (g) => (g.bots[0] && g.bots[0].task && g.bots[0].task.phase === 'work' ? g.bots[0].task.dur : null);

console.log('\n[Schrauber allein, Ausfall 1: 20 s – gerettet]');
{
  const { g } = setup(1);
  ok(g.ship.botAuto === true && g.bots.length === 1, `ein Schrauber aktiv (botAuto ${g.ship.botAuto}, Schrauber ${g.bots.length})`);
  ausfall(g, 1);
  let dur = null; let k = 0;
  while (k < 25 * 30 && g.ship.systems.reactor === 'broken' && !g.ship.schiffZerstoert) { g.step(); k++; if (dur == null) dur = arbeitsDauer(g); }
  const t = k * SCHRITT;
  info(`Ausfall 1 (Fenster 20 s): ${g.ship.schiffZerstoert ? 'tot' : 'gerettet'} nach ${t.toFixed(2)} s; Arbeitszeit des Schraubers ${dur} s`);
  ok(dur === 12, 'der Bot-Faktor (1,75) gilt nicht für die Sonderreparatur: Arbeitszeit 12 s');
  ok(!g.ship.schiffZerstoert && g.ship.systems.reactor !== 'broken' && t < 20, 'ein Schrauber allein rettet den ersten Ausfall vor Ablauf des Countdowns');
}

console.log('\n[Schrauber allein, Ausfall 2: 10 s – tot]');
{
  const { g } = setup(1);
  ausfall(g, 2);
  const r = ausgang(g, 15);
  info(`Ausfall 2 (Fenster 10 s): ${r.ausgang} nach ${r.t.toFixed(2)} s`);
  ok(r.ausgang === 'tot', 'ein Schrauber allein schafft den zweiten Ausfall nicht (10 s)');
}

// „Zwei Bots“: der Schrauber (Server-Bot) und ein zweiter Arbeiter am Halten (Spieler-Bot). Ein zweiter SCHRAUBER entfällt bei zerstörtem Reaktor:
// das Werkstatt-Modul läuft ohne Reaktorstrom nicht (bots.botAnzahl), der Schrauber zählt allein.
console.log('\n[Schrauber plus ein Arbeiter am Reaktor, Ausfall 2: 10 s – gerettet]');
{
  const { g } = setup(1);
  const p = g.players[0];
  ausfall(g, 2);
  ankern(g, p); I.onAct(g, p, true);
  const r = ausgang(g, 15);
  info(`Ausfall 2 zu zweit (Fenster 10 s): ${r.ausgang} nach ${r.t.toFixed(2)} s; Schrauber ${g.bots.length}`);
  ok(r.ausgang === 'gerettet' && r.t < 10, 'zwei Arbeiter (Schrauber und Spieler-Bot) retten den zweiten Ausfall vor Ablauf (10 s)');
  I.onAct(g, p, false);
}

console.log('\n[Schrauber plus ein Arbeiter, Ausfall 3: 5 s – tot]');
{
  const { g } = setup(1);
  const p = g.players[0];
  ausfall(g, 3);
  ankern(g, p); I.onAct(g, p, true);
  const r = ausgang(g, 10);
  info(`Ausfall 3 zu zweit (Fenster 5 s): ${r.ausgang} nach ${r.t.toFixed(2)} s`);
  ok(r.ausgang === 'tot', 'den dritten Ausfall schaffen zwei Arbeiter nicht mehr (5 s)');
  ok(Reaktortod.dauer(g, 3) === 5, 'Fenster des dritten Ausfalls 5 s');
  I.onAct(g, p, false);
}

console.log('\n[Zwei Spieler-Arbeiter ohne Schrauber, Ausfall 2: 10 s – gerettet in 7 s]');
{
  const { g } = setup(2);
  BOTS.setBotAuto(g, false);
  const [a, b] = g.players;
  ausfall(g, 2); ankern(g, a); ankern(g, b);
  I.onAct(g, a, true); I.onAct(g, b, true);
  const r = ausgang(g, 15);
  info(`Ausfall 2, zwei Spieler-Bots (Soll 7 s): ${r.ausgang} nach ${r.t.toFixed(2)} s`);
  ok(r.ausgang === 'gerettet' && Math.abs(r.t - 7) <= 0.2, 'zwei Spieler-Bots retten den zweiten Ausfall in 7 s');
  I.onAct(g, a, false); I.onAct(g, b, false);
}

console.log(`\ntest-reaktortod-bot: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
