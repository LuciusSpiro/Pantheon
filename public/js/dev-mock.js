// Entwicklungs-Mock (CONTRACT.md §9, CONTRACT-M1 §10): nur mit ?mock=1 aktiv. Ersetzt den WebSocket durch
// einen lokalen Fake-Server, der Snapshots im Format §5.3 + M1 §10 erzeugt und grob auf Befehle reagiert.
// URL-Parameter (alle optional):
//   loc=hafen|splitter|b7|vaelen|wrack|nebel|relais   Start-Ort        console=helm|captain|weapons|plan|quartier|shop|transfer
//   tab=0..5 (Captain-Reiter)   zone=away   reactor=overload|offline   scanned=1 (Gegner gescannt)   reveal=1 (Verstecke aufgedeckt)
//   markers=1 (Captain-/Taktik-Marker)   pins=1 (Plan-Pins)   ivo=1 (Ivo an Bord)   m1end=1 (Ende-Screen)   mockcrew=0 (solo)
//   pos=x,y (eigene Kachel)   phase=lobby
//   M3a/§20: gunboat=1  tele=1 (Ladung endlos)  charging=1 (Lanze lädt endlos)  salvo=1 (Batterien feuern laufend)  fastcharge=1  dmg=1  mg=1
//   M3b: stage=0..5 (Startstufe)  raiders=1 (Jäger fliegen Anflug/Überflug/Wende)  esc=1 (Eskalations-Zähler laufen)
//        setback=1 (alle 3 s Rückschlag an der eigenen Reparatur / am Schrauber)  repair=1 (eigene Figur flickt die Stb-Batterie)
// Tasten (nur Mock): Bild↓/Bild↑ nächster/voriger Ort · Pos1 Zone Schiff/Außen · Ende Reaktorzustand durchschalten
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const DevMock = { active: params.get('mock') === '1' };
  window.DevMock = DevMock;
  if (!DevMock.active) return;

  const CFG = window.Shared_Config || {};
  const Maps = window.Shared_Maps;
  const Phys = window.Shared_Physics;
  const TILE = 32;
  // M3b: Lerche-Klasse (Temporegler) und gemeinsames Flugmodell
  const FLIGHT = window.Shared_Flight || null;
  const LERCHE = (CFG.shipClasses && CFG.shipClasses.lerche) || { maxSpeed: 130, minSpeed: 0, accel: 22, decel: 30, brakeFactor: 1.4, stages: [-0.23, 0, 0.27, 0.5, 0.75, 1],
    stageNames: ['R', 'STOPP', '¼', '½', '¾', 'VOLL'], turnRate: 0.6, turnCurve: [[0, 1], [1, 1]], turnAccel: 0.8, lateralDrag: 2.2 };
  const RAIDER = (CFG.shipClasses && CFG.shipClasses.raider) || { maxSpeed: 200, minSpeed: 120, accel: 60, decel: 40, brakeFactor: 1, stages: [0.6, 0.8, 1], turnRate: 1.1, turnCurve: [[0, 1], [1, 1]], turnAccel: 2.5, lateralDrag: 0.8 };
  const HB =(CFG.player && CFG.player.hitbox) || { w: 18, h: 12 };

  // ---------------------------------------------------------------- Orte (Inhalt laut CONTRACT-M1 §9.1)
  const LOCS = [
    { id: 'hafen', name: 'Hafen Lichtkordon', kind: 'port', x: 100, y: 300, links: ['splitter', 'vaelen'], desc: 'Heimathafen der Lerche. Dock, Terminal, Klatsch.' },
    { id: 'splitter', name: 'Splittergürtel', kind: 'asteroids', x: 260, y: 220, links: ['hafen', 'b7', 'wrack'], desc: 'Felsbrocken, Bergungsgut, Grauzahns Revier.' },
    { id: 'b7', name: 'Boje B-7', kind: 'buoy', x: 420, y: 150, links: ['splitter', 'nebel'], desc: 'Die stumme Boje. Plattform mit Kustoden-Sonde.' },
    { id: 'vaelen', name: 'Vaelen-Karawane', kind: 'trader', x: 230, y: 430, links: ['hafen', 'nebel'], desc: 'Händlerin Sela. Kristalllampen, günstige Bolzenwerfer.' },
    { id: 'wrack', name: 'Wrack „Zaunkönig“', kind: 'wreck', x: 400, y: 330, links: ['splitter', 'nebel'], desc: 'Zerstörter Frachter. Plünderer gesichtet.' },
    { id: 'nebel', name: 'Graue Weite', kind: 'nebula', x: 570, y: 280, links: ['b7', 'vaelen', 'wrack', 'relais'], fog: true, desc: 'Dichter Nebel. Sicht halbiert, Sensoren schwach.' },
    { id: 'relais', name: 'Kustoden-Relais', kind: 'relay', x: 730, y: 230, links: ['nebel'], desc: 'Uralte Anlage der Kustoden. Pylonen schützen den Kern.' },
    // M2: Mond Kesh (Planetenmission m3)
    { id: 'kesh', name: 'Mond Kesh', kind: 'moon', x: 160, y: 120, links: ['hafen', 'splitter'], desc: 'Ein staubiger Mond mit einer Kustoden-Ruine. Plünderer graben dort seit Wochen.' },
  ];
  const SCENES = {
    hafen: { w: 2000, h: 1400, start: { x: 700, y: 700, angle: 0 }, docked: true, markers: [{ kind: 'station', x: 520, y: 700, r: 60 }, { kind: 'dock', x: 700, y: 700, r: 70 }] },
    splitter: { w: 3000, h: 1600, start: { x: 600, y: 800, angle: 0 }, asteroids: 38, markers: [], salvage: true,
      hidden: [{ id: 'h_sp1', kind: 'cache', x: 1500, y: 420 }, { id: 'h_sp2', kind: 'cache', x: 2300, y: 1250 }] },
    b7: { w: 3000, h: 3000, start: { x: 1300, y: 1500, angle: 0 }, markers: [{ kind: 'buoy', x: 2000, y: 1500, r: 60, beamRange: 320 }],
      enemies: [['raider', 1700, 1250], ['raider', 1650, 1800]], hidden: [{ id: 'h_b7', kind: 'cache', x: 2400, y: 1900 }] },
    vaelen: { w: 2400, h: 1600, start: { x: 700, y: 900, angle: 0 }, markers: [{ kind: 'vaelen', x: 1200, y: 800, r: 80 }, { kind: 'dock', x: 1200, y: 920, r: 70 }] },
    wrack: { w: 3000, h: 2000, start: { x: 1250, y: 1150, angle: -0.3 }, markers: [{ kind: 'wreck', x: 1500, y: 1000, r: 90, beamRange: 320 }] },
    nebel: { w: 3000, h: 3000, start: { x: 1000, y: 1500, angle: 0 }, enemies: [['raider', 1450, 1300], ['raider', 1900, 1750]],
      hidden: [{ id: 'h_beacon', kind: 'beacon', x: 1400, y: 1650 }, { id: 'h_lore', kind: 'lore', x: 2300, y: 900 }] },
    relais: { w: 3000, h: 3000, start: { x: 1000, y: 1500, angle: 0 }, markers: [{ kind: 'relay', x: 1800, y: 1500, r: 90 }],
      enemies: [['pylon', 1500, 1300, Math.PI], ['pylon', 1500, 1700, Math.PI], ['pylon', 1350, 1500, Math.PI], ['sentinel', 1250, 1350]],
      hidden: [{ id: 'h_relore', kind: 'lore', x: 2300, y: 2100 }] },
    kesh: { w: 2400, h: 1800, start: { x: 1300, y: 900, angle: 0 }, markers: [{ kind: 'moon', x: 1500, y: 900, r: 180, beamRange: 360 }] },
  };
  const ENEMY_DATA = {
    raider: { hp: 12, shields: [2, 1, 0, 1], weapons: [{ facing: 0, arc: 40, range: 400 }] },
    gunboat: { hp: 40, shields: [2, 4, 1, 4], weapons: [{ facing: -90, arc: 90, range: 500 }, { facing: 90, arc: 90, range: 500 }] },
    sentinel: { hp: 30, shields: [3, 3, 3, 3], weapons: [{ facing: 0, arc: 360, range: 260 }] },
    pylon: { hp: 16, shields: [4, 0, 0, 0], weapons: [{ facing: 0, arc: 60, range: 450 }] },
  };
  const LOC_ORDER = LOCS.map(l => l.id);

  function tc(tx, ty) { return { x: tx * TILE + 16, y: ty * TILE + 16 }; }
  // M3a: Schiffspositionen aus dem Layout (Legende, SHIP_ROOMS, BEDS, Pads) statt fester Koordinaten
  function shipTiles(pred) {
    const m = Maps.ship, out = [];
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (pred(m.info(x, y), x, y)) out.push({ x, y });
    return out;
  }
  // Stehplätze an Objektkacheln: begehbare Nachbarn + Blickrichtung
  function standSpots(tiles) {
    const spots = [];
    for (const t of tiles) for (const [dx, dy, dir] of [[-1, 0, 'right'], [0, 1, 'up'], [0, -1, 'down'], [1, 0, 'left']]) {
      const x = t.x + dx, y = t.y + dy;
      if (!Maps.ship.solid(x, y) && !spots.some(s => s.x === x && s.y === y)) spots.push({ x, y, dir });
    }
    return spots;
  }
  function standNear(t) { return standSpots([t])[0] || null; }
  // Stehplatz an einer Konsole (k = welcher Platz)
  function consoleSpot(con, k) {
    const spots = standSpots(shipTiles(i => i.console === con));
    return spots[Math.min(k || 0, spots.length - 1)] || { x: Maps.SHIP_SPAWNS[0].x, y: Maps.SHIP_SPAWNS[0].y, dir: 'down' };
  }
  // Mittelpunkt (begehbar) eines Raums
  function roomCenter(r) {
    if (!r) return Maps.SHIP_SPAWNS[0];
    const cx = Math.floor((r.x0 + r.x1) / 2), cy = Math.floor((r.y0 + r.y1) / 2);
    let best = null, bd = 1e9;
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      if (Maps.ship.solid(x, y)) continue;
      const d = Math.abs(x - cx) + Math.abs(y - cy);
      if (d < bd) { bd = d; best = { x, y }; }
    }
    return best || Maps.SHIP_SPAWNS[0];
  }
  function shipRoom(id) { return (Maps.SHIP_ROOMS || []).find(r => r.id === id) || null; }
  function guestQuarter() { const b = (Maps.BEDS || []).find(q => q.color === 3); return b && b.room ? (shipRoom(b.room.id) || b.room) : null; }
  function shipPad(i) { const pads = shipTiles(info => info.kind === 'pad'); return pads[Math.min(i || 0, pads.length - 1)] || Maps.SHIP_SPAWNS[0]; }
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function wreckMap() { return Maps.wreck || (window.Render && Render.wreckMap ? Render.wreckMap() : Maps.platform); }

  let W = null, sock = null, ids = 1;
  const nid = (p) => p + (ids++);

  function mkPlayer(id, name, color, pos) {
    return { id, name, color, ready: false, connected: true, zone: 'ship', x: pos.x, y: pos.y, dir: 'down', moving: false, console: null, carry: null, hp: 100, downed: false, downedFor: 0, action: null, gear: { werkzeuggurt: false }, lastSeq: 0 };
  }
  function me() { return W.players[0]; }

  function newWorld() {
    const sp = Maps.SHIP_SPAWNS.map(s => tc(s.x, s.y));
    const crew = params.get('mockcrew') !== '0';
    const players = [mkPlayer('p1', 'Du', 0, sp[0])];
    if (crew) { players.push(mkPlayer('p2', 'Mira', 1, sp[1])); players.push(mkPlayer('p3', 'Juno', 2, sp[2])); players[1].ready = players[2].ready = true; }
    const deco = {};
    for (const b of Maps.BEDS) for (const s of b.slots) deco[s.id] = null;
    deco.q0a = 'trophaee_boje'; deco.q1a = 'poster'; deco.q1b = 'aquarium'; deco.q2c = 'sessel';
    const w = {
      tick: 0, time: 0, phase: params.get('phase') === 'lobby' ? 'lobby' : 'play',
      players,
      bots: Maps.BOT_SPAWNS.slice(0, 2).map((b, i) => ({ id: 'b' + i, variant: i, ...tc(b.x, b.y), dir: 'down', moving: false, carry: null, task: null, progress: 0, home: tc(b.x, b.y) })),
      lobbyOpts: { skipDrill: false, startMission: 'm1' },
      world: { location: 'hafen', locations: LOCS.map(l => Object.assign({}, l, { known: ['hafen', 'splitter', 'b7', 'vaelen', 'wrack', 'nebel', 'kesh'].indexOf(l.id) >= 0, visited: ['hafen', 'splitter', 'b7'].indexOf(l.id) >= 0, unknown: false, map: l.id === 'b7' ? 'platform' : l.id === 'wrack' ? 'wreck' : l.id === 'kesh' ? 'kesh' : null, discoveries: { found: 0, total: (SCENES[l.id].hidden || []).length + 1 } })) },
      ship: {
        scene: 'hafen', docked: true, dockedAt: 'hafen', x: 700, y: 700, angle: 0, vx: 0, vy: 0, speed: 0,
        hull: 100, hullMax: 100, o2: 100, alert: 'normal',
        helm: { turn: 0, thrust: 0, manned: false, stage: 1, autoStop: false },   // M3b: stage = Index in shipClasses.lerche.stages
        power: Object.assign({}, CFG.power.default),
        reactor: { state: 'online', output: 8, used: 8, overloadLeft: 0, switches: { A: false, B: false }, restartProgress: 0 },
        heat: { engines: 0, shields: 0, weapons: 0, life: 0 },
        shields: { pool: 2 * ((CFG.shields && CFG.shields.pointsPerPower) || 3), alloc: CFG.shields.default.slice(), current: CFG.shields.default.slice(), cap: [4, 4, 4, 4], burst: null, burstCd: 0 },
        escalate: {},   // M3b §4: { [sys]: Restsekunden }
        systems: Object.fromEntries(((window.Shared_Protocol && Shared_Protocol.SYSTEMS) || ['reactor', 'engines', 'shields', 'weapons', 'life', 'transfer']).map(s => [s, 'ok'])),
        // M3a (CONTRACT-M3 §9.3)
        turnVel: 0, turnCap: { port: 1, stbd: 1 }, fragile: [], repairQueue: [], botAuto: false, chargePoints: 4,
        fires: [], breaches: [], groundItems: [],
        dodgeCd: 0, jump: { dest: null, charge: 0, ready: false, blockedReason: 'Kein Ziel gewählt' },
        mounts: [
          { id: 'bow', facing: 0, arc: 16, range: 650, charge: 1, alloc: 2, state: 'ok', power: 0, charging: false },
          { id: 'port', facing: -90, arc: 70, range: 520, charge: 0.42, alloc: 1, state: 'ok', salvo: 0, salvoMax: 4 },
          { id: 'stbd', facing: 90, arc: 70, range: 520, charge: 0.1, alloc: 1, state: 'ok', salvo: 0, salvoMax: 4 },
        ],
        target: null, priority: null, scan: { progress: 0, done: false },
        markers: { captain: null, tactical: null },
        tscan: { targetId: null, progress: 0 },
        widescan: { cd: 0, pulseAt: -99 },
        npcs: [],
      },
      space: { w: 2000, h: 1400, enemies: [], projectiles: [], beams: [], asteroids: [], markers: [], salvage: [], hidden: [] },
      away: {
        active: false, map: 'platform', drones: [], projectiles: [], npc: { ...tc(26, 2), dir: 'down', following: null, rescued: true, present: false },
        items: [], marker: null, strikes: [], salvage: [], hollow: null,
        sonde: { disabled: true, symbols: ['dreieck', 'welle', 'kreis'], entered: [], lockout: 0 },
        codeTable: { kreis: 'mint', dreieck: 'bernstein', raute: 'rot', stern: 'blau', welle: 'pink', kreuz: 'weiss' },
        odaCodeHelp: false, kuppelUntil: 0, sensorUntil: 0, doorOpen: true,
      },
      support: { sensor: 0, strike: 0, supply: 0, recall: 0, kuppel: 0 },
      inventory: Object.assign({ loeschgelCharges: 5, marks: 320, deko: ['pflanze', 'lampe', 'buecherregal', 'sternkarte'] }, CFG.economy.startInventory),
      upgrades: { seitenturm: false, schildpool: false, schrauber3: false },
      quarters: { q0: { floor: 'teppich_blau', wall: 'paneel', light: 'warm' }, q1: { floor: 'holz_dunkel', wall: 'tapete_creme', light: 'bernstein' }, q2: { floor: 'teppich_rot', wall: 'holz', light: 'mint' }, q3: { floor: 'holz_hell', wall: 'holz', light: 'warm' } },
      deco,
      plan: { seated: [], pins: [] },
      shopContext: 'hafen',
      mission: {
        stage: 'm2', objectives: [], radio: null, choice: null, teaser: null, flags: { technikerRescued: true },
        active: { id: 'm2', title: 'Echo im Nebel', objectives: [
          { id: 'o1', text: 'Graue Weite anfliegen (Captain: Sternkarte)', done: true },
          { id: 'o2', text: 'Taktik: per Weitscan (W) die Leitbake finden', done: false },
          { id: 'o3', text: 'Leitbake scannen (S halten)', done: false },
          { id: 'o4', text: 'Wrack „Zaunkönig“ erkunden', done: false, optional: true },
        ] },
        list: [{ id: 'm1', title: 'Die stumme Boje', state: 'done' }, { id: 'm2', title: 'Echo im Nebel', state: 'active' }],
        log: [
          { id: 'l1', text: 'Datenkern von B-7 geborgen. Kustoden-Siegel.', loc: 'b7' },
          { id: 'l2', text: 'Grauzahns Versteck im Splittergürtel: 40 Marken.', loc: 'splitter' },
          { id: 'l3', text: 'Sela von der Vaelen-Karawane gerettet. Handel möglich.', loc: 'vaelen' },
        ],
        discoveries: { found: 3, total: 9 },
        // §21.2 Missionsbuch (Mock-Beispiel; Server schickt es nur bei Änderung)
        book: { version: 1, focus: null, entries: [
          { id: 'm2', title: 'Echo im Nebel', from: 'Händlerin Sela', kind: 'mission', state: 'aktiv',
            briefing: 'Im Nebel der Grauen Weite sendet eine Leitbake ein Kustoden-Echo. Sela will wissen, wer da ruft – und zahlt gut für die Koordinaten.',
            reward: '150 Marken · Nebelkarte', objectives: [
              { text: 'Graue Weite anfliegen (Captain: Sternkarte)', done: true },
              { text: 'Taktik: per Weitscan (W) die Leitbake finden', done: false },
              { text: 'Leitbake scannen (S halten)', done: false }],
            log: [{ t: 812, loc: 'vaelen', text: 'Sela von der Vaelen-Karawane gerettet. Handel möglich.' }, { t: 1104, loc: 'nebel', text: 'Graue Weite erreicht. Sicht halbiert.' }] },
          { id: 'side_grauzahn', title: 'Grauzahns Kopfgeld', from: 'Hafenmeisterin Oda', kind: 'nebenauftrag', state: 'aktiv',
            briefing: 'Grauzahn plündert im Splittergürtel. Sein Versteck soll zwischen den großen Brocken liegen.',
            reward: '80 Marken', objectives: [{ text: 'Versteck im Splittergürtel finden', done: true }, { text: 'Zum Hafen zurückkehren', done: false }],
            log: [{ t: 640, loc: 'splitter', text: 'Grauzahns Versteck im Splittergürtel: 40 Marken.' }] },
          { id: 'm3', title: 'Die Tafel von Kesh', from: 'Ivo (Techniker)', kind: 'mission', state: 'angeboten',
            briefing: 'Ivo hat auf Mond Kesh ein Kustoden-Archiv geortet. Plünderer sind schon unterwegs.', reward: '300 Marken · Upgrade',
            objectives: [{ text: 'Funkangebot annehmen', done: false }, { text: 'Nach Kesh springen', done: false }], log: [] },
          { id: 'hint_relais', title: 'Signal hinter dem Nebel', from: 'ODA', kind: 'hinweis', state: 'angeboten',
            briefing: 'Hinter der Grauen Weite pulst etwas Altes.', reward: '–', objectives: [], log: [] },
          { id: 'm1', title: 'Die stumme Boje', from: 'Hafenbehörde', kind: 'mission', state: 'erledigt',
            briefing: 'Boje B-7 schweigt seit drei Tagen. Nachsehen, reparieren, Datenkern bergen.', reward: '120 Marken',
            objectives: [{ text: 'B-7 anfliegen', done: true }, { text: 'Sonde reaktivieren', done: true }, { text: 'Datenkern bergen', done: true }],
            log: [{ t: 300, loc: 'b7', text: 'Datenkern von B-7 geborgen. Kustoden-Siegel.' }] },
        ] },
      },
      stats: { elapsed: 0, kills: 4, repairs: 6, firesOut: 3, hits: 9, emergencies: 0, playTimeStart: 0 },
      errors: 0,
      _in: { mx: 0, my: 0 }, _act: false, _crewT: 0, _shieldT: 0, _tscanOn: false, _tscanT: 0, _scanOn: false, _scanT: 0, _hidden: [], _locSent: 0, _switchHoldT: 0,
    };
    return w;
  }

  function emit(obj) {
    if (!sock || sock.readyState !== 1) return;
    const data = JSON.stringify(obj);
    setTimeout(() => { if (sock && sock.onmessage) sock.onmessage({ data }); }, 0);
  }
  function ev(kind, extra) { emit(Object.assign({ t: 'event', kind }, extra || {})); }
  function oda(text) { ev('oda', { text }); }
  function notice(text) { ev('notice', { pid: 'p1', text }); }
  function locOf(id) { return W.world.locations.find(l => l.id === id); }

  // ---------------------------------------------------------------- Orte / Szenen
  function setLoc(id, opts) {
    opts = opts || {};
    const sc = SCENES[id];
    if (!sc) return;
    const s = W.ship, sp = W.space;
    W.world.location = id; s.scene = id;
    const l = locOf(id);
    const first = !l.visited;
    l.known = true; l.visited = true; l.unknown = false;
    sp.w = sc.w; sp.h = sc.h;
    s.x = sc.start.x; s.y = sc.start.y; s.angle = sc.start.angle; s.vx = s.vy = s.speed = 0;
    s.docked = !!sc.docked; s.dockedAt = sc.docked ? id : null;
    W.shopContext = s.dockedAt;
    sp.markers = clone(sc.markers || []);
    sp.enemies = []; sp.projectiles = []; sp.beams = []; sp.asteroids = []; sp.salvage = []; sp.hidden = [];
    W._hidden = clone(sc.hidden || []).map(h => Object.assign(h, { found: false, revealed: !!params.get('reveal') }));
    if (sc.asteroids) { const r = rng(7); for (let i = 0; i < sc.asteroids; i++) sp.asteroids.push({ id: 'a' + i, x: Math.round(300 + r() * (sc.w - 400)), y: Math.round(100 + r() * (sc.h - 200)), r: Math.round(14 + r() * 30), seed: Math.floor(r() * 1e6) }); }
    if (sc.salvage) sp.salvage = [{ id: 's1', x: 1200, y: 500, kind: 'ersatzteil' }, { id: 's2', x: 1900, y: 1150, kind: 'flickblech' }, { id: 's3', x: 2500, y: 600, kind: 'marks' }];
    for (const [kind, x, y, ang] of sc.enemies || []) spawnEnemy(kind, x, y, ang);
    s.target = null; s.tscan = { targetId: null, progress: 0 }; s.markers = { captain: null, tactical: null };
    s.jump = { dest: null, charge: 0, ready: false, blockedReason: 'Kein Ziel gewählt' };
    W._sendAsteroids = true; W._locSent = 0;
    // Ziel-Linkdaten: nebel–relais erst nach Leitbake
    if (!opts.silent) {
      ev('jump', { scene: id });
      if (first) { oda('Neuer Ort: ' + l.name + '. ' + (l.desc || '')); addLog('Erstbesuch: ' + l.name, id); }
    }
  }
  function addLog(text, loc) { W.mission.log.push({ id: nid('l'), text, loc }); }
  function spawnEnemy(kind, x, y, ang) {
    const d = ENEMY_DATA[kind] || ENEMY_DATA.raider;
    W.space.enemies.push({ id: nid('e'), kind, x, y, angle: ang != null ? ang : Math.atan2(W.ship.y - y, W.ship.x - x), hp: d.hp, hpMax: d.hp, shields: d.shields.slice(), shieldsMax: d.shields.slice(), scanned: params.get('scanned') === '1', weapons: clone(d.weapons), _a: Math.atan2(y - W.ship.y, x - W.ship.x), _fire: 2 + Math.random() * 2, _home: { x, y }, _regen: 0 });
  }
  function nextLoc(dir) { const i = LOC_ORDER.indexOf(W.world.location); setLoc(LOC_ORDER[(i + dir + LOC_ORDER.length) % LOC_ORDER.length]); }

  // Außenmission (B-7-Plattform oder Wrack)
  function setAway(on) {
    const p = me(), a = W.away;
    p.console = null;
    if (!on) { const pad = shipPad(0), back = roomCenter(Maps.roomAt ? Maps.roomAt(pad.x, pad.y) : null); p.zone = 'ship'; Object.assign(p, tc(back.x, back.y)); p.sh = null; p.downed = false; a.active = false; ev('beam', { pids: [p.id], dir: 'up' }); return; }
    if (W.world.location === 'kesh') { setupKesh(params.get('scene') || 'hof', !params.get('console')); ev('beam', { pids: [p.id], dir: 'down' }); return; }
    const wreck = W.world.location === 'wrack';
    a.active = true; a.map = wreck ? 'wreck' : 'platform'; a.combat = null; a.orders = [];
    const map = wreck ? wreckMap() : Maps.platform;
    const pads = map.find('P');
    p.zone = 'away'; Object.assign(p, tc(pads[0].x, pads[0].y));
    if (wreck) {
      a.salvage = map.find('h').map((t, i) => ({ x: t.x, y: t.y, done: i === 0 }));
      const v = map.find('V')[0];
      a.hollow = v ? { x: v.x, y: v.y, marked: params.get('reveal') === '1', open: false } : null;
      a.drones = map.find('a').map((t, i) => ({ id: 'sc' + i, kind: 'scavenger', ...tc(t.x, t.y), hp: 6, dir: 'down', revealed: true, alive: true, _o: tc(t.x, t.y), _fire: 2 }));
    } else {
      a.salvage = []; a.hollow = null;
      a.drones = [[17, 3], [26, 4]].map(([x, y], i) => ({ id: 'd' + i, ...tc(x, y), hp: 6, dir: 'down', revealed: false, alive: true, _o: tc(x, y), _fire: 2 }));
    }
    const p2 = W.players[1];
    if (p2) { p2.zone = 'away'; Object.assign(p2, tc(pads[1].x, pads[1].y)); p2.console = null; }
    ev('beam', { pids: [p.id], dir: 'down' });
  }

  // ---------------------------------------------------------------- M2: Mond Kesh, Kampf v2 (CONTRACT-M2 §4–§7)
  // URL: ?mock=1&loc=kesh&zone=away&scene=hof|halle|down   (console=captain&tab=5: du bist Captain, zwei unten)
  const Los = window.Shared_Los;
  const AC = CFG.awayCombat || {};
  const acNum = (path, d) => { let o = AC; for (const k of path.split('.')) { if (!o || typeof o !== 'object') return d; o = o[k]; } return typeof o === 'number' ? o : d; };
  const BARKS = ['Kontakt! Da drüben!', 'Halt sie unten – ich geh rechts rum!', 'Mein Schild ist weg, ich zieh mich zurück!', 'Schild steht wieder!', 'Einer liegt! Drauf!', 'Wo sind die hin?'];
  function keshMap() { return Maps.kesh; }
  function keshSolid() {
    const map = keshMap(), open = !!(W.away.vault && W.away.vault.open);
    return (x, y) => (open && map.at(x, y) === 'G') ? false : map.solid(x, y);
  }
  function mkEnemy(id, kind, tx, ty, extra) {
    const seg = kind === 'warden' ? acNum('enemy.warden.segments', 6) : acNum('enemy.scavenger.segments', 2);
    return Object.assign({ id, kind, ...tc(tx, ty), hp: seg, dir: 'down', revealed: false, alive: true, sh: [seg, seg], role: 'idle', vis: false, ghost: null, aim: null,
      _o: tc(tx, ty), _aimT: 0, _cool: 1 + Math.random() * 2, _seenT: -99, _regenT: 0 }, extra || {});
  }
  function setupKesh(scene, meDown) {
    const a = W.away, map = keshMap();
    a.active = true; a.map = 'kesh'; a.combat = 'v2'; a.salvage = []; a.hollow = null; a.items = []; a.marker = null;
    a.npc = Object.assign({}, a.npc, { present: false });
    a.jammers = map.find('r').map((t, i) => ({ x: t.x, y: t.y, off: i === 1 }));
    a.keys = map.find('k').map(t => ({ x: t.x, y: t.y, t: 0, _done: -99 }));
    const tt = map.find('T')[0];
    a.tablet = { x: tt.x, y: tt.y, taken: false };
    a.vault = { open: scene === 'halle' && params.get('vault') === '1' };
    a.orders = [];
    a.scanQuality = a.jammers.every(j => j.off) ? 1 : acNum('scanQualityJammed', 0.35);
    const team = meDown ? [W.players[0], W.players[1]] : [W.players[1], W.players[2]];
    for (const q of W.players) { q.sh = null; q.downed = false; q.bleed = null; q.medkit = 0; q.cv = 0; q.fl = false; q.shR = 0; }
    for (const q of team) { if (!q) continue; q.zone = 'away'; q.console = null; q.sh = [3, 3]; q.medkit = 1; q.dir = 'up'; }
    const L = map.find('L')[0];
    if (scene === 'halle') {
      Object.assign(team[0], tc(45, 10)); team[0].sh = [2, 3]; team[0].shR = 0.5; team[0].dir = 'left';
      if (team[1]) { Object.assign(team[1], tc(38, 3)); team[1].action = null; }
      a.keys[0].t = 0.55;
      a.drones = [
        mkEnemy('w1', 'warden', L.x, L.y, { asleep: false, facing: 0.6, role: 'pin', sh: [4, 6], _forceAim: team[0].id }),
        mkEnemy('s5', 'scavenger', 35, 3, { role: 'advance', _ghostHold: true, ghost: null }),
      ];
      a.orders = [{ id: 'o1', kind: 'gefahr', x: 38 * 32 + 16, y: 13 * 32 + 16, target: null, until: W.time + 24 }, { id: 'o2', kind: 'halten', x: 44 * 32 + 16, y: 13 * 32 + 16, target: null, until: W.time + 20 }];
      a.vault.open = params.get('vault') === '1';
      a.scanQuality = 1; a.jammers.forEach(j => { j.off = true; });
    } else {
      Object.assign(team[0], tc(19, 11)); team[0].sh = [2, 3]; team[0].shR = 0.4;
      if (team[1]) { Object.assign(team[1], tc(16, 12)); team[1].downed = true; team[1].bleed = 31; team[1].sh = [0, 3]; team[1].medkit = 0; }
      if (scene === 'down') {
        team[0].downed = true; team[0].bleed = 27; team[0].sh = [0, 3];
        if (team[1]) { team[1].downed = false; team[1].bleed = null; team[1].sh = [1, 3]; team[1].medkit = 1; Object.assign(team[1], tc(16, 12)); }
      }
      a.drones = [
        mkEnemy('s1', 'scavenger', 23, 6, { role: 'pin', _forceAim: team[0].id }),
        mkEnemy('s2', 'scavenger', 26, 9, { role: 'flank', sh: [1, 2] }),
        mkEnemy('s3', 'scavenger', 14, 7, { role: 'pin' }),
        mkEnemy('s4', 'scavenger', 9, 5, { role: 'advance', _ghostHold: true }),
        mkEnemy('w1', 'warden', L.x, L.y, { asleep: true, facing: Math.PI / 2, role: null }),
      ];
      a.orders = [{ id: 'o1', kind: 'sammeln', x: 14 * 32 + 16, y: 13 * 32 + 16, target: null, until: W.time + 26 }, { id: 'o2', kind: 'fokus', x: 0, y: 0, target: 's2', until: W.time + 8 }];
    }
    a.projectiles = [];
    W._barkT = 1.5;
  }
  function keshVisibility(dt) {
    const a = W.away, map = keshMap();
    const blocked = Los.sightFn(map, keshSolid());
    const r = acNum('sightTiles', 10);
    const team = W.players.filter(q => q.zone === 'away' && q.connected !== false);
    const sensor = a.sensorUntil && W.time < a.sensorUntil;
    for (const e of a.drones) {
      if (!e.alive) { e.vis = false; e.aim = null; continue; }
      const focus = (a.orders || []).some(o => o.kind === 'fokus' && o.target === e.id && W.time < o.until);
      const seen = team.some(q => Math.hypot(q.x - e.x, q.y - e.y) <= r * TILE && Los.lineOfSight(blocked, q.x, q.y - 4, e.x, e.y - 8));
      e.vis = !!(seen || sensor || focus);
      if (e.vis) { e._seenT = W.time; e.ghost = null; }
      else if (e._ghostHold) e.ghost = { x: e.x + 18, y: e.y + 10, t: W.time - ((W.time * 0.6) % 2.6) };
      else e.ghost = W.time - e._seenT < acNum('ghostTime', 3) ? { x: e.x, y: e.y, t: e._seenT } : null;
    }
    // Deckung/Flanke je Spieler gegen den gefährlichsten sichtbaren Gegner
    for (const q of team) {
      if (q.downed) { q.cv = 0; q.fl = false; continue; }
      let best = null, bestD = 1e9, open = false;
      for (const e of a.drones) {
        if (!e.alive || e.asleep || !Los.lineOfSight(blocked, e.x, e.y - 8, q.x, q.y - 4)) continue;
        const cov = Los.coverAgainst(map, keshSolid(), e.x, e.y - 8, q.x, q.y);
        if (cov === 0 && Math.hypot(e.x - q.x, e.y - q.y) < r * TILE) open = true;
        const d = Math.hypot(e.x - q.x, e.y - q.y) - (e.aim && e.aim.target === q.id ? 1000 : 0);
        if (d < bestD) { bestD = d; best = cov; }
      }
      q.cv = best == null ? 0 : best; q.fl = open;
    }
  }
  function keshShieldRegen(dt) {
    const delay = acNum('shield.regenDelay', 4), step = acNum('shield.regenStep', 1.2);
    for (const q of W.players) {
      if (!q.sh || q.downed) continue;
      q._hitAgo = (q._hitAgo == null ? 99 : q._hitAgo) + dt;
      if (q.sh[0] >= q.sh[1] || q._hitAgo < delay) { q.shR = 0; q._regen = 0; continue; }
      q._regen = (q._regen || 0) + dt;
      q.shR = Math.min(1, q._regen / step);
      if (q._regen >= step) { q._regen = 0; q.sh[0]++; q.shR = 0; ev('shieldUp', { pid: q.id, seg: q.sh[0] }); }
    }
    for (const q of W.players) if (q.downed && q.bleed != null) q.bleed = Math.max(1, q.bleed - dt * 0.2);   // Mock: langsam (Screenshots)
  }
  function hitPlayer(q, segs) {
    if (!q.sh || q.downed) return;
    q._hitAgo = 0; q._regen = 0; q.shR = 0;
    if (q.sh[0] > 0) {
      q.sh[0] = Math.max(0, q.sh[0] - segs);
      ev('shieldHit', { pid: q.id, seg: q.sh[0], x: q.x, y: q.y }); ev('sfx', { name: 'shield_hit', zone: 'away', x: q.x, y: q.y, seg: q.sh[0] });
      if (q.sh[0] === 0) { ev('shieldBreak', { pid: q.id }); ev('sfx', { name: 'shield_break', zone: 'away', x: q.x, y: q.y }); }
    } else if (params.get('mockwound') === '1') {
      q.downed = true; q.bleed = acNum('wounded.bleedout', 45); ev('wounded', { pid: q.id });
    }
  }
  function keshEnemies(dt) {
    const a = W.away, map = keshMap();
    const blocked = Los.sightFn(map, keshSolid());
    const team = W.players.filter(q => q.zone === 'away' && !q.downed);
    for (const e of a.drones) {
      if (!e.alive) continue;
      const war = e.kind === 'warden';
      const C = war ? (AC.enemy && AC.enemy.warden) || {} : (AC.enemy && AC.enemy.scavenger) || {};
      if (e.asleep) { e.aim = null; continue; }
      // leichtes Seitwärtsrücken (keine echte KI im Mock)
      if (!war) { e.x = e._o.x + Math.sin(W.time * 0.7 + e._o.y) * 10; }
      const tgt = team.find(q => q.id === e._forceAim) || team.filter(q => Los.lineOfSight(blocked, e.x, e.y - 8, q.x, q.y - 4)).sort((p, q) => Math.hypot(p.x - e.x, p.y - e.y) - Math.hypot(q.x - e.x, q.y - e.y))[0];
      if (war && tgt) {
        const want = Math.atan2(tgt.y - e.y, tgt.x - e.x);
        const diff = Math.atan2(Math.sin(want - e.facing), Math.cos(want - e.facing));
        const rate = (C.turnRate || 70) * Math.PI / 180 * dt;
        e.facing += Math.max(-rate, Math.min(rate, diff));
      }
      if (!tgt || !e.vis) { e.aim = null; continue; }
      e._regenT += dt;
      const aimDur = C.aim || (war ? 1.4 : 0.8);
      if (!e.aim) { e._cool -= dt; if (e._cool <= 0) { e.aim = { target: tgt.id, p: 0 }; e._aimT = 0; ev('enemyAim', { id: e.id, target: tgt.id }); ev('sfx', { name: war ? 'warden_aim' : 'enemy_aim', zone: 'away', x: e.x, y: e.y }); } continue; }
      e._aimT += dt; e.aim.p = Math.min(1, e._aimT / aimDur);
      if (e._aimT >= aimDur) {
        const q = W.players.find(x => x.id === e.aim.target);
        e.aim = null; e._cool = (C.fireInterval || 1.6) * (0.8 + Math.random() * 0.4);
        if (!q) continue;
        const ang = Math.atan2(q.y - e.y, q.x - e.x) + (Math.random() - 0.5) * (C.spreadDeg || 4) * Math.PI / 180;
        a.projectiles.push({ id: nid('ep'), kind: war ? 'warden' : 'enemy', x: e.x, y: e.y, angle: ang, _life: 2.5, _from: e.id, _speed: C.shotSpeed || 230, _sx: e.x, _sy: e.y });
        ev('sfx', { name: war ? 'warden_shot' : 'enemy_shot', zone: 'away', x: e.x, y: e.y });
      }
    }
    // Funksprüche
    W._barkT -= dt;
    if (W._barkT <= 0) {
      W._barkT = 5 + Math.random() * 3;
      const sp = a.drones.find(e => e.alive && e.kind === 'scavenger' && (e.vis || e.ghost));
      if (sp) { ev('bark', { from: 'Plünderer', id: sp.id, text: BARKS[Math.floor(Math.random() * BARKS.length)], x: sp.x, y: sp.y }); ev('sfx', { name: 'bark', zone: 'away', x: sp.x, y: sp.y }); }
    }
  }
  function keshProjectiles(dt) {
    const a = W.away, map = keshMap();
    const solid = keshSolid();
    const blockedSight = Los.sightFn(map, solid);
    for (const pr of a.projectiles) {
      const sp = pr._speed || (pr.kind === 'pistol' ? 300 : 380);
      const nx = pr.x + Math.cos(pr.angle) * sp * dt, ny = pr.y + Math.sin(pr.angle) * sp * dt;
      pr._life -= dt;
      const tx = Math.floor(nx / TILE), ty = Math.floor(ny / TILE);
      if (blockedSight(tx, ty)) { pr._life = 0; continue; }
      const info = map.info(tx, ty);
      if (info.low && solid(tx, ty) && !pr['_c' + tx + '_' + ty]) {
        pr['_c' + tx + '_' + ty] = 1;
        const nearShooter = Math.abs(tx - Math.floor(pr._sx / TILE)) <= 1 && Math.abs(ty - Math.floor(pr._sy / TILE)) <= 1;
        if (!nearShooter && Math.random() < acNum('halfCoverBlock', 0.6)) { pr._life = 0; ev('coverHit', { x: nx, y: ny }); ev('sfx', { name: 'cover_hit', zone: 'away', x: nx, y: ny }); continue; }
      }
      pr.x = nx; pr.y = ny;
      if (pr.kind === 'blaster' || pr.kind === 'pistol') {
        for (const e of a.drones) {
          if (!e.alive) continue;
          const war = e.kind === 'warden';
          if (Math.hypot(e.x - pr.x, e.y - (war ? 6 : 0) - pr.y) > (war ? 26 : 13)) continue;
          pr._life = 0;
          if (e.asleep) break;
          if (war) {
            const from = Math.atan2(pr._sy - e.y, pr._sx - e.x);
            const d = Math.abs(Math.atan2(Math.sin(from - e.facing), Math.cos(from - e.facing))) * 180 / Math.PI;
            if (d <= acNum('enemy.warden.frontArc', 120) / 2) { ev('wardenDeflect', { id: e.id, x: e.x + Math.cos(e.facing) * 30, y: e.y + Math.sin(e.facing) * 14 }); ev('sfx', { name: 'warden_deflect', zone: 'away', x: e.x, y: e.y }); break; }
          }
          e._seenT = W.time; e._regenT = 0;
          if (e.sh[0] > 0) { e.sh[0]--; ev('enemyShieldHit', { id: e.id, seg: e.sh[0], x: e.x, y: e.y }); ev('sfx', { name: 'shield_hit', zone: 'away', x: e.x, y: e.y, seg: e.sh[0] }); }
          else { e.alive = false; e.aim = null; ev('enemyDown', { id: e.id, kind: e.kind, x: e.x, y: e.y }); if (war) ev('wardenDown', {}); W.stats.kills++; }
          break;
        }
      } else {
        for (const q of W.players) {
          if (q.zone !== 'away' || !q.sh) continue;
          if (Math.hypot(q.x - pr.x, q.y - pr.y) > 12) continue;
          pr._life = 0;
          if (a.kuppelUntil && W.time < a.kuppelUntil) break;
          hitPlayer(q, pr.kind === 'warden' ? acNum('enemy.warden.shotSegments', 2) : 1);
          break;
        }
      }
    }
    a.projectiles = a.projectiles.filter(pr => pr._life > 0);
  }
  function keshEnemyRegen(dt) {
    for (const e of W.away.drones) {
      if (!e.alive || e.sh[0] >= e.sh[1]) continue;
      e._regenT += dt;
      const C = e.kind === 'warden' ? (AC.enemy && AC.enemy.warden) || {} : (AC.enemy && AC.enemy.scavenger) || {};
      if (e._regenT >= (C.regenDelay || 4) + (C.regenStep || 1.5)) { e._regenT = C.regenDelay || 4; e.sh[0]++; }
    }
  }
  function keshTick(dt) {
    if (!W.away.active || W.away.map !== 'kesh') return;
    keshVisibility(dt);
    keshShieldRegen(dt);
    keshEnemies(dt);
    keshEnemyRegen(dt);
    keshProjectiles(dt);
    const a = W.away;
    a.orders = (a.orders || []).filter(o => W.time < o.until);
    a.scanQuality = a.jammers.every(j => j.off) ? 1 : acNum('scanQualityJammed', 0.35);
    for (const k of a.keys) if (!W.players.some(q => q.action && q.action.key === k)) { if (W.time - k._done > acNum('archkeyWindow', 1.5)) k.t = a.vault.open ? 1 : (params.get('scene') === 'halle' && k === a.keys[0] ? 0.55 : 0); }
  }
  function keshAct(p) {
    const a = W.away, map = keshMap();
    const t = Phys.toTile(p.x, p.y);
    const d = DIRV[p.dir];
    for (const [dx, dy] of [[d[0], d[1]], [0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const tx = t.x + dx, ty = t.y + dy, ch = map.at(tx, ty);
      const down = W.players.find(q => q !== p && q.downed && q.zone === 'away' && Math.floor(q.x / TILE) === tx && Math.floor(q.y / TILE) === ty);
      if (down) { p.action = { kind: 'revive', progress: 0, dur: p.medkit ? acNum('wounded.medkitReviveTime', 1.5) : acNum('wounded.reviveTime', 4), who: down }; return true; }
      if (ch === 'r') { const j = a.jammers.find(q => q.x === tx && q.y === ty); if (j && !j.off) { p.action = { kind: 'jammer', progress: 0, dur: acNum('jammerTime', 2.5), j }; return true; } }
      if (ch === 'k' && !a.vault.open) { const k = a.keys.find(q => q.x === tx && q.y === ty); if (k) { p.action = { kind: 'archkey', progress: 0, dur: acNum('archkeyTime', 3), key: k }; return true; } }
      if (ch === 'T' && !a.tablet.taken) { p.action = { kind: 'tablet', progress: 0, dur: acNum('tabletTime', 3) }; return true; }
      if (dx === 0 && dy === 0 && ch === 'P') { p.action = { kind: 'beam', progress: 0, dur: 3 }; return true; }
    }
    return true;
  }
  function keshFinish(p, act) {
    const a = W.away;
    if (act.kind === 'revive') {
      const q = act.who; q.downed = false; q.bleed = null;
      q.sh = [p.medkit ? acNum('wounded.medkitSegments', 2) : acNum('wounded.reviveSegments', 1), q.sh ? q.sh[1] : 3];
      if (p.medkit) p.medkit = 0;
      ev('revived', { pid: q.id }); ev('sfx', { name: 'revive_done', zone: 'away', x: q.x, y: q.y });
      return true;
    }
    if (act.kind === 'jammer') { act.j.off = true; ev('jammerOff', { i: a.jammers.indexOf(act.j) }); ev('sfx', { name: 'jammer_off', zone: 'away', x: p.x, y: p.y }); return true; }
    if (act.kind === 'archkey') {
      act.key._done = W.time; act.key.t = 1;
      const other = a.keys.find(k => k !== act.key);
      if (other && W.time - other._done <= acNum('archkeyWindow', 1.5)) { a.vault.open = true; ev('vaultOpen', {}); ev('sfx', { name: 'vault_open', zone: 'away' }); }
      else oda('Beide Schlüssel gleichzeitig – einer allein reicht dem Archiv nicht.');
      return true;
    }
    if (act.kind === 'tablet') { a.tablet.taken = true; W.inventory.tafel = (W.inventory.tafel || 0) + 1; ev('tabletTaken', {}); ev('sfx', { name: 'tablet', zone: 'away' }); return true; }
    return false;
  }
  function keshDebug(msg) {
    const p = me(), a = W.away;
    switch (msg.cmd) {
      case 'kesh': setLoc('kesh'); setupKesh('hof', true); return true;
      case 'wake': { const w = a.drones && a.drones.find(e => e.kind === 'warden'); if (w) { w.asleep = false; w.role = 'pin'; ev('wardenWake', {}); ev('sfx', { name: 'warden_wake', zone: 'away' }); } return true; }
      case 'shield': if (p.sh) { p.sh[0] = Math.max(0, Math.min(p.sh[1], Math.round(+msg.n || 0))); } return true;
      case 'wound': if (p.sh) { p.downed = true; p.bleed = acNum('wounded.bleedout', 45); p.sh[0] = 0; ev('wounded', { pid: p.id }); } return true;
      case 'squad': notice('Mock: Trupp ' + msg.squad + ' (nur mit Server)'); return true;
      case 'tune': notice('Mock: tune ' + (msg.path || '') + ' ' + (msg.value != null ? msg.value : '') + ' (wirkt nur auf dem Server)'); return true;
      case 'vault': a.vault.open = !a.vault.open; return true;
    }
    return false;
  }
  function keshOrder(m) {
    const a = W.away;
    if (!a.active || a.map !== 'kesh') return notice('Nur während der Außenmission');
    a.orders = (a.orders || []).filter(o => o.kind !== m.kind);
    if (m.clear) return;
    const max = (AC.orders && AC.orders.max) || 3;
    a.orders.push({ id: nid('ord'), kind: m.kind, x: Math.round(+m.x || 0), y: Math.round(+m.y || 0), target: m.target == null ? null : m.target, until: W.time + (m.kind === 'fokus' ? ((AC.orders && AC.orders.focusTime) || 8) : ((AC.orders && AC.orders.ttl) || 30)) });
    while (a.orders.length > max) a.orders.shift();
    ev('order', { order: m.kind }); ev('sfx', { name: 'order', zone: 'away' });
  }

  // ---------------------------------------------------------------- Interaktion (E)
  function awayMapNow() { return W.away.map === 'wreck' ? wreckMap() : W.away.map === 'kesh' ? keshMap() : Maps.platform; }
  function isSolid(zone) {
    if (zone === 'away' && W.away.map === 'kesh') return keshSolid();
    const map = zone === 'away' ? awayMapNow() : Maps.ship;
    const hv = W.away.hollow;
    return (x, y) => {
      const ch = map.at(x, y);
      if (zone === 'away' && map === Maps.platform && ch === 'L') return !W.away.sonde.disabled;
      if (ch === 'V' && hv && hv.open && hv.x === x && hv.y === y) return false;
      return map.solid(x, y);
    };
  }
  const DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  function act(p) {
    if (p.zone === 'away' && W.away.map === 'kesh') { if (!p.downed) keshAct(p); return; }
    const map = p.zone === 'away' ? awayMapNow() : Maps.ship;
    const t = Phys.toTile(p.x, p.y);
    // M4: Lift (auf ^ stehen) bzw. Notleiter (auf/vor !) – im Mock sofort aufs andere Deck (ohne Fahrzeit)
    if (p.zone === 'ship' && Maps.otherDeckTile) {
      const own = map.info(t.x, t.y);
      const lad = [[0, 0], [DIRV[p.dir][0], DIRV[p.dir][1]]].map(([dx, dy]) => ({ x: t.x + dx, y: t.y + dy })).find(q => map.info(q.x, q.y).interact === 'ladder');
      const from = own.interact === 'lift' ? t : lad;
      const to = from ? (own.interact === 'lift' ? Maps.otherDeckTile(from.x, from.y) : Maps.ladderPartner(from.x, from.y)) : null;
      if (to) { Object.assign(p, tc(to.x, to.y)); notice(own.interact === 'lift' ? 'Lift: ' + (Maps.deckOf(to.y) ? 'Privatdeck' : 'Systemdeck') : 'Notleiter'); return; }
    }
    const d = DIRV[p.dir];
    const cand = [[d[0], d[1]], [0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]];
    for (const [dx, dy] of cand) {
      const tx = t.x + dx, ty = t.y + dy, ch = map.at(tx, ty);
      if (p.zone === 'ship') {
        // M3a: alles über die Legende der Schiffskarte und das Schiffslayout (keine festen Zeichen/Koordinaten)
        const info = map.info(tx, ty);
        if (info.interact === 'switch') {
          const sw = (Maps.REACTOR_SWITCHES || []).find(s => s.x === tx && s.y === ty);
          if (!sw) continue;
          if (W.ship.reactor.state !== 'offline') { notice('Schalter nur nach Abschaltung'); return; }
          p.action = { kind: 'switch', progress: 0, dur: 999, sw: sw.id }; return;
        }
        if (info.interact === 'spare') { notice('Freies Terminal – noch ohne Funktion.'); return; }
        if (info.interact === 'console') {
          if (info.console === 'shop' && !W.ship.dockedAt) { notice('Terminal nur angedockt'); return; }
          if (info.console !== 'plan' && W.players.some(q => q !== p && q.console === info.console)) { notice('Konsole besetzt'); return; }
          p.console = info.console; p.action = null; return;
        }
        const sys = info.system;
        if (sys) {
          // M3a: mit Ersatzteil austauschen (auch heil+fragil), sonst flicken (nur beschädigt/zerstört)
          const stt = W.ship.systems[sys], fr = W.ship.fragile.indexOf(sys) >= 0;
          if (stt === 'offline') { notice('Offline (EMP) – startet selbst neu'); return; }
          if (p.carry === 'ersatzteil' && (stt !== 'ok' || fr)) { p.action = { kind: 'swap', progress: 0, dur: 3, sys }; return; }
          if (stt !== 'ok') { p.action = { kind: 'flick', progress: 0, dur: 1.5, sys }; return; }
        }
        if (info.interact === 'shelf') {
          const shelf = Maps.shelfAt ? Maps.shelfAt(tx, ty) : null;
          if (!shelf) continue;
          const item = shelf.item;
          if (p.carry === item) { p.carry = null; W.inventory[item]++; return; }
          if (!p.carry && W.inventory[item] > 0) { p.carry = item; W.inventory[item]--; return; }
          notice(p.carry ? 'Du trägst schon etwas' : 'Regal leer'); return;
        }
        if (info.interact === 'bed') { const bed = Maps.BEDS.find(b => b.x === tx && b.y === ty); if (bed && bed.color === p.color) { p.console = 'quartier'; return; } }
        if (dx === 0 && dy === 0 && info.kind === 'pad') { p.action = { kind: 'beam', progress: 0, dur: 3 }; return; }
      } else {
        const a = W.away;
        if (ch === 'h') { const s = a.salvage.find(q => q.x === tx && q.y === ty); if (s && !s.done) { p.action = { kind: 'salvage', progress: 0, dur: 2, s }; return; } }
        if (ch === 'g') { ev('sfx', { name: 'lore' }); oda('Logbuch Zaunkönig: „… die Fracht summt nachts. Wir haben sie nie bestellt.“'); addLog('Logbuch des Zaunkönig gelesen.', 'wrack'); return; }
        if (ch === 'V' && a.hollow && a.hollow.marked && !a.hollow.open && a.hollow.x === tx && a.hollow.y === ty) { p.action = { kind: 'hollow', progress: 0, dur: 4 }; return; }
        if (dx === 0 && dy === 0 && ch === 'P') { p.action = { kind: 'beam', progress: 0, dur: 3 }; return; }
      }
    }
  }
  function finishAction(p) {
    const a = p.action;
    p.action = null;
    if (keshFinish(p, a)) return;
    if (a.kind === 'repair') { W.ship.systems[a.sys] = 'ok'; W.stats.repairs++; ev('repairDone', { system: a.sys }); }
    else if (a.kind === 'flick') repairSys(a.sys, 'flick', p.id);
    else if (a.kind === 'swap') { p.carry = null; repairSys(a.sys, 'swap', p.id); }
    else if (a.kind === 'beam') setAway(p.zone === 'ship');
    else if (a.kind === 'salvage') { a.s.done = true; W.inventory.marks += 30; notice('Container geborgen: +30 Marken'); }
    else if (a.kind === 'hollow') { W.away.hollow.open = true; addLog('Hohlraum im Wrack: Kristalllampe gefunden.', 'wrack'); W.inventory.deko.push('kristalllampe'); }
  }

  // ---------------------------------------------------------------- Befehle
  function targetObj(id) { return W.space.enemies.find(e => e.id === id) || W._hidden.find(h => h.id === id && h.revealed) || null; }
  function damageEnemy(e, dmg, fromX, fromY) {
    const sec = Phys.sectorOf(e.x, e.y, e.angle, fromX, fromY);
    if (e.shields[sec] > 0) { const take = Math.min(e.shields[sec], dmg); e.shields[sec] -= take; dmg -= take; }
    if (dmg <= 0) return;
    e.hp -= dmg;
    if (e.hp <= 0) {
      W.space.enemies = W.space.enemies.filter(x => x !== e);
      ev('explosion', { x: e.x, y: e.y }); W.stats.kills++;
      W.inventory.marks += 20;
      if (W.ship.target === e.id) W.ship.target = null;
    }
  }
  function firePhase(id) {
    const s = W.ship, mt = s.mounts.find(x => x.id === id);
    const tg = W.space.enemies.find(e => e.id === s.target);
    if (!mt || !tg || mt.charge < 1) return false;
    if (!Phys.inArc(s.x, s.y, s.angle, mt.facing, mt.arc, mt.range, tg.x, tg.y)) return false;
    W.space.beams.push({ x1: s.x, y1: s.y, x2: tg.x, y2: tg.y, ttl: 0.3, kind: 'phase' });
    damageEnemy(tg, 2, s.x, s.y);
    mt.charge = 0;
    return true;
  }
  // ---------------------------------------------------------------- M3a „Breitseite & Schaden“ (grobe Nachbildung von §4–§8)
  function m3n(path, d) { let o = CFG.spaceM3; for (const k of path.split('.')) { if (o == null) break; o = o[k]; } return typeof o === 'number' ? o : d; }
  const EMITTERS = ['emitter_bow', 'emitter_stbd', 'emitter_aft', 'emitter_port'];
  const MOUNT_SYS = { bow: 'weapon_bow', port: 'battery_port', stbd: 'battery_stbd' };
  const SYS_SECTOR = {};
  for (const st of (window.Render && Render.shipStations ? Render.shipStations() : [])) SYS_SECTOR[st.system] = st.sector;
  function isFr(sys) { return W.ship.fragile.indexOf(sys) >= 0; }
  function setFr(sys, on) { const f = W.ship.fragile; const i = f.indexOf(sys); if (on && i < 0) f.push(sys); if (!on && i >= 0) f.splice(i, 1); }
  function repairSys(sys, how, by) {
    const s = W.ship.systems;
    if (how === 'flick') { s[sys] = s[sys] === 'broken' ? 'damaged' : 'ok'; setFr(sys, true); W.stats.flicks = (W.stats.flicks || 0) + 1; ev('sfx', { name: 'flick' }); }
    else if (how === 'swap') { s[sys] = 'ok'; setFr(sys, false); W.stats.swaps = (W.stats.swaps || 0) + 1; ev('sfx', { name: 'swap' }); }
    else { s[sys] = s[sys] === 'broken' ? 'damaged' : 'ok'; setFr(sys, false); W.stats.minigames = (W.stats.minigames || 0) + 1; }
    ev('repairDone', { system: sys, how, by, state: s[sys], fragile: isFr(sys) });
  }
  function damageSys(sys, state) {
    W.ship.systems[sys] = state; setFr(sys, false);
    ev('systemHit', { system: sys, state });
  }
  function hitSystems(sector, maxState) {
    const fr = W.ship.fragile.filter(x => SYS_SECTOR[x] === sector);
    if (fr.length) { for (const x of fr) damageSys(x, 'broken'); return; }
    const cand = Object.keys(SYS_SECTOR).filter(x => SYS_SECTOR[x] === sector && W.ship.systems[x] !== 'broken' && !(maxState === 'damaged' && W.ship.systems[x] === 'damaged'));
    if (!cand.length) return;
    const x = cand[Math.floor(Math.random() * cand.length)];
    damageSys(x, W.ship.systems[x] === 'ok' ? 'damaged' : 'broken');
  }
  // M3b §4 (grob): Überlauf auf die Hülle, Durchlass-Tabelle je Schildstärke VOR dem Treffer, Rückschlag laufender Reparaturen
  function m3Hit(sector, dmg, heavy) {
    const s = W.ship, sh = s.shields;
    const S = sh.current[sector];
    if (S >= 3 && heavy) dmg = Math.max(0, dmg - 1);
    const take = Math.min(S, dmg); sh.current[sector] -= take; const rest = dmg - take;
    if (rest > 0) { s.hull = Math.max(30, s.hull - rest * 5); setbackSector(sector); }
    const L = ((CFG.spaceM3b && CFG.spaceM3b.shieldLeak) || {})[Math.min(4, S)] || {};
    if ((L.chance || 0) > 0 && (!L.heavyOnly || heavy) && Math.random() < L.chance) hitSystems(sector, L.maxState || 'damaged');
    ev('hit', { sector, shield: take > 0 && rest <= 0, dmg, absorbed: take, hull: rest * 5, heavy: !!heavy });
  }
  function setbackSector(sector) {
    const loss = (CFG.spaceM3b && CFG.spaceM3b.repairHitLoss) || 0.5;
    for (const q of W.players) {
      const a = q.action;
      if (!a || !(a.kind === 'flick' || a.kind === 'swap' || a.kind === 'minigame')) continue;
      const sys = a.sys || a.system;
      if (SYS_SECTOR[sys] !== sector) continue;
      a.progress *= 1 - loss; if (a.t != null) a.t *= 1 - loss;
      ev('repairSetback', { system: sys, pid: q.id });
    }
  }
  function m3Mount(id) { return W.ship.mounts.find(x => x.id === id); }
  function m3Fire(id) {
    const s = W.ship, mt = m3Mount(id);
    if (!mt) return 'Nicht eingebaut';
    if (mt.state === 'broken') return 'Waffe zerstört';
    if (id === 'bow') { if (!mt.charging) return 'Lanze: Taste 1 halten zum Aufladen'; m3FireLance(mt.power); return null; }
    if (mt.charge < 1) return 'Nicht geladen';
    if (mt.salvo > 0) return 'Salve läuft';
    // §20.4: kein Ziel nötig – gewähltes Ziel im Bogen, sonst nächster im Bogen, sonst ins Leere
    mt.salvo = mt.salvoMax; mt._gap = 0; mt._tg = s.target; mt.charge = 0;
    ev('sfx', { name: 'battery_salvo', count: mt.salvoMax });
    return null;
  }
  // §20.3: Lanze in Bugrichtung, erster Gegner nahe der Linie, Schaden 3..12 je power
  function m3FireLance(power) {
    const s = W.ship, mt = m3Mount('bow');
    const L = (CFG.spaceM3 && CFG.spaceM3.lance) || { minDamage: 3, maxDamage: 12, width: 10 };
    const HR = (CFG.combat && CFG.combat.hitRadius) || {};
    const p = Math.max(0, Math.min(1, power || 0));
    const ox = s.x + Math.cos(s.angle) * 34, oy = s.y + Math.sin(s.angle) * 34, ux = Math.cos(s.angle), uy = Math.sin(s.angle);
    let hit = null, ht = Infinity;
    for (const e of W.space.enemies) {
      const rx = e.x - ox, ry = e.y - oy, t = rx * ux + ry * uy, rad = (HR[e.kind] || 18) + (L.width || 10);
      if (t < -rad || t > 650 + rad || Math.abs(-rx * uy + ry * ux) >= rad) continue;
      if (t < ht) { ht = t; hit = e; }
    }
    const max = L.maxDamage * (mt.state === 'damaged' ? (L.damagedMaxFactor || 0.75) : 1);
    const dmg = L.minDamage + Math.max(0, max - L.minDamage) * p;
    const d = hit ? Math.max(0, ht) : 650;
    W.space.beams.push({ x1: ox, y1: oy, x2: ox + ux * d, y2: oy + uy * d, ttl: 0.5, kind: 'lance', mount: 'bow', miss: !hit });
    if (hit) damageEnemy(hit, dmg, s.x, s.y);
    mt.charging = false; mt.power = 0; mt.charge = 0;
    ev('lance', { state: 'fire', power: Math.round(p * 100) / 100, hit: hit ? hit.id : null });
    ev('sfx', { name: 'lance_fire', power: p });
  }
  function m3Tick(dt) {
    const s = W.ship, sh = s.shields, sys = s.systems, sp = W.space;
    // Drehen über turnVel (§6)
    const capOf = (x) => ({ ok: 1, damaged: 0.5, broken: 0.15, offline: 0.15 })[sys[x]] || 1;
    s.turnCap = { port: capOf('thruster_port'), stbd: capOf('thruster_stbd') };
    // (M3b: Drehen + Fahrt laufen im Schiffs-Tick über Flight.stepBody)
    // Schild-Kappung über Emitter (M3b: kein Schildstoß mehr)
    sh.cap = EMITTERS.map(e => sys[e] === 'broken' || sys[e] === 'offline' ? 0 : sys[e] === 'damaged' ? 2 : 4);
    for (let i = 0; i < 4; i++) sh.current[i] = Math.min(sh.current[i], sh.cap[i]);
    sh.burst = null; sh.burstCd = 0;
    // M3b §4: Eskalation – beschädigt/zerstört im Kampf, niemand arbeitet daran -> nach 20 s Feuer neben der Station
    const after = (CFG.spaceM3b && CFG.spaceM3b.escalation && CFG.spaceM3b.escalation.after) || 20;
    const combat = sp.enemies.some(e => e.kind !== 'relay') || params.get('esc') === '1';
    const busy = (x) => W.players.some(q => q.action && (q.action.sys === x || q.action.system === x)) || s.repairQueue.some(q => q.system === x && q.bot);
    W._escT = W._escT || {};
    for (const x of Object.keys(SYS_SECTOR)) {
      if (combat && sys[x] && sys[x] !== 'ok' && sys[x] !== 'offline' && !busy(x)) {
        W._escT[x] = (W._escT[x] == null ? (params.get('esc') === '1' ? Math.random() * 14 : 0) : W._escT[x]) + dt;
        if (W._escT[x] >= after) {
          W._escT[x] = 0;
          const stn = (window.Render && Render.stationOfSystem) ? Render.stationOfSystem(x) : null;
          if (stn) { const f = [stn.x, stn.y + 1]; if (!s.fires.some(q => q[0] === f[0] && q[1] === f[1])) s.fires.push(f); }
          ev('escalated', { system: x, tx: stn ? stn.x : 0, ty: stn ? stn.y + 1 : 0 });
        }
      } else delete W._escT[x];
    }
    s.escalate = {};
    for (const x in W._escT) s.escalate[x] = Math.round((after - W._escT[x]) * 10) / 10;
    // M3b: Screenshot-Modus Rückschlag – alle 3 s an der eigenen Reparatur bzw. am ersten arbeitenden Schrauber
    if (params.get('setback') === '1') {
      W._sbT = (W._sbT || 0) + dt;
      if (W._sbT > 3) {
        W._sbT = 0;
        const p = me();
        if (p.action && (p.action.kind === 'flick' || p.action.kind === 'swap' || p.action.kind === 'minigame')) { if (p.action.progress < 0.25) p.action.progress = 0.8; p.action.progress *= 0.5; if (p.action.t != null) p.action.t *= 0.5; ev('repairSetback', { system: p.action.sys || p.action.system, pid: p.id }); }
        const b = W.bots.find(q => q.task);
        if (b) { b.progress *= 0.5; ev('repairSetback', { system: b.task.system, bot: b.id }); }
      }
    }
    // Waffen: Ladepunkte, Laden, Zielphase, Salven
    s.chargePoints = s.power.weapons > 0 ? s.power.weapons + 2 : 0;
    for (const mt of s.mounts) {
      const msys = MOUNT_SYS[mt.id];
      if (!msys) continue;
      mt.state = sys[msys];
      if (mt.salvoMax != null) mt.salvoMax = W.upgrades.seitenturm ? 5 : mt.state === 'damaged' ? 2 : 4;
      const per = (CFG.spaceM3 && CFG.spaceM3.mounts[mt.id].secPerPoint) || 16;
      if (mt.state !== 'broken' && mt.alloc > 0 && !mt.charging && !(mt.salvo > 0)) mt.charge = Math.min(1, mt.charge + dt * mt.alloc / per * (mt.state === 'damaged' ? 1 / 1.5 : 1) * (params.get('fastcharge') === '1' ? 6 : 1));
      if (mt.id === 'bow') {
        // §20.3: Aufladen power 0 -> 1 in chargeTime (beschädigt × 1,5); Konsole verlassen / System aus = verpufft
        if (params.get('charging') === '1') { mt.charge = 1; mt.charging = true; mt.power = 0.5 + 0.5 * Math.sin(W.time * 0.8); mt.power = Math.max(0, Math.min(1, mt.power * 1.2)); continue; }
        if (mt.charging) {
          const manned = W.players.some(q => q.console === 'weapons');
          if (!manned || mt.state === 'broken') { mt.charging = false; mt.power = 0; ev('lance', { state: 'fizzle', power: 0, hit: null, why: manned ? 'system' : 'console' }); continue; }
          const ct = m3n('lance.chargeTime', 3) * (mt.state === 'damaged' ? m3n('lance.damagedTimeFactor', 1.5) : 1);
          mt.power = Math.min(1, mt.power + dt / ct);
        }
        continue;
      }
      if (params.get('salvo') === '1' && !(mt.salvo > 0)) { mt._auto = (mt._auto || 0) + dt; if (mt._auto > (mt.id === 'port' ? 1.2 : 1.9)) { mt._auto = 0; mt.charge = 1; m3Fire(mt.id); } }
      if (mt.salvo > 0) {
        mt._gap -= dt;
        if (mt._gap <= 0) {
          mt._gap = 0.15; mt.salvo--;
          // wie Server §20.4: gewähltes Ziel im Bogen, sonst nächster im Bogen, sonst ins Leere (senkrecht zur Flanke)
          const inArc = (e) => e && Phys.inArc(s.x, s.y, s.angle, mt.facing, mt.arc, mt.range, e.x, e.y);
          let tg = sp.enemies.find(e => e.id === mt._tg);
          if (!inArc(tg)) tg = sp.enemies.filter(inArc).sort((a, b) => Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(b.x - s.x, b.y - s.y))[0] || null;
          const side = s.angle + (mt.id === 'port' ? -Math.PI / 2 : Math.PI / 2);
          const ox = s.x + Math.cos(side) * 16, oy = s.y + Math.sin(side) * 16;
          if (tg) { sp.beams.push({ x1: ox, y1: oy, x2: tg.x + (Math.random() - 0.5) * 16, y2: tg.y + (Math.random() - 0.5) * 16, ttl: 0.15, kind: 'battery', mount: mt.id }); damageEnemy(tg, 1.5, s.x, s.y); }
          else sp.beams.push({ x1: ox, y1: oy, x2: ox + Math.cos(side) * mt.range, y2: oy + Math.sin(side) * mt.range, ttl: 0.15, kind: 'battery', mount: mt.id, miss: true });
        }
      }
    }
    // Waffen-Altname = schlechtester Zustand
    const rank = { ok: 0, damaged: 1, broken: 2, offline: 2 };
    sys.weapons = ['weapon_bow', 'battery_port', 'battery_stbd'].reduce((a, x) => rank[sys[x]] > rank[a] ? sys[x] : a, 'ok');
    // Ladungen der Gegner (§7.1)
    for (const e of sp.enemies) {
      const tc = CFG.spaceM3 && CFG.spaceM3.tele[e.kind];
      if (!tc) continue;
      if (params.get('tele') === '1' && !e.tele) e._teleT = Math.min(e._teleT == null ? 0.5 : e._teleT, 3);
      e._teleT = (e._teleT == null ? 2 + Math.random() * 3 : e._teleT) - dt;
      const sec = Phys.sectorOf(s.x, s.y, s.angle, e.x, e.y);
      if (!e.tele && e._teleT <= 0) { e.tele = { kind: tc.emp ? 'emp' : 'shot', left: tc.dur, dur: tc.dur, sector: sec }; ev('tele', { id: e.id, tkind: e.tele.kind, sector: sec, dur: tc.dur, enemy: e.kind }); ev('sfx', { name: 'tele_charge', enemy: e.kind, dur: tc.dur, key: e.id }); }
      if (e.tele) {
        e.tele.sector = sec;
        e.tele.left -= dt;
        if (params.get('tele') === '1' && e.tele.left < 0.5) e.tele.left = e.tele.dur;   // Screenshot-Modus: Ladung läuft endlos
        if (e.tele.left <= 0 && W.time - (s._lastDodge != null ? s._lastDodge : -99) <= m3n('dodgeWindow', 0.8)) {
          // §20.2: im Ausweich-Fenster -> verfehlt
          ev('teleMiss', { id: e.id, dodged: true }); ev('sfx', { name: 'dodge_evade', enemy: e.kind });
          W.stats.dodgeEvades = (W.stats.dodgeEvades || 0) + 1;
          e.tele = null; e._teleT = 5 + Math.random() * 3;
        } else if (e.tele.left <= 0) {
          sp.beams.push({ x1: e.x, y1: e.y, x2: s.x, y2: s.y, ttl: 0.4, kind: 'enemy_heavy' });
          ev('sfx', { name: 'heavy_hit' });
          m3Hit(sec, tc.damage || 2, true);
          e.tele = null; e._teleT = 5 + Math.random() * 3;
        }
      }
    }
    // Bots arbeiten die Reparaturliste ab (stark vereinfacht: 6 s je Eintrag)
    if (s.botAuto) for (const x of Object.keys(sys)) if (x !== 'weapons' && sys[x] !== 'ok' && s.repairQueue.length < 3 && !s.repairQueue.some(q => q.system === x)) s.repairQueue.push({ system: x, mode: sys[x] === 'broken' && W.inventory.ersatzteil > 0 ? 'part' : 'flick', bot: null });
    s.repairQueue.forEach((q, i) => { const b = W.bots[i]; if (b && !q.bot) q.bot = b.id; });
    W._botRepT = (W._botRepT || 0) + dt;
    if (W._botRepT > 6 && s.repairQueue.length && params.get('dmg') !== '1') { W._botRepT = 0; const q = s.repairQueue.shift(); repairSys(q.system, q.mode === 'part' ? 'swap' : 'flick', 'bot'); }
    s.repairQueue = s.repairQueue.filter(q => sys[q.system] !== 'ok' || isFr(q.system));
  }
  function m3Cmd(p, m) {
    const s = W.ship;
    const alias = { phase_l: 'port', phase_r: 'stbd', both: 'all' };
    switch (m.c) {
      case 'weapons.fire': {
        const id = alias[m.mount] || m.mount;
        if (id === 'all') { let any = false; for (const k of ['port', 'stbd']) if (!m3Fire(k)) any = true; if (!any) notice('Keine Batterie geladen'); return true; }
        if (id === 'bolzen') return false;
        const err = m3Fire(id); if (err) notice(err); return true;
      }
      case 'weapons.alloc': {
        const mt = m3Mount(m.mount); if (!mt) return true;
        const used = s.mounts.reduce((a, x) => a + (x.alloc || 0), 0);
        const v = mt.alloc + m.delta;
        if (v < 0 || v > 4 || (m.delta > 0 && used >= s.chargePoints)) { notice('Ladepunkte: Grenze erreicht'); return true; }
        mt.alloc = v; return true;
      }
      case 'weapons.hold': notice('Batterien feuern nur auf Befehl.'); return true;
      case 'weapons.charge': {
        const mt = m3Mount('bow'); if (!mt) return true;
        if (!m.on) { if (mt.charging) m3FireLance(mt.power); return true; }
        if (mt.charging) return true;
        if (mt.state === 'broken') { notice('Lanze ausgefallen – reparieren.'); return true; }
        if (mt.charge < 1) { notice('Lanze lädt noch.'); return true; }
        mt.charging = true; mt.power = 0;
        ev('lance', { state: 'charge', power: 0, hit: null, dur: 3 }); ev('sfx', { name: 'lance_charge', key: 'lance', dur: 3 });
        return true;
      }
      case 'captain.burst': notice('Den Schildstoß gibt es nicht mehr.'); return true;   // M3b §4
      case 'helm.throttle': {   // M3b §2
        const n = LERCHE.stages.length, h = s.helm;
        let want = m.set != null ? Math.round(+m.set) : h.stage + (+m.delta > 0 ? 1 : -1);
        if (!(want >= 0 && want < n)) return true;
        if (want !== h.stage) { h.stage = want; h.autoStop = false; ev('sfx', { name: 'ui_click' }); }
        if (s.dockedAt && LERCHE.stages[h.stage] > 0) { s.docked = false; s.dockedAt = null; W.shopContext = null; }
        return true;
      }
      case 'captain.repair': {
        const q = s.repairQueue.find(x => x.system === m.system);
        if (!m.mode) { s.repairQueue = s.repairQueue.filter(x => x !== q); return true; }
        if (q) q.mode = m.mode; else if (s.repairQueue.length < 3) s.repairQueue.push({ system: m.system, mode: m.mode, bot: null }); else notice('Liste voll');
        return true;
      }
      case 'captain.botAuto': s.botAuto = !!m.on; return true;
      case 'repair.start': {
        const st = s.systems[m.system];
        if (!st || (st === 'ok' && !isFr(m.system)) || st === 'offline') { notice('Nichts zu reparieren'); return true; }
        p.action = { kind: 'minigame', system: m.system, progress: 0, t: 0 }; p.moving = false; W._in = { mx: 0, my: 0 };
        return true;
      }
      case 'repair.done':
        if (p.action && p.action.kind === 'minigame' && p.action.system === m.system && p.action.t >= m3n('repair.minigameMinTime', 2.5)) repairSys(m.system, 'minigame', p.id);
        else if (p.action && p.action.kind === 'minigame') notice('Minispiel zu früh beendet');
        p.action = null; return true;
      case 'repair.cancel': if (p.action && p.action.kind === 'minigame') p.action = null; return true;
    }
    return false;
  }
  function m3Params() {
    const s = W.ship, sy = s.systems;
    if (params.get('dmg') === '1') {
      Object.assign(sy, { emitter_stbd: 'broken', thruster_stbd: 'damaged', battery_stbd: 'damaged', emitter_port: 'damaged', shields: 'damaged', thruster_port: 'broken', engines: 'damaged' });
      s.fragile = ['battery_port', 'thruster_stbd'];
      s.repairQueue = [{ system: 'emitter_stbd', mode: 'part', bot: 'b0' }, { system: 'thruster_port', mode: 'flick', bot: null }];
    }
    if (params.get('gunboat') === '1') spawnEnemy('gunboat', s.x + 330, s.y - 220);
    if (params.get('stage') != null && isFinite(+params.get('stage'))) s.helm.stage = Math.max(0, Math.min(LERCHE.stages.length - 1, Math.round(+params.get('stage'))));
    if (params.get('raiders') === '1') { spawnEnemy('raider', s.x + 1000, s.y - 450); spawnEnemy('raider', s.x - 700, s.y + 900); }
    if (params.get('esc') === '1') { Object.assign(sy, { battery_port: 'damaged', thruster_stbd: 'broken', emitter_stbd: 'damaged', emitter_bow: 'damaged' }); }
    if (params.get('repair') === '1') {
      const p = me(); sy.battery_stbd = sy.battery_stbd === 'ok' ? 'damaged' : sy.battery_stbd;
      p.action = { kind: 'flick', progress: 0.6, dur: 9999, sys: 'battery_stbd' }; W._holdAction = true;
      const stn = window.Render && Render.stationOfSystem ? Render.stationOfSystem('battery_stbd') : null;
      const at = stn ? standNear(stn) : null;
      if (at) Object.assign(p, tc(at.x, at.y));
    }
    if (params.get('charging') === '1' && W.space.enemies[0]) s.target = W.space.enemies[0].id;
    if (params.get('mg') === '1') { const p = me(); p.action = { kind: 'minigame', system: 'battery_stbd', progress: 0, t: 0 }; }
  }

  function cmd(p, m) {
    const s = W.ship, a = W.away, inv = W.inventory;
    if (m3Cmd(p, m)) return;
    switch (m.c) {
      case 'helm.input': {   // M3b: nur Ruder; thrust = Altname (Flanke > 0,5 / < −0,5 = eine Stufe)
        const prev = s.helm.thrust || 0, th = +m.thrust || 0;
        s.helm.turn = +m.turn || 0; s.helm.thrust = th;
        if (th > 0.5 && !(prev > 0.5)) s.helm.stage = Math.min(LERCHE.stages.length - 1, s.helm.stage + 1);
        else if (th < -0.5 && !(prev < -0.5)) s.helm.stage = Math.max(0, s.helm.stage - 1);
        if (s.dockedAt && LERCHE.stages[s.helm.stage] > 0) { s.docked = false; s.dockedAt = null; W.shopContext = null; }
        break;
      }
      case 'helm.dodge': { if (s.dodgeCd > 0) return notice('Ausweichen lädt noch'); s.dodgeCd = (CFG.ship && CFG.ship.dodgeCooldown) || 7; const imp = (CFG.ship && CFG.ship.dodgeImpulse) || 350; s.vx += Math.cos(s.angle + m.dir * Math.PI / 2) * imp; s.vy += Math.sin(s.angle + m.dir * Math.PI / 2) * imp; s._lastDodge = W.time; s._dodgeT = 1; s.helm.autoStop = false; W.stats.dodges = (W.stats.dodges || 0) + 1; } ev('sfx', { name: 'dodge' }); break;
      case 'helm.stop': s.helm.autoStop = true; ev('sfx', { name: 'ui_click' }); break;   // §21.1 (Bremsen im Tick)
      case 'plan.focus': { const b = W.mission.book; if (b && b.entries.some(e => e.id === m.id)) { b.focus = m.id; b.version++; } break; }
      case 'plan.accept': { const b = W.mission.book; const e = b && b.entries.find(x => x.id === m.id); if (!e || e.state !== 'angeboten') return notice('Nichts anzunehmen'); e.state = 'aktiv'; b.version++; break; }
      case 'helm.jump': if (!s.jump.ready) return notice(s.jump.blockedReason || 'Sprung nicht bereit'); setLoc(s.jump.dest); break;
      case 'captain.accept': if (W.mission.radio) W.mission.radio = null; break;
      case 'captain.choice': W.mission.choice = null; break;
      case 'captain.selectDest': {
        const l = locOf(m.dest);
        if (!l || !(l.known || l.unknown)) return notice('Ort unbekannt');
        if (m.dest === W.world.location) return notice('Hier sind wir schon');
        s.jump.dest = m.dest; s.jump.charge = 0; break;
      }
      case 'captain.marker': s.markers.captain = m.clear ? null : { x: Math.round(m.x), y: Math.round(m.y) }; break;
      case 'captain.overload':
        if (s.reactor.state !== 'online') return notice('Reaktor nicht online');
        s.reactor.state = 'overload'; s.reactor.overloadLeft = +(params.get('overloadTime') || 180); s.reactor.output = 12; break;
      case 'captain.power': {
        const used = Object.values(s.power).reduce((x, y) => x + y, 0);
        const v = s.power[m.sys] + m.delta;
        if (v < 0 || v > 4) return notice('Grenze erreicht');
        if (m.delta > 0 && used >= s.reactor.output) return notice('Reaktor ausgelastet');
        s.power[m.sys] = v; s.shields.pool = s.power.shields * ((CFG.shields && CFG.shields.pointsPerPower) || 3) +(W.upgrades.schildpool ? 2 : 0);
        break;
      }
      case 'captain.shield': {
        const sum = s.shields.alloc.reduce((x, y) => x + y, 0);
        const v = s.shields.alloc[m.sector] + m.delta;
        if (v < 0 || v > 4 || (m.delta > 0 && sum >= s.shields.pool)) return notice('Schildpool erschöpft');
        s.shields.alloc[m.sector] = v; break;
      }
      case 'captain.priority': s.priority = m.target; break;
      case 'captain.scan': W._scanOn = !!m.on; W._scanT = 0; break;
      case 'captain.support':
        if (W.support[m.kind] > 0) return notice('Abklingzeit');
        if (m.kind === 'sensor') { W.support.sensor = 30; a.sensorUntil = W.time + 10; }
        if (m.kind === 'kuppel') { W.support.kuppel = 45; a.kuppelUntil = W.time + 20; }
        break;
      case 'captain.listen': break;
      case 'weapons.target': s.target = m.id; break;
      case 'weapons.fire': {
        if (m.mount === 'both') { const a1 = firePhase('phase_l'), a2 = firePhase('phase_r'); if (!a1 && !a2) notice('Keine Phasenkanone kann feuern'); break; }
        if (m.mount === 'phase_l' || m.mount === 'phase_r') { if (!firePhase(m.mount)) notice('Ziel außerhalb des Feuerbogens oder nicht geladen'); break; }
        return notice('Nicht eingebaut');
      }
      case 'weapons.scan': W._tscanOn = !!m.on; W._tscanT = 0; if (m.on && s.tscan.targetId !== s.target) s.tscan = { targetId: s.target, progress: 0 }; break;
      case 'weapons.widescan': {
        if (s.widescan.cd > 0) return notice('Weitscan lädt');
        s.widescan.cd = 20; s.widescan.pulseAt = W.time;
        let n = 0;
        for (const h of W._hidden) if (!h.revealed && Math.hypot(h.x - s.x, h.y - s.y) <= 1000) { h.revealed = true; n++; }
        if (W.world.location === 'wrack' && a.hollow && !a.hollow.marked) { a.hollow.marked = true; n++; }
        oda(n ? 'Weitscan: ' + n + ' verborgene Signatur(en) entdeckt.' : 'Weitscan: nichts Verborgenes im Umkreis.');
        break;
      }
      case 'weapons.marker': s.markers.tactical = m.clear ? null : { x: Math.round(m.x), y: Math.round(m.y) }; break;
      case 'weapons.strike': if (!a.marker) return notice('Keine Markierung'); W.support.strike = 40; break;
      case 'transfer.down': setAway(true); break;
      case 'transfer.up': setAway(false); break;
      case 'shop.buy': {
        const it = CFG.shop.find(x => x.id === m.item);
        const price = it ? ((it.prices && it.prices[W.shopContext]) || it.price) : 0;
        if (!it || inv.marks < price) return notice('Nicht genug Marken');
        inv.marks -= price;
        if (it.kind === 'upgrade') W.upgrades[it.id] = true;
        else if (it.kind === 'gear') p.gear[it.id] = true;
        else if (it.kind === 'item') inv[it.id]++;
        else inv.deko.push(it.id);
        break;
      }
      case 'deco.place': {
        const prev = W.deco[m.slot];
        if (m.item) { const i = inv.deko.indexOf(m.item); if (i < 0) return notice('Nicht im Inventar'); inv.deko.splice(i, 1); }
        if (prev) inv.deko.push(prev);
        W.deco[m.slot] = m.item || null;
        break;
      }
      case 'quartier.style': {
        const bed = Maps.BEDS.find(b => b.color === p.color);
        if (!bed) return notice('Kein Quartier');
        W.quarters[bed.room.id][m.part] = m.value; break;
      }
      case 'plan.pin': {
        if (W.plan.pins.filter(q => q.owner === p.id).length >= 5) return notice('Höchstens 5 Pins');
        W.plan.pins.push({ id: nid('pin'), owner: p.id, map: m.map, x: m.x, y: m.y, label: m.label }); break;
      }
      case 'plan.unpin': W.plan.pins = W.plan.pins.filter(q => !(q.id === m.id && q.owner === p.id)); break;
      case 'captain.order': keshOrder(m); break;
      case 'crouch': p.cr = !!m.on && p.zone === 'away' && !p.downed && !p.console && !!(a && a.combat === 'v2'); break;   // M2 §15
      default: notice('Mock kennt ' + m.c + ' nicht');
    }
  }

  function onClientMessage(msg) {
    const p = me();
    switch (msg.t) {
      case 'hello':
        p.name = String(msg.name || 'Du').slice(0, 12);
        if (msg.color != null && !W.players.some(q => q !== p && q.color === msg.color)) p.color = msg.color;
        emit({ t: 'welcome', pid: 'p1', serverVersion: 'mock-m1', debug: true });
        break;
      case 'ready': p.ready = !!msg.ready; if (W.players.every(q => q.ready)) W.phase = 'play'; break;
      case 'input': W._in = { mx: +msg.mx || 0, my: +msg.my || 0 }; p.lastSeq = msg.seq; break;
      case 'act': if (msg.down) { W._act = true; if (!p.console) act(p); } else { W._act = false; if (p.action && p.action.kind !== 'beam') p.action = null; } break;
      case 'drop': if (p.carry) { (p.zone === 'away' ? W.away.items : W.ship.groundItems).push({ id: nid('g'), kind: p.carry, x: p.x, y: p.y }); p.carry = null; } break;
      case 'leave': p.console = null; W._scanOn = false; W._tscanOn = false; W.ship.helm.turn = W.ship.helm.thrust = 0; break;
      case 'shoot':
        if (p.downed && !p.sh) break;
        W.away.projectiles.push({ id: nid('bl'), kind: p.downed ? 'pistol' : 'blaster', x: p.x, y: p.y, angle: msg.angle, _life: 1.1, _sx: p.x, _sy: p.y });
        break;
      case 'lobbyOpt':
        if (typeof msg.skipDrill === 'boolean') W.lobbyOpts.skipDrill = msg.skipDrill;
        if (((window.Shared_Protocol && window.Shared_Protocol.START_MISSIONS) || ['m1', 'm3']).indexOf(msg.startMission) >= 0) W.lobbyOpts.startMission = msg.startMission;
        break;
      case 'mark': W.away.marker = { x: msg.x, y: msg.y }; break;
      case 'cmd': cmd(p, msg); break;
      case 'ping': emit({ t: 'pong', ts: msg.ts }); break;
      case 'debug':
        if (keshDebug(msg)) break;
        if (msg.cmd === 'goto') setLoc(msg.loc);
        else if (msg.cmd === 'reactor') setReactor(msg.state);
        else if (msg.cmd === 'scanall') W.space.enemies.forEach(e => { e.scanned = true; });
        else if (msg.cmd === 'reveal') W._hidden.forEach(h => { h.revealed = true; });
        break;
    }
  }
  function setReactor(state) {
    const r = W.ship.reactor;
    r.state = state; r.switches = { A: false, B: false }; r.restartProgress = 0;
    r.output = state === 'overload' ? 12 : state === 'offline' ? 2 : 8;
    r.overloadLeft = state === 'overload' ? 142 : 0;
    if (state === 'offline') { W.ship.power = { engines: 0, shields: 1, weapons: 0, life: 1 }; }
  }

  // ---------------------------------------------------------------- Simulation
  function tick(dt) {
    W.tick++; W.time += dt;
    if (W.phase === 'lobby') return;
    W.stats.elapsed = W.time;
    const s = W.ship, p = me(), sp = W.space;
    // eigene Figur
    if (!p.console && !p.downed) {
      let { mx, my } = W._in;
      const l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; }
      if (mx || my) {
        const v = CFG.player.speed * (p.carry ? 0.85 : 1) * (p.cr ? acNum('crouch.speedFactor', 0.5) : 1) * dt;
        const r = Phys.moveWithCollision(isSolid(p.zone), p.x, p.y, mx * v, my * v, HB);
        p.moving = true; p.x = r.x; p.y = r.y;
        p.dir = Math.abs(mx) > Math.abs(my) ? (mx > 0 ? 'right' : 'left') : (my > 0 ? 'down' : 'up');
        if (p.action && p.action.kind !== 'beam') p.action = null;
      } else p.moving = false;
    }
    for (const q of W.players) {
      if (!q.action) continue;
      if (q.action.kind === 'minigame') { q.action.t = (q.action.t || 0) + dt; q.action.progress = Math.min(1, q.action.t / m3n('repair.minigameMinTime', 2.5)); continue; }
      const held = q !== p || W._act || W._holdAction || q.action.kind === 'beam';
      if (!held) { q.action = null; continue; }
      q.action.progress = Math.min(1, q.action.progress + dt / (q.action.dur || 3));
      if (q.action.progress >= 1) finishAction(q);
    }
    // Mitspieler
    W._crewT += dt;
    const p2 = W.players[1], p3 = W.players[2];
    const wantCon = params.get('console');
    if (p2 && p2.zone === 'ship') {
      if (wantCon === 'plan' || params.get('pins') === '1') { const sp = consoleSpot('plan', 1); p2.console = 'plan'; Object.assign(p2, tc(sp.x, sp.y)); p2.dir = sp.dir; p2.moving = false; }
      else if (!p2.console) {
        // läuft im Gang auf und ab (Gang aus SHIP_ROOMS)
        const g = shipRoom('gang') || { x0: 0, x1: Maps.ship.w - 1, y0: Maps.SHIP_SPAWNS[0].y, y1: Maps.SHIP_SPAWNS[0].y };
        const gy = Math.round((g.y0 + g.y1) / 2), gx0 = g.x0 + 1, span = Math.max(1, g.x1 - gx0);
        const tx = gx0 * 32 + 16 + (Math.sin(W._crewT * 0.4) * 0.5 + 0.5) * span * 32; const dx = tx - p2.x; p2.moving = Math.abs(dx) > 1; p2.dir = dx > 0 ? 'right' : 'left'; p2.x += Math.max(-96 * dt, Math.min(96 * dt, dx)); p2.y = gy * 32 + 16;
      }
    }
    if (p3 && p3.zone === 'ship') {
      const c3 = wantCon === 'weapons' ? 'helm' : wantCon === 'helm' ? 'weapons' : 'helm';
      const sp = consoleSpot(c3, 0);
      p3.console = c3; Object.assign(p3, tc(sp.x, sp.y)); p3.dir = sp.dir;
    }
    W.plan.seated = W.players.filter(q => q.console === 'plan').map(q => q.id);
    // Ivo im Gästequartier
    if (params.get('ivo') === '1' || W.mission.flags.technikerRescued) {
      const home = roomCenter(guestQuarter());   // M3a: Gästequartier aus BEDS/SHIP_ROOMS
      if (!s.npcs.length) s.npcs.push({ id: 'ivo', ...tc(home.x, home.y), dir: 'down', moving: false });
      const n = s.npcs[0];
      const gx = home.x * 32 + 16 + Math.sin(W._crewT * 0.3) * 40, gy = home.y * 32 + 16 + Math.cos(W._crewT * 0.21) * 24;
      n.moving = Math.hypot(gx - n.x, gy - n.y) > 2; n.dir = gx > n.x ? 'right' : 'left'; n.x = gx; n.y = gy;
    }
    // Schiff
    const h = s.helm;
    h.manned = W.players.some(q => q.console === 'helm');
    // M3b: Temporegler + Ruder über Flight.stepBody (Fallback: grobe Annäherung)
    const capOf2 = (x) => ({ ok: 1, damaged: 0.5, broken: 0.15, offline: 0.15 })[s.systems[x]] || 1;
    const sf = ([0, 0.5, 0.8, 1, 1.15][s.power.engines] || 0) * (s.systems.engines === 'broken' ? 0 : s.systems.engines === 'damaged' ? 0.5 : 1);
    if (!s.dockedAt) {
      if (h.turn) h.autoStop = false;
      const stopIdx = Math.max(0, LERCHE.stages.indexOf(0));
      if (h.autoStop) h.stage = stopIdx;
      const body = { x: s.x, y: s.y, angle: s.angle, vx: s.vx, vy: s.vy, turnVel: s.turnVel, stage: h.stage, dodgeT: s._dodgeT || 0 };
      const input = { stage: h.stage, rudder: h.manned ? h.turn : 0, brake: !!h.autoStop };
      if (FLIGHT) FLIGHT.stepBody(body, input, LERCHE, { speedFactor: sf, turnCapPort: capOf2('thruster_port'), turnCapStbd: capOf2('thruster_stbd') }, dt);
      else { body.angle += (input.rudder * LERCHE.turnRate * 0.6) * dt; const tv = LERCHE.stages[h.stage] * LERCHE.maxSpeed * sf; body.vx = Math.cos(body.angle) * tv; body.vy = Math.sin(body.angle) * tv; body.x += body.vx * dt; body.y += body.vy * dt; }
      s.x = Math.max(0, Math.min(sp.w, body.x)); s.y = Math.max(0, Math.min(sp.h, body.y)); s.angle = body.angle; s.vx = body.vx; s.vy = body.vy; s.turnVel = body.turnVel || 0; s._dodgeT = body.dodgeT;
      const v = Math.hypot(s.vx, s.vy); s.speed = Math.round(v * 10) / 10;
      const dock = sp.markers.find(m => m.kind === 'dock');
      if (dock && Math.hypot(dock.x - s.x, dock.y - s.y) < (dock.r || 70) && v <= 25 && LERCHE.stages[h.stage] <= 0.3) { s.dockedAt = W.world.location; s.docked = true; s.vx = s.vy = s.speed = 0; h.stage = stopIdx; W.shopContext = s.dockedAt; }
    } else { s.vx = s.vy = s.speed = 0; s.turnVel = 0; }
    // Snapshot-Felder wie der Server (space.helmSnapshot)
    {
      const fwd = s.vx * Math.cos(s.angle) + s.vy * Math.sin(s.angle);
      h.stages = LERCHE.stages.map(x => Math.round(x * LERCHE.maxSpeed));
      h.stageNames = LERCHE.stageNames; h.stop = Math.max(0, LERCHE.stages.indexOf(0)); h.agile = FLIGHT ? FLIGHT.agileStage(LERCHE) : 3;
      h.speedFactor = Math.round(sf * 100) / 100; h.fwd = Math.round(fwd * 10) / 10;
      h.turnFactor = Math.round((FLIGHT ? FLIGHT.turnFactor(LERCHE, fwd) : 1) * 100) / 100;
    }
    s.dodgeCd = Math.max(0, s.dodgeCd - dt);
    // Sprung
    const j = s.jump;
    if (!j.dest) j.blockedReason = 'Kein Ziel gewählt';
    else if (s.dockedAt) j.blockedReason = 'Noch angedockt';
    else if (sp.enemies.some(e => e.kind !== 'pylon')) j.blockedReason = 'Gegner in der Nähe';
    else { j.blockedReason = null; j.charge = Math.min(1, j.charge + dt / CFG.ship.jumpCharge); }
    j.ready = j.charge >= 1 && !j.blockedReason;
    // Waffen laden (Phasen 2 s)
    for (const mt of s.mounts) if (!MOUNT_SYS[mt.id]) mt.charge = Math.min(1, mt.charge + dt / 2);
    m3Tick(dt);   // M3a: Drehen, Waffen, Ladungen, Schildstoß, Reparaturliste
    // Reaktor
    const r = s.reactor;
    if (r.state === 'overload') { r.overloadLeft = Math.max(0, r.overloadLeft - dt); if (r.overloadLeft <= 0) setReactor('offline'); }
    if (r.state === 'offline') {
      const holder = W.players.find(q => q.action && q.action.kind === 'switch');
      r.switches = { A: false, B: false };
      if (holder) {
        r.switches[holder.action.sw] = true;
        W._switchHoldT += dt;
        if (W._switchHoldT > 3) r.switches[holder.action.sw === 'A' ? 'B' : 'A'] = true;   // Schrauber hilft
      } else W._switchHoldT = 0;
      if (params.get('reactor') === 'offline' && params.get('switches')) { r.switches.A = true; r.restartProgress = 0.45; }
      else if (r.switches.A && r.switches.B) { r.restartProgress = Math.min(1, r.restartProgress + dt / 3); if (r.restartProgress >= 1) { setReactor('online'); if (holder) holder.action = null; } }
      else r.restartProgress = 0;
    }
    r.used = Object.values(s.power).reduce((x, y) => x + y, 0);
    // Schilde
    W._shieldT += dt;
    if (W._shieldT >= 4) { W._shieldT = 0; for (let i = 0; i < 4; i++) s.shields.current[i] += Math.sign(s.shields.alloc[i] - s.shields.current[i]); }
    // Gegner
    for (const e of sp.enemies) {
      e._regen += dt;
      if (e._regen >= 5) { e._regen = 0; for (let i = 0; i < 4; i++) if (e.shields[i] < e.shieldsMax[i]) e.shields[i]++; }
      if (e.kind === 'pylon') { e.vx = 0; e.vy = 0; continue; }
      // M3b §3 (grob): Jäger fliegen Anflug -> Überflug -> Wende mit dem gemeinsamen Flugmodell
      if (e.kind === 'raider' && FLIGHT) {
        const P = (CFG.spaceM3b && CFG.spaceM3b.pilot) || {};
        e.state = e.state || 'approach'; e._st = (e._st || 0) + dt;
        if (e.vx == null) { e.vx = Math.cos(e.angle) * 150; e.vy = Math.sin(e.angle) * 150; e.turnVel = 0; e.stage = 2; }
        const dx = s.x - e.x, dy = s.y - e.y, d = Math.hypot(dx, dy);
        let rudder = 0, stage = 2;
        const steer = (ang) => { const err = Phys.normAngle(ang - e.angle); return Math.max(-1, Math.min(1, 2.5 * err - 1.2 * (e.turnVel || 0) / RAIDER.turnRate)); };
        if (e.state === 'approach') {
          const side = e.id.charCodeAt(e.id.length - 1) % 2 ? 1 : -1;
          const aim = Math.atan2(dy + s.vy * 1.5, dx + s.vx * 1.5) + side * Math.atan2(P.approachOffset || 60, Math.max(60, d));
          rudder = steer(aim);
          if (d < 120 || e._st > 9) { e.state = 'overshoot'; e._st = 0; }
        } else if (e.state === 'overshoot') {
          rudder = 0;
          if (d > (P.overshootDist || 380) || e._st > (P.overshootTime || 3)) { e.state = 'turn'; e._st = 0; }
        } else {
          stage = 1; rudder = steer(Math.atan2(dy, dx));
          if (Math.abs(Phys.normAngle(Math.atan2(dy, dx) - e.angle)) < 0.3 || e._st > 6) { e.state = 'approach'; e._st = 0; }
        }
        FLIGHT.stepBody(e, { stage, rudder }, RAIDER, {}, dt);
        e.x = Math.max(0, Math.min(sp.w, e.x)); e.y = Math.max(0, Math.min(sp.h, e.y));
        e._fire -= dt;
        if (e.state === 'approach' && e._fire <= 0 && Phys.inArc(e.x, e.y, e.angle, 0, 40, 400, s.x, s.y)) { e._fire = 2.5; sp.projectiles.push({ id: nid('pe'), kind: 'enemy', x: e.x, y: e.y, angle: Math.atan2(s.y - e.y, s.x - e.x) }); }
        continue;
      }
      const ox = e.x, oy = e.y;
      e.state = e.kind === 'gunboat' ? 'station' : undefined;
      if (e.kind === 'sentinel') { const dx = s.x - e.x, dy = s.y - e.y, d = Math.hypot(dx, dy); if (d > 200) { e.x += dx / d * 20 * dt; e.y += dy / d * 20 * dt; } e.angle = Math.atan2(dy, dx); e.vx = (e.x - ox) / dt; e.vy = (e.y - oy) / dt; continue; }
      e._a += dt * 0.3;
      const tx = s.x + Math.cos(e._a) * 260, ty = s.y + Math.sin(e._a) * 260;
      e.x += (tx - e.x) * Math.min(1, dt * 1.2); e.y += (ty - e.y) * Math.min(1, dt * 1.2);
      e.angle = e._a + Math.PI / 2;
      e.vx = (e.x - ox) / dt; e.vy = (e.y - oy) / dt;   // M3b: Snapshot vx/vy
      e._fire -= dt;
      if (e._fire <= 0 && Phys.inArc(e.x, e.y, e.angle, 0, 360, 400, s.x, s.y)) { e._fire = 3; sp.projectiles.push({ id: nid('pe'), kind: 'enemy', x: e.x, y: e.y, angle: Math.atan2(s.y - e.y, s.x - e.x) }); }
    }
    for (const pr of sp.projectiles.slice()) {
      pr.x += Math.cos(pr.angle) * 220 * dt; pr.y += Math.sin(pr.angle) * 220 * dt;
      if (Math.hypot(pr.x - s.x, pr.y - s.y) < 40) {
        const sec = Phys.sectorOf(s.x, s.y, s.angle, pr.x, pr.y);
        const shield = s.shields.current[sec] > 0;
        if (shield) s.shields.current[sec]--; else s.hull = Math.max(30, s.hull - 5);
        ev('hit', { sector: sec, shield, dmg: 1 });
        sp.projectiles.splice(sp.projectiles.indexOf(pr), 1);
      } else if (Math.hypot(pr.x - s.x, pr.y - s.y) > 1400) sp.projectiles.splice(sp.projectiles.indexOf(pr), 1);
    }
    for (const b of sp.beams) b.ttl -= dt;
    sp.beams = sp.beams.filter(b => b.ttl > 0);
    // Ziel-Scan (2 s, ≤ 800)
    if (W._tscanOn) {
      W._tscanT += dt;
      if (W._tscanT > 0.6) W._tscanOn = false;   // Client erneuert alle 0,3 s
      const tg = targetObj(s.tscan.targetId);
      if (tg && Math.hypot(tg.x - s.x, tg.y - s.y) <= 800) {
        s.tscan.progress = Math.min(1, s.tscan.progress + dt / 2);
        if (s.tscan.progress >= 1) {
          if (tg.hp != null) tg.scanned = true; else { tg.found = true; addLog((tg.kind === 'beacon' ? 'Leitbake' : tg.kind === 'lore' ? 'Lore-Bake' : 'Versteck') + ' gescannt.', W.world.location); if (tg.kind === 'beacon') { const rl = locOf('relais'); rl.known = true; } W.mission.discoveries.found++; }
          s.tscan = { targetId: null, progress: 0 }; W._tscanOn = false;
        }
      }
    } else if (s.tscan.progress > 0 && s.tscan.progress < 1) s.tscan.progress = 0;
    s.widescan.cd = Math.max(0, s.widescan.cd - dt);
    // Captain-Scan (Ziel wie beim Server: ship.scan.target)
    const stgt = { b7: { id: 'buoy', label: 'Boje B-7', x: 2000, y: 1500, range: 420 }, relais: { id: 'core', label: 'Relaiskern', x: 1800, y: 1500, range: 460 } }[W.world.location] || null;
    s.scan.target = s.scan.done ? null : stgt;
    if (W._scanOn) { W._scanT += dt; if (W._scanT > 0.6) W._scanOn = false; s.scan.progress = Math.min(1, s.scan.progress + dt / 6); if (s.scan.progress >= 1) s.scan.done = true; }
    // Außenmission
    const a = W.away;
    if (a.map === 'kesh') keshTick(dt);
    else for (const d of a.drones) { if (!d.alive) continue; d.x = d._o.x + Math.sin(W.time * 0.8 + d._o.y) * 30; d.y = d._o.y + Math.cos(W.time * 0.6 + d._o.x) * 10; }
    if (a.map !== 'kesh') for (const pr of a.projectiles) { pr.x += Math.cos(pr.angle) * 360 * dt; pr.y += Math.sin(pr.angle) * 360 * dt; pr._life -= dt; for (const d of a.drones) if (d.alive && Math.hypot(d.x - pr.x, d.y - 14 - pr.y) < 14) { d.hp -= 2; pr._life = 0; if (d.hp <= 0) d.alive = false; } }
    if (a.map !== 'kesh') a.projectiles = a.projectiles.filter(pr => pr._life > 0);
    for (const k in W.support) W.support[k] = Math.max(0, W.support[k] - dt);
    s.alert = (sp.enemies.length || s.hull < 40) ? 'red' : (r.state === 'offline' || s.fires.length) ? 'yellow' : 'normal';
    sp.hidden = W._hidden.filter(x => x.revealed).map(x => ({ id: x.id, kind: x.kind, x: x.x, y: x.y, found: !!x.found }));
    W.world.locations.forEach(l => { l.unknown = !l.known && W.world.locations.some(k => k.known && (k.links || []).indexOf(l.id) >= 0 && !(k.id === 'nebel' && l.id === 'relais')); });
  }

  function snapshot() {
    const strip = (o) => { const r = {}; for (const k in o) if (k[0] !== '_') r[k] = o[k]; return r; };
    const snap = {
      t: 'snap', tick: W.tick, time: Math.round(W.time * 100) / 100, phase: W.phase,
      lobby: { skipDrill: W.lobbyOpts.skipDrill, startMission: W.lobbyOpts.startMission },
      players: W.players.map(p => { const r = strip(p); if (r.action) r.action = { kind: r.action.kind, system: r.action.sys || r.action.system, progress: r.action.kind === 'switch' ? W.ship.reactor.restartProgress : r.action.progress }; return r; }),
      bots: W.bots.map(b => { const r = strip(b); delete r.home; return r; }),
      world: { location: W.world.location },
      ship: W.ship,
      space: { w: W.space.w, h: W.space.h, enemies: W.space.enemies.map(e => { const r = strip(e); if (!r.scanned) r.weapons = null; return r; }), projectiles: W.space.projectiles.map(strip), beams: W.space.beams, markers: W.space.markers, salvage: W.space.salvage, hidden: W.space.hidden },
      away: Object.assign({}, W.away, { drones: W.away.drones.map(strip), projectiles: W.away.projectiles.map(strip) }),
      support: W.support, inventory: W.inventory, upgrades: W.upgrades, quarters: W.quarters, deco: W.deco, plan: W.plan,
      mission: W.mission, stats: W.stats, shopContext: W.shopContext, errors: 0,
    };
    // statische Ortsdaten nur alle 15 Snapshots (Client muss sie behalten, §10)
    if (W._locSent % 15 === 0) snap.world.locations = W.world.locations;
    W._locSent++;
    if (W._sendAsteroids || W.tick % 15 === 0) { snap.space.asteroids = W.space.asteroids; W._sendAsteroids = false; }
    return clone(snap);
  }

  // ---------------------------------------------------------------- Startzustand aus URL
  function applyParams() {
    const loc = params.get('loc') || 'hafen';
    setLoc(loc, { silent: true });
    const p = me();
    if (params.get('markers') === '1' || params.get('console') === 'helm') {
      const s = W.ship;
      s.markers.captain = { x: Math.round(s.x + Math.cos(s.angle - 0.35) * 520), y: Math.round(s.y + Math.sin(s.angle - 0.35) * 520) };
      s.markers.tactical = { x: Math.round(s.x + Math.cos(s.angle + 1.9) * 900), y: Math.round(s.y + Math.sin(s.angle + 1.9) * 900) };
    }
    if (params.get('reactor')) setReactor(params.get('reactor'));
    if (params.get('scanned') === '1' && W.space.enemies[0]) { W.ship.target = W.space.enemies[0].id; W.ship.tscan = { targetId: W.space.enemies[1] ? W.space.enemies[1].id : null, progress: 0.55 }; }
    if (params.get('pins') === '1' || params.get('console') === 'plan') {
      W.plan.pins.push({ id: 'seed1', owner: 'p2', map: 'star', x: 575, y: 262, label: 'gefahr' });
      W.plan.pins.push({ id: 'seed2', owner: 'p3', map: 'star', x: 405, y: 318, label: 'ziel' });
      W.plan.pins.push({ id: 'seed3', owner: 'p1', map: 'star', x: 245, y: 442, label: 'treffpunkt' });
      W.plan.pins.push({ id: 'seed4', owner: 'p2', map: 'wreck', x: 22 * 32 + 16, y: 9 * 32 + 16, label: 'frage' });
      W.plan.pins.push({ id: 'seed5', owner: 'p1', map: 'platform', x: 4 * 32, y: 3 * 32, label: 'landeplatz' });
    }
    if (params.get('m1end') === '1') { W.mission.m1Done = true; W.mission.list[1].state = 'done'; W.mission.active = null; W.mission.discoveries.found = 6; W.stats.elapsed = 2310; }
    if (params.get('zone') === 'away' || (loc === 'kesh' && params.get('console'))) setAway(true);
    if (params.get('start') === 'm3') W.lobbyOpts.startMission = 'm3';
    m3Params();
    const pos = (params.get('pos') || '').split(',').map(Number);
    if (pos.length === 2 && isFinite(pos[0]) && p.zone === 'ship') Object.assign(p, tc(pos[0], pos[1]));
    const c = params.get('console');
    if (c) {
      p.console = c;
      // M3a: Stehplatz aus der Legende (Konsole) bzw. vor der eigenen Koje (Quartier)
      let at = null;
      if (c === 'quartier') { const b = (Maps.BEDS || []).find(q => q.color === p.color) || (Maps.BEDS || [])[0]; if (b) at = standNear(b); }
      else if (shipTiles(i => i.console === c).length) at = consoleSpot(c, 0);
      if (at && p.zone === 'ship') Object.assign(p, tc(at.x, at.y));
      if (c === 'captain' && window.Consoles) Consoles.tab = Math.max(0, Math.min(5, +params.get('tab') || 0));
    }
  }

  // ---------------------------------------------------------------- Fake-Socket
  DevMock.createSocket = function () {
    if (!W) { W = newWorld(); try { applyParams(); } catch (e) { Net.reportError('DevMock.applyParams', e); } }
    const s = {
      readyState: 0, onopen: null, onmessage: null, onclose: null, onerror: null,
      send(str) { let m; try { m = JSON.parse(str); } catch (e) { return; } try { onClientMessage(m); } catch (e) { Net.reportError('DevMock.onClientMessage', e); } },
      close() { s.readyState = 3; if (s.onclose) s.onclose({}); },
    };
    sock = s;
    setTimeout(() => { s.readyState = 1; if (s.onopen) s.onopen({}); }, 30);
    return s;
  };

  DevMock.setLoc = (id) => setLoc(id);
  DevMock.nextLoc = nextLoc;
  DevMock.setAway = setAway;
  DevMock.setReactor = setReactor;
  DevMock.stageName = () => (W ? W.world.location : '');
  DevMock.world = () => W;
  DevMock.setConsole = (c) => { if (W) me().console = c; };
  DevMock.oda = oda;

  let last = performance.now(), acc = 0, snapAcc = 0;
  setInterval(() => {
    const now = performance.now();
    acc += Math.min(0.25, (now - last) / 1000); last = now;
    const dt = 1 / 30;
    while (acc >= dt) {
      acc -= dt;
      if (W) { try { tick(dt); } catch (e) { Net.reportError('DevMock.tick', e); } snapAcc += dt; }
      if (W && snapAcc >= 1 / 15) { snapAcc = 0; emit(snapshot()); }
    }
  }, 1000 / 60);

  window.addEventListener('keydown', (e) => {
    if (!W || document.activeElement && document.activeElement.tagName === 'INPUT') return;
    if (e.code === 'PageDown') { e.preventDefault(); nextLoc(1); }
    else if (e.code === 'PageUp') { e.preventDefault(); nextLoc(-1); }
    else if (e.code === 'Home') { e.preventDefault(); setAway(me().zone === 'ship'); }
    else if (e.code === 'End') { e.preventDefault(); const order = ['online', 'overload', 'offline']; setReactor(order[(order.indexOf(W.ship.reactor.state) + 1) % 3]); }
  });
})();
