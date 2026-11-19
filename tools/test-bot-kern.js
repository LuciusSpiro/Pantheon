'use strict';
// BOT-01 B1: Bot-Kern (server/bots/kern.js). Der missionsneutrale Teil des Testbots liegt im Serverbauteil, tools/sim-headless.js erbt davon.
//  1. Der Kern laedt allein und importiert nichts aus tools/
//  2. Eine BotKern-Instanz laeuft mit einem Mock-game ohne simStats und simAgents durch update-Schritte (inkl. Reaktor-Zaehler im Ersatzobjekt)
//  3. Zufall: setSimRng setzt den Strom, den der Kern liest
//  4. Quellscan: sim-headless.js enthaelt keine Kopie der Kernmethoden mehr, MissionAgent erbt vom Kern
//  5. Einbinder (golden-trace und die vier Bot-Tests) laden sim-headless per require, nicht per Quelltextschnitt
//   node tools/test-bot-kern.js
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));

let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);

// ---------- 1 Kern laedt allein ----------
section('1 Kern laedt ohne tools/');
const kernPfad = path.join(__dirname, '..', 'server', 'bots', 'kern.js');
const kernQuelle = fs.readFileSync(kernPfad, 'utf8');
const imports = [...kernQuelle.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
ok(imports.length > 0 && imports.every((p) => /^\.\.\/(\.\.\/shared\/|util\.js|world\.js|sim\/)/.test(p)), 'nur server/ und shared/ importiert: ' + imports.length + ' require-Stellen');
ok(!/tools\//.test(imports.join(' ')), 'kein Import aus tools/');
const Kern = require('../server/bots/kern.js');
ok(!Object.keys(require.cache).some((k) => /[\/]tools[\/]/.test(k)), 'beim Laden kein tools/-Modul im require-Cache');
ok(typeof Kern.BotKern === 'function' && typeof Kern.setSimRng === 'function' && typeof Kern.statistik === 'function' && typeof Kern.setzeAusgabe === 'function', 'exportiert BotKern, setSimRng, statistik, setzeAusgabe');

// ---------- 2 Mock-game ohne simStats und simAgents ----------
section('2 BotKern mit Mock-game ohne simStats/simAgents');
const gesendet = [];
const game = {
  time: 0, players: [{ id: 'p1', x: 100, y: 100, console: null }], ship: { helm: { stage: 1 }, repairQueue: [] },
  C: require('../shared/config.js'),
  handleMessage(conn, msg) { gesendet.push(msg); },
};
const bot = new Kern.BotKern(game, 0, 'solo', {});
bot.onMsg({ t: 'welcome', pid: 'p1' });
const S = {
  time: 0, phase: 'play', players: [{ id: 'p1', x: 100, y: 100, zone: 'ship', console: null, downed: false, carry: null }],
  world: {}, away: {}, mission: { stage: null, active: null }, space: { enemies: [] },
  ship: { docked: false, reactor: { state: 'offline' }, fires: [], breaches: [], systems: {}, helm: { stage: 1 } }, inventory: {},
};
let wurf = null;
try { for (let i = 0; i < 5; i++) { S.time += 1 / 30; game.time = S.time; bot.update(S); } } catch (e) { wurf = e; }
ok(!wurf, 'update ohne simStats und simAgents wirft nicht' + (wurf ? ' (' + wurf.message + ')' : ''));
ok(!('simStats' in game) && !('simAgents' in game), 'der Kern legt kein simStats/simAgents am game an');
const st = Kern.statistik(game);
ok(st.reactorRestarts === 1, 'Reaktor-Zaehler im Ersatzobjekt: reactorRestarts = ' + st.reactorRestarts);
const eigenes = { simStats: { reactorRestarts: 7 } };
ok(Kern.statistik(eigenes) === eigenes.simStats, 'mit simStats: derselbe Zaehler wie im Testlauf (unveraendert)');
ok(bot.update === Kern.BotKern.prototype.update && !bot.stage_dock, 'Kern hat nur den Grundschritt update, keine Missions-Stufen');
bot.update({ players: [], world: {} });   // Spieler fehlt im Snapshot: kein Wurf
ok(true, 'update ohne eigenen Spieler im Snapshot wirft nicht');

// ---------- 3 Zufall ----------
section('3 Zufallshalter');
let n = 0;
Kern.setSimRng(() => { n++; return 0.25; });
ok(Kern.simRng() === 0.25 && n === 1, 'setSimRng setzt den Strom, simRng liest ihn (ein Aufruf je Zug)');
Kern.setSimRng(require('../server/util.js').makeRng(1));

// ---------- 4 Quellscan sim-headless ----------
section('4 sim-headless.js: keine Kopie des Kerns');
const sim = fs.readFileSync(path.join(__dirname, 'sim-headless.js'), 'utf8');
const KERN_METHODEN = ['schildVerteilung', 'captainFight', 'queueRepairs', 'threatSector', 'lanceFight', 'helmManeuver', 'reaktorRettung', 'reactorDuty', 'nextHop', 'travel', 'goto', 'consoleTile', 'repairDuty', 'minigame', 'dodgeTele'];
const kopiert = KERN_METHODEN.filter((m) => new RegExp('^\s+' + m + '\(.*\) \{', 'm').test(sim));
ok(kopiert.length === 0, 'keine Methodendefinition der Kernmethoden in sim-headless.js' + (kopiert.length ? ': ' + kopiert.join(', ') : ''));
ok(/^class MissionAgent extends BotKern \{/m.test(sim), 'MissionAgent erbt vom Kern');
ok(!/^class Agent \{/m.test(sim), 'kein eigenstaendiges class Agent mehr');
const kernHat = KERN_METHODEN.filter((m) => typeof Kern.BotKern.prototype[m] === 'function');
ok(kernHat.length === KERN_METHODEN.length, 'alle diese Methoden stehen im Kern');
const Sim = (() => { const a = process.argv; process.argv = [a[0], path.join(__dirname, 'sim-headless.js')]; try { return require('./sim-headless.js'); } finally { process.argv = a; } })();
ok(Sim.Agent.prototype instanceof Kern.BotKern, 'Agent (Export von sim-headless) erbt vom Kern');
ok(Sim.KeshAgent.prototype instanceof Sim.Agent && Sim.GenericAgent.prototype instanceof Sim.KeshAgent, 'KeshAgent und GenericAgent haengen weiter an Agent');
for (const k of ['runGeneric', 'printGenericRun', 'fmtMin', 'GenericAgent', 'runGraben', 'Agent', 'KeshAgent', 'setSimRng', 'DT', 'TILE', 'KESH', 'KESH_GOALS', 'onShipPad', 'dist']) ok(Sim[k] != null, 'sim-headless exportiert ' + k);
ok(typeof Sim.Agent.prototype.stage_dock === 'function' && typeof Sim.Agent.prototype.update === 'function' && Sim.Agent.prototype.update !== Kern.BotKern.prototype.update, 'MissionAgent: M1/M2-Stufen und eigenes update');

// ---------- 5 Einbinder ----------
section('5 Einbinder laden per require, nicht per Quelltextschnitt');
for (const f of ['golden-trace.js', 'test-entschluesseln.js', 'test-notrufe.js', 'test-sonden.js', 'test-spur.js']) {
  const q = fs.readFileSync(path.join(__dirname, f), 'utf8');
  ok(/require\(file\)/.test(q) && !/lastIndexOf\(/.test(q.split('sim-headless')[1] || '') && !/_compile\(src/.test(q) && !/module\.exports = \{ (Agent|GenericAgent)/.test(q), f + ': require statt Schnitt');
}

console.log(fails ? '\n' + fails + ' FEHLER' : '\nalle ok');
process.exit(fails ? 1 : 0);
