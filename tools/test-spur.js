'use strict';
// SL5 (CONCEPT-SL5): Ionenspur, Server headless auf Sund.   node tools/test-spur.js
// Spurkern und Lesen, Alter, Teilung (Entschlüsseln, falscher Ast), Ende enthüllt die verborgene Kante, Hex-Marke, Weltstand, Baustein, Bot über 3 Hexe.
const Game = require('../server/game.js').Game;
const Physics = require('../shared/physics.js');
const W = require('../server/world.js');
const Welt = require('../server/sim/welt.js');
const Sektoren = require('../shared/sektoren.js');
const Spur = require('../server/sim/spur.js');
const Entschl = require('../server/sim/entschluesseln.js');
const Marken = require('../server/sim/marken.js');
const Space = require('../server/sim/space.js');
const Registry = require('../server/mission/registry.js');
const Weltstand = require('../server/weltstand.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const STAND = [[0, 1, 'up'], [0, -1, 'down'], [-1, 0, 'right'], [1, 0, 'left']];
function conSpot(con) {
  for (const t of [].concat(W.CONSOLE_TILES[con])) for (const [dx, dy, dir] of STAND) { const s = { x: t.x + dx, y: t.y + dy, dir }; if (!W.ship.solid(s.x, s.y)) return s; }
  return null;
}
function setup(scene) {
  const g = new Game({ noStore: true, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'P0', name: 'Ops', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' }); g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  Welt.waehle(g, 'sund');
  Space.enterScene(g, scene, {}); g.explore.location = scene; g.explore._tutKarte = new Set();
  const p = g.players[0]; const s = conSpot('weapons'); const ctr = Physics.tileCenter(s.x, s.y); p.x = ctr.x; p.y = ctr.y; p.dir = s.dir;
  g.handleMessage(c, { t: 'act', down: true }); g.handleMessage(c, { t: 'act', down: false });
  const cmd = (k, extra) => g.handleMessage(c, Object.assign({ t: 'cmd', c: k }, extra || {}));
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) { g.space.enemies = []; g.step(); } };
  const odas = () => c.inbox.filter((m) => m.t === 'event' && m.kind === 'oda').map((m) => m.text);
  const ort = (hex) => Sektoren.ortVonHex(hex);
  const flieg = (hex) => { Space.enterScene(g, ort(hex), {}); g.explore.location = ort(hex); run(0.1); };
  const zumKern = () => { const k = Spur.kern(g.spur.id, Sektoren.hexVonOrt(g.ship.scene)); g.ship.x = k.x + 40; g.ship.y = k.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.speed = 0; g.ship.docked = false; g.ship.dockedAt = null; };
  return { g, c, p, cmd, run, odas, flieg, zumKern };
}
const kante = (g) => g.explore.kanteOffen(Sektoren.kanteId('0605', '0606'));

Welt.waehle(null, 'sund');
try {
  console.log('Spur: Start, Lesen, Alter, Hex-Marke');
  {
    const t = setup('kantenstein'); const g = t.g;
    ok(Spur.datei('bote') && Spur.datei('bote').weg.length === 3, 'content/spuren/bote.json lädt (3 Hexe)');
    ok(/gibt es nicht/.test(Spur.starten(g, 'gibt_es_nicht')), 'unbekannte Spur abgelehnt');
    ok(Spur.starten(g, 'bote') === null && g.spur.idx === 0, 'Spur gestartet');
    ok(Marken.da(g, 'spur:bote') && Marken.liste(g).some((m) => m.t === 'spur' && m.h === '0603'), 'Hex-Marke "spur" am Start-Hex (marken.js, ein Mechanismus)');
    ok(g.snapshot().space.sp === undefined || g.snapshot().space.sp.r === g.C.spur.leseRadius, 'Snapshot space.sp nur im Spur-Hex');
    const k = Spur.kern('bote', '0603'); const g3 = Sektoren.hexVonOrt('kantenstein') === '0603';
    ok(g3 && k.x > 800 && k.x < 2200, 'Spurkern in der Szenenmitte (' + k.x + ',' + k.y + ')');
    ok(g.snapshot().space.sp && g.snapshot().space.sp.x === k.x, 'Snapshot sp trägt den Spurkern');
    t.cmd('weapons.spur.lesen', { on: true });
    t.run(1);
    ok(g.spur.lese === 0 || g.spur.lese < 0.001, 'zu weit vom Spurkern: Lesen abgelehnt');
    t.zumKern(); t.cmd('weapons.spur.lesen', { on: true });
    ok(g.spur.lese > 0, 'am Spurkern: Lesen beginnt');
    t.run(2);
    ok(g.snapshot().space.sp.p > 0.2, 'Lesefortschritt im Snapshot');
    g.ship.x += 900; t.run(0.2);
    ok(g.spur.lese === 0, 'Verlassen des Leseradius bricht ab');
  }

  console.log('Spur: Teilung (Entschlüsseln), falscher Ast, Weiterreise, Ende');
  {
    const t = setup('kantenstein'); const g = t.g;
    Spur.starten(g, 'bote'); t.zumKern(); t.cmd('weapons.spur.lesen', { on: true }); t.run(g.C.spur.leseZeit + 0.5);
    ok(g.entschl && /^spur_bote_0/.test(g.entschl.id) && g.spur.wartet, 'Teilung öffnet ein Entschlüssel-Signal');
    ok(/Spur: |teilt sich/.test(t.odas().join(' ')), 'Ansage der Teilung');
    ok(!Marken.liste(g).some((m) => m.h === '0604'), 'noch keine Marke auf den echten Ast (Signal offen)');
    // Qualität 3: Bot-ähnlich sauber abstimmen
    t.cmd('weapons.entschl.start');
    for (let k = 0; k < 30 * 120 && g.entschl && g.entschl.z === 1; k++) {
      const e = g.entschl; const d = Math.abs(e.f - e.ziel) < 0.02 ? 0 : (e.ziel > e.f ? 1 : -1);
      if (d !== e.dir) t.cmd('weapons.entschl.stimme', { dir: d });
      g.space.enemies = []; g.step();
    }
    t.run(0.2);
    ok(Entschl.ergebnis(g, 'spur_bote_0') === 3, 'Qualität 3 beim Abstimmen');
    ok(g.spur.gelesen && !g.spur.wartet, 'Spur gelesen');
    ok(Marken.liste(g).some((m) => m.t === 'spur' && m.h === '0604'), 'Qualität 3: Hex-Marke zeigt den echten Ast (Concordia)');
    // falscher Ast: Gasfeld
    t.flieg('0503');
    ok(g.spur.falsch === true, 'falscher Ast (Gasfeld): Spur endet');
    ok(/falsche Ast/.test(t.odas().join(' ')), 'Ansage: falscher Ast');
    t.cmd('weapons.spur.lesen', { on: true });
    ok(g.spur.lese === 0, 'im falschen Ast ist nichts zu lesen');
    t.flieg('0603');
    ok(g.spur.falsch === false && g.spur.idx === 0, 'zurück im Teilungs-Hex: weiter wie vorher, keine Strafe');
    // echter Ast
    t.flieg('0604');
    ok(g.spur.idx === 1 && !g.spur.gelesen, 'echter Ast: Spur rückt vor (Concordia)');
    t.zumKern(); t.cmd('weapons.spur.lesen', { on: true }); t.run(g.C.spur.leseZeit + 0.5);
    ok(g.spur.gelesen && Marken.liste(g).some((m) => m.t === 'spur' && m.h === '0605'), 'Concordia gelesen: Spur führt nach Pulverhorn');
    ok(t.odas().some((x) => /vor 21 min|vor 1260 s/.test(x) || /vor \d+ min/.test(x)), 'Alter der Spur genannt');
    t.flieg('0605');
    ok(g.spur.idx === 2, 'Pulverhorn: letzter Hex der Spur');
    ok(!kante(g), 'verborgene Kante noch nicht offen');
    t.zumKern(); t.cmd('weapons.spur.lesen', { on: true }); t.run(g.C.spur.leseZeit + 0.5);
    ok(g.spur.fertig && kante(g), 'Ende: verborgene Kante nach Schrottkante enthüllt und offen');
    ok(!Marken.da(g, 'spur:bote'), 'Spur-Marke entfernt');
    const pr = Registry.get('spur_ende'); ok(pr.test({ game: g }, { id: 'bote' }) === true, 'Prüfung spur_ende');
    ok(Spur.snapshot(g) === null && g.snapshot().space.sp === undefined, 'nach dem Ende: kein Spurkern mehr im Snapshot');
    // Weltstand
    const data = Weltstand.capture(g);
    ok(data.welt.spur && data.welt.spur.fertig && data.welt.spur.idx === 2, 'Weltstand: welt.spur gespeichert');
    const fehler = (Weltstand.validate(data, g) || []).filter((f) => /welt/.test(String(f)));   // id/name fehlen ohne Weltstand-Datei im Test: nicht Thema
    ok(fehler.length === 0, 'Weltstand-Schema akzeptiert welt.spur' + (fehler.length ? ': ' + JSON.stringify(fehler).slice(0, 200) : ''));
    const g2 = setup('kantenstein').g; Spur.restore(g2, JSON.parse(JSON.stringify(data.welt.spur)));
    ok(g2.spur && g2.spur.idx === 2 && g2.spur.fertig, 'Laden: Spur steht wieder');
    Spur.restore(g2, undefined); ok(g2.spur === null, 'Altstand ohne welt.spur: keine Spur');
  }

  console.log('Baustein und Hexwechsel mitten in der Spur gespeichert');
  {
    const t = setup('concordia'); const g = t.g;
    const b = Registry.get('spur_starten');
    b.run({ game: g }, { id: 'bote' });
    ok(g.spur && g.spur.id === 'bote', 'Baustein spur_starten startet die Spur');
    const s2 = setup('concordia').g; Spur.restore(s2, { id: 'bote', idx: 1, gelesen: true, fertig: false });
    ok(s2.spur.idx === 1 && Marken.liste(s2).some((m) => m.t === 'spur' && m.h === '0605'), 'Laden mit gelesener Spur: Marke zeigt den nächsten Hex');
  }

  console.log('Bot: ganze Spur über 3 Hexe bis zur verborgenen Kante (sim-headless)');
  {
    const fs = require('fs'), path = require('path'), Module = require('module');
    const file = path.join(__dirname, 'sim-headless.js');
    let src = fs.readFileSync(file, 'utf8');
    src = src.slice(0, src.lastIndexOf('\n(async () => {')) + '\n;module.exports = { GenericAgent, setSimRng: (r) => { simRng = r; } };\n';
    const argv = process.argv; process.argv = [argv[0], file];
    let Sim; try { const m = new Module(file, module); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file)); m._compile(src, file); Sim = m.exports; } finally { process.argv = argv; }
    const { makeRng } = require('../server/util.js');
    Sim.setSimRng(makeRng(5));
    const g = new Game({ noStore: true, seed: 5, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    g.simStats = { reactorRestarts: 0, widescans: 0, wreckDone: false, orders: 0, coverShots: 0, keyTries: 0 };
    const a = new Sim.GenericAgent(g, 0, 'solo', { seed: 5 });
    g.simAgents = [a];
    g.addConnection(a.conn); g.handleMessage(a.conn, { t: 'lobbyOpt', startMission: 'arena_space' }); a.hello();
    if (g.arena) g.arena.nextAt = null;
    Welt.waehle(g, 'sund');
    g.weltstand = { persistent: true, data: { tutorial: 'uebersprungen', fakten: {}, chronik: [] } };   // Kampagnenregeln (Sprungziel nach Hex-Regel), kein Tutorial
    Space.enterScene(g, 'kantenstein', {}); g.explore.location = 'kantenstein'; g.explore._tutKarte = new Set();
    for (const o of ['kantenstein', 'concordia', 'pulverhorn']) g.explore.knowSilently(o);
    for (const [x, y] of [['0603', '0604'], ['0604', '0605']]) g.explore.markBoje(Sektoren.kanteId(x, y));
    Spur.starten(g, 'bote');
    let S = g.snapshot(); let k = 0; const hexe = new Set();
    for (; k < 30 * 1500 && !g.spur.fertig; k++) { g.space.enemies = []; g.step(); if (k % 2 === 0) S = g.snapshot(); a.update(S); hexe.add(Sektoren.hexVonOrt(g.ship.scene)); if (process.env.DBG && k % 600 === 0) console.log("   dbg", a.notices.slice(-2), g.ship.jump.dest, g.ship.jump.blockedReason, Math.round(k/30), JSON.stringify(g.spur), g.entschl && g.entschl.z, a.me(S).console, Math.round(g.ship.x), Math.round(g.ship.y), g.ship.speed && Math.round(g.ship.speed), g.ship.helm.stage); }
    ok(g.spur.fertig && kante(g), `Bot folgt der Spur bis zum Ende (${Math.round(k / 30)} s Spielzeit, Hexe ${[...hexe].join(',')})`);
    ok(hexe.has('0603') && hexe.has('0604') && hexe.has('0605'), 'über mindestens 3 Hexe');
  }
} finally { Welt.waehle(null, 'limes'); }

console.log(`\n${n - fails}/${n} Prüfungen bestanden.`);
process.exit(fails ? 1 : 0);
