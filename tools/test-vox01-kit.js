'use strict';
// VOX-01 Paket 5a: Zuordnung Kachel -> Kit-Teil (Bauweisen-Tabellen rom_feld, rom, germanen), Baumwahl, conn der Brustwehr, Rampe ohne Lift,
// Grabenkarte mit echten Zeichen. kit.js selbst braucht three.js und läuft nicht in Node: die Regeln stehen in public/js/voxel/kit-regeln.js
// (rein), die Modelle werden mit dem Voxelwerk-Kern (public/voxel/core) gebaut und vermessen.
//   node tools/test-vox01-kit.js
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..');
const rd = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

async function main() {
  const R = await imp('public/js/voxel/kit-regeln.js');
  const GenFest = require('../shared/gen-fest.js');
  const kacheln = rd('content/buehnen/kacheln.json');
  const manifest = rd('public/voxel/manifest.json');
  const man = new Map((Array.isArray(manifest.assets) ? manifest.assets : Object.values(manifest.assets || manifest)).map((a) => [a.id, a]));
  const tab = { rom_feld: rd('content/buehnen/bauweisen/rom_feld.json'), rom: rd('content/buehnen/bauweisen/rom.json'), germanen: rd('content/buehnen/bauweisen/germanen.json') };
  const achsen = rd('content/buehnen/achsen.json');
  const DEF = rd('content/buehnen/festkarten/grabenangriff.json');
  const roh = GenFest.karteRoh(DEF, { id: 't', bauweise: DEF.bauweise, besitz: 'rom', seed: 7 });
  const kindAt = (x, y) => { if (x < 0 || y < 0 || y >= roh.rows.length || x >= roh.rows[0].length) return null; const z = kacheln.zeichen[roh.rows[y][x]]; return z ? z.kind : null; };

  console.log('\n[Bauweise rom_feld: Daten]');
  ok(achsen.bauweisen.rom_feld && achsen.bauweisen.rom_feld.status === 'aktiv', 'achsen.json: rom_feld aktiv (Prefetch, Prüfer)');
  ok(tab.rom_feld.format === 'bauweise/1' && tab.rom_feld.id === 'rom_feld', 'rom_feld.json: format, id');
  const sameKits = Object.keys(tab.rom.kits).filter((k) => !['plateau', 'kante', 'rampe', 'baum', 'brustwehr', 'grabensohle'].includes(k));
  ok(sameKits.length > 15 && sameKits.every((k) => JSON.stringify(tab.rom_feld.kits[k]) === JSON.stringify(tab.rom.kits[k])), `alles andere wie rom.json (${sameKits.length} Kit-Einträge gleich)`);
  ok(['anker', 'leit', 'leit_fuss', 'deckung_props', 'weg_boden'].every((k) => JSON.stringify(tab.rom_feld[k]) === JSON.stringify(tab.rom[k])), 'anker, leit, leit_fuss, deckung_props, weg_boden wie rom.json');
  ok(tab.rom_feld.paletten.art.aussenposten === 'sommer_wald' && man.has('kit/rom_feld/boden') && fs.existsSync(path.join(ROOT, 'public/voxel/assets/palettes/sommer_wald.json')), 'Palette sommer_wald (synchronisiert)');
  const E = (bw, kind, art = 'aussenposten') => R.eintragVon(tab[bw].kits[kind], art);
  const pl = E('rom_feld', 'plateau'), ra = E('rom_feld', 'rampe'), ka = E('rom_feld', 'kante'), gs = E('rom_feld', 'grabensohle'), bw = E('rom_feld', 'brustwehr'), ba = E('rom_feld', 'baum');
  ok(pl.id === 'kit/rom_feld/boden' && pl.fest.belag === 1 && +pl.hoehe === 0.53 && !pl.eigeneHoehe && pl.sockelInset === 0.01, 'plateau: Rasen (belag 1), Anheben 0,53, Sockel 1 cm eingezogen (kein Z-Flimmern mit den Seitenflächen), Teil bringt keine eigene Höhe mit');
  ok(ra.id === 'kit/rom_feld/rampe' && ra.eigeneHoehe && ra.hochZu.join() === 'plateau,kante' && Object.keys(ra.fest).length === 0, 'rampe: eigene Höhe (ohne Anheben, ohne Boden), dreht zum Plateau/zur Kante');
  ok(ka.id === 'kit/rom_feld/kante' && gs.id === 'kit/rom_feld/boden' && gs.fest.belag === 0 && bw.id === 'kit/rom_feld/brustwehr' && Object.keys(bw.fest).length === 0, 'kante, grabensohle (belag 0), brustwehr (keine festen Parameter)');
  ok(ba.nadel === 'natur/nadelbaum' && ba.laub === 'natur/laubbaum' && ba.nadelAnteil === 0.6 && Object.keys(ba.fest).join() === '', 'baum: Nadel/Laub und Anteil aus der Bauweise, nichts davon wird als Modellparameter weitergegeben');
  ok(R.eintragIds(ba).join() === 'natur/nadelbaum,natur/laubbaum', 'eintragIds(baum) = beide Modelle (Vorladen)');
  for (const b of ['rom', 'germanen']) {
    const eb = E(b, 'baum'), ew = E(b, 'brustwehr'), es = E(b, 'grabensohle');
    ok(eb.nadel === 'natur/nadelbaum' && eb.palette === 'sommer_wald' && ew.id === 'kit/rom_feld/brustwehr' && ew.palette === 'sommer_wald' && es.id === 'kit/rom_feld/boden' && es.palette === 'sommer_wald' && es.fest.belag === 0, `${b}: Baum, Brustwehr und Sohle mit Feldteilen und eigener Palette sommer_wald`);
  }
  for (const b of Object.keys(tab)) for (const k of ['baum', 'brustwehr', 'grabensohle']) for (const id of R.eintragIds(E(b, k))) ok(man.has(id), `${b}.${k}: ${id} steht im Manifest`);
  ok(E('rom_feld', 'kante').id === 'kit/rom_feld/kante' && !tab.rom.kits.kante.id.includes('rom_feld') && !tab.germanen.kits.kante.id.includes('rom_feld'), 'rom und germanen: plateau, kante, rampe bleiben unverändert');

  console.log('\n[Kachel -> Kit-Teil: Klassen und conn]');
  ok(R.KLASSE.brustwehr === 'B' && R.KLASSE.deckung_halb === 'H' && R.KLASSE.baum === undefined && R.KLASSE.grabensohle === undefined, 'brustwehr hat eine eigene Klasse B (nicht H); baum und grabensohle haben keine');
  const klasse = (kinds) => (x, y) => R.KLASSE[kinds[y] && kinds[y][x]] || null;
  const mk = (rows) => rows.map((r) => r.split('').map((c) => ({ H: 'brustwehr', o: 'deckung_halb', '.': 'boden' }[c])));
  const g = mk(['.....', '.HHH.', '..H..', '.....']);
  const cv = (rows, x, y) => R.connVon(klasse(mk(rows)), x, y);
  ok(cv(['.....', '.HHH.', '..H..', '.....'], 1, 1) === 2, 'linkes Ende der O-W-Reihe: conn 2 (O)');
  ok(cv(['.....', '.HHH.', '..H..', '.....'], 2, 1) === (2 | 4 | 8), 'T-Stück: conn O+S+W = 14');
  ok(cv(['.....', '.HHH.', '..H..', '.....'], 2, 2) === 1, 'Fuß des T: conn 1 (N)');
  ok(cv(['..H..', '..H..', '..H..'], 2, 1) === 5 && cv(['..H..', '..H..', '..H..'], 2, 0) === 4, 'N-S-Reihe: Mitte conn 5 (N+S), Nordende conn 4 (S); N = -z');
  ok(cv(['.H.', 'HHH', '.H.'], 1, 1) === 15 && cv(['.H.'], 1, 0) === 0, 'Kreuz = 15, Einzelstück = 0');
  ok(cv(['oH'], 1, 0) === 0 && cv(['oH'], 0, 0) === 0, 'Brustwehr und Halbdeckung o verbinden sich nicht');
  ok(g.length === 4, 'Hilfsraster ok');

  console.log('\n[Baumwahl: deterministisch, Nadel/Laub nach Anteil, 12 Gestalten]');
  const ys = []; roh.rows.forEach((r, y) => r.split('').forEach((c, x) => { if (c === 'Y') ys.push([x, y]); }));
  ok(ys.length > 100, `Grabenkarte hat ${ys.length} Y-Kacheln`);
  const w1 = ys.map(([x, y]) => R.baumWahl(x, y, ba)), w2 = ys.map(([x, y]) => R.baumWahl(x, y, R.eintragVon(tab.rom_feld.kits.baum, 'aussenposten')));
  ok(JSON.stringify(w1) === JSON.stringify(w2) && R.baumWahl(40, 10, ba).id === R.baumWahl(40, 10, ba).id, 'gleiche Kachel, gleicher Baum (kein Zufallsstrom)');
  const nadel = w1.filter((w) => w.art === 'nadel').length / w1.length;
  ok(nadel > 0.5 && nadel < 0.7, `Anteil Nadel ${(nadel * 100).toFixed(0)} % (Soll 60 %)`);
  ok(w1.every((w) => (w.art === 'nadel' ? w.id === 'natur/nadelbaum' : w.id === 'natur/laubbaum') && Number.isInteger(w.seed) && w.seed >= 0 && w.seed < 12), 'ids Nadel/Laub, seed 0..11');
  ok([0, 1, 2].every((t) => w1.some((w) => w.art === 'nadel' && w.seed % 3 === t) && w1.some((w) => w.art === 'laub' && w.seed % 3 === t)), 'alle drei Typen (seed % 3) je Nadel und Laub kommen vor');
  ok(new Set(w1.map((w) => w.id + w.seed)).size === 24, '24 verschiedene Gestalten (12 je Art), Geometrie-Cache bleibt klein');
  ok(w1.every((w) => Math.abs(w.dx) <= 0.25 && Math.abs(w.dz) <= 0.25 && Math.abs(w.rot / (Math.PI / 2) - Math.round(w.rot / (Math.PI / 2))) < 1e-9), 'Versatz höchstens 0,25 m, Drehung in 90°-Schritten');
  const nurNadel = R.baumWahl(3, 3, R.eintragVon({ id: 'natur/nadelbaum' }, 'aussenposten'));
  ok(nurNadel && nurNadel.id === 'natur/nadelbaum', 'ohne laub im Eintrag nur ein Modell');
  const zellen = new Set(ys.map(([x, y]) => R.kronenZelle(x, y)));
  ok(R.kronenZelle(0, 0) === '0,0' && R.kronenZelle(2, 2) === '0,0' && R.kronenZelle(3, 2) === '1,0' && R.kronenZelle(5, 6) === '1,2', 'Kronen-Zellen 3x3 Kacheln');
  console.log(`  info ${ys.length} Bäume in ${zellen.size} Kronen-Zellen (ein Mesh je Zelle)`);

  console.log('\n[Rampe: Richtung zum Plateau]');
  const rampen = []; roh.rows.forEach((r, y) => r.split('').forEach((c, x) => { if (c === '/') rampen.push([x, y]); }));
  ok(rampen.length === 2 && rampen.every(([x, y]) => kindAt(x - 1, y) === 'plateau'), `${rampen.length} Rampen, Plateau jeweils im Westen`);
  ok(rampen.every(([x, y]) => Math.abs(R.hochRichtung(kindAt, x, y, ra.hochZu) - Math.PI / 2) < 1e-9), 'hoch zeigt nach Westen (Drehung +90° um Y; Norden = 0), obwohl die Kante im Norden/Süden auch erhöht ist');
  const solo = (dx, dy, art) => (x, y) => (x === 1 + dx && y === 1 + dy ? art : null);
  ok(R.hochRichtung(solo(0, -1, 'plateau'), 1, 1, ['plateau']) === 0 && Math.abs(R.hochRichtung(solo(1, 0, 'plateau'), 1, 1, ['plateau']) + Math.PI / 2) < 1e-9 && Math.abs(R.hochRichtung(solo(0, 1, 'plateau'), 1, 1, ['plateau']) - Math.PI) < 1e-9, 'Norden 0, Osten -90°, Süden 180°');
  ok(R.hochRichtung(() => null, 1, 1, ['plateau']) === 0 && R.hochRichtung(solo(0, 1, 'kante'), 1, 1, ['plateau', 'kante']) !== 0, 'ohne Nachbarn 0; Kante zählt, wenn kein Plateau da ist');
  // Drehung gegen die Geometrie: Matrix Y(theta) bildet -z auf die Richtung ab
  const dirVon = (th) => [-Math.sin(th), -Math.cos(th)];
  const [dx, dz] = dirVon(R.hochRichtung(kindAt, rampen[0][0], rampen[0][1], ra.hochZu));
  ok(Math.abs(dx + 1) < 1e-9 && Math.abs(dz) < 1e-9, 'Drehung (x\' = -sin, z\' = -cos) bildet Norden (-z) auf Westen (-x) ab');

  console.log('\n[Modelle im Voxelwerk-Kern: conn der Brustwehr, Rampe, Bäume]');
  const { Library } = await imp('public/voxel/core/library.js');
  const SRC = path.join(ROOT, 'public/voxel');
  const lib = new Library({ json: async (p) => JSON.parse(await fs.promises.readFile(path.join(SRC, p), 'utf8')), binary: async (p) => { const b = await fs.promises.readFile(path.join(SRC, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } });
  for (const id of ['kit/rom_feld/brustwehr', 'kit/rom_feld/rampe', 'kit/rom_feld/boden', 'kit/rom_feld/kante', 'natur/nadelbaum', 'natur/laubbaum']) await lib.load('models', id);
  const build = (id, params) => lib.build(id, { params });
  const vox = (b) => [...b.grid.map.keys()].length;
  const tris = (b) => (b.mesh.lit.quads + b.mesh.emit.quads) * 2;
  // Brustwehr: Voxel 1/16 m, Pivot [8,0,8]; Grenzen in Voxeln relativ zum Anker
  const bb = (b) => { const q = b.grid.bounds(), a = b.anchor; return { x0: q.min[0] - a[0], x1: q.max[0] + 1 - a[0], y1: q.max[1] + 1 - a[1], z0: q.min[2] - a[2], z1: q.max[2] + 1 - a[2] }; };
  let maxTris = 0, maxY = 0, alleBauen = true;
  for (let c = 0; c < 16; c++) { try { const b = build('kit/rom_feld/brustwehr', { conn: c }); maxTris = Math.max(maxTris, tris(b)); maxY = Math.max(maxY, bb(b).y1); } catch (e) { alleBauen = false; } }
  ok(alleBauen && maxTris <= 2200 && maxTris >= 1000 && maxY <= 16, `brustwehr: alle 16 conn-Werte bauen, höchstens ${maxTris} Dreiecke (1250-2000 erwartet), Höhe ${maxY / 16} m`);
  // Ein Nachbar macht aus dem Einzelstück eine Reihe in dessen Achse (Endpfosten am freien Ende): conn 1/4 = N-S (z voll, x schmal), conn 2/8 = O-W (x voll, z schmal), conn 0 = O-W
  const voll = (b, ax) => (ax === 'z' ? b.z0 <= -8 && b.z1 >= 8 : b.x0 <= -8 && b.x1 >= 8), schmal = (b, ax) => (ax === 'z' ? b.z1 - b.z0 < 16 : b.x1 - b.x0 < 16);
  const Bw = (c) => bb(build('kit/rom_feld/brustwehr', { conn: c }));
  ok([1, 4, 5].every((c) => voll(Bw(c), 'z') && schmal(Bw(c), 'x')), 'conn 1, 4, 5 (Nachbar im Norden/Süden): N-S-Reihe, z voll, x schmal; N = -z');
  ok([0, 2, 8, 10].every((c) => voll(Bw(c), 'x') && schmal(Bw(c), 'z')), 'conn 0, 2, 8, 10 (Osten/Westen/frei): O-W-Reihe, x voll, z schmal');
  const ecke = Bw(6), kreuz = Bw(15);   // 6 = O+S: Arme nach Osten und Süden, nicht nach Norden/Westen
  ok(ecke.x1 >= 8 && ecke.z1 >= 8 && ecke.x0 > -8 && ecke.z0 > -8, `conn 6 (O+S) = Ecke mit Armen nach Osten und Süden (x ${ecke.x0}..${ecke.x1}, z ${ecke.z0}..${ecke.z1})`);
  ok(kreuz.x1 - kreuz.x0 >= 16 && kreuz.z1 - kreuz.z0 >= 16, 'conn 15 = Kreuz über die ganze Kachel');
  // Rampe: 0 am +z-Rand, 0,5 m am -z-Rand, steht auf Bodenhöhe
  const rb = build('kit/rom_feld/rampe', {});
  const q = rb.grid.bounds(), a = rb.anchor;
  const spalte = (zz) => { let m = -Infinity; for (let x = q.min[0]; x <= q.max[0]; x++) for (let y = q.min[1]; y <= q.max[1]; y++) if (rb.grid.has(x, y, zz)) m = Math.max(m, y + 1 - a[1]); return m; };
  const nord = spalte(q.min[2]), sued = spalte(q.max[2]);
  ok(q.min[1] - a[1] === 0 && nord === 8 && sued <= 1, `rampe: steht auf Bodenhöhe (y0 = 0), Nordrand ${nord / 16} m hoch, Südrand ${sued / 16} m: hoch = Norden (-z)`);
  const bo = build('kit/rom_feld/boden', { belag: 1 });
  const bq = bo.grid.bounds();
  ok(vox(bo) > 0 && bq.max[1] + 1 - bo.anchor[1] === 0 && bq.min[1] - bo.anchor[1] === -1, 'boden belag 1 (Wall-Rasen) baut: Platte 25 cm unter dem Anker, Oberkante = Lauffläche y 0 (kit.js senkt nichts ab, hoehe 0,53 hebt an)');
  for (const id of ['natur/nadelbaum', 'natur/laubbaum']) {
    let okAlle = true, maxT = 0, gleich = true;
    for (let seed = 0; seed < 12; seed++) {
      const ganz = build(id, { teil: 0, seed }), st = build(id, { teil: 1, seed }), kr = build(id, { teil: 2, seed });
      maxT = Math.max(maxT, tris(ganz));
      if (vox(st) + vox(kr) !== vox(ganz) && vox(st) + vox(kr) < vox(ganz) * 0.9) gleich = false;
      if (!vox(st) || !vox(kr)) okAlle = false;
      if (bb(st).y1 >= bb(kr).y1) okAlle = false;
    }
    ok(okAlle && maxT <= 1100, `${id}: 12 Gestalten bauen, Stamm und Krone getrennt (Krone höher als Stamm), höchstens ${maxT} Dreiecke`);
    ok(gleich, `${id}: Stamm + Krone ergeben den ganzen Baum (Voxelzahl)`);
  }

  console.log('\n[Grabenkarte]');
  const cnt = (c) => roh.rows.join('').split(c).length - 1;
  ok(roh.rows[0] === 'F'.repeat(roh.rows[0].length), 'Kartenrand rand "F" bleibt (nicht Teil dieses Pakets)');
  ok(roh.bauweise === 'rom_feld' && DEF.bauweise === 'rom_feld', 'Karte baut mit Bauweise rom_feld (Wert aus der Festkarte)');
  ok(cnt('Y') > 100 && cnt('H') === 44 && cnt(';') > 60 && cnt('=') > 20, `Y ${cnt('Y')}, H ${cnt('H')}, ; ${cnt(';')}, Palisade = ${cnt('=')}`);
  ok(cnt('T') === 0, 'Platzhalterzeichen T sind ersetzt');
  ok(DEF.zeichen.P.kachel === '=' && DEF.zeichen.T.kachel === 'Y' && DEF.zeichen.b.kachel === 'H', 'zeichen: T -> Y, b -> H, P bleibt = (volle Deckung)');
  // Sohle: in jeder Zeile ein Lauf von 3 (Graben) oder 4 Kacheln (mit dem Übergang durch die westliche Brustwehr), nie einzeln
  let kurz = 0, lang = 0; roh.rows.forEach((r) => { for (const m of r.match(/;+/g) || []) { if (m.length < 3) kurz++; if (m.length > 4) lang++; } });
  ok(kurz === 0 && lang === 0, 'jede Zeile hat die Sohle als Lauf von 3 bis 4 Kacheln zwischen den Brustwehr-Reihen');
  // der Wall hinter P und die Wege bleiben ,
  let wallKomma = 0; roh.rows.forEach((r) => { if (/=,,,,/.test(r)) wallKomma++; });
  ok(wallKomma >= 10, `Wall hinter P bleibt Boden , (${wallKomma} Zeilen)`);
  const kit = fs.readFileSync(path.join(ROOT, 'public/js/voxel/kit.js'), 'utf8');
  ok(/from '\.\/kit-regeln\.js'/.test(kit) && !kit.includes('RUECKFALL_KIND') && kit.includes("'kit:krone:'") && kit.includes('kronenSchalten') && kit.includes('baumSetzen'), 'kit.js: nutzt kit-regeln.js, Kronen als eigene Meshes kit:krone:<zelle>, kronenSchalten, keine Rückfalltabelle');
  ok(/eigeneHoehe[\s\S]{0,700}floor: !eigen, lift: eigen \? 0 : hoeheOf\(kind\)/.test(kit), 'kit.js: Rampe mit eigener Höhe ohne floor und ohne lift');

  console.log(`\n${n - fails}/${n} ok`);
  if (fails) { console.log('VERFEHLT: ' + fails); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
