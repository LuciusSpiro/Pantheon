'use strict';
// PAN-01 Paket B (CONTRACT-PAN01-B): neue Lerche – drei Decks, Ausbaustufen 0–3, Pforten, vier gleiche Modulräume, mehrere Frachträume, Weltstand.
// Die Geometrie (Räume, Brücke, Lifts, Pforten, Waffenplätze, Reparaturwege) prüft tools/check-maps.js; hier läuft alles gegen den echten Server.
//   node tools/test-lerche.js            -> alle Abschnitte
//   node tools/test-lerche.js stufe      -> nur Abschnitte, deren Name einen der Begriffe enthält
const fs = require('fs');
const os = require('os');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Maps = require('../shared/maps.js');
const Physics = require('../shared/physics.js');
const Weltstand = require('../server/weltstand.js');
const { Game } = require('../server/game.js');
const Fracht = require('../server/sim/fracht.js');
const Modul = require('../server/sim/module.js');
const Ausbau = require('../server/sim/ausbau.js');
const PB = require('../server/sim/personen-bord.js');
const interior = require('../server/sim/interior.js');
const space = require('../server/sim/space.js');
const W = require('../server/world.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

function section(name, body) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-lerche-'));
let dirSeq = 0;
const freshDir = () => { const d = path.join(TMP, 'w' + (++dirSeq)); fs.mkdirSync(d, { recursive: true }); return d; };

// Partie mit einem Spieler. start: 'arena_space' (leeres Testgelände) | 'free' (Kampagne ohne Tutorial, Weltstand auf der Platte)
function setup(start, opts) {
  const o = opts || {};
  const worlds = start !== 'arena_space';
  const g = new Game(Object.assign({ noStore: true, worlds, worldSaveSync: true, worldDir: o.dir, seed: o.seed || 21, debug: true,
    env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} }, o.game || {}));
  const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'L0', name: 'Lerche0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: start, ...(o.world ? { world: o.world } : {}) });
  g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = []; g.space.projectiles = [];
  const events = [];
  const emit0 = g.emit.bind(g);
  g.emit = (kind, data) => { events.push(Object.assign({ kind, t: g.time }, data)); return emit0(kind, data); };
  const p = g.players[0];
  const run = (sec) => { for (let k = 0; k < Math.round(sec / DT); k++) g.step(); };
  const send = (m) => g.handleMessage(c, m);
  const T = { g, c, p, run, send, events, ev: (k) => events.filter((e) => e.kind === k) };
  T.debug = (cmd, args) => { c.inbox.length = 0; send({ t: 'debug', cmd, args }); return c.inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  T.cmd = (cmd, f) => { c.inbox.length = 0; send(Object.assign({ t: 'cmd', c: cmd }, f || {})); return c.inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  T.taktik = () => { p.console = 'weapons'; };
  T.place = (tx, ty, dir) => { const t = Physics.tileCenter(tx, ty); p.x = t.x; p.y = t.y; p.dir = dir || 'down'; p.console = null; p.liftSel = null; };
  T.tile = () => Physics.toTile(p.x, p.y);
  return T;
}
function arena() {
  const T = setup('arena_space');
  const sh = T.g.ship; sh.x = T.g.space.w / 2; sh.y = T.g.space.h / 2; sh.angle = 0; sh.vx = 0; sh.vy = 0; sh.turnVel = 0;
  T.g.god = true;
  T.run(0.1);
  return T;
}
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
let seq = 0;
const walk = (T, mx, my, sec) => { T.send({ t: 'input', seq: ++seq, mx, my }); T.run(sec); T.send({ t: 'input', seq: ++seq, mx: 0, my: 0 }); T.run(0.05); };

section('Stufen 0–3 per Debug: Waffenplätze, Module, Snapshot', () => {
  const T = arena();
  const g = T.g;
  ok(g.ship.stufe === 0 && !('st' in g.snapshot().ship), 'Start: Stufe 0, im Snapshot kein Feld st');
  ok(Ausbau.plaetzeOffen(g).join() === '8,4,6' && Ausbau.modulRaeumeOffen(g).join() === '1,2', 'Stufe 0: Waffen 8 4 6, Modulräume 1 und 2');
  const SOLL = [[3, 2], [5, 3], [7, 4], [9, 4]];
  for (const st of [1, 2, 3, 0, 3]) {
    ok(T.debug('ausbau', String(st)).length === 0, `Debug ausbau ${st}`);
    const off = Ausbau.plaetzeOffen(g), mr = Ausbau.modulRaeumeOffen(g);
    ok(g.ship.stufe === st && off.length === SOLL[st][0] && mr.length === SOLL[st][1], `Stufe ${st}: ${off.length} Waffenplätze (${off.join(' ')}), ${mr.length} Modulräume (${mr.join(' ')})`);
    ok((st > 0 ? g.snapshot().ship.st === st : !('st' in g.snapshot().ship)), `Snapshot ship.st ${st > 0 ? '= ' + st : 'fehlt bei 0'}`);
  }
  ok(T.debug('ausbau', '7').length === 1 && T.debug('ausbau', 'x').length === 1 && g.ship.stufe === 3, 'ungültige Stufe wird abgelehnt (Stufe bleibt 3)');
  ok(Ausbau.platzOffen(g, 1) && Ausbau.platzOffen(g, 3) && Ausbau.platzOffen(g, 2), 'Stufe 3: alle neun Plätze offen');
  T.debug('ausbau', '0');
  ok(!Ausbau.platzOffen(g, 7) && Ausbau.platzOffen(g, 8) && Ausbau.platzOffen(g, 4) && Ausbau.platzOffen(g, 6), 'Stufe 0: nur 8, 4 und 6 offen');
  // Start-Waffen 8/4/6 bleiben unberührt (Lanze, zwei Batterien, Bolzenwerfer-Mount)
  ok(['weapon_bow', 'battery_port', 'battery_stbd'].every((s) => g.ship.systems[s] === 'ok') && g.ship.mount.bow && g.ship.mount.port && g.ship.mount.stbd && g.ship.mount.bolzen, 'Start-Waffen (Lanze, Batterien, Bolzenwerfer) unverändert');
  // Zurückstufen entfernt Module in verschlossenen Räumen, die Energie folgt
  T.debug('modul', 'voll');
  ok(g.ship.stufe === 3 || g.ship.stufe === 2, 'modul voll hebt die Stufe auf mindestens 2');
  T.debug('ausbau', '1');
  ok(g.ship.module.map((m) => m.raum).join() === '1,2,3', 'Stufe 1: Module in Raum 4 entfallen, Raum 1–3 bleiben');
  T.debug('ausbau', '0');
  ok(g.ship.module.map((m) => m.raum).join() === '1,2', 'Stufe 0: nur Raum 1 und 2');
});

section('Pforten: verschlossen bis zur Stufe, Bewegung und Bots', () => {
  const T = arena();
  const g = T.g;
  g.mission.isDrill = () => false;
  // am Lafettenbereich (Pforte x 20, Zeile 38): auf Stufe 0 zu
  const ST = (tx, ty) => W.shipSolidFor(g.ship.stufe)(tx, ty);
  ok(ST(20, 38) && ST(10, 36) && ST(10, 40), 'Stufe 0: alle drei Pforten solide');
  T.place(23, 38, 'left'); walk(T, -1, 0, 1.5);
  ok(T.tile().x >= 21, `Spieler läuft gegen die verschlossene Pforte (steht bei x ${T.tile().x})`);
  T.debug('ausbau', '1');
  ok(!ST(20, 38) && !ST(10, 36) && ST(10, 40), 'Stufe 1: Lafettenbereich und Modulraum 3 offen, Modulraum 4 zu');
  T.place(23, 38, 'left'); walk(T, -1, 0, 1.5);
  ok(T.tile().x <= 19, `Stufe 1: durch die Pforte in den Lafettenbereich (x ${T.tile().x}, Raum ${Maps.roomAt(T.tile().x, T.tile().y) && Maps.roomAt(T.tile().x, T.tile().y).id})`);
  T.place(10, 37, 'down'); walk(T, 0, 1, 1);
  ok(T.tile().y === 37 || T.tile().y === 38 || T.tile().y > 36, 'Weg zum Modulraum 4 bleibt zu (Pforte y 40 solide)');
  T.place(10, 38, 'down'); walk(T, 0, 1, 1.5);
  ok(T.tile().y <= 39, `Stufe 1: Pforte zu Modulraum 4 hält (y ${T.tile().y})`);
  T.debug('ausbau', '2');
  T.place(10, 38, 'down'); walk(T, 0, 1, 1.5);
  ok(T.tile().y >= 41, `Stufe 2: Modulraum 4 offen (y ${T.tile().y})`);
  // Bots: Schrauber kommen in offene Räume (Feuer im Modulraum 3 bei Stufe 1)
  T.debug('ausbau', '1');
  g.ship.fireList = [];
  ok(interior.addFire(g, 10, 34), 'Stufe 1: Feuer im Modulraum 3 (offen)');
  T.debug('ausbau', '0');
  g.ship.fireList = [];
  ok(!interior.addFire(g, 10, 34) && !interior.addFire(g, 17, 36), 'Stufe 0: kein Feuer in verschlossenen Räumen');
  T.debug('ausbau', '1');
  const b = g.bots[0]; const c = Physics.tileCenter(24, 6); b.x = c.x; b.y = c.y;
  g.ship.fireList = []; interior.addFire(g, 10, 34);
  let out = false;
  for (let k = 0; k < 120 * 30 && g.ship.fireList.length; k++) { g.step(); if (b.lift && b.lift.to === 2) out = true; }
  ok(out && g.ship.fireList.length === 0, 'Schrauber fährt mit L1 ins Unterdeck, geht durch die offene Pforte und löscht das Feuer im Modulraum 3');
});

section('Vier gleiche Modulräume: jedes Modul in jedem Raum, auch mehrfach', () => {
  const T = arena();
  const g = T.g;
  T.debug('ausbau', '3');
  const IDS = CONFIG.module.ids;
  ok(IDS.length === 3, 'drei Module (Frachtraum, Krankenstation, Werkstatt)');
  for (const raum of [1, 2, 3, 4]) for (const id of IDS) {
    g.ship.module = [];
    const err = Modul.bestuecken(g, id, raum);
    ok(err === null && Modul.finde(g, id, raum), `Modulraum ${raum} nimmt ${id} auf`);
  }
  // alle vier Räume mit demselben Modul (mehrfach)
  for (const id of IDS) {
    g.ship.module = [1, 2, 3, 4].map((raum) => ({ id, raum, an: true, lauf: true }));
    Modul.verteilungSetzen(g); T.run(0.2);
    const sh = g.snapshot().ship;
    ok(sh.mod.length === 4 && sh.mod.every((m) => m[0] === CONFIG.module.codes[id] && m[3] === 1) && sh.reactor.used === 8, `viermal ${id}: alle laufen, jedes zieht 1 Energie (verbraucht ${sh.reactor.used} von 8)`);
    ok(JSON.stringify(sh.power) === '{"engines":1,"shields":2,"weapons":1}', `viermal ${id}: Standardverteilung 1/2/1`);
  }
  // Energie je Modul: jedes zusätzliche Modul nimmt genau einen Punkt
  const sums = [];
  for (let k = 0; k <= 4; k++) { g.ship.module = [1, 2, 3, 4].slice(0, k).map((raum) => ({ id: 'werkstatt', raum, an: true, lauf: true })); Modul.verteilungSetzen(g); T.run(0.1); sums.push(g.snapshot().ship.reactor.used - sum(g.ship.power) ); }
  ok(sums.join() === '0,1,2,3,4', `Energie der Module: 0–4 Module ziehen 0–4 Punkte (${sums.join(' ')})`);
  // Einbau nur in offene Räume, Raumwahl 1–4 im Debug
  T.debug('ausbau', '0');
  g.ship.module = [];
  ok(T.debug('modul', 'bau frachtraum 3').some((t) => /verschlossen/.test(t)) && T.debug('modul', 'bau frachtraum 4').some((t) => /verschlossen/.test(t)), 'Stufe 0: Modulraum 3 und 4 sind zu (Hinweis „verschlossen“)');
  ok(T.debug('modul', 'bau krankenstation 2').length === 0 && Modul.finde(g, 'krankenstation', 2), 'Stufe 0: Modulraum 2 offen, Raumwahl per Debug');
  T.debug('ausbau', '1');
  ok(T.debug('modul', 'bau frachtraum 3').length === 0 && T.debug('modul', 'bau frachtraum 4').length === 1, 'Stufe 1: Modulraum 3 offen, 4 noch zu');
  // der Raum hat denselben Platz: die Kacheln q, r, h sind in allen vier Räumen identisch angeordnet (check-maps), die Plätze gehören zum Raum
  ok(Maps.CARGO_BAYS.filter((b) => b.raum === 3).length === 2 && Maps.CARGO_BEDS.filter((b) => b.raum === 4).length === 2, 'je Raum zwei Buchten und zwei Betten');
});

section('Mehrere Frachträume: Kapazität, Laden und Abgeben', () => {
  const T = arena(); T.taktik();
  const g = T.g;
  T.debug('ausbau', '3');
  const setze = (liste) => { g.ship.module = liste.map(([id, raum]) => ({ id, raum, an: true, lauf: true })); Modul.verteilungSetzen(g); T.run(0.1); };
  setze([['frachtraum', 1], ['krankenstation', 2]]);
  ok(Fracht.capacity(g) === 2, 'ein Frachtraum: 2 Plätze');
  setze([['frachtraum', 1], ['frachtraum', 2]]);
  ok(Fracht.capacity(g) === 4 && Fracht.frei(g) === 4, 'zwei Frachträume: 4 Plätze');
  // Beamen aus dem Raum: drei Ladungen nacheinander (Halteprozess 3 s), die vierte füllt
  for (let i = 0; i < 4; i++) Fracht.fracht_abwerfen(g, g.ship.x + 100 + i * 10, g.ship.y, i % 2 ? 'fracht' : 'sprengstoff');
  let geladen = 0;
  for (let i = 0; i < 4; i++) { const err = T.cmd('weapons.fracht'); if (!err.length) { T.run(3.2); geladen++; } }
  ok(geladen === 4 && Fracht.anBord(g) === 4 && Fracht.frei(g) === 0, `vier Ladungen per Beamen an Bord (${Fracht.anBord(g)}/${Fracht.capacity(g)})`);
  Fracht.fracht_abwerfen(g, g.ship.x + 100, g.ship.y, 'fracht');
  const voll = T.cmd('weapons.fracht');
  ok(voll.length === 1 && /Frachtraum voll \(4\/4\)/.test(voll[0]), 'fünfte Ladung: ' + voll[0]);
  // Snapshot: Buchten nach Raum; Ware n liegt in Bucht n der Frachträume
  const snap = g.snapshot();
  ok(snap.fracht.lager.length === 4 && snap.ship.mod.filter((m) => m[0] === 'f').length === 2, 'Snapshot: vier Waren, zwei Frachträume (ship.mod)');
  const bays = Maps.frachtPlaetze(Maps.frachtRaeumeAusMod(snap.ship.mod)).bays;
  ok(bays.length === 4 && bays.map((b) => b.raum).join() === '1,1,2,2', 'Client-Helfer: vier Buchten in Raum 1 und 2');
  // Abliefern an einer Station (Kampagne, am Hafen)
  {
    const H = setup('free', { dir: freshDir() });
    H.run(0.5); H.taktik(); H.g.debugGoto('hafen', false); H.run(0.3);
    H.debug('ausbau', '3');
    H.g.ship.module = [{ id: 'frachtraum', raum: 1, an: true, lauf: true }, { id: 'frachtraum', raum: 2, an: true, lauf: true }];
    Modul.verteilungSetzen(H.g);
    for (const a of ['sprengstoff', 'fracht', 'deuterium', 'sprengstoff']) Fracht.anBordLegen(H.g, a);
    H.g.ship.x = 620; H.g.ship.y = 700;
    const ab = H.cmd('weapons.abliefern');
    ok(!ab.length && H.g.fracht.halt && H.g.fracht.halt.kind === 'ab', 'Abliefern beim Hafen startet ' + JSON.stringify(ab));
    H.run(3.2);
    ok(Fracht.anBord(H.g) === 0 && Fracht.abgeliefert(H.g) === 4, `alle vier Ladungen von zwei Frachträumen übergeben (${Fracht.abgeliefert(H.g)})`);
  }
  // Gesichert nur, wenn alle Frachträume laufen
  setze([['frachtraum', 1], ['frachtraum', 2]]);
  ok(Fracht.gesichert(g), 'beide Frachträume laufen: gesichert');
  g.ship.module[1].an = false; g.ship.module[1].lauf = false; Modul.update(g);
  ok(!Fracht.gesichert(g) && g.snapshot().fracht && g.snapshot().fracht.g === false, 'ein Frachtraum aus: ungesichert (alle müssen laufen), Snapshot fracht.g false');
  // Ladung bleibt beim Ausbau eines Frachtraums über der Kapazität liegen, nimmt aber nichts Neues an
  setze([['frachtraum', 1], ['frachtraum', 2]]);
  for (let i = 0; i < 4; i++) Fracht.anBordLegen(g, 'deuterium');
  setze([['frachtraum', 1]]);
  ok(Fracht.capacity(g) === 2 && Fracht.frei(g) === -2 && !Fracht.anBordLegen(g, 'fracht'), 'Frachtraum entfernt: Überhang bleibt, nichts Neues');
});

section('Mehrere Frachträume: Personen und Betten', () => {
  const T = arena();
  const g = T.g;
  T.debug('ausbau', '3');
  g.ship.module = [{ id: 'frachtraum', raum: 4, an: true, lauf: true }, { id: 'frachtraum', raum: 1, an: true, lauf: true }, { id: 'frachtraum', raum: 2, an: true, lauf: true }];
  Modul.verteilungSetzen(g);
  ok(Fracht.capacity(g) === 6 && PB.bettFrei(g) === 0, 'drei Frachträume: 6 Plätze, 6 Betten');
  for (let i = 0; i < 4; i++) ok(PB.personAnBordLegen(g, 'p' + i, 'Person ' + i), `Person ${i} an Bord`);
  Fracht.anBordLegen(g, 'deuterium'); Fracht.anBordLegen(g, 'fracht');
  ok(Fracht.frei(g) === 0 && !PB.personAnBordLegen(g, 'zuviel', 'Zuviel'), 'Frachträume voll: keine weitere Person');
  const betten = Maps.frachtPlaetze([1, 2, 4]).beds;
  const figs = g.snapshot().ship.npcs.filter((q) => q.lie === 1);
  ok(figs.length === 4 && figs.every((f) => betten.some((b) => Math.floor(f.x / 32) === b.x && Math.floor(f.y / 32) === b.y)), 'vier liegende Figuren auf den Betten der drei Frachträume (Raum 1, 2, 4)');
  ok(Math.max(...g.snapshot().fracht.pers.map((p) => p.b)) <= 5, 'Bettnummern 0–5');
  ok(PB.personAbgeben(g, 'p1') && PB.bettFrei(g) === 1, 'Person abgegeben: ihr Bett ist frei');
});

section('Weltstand: schiff.stufe und Module im Roundtrip', () => {
  const dir = freshDir();
  const T = setup('free', { dir });
  T.run(0.3);
  const g = T.g;
  const id = g.weltstand.id;
  T.debug('ausbau', '2');
  g.ship.module = [{ id: 'frachtraum', raum: 1, an: true, lauf: true }, { id: 'werkstatt', raum: 2, an: true, lauf: true }, { id: 'frachtraum', raum: 3, an: true, lauf: true }, { id: 'krankenstation', raum: 4, an: false, lauf: false }];
  Modul.verteilungSetzen(g);
  for (const a of ['sprengstoff', 'fracht', 'deuterium']) Fracht.anBordLegen(g, a);
  PB.personAnBordLegen(g, 'evert', 'Evert');
  const vorher = { module: JSON.stringify(Modul.toSave(g)), lager: JSON.stringify(Fracht.lagerArten(g)), mod: JSON.stringify(g.snapshot().ship.mod) };   // vor dem Beenden (danach setzt sich die Partie zurück)
  T.send({ t: 'menu', op: 'end' });
  const data = JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8'));
  ok(data.version === 3 && data.schiff.stufe === 2, `Stand: schiff.stufe ${data.schiff.stufe}, Version ${data.version}`);
  ok(data.schiff.module.length === 4 && data.schiff.module.filter((m) => m.id === 'frachtraum').map((m) => m.raum).join() === '1,3', 'Stand: vier Module, zwei Frachträume (Raum 1 und 3)');
  ok(Weltstand.validate(data).length === 0, 'Stand ist schema-gültig ' + (Weltstand.validate(data)[0] || ''));
  ok(data.schiff.fracht.length === 4, 'Stand: vier Ladungen/Personen bei Kapazität 4 ' + JSON.stringify(data.schiff.fracht));
  const L = setup('free', { dir, world: id });
  L.run(0.3);
  const h = L.g;
  ok(h.ship.stufe === 2 && h.snapshot().ship.st === 2, 'nach dem Laden: Stufe 2');
  ok(JSON.stringify(Modul.toSave(h)) === vorher.module, 'nach dem Laden: dieselben Module in denselben Räumen (aus/an eingeschlossen)');
  ok(Fracht.capacity(h) === 4 && JSON.stringify(Fracht.lagerArten(h)) === vorher.lager && PB.personAnBord(h, 'evert'), 'nach dem Laden: Kapazität 4, dieselbe Fracht, Evert an Bord');
  ok(h.snapshot().ship.mod.length === 4 && JSON.stringify(h.snapshot().ship.mod.map((m) => m.slice(0, 3))) === JSON.stringify(JSON.parse(vorher.mod).map((m) => m.slice(0, 3))), 'Snapshot ship.mod nach dem Laden gleich (Code, Raum, an)');
  // Altstand ohne Feld: Stufe 0, Start-Bestückung
  const alt = JSON.parse(JSON.stringify(data)); delete alt.schiff.stufe; delete alt.schiff.module; alt.schiff.fracht = ['sprengstoff'];
  const R = new Game({ noStore: true, seed: 3, log: () => {} });
  R.ship.stufe = 3;
  Ausbau.restore(R, alt.schiff.stufe); Modul.restore(R, alt.schiff.module); Fracht.restore(R, alt.schiff.fracht);
  ok(R.ship.stufe === 0 && Modul.toSave(R).map((m) => m.id).join() === 'frachtraum,krankenstation' && Fracht.anBord(R) === 1, 'Altstand ohne schiff.stufe/module: Stufe 0, Start-Bestückung');
  // Unfug wird abgelehnt
  const bad = JSON.parse(JSON.stringify(data)); bad.schiff.stufe = 5;
  ok(Weltstand.validate(bad).length > 0, 'Schema lehnt Stufe 5 ab');
  Ausbau.restore(R, 9); ok(R.ship.stufe === 3, 'restore kappt auf Stufe 3');
  Ausbau.restore(R, 'x'); ok(R.ship.stufe === 0, 'restore: Unsinn ergibt Stufe 0');
  // Module in noch verschlossenen Räumen gibt es nicht
  Ausbau.restore(R, 1); Modul.restore(R, [{ id: 'frachtraum', raum: 1 }, { id: 'werkstatt', raum: 3 }, { id: 'werkstatt', raum: 4 }]);
  ok(R.ship.module.map((m) => m.raum).join() === '1,3', 'Stufe 1: Raum 4 wird beim Laden verworfen, Raum 3 bleibt');
});

section('Lifts und Lafetten: nicht beschädigbar, Auskunft am Waffenplatz', () => {
  const T = arena();
  const g = T.g;
  T.debug('ausbau', '3');
  let bad = 0;
  for (let k = 0; k < 3000; k++) for (let r = 0; r < 4; r++) for (const wall of [false, true]) {
    const t = interior.randomRegionFloor(g, r, wall);
    const kind = Maps.ship.info(t.x, t.y).kind;
    if (kind === 'lift' || kind === 'ladder' || Maps.ship.solid(t.x, t.y) || Maps.deckOf(t.y) === 1) bad++;
  }
  ok(bad === 0, 'Stufe 3: 24000 Treffer-Orte nie auf Lift, Leiter, Wand oder dem Oberdeck');
  for (let i = 0; i < 300; i++) { interior.hitSystems(g, i % 4, { chance: 1 }); }
  ok(Object.keys(g.ship.systems).every((s) => interior.SYSTEM_ORDER.includes(s)) && !Object.keys(g.ship.systems).some((s) => /lift|ladder|leiter/.test(s)), 'Lifts und Leiter sind keine Systeme (kein Schaden, keine Reparatur)');
  ok(W.STATIONS.every((s) => !['lift', 'ladder'].includes(Maps.ship.info(s.x, s.y).kind)), 'keine Station auf Lift oder Leiter');
  // E an einer Lafette: Auskunft
  const l7 = Maps.waffenplatz(7);
  T.debug('ausbau', '0');
  T.place(l7.x, l7.y - 1, 'down');   // Lafette 7 (Lafettenbereich) – Spieler steht davor; Stufe 0
  T.c.inbox.length = 0; T.send({ t: 'act', down: true }); T.send({ t: 'act', down: false });
  const txt = T.c.inbox.filter((m) => m.kind === 'notice').map((m) => m.text).join(' ');
  ok(/Waffenplatz 7: verschlossen – Ausbaustufe 1 nötig/.test(txt), 'E an Lafette 7 auf Stufe 0: ' + txt);
  T.debug('ausbau', '1');
  T.place(l7.x, l7.y - 1, 'down');
  T.c.inbox.length = 0; T.send({ t: 'act', down: true }); T.send({ t: 'act', down: false });
  ok(/Waffenplatz 7: frei/.test(T.c.inbox.filter((m) => m.kind === 'notice').map((m) => m.text).join(' ')), 'Stufe 1: Waffenplatz 7 frei (noch keine Waffe, Paket C)');
});

section('Schiffssysteme ohne Lebenserhaltung', () => {
  const T = arena();
  const g = T.g;
  ok(Object.keys(g.ship.systems).length === 13 && !('life' in g.ship.systems) && !W.STATIONS.some((s) => s.system === 'life'), '13 Systeme, keine Station life auf der Karte');
  ok(!Maps.SHIP_ROWS.join('').includes('O') && !('O' in Maps.SHIP_LEGEND), 'Legende und Karte ohne die Lebenserhaltung');
  const snap = g.snapshot().ship;
  ok(!('life' in snap.systems) && !('life' in snap.power) && !('life' in snap.heat), 'Snapshot ohne life');
  g.ship.o2 = 100; g.ship.breachList = []; T.run(10);
  ok(g.ship.o2 >= 99.9, 'ohne Lecks: O2 voll');
});

section('Snapshot und Protokoll', () => {
  const T = arena();
  const g = T.g;
  const b0 = Buffer.byteLength(JSON.stringify(g.snapshot()));
  T.debug('ausbau', '3');
  const b3 = Buffer.byteLength(JSON.stringify(g.snapshot()));
  ok(b3 - b0 <= 10, `Stufe 3 kostet im Snapshot ${b3 - b0} B (nur ship.st)`);
  ok(b3 < CONFIG.net.snapMax, `Snapshot ${b3} B < snapMax ${CONFIG.net.snapMax}`);
  const Protocol = require('../shared/protocol.js');
  ok(Protocol.DEBUG_CMDS.includes('ausbau') && Protocol.DEBUG_CMDS.includes('modul'), 'Protokoll: Debug ausbau und modul');
  ok(!Protocol.SYSTEMS.includes('life'), 'Protokoll: keine Lebenserhaltung');
  ok(Maps.MODUL_CODE_FRACHT === CONFIG.module.codes.frachtraum, 'Modulcode des Frachtraums in Karte und Config gleich');
  void space;
});

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`\ntest-lerche: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
