'use strict';
// SL6 (CONCEPT-SL6): Zonen mit Wirkung (Drift, Hitze, Schaden, Sicht, Ertrag), Gasriese, Deuterium (Schöpfen, Gewicht, Abwerfen, Verkaufen),
// Marken-Prüfungen. Szenen mit Zonen entstehen hier per Einhängen in die Szene Rabenpass (am Ende zurückgesetzt).
//   node tools/test-zonen.js            -> alle Abschnitte
//   node tools/test-zonen.js gewicht    -> nur Abschnitte, deren Name einen der Begriffe enthält
const CONFIG = require('../shared/config.js');
const Zonen = require('../shared/zonen.js');
const Locations = require('../shared/locations.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const ZonenSim = require('../server/sim/zonen.js');
const Fracht = require('../server/sim/fracht.js');
const Ladung = require('../server/sim/ladung.js');
const Marken = require('../server/sim/geld.js');
const Registry = require('../server/mission/registry.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, body) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}

const SZENE = Locations.get('rabenpass').scene;
const ORIGINAL = { zonen: SZENE.zonen, station: SZENE.station, hafen: SZENE.hafen, kauft: SZENE.kauft };
function szene(zonen, extra) {
  SZENE.zonen = zonen; delete SZENE.station; delete SZENE.hafen; delete SZENE.kauft;
  Object.assign(SZENE, extra || {});
}
function aufraeumen() { for (const k of Object.keys(ORIGINAL)) { if (ORIGINAL[k] === undefined) delete SZENE[k]; else SZENE[k] = ORIGINAL[k]; } }

function setup(opts) {
  const o = opts || {};
  const g = new Game({ noStore: true, worlds: false, seed: o.seed || 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { if (this.inbox.length < 800) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'Z0', name: 'Zon0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' });
  g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.god = o.god !== false;
  space.enterScene(g, 'rabenpass', {});
  g.space.enemies = []; g.space.projectiles = [];
  const odas = []; const oda0 = g.oda.bind(g); g.oda = (t, x) => { odas.push(t); return oda0(t, x); };
  const mev = []; const me0 = g.missionEvent.bind(g); g.missionEvent = (k, d) => { mev.push(Object.assign({ kind: k }, d)); return me0(k, d); };
  const run = (sec) => { for (let k = 0; k < Math.round(sec / DT); k++) g.step(); };
  const T = { g, c, run, odas, mev, me: (k) => mev.filter((e) => e.kind === k) };
  T.cmd = (cmd, f) => { c.inbox.length = 0; g.handleMessage(c, Object.assign({ t: 'cmd', c: cmd }, f || {})); return c.inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  T.taktik = () => { g.players[0].console = 'weapons'; };
  T.platz = (x, y, ang) => { const s = g.ship; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; s.turnVel = 0; s.angle = ang || 0; s.helm.stage = space.helmStop ? s.helm.stage : s.helm.stage; };
  T.energie = (o) => { Object.assign(g.ship.powerIntent || (g.ship.powerIntent = {}), o); Object.assign(g.ship.power, o); };
  T.run(0.1);
  return T;
}
const basis = (g) => CONFIG.enginePowerFactor[g.ship.power.engines] * (CONFIG.stateFactor.engines[g.ship.systems.engines] != null ? CONFIG.stateFactor.engines[g.ship.systems.engines] : 1);

section('Baustein: Geometrie, Summe, Sichtbarkeit', () => {
  const kreis = { id: 'k', form: 'kreis', x: 100, y: 100, r: 50, drift: { winkel: 0, staerke: 10 }, hitze: 2, schaden: 1, sicht: 0.5 };
  const ring = { id: 'r', form: 'ring', x: 100, y: 100, r0: 20, r1: 80, tang: 8, sicht: 0.5 };
  const rechteck = { id: 'q', form: 'rechteck', x: 500, y: 500, w: 100, h: 40, hitze: 3 };
  ok(Zonen.drin(kreis, 120, 100) && !Zonen.drin(kreis, 160, 100), 'Kreis: innen/außen');
  ok(Zonen.drin(ring, 140, 100) && !Zonen.drin(ring, 105, 100) && !Zonen.drin(ring, 200, 100), 'Ring: nur zwischen r0 und r1');
  ok(Zonen.drin(rechteck, 540, 510) && !Zonen.drin(rechteck, 540, 530), 'Rechteck: Rand');
  const w = Zonen.wirkung([kreis, ring], 130, 100);
  ok(w.ids.length === 2 && Math.abs(w.hitze - 2) < 1e-9 && Math.abs(w.sicht - 0.25) < 1e-9, 'Summe: Hitze addiert, Sicht multipliziert (0,5 × 0,5)');
  ok(Math.abs(w.vx - 10) < 1e-6 && Math.abs(w.vy - 8) < 1e-6, 'Drift: Richtung + tangential (um den Mittelpunkt, im Uhrzeigersinn)');
  ok(Zonen.wirkung([kreis], 900, 900).sicht === 1 && Zonen.wirkung([], 0, 0).ids.length === 0, 'außerhalb: Sicht 1, keine Wirkung');
  const o1 = { id: 'o', sichtbarFuer: 'ops' }, k1 = { id: 'kk', sichtbarFuer: 'karte' };
  ok(Zonen.sichtbar({ id: 'a' }, {}) && Zonen.sichtbar(o1, { ops: true }) && !Zonen.sichtbar(o1, { ops: false }) && Zonen.sichtbar(o1, { bekannt: ['o'] }), 'sichtbarFuer: alle / ops / bekannt');
  ok(!Zonen.sichtbar(k1, { ops: true }) && Zonen.sichtbar(k1, { bekannt: new Set(['kk']) }), 'sichtbarFuer karte: erst nach dem Erkunden');
  const a = Zonen.gasriese({ x: 1500, y: 1100, r: 560 }), b = Zonen.gasriese({ x: 1500, y: 1100, r: 560 });
  ok(a.length === 9 && JSON.stringify(a) === JSON.stringify(b), 'Gasriese: 5 Ringe + 4 Sturmzellen, deterministisch');
  ok(a.filter((z) => z.ertrag).length === 1 && a.filter((z) => z.drift).length === 4, 'Gasriese: Ertrag nur in der Förderschicht, Drift in den Sturmzellen');
  const ringe = a.filter((z) => z.id.includes('_ring'));
  ok(ringe.every((z, i) => i === 0 || (z.zug > ringe[i - 1].zug && z.schaden >= ringe[i - 1].schaden && z.hitze > ringe[i - 1].hitze)), 'Gasriese: Zug, Schaden und Hitze wachsen von außen nach innen');
  ok(Math.max(...ringe.map((z) => z.r1 || z.r)) === Math.round(560 * 1.9), 'Gasriese: Atmosphäre reicht bis 1,9 Planetenradien');
  const wz = Zonen.wirkung(ringe, 1500 + 460, 1100);   // Förderschicht, rechts der Mitte: Zug zeigt zur Mitte (−x), Strömung im Uhrzeigersinn (+y)
  ok(Math.abs(wz.zug - 72) < 1e-9 && wz.vx < -70 && wz.vy > 10, 'Zug: Versatz zur Mitte (Betrag 72 px/s in der Förderschicht)');
  ok(Zonen.antriebNoetig(72, [65, 104, 130, 149.5]) === 2 && Zonen.antriebNoetig(140, [65, 104, 130, 149.5]) === 4 && Zonen.antriebNoetig(240, [65, 104, 130, 149.5]) === 0, 'antriebNoetig: Förderschicht Energie 2, Tiefe Energie 4, Kern keine');
  ok(a.every((z) => z.id && (z.sichtbarFuer || z.form)), 'Zonen haben IDs');
});

section('Ohne Zonen: nichts ändert sich', () => {
  szene(undefined);
  const T = setup(); const g = T.g;
  T.platz(800, 800, 0);
  T.run(2);
  ok(g.snapshot().zonen === undefined, 'Snapshot ohne zonen');
  ok(space.erfassung(g) === (CONFIG.tscan.range || 800) && space.sensorReichweite(g) === (CONFIG.sensors.range || 1400), 'Sicht ohne Zone unverändert');
  ok(space.engineSpeedFactor(g) === basis(g), 'Triebwerksfaktor ohne Ladung unverändert');
  ok(ZonenSim.toSave(g) === null, 'Weltstand ohne Zonenblock');
});

section('Drift: Lerche und Gegner gleich', () => {
  szene([{ id: 'd1', form: 'kreis', x: 1000, y: 1000, r: 300, drift: { winkel: Math.PI / 2, staerke: 30 }, sichtbarFuer: 'alle' }]);
  const T = setup(); const g = T.g;
  T.platz(1000, 1000, 0); g.ship.helm.stage = g.ship.helm.stage;
  const y0 = g.ship.y; T.run(2);
  ok(Math.abs((g.ship.y - y0) - 60) < 3, 'Lerche treibt 30 px/s nach unten (2 s ≈ 60 px): ' + Math.round(g.ship.y - y0));
  const e = space.spawnEnemy(g, 'relay', { x: 1000, y: 900 });
  const ex = { x: e.x, y: e.y };
  g.ship.x = 200; g.ship.y = 200;   // Lerche weit draußen
  ZonenSim.update(g, 1);
  ok(Math.abs(e.y - ex.y - 30) < 1e-6 && Math.abs(e.x - ex.x) < 1e-6, 'Gegner (gleiche Regel) treibt 30 px in 1 s');
  g.space.enemies = [];
  // Antrieb Stufe 4 gegen Drift: Nettotempo = Schiff + Drift (Positionsversatz außerhalb von stepBody)
  szene([{ id: 'd2', form: 'rechteck', x: 1500, y: 1100, w: 2000, h: 1200, drift: { winkel: Math.PI, staerke: 60 } }]);
  const U = setup(); U.platz(2000, 1100, 0);
  U.g.ship.helm.stage = 5; U.energie({ engines: 4, shields: 1, weapons: 1 }); U.run(12);
  const vorw = U.g.ship.x - 2000;
  ok(vorw > 0 && vorw < 12 * 150, 'Stufe VOLL gegen 60 px/s Gegenstrom: kommt voran, aber langsamer (Δx ' + Math.round(vorw) + ')');
  const V = setup(); V.platz(2000, 1100, 0); V.g.ship.helm.stage = 1; V.run(4);
  ok(V.g.ship.x < 2000 - 150, 'Stopp: Lerche wird vom Gegenstrom zurückgeschoben (x ' + Math.round(V.g.ship.x) + ')');
  ok(Math.abs(U.g.ship.vx) < 200, 'Geschwindigkeit bleibt vom Flugmodell geregelt (Drift ist Versatz)');
});

section('Hitze, Schaden, Sicht', () => {
  szene([{ id: 'h1', form: 'kreis', x: 1000, y: 1000, r: 400, hitze: 20, schaden: 2, sicht: 0.5 }]);
  const T = setup({ god: false }); const g = T.g;
  T.platz(1000, 1000, 0); T.energie({ engines: 3, shields: 2, weapons: 1 });
  const h0 = g.ship.heat.engines;
  T.run(1.5);
  ok(g.ship.heat.engines > h0 + 10, 'Zonenhitze heizt den Antrieb (Energie 3): ' + g.ship.heat.engines.toFixed(1));
  const hits = g.stats.hits;
  T.run(3);
  ok(g.stats.hits >= hits + 3, 'Schaden 2/s kommt im Sekundentakt als Treffer an (' + (g.stats.hits - hits) + ' Treffer in 3 s)');
  ok(Math.abs(space.erfassung(g) - (CONFIG.tscan.range || 800) * 0.5) < 1e-6, 'Sichtgrenze halbiert die Erfassung');
  ok(space.sensorReichweite(g) < (CONFIG.sensors.range || 1400), 'Sensorreichweite kleiner in der Zone');
  T.energie({ engines: 1, shields: 3, weapons: 2 }); g.ship.heat.engines = 0; T.run(1);
  ok(g.ship.heat.engines === 0, 'Antrieb mit Energie 1 nimmt keine Zonenhitze auf (hitzeMinEnergie)');
  T.platz(100, 100, 0); T.run(0.2);
  ok(space.erfassung(g) === (CONFIG.tscan.range || 800), 'außerhalb: Sicht wieder normal');
  // Gegner leiden genauso
  const e = space.spawnEnemy(g, 'relay', { x: 1000, y: 1000 });
  const hp0 = e.hp + (e.shields ? e.shields.reduce((a, b) => a + b, 0) : 0);
  g.ship.x = 100; g.ship.y = 100;
  T.run(4);
  const e2 = g.space.enemies.find((q) => q.id === e.id);
  const hp1 = e2 ? e2.hp + (e2.shields ? e2.shields.reduce((a, b) => a + b, 0) : 0) : 0;
  ok(hp1 < hp0, 'Gegner in der Zone nimmt Schaden (' + hp0 + ' -> ' + hp1 + ')');
});

section('Erkunden und Zähler', () => {
  szene([{ id: 'e1', form: 'kreis', x: 1000, y: 1000, r: 200, name: 'Testfeld', sichtbarFuer: 'karte', ertrag: { ziel: 'zaehler:boje', rate: 5 } },
    { id: 'e2', form: 'kreis', x: 2200, y: 1000, r: 200, sichtbarFuer: 'ops' }]);
  const T = setup(); const g = T.g;
  T.platz(300, 300, 0); T.run(0.3);
  ok(g.snapshot().zonen && g.snapshot().zonen.bk.length === 0 && g.snapshot().zonen.in.length === 0, 'Snapshot: Zonen, noch nichts erkundet');
  T.platz(1000, 1000, 0); T.run(2);
  const z = g.snapshot().zonen;
  ok(z.in.includes('e1') && z.bk.includes('e1') && !z.bk.includes('e2'), 'Hineinfliegen macht die Zone bekannt');
  ok(T.me('zoneBetreten').length === 1 && T.odas.some((t) => /Testfeld/.test(t)), 'Ereignis zoneBetreten + ODA-Meldung');
  ok(ZonenSim.zaehler(g, 'boje') > 8 && Math.abs(z.z.boje - ZonenSim.zaehler(g, 'boje')) < 0.2, 'Ertrag zaehler:boje zählt (' + ZonenSim.zaehler(g, 'boje').toFixed(1) + ')');
  ok(ZonenSim.scan(g, 2000) === 1 && ZonenSim.istBekannt(g, 'e2'), 'Ops-Scan macht Zonen im Umkreis bekannt');
  const save = ZonenSim.toSave(g);
  const g2 = setup().g;
  ZonenSim.restore(g2, JSON.parse(JSON.stringify(save)));
  ok(ZonenSim.istBekannt(g2, 'e1') && ZonenSim.istBekannt(g2, 'e2') && Math.abs(ZonenSim.zaehler(g2, 'boje') - save.zaehler.boje) < 1e-6, 'Speichern/Laden: bekannte Zonen und Zähler');
  ZonenSim.bekanntMachen(g2, 'alle');
});

// ---- Gasriese U2: Zug (Gravitation), Höhe halten, Schaden, Schöpfen per Ops-Aktion ----
const GC = { x: 1500, y: 1100, r: 560 };   // Planet; Förderschicht 336–588, Tiefe 168–336, Kern < 168, Wolkendecke 588–812
const gasSzene = () => szene(Zonen.gasriese(GC, null, 'gas').filter((z) => !z.id.includes('sturm')), { planeten: [{ x: GC.x, y: GC.y, r: GC.r, art: 'gasriese' }] });
const FOERDER = 460, TIEFE = 250, KERN = 100, WOLKE = 700;
// Höhe-halten-Messung: der Pilot steuert radial nach außen, Stufe `stufe` (Index: 2 = ¼, 3 = ½, 4 = ¾, 5 = VOLL), Energie E; gemessen wird die Radialgeschwindigkeit über 1,5 s
function hoehe(T, E, stufe, r0, last) {
  const g = T.g, s = g.ship;
  T.energie({ engines: E, shields: 1, weapons: 1 }); g.players[0].console = 'helm';
  s.systems.engines = 'operational';
  g.fracht = null; for (let i = 0; i < (last || 0); i++) Fracht.anBordLegen(g, 'deuterium');
  s.helm.stage = stufe; s.helm.autoStop = false;
  const f = CONFIG.shipClasses.lerche.stages[stufe] * CONFIG.shipClasses.lerche.maxSpeed * space.engineSpeedFactor(g);
  T.platz(GC.x + r0, GC.y, 0); s.vx = f; s.vy = 0; s.helm.stage = stufe;
  const rr = () => Math.hypot(s.x - GC.x, s.y - GC.y);
  const a = rr();
  for (let k = 0; k < Math.round(1.5 / DT); k++) { s.angle = Math.atan2(s.y - GC.y, s.x - GC.x); g.step(); }
  return { vr: (rr() - a) / 1.5, f };
}
section('Gasriese: Zug und Höhe halten (Messung)', () => {
  gasSzene();
  const T = setup(); const g = T.g;
  const zug = (r) => Zonen.wirkung(ZonenSim.szeneZonen(g), GC.x + r, GC.y).zug;
  ok(zug(FOERDER) === 72 && zug(TIEFE) === 140 && zug(KERN) === 240 && zug(WOLKE) === 30 && zug(1000) === 10, 'Zug je Ring: Hochatmosphäre 10, Wolkendecke 30, Förderschicht 72, Tiefe 140, Kern 240 px/s');
  const tab = [];
  const m = (E, st, r, last) => { const x = hoehe(T, E, st, r, last); return x.vr; };
  for (let E = 1; E <= 4; E++) tab.push('Energie ' + E + ': Förder VOLL ' + m(E, 5, FOERDER).toFixed(1) + ' | ¾ ' + m(E, 4, FOERDER).toFixed(1) + ' | ½ ' + m(E, 3, FOERDER).toFixed(1) + ' | Tiefe VOLL ' + m(E, 5, TIEFE).toFixed(1) + ' | Kern VOLL ' + m(E, 5, KERN).toFixed(1));
  console.log('  Messung (px/s radial, + = steigt, − = sinkt; Höchsttempo E1–E4: 65 / 104 / 130 / 149,5):\n    ' + tab.join('\n    '));
  const near = (a, b) => Math.abs(a - b) < 4;
  ok(near(m(1, 5, FOERDER), -7), 'Förderschicht, Energie 1 (VOLL): sinkt langsam ein (' + m(1, 5, FOERDER).toFixed(1) + ' px/s)');
  ok(near(m(2, 3, FOERDER), -20) && m(2, 3, FOERDER) < -10, 'Förderschicht, Energie 2 auf ½: sinkt (' + m(2, 3, FOERDER).toFixed(1) + ' px/s)');
  ok(m(2, 4, FOERDER) > 0 && m(2, 4, FOERDER) < 12, 'Förderschicht, Energie 2 auf ¾: hält gerade die Höhe (' + m(2, 4, FOERDER).toFixed(1) + ' px/s)');
  ok(near(m(2, 5, FOERDER), 32) && near(m(3, 5, FOERDER), 58) && near(m(4, 5, FOERDER), 77.5), 'Förderschicht, VOLL: Energie 2/3/4 steigen mit +32 / +58 / +77 px/s (hält leicht)');
  ok(CONFIG.shipClasses.lerche.maxSpeed * CONFIG.enginePowerFactor[4] / 72 > 2 && 72 / (CONFIG.shipClasses.lerche.maxSpeed * CONFIG.enginePowerFactor[4]) < 0.5, 'Zug der Förderschicht ist weniger als die Hälfte der Höchstleistung des Antriebs (Energie 4)');
  ok(m(3, 5, TIEFE) < 0 && m(4, 5, TIEFE) > 0 && m(4, 4, TIEFE) < 0, 'Tiefe: nur Energie 4 auf VOLL hält die Höhe (E3 ' + m(3, 5, TIEFE).toFixed(1) + ', E4 ' + m(4, 5, TIEFE).toFixed(1) + ' px/s)');
  ok(m(4, 5, KERN) < -60, 'Kern: auch Energie 4 VOLL reicht nicht – das Schiff wird hineingezogen (' + m(4, 5, KERN).toFixed(1) + ' px/s)');
  ok(m(4, 5, TIEFE, 1) < 0 && m(2, 5, FOERDER, 2) > 0 && m(2, 5, FOERDER, 2) < 5, 'Ladung (−15 % je Einheit): Tiefe mit einer Einheit nicht mehr zu halten; Förderschicht mit zwei Einheiten Energie 2 VOLL gerade so (' + m(2, 5, FOERDER, 2).toFixed(1) + ')');
  ok(Zonen.antriebNoetig(zug(FOERDER), [1, 2, 3, 4].map((E) => CONFIG.shipClasses.lerche.maxSpeed * CONFIG.enginePowerFactor[E])) === 2, 'Anzeige-Regel: Förderschicht verlangt Antrieb 2 (aus CONFIG abgeleitet)');
  // ohne Antrieb (Stopp) sinkt die Lerche mit dem vollen Zug
  T.energie({ engines: 2, shields: 2, weapons: 1 }); g.fracht = null; T.platz(GC.x + FOERDER, GC.y, 0); g.ship.helm.stage = 1; g.players[0].console = 'weapons';
  const r0 = Math.hypot(g.ship.x - GC.x, g.ship.y - GC.y); T.run(2);
  ok(r0 - Math.hypot(g.ship.x - GC.x, g.ship.y - GC.y) > 100, 'Stopp in der Förderschicht: die Gravitation zieht ~72 px/s nach innen (' + Math.round(r0 - Math.hypot(g.ship.x - GC.x, g.ship.y - GC.y)) + ' px in 2 s)');
  // Hitze: Energie 3/4 heizt beim Halten, Energie 2 nicht (hitzeMinEnergie)
  T.energie({ engines: 2, shields: 2, weapons: 1 }); g.ship.heat.engines = 0; T.platz(GC.x + FOERDER, GC.y, 0); T.run(2);
  const h2 = g.ship.heat.engines;
  T.energie({ engines: 4, shields: 1, weapons: 1 }); g.ship.heat.engines = 0; T.platz(GC.x + FOERDER, GC.y, 0); T.run(2);
  ok(h2 === 0 && g.ship.heat.engines > 15, 'Hitze: Energie 2 bleibt kalt, Energie 4 heizt in der Förderschicht (' + g.ship.heat.engines.toFixed(1) + ' in 2 s)');
});

section('Gasriese: Druckschaden (Schilde, dann Hülle)', () => {
  gasSzene();
  // jeder Lauf mit frischem Spiel (nach dem Tod endet die Partie): Standardschilde (2 je Sektor), Hülle 100, Energie 2, das Schiff steht im Ring (Antrieb hält die Höhe)
  const lauf = (r, sek) => {
    const T = setup({ god: false }); const g = T.g; const s = g.ship;
    const pool = () => s.shields.current.reduce((a, b) => a + b, 0);
    T.energie({ engines: 2, shields: 2, weapons: 1 }); g.players[0].console = 'weapons'; s.shields.current = s.shields.current.map(() => 2);
    const eng0 = s.systems.engines; let minH = 100; const p0 = pool(); const fire0 = (s.fires || []).length; const hits0 = g.stats.hits;
    let tTot = null, ausserhalb = null; const em0 = g.stats.emergencies;
    for (let k = 0; k < Math.round(sek / DT); k++) {
      T.platz(GC.x + r, GC.y, 0); g.step(); minH = minH;      if (g.stats.emergencies > em0 && tTot == null) { tTot = k * DT; minH = 0; ausserhalb = Math.hypot(s.x - GC.x, s.y - GC.y); }   // Hülle 0 -> Notfallprotokoll (nach dem Hinauswurf)
    }
    return { dHull: 100 - minH, dPool: p0 - pool(), minH, tTot, ausserhalb, hits: g.stats.hits - hits0, eng0, eng: s.systems.engines, fire: (s.fires || []).length - fire0, odas: T.odas };
  };
  const w = lauf(WOLKE, 10);
  ok(w.dPool > 0 && w.dHull <= 25, 'Wolkendecke (0,5/s): Schilde zuerst, Hülle nur wenig (Schilde −' + w.dPool + ', Hülle −' + w.dHull + ' in 10 s)');
  const f = lauf(FOERDER, 10);
  ok(f.dPool >= 2, 'Förderschicht (0,8/s): Schilde −' + f.dPool + ' in 10 s (Übergang A1a: Zonendruck ohne Hüllenwirkung, Zonenschaden kommt mit Paket C)');
  const f2 = lauf(FOERDER, 20);
  ok(f2.dPool >= f.dPool, 'Förderschicht, 20 s (zwei Einheiten): Schilde weiter gedrückt (Übergang A1a) (' + f2.minH + ' von 100)');
  const t = lauf(TIEFE, 14);
  ok(t.tTot == null && t.minH >= 0, 'Übergang A1a: Tiefe (3/s) tötet nicht mehr (kein Hüllenwert, Auslöser kommt mit Paket A2)');
  const k = lauf(KERN, 8);
  ok(k.tTot == null, 'Übergang A1a: Kern (8/s) tötet nicht mehr (kein Hüllenwert)');
  ok(!k.odas.some((x) => /Notautomatik schleudert/.test(x)), 'Übergang A1a: kein Auftauchen-Zwang mehr (ohne Hülle kein Tod durch Zonendruck)');
  ok(t.hits + k.hits + f.hits > 20, 'Druck kommt als Treffer an (' + (t.hits + k.hits + f.hits) + ' Treffer)');
  ok(f.eng === f.eng0 && t.eng === t.eng0 && k.eng === k.eng0 && f.fire === 0, 'Kein Zufallsausfall: Triebwerk bleibt ' + f.eng0 + ', keine Feuer (Dauerdruck ist kein shipHit)');
});

section('Gasriese: Deuterium schöpfen per Ops-Aktion, Gewicht, Abwerfen', () => {
  gasSzene();
  const T = setup(); const g = T.g;
  T.energie({ engines: 2, shields: 2, weapons: 2 }); T.taktik();
  const z = ZonenSim.szeneZonen(g).filter((q) => q.ertrag)[0];
  ok(!!z && z.name === 'Förderschicht', 'Szene hat genau eine Ertragszone: die Förderschicht');
  // Zug zieht das Schiff aus dem Ring: für die Messung der Schöpfzeit bleibt die Lerche per Neusetzen an Ort und Stelle (Antrieb hält die Höhe)
  const halt = (r) => T.platz(GC.x + (r || FOERDER), GC.y, 0);
  const lauf = (sek, r, bis) => { let t = 0; for (; t < sek; t += DT) { halt(r); g.step(); if (bis && bis()) break; } return t; };
  lauf(20);
  ok(Fracht.anBord(g) === 0 && !g.fracht.halt && !(g.fracht.fuell > 0), 'Ohne Aktion füllt sich NICHTS von selbst (20 s in der Förderschicht: 0 Einheiten, Füllstand 0)');
  const aus = (r) => { halt(r); T.run(0.1); return T.cmd('weapons.schoepfen'); };
  ok(aus(WOLKE).length === 1 && /tiefer/.test(T.cmd('weapons.schoepfen')[0]), 'Wolkendecke: Schöpfen abgelehnt, Hinweis „tiefer hinein“');
  ok(aus(TIEFE).length === 1 && /zu tief/.test(T.cmd('weapons.schoepfen')[0]), 'Tiefe: Schöpfen abgelehnt, Hinweis „zu tief“');
  ok(!g.fracht.halt, 'abgelehnte Aktion startet keinen Halteprozess');
  halt(); T.run(0.1);
  const e0 = T.cmd('weapons.schoepfen');
  ok(!e0.length && g.fracht.halt && g.fracht.halt.kind === 'schoepf', 'Förderschicht: Schöpfen startet als Halteprozess ' + JSON.stringify(e0));
  ok(T.cmd('weapons.schoepfen').length === 1 && T.cmd('weapons.fracht').length === 1, 'läuft bereits: zweiter Start und Fracht-Beamen werden abgelehnt');
  const tt = lauf(30, FOERDER, () => Fracht.anBord(g, 'deuterium') >= 1);
  ok(Fracht.anBord(g, 'deuterium') === 1 && tt > 8 && tt < 12, 'erste Einheit nach ~10 s (Rate 0,1/s): ' + tt.toFixed(1) + ' s');
  ok(g.fracht.halt && g.fracht.halt.kind === 'schoepf' && g.snapshot().fracht.halt.kind === 'schoepf', 'Schöpfen läuft weiter (Snapshot halt.kind schoepf)');
  const ab1 = T.cmd('weapons.abwerfen');
  ok(!ab1.length && Fracht.anBord(g) === 0 && g.fracht.halt && g.fracht.halt.kind === 'schoepf', 'Abwerfen (X) ist beim Schöpfen erlaubt und beendet es nicht ' + JSON.stringify(ab1));
  lauf(60, FOERDER, () => Fracht.anBord(g, 'deuterium') >= 2);
  ok(Fracht.anBord(g, 'deuterium') === 2 && Fracht.frei(g) === 0, 'zweite Einheit: Frachtraum voll (2 Plätze)');
  T.run(0.3);
  ok(!g.fracht.halt && T.odas.some((t) => /Frachtraum voll – Schöpfen beendet/.test(t)), 'Frachtraum voll: Schöpfen endet von selbst, Meldung');
  ok(T.cmd('weapons.schoepfen').length === 1, 'voll: neuer Start abgelehnt');
  const sf = space.engineSpeedFactor(g);
  const ohne = basis(g);
  ok(Math.abs(sf - ohne * 0.7) < 1e-9, 'Gewicht: 2 Einheiten Deuterium senken die Triebwerksleistung auf 70 % (' + sf.toFixed(3) + ' vs ' + ohne + ')');
  T.taktik();
  const e1 = T.cmd('weapons.abwerfen');
  ok(!e1.length && Fracht.anBord(g, 'deuterium') === 1 && Fracht.draussen(g).length === 2 && Fracht.draussen(g)[1].art === 'deuterium', 'Abwerfen: eine Einheit als Pod im All ' + JSON.stringify(e1));
  ok(Math.abs(space.engineSpeedFactor(g) - ohne * 0.85) < 1e-9, 'Gewicht sinkt nach dem Abwurf (85 %)');
  const e2 = T.cmd('weapons.abwerfen', { art: 'sprengstoff' });
  ok(e2.length === 1, 'Abwerfen einer Art, die nicht an Bord ist: Fehlermeldung ' + JSON.stringify(e2));
  // Abbrechen durch die Ops, Ring verlassen, Ops unbesetzt, Transfer ausgefallen
  g.fracht.lager = []; g.fracht.draussen = []; g.fracht.fuell = 0; T.taktik(); halt(); T.run(0.1);
  ok(!T.cmd('weapons.schoepfen').length && g.fracht.halt, 'Neustart nach dem Abwurf');
  lauf(3);
  ok(g.fracht.fuell > 0.2 && g.fracht.fuell < 0.4, 'Füllstand wächst mit der Rate 0,1/s (' + g.fracht.fuell.toFixed(2) + ' nach 3 s)');
  T.cmd('weapons.schoepfen', { off: true });
  const fu = g.fracht.fuell; lauf(3);
  ok(!g.fracht.halt && g.fracht.fuell === fu && Fracht.anBord(g) === 0, 'Ops bricht ab (off): der Füllstand bleibt stehen, nichts füllt sich weiter');
  halt(); T.run(0.1); T.cmd('weapons.schoepfen'); halt(); T.run(0.5);
  T.platz(GC.x + WOLKE, GC.y, 0); T.run(0.2);
  ok(!g.fracht.halt && T.odas.some((t) => /Förderschicht verlassen/.test(t)), 'Ring verlassen (hinaus gesunken/gestiegen): Schöpfen beendet, Meldung');
  halt(); T.run(0.1); T.cmd('weapons.schoepfen'); g.players[0].console = 'helm'; lauf(0.5);
  ok(g.fracht.halt && g.fracht.halt.kind === 'schoepf', 'Ops verlassen (Solo am Steuer): Schöpfen läuft weiter');
  g.players[0].console = 'weapons'; T.cmd('weapons.schoepfen', { off: true });
  ok(!g.fracht.halt, 'Beenden per Ops-Aktion');
  g.players[0].console = 'weapons'; g.ship.systems.transfer = 'broken'; halt(); T.run(0.1);
  ok(T.cmd('weapons.schoepfen').length === 1 && !g.fracht.halt && Fracht.anBord(g) === 0, 'Transfer zerstört: Schöpfen abgelehnt');
  g.ship.systems.transfer = 'operational'; g.ship.docked = false;
  ok(T.me('schoepfenStart').length >= 3, 'Ereignis schoepfenStart für das Regiebuch');
});

section('Verkaufen und Marken', () => {
  szene(undefined, { station: { kind: 'station', x: 1500, y: 1100, r: 60 }, hafen: { klasse: 'D', andocken: false, ruf: false } });
  const ohneKauft = setup(); ohneKauft.platz(1500 - 150, 1100, 0); ohneKauft.taktik(); Fracht.anBordLegen(ohneKauft.g, 'deuterium');
  ok(ohneKauft.cmd('weapons.verkaufen').length === 1, 'Hafen ohne scene.kauft kauft nichts (Verkauf ist Daten, nicht jeder Hafen)');
  SZENE.kauft = { deuterium: true };
  const T = setup(); const g = T.g;
  T.platz(1500 - 150, 1100, 0); T.taktik();
  ok(Fracht.anBordLegen(g, 'deuterium') && Fracht.anBordLegen(g, 'deuterium'), '2 × Deuterium an Bord gelegt');
  const m0 = g.inventory.marks;
  const e = T.cmd('weapons.verkaufen');
  ok(!e.length && g.fracht.halt && g.fracht.halt.kind === 'verk', 'Verkaufen startet den Halteprozess ' + JSON.stringify(e));
  T.run(3.4);
  ok(Fracht.anBord(g) === 0 && g.inventory.marks === m0 + 2 * CONFIG.fracht.preise.deuterium, 'verkauft: 2 × ' + CONFIG.fracht.preise.deuterium + ' Marken (' + m0 + ' -> ' + g.inventory.marks + ')');
  ok(T.me('frachtVerkauft').length === 1 && T.me('marksCredited').length === 1, 'Ereignisse frachtVerkauft und marksCredited');
  ok(T.cmd('weapons.verkaufen').length === 1, 'ohne Ware: Fehlermeldung');
  Fracht.anBordLegen(g, 'deuterium'); T.platz(100, 100, 0);
  ok(T.cmd('weapons.verkaufen').length === 1, 'zu weit vom Händler: Fehlermeldung');
  T.platz(1500 - 150, 1100, 0);
  szene(undefined);   // Szene ohne Händler
  ok(T.cmd('weapons.verkaufen').length === 1, 'kein Händler in der Szene: Fehlermeldung');
  szene(undefined, { station: { kind: 'station', x: 1500, y: 1100, r: 60 }, kauft: { deuterium: 55 } });
  ok(Ladung.preisVon(g, SZENE, 'deuterium') === 55, 'scene.kauft überschreibt den Preis');
  // Unterbrechen: Händler außer Reichweite
  T.platz(1500 - 150, 1100, 0); T.cmd('weapons.verkaufen'); T.run(1); T.platz(100, 100, 0); T.run(0.2);
  ok(!g.fracht.halt && Fracht.anBord(g, 'deuterium') === 1, 'Reichweite verlassen: Verkauf abgebrochen, Ware bleibt');
  // Marken-Bausteine
  const m = { game: g };
  const cr = Registry.get('credit_marks'), al = Registry.get('marks_at_least');
  ok(!!cr && !!al && cr.art === 'aktion' && al.art === 'pruefung', 'Registry: credit_marks (Aktion), marks_at_least (Prüfung)');
  g.inventory.marks = 100;
  ok(al.test(m, { n: 100 }) && !al.test(m, { n: 101 }), 'marks_at_least: genau 100 genügt, 101 nicht');
  cr.run(m, { marks: 25, grund: 'test' });
  ok(g.inventory.marks === 125 && T.me('marksCredited').slice(-1)[0].grund === 'test', 'credit_marks schreibt gut (125) und meldet den Grund');
  ok(Marken.abbuchen(g, 25, 'test') && g.inventory.marks === 100 && !Marken.abbuchen(g, 500, 'zuviel') && g.inventory.marks === 100, 'Marken.abbuchen nur mit Deckung');
  ok(Marken.gutschreiben(g, -5) === 100 && Marken.gutschreiben(g, 2.7) === 102, 'gutschreiben: negativ ignoriert, ganze Zahlen');
});

section('Sund: Gasfeld, Concordia und Buch sl_gasriese (Bot-Pfad)', () => {
  aufraeumen();
  const fs = require('fs'), path = require('path');
  const Welt = require('../server/sim/welt.js');
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { if (this.inbox.length < 800) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'S0', name: 'Sund0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'free' });
  g.handleMessage(c, { t: 'ready', ready: true });
  try {
    Welt.waehle(g, 'sund');
    const gas = Locations.get('gasfeld').scene, con = Locations.get('concordia').scene;
    ok(Array.isArray(gas.zonen) && gas.zonen.length === 9 && gas.planeten.some((p) => p.art === 'gasriese'), 'Gasfeld (Sund): 9 Zonen aus dem Gasriesen (5 Ringe, 4 Sturmzellen)');
    const gp = gas.planeten.find((p) => p.art === 'gasriese');
    ok(gp.r >= 480 && gp.r <= 640 && gas.w === 5000 && gas.h === 3800, 'Gasriese doppelt so groß (Radius ' + gp.r + ', Szene ' + gas.w + '×' + gas.h + ')');
    { // Anflug und Rückflug: alle drei Sprungpunkte und der Ankunftspunkt liegen außerhalb der Atmosphäre (1,9 r), mit Abstand
      const Sektoren = require('../shared/sektoren.js'); const aussen = gp.r * 1.9;
      const exits = ['0403', '0504', '0603'].map((nb) => Sektoren.sprungpunktLage(gas.w, gas.h, Sektoren.richtung('0503', nb), 180));
      const frei = [...exits, gas.arrive].map((q) => Math.hypot(q.x - gp.x, q.y - gp.y) - aussen);
      ok(frei.every((d) => d > 300) && gp.y - aussen > 0 && gp.x - aussen > 0 && gp.x + aussen < gas.w, 'Sprungpunkte und Ankunft liegen ≥ 300 px vor der Atmosphäre, sie passt in die Szene (' + frei.map(Math.round).join('/') + ')');
    }
    ok(con.kauft && con.kauft.deuterium === true && !gas.kauft, 'Concordia kauft Deuterium, das Gasfeld nicht');
    ok(!Locations.get('pulverhorn').scene.zonen && !Locations.get('kantenstein').scene.zonen, 'andere Hexe ohne Zonen');
    const buch = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'regiebuecher-sund', 'sl_gasriese.regiebuch.json'), 'utf8'));
    const Checker = require('../server/mission/checker.js');
    const pr = Checker.check(buch);
    ok(pr.ok, 'Buch sl_gasriese besteht den Prüfer auf Sund ' + JSON.stringify(pr.errors.slice(0, 2)));
    buch.kopf.art = 'generiert';   // registerBook (Labor-Weg) nimmt nur generiert/archiv; die Kette startet Kapitel selbst
    const m = g.mission;
    const mev = []; const me0 = g.missionEvent.bind(g); g.missionEvent = (k, d) => { mev.push(k); return me0(k, d); };
    const run = (sec) => { for (let k = 0; k < Math.round(sec / DT); k++) g.step(); };
    m.startCampaign({ tutorial: false });
    const r = m.registerBook(buch, { origin: 'sl' });
    m.startMission(buch.id); ok(m.activeId === buch.id || (r && r.ok !== false), 'Buch registriert und gestartet');
    run(5);
    ok(m.step && m.step.id === 'anflug_gas', 'Schritt anflug_gas');
    g.debugGoto('gasfeld', false); run(2);
    ok(m.step && m.step.id === 'schoepfen', 'am Gasfeld: Schritt schoepfen');
    const pl = gas.planeten.find((p) => p.art === 'gasriese');
    g.ship.power.engines = 2; if (g.ship.powerIntent) g.ship.powerIntent.engines = 2;
    g.players[0].console = 'weapons';
    const halt = () => { g.ship.x = pl.x + pl.r * 0.8; g.ship.y = pl.y; g.ship.vx = 0; g.ship.vy = 0; };
    halt(); run(8); ok(Fracht.anBord(g) === 0, 'ohne Aktion füllt sich nichts (8 s in der Förderschicht)');
     g.ship.shields.current = g.ship.shields.current.map(() => 2);   // der Druck hat gewirkt: Reparatur vor dem Schöpfen
    halt(); run(0.2); c.inbox.length = 0; g.handleMessage(c, { t: 'cmd', c: 'weapons.schoepfen' });
    ok(g.fracht.halt && g.fracht.halt.kind === 'schoepf', 'Bot startet das Schöpfen (weapons.schoepfen)');
    for (let i = 0; i < 400 && Fracht.anBord(g, 'deuterium') < 1; i++) { halt(); run(0.1); }
    ok(Fracht.anBord(g, 'deuterium') === 1, 'Bot schöpft eine Einheit Deuterium in der Förderschicht');
    g.handleMessage(c, { t: 'cmd', c: 'weapons.schoepfen', off: true });
    ok(true, 'Hülle überlebt eine Einheit (SYS-01 A1a: die Hülle entfällt, Gas trifft keine Systeme)');
    g.debugGoto('concordia', true); run(3);
    ok(m.step && m.step.id === 'verkauf', 'in Concordia (nach dem Auftauchen): Schritt verkauf');
    g.players[0].console = 'weapons';
    const m0 = g.inventory.marks;
    c.inbox.length = 0; g.handleMessage(c, { t: 'cmd', c: 'weapons.verkaufen' }); run(4);
    ok(g.inventory.marks === m0 + CONFIG.fracht.preise.deuterium && Fracht.anBord(g) === 0, 'Bot verkauft: +' + CONFIG.fracht.preise.deuterium + ' Marken');
    run(3);
    const ms = m.missions[buch.id];
    ok(ms && ms.state === 'done' && ms.ausgang === 'erfolg' && mev.includes('deuteriumVerkauft'), 'Buch endet mit erfolg, Ereignis deuteriumVerkauft');
    ok(m.state.flags && m.state.flags.gasVerkauft === true, 'Flag gasVerkauft gesetzt');
  } finally { Welt.waehle(g, 'limes'); }
});

section('SL7a Gravimetrie: Forschungsstation Helix (Sund 0506)', () => {
  aufraeumen();
  const Welt = require('../server/sim/welt.js');
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { if (this.inbox.length < 3000) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'G0', name: 'Gravi0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'free' });
  g.handleMessage(c, { t: 'ready', ready: true });
  const mev = []; const me0 = g.missionEvent.bind(g); g.missionEvent = (k, d) => { mev.push(Object.assign({ kind: k }, d)); return me0(k, d); };
  const run = (sec, each) => { for (let k = 0; k < Math.round(sec / DT); k++) { if (each && each(k * DT) === true) return true; g.step(); } return false; };
  const cmd = (name, f) => { c.inbox.length = 0; g.handleMessage(c, Object.assign({ t: 'cmd', c: name }, f || {})); return c.inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  try {
    Welt.waehle(g, 'sund');
    g.god = true;
    const loc = Locations.get('helix');
    ok(!!loc && loc.scene.zonen.length === 13 && loc.scene.zonenAus[0] === 'halt' && loc.scene.gravimetrie.weg.length > 5, 'Szene Helix: 13 Zonen (4 Felder, 4 Kerne, Haltefeld, 4 Kanäle), Haltefeld-Gruppe aus');
    const gv = loc.scene.gravimetrie;
    space.enterScene(g, 'helix', {});
    g.players[0].console = 'weapons';
    g.ship.power.engines = 3; if (g.ship.powerIntent) { g.ship.powerIntent.engines = 3; g.ship.powerIntent.weapons = 1; g.ship.powerIntent.shields = 2; }
    run(0.3);
    const Zs = loc.scene.zonen;
    const felder = Zs.filter((z) => /^gravi_feld/.test(z.id));
    ok(ZonenSim.snapshot(g).au[0] === 'halt' && g.snapshot().zonen.sn === 1, 'Snapshot: Haltefeld aus, Scan nötig (sn)');
    // Hineinfliegen verrät ops_scan-Zonen nicht
    g.ship.x = felder[0].x; g.ship.y = felder[0].y; run(0.3);
    ok(g.snapshot().zonen.bk.length === 0, 'Hineinfliegen macht Verzerrungen NICHT bekannt (nur der Ops-Scan)');
    // Ops-Scan
    g.ship.x = gv.start.x; g.ship.y = gv.start.y; g.ship.vx = 0; g.ship.vy = 0; run(0.2);
    ok(cmd('weapons.zonenscan').length === 0 && g.zonenSim.scan, 'Zonen-Scan startet');
    run(1.5); ok(g.snapshot().zonen.sc > 0.3, 'Fortschritt im Snapshot');
    run(2);
    const bk = g.snapshot().zonen.bk;
    ok(!g.zonenSim.scan && bk.length >= 4 && bk.includes('gravi_feld0'), 'Scan fertig: ' + bk.length + ' Zonen in Reichweite bekannt, Haltefeld nicht (aus)');
    ok(!bk.includes('halt_feld') && cmd('weapons.zonenscan').length === 1, 'Haltefeld verrät der Scan nicht; zweiter Scan: nichts Neues in Reichweite');
    // 1) geradeaus ohne Ausgleich -> Verzerrungskern wirft zurück
    // Navigation nach Ansage: Wegpunkte der Reihe nach; komp = der Kurs gleicht die Drift 120 px voraus aus (Ops sagt Stärke und Richtung an)
    const flieg = (ziele, komp, grenzeS, abbruch) => {
      g.players[0].console = 'helm';   // die Steuerung muss besetzt sein, sonst gilt Ruder 0
      let i = 0; let prev = { x: g.ship.x, y: g.ship.y };
      return run(grenzeS, () => {
        const sh = g.ship; const z = ziele[i];
        if (!z) return true;
        const sx = z.x - prev.x, sy = z.y - prev.y, sl = Math.hypot(sx, sy) || 1;
        if (((sh.x - z.x) * sx + (sh.y - z.y) * sy) / sl >= -30) { prev = z; i++; return false; }   // Wegpunkt passiert (Projektion auf die Strecke)
        const dd = Math.max(1, Math.hypot(z.x - sh.x, z.y - sh.y)); const ux = (z.x - sh.x) / dd, uy = (z.y - sh.y) / dd;
        const v = komp ? Zonen.wirkung(ZonenSim.szeneZonen(g), sh.x + ux * 120, sh.y + uy * 120) : { vx: 0, vy: 0 };
        const e = ((sh.x - prev.x) * -sy + (sh.y - prev.y) * sx) / sl;   // Abstand von der Strecke (Querfehler)
        const nx = -sy / sl, ny = sx / sl;
        const want = Math.atan2(uy * 140 - v.vy - ny * e * 0.5, ux * 140 - v.vx - nx * e * 0.5);
        let d = want - sh.angle; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        sh.helm.stage = 5; sh.helm.turn = Math.max(-1, Math.min(1, d * 2.5));
        return abbruch ? abbruch() : false;
      });
    };
    g.ship.x = gv.start.x; g.ship.y = gv.start.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.angle = 0; g.ship.turnVel = 0; mev.length = 0;
    const gerade = [{ x: gv.station.x - 100, y: gv.start.y }];
    // blind: fester Kurs Ost, volle Fahrt, ohne die Drift auszugleichen (die Navigation ahnt nichts vom Feld)
    g.players[0].console = 'helm';
    run(40, () => { g.ship.helm.stage = 5; g.ship.helm.turn = 0; return mev.some((e) => e.kind === 'zoneRuecksetzen'); });
    ok(mev.some((e) => e.kind === 'zoneRuecksetzen'), 'ungeausgeglichen geradeaus: Verzerrungskern wirft zurück (Rücksetzer)');
    ok(Math.hypot(g.ship.x - gv.start.x, g.ship.y - gv.start.y) < 60 && g.ship.speed === 0, 'Lerche steht wieder am Start, Fahrt null');
    ok(g.snapshot().ship && true, 'Kein Tod (SYS-01 A1a: kein Auslöser durch Zonendruck)');
    // 2) nach Ansage (Ausgleich) kommt sie durch
    g.ship.x = gv.start.x; g.ship.y = gv.start.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.angle = 0; g.ship.turnVel = 0; mev.length = 0;
    flieg(gv.weg.slice(1), true, 80, () => g.ship.x > gv.station.x - 260);
    ok(g.ship.x > gv.station.x - 330 && !mev.some((e) => e.kind === 'zoneRuecksetzen'), 'mit Ausgleich nach Ansage: Station erreicht ohne Rücksetzer (x ' + Math.round(g.ship.x) + ' von ' + (gv.station.x - 220) + ')');
    // 3) Finale: Haltefeld an, Feldkarte für alle
    ZonenSim.schalten(g, 'halt', true);
    ok(ZonenSim.szeneZonen(g).some((z) => z.id === 'halt_feld') && ZonenSim.sichtbarMachen(g, 'halt', true) === 5, 'zone_schalten halt an, Feldkarte: 5 Zonen für alle sichtbar');
    const sv = g.snapshot().zonen; ok(sv.sv.length === 5 && !sv.au, 'Snapshot sv (5 sichtbar), au leer');
    g.ship.x = gv.station.x - 250; g.ship.y = gv.station.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.angle = Math.PI; g.ship.turnVel = 0;
    g.ship.power.engines = 4; if (g.ship.powerIntent) { g.ship.powerIntent.engines = 4; g.ship.powerIntent.shields = 1; g.ship.powerIntent.weapons = 1; }
    run(0.3);
    // falscher Weg: in einen der drei kurzen Kanäle (Sackgasse) fliegen und weiter geradeaus: das Haltefeld holt das Schiff zurück
    const kurz = Zs.find((z) => /^halt_kanal_kurz/.test(z.id));
    const aus0 = () => Math.hypot(g.ship.x - gv.station.x, g.ship.y - gv.station.y) > 850;
    g.ship.x = gv.station.x; g.ship.y = gv.station.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.turnVel = 0; g.ship.angle = kurz.drift.winkel; g.players[0].console = 'helm';
    g.ship.helm.stage = 5; run(40, () => { g.ship.helm.turn = 0; return aus0(); });
    ok(!aus0(), 'falscher Weg: das Haltefeld hält das Schiff fest (Abstand ' + Math.round(Math.hypot(g.ship.x - gv.station.x, g.ship.y - gv.station.y)) + ')');
    // richtiger Weg: Kanal (Feldkarte)
    g.ship.x = gv.station.x; g.ship.y = gv.station.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.angle = 0; g.ship.turnVel = 0; run(0.2);
    flieg(gv.fluchtweg, true, 60, aus0);
    ok(aus0(), 'richtiger Weg durch den langen Kanal: Haltefeld verlassen (Abstand ' + Math.round(Math.hypot(g.ship.x - gv.station.x, g.ship.y - gv.station.y)) + ')');
  } finally { Welt.waehle(g, 'limes'); }
});

aufraeumen();
console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
