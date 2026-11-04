'use strict';
// BOD-03 Paket A: Format festkarte/2 (mehrere Decks) und allgemeine Deck-Prüfregel K-DECK für Festkarten. Headless:
//  - Zwei-Deck-Testkarte (nur hier im Test, nicht in content/; Basis ist die eingefrorene Ein-Deck-Definition tools/fixtures/festkarte-ein-deck.json, die echte Karte hat seit B1 zwei Decks: tools/test-bunker.js): Erzeuger baut, Prüfer ok, Stride, y-Versatz, gleiche Breite, Links
//  - Lift-Paar und Leiter-Paar (Rohr: anderes x) bestehen den Prüfer; Lift ohne Gegenstück wird abgewiesen (K-DECK)
//  - Payload der Testkarte gemessen, unter AWAY_MAP_MAX_BYTES
//  - Ein-Deck-Karte byteweise wie vor BOD-03 (Hash gegen die Ausgabe des alten Erzeugers, Definition als Fixture eingefroren)
//  - festkarte/1-Dateien bleiben gültig, mehrere Decks brauchen festkarte/2
//   node tools/test-festkarte-decks.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Protocol = require('../shared/protocol.js');
const Buehne = require('../shared/buehne.js');
const GenFest = require('../shared/gen-fest.js');
const { Game } = require('../server/game.js');
const L = require('../server/sim/landepunkte.js');

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };
const section = (t, fn) => { console.log('\n[' + t + ']'); try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); } };
const clone = (o) => JSON.parse(JSON.stringify(o));
const payloadB = (k) => Buffer.byteLength(JSON.stringify(Game.prototype.awayMapPayload.call({}, k)));
const bauen = (def, opts) => Buehne.ausRaster(GenFest.karteRoh(def, Object.assign({ id: 'test.decks' }, opts || {})), { spiel: true });
const hash = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');

// Ausgang: die Grabenkarte (eingefroren als Ein-Deck-Definition) als Deck 0, dazu ein kleines Keller-Deck (schmaler und niedriger als die Oberfläche)
const DEF = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'festkarte-ein-deck.json'), 'utf8'));
const KELLER_H = 12, KELLER_B = 20;
function zweiDeckDef(links) {
  const d = clone(DEF);
  d.format = 'festkarte/2';
  // Oberflächen-Enden: im Bunkervorraum (Abschnitt eingang, Boden ',')
  const ein = d.decks[0].abschnitte.eingang.varianten.bunker;
  ein.anker.push({ id: 't.lift.oben', rolle: 'lift', x: 8, y: 12 }, { id: 't.leiter.oben', rolle: 'leiter', x: 9, y: 20 });
  const rows = [];
  for (let y = 0; y < KELLER_H; y++) rows.push(y === 0 || y === KELLER_H - 1 ? '#'.repeat(KELLER_B) : '#' + ','.repeat(KELLER_B - 2) + '#');
  d.decks.push({
    id: 'keller', hoehe: KELLER_H, reihenfolge: ['keller'],
    abschnitte: { keller: { name: 'Keller', standard: 'k', varianten: { k: { name: 'Keller', breite: KELLER_B, rows, anker: [
      { id: 't.lift.unten', rolle: 'lift', x: 3, y: 5 }, { id: 't.leiter.unten', rolle: 'leiter', x: 15, y: 8 },
    ], bereiche: { keller: { name: 'Keller', rects: [[1, 1, KELLER_B - 2, KELLER_H - 2]], rolle: null, gefecht: true } } } } } },
  });
  d.links = links || [{ a: 't.lift.oben', b: 't.lift.unten' }, { a: 't.leiter.oben', b: 't.leiter.unten', via: 'leiter' }];
  d.pflicht = Object.assign({}, d.pflicht, { lift: 1, leiter: 1 });
  return d;
}
const D2 = zweiDeckDef();
const R2 = bauen(D2);
const K2 = R2.karte;
const codes = (r) => r.fehler.map((f) => f.code + ' ' + f.msg);

section('Zwei-Deck-Karte: Erzeuger festkarte/2', () => {
  const stride = Math.max(DEF.hoehe, KELLER_H);
  ok(K2.decks && K2.decks.stride === stride && stride === 36, `decks.stride ${K2.decks && K2.decks.stride} = höchstes Deck (36)`);
  ok(K2.h === stride + KELLER_H && K2.w === 100 && K2.rows.length === K2.h && K2.rows.every((r) => r.length === K2.w), `Raster ${K2.w}x${K2.h}: alle Zeilen gleich breit (Keller mit _ aufgefüllt)`);
  ok(K2.rows[stride] === 'F' + '#'.repeat(KELLER_B) + 'F' + '_'.repeat(K2.w - KELLER_B - 2), 'Deck 1 beginnt bei y = stride');
  const kz = K2.rows[stride + 5];
  ok(kz[0] === 'F' && kz[1] === '#' && kz[KELLER_B] === '#' && kz[KELLER_B + 1] === 'F' && /^_+$/.test(kz.slice(KELLER_B + 2)), 'Keller-Zeile: Rand, Wand, Boden, Wand, Rand, danach Auffüllung _');
  const a = K2.anker.find((q) => q.id === 't.lift.unten');
  ok(a && a.y === stride + 5 && a.x === 3 + 1, `Anker Deck 1: y absolut im Deck + Versatz (${a && a.x},${a && a.y})`);
  const b = K2.bereiche.keller.rects[0];
  ok(b[1] === stride + 1 && b[0] === 2, 'Bereich Deck 1 um den Versatz verschoben');
  ok(K2.decks.links.length === 2 && K2.decks.links[0].via === 'lift' && K2.decks.links[1].via === 'leiter', 'Links aus Anker-IDs: Lift und Leiter');
  const lo = K2.anker.find((q) => q.id === 't.lift.oben');
  ok(JSON.stringify(K2.decks.links[0]) === JSON.stringify({ a: [lo.x, lo.y], b: [a.x, a.y], via: 'lift' }), 'Link trägt die Koordinaten beider Anker');
  ok(K2.erzeuger === 'gen-fest/2' && /fest\.grabenangriff\.1\[.*keller=k\]$/.test(K2.bauversion), 'Kennung gen-fest/2, bauversion nennt auch die Keller-Abschnitte (' + K2.bauversion.slice(-30) + ')');
  ok(GenFest.varianten(D2).some((v) => v.abschnitt === 'keller') && GenFest.standardAuswahl(D2).keller === 'k' && GenFest.auswahlPruefen(D2, { keller: 'k' }) === null && /unbekannt/.test(GenFest.auswahlPruefen(D2, { keller: 'x' })), 'varianten/standardAuswahl/auswahlPruefen kennen Abschnitte aller Decks');
});

section('Zwei-Deck-Karte: Prüfer (K-DECK allgemein)', () => {
  ok(R2.pruefung.ok && R2.fehler.length === 0, 'Prüfer ok:true, keine Fehler' + (R2.fehler.length ? ' ' + JSON.stringify(codes(R2).slice(0, 3)) : ''));
  ok(!codes(R2).some((c) => /K-DECK|K-PFLICHT|K-ERREICHBAR/.test(c)), 'Lift-Paar und Leiter-Paar (Rohr, anderes x): kein K-DECK/K-PFLICHT/K-ERREICHBAR');
  const l = K2.decks.links[1];
  ok(l.a[0] !== l.b[0], `Leiter-Paar hat verschiedene Spalten (${l.a[0]} und ${l.b[0]}) und besteht trotzdem`);
  // Negativ: Lift ohne Gegenstück (kein Link)
  const kOhne = Buehne.ausRaster(GenFest.karteRoh(zweiDeckDef([{ a: 't.leiter.oben', b: 't.leiter.unten', via: 'leiter' }]), { id: 'test.ohne' }), { spiel: true });
  const c1 = codes(kOhne);
  ok(!kOhne.pruefung.ok && c1.some((c) => /K-DECK t\.lift\.oben: kein Deck-Link/.test(c)) && c1.some((c) => /K-DECK t\.lift\.unten: kein Deck-Link/.test(c)), 'Lift ohne Gegenstück wird abgewiesen: ' + c1.filter((c) => /K-DECK/.test(c)).join(' | '));
  // Negativ: Link zeigt auf eine Kachel ohne Anker der Rolle (Gegenstück-Anker fehlt in der fertigen Karte)
  const k3 = clone(K2); k3.anker = k3.anker.filter((q) => q.id !== 't.lift.unten');
  const p3 = Buehne.pruefen(k3);
  ok(!p3.ok && p3.fehler.some((f) => f.code === 'K-DECK' && /steht kein lift-Anker/.test(f.msg)), 'Gegenstück-Anker fehlt: K-DECK (' + (p3.fehler.find((f) => f.code === 'K-DECK') || {}).msg + ')');
  // Negativ: Grenzzeilen zwischen den Decks (letzte Zeile oben, erste Zeile unten) müssen fest UND sichtsperrend sein
  const stride3 = K2.decks.stride;
  for (const [y, was] of [[stride3, 'erste Zeile Deck 1'], [stride3 - 1, 'letzte Zeile Deck 0']]) {
    const kg = clone(K2); kg.rows[y] = kg.rows[y].slice(0, 5) + ',' + kg.rows[y].slice(6);
    const pg = Buehne.pruefen(kg);
    ok(!pg.ok && pg.fehler.some((f) => f.code === 'K-DECK' && /Grenzzeile/.test(f.msg)), `begehbare Grenzzeile (${was}) wird abgewiesen: ` + ((pg.fehler.find((f) => /Grenzzeile/.test(f.msg)) || {}).msg || '-'));
  }
  // Lückenzeile (zwischen den Decks, gefüllt mit _): eine begehbare Kachel darin wird ebenfalls abgewiesen
  { const kl = clone(K2); kl.h++; kl.rows.splice(stride3, 0, '_'.repeat(kl.w)); kl.decks.stride = stride3 + 1; kl.anker.forEach((q) => { if (q.y >= stride3) q.y++; }); kl.decks.links.forEach((l) => { for (const e of [l.a, l.b]) if (e[1] >= stride3) e[1]++; });
    const gut = Buehne.pruefen(kl); ok(!gut.fehler.some((f) => /Grenzzeile/.test(f.msg)), 'Lückenzeile aus _: keine Grenzzeilen-Meldung');
    kl.rows[stride3] = kl.rows[stride3].slice(0, 7) + ',' + kl.rows[stride3].slice(8);
    const pl = Buehne.pruefen(kl); ok(pl.fehler.some((f) => /Grenzzeile/.test(f.msg)), 'begehbare Kachel in der Lückenzeile wird abgewiesen'); }
  // Negativ: beide Enden im selben Deck (Bau weist ab)
  let fehler = null; try { GenFest.karteRoh(zweiDeckDef([{ a: 't.lift.oben', b: 't.leiter.oben', via: 'lift' }])); } catch (e) { fehler = e.message; }
  ok(fehler && /Rolle lift|selben Deck/.test(fehler), 'Link mit zwei Oberflächen-Enden wird beim Bau abgewiesen (' + (fehler || '').slice(0, 60) + ')');
  fehler = null; try { GenFest.karteRoh(zweiDeckDef([{ a: 't.lift.oben', b: 'gibt.es.nicht' }])); } catch (e) { fehler = e.message; }
  ok(fehler && /Anker fehlt/.test(fehler), 'Link auf unbekannte Anker-ID wird abgewiesen');
  // Schiffe unverändert: gebaute Schiffskarte mit Decks prüft wie bisher (kein doppeltes K-DECK)
  const schiff = Buehne.bauen({ spiel: true, art: 'schiff', seed: 1 });
  const ps = Buehne.pruefen(schiff);
  ok(schiff.decks && schiff.decks.stride === Buehne.SCHIFF_STRIDE && ps.ok && !ps.fehler.some((f) => f.code === 'K-DECK'), 'Schiff mit Decks (Stride 16): Prüfer ok, kein K-DECK (' + ps.fehler.length + ' Fehler)');
});

section('Payload der Zwei-Deck-Karte', () => {
  const B = payloadB(K2);
  const B1 = payloadB(bauen(DEF).karte);
  console.log(`  Messung: Oberfläche allein ${B1} B, mit Keller-Testdeck ${B} B, Grenze ${Protocol.AWAY_MAP_MAX_BYTES} B`);
  ok(B <= Protocol.AWAY_MAP_MAX_BYTES, `Payload ${B} B <= AWAY_MAP_MAX_BYTES ${Protocol.AWAY_MAP_MAX_BYTES}`);
  ok(B > B1, 'Zweites Deck kostet Bytes (rows, anker, bereiche, decks.links)');
  const pay = Game.prototype.awayMapPayload.call({}, K2);
  ok(pay.decks && pay.decks.stride === 36 && pay.decks.links.length === 2, 'awayMap-Payload trägt decks { stride, links }');
  ok(Protocol.AWAY_MAP_MAX_BYTES === 16384, 'Protokollgrenze 16 KB');
});

section('Ein-Deck-Karte: byteweise wie vor BOD-03', () => {
  // Referenz: Ausgabe des Erzeugers vor festkarte/2 (sha256 des JSON von karteRoh, id x, seed 3) für die eingefrorene Definition
  const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'festkarte-ein-deck.json'), 'utf8'));
  const RAW = GenFest.karteRoh(FIX, { id: 'x', seed: 3 });
  ok(hash(RAW) === '43bb291bee866cb7533aa8e1c54100f27834fd10d3fa2f701c8f71a87730c1e7' && JSON.stringify(RAW).length === 7065, `Standardauswahl: Hash und Länge wie vor der Änderung (${hash(RAW).slice(0, 12)}, ${JSON.stringify(RAW).length} Zeichen)`);
  ok(RAW.decks === null && RAW.erzeuger === 'gen-fest/1' && RAW.h === 36 && RAW.w === 100, 'decks: null, Erzeuger gen-fest/1, 100x36');
  ok(hash(GenFest.karteRoh(FIX, { id: 'x', seed: 3, abschnitte: GenFest.standardAuswahl(FIX) })) === hash(RAW), 'ausdrücklich gewählte Standardauswahl: gleiche Ausgabe');
  // Variante nur als Daten ergänzt (Wald zweite Wahl: Kopie) -> beide Auswahlen bleiben unverändert, die neue baut wie die Kopie
  const d2 = clone(FIX); d2.decks[0].abschnitte.wald.varianten.zwei = clone(d2.decks[0].abschnitte.wald.varianten.weg);
  ok(hash(GenFest.karteRoh(d2, { id: 'x', seed: 3 })) === hash(RAW), 'Definition mit zusätzlicher Variante: Standard unverändert');
  const rz = GenFest.karteRoh(d2, { id: 'x', seed: 3, abschnitte: { wald: 'zwei' } });
  ok(rz.rows.join('') === RAW.rows.join('') && rz.decks === null, 'Kopie-Variante gewählt: gleiches Raster, decks: null');
  ok(FIX.format === 'festkarte/1', 'Definition bleibt festkarte/1 (Datei gültig)');
  const live = L.festkarte('grabenangriff');
  ok(live.format === 'festkarte/2' && live.decks.length === 2 && JSON.stringify(live.decks[0].abschnitte.wiese) === JSON.stringify(FIX.decks[0].abschnitte.wiese), 'content/grabenangriff.json hat seit BOD-03 B1 zwei Decks (festkarte/2), die Wiese ist unveraendert gegenueber der Fixture');
  // festkarte/1 mit mehreren Decks: abgewiesen
  const d3 = clone(FIX); d3.decks.push({ id: 'bunker', reihenfolge: [], abschnitte: {} });
  let fehler = null; try { GenFest.karteRoh(d3); } catch (e) { fehler = e.message; }
  ok(fehler && /festkarte\/2/.test(fehler), 'festkarte/1 mit zweitem Deck wird abgewiesen: ' + fehler);
  // Abschnitts-ID in zwei Decks doppelt
  const d4 = zweiDeckDef(); d4.decks[1].reihenfolge = ['eingang']; d4.decks[1].abschnitte = { eingang: d4.decks[1].abschnitte.keller };
  fehler = null; try { GenFest.karteRoh(d4); } catch (e) { fehler = e.message; }
  ok(fehler && /mehreren Decks/.test(fehler), 'Abschnitts-ID in zwei Decks wird abgewiesen');
});

console.log(`\n${fails ? 'VERFEHLT' : 'ok'}: ${n - fails}/${n}`);
process.exit(fails ? 1 : 0);
