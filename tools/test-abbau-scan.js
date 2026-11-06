#!/usr/bin/env node
'use strict';
// GEL-03 G: Scanner-Anmeldung der Erzadern (Art `erz`, Typ `erzader`, server/sim/anker.js) und Halter-Feld `ab` im Away-Snapshot (GEL-03 N2).
//   node tools/test-abbau-scan.js
// Scan (Debug-Wirkung scanfertig = derselbe Hook wie der echte Scan) erfasst Adern im Zustand da/laeuft in Reichweite ab Stufe 1 mit Position; leer/abgebaut nie;
// Abbau und abbauNeu ändern die Ziele (Aufräumen über update); Obergrenze maxEintraege; Datenblatt-Texte; Snapshot-Feld ab (Halter je laufender Ader) und seine Bytes.
const { Game } = require('../server/game.js');
const interior = require('../server/sim/interior.js');
const combat = require('../server/sim/combat.js');
const Anker = require('../server/sim/anker.js');
const Scanbar = require('../server/sim/scanbar.js');
const L = require('../server/sim/landepunkte.js');
const W = require('../server/world.js');
const GenHoehle = require('../shared/gen-hoehle.js');
const Physics = require('../shared/physics.js');
const fs = require('fs');
const path = require('path');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const kandidaten = (k) => k.anker.filter((a) => GenHoehle.istAderKandidat(a));

function szene(seed) {
  const g = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(o) { this.inbox.push(o); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'A0', name: 'Ader', color: 0 }); g.handleMessage(c, { t: 'ready', ready: true });
  for (let i = 0; i < 6; i++) g.step();
  const id = L.neu(g, g.ship.scene, { art: 'hoehle', seed });
  const aw = L.get(g, id);
  g.setAwayMap(id); aw.active = true;
  for (const [j, p] of g.players.entries()) { interior.placeOnAwayPad(g, p, j); combat.onArrive(g, p); }
  g.god = true;
  const S = { g, id, aw, k: W.AWAY_MAPS[id].karte, p: g.players[0] };
  S.z = (aid) => Anker.zustand(g, id, aid);
  S.da = () => kandidaten(S.k).map((a) => a.id).filter((aid) => S.z(aid) === 'da');
  S.scan = (stufe, x, y) => { if (x != null) { S.p.x = x; S.p.y = y; } return Scanbar.debugScanfertig(g, S.p, stufe); };
  S.erz = () => Object.values(S.g.away.sc || {}).filter((e) => e.art === 'erz');
  S.mitte = (aid) => { const a = S.k.anker.find((q) => q.id === aid); return Physics.tileCenter(a.x, a.y); };
  S.rundum = (stufe) => { for (const a of kandidaten(S.k)) { const m = S.mitte(a.id); S.scan(stufe, m.x, m.y); } };   // Scan an jeder Kandidatenkachel: deckt die ganze Höhle ab
  S.takt = () => { g.time += 1; Scanbar.update(g); };   // über die Aufräumschwelle (0,5 s)
  return S;
}
const R = new Game({ noStore: true, seed: 1, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} }).C.scanner.reichweite;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

section('1. Anmeldung und Erfassen ab Stufe 1');
const S = szene(5);
{
  const alle = kandidaten(S.k).map((a) => a.id);
  const da = S.da();
  ok(alle.length >= 4 && da.length >= 2 && da.length < alle.length, `Höhle mit ${alle.length} Kandidaten, ${da.length} aktiv (da), Rest leer`);
  let doppelt = false; try { Scanbar.scanbarAnmelden('erz', { ziele: () => [] }); } catch (e) { doppelt = true; }
  ok(doppelt, 'Art erz ist angemeldet (zweite Anmeldung wirft)');
  const ort = S.mitte(da[0]);
  S.p.x = ort.x; S.p.y = ort.y;
  const inR = da.filter((id) => dist(S.mitte(id), ort) <= R);
  ok(S.scan(0) === null && S.erz().length === 0, 'Stufe 0 (Rauschen): nichts erfasst');
  ok(S.scan(1) === null, 'Scan Stufe 1 läuft');
  const e = S.erz();
  ok(e.length === inR.length && inR.length >= 1 && inR.every((id) => e.some((x) => x.id === id)), `Stufe 1 erfasst genau die aktiven Adern in Reichweite (${e.length} von ${da.length} aktiv)`);
  ok(e.every((x) => x.typ === 'erzader' && x.sk === 1 && x.x != null && x.y != null), 'Eintrag trägt Typ erzader, Stufe 1 und schon die Position');
  ok(e.every((x) => { const m = S.mitte(x.id); return x.x === Math.round(m.x) && x.y === Math.round(m.y); }), 'Position = Kachelmitte der Ader in Pixel');
  S.rundum(1);
  ok(JSON.stringify(S.erz().map((x) => x.id).sort()) === JSON.stringify(da.slice().sort()), 'Scans über die ganze Höhle erfassen alle aktiven Adern (' + da.length + ') und keine andere');
  const leer = alle.filter((id) => S.z(id) === 'leer');
  ok(leer.length > 0 && leer.every((id) => !S.g.away.sc['erz:' + id]), 'leere Adern (Zustand leer) stehen nie im Scan');
  const sn = Scanbar.snapshot(S.g.away);
  ok(Array.isArray(sn.sc) && sn.sc.filter((r) => r[1] === 'erz').every((r) => r.length === 6 && r[2] === 'erzader'), 'Snapshot: [id, erz, erzader, sk, x, y]');
}

section('2. Abbau entfernt das Ziel');
{
  const e0 = S.erz(); const id = e0[0].id;
  S.g.away.zustaende[id] = 'abgebaut';
  S.takt();
  ok(!S.g.away.sc || !S.g.away.sc['erz:' + id], 'abgebaut: das Ziel fällt beim nächsten Aufräumen aus aw.sc');
  ok(S.erz().length === e0.length - 1, 'die übrigen Adern bleiben erfasst');
  S.scan(3);
  ok(!S.g.away.sc || !S.g.away.sc['erz:' + id], 'ein erneuter Scan erfasst die abgebaute Ader nicht wieder');
  S.rundum(1);
  const zweit = S.erz()[0];
  ok(!!zweit, 'noch eine aktive Ader vorhanden');
  S.g.away.zustaende[zweit.id] = 'laeuft'; S.takt(); S.rundum(1);
  ok(!!(S.g.away.sc && S.g.away.sc['erz:' + zweit.id]), 'laeuft: die Ader ist noch ein Ziel (bleibt nach dem Aufräumen, wird erfasst)');
  S.g.away.zustaende[zweit.id] = 'da';
}

section('3. Nachfüllen durch abbauNeu');
{
  const T = szene(5);
  T.rundum(3);
  const vor = T.erz().map((x) => x.id).sort();
  let neuErfasst = 0, alleLeerWeg = true;
  for (let r = 0; r < 3; r++) {
    ok(Anker.abbauNeu(T.g, T.id) === null, `abbauNeu Runde ${r + 1}`);
    T.takt();
    const aktiv = T.da();
    if (T.erz().some((x) => T.z(x.id) !== 'da')) alleLeerWeg = false;
    T.rundum(3);
    const nach = T.erz().map((x) => x.id).sort();
    const soll = aktiv.slice().sort();
    ok(JSON.stringify(nach) === JSON.stringify(soll), `Runde ${r + 1}: Scans zeigen genau die jetzt aktiven Adern (${nach.length})`);
    neuErfasst += nach.filter((id) => !vor.includes(id)).length;
  }
  ok(alleLeerWeg, 'nach abbauNeu und Aufräumen bleibt keine leere oder abgebaute Ader im Scan');
  console.log('       frische Adern über drei Runden im Scan: ' + neuErfasst + ' (neu = in Runde 0 nicht aktiv)');
}

section('4. Obergrenze maxEintraege');
{
  const T = szene(5);
  const ort = T.mitte(T.da()[0]);
  const cfg = T.g.C.scanner, alt = cfg.maxEintraege;
  try {
    cfg.maxEintraege = 1;
    T.scan(3, ort.x, ort.y);
    const naechste = T.da().sort((a, b) => dist(T.mitte(a), ort) - dist(T.mitte(b), ort))[0];
    ok(Object.keys(T.g.away.sc || {}).length === 1 && T.erz()[0].id === naechste, 'maxEintraege 1: genau ein Eintrag, die nächste Ader');
    cfg.maxEintraege = alt;
    T.scan(3, ort.x, ort.y);
    ok(Object.keys(T.g.away.sc).length <= alt, 'Standard-Obergrenze nicht gerissen (' + Object.keys(T.g.away.sc).length + ' <= ' + alt + ')');
  } finally { cfg.maxEintraege = alt; }
}

section('5. Datenblatt-Texte');
{
  const D = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'scanner', 'datenblaetter.json'), 'utf8').replace(/^﻿/, ''));
  const t = D.typen.erzader;
  ok(t && t.name.length <= 20 && t.zeile.length <= 34 && t.hinweis.length <= 100, `erzader: name ${t && t.name.length} <= 20, zeile ${t && t.zeile.length} <= 34, hinweis ${t && t.hinweis.length} <= 100`);
  ok(t.hinweisAb === 1 && t.symbol === 'ER' && D.arten.erz.positionAb === 1, 'erzader: Hinweis ab Stufe 1, Position ab Stufe 1 (passt zu tiefen.position 1)');
  ok(/E halten/.test(t.hinweis) && /ein Halter/i.test(t.hinweis) && /Treffer/.test(t.hinweis), 'Regelhinweis nennt E halten, einen Halter je Ader und den Treffer');
  ok(!/Schwarm|lockt|Monster/.test(t.hinweis), 'keine Versprechen zur Lärm-Wirkung (erst MON-03)');
}

section('6. Halter im Snapshot (away.ab)');
{
  const T = szene(7);
  const ids = T.da();
  const a = T.k.anker.find((q) => q.id === ids[0]);
  const c = Physics.tileCenter(a.x, a.y);
  const al = Anker.ankerListe(T.g, T.g.away, T.k);
  ok(!('ab' in Anker.awaySnap(T.g, T.g.away)), 'ohne Abbau: kein Feld ab');
  T.p.x = c.x; T.p.y = c.y + 20; T.p.zone = 'away';
  T.p.hold = { kind: 'anker:abbau', anker: a.id, dur: 5, t: 0 };
  Anker.abbauStarten(T.g, T.p, T.p.hold);
  ok(T.z(a.id) === 'laeuft', 'Halten startet: laeuft');
  const s = Anker.awaySnap(T.g, T.g.away);
  ok(Array.isArray(s.ab) && s.ab.length === 1 && s.ab[0][0] === al.findIndex((q) => q.id === a.id) && s.ab[0][1] === T.p.id, 'Snapshot ab = [[Ankerindex, Spieler-ID]] für die laufende Ader');
  console.log('       ab-Feld: ' + JSON.stringify({ ab: s.ab }).length + ' B im JSON (nur während des Abbaus; Spieler-ID ' + T.p.id + ')');
  Anker.abbauAbbrechen(T.g, T.id, a.id, T.p.id); T.p.hold = null;
  ok(!('ab' in Anker.awaySnap(T.g, T.g.away)), 'Loslassen: Feld ab verschwindet wieder');
}

console.log(`\n${n - fails}/${n} Prüfungen ok`);
process.exit(fails ? 1 : 0);
