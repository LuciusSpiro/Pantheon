'use strict';
// SL4 (CONCEPT-SL4): Sonden und Sektorplan, Server headless.   node tools/test-sonden.js
// Sonde in der Szene (Vorrat, Flug, Senden, Beschuss, Grenzen), Sonde durch den Sprungpunkt (gesichtet, nie erkundet, Schiffe, Alter),
// Sektorplan (Marken, Snapshot world.sektoren.g/p, Weltstand speichern/laden mit Schema), Bot, Snapshot-Größe.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Game } = require('../server/game.js');
const Sektoren = require('../shared/sektoren.js');
const Plan = require('../shared/sektorplan.js');
const Sonden = require('../server/sim/sonden.js');
const Sektorplan = require('../server/sim/sektorplan.js');
const Weltstand = require('../server/weltstand.js');
const Physics = require('../shared/physics.js');
const W = require('../server/world.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-sonden-'));
let seq = 0;

const STAND = [[0, 1, 'up'], [0, -1, 'down'], [-1, 0, 'right'], [1, 0, 'left']];
function conSpot(con) {
  for (const t of [].concat(W.CONSOLE_TILES[con])) for (const [dx, dy, dir] of STAND) { const s = { x: t.x + dx, y: t.y + dy, dir }; if (!W.ship.solid(s.x, s.y)) return s; }
  return null;
}
function setup() {
  const d = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(d, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: d, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'r') }, log: () => {} });
  const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'S0', name: 'Ops', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'free' }); g.handleMessage(c, { t: 'ready', ready: true });
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) { if (!g._behalteGegner) g.space.enemies = g.space.enemies.filter((e) => g._behalteGegner); g.step(); } };
  run(1);
  const p = g.players[0];
  const s = conSpot('weapons'); const ctr = Physics.tileCenter(s.x, s.y); p.x = ctr.x; p.y = ctr.y; p.dir = s.dir;
  g.handleMessage(c, { t: 'act', down: true }); g.handleMessage(c, { t: 'act', down: false });
  const cmd = (k, extra) => g.handleMessage(c, Object.assign({ t: 'cmd', c: k }, extra || {}));
  const odas = () => c.inbox.filter((m) => m.t === 'event' && m.kind === 'oda').map((m) => m.text);
  const notices = () => c.inbox.filter((m) => m.t === 'event' && m.kind === 'notice').map((m) => m.text);
  return { g, c, p, cmd, run, odas, notices };
}
function place(g, x, y) { const s = g.ship; s.docked = false; s.dockedAt = null; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; }

console.log('Sonde in der Szene');
{
  const t = setup(); const g = t.g;
  place(g, 600, 600); t.run(0.5);
  ok(g.players[0].console === 'weapons', 'Ops an der Taktik-Konsole');
  ok(Sonden.vorrat(g) === 3, 'Start mit 3 Sonden');
  ok(g.snapshot().inventory.sonde === 3, 'Snapshot inventory.sonde = 3');
  t.cmd('weapons.sonde.start');
  ok(Sonden.vorrat(g) === 3 && g.sonden.length === 0, 'ohne Marke: abgelehnt, Vorrat bleibt');
  t.cmd('weapons.marker', { x: 1400, y: 700 });
  t.cmd('weapons.sonde.start');
  ok(g.sonden.length === 1 && Sonden.vorrat(g) === 2, 'Start: eine Sonde unterwegs, Vorrat 2');
  ok(g.snapshot().space.so.length === 1 && g.snapshot().space.so[0].z === 0, 'Snapshot space.so: fliegt');
  t.run(1);
  const s1 = g.sonden[0];
  ok(s1.x > 600 && s1.x < 1400 && s1.z === 0, 'fliegt selbst zum Ziel');
  t.run(4);
  ok(g.sonden[0] && g.sonden[0].z === 1 && Math.abs(g.sonden[0].x - 1400) < 1, 'erreicht das Ziel und sendet');
  ok(t.odas().some((x) => /Sonde sendet/.test(x)), 'Ansage beim Senden');
  ok(Sonden.sieht(g, 1400, 1000) && !Sonden.sieht(g, 2400, 1700), 'Sonde erfasst Punkte im Senderadius');
  // Ziel außerhalb der Schiffssensoren, aber in Sondenreichweite -> aufschaltbar
  const e = require('../server/sim/space.js').spawnEnemy(g, 'raider', { x: 1400, y: 1250, facing: 0 });
  g._behalteGegner = true;
  g.ship.x = 300; g.ship.y = 300;
  g.handleMessage(t.c, { t: 'cmd', c: 'weapons.target', id: e ? e.id : 'x' });
  ok(!e || g.ship.target === e.id, 'Sonde erweitert die Sicht: Ziel außerhalb der Schiffssensoren aufschaltbar');
  g._behalteGegner = false;
  // Beschuss
  const e2 = require('../server/sim/space.js').spawnEnemy(g, 'raider', { x: 1400, y: 900, facing: 0 });
  g._behalteGegner = true;
  t.run(4);
  ok(g.sonden.length === 0, 'Gegner schießen die Sonde ab');
  ok(t.odas().some((x) => /zerstört/.test(x)), 'Ansage: Sonde zerstört');
  g._behalteGegner = false; g.space.enemies = [];
  // Grenzen
  for (let i = 0; i < 3; i++) { Sonden.starteInSzene(g, t.p, { x: 900 + i * 50, y: 900 }); }
  ok(g.sonden.length === 2 && Sonden.vorrat(g) === 0, 'Vorrat 0: weitere Starts abgelehnt (' + g.sonden.length + ' unterwegs, Vorrat 2 vor den 3 Versuchen)');
  ok(/Keine Sonden/.test(Sonden.starteInSzene(g, t.p, { x: 1000, y: 1000 })), 'Meldung „Keine Sonden im Vorrat“');
  t.run(Math.ceil(g.C.sonden.leben) + 2);
  ok(g.sonden.length === 0, 'Sonde erlischt nach ihrer Lebensdauer');
  g.inventory.sonde = 5;
  Sonden.starteInSzene(g, t.p, { x: 900, y: 900 }); Sonden.starteInSzene(g, t.p, { x: 950, y: 900 }); Sonden.starteInSzene(g, t.p, { x: 1000, y: 900 });
  ok(g.sonden.length === 3 && /Es sind schon 3/.test(Sonden.starteInSzene(g, t.p, { x: 1100, y: 900 })), 'höchstens 3 gleichzeitig');
  // Szenenwechsel
  const Sprung = require('../server/sim/sprung.js');
  g.sonden.length = 0; g.inventory.sonde = 3;
  Sonden.starteInSzene(g, t.p, { x: 900, y: 900 });
  g.ship.scene = 'splitter'; t.run(0.1);
  ok(g.sonden.length === 0, 'Szenenwechsel: Sonden der alten Szene bleiben zurück');
}

console.log('Sonde durch den Sprungpunkt');
{
  const t = setup(); const g = t.g;
  place(g, 600, 600); t.run(0.5);
  const here = Sektoren.hexVonOrt(g.ship.scene);
  const nach = '0207';
  ok(Sektoren.sindNachbarn(here, nach), `Nachbarhex ${nach} von ${here}`);
  g.explore._tutKarte = new Set();   // Tutorial-Karte aus: nur echte Besuche zählen als erkundet
  g.explore.known.delete('vaelen');   // Boje der Kante unbekannt
  ok(/noch nicht gefunden/.test(Sonden.starteDurchSprungpunkt(g, t.p, nach) || ''), 'unbekannter Sprungpunkt: abgelehnt');
  g.explore.markBoje(Sektoren.kanteId(here, nach));
  ok(!g.explore.hexErkundet(nach), `${nach} ist unerkundet`);
  ok(Sonden.starteDurchSprungpunkt(g, t.p, nach) === null && g.sonden.length === 1 && Sonden.vorrat(g) === 2, 'Start durch den Sprungpunkt');
  ok(/ührt kein/.test(Sonden.starteDurchSprungpunkt(g, t.p, '0502') || ''), 'Nicht-Nachbar: abgelehnt');
  t.run(8);
  ok(g.sonden[0] && g.sonden[0].z === 2, 'am Sprungpunkt: springt (z 2)');
  ok(g.snapshot().space.so[0].n === nach, 'Snapshot: Ziel-Hex der Sonde');
  ok(!Sektorplan.gesichtet(g, nach), 'noch nicht gesichtet vor Ablauf der Sprungzeit');
  t.run(g.C.sonden.sprungZeit + 1);
  ok(g.sonden.length === 0 && Sektorplan.gesichtet(g, nach), 'Nachbarsektor gesichtet, Sonde verbraucht');
  ok(!g.explore.hexErkundet(nach) && !g.explore.erkundet.has(nach), 'NIE erkundet: Schnellsprung dorthin bleibt gesperrt');
  const Reise = require('../server/sim/reise.js');
  ok(Reise.planen(g, here, nach) === null, 'Reise.planen verweigert den nur gesichteten Sektor');
  ok(t.odas().some((x) => /Sonde meldet aus/.test(x)), 'Ansage der Ankunft');
  const sn = g.snapshot().world.sektoren;
  ok(sn && sn.g && sn.g.includes(nach), 'Snapshot world.sektoren.g enthält den gesichteten Hex');
  // Sektorplan: Ortsfestes aus Kartendaten, gleich für Server und Client
  const obj = Plan.objekte(nach);
  ok(obj.length >= 2 && obj.some((o) => o.sym === 'sprungpunkt'), `Ortsfeste Objekte aus Kartendaten (${obj.length}, mit Sprungpunkten)`);
  ok(Plan.objekte(nach).map((o) => o.id).join() === obj.map((o) => o.id).join(), 'deterministisch');
  ok(Plan.alterText(240) === 'vor 4 min' && Plan.alterText(40) === 'vor 40 s', 'Alterstext');
}

console.log('Sektorplan: Marken, Schiffe, Alter, Weltstand');
{
  const t = setup(); const g = t.g;
  place(g, 600, 600); t.run(0.5);
  const hex = '0207';
  g.explore._tutKarte = new Set(); g.explore.known.delete('vaelen');   // 0207 unbekannt
  ok(/unbekannt/.test(Sektorplan.markeSetzen(g, hex, 100, 100)), 'Marke in unbekanntem Sektor: abgelehnt');
  Sektorplan.sichten(g, hex, 'karte');
  ok(Sektorplan.markeSetzen(g, hex, 500, 400, 'fund') === null, 'Marke in gesichtetem Sektor');
  t.cmd('captain.sektorplan.marke', { hex, x: 20, y: 30 });   // Ops-Konsole: Befehl gehört dem Captain
  ok(g.sektorplan.marken.length === 1, 'Befehl captain.sektorplan.marke nur an der Captain-Konsole');
  // Schiffe als feste Daten
  const d = Sektoren.hexDaten(hex); const alt = d.schiffe; d.schiffe = [{ art: 'korvette', x: 800, y: 700 }, { art: 'raider', x: 900, y: 750 }];
  Sektorplan.schiffeAufnehmen(g, hex);
  ok(Sektorplan.schiffeVon(g, hex).length === 2, 'Schiffe aus den Hex-Daten als Momentaufnahme');
  t.run(65);
  g.explore.sektorVersion++;
  const sn = g.snapshot().world.sektoren;
  ok(sn && sn.p && sn.p.s.length === 2 && g.time - sn.p.s[0][4] >= 60, 'Snapshot world.sektoren.p mit Zeit der Sicht (Alter ' + Math.round(g.time - sn.p.s[0][4]) + ' s)');
  // Speichern und Laden
  const save = Sektorplan.toSave(g);
  ok(save && save.gesichtet[hex].q === 'karte' && save.schiffe[0].alter >= 60 && save.marken.length === 1, 'toSave: gesichtet, Schiffe mit Alter, Marken');
  const g2 = setup().g; Sektorplan.restore(g2, JSON.parse(JSON.stringify(save)));
  ok(Sektorplan.gesichtet(g2, hex) && g2.sektorplan.marken.length === 1 && g2.time - g2.sektorplan.schiffe[0].t >= 60, 'restore: Sicht, Marke und Alter bleiben');
  // Weltstand-Schema
  let data = null;
  try { data = Weltstand.capture(g); } catch (e) { data = null; console.log('   capture: ' + e.message); }
  ok(data && data.welt && data.welt.sektorplan && data.welt.sektorplan.gesichtet[hex], 'Weltstand capture enthält welt.sektorplan');
  const fehler = data ? Weltstand.validate(data, g) : ['kein Weltstand'];
  ok(!fehler || fehler.length === 0, 'Weltstand-Schema akzeptiert welt.sektorplan' + (fehler && fehler.length ? ': ' + JSON.stringify(fehler).slice(0, 200) : ''));
  Sektorplan.reset(g); ok(Sektorplan.toSave(g) === null, 'leerer Plan: kein Block im Weltstand');
  // Altstand ohne Block
  Sektorplan.restore(g2, undefined); ok(!Sektorplan.gesichtet(g2, hex), 'Altstand ohne welt.sektorplan: leer');
  d.schiffe = alt; if (alt === undefined) delete d.schiffe;
}

console.log('Snapshot-Größe');
{
  const t = setup(); const g = t.g; place(g, 600, 600); t.run(0.5);
  g.inventory.sonde = 3;
  Sonden.starteInSzene(g, t.p, { x: 900, y: 900 }); Sonden.starteInSzene(g, t.p, { x: 1000, y: 900 }); Sonden.starteInSzene(g, t.p, { x: 1100, y: 900 });
  const mit = JSON.stringify(g.snapshot().space.so).length;
  ok(mit < 260, `3 Sonden im Snapshot (space.so): ${mit} B`);
  for (const h of ['0207', '0306', '0205', '0307']) Sektorplan.sichten(g, h, 'sonde');
  for (let i = 0; i < 12; i++) Sektorplan.markeAusCode(g, 'x' + i, '0207', i * 10, i * 10, 'marke');
  g.explore.sektorVersion++;
  const gross = JSON.stringify(g.snapshot().world.sektoren).length;
  ok(gross < 700, `world.sektoren mit 4 gesichteten Hexen und 12 Marken: ${gross} B (nur bei Änderung)`);
}

console.log('Sund: Sonde durch die verborgene Kante (Schrottkante)');
{
  const Welt = require('../server/sim/welt.js'); const Sprung = require('../server/sim/sprung.js');
  const t = setup(); const g = t.g;
  Welt.waehle(g, 'sund');
  try {
    g.enterSceneForTest = true;
    require('../server/sim/space.js').enterScene(g, 'pulverhorn', {});
    g.explore.location = 'pulverhorn'; g.explore._tutKarte = new Set();
    t.run(0.3);
    const ok1 = Sonden.starteDurchSprungpunkt(g, t.p, '0606');
    ok(typeof ok1 === 'string', 'verborgene Kante noch nicht enthüllt: Sonde abgelehnt (' + ok1 + ')');
    ok(Sprung.kanteEnthuellen(g, 'lager-schrottkante') === null, 'Kante enthüllen (SL1)');
    ok(Sonden.starteDurchSprungpunkt(g, t.p, '0606') === null, 'nach dem Enthüllen: Sonde darf durch');
    t.run(8 + g.C.sonden.sprungZeit + 1);
    ok(Sektorplan.gesichtet(g, '0606') && !g.explore.hexErkundet('0606'), 'Schrottkante gesichtet, nicht erkundet');
    ok(Plan.objekte('0606').length >= 1, 'Sektoransicht-Daten für Schrottkante vorhanden (' + Plan.objekte('0606').length + ' Objekte)');
  } finally { Welt.waehle(null, 'limes'); }
}

console.log(`\n${n - fails}/${n} Prüfungen bestanden.`);
process.exit(fails ? 1 : 0);
