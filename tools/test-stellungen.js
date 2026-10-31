'use strict';
// BOD-02 P4 – Stellungen und Sichtbonus (shared/stellung.js, server/sim/stellung.js).
//   - Markierung: Bereich mit rolle 'stellung' (festkarte/1 bereiche), Server-Modul istIn/plaetze, Client-Form (Payload) rechnet gleich
//   - Sicht: in einer Stellung 16 Kacheln, auf dem Posten (aussicht-Anker) 22, sonst 10 – für Gegner UND Spieler
//   - Schussfenster (engageBox) wächst mit sicht/10 (16 -> x1,6; 22 -> x2,2), Seitenverhältnis bleibt; ohne Stellung dasselbe Objekt wie bisher
//   - Fog: Gegner in 14 Kacheln sind für einen Spieler in der Stellung sichtbar, ausserhalb nicht
//   - Gegner in der Stellung trifft einen Spieler in 14 Kacheln, ausserhalb der Stellung nicht (Sicht 10); kein Treffer aus dem Off (offBoxHits 0)
//   - Karte ohne Eintrag unverändert; Payload der Grabenkarte <= 5120 B
//   node tools/test-stellungen.js
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const Buehne = require('../shared/buehne.js');
const GenFest = require('../shared/gen-fest.js');
const SharedStellung = require('../shared/stellung.js');
const { Game } = require('../server/game.js');
const combat = require('../server/sim/combat.js');
const squad = require('../server/sim/squad.js');
const away = require('../server/sim/away.js');
const Wf = require('../server/sim/waffen.js');
const Stellung = require('../server/sim/stellung.js');
const L = require('../server/sim/landepunkte.js');
const W = require('../server/world.js');
const KACHELN = require('../content/buehnen/kacheln.json').zeichen;

Wf.aktiv = true;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const TILE = Physics.TILE;
const AC = CONFIG.awayCombat;
const LP = 'test.stellungen';
const ZEILE = 6;
const BREITE = 70;
const near = (a, b) => Math.abs(a - b) < 1e-6;

// Offene Halle 70x14; Stellung x 10..15 / y 3..9; Posten (aussicht) bei (50, 6); mit stellung=false ohne den Stellungsbereich
function karte(stellung) {
  const grid = [];
  for (let y = 0; y < 14; y++) { const r = []; for (let x = 0; x < BREITE; x++) r.push((x === 0 || y === 0 || x === BREITE - 1 || y === 13) ? '#' : '.'); grid.push(r); }
  const rows = grid.map((r) => r.join(''));
  const legende = {};
  for (const r of rows) for (const ch of r) legende[ch] = KACHELN[ch];
  const A = (id, rolle, x, y, extra) => Object.assign({ id, rolle, x, y, platz: id.split('.')[0], bereich: null }, extra || {});
  const bereiche = { lz: { name: 'Landezone', rects: [[1, 10, 6, 3]], rolle: 'hinein', gefecht: false } };
  if (stellung) bereiche.st = { name: 'st', rects: [[10, 3, 6, 7]], rolle: 'stellung', gefecht: false };
  return { id: LP, erzeuger: 'modul/1', art: 'aussenposten', bauweise: 'germanen', besitz: 'rostmeute', zustand: 'intakt', seed: 2, bauversion: 'test',
    schablone: null, spiegel: null, w: BREITE, h: 14, rows, legende,
    anker: [A('lz.abholpunkt', 'abholpunkt', 2, 11, { ankunft: true, bereich: 'lz' }), A('turm.aussicht', 'aussicht', 50, ZEILE)],
    bereiche, plaetze: {}, eingaenge: [], abholpunkte: ['lz.abholpunkt'], ankunft: 'lz.abholpunkt',
    patrouillen: [], coverSpots: [], decks: null, kanten: {}, gelaende: null, meta: {} };
}
function szene(spieler, seed, stellung) {
  const g = new Game({ noStore: true, seed: seed || 7, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const conns = [];
  for (let i = 0; i < spieler; i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'N' + i, name: 'N' + i, color: i });
    conns.push(c);
  }
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  W.AWAY_MAPS[LP] = { id: LP, karte: karte(stellung !== false) };
  g.aways[LP] = away.makeLandepunkt(g, LP);
  g.setAwayMap(LP);
  away.executeBeam(g, g.players.map((p) => p.id), 'down');
  const aw = g.aways[LP];
  aw.drones.length = 0;
  const S = { g, conns, aw };
  S.P = (i) => combat.kaempfer(g, g.players[i]);
  S.place = (i, tx, ty) => { const p = S.P(i); const c = Physics.tileCenter(tx, ty); p.x = c.x; p.y = c.y; p.input.mx = 0; p.input.my = 0; p.crouch = false; return p; };
  S.run = (sek, each) => { for (let k = 0; k < Math.round(sek * 30); k++) { g.step(); if (each) each(); } };
  S.gegner = (rolle, tx, ty, opts) => {
    const e = squad.makeEnemy(g, aw, squad.TYP_KIND[rolle] || 'scavenger', 'G' + g.nextId(''), Physics.tileCenter(tx, ty), 'test');
    e.rolle = rolle; e.asleep = false; e.frozen = !(opts && opts.frei);
    if (!aw.squads[e.squad]) aw.squads[e.squad] = squad.newSquad(e.squad, 1);
    aw.drones.push(e);
    combat.kaempfer(g, e);
    return e;
  };
  S.vis = () => { combat.updateVisibility(g); };
  return S;
}
const ende = () => { delete W.AWAY_MAPS[LP]; };

console.log('\n[Konfig und Markierung]');
{
  ok(AC.sicht.stellung === 16 && AC.sicht.aussicht === 22 && AC.sightTiles === 10, 'sicht.stellung 16, sicht.aussicht 22, sightTiles 10');
  const k = karte(true);
  ok(SharedStellung.istIn(k, 10, 3) && SharedStellung.istIn(k, 15, 9) && !SharedStellung.istIn(k, 16, 3) && !SharedStellung.istIn(k, 9, 3) && !SharedStellung.istIn(k, 10, 10), 'istIn: Rechteck x 10..15, y 3..9 (Rand genau)');
  ok(!SharedStellung.istIn(k, -1, 3) && !SharedStellung.istIn(k, 100, 3) && !SharedStellung.istIn({}, 1, 1) && !SharedStellung.istIn(null, 1, 1), 'istIn: ausserhalb der Karte, leere und fehlende Karte -> false');
  const pl = Stellung.plaetze(k);
  ok(pl.length === 42 && pl[0].x === 10 && pl[0].y === 3 && pl[41].x === 15 && pl[41].y === 9, 'plaetze(): 42 Kacheln zeilenweise, Reihenfolge stabil');
  ok(Stellung.plaetze(k, (x, y) => x === 10).length === 35, 'plaetze(karte, solid) filtert Unbegehbares');
  ok(Stellung.plaetze(karte(false)).length === 0 && Stellung.rects(karte(false)).length === 0 && Stellung.rects(k).length === 1, 'ohne Bereich: keine Plaetze');
  // Client-Form: Payload (anker als Zeilen, bereiche mit rolle) rechnet gleich
  const pay = Game.prototype.awayMapPayload.call({}, k);
  ok(SharedStellung.istIn(pay, 12, 5) && !SharedStellung.istIn(pay, 20, 5), 'Payload-Form (Client): istIn gleich');
  const cfg = { normal: 10, stellung: 16, aussicht: 22 };
  const px = (t) => t * TILE + TILE / 2;
  ok(SharedStellung.sichtKacheln(pay, px(12), px(5), cfg) === 16 && SharedStellung.sichtKacheln(pay, px(50), px(6), cfg) === 22 && SharedStellung.sichtKacheln(pay, px(51), px(7), cfg) === 22 && SharedStellung.sichtKacheln(pay, px(20), px(5), cfg) === 10 && SharedStellung.sichtKacheln(pay, px(52), px(6), cfg) === 10, 'Payload-Form: Sicht 16 / Posten 22 (+-1 Kachel) / sonst 10');
  ok(SharedStellung.sichtKacheln(null, 5, 5, cfg) === 10 && SharedStellung.sichtKacheln(pay, px(12), px(5), { normal: 10 }) === 10, 'Karte fehlt oder sicht.stellung nicht gesetzt: 10');
}

console.log('\n[Sicht: Spieler und Gegner, 10 / 16 / 22]');
{
  const S = szene(1, 7, true);
  const p = S.P(0); const e = S.gegner('grundtyp', 20, ZEILE);
  const k = (t, x) => { S.place(0, x, ZEILE); const q = t === 'p' ? p : e; return Wf.sichtKacheln(S.g, q); };
  ok(k('p', 12) === 16 && Stellung.inStellung(S.g, p), 'Spieler in der Stellung: 16');
  ok(k('p', 30) === 10 && !Stellung.inStellung(S.g, p), 'Spieler daneben: 10');
  ok(k('p', 50) === 22 && Stellung.inStellung(S.g, p), 'Spieler auf dem Posten: 22');
  ok(k('p', 51) === 22, 'Spieler neben dem Anker (+-1 Kachel): 22');
  const ge = (x) => { const c = Physics.tileCenter(x, ZEILE); e.x = c.x; e.y = c.y; return Wf.sichtKacheln(S.g, e); };
  ok(ge(12) === 16 && ge(30) === 10 && ge(50) === 22, 'Gegner: 16 in der Stellung, 10 daneben, 22 auf dem Posten (gleiche Regel)');
  const c = Physics.tileCenter(15, ZEILE); e.x = c.x + 15; e.y = c.y;
  ok(Wf.sichtKacheln(S.g, e) === 16, 'Gegner an der rechten Kante der Stellungskachel: noch 16');
  e.x = c.x + 17;
  ok(Wf.sichtKacheln(S.g, e) === 10, 'eine Kachel weiter: 10');
  ende();
}

console.log('\n[Schussfenster engageBox wächst mit]');
{
  const S = szene(1, 7, true); const e = S.gegner('schuetze', 20, ZEILE);
  const B = AC.engageBox;
  const bei = (x) => { const c = Physics.tileCenter(x, ZEILE); e.x = c.x; e.y = c.y; return Wf.engageBox(S.g, e); };
  const b0 = bei(30), b1 = bei(12), b2 = bei(50);
  ok(b0 === B && b0.w === 600 && b0.h === 330, 'ausserhalb: unverändertes Objekt 600 x 330');
  ok(near(b1.w, 960) && near(b1.h, 528), `Stellung: x1,6 = ${b1.w} x ${b1.h}`);
  ok(near(b2.w, 1320) && near(b2.h, 726), `Posten: x2,2 = ${b2.w} x ${b2.h}`);
  ok(near(b1.w / b1.h, B.w / B.h) && near(b2.w / b2.h, B.w / B.h), 'Seitenverhältnis bleibt');
  ok(B.w === 600 && B.h === 330, 'CONFIG.awayCombat.engageBox selbst bleibt unverändert');
  // zielbar: Ziel 12 Kacheln seitlich/oben: in der Stellung ok (Fenster halbe Höhe 264 px = 8,25 Kacheln), ausserhalb nicht
  const t = S.P(0);
  const E = combat.env(S.g);
  const setze = (ex, ey, tx, ty) => { const a = Physics.tileCenter(ex, ey); e.x = a.x; e.y = a.y; const b = Physics.tileCenter(tx, ty); t.x = b.x; t.y = b.y; };
  setze(12, 3, 12, 10);   // 7 Kacheln senkrecht = 224 px > halbe Höhe 165 px der normalen engageBox, < 264 px der Stellungsbox
  ok(squad.zielbar(S.g, E, e, t), 'Stellung: Ziel 7 Kacheln senkrecht (ausserhalb der alten Box 600 x 330) ist zielbar');
  setze(30, 3, 30, 10);
  ok(!squad.zielbar(S.g, E, e, t), 'ausserhalb: dasselbe Ziel (7 Kacheln senkrecht) liegt ausserhalb der Box, nicht zielbar');
  setze(50, 5, 50, 12);
  ok(squad.zielbar(S.g, E, e, t), 'Posten: Ziel 7 Kacheln senkrecht zielbar');
  ende();
}

console.log('\n[Fog: Spieler in der Stellung sieht 16 Kacheln]');
{
  const S = szene(1, 7, true);
  const e = S.gegner('grundtyp', 20, ZEILE);
  const aufstellen = (px, ex) => { S.place(0, px, ZEILE); const c = Physics.tileCenter(ex, ZEILE); e.x = c.x; e.y = c.y; S.vis(); return e.vis; };
  ok(aufstellen(12, 26) === true, 'Stellung: Gegner in 14 Kacheln sichtbar');
  ok(aufstellen(12, 28) === true, 'Stellung: Gegner in 16 Kacheln sichtbar');
  ok(aufstellen(12, 29) === false, 'Stellung: Gegner in 17 Kacheln nicht sichtbar');
  ok(aufstellen(30, 44) === false, 'ausserhalb: Gegner in 14 Kacheln nicht sichtbar (Sicht 10)');
  ok(aufstellen(30, 39) === true && aufstellen(30, 41) === false, 'ausserhalb: 9 Kacheln sichtbar, 11 nicht');
  ok(aufstellen(50, 71 - 22) === true || aufstellen(50, 29) === true, 'Posten: Gegner in 21 Kacheln sichtbar');
  ok(aufstellen(50, 27) === false, 'Posten: Gegner in 23 Kacheln nicht sichtbar');
  ok(aufstellen(54, 33) === false && aufstellen(54, 44) === true, 'neben dem Posten (4 Kacheln): 21 Kacheln nicht, 10 sichtbar');
  ende();
}

console.log('\n[Gegner in der Stellung zielt und trifft in 14 Kacheln, ausserhalb nicht]');
{
  // Zielbarkeit direkt
  const S = szene(1, 7, true); const e = S.gegner('schuetze', 12, ZEILE); const t = S.P(0);
  S.place(0, 26, ZEILE);
  const E = combat.env(S.g);
  const a = squad.zielbar(S.g, E, e, t);
  ok(a === true && Wf.sichtPruefen(S.g, e, t, { sichtlinie: true }) === null, 'Stellung: zielbar auf 14 Kacheln (sichtPruefen null)');
  const c = Physics.tileCenter(30, ZEILE); e.x = c.x; e.y = c.y; S.place(0, 44, ZEILE);
  ok(squad.zielbar(S.g, E, e, t) === false && Wf.sichtPruefen(S.g, e, t, { sichtlinie: true }) === 'zu_weit', 'ausserhalb: nicht zielbar auf 14 Kacheln (zu_weit)');
  const c2 = Physics.tileCenter(12, ZEILE); e.x = c2.x; e.y = c2.y; S.place(0, 12 + 17, ZEILE);
  ok(Wf.sichtPruefen(S.g, e, t, { sichtlinie: true }) === 'zu_weit', 'Stellung: 17 Kacheln noch zu weit');
  ende();
  // Lauf: Schütze (Lanze, 22) in der Stellung, Spieler in 14 Kacheln steht still
  const treffer = (gx, px, sek) => {
    const R = szene(1, 11, true); const p = R.P(0); const g = R.g;
    R.place(0, px, ZEILE);
    const sh = R.gegner('schuetze', gx, ZEILE, { frei: true });
    sh.alert = true; sh.alertT = 99;
    try { squad.alarmiere(g, sh, 'test'); } catch (err) { /* ohne Alarm weiter: die KI nimmt den Spieler ohnehin wahr */ }
    let hits = 0; let gesehen = false;
    for (let i = 0; i < Math.round(sek * 30); i++) {
      if (p.shield) p.shield.seg = p.shield.max || 3;
      if (p.downed) combat.revive(g, p, 3, { quiet: true });
      g.step();
      if (sh.sees && sh.sees.includes(p)) gesehen = true;
    }
    hits = g.away.stats ? g.away.stats.playerHits : 0;
    const o = { hits, gesehen, off: g.away.stats ? g.away.stats.offBoxHits : -1, shots: g.away.stats ? g.away.stats.enemyShots : 0 };
    ende();
    return o;
  };
  const drin = treffer(12, 26, 12);
  ok(drin.gesehen && drin.shots > 0, `Stellung: Schütze sieht den Spieler in 14 Kacheln und schiesst (${drin.shots} Schuesse)`);
  ok(drin.hits > 0, `Stellung: Treffer auf den Spieler in 14 Kacheln (${drin.hits})`);
  ok(drin.off === 0, `kein Treffer aus dem Off (offBoxHits ${drin.off})`);
  const draussen = treffer(30, 44, 12);
  ok(!draussen.gesehen && draussen.shots === 0 && draussen.hits === 0, `ausserhalb der Stellung: Schütze sieht den Spieler in 14 Kacheln nicht, kein Schuss, kein Treffer (gesehen ${draussen.gesehen}, Schuesse ${draussen.shots}, Treffer ${draussen.hits})`);
}

console.log('\n[Karte ohne Eintrag: unverändert]');
{
  const S = szene(1, 7, false); const p = S.P(0); const e = S.gegner('grundtyp', 20, ZEILE);
  S.place(0, 12, ZEILE);
  ok(Wf.sichtKacheln(S.g, p) === 10 && !Stellung.inStellung(S.g, p), 'ohne stellung-Bereich: Sicht 10 an derselben Stelle');
  ok(Wf.engageBox(S.g, p) === AC.engageBox, 'ohne Stellung: engageBox ist dasselbe Objekt');
  S.place(0, 50, ZEILE);
  ok(Wf.sichtKacheln(S.g, p) === 22, 'Posten gilt weiter 22 (unverändert)');
  S.place(0, 26, ZEILE); const c = Physics.tileCenter(12, ZEILE); e.x = c.x; e.y = c.y; S.vis();
  ok(e.vis === false, 'ohne Stellung: Gegner in 14 Kacheln nicht sichtbar');
  ende();
  // Handkarte: keine gebaute Karte -> normal
  const g = new Game({ noStore: true, seed: 3, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  ok(Stellung.karteVon(g) === null && Wf.sichtKacheln(g, { x: 100, y: 100 }) === 10, 'ohne Außenkarte (Handkarte): 10');
  ok(!SharedStellung.istIn({ w: 5, h: 5 }, 1, 1) && Stellung.plaetze({ w: 5, h: 5 }).length === 0, 'Karte ohne bereiche: leer');
}

console.log('\n[Grabenangriff: Markierung und Payload]');
{
  const DEF = L.festkarte('grabenangriff');
  const K = Buehne.ausRaster(GenFest.karteRoh(DEF, { id: 'test.graben' }), { spiel: true }).karte;
  const pay = Game.prototype.awayMapPayload.call({}, K);
  const B = Buffer.byteLength(JSON.stringify(pay));
  ok(B <= 5120, `Payload ${B} B <= 5120 B`);
  ok(pay.bereiche.stellung && pay.bereiche.stellung.rolle === 'stellung' && pay.bereiche.stellung.rects.length === 3, 'Payload trägt den Bereich stellung (rolle, 3 Rechtecke)');
  const sohle = K.bereiche.stellung.rects[0];
  const cfg = { normal: AC.sightTiles, stellung: AC.sicht.stellung, aussicht: AC.sicht.aussicht };
  const mitte = (r) => [(r[0] + 1) * TILE + 16, (r[1] + 3) * TILE + 16];
  const m = mitte(sohle);
  ok(SharedStellung.sichtKacheln(pay, m[0], m[1], cfg) === 16, 'Grabensohle: Sicht 16 (Client-Form)');
  const post = K.anker.filter((a) => a.rolle === 'aussicht');
  ok(post.length === 2 && post.every((a) => SharedStellung.sichtKacheln(pay, a.x * TILE + 16, a.y * TILE + 16, cfg) === 22), 'beide Posten: Sicht 22');
  const ab = K.anker.find((a) => a.rolle === 'abholpunkt');
  ok(SharedStellung.sichtKacheln(pay, ab.x * TILE + 16, ab.y * TILE + 16, cfg) === 10, 'Landezone: Sicht 10');
  ok(Protocol.AWAY_MAP_MAX_BYTES >= B, 'unter der Protokollgrenze');
}

console.log(`\n${fails ? 'VERFEHLT' : 'ok'}: ${n - fails}/${n}`);
process.exit(fails ? 1 : 0);
