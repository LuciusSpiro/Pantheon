'use strict';
// BEA-02 D: Mutationsprobe zu tools/test-faden-beispiel2.js (Beispiel 2 am echten Server, Standardplan des Bretts). Kopiert Server, Shared, Content, public und die Werkzeuge in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf
// EINE Regel und verlangt, dass der Test fuer den zugehoerigen Fall rot wird (Exit 1 MIT FEHLER-Zeile). ABSTUERZE (Exit != 0 ohne FEHLER-Zeile) zaehlen NICHT als erkannt. Der Selbstcheck vorab verlangt, dass jeder Anker genau einmal
// im Quelltext steht (Exit 2, wenn nicht). --trocken prueft nur die Anker. Jede Mutation faehrt nur ihren Fall (--fall), die Ausgangslage einen Fall (planet-1): je Fall ein echter Server-Lauf (rund 10 bis 50 s).
// Aequivalente Mutanten gibt es keine: jede Mutation aendert eine Regel, die der zugehoerige Fall am Laeufer-Ergebnis misst (Plan, Ort-Art, Ende, Abraeumen, Besetzung, Landung, Gedaechtnis-Text). Die Mutationen 1 und 3 lassen den
// Laeufer vor dem Abstieg abbrechen (kein Brett-Angebot oder kein Beat rettung): der Test meldet das als FEHLER-Zeile (Laeufer Exit 0 verfehlt), nicht als Absturz des Tests.
//   node tools/mutation-faden-beispiel2.js [--trocken] [begriff ...]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-beispiel2-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'public'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
kopiere('tools/lib');
for (const f of ['tools/spiel-rettung.js', 'tools/test-faden-beispiel2.js', 'tools/regie-fixture.js', 'tools/test-rettung-bot.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const AB = 'server/sim/abenteuer-brett.js', AO = 'server/sim/abenteuer-orte.js', FL = 'server/sim/faden-landung.js', NBJ = 'content/faeden/notruf-brett.json', B1T = 'content/faeden/b1-texte.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, Fall des Tests]
const MUTATIONEN = [
  [AB, '  const plan = klon(NB_DATEI.plan);', "  const plan = klon(NB_DATEI.plan); plan.beats = plan.beats.filter((b) => b.typ !== 'rettung'); plan.beats.forEach((b) => { delete b.erfolg; });", 'Brett legt den Plan ohne Beat rettung an (Notruf > Abschluss)', 'planet-1'],
  [AB, 'art = NB.landeplatz_arten.find((a) => am.includes(a));', 'art = NB.landeplatz_arten[NB.landeplatz_arten.length - 1];', 'Ort-Art ignoriert den Hex: immer Wrack im Raum (schiff), auch wo ein Planet da ist', 'planet-1'],
  [AB, 'art = NB.landeplatz_arten.find((a) => am.includes(a));', 'art = NB.landeplatz_arten[0];', 'Ort-Art ignoriert den Hex: immer Planet (wildnis), auch am Hex nur mit Wrack', 'wrack-3'],
  [NBJ, '"ende": "abgegeben"', '"ende": "an_bord"', 'Plan des Bretts: ende ohne abgegeben (die Rettung endet mit dem Hochbeamen, keine Abgabe)', 'planet-1'],
  [AO, 'function ortAbraeumen(game, id) {', 'function ortAbraeumen(game, id) {\n  return false;', 'Abraeumen weg: der Ort bleibt nach dem Faden-Ende stehen', 'planet-1'],
  [AB, 'const k = has(NB.besetzung_je_variante, variante) ? NB.besetzung_je_variante[variante] : null;', 'const k = null;', 'Besetzung folgt nicht der Variante: der Ueberfall am Wrack hat keine Raeuber', 'wrack-3'],
  [FL, "ev.data.notrueckholung === true ? 'gescheitert' : 'gelungen'", "'gescheitert'", 'Kette: landung endet beim ersten Hochbeamen gescheitert statt gelungen', 'kette-1'],
  [B1T, '"rettung_gelungen": "wiedersehen_rettung_gelungen"', '"rettung_gelungen": "wiedersehen_bitte_gelungen"', 'Wiedersehen greift die Rettung nicht auf (falscher Text zum Gedaechtnis rettung_gelungen)', 'planet-1'],
];

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
{
  const normal = (t) => t.replace(/\r\n/g, '\n');
  const schlecht = [];
  for (const [datei, alt, , was] of MUTATIONEN) {
    let text;
    try { text = normal(fs.readFileSync(path.join(TMP, datei), 'utf8')); } catch (e) { schlecht.push(`${was}: Datei ${datei} nicht lesbar`); continue; }
    const k = text.split(alt).length - 1;
    if (k !== 1) schlecht.push(`${was}: Anker ${k === 0 ? 'nicht gefunden' : k + 'x gefunden'} (${datei})`);
  }
  if (schlecht.length) { console.log(`Anker-Check: ${schlecht.length} von ${MUTATIONEN.length} Mutationen nicht anwendbar:\n  ` + schlecht.join('\n  ')); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } process.exit(2); }
  console.log(`Anker-Check: alle ${MUTATIONEN.length} Anker genau einmal gefunden.`);
  if (process.argv.includes('--trocken')) { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } process.exit(0); }
}

const lauf = (fall) => spawnSync(process.execPath, ['tools/test-faden-beispiel2.js', '--fall', fall], { cwd: TMP, encoding: 'utf8', timeout: 900000 });
let ueberlebt = 0, gelaufen = 0, erkannt = 0, abstuerze = 0;
console.log(`Mutationsprobe Beispiel 2 (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
{
  const basis = lauf('planet-1');
  console.log(`  Ausgangslage (planet-1): ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 8).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
}
for (const [datei, alt, neu, was, fall] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  if (text.split(alt).length !== 2) { console.log(`  ?? ${was}: Textstelle nicht eindeutig gefunden (${datei})`); ueberlebt++; continue; }
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  const r = lauf(fall);
  fs.writeFileSync(f, orig);
  const fz = (r.stdout || '').split('\n').filter((l) => /FEHLER/.test(l) && !/FEHLER Ausnahme/.test(l) && !/^FEHLER: \d+$/.test(l.trim()));
  if (r.status !== 0 && fz.length) { erkannt++; console.log(`  rot    ${was} (Fall ${fall}: ${fz.length} Fehler, z. B. ${fz[0].replace(/^\s*FEHLER\s*/, '').slice(0, 70)})`); }
  else if (r.status !== 0) { abstuerze++; console.log(`  ABSTURZ ${was} (Exit ${r.status}) - nicht als erkannt gezaehlt`); }
  else { ueberlebt++; console.log(`  GRUEN  ${was}  <-- UEBERLEBT`); }
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`Ergebnis: ${erkannt} erkannt, ${ueberlebt} ueberlebt, ${abstuerze} Absturz/Syntaxfehler (von ${gelaufen})`);
process.exit(ueberlebt || abstuerze ? 1 : 0);
