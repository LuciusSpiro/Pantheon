'use strict';
// BEA-01 C1: Mutationsprobe zu tools/test-faden-beispiel1.js (Referenzabenteuer Beispiel 1, Vorlage falscher_haendler mit Lade-Beat, Forderung, Schmiergeld, Kampf, Abliefer-Beat). Kopiert Server, Shared, Content, public
// und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Regel und verlangt, dass der Test rot wird (Exit 1 MIT FEHLER-Zeile). ABSTUERZE (Exit != 0 ohne FEHLER-Zeile)
// zaehlen NICHT als erkannt. Der Selbstcheck vorab verlangt, dass jeder Anker genau einmal im Quelltext steht (Exit 2, wenn nicht). --trocken prueft nur die Anker.
//   node tools/mutation-faden-beispiel1.js [--trocken] [begriff ...]      (npm run test:faden-beispiel1-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-beispiel1-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'public'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-faden-beispiel1.js']];
for (const f of ['tools/test-faden-beispiel1.js', 'tools/test-faden-vorlagen.js', 'tools/regie-fixture.js', 'tools/faden-fixture.js', 'tools/gegner-testhilfe.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const FR = 'server/sim/faden-fracht.js', FF = 'server/sim/faden-forderung.js', BT = 'content/faeden/beats.json', PR = 'server/sim/faden-pruefer.js', VL = 'content/faeden/vorlagen/falscher_haendler.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  [VL, '"gelungen": { "status": "verbuendet", "weiter": "b_schmier" },\n        "gescheitert": { "status": "aktiv", "weiter": "b_abschluss" }', '"gelungen": { "status": "verbuendet", "weiter": "b_schmier" },\n        "gescheitert": { "status": "aktiv", "weiter": "b_enthuell" }', 'Ausliefern fuehrt trotzdem in die Enthuellung (Daten der Vorlage)'],
  [BT, '"geladen": {"liefert": false, "haelt": true, "tat": false,', '"geladen": {"liefert": false, "haelt": true, "tat": true,', 'Abliefer-Beat entfaellt als Tat: Laden zaehlt als Tat (Katalog tat true)'],
  [FR, "D.BEATS[beat.typ].ware_bei_scheitern === 'bleibt'", "D.BEATS[beat.typ].ware_bei_scheitern === 'nie'", 'Verweigern verliert die Ware (ware_bei_scheitern bleibt wirkt nicht)'],
  [FF, 'if (n > 0 && Geld.bestechungZahlen(game, n)) bezahlt = n;', 'if (n > 0) bezahlt = n;', 'Bestechen bucht nichts'],
  [PR, "if (l) m('LADUNG_NICHT_ABGELIEFERT'", "if (false) m('LADUNG_NICHT_ABGELIEFERT'", 'Lade-Beat-Regel (ii) abgeschaltet: die Ware darf haengen bleiben'],
  [PR, "const l2 = wareAmFaden(b, ag, l, o === b.aus[ag]);", 'const l2 = false;', 'Lade-Beat-Regel (ii): der Weg merkt sich die geladene Ware nie'],
  [PR, ".length > 1) fehler.push(fehl('LADE_BEAT_DOPPELT'", ".length > 99) fehler.push(fehl('LADE_BEAT_DOPPELT'", 'Lade-Beat-Regel (i) abgeschaltet: mehrere Lade-Beats erlaubt'],
  [PR, 'v.beats.length > W.vorlage_beats_max)', 'v.beats.length > 99)', 'Obergrenze der Vorlagen (vorlage_beats_max) ignoriert'],
  [BT, ', "ereignis_verloren": "fracht_gescheitert"', '', 'Gedaechtnis kennt die verlorene Ladung nicht (ereignis_verloren fehlt)'],
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

const lauf = ([test, ...arg]) => spawnSync(process.execPath, [test, ...arg], { cwd: TMP, encoding: 'utf8', timeout: 900000 });
let ueberlebt = 0, gelaufen = 0, erkannt = 0, abstuerze = 0;
console.log(`Mutationsprobe Beispiel 1 (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of TESTS) {
  const basis = lauf(t);
  console.log(`  Ausgangslage ${t.join(' ')}: ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
}
for (const [datei, alt, neu, was] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  if (text.split(alt).length !== 2) { console.log(`  ?? ${was}: Textstelle nicht eindeutig gefunden (${datei})`); ueberlebt++; continue; }
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  let wer = null, fehler = [], absturz = null;
  for (const t of TESTS) {
    const r = lauf(t);
    if (r.status === 0) continue;
    const fz = ((r.stdout || '').split('\n')).filter((l) => /FEHLER/.test(l) && !/FEHLER Ausnahme/.test(l));
    if (fz.length) { wer = path.basename(t[0], '.js').replace('test-', ''); fehler = fz; break; }
    if (!absturz) absturz = { test: path.basename(t[0], '.js'), text: ((r.stderr || '') + (r.stdout || '')).split('\n').filter((l) => /Error|    at |Ausnahme/.test(l)).slice(0, 1).join(' ').trim().slice(0, 120) || `Exit ${r.status}` };
  }
  fs.writeFileSync(f, orig);
  if (wer) { erkannt++; console.log(`  rot    ${was} (${wer}: ${fehler.length} Fehler, z. B. ${fehler[0].replace(/^\s*FEHLER\s*/, '').slice(0, 64)})`); }
  else if (absturz) { abstuerze++; console.log(`  ABSTURZ ${was} (${absturz.test}: ${absturz.text}) – nicht als erkannt gezaehlt`); }
  else { ueberlebt++; console.log(`  GRUEN  ${was}  <-- UEBERLEBT`); }
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`Ergebnis: ${erkannt} erkannt, ${ueberlebt} ueberlebt, ${abstuerze} Absturz/Syntaxfehler (von ${gelaufen})`);
process.exit(ueberlebt || abstuerze ? 1 : 0);
