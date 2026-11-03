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

const KZ = 'tools/auswertung/kennzahlen.js', BE = 'tools/auswertung/bericht.js', LE = 'tools/auswertung/lesen.js';
const T = 'test-auswertung.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, Test]
const MUTATIONEN = [
  // --- Quote: Schuesse mit Treffer / Schuesse (nicht Treffer / Schuesse) ---
  [KZ, "if (!rec.treffer) rec.g.mit++;", "rec.g.mit++;", 'Quote zaehlt Treffer statt Schuesse mit Treffer (Flaechenwaffe ueber 100 %)', T],
  [KZ, "pct(g.mit, g.schuesse)", "pct(g.treffer, g.schuesse)", 'Quote = Treffer / Schuesse', T],
  [KZ, "rec.treffer++; rec.g.treffer++;", "rec.treffer++;", 'Flaechenwaffe: Treffer je Schuss ohne die Mehrfachtreffer', T],
  [KZ, "if (z.treffer === true) rec.treffer = 1;", "if (z.treffer === true) rec.treffer = 0;", 'Raum-Lanze ohne pid: Ergebnis aus dem Schuss wird ignoriert', T],
  [KZ, "put(o, 'zeit_bis_kill.' + k, median(zeiten[k]));", "put(o, 'zeit_bis_kill.' + k, Math.max(...zeiten[k]));", 'Zeit bis Kill: Maximum statt Median', T],
  // --- Rollenzeiten, Leerlauf ---
  [KZ, "e.abgang = r.t; return; }", "e.abgang = r.t; }", 'Rollenzeit ohne Abgang (verbunden false zaehlt mit)', T],
  [KZ, "const LEERLAUF_S = 30;", "const LEERLAUF_S = 10;", 'Leerlauf-Schwelle 10 s statt 30 s', T],
  [KZ, "if (num(a) && num(b) && a + b === 0) { e.lauf += f; aktiv.add(s); } else flush(e);", "if (num(a) && num(b) && a + b >= 0) { e.lauf += f; aktiv.add(s); } else flush(e);", 'Leerlauf: jedes Fenster zaehlt als ohne Eingabe', T],
  // --- Deckung ---
  [KZ, "const inDeckung = num(r.cv) && r.cv > 0;", "const inDeckung = num(r.cv) && r.cv >= 0;", 'in Deckung = cv >= 0 statt cv > 0 (Grundzustand zaehlt)', T],
  [KZ, "if (r.geduckt === true) gd += dauer;", "if (r.geduckt === true) cv += dauer;", 'geduckt wird mit Deckung vermischt', T],
  [KZ, "ersterIn(treffer[slot] || [], ep.t, bis - 1e-9)", "ersterIn(treffer[slot] || [], ep.t, tEnde)", 'Verlassen bis Treffer ignoriert die Rueckkehr in Deckung', T],
  [KZ, "if (rueckkehr && bis - ep.t < PEEK_S)", "if (rueckkehr && bis - ep.t < 100)", 'Peek-and-Shoot ohne die 3-s-Grenze', T],
  // --- Bericht: Zeilendeckel, Basis-Schwelle, Ampel ---
  [BE, "const ZEILEN_MAX = 60;", "const ZEILEN_MAX = 600;", 'Zeilenlimit 600 statt 60', T],
  [BE, "if (diff < info.min || rel < info.rel) continue;", "if (diff < info.min) continue;", 'Basis-Schwelle ohne relativen Anteil (25 %)', T],
  [BE, "if (diff < info.min || rel < info.rel) continue;", "if (rel < info.rel) continue;", 'Basis-Schwelle ohne Mindestmenge', T],
  [BE, "if ((num(z.min) && w < z.min) || (num(z.max) && w > z.max)) return 'rot';", "if ((num(z.min) && w > z.min) || (num(z.max) && w > z.max)) return 'rot';", 'Ampel: min-Pruefung falsch herum', T],
  [BE, "'Basis: keine Basis angegeben", "'Basis: Basis vorhanden", 'Hinweis "keine Basis angegeben" fehlt', T],
  // --- Lesen ---
  [LE, "if (letzte) erg.abgeschnitten++; else erg.kaputt++;", "erg.kaputt++;", 'abgeschnittene letzte Zeile wird als kaputt gezaehlt', T],
  [LE, "return out.sort((a, b) => a.n - b.n);", "return out.sort((a, b) => b.n - a.n);", 'Teile einer rotierten Session in falscher Reihenfolge', T],
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
