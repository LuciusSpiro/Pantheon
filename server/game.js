'use strict';
// Spielzustand, Spielerverwaltung, Nachrichten, Tick (30 Hz) und Snapshot (§5.3 + CONTRACT-M1 §10). Maßgeblich (autoritativ).
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const Locations = require('../shared/locations.js');
const W = require('./world.js');
const interior = require('./sim/interior.js');
const space = require('./sim/space.js');
const bots = require('./sim/bots.js');
const away = require('./sim/away.js');
const combat = require('./sim/combat.js');
const arena = require('./sim/arena.js');
const shop = require('./sim/shop.js');
const onboard = require('./sim/onboard.js');
const { Explore } = require('./sim/explore.js');
const { Mission } = require('./sim/mission.js');
const generator = require('./mission/generator.js');
const store = require('./store.js');
const { makeRng, clamp, r1, r2, r3, f2 } = require('./util.js');

const SERVER_VERSION = '0.2.0';
const CMD_CONSOLE = { helm: 'helm', captain: 'captain', weapons: 'weapons', transfer: 'transfer', shop: 'shop', deco: 'quartier', quartier: 'quartier', sonde: 'sonde', plan: 'plan' };

class Game {
  constructor(opts) {
    const o = opts || {};
    this.C = CONFIG;
    this.debug = !!o.debug;
    this.env = o.env || process.env;
    this.logFn = o.log || ((...a) => console.log('[game]', ...a));
    this.storeDisabled = !!o.noStore;
    this.fixedSeed = o.seed;
    this.world = W;
    this.transfer = away;
    this.conns = new Set();
    this.players = [];
    this.errors = 0;
    this.errorLog = {};
    this.idCounter = 0;
    this.runCounter = 0;
    this.roomCode = typeof o.roomCode === 'string' && o.roomCode ? o.roomCode.toUpperCase() : null;
    this.lobbyOpts = { skipDrill: false, startMission: 'm1' };
    this.reset();
  }

  // ---------- Zustand ----------
  reset() {
    const C = this.C;
    this.phase = 'lobby';
    this.tick = 0; this.time = 0; this.snapCount = 0; this.emptyFor = 0;
    this.seed = this.fixedSeed != null ? this.fixedSeed : (Date.now() & 0x7fffffff);
    this.rng = makeRng(this.seed);
    this.god = false;
    this.flags = {};
    this.odaSeen = new Set();
    this.scans = new Set();
    this.inventory = Object.assign({ loeschgelCharges: 0, marks: C.economy.startMarks, deko: [], tafel: 0 }, JSON.parse(JSON.stringify(C.economy.startInventory)));
    this.upgrades = { seitenturm: false, schildpool: false, schrauber3: false, bolzenwerfer: false };
    this.deco = {};
    for (const b of W.Maps.BEDS) for (const s of b.slots) this.deco[s.id] = null;
    this.quarters = JSON.parse(JSON.stringify(C.quarters.defaults));
    this.plan = { pins: [], seq: 0 };
    this.ivo = null;
    this.support = { sensor: 0, strike: 0, supply: 0, recall: 0, kuppel: 0 };
    this.stats = { elapsed: 0, kills: 0, repairs: 0, firesOut: 0, hits: 0, emergencies: 0, playTimeStart: 0, stages: {}, missions: {}, locations: {} };
    this.ship = {
      scene: Locations.START, docked: true, dockedAt: Locations.START, dockArmed: false, x: 0, y: 0, angle: 0, vx: 0, vy: 0, speed: 0,
      hull: C.ship.hull, hullMax: C.ship.hull, o2: C.o2.max, alert: 'normal',
      helm: { turn: 0, thrust: 0, manned: false },
      power: Object.assign({}, C.power.default), reactor: { state: 'online', output: C.power.reactor, used: 8, overloadLeft: 0, switches: { A: false, B: false }, restartProgress: 0 },
      reactorCtl: { state: 'online', overloadLeft: 0, warned: false, switches: { A: false, B: false }, restartProgress: 0, aloneT: 0, offlineT: 0, needBot: null },
      heat: { engines: 0, shields: 0, weapons: 0, life: 0 },
      shields: { pool: 4, alloc: C.shields.default.slice(), current: C.shields.default.slice(), regenT: 0 },
      systems: { reactor: 'ok', engines: 'ok', shields: 'ok', weapons: 'ok', life: 'ok', transfer: 'ok' },
      offline: {},
      fireList: [], breachList: [], groundItems: [],
      dodgeCd: 0, jump: { dest: null, charge: 0, ready: false, blockedReason: null },
      mount: { phase_l: { charge: 1 }, phase_r: { charge: 1 }, bolzen: { loaded: C.weapons.bolzen.magazine, reloadT: null, shotT: 0 }, seitenturm: { charge: 0 } },
      target: null, priority: null, scan: { progress: 0, done: false }, scanning: false, scanAt: 0,
      tscan: { targetId: null, progress: 0, on: false, at: 0 }, widescan: { cd: 0, pulseAt: -99 },
      markers: { captain: null, tactical: null },
      noPartT: {}, noPlateT: 0, asteroidImmune: {}, beaming: null, sysHitAt: {},
    };
    this.space = { w: 0, h: 0, enemies: [], projectiles: [], beams: [], asteroids: [], markers: [], salvage: [] };
    this.salvaged = 0;
    this.arena = null;   // Testgelände (server/sim/arena.js), nur bei Lobby-Start arena_space/arena_away
    this.explore = new Explore(this);
    this.aways = { platform: away.makeAway(this), wreck: away.makeWreck(this), kesh: away.makeKesh(this) };
    this.away = this.aways.platform;
    this.mission = new Mission(this);
    space.enterScene(this, Locations.START, { docked: true });
    this.bots = [];
    bots.ensureBotCount(this);
    this.asteroidsDirty = true;
    this.sentExploreVersion = -1; this.sentLogVersion = -1;
    this.runId = null;
    for (const p of this.players) this.resetPlayer(p, this.players.indexOf(p));
  }

  setAwayMap(id) { if (this.aways[id] && this.away !== this.aways[id]) this.away = this.aways[id]; }

  resetPlayer(p, idx) {
    const sp = W.Maps.SHIP_SPAWNS[idx % W.Maps.SHIP_SPAWNS.length];
    const c = W.tileCenter(sp.x, sp.y);
    Object.assign(p, { zone: 'ship', x: c.x, y: c.y, dir: 'down', moving: false, console: null, carry: null, carryCharges: 0,
      hp: this.C.player.hp, downed: false, downedFor: 0, hold: null, beamLock: false, actDown: false,
      gear: { werkzeuggurt: false }, input: { mx: 0, my: 0 }, shootReadyAt: 0,
      shield: null, wound: false, bleed: null, medkit: 0, cv: 0, fl: false, crouch: false });
  }

  nextId(prefix) { return prefix + (++this.idCounter); }
  playerById(id) { return this.players.find((p) => p.id === id); }

  // ---------- Ausgabe ----------
  broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const c of this.conns) {
      if (!c.player && !c.observer) continue;
      try { c.sendRaw ? c.sendRaw(s) : c.send(obj); } catch (e) { this.countError('send', e); }
    }
  }
  sendTo(conn, obj) { try { conn.send(obj); } catch (e) { this.countError('send', e); } }
  emit(kind, data) { this.broadcast(Object.assign({ t: 'event', kind }, data)); }
  notice(p, text) {
    const msg = { t: 'event', kind: 'notice', pid: p.id, text };
    if (p.conn) this.sendTo(p.conn, msg);
  }
  oda(text, onceKey) {
    if (onceKey) { if (this.odaSeen.has(onceKey)) return; this.odaSeen.add(onceKey); }
    this.emit('oda', { text });
    this.emit('sfx', { name: 'oda_blip' });
  }
  missionEvent(name, data) {
    try { this.mission.onEvent(name, data || {}); } catch (e) { this.countError('mission-event', e); }
  }
  log(...a) { this.logFn(...a); }

  countError(where, err) {
    this.errors++;
    const now = Date.now();
    const last = this.errorLog[where] || 0;
    if (now - last > 2000) { this.errorLog[where] = now; console.warn(`[game] Fehler in ${where} (gesamt ${this.errors}):`, err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err); }
  }
  safe(where, fn) { try { fn(); } catch (e) { this.countError(where, e); } }

  // ---------- Verbindungen ----------
  addConnection(conn) { this.conns.add(conn); conn.player = null; }

  removeConnection(conn) {
    this.conns.delete(conn);
    const p = conn.player;
    if (!p || p.conn !== conn) return;
    p.conn = null; p.connected = false;
    p.input.mx = 0; p.input.my = 0; p.actDown = false; p.hold = null;
    if (p.console) interior.leaveConsole(this, p);
    if (this.phase === 'lobby') {
      this.players = this.players.filter((o) => o !== p);
      this.checkLobbyStart();
    } else if (p.zone === 'away') {
      if (p.carry) interior.dropCarry(this, p);
      interior.placeOnShipPad(this, p);
      p.beamLock = false;
    }
    this.log(`Spieler ${p.name} getrennt.`);
  }

  handleRaw(conn, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    this.handleMessage(conn, msg);
  }

  handleMessage(conn, msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    try {
      const C = Protocol.C;
      if (msg.t === C.PING) return this.sendTo(conn, { t: 'pong', ts: msg.ts });
      if (msg.t === C.HELLO) return this.onHello(conn, msg);
      const p = conn.player;
      if (!p || p.conn !== conn) return;
      switch (msg.t) {
        case C.READY: if (this.phase === 'lobby') { p.ready = !!msg.ready; this.checkLobbyStart(); } break;
        case C.LOBBY_OPT:
          if (this.phase === 'lobby' && typeof msg.skipDrill === 'boolean' && msg.skipDrill !== this.lobbyOpts.skipDrill) {
            this.lobbyOpts.skipDrill = msg.skipDrill;
            this.log(`${p.name}: Hafen-Übung ${msg.skipDrill ? 'überspringen' : 'spielen'}.`);
          }
          // M2: Direktstart der Planetenmission (CONTRACT-M2 §3.3)
          if (this.phase === 'lobby' && Protocol.START_MISSIONS.includes(msg.startMission) && msg.startMission !== this.lobbyOpts.startMission) {
            this.lobbyOpts.startMission = msg.startMission;
            this.log(`${p.name}: Start ${(Protocol.START_LABELS && Protocol.START_LABELS[msg.startMission]) || msg.startMission}.`);
          }
          break;
        case C.INPUT: {
          if (this.phase === 'lobby') break;
          const mx = Number(msg.mx), my = Number(msg.my);
          p.input.mx = Number.isFinite(mx) ? clamp(mx, -1, 1) : 0;
          p.input.my = Number.isFinite(my) ? clamp(my, -1, 1) : 0;
          if (Number.isFinite(msg.seq)) p.lastSeq = msg.seq;
          break;
        }
        case C.ACT: if (this.phase !== 'lobby') interior.onAct(this, p, !!msg.down); break;
        case C.SHOOT: if (this.phase !== 'lobby') away.shoot(this, p, Number(msg.angle)); break;
        case C.MARK: if (this.phase !== 'lobby') away.setMarker(this, p, Number(msg.x), Number(msg.y)); break;
        case C.DROP: if (this.phase !== 'lobby') interior.onDrop(this, p); break;
        case C.LEAVE: interior.leaveConsole(this, p); break;
        case C.CMD: if (this.phase !== 'lobby') this.onCmd(p, msg); break;
        case C.DEBUG: this.onDebug(p, msg); break;
        default: break;
      }
    } catch (e) { this.countError('message:' + msg.t, e); }
  }

  onHello(conn, msg) {
    const C = this.C;
    if (this.roomCode) {
      const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase().slice(0, 16) : '';
      if (code !== this.roomCode) {
        this.sendTo(conn, { t: 'error', code: Protocol.ERR.BADCODE,
          text: code ? 'Falscher Raumcode – bitte nachfragen und neu eingeben.' : 'Dieser Server braucht einen Raumcode.' });
        return;
      }
    }
    const clientId = typeof msg.clientId === 'string' ? msg.clientId.slice(0, 64) : null;
    const name = typeof msg.name === 'string' ? msg.name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12) : '';
    let p = clientId ? this.players.find((o) => o.clientId === clientId) : null;
    if (!p && conn.player) p = conn.player;
    if (p) {
      if (p.conn && p.conn !== conn) {
        // Gleiche clientId in einem zweiten Tab: alten Tab mit 'full' stilllegen (Client verbindet dann nicht neu),
        // sonst werfen sich beide Tabs endlos gegenseitig raus.
        const old = p.conn; old.player = null;
        this.sendTo(old, { t: 'full', text: 'Das Spiel wurde in einem anderen Tab geöffnet. Dieser Tab ist getrennt – bitte schließen.' });
        try { old.close && old.close(); } catch (e) { /* egal */ }
      }
      p.conn = conn; p.connected = true; conn.player = p;
      if (name) p.name = name;
      this.applyColorWish(p, msg.color);
      this.sendTo(conn, { t: 'welcome', pid: p.id, serverVersion: SERVER_VERSION, debug: this.debug, roomCode: this.roomCode });
      this.sentExploreVersion = -1; this.sentLogVersion = -1;
      this.log(`Spieler ${p.name} wieder verbunden.`);
      return;
    }
    if (this.players.length >= C.maxPlayers) {
      const free = this.players.find((o) => !o.connected);
      if (!free) { this.sendTo(conn, { t: 'full', text: 'Server voll – es sind schon 3 Crewmitglieder an Bord.' }); try { conn.close && conn.close(); } catch (e) { /* egal */ } return; }
      free.clientId = clientId; free.conn = conn; free.connected = true; conn.player = free;
      if (name) free.name = name;
      this.applyColorWish(free, msg.color);
      this.sendTo(conn, { t: 'welcome', pid: free.id, serverVersion: SERVER_VERSION, debug: this.debug, roomCode: this.roomCode });
      this.sentExploreVersion = -1; this.sentLogVersion = -1;
      return;
    }
    const used = new Set(this.players.map((o) => o.id));
    let n = 1; while (used.has('p' + n)) n++;
    p = { id: 'p' + n, clientId, name: name || `Crew ${n}`, color: null, ready: false, connected: true, conn, lastSeq: 0 };
    this.resetPlayer(p, this.players.length);
    this.players.push(p);
    conn.player = p;
    this.applyColorWish(p, msg.color);
    if (this.phase !== 'lobby') {
      p.ready = true;
      this.oda(`${p.name} ist an Bord gekommen. Willkommen in der Schicht!`, null);
    }
    this.sendTo(conn, { t: 'welcome', pid: p.id, serverVersion: SERVER_VERSION, debug: this.debug, roomCode: this.roomCode });
    this.sentExploreVersion = -1; this.sentLogVersion = -1;
    this.log(`Spieler ${p.name} (${p.id}) beigetreten.`);
  }

  applyColorWish(p, wish) {
    const taken = new Set(this.players.filter((o) => o !== p && o.color != null).map((o) => o.color));
    const w = Number.isInteger(wish) && wish >= 0 && wish <= 2 ? wish : null;
    if (w != null && !taken.has(w)) { p.color = w; return; }
    if (p.color != null && !taken.has(p.color)) return;
    for (let c = 0; c < 3; c++) if (!taken.has(c)) { p.color = c; return; }
  }

  checkLobbyStart() {
    if (this.phase !== 'lobby') return;
    const con = this.players.filter((p) => p.connected);
    if (con.length && con.every((p) => p.ready)) this.startGame();
  }

  startGame() {
    this.reset();
    this.phase = 'play';
    this.stats.playTimeStart = this.time;
    this.players.forEach((p, i) => { this.resetPlayer(p, i); p.ready = true; });
    this.runId = 'run-' + Date.now() + '-' + (++this.runCounter);
    const sm = this.lobbyOpts.startMission;
    if (!arena.isArena(sm)) this.explore.arrive(Locations.START);   // Testgelände: keine Hafen-Erstbesuchsansage
    if (sm === 'm3') this.mission.startDirect('m3');
    else if (arena.isArena(sm)) arena.start(this, sm);   // Testgelände Raumkampf / Außenteam
    else this.mission.start();
    this.log(`Partie gestartet mit ${this.players.length} Spieler(n). Seed ${this.seed}.`);
    this.logRun(false);
  }

  endGame(opts) {
    if (this.phase === 'end') return;
    const o = opts || {};
    this.phase = 'end';
    this.stats.elapsed = this.time - this.stats.playTimeStart;
    this.emit('ending', { title: o.title || 'Fortsetzung folgt', text: o.text || null, missions: this.stats.missions });
    this.logRun(true);
  }

  logRun(ended) {
    const t = this.mission.state.teaser;
    const f = this.mission.flags;
    store.logRun({
      id: this.runId, startedAt: new Date(Date.now() - (this.time - this.stats.playTimeStart) * 1000).toISOString(),
      endedAt: ended ? new Date().toISOString() : null, playerCount: this.players.length,
      stats: Object.assign({}, this.stats, { locations: this.locationStats() }), flags: { bribed: f.bribed, decision: f.decision, technikerRescued: f.technikerRescued },
      discoveries: this.explore.discoveries(),
      teaser: t && t.status === 'ready' ? { source: t.source, title: t.title } : null, errors: this.errors,
    }, { disabled: this.storeDisabled });
  }
  locationStats() { const o = {}; for (const [k, v] of Object.entries(this.explore.locTime)) o[k] = Math.round(v); return o; }

  // ---------- Teaser (Claude-Bridge, „Fortsetzung folgt“) ----------
  teaserFlags() {
    const f = this.mission.flags;
    return { bribed: f.bribed, decision: f.decision, technikerRescued: f.technikerRescued };
  }
  startTeaser() {
    const m = this.mission.state;
    if (m.teaser) return;
    m.teaser = { status: 'pending', source: null, title: null, from: null, briefing: null, reward: null };
    const apply = (res) => {
      m.teaser = { status: 'ready', source: res.source, title: res.title, from: res.from, briefing: res.briefing, reward: res.reward, hook: res.hook };
      this.log(`Teaser bereit (${res.source}): ${res.title}`);
    };
    const cfg = generator.settings(this.env);
    if (cfg.source !== 'bridge') { apply(generator.pickFallback(this.teaserFlags())); return; }
    generator.generate(this.teaserFlags(), { env: this.env, log: (s) => this.log(s) }).then(apply).catch((e) => { this.countError('teaser', e); apply(generator.pickFallback(this.teaserFlags())); });
  }
  refreshTeaserForFlags() {
    const t = this.mission.state.teaser;
    if (t && t.status === 'ready' && t.source === 'archiv') {
      const r = generator.pickFallback(this.teaserFlags());
      Object.assign(t, { title: r.title, from: r.from, briefing: r.briefing, reward: r.reward, hook: r.hook });
    }
  }

  // ---------- Befehle ----------
  onCmd(p, msg) {
    const c = typeof msg.c === 'string' ? msg.c : (typeof msg.cmd === 'string' ? msg.cmd : '');   // M2: auch { cmd: '…' }
    // M2 §15: Ducken (Taste C) – ohne Konsole, nur Außenzone auf v2-Karten
    if (c === 'crouch') { const e = combat.setCrouch(this, p, !!msg.on); if (e) this.notice(p, e); return; }
    const [prefix] = c.split('.');
    const need = CMD_CONSOLE[prefix];
    if (!need) return this.notice(p, 'Unbekannter Befehl.');
    if (p.console !== need) return this.notice(p, 'Dafür musst du an der passenden Konsole sein.');
    if (p.downed) return;
    let err = null;
    const ship = this.ship;
    switch (c) {
      case 'helm.input':
        ship.helm.turn = clamp(Number(msg.turn) || 0, -1, 1);
        ship.helm.thrust = clamp(Number(msg.thrust) || 0, -1, 1);
        break;
      case 'helm.dodge': err = space.dodge(this, Number(msg.dir) >= 0 ? 1 : -1); break;
      case 'helm.jump': err = space.doJump(this); break;
      case 'captain.accept': err = this.mission.accept(); break;
      case 'captain.choice': err = this.mission.choice(String(msg.option)); break;
      case 'captain.selectDest': err = space.selectDest(this, String(msg.dest)); break;
      case 'captain.power': err = space.captainPower(this, String(msg.sys), Number(msg.delta)); break;
      case 'captain.shield': err = space.captainShield(this, Number(msg.sector), Number(msg.delta)); if (!err) this.missionEvent('shieldsChanged', {}); break;
      case 'captain.priority': {
        const t = msg.target;
        if (t === null || t === undefined || t === 'fire' || t === 'breach' || Protocol.SYSTEMS.includes(t)) ship.priority = t == null ? null : t;
        else err = 'Unbekannte Priorität.';
        break;
      }
      case 'captain.scan': err = this.mission.scan(p, !!msg.on); break;
      case 'captain.support': err = away.captainSupport(this, String(msg.kind)); break;
      case 'captain.listen': err = this.mission.listen(); break;
      case 'captain.marker': err = space.setMarker(this, 'captain', Number(msg.x), Number(msg.y), !!msg.clear); break;
      case 'captain.overload': err = space.captainOverload(this); break;
      case 'captain.order': err = combat.order(this, msg); break;   // M2: Befehle ans Außenteam
      case 'weapons.target': err = space.weaponsTarget(this, msg.id == null ? null : String(msg.id)); break;
      case 'weapons.fire': err = space.weaponsFire(this, String(msg.mount)); if (!err) this.missionEvent('weaponsFired', {}); break;
      case 'weapons.reload': err = space.weaponsReload(this); break;
      case 'weapons.strike': err = away.weaponsStrike(this); break;
      case 'weapons.scan': err = space.weaponsScan(this, !!msg.on); break;
      case 'weapons.widescan': err = space.weaponsWidescan(this); break;
      case 'weapons.marker':
        if (msg.onTarget) err = space.markerOnTarget(this);
        else err = space.setMarker(this, 'tactical', Number(msg.x), Number(msg.y), !!msg.clear);
        break;
      case 'transfer.down': err = away.consoleBeam(this, p, 'down'); break;
      case 'transfer.up': err = away.consoleBeam(this, p, 'up'); break;
      case 'transfer.recall': err = away.recall(this, msg.pid); break;
      case 'transfer.supply': err = away.supply(this); break;
      case 'shop.buy': err = shop.buy(this, p, String(msg.item)); break;
      case 'deco.place': err = shop.placeDeco(this, p, String(msg.slot), msg.item == null ? null : String(msg.item)); break;
      case 'quartier.style': err = shop.setStyle(this, p, String(msg.part), String(msg.value)); break;
      case 'plan.pin': err = onboard.pin(this, p, msg); break;
      case 'plan.unpin': err = onboard.unpin(this, p, String(msg.id)); break;
      case 'sonde.input': err = away.sondeInput(this, p, String(msg.color)); break;
      default: err = 'Unbekannter Befehl.';
    }
    if (err) this.notice(p, err);
  }

  // Debug/Tests: Schiff an einen Ort versetzen (ohne Sprung). docked nur für Orte mit Liegeplatz.
  debugGoto(loc, docked) {
    if (!Locations.get(loc)) return 'Unbekannter Ort.';
    for (const p of this.players) if (p.zone === 'away') interior.placeOnShipPad(this, p);
    space.enterScene(this, loc, { docked: !!docked });
    this.explore.arrive(loc);
    this.missionEvent('jumped', { scene: loc, loc, debug: true });
    return null;
  }

  onDebug(p, msg) {
    if (!this.debug) return this.notice(p, 'Debug-Befehle sind deaktiviert (Server mit --debug starten).');
    const cmd = msg.cmd;
    let err = null;
    switch (cmd) {
      case 'stage': if (this.phase === 'lobby') this.startGame(); err = this.mission.forceStage(String(msg.stage)); break;
      case 'mission': if (this.phase === 'lobby') this.startGame(); err = this.mission.forceStep(String(msg.id || 'm1'), msg.step ? String(msg.step) : null); break;
      case 'goto': if (this.phase === 'lobby') this.startGame(); err = this.debugGoto(String(msg.loc), !!msg.docked); break;
      case 'reveal': {
        const loc = String(msg.loc);
        if (loc === 'all') { for (const l of Locations.LOCATIONS) this.explore.reveal(l.id, false); this.explore.openLink('nebel-relais'); this.explore.openLink('kesh'); break; }
        if (!Locations.get(loc)) { err = 'Unbekannter Ort.'; break; }
        this.explore.reveal(loc, false);
        if (loc === 'relais') this.explore.openLink('nebel-relais');
        if (loc === 'kesh') this.explore.openLink('kesh');
        break;
      }
      case 'reactor': {
        const st = String(msg.state);
        const rc = this.ship.reactorCtl;
        if (st === 'online') space.reactorOnline(this, 'Debug: Reaktor online.');
        else if (st === 'overload') { rc.state = 'online'; err = space.captainOverload(this); if (Number.isFinite(msg.left)) rc.overloadLeft = Number(msg.left); }
        else if (st === 'offline') { rc.state = 'overload'; rc.overloadLeft = 0; rc.warned = true; }
        else err = 'Zustand: online | overload | offline.';
        break;
      }
      case 'scanall': {
        for (const e of this.space.enemies) e.scanned = true;
        for (const h of this.explore.hiddenHere()) if (!this.explore.isRevealed(h.id)) this.explore.revealHidden(h, true);
        break;
      }
      case 'damage': {
        const sys = String(msg.system);
        if (!this.ship.systems[sys]) { err = 'Unbekanntes System.'; break; }
        const st = ['ok', 'damaged', 'broken', 'offline'].includes(msg.state) ? msg.state : null;
        if (st === 'ok') { this.ship.systems[sys] = 'ok'; delete this.ship.offline[sys]; }
        else if (st === 'offline') interior.setOffline(this, sys, this.C.emp.offlineTime);
        else interior.damageSystem(this, sys, st);
        break;
      }
      case 'fire': {
        let x = Number(msg.x), y = Number(msg.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) { const t = interior.randomRegionFloor(this, this.rng.int(4), false); x = t.x; y = t.y; }
        if (!interior.addFire(this, x, y)) err = 'Dort kann kein Feuer entstehen.';
        break;
      }
      case 'breach': { const t = interior.randomRegionFloor(this, this.rng.int(4), true); interior.addBreach(this, t.x, t.y); break; }
      case 'spawn': {
        const k = Protocol.ENEMY_KINDS.includes(msg.kind) ? msg.kind : 'raider';
        if (this.ship.docked) { err = 'Nicht angedockt.'; break; }
        space.spawnEnemy(this, k, {});
        break;
      }
      case 'marks': this.inventory.marks = Math.max(0, Math.round(Number(msg.n) || 0)); break;
      case 'inv': {
        const item = String(msg.item);
        if (!['ersatzteil', 'loeschgel', 'flickblech', 'bolzen', 'medipack', 'tafel'].includes(item)) { err = 'Unbekannter Gegenstand.'; break; }
        this.inventory[item] = Math.max(0, Math.min(99, Math.round(Number(msg.n) || 0)));
        if (item === 'loeschgel') this.inventory.loeschgelCharges = 0;
        break;
      }
      case 'hull': this.ship.hull = clamp(Number(msg.n) || 0, 0, this.ship.hullMax); break;
      case 'skip': if (this.phase === 'lobby') this.startGame(); err = this.mission.skip(); break;
      case 'god': this.god = !!msg.on; break;
      case 'tune': case 'kesh': case 'squad': case 'wake': case 'shield': case 'wound': err = this.onDebugM2(p, cmd, msg); break;
      default: err = 'Unbekannter Debug-Befehl.';
    }
    if (err) this.notice(p, err);
  }

  // M2 „Schildwall“: Debug-Befehle (CONTRACT-M2 §8). Argumente als Felder oder als Text in msg.args ('shield.regenDelay 3').
  onDebugM2(p, cmd, msg) {
    const args = typeof msg.args === 'string' ? msg.args.trim().split(/\s+/).filter(Boolean) : (Array.isArray(msg.args) ? msg.args.map(String) : []);
    switch (cmd) {
      case 'tune': {
        const path = msg.path != null ? String(msg.path) : (msg.key != null ? String(msg.key) : args[0]);
        const value = msg.value != null ? msg.value : args[1];
        const r = combat.tune(this, path || null, value);
        this.notice(p, r.text);
        if (r.ok && path) this.log(`tune ${r.text}`);
        return null;
      }
      case 'kesh': {
        if (this.phase === 'lobby') this.startGame();
        const err = this.mission.forceStep('m3', 'courtyard');
        if (err) return err;
        const down = this.players.filter((o) => o.connected && o.zone === 'ship' && o.console !== 'captain');
        for (const o of down) { if (o.console) interior.leaveConsole(this, o); if (o.downed) interior.revivePlayer(this, o); }
        if (down.length) away.executeBeam(this, down.map((o) => o.id), 'down');
        return null;
      }
      case 'squad': {
        if (this.phase === 'lobby') return 'Erst das Spiel starten.';
        const w = String(msg.which != null ? msg.which : (msg.id != null ? msg.id : (msg.n != null ? msg.n : (args[0] || ''))));
        const name = { 1: 'squad1', 2: 'squad2', rear: 'rearguard', squad1: 'squad1', squad2: 'squad2', rearguard: 'rearguard' }[w];
        if (!name) return 'squad 1 | 2 | rear';
        const n = combat.spawnSquad(this, name, { force: true, alert: name === 'squad2' });
        this.notice(p, `Trupp ${name}: ${n} Plünderer.`);
        return null;
      }
      case 'wake': return combat.wakeWarden(this) ? null : 'Kein schlafender Wächter.';
      case 'shield': {
        if (!combat.playerOnV2(this, p)) return 'Nur unten auf Kesh.';
        const n = Number(msg.n != null ? msg.n : args[0]);
        if (!Number.isFinite(n)) return 'shield <n>';
        if (!p.shield) combat.fullShield(this, p);
        if (p.downed) combat.revive(this, p, n); else p.shield.seg = clamp(Math.round(n), 0, p.shield.max);
        return null;
      }
      case 'wound': {
        if (!combat.playerOnV2(this, p)) return 'Nur unten auf Kesh.';
        combat.woundPlayer(this, p, 'debug');
        return null;
      }
      default: return 'Unbekannter Debug-Befehl.';
    }
  }

  // ---------- Tick ----------
  step() {
    const dt = 1 / this.C.tickHz;
    this.tick++;
    this.time += dt;
    const connected = this.players.some((p) => p.connected);
    if (this.phase !== 'lobby') {
      if (!connected) {
        this.emptyFor += dt;
        if (this.emptyFor >= this.C.net.emptyResetAfter) {
          this.log('Alle weg – Partie zurückgesetzt.');
          this.players = [];
          this.reset();
          return;
        }
      } else this.emptyFor = 0;
      this.safe('players', () => interior.updatePlayers(this, dt));
      this.safe('space', () => space.update(this, dt));
      this.safe('hazards', () => interior.updateHazards(this, dt));
      this.safe('bots', () => bots.update(this, dt));
      this.safe('away', () => away.update(this, dt));
      this.safe('explore', () => this.explore.update(dt));
      this.safe('onboard', () => onboard.updateIvo(this, dt));
      this.safe('mission', () => this.mission.update(dt));
      if (this.arena) this.safe('arena', () => arena.update(this, dt));
      this.safe('alert', () => this.updateAlert());
      if (this.phase === 'play') this.stats.elapsed = this.time - this.stats.playTimeStart;
      // Ohne Außenteam folgt der Transfer der Außenkarte des aktuellen Orts
      if (!this.players.some((p) => p.zone === 'away')) { const spot = away.beamSpot(this); if (spot) this.setAwayMap(spot.map); }
    }
  }

  updateAlert() {
    const s = this.ship;
    let level = 'normal';
    const downSys = Object.values(s.systems).some((v) => v === 'broken' || v === 'offline');
    if (s.fireList.length || s.breachList.length || downSys || s.reactorCtl.state === 'offline') level = 'yellow';
    if (this.space.enemies.some((e) => e.kind !== 'relay') || s.hull < 40 || s.o2 < 50) level = 'red';
    if (level !== s.alert) {
      s.alert = level;
      this.emit('alarm', { level });
      if (level !== 'normal') this.emit('sfx', { name: level === 'red' ? 'alarm_red' : 'alarm_yellow' });
    }
  }

  wantsSnapshot() { return this.tick % this.C.net.snapEvery === 0; }

  // ---------- Snapshot (§5.3 + M1 §10) ----------
  snapshot() {
    const C = this.C; const ship = this.ship; const sp = this.space; const aw = this.away;
    this.snapCount++;
    const includeAsteroids = this.asteroidsDirty || this.snapCount % C.net.asteroidSnapEvery === 0;
    this.asteroidsDirty = false;
    // Große, seltene Teile nie im selben Snapshot (Größe < 12 KB): Asteroiden (Slot 0), Ortsliste (Slot 5), Logbuch (Slot 10);
    // bei Änderung sofort bzw. im nächsten freien Snapshot.
    const slot = this.snapCount % C.net.asteroidSnapEvery;
    const includeWorld = (this.sentExploreVersion !== this.explore.version && !includeAsteroids) || slot === 5;
    if (includeWorld) this.sentExploreVersion = this.explore.version;
    const includeLog = (this.sentLogVersion !== this.explore.logVersion && !includeAsteroids && !includeWorld) || slot === 10;
    if (includeLog) this.sentLogVersion = this.explore.logVersion;
    const mount = ship.mount;
    const v2 = combat.isV2Away(aw);
    const mounts = space.mountIds(this).map((id) => {
      const w = C.weapons[id];
      const o = { id, facing: w.facing, arc: w.arc, range: w.range };
      if (id === 'bolzen') {
        const b = mount.bolzen;
        const ch = b.reloadT != null ? b.reloadT / w.reloadTime : (b.loaded > 0 ? 1 - b.shotT / C.combat.bolzenShotDelay : 0);
        o.charge = f2(clamp(ch, 0, 1)); o.ammo = this.inventory.bolzen; o.loaded = b.loaded;
      } else o.charge = f2(mount[id].charge);
      return o;
    });
    const beam = ship.beaming;
    const m = this.mission.state;
    const rc = ship.reactorCtl;
    const spaceOut = {
      w: sp.w, h: sp.h,
      enemies: sp.enemies.map((e) => ({ id: e.id, kind: e.kind, x: r1(e.x), y: r1(e.y), angle: r3(e.angle), hp: r1(e.hp), hpMax: e.hpMax,
        shields: e.shields.map(r1), shieldsMax: e.shieldsMax, scanned: !!e.scanned, weapons: e.scanned ? (C.enemyWeapons[e.kind] || []) : null })),
      projectiles: sp.projectiles.map((q) => ({ id: q.id, kind: q.kind, x: r1(q.x), y: r1(q.y), angle: r3(q.angle) })),
      beams: sp.beams.map((b) => ({ x1: r1(b.x1), y1: r1(b.y1), x2: r1(b.x2), y2: r1(b.y2), ttl: r2(b.ttl), kind: b.kind })),
      markers: sp.markers,
      salvage: (sp.salvage || []).map((s) => ({ id: s.id, x: s.x, y: s.y, kind: s.kind })),
      hidden: this.explore.hiddenSnapshot(),
    };
    if (includeAsteroids) spaceOut.asteroids = sp.asteroids;
    const scanT = this.mission.scanTarget();
    const world = { location: ship.scene };
    if (includeWorld) world.locations = this.explore.locationsSnapshot();
    const missionOut = {
      stage: m.stage, objectives: m.objectives, radio: m.radio, choice: m.choice,
      teaser: m.teaser ? { status: m.teaser.status, source: m.teaser.source, title: m.teaser.title, from: m.teaser.from, briefing: m.teaser.briefing, reward: m.teaser.reward } : null,
      flags: { bribed: m.flags.bribed, decision: m.flags.decision, technikerRescued: m.flags.technikerRescued },
      active: this.mission.activeId ? { id: this.mission.activeId, title: this.mission.def.title, objectives: m.objectives } : null,
      list: this.mission.snapshotList(),
      discoveries: this.explore.discoveries(),
    };
    if (includeLog) missionOut.log = this.explore.log.slice(-30);
    return {
      t: 'snap', tick: this.tick, time: r2(this.time), phase: this.phase,
      lobby: { skipDrill: this.lobbyOpts.skipDrill, startMission: this.lobbyOpts.startMission },
      players: this.players.map((p) => ({
        id: p.id, name: p.name, color: p.color, ready: p.ready, connected: p.connected,
        zone: p.zone, x: r1(p.x), y: r1(p.y), dir: p.dir, moving: p.moving, console: p.console, carry: p.carry,
        hp: Math.round(p.hp), downed: p.downed, downedFor: r1(p.downedFor),
        action: p.hold ? { kind: p.hold.kind, progress: p.hold.kind === 'switch' ? r2(Math.min(1, rc.restartProgress / C.reactorM1.restartTime)) : r2(Math.min(1, p.hold.t / p.hold.dur)) }
          : (beam && beam.pids.includes(p.id) ? { kind: 'beam', progress: r2(Math.min(1, beam.t / beam.dur)) } : null),
        gear: p.gear, lastSeq: p.lastSeq,
        ...combat.playerSnap(this, p),
      })),
      bots: this.bots.map((b) => {
        const tk = b.task && b.task.kind !== 'home' ? b.task : null;
        let task = null;
        if (tk) {
          const kind = tk.phase === 'fetch' ? 'fetch' : tk.kind;
          const tx = tk.phase === 'fetch' ? W.SHELF_TILES.find((s) => s.item === tk.part).x : tk.tx;
          const ty = tk.phase === 'fetch' ? 1 : tk.ty;
          task = { kind, x: tx * 32 + 16, y: ty * 32 + 16 };
        }
        return { id: b.id, variant: b.variant, x: r1(b.x), y: r1(b.y), dir: b.dir, moving: b.moving, carry: b.carry, task, progress: r2(b.progress) };
      }),
      ship: {
        scene: ship.scene, docked: ship.docked, dockedAt: ship.dockedAt, x: r1(ship.x), y: r1(ship.y), angle: r3(ship.angle), vx: r1(ship.vx), vy: r1(ship.vy), speed: r1(ship.speed),
        hull: Math.round(ship.hull * 10) / 10, hullMax: ship.hullMax, o2: r1(ship.o2), alert: ship.alert,
        helm: { turn: ship.helm.turn, thrust: ship.helm.thrust, manned: ship.helm.manned },
        power: ship.power, reactor: ship.reactor,
        heat: { engines: Math.round(ship.heat.engines), shields: Math.round(ship.heat.shields), weapons: Math.round(ship.heat.weapons), life: Math.round(ship.heat.life) },
        shields: { pool: ship.shields.pool, alloc: ship.shields.alloc, current: ship.shields.current },
        systems: ship.systems,
        offline: Object.fromEntries(Object.entries(ship.offline).map(([k, v]) => [k, Math.ceil(v.t)])),
        fires: ship.fireList.map((f) => [f.tx, f.ty]),
        breaches: ship.breachList.map((b) => ({ tx: b.tx, ty: b.ty })),
        groundItems: ship.groundItems.map((i) => ({ id: i.id, kind: i.kind, x: i.x, y: i.y })),
        dodgeCd: r1(ship.dodgeCd),
        jump: { dest: ship.jump.dest, charge: f2(ship.jump.charge), ready: ship.jump.ready, blockedReason: ship.jump.blockedReason },
        mounts, target: ship.target, priority: ship.priority,
        scan: { progress: r2(ship.scan.progress), done: ship.scan.done, target: scanT ? { id: scanT.id, label: scanT.label, x: scanT.x, y: scanT.y, range: scanT.range } : null },
        markers: ship.markers,
        tscan: { targetId: ship.tscan.targetId, progress: r2(ship.tscan.progress) },
        widescan: { cd: r1(ship.widescan.cd), pulseAt: ship.widescan.pulseAt },
        npcs: onboard.npcsSnapshot(this),
      },
      space: spaceOut,
      away: {
        map: aw.map, active: aw.active,
        drones: aw.drones.map((d) => { const o = { id: d.id, kind: d.kind, x: r1(d.x), y: r1(d.y), hp: d.hp, dir: d.dir, revealed: d.revealed, alive: d.alive }; return v2 ? combat.droneSnap(this, d, o) : o; }),
        projectiles: aw.projectiles.map((q) => ({ id: q.id, kind: q.kind, x: r1(q.x), y: r1(q.y), angle: r3(q.angle) })),
        npc: { x: r1(aw.npc.x), y: r1(aw.npc.y), dir: aw.npc.dir, following: aw.npc.following, rescued: aw.npc.rescued, present: aw.npc.present, injured: aw.npc.injured },
        items: aw.items.map((i) => ({ id: i.id, kind: i.kind, x: i.x, y: i.y })),
        marker: aw.marker, strikes: aw.strikes.map((s) => ({ x: s.x, y: s.y, t: r2(s.t) })),
        sonde: { disabled: aw.sonde.disabled, symbols: aw.sonde.symbols, entered: aw.sonde.entered, lockout: r1(aw.sonde.lockout) },
        codeTable: aw.codeTable, odaCodeHelp: aw.odaCodeHelp, kuppelUntil: r2(aw.kuppelUntil), sensorUntil: r2(aw.sensorUntil), doorOpen: aw.doorOpen, coreRebooted: aw.coreRebooted,
        salvage: aw.salvage.map((s) => ({ x: s.x, y: s.y, done: s.done })),
        hollow: aw.hollow ? { x: aw.hollow.x, y: aw.hollow.y, marked: aw.hollow.marked, open: aw.hollow.open } : null,
        ...combat.awaySnap(this, aw),
      },
      support: { sensor: r1(this.support.sensor), strike: r1(this.support.strike), supply: r1(this.support.supply), recall: r1(this.support.recall), kuppel: r1(this.support.kuppel) },
      inventory: {
        ersatzteil: this.inventory.ersatzteil, loeschgel: this.inventory.loeschgel, loeschgelCharges: this.inventory.loeschgelCharges,
        flickblech: this.inventory.flickblech, bolzen: this.inventory.bolzen, medipack: this.inventory.medipack, marks: this.inventory.marks, deko: this.inventory.deko, tafel: this.inventory.tafel || 0,
      },
      upgrades: this.upgrades,
      deco: this.deco,
      quarters: this.quarters,
      plan: { seated: onboard.seated(this), pins: this.plan.pins },
      world,
      shopContext: shop.shopContext(this),
      mission: missionOut,
      stats: { elapsed: r1(this.stats.elapsed), kills: this.stats.kills, repairs: this.stats.repairs, firesOut: this.stats.firesOut, hits: this.stats.hits,
        emergencies: this.stats.emergencies, playTimeStart: r2(this.stats.playTimeStart), stages: this.stats.stages, missions: this.stats.missions, locations: this.locationStats() },
      errors: this.errors,
    };
  }
}

module.exports = { Game, SERVER_VERSION };
