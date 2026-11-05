'use strict';
// MON-01 P2b: Teamregeln des Monster-Rahmens als Bausteine (server/sim/kreatur.js), alle nur über Daten eingeschaltet: ruecken, aufladung, koeder, rammschaden.
// Echtes Spiel (Game). Kesh (Schüsse über alle Waffenwege) und Station Helix (Bewegung, Lärm, Rammen).
// Geprüft: Rücken (vorn/Seite/hinten/ohne Feld/Front+Rücken/Bogenrand/Drohne unverändert/Nahkampf läuft vorbei), Aufladung (jeder Treffer genau einmal über Projektil, Granate auf
// mehrere Ziele, Lanze, Nahkampf, Orbitalschlag; Tempo, Zerfall, Obergrenze, abgelenkt zählt, Basiswert ohne Treffer), Köder (Hörweite, Suche und Rückkehr, Cursor: Altlast,
// gleiche Tickzeit, aw.laerm unberührt, Trupp-Verhalten mit/ohne Kreatur gleich, nicht bei Jagd), Ramm-Schaden (verwundet, god schützt, Pause, Ladung wirkt über die Reichweite,
// Wunde bleibt Wunde), Probe-Monster mit allen vier Regeln und je Regel abgeschaltet, Validator der Parameter.
//   node tools/test-kreatur-bausteine.js   (npm run test:kreatur-bausteine)
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');
const Monster = require('../server/sim/monster.js');
const Locations = require('../shared/locations.js');
const { Game } = require('../server/game.js');
const interior = require('../server/sim/interior.js');
const combat = require('../server/sim/combat.js');
const away = require('../server/sim/away.js');
const squad = require('../server/sim/squad.js');
const space = require('../server/sim/space.js');
const Welt = require('../server/sim/welt.js');
const Waffen = require('../server/sim/waffen.js');
const Kreatur = require('../server/sim/kreatur.js');
const KREATUREN = require('../content/kampf/kreaturen.json');

const DT = 1 / CONFIG.tickHz;
const TILE = Physics.TILE;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (name, body) => {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
};
const kopie = (o) => JSON.parse(JSON.stringify(o));
const nahe = (a, b, tol) => Math.abs(a - b) <= tol;

// ---------- Testtypen (nur Datenzeilen; vor dem ersten Gebrauch der Daten) ----------
const BASIS = { groesse: 2, sicht: 4, verlustZeit: 3, replan: 0.5, hitRadius: 18, schild: { seg: 6, max: 6 }, wunden: 2, frontArc: 0, tuerenAufbrechen: false, rammZeit: 1.2 };
const AUF = { max: 3, zerfallNach: 2, zerfallSchritt: 1, tempoFaktor: 0.5, rammFaktor: 0.5 };
const typ = (name, extra) => { KREATUREN.typen[name] = Object.assign({ name: 'kreatur.' + name }, kopie(BASIS), extra); return KREATUREN.typen[name]; };
const STEHT = { steht: { modus: 'steht', tempo: 0, uebergang: [] } };
typ('tb_ruecken', { start: 'steht', zustaende: STEHT, bausteine: { ruecken: { bogen: 90, faktor: 2 } } });
typ('tb_ruecken_front', { frontArc: 120, start: 'steht', zustaende: STEHT, bausteine: { ruecken: { bogen: 90, faktor: 2 } } });
typ('tb_ohne', { start: 'steht', zustaende: STEHT, bausteine: {} });
typ('tb_auf', { start: 'steht', zustaende: STEHT, bausteine: { aufladung: AUF } });
typ('tb_auf_front', { frontArc: 120, start: 'steht', zustaende: STEHT, bausteine: { aufladung: AUF } });
typ('tb_tempo', { start: 'steht', zustaende: {
  steht: { modus: 'steht', tempo: 0, uebergang: [ { auf: 'blockiert', nach: 'rammen' } ] },   // blockiert löst im Stehen nie aus: rammen wird nur über zustandSetzen betreten, der Validator verlangt aber Erreichbarkeit
  rammen: { modus: 'ramme', tempo: 100, dauer: 0.5, uebergang: [ { auf: 'ablauf', nach: 'steht' } ] } }, bausteine: { zyklus: { hindernisAb: 0.3 }, aufladung: AUF } });
typ('tb_koeder', { start: 'patrouille', zustaende: {
  patrouille: { modus: 'steht', tempo: 0, uebergang: [ { auf: 'sieht', nach: 'jagd' }, { auf: 'laerm', nach: 'laerm' } ] },
  laerm: { modus: 'zumKoeder', tempo: 100, uebergang: [ { auf: 'sieht', nach: 'jagd' }, { auf: 'koederEnde', nach: 'patrouille' } ] },
  jagd: { modus: 'steht', tempo: 0, uebergang: [] } }, bausteine: { koeder: { faktor: 1.5, dauer: 2 } } });
// Leser ohne Bewegung: bleibt im Zustand laerm stehen (kein Eingriff in die Schusslinie der Drohnen-Szene)
typ('tb_leser', { start: 'patrouille', zustaende: {
  patrouille: { modus: 'steht', tempo: 0, uebergang: [ { auf: 'laerm', nach: 'laerm' } ] },
  laerm: { modus: 'steht', tempo: 0, uebergang: [ { auf: 'koederEnde', nach: 'patrouille' } ] } }, bausteine: { koeder: { faktor: 1.5, dauer: 2 } } });
typ('tb_ramm', { start: 'rammen', zustaende: {
  rammen: { modus: 'ramme', tempo: 0, dauer: 5, uebergang: [ { auf: 'getroffen', nach: 'pause' }, { auf: 'ablauf', nach: 'pause' } ] },
  pause: { modus: 'steht', tempo: 0, dauer: 2, uebergang: [ { auf: 'ablauf', nach: 'rammen' } ] } },
  bausteine: { zyklus: { hindernisAb: 0.3 }, rammschaden: { radius: 30 }, aufladung: AUF } });
// Probe-Monster ohne je einen Baustein (Daten wie probe, jede Regel einzeln abgeschaltet)
function probeOhne(baustein) {
  const t = kopie(KREATUREN.typen.probe); delete t.bausteine[baustein];
  if (baustein === 'koeder') { delete t.zustaende.laerm; t.zustaende.patrouille.uebergang = t.zustaende.patrouille.uebergang.filter((u) => u.auf !== 'laerm'); }
  if (baustein === 'rammschaden') t.zustaende.rammen.uebergang = t.zustaende.rammen.uebergang.filter((u) => u.auf !== 'getroffen');
  t.name = 'kreatur.probe_ohne_' + baustein; KREATUREN.typen['probe_ohne_' + baustein] = t;
}
for (const b of ['ruecken', 'aufladung', 'koeder', 'rammschaden']) probeOhne(b);

// Treffer-Zähler am zentralen Dispatcher (combat ruft Kreatur.bausteinTreffer über die Modul-Eigenschaft)
const zaehl = new Map();
const bausteinTrefferOrig = Kreatur.bausteinTreffer;
Kreatur.bausteinTreffer = function (g, K) { zaehl.set(K.id, (zaehl.get(K.id) || 0) + 1); return bausteinTrefferOrig.apply(this, arguments); };
const anzahl = (K) => zaehl.get(K.id) || 0;

// ---------- Szene Kesh: Schüsse über alle Waffenwege ----------
function szene(seed) {
  const g = new Game({ noStore: true, seed: seed || 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'Kre', color: 0 });
  g.handleMessage(c, { t: 'ready', ready: true });
  for (let k = 0; k < 6; k++) g.step();
  g.setAwayMap('kesh');
  g.aways.kesh.active = true;
  const p = g.players[0];
  interior.placeOnAwayPad(g, p, 0); combat.onArrive(g, p);
  g.god = true;
  const aw = g.aways.kesh;
  aw.drones.length = 0;
  aw.kreaturen = [];
  const E = combat.env(g);
  const kart = g.karteOf(aw.map);
  let bahn = null;
  for (let ty = 2; ty < kart.h - 2 && !bahn; ty++) for (let tx = 2; tx < kart.w - 16; tx++) {
    let frei = true;
    for (let i = 0; i <= 14 && frei; i++) if (E.solid(tx + i, ty) || E.shotBlocked(tx + i, ty)) frei = false;
    if (frei) { bahn = { tx, ty }; break; }
  }
  if (!bahn) throw new Error('keine freie Bahn auf kesh');
  const S = { g, c, p, aw, bahn };
  S.ev = (kind) => c.inbox.filter((m) => m.t === 'event' && m.kind === kind);
  S.lauf = (sek, vor) => { for (let k = 0; k < Math.round(sek / DT); k++) { if (vor) vor(); g.step(); } };
  S.setze = (dx) => Physics.tileCenter(bahn.tx + dx, bahn.ty);
  S.platz = (dx) => { const q = S.setze(dx); p.x = q.x; p.y = q.y; p.input.mx = 0; p.input.my = 0; };
  S.kreatur = (dx, o) => {
    o = o || {};
    const q = S.setze(dx);
    const K = Kreatur.erzeugen(g, o.typ || 'tb_ohne', q.x, q.y + (o.dy || 0));
    K.facing = o.facing == null ? Math.PI : o.facing;
    if (o.seg != null) { K.seg = o.seg; K.max = Math.max(K.max, o.seg); K.hp = o.seg; }
    if (o.frontArc != null) K.frontArc = o.frontArc;
    return K;
  };
  S.drohne = (dx, facing) => { const e = squad.makeEnemy(g, aw, 'scavenger', 'D' + g.nextId(''), S.setze(dx), 'test'); e.asleep = false; e.frozen = true; e.rolle = 'grundtyp'; e.facing = facing; aw.drones.push(e); combat.kaempfer(g, e); return e; };
  S.waffe = (w) => { const k = combat.kaempfer(g, p); k.waffe = w; k.hitze = 0; k.gesperrtBis = 0; k.bereitAt = 0; k.ladung = null; k.ausholen = null; };
  S.schuss = (w) => { S.waffe(w); away.shoot(g, p, 0); };
  return S;
}

// ---------- Szene Station Helix: lange breite Gänge für Bewegung, Lärm, Rammen (Station-Monster aus, ein Spieler unverwundbar) ----------
function stationRoh() {
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send() {}, sendRaw() {} };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'T0', name: 'Kre', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'free' }); g.handleMessage(c, { t: 'ready', ready: true });
  Welt.waehle(g, 'sund'); g.god = true; space.enterScene(g, 'helix', {});
  const sc = Locations.get('helix').scene; g.ship.x = sc.station.x - 100; g.ship.y = sc.station.y;
  const run = (sec, each) => { for (let k = 0; k < Math.round(sec / DT); k++) { if (each && each(k * DT) === true) return true; g.step(); } return false; };
  run(0.2);
  g.chooseLandepunkt(g.players[0], 'helix.station');
  away.executeBeam(g, g.players.map((q) => q.id), 'down');
  run(0.3);
  return { g, c, run, p: g.players[0] };
}
function strecken(m, min) {
  const out = [];
  for (let cy = 2; cy < m.h - 1; cy++) {
    let cx = 1;
    while (cx < m.w) {
      if (!m.geht(cx, cy)) { cx++; continue; }
      let e = cx; while (m.geht(e + 1, cy)) e++;
      if (e - cx + 1 >= min && !m.geht(e + 1, cy) && e + 1 < m.w) out.push({ cy, cx0: cx, cx1: e });
      cx = e + 1;
    }
  }
  return out.sort((a, b) => (b.cx1 - b.cx0) - (a.cx1 - a.cx0));
}
function station() {
  const T = stationRoh(); const g = T.g; const p = T.p;
  g.away.monster = null;
  p.x = 3 * TILE; p.y = 3 * TILE; p.downed = false;
  const k = g.karteOf(g.away.map);
  const m = Monster.maskeVon(k);
  const S = { g, c: T.c, p, k, m, pad: { x: p.x, y: p.y }, me: [], ev: [] };
  S.lauf = (sek, each) => T.run(sek, each);
  S.setz = (x, y) => { p.x = x; p.y = y; p.downed = false; };
  S.fern = () => S.setz(S.pad.x, S.pad.y);
  // eine Strecke, deren Anfang weit vom Spieler-Parkplatz liegt (kein Sichtkontakt)
  S.lang = strecken(m, 16).find((l) => Math.hypot(l.cx0 * TILE - S.pad.x, l.cy * TILE - S.pad.y) > 14 * TILE) || strecken(m, 16)[0];
  S.pos = (cx, cy) => ({ x: cx * TILE, y: cy * TILE });
  S.kreatur = (typId, cx, cy) => { combat.ensureV2(g, g.away); const q = S.pos(cx, cy); return Kreatur.erzeugen(g, typId, q.x, q.y); };
  S.laerm = (x, y, stufe) => Waffen.laerm(g, x, y, stufe || 'leise');
  const m0 = g.missionEvent.bind(g); g.missionEvent = (nm, d) => { S.me.push(nm); return m0(nm, d); };
  const e0 = g.emit.bind(g); g.emit = (kind, d) => { S.ev.push(kind); return e0(kind, d); };
  // Grundrauschen im Aufbau der Station (Spielleiter-Mock, g.errors 2): die Fehlerquellen mitschreiben, nur kreatur-/kampfseitige zählen
  S.fehler = []; const ce = g.countError.bind(g); g.countError = (name, e) => { S.fehler.push(name); return ce(name, e); };
  S.fehlerFrei = () => !S.fehler.some((f) => /kreatur|combat|waffen|squad/.test(f));
  return S;
}
const hitVon = (S, K, segs) => combat.hitEnemy(S.g, K, segs || 1, { x: K.x + 100, y: K.y, pid: S.p.id });

// ======================================================================================================
section('Rücken: von vorn, Seite, hinten, ohne Feld (echte Schüsse)', () => {
  const schussAuf = (typId, facing, o) => { const S = szene(); S.platz(0); const K = S.kreatur(6, Object.assign({ typ: typId, facing }, o || {})); S.schuss('blaster'); S.lauf(1.0); return { S, K }; };
  let r = schussAuf('tb_ruecken', Math.PI);
  ok(r.K.seg === 5, 'von vorn: Schild 6 -> 5 (seg=' + r.K.seg + ')');
  r = schussAuf('tb_ruecken', Math.PI / 2);
  ok(r.K.seg === 5, 'von der Seite: Schild 6 -> 5 (seg=' + r.K.seg + ')');
  r = schussAuf('tb_ruecken', 0);
  ok(r.K.seg === 4, 'von hinten: Schaden × 2, Schild 6 -> 4 (seg=' + r.K.seg + ')');
  ok(r.K.ruecken && r.K.ruecken.bogen === 90 && r.K.ruecken.faktor === 2, 'ausruesten hat die Parameter in die Kreatur übernommen ({bogen, faktor})');
  r = schussAuf('tb_ohne', 0);
  ok(r.K.seg === 5 && r.K.ruecken === undefined, 'ohne Feld von hinten: Schild 6 -> 5, kein ruecken-Feld (seg=' + r.K.seg + ')');
  // Front und Rücken zugleich
  r = schussAuf('tb_ruecken_front', Math.PI);
  ok(r.K.seg === 6 && r.S.ev('abgelenkt').length === 1, 'Front 120° und Rücken: von vorn abgelenkt, Schild unverändert (seg=' + r.K.seg + ')');
  r = schussAuf('tb_ruecken_front', 0);
  ok(r.K.seg === 4 && r.S.ev('abgelenkt').length === 0, 'Front 120° und Rücken: von hinten Schaden × 2 (seg=' + r.K.seg + ')');
  r = schussAuf('tb_ruecken_front', Math.PI / 2);
  ok(r.K.seg === 5, 'Front 120° und Rücken: von der Seite einfacher Schaden (seg=' + r.K.seg + ')');
  // Drohne mit denselben Schüssen unverändert (hat das Feld nie)
  const S = szene(); S.platz(0); const d = S.drohne(6, 0); S.schuss('blaster'); S.lauf(1.0);
  ok(d.max - d.seg === 1 && d.ruecken === undefined, 'Drohne von hinten: Schaden 1, kein Rückenfeld (' + d.seg + '/' + d.max + ')');
});

section('Rücken: Zahlen am Bogenrand, nur Schildschaden (Waffen.treffer direkt)', () => {
  const S = szene();
  const ziel = (extra) => Object.assign({ id: 'Z', x: 0, y: 0, facing: 0, team: 'feind', zustand: 'ok', schild: { seg: 6, max: 6, lastHitAt: -99, regenT: 0 }, wunden: { n: 2, max: 2 }, ruecken: { bogen: 90, faktor: 2 } }, extra || {});
  const von = (grad) => ({ x: Math.cos(grad * Math.PI / 180) * 100, y: Math.sin(grad * Math.PI / 180) * 100, team: 'crew' });
  const w = { waffe: 'blaster', schaden: 1 };
  for (const [grad, erwartet] of [[0, 5], [90, 5], [130, 5], [136, 4], [180, 4], [-140, 4], [-130, 5]]) {
    const z = ziel(); Waffen.treffer(S.g, z, w, von(grad));
    ok(z.schild.seg === erwartet, 'Schuss aus ' + grad + '° (Bogen 90° um die Rückseite, Rand bei 135°): seg ' + erwartet + ' (ist ' + z.schild.seg + ')');
  }
  const z0 = ziel({ ruecken: undefined }); Waffen.treffer(S.g, z0, w, von(180));
  ok(z0.schild.seg === 5, 'ohne ziel.ruecken: Schaden 1 (wie der alte Ausdruck)');
  const z1 = ziel(); Waffen.treffer(S.g, z1, { waffe: 'nahkampf', schaden: 1, wunde: true }, von(180));
  ok(z1.schild.seg === 6 && z1.wunden.n === 1, 'Nahkampf (wunde) läuft am Rückenfaktor vorbei: Wunden 2 -> 1, Schild unberührt');
  const z2 = ziel(); Waffen.treffer(S.g, z2, { waffe: 'orbital', schaden: 1, strike: true }, { team: 'orbit' });
  ok(z2.schild.seg === 5, 'Orbitalschlag (ohne Schützenposition): einfacher Schaden');
  const z3 = ziel({ ruecken: { bogen: 90, faktor: 'x' } }); Waffen.treffer(S.g, z3, w, von(180));
  ok(z3.schild.seg === 5, 'kaputter Faktor: fällt auf 1 zurück');
});

// ======================================================================================================
section('Aufladung: jeder Treffer genau einmal (Projektil, Granate auf mehrere Ziele, Lanze, Nahkampf, Orbitalschlag)', () => {
  zaehl.clear();
  let S = szene(); S.platz(0); let K = S.kreatur(6, { typ: 'tb_auf' }); S.schuss('blaster'); S.lauf(1.0);
  ok(K.seg === 5 && anzahl(K) === 1 && K.aufladung.stufe === 1, 'Projektil: ein Treffer, genau eine Meldung, Stufe 1 (Meldungen ' + anzahl(K) + ', Stufe ' + (K.aufladung && K.aufladung.stufe) + ')');
  zaehl.clear();
  S = szene(); S.platz(0); const A = S.kreatur(6, { typ: 'tb_auf' }), B = S.kreatur(6, { typ: 'tb_auf', dy: 20 }), Cc = S.kreatur(6, { typ: 'tb_ohne', dy: -20 });
  S.waffe('granatwerfer'); S.g.handleMessage(S.c, { t: 'shoot', angle: 0, dist: 6 }); S.lauf(1.6);
  ok(A.seg < A.max && B.seg < B.max && Cc.seg < Cc.max, 'Granate trifft alle drei Ziele (' + A.seg + ', ' + B.seg + ', ' + Cc.seg + ')');
  ok(anzahl(A) === 1 && anzahl(B) === 1 && A.aufladung.stufe === 1 && B.aufladung.stufe === 1, 'Granate: jedes Ziel genau eine Meldung und Stufe 1 (A ' + anzahl(A) + ', B ' + anzahl(B) + ')');
  ok(anzahl(Cc) === 1 && Cc.aufladung === undefined, 'Ziel ohne Baustein wird gemeldet (Dispatcher), bekommt aber keine Aufladung');
  zaehl.clear();
  S = szene(); S.platz(0); const L1 = S.kreatur(6, { typ: 'tb_auf' }), L2 = S.kreatur(9, { typ: 'tb_auf' });
  S.waffe('lanze'); S.lauf(0.1); away.shoot(S.g, S.p, 0);
  for (let i = 0; i < 40; i++) S.lauf(0.05, () => { if (S.p.ladung) away.shoot(S.g, S.p, 0); });
  away.shoot(S.g, S.p, 0, { los: true }); S.lauf(0.3);
  ok(S.ev('lanzeSchuss').length === 1 && L1.seg < L1.max && L2.seg < L2.max, 'Lanze trifft beide Ziele auf der Linie (' + L1.seg + ', ' + L2.seg + ')');
  ok(anzahl(L1) === 1 && anzahl(L2) === 1 && L1.aufladung.stufe === 1 && L2.aufladung.stufe === 1, 'Lanze: jedes Ziel genau eine Meldung (' + anzahl(L1) + ', ' + anzahl(L2) + ')');
  zaehl.clear();
  S = szene(); S.platz(0); K = S.kreatur(1, { typ: 'tb_auf', seg: 0 }); S.schuss('nahkampf'); S.lauf(1.2);
  ok(K.wunden.n === 1 && anzahl(K) === 1 && K.aufladung.stufe === 1, 'Nahkampf: ein Treffer, genau eine Meldung (' + anzahl(K) + ')');
  zaehl.clear();
  S = szene(); S.platz(0); K = S.kreatur(6, { typ: 'tb_auf' });
  S.aw.pendingStrikes.push({ x: K.x, y: K.y, at: S.g.time + 0.1 }); S.lauf(0.6);
  const seg = S.g.C.awayCombat.strikeSegments;
  ok(K.seg === 2 && anzahl(K) === seg && K.aufladung.stufe === Math.min(AUF.max, seg), 'Orbitalschlag: ' + seg + ' Segmente = ' + seg + ' Treffer, Stufe gedeckelt auf ' + AUF.max + ' (Meldungen ' + anzahl(K) + ', Stufe ' + K.aufladung.stufe + ')');
  zaehl.clear();
  S = szene(); S.platz(0); K = S.kreatur(6, { typ: 'tb_auf' }); K.alive = false; K.zustand = 'verwundet'; K.liegt = true; S.schuss('blaster'); S.lauf(1.0);
  ok(anzahl(K) === 0 && K.seg === 6, 'liegende Kreatur wird nicht getroffen und nicht gemeldet');
  ok(S.g.errors === 0, 'g.errors = ' + S.g.errors);
});

section('Aufladung: abgelenkte Treffer (Front) zählen als Beschuss', () => {
  zaehl.clear();
  const S = szene(); S.platz(0); const K = S.kreatur(6, { typ: 'tb_auf_front', facing: Math.PI }); S.schuss('blaster'); S.lauf(1.0);
  ok(K.seg === 6 && S.ev('abgelenkt').length === 1, 'von vorn abgelenkt, Schild unverändert');
  ok(anzahl(K) === 1 && K.aufladung.stufe === 1, 'abgelenkter Treffer gibt trotzdem Ladung (Stufe ' + K.aufladung.stufe + ')');
});

section('Aufladung: Tempo, Zerfall, Obergrenze, Basiswert (Station)', () => {
  const S = station(); const lang = S.lang;
  ok(!!lang, 'Strecke von mindestens 16 Ankerpunkten (' + (lang ? lang.cx1 - lang.cx0 + 1 : 0) + ')');
  S.fern();
  const ram = (stufen) => {   // Strecke in 0,5 s Rammen mit Tempo 100 nach einer Anzahl Treffer
    const K = S.kreatur('tb_tempo', lang.cx0, lang.cy);
    for (let i = 0; i < stufen; i++) hitVon(S, K);
    Kreatur.zustandSetzen(S.g, K, 'rammen'); K.facing = 0;
    const x0 = K.x; S.lauf(0.5);
    return { K, d: K.x - x0 };
  };
  const r0 = ram(0), r1 = ram(1), r3 = ram(3), r6 = ram(6);
  ok(r0.d > 45 && r0.d < 55 && r0.K.aufladung === undefined && r0.K.tempoF === undefined, 'ohne Treffer: Basiswert, 50 px in 0,5 s (' + r0.d.toFixed(1) + ' px), keine Ladung');
  ok(r1.K.aufladung.stufe === 1 && nahe(r1.d / r0.d, 1.5, 0.05), 'Stufe 1: Tempo × 1,5 (' + (r1.d / r0.d).toFixed(2) + ')');
  ok(r3.K.aufladung.stufe === 3 && nahe(r3.d / r0.d, 2.5, 0.08), 'Stufe 3: Tempo × 2,5 (' + (r3.d / r0.d).toFixed(2) + ')');
  ok(r6.K.aufladung.stufe === 3 && nahe(r6.d / r0.d, 2.5, 0.08), 'sechs Treffer: Obergrenze max = 3 gilt (Stufe ' + r6.K.aufladung.stufe + ', × ' + (r6.d / r0.d).toFixed(2) + ')');
  ok(nahe(r3.K.rammF, 2.5, 1e-9), 'Rammfaktor Stufe 3 = 1 + 3 × 0,5');
  // Zerfall: zerfallNach 2 s ohne Treffer, dann eine Stufe je Sekunde
  const K = S.kreatur('tb_auf', lang.cx0, lang.cy + 0);
  for (let i = 0; i < 3; i++) hitVon(S, K);
  const stufen = [];
  S.lauf(6, (t) => { const k = Math.round(t / DT); if (k % Math.round(0.5 / DT) === 0) stufen.push(K.aufladung.stufe); });
  ok(stufen[2] === 3 && stufen[3] === 3, 'bis zerfallNach (2 s) bleibt die Stufe (nach 1,0 s ' + stufen[2] + ', nach 1,5 s ' + stufen[3] + ')');
  ok(stufen[6] === 2 && stufen[8] === 1 && stufen[11] === 0, 'danach eine Stufe je Sekunde (nach 3,0 s ' + stufen[6] + ', 4,0 s ' + stufen[8] + ', 5,5 s ' + stufen[11] + ')');
  ok(K.tempoF === 1 && K.rammF === 1, 'zerfallen: Faktoren wieder 1');
  // Treffer setzt den Zerfall zurück
  hitVon(S, K); S.lauf(1.5); hitVon(S, K); S.lauf(1.5);
  ok(K.aufladung.stufe === 2, 'ein neuer Treffer startet die Wartezeit neu (Stufe ' + K.aufladung.stufe + ')');
  ok(S.fehlerFrei(), 'keine Fehler aus Kreatur/Kampf (Quellen: ' + S.fehler.join(',') + ')');
});

// ======================================================================================================
section('Köder: Hörweite, Weg zum Ort, Suche, Rückkehr', () => {
  const S = station(); const l = S.lang; S.fern();
  const K = S.kreatur('tb_koeder', l.cx0 + 1, l.cy);
  ok(Math.hypot(S.p.x - K.x, S.p.y - K.y) > 8 * TILE, 'Spieler weit weg (kein Sichtkontakt)');
  const ev0 = S.laerm(K.x + 40 * TILE, K.y, 'leise');   // nur für den Radius; weit außerhalb jeder Hörweite
  const hoer = ev0.radius * 1.5;
  S.lauf(0.2);
  ok(K.z === 'patrouille' && !K.koeder, 'Lärm weit außerhalb: keine Reaktion');
  S.laerm(K.x + hoer * 1.2, K.y, 'leise'); S.lauf(0.2);
  ok(K.z === 'patrouille' && !K.koeder, 'Lärm knapp außerhalb der Hörweite (' + Math.round(hoer * 1.2) + ' px > ' + Math.round(hoer) + '): keine Reaktion');
  const ort = { x: K.x + hoer * 0.8, y: K.y };
  S.laerm(ort.x, ort.y, 'leise'); S.lauf(0.2);
  ok(K.z === 'laerm' && K.koeder && nahe(K.koeder.x, ort.x, 1) && nahe(K.koeder.y, ort.y, 1), 'Lärm innerhalb der Hörweite (' + Math.round(hoer * 0.8) + ' px): Zustand laerm mit dem Ort');
  const d0 = Math.hypot(ort.x - K.x, ort.y - K.y);
  S.lauf(0.8);
  ok(Math.hypot(ort.x - K.x, ort.y - K.y) < d0 - 40, 'geht zum Ort (Abstand ' + Math.round(d0) + ' -> ' + Math.round(Math.hypot(ort.x - K.x, ort.y - K.y)) + ' px)');
  S.lauf(1.5);
  ok(K.z === 'laerm' && Math.hypot(ort.x - K.x, ort.y - K.y) < 40 && K.koeder.da, 'am Ort angekommen, sucht (Abstand ' + Math.round(Math.hypot(ort.x - K.x, ort.y - K.y)) + ' px)');
  S.lauf(2.5);
  ok(K.z === 'patrouille', 'nach der Suchdauer (2 s) zurück in die Patrouille (' + K.z + ')');
  ok(S.fehlerFrei(), 'keine Fehler aus Kreatur/Kampf');
  // neuer Lärm in den Zuständen laerm lenkt um
  const K2 = S.kreatur('tb_koeder', l.cx0 + 1, l.cy + 0);
  S.laerm(K2.x + hoer * 0.5, K2.y, 'leise'); S.lauf(0.2);
  const zweit = { x: K2.x + hoer * 0.6, y: K2.y };
  S.laerm(zweit.x, zweit.y, 'leise'); S.lauf(0.2);
  ok(K2.z === 'laerm' && nahe(K2.koeder.x, zweit.x, 1), 'zweiter Lärm während der Suche lenkt auf den neuen Ort um');
});

section('Köder: Cursor (Altlast, gleiche Tickzeit, Puffer unberührt)', () => {
  // Altlast: Lärm VOR dem Anlegen wird nie gelesen
  let S = station(); let l = S.lang; S.fern();
  const nahP = S.pos(l.cx0 + 4, l.cy);
  for (let i = 0; i < 3; i++) S.laerm(nahP.x, nahP.y, 'mittel');
  S.lauf(0.2);
  const letztes = S.g.away.laerm[S.g.away.laerm.length - 1];
  let K = S.kreatur('tb_koeder', l.cx0 + 1, l.cy);
  ok(K.laermCursor.t === letztes.t && K.laermCursor.n === S.g.away.laerm.filter((e) => e.t === letztes.t).length, 'Cursor beim Anlegen = Pufferstand (t ' + K.laermCursor.t.toFixed(2) + ', n ' + K.laermCursor.n + ')');
  S.lauf(0.6);
  ok(K.z === 'patrouille' && !K.koeder, 'Altlast (3 Ereignisse in Hörweite vor dem Anlegen) wird nicht gelesen');
  S.laerm(nahP.x, nahP.y, 'mittel'); S.lauf(0.2);
  ok(K.z === 'laerm', 'Kontrolle: ein neues Ereignis am selben Ort wird gelesen');
  // Altlast mit gleicher Tickzeit wie das Anlegen (kein Tick dazwischen)
  S = station(); l = S.lang; S.fern();
  for (let i = 0; i < 3; i++) S.laerm(S.pos(l.cx0 + 4, l.cy).x, S.pos(l.cx0 + 4, l.cy).y, 'mittel');
  K = S.kreatur('tb_koeder', l.cx0 + 1, l.cy); S.lauf(0.6);
  ok(K.z === 'patrouille' && !K.koeder && K.laermCursor.n === 3, 'Altlast der gleichen Tickzeit wie das Anlegen: Cursor zählt sie mit (n=' + K.laermCursor.n + '), keine Reaktion');
  // leerer Puffer beim Anlegen
  S = station(); l = S.lang; S.fern(); S.g.away.laerm = [];
  K = S.kreatur('tb_koeder', l.cx0 + 1, l.cy);
  ok(K.laermCursor.t < -1e8 && K.laermCursor.n === 0, 'leerer Puffer: Cursor ganz vorn');
  // Zwei Ereignisse gleicher Tickzeit, das zweite entsteht NACH dem Lesen im selben Tick (Wrapper um Kreatur.update)
  const gleichTick = (erstesNah, zweitesNah) => {
    const T = station(); const ll = T.lang; T.fern();
    const Kt = T.kreatur('tb_koeder', ll.cx0 + 1, ll.cy);
    const hoer = T.laerm(0, 0, 'leise').radius * 1.5; T.g.away.laerm.pop();
    // Kreatur anlegen NACH dem Aufräumen: Cursor neu
    Kt.laermCursor = { t: -1e9, n: 0 }; T.g.away.laerm.length = 0;
    const innen = { x: Kt.x + hoer * 0.5, y: Kt.y }, aussen = { x: Kt.x + hoer * 3, y: Kt.y };
    const orig = Kreatur.update; let schritt = 0;
    Kreatur.update = function (g, dt) {
      if (schritt === 0) { const p = erstesNah ? innen : aussen; T.laerm(p.x, p.y, 'leise'); }
      orig.call(this, g, dt);
      if (schritt === 0) { const p = zweitesNah ? innen : aussen; p === innen ? T.laerm(innen.x + 7, innen.y, 'leise') : T.laerm(p.x, p.y, 'leise'); }
      schritt++;
    };
    try { T.lauf(0.1); } finally { Kreatur.update = orig; }
    const zeiten = T.g.away.laerm.map((e) => e.t);
    return { Kt, gleich: zeiten.length === 2 && zeiten[0] === zeiten[1], innen };
  };
  let r = gleichTick(false, true);
  ok(r.gleich, 'Voraussetzung: beide Ereignisse haben dieselbe Tickzeit');
  ok(r.Kt.z === 'laerm' && r.Kt.koeder && nahe(r.Kt.koeder.x, r.innen.x + 7, 1), 'erstes außerhalb (gelesen), zweites gleicher Tickzeit innerhalb: wird gesehen (nicht verloren)');
  r = gleichTick(true, false);
  ok(r.Kt.z === 'laerm' && r.Kt.koeder && nahe(r.Kt.koeder.x, r.innen.x, 1), 'erstes innerhalb, zweites außerhalb: erstes gesehen');
  // Leser schreibt nur den eigenen Cursor
  S = station(); l = S.lang; S.fern();
  K = S.kreatur('tb_koeder', l.cx0 + 1, l.cy);
  S.laerm(K.x + 50, K.y, 'leise'); S.laerm(K.x + 60, K.y, 'laut');
  const vor = JSON.stringify({ l: S.g.away.laerm, g: S.g.away.laermGelesen });
  Kreatur.update(S.g, DT);
  ok(JSON.stringify({ l: S.g.away.laerm, g: S.g.away.laermGelesen }) === vor && K.z !== undefined, 'aw.laerm und aw.laermGelesen vom Leser unberührt (Kreatur.update direkt)');
  ok(K.koeder && K.laermCursor.n >= 1, 'Cursor des Lesers ist vorgerückt (n=' + K.laermCursor.n + ')');
});

section('Köder: Trupp-Verhalten und Zufall identisch mit und ohne Kreatur', () => {
  const lauf = (mitKreatur) => {
    const T = szene(7);
    const e = squad.makeEnemy(T.g, T.aw, 'scavenger', 'DL1', T.setze(6), 'test'); e.asleep = false; e.rolle = 'grundtyp'; T.aw.drones.push(e); combat.kaempfer(T.g, e);
    let K = null;
    if (mitKreatur) K = T.kreatur(3, { typ: 'tb_leser', dy: 3 * TILE });
    T.platz(0); T.waffe('sturmgewehr');
    for (let i = 0; i < 90; i++) { if (i % 6 === 0) { T.p.bereitAt = 0; T.p.hitze = 0; away.shoot(T.g, T.p, 0); } T.g.step(); }
    return { K, json: JSON.stringify({ d: { x: e.x, y: e.y, seg: e.seg, hp: e.hp, z: e.zustand, w: e.wunden, alive: e.alive }, sq: Object.entries(T.aw.squads).map(([k, v]) => [k, v.alert, v.members && v.members.length]),
      rng: T.aw.rng(), ev: T.c.inbox.filter((m) => m.t === 'event').map((m) => m.kind), err: T.g.errors, laerm: T.aw.laerm, gelesen: T.aw.laermGelesen }) };
  };
  const a = lauf(false), b = lauf(true);
  ok(b.K.koeder && b.K.laermCursor.t > 0, 'Kontrolle: der Leser der Kreatur hat tatsächlich Lärm gelesen (Cursor t=' + b.K.laermCursor.t.toFixed(2) + ', Ort gemerkt)');
  ok(a.json === b.json, 'Drohne, Trupp, Funk-Ereignisse, aw.rng, aw.laerm und aw.laermGelesen mit und ohne Kreatur byte-gleich (' + a.json.length + ' Zeichen)');
});

section('Köder: nicht bei Jagd, nicht ohne Übergang', () => {
  const S = station(); const l = S.lang; S.fern();
  const hoer = S.laerm(0, 0, 'leise').radius * 1.5; S.g.away.laerm.pop();
  const frisch = () => { const K = S.kreatur('tb_koeder', l.cx0 + 1, l.cy); return K; };
  // jagt (Spieler gesehen, noch nicht verloren): keine Reaktion
  let K = frisch(); K.letzte = { x: K.x + 100, y: K.y }; K.verlust = 0;
  S.laerm(K.x + hoer * 0.5, K.y, 'leise'); S.lauf(0.2);
  ok(!K.koeder && K.z === 'patrouille', 'Spieler gerade gesehen (verlust < verlustZeit): Lärm wird ignoriert');
  K = frisch(); K.letzte = { x: K.x + 100, y: K.y }; K.verlust = 99;
  S.laerm(K.x + hoer * 0.5, K.y, 'leise'); S.lauf(0.2);
  ok(K.koeder && K.z === 'laerm', 'Gegenprobe: Spieler lange verloren (verlust >= verlustZeit): reagiert');
  // Zustand ohne Übergang `laerm` (jagd dieses Testtyps), Spieler nie gesehen: Lärm in Hörweite wird nicht aufgenommen
  K = frisch(); Kreatur.zustandSetzen(S.g, K, 'jagd'); S.laerm(K.x + hoer * 0.5, K.y, 'leise'); S.lauf(0.2);
  ok(!K.koeder && K.z === 'jagd', 'Zustand ohne Übergang laerm: keine Reaktion');
  // natürlich: Spieler in Sicht -> Jagd, dann Lärm
  const S2 = station(); const l2 = S2.lang;
  const J = S2.kreatur('tb_koeder', l2.cx0 + 1, l2.cy);
  const pp = S2.pos(l2.cx0 + 3, l2.cy); S2.setz(pp.x, pp.y); S2.lauf(0.4);
  ok(J.z === 'jagd', 'Spieler in Sicht: Zustand jagd (' + J.z + ')');
  S2.laerm(J.x - 30, J.y, 'leise'); S2.lauf(0.3);
  ok(J.z === 'jagd' && !J.koeder, 'in der Jagd: Lärm ändert nichts');
  // Köder-Ziel wird von Jagd verworfen: Kreatur sucht, sieht Spieler
  const S3 = station(); const l3 = S3.lang; S3.fern();
  const Kb = S3.kreatur('tb_koeder', l3.cx0 + 1, l3.cy);
  S3.laerm(Kb.x + hoer * 0.5, Kb.y, 'leise'); S3.lauf(0.2);
  ok(Kb.z === 'laerm' && !!Kb.koeder, 'läuft zum Lärm');
  const pq = S3.pos(l3.cx0 + 3, l3.cy); S3.setz(pq.x, pq.y); S3.lauf(0.3);
  ok(Kb.z === 'jagd' && !Kb.koeder, 'sieht unterwegs einen Spieler: Jagd, Köder-Ziel verworfen');
  S3.fern(); S3.lauf(5);
  ok(Kb.z === 'jagd', 'Jagd-Zustand dieses Testtyps hat keinen Ausgang; kein Rückfall in den alten Köder (' + Kb.z + ')');
});

// ======================================================================================================
section('Ramm-Schaden: verwundet, god schützt, Pause, Ladung wirkt über die Reichweite', () => {
  const ramm = (opts) => {
    const S = station(); const l = S.lang; S.g.god = !!(opts && opts.god);
    const K = S.kreatur('tb_ramm', l.cx0 + 2, l.cy);
    for (let i = 0; i < ((opts && opts.treffer) || 0); i++) hitVon(S, K);
    const q = { x: K.x + ((opts && opts.abstand) || 20), y: K.y };
    S.setz(q.x, q.y);
    S.log = []; let last = K.z;
    S.beob = (t) => { if (K.z !== last) { S.log.push({ von: last, z: K.z, t }); last = K.z; } return false; };
    S.lauf((opts && opts.sek) || 1.0, S.beob);
    return { S, K };
  };
  let r = ramm({ abstand: 20 });
  ok(r.S.p.downed === true, 'berührt: Spieler verwundet (downed)');
  ok(r.S.ev.filter((e) => e === 'wounded').length === 1 && r.S.ev.includes('kreaturTreffer'), 'Ereignisse wounded und kreaturTreffer');
  ok(r.S.me.includes('kreaturTreffer') && !r.S.me.includes('monsterTreffer'), 'Missionsereignis kreaturTreffer (nicht monsterTreffer)');
  ok(r.K.z === 'pause' && r.S.log[0] && r.S.log[0].von === 'rammen' && r.S.log[0].z === 'pause' && r.S.log[0].t < 0.2, 'Rammen endet sofort in der Pause (' + r.S.log.map((e) => e.von + '>' + e.z + '@' + e.t.toFixed(2)).join(' ') + ')');
  ok(r.S.g.away.stats.wounds === 1, 'eine Wunde gezählt');
  const w0 = r.S.g.away.stats.wounds;
  r.S.lauf(2.5, r.S.beob);
  ok(r.S.log.length === 2 && r.S.log[1].von === 'pause' && r.S.log[1].z === 'rammen' && r.K.z === 'rammen', 'nach der Pause (2 s) wieder Rammen, ohne alten Treffer-Merker (Wechsel: ' + r.S.log.map((e) => e.von + '>' + e.z).join(' ') + ')');
  r.S.lauf(1.5);
  ok(r.S.g.away.stats.wounds === w0 && r.S.p.downed, 'liegender Spieler wird nicht erneut verwundet');
  // god schützt
  r = ramm({ abstand: 20, god: true, sek: 1.0 });
  ok(!r.S.p.downed && !r.S.ev.includes('kreaturTreffer') && r.K.z === 'rammen', 'god: keine Wunde, kein Ereignis, Rammen läuft weiter');
  // außerhalb der Reichweite (30 px), nach drei Treffern (× 2,5 = 75 px) innerhalb
  r = ramm({ abstand: 50 });
  ok(!r.S.p.downed && r.K.z === 'rammen', 'Abstand 50 px bei Stufe 0 (Reichweite 30 px): kein Treffer');
  r = ramm({ abstand: 50, treffer: 3 });
  ok(r.S.p.downed && r.K.aufladung.stufe === 3, 'Abstand 50 px bei Stufe 3 (Reichweite 75 px): Treffer');
  ok(r.S.g.away.stats.wounds === 1, 'Wunde bleibt Wunde: auch bei Stufe 3 genau eine Wunde, kein Mehrschaden');
  r = ramm({ abstand: 90, treffer: 3 });
  ok(!r.S.p.downed, 'Abstand 90 px auch bei Stufe 3 (75 px): kein Treffer');
  // nur im Rammen
  const S = station(); const l = S.lang; S.g.god = false;
  const K = S.kreatur('tb_ramm', l.cx0 + 2, l.cy); Kreatur.zustandSetzen(S.g, K, 'pause');
  S.setz(K.x + 10, K.y); S.lauf(1.0);
  ok(!S.p.downed && K.z === 'pause', 'in der Pause (nicht im Rammen) keine Wunde');
});

// ======================================================================================================
section('Probe-Monster: alle vier Regeln über Daten', () => {
  const t = KREATUREN.typen.probe;
  ok(['zyklus', 'ruecken', 'aufladung', 'koeder', 'rammschaden'].every((b) => t.bausteine[b]), 'probe schaltet zyklus, ruecken, aufladung, koeder, rammschaden per Daten ein');
  ok(Kreatur.pruefen(KREATUREN).length === 0, 'Validator: alle Typen inklusive der Varianten ohne je einen Baustein fehlerfrei');
  for (const b of ['ruecken', 'aufladung', 'koeder', 'rammschaden']) ok(!KREATUREN.typen['probe_ohne_' + b].bausteine[b], 'Variante probe_ohne_' + b + ' hat den Baustein nicht');
  // Rücken (Kesh): von hinten × 2, ohne Baustein einfach
  const hinten = (typId) => { const S = szene(); S.platz(0); const K = S.kreatur(6, { typ: typId, facing: 0 }); Kreatur.zustandSetzen(S.g, K, 'pause'); S.schuss('blaster'); S.lauf(1.0); return K.seg; };
  ok(hinten('probe') === 2 && hinten('probe_ohne_ruecken') === 3, 'Rücken: probe von hinten Schild 4 -> 2, ohne Baustein 4 -> 3');
  // Aufladung
  const lade = (typId) => { const S = station(); S.fern(); const K = S.kreatur(typId, S.lang.cx0, S.lang.cy); hitVon(S, K); hitVon(S, K); return K; };
  const Ka = lade('probe'), Kb = lade('probe_ohne_aufladung');
  ok(Ka.aufladung.stufe === 2 && nahe(Ka.tempoF, 2, 1e-9) && Kb.aufladung === undefined && Kb.tempoF === undefined, 'Aufladung: probe Stufe 2 (Tempo × 2), ohne Baustein keine Ladung');
  // Köder
  const koed = (typId) => { const S = station(); S.fern(); const l = S.lang; const K = S.kreatur(typId, l.cx0 + 1, l.cy); K.z = 'patrouille'; K.pfad = []; S.laerm(K.x + 80, K.y, 'leise'); S.lauf(0.2); return K; };
  const Kc = koed('probe'), Kd = koed('probe_ohne_koeder');
  ok(Kc.koeder && Kc.z === 'laerm' && !Kd.koeder && Kd.z !== 'laerm', 'Köder: probe reagiert auf Lärm in Hörweite, ohne Baustein nicht');
  // Ramm-Schaden
  const stoss = (typId) => { const S = station(); S.g.god = false; const l = S.lang; const K = S.kreatur(typId, l.cx0 + 2, l.cy); Kreatur.zustandSetzen(S.g, K, 'rammen'); K.facing = 0; S.setz(K.x + 50, K.y); S.lauf(0.5); return { S, K }; };
  const Re = stoss('probe'), Rf = stoss('probe_ohne_rammschaden');
  ok(Re.S.p.downed && Re.K.z === 'pause' && !Rf.S.p.downed, 'Ramm-Schaden: probe verwundet den Spieler im Rammen und geht in die Pause, ohne Baustein nicht');
  ok(Re.S.fehlerFrei() && Rf.S.fehlerFrei(), 'keine Fehler aus Kreatur/Kampf');
});

section('Validator der neuen Bausteine', () => {
  const sonder = (b, par) => { const k = kopie(KREATUREN); k.typen.probe.bausteine[b] = par; return Kreatur.pruefen(k).filter((f) => f.includes('bausteine.' + b)); };
  ok(sonder('ruecken', { bogen: 0, faktor: 2 }).length === 1 && sonder('ruecken', { bogen: 90, faktor: 0 }).length === 1 && sonder('ruecken', { bogen: 90 }).length === 1, 'ruecken: bogen und faktor werden geprüft');
  ok(sonder('aufladung', Object.assign({}, AUF, { max: 0 })).length === 1 && sonder('aufladung', Object.assign({}, AUF, { zerfallSchritt: 0 })).length === 1 && sonder('aufladung', { max: 3 }).length >= 3, 'aufladung: max, Zerfall und Faktoren werden geprüft');
  ok(sonder('koeder', { faktor: 0, dauer: 4 }).length === 1 && sonder('koeder', { faktor: 1 }).length === 1, 'koeder: faktor und dauer werden geprüft');
  ok(sonder('rammschaden', { radius: 0 }).length === 1 && sonder('rammschaden', {}).length === 1, 'rammschaden: radius wird geprüft');
  const k = kopie(KREATUREN); delete k.typen.probe.bausteine.koeder;
  ok(Kreatur.pruefen(k).some((f) => /unbekannter (Modus|Auslöser)/.test(f)), 'Zustände mit Modus zumKoeder/Auslöser laerm ohne den Baustein werden abgelehnt');
});

section('Leere aw.kreaturen: nichts läuft, kein Zufall, kein Lesen', () => {
  const S = szene(); S.aw.kreaturen = undefined;
  const j0 = JSON.stringify(S.aw.laerm || []);
  let aufrufe = 0; const orig = S.aw.rng; S.aw.rng = (...a) => { aufrufe++; return orig(...a); };
  Kreatur.update(S.g, DT);
  ok(aufrufe === 0 && JSON.stringify(S.aw.laerm || []) === j0 && S.aw.kreaturen === undefined, 'ohne Kreaturen: sofort zurück, kein aw.rng, kein Eintrag');
  S.aw.kreaturen = [];
  Kreatur.update(S.g, DT);
  ok(aufrufe === 0, 'leere Liste: ebenfalls nichts');
});

if (fails) { console.log('\n' + fails + ' von ' + n + ' Prüfungen FEHLGESCHLAGEN'); process.exit(1); }
console.log('\n' + n + '/' + n + ' ok');
