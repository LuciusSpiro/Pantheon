'use strict';
// SUND-04a-2 Nacharbeit Welle 4 (M1 Speichern der Variante, S1 Ausgaenge der Variante, S2 Ruf nur fuer Leistung und Deckel nur fuer gebuchten Ruf, S3 hingehalten und feindlich_unter, S4 Warntext und Halt des Schnellsprungs): Mutationsprobe zu tools/test-faden-nach4
// (und den angepassten tools/test-faden-bitte.js, test-faden-vorlagen.js). Kopiert Server, Shared, Content, public und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf
// EINE Regel und verlangt, dass mindestens einer der Tests rot wird (Exit 1 MIT FEHLER-Zeile). ABSTUERZE (Exit != 0 ohne FEHLER-Zeile, Syntaxfehler, Ausnahme beim Laden) zaehlen NICHT als erkannt.
// Der Selbstcheck vorab verlangt, dass jeder Anker genau einmal im Quelltext steht (Exit 2, wenn nicht). --trocken prueft nur die Anker.
//   node tools/mutation-faden-nach4.js [--trocken] [begriff ...]      (npm run test:faden-nach4-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-nach4-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'public'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-faden-nach4.js']];   // die schnellen zuerst (die erste rote Pruefung genuegt)
for (const f of [...TESTS.map((t) => t[0]), 'tools/test-faden-vorlagen.js', 'tools/regie-fixture.js', 'tools/faden-fixture.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const FD = 'server/sim/faden.js', BI = 'server/sim/faden-bitte.js', SZ = 'server/sim/faden-szene.js', P3 = 'server/sim/faden-p3.js', PR = 'server/sim/faden-pruefer.js', FR = 'server/sim/faden-fracht.js';
const HV = 'content/faeden/haltung-werte.json', BT = 'content/faeden/beats.json', SW = 'content/faeden/szenen-werte.json', VC = 'content/faeden/vorlagen/dankbarer_captain.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const RS = 'server/sim/reise.js', WV = 'content/faeden/werte.json', FH = 'content/faeden/vorlagen/falscher_haendler.json';
const MUTATIONEN = [
  // ---- M1: Speichern waehrend der Variante
  [FD, '  if (k.laufend) delete k.laufend.variante;', '', 'M1: laufend.variante kommt in den Weltstand'],
  // ---- S1: eigene Ausgaenge der Variante
  [FD, "  const vb = f.laufend && f.laufend.variante && beat.variante && beat.variante.aus ? beat.variante : null;", '  const vb = null;', 'S1: die Variante bucht die Ausgaenge des Grund-Beats'],
  [FD, "  const ereignis = vb ? W.variante_ereignis + vb.typ + '_' + ausgang : ausgang === 'gescheitert'", "  const ereignis = false ? '' : ausgang === 'gescheitert'", 'S1: das Gedaechtnis kennt den Kampf nicht (Ereignis des Grund-Beats)'],
  [PR, "    if (!istObjekt(o)) { out.push(fehl('VARIANTE_AUS'", "    if (!istObjekt(o)) { void (fehl('VARIANTE_AUS'", 'S1-Pruefer: ein fehlender Ausgang der Variante faellt nicht auf'],
  [PR, "    else if (!W.variante_status.includes(o.status)) out.push(fehl('VARIANTE_AUSGANG'", "    else if (false) out.push(fehl('VARIANTE_AUSGANG'", 'S1-Pruefer: der Feind darf verbuendet zurueckbleiben'],
  [PR, "      else if (r.wirkung.typ === 'haltung_aenderung' && r.wirkung.delta > 0) out.push(", "      else if (false) out.push(", 'S1-Pruefer: die Haltung darf in der Variante steigen'],
  [PR, "      else if (z <= i) out.push(fehl('WEITER_UNGUELTIG', `Beat ${b.id}, Variante", "      else if (false) out.push(fehl('WEITER_UNGUELTIG', `Beat ${b.id}, Variante", 'S1-Pruefer: weiter der Variante darf nach hinten'],
  [PR, "    if (aus.gelungen.status === aus.gescheitert.status && nach(aus.gelungen) === nach(aus.gescheitert)) out.push(", "    if (false) out.push(", 'S1-Pruefer: Scheitern der Variante darf folgenlos sein'],
  [PR, "        for (const o of b.variante && istObjekt(b.variante.aus) && s !== 'tot' && istObjekt(b.variante.aus[ag]) ? [b.aus[ag], b.variante.aus[ag]] : [b.aus[ag]]) {", "        for (const o of [b.aus[ag]]) {", 'S1-Pruefer: der Zustandsweg kennt die Ausgaenge der Variante nicht'],
  [PR, "      const vb = b.variante && istObjekt(b.variante.aus) && s !== 'tot' && hk < H.feindlich_unter ? b.variante.aus : null;", '      const vb = null;', 'S1-Pruefer: die Haltungswege folgen den Ausgaengen des Grund-Beats'],
  [VC, '"status": "geflohen",\n            "weiter": "b_abschluss",\n            "text_key": "feind_besiegt"', '"status": "verbuendet",\n            "weiter": "b_abschluss",\n            "text_key": "feind_besiegt"', 'S1-Daten: der besiegte Feind wird verbuendet'],
  [WV, '"wert": ["feindlich", "geflohen", "tot"]', '"wert": ["feindlich", "geflohen", "tot", "verbuendet"]', 'S1-Daten: verbuendet ist ein erlaubter Zustand nach dem Kampf'],
  // ---- S2: Ruf nur fuer die Leistung
  [VC, '"grund": "geholfen"\n            }\n          ]\n        },', '"grund": "geholfen"\n            },\n            { "typ": "ruf_aenderung", "grund": "funk_rom_gruss" }\n          ]\n        },', 'S2-Daten: Annehmen zahlt Ruf (Dankbarer Captain)'],
  [FH, '"ausgang": "gelungen", "folge": [{ "typ": "haltung_aenderung", "grund": "geholfen" }] },', '"ausgang": "gelungen", "folge": [{ "typ": "haltung_aenderung", "grund": "geholfen" }, { "typ": "ruf_aenderung", "grund": "funk_rom_gruss" }] },', 'S2-Daten: Annehmen zahlt Ruf (Falscher Haendler)'],
  [FD, '      if (r && r.ok && r.angewandt > 0) F.bitteLog.push([F.t, b]);', '      F.bitteLog.push([F.t, b]);', 'S2: der Deckel zaehlt auch einen nicht gebuchten Ruf'],
  [FD, '      let r = null;\n      try { r = kl().rufBuchen(game, [w]); }', '      let r = { ok: true, angewandt: 1 };\n      try { r = kl().rufBuchen(game, [w]); }', 'S2: eine werfende Buchung zaehlt im Deckel'],
  // ---- S3: hingehalten und feindlich_unter
  [HV, '"hingehalten":       {"delta": -1,', '"hingehalten":       {"delta": -2,', 'S3-Daten: Spaeter kostet doppelt'],
  [HV, '"feindlich_unter": {"wert": -3,', '"feindlich_unter": {"wert": -6,', 'S3-Daten: feindlich_unter -6 (Variante unerreichbar)'],
  // ---- S4: Warnung und Halt
  [SW, ' Wer davor andockt oder springt, lässt {name} im Stich: verloren.",', '",', 'S4-Daten: der Vorwarntext nennt die Folge nicht'],
  [SZ, '  const f = F.liste.find((x) => befreiungBeat(x) && x.parameter.ort === hex);', '  const f = null;', 'S4: kein Halt am Ort des NSC'],
  [SZ, '  const f = F.liste.find((x) => befreiungBeat(x) && x.parameter.ort === hex);', '  const f = F.liste.find((x) => befreiungBeat(x));', 'S4: der Halt gilt an jedem Ort'],
  [RS, '  if (halt) return stop(game, halt);', '', 'S4: der Schnellsprung ignoriert den Halt'],
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
console.log(`Mutationsprobe Nacharbeit Welle 4 (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
