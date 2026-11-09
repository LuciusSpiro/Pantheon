#!/usr/bin/env node
// KAC-01 C: Landepunkte aus der Kachel. Ein Hex mit `typ` hat je landbarem Körper einen Landepunkt <ort>.k<index> (Ort: eigenes `ort` oder k_<hex>),
// abgeleitet aus Hex -> Katalog -> Körper (server/sim/landepunkte.js kachelDef/kachelListe), ohne Eintrag in locations.js/landepunkte.json und ohne
// gespeicherte Definition im Weltstand (toSave schreibt nur Zustände). Hexe ohne `typ` bleiben bitgleich (Hash-Wächter tools/hash-raumszenen.js).
// Testkarte: Kopie von content/welt/sund_frei.json mit Testhexen, nur im Speicher. Mutationsproben: KACHEL_MUT=biom|tosave startet diesen Test
// mit absichtlich verdorbenem landepunkte.js (ein Kind-Prozess muss rot werden).
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const { spawnSync } = require('child_process');
const CONFIG = require('../shared/config.js');
const Sektoren = require('../shared/sektoren.js');
const Locations = require('../shared/locations.js');
const G = require('../shared/gen-sektor.js');
const S = require('../shared/sektortypen.js');
const Protocol = require('../shared/protocol.js');
const W = require('../server/world.js');
const Welt = require('../server/sim/welt.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const away = require('../server/sim/away.js');
const Lpscan = require('../server/sim/lpscan.js');
const interior = require('../server/sim/interior.js');
const Physics = require('../shared/physics.js');

const ROOT = path.join(__dirname, '..');
const MUT = process.env.KACHEL_MUT || '';
// landepunkte.js: normal per require; mit KACHEL_MUT eine verdorbene Kopie (der Test muss dann rot werden)
const MUTATIONEN = {
  biom: ['GenSektor.biomVon(hex, kz.index, h)', "GenSektor.biomVon(String(1000 + kz.index), kz.index, h)"],   // Biom aus dem Index statt aus dem Hex
  k1: ['function kachelZustaendeGelten(block, def) { return !(', 'function kachelZustaendeGelten(block, def) { return true || !('],   // K1: Kartenart-Regel aus
  w2: ['|| kachelDef(lpId) || null; }', '|| null; }'],   // W2: info() kennt die Kachel nicht
  k3: ['kachelCache = { version: -1, defs: new Map() };   // K3: die', '/* K3 */ void 0;   // K3: die'],   // K3: cacheLeeren leert den Kachel-Cache nicht
  tosave: ["if (!defs().byId[id] && !S.dyn[id] && kachelDef(id)) { out[id] = kachelZustand(e, kachelDef(id).art); continue; }", ''],   // Kachel-Landepunkte wie statische Defs voll in den Weltstand
};
function ladeLP() {
  const f = require.resolve('../server/sim/landepunkte.js');
  if (!MUT) return require(f);
  const [von, nach] = MUTATIONEN[MUT];
  const src = fs.readFileSync(f, 'utf8');
  const neu = src.split('\r\n').join('\n').replace(von, () => nach);
  if (neu === src.split('\r\n').join('\n')) throw new Error('Mutation ' + MUT + ' fand ihre Stelle nicht');
  const m = new Module(f, module); m.filename = f; m.paths = Module._nodeModulePaths(path.dirname(f)); m._compile(neu, f);
  return m.exports;
}
const LP = ladeLP();

let fehler = 0, n = 0;
const pruefe = (name, f) => { n++; try { f(); console.log('✓ ' + name); } catch (e) { fehler++; console.log('✗ ' + name + ': ' + e.message); } };

// ---- Testkarte (nur im Speicher) ----
const BASIS = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'welt', 'sund_frei.json'), 'utf8'));
const hexe = {
  '0103': { typ: ['planet', 'planet', 'station'], fraktion: 'rom' },   // k0 wueste, k1 wiesenwald, k2 Station (Bauweise rom)
  '0101': { typ: 'grosser_asteroid', fraktion: 'frei' },
  '0102': { typ: 'gasriese', fraktion: 'frei' },
  '0106': { typ: 'piratenlager', fraktion: 'pirat' },
  '0107': { typ: ['station', 'station'], fraktion: 'frei' },        // nicht platzierbar (zwei Stationen): erzeuge wirft
  '0201': { typ: 'planet', fraktion: 'ger', ort: 'kachel_eigen', gen: true, andocken: false },   // eigenes `ort`
  '0302': {},                                                       // Eintrag ohne typ und ohne ort
};
function testkarte() {
  const k = JSON.parse(JSON.stringify(BASIS));
  for (const [hx, h] of Object.entries(hexe)) {
    k.hexe[hx] = Object.assign({ name: 'Test ' + hx, region: 'rom', spielbar: true }, h);
  }
  return k;
}
// Hex mit Kulisse (nicht landbarer Planet) für den Typ planet suchen
function planetMitKulisse() {
  for (let c = 1; c <= 11; c++) for (let r = 1; r <= 7; r++) {
    const hx = String(c).padStart(2, '0') + String(r).padStart(2, '0');
    if (BASIS.hexe[hx] || hexe[hx]) continue;
    const kv = G.koerperVon(hx, { typ: 'planet' });
    if (kv.length === 2 && !kv[1].landbar) return hx;
  }
  throw new Error('kein Hex mit Kulisse gefunden');
}
const KULISSE = planetMitKulisse();
hexe[KULISSE] = { typ: 'planet', fraktion: 'frei' };
Sektoren.setzeKarte(testkarte());

// ---- Spielstand-Attrappe für die Landepunkt-Funktionen (wie tools/test-hoehle-verdrahtung.js) ----
function fakeGame(scene) {
  const g = { C: CONFIG, time: 0, seed: 1234, players: [], inventory: {}, aways: { platform: { map: 'platform' } }, ship: { scene, x: 0, y: 0 }, weltstand: null, mission: {},
    emit() {}, missionEvent() {}, notice() {}, oda() {}, log() {}, countError(w, e) { throw e; }, setAwayMap(id) { this.away = this.aways[id]; } };
  g.away = g.aways.platform; return g;
}
const ids = (g, ort) => LP.liste(g, ort).map((x) => x.id);
const beamVon = (g, id) => LP.liste(g, id.replace(/\.k\d+$/, '')).find((x) => x.id === id).beam;
const biomVon = (id) => { const aw = W.AWAY_MAPS[id]; return aw && aw.karte.meta.biom; };
const alsHex = (hx, extra) => Object.assign({}, testkarte().hexe[hx], extra || {});

// ---- a) je Körper ein Landepunkt ----
const g1 = fakeGame('k_0103');
pruefe('a) Hex mit typ [planet, planet, station]: drei Landepunkte k_0103.k0/k1/k2 mit beam, Art und Biom aus der Kachel', () => {
  assert.deepStrictEqual(ids(g1), ['k_0103.k0', 'k_0103.k1', 'k_0103.k2']);
  const sc = Locations.get('k_0103').scene;
  const L = LP.liste(g1);
  L.forEach((l, i) => {
    const k = sc.koerper[i];
    assert.deepStrictEqual(l.beam, { x: k.x, y: k.y, range: k.beam.range }, 'beam ' + l.id);
    assert.strictEqual(l.frei, true); assert.strictEqual(l.gesperrt, false);
  });
  assert.deepStrictEqual(L.map((l) => l.art), ['wildnis', 'wildnis', 'station']);
  assert.strictEqual(L[2].besitz, 'rom'); assert.strictEqual(L[2].bauweise, 'rom');   // aus der Hex-Fraktion (bauweiseFuerBesitz)
  const d0 = LP.kachelDef('k_0103.k0'), d1 = LP.kachelDef('k_0103.k1');
  assert.deepStrictEqual([d0.gen.biom, d1.gen.biom], [G.biomVon('0103', 0, hexe['0103']), G.biomVon('0103', 1, hexe['0103'])]);
  assert.notStrictEqual(d0.gen.biom, d1.gen.biom, 'Testhex soll zwei verschiedene Biome haben');
  assert.strictEqual(d0.kachel, true); assert.strictEqual(d0.ort, 'k_0103'); assert.ok(d0.seed >= 1 && d0.seed <= 100000);
  assert.deepStrictEqual(Object.keys(d0).sort(), ['art', 'bauweise', 'beam', 'besitz', 'frei', 'gen', 'gesperrt', 'id', 'kachel', 'name', 'neu', 'ort', 'schablone', 'seed', 'zustand'], 'Format wie neu()-Einträge + kachel/gen');
  assert.deepStrictEqual(Object.keys(LP.kachelDef('k_0103.k2')).filter((x) => x === 'gen'), [], 'Station ohne gen');
  assert.strictEqual(LP.kachelDef('k_0103.k0'), d0, 'gemerkt (gleiche Def)');
});
pruefe('a) inReichweite je Körper: Schiff am Planeten 0 -> [true,false,false], am Planeten 1 -> [false,true,false], an der Station -> [false,false,true]', () => {
  const g = fakeGame('k_0103');
  const bs = ids(g).map((id) => beamVon(g, id));
  const reich = () => LP.liste(g).map((l) => l.inReichweite);
  g.ship.x = bs[0].x + 30; g.ship.y = bs[0].y; assert.deepStrictEqual(reich(), [true, false, false]);
  g.ship.x = bs[1].x; g.ship.y = bs[1].y - 20; assert.deepStrictEqual(reich(), [false, true, false]);
  g.ship.x = bs[2].x; g.ship.y = bs[2].y; assert.deepStrictEqual(reich(), [false, false, true]);
  g.ship.x = bs[0].x + bs[0].range + 5; g.ship.y = bs[0].y; assert.ok(!reich()[0], 'knapp außerhalb');
});
pruefe('a) waehlen: ok je Körper; die Karten bauen (wildnis mit Biom aus der Kachel, station)', () => {
  const g = fakeGame('k_0103');
  assert.strictEqual(LP.waehlen(fakeGame('kesh'), 'k_0103.k0', null), 'Dieser Landepunkt liegt nicht an diesem Ort.');
  const art = {}, biom = {};
  for (const id of ids(g)) { assert.strictEqual(LP.waehlen(g, id, null), null, id); art[id] = W.AWAY_MAPS[id].karte.art; biom[id] = biomVon(id); }   // höchstens zwei Karten bleiben im Speicher (LRU): gleich prüfen
  assert.deepStrictEqual(Object.values(art), ['wildnis', 'wildnis', 'station']);
  assert.deepStrictEqual([biom['k_0103.k0'], biom['k_0103.k1']], [LP.kachelDef('k_0103.k0').gen.biom, LP.kachelDef('k_0103.k1').gen.biom]);
  assert.notStrictEqual(biom['k_0103.k0'], biom['k_0103.k1']);
});
pruefe('a) Biom der Kachel gilt vor der Welt-Tabelle biome (Orts-Tabelle bleibt für alte Orte)', () => {
  const alt = Welt.karte;
  Welt.karte = () => ({ biome: { k_0103: 'vulkan', kachel_eigen: 'vulkan' } });
  try {
    LP.cacheLeeren(); const g = fakeGame('k_0103');
    LP.get(g, 'k_0103.k0'); LP.get(g, 'k_0103.k1');
    assert.deepStrictEqual([biomVon('k_0103.k0'), biomVon('k_0103.k1')], [LP.kachelDef('k_0103.k0').gen.biom, LP.kachelDef('k_0103.k1').gen.biom]);
  } finally { Welt.karte = alt; LP.cacheLeeren(); }
});
pruefe('a) Szene mit Landepunkten, die Einträge vorher nicht kennt: weder landepunkte.json noch locations.js kennen k_0103', () => {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'welt', 'landepunkte.json'), 'utf8'));
  assert.ok(!JSON.stringify(j).includes('k_0103'));
  assert.ok(!Locations.LOCATIONS.some((l) => l.id === 'k_0103'));
  assert.ok(!LP.defs().byId['k_0103.k0']);
});

// ---- b) Weltstand ----
pruefe('b) Biom bleibt nach toSave/restore je Körper gleich; der Weltstand enthält nur Zustände, keine Kachel-Definition', () => {
  LP.cacheLeeren();
  const g = fakeGame('k_0103');
  const ref = [];
  for (const id of ids(g)) { LP.get(g, id); if (!id.endsWith('k2')) ref.push(biomVon(id)); }
  LP.betreten(g, 'k_0103.k0');
  LP.eintrag(g, 'k_0103.k0').zustaende['anker.test'] = 'gehalten-wert';
  const block = JSON.parse(JSON.stringify(LP.toSave(g)));
  assert.deepStrictEqual(Object.keys(block).sort(), ['k_0103.k0', 'k_0103.k1', 'k_0103.k2']);
  const FELDER = ['abbau_runde', 'alarm', 'bauversion', 'besuche', 'kartenart', 'letzte_mission', 'neu', 'zustaende'];   // K1: kartenart additiv
  for (const [id, e] of Object.entries(block)) {
    assert.deepStrictEqual(Object.keys(e).sort(), FELDER, 'nur Zustandsfelder in ' + id);
    for (const v of ['ort', 'beam', 'name', 'seed', 'art', 'besitz', 'bauweise', 'gen', 'schablone']) assert.ok(!(v in e), `${id}: Feld ${v} gehört nicht in den Weltstand`);
  }
  const text = JSON.stringify(block);
  assert.ok(!text.includes('wueste') && !text.includes('wiesenwald') && !text.includes('beam'), 'kein Biom/keine Lage im Weltstand');
  assert.strictEqual(block['k_0103.k0'].besuche, 1);
  // neuer Prozess-Ersatz: leerer Spielstand + leerer Karten-Cache, anderes Biom in der Welt-Tabelle darf nichts ändern
  LP.cacheLeeren();
  const alt = Welt.karte; Welt.karte = () => ({ biome: { k_0103: 'vulkan' } });
  try {
    const g2 = fakeGame('k_0103'); LP.restore(block, g2);
    assert.strictEqual(LP.eintrag(g2, 'k_0103.k0').besuche, 1); assert.strictEqual(LP.eintrag(g2, 'k_0103.k0').zustaende['anker.test'], 'gehalten-wert');
    assert.strictEqual(LP.eintrag(g2, 'k_0103.k0').seed, LP.kachelDef('k_0103.k0').seed);
    const neu = [];
    for (const id of ['k_0103.k0', 'k_0103.k1']) { LP.get(g2, id); neu.push(biomVon(id)); }
    assert.deepStrictEqual(neu, ref);
    assert.ok('k_0103.k0' in LP.toSave(g2));
  } finally { Welt.karte = alt; LP.cacheLeeren(); }
});
pruefe('b) restore verwirft Kachel-Zustände nicht (auch ohne Eintrag in defs().byId); Block zu unbekanntem Hex/Körper ohne Ort fällt weg', () => {
  const g = fakeGame('k_0103');
  LP.restore({ 'k_0103.k1': { zustaende: { a: 'b' }, besuche: 3, seed: 999, art: 'ruine', besitz: 'rom', bauversion: 'x' }, 'k_0103.k7': { zustaende: {}, besuche: 1 }, 'k_9999.k0': { besuche: 1 } }, g);
  const e = LP.eintrag(g, 'k_0103.k1');
  assert.strictEqual(e.besuche, 3); assert.deepStrictEqual(e.zustaende, { a: 'b' });
  assert.strictEqual(e.art, 'wildnis', 'Art kommt aus der Kachel, nicht aus dem Block'); assert.strictEqual(e.seed, LP.kachelDef('k_0103.k1').seed); assert.strictEqual(e.besitz, 'rom');
  assert.strictEqual(LP.eintrag(g, 'k_0103.k7'), null); assert.strictEqual(LP.eintrag(g, 'k_9999.k0'), null);
});
function biomeInKindprozess(ort) {
  const code = `const S=require('./shared/sektoren.js');const G=require('./shared/gen-sektor.js');const LP=require('./server/sim/landepunkte.js');
const k=JSON.parse(process.argv[1]);S.setzeKarte(k);console.log(JSON.stringify(['k0','k1','k2'].map((x)=>{const d=LP.kachelDef('${ort}.'+x);return d?[d.art,d.gen&&d.gen.biom,d.seed,d.beam]:null;})));`;
  const r = spawnSync(process.execPath, ['-e', code, JSON.stringify(testkarte())], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}
pruefe('b) gleicher Hex + Körper -> dasselbe Biom, derselbe Seed und dieselbe Lage in einem getrennten Prozess', () => {
  const hier = ['k0', 'k1', 'k2'].map((x) => { const d = LP.kachelDef('k_0103.' + x); return d ? [d.art, d.gen && d.gen.biom, d.seed, d.beam] : null; });
  assert.deepStrictEqual(biomeInKindprozess('k_0103'), JSON.parse(JSON.stringify(hier)));
});
pruefe('b) Regressionsprobe der Erkundung: zwei Planeten bekommen wueste/wiesenwald (nicht vulkan/vulkan wie bei der Ort-Tabelle)', () => {
  assert.deepStrictEqual(['k0', 'k1'].map((x) => LP.kachelDef('k_0103.' + x).gen.biom), ['wueste', 'wiesenwald']);
  // über mehrere Hexe: Biom je Körper == Biom der Szene (biomVon aus Hex + Index), nie ein Hex-übergreifender Wert
  let verschieden = 0;
  for (const hx of ['0103', '0201', KULISSE]) {
    const ort = Sektoren.ortVonHex(hx);
    for (const l of LP.kachelListe(null, ort)) if (l.art === 'wildnis') {
      const idx = Number(l.id.split('.k')[1]);
      assert.strictEqual(l.gen.biom, G.biomVon(hx, idx, testkarte().hexe[hx]), l.id); verschieden++;
    }
  }
  assert.ok(verschieden >= 3);
  // Index-Mutation würde Hexe mit gleichem Index vereinheitlichen: Hexe 0103.k0 / 0201.k0 / KULISSE.k0 müssen nicht gleich sein
  const b = ['0103', '0201', KULISSE].map((hx) => G.biomVon(hx, 0, testkarte().hexe[hx]));
  assert.ok(new Set(b).size >= 2, 'Testhexe sollen unterschiedliche Biome für Index 0 haben: ' + b);
});

// ---- c) Altstand und Hexe ohne typ ----
pruefe('c) Altstand ohne Kachel-Block lädt unverändert (Weltstand-Version bleibt 3, statische und dyn-Einträge wie vorher)', () => {
  const Weltstand = require('../server/weltstand.js');
  assert.strictEqual(fs.readFileSync(path.join(ROOT, 'server', 'weltstand.js'), 'utf8').match(/const VERSION = (\d+)/)[1], '3');
  const g = fakeGame('kesh');
  const dyn = LP.neu(g, 'kesh', { art: 'wildnis', seed: 5, gen: { biom: 'vulkan' } });   // wird gespeichert (nicht test)
  LP.eintrag(g, 'kesh.kastell').besuche = 2;
  const alt = JSON.parse(JSON.stringify(LP.toSave(g)));
  assert.ok(alt[dyn] && alt['kesh.kastell'] && !Object.keys(alt).some((k) => /^k_/.test(k) || /\.k\d+$/.test(k)));
  const g2 = fakeGame('kesh'); LP.restore(alt, g2);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(LP.toSave(g2))), alt);
  assert.ok(Weltstand);
});
pruefe('c) Hexe ohne typ: liste/def/ortVonHex unverändert (kachelDef null, keine Zusatzeinträge)', () => {
  const g = fakeGame('kesh');
  assert.deepStrictEqual(LP.liste(g, 'kesh').map((l) => l.id), (LP.defs().orte.kesh || []).map((d) => d.id));
  assert.strictEqual(LP.kachelDef('kesh.kastell'), null); assert.strictEqual(LP.kachelDef('kesh'), null); assert.strictEqual(LP.kachelDef('b7.aussenstelle'), null);
  assert.strictEqual(LP.kachelDef('k_0302.k0'), null); assert.strictEqual(LP.kachelDef('leer-0301.k0'), null); assert.strictEqual(LP.kachelDef(null), null);
  assert.deepStrictEqual(LP.kachelListe(g, 'kesh'), []); assert.deepStrictEqual(LP.kachelListe(g, 'leer-0301'), []); assert.deepStrictEqual(LP.kachelListe(g, null), []);
  assert.strictEqual(Sektoren.ortVonHex('0302'), null, 'Hex ohne typ und ohne ort: wie bisher null'); assert.strictEqual(Sektoren.hexVonOrt('k_0302'), null);
  assert.strictEqual(Sektoren.ortVonHex('0301'), 'leer-0301');
  assert.strictEqual(LP.liste(fakeGame('leer-0301'), 'leer-0301').length, 0);
});

// ---- d) nicht landbar ----
pruefe('d) Kulisse (fels/eis/ozean) und Gasriese: kein Landepunkt, waehlen darauf = Fehler', () => {
  const ort = Sektoren.ortVonHex(KULISSE); const g = fakeGame(ort);
  const sc = Locations.get(ort).scene;
  assert.strictEqual(sc.koerper.length, 2); assert.strictEqual(sc.koerper[1].landbar, false);
  assert.deepStrictEqual(ids(g, ort), [ort + '.k0']);
  assert.strictEqual(LP.kachelDef(ort + '.k1'), null);
  assert.strictEqual(LP.waehlen(g, ort + '.k1', null), 'Landepunkt unbekannt.');
  const gg = fakeGame('k_0102');
  assert.deepStrictEqual(ids(gg, 'k_0102'), []); assert.strictEqual(LP.kachelDef('k_0102.k0'), null);
  assert.strictEqual(LP.waehlen(gg, 'k_0102.k0', null), 'Landepunkt unbekannt.');
  assert.strictEqual(LP.waehlen(gg, 'k_0102.k5', null), 'Landepunkt unbekannt.');
});

// ---- e) grosser_asteroid ----
function neuesSpiel() {
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'Kachel', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'free' });
  g.handleMessage(c, { t: 'ready', ready: true });
  g.god = true;
  const run = (sec) => { for (let k = 0; k < Math.round(sec / (1 / CONFIG.tickHz)); k++) g.step(); };
  return { g, c, run, p: g.players[0] };
}
const stehen = (T, x, y) => { T.g.ship.x = x; T.g.ship.y = y; T.g.ship.vx = 0; T.g.ship.vy = 0; T.g.ship.speed = 0; T.run(0.2); };
const lpListe = (g) => require('../server/sim/landepunkte.js').liste(g);
pruefe('e) grosser_asteroid: Landepunkt art hoehle; Beamen baut die Höhlenkarte direkt (kein Wildnis-Zwischenschritt) und stellt an den ankunft-Abholpunkt', () => {
  const T = neuesSpiel(); const g = T.g;
  Sektoren.setzeKarte(testkarte());
  space.enterScene(g, 'k_0101', {}); T.run(0.3);
  const L = lpListe(g);
  assert.deepStrictEqual(L.map((l) => [l.id, l.art]), [['k_0101.k0', 'hoehle']]);
  stehen(T, L[0].beam.x, L[0].beam.y);
  g.explore.known.add('k_0101'); Lpscan.markieren(g, 'k_0101.k0');
  assert.strictEqual(g.chooseLandepunkt(T.p, 'k_0101.k0'), null);
  assert.deepStrictEqual(away.canBeam(g, 'down'), { ok: true });
  assert.ok(!Object.keys(g.aways).some((id) => /wildnis/.test(id)) && Object.keys(g.aways).filter((id) => /^k_/.test(id)).join() === 'k_0101.k0');
  away.executeBeam(g, [T.p.id], 'down');
  const ai = interior.awayInfoOf('k_0101.k0');
  assert.strictEqual(ai.karte.art, 'hoehle'); assert.strictEqual(T.p.zone, 'away'); assert.strictEqual(g.away.map, 'k_0101.k0');
  const ank = ai.karte.anker.filter((a) => a.ankunft);
  assert.strictEqual(ank.length, 1); assert.strictEqual(ank[0].rolle, 'abholpunkt');
  const t = Physics.toTile(T.p.x, T.p.y);
  assert.ok(ai.ankunftPads.some((q) => q.x === t.x && q.y === t.y), `Spieler auf Kachel ${t.x},${t.y} nicht auf den ankunft-Pads`);
  assert.ok(ai.ankunftPads.some((q) => q.x === ank[0].x && q.y === ank[0].y), 'ankunft-Pads liegen am Abholpunkt');
});
pruefe('e) Karte der Asteroiden-Kachel: Seed/Besitz/Zustand aus Hex, Katalog-Kartenart hoehle; Piratenlager = aussenposten (raubzug)', () => {
  const d = LP.kachelDef('k_0101.k0');
  assert.strictEqual(d.art, 'hoehle'); assert.strictEqual(d.besitz, 'herrenlos'); assert.ok(!d.gen);
  const p = LP.kachelDef('k_0106.k0');
  assert.strictEqual(p.art, 'aussenposten'); assert.strictEqual(p.besitz, 'raubzug');
  const g = fakeGame('k_0106'); assert.strictEqual(LP.waehlen(g, 'k_0106.k0', null), null); assert.strictEqual(W.AWAY_MAPS['k_0106.k0'].karte.art, 'aussenposten');
});

// ---- f) Orte/Hexe ----
pruefe('f) ortVonHex/hexVonOrt für k_<hex>; typ-Hex mit eigenem ort; datenOrt baut die Szene mit gen:true', () => {
  assert.strictEqual(Sektoren.ortVonHex('0103'), 'k_0103'); assert.strictEqual(Sektoren.hexVonOrt('k_0103'), '0103');
  assert.strictEqual(Sektoren.ortVonHex('0201'), 'kachel_eigen'); assert.strictEqual(Sektoren.hexVonOrt('kachel_eigen'), '0201');
  assert.strictEqual(Sektoren.hexVonOrt('k_0201'), null, 'Hex mit eigenem ort heißt nur nach dem ort');
  assert.strictEqual(Sektoren.hexVonOrt('k_0302'), null); assert.strictEqual(Sektoren.hexVonOrt('k_0105'), null);
  const o = Sektoren.datenOrt('k_0103');
  assert.ok(o && o.id === 'k_0103' && o.gen === true && o.hex === '0103' && o.scene.koerper.length === 3 && o.scene.typ.length === 3);
  assert.strictEqual(Locations.get('k_0103'), o, 'Locations.get liefert dieselbe Szene');
  assert.strictEqual(Sektoren.datenOrt('kachel_eigen').id, 'kachel_eigen');
  assert.ok(Sektoren.datenOrte().includes('k_0103') && Sektoren.datenOrte().includes('kachel_eigen') && !Sektoren.datenOrte().includes('k_0302'));
  assert.deepStrictEqual(ids(fakeGame('kachel_eigen'), 'kachel_eigen'), ['kachel_eigen.k0']);
  assert.strictEqual(LP.kachelDef('kachel_eigen.k0').besitz, 'ger');
  assert.strictEqual(LP.kachelDef('k_0201.k0'), null, 'k_<hex> gibt es nur ohne eigenes ort');
  assert.strictEqual(Sektoren.hatTyp(), true);
});
pruefe('f) Karten ohne typ ändern sich nicht: Limes/Sund/Sund_frei ohne typ-Hex, hatTyp false, kein k_-Ort', () => {
  for (const id of ['limes', 'sund', 'sund_frei']) {
    const K = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'welt', id + '.json'), 'utf8'));
    Sektoren.setzeKarte(K);
    assert.strictEqual(Sektoren.hatTyp(), false, id);
    assert.strictEqual(Welt.katalogFuerClient(), null, id);
    assert.ok(!Object.keys(K.hexe).some((hx) => /^k_/.test(Sektoren.ortVonHex(hx) || '')), id);
  }
  Sektoren.setzeKarte(testkarte());
});
const stumm = (f) => { const e = console.error; const log = []; console.error = (...a) => log.push(a.join(' ')); try { return [f(), log]; } finally { console.error = e; } };
pruefe('f) Fehlerverhalten: unplatzierbarer typ (zwei Stationen) -> keine Szene, einmalige Meldung je Hex, Hex nicht anfliegbar, kein Absturz', () => {
  Sektoren.setzeKarte(testkarte());
  const [r, log] = stumm(() => {
    const a = Sektoren.datenOrt('k_0107'), b = Sektoren.datenOrt('k_0107'), c = Locations.get('k_0107');
    return [a, b, c, Sektoren.datenOrte().includes('k_0107'), LP.liste(fakeGame('k_0107'), 'k_0107'), LP.kachelDef('k_0107.k0')];
  });
  assert.deepStrictEqual([r[0], r[1], r[2]], [null, null, null]); assert.deepStrictEqual(r[4], []); assert.strictEqual(r[5], null);
  assert.strictEqual(log.length, 1, 'genau eine Meldung: ' + log.length);
  assert.ok(/0107/.test(log[0]) && /Station/i.test(log[0]), log[0]);
});

// ---- g) Katalog-Auslieferung ----
pruefe('g) Server: Karte ohne typ -> welcome unverändert (Byte-Vergleich, kein Feld sektortypen); Karte mit typ -> Katalog enthalten', () => {
  const T = neuesSpiel(); const g = T.g;
  Sektoren.setzeKarte(JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'welt', 'limes.json'), 'utf8')));
  const m = g.welcomeMsg(T.p.id);
  const alt = { t: 'welcome', pid: T.p.id, serverVersion: m.serverVersion, debug: g.debug, roomCode: g.roomCode, sektorkarte: Sektoren.fuerClient() };
  assert.strictEqual(JSON.stringify(m), JSON.stringify(alt), 'welcome byteweise wie vor KAC-01 C');
  assert.ok(!('sektortypen' in m));
  Sektoren.setzeKarte(testkarte());
  const m2 = g.welcomeMsg(T.p.id);
  assert.deepStrictEqual(m2[Protocol.WELCOME_SEKTORTYPEN], S.katalog()); assert.strictEqual(Protocol.WELCOME_SEKTORTYPEN, 'sektortypen');
  const o = Object.assign({}, m2); delete o.sektortypen; delete o.sektorkarte;
  assert.deepStrictEqual(Object.keys(o).sort(), ['debug', 'pid', 'roomCode', 'serverVersion', 't']);
});
pruefe('g) Server: Kartenwechsel (Welt.waehle) sendet sektortypen nur bei Karten mit typ; ohne typ bleibt die Nachricht byteweise gleich', () => {
  const gesendet = [];
  const spiel = { broadcast(m) { gesendet.push(m); } };
  Sektoren.setzeKarte(JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'welt', 'limes.json'), 'utf8')));
  Welt.waehle(spiel, 'sund_frei');
  assert.strictEqual(gesendet.length, 1);
  assert.strictEqual(JSON.stringify(gesendet[0]), JSON.stringify({ t: 'sektorkarte', sektorkarte: Sektoren.fuerClient() }));
  Sektoren.setzeKarte(testkarte());
});
pruefe('g) Client: setzeKatalog vor setzeKarte (Reihenfolge in client.js), ohne Katalog fehlt er; Szene baut danach ohne Fehler', () => {
  const quelle = fs.readFileSync(path.join(ROOT, 'public', 'js', 'client.js'), 'utf8').replace(/\r\n/g, '\n');
  const a = quelle.indexOf('function setzeSektorkarte(k, katalog) {'); assert.ok(a > 0, 'setzeSektorkarte(k, katalog) fehlt');
  const e = quelle.indexOf('\n  }\n', a); const fn = quelle.slice(a, e + 4);
  assert.ok(/msg\.sektorkarte, msg\.sektortypen/.test(quelle.slice(quelle.indexOf("case 'welcome':"), quelle.indexOf("case 'snap':"))), 'welcome und sektorkarte reichen msg.sektortypen durch');
  const aufrufe = [];
  const fenster = { Shared_Sektoren: { KARTE: null, setzeKarte(k) { aufrufe.push('karte'); this.KARTE = k; } }, Shared_GenSektor: { setzeKatalog(c) { aufrufe.push('katalog'); } }, StarMap: { setKarte() { aufrufe.push('starmap'); } } };
  const setze = new Function('window', fn + '; return setzeSektorkarte;')(fenster);
  const K = testkarte();
  setze(K, S.katalog()); assert.deepStrictEqual(aufrufe, ['katalog', 'karte', 'starmap']);
  aufrufe.length = 0; setze(Object.assign({}, K), undefined); assert.deepStrictEqual(aufrufe, ['karte', 'starmap'], 'ohne Katalog (Limes/Sund) kein setzeKatalog');
  // Browser-Simulation: gen-sektor/sektortypen ohne Node-Modulsystem, setzeKatalog mit dem gesendeten (JSON-kopierten) Katalog
  const sb = { console }; sb.self = sb; sb.window = sb; vm.createContext(sb);
  for (const f of ['shared/sektortypen.js', 'shared/gen-sektor.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  const erz = (hx) => vm.runInContext(`Shared_GenSektor.erzeuge('${hx}', ${JSON.stringify(hexe['0103'])})`, sb);
  assert.throws(() => erz('0103'), /Sektortypen-Katalog nicht gesetzt/);
  vm.runInContext(`Shared_GenSektor.setzeKatalog(${JSON.stringify(JSON.parse(JSON.stringify(S.katalog())))})`, sb);
  const clientSzene = erz('0103'), serverSzene = G.erzeuge('0103', hexe['0103']);
  assert.strictEqual(JSON.stringify(clientSzene), JSON.stringify(serverSzene), 'Client baut dieselbe Szene wie der Server');
  assert.strictEqual(clientSzene.id, 'k_0103');
});
pruefe('g) Client lädt weiterhin Limes ohne Katalog: gen-sektor baut Hexe ohne typ ohne setzeKatalog', () => {
  const sb = { console }; sb.self = sb; sb.window = sb; vm.createContext(sb);
  for (const f of ['shared/sektortypen.js', 'shared/gen-sektor.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  const L = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'welt', 'limes.json'), 'utf8'));
  const [hx, h] = Object.entries(L.hexe).find(([, v]) => v.gen && v.ort);
  assert.strictEqual(vm.runInContext(`JSON.stringify(Shared_GenSektor.erzeuge('${hx}', ${JSON.stringify(h)}))`, sb), JSON.stringify(G.erzeuge(hx, h)));
});

// ---- Spiel: Landescan und Beamen je Körper (echte Game-Klasse) ----
pruefe('Spiel: Scan, transfer.ziel und Beam-Reichweite je Körper (Landescan wie im Spiel)', () => {
  const T = neuesSpiel(); const g = T.g;
  Sektoren.setzeKarte(testkarte());
  space.enterScene(g, 'k_0103', {}); T.run(0.3);
  const L = lpListe(g);
  assert.deepStrictEqual(L.map((l) => l.id), ['k_0103.k0', 'k_0103.k1', 'k_0103.k2']);
  stehen(T, L[0].beam.x + 30, L[0].beam.y);
  assert.deepStrictEqual(lpListe(g).map((l) => l.inReichweite), [true, false, false]);
  g.explore.known.add('k_0103'); T.p.console = 'weapons';
  assert.strictEqual(Lpscan.starten(g, T.p), null); T.run(4.6);
  assert.ok(Lpscan.gescannt(g, 'k_0103.k0'), 'Planet 0 gescannt');
  Lpscan.markieren(g, 'k_0103.k1'); Lpscan.markieren(g, 'k_0103.k2');
  for (let i = 0; i < 3; i++) {
    const lp = L[i];
    stehen(T, lp.beam.x + 20, lp.beam.y);
    assert.strictEqual(g.chooseLandepunkt(T.p, lp.id), null, lp.id);
    assert.deepStrictEqual(g.transferZiel, { lp: lp.id, scene: 'k_0103' });
    assert.deepStrictEqual(away.canBeam(g, 'down'), { ok: true }, lp.id + ' in Reichweite');
    const andere = L.filter((_, j) => j !== i);
    for (const o of andere) { stehen(T, o.beam.x + o.beam.range + 40, o.beam.y); assert.ok(!away.canBeam(g, 'down').ok, `${lp.id} nicht erreichbar von außerhalb`); break; }
    stehen(T, lp.beam.x - lp.beam.range - 40, lp.beam.y);
    assert.ok(!away.canBeam(g, 'down').ok && /Zu weit/.test(away.canBeam(g, 'down').reason), lp.id + ' außerhalb: zu weit');
  }
  assert.strictEqual(g.chooseLandepunkt(T.p, 'k_0103.k5'), 'Landepunkt unbekannt.', 'unbekannter Körper');
  assert.strictEqual(g.chooseLandepunkt(T.p, 'k_0102.k0'), 'Landepunkt unbekannt.', 'Gasriese');
});
pruefe('Spiel: weltstand-Pfad der Partie speichert keine Kachel-Definition (toSave im laufenden Spiel)', () => {
  const T = neuesSpiel(); const g = T.g;
  Sektoren.setzeKarte(testkarte());
  space.enterScene(g, 'k_0103', {}); T.run(0.3);
  const lpm = require('../server/sim/landepunkte.js');
  for (const l of lpListe(g)) lpm.get(g, l.id);
  const text = JSON.stringify(lpm.toSave(g));
  assert.ok(!/"ort"|"beam"|"name"|"seed"|"art"|"gen"/.test(text), text.slice(0, 200));
});

// ---- i) Nacharbeit W1/W2/K1/K3/K4 ----
const SPRUNG = require('../server/sim/sprung.js');
const REISE = require('../server/sim/reise.js');
const CTX = require('../server/mission/context.js');
// Testkarte mit offener Kante 0106 (Piratenlager) -> 0107 (zwei Stationen, nicht platzierbar)
function karteMitKante() { const k = testkarte(); k.kanten = k.kanten.concat([{ a: '0106', b: '0107', art: 'open' }]); return k; }
pruefe('i) W1 hatSzene: ohne typ bitgleich zu `!!ortVonHex` auf allen Hexen von limes/sund/sund_frei (Leerraum eingeschlossen)', () => {
  let anzahl = 0;
  for (const id of ['limes', 'sund', 'sund_frei']) {
    const K = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'welt', id + '.json'), 'utf8'));
    Sektoren.setzeKarte(K);
    for (let c = 1; c <= K.spalten; c++) for (let r = 1; r <= K.zeilen; r++) {
      const hx = String(c).padStart(2, '0') + String(r).padStart(2, '0');
      assert.strictEqual(Sektoren.hatSzene(hx), !!Sektoren.ortVonHex(hx), `${id} ${hx}`); anzahl++;
    }
  }
  assert.ok(anzahl >= 200, 'Hexe verglichen: ' + anzahl); console.log('    Hexe verglichen: ' + anzahl);
  Sektoren.setzeKarte(testkarte());
});
pruefe('i) W1 hatSzene: unplatzierbares typ-Hex (0107) false obwohl ortVonHex gesetzt; platzierbares (0103) und typ-Hex mit eigenem ort true', () => {
  Sektoren.setzeKarte(testkarte());
  const [r] = stumm(() => [Sektoren.hatSzene('0107'), Sektoren.hatSzene('0103'), Sektoren.hatSzene('0201'), Sektoren.hatSzene('0302'), Sektoren.hatSzene('0108')]);
  assert.strictEqual(Sektoren.ortVonHex('0107'), 'k_0107');
  assert.deepStrictEqual(r.slice(0, 3), [false, true, true]);
});
pruefe('i) W1 Notsprung und Zielfilter: nie in ein Hex ohne baubare Szene; notsprung() wirft nicht und teleportiert nicht nach hafen', () => {
  const T = neuesSpiel(); const g = T.g;
  Sektoren.setzeKarte(karteMitKante());
  const [res] = stumm(() => {
    space.enterScene(g, 'k_0106', {}); T.run(0.3);
    const kand = SPRUNG.notsprungKandidaten(g);
    const nb = SPRUNG.nachbarOrte(g, 'k_0106');
    const umk = REISE.weich(g, '0106', '0107', false);
    const ziel = SPRUNG.zielId('0107');
    return { kand, nb, umk, ziel };
  });
  assert.ok(res.kand.length > 0 && !res.kand.includes('0107'), 'Kandidaten: ' + res.kand.join());
  assert.ok(!res.nb.includes('k_0107'), 'nachbarOrte: ' + res.nb.join());
  assert.strictEqual(res.umk, null, 'weiche Route nach 0107'); assert.strictEqual(res.ziel, null, 'zielId(0107)');
  const [err] = stumm(() => {
    g.ship.reactorCtl = g.ship.reactorCtl || {}; g.rng = Object.assign(() => 0.99, { pick: (a) => a[a.length - 1] });
    return SPRUNG.notsprung(g);
  });
  assert.strictEqual(err, null, 'notsprung: ' + err);
  assert.notStrictEqual(g.ship.scene, 'hafen'); assert.notStrictEqual(g.ship.scene, 'k_0107');
  assert.ok(Locations.get(g.ship.scene), 'Szene vorhanden');
});
pruefe('i) W2 Kachel-Landepunkt in lpScanVon (Name, x/y wie liste) und im Kontext-Adapter (info/bekannt nach Bau/Besuch)', () => {
  const T = neuesSpiel(); const g = T.g;
  Sektoren.setzeKarte(testkarte());
  space.enterScene(g, 'k_0103', {}); T.run(0.3);
  const lp = LP.liste(g, 'k_0103').find((x) => x.id === 'k_0103.k0');
  g.explore.lpScan.add('k_0103.k0');
  const scan = g.explore.lpScanVon('k_0103');
  assert.deepStrictEqual(scan, [{ id: 'k_0103.k0', name: lp.name, x: Math.round(lp.beam.x), y: Math.round(lp.beam.y) }]);
  assert.notStrictEqual(lp.name, 'k_0103.k0');
  const ad = CTX.lpAdapter(g);
  const d = ad.info('k_0103.k0');
  assert.ok(d && d.kachel === true && d.art === 'wildnis', 'info liefert die Kachel-Def');
  assert.strictEqual(ad.bekannt('k_0103.k0'), false, 'vor dem Bau unbekannt');
  LP.get(g, 'k_0103.k0');
  assert.strictEqual(ad.bekannt('k_0103.k0'), true, 'nach dem Bau bekannt');
  assert.strictEqual(CTX.lpAdapter({}).info('k_0103.k0').id, 'k_0103.k0', 'auch ohne game.landepunkte');
  assert.strictEqual(ad.info('gibt.es.nicht'), null); assert.strictEqual(LP.info(g, 'k_0103.k0').kachel, true, 'LP.info kennt die Kachel');
  assert.strictEqual(LP.info({}, 'carrara.k0'), null);
});
pruefe('i) W2 info() für Nicht-Kachel-IDs wie vorher: statische Defs und dyn', () => {
  const g = fakeGame('carrara'); const alleIds = Object.keys(LP.defs().byId);
  assert.ok(alleIds.length > 5);
  for (const id of alleIds) assert.strictEqual(LP.info(g, id), LP.defs().byId[id], id);
  g.landepunkte = { eintraege: {}, lru: [], dyn: { 'x.dyn-1': { id: 'x.dyn-1', ort: 'x' } } };
  assert.strictEqual(LP.info(g, 'x.dyn-1'), g.landepunkte.dyn['x.dyn-1']);
});
pruefe('i) K1 Kartenart im Weltstand: gespeicherte Art != abgeleitete Art -> Zustände verworfen; gleich -> übernommen; Altstand ohne Feld -> übernommen', () => {
  Sektoren.setzeKarte(testkarte()); LP.cacheLeeren();
  const g = fakeGame('k_0103');
  LP.eintrag(g, 'k_0103.k0').zustaende['anker.test'] = 'x';
  const block = JSON.parse(JSON.stringify(LP.toSave(g)));
  assert.strictEqual(block['k_0103.k0'].kartenart, LP.kachelDef('k_0103.k0').art);
  assert.strictEqual(block['k_0103.k0'].kartenart, 'wildnis');
  const mit = (b) => { const g2 = fakeGame('k_0103'); LP.restore({ 'k_0103.k0': b }, g2); return LP.eintrag(g2, 'k_0103.k0'); };
  assert.deepStrictEqual(mit(Object.assign({}, block['k_0103.k0'])).zustaende, { 'anker.test': 'x' });
  assert.deepStrictEqual(mit(Object.assign({}, block['k_0103.k0'], { kartenart: 'station' })).zustaende, {}, 'Art geändert -> verworfen');
  const alt = Object.assign({}, block['k_0103.k0']); delete alt.kartenart;
  assert.deepStrictEqual(mit(alt).zustaende, { 'anker.test': 'x' }, 'Altstand ohne Feld lädt unverändert');
  assert.strictEqual(LP.kachelZustaendeGelten({ kartenart: 'a' }, { art: 'b' }), false); assert.strictEqual(LP.kachelZustaendeGelten({}, { art: 'b' }), true);
});
pruefe('i) K3 cacheLeeren() und neuLaden() leeren den Kachel-Cache', () => {
  Sektoren.setzeKarte(testkarte());
  const a = LP.kachelDef('k_0103.k0'); assert.strictEqual(LP.kachelDef('k_0103.k0'), a, 'gecached');
  LP.cacheLeeren(); const b = LP.kachelDef('k_0103.k0'); assert.notStrictEqual(b, a, 'nach cacheLeeren neu abgeleitet'); assert.deepStrictEqual(b, a);
  LP.neuLaden(); const c = LP.kachelDef('k_0103.k0'); assert.notStrictEqual(c, b, 'nach neuLaden neu abgeleitet');
});
pruefe('i) K4 eine Regel: typ-Hex mit ort ohne gen:true ist kein Kachel-Hex (datenOrt null, nicht in datenOrte); mit gen oder ohne ort schon; ohne typ unverändert', () => {
  const k = testkarte();
  k.hexe['0201'] = { name: 'Fest', region: 'rom', spielbar: true, typ: 'planet', ort: 'fest_ort' };
  Sektoren.setzeKarte(k);
  assert.strictEqual(Sektoren.istKachelHex(k.hexe['0201']), false);
  assert.strictEqual(Sektoren.datenOrt('fest_ort'), null); assert.ok(!Sektoren.datenOrte().includes('fest_ort'));
  assert.strictEqual(Sektoren.hatSzene('0201'), true, 'Hex bleibt ein Hex mit fest codierter Szene (ortVonHex gesetzt)');
  for (const hx of ['0103', '0106']) assert.strictEqual(Sektoren.istKachelHex(k.hexe[hx]), true);
  assert.strictEqual(Sektoren.istKachelHex({ typ: 'planet', ort: 'a', gen: true }), true);
  assert.strictEqual(Sektoren.istKachelHex({ ort: 'a', gen: true }), false); assert.strictEqual(Sektoren.istKachelHex(null), false);
  Sektoren.setzeKarte(testkarte());
  assert.ok(Sektoren.datenOrte().includes('kachel_eigen') && Sektoren.datenOrt('kachel_eigen'));
  for (const id of ['limes', 'sund', 'sund_frei']) {
    const K = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'welt', id + '.json'), 'utf8')); Sektoren.setzeKarte(K);
    const soll = Object.keys(K.hexe).filter((h) => K.hexe[h].gen && K.hexe[h].ort).sort().map((h) => K.hexe[h].ort);
    assert.deepStrictEqual(Sektoren.datenOrte(), soll, id);
  }
  Sektoren.setzeKarte(testkarte());
});

// ---- h) Mutationsproben ----
if (!MUT) {
  for (const m of Object.keys(MUTATIONEN)) {
    pruefe(`h) Mutationsprobe ${m}: verdorbenes landepunkte.js -> dieser Test wird rot`, () => {
      const r = spawnSync(process.execPath, [__filename], { cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, { KACHEL_MUT: m }), timeout: 120000 });
      assert.notStrictEqual(r.status, 0, 'Mutation ' + m + ' blieb unbemerkt');
      assert.ok(/✗/.test(r.stdout), 'kein roter Befund in der Ausgabe');
    });
  }
}
console.log(`\n${n - fehler}/${n} Prüfungen grün`);
process.exit(fehler ? 1 : 0);
