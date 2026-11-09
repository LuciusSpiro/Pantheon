#!/usr/bin/env node
// KAC-01 B: Test der Typ-Szenen in shared/gen-sektor.js (Hex-Feld `typ`, scene.koerper, koerperVon, biomVon).
// Je Typ eine erwartete Szene, Mehrfach-Typ mit drei Körpern, Determinismus (auch über Prozesse), Biom-Pins, Szene ohne `typ` unverändert
// (Hash-Wächter tools/hash-raumszenen.js plus Mutationsprobe), Fehlermeldungen, Szenenbudget (Größe, Dauer).
'use strict';
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const G = require('../shared/gen-sektor.js');
const S = require('../shared/sektortypen.js');
const H = require('./hash-raumszenen.js');

let fehler = 0, n = 0;
const pruefe = (name, f) => { n++; try { f(); console.log('✓ ' + name); } catch (e) { fehler++; console.log('✗ ' + name + ': ' + e.message); } };
const wirftMit = (f, teile) => assert.throws(f, (e) => { teile.forEach((t) => assert.ok(String(e.message).includes(t), `Meldung enthält nicht '${t}': ${e.message}`)); return true; });
const ROOT = path.join(__dirname, '..');
const HEXE = Array.from({ length: 24 }, (_, i) => String(101 + i * 37).padStart(4, '0'));   // 24 feste Kennungen
const bauen = (hex, typ, mehr) => G.erzeuge(hex, Object.assign({ name: 'Test ' + hex, typ }, mehr || {}));
const szene = (hex, typ, mehr) => bauen(hex, typ, mehr).scene;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Invarianten jeder Typ-Szene: Körper-IDs/Index, innerhalb der Szene, Mindestabstände, Beam-Bereiche überlappen nicht
function grundInvarianten(sc, wo) {
  assert.ok(Array.isArray(sc.koerper), wo + ': koerper fehlt');
  sc.koerper.forEach((k, i) => {
    assert.strictEqual(k.index, i, wo); assert.strictEqual(k.id, 'k' + i, wo);
    assert.ok(k.x - k.r >= 0 && k.x + k.r <= sc.w && k.y - k.r >= 0 && k.y + k.r <= sc.h, `${wo}: ${k.id} ausserhalb der Szene`);
    assert.strictEqual(typeof k.landbar, 'boolean', wo);
    if (k.landbar) assert.ok(k.beam && k.beam.range > k.r, `${wo}: ${k.id} ohne beam`); else assert.ok(!('beam' in k), `${wo}: ${k.id} nicht landbar, aber beam`);
    assert.ok(dist(k, sc.arrive) >= k.r + 380 || k.art === 'gasriese', `${wo}: ${k.id} zu nah an der Ankunft`);
    if (sc.dock && k.art !== 'station') assert.ok(dist(k, sc.dock) >= k.r + 380, `${wo}: ${k.id} zu nah am Liegeplatz`);
  });
  for (let i = 0; i < sc.koerper.length; i++) for (let j = i + 1; j < sc.koerper.length; j++) {
    const a = sc.koerper[i], b = sc.koerper[j];
    if (a.art === 'gasriese' && sc.zonen) continue;   // fest stehender Zonen-Gasriese: Abstand wie im alten Pfad nicht geprüft
    assert.ok(dist(a, b) >= a.r + b.r + 300, `${wo}: ${a.id}/${b.id} unter Mindestabstand`);
    if (a.landbar && b.landbar) assert.ok(dist(a, b) >= a.beam.range + b.beam.range, `${wo}: Beam-Bereiche ${a.id}/${b.id} überlappen`);
  }
}
const planetenAnzahl = (sc) => sc.koerper.filter((k) => k.art === 'planet' || k.art === 'gasriese').length;

// ---- a) je Typ die erwartete Szene (über 24 Hexe) ----
const TYPEN = S.typen();
pruefe('Katalog hat die zehn Typen (Testgrundlage)', () => assert.strictEqual(TYPEN.length, 10));
const ERWARTUNG = {
  planet(sc, loc) {
    const l = sc.koerper.filter((k) => k.landbar), rest = sc.koerper.filter((k) => !k.landbar);
    assert.strictEqual(l.length, 1); assert.strictEqual(l[0].art, 'planet'); assert.ok(S.BIOME.includes(l[0].biom)); assert.ok(l[0].beam.range === l[0].r + 200);
    assert.ok(rest.length <= 1 && rest.every((k) => k.art === 'planet' && !k.biom && ['fels', 'eis', 'ozean'].includes(k.planetenart)));
    assert.strictEqual(sc.planeten.length, sc.koerper.length); assert.strictEqual(loc.kind, 'void');
    assert.ok(!sc.station && !sc.zonen && sc.asteroids === 0 && !loc.fog);
  },
  gasriese(sc, loc) {
    assert.strictEqual(sc.koerper.length, 1); const k = sc.koerper[0];
    assert.strictEqual(k.art, 'gasriese'); assert.strictEqual(k.landbar, false); assert.ok(k.r >= 480 && k.r <= 640);
    assert.ok(Array.isArray(sc.zonen) && sc.zonen.length > 0, 'Zonen fehlen');
    assert.strictEqual(sc.planeten.length, 1); assert.strictEqual(sc.planeten[0].art, 'gasriese'); assert.strictEqual(sc.planeten[0].r, k.r);
    assert.strictEqual(sc.w, 5000); assert.strictEqual(sc.h, 3800); assert.strictEqual(loc.kind, 'gasgiant');
  },
  station(sc, loc) {
    const st = sc.koerper.find((k) => k.art === 'station');
    assert.ok(st && st.landbar && st.beam.range === st.r + 260 && st.beam.range === 320, 'Station mit range 320');
    assert.ok(sc.station && sc.station.x === st.x && sc.station.y === st.y && sc.station.r === st.r && sc.station.kind === 'station');
    assert.ok(sc.koerper.filter((k) => k.art === 'planet').every((k) => !k.landbar));
    assert.strictEqual(loc.kind, 'outpost'); assert.ok(!sc.dock);
  },
  asteroidenfeld(sc, loc) { assert.deepStrictEqual(sc.koerper, []); assert.strictEqual(sc.asteroids, 24); assert.strictEqual(loc.kind, 'asteroids'); assert.strictEqual(sc.planeten.length, 0); },
  grosser_asteroid(sc, loc) {
    assert.strictEqual(sc.koerper.length, 1); const k = sc.koerper[0];
    assert.strictEqual(k.art, 'asteroid'); assert.ok(k.landbar && k.beam.range === k.r + 200 && k.r >= 140 && k.r <= 220); assert.ok(!k.biom);
    assert.ok(sc.asteroids >= 8 && sc.asteroids <= 14); assert.strictEqual(loc.kind, 'asteroids'); assert.strictEqual(sc.planeten.length, 0);
  },
  nebel(sc, loc) { assert.deepStrictEqual(sc.koerper, []); assert.strictEqual(loc.fog, true); assert.strictEqual(loc.kind, 'nebula'); assert.strictEqual(sc.asteroids, 0); },
  wrackfeld(sc, loc) { assert.deepStrictEqual(sc.koerper, []); assert.strictEqual(sc.asteroids, 14); assert.strictEqual(loc.kind, 'asteroids'); },
  leerraum(sc, loc) { assert.deepStrictEqual(sc.koerper, []); assert.strictEqual(sc.asteroids, 0); assert.strictEqual(loc.kind, 'void'); assert.strictEqual(sc.planeten.length, 0); assert.ok(!loc.fog); },
  piratenlager(sc, loc) {
    assert.strictEqual(sc.koerper.length, 1); const k = sc.koerper[0];
    assert.ok(k.art === 'siedlung' && k.landbar && k.beam.range === 320 && k.r === 60); assert.strictEqual(sc.asteroids, 14); assert.ok(!sc.station);
  },
  instabil(sc, loc) { assert.deepStrictEqual(sc.koerper, []); assert.strictEqual(sc.asteroids, 0); assert.strictEqual(sc.planeten.length, 0); assert.ok(!loc.fog); assert.strictEqual(S.typ('instabil').platzhalter, true); },
};
for (const t of TYPEN) pruefe(`Typ ${t}: erwartete Szene über ${HEXE.length} Hexe`, () => {
  assert.ok(ERWARTUNG[t], 'keine Erwartung für ' + t);
  for (const hex of HEXE) {
    const loc = bauen(hex, t), sc = loc.scene;
    assert.strictEqual(sc.typ, t); assert.strictEqual(sc.stern.length, 1); assert.ok(sc.bojen.length >= 2 && sc.bojen.length <= 4, 'Bojen ' + sc.bojen.length);
    grundInvarianten(sc, `${t} ${hex}`);
    ERWARTUNG[t](sc, loc);
    for (const p of sc.planeten) assert.ok(typeof p.art === 'string');
    const kp = sc.koerper.filter((k) => k.art === 'planet');
    kp.forEach((k) => assert.ok(sc.planeten.some((p) => p.x === k.x && p.y === k.y && p.r === k.r && p.art === k.planetenart), 'Planet fehlt in scene.planeten'));
  }
});
pruefe('Station mit andocken: Liegeplatz unterhalb, loc.kind port, Marken wie im alten Pfad', () => {
  for (const hex of HEXE) {
    const loc = bauen(hex, 'station', { andocken: true, hafen: 'B' }), sc = loc.scene;
    assert.deepStrictEqual(sc.dock, { x: sc.station.x, y: sc.station.y + 170 }); assert.strictEqual(loc.kind, 'port'); assert.strictEqual(loc.shop, 'hafen');
    assert.deepStrictEqual(sc.hafen, { klasse: 'B', andocken: true, ruf: false });
    grundInvarianten(sc, 'station+dock ' + hex);
  }
});
pruefe('Szenenbeschreibung nennt landbare Körper (nur typ-Hexe)', () => {
  assert.ok(/Landbar: Planet \((wueste|wiesenwald|vulkan)\)/.test(bauen('0101', 'planet').first));
  assert.ok(bauen('0101', 'nebel').first.includes('Nebel schluckt die Sensoren.'));
  assert.ok(bauen('0101', 'gasriese').first.includes('Ein Gasriese.'));
});

// ---- b) Mehrfach-Typ: zwei Planeten und eine Station ----
const DREI = ['planet', 'planet', 'station'];
pruefe('typ ["planet","planet","station"]: 2 landbare Planeten + Station, Haupttyp bestimmt die Szene, Beams getrennt', () => {
  let geprueft = 0;
  for (const hex of HEXE) {
    const sc = szene(hex, DREI);
    assert.deepStrictEqual(sc.typ, DREI); assert.notStrictEqual(sc.typ, DREI, 'Kopie, nicht dieselbe Liste');
    grundInvarianten(sc, 'drei ' + hex);
    const l = sc.koerper.filter((k) => k.landbar);
    assert.strictEqual(l.length, 3, hex);
    assert.strictEqual(l.filter((k) => k.art === 'planet').length, 2); assert.strictEqual(l.filter((k) => k.art === 'station').length, 1);
    assert.ok(l.every((k) => k.beam.range === (k.art === 'station' ? 320 : k.r + 200)));
    assert.ok(sc.station && sc.station.x === l.find((k) => k.art === 'station').x);
    assert.strictEqual(sc.w, 3000); assert.strictEqual(sc.stern.length, 1); assert.strictEqual(sc.asteroids, 0);
    geprueft++;
  }
  assert.strictEqual(geprueft, HEXE.length);
});
pruefe('Index stabil: koerperVon liefert dieselbe Reihenfolge wie scene.koerper (Art, Planetenart, Biom)', () => {
  for (const hex of HEXE) {
    const kv = G.koerperVon(hex, { typ: DREI }), sc = szene(hex, DREI);
    assert.deepStrictEqual(kv.map((k) => [k.id, k.index, k.art, k.planetenart, k.biom, k.landbar]), sc.koerper.map((k) => [k.id, k.index, k.art, k.planetenart, k.biom, k.landbar]));
  }
});
pruefe('gleiche Planetenart-Verteilung über viele Hexe: alle drei landbaren Arten kommen vor', () => {
  const c = {};
  for (let i = 0; i < 300; i++) { const k = G.koerperVon(String(1000 + i), { typ: 'planet' })[0]; c[k.planetenart] = (c[k.planetenart] || 0) + 1; }
  assert.deepStrictEqual(Object.keys(c).sort(), ['vulkan', 'wiesenwald', 'wueste']);
  for (const a of Object.keys(c)) assert.ok(c[a] > 60, `${a}: ${c[a]}`);
});

// ---- c) Determinismus, Biom-Pins ----
pruefe('gleiche (Hex, typ): Szene zweimal identisch; andere Hexe: andere Lagen', () => {
  for (const hex of HEXE.slice(0, 6)) assert.strictEqual(JSON.stringify(bauen(hex, DREI)), JSON.stringify(bauen(hex, DREI)));
  const lagen = new Set(HEXE.map((h) => JSON.stringify(szene(h, DREI).koerper.map((k) => [k.x, k.y, k.r]))));
  assert.ok(lagen.size >= HEXE.length - 1, 'Lagen verschiedener Hexe gleichen sich: ' + lagen.size);
});
pruefe('getrennter Prozess liefert dieselbe Szene (JSON.stringify gleich)', () => {
  const kind = `const G=require(${JSON.stringify(path.join(ROOT, 'shared/gen-sektor.js'))});const o={};` +
    `for(const h of ${JSON.stringify(HEXE.slice(0, 8))}){o[h]=G.erzeuge(h,{name:'Test '+h,typ:${JSON.stringify(DREI)}});}process.stdout.write(JSON.stringify(o));`;
  const r = spawnSync(process.execPath, ['-e', kind], { encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.strictEqual(r.status, 0, r.stderr);
  const lokal = {}; for (const h of HEXE.slice(0, 8)) lokal[h] = bauen(h, DREI);
  assert.strictEqual(r.stdout, JSON.stringify(lokal));
});
const PINS = [   // (Hex, Index) -> Biom, mit typ ["planet","planet","station"]; ewig stabil
  ['0101', 0, 'vulkan'], ['0101', 3, null], ['0507', 1, 'wueste'], ['0809', 0, 'wiesenwald'],
  ['0809', 1, null], ['0809', 2, 'wueste'], ['3011', 0, 'wiesenwald'], ['3011', 1, 'vulkan'], ['1203', 2, null],
];
pruefe(`biomVon: Pin-Test ${PINS.length} feste (Hex, Index)-Paare`, () => {
  assert.ok(PINS.length >= 6);
  for (const [hex, i, biom] of PINS) assert.strictEqual(G.biomVon(hex, i, { typ: DREI }), biom, `${hex}/${i}`);
});
pruefe('biomVon unabhängig davon, ob die Szene vorher oder nachher gebaut wurde; gleich dem Biom in scene.koerper', () => {
  const vorher = PINS.map(([hex, i]) => G.biomVon(hex, i, { typ: DREI }));
  const szenen = PINS.map(([hex]) => szene(hex, DREI));
  const nachher = PINS.map(([hex, i]) => G.biomVon(hex, i, { typ: DREI }));
  assert.deepStrictEqual(nachher, vorher);
  PINS.forEach(([hex, i, biom], j) => { const k = szenen[j].koerper[i]; assert.strictEqual(k ? k.biom || null : undefined, biom, `${hex}/${i}`); });
  // ... und unabhängig von Szenen-Overrides und Ankunftsdaten
  assert.strictEqual(szene('0101', DREI, { szene: { bojen: 0, sterne: 3 } }).koerper[0].biom, 'vulkan');
});
pruefe('biomVon: Index ausserhalb -> Fehler; Station und nicht landbare Planetenart -> null', () => {
  wirftMit(() => G.biomVon('0101', 9, { typ: DREI }), ['Sektor 0101', 'Index 9']);
  assert.strictEqual(G.biomVon('0101', 2, { typ: DREI }), null);
});

// ---- Katalog über cfg.katalog / setzeKatalog ----
pruefe('Katalog als Parameter (cfg.katalog, setzeKatalog) wie im Browser; setzeKatalog(null) zurück auf den Standard', () => {
  const k = JSON.parse(JSON.stringify(S.katalog()));
  k.typen.push(Object.assign(JSON.parse(JSON.stringify(k.typen.find((t) => t.id === 'leerraum'))), { id: 'testtyp', name: 'Test' }));
  const d = { name: 'T', typ: 'testtyp' };
  wirftMit(() => G.erzeuge('0101', d), ["Sektortyp 'testtyp' unbekannt"]);
  assert.deepStrictEqual(G.erzeuge('0101', d, { katalog: k }).scene.koerper, []);
  assert.strictEqual(G.setzeKatalog(k), true);
  try { assert.deepStrictEqual(G.erzeuge('0101', d).scene.koerper, []); assert.deepStrictEqual(G.koerperVon('0101', d), []); } finally { G.setzeKatalog(null); }
  wirftMit(() => G.erzeuge('0101', d), ["Sektortyp 'testtyp' unbekannt"]);
  wirftMit(() => G.setzeKatalog({ planetenarten: {} }), ['Katalog']);
});
pruefe('Feld szene im Hex-Eintrag gewinnt über den Typ', () => {
  const sc = szene('0101', 'planet', { szene: { bojen: 0, sterne: 2, asteroids: 5, w: 3400 } });
  assert.strictEqual(sc.bojen.length, 0); assert.strictEqual(sc.stern.length, 2); assert.strictEqual(sc.asteroids, 5); assert.strictEqual(sc.w, 3400);
  assert.strictEqual(sc.koerper.filter((k) => k.landbar).length, 1);
});

// ---- d) ohne typ: Szene unverändert ----
pruefe('Hash-Wächter (tools/hash-raumszenen.js --compare) grün: Szenen ohne typ bitgleich', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'hash-raumszenen.js'), '--compare'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(/limes: 80\/80/.test(r.stdout) && /sund: 77\/77/.test(r.stdout) && /sund_frei: 77\/77/.test(r.stdout), r.stdout);
});
pruefe('Szenen aus den drei Karten tragen weder typ noch koerper', () => {
  const Sektoren = require('../shared/sektoren.js'), Locations = require('../shared/locations.js');
  let gen = 0;
  for (const id of H.KARTEN) {
    const doc = JSON.parse(require('fs').readFileSync(path.join(ROOT, 'content', 'welt', id + '.json'), 'utf8'));
    Sektoren.setzeKarte(doc);
    for (const [hex, h] of Object.entries(doc.hexe)) {
      if (!h.gen) continue;
      assert.strictEqual(h.typ, undefined, `${id}/${hex}: Karte trägt schon ein typ`);
      const o = Locations.get(Sektoren.ortVonHex(hex)); gen++;
      assert.ok(o && o.scene && !('typ' in o.scene) && !('koerper' in o.scene), `${id}/${hex}`);
    }
  }
  assert.ok(gen > 20, 'zu wenige generierte Hexe geprüft: ' + gen);
});
pruefe('Mutationsprobe: koerper ohne typ ergänzt -> Hash-Wächter schlägt an', () => {
  const orig = G.erzeuge;
  let ab;
  G.erzeuge = function (hex, daten, cfg) { const o = orig.call(this, hex, daten, cfg); o.scene.koerper = []; return o; };
  try { ab = H.vergleiche(H.berechne(), H.ladeBaseline().karten); } finally { G.erzeuge = orig; }
  assert.ok(ab.length > 20, 'Wächter hat nicht angeschlagen: ' + ab.length);
  assert.deepStrictEqual(H.vergleiche(H.berechne(), H.ladeBaseline().karten), [], 'nach der Probe wieder grün');
});
pruefe('Szene ohne typ: Schlüsselreihenfolge wie vor KAC-01 B', () => {
  const sc = G.erzeuge('0101', { name: 'X', einfluss: 'gas', hafen: 'B', andocken: true }).scene;
  assert.deepStrictEqual(Object.keys(sc), ['w', 'h', 'arrive', 'asteroids', 'field', 'stern', 'planeten', 'bojen', 'station', 'dock', 'hafen']);
});

// ---- e) Fehlermeldungen ----
pruefe('unbekannter Typ im Hex -> Meldung aus Shared_Sektortypen.typ()', () => wirftMit(() => bauen('0101', 'schwarzes_loch'), ["Sektortyp 'schwarzes_loch' unbekannt", 'gueltig:', 'planet']));
pruefe('typ-Liste mit unbekanntem Eintrag (vorn, hinten) -> Meldung nennt den Eintrag', () => {
  wirftMit(() => bauen('0101', ['planet', 'mond']), ["Sektortyp 'mond' unbekannt"]);
  wirftMit(() => bauen('0101', ['mond', 'planet']), ["Sektortyp 'mond' unbekannt"]);
  wirftMit(() => G.koerperVon('0101', { typ: ['planet', 'mond'] }), ["Sektortyp 'mond' unbekannt"]);
  wirftMit(() => G.biomVon('0101', 0, { typ: ['x'] }), ["Sektortyp 'x' unbekannt"]);
});
pruefe('typ null / leer / leere Liste / Nicht-String -> klare Meldung', () => {
  wirftMit(() => bauen('0101', null), ['Sektortyp fehlt']);
  wirftMit(() => bauen('0101', ''), ['Sektortyp fehlt']);
  wirftMit(() => bauen('0101', []), ['Sektor 0101', 'leere Liste']);
  wirftMit(() => bauen('0101', 7), ["Sektortyp '7' unbekannt"]);
});
pruefe('zwei Stationen in einem Hex -> Fehler (die Szene kennt eine)', () => wirftMit(() => bauen('0101', ['station', 'station']), ['Sektor 0101', 'mehr als eine Station']));
pruefe('Körper ohne mögliche Lage -> Fehler statt größerer Szene (Gasriese als Zweittyp in 3000x2200)', () => {
  let meldung = null;
  for (let i = 0; i < 40 && !meldung; i++) { try { bauen(String(1000 + i), ['planet', 'gasriese']); } catch (e) { meldung = e.message; } }
  assert.ok(meldung, 'kein Hex ohne Lage gefunden');
  ['findet keine Lage', '3000x2200', 'gasriese'].forEach((t) => assert.ok(meldung.includes(t), meldung));
});

// ---- f) Szenenbudget ----
pruefe('Szenenbudget: Größe von JSON.stringify(scene) und Dauer von erzeuge über alle Typ-Kombinationen x 200 Hexe', () => {
  const kombis = [];
  for (const a of TYPEN) { kombis.push(a); for (const b of TYPEN) kombis.push([a, b]); }
  kombis.push(DREI);
  const hexe = Array.from({ length: 200 }, (_, i) => String(1000 + i * 13));
  let maxB = 0, maxBK = '', maxMs = 0, maxMsK = '', ok = 0, unloesbar = 0, einzelFehler = 0;
  const bad = {};
  for (const k of kombis) for (const hex of hexe) {
    const dock = Number(hex) % 2 === 0;   // halb mit, halb ohne Liegeplatz
    const t0 = process.hrtime.bigint();
    let o;
    try { o = G.erzeuge(hex, { name: 'B', typ: k, andocken: dock }); } catch (e) { unloesbar++; bad[JSON.stringify(k)] = (bad[JSON.stringify(k)] || 0) + 1; if (typeof k === 'string') einzelFehler++; continue; }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6, b = JSON.stringify(o.scene).length;
    ok++;
    if (b > maxB) { maxB = b; maxBK = JSON.stringify(k); }
    if (ms > maxMs) { maxMs = ms; maxMsK = JSON.stringify(k); }
  }
  const schlimm = Object.entries(bad).filter(([, v]) => v > 8).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}:${v}`).join(' ');
  console.log(`  Budget: ${ok} Szenen, max ${maxB} Zeichen JSON (${maxBK}), max ${maxMs.toFixed(1)} ms (${maxMsK}); ohne Lage ${unloesbar} von ${ok + unloesbar} (häufigste: ${schlimm})`);
  assert.strictEqual(einzelFehler, 0, 'ein einzelner Typ findet keine Lage');
  assert.ok((bad[JSON.stringify(DREI)] || 0) <= 2 * 200 * 0.02, 'planet,planet,station zu oft ohne Lage: ' + bad[JSON.stringify(DREI)]);
  assert.ok(maxB < 12000, 'Szene zu groß: ' + maxB);
  assert.ok(maxMs < 250, 'erzeuge zu langsam: ' + maxMs);
});

console.log(`\n${n - fehler}/${n} Prüfungen grün`);
process.exit(fehler ? 1 : 0);
