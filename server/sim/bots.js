'use strict';
// Schrauber-Bots (§6): reparieren, löschen, flicken, Teile holen. BFS auf Kacheln. Nie Konsolen, nie Plattform.
const Physics = require('../../shared/physics.js');
const W = require('../world.js');
const interior = require('./interior.js');
const { bfs } = require('../util.js');

const REEVAL_INTERVAL = 1;

function makeBot(game, i) {
  const sp = W.Maps.BOT_SPAWNS[i % W.Maps.BOT_SPAWNS.length];
  const c = W.tileCenter(sp.x, sp.y);
  return { id: 's' + i, variant: i % 3, x: c.x, y: c.y, dir: 'down', moving: false, carry: null,
    spawn: { x: sp.x, y: sp.y }, task: null, path: null, progress: 0, reevalT: i * 0.3 };
}

function ensureBotCount(game) {
  const want = game.C.bot.count + (game.upgrades.schrauber3 ? 1 : 0);
  while (game.bots.length < want) game.bots.push(makeBot(game, game.bots.length));
}

// Kandidaten in Prioritätsreihenfolge: Captain-Priorität > broken > Feuer > Leck > damaged.
function candidates(game) {
  const ship = game.ship;
  const list = [];
  const sysTask = (sys, cls) => ({ cls, kind: 'repair', key: 'sys:' + sys, system: sys, tx: W.SYSTEM_TILES[sys].x, ty: W.SYSTEM_TILES[sys].y,
    part: ship.systems[sys] === 'broken' ? 'ersatzteil' : null });
  const fireTask = (f, cls) => ({ cls, kind: 'extinguish', key: `fire:${f.tx},${f.ty}`, tx: f.tx, ty: f.ty, part: null });
  const breachTask = (b, cls) => ({ cls, kind: 'patch', key: `breach:${b.tx},${b.ty}`, tx: b.tx, ty: b.ty, part: 'flickblech' });
  const pr = ship.priority;
  if (pr === 'fire') ship.fireList.forEach((f) => list.push(fireTask(f, 0)));
  else if (pr === 'breach') ship.breachList.forEach((b) => list.push(breachTask(b, 0)));
  else if (pr && ship.systems[pr] && ship.systems[pr] !== 'ok') list.push(sysTask(pr, 0));
  for (const sys of interior.SYSTEM_ORDER) if (ship.systems[sys] === 'broken') list.push(sysTask(sys, 1));
  ship.fireList.forEach((f) => list.push(fireTask(f, 2)));
  ship.breachList.forEach((b) => list.push(breachTask(b, 3)));
  for (const sys of interior.SYSTEM_ORDER) if (ship.systems[sys] === 'damaged') list.push(sysTask(sys, 4));
  return list;
}

function switchTask(game, sw) {
  const t = W.REACTOR_SWITCHES.find((q) => q.id === sw);
  return { cls: -1, kind: 'switch', key: 'switch:' + sw, sw, tx: t.x, ty: t.y, part: null };
}

function goalTilesFor(task) {
  if (task.kind === 'repair' || task.kind === 'switch') return W.accessTiles(W.ship, W.shipWalkable, task.tx, task.ty);
  const out = [{ x: task.tx, y: task.ty }];
  return out.concat(W.accessTiles(W.ship, W.shipWalkable, task.tx, task.ty));
}

function pathTo(bot, goals) {
  const st = Physics.toTile(bot.x, bot.y);
  const set = new Set(goals.map((g) => g.y * W.ship.w + g.x));
  return bfs(W.shipWalkable, st, (x, y) => set.has(y * W.ship.w + x) && W.shipWalkable(x, y), W.ship.w, W.ship.h);
}

function shelfAccess(item) {
  const s = W.SHELF_TILES.find((t) => t.item === item);
  return [{ x: s.x, y: s.y + 1 }];
}

function taskStillValid(game, t) {
  const ship = game.ship;
  if (t.kind === 'repair') return ship.systems[t.system] !== 'ok';
  if (t.kind === 'extinguish') return ship.fireList.some((f) => f.tx === t.tx && f.ty === t.ty);
  if (t.kind === 'patch') return ship.breachList.some((b) => b.tx === t.tx && b.ty === t.ty);
  if (t.kind === 'switch') return ship.reactorCtl.state === 'offline' && ship.reactorCtl.needBot === t.sw;
  return true;
}

function chooseTask(game, bot) {
  const taken = new Set(game.bots.filter((b) => b !== bot && b.task && b.task.key).map((b) => b.task.key));
  for (const c of candidates(game)) {
    if (taken.has(c.key)) continue;
    if (c.part && bot.carry !== c.part && game.inventory[c.part] <= 0) { reportNoPart(game, c.part); continue; } // kein Teil -> melden, überspringen
    const path = pathTo(bot, goalTilesFor(c));
    if (!path) continue;
    return c;
  }
  return null;
}

// M0: Fehlt ein Teil, melden die Schrauber das einmalig (bis wieder Nachschub im Regal liegt), statt stumm zu überspringen.
const PART_TEXT = { ersatzteil: 'Kein Ersatzteil mehr im Lager', flickblech: 'Kein Flickblech mehr im Lager' };
function reportNoPart(game, part) {
  const key = 'noPartMsg:' + part;
  if (game.flags[key]) return;
  game.flags[key] = true;
  game.oda('Schrauber melden: ' + (PART_TEXT[part] || 'Teil fehlt') + '. Nachschub gibt es im Hafen.', null);
}
function resetNoPartReports(game) {
  for (const part of Object.keys(PART_TEXT)) if (game.inventory[part] > 0) game.flags['noPartMsg:' + part] = false;
}

function assign(game, bot, task) {
  bot.task = task; bot.progress = 0;
  if (task.part && bot.carry !== task.part) {
    if (bot.carry) { stowNow(game, bot); }
    task.phase = 'fetch';
    bot.path = pathTo(bot, shelfAccess(task.part));
  } else {
    task.phase = 'goto';
    bot.path = pathTo(bot, goalTilesFor(task));
  }
}

function stowNow(game, bot) {
  // Teil zurück ins Regal (vereinfachte Ablage: der Bot legt es sofort zurück)
  if (bot.carry) game.inventory[bot.carry]++;
  bot.carry = null;
}

function workDuration(game, bot, task) {
  const C = game.C;
  if (task.kind === 'extinguish') return C.bot.extinguishTime;
  if (task.kind === 'patch') return C.breach.patchTime * C.bot.repairFactor;
  const st = game.ship.systems[task.system];
  return (st === 'broken' ? C.repair.brokenToDamaged : C.repair.damagedToOk) * C.bot.repairFactor;
}

function moveAlong(game, bot, dt) {
  if (!bot.path || !bot.path.length) { bot.moving = false; return true; }
  const speed = game.C.player.speed * game.C.bot.speedFactor;
  let budget = speed * dt;
  while (budget > 0 && bot.path.length) {
    const n = bot.path[0];
    const c = W.tileCenter(n.x, n.y);
    const dx = c.x - bot.x, dy = c.y - bot.y;
    const d = Math.hypot(dx, dy);
    if (Math.abs(dx) > Math.abs(dy)) bot.dir = dx > 0 ? 'right' : 'left'; else if (d > 0.01) bot.dir = dy > 0 ? 'down' : 'up';
    if (d <= budget) { bot.x = c.x; bot.y = c.y; budget -= d; bot.path.shift(); }
    else { bot.x += dx / d * budget; bot.y += dy / d * budget; budget = 0; }
  }
  bot.moving = true;
  return bot.path.length === 0;
}

function update(game, dt) {
  ensureBotCount(game);
  resetNoPartReports(game);
  // Hafen-Übung: Die Schrauber machen Hafen-Check und lassen der Crew die Arbeit
  const drill = game.mission && game.mission.isDrill();
  // M1 §6: Reaktor-Neustart – ein Spieler hält einen Schalter allein -> ein Schrauber übernimmt den anderen (hat Vorrang)
  const rc = game.ship.reactorCtl;
  if (rc.state === 'offline' && rc.needBot && !game.bots.some((b) => b.task && b.task.kind === 'switch')) {
    const task = switchTask(game, rc.needBot);
    const free = game.bots.filter((b) => !b.task || b.task.kind === 'home' || b.task.phase !== 'work');
    const pick = (free.length ? free : game.bots).map((b) => ({ b, path: pathTo(b, goalTilesFor(task)) })).filter((o) => o.path)
      .sort((a, b) => a.path.length - b.path.length)[0];
    if (pick) { pick.b.task = task; task.phase = 'goto'; pick.b.path = pick.path; pick.b.progress = 0; pick.b.reevalT = 1; }
  }
  for (const bot of game.bots) {
    // QA M1: Reaktor-Neustart hat auch während der Übung Vorrang (sonst solo kein Neustart nach Überladen im Hafen)
    if (drill && !(bot.task && bot.task.kind === 'switch')) { bot.moving = false; continue; }
    bot.reevalT -= dt;
    // Gültigkeit / Neuwahl
    if (bot.task && bot.task.kind !== 'home' && !taskStillValid(game, bot.task)) { bot.task = null; bot.path = null; bot.progress = 0; }
    if (bot.reevalT <= 0) {
      bot.reevalT = REEVAL_INTERVAL;
      const cur = bot.task;
      if (!cur || cur.kind === 'home' || (cur.phase !== 'work' && cur.kind !== 'switch')) {
        const best = chooseTask(game, bot);
        if (best && (!cur || cur.kind === 'home' || best.cls < cur.cls)) assign(game, bot, best);
        else if (!best && !cur) {
          if (bot.carry) stowNow(game, bot);
          const home = { kind: 'home', key: null, cls: 9, phase: 'goto', tx: bot.spawn.x, ty: bot.spawn.y };
          const st = Physics.toTile(bot.x, bot.y);
          if (st.x !== bot.spawn.x || st.y !== bot.spawn.y) { bot.task = home; bot.path = pathTo(bot, [bot.spawn]); }
        }
      }
    }
    const t = bot.task;
    if (!t) { bot.moving = false; continue; }
    if (t.phase === 'fetch') {
      if (moveAlong(game, bot, dt)) {
        if (game.inventory[t.part] > 0) {
          game.inventory[t.part]--; bot.carry = t.part;
          game.emit('sfx', { name: 'bot_beep', zone: 'ship', x: Math.round(bot.x), y: Math.round(bot.y) });
          t.phase = 'goto'; bot.path = pathTo(bot, goalTilesFor(t));
          if (!bot.path) { bot.task = null; }
        } else { reportNoPart(game, t.part); bot.task = null; bot.path = null; }
      }
    } else if (t.phase === 'goto') {
      if (!bot.path) { bot.task = null; continue; }
      if (moveAlong(game, bot, dt)) {
        if (t.kind === 'home') { bot.task = null; bot.moving = false; continue; }
        t.phase = 'work'; bot.progress = 0; t.dur = workDuration(game, bot, t);
        // zum Ziel drehen
        const c = Physics.toTile(bot.x, bot.y);
        if (t.tx > c.x) bot.dir = 'right'; else if (t.tx < c.x) bot.dir = 'left'; else if (t.ty < c.y) bot.dir = 'up'; else if (t.ty > c.y) bot.dir = 'down';
      }
    } else if (t.phase === 'work') {
      bot.moving = false;
      if (t.kind === 'switch') { bot.progress = Math.min(1, rc.restartProgress / game.C.reactorM1.restartTime); continue; }
      if (t.kind === 'repair' && game.ship.systems[t.system] === 'broken' && bot.carry !== 'ersatzteil') { bot.task = null; continue; }
      bot.progress += dt / t.dur;
      if (bot.progress >= 1) {
        bot.progress = 0;
        if (t.kind === 'repair') {
          if (game.ship.systems[t.system] === 'broken') bot.carry = null;
          interior.repairSystem(game, t.system, 'bot');
          if (game.ship.systems[t.system] === 'damaged') { t.dur = workDuration(game, bot, t); continue; } // gleich weiter bis ok
        } else if (t.kind === 'extinguish') {
          interior.removeFire(game, t.tx, t.ty, 'bot');
          game.emit('sfx', { name: 'extinguish', zone: 'ship', x: Math.round(bot.x), y: Math.round(bot.y) });
        } else if (t.kind === 'patch') {
          bot.carry = null;
          interior.removeBreach(game, t.tx, t.ty, 'bot');
        }
        bot.task = null; bot.reevalT = 0;
      }
    }
  }
}

module.exports = { update, ensureBotCount, makeBot, candidates, reportNoPart };
