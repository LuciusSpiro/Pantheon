'use strict';
// EK3 Teil A (CONTRACT-EK3): Lagerraum (Frachtraum), Ladung, Beamen, Weltstand.
//   Grundriss (Deck II: Frachtraum ersetzt Bad und Aussicht), Frachtbuchten, Kollision/Wege,
//   Beamen mit und ohne Systemtreffer (Schildtreffer bricht nicht ab), Reichweite, Taktik verlassen, Transfer ausgefallen,
//   Frachtraum voll (dritte Ladung abgelehnt), Systemwechsel (Fracht im Raum verfällt), Abliefern (Abnehmer / jede Station),
//   Speichern/Laden mit Fracht, Snapshot kompakt, Bausteine, Schnittstelle gesichert/ungesichert (AP9), Frachtraum ist kein Schiffssystem.
//   node tools/test-lager.js            -> alle Abschnitte
//   node tools/test-lager.js beamen     -> nur Abschnitte, deren Name einen der Begriffe enthält
const fs = require('fs');
const os = require('os');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Maps = require('../shared/maps.js');
const Weltstand = require('../server/weltstand.js');
const { Game } = require('../server/game.js');
const Fracht = require('../server/sim/fracht.js');
const interior = require('../server/sim/interior.js');
const damage = require('../server/sim/damage.js');
const Registry = require('../server/mission/registry.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const info = (t) => console.log('  info ' + t);

function section(name, body) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-lager-'));
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
  g.handleMessage(c, { t: 'hello', clientId: 'L0', name: 'Lager0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: start, ...(o.world ? { world: o.world } : {}) });
  g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = []; g.space.projectiles = [];
  const events = [];
  const emit0 = g.emit.bind(g);
  g.emit = (kind, data) => { events.push(Object.assign({ kind, t: g.time }, data)); return emit0(kind, data); };
  const mev = [];
  const me0 = g.missionEvent.bind(g);
  g.missionEvent = (kind, data) => { mev.push(Object.assign({ kind }, data)); return me0(kind, data); };
  const p = g.players[0];
  const run = (sec, each) => { for (let k = 0; k < Math.round(sec / DT); k++) { if (each && each(k * DT) === true) return true; g.step(); } return false; };
  const send = (m) => g.handleMessage(c, m);
  const T = { g, c, p, run, send, events, mev, ev: (k) => events.filter((e) => e.kind === k), me: (k) => mev.filter((e) => e.kind === k) };
  T.taktik = () => { p.console = 'weapons'; };
  T.cmd = (cmd, f) => { c.inbox.length = 0; send(Object.assign({ t: 'cmd', c: cmd }, f || {})); return c.inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  return T;
}
function arena() {
  const T = setup('arena_space');
  const sh = T.g.ship; sh.x = T.g.space.w / 2; sh.y = T.g.space.h / 2; sh.angle = 0; sh.vx = 0; sh.vy = 0; sh.turnVel = 0;
  T.g.god = true;
  T.run(0.1);
  return T;
}
const pod = (T, dx, art) => Fracht.fracht_abwerfen(T.g, T.g.ship.x + (dx == null ? 150 : dx), T.g.ship.y, art || 'sprengstoff');

section('Grundriss: Frachtbuchten in den Modulräumen (PAN-01 B: kein fester Frachtraum mehr)', () => {
  const ids = Maps.SHIP_ROOMS.map((r) => r.id);
  ok(!ids.includes('bad') && !ids.includes('aussicht') && !ids.includes('frachtraum') && ['modul1', 'modul2', 'modul3', 'modul4'].every((id) => ids.includes(id)), 'Räume bad, aussicht und frachtraum entfallen, vier Modulräume neu (' + ids.length + ' Räume)');
  const m1 = Maps.SHIP_ROOMS.find((r) => r.id === 'modul1');
  ok(m1.deck === 2 && m1.kind === 'modul' && m1.modul === 1 && m1.x0 === 21 && m1.x1 === 27 && m1.y0 === 33 && m1.y1 === 35, 'Modulraum 1 auf dem Unterdeck, 21–27 × 33–35');
  ok(Maps.CARGO_BAYS.length === 8 && Maps.CARGO_PER_RAUM === 2, 'acht Frachtbuchten (zwei je Modulraum), Kapazität 2 je Frachtraum');
  for (const b of Maps.CARGO_BAYS) {
    ok(Maps.ship.at(b.x, b.y) === 'q' && Maps.ship.info(b.x, b.y).kind === 'mod_a' && Maps.ship.solid(b.x, b.y), `Bucht ${b.id} (${b.x},${b.y}): Modulplatz A, solide (Kollision)`);
    ok(Maps.ship.at(b.access.x, b.access.y) === '.' && !Maps.ship.solid(b.access.x, b.access.y), `Bucht ${b.id}: Zugangskachel begehbar`);
    ok(Maps.roomAt(b.x, b.y) && Maps.roomAt(b.x, b.y).modul === b.raum, `Bucht ${b.id} liegt in Modulraum ${b.raum}`);
  }
  ok(Maps.cargoBayAt(22, 33) && !Maps.cargoBayAt(23, 33), 'cargoBayAt');
  // keine alten Kacheln mehr
  const rows = Maps.SHIP_ROWS.join('');
  ok(!rows.includes('%') && !rows.includes('g') && !rows.includes('l'), 'Frachtbucht g, Frachtbett l und Panoramafenster (%) stehen nicht mehr auf der Karte');
  // Wege: jede begehbare Kachel auf dem Oberdeck ist von der Liftplattform aus erreichbar (BFS, 4er-Nachbarschaft, Türen begehbar)
  const seen = new Set(); const q = [[28, 22]];
  seen.add('28,22');
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; const k = nx + ',' + ny;
      if (seen.has(k) || ny < 16 || ny > 28 || nx < 0 || nx > 39 || Maps.ship.solid(nx, ny)) continue;
      seen.add(k); q.push([nx, ny]);
    }
  }
  let unreachable = 0;
  for (let y = 16; y <= 28; y++) for (let x = 0; x <= 39; x++) if (!Maps.ship.solid(x, y) && !seen.has(x + ',' + y)) unreachable++;
  ok(unreachable === 0, `Oberdeck: alle begehbaren Kacheln vom Lift aus erreichbar (${unreachable} unerreichbar)`);
  for (const s of Maps.IVO_SPOTS) ok(!Maps.ship.solid(s.x, s.y) && seen.has(s.x + ',' + s.y), `Ivo-Platz (${s.x},${s.y}) begehbar und erreichbar`);
  // Raumzuordnung: jede begehbare Kachel auf dem Oberdeck liegt in einem Raum
  let noRoom = 0;
  for (let y = 16; y <= 28; y++) for (let x = 0; x <= 39; x++) if (!Maps.ship.solid(x, y) && !Maps.roomAt(x, y)) noRoom++;
  ok(noRoom === 0, 'Oberdeck: jede begehbare Kachel gehört zu einem Raum');
  // Reparatur/Regale: das Oberdeck hat keine Stationen, keine Regale; Regale liegen unverändert auf dem Mitteldeck
  ok(Maps.SHELF_TILES.every((s) => s.y < 13) && Maps.SHIP_ROOMS.filter((r) => r.deck === 1).every((r) => r.sector === -1), 'Regale nur auf dem Mitteldeck; das Oberdeck ohne Sektor (nicht betroffen)');
  const sys = Object.keys(Maps.SHIP_LEGEND).filter((ch) => Maps.SHIP_LEGEND[ch].system);
  let onDeck2 = 0;
  for (let y = 16; y <= 28; y++) for (const ch of Maps.SHIP_ROWS[y]) if (sys.includes(ch)) onDeck2++;
  ok(onDeck2 === 0, 'keine Station auf dem Oberdeck');
  ok(Maps.hazardAllowed(22, 34, 3) && !Maps.hazardAllowed(22, 19, 3), 'in den Modulräumen kann es brennen (Unterdeck), auf dem Oberdeck nie');
});

section('Frachträume: Kapazität folgt den Modulen (2 je Frachtraum, auch mehrfach)', () => {
  const T = arena();
  const Modul = require('../server/sim/module.js');
  const Ausbau = require('../server/sim/ausbau.js');
  const cap = () => Fracht.capacity(T.g);
  ok(cap() === 2 && Modul.frachtRaeume(T.g).join() === '1', 'Start-Lerche: ein Frachtraum (Raum 1), Kapazität 2');
  Ausbau.setStufe(T.g, 3);
  T.g.ship.module = [{ id: 'frachtraum', raum: 1, an: true, lauf: true }, { id: 'frachtraum', raum: 2, an: true, lauf: true }, { id: 'frachtraum', raum: 4, an: true, lauf: true }];
  Modul.verteilungSetzen(T.g);
  ok(cap() === 6 && Fracht.frei(T.g) === 6, 'drei Frachträume: Kapazität 6');
  for (let i = 0; i < 6; i++) ok(Fracht.anBordLegen(T.g, 'deuterium'), `Ware ${i + 1} von 6 an Bord`);
  ok(!Fracht.anBordLegen(T.g, 'deuterium') && Fracht.frei(T.g) === 0, 'siebte Ware abgelehnt (voll)');
  const err = Fracht.beamStart(T.g, T.p, null);
  ok(/voll/.test(err), 'Beamen bei vollem Frachtraum: ' + err);
  Fracht.debug(T.g, ['leer']);
  T.g.ship.module = [{ id: 'krankenstation', raum: 1, an: true, lauf: true }, { id: 'werkstatt', raum: 2, an: true, lauf: true }];
  ok(cap() === 0 && Fracht.frei(T.g) === 0 && !Fracht.anBordLegen(T.g, 'fracht'), 'ohne Frachtraum: Kapazität 0, keine Ladung');
});

section('Frachtraum ist kein Schiffssystem (keine Energie, keine Treffer-Wirkung)', () => {
  const T = arena();
  ok(!('fracht' in T.g.ship.systems) && !('lager' in T.g.ship.systems) && !interior.SYSTEM_ORDER.some((k) => /fracht|lager|cargo/.test(k)), 'kein Eintrag in ship.systems / SYSTEM_ORDER');
  ok(!('fracht' in T.g.ship.power) && !(CONFIG.power && /fracht|cargo/.test(JSON.stringify(Object.keys(CONFIG.power || {})))), 'keine Energie');
  const before = JSON.stringify(T.g.ship.systems);
  Fracht.anBordLegen(T.g, 'sprengstoff');
  ok(JSON.stringify(T.g.ship.systems) === before, 'Ladung ändert keine Systemzustände');
});

section('Beamen ohne Systemtreffer', () => {
  const T = arena(); T.taktik();
  const pd = pod(T, 150);
  ok(!!pd && pd.art === 'sprengstoff' && T.g.snapshot().fracht.draussen.length === 1, 'Fracht im Raum angelegt, im Snapshot');
  const err = T.cmd('weapons.fracht');
  ok(!err.length && T.g.fracht.halt && T.g.fracht.halt.kind === 'an', 'weapons.fracht startet den Halteprozess ' + JSON.stringify(err));
  T.run(1.5);
  const hp = T.g.snapshot().fracht.halt;
  ok(hp && hp.kind === 'an' && hp.p > 0.4 && hp.p < 0.6, `Haltefortschritt im Snapshot nach 1,5 s: ${hp && hp.p}`);
  T.run(1.2);
  ok(Fracht.anBord(T.g) === 0 && T.g.fracht.halt, 'nach 2,7 s noch nicht an Bord (3 s Halteprozess)');
  T.run(0.5);
  ok(Fracht.anBord(T.g, 'sprengstoff') === 1 && !T.g.fracht.halt, 'nach 3 s an Bord');
  ok(Fracht.draussen(T.g).length === 0, 'Fracht im Raum entfernt');
  ok(T.ev('frachtBeamen').some((e) => e.phase === 'fertig') && T.me('frachtAnBord').length === 1 && T.me('frachtAnBord')[0].art === 'sprengstoff', 'Ereignisse frachtBeamen fertig und missionEvent frachtAnBord');
  const s = T.g.snapshot();
  ok(JSON.stringify(s.fracht.lager) === '["sprengstoff"]', 'Snapshot fracht.lager');
});

section('Beamen: Dauer bei beschädigtem Transfer', () => {
  const T = arena(); T.taktik();
  T.g.ship.systems.transfer = 'damaged';
  pod(T, 100);
  T.cmd('weapons.fracht');
  ok(T.g.fracht.halt && T.g.fracht.halt.dur === CONFIG.ship.beamTimeDamaged, `Haltezeit ${T.g.fracht.halt && T.g.fracht.halt.dur} s (beschädigt)`);
});

section('Beamen mit Systemtreffer (bricht ab) und Schildtreffer (bricht nicht ab)', () => {
  // Systemtreffer
  const T = arena(); T.taktik();
  pod(T, 150);
  T.cmd('weapons.fracht');
  T.run(1.5);
  interior.damageSystem(T.g, 'engines', 'damaged');
  ok(!T.g.fracht.halt && Fracht.anBord(T.g) === 0 && Fracht.draussen(T.g).length === 1, 'Systemtreffer bricht ab: nichts an Bord, Fracht bleibt liegen');
  ok(T.ev('frachtBeamen').some((e) => e.phase === 'abbruch' && e.grund === 'systemtreffer'), 'Ereignis Abbruch (systemtreffer)');
  T.run(3.5);
  ok(Fracht.anBord(T.g) === 0, 'der abgebrochene Vorgang läuft nicht weiter');
  T.cmd('weapons.fracht');
  T.run(3.1);
  ok(Fracht.anBord(T.g) === 1, 'Neustart nach dem Abbruch gelingt (volle 3 s)');
  // Schildtreffer
  const S = arena(); S.taktik();
  pod(S, 150);
  S.cmd('weapons.fracht');
  S.run(1.0);
  S.g.ship.shields.current = [4, 4, 4, 4];
  S.g.rng.chance = () => false;   // kein Durchlass-Wurf: reiner Schildtreffer
  const r = damage.resolveHit(S.g, 0, 1);
  ok(r.absorbed > 0 && r.systems.length === 0 && r.rest === 0, 'Schildtreffer vom Schild gefangen, kein System getroffen');
  ok(!!S.g.fracht.halt, 'Schildtreffer bricht nicht ab');
  S.run(2.2);
  ok(Fracht.anBord(S.g) === 1, 'Beamen nach Schildtreffer fertig');
  // Treffer, der ein System erwischt (Durchlass), bricht ab
  const D = arena(); D.taktik();
  pod(D, 150);
  D.cmd('weapons.fracht'); D.run(0.5);
  D.g.ship.shields.current = [0, 0, 0, 0];
  D.g.rng.chance = () => true;
  const r2 = damage.resolveHit(D.g, 0, 1);
  ok(r2.systems.length > 0 && !D.g.fracht.halt, `Hüllentreffer mit Systemschaden (${r2.systems.map((x) => x.system).join(',')}) bricht ab`);
});

section('Beamen: weitere Abbruchgründe und Ablehnungen', () => {
  let T = arena(); T.taktik();
  pod(T, 600);
  let err = T.cmd('weapons.fracht');
  ok(err.length === 1 && /Reichweite/.test(err[0]) && !T.g.fracht.halt, 'außer Reichweite (600 > 320) abgelehnt: ' + err[0]);
  T = arena(); T.taktik();
  err = T.cmd('weapons.fracht');
  ok(err.length === 1 && /Keine Fracht/.test(err[0]), 'ohne Fracht abgelehnt: ' + err[0]);
  T = arena(); T.taktik();
  pod(T, 250);
  T.cmd('weapons.fracht'); T.run(1);
  T.g.ship.x -= 200;   // Lerche treibt weg (450 > 320)
  T.run(0.1);
  ok(!T.g.fracht.halt && T.ev('frachtBeamen').some((e) => e.grund === 'reichweite'), 'außer Reichweite während des Haltens: Abbruch');
  T = arena(); T.taktik();
  pod(T, 100);
  T.cmd('weapons.fracht'); T.run(1);
  T.p.console = null;
  T.run(0.1);
  ok(!T.g.fracht.halt && T.ev('frachtBeamen').some((e) => e.grund === 'taktik'), 'Taktik verlassen: Abbruch');
  T = arena();
  pod(T, 100);
  err = T.cmd('weapons.fracht');
  ok(err.length === 1 && /Konsole/.test(err[0]), 'nur an der Taktik-Konsole: ' + err[0]);
  T = arena(); T.taktik();
  T.g.ship.systems.transfer = 'broken';
  pod(T, 100);
  err = T.cmd('weapons.fracht');
  ok(err.length === 1 && /Transfer/.test(err[0]), 'Transfer zerstört: abgelehnt: ' + err[0]);
  T.g.ship.systems.transfer = 'ok';
  T.cmd('weapons.fracht'); T.run(1);
  interior.setOffline(T.g, 'transfer', 5);
  T.run(0.1);
  ok(!T.g.fracht.halt && T.ev('frachtBeamen').some((e) => e.grund === 'transfer'), 'Transfer fällt aus (EMP): Abbruch');
  T = arena(); T.taktik();
  pod(T, 100);
  T.cmd('weapons.fracht'); T.run(0.5);
  err = T.cmd('weapons.fracht');
  ok(err.length === 1 && /läuft bereits/.test(err[0]), 'zweiter Start während des Haltens abgelehnt');
  T.cmd('weapons.fracht', { off: true });
  ok(!T.g.fracht.halt, 'weapons.fracht off bricht ab');
  // Schilde bleiben oben (Halteprozess belegt ship.beaming nicht)
  T = arena(); T.taktik();
  pod(T, 100); T.cmd('weapons.fracht');
  ok(!T.g.ship.beaming && !T.g.transfer.isBeaming(T.g), 'Fracht-Beamen senkt die Schilde nicht (kein ship.beaming)');
});

section('Frachtraum voll: dritte Ladung wird abgelehnt', () => {
  const T = arena(); T.taktik();
  pod(T, 100); pod(T, 140); pod(T, 180);
  T.cmd('weapons.fracht'); T.run(3.1);
  T.cmd('weapons.fracht'); T.run(3.1);
  ok(Fracht.anBord(T.g) === 2 && Fracht.frei(T.g) === 0, 'zwei Ladungen an Bord (2/2)');
  ok(JSON.stringify(T.g.snapshot().fracht.lager) === '["sprengstoff","sprengstoff"]', 'Snapshot: zwei Ladungen');
  const err = T.cmd('weapons.fracht');
  ok(err.length === 1 && /voll \(2\/2\)/.test(err[0]) && !T.g.fracht.halt, 'dritte abgelehnt: ' + err[0]);
  ok(Fracht.draussen(T.g).length === 1, 'dritte Fracht bleibt draußen liegen');
  ok(!Fracht.anBordLegen(T.g, 'sprengstoff'), 'auch direktes Ablegen (Skript) lehnt ab');
  // mischen: zweite Art
  const U = arena(); U.taktik();
  pod(U, 100, 'fracht'); pod(U, 140, 'sprengstoff');
  U.cmd('weapons.fracht', { id: Fracht.draussen(U.g)[1].id }); U.run(3.1);
  ok(JSON.stringify(Fracht.lagerArten(U.g)) === '["sprengstoff"]' && Fracht.draussen(U.g).length === 1, 'gezielt per id: die gewählte Fracht kommt an Bord');
});

section('Fracht im Raum: bleibt bis zum Systemwechsel', () => {
  const T = setup('free', { dir: freshDir() });
  T.run(0.5);
  T.g.debugGoto('splitter', false);
  T.run(0.3);
  const sh = T.g.ship;
  const pd = Fracht.fracht_abwerfen(T.g, sh.x + 100, sh.y, 'sprengstoff');
  ok(!!pd && Fracht.draussen(T.g).length === 1, 'abgeworfen im Splittergürtel');
  T.run(60);
  ok(Fracht.draussen(T.g).length === 1, 'liegt nach 60 s noch dort (kein Verfall)');
  Fracht.anBordLegen(T.g, 'fracht');
  T.g.debugGoto('b7', false);
  T.run(0.3);
  ok(Fracht.draussen(T.g).length === 0 && T.g.fracht.draussen.length === 0, 'nach Systemwechsel weg');
  ok(Fracht.anBord(T.g) === 1, 'mitgeführte Ladung bleibt an Bord');
  T.g.debugGoto('splitter', false); T.run(0.3);
  ok(Fracht.draussen(T.g).length === 0, 'zurück im alten System: die Fracht kommt nicht wieder');
  ok(Fracht.fracht_abwerfen(T.g, 1, 1, 'unsinn') === null && Fracht.fracht_abwerfen(T.g, NaN, 1, 'fracht') === null, 'unbekannte Art / ungültige Position: abgelehnt');
  for (let i = 0; i < 9; i++) Fracht.fracht_abwerfen(T.g, sh.x + i * 5, sh.y, 'fracht');
  ok(Fracht.draussen(T.g).length === CONFIG.fracht.maxDraussen, `höchstens ${CONFIG.fracht.maxDraussen} Ladungen je Szene`);
});

section('Abliefern: Abnehmer und jede Station', () => {
  const T = setup('free', { dir: freshDir() });
  T.run(0.5);
  T.taktik();
  T.g.debugGoto('hafen', false); T.run(0.3);
  const sh = T.g.ship;
  let err = T.cmd('weapons.abliefern');
  ok(err.length === 1 && /Keine Fracht/.test(err[0]), 'ohne Ladung: ' + err[0]);
  Fracht.anBordLegen(T.g, 'sprengstoff'); Fracht.anBordLegen(T.g, 'sprengstoff');
  sh.x = 520 + 100; sh.y = 700;
  err = T.cmd('weapons.abliefern');
  ok(!err.length && T.g.fracht.halt && T.g.fracht.halt.kind === 'ab', 'beim Hafen (Station, jede Station gilt ohne Abnehmer): Halteprozess ' + JSON.stringify(err));
  ok(T.g.snapshot().fracht.ab === 1, 'Snapshot: ab = 1');
  T.run(3.1);
  ok(Fracht.anBord(T.g) === 0 && Fracht.abgeliefert(T.g, 'sprengstoff') === 2, 'nach 3 s übergeben (2 Ladungen)');
  ok(T.me('frachtAbgeliefert').length === 1 && T.me('frachtAbgeliefert')[0].n === 2 && T.me('frachtAbgeliefert')[0].ort === 'hafen', 'missionEvent frachtAbgeliefert');
  // Systemtreffer beim Abliefern bricht ab
  Fracht.anBordLegen(T.g, 'fracht');
  T.cmd('weapons.abliefern'); T.run(1);
  interior.damageSystem(T.g, 'thruster_port', 'damaged');
  ok(!T.g.fracht.halt && Fracht.anBord(T.g) === 1, 'Systemtreffer beim Abliefern: abgebrochen, Ladung bleibt an Bord');
  // zu weit von der Station
  sh.x = 1500; sh.y = 700;
  err = T.cmd('weapons.abliefern');
  ok(err.length === 1 && /Zu weit/.test(err[0]), 'zu weit weg: ' + err[0]);
  // anderer Ort ohne Station
  T.g.debugGoto('splitter', false); T.run(0.3);
  err = T.cmd('weapons.abliefern');
  ok(err.length === 1 && /keine Station/.test(err[0]), 'ohne Station: ' + err[0]);
  // Abnehmer festgelegt: nur dort
  T.g.debugGoto('vaelen', false); T.run(0.3);
  T.g.ship.x = 1300 - 100; T.g.ship.y = 760;
  Fracht.setAbnehmer(T.g, 'hafen', 'Tesk');
  err = T.cmd('weapons.abliefern');
  ok(err.length === 1 && /Tesk/.test(err[0]), 'Station, aber nicht der Abnehmer: ' + err[0]);
  Fracht.setAbnehmer(T.g, null);
  err = T.cmd('weapons.abliefern');
  ok(!err.length && T.g.fracht.halt, 'ohne Abnehmer nimmt auch die Karawane (Station) an');
  T.cmd('weapons.fracht', { off: true });
  Fracht.setAbnehmer(T.g, 'vaelen', 'Meister Orun');
  ok(T.g.snapshot().fracht.abn === 'Meister Orun', 'Snapshot: abn = Name des Abnehmers');
  T.cmd('weapons.abliefern'); T.run(3.1);
  ok(Fracht.anBord(T.g) === 0 && Fracht.abgeliefert(T.g) === 3, 'beim Abnehmer übergeben');
});

section('Weltstand: Speichern und Laden mit Fracht', () => {
  const dir = freshDir();
  const T = setup('free', { dir });
  T.run(0.3);
  const id = T.g.weltstand.id;
  Fracht.anBordLegen(T.g, 'sprengstoff'); Fracht.anBordLegen(T.g, 'fracht');
  T.g.fracht.draussen.push({ id: 'frX', x: 5, y: 5, art: 'fracht', szene: T.g.ship.scene });   // Laufzeit: darf nicht gespeichert werden
  T.send({ t: 'menu', op: 'end' });
  const file = path.join(dir, id + '.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  ok(JSON.stringify(data.schiff.fracht) === '["sprengstoff","fracht"]', 'Stand enthält schiff.fracht ' + JSON.stringify(data.schiff.fracht));
  ok(Weltstand.validate(data).length === 0, 'Stand ist schema-gültig ' + (Weltstand.validate(data)[0] || ''));
  ok(!JSON.stringify(data).includes('frX'), 'Fracht im Raum steht nicht im Stand');
  const L = setup('free', { dir, world: id });
  L.run(0.3);
  ok(JSON.stringify(Fracht.lagerArten(L.g)) === '["sprengstoff","fracht"]', 'nach dem Laden: beide Ladungen an Bord ' + JSON.stringify(Fracht.lagerArten(L.g)));
  ok(L.g.snapshot().fracht.lager.length === 2 && Fracht.draussen(L.g).length === 0, 'Snapshot nach dem Laden');
  ok(Fracht.frei(L.g) === 0, 'Frachtraum nach dem Laden voll');
  // ohne Fracht: kein Feld
  const dir2 = freshDir();
  const E = setup('free', { dir: dir2 });
  E.run(0.3);
  const id2 = E.g.weltstand.id;
  E.send({ t: 'menu', op: 'end' });
  const d2 = JSON.parse(fs.readFileSync(path.join(dir2, id2 + '.json'), 'utf8'));
  ok(!('fracht' in d2.schiff), 'ohne Ladung kein Feld schiff.fracht (alte Stände bleiben gleich)');
  const L2 = setup('free', { dir: dir2, world: id2 });
  L2.run(0.2);
  ok(Fracht.anBord(L2.g) === 0, 'Altstand ohne Feld lädt mit leerem Frachtraum');
  // Schema lehnt Unfug ab, Laden fängt Unfug ab
  const bad = JSON.parse(JSON.stringify(data)); bad.schiff.fracht = ['kaviar'];
  ok(Weltstand.validate(bad).length > 0, 'Schema lehnt unbekannte Art ab');
  const R = new Game({ noStore: true, seed: 3, log: () => {} });
  Fracht.restore(R, ['sprengstoff', 'kaviar', 'fracht', 'fracht', 'sprengstoff']);
  ok(Fracht.anBord(R) === 2 && JSON.stringify(Fracht.lagerArten(R)) === '["sprengstoff","fracht"]', 'restore filtert unbekannte Arten und kappt auf die Kapazität');
});

section('Snapshot kompakt', () => {
  const T = arena();
  ok(T.g.snapshot().fracht === undefined, 'ohne Fracht kein Feld fracht im Snapshot');
  pod(T, 100); pod(T, 140);
  Fracht.anBordLegen(T.g, 'sprengstoff'); Fracht.anBordLegen(T.g, 'fracht');
  T.taktik();
  const full = JSON.stringify(T.g.snapshot().fracht);
  ok(full.length < 260, `Feld fracht (2 draußen, 2 an Bord): ${full.length} B`);
  T.g.ship.shields = T.g.ship.shields;
  info(full);
});

section('Schnittstelle gesichert/ungesichert (AP9; Wirkung in test-energie.js)', () => {
  const T = arena();
  ok(Fracht.gesichert(T.g) === true && T.g.snapshot().fracht === undefined, 'Standard: gesichert, nicht im Snapshot');
  Fracht.setGesichert(T.g, false);
  ok(Fracht.gesichert(T.g) === false && T.g.snapshot().fracht && T.g.snapshot().fracht.g === false, 'ungesichert: Snapshot fracht.g = false');
  Fracht.setGesichert(T.g, true);
  ok(T.g.snapshot().fracht === undefined, 'wieder gesichert: Feld weg');
  // PAN-01 A: das Modul Frachtraum setzt die Flagge jeden Tick; ausgeschaltet bleibt sie false
  require('../server/sim/module.js').schalten(T.g, 'frachtraum', false, null, 0, 8); T.run(0.1);
  ok(Fracht.gesichert(T.g) === false, 'Modul Frachtraum aus: ungesichert');
  pod(T, 100); T.taktik(); T.cmd('weapons.fracht'); T.run(3.1);
  ok(Fracht.anBord(T.g) === 1, 'ungesichert hat keine Wirkung auf das Beamen (die Wirkung sind Hüllentreffer, siehe test-energie.js)');
});

section('Debug-Befehle', () => {
  const T = arena();
  T.send({ t: 'debug', cmd: 'fracht', args: 'abwerfen fracht 100 0' });
  ok(Fracht.draussen(T.g).length === 1 && Fracht.draussen(T.g)[0].art === 'fracht', 'fracht abwerfen fracht 100 0');
  T.send({ t: 'debug', cmd: 'fracht', args: 'an sprengstoff' });
  ok(Fracht.anBord(T.g, 'sprengstoff') === 1, 'fracht an sprengstoff');
  T.send({ t: 'debug', cmd: 'fracht', args: 'leer' });
  ok(Fracht.anBord(T.g) === 0 && Fracht.draussen(T.g).length === 0, 'fracht leer');
  ok(require('../shared/protocol.js').DEBUG_CMDS.includes('fracht'), 'in Protocol.DEBUG_CMDS');
});

section('Bausteine (Regiebuch)', () => {
  for (const id of ['fracht_abwerfen', 'fracht_abnehmer', 'fracht_abliefern']) ok(Registry.get(id) && Registry.get(id).art === 'aktion', `Aktion ${id} registriert`);
  for (const id of ['fracht_an_bord', 'fracht_abgeliefert']) ok(Registry.get(id) && Registry.get(id).art === 'pruefung', `Prüfung ${id} registriert`);
  const T = arena();
  const m = { game: T.g, def: null, tpl: (t) => t };
  const run = (id, a) => Registry.get(id).run(m, a || {});
  const test = (id, a) => Registry.get(id).test(m, a || {});
  ok(!test('fracht_an_bord') && !test('fracht_abgeliefert'), 'Prüfungen anfangs falsch');
  run('fracht_abwerfen', { art: 'sprengstoff' });
  ok(Fracht.draussen(T.g).length === 1 && Math.abs(Fracht.draussen(T.g)[0].x - (T.g.ship.x + 160)) < 1, 'fracht_abwerfen: 160 px vor der Lerche');
  run('fracht_abwerfen', { art: 'fracht', x: 10, y: 20 });
  ok(Fracht.draussen(T.g).some((d) => d.x === 10 && d.y === 20), 'fracht_abwerfen mit x/y');
  Fracht.anBordLegen(T.g, 'sprengstoff');
  ok(test('fracht_an_bord') && test('fracht_an_bord', { art: 'sprengstoff' }) && !test('fracht_an_bord', { art: 'fracht' }) && !test('fracht_an_bord', { min: 2 }), 'fracht_an_bord (art, min)');
  run('fracht_abnehmer', { ort: 'hafen', name: 'Tesk' });
  ok(T.g.fracht.abnehmer && T.g.fracht.abnehmer.ort === 'hafen', 'fracht_abnehmer');
  run('fracht_abliefern', { art: 'fracht' });
  ok(Fracht.anBord(T.g) === 1, 'fracht_abliefern mit anderer Art lässt die Ladung');
  run('fracht_abliefern', {});
  ok(Fracht.anBord(T.g) === 0 && test('fracht_abgeliefert') && test('fracht_abgeliefert', { art: 'sprengstoff' }) && !test('fracht_abgeliefert', { min: 2 }), 'fracht_abliefern übergibt, fracht_abgeliefert zählt');
  // Vertrag und Prüfer
  const bs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'regiebuch', 'bausteine.json'), 'utf8'));
  const all = Object.assign({}, bs.aktionen, bs.pruefungen);
  ok(['fracht_abwerfen', 'fracht_abnehmer', 'fracht_abliefern', 'fracht_an_bord', 'fracht_abgeliefert'].every((id) => all[id] && all[id].status === 'registriert'), 'alle fünf stehen in content/regiebuch/bausteine.json');
  const Checker = require('../server/mission/checker.js');
  const doc = { format: 'regiebuch/1', id: 'lager_probe', kopf: { titel: 'Lager', art: 'intern', zielspieldauer_min: 3, feldzug: null, auftraggeber: 'tesk' },
    buch: {}, buehne: { orte: ['hafen'] }, besetzung: { npc: ['tesk'] }, erwartet: {},
    ausgaenge: { erfolg: { beschreibung: 'ok', folgen: [] } },
    steps: [
      { id: 'a', loc: 'hafen', enter: [{ do: 'fracht_abnehmer', ort: 'hafen', name: '@name' }, { do: 'fracht_abwerfen', art: 'sprengstoff' }],
        objectives: [{ id: 'o1', text: '@t1', done: { check: { name: 'fracht_an_bord', art: 'sprengstoff' } } }],
        next: [{ if: { check: { name: 'fracht_an_bord', art: 'sprengstoff' } }, goto: 'b' }] },
      { id: 'b', loc: 'hafen', objectives: [{ id: 'o2', text: '@t2', done: { check: { name: 'fracht_abgeliefert', min: 1 } } }],
        next: [{ if: { check: { name: 'fracht_abgeliefert', min: 1 } }, complete: 'erfolg' }] }],
    on: { frachtAbgeliefert: [{ do: 'fracht_abliefern' }] },
    texte: { name: 'Tesk', t1: 'Fracht an Bord', t2: 'Abliefern' } };
  const r = Checker.check(doc, {});
  const mine = r.errors.concat(r.warnings).filter((e) => /fracht/i.test(e.p + ' ' + e.msg));
  ok(mine.length === 0, 'Prüfer: Regiebuch mit den neuen Bausteinen ohne Meldung zu fracht_*' + (mine.length ? ' – ' + JSON.stringify(mine[0]) : ''));
  const bad = JSON.parse(JSON.stringify(doc)); bad.steps[0].enter[1].art = 'kaviar';
  ok(Checker.check(bad, {}).errors.some((e) => /kaviar|art/.test(e.msg + e.p)), 'Prüfer: unbekannte Art in fracht_abwerfen wird gemeldet');
  // itemAboard kennt Fracht (Gegenstandstyp sprengstoff)
  Fracht.anBordLegen(T.g, 'sprengstoff');
  ok(T.g.mission.cond({ itemAboard: 'sprengstoff' }) === true, 'Bedingung itemAboard: sprengstoff zählt die Fracht an Bord');
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\ntest-lager: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
