'use strict';
// Schnellsprung (Spieltest 2026-10-12, server/sim/reise.js) headless: Route nur über erkundete Sektoren, 4 s je Hop, Abbruch landet an der
// Boje des nächsten Sektors, Abfangen nach Region, Ankunft löst die normalen Ereignisse aus.   node tools/test-schnellsprung.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Game } = require('../server/game.js');
const Sektoren = require('../shared/sektoren.js');
const Sprung = require('../server/sim/sprung.js');
const Reise = require('../server/sim/reise.js');
const { dist } = require('../server/util.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-reise-'));
let seq = 0;

function setup() {
  const d = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(d, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: d, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'R0', name: 'Crew', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'free' }); g.handleMessage(c, { t: 'ready', ready: true });
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
  run(1);
  g.space.enemies = [];
  g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0;   // deterministisch: kein Abfangen
  return { g, c, run, events: (k) => c.inbox.filter((m) => m.t === 'event' && m.kind === k) };
}
function place(g, x, y) { const s = g.ship; s.docked = false; s.dockedAt = null; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; }
// Hafen (0206) -> Splittergürtel (0306) -> B-7 (0406): beide Hexe erkundet, Route über zwei Sprünge
function vorbereiten(t) {
  const g = t.g;
  g.explore.erkunde('0306'); g.explore.erkunde('0406'); g.explore.erkunde('0206');
  const p = Sprung.sprungpunkt(g, '0306'); place(g, p.x - 80, p.y); t.run(0.5);
  return Sektoren.ortVonHex('0406');
}

console.log('Route und Start');
{
  const t = setup(); const g = t.g; const ziel = vorbereiten(t);
  ok(Reise.planen(g, '0206', '0406') && Reise.planen(g, '0206', '0406').join() === '0306,0406', 'Route über den erkundeten Splittergürtel');
  g.explore.erkundet.delete('0406');
  ok(Reise.planen(g, '0206', '0406') === null, 'unerkundetes Ziel: keine Route');
  g.explore.erkunde('0406');
  ok(Sprung.selectDest(g, ziel) === null && g.reisePlan && g.reisePlan.hops.join() === '0306,0406', 'selectDest auf einen entfernten, erkundeten Sektor legt die Route an');
  ok(g.ship.jump.dest === 'splitter', 'erster Hop ist das Sprungziel');
  t.run(40);
  ok(g.ship.jump.ready, 'Antrieb am Sprungpunkt geladen');
  ok(Reise.befehl(g) === null && g.reise && g.reise.hops.length === 2, 'Schnellsprung startet');
  t.run(3.5);
  ok(g.ship.scene === 'hafen' && g.reise, 'nach 3,5 s noch unterwegs (4 s je Hop)');
  t.run(1);
  ok(g.ship.scene === 'splitter' && g.reise && g.reise.i === 1, 'Hop 1: Splittergürtel erreicht');
  const back = Sprung.sprungpunkt(g, '0206');
  ok(dist(g.ship.x, g.ship.y, back.x, back.y) <= g.C.sektoren.sprungpunktRadius, 'Ankunft am Gegen-Sprungpunkt wie bei einem natürlichen Sprung');
  ok(t.events('jump').length >= 1, 'Sprung-Ereignis wird ausgelöst');
  t.run(4.2);
  ok(g.ship.scene === 'b7' && !g.reise && !g.reisePlan, 'Hop 2: Ziel erreicht, Reise und Route beendet');
}

console.log('Abbruch');
{
  const t = setup(); const g = t.g; const ziel = vorbereiten(t);
  Sprung.selectDest(g, ziel); t.run(40);
  Reise.befehl(g); t.run(1.2);
  ok(g.ship.scene === 'hafen' && g.reise, 'mitten im Hop');
  Reise.befehl(g); t.run(0.2);
  ok(g.ship.scene === 'splitter' && !g.reise, 'Abbruch: Lerche steht im nächsten Sektor');
  const back = Sprung.sprungpunkt(g, '0206');
  ok(dist(g.ship.x, g.ship.y, back.x, back.y) <= g.C.sektoren.sprungpunktRadius, 'Abbruch: an der Boje, durch die sie hereinkam');
  ok(g.reisePlan && g.reisePlan.hops.join() === '0406', 'Rest der Route bleibt gewählt');
}

console.log('Normaler Sprung rückt die Route vor');
{
  const t = setup(); const g = t.g; const ziel = vorbereiten(t);
  Sprung.selectDest(g, ziel); t.run(40);
  ok(Sprung.doJump(g) === null && g.ship.scene === 'splitter', 'Faltsprung (ein Hop)');
  ok(g.reisePlan && g.reisePlan.hops.join() === '0406', 'Route: nur noch der letzte Hop');
}

console.log('Abfangen');
{
  const t = setup(); const g = t.g; const ziel = vorbereiten(t);
  g.C.reise.neutralChance = 1;
  Sprung.selectDest(g, ziel); t.run(40);
  Reise.befehl(g); t.run(4.2);
  ok(!g.reise && g.ship.scene === 'splitter', 'abgefangen: Reise endet im Sektor');
  ok(g.space.enemies.length >= 2, 'Jäger greifen an (' + g.space.enemies.length + ')');
  ok(Math.abs(g.ship.x - g.space.w / 2) < 5, 'Lerche steht mitten im Sektor');
  ok(g._reiseOhne === 0, 'Zähler ereignisloser Hops zurückgesetzt');
}
{
  const t = setup(); const g = t.g;
  g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0.25; g.C.reise.neutralMax = 0.9;
  let treffer = 0; for (let i = 0; i < 12; i++) { g._reiseOhne = i; if (Reise.fraktionArt(g, '0306') === 'neutral') treffer++; }
  ok(treffer === 12 && Reise.fraktionArt(g, '0304') === 'sicher' && Reise.fraktionArt(g, '0604') === 'feind', 'Region -> Art: Rom sicher, Germanen feindlich, Saumraum neutral');
}
console.log(`\n${n - fails}/${n} Prüfungen bestanden.`);
process.exit(fails ? 1 : 0);
