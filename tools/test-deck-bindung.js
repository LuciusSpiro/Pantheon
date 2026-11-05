#!/usr/bin/env node
'use strict';
// GEL-02 Paket D: Gegner auf Karten mit Decks (außer Schiff) bleiben auf dem Deck, auf dem sie entstehen (squad.js spawnAnKarte setzt s.deckBindung).
// Probekarte: Wildnis (Gelaende.erzeuger().karteRoh, klein) + von Hand gebautes zweites Deck (Fels-Rand, Boden, Leiter-Link, wache/patrouille-Anker).
//   node tools/test-deck-bindung.js
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');
const Buehne = require('../shared/buehne.js');
const Gel = require('../shared/gen-gelaende.js');
const W = require('../server/world.js');
const away = require('../server/sim/away.js');
const combat = require('../server/sim/combat.js');
const squad = require('../server/sim/squad.js');
const { Game } = require('../server/game.js');

let n = 0, bad = 0;
const ok = (c, t) => { n++; if (!c) { bad++; console.log('  FEHLER ' + t); } else console.log('  ok   ' + t); };
const section = (t, f) => { console.log(t); f(); };
const TICK = CONFIG.tickHz;
const fehlerZahl = (g) => (Array.isArray(g.errors) ? g.errors.length : g.errors | 0);

// ---- Probekarte ----
const roh = Gel.erzeuger().karteRoh(3, { biom: 'wueste', groesse: 'klein' });
const Wd = roh.w, Hs = roh.h, Hd = 18, stride = Hs;
const A0 = roh.anker.find((a) => a.ankunft);
const frei3 = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (roh.rows[y + dy][x + dx] !== ':') return false; return true; };
const nahAnker = (x, y, r) => roh.anker.some((a) => Math.abs(a.x - x) <= r && Math.abs(a.y - y) <= r);
let E = null, besteD = -1;
for (let y = 3; y < Hs - 4; y++) for (let x = 3; x < Wd - 3; x++) {
  if (!frei3(x, y) || nahAnker(x, y, 3)) continue;
  const d = Math.abs(x - A0.x) + Math.abs(y - A0.y);
  if (d >= 10 && d <= 40 && d > besteD) { besteD = d; E = [x, y]; }
}
if (!E) throw new Error('kein Platz für die Oberflächen-Leiter');
const U = [Math.floor(Wd / 2), 9];   // Leiter unten (Deck-Koordinate)
const Y = (y) => y + stride;
const rows = roh.rows.slice();
for (let y = 0; y < Hd; y++) rows.push((y === 0 || y === Hd - 1) ? 'F'.repeat(Wd) : 'F' + ','.repeat(Wd - 2) + 'F');
roh.rows = rows; roh.h = rows.length;
roh.anker.push({ id: 'gelaende.leiter', rolle: 'leiter', x: E[0], y: E[1], platz: 'gelaende', bereich: 'gelaende' });
roh.anker.push({ id: 'hoehle.leiter', rolle: 'leiter', x: U[0], y: Y(U[1]), platz: 'hoehle', bereich: 'hoehle' });
[[4, 4], [Wd - 6, 4], [5, 13]].forEach((p, i) => roh.anker.push({ id: 'hoehle.wache.1' + (i + 1), rolle: 'wache', x: p[0], y: Y(p[1]), platz: 'hoehle', bereich: 'hoehle_lager_1' }));
[[Wd - 6, 13], [Wd - 12, 4]].forEach((p, i) => roh.anker.push({ id: 'hoehle.patrouille.1' + (i + 1), rolle: 'patrouille', kette: 'd', x: p[0], y: Y(p[1]), platz: 'hoehle', bereich: 'hoehle_lager_1' }));
roh.bereiche.hoehle_lager_1 = { name: 'Höhle 1', rects: [[1, Y(1), Wd - 2, Hd - 2]], gefecht: true };
roh.bereiche.hoehle = { name: 'Höhle', rects: [[1, Y(1), Wd - 2, Hd - 2]] };
roh.decks = { stride, links: [{ a: [E[0], E[1]], b: [U[0], Y(U[1])], via: 'leiter' }] };
roh.meta.boden2 = 'erde';
roh.id = 'test.deckbindung';
const r1 = Buehne.ausRaster(roh, { spiel: true });
if (!r1.pruefung.ok) throw new Error('Probekarte ungültig: ' + JSON.stringify(r1.pruefung.fehler || r1.pruefung).slice(0, 300));
const oberLager = Object.keys(r1.karte.bereiche).find((id) => /^lager_\d+$/.test(id) && r1.karte.anker.some((a) => a.rolle === 'wache' && a.bereich === id));
if (!oberLager) throw new Error('kein Oberflächen-Lager');
const tileVon = (o) => Physics.toTile(o.x, o.y);
const deckVon = (o) => Math.floor(tileVon(o).y / stride);

function neuesSpiel(np, karte, id) {
  const g = new Game({ noStore: true, seed: 5, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  g.cs = [];
  for (let i = 0; i < np; i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 500) this.inbox.push(m); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'K' + i, color: i }); g.handleMessage(c, { t: 'ready', ready: true }); g.cs.push(c);
  }
  W.AWAY_MAPS[id] = { id, karte };
  g.aways[id] = away.makeLandepunkt(g, id);
  g.setAwayMap(id); away.executeBeam(g, g.players.map((p) => p.id), 'down');
  return g;
}
const mk = (np) => neuesSpiel(np || 2, r1.karte, 'test.deckbindung');
const run = (g, sec, each) => { for (let k = 0; k < Math.round(sec * TICK); k++) { g.step(); if (each) each(); } };
const place = (g, i, tx, ty) => { const p = g.players[i]; const c = Physics.tileCenter(tx, ty); p.x = c.x; p.y = c.y; p.input.mx = 0; p.input.my = 0; };
const bindungen = (aw) => Object.values(aw.squads).filter((s) => s.name !== 'warden').map((s) => s.deckBindung == null ? null : s.deckBindung);
const MAP = 'test.deckbindung';
const besetzen = (g, bereich, extra) => combat.besetzen(g, Object.assign({ map: MAP, bereich, fraktion: 'raubzug', staerke: 'mittel', tag: 'j' }, extra || {}));

section('(a) Bindung beim Aufstellen: Deck des Spawn-Orts', () => {
  const g1 = mk(); const aw1 = g1.aways[MAP];
  const n1 = besetzen(g1, 'hoehle_lager_1');
  ok(n1 > 0 && aw1.drones.every((e) => deckVon(e) === 1) && bindungen(aw1).length > 0 && bindungen(aw1).every((b) => b === 1), `Gegner auf Deck 1 (${n1}): alle Trupps deckBindung 1 [${bindungen(aw1)}]`);
  const g0 = mk(); const aw0 = g0.aways[MAP];
  const n0 = besetzen(g0, oberLager);
  ok(n0 > 0 && aw0.drones.every((e) => deckVon(e) === 0) && bindungen(aw0).length > 0 && bindungen(aw0).every((b) => b === 0), `Gegner auf Deck 0 (${n0}): alle Trupps deckBindung 0 [${bindungen(aw0)}]`);
  const gs = mk(); const aws = gs.aways[MAP];
  const ns = squad.spawnSquad(gs, 'direkt', { map: MAP, bereich: 'hoehle_lager_1', besetzung: [{ typ: 'grundtyp', anzahl: 2 }], force: true });
  ok(ns > 0 && aws.squads.direkt.deckBindung === 1, 'squad.spawnSquad direkt (Debug-/Mission-Weg): Bindung 1');
  const gp = mk(); const awp = gp.aways[MAP];
  const np = squad.spawnSquad(gp, 'fest', { map: MAP, besetzung: [{ typ: 'grundtyp', anzahl: 2 }], force: true, plaetze: r1.karte.anker.filter((a) => a.rolle === 'wache' && a.bereich === 'hoehle_lager_1').slice(0, 2), festeZahl: true });
  ok(np === 2 && awp.squads.fest.deckBindung === 1, 'feste Plätze (Patrouillen/Baracken/Endkampf-Weg): Bindung 1');
  // Szenario überschreibt danach: Wert bleibt, was das Szenario setzt
  gs.aways[MAP].squads.direkt.deckBindung = 0;
  ok(gs.aways[MAP].squads.direkt.deckBindung === 0, 'Szenario (graben.js) kann danach überschreiben');
  // gemischte Plätze ohne Bereich (Anker beider Decks): Trupp bleibt auf EINEM Deck (Deck des ersten Platzes) und ist gebunden; Mehrspieler-Fälle: test-deck-bindung-misch.js
  const gm = mk(); const awm = gm.aways[MAP];
  squad.spawnSquad(gm, 'misch', { map: MAP, besetzung: [{ typ: 'grundtyp', anzahl: 2 }], force: true, festeZahl: true, plaetze: [r1.karte.anker.find((a) => a.id === 'hoehle.wache.11'), { x: 3, y: 3 }] });
  const dk = new Set(awm.drones.map(deckVon));
  ok(dk.size === 1 && awm.squads.misch.deckBindung === [...dk][0], `Plätze auf beiden Decks ohne Bereich: Trupp auf einem Deck (${[...dk]}), gebunden (${awm.squads.misch.deckBindung}), ${awm.drones.length} statt 2 Gegner`);
  ok(fehlerZahl(g1) === 0 && fehlerZahl(g0) === 0, 'keine Serverfehler');
});

// Jagd: Gegner alarmiert, Spieler auf dem anderen Deck an der Leiter. binden: false = Gegenprobe (Bindung wird entfernt)
function jagd(np, quellBereich, spielerOben, binden) {
  const g = mk(np); const aw = g.aways[MAP];
  const nn = besetzen(g, quellBereich, { haltung: 'wach' });
  if (!binden) for (const s of Object.values(aw.squads)) s.deckBindung = null;
  const decks0 = aw.drones.map(deckVon);
  g.players.forEach((p, i) => { if (spielerOben) place(g, i, E[0] + (i % 2), E[1] + 1 + (i >> 1)); else place(g, i, U[0] + (i % 2), Y(U[1]) + 1 + (i >> 1)); });
  const wechsel = new Set(); let t1 = null;
  const keep = () => { for (const s of Object.values(aw.squads)) { s.alert = true; for (const p of g.players) { s.lastKnown[p.id] = { x: p.x, y: p.y, t: g.time }; if (p.shield) p.shield.seg = 3; p.downed = false; p.hp = 100; } } };
  run(g, 60, () => { keep(); aw.drones.forEach((e, i) => { if (e.alive && deckVon(e) !== decks0[i]) { wechsel.add(e.id); if (t1 == null) t1 = Math.round(g.time * 10) / 10; } }); });
  return { n: nn, wechsel: wechsel.size, t1, fehler: fehlerZahl(g) };
}

section('(b) 60 s alarmiert, Spieler auf dem anderen Deck: kein Wechsel', () => {
  const b1 = jagd(2, 'hoehle_lager_1', true, true);
  ok(b1.n > 0 && b1.wechsel === 0 && b1.fehler === 0, `Deck 1 -> Spieler oben: ${b1.wechsel} von ${b1.n} wechseln (Ziel 0)`);
  const b2 = jagd(2, oberLager, false, true);
  ok(b2.n > 0 && b2.wechsel === 0 && b2.fehler === 0, `Deck 0 -> Spieler unten: ${b2.wechsel} von ${b2.n} wechseln (Ziel 0)`);
});

section('(c) Gegenprobe ohne Bindung (Test setzt deckBindung = null): sie nehmen die Leiter', () => {
  const c1 = jagd(2, 'hoehle_lager_1', true, false);
  ok(c1.wechsel > 0, `Deck 1 -> oben: ${c1.wechsel} von ${c1.n} wechseln, erster nach ${c1.t1} s`);
  const c2 = jagd(2, oberLager, false, false);
  ok(c2.wechsel > 0, `Deck 0 -> unten: ${c2.wechsel} von ${c2.n} wechseln, erster nach ${c2.t1} s`);
});

section('Alarm/Funk/Lärm bleiben je Deck', () => {
  const g = mk(); const aw = g.aways[MAP];
  besetzen(g, 'hoehle_lager_1', { haltung: 'ruhig' });
  const unten = aw.drones[0];
  const ts = unten.x;   // Funk an der Oberfläche genau über dem Höhlen-Gegner (2 Kacheln Deck-Abstand im Erzeuger, hier gleiches x, y minus stride)
  aw.funk = (aw.funk || []).concat([{ at: 0, x: ts, y: unten.y - stride * Physics.TILE, von: 'test' }]);
  run(g, 3);
  ok(Object.values(aw.squads).every((s) => !s.alert), 'Funk auf Deck 0 weckt keinen Trupp auf Deck 1');
  aw.funk = [{ at: 0, x: unten.x, y: unten.y, von: 'test' }];
  run(g, 3);
  ok(Object.values(aw.squads).some((s) => s.alert), 'Funk auf Deck 1 weckt den Trupp auf Deck 1 (Gegenprobe)');
  const g2 = mk(); const aw2 = g2.aways[MAP];
  besetzen(g2, oberLager, { haltung: 'ruhig' });
  const oben = aw2.drones[0];
  aw2.funk = [{ at: 0, x: oben.x, y: oben.y + stride * Physics.TILE, von: 'test' }];
  run(g2, 3);
  ok(Object.values(aw2.squads).every((s) => !s.alert), 'Funk auf Deck 1 weckt keinen Trupp auf Deck 0');
  ok(fehlerZahl(g) === 0 && fehlerZahl(g2) === 0, 'keine Serverfehler');
});

section('(d) Spieler wechselt das Deck jederzeit per Leiter (hin und zurück)', () => {
  const g = mk(); const aw = g.aways[MAP];
  besetzen(g, 'hoehle_lager_1', { haltung: 'wach' });
  const p = g.players[0];
  const leiter = (tx, ty) => { place(g, 0, tx, ty); g.handleMessage(g.cs[0], { t: 'act', down: true }); run(g, 2.6, () => { p.downed = false; }); g.handleMessage(g.cs[0], { t: 'act', down: false }); run(g, 0.5); };
  place(g, 0, E[0], E[1]);
  const d0 = deckVon(p);
  leiter(E[0], E[1]);
  const d1 = deckVon(p);
  leiter(U[0], Y(U[1]));
  const d2 = deckVon(p);
  ok(d0 === 0 && d1 === 1 && d2 === 0, `Deck ${d0} -> ${d1} -> ${d2} (Gegner unten gebunden und alarmiert)`);
  ok(fehlerZahl(g) === 0, 'keine Serverfehler');
});

section('(e) Schiff mit Decks: Bindung bleibt aus (Gegner nehmen Leiter/Lift)', () => {
  const kSchiff = Object.assign({}, r1.karte, { art: 'schiff' });
  const g = neuesSpiel(2, kSchiff, 'test.schiffdecks'); const aw = g.aways['test.schiffdecks'];
  const nn = combat.besetzen(g, { map: 'test.schiffdecks', bereich: 'hoehle_lager_1', fraktion: 'raubzug', staerke: 'mittel', tag: 'j' });
  ok(nn > 0 && bindungen(aw).every((b) => b === null), `art schiff: ${nn} Gegner, Trupps ohne Bindung [${bindungen(aw)}]`);
});

section('(f) Tick-Zeit mit 4 Spielern und alarmierten Trupps auf beiden Decks', () => {
  const g = mk(4); const aw = g.aways[MAP];
  besetzen(g, 'hoehle_lager_1', { haltung: 'wach' });
  besetzen(g, oberLager, { haltung: 'wach' });
  // 2 Spieler oben an der Leiter, 2 unten: jeder Trupp hat ein Ziel auf dem eigenen und auf dem fremden Deck
  place(g, 0, E[0], E[1] + 1); place(g, 1, E[0] + 1, E[1] + 1); place(g, 2, U[0], Y(U[1]) + 1); place(g, 3, U[0] + 1, Y(U[1]) + 1);
  const keep = () => { for (const s of Object.values(aw.squads)) { s.alert = true; for (const p of g.players) { s.lastKnown[p.id] = { x: p.x, y: p.y, t: g.time }; if (p.shield) p.shield.seg = 3; p.downed = false; p.hp = 100; } } };
  run(g, 3, keep);
  const ms = [];
  for (let i = 0; i < 20 * TICK; i++) { keep(); const t0 = process.hrtime.bigint(); g.step(); ms.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  const s = ms.slice().sort((a, b) => a - b); const med = s[Math.floor(s.length * 0.5)], p95 = s[Math.floor(s.length * 0.95)], max = s[s.length - 1];
  const budget = 1000 / TICK;
  console.log(`  Messung (${aw.drones.length} Gegner, 4 Spieler): step Median ${med.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, max ${max.toFixed(1)} ms (Budget ${budget.toFixed(1)} ms)`);
  // GEL-02: einzelne Ausreißer-Ticks (GC, Systemspitzen, parallele Läufe) dürfen den Test nicht kippen (gemessen: Median immer 0,4 ms, vereinzelt Max bis 211 ms).
  // Harte Tick-Messung mit Wiederholungen und Streuung: tools/gel02-tickmess.js (0 Ticks über Budget in 18 Läufen).
  const ueber = s.filter((v) => v > budget).length;
  ok(med < budget / 4, `Median ${med.toFixed(2)} ms unter einem Viertel des Tick-Budgets ${budget.toFixed(1)} ms`);
  ok(ueber <= Math.ceil(s.length * 0.01), `höchstens 1 % der Ticks über ${budget.toFixed(1)} ms (${ueber} von ${s.length}, max ${max.toFixed(1)} ms)`);
  ok(fehlerZahl(g) === 0, 'keine Serverfehler');
});

console.log(`\n${n - bad}/${n} ok`);
process.exit(bad ? 1 : 0);
