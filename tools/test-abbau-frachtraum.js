'use strict';
// WRK-01 A2: GEL-03-Erz ist Fracht. Der Abbau (anker.js abbauFertig) lagert ueber Fracht.erzEinlagern ein (belegt Plaetze, Typ-Regel: ein Modul, eine Art), das alte Konto inventory.erz
// bekommt nichts mehr; vorab prueft anker.js abbauHindernis, ob die ganze Ausbeute passt (sonst bleibt die Ader da, nichts verbrennt, Meldung nur an die Spielerin, kein Endlos-Halten).
// Geprueft: Einlagern + Konto, Ereignis, voller Frachtraum und Typ-Regel (Angebot gesperrt, Halten bringt nichts), Grenze Platz = Menge, Platz geht waehrend des Haltens verloren,
// alle Adern nacheinander (nie mehr Erz als Platz, Summe = Ereignisse), zwei Spieler, Verkauf am Hafen, Weltstand (Version 3, Laden, Stand ohne Erz, Altstand mit lager.erz), Snapshot-Budget, Kampagne ohne Abbau.
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

section('2. Voller Frachtraum / Typ-Regel: Ader bleibt da, nichts verbrennt, kein Endlos-Halten', () => {
  const S = szene(); const g = S.g; const p = S.p;
  fuellen(g, 'bergungsgut', cap(g));   // alle Plaetze mit fremder Art: voll
  const l = S.angebot(p, 'abbau.1');
  ok(l.length === 1 && l[0].blocked && /Frachtraum voll/.test(l[0].blocked), 'Angebot gesperrt mit Text: "' + (l[0] && l[0].blocked) + '"');
  S.halten('abbau.1');
  ok(S.z('abbau.1') === 'da' && !p.hold && S.fertig().length === 0 && erz(g) === 0 && Fracht.anBord(g) === cap(g), 'Halten bringt nichts: Ader da, kein Hold, kein Abschluss, Lager unveraendert');
  Fracht.debug(g, ['leer']); fuellen(g, 'bergungsgut', 1);   // Platz da, aber das einzige Modul traegt eine andere Art
  const l2 = S.angebot(p, 'abbau.1');
  ok(l2.length === 1 && l2[0].blocked && /nur eine Art/.test(l2[0].blocked), 'Typ-Regel: Angebot gesperrt (' + (l2[0] && l2[0].blocked) + ')');
  S.halten('abbau.1');
  ok(S.z('abbau.1') === 'da' && erz(g) === 0 && Fracht.anBord(g, 'bergungsgut') === 1, 'Typ-Regel: Ader da, Lager unveraendert');
  Fracht.debug(g, ['leer']);
  const l3 = S.angebot(p, 'abbau.1');
  ok(l3.length === 1 && !l3[0].blocked, 'Lager leer: Angebot wieder da');
  S.halten('abbau.1');
  ok(S.z('abbau.1') === 'abgebaut' && erz(g) === S.menge('abbau.1'), 'danach klappt der Abbau');
});

section('3. Grenze: Platz gleich Menge geht, einer weniger nicht (alles oder nichts)', () => {
  for (const fid of IDS) {
    const S = szene(); const g = S.g; const m = S.menge(fid);
    fuellen(g, 'erz', cap(g) - m + 1);   // einer zu wenig
    const l = S.angebot(S.p, fid);
    ok(l.length === 1 && l[0].blocked && /Frachtraum voll/.test(l[0].blocked), fid + ' (Menge ' + m + '): ein Platz zu wenig, gesperrt (' + (l[0] && l[0].blocked) + ')');
    S.halten(fid);
    ok(S.z(fid) === 'da' && erz(g) === cap(g) - m + 1, fid + ': nichts eingelagert, Ader da');
    Fracht.debug(g, ['leer']); fuellen(g, 'erz', cap(g) - m);   // genau passend
    S.halten(fid);
    ok(S.z(fid) === 'abgebaut' && erz(g) === cap(g) && Fracht.frei(g) === 0, fid + ': Platz genau gleich Menge, Lager danach voll');
  }
});

section('4. Platz geht waehrend des Haltens verloren: Ader bleibt da, Meldung nur an die Spielerin', () => {
  const S = szene(); const g = S.g; const p = S.p;
  S.zu(p, 'abbau.1'); S.act(true); S.lauf(DAUER / 2);
  ok(S.z('abbau.1') === 'laeuft' && !!p.hold, 'Vorbedingung: Ader laeuft');
  fuellen(g, 'bergungsgut', cap(g));
  S.lauf(DAUER);
  ok(S.z('abbau.1') === 'da' && !p.hold && erz(g) === 0 && S.fertig().length === 0, 'Ende des Haltens: Ader wieder da, Hold weg (kein Endlos-Halten), nichts eingelagert, kein Abschluss');
  ok(S.notes.length === 1 && S.notes[0].pid === p.id && /Frachtraum|nur eine Art/.test(S.notes[0].text) && S.rundruf().length === 0, 'genau eine Meldung, nur an die Spielerin, kein Rundruf (' + (S.notes[0] && S.notes[0].text) + ')');
  ok(!g.away.ankerLauf.abbau['abbau.1'], 'Halter-Eintrag der Ader ist weg');
  S.act(false); S.lauf(0.5);
  ok(S.z('abbau.1') === 'da' && !p.hold, 'auch beim Loslassen bleibt alles ruhig');
  Fracht.debug(g, ['leer']); S.halten('abbau.1');
  ok(S.z('abbau.1') === 'abgebaut' && erz(g) === S.menge('abbau.1'), 'mit Platz klappt derselbe Abbau danach');
});

section('4b. Abschluss ohne Platz, Zustand sofort (nicht erst im naechsten Tick): laeuft -> da, Halter-Eintrag weg', () => {
  const S = szene(); const g = S.g; const p = S.p;
  S.zu(p, 'abbau.1'); p.hold = { kind: 'anker:abbau', anker: 'abbau.1', dur: DAUER, t: 0 };
  Anker.abbauStarten(g, p, p.hold);
  ok(S.z('abbau.1') === 'laeuft' && !!g.away.ankerLauf.abbau['abbau.1'], 'Vorbedingung: laeuft, Halter eingetragen');
  fuellen(g, 'bergungsgut', cap(g));
  p.hold.t = DAUER; Anker.abbauFertig(g, p, p.hold);
  ok(S.z('abbau.1') === 'da' && !g.away.ankerLauf.abbau['abbau.1'] && erz(g) === 0 && S.fertig().length === 0, 'sofort nach dem Abschluss: da, kein Halter-Eintrag, nichts eingelagert, kein Ereignis');
});

section('5. Alle Adern nacheinander: nie mehr Erz als Platz, nichts geht verloren', () => {
  const S = szene(); const g = S.g;
  let soll = 0, abgebaut = 0, gesperrt = 0;
  for (const fid of IDS) {
    const m = S.menge(fid); const passt = Fracht.freiFuer(g, 'erz') >= m;
    S.halten(fid);
    if (passt) { soll += m; abgebaut++; } else gesperrt++;
    ok((S.z(fid) === 'abgebaut') === passt && erz(g) === soll, fid + ' (Menge ' + m + '): ' + (passt ? 'abgebaut' : 'bleibt da') + ', Lager ' + erz(g) + ' von ' + cap(g));
  }
  const ev = S.fertig().reduce((s, e) => s + e[1].menge, 0);
  ok(erz(g) <= cap(g) && ev === erz(g) && S.fertig().length === abgebaut, 'Summe der Ereignisse (' + ev + ') = Erz im Lager (' + erz(g) + '), ' + abgebaut + ' abgebaut, ' + gesperrt + ' gesperrt');
});

section('6. Zwei Spieler: gleichzeitiger Vollzug an zwei Adern, der Platz reicht nur fuer eine', () => {
  const S = szene(2); const g = S.g; const [p0, p1] = g.players;
  const ids = IDS.filter((fid) => S.menge(fid) >= 2).slice(0, 2);
  if (ids.length < 2) { ok(true, 'uebersprungen: keine zwei Adern mit Menge >= 2 in dieser Karte (' + IDS.map((i) => S.menge(i)).join(',') + ')'); return; }
  const m = Math.max(S.menge(ids[0]), S.menge(ids[1]));
  fuellen(g, 'erz', cap(g) - m);   // es passt genau noch eine Ausbeute der groesseren Ader, nie beide
  S.zu(p0, ids[0]); S.zu(p1, ids[1]); S.act(true, 0); S.act(true, 1); S.lauf(DAUER + 1);
  const z = ids.map((i) => S.z(i)); const sum = ids.reduce((s, i, j) => s + (z[j] === 'abgebaut' ? S.menge(i) : 0), 0);
  ok(z.filter((x) => x === 'abgebaut').length >= 1 && erz(g) === cap(g) - m + sum && erz(g) <= cap(g), 'Lager = Vorrat + abgebaute Ausbeute, nie ueber dem Platz (' + z.join('/') + ', ' + erz(g) + ' von ' + cap(g) + ')');
  ok(z.every((x, j) => x === 'abgebaut' || x === 'da') && S.notes.every((x) => g.players.some((q) => q.id === x.pid)) && S.rundruf().length === 0, 'wer nicht passt, bleibt da; Meldungen nur an Spielerinnen, kein Rundruf');
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

console.log(`\n${n - fails}/${n} Pruefungen ok${fails ? ' - ' + fails + ' FEHLER' : ''}`);
process.exit(fails ? 1 : 0);
