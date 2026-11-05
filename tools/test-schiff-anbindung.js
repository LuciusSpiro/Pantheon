#!/usr/bin/env node
'use strict';
// SCH-01 P2: Anbindung des Schiffsgenerators (shared/gen-schiff.js) an Landepunkte, Prise und Wrack.
//   node tools/test-schiff-anbindung.js
// Nicht in package.json (P4). Der Generator selbst: tools/proto-schiff.js bzw. sein eigener Test.
const CONFIG = require('../shared/config.js');
const Buehne = require('../shared/buehne.js');
const W = require('../server/world.js');
const LP = require('../server/sim/landepunkte.js');
const Entern = require('../server/sim/entern.js');
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
const frisch = (g, id) => { if (g.aways && g.aways[id]) delete g.aways[id]; W.unregister(id); };
const mitGen = (wert, fn) => { const alt = process.env.PANTHEON_GEN; if (wert === undefined) delete process.env.PANTHEON_GEN; else process.env.PANTHEON_GEN = wert; LP.cacheLeeren(); try { return fn(); } finally { if (alt === undefined) delete process.env.PANTHEON_GEN; else process.env.PANTHEON_GEN = alt; LP.cacheLeeren(); } };
// Echtes Testspiel (wie tools/test-entern.js): ein Raider wird gekapert, entern.js legt die Prise an (über landepunkte.prise). -> { g, p, e }
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
// alte Formel (vor SCH-01 P2, entern.js hashStr / landepunkte.prise)
const altSeed = (id) => { let h = 2166136261; const s = String(id); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) + 1; };

// ---------------- nutztGenerator ----------------
abschnitt('nutztGenerator für schiff');
for (const bw of ['germanen', 'rom']) {
  const g = fakeGame();
  const neuId = LP.neu(g, 'kesh', { art: 'schiff', bauweise: bw, seed: 11 });
  ok(LP.nutztGenerator(neuId, { art: 'schiff', schablone: null, bauweise: bw }) === true, `neu, ohne Schablone (${bw}): Generator`);
  ok(LP.nutztGenerator(neuId, { art: 'schiff', schablone: 'gen-schiff', bauweise: bw }) === true, `gespeichert gen-schiff (${bw}): Generator (übernehmen)`);
  ok(LP.nutztGenerator(neuId, { art: 'schiff', schablone: 'schiff.frachter', bauweise: bw }) === false, `Altstand schiff.frachter (${bw}): Modul`);
  ok(LP.nutztGenerator(neuId, { art: 'schiff', schablone: 'schiff.kriegsschiff', bauweise: bw }) === false, `Altstand schiff.kriegsschiff (${bw}): Modul`);
}
ok(mitGen('0', () => LP.nutztGenerator('kesh.schiff-1', { art: 'schiff', schablone: null })) === false, 'PANTHEON_GEN=0: kein Generator');
{
  const g = fakeGame();
  const i0 = LP.neu(g, 'kesh', { art: 'schiff', seed: 5 });
  const k = mitGen('0', () => { frisch(g, i0); return LP.karte(g, i0); });
  ok(k.schablone && k.schablone !== 'gen-schiff' && !/^gen-/.test(k.schablone), 'PANTHEON_GEN=0: Karte aus Modul (' + k.schablone + ')');
  frisch(g, i0);
  const k2 = mitGen(undefined, () => { LP.cacheLeeren(); const g2 = fakeGame(); const i = LP.neu(g2, 'kesh', { art: 'schiff', seed: 5 }); frisch(g2, i); return LP.karte(g2, i); });
  ok(k2.schablone === 'gen-schiff' && k2.bauversion === 'gschiff1' && k2.art === 'schiff', 'ohne Schalter: Karte vom Generator (gen-schiff / gschiff1)');
}
{
  // Aus-Schalter je Ort in der Definition: splitter.treibgut hat im Test keinen; über Eintrag mit Schablone prüfen wir den Rest oben
  const g = fakeGame();
  const i = LP.neu(g, 'kesh', { art: 'schiff', seed: 5, schablone: 'schiff.frachter' });
  frisch(g, i);
  const k = LP.karte(g, i);
  ok(k.schablone === 'schiff.frachter', 'explizite Modulschablone beim Anlegen bleibt Modul');
}

// ---------------- Rom-Layout / Debug ohne Freischaltung ----------------
abschnitt('bauweise rom bei art schiff (Debug), achsen.json bleibt zu');
{
  const ach = Buehne.daten().achsen;
  ok(ach.bauweise_nach_besitz.kartenarten.schiff.erlaubt === false, 'achsen.json: kartenarten.schiff.erlaubt bleibt false');
  ok(LP.bauweiseFuerBesitz('schiff', 'rom') === 'germanen' && LP.bauweiseFuerBesitz('schiff', 'rostmeute') === 'germanen', 'bauweiseFuerBesitz: Schiff bleibt germanisch, solange nicht freigeschaltet');
  const g = fakeGame();
  const id = LP.testgelaende(g, { art: 'schiff', seed: 7, bauweise: 'rom', besitz: 'rom' });
  frisch(g, id);
  const k = LP.karte(g, id);
  ok(k.art === 'schiff' && k.schablone === 'gen-schiff', 'testgelaende schiff mit bauweise rom: Generator (Prüfer in genBauen bestanden) (wird nicht abgelehnt)');
}

// ---------------- Altstand ----------------
abschnitt('Altstand: gespeicherte Schablone bleibt Modul');
{
  const bv = Buehne.bauversion('schiff');
  const block = { 'splitter.treibgut': { art: 'schiff', bauweise: 'germanen', besitz: 'raubzug', zustand: 'verfallen', seed: 3061, schablone: 'schiff.frachter', bauversion: bv, zustaende: {}, besuche: 2 } };
  for (const schab of ['schiff.frachter', 'schiff.kriegsschiff']) {
    LP.cacheLeeren();
    const g = fakeGame();
    block['splitter.treibgut'].schablone = schab;
    LP.restore(JSON.parse(JSON.stringify(block)), g);
    frisch(g, 'splitter.treibgut');
    const k = LP.karte(g, 'splitter.treibgut');
    ok(k.schablone === schab && k.bauversion === bv, `${schab}: Karte aus Modul, bauversion unverändert (${k.bauversion})`);
    LP.cacheLeeren(); frisch(g, 'splitter.treibgut');
    const k2 = LP.karte(g, 'splitter.treibgut');
    ok(k2.schablone === schab && k2.rows.join('') === k.rows.join(''), `${schab}: nach erneutem Auflösen (Cache leer) kein Rückfall, gleiche Karte`);
    ok(LP.toSave(g)['splitter.treibgut'].schablone === schab, `${schab}: Weltstand behält die Schablone`);
  }
  // frische Welt: handplatziertes Schiff mit schablone null wechselt auf den Generator (gewollt)
  LP.cacheLeeren();
  const g = fakeGame();
  frisch(g, 'splitter.treibgut');
  const k = LP.karte(g, 'splitter.treibgut');
  ok(k.schablone === 'gen-schiff' && k.bauversion === 'gschiff1', 'frische Welt: splitter.treibgut (schablone null) -> gen-schiff');
  for (const id of ['wrack.langschiff', 'vaelen.handelsschiff', 'nebel.havarist']) {
    frisch(g, id);
    const kk = LP.karte(g, id);
    ok(kk.schablone === 'gen-schiff', `frische Welt: ${id} -> gen-schiff (Prüfer in genBauen bestanden)`);
  }
  // Weltstand-Roundtrip einer Generatorkarte: bleibt gen-schiff, bauversion gschiff1
  const blk = LP.toSave(g);
  ok(blk['splitter.treibgut'].schablone === 'gen-schiff' && blk['splitter.treibgut'].bauversion === 'gschiff1', 'Weltstand: gen-schiff / gschiff1 gespeichert');
  const g2 = fakeGame(); LP.restore(JSON.parse(JSON.stringify(blk)), g2); frisch(g2, 'splitter.treibgut'); LP.cacheLeeren();
  const k3 = LP.karte(g2, 'splitter.treibgut');
  ok(k3.schablone === 'gen-schiff' && k3.rows.join('') === k.rows.join(''), 'Weltstand geladen: gleiche Generatorkarte');
}

// ---------------- priseSeed ----------------
abschnitt('priseSeed bit-gleich zur alten Formel');
{
  const ids = ['e12', 'raider_3', 'lerche-7', 'gegner.42', 'Ä-Schiff'];
  ok(typeof LP.priseSeed === 'function', 'landepunkte.priseSeed exportiert');
  for (const id of ids) ok(LP.priseSeed(id) === altSeed(id), `priseSeed(${id}) = alte Formel (${altSeed(id)})`);
  ok(LP.priseSeed(null) === altSeed('prise'), 'priseSeed(null) = Seed von "prise" wie bisher');
  for (const id of ids) {
    const g = fakeGame();
    const lp = LP.prise(g, 'kesh', { id, fraktion: 'rostmeute', x: 100, y: 100 });
    const e = LP.eintrag(g, lp);
    ok(e.seed === altSeed(id), `landepunkte.prise(${id}): Seed ${e.seed} = alte Formel`);
  }
  const { g: ge, e: ee, p: pe } = enternPrise();
  ok(!!pe && pe.seed === altSeed(ee.id), `entern.js: Seed der Prise (${pe && pe.seed}) = alte Formel für Gegner ${ee.id}`);
  ok(LP.eintrag(ge, pe.lpId).seed === pe.seed, 'entern.js und landepunkte.prise: derselbe Gegner, derselbe Seed');
}

// ---------------- Prise: Bauweise aus dem Besitz ----------------
abschnitt('Prise: Bauweise aus dem Besitz (bauweiseFuerBesitz)');
{
  const g = fakeGame();
  const lp = LP.prise(g, 'kesh', { id: 'p1', fraktion: 'rostmeute', x: 1, y: 1 });
  const e = LP.eintrag(g, lp);
  ok(e.bauweise === LP.bauweiseFuerBesitz('schiff', 'rostmeute') && e.bauweise === 'germanen', 'Besitz rostmeute -> germanen');
  ok(e.zustand === 'umkaempft' && e.schablone === null && e.art === 'schiff' && e.seed === altSeed('p1'), 'Zustand umkaempft, Schablone null, Seed unverändert');
  frisch(g, lp);
  const k = LP.karte(g, lp);
  ok(k.schablone === 'gen-schiff' && k.zustand === 'umkaempft', 'Prise baut mit Generator (Prüfer in genBauen bestanden)');
  ok(LP.eintrag(g, lp).schablone === 'gen-schiff', 'Eintrag trägt nach dem Bau gen-schiff');

  // Rom: nur mit freigeschalteter Tabelle (achsen.json bleibt zu) -> Daten kurz überschreiben
  const D = Buehne.daten();
  const kopie = JSON.parse(JSON.stringify(D.achsen));
  const rom = (kopie.bauweise_nach_besitz.kartenarten.schiff = { erlaubt: true, je_besitz: { rom: 'rom', rostmeute: 'germanen' } });
  const Roh = { achsen: kopie };
  let besitzRom = null;
  const vorher = D.achsen.bauweise_nach_besitz.kartenarten.schiff;   // gesicherter Original-Eintrag
  try {
    D.achsen.bauweise_nach_besitz.kartenarten.schiff = rom;   // in-memory, nicht gespeichert
    const g3 = fakeGame();
    const lp3 = LP.prise(g3, 'kesh', { id: 'p2', fraktion: 'rom', x: 1, y: 1 });
    besitzRom = LP.eintrag(g3, lp3).bauweise;
    frisch(g3, lp3);
    const k3 = LP.karte(g3, lp3);
    ok(besitzRom === 'rom', 'Besitz rom (Tabelle freigeschaltet) -> Bauweise rom');
    ok(k3.schablone === 'gen-schiff', 'Rom-Prise baut mit Generator (Layout rechteck; bis P1 wie schiff) (Prüfer in genBauen bestanden)');
    // entern.js nimmt dieselbe Bauweise
    const { g: g4, p } = enternPrise('rom');
    ok(p.bauweise === 'rom' && p.besitz === 'rom' && LP.eintrag(g4, p.lpId).bauweise === 'rom', 'entern.js: Bauweise rom aus dem Besitz, Eintrag stimmt überein');
  } finally { D.achsen.bauweise_nach_besitz.kartenarten.schiff = vorher; }
  ok(Buehne.daten().achsen.bauweise_nach_besitz.kartenarten.schiff.erlaubt === false, 'Tabelle wieder zu');
  void Roh;
  // entern.js bei geschlossener Tabelle
  const { p: p5, e: e5 } = enternPrise();
  ok(p5.bauweise === 'germanen' && p5.seed === altSeed(e5.id), 'entern.prise rostmeute: germanen, Seed wie bisher');
}

// ---------------- Wrack nach priseVerlassen ----------------
abschnitt('Wrack einer generierten Prise');
{
  const g = fakeGame();
  const lp = LP.prise(g, 'kesh', { id: 'w1', fraktion: 'rostmeute', x: 1, y: 1 });
  frisch(g, lp);
  const k = LP.karte(g, lp);   // erster Bau: Eintrag übernimmt gen-schiff / gschiff1
  const neu = LP.priseVerlassen(g, 'kesh', true);
  ok(neu === 'kesh.wrack-1', 'priseVerlassen(merken) -> kesh.wrack-1');
  const e = LP.eintrag(g, neu);
  ok(e.schablone === 'gen-schiff' && e.bauversion === 'gschiff1' && e.seed === k.seed && e.zustand === 'verfallen', 'Wrack: Seed/Schablone/bauversion kopiert, verfallen');
  frisch(g, neu);
  const kw = LP.karte(g, neu);
  ok(kw.schablone === 'gen-schiff' && kw.zustand === 'verfallen' && kw.seed === k.seed, 'Wrack baut mit dem Generator (gleicher Seed) (Prüfer in genBauen bestanden)');
  // Prise ohne Bau vorher: Wrack baut danach trotzdem mit dem Generator
  const g2 = fakeGame();
  LP.prise(g2, 'kesh', { id: 'w2', fraktion: 'rostmeute', x: 1, y: 1 });
  const neu2 = LP.priseVerlassen(g2, 'kesh', true);
  frisch(g2, neu2);
  const kw2 = LP.karte(g2, neu2);
  ok(kw2.schablone === 'gen-schiff', 'Wrack einer ungebauten Prise: Generator');
  ok(LP.priseVerlassen(g2, 'kesh', false) === null, 'priseVerlassen ohne Prise: null');
}

// ---------------- PANTHEON_GEN=0 ----------------
abschnitt('PANTHEON_GEN=0 liefert Module (Prise, Wrack, Handschiff)');
mitGen('0', () => {
  const g = fakeGame();
  const lp = LP.prise(g, 'kesh', { id: 'm1', fraktion: 'rostmeute', x: 1, y: 1 });
  frisch(g, lp);
  const k = LP.karte(g, lp);
  ok(k.art === 'schiff' && k.schablone && !/^gen-/.test(k.schablone), 'Prise: Modulkarte (' + k.schablone + ')');
  frisch(g, 'splitter.treibgut');
  const kh = LP.karte(g, 'splitter.treibgut');
  ok(kh.schablone && !/^gen-/.test(kh.schablone), 'Handschiff splitter.treibgut: Modulkarte');
  const neu = LP.priseVerlassen(g, 'kesh', true);
  frisch(g, neu);
  const kw = LP.karte(g, neu);
  ok(kw.schablone && !/^gen-/.test(kw.schablone), 'Wrack: Modulkarte');
});

// ---------------- gespeicherte Generatorschiffe unter PANTHEON_GEN=0 ----------------
abschnitt('PANTHEON_GEN=0: gespeichertes gen-schiff bleibt beim Generator');
{
  LP.cacheLeeren();
  const g = fakeGame();
  const lp = LP.prise(g, 'kesh', { id: 'gs1', fraktion: 'rostmeute', x: 1, y: 1 });
  frisch(g, lp);
  const k0 = LP.karte(g, lp);
  ok(k0.schablone === 'gen-schiff', 'Ausgangslage: gebaut mit Generator');
  const blk = JSON.parse(JSON.stringify(LP.toSave(g)));
  ok(blk[lp].schablone === 'gen-schiff', 'Weltstand trägt schablone gen-schiff');
  ok(mitGen('0', () => LP.nutztGenerator(lp, { art: 'schiff', schablone: 'gen-schiff' })) === true, 'nutztGenerator: gespeichert gen-schiff + PANTHEON_GEN=0 -> Generator');
  ok(mitGen('0', () => LP.nutztGenerator(lp, { art: 'schiff', schablone: null })) === false, 'ungebauter Eintrag (schablone null) + PANTHEON_GEN=0 -> weiter Modul');
  const k1 = mitGen('0', () => { const g2 = fakeGame(); LP.restore(JSON.parse(JSON.stringify(blk)), g2); frisch(g2, lp); return LP.karte(g2, lp); });
  ok(k1.schablone === 'gen-schiff' && k1.rows.join('') === k0.rows.join(''), 'Weltstand laden unter PANTHEON_GEN=0: dieselbe Generatorkarte, kein „Schablone gen-schiff unbekannt“');
}

// ---------------- bauversion-Wechsel ----------------
abschnitt('bauversion-Wechsel gschiff0 -> gschiff1 verwirft Zustände');
{
  LP.cacheLeeren();
  const g = fakeGame();
  const lp = LP.prise(g, 'kesh', { id: 'gs2', fraktion: 'rostmeute', x: 1, y: 1 });
  frisch(g, lp);
  const k0 = LP.karte(g, lp);
  const beute = k0.anker.find((a) => a.rolle === 'beute');
  const blk = JSON.parse(JSON.stringify(LP.toSave(g)));
  blk[lp].zustaende = { [beute.id]: 'genommen' };
  blk[lp].bauversion = 'gschiff0';   // Simulation: Stand des Vorgängers, echte Version bleibt gschiff1
  const gB = fakeGame(); let geloggt = ''; gB.log = (s) => { geloggt += s; };
  LP.cacheLeeren(); LP.restore(blk, gB); frisch(gB, lp); LP.get(gB, lp); const kB = W.AWAY_MAPS[lp].karte;
  ok(kB.bauversion === 'gschiff1' && LP.eintrag(gB, lp).bauversion === 'gschiff1', 'Karte neu gebaut mit gschiff1');
  ok(!Object.keys(LP.eintrag(gB, lp).zustaende || {}).length, 'gespeicherter Zustand des Beute-Ankers im Eintrag verworfen');
  ok(!Object.keys((gB.aways[lp] || {}).zustaende || {}).length && !(kB.anker.find((a) => a.id === beute.id) || {}).zustand, 'Zustand nicht auf die neue Karte übertragen (Laufzeit)');
  ok(/bauversion gschiff0 -> gschiff1/.test(geloggt) && /1 Zustände verworfen/.test(geloggt), 'Logbuch vermerkt Wechsel und verworfene Zustände');
  // Kontrolle: gleiche bauversion behält den Zustand
  const blk2 = JSON.parse(JSON.stringify(LP.toSave(g))); blk2[lp].zustaende = { [beute.id]: 'genommen' };
  const gC = fakeGame(); LP.cacheLeeren(); LP.restore(blk2, gC); frisch(gC, lp); LP.get(gC, lp);
  ok(LP.eintrag(gC, lp).zustaende[beute.id] === 'genommen', 'ohne Versionswechsel bleibt der Zustand erhalten');
}

// ---------------- Sammelmeldung ----------------
abschnitt('genBauen: Wurf im letzten Versuch -> Sammelmeldung mit .fehler');
{
  const GenSchiff = require('../shared/gen-schiff.js');
  const echt = GenSchiff.erzeuger;
  let aufrufe = 0;
  GenSchiff.erzeuger = () => ({ karteRoh() { aufrufe++; throw new Error('gen-schiff: kein Platz (Test)'); } });
  try {
    LP.cacheLeeren();
    const g = fakeGame();
    const id = LP.neu(g, 'kesh', { art: 'schiff', seed: 5 });
    frisch(g, id);
    let err = null; try { LP.karte(g, id); } catch (x) { err = x; } if (process.env.VERBOSE) console.log(err && err.message);
    ok(aufrufe === 6, '6 Versuche (Seed + 0..5) (' + aufrufe + ')');
    ok(!!err && /6 Versuche gescheitert/.test(err.message) && /kein Platz/.test(err.message), 'Sammelmeldung „6 Versuche gescheitert“ mit Ursache');
    ok(!!err && Array.isArray(err.fehler) && err.fehler.length > 0, 'Fehler trägt .fehler');
  } finally { GenSchiff.erzeuger = echt; LP.cacheLeeren(); }
}

// ---------------- Determinismus ----------------
abschnitt('Determinismus und Versuche');
{
  const bau = () => { const g = fakeGame(); const id = LP.neu(g, 'kesh', { art: 'schiff', seed: 99 }); frisch(g, id); LP.cacheLeeren(); return LP.karte(g, id); };
  const a = bau(), b = bau();
  ok(a.rows.join('') === b.rows.join('') && a.seed === b.seed, 'gleicher Seed = gleiche Karte');
  let alle = true;
  for (let s = 1; s <= 30; s++) { const g = fakeGame(); const id = LP.neu(g, 'kesh', { art: 'schiff', seed: s * 37 }); frisch(g, id); LP.cacheLeeren(); try { const k = LP.karte(g, id); if (!k.art) alle = false; } catch (x) { alle = false; } }
  ok(alle, '30 Seeds: alle bauen (Prüfer in genBauen bestanden)');
}

console.log(bad ? `test-schiff-anbindung: ${bad} von ${n} FEHLER` : `test-schiff-anbindung: ${n}/${n} ok`);
process.exit(bad ? 1 : 0);
