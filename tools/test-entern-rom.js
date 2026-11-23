#!/usr/bin/env node
'use strict';
// SCH-02 D: Besitz-Fluss Rom-Schiff nach der Freischaltung (achsen.json kartenarten.schiff erlaubt, je_besitz rom -> rom).
//   node tools/test-entern-rom.js
// Prise und Wrack mit Besitz rom bauen römisch (Layout rechteck), Seed synchron (priseSeed), Karte bei Wiederholung identisch.
// Gegenprobe Rostmeute: germanisch wie zuvor. Gegenprobe Weltstand: ein alter Stand (Bauweise germanen, auch bei Besitz rom) bleibt germanisch.
const CONFIG = require('../shared/config.js');
const Buehne = require('../shared/buehne.js');
const W = require('../server/world.js');
const LP = require('../server/sim/landepunkte.js');
const space = require('../server/sim/space.js');
const Testhilfe = require('./gegner-testhilfe.js');
const { Game } = require('../server/game.js');

let n = 0, bad = 0;
const ok = (c, t) => { n++; if (!c) { bad++; console.log('  FEHLER ' + t); } else if (process.env.VERBOSE) console.log('  ok   ' + t); };
const abschnitt = (t) => console.log('[' + t + ']');

function fakeGame() {
  const g = {
    C: CONFIG, time: 0, seed: 1234, players: [], inventory: {}, aways: { platform: { map: 'platform' } },
    ship: { scene: 'kesh', x: 1350, y: 760 }, weltstand: null, mission: {},
    emit() {}, missionEvent() {}, notice() {}, oda() {}, log() {}, countError(w, e) { throw e; }, setAwayMap(id) { this.away = this.aways[id]; },
  };
  g.away = g.aways.platform;
  return g;
}
const frisch = (g, id) => { if (g.aways && g.aways[id]) delete g.aways[id]; W.unregister(id); LP.cacheLeeren(); };
const hash = (k) => Buehne.fnv(k.rows.join('\n'));
const layoutVon = (k) => (k.meta && k.meta.layout) || (k.buehne && k.buehne.layout) || null;

// Echtes Testspiel: ein Raider wird gekapert, entern.js legt die Prise an
function enternPrise(fraktion) {
  const g = new Game({ noStore: true, seed: 31, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'EN0', name: 'EN0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' }); g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = []; g.space.projectiles = []; g.god = true;
  const sh = g.ship; sh.x = g.space.w / 2; sh.y = g.space.h / 2;
  const e = space.spawnEnemy(g, 'raider', { x: sh.x + 250, y: sh.y, facing: Math.PI, tag: 'beute', fraktion });
  e.entern = true; if (fraktion) e.fraktion = fraktion;
  Testhilfe.toeten(g, e);
  return { g, e, p: g.entern.prisen[g.ship.scene + '.prise'] };
}

abschnitt('Freischaltung in achsen.json');
{
  const t = Buehne.daten().achsen.bauweise_nach_besitz.kartenarten.schiff;
  ok(t.erlaubt === true && t.je_besitz.rom === 'rom', 'schiff erlaubt, rom -> rom');
  ok(!t.je_besitz.rostmeute && !t.je_besitz.ger, 'keine weitere Besitzer-Zeile: Rostmeute und Ger bleiben beim Standard');
  ok(LP.bauweiseFuerBesitz('schiff', 'rom') === 'rom' && LP.bauweiseFuerBesitz('schiff', 'rostmeute') === 'germanen' && LP.bauweiseFuerBesitz('schiff', 'ger') === 'germanen', 'bauweiseFuerBesitz: rom -> rom, Rostmeute und Ger -> germanen');
}

abschnitt('Neu angelegter Landepunkt mit Besitz rom');
{
  const g = fakeGame();
  const id = LP.neu(g, 'kesh', { art: 'schiff', besitz: 'rom', seed: 9 });
  const e = LP.eintrag(g, id);
  ok(e.art === 'schiff' && e.bauweise === 'rom' && e.besitz === 'rom', 'Eintrag: Kartenart schiff, Bauweise rom, Besitz rom');
  frisch(g, id);
  const k = LP.karte(g, id);
  ok(k.art === 'schiff' && k.bauweise === 'rom' && k.schablone === 'gen-schiff', 'Karte: schiff, rom, Generator (Prüfer bestanden)');
  ok(layoutVon(k) === 'rechteck', 'Layout rechteck (' + layoutVon(k) + ')');
}

abschnitt('Entern mit Besitz rom: Prise und Wrack römisch');
{
  const { g, e, p } = enternPrise('rom');
  ok(!!p && p.art === 'schiff' && p.bauweise === 'rom' && p.besitz === 'rom' && p.zustand === 'umkaempft', 'entern.js: Prise schiff, rom, Besitz rom, umkaempft');
  ok(p.seed === LP.priseSeed(e.id), 'Seed der Prise = priseSeed(Gegner-ID)');
  frisch(g, p.lpId);
  const k = LP.karte(g, p.lpId);
  ok(k.bauweise === 'rom' && k.schablone === 'gen-schiff' && layoutVon(k) === 'rechteck', 'Prise: rom, Generator, Layout rechteck');
  const h1 = hash(k);
  frisch(g, p.lpId);
  ok(hash(LP.karte(g, p.lpId)) === h1, 'Prise: Kartenhash stabil bei Wiederholung');
  const wid = LP.priseVerlassen(g, g.ship.scene, true);
  const we = LP.eintrag(g, wid);
  ok(we.bauweise === 'rom' && we.besitz === 'rom' && we.zustand === 'verfallen' && we.art === 'schiff', 'Wrack: Bauweise rom, Besitz rom, verfallen');
  ok(we.seed === p.seed, 'Seed synchron zwischen Prise und Wrack');
  frisch(g, wid);
  const kw = LP.karte(g, wid);
  ok(kw.bauweise === 'rom' && kw.schablone === 'gen-schiff' && layoutVon(kw) === 'rechteck' && kw.seed === k.seed, 'Wrack: rom, Generator, Layout rechteck, gleicher Seed wie die Prise');
  const h2 = hash(kw);
  frisch(g, wid);
  ok(hash(LP.karte(g, wid)) === h2, 'Wrack: Kartenhash stabil bei Wiederholung');
}

abschnitt('Gegenprobe Rostmeute: germanisch wie zuvor');
{
  const { g, p } = enternPrise();
  ok(p.bauweise === 'germanen' && p.besitz === 'rostmeute', 'Prise Rostmeute: germanen');
  frisch(g, p.lpId);
  const k = LP.karte(g, p.lpId);
  ok(k.bauweise === 'germanen' && layoutVon(k) === 'schiff', 'Karte: germanen, Layout schiff (' + layoutVon(k) + ')');
  const wid = LP.priseVerlassen(g, g.ship.scene, true);
  ok(LP.eintrag(g, wid).bauweise === 'germanen' && LP.eintrag(g, wid).seed === p.seed, 'Wrack Rostmeute: germanen, Seed synchron');
}

abschnitt('Gegenprobe Weltstand: alter Stand bleibt germanisch');
{
  // alter Stand: römische Prise vor der Freischaltung angelegt (Bauweise germanen im Eintrag)
  const g0 = fakeGame();
  const pid = LP.prise(g0, 'kesh', { id: 'alt1', fraktion: 'rom', x: 1, y: 1 });
  const dyn0 = JSON.parse(JSON.stringify(LP.toSave(g0)));
  ok(dyn0[pid] && dyn0[pid].bauweise === 'rom', 'Ausgangslage: neu angelegt baut rom (Block trägt die Bauweise)');
  dyn0[pid].bauweise = 'germanen';   // so sah der Stand vor der Freischaltung aus
  const g1 = fakeGame();
  LP.cacheLeeren(); LP.restore(JSON.parse(JSON.stringify(dyn0)), g1);
  frisch(g1, pid);
  const k = LP.karte(g1, pid);
  ok(LP.eintrag(g1, pid).bauweise === 'germanen' && k.bauweise === 'germanen' && layoutVon(k) === 'schiff', 'alte Prise (Besitz rom): bleibt germanisch nach Neustart, Layout schiff');
  const wid = LP.priseVerlassen(g1, 'kesh', true);
  frisch(g1, wid);
  const kw = LP.karte(g1, wid);
  ok(LP.eintrag(g1, wid).bauweise === 'germanen' && kw.bauweise === 'germanen' && layoutVon(kw) === 'schiff', 'altes Wrack (Besitz rom): bleibt germanisch');
  // und die neue römische Prise bleibt nach Speichern und Laden römisch
  const g2 = fakeGame();
  const p2 = LP.prise(g2, 'kesh', { id: 'neu1', fraktion: 'rom', x: 1, y: 1 });
  frisch(g2, p2); const k2 = LP.karte(g2, p2); const h = hash(k2);
  const blk = JSON.parse(JSON.stringify(LP.toSave(g2)));
  const g3 = fakeGame(); LP.cacheLeeren(); LP.restore(blk, g3); frisch(g3, p2);
  const k3 = LP.karte(g3, p2);
  ok(k3.bauweise === 'rom' && hash(k3) === h, 'neue römische Prise: nach Speichern und Laden dieselbe römische Karte');
}

console.log(`test-entern-rom: ${n - bad}/${n} ok`);
if (bad) { console.log('TEST ENTERN-ROM FEHLGESCHLAGEN (' + bad + ')'); process.exit(1); }
console.log('TEST ENTERN-ROM OK');
