'use strict';
// Spielzustand, Spielerverwaltung, Nachrichten, Tick (30 Hz) und Snapshot (§5.3 + CONTRACT-M1 §10). Maßgeblich (autoritativ).
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const Locations = require('../shared/locations.js');
const W = require('./world.js');
const interior = require('./sim/interior.js');
const space = require('./sim/space.js');
const bots = require('./sim/bots.js');
const damage = require('./sim/damage.js');   // M3b §4: Schild- und Schadenslogik, Eskalation, Rückschlag, Reaktor-Autostart
const away = require('./sim/away.js');
const combat = require('./sim/combat.js');
const arena = require('./sim/arena.js');
const shop = require('./sim/shop.js');
const onboard = require('./sim/onboard.js');
const { Explore } = require('./sim/explore.js');
const { Mission } = require('./sim/mission.js');
const generator = require('./mission/generator.js');
const store = require('./store.js');
const Weltstand = require('./weltstand.js');   // S1 §5: Speicherstand der Kampagne
const { makeRng, clamp, r1, r2, r3, f2 } = require('./util.js');

const TUTORIAL_TITLES = { m1: 'Die stumme Boje', m2: 'Echo im Nebel', m3: 'Die Tafel von Kesh' };   // nur Ersatzstart ohne startCampaign
const CAMPAIGN_STARTS = Protocol.CAMPAIGN_STARTS || ['m1', 'free'];

const SERVER_VERSION = '0.2.0';
const CMD_CONSOLE = { helm: 'helm', captain: 'captain', weapons: 'weapons', transfer: 'transfer', shop: 'shop', deco: 'quartier', quartier: 'quartier', sonde: 'sonde', plan: 'plan' };

// ---------- M3a: Naht zu SERVER-COMBAT (space.js, CONTRACT-M3 §9.4) ----------
// Alle neuen space.js-Funktionen werden defensiv aufgerufen; fehlt eine, greift ein schlichter Ersatz, damit der
// Server auch vor dem COMBAT-Stand läuft.
const MOUNT_ALIAS = { phase_l: 'port', phase_r: 'stbd', both: 'all' };
const hasFn = (name) => typeof space[name] === 'function';
function allocDefault(C, id, fb) {
  const d = C.spaceM3 && C.spaceM3.allocDefault;
  return d && Number.isFinite(d[id]) ? d[id] : fb;
}
function capFor(table, st, fb) {
  if (!table) return fb;
  const k = st === 'offline' ? 'broken' : st;
  return Number.isFinite(table[k]) ? table[k] : fb;
}
function fallbackTurnCaps(game) {
  const T = game.C.spaceM3 && game.C.spaceM3.turnCap; const s = game.ship.systems;
  return { port: capFor(T, s.thruster_port, 1), stbd: capFor(T, s.thruster_stbd, 1) };
}
function fallbackShieldCaps(game) {
  const E = game.C.spaceM3 && game.C.spaceM3.emitterCap; const s = game.ship.systems;
  const base = 4;
  if (interior.isDown(s.shields)) return [0, 0, 0, 0];
  return interior.EMITTERS.map((k) => Math.round(base * capFor(E, s[k], 1)));
}
function fallbackChargePoints(game) { const w = game.ship.power.weapons; return w > 0 ? w + 2 : 0; }

class Game {
  constructor(opts) {
    const o = opts || {};
    this.C = CONFIG;
    this.debug = !!o.debug;
    this.env = o.env || process.env;
    this.logFn = o.log || ((...a) => console.log('[Pantheon]', ...a));
    this.storeDisabled = !!o.noStore;
    // S1 §5: Weltstände auf der Platte (Standard: an, außer noStore – Tests/Smoke schreiben nichts). worlds: true erzwingt.
    this.worldsEnabled = o.worlds != null ? !!o.worlds : !o.noStore;
    this.worldDir = o.worldDir || Weltstand.dir(this.env);
    this.worldList = [];
    this.worldLock = null;        // { dir, id } solange dieser Prozess einen Weltstand offen hat
    this.worldSaveSync = !!o.worldSaveSync;   // Tests: synchron schreiben (sonst Schreiben per setImmediate)
    this.worldListT = 0;
    this.serverVersion = SERVER_VERSION;
    this.port = o.port || null;
    this.paused = false;
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
    this.lobbyOpts = { skipDrill: false, startMission: 'm1', world: null };
    this.reset();
  }

  // ---------- Weltstand (CONTRACT-S1 §5) ----------
  worldMax() { const m = this.C.weltstand && this.C.weltstand.max; return Number.isFinite(m) && m > 0 ? m : Weltstand.MAX; }
  refreshWorldList() {
    if (!this.worldsEnabled) { this.worldList = []; return; }
    try { this.worldList = Weltstand.list(this.worldDir, this); } catch (e) { this.countError('weltstand-list', e); this.worldList = []; }
    if (this.lobbyOpts.world && !this.worldList.some((w) => w.id === this.lobbyOpts.world && w.state === 'ok')) this.lobbyOpts.world = null;
  }
  releaseWorldLock() {
    const l = this.worldLock;
    if (!l) return;
    this.worldLock = null;
    try { Weltstand.unlock(l.dir, l.id); } catch (e) { this.countError('weltstand-unlock', e); }
  }
  // Speichern mit Ereignis worldSaved/worldSaveFailed. Nur Kampagne (persistent) und nur mit Ablage.
  saveWorld(reason, opts) {
    const ws = this.weltstand;
    if (!ws || !ws.persistent || !this.worldsEnabled) return { ok: false, skipped: true };
    const o = Object.assign({}, opts);
    // §5.3: Erfassen im Tick, Schreiben danach (setImmediate). Synchron nur, wo das Ergebnis sofort gebraucht wird
    // (Partie beenden) oder wenn der Server so gebaut ist (Tests: worldSaveSync).
    const sync = o.sync || this.worldSaveSync;
    const report = (r) => {
      if (r.unchanged || r.pending) return;
      if (r.ok) {
        this.lastSaveMs = r.ms;
        this.emit('worldSaved', { id: ws.id, name: ws.name, loc: r.loc });
        if (r.ms > 50) this.log(`Weltstand ${ws.id} gesichert (${reason}), Schreiben dauerte ${r.ms} ms.`);
      } else {
        this.emit('worldSaveFailed', { reason: r.error });
        this.log(`Weltstand ${ws.id} NICHT gesichert (${reason}): ${r.error}`);
      }
    };
    if (!sync) { o.async = true; o.onDone = report; }
    const r = Weltstand.save(this, o);
    if (!r.pending) report(r);
    if (r.captureMs != null) this.lastCaptureMs = r.captureMs;
    return r;
  }
  // §5.3: am Ende des Ticks. docked -> sofort; angedockt entprellt nur bei Änderung; missionDone -> auch ohne Dock.
  updateWeltstand(dt) {
    const ws = this.weltstand; const ship = this.ship;
    if (!ws) return;
    if (ship.docked && ship.dockedAt) ws.lastDockedAt = ship.dockedAt;
    const pr = this.pendingRadio;
    if (pr && this.time >= pr.at) {
      this.pendingRadio = null;
      if (typeof this.mission.radio === 'function') this.mission.radio(pr.from, pr.text); else this.emit('radio', { from: pr.from, text: pr.text });
    }
    const due = this.saveDue; this.saveDue = null;
    if (!ws.persistent || !this.worldsEnabled) return;
    if (due && due.missionDone) { this.dockSaveT = 0; this.saveWorld('missionDone'); return; }
    if (!ship.docked) { this.dockSaveT = 0; return; }
    if (due && due.docked) { this.dockSaveT = 0; this.saveWorld('docked'); return; }
    this.dockSaveT = (this.dockSaveT || 0) + dt;
    const every = Number(this.C.weltstand && this.C.weltstand.dockedSaveEvery) || 10;
    if (this.dockSaveT >= every) { this.dockSaveT = 0; this.saveWorld('docked-periodic', { ifChanged: true }); }
  }
  markSaveDue(kind) { this.saveDue = Object.assign(this.saveDue || {}, { [kind]: true }); }
  connectedCount() { return this.players.filter((p) => p.connected).length; }

  // Start abgelehnt (z. B. 5 Weltstände): alle wieder „nicht bereit“ + Hinweis
  refuseStart(text) {
    for (const p of this.players) { p.ready = false; this.notice(p, text); }
    this.log('Start abgelehnt: ' + text);
  }

  // Kampagne starten (ENGINE: mission.startCampaign). Fehlt sie: mit Tutorial das alte start(), ohne Tutorial ein Ersatz.
  startCampaignMission(tutorial) {
    const m = this.mission;
    if (typeof m.startCampaign === 'function') {
      try { m.startCampaign({ tutorial }); return; } catch (e) { this.countError('weltstand-startCampaign', e); }
    }
    if (tutorial) { m.start(); return; }
    this.countError('weltstand-startCampaign', new Error('mission.startCampaign fehlt – Ersatzstart ohne Tutorial'));
    this.log('WARNUNG: mission.startCampaign fehlt – Ersatzstart „Kampagne ohne Tutorial“ (Tutorial-Missionen als erledigt markiert).');
    for (const id of ['m1', 'm2', 'm3']) {
      m.missions[id] = { id, title: TUTORIAL_TITLES[id], state: 'done' };
      this.stats.missions[id] = { start: 0, end: 0 };
    }
    const c = this.C.campaign || {};
    this.inventory.marks = Number.isFinite(c.skipTutorialMarks) ? c.skipTutorialMarks : this.C.economy.startMarks;
    const file = Weltstand.readNpcFile(this, false);
    const ot = file && file.kampagne && file.kampagne.ohne_tutorial;
    if (ot && ot.fakten) for (const [k, v] of Object.entries(ot.fakten)) {
      const obj = v && typeof v === 'object';
      this.weltstand.fact(k, obj ? v.value : v, obj && v.quelle ? v.quelle : 'ohne_tutorial');
    }
    if (ot && ot.funk) this.pendingRadio = { at: this.time + (Number(c.teskRumorAt) || 0), from: ot.funk.from, text: ot.funk.text };
  }

  // Fortsetzen: laden -> reset -> sperren -> apply. Fehler: worldLoadFailed, zurück in die Lobby, kein Absturz.
  continueWorld(id) {
    const dir = this.worldDir;
    const fail = (reason) => {
      this.emit('worldLoadFailed', { id, reason });
      this.log(`Weltstand ${id} nicht geladen: ${reason}`);
      this.lobbyOpts.world = null;
      for (const p of this.players) p.ready = false;
      this.refreshWorldList();
    };
    const r = Weltstand.load(dir, id, this);
    if (!r.ok) return fail(r.error);
    // reset() spielt den Erstbesuch im Hafen ab (ODA, Logbuch, +20 Marken) – beim Fortsetzen ist das kein Erstbesuch
    this.muteEvents = true;
    try { this.reset(); } finally { this.muteEvents = false; }
    const lk = Weltstand.lock(dir, id, { port: this.port });
    if (!lk.ok) return fail(lk.error);
    this.worldLock = { dir, id };
    this.phase = 'play';
    this.stats.playTimeStart = this.time;
    this.players.forEach((p, i) => { this.resetPlayer(p, i); p.ready = true; });
    this.runId = 'run-' + Date.now() + '-' + (++this.runCounter);
    try {
      Weltstand.apply(this, r.data);
    } catch (e) {
      this.countError('weltstand-apply', e);
      this.reset();
      return fail('Der Weltstand ließ sich nicht übernehmen (' + e.message + ').');
    }
    this.emit('worldLoaded', { id, name: this.weltstand.name });
    if (r.fromBak) this.log(`Weltstand ${id} aus der Sicherung (.bak) geladen.`);
    this.log(`Weltstand ${id} („${this.weltstand.name}“) fortgesetzt mit ${this.players.length} Spieler(n), angedockt: ${this.ship.dockedAt}.`);
    this.logRun(false);
  }

  // §6 menu { op: 'end' }: Partie für alle beenden -> Lobby (Spieler bleiben verbunden, ready = false)
  endSession(p) {
    let saved = false;
    const ws = this.weltstand;
    if (ws && ws.persistent && this.ship.docked) saved = !!this.saveWorld('end', { sync: true }).ok;
    this.emit('sessionEnded', { by: p ? p.id : null, byName: p ? p.name : null, saved });   // CLIENT: by = ID, byName = Anzeige
    this.log(`${p ? p.name : 'Jemand'} hat die Partie beendet${saved ? ' (Weltstand gesichert)' : ''}.`);
    if (this.phase !== 'end') { this.stats.elapsed = this.time - this.stats.playTimeStart; this.logRun(true); }
    const prevWorld = ws && ws.persistent && this.worldsEnabled ? ws.id : null;
    this.muteEvents = true;   // kein „Erstbesuch Hafen“ aus reset() in die Lobby
    try { this.reset(); } finally { this.muteEvents = false; }
    // QA-Abnahme S1: den gerade gespielten Stand in der Lobby vorauswählen (statt „Neu: Kampagne“), sofern er in der Liste ok ist
    this.lobbyOpts.world = prevWorld && this.worldList.some((w) => w.id === prevWorld && w.state === 'ok') ? prevWorld : null;
    for (const q of this.players) q.ready = false;
  }

  onWorldMsg(conn, p, msg) {
    if (msg.op !== 'delete') return;
    if (this.phase !== 'lobby') return this.notice(p, 'Weltstände lassen sich nur in der Lobby löschen.');
    if (!this.worldsEnabled) return this.notice(p, 'Weltstände sind auf diesem Server aus.');
    const id = String(msg.id);
    const r = Weltstand.remove(this.worldDir, id);
    if (!r.ok) {
      if (r.code === 'worldbusy') this.sendTo(conn, { t: 'error', code: Protocol.ERR.WORLDBUSY || 'worldbusy', text: r.error });
      else this.notice(p, r.error);
      return;
    }
    if (this.lobbyOpts.world === id) this.lobbyOpts.world = null;
    this.log(`${p.name}: Weltstand ${id} gelöscht.`);
    this.refreshWorldList();
  }

  onMenuMsg(p, msg) {
    if (msg.op === 'end') { if (this.phase !== 'lobby') this.endSession(p); return; }
    if (msg.op === 'pause') {
      if (this.phase === 'lobby') return;
      if (!msg.on) { this.paused = false; return; }
      if (this.connectedCount() === 1) this.paused = true;
    }
  }

  // ---------- Zustand ----------
  reset() {
    const C = this.C;
    this.releaseWorldLock();   // S1: Sperre beim Beenden/Reset lösen
    this.phase = 'lobby';
    this.paused = false;
    this.saveDue = null; this.dockSaveT = 0; this.pendingRadio = null;
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
    this.stats = { elapsed: 0, kills: 0, repairs: 0, firesOut: 0, hits: 0, emergencies: 0, playTimeStart: 0, stages: {}, missions: {}, locations: {},
      // M3a (CONTRACT-M3 §7.2/§8): Abnahme-Zähler
      flicks: 0, swaps: 0, minigames: 0, minigameErrors: 0, bridgeLeaves: 0, bursts: 0, burstsPerfect: 0,
      // M3b §4 (bursts/burstsPerfect bleiben eine Version als Altnamen, zählen nicht mehr)
      leakHits: 0, escalations: 0, repairSetbacks: 0, overflowHull: 0, reactorAutoStarts: 0 };
    this.ship = {
      scene: Locations.START, docked: true, dockedAt: Locations.START, dockArmed: false, x: 0, y: 0, angle: 0, vx: 0, vy: 0, speed: 0,
      hull: C.ship.hull, hullMax: C.ship.hull, o2: C.o2.max, alert: 'normal',
      helm: { turn: 0, thrust: 0, manned: false, autoStop: false },   // §21.1 autoStop = Allstopp aktiv
      power: Object.assign({}, C.power.default), reactor: { state: 'online', output: C.power.reactor, used: 8, overloadLeft: 0, switches: { A: false, B: false }, restartProgress: 0 },
      reactorCtl: { state: 'online', overloadLeft: 0, warned: false, switches: { A: false, B: false }, restartProgress: 0, aloneT: 0, offlineT: 0, needBot: null },
      heat: { engines: 0, shields: 0, weapons: 0, life: 0 },
      shields: { pool: 4, alloc: C.shields.default.slice(), current: C.shields.default.slice(), regenT: 0 },
      // M3a: alle 14 Systeme; systems.weapons ist ein berechneter Altname (interior.makeSystems)
      systems: interior.makeSystems(),
      fragile: {}, repairQueue: [], botAuto: false, botAutoChosen: false, sysAnnounce: { list: [], next: 0 },
      turnVel: 0,
      offline: {},
      fireList: [], breachList: [], groundItems: [],
      dodgeCd: 0, jump: { dest: null, charge: 0, ready: false, blockedReason: null },
      // M3a: bow/port/stbd (Ladepunkte alloc, hold für Batterien); phase_* bleiben für den alten space.js-Stand, bis COMBAT umstellt
      mount: { phase_l: { charge: 1 }, phase_r: { charge: 1 }, bolzen: { loaded: C.weapons.bolzen.magazine, reloadT: null, shotT: 0 }, seitenturm: { charge: 0 },
        bow: { charge: 1, alloc: allocDefault(C, 'bow', 2), power: 0, charging: false },   // §20.3 Ladewaffe
        port: { charge: 1, alloc: allocDefault(C, 'port', 1), salvo: 0 },
        stbd: { charge: 1, alloc: allocDefault(C, 'stbd', 1), salvo: 0 } },
      target: null, priority: null, scan: { progress: 0, done: false }, scanning: false, scanAt: 0,
      tscan: { targetId: null, progress: 0, on: false, at: 0 }, widescan: { cd: 0, pulseAt: -99 },
      markers: { captain: null, tactical: null },
      noPartT: {}, noPlateT: 0, asteroidImmune: {}, beaming: null, sysHitAt: {},
      escalateT: {}, escAnnounce: { list: [], next: 0 },   // M3b §4 Eskalation
    };
    this.space = { w: 0, h: 0, enemies: [], projectiles: [], beams: [], asteroids: [], markers: [], salvage: [] };
    this.salvaged = 0;
    this.arena = null;   // Testgelände (server/sim/arena.js), nur bei Lobby-Start arena_space/arena_away
    this.explore = new Explore(this);
    this.aways = { platform: away.makeAway(this), wreck: away.makeWreck(this), kesh: away.makeKesh(this) };
    this.away = this.aways.platform;
    // S1 §5.4: Laufzeit-Weltstand existiert in jeder Partie; Kampagne ersetzt ihn beim Start (persistent)
    this.weltstand = Weltstand.create(this, { tutorial: false, persistent: false, dir: this.worldDir });
    this.mission = new Mission(this);
    space.enterScene(this, Locations.START, { docked: true });
    this.bots = [];
    bots.ensureBotCount(this);
    this.asteroidsDirty = true;
    this.sentExploreVersion = -1; this.sentLogVersion = -1; this.sentBookVersion = -1;
    this.runId = null;
    for (const p of this.players) this.resetPlayer(p, this.players.indexOf(p));
    this.refreshWorldList();
  }

  setAwayMap(id) { if (this.aways[id] && this.away !== this.aways[id]) this.away = this.aways[id]; }

  resetPlayer(p, idx) {
    const sp = W.Maps.SHIP_SPAWNS[idx % W.Maps.SHIP_SPAWNS.length];
    const c = W.tileCenter(sp.x, sp.y);
    Object.assign(p, { zone: 'ship', x: c.x, y: c.y, dir: 'down', moving: false, console: null, carry: null, carryCharges: 0,
      hp: this.C.player.hp, downed: false, downedFor: 0, hold: null, beamLock: false, actDown: false,
      gear: { werkzeuggurt: false }, input: { mx: 0, my: 0 }, shootReadyAt: 0,
      shield: null, wound: false, bleed: null, medkit: 0, cv: 0, fl: false, crouch: false, lift: null });
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
  emit(kind, data) {
    if (this.muteEvents) return;   // QA-Abnahme S1: reset() vor dem Laden meldet sonst „Erstbesuch Hafen (+20 Marken)“
    if (kind === 'missionDone') this.markSaveDue('missionDone');   // S1 §5.3: speichern am Tick-Ende (auch ohne Dock)
    this.broadcast(Object.assign({ t: 'event', kind }, data));
  }
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
    if (name === 'docked') this.markSaveDue('docked');   // S1 §5.3: speichern am Tick-Ende, wenn noch angedockt
    try { this.mission.onEvent(name, data || {}); } catch (e) { this.countError('mission-event', e); }
  }
  log(...a) { this.logFn(...a); }

  countError(where, err) {
    this.errors++;
    const now = Date.now();
    const last = this.errorLog[where] || 0;
    if (now - last > 2000) { this.errorLog[where] = now; console.warn(`[Pantheon] Fehler in ${where} (gesamt ${this.errors}):`, err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err); }
  }
  safe(where, fn) { try { fn(); } catch (e) { this.countError(where, e); } }

  // ---------- Verbindungen ----------
  addConnection(conn) { this.conns.add(conn); conn.player = null; }

  removeConnection(conn) {
    this.conns.delete(conn);
    const p = conn.player;
    if (!p || p.conn !== conn) return;
    p.conn = null; p.connected = false;
    this.paused = false;   // S1 §6: Trennen beendet die Solo-Pause
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
      if (msg.t === C.HELLO) {
        this.onHello(conn, msg);
        if (this.connectedCount() !== 1) this.paused = false;   // S1 §6: zweiter Spieler beendet die Solo-Pause
        return;
      }
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
          // S1 §6: Weltstand zum Fortsetzen wählen (null = neu)
          if (this.phase === 'lobby' && 'world' in msg) {
            const id = msg.world == null || msg.world === '' ? null : String(msg.world);
            if (id === null) { if (this.lobbyOpts.world) this.log(`${p.name}: neuer Weltstand.`); this.lobbyOpts.world = null; }
            else {
              const w = this.worldList.find((o) => o.id === id);
              if (!w) this.notice(p, 'Diesen Weltstand gibt es nicht (mehr).');
              else if (w.state !== 'ok') this.notice(p, w.grund || 'Dieser Weltstand lässt sich nicht fortsetzen.');
              else if (this.lobbyOpts.world !== id) { this.lobbyOpts.world = id; this.log(`${p.name}: Fortsetzen „${w.name}“ (${id}).`); }
            }
          }
          break;
        case C.WORLD: this.onWorldMsg(conn, p, msg); break;   // S1 §6
        case C.MENU: this.onMenuMsg(p, msg); break;           // S1 §6
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
      this.sentExploreVersion = -1; this.sentLogVersion = -1; this.sentBookVersion = -1;
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
      this.sentExploreVersion = -1; this.sentLogVersion = -1; this.sentBookVersion = -1;
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
    this.sentExploreVersion = -1; this.sentLogVersion = -1; this.sentBookVersion = -1;
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
    const sm = this.lobbyOpts.startMission;
    // S1 §6: gewählter Weltstand -> fortsetzen (startMission entfällt)
    if (this.lobbyOpts.world && this.worldsEnabled) return this.continueWorld(this.lobbyOpts.world);
    // Weltstand nur für die Kampagne (m1 = mit Tutorial, free = ohne); m3 und Testgelände nie (Kai)
    const campaign = CAMPAIGN_STARTS.includes(sm);
    if (campaign && this.worldsEnabled) {
      this.refreshWorldList();
      if (this.worldList.length >= this.worldMax()) return this.refuseStart('Erst einen Weltstand löschen.');
    }
    this.reset();
    this.phase = 'play';
    this.stats.playTimeStart = this.time;
    this.players.forEach((p, i) => { this.resetPlayer(p, i); p.ready = true; });
    this.runId = 'run-' + Date.now() + '-' + (++this.runCounter);
    if (campaign) {
      this.weltstand = Weltstand.create(this, { tutorial: sm === 'm1', persistent: true, dir: this.worldDir, countMissing: this.worldsEnabled });
      this.weltstand.lastDockedAt = Locations.START;
      if (this.worldsEnabled) {
        const lk = Weltstand.lock(this.worldDir, this.weltstand.id, { port: this.port });
        if (lk.ok) this.worldLock = { dir: this.worldDir, id: this.weltstand.id }; else this.countError('weltstand-lock', new Error(lk.error));
      }
    }
    if (!arena.isArena(sm)) this.explore.arrive(Locations.START);   // Testgelände: keine Hafen-Erstbesuchsansage
    if (sm === 'm3') this.mission.startDirect('m3');
    else if (arena.isArena(sm)) arena.start(this, sm);   // Testgelände Raumkampf / Außenteam
    else this.startCampaignMission(sm !== 'free');
    this.log(`Partie gestartet mit ${this.players.length} Spieler(n). Seed ${this.seed}.${campaign && this.worldsEnabled ? ' Weltstand ' + this.weltstand.id + '.' : ''}`);
    if (campaign) this.saveWorld('start');   // §5.3: einmal direkt nach dem Start (damit der Stand in der Liste steht)
    this.logRun(false);
  }

  endGame(opts) {
    if (this.phase === 'end') return;
    const o = opts || {};
    if (this.weltstand && this.weltstand.persistent && this.ship.docked) this.saveWorld('endGame');   // §5.3
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
      worldId: this.weltstand && this.weltstand.persistent ? this.weltstand.id : null,   // S1 §5.2
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
    // M3a §8.1: Minispiel-Reparatur – ohne Konsole, nur Zone ship
    if (Protocol.CMD_REPAIR.includes(c)) { const e = interior.repairCmd(this, p, c, msg); if (e) this.notice(p, e); return; }
    const [prefix] = c.split('.');
    const need = CMD_CONSOLE[prefix];
    if (!need) return this.notice(p, 'Unbekannter Befehl.');
    if (p.console !== need) return this.notice(p, 'Dafür musst du an der passenden Konsole sein.');
    if (p.downed) return;
    let err = null;
    const ship = this.ship;
    switch (c) {
      case 'helm.input':   // §21.1: Eingabe ≠ 0 beendet den Allstopp (space.helmInput)
        space.helmInput(this, clamp(Number(msg.turn) || 0, -1, 1), clamp(Number(msg.thrust) || 0, -1, 1));
        break;
      case 'helm.stop': err = space.helmStop(this); break;   // §21.1 Allstopp
      case 'helm.throttle':   // M3b §2: { delta: ±1 } oder { set: index } (SERVER-FLIGHT)
        err = hasFn('helmThrottle') ? space.helmThrottle(this, msg) : 'Temporegler noch nicht verfügbar.';
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
        if (t === null || t === undefined || t === 'fire' || t === 'breach') ship.priority = t == null ? null : t;
        else if (Protocol.SYSTEMS.includes(t)) {   // M3a §8.2: System-ID -> flick-Eintrag an die Spitze der Reparaturliste
          err = bots.queueFront(this, t);
          if (!err) ship.priority = t;
        } else err = 'Unbekannte Priorität.';
        break;
      }
      case 'captain.repair': err = bots.queueRepair(this, msg.system, msg.mode == null ? null : String(msg.mode)); break;
      case 'captain.botAuto': err = bots.setBotAuto(this, !!msg.on); break;
      case 'captain.burst': err = 'Den Schildstoß gibt es nicht mehr.'; break;   // M3b §0.4: entfallen (Altname)
      case 'weapons.alloc': {
        const mount = MOUNT_ALIAS[msg.mount] || String(msg.mount);
        err = hasFn('weaponsAlloc') ? space.weaponsAlloc(this, mount, Number(msg.delta) >= 0 ? 1 : -1) : 'Ladepunkte noch nicht verfügbar.';   // TODO M3 COMBAT
        break;
      }
      case 'weapons.hold': {
        const mount = MOUNT_ALIAS[msg.mount] || String(msg.mount);
        err = hasFn('weaponsHold') ? space.weaponsHold(this, mount, !!msg.hold) : 'Halten noch nicht verfügbar.';   // TODO M3 COMBAT
        break;
      }
      case 'captain.scan': err = this.mission.scan(p, !!msg.on); break;
      case 'captain.support': err = away.captainSupport(this, String(msg.kind)); break;
      case 'captain.listen': err = this.mission.listen(); break;
      case 'captain.marker': err = space.setMarker(this, 'captain', Number(msg.x), Number(msg.y), !!msg.clear); break;
      case 'captain.overload': err = space.captainOverload(this); break;
      case 'captain.order': err = combat.order(this, msg); break;   // M2: Befehle ans Außenteam
      case 'weapons.charge': {   // §20.3: Lanze aufladen (on: true) / feuern (on: false)
        const mount = msg.mount == null ? 'bow' : (MOUNT_ALIAS[msg.mount] || String(msg.mount));
        const wasCharging = !!(ship.mount.bow && ship.mount.bow.charging);
        err = space.weaponsCharge(this, mount, !!msg.on);
        if (!err && !msg.on && wasCharging) this.missionEvent('weaponsFired', {});
        break;
      }
      case 'weapons.target': err = space.weaponsTarget(this, msg.id == null ? null : String(msg.id)); break;
      case 'weapons.fire': {
        // M3a §5.1: Altnamen phase_l/phase_r/both -> port/stbd/all (nur sobald COMBAT die neue Logik liefert)
        const raw = String(msg.mount);
        const mount = hasFn('weaponsAlloc') ? (MOUNT_ALIAS[raw] || raw) : raw;
        err = space.weaponsFire(this, mount); if (!err) this.missionEvent('weaponsFired', {});
        break;
      }
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
      // §21.2 Missionsbuch (direkt an mission.js; onboard.js gehört gerade dem CLIENT-Team)
      case 'plan.focus': err = this.mission.setFocus(msg.id == null || msg.id === '' ? null : String(msg.id)); break;
      case 'plan.accept': err = this.mission.acceptEntry(String(msg.id)); break;
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
        if (st === 'ok') {
          const list = sys === 'weapons' ? interior.WEAPON_SYSTEMS : [sys];
          for (const k of list) { this.ship.systems[k] = 'ok'; delete this.ship.offline[k]; delete this.ship.fragile[k]; }
          interior.pruneRepairQueue(this);
        } else if (st === 'offline') interior.setOffline(this, sys, this.C.emp.offlineTime);
        else interior.damageSystem(this, sys, st);
        break;
      }
      // M3a §17: fragile <system>, tele [id] (sofort laden), burst <sector> (ohne Prüfung) – tele/burst liegen bei COMBAT
      case 'fragile': {
        const sys = String(msg.system != null ? msg.system : (typeof msg.args === 'string' ? msg.args.trim() : ''));
        if (!interior.SYSTEM_ORDER.includes(sys)) { err = 'Unbekanntes System.'; break; }
        this.ship.fragile[sys] = true;
        break;
      }
      case 'tele': {
        const id = msg.id != null ? String(msg.id) : (typeof msg.args === 'string' && msg.args.trim() ? msg.args.trim() : null);
        err = hasFn('debugTele') ? space.debugTele(this, id) : 'tele: noch nicht verfügbar (SERVER-COMBAT).';   // TODO M3 COMBAT
        break;
      }
      // M3b §4: debug burst entfällt (Schildstoß gibt es nicht mehr)
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
    // S1 §6: Solo-Pause – Simulation steht, Snapshots laufen weiter (paused: true)
    if (this.paused) {
      if (this.phase === 'lobby' || this.connectedCount() !== 1) this.paused = false;
      else return;
    }
    this.time += dt;
    const connected = this.players.some((p) => p.connected);
    if (this.phase === 'lobby' && this.worldsEnabled) {
      // andere Prozesse (Sperren) und Löschungen sichtbar machen
      this.worldListT += dt;
      if (this.worldListT >= 3) { this.worldListT = 0; this.refreshWorldList(); }
    }
    if (this.phase !== 'lobby') {
      if (!connected) {
        this.emptyFor += dt;
        if (this.emptyFor >= this.C.net.emptyResetAfter) {
          this.log('Alle weg – Partie zurückgesetzt.');
          if (this.weltstand && this.weltstand.persistent && this.ship.docked) this.safe('weltstand', () => this.saveWorld('empty'));
          this.players = [];
          this.reset();
          return;
        }
      } else this.emptyFor = 0;
      this.safe('players', () => interior.updatePlayers(this, dt));
      this.safe('bridge', () => this.trackBridgeLeaves());
      this.safe('space', () => space.update(this, dt));
      this.safe('hazards', () => interior.updateHazards(this, dt));
      this.safe('damage', () => damage.update(this, dt));   // M3b §4: Eskalation, Reaktor-Autostart
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
      this.safe('weltstand', () => this.updateWeltstand(dt));   // S1 §5.3: am Ende des Ticks
    }
  }

  // M3a §8.3: Raum 'bruecke' verlassen, während ein Gegner (kein relay) da ist -> stats.bridgeLeaves + 1 (je Verlassen)
  trackBridgeLeaves() {
    const hostile = this.space.enemies.some((e) => e.kind !== 'relay');
    for (const p of this.players) {
      let room = null;
      if (p.zone === 'ship') { const t = { x: Math.floor(p.x / 32), y: Math.floor(p.y / 32) }; const r = W.Maps.roomAt(t.x, t.y); room = r ? r.id : null; }
      if (p.lastRoom === 'bruecke' && room !== 'bruecke' && room !== null && hostile) this.stats.bridgeLeaves++;
      if (room !== null || p.zone !== 'ship') p.lastRoom = room;
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
    // M4 §2.4: Gefechtsbeginn (erster Gegner außer Relais) – wer auf Deck II ist, bekommt eine ODA-Zeile, und der erste
    // Feindkontakt kommt frühestens CONFIG.lift.firstContactDelay s nach dem Alarm.
    const hostile = this.space.enemies.some((e) => e.kind !== 'relay');
    if (hostile && !s.hostilePrev) {
      const below = this.players.filter((p) => p.connected && p.zone === 'ship' && (W.deckOf(Math.floor(p.y / 32)) === 1 || (p.lift && p.lift.to === 1)));
      if (below.length) {
        this.oda('Alle auf Station – Lift im Liftvorraum.', null);
        const delay = Number(this.C.lift && this.C.lift.firstContactDelay) || 0;
        if (delay > 0) s.holdFireUntil = this.time + delay;
      }
    }
    s.hostilePrev = hostile;
  }

  // players[].action: Halten (flick/swap/…) mit Fortschritt; Minispiel ohne Ende -> progress gegen die Mindestzeit
  holdSnap(h) {
    const C = this.C;
    if (h.kind === 'switch') return { kind: 'switch', progress: r2(Math.min(1, this.ship.reactorCtl.restartProgress / C.reactorM1.restartTime)) };
    if (h.kind === 'minigame') {
      const minT = (C.spaceM3 && C.spaceM3.repair && C.spaceM3.repair.minigameMinTime) || 2.5;
      return { kind: 'minigame', system: h.system, progress: r2(Math.min(1, h.t / minT)) };
    }
    const o = { kind: h.kind, progress: r2(Math.min(1, h.t / h.dur)) };
    if (h.system) o.system = h.system;
    return o;
  }

  // ship.shields: über space.shieldsSnapshot (COMBAT), sonst Altfelder + cap aus Emitter-Zuständen
  shieldsSnap() {
    const sh = this.ship.shields;
    // M3b §4: Schildstoß entfallen – burst/burstCd bleiben eine Version lang als null/0 (Altnamen)
    const base = hasFn('shieldsSnapshot') ? space.shieldsSnapshot(this)
      : { pool: sh.pool, alloc: sh.alloc, current: sh.current, cap: hasFn('shieldCaps') ? space.shieldCaps(this) : fallbackShieldCaps(this) };
    return Object.assign({}, base, { burst: null, burstCd: 0 });
  }

  // ship.helm: Altfelder + M3b §2 stage/stages/autoStop aus space.helmSnapshot (SERVER-FLIGHT)
  helmSnap() {
    const h = this.ship.helm;
    const o = { turn: h.turn, thrust: h.thrust, manned: h.manned, autoStop: !!h.autoStop };
    if (hasFn('helmSnapshot')) { const x = space.helmSnapshot(this); if (x) Object.assign(o, x); }
    return o;
  }
  // ship.reactor + M3b §4 autoIn (s bis zum Gefechtsstart, nur solange er läuft)
  reactorSnap() {
    const left = damage.reactorAutoLeft(this);
    return left == null ? this.ship.reactor : Object.assign({}, this.ship.reactor, { autoIn: left });
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
    // §21.2 Missionsbuch: eigener Slot (7), sonst nur bei Änderung und nie zusammen mit Asteroiden/Ortsliste/Logbuch
    const book = this.mission.bookSnapshot();
    const includeBook = (this.sentBookVersion !== book.version || slot === 7) && !includeAsteroids && !includeWorld && !includeLog;
    if (includeBook) this.sentBookVersion = book.version;
    const mount = ship.mount;
    const v2 = combat.isV2Away(aw);
    const mounts = hasFn('mountsSnapshot') ? space.mountsSnapshot(this) : space.mountIds(this).map((id) => {
      const w = C.weapons[id] || (C.spaceM3 && C.spaceM3.mounts && C.spaceM3.mounts[id]) || { facing: 0, arc: 0, range: 0 };
      const o = { id, facing: w.facing, arc: w.arc, range: w.range };
      if (!mount[id]) return o;
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
      enemies: sp.enemies.map((e) => {
        const o = { id: e.id, kind: e.kind, x: r1(e.x), y: r1(e.y), angle: r3(e.angle), hp: r1(e.hp), hpMax: e.hpMax,
          shields: e.shields.map(r1), shieldsMax: e.shieldsMax, scanned: !!e.scanned, weapons: e.scanned ? (C.enemyWeapons[e.kind] || []) : null };
        // M3a §7.1: angekündigter Angriff (nur solange er lädt)
        const tele = hasFn('enemyTeleSnap') ? space.enemyTeleSnap(e) : (e.tele ? { kind: e.tele.kind, left: r2(e.tele.left), dur: e.tele.dur, sector: e.tele.sector } : null);
        if (tele) o.tele = tele;
        // M3b §3: vx, vy, state (SERVER-FLIGHT)
        if (hasFn('enemySnapExtra')) { const x = space.enemySnapExtra(e); if (x) Object.assign(o, x); }
        return o;
      }),
      projectiles: sp.projectiles.map((q) => ({ id: q.id, kind: q.kind, x: r1(q.x), y: r1(q.y), angle: r3(q.angle) })),
      // §20.1: ttlMax (Gesamtdauer), mount, miss, power mitschicken – der Client kennt so Alter und Flanke des Strahls
      beams: sp.beams.map((b) => {
        const o = { x1: r1(b.x1), y1: r1(b.y1), x2: r1(b.x2), y2: r1(b.y2), ttl: r2(b.ttl), kind: b.kind };
        if (b.ttlMax) o.ttlMax = r2(b.ttlMax);
        if (b.mount) o.mount = b.mount;
        if (b.miss) o.miss = true;
        if (b.power != null) o.power = b.power;
        return o;
      }),
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
      // §21.2: HUD-Ziele der fokussierten Mission (ohne Fokus: laufende Mission) – immer dabei, klein
      bookVersion: book.version,
      ...this.mission.focusSnapshot(),
    };
    if (includeLog) missionOut.log = this.explore.log.slice(-30).map((e) => ({ id: e.id, text: e.text, loc: e.loc, t: e.t }));   // §21.2: + t (Spielzeit s)
    // S1 §6 (Kann): Chronik (letzte 10) im Log-Slot
    if (includeLog && this.weltstand && this.weltstand.data && this.weltstand.data.chronik.length) missionOut.chronik = this.weltstand.data.chronik.slice(-10);
    if (includeBook) missionOut.book = book;
    return {
      t: 'snap', tick: this.tick, time: r2(this.time), phase: this.phase,
      lobby: this.phase === 'lobby'
        ? { skipDrill: this.lobbyOpts.skipDrill, startMission: this.lobbyOpts.startMission,   // S1 §6: Weltstände nur in der Lobby
          worlds: this.worldList, world: this.lobbyOpts.world || null, worldsFull: this.worldsEnabled && this.worldList.length >= this.worldMax() }
        : { skipDrill: this.lobbyOpts.skipDrill, startMission: this.lobbyOpts.startMission },
      paused: !!this.paused,
      campaign: !!(this.weltstand && this.weltstand.persistent),   // S1: Kampagne mit Weltstand (Hinweis beim Beenden)
      players: this.players.map((p) => ({
        id: p.id, name: p.name, color: p.color, ready: p.ready, connected: p.connected,
        zone: p.zone, x: r1(p.x), y: r1(p.y), dir: p.dir, moving: p.moving, console: p.console, carry: p.carry,
        hp: Math.round(p.hp), downed: p.downed, downedFor: r1(p.downedFor),
        action: p.hold ? this.holdSnap(p.hold)
          : (beam && beam.pids.includes(p.id) ? { kind: 'beam', progress: r2(Math.min(1, beam.t / beam.dur)) } : null),
        gear: p.gear, lastSeq: p.lastSeq,
        ...combat.playerSnap(this, p),
        ...interior.deckSnap(this, p),   // M4 §2.4: deck (Schiff), lift { to, t, T }, ladder { t, T } – nur wenn aktiv
      })),
      bots: this.bots.map((b) => {
        const tk = b.task && b.task.kind !== 'home' ? b.task : null;
        let task = null;
        if (tk) {
          const kind = tk.phase === 'fetch' ? 'fetch' : tk.kind;
          // M3a: Regalkachel aus dem Schiffslayout (kein festes y mehr)
          const shelf = tk.phase === 'fetch' ? W.SHELF_TILES.find((s) => s.item === tk.part) : null;
          const tx = shelf ? shelf.x : tk.tx;
          const ty = shelf ? shelf.y : tk.ty;
          task = { kind, x: tx * 32 + 16, y: ty * 32 + 16 };
        }
        const bo = { id: b.id, variant: b.variant, x: r1(b.x), y: r1(b.y), dir: b.dir, moving: b.moving, carry: b.carry, task, progress: r2(b.progress) };
        if (b.lift) bo.lift = { to: b.lift.to, t: r2(b.lift.t), T: b.lift.T };   // M4: Bot fährt Lift
        return bo;
      }),
      ship: {
        scene: ship.scene, docked: ship.docked, dockedAt: ship.dockedAt, x: r1(ship.x), y: r1(ship.y), angle: r3(ship.angle), vx: r1(ship.vx), vy: r1(ship.vy), speed: r1(ship.speed),
        hull: Math.round(ship.hull * 10) / 10, hullMax: ship.hullMax, o2: r1(ship.o2), alert: ship.alert,
        helm: this.helmSnap(),
        power: ship.power, reactor: this.reactorSnap(),
        heat: { engines: Math.round(ship.heat.engines), shields: Math.round(ship.heat.shields), weapons: Math.round(ship.heat.weapons), life: Math.round(ship.heat.life) },
        shields: this.shieldsSnap(),
        // M3a §4.1/§9.3: 14 Systeme + berechneter Altname weapons (schlechteste der drei Waffen)
        systems: Object.assign({}, ship.systems, { weapons: ship.systems.weapons }),
        fragile: Object.keys(ship.fragile).filter((k) => ship.fragile[k]),
        repairQueue: ship.repairQueue.map((e) => ({ system: e.system, mode: e.mode, bot: e.bot || null })),
        botAuto: !!ship.botAuto,
        turnVel: r3(ship.turnVel || 0),
        turnCap: hasFn('turnCaps') ? space.turnCaps(this) : fallbackTurnCaps(this),
        chargePoints: hasFn('chargePoints') ? space.chargePoints(this) : fallbackChargePoints(this),
        escalate: damage.escalateSnapshot(this),   // M3b §4: { [sys]: Restsekunden } laufender Eskalations-Zähler
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
        ...(aw.loreRead ? { loreRead: true } : {}),   // M4 (QA-AWAY): Logbuch-Terminal im Wrack als gelesen zeigen (nur wenn gelesen – Snapshot-Budget)
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
        emergencies: this.stats.emergencies,
        flicks: this.stats.flicks || 0, swaps: this.stats.swaps || 0, minigames: this.stats.minigames || 0, bridgeLeaves: this.stats.bridgeLeaves || 0,
        bursts: this.stats.bursts || 0, burstsPerfect: this.stats.burstsPerfect || 0,   // Altnamen (Schildstoß entfallen)
        leakHits: this.stats.leakHits || 0, escalations: this.stats.escalations || 0, repairSetbacks: this.stats.repairSetbacks || 0,
        overflowHull: this.stats.overflowHull || 0, reactorAutoStarts: this.stats.reactorAutoStarts || 0,
        playTimeStart: r2(this.stats.playTimeStart), stages: this.stats.stages, missions: this.stats.missions, locations: this.locationStats() },
      errors: this.errors,
    };
  }
}

module.exports = { Game, SERVER_VERSION };
