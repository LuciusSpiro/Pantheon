'use strict';
// GEL-03 B + C: Material (erz), Menge je Ader, Ader-Kandidaten der Höhle, Auswahl je Runde (adernWahl) und Neusetzen je Mission (abbauNeu, abbau_runde im Weltstand).
// Echtes Game, echte Höhle (art hoehle) über den Landepunkt-Weg; kein Client. Abschnitte:
//   1 adernWahl (rein, deterministisch, 2 bis 3 aktiv)   2 Menge 1..3 (FNV aus Runde + ID)   3 Generator (>= 50 Seeds je Größe, Prüfer, Erreichbarkeit, Payload, Abstand)
//   4 Runde 0 ohne abbauNeu   5 Mission 1 baut ab, Buchung (Vorrat + Telemetrie), abbauNeu, Mission 2 sieht frische Adern, Karte byteweise gleich
//   6 laufender Halter wird sauber abgebrochen   7 nicht geladene Karte   8 Speichern/Laden (Zustände, Runde, Lager) und Altstand ohne Feld
//   node tools/test-abbau-neu.js   (npm run test:abbau-neu)
const { Game } = require('../server/game.js');
const interior = require('../server/sim/interior.js');
const combat = require('../server/sim/combat.js');
const Anker = require('../server/sim/anker.js');
const Vorrat = require('../server/sim/vorrat.js');
const L = require('../server/sim/landepunkte.js');
const W = require('../server/world.js');
const Weltstand = require('../server/weltstand.js');
const Buehne = require('../shared/buehne.js');
const GenHoehle = require('../shared/gen-hoehle.js');
const GenGelaende = require('../shared/gen-gelaende.js');
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const MAXB = (Protocol.PROTOCOL || Protocol).AWAY_MAP_MAX_BYTES;

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const DT = 1 / CONFIG.tickHz;
// 50 Seeds je Gruppe (Prüfer ca. 0,2 s je Karte: Abschnitt 3 braucht ca. 40 s). ABBAU_NEU_SCHNELL=1 (nur die Mutationsprobe für Nicht-Generator-Regeln) nimmt 3.
const SEEDS = process.env.ABBAU_NEU_SCHNELL ? 3 : 50;

const kandidaten = (k) => k.anker.filter((a) => GenHoehle.istAderKandidat(a));
const nahe = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function szene(art, opts) {
  opts = opts || {};
  const g = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(o) { this.inbox.push(o); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'A0', name: 'Ader', color: 0 }); g.handleMessage(c, { t: 'ready', ready: true });
  for (let i = 0; i < 6; i++) g.step();
  const id = L.neu(g, g.ship.scene, { art, seed: opts.seed, gen: opts.gen });
  const S = { g, id, buchungen: [], ev: [], me: [] };
  const basis = { offen: true, sitzung: 1, ereignis: (t, d) => { if (t === 'buchung') S.buchungen.push(d); }, beiAbschluss() {} };   // Test-Senke: nur Buchungen merken, alle anderen Haken sind No-ops
  g.telemetrie = new Proxy(basis, { get: (o, k) => (k in o ? o[k] : () => {}) });
  const e0 = g.emit.bind(g); g.emit = function (t, d) { S.ev.push([t, d]); return e0(t, d); };
  const m0 = g.missionEvent.bind(g); g.missionEvent = (nm, a) => { S.me.push([nm, a]); return m0(nm, a); };
  S.betreten = () => {
    const aw = L.get(g, id);
    g.setAwayMap(id); aw.active = true;
    for (const [j, p] of g.players.entries()) { interior.placeOnAwayPad(g, p, j); combat.onArrive(g, p); }
    g.god = true; S.aw = aw; S.k = W.AWAY_MAPS[id].karte; S.p = g.players[0];
    return aw;
  };
  S.z = (aid) => Anker.zustand(g, id, aid);
  S.aktiv = () => kandidaten(S.k).map((a) => a.id).filter((aid) => S.z(aid) === 'da');
  S.evn = (name) => S.ev.filter((e) => e[0] === name);
  S.menN = (name) => S.me.filter((m) => m[0] === name);
  return S;
}
// einen echten Abbau-Abschluss (Halten vollendet) an einer Ader auslösen
function abbauen(S, aid) {
  const a = S.k.anker.find((q) => q.id === aid);
  const c = Physics.tileCenter(a.x, a.y);
  S.p.x = c.x; S.p.y = c.y; S.p.hold = { kind: 'anker:abbau', anker: aid, dur: 5, t: 5 };
  Anker.abbauFertig(S.g, S.p, S.p.hold);
  S.p.hold = null;
}

section('1. adernWahl: rein, deterministisch, 2 bis 3 aktiv');
{
  const ids4 = ['a.1', 'a.2', 'a.3', 'a.4'], ids5 = ['a.1', 'a.2', 'a.3', 'a.4', 'a.5'], ids6 = ids5.concat(['a.6']);
  const w = GenHoehle.adernWahl(7, ids5, 0);
  ok(JSON.stringify(w) === JSON.stringify(GenHoehle.adernWahl(7, ids5.slice().reverse(), 0)), 'unabhängig von der Reihenfolge der Eingabe, gleiche Eingabe gleiche Auswahl');
  ok(w.da.length + w.leer.length === 5 && w.da.every((x) => ids5.includes(x)) && w.leer.every((x) => ids5.includes(x) && !w.da.includes(x)), 'da und leer teilen die Kandidaten ohne Rest');
  let min4 = 9, max4 = 0, min5 = 9, max5 = 0, min6 = 9, max6 = 0, gleich = 0, folgen = 0, ohneVorrunde = 0;
  for (let s = 1; s <= 200; s++) for (let r = 0; r < 8; r++) {
    const a4 = GenHoehle.adernWahl(s, ids4, r).da.length, a5 = GenHoehle.adernWahl(s, ids5, r).da.length, a6 = GenHoehle.adernWahl(s, ids6, r).da.length;
    min4 = Math.min(min4, a4); max4 = Math.max(max4, a4); min5 = Math.min(min5, a5); max5 = Math.max(max5, a5); min6 = Math.min(min6, a6); max6 = Math.max(max6, a6);
    if (r > 0) { folgen++; const v = new Set(GenHoehle.adernWahl(s, ids6, r - 1).da); const j = GenHoehle.adernWahl(s, ids6, r).da; if (j.some((x) => !v.has(x))) ohneVorrunde++; if (j.length === v.size && j.every((x) => v.has(x))) gleich++; }
  }
  ok(min4 === 2 && max4 === 2, 'bei 4 Kandidaten immer genau 2 aktiv');
  ok(min5 === 2 && max5 === 3 && min6 === 2 && max6 === 3, 'bei 5 und 6 Kandidaten 2 bis 3 aktiv (beide Werte kommen vor)');
  ok(gleich === 0 && ohneVorrunde === folgen, `Runde n+1 ist nie dieselbe Teilmenge wie Runde n und bringt immer mindestens eine frische Ader (${folgen} Paare, bei 6 Kandidaten)`);
  ok(GenHoehle.adernWahl(1, ['x'], 3).da.length === 1 && GenHoehle.adernWahl(1, [], 3).da.length === 0, 'Randfälle: 1 Kandidat bleibt aktiv, 0 Kandidaten leer');
  const verschieden = new Set(); for (let s = 1; s <= 60; s++) verschieden.add(GenHoehle.adernWahl(s, ids5, 0).da.join());
  ok(verschieden.size > 4, 'Runde 0 hängt vom Seed ab (' + verschieden.size + ' verschiedene Auswahlen in 60 Seeds)');
}

section('2. Menge je Ader: 1 bis 3, deterministisch aus (Runde, ID)');
{
  const S = szene('hoehle', { seed: 5 }); S.betreten();
  const ids = kandidaten(S.k).map((a) => a.id);
  const e = L.eintrag(S.g, S.id);
  const m0 = ids.map((i) => Anker.abbauMenge(S.g, S.id, S.k.anker.find((a) => a.id === i)));
  ok(m0.every((m) => m.menge >= 1 && m.menge <= 3 && m.art === 'erz'), 'jede Ader: Menge 1 bis 3, Art erz (Standard)');
  ok(JSON.stringify(m0) === JSON.stringify(ids.map((i) => Anker.abbauMenge(S.g, S.id, S.k.anker.find((a) => a.id === i)))), 'wiederholt gefragt: dieselbe Menge (kein Zufall, kein Zustand)');
  const alle = new Set();
  for (let r = 0; r < 40; r++) { e.abbau_runde = r; for (const i of ids) { const m = Anker.abbauMenge(S.g, S.id, { id: i }); alle.add(m.menge); } }
  ok(alle.has(1) && alle.has(2) && alle.has(3) && alle.size === 3, 'über viele Runden kommen 1, 2 und 3 vor, nie etwas anderes');
  e.abbau_runde = 0;
  const unterschied = [...Array(30).keys()].filter((r) => { e.abbau_runde = r; const x = Anker.abbauMenge(S.g, S.id, { id: ids[0] }).menge; e.abbau_runde = r + 1; return x !== Anker.abbauMenge(S.g, S.id, { id: ids[0] }).menge; }).length;
  const ander = [...Array(30).keys()].filter((r) => { e.abbau_runde = r; return Anker.abbauMenge(S.g, S.id, { id: ids[0] }).menge !== Anker.abbauMenge(S.g, S.id, { id: ids[1] }).menge; }).length;
  e.abbau_runde = 0;
  ok(ander > 5, 'die Menge hängt von der Ader ab (' + ander + ' von 30 Runden: Ader 1 und 2 geben verschieden viel)');
  ok(unterschied > 5, 'die Menge einer Ader hängt von der Runde ab (' + unterschied + ' von 30 Rundenwechseln ändern sie)');
  ok(Anker.abbauMenge(S.g, S.id, { id: ids[0], art: 'kristall' }).art === 'erz', 'unbekannte Art wird zu erz');
}

section('3. Generator: Höhle (klein, mittel, gross) und Wildnis mit Höhle (klein, mittel), je ' + SEEDS + ' Seeds');
{
  const gruppen = [['Höhle klein', 'hoehle', { groesse: 'klein' }], ['Höhle mittel', 'hoehle', { groesse: 'mittel' }], ['Höhle gross', 'hoehle', { groesse: 'gross' }],
    ['Wildnis+Höhle klein', 'wildnis', { groesse: 'klein', hoehle: true }], ['Wildnis+Höhle mittel', 'wildnis', { groesse: 'mittel', hoehle: true }]];
  const payloadB = (k) => Buffer.byteLength(JSON.stringify(Game.prototype.awayMapPayload.call({}, k)));
  let gesamtMax = 0, gesamtName = '';
  const nachbarn = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [name, art, o] of gruppen) {
    let fehler = 0, falscheZahl = 0, naeheVerletzt = 0, unerreichbar = 0, minK = 99, maxK = 0, unter = 0, aufAnker = 0, fremdeRolle = 0, pflichtFehl = 0, payMax = 0, minAbst = 99;
    for (let s = 1; s <= SEEDS; s++) {
      const seed = s * 97 + 3;
      let roh;
      try { roh = (art === 'hoehle' ? GenHoehle.erzeuger() : GenGelaende.erzeuger()).karteRoh(seed, o); } catch (x) { fehler++; console.log('   Wurf ' + name + ' Seed ' + seed + ': ' + x.message); continue; }
      const r = Buehne.ausRaster(roh, { spiel: true });
      if (!r.pruefung.ok) { fehler++; console.log('   Prüfer ' + name + ' Seed ' + seed + ': ' + r.pruefung.fehler.slice(0, 2).map((f) => f.code + ' ' + f.msg).join('; ')); continue; }
      const kand = roh.anker.filter((a) => GenHoehle.istAderKandidat(a));
      const flaeche = art === 'hoehle' ? roh.w * roh.h : roh.w * (roh.h - roh.decks.stride);
      minK = Math.min(minK, kand.length); maxK = Math.max(maxK, kand.length);
      if (kand.length < GenHoehle.PFLICHT.abbau || kand.length > GenHoehle.ADERN_ZIEL(flaeche) || new Set(kand.map((a) => a.id)).size !== kand.length) falscheZahl++;
      for (let i = 0; i < kand.length; i++) for (let j = i + 1; j < kand.length; j++) { const d = nahe(kand[i], kand[j]); minAbst = Math.min(minAbst, d); if (d < 4) naeheVerletzt++; }
      for (const a of kand) {
        if (roh.anker.some((q) => q !== a && q.x === a.x && q.y === a.y) || roh.rows[a.y][a.x] === 'F') aufAnker++;
        // Eingang/Ausgang (Pad, Leiter) mindestens 6 Kacheln, Funde (Objekt) mindestens 3 (Chebyshev) entfernt
        if (roh.anker.some((q) => (q.rolle === 'abholpunkt' || q.rolle === 'leiter') && nahe(q, a) < 6)) aufAnker++;
        if (roh.anker.some((q) => q.rolle === 'fund' && Math.max(Math.abs(q.x - a.x), Math.abs(q.y - a.y)) < 3)) aufAnker++;
      }
      if (roh.anker.filter((a) => a.rolle === 'abbau').length !== kand.length) fremdeRolle++;
      if (art === 'hoehle' && roh.meta.pflicht.abbau !== GenHoehle.PFLICHT.abbau) pflichtFehl++;
      // Erreichbarkeit mit den Adern als Hindernis (Kollision): alles, was vorher erreichbar war, bleibt es; jede Ader hat einen erreichbaren Nachbarn
      const ras = Buehne.raster(r.karte), w = roh.w;
      const blockiert = new Set(kand.map((a) => a.y * w + a.x));
      const durch = (x, y) => ras.durchgang(x, y) && !blockiert.has(y * w + x);
      const seen = new Set(); const q = [];
      const starte = (x, y) => { if (!seen.has(y * w + x)) { seen.add(y * w + x); q.push([x, y]); } };
      for (const a of roh.anker) if (a.ankunft) starte(a.x, a.y);
      for (const l of (roh.decks && roh.decks.links) || []) { starte(l.a[0], l.a[1]); starte(l.b[0], l.b[1]); }
      for (let i = 0; i < q.length; i++) for (const [dx, dy] of nachbarn) { const x = q[i][0] + dx, y = q[i][1] + dy; if (x >= 0 && y >= 0 && x < w && y < roh.h && !seen.has(y * w + x) && durch(x, y)) starte(x, y); }
      for (const a of kand) if (!nachbarn.some(([dx, dy]) => seen.has((a.y + dy) * w + a.x + dx))) unerreichbar++;
      for (const a of roh.anker) if (['fund', 'wache', 'patrouille', 'deckung', 'abholpunkt', 'leiter'].includes(a.rolle) && !seen.has(a.y * w + a.x) && !(a.rolle === 'fund' && nachbarn.some(([dx, dy]) => seen.has((a.y + dy) * w + a.x + dx)))) unerreichbar++;
      // keine Engstelle: jede begehbare Kachel neben einer Ader liegt auch ohne die Adern in einem 2x2-Block begehbarer Kacheln
      for (const a of kand) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = a.x + dx, y = a.y + dy;
        if ((!dx && !dy) || !durch(x, y)) continue;
        let block = false;
        for (const [bx, by] of [[x - 1, y - 1], [x, y - 1], [x - 1, y], [x, y]]) if ([[0, 0], [1, 0], [0, 1], [1, 1]].every(([ox, oy]) => durch(bx + ox, by + oy))) { block = true; break; }
        if (!block) unter++;
      }
      const pb = payloadB(r.karte); payMax = Math.max(payMax, pb);
    }
    if (payMax > gesamtMax) { gesamtMax = payMax; gesamtName = name; }
    ok(fehler === 0, `${name}: ${SEEDS} Seeds ohne Wurf und ohne Prüferfehler`);
    ok(falscheZahl === 0 && fremdeRolle === 0 && minK >= GenHoehle.PFLICHT.abbau, `${name}: Kandidatenzahl ${minK}..${maxK} (mindestens ${GenHoehle.PFLICHT.abbau}, höchstens Ziel der Größe), eindeutige IDs`);
    ok(naeheVerletzt === 0 && aufAnker === 0, `${name}: Mindestabstand eingehalten (kleinster beobachtet ${minAbst} Kacheln, Untergrenze 4), keine Ader auf einem Anker oder im Fels, 6 Kacheln vom Eingang, 3 von einem Fund`);
    ok(unerreichbar === 0, `${name}: jede Ader über einen Nachbarn erreichbar; mit allen Adern als Hindernis bleibt alles erreichbar`);
    ok(unter === 0, `${name}: keine Engstelle unter 2 Kacheln neben einer Ader`);
    ok(art !== 'hoehle' || pflichtFehl === 0, `${name}: meta.pflicht.abbau = ${GenHoehle.PFLICHT.abbau}` + (art === 'hoehle' ? '' : ' (Deck: nicht geprüft, s. Bericht)'));
    ok(payMax > 0 && payMax <= MAXB, `${name}: awayMap-Payload höchstens ${MAXB} B (Maximum ${payMax} B)`);
  }
  console.log('   Payload-Maximum über alle Gruppen: ' + gesamtMax + ' B (' + gesamtName + ')');
  ok(GenHoehle.PFLICHT.abbau === 4 && GenHoehle.PFLICHT_DECK.abbau === 4 && GenHoehle.VERSION === 2, 'PFLICHT/PFLICHT_DECK abbau: 4, Höhle-VERSION 2');
  ok(GenHoehle.ADERN_ZIEL(2240) === 4 && GenHoehle.ADERN_ZIEL(4480) === 5 && GenHoehle.ADERN_ZIEL(7488) === 6, 'Ziel je Fläche: klein 4, mittel 5, gross 6');
  // Deck: Pflicht PFLICHT_DECK.abbau in der Wildnis-Karte erfüllt (die Wildnis-Pflicht selbst bleibt unverändert)
  ok(JSON.stringify(GenGelaende.PFLICHT) === JSON.stringify({ abholpunkt: 1, fund: 2, deckung: 4 }), 'Wildnis-Pflichtsatz unverändert (die Oberfläche trägt keine Ader)');
}

section('4. Runde 0: ohne abbauNeu aktiv 2 bis 3 Adern, der Rest leer (Karte unverändert)');
{
  const S = szene('hoehle', { seed: 5 }); const e = L.eintrag(S.g, S.id);
  const roh = L.karte(S.g, S.id);
  S.betreten();
  const kand = kandidaten(S.k);
  const w = GenHoehle.adernWahl(S.k.seed | 0, kand.map((a) => a.id), 0);
  ok(kand.length >= 4 && e.abbau_runde === 0, 'Höhle trägt ' + kand.length + ' Kandidaten, abbau_runde 0');
  ok(S.aktiv().length >= 2 && S.aktiv().length <= 3 && JSON.stringify(S.aktiv()) === JSON.stringify(w.da), 'Runde 0 wirkt beim Laden: ' + S.aktiv().length + ' aktive Adern = adernWahl(Seed, Kandidaten, 0)');
  ok(w.leer.every((id) => S.z(id) === 'leer'), 'alle anderen Kandidaten sind leer');
  ok(JSON.stringify(S.k.zustaende) === '{}' && JSON.stringify(W.AWAY_MAPS[S.id].karte.anker) === JSON.stringify(roh.anker), 'die Karte trägt keine Auswahl (karte.zustaende leer, Anker unverändert)');
  const solid = interior.awaySolid(S.g);
  const a0 = S.k.anker.find((a) => a.id === w.da[0]), l0 = S.k.anker.find((a) => a.id === w.leer[0]);
  ok(solid(a0.x, a0.y) && !solid(l0.x, l0.y), 'aktive Ader hat Kollision, leere nicht');
  ok(S.g.snapshot().away && JSON.stringify(S.g.snapshot().away.ao || []).length > 2, 'Snapshot ao meldet die leeren Adern (Abweichung vom Start da)');
}

section('5. Mission 1 baut alles ab, abbauNeu, Mission 2 am selben Landepunkt: frische Adern, Karte gleich');
{
  const S = szene('hoehle', { seed: 5 }); const e = L.eintrag(S.g, S.id);
  S.betreten();
  const g = S.g;
  const kartenVor = JSON.stringify(S.k);
  const m1 = S.aktiv(); const erz0 = Vorrat.stand(g, 'erz');
  ok(!('erz' in g.inventory) && erz0 === 0, 'vor dem ersten Abbau gibt es das Konto erz nicht (spätes Konto, Golden bleibt)');
  let summe = 0;
  for (const aid of m1) { const soll = Anker.abbauMenge(g, S.id, S.k.anker.find((a) => a.id === aid)).menge; abbauen(S, aid); summe += soll; }
  ok(m1.every((aid) => S.z(aid) === 'abgebaut') && S.aktiv().length === 0, 'Mission 1: alle aktiven Adern abgebaut');
  ok(Vorrat.GUETER.includes('erz') && Vorrat.GRUENDE.includes('abbau') && g.errors === 0, 'erz ist ein Vorratsgut, abbau ein Buchungsgrund, die Buchungen zählen keinen Fehler (buchung-gut/-grund)');
  ok(Vorrat.stand(g, 'erz') === summe && summe >= m1.length && summe <= 3 * m1.length, 'Lager: erz = Summe der Mengen (' + summe + ')');
  const fe = S.evn('abbauFertig');
  ok(fe.length === m1.length && fe.every((x) => x[1].art === 'erz' && x[1].menge >= 1 && x[1].menge <= 3) && fe.reduce((s, x) => s + x[1].menge, 0) === summe, 'Ereignis abbauFertig trägt Menge und Art, Summe stimmt');
  const bu = S.buchungen.filter((b) => b.konto === 'erz');
  ok(bu.length === m1.length && bu.every((b) => b.grund === 'abbau' && b.art === 'buchung' && b.betrag >= 1 && b.betrag <= 3) && bu[bu.length - 1].stand === summe, 'Telemetrie: je Abbau eine Buchung konto erz, art buchung, grund abbau, Stand läuft auf ' + summe);
  // einmalig je Mission: dieselbe Ader nicht noch einmal
  const vorher = Vorrat.stand(g, 'erz'); abbauen(S, m1[0]);
  ok(Vorrat.stand(g, 'erz') === vorher && S.z(m1[0]) === 'abgebaut', 'einmalig: derselbe Abbau bucht nichts mehr');
  // abbauNeu
  const ne0 = S.evn('abbauNeu').length;
  ok(Anker.abbauNeu(g, S.id) === null && e.abbau_runde === 1, 'abbauNeu: Rückgabe null, abbau_runde 1');
  const m2 = S.aktiv();
  const w1 = GenHoehle.adernWahl(S.k.seed | 0, kandidaten(S.k).map((a) => a.id), 1);
  ok(m2.length >= 2 && m2.length <= 3 && JSON.stringify(m2) === JSON.stringify(w1.da), 'Mission 2: ' + m2.length + ' frische Adern = adernWahl(Seed, Kandidaten, 1)');
  ok(m2.every((id) => !m1.includes(id)) || m2.some((id) => !m1.includes(id)), 'Mission 2 enthält mindestens eine Ader, die in Mission 1 nicht aktiv war');
  ok(kandidaten(S.k).every((a) => ['da', 'leer'].includes(S.z(a.id))), 'vorher abgebaute Adern sind überschrieben (da oder leer, nie abgebaut)');
  ok(JSON.stringify(S.k) === kartenVor && JSON.stringify(L.karte(g, S.id)) === kartenVor, 'Karte byteweise gleich vor und nach abbauNeu (JSON der registrierten Karte)');
  const ev = S.evn('abbauNeu'), me = S.menN('abbauNeu');
  ok(ev.length === ne0 + 1 && me.length === 1 && ev[ev.length - 1][1].map === S.id && ev[ev.length - 1][1].runde === 1 && JSON.stringify(ev[ev.length - 1][1].adern) === JSON.stringify(m2) && JSON.stringify(me[0][1]) === JSON.stringify(ev[ev.length - 1][1]), 'Ereignis abbauNeu {map, runde, adern} (Spiel und Mission), adern = aktive Adern');
  // Mission 2 abbauen: andere Mengenfolge möglich, Buchung addiert
  let s2 = 0; for (const aid of m2) { s2 += Anker.abbauMenge(g, S.id, S.k.anker.find((a) => a.id === aid)).menge; abbauen(S, aid); }
  ok(Vorrat.stand(g, 'erz') === summe + s2, 'Mission 2 bucht dazu: ' + (summe + s2));
  // Roh-Karte (frisch gebaut, ohne Zustände) ist in jeder Runde gleich
  Anker.abbauNeu(g, S.id); Anker.abbauNeu(g, S.id);
  ok(e.abbau_runde === 3 && JSON.stringify(L.karte(g, S.id)) === kartenVor, 'drei Runden: Karte weiter byteweise gleich');
  // Fehlerwege
  ok(typeof Anker.abbauNeu(g, 'gibt.es.nicht') === 'string', 'unbekannter Landepunkt: Fehlertext');
  const Sw = szene('wildnis'); Sw.betreten();
  ok(typeof Anker.abbauNeu(Sw.g, Sw.id) === 'string' && L.eintrag(Sw.g, Sw.id).abbau_runde === 0, 'Wildnis ohne Höhle: keine Erzadern, Fehlertext, Runde bleibt 0');
}

section('6. laufender Halter wird sauber abgebrochen');
{
  const S = szene('hoehle', { seed: 5 }); S.betreten();
  const g = S.g; const aid = S.aktiv()[0];
  const a = S.k.anker.find((q) => q.id === aid); const c = Physics.tileCenter(a.x + 1, a.y);
  S.p.x = c.x; S.p.y = c.y;
  const l = []; Anker.interactionsAt(g, S.p, a.x, a.y, l);
  ok(l.length === 1 && l[0].op === 'abbauen', 'Halten wird angeboten');
  S.p.hold = { kind: 'anker:abbau', anker: aid, dur: 5, t: 1 };
  Anker.abbauStarten(g, S.p, S.p.hold);
  ok(S.z(aid) === 'laeuft' && g.away.ankerLauf.abbau[aid], 'Vorbedingung: ' + aid + ' laeuft, Halter eingetragen');
  Anker.abbauNeu(g, S.id);
  ok(!S.p.hold && !g.away.ankerLauf.abbau[aid] && S.z(aid) !== 'laeuft', 'abbauNeu: Hold weg, Halter-Eintrag weg, Zustand nicht mehr laeuft');
  g.step(); g.step();
  ok(S.z(aid) === 'da' || S.z(aid) === 'leer', 'nach dem Tick bleibt es da oder leer (kein Hängenbleiben)');
  ok(S.menN('abbauFertig').length === 0, 'kein Abbau-Abschluss durch den Abbruch');
}

section('7. nicht geladene Karte: nur der Eintrag ändert sich, beim Laden gilt er');
{
  const S = szene('hoehle', { seed: 5 }); S.betreten();
  const g = S.g; const e = L.eintrag(g, S.id);
  const kartenVor = JSON.stringify(L.karte(g, S.id));
  for (const aid of S.aktiv()) abbauen(S, aid);
  L.sichern(g, S.id);
  const abgebaut = Object.keys(e.zustaende).filter((k) => e.zustaende[k] === 'abgebaut');
  ok(abgebaut.length >= 2, 'gespeichert: ' + abgebaut.length + ' Adern abgebaut');
  g.players[0].zone = 'ship'; g.away = null; g.aways[S.id].active = false;
  delete g.aways[S.id]; W.unregister(S.id);
  ok(!g.aways[S.id] && !W.AWAY_MAPS[S.id], 'Vorbedingung: Karte nicht geladen');
  ok(Anker.abbauNeu(g, S.id) === null && e.abbau_runde === 1, 'abbauNeu auf nicht geladener Karte: Runde 1');
  const w1 = GenHoehle.adernWahl(L.karte(g, S.id).seed | 0, kandidaten(L.karte(g, S.id)).map((a) => a.id), 1);
  ok(Object.keys(w1.da).length && w1.da.every((id) => e.zustaende[id] === 'da') && w1.leer.every((id) => e.zustaende[id] === 'leer') && abgebaut.every((id) => e.zustaende[id] !== 'abgebaut'), 'Eintrag: da/leer nach adernWahl, abgebaute überschrieben');
  ok(JSON.stringify(L.karte(g, S.id)) === kartenVor, 'Karte (neu aus dem Cache) byteweise gleich');
  const aw = L.get(g, S.id);
  ok(JSON.stringify(kandidaten(W.AWAY_MAPS[S.id].karte).map((a) => aw.zustaende[a.id])) === JSON.stringify(kandidaten(W.AWAY_MAPS[S.id].karte).map((a) => e.zustaende[a.id])), 'beim Laden gelten die Zustände des Eintrags');
  // ohne gespeicherte Zustände (neue Partie, Runde 1 im Eintrag): Auswahl der Runde, nicht Runde 0
  for (const id of Object.keys(e.zustaende)) delete e.zustaende[id];
  delete g.aways[S.id]; W.unregister(S.id);
  const aw2 = L.get(g, S.id);
  ok(JSON.stringify(Object.keys(aw2.zustaende).filter((id) => aw2.zustaende[id] === 'da').sort()) === JSON.stringify(w1.da), 'Eintrag ohne Zustände, abbau_runde 1: Auswahl der Runde 1 (nicht 0)');
}

section('8. Speichern und Laden: Zustände, Runde, Lager; Altstand ohne Feld');
{
  const S = szene('hoehle', { seed: 5 }); S.betreten();
  const g = S.g; const e = L.eintrag(g, S.id);
  const m1 = S.aktiv(); abbauen(S, m1[0]);
  Anker.abbauNeu(g, S.id); Anker.abbauNeu(g, S.id);
  const m3 = S.aktiv(); abbauen(S, m3[0]);
  const zustaende = kandidaten(S.k).map((a) => [a.id, S.z(a.id)]);
  const erz = Vorrat.stand(g, 'erz');
  const cap = JSON.parse(JSON.stringify(Weltstand.capture(g)));
  ok(Weltstand.VERSION === 3 && cap.version === 3, 'Weltstand-VERSION bleibt 3');
  const blk = cap.welt.landepunkte[S.id];
  ok(blk && blk.abbau_runde === 2, 'Weltstand-Eintrag trägt abbau_runde 2');
  ok(cap.schiff.lager.erz === erz && Number.isInteger(erz) && erz >= 2, 'Weltstand-Lager trägt erz (' + erz + ')');
  ok(Weltstand.validate(cap).length === 0, 'der Stand ist schemagültig' + Weltstand.validate(cap).slice(0, 1).map((x) => ' – ' + x).join(''));
  const g2 = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  L.restore(cap.welt.landepunkte, g2);
  Vorrat.standSetzen(g2, 'erz', cap.schiff.lager.erz, 'laden');
  const e2 = L.eintrag(g2, S.id);
  ok(e2 && e2.abbau_runde === 2 && Vorrat.stand(g2, 'erz') === erz, 'nach dem Laden: Runde 2 und Lager erz erhalten');
  const aw2 = L.get(g2, S.id);
  const k2 = W.AWAY_MAPS[S.id].karte;
  ok(JSON.stringify(kandidaten(k2).map((a) => [a.id, aw2.zustaende[a.id]])) === JSON.stringify(zustaende), 'nach dem Laden: Zustand je Ader gleich (abgebaut, da, leer)');
  ok(JSON.stringify(k2.rows) === JSON.stringify(S.k.rows) && JSON.stringify(k2.anker) === JSON.stringify(S.k.anker) && JSON.stringify(k2.anker.filter((a) => a.rolle === 'abbau')) === JSON.stringify(S.k.anker.filter((a) => a.rolle === 'abbau')), 'nach dem Laden: Raster und Anker (Karte) gleich');
  const erneut = JSON.parse(JSON.stringify(L.toSave(g2)));
  ok(erneut[S.id].abbau_runde === 2 && JSON.stringify(erneut[S.id].zustaende) === JSON.stringify(blk.zustaende), 'erneutes Speichern: Runde und Zustände unverändert');
  // Altstand: Feld fehlt -> 0; danach abbauNeu zählt von 1
  const alt = JSON.parse(JSON.stringify(cap.welt.landepunkte)); delete alt[S.id].abbau_runde; delete alt[S.id].zustaende;
  const g3 = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  L.restore(alt, g3);
  const e3 = L.eintrag(g3, S.id);
  ok(e3.abbau_runde === 0, 'Altstand ohne abbau_runde: lädt als 0');
  const aw3 = L.get(g3, S.id);
  const w0 = GenHoehle.adernWahl(W.AWAY_MAPS[S.id].karte.seed | 0, kandidaten(W.AWAY_MAPS[S.id].karte).map((a) => a.id), 0);
  ok(JSON.stringify(Object.keys(aw3.zustaende).filter((id) => aw3.zustaende[id] === 'da').sort()) === JSON.stringify(w0.da), 'Altstand ohne Zustände: Runde-0-Auswahl');
  const altOhneFeld = JSON.parse(JSON.stringify(cap)); delete altOhneFeld.welt.landepunkte[S.id].abbau_runde;
  ok(Weltstand.validate(altOhneFeld).length === 0, 'Altstand ohne Feld ist schemagültig (Feld optional)');
  // Kompat: Schema von main (ohne das Feld) nimmt den neuen Eintrag an
  const MAIN = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'weltstand-main.schema.json'), 'utf8'));
  const lp = ((((MAIN.properties || {}).welt || {}).properties || {}).landepunkte || {}).additionalProperties || {};
  ok(lp.additionalProperties !== false, 'Schema von main erlaubt weitere Felder im Landepunkt-Eintrag (abbau_runde ist additiv)');
}

console.log(`\n${n - fails}/${n} Prüfungen ok`);
process.exit(fails ? 1 : 0);
