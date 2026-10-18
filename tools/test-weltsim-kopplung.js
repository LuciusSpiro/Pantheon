'use strict';
// SUND-01 Paket B: Kopplung der Weltsimulation an das Spiel (server/sim/kriegslage.js), Modus „Freie Fahrt Sund“.
//   Modusstart · ein Tick je Sprung (Normal, Schnellsprung je Hop, Notfall) und sonst keiner · Kampagne ohne Sim · Speichern/Neustart/Laden ·
//   Altstände · Schema · Besitz-Overlay · game.rng unberührt · Hauptwelt · dockOk nach dem Laden.
//   node tools/test-weltsim-kopplung.js   (npm run test:weltsim-kopplung)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
process.chdir(path.join(__dirname, '..'));
const { Game } = require('../server/game.js');
const Weltstand = require('../server/weltstand.js');
const Protocol = require('../shared/protocol.js');
const Sektoren = require('../shared/sektoren.js');
const Welt = require('../server/sim/welt.js');
const Kern = require('../server/weltsim/kern.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Besitz = require('../server/sim/besitz.js');
const Sprung = require('../server/sim/sprung.js');
const Reise = require('../server/sim/reise.js');
const Space = require('../server/sim/space.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const gleich = (a, b) => { try { assert.deepStrictEqual(a, b); return true; } catch (e) { return false; } };

const ROOT_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-kopplung-'));
let dirSeq = 0;
const freshDir = () => { const d = path.join(ROOT_TMP, 'w' + (++dirSeq)); fs.mkdirSync(d, { recursive: true }); return d; };
const files = (d) => fs.readdirSync(d).filter((f) => /^[a-z0-9-]+\.json$/.test(f) && !f.includes('.bak') && !f.includes('.kaputt'));

// Zähler am Sim-Kern: wie oft wurde wirklich getickt
let kernTicks = 0;
const kernOrig = Kern.tick;
Kern.tick = function (...a) { kernTicks++; return kernOrig.apply(this, a); };

function setup(dir, start, opts) {
  const g = new Game(Object.assign({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(ROOT_TMP, 'regie') }, log: () => {} }, opts || {}));
  const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'Crew', color: 0 });
  const send = (m) => g.handleMessage(c, m);
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
  const start_ = (lobby) => { send(Object.assign({ t: 'lobbyOpt', startMission: start }, lobby || {})); send({ t: 'ready', ready: true }); run(1); g.space.enemies = []; };
  return { g, c, send, run, start: start_, events: (k) => c.inbox.filter((m) => m.t === 'event' && m.kind === k) };
}
function place(g, x, y) { const s = g.ship; s.helm.stage = 1; s.docked = false; s.dockedAt = null; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; }
// Normalsprung in den Nachbarhex: Boje bekannt, Ziel wählen, am Sprungpunkt laden, springen. -> Fehlertext | null
function springe(t, hex) {
  const g = t.g;
  const von = Sektoren.hexVonOrt(g.ship.scene);
  g.explore.markBoje(Sektoren.kanteId(von, hex));
  const e = Sprung.selectDest(g, Sektoren.ortVonHex(hex)); if (e) return 'Ziel: ' + e;
  const p = Sprung.sprungpunkt(g, hex); place(g, p.x - 80, p.y);
  t.run(40); g.space.enemies = [];
  return Sprung.doJump(g);
}
const ticks = (g) => (g.weltsim ? g.weltsim.tickZahl : null);
// Welt: zwei nacheinander gelegte Hops 0305 -> 0205 -> 0204 (alle drei Hexe mit Boje bekannt) als Route
function route(g, hexe) {
  let von = Sektoren.hexVonOrt(g.ship.scene);
  for (const h of hexe) { g.explore.markBoje(Sektoren.kanteId(von, h)); g.explore.erkunde(h); von = h; }
  g.explore.erkunde(Sektoren.hexVonOrt(g.ship.scene));
}

// =============================================================================================================================
section('Protokoll und Lobby');
{
  ok(Protocol.LOBBY_MODI.includes('freie_fahrt') && Protocol.CAMPAIGN_STARTS.includes('freie_fahrt'), 'LOBBY_MODI und CAMPAIGN_STARTS kennen freie_fahrt');
  ok(Protocol.START_LABELS.freie_fahrt === 'Freie Fahrt Sund' && !!Protocol.START_HINTS.freie_fahrt, 'Label „Freie Fahrt Sund“ und Hinweistext');
  ok(!Protocol.CAMPAIGN_KETTEN.freie_fahrt, 'keine Kampagnenkette');
  const t = setup(freshDir(), 'freie_fahrt');
  ok(t.g.startModi().includes('freie_fahrt'), 'Server: startModi (Taste M) enthält den Modus');
  t.send({ t: 'lobbyOpt', startMission: 'freie_fahrt' });
  ok(t.g.lobbyOpts.startMission === 'freie_fahrt' && t.g.snapshot().lobby.startMission === 'freie_fahrt', 'Lobby nimmt den Modus an');
  ok(t.g.weltsim === null || t.g.weltsim === undefined, 'in der Lobby noch keine Sim');
}

// =============================================================================================================================
section('Modusstart');
{
  const dir = freshDir();
  const t = setup(dir, 'freie_fahrt'); const g = t.g;
  t.start(); t.run(5);
  ok(g.phase === 'play' && Welt.kartenId() === 'sund_frei' && g.weltId === 'sund_frei', 'Partie läuft auf der Karte sund_frei');
  ok(g.ship.docked && g.ship.dockedAt === 'ostia_nova' && g.ship.scene === 'ostia_nova', 'Crew startet angedockt in Ostia Nova');
  ok(g.spielleiter === null, 'kein Spielleiter');
  ok(!g.mission.kette && g.mission.activeId === null, 'keine Kette, keine laufende Mission (keine Rahmenmission)');
  ok(g.weltsim && g.weltsim.tickZahl === 0 && g.weltsim.zustand.tick === 0 && g.weltsim.zustand.werte && g.weltsim.zustand.karte, 'Sim erzeugt, Tick 0');
  ok(Object.keys(g.weltBesitz.hexe).length === Object.keys(g.weltsim.zustand.hexe).length && g.weltBesitz.hexe['0204'].besitzer === 'rom' && g.weltBesitz.hexe['1004'].besitzer === 'ger' && g.weltBesitz.hexe['0305'].posten === false, 'Besitz-Overlay für alle Sim-Hexe gefüllt (Palatina rom, Hrafnheim ger)');
  const kons = Object.entries(g.weltsim.zustand.hexe).filter(([, h]) => h.besitzer === 'kon').map(([c]) => c);
  ok(kons.length && kons.every((c) => g.weltBesitz.hexe[c].besitzer === 'saum'), 'Konkordat heißt im Overlay saum');
  ok(g.weltstand && g.weltstand.persistent && g.weltstand.data.tutorial === 'uebersprungen' && g.weltstand.data.fakten.welt_karte === 'sund_frei', 'Weltstand angelegt (persistent, kein Tutorial, Fakt welt_karte)');
  ok(g.errors === 0, 'keine Fehler nach 6 s Spielzeit');
  const f = files(dir);
  ok(f.length === 1, 'Stand geschrieben (' + f.length + ')');
  const d = JSON.parse(fs.readFileSync(path.join(dir, f[0]), 'utf8'));
  ok(d.welt.sim && d.welt.sim.modus === 'freie_fahrt' && d.welt.sim.tick === 0 && d.welt.sim.zustand && d.welt.sim.zustand.tick === 0, 'welt.sim im Stand (modus, tick, zustand)');
  ok(!('werte' in d.welt.sim.zustand) && !('karte' in d.welt.sim.zustand), 'Sim-Zustand im Stand ohne werte und karte');
  ok(d.version === 3, 'Weltstand-Version bleibt 3');
  ok(g.snapshot().lobby !== undefined && JSON.stringify(g.snapshot()).indexOf('"flotten"') < 0, 'Snapshot trägt keinen Sim-Zustand');
  // Beenden räumt auf
  t.send({ t: 'menu', op: 'end' });
  ok(g.weltsim === null && g.weltBesitz === null && Welt.kartenId() === 'limes', 'Partie beenden: Sim und Overlay weg, Karte Limes');
}

// =============================================================================================================================
section('Kampagne und Limes: keine Sim, keine Ticks');
{
  for (const start of ['free', 'schuld_der_lerche']) {
    const t = setup(freshDir(), start); const g = t.g;
    t.start(); t.run(2);
    const k0 = kernTicks;
    ok(g.weltsim === null && g.weltBesitz === null, `${start}: game.weltsim und weltBesitz null`);
    ok(Kriegslage.tick(g, 'sprung') === null && kernTicks === k0, `${start}: Kriegslage.tick ohne Modus tut nichts`);
    if (start === 'free') {
      g.explore.erkunde('0306'); g.explore.erkunde('0206');
      Sprung.springeNach(g, 'splitter');
      ok(g.ship.scene === 'splitter' && kernTicks === k0, 'Limes: Sprung ohne Tick');
    }
    const d = Weltstand.capture(g);
    ok(d.welt && !('sim' in d.welt), `${start}: kein Block welt.sim im Weltstand`);
    ok(g.errors === 0 && Besitz.modus(g) === false, `${start}: Besitz-Modus aus, keine Fehler`);
  }
}

// =============================================================================================================================
section('Ein Tick je Sprung, sonst keiner');
{
  const t = setup(freshDir(), 'freie_fahrt'); const g = t.g;
  t.start();
  g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;   // deterministisch: kein Abfangen
  const k = () => kernTicks;
  const k0 = k();
  // nichts davon tickt: Warten, Routenplanung, Szenenwechsel ohne Sprung, Docken, Ablegen
  t.run(20);
  ok(k() === k0 && ticks(g) === 0, 'Warten (20 s angedockt): kein Tick');
  route(g, ['0205', '0105']);
  Sprung.selectDest(g, Sektoren.ortVonHex('0105'));
  ok(g.reisePlan && g.reisePlan.hops.join() === '0205,0105' && k() === k0, 'Routenplanung (Schnellsprung-Route gewählt): kein Tick');
  g.reisePlan = null; g.ship.jump.dest = null;
  g.debugGoto('vulcania', false); g.debugGoto('ostia_nova', true); t.run(5);
  ok(k() === k0 && g.ship.docked && g.ship.dockedAt === 'ostia_nova', 'Szenenwechsel ohne Sprung (debugGoto) und Andocken: kein Tick');
  g.ship.helm.stage += 1; t.run(1);
  ok(!g.ship.docked && k() === k0, 'Ablegen: kein Tick');
  place(g, g.ship.x, g.ship.y); t.run(3);

  // Normalsprung
  const sr0 = springe(t, '0205'); ok(sr0 === null && g.ship.scene === 'vulcania', 'Normalsprung nach Vulcania' + (sr0 ? ' – ' + sr0 : ''));
  ok(ticks(g) === 1 && k() === k0 + 1 && g.weltsim.zustand.tick === 1 && g.weltsim.letzteQuelle === 'sprung', 'Normalsprung: genau ein Tick');
  t.run(10);
  ok(ticks(g) === 1, 'danach Warten: weiter ein Tick');

  // Schnellsprung: 3 Hops 0205 -> 0305 -> 0204 -> ...  (Route über erkundete Hexe), ohne Abfangen
  const hopZeit = g.C.reise.hopZeit;
  const ZYKLUS = ['0305', '0205', '0204'];   // paarweise Nachbarn: drei Hops von jedem Punkt
  const dreiHops = () => { const i = ZYKLUS.indexOf(Sektoren.hexVonOrt(g.ship.scene)); return [1, 2, 3].map((k) => ZYKLUS[(i + k + 3) % 3]); };
  const hopsVon = (hexe) => {
    const von = Sektoren.hexVonOrt(g.ship.scene);
    route(g, hexe);
    g.reisePlan = { ziel: Sektoren.ortVonHex(hexe[hexe.length - 1]), hops: hexe.slice() };
    g.ship.jump.dest = Sektoren.ortVonHex(hexe[0]);
    const p = Sprung.sprungpunkt(g, hexe[0]); place(g, p.x - 80, p.y); t.run(40); g.space.enemies = [];
    return von;
  };
  hopsVon(dreiHops());
  const tk0 = ticks(g), kk0 = k();
  ok(Reise.befehl(g) === null && g.reise && g.reise.hops.length === 3, 'Schnellsprung über 3 Hops gestartet');
  t.run(hopZeit - 1);
  ok(ticks(g) === tk0 && k() === kk0 && g.reise.i === 0, 'Start des Schnellsprungs ohne Hop: kein Tick');
  t.run(1.5);
  ok(g.reise && g.reise.i === 1 && ticks(g) === tk0 + 1, 'Hop 1: ein Tick');
  t.run(hopZeit + 0.2);
  ok(g.reise && g.reise.i === 2 && ticks(g) === tk0 + 2, 'Hop 2: zweiter Tick');
  t.run(hopZeit + 0.2);
  ok(!g.reise && ticks(g) === tk0 + 3 && k() === kk0 + 3 && g.weltsim.letzteQuelle === 'sprung', 'Hop 3: dritter Tick, Reise zu Ende (3 Hops, 3 Ticks)');
  ok(g.errors === 0, 'keine Fehler');

  // Schnellsprung mit Abbruch: der laufende Hop springt trotzdem noch, dann Schluss
  hopsVon(dreiHops());
  const ta = ticks(g);
  Reise.befehl(g); t.run(hopZeit + 0.2);
  ok(g.reise && g.reise.i === 1 && ticks(g) === ta + 1, 'Abbruch-Fall: Hop 1 getickt');
  Reise.befehl(g);   // Steuermann bricht ab
  t.run(0.2);
  ok(!g.reise && ticks(g) === ta + 2, 'Abbruch: der laufende Hop springt noch, ein Tick mehr, danach nichts (2 Hops, 2 Ticks)');
  t.run(15);
  ok(ticks(g) === ta + 2, 'nach dem Abbruch kein weiterer Tick');

  // Abbruch gleich nach dem Start: genau ein Hop
  hopsVon(dreiHops());
  const tb = ticks(g);
  Reise.befehl(g); t.run(0.1); Reise.befehl(g); t.run(0.2);
  ok(!g.reise && ticks(g) === tb + 1, 'Abbruch vor dem ersten Hop: genau ein Hop und ein Tick');

  // Abgefangen: die Reise endet nach dem Hop, ein Tick je gesprungenem Hop
  g.C.reise.feindChance = 1; g.C.reise.neutralChance = 1; g.C.reise.neutralMax = 1; g.C.reise.fraktionArt.rom = 'feind';
  hopsVon(dreiHops());
  const tc = ticks(g);
  Reise.befehl(g); t.run(hopZeit + 0.2);
  ok(!g.reise && ticks(g) === tc + 1, 'abgefangen nach Hop 1: ein Tick, Reise zu Ende ' + JSON.stringify([!!g.reise, ticks(g) - tc, g.space.enemies.length, g.ship.scene]));
  g.C.reise.feindChance = 0; g.C.reise.neutralChance = 0; g.C.reise.neutralMax = 0.6; g.C.reise.fraktionArt.rom = 'sicher';
  g.space.enemies = [];

  // Notfallsprung: ein Tick je Ausführung
  place(g, 1000, 1000); g.ship.reactorCtl.state = 'online';
  const tn = ticks(g);
  ok(Sprung.notsprung(g) === null, 'Notfallsprung ausgeführt');
  ok(ticks(g) === tn + 1 && g.weltsim.letzteQuelle === 'notsprung', 'Notfallsprung (Ortswechsel): genau ein Tick');
  // Notfallsprung ohne Ortswechsel (kein Kandidat): auch ein Tick
  place(g, 1000, 1000); g.ship.reactorCtl.state = 'online'; g.ship.hull = g.ship.hullMax;
  const spielbar = Sektoren.spielbar; Sektoren.spielbar = () => false;
  const t2 = ticks(g), s2 = g.ship.scene;
  let r2; try { r2 = Sprung.notsprung(g); } finally { Sektoren.spielbar = spielbar; }
  ok(r2 === null && g.ship.scene === s2 && ticks(g) === t2 + 1, 'Notfallsprung in denselben Sektor: ebenfalls genau ein Tick');
  ok(g.errors === 0, 'keine Fehler');
}

// =============================================================================================================================
section('Fehler in der Sim: gezählt, Tick übersprungen, Zustand heil');
{
  const t = setup(freshDir(), 'freie_fahrt'); const g = t.g;
  t.start();
  const vorher = Kriegslage.abbild(g.weltsim.zustand);
  Kern.tick = function (z) { z.tick += 1; z.zufall = 12345; throw new Error('Absicht'); };
  const log = console.warn; console.warn = () => {};
  let r; try { r = Kriegslage.tick(g, 'sprung'); } finally { console.warn = log; Kern.tick = function (...a) { kernTicks++; return kernOrig.apply(this, a); }; }
  ok(r === null && g.errors === 1 && g.weltsim.fehler === 1 && g.weltsim.tickZahl === 0, 'Fehler gezählt (game.errors), Tick nicht gezählt');
  ok(gleich(Kriegslage.abbild(g.weltsim.zustand), vorher), 'Zustand nach dem Fehler unverändert (Rückfall)');
  ok(Kriegslage.tick(g, 'sprung') !== null && g.weltsim.tickZahl === 1, 'nächster Tick läuft normal');
}

// =============================================================================================================================
section('Speichern, Neustart, Laden: gleicher Sim-Zustand');
{
  const dir = freshDir();
  const a = setup(dir, 'freie_fahrt'); const ga = a.g;
  a.start();
  ga.C.reise.neutralChance = 0; ga.C.reise.neutralPlus = 0; ga.C.reise.feindChance = 0;
  for (const h of ['0205', '0305', '0205', '0305']) springe(a, h);
  // viele weitere Ticks direkt, damit sich etwas ändert (Flotten, Angriffe)
  for (let i = 0; i < 60; i++) Kriegslage.tick(ga, 'sprung');
  const id = ga.weltstand.id;
  ga.debugGoto('ostia_nova', true); a.run(1);
  const sr = ga.saveWorld('test', { sync: true });
  ok(sr.ok, 'gesichert angedockt (' + (sr.error || 'ok') + ')');
  const tickA = ga.weltsim.tickZahl, zA = JSON.parse(JSON.stringify(ga.weltsim.zustand));
  ok(tickA === 64 && zA.tick === 64, 'Tick-Zähler 64 (4 Sprünge + 60)');
  ok(ga.weltsim.zustand.angriffe.length > 0 || ga.weltsim.zustand.flotten.some((f) => f.befehl !== 'heim'), 'die Welt hat sich bewegt (Feldzüge oder Aufbrüche)');
  const raw = fs.readFileSync(path.join(dir, id + '.json'), 'utf8');
  const d = JSON.parse(raw);
  ok(d.welt.sim.tick === 64 && !('werte' in d.welt.sim.zustand) && !('karte' in d.welt.sim.zustand), 'Datei: tick 64, ohne werte und karte');
  ok(Weltstand.validate(d).length === 0, 'Datei ist schemagültig');
  a.send({ t: 'menu', op: 'end' });

  // „Neustart“: neuer Game-Prozess auf demselben Verzeichnis, Stand fortsetzen
  const b = setup(dir, 'free');
  b.send({ t: 'lobbyOpt', world: id }); b.send({ t: 'ready', ready: true }); b.run(2);
  const gb = b.g;
  ok(gb.phase === 'play' && gb.weltstand && gb.weltstand.id === id, 'Stand fortgesetzt');
  ok(gb.weltsim && gb.weltsim.tickZahl === tickA, 'Tick-Zähler nach dem Laden gleich');
  ok(gleich(gb.weltsim.zustand, zA), 'Sim-Zustand nach dem Laden Tiefenvergleich gleich (inkl. werte, karte, Zufallsstrom)');
  ok(Welt.kartenId() === 'sund_frei' && gb.ship.dockedAt === 'ostia_nova' && gb.ship.docked, 'Karte sund_frei und angedockt in Ostia Nova');
  ok(gb.spielleiter === null && !gb.mission.kette && gb.mission.mode === null && gb.mission.activeId === null, 'kein Spielleiter, keine Kette, keine Angebote der Limes-Kampagne');
  ok(gb.weltBesitz && gleich(gb.weltBesitz.hexe['0204'], { besitzer: 'rom', posten: false }) && Object.keys(gb.weltBesitz.hexe).length === Object.keys(zA.hexe).length, 'Besitz-Overlay nach dem Laden neu gefüllt');
  for (const [c, h] of Object.entries(zA.hexe)) { const o = gb.weltBesitz.hexe[c]; if (o.posten !== !!h.posten) { ok(false, 'Overlay Posten ' + c); break; } }
  ok(gb.errors === 0, 'keine Fehler beim Laden');
  // beide laufen gleich weiter
  for (let i = 0; i < 25; i++) { Kriegslage.tick(gb, 'sprung'); }
  const kopie = JSON.parse(JSON.stringify(zA)); kopie.werte = gb.weltsim.zustand.werte; kopie.karte = gb.weltsim.zustand.karte;
  for (let i = 0; i < 25; i++) kernOrig(kopie, {});
  ok(gleich(gb.weltsim.zustand, kopie), '25 weitere Ticks: geladener Stand läuft wie der gespeicherte Zustand weiter (Determinismus über Speichern)');
  // zweites Speichern/Laden: stabil
  gb.debugGoto('ostia_nova', true); b.run(1);
  const sr2 = gb.saveWorld('test2', { sync: true });
  const d2 = JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8'));
  ok(sr2.ok && d2.welt.sim.tick === 89 && gleich(d2.welt.sim.zustand, Kriegslage.abbild(gb.weltsim.zustand)), 'zweites Speichern: Block entspricht dem Laufzustand');
  b.send({ t: 'menu', op: 'end' });

  // Block entfernen: der Stand ist wieder Kampagne
  const f = path.join(dir, id + '.json');
  const d3 = JSON.parse(fs.readFileSync(f, 'utf8')); delete d3.welt.sim; fs.writeFileSync(f, JSON.stringify(d3));
  const c = setup(dir, 'free');
  c.send({ t: 'lobbyOpt', world: id }); c.send({ t: 'ready', ready: true }); c.run(1);
  ok(c.g.phase === 'play' && c.g.weltsim === null && c.g.weltBesitz === null, 'Stand ohne Block lädt als Kampagne: weltsim und Overlay null');
  c.send({ t: 'menu', op: 'end' });

  // Unbrauchbarer Block: kein Absturz, neue Sim, Tick-Zähler bleibt
  // schemagültig, aber ohne Hexe
  const d4 = JSON.parse(fs.readFileSync(f, 'utf8')); d4.welt.sim = { modus: 'freie_fahrt', tick: 7, zustand: { version: 1, seed: 1, tick: 0, zufall: 5, hexe: {}, flotten: [], naechsteId: 1, angriffe: [], vorrat: {}, marken: {}, absichten: {} } }; fs.writeFileSync(f, JSON.stringify(d4));
  const e = setup(dir, 'free');
  e.send({ t: 'lobbyOpt', world: id }); e.send({ t: 'ready', ready: true });
  const log = console.warn; console.warn = () => {};
  try { e.run(1); } finally { console.warn = log; }
  ok(e.g.phase === 'play' && e.g.weltsim && e.g.weltsim.tickZahl === 7 && e.g.weltsim.zustand.tick === 0 && e.g.errors >= 1, 'unbrauchbarer Sim-Zustand: neue Welt, Fehler gezählt, Spiel läuft ' + JSON.stringify([e.g.phase, e.g.weltsim && e.g.weltsim.tickZahl, e.g.weltsim && e.g.weltsim.zustand.tick, e.g.errors, e.g.weltstand && e.g.weltstand.id, id]));
  e.send({ t: 'menu', op: 'end' });
}

// =============================================================================================================================
section('Altstände laden weiter (Fixtures v1/v2, Kampagne ohne Block)');
{
  const fx = path.join(__dirname, 'fixtures', 'weltstand');
  for (const name of fs.readdirSync(fx).filter((f) => f.endsWith('.json'))) {
    const dir = freshDir();
    const raw = JSON.parse(fs.readFileSync(path.join(fx, name), 'utf8'));
    raw.id = 'w-fix1';
    fs.writeFileSync(path.join(dir, 'w-fix1.json'), JSON.stringify(raw));
    const r = Weltstand.readChecked(path.join(dir, 'w-fix1.json'));
    ok(r.ok && r.data.version === 3 && !(r.data.welt && r.data.welt.sim) && Weltstand.validate(r.data).length === 0, `${name}: migriert auf v3, schemagültig, ohne welt.sim`);
    const t = setup(dir, 'free');
    t.send({ t: 'lobbyOpt', world: 'w-fix1' }); t.send({ t: 'ready', ready: true }); t.run(2);
    ok(t.g.phase === 'play' && t.g.weltsim === null && t.g.weltBesitz === null && t.g.errors === 0 && Welt.kartenId() === 'limes', `${name}: lädt als Kampagne, keine Sim, keine Fehler`);
    t.send({ t: 'menu', op: 'end' });
  }
}

// =============================================================================================================================
section('Schema: Block welt.sim');
{
  const t = setup(freshDir(), 'freie_fahrt'); const g = t.g;
  t.start();
  const data = JSON.parse(JSON.stringify(Weltstand.capture(g)));
  ok(data.welt.sim && Weltstand.validate(data).length === 0, 'erfasster Stand mit Block ist schemagültig');
  const mod = (fn) => { const d = JSON.parse(JSON.stringify(data)); fn(d); return Weltstand.validate(d); };
  ok(mod((d) => { d.welt.sim.modus = 'kampagne'; }).length > 0, 'falscher modus wird abgelehnt');
  ok(mod((d) => { delete d.welt.sim.tick; }).length > 0, 'fehlender tick wird abgelehnt');
  ok(mod((d) => { d.welt.sim.tick = -1; }).length > 0, 'negativer tick wird abgelehnt');
  ok(mod((d) => { d.welt.sim.extra = 1; }).length > 0, 'unbekanntes Feld im Block wird abgelehnt');
  ok(mod((d) => { delete d.welt.sim.zustand.flotten; }).length > 0, 'fehlende flotten werden abgelehnt');
  ok(mod((d) => { d.welt.sim.hauptweltGefallen = { fraktion: 'rom', tick: 3 }; }).length === 0, 'hauptweltGefallen { fraktion, tick } ist gültig');
  const ohne = JSON.parse(JSON.stringify(data)); delete ohne.welt.sim;
  ok(Weltstand.validate(ohne).length === 0, 'ohne Block (Kampagne) bleibt gültig');
}

// =============================================================================================================================
section('Besitz-Overlay wirkt (Andocken, Fraktionsart, Banner, Posten)');
{
  const t = setup(freshDir(), 'freie_fahrt'); const g = t.g;
  t.start();
  const z = g.weltsim.zustand;
  ok(Besitz.darfAndocken(g, '0205') && Reise.fraktionArt(g, '0205') === 'sicher' && Besitz.besitzer(g, '0205') === 'rom', 'Vulcania (rom): andockbar, sicher');
  // Eroberung im Sim-Zustand, übernommen beim nächsten Tick (Sprung)
  z.hexe['0205'].besitzer = 'ger';
  ok(Besitz.darfAndocken(g, '0205'), 'vor dem Tick ändert sich nichts (Overlay folgt dem Tick)');
  g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;
  Kriegslage.tick(g, 'sprung');
  ok(z.hexe['0205'].besitzer === 'ger' && Besitz.besitzer(g, '0205') === 'ger' && !Besitz.darfAndocken(g, '0205') && Reise.fraktionArt(g, '0205') === 'feind', 'nach dem Tick: Vulcania ger, nicht andockbar, feind');
  Space.enterScene(g, 'vulcania', { docked: true });
  ok(g.space.dockOk === false && !g.ship.docked && !g.space.markers.some((m) => m.kind === 'dock') && g.space.markers.some((m) => m.fr === 'ger'), 'Szene: dockOk falsch, kein Dock-Marker, Banner ger');
  z.hexe['0205'].besitzer = 'rom';
  Kriegslage.tick(g, 'sprung');
  Space.enterScene(g, 'vulcania', { docked: true });
  ok(g.space.dockOk === true && g.ship.docked && g.space.markers.some((m) => m.fr === 'rom'), 'zurückerobert: wieder andockbar, Banner rom');
  // Posten in einem freien Sektor
  const freie = Object.entries(z.hexe).find(([c, h]) => h.besitzer === null && !Sektoren.hexDaten(c).hafen);
  ok(!!freie, 'freier Sektor in der Sim vorhanden (' + (freie && freie[0]) + ')');
  if (freie) {
    z.hexe[freie[0]].besitzer = 'rom'; z.hexe[freie[0]].posten = true; z.hexe[freie[0]].garnison = 4;
    Kriegslage.tick(g, 'sprung');
    ok(Besitz.istPosten(g, freie[0]) && Besitz.besitzer(g, freie[0]) === 'rom' && !Besitz.darfAndocken(g, freie[0]), 'Posten im Overlay: Besitzer rom, nicht andockbar');
    Space.enterScene(g, Sektoren.ortVonHex(freie[0]), {});
    ok(g.space.markers.some((m) => m.posten === true && m.fr === 'rom'), 'Szene zeigt den Posten mit Fahne rom');
  }
  // Sonderorte außerhalb der Sim bleiben statisch
  ok(Object.keys(g.weltBesitz.hexe).every((c) => z.hexe[c]) && !('0506' in g.weltBesitz.hexe), 'Hexe außerhalb der Sim (Helix) nicht im Overlay');
}

// =============================================================================================================================
section('game.rng bleibt unberührt (mit und ohne Sim-Ticks)');
{
  const lauf = (mitSim) => {
    const t = setup(freshDir(), 'freie_fahrt', { seed: 4242 }); const g = t.g;
    t.start();
    if (!mitSim) { g.weltsim = null; g.weltBesitz = null; }
    g.C.reise.neutralChance = 0.5; g.C.reise.neutralPlus = 0.1; g.C.reise.feindChance = 0.5; g.C.reise.fraktionArt.rom = 'feind';
    const ereignisse = [];
    for (const h of ['0205', '0305', '0205']) {
      springe(t, h); g.space.enemies = [];
      ereignisse.push(Reise.abfangen(g, Sektoren.hexVonOrt(g.ship.scene)));   // würfelt aus game.rng
      g.space.enemies = [];
    }
    for (let i = 0; i < 30; i++) Kriegslage.tick(g, 'sprung');
    const folge = []; for (let i = 0; i < 12; i++) folge.push(g.rng());
    return { folge, ereignisse, ticks: ticks(g) };
  };
  const mit = lauf(true), ohne = lauf(false);
  ok(mit.ticks > 30 && ohne.ticks === null, 'Lauf mit Sim tickt, Lauf ohne nicht');
  ok(gleich(mit.folge, ohne.folge), 'gleicher Seed: dieselbe Folge der nächsten 12 Würfe aus game.rng');
  ok(gleich(mit.ereignisse, ohne.ereignisse), 'Abfangwürfe gleich ausgegangen');
}

// =============================================================================================================================
section('Hauptwelt fällt (konstruierter Zustand)');
{
  const t = setup(freshDir(), 'freie_fahrt'); const g = t.g;
  t.start();
  let z = g.weltsim.zustand;
  z.flotten = z.flotten.filter((fl) => !(fl.fraktion === 'rom' && fl.ort === '0204'));
  z.vorrat.ger.U = z.vorrat.ger.T = 60;
  z.flotten.push({ id: z.naechsteId++, fraktion: 'ger', heimat: '1004', ort: '0204', staerke: 40, kap: 12, befehl: 'angriff', ziel: '0204', warte: 0, versorgung: 1, angriff: null });
  g.mission.events.clear && g.mission.events.clear();
  let n = 0;
  while (!g.weltsim.hauptweltGefallen && n++ < 12) Kriegslage.tick(g, 'sprung');
  ok(z.hexe['0204'].besitzer === 'ger' && g.weltsim.hauptweltGefallen && g.weltsim.hauptweltGefallen.fraktion === 'rom' && g.weltsim.hauptweltGefallen.tick === g.weltsim.tickZahl, 'Palatina gefallen: Merker { fraktion rom, tick }');
  const odas = t.events('oda').map((e) => e.text);
  ok(odas.includes('Palatina ist gefallen.'), 'Platzhalter-Meldung „Palatina ist gefallen.“');
  ok(g.mission.events.has('hauptwelt_gefallen'), 'Missionsereignis hauptwelt_gefallen');
  ok(g.phase === 'play' && g.errors === 0, 'das Spiel läuft weiter');
  ok(g.weltsim.ereignisse.some((e) => e.typ === 'hauptwelt_gefallen' && e.n === g.weltsim.tickZahl), 'Rohereignis im Ring des Servers');
  const b = Kriegslage.toSave(g);
  ok(b.hauptweltGefallen && b.hauptweltGefallen.fraktion === 'rom', 'Merker im Block');
  const g2 = { C: g.C, ship: g.ship, space: g.space, mission: g.mission, oda() {}, missionEvent() {}, countError() {}, seed: 1 };
  Kriegslage.restore(g2, JSON.parse(JSON.stringify(b)));
  ok(g2.weltsim && g2.weltsim.hauptweltGefallen && g2.weltsim.hauptweltGefallen.tick === g.weltsim.tickZahl, 'Merker überlebt Speichern und Laden');
  // Hrafnheim: nur Ereignis und Meldung, kein Merker
  const t2 = setup(freshDir(), 'freie_fahrt'); const h = t2.g;
  t2.start();
  z = h.weltsim.zustand;
  z.flotten = z.flotten.filter((fl) => !(fl.fraktion === 'ger' && fl.ort === '1004'));
  z.vorrat.rom.U = z.vorrat.rom.T = 60;
  z.flotten.push({ id: z.naechsteId++, fraktion: 'rom', heimat: '0204', ort: '1004', staerke: 40, kap: 12, befehl: 'angriff', ziel: '1004', warte: 0, versorgung: 1, angriff: null });
  n = 0;
  while (!t2.events('oda').some((e) => e.text === 'Hrafnheim ist gefallen.') && n++ < 12) Kriegslage.tick(h, 'sprung');
  ok(t2.events('oda').some((e) => e.text === 'Hrafnheim ist gefallen.') && h.weltsim.hauptweltGefallen === null && h.mission.events.has('hauptwelt_gefallen'), 'Hrafnheim: Meldung und Ereignis, kein Merker');
}

// =============================================================================================================================
section('dockOk nach dem Laden mitten in einer Szene');
{
  const t = setup(freshDir(), 'freie_fahrt'); const g = t.g;
  t.start();
  Space.enterScene(g, 'vulcania', {});   // Schiff steht in Vulcania, nicht angedockt
  ok(g.space.dockOk === true && g.space.markers.some((m) => m.kind === 'dock'), 'Vulcania: andockbar, Dock-Marker');
  const b = JSON.parse(JSON.stringify(Kriegslage.toSave(g)));
  b.zustand.hexe['0205'].besitzer = 'ger';
  Kriegslage.restore(g, b);
  ok(g.space.dockOk === false && !g.space.markers.some((m) => m.kind === 'dock') && g.space.markers.some((m) => m.fr === 'ger'), 'restore mitten in der Szene: dockOk neu berechnet (falsch), Dock-Marker weg, Banner ger');
  b.zustand.hexe['0205'].besitzer = 'rom';
  Kriegslage.restore(g, b);
  ok(g.space.dockOk === true && g.space.markers.some((m) => m.kind === 'dock'), 'wieder rom: dockOk wahr, Dock-Marker da');
  // Notfallsprung in denselben Sektor, Besitz wechselt im Tick: Szene zieht nach
  g.weltsim.zustand.hexe['0205'].besitzer = 'ger';
  Kriegslage.tick(g, 'notsprung'); Kriegslage.szeneNachziehen(g);
  ok(g.space.dockOk === false, 'szeneNachziehen nach einem Tick ohne Szenenwechsel');
}

console.log(`\n${n - fails}/${n} Prüfungen ok`);
try { fs.rmSync(ROOT_TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
process.exit(fails ? 1 : 0);
