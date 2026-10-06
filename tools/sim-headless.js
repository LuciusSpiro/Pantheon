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
let simRng = makeRng(1);

const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const WRECK = args.includes('--wreck');
const seedArg = args.indexOf('--seed') >= 0 ? Number(args[args.indexOf('--seed') + 1]) : null;
const counts = args.filter((a, i) => /^[123]$/.test(a) && args[i - 1] !== '--seed').map(Number);
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
  send(msg) { this.game.handleMessage(this.conn, msg); }
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
    const set = new Set(goals.map((g) => g.y * map.w + g.x));
    const path = bfs(walk, st, (x, y) => set.has(y * map.w + x) && walk(x, y), map.w, map.h);
    if (!path) { this.input(0, 0); return 'fail'; }
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
    const ch = { helm: 'H', captain: 'C', weapons: 'W', transfer: 'T', shop: 'S', plan: 'Y' }[kind];
    return Maps.ship.find(ch)[0];
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
    return false;
  }
  leave(S) { const p = this.me(S); if (p.console) this.send({ t: 'leave' }); }

  repair(S, p, sys) {
    const st = S.ship.systems[sys];
    if (st === 'ok' || st === 'offline') return 'done';
    if (p.zone !== 'ship') return 'skip';
    if (p.console) { this.send({ t: 'leave' }); return 'running'; }
    if (st === 'broken' && p.carry !== 'ersatzteil') {
      if (S.inventory.ersatzteil <= 0) return 'skip';
      if (p.carry) { this.send({ t: 'drop' }); return 'running'; }
      const shelf = Number(Object.keys(Maps.SHELVES).find((x) => Maps.SHELVES[x] === 'ersatzteil'));
      this.interact(S, shelf, 1, {});
      return 'running';
    }
    const t = Maps.ship.find({ reactor: 'R', engines: 'E', shields: 'G', weapons: 'K', life: 'O', transfer: 'X' }[sys])[0];
    const before = st;
    const r = this.interact(S, t.x, t.y, { hold: true, until: (S2) => S2.ship.systems[sys] !== before });
    if (r === 'fail') this.waitT = 0.3;
    return 'running';
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
    const turn = clamp(diff * 2.5, -1, 1);
    const targetSpeed = Math.min(maxSpd || 120, Math.max(0, (gd - arriveDist) * 0.6));
    const fwd = sh.vx * Math.cos(sh.angle) + sh.vy * Math.sin(sh.angle);
    let thrust = 0;
    if (Math.abs(diff) > 1.2) thrust = fwd > 25 ? -0.6 : 0.15;
    else thrust = fwd < targetSpeed - 5 ? 1 : (fwd > targetSpeed + 5 ? -1 : 0);
    this.helm(turn, thrust);
    return gd <= arriveDist;
  }
  brake(S) {
    const sh = S.ship;
    const fwd = sh.vx * Math.cos(sh.angle) + sh.vy * Math.sin(sh.angle);
    if (Math.abs(fwd) < 4 && sh.speed < 8) { this.helm(0, 0); return true; }
    this.helm(0, fwd > 0 ? -1 : 1);
    return false;
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
    if (sh.docked) { this.helm(0, 1); return; }
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
  fight(S, opts) {
    const sh = S.ship;
    const enemies = S.space.enemies;
    if (!enemies.length) return;
    const mounts = Object.fromEntries(sh.mounts.map((m) => [m.id, m]));
    const inArc = (m, e) => m && Physics.inArc(sh.x, sh.y, sh.angle, m.facing, m.arc, m.range, e.x, e.y);
    const anyArc = (e) => inArc(mounts.phase_l, e) || inArc(mounts.phase_r, e);
    let target = enemies.find((e) => anyArc(e)) || enemies.slice().sort((a, b) => dist(a.x, a.y, sh.x, sh.y) - dist(b.x, b.y, sh.x, sh.y))[0];
    if (sh.target !== target.id) { this.cmd('weapons.target', { id: target.id }); return; }
    // Scan vorab (Taktik-Rolle): zeigt Schilde/Feuerbögen
    if (opts && opts.scan && !target.scanned && dist(target.x, target.y, sh.x, sh.y) < 780 && (this.memo.scanUntil || 0) < S.time + 10) {
      this.scanT -= DT; if (this.scanT <= 0) { this.scanT = 0.3; this.cmd('weapons.scan', { on: true }); }
    }
    if ((mounts.phase_l.charge >= 1 && inArc(mounts.phase_l, target)) || (mounts.phase_r.charge >= 1 && inArc(mounts.phase_r, target))) this.cmd('weapons.fire', { mount: 'both' });
    else if (mounts.bolzen && mounts.bolzen.loaded > 0 && mounts.bolzen.charge >= 1 && inArc(mounts.bolzen, target)) this.cmd('weapons.fire', { mount: 'bolzen' });
  }
  aimHelm(S, e, standoff) {
    const sh = S.ship;
    if (!e) { this.brake(S); return; }
    const d = dist(sh.x, sh.y, e.x, e.y);
    const diff = norm(Math.atan2(e.y - sh.y, e.x - sh.x) - sh.angle);
    const fwd = sh.vx * Math.cos(sh.angle) + sh.vy * Math.sin(sh.angle);
    let thrust = 0;
    if (d > (standoff || 420) && Math.abs(diff) < 0.6) thrust = fwd < 60 ? 0.6 : 0;
    else thrust = fwd > 20 ? -1 : (fwd < -5 ? 0.4 : 0);
    this.helm(clamp(diff * 2.5, -1, 1), thrust);
  }
  nearestEnemy(S) { const sh = S.ship; let e = null, ed = Infinity; for (const o of S.space.enemies) { const d = dist(sh.x, sh.y, o.x, o.y); if (d < ed) { ed = d; e = o; } } return e; }

  // Kampf je Rolle (solo: Taktik feuert, kurz ans Steuer, wenn nichts im Bogen)
  combat(S, p) {
    const sh = S.ship;
    if (this.role === 'solo') {
      const e = this.nearestEnemy(S);
      if (!e) return;
      const inAny = sh.mounts.some((m) => m.id.startsWith('phase') && Physics.inArc(sh.x, sh.y, sh.angle, m.facing, m.arc - 10, m.range, e.x, e.y));
      if (!inAny) this.memo.offArc = (this.memo.offArc || 0) + DT; else this.memo.offArc = 0;
      if (this.memo.turning || this.memo.offArc > 3) {
        this.memo.turning = true;
        if (!this.enter(S, 'helm')) return;
        const diff = norm(Math.atan2(e.y - sh.y, e.x - sh.x) - sh.angle);
        this.aimHelm(S, e, e.kind === 'pylon' || e.kind === 'relay' ? 380 : 450);
        if (Math.abs(diff) < 0.12 && dist(sh.x, sh.y, e.x, e.y) < 520) { this.helm(0, 0); this.memo.turning = false; this.memo.offArc = 0; }
        if ((this.memo.turnT = (this.memo.turnT || 0) + DT) > 12) { this.memo.turning = false; this.memo.turnT = 0; this.memo.offArc = 0; }
        return;
      }
      this.memo.turnT = 0;
      if (this.enter(S, 'weapons')) this.fight(S);
      return;
    }
    if (this.role === 'weapons') {
      if (sh.systems.weapons !== 'ok' && sh.systems.weapons !== 'offline' && this.repair(S, p, 'weapons') !== 'skip') return;
      if (this.enter(S, 'weapons')) this.fight(S, { scan: true });
      return;
    }
    if (this.role === 'helm') {
      if (!this.enter(S, 'helm')) return;
      const e = this.nearestEnemy(S);
      this.aimHelm(S, e, e && (e.kind === 'pylon' || e.kind === 'relay') ? 380 : 450);
      if (S.space.projectiles.some((q) => (q.kind === 'enemy' || q.kind === 'emp') && dist(q.x, q.y, sh.x, sh.y) < 90) && sh.dodgeCd === 0 && (this.memo.dodgeAt || 0) < S.time) { this.memo.dodgeAt = S.time + 1; this.cmd('helm.dodge', { dir: simRng() < 0.5 ? -1 : 1 }); }
      return;
    }
    if (this.role === 'captain') {
      if (!this.enter(S, 'captain')) return;
      if ((this.memo.shieldAt || 0) < S.time && S.space.enemies.length) {
        this.memo.shieldAt = S.time + 2;
        const e = this.nearestEnemy(S);
        const sec = Physics.sectorOf(sh.x, sh.y, sh.angle, e.x, e.y);
        const al = sh.shields.alloc;
        const donor = [0, 1, 2, 3].filter((i) => i !== sec && al[i] > 0).sort((a, b) => al[b] - al[a])[0];
        if (al[sec] < 4 && donor != null) { this.cmd('captain.shield', { sector: donor, delta: -1 }); this.cmd('captain.shield', { sector: sec, delta: 1 }); }
      }
    }
  }

  shootDrones(S) {
    const p = this.me(S);
    if (p.zone !== 'away' || p.downed) return false;
    const walkSolid = (x, y) => !this.walkable(S, 'away')(x, y);
    let best = null, bd = 190;
    for (const d of S.away.drones) {
      if (!d.alive) continue;
      const dd = dist(p.x, p.y, d.x, d.y);
      if (dd < bd && losPx(walkSolid, p.x, p.y - 10, d.x, d.y - 8)) { bd = dd; best = d; }
    }
    if (!best) return false;
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
    const r = this.interact(S, 2, 1, { hold: true, max: 30, until: (S2) => S2.ship.reactor.state !== 'offline' });
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
      this.interact(S, 9, 1, {});
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
      this.interact(S, 10, 1, {});
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
    if (p.carry && !drillOpen && !this.actDown) { const shelf = Number(Object.keys(Maps.SHELVES).find((x) => Maps.SHELVES[x] === p.carry)); this.interact(S, shelf, 1, {}); return; }
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
      if (S.space.enemies.length && near) { this.aimHelm(S, this.nearestEnemy(S), 9999); return; }
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
      if (p.console) { this.leave(S); return; }
      if (sh.systems.transfer === 'broken' || sh.systems.transfer === 'offline') { this.input(0, 0); return; }
      // Schiff driftet (unbesetzte Steuer hält Kurs/Tempo): erst zurück zur Boje und anhalten
      const b = this.station(S);
      if ((this.role === 'solo' || this.role === 'helm') && (dist(sh.x, sh.y, b.x, b.y) > 260 || sh.speed > 8)) {
        if (this.enter(S, 'helm')) { if (dist(sh.x, sh.y, b.x, b.y) > 200) this.steer(S, b.x - 150, b.y, 30, 90); else this.brake(S); }
        return;
      }
      if ((this.role === 'solo' || this.role === 'helm') && !S.away.active && !p.carry && S.inventory.medipack > 0 && S.away.npc.injured) { this.interact(S, 12, 1, {}); return; }
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
      this.interact(S, Math.floor(core.x / TILE), Math.floor(core.y / TILE), { floor: true });
      return;
    }
    this.returnToPads(S, p, npc.following === this.pid ? npc : null);
  }
  onMyPad(S, p) {
    const pads = Maps.ship.find('P'); const myPad = pads[this.idx % 3];
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
      if (!atWp || sh.speed > 12) { if (this.enter(S, 'helm')) { if (sh.docked) { this.helm(0, 1); return; } if (!atWp) this.steer(S, wp.x, wp.y, 60, 120); else this.brake(S); } return; }
      if (!this.enter(S, 'weapons')) return;
      const r = tac();
      if (r === 'wait' && !probe && m.pScanned === m.pwp) m.pwp++;
      return;
    }
    if (this.role === 'helm') { if (this.enter(S, 'helm')) { if (sh.docked) { this.helm(0, 1); return; } if (!atWp) this.steer(S, wp.x, wp.y, 60, 120); else this.brake(S); } return; }
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

function onShipPad(p) {
  const t = { x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) };
  return Maps.ship.find('P').some((q) => q.x === t.x && q.y === t.y);
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
      log(`  [t ${game.time.toFixed(0)} ${S.mission.stage}@${sh.scene}] Hülle ${sh.hull} Reaktor ${sh.reactor.state} Schilde ${sh.shields.current.join('/')} Sys ${Object.entries(sh.systems).filter(([, v]) => v !== 'ok').map(([k, v]) => k + ':' + v).join(',')} Feuer ${sh.fires.length} Lecks ${sh.breaches.length} Gegner ${S.space.enemies.map((e) => e.kind + ' ' + e.hp + ' ' + Math.round(dist(e.x, e.y, sh.x, sh.y))).join('; ')} Sprung ${sh.jump.dest}:${sh.jump.blockedReason || Math.round(sh.jump.charge * 100) + '%'} Spieler ${S.players.map((p) => p.zone + ':' + (p.console || Math.floor(p.x / 32) + ',' + Math.floor(p.y / 32))).join(' ')}`);
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
  log(`Statistik: Abschüsse ${r.stats.kills}, Reparaturen ${r.stats.repairs}, Feuer gelöscht ${r.stats.firesOut}, Treffer ${r.stats.hits}, Notfälle ${r.stats.emergencies} · Entdeckungen ${r.discoveries.found}/${r.discoveries.total} · Reaktor-Neustarts ${r.sim.reactorRestarts}${r.wreck ? ' · Wrack ' + (r.sim.wreckDone ? 'erledigt (' + Math.round(r.sim.wreckTime || 0) + ' s unten/oben)' : 'NICHT erledigt') : ''}`);
  log(`Flags: ${JSON.stringify(r.flags)} · Teaser: ${r.teaser ? `${r.teaser.title} [${r.teaser.source}]` : '—'}`);
  log(`Snapshot: max ${r.snapshot.maxBytes} B normal / ${r.snapshot.maxBytesFull} B mit Asteroiden/Ortsliste, Ø ${r.snapshot.avgBytes} B`);
  log(`Ende: Hülle ${r.hull}, Marken ${r.marks}, Ersatzteile ${r.inventory.ersatzteil}, Flickbleche ${r.inventory.flickblech}, ODA-Texte ${r.odaCount}`);
  if (r.odaTooLong.length) log('ODA-Texte > 120 Zeichen: ' + r.odaTooLong.map((t) => t.length + ': ' + t).join(' | '));
  const top = Object.entries(r.notices).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (top.length) log('Häufigste Notices: ' + top.map(([t, c]) => `${c}× „${t}“`).join(' | '));
}

(async () => {
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
    const r = await runScenario(n, base);
    printResult(r);
    if (!r.success || r.errors > 0 || r.snapshot.maxBytesFull >= 12 * 1024) ok = false;
    if (r.wreck && !r.sim.wreckDone) ok = false;
  }
  log(ok ? '\nSIM OK' : '\nSIM FEHLGESCHLAGEN');
  process.exit(ok ? 0 : 1);
})();
