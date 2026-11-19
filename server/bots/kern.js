'use strict';
// BOT-01 B1: missionsneutraler Kern der Testbots (Steuern, Kampf, Reparatur, Laufen, Reisen). Aus tools/sim-headless.js (class Agent) verschoben, ohne Verhaltensaenderung.
// Der Kern importiert nur server/ und shared/. Querschnitt zentral: Zufall (setSimRng), Statistik (statistik), Ausgabe (setzeAusgabe).
const Maps = require('../../shared/maps.js');
const Physics = require('../../shared/physics.js');
const CONFIG = require('../../shared/config.js');
const Locations = require('../../shared/locations.js');
const Drift = require('../../shared/drift.js');   // W2 AP3b: bewegte Brocken
const Protocol = require('../../shared/protocol.js');
const { bfs, clamp, makeRng } = require('../util.js');
const W = require('../world.js');
const Crew = require('../sim/crew.js');   // BOT-01 A1
const Station = require('../sim/station.js');   // R1: aktive Station der Bots (Tab-Wechsel)
const Gsys = require('../sim/gegnersystem.js');   // SYS-02c: Zonen und Systeme der Gegner (Katalogdaten) fuer die Zonen-Taktik
const BOT_SCHILD_SEKTOR_MAX = 4;   // SYS-01 B2: Bot-Heuristik (Schildverteilung), unabhängig von CONFIG.shields.maxPerSector. SYS-03 C1 (Pool 8, Kappe 8): bleibt bei 4 (Pool 8 = zwei volle Sektoren, die Bedrohungsseite bekommt trotzdem bis 4). Probelauf Arena maneuver, Crew 3, 3 Seeds: Max 4 → 4,7 Wellen/68 Hülle, Max 6 → 5,3/46, Max 8 → 2,3/245 (die anderen Seiten stehen leer). Die Solo-Kette (sim-headless kette, Crew 1, Seed 1, K6 Orbit) gelang ohne Auffüllen nur mit Max 4 (95 min; Max 5, 6, 8: Spielzeit über 14000 s, K6 endet jedes Mal im Rückzug); K6 ist solo ein Glücksspiel (Einstieg k6_orbit Crew 1, Seeds 1–6: 4/6 ok mit Max 6, vor C1 3/6). Mit dem Auffüllen (schildVerteilung: übrige Poolpunkte an die schwächste Nebenseite) laufen beide Kettenläufe (Crew 1: 142 min, Crew 3: 111 min)

// Zufall: ein Halter im Kern. Der Testbot und golden-trace setzen den Strom ueber setSimRng; die Aufrufstellen und ihre Reihenfolge sind unveraendert.
let rngQuelle = makeRng(1);
const setSimRng = (r) => { rngQuelle = r; };
const simRng = () => rngQuelle();

// Statistik: der Testbot zaehlt in game.simStats. Fehlt das Feld (echter Server), zaehlt ein Ersatzobjekt je Spiel (WeakMap), game bleibt unberuehrt.
const ERSATZ_STATISTIK = new WeakMap();
function statistik(game) {
  if (game.simStats) return game.simStats;
  let s = ERSATZ_STATISTIK.get(game);
  if (!s) { s = { reactorRestarts: 0, widescans: 0 }; ERSATZ_STATISTIK.set(game, s); }
  return s;
}

// Ausgabe: --verbose und log kommen vom Aufrufer (sim-headless); der Standard ist still.
const einstellung = { verbose: false, log: (s) => console.log(s) };
function setzeAusgabe(o) { if (o.verbose != null) einstellung.verbose = !!o.verbose; if (o.log) einstellung.log = o.log; }

// M3b §2/§6: Temporegler in Stufen. Die Bots stellen Stufen ein (helm.throttle) und geben nur noch das Ruder.
let Flight = null;
try { Flight = require('../../shared/flight.js'); } catch (e) { Flight = null; }
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
const ZUSATZ_IDS = ['p5', 'p7', 'p9', 'p1', 'p3', 'p2'];   // PAN-01 C: Plätze 5 7 9 1 3 und Heck 2 (nur mit Stufe und Bestückung; Start-Lerche: nie)
const ZONEN_ZIELE = ['korvette', 'fregatte', 'kreuzer'];   // SYS-02c: Klassen, auf die die Taktik das Zonenmodell anwendet
const JAEGER_NACHSETZEN = 550;   // SYS-02c: Abstand, ab dem die Steuer einem Jäger nachsetzt (Waffenreichweite 400)
const LANGSAM_ZIELE = ['fregatte', 'kreuzer'];   // SYS-02c
const SECTOR_OF_SIDE = { port: 3, stbd: 1 };
const EMITTER_OF = ['emitter_bow', 'emitter_stbd', 'emitter_aft', 'emitter_port'];
// Reihenfolge, in der Spieler-Bots zerstörte/beschädigte Systeme angehen (Kampfwert zuerst)
const REPAIR_PRIO = ['shields', 'reactor', 'thruster_port', 'thruster_stbd', 'emitter_port', 'emitter_stbd', 'emitter_bow', 'emitter_aft',
  'battery_port', 'battery_stbd', 'weapon_bow', 'lafette_5', 'lafette_7', 'lafette_9', 'lafette_1', 'lafette_3', 'lafette_2', 'engines', 'transfer'];   // PAN-01 C: Lafetten (nur aktiv mit Bestückung)
const DT = 1 / CONFIG.tickHz;
const TILE = 32;
const norm = Physics.normAngle;
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
function losPx(isSolid, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay; const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 8));
  for (let i = 1; i < n; i++) if (isSolid(Math.floor((ax + dx * i / n) / TILE), Math.floor((ay + dy * i / n) / TILE))) return false;
  return true;
}

class BotKern {
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
    if (o.t === 'event' && o.kind === 'notice' && o.pid === this.pid) { this.notices.push(o.text); if (einstellung.verbose) einstellung.log(`  [notice ${this.pid}] ${o.text}`); }
  }
  send(msg) {
    // M3b §0.8/§6: Die unbesetzte Steuer hält die Stufe (keine Sonderbremse mehr). Wer die Steuer verlässt, stellt
    // vorher auf STOPP – sonst fährt das Schiff davon (z. B. solo vor dem Beamen, Reparaturgang, Reaktor).
    if (msg.t === 'leave') {
      const me = this.game.players.find((p) => p.id === this.pid);
      const h = this.game.ship.helm || {};
      if (me && me.console === 'helm' && typeof h.stage === 'number' && h.stage !== STOP && !this.keepStage) this.send({ t: 'cmd', c: 'helm.throttle', set: STOP });   // ueber send(): ein Server-Agent (bots/mannschaft.js) geht auch hier durch den Wachposten
    }
    this.game.handleMessage(this.conn, msg);
  }
  hello() { this.send({ t: 'hello', clientId: 'sim-' + this.idx, name: ['Ada', 'Bo', 'Cem', 'Dan'][this.idx], color: this.idx }); this.send({ t: 'ready', ready: true }); }
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
      statistik(this.game).throttles = (statistik(this.game).throttles || 0) + 1;
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

  // BOT-01 B3: Zufall und Mitspieler des Agenten. Standard = Testbot (Modulhalter setSimRng, game.simAgents); der Server-Agent (bots/mannschaft.js) ueberschreibt beides mit dem Strom und der Liste seines Games.
  zufall() { return simRng(); }
  kollegen() { return this.game.simAgents || []; }
  me(S) { return S.players.find((p) => p.id === this.pid); }
  tile(p) { return { x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) }; }
  awayMap(S) { return S.away.map === 'wreck' ? Maps.wreck : Maps.platform; }
  walkable(S, zone) {
    if (zone === 'away') {
      const m = this.awayMap(S);
      return (x, y) => { const ch = m.at(x, y); if (ch === 'L' && S.away.map === 'platform') return S.away.doorOpen; if (ch === 'V' && S.away.map === 'wreck') return !!(S.away.hollow && S.away.hollow.open); return !m.solid(x, y); };
    }
    const solid = Maps.shipSolidFn((S.ship && S.ship.st) || 0);   // PAN-01 B: verschalte Pforten öffnen mit der Ausbaustufe
    return (x, y) => !solid(x, y);
  }
  mapFor(S, zone) { return zone === 'away' ? this.awayMap(S) : Maps.ship; }
  pathLinks(S, zone) { return zone === 'ship' ? W.liftLinksFor((S.ship && S.ship.st) || 0) : null; }

  goto(S, goals) {
    const p = this.me(S);
    const map = this.mapFor(S, p.zone);
    const walk = this.walkable(S, p.zone);
    const st = this.tile(p);
    // M4: im Lift warten (Eingaben sind gesperrt); an Bord mit Lift-Kanten planen (Agenten nehmen den Lift, nicht die Leiter)
    if (p.lift) { this.input(0, 0); this.stuckT = 0; return false; }
    const set = new Set(goals.map((g) => g.y * map.w + g.x));
    const path = bfs(walk, st, (x, y) => set.has(y * map.w + x) && walk(x, y), map.w, map.h, null, this.pathLinks(S, p.zone));
    if (!path) { this.input(0, 0); return 'fail'; }
    if (path.length && path[0].via === 'lift') {
      // auf der Liftkachel: zur Mitte, stehen bleiben, E tippen
      const c = Physics.tileCenter(st.x, st.y);
      if (dist(p.x, p.y, c.x, c.y) > 4) { const dx = c.x - p.x, dy = c.y - p.y, l = Math.hypot(dx, dy) || 1; this.input(Math.round(dx / l * 50) / 100, Math.round(dy / l * 50) / 100); return false; }
      // PAN-01 B: E aktiviert den Lift, dann W (hoch) / S (runter) zum Nachbardeck; ist die Wahl offen (players[].lm), nur noch die Richtung drücken
      if (p.lm) {
        const lvl = (ty) => ((Maps.SHIP_DECKS[Maps.deckOf(ty)] || {}).level || 0);
        this.input(0, lvl(path[0].y) > lvl(st.y) ? -1 : 1);
        return false;
      }
      this.input(0, 0);
      if ((this.memo.liftTapAt || -9) < S.time - 0.5) {
        this.memo.liftTapAt = S.time;
        this.send({ t: 'act', down: true }); this.send({ t: 'act', down: false }); this.actDown = false;
        statistik(this.game).liftRides = (statistik(this.game).liftRides || 0) + 1;
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
    if (this.stuckT > 0.6) { this.stuckT = 0; this.jiggle = 0.25; const a = this.zufall() * Math.PI * 2; this.jiggleDir = { x: Math.round(Math.cos(a) * 100) / 100, y: Math.round(Math.sin(a) * 100) / 100 }; }
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
    if (kind === 'kustodenpult') return Maps.platform.find('Z')[0];
    if (kind === 'quartier') { const b = Maps.BEDS.find((q) => q.color === p.color); return { x: b.x, y: b.y }; }
    return consoleTileOf(kind);
  }
  enter(S, kind) {
    const p = this.me(S);
    if (p.console === kind) { this.ix = null; return p.station && p.station !== kind ? this.stationTab(S, kind) : true; }   // SYS-02c: am Ort, aber ein anderes Interface (Tab) aktiv: zurückschalten
    if (p.console) { this.send({ t: 'leave' }); return false; }
    if (p.zone !== 'ship' && kind !== 'kustodenpult') return false;
    if (this.actDown) this.act(false);
    const t = this.consoleTile(kind, p);
    const r = this.interact(S, t.x, t.y, {});
    if (r === 'fail') this.waitT = 0.5;
    // Snapshot kommt nur jeden 2. Tick: kurz warten, bis die Konsole im Snapshot steht (sonst „dreht“ sich der Bot weg)
    if (r === 'done') this.waitT = 0.1;
    return false;
  }
  // SYS-02c: Solo im Gefecht wechselt wie ein Spieler per Tab zwischen Steuer und Ops (Station.tab, ohne Laufweg); ohne Konsole geht der Bot erst hin
  enterTab(S, kind) {
    const p = this.me(S);
    if (p.console && Protocol.STATION_KREIS.includes(p.console) && Protocol.STATION_KREIS.includes(kind)) { this.ix = null; return this.stationTab(S, kind); }
    return this.enter(S, kind);
  }
  leave(S) { const p = this.me(S); if (p.console) this.send({ t: 'leave' }); }
  // R1 §4.4: Interface per Tab-Befehl wechseln, ohne den Ort zu verlassen (Tab-Kreis; belegte Stationen überspringt der Server)
  // (S ist nur der Snapshot-Stand der Bots; die Station liest der Bot aus dem Spielzustand selbst, sonst sieht er seinen eigenen Tab nicht)
  stationTab(S, kind) {
    const p = this.game.players.find((q) => q.id === this.pid);
    for (let i = 0; i < Protocol.STATION_KREIS.length && Station.stationOf(p) !== kind; i++) this.send({ t: 'cmd', c: Protocol.CMD_STATION_TAB, dir: 1 });
    return Station.stationOf(p) === kind;
  }
  // Technik-Befehl des Bots am Captain-Platz: kurz auf die Technik schalten, Befehl senden, zurück auf die vorige Station
  technikCmd(S, c, extra) {
    const p = this.game.players.find((q) => q.id === this.pid); const back = Station.stationOf(p);
    if (!this.stationTab(S, 'technik')) return false;
    this.cmd(c, extra);
    this.stationTab(S, back);
    return true;
  }

  // Reparatur an einer Station (M3a §8.1). how: 'swap' (Ersatzteil holen, E halten 3 s -> ok), 'flick' (E halten 1,5 s, eine Stufe,
  // fragil) oder 'minigame' (R: repair.start, nach 3,5 s repair.done – simuliertes Minispiel). Ohne how: zerstört -> swap, sonst flick.
  repair(S, p, sys, how) {
    const st = S.ship.systems[sys];
    const fragile = (S.ship.fragile || []).includes(sys);
    if ((st === 'ok' && !(how === 'swap' && fragile)) || st === 'offline' || st == null) { this.memo.mg = null; return 'done'; }
    if (p.zone !== 'ship') return 'skip';
    if (p.console) { this.send({ t: 'leave' }); return 'running'; }
    if (sys === 'reactor' && st === 'broken') {   // SYS-01 A2a: der zerstörte Reaktor hat nur die Sonderreparatur (E halten, kein Ersatzteil in der Hand)
      if (p.carry) { this.send({ t: 'drop' }); return 'running'; }
      how = 'flick';
    }
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
      if (mg.t > 0.5 && !(p.action && p.action.kind === 'minigame')) { m.mg = null; this.waitT = 0.5; statistik(this.game).minigameRejected = (statistik(this.game).minigameRejected || 0) + 1; return 'running'; }
      if (mg.t >= 3.5) {
        this.send({ t: 'cmd', c: 'repair.done', system: sys, errors: Math.floor(this.zufall() * 3) });
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
    const mates = this.kollegen().filter((a) => a !== this && a.memo.job);
    const taken = (s) => mates.some((a) => a.memo.job.sys === s && S.time - (a.memo.job.seen || 0) < 2);
    if (m.job && S.time - (m.job.seen || S.time) > 2) { m.job = null; m.mg = null; }   // liegengebliebener Auftrag (Rolle war woanders)
    if (m.job && m.job.sys !== 'reactor' && sh.systems.reactor === 'broken' && !taken('reactor')) { m.job = null; m.mg = null; m.jobCd = 0; this.ix = null; if (this.actDown) this.act(false); }   // SYS-01 C1a-2 Nacharbeit: der zerstörte Reaktor (Countdown) geht jeder anderen Arbeit vor
    if (m.job && botBusy(m.job.sys) && !(p.action && (p.action.kind === 'repair' || p.action.kind === 'minigame')) && S.time - m.job.at > 1) {   // SYS-02c: der Schrauber hat das System übernommen (gleicher Tick der Wahl): nicht doppelt hinlaufen und kein zweites Ersatzteil holen
      m.job = null; m.mg = null; m.jobCd = S.time + (o.cooldown || 4); this.ix = null; if (this.actDown) this.act(false); statistik(this.game).jobAbgegeben = (statistik(this.game).jobAbgegeben || 0) + 1; return false;
    }
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
      .filter((s) => o.damaged || sh.systems[s] === 'broken' || (o.kritisch && s === 'shields'))
      .filter((s) => !o.kritisch || s === 'reactor' || s === 'shields')   // SYS-02c: im Solo-Gefecht nur die kritischen Systeme
      .sort((a, b) => (sh.systems[a] === 'broken' ? 0 : 1) - (sh.systems[b] === 'broken' ? 0 : 1) || (b === 'reactor' && sh.systems.reactor === 'broken' ? 1 : 0) - (a === 'reactor' && sh.systems.reactor === 'broken' ? 1 : 0));   // SYS-01 A2a: der zerstörte Reaktor (Countdown) zuerst
    const sys = cand[0];
    if (!sys) return false;
    const st = sh.systems[sys];
    const pressure = S.space.enemies.some((e) => e.tele);
    let how;
    if (st === 'broken') how = S.inventory.ersatzteil > 0 && !pressure && sys !== 'reactor' ? 'swap' : 'flick';   // SYS-01 A2a: Reaktor nur Sonderreparatur
    else how = pressure || o.fast ? 'flick' : 'minigame';
    m.job = { sys, how, from: st, at: S.time, seen: S.time, kritisch: !!o.kritisch };
    m.jobCd = S.time + (o.cooldown || 4);
    statistik(this.game).jobs = statistik(this.game).jobs || {};
    statistik(this.game).jobs[how] = (statistik(this.game).jobs[how] || 0) + 1;
    return this.repair(S, p, sys, how) === 'running';
  }

  // ---------- Flug ----------
  steer(S, tx, ty, arriveDist, maxSpd) {
    const sh = S.ship;
    const gd = Math.hypot(tx - sh.x, ty - sh.y) || 1;
    if (S.space.asteroids) this.memo.asteroids = S.space.asteroids;
    if (this.memo.astScene !== sh.scene && S.space.asteroids) this.memo.astScene = sh.scene;
    // W2 AP3b: bewegte Brocken (Wellen All) mit derselben Drift-Funktion wie Server und Client; still: unverändert
    const rocks = this.memo.astScene === sh.scene ? Drift.jetzt(this.memo.asteroids || [], S.time) : [];
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
    if (!still && sh.speed > 15 && !sh.helm.autoStop && (this.memo.stopAt || 0) < S.time) { this.memo.stopAt = S.time + 1.5; this.cmd('helm.stop'); statistik(this.game).allStops = (statistik(this.game).allStops || 0) + 1; }
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
  // Freifliegen für den Sprung: ablegen, Abstand zur Station gewinnen, dann den Sprungpunkt der Kante zum Ziel anfliegen
  // (space.jp, ship.jump.jp), sonst stehen. W1 AP2: Bojenanflug aus GenericAgent hochgezogen – gilt seit E29-Nachtrag
  // auch im Tutorial.
  flyClear(S) {
    const sh = S.ship; const j = sh.jump || {};
    const jp = j.jp && (S.space.jp || []).find((q) => q.k === j.jp);
    if (jp && /^Sprungpunkt/.test(j.blockedReason || '')) {
      if (sh.docked) { this.helmS(S, 0, QUARTER); return; }
      // festgefahren (Brocken im Splittergürtel): kommt der Sprungpunkt 3 s nicht näher, 2 s zurücksetzen (W1 AP2: sonst
      // klemmt die Lerche am Szenenrand vor einem Brocken), dann 5 s seitlich ausweichen
      const m = this.memo; const d = dist(sh.x, sh.y, jp.x, jp.y);
      if (m.jpKey !== j.jp) { m.jpKey = j.jp; m.jpBest = null; m.detour = null; }
      if (m.jpBest == null || d < m.jpBest - 20) { m.jpBest = d; m.jpAt = S.time; }
      if (!m.detour && S.time - m.jpAt > 3) {
        const a = Math.atan2(jp.y - sh.y, jp.x - sh.x) + ((m.detourN = (m.detourN || 0) + 1) % 2 ? Math.PI / 2 : -Math.PI / 2);
        m.detour = { x: clamp(sh.x + Math.cos(a) * 350, 100, (S.space.w || 2400) - 100), y: clamp(sh.y + Math.sin(a) * 350, 100, (S.space.h || 1400) - 100), back: S.time + 2, until: S.time + 7 };
      }
      if (m.detour && S.time < m.detour.back) { this.helmS(S, 0, STOP - 1); return; }
      if (m.detour && S.time < m.detour.until) { this.steer(S, m.detour.x, m.detour.y, 40, 120); return; }
      if (m.detour) { m.detour = null; m.jpBest = null; }
      // Ziel 180 px vom Szenenrand fernhalten (Sprungpunkte in Eckrichtung liegen nur ~90 px vom Rand; dort klemmt die
      // Lerche vor Brocken fest). Höchstens ~130 px neben dem Sprungpunkt, + 80 Ankunft < sprungpunktRadius 250.
      const tx = clamp(jp.x, 180, (S.space.w || 2400) - 180), ty = clamp(jp.y, 180, (S.space.h || 1400) - 180);
      this.steer(S, tx, ty, 80, 160); return;
    }
    this.flyClearStation(S);
  }
  // Abstand zur Station gewinnen (Mindestabstand ≥ 300 gilt weiter), sonst stehen
  flyClearStation(S) {
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
  // SYS-01 C1a-2 Nacharbeit: Gegner mit laufendem Reaktor-Countdown sind so gut wie tot (Ziel-Snapshot: letztes Element von ship.zielSys = Restzehntel, -1 kein Countdown);
  // der Bot wendet sich dem nächsten zu, statt am Sterbenden zu stehen (Golden m2/1: drei Pylone je 20 s Countdown). Sind alle am Sterben, bleibt es bei allen.
  lebende(S) {
    const sh = S.ship; const sterbend = this.memo.sterbend || (this.memo.sterbend = {});
    const z = sh.zielSys;
    if (sh.target && z && z.length && z[z.length - 1] >= 0) sterbend[sh.target] = true;
    const live = S.space.enemies.filter((e) => !sterbend[e.id]);
    return live.length ? live : S.space.enemies;
  }
  // SYS-02c: Zonenmodell für die Taktik. Das Ziel wird gescannt (nur dann zeigt der Snapshot Zonen und wählbare Systeme). Mit gescanntem Ziel: ist die zugewandte Seite leer (offene Wand),
  // wird der Reaktor Systemziel (er zerstört den Gegner über den Countdown); sonst ein System der zugewandten Zone (Emitter zuerst: ein zerstörter Emitter nimmt der Seite den Schild,
  // dann Waffen, damit die Zone leer wird). Alles nur aus dem Snapshot (zielZon, zielWahl) und den Katalogdaten; gewählt wird höchstens alle 0,5 s.
  zonenZiel(S, target, M) {
    const sh = S.ship; const m = this.memo;
    if (!ZONEN_ZIELE.includes(target.kind)) return;   // Jäger: zu schnell für Scan und Systemziel (Messung SYS-02c: schlechter als ohne)
    if (!target.scanned) {
      if (dist(target.x, target.y, sh.x, sh.y) < 780 && (this.memo.scanUntil || 0) < S.time + 10) { this.scanT -= DT; if (this.scanT <= 0) { this.scanT = 0.3; this.cmd('weapons.scan', { on: true }); } }
      return;
    }
    const z = sh.zielZon; const defs = Gsys.systemeVon(target.kind);
    if (!z || !defs || z.z < 0 || sh.target !== target.id || (m.zsAt2 || 0) > S.time) return;
    const zone = Gsys.SEITE_ZONE[z.z];
    const wahl = (sh.zielWahl || []).map((i) => defs[i]).filter(Boolean);
    const inZone = wahl.filter((d) => d.zone === zone);
    let want = null;
    if (z.leer[z.z] === 1) { const r = wahl.find((d) => d.art === 'reaktor'); want = r ? r.id : null; }
    else want = ((inZone.find((d) => d.art === 'emitter') || inZone.find((d) => d.art === 'waffe') || inZone[0]) || {}).id || null;
    if (want === (sh.zs || null)) return;
    m.zsAt2 = S.time + 0.5;
    this.cmd('weapons.systemziel', { id: want });
    statistik(this.game).zonenZiele = (statistik(this.game).zonenZiele || 0) + (want ? 1 : 0);
    if (want && defs.find((d) => d.id === want).art === 'reaktor') statistik(this.game).reaktorZiele = (statistik(this.game).reaktorZiele || 0) + 1;
  }
  // Zielwahl der Ops (aus fight() herausgezogen, BOT-01 B3, unveraendert): Gegner, der gerade laedt (Treffer verzoegern die Ladung), sonst einer im Bogen, sonst der naechste.
  // Der Server-Agent (bots/mannschaft.js) ueberschreibt sie: ein von anderen markiertes Ziel geht vor.
  waehleZiel(S, enemies, M) {
    const sh = S.ship;
    const any = (e) => MOUNT_IDS.some((id) => this.inArcM(S, M[id], e));
    const byDist = (a, b) => dist(a.x, a.y, sh.x, sh.y) - dist(b.x, b.y, sh.x, sh.y);
    const cur = enemies.find((e) => e.id === sh.target);
    // Ziel: Gegner, der gerade lädt (Treffer verzögern die Ladung), sonst einer im Bogen, sonst der nächste
    const charging = enemies.filter((e) => e.tele && any(e)).sort(byDist)[0];
    // M3b §6: Jäger im Anflug (state approach) vor dem Bug -> Lanze auf die Anfluglinie (sie fliegen gerade auf uns zu)
    const incoming = enemies.filter((e) => e.kind === 'raider' && /^app/.test(e.state || '') && this.onApproachLine(S, e)).sort(byDist)[0];
    const lanceReady = M.bow && M.bow.state !== 'broken' && (M.bow.charge >= 1 || M.bow.charging);
    return charging || (incoming && lanceReady ? incoming : null) || (cur && any(cur) ? cur : null) || enemies.filter(any).sort(byDist)[0] || cur || enemies.slice().sort(byDist)[0];
  }
  fight(S, opts) {
    const sh = S.ship;
    const enemies = this.lebende(S);
    const M = this.mountsOf(S);
    // §20.3: Lanze lädt noch, aber keine Gegner mehr -> loslassen (ins Leere)
    if (!enemies.length) { if (M.bow && M.bow.charging) this.cmd('weapons.charge', { mount: 'bow', on: false }); return; }
    const target = this.waehleZiel(S, enemies, M);
    if (sh.target !== target.id) { this.cmd('weapons.target', { id: target.id }); return; }
    // Scan vorab (Taktik-Rolle): zeigt Schilde/Feuerbögen
    if (opts && opts.scan && !target.scanned && dist(target.x, target.y, sh.x, sh.y) < 780 && (this.memo.scanUntil || 0) < S.time + 10) {
      this.scanT -= DT; if (this.scanT <= 0) { this.scanT = 0.3; this.cmd('weapons.scan', { on: true }); }
    }
    this.allocFor(S, target, M);
    if (!(opts && (opts.lanzeHalten || opts.zonen === false)) && this.opts.zonen !== false) this.zonenZiel(S, target, M);   // SYS-02c: Zonenmodell (Scan, Systemziel)
    if (opts && opts.lanzeHalten) return;   // C1b-1: die Verfolgung hält alle Waffen, bis das Systemziel Antrieb steht (sonst stellt ein früher Heck-Treffer das Ziel)
    this.lanceFight(S, target, M);
    // §20.4: Batterien feuern nur auf Befehl – geladene Batterie mit einem Gegner im Bogen (Reaktion wie ein Mensch, ~0,3 s)
    const bat = ['port', 'stbd'].filter((id) => M[id] && M[id].charge >= 1 && !(M[id].salvo > 0) && M[id].state !== 'broken' && enemies.some((e) => this.inArcM(S, M[id], e, 6)));
    if (bat.length && (this.memo.batAt || 0) < S.time) {
      this.memo.batAt = S.time + 0.3;
      this.cmd('weapons.fire', { mount: bat.length === 2 ? 'all' : bat[0] });
    }
    this.fightZusatz(S, target, M, enemies);
  }
  // PAN-01 C: Plätze 5 7 9 1 3 und Heck 2 bedienen: Salvenwaffen feuern, wenn ein Gegner in ihrem Bogen liegt (je Mount, alle 0,3 s); der Torpedowerfer auf das Ziel im Heckbogen,
  // der Abwehrturm auf einen Jäger im Nahbereich (besetzt feuert er nur auf Befehl); Lanzen auf Zusatzplätzen bleiben unbedient (die Taktik hält nur die Bug-Lanze)
  fightZusatz(S, target, M, enemies) {
    const ids = ZUSATZ_IDS.filter((id) => M[id] && M[id].state !== 'broken');
    if (!ids.length || (this.memo.zusatzAt || 0) > S.time) return;
    const sh = S.ship; let fired = false;
    for (const id of ids) {
      const m = M[id]; const typ = m.typ || '';
      if (typ === 'torpedowerfer') {
        if (m.charge >= 1 && (m.ammo || 0) > 0 && this.inArcM(S, m, target)) { this.cmd('weapons.fire', { mount: id }); fired = true; statistik(this.game).torpedos = (statistik(this.game).torpedos || 0) + 1; }
      } else if (typ === 'abwehrturm') {
        if (m.charge >= 1 && !(m.salvo > 0) && enemies.some((e) => e.kind === 'raider' && dist(e.x, e.y, sh.x, sh.y) < 240)) { this.cmd('weapons.fire', { mount: id }); fired = true; }
      } else if (m.power === undefined && m.salvo !== undefined) {
        if (m.charge >= 1 && !(m.salvo > 0) && enemies.some((e) => this.inArcM(S, m, e, 6))) { this.cmd('weapons.fire', { mount: id }); fired = true; }
      }
    }
    if (fired) this.memo.zusatzAt = S.time + 0.3;
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
        statistik(this.game).lanceCharges = (statistik(this.game).lanceCharges || 0) + 1;
        statistik(this.game).lanceRaiderCharges = (statistik(this.game).lanceRaiderCharges || 0) + 1;
        return;
      }
      if (bow.charge >= 1 && rel < 0.45 && d < bow.range + 150 && (m.lanceAt || 0) < S.time) {
        m.lanceVsRaider = false;
        m.lanceAt = S.time + 0.4; m.lanceT0 = S.time;
        this.cmd('weapons.charge', { mount: 'bow', on: true });
        statistik(this.game).lanceCharges = (statistik(this.game).lanceCharges || 0) + 1;
      }
      return;
    }
    const hit = this.lanceLineHit(S);
    const leaving = m.lanceRel != null && rel > m.lanceRel + 0.002;
    m.lanceRel = rel;
    const long = S.time - (m.lanceT0 || S.time) > 8;
    // Jäger quert die Linie nur kurz (200 px/s): ab halber Ladung sofort feuern
    const raiderOnLine = hit && hit.kind === 'raider' && bow.power >= 0.4;
    // C1b-1: mit Systemziel (Heck) nie bis zur Vollladung laden: Vollladung durchschlägt bis in die Mitte und träfe nicht das Ziel; ab 0,85 lösen
    if ((hit && (bow.power >= 0.85 || (leaving && bow.power >= 0.4) || long || raiderOnLine)) || (sh.zs && bow.power >= 0.85)) {
      this.cmd('weapons.charge', { mount: 'bow', on: false });
      m.lanceAt = S.time + 0.4;
    }
  }
  // Ladepunkte nach Lage: Ziel vorn -> Lanze, Ziel seitlich -> Batterie dieser Seite (mit Hysterese, alle 2 s neu)
  allocFor(S, target, M) {
    const sh = S.ship; const m = this.memo;
    const P = sh.chargePoints != null ? sh.chargePoints : 4;
    if (!M.bow || !M.port || !M.stbd) return;
    if (ZUSATZ_IDS.some((id) => M[id] && M[id].alloc !== undefined && M[id].state !== 'broken')) return this.allocForAlle(S, target, M);   // PAN-01 C: mehr als drei Energiewaffen
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

  // PAN-01 C: Ladepool auf alle Energiewaffen: die Halterungen, die dem Ziel am nächsten zeigen, bekommen zuerst (je höchstens allocMax), der Rest ist Reserve
  allocForAlle(S, target, M) {
    const sh = S.ship; const m = this.memo;
    const P = sh.chargePoints != null ? sh.chargePoints : 4;
    const ids = Object.keys(M).filter((id) => M[id].alloc !== undefined && M[id].state !== 'broken');
    if (!m.allocWant || (m.allocAt || 0) < S.time) {
      const rel = norm(Math.atan2(target.y - sh.y, target.x - sh.x) - sh.angle) * 180 / Math.PI;
      const diff = (id) => Math.abs(norm((rel - M[id].facing) * Math.PI / 180)) * 180 / Math.PI;
      const order = ids.map((id, i) => ({ id, i, d: diff(id) })).sort((a, b) => (a.d - b.d) || (a.i - b.i)).map((q) => q.id);
      const want = {}; for (const id of ids) want[id] = 0;
      let left = P;
      for (const id of order) { const k = Math.min(M3.allocMax || 4, left); want[id] = k; left -= k; }
      m.allocWant = want; m.allocAt = S.time + 2;
    }
    if ((m.allocCmdAt || 0) > S.time) return;
    const w = m.allocWant;
    const down = ids.find((id) => M[id].alloc > (w[id] || 0));
    const up = ids.find((id) => M[id].alloc < (w[id] || 0));
    const sum = ids.reduce((a, id) => a + M[id].alloc, 0);
    if (down && (sum >= P || !up)) { this.cmd('weapons.alloc', { mount: down, delta: -1 }); m.allocCmdAt = S.time + 0.3; }
    else if (up && sum < P) { this.cmd('weapons.alloc', { mount: up, delta: 1 }); m.allocCmdAt = S.time + 0.3; }
  }

  // ---------- Steuer im Kampf (M3a §14, M3b §6): nose = Bug aufs Ziel bei ½–¾, maneuver = Breitseite, Stufe nach Lage ----------
  pilot() { return this.opts.pilot || 'nose'; }
  // Bezugsgegner der Steuer: gefährliche Schiffe (Korvette, Pylon, Wächter) vor Jägern, jeweils der nächste
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
    if (M.bow && M.bow.charging) statistik(this.game).lanceHelmSeen = (statistik(this.game).lanceHelmSeen || 0) + 1;
    // M3b: Jäger fliegen Überflüge (approach -> overshoot -> turn). Hinterherdrehen lohnt nicht (1,1 rad/s gegen 0,6):
    // Kurs halten bei ½ (wendig für den nächsten Anflug), die Taktik nimmt sie auf der Anfluglinie mit der Lanze.
    // QA M3b: „circle“ = bekannte Lücke prüfen – Dauerkreis bei ½ mit leichtem Ruder (0,3), egal was kommt
    if (this.pilot() === 'circle') { this.dodgeTele(S); this.helmS(S, 0.3, HALF); return; }
    // SYS-02c: Ein Jäger ohne Waffe zieht sich zurück (Rückzug, Countdown steht nicht an) und kehrt ohne Reparatur nie wieder: der Bot setzt ihm nach, statt den Kurs zu halten (Messung: 9 von 79 Wellen zu dritt nicht beendet)
    if (e.kind === 'raider' && dist(sh.x, sh.y, e.x, e.y) > JAEGER_NACHSETZEN) { this.steer(S, e.x, e.y, 330, 220); return; }
    if (e.kind === 'raider' || e.kind === 'relay') this.helmS(S, this.turnCmd(S, this.randNachMitte(S)), HALF);   // SYS-01 C1a-2 Nacharbeit: Kurs halten, am Kartenrand zur Mitte (sonst steht die Lerche mit dem Bug an der Wand, ein Jäger mit Restintegrität fliegt Kreise außer Bogen)
    else if (this.pilot() === 'maneuver') this.helmManeuver(S, e, LANGSAM_ZIELE.includes(e.kind) ? { slow: true } : undefined);   // SYS-02c: gegen langsame Kampfschiffe (Kreuzer 32 px/s) stehen bleiben: die Breitseite schleppt das Ziel mit (es kreist auf Lerche ± 90°), mit ½-Tempo läuft es ab und feuert aus der Reichweite
    else this.aimHelm(S, e, e.kind === 'pylon' || e.kind === 'relay' ? 380 : 450);
    // Reflex beider Strategien: Ausweichrolle vor einem nahen Projektil
    if (S.space.projectiles.some((q) => (q.kind === 'enemy' || q.kind === 'emp') && dist(q.x, q.y, sh.x, sh.y) < 90) && sh.dodgeCd === 0 && (this.memo.dodgeAt || 0) < S.time) { this.memo.dodgeAt = S.time + 1; this.cmd('helm.dodge', { dir: this.zufall() < 0.5 ? -1 : 1 }); }
  }
  // Drehwunsch (rad, relativ zum Bug) zur Kartenmitte, wenn das Schiff im Randstreifen liegt; sonst 0 (Kurs halten)
  randNachMitte(S) {
    const sh = S.ship; const w = S.space.w || 2400, h = S.space.h || 1400, rand = 160;
    if (sh.x > rand && sh.y > rand && sh.x < w - rand && sh.y < h - rand) return 0;
    return norm(Math.atan2(h / 2 - sh.y, w / 2 - sh.x) - sh.angle);
  }
  dodgeTele(S) {
    const sh = S.ship; const m = this.memo; const W = M3.dodgeWindow || 0.8;
    m.dodgePlan = m.dodgePlan || {};
    for (const id of Object.keys(m.dodgePlan)) if (!S.space.enemies.some((e) => e.id === id && e.tele)) delete m.dodgePlan[id];
    if (sh.dodgeCd > 0 || sh.docked) return;
    for (const e of S.space.enemies) {
      if (!e.tele || e.tele.left > W) continue;
      if (!m.dodgePlan[e.id]) m.dodgePlan[e.id] = { at: 0.1 + this.zufall() * (W - 0.25) };
      if (e.tele.left <= m.dodgePlan[e.id].at) {
        const rel = norm(Math.atan2(e.y - sh.y, e.x - sh.x) - sh.angle);
        this.cmd('helm.dodge', { dir: rel < 0 ? 1 : -1 });   // vom Gegner weg
        statistik(this.game).teleDodges = (statistik(this.game).teleDodges || 0) + 1;
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
      const cur = sh.shields.current[sec] || 0; const cap = sh.shields.cap ? sh.shields.cap[sec] : 8;
      const bat = sh.systems['battery_' + side];
      return cur + cap * 0.5 + (bat === 'ok' ? 2 : bat === 'damaged' ? 1 : -2);
    };
    if (!m.side) m.side = norm(bearing - sh.angle) < 0 ? 'port' : 'stbd';
    const other = m.side === 'port' ? 'stbd' : 'port';
    if ((m.sideAt || 0) < S.time && sideScore(other) >= sideScore(m.side) + 2) { m.side = other; m.sideAt = S.time + 8; statistik(this.game).sideSwitches = (statistik(this.game).sideSwitches || 0) + 1; }
    const s = m.side === 'stbd' ? 1 : -1;
    // Ladung eines Gegners, der uns im Bogen hat: wegdrehen auf VOLL (aus Bogen/Reichweite)
    const threat = S.space.enemies.find((q) => q.tele && q.tele.left > 0.4 && dist(q.x, q.y, sh.x, sh.y) < 620);
    const delta = clamp((d - 400) / 250, -0.4, 0.4);   // > 0: näher ran (Ziel etwas mehr nach vorn), < 0: Abstand gewinnen
    if (threat && !(opts && opts.slow)) {
      const tb = Math.atan2(threat.y - sh.y, threat.x - sh.x);
      const away = norm(tb + Math.PI);
      const relAway = norm(away - sh.angle);
      const heading = Math.abs(relAway) < 2.2 ? away : norm(tb - s * (Math.PI / 2 + 0.9));
      if (!m.evading || m.evading !== threat.id) { m.evading = threat.id; statistik(this.game).evades = (statistik(this.game).evades || 0) + 1; }
      const hd = norm(heading - sh.angle);
      this.helmS(S, this.turnCmd(S, hd), Math.abs(hd) > 0.8 ? HALF : FULL);
      return;
    }
    m.evading = null;
    const heading = norm(bearing - s * (Math.PI / 2 - delta));
    const hd = norm(heading - sh.angle);
    let stage;
    if (opts && opts.slow) stage = Math.abs(hd) > 0.3 ? HALF : (d > 480 ? (d > 700 ? THREEQ : d > 560 ? HALF : QUARTER) : STOP);   // SYS-02c: weit weg (Ziel zieht sich zurück, repariert) nachsetzen, nah stehen
    else if (Math.abs(hd) > 0.5) stage = HALF;   // Wenden
    else {
      // Tempo des Ziels längs unseres Kurses mitgehen (Breitseite halten), weit weg ¾
      const ev = (e.vx || 0) * Math.cos(sh.angle) + (e.vy || 0) * Math.sin(sh.angle);
      stage = d > 600 ? THREEQ : clamp(this.stageFor(Math.max(stageSpeedOf(HALF), ev + 10)), HALF, THREEQ);
    }
    this.helmS(S, this.turnCmd(S, hd), stage);
  }
  nearestEnemy(S) { const sh = S.ship; let e = null, ed = Infinity; for (const o of this.lebende(S)) { const d = dist(sh.x, sh.y, o.x, o.y); if (d < ed) { ed = d; e = o; } } return e; }

  // ---------- Captain (M3b §6: kein Schildstoß mehr; Schildverteilung zur Bedrohung, Reparaturliste) ----------
  // Bedrohung = Sektor einer laufenden Ladung, sonst der Sektor des gefährlichsten nahen Gegners (Korvette/Pylon/Wächter
  // vor Jägern). Ab Stärke 3 lässt ein Sektor nichts mehr durch (spaceM3b.shieldLeak) – dorthin wandern die Punkte,
  // zuerst aus dem Sektor gegenüber. Ein Punkt je Sekunde (wie ein Mensch am Regler).
  threatSector(S) {
    const sh = S.ship;
    const tele = S.space.enemies.filter((e) => e.tele).sort((a, b) => a.tele.left - b.tele.left)[0];
    if (tele) return tele.tele.sector;
    const danger = (e) => (['korvette', 'fregatte', 'kreuzer', 'pylon', 'sentinel'].includes(e.kind) ? 0 : 250) + dist(e.x, e.y, sh.x, sh.y);
    const e = S.space.enemies.filter((o) => o.kind !== 'relay').sort((a, b) => danger(a) - danger(b))[0] || this.nearestEnemy(S);
    return e ? Physics.sectorOf(sh.x, sh.y, sh.angle, e.x, e.y) : null;
  }
  captainFight(S, p) {
    if (!this.enter(S, 'captain')) return;
    this.schildVerteilung(S);
    this.queueRepairs(S);
  }
  // BOT-01 B3: Technik als eigene Rolle (Konsole technik direkt, kein Tab ueber den Captain-Platz): Schilde verteilen, Reparaturliste fuellen.
  // technikCmd schaltet nicht um, wenn der Bot schon an der Technik steht (stationTab sieht stationOf == technik).
  technikDienst(S, p) {
    if (!this.enter(S, 'technik')) return;
    this.schildVerteilung(S);
    this.queueRepairs(S);
  }
  // Schildpunkte zur Bedrohung verteilen (Captain; SYS-02c: auch Solo im Gefecht per Tab auf die Technik, wie ein Spieler)
  schildVerteilung(S) {
    const sh = S.ship; const m = this.memo;
    if ((m.shieldAt || 0) < S.time && S.space.enemies.length) {
      m.shieldAt = S.time + 1;
      const sec = this.threatSector(S);
      const al = sh.shields.alloc; const cap = (sh.shields.cap || [8, 8, 8, 8]).map((x) => Math.min(x, BOT_SCHILD_SEKTOR_MAX));   // SYS-03 C1: der Bot bündelt höchstens BOT_SCHILD_SEKTOR_MAX je Sektor (Pool 8, Kappe 8); ein Spieler darf auf 8 bündeln
      if (sec != null && al[sec] < cap[sec]) {
        const opp = (sec + 2) % 4;
        const donor = [0, 1, 2, 3].filter((i) => i !== sec && al[i] > 0).sort((a, b) => (b === opp ? 1 : 0) - (a === opp ? 1 : 0) || al[b] - al[a])[0];
        const pool = sh.shields.pool != null ? sh.shields.pool : 8;
        const used = al.reduce((a, b) => a + b, 0);
        if (used < pool) this.technikCmd(S, 'technik.shield', { sector: sec, delta: 1 });
        else if (donor != null) { this.technikCmd(S, 'technik.shield', { sector: donor, delta: -1 }); this.technikCmd(S, 'technik.shield', { sector: sec, delta: 1 }); }
        statistik(this.game).shieldMoves = (statistik(this.game).shieldMoves || 0) + 1;
      } else if (sec != null) {
        // SYS-03 C1 (Pool 8): die Bedrohungsseite ist voll; ungenutzte Punkte des Pools gehen an die schwächste der übrigen Seiten (die mit dem wenigsten Zugeteilten; bei Gleichstand in der Reihenfolge Bug, Steuerbord, Backbord, Heck), sonst lägen sie brach
        const pool = sh.shields.pool != null ? sh.shields.pool : 8;
        const used = al.reduce((a, b) => a + b, 0);
        const ziel = [0, 1, 3, 2].filter((i) => i !== sec && al[i] < cap[i]).sort((a, b) => al[a] - al[b])[0];
        if (used < pool && ziel != null) { this.technikCmd(S, 'technik.shield', { sector: ziel, delta: 1 }); statistik(this.game).shieldMoves = (statistik(this.game).shieldMoves || 0) + 1; }
      }
    }
  }
  // Der Testbot fuehrt die Reparaturliste selbst und schaltet die Bot-Automatik der Schrauber dafuer ab (setzt botAutoChosen: die Wahl gilt bis Partieende). true = abgeschaltet, in diesem Schritt nichts weiter.
  // Der Server-Agent (bots/mannschaft.js) ueberschreibt das: er sendet technik.botAuto nie, die Schwelle botAutomatikStandard entscheidet.
  automatikAbschalten(S) { this.technikCmd(S, 'technik.botAuto', { on: false }); return true; }
  // Reparaturliste füllen (zu dritt; solo macht das die Automatik). Läuft in jedem Missionsschritt, sobald der Captain an der Konsole ist.
  queueRepairs(S) {
    const sh = S.ship; const m = this.memo;
    if (this.opts.queue !== false && (m.queueAt || 0) < S.time) {
      m.queueAt = S.time + 1.5;
      if (sh.botAuto && this.automatikAbschalten(S)) return;
      // QA S2b: Die Schrauber nehmen die Reparaturliste vor Feuer. Brennt es nach einem harten Gefecht an mehreren Stellen,
      // bricht das Feuer frisch Geflicktes sofort wieder (Golden m1/3 Seed 8: Triebwerk 5 Min. im Kreis geflickt, kein
      // Sprung). Wie ein Mensch: Captain stellt „Feuer zuerst“, solange es brennt und kein Gegner mehr da ist (oder ≥ 3 Brände).
      const fires = (sh.fires || []).length;
      const wantFire = fires > 0 && (!S.space.enemies.some((e) => e.kind !== 'relay') || fires >= 3);
      if (wantFire && !m.firePrio) { m.firePrio = true; this.technikCmd(S, 'technik.priority', { target: 'fire' }); return; }
      if (!wantFire && m.firePrio) { m.firePrio = false; this.technikCmd(S, 'technik.priority', { target: null }); }
      const q = sh.repairQueue || [];
      if (sh.systems.reactor === 'broken' && (!q.length || q[0].system !== 'reactor')) { this.technikCmd(S, 'technik.priority', { target: 'reactor' }); return; }   // SYS-01 A2a: zerstörter Reaktor (Countdown) an die Spitze der Reparaturliste
      const busyPlayer = (s) => this.kollegen().some((a) => a.memo.job && a.memo.job.sys === s && S.time - (a.memo.job.seen || 0) < 2);
      const want = REPAIR_PRIO.filter((s) => (sh.systems[s] === 'broken' || sh.systems[s] === 'damaged') && !busyPlayer(s))
        .sort((a, b) => (sh.systems[a] === 'broken' ? 0 : 1) - (sh.systems[b] === 'broken' ? 0 : 1));
      for (const s of want) {
        if (q.length >= (M3.repair ? M3.repair.queueMax : 3)) break;
        if (q.some((x) => x.system === s)) continue;
        const mode = sh.systems[s] === 'broken' && S.inventory.ersatzteil > 0 ? 'part' : 'flick';
        this.technikCmd(S, 'technik.repair', { system: s, mode });
        if (einstellung.verbose) einstellung.log(`  [Captain ${S.time}] Reparaturliste: ${s} ${mode} -> ${JSON.stringify(this.game.ship.repairQueue)} ${this.notices.slice(-1)}`);
        statistik(this.game).queued = (statistik(this.game).queued || 0) + 1;
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
      // SYS-02c: im Gefecht verlässt Solo die Konsole nur noch für den Reaktor oder die Schilde (kritisch); Triebwerke, Emitter, Batterien u. a. macht der Schrauber (Reparaturliste, Automatik an).
      // Vorher lief der Bot für jedes zerstörte System zum Regal und zur Station (20–30 s je Gang), während der Gegner das Heck weiter traf: Schleife aus Gang, Treffer, Ausfall, Gang, ohne Steuer und Ops.
      const kritisch = ['reactor', 'shields'].some((k) => sh.systems[k] === 'broken' || sh.systems[k] === 'damaged');
      if ((kritisch || (this.memo.job && this.memo.job.kritisch)) && (this.memo.job || (!threat && (this.memo.offArc || 0) < 1))) { if (this.repairDuty(S, p, { cooldown: 15, kritisch: !!kritisch })) return; }
      if (p.console && Protocol.STATION_KREIS.includes(p.console) && this.opts.soloSchild !== false) this.schildVerteilung(S);   // SYS-02c: Solo verteilt die Schildpunkte wie der Captain (kurz per Tab auf die Technik)
      const M = this.mountsOf(S);
      // SYS-02c: gegen alles außer Jägern zählt nur der Bogen der Seitenbatterien (Breitseite) bzw. des Bugs (nose); die Lanze allein (Reichweite 650) hielt den Bot an einem Pylon fest, den er nur mit der Lanze beschoss (Golden m2/relay solo)
      const inAny = (e.kind === 'raider' ? MOUNT_IDS : (this.pilot() === 'nose' ? ['bow'] : ['port', 'stbd'])).some((id) => M[id] && M[id].state !== 'broken' && this.inArcM(S, M[id], e, 4));
      if (!inAny) this.memo.offArc = (this.memo.offArc || 0) + DT; else this.memo.offArc = 0;
      if (this.memo.turning || this.memo.offArc > (e.kind === 'raider' ? 8 : 3)) {
        // Solo: kurz ans Steuer und das Ziel in einen Bogen drehen (nose: Bug, maneuver: Breitseite), dann zurück an die Taktik
        this.memo.turning = true;
        if (!this.enterTab(S, 'helm')) return;   // SYS-02c: per Tab, kein Laufweg
        const want = this.pilot() === 'nose' ? ['bow'] : ['port', 'stbd'];
        if (this.pilot() === 'maneuver') this.helmManeuver(S, e, { slow: true }); else this.aimHelm(S, e, e.kind === 'pylon' || e.kind === 'relay' ? 380 : 450, { slow: true });
        const M2 = this.mountsOf(S);
        if (want.some((id) => M2[id] && this.inArcM(S, M2[id], e, id === 'bow' ? 6 : 24)) && Math.abs(sh.turnVel || 0) < 0.12) { this.helmS(S, this.turnCmd(S, 0), STOP); this.memo.turning = false; this.memo.offArc = 0; }
        if ((this.memo.turnT = (this.memo.turnT || 0) + DT) > 12) { this.memo.turning = false; this.memo.turnT = 0; this.memo.offArc = 0; }
        return;
      }
      this.memo.turnT = 0;
      if (this.enterTab(S, 'weapons')) this.fight(S);
      return;
    }
    if (this.role === 'weapons') {
      // Zu dritt verlässt die Taktik die Brücke für Reparaturen (die Waffen feuern unbesetzt mit 50 % weiter).
      // R1 §4.5: Ab 3 Spielern gibt es keine Waffenautomatik – die Taktik bleibt im Gefecht an der Konsole, solange eine Waffe feuern kann;
      // sind alle drei Waffen zerstört, geht sie reparieren (wie ein Mensch, der an der Konsole nichts mehr tun kann).
      const ohneAutomatik = Crew.koepfe(this.game) > this.game.C.waffenAutomatikMaxSpieler;
      const feuerbereit = ['weapon_bow', 'battery_port', 'battery_stbd'].some((w) => S.ship.systems[w] !== 'broken');
      if (!(ohneAutomatik && feuerbereit) && this.repairDuty(S, p, { damaged: true, cooldown: 6 })) return;
      if (this.enter(S, 'weapons')) this.fight(S, { scan: true });
      return;
    }
    if (this.role === 'helm') {
      // Gelähmte Steuerung (Triebwerke/Antrieb zerstört): ein Mensch kann am Ruder nichts tun und repariert selbst
      const sys = S.ship.systems;
      const gelaehmt = sys.engines === 'broken' || (sys.thruster_port === 'broken' && sys.thruster_stbd === 'broken');
      if (this.memo.job || (gelaehmt && !S.space.enemies.some((e) => e.tele && e.tele.left < 1.5))) { if (this.repairDuty(S, p, { cooldown: 4 })) return; }
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
      if (d.alive === false || (giveUp[d.id] || 0) > S.time) continue;
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

  is(role) { return this.role === 'solo' || this.role === role; }
  teamOnShipCaptain(S) { return S.players.some((o) => o.id !== this.pid && o.zone === 'ship' && o.console === 'captain'); }

  // Reaktor offline: Schalter A halten (Steuer-Spieler im Trio, sonst solo) – ein Schrauber kommt an B
  // SYS-01 A2a: Reaktor zerstört = Countdown. Der Schrauber und die Reparaturgänge (repairDuty, Captain-Liste) holen den Reaktor mit Vorrang; reicht die Zeit
  // nicht (Rest unter 8 s), springt der Helm per Notfallsprung (Notstrom, holt das Außenteam zurück, beendet den Countdown). -> true, wenn der Bot damit beschäftigt ist
  reaktorRettung(S, p) {
    const rt = S.ship.reaktorTod;
    if (!rt || rt.rest < 0 || !this.is('helm') || p.zone !== 'ship' || S.ship.docked) return false;
    // SYS-01 C1a-2 Nacharbeit: Reparatur zuerst, solange sie in die Frist passt (Sonderreparatur 1 Arbeiter + Weg); läuft sie schon und endet vor dem Ablauf, bleibt der Bot dran.
    // Vorher (Trace sim-sund k9b): der Helm lief für ein Nebensystem (Heck-Emitter) ans andere Schiffsende, der Notsprung ab 8 s war nicht mehr erreichbar, die Lerche starb.
    const frist = rt.rest / 10;
    const hold = (this.game.players.find((q) => q.id === this.pid) || {}).hold;
    if (hold && hold.system === 'reactor' && hold.dur - hold.t < frist - 1) return false;
    // Reparatur nur, wenn Weg zum Reaktor plus Sonderreparatur (1 Arbeiter) in die Frist passen (Laufweg ~ Luftlinie × 1,4 bei player.speed); sonst ans Steuer und springen.
    const me = this.game.players.find((q) => q.id === this.pid);
    const rs = stationTile('reactor');
    const weg = me && rs ? dist(me.x, me.y, rs.x * TILE + TILE / 2, rs.y * TILE + TILE / 2) * 1.4 / this.game.C.player.speed : 0;
    if (frist > weg + this.game.C.reaktorTod.sonderreparatur.zeiten[0] + 2 && this.repairDuty(S, p, { cooldown: 1 })) return true;
    if (this.role === 'helm' && p.console !== 'helm') { this.enter(S, 'helm'); return true; }   // vom Nebenjob zurück ans Steuer, sofort: der Weg kostet Zeit (solo wechselt die Konsolen selbst)
    if (rt.rest > 80) return false;
    if (!this.enter(S, 'helm')) return true;
    this.cmd('helm.notsprung');
    statistik(this.game).reaktorNotsprung = (statistik(this.game).reaktorNotsprung || 0) + 1;
    return true;
  }
  // BOT-01 B3: Reaktor-Countdown, nur die Notsprung-Entscheidung (keine Laufwege: die Reparatur holen der Schrauber, die Technik stellt den Reaktor an die Spitze der Liste).
  // Wie reaktorRettung: unter 8 s Rest springt die Steuer (cmd helm.notsprung von der Steuer-Konsole). -> true, wenn gesprungen wurde bzw. der Befehl rausging
  reaktorNotsprung(S, p) {
    const rt = S.ship.reaktorTod;
    if (!rt || rt.rest < 0 || rt.rest > 80 || S.ship.docked || p.zone !== 'ship' || p.console !== 'helm') return false;
    this.cmd('helm.notsprung');
    statistik(this.game).reaktorNotsprung = (statistik(this.game).reaktorNotsprung || 0) + 1;
    return true;
  }
  reactorDuty(S, p) {
    if (!S.ship.reactor || S.ship.reactor.state !== 'offline') return false;
    if (S.space.enemies.length && this.role !== 'solo') return false;
    if (!(this.role === 'solo' || this.role === 'helm') || p.zone !== 'ship') return false;
    if (p.console) { this.send({ t: 'leave' }); return true; }
    const sw = switchOf('A');
    const r = this.interact(S, sw.x, sw.y, { hold: true, max: 30, until: (S2) => S2.ship.reactor.state !== 'offline' });
    if (r === 'fail') this.waitT = 0.5;
    if (!this.memo.switchUsed) { this.memo.switchUsed = true; statistik(this.game).reactorRestarts++; }
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

  // Neutraler Grundschritt (BOT-01 B1): ohne Missionslogik. Der Testbot (MissionAgent) ueberschreibt update() mit der M1/M2-Entscheidung.
  update(S) {
    const p = this.me(S);
    if (!p) return;
    this.updateLocs(S);
    if (this.waitT > 0) { this.waitT -= DT; return; }
    if (p.downed) { this.input(0, 0); this.act(false); this.ix = null; return; }
    if (this.reactorDuty(S, p)) return;
    if (this.role === 'captain' && p.console === 'captain') this.queueRepairs(S);
  }
}

module.exports = { BotKern, setSimRng, simRng, statistik, setzeAusgabe,
  BOT_SCHILD_SEKTOR_MAX, LCLS, STOP, HALF, QUARTER, THREEQ, FULL, stageSpeedOf, turnFactorOf, shelfOf, switchOf, consoleTileOf, systemTile, stationTile, M3, MOUNT_IDS, ZUSATZ_IDS, ZONEN_ZIELE, JAEGER_NACHSETZEN, LANGSAM_ZIELE, SECTOR_OF_SIDE, EMITTER_OF, REPAIR_PRIO, DT, TILE, norm, dist, losPx };
