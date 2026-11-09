#!/usr/bin/env node
// KAC-01 D: Prüfer und Anzeige der Sektortypen.
//   a) Testkarte tools/fixtures/kacheln/testkarte.json (alle zehn Typen, [planet,planet,station], grosser_asteroid, ein Hex ohne typ): Aufbau, Raumszene je Hex
//      über Sektoren.setzeKarte/Locations, check-sektoren- und check-erreichbar-Logik (tools/kacheln-pruefer.js) grün
//   b) Mutationsproben je Prüfung: unbekannter Typ, Gasriese als Zweittyp, instabil in Kombination, station+station, Layout nicht lösbar, doppelte Körper-ID,
//      Körper außerhalb der Szene, Beam fehlt, überlappende Beams, Beam außerhalb, Anflug versperrt, Ankunft im Körper, Sprungpunkt im Körper,
//      doppelte Landepunkt-ID, Hex nicht erreichbar, kaputter Gütercode im Katalog – jeweils rot mit Meldung, gültig = grün
//   c) Anzeige: Typ-Icon und Typname (kartenzeichen.js) = Katalog (icon, name), Icons vorhanden, Hexe OHNE typ: hauptIcon wie vorher (alle drei Spielkarten),
//      Planetenarten wiesenwald und vulkan in Tokens und Kugelzeichner
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Sektoren = require('../shared/sektoren.js');
const Locations = require('../shared/locations.js');
const GEN = require('../shared/gen-sektor.js');
const ST = require('../shared/sektortypen.js');
const P = require('./kacheln-pruefer.js');

let fehler = 0, n = 0;
const pruefe = (name, f) => { n++; try { f(); console.log('✓ ' + name); } catch (e) { fehler++; console.log('✗ ' + name + ': ' + e.message); } };
const klon = (x) => JSON.parse(JSON.stringify(x));
const ROOT = path.join(__dirname, '..');
const KARTE = klon(require('./fixtures/kacheln/testkarte.json'));
const TYPEN = ['planet', 'gasriese', 'station', 'asteroidenfeld', 'grosser_asteroid', 'nebel', 'wrackfeld', 'leerraum', 'piratenlager', 'instabil'];
const DREI = ['planet', 'planet', 'station'];
// Die Meldungen müssen den Hex und den Anlass nennen
const rotMit = (r, code, teile) => {
  assert.ok(r.fehler.length > 0, 'Prüfer blieb grün');
  const f = r.fehler.filter((x) => x.code === code);
  assert.ok(f.length > 0, `kein Fehler ${code}, bekommen: ${r.fehler.map((x) => x.code + ' ' + x.msg).join(' | ')}`);
  assert.ok(f.some((x) => teile.every((t) => `${x.wo} ${x.msg}`.includes(t))), `Meldung ohne ${JSON.stringify(teile)}: ${f.map((x) => x.wo + ': ' + x.msg).join(' | ')}`);
};
const gruen = (r) => assert.deepStrictEqual(r.fehler, [], r.fehler.map((x) => `${x.code} ${x.wo}: ${x.msg}`).join(' | '));
const hexMit = (typ) => ({ name: 'Probe', fraktion: 'frei', art: 'Probe', region: 'test', spielbar: true, ort: 'kt_probe', gen: true, typ });
const szeneVon = (hex, daten) => { const p = P.layoutProbe(hex, daten); assert.ok(p.szene, 'Szene nicht erzeugbar'); return klon(p.szene); };

// ---------- a) Testkarte ----------
pruefe('Testkarte: 5x4, Format sektorkarte/1, liegt nicht unter content/', () => {
  assert.strictEqual(KARTE.format, 'sektorkarte/1'); assert.strictEqual(KARTE.spalten, 5); assert.strictEqual(KARTE.zeilen, 4);
  assert.ok(!fs.existsSync(path.join(ROOT, 'content', 'welt', KARTE.id + '.json')));
  assert.ok(!require('../server/sim/welt.js').ids().includes(KARTE.id), 'Welt kennt die Testkarte');
});
pruefe('Testkarte: alle zehn Typen, [planet,planet,station] und grosser_asteroid dabei, ein Hex ohne typ', () => {
  const alle = new Set();
  for (const d of Object.values(KARTE.hexe)) if (d.typ !== undefined) for (const t of [].concat(d.typ)) alle.add(t);
  assert.deepStrictEqual([...alle].sort(), TYPEN.slice().sort());
  assert.ok(Object.values(KARTE.hexe).some((d) => JSON.stringify(d.typ) === JSON.stringify(DREI)));
  assert.ok(Object.values(KARTE.hexe).some((d) => d.typ === 'grosser_asteroid'));
  assert.strictEqual(Object.values(KARTE.hexe).filter((d) => d.typ === undefined).length, 1);
});
pruefe('Testkarte: jeder Hex mit eigenem ort und gen:true (ausser dem typ-Hex 0304 ohne ort), Orte eindeutig, Kanten zwischen Nachbarn', () => {
  const orte = Object.values(KARTE.hexe).map((d) => d.ort).filter(Boolean);
  assert.ok(Object.values(KARTE.hexe).every((d) => d.spielbar === true && (d.ort ? d.gen === true : d.typ !== undefined)));   // W3: ohne ort nur mit typ (Ort-ID k_<hex>)
  assert.deepStrictEqual(Object.keys(KARTE.hexe).filter((h) => !KARTE.hexe[h].ort), ['0304']);
  assert.strictEqual(new Set(orte).size, orte.length);
  const vorher = Sektoren.KARTE;
  try { Sektoren.setzeKarte(KARTE); for (const e of KARTE.kanten) assert.ok(Sektoren.sindNachbarn(e.a, e.b), `${e.a}-${e.b} sind keine Nachbarn`); } finally { Sektoren.setzeKarte(vorher); }
});
pruefe('Testkarte: jeder Hex hat eine Raumszene (Sektoren.setzeKarte, Locations.get), typ-Hexe mit Körpern, Hex ohne typ ohne', () => {
  const vorher = Sektoren.KARTE;
  try {
    Sektoren.setzeKarte(KARTE);
    for (const [hex, d] of Object.entries(KARTE.hexe)) {
      const ort = Sektoren.ortVonHex(hex), loc = Locations.get(ort);
      assert.ok(loc && loc.scene && loc.scene.arrive, `${hex}: keine Raumszene`);
      assert.strictEqual(loc.hex, hex);
      if (d.typ !== undefined) assert.ok(Array.isArray(loc.scene.koerper) && JSON.stringify(loc.scene.typ) === JSON.stringify(d.typ), `${hex}: Körper/typ fehlen`);
      else assert.ok(!('koerper' in loc.scene) && !('typ' in loc.scene), `${hex}: Hex ohne typ trägt Körper`);
    }
  } finally { Sektoren.setzeKarte(vorher); }
});
pruefe('Testkarte: [planet,planet,station] baut (Layout-Probe wirft nicht), drei Körper, zwei Planeten landbar plus Station', () => {
  const hex = Object.keys(KARTE.hexe).find((h) => JSON.stringify(KARTE.hexe[h].typ) === JSON.stringify(DREI));
  const sc = szeneVon(hex, KARTE.hexe[hex]);
  assert.strictEqual(sc.koerper.length >= 3, true); assert.strictEqual(sc.koerper.filter((k) => k.landbar).length >= 3, true);
});
pruefe('check-sektoren-Logik: Testkarte grün', () => { const r = P.pruefeKarte(KARTE); gruen(r); assert.ok(r.pruefungen > 100, 'Prüfungen ' + r.pruefungen); console.log('    Prüfungen: ' + r.pruefungen); });
pruefe('check-erreichbar-Logik: Testkarte grün (Zusammenhang, Anflug, Sprungpunkte)', () => { const r = P.pruefeKarteErreichbar(KARTE); gruen(r); assert.ok(r.pruefungen > 80, 'Prüfungen ' + r.pruefungen); console.log('    Prüfungen: ' + r.pruefungen); });
pruefe('check-erreichbar.pruefeKachelnKarte (Schnittstelle des Checkers): Testkarte grün', () => {
  const E = require('./check-erreichbar.js'); const r = E.pruefeKachelnKarte(KARTE);
  assert.deepStrictEqual(r.errors, []); assert.ok(r.pruefungen > 80);
  assert.strictEqual(Sektoren.kartenId(), 'limes', 'Karte nach der Prüfung zurückgestellt');
});
pruefe('Hexe ohne typ: keine Prüfung, keine Meldung', () => {
  const r = P.pruefeHex('0101', { name: 'X', art: 'Doppelstern', einfluss: 'gas' });
  assert.strictEqual(r.pruefungen, 0); assert.deepStrictEqual(r.fehler, []);
  const k = klon(KARTE); for (const d of Object.values(k.hexe)) delete d.typ;
  assert.deepStrictEqual(P.pruefeKarte(k).fehler, []); assert.deepStrictEqual(P.pruefeKarteErreichbar(k).fehler, []);
});
pruefe('Katalog des Spiels besteht pruefeKatalog; die drei Spielkarten bestehen beide Prüfer (ohne typ)', () => {
  gruen(P.pruefeKatalog());
  for (const id of require('../server/sim/welt.js').ids()) { const k = require('../server/sim/welt.js').karte(id); gruen(P.pruefeKarte(k)); gruen(P.pruefeKarteErreichbar(k)); }
});

// ---------- b) Mutationsproben ----------
pruefe('Mutation: unbekannter Typ -> ERR-TYP mit Hex und Typ', () => {
  const k = klon(KARTE); k.hexe['0101'].typ = 'quallenfeld';
  rotMit(P.pruefeKarte(k), 'ERR-TYP', ['Hex 0101', 'unbekannter Typ', 'quallenfeld']);
  const k2 = klon(KARTE); k2.hexe['0101'].typ = ['planet', 'quallenfeld'];
  rotMit(P.pruefeKarte(k2), 'ERR-TYP', ['Hex 0101', 'quallenfeld']);
});
pruefe('Mutation: Gasriese als Zweittyp -> ERR-TYP; als erster Eintrag grün', () => {
  const k = klon(KARTE); k.hexe['0101'].typ = ['planet', 'gasriese'];
  rotMit(P.pruefeKarte(k), 'ERR-TYP', ['Hex 0101', 'Gasriese nur als erster Eintrag']);
  gruen(P.pruefeHex('0102', hexMit(['gasriese', 'station'])));   // gasriese vorn: Typprüfung grün (Layout für [gasriese,station] läuft in der Layout-Probe)
});
pruefe('Mutation: instabil in einer Kombination -> ERR-TYP; allein grün', () => {
  rotMit(P.pruefeTypen('0101', hexMit(['planet', 'instabil'])), 'ERR-TYP', ['Hex 0101', 'instabil']);
  gruen(P.pruefeTypen('0101', hexMit('instabil')));
});
pruefe('Mutation: station+station -> ERR-TYP mit Anzahl; eine Station grün', () => {
  rotMit(P.pruefeTypen('0101', hexMit(['station', 'station'])), 'ERR-TYP', ['Hex 0101', '2 Stationen']);
  gruen(P.pruefeTypen('0101', hexMit(['station'])));
});
pruefe('Mutation: Layout nicht lösbar (zwölf Planeten) -> ERR-LAYOUT mit Hex und Kombination; die Typprüfung allein bleibt grün', () => {
  const kombi = Array(12).fill('planet');
  const k = klon(KARTE); k.hexe['0101'].typ = kombi;
  rotMit(P.pruefeKarte(k), 'ERR-LAYOUT', ['Hex 0101', JSON.stringify(kombi), 'findet keine Lage']);
  gruen(P.pruefeTypen('0101', hexMit(kombi)));
  assert.throws(() => GEN.erzeuge('0101', hexMit(kombi)), /findet keine Lage/, 'erzeuge wirft tatsächlich');
});
pruefe('Mutation: doppelte Körper-ID (Szene) -> ERR-KOERPER', () => {
  const sc = szeneVon('0303', KARTE.hexe['0303']); gruen(P.pruefeSzene('0303', sc));
  sc.koerper[1].id = sc.koerper[0].id;
  rotMit(P.pruefeSzene('0303', sc), 'ERR-KOERPER', ['Hex 0303', `'${sc.koerper[0].id}'`, 'doppelt']);
});
pruefe('Mutation: Körper außerhalb der Szene -> ERR-KOERPER', () => {
  const sc = szeneVon('0303', KARTE.hexe['0303']);
  sc.koerper[0].x = -40;
  rotMit(P.pruefeSzene('0303', sc), 'ERR-KOERPER', ['Hex 0303', 'ausserhalb der Szene']);
  const s2 = szeneVon('0303', KARTE.hexe['0303']); s2.koerper[2].y = s2.h + 5;
  rotMit(P.pruefeSzene('0303', s2), 'ERR-KOERPER', ['ausserhalb']);
});
pruefe('Mutation: landbarer Körper ohne Beam-Bereich -> ERR-BEAM', () => {
  const sc = szeneVon('0303', KARTE.hexe['0303']);
  const l = sc.koerper.find((k) => k.landbar); delete l.beam;
  rotMit(P.pruefeSzene('0303', sc), 'ERR-BEAM', ['Hex 0303', l.id, 'ohne Beam-Bereich']);
  const s2 = szeneVon('0303', KARTE.hexe['0303']); s2.koerper.find((k) => k.landbar).beam.range = 0;
  rotMit(P.pruefeSzene('0303', s2), 'ERR-BEAM', ['ohne Beam-Bereich']);
});
pruefe('Mutation: überlappende Beams -> ERR-BEAM', () => {
  const sc = szeneVon('0303', KARTE.hexe['0303']);
  const [a, b] = sc.koerper.filter((k) => k.landbar);
  b.x = a.x + 50; b.y = a.y;
  rotMit(P.pruefeSzene('0303', sc), 'ERR-BEAM', ['Hex 0303', a.id, b.id, 'ueberlappen']);
});
pruefe('Mutation: Beam-Bereich ragt aus der Szene -> ERR-ANFLUG', () => {
  const sc = szeneVon('0303', KARTE.hexe['0303']);
  const l = sc.koerper.find((k) => k.landbar); l.x = l.beam.range - 10; l.y = sc.h / 2;
  gruen(P.pruefeSzene('0303', Object.assign(klon(sc), { koerper: sc.koerper.filter((k) => k !== l) })));
  rotMit(P.pruefeAnflug('0303', sc, []), 'ERR-ANFLUG', ['Hex 0303', l.id, 'liegt nicht in der Szene']);
});
pruefe('Mutation: Weg zum Beam-Bereich versperrt -> ERR-ANFLUG', () => {
  const sc = szeneVon('0303', KARTE.hexe['0303']);
  gruen(P.pruefeAnflug('0303', sc, []));
  // Mauer aus Gasriesen quer zur Szene zwischen Ankunft (x = 20 %) und allen Körpern
  const mauerX = sc.arrive.x + 220;
  for (let y = 0; y <= sc.h; y += 120) sc.koerper.push({ id: 'm' + y, index: 90 + y, art: 'gasriese', x: mauerX, y, r: 100, landbar: false });
  rotMit(P.pruefeAnflug('0303', sc, []), 'ERR-ANFLUG', ['Hex 0303', 'nicht anfliegbar']);
});
pruefe('Mutation: Ankunft im Körper -> ERR-ANFLUG', () => {
  const sc = szeneVon('0303', KARTE.hexe['0303']);
  sc.koerper.push({ id: 'blocker', index: 99, art: 'gasriese', x: sc.arrive.x, y: sc.arrive.y, r: 120, landbar: false });
  rotMit(P.pruefeAnflug('0303', sc, []), 'ERR-ANFLUG', ['Ankunft', 'liegt in einem Koerper']);
});
pruefe('Mutation: Sprungpunkt im Körper -> ERR-ANFLUG', () => {
  const sc = szeneVon('0303', KARTE.hexe['0303']);
  const sp = [{ x: sc.koerper[0].x, y: sc.koerper[0].y }];
  rotMit(P.pruefeAnflug('0303', sc, sp), 'ERR-ANFLUG', ['Sprungpunkt', 'liegt in Koerper', sc.koerper[0].id]);
});
pruefe('Mutation: doppelte Landepunkt-ID (zwei Hexe mit gleichem ort) -> ERR-KOERPER', () => {
  const k = klon(KARTE); k.hexe['0402'].ort = k.hexe['0101'].ort;
  rotMit(P.pruefeKarte(k), 'ERR-KOERPER', [`'${k.hexe['0101'].ort}.k`, 'doppelt']);
});
pruefe('Landepunkt-ID nach Schema k_<hex>.k<index> (Hex ohne ort) bzw. ort.k<index>', () => {
  assert.strictEqual(P.landepunktId('0305', {}, 1), 'k_0305.k1');
  assert.strictEqual(P.landepunktId('0305', { ort: 'meinort' }, 0), 'meinort.k0');
});
pruefe('Mutation: ort ohne gen:true -> ERR-TYP (typ würde nie gelesen)', () => {
  const k = klon(KARTE); delete k.hexe['0101'].gen;
  rotMit(P.pruefeKarte(k), 'ERR-TYP', ['Hex 0101', 'nicht gen:true']);
});
pruefe('Mutation: Hex nicht über offene Kanten erreichbar -> ERR-ANFLUG', () => {
  const k = klon(KARTE); k.kanten = k.kanten.filter((e) => e.a !== '0303' && e.b !== '0303');
  rotMit(P.pruefeKarteErreichbar(k), 'ERR-ANFLUG', ['Hex 0303', 'nicht erreichbar']);
  const k2 = klon(KARTE); for (const e of k2.kanten) if (e.a === '0303' || e.b === '0303') e.art = 'locked';
  rotMit(P.pruefeKarteErreichbar(k2), 'ERR-ANFLUG', ['Hex 0303']);
});
pruefe('Mutation: kaputter Gütercode im Katalog (Typ und Planetenart) -> ERR-KATALOG mit Code', () => {
  const kat = klon(ST.katalog()); kat.typen.find((t) => t.id === 'gasriese').quelle = [{ gut: 'X' }];
  rotMit(P.pruefeKatalog(kat), 'ERR-KATALOG', ["Typ 'gasriese'.quelle[0].gut", "'X'", 'T/M/U/E/N/R']);
  rotMit(P.pruefeKarte(KARTE, kat), 'ERR-KATALOG', ["Guetercode 'X'"]);
  const kat2 = klon(ST.katalog()); kat2.planetenarten.vulkan.quelle = [{ gut: 'Q' }];
  rotMit(P.pruefeKatalog(kat2), 'ERR-KATALOG', ["Planetenart 'vulkan'", "'Q'"]);
  gruen(P.pruefeKatalog(klon(ST.katalog())));
});
pruefe('Prüfer ändern den Spielzustand nicht (Karte vorher = nachher)', () => {
  const vorher = Sektoren.KARTE; P.pruefeKarteErreichbar(KARTE); assert.strictEqual(Sektoren.KARTE, vorher);
});
pruefe('Checker-Skripte laufen als Prozess grün (check-sektoren, check-erreichbar --statisch)', () => {
  const { spawnSync } = require('child_process');
  for (const a of [['tools/check-sektoren.js'], ['tools/check-erreichbar.js', '--statisch']]) {
    const r = spawnSync(process.execPath, a, { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, a.join(' ') + ': Exit ' + r.status + '\n' + (r.stdout || '').slice(-600));
    if (a[0].endsWith('sektoren.js')) assert.ok(/\[kacheln\]/.test(r.stdout) && /Karte limes: 0 Hexe mit typ/.test(r.stdout), 'Abschnitt [kacheln] fehlt');
  }
});

// ---------- c) Anzeige ----------
const KZ = require('../public/js/kartenzeichen.js');
const IB = require('../public/js/icons-b.js').IconsB;
pruefe('Typ-Icon und Typname fest verdrahtet = Katalog (icon, name), alle zehn Typen', () => {
  assert.deepStrictEqual(Object.keys(KZ.TYP_ICON).sort(), ST.typen().slice().sort());
  assert.deepStrictEqual(Object.keys(KZ.TYP_NAME).sort(), ST.typen().slice().sort());
  for (const id of ST.typen()) {
    assert.strictEqual(KZ.TYP_ICON[id], ST.typ(id).icon, 'icon ' + id);
    assert.strictEqual(KZ.TYP_NAME[id], ST.typ(id).name, 'name ' + id);
    assert.strictEqual(KZ.typIcon({ typ: id }), ST.typ(id).icon); assert.strictEqual(KZ.typName({ typ: id }), ST.typ(id).name);
    assert.strictEqual(KZ.hauptIcon({ typ: id, art: 'Wrack', hafen: 'A' }), ST.typ(id).icon, 'hauptIcon ' + id);
  }
});
pruefe('Jedes Typ-Icon ist ein vorhandenes IconsB.hex-Zeichen (Maske 10x10 oder Alias)', () => {
  for (const id of ST.typen()) {
    const icon = ST.typ(id).icon;
    assert.ok(IB.has('hex', icon), `IconsB.hex kennt '${icon}' (${id}) nicht`);
    const m = IB.hex[IB.resolve('hex', icon)];
    assert.ok(m.length === 10 && m.every((z) => z.length === 10), `Maske '${icon}' nicht 10x10`);
    assert.ok(IB.FARBE.hex[IB.resolve('hex', icon)], `Farbe fehlt für '${icon}'`);
  }
});
pruefe('typIcon/typName: Liste = Haupttyp bzw. alle Namen, kein typ -> null, unbekannter Typ wird übergangen', () => {
  assert.strictEqual(KZ.typIcon({ typ: DREI }), 'planet'); assert.strictEqual(KZ.typName({ typ: DREI }), 'Planet + Planet + Station');
  assert.strictEqual(KZ.typIcon({ name: 'x' }), null); assert.strictEqual(KZ.typName({ name: 'x' }), null);
  assert.strictEqual(KZ.typIcon(null), null); assert.strictEqual(KZ.typIcon({ typ: 'quallenfeld' }), null); assert.strictEqual(KZ.typName({ typ: ['quallenfeld'] }), null);
});
// Referenz: hauptIcon vor KAC-01 D (aus kartenzeichen.js, unverändert übernommen)
function hauptIconAlt(s) {
  const SYMBOL_ICON = KZ.SYMBOL_ICON;
  for (const sym of s.symbole || []) if (SYMBOL_ICON[sym] === 'heimat') return 'heimat';
  const art = String(s.art || '').toLowerCase();
  if (/wrack/.test(art)) return 'wrack';
  if (/boje/.test(art)) return 'boje';
  if (/gasriese/.test(art)) return 'gasriese';
  if (/nebel/.test(art) || s.einfluss === 'nebel') return 'nebel';
  if (/asteroid|trümmer/.test(art)) return 'asteroiden';
  for (const sym of s.symbole || []) if (SYMBOL_ICON[sym]) return SYMBOL_ICON[sym];
  if (/ruine|relais|sternwarte/.test(art)) return 'ruine';
  if (s.hafen) return 'hafen';
  return 'system';
}
pruefe('Hexe ohne typ: hauptIcon wie vorher für alle Hexe der drei Spielkarten (und den Testkarten-Hex ohne typ)', () => {
  let anzahl = 0;
  const welt = require('../server/sim/welt.js');
  for (const id of welt.ids()) for (const [hex, d] of Object.entries(welt.karte(id).hexe)) { anzahl++; assert.strictEqual(d.typ, undefined); assert.strictEqual(KZ.hauptIcon(d), hauptIconAlt(d), `${id}/${hex}`); assert.strictEqual(KZ.typName(d), null); }
  for (const d of Object.values(KARTE.hexe)) if (d.typ === undefined) { anzahl++; assert.strictEqual(KZ.hauptIcon(d), hauptIconAlt(d)); }
  assert.ok(anzahl > 90, 'Hexe ' + anzahl); console.log('    Hexe verglichen: ' + anzahl);
});
pruefe('Testkarte: jeder Typ-Hex zeigt das Icon seines Haupttyps', () => {
  for (const d of Object.values(KARTE.hexe)) if (d.typ !== undefined) assert.strictEqual(KZ.hauptIcon(d), ST.typ([].concat(d.typ)[0]).icon, d.name);
});
pruefe('Planetenarten wiesenwald und vulkan: Paletten in den Tokens, Kugelzeichner kennt sie, alle Katalog-Planetenarten gezeichnet', () => {
  const T = require('../public/js/hauptschirm-tokens.js').TOKENS || require('../public/js/hauptschirm-tokens.js');
  const K = require('../public/js/kulisse-kugel.js');
  const arten = Object.keys(ST.katalog().planetenarten);
  for (const a of arten.concat('gasriese')) { assert.ok(T.PLANET[a], 'Palette ' + a); assert.ok(K.ARTEN.includes(a), 'Kugel ' + a); }
  for (const a of ['fels', 'eis', 'wueste', 'ozean', 'gasriese']) assert.ok(K.ARTEN.includes(a) && T.PLANET[a], 'alte Art ' + a + ' bleibt');
  const px = (a) => require('crypto').createHash('sha1').update(Buffer.from(K.kugelPixel(a, 12, 5, 0).daten)).digest('hex');
  const h = new Set(['wiesenwald', 'vulkan', 'fels', 'wueste'].map(px));
  assert.strictEqual(h.size, 4, 'wiesenwald und vulkan sehen anders aus als fels/wueste');
  assert.strictEqual(px('vulkan'), px('vulkan'));
});
pruefe('Planetenarten der Szenen aller Typ-Hexe der Testkarte sind gezeichnet (Paletten vorhanden)', () => {
  const T = require('../public/js/hauptschirm-tokens.js').TOKENS || require('../public/js/hauptschirm-tokens.js');
  const vorher = Sektoren.KARTE;
  try {
    Sektoren.setzeKarte(KARTE);
    for (const [hex, d] of Object.entries(KARTE.hexe)) { const sc = Locations.get(Sektoren.ortVonHex(hex)).scene; for (const p of sc.planeten) assert.ok(T.PLANET[p.art], `${hex}: Planetenart '${p.art}' ohne Palette`); }
  } finally { Sektoren.setzeKarte(vorher); }
});

// ---------- d) Sternkarte (W3): typ-Hex ohne eigenes ort ----------
// StarMap im vm mit dem echten Shared_Sektoren; starmapQuelle erlaubt die Mutationsprobe (alte prep-Zeile)
const starmapQuelle = () => fs.readFileSync(path.join(ROOT, 'public', 'js', 'starmap.js'), 'utf8');
function sternkarteTreffer(src) {
  const vm = require('vm');
  const calls = []; const fehlerListe = [];
  const rec = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push(k); }), set: (t, k, v) => { t[k] = v; return true; } });
  const win = {}; let alt = 0;
  win.Net = { reportError: (l, e) => fehlerListe.push(l + ': ' + (e && e.message)), on() { return () => {}; } };
  win.Render = { text() {}, measure: (s) => String(s).length * 5, wrap: (s) => [String(s)], worldOf: (st) => st.world, drawPin() {}, drawStarMapAlt() { alt++; } };
  win.Shared_Sektoren = Sektoren;
  const ctxVm = { window: win, self: win, document: { createElement: () => ({ getContext: rec, width: 0, height: 0 }) }, console };
  vm.createContext(ctxVm);
  for (const f of ['kartenzeichen.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8'), ctxVm, { filename: f });
  vm.runInContext(src, ctxVm, { filename: 'starmap.js' });
  const SM = win.StarMap;
  SM.setKarte(KARTE);
  const state = { ship: { scene: 'k_0304', jump: {} }, world: { location: 'k_0304', locations: [
    { id: 'k_0304', name: 'Namenlos', known: true, visited: true, links: [] }, { id: 'kt_0303', name: 'Dreiklang', known: true, visited: true, links: [] } ] },
  space: {}, plan: { pins: [] } };
  const rect = { x: 0, y: 0, w: 640, h: 360 };
  SM.draw(rec(), { state, time: 3, mouse: null, actions: {} }, rect, {});
  const m = SM.hexMitte('0304');
  const treffer = m ? SM.hit(m.x, m.y, null) : 'keine Hexmitte';
  return { alt, fehlerListe, treffer };
}
pruefe('Sternkarte: typ-Hex ohne ort (0304 = k_0304) ist wählbar (Klick liefert Ort und Hex), ohne Rückfall auf die Punktkarte', () => {
  const vorher = Sektoren.KARTE;
  try {
    Sektoren.setzeKarte(KARTE);
    assert.strictEqual(Sektoren.ortVonHex('0304'), 'k_0304'); assert.strictEqual(Sektoren.hexVonOrt('k_0304'), '0304');
    const r = sternkarteTreffer(starmapQuelle());
    assert.deepStrictEqual(r.fehlerListe, []); assert.strictEqual(r.alt, 0);
    assert.strictEqual(JSON.stringify(r.treffer), JSON.stringify({ id: 'k_0304', hex: '0304' }));
  } finally { Sektoren.setzeKarte(vorher); }
});
pruefe('Mutation Sternkarte: alte prep-Zeile (nur K.hexe[h].ort) -> das ort-lose typ-Hex ist nicht wählbar', () => {
  const vorher = Sektoren.KARTE;
  try {
    Sektoren.setzeKarte(KARTE);
    const src = starmapQuelle();
    const von = "const o = d && (d.ort || (d.typ !== undefined && SS && typeof SS.kachelOrt === 'function' ? SS.kachelOrt(h) : null));";
    assert.ok(src.includes(von), 'Mutationsstelle fehlt');
    const r = sternkarteTreffer(src.replace(von, () => 'const o = d && d.ort;'));
    assert.strictEqual(r.treffer, null);
  } finally { Sektoren.setzeKarte(vorher); }
});

console.log(`\n${n - fehler}/${n} Proben bestanden.`);
if (fehler) { console.log(fehler + ' FEHLER.'); process.exit(1); }
