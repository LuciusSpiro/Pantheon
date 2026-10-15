'use strict';
// Kennung auf den Raumkarten (Volk = Form): Ableitung des Volks beim Erzeugen (server/sim/space.js volkFuer, escort.js für Verbündete) und das
// kompakte Snapshot-Feld vk („fehlt = Standard“: Gegner CONFIG.kennung.gegner, Verbündete CONFIG.kennung.verbuendet), Netzbudget.
//   node tools/test-kennung.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Sektoren = require('../shared/sektoren.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Flotte = require('../server/sim/flotte.js');
const Konvoi = require('../server/sim/konvoi.js');
const Registry = require('../server/mission/registry.js');

let n = 0, fails = 0;
function ok(c, msg) { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); }
function section(name, fn) {
  console.log('\n[' + name + ']');
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-kennung-'));
const K = CONFIG.kennung;

function raum(loc, np) {
  const g = new Game({ noStore: true, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  for (let i = 0; i < (np || 1); i++) {
    const c = { inbox: [], send() {}, sendRaw() {} };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'K' + i, color: i });
  }
  g.reset(); g.phase = 'play';
  space.enterScene(g, loc, {});
  g.space.enemies = []; g.space.projectiles = [];
  g.god = true;
  return g;
}
const snapE = (g) => g.snapshot().space.enemies;
const snapEsc = (g) => g.snapshot().space.escorts || [];
const byId = (list, id) => list.find((q) => q.id === id);

section('Konfiguration', () => {
  ok(K && K.voelker.join() === 'ger,rom,pirat' && K.gegner === 'ger' && K.verbuendet === 'rom', 'CONFIG.kennung: Völker, Standard Gegner ger, Verbündete rom');
  ok(CONFIG.reise.fraktionArt.ger === 'feind' && CONFIG.reise.fraktionArt.pirat === 'feind' && CONFIG.reise.fraktionArt.rom === 'sicher', 'fraktionArt: ger/pirat feindlich, rom sicher');
});

section('Eisenwald (Germanen-Sektor): Gegner ger, Snapshot ohne vk', () => {
  const g = raum('eisenwald');
  ok((Sektoren.hexDaten(Sektoren.hexVonOrt('eisenwald')) || {}).fraktion === 'ger', 'Hex Eisenwald gehört den Germanen');
  const kinds = ['raider', 'korvette', 'fregatte', 'kreuzer', 'frachter'];
  const es = kinds.map((k) => space.spawnEnemy(g, k, {}));
  ok(es.every((e) => e.volk === 'ger'), 'alle fünf Klassen: volk ger');
  const S = snapE(g);
  ok(es.every((e) => byId(S, e.id) && !('vk' in byId(S, e.id))), 'Snapshot: vk fehlt (Standard)');
  // Regiebuch-Atom spawn wie in den Kapiteln (ohne volk -> Sektor; mit volk -> ausdrücklich)
  g.mission.step = null;
  g.mission.spawn({ kind: 'raider', tag: 'nachhut', n: 2 });
  g.mission.spawn({ kind: 'korvette', tag: 'legion', n: 1, volk: 'rom' });
  const nh = g.space.enemies.filter((e) => e.tag === 'nachhut'), lg = g.space.enemies.find((e) => e.tag === 'legion');
  ok(nh.length === 2 && nh.every((e) => e.volk === 'ger'), 'spawn ohne volk: ger aus dem Sektor');
  ok(lg && lg.volk === 'rom' && byId(snapE(g), lg.id).vk === 'rom', 'spawn mit volk rom: e.volk rom, Snapshot vk rom');
  // Sonderklassen ohne Kennung
  const w = space.spawnEnemy(g, 'sentinel', {}), p = space.spawnEnemy(g, 'pylon', {});
  ok(w.volk === undefined && p.volk === undefined && !('vk' in byId(snapE(g), w.id)), 'Wächter/Pylon: kein Volk, kein vk');
  ok(space.spawnEnemy(g, 'raider', { volk: 'unsinn' }).volk === 'ger', 'ungültiges volk zählt nicht (Sektor)');
});

section('Römischer und neutraler Raum: Gegner sind Eindringlinge (Standard ger)', () => {
  const g = raum('castra_martis');
  ok((Sektoren.hexDaten(Sektoren.hexVonOrt('castra_martis')) || {}).fraktion === 'rom', 'Hex Castra Martis gehört Rom');
  ok(space.spawnEnemy(g, 'korvette', {}).volk === 'ger', 'Gegner bei Castra Martis: ger, nicht rom');
  const g2 = raum('splitter');
  ok(space.spawnEnemy(g2, 'raider', {}).volk === 'ger', 'Splittergürtel (Saum): Standard ger');
});

section('Piraten-Sektor (Karte Sund, Schrottkante): Gegner pirat', () => {
  const alt = Sektoren.KARTE;
  try {
    Sektoren.setzeKarte(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'welt', 'sund.json'), 'utf8')));
    const g = raum('splitter');
    g.ship.scene = 'schrottkante';
    ok((Sektoren.hexDaten(Sektoren.hexVonOrt('schrottkante')) || {}).fraktion === 'pirat', 'Hex Schrottkante gehört den Piraten');
    ok(space.volkFuer(g, 'kreuzer') === 'pirat', 'volkFuer: pirat');
    const e = space.spawnEnemy(g, 'kreuzer', { tag: 'piraten_kreuzer' });
    ok(e.volk === 'pirat' && byId(snapE(g), e.id).vk === 'pirat', 'Kreuzer der Piraten: Snapshot vk pirat');
    ok(space.spawnEnemy(g, 'raider', { volk: 'ger' }).volk === 'ger', 'ausdrücklich ger schlägt den Sektor');
  } finally { Sektoren.setzeKarte(alt); }
});

section('Flotte (EK4): Verbündete Roms ohne vk, Wellen mit Volk', () => {
  const g = raum('castra_martis');
  const a = Flotte.aufstellen(g, { tag: 'fulminata', kind: 'fregatte', name: 'Fulminata' });
  const b = Flotte.aufstellen(g, { tag: 'ueberlaeufer', kind: 'raider', name: 'Überläufer', volk: 'ger' });
  ok(a && a.volk === 'rom' && b && b.volk === 'ger', 'Verbündete: Standard rom, ausdrücklich ger');
  const L = snapEsc(g);
  const sa = L.find((q) => q.id === a.id), sb = L.find((q) => q.id === b.id);
  ok(sa && sa.al === 1 && !('vk' in sa), 'Snapshot: römischer Verbündeter ohne vk');
  ok(sb && sb.vk === 'ger', 'Snapshot: abweichender Verbündeter mit vk ger');
  // Wellen: Gruppe „kind:n:volk“ und spec.volk
  Flotte.wellenStart(g, { wellen: 'raider:2:pirat,korvette:1', takt: 0, rest: 0, volk: 'rom', ziel: 'lerche' });
  g.step();
  const wv = g.space.enemies.filter((e) => e.wv);
  ok(wv.some((e) => e.kind === 'raider') && wv.filter((e) => e.kind === 'raider').every((e) => e.volk === 'pirat'), 'Welle: raider:2:pirat -> pirat');
  ok(wv.filter((e) => e.kind === 'korvette').every((e) => e.volk === 'rom') && wv.some((e) => e.kind === 'korvette'), 'Welle: spec.volk rom für die übrigen');
  // Baustein-Parameter bekannt
  const defA = Registry.get ? Registry.get('flotte_aufstellen') : null;
  if (defA) ok(defA.params.volk && defA.params.volk.werte.includes('pirat'), 'Baustein flotte_aufstellen kennt volk');
});

section('Konvoi (EK3B): Sektor bzw. ausdrücklich', () => {
  const g = raum('rabenpass');
  Konvoi.an(g, { n: 2, eskorte: 'voll', sieg: 'aufhalten' });
  const kv = g.space.enemies.filter((e) => e.kv);
  ok(kv.length >= 3 && kv.every((e) => e.volk === 'ger'), 'Rabenpass (frei): Konvoi und Eskorte ger (Standard)');
  const g2 = raum('rabenpass');
  Konvoi.an(g2, { n: 1, eskorte: 'jaeger', sieg: 'aufhalten', volk: 'pirat' });
  const kv2 = g2.space.enemies.filter((e) => e.kv);
  ok(kv2.length >= 2 && kv2.every((e) => e.volk === 'pirat'), 'konvoi_an volk pirat: alle Schiffe pirat');
});

section('Netzbudget: 12 Gegner mit vk', () => {
  const g = raum('splitter', 4);
  for (let i = 0; i < 12; i++) space.spawnEnemy(g, i % 2 ? 'korvette' : 'raider', { volk: 'pirat', angle: i * 0.5 });
  const snap = g.snapshot();
  const mit = Buffer.byteLength(JSON.stringify(snap));
  const L = snap.space.enemies;
  const roh = Buffer.byteLength(JSON.stringify(L));
  const ohne = Buffer.byteLength(JSON.stringify(L.map((o) => { const c = Object.assign({}, o); delete c.vk; return c; })));
  ok(L.length === 12 && L.every((o) => o.vk === 'pirat'), 'alle 12 tragen vk pirat');
  const je = (roh - ohne) / 12;
  console.log(`    Snapshot ${mit} B, Gegnerliste mit vk ${roh} B, ohne ${ohne} B, je Gegner ${je.toFixed(1)} B`);
  ok(je <= 14, 'vk kostet höchstens 14 B je abweichendem Gegner');
  ok(mit <= CONFIG.net.snapMax - CONFIG.net.snapLuft, 'Snapshot unter snapMax − snapLuft');
});

console.log(`\n${n - fails}/${n} ok` + (fails ? `, ${fails} FEHLER` : ''));
process.exit(fails ? 1 : 0);
