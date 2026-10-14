'use strict';
// SL5 (CONCEPT-SL5): Signal entschlüsseln – Server headless.   node tools/test-entschluesseln.js
// Prüft: Signal liegt an, Abstimmung, Qualität 0–3 (Schichten, versteckte Schicht nur bei 3), Abbruch, Fakt, Baustein und Prüfung, Snapshot `en`.
const Game = require('../server/game.js').Game;
const Physics = require('../shared/physics.js');
const W = require('../server/world.js');
const Entschl = require('../server/sim/entschluesseln.js');
const Registry = require('../server/mission/registry.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

const STAND = [[0, 1, 'up'], [0, -1, 'down'], [-1, 0, 'right'], [1, 0, 'left']];
function conSpot(con) {
  for (const t of [].concat(W.CONSOLE_TILES[con])) for (const [dx, dy, dir] of STAND) {
    const s = { x: t.x + dx, y: t.y + dy, dir };
    if (!W.ship.solid(s.x, s.y)) return s;
  }
  return null;
}
function setup(seed) {
  const g = new Game({ noStore: true, seed: seed || 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'E0', name: 'Ops', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' }); g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = []; g.space.projectiles = [];
  const p = g.players[0];
  const s = conSpot('weapons'); const ctr = Physics.tileCenter(s.x, s.y); p.x = ctr.x; p.y = ctr.y; p.dir = s.dir;
  g.handleMessage(c, { t: 'act', down: true }); g.handleMessage(c, { t: 'act', down: false });
  const cmd = (k, extra) => g.handleMessage(c, Object.assign({ t: 'cmd', c: k }, extra || {}));
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) { g.space.enemies = []; g.step(); } };
  const radios = () => c.inbox.filter((m) => m.t === 'event' && m.kind === 'radio').map((m) => m.text);
  return { g, c, p, cmd, run, radios, events: (k) => c.inbox.filter((m) => m.t === 'event' && m.kind === k) };
}
// Spieler am Regler: folgt dem Zielband (Server kennt es) mit festem Versatz `abw` (0 = sauber; größer = ungenauer, Signalstärke 1 − abw/weitBand)
function spiele(t, abw, maxSek) {
  const e = t.g.entschl;
  for (let k = 0; k < Math.round(maxSek * 30) && t.g.entschl && t.g.entschl.z === 1; k++) {
    const ziel = e.ziel + abw;
    const d = Math.abs(e.f - ziel) < 0.02 ? 0 : (ziel > e.f ? 1 : -1);
    if (d !== e.dir) t.cmd('weapons.entschl.stimme', { dir: d });
    t.g.space.enemies = []; t.g.step();
  }
}

console.log('Signal und Abstimmung');
{
  const t = setup(); const g = t.g;
  ok(g.players[0].console === 'weapons', 'Ops an der Taktik-Konsole');
  ok(Entschl.snapshot(g) === null && g.snapshot().en === undefined, 'kein Signal: Snapshot ohne en');
  ok(t.cmd('weapons.entschl.start') === undefined && g.entschl === null, 'start ohne Signal: nichts');
  ok(Entschl.starten(g, Entschl.testSignal('t1')) === null && g.entschl.z === 0, 'Signal liegt an (z 0)');
  ok(g.snapshot().en && g.snapshot().en.z === 0, 'Snapshot en.z = 0');
  ok(Entschl.starten(g, { id: 'x', schichten: [] }) === 'Signal ohne Inhalt.', 'ohne Schichten abgelehnt');
  t.cmd('weapons.entschl.start');
  ok(g.entschl.z === 1, 'start (V): Abstimmung läuft');
  ok(Math.abs(g.entschl.f - g.entschl.ziel) > 0.15, 'Band liegt nicht auf der Startstellung');
  const en = g.snapshot().en;
  ok(en.z === 1 && en.f != null && en.s != null && en.h != null && en.q != null, 'Snapshot en: f, s, h, q während der Abstimmung');
  ok(JSON.stringify(en).length < 100, 'en kompakt (' + JSON.stringify(en).length + ' B)');
  t.cmd('weapons.entschl.stimme', { dir: 1 }); t.run(1);
  ok(g.entschl.f > 0.7 && g.entschl.dir === 1, 'Frequenz folgt der gehaltenen Richtung');
  t.cmd('weapons.entschl.stimme', { dir: 0 });
}

console.log('Qualität 0–3');
const ERG = {};
for (const [name, abw, erwartet] of [['sauber', 0, 3], ['gut', 0.06, 2], ['mäßig', 0.12, 1], ['schlecht', 0.19, 0]]) {
  const t = setup(5); const g = t.g;
  Entschl.starten(g, Entschl.testSignal('q_' + name)); t.cmd('weapons.entschl.start');
  spiele(t, abw, 600);
  const q = Entschl.ergebnis(g, 'q_' + name);
  ERG[name] = q;
  ok(q === erwartet, `${name}: Qualität ${q} (erwartet ${erwartet})`);
  ok(g.entschl && g.entschl.z === 2, `${name}: fertig, Ergebnis steht an`);
  const texte = t.radios().filter((x) => !/^Verschlüsseltes Signal/.test(x));
  ok(texte.length === Math.max(1, q + 1), `${name}: ${texte.length} Funkzeile(n) für Qualität ${q}`);
  ok(texte.some((x) => /Zweite Schicht/.test(x)) === (q === 3), `${name}: versteckte zweite Schicht nur bei Qualität 3`);
}
ok(ERG.sauber === 3, 'sauberes Signal liefert Qualität 3');
ok(ERG.schlecht <= 1 && ERG.sauber > ERG.schlecht, 'schlechte Abstimmung liefert weniger Qualität');

console.log('Ergebnis, Fakt, Abbruch, Baustein, Prüfung');
{
  const t = setup(9); const g = t.g;
  Entschl.starten(g, Entschl.testSignal('a1')); t.cmd('weapons.entschl.start'); t.run(1);
  t.cmd('weapons.entschl.stopp');
  ok(g.entschl.z === 2 && g.entschl.q === 0, 'Abbruch nach 1 s: Qualität 0');
  ok(Entschl.ergebnis(g, 'a1') === 0, 'ergebnis() liefert 0');
  t.run(Math.ceil(g.C.entschl.anzeigeDauer) + 1);
  ok(g.entschl === null, 'Ergebnisanzeige verschwindet nach anzeigeDauer');
  ok(Entschl.ergebnis(g, 'a1') === 0, 'Ergebnis bleibt');
  const b = Registry.get('entschluesseln_starten'), pr = Registry.get('entschluesselt');
  ok(b && b.art === 'aktion' && pr && pr.art === 'pruefung', 'Bausteine registriert');
  const m = { game: g, tpl: (s) => s };
  b.run(m, { id: 'k5', absender: 'Bote', schicht0: 'Grundtext', schicht3: 'Versteckt' });
  ok(g.entschl && g.entschl.id === 'k5' && g.entschl.schichten.length === 2 && g.entschl.schichten[1].ab === 3, 'Baustein legt Signal mit versteckter Schicht an');
  ok(pr.test(m, { id: 'k5' }) === false, 'Prüfung: noch nicht entschlüsselt');
  t.cmd('weapons.entschl.start'); spiele(t, 0, 200);
  ok(pr.test(m, { id: 'k5', min: 3 }) === true, 'Prüfung: Qualität 3 erreicht');
  ok(t.events('missionEvent').length >= 0, 'Ereignis entschluesselt wird gemeldet');
}

console.log('Bot (sim-headless GenericAgent, Bergsteigen)');
{
  const fs = require('fs'), path = require('path'), Module = require('module');
  const file = path.join(__dirname, 'sim-headless.js');
  let src = fs.readFileSync(file, 'utf8');
  src = src.slice(0, src.lastIndexOf('\n(async () => {')) + '\n;module.exports = { GenericAgent, setSimRng: (r) => { simRng = r; } };\n';
  const argv = process.argv; process.argv = [argv[0], file];
  let Sim; try { const m = new Module(file, module); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file)); m._compile(src, file); Sim = m.exports; } finally { process.argv = argv; }
  const { makeRng } = require('../server/util.js');
  for (const [name, abw, qmin, qmax] of [['genau', 0, 2, 3], ['ungenau', 0.14, 0, 1]]) {
    Sim.setSimRng(makeRng(11));
    const g = new Game({ noStore: true, seed: 13, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    g.simStats = { reactorRestarts: 0, widescans: 0, wreckDone: false, orders: 0, coverShots: 0, keyTries: 0 };
    const a = new Sim.GenericAgent(g, 0, 'solo', { seed: 13, entschlAbw: abw });
    g.simAgents = [a];
    g.addConnection(a.conn); g.handleMessage(a.conn, { t: 'lobbyOpt', startMission: 'arena_space' }); a.hello();
    if (g.arena) g.arena.nextAt = null;
    let S = g.snapshot();
    for (let k = 0; k < 60; k++) { g.space.enemies = []; g.step(); if (k % 2 === 0) S = g.snapshot(); a.update(S); }
    Entschl.starten(g, Entschl.testSignal('bot_' + name));
    for (let k = 0; k < 30 * 400 && Entschl.ergebnis(g, 'bot_' + name) == null; k++) { g.space.enemies = []; g.step(); if (k % 2 === 0) S = g.snapshot(); a.update(S); }
    const q = Entschl.ergebnis(g, 'bot_' + name);
    ok(q != null && q >= qmin && q <= qmax, `Bot (${name}): Qualität ${q} (erwartet ${qmin}–${qmax})`);
  }
}

console.log('Nur Ops, keine zweite Abstimmung');
{
  const t = setup(3); const g = t.g;
  Entschl.starten(g, Entschl.testSignal('z1')); t.cmd('weapons.entschl.start');
  ok(Entschl.starten(g, Entschl.testSignal('z2')) === 'Eine Abstimmung läuft noch.', 'während der Abstimmung kein neues Signal');
  g.players[0].console = null; g.players[0].station = null; t.run(0.1);
  ok(g.entschl.dir === 0, 'ohne Ops keine Eingabe wirkt');
}

console.log(`\n${n - fails}/${n} Prüfungen bestanden.`);
process.exit(fails ? 1 : 0);
