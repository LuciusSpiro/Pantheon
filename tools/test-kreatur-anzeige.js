'use strict';
// MON-01 P4: Kreaturen sichtbar und scanbar. Echtes Spiel (Game, Station Helix, Debug `kreatur`, `scanfertig`).
// Geprüft: Anmeldung der Scan-Art `monster` (nur Lebende, billig), Scan Stufe 1/2/3 (Position erst ab 3, sk steigt nur, bewegtes Ziel zieht nach), Snapshot-Feld away.kr
// (nur bei lebenden, sichtbaren Kreaturen, Felder und Bits, Größe je Kreatur, Tote nicht), ohne Kreaturen identischer Snapshot, Datenblatt-Eintrag `probe` (Texte, Grenzen),
// Einhängestellen im Client (client.js, render.js, voxel/actors.js) am Quelltext.
//   node tools/test-kreatur-anzeige.js   (npm run test:kreatur-anzeige)
const fs = require('fs');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Locations = require('../shared/locations.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Welt = require('../server/sim/welt.js');
const away = require('../server/sim/away.js');
const Scanbar = require('../server/sim/scanbar.js');
const Kreatur = require('../server/sim/kreatur.js');
const Monster = require('../server/sim/monster.js');
const SA = require('../public/js/scan-anzeige.js');
const KREATUREN = require('../content/kampf/kreaturen.json');
const DATEN = require('../content/scanner/datenblaetter.json');

const DT = 1 / CONFIG.tickHz;
const TILE = 32;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (name, body) => {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
};
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const bytes = (v) => Buffer.byteLength(JSON.stringify(v));

function szene() {
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send() {}, sendRaw() {} };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'T0', name: 'Kre', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'free' }); g.handleMessage(c, { t: 'ready', ready: true });
  Welt.waehle(g, 'sund'); g.god = true; space.enterScene(g, 'helix', {});
  const sc = Locations.get('helix').scene; g.ship.x = sc.station.x - 100; g.ship.y = sc.station.y;
  const run = (sec) => { for (let k = 0; k < Math.round(sec / DT); k++) g.step(); };
  run(0.2);
  g.chooseLandepunkt(g.players[0], 'helix.station');
  away.executeBeam(g, g.players.map((q) => q.id), 'down');
  run(0.3);
  g.away.monster = null;
  const p = g.players[0];
  const m = Monster.maskeVon(g.karteOf(g.away.map));
  // längste waagerechte Strecke freier Ankerpunkte: der Spieler steht darin, die Kreaturen liegen in Sicht auf derselben Zeile
  let best = null;
  for (let cy = 2; cy < m.h - 1; cy++) {
    let cx = 1;
    while (cx < m.w) {
      if (!m.geht(cx, cy)) { cx++; continue; }
      let e = cx; while (m.geht(e + 1, cy)) e++;
      if (!best || e - cx > best.cx1 - best.cx0) best = { cy, cx0: cx, cx1: e };
      cx = e + 1;
    }
  }
  p.x = (best.cx0 + 1) * TILE; p.y = best.cy * TILE; p.downed = false;
  return { g, c, p, run, dbg: (cmd, extra) => g.handleMessage(c, Object.assign({ t: 'debug', cmd }, extra || {})) };
}
const S = szene();
const { g, p } = S;
const aw = g.away;

section('Anmeldung der Scan-Art monster', () => {
  let doppelt = false;
  try { Scanbar.scanbarAnmelden('monster', { ziele: () => [] }); } catch (e) { doppelt = /bereits angemeldet/.test(e.message); }
  ok(doppelt, 'Art `monster` ist beim Laden von kreatur.js angemeldet (zweite Anmeldung wird abgelehnt)');
  const src = read('server/sim/kreatur.js');
  ok(/scanbarAnmelden\('monster'[\s\S]*tiefen: \{ position: 3 \}/.test(src), 'Positionsstufe 3 steht in der Anmeldung');
});

section('Snapshot ohne Kreaturen', () => {
  const s0 = g.snapshot();
  ok(!('kr' in s0.away), 'ohne Kreaturen kein Feld kr');
  S.dbg('kreatur', { typ: 'probe' });
  ok(aw.kreaturen && aw.kreaturen.length === 1, 'Debug kreatur probe legt eine Kreatur an');
  aw.kreaturen[0].alive = false;
  ok(!('kr' in g.snapshot().away), 'nur tote Kreaturen: kein Feld kr (nie ein leeres Array)');
  aw.kreaturen = [];
  ok(JSON.stringify(g.snapshot().away) === JSON.stringify(s0.away), 'nach dem Räumen ist away identisch zum Stand vor den Kreaturen (JSON)');
  aw.kreaturSeq = 0;
});

let K1, K2;
section('Scanner: Ziele und Stufen', () => {
  S.dbg('kreatur', { typ: 'probe' }); S.dbg('kreatur', { typ: 'probe' });
  [K1, K2] = aw.kreaturen;
  ok(aw.kreaturen.length === 2 && K1.id === 'K1' && K2.id === 'K2', 'zwei Kreaturen K1 und K2');
  K2.alive = false;
  Scanbar.debugScanfertig(g, p, 1);
  const e1 = aw.sc && aw.sc['monster:K1'];
  ok(e1 && e1.sk === 1 && e1.typ === 'probe' && e1.x === undefined, 'Stufe 1: K1 erfasst (typ probe), ohne Position');
  ok(!aw.sc['monster:K2'], 'tote Kreatur K2 wird nicht erfasst (ziele liefert nur Lebende)');
  Scanbar.debugScanfertig(g, p, 2);
  ok(aw.sc['monster:K1'].sk === 2 && aw.sc['monster:K1'].x === undefined, 'Stufe 2: sk 2, weiter ohne Position');
  Scanbar.debugScanfertig(g, p, 1);
  ok(aw.sc['monster:K1'].sk === 2, 'schlechterer Scan senkt sk nicht');
  Scanbar.debugScanfertig(g, p, 3);
  ok(aw.sc['monster:K1'].sk === 3 && aw.sc['monster:K1'].x === Math.round(K1.x) && aw.sc['monster:K1'].y === Math.round(K1.y), 'Stufe 3: Position gleich der Kreatur');
  K1.x += 64; K1.y += 32;
  Scanbar.debugScanfertig(g, p, 3);
  ok(aw.sc['monster:K1'].x === Math.round(K1.x) && aw.sc['monster:K1'].y === Math.round(K1.y), 'bewegte Kreatur: der nächste Scan zieht die neue Position nach');
  const sn = g.snapshot().away.sc;
  ok(Array.isArray(sn) && sn.some((r) => r[0] === 'K1' && r[1] === 'monster' && r[2] === 'probe' && r[3] === 3 && r.length === 6), 'Snapshot away.sc trägt [K1, monster, probe, 3, x, y]');
});

section('Scanner: billig', () => {
  // Scanbar.update ruft ziele() bei nicht leerem aw.sc; es darf keine Karte neu aufgebaut werden (karteOf ist der Weg zur Karte)
  const orig = g.karteOf; let karte = 0;
  g.karteOf = function () { karte++; return orig.apply(this, arguments); };
  const t0 = process.hrtime.bigint();
  const zeit0 = g.time;
  for (let i = 0; i < 20000; i++) { Scanbar.update(g); g.time += 1; }   // Zeit läuft, damit jede Prüfung (höchstens alle 0,5 s) ziele() ruft
  const us = Number(process.hrtime.bigint() - t0) / 1000 / 20000;
  g.time = zeit0;
  g.karteOf = orig;
  ok(karte === 0, 'ziele()/Scanbar.update fassen die Karte nie an (karteOf-Aufrufe: ' + karte + ')');
  ok(us < 20, 'Scanbar.update mit Kreaturen: ' + us.toFixed(2) + ' µs je Aufruf (< 20)');
  ok(aw.sc['monster:K1'] && aw.sc['monster:K1'].sk === 3, 'lebende Kreatur bleibt in aw.sc (wird weiter geliefert)');
});

section('Snapshot kr', () => {
  K2.alive = true;
  Kreatur.zustandSetzen(g, K2, 'patrouille');
  K1.x = p.x + 3 * TILE; K1.y = p.y; K2.x = p.x + 5 * TILE; K2.y = p.y;
  Kreatur.zustandSetzen(g, K1, 'patrouille');
  const kr = g.snapshot().away.kr;
  ok(Array.isArray(kr) && kr.length >= 1, 'kr vorhanden bei lebenden Kreaturen in Teamsicht (' + (kr ? kr.length : 0) + ')');
  const codes = Object.keys(KREATUREN.typen);
  const r1 = kr.find((r) => r[0] === 1);
  ok(r1 && r1.length === 6, 'Eintrag [nr, typCode, x, y, f, bits]');
  ok(r1[1] === codes.indexOf('probe') && Number.isInteger(r1[1]), 'typCode = Index in kreaturen.json (' + r1[1] + ')');
  ok(r1[2] === Math.round(K1.x * 10) / 10 && r1[3] === Math.round(K1.y * 10) / 10, 'x, y gerundet (1 Nachkommastelle)');
  ok(r1[4] === Math.round(K1.facing * 100) / 100, 'Blickrichtung 2 Nachkommastellen');
  ok(((r1[5] >> 4) & 3) === KREATUREN.typen.probe.groesse - 1, 'Größe-1 in Bit 4-5');
  ok((r1[5] & 15) === 0, 'Grundzustand (Patrouille): Ladung 0, nicht Pause, nicht rammt');
  const bits = (zu, lad) => {
    Kreatur.zustandSetzen(g, K1, zu);
    if (lad != null) K1.aufladung = { stufe: lad, ruhe: 0, zerfallT: 0 };
    const r = g.snapshot().away.kr.find((q) => q[0] === 1);
    return r[5] & 15;
  };
  ok(bits('pause', 2) === (2 | 4), 'Pause + Ladung 2: Bits 2 | 4');
  ok(bits('steckt') === (2 | 4), 'steckt zählt als Pause');
  ok(bits('rammen') === (2 | 8), 'Rammen: Bit 8');
  ok(bits('jagd', 7) === 3, 'Ladung wird auf 3 begrenzt');
  // MON-02 O3a: Bit 6 (64) = zielt (Modus zielen, Aufladen); nur dort gesetzt, die Bits 0-5 bleiben unberührt
  const bit6 = (zu, lad) => { Kreatur.zustandSetzen(g, K1, zu); K1.aufladung = lad != null ? { stufe: lad, ruhe: 0, zerfallT: 0 } : null; return g.snapshot().away.kr.find((q) => q[0] === 1)[5]; };
  const g1 = (KREATUREN.typen.probe.groesse - 1) << 4;   // Bits 4-5 (probe: Größe 2)
  ok(bit6('aufladen', 1) === (1 | 64 | g1), 'Aufladen mit Ladung 1: Bit 6 gesetzt, Ladung in Bit 0-1, Größenbits unberührt (' + (1 | 64 | g1) + ')');
  ok(bit6('aufladen', 3) === (3 | 64 | g1) && bit6('aufladen', 0) === (64 | g1), 'Aufladen mit Ladung 3 und 0: 64 + Ladung + Größe');
  ok(['patrouille', 'jagd', 'rammen', 'pause', 'steckt', 'laerm'].every((z) => (bit6(z, 1) & 64) === 0), 'Bit 6 nur im Zustand aufladen (Patrouille, Lärm, Jagd, Rammen, Pause, steckt: nicht gesetzt)');
  K1.aufladung = null;
  K2.alive = false;
  ok(g.snapshot().away.kr.every((r) => r[0] !== 2), 'tote Kreatur K2 steht nicht im Snapshot');
  // Sicht: weit außerhalb der Sichtweite -> nicht im Snapshot; Sensor deckt auf
  const x0 = K1.x;
  K1.x = x0 + 80 * TILE;
  ok(!(g.snapshot().away.kr || []).some((r) => r[0] === 1), 'Kreatur weit außerhalb der Teamsicht fehlt im Snapshot');
  aw.sensorUntil = g.time + 30;
  ok((g.snapshot().away.kr || []).some((r) => r[0] === 1), 'Sensor (sensorUntil) deckt sie auf');
  aw.sensorUntil = 0;
  K1.x = x0;
});

section('Snapshot kr: Sichtregel wie combat.updateVisibility (Sichtradius je Spieler, Lanzenkegel, Sensor, Fokus)', () => {
  const Stellung = require('../server/sim/stellung.js'); const orig = Stellung.sichtKacheln;
  const sieht = () => (g.snapshot().away.kr || []).some((r) => r[0] === 1);
  const x0 = K1.x, y0 = K1.y; Kreatur.zustandSetzen(g, K1, 'patrouille'); K1.x = p.x + 5 * TILE; K1.y = p.y;
  try {
    ok(sieht(), 'Kontrolle: Kreatur 5 Kacheln entfernt in der Reihe ist bei Sichtradius 10 sichtbar');
    Stellung.sichtKacheln = () => 3;   // Sichtradius des Spielers kleiner als sightTiles (wie anderer Sichtradius in Stellung/Posten, nur kleiner)
    ok(!sieht(), 'Sichtradius des Spielers (sichtRadius) gilt, nicht das feste sightTiles: bei 3 Kacheln ist die Kreatur 5 Kacheln entfernt unsichtbar');
    Stellung.sichtKacheln = () => 20;
    K1.x = p.x + 14 * TILE;
    ok(sieht() === (require('../server/sim/combat.js').losBetween(require('../server/sim/combat.js').env(g), p, K1)), 'Sichtradius 20: Kreatur 14 Kacheln entfernt sichtbar, soweit Sichtlinie besteht');
    K1.x = p.x + 5 * TILE; Stellung.sichtKacheln = () => 3;
    p.ladung = { tx: K1.x, ty: K1.y };   // zielt mit der Lanze auf die Kreatur: Weitsicht im Kegel
    ok(sieht(), 'Lanzenkegel: zielt der Spieler mit der Lanze auf die Kreatur, ist sie trotz kleinem Sichtradius sichtbar');
    p.ladung = { tx: p.x, ty: p.y + 100 * TILE };
    ok(!sieht(), 'Lanze zielt in eine andere Richtung: kein Kegel, wieder unsichtbar');
    p.ladung = null; K1.focusUntil = g.time + 5;
    ok(sieht(), 'Captain-Fokus (focusUntil) deckt auf, wie bei den Drohnen');
    K1.focusUntil = 0;
    ok(!sieht(), 'Fokus abgelaufen: wieder unsichtbar');
  } finally { Stellung.sichtKacheln = orig; p.ladung = null; K1.focusUntil = 0; K1.x = x0; K1.y = y0; }
});

section('Bytes je Kreatur', () => {
  K1.facing = -2.3456789; K1.aufladung = { stufe: 3, ruhe: 0, zerfallT: 0 };
  Kreatur.zustandSetzen(g, K1, 'rammen');
  const r = g.snapshot().away.kr.find((q) => q[0] === 1);
  const b = bytes(r) + 1;
  console.log('  Messwert: ' + JSON.stringify(r) + ' = ' + b + ' B je Kreatur (mit Komma)');
  ok(b <= 40, 'höchstens 40 B je Kreatur (' + b + ')');
  K1.aufladung = null;
});

section('Datenblatt-Eintrag probe', () => {
  const d = DATEN.typen.probe;
  ok(d && d.name === 'Probe-Monster' && d.symbol && d.hinweisAb === 1, 'Eintrag probe mit hinweisAb 1');
  ok(d.name.length <= SA.LIMIT.name && d.zeile.length <= SA.LIMIT.zeile && d.hinweis.length <= SA.LIMIT.hinweis,
    'Grenzen: name ' + d.name.length + '/' + SA.LIMIT.name + ', zeile ' + d.zeile.length + '/' + SA.LIMIT.zeile + ', hinweis ' + d.hinweis.length + '/' + SA.LIMIT.hinweis);
  ok(Number.isInteger(d.gefahr) && d.gefahr >= 0 && d.gefahr <= 3, 'gefahr 0..3');
  ok(/vorn/.test(d.hinweis) && /Rücken/.test(d.hinweis) && /Beschuss/.test(d.hinweis) && /Lärm/.test(d.hinweis), 'Regelhinweis nennt Panzerung vorn, Rücken, Beschuss, Lärm');
  ok(Object.keys(KREATUREN.typen).every((t) => DATEN.typen[t]), 'jeder Kreaturentyp hat einen Datenblatt-Eintrag');
  const z1 = SA.zeile(SA.lesen([['K1', 'monster', 'probe', 1]])[0], DATEN);
  ok(z1.name === 'Probe-Monster' && z1.hinweis === d.hinweis && z1.pos === null && z1.artTitel === 'Monster', 'Stufe 1: Name, Regelhinweis, keine Position, Art Monster');
  const z3 = SA.zeile(SA.lesen([['K1', 'monster', 'probe', 3, 96, 64]])[0], DATEN);
  ok(z3.pos && z3.pos.x === 96 && z3.pos.y === 64 && z3.hinweis === d.hinweis, 'Stufe 3: Position und Hinweis');
  ok(SA.nameVon([['K1', 'monster', 'probe', 1]], 'monster', 'K1', DATEN) === 'Probe-Monster', 'nameVon liefert den Namen des gescannten Ziels');
  ok(SA.nameVon([['K1', 'monster', 'probe', 1]], 'monster', 'K2', DATEN) === null, 'nameVon: nicht gescannt -> null (Anzeige "?")');
  const mk = SA.marker([['K1', 'monster', 'probe', 3, 96, 64], ['K2', 'monster', 'probe', 1]], DATEN);
  ok(mk.length === 1 && mk[0].symbol === 'MO' && mk[0].artTitel === 'Monster', 'Marker nur mit Position, Art Monster (Symbol MO)');
});

// MON-02 P3: Datenblatt-Eintrag rudeltier (Spielersprache, Regelhinweis ab Stufe 1, Position erst ab Stufe 3, Grenzen)
section('Datenblatt-Eintrag rudeltier', () => {
  const d = DATEN.typen.rudeltier, p = DATEN.typen.probe;
  ok(d && d.name === 'Rudeltier' && d.symbol === 'MO' && d.hinweisAb === 1 && d.positionAb === undefined, 'Eintrag rudeltier: Symbol MO, hinweisAb 1, Position wie im Rahmen erst ab Stufe 3 (kein positionAb)');
  ok(d.name.length <= SA.LIMIT.name && d.zeile.length <= SA.LIMIT.zeile && d.hinweis.length <= SA.LIMIT.hinweis,
    'Grenzen: name ' + d.name.length + '/' + SA.LIMIT.name + ', zeile ' + d.zeile.length + '/' + SA.LIMIT.zeile + ', hinweis ' + d.hinweis.length + '/' + SA.LIMIT.hinweis);
  ok(/Rudel/.test(d.hinweis) && /vorn/.test(d.hinweis) && /Rücken/.test(d.hinweis) && /Beschuss/.test(d.hinweis) && /Lärm/.test(d.hinweis), 'Regelhinweis nennt Rudel, Panzerung vorn, Rücken, Beschuss, Lärm');
  ok(Number.isInteger(d.gefahr) && d.gefahr >= 1 && d.gefahr <= 3, 'Gefahr ' + d.gefahr + ' (1 bis 3; probe: ' + p.gefahr + ')');
  const z1 = SA.zeile(SA.lesen([['K2', 'monster', 'rudeltier', 1]])[0], DATEN);
  ok(z1.name === 'Rudeltier' && z1.hinweis === d.hinweis && z1.pos === null, 'Stufe 1: Name und Regelhinweis, keine Position');
  const z3 = SA.zeile(SA.lesen([['K2', 'monster', 'rudeltier', 3, 96, 64]])[0], DATEN);
  ok(z3.pos && z3.pos.x === 96 && z3.pos.y === 64 && z3.hinweis === d.hinweis, 'Stufe 3: Position und Regelhinweis');
  ok(JSON.stringify(Object.keys(d).sort()) === JSON.stringify(['gefahr', 'hinweis', 'hinweisAb', 'name', 'symbol', 'zeile']), 'nur die vereinbarten Felder, kein Rudel-Zähler als neue Oberfläche');
});

section('typCode: Reihenfolge der Typen in kreaturen.json ist Protokoll', () => {
  // Neue Typen nur ans ENDE von kreaturen.json, nie umsortieren oder einfügen (der Client kennt den Index als Wiedererkennung). Beim Anhängen eines Typs diese Liste ergänzen.
  const PROTOKOLL = ['probe', 'rudeltier', 'schwarmling', 'koenigin'];
  const ids = Object.keys(KREATUREN.typen);
  ok(PROTOKOLL.every((t, i) => ids[i] === t), 'die ersten Typen in kreaturen.json sind unverändert und in dieser Reihenfolge: ' + PROTOKOLL.join(', '));
  const kr = g.snapshot().away.kr || [];
  const r = kr.find((q) => q[0] === 1);
  ok(!!r && r[1] === 0 && ids[0] === 'probe', 'ausgelieferter typCode von probe ist 0 (' + (r ? r[1] : 'nicht im Bild') + ')');
  ok(/typCode[\s\S]*Reihenfolge/.test(read('CONTRACT-B2.md')) && /Reihenfolge[\s\S]{0,300}kreaturen\.json/.test(read('shared/protocol.js')), 'CONTRACT-B2.md und shared/protocol.js halten die Reihenfolge als Protokoll fest');
});

section('Client: Gegnerlage und Kommandokarte, eine Farbquelle', () => {
  const co = read('public/js/consoles.js'), rd = read('public/js/render.js'), ac = read('public/js/voxel/actors.js');
  ok(/d\.kind !== 'warden' && d\.kind !== 'monster' && d\.kind !== 'kreatur'/.test(co), 'consoles.js: Kreaturen zählen in der Gegnerlage nicht als Plünderer');
  const karte = rd.slice(rd.indexOf('function drawAwayCommandMap'), rd.indexOf('SL7c: nächstes Pult der Monster-Station'));
  ok(/noisy && !ungestoertAufKarte\(e\)/.test(karte) && /ungestoertAufKarte = \(e\) => e\.kind === 'monster' \|\| e\.kind === 'kreatur'/.test(rd), 'Kommandokarte: Monster und Kreaturen werden weder verschoben noch flackern');
  ok(/kreaturMarker\.has\('monster:' \+ e\.id\)/.test(karte), 'Kommandokarte: Name entfällt, wenn ein Scan-Marker derselben Kreatur existiert');
  const kr = rd.slice(rd.indexOf('const KREATUR = {'), rd.indexOf('// SL7c: das Monster der Forschungsstation'));
  ok(!/#[0-9A-Fa-f]{6}|rgba\(/.test(kr.replace(/\/\/.*$/gm, '')), 'Kreaturen-Darstellung in render.js ohne freie Farbwerte (nur Palette)');
  const vx = ac.slice(ac.indexOf("kind.startsWith('kreatur|')"), ac.indexOf("else if (kind === 'warden') { box(1.4"));
  ok(/Render\.KREATUR/.test(vx) && !/'#[0-9A-Fa-f]{6}'/.test(vx.replace(/if \(!KR\) \{[^}]*\}/, '')), 'voxel/actors.js liest Render.KREATUR (keine eigenen Farbwerte, außer dem Notfall ohne Render)');
  ok(/kreaturBeschriftung\(ctx, kn, s\.x, s\.y\)/.test(rd) && /dk === 'kreatur'\) \{ const hf = kreaturHaufen\(view, st\)\.get\(e\.id\); const kn = hf \? hf\.name : kreaturName\(e, st\); const kg/.test(rd), 'Voxel-Überlagerung beschriftet Kreaturen (Name aus dem Scan, sonst „?“)');
});

// MON-02 G: Größe 1 im Snapshot (Bits 4-5 = 0) und im Client-Platzhalter (Box und Voxelvolumen in Typgröße, Größe 1 = halb so groß wie Größe 2, bleibt in einer Kachel)
section('Größe 1: Snapshot und Platzhalter', () => {
  const rd = read('public/js/render.js'), ac = read('public/js/voxel/actors.js');
  const kleinTyp = JSON.parse(JSON.stringify(KREATUREN.typen.probe)); Object.assign(kleinTyp, { name: 'kreatur.kleinanz', groesse: 1, hitRadius: 13, kollision: { box: 20 } });
  KREATUREN.typen.kleinanz = kleinTyp; Kreatur.kreaturBausteinAnmelden('__cache__', {})();   // Testtyp (Datenzeile) laden
  try {
    const K3 = Kreatur.erzeugen(g, 'kleinanz', p.x + 4 * TILE, p.y);
    Kreatur.zustandSetzen(g, K3, 'patrouille'); K3.x = p.x + 4 * TILE; K3.y = p.y;
    const r = (g.snapshot().away.kr || []).find((q) => q[0] === Number(K3.id.slice(1)));
    ok(!!r && r.length === 6 && r[1] === Object.keys(KREATUREN.typen).indexOf('kleinanz'), 'Größe 1: Eintrag im Snapshot kr (typCode ' + (r ? r[1] : '-') + ')');
    ok(((r[5] >> 4) & 3) === 0 && (r[5] & 15) === 0, 'Größe 1: Bits 4-5 = 0 (Größe − 1), Ladung/Pause/Rammen unverändert');
    ok(K3.hitRadius === 13 && !('fuss' in K3), 'Kreatur trägt hitRadius 13 aus den Daten (Größe steht im Typ, kein neues Instanzfeld)');
    Kreatur.zustandSetzen(g, K3, 'rammen'); K3.aufladung = { stufe: 2, ruhe: 0, zerfallT: 0 };
    const r2 = g.snapshot().away.kr.find((q) => q[0] === Number(K3.id.slice(1)));
    ok(((r2[5] >> 4) & 3) === 0 && (r2[5] & 15) === (2 | 8), 'Größe 1 mit Ladung 2 und Rammen: Größenbits bleiben 0, Ladungs- und Rammbits wie bei Größe 2');
    // Sichtregel: dieselbe Regel (Sichtradius, Sensor) wie bei Größe 2; weit weg unsichtbar, Sensor deckt auf
    K3.x = p.x + 80 * TILE;
    ok(!(g.snapshot().away.kr || []).some((q) => q[0] === Number(K3.id.slice(1))), 'Größe 1 weit außerhalb der Teamsicht fehlt im Snapshot');
    aw.sensorUntil = g.time + 30; ok((g.snapshot().away.kr || []).some((q) => q[0] === Number(K3.id.slice(1))), 'Sensor deckt die Größe-1-Kreatur auf'); aw.sensorUntil = 0;
    aw.kreaturen = aw.kreaturen.filter((q) => q !== K3);
  } finally { delete KREATUREN.typen.kleinanz; Kreatur.kreaturBausteinAnmelden('__cache__', {})(); }
  // Client: Platzhalter-Kante 2h mit h = g·32·0,38 (2D) und Voxelbreite g·0,8; g = Bits 4-5 + 1
  ok(rd.includes('g = ((b >> 4) & 3) + 1') && rd.includes('h = g * TILE * 0.38') && ac.includes('w = (((b >> 4) & 3) + 1) * 0.8'), 'Client: 2D-Box und Voxelbreite folgen Größe-1 aus den Bits (Quelltext)');
  const kante = (g1) => 2 * g1 * TILE * 0.38;
  ok(kante(1) < TILE && Math.abs(kante(2) - 2 * kante(1)) < 1e-9 && Math.abs(0.8 * 2 - 2 * (0.8 * 1)) < 1e-9, 'Platzhalter Größe 1: 2D-Kante ' + kante(1).toFixed(1) + ' px (unter einer Kachel, halb so groß wie Größe 2 mit ' + kante(2).toFixed(1) + ' px), Voxelbreite 0,8 statt 1,6');
});

section('Haufen: ein gemeinsamer Namenszug je Rudel (render.js kreaturHaufen), nicht pro Tier', () => {
  const rd = read('public/js/render.js');
  const a = rd.indexOf('const KREATUR_HAUFEN'), b = rd.indexOf('function drawKreatur(');
  ok(a > 0 && b > a, 'kreaturHaufen im Quelltext gefunden');
  const kreaturHaufen = new Function('TILE', 'kreaturName', rd.slice(a, b) + '\nreturn kreaturHaufen;')(32, (e) => e.name || '?');
  const kr = (nr, x, y, name, t) => ({ id: 'K' + nr, kind: 'kreatur', alive: true, x, y, name, kr: { t: t == null ? 1 : t, b: 0 } });
  // Rudel von 8 im Block (48 px = 1,5 Kacheln Abstand), 6 gescannt, 2 nicht
  const rudel = []; for (let i = 0; i < 8; i++) rudel.push(kr(i + 1, 100 + (i % 4) * 48, 100 + Math.floor(i / 4) * 48, i < 6 ? 'Rudeltier' : null));
  let h = kreaturHaufen({ drones: rudel }, null);
  const fuehrer = [...h.values()].filter((v) => v.fuehrer);
  ok(fuehrer.length === 1 && fuehrer[0].name === 'Rudeltier ×6 · ?' && h.get('K1').fuehrer && h.get('K1').name === 'Rudeltier ×6 · ?' && h.get('K2').name === null && h.get('K8').name === null && h.get('K1').n === 8, 'Rudel von 8 (6 gescannt): ein Namenszug "Rudeltier ×6 · ?" beim Führer K1, die übrigen 7 ohne Namen');
  const ohne = kreaturHaufen({ drones: rudel.map((e) => Object.assign({}, e, { name: null })) }, null);
  ok([...ohne.values()].filter((v) => v.name != null).length === 1 && ohne.get('K1').name === '?', 'kein Tier gescannt: ein einziges "?" je Haufen');
  const alle = kreaturHaufen({ drones: rudel.map((e) => Object.assign({}, e, { name: 'Rudeltier' })) }, null);
  ok(alle.get('K1').name === 'Rudeltier ×8', 'alle gescannt: "Rudeltier ×8"');
  // zwei weit entfernte Gruppen (> 3 Kacheln), ein anderer Typ im selben Haufen, ein Einzeltier, ein totes Tier
  const zwei = rudel.slice(0, 3).concat([kr(20, 1000, 100, 'Rudeltier'), kr(21, 1048, 100, 'Rudeltier'), kr(22, 1096, 100, 'Rudeltier', 2), kr(30, 3000, 3000, 'Rudeltier'), Object.assign(kr(31, 110, 110, 'Rudeltier'), { alive: false })]);
  h = kreaturHaufen({ drones: zwei }, null);
  ok(h.get('K1').name === 'Rudeltier ×3' && h.get('K20').name === 'Rudeltier ×2' && h.get('K22').name === 'Rudeltier' && h.get('K22').n === 1 && h.get('K30').name === 'Rudeltier' && !h.has('K31'), 'zwei Haufen getrennt, anderer Typ (t 2) eigener Haufen, Einzeltier behält seinen Namen, totes Tier zählt nicht');
  const kette = [kr(1, 0, 0, 'Rudeltier'), kr(2, 80, 0, 'Rudeltier'), kr(3, 160, 0, 'Rudeltier')];   // 80 px = 2,5 Kacheln: verkettet
  ok(kreaturHaufen({ drones: kette }, null).get('K1').name === 'Rudeltier ×3' && kreaturHaufen({ drones: [kr(1, 0, 0, 'Rudeltier'), kr(2, 97, 0, 'Rudeltier')] }, null).get('K1').name === 'Rudeltier', 'verkettet bis unter 3 Kacheln Abstand; ab 3 Kacheln (97 px) getrennt');
  const v = { drones: rudel }; ok(kreaturHaufen(v, null) === kreaturHaufen(v, null), 'Zwischenspeicher: je view einmal');
  const n = (rd.match(/kreaturHaufen\(view, st\)\.get\(e\.id\)/g) || []).length;
  ok(n === 3, 'alle drei Zeichenstellen (Kommandokarte, Boden 2D, Boden 3D) lesen den Haufen (' + n + ')');
  ok(/if \(name != null\) kreaturBeschriftung\(ctx, name, x, y - h - 32\)/.test(rd), 'drawKreatur zeichnet nichts bei name null');
  const hk = kreaturHaufen({ drones: rudel }, null).get('K1');
  ok(hk.ymin === 100 && hk.ymax === 148, 'Haufen liefert die oberste (ymin 100) und unterste (ymax 148) Kante für die Kommandokarte');
});

section('Kommandokarte: Namenszug des Haufens bleibt im Kartenrechteck (MON-02 Nacharbeit M5)', () => {
  const rd = read('public/js/render.js');
  const a = rd.indexOf('function kreaturNamenPos'), b = rd.indexOf('function drawKreatur(');
  ok(a > 0 && b > a, 'kreaturNamenPos im Quelltext gefunden');
  const pos = new Function(rd.slice(a, b) + '\nreturn kreaturNamenPos;')();
  const rect = { x: 10, y: 20, w: 300, h: 200 };   // Kartenrechteck: y 20 bis 220
  const mitte = pos({ x: 150, y: 100 }, { x: 150, y: 60 }, rect, 60);
  ok(mitte.x === 150 && mitte.y === 109, 'genug Platz: der Name steht wie bisher 9 px unter dem untersten Tier (' + JSON.stringify(mitte) + ')');
  const knapp = pos({ x: 150, y: 203 }, { x: 150, y: 170 }, rect, 60);
  ok(knapp.y === 212, 'gerade noch im Rechteck (Text 7 px hoch, endet bei 219): bleibt unten (' + knapp.y + ')');
  const unten = pos({ x: 150, y: 210 }, { x: 150, y: 175 }, rect, 60);
  ok(unten.y === 175 - 17 && unten.y < 175, 'am unteren Kartenrand (Tiere bei y 175 bis 210, unten wäre y 219 und abgeschnitten): der Name steht 17 px über dem obersten Tier (' + unten.y + ')');
  let aus = 0, ueber = 0;
  for (let y = -50; y <= 400; y += 3) for (const x of [-20, 12, 150, 300, 330]) {
    const p = pos({ x, y }, { x, y: y - 40 }, rect, 90);
    if (p.y < rect.y + 1 || p.y + 7 > rect.y + rect.h || p.x - 46 < rect.x || p.x + 46 > rect.x + rect.w) aus++;
    if (y + 9 + 7 > rect.y + rect.h && y - 40 - 17 >= rect.y + 1 && p.y > y - 40) ueber++;
  }
  ok(aus === 0, 'der Name liegt für jede Haufenlage (y -50 bis 400, x auch außerhalb) vollständig im Kartenrechteck, auch seitlich (' + aus + ' Verstöße)');
  ok(ueber === 0, 'wo unten kein Platz ist und oben Platz, steht er über dem Haufen, nie darunter (' + ueber + ' Verstöße)');
  const rand = pos({ x: 4, y: 100 }, { x: 4, y: 60 }, rect, 80);
  ok(rand.x === 10 + 41 && pos({ x: 400, y: 100 }, { x: 400, y: 60 }, rect, 80).x === 10 + 300 - 41, 'seitlich in das Rechteck geklemmt (Textbreite 80 px halbiert + 1 px)');
  ok(/kreaturNamenPos\(toS\(hf\.x, hf\.ymax\), toS\(hf\.x, hf\.ymin\), rect, measure\(hf\.name, 1\)\)/.test(rd), 'die Kommandokarte (drawAwayCommandMap) setzt den Namen über kreaturNamenPos');
});

section('Client-Einhängestellen (Quelltext)', () => {
  const cl = read('public/js/client.js'), rd = read('public/js/render.js'), ac = read('public/js/voxel/actors.js');
  ok(/aa\.kr\b/.test(cl) && /kind: 'kreatur', alive: true, vis: true/.test(cl), 'client.js: away.kr wird zu Pseudo-Gegnern (kind kreatur)');
  ok(/dk === 'kreatur'/.test(rd) && /function drawKreatur/.test(rd) && /e\.kind === 'kreatur'/.test(rd), 'render.js: Weltansicht und Captain-Karte zeichnen Kreaturen');
  const f = rd.slice(rd.indexOf('function drawKreatur'), rd.indexOf('// SL7c: das Monster der Forschungsstation'));
  ok(!/MONSTER/.test(f) && /'\?'/.test(rd.slice(rd.indexOf('function kreaturName'), rd.indexOf('function drawKreatur'))), 'kein fest verdrahtetes "MONSTER", Name nur aus dem Scan, sonst "?"');
  ok(/kind === 'kreatur'/.test(ac) && /kreatur\|/.test(ac), 'voxel/actors.js: Platzhalter-Volumen für Kreaturen');
  const sv = read('server/sim/kreatur.js'), gm = read('server/game.js');
  ok(/Kreatur\.snapFeld\(this\)/.test(gm), 'game.js ruft nur Kreatur.snapFeld auf (Verdrahtung)');
  ok(/Object\.assign\(module\.exports, \{ snap \}\)/.test(sv), 'Kreatur.snap exportiert');
});

console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
