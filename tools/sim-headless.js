'use strict';
// Headless-Simulation (M1): startet das Spiel im selben Prozess und lässt 1 bzw. 3 skriptgesteuerte Spieler-Bots
// Mission 1 „Die stumme Boje“ UND Mission 2 „Echo im Nebel“ mit echten Befehlen spielen (keine Debug-Befehle).
// Beschleunigt (Ticks ohne Echtzeit). Ausgabe: Erfolg, Dauer je Mission/Schritt/Ort (Spielsekunden), Fehler, Softlocks, Snapshot-Größe.
//
//   node tools/sim-headless.js              -> solo + 3 Spieler + solo ohne Übung (mit Wrack-Abstecher)
//   node tools/sim-headless.js 1 --seed 7   -> nur solo, Seed 7
//   node tools/sim-headless.js 3 --wreck    -> zu dritt mit Wrack-Außenmission
//   node tools/sim-headless.js --verbose    -> ODA-/Notice-Texte mitschreiben
const Maps = require('../shared/maps.js');
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');
const Locations = require('../shared/locations.js');
const { Game } = require('../server/game.js');
const { bfs, clamp, makeRng } = require('../server/util.js');
const W = require('../server/world.js');
let simRng = makeRng(1);
// M3b §2/§6: Temporegler in Stufen. Die Bots stellen Stufen ein (helm.throttle) und geben nur noch das Ruder.
let Flight = null;
try { Flight = require('../shared/flight.js'); } catch (e) { Flight = null; }
const LCLS = (CONFIG.shipClasses && CONFIG.shipClasses.lerche) || { maxSpeed: CONFIG.ship.maxSpeed, stages: [-0.23, 0, 0.27, 0.5, 0.75, 1], turnRate: CONFIG.ship.turnRate, turnAccel: CONFIG.ship.turnAccel };
const STOP = Flight ? Flight.stopStage(LCLS) : 1;
const HALF = Flight && Flight.agileStage ? Flight.agileStage(LCLS) : 3;
const QUARTER = STOP + 1, THREEQ = Math.min(LCLS.stages.length - 1, HALF + 1), FULL = LCLS.stages.length - 1;
const stageSpeedOf = (i) => (Flight ? Flight.stageSpeed(LCLS, i) : LCLS.stages[i] * LCLS.maxSpeed);
const turnFactorOf = (v) => (Flight ? Flight.turnFactor(LCLS, v) : 1);

// M3a: Schiffskoordinaten nur aus dem Layout (shared/maps.js bzw. server/world.js), nie fest
const shelfOf = (item) => Maps.SHELF_TILES.find((s) => s.item === item);
const switchOf = (id) => Maps.REACTOR_SWITCHES.find((s) => s.id === id) || Maps.REACTOR_SWITCHES[0];
const systemTile = (sys) => W.SYSTEM_TILES[sys];
const consoleTileOf = (con) => (W.CONSOLE_TILES[con] || [])[0];

// M3a: Stationen (W.STATIONS) und Waffen-Halterungen
const stationTile = (sys) => { const st = (W.STATIONS || []).find((s) => s.system === sys); return st ? { x: st.x, y: st.y } : systemTile(sys); };
const M3 = CONFIG.spaceM3 || {};
const MOUNT_IDS = ['bow', 'port', 'stbd'];
const SECTOR_OF_SIDE = { port: 3, stbd: 1 };
const EMITTER_OF = ['emitter_bow', 'emitter_stbd', 'emitter_aft', 'emitter_port'];
// Reihenfolge, in der Spieler-Bots zerstörte/beschädigte Systeme angehen (Kampfwert zuerst)
const REPAIR_PRIO = ['shields', 'reactor', 'thruster_port', 'thruster_stbd', 'emitter_port', 'emitter_stbd', 'emitter_bow', 'emitter_aft',
  'battery_port', 'battery_stbd', 'weapon_bow', 'engines', 'life', 'transfer'];

const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const WRECK = args.includes('--wreck');
const argVal = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const seedArg = args.indexOf('--seed') >= 0 ? Number(args[args.indexOf('--seed') + 1]) : null;
const counts = args.filter((a, i) => /^[123]$/.test(a) && !/^--/.test(args[i - 1] || '')).map(Number);
const PILOT = argVal('--pilot', null);   // Steuer-Strategie: nose | maneuver (| both im Testgelände)
const SOFTLOCK_SEC = 420;
const MAX_GAME_SEC = 3600;
const DT = 1 / CONFIG.tickHz;
const TILE = 32;

const norm = Physics.normAngle;
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const NEBEL_WAYPOINTS = [{ x: 1300, y: 1200 }, { x: 2200, y: 800 }, { x: 2300, y: 1700 }, { x: 1200, y: 600 }, { x: 900, y: 1900 }];

// ---------- Spieler-Agent ----------
class Agent {
  constructor(game, idx, role, opts) {
    this.game = game; this.idx = idx; this.role = role; this.opts = opts;
    this.notices = [];
    this.conn = { send: (o) => this.onMsg(o) };
    this.pid = null;
    this.ix = null; this.lastPos = null; this.stuckT = 0; this.jiggle = 0; this.jiggleDir = { x: 0, y: 0 };
    this.lastInput = { mx: 0, my: 0 }; this.seq = 0; this.actDown = false;
    this.helmSent = { turn: 9, thrust: 9 }; this.helmT = 0;
    this.memo = {}; this.waitT = 0; this.scanT = 0; this.locs = null;
  }
  onMsg(o) {
    if (o.t === 'welcome') this.pid = o.pid;
    if (o.t === 'event' && o.kind === 'notice' && o.pid === this.pid) { this.notices.push(o.text); if (VERBOSE) log(`  [notice ${this.pid}] ${o.text}`); }
  }
  send(msg) {
    // M3b §0.8/§6: Die unbesetzte Steuer hält die Stufe (keine Sonderbremse mehr). Wer die Steuer verlässt, stellt
    // vorher auf STOPP – sonst fährt das Schiff davon (z. B. solo vor dem Beamen, Reparaturgang, Reaktor).
    if (msg.t === 'leave') {
      const me = this.game.players.find((p) => p.id === this.pid);
      const h = this.game.ship.helm || {};
      if (me && me.console === 'helm' && typeof h.stage === 'number' && h.stage !== STOP && !this.keepStage) this.game.handleMessage(this.conn, { t: 'cmd', c: 'helm.throttle', set: STOP });
    }
    this.game.handleMessage(this.conn, msg);
  }
  hello() { this.send({ t: 'hello', clientId: 'sim-' + this.idx, name: ['Ada', 'Bo', 'Cem'][this.idx], color: this.idx }); this.send({ t: 'ready', ready: true }); }
  input(mx, my) {
    if (mx === this.lastInput.mx && my === this.lastInput.my && mx === 0 && my === 0) return;
    this.lastInput = { mx, my };
    this.send({ t: 'input', seq: ++this.seq, mx, my });
  }
  act(down) { if (down !== this.actDown) { this.actDown = down; this.send({ t: 'act', down }); } }
  cmd(c, extra) {
    const key = c + JSON.stringify(extra || {});
    const now = this.game.time;
    if (c !== 'helm.input' && c !== 'captain.scan' && c !== 'weapons.scan' && this.lastCmd === key && now - this.lastCmdAt < 0.25) return;
    this.lastCmd = key; this.lastCmdAt = now;
    this.send(Object.assign({ t: 'cmd', c }, extra || {}));
  }
  helm(turn, thrust) {
    turn = Math.round(turn * 20) / 20; thrust = Math.round(thrust * 20) / 20;
    this.helmT -= DT;
    if (turn !== this.helmSent.turn || thrust !== this.helmSent.thrust || this.helmT <= 0) {
      this.helmSent = { turn, thrust }; this.helmT = 0.1;
      this.cmd('helm.input', { turn, thrust });
    }
  }
  // M3b: Ruder + Stufe. Ohne Stufen im Snapshot (alter Server) wird die Stufe als Schub nachgeregelt.
  staged(S) { return !!(S.ship.helm && typeof S.ship.helm.stage === 'number'); }
  helmS(S, turn, stage) {
    stage = clamp(Math.round(stage), 0, LCLS.stages.length - 1);
    const sh = S.ship;
    if (!this.staged(S)) {
      const fwd = sh.vx * Math.cos(sh.angle) + sh.vy * Math.sin(sh.angle);
      const want = stageSpeedOf(stage);
      this.helm(turn, fwd < want - 3 ? 1 : (fwd > want + 3 ? -1 : 0));
      return;
    }
    const m = this.memo;
    if (sh.helm.stage !== stage && !(m.thrWant === stage && (m.thrAt || 0) > S.time)) {
      this.cmd('helm.throttle', { set: stage });
      m.thrWant = stage; m.thrAt = S.time + 0.3;
      this.game.simStats.throttles = (this.game.simStats.throttles || 0) + 1;
    }
    this.helm(turn, 0);
  }
  // Stufe für ein Wunschtempo: die schnellste Vorwärtsstufe, die nicht schneller ist (unter halbem ¼-Tempo: STOPP)
  stageFor(speed) {
    if (speed < stageSpeedOf(QUARTER) * 0.5) return STOP;
    let best = QUARTER;
    for (let i = QUARTER; i <= FULL; i++) if (stageSpeedOf(i) <= speed + 2) best = i;
    return best;
  }

  me(S) { return S.players.find((p) => p.id === this.pid); }
  tile(p) { return { x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) }; }
  awayMap(S) { return S.away.map === 'wreck' ? Maps.wreck : Maps.platform; }
  walkable(S, zone) {
    if (zone === 'away') {
      const m = this.awayMap(S);
      return (x, y) => { const ch = m.at(x, y); if (ch === 'L' && S.away.map === 'platform') return S.away.doorOpen; if (ch === 'V' && S.away.map === 'wreck') return !!(S.away.hollow && S.away.hollow.open); return !m.solid(x, y); };
    }
    return (x, y) => !Maps.ship.solid(x, y);
  }
  mapFor(S, zone) { return zone === 'away' ? this.awayMap(S) : Maps.ship; }

  goto(S, goals) {
    const p = this.me(S);
    const map = this.mapFor(S, p.zone);
    const walk = this.walkable(S, p.zone);
    const st = this.tile(p);
    // M4: im Lift warten (Eingaben sind gesperrt); an Bord mit Lift-Kanten planen (Agenten nehmen den Lift, nicht die Leiter)
    if (p.lift) { this.input(0, 0); this.stuckT = 0; return false; }
    const set = new Set(goals.map((g) => g.y * map.w + g.x));
    const path = bfs(walk, st, (x, y) => set.has(y * map.w + x) && walk(x, y), map.w, map.h, null, p.zone === 'ship' ? W.liftLinks : null);
    if (!path) { this.input(0, 0); return 'fail'; }
    if (path.length && path[0].via === 'lift') {
      // auf der Liftkachel: zur Mitte, stehen bleiben, E tippen
      const c = Physics.tileCenter(st.x, st.y);
      if (dist(p.x, p.y, c.x, c.y) > 4) { const dx = c.x - p.x, dy = c.y - p.y, l = Math.hypot(dx, dy) || 1; this.input(Math.round(dx / l * 50) / 100, Math.round(dy / l * 50) / 100); return false; }
      this.input(0, 0);
      if ((this.memo.liftTapAt || -9) < S.time - 0.5) {
        this.memo.liftTapAt = S.time;
        this.send({ t: 'act', down: true }); this.send({ t: 'act', down: false }); this.actDown = false;
        this.game.simStats.liftRides = (this.game.simStats.liftRides || 0) + 1;
      }
      return false;
    }
    let target;
    if (path.length === 0) {
      const c = Physics.tileCenter(st.x, st.y);
      if (dist(p.x, p.y, c.x, c.y) < 4) { this.input(0, 0); return true; }
      target = c;
    } else target = Physics.tileCenter(path[0].x, path[0].y);
    if (this.lastPos && dist(this.lastPos.x, this.lastPos.y, p.x, p.y) < 0.5) this.stuckT += DT; else this.stuckT = 0;
    this.lastPos = { x: p.x, y: p.y };
    if (this.jiggle > 0) { this.jiggle -= DT; this.input(this.jiggleDir.x, this.jiggleDir.y); return false; }
    if (this.stuckT > 0.6) { this.stuckT = 0; this.jiggle = 0.25; const a = simRng() * Math.PI * 2; this.jiggleDir = { x: Math.round(Math.cos(a) * 100) / 100, y: Math.round(Math.sin(a) * 100) / 100 }; }
    let dx = target.x - p.x, dy = target.y - p.y;
    if (path.length) {
      const n = path[0];
      if (n.x !== st.x) dy = (Physics.tileCenter(st.x, st.y).y - p.y) * 0.3 + (target.y - p.y) * 0.1;
      if (n.y !== st.y) dx = (Physics.tileCenter(st.x, st.y).x - p.x) * 0.3 + (target.x - p.x) * 0.1;
    }
    const len = Math.hypot(dx, dy) || 1;
    const sp = len < 6 ? len / 6 : 1;
    this.input(Math.round(dx / len * sp * 100) / 100, Math.round(dy / len * sp * 100) / 100);
    return false;
  }

  interact(S, tx, ty, opts) {
    const o = opts || {};
    const p = this.me(S);
    const walk = this.walkable(S, p.zone);
    const st = this.tile(p);
    const ix = this.ix && this.ix.tx === tx && this.ix.ty === ty ? this.ix : (this.ix = { tx, ty, phase: 'go', t: 0 });
    if (ix.phase === 'go') {
      const goals = [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([a, b]) => ({ x: tx + a, y: ty + b })).filter((g) => walk(g.x, g.y));
      if (o.floor) goals.push({ x: tx, y: ty });
      const r = this.goto(S, goals);
      if (r === 'fail') { this.ix = null; return 'fail'; }
      if (r === true) ix.phase = 'face';
      return 'running';
    }
    if (ix.phase === 'face') {
      const dx = Math.sign(tx - st.x), dy = Math.sign(ty - st.y);
      if (dx || dy) this.input(dx * 0.3, dx ? 0 : dy * 0.3);
      ix.phase = 'stop'; return 'running';
    }
    if (ix.phase === 'stop') { this.input(0, 0); ix.phase = 'down'; return 'running'; }
    if (ix.phase === 'down') { this.act(true); ix.phase = o.hold ? 'hold' : 'up'; ix.t = 0; return 'running'; }
    if (ix.phase === 'up') { this.act(false); this.ix = null; return 'done'; }
    if (ix.phase === 'hold') {
      ix.t += DT;
      if (o.until && o.until(S)) { this.act(false); this.ix = null; return 'done'; }
      if (ix.t > 0.5 && !p.action) { this.act(false); this.ix = null; return 'fail'; }
      if (ix.t > (o.max || 20)) { this.act(false); this.ix = null; return 'fail'; }
      return 'running';
    }
    return 'running';
  }

  consoleTile(kind, p) {
    if (kind === 'sonde') return Maps.platform.find('Z')[0];
    if (kind === 'quartier') { const b = Maps.BEDS.find((q) => q.color === p.color); return { x: b.x, y: b.y }; }
    return consoleTileOf(kind);
  }
  enter(S, kind) {
    const p = this.me(S);
    if (p.console === kind) { this.ix = null; return true; }
    if (p.console) { this.send({ t: 'leave' }); return false; }
    if (p.zone !== 'ship' && kind !== 'sonde') return false;
    if (this.actDown) this.act(false);
    const t = this.consoleTile(kind, p);
    const r = this.interact(S, t.x, t.y, {});
    if (r === 'fail') this.waitT = 0.5;
    // Snapshot kommt nur jeden 2. Tick: kurz warten, bis die Konsole im Snapshot steht (sonst „dreht“ sich der Bot weg)
    if (r === 'done') this.waitT = 0.1;
    return false;
  }
  leave(S) { const p = this.me(S); if (p.console) this.send({ t: 'leave' }); }

  // Reparatur an einer Station (M3a §8.1). how: 'swap' (Ersatzteil holen, E halten 3 s -> ok), 'flick' (E halten 1,5 s, eine Stufe,
  // fragil) oder 'minigame' (R: repair.start, nach 3,5 s repair.done – simuliertes Minispiel). Ohne how: zerstört -> swap, sonst flick.
  repair(S, p, sys, how) {
    const st = S.ship.systems[sys];
    const fragile = (S.ship.fragile || []).includes(sys);
    if ((st === 'ok' && !(how === 'swap' && fragile)) || st === 'offline' || st == null) { this.memo.mg = null; return 'done'; }
    if (p.zone !== 'ship') return 'skip';
    if (p.console) { this.send({ t: 'leave' }); return 'running'; }
    if (!how) how = st === 'broken' && (S.inventory.ersatzteil > 0 || p.carry === 'ersatzteil') ? 'swap' : 'flick';
    if (how === 'swap' && p.carry !== 'ersatzteil') {
      if (S.inventory.ersatzteil <= 0) how = 'flick';
      else {
        if (p.carry) { this.send({ t: 'drop' }); return 'running'; }
        const shelf = shelfOf('ersatzteil');
        this.interact(S, shelf.x, shelf.y, {});
        return 'running';
      }
    }
    if (how === 'flick' && p.carry === 'ersatzteil') how = 'swap';   // E mit Teil in der Hand ist immer Austausch
    if (how === 'flick' && p.carry && p.carry !== 'ersatzteil') { this.send({ t: 'drop' }); return 'running'; }
    const t = stationTile(sys);
    if (how === 'minigame') return this.minigame(S, p, sys, t);
    const before = st + (fragile ? '!' : '');
    const r = this.interact(S, t.x, t.y, { hold: true, until: (S2) => S2.ship.systems[sys] + ((S2.ship.fragile || []).includes(sys) ? '!' : '') !== before });
    if (r === 'fail') this.waitT = 0.3;
    return 'running';
  }
  // Minispiel wie ein Mensch: hingehen, zur Station drehen, R (repair.start), 3,5 s spielen, repair.done
  minigame(S, p, sys, t) {
    const m = this.memo;
    if (!m.mg || m.mg.sys !== sys) m.mg = { sys, phase: 'go', t: 0 };
    const mg = m.mg;
    if (mg.phase === 'go') {
      const walk = this.walkable(S, 'ship');
      const goals = [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([a, b]) => ({ x: t.x + a, y: t.y + b })).filter((g) => walk(g.x, g.y));
      const r = this.goto(S, goals);
      if (r === 'fail') { m.mg = null; this.waitT = 0.5; return 'running'; }
      if (r === true) mg.phase = 'face';
      return 'running';
    }
    if (mg.phase === 'face') {
      const st = this.tile(p);
      const dx = Math.sign(t.x - st.x), dy = Math.sign(t.y - st.y);
      if (dx || dy) this.input(dx * 0.3, dx ? 0 : dy * 0.3);
      mg.phase = 'stop'; return 'running';
    }
    if (mg.phase === 'stop') { this.input(0, 0); mg.phase = 'start'; return 'running'; }
    if (mg.phase === 'start') {
      this.send({ t: 'cmd', c: 'repair.start', system: sys });
      mg.phase = 'play'; mg.t = 0; return 'running';
    }
    if (mg.phase === 'play') {
      mg.t += DT;
      if (mg.t > 0.5 && !(p.action && p.action.kind === 'minigame')) { m.mg = null; this.waitT = 0.5; this.game.simStats.minigameRejected = (this.game.simStats.minigameRejected || 0) + 1; return 'running'; }
      if (mg.t >= 3.5) {
        this.send({ t: 'cmd', c: 'repair.done', system: sys, errors: Math.floor(simRng() * 3) });
        mg.phase = 'done'; mg.t = 0;
      }
      return 'running';
    }
    if (mg.phase === 'done') { mg.t += DT; if (mg.t > 0.3) m.mg = null; return 'running'; }
    return 'running';
  }

  // ---------- M3a: Spieler-Bot verlässt die Brücke zum Reparieren ----------
  // Wählt ein System (zerstört vor beschädigt, nach REPAIR_PRIO), das kein Schrauber gerade bearbeitet, und repariert es:
  // zerstört -> Austausch (Teil im Lager) sonst Flicken; beschädigt -> Minispiel, unter Druck (Ladung läuft) Flicken.
  repairDuty(S, p, opts) {
    const o = opts || {};
    const sh = S.ship; const m = this.memo;
    if (p.zone !== 'ship') return false;
    const queue = sh.repairQueue || [];
    const botBusy = (s) => queue.some((q) => q.system === s && q.bot);
    const mates = (this.game.simAgents || []).filter((a) => a !== this && a.memo.job);
    const taken = (s) => mates.some((a) => a.memo.job.sys === s && S.time - (a.memo.job.seen || 0) < 2);
    if (m.job && S.time - (m.job.seen || S.time) > 2) { m.job = null; m.mg = null; }   // liegengebliebener Auftrag (Rolle war woanders)
    if (m.job) {
      m.job.seen = S.time;
      const st = sh.systems[m.job.sys];
      const fragile = (sh.fragile || []).includes(m.job.sys);
      const done = st === 'offline' || (st === 'ok' && !(m.job.how === 'swap' && fragile)) || (m.job.how === 'flick' && st !== m.job.from) || (S.time - m.job.at > 60);
      if (done) { m.job = null; m.mg = null; this.ix = null; if (this.actDown) this.act(false); return false; }
      const r = this.repair(S, p, m.job.sys, m.job.how);
      if (r === 'skip') { m.job = null; return false; }
      return true;
    }
    if ((m.jobCd || 0) > S.time) return false;
    const cand = REPAIR_PRIO.filter((s) => sh.systems[s] === 'broken' || sh.systems[s] === 'damaged')
      .filter((s) => !botBusy(s) && !taken(s))
      .filter((s) => o.damaged || sh.systems[s] === 'broken')
      .sort((a, b) => (sh.systems[a] === 'broken' ? 0 : 1) - (sh.systems[b] === 'broken' ? 0 : 1));
    const sys = cand[0];
    if (!sys) return false;
    const st = sh.systems[sys];
    const pressure = S.space.enemies.some((e) => e.tele);
    let how;
    if (st === 'broken') how = S.inventory.ersatzteil > 0 && !pressure ? 'swap' : 'flick';
    else how = pressure || o.fast ? 'flick' : 'minigame';
    m.job = { sys, how, from: st, at: S.time, seen: S.time };
    m.jobCd = S.time + (o.cooldown || 4);
    this.game.simStats.jobs = this.game.simStats.jobs || {};
    this.game.simStats.jobs[how] = (this.game.simStats.jobs[how] || 0) + 1;
    return this.repair(S, p, sys, how) === 'running';
  }

  // ---------- Flug ----------
  steer(S, tx, ty, arriveDist, maxSpd) {
    const sh = S.ship;
    const gd = Math.hypot(tx - sh.x, ty - sh.y) || 1;
    if (S.space.asteroids) this.memo.asteroids = S.space.asteroids;
    if (this.memo.astScene !== sh.scene && S.space.asteroids) this.memo.astScene = sh.scene;
    const rocks = this.memo.astScene === sh.scene ? (this.memo.asteroids || []) : [];
    const goalA = Math.atan2(ty - sh.y, tx - sh.x);
    const clear = (a, len) => {
      const cx = Math.cos(a), cy = Math.sin(a);
      for (const r of rocks) {
        const rx = r.x - sh.x, ry = r.y - sh.y;
        const along = rx * cx + ry * cy;
        if (along < -10 || along > len + r.r) continue;
        if (Math.abs(-rx * cy + ry * cx) < r.r + 36 + 22) return false;
      }
      return true;
    };
    let desired = goalA;
    const look = Math.min(280, gd);
    for (let k = 0; k <= 16; k++) {
      const cands = k === 0 ? [goalA] : [goalA + k * 0.12, goalA - k * 0.12];
      const ok = cands.filter((a) => clear(a, look)).sort((a, b) => Math.abs(norm(a - sh.angle)) - Math.abs(norm(b - sh.angle)));
      if (ok.length) { desired = ok[0]; break; }
    }
    const diff = norm(desired - sh.angle);
    const turn = this.turnCmd(S, diff);
    const rest = Math.max(0, gd - arriveDist);
    // Wunschtempo: linear zum Ziel, aber nie schneller, als die Lerche bis zum Ziel bremsen kann (decel ≈ 30 px/s²)
    const targetSpeed = Math.min(maxSpd || 120, rest * 0.6, Math.sqrt(2 * 18 * rest));
    // M3b: Wenden bei ½ (am wendigsten), nahe am Ziel bei ¼; geradeaus die Stufe zum Wunschtempo
    let stage;
    if (Math.abs(diff) > 1.2) stage = gd > 300 ? HALF : QUARTER;
    else if (Math.abs(diff) > 0.6 && targetSpeed >= stageSpeedOf(QUARTER)) stage = Math.min(HALF, this.stageFor(targetSpeed));
    else stage = this.stageFor(targetSpeed);
    this.helmS(S, turn, stage);
    return gd <= arriveDist;
  }
  // Anhalten: Allstopp (X) bei Fahrt, sonst STOPP. true = steht.
  brake(S) {
    const sh = S.ship;
    const fwd = sh.vx * Math.cos(sh.angle) + sh.vy * Math.sin(sh.angle);
    const still = Math.abs(fwd) < 4 && sh.speed < 8;
    if (!this.staged(S)) {
      const stopTurn = this.turnCmd(S, 0);
      if (still) { this.helm(stopTurn, 0); return true; }
      this.helm(stopTurn, fwd > 0 ? -1 : 1);
      return false;
    }
    if (sh.docked) { this.helmS(S, 0, STOP); return true; }
    if (!still && sh.speed > 15 && !sh.helm.autoStop && (this.memo.stopAt || 0) < S.time) { this.memo.stopAt = S.time + 1.5; this.cmd('helm.stop'); this.game.simStats.allStops = (this.game.simStats.allStops || 0) + 1; }
    // Ruder ≠ 0 beendet den Allstopp – beim Bremsen also nur gegensteuern, wenn er nicht läuft
    this.helmS(S, sh.helm.autoStop ? 0 : this.turnCmd(S, 0), STOP);
    return still;
  }
  // M3a §6: träges Drehen (turnVel nähert sich mit turnAccel dem Ziel). Wie ein Pilot mit Gefühl: rechtzeitig gegensteuern,
  // damit der Bug nicht überschießt (Bremsweg v²/2a). diff = gewünschte Winkeländerung (rad).
  turnCmd(S, diff) {
    const sh = S.ship;
    // M3b: Drehrate hängt vom Tempo ab (turnCurve; bei ½ am wendigsten, im Stand 0,25)
    const fwdV = sh.vx * Math.cos(sh.angle) + sh.vy * Math.sin(sh.angle);
    const rate = this.staged(S) ? Math.max(0.05, LCLS.turnRate * turnFactorOf(fwdV)) : CONFIG.ship.turnRate;
    const acc = (this.staged(S) ? LCLS.turnAccel : CONFIG.ship.turnAccel) || 0.8;
    const tv = sh.turnVel || 0;
    const vmax = Math.sqrt(2 * acc * Math.abs(diff)) * 0.8;
    const want = Math.sign(diff) * Math.min(rate, vmax);
    if (Math.abs(diff) < 0.01 && Math.abs(tv) < 0.03) return 0;
    const cap = sh.turnCap ? (want < 0 ? sh.turnCap.port : sh.turnCap.stbd) || 0.15 : 1;
    return clamp(want / (rate * Math.max(0.15, cap)), -1, 1);
  }
  station(S) { const l = Locations.get(S.ship.scene); return l.scene.station || null; }

  // ---------- Reisen ----------
  updateLocs(S) { if (S.world.locations) this.locs = S.world.locations; }
  nextHop(S, goal) {
    const here = S.ship.scene;
    if (here === goal || !this.locs) return null;
    const byId = Object.fromEntries(this.locs.map((l) => [l.id, l]));
    const avoid = goal === 'wrack' ? ['nebel'] : [];   // zum Wrack nicht durch den Nebel (dort beginnt der Hinterhalt)
    const prev = { [here]: null }; const q = [here];
    while (q.length) {
      const c = q.shift();
      if (c === goal) break;
      for (const n of (byId[c] ? byId[c].links : [])) if (!(n in prev) && !avoid.includes(n)) { prev[n] = c; q.push(n); }
    }
    if (!(goal in prev)) return null;
    let n = goal; while (prev[n] !== here) n = prev[n];
    return n;
  }
  // Ein Schritt Richtung Zielort. Rollen: Captain wählt Ziel, Steuer fliegt frei + springt. true = angekommen.
  travel(S, p, goal) {
    const sh = S.ship;
    if (sh.scene === goal) return true;
    const hop = this.nextHop(S, goal);
    if (!hop) { if (this.is('captain')) this.enter(S, 'captain'); return false; }
    if (this.role === 'solo') {
      if (sh.jump.dest !== hop) { if (p.console === 'helm' && !this.brake(S)) return false; if (this.enter(S, 'captain')) this.cmd('captain.selectDest', { dest: hop }); return false; }
      if (!this.enter(S, 'helm')) return false;
      this.flyClear(S);
      if (sh.jump.ready) this.cmd('helm.jump');
      return false;
    }
    if (this.role === 'captain') { if (this.enter(S, 'captain') && sh.jump.dest !== hop) this.cmd('captain.selectDest', { dest: hop }); return false; }
    if (this.role === 'helm') { if (!this.enter(S, 'helm')) return false; this.flyClear(S); if (sh.jump.ready && sh.jump.dest === hop) this.cmd('helm.jump'); return false; }
    this.enter(S, 'weapons');
    return false;
  }
  // Freifliegen für den Sprung: ablegen, Abstand zur Station gewinnen, sonst stehen
  flyClear(S) {
    const sh = S.ship; const l = Locations.get(sh.scene).scene;
    if (sh.docked) { this.helmS(S, 0, QUARTER); return; }
    const ref = l.dock ? (l.station || l.dock) : null;
    if (ref && dist(sh.x, sh.y, ref.x, ref.y) < 380) { this.steer(S, ref.x + (sh.x - ref.x) * 4 + 1, ref.y + (sh.y - ref.y) * 4, 0, 90); return; }
    this.brake(S);
  }
  dock(S, p, loc) {
    const sh = S.ship;
    if (sh.docked && sh.dockedAt === loc) return true;
    if (!this.is('helm')) { this.input(0, 0); return false; }
    if (!this.enter(S, 'helm')) return false;
    const d = Locations.get(loc).scene.dock;
    this.steer(S, d.x, d.y, 0, 70);
    return false;
  }

  // ---------- Waffen ----------
  // ---------- M3a: Waffen (Taktik verteilt Ladepunkte und feuert alles, §5) ----------
  mountsOf(S) { return Object.fromEntries((S.ship.mounts || []).map((m) => [m.id, m])); }
  inArcM(S, m, e, shrink) { const sh = S.ship; return !!m && Physics.inArc(sh.x, sh.y, sh.angle, m.facing, Math.max(2, m.arc - (shrink || 0)), m.range, e.x, e.y); }
  fight(S, opts) {
    const sh = S.ship;
    const enemies = S.space.enemies;
    const M = this.mountsOf(S);
    // §20.3: Lanze lädt noch, aber keine Gegner mehr -> loslassen (ins Leere)
    if (!enemies.length) { if (M.bow && M.bow.charging) this.cmd('weapons.charge', { mount: 'bow', on: false }); return; }
    const any = (e) => MOUNT_IDS.some((id) => this.inArcM(S, M[id], e));
    const byDist = (a, b) => dist(a.x, a.y, sh.x, sh.y) - dist(b.x, b.y, sh.x, sh.y);
    const cur = enemies.find((e) => e.id === sh.target);
    // Ziel: Gegner, der gerade lädt (Treffer verzögern die Ladung), sonst einer im Bogen, sonst der nächste
    const charging = enemies.filter((e) => e.tele && any(e)).sort(byDist)[0];
    // M3b §6: Jäger im Anflug (state approach) vor dem Bug -> Lanze auf die Anfluglinie (sie fliegen gerade auf uns zu)
    const incoming = enemies.filter((e) => e.kind === 'raider' && /^app/.test(e.state || '') && this.onApproachLine(S, e)).sort(byDist)[0];
    const lanceReady = M.bow && M.bow.state !== 'broken' && (M.bow.charge >= 1 || M.bow.charging);
    const target = charging || (incoming && lanceReady ? incoming : null) || (cur && any(cur) ? cur : null) || enemies.filter(any).sort(byDist)[0] || cur || enemies.slice().sort(byDist)[0];
    if (sh.target !== target.id) { this.cmd('weapons.target', { id: target.id }); return; }
    // Scan vorab (Taktik-Rolle): zeigt Schilde/Feuerbögen
    if (opts && opts.scan && !target.scanned && dist(target.x, target.y, sh.x, sh.y) < 780 && (this.memo.scanUntil || 0) < S.time + 10) {
      this.scanT -= DT; if (this.scanT <= 0) { this.scanT = 0.3; this.cmd('weapons.scan', { on: true }); }
    }
    this.allocFor(S, target, M);
    this.lanceFight(S, target, M);
    // §20.4: Batterien feuern nur auf Befehl – geladene Batterie mit einem Gegner im Bogen (Reaktion wie ein Mensch, ~0,3 s)
    const bat = ['port', 'stbd'].filter((id) => M[id] && M[id].charge >= 1 && !(M[id].salvo > 0) && M[id].state !== 'broken' && enemies.some((e) => this.inArcM(S, M[id], e, 6)));
    if (bat.length && (this.memo.batAt || 0) < S.time) {
      this.memo.batAt = S.time + 0.3;
      this.cmd('weapons.fire', { mount: bat.length === 2 ? 'all' : bat[0] });
    } else if (M.bolzen && M.bolzen.loaded > 0 && M.bolzen.charge >= 1 && this.inArcM(S, M.bolzen, target)) this.cmd('weapons.fire', { mount: 'bolzen' });
  }
  // §20.3: Gegner, den die Lanze jetzt treffen würde (erster auf der Strahllinie), aus dem Snapshot
  lanceLineHit(S) {
    const sh = S.ship; const L = M3.lance || { width: 10 }; const R = M3.mounts.bow.range;
    const dx = Math.cos(sh.angle), dy = Math.sin(sh.angle);
    const ox = sh.x + dx * 34, oy = sh.y + dy * 34;
    let hit = null, ht = Infinity;
    for (const e of S.space.enemies) {
      const rx = e.x - ox, ry = e.y - oy;
      const t = rx * dx + ry * dy; const rad = (CONFIG.combat.hitRadius[e.kind] || 18) + L.width;
      if (t < -rad || t > R + rad || Math.abs(-rx * dy + ry * dx) >= rad) continue;
      if (t < ht) { ht = t; hit = e; }
    }
    return hit;
  }
  // Taktik-Bot: Lanze aufladen, wenn der Bug grob aufs Ziel zeigt; feuern, wenn ein Gegner auf der Linie liegt
  // (bei voller Ladung, oder früher, wenn er gerade aus der Linie läuft)
  // Jäger fliegt (grob) auf uns zu und kreuzt in den nächsten ~3 s die Bug-Linie bzw. liegt schon vor dem Bug
  onApproachLine(S, e) {
    const sh = S.ship; const R = M3.mounts.bow.range;
    const d = dist(e.x, e.y, sh.x, sh.y);
    if (d > R + 400) return false;
    const rel = Math.abs(norm(Math.atan2(e.y - sh.y, e.x - sh.x) - sh.angle));
    const v = Math.hypot(e.vx || 0, e.vy || 0) || 1;
    const closing = ((sh.x - e.x) * (e.vx || 0) + (sh.y - e.y) * (e.vy || 0)) / (d * v);   // 1 = direkt auf uns zu
    return rel < 0.6 && closing > 0.6;
  }
  lanceFight(S, target, M) {
    const sh = S.ship; const m = this.memo; const bow = M.bow;
    if (!bow || bow.state === 'broken') return;
    const rel = Math.abs(norm(Math.atan2(target.y - sh.y, target.x - sh.x) - sh.angle));
    const d = dist(target.x, target.y, sh.x, sh.y);
    const incoming = target.kind === 'raider' && /^app/.test(target.state || '') && this.onApproachLine(S, target);
    if (!bow.charging) {
      m.lanceRel = null;
      // Jäger im Anflug: früh laden (3 s Ladezeit), er läuft selbst in die Linie
      if (incoming && bow.charge >= 1 && (m.lanceAt || 0) < S.time) {
        m.lanceAt = S.time + 0.4; m.lanceT0 = S.time; m.lanceVsRaider = true;
        this.cmd('weapons.charge', { mount: 'bow', on: true });
        this.game.simStats.lanceCharges = (this.game.simStats.lanceCharges || 0) + 1;
        this.game.simStats.lanceRaiderCharges = (this.game.simStats.lanceRaiderCharges || 0) + 1;
        return;
      }
      if (bow.charge >= 1 && rel < 0.45 && d < bow.range + 150 && (m.lanceAt || 0) < S.time) {
        m.lanceVsRaider = false;
        m.lanceAt = S.time + 0.4; m.lanceT0 = S.time;
        this.cmd('weapons.charge', { mount: 'bow', on: true });
        this.game.simStats.lanceCharges = (this.game.simStats.lanceCharges || 0) + 1;
      }
      return;
    }
    const hit = this.lanceLineHit(S);
    const leaving = m.lanceRel != null && rel > m.lanceRel + 0.002;
    m.lanceRel = rel;
    const long = S.time - (m.lanceT0 || S.time) > 8;
    // Jäger quert die Linie nur kurz (200 px/s): ab halber Ladung sofort feuern
    const raiderOnLine = hit && hit.kind === 'raider' && bow.power >= 0.4;
    if (hit && (bow.power >= 0.85 || (leaving && bow.power >= 0.4) || long || raiderOnLine)) {
      this.cmd('weapons.charge', { mount: 'bow', on: false });
      m.lanceAt = S.time + 0.4;
    }
  }
  // Ladepunkte nach Lage: Ziel vorn -> Lanze, Ziel seitlich -> Batterie dieser Seite (mit Hysterese, alle 2 s neu)
  allocFor(S, target, M) {
    const sh = S.ship; const m = this.memo;
    const P = sh.chargePoints != null ? sh.chargePoints : 4;
    if (!M.bow || !M.port || !M.stbd) return;
    if (!m.allocWant || (m.allocAt || 0) < S.time) {
      const rel = norm(Math.atan2(target.y - sh.y, target.x - sh.x) - sh.angle) * 180 / Math.PI;
      const want = { bow: 0, port: 0, stbd: 0 };
      const side = rel < 0 ? 'port' : 'stbd', other = side === 'port' ? 'stbd' : 'port';
      const order = Math.abs(rel) < 30 ? ['bow', side, other] : [side, 'bow', other];
      let left = P;
      for (const id of order) { if (M[id].state === 'broken') continue; const k = Math.min(M3.allocMax || 4, left); want[id] = k; left -= k; }
      m.allocWant = want; m.allocAt = S.time + 2;
    }
    if ((m.allocCmdAt || 0) > S.time) return;
    const w = m.allocWant;
    const down = MOUNT_IDS.find((id) => M[id].alloc > w[id]);
    const up = MOUNT_IDS.find((id) => M[id].alloc < w[id]);
    const sum = MOUNT_IDS.reduce((a, id) => a + M[id].alloc, 0);
    if (down && (sum >= P || !up)) { this.cmd('weapons.alloc', { mount: down, delta: -1 }); m.allocCmdAt = S.time + 0.3; }
    else if (up && sum < P) { this.cmd('weapons.alloc', { mount: up, delta: 1 }); m.allocCmdAt = S.time + 0.3; }
  }

  // ---------- Steuer im Kampf (M3a §14, M3b §6): nose = Bug aufs Ziel bei ½–¾, maneuver = Breitseite, Stufe nach Lage ----------
  pilot() { return this.opts.pilot || 'nose'; }
  // Bezugsgegner der Steuer: gefährliche Schiffe (Kanonenboot, Pylon, Wächter) vor Jägern, jeweils der nächste
  helmFocus(S) {
    const sh = S.ship; const heavy = S.space.enemies.filter((o) => o.kind !== 'raider' && o.kind !== 'relay');
    const pool = heavy.length ? heavy : S.space.enemies;
    let e = null, ed = Infinity; for (const o of pool) { const d = dist(sh.x, sh.y, o.x, o.y); if (d < ed) { ed = d; e = o; } }
    return e;
  }
  helmFight(S, e) {
    const sh = S.ship; const M = this.mountsOf(S);
    if (!e) { this.brake(S); return; }
    // §20.2: „maneuver“ weicht Ladungen kurz vor dem Einschlag aus (Fenster dodgeWindow 0,8 s; Reaktion streut wie bei Menschen)
    if (this.pilot() === 'maneuver') this.dodgeTele(S);
    if (M.bow && M.bow.charging) this.game.simStats.lanceHelmSeen = (this.game.simStats.lanceHelmSeen || 0) + 1;
    // M3b: Jäger fliegen Überflüge (approach -> overshoot -> turn). Hinterherdrehen lohnt nicht (1,1 rad/s gegen 0,6):
    // Kurs halten bei ½ (wendig für den nächsten Anflug), die Taktik nimmt sie auf der Anfluglinie mit der Lanze.
    // QA M3b: „circle“ = bekannte Lücke prüfen – Dauerkreis bei ½ mit leichtem Ruder (0,3), egal was kommt
    if (this.pilot() === 'circle') { this.dodgeTele(S); this.helmS(S, 0.3, HALF); return; }
    if (e.kind === 'raider' || e.kind === 'relay') this.helmS(S, this.turnCmd(S, 0), HALF);
    else if (this.pilot() === 'maneuver') this.helmManeuver(S, e);
    else this.aimHelm(S, e, e.kind === 'pylon' || e.kind === 'relay' ? 380 : 450);
    // Reflex beider Strategien: Ausweichrolle vor einem nahen Projektil
    if (S.space.projectiles.some((q) => (q.kind === 'enemy' || q.kind === 'emp') && dist(q.x, q.y, sh.x, sh.y) < 90) && sh.dodgeCd === 0 && (this.memo.dodgeAt || 0) < S.time) { this.memo.dodgeAt = S.time + 1; this.cmd('helm.dodge', { dir: simRng() < 0.5 ? -1 : 1 }); }
  }
  dodgeTele(S) {
    const sh = S.ship; const m = this.memo; const W = M3.dodgeWindow || 0.8;
    m.dodgePlan = m.dodgePlan || {};
    for (const id of Object.keys(m.dodgePlan)) if (!S.space.enemies.some((e) => e.id === id && e.tele)) delete m.dodgePlan[id];
    if (sh.dodgeCd > 0 || sh.docked) return;
    for (const e of S.space.enemies) {
      if (!e.tele || e.tele.left > W) continue;
      if (!m.dodgePlan[e.id]) m.dodgePlan[e.id] = { at: 0.1 + simRng() * (W - 0.25) };
      if (e.tele.left <= m.dodgePlan[e.id].at) {
        const rel = norm(Math.atan2(e.y - sh.y, e.x - sh.x) - sh.angle);
        this.cmd('helm.dodge', { dir: rel < 0 ? 1 : -1 });   // vom Gegner weg
        this.game.simStats.teleDodges = (this.game.simStats.teleDodges || 0) + 1;
        delete m.dodgePlan[e.id];
        return;
      }
    }
  }
  // „nose“: Bug aufs Ziel. Wenden bei ½, ausgerichtet und weit weg ¾, nah ½ (die Lerche kann nicht stehen und drehen zugleich).
  // opts.slow (solo, kurz an der Steuer): ¼ bzw. STOPP, sobald das Ziel im Bogen ist.
  aimHelm(S, e, standoff, opts) {
    const sh = S.ship;
    if (!e) { this.brake(S); return; }
    const d = dist(sh.x, sh.y, e.x, e.y);
    const diff = norm(Math.atan2(e.y - sh.y, e.x - sh.x) - sh.angle);
    let stage;
    if (opts && opts.slow) stage = Math.abs(diff) > 0.3 ? HALF : (d > (standoff || 420) ? QUARTER : STOP);
    else stage = Math.abs(diff) > 0.35 ? HALF : (d > (standoff || 420) ? THREEQ : HALF);
    this.helmS(S, this.turnCmd(S, diff), stage);
  }
  // „maneuver“: Breitseite (Ziel bei ±90°), Abstand ~400 per Kurskorrektur, Seite wechseln bei schwachem Sektor,
  // bei einer Ladung auf VOLL wegdrehen. Stufe nach Lage: Wenden ½, in Position ¾ bzw. ½ (Tempo des Ziels mitgehen).
  helmManeuver(S, e, opts) {
    const sh = S.ship; const m = this.memo;
    const d = dist(sh.x, sh.y, e.x, e.y);
    const bearing = Math.atan2(e.y - sh.y, e.x - sh.x);
    const sideScore = (side) => {
      const sec = SECTOR_OF_SIDE[side];
      const cur = sh.shields.current[sec] || 0; const cap = sh.shields.cap ? sh.shields.cap[sec] : 4;
      const bat = sh.systems['battery_' + side];
      return cur + cap * 0.5 + (bat === 'ok' ? 2 : bat === 'damaged' ? 1 : -2);
    };
    if (!m.side) m.side = norm(bearing - sh.angle) < 0 ? 'port' : 'stbd';
    const other = m.side === 'port' ? 'stbd' : 'port';
    if ((m.sideAt || 0) < S.time && sideScore(other) >= sideScore(m.side) + 2) { m.side = other; m.sideAt = S.time + 8; this.game.simStats.sideSwitches = (this.game.simStats.sideSwitches || 0) + 1; }
    const s = m.side === 'stbd' ? 1 : -1;
    // Ladung eines Gegners, der uns im Bogen hat: wegdrehen auf VOLL (aus Bogen/Reichweite)
    const threat = S.space.enemies.find((q) => q.tele && q.tele.left > 0.4 && dist(q.x, q.y, sh.x, sh.y) < 620);
    const delta = clamp((d - 400) / 250, -0.4, 0.4);   // > 0: näher ran (Ziel etwas mehr nach vorn), < 0: Abstand gewinnen
    if (threat && !(opts && opts.slow)) {
      const tb = Math.atan2(threat.y - sh.y, threat.x - sh.x);
      const away = norm(tb + Math.PI);
      const relAway = norm(away - sh.angle);
      const heading = Math.abs(relAway) < 2.2 ? away : norm(tb - s * (Math.PI / 2 + 0.9));
      if (!m.evading || m.evading !== threat.id) { m.evading = threat.id; this.game.simStats.evades = (this.game.simStats.evades || 0) + 1; }
      const hd = norm(heading - sh.angle);
      this.helmS(S, this.turnCmd(S, hd), Math.abs(hd) > 0.8 ? HALF : FULL);
      return;
    }
    m.evading = null;
    const heading = norm(bearing - s * (Math.PI / 2 - delta));
    const hd = norm(heading - sh.angle);
    let stage;
    if (opts && opts.slow) stage = Math.abs(hd) > 0.3 ? HALF : (d > 480 ? QUARTER : STOP);
    else if (Math.abs(hd) > 0.5) stage = HALF;   // Wenden
    else {
      // Tempo des Ziels längs unseres Kurses mitgehen (Breitseite halten), weit weg ¾
      const ev = (e.vx || 0) * Math.cos(sh.angle) + (e.vy || 0) * Math.sin(sh.angle);
      stage = d > 600 ? THREEQ : clamp(this.stageFor(Math.max(stageSpeedOf(HALF), ev + 10)), HALF, THREEQ);
    }
    this.helmS(S, this.turnCmd(S, hd), stage);
  }
  nearestEnemy(S) { const sh = S.ship; let e = null, ed = Infinity; for (const o of S.space.enemies) { const d = dist(sh.x, sh.y, o.x, o.y); if (d < ed) { ed = d; e = o; } } return e; }

  // ---------- Captain (M3b §6: kein Schildstoß mehr; Schildverteilung zur Bedrohung, Reparaturliste) ----------
  // Bedrohung = Sektor einer laufenden Ladung, sonst der Sektor des gefährlichsten nahen Gegners (Kanonenboot/Pylon/Wächter
  // vor Jägern). Ab Stärke 3 lässt ein Sektor nichts mehr durch (spaceM3b.shieldLeak) – dorthin wandern die Punkte,
  // zuerst aus dem Sektor gegenüber. Ein Punkt je Sekunde (wie ein Mensch am Regler).
  threatSector(S) {
    const sh = S.ship;
    const tele = S.space.enemies.filter((e) => e.tele).sort((a, b) => a.tele.left - b.tele.left)[0];
    if (tele) return tele.tele.sector;
    const danger = (e) => (e.kind === 'gunboat' || e.kind === 'pylon' || e.kind === 'sentinel' ? 0 : 250) + dist(e.x, e.y, sh.x, sh.y);
    const e = S.space.enemies.filter((o) => o.kind !== 'relay').sort((a, b) => danger(a) - danger(b))[0] || this.nearestEnemy(S);
    return e ? Physics.sectorOf(sh.x, sh.y, sh.angle, e.x, e.y) : null;
  }
  captainFight(S, p) {
    const sh = S.ship; const m = this.memo;
    if (!this.enter(S, 'captain')) return;
    if ((m.shieldAt || 0) < S.time && S.space.enemies.length) {
      m.shieldAt = S.time + 1;
      const sec = this.threatSector(S);
      const al = sh.shields.alloc; const cap = sh.shields.cap || [4, 4, 4, 4];
      if (sec != null && al[sec] < cap[sec]) {
        const opp = (sec + 2) % 4;
        const donor = [0, 1, 2, 3].filter((i) => i !== sec && al[i] > 0).sort((a, b) => (b === opp ? 1 : 0) - (a === opp ? 1 : 0) || al[b] - al[a])[0];
        const pool = sh.shields.pool != null ? sh.shields.pool : 6;
        const used = al.reduce((a, b) => a + b, 0);
        if (used < pool) this.cmd('captain.shield', { sector: sec, delta: 1 });
        else if (donor != null) { this.cmd('captain.shield', { sector: donor, delta: -1 }); this.cmd('captain.shield', { sector: sec, delta: 1 }); }
        this.game.simStats.shieldMoves = (this.game.simStats.shieldMoves || 0) + 1;
      }
    }
    this.queueRepairs(S);
  }
  // Reparaturliste füllen (zu dritt; solo macht das die Automatik). Läuft in jedem Missionsschritt, sobald der Captain an der Konsole ist.
  queueRepairs(S) {
    const sh = S.ship; const m = this.memo;
    if (this.opts.queue !== false && (m.queueAt || 0) < S.time) {
      m.queueAt = S.time + 1.5;
      if (sh.botAuto) { this.cmd('captain.botAuto', { on: false }); return; }
      const q = sh.repairQueue || [];
      const busyPlayer = (s) => (this.game.simAgents || []).some((a) => a.memo.job && a.memo.job.sys === s && S.time - (a.memo.job.seen || 0) < 2);
      const want = REPAIR_PRIO.filter((s) => (sh.systems[s] === 'broken' || sh.systems[s] === 'damaged') && !busyPlayer(s))
        .sort((a, b) => (sh.systems[a] === 'broken' ? 0 : 1) - (sh.systems[b] === 'broken' ? 0 : 1));
      for (const s of want) {
        if (q.length >= (M3.repair ? M3.repair.queueMax : 3)) break;
        if (q.some((x) => x.system === s)) continue;
        const mode = sh.systems[s] === 'broken' && S.inventory.ersatzteil > 0 ? 'part' : 'flick';
        this.cmd('captain.repair', { system: s, mode });
        if (VERBOSE) log(`  [Captain ${S.time}] Reparaturliste: ${s} ${mode} -> ${JSON.stringify(this.game.ship.repairQueue)} ${this.notices.slice(-1)}`);
        this.game.simStats.queued = (this.game.simStats.queued || 0) + 1;
        break;
      }
    }
  }

  // Kampf je Rolle (solo: Taktik feuert, kurz ans Steuer, wenn nichts im Bogen; Reparaturgänge zwischendurch)
  combat(S, p) {
    const sh = S.ship;
    if (this.role === 'solo') {
      const e = this.nearestEnemy(S);
      if (!e) return;
      const threat = S.space.enemies.some((q) => q.tele && q.tele.left < 2.5);
      // Reparaturgang: zerstörtes System, solange keine Ladung kurz bevorsteht (Bots machen den Rest per Automatik)
      if (this.memo.job || (!threat && (this.memo.offArc || 0) < 1)) { if (this.repairDuty(S, p, { cooldown: 15 })) return; }
      const M = this.mountsOf(S);
      const inAny = MOUNT_IDS.some((id) => M[id] && M[id].state !== 'broken' && this.inArcM(S, M[id], e, 4));
      if (!inAny) this.memo.offArc = (this.memo.offArc || 0) + DT; else this.memo.offArc = 0;
      if (this.memo.turning || this.memo.offArc > (e.kind === 'raider' ? 8 : 3)) {
        // Solo: kurz ans Steuer und das Ziel in einen Bogen drehen (nose: Bug, maneuver: Breitseite), dann zurück an die Taktik
        this.memo.turning = true;
        if (!this.enter(S, 'helm')) return;
        const want = this.pilot() === 'nose' ? ['bow'] : ['port', 'stbd'];
        if (this.pilot() === 'maneuver') this.helmManeuver(S, e, { slow: true }); else this.aimHelm(S, e, e.kind === 'pylon' || e.kind === 'relay' ? 380 : 450, { slow: true });
        const M2 = this.mountsOf(S);
        if (want.some((id) => M2[id] && this.inArcM(S, M2[id], e, id === 'bow' ? 6 : 24)) && Math.abs(sh.turnVel || 0) < 0.12) { this.helmS(S, this.turnCmd(S, 0), STOP); this.memo.turning = false; this.memo.offArc = 0; }
        if ((this.memo.turnT = (this.memo.turnT || 0) + DT) > 12) { this.memo.turning = false; this.memo.turnT = 0; this.memo.offArc = 0; }
        return;
      }
      this.memo.turnT = 0;
      if (this.enter(S, 'weapons')) this.fight(S);
      return;
    }
    if (this.role === 'weapons') {
      // Zu dritt verlässt die Taktik die Brücke für Reparaturen (die Waffen feuern unbesetzt mit 50 % weiter)
      if (this.repairDuty(S, p, { damaged: true, cooldown: 6 })) return;
      if (this.enter(S, 'weapons')) this.fight(S, { scan: true });
      return;
    }
    if (this.role === 'helm') {
      if (!this.enter(S, 'helm')) return;
      this.helmFight(S, this.helmFocus(S));
      return;
    }
    if (this.role === 'captain') this.captainFight(S, p);
  }

  shootDrones(S) {
    const p = this.me(S);
    if (p.zone !== 'away' || p.downed) return false;
    const walkSolid = (x, y) => !this.walkable(S, 'away')(x, y);
    // S1-QA: Eine Drohne, die nach 6 s Dauerfeuer noch lebt, steht hinter einem Hindernis, das die Kachel-Sichtlinie
    // nicht kennt (z. B. Logbuch-Terminal im Wrack). Dann 12 s ignorieren statt ewig daneben zu schießen (Softlock Seed 17).
    const m = this.memo;
    const giveUp = m.droneGiveUp || (m.droneGiveUp = {});
    let best = null, bd = 190;
    for (const d of S.away.drones) {
      if (!d.alive || (giveUp[d.id] || 0) > S.time) continue;
      const dd = dist(p.x, p.y, d.x, d.y);
      if (dd < bd && losPx(walkSolid, p.x, p.y - 10, d.x, d.y - 8)) { bd = dd; best = d; }
    }
    if (!best) { m.droneShoot = null; return false; }
    if (!m.droneShoot || m.droneShoot.id !== best.id) m.droneShoot = { id: best.id, t: 0 };
    m.droneShoot.t += DT;
    if (m.droneShoot.t > 6) { giveUp[best.id] = S.time + 12; m.droneShoot = null; return false; }
    if (p.console) { this.send({ t: 'leave' }); return true; }
    if (this.actDown) this.act(false);
    this.input(0, 0);
    this.send({ t: 'shoot', angle: Math.atan2(best.y - 8 - (p.y - 10), best.x - p.x) });
    return true;
  }

  // ---------- Hauptentscheidung ----------
  update(S) {
    const p = this.me(S);
    if (!p) return;
    this.updateLocs(S);
    if (this.waitT > 0) { this.waitT -= DT; return; }
    if (p.downed) { this.input(0, 0); this.act(false); this.ix = null; return; }
    if (this.reactorDuty(S, p)) return;
    if (this.role === 'captain' && p.console === 'captain') this.queueRepairs(S);
    // Funkspruch annehmen / Entscheidung (Captain bzw. solo), wenn keine Gefahr
    if (S.phase === 'end') { this.endPhase(S, p); return; }
    const st = S.mission.stage;
    const fn = this['stage_' + st];
    if (fn) fn.call(this, S, p);
  }
  is(role) { return this.role === 'solo' || this.role === role; }
  teamOnShipCaptain(S) { return S.players.some((o) => o.id !== this.pid && o.zone === 'ship' && o.console === 'captain'); }

  // Reaktor offline: Schalter A halten (Steuer-Spieler im Trio, sonst solo) – ein Schrauber kommt an B
  reactorDuty(S, p) {
    if (!S.ship.reactor || S.ship.reactor.state !== 'offline') return false;
    if (S.space.enemies.length && this.role !== 'solo') return false;
    if (!(this.role === 'solo' || this.role === 'helm') || p.zone !== 'ship') return false;
    if (p.console) { this.send({ t: 'leave' }); return true; }
    const sw = switchOf('A');
    const r = this.interact(S, sw.x, sw.y, { hold: true, max: 30, until: (S2) => S2.ship.reactor.state !== 'offline' });
    if (r === 'fail') this.waitT = 0.5;
    if (!this.memo.switchUsed) { this.memo.switchUsed = true; this.game.simStats.reactorRestarts++; }
    return true;
  }

  extinguish(S, p) {
    const f = S.ship.fires[0];
    if (!f) return 'done';
    if (p.console) { this.send({ t: 'leave' }); return 'running'; }
    if (p.carry !== 'loeschgel') {
      if (p.carry) { this.send({ t: 'drop' }); return 'running'; }
      if (S.inventory.loeschgel <= 0 && S.inventory.loeschgelCharges <= 0) return 'skip';
      const shelf = shelfOf('loeschgel'); this.interact(S, shelf.x, shelf.y, {});
      return 'running';
    }
    const r = this.interact(S, f[0], f[1], { floor: true, hold: true, until: (S2) => !S2.ship.fires.some((q) => q[0] === f[0] && q[1] === f[1]) });
    if (r === 'fail') this.waitT = 0.3;
    return 'running';
  }
  patch(S, p) {
    const b = S.ship.breaches[0];
    if (!b) return 'done';
    if (p.console) { this.send({ t: 'leave' }); return 'running'; }
    if (p.carry !== 'flickblech') {
      if (p.carry) { this.send({ t: 'drop' }); return 'running'; }
      if (S.inventory.flickblech <= 0) return 'skip';
      const shelf = shelfOf('flickblech'); this.interact(S, shelf.x, shelf.y, {});
      return 'running';
    }
    const r = this.interact(S, b.tx, b.ty, { floor: true, hold: true, until: (S2) => !S2.ship.breaches.some((q) => q.tx === b.tx && q.ty === b.ty) });
    if (r === 'fail') this.waitT = 0.3;
    return 'running';
  }
  acceptRadio(S) {
    if (!(S.mission.radio && S.mission.radio.needsAccept)) return false;
    if (this.enter(S, 'captain')) this.cmd('captain.accept');
    return true;
  }

  // ---------- Mission 1 ----------
  stage_dock(S, p) {
    const drillOpen = S.ship.fires.length || S.ship.breaches.length || S.ship.systems.transfer !== 'ok';
    if (drillOpen && !(S.mission.radio && S.mission.radio.needsAccept)) {
      if ((this.role === 'solo' || this.role === 'helm') && S.ship.fires.length) { this.extinguish(S, p); return; }
      if ((this.role === 'solo' || this.role === 'helm') && S.ship.breaches.length) { this.patch(S, p); return; }
      if ((this.role === 'solo' || this.role === 'weapons') && S.ship.systems.transfer !== 'ok') { this.repair(S, p, 'transfer'); return; }
      if ((this.role === 'helm' || this.role === 'weapons') && p.carry && !this.actDown) this.send({ t: 'drop' });
    }
    if (p.carry && !['ersatzteil', 'loeschgel', 'flickblech'].includes(p.carry)) this.send({ t: 'drop' });
    if (p.carry && !drillOpen && !this.actDown) { const shelf = shelfOf(p.carry); if (shelf) { this.interact(S, shelf.x, shelf.y, {}); return; } }
    if (this.is('captain')) { if (this.enter(S, 'captain') && S.mission.radio && S.mission.radio.needsAccept) this.cmd('captain.accept'); }
    else if (this.role === 'helm') this.enter(S, 'helm');
    else this.enter(S, 'weapons');
  }
  stage_undock(S, p) { this.travel(S, p, 'splitter'); }
  stage_route(S, p) {
    const sh = S.ship;
    const choiceOpen = S.mission.choice && S.mission.choice.id === 'grauzahn';
    if (choiceOpen && this.is('captain')) {
      if (this.role === 'solo' && p.console === 'helm' && !this.brake(S)) return;
      if (this.enter(S, 'captain')) this.cmd('captain.choice', { option: this.opts.grauzahn });
      return;
    }
    const salvageDone = S.mission.objectives.some((o) => o.id === 'salvage' && o.done);
    // wie ein Mensch: eine Kiste, die nach 45 s nicht zu kriegen ist, auslassen; aufgegebenes Bergungsgut ignorieren
    const skip = this.memo.skipSalvage || (this.memo.skipSalvage = new Set());
    let sv = salvageDone ? null : (S.space.salvage || []).filter((q) => !skip.has(q.id)).sort((a, b) => dist(a.x, a.y, sh.x, sh.y) - dist(b.x, b.y, sh.x, sh.y))[0];
    if (sv) {
      if (this.memo.svId !== sv.id) { this.memo.svId = sv.id; this.memo.svT = 0; }
      this.memo.svT += DT;
      if (this.memo.svT > 45) { skip.add(sv.id); sv = null; }
    }
    if (sv && this.is('helm')) { if (this.enter(S, 'helm')) this.steer(S, sv.x, sv.y, 0, 90); return; }
    if (sv && this.role === 'weapons') { if (this.enter(S, 'weapons') && !S.ship.markers.tactical) this.cmd('weapons.marker', { x: sv.x, y: sv.y }); return; }
    const answered = S.mission.objectives.some((o) => o.id === 'answer' && o.done);
    if (!answered) { if (this.is('helm')) { if (this.enter(S, 'helm')) this.steer(S, 1700, sh.y, 30, 100); } else if (this.role === 'captain') this.enter(S, 'captain'); return; }
    this.travel(S, p, 'b7');
  }
  stage_combat(S, p) { this.combat(S, p); }
  stage_scan(S, p) {
    const sh = S.ship; const b = this.station(S);
    const near = dist(sh.x, sh.y, b.x, b.y) <= 230;
    if (this.role === 'solo') {
      if (S.space.enemies.length) {
        if (!near && !this.memo.turning) { if (this.enter(S, 'helm')) this.steer(S, b.x - 150, b.y, 30, 100); if (dist(sh.x, sh.y, b.x, b.y) > 420) return; }
        this.combat(S, p); return;
      }
      if (!near || sh.speed > 10) { if (this.enter(S, 'helm')) { if (!near) this.steer(S, b.x - 150, b.y, 30, 100); else this.brake(S); } return; }
      if (this.enter(S, 'captain')) { this.scanT -= DT; if (this.scanT <= 0) { this.scanT = 0.2; this.cmd('captain.scan', { on: true }); } }
      return;
    }
    if (this.role === 'helm') {
      if (!this.enter(S, 'helm')) return;
      if (S.space.enemies.length && near) { this.helmFight(S, this.nearestEnemy(S)); return; }
      if (!near) this.steer(S, b.x - 150, b.y, 30, 100); else this.brake(S);
      return;
    }
    if (this.role === 'weapons') { if (this.enter(S, 'weapons')) this.fight(S); return; }
    if (this.role === 'captain' && this.enter(S, 'captain') && dist(sh.x, sh.y, b.x, b.y) <= 410 && !S.space.enemies.length) {
      this.scanT -= DT; if (this.scanT <= 0) { this.scanT = 0.2; this.cmd('captain.scan', { on: true }); }
    }
  }
  stage_away(S, p) { this.awayPlatform(S, p); }
  awayPlatform(S, p) {
    const sh = S.ship;
    if (S.space.enemies.length && p.zone === 'ship' && (this.role === 'weapons' && S.away.sonde.disabled)) { this.combat(S, p); return; }
    if (this.role === 'captain') {
      if (!this.enter(S, 'captain')) return;
      if (S.away.active && S.players.some((o) => o.zone === 'away')) {
        if (S.support.sensor === 0) this.cmd('captain.support', { kind: 'sensor' });
        else if (S.support.kuppel === 0 && S.players.some((o) => o.zone === 'away' && o.hp < 60)) this.cmd('captain.support', { kind: 'kuppel' });
      }
      return;
    }
    if (p.zone === 'ship') {
      if (p.carry === 'datenkern') { if (this.actDown) this.act(false); this.input(0, 0); return; }
      if (S.away.active && this.role === 'weapons' && S.away.sonde.disabled) { this.enter(S, 'weapons'); return; }
      const drift = (this.role === 'solo' || this.role === 'helm') && (dist(sh.x, sh.y, this.station(S).x, this.station(S).y) > 260 || sh.speed > 8);
      if (p.console && !(drift && p.console === 'helm')) { this.leave(S); return; }
      if (sh.systems.transfer === 'broken' || sh.systems.transfer === 'offline') { this.input(0, 0); return; }
      // Schiff driftet (unbesetzte Steuer hält Kurs/Tempo): erst zurück zur Boje und anhalten
      const b = this.station(S);

      if ((this.role === 'solo' || this.role === 'helm') && (dist(sh.x, sh.y, b.x, b.y) > 260 || sh.speed > 8)) {
        if (this.enter(S, 'helm')) { if (dist(sh.x, sh.y, b.x, b.y) > 200) this.steer(S, b.x - 150, b.y, 30, 90); else this.brake(S); }
        return;
      }
      // S1-QA: Getragenes (z. B. Ersatzteil von einer Reparatur) vor dem Beamen zurück ins Regal – sonst kann der Bot
      // unten den Datenkern nicht aufheben („Hände voll“, Softlock m1 solo Seeds 8/16/18/20)
      if (p.carry && p.carry !== 'medipack' && p.carry !== 'datenkern') {
        if (this.actDown && !(this.ix && this.ix.phase === 'up')) { this.act(false); return; }
        const shelf = shelfOf(p.carry);
        if (shelf) { this.interact(S, shelf.x, shelf.y, {}); return; }
        this.send({ t: 'drop' }); return;
      }
      if ((this.role === 'solo' || this.role === 'helm') && !S.away.active && !p.carry && S.inventory.medipack > 0 && S.away.npc.injured) { const shelf = shelfOf('medipack'); this.interact(S, shelf.x, shelf.y, {}); return; }
      if (!this.onMyPad(S, p)) return;
      if (this.role === 'weapons' && !S.away.active) { this.input(0, 0); return; }
      if (this.role === 'helm' && !S.away.active) {
        const mate = S.players.find((o) => o.id !== this.pid && o.zone === 'ship' && o.console !== 'captain');
        this.memo.padWait = (this.memo.padWait || 0) + DT;
        if (mate && !onShipPad(mate) && this.memo.padWait < 6) { this.input(0, 0); return; }
      }
      this.holdBeam(S, p);
      return;
    }
    this.memo.holdT = 0;
    if (this.shootDrones(S)) { this.ix = null; return; }
    const npc = S.away.npc;
    const core = S.away.items.find((i) => i.kind === 'datenkern');
    const doesNpc = this.role === 'solo' || this.role === 'helm';
    const hasWeaponsMate = S.players.length >= 3;
    const doesSonde = this.role === 'solo' || this.role === 'weapons' || (this.role === 'helm' && !hasWeaponsMate);
    const doesCore = this.role === 'solo' || this.role === 'helm';
    if (doesNpc && npc.present && !npc.rescued && npc.following !== this.pid && (!npc.injured || p.carry === 'medipack')) {
      this.interact(S, Math.floor(npc.x / TILE), Math.floor(npc.y / TILE), { floor: true });
      return;
    }
    if (doesCore && S.away.sonde.disabled && !S.away.coreRebooted && p.carry !== 'datenkern') {
      if (p.console) { this.leave(S); return; }
      this.interact(S, 14, 7, { hold: true, until: (S2) => S2.away.coreRebooted });
      return;
    }
    if (doesSonde && !S.away.sonde.disabled) {
      if (p.console !== 'sonde') { this.enter(S, 'sonde'); return; }
      const codeKnown = S.away.odaCodeHelp || this.teamOnShipCaptain(S);
      if (!codeKnown || S.away.sonde.lockout > 0) { this.input(0, 0); return; }
      const s = S.away.sonde;
      if ((this.memo.codeAt || 0) < S.time) { this.memo.codeAt = S.time + 0.4; this.cmd('sonde.input', { color: S.away.codeTable[s.symbols[s.entered.length]] }); }
      return;
    }
    if (p.console) { this.leave(S); return; }
    if (doesCore && core && p.carry !== 'datenkern') {
      if (!S.away.doorOpen) { this.input(0, 0); return; }
      if (p.carry && !this.actDown) { this.send({ t: 'drop' }); return; }   // S1-QA: Hände frei für den Datenkern
      this.interact(S, Math.floor(core.x / TILE), Math.floor(core.y / TILE), { floor: true });
      return;
    }
    this.returnToPads(S, p, npc.following === this.pid ? npc : null);
  }
  onMyPad(S, p) {
    const pads = W.SHIP_PADS; const myPad = pads[this.idx % pads.length];
    const t = this.tile(p); const c = Physics.tileCenter(myPad.x, myPad.y);
    if (!(t.x === myPad.x && t.y === myPad.y) || dist(p.x, p.y, c.x, c.y) > 4) { this.goto(S, [myPad]); return false; }
    return true;
  }
  holdBeam(S, p) {
    this.input(0, 0);
    if (!this.actDown) this.act(true);
    else if (!p.action && (this.memo.holdT = (this.memo.holdT || 0) + DT) > 0.6) { this.act(false); this.memo.holdT = 0; this.waitT = 1; }
  }
  returnToPads(S, p, follower) {
    const pads = S.away.map === 'wreck' ? Maps.WRECK_PADS : Maps.PLATFORM_PADS;
    const myPad = pads[this.idx % 3];
    const t = this.tile(p); const c = Physics.tileCenter(myPad.x, myPad.y);
    if (!(t.x === myPad.x && t.y === myPad.y) || dist(p.x, p.y, c.x, c.y) > 4) { if (this.actDown) this.act(false); this.goto(S, [myPad]); return; }
    this.input(0, 0);
    if (follower && dist(follower.x, follower.y, p.x, p.y) > 56) return;
    if (S.ship.systems.transfer === 'broken' || S.ship.systems.transfer === 'offline') { if (this.actDown) this.act(false); return; }
    if (!this.actDown) this.act(true);
    else if (!p.action && (this.memo.holdUp = (this.memo.holdUp || 0) + DT) > 0.6) { this.act(false); this.memo.holdUp = 0; this.waitT = 1; }
  }
  stage_decision(S, p) {
    if (this.actDown) this.act(false);
    if (this.is('captain')) { if (this.enter(S, 'captain') && S.mission.choice) this.cmd('captain.choice', { option: this.opts.decision }); return; }
    this.input(0, 0);
  }
  stage_return(S, p) {
    if (S.space.enemies.length) { this.combat(S, p); return; }
    const waveDone = S.mission.objectives.some((o) => o.id === 'rearguard' && o.done);
    if (!waveDone) { if (this.is('helm')) { if (this.enter(S, 'helm')) this.brake(S); } return; }
    this.travel(S, p, 'hafen');
  }
  stage_port(S, p) { this.dock(S, p, 'hafen'); }

  // ---------- Mission 2 ----------
  stage_briefing(S, p) {
    const m = this.memo;
    if (!S.ship.docked) { this.dock(S, p, 'hafen'); return; }
    const buyer = this.role === 'solo' || this.role === 'weapons';
    if (buyer && !m.bought) {
      if (!this.enter(S, 'shop')) return;
      if (S.inventory.marks >= 20) this.cmd('shop.buy', { item: 'pflanze' });
      if (this.role === 'weapons' && S.inventory.marks >= 220 + 60) this.cmd('shop.buy', { item: 'bolzenwerfer' });
      m.bought = true; return;
    }
    if (buyer && !m.deco) {
      if (!S.inventory.deko.includes('trophaee_boje')) { m.deco = true; return; }
      if (!this.enter(S, 'quartier')) return;
      const bed = Maps.BEDS.find((b) => b.color === p.color);
      this.cmd('deco.place', { slot: bed.slots[0].id, item: 'trophaee_boje' });
      this.cmd('quartier.style', { part: 'light', value: 'bernstein' });
      m.deco = true; return;
    }
    if (this.role === 'helm' && !m.pinned) {
      if (!this.enter(S, 'plan')) return;
      this.cmd('plan.pin', { map: 'star', x: 570, y: 280, label: 'ziel' });
      m.pinned = true; return;
    }
    if (this.is('captain')) { this.acceptRadio(S) || this.enter(S, 'captain'); return; }
    if (this.role === 'helm') this.enter(S, 'helm'); else this.enter(S, 'weapons');
  }
  // QA M1: Sela an der Vaelen-Karawane (Nebelkarte kaufen oder Messsonde suchen)
  stage_vaelen(S, p) {
    if (S.space.enemies.length) { this.combat(S, p); return; }
    if (S.mission.choice && S.mission.choice.id === 'sela') {
      if (this.is('captain')) { if (this.role === 'solo' && p.console === 'helm' && !this.brake(S)) return; if (this.enter(S, 'captain')) this.cmd('captain.choice', { option: this.opts.sela || 'buy' }); }
      return;
    }
    if (S.ship.scene !== 'vaelen') { this.travel(S, p, 'vaelen'); return; }
    if (this.role === 'captain') { this.enter(S, 'captain'); return; }
    this.dock(S, p, 'vaelen');
  }
  stage_sonde(S, p) {
    const sh = S.ship; const m = this.memo;
    if (S.space.enemies.length) { this.combat(S, p); return; }
    const probe = (S.space.hidden || []).find((h) => h.id === 'vaelen_sonde');
    const WPS = [{ x: 1300, y: 1300 }, { x: 700, y: 1250 }, { x: 1900, y: 1200 }, { x: 600, y: 400 }];
    m.pwp = m.pwp || 0;
    const wp = probe ? { x: probe.x + 400, y: probe.y - 200 } : WPS[m.pwp % WPS.length];
    const atWp = dist(sh.x, sh.y, wp.x, wp.y) < 120;
    const tac = () => {
      if (!probe) { if (sh.widescan.cd === 0 && atWp && m.pScanned !== m.pwp) { this.cmd('weapons.widescan'); m.pScanned = m.pwp; return 'scanned'; } return 'wait'; }
      if (sh.target !== probe.id) { this.cmd('weapons.target', { id: probe.id }); return 'busy'; }
      if (dist(sh.x, sh.y, probe.x, probe.y) <= 790) { this.scanT -= DT; if (this.scanT <= 0) { this.scanT = 0.3; this.cmd('weapons.scan', { on: true }); } return 'busy'; }
      return 'wait';
    };
    if (this.role === 'solo') {
      if (!atWp || sh.speed > 12) { if (this.enter(S, 'helm')) { if (sh.docked) { this.helmS(S, 0, QUARTER); return; } if (!atWp) this.steer(S, wp.x, wp.y, 60, 120); else this.brake(S); } return; }
      if (!this.enter(S, 'weapons')) return;
      const r = tac();
      if (r === 'wait' && !probe && m.pScanned === m.pwp) m.pwp++;
      return;
    }
    if (this.role === 'helm') { if (this.enter(S, 'helm')) { if (sh.docked) { this.helmS(S, 0, QUARTER); return; } if (!atWp) this.steer(S, wp.x, wp.y, 60, 120); else this.brake(S); } return; }
    if (this.role === 'weapons') {
      if (!this.enter(S, 'weapons')) return;
      tac();
      if (!probe && m.pScanned === m.pwp && sh.widescan.cd < 15) { m.pwp++; for (const a of this.game.simAgents) a.memo.pwp = m.pwp; }
      return;
    }
    if (this.role === 'captain') this.enter(S, 'captain');
  }
  // QA M1: Funkduell mit Grauzahn
  stage_parley(S, p) {
    if (S.mission.choice && S.mission.choice.id === 'parley') {
      if (this.is('captain')) { if (this.role === 'solo' && p.console === 'helm' && !this.brake(S)) return; if (this.enter(S, 'captain')) this.cmd('captain.choice', { option: this.opts.parley || 'silent' }); }
      return;
    }
    if (S.space.enemies.length) { this.combat(S, p); return; }
    if (this.is('helm')) { if (this.enter(S, 'helm')) this.brake(S); }
  }
  stage_nebelFlight(S, p) {
    // optional: Wrack-Abstecher (Außenmission), wenn so konfiguriert
    if (this.opts.wreck && !this.game.simStats.wreckDone) { this.wreckDetour(S, p); return; }
    if (S.space.enemies.length) { this.combat(S, p); return; }
    this.travel(S, p, 'nebel');
  }
  stage_ambush(S, p) {
    if (S.space.enemies.length) { this.combat(S, p); return; }
    if (this.is('helm')) { if (this.enter(S, 'helm')) this.brake(S); }
    else if (this.role === 'captain') this.enter(S, 'captain'); else this.enter(S, 'weapons');
    if (this.role === 'captain' && !this.memo.overloaded && S.ship.reactor.state === 'online') { if (this.enter(S, 'captain')) { this.cmd('captain.overload'); this.memo.overloaded = true; } }
  }
  stage_beacon(S, p) {
    const sh = S.ship;
    if (S.space.enemies.length) { this.combat(S, p); return; }
    const beacon = (S.space.hidden || []).find((h) => h.kind === 'beacon');
    const m = this.memo;
    m.wp = m.wp || 0;
    const wp = beacon ? { x: beacon.x - 350, y: beacon.y + 150 } : NEBEL_WAYPOINTS[m.wp % NEBEL_WAYPOINTS.length];
    const atWp = dist(sh.x, sh.y, wp.x, wp.y) < 120;
    const tacticalWork = () => {
      if (!beacon) {
        if (sh.widescan.cd === 0 && atWp && (m.scannedWp !== m.wp)) { this.cmd('weapons.widescan'); m.scannedWp = m.wp; return 'scanned'; }
        return 'wait';
      }
      if (sh.target !== beacon.id) { this.cmd('weapons.target', { id: beacon.id }); return 'busy'; }
      if (dist(sh.x, sh.y, beacon.x, beacon.y) <= 790) { this.scanT -= DT; if (this.scanT <= 0) { this.scanT = 0.3; this.cmd('weapons.scan', { on: true }); } return 'busy'; }
      return 'wait';
    };
    if (this.role === 'solo') {
      if (!atWp || sh.speed > 12) { if (this.enter(S, 'helm')) { if (!atWp) this.steer(S, wp.x, wp.y, 60, 120); else this.brake(S); } return; }
      if (!this.enter(S, 'weapons')) return;
      const r = tacticalWork();
      if (r === 'scanned' || (r === 'wait' && !beacon && m.scannedWp === m.wp)) m.wp++;
      return;
    }
    if (this.role === 'helm') { if (this.enter(S, 'helm')) { if (!atWp) this.steer(S, wp.x, wp.y, 60, 120); else this.brake(S); } return; }
    if (this.role === 'weapons') {
      if (!this.enter(S, 'weapons')) return;
      const r = tacticalWork();
      if (r === 'scanned') { this.game.simStats.widescans++; }
      if (!beacon && m.scannedWp === m.wp && sh.widescan.cd < 15) { m.wp++; this.syncWp(S, m.wp); }
      if (!S.ship.markers.tactical || S.ship.markers.tactical.x !== wp.x) this.cmd('weapons.marker', { x: wp.x, y: wp.y });
      return;
    }
    if (this.role === 'captain') this.enter(S, 'captain');
  }
  syncWp(S, wp) { for (const a of this.game.simAgents) a.memo.wp = wp; }
  stage_toRelais(S, p) {
    if (S.space.enemies.length) { this.combat(S, p); return; }
    this.travel(S, p, 'relais');
  }
  stage_relay(S, p) {
    const sh = S.ship; const st = this.station(S);
    if (S.space.enemies.length) { this.combat(S, p); return; }
    const near = dist(sh.x, sh.y, st.x, st.y) <= 300;
    if (this.role === 'solo') {
      if (!near || sh.speed > 10) { if (this.enter(S, 'helm')) { if (!near) this.steer(S, st.x - 200, st.y, 40, 100); else this.brake(S); } return; }
      if (this.enter(S, 'captain')) { this.scanT -= DT; if (this.scanT <= 0) { this.scanT = 0.2; this.cmd('captain.scan', { on: true }); } }
      return;
    }
    if (this.role === 'helm') { if (this.enter(S, 'helm')) { if (!near) this.steer(S, st.x - 200, st.y, 40, 100); else this.brake(S); } return; }
    if (this.role === 'captain' && this.enter(S, 'captain') && dist(sh.x, sh.y, st.x, st.y) <= 450) { this.scanT -= DT; if (this.scanT <= 0) { this.scanT = 0.2; this.cmd('captain.scan', { on: true }); } }
    if (this.role === 'weapons') this.enter(S, 'weapons');
  }
  stage_finale(S, p) { this.input(0, 0); }
  endPhase(S, p) {
    if (this.game.mission.missions.m2 && this.game.mission.missions.m2.state === 'done' && S.phase !== 'end') return;
    if (this.is('captain') && S.mission.teaser && S.mission.teaser.status === 'ready' && !this.memo.listened) { if (this.enter(S, 'captain')) { this.cmd('captain.listen'); this.memo.listened = true; } }
  }

  // ---------- Optional: Wrack ----------
  wreckDetour(S, p) {
    const sh = S.ship; const ss = this.game.simStats;
    if (S.space.enemies.length) { this.combat(S, p); return; }
    if (sh.scene !== 'wrack') { this.travel(S, p, 'wrack'); return; }
    const st = this.station(S);
    const near = dist(sh.x, sh.y, st.x, st.y) <= 240;
    // Weitscan aus dem Orbit (Hohlraum) – Taktik bzw. solo
    if (!(S.away.hollow && S.away.hollow.marked)) {
      if (!near || sh.speed > 10) { if (this.is('helm')) { if (this.enter(S, 'helm')) { if (!near) this.steer(S, st.x - 180, st.y, 30, 100); else this.brake(S); } } return; }
      if (this.is('weapons') && this.enter(S, 'weapons') && sh.widescan.cd === 0) this.cmd('weapons.widescan');
      return;
    }
    const salvLeft = S.away.salvage.filter((s) => !s.done);
    const doer = this.role === 'solo' || this.role === 'helm';
    if (!salvLeft.length && !S.players.some((o) => o.zone === 'away')) { ss.wreckDone = true; ss.wreckTime = this.game.time - (ss.wreckStart || this.game.time); return; }
    if (!ss.wreckStart) ss.wreckStart = this.game.time;
    if (p.zone === 'ship') {
      if (!doer) { if (this.role === 'captain') this.enter(S, 'captain'); else this.enter(S, 'weapons'); return; }
      if (!salvLeft.length) return;
      if (sh.speed > 10 || !near) { if (this.enter(S, 'helm')) { if (!near) this.steer(S, st.x - 180, st.y, 30, 100); else this.brake(S); } return; }
      if (p.console) { this.leave(S); return; }
      if (!this.onMyPad(S, p)) return;
      this.holdBeam(S, p);
      return;
    }
    if (this.shootDrones(S)) { this.ix = null; return; }
    if (!S.away.loreRead && !this.memo.lore) {
      const g = Maps.wreck.find('g')[0];
      const r = this.interact(S, g.x, g.y, {});
      if (r === 'done') this.memo.lore = true;
      return;
    }
    if (S.away.hollow && !S.away.hollow.open) {
      this.interact(S, S.away.hollow.x, S.away.hollow.y, { hold: true, until: (S2) => S2.away.hollow.open });
      return;
    }
    if (salvLeft.length) {
      const pt = this.tile(p);
      const s = salvLeft.slice().sort((a, b) => Math.abs(a.x - pt.x) + Math.abs(a.y - pt.y) - Math.abs(b.x - pt.x) - Math.abs(b.y - pt.y))[0];
      const r = this.interact(S, s.x, s.y, { hold: true, until: (S2) => S2.away.salvage.some((q) => q.x === s.x && q.y === s.y && q.done) });
      if (r === 'fail') this.waitT = 0.3;
      return;
    }
    this.returnToPads(S, p, null);
  }
}

// ---------- M2 „Schildwall“: Mission 3 zu dritt (Captain an Bord, 2 Außenteam-Bots mit Deckung) ----------
const Los = require('../shared/los.js');
const KESH = Maps.kesh;
const KESH_GOALS = { hall: { x: 38, y: 10 }, keyA: { x: 38, y: 2 }, keyB: { x: 45, y: 14 }, tablet: { x: 41, y: 18 }, vaultDoor: { x: 41, y: 13 },
  courtyard: { x: 22, y: 10 }, jammerS: { x: 32, y: 12 } };
class KeshAgent extends Agent {
  awayMap(S) { return S.away.map === 'kesh' ? KESH : super.awayMap(S); }
  walkable(S, zone) {
    if (zone === 'away' && S.away.map === 'kesh') return (x, y) => (KESH.at(x, y) === 'G' ? !!(S.away.vault && S.away.vault.open) : !KESH.solid(x, y));
    return super.walkable(S, zone);
  }
  keshSolid(S) { const w = this.walkable(S, 'away'); return (x, y) => !w(x, y); }
  update(S) {
    const p = this.me(S);
    if (!p) return;
    this.updateLocs(S);
    if (this.waitT > 0) { this.waitT -= DT; return; }
    if (S.phase === 'end' || !S.mission.active || S.mission.active.id !== 'm3') return;
    const st = S.mission.stage;
    if (p.zone === 'away') { this.awayLogic(S, p, st); return; }
    if (p.downed) { this.input(0, 0); return; }
    if (this.role === 'captain') { this.captainLogic(S, p, st); return; }
    this.crewLogic(S, p, st);
  }
  // ---- Captain an Bord: Funk, Kurs, Befehle, Sensor, Kuppel ----
  captainLogic(S, p, st) {
    if (st === 'briefing') { this.acceptRadio(S) || this.enter(S, 'captain'); return; }
    if (S.ship.scene !== 'kesh') { this.travel(S, p, 'kesh'); return; }
    if (!this.enter(S, 'captain')) return;
    const away = S.players.filter((o) => o.zone === 'away');
    if (!away.length) return;
    const m = this.memo; const t = S.time;
    const foes = S.away.drones.filter((d) => d.alive && !d.asleep);
    if (foes.length && S.support.sensor === 0 && (m.sensorAt || 0) < t) { m.sensorAt = t + 5; this.cmd('captain.support', { kind: 'sensor' }); }
    if (S.support.kuppel === 0 && away.some((o) => o.sh && o.sh[0] <= 1) && (m.kuppelAt || 0) < t) { m.kuppelAt = t + 5; this.cmd('captain.support', { kind: 'kuppel' }); }
    if ((m.orderAt || 0) < t) {
      m.orderAt = t + 7;
      const lead = away[0];
      const near = foes.filter((d) => d.kind !== 'warden').sort((a, b) => dist(a.x, a.y, lead.x, lead.y) - dist(b.x, b.y, lead.x, lead.y))[0];
      if (near) { this.cmd('captain.order', { kind: 'fokus', target: near.id }); this.game.simStats.orders++; }
      const goal = { courtyard: KESH_GOALS.hall, archive: KESH_GOALS.keyA, tablet: KESH_GOALS.tablet, warden: KESH_GOALS.courtyard, extract: Maps.KESH_PADS[0] }[st];
      if (goal) { const c = Physics.tileCenter(goal.x, goal.y); this.cmd('captain.order', { kind: 'sammeln', x: c.x, y: c.y }); this.game.simStats.orders++; }
    }
  }
  // ---- Außenteam an Bord: Kurs halten, an den Mond ran, auf die Pads, runterbeamen ----
  crewLogic(S, p, st) {
    if (st === 'briefing') { if (this.role === 'helm') this.enter(S, 'helm'); else this.input(0, 0); return; }
    if (S.ship.scene !== 'kesh') { if (this.role === 'helm') this.travel(S, p, 'kesh'); else if (p.console) this.leave(S); else this.onMyPad(S, p); return; }
    if (st === 'extract' && S.inventory.tafel >= 1) { if (p.console) this.leave(S); this.input(0, 0); return; }
    const sh = S.ship; const stn = this.station(S);
    const spot = { x: stn.x - 250, y: stn.y };
    const ok = dist(sh.x, sh.y, stn.x, stn.y) <= 330 && sh.speed <= 12;
    const steerer = this.role === 'helm' || !S.players.some((o) => o.id !== this.pid && o.zone === 'ship' && o.role !== 'captain' && o.console === 'helm');
    if (!ok && (this.role === 'helm' || p.console === 'helm')) {
      if (this.enter(S, 'helm')) { if (dist(sh.x, sh.y, spot.x, spot.y) > 60) this.steer(S, spot.x, spot.y, 30, 90); else this.brake(S); }
      return;
    }
    if (!ok && !steerer) { if (p.console) this.leave(S); this.onMyPad(S, p); return; }
    if (p.console) { this.leave(S); return; }
    if (!this.onMyPad(S, p)) return;
    if (this.role === 'helm') {
      const mate = S.players.find((o) => o.id !== this.pid && o.zone === 'ship' && o.console !== 'captain');
      this.memo.padWait = (this.memo.padWait || 0) + DT;
      if (mate && !onShipPad(mate) && this.memo.padWait < 8) { this.input(0, 0); return; }
    } else if (S.players.some((o) => o.id !== this.pid && o.zone === 'ship' && o.console !== 'captain' && !onShipPad(o))) { this.input(0, 0); return; }
    this.memo.padWait = 0;
    this.holdBeam(S, p);
  }
  // ---- Unten auf Kesh ----
  enemiesInSight(S, p) {
    const solid = this.keshSolid(S); const blocked = Los.sightFn(KESH, solid);
    // §15: geduckte Gegner (cr) hinter niedriger Deckung sind von hier aus nicht zu sehen – nicht blind draufhalten
    const sight = (d) => d.cr ? Los.crouchSight(KESH, solid, blocked, [d]) : blocked;
    return S.away.drones.filter((d) => d.alive && !d.asleep && d.vis && dist(d.x, d.y, p.x, p.y) <= 9 * TILE && Los.lineOfSight(sight(d), p.x, p.y, d.x, d.y))
      .filter((d) => d.kind !== 'warden' || Math.abs(norm(Math.atan2(p.y - d.y, p.x - d.x) - (d.facing || 0))) > 1.1)   // Wächter nur von der Seite
      .sort((a, b) => dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y));
  }
  fire(S, p, d) {
    const m = this.memo;
    // menschennäher: Reaktionszeit 0,5 s auf ein neues Ziel, ~1,6 Schuss/s, Streuung ±7°
    if (m.foeId !== d.id) { m.foeId = d.id; m.shotAt = Math.max(m.shotAt || 0, S.time + 0.5); }
    if ((m.shotAt || 0) > S.time) return;
    m.shotAt = S.time + (p.downed ? 0.9 : 0.6);
    const jitter = (simRng() - 0.5) * 0.25;
    this.send({ t: 'shoot', angle: Math.atan2(d.y - p.y, d.x - p.x) + jitter });
  }
  coverSpot(S, p, foe, wantHidden) {
    const solid = this.keshSolid(S); const blocked = Los.sightFn(KESH, solid); const walk = this.walkable(S, 'away');
    const me = this.tile(p);
    let best = null, bs = -Infinity;
    for (let y = me.y - 4; y <= me.y + 4; y++) for (let x = me.x - 4; x <= me.x + 4; x++) {
      if (!walk(x, y)) continue;
      const c = Physics.tileCenter(x, y);
      const los = Los.lineOfSight(blocked, foe.x, foe.y, c.x, c.y);
      let score;
      if (wantHidden) { if (los) continue; score = -Math.abs(x - me.x) - Math.abs(y - me.y); }
      else {
        if (!los) continue;
        const cv = Los.coverAgainst(KESH, solid, foe.x, foe.y, c.x, c.y);
        if (!cv) continue;
        score = cv * 3 - Math.abs(x - me.x) - Math.abs(y - me.y);
      }
      if (score > bs) { bs = score; best = { x, y }; }
    }
    return best;
  }
  awayLogic(S, p, st) {
    const m = this.memo;
    if (p.downed) { this.ix = null; if (this.actDown) this.act(false); this.input(0, 0); const f = this.enemiesInSight(S, p)[0]; if (f) this.fire(S, p, f); return; }
    const foes = this.enemiesInSight(S, p);
    // Kamerad verwundet in der Nähe: wiederbeleben (Medipack, wenn vorhanden)
    const mate = S.players.find((o) => o.id !== this.pid && o.zone === 'away' && o.downed && dist(o.x, o.y, p.x, p.y) < 7 * TILE);
    if (mate && (!foes.length || (p.sh && p.sh[0] >= 2))) {
      const mt = this.tile(mate);
      const r = this.interact(S, mt.x, mt.y, { floor: true, hold: true, until: (S2) => !S2.players.find((o) => o.id === mate.id).downed, max: 8 });
      if (r === 'fail') this.waitT = 0.3;
      return;
    }
    if (foes.length && !(st === 'extract' && this.nearPads(p))) {
      const f = foes[0];
      if (this.ix) { this.ix = null; }
      if (this.actDown) this.act(false);
      const seg = p.sh ? p.sh[0] : 3;
      const solid = this.keshSolid(S);
      if (seg <= 1) {
        if (!m.hide || m.hideAt < S.time) { m.hide = this.coverSpot(S, p, f, true); m.hideAt = S.time + 1.5; }
        if (m.hide && this.goto(S, [m.hide]) !== true) return;
        this.input(0, 0); return;
      }
      const cv = Los.coverAgainst(KESH, solid, f.x, f.y, p.x, p.y);
      if (!cv) {
        if (!m.cov || m.covAt < S.time) { m.cov = this.coverSpot(S, p, f, false); m.covAt = S.time + 2; }
        if (m.cov) { const r = this.goto(S, [m.cov]); if (r !== true && r !== 'fail') { if (simRng() < 0.3) this.fire(S, p, f); return; } }
      } else this.game.simStats.coverShots++;
      this.input(0, 0);
      this.fire(S, p, f);
      return;
    }
    m.cov = null; m.hide = null;
    const ss = this.game.simStats;
    const goTo = (g) => this.goto(S, [g]);
    if (st === 'courtyard') {
      if (this.role === 'weapons' && !S.away.jammers[1].off && dist(p.x, p.y, 32 * TILE, 12 * TILE) < 12 * TILE) {
        const r = this.interact(S, 32, 13, { hold: true, until: (S2) => S2.away.jammers[1].off });
        if (r === 'fail') this.waitT = 0.3;
        return;
      }
      goTo(this.role === 'helm' ? KESH_GOALS.hall : { x: 36, y: 11 }); return;
    }
    if (st === 'archive') {
      const k = this.role === 'helm' ? 0 : 1;
      const acc = this.role === 'helm' ? KESH_GOALS.keyA : KESH_GOALS.keyB;
      const key = S.away.keys[k];
      const other = S.players.find((o) => o.id !== this.pid && o.zone === 'away' && !o.downed);
      const otherReady = other && this.tile(other).x === (k ? KESH_GOALS.keyA.x : KESH_GOALS.keyB.x) && this.tile(other).y === (k ? KESH_GOALS.keyA.y : KESH_GOALS.keyB.y);
      const t = this.tile(p);
      if (t.x !== acc.x || t.y !== acc.y) { if (this.actDown) this.act(false); this.ix = null; goTo(acc); return; }
      if (!otherReady) { if (this.actDown) this.act(false); this.ix = null; this.input(0, 0); return; }
      const r = this.interact(S, key.x, key.y, { hold: true, max: 6, until: (S2) => S2.away.vault.open || S2.away.keys[k].t >= 1 });
      if (r === 'fail') this.waitT = 0.4;
      if (!m.keyTry) { m.keyTry = true; ss.keyTries++; }
      return;
    }
    if (st === 'tablet') {
      if (this.role === 'helm') { const r = this.interact(S, 41, 19, { hold: true, until: (S2) => S2.away.tablet.taken }); if (r === 'fail') this.waitT = 0.3; }
      else goTo(KESH_GOALS.vaultDoor);
      return;
    }
    if (st === 'warden') { goTo(this.role === 'helm' ? KESH_GOALS.courtyard : { x: 21, y: 11 }); return; }
    if (st === 'extract') { this.extractPads(S, p); return; }
    this.input(0, 0);
  }
  nearPads(p) { return Maps.KESH_PADS.some((q) => dist(p.x, p.y, q.x * TILE + 16, q.y * TILE + 16) < 4 * TILE); }
  extractPads(S, p) {
    const pad = Maps.KESH_PADS[this.idx % 3];
    const t = this.tile(p); const c = Physics.tileCenter(pad.x, pad.y);
    if (!(t.x === pad.x && t.y === pad.y) || dist(p.x, p.y, c.x, c.y) > 4) { if (this.actDown) this.act(false); this.goto(S, [pad]); return; }
    this.input(0, 0);
    const mate = S.players.find((o) => o.id !== this.pid && o.zone === 'away');
    if (mate && !mate.downed && dist(mate.x, mate.y, p.x, p.y) > 3 * TILE && (this.memo.extractWait = (this.memo.extractWait || 0) + DT) < 15) return;
    if (!this.actDown) this.act(true);
    else if (!p.action && (this.memo.holdUp = (this.memo.holdUp || 0) + DT) > 0.6) { this.act(false); this.memo.holdUp = 0; this.waitT = 1; }
  }
}

async function runKesh(opts) {
  const seed = opts.seed;
  simRng = makeRng(seed * 7919 + 33);
  const game = new Game({ noStore: true, seed, env: { MISSION_SOURCE: 'fallback' }, log: VERBOSE ? (...a) => log('  [game] ' + a.join(' ')) : () => {} });
  game.simStats = { reactorRestarts: 0, widescans: 0, wreckDone: false, orders: 0, coverShots: 0, keyTries: 0 };
  const agents = ['captain', 'helm', 'weapons'].map((r, i) => new KeshAgent(game, i, r, opts));
  game.simAgents = agents;
  const watcher = { send: (o) => {
    if (o.t !== 'event' || !VERBOSE) return;
    if (o.kind === 'oda') log(`  [ODA ${game.time.toFixed(1)}] ${o.text}`);
    if (o.kind === 'radio') log(`  [Funk ${game.time.toFixed(1)}] ${o.from}: ${o.text}`);
    if (o.kind === 'bark') log(`  [Bark ${game.time.toFixed(1)}] ${o.text}`);
    if (o.kind === 'stage') log(`--- Schritt ${o.mission}/${o.stage} @ ${game.time.toFixed(1)} s (${game.ship.scene})`);
    if (o.kind === 'wounded' || o.kind === 'squadRecall') log(`  [${o.kind} ${game.time.toFixed(1)}] ${o.pid || o.pids}`);
  } };
  game.addConnection(watcher); watcher.observer = true;
  game.lobbyOpts.startMission = 'm3';
  for (const a of agents) { game.addConnection(a.conn); a.hello(); }
  let S = game.snapshot();
  let stage = null, stageStart = 0, softlock = null, ticks = 0, snapMax = 0;
  const m3 = () => game.mission.missions.m3;
  while (game.phase !== 'end' && game.time < MAX_GAME_SEC) {
    game.step(); ticks++;
    if (game.wantsSnapshot()) { S = game.snapshot(); snapMax = Math.max(snapMax, Buffer.byteLength(JSON.stringify(S))); }
    for (const a of agents) a.update(S);
    const pinfo = (p) => p.name + ':' + p.zone + (p.zone === 'away' ? '@' + Math.floor(p.x / 32) + ',' + Math.floor(p.y / 32) + ' sh' + (p.sh ? p.sh[0] : '-') + (p.downed ? ' DOWN' : '') : ':' + (p.console || '-'));
    if (VERBOSE && ticks % 300 === 0) log(`  [t ${game.time.toFixed(0)} ${S.mission.stage}] ` + S.players.map(pinfo).join(' ') +
      ' | Gegner ' + S.away.drones.filter((d) => d.alive).map((d) => `${d.id}:${d.role}:${d.sh ? d.sh[0] : ''}@${Math.floor(d.x / 32)},${Math.floor(d.y / 32)}`).join(' '));
    const key = S.mission.stage || 'free';
    if (key !== stage) { stage = key; stageStart = game.time; }
    if (game.time - stageStart > SOFTLOCK_SEC) { softlock = stage; break; }
    if (ticks % 3000 === 0) await new Promise((r) => setImmediate(r));
  }
  const aw = game.aways.kesh;
  const st = m3() || {};
  const stTimes = Object.entries(game.stats.stages).sort((a, b) => a[1] - b[1]);
  const durations = {};
  for (let i = 0; i < stTimes.length; i++) durations[stTimes[i][0]] = Math.round(((i + 1 < stTimes.length ? stTimes[i + 1][1] : game.stats.elapsed) - stTimes[i][1]) * 10) / 10;
  const ms = game.stats.missions.m3;
  return {
    success: game.phase === 'end' && st.state === 'done', softlock, stageAtEnd: game.mission.state.stage, seed,
    total: ms && ms.end != null ? Math.round((ms.end - ms.start) * 10) / 10 : null, durations, errors: game.errors,
    combat: aw.stats, sim: game.simStats, warden: game.mission.flags.wardenKilled ? 'ausgeschaltet' : 'lebt', jammersOff: aw.jammers.filter((j) => j.off).length,
    killed: aw.drones.filter((d) => !d.alive).length, spawned: aw.drones.length, snapMax, marks: game.inventory.marks, tafel: game.inventory.tafel,
  };
}
function printKesh(r) {
  log(`\n=== m3 „Die Tafel von Kesh“ – 3 Spieler (Captain an Bord, 2 Außenteam-Bots), Lobby-Direktstart, Seed ${r.seed} ===`);
  log(`Erfolg: ${r.success ? 'JA' : 'NEIN'}${r.softlock ? `  – SOFTLOCK in „${r.softlock}“ (> ${SOFTLOCK_SEC} s)` : ''}${!r.success && !r.softlock ? `  – Ende in Schritt ${r.stageAtEnd}` : ''}`);
  log(`Dauer m3: ${r.total} s (${r.total ? (r.total / 60).toFixed(1) : '—'} min, Bot-Spieler – kein Menschenwert; Ziel zu dritt 10–14 min)`);
  log('Dauer je Schritt (s): ' + Object.entries(r.durations).map(([k, v]) => `${k} ${v}`).join(' · '));
  const c = r.combat;
  log(`Kampf: Verwundungen ${c.wounds}, Wiederbelebungen ${c.revives}, Notrückholungen alle ${c.squadRecalls} / einzeln ${c.bleedRecalls}, Spieler-Treffer ${c.playerHits}, Gegner-Schüsse ${c.enemyShots}, Deckung geschluckt ${c.coverBlocks}, Wächter-Abpraller ${c.deflects}, Kuppel ${c.kuppelBlocks}`);
  log(`Gegner: ${r.killed}/${r.spawned} ausgeschaltet, Wächter ${r.warden}, Störrelais aus ${r.jammersOff}/2, Funksprüche ${c.barks}, Befehle ${r.sim.orders}, Schüsse aus Deckung ${r.sim.coverShots}`);
  log(`Invarianten: Treffer aus mehr als engageBox ${c.offBoxHits} (Schüsse außerhalb ${c.offBoxShots}), längstes Einklemmen ${c.maxStuck.toFixed(1)} s (max. 8)`);
  log(`Server-Fehlerzähler: ${r.errors} · Snapshot max ${r.snapMax} B · Marken ${r.marks}, Tafel ${r.tafel}`);
}

// ---------- M3a: Testgelände Raumkampf (Lobby-Start arena_space), Strategievergleich nose / maneuver ----------
class ArenaAgent extends Agent {
  update(S) {
    const p = this.me(S);
    if (!p) return;
    if (this.waitT > 0) { this.waitT -= DT; return; }
    if (p.downed) { this.input(0, 0); this.act(false); this.ix = null; return; }
    if (S.phase !== 'play') return;
    if (this.reactorDuty(S, p)) return;
    if (S.space.enemies.some((e) => e.kind !== 'relay')) { this.combat(S, p); return; }
    // Pause zwischen den Wellen: reparieren, Steuer fliegt zurück zur Startposition, Captain bleibt an der Konsole
    if (this.role === 'captain') { this.captainFight(S, p); return; }
    if (this.role === 'weapons' || this.role === 'solo') { if (this.repairDuty(S, p, { damaged: true, cooldown: 1 })) return; }
    if (this.role === 'weapons') { this.enter(S, 'weapons'); return; }
    if (!this.enter(S, 'helm')) return;
    const home = CONFIG.arena.shipPos; const sh = S.ship;
    if (dist(sh.x, sh.y, home.x, home.y) > 300) this.steer(S, home.x, home.y, 120, 100); else this.brake(S);
  }
}

const ArenaMod = require('../server/sim/arena.js');
// M3b §6: Messung im Testgelände. Zusätzlich zu M3a: Schild-/Schadenszähler (leakHits, escalations, repairSetbacks,
// overflowHull), Breitseiten-Anteil der Kanonenboote (Lerche im Feuerbogen einer Breitseite) und die Lanzen-Trefferquote
// gegen Jäger (Schüsse, die einem Jäger galten bzw. einen trafen).
async function runArena(opts) {
  const seed = opts.seed;
  simRng = makeRng(seed * 7919 + 101);
  const game = new Game({ noStore: true, seed, env: { MISSION_SOURCE: 'fallback' }, log: VERBOSE ? (...a) => log('  [game] ' + a.join(' ')) : () => {} });
  game.simStats = { reactorRestarts: 0, widescans: 0, wreckDone: false };
  const roles = opts.players === 1 ? ['solo'] : ['helm', 'weapons', 'captain'].slice(0, opts.players);
  const agents = roles.map((r, i) => new ArenaAgent(game, i, r, opts));
  game.simAgents = agents;
  const ev = { tele: 0, teleMiss: 0, dodged: 0, lanceFire: 0, lanceHit: 0, lanceFizzle: 0, systemHit: 0, lanceRaiderShots: 0, lanceRaiderHits: 0, escalated: 0, repairSetback: 0,
    shots: 0, hits: 0, hitsShield: 0, hitsHull: 0, hitsHeavy: 0 };   // QA M3b: Gegnerschüsse (Blaster) und Treffer am Schiff
  const kindById = {};
  const gunner = () => agents.find((a) => a.role === 'weapons' || a.role === 'solo');
  const watcher = { send: (o) => {
    if (o.t !== 'event') return;
    if (o.kind === 'tele') ev.tele++;
    if (o.kind === 'teleMiss') { ev.teleMiss++; if (o.dodged) ev.dodged++; }
    if (o.kind === 'systemHit') ev.systemHit++;
    if (o.kind === 'sfx' && o.name === 'blaster') ev.shots++;
    if (o.kind === 'hit' && !o.evaded) { ev.hits++; if (o.heavy) ev.hitsHeavy++; if (o.shield) ev.hitsShield++; else ev.hitsHull++; }
    if (o.kind === 'escalated') ev.escalated++;
    if (o.kind === 'repairSetback') ev.repairSetback++;
    // §20.3: Ereignis lance { state: charge|fire|fizzle, power, hit }
    if (o.kind === 'lance') {
      if (o.state === 'fire') {
        ev.lanceFire++; if (o.hit) ev.lanceHit++;
        const hitRaider = o.hit != null && kindById[o.hit] === 'raider';
        const tgt = game.ship.target != null ? kindById[game.ship.target] : null;
        const g8 = gunner();
        if (hitRaider || tgt === 'raider' || (g8 && g8.memo.lanceVsRaider)) { ev.lanceRaiderShots++; if (hitRaider) ev.lanceRaiderHits++; }
      }
      if (o.state === 'fizzle') ev.lanceFizzle++;
    }
    if (VERBOSE && o.kind === 'oda') log(`  [ODA ${game.time.toFixed(1)}] ${o.text}`);
  } };
  game.addConnection(watcher); watcher.observer = true;
  game.lobbyOpts.startMission = 'arena_space';
  for (const a of agents) { game.addConnection(a.conn); a.hello(); }
  let S = game.snapshot();
  const waves = []; let cur = null;
  let prevHull = game.ship.hull, hullLoss = 0, ticks = 0, lastProgress = 0, softlock = false;
  const gbArcs = CONFIG.enemyWeapons.gunboat || [];
  const bs = { gbTicks: 0, gbBroadside: 0 };
  while (game.time < opts.maxSec) {
    game.step(); ticks++;
    if (game.wantsSnapshot()) S = game.snapshot();
    for (const a of agents) a.update(S);
    const h = game.ship.hull;
    if (h < prevHull) hullLoss += prevHull - h;
    prevHull = h;
    const sh = game.ship;
    for (const e of game.space.enemies) {
      kindById[e.id] = e.kind;
      if (e.kind !== 'gunboat') continue;
      bs.gbTicks++;
      if (gbArcs.some((w) => Physics.inArc(e.x, e.y, e.angle, w.facing, w.arc, w.range, sh.x, sh.y))) bs.gbBroadside++;
    }
    const A = game.arena;
    if (!A) break;
    if (A.active && (!cur || cur.wave !== A.wave)) { cur = { wave: A.wave, start: game.time, hull0: hullLoss, em0: game.stats.emergencies }; lastProgress = game.time; }
    if (!A.active && cur) {
      cur.dur = Math.round((game.time - cur.start) * 10) / 10; cur.hull = Math.round((hullLoss - cur.hull0) * 10) / 10; cur.em = game.stats.emergencies - cur.em0; cur.ok = !cur.failed;
      waves.push(cur); cur = null; lastProgress = game.time;
    }
    if (VERBOSE && ticks % 300 === 0) {
      const s2 = S.ship;
      log(`  [t ${game.time.toFixed(0)} W${A.wave}${A.active ? '' : '-'}] Hülle ${s2.hull} Stufe ${s2.helm && s2.helm.stage} v${Math.round(s2.speed)} Sys ${Object.entries(s2.systems).filter(([, v]) => v !== 'ok').map(([k, v]) => k + ':' + v).join(',')} Schilde ${s2.shields.current.join('/')} ` +
        `Gegner ${S.space.enemies.map((e) => e.kind + ' ' + e.hp + (e.state ? ' ' + e.state : '') + (e.tele ? ' T' + e.tele.left : '') + ' @' + Math.round(dist(e.x, e.y, s2.x, s2.y))).join('; ')} Spieler ${S.players.map((q) => q.console || Math.floor(q.x / 32) + ',' + Math.floor(q.y / 32)).join(' ')}`);
    }
    // Zeitlimit je Welle: zählt als „Welle nicht geschafft“ (Gegner werden wie mit Debug-skip entfernt), kein Softlock
    if (cur && !cur.failed && game.time - cur.start > opts.waveLimit) { cur.failed = true; ArenaMod.skipWave(game); }
    if (waves.length >= opts.waves) break;
    if (game.time - lastProgress > 300) { softlock = true; break; }
    if (ticks % 3000 === 0) await new Promise((r) => setImmediate(r));
  }
  const st = game.stats;
  return {
    seed, pilot: opts.pilot, players: opts.players, time: Math.round(game.time * 10) / 10, cleared: waves.filter((w) => w.ok).length, failed: waves.filter((w) => w.failed).length, softlock,
    hullLoss: Math.round(hullLoss * 10) / 10, waves, errors: game.errors, emergencies: st.emergencies,
    bridgeLeaves: st.bridgeLeaves || 0, flicks: st.flicks || 0, swaps: st.swaps || 0, minigames: st.minigames || 0,
    leakHits: st.leakHits || 0, escalations: st.escalations || 0, repairSetbacks: st.repairSetbacks || 0, overflowHull: st.overflowHull || 0,
    statsMissing: ['leakHits', 'escalations', 'repairSetbacks', 'overflowHull'].filter((k) => st[k] == null),
    broadside: bs.gbTicks ? bs.gbBroadside / bs.gbTicks : null, gbSec: bs.gbTicks * DT,
    ev, sim: game.simStats, hull: Math.round(game.ship.hull),
  };
}

async function arenaMain() {
  const pilots = !PILOT || PILOT === 'both' ? ['nose', 'maneuver'] : [PILOT];
  const nSeeds = Number(argVal('--seeds', 10));
  const players = Number(argVal('--players', 3));
  const nWaves = Number(argVal('--waves', CONFIG.arena.waves.length));
  const maxSec = Number(argVal('--max', 1500));
  const waveLimit = Number(argVal('--wave-limit', 180));
  const base = seedArg != null ? seedArg : 1;
  const summary = {};
  let ok = true;
  const f1 = (v) => (v == null || !isFinite(v) ? '—' : (Math.round(v * 10) / 10).toString());
  const pct = (v) => (v == null || !isFinite(v) ? '—' : Math.round(v * 100) + ' %');
  for (const pilot of pilots) {
    log(`\n=== Testgelände Raumkampf – Steuer „${pilot}“, ${players} Spieler, ${nWaves} Wellen, ${nSeeds} Seeds (Bot-Spieler, Plausibilität, keine Spieldauer) ===`);
    const rs = [];
    for (let i = 0; i < nSeeds; i++) {
      const r = await runArena({ seed: base + i, pilot, players, waves: nWaves, maxSec, waveLimit });
      rs.push(r);
      if (r.errors > 0 || r.softlock) ok = false;
      log(`Seed ${r.seed}: ${r.cleared}/${nWaves} Wellen (${r.failed} über ${waveLimit} s) in ${r.time} s${r.softlock ? ' – SOFTLOCK (300 s ohne Fortschritt)' : ''} · Hülle −${r.hullLoss} (Überlauf ${f1(r.overflowHull)}) · Notfälle ${r.emergencies} · ` +
        `je Welle ${r.waves.map((w) => `W${w.wave} ${w.dur}s/${w.hull}${w.failed ? 'x' : ''}`).join(' ')} · leakHits ${r.leakHits} · Eskalationen ${r.escalations} · Rückschläge ${r.repairSetbacks} · bridgeLeaves ${r.bridgeLeaves} · ` +
        `Breitseite KB ${pct(r.broadside)} (${f1(r.gbSec)} s) · Lanze ${r.ev.lanceHit}/${r.ev.lanceFire}/${r.ev.lanceFizzle}, gegen Jäger ${r.ev.lanceRaiderHits}/${r.ev.lanceRaiderShots} · ` +
        `Flicken ${r.flicks} · Minispiele ${r.minigames} · Austausch ${r.swaps} · Ladungen ${r.ev.tele} (verfehlt ${r.ev.teleMiss}) · Schüsse ${r.ev.shots} · Treffer ${r.ev.hits} (Schild ${r.ev.hitsShield}/Hülle ${r.ev.hitsHull}/schwer ${r.ev.hitsHeavy}) · Fehler ${r.errors}`);
      if (r.statsMissing.length && i === 0) log(`  Hinweis: game.stats ohne ${r.statsMissing.join(', ')} (SERVER-DAMAGE, §4 Zähler) – als 0 gezählt`);
    }
    const avg = (f) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
    const waveAvg = [];
    for (let w = 1; w <= nWaves; w++) { const ds = rs.map((r) => r.waves.find((x) => x.wave === w)).filter(Boolean); waveAvg.push(ds.length ? { w, dur: ds.reduce((a, x) => a + x.dur, 0) / ds.length, hull: ds.reduce((a, x) => a + x.hull, 0) / ds.length, n: ds.length, failed: ds.filter((x) => x.failed).length } : { w, dur: null, hull: null, n: 0, failed: 0 }); }
    const sum = (f) => rs.reduce((a, r) => a + f(r), 0);
    const gbT = sum((r) => r.gbSec);
    const s = {
      hullLoss: avg((r) => r.hullLoss), time: avg((r) => r.time), cleared: avg((r) => r.cleared), emergencies: avg((r) => r.emergencies), bridgeLeaves: avg((r) => r.bridgeLeaves),
      leakHits: avg((r) => r.leakHits), escalations: avg((r) => r.escalations), repairSetbacks: avg((r) => r.repairSetbacks), overflowHull: avg((r) => r.overflowHull),
      flicks: avg((r) => r.flicks), minigames: avg((r) => r.minigames), swaps: avg((r) => r.swaps),
      tele: avg((r) => r.ev.tele), teleMiss: avg((r) => r.ev.teleMiss), errors: sum((r) => r.errors), softlocks: rs.filter((r) => r.softlock).length, waveAvg,
      // Zeitgewichtet über alle Seeds
      broadside: gbT > 0 ? sum((r) => (r.broadside || 0) * r.gbSec) / gbT : null,
      lanceRaider: sum((r) => r.ev.lanceRaiderShots) ? sum((r) => r.ev.lanceRaiderHits) / sum((r) => r.ev.lanceRaiderShots) : null,
      lanceRaiderShots: avg((r) => r.ev.lanceRaiderShots), lanceAll: sum((r) => r.ev.lanceFire) ? sum((r) => r.ev.lanceHit) / sum((r) => r.ev.lanceFire) : null,
      failedWaves: sum((r) => r.failed),
    };
    s.hullPerMin = s.hullLoss / Math.max(1, s.time / 60);
    s.wavesPer10 = s.cleared / Math.max(1, s.time / 600);
    s.hullPerWave = s.hullLoss / Math.max(0.1, s.cleared);
    summary[pilot] = s;
    log(`Mittel „${pilot}“: Hüllenverlust ${f1(s.hullLoss)} (${f1(s.hullPerMin)}/min, Überlauf ${f1(s.overflowHull)}) · Dauer ${f1(s.time)} s · Wellen geschafft ${f1(s.cleared)} (${f1(s.wavesPer10)} je 10 min) · Notfälle ${f1(s.emergencies)} · ` +
      `leakHits ${f1(s.leakHits)} · Eskalationen ${f1(s.escalations)} · Rückschläge ${f1(s.repairSetbacks)} · bridgeLeaves ${f1(s.bridgeLeaves)} · Breitseite KB ${pct(s.broadside)} · ` +
      `Lanze gegen Jäger ${pct(s.lanceRaider)} (${f1(s.lanceRaiderShots)} Schüsse/Lauf, alle ${pct(s.lanceAll)}) · Fehler ${s.errors} · Softlocks ${s.softlocks}`);
    log('Dauer/Hüllenverlust je Welle (Mittel): ' + waveAvg.map((x) => `W${x.w} ${f1(x.dur)} s / ${f1(x.hull)}${x.n < nSeeds ? ` (n=${x.n})` : ''}${x.failed ? ` [${x.failed}× Zeitlimit]` : ''}`).join(' · '));
  }
  if (summary.nose && summary.maneuver) {
    const a = summary.nose, b = summary.maneuver;
    const fac = b.hullLoss > 0 ? a.hullLoss / b.hullLoss : Infinity;
    const facMin = b.hullPerMin > 0 ? a.hullPerMin / b.hullPerMin : Infinity;
    log(`\n=== Vergleich nose / maneuver (${nSeeds} Seeds, ${players} Spieler) ===`);
    log('| Wert | nose | maneuver |');
    log('|---|---|---|');
    const row = (k, t, fmt) => log(`| ${t} | ${(fmt || f1)(a[k])} | ${(fmt || f1)(b[k])} |`);
    row('hullLoss', 'Hüllenverlust (Summe)'); row('hullPerMin', 'Hüllenverlust je min'); row('hullPerWave', 'Hüllenverlust je geschaffte Welle'); row('overflowHull', 'davon Überlauf durch Schild');
    row('time', 'Dauer (s)'); row('cleared', 'Wellen geschafft'); row('failedWaves', 'Wellen über Zeitlimit (Summe)'); row('wavesPer10', 'Wellen je 10 min'); row('emergencies', 'Notfallprotokolle');
    row('leakHits', 'leakHits (Systemschaden trotz Schild)'); row('escalations', 'Eskalationen'); row('repairSetbacks', 'Reparatur-Rückschläge'); row('bridgeLeaves', 'bridgeLeaves');
    row('broadside', 'Breitseiten-Anteil Kanonenboot', pct); row('lanceRaider', 'Lanzen-Trefferquote gegen Jäger', pct); row('lanceRaiderShots', 'Lanzenschüsse gegen Jäger je Lauf');
    row('flicks', 'Flicken'); row('minigames', 'Minispiele'); row('swaps', 'Austausche');
    log(`Faktor Hüllenverlust nose/maneuver: ${fac.toFixed(2)} (je Minute ${facMin.toFixed(2)}) – „Nase drauf verliert messbar“ (M3a §16: ≥ 1,3): ${fac >= 1.3 ? 'ERREICHT' : 'NICHT erreicht'}`);
    log(`Breitseiten-Anteil Kanonenboot nose ${pct(a.broadside)} > maneuver ${pct(b.broadside)} (§8): ${a.broadside != null && b.broadside != null && a.broadside > b.broadside ? 'ERREICHT' : 'NICHT erreicht'}`);
  }
  log(ok ? '\nSIM ARENA OK' : '\nSIM ARENA FEHLGESCHLAGEN');
  process.exit(ok ? 0 : 1);
}

function onShipPad(p) {
  const t = { x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) };
  return W.SHIP_PADS.some((q) => q.x === t.x && q.y === t.y);
}
function losPx(isSolid, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay; const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 8));
  for (let i = 1; i < n; i++) if (isSolid(Math.floor((ax + dx * i / n) / TILE), Math.floor((ay + dy * i / n) / TILE))) return false;
  return true;
}
function log(s) { console.log(s); }

// ---------- Szenario ----------
async function runScenario(n, opts) {
  const seed = opts.seed;
  simRng = makeRng(seed * 7919 + n);
  const odaTexts = [];
  const game = new Game({ noStore: true, seed, env: { MISSION_SOURCE: 'fallback' }, log: VERBOSE ? (...a) => log('  [game] ' + a.join(' ')) : () => {} });
  game.simStats = { reactorRestarts: 0, widescans: 0, wreckDone: false };
  const roles = n === 1 ? ['solo'] : ['captain', 'helm', 'weapons'].slice(0, n);
  const agents = roles.map((r, i) => new Agent(game, i, r, opts));
  game.simAgents = agents;
  const watcher = { send: (o) => {
    if (o.t === 'event' && o.kind === 'oda') { odaTexts.push(o.text); if (VERBOSE) log(`  [ODA ${game.time.toFixed(1)}] ${o.text}`); }
    if (o.t === 'event' && o.kind === 'radio' && VERBOSE) log(`  [Funk ${game.time.toFixed(1)}] ${o.from}: ${o.text}`);
    if (o.t === 'event' && o.kind === 'stage' && VERBOSE) log(`--- Schritt ${o.mission}/${o.stage} @ ${game.time.toFixed(1)} s (${game.ship.scene})`);
  } };
  game.addConnection(watcher);
  watcher.observer = true;
  if (opts.skipDrill) game.lobbyOpts.skipDrill = true;
  for (const a of agents) { game.addConnection(a.conn); a.hello(); }
  let S = game.snapshot();
  let stage = S.mission.stage, stageStart = game.time;
  let softlock = null;
  let snapMax = 0, snapSum = 0, snapN = 0, snapMaxAst = 0;
  let ticks = 0;
  // M2 „Schildwall“: Nach Mission 2 geht die Kampagne mit m3 weiter – die M1/M2-Läufe enden mit „m2 erledigt“.
  const m2Done = () => !!(game.mission.missions.m2 && game.mission.missions.m2.state === 'done');
  while (game.phase !== 'end' && !m2Done() && game.time < MAX_GAME_SEC) {
    game.step(); ticks++;
    if (game.wantsSnapshot()) {
      S = game.snapshot();
      const len = Buffer.byteLength(JSON.stringify(S));
      if (S.space.asteroids || S.world.locations || S.mission.log) snapMaxAst = Math.max(snapMaxAst, len); else snapMax = Math.max(snapMax, len);
      snapSum += len; snapN++;
    }
    for (const a of agents) a.update(S);
    if (VERBOSE && ticks % 450 === 0) {
      const sh = S.ship;
      log(`  [t ${game.time.toFixed(0)} ${S.mission.stage}@${sh.scene}] Hülle ${sh.hull} Reaktor ${sh.reactor.state} Schilde ${sh.shields.current.join('/')} Sys ${Object.entries(sh.systems).filter(([, v]) => v !== 'ok').map(([k, v]) => k + ':' + v).join(',')} Feuer ${sh.fires.length} Lecks ${sh.breaches.length} Gegner ${S.space.enemies.map((e) => e.kind + ' ' + e.hp + ' ' + Math.round(dist(e.x, e.y, sh.x, sh.y)) + '<' + Math.round(norm(Math.atan2(e.y - sh.y, e.x - sh.x) - sh.angle) * 57.3) + '°').join('; ')} v${Math.round(sh.speed)} tv${sh.turnVel} Waffen ${(sh.mounts || []).map((m) => m.id + ':' + m.alloc + '/' + m.charge + (m.charging ? 'L' + m.power : '') + (m.salvo ? 'S' + m.salvo : '')).join(',')} Ziel ${sh.target} Q ${JSON.stringify(sh.repairQueue)} Bots ${S.bots.map((b) => b.task ? b.task.kind : '-').join('/')} Sprung ${sh.jump.dest}:${sh.jump.blockedReason || Math.round(sh.jump.charge * 100) + '%'} Spieler ${S.players.map((p) => p.zone + ':' + (p.console || Math.floor(p.x / 32) + ',' + Math.floor(p.y / 32))).join(' ')}`);
    }
    const key = (S.mission.stage || 'free') + (game.simStats.wreckDone ? '' : (game.ship.scene === 'wrack' ? '+wrack' : ''));
    if (key !== stage) { stage = key; stageStart = game.time; }
    if (game.time - stageStart > SOFTLOCK_SEC) { softlock = stage; break; }
    if (ticks % 3000 === 0) await new Promise((r) => setImmediate(r));
  }
  const notices = {};
  for (const a of agents) for (const t of a.notices) notices[t] = (notices[t] || 0) + 1;
  const ms = game.stats.missions;
  const durM = {};
  for (const id of Object.keys(ms)) durM[id] = ms[id].end != null ? Math.round((ms[id].end - ms[id].start) * 10) / 10 : null;
  const stTimes = Object.entries(game.stats.stages).sort((a, b) => a[1] - b[1]);
  const durations = {};
  for (let i = 0; i < stTimes.length; i++) durations[stTimes[i][0]] = Math.round(((i + 1 < stTimes.length ? stTimes[i + 1][1] : game.stats.elapsed) - stTimes[i][1]) * 10) / 10;
  return {
    players: n, seed, skipDrill: !!opts.skipDrill, wreck: !!opts.wreck, success: game.phase === 'end' || m2Done(), softlock, stageAtEnd: game.mission.state.stage,
    total: Math.round(game.stats.elapsed * 10) / 10, missions: durM, durations, locations: game.locationStats(), errors: game.errors,
    stats: { kills: game.stats.kills, repairs: game.stats.repairs, firesOut: game.stats.firesOut, hits: game.stats.hits, emergencies: game.stats.emergencies },
    sim: game.simStats, discoveries: game.explore.discoveries(),
    flags: game.mission.state.flags, teaser: game.mission.state.teaser && { source: game.mission.state.teaser.source, title: game.mission.state.teaser.title },
    snapshot: { maxBytes: snapMax, maxBytesFull: snapMaxAst, avgBytes: Math.round(snapSum / Math.max(1, snapN)) },
    notices, odaCount: odaTexts.length, odaTooLong: [...new Set(odaTexts.filter((t) => t.length > 120))], hull: Math.round(game.ship.hull), marks: game.inventory.marks,
    inventory: { ersatzteil: game.inventory.ersatzteil, flickblech: game.inventory.flickblech },
  };
}

function printResult(r) {
  log(`\n=== ${r.players} Spieler (Seed ${r.seed})${r.skipDrill ? ' – Hafen-Übung übersprungen' : ''}${r.wreck ? ' – mit Wrack-Abstecher' : ''} ===`);
  log(`Erfolg: ${r.success ? 'JA' : 'NEIN'}${r.softlock ? `  – SOFTLOCK in „${r.softlock}“ (> ${SOFTLOCK_SEC} s)` : ''}${!r.success && !r.softlock ? `  – Ende in Schritt ${r.stageAtEnd}` : ''}`);
  log(`Gesamt: ${r.total} s Spielzeit (${(r.total / 60).toFixed(1)} min, Bot-Spieler – Menschen brauchen länger)`);
  log('Missionen (s): ' + Object.entries(r.missions).map(([k, v]) => `${k} ${v == null ? '—' : v + ' (' + (v / 60).toFixed(1) + ' min)'}`).join(' · '));
  log('Dauer je Schritt (s): ' + Object.entries(r.durations).map(([k, v]) => `${k} ${v}`).join(' · '));
  log('Zeit je Ort (s): ' + Object.entries(r.locations).map(([k, v]) => `${k} ${v}`).join(' · '));
  log(`Server-Fehlerzähler: ${r.errors}`);
  log(`Statistik: Abschüsse ${r.stats.kills}, Reparaturen ${r.stats.repairs}, Feuer gelöscht ${r.stats.firesOut}, Treffer ${r.stats.hits}, Notfälle ${r.stats.emergencies} · Entdeckungen ${r.discoveries.found}/${r.discoveries.total} · Reaktor-Neustarts ${r.sim.reactorRestarts} · Liftfahrten ${r.sim.liftRides || 0}${r.wreck ? ' · Wrack ' + (r.sim.wreckDone ? 'erledigt (' + Math.round(r.sim.wreckTime || 0) + ' s unten/oben)' : 'NICHT erledigt') : ''}`);
  log(`Flags: ${JSON.stringify(r.flags)} · Teaser: ${r.teaser ? `${r.teaser.title} [${r.teaser.source}]` : '—'}`);
  log(`Snapshot: max ${r.snapshot.maxBytes} B normal / ${r.snapshot.maxBytesFull} B mit Asteroiden/Ortsliste, Ø ${r.snapshot.avgBytes} B`);
  log(`Ende: Hülle ${r.hull}, Marken ${r.marks}, Ersatzteile ${r.inventory.ersatzteil}, Flickbleche ${r.inventory.flickblech}, ODA-Texte ${r.odaCount}`);
  if (r.odaTooLong.length) log('ODA-Texte > 120 Zeichen: ' + r.odaTooLong.map((t) => t.length + ': ' + t).join(' | '));
  const top = Object.entries(r.notices).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (top.length) log('Häufigste Notices: ' + top.map(([t, c]) => `${c}× „${t}“`).join(' | '));
}

(async () => {
  if (args.includes('arena')) { await arenaMain(); return; }
  const onlyM3 = args.includes('m3');
  const runs = onlyM3 ? [] : (counts.length ? counts : [1, 3, 'skip']);
  let ok = true;
  if (onlyM3 || !counts.length) {
    const r = await runKesh({ seed: seedArg != null ? seedArg : 31 });
    printKesh(r);
    if (!r.success || r.errors > 0 || r.combat.offBoxHits > 0 || r.combat.maxStuck > 8 || r.snapMax >= 12 * 1024) ok = false;
  }
  for (const run of runs) {
    const skip = run === 'skip';
    const n = skip ? 1 : run;
    const seed = seedArg != null ? seedArg : (skip ? 17 : n === 1 ? 11 : 23);
    const base = skip ? { seed, grauzahn: 'bribe', decision: 'deliver', skipDrill: true, wreck: true, sela: 'search', parley: 'share' }
      : n === 1 ? { seed, grauzahn: 'fight', decision: 'deliver', sela: 'search', parley: 'bluff' } : { seed, grauzahn: 'bribe', decision: 'decode', sela: 'buy', parley: 'bluff' };
    if (WRECK) base.wreck = true;
    base.pilot = PILOT && PILOT !== 'both' ? PILOT : 'maneuver';
    const r = await runScenario(n, base);
    printResult(r);
    if (!r.success || r.errors > 0 || r.snapshot.maxBytesFull >= 12 * 1024) ok = false;
    if (r.wreck && !r.sim.wreckDone) ok = false;
  }
  log(ok ? '\nSIM OK' : '\nSIM FEHLGESCHLAGEN');
  process.exit(ok ? 0 : 1);
})();
