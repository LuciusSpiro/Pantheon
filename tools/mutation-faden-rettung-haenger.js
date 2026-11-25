'use strict';
// SPT-02 12: Mutationsprobe zu tools/test-faden-rettung-haenger.js. Kopiert Server, Shared, Content, public/js und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel
// und verlangt, dass der Test rot wird (Exit != 0). Überlebt eine Mutation, deckt kein Test die Regel ab.
//   node tools/mutation-faden-rettung-haenger.js [--trocken] [begriff …]
//   --trocken: prüft nur, ob jede Textstelle genau einmal gefunden wird (kein Testlauf)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-faden-rettung-haenger-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TEST = 'tools/test-faden-rettung-haenger.js';
fs.copyFileSync(path.join(ROOT, TEST), path.join(TMP, TEST));
fs.copyFileSync(path.join(ROOT, 'tools', 'regie-fixture.js'), path.join(TMP, 'tools', 'regie-fixture.js'));
fs.copyFileSync(path.join(ROOT, 'tools', 'faden-fixture.js'), path.join(TMP, 'tools', 'faden-fixture.js'));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const PR = 'server/sim/faden-pruefer.js', BR = 'server/sim/abenteuer-brett.js', FA = 'server/sim/faden.js', RE = 'server/sim/reise-ereignis.js', CL = 'public/js/brett.js', NB = 'content/faeden/notruf-brett.json', BD = 'content/faeden/abenteuer-brett.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const BR2 = 'server/sim/abenteuer-brett.js', P3 = 'server/sim/faden-p3.js', RE2 = 'server/sim/reise-ereignis.js', NB2 = 'content/faeden/notruf-brett.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  [BR2, '|| ws.tickZahl - f.begonnen < NB.notruf_faden_frist_spruenge) continue;', '|| ws.tickZahl - f.begonnen < 0) continue;', 'a: keine Frist, jeder Notruf-Faden wird sofort beendet'],
  [BR2, '|| ws.tickZahl - f.begonnen < NB.notruf_faden_frist_spruenge) continue;', '|| ws.tickZahl - f.begonnen < 5) continue;', 'b: Zahl im Servercode statt aus den Daten (zu kurz)'],
  [BR2, '|| ws.tickZahl - f.begonnen < NB.notruf_faden_frist_spruenge) continue;', '|| ws.tickZahl - f.begonnen < NB.notruf_faden_frist_spruenge * 1000) continue;', 'c: Frist praktisch unendlich (Faden haengt weiter)'],
  [BR2, '|| notrufGefahrLaeuft(game, f)) continue;\n    const lp', ') continue;\n    const lp', 'd: kein Aufschub mitten in der Reise-Gefahr'],
  [BR2, "    if (lp && !require('./faden-boden-rahmen.js').niemandUnten(game, lp)) continue;\n", '', 'e: kein Aufschub, solange die Crew am Landeplatz unten ist'],
  [BR2, "      f.zaehler = Math.max(f.zaehler, f.abstand);\n      const r = Faden().befehlAnwenden(game, { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id });\n      if (!r.ok) fehlerZaehlen(game, 'abenteuer-brett-haenger'", "      const r = { ok: true };\n      if (!r.ok) fehlerZaehlen(game, 'abenteuer-brett-haenger'", 'f: der Abschluss kommt nicht sofort (Modell-Betrieb wartet auf Taetigkeiten)'],
  [BR2, "if (!F || !Faden().aktiv(game) || !Faden().spielleiterAktiv(game) || !Number.isFinite(ws.tickZahl)) return 0;", "if (!F || !Faden().aktiv(game) || !Number.isFinite(ws.tickZahl)) return 0;", 'g: auch bei ausgeschaltetem Spielleiter'],
  [BR2, "if (!B[beat.typ].abschluss && (!require('./faden-p3.js').notrufImStich(game, f.notruf.marke) || f.phase !== 'wartet'))", "if ((!require('./faden-p3.js').notrufImStich(game, f.notruf.marke) || f.phase !== 'wartet'))", 'h: auch der Abschluss-Beat geht durch notrufImStich (eine erfuellte Rettung kippt auf gescheitert)'],
  [BR2, "if (!beat || !B[beat.typ] || notrufGefahrLaeuft(game, f)) continue;", "if (!beat || !B[beat.typ] || B[beat.typ].abschluss || notrufGefahrLaeuft(game, f)) continue;", 'm: ein Faden im Abschluss-Beat ohne Taetigkeiten haengt weiter (Modell-Betrieb)'],
  [BR2, "!P.notrufBrettFaden(f) || f.phase === 'abgeschlossen' || ws.tickZahl", "f.phase === 'abgeschlossen' || ws.tickZahl", 'i: auch regulaere Faeden laufen in die Notruf-Frist'],
  [P3, "if (f.phase === 'laeuft' && !D.BEATS[v.beats[f.beat].typ].abschluss) {", "if (f.phase === 'laeuft' && v.beats[f.beat].typ === 'notruf') {", 'j: Im-Stich-Lassen beendet nur den Beat notruf, nicht rettung'],
  [RE2, "  try { require('./abenteuer-brett.js').notrufHaengerBeenden(game); }", "  try { }", 'k: der Takt ruft notrufHaengerBeenden nicht auf'],
  [NB2, '"wert": 24,', '"wert": 0,', 'l: Daten: Frist 0 (Test fordert >= 1)'],
];

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const TROCKEN = process.argv.includes('--trocken');
const lauf = () => spawnSync(process.execPath, [TEST], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
let ueberlebt = 0, gelaufen = 0;
console.log(`Mutationsprobe test-faden-rettung-haenger.js (${MUTATIONEN.length} Mutationen${TROCKEN ? ', trocken' : ''}, Kopie in ${TMP})`);
if (!TROCKEN) {
  const basis = lauf();
  console.log(`  Ausgangslage: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
}
for (const [datei, alt, neu, was] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  const stellen = text.split(alt).length - 1;
  if (stellen !== 1) { console.log(`  ?? ${was}: Textstelle nicht eindeutig gefunden (${datei}, ${stellen}x)`); ueberlebt++; continue; }
  if (TROCKEN) { console.log(`  ok   ${was}: Textstelle gefunden (${stellen}x)`); continue; }
  const neuText = text.replace(alt, () => neu);
  fs.writeFileSync(f, nl ? neuText.replace(/\n/g, '\r\n') : neuText);
  const r = lauf();
  fs.writeFileSync(f, orig);
  const rot = r.status !== 0;
  const fehler = (r.stdout || '').split('\n').filter((l) => /FEHLER/.test(l));
  if (!rot) ueberlebt++;
  console.log(`  ${rot ? 'rot  ' : 'GRÜN '} ${was}${rot ? ` (${fehler.length} Fehler, z. B. ${(fehler[0] || 'Absturz').replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : '  <-- ÜBERLEBT'}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) überlebt` : `alle ${gelaufen} Mutationen ${TROCKEN ? 'gefunden (trocken)' : 'erkannt'}`);
process.exit(ueberlebt ? 1 : 0);
