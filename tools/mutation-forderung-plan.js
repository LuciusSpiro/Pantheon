'use strict';
// BEA-01 C2: Mutationsprobe zu tools/test-forderung-plan.js (Plan, Absicht, braucht_ware, Prompt-Grenzen, Vorlage zollkontrolle). Kopiert Server, Shared, Content, public und die noetigen Tests in ein
// Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Regel und verlangt, dass der Test rot wird (Exit 1 MIT FEHLER-Zeile). ABSTUERZE (Exit != 0 ohne FEHLER-Zeile) zaehlen NICHT als erkannt.
// Der Selbstcheck vorab verlangt, dass jeder Anker genau einmal im Quelltext steht (Exit 2, wenn nicht). --trocken prueft nur die Anker.
//   node tools/mutation-forderung-plan.js [--trocken] [begriff ...]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-forderung-plan-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'public'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-forderung-plan.js']];
for (const f of ['tools/test-forderung-plan.js', 'tools/regie-fixture.js', 'tools/faden-fixture.js', 'tools/gegner-testhilfe.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const INS = 'server/sim/inszenierer.js', FF = 'server/sim/faden-forderung.js', BT = 'content/faeden/beats.json', BA = 'server/sim/faden-bauplan.js', PR = 'server/sim/abenteuer-prompt.js', AB = 'content/faeden/absichten.json', VL = 'content/faeden/vorlagen/zollkontrolle.json';
const ZWECK_SCHMIER = '"zweck": "Zweite Stufe der Forderung: Bestechen (gelungen) kostet Marken, Verweigern (gescheitert) kostet nichts.",';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  [INS, 'if (!(n >= b.plaetze)) out.push(', 'if (false) out.push(', 'Inszenierer ignoriert den leeren Frachtraum (ladung_mindestens wirkungslos)'],
  [INS, "if (!da) out.push(fehl(CODES.WELT_BEDINGUNG, 'absicht', `der Rang der Crew reicht nicht", "if (false) out.push(fehl(CODES.WELT_BEDINGUNG, 'absicht', `der Rang der Crew reicht nicht", 'Inszenierer ignoriert den zu niedrigen Rang (kein Gegner moeglich)'],
  [BA, "if (!s) { add('PARAMETER', `Beat ${id} (${b.typ}): der Plan darf den Parameter", "if (!s) { p[k] = v; continue; add('PARAMETER', `Beat ${id} (${b.typ}): der Plan darf den Parameter", 'Expander laesst einen Parameter ausserhalb der Daten (ende) im Plan zu'],
  [BT, '"art":{"standard":"durchsuchung","erlaubt":["durchsuchung"],"verborgen":true}', '"art":{"standard":"durchsuchung","erlaubt":["durchsuchung","ware"],"verborgen":true}', 'Expander laesst art ware im Plan zu (die Ware des Fadens kann ein Plan nicht laden)'],
  [FF, 'if (!m || m.braucht_ware !== true) return false;', 'if (true) return false;', 'braucht_ware wirkungslos: die Forderung der Ware stellt ihr Ultimatum auch ohne Ware'],
  [FF, 'if (beat && wareFehlt(game, faden, beat)) {', 'if (false && beat && wareFehlt(game, faden, beat)) {', 'der Baustein prueft braucht_ware beim Start nicht'],
  [AB, '{"typ":"forderung","parameter":{"art":"durchsuchung","tiefe"', '{"typ":"geruecht","parameter":{"art":"durchsuchung","tiefe"', 'Absicht ohne Plan: das Rezept baut keine forderung (der Expander lehnt den Plan ab)'],
  [BT, ZWECK_SCHMIER, '"zweck": "' + 'Zweite Stufe der Forderung mit einer viel zu langen Beschreibung. '.repeat(14) + '",', 'Prompt-Grenze nicht eingehalten: der Beat-Katalog ueberschreitet die Test-Grenze'],
  [PR, '.filter(([, s]) => !(s && s.verborgen === true));', '.filter(() => true);', 'verborgen wirkungslos: art und text_key stehen im Prompt-Katalog'],
  [VL, '"gescheitert": { "status": "aktiv", "weiter": "b_kampf" }', '"gescheitert": { "status": "aktiv", "weiter": "b_abschluss" }', 'Vorlage zollkontrolle: Verweigern fuehrt nicht in den Kampf (Daten der Vorlage)'],
  [BT, '{"id":"dulden","text":"Wir dulden die Durchsuchung.","ausgang":"gescheitert","folge":[]}', '{"id":"dulden","text":"Wir dulden die Durchsuchung.","ausgang":"gelungen","folge":[]}', 'bauplan forderung: Dulden hat den falschen Ausgang (Daten des Expanders)'],
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
console.log(`Mutationsprobe Forderung (Plan, Absicht, braucht_ware, Grenzen; ${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
