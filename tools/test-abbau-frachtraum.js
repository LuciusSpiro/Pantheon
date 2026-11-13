'use strict';
// WRK-01 A2: GEL-03-Erz ist Fracht. Der Abbau (anker.js abbauFertig) lagert ueber Fracht.erzEinlagern ein (belegt Plaetze, Typ-Regel: ein Modul, eine Art), das alte Konto inventory.erz
// bekommt nichts mehr. Der Abbau gelingt IMMER: eingelagert wird, was passt (min(Menge, freiFuer erz)), der Rest bleibt liegen, die Spielerin bekommt eine Meldung nur an sich; im Angebot steht
// vor dem Halten ein nicht sperrender Hinweis (anker.js abbauPlatzHinweis).
// Geprueft: Einlagern + Konto, Ereignis, voller Frachtraum und Typ-Regel (Ader wird abgebaut, nichts eingelagert, Hinweis und Meldung), Grenze Platz = Menge und einer weniger, Platz geht waehrend des Haltens
// verloren, zweiter Halter/Boden, alle Adern nacheinander, zwei Spieler, Verkauf am Hafen, Weltstand, Snapshot-Budget, Kampagne ohne Abbau, die echte Szene abbauen/adern_in_der_hoehle mit dem Startschiff ohne Leeren (Abschnitt 10).
//   node tools/test-abbau-frachtraum.js   (npm run test:abbau-frachtraum)
const fs = require('fs');
const path = require('path');
const { Game } = require('../server/game.js');
const interior = require('../server/sim/interior.js');
const combat = require('../server/sim/combat.js');
const Anker = require('../server/sim/anker.js');
const Fracht = require('../server/sim/fracht.js');
const Vorrat = require('../server/sim/vorrat.js');
const Ladung = require('../server/sim/ladung.js');
const L = require('../server/sim/landepunkte.js');
const W = require('../server/world.js');
const Weltstand = require('../server/weltstand.js');
const Buehne = require('../shared/buehne.js');
const GenHoehle = require('../shared/gen-hoehle.js');
const Katalog = require('./katalog.js');
const Labor = require('../server/mission/labor.js');
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');
const F = require('./regie-fixture.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, f) => { console.log('\n' + t); try { f(); } catch (e) { fails++; n++; console.log('  ABSTURZ ' + (e && e.stack)); } };
const DT = 1 / CONFIG.tickHz;
const DAUER = CONFIG.anker.halten.abbau;
const IDS = ['abbau.1', 'abbau.2', 'abbau.3', 'abbau.4'];
const ENV = { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', REISE_EREIGNISSE: '1' };

// abbau-Anker in die Rohkarte setzen (wie tools/test-abbau.js): erreichbare Kacheln, weit auseinander, alle vier Nachbarn frei
function ankerEinsetzen(k) {
  if (k.anker.some((a) => a.rolle === 'abbau')) return;
  const r = Buehne.raster(k);
  const start = k.anker.find((a) => a.rolle === 'abholpunkt' && a.ankunft) || k.anker.find((a) => a.rolle === 'abholpunkt');
  const dist = new Map([[start.y * k.w + start.x, 0]]); const q = [[start.x, start.y]];
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, key = ny * k.w + nx;
      if (dist.has(key) || !r.durchgang(nx, ny)) continue;
      dist.set(key, dist.get(y * k.w + x) + 1); q.push([nx, ny]);
    }
  }
  const belegt = new Set(k.anker.map((a) => a.x + ',' + a.y));
  const frei = (x, y) => { const i = r.info(x, y); return i && i.kante === 'begehbar' && r.durchgang(x, y) && !belegt.has(x + ',' + y); };
  const kand = [...dist.keys()].map((key) => ({ x: key % k.w, y: Math.floor(key / k.w), d: dist.get(key) }))
    .filter((t) => t.d >= 6 && frei(t.x, t.y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => frei(t.x + dx, t.y + dy)))
    .sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  const gew = [];
  for (const t of kand) if (gew.length < IDS.length && gew.every((o) => Math.hypot(o.x - t.x, o.y - t.y) >= 6)) gew.push(t);
  if (gew.length < IDS.length) throw new Error('zu wenig freie Plaetze fuer abbau-Anker: ' + gew.length);
  IDS.forEach((id, i) => k.anker.push({ id, rolle: 'abbau', x: gew[i].x, y: gew[i].y, art: 'erz' }));
}
function szene(np) {
  const bauen0 = Buehne.bauen;
  Buehne.bauen = function () { const k = bauen0.apply(this, arguments); ankerEinsetzen(k); return k; };
  try {
    const g = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    const cs = Array.from({ length: np || 1 }, () => ({ inbox: [], send(o) { this.inbox.push(o); } }));
    for (const [i, c] of cs.entries()) { g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'A' + i, name: 'Erz' + i, color: i }); }
    for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
    for (let i = 0; i < 6; i++) g.step();
    const id = L.neu(g, g.ship.scene, { art: 'ruine' });
    const aw = L.get(g, id);
    g.setAwayMap(id); aw.active = true;
    for (const [j, p] of g.players.entries()) { interior.placeOnAwayPad(g, p, j); combat.onArrive(g, p); }
    g.god = true;
    const S = { g, cs, id, k: W.AWAY_MAPS[id].karte, p: g.players[0], notes: [], odas: 0, odaText: [], ev: [] };
    const n0 = g.notice.bind(g); g.notice = (p, t) => { S.notes.push({ pid: p.id, text: t }); return n0(p, t); };
    const o0 = g.oda.bind(g); g.oda = (t, k) => { S.odas++; S.odaText.push(String(t) + ' @' + String(new Error().stack).split('\n')[2].trim().slice(0, 90)); return o0(t, k); };
    const e0 = g.emit.bind(g); g.emit = function (t, d) { S.ev.push([t, d]); return e0(t, d); };
    S.rundruf = () => S.odaText.filter((x) => /Fracht|Erz|Ader|Platz|Art Ladung/.test(x));   // Hintergrund-ODA (Begruessung, Andock-Rempler) zaehlt nicht
    S.an = (fid) => S.k.anker.find((a) => a.id === fid);
    S.z = (fid) => Anker.zustand(g, id, fid);
    S.menge = (fid) => Anker.abbauMenge(g, id, S.an(fid)).menge;
    S.zu = (p, fid) => { const a = S.an(fid); const c = Physics.tileCenter(a.x + 1, a.y); p.x = c.x; p.y = c.y; p.input.mx = 0; p.input.my = 0; };
    S.lauf = (sek, vor) => { for (let i = 0; i < Math.round(sek / DT); i++) { g.away.drones.length = 0; if (vor) vor(); g.step(); } };
    S.act = (down, i) => g.handleMessage(cs[i || 0], { t: 'act', down });
    S.angebot = (p, fid) => { const a = S.an(fid); const l = []; Anker.interactionsAt(g, p, a.x, a.y, l); return l; };
    S.fertig = () => S.ev.filter((e) => e[0] === 'abbauFertig');
    // echtes Halten ueber die Eingabe: hinstellen, E halten, die Haltezeit abwarten, loslassen
    S.halten = (fid, i) => { const p = g.players[i || 0]; S.zu(p, fid); S.act(true, i); S.lauf(DAUER + 1); S.act(false, i); S.lauf(0.2); };
    return S;
  } finally { Buehne.bauen = bauen0; }
}
const erz = (g) => Fracht.anBord(g, 'erz');
const fuellen = (g, art, k) => { for (let i = 0; i < k; i++) { const r = Fracht.lagerAufnehmen(g, { art, quelle: 'debug' }); if (!r.ok) throw new Error('Lager fuellen: ' + r.text); } };
const cap = (g) => Fracht.capacity(g);
const neuesGame = () => new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });

section('1. Abbau legt das Erz als Fracht ins Lager (Plaetze, Konto, Ereignis)', () => {
  const S = szene(); const g = S.g;
  ok(cap(g) >= 4 && Fracht.frei(g) === cap(g), 'Ausgangslage: leeres Lager, Platz ' + cap(g));
  const m = S.menge('abbau.1');
  S.halten('abbau.1');
  ok(S.z('abbau.1') === 'abgebaut' && erz(g) === m && Fracht.frei(g) === cap(g) - m, 'Ader abgebaut, genau ' + m + ' Stapel Erz im Frachtraum, ' + m + ' Plaetze belegt');
  ok(!('erz' in g.inventory) && Vorrat.stand(g, 'erz') === 0, 'das alte Konto inventory.erz bleibt unberuehrt');
  ok(g.fracht.zugang && g.fracht.zugang.abbau === m, 'Zugang mit Quelle abbau gezaehlt (' + (g.fracht.zugang && g.fracht.zugang.abbau) + ')');
  const f = S.fertig();
  ok(f.length === 1 && f[0][1].menge === m && f[0][1].art === 'erz', 'Ereignis abbauFertig traegt Menge und Art');
  const sn = g.snapshot();
  ok(sn.fracht && sn.fracht.mb && sn.fracht.mb.some((x) => Array.isArray(x) && x[0] === 'erz' && x[1] === m) && !(sn.inventory && 'erz' in sn.inventory), 'Snapshot: fracht.mb zeigt erz x' + m + ', kein inventory.erz');
  ok(S.notes.length === 0 && S.rundruf().length === 0, 'keine Meldung, wenn alles passt (' + S.notes.map((x) => x.text).concat(S.rundruf()).join(' | ') + ')');
});

section('2. Voller Frachtraum / Typ-Regel: der Abbau gelingt trotzdem, nichts wird eingelagert, Hinweis und Meldung nur an die Spielerin', () => {
  const S = szene(); const g = S.g; const p = S.p;
  const m1 = S.menge('abbau.1');
  fuellen(g, 'bergungsgut', cap(g));   // alle Plaetze mit fremder Art: voll
  const l = S.angebot(p, 'abbau.1');
  ok(l.length === 1 && !l[0].blocked && l[0].op === 'abbauen' && new RegExp('nur Platz für 0 von ' + m1).test(l[0].hinweis), 'Angebot nicht gesperrt, mit Hinweis: "' + (l[0] && l[0].hinweis) + '"');
  S.halten('abbau.1');
  ok(S.z('abbau.1') === 'abgebaut' && !p.hold && S.fertig().length === 1 && erz(g) === 0 && Fracht.anBord(g) === cap(g), 'Halten gelingt: Ader abgebaut, Ereignis, kein Hold, Lager unveraendert');
  ok(S.notes.length === 2 && S.notes.every((x) => x.pid === p.id) && /nur Platz für 0/.test(S.notes[0].text) && /bleibt liegen/.test(S.notes[1].text) && S.rundruf().length === 0, 'zwei Meldungen (Hinweis vor dem Halten, Ergebnis danach), nur an die Spielerin, kein Rundruf (' + S.notes.map((x) => x.text).join(' | ') + ')');
  Fracht.debug(g, ['leer']); fuellen(g, 'bergungsgut', 1);   // Platz da, aber das einzige Modul traegt eine andere Art (Typ-Regel)
  S.notes.length = 0;
  const l2 = S.angebot(p, 'abbau.2');
  ok(l2.length === 1 && !l2[0].blocked && /nur Platz für 0 von/.test(l2[0].hinweis), 'Typ-Regel: Angebot nicht gesperrt, Hinweis (' + (l2[0] && l2[0].hinweis) + ')');
  S.halten('abbau.2');
  ok(S.z('abbau.2') === 'abgebaut' && erz(g) === 0 && Fracht.anBord(g, 'bergungsgut') === 1 && S.notes.length === 2 && S.notes.every((x) => x.pid === p.id), 'Typ-Regel: Ader abgebaut, Lager unveraendert, Meldungen nur an die Spielerin');
  Fracht.debug(g, ['leer']); S.notes.length = 0;
  const l3 = S.angebot(p, 'abbau.3');
  ok(l3.length === 1 && !l3[0].blocked && !('hinweis' in l3[0]), 'Lager leer: Angebot ohne Hinweis');
  S.halten('abbau.3');
  ok(S.z('abbau.3') === 'abgebaut' && erz(g) === S.menge('abbau.3') && S.notes.length === 0, 'danach klappt der Abbau still');
});

section('3. Grenze: Platz gleich Menge ohne Hinweis, einer weniger nimmt einen Teil mit, der Rest bleibt liegen', () => {
  for (const fid of IDS) {
    const S = szene(); const g = S.g; const m = S.menge(fid);
    fuellen(g, 'erz', cap(g) - m);   // genau passend
    ok(!('hinweis' in S.angebot(S.p, fid)[0]), fid + ' (Menge ' + m + '): Platz gleich Menge, kein Hinweis');
    S.halten(fid);
    ok(S.z(fid) === 'abgebaut' && erz(g) === cap(g) && Fracht.frei(g) === 0 && S.notes.length === 0, fid + ': alles mitgenommen, Lager voll, keine Meldung');
    const T = szene(); const t = T.g; fuellen(t, 'erz', cap(t) - m + 1);   // einer zu wenig
    const l = T.angebot(T.p, fid);
    ok(l.length === 1 && !l[0].blocked && new RegExp('nur Platz für ' + (m - 1) + ' von ' + m).test(l[0].hinweis), fid + ': ein Platz zu wenig, Hinweis ohne Sperre (' + (l[0] && l[0].hinweis) + ')');
    T.halten(fid);
    ok(T.z(fid) === 'abgebaut' && erz(t) === cap(t) && T.fertig().length === 1 && T.fertig()[0][1].menge === m, fid + ': Ader abgebaut, Lager voll (nur ' + (m - 1) + ' von ' + m + ' mitgenommen), Ereignis traegt die Ausbeute');
    const fin = T.notes[T.notes.length - 1];
    ok(T.notes.length === 2 && T.notes.every((x) => x.pid === T.p.id) && (m - 1 > 0 ? new RegExp(String(m - 1) + ' von ' + m + ' Stapeln Erz mitgenommen').test(fin.text) : /bleibt liegen/.test(fin.text)) && T.rundruf().length === 0, fid + ': Meldung nennt die mitgenommene Menge, nur an die Spielerin (' + (fin && fin.text) + ')');
  }
});

section('4. Platz geht waehrend des Haltens verloren: das Halten laeuft weiter, am Ende gilt, was passt', () => {
  const S = szene(); const g = S.g; const p = S.p; const m = S.menge('abbau.1');
  S.zu(p, 'abbau.1'); S.act(true); S.lauf(DAUER / 2);
  ok(S.z('abbau.1') === 'laeuft' && !!p.hold && S.notes.length === 0, 'Vorbedingung: Ader laeuft, noch keine Meldung');
  fuellen(g, 'bergungsgut', cap(g));
  S.lauf(0.3);
  ok(S.z('abbau.1') === 'laeuft' && !!p.hold, 'Platzverlust bricht das Halten nicht ab (kein Abbruch fuer den Platzfall)');
  S.lauf(DAUER);
  ok(S.z('abbau.1') === 'abgebaut' && !p.hold && erz(g) === 0 && S.fertig().length === 1 && S.fertig()[0][1].menge === m, 'Ende des Haltens: Ader abgebaut, Ereignis, Hold weg, nichts eingelagert');
  ok(S.notes.length === 1 && S.notes[0].pid === p.id && /bleibt liegen/.test(S.notes[0].text) && S.rundruf().length === 0, 'genau eine Meldung, nur an die Spielerin, kein Rundruf (' + (S.notes[0] && S.notes[0].text) + ')');
  ok(!g.away.ankerLauf.abbau['abbau.1'], 'Halter-Eintrag der Ader ist weg');
  S.act(false); S.lauf(0.5);
  ok(S.z('abbau.1') === 'abgebaut' && !p.hold && S.notes.length === 1, 'auch beim Loslassen bleibt alles ruhig');
});

section('4b. Abschluss ohne Platz, Zustand sofort: abgebaut, Halter-Eintrag weg, Ereignis', () => {
  const S = szene(); const g = S.g; const p = S.p;
  S.zu(p, 'abbau.1'); p.hold = { kind: 'anker:abbau', anker: 'abbau.1', dur: DAUER, t: 0 };
  Anker.abbauStarten(g, p, p.hold);
  ok(S.z('abbau.1') === 'laeuft' && !!g.away.ankerLauf.abbau['abbau.1'], 'Vorbedingung: laeuft, Halter eingetragen');
  fuellen(g, 'bergungsgut', cap(g));
  p.hold.t = DAUER; Anker.abbauFertig(g, p, p.hold);
  ok(S.z('abbau.1') === 'abgebaut' && !g.away.ankerLauf.abbau['abbau.1'] && erz(g) === 0 && S.fertig().length === 1, 'sofort nach dem Abschluss: abgebaut, kein Halter-Eintrag, nichts eingelagert, Ereignis da');
});

section('4c. Zweiter Halter wird weiter abgewiesen (Spieler am Boden und Kartenwechsel: tools/test-abbau.js)', () => {
  const S = szene(2); const g = S.g; const [p0, p1] = g.players;
  S.zu(p0, 'abbau.1'); S.zu(p1, 'abbau.1'); S.act(true, 0); S.lauf(0.2);
  ok(S.z('abbau.1') === 'laeuft', 'p0 haelt');
  S.act(true, 1); S.lauf(0.2);
  ok(g.away.ankerLauf.abbau['abbau.1'].pid === p0.id && !p1.hold, 'zweiter Halter wird abgewiesen, p0 behaelt die Ader');
});

section('5. Alle Adern nacheinander: jede wird abgebaut, eingelagert wird nie mehr als Platz da ist', () => {
  const S = szene(); const g = S.g;
  let soll = 0, ereignisse = 0;
  for (const fid of IDS) {
    const m = S.menge(fid); const frei = Fracht.freiFuer(g, 'erz');
    S.halten(fid); soll += Math.min(m, frei); ereignisse += m;
    ok(S.z(fid) === 'abgebaut' && erz(g) === soll, fid + ' (Menge ' + m + ', frei ' + frei + '): abgebaut, Lager ' + erz(g) + ' von ' + cap(g));
  }
  const ev = S.fertig();
  ok(erz(g) <= cap(g) && ev.length === IDS.length && ev.reduce((s, e) => s + e[1].menge, 0) === ereignisse, 'Ereignisse: alle ' + IDS.length + ' Adern mit voller Ausbeute (' + ereignisse + '), im Lager ' + erz(g) + ' von ' + cap(g));
});

section('6. Zwei Spieler: gleichzeitiger Vollzug an zwei Adern, der Platz reicht nur fuer eine Ausbeute', () => {
  const S = szene(2); const g = S.g; const [p0, p1] = g.players;
  const ids = IDS.filter((fid) => S.menge(fid) >= 2).slice(0, 2);
  if (ids.length < 2) { ok(true, 'uebersprungen: keine zwei Adern mit Menge >= 2 in dieser Karte (' + IDS.map((i) => S.menge(i)).join(',') + ')'); return; }
  const m = Math.max(S.menge(ids[0]), S.menge(ids[1]));
  fuellen(g, 'erz', cap(g) - m);   // es passt genau noch eine Ausbeute der groesseren Ader, nie beide
  S.zu(p0, ids[0]); S.zu(p1, ids[1]); S.act(true, 0); S.act(true, 1); S.lauf(DAUER + 1);
  ok(ids.every((i) => S.z(i) === 'abgebaut') && erz(g) === cap(g) && S.fertig().length === 2, 'beide Adern abgebaut, Lager genau voll, nie ueber dem Platz (' + erz(g) + ' von ' + cap(g) + ')');
  ok(S.notes.length >= 1 && S.notes.every((x) => g.players.some((q) => q.id === x.pid)) && S.rundruf().length === 0, 'Meldungen nur an Spielerinnen, kein Rundruf (' + S.notes.length + ')');
});

section('7. Verkauf am Hafen: Erz aus dem Lager ist Ware', () => {
  const S = szene(); const m = S.menge('abbau.1'); S.halten('abbau.1');
  const T = F.neuesSpiel({ crew: 1, seed: 7, env: ENV }); const g = T.g; const p = g.players[0];
  fuellen(g, 'erz', m);
  const hafen = Ladung.hafenVon(g); const preis = Ladung.preisFuer(g, hafen, 'erz');
  ok(preis > 0, 'Preis Erz am Starthafen: ' + preis + ' Marken je Stueck (Platzhalter aus waren.json/handel.json)');
  const m0 = g.inventory.marks; p.console = 'weapons';
  const v = Ladung.verkaufStart(g, p); for (let i = 0; i < Math.round((4 + m) / DT); i++) g.step();
  ok(g.inventory.marks - m0 === preis * m && erz(g) === 0, 'Verkauf: ' + m + ' x ' + preis + ' = ' + (g.inventory.marks - m0) + ' Marken, Lager leer (' + JSON.stringify(v) + ')');
});

section('8. Weltstand und Snapshot', () => {
  const S = szene(); const g = S.g; const m = S.menge('abbau.1'); S.halten('abbau.1');
  const cap1 = JSON.parse(JSON.stringify(Weltstand.capture(g)));
  ok(Weltstand.VERSION === 3 && cap1.version === 3 && Weltstand.validate(cap1).length === 0, 'Weltstand Version 3, schemagueltig');
  ok(cap1.schiff.fracht.filter((x) => x === 'erz').length === m && !('erz' in cap1.schiff.lager), 'Stand: schiff.fracht traegt ' + m + ' Erz, schiff.lager hat kein erz');
  const g2 = neuesGame();
  Weltstand.apply(g2, cap1);
  ok(erz(g2) === m && !('erz' in g2.inventory), 'nach dem Laden: ' + m + ' Erz im Frachtraum, kein Konto');
  const leer = JSON.parse(JSON.stringify(cap1)); delete leer.schiff.fracht; delete leer.schiff.frachtEig;
  const g3 = neuesGame();
  let fehler = null; try { Weltstand.apply(g3, leer); } catch (e) { fehler = e; }
  ok(!fehler && erz(g3) === 0 && Weltstand.validate(leer).length === 0, 'Stand ohne Erz im Lager (kein schiff.fracht): laedt ohne Bruch, Lager leer' + (fehler ? ' - ' + fehler.message : ''));
  const alt = JSON.parse(JSON.stringify(leer)); alt.schiff.lager.erz = 3;   // Vor-Alpha: kein Umzug alter Staende, aber kein Bruch
  const g4 = neuesGame();
  fehler = null; try { Weltstand.apply(g4, alt); } catch (e) { fehler = e; }
  ok(!fehler && erz(g4) === 0 && Weltstand.validate(alt).length === 0, 'Altstand mit lager.erz 3: laedt ohne Bruch (das Konto zaehlt nirgends mehr, kein Umzug)' + (fehler ? ' - ' + fehler.message : ''));
  const sn = JSON.stringify(g.snapshot()).length;
  ok(sn <= 18944, 'Snapshot mit Erz im Lager: ' + sn + ' B <= 18944');
});

section('9. Kampagne und andere Karten: Erz nur aus dem Abbau', () => {
  const root = path.join(__dirname, '..');
  const lies = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const treffer = [];
  (function lauf(d) { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) { const r = d + '/' + e.name; if (e.isDirectory()) lauf(r); else if (/"abbau"|abbauFertig/.test(lies(r))) treffer.push(r); } })('content/kampagne');
  ok(treffer.length === 0, 'content/kampagne (Eisenwald) kennt weder Rolle abbau noch abbauFertig (' + treffer.join(', ') + ')');
  const a = lies('server/sim/anker.js');
  ok((a.match(/erzEinlagern/g) || []).length === 1 && a.indexOf('fracht().erzEinlagern') > a.indexOf('function abbauFertig'), 'anker.js: erzEinlagern wird nur im Abbau-Pfad aufgerufen');
  const T = F.neuesSpiel({ crew: 1, seed: 7, env: {} });
  ok(erz(T.g) === 0 && !('erz' in T.g.inventory), 'frisches Spiel ohne Abbau: kein Erz im Lager, kein Konto');
});

// ---------- die echte Szene abbauen/adern_in_der_hoehle, Startschiff, OHNE das Lager zu leeren ----------
section('10. Szene "abbauen" mit dem Startschiff: beide Adern werden abgebaut, die Szene wird erfuellt (WRK-01 A2 Nacharbeit)', () => {
  const katalog = Katalog.load({}); const HZ = CONFIG.tickHz;
  const lauf = (seed, vorbereiten) => {
    const g = new Game({ noStore: true, seed: 7, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
    const c = { inbox: [], send() {} }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'L0', name: 'L0', color: 0 });
    g.reset(); g.phase = 'play';
    const ticks = (s) => { for (let i = 0, N = Math.round(s * HZ); i < N; i++) { if (g.away) g.away.drones.length = 0; g.step(); } };
    const lp = L.neu(g, 'kesh', { art: 'hoehle', seed }); L.get(g, lp);
    const st = Labor.laborKette(g, ['abbauen/adern_in_der_hoehle'], { map: lp, loc: 'kesh', god: true, katalog }); ticks(2);
    const b = g.landepunkte.dyn[lp].beam; g.ship.x = b.x; g.ship.y = b.y; g.ship.vx = 0; g.ship.vy = 0;
    const p = g.players[0]; interior.placeOnShipPad(g, p, 0); p.console = 'transfer';
    g.handleMessage(c, { t: 'cmd', c: 'transfer.ziel', landepunkt: lp }); ticks(1); g.handleMessage(c, { t: 'cmd', c: 'transfer.down' }); ticks(7);
    const k = W.AWAY_MAPS[lp].karte;
    const da = k.anker.filter((a) => GenHoehle.istAderKandidat(a) && Anker.zustand(g, lp, a.id) === 'da');
    const R = { g, p, lp, k, da, st, notes: [], odas: [], ev: [] };
    const n0 = g.notice.bind(g); g.notice = (q, t) => { R.notes.push({ pid: q.id, text: t }); return n0(q, t); };
    const o0 = g.oda.bind(g); g.oda = (t, kk) => { R.odas.push(String(t)); return o0(t, kk); };
    const e0 = g.emit.bind(g); g.emit = function (t, d) { R.ev.push([t, d]); return e0(t, d); };
    if (vorbereiten) vorbereiten(g);
    const flag = () => { const m = g.mission; return !!((m.flags && m.flags.labs1_abgebaut) || (m.state && m.state.flags && m.state.flags.labs1_abgebaut)); };
    R.flagVorher = flag();
    const modell = { erz: 0, meldungen: 0 };
    for (const a of da.slice(0, 2)) {   // die Szene verlangt zwei Adern (Standard anzahl 2); echtes Halten ueber die Eingabe
      const m = Anker.abbauMenge(g, lp, a).menge; const frei = Fracht.freiFuer(g, 'erz');
      const nb = Physics.tileCenter(a.x + 1, a.y);
      p.x = nb.x; p.y = nb.y; p.input.mx = 0; p.input.my = 0;
      g.handleMessage(c, { t: 'act', down: true }); ticks(CONFIG.anker.halten.abbau + 1); g.handleMessage(c, { t: 'act', down: false }); ticks(0.3);
      modell.erz += Math.min(m, frei); if (frei < m) modell.meldungen += 2;
    }
    ticks(3);
    R.flag = flag(); R.modell = modell;
    return R;
  };
  const rund = (R) => R.odas.filter((x) => /Frachtraum|Platz für|mitgenommen|bleibt liegen/.test(x));   // die Szene selbst sagt per ODA "Genug Erz im Lager" (Mission, kein Frachtruf)
  // a) der gemessene Fall: Mengen 3 und 3 (Seed 24), leeres Startschiff mit 4 Plaetzen
  const A = lauf(24);
  const mA = A.da.slice(0, 2).map((a) => Anker.abbauMenge(A.g, A.lp, a).menge);
  ok(Fracht.capacity(A.g) === 4 && mA.length === 2 && mA[0] === 3 && mA[1] === 3, 'Ausgangslage Seed 24: Startschiff ' + Fracht.capacity(A.g) + ' Plaetze, die zwei Adern der Szene geben ' + mA.join(' und '));
  ok(!A.flagVorher && A.flag, 'Szene erfuellt: Flag labs1_abgebaut erst nach den zwei Adern (vorher ' + A.flagVorher + ', nachher ' + A.flag + ')');
  ok(A.da.slice(0, 2).every((a) => Anker.zustand(A.g, A.lp, a.id) === 'abgebaut') && A.g.errors === 0, 'beide Adern abgebaut, g.errors 0');
  ok(Fracht.anBord(A.g, 'erz') === 4 && Fracht.frei(A.g) === 0, 'Lager nach Typ-Regel: 3 + 1 = 4 Erz (nur was passt), voll');
  ok(A.notes.length === 2 && A.notes.every((x) => x.pid === A.p.id) && /nur Platz für 1 von 3/.test(A.notes[0].text) && /1 von 3 Stapeln Erz mitgenommen/.test(A.notes[1].text) && rund(A).length === 0, 'Meldungen nur an die Spielerin: Hinweis und Ergebnis der zweiten Ader, kein Rundruf (' + A.notes.map((x) => x.text).join(' | ') + ')');
  // b) fremde Ware im einzigen Modul: kein Erz passt, die Szene wird trotzdem erfuellt
  const B = lauf(24, (g) => fuellen(g, 'bergungsgut', 1));
  ok(Fracht.anBord(B.g, 'bergungsgut') === 1 && B.modell.erz === 0, 'Ausgangslage: Bergungsgut im einzigen Modul, fuer Erz ist nichts frei');
  ok(B.flag && B.da.slice(0, 2).every((a) => Anker.zustand(B.g, B.lp, a.id) === 'abgebaut'), 'Szene trotzdem erfuellt: beide Adern abgebaut, Flag gesetzt');
  ok(Fracht.anBord(B.g, 'erz') === 0 && Fracht.anBord(B.g, 'bergungsgut') === 1, 'Lager unveraendert (Typ-Regel: ein Modul, eine Art)');
  ok(B.notes.length === 4 && B.notes.every((x) => x.pid === B.p.id) && rund(B).length === 0, 'vier Meldungen (je Ader Hinweis und Ergebnis), nur an die Spielerin (' + B.notes.length + ')');
  // c) mehrere Karten, leeres Startschiff: nie haengen, Lager = Modell
  const bad = [];
  for (const seed of [21, 22, 23, 25, 26, 27, 28, 29]) {
    const C = lauf(seed);
    const ok1 = C.da.length >= 2 && C.flag && C.da.slice(0, 2).every((a) => Anker.zustand(C.g, C.lp, a.id) === 'abgebaut') && Fracht.anBord(C.g, 'erz') === C.modell.erz && C.notes.length === C.modell.meldungen && C.notes.every((x) => x.pid === C.p.id) && rund(C).length === 0;
    if (!ok1) bad.push(seed + ':' + C.da.length + '/' + C.flag + '/' + Fracht.anBord(C.g, 'erz') + '!=' + C.modell.erz);
  }
  ok(!bad.length, 'Seeds 21-29 (ohne 24): Szene erfuellt, Lager gleich Modell, Meldungen nur an die Spielerin (' + (bad.join(' ') || 'alle ok') + ')');
});

console.log(`\n${n - fails}/${n} Pruefungen ok${fails ? ' - ' + fails + ' FEHLER' : ''}`);
process.exit(fails ? 1 : 0);
