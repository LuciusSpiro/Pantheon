'use strict';
// SYS-01 C1a-2 Nacharbeit: Verhalten der Sim-Bots im neuen Tod-Modell (tools/sim-headless.js GenericAgent), Einheitstest mit Attrappen, kein Spiel.
//   - lebende(): Gegner mit laufendem Reaktor-Countdown (letztes Element von ship.zielSys >= 0) sind nicht mehr Ziel, solange es andere gibt
//   - randNachMitte(): im Randstreifen Drehwunsch zur Kartenmitte, sonst 0 (Jäger-Kurs halten) – Golden m1/3: Lerche stand mit dem Bug an der Wand
//   - repairDuty(): ein zerstörter Reaktor (Countdown) verdrängt eine laufende Nebenarbeit (Trace sim-sund k9b: Helm lief für den Heck-Emitter ans Schiffsende)
//   - reaktorRettung(): Reparatur zuerst, solange sie in die Frist passt; läuft sie schon und endet rechtzeitig, bleibt der Bot dran; sonst Notsprung ab 8 s
//   node tools/test-bot-gegnertod.js
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const { GenericAgent } = require('./sim-headless.js');
const CONFIG = require('../shared/config.js');

let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

// Attrappe eines Bots: nur der Zustand, den die geprüften Methoden anfassen
function bot(role, game) {
  const a = Object.create(GenericAgent.prototype);
  a.role = role; a.pid = 'p1'; a.memo = {}; a.ix = null; a.actDown = false; a.cmds = []; a.repaired = [];
  a.game = game || { C: CONFIG, simAgents: [], players: [], simStats: {} };
  a.game.simAgents = [a];
  a.act = () => {}; a.send = () => {}; a.cmd = (c) => a.cmds.push(c);
  a.repair = (S, p, sys) => { a.repaired.push(sys); return 'running'; };
  a.enter = () => false;   // nie am Steuer: reaktorRettung läuft dann bis zum Notsprung-Zweig durch
  return a;
}
const S0 = (extra) => Object.assign({ time: 100, ship: { systems: {}, shields: {}, repairQueue: [], fragile: [], target: null }, space: { enemies: [], w: 2400, h: 1400 }, inventory: { ersatzteil: 0 }, players: [] }, extra || {});
const P = { zone: 'ship', console: null };

console.log('\n[lebende: sterbende Ziele überspringen]');
{
  const a = bot('weapons');
  const S = S0(); S.space.enemies = [{ id: 'e1' }, { id: 'e2' }];
  S.ship.target = 'e1'; S.ship.zielSys = [0, 100, 0, 100, 2, 0, 0, 100, -1];
  ok(a.lebende(S).length === 2, 'kein Countdown am Ziel: beide bleiben Ziele');
  S.ship.zielSys = [0, 100, 2, 0, 0, 100, 37];
  const l = a.lebende(S);
  ok(l.length === 1 && l[0].id === 'e2', 'Countdown am Ziel e1: nur e2 bleibt Ziel');
  S.ship.target = 'e2'; S.ship.zielSys = [0, 100, 0, 100, -1];
  ok(a.lebende(S).length === 1 && a.lebende(S)[0].id === 'e2', 'e1 bleibt gemerkt als sterbend, auch wenn e2 anvisiert wird');
  S.ship.zielSys = [0, 100, 0, 0, 5];
  ok(a.lebende(S).length === 2, 'sind alle am Sterben, bleiben alle (der Bot hat sonst kein Ziel)');
  const S2 = S0(); S2.ship.x = 0; S2.ship.y = 0; S2.space.enemies = [{ id: 'fern', x: 500, y: 0 }, { id: 'nah', x: 100, y: 0 }];
  ok(a.nearestEnemy(S2).id === 'nah', 'nearestEnemy ohne Countdown wie bisher');
  S2.ship.target = 'nah'; S2.ship.zielSys = [0, 100, 9];
  ok(a.nearestEnemy(S2).id === 'fern', 'nearestEnemy: der sterbende nahe Gegner zählt nicht');
}

console.log('\n[randNachMitte: Randstreifen]');
{
  const a = bot('helm');
  const S = S0(); S.ship.x = 1200; S.ship.y = 700; S.ship.angle = 0;
  ok(a.randNachMitte(S) === 0, 'Mitte: Kurs halten (0)');
  S.ship.x = 40; S.ship.y = 40; S.ship.angle = -2.36;
  const d = a.randNachMitte(S);
  ok(Math.abs(d) > 1 && Math.abs(d) <= Math.PI, `Ecke mit Bug zur Wand: Drehwunsch ${d.toFixed(2)} rad zur Mitte`);
  S.ship.x = 40; S.ship.y = 40; S.ship.angle = Math.atan2(700 - 40, 1200 - 40);
  ok(Math.abs(a.randNachMitte(S)) < 1e-9, 'Ecke, Bug schon zur Mitte: kein Drehwunsch');
}

console.log('\n[repairDuty: zerstörter Reaktor verdrängt Nebenarbeit]');
{
  const a = bot('helm');
  const S = S0(); S.ship.systems = { reactor: 'broken', emitter_aft: 'broken' };
  a.memo.job = { sys: 'emitter_aft', how: 'flick', from: 'broken', at: 99, seen: 99.9 };
  a.memo.jobCd = 999;
  const r = a.repairDuty(S, P, { cooldown: 1 });
  ok(r === true && a.memo.job && a.memo.job.sys === 'reactor', `Aufgabe wechselt auf den Reaktor (job ${a.memo.job && a.memo.job.sys}, Reparatur ${a.repaired.join(',')})`);
  a.memo.job = { sys: 'emitter_aft', how: 'flick', from: 'broken', at: 99, seen: 99.9 };
  S.ship.systems.reactor = 'ok';
  a.repairDuty(S, P, { cooldown: 1 });
  ok(a.memo.job && a.memo.job.sys === 'emitter_aft', 'ohne Reaktorausfall bleibt die Nebenarbeit');
}

console.log('\n[reaktorRettung: Reparatur nur, wenn Weg und Sonderreparatur in die Frist passen, sonst ans Steuer und springen]');
{
  const W = require('../server/world.js');
  const rs = W.STATIONS.find((s) => s.system === 'reactor');
  const amReaktor = { id: 'p1', x: rs.x * 32 + 16, y: rs.y * 32 + 16, hold: null };
  const amSteuer = { id: 'p1', x: 1105, y: 208, hold: null };
  const mit = (pl) => { const game = { C: CONFIG, simAgents: [], players: [pl], simStats: {} }; return { game, a: bot('helm', game) }; };
  const SITZ = { zone: 'ship', console: 'helm' };
  const S = S0(); S.ship.systems = { reactor: 'broken' }; S.ship.docked = false;

  S.ship.reaktorTod = { rest: 190 };   // 19 s
  { const { a } = mit(amReaktor); a.reaktorRettung(S, P);
    ok(a.repaired.includes('reactor') && !a.cmds.includes('helm.notsprung'), 'Frist 19 s, am Reaktor: Reparatur (Weg ~0 + 12 s passen)'); }
  { const { a } = mit(amSteuer); const r = a.reaktorRettung(S, P);
    ok(r === true && !a.repaired.includes('reactor') && !a.cmds.includes('helm.notsprung'), 'Frist 19 s, am Steuer (Weg zum Reaktor + 12 s passen nicht): keine Reparatur, kein Sprung vor 8 s'); }
  { const { a } = mit(amSteuer); ok(a.reaktorRettung(S, SITZ) === false, 'Frist 19 s, am Steuer sitzend: der Bot wartet (weder Reparatur noch Sprung), das Steuer läuft normal'); }

  S.ship.reaktorTod = { rest: 100 };   // 10 s
  { const { a } = mit(amSteuer); ok(a.reaktorRettung(S, SITZ) === false && !a.cmds.length, 'Frist 10 s, am Steuer sitzend: noch kein Notsprung (erst ab 8 s)'); }
  { const { a } = mit(amSteuer); a.enter = () => false; const r = a.reaktorRettung(S, P);
    ok(r === true && !a.cmds.includes('helm.notsprung'), 'Frist 10 s, nicht am Steuer: zurück ans Steuer, sofort (der Weg kostet Zeit)'); }

  S.ship.reaktorTod = { rest: 60 };   // 6 s
  { const { a } = mit(amSteuer); a.enter = () => true;
    ok(a.reaktorRettung(S, SITZ) === true && a.cmds.includes('helm.notsprung'), 'Frist 6 s am Steuer: Notsprung'); }
  { const { game, a } = mit(amReaktor); a.enter = () => true; game.players[0].hold = { system: 'reactor', t: 8, dur: 12 };
    ok(a.reaktorRettung(S, SITZ) === false && !a.cmds.includes('helm.notsprung'), 'Sonderreparatur läuft und endet in 4 s bei 6 s Frist: der Bot bleibt dran'); }
  { const { game, a } = mit(amReaktor); a.enter = () => true; game.players[0].hold = { system: 'reactor', t: 1, dur: 12 };
    ok(a.reaktorRettung(S, SITZ) === true && a.cmds.includes('helm.notsprung'), 'Sonderreparatur würde zu spät fertig: Notsprung'); }
}
console.log(fails ? `\nFEHLER: ${fails}` : '\ntest-bot-gegnertod: alle ok');
process.exit(fails ? 1 : 0);
