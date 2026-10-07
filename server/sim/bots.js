'use strict';
// Schrauber-Bots (§6): löschen, flicken Lecks, holen Teile. BFS auf Kacheln. Nie Konsolen, nie Plattform.
// M3a (CONTRACT-M3 §8.2): Systeme reparieren sie NUR aus der Reparaturliste ship.repairQueue = [{ system, mode, bot }].
// Feuer und Lecks erledigen sie weiter selbst. Automatik ship.botAuto füllt die Liste (Standard: an bei genau 1 Spieler).
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

// ---------- Reparaturliste ----------
const queueMax = (game) => (game.C.spaceM3 && game.C.spaceM3.repair && game.C.spaceM3.repair.queueMax) || 3;
function queueOf(game) { if (!Array.isArray(game.ship.repairQueue)) game.ship.repairQueue = []; return game.ship.repairQueue; }
// Altname 'weapons' -> die am schwersten beschädigte Waffe
function resolveSys(game, sys) {
  if (sys !== 'weapons') return sys;
  const rank = { ok: 0, damaged: 1, offline: 2, broken: 3 };
  return interior.WEAPON_SYSTEMS.slice().sort((a, b) => rank[game.ship.systems[b]] - rank[game.ship.systems[a]])[0];
}
// Eintrag erledigt: heil und nicht fragil; bei 'flick' reicht heil (Flicken macht nie unfragil)
function entryDone(game, e) {
  if (game.ship.systems[e.system] !== 'ok') return false;
  return e.mode === 'flick' || !interior.isFragile(game, e.system);
}

// captain.repair { system, mode: 'flick'|'part'|null }
function queueRepair(game, sys, mode) {
  sys = resolveSys(game, String(sys));
  if (!interior.SYSTEM_ORDER.includes(sys)) return 'Unbekanntes System.';
  if (mode != null && mode !== 'flick' && mode !== 'part') return 'Unbekannte Reparaturart.';
  const q = queueOf(game);
  const i = q.findIndex((e) => e.system === sys);
  if (mode == null) { if (i >= 0) q.splice(i, 1); return null; }
  if (i >= 0) { q[i].mode = mode; return null; }
  if (!interior.repairable(game, sys) && game.ship.systems[sys] !== 'offline') return `${cap(interior.sysNameNom(sys))} ist heil.`;
  if (mode === 'flick' && game.ship.systems[sys] === 'ok') return `${cap(interior.sysNameNom(sys))} ist schon geflickt – für dauerhaft: Teil.`;
  if (q.length >= queueMax(game)) return `Reparaturliste voll (${queueMax(game)}) – erst einen Eintrag entfernen.`;
  q.push({ system: sys, mode, bot: null });
  return null;
}
// captain.priority mit System-ID: flick-Eintrag an die Spitze (§8.2)
function queueFront(game, sys) {
  sys = resolveSys(game, String(sys));
  if (!interior.SYSTEM_ORDER.includes(sys)) return 'Unbekanntes System.';
  const q = queueOf(game);
  const i = q.findIndex((e) => e.system === sys);
  const e = i >= 0 ? q.splice(i, 1)[0] : { system: sys, mode: 'flick', bot: null };
  e.mode = 'flick';
  q.unshift(e);
  while (q.length > queueMax(game)) q.pop();
  return null;
}
// captain.botAuto { on } – danach gilt die Wahl des Captains bis zum Ende der Partie
function setBotAuto(game, on) {
  game.ship.botAuto = !!on;
  game.ship.botAutoChosen = true;
  return null;
}
function updateBotAuto(game) {
  const ship = game.ship;
  if (!ship.botAutoChosen) ship.botAuto = game.players.filter((p) => p.connected).length === 1;
  const q = queueOf(game);
  // erledigte Einträge fallen weg
  for (let i = q.length - 1; i >= 0; i--) if (entryDone(game, q[i]) || !interior.SYSTEM_ORDER.includes(q[i].system)) q.splice(i, 1);
  if (!ship.botAuto) return;
  const max = queueMax(game);
  const has = (s) => q.some((e) => e.system === s);
  for (const sys of interior.SYSTEM_ORDER) {
    if (q.length >= max) break;
    if (ship.systems[sys] === 'broken' && !has(sys)) q.push({ system: sys, mode: game.inventory.ersatzteil > 0 ? 'part' : 'flick', bot: null });
  }
  for (const sys of interior.SYSTEM_ORDER) {
    if (q.length >= max) break;
    if (ship.systems[sys] === 'damaged' && !has(sys)) q.push({ system: sys, mode: 'flick', bot: null });
  }
}

// ---------- Aufgaben ----------
// Kandidaten in Prioritätsreihenfolge: Captain-Priorität Feuer/Leck > Reparaturliste (Reihenfolge) > Feuer > Leck.
function candidates(game) {
  const ship = game.ship;
  const list = [];
  const fireTask = (f, cls) => ({ cls, kind: 'extinguish', key: `fire:${f.tx},${f.ty}`, tx: f.tx, ty: f.ty, part: null });
  const breachTask = (b, cls) => ({ cls, kind: 'patch', key: `breach:${b.tx},${b.ty}`, tx: b.tx, ty: b.ty, part: 'flickblech' });
  const pr = ship.priority;
  if (pr === 'fire') ship.fireList.forEach((f) => list.push(fireTask(f, 0)));
  else if (pr === 'breach') ship.breachList.forEach((b) => list.push(breachTask(b, 0)));
  queueOf(game).forEach((e, i) => {
    if (ship.systems[e.system] === 'offline' || entryDone(game, e)) return;
    const first = W.SYSTEM_TILES[e.system] || { x: 0, y: 0 };
    list.push({ cls: 1 + i * 0.01, kind: 'repair', key: 'sys:' + e.system, system: e.system, mode: e.mode, tx: first.x, ty: first.y,
      part: e.mode === 'part' ? 'ersatzteil' : null });
  });
  ship.fireList.forEach((f) => list.push(fireTask(f, 2)));
  ship.breachList.forEach((b) => list.push(breachTask(b, 3)));
  return list;
}

function switchTask(game, sw) {
  const t = W.REACTOR_SWITCHES.find((q) => q.id === sw);
  return { cls: -1, kind: 'switch', key: 'switch:' + sw, sw, tx: t.x, ty: t.y, part: null };
}

// M3a: alle Stationskacheln eines Systems (W.STATIONS), Fallback erste Kachel (W.SYSTEM_TILES)
function stationTilesOf(sys) {
  const list = (W.STATIONS || []).filter((s) => s.system === sys);
  if (list.length) return list;
  const t = W.SYSTEM_TILES[sys];
  return t ? [t] : [];
}

function goalTilesFor(task) {
  if (task.kind === 'repair') {
    let out = [];
    for (const s of stationTilesOf(task.system)) out = out.concat(W.accessTiles(W.ship, W.shipWalkable, s.x, s.y));
    return out;
  }
  if (task.kind === 'switch') return W.accessTiles(W.ship, W.shipWalkable, task.tx, task.ty);
  const out = [{ x: task.tx, y: task.ty }];
  return out.concat(W.accessTiles(W.ship, W.shipWalkable, task.tx, task.ty));
}

function pathTo(bot, goals) {
  const st = Physics.toTile(bot.x, bot.y);
  const set = new Set(goals.map((g) => g.y * W.ship.w + g.x));
  // M4: mit Lift-Kanten (nie Leiter) – ein Pfadschritt mit via 'lift' heißt: auf der Plattform Lift fahren
  return bfs(W.shipWalkable, st, (x, y) => set.has(y * W.ship.w + x) && W.shipWalkable(x, y), W.ship.w, W.ship.h, null, W.liftLinks);
}

// M3a: Zugangskachel aus dem Schiffslayout (shelf.access); Fallback: begehbare Nachbarn des Regals
function shelfAccess(item) {
  const s = W.SHELF_TILES.find((t) => t.item === item);
  if (!s) return [];
  if (s.access) return [{ x: s.access.x, y: s.access.y }];
  return W.accessTiles(W.ship, W.shipWalkable, s.x, s.y);
}

function taskStillValid(game, t) {
  const ship = game.ship;
  if (t.kind === 'repair') {
    const e = queueOf(game).find((q) => q.system === t.system);
    if (!e || e.mode !== t.mode || entryDone(game, e)) return false;
    return ship.systems[t.system] !== 'offline';
  }
  if (t.kind === 'extinguish') return ship.fireList.some((f) => f.tx === t.tx && f.ty === t.ty);
  if (t.kind === 'patch') return ship.breachList.some((b) => b.tx === t.tx && b.ty === t.ty);
  if (t.kind === 'switch') return ship.reactorCtl.state === 'offline' && ship.reactorCtl.needBot === t.sw;
  return true;
}

function chooseTask(game, bot) {
  const taken = new Set(game.bots.filter((b) => b !== bot && b.task && b.task.key).map((b) => b.task.key));
  for (const c of candidates(game)) {
    if (taken.has(c.key)) continue;
    if (c.part && bot.carry !== c.part && game.inventory[c.part] <= 0) {
      reportNoPart(game, c.part);
      if (c.kind === 'repair') {   // §8.2: kein Ersatzteil im Lager -> Eintrag wird zu flick
        const e = queueOf(game).find((q) => q.system === c.system);
        if (e) e.mode = 'flick';
        c.mode = 'flick'; c.part = null;
      } else continue;
    }
    const path = pathTo(bot, goalTilesFor(c));
    if (!path) continue;
    return c;
  }
  return null;
}

// M0: Fehlt ein Teil, melden die Schrauber das einmalig (bis wieder Nachschub im Regal liegt), statt stumm zu überspringen.
const PART_TEXT = { ersatzteil: 'Kein Ersatzteil mehr im Lager – wir flicken nur', flickblech: 'Kein Flickblech mehr im Lager' };
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
  return interior.repairTime(game, task.mode === 'part' ? 'swap' : 'flick') * C.bot.repairFactor;
}

function moveAlong(game, bot, dt) {
  if (bot.lift) { bot.moving = false; return false; }   // M4: fährt gerade (update() zählt die Fahrt)
  if (!bot.path || !bot.path.length) { bot.moving = false; return true; }
  const speed = game.C.player.speed * game.C.bot.speedFactor;
  let budget = speed * dt;
  while (budget > 0 && bot.path.length) {
    const n = bot.path[0];
    if (n.via === 'lift') {   // Liftkante: von der aktuellen Liftkachel aus fahren
      const cur = Physics.toTile(bot.x, bot.y);
      interior.startLift(game, bot, cur.x, cur.y, true);
      bot.liftDest = { x: n.x, y: n.y };
      return false;
    }
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

// bot-Feld der Listeneinträge = Bot, der den Eintrag gerade bearbeitet
function syncQueueBots(game) {
  for (const e of queueOf(game)) {
    const b = game.bots.find((o) => o.task && o.task.kind === 'repair' && o.task.system === e.system);
    e.bot = b ? b.id : null;
  }
}

function update(game, dt) {
  ensureBotCount(game);
  resetNoPartReports(game);
  updateBotAuto(game);
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
    // M4: Liftfahrt (gleiche Zeit wie für Spieler). Währenddessen keine Neuwahl; danach geht es auf dem Restpfad weiter.
    if (bot.lift) {
      bot.moving = false;
      bot.lift.t += dt;
      if (bot.lift.t < bot.lift.T) continue;
      interior.finishLift(game, bot, true);
      if (bot.path && bot.path.length && bot.path[0].via === 'lift') bot.path.shift();
      continue;
    }
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
        } else {
          reportNoPart(game, t.part);
          if (t.kind === 'repair') { const e = queueOf(game).find((q) => q.system === t.system); if (e) e.mode = 'flick'; }
          bot.task = null; bot.path = null;
        }
      }
    } else if (t.phase === 'goto') {
      if (!bot.path) { bot.task = null; continue; }
      if (moveAlong(game, bot, dt)) {
        if (t.kind === 'home') { bot.task = null; bot.moving = false; continue; }
        t.phase = 'work'; bot.progress = 0; t.dur = workDuration(game, bot, t);
        // zum Ziel drehen
        const c = Physics.toTile(bot.x, bot.y);
        if (t.kind === 'repair') { // M3a: an der tatsächlich erreichten Stationskachel arbeiten
          const adj = stationTilesOf(t.system).find((s) => Math.abs(s.x - c.x) + Math.abs(s.y - c.y) === 1);
          if (adj) { t.tx = adj.x; t.ty = adj.y; }
        }
        if (t.tx > c.x) bot.dir = 'right'; else if (t.tx < c.x) bot.dir = 'left'; else if (t.ty < c.y) bot.dir = 'up'; else if (t.ty > c.y) bot.dir = 'down';
      }
    } else if (t.phase === 'work') {
      bot.moving = false;
      if (t.kind === 'switch') { bot.progress = Math.min(1, rc.restartProgress / game.C.reactorM1.restartTime); continue; }
      if (t.kind === 'repair' && t.mode === 'part' && bot.carry !== 'ersatzteil') { bot.task = null; continue; }
      bot.progress += dt / t.dur;
      if (bot.progress >= 1) {
        bot.progress = 0;
        if (t.kind === 'repair') {
          if (t.mode === 'part') { bot.carry = null; interior.repairSystem(game, t.system, 'bot', 'swap'); }
          else {
            interior.repairSystem(game, t.system, 'bot', 'flick');
            if (game.ship.systems[t.system] === 'damaged') { t.dur = workDuration(game, bot, t); continue; } // gleich weiter bis heil
          }
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
  // erledigte Einträge aufräumen, Bot-Zuordnung für den Snapshot
  const q = queueOf(game);
  for (let i = q.length - 1; i >= 0; i--) if (entryDone(game, q[i])) q.splice(i, 1);
  syncQueueBots(game);
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

module.exports = { update, ensureBotCount, makeBot, candidates, reportNoPart, queueRepair, queueFront, setBotAuto, updateBotAuto };
