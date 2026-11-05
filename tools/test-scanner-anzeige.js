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
  ok(b1.position === SA.TXT_KEINE_POS && !b1.hatPosition && SA.TXT_KEINE_POS === 'Position: erst ab Stufe 3', 'Datenblatt ohne Position: „Position: erst ab Stufe 3“ (eine Zeile)');
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
  ok(SA.kuerze('Unbekanntes Objekt', 100, meas).endsWith('…') && meas(SA.kuerze('Unbekanntes Objekt', 100, meas)) <= 100, 'zu langer Text endet mit „…“ und passt in die Breite');
  ok(SA.kuerze('Testmonster', 100, meas) === 'Testmonster', 'passender Text bleibt unverändert');
  ok(SA.kuerze('', 10, meas) === '' && !wirft(() => SA.kuerze(null, 10, meas)), 'leerer/fehlender Text: kein Wurf');
  // Quelltext: Liste und Datenblatt kürzen bzw. umbrechen nach Pixelbreite, der Block bleibt unter der Frachtleiste
  const c = read('public/js/consoles.js');
  ok(/SA\.kuerze\(z\.name, nameW, meas\)/.test(c) && /SA\.kuerze\(String\(blk\.b\.titel\)\.toUpperCase\(\), /.test(c), 'Listenname und Titel werden auf ihre Spalte gekürzt');
  ok(/SA\.blattZeilen\(b, SW, \(t\) => R\.measure\(t, 1\), SA\.MAXL_BLATT\)/.test(c), 'Zeile, Hinweis und Position brechen nach Spaltenbreite um (SA.blattZeilen, Verhalten unten getestet)');
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
  ok(/\(mp\.scanRects \|\| \[\]\)\.find/.test(c) && /ScanAnzeige\.waehle\(hitS\.key\); return true; \}/.test(c), 'awayMapClick: Marker-Treffer wählt nur den Fokus und kehrt zurück (Verhalten in test-scanner-client getestet)');
  ok(c.indexOf('ScanAnzeige.waehle(hitS.key)') < c.indexOf("if (kind === 'fokus') {", c.indexOf('awayMapClick(view')), 'awayMapClick: Marker-Wahl steht vor der Befehlsverzweigung');
  ok(/scanRects, cell: c/.test(r) && /scanMarker\(st\)/.test(r), 'drawAwayCommandMap liefert scanRects und zeichnet scanMarker');
  ok((r.match(/drawScanMarkerBoden\(/g) || []).length === 3 && /report\('Render\.scanMarker2d'/.test(r) && /report\('Render\.scanMarker3d'/.test(r), 'Bodenmarker im 2D- und im Voxel-Pfad (beide hinter try/report)');
  ok(/for \(const m of scanMarker\(st\)\) \{ const mx = /.test(r), 'Bodenmarker auch in der Minikarte');
  const bodenQ = r.slice(r.indexOf('function drawScanMarkerBoden'), r.indexOf('function scanEckwinkel'));
  ok(/PAL\.ice/.test(bodenQ) && /setLineDash\(\[3, 3\]\)/.test(bodenQ) && !/lineTo\(top/.test(bodenQ) && /SCAN_SCHWEBE = 14/.test(r), 'Bodenmarker: Eisblau, gestrichelter Ring ([3,3]), keine Säule, Raute 14 px über dem Ring (unterscheidet sich von der Flanke)');
  const kartenQ = r.slice(r.indexOf('const scanRects = [];'), r.indexOf('// Außenteam', r.indexOf('const scanRects = [];')));
  ok(!/arc\(/.test(kartenQ) && /scanEckwinkel\(ctx, s\.x, s\.y, 6\)/.test(r) && /m\.fokus \|\| m\.key === opts\.scanHover/.test(r), 'Karte: Fokus als vier Eckwinkel statt Kreis, Kürzel nur für Fokus und Hover');
  // Architektur: keine Stufenregel im Client
  ok(!/sk\s*(>=|>|<=|<|===|==)\s*[23]\b/.test(sa) && !/\.sk\s*(>=|>)\s*\d/.test(sa.replace(/hinweisAb/g, '')), 'scan-anzeige.js enthält keine feste Stufenregel (Position nur über x,y, Hinweis über hinweisAb aus dem Content)');
  ok(!/Math\.hypot|reichweite/.test(sa), 'keine Reichweitenrechnung im Client');
  ok(!/scantest|scanfertig/.test(c + r + sa), 'Debug-Kommandos kommen im Client-Code nicht vor');
}

section('Nacharbeit D2: Content-Längen (name <= 20, zeile <= 34, hinweis <= 100)');
{
  ok(SA.LIMIT.name === 20 && SA.LIMIT.zeile === 34 && SA.LIMIT.hinweis === 100, 'Grenzen im Modul: 20 / 34 / 100');
  ok(/name höchstens 20/.test(DATEN._hinweis) && /zeile höchstens 34/.test(DATEN._hinweis) && /hinweis höchstens 100/.test(DATEN._hinweis), 'die Grenzen stehen im Feld _hinweis des Contents (JSON kennt keinen Kommentar)');
  for (const [t, d] of Object.entries(Object.assign({}, DATEN.typen, { unbekannt: DATEN.unbekannt }))) {
    ok(String(d.name).length <= SA.LIMIT.name && String(d.zeile).length <= SA.LIMIT.zeile && String(d.hinweis || '').length <= SA.LIMIT.hinweis, t + ': name ' + String(d.name).length + ' <= 20, zeile ' + String(d.zeile).length + ' <= 34, hinweis ' + String(d.hinweis || '').length + ' <= 100');
  }
}

section('Nacharbeit D4: Sortierung (Gefahr absteigend, dann Stufe absteigend, stabil) und Fokus-Durchlauf');
{
  reset();
  const D = { typen: { a: { name: 'A', gefahr: 0, zeile: 'z', hinweis: '', symbol: 'AA' }, b: { name: 'B', gefahr: 2, zeile: 'z', hinweis: '', symbol: 'BB' }, c: { name: 'C', gefahr: 3, zeile: 'z', hinweis: '', symbol: 'CC' } } };
  const sc = [['1', 'x', 'a', 1], ['2', 'x', 'b', 1], ['3', 'x', 'c', 1], ['4', 'x', 'b', 3], ['5', 'x', 'a', 3], ['6', 'x', 'b', 3], ['7', 'x', 'a', 1]];
  SA.beobachte(sc);
  const ids = (v) => v.zeilen.map((z) => z.id).join('');
  const alle = SA.ansicht(sc, 12, D);
  ok(ids(alle) === '3462517', 'Gefahr 3 vor 2 vor 0; je Gefahr Stufe 3 vor 1; bei Gleichstand Lieferreihenfolge: ' + ids(alle) + ' (erwartet 3462517)');
  ok(ids(SA.ansicht(sc, 12, D)) === ids(alle), 'gleicher Snapshot, gleiche Reihenfolge (stabil)');
  // der Fokus hängt an der id: die Plätze verschieben sich, der Fokus bleibt auf seinem Eintrag
  const sc2 = sc.concat([['8', 'x', 'c', 1]]);
  SA.beobachte(sc2);
  ok(SA.fokusKey() === 'x:8', 'neuer Eintrag wird Fokus (Regel unverändert)');
  SA.waehle('x:2');
  SA.beobachte(sc2);
  const nach = SA.ansicht(sc2, 12, D);
  ok(nach.fokus.id === '2' && ids(nach).indexOf('2') > ids(nach).indexOf('3'), 'der Fokus bleibt auf Eintrag 2 (Platz: ' + (ids(nach).indexOf('2') + 1) + ')');
  // Durchlauf: jeder Eintrag erreichbar, vor und zurück, umlaufend
  const ordnung = ids(SA.ansicht(sc2, 12, D)).split('').map((i) => 'x:' + i);
  const besucht = [];
  SA.waehle(ordnung[0]);
  for (let i = 0; i < sc2.length; i++) { besucht.push(SA.fokusKey()); SA.fokusWeiter(sc2, 1, D); }
  ok(new Set(besucht).size === sc2.length && besucht.join() === ordnung.join(), 'Taste vor: alle ' + sc2.length + ' Einträge in Listenreihenfolge (auch die hinter „+n weitere“)');
  ok(SA.fokusKey() === ordnung[0], 'nach einer vollen Runde wieder am Anfang (umlaufend)');
  SA.fokusWeiter(sc2, -1, D);
  ok(SA.fokusKey() === ordnung[ordnung.length - 1], 'zurück vom ersten Eintrag: der letzte');
  const rueck = [];
  for (let i = 0; i < sc2.length; i++) { rueck.push(SA.fokusKey()); SA.fokusWeiter(sc2, -1, D); }
  ok(new Set(rueck).size === sc2.length, 'Taste zurück: ebenfalls alle erreichbar');
  // Fenster: der Fokus ist immer sichtbar, die Reihenfolge bleibt
  let alleSichtbar = true, reihenfolge = true;
  for (const k of ordnung) {
    SA.waehle(k);
    const v = SA.ansicht(sc2, 4, D);
    if (!v.zeilen.includes(v.fokus) || v.zeilen.length !== 4 || v.rest !== sc2.length - 4) alleSichtbar = false;
    const rang = v.zeilen.map((z) => ordnung.indexOf('x:' + z.id));
    if (rang.some((r, i) => i && r <= rang[i - 1])) reihenfolge = false;
  }
  ok(alleSichtbar, 'bei 4 Zeilen und 8 Einträgen: jeder Fokus steht in der Liste, rest = 4');
  ok(reihenfolge, 'die sichtbaren Zeilen behalten die Sortierreihenfolge (Fenster statt Austausch der letzten Zeile)');
  ok(SA.fokusWeiter([], 1, D) === null && SA.fokusWeiter(undefined, -1, D) === null && !wirft(() => SA.fokusWeiter('x', 1, D)), 'ohne Einträge: kein Wurf, kein Fokus');
  reset();
}

section('Nacharbeit D2: Datenblatt-Zeilen mit echten Texten (Position bleibt die letzte, unverkürzte Zeile)');
{
  const gut = (px) => (t) => String(t).length * px;
  const REAL_H = 'Panzerung vorn, Schwachstelle am Rücken. Bäume und Felsen halten es auf.';
  const LANG_H = 'Ein überlanger Regelhinweis, der weit mehr als hundert Zeichen hat und deshalb gekürzt werden muss, ohne die Positionszeile zu verdrängen. Wirklich.';
  ok(REAL_H.length <= 100 && LANG_H.length >= 130, 'Testtexte: real ' + REAL_H.length + ' Zeichen, überlang ' + LANG_H.length);
  const mk = (zeile, hinweis, pos) => ({ titel: 'X', gefahr: 1, zeile, hinweis, position: pos ? SA.blatt({ pos, name: 'X', gefahr: 1, zeile: '', hinweis: '' }, 32).position : SA.TXT_KEINE_POS, hatPosition: !!pos });
  for (const px of [3.4, 4.9, 5.6, 7]) for (const SW of [100, 140, 160, 176]) {
    for (const [zeile, h, pos] of [['Schweres Tier, jagt im Rudel.', REAL_H, null], ['Erzader mit hohem Reinheitsgrad', REAL_H, { x: 224, y: 96 }], ['Z'.repeat(34), LANG_H, { x: 1000, y: 2000 }], ['Kurz.', '', { x: 32, y: 32 }], ['Zwei Wörter', LANG_H, null]]) {
      const b = mk(zeile, h, pos), m = gut(px);
      const l = SA.blattZeilen(b, SW, m, SA.MAXL_BLATT);
      const letzte = l[l.length - 1];
      const hl = l.filter((q) => q.art === 'hinweis');
      const fehler = [];
      if (!l.length || l.length > SA.MAXL_BLATT) fehler.push('Zeilenzahl ' + l.length);
      if (letzte.art !== 'pos' || letzte.text !== b.position) fehler.push('Position nicht die unverkürzte letzte Zeile');
      if (l.filter((q) => q.art === 'pos').length !== 1) fehler.push('Position nicht genau einmal');
      for (const q of l) { const bw = q.art === 'hinweis' ? SW - SA.HINWEIS_EINZUG : SW; if (q.art !== 'pos' && m(q.text) > bw) fehler.push('Zeile zu breit: ' + q.text); }
      if (h && hl.join && hl.map((q) => q.text).join(' ') !== h && !hl[hl.length - 1].text.endsWith('…')) fehler.push('gekürzter Hinweis endet nicht mit …');
      ok(!fehler.length, 'px ' + px + ', Breite ' + SW + ', „' + zeile.slice(0, 12) + '“, Hinweis ' + h.length + ' Z.: ' + (fehler.join('; ') || 'passt, Position zuletzt'));
    }
  }
  const m = gut(4.9);
  const l130 = SA.blattZeilen(mk('Panzer.', LANG_H, { x: 96, y: 64 }), 160, m, SA.MAXL_BLATT);
  ok(l130[l130.length - 1].art === 'pos' && l130[l130.length - 1].text === 'Position: Feld 3 / 2' && /…$/.test(l130[l130.length - 2].text), 'Hinweis mit ' + LANG_H.length + ' Zeichen: Hinweis endet mit „…“, Position sichtbar und unverkürzt');
  const lk = SA.blattZeilen(mk('Panzer.', 'Kurz und gut.', null), 160, m, SA.MAXL_BLATT);
  ok(lk.map((q) => q.art).join() === 'zeile,hinweis,pos' && lk[1].text === 'Kurz und gut.' && lk[2].text === 'Position: erst ab Stufe 3', 'kurzer Hinweis bleibt ganz, „Position: erst ab Stufe 3“ in einer Zeile');
  const lz = SA.blattZeilen(mk('A'.repeat(70), LANG_H, null), 100, m, 3);
  ok(lz.length <= 3 && lz[lz.length - 1].art === 'pos', 'auch bei knapper Zeilenzahl (3) bleibt die Position, der Hinweis weicht');
  ok(SA.blattZeilen(null, 100, m, 6).length === 0, 'ohne Datenblatt: keine Zeilen');
  ok(SA.umbruch('Donaudampfschifffahrtsgesellschaftskapitän ' + 'x'.repeat(40), 60, gut(5)).every((q) => gut(5)(q) <= 60), 'umbruch: auch ein einzelnes zu langes Wort bleibt in der Breite');
  ok(JSON.stringify(SA.umbruch('', 50, m)) === '[]' && !wirft(() => SA.umbruch(null, 50, m)), 'umbruch: leer/null ohne Wurf');
}

section('Nacharbeit D4: Tasten für das Datenblatt im Register');
{
  const t = read('public/js/tasten.js');
  ok(/'captain\.aussen\.scanZurueck'[^\n]*\['PageUp'\], 'captain\.aussen'/.test(t) && /'captain\.aussen\.scanVor'[^\n]*\['PageDown'\], 'captain\.aussen'/.test(t), 'captain.aussen.scanZurueck (BildA) und scanVor (BildB) sind umbelegbare Aktionen im Reiter Außenteam');
  const c = read('public/js/consoles.js');
  ok(/code === 'PageUp' \|\| code === 'PageDown'\) \{ this\.scanFokusWeiter\(view, code === 'PageUp' \? -1 : 1\)/.test(c) && /aussenHilfeScan\(\)/.test(c), 'Consoles.keyDown (Reiter Außenteam) ruft scanFokusWeiter; die Hilfezeile nennt die Tasten aus dem Register');
}

console.log(fails ? '\n' + fails + ' FEHLER' : '\nalles ok');
process.exit(fails ? 1 : 0);
