'use strict';
// TEL-01 D1: Mutationsprobe zu tools/test-auswertung.js (Muster: mutation-telemetrie-b2.js).
// Kopiert server/, shared/, content/ und tools/ in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Stelle und verlangt, dass test-auswertung rot wird
// (Exit 1 MIT FEHLER-Zeile; ein Absturz oder Syntaxfehler zaehlt nicht als erkannt). Jeder Anker muss genau einmal im Quelltext stehen (sonst Exit 2). --trocken prueft nur die Anker.
// Der Test laeuft mit AUSWERTUNG_SCHNELL=1 (ohne die Bot-Laeufe; Mini-Protokoll, Rotation, Basis, Ziele und Zeilendeckel pruefen die Stellen).
//   node tools/mutation-auswertung.js [--trocken] [begriff ...]      (npm test haengt es ein; npm run test:auswertung-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const T0 = Date.now();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-auswertung-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
for (const rel of ['server', 'shared', 'content', 'tools']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
for (const rel of ['public', 'node_modules']) { if (fs.existsSync(path.join(ROOT, rel))) { try { fs.symlinkSync(path.join(ROOT, rel), path.join(TMP, rel), 'junction'); } catch (e) { /* nicht noetig */ } } }

const KZ = 'tools/auswertung/kennzahlen.js', BE = 'tools/auswertung/bericht.js', BW = 'tools/auswertung/bewertung.js', PR = 'tools/auswertung/profil.js', LE = 'tools/auswertung/lesen.js';
const T = 'test-auswertung.js';
const BA = 'tools/auswertung/basis.js', TB = 'test-basis.js';   // TEL-01 C: Basis und Schwelle gegen die Basis-Gruppe
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, Test]
const MUTATIONEN = [
  // --- Quote: Schuesse mit Treffer / Schuesse (nicht Treffer / Schuesse); Wirkungsquote ---
  [KZ, "if (!rec.treffer) rec.g.mit++;", "rec.g.mit++;", 'Quote zaehlt Treffer statt Schuesse mit Treffer (Flaechenwaffe ueber 100 %)', T],
  [KZ, "pct(g.mit, g.schuesse)", "pct(g.treffer, g.schuesse)", 'Quote = Treffer / Schuesse', T],
  [KZ, "rec.treffer++; rec.g.treffer++;", "rec.treffer++;", 'Flaechenwaffe: Treffer je Schuss ohne die Mehrfachtreffer', T],
  [KZ, "if (z.treffer === true) rec.treffer = 1;", "if (z.treffer === true) rec.treffer = 0;", 'Raum-Lanze ohne pid: Ergebnis aus dem Schuss wird ignoriert', T],
  [KZ, "new Set(['abgeprallt', 'ausgewichen'])", "new Set(['abgeprallt'])", 'Wirkungsquote: ausgewichen zaehlt als wirkend', T],
  [KZ, "if (!rec.wirkt && !NICHT_WIRKEND.has(z.ergebnis)) { rec.wirkt = true; rec.g.wirkt++; }", "if (!rec.wirkt) { rec.wirkt = true; rec.g.wirkt++; }", 'Wirkungsquote: abgeprallt zaehlt als wirkend (= Quote)', T],
  [KZ, "put(o, 'zeit_bis_kill.' + k, median(zeiten[k]));", "put(o, 'zeit_bis_kill.' + k, Math.max(...zeiten[k]));", 'Zeit bis Kill: Maximum statt Median', T],
  [KZ, "put(o, 'zeit_bis_kill.' + k, median(zeiten[k]));", "put(o, 'zeit_bis_kill.' + k, summe(zeiten[k]) / zeiten[k].length);", 'Zeit bis Kill: Mittel statt Median', T],
  // --- Schaden je Ort, Eigenbeschuss ---
  [KZ, "const aus = eigen(z.von) && z.ziel === 'gegner';", "const aus = eigen(z.von);", 'Schaden aus: Eigenbeschuss (p1 -> p2) zaehlt als aus', T],
  [KZ, "ein ? (eigen(z.von) ? 'eigen' : 'ein') : null;", "ein ? 'ein' : null;", 'Schaden ein: Eigenbeschuss zaehlt als ein', T],
  [KZ, "const ein = eigen(z.ziel);", "const ein = eigen(z.ziel) && z.von === 'gegner';", 'Schaden ein: Objekte/Brocken (von objekt) fehlen', T],
  [KZ, "Math.max(0, z.schaden - (num(z.schild) ? z.schild : 0))", "z.schaden", 'Schaden wirkt (Raum aus) ohne Abzug des Schildverlusts (doppelt gezaehlt)', T],
  // --- Marken (stand) ---
  [KZ, "gesetzt[k + '.' + sk(z.grund)] = z.stand;", "gesetzt[k + '.' + sk(z.grund)] = z.stand; c.netto += bt ? z.betrag : 0;", 'Buchungssummen/netto zaehlen auch art stand (Testmarken)', T],
  [KZ, "if (c.buchungen === 0) c.vorStand = z.stand;", "if (c.buchungen === 0 && c.vorStand === null) c.vorStand = z.stand;", 'Anfang = ERSTE stand-Zeile statt der letzten vor der ersten Buchung', T],
  [KZ, "else if (c.ende !== null) c.gesetzt += z.stand - c.ende;", "", 'stand-Zeile nach der ersten Buchung (gesetzt) fehlt: anfang + netto != ende', T],
  [KZ, "if (c.ende !== null) c.gesetzt += z.stand - (bt ? c.ende + z.betrag : c.ende);", "if (false) c.gesetzt += 0;", 'nicht protokollierter Sprung in der Kette fehlt in gesetzt', T],
  [KZ, "(st && bt ? z.stand - z.betrag : (st ? z.stand : null))", "(st && bt ? z.stand - z.betrag : null)", 'kaputter Betrag in der ersten Buchung: kein Anfang', T],
  [KZ, "} else if (z.art === 'buchung') {", "} else {", 'unbekannte Art zaehlt als Buchung', T],
  // --- Spielerzahl, Nachzuegler ---
  [KZ, "const istNachzuegler = (z, nach) => z.nachzuegler === true && num(z.t) && z.t > nach;", "const istNachzuegler = (z, nach) => z.nachzuegler === true;", 'Nachzuegler ohne Zeitbedingung (Beitritt beim Start zaehlt mit)', T],
  [KZ, "if (f && num(verbunden(f))) sz.spielerzahl = verbunden(f);", "if (false) sz.spielerzahl = verbunden(f);", 'Spielerzahl der Szene aus szene_start statt aus dem ersten Fenster', T],
  [KZ, "spielerzahl: sp, spielerzahl_kopf:", "spielerzahl: k.spielerzahl == null ? null : k.spielerzahl, spielerzahl_kopf:", 'Kopfauszug: spielerzahl nicht bereinigt (Rohwert)', T],
  // --- Rollenzeiten, Leerlauf ---
  [KZ, "e.abgang = r.t; return; }", "e.abgang = r.t; }", 'Rollenzeit ohne Abgang (verbunden false zaehlt mit)', T],
  [KZ, "const rolle = ort === 'boden' ? 'boden' : (Array.isArray(r.station) && r.station[i] ? sk(r.station[i]) : 'ohne');", "const rolle = Array.isArray(r.station) && r.station[i] ? sk(r.station[i]) : (ort === 'boden' ? 'boden' : 'ohne');", 'Rollenzeit: Station vor Ort (draussen mit Konsolenrest)', T],
  [KZ, "const LEERLAUF_S = 30;", "const LEERLAUF_S = 10;", 'Leerlauf-Schwelle 10 s statt 30 s', T],
  [KZ, "if (num(a) && num(b) && a + b === 0) { e.lauf += f; aktiv.add(s); } else flush(e);", "if (num(a) && num(b) && a + b >= 0) { e.lauf += f; aktiv.add(s); } else flush(e);", 'Leerlauf: jedes Fenster zaehlt als ohne Eingabe', T],
  [BW, "const LEERLAUF_AUFFAELLIG_ANTEIL = 20;", "const LEERLAUF_AUFFAELLIG_ANTEIL = 0;", 'Leerlauf-Auffaelligkeit ohne Anteilsschwelle', T],
  [BW, "if (kz.kopf && kz.kopf.quelle === 'bot') return [];", "if (false) return [];", 'Leerlauf-Auffaelligkeit auch bei Bots', T],
  // --- Deckung ---
  [KZ, "const inDeckung = num(r.cv) && r.cv > 0;", "const inDeckung = num(r.cv) && r.cv >= 0;", 'in Deckung = cv >= 0 statt cv > 0 (Grundzustand zaehlt)', T],
  [KZ, "if (r.geduckt === true) gd += dauer;", "if (r.geduckt === true) cv += dauer;", 'geduckt wird mit Deckung vermischt', T],
  [KZ, "ersterIn(treffer[slot] || [], ep.t, bis - 1e-9)", "ersterIn(treffer[slot] || [], ep.t, tEnde)", 'Verlassen bis Treffer ignoriert die Rueckkehr in Deckung', T],
  [KZ, "if (rueckkehr && bis - ep.t < PEEK_S)", "if (rueckkehr && bis - ep.t < 100)", 'Peek-and-Shoot ohne die 3-s-Grenze', T],
  [KZ, "else if (!inDeckung && r.ende != null) abschliessen(r.t, false);", "else if (!inDeckung && r.ende != null) abschliessen(r.t, true);", 'Deckung: Abschlusszeile ende zaehlt als Rueckkehr (Peek)', T],
  [KZ, "if (ersterIn(schuesse[slot] || [], ep.t, bis) !== null) peekSchuss++;", "if (Object.values(schuesse).some((a) => ersterIn(a, ep.t, bis) !== null)) peekSchuss++;", 'Peek-and-Shoot: Schuss irgendeines Slots zaehlt', T],
  [KZ, "for (const z of L(d, 'treffer')) if (z.ort === 'boden' && SLOT.test(z.ziel))", "for (const z of L(d, 'treffer')) if (SLOT.test(z.ziel))", 'Deckung: Treffer im Raum zaehlen als erlittener Treffer am Boden', T],
  [KZ, "if (!eigen(z.von)) (treffer[z.ziel]", "if (true) (treffer[z.ziel]", 'Deckung: Eigenbeschuss zaehlt als erlittener Treffer', T],
  [KZ, "rows[i - 1].x !== r.x || rows[i - 1].y !== r.y || r.verdeckt !== true", "rows[i - 1].x !== r.x || rows[i - 1].y !== r.y", 'bewegt_n: nur Kachelwechsel (nicht verdeckt zu Beginn faellt weg)', T],
  [KZ, "rows[i - 1].x !== r.x || rows[i - 1].y !== r.y || r.verdeckt !== true", "r.verdeckt !== true", 'bewegt_n: nur "nicht verdeckt" (Kachelwechsel faellt weg)', T],
  [KZ, "if (proSl[slot] || !(ps[slot].boden > 0)) continue;", "continue;", 'K9: Slot am Boden ohne Deckungszeile hat keine Kennzahl (statt 0 s)', T],
  [KZ, "const auf = tb.filter((z) => SLOT.test(z.ziel) && !eigen(z.von))", "const auf = tb.filter((z) => SLOT.test(z.ziel))", 'Treffer auf Spieler: Eigenbeschuss zaehlt mit', T],
  // --- Reihen, Integritaet ---
  [KZ, "const imRaum = Array.isArray(r.ort) && r.ort.includes('raum');", "const imRaum = true;", 'Reihen ohne Raumfilter (Integritaet ohne Raumfenster)', T],
  [KZ, "const HITZEGRENZE = Config.power.heatLimit;", "const HITZEGRENZE = 50;", 'Hitzegrenze abgeschrieben statt aus shared/config.js', T],
  [KZ, "if (sums.length) { const mx = maxV(sums); if (mx > 0) put(o, 'integritaet.min', pct(minV(sums), mx)); }", "if (sums.length) { const mx = maxV(sums); if (mx > 0) put(o, 'integritaet.min', pct(maxV(sums), mx)); }", 'Integritaet: Maximum statt Minimum', T],
  // --- Technik ---
  [KZ, "put(o, 'tick.med', median(zr.filter((r) => num(r.tick_n) && r.tick_n > 0).map((r) => r.tick_med)), 3);", "put(o, 'tick.med', summe(zr.map((r) => r.tick_med)) / zr.length, 3);", 'Tick-Median als Mittel', T],
  [KZ, "put(o, 'tick.ueber' + g, summe(zr.map((r) => (num(r['tick_ueber' + g]) ? r['tick_ueber' + g] : 0))));", "put(o, 'tick.ueber' + g, maxV(zr.map((r) => (num(r['tick_ueber' + g]) ? r['tick_ueber' + g] : 0))));", 'Tickspitzen: Maximum je Fenster statt Summe', T],
  [KZ, "if (mx.length) put(o, 'tick.max', maxV(mx), 3);", "if (mx.length) put(o, 'tick.max', Math.max(...mx), 3);", 'K7: Spread statt Schleife bei langen Sessions (RangeError)', T],
  [KZ, "d.ende || !d.zeilen.length ? 0 : 1", "0", 'ohne_ende wird nie gesetzt', T],
  // --- Bewertung: Basis, Gewicht, Verluste, Ziele ---
  [BW, "if (diff < info.min || rel < info.rel) continue;", "if (diff < info.min) continue;", 'Basis-Schwelle ohne relativen Anteil (25 %)', T],
  [BW, "if (diff < info.min || rel < info.rel) continue;", "if (rel < info.rel) continue;", 'Basis-Schwelle ohne Mindestmenge', T],
  [BW, "b[k] === 0 ? Math.abs(a[k]) / (info.min > 0 ? info.min : 1)", "b[k] === 0 ? SCORE_MAX", 'Basis = 0: alle Neuzugaenge gleich gewichtet (nicht |a| / min)', T],
  [BW, "if (basisF && k in basisF) continue;", "if (false) continue;", 'Verluste erscheinen mit Basis doppelt (auch als Verlust-Block)', T],
  [BW, "!/session_ende|^Schema-Version/.test(w)", "false", 'Warnungen des Lesers fliessen nicht in den Bericht', T],
  [BW, "if ((num(z.min) && w < z.min) || (num(z.max) && w > z.max)) return 'rot';", "if ((num(z.min) && w > z.min) || (num(z.max) && w > z.max)) return 'rot';", 'Ampel: min-Pruefung falsch herum', T],
  // --- Bericht: Zeilendeckel, Laenge, Kuerzen, Hinweis ---
  [BE, "const ZEILEN_MAX = 60;", "const ZEILEN_MAX = 600;", 'Zeilenlimit 600 statt 60', T],
  [BE, "const ZEILE_MAX_ZEICHEN = 160;", "const ZEILE_MAX_ZEICHEN = 1600;", 'Zeilenlaenge 1600 statt 160 Zeichen', T],
  [BE, "const AUFFAELLIG_MAX = 8;", "const AUFFAELLIG_MAX = 80;", 'Auffaelligkeiten ohne Kuerzung (8 Zeilen)', T],
  [BE, "const BASIS_ZEILEN_MAX = 3;", "const BASIS_ZEILEN_MAX = 30;", 'Basis-Zeilen werden nicht auf 3 begrenzt', T],
  [BE, "'Basis: keine Basis angegeben", "'Basis: Basis vorhanden", 'Hinweis "keine Basis angegeben" fehlt', T],
  // --- Bild ---
  [PR, "const k = v.art + '|' + Math.round(x(v.t));", "const k = Math.round(x(v.t));", 'Verlustmarken: verschiedene Arten einer Spalte werden vermischt', T],
  [PR, "const k = v.art + '|' + Math.round(x(v.t));", "const k = v.art + '|' + v.t;", 'Verlustmarken werden nicht je Pixelspalte zusammengefasst', T],
  [PR, "replace(/[&<>\"']/g,", "replace(/[<>\"']/g,", 'SVG: & wird nicht maskiert (kein wohlgeformtes XML)', T],
  // --- zweite Nacharbeit K1-K8 ---
  ['tools/auswerten.js', "const dir = opt.aus ? path.resolve(opt.aus) :", "const dir = opt.aus ? path.resolve(ROOT, opt.aus) :", 'K1: --aus relativ zum Repo statt zum cwd', T],
  [BE, "' (Median ' + zeit(", "' (Ø ' + zeit(", 'K2: Zeit bis Kill als Ø statt Median', T],
  [KZ, "!(z.ausgang === 'session_ende' && z.dauer_gesamt < 1)", "true", 'K3: leere Abschlussszene geht in n und Mittel ein', T],
  [KZ, "summe(wd) / wd.length", "summe(wd) / wg.length", 'K4: Wellenmittel durch alle Wellen statt die mit Dauer', T],
  [KZ, "  return o;   // Neustarts: nur f3.neustarts", "  put(o, 'neustarts', L(d, 'szene_neustart').length);\n  return o;   // Neustarts: nur f3.neustarts", 'K5: f1.neustarts doppelt zu f3.neustarts', T],
  [KZ, "offen.set(z.sitzung + '|' + s + '|' + sk(z.ort)", "offen.set(s + '|' + sk(z.ort)", 'K6: Schuss-Treffer-Verknuepfung ohne Sitzung (und Seite)', T],
  [KZ, "const sv = seite(z.von);\n      const rec = sv ? offen.get(z.sitzung + '|' + sv + '|' + sk(z.ort) + '|' + z.pid) : null;", "const sv = seite(z.von);\n      const rec = sv ? offen.get(z.sitzung + '|' + 'eigen' + '|' + sk(z.ort) + '|' + z.pid) : null;", 'K6: Treffer der Gegner verknuepfen mit eigenen Schuessen (Seite nicht geprueft)', T],
  [BW, "basis.version === kz.version) return [];", "false) return [];", 'K8: Kennzahl-Version wird nicht verglichen (Zeile immer)', T],
  [BW, "return [{ k: 'kennzahl_version'", "return []; return [{ k: 'kennzahl_version'", 'K8: keine Zeile bei ungleicher Kennzahl-Version', T],
  ['tools/auswerten.js', "delete ohne.listen.reihen;", "", '--json schreibt listen.reihen mit', T],
  // --- Lesen ---
  [LE, "if (letzte) erg.abgeschnitten++; else erg.kaputt++;", "erg.kaputt++;", 'abgeschnittene letzte Zeile wird als kaputt gezaehlt', T],
  [LE, "return out.sort((a, b) => a.n - b.n);", "return out.sort((a, b) => b.n - a.n);", 'Teile einer rotierten Session in falscher Reihenfolge', T],
  // --- TEL-01 C: Basis, Schwelle gegen die Basis-Gruppe, Plattformzeile, Gruppenwahl (test-basis.js) ---
  [BW, "Math.max(info.rel * Math.abs(med), STREUUNG_K * (q3 - q1))", "info.rel * Math.abs(med)", "Basis-Gruppe: Streuung ignoriert (Normalbereich nur rel x Median)", TB],
  [BW, "const aussen = w > mx ? w - mx : (w < mn ? mn - w : 0);", "const aussen = Math.abs(w - med);", "Basis-Gruppe: Min/Max-Grenze der Basis-Seeds fehlt (Abstand vom Median statt von der Spanne)", TB],
  [BW, "if (aussen <= breite) continue;", "", "Basis-Gruppe: Normalbereich (rel, Streuung) fehlt, jeder Wert ausserhalb der Spanne zaehlt", TB],
  [BW, "if (diff < info.min) continue;", "", "Basis-Gruppe: Mindestmenge (min) greift nicht", TB],
  [BW, "info.determ === false) continue;\n    let w = a[k];", "false) continue;\n    let w = a[k];", "Basis-Gruppe: determ false (Technik) wird mitverglichen", TB],
  [BW, "if (!num(w)) { if (ZAEHL_EINHEITEN.has(info.einheit)) w = 0; else { fehlt++; continue; } }", "if (!num(w)) { fehlt++; continue; }", "Basis-Gruppe: fehlender Zaehler im Lauf zaehlt nicht als 0", TB],
  [BW, "if (!p || !bp || p === bp) return [];", "return [];", "Plattformzeile (Basis von anderer Plattform) fehlt", TB],
  [BA, "(num(f[k]) ? f[k] : (fuell ? 0 : null))", "(num(f[k]) ? f[k] : null)", "Basis bauen: fehlender Zaehler wird nicht mit 0 aufgefuellt", TB],
  [BA, "if (i && i.determ !== false) schluessel.add(k);", "if (i) schluessel.add(k);", "Basis bauen: Technik (determ false) kommt in die Basis", TB],
  [BA, "+ '/' + (num(k.spielerzahl) ? k.spielerzahl : '?');", "+ '';", "Gruppenwahl ignoriert die Spielerzahl", TB],
  [BA, "if (basis.kopf.kennzahl_version !== KENNZAHL_VERSION) p.push(", "if (false) p.push(", "Gueltigkeitspruefung: Kennzahl-Version wird nicht verglichen", TB],
  [BA, "if (!info) p.push(id + ': Kennzahl ' + k + ' hat keinen Info-Eintrag');", "if (!info) void 0;", "Gueltigkeitspruefung: Kennzahl ohne Info-Eintrag faellt nicht auf", TB],
  [BE, "else if (b.basis.keine) basisKopf.push('Basis: ' + b.basis.keine);", "", "Bericht: \"keine passende Basis-Gruppe\" steht nicht da", TB],
];

const trocken = process.argv.includes('--trocken');
const filter = process.argv.slice(2).filter((a) => a !== '--trocken');
const lies = (datei) => fs.readFileSync(path.join(ROOT, datei), 'utf8').replace(/\r\n/g, '\n');   // Windows-Checkout mit CRLF: Muster mit \n sollen treffen
let fehlAnker = 0;
for (const [datei, alt, , was] of MUTATIONEN) { const n = lies(datei).split(alt).length - 1; if (n !== 1) { console.log('ANKER ' + n + 'x: ' + was); fehlAnker++; } }
if (fehlAnker) process.exit(2);
if (trocken) { console.log(MUTATIONEN.length + ' Anker, alle genau einmal'); process.exit(0); }

const lauf = (test) => spawnSync(process.execPath, [path.join(TMP, 'tools', test)], { cwd: TMP, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240000, env: Object.assign({}, process.env, { AUSWERTUNG_SCHNELL: '1' }) });
for (const test of new Set(MUTATIONEN.map((m) => m[4]))) {
  const r = lauf(test);
  if (r.status !== 0) { console.log('Ausgangslage ist schon rot (' + test + '):\n' + (r.stdout || '') + (r.stderr || '')); process.exit(1); }
}
let ueberlebt = 0, laeufe = 0;
for (const [datei, alt, neu, was, test] of MUTATIONEN) {
  if (filter.length && !filter.some((f) => was.includes(f))) continue;
  const pfad = path.join(TMP, datei), orig = lies(datei);
  fs.writeFileSync(pfad, orig.split(alt).join(neu));
  const r = lauf(test);
  fs.writeFileSync(pfad, orig);
  laeufe++;
  const out = (r.stdout || '') + (r.stderr || '');
  const rot = r.status === 1 && /FEHLER/.test(r.stdout || '') && !/SyntaxError/.test(out);   // ein Syntaxfehler der Mutation toetet nichts
  if (rot) console.log('getoetet:  ' + was + '  [' + test + ']');
  else { ueberlebt++; console.log((r.status === 0 ? 'UEBERLEBT: ' : 'ABSTURZ (zaehlt nicht): ') + was + '  [' + test + ']'); }
}
console.log(`${laeufe} Mutationen, ${ueberlebt} ueberlebt, ${Math.round((Date.now() - T0) / 100) / 10} s`);
process.exit(ueberlebt ? 1 : 0);
