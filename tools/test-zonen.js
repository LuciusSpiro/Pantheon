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
  const a = Zonen.gasriese({ x: 1500, y: 1100, r: 280 }), b = Zonen.gasriese({ x: 1500, y: 1100, r: 280 });
  ok(a.length === 7 && JSON.stringify(a) === JSON.stringify(b), 'Gasriese: 4 Ringe + 3 Sturmzellen, deterministisch');
  ok(a.filter((z) => z.ertrag).length === 2 && a.filter((z) => z.drift).length === 3, 'Gasriese: Ertrag in zwei Ringen, Drift in den Sturmzellen');
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
  U.g.ship.helm.stage = 5; U.energie({ engines: 4, shields: 1, weapons: 1, life: 2 }); U.run(12);
  const vorw = U.g.ship.x - 2000;
  ok(vorw > 0 && vorw < 12 * 150, 'Stufe VOLL gegen 60 px/s Gegenstrom: kommt voran, aber langsamer (Δx ' + Math.round(vorw) + ')');
  const V = setup(); V.platz(2000, 1100, 0); V.g.ship.helm.stage = 1; V.run(4);
  ok(V.g.ship.x < 2000 - 150, 'Stopp: Lerche wird vom Gegenstrom zurückgeschoben (x ' + Math.round(V.g.ship.x) + ')');
  ok(Math.abs(U.g.ship.vx) < 200, 'Geschwindigkeit bleibt vom Flugmodell geregelt (Drift ist Versatz)');
});

section('Hitze, Schaden, Sicht', () => {
  szene([{ id: 'h1', form: 'kreis', x: 1000, y: 1000, r: 400, hitze: 20, schaden: 2, sicht: 0.5 }]);
  const T = setup({ god: false }); const g = T.g;
  T.platz(1000, 1000, 0); T.energie({ engines: 3, shields: 2, weapons: 1, life: 2 });
  const h0 = g.ship.heat.engines;
  T.run(1.5);
  ok(g.ship.heat.engines > h0 + 10, 'Zonenhitze heizt den Antrieb (Energie 3): ' + g.ship.heat.engines.toFixed(1));
  const hits = g.stats.hits;
  T.run(3);
  ok(g.stats.hits >= hits + 3, 'Schaden 2/s kommt im Sekundentakt als Treffer an (' + (g.stats.hits - hits) + ' Treffer in 3 s)');
  ok(Math.abs(space.erfassung(g) - (CONFIG.tscan.range || 800) * 0.5) < 1e-6, 'Sichtgrenze halbiert die Erfassung');
  ok(space.sensorReichweite(g) < (CONFIG.sensors.range || 1400), 'Sensorreichweite kleiner in der Zone');
  T.energie({ engines: 1, shields: 3, weapons: 2, life: 2 }); g.ship.heat.engines = 0; T.run(1);
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

section('Gasriese: Deuterium schöpfen, Gewicht, Abwerfen', () => {
  const zs = Zonen.gasriese({ x: 1500, y: 1100, r: 280 }, null, 'gas').filter((z) => !z.id.includes('sturm'));
  szene(zs, { planeten: [{ x: 1500, y: 1100, r: 280, art: 'gasriese' }] });
  const T = setup(); const g = T.g;
  T.platz(1500 + 230, 1100, 0); T.energie({ engines: 2, shields: 2, weapons: 2, life: 2 });   // Schöpfschicht (0,6–1,05 r = 168–294)
  const z = ZonenSim.szeneZonen(g).filter((q) => q.ertrag)[0];
  ok(!!z, 'Szene hat Ertragszonen');
  // Driftkräfte: tangentiale Strömung hält die Position nicht -> Lerche beim Schöpfen mit Stopp neu setzen
  const halt = () => T.platz(1500 + 230, 1100, 0);
  for (let i = 0; i < 12 && Fracht.anBord(g, 'deuterium') < 1; i++) { halt(); T.run(2); }
  ok(Fracht.anBord(g, 'deuterium') === 1, 'Schöpfschicht füllt eine Einheit Deuterium');
  for (let i = 0; i < 30 && Fracht.anBord(g, 'deuterium') < 2; i++) { halt(); T.run(2); }
  ok(Fracht.anBord(g, 'deuterium') === 2 && Fracht.frei(g) === 0, 'zweite Einheit: Frachtraum voll (2 Plätze)');
  const vor = Fracht.anBord(g);
  for (let i = 0; i < 6; i++) { halt(); T.run(2); }
  ok(Fracht.anBord(g) === vor && T.odas.some((t) => /Frachtraum voll/.test(t)), 'voll: nichts geht verloren, nichts kommt dazu, Meldung');
  const sf = space.engineSpeedFactor(g);
  const ohne = basis(g);
  ok(Math.abs(sf - ohne * 0.7) < 1e-9, 'Gewicht: 2 Einheiten Deuterium senken die Triebwerksleistung auf 70 % (' + sf.toFixed(3) + ' vs ' + ohne + ')');
  T.taktik();
  const e1 = T.cmd('weapons.abwerfen');
  ok(!e1.length && Fracht.anBord(g, 'deuterium') === 1 && Fracht.draussen(g).length === 1 && Fracht.draussen(g)[0].art === 'deuterium', 'Abwerfen: eine Einheit als Pod im All ' + JSON.stringify(e1));
  ok(Math.abs(space.engineSpeedFactor(g) - ohne * 0.85) < 1e-9, 'Gewicht sinkt nach dem Abwurf (85 %)');
  const e2 = T.cmd('weapons.abwerfen', { art: 'sprengstoff' });
  ok(e2.length === 1, 'Abwerfen einer Art, die nicht an Bord ist: Fehlermeldung ' + JSON.stringify(e2));
  // Ohne Frachtraum-Transfer kein Schöpfen
  g.fracht.lager = []; g.fracht.draussen = []; g.ship.systems.transfer = 'broken'; g.fracht.fuell = 0;
  for (let i = 0; i < 5; i++) { halt(); T.run(2); }
  ok(Fracht.anBord(g) === 0, 'Transfer zerstört: es wird nichts geschöpft');
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
    ok(Array.isArray(gas.zonen) && gas.zonen.length === 7 && gas.planeten.some((p) => p.art === 'gasriese'), 'Gasfeld (Sund): 7 Zonen aus dem Gasriesen');
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
    ok(r && r.ok !== false, 'Buch registriert');
    m.startMission(buch.id);
    run(5);
    ok(m.step && m.step.id === 'anflug_gas', 'Schritt anflug_gas');
    g.debugGoto('gasfeld', false); run(2);
    ok(m.step && m.step.id === 'schoepfen', 'am Gasfeld: Schritt schoepfen');
    const pl = gas.planeten.find((p) => p.art === 'gasriese');
    g.ship.power.engines = 2; if (g.ship.powerIntent) g.ship.powerIntent.engines = 2;
    for (let i = 0; i < 40 && Fracht.anBord(g, 'deuterium') < 1; i++) { g.ship.x = pl.x + pl.r * 0.8; g.ship.y = pl.y; g.ship.vx = 0; g.ship.vy = 0; run(2); }
    ok(Fracht.anBord(g, 'deuterium') === 1, 'Bot schöpft eine Einheit Deuterium in der Schöpfschicht');
    ok(g.ship.hull > 40, 'Hülle überlebt eine Einheit (' + g.ship.hull + ')');
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

aufraeumen();
console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
