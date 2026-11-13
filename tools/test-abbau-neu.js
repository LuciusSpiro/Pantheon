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
const Fracht = require('../server/sim/fracht.js');
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
// WRK-01 A2: Erz ist Fracht (Platz- und Typ-Regeln: tools/test-abbau-frachtraum.js). Dieser Test stellt nur den Ablauf nach: jeder Abbau bekommt ein leeres Lager und liest danach, was ankam.
function abbauen(S, aid) {
  Fracht.debug(S.g, ['leer']);
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
  ok(GenHoehle.PFLICHT.abbau === 4 && GenHoehle.PFLICHT_DECK.abbau === 4 && GenHoehle.VERSION === 3, 'PFLICHT/PFLICHT_DECK abbau: 4, Höhle-VERSION 3 (MON-03 B: Nest)');
  ok(GenHoehle.ADERN_ZIEL(2240) === 4 && GenHoehle.ADERN_ZIEL(4480) === 5 && GenHoehle.ADERN_ZIEL(7488) === 6, 'Ziel je Fläche: klein 4, mittel 5, gross 6');
  // Deck: Pflicht PFLICHT_DECK.abbau in der Wildnis-Karte erfüllt (die Wildnis-Pflicht selbst bleibt unverändert)
  ok(JSON.stringify(GenGelaende.PFLICHT) === JSON.stringify({ abholpunkt: 1, fund: 2, deckung: 4, wache: 3 }), 'Wildnis-Pflichtsatz: wache 3 ergänzt (SPL-01 a1), sonst unverändert (die Oberfläche trägt keine Ader)');
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
  let summe = 0, jeAbbauOk = true;
  for (const aid of m1) { const soll = Anker.abbauMenge(g, S.id, S.k.anker.find((a) => a.id === aid)).menge; abbauen(S, aid); summe += soll; if (Fracht.anBord(g, 'erz') !== soll) jeAbbauOk = false; }
  ok(jeAbbauOk && !('erz' in g.inventory) && Vorrat.stand(g, 'erz') === 0, 'WRK-01 A2: jeder Abbau legt genau seine Menge als Erz in den Frachtraum, das alte Konto inventory.erz bleibt unberührt');
  ok(m1.every((aid) => S.z(aid) === 'abgebaut') && S.aktiv().length === 0, 'Mission 1: alle aktiven Adern abgebaut');
  ok(Vorrat.GUETER.includes('erz') && Vorrat.GRUENDE.includes('abbau') && g.errors === 0, 'erz ist ein Vorratsgut, abbau ein Buchungsgrund, die Buchungen zählen keinen Fehler (buchung-gut/-grund)');
  ok(summe >= m1.length && summe <= 3 * m1.length, 'Summe der Mengen ' + summe + ' (1 bis 3 je Ader)');
  const fe = S.evn('abbauFertig');
  ok(fe.length === m1.length && fe.every((x) => x[1].art === 'erz' && x[1].menge >= 1 && x[1].menge <= 3) && fe.reduce((s, x) => s + x[1].menge, 0) === summe, 'Ereignis abbauFertig trägt Menge und Art, Summe stimmt');
  ok(S.buchungen.filter((b) => b.konto === 'erz').length === 0, 'Telemetrie: keine Vorrat-Buchung konto erz mehr (Erz läuft über den Frachtraum)');
  // einmalig je Mission: dieselbe Ader nicht noch einmal
  abbauen(S, m1[0]);
  ok(Fracht.anBord(g, 'erz') === 0 && S.z(m1[0]) === 'abgebaut', 'einmalig: derselbe Abbau lagert nichts mehr ein');
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
  let s2 = 0, ok2 = true; for (const aid of m2) { const soll = Anker.abbauMenge(g, S.id, S.k.anker.find((a) => a.id === aid)).menge; s2 += soll; abbauen(S, aid); if (Fracht.anBord(g, 'erz') !== soll) ok2 = false; }
  ok(ok2 && s2 >= m2.length, 'Mission 2 lagert ihre Mengen ein (' + s2 + ')');
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
  const ladeAnz = Object.keys(W.AWAY_MAPS).length;
  const t0 = Date.now();
  ok(Anker.abbauNeu(g, S.id) === null && e.abbau_runde === 1, 'abbauNeu auf nicht geladener Karte: Runde 1');
  ok(Date.now() - t0 < 20 && !W.AWAY_MAPS[S.id] && !g.aways[S.id] && Object.keys(W.AWAY_MAPS).length === ladeAnz, 'K2: kein Kartenbau (unter 20 ms, Karte weiter weder registriert noch geladen, ' + (Date.now() - t0) + ' ms)');
  ok(abgebaut.every((id) => e.zustaende[id] === undefined) && !Object.keys(e.zustaende).some((id) => GenHoehle.istAderKandidat({ rolle: 'abbau', id })), 'K2: gespeicherte Zustände der Kandidaten sind verfallen (die Vorrunde gilt nicht mehr)');
  const ne = S.evn('abbauNeu'); ok(ne.length && ne[ne.length - 1][1].map === S.id && ne[ne.length - 1][1].runde === 1 && Array.isArray(ne[ne.length - 1][1].adern), 'K2: Ereignis abbauNeu {map, runde 1, adern} (adern ohne Karte leer)');
  const w1 = GenHoehle.adernWahl(L.karte(g, S.id).seed | 0, kandidaten(L.karte(g, S.id)).map((a) => a.id), 1);
  ok(JSON.stringify(L.karte(g, S.id)) === kartenVor, 'Karte (neu aus dem Cache) byteweise gleich');
  delete g.aways[S.id]; W.unregister(S.id);
  const aw = L.get(g, S.id);
  ok(w1.da.length >= 2 && w1.da.every((id) => aw.zustaende[id] === 'da') && w1.leer.every((id) => aw.zustaende[id] === 'leer') && abgebaut.every((id) => aw.zustaende[id] !== 'abgebaut'), 'beim Laden gilt die Auswahl der neuen Runde (da/leer nach adernWahl, abgebaute überschrieben)');
  // ohne gespeicherte Zustände (neue Partie, Runde 1 im Eintrag): Auswahl der Runde, nicht Runde 0
  for (const id of Object.keys(e.zustaende)) delete e.zustaende[id];
  delete g.aways[S.id]; W.unregister(S.id);
  const aw2 = L.get(g, S.id);
  ok(JSON.stringify(Object.keys(aw2.zustaende).filter((id) => aw2.zustaende[id] === 'da').sort()) === JSON.stringify(w1.da), 'Eintrag ohne Zustände, abbau_runde 1: Auswahl der Runde 1 (nicht 0)');
}

section('7b. K2: Karte registriert, aber nicht geladen (aw fehlt): Eintrag bekommt die Auswahl der neuen Runde');
{
  const S = szene('hoehle', { seed: 5 }); S.betreten();
  const g = S.g; const e = L.eintrag(g, S.id);
  for (const aid of S.aktiv()) abbauen(S, aid);
  L.sichern(g, S.id);
  g.players[0].zone = 'ship'; g.away = null; delete g.aways[S.id];   // Karte bleibt registriert
  ok(!!W.AWAY_MAPS[S.id] && !g.aways[S.id], 'Vorbedingung: Karte registriert, nicht geladen');
  ok(Anker.abbauNeu(g, S.id) === null && e.abbau_runde === 1, 'abbauNeu: Runde 1');
  const w1 = GenHoehle.adernWahl(W.AWAY_MAPS[S.id].karte.seed | 0, kandidaten(W.AWAY_MAPS[S.id].karte).map((a) => a.id), 1);
  ok(w1.da.every((id) => e.zustaende[id] === 'da') && w1.leer.every((id) => e.zustaende[id] === 'leer'), 'Eintrag: da/leer nach adernWahl (Runde 1)');
  const ne = S.evn('abbauNeu'); ok(JSON.stringify(ne[ne.length - 1][1].adern) === JSON.stringify(w1.da), 'Ereignis: adern aus adernWahl (Karte registriert)');
}

section('8. Speichern und Laden: Zustände, Runde, Lager; Altstand ohne Feld');
{
  const S = szene('hoehle', { seed: 5 }); S.betreten();
  const g = S.g; const e = L.eintrag(g, S.id);
  const m1 = S.aktiv(); abbauen(S, m1[0]); interior.placeOnAwayPad(g, S.p, 0);   // Spieler vom Abbauort weg (sonst wartet ein Wechsel leer -> da, W1)
  Anker.abbauNeu(g, S.id); Anker.abbauNeu(g, S.id);
  const m3 = S.aktiv(); abbauen(S, m3[0]); interior.placeOnAwayPad(g, S.p, 0);
  const zustaende = kandidaten(S.k).map((a) => [a.id, S.z(a.id)]);
  const erz = Fracht.anBord(g, 'erz');
  const cap = JSON.parse(JSON.stringify(Weltstand.capture(g)));
  ok(Weltstand.VERSION === 3 && cap.version === 3, 'Weltstand-VERSION bleibt 3');
  const blk = cap.welt.landepunkte[S.id];
  ok(blk && blk.abbau_runde === 2, 'Weltstand-Eintrag trägt abbau_runde 2');
  ok(cap.schiff.fracht.filter((x) => x === 'erz').length === erz && erz >= 1 && !('erz' in cap.schiff.lager), 'Weltstand: schiff.fracht trägt ' + erz + ' Erz, schiff.lager hat kein erz mehr');
  ok(Weltstand.validate(cap).length === 0, 'der Stand ist schemagültig' + Weltstand.validate(cap).slice(0, 1).map((x) => ' – ' + x).join(''));
  const g2 = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  Weltstand.apply(g2, cap);   // K7: der echte Ladeweg (weltstand.apply: Landepunkte, Frachtraum über Fracht.restore)
  const e2 = L.eintrag(g2, S.id);
  ok(e2 && e2.abbau_runde === 2 && Fracht.anBord(g2, 'erz') === erz, 'nach dem Laden: Runde 2 und Erz im Frachtraum erhalten');
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

// ---------- GEL-03 Nacharbeit: W1, W2, K3, K4 ----------
// Szene mit einer Ader, die in Runde abbau_runde + 1 von leer auf da wechselt (sucht über Seeds)
function szeneLeerWirdDa() {
  for (let seed = 5; seed < 40; seed++) {
    const S = szene('hoehle', { seed }); S.betreten();
    const e = L.eintrag(S.g, S.id);
    const w = GenHoehle.adernWahl(S.k.seed | 0, kandidaten(S.k).map((a) => a.id), (e.abbau_runde | 0) + 1);
    const id = w.da.find((x) => S.z(x) === 'leer');
    if (id) { S.ader = S.k.anker.find((a) => a.id === id); S.e = e; return S; }
  }
  throw new Error('keine Karte mit leer -> da gefunden');
}
const festIn = (S, a) => interior.awaySolid(S.g)(a.x, a.y);
const KREATUR = require('../server/sim/kreatur.js');

section('9. W1: abbauNeu mauert keine Figur ein (Wechsel leer -> da wartet, bis die Kachel frei ist)');
for (const art of ['spieler', 'drohne', 'kreatur']) {
  const S = szeneLeerWirdDa(); const g = S.g, a = S.ader, aw = S.aw;
  const c = Physics.tileCenter(a.x, a.y);
  aw.drones.length = 0;
  let fig = S.p;
  if (art === 'drohne') { combat.spawnSquad(g, 'w1', { map: S.id, besetzung: [{ typ: 'scavenger', anzahl: 1 }], festeZahl: true, force: true }); fig = aw.drones[0]; fig.x = c.x; fig.y = c.y; fig.alive = true; interior.placeOnAwayPad(g, S.p, 0); }
  else if (art === 'kreatur') { combat.ensureV2(g, aw); fig = KREATUR.erzeugen(g, 'rudeltier', c.x, c.y); interior.placeOnAwayPad(g, S.p, 0); }
  else { fig.x = c.x; fig.y = c.y; }
  ok(S.z(a.id) === 'leer' && !festIn(S, a), `${art}: Vorbedingung, ${a.id} ist leer und begehbar, die Figur steht darauf`);
  ok(Anker.abbauNeu(g, S.id) === null, `${art}: abbauNeu läuft ohne Fehler`);
  ok(S.z(a.id) === 'leer' && !festIn(S, a) && g.away.ankerLauf.abbauVormerk && g.away.ankerLauf.abbauVormerk[a.id] === true, `${art}: Wechsel zurückgestellt (Zustand leer, Kachel begehbar, vorgemerkt)`);
  ok(S.e.abbau_runde === 1 && S.e.zustaende[a.id] === undefined, `${art}: Runde 1, kein Zustand im Eintrag (beim Laden gilt die Auswahl der Runde)`);
  if (art === 'spieler') {
    const x0 = S.p.x, y0 = S.p.y;
    for (const [mx, my] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { S.p.input.mx = mx; S.p.input.my = my; for (let i = 0; i < 10; i++) g.step(); }
    S.p.input.mx = 0; S.p.input.my = 0;
    ok(Math.hypot(S.p.x - x0, S.p.y - y0) > 5, 'spieler: kann sich bewegen (nicht eingemauert, ' + Math.hypot(S.p.x - x0, S.p.y - y0).toFixed(1) + ' px)');
    ok(S.z(a.id) === 'da' && festIn(S, a) && !g.away.ankerLauf.abbauVormerk[a.id], 'spieler: nach dem Verlassen der Kachel wird die Ader da und fest');
    for (let i = 0; i < 10; i++) g.step();
    ok(!Physics.boxHits((tx, ty) => tx === a.x && ty === a.y, S.p.x, S.p.y, 18, 12) && S.z(a.id) === 'da', 'spieler: steht nicht in der festen Kachel');
  } else {
    for (let i = 0; i < 5; i++) g.step();
    ok(S.z(a.id) === 'leer' && !festIn(S, a), `${art}: bleibt zurückgestellt, solange die Figur dort steht (5 Ticks)`);
    fig.alive = false;   // Figur fällt aus (oder verlässt die Kachel): die Kachel ist frei
    g.step();
    ok(S.z(a.id) === 'da' && festIn(S, a), `${art}: Figur weg, im nächsten Tick wird die Ader da und fest`);
  }
}
{
  const S = szeneLeerWirdDa(); const g = S.g, a = S.ader; const c = Physics.tileCenter(a.x, a.y);
  S.p.x = c.x; S.p.y = c.y;
  L.sichern(g, S.id);
  ok(S.e.zustaende[a.id] === 'leer', 'W1 Vorbedingung: die Ader steht als leer im Eintrag');
  Anker.abbauNeu(g, S.id);
  ok(S.e.zustaende[a.id] === undefined, 'W1: abbauNeu verwirft den alten Zustand (leer) der vorgemerkten Ader im Eintrag');
  L.sichern(g, S.id);
  ok(S.e.zustaende[a.id] === undefined && !(a.id in L.toSave(g)[S.id].zustaende), 'W1 Speichern: die vorgemerkte Ader steht nicht im Weltstand-Eintrag');
  const w1 = GenHoehle.adernWahl(S.k.seed | 0, kandidaten(S.k).map((x) => x.id), 1);
  const blk = JSON.parse(JSON.stringify(L.toSave(g)));
  const g2 = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  L.restore(blk, g2);
  const aw2 = L.get(g2, S.id);
  ok(w1.da.every((x) => aw2.zustaende[x] === 'da') && w1.leer.every((x) => aw2.zustaende[x] === 'leer'), 'W1 Laden: die vorgemerkte Ader ist da (Auswahl der Runde 1), die übrigen wie gewählt');
  Anker.abbauNeu(g, S.id);   // weiteres abbauNeu bei offener Vormerkung: neu berechnet, nichts hängt
  const vm = g.away.ankerLauf.abbauVormerk || {};
  ok(Object.keys(vm).every((id) => S.z(id) === 'leer'), 'W1: nach einem weiteren abbauNeu sind nur leere Adern vorgemerkt (keine hängende Vormerkung)');
}

section('10. W2: Gegner erscheinen nicht in festen Ader-Kacheln');
{
  const squad = require('../server/sim/squad.js');
  let seeds = 0, mitAdernImFeld = 0, frei = 0, inFest = 0, spawnFest = 0, leerFrei = 0;
  for (let seed = 1; seed <= (process.env.ABBAU_NEU_SCHNELL ? 3 : 14); seed++) {
    const S = szene('hoehle', { seed }); S.betreten(); const g = S.g, aw = S.aw;
    const info = interior.awayInfoOf(S.id); seeds++;
    ok(info.id === S.id, `Seed ${seed}: awayInfo.id ist die Karten-ID (spawnPlaetze liest den Zustand der Zielkarte)`);
    const fest = interior.blockierendeKachelnIn(g, aw, S.k);
    const P = squad.spawnPlaetze(g, info, null);
    const adern = kandidaten(S.k);
    if (adern.some((a) => fest && fest.has(a.y * S.k.w + a.x))) mitAdernImFeld++;
    frei += P.frei.length; inFest += P.frei.filter((q) => fest && fest.has(q.y * S.k.w + q.x)).length;
    leerFrei += P.frei.filter((q) => adern.some((a) => a.x === q.x && a.y === q.y && S.z(a.id) === 'leer')).length;
    aw.drones.length = 0;
    for (let i = 0; i < 6; i++) combat.spawnSquad(g, 'w2_' + i, { map: S.id, besetzung: [{ typ: 'scavenger', anzahl: 12 }], festeZahl: true, force: true });
    const solid = interior.awaySolid(g);
    for (const d of aw.drones) { const t = Physics.toTile(d.x, d.y); if (solid(t.x, t.y)) spawnFest++; }
  }
  ok(inFest === 0 && frei > 0, `Ersatzplätze: keiner auf einer festen Kachel (${frei} Plätze über ${seeds} Seeds)`);
  ok(spawnFest === 0, `kein Gegner startet in einer festen Kachel (${seeds} Seeds, je 72 Gegner)`);
  ok(mitAdernImFeld === seeds, `jede Karte hat feste Adern (${mitAdernImFeld}/${seeds}): die Regel wird wirklich geprüft`);
  ok(leerFrei > 0, `leere Adern (begehbar) bleiben Ersatzplätze (${leerFrei})`);
  // Zustand entscheidet: abgebaut schließt aus, leer nicht; Zustand der ZIELkarte (nicht game.away)
  const S = szene('hoehle', { seed: 5 }); S.betreten(); const g = S.g;
  const leer = kandidaten(S.k).find((a) => S.z(a.id) === 'leer');
  const hat = (a) => squad.spawnPlaetze(g, interior.awayInfoOf(S.id), null).frei.some((q) => q.x === a.x && q.y === a.y);
  ok(hat(leer), 'leere Ader ist Ersatzplatz');
  Anker.setzen(g, S.id, leer.id, 'abgebaut', null);
  ok(!hat(leer), 'abgebaut: kein Ersatzplatz');
  Anker.setzen(g, S.id, leer.id, 'leer', null);
  ok(hat(leer), 'zurück auf leer: wieder Ersatzplatz');
  const da = kandidaten(S.k).find((a) => S.z(a.id) === 'da');
  const g0 = g.away; g.away = null;   // Karte nicht aktiv: der Zustand der Zielkarte (game.aways) gilt trotzdem
  ok(hat(leer) && !hat(da), 'Karte nicht game.away: Zustand der Zielkarte gilt (leere Ader Ersatzplatz, aktive nicht)');
  g.away = g0;
}

section('11. K3: abbau_runde hat eine Obergrenze');
{
  const MAXR = L.ABBAU_RUNDE_MAX;
  ok(MAXR === GenHoehle.ADERN_RUNDE_MAX && MAXR === 10000, 'Obergrenze 10000 (eine Quelle: gen-hoehle)');
  const S = szene('hoehle', { seed: 5 }); S.betreten(); const e = L.eintrag(S.g, S.id);
  e.abbau_runde = MAXR - 1;
  ok(Anker.abbauNeu(S.g, S.id) === null && e.abbau_runde === MAXR, 'abbauNeu erreicht die Grenze');
  ok(Anker.abbauNeu(S.g, S.id) === null && e.abbau_runde === MAXR, 'an der Grenze bleibt sie stehen (kein Überlauf)');
  const blk = JSON.parse(JSON.stringify(L.toSave(S.g)));
  blk[S.id].abbau_runde = 99999999;
  const g2 = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  L.restore(blk, g2);
  ok(L.eintrag(g2, S.id).abbau_runde === MAXR, 'restore klemmt einen manipulierten Wert (99999999) auf die Grenze');
  e.abbau_runde = 5e9; ok(L.toSave(S.g)[S.id].abbau_runde === MAXR, 'toSave klemmt ebenfalls');
  e.abbau_runde = MAXR;
  const cap = JSON.parse(JSON.stringify(Weltstand.capture(S.g)));
  ok(Weltstand.validate(cap).length === 0, 'Weltstand mit Grenzwert ist schemagültig');
  cap.welt.landepunkte[S.id].abbau_runde = MAXR + 1;
  ok(Weltstand.validate(cap).length > 0, 'Schema lehnt abbau_runde über der Grenze ab');
  const t0 = Date.now(); GenHoehle.adernWahl(7, ['hoehle.abbau', 'hoehle.abbau.2', 'hoehle.abbau.3', 'hoehle.abbau.4'], 1e6);
  ok(Date.now() - t0 < 200, 'adernWahl rechnet auch bei absurder Runde nur bis zur Grenze (' + (Date.now() - t0) + ' ms)');
}

section('12. K4: abbauNeu bricht nur Halte-Aktionen der eigenen Karte ab');
{
  const S = szene('hoehle', { seed: 5 }); S.betreten(); const g = S.g;
  const idB = L.neu(g, g.ship.scene, { art: 'hoehle', seed: 9 });
  const awB = L.get(g, idB);
  ok(g.away.map === S.id && awB && awB.map === idB, 'Vorbedingung: Karte A aktiv, Karte B geladen, aber nicht aktiv');
  const aid = S.aktiv()[0]; const a = S.k.anker.find((q) => q.id === aid); const c = Physics.tileCenter(a.x + 1, a.y);
  S.p.x = c.x; S.p.y = c.y;
  S.p.hold = { kind: 'anker:abbau', anker: aid, dur: 5, t: 1 };
  Anker.abbauStarten(g, S.p, S.p.hold);
  ok(S.z(aid) === 'laeuft' && !!S.p.hold, 'Halter auf Karte A läuft');
  ok(kandidaten(W.AWAY_MAPS[idB].karte).some((q) => q.id === aid), 'Karte B hat eine Ader mit derselben ID (der Fehler träfe sie)');
  ok(Anker.abbauNeu(g, idB) === null && L.eintrag(g, idB).abbau_runde === 1, 'abbauNeu für Karte B');
  ok(!!S.p.hold && S.p.hold.anker === aid && g.away.ankerLauf.abbau[aid] && S.z(aid) === 'laeuft', 'Halt auf Karte A bleibt (Hold, Halter-Eintrag, Zustand laeuft)');
  Anker.abbauNeu(g, S.id);
  ok(!S.p.hold && S.z(aid) !== 'laeuft', 'abbauNeu für Karte A bricht den Halt weiterhin ab');
}

console.log(`\n${n - fails}/${n} Prüfungen ok`);
process.exit(fails ? 1 : 0);
