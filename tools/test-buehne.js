#!/usr/bin/env node
'use strict';
// Tests Team BUEHNE (CONTRACT-B1 §2–§6): Determinismus (Node und UMD-Browserpfad), Kantenableitung inkl. W13/W14,
// Prüfcodes an Testmodulen, Zusammenbau, Überzug, Handkarten, Landepunkte, Anker-Laufzeit.
// Testdaten: tools/fixtures/buehne (nie content/buehnen/<art>/).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Buehne = require('../shared/buehne.js');

let n = 0, bad = 0;
function ok(cond, text) { n++; if (!cond) { bad++; console.log('  FEHLER ' + text); } else if (process.env.VERBOSE) console.log('  ok   ' + text); }
function abschnitt(t) { console.log('[' + t + ']'); }
const FIX = path.join(__dirname, 'fixtures', 'buehne');
const DFIX = Buehne.ladeVerzeichnis(FIX);
const OPT = { daten: DFIX };
const codes = (pr) => new Set(pr.fehler.map((f) => f.code));
const klon = (o) => JSON.parse(JSON.stringify(o));

// ---------------- PRNG ----------------
abschnitt('PRNG');
{
  const a = Buehne.rng(42), b = Buehne.rng(42);
  const xs = [a(), a(), a()], ys = [b(), b(), b()];
  ok(JSON.stringify(xs) === JSON.stringify(ys), 'rng(42) reproduzierbar');
  ok(xs.every((x) => Number.isInteger(x) && x >= 0 && x < 2 ** 32), 'rng liefert uint32');
  ok(Buehne.rng(42)() !== Buehne.rng(43)(), 'anderer Seed, andere Folge');
  ok(Buehne.rng('ruine.test')() === Buehne.rng('ruine.test')(), 'Text-Seed reproduzierbar');
  const r = Buehne.rng(7); let lo = Infinity, hi = -1;
  for (let i = 0; i < 1000; i++) { const v = r.int(6); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  ok(lo === 0 && hi === 5, 'int(6) deckt 0..5 ab');
}

// ---------------- Kanten (§3.2, W13, W14) ----------------
abschnitt('Kanten');
{
  const seg = (s) => Buehne.segmentTyp(s.split(''), OPT);
  ok(seg('........') === 'frei', 'ganz begehbar -> frei');
  ok(seg('##......') === 'frei', 'W14: 6 von 8 begehbar, Mitte frei -> frei');
  ok(seg('......##') === 'frei', 'W14: 6 von 8 (rechts fest) -> frei');
  ok(seg('###.....') === 'offen', '5 von 8, Mitte frei -> offen');
  ok(seg('###..###') === 'offen', 'nur Mitte -> offen');
  ok(seg('...##...') === 'wand', 'Mitte fest -> wand');
  ok(seg('....#...') === 'wand', 'eine Mittelkachel fest -> wand');
  ok(seg('###DD###') === 'tuer', 'Tür in der Mitte -> tuer');
  ok(seg('...S....') === 'tuer', 'eine Mittelkachel Schott -> tuer');
  ok(seg('##.GG.##') === 'tuer', 'Tor -> tuer');
  ok(seg('###LL###') === 'tuer', 'Luke -> tuer');
  ok(seg('.o.::.,.') === 'frei', 'Deckung am Rand: 7 begehbar -> frei');
  ok(seg('ww......') === 'frei', 'schwache Wand zählt fest, 6 begehbar -> frei');
  ok(seg('.^^^^^^.') === 'frei', 'Plateau begehbar');
  const rows = ['###DD###', '#......#', '#......#', '.......#', '.......#', '#......#', '#......#', '########'];
  ok(Buehne.kantenTyp(rows, 'N', 0, OPT) === 'tuer', 'kantenTyp N tuer');
  ok(Buehne.kantenTyp(rows, 'S', 0, OPT) === 'wand', 'kantenTyp S wand');
  ok(Buehne.kantenTyp(rows, 'W', 0, OPT) === 'offen', 'kantenTyp W offen (2 begehbar)');
  ok(Buehne.kantenTyp(rows, 'O', 0, OPT) === 'wand', 'kantenTyp O wand');
  const r2 = ['........'.repeat(2)].concat(Array(15).fill('#'.repeat(16)));
  ok(Buehne.kantenTyp(r2, 'N', 1, OPT) === 'frei', 'kantenTyp zweite Zelle N');
  // Verträglichkeit (W13 + offen↔frei)
  const V = Buehne.vertraeglich;
  ok(V('wand', 'frei') && V('frei', 'wand'), 'W13 wand↔frei');
  ok(V('tuer', 'frei') && V('frei', 'tuer'), 'W13 tuer↔frei');
  ok(V('offen', 'frei') && V('frei', 'offen'), 'offen↔frei');
  ok(V('offen', 'tuer') && V('tuer', 'tuer') && V('offen', 'offen') && V('wand', 'wand') && V('frei', 'frei'), 'Grundfälle');
  ok(!V('wand', 'offen') && !V('offen', 'wand') && !V('wand', 'tuer') && !V('tuer', 'wand'), 'wand↔offen/tuer unverträglich');
}

// ---------------- Lagen ----------------
abschnitt('Lagen');
{
  const m = DFIX.module.find((q) => q.id === 'ruine.raum.a');
  const L = Buehne.modulLagen(m, OPT);
  ok(L.length === 8, `Raum: 8 verschiedene Lagen (ist ${L.length})`);
  const tuerSeite = (l) => Object.keys(l.kanten).find((s) => l.kanten[s][0] === 'tuer');
  ok(Array.from(new Set(L.map(tuerSeite))).sort().join('') === 'NOSW', 'Tür liegt je nach Lage auf allen vier Seiten');
  ok(L.find((l) => l.rot === 0).aussen === 'N' && L.find((l) => l.rot === 1).aussen === 'O', 'Außenkante folgt der Drehung (r0 N, r1 O)');
  const t = Buehne.modulLagen(DFIX.module.find((q) => q.id === 'ruine.tor.a'), OPT);
  const r2 = t.find((l) => l.rot === 2 && !l.spiegel);
  ok(r2.rows[6] === '###GG###' && r2.anker[7][5] === 'e', 'Drehung 180° bewegt Zeilen und Ankerebene gemeinsam');
  const f = Buehne.modulLagen(DFIX.module.find((q) => q.id === 'ruine.feld.a'), OPT);
  ok(f.length === 8 && f.every((l) => l.belegungen.length === 2), 'Feld: 8 Lagen, Belegungen mittransformiert');
  ok(Buehne.modulLagen(DFIX.module.find((q) => q.id === 'ruine.feld.b'), OPT).length === 4, 'spiegeln:false -> nur 4 Drehungen');
  // symmetrisches Modul: Entdoppeln behält je Außenkante eine Lage (richtung S muss passen)
  const sym = { format: 'modul/1', id: 'ruine.sym.a', art: 'ruine', typ: 'sym', groesse: [1, 1], drehen: true, spiegeln: true,
    rows: Array(8).fill('........'), anker: Array(8).fill('........'), anker_legende: {} };
  const ls = Buehne.modulLagen(sym, Object.assign({ ohneCache: true }, OPT));
  ok(ls.length === 4 && ['N', 'O', 'S', 'W'].every((s) => ls.some((l) => l.aussen === s)), `symmetrisch: eine Lage je Außenkante (${ls.map((l) => l.aussen).join('')})`);
}

// ---------------- Modulprüfung (Prüfcodes an Testmodulen) ----------------
abschnitt('Modulprüfung');
{
  for (const m of DFIX.module) ok(Buehne.pruefeModul(m, OPT).ok, `Fixture ${m.id} gültig`);
  const basis = klon(DFIX.module.find((q) => q.id === 'ruine.raum.a'));
  const mit = (f) => { const m = klon(basis); f(m); return codes(Buehne.pruefeModul(m, OPT)); };
  ok(mit((m) => { m.rows[2] = '#.....#'; }).has('K-RASTER'), 'K-RASTER: Zeile zu kurz');
  ok(mit((m) => { m.rows[2] = '#..Q...#'; }).has('K-RASTER'), 'K-RASTER: unbekanntes Zeichen');
  ok(mit((m) => { m.rows[2] = '#..x...#'; }).has('K-RASTER'), 'K-RASTER: Überzugszeichen im Modul');
  ok(mit((m) => { m.groesse = [3, 1]; }).has('K-RASTER'), 'K-RASTER: Modulgröße');
  ok(mit((m) => { m.anker[2] = '..t..q..'; }).has('K-RASTER'), 'K-RASTER: Ankerzeichen ohne Legende');
  ok(mit((m) => { m.anker[0] = 't.......'; }).has('K-ANKER-WAND'), 'K-ANKER-WAND: Terminal auf Wand');
  ok(mit((m) => { m.anker[7] = '...k....'; }).has('K-ANKER-WAND'), 'K-ANKER-WAND: Beute auf Tür');
  ok(mit((m) => { m.rows[3] = '........'; m.rows[4] = '........'; m.anker[3] = 't.......'; }).has('K-ANKER-WAND'), 'K-ANKER-WAND: Objekt in der Kantenmitte');
  ok(mit((m) => { m.rows[1] = '#o.....#'; m.rows[2] = '#.o....#'; m.anker[1] = '........'; m.anker[2] = '.t......'; m.rows[3] = '#o.....#'; }).has('K-ANKER-WAND'), 'K-ANKER-WAND: Objekt ohne begehbaren Nachbarn');
  ok(mit((m) => { m.rows[3] = '#..^...#'; }).has('K-PLATEAU'), 'K-PLATEAU: ^ neben Boden');
  ok(!mit((m) => { m.rows[2] = '#.kkk..#'; m.rows[3] = '#.k^k..#'; m.rows[4] = '#.k/k..#'; m.anker[2] = '........'; m.anker[1] = '..t..k..'; }).has('K-PLATEAU'), 'Plateau mit Kante und Rampe gültig');
  ok(mit((m) => { m.anker[4] = '..r.....'; m.anker_legende.r = { rolle: 'raetsel', paar: 'A' }; }).has('K-PAAR'), 'K-PAAR: Paar im Modul unvollständig');
  ok(mit((m) => { m.rows[1] = '#.#....#'; m.rows[2] = '#####..#'; m.anker[1] = '.a......'; m.anker[2] = '.....k..'; m.anker_legende.a = { rolle: 'abholpunkt' }; }).has('K-ABHOLPUNKT'), 'K-ABHOLPUNKT: keine L-Fläche');
  ok(mit((m) => { m.anker_legende.t.rolle = 'gibtsnicht'; }).has('K-RASTER'), 'K-RASTER: unbekannte Rolle');
  ok(mit((m) => { m.belegungen = [['........', '.X......', '........', '........', '........', '........', '........', '........']]; }).has('K-RASTER'), 'K-RASTER: Belegung mit falschem Zeichen');
  ok(!mit((m) => { m.anker[7] = '...g....'; m.anker_legende.g = { rolle: 'tor' }; }).size, 'tor darf auf der Tür stehen');
  // Objektanker zerschneiden das Modul (Raum durch eine Querwand mit Lücke geteilt, Terminal in der Lücke)
  ok(mit((m) => { m.rows[4] = '###.####'; m.anker[2] = '.....k..'; m.anker[4] = '...t....'; }).has('K-ERREICHBAR'), 'K-ERREICHBAR: Objektanker trennt das Modul');
  ok(!mit((m) => { m.rows[4] = '###..###'; m.anker[2] = '.....k..'; m.anker[4] = '...t....'; }).has('K-ERREICHBAR'), 'Lücke 2 breit: Objekt trennt nicht');
  ok(!mit((m) => { m.rows[4] = '###.####'; m.anker[2] = '.....k..'; m.anker[4] = '...z....'; m.anker_legende.z = { rolle: 'zelle' }; }).has('K-ERREICHBAR'), 'zelle darf abtrennen (Gefangenenraum)');
}

// ---------------- Zusammenbau + Determinismus ----------------
abschnitt('Zusammenbau');
let K1 = null;
{
  const o = { daten: DFIX, schablone: 'ruine.test', seed: 1, bauweise: 'rom', besitz: 'herrenlos', zustand: 'intakt', id: 'test.lp' };
  K1 = Buehne.bauen(o);
  const K1b = Buehne.bauen(o);
  ok(Buehne.hash(K1) === Buehne.hash(K1b), 'gleiche Eingabe -> gleicher Hash');
  ok(JSON.stringify(K1) === JSON.stringify(K1b), 'gleiche Eingabe -> identische Karte');
  ok(K1.w === 24 && K1.h === 16 && K1.rows.length === 16 && K1.rows.every((r) => r.length === 24), 'Größe 3×2 Zellen');
  ok(K1.erzeuger === 'modul/1' && K1.art === 'ruine' && K1.id === 'test.lp' && K1.seed === 1, 'Kopf-Felder');
  ok(/^[0-9a-f]{6}$/.test(K1.bauversion), 'bauversion kurzer Hash');
  ok(Buehne.pruefen(K1, OPT).ok, 'gebaute Karte besteht pruefen');
  const ids = K1.anker.map((a) => a.id);
  ok(new Set(ids).size === ids.length, 'Anker-IDs eindeutig');
  ok(ids.includes('raum.terminal') && ids.includes('pad.abholpunkt'), 'IDs <platz>.<rolle>');
  ok(K1.ankunft === 'pad.abholpunkt' && K1.anker.filter((a) => a.ankunft).length === 1, 'ankunft nur über den Platz');
  ok(K1.anker.find((a) => a.id === 'tor2.eingang').art === 'leise' && K1.anker.find((a) => a.id === 'tor1.eingang').art === 'laut', 'eingang_art des Platzes überschreibt das Modul (W9)');
  ok(K1.eingaenge.length === 2 && K1.abholpunkte.length === 1, 'eingaenge/abholpunkte');
  ok(K1.bereiche.ziel.rolle === 'ziel' && K1.bereiche.vorfeld.rolle === 'hinein' && K1.bereiche.landung.rolle === 'rueckzug' && K1.bereiche.hof.rolle === null, 'Bereichsrolle aus der Schablone');
  ok(K1.bereiche.gefecht && K1.bereiche.gefecht.gefecht && K1.bereiche.gefecht.rects.length === 2, 'Gefechtsbereich aus schablone.gefecht');
  ok(K1.plaetze.tor1.lage.aussen === 'S' && K1.plaetze.tor2.lage.aussen === 'S', 'richtung S eingehalten');
  const innen = Object.keys(K1.kanten).filter((k) => K1.kanten[k].a !== K1.kanten[k].b);
  ok(innen.length === 1 && K1.kanten[innen[0]].typ === 'tuer', 'innerer Türanschluss in kanten');
  ok(/^(feld1~raum|raum~tor2)$/.test(innen[0]), 'Kanten-ID <platzA>~<platzB>');
  ok(K1.kanten['tor1.tuer'] && K1.kanten['tor1.tuer'].typ === 'tor' && K1.kanten['tor1.tuer'].tiles.length === 2 && K1.kanten['tor1.tuer'].zustand === 'zu', 'Tor im Modul als Kante <platz>.tuer (Start zu)');
  ok(K1.patrouillen.length >= 1 && K1.patrouillen.flat().length === 2, 'Patrouillen verkettet');
  ok(K1.coverSpots.length > 10 && K1.coverSpots.every((c) => c.cover >= 1), 'coverSpots');
  ok(K1.meta.kennzahlen && K1.meta.kennzahlen.wege['tor1.eingang'] > 0, 'Kennzahlen: Weg Ankunft->Ziel je Eingang');
  ok(K1.meta.kennzahlen.wegeGetrennt >= 1 && Array.isArray(K1.meta.kennzahlen.engstellen), 'Kennzahlen: Wege/Engstellen');
  ok(K1.meta.kennzahlen.wegeGetrennt >= K1.meta.kennzahlen.wegeVonAnkunft, 'getrennte Wege ab allen Eingängen ≥ ab der Ankunft');
  {
    const KZ = require('../shared/buehne-kennzahlen.js');
    // Raute A-B, A-C, B-D, C-D: von A nach D 2 kantendisjunkte Wege; Quelle {A,B} -> D ebenfalls 2; Kette A-B-D: 1
    ok(KZ.getrennteWege([[1, 2], [0, 3], [0, 3], [1, 2]], 0, [3]) === 2, 'getrennteWege: Raute = 2');
    ok(KZ.getrennteWege([[1], [0, 2], [1]], 0, [2]) === 1, 'getrennteWege: Kette = 1');
    ok(KZ.getrennteWege([[2], [2], [0, 1, 3], [2]], [0, 1], [3]) === 1, 'getrennteWege: zwei Quellen über eine Engstelle = 1');
    ok(KZ.getrennteWege([[2], [3], [0, 4], [1, 4], [2, 3]], [0, 1], [4]) === 2, 'getrennteWege: zwei Quellen, zwei Wege = 2');
  }
  // Seeds: verschiedene Karten, alle gültig
  const hs = new Set(); let gut = 0;
  for (let s = 1; s <= 40; s++) { const r = Buehne.bauRoh(Object.assign({}, o, { seed: s })); if (r.karte && r.pruefung.ok) gut++; if (r.karte) hs.add(Buehne.hash(r.karte)); }
  ok(gut === 40, `40/40 Seeds bestehen (ist ${gut})`);
  ok(hs.size >= 30, `viele verschiedene Karten (${hs.size}/40)`);
  // Spiegelung x kommt vor und hält richtung
  let sp = 0; for (let s = 1; s <= 20; s++) { const k = Buehne.bauen(Object.assign({}, o, { seed: s })); if (k.spiegel) sp++; }
  ok(sp > 0 && sp < 20, `Spiegelung x mal ja, mal nein (${sp}/20)`);
  // Fehlschlag -> seed + 1: Schablone, deren Raum nie passt
  const D2 = klon(DFIX); D2.schablonen = D2.schablonen.map((s) => (s.id === 'ruine.test' ? Object.assign(s, { pflicht: Object.assign({}, s.pflicht, { zelle: 1 }) }) : s));
  let wurf = null; try { Buehne.bauen(Object.assign({}, o, { daten: D2, versuche: 3 })); } catch (e) { wurf = e; }
  ok(wurf && /3 Versuche/.test(wurf.message) && wurf.fehler.some((f) => f.code === 'K-PFLICHT'), 'Pflicht unerfüllbar -> Error nach versuche, K-PFLICHT');
  // kein Modul für einen Platz
  const D3 = klon(DFIX); D3.module = D3.module.filter((m) => m.typ !== 'raum');
  const r3 = Buehne.bauRoh(Object.assign({}, o, { daten: D3 }));
  ok(!r3.karte && r3.fehler[0].code === 'K-MODUL', 'fehlender Modultyp -> K-MODUL');
  // Ankunft fehlt in der Schablone -> K-ABHOLPUNKT
  const D4 = klon(DFIX); D4.schablonen[0].plaetze[0].ankunft = false;
  ok(Buehne.bauRoh(Object.assign({}, o, { daten: D4 })).fehler[0].code === 'K-ABHOLPUNKT', 'Schablone ohne ankunft-Platz -> K-ABHOLPUNKT');
  // bauversion ändert sich mit einem Modul
  const D5 = klon(DFIX); D5.module[0].gewicht = 7;
  ok(Buehne.bauversion('ruine', Buehne.setDaten ? require('../shared/buehne.js').daten() : null) !== undefined, 'bauversion abrufbar');
  ok(Buehne.bauen(Object.assign({}, o, { daten: D5 })).bauversion !== K1.bauversion, 'bauversion ändert sich mit den Modulen');
  // Zustände aus dem Weltstand (Schritt 6), Unbekanntes verworfen
  const kid = Object.keys(K1.kanten).find((k) => K1.kanten[k].a !== K1.kanten[k].b);
  const K6 = Buehne.bauen(Object.assign({}, o, { zustaende: { [kid]: 'verschlossen', 'raum.terminal': 'geladen' } }));
  ok(K6.kanten[kid].zustand === 'verschlossen' && K6.zustaende['raum.terminal'] === 'geladen', 'gespeicherte Zustände angewandt');
  ok(Buehne.hash(K6) === Buehne.hash(K1), 'Zustände ändern die Karte (rows/anker) nicht');
  ok(Buehne.zustaendeAnwenden(klon(K1), { 'gibts.nicht': 'zu' }).join() === 'gibts.nicht', 'unbekannte Zustands-ID verworfen');
}

// ---------------- Prüfcodes an der gebauten Karte (§11.3) ----------------
abschnitt('Prüfcodes Karte');
{
  const mit = (f) => { const k = klon(K1); k.meta.kennzahlen = null; f(k); return Buehne.pruefen(k, OPT); };
  const C = (f) => codes(mit(f));
  const setz = (k, x, y, ch) => { k.rows[y] = k.rows[y].slice(0, x) + ch + k.rows[y].slice(x + 1); };
  const term = K1.anker.find((a) => a.rolle === 'terminal');
  ok(C((k) => { k.rows[3] = k.rows[3].slice(1); }).has('K-RASTER'), 'K-RASTER Zeilenlänge');
  ok(C((k) => { setz(k, 5, 5, 'Q'); }).has('K-RASTER'), 'K-RASTER unbekanntes Zeichen');
  ok(C((k) => { const a = k.anker.find((q) => q.id === term.id); a.x = k.plaetze.raum.rect[0]; a.y = 0; }).has('K-ANKER-WAND'), 'K-ANKER-WAND Terminal auf Wand');
  ok(C((k) => { setz(k, 4, 4, '^'); }).has('K-PLATEAU'), 'K-PLATEAU');
  ok(C((k) => { k.anker.push({ id: 'feld2.raetsel', rolle: 'raetsel', x: 11, y: 11, platz: 'feld2', bereich: 'hof' }); }).has('K-PAAR'), 'K-PAAR ohne Paar');
  ok(C((k) => { k.anker.push({ id: 'feld2.raetsel', rolle: 'raetsel', x: 11, y: 11, platz: 'feld2', paar: 'Z' }); }).has('K-PAAR'), 'K-PAAR nur ein Anker');
  ok(C((k) => { const a = k.anker.find((q) => q.rolle === 'abholpunkt'); k.anker.push(Object.assign({}, a, { id: 'x.abholpunkt', x: a.x + 8 > 23 ? a.x - 3 : a.x + 3 })); }).has('K-ABHOLPUNKT'), 'K-ABHOLPUNKT zweite ankunft');
  ok(C((k) => { k.meta.pflicht.zelle = 1; }).has('K-PFLICHT'), 'K-PFLICHT');
  ok(C((k) => { k.anker = k.anker.filter((a) => a.rolle !== 'eingang'); }).has('K-EINGAENGE'), 'K-EINGAENGE');
  ok(C((k) => { k.plaetze.tor1.lage.aussen = 'N'; }).has('K-RICHTUNG'), 'K-RICHTUNG');
  const kid = Object.keys(K1.kanten).find((k) => K1.kanten[k].a !== K1.kanten[k].b);
  const pr = mit((k) => { k.kanten[kid].zustand = 'verschlossen'; });
  ok(codes(pr).has('K-ERREICHBAR') && pr.fehler.some((f) => f.msg.includes('raum.terminal')), 'K-ERREICHBAR hinter verschlossener Tür');
  ok(codes(pr).has('K-INSEL'), 'K-INSEL: Raum ohne Zugang mit Ankern');
  // K-KANTE: Pad-Ostkante (Spalte 7) auf offen verengen, Feld-Westkante (Spalte 8) Mitte zu -> offen↔wand
  const pk = mit((k) => {
    const padX = k.plaetze.pad.rect[0], feldX = k.plaetze.feld1.rect[0];
    const kx = padX < feldX ? 7 : 8, fx = padX < feldX ? 8 : 7;   // Spiegelung beachten
    for (const y of [0, 1, 2, 5, 6, 7]) setz(k, kx, y, '#');
    for (const y of [3, 4]) setz(k, fx, y, '#');
  });
  ok(codes(pk).has('K-KANTE'), 'K-KANTE offen↔wand');
  ok(C((k) => { k.art = 'schiff'; k.anker.push({ id: 'pad.lift', rolle: 'lift', x: 2, y: 2, deck: 1 }); }).has('K-DECK'), 'K-DECK Lift ohne Gegenstück / Lücke ohne _');
  const insel = mit((k) => { const x = 18, y = 12; for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) setz(k, x + dx, y + dy, 'O'); setz(k, x, y, '.');
    k.anker.push({ id: 'tor2.wache.9', rolle: 'wache', x, y, platz: 'tor2' }); });
  ok(codes(insel).has('K-INSEL'), 'K-INSEL eingeschlossene Wache');
  // Warnungen
  const w = Buehne.pruefen(K1, Object.assign({ cfg: { sichtgasseMax: 4, deckungMin: 1.01 } }, OPT));
  const wc = new Set(w.warnungen.map((q) => q.code));
  ok(w.ok && wc.has('K-SICHTGASSE') && wc.has('K-DECKUNG'), 'Warnungen K-SICHTGASSE/K-DECKUNG nach cfg');
  // Sichtung GD: jeArt, Dichte, Schleifen, Wege
  const kz = K1.meta.kennzahlen;
  ok(kz.deckungAnteilGefecht > 0 && kz.deckungAnteilGefecht < 1 && kz.einzelblockAnteil != null && kz.schleifen >= 1, `neue Kennzahlen (Gefecht ${kz.deckungAnteilGefecht}, außen ${kz.deckungAnteilAussen}, Einzel ${kz.einzelblockAnteil}, Schleifen ${kz.schleifen})`);
  const wc2 = (cfg, f) => { const k = klon(K1); if (f) f(k); return new Set(Buehne.pruefen(k, Object.assign({ cfg }, OPT)).warnungen.map((q) => q.code)); };
  ok(wc2({ sichtgasseMax: 4, jeArt: { ruine: { sichtgasseMax: 99 } } }).has('K-SICHTGASSE') === false && wc2({ sichtgasseMax: 99, jeArt: { station: { sichtgasseMax: 4 } } }).has('K-SICHTGASSE') === false, 'jeArt überschreibt global (nur für die eigene Kartenart)');
  ok(wc2({ sichtgasseMax: 99, jeArt: { ruine: { sichtgasseMax: 4 } } }).has('K-SICHTGASSE'), 'jeArt der Kartenart greift');
  ok(wc2({ deckungMaxGefecht: 0.01 }).has('K-DECKUNG-DICHT') && wc2({ einzelblockMax: 0 }).has('K-DECKUNG-DICHT') && !wc2({ deckungMaxGefecht: 0.99, deckungMaxAussen: 0.99, einzelblockMax: 1 }).has('K-DECKUNG-DICHT'), 'K-DECKUNG-DICHT (Gefecht, Einzelblöcke)');
  ok(wc2({ schleifenMin: 99 }).has('K-SCHLEIFE') && !wc2({ schleifenMin: 99 }, (k) => { k.meta.linear = true; }).has('K-SCHLEIFE'), 'K-SCHLEIFE, außer linear');
  ok(wc2({}, (k) => { k.meta.kennzahlen = Object.assign({}, k.meta.kennzahlen, { wegeGetrennt: 1 }); }).has('K-WEGE'), 'K-WEGE unter 2 auf Außenkarten');
  {
    const KZ = require('../shared/buehne-kennzahlen.js');
    ok(KZ.cfgFuer({ a: 1, jeArt: { ruine: { a: 2 } } }, 'ruine').a === 2 && KZ.cfgFuer({ a: 1, jeArt: { ruine: { a: 2 } } }, 'station').a === 1, 'cfgFuer');
  }
}

// ---------------- Leitstück-Fuß (Nachtrag) ----------------
abschnitt('Leitstück-Fuß');
{
  const g = Buehne.leitFuss(5, 5, 3, 2);
  ok(g.x0 === 4 && g.y0 === 5 && g.x1 === 6 && g.y1 === 6 && g.mx === 5.5 && g.my === 6, 'leitFuss 3×2: x0 = ax-1, y0 = ay (gerade Tiefe: Anker oben)');
  const g2 = Buehne.leitFuss(5, 5, 2, 2);
  ok(g2.x0 === 5 && g2.y0 === 5 && g2.x1 === 6 && g2.y1 === 6 && g2.mx === 6 && g2.my === 6, 'leitFuss 2×2: Anker = obere linke Mittelkachel');
  const g3 = Buehne.leitFuss(5, 5, 1, 1);
  ok(g3.x0 === 5 && g3.x1 === 5 && g3.mx === 5.5, 'leitFuss 1×1');
  // Testdaten: Feld mit Block OO und leit-Anker, Bauweise rom mit leit_fuss [2, 1]
  const DL = klon(DFIX);
  DL.bauweisen = [{ format: 'bauweise/1', id: 'rom', leit: { feld: { ruine: 'leit/test/obelisk' } }, leit_fuss: { 'leit/test/obelisk': [2, 1] } }];
  const fa = DL.module.find((m) => m.id === 'ruine.feld.a');
  fa.rows[4] = '...OO...'; fa.anker[4] = '...l....'; fa.anker_legende.l = { rolle: 'leit' };
  const OL = { daten: DL };
  const pm = (f) => { const m = klon(fa); if (f) f(m); return Buehne.pruefeModul(m, OL); };
  ok(pm().ok, 'leit auf Block O mit passender Grundfläche: gültig (keine K-ANKER-WAND)');
  ok(codes(pm((m) => { m.rows[4] = '...O....'; })).has('K-LEIT-FUSS'), 'K-LEIT-FUSS: Grundfläche nicht ganz Block');
  ok(codes(pm((m) => { m.anker[4] = '....l...'; })).has('K-LEIT-FUSS'), 'K-LEIT-FUSS: Anker an falscher Kachel (Rundungsregel)');
  ok(codes(pm((m) => { m.anker[2] = '..l.....'; })).has('K-LEIT-FUSS'), 'höchstens ein leit-Anker je Modul');
  const DL2 = klon(DL); DL2.bauweisen[0].leit_fuss = {};
  ok(Buehne.pruefeModul(DL2.module.find((m) => m.id === 'ruine.feld.a'), { daten: DL2 }).warnungen.some((w) => w.code === 'K-LEIT-FUSS'), 'fehlende Grundfläche: Warnung');
  // Zusammenbau: fuss folgt der Lage, Karte besteht K-LEIT-FUSS auf allen Seeds
  let alle = true, gesehen = 0;
  for (let s = 1; s <= 25; s++) {
    const k = Buehne.bauen({ daten: DL, schablone: 'ruine.test', seed: s, bauweise: 'rom', zustand: 'intakt' });
    for (const a of k.anker.filter((q) => q.rolle === 'leit')) {
      gesehen++;
      const f = a.fuss;
      if (!f || f[2] * f[3] !== 2 || a.modell !== 'leit/test/obelisk') alle = false;
      else for (let y = f[1]; y < f[1] + f[3]; y++) for (let x = f[0]; x < f[0] + f[2]; x++) if (k.rows[y][x] !== 'O') alle = false;
      if (f && !(a.x >= f[0] && a.x < f[0] + f[2] && a.y >= f[1] && a.y < f[1] + f[3])) alle = false;
    }
    if (!Buehne.pruefen(k, OL).ok) alle = false;
  }
  ok(gesehen > 10 && alle, `fuss [x, y, w, h] am Anker folgt Drehen/Spiegeln (${gesehen} Leitstücke)`);
  const k1 = Buehne.bauen({ daten: DL, schablone: 'ruine.test', seed: 3, bauweise: 'rom', zustand: 'intakt' });
  const kl = klon(k1); const la = kl.anker.find((q) => q.rolle === 'leit');
  if (la) { const f = la.fuss; kl.rows[f[1]] = kl.rows[f[1]].slice(0, f[0]) + '.' + kl.rows[f[1]].slice(f[0] + 1); }
  ok(!la || codes(Buehne.pruefen(kl, OL)).has('K-LEIT-FUSS'), 'pruefen(karte): K-LEIT-FUSS an der gebauten Karte');
  // Schiff: Spiegeln des ganzen Schiffs (y) muss den Fuß mitnehmen (echte Inhalte, sofern Leitstücke mit Fuß vorhanden)
  let gespiegelt = 0, fussOk = true, mitFuss = 0;
  for (const sch of Buehne.schablonen('schiff')) for (let s = 1; s <= 20; s++) {
    const r = Buehne.bauRoh({ schablone: sch.id, seed: s, zustand: 'intakt', spiel: true });
    if (!r.karte) continue;
    if (r.karte.spiegel && r.karte.spiegel.includes('y')) gespiegelt++;
    for (const a of r.karte.anker.filter((q) => q.rolle === 'leit' && q.fuss)) {
      mitFuss++;
      const f = a.fuss;
      for (let y = f[1]; y < f[1] + f[3]; y++) for (let x = f[0]; x < f[0] + f[2]; x++) if (f[2] * f[3] > 1 && !/[OX]/.test(r.karte.rows[y][x])) fussOk = false;
    }
    if (r.pruefung.fehler.some((f) => f.code === 'K-LEIT-FUSS')) fussOk = false;
  }
  ok(fussOk && (mitFuss === 0 || gespiegelt > 0), `Schiff: Fuß nach Spiegeln = Block (${mitFuss} Leitstücke, ${gespiegelt} gespiegelte Karten)`);
}

// ---------------- Zustand-Überzug (§5.4) ----------------
abschnitt('Überzug');
{
  const o = { daten: DFIX, schablone: 'ruine.test', bauweise: 'rom', besitz: 'herrenlos' };
  let mitTruemmer = 0, alleOk = true;
  for (let s = 1; s <= 15; s++) {
    const a = Buehne.bauen(Object.assign({ seed: s, zustand: 'verfallen' }, o));
    const b = Buehne.bauen(Object.assign({ seed: s, zustand: 'verfallen' }, o));
    if (Buehne.hash(a) !== Buehne.hash(b)) alleOk = false;
    if (a.rows.join('').match(/[xX]/)) mitTruemmer++;
    if (!Buehne.pruefen(a, OPT).ok) alleOk = false;
  }
  ok(alleOk, 'verfallen deterministisch und gültig');
  ok(mitTruemmer === 15, `verfallen legt Trümmer (${mitTruemmer}/15)`);
  const i = Buehne.bauen(Object.assign({ seed: 3, zustand: 'intakt' }, o));
  ok(!i.rows.join('').match(/[xX]/), 'intakt ohne Trümmer');
  const u = Buehne.bauen(Object.assign({ seed: 3, zustand: 'umkaempft' }, o));
  ok(u.meta.haltung === 'wach', 'umkaempft -> Starthaltung wach');
  const v = Buehne.bauen(Object.assign({ seed: 3, zustand: 'verfallen' }, o));
  ok(['teil', 'kein', 'voll'].includes(v.meta.ueberzug), 'meta.ueberzug gesetzt');
  ok(v.meta.ueberzug === 'voll' && !Object.values(v.kanten).some((q) => q.zustand === 'verschlossen'), 'einziger Zugang eines Platzes wird nie verschlossen (Überzug bleibt voll)');
  // Trümmer nie auf Zellrändern/Ankern
  let sauber = true;
  for (let y = 0; y < v.h; y++) for (let x = 0; x < v.w; x++) if (/[xX]/.test(v.rows[y][x]) && (x % 8 === 0 || x % 8 === 7 || y % 8 === 0 || y % 8 === 7 || v.anker.some((a) => a.x === x && a.y === y))) sauber = false;
  ok(sauber, 'Trümmer nie auf Zellrand oder Anker');
}

// ---------------- Determinismus Browserpfad (UMD ohne module.exports) ----------------
abschnitt('Determinismus Browser (UMD)');
{
  const ctx = { self: {}, console };
  ctx.self.self = ctx.self;
  vm.createContext(ctx);
  for (const f of ['buehne-kennzahlen.js', 'maps.js', 'config.js', 'buehne.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', f), 'utf8'), ctx, { filename: f });
  }
  const BB = ctx.self.Shared_Buehne;
  ok(!!BB && typeof BB.bauen === 'function', 'Browser-Global Shared_Buehne');
  BB.setDaten(JSON.parse(JSON.stringify(DFIX)));
  let gleich = true;
  for (let s = 1; s <= 10; s++) {
    for (const z of ['intakt', 'verfallen']) {
      const o = { schablone: 'ruine.test', seed: s, bauweise: 'rom', zustand: z };
      const a = Buehne.bauen(Object.assign({ daten: DFIX }, o)), b = BB.bauen(o);
      if (Buehne.hash(a) !== BB.hash(b)) gleich = false;
    }
  }
  ok(gleich, 'Hash Node == Browser-Pfad (10 Seeds × 2 Zustände)');
  ok(BB.hand('kesh').rows.length === 26, 'Browser-Pfad: hand() über Shared_Maps');
}

// ---------------- Handkarten (§2, MAP_ANCHORS) ----------------
abschnitt('Handkarten');
{
  const Maps = require('../shared/maps.js');
  for (const id of ['platform', 'wreck', 'kesh']) {
    const k = Buehne.hand(id);
    ok(k.erzeuger === 'hand' && k.art === 'hand' && k.rows.length === Maps[id].h, `hand(${id}) Format`);
    ok(k.ankunft && k.anker.filter((a) => a.ankunft).length === 1, `hand(${id}) genau eine ankunft`);
    ok(Buehne.pruefen(k).ok, `hand(${id}) besteht pruefen (${Buehne.pruefen(k).fehler.map((f) => f.code + ' ' + f.msg).join('; ')})`);
  }
  const ke = Buehne.hand('kesh');
  const rolle = (r) => ke.anker.filter((a) => a.rolle === r);
  ok(rolle('tor').length === 1 && rolle('tor')[0].alt === 'vault', 'kesh: tor = vault');
  ok(rolle('raetsel').length === 2 && rolle('raetsel').every((a) => a.paar === 'A' && a.alt === 'key'), 'kesh: Rätselpaar A = keys');
  ok(rolle('fund').length === 1 && rolle('wache').some((a) => a.schwer && a.alt === 'warden'), 'kesh: fund/tablet, Wächter schwer');
  const wr = Buehne.hand('wreck');
  ok(wr.anker.filter((a) => a.rolle === 'beute').length === Maps.wreck.find('h').length, 'wreck: beute = container');
  ok(Maps.inArea('kesh', 'hof', 3, 3) && !Maps.inArea('kesh', 'hof', 40, 3), 'inArea cols wie bisher');
  Maps.MAP_AREAS.__test = { a: { rects: [[0, 0, 2, 2], [10, 10, 1, 1]] } };
  ok(Maps.inArea('__test', 'a', 1, 1) && Maps.inArea('__test', 'a', 10, 10) && !Maps.inArea('__test', 'a', 5, 5), 'inArea mit rects');
  delete Maps.MAP_AREAS.__test;
}

// ---------------- Echte Inhalte: Werkzeug läuft (Inhaltsfehler meldet check-maps/sweep, nicht dieser Test) ----------------
abschnitt('Inhalte (Rauchtest)');
{
  for (const sch of Buehne.schablonen()) {
    let geworfen = null;
    try { Buehne.bauRoh({ schablone: sch.id, seed: 1 }); } catch (e) { geworfen = e; }
    ok(!geworfen, `bauRoh ${sch.id} wirft nicht${geworfen ? ': ' + geworfen.message : ''}`);
  }
  for (const m of Buehne.module()) {
    let geworfen = null; try { Buehne.pruefeModul(m); } catch (e) { geworfen = e; }
    ok(!geworfen, `pruefeModul ${m.id} wirft nicht`);
  }
}

// ---------------- Laufzeit: Landepunkte (§6.1, §8) ----------------
abschnitt('Landepunkte');
const CONFIG = require('../shared/config.js');
const W = require('../server/world.js');
const Maps = require('../shared/maps.js');
const LP = require('../server/sim/landepunkte.js');
const Anker = require('../server/sim/anker.js');
function ze0id(k) { return k.anker.find((a) => a.rolle === 'zelle').id; }
function fakeGame(o) {
  const ev = [], me = [];
  const g = Object.assign({
    C: CONFIG, time: 0, seed: 1234, players: [], inventory: {}, aways: { platform: { map: 'platform' }, wreck: { map: 'wreck' }, kesh: { map: 'kesh' } },
    ship: { scene: 'kesh', x: 1350, y: 760 }, weltstand: null, mission: {},
    emit(kind, data) { ev.push([kind, data]); }, missionEvent(name, data) { me.push([name, data]); },
    notice() {}, oda() {}, log() {}, countError(w, e) { throw e; }, setAwayMap(id) { this.away = this.aways[id]; },
  }, o || {});
  g.away = g.aways.platform; g._ev = ev; g._me = me;
  return g;
}
{
  const g = fakeGame();
  ok(LP.defs().byId['kesh.kastell'] && LP.defs().byId.platform.art === 'hand', 'landepunkte.json geladen (Handkarten-IDs bleiben)');
  const aw = LP.get(g, 'kesh.kastell');
  ok(aw && g.aways['kesh.kastell'] === aw && W.AWAY_MAPS['kesh.kastell'] && W.AWAY_MAPS['kesh.kastell'].karte, 'get baut, registriert und legt game.aways an');
  const k = W.AWAY_MAPS['kesh.kastell'].karte;
  ok(k.art === 'ruine' && k.bauweise === 'rom' && k.besitz === 'herrenlos' && k.zustand === 'verfallen' && k.id === 'kesh.kastell', 'Karte mit Achsen des Landepunkts');
  ok(aw.kampf === 'v2' && aw.zustaende && aw.ankerLauf, 'Laufzeitfelder (Kampf v2, zustaende, ankerLauf)');
  const b0 = Object.keys(k.bereiche)[0]; const r0 = k.bereiche[b0].rects[0];
  ok(Maps.inArea('kesh.kastell', b0, r0[0], r0[1]), 'Bereiche in Maps.MAP_AREAS (inArea mit rects)');
  ok(LP.get(g, 'kesh.kastell') === aw, 'zweites get liefert dieselbe Laufzeitkarte');
  const e = LP.eintrag(g, 'kesh.kastell');
  ok(e.seed === k.seed && e.bauversion === k.bauversion && e.schablone === k.schablone, 'wirksamer Seed/bauversion/schablone im Eintrag');
  LP.get(g, 'kesh.grabung'); LP.get(g, 'splitter.schuerflager');
  const gebaut = Object.keys(g.aways).filter((id) => !W.istHand(id));
  ok(gebaut.length === 2 && !g.aways['kesh.kastell'] && !W.AWAY_MAPS['kesh.kastell'], `LRU: 2 gebaute Karten, älteste verdrängt (${gebaut.join(',')})`);
  ok(g.aways.platform && g.aways.kesh && W.AWAY_MAPS.kesh, 'Handkarten bleiben');
  ok(/gesperrt/.test(LP.waehlen(g, 'rostnest.kastell') || ''), 'Rostnest gesperrt');
  ok(/nicht an diesem Ort/.test(LP.waehlen(g, 'hafen.kontor') || ''), 'falscher Ort abgelehnt');
  const gT = fakeGame({ weltstand: { data: { tutorial: 'laeuft' } } });
  ok(/Ausbildung/.test(LP.waehlen(gT, 'kesh.kastell') || ''), 'nach_tutorial während des Tutorials gesperrt');
  ok(LP.waehlen(g, 'kesh.kastell') === null && g.aways['kesh.kastell'], 'waehlen baut die Karte');
  ok(LP.liste(g, 'kesh').map((x) => x.id).join() === 'kesh,kesh.kastell,kesh.grabung', 'liste je Ort');
  ok(/Raumgefecht/.test(LP.sperrgrund(g, 'splitter.treibgut') || '') && LP.freigeben(g, 'splitter.treibgut') && !LP.sperrgrund(g, 'splitter.treibgut'), 'nach_raumgefecht über freigeben');
  const k2 = W.AWAY_MAPS['kesh.kastell'].karte;
  const tor = k2.anker.find((a) => a.rolle === 'tor');
  ok(!!tor, 'Ruine hat einen tor-Anker');
  g.away = g.aways['kesh.kastell'];
  ok(Anker.setzen(g, 'kesh.kastell', tor.id, 'verschlossen', null) === null, 'anker.setzen tor verschlossen');
  const block = JSON.parse(JSON.stringify(LP.toSave(g)));
  ok(block['kesh.kastell'] && block['kesh.kastell'].zustaende[tor.id] === 'verschlossen' && block['kesh.kastell'].seed === k2.seed, 'toSave: Zustand + Seed im Block');
  ok(['seed', 'bauversion', 'schablone', 'art', 'bauweise', 'besitz', 'zustand', 'zustaende', 'alarm', 'besuche', 'letzte_mission', 'neu', 'gesperrt'].every((f) => f in block['kesh.kastell']), 'Block-Felder nach §8');
  const g2 = fakeGame(); LP.restore(block, g2);
  const aw2 = LP.get(g2, 'kesh.kastell');
  ok(aw2.zustaende[tor.id] === 'verschlossen' && Buehne.hash(W.AWAY_MAPS['kesh.kastell'].karte) === Buehne.hash(k2), 'restore: dieselbe Karte, Zustand wieder da (zweiter Besuch)');
  const blk = JSON.parse(JSON.stringify(block)); blk['kesh.kastell'].bauversion = 'alt000'; blk['kesh.kastell'].zustaende['gibts.nicht'] = 'zu';
  const g3 = fakeGame(); let geloggt = ''; g3.log = (t) => { geloggt += t; }; LP.restore(blk, g3); LP.get(g3, 'kesh.kastell');
  ok(/bauversion alt000/.test(geloggt) && !LP.eintrag(g3, 'kesh.kastell').zustaende['gibts.nicht'] && LP.eintrag(g3, 'kesh.kastell').zustaende[tor.id] === 'verschlossen', 'bauversion-Wechsel: neu gebaut, Logbuch, Unbekanntes verworfen');
  const id = LP.neu(g, 'kesh', { art: 'station', besitz: 'kontor' });
  ok(id === 'kesh.station-1' && Number.isInteger(LP.eintrag(g, id).seed) && LP.eintrag(g, id).neu, 'neu(): <ort>.<art>-<n> mit Seed');
  ok(LP.neu(g, 'kesh', { art: 'station' }) === 'kesh.station-2', 'neu(): fortlaufend');
  const pr = LP.prise(g, 'splitter', { id: 'e7', fraktion: 'rostmeute', x: 900, y: 400 });
  const pe = LP.eintrag(g, pr);
  ok(pr === 'splitter.prise' && pe.art === 'schiff' && pe.besitz === 'rostmeute' && pe.zustand === 'umkaempft' && pe.bauweise === 'germanen', 'prise(): Schiff, Besitz = Fraktion, umkaempft');
  const seed7 = pe.seed;
  ok(LP.prise(g, 'splitter', { id: 'e7', fraktion: 'rostmeute', beam: { x: 10, y: 20 } }) && LP.eintrag(g, 'splitter.prise').seed === seed7, 'prise(): Seed aus der Gegner-ID');
  const bl = LP.toSave(g); const g4 = fakeGame(); LP.restore(bl, g4);
  ok(LP.eintrag(g4, 'kesh.station-1') && LP.liste(g4, 'kesh').some((x) => x.id === 'kesh.station-1'), 'Laufzeit-Landepunkt übersteht Speichern/Laden');
  ok(LP.priseVerlassen(g, 'splitter', false) === null && !LP.eintrag(g, 'splitter.prise'), 'Prise verfällt beim Verlassen');
  LP.prise(g, 'splitter', { id: 'e8' });
  const wr = LP.priseVerlassen(g, 'splitter', true);
  ok(wr === 'splitter.wrack-1' && LP.eintrag(g, wr).zustand === 'verfallen' && !LP.eintrag(g, 'splitter.prise') && LP.liste(g, 'splitter').some((x) => x.id === wr), 'Prise mit merken -> <ort>.wrack-<n> (verfallen), prise-ID frei');
  LP.prise(g, 'splitter', { id: 'e9' });
  ok(LP.priseVerlassen(g, 'splitter', true) === 'splitter.wrack-2', 'zweite gemerkte Prise -> wrack-2');
  ok(typeof LP.karte(g, 'kesh.grabung').rows[0] === 'string' && LP.karte(g, 'kesh').art === 'hand', 'karte(): gebaut bzw. Handkarte');
  // Cache, Spielmodus, verwerfen, Bauzeit
  const gC = fakeGame();
  const k1 = LP.karte(gC, 'splitter.schuerflager'), k2b = LP.karte(gC, 'splitter.schuerflager');
  ok(k1 === k2b && k1.meta.kennzahlen == null, 'karte(): Cache-Treffer; im Spielmodus ohne Kennzahlen');
  const tg = []; for (let i = 0; i < 5; i++) { const gg = fakeGame(); LP.karte(gg, 'splitter.schuerflager'); const t0 = process.hrtime.bigint(); LP.get(gg, 'splitter.schuerflager'); tg.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  tg.sort((a, b) => a - b);
  ok(tg[2] <= 50, `get() nach Vorbau Median ${tg[2].toFixed(1)} ms ≤ 50`);
  const nid = LP.neu(gC, 'splitter', { art: 'ruine' });
  ok(LP.verwerfen(gC, nid) && !LP.eintrag(gC, nid) && !LP.liste(gC, 'splitter').some((x) => x.id === nid), 'verwerfen(): neu-Landepunkt weg');
  ok(!LP.verwerfen(gC, 'splitter.schuerflager'), 'verwerfen(): feste Landepunkte nicht');
  // Bauzeit unter Last stabil messen: Median über 40 Bauten (Ziel ≤ 50 ms warm), nicht das Maximum
  const zeiten = [];
  for (let s = 1; s <= 40; s++) {
    const gx = fakeGame();
    const id = LP.neu(gx, 'kesh', { art: ['aussenposten', 'ruine', 'station', 'schiff'][s % 4], seed: s, zustand: 'verfallen' });
    const t1 = process.hrtime.bigint(); LP.get(gx, id); zeiten.push(Number(process.hrtime.bigint() - t1) / 1e6);
  }
  zeiten.sort((a, b) => a - b);
  ok(zeiten[20] <= 50, `Bau im Spiel (verfallen, 40 Bauten) Median ${zeiten[20].toFixed(1)} ms ≤ 50 (max ${zeiten[39].toFixed(0)} ms, nur Info)`);
}

// ---------------- Laufzeit: Anker (§6.2) ----------------
abschnitt('Anker');
{
  const g = fakeGame();
  g.players = [{ id: 'p1', zone: 'away', connected: true, hold: null, x: 0, y: 0 }, { id: 'p2', zone: 'away', connected: true, hold: null, x: 0, y: 0 }];
  const [p1, p2] = g.players;
  const aw = LP.get(g, 'kesh.kastell'); g.away = aw;
  const k = W.AWAY_MAPS['kesh.kastell'].karte;
  const A = (r) => k.anker.filter((a) => a.rolle === r);
  const am = (p, a) => { const l = []; Anker.interactionsAt(g, p, a.x, a.y, l); return l.find((i) => i.anker === a.id) || l[0]; };
  const halte = (p, it, sek) => {
    p.hold = { kind: it.kind, t: 0, dur: Anker.holdDuration(g, p, it.kind, it), anker: it.anker, op: it.op, kante: it.kante, technisch: it.technisch };
    Anker.holdStart(g, p, p.hold);
    for (let t = 0; t < sek; t += 0.1) {
      if (!p.hold) break;
      if (!Anker.holdValid(g, p, p.hold)) { p.hold = null; break; }
      p.hold.t += 0.1; g.time += 0.1; Anker.update(g, 0.1);
      if (p.hold && p.hold.t >= p.hold.dur) { const h = p.hold; p.hold = null; Anker.completeHold(g, p, h); }
    }
  };
  const term = A('terminal')[0];
  let it = am(p1, term);
  ok(it && it.kind === 'anker:terminal' && it.op === 'download', 'Terminal: Interaktion Download');
  ok(Anker.holdDuration(g, p1, it.kind, it) === CONFIG.anker.halten.terminal, 'Download dauert CONFIG.anker.halten.terminal');
  halte(p1, it, 3);
  ok(Anker.zustand(g, 'kesh.kastell', term.id) === 'laedt', 'während des Haltens: laedt');
  Anker.onTreffer(g, 'p1');
  ok(!p1.hold && Anker.zustand(g, 'kesh.kastell', term.id) === 'bereit' && g._ev.some((e) => e[0] === 'downloadAbbruch'), 'Treffer bricht ab (downloadAbbruch), Zustand bereit');
  it = am(p1, term);
  ok(Anker.holdDuration(g, p1, it.kind, it) < CONFIG.anker.halten.terminal - 2.5, 'Fortschritt bleibt (Restzeit kürzer)');
  halte(p1, it, 5);
  ok(Anker.zustand(g, 'kesh.kastell', term.id) === 'geladen' && g._me.some((m) => m[0] === 'downloadFertig'), 'Download fertig -> geladen, missionEvent downloadFertig');
  ok(am(p1, term).op === 'lesen', 'danach Logbuch lesen');
  const rs = A('raetsel'); const tor = A('tor')[0];
  ok(rs.length === 2 && rs[0].paar === rs[1].paar, 'Ruine: ein Rätselpaar');
  halte(p1, am(p1, rs[0]), 4);
  ok(Anker.zustand(g, 'kesh.kastell', rs[0].id) === 'gehalten', 'ein Rätsel gedreht -> gehalten');
  const fensterK = Anker.paarFenster(g, W.AWAY_MAPS['kesh.kastell'].karte, rs[0].paar);   // F4: aus dem Laufweg
  g.time += fensterK - 1; Anker.update(g, 0.1);
  ok(Anker.zustand(g, 'kesh.kastell', rs[0].id) === 'gehalten', 'allein: innerhalb des Fensters (' + fensterK.toFixed(1) + ' s) noch gehalten');
  g.time += 2; Anker.update(g, 0.1);
  ok(Anker.zustand(g, 'kesh.kastell', rs[0].id) === 'ruhe', 'allein: nach dem Fenster zurück auf ruhe');
  const i1 = am(p1, rs[0]), i2 = am(p2, rs[1]);
  for (const [p, i] of [[p1, i1], [p2, i2]]) p.hold = { kind: i.kind, t: 0, dur: Anker.holdDuration(g, p, i.kind, i), anker: i.anker };
  for (let t = 0; t < 4; t += 0.1) {
    g.time += 0.1;
    for (const p of [p1, p2]) if (p.hold) { p.hold.t += 0.1; if (p.hold.t >= p.hold.dur) { const h = p.hold; p.hold = null; Anker.completeHold(g, p, h); } }
    Anker.update(g, 0.1);
  }
  ok(rs.every((r) => Anker.zustand(g, 'kesh.kastell', r.id) === 'geloest'), 'beide im Fenster -> geloest');
  ok(Anker.zustand(g, 'kesh.kastell', tor.id) === 'offen', 'gelöstes Paar öffnet das Tor');
  const torKanten = Anker.kantenVonAnker(k, tor);
  ok(torKanten.length >= 1 && torKanten.every((kid) => aw.zustaende[kid] === 'offen'), 'Tor-Zustand steuert die Türkacheln (aw.zustaende der Kante)');
  const fund = A('fund')[0];
  halte(p1, am(p1, fund), 4);
  ok(Anker.zustand(g, 'kesh.kastell', fund.id) === 'genommen' && g._me.some((m) => m[0] === 'fundGeborgen'), 'Fund geborgen');
  const snap = Anker.awaySnap(g, aw);
  const idx = k.anker.findIndex((a) => a.id === fund.id);
  ok(snap.ao.some(([i, z]) => i === idx && z === 1) && snap.al === 0 && Array.isArray(snap.ko), 'awaySnap: ao (Abweichung vom Start), ko, al');
  ok(JSON.stringify(snap).length < 600, `awaySnap klein (${JSON.stringify(snap).length} B)`);
  ok(Anker.alarm(g, 'kesh.kastell', true) === null && aw.alarm && g._ev.some((e) => e[0] === 'landepunktAlarm' && e[1].an === true), 'landepunktAlarm');
  ok(Anker.awaySnap(g, aw).al === 1, 'Snapshot al = 1');
  // Luke eines technischen Eingangs (Cloaca): von innen und außen zu öffnen
  const tech = k.anker.find((a) => a.rolle === 'eingang' && a.art === 'technisch' && Anker.kantenVonAnker(k, a).some((q) => k.kanten[q].typ === 'luke'));
  if (tech) {
    const lk = Anker.kantenVonAnker(k, tech).find((q) => k.kanten[q].typ === 'luke');
    Anker.setzen(g, 'kesh.kastell', lk, 'zu', null, { still: true });
    const t = k.kanten[lk].tiles[0]; const l = []; Anker.interactionsAt(g, p1, t[0], t[1], l);
    const li = l.find((i) => i.kind === 'anker:tuer' && !i.blocked);
    ok(li && li.technisch, 'Luke am technischen Eingang: E öffnet (auch von innen)');
    Anker.completeHold(g, p1, li);
    ok(aw.zustaende[lk] === 'offen', 'Luke offen');
  } else ok(true, '(Ruine ohne Luke am technischen Eingang)');
  const gA = fakeGame(); gA.players = [{ id: 'p1', zone: 'away', connected: true, hold: null, x: 0, y: 0 }];
  const awA = LP.get(gA, 'kesh.grabung'); gA.away = awA;
  const kA = W.AWAY_MAPS['kesh.grabung'].karte;
  const sp = kA.anker.find((a) => a.rolle === 'sprengpunkt');
  const pA = gA.players[0];
  const l0 = []; Anker.interactionsAt(gA, pA, sp.x, sp.y, l0);
  const b0 = l0.find((i) => i.kind === 'anker:sprengpunkt');
  ok(b0 && b0.blocked && /ladung/i.test(b0.blocked), 'ohne Ladung gesperrt');
  gA.inventory.ladung = 1;
  const l1 = []; Anker.interactionsAt(gA, pA, sp.x, sp.y, l1);
  const s1 = l1.find((i) => i.kind === 'anker:sprengpunkt' && !i.blocked);
  pA.hold = { kind: s1.kind, t: 2, dur: Anker.holdDuration(gA, pA, s1.kind, s1), anker: sp.id };
  Anker.onTreffer(gA, 'p1');
  ok(!pA.hold && gA.inventory.ladung === 1 && Anker.zustand(gA, 'kesh.grabung', sp.id) === 'intakt', 'Treffer beim Scharfmachen: zurückgesetzt, Ladung bleibt');
  Anker.completeHold(gA, pA, { kind: 'anker:sprengpunkt', anker: sp.id });
  ok(Anker.zustand(gA, 'kesh.grabung', sp.id) === 'scharf' && gA.inventory.ladung === 0 && gA._ev.some((e) => e[0] === 'ladungScharf'), 'scharf, Ladung verbraucht, ladungScharf');
  ok(Anker.awaySnap(gA, awA).cd && Anker.awaySnap(gA, awA).cd.t === CONFIG.anker.countdown, 'Snapshot cd mit Countdown');
  for (let t = 0; t < CONFIG.anker.countdown + 1; t += 0.5) { gA.time += 0.5; Anker.update(gA, 0.5); }
  ok(Anker.zustand(gA, 'kesh.grabung', sp.id) === 'zerstoert' && gA._ev.some((e) => e[0] === 'ladungExplodiert') && gA._me.some((m) => m[0] === 'ladungGezuendet'), 'Countdown -> zerstoert, ladungExplodiert');
  const kid = Object.keys(kA.kanten).find((q) => kA.kanten[q].zustand === 'zu' && !kA.anker.some((a) => (a.rolle === 'tor' || a.rolle === 'eingang') && Anker.kantenVonAnker(kA, a).includes(q)));
  if (kid) {
    const t = kA.kanten[kid].tiles[0]; const l = []; Anker.interactionsAt(gA, pA, t[0], t[1], l);
    const ti = l.find((i) => i.kind === 'anker:tuer');
    ok(ti && !ti.blocked, 'geschlossene Tür: E öffnet');
    Anker.completeHold(gA, pA, Object.assign({}, ti));
    ok(awA.zustaende[kid] === 'offen', 'Tür offen (aw.zustaende)');
  } else ok(true, '(keine geschlossene Tür auf dieser Karte)');
  // ladungScharf (Debug/ENGINE): eigener Countdown, gleiche Ereignisse, kein Inventar
  const sp2 = kA.anker.filter((a) => a.rolle === 'sprengpunkt')[1];
  if (sp2) {
    const n0 = gA._ev.filter((e) => e[0] === 'ladungScharf').length;
    ok(Anker.ladungScharf(gA, 'kesh.grabung', sp2.id, 5) === null && Anker.zustand(gA, 'kesh.grabung', sp2.id) === 'scharf' && gA._ev.filter((e) => e[0] === 'ladungScharf').length === n0 + 1, 'ladungScharf(game, map, id, t): scharf + Ereignis');
    ok(/nicht intakt/.test(Anker.ladungScharf(gA, 'kesh.grabung', sp2.id, 5) || '') && /kein Sprengpunkt/.test(Anker.ladungScharf(gA, 'kesh.grabung', ze0id(kA), 5) || ''), 'ladungScharf prüft Zustand und Rolle');
    for (let t = 0; t < 6; t += 0.5) { gA.time += 0.5; Anker.update(gA, 0.5); }
    ok(Anker.zustand(gA, 'kesh.grabung', sp2.id) === 'zerstoert', 'ladungScharf: Countdown t -> zerstoert');
  } else ok(true, '(nur ein Sprengpunkt)');
  ok(/unbekannt/.test(Anker.setzen(gA, 'kesh.grabung', sp.id, 'quatsch')) && /gibt es/.test(Anker.setzen(gA, 'kesh.grabung', 'nix.da', 'offen')), 'setzen prüft Zustand und ID');
  const ze = kA.anker.find((a) => a.rolle === 'zelle');
  ok(Anker.setzen(gA, 'kesh.grabung', ze.id, 'offen', null, { merken: true }) === null && LP.eintrag(gA, 'kesh.grabung').zustaende[ze.id] === 'offen', 'merken schreibt in den Weltstand-Eintrag');
  ok(/Handkarten/.test(Anker.setzen(gA, 'platform', 'x', 'offen') || ''), 'Handkarten: kein Anker-Laufzeitpfad');
  ok(Anker.istAnkerHold('anker:terminal') && !Anker.istAnkerHold('archkey'), 'istAnkerHold');
  // Tor ohne Rätsel (Schott-Füllplatz der Station) öffnet mit E; Tor hinter einem Rätselpaar (Ruine) ist verriegelt
  const gS = fakeGame(); gS.players = [{ id: 'p1', zone: 'away', connected: true, hold: null, x: 0, y: 0 }];
  let geprueft = 0;
  for (let s = 1; s <= 6 && !geprueft; s++) {
    const idS = LP.neu(gS, 'kesh', { art: 'station', seed: s, zustand: 'intakt' });
    const awS = LP.get(gS, idS); gS.away = awS;
    const kS = W.AWAY_MAPS[idS].karte;
    const torS = kS.anker.find((a) => a.rolle === 'tor');
    if (!torS || kS.anker.some((a) => a.rolle === 'raetsel')) continue;
    const kid = Anker.kantenVonAnker(kS, torS)[0]; if (!kid) continue;
    const t = kS.kanten[kid].tiles[0]; const l = []; Anker.interactionsAt(gS, gS.players[0], t[0], t[1], l);
    const ti = l.find((i) => i.kind === 'anker:tuer' && !i.blocked);
    ok(ti && ti.tor === torS.id, 'Station: Schott mit tor-Anker (ohne Rätsel) bietet E an');
    Anker.completeHold(gS, gS.players[0], ti);
    ok(awS.zustaende[kid] === 'offen' && Anker.zustand(gS, idS, torS.id) === 'offen', 'Station: Schott offen, tor-Anker offen');
    geprueft++;
  }
  ok(geprueft === 1, 'Station mit tor-Schott gefunden');
  const gR = fakeGame(); gR.players = [{ id: 'p1', zone: 'away', connected: true, hold: null, x: 0, y: 0 }];
  const awR = LP.get(gR, 'kesh.kastell'); gR.away = awR;
  const kR = W.AWAY_MAPS['kesh.kastell'].karte; const torR = kR.anker.find((a) => a.rolle === 'tor');
  const kidR = Anker.kantenVonAnker(kR, torR)[0];
  const tR = kR.kanten[kidR].tiles[0]; const lR = []; Anker.interactionsAt(gR, gR.players[0], tR[0], tR[1], lR);
  ok(lR.some((i) => i.kind === 'anker:tuer' && i.blocked && /Rätsel/.test(i.blocked)) && !lR.some((i) => i.kind === 'anker:tuer' && !i.blocked), 'Ruine: Tor hinter dem Rätselpaar verriegelt (Hinweis nennt das Rätsel)');
}

abschnitt('F-QA1: eingangAktion – eine Regel für Server und Client-E-Hinweis');
{
  // Einheit: Schott zu -> hacken, nur Luke zu -> luke, alles offen -> null, art nicht technisch -> null
  const leg = { '.': { kind: 'boden' }, '#': { kind: 'wand', solid: true }, S: { kind: 'schott', solid: 'zustand', kante: 'tuer' }, L: { kind: 'luke', solid: 'zustand', kante: 'tuer' } };
  const karte = (ch) => ({ w: 5, h: 3, rows: ['#####', '#.' + ch + '.#', '#####'], legende: leg, kanten: { 'a.tuer': { typ: leg[ch].kind, tiles: [[2, 1]], zustand: 'zu' } } });
  const ein = { rolle: 'eingang', x: 1, y: 1, art: 'technisch' };
  const mit = (z) => () => z;
  ok(Buehne.eingangAktion(karte('S'), ein, mit('zu')) === 'hacken', 'Schott zu -> hacken');
  ok(Buehne.eingangAktion(karte('S'), ein, mit('verschlossen')) === 'hacken', 'Schott verschlossen -> hacken');
  ok(Buehne.eingangAktion(karte('S'), ein, mit('offen')) === null && Buehne.eingangAktion(karte('S'), ein, mit('gehackt')) === null, 'Schott offen/gehackt -> nichts');
  ok(Buehne.eingangAktion(karte('L'), ein, mit('zu')) === 'luke', 'Luke zu -> luke');
  ok(Buehne.eingangAktion(karte('L'), ein, mit('offen')) === null, 'Luke offen -> nichts');
  ok(Buehne.eingangAktion(karte('S'), Object.assign({}, ein, { art: 'haupt' }), mit('zu')) === null, 'nicht technisch -> nichts');
  // Client-Form (awayMap.kanten-Liste, typ aus der Kachel) liefert dasselbe wie die Server-Form
  const kl = karte('L'); const cl = Object.assign({}, kl, { kanten: [['a.tuer', [[2, 1]], 0]] });
  ok(Buehne.kantenListe(cl)[0].typ === 'luke' && Buehne.ankerKanten(cl, ein)[0].idx === 0, 'Client-Form: typ aus Kachel, idx = kantenIdx');
  ok(Buehne.eingangAktion(cl, ein, mit('zu')) === 'luke', 'Client-Form: Luke zu -> luke');
  ok(Buehne.TUER_ZEIT.luke === 0.6, 'TUER_ZEIT.luke aus shared');

  // Integration: gebaute Karten (Station/Schiff/Aussenposten/Ruine). Server-Angebot (interactionsAt) == Client-Rechnung
  // aus awayMap-Payload + Snapshot ko – im Startzustand und nach dem Öffnen aller Kanten am Eingang.
  const { Game } = require('../server/game.js');
  const payload = (k) => Game.prototype.awayMapPayload.call({}, k);
  const KLEG = require('../content/buehnen/kacheln.json').zeichen;
  const gE = fakeGame(); gE.players = [{ id: 'p1', zone: 'away', connected: true, hold: null, x: 0, y: 0 }];
  const gesehen = { hacken: 0, luke: 0, offen: 0 }; let gleich = true; let faelle = 0;
  for (let s = 1; s <= 24; s++) {
    const id = LP.neu(gE, 'kesh', { art: ['station', 'schiff', 'aussenposten', 'ruine'][s % 4], seed: s, zustand: 'intakt' });
    const aw = LP.get(gE, id); gE.away = aw;
    const k = W.AWAY_MAPS[id].karte;
    const pl = payload(k);
    const client = { w: k.w, h: k.h, rows: pl.rows, legende: KLEG, kanten: pl.kanten };   // wie client.js: Legende aus kacheln.json
    const clientOp = (a) => {
      const ko = Anker.awaySnap(gE, aw).ko || [];
      return Buehne.eingangAktion(client, a, (kk) => {
        const liste = (KLEG[pl.rows[kk.tiles[0][1]][kk.tiles[0][0]]] || {}).zustaende || [];
        const e = ko.find((q) => q[0] === kk.idx);
        return e ? liste[e[1]] : liste[pl.kanten[kk.idx][2]];
      });
    };
    const serverOp = (a) => { const l = []; Anker.interactionsAt(gE, gE.players[0], a.x, a.y, l); const it = l.find((i) => i.anker === a.id && !i.blocked); return it ? it.op : null; };
    for (const a of k.anker.filter((q) => q.rolle === 'eingang' && q.art === 'technisch')) {
      faelle++;
      const vorher = serverOp(a);
      if (vorher !== clientOp(a)) gleich = false;
      if (vorher) gesehen[vorher]++;
      for (const kid of Anker.kantenVonAnker(k, a)) aw.zustaende[kid] = 'offen';
      const nachher = serverOp(a);
      if (nachher !== clientOp(a) || nachher !== null) gleich = false; else gesehen.offen++;
    }
  }
  ok(faelle > 0, 'technische Eingänge gefunden (' + faelle + ')');
  ok(gleich, 'Server-Angebot und Client-Rechnung identisch (zu und offen)');
  ok(gesehen.offen === faelle, 'offene Kanten: kein Angebot');
  if (process.env.VERBOSE) console.log('  F-QA1 Fälle', faelle, JSON.stringify(gesehen));
}

abschnitt('F-QA1b: Kachelzustand gemischter Kanten – Client-Kollision (render.js) = Server-Kollision (interior.js)');
{
  // Einheit: Regel wie server/sim/interior.js kachelZustand (Zustand als Name, nur wenn die Kachelart ihn kennt)
  const R0 = Buehne.kachelZustandRegel, TU = ['offen', 'zu', 'verschlossen', 'gesprengt'], SC = ['zu', 'offen', 'gehackt', 'verschlossen'];
  ok(R0(TU, 'offen', null, 'zu') === 'offen' && R0(SC, 'offen', null, 'zu') === 'offen', 'Kante offen -> Tür und Schott offen');
  const SCD = ['offen', 'gehackt'];   // begehbarIn des Schotts
  ok(R0(TU, 'gehackt', null, 'zu', SCD) === 'offen' && R0(SC, 'gehackt', null, 'zu', SCD) === 'gehackt', 'gehackt (durchgängig beim Schott): Tür-Hälfte offen, Schott gehackt');
  ok(R0(TU, 'verschlossen', null, 'zu', SCD) === 'verschlossen' && R0(['zu', 'offen'], 'verschlossen', null, 'zu', SCD) === 'zu', 'nicht durchgängig: kein offen (Luke kennt verschlossen nicht -> Kantenstart)');
  ok(R0(TU, null, null, 'zu') === 'zu' && R0(TU, null, null, null) === 'offen', 'ohne Laufzeit: Kantenstart, sonst erster Zustand');
  ok(R0(['zu', 'offen'], null, 'gehackt', 'zu') === 'offen', 'Anker gehackt -> offen, wenn die Kachelart gehackt nicht kennt');
  // render.js im vm (DOM-Attrappen), Shared_Buehne = shared/buehne.js
  const P0 = path.join(__dirname, '..');
  const stub = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 0 }) : () => {}), set: () => true });
  const win = { Shared_Maps: require('../shared/maps.js'), Shared_Physics: require('../shared/physics.js'), Shared_Config: CONFIG, Shared_Protocol: require('../shared/protocol.js'), Shared_Buehne: Buehne,
    document: { createElement: () => ({ getContext: () => stub, style: {} }), querySelector: () => null, head: { appendChild() {} }, getElementById: () => null },
    console, Image: function () {}, performance: { now: () => 0 } };
  win.window = win; win.self = win;
  vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(P0, 'public', 'js', 'render.js'), 'utf8'), win, { filename: 'render.js' });
  const Rd = win.Render;
  ok(Rd && typeof Rd.buehneSolid === 'function' && typeof Rd.kantenZustand === 'function', 'render.js im vm geladen');
  const Interior = require('../server/sim/interior.js');
  const { Game } = require('../server/game.js');
  const gM = fakeGame(); gM.players = [{ id: 'p1', zone: 'away', connected: true, hold: null, x: 0, y: 0 }];
  const karten = new Set(); let kanten = 0, abw = 0, pruef = 0, durch = 0, durchFehler = 0; const beleg = [];
  for (const art of ['station', 'aussenposten', 'ruine', 'schiff']) for (let s = 1; s <= 30; s++) {
    let id; try { id = LP.neu(gM, 'kesh', { art, seed: s, zustand: 'intakt' }); } catch (e) { continue; }
    const aw = LP.get(gM, id); gM.away = aw;
    const k = W.AWAY_MAPS[id].karte;
    const gemischt = Object.keys(k.kanten).filter((kid) => new Set(k.kanten[kid].tiles.map((t) => k.legende[k.rows[t[1]][t[0]]].kind)).size > 1);
    if (!gemischt.length) continue;
    karten.add(id);
    const M = Rd.registerAwayMap(Game.prototype.awayMapPayload.call({}, k));
    ok(M && M.legende.S && M.legende.S.kante === 'tuer', id + ': Legende der registrierten Karte trägt kante');
    for (const kid of gemischt) {
      kanten++;
      const typListe = (Object.values(k.legende).find((i) => i.kind === k.kanten[kid].typ) || {}).zustaende || [];
      for (const z of [null].concat(typListe)) {
        if (z) aw.zustaende[kid] = z; else delete aw.zustaende[kid];
        const sv = Interior.awaySolid(gM);
        const snap = Anker.awaySnap(gM, aw);
        const st = { away: { map: id, ao: snap.ao, ko: snap.ko } };
        const cl = Rd.buehneSolid(M, st);
        for (let y = 0; y < k.h; y++) for (let x = 0; x < k.w; x++) { pruef++; if (sv(x, y) !== cl(x, y)) { abw++; if (beleg.length < 3) beleg.push(id + ' ' + kid + '=' + z + ' @' + x + ',' + y); } }
        const typInfo = Object.values(k.legende).find((i) => i.kind === k.kanten[kid].typ) || {};
        if (z && (typInfo.begehbarIn || []).includes(z)) {
          const tl = k.kanten[kid].tiles; durch++;
          if (!tl.every((t) => !sv(t[0], t[1]) && !cl(t[0], t[1]))) { durchFehler++; if (beleg.length < 3) beleg.push('dicht: ' + id + ' ' + kid + '=' + z); }
        }
        if (id === 'kesh.station-1' && kid === 'fracht~herz' && z === 'offen') {
          ok(k.kanten[kid].tiles.every((t) => !cl(t[0], t[1])), 'Station s1: fracht~herz offen -> alle Kacheln (S und D) begehbar');
        }
      }
      delete aw.zustaende[kid];
    }
  }
  ok(karten.size === 8, 'gemischte Kanten auf 8 Karten (' + karten.size + ', ' + kanten + ' Kanten)');
  ok(durch > 0 && durchFehler === 0, 'durchgängiger Kantenzustand (offen/gehackt/gesprengt) -> alle Kacheln begehbar, Server und Client (' + durch + ' Fälle)');
  ok(abw === 0, 'Client- und Server-Kollision identisch (' + pruef + ' Kachelprüfungen' + (beleg.length ? ', z. B. ' + beleg.join('; ') : '') + ')');
}

// ---------- Abnahme F4/F5: Rätselpaar solo lösbar, Lift auf gebauten Schiffen – mit echtem Laufweg (Game + Testgelände) ----------
{
  console.log('\n[F4/F5: Rätselpaar solo, Lift – echter Laufweg]');
  const { Game } = require('../server/game.js');
  const Arena = require('../server/sim/arena.js');
  const Interior = require('../server/sim/interior.js');
  const Physics = require('../shared/physics.js');
  const T = Physics.TILE;
  const testgelaende = (params) => {
    const g = new Game({ noStore: true, seed: 9, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'F0', name: 'F0', color: 0 }); g.handleMessage(c, { t: 'ready', ready: true });
    Arena.start(g, 'arena_away', params);
    const send = (m) => g.handleMessage(c, m);
    return { g, p: g.players[0], send, karte: W.AWAY_MAPS[g.away.map] && W.AWAY_MAPS[g.away.map].karte };
  };
  // Laufen wie der Client: Eingabe-Nachrichten Richtung nächste Kachel des kürzesten Wegs (BFS über die Server-Kollision)
  const laufe = (g, p, send, ziele, maxSek) => {
    let seq = 0;
    const zielSet = new Set(ziele.map((z) => z.x + ',' + z.y));
    for (let i = 0; i < (maxSek || 60) * 30; i++) {
      const solid = Interior.awaySolid(g);
      const sx = Math.floor(p.x / T), sy = Math.floor(p.y / T);
      if (zielSet.has(sx + ',' + sy) && Math.hypot(p.x - (sx * T + 16), p.y - (sy * T + 16)) < 6) { send({ t: 'input', seq: ++seq, mx: 0, my: 0 }); g.step(); return true; }
      const prev = new Map([[sx + ',' + sy, null]]); const q = [[sx, sy]]; let ziel = null;
      while (q.length) { const [x, y] = q.shift(); if (zielSet.has(x + ',' + y)) { ziel = [x, y]; break; } for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const kk = (x + dx) + ',' + (y + dy); if (prev.has(kk) || solid(x + dx, y + dy)) continue; prev.set(kk, [x, y]); q.push([x + dx, y + dy]); } }
      if (!ziel) return false;
      let cur = ziel; while (prev.get(cur[0] + ',' + cur[1]) && !(prev.get(cur[0] + ',' + cur[1])[0] === sx && prev.get(cur[0] + ',' + cur[1])[1] === sy)) cur = prev.get(cur[0] + ',' + cur[1]);
      const mx = cur[0] * T + 16 - p.x, my = cur[1] * T + 16 - p.y; const l = Math.hypot(mx, my) || 1;
      send({ t: 'input', seq: ++seq, mx: mx / l, my: my / l });
      g.step();
    }
    return false;
  };
  const nachbarn = (g, a) => { const solid = Interior.awaySolid(g); return [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy]) => ({ x: a.x + dx, y: a.y + dy })).filter((t) => !solid(t.x, t.y)); };
  const halten = (g, send, sek) => { send({ t: 'act', down: true }); for (let i = 0; i < Math.round(sek * 30); i++) g.step(); send({ t: 'act', down: false }); g.step(); };

  // F4: Fenster aus dem Laufweg, alle Ruinen-Schablonen × Seeds
  const CF = require('../shared/config.js');
  let fensterOk = 0, fensterN = 0; const zuKnapp = [];
  for (const sch of Buehne.schablonen('ruine').map((s) => s.id || s)) for (let s = 1; s <= 12; s++) {
    let k; try { k = Buehne.bauen({ spiel: true, art: 'ruine', schablone: sch, seed: s }); } catch (e) { continue; }
    const wege = Buehne.raetselWege(k);
    for (const paar of Object.keys(wege)) {
      fensterN++;
      const lauf = wege[paar] == null ? Infinity : wege[paar] * T / CF.player.speed;
      const f = Buehne.raetselFenster(wege[paar], CF);
      if (wege[paar] != null && f >= lauf * 1.3 + CF.anker.halten.raetsel + 2 - 1e-9 && f >= CF.anker.paarSoloFenster) fensterOk++; else zuKnapp.push(sch + ' s' + s + ' ' + paar + ': ' + wege[paar] + ' Kacheln, ' + f.toFixed(1) + ' s');
    }
  }
  ok(fensterN >= 36 && fensterOk === fensterN, 'F4: Ruine alle Schablonen × Seeds 1–12 – Laufweg gefunden, Fenster ≥ Laufzeit × 1,3 + Halten + 2 s (' + fensterOk + '/' + fensterN + (zuKnapp.length ? ', ' + zuKnapp.slice(0, 3).join('; ') : '') + ')');
  ok(Buehne.raetselFenster(null, CF) === CF.anker.paarSoloFenster && Buehne.raetselFenster(1, CF) === CF.anker.paarSoloFenster, 'F4: ohne Weg bzw. kurzer Weg -> paarSoloFenster');

  // F4: Testgelände Ruine Seed 1, solo: Schloss A halten, zum Schloss B laufen, halten -> gelöst, Tor offen
  {
    const { g, p, send, karte } = testgelaende({ art: 'ruine', seed: 1 });
    const rs = karte.anker.filter((a) => a.rolle === 'raetsel').sort((a, b) => (a.id < b.id ? -1 : 1));
    const fenster = Anker.paarFenster(g, karte, rs[0].paar);
    ok(rs.length === 2 && fenster > CF.anker.paarSoloFenster, 'F4: Ruine s1 Fenster aus dem Laufweg ' + fenster.toFixed(1) + ' s (Weg ' + Buehne.raetselWege(karte)[rs[0].paar] + ' Kacheln)');
    const hin = laufe(g, p, send, nachbarn(g, rs[0]), 90);
    const t0 = g.time;
    halten(g, send, CF.anker.halten.raetsel + 0.3);
    const zA = Anker.zustand(g, g.away.map, rs[0].id);
    const lauf = laufe(g, p, send, nachbarn(g, rs[1]), 90);
    const tLauf = g.time - t0;
    halten(g, send, CF.anker.halten.raetsel + 0.3);
    const zB = Anker.zustand(g, g.away.map, rs[1].id);
    const tor = karte.anker.find((a) => a.rolle === 'tor');
    ok(hin && zA === 'gehalten' && lauf, 'F4 solo: Schloss A gehalten, zu Fuß zu Schloss B (' + tLauf.toFixed(1) + ' s)');
    ok(zB === 'geloest' && Anker.zustand(g, g.away.map, rs[0].id) === 'geloest' && (!tor || Anker.zustand(g, g.away.map, tor.id) === 'offen'), 'F4 solo: Ruine s1 gelöst, Tor offen (Fenster ' + fenster.toFixed(1) + ' s)');
    ok(g.errors === 0, 'F4: keine Server-Fehler');
    // Client-Form (awayMap + render.js registerAwayMap) ergibt dasselbe Solo-Fenster wie der Server (alle Ruinen-Seeds 1–12)
    {
      const stub = new Proxy({}, { get: (t, kk) => (kk === 'measureText' ? () => ({ width: 0 }) : () => {}), set: () => true });
      const win = { Shared_Maps: require('../shared/maps.js'), Shared_Physics: require('../shared/physics.js'), Shared_Config: CF, Shared_Protocol: require('../shared/protocol.js'), Shared_Buehne: Buehne,
        document: { createElement: () => ({ getContext: () => stub, style: {} }), querySelector: () => null, head: { appendChild() {} }, getElementById: () => null },
        console, Image: function () {}, performance: { now: () => 0 } };
      win.window = win; win.self = win;
      vm.createContext(win);
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'render.js'), 'utf8'), win, { filename: 'render.js' });
      let gleich = 0, alle = 0; const abw = [];
      for (const sch of Buehne.schablonen('ruine').map((x) => x.id || x)) for (let s = 1; s <= 12; s++) {
        let kk; try { kk = Buehne.bauen({ spiel: true, art: 'ruine', schablone: sch, seed: s, id: 'test.' + sch + s }); } catch (e) { continue; }
        const M = win.Render.registerAwayMap(Game.prototype.awayMapPayload.call({}, kk));
        for (const paar of Object.keys(Buehne.raetselWege(kk))) {
          alle++;
          const fs1 = Buehne.raetselSoloFenster(kk, paar, CF), fc = Buehne.raetselSoloFenster(M, paar, CF);
          if (Math.abs(fs1 - fc) < 1e-9) gleich++; else abw.push(sch + ' s' + s + ': ' + fs1.toFixed(1) + '/' + fc.toFixed(1));
        }
      }
      ok(alle >= 36 && gleich === alle, 'F4: Solo-Fenster Server = Client (Client-Kartenform) ' + gleich + '/' + alle + (abw.length ? ' ' + abw.slice(0, 3).join('; ') : ''));
    }
    ok(Buehne.raetselSolo([{ connected: true, zone: 'away' }, { connected: true, zone: 'ship' }]) && !Buehne.raetselSolo([{ connected: true, zone: 'away' }, { connected: true, zone: 'away' }]) &&
      Buehne.raetselSolo([{ connected: true, zone: 'away' }, { connected: false, zone: 'away' }]), 'F4: solo = genau 1 verbundener Spieler im Außenteam');
    // zu zweit im Außenteam: enges Gruppenfenster (Koop, beide gleichzeitig)
    const c2 = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c2); g.handleMessage(c2, { t: 'hello', clientId: 'F1', name: 'F1', color: 1 });
    const p2 = g.players.find((q) => q !== p); if (p2) { p2.zone = 'away'; p2.x = p.x; p2.y = p.y; }
    const zwei = g.players.filter((q) => q.connected && q.zone === 'away').length;
    ok(zwei === 2 && Anker.paarFenster(g, karte, rs[0].paar) === CF.anker.paarFenster, 'F4 zu zweit: enges Fenster ' + Anker.paarFenster(g, karte, rs[0].paar) + ' s (' + zwei + ' Spieler)');
    ok(Buehne.raetselHinweis(true, 27.5) === 'nacheinander, 27 s Zeit' && Buehne.raetselHinweis(false) === 'beide gleichzeitig!', 'F4: Hinweis solo/Gruppe aus shared/buehne.js');
  }

  // F5: Testgelände Schiff Seed 1 – zum Lift laufen, E tippen -> anderes Deck; Angebot auch vom Nachbarfeld
  {
    const { g, p, send, karte } = testgelaende({ art: 'schiff', seed: 1, bauweise: 'germanen', besitz: 'kontor' });
    const deckOf = (y) => Math.floor(y / Buehne.SCHIFF_STRIDE);
    const start = Physics.toTile(p.x, p.y);
    const lift = karte.anker.find((a) => a.rolle === 'lift' && deckOf(a.y) === deckOf(start.y));
    const da = laufe(g, p, send, [{ x: lift.x, y: lift.y }], 60);
    const auf = Physics.toTile(p.x, p.y);
    ok(da && auf.x === lift.x && auf.y === lift.y, 'F5: Figur läuft auf das Lift-Feld (' + lift.id + ' ' + lift.x + ',' + lift.y + ')');
    send({ t: 'act', down: true }); send({ t: 'act', down: false });
    ok(!!(p.lift && p.lift.away), 'F5: E tippen auf dem Lift startet die Fahrt');
    for (let i = 0; i < 90; i++) g.step();
    const nach = Physics.toTile(p.x, p.y);
    ok(!p.lift && deckOf(nach.y) !== deckOf(lift.y), 'F5: angekommen auf dem anderen Deck (' + nach.x + ',' + nach.y + ')');
    // Rückweg vom Nachbarfeld des Gegenstücks (Reichweite wie andere Anker, Regel shared/buehne.js deckLinkInReichweite)
    const gegen = karte.anker.find((a) => a.rolle === 'lift' && a !== lift && deckOf(a.y) === deckOf(nach.y));
    const nb = nachbarn(g, gegen);
    const da2 = laufe(g, p, send, nb, 30);
    const its = Interior.interactionsAt(g, p, gegen.x, gegen.y, false);
    ok(da2 && its.some((i) => i.kind === 'lift') && Buehne.deckLinkInReichweite(Physics.toTile(p.x, p.y).x, Physics.toTile(p.x, p.y).y, gegen.x, gegen.y), 'F5: Lift vom Nachbarfeld angeboten');
    ok(!Buehne.deckLinkInReichweite(0, 0, 2, 0) && Buehne.deckLinkInReichweite(1, 1, 2, 2), 'F5: Reichweite = Feld + 8 Nachbarn');
    // Vorrang: auf dem Lift mit Blick zum Nachbar-Terminal -> Lift (Schiff s1: antrieb.lift 2,2, antrieb.terminal 1,2)
    for (let i = 0; i < 60; i++) g.step();
    const term = karte.anker.find((a) => a.rolle === 'terminal' && Math.abs(a.x - lift.x) + Math.abs(a.y - lift.y) === 1 && deckOf(a.y) === deckOf(lift.y));
    const lc = Physics.tileCenter(lift.x, lift.y); p.x = lc.x; p.y = lc.y; p.lift = null; p.hold = null;
    p.dir = term.x < lift.x ? 'left' : term.x > lift.x ? 'right' : term.y < lift.y ? 'up' : 'down';
    ok(Buehne.interaktionsVorrang(karte, lift.x, lift.y) === 'eigen' && Buehne.interaktionsVorrang(karte, term.x, term.y) === 'blick', 'F5: interaktionsVorrang eigen auf dem Lift, blick daneben');
    send({ t: 'act', down: true }); send({ t: 'act', down: false });
    ok(!!(p.lift && p.lift.away), 'F5: auf dem Lift mit Blick zum Terminal (' + term.id + ') -> Lift, nicht Download');
    ok(g.errors === 0, 'F5: keine Server-Fehler');
  }
  // F9a: Modul mit Prüffehlern wird nie verbaut und gemeldet
  {
    const d = klon(Buehne.ladeVerzeichnis(FIX));
    const vorlage = d.module.find((m) => m.id === 'ruine.feld.a');
    const kaputt = klon(vorlage); kaputt.id = 'ruine.feld.kaputt'; kaputt.gewicht = 50;
    kaputt.anker = kaputt.anker.slice(); kaputt.anker[4] = '....t...'; kaputt.anker_legende = Object.assign({}, kaputt.anker_legende, { t: { rolle: 'terminal' } });   // Terminal auf Deckung O -> K-ANKER-WAND (nicht sperrend, „trotzdem speichern“)
    d.module.push(kaputt);
    const pk = Buehne.pruefeModul(kaputt, { daten: d });
    const fm = Buehne.fehlerhafteModule('ruine', d);
    let benutzt = 0, gebaut = 0;
    for (let s = 1; s <= 12; s++) { try { const k = Buehne.bauen({ art: 'ruine', schablone: 'ruine.test', seed: s, daten: d }); gebaut++; if (Object.values(k.plaetze).some((p) => p.modul === kaputt.id)) benutzt++; } catch (e) { /* Fixture-Seed ohne Bau */ } }
    ok(!pk.ok && fm.length === 1 && fm[0].id === kaputt.id, 'F9: fehlerhaftes Modul erkannt (' + (pk.fehler[0] && pk.fehler[0].code) + ')');
    ok(gebaut > 0 && benutzt === 0, 'F9: Modul mit Prüffehlern nie verbaut (' + gebaut + ' Bauten, Gewicht 50)');
  }
  // F8: Werkstatt-Routen – Lesen immer, Speichern nur mit WERKSTATT=1
  {
    const WS = require('../server/werkstatt.js');
    const anfrage = (method, url, opts) => {
      const res = { status: 0, body: null, writeHead(s) { this.status = s; }, end(b) { this.body = b ? JSON.parse(b) : null; } };
      const req = { method, url, headers: { host: 'x', 'content-type': 'application/json' }, on() { } };
      WS.route(req, res, opts);
      return res;
    };
    const lesen = anfrage('GET', '/werkstatt/daten?quelle=content', { speichern: false });
    ok(lesen.status === 200 && lesen.body.speichern === false && lesen.body.schablonen.length > 0, 'F8: /werkstatt/daten ohne WERKSTATT=1 liefert (' + (lesen.body && lesen.body.schablonen.length) + ' Schablonen, speichern=false)');
    const st = anfrage('GET', '/werkstatt/status', { speichern: false });
    ok(st.status === 200 && st.body.aktiv === false && st.body.lesen === true, 'F8: /werkstatt/status aktiv=false, lesen=true');
    const sp = anfrage('POST', '/werkstatt/save', { speichern: false });
    ok(sp.status === 403 && /WERKSTATT=1/.test(sp.body.fehler[0].msg), 'F8: Speichern ohne WERKSTATT=1 -> 403 mit Hinweis');
    const pk = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    ok(/--werkstatt\b/.test(pk.scripts.werkstatt) && /--werkstatt/.test(fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8')), 'F8: npm run werkstatt schaltet Speichern ein (--werkstatt)');
    // F9b: neu laden nach dem Speichern (ohne zu schreiben): Bestand neu, Caches leer
    const vor = Buehne.daten();
    const nl = WS.neuLaden('ruine');
    ok(nl && nl.module > 0 && Buehne.daten() !== vor, 'F9: neuLaden lädt den Modulbestand neu (' + (nl && nl.module) + ' Module, cacheLeeren ' + (nl && nl.cache) + ')');
  }
  // padTiles (shared, eine Quelle mit dem Client): Abholpunkt + begehbare Nachbarn
  {
    const k = Buehne.bauen({ spiel: true, art: 'schiff', seed: 1 });
    const ab = k.anker.find((a) => a.rolle === 'abholpunkt');
    const pt = Buehne.padTiles(k, ab);
    ok(pt[0].x === ab.x && pt[0].y === ab.y && pt.length >= 2 && pt.slice(1).every((t) => !k.legende[k.rows[t.y][t.x]].solid), 'padTiles: Anker + begehbare Nachbarn (' + pt.length + ')');
  }
}

// ---------------- F1/F6 (B1-FIX-LP): Schritt-Aktionen vor der Registrierung, Partie-Reset ----------------
async function f1f6() {
  abschnitt('F1: Besetzung/Anker-Setup vor der Wahl an der Transfer-Konsole');
  const tick = async (n) => { for (let i = 0; i < (n || 1); i++) await new Promise((r) => setImmediate(r)); };
  {   // nicht im Cache: später (setImmediate-Bau), dann einmal nachgeholt; doppelte Anforderung wird zusammengelegt
    const g = fakeGame({ mission: { activeId: 'm_f1' } });
    const id = LP.neu(g, 'kesh', { art: 'ruine', seed: 4711 });
    let n1 = 0, n2 = 0;
    const r1 = LP.sobaldGeladen(g, id, 'besetzen:t', (aw) => { n1++; ok(aw === g.aways[id], 'nachgeholt mit der Laufzeitkarte'); });
    const r2 = LP.sobaldGeladen(g, id, 'besetzen:t', () => { n2++; });
    ok(r1 === 'spaeter' && r2 === 'spaeter' && !g.aways[id], 'ohne Cache: nicht im Aufruf gebaut, nichts registriert');
    await tick(4);
    ok(g.aways[id] && W.AWAY_MAPS[id] && n1 === 1 && n2 === 0, `nach dem Bau (setImmediate) registriert, Aktion genau einmal (${n1}/${n2})`);
    let n3 = 0;
    ok(LP.sobaldGeladen(g, id, 'besetzen:t', () => { n3++; }) === 'jetzt' && n3 === 1, 'registriert: sofort');
    // andere Karten verdrängen die Missionskarte nicht (LRU)
    LP.get(g, 'kesh.grabung'); LP.get(g, 'splitter.schuerflager');
    ok(g.aways[id], 'Karte der laufenden Mission bleibt geladen (LRU)');
  }
  {   // im Cache (Vorbau bei Ankunft): sofort registriert, ohne Bau
    const g = fakeGame({ mission: { activeId: 'm_f1b' } });
    W.unregister('kesh.kastell');   // aus früheren Abschnitten registriert (W.AWAY_MAPS ist prozessweit)
    LP.karte(g, 'kesh.kastell');   // Vorbau füllt den Cache
    let n = 0;
    ok(LP.sobaldGeladen(g, 'kesh.kastell', 'x', () => { n++; }) === 'jetzt' && n === 1 && g.aways['kesh.kastell'], 'Cache-Treffer: sofort registriert und ausgeführt');
    W.unregister('kesh.kastell');
    const g2 = fakeGame();   // frische Partie, Cache aus der vorigen: Treffer über den Ausgangsschlüssel
    ok(LP.bereit(g2, 'kesh.kastell') && g2.aways['kesh.kastell'], 'frische Partie findet die vorgebaute Karte im Cache (bereit)');
  }
  {   // spätestens beim Wählen (waehlen -> get)
    const g = fakeGame({ mission: { activeId: 'm_f1c' } });
    const id = LP.neu(g, 'kesh', { art: 'aussenposten', seed: 4712 });
    let n = 0;
    LP.sobaldGeladen(g, id, 'k', () => { n++; });
    LP.get(g, id);
    ok(n === 1, 'beim Betreten (get) nachgeholt');
    await tick(4);
    ok(n === 1, 'kein zweites Mal nach dem Vorbau');
    // Mission vorbei: ausstehende Aktion entfällt
    const id2 = LP.neu(g, 'kesh', { art: 'ruine', seed: 4713 });
    let n2 = 0;
    LP.sobaldGeladen(g, id2, 'k', () => { n2++; });
    g.mission.activeId = 'andere';
    await tick(4);
    ok(n2 === 0 && g.aways[id2], 'Mission gewechselt: Karte registriert, alte Aktion entfällt');
  }
  {   // Alle Aktionen mit Kartenparameter über mission.act (einziger Weg): auf einer nicht registrierten gebauten Karte
    // laufen sie erst nach der Registrierung, genau einmal, und sehen dann game.aways[lp] (kein „nicht geladen“)
    const Registry = require('../server/mission/registry.js');
    const { Game } = require('../server/game.js');
    const g = new Game({ noStore: true, seed: 7, log: () => {} });
    const fehler = []; g.countError = (w, e) => { fehler.push(w + ': ' + (e && e.message)); };
    g.phase = 'play'; g.mission.activeId = 'm_f1d';
    const ids = Registry.describe().filter((d) => d.art === 'aktion' && Object.values(d.params || {}).some((q) => q && q.typ === 'map')).map((d) => d.id);
    const lp = LP.neu(g, 'kesh', { art: 'ruine', seed: 4714 });
    const gerufen = {}; const sah = {}; const orig = {};
    for (const id of ids) {
      const e = Registry.get(id); orig[id] = e.run;
      // W1 AP4: Kartenparameter heißt nicht immer map (team_gefangen { landepunkt }, Typ map)
      e.run = (m, a) => { const k = a.map || a.landepunkt; gerufen[id] = (gerufen[id] || 0) + 1; sah[id] = !!(g.aways[k] && W.AWAY_MAPS[k]); };
    }
    try {
      const mitKarte = (id) => Object.assign({ do: id, tag: 't', person: 'p' }, ...Object.entries(Registry.get(id).params).filter(([, q]) => q.typ === 'map').map(([n]) => ({ [n]: lp })));
      for (const id of ids) { g.mission.act(mitKarte(id)); g.mission.act(mitKarte(id)); }
      ok(ids.length >= 10 && ids.every((id) => !gerufen[id]), `${ids.length} Aktionen mit Karte: nicht im Aufruf (Karte nicht gebaut, nie im Tick bauen)`);
      await tick(6);
      const falsch = ids.filter((id) => gerufen[id] !== 1 || !sah[id]);
      ok(!falsch.length, 'nach dem Bau je Aktion genau einmal auf der registrierten Karte' + (falsch.length ? ' – abweichend: ' + falsch.map((id) => id + '×' + (gerufen[id] || 0)).join(', ') : ''));
      gerufen.besetzen = 0;
      g.mission.act({ do: 'besetzen', map: lp, tag: 't2' });
      ok(gerufen.besetzen === 1, 'registrierte Karte: sofort');
      gerufen.besetzen = 0;
      g.mission.act({ do: 'besetzen', map: 'kesh', tag: 't3' });
      ok(gerufen.besetzen === 1, 'Handkarte: sofort (Golden unverändert)');
    } finally { for (const id of ids) Registry.get(id).run = orig[id]; }
    ok(!fehler.some((x) => /nicht geladen|unbekannt|keine gebaute/.test(x)), 'kein „nicht geladen“/„unbekannt“' + (fehler.length ? ' (' + fehler.slice(0, 3).join(' | ') + ')' : ''));
    // echter Lauf: spawn_person + besetzen auf hafen.kontor ohne Konsolenwahl (bt7/bt8)
    const g2 = new Game({ noStore: true, seed: 3, log: () => {} });
    const f2 = []; g2.countError = (w, e) => { f2.push(w + ': ' + (e && e.message)); };
    g2.phase = 'play'; g2.mission.activeId = 'm_f1e';
    W.unregister('hafen.kontor'); LP.cacheLeeren('station');
    g2.mission.act({ do: 'besetzen', map: 'hafen.kontor', fraktion: 'rostmeute', staerke: 'gross', haltung: 'ruhig', tag: 'w' });
    g2.mission.act({ do: 'spawn_person', map: 'hafen.kontor', person: 'geisel', name: 'Geisel', anker: 'zelle' });
    ok(!g2.aways['hafen.kontor'], 'hafen.kontor: nicht im Aufruf gebaut');
    await tick(6);
    const aw2 = g2.aways['hafen.kontor'];
    const kacheln = aw2 ? aw2.drones.map((d) => Math.floor(d.x / 32) + ',' + Math.floor(d.y / 32)) : [];
    const geisel = aw2 ? require('../server/sim/away.js').personMit(aw2, 'geisel') : null;   // W2 AP6: Zugriffsfunktion
    ok(aw2 && kacheln.length > 0 && geisel && geisel.present, `hafen.kontor: ${kacheln.length} Wachen und Geisel nachgeholt`);
    ok(new Set(kacheln).size === kacheln.length, 'besetzen: jede Wache auf eigener Kachel (' + kacheln.join(' ') + ')');
    ok(!geisel || !kacheln.includes(Math.floor(geisel.x / 32) + ',' + Math.floor(geisel.y / 32)), 'Geisel nicht auf einer Wachen-Kachel');
    ok(!f2.some((x) => /nicht geladen|unbekannt/.test(x)), 'kein „spawn_person: Karte … nicht geladen“' + (f2.length ? ' (' + f2.slice(0, 3).join(' | ') + ')' : ''));
  }

  abschnitt('F6: Partie zurückgesetzt – Landepunkte leer, Testgelände nie im Weltstand');
  {
    const g = fakeGame();
    const t = LP.testgelaende(g, { art: 'station', seed: 3 });
    LP.get(g, t);
    const fest = LP.get(g, 'kesh.kastell');
    const kiste = W.AWAY_MAPS['kesh.kastell'].karte.anker.find((a) => a.rolle === 'tor');
    if (kiste) Anker.setzen(g, 'kesh.kastell', kiste.id, 'verschlossen', null, { merken: true });
    ok(fest && !(t in LP.toSave(g)) && 'kesh.kastell' in LP.toSave(g), 'toSave: Testgelände-Landepunkt fehlt, fester Landepunkt da');
    LP.zuruecksetzen(g);
    ok(!g.landepunkte && !W.AWAY_MAPS[t] && !W.AWAY_MAPS['kesh.kastell'] && W.AWAY_MAPS.kesh, 'zuruecksetzen: Registrierung und Laufzeitzustand leer, Handkarten bleiben');
    g.aways = { platform: { map: 'platform' }, kesh: { map: 'kesh' } };
    ok(Object.keys(LP.toSave(g)).length === 0 && !LP.liste(g, 'kesh').some((x) => x.id === t), 'neue Partie: kein Eintrag, kein Testgelände-Landepunkt in der Liste');
    const aw = LP.get(g, 'kesh.kastell');
    ok(!kiste || !aw.zustaende[kiste.id] || aw.zustaende[kiste.id] === W.AWAY_MAPS['kesh.kastell'].karte.zustaende[kiste.id] && W.AWAY_MAPS['kesh.kastell'].karte.zustaende[kiste.id] !== 'verschlossen',
      'neue Partie: kein Zustand aus der vorigen Partie (Cache hält nur Rohkarten)');
  }
  {   // cacheLeeren(art) (F9b, Werkstatt)
    const g = fakeGame();
    W.unregister('kesh.kastell');
    LP.karte(g, 'kesh.kastell');
    const g2 = fakeGame();
    ok(LP.cacheLeeren('station') >= 0 && LP.bereit(g2, 'kesh.kastell'), 'cacheLeeren(andere Art) lässt die Ruine im Cache');
    W.unregister('kesh.kastell');
    ok(LP.cacheLeeren('ruine') > 0 && !LP.bereit(fakeGame(), 'kesh.kastell'), 'cacheLeeren(ruine): Ruine nicht mehr im Cache');
  }
  {   // Game.reset ruft zuruecksetzen
    const { Game } = require('../server/game.js');
    const g = new Game({ noStore: true, seed: 5, log: () => {} });
    const id = LP.testgelaende(g, { art: 'ruine', seed: 9 }); LP.get(g, id);
    ok(W.AWAY_MAPS[id] && g.landepunkte, 'vor dem Reset registriert');
    g.reset();
    ok(!W.AWAY_MAPS[id] && !(g.landepunkte && g.landepunkte.dyn && g.landepunkte.dyn[id]), 'Game.reset leert Landepunkte (F6)');
  }
}

// ---------------- K-SILHOUETTE (FIX-TURM): nichts Turmhohes auf begehbaren Kacheln ----------------
abschnitt('K-SILHOUETTE');
{
  const echt = Buehne.silhouetteFehler(Buehne.silhouetteDaten());
  ok(echt.length === 0, 'Inhalt: kein Prop über Figurhöhe auf begehbarer Kachel' + (echt.length ? ' – ' + echt.map((f) => f.msg).join(' | ') : ''));
  const modelle = { 'p/turm': { height: 2.1, footprint: [1, 1] }, 'p/fass': { height: 1, footprint: [1, 1] }, 'p/monitor': { height: 2.15, footprint: [1, 0.25] }, 'p/tank': { height: 1.85, footprint: [1, 1] } };
  const bw = { id: 't', anker: { aussicht: { aussenposten: 'p/turm' }, sprengpunkt: { '*': 'p/turm' }, lift: { '*': 'p/turm' } } };
  const f = Buehne.silhouetteFehler({ bauweisen: [bw], deko: [], modelle });
  ok(f.length === 1 && /aussicht/.test(f[0].msg), 'Wachturm am aussicht-Anker (begehbares Plateau) = K-SILHOUETTE; blockender Objektanker und lift nicht');
  const dk = { id: 't', regeln: { hof: { props: ['p/turm', 'p/fass'], wandnah: false }, korridor: { props: ['p/monitor'], wandnah: true } } };
  const g = Buehne.silhouetteFehler({ bauweisen: [], deko: [dk], modelle });
  ok(g.length === 1 && g[0].id === 'p/turm', 'Deko: hoher Prop auf Hof = Fehler, Fass und schmaler Wandmonitor nicht');
  const D0 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'buehnen', 'bauweisen', 'germanen.json'), 'utf8'));
  ok(!(D0.anker.aussicht && D0.anker.aussicht.aussenposten), 'germanen: kein Wachturm-Prop am aussicht-Anker (Plateau ist der Ausguck)');
}

f1f6().catch((e) => { bad++; n++; console.log('FEHLER (F1/F6):', e && e.stack); }).then(() => {
  console.log(`test-buehne: ${n - bad}/${n} Prüfungen bestanden.`);
  if (bad) { console.log(`${bad} FEHLER.`); process.exit(1); }
});
