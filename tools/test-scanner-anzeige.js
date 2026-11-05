'use strict';
// SCA-01 P4: Anzeige der Scan-Ergebnisse (public/js/scan-anzeige.js, Content content/scanner/datenblaetter.json, Einhängestellen in consoles.js/render.js/index.html/server/index.js).
// Die reine Logik (Einträge -> Anzeigezeilen, Stufen, Fallback, „+n weitere“, Fokus, Marker, Kürzen) läuft direkt; consoles.js und render.js laufen nicht in Node und werden am Quelltext geprüft.
// Das Zusammenspiel im echten Browser zeigt tools/sca01-p4-shots.js.   node tools/test-scanner-anzeige.js  (npm run test:scanner-anzeige)
const fs = require('fs');
const path = require('path');

let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const SA = require('../public/js/scan-anzeige.js');
const DATEN = JSON.parse(read('content/scanner/datenblaetter.json'));
const wirft = (f) => { try { f(); return false; } catch (e) { return true; } };
const reset = () => SA.beobachte([]);

section('Content-JSON');
{
  ok(DATEN.typen && DATEN.arten && DATEN.unbekannt, 'Abschnitte typen, arten, unbekannt');
  for (const t of ['testerz', 'testmonster']) {
    const d = DATEN.typen[t];
    ok(d && typeof d.name === 'string' && d.name && typeof d.zeile === 'string' && d.zeile && typeof d.hinweis === 'string' && d.hinweis && typeof d.symbol === 'string' && d.symbol.length >= 1 && d.symbol.length <= 3, t + ': Name, Zeile, Hinweis, Symbol (1..3 Zeichen)');
    ok(Number.isInteger(d.gefahr) && d.gefahr >= 0 && d.gefahr <= 3 && Number.isInteger(d.hinweisAb) && d.hinweisAb >= 1 && d.hinweisAb <= 3, t + ': gefahr 0..3, hinweisAb 1..3');
    ok(/Platzhalter|Testziel/.test(d.zeile), t + ': deutlich als Platzhalter formuliert');
  }
  ok(DATEN.arten.test && DATEN.arten.test.titel && DATEN.arten.test.symbol, 'Art test (Debug-Testziele) vorhanden');
  ok(DATEN.unbekannt.name === 'Unbekanntes Objekt' && DATEN.unbekannt.symbol, 'Fallback „Unbekanntes Objekt“ mit Symbol');
  ok(Object.values(DATEN.typen).every((d) => Object.keys(d).every((k) => ['name', 'gefahr', 'zeile', 'hinweis', 'hinweisAb', 'symbol'].includes(k))), 'nur die vereinbarten Felder je Typ');
  ok(!JSON.stringify(DATEN).includes('"x"') && !/"(sk|pos|position)"/.test(JSON.stringify(DATEN.typen)), 'der Content trägt keine Stufen- oder Positionsregel');
}

section('Einträge -> Anzeigezeilen je Stufe (Position nur mit x,y)');
{
  reset();
  const z = (r) => SA.zeile(SA.lesen([r])[0], DATEN);
  const z1 = z(['tz3', 'test', 'testmonster', 1]), z2 = z(['tz3', 'test', 'testmonster', 2]), z3 = z(['tz3', 'test', 'testmonster', 3, 224, 96]);
  ok(z1.name === 'Testmonster' && z1.gefahr === 2 && z1.zeile && z1.symbol === 'MO', 'Stufe 1: Name, Gefahr, Zeile, Symbol');
  ok(z1.hinweis === DATEN.typen.testmonster.hinweis && z2.hinweis === z1.hinweis, 'Stufe 1 und 2: Regelhinweis (hinweisAb 1)');
  ok(z1.pos === null && z2.pos === null, 'Stufe 1 und 2: keine Position');
  ok(z3.pos && z3.pos.x === 224 && z3.pos.y === 96 && z3.hinweis, 'Stufe 3 mit x,y: Position und Hinweis');
  ok(z(['a', 'test', 'testerz', 3]).pos === null, 'Stufe 3 OHNE x,y im Eintrag: keine Position (der Client rechnet keine eigene Stufenregel)');
  ok(z(['a', 'erz', 'ader', 1, 32, 64]).pos && z(['a', 'erz', 'ader', 1, 32, 64]).pos.x === 32, 'Position schon bei Stufe 1, wenn der Server x,y liefert (Erz)');
  // hinweisAb aus dem Content: erst ab Stufe 2
  const d2 = { typen: { t: { name: 'T', gefahr: 1, zeile: 'z', hinweis: 'h', hinweisAb: 2, symbol: 'TT' } } };
  const e = (sk) => SA.zeile(SA.lesen([['i', 'a', 't', sk]])[0], d2);
  ok(e(1).hinweis === '' && e(2).hinweis === 'h' && e(3).hinweis === 'h', 'hinweisAb 2 aus dem Content: Stufe 1 ohne, ab 2 mit Hinweis');
  const b = SA.blatt(z3, 32);
  ok(b.position === 'Position: Feld 7 / 3' && b.hatPosition, 'Datenblatt: Position als Feldkoordinate (Kacheln)');
  const b1 = SA.blatt(z1, 32);
  ok(b1.position === SA.TXT_KEINE_POS && !b1.hatPosition && /höherer Scan/.test(b1.position), 'Datenblatt ohne Position: „Position unbekannt – höherer Scan nötig“');
  ok(SA.blatt(null) === null, 'kein Eintrag: kein Datenblatt');
  ok(SA.sterne(0) === '[---]' && SA.sterne(1) === '[*--]' && SA.sterne(3) === '[***]' && SA.sterne(9) === '[***]' && SA.sterne(-2) === '[---]', 'Stufe als Sterne wie sterne() im Entschlüsseln');
}

section('Fallback: unbekannte art/typ, kaputte Daten (nie ein Wurf)');
{
  reset();
  const u = SA.zeile(SA.lesen([['x1', 'ufo', 'grauer', 2]])[0], DATEN);
  ok(u.name === 'Unbekanntes Objekt' && u.symbol === '??' && u.gefahr === 0 && u.hinweis === '', 'unbekannte Art und Typ: Unbekanntes Objekt');
  const ua = SA.zeile(SA.lesen([['x2', 'erz', 'diamant', 1]])[0], DATEN);
  ok(ua.name === 'Unbekanntes Objekt' && ua.symbol === 'ER' && ua.artTitel === 'Erz', 'bekannte Art, unbekannter Typ: Name unbekannt, Symbol der Art');
  ok(!wirft(() => SA.zeile(SA.lesen([['x3', 'ufo', 'grauer', 2]])[0], null)), 'ohne geladenen Content: kein Wurf');
  ok(SA.zeile(SA.lesen([['x3', 'ufo', 'grauer', 2]])[0], null).name === 'Unbekanntes Objekt', 'ohne geladenen Content: eingebauter Fallback');
  const mull = [null, undefined, 5, 'x', {}, [], [1], ['a', 'b'], ['a', 'b', 'c'], [null, 'a', 'b', 1], ['', 'a', 'b', 1], ['a', 'b', 'c', 'zz'], ['a', 'b', 'c', 1, 'x', 'y'], ['a', 'b', 'c', 1, null, null], ['a', 'b', 'c', 99, 1, 2], ['a'.repeat(100), 'b', 'c', 1]];
  ok(!wirft(() => { SA.lesen(mull); SA.ansicht(mull, 4, DATEN); SA.marker(mull, DATEN); SA.beobachte(mull); }), 'Müll im Snapshot: kein Wurf');
  for (const w of [null, undefined, 5, 'x', {}, true]) ok(!wirft(() => { SA.ansicht(w, 4, DATEN); SA.marker(w, DATEN); SA.beobachte(w); }) && SA.ansicht(w, 4, DATEN).zeilen.length === 0, 'sc = ' + JSON.stringify(w) + ': leer, kein Wurf');
  const l = SA.lesen([['a', 'b', 'c', 99, 1, 2], ['a', 'b', 'c', 1, 'x', 'y'], ['a', 'b', 'c', 1, null, null]]);
  ok(l[0].sk === 3 && l[1].x === undefined && l[2].x === undefined, 'Stufe geklemmt auf 3; nicht-numerische oder fehlende Position zählt nicht');
  const kaputt = { typen: { t: { name: 5, gefahr: 'viel', hinweisAb: 'x', symbol: null } }, arten: null };
  ok(!wirft(() => SA.zeile(SA.lesen([['i', 'a', 't', 1]])[0], kaputt)) && SA.zeile(SA.lesen([['i', 'a', 't', 1]])[0], kaputt).gefahr === 0, 'kaputter Content: kein Wurf, Gefahr 0');
  ok(SA.marker([['m', 'ufo', 'grauer', 3, 10, 20]], DATEN)[0].symbol === '??', 'Marker unbekannter Art: Symbol ??');
}

section('Leeres away.sc -> keine Ausgabe');
{
  reset();
  for (const leer of [undefined, null, []]) {
    const v = SA.ansicht(leer, 4, DATEN);
    ok(v.zeilen.length === 0 && v.rest === 0 && v.fokus === null && SA.marker(leer, DATEN).length === 0, 'sc = ' + JSON.stringify(leer) + ': keine Zeilen, kein Fokus, keine Marker');
  }
  ok(SA.fokusKey() === null, 'kein Fokus ohne Ergebnis');
}

section('Mehr als 4 Einträge -> „+n weitere“, Fokus immer sichtbar');
{
  reset();
  const sc = [];
  for (let i = 1; i <= 7; i++) sc.push(['t' + i, 'test', i % 2 ? 'testerz' : 'testmonster', 1]);
  SA.beobachte(sc);
  const v = SA.ansicht(sc, SA.MAX_ZEILEN, DATEN);
  ok(SA.MAX_ZEILEN === 4 && v.zeilen.length === 4 && v.rest === 3, '7 Einträge: 4 Zeilen, rest 3 (+3 weitere)');
  ok(v.zeilen.includes(v.fokus) && v.fokus.id === 't7', 'der zuletzt erfasste Eintrag ist Fokus und steht in den Zeilen (auch wenn er hinten liegt)');
  ok(new Set(v.zeilen.map((z) => z.key)).size === 4, 'keine Zeile doppelt');
  const v4 = SA.ansicht(sc.slice(0, 4), 4, DATEN), v5 = SA.ansicht(sc.slice(0, 5), 4, DATEN);
  ok(v4.rest === 0 && v5.rest === 1 && v5.zeilen.length === 4, '4 Einträge: kein „weitere“; 5 Einträge: +1');
  SA.waehle('test:t2');
  const v2 = SA.ansicht(sc, 4, DATEN);
  ok(v2.fokus.id === 't2' && v2.zeilen.includes(v2.fokus) && v2.rest === 3, 'angeklickter Eintrag wird Fokus und bleibt sichtbar');
  ok(SA.ansicht(sc, 1, DATEN).zeilen.length === 1 && SA.ansicht(sc, 1, DATEN).zeilen[0].id === 't2', 'auch bei einer einzigen Zeile ist der Fokus die Zeile');
}

section('Fokus-Wahl');
{
  reset();
  SA.beobachte([['a', 'test', 'testerz', 1]]);
  ok(SA.fokusKey() === 'test:a', 'erster Eintrag wird Fokus');
  SA.beobachte([['a', 'test', 'testerz', 1], ['b', 'test', 'testerz', 1]]);
  ok(SA.fokusKey() === 'test:b', 'neu erfasster Eintrag wird Fokus');
  SA.waehle('test:a');
  SA.beobachte([['a', 'test', 'testerz', 1], ['b', 'test', 'testerz', 1]]);
  ok(SA.fokusKey() === 'test:a', 'gewählter Fokus bleibt über Snapshots stehen');
  SA.beobachte([['a', 'test', 'testerz', 1], ['b', 'test', 'testerz', 3, 5, 6]]);
  ok(SA.fokusKey() === 'test:b', 'ein Eintrag, dessen Stufe steigt, wird Fokus');
  SA.waehle('test:gibtsnicht'); SA.waehle(null); SA.waehle(42);
  ok(SA.fokusKey() === 'test:b', 'Wahl eines unbekannten Eintrags wird ignoriert');
  SA.beobachte([['a', 'test', 'testerz', 1]]);
  ok(SA.fokusKey() === 'test:a', 'verschwindet der Fokus-Eintrag, springt der Fokus auf einen vorhandenen');
  SA.beobachte(undefined);
  ok(SA.fokusKey() === null, 'leeres sc setzt den Fokus zurück (neue Karte)');
  SA.beobachte([['a', 'test', 'testerz', 1]]);
  ok(SA.fokusKey() === 'test:a', 'nach dem Zurücksetzen gilt ein alter Eintrag wieder als neu');
}

section('Marker: nur mit Position');
{
  reset();
  const sc = [['a', 'test', 'testerz', 1], ['b', 'test', 'testerz', 3, 64, 96], ['c', 'test', 'testmonster', 3, 128, 32]];
  SA.beobachte(sc);
  const m = SA.marker(sc, DATEN);
  ok(m.length === 2 && m.every((x) => x.x !== undefined && x.y !== undefined) && !m.some((x) => x.key === 'test:a'), 'Stufe 1 ohne x,y: kein Marker; mit x,y: Marker');
  ok(m.find((x) => x.key === 'test:c').fokus === true && m.find((x) => x.key === 'test:b').fokus === false && m.find((x) => x.key === 'test:c').symbol === 'MO', 'Marker trägt Kürzel und Fokus');
  ok(SA.marker([['a', 'test', 'testerz', 1]], DATEN).length === 0, 'nur Stufe 1: kein Marker');
}

section('Texte nie über die Breite');
{
  const meas = (t) => String(t).length * 6;   // Pixelschrift: 6 px je Zeichen
  for (const w of [30, 60, 90, 140]) for (const t of ['Unbekanntes Objekt', 'Testmonster', 'x', '', 'Ein sehr langer Name eines Ziels mit vielen Wörtern dran']) {
    const k = SA.kuerze(t, w, meas);
    if (meas(k) > w && k.length > 4) { ok(false, 'Breite ' + w + ': „' + t + '“ -> „' + k + '“ ist zu breit'); }
  }
  ok(SA.kuerze('Unbekanntes Objekt', 100, meas).endsWith('...') && meas(SA.kuerze('Unbekanntes Objekt', 100, meas)) <= 100, 'zu langer Text endet mit „...“ und passt in die Breite');
  ok(SA.kuerze('Testmonster', 100, meas) === 'Testmonster', 'passender Text bleibt unverändert');
  ok(SA.kuerze('', 10, meas) === '' && !wirft(() => SA.kuerze(null, 10, meas)), 'leerer/fehlender Text: kein Wurf');
  // Quelltext: Liste und Datenblatt kürzen bzw. umbrechen nach Pixelbreite, der Block bleibt unter der Frachtleiste
  const c = read('public/js/consoles.js');
  ok(/SA\.kuerze\(z\.name, LW - 16 - 52 - 3, meas\)/.test(c) && /SA\.kuerze\(blk\.b\.titel, SW - 24, meas\)/.test(c), 'Listenname und Titel werden auf ihre Spalte gekürzt');
  ok(/R\.wrap\(b\.zeile, SW, 1\)/.test(c) && /R\.wrap\(b\.hinweis, SW, 1\)/.test(c) && /R\.wrap\(b\.position, SW, 1\)/.test(c), 'Zeile, Hinweis und Position brechen nach Spaltenbreite um');
  ok(/const MAXL = 7;/.test(c) && /sheet\.length = MAXL - 1;/.test(c), 'Datenblatt hat eine feste Höchstzeilenzahl (endet mit „...“)');
  ok(/const bottom = a\.y \+ a\.h - 12;/.test(c) && /\(bottom - rect\.y - 6 - 11 - blk\.h - 4\)/.test(c), 'die Karte schrumpft so, dass der Block über der Frachtleiste (a.y + a.h - 12) endet');
}

section('Einhängestellen im Quelltext');
{
  const c = read('public/js/consoles.js'), r = read('public/js/render.js'), idx = read('public/index.html'), srv = read('server/index.js'), sa = read('public/js/scan-anzeige.js');
  ok(/<script src="js\/scan-anzeige\.js"><\/script>/.test(idx) && idx.indexOf('js/scan-anzeige.js') < idx.indexOf('js/consoles.js'), 'index.html lädt scan-anzeige.js vor consoles.js');
  ok(/prefix: '\/content\/scanner\/'.*nur: \['datenblaetter\.json'\]/.test(srv), 'server/index.js liefert content/scanner/datenblaetter.json (nur diese Datei) aus');
  const { resolveStatic } = require('../server/index.js');
  ok(!!resolveStatic('/content/scanner/datenblaetter.json') && !resolveStatic('/content/scanner/anderes.json') && !!resolveStatic('/js/scan-anzeige.js'), 'Auslieferung: Content-Datei und Modul erreichbar, andere Dateien im Ordner nicht');
  ok(/fetch\('\/content\/scanner\/datenblaetter\.json'\)/.test(sa), 'der Client lädt den Content von /content/scanner/datenblaetter.json');
  // ohne Ergebnis bleibt der Reiter unverändert: nur über scanAnsicht, kein Platzhalter
  ok(/const scan = this\.scanAnsicht\(away\);/.test(c) && /const blk = scan \? this\.scanMass\(scan, rect\.w\) : null;/.test(c) && /if \(blk\) \{ this\.scanZeichne\(/.test(c), 'capAwayV2: Block und Karten-Schrumpfen nur mit Ergebnissen (blk), sonst unveränderter Pfad');
  ok(/if \(!SA \|\| !away \|\| !Array\.isArray\(away\.sc\) \|\| !away\.sc\.length\) return null;/.test(c), 'ohne away.sc oder ohne Modul: null, keine Platzhalterzeile');
  ok(/for \(const m of mp\.scanRects \|\| \[\]\)/.test(c) && /ScanAnzeige\.waehle\(m\.key\)/.test(c), 'awayMapClick: Marker-Treffer wählt den Fokus, der Befehl wird danach unverändert gesetzt');
  ok(c.indexOf('ScanAnzeige.waehle(m.key)') < c.indexOf("if (kind === 'fokus') {", c.indexOf('awayMapClick(view')), 'awayMapClick: Marker-Wahl steht vor der Befehlsverzweigung, ersetzt aber keinen Zweig');
  ok(/scanRects, cell: c/.test(r) && /scanMarker\(st\)/.test(r), 'drawAwayCommandMap liefert scanRects und zeichnet scanMarker');
  ok((r.match(/drawScanMarkerBoden\(/g) || []).length === 3 && /report\('Render\.scanMarker2d'/.test(r) && /report\('Render\.scanMarker3d'/.test(r), 'Bodenmarker im 2D- und im Voxel-Pfad (beide hinter try/report)');
  ok(/for \(const m of scanMarker\(st\)\) \{ const mx = /.test(r), 'Bodenmarker auch in der Minikarte');
  ok(/PAL\.ice/.test(r.slice(r.indexOf('function drawScanMarkerBoden'), r.indexOf('function drawScanMarkerBoden') + 900)), 'Bodenmarker in Eisblau (PAL.ice)');
  // Architektur: keine Stufenregel im Client
  ok(!/sk\s*(>=|>|<=|<|===|==)\s*[23]\b/.test(sa) && !/\.sk\s*(>=|>)\s*\d/.test(sa.replace(/hinweisAb/g, '')), 'scan-anzeige.js enthält keine feste Stufenregel (Position nur über x,y, Hinweis über hinweisAb aus dem Content)');
  ok(!/Math\.hypot|reichweite/.test(sa), 'keine Reichweitenrechnung im Client');
  ok(!/scantest|scanfertig/.test(c + r + sa), 'Debug-Kommandos kommen im Client-Code nicht vor');
}

console.log(fails ? '\n' + fails + ' FEHLER' : '\nalles ok');
process.exit(fails ? 1 : 0);
