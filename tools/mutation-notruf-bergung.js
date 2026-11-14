'use strict';
// BEA-02 C: Mutationsprobe zu tools/test-notruf-bergung.js (Plan des Notruf-Angebots: Ort-Art folgt dem Hex, Besetzung je Variante, ende, Pflicht landeplatz, Absicht bergung, Verzweigung, volk_erlaubt, Erfolg, Im-Stich-Sprung).
// Kopiert Server, Content, public und die noetigen Tests in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Regel und verlangt, dass der Test rot wird (Exit 1 MIT FEHLER-Zeile). ABSTUERZE
// (Ausnahme ohne FEHLER-Zeile) zaehlen NICHT als erkannt. Der Selbstcheck vorab verlangt, dass jeder Anker genau einmal im Quelltext steht (Exit 2, wenn nicht). --trocken prueft nur die Anker.
//   node tools/mutation-notruf-bergung.js [--trocken] [begriff ...]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-notruf-bergung-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'public'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-notruf-bergung.js']];
for (const f of ['tools/test-notruf-bergung.js', 'tools/regie-fixture.js', 'tools/faden-fixture.js', 'tools/gegner-testhilfe.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const BR = 'server/sim/abenteuer-brett.js', PR = 'server/sim/faden-pruefer.js', P3 = 'server/sim/faden-p3.js', NB = 'content/faeden/notruf-brett.json', AB = 'content/faeden/absichten.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  [BR, 'NB.landeplatz_arten.find((a) => am.includes(a))', 'NB.landeplatz_arten[0]', 'Ort-Art folgt dem Hex: immer die erste Art (wildnis) auch an Hexen ohne Planet'],
  [BR, 'NB.landeplatz_arten.find((a) => am.includes(a))', 'NB.landeplatz_arten[NB.landeplatz_arten.length - 1]', 'Ort-Art folgt dem Hex: immer das Wrack im Raum, nie der Planet'],
  [NB, '"wert": ["wildnis", "schiff"],', '"wert": ["schiff", "wildnis"],', 'Daten: Reihenfolge der Ort-Arten vertauscht (der Planet wird nie gewaehlt)'],
  [BR, 'const k = has(NB.besetzung_je_variante, variante) ? NB.besetzung_je_variante[variante] : null;', 'const k = null;', 'Besetzung je Variante: der Plan nennt nie eine Besetzung (alles ruhig)'],
  [BR, 'return has(NB.besetzung_arten, k) && !NB.besetzung_arten[k].includes(art) ?', 'return false && has(NB.besetzung_arten, k) && !NB.besetzung_arten[k].includes(art) ?', 'Besetzung: belagerer gilt auch an wildnis und schiff (kein Ersatz nach Ort-Art)'],
  [NB, '"wert": { "belagerer": ["station", "aussenposten"] },', '"wert": { "belagerer": ["station", "aussenposten", "wildnis", "schiff"] },', 'Daten: belagerer an jeder Ort-Art erlaubt'],
  [NB, '"belagerung": "belagerer"', '"belagerung": "raeuber"', 'Daten: Besetzung der Belagerung ist raeuber statt belagerer'],
  [NB, '"piratenueberfall": "raeuber",', '"piratenueberfall": "ruhig",', 'Daten: Besetzung des Piratenueberfalls ist ruhig'],
  [NB, '"ende": "abgegeben"', '"ende": "an_bord"', 'ende des Plans ist an_bord statt abgegeben'],
  [PR, 'if (braucht.landeplatz === true && !(typeof p.landeplatz', 'if (false && braucht.landeplatz === true && !(typeof p.landeplatz', 'Pflicht landeplatz: Pruefer-Regel aus'],
  [BR, 'b.parameter = Object.assign({}, b.parameter, { landeplatz: NB.landeplatz_id });', 'b.parameter = Object.assign({}, b.parameter);', 'rettung bekommt keinen Landeplatz (Plan wird abgelehnt)'],
  [NB, '"havarie": "bergung",', '"havarie": "notruf",', 'Daten: Absicht der Variante havarie ist notruf statt bergung'],
  [AB, '{"typ":"rettung","parameter":{"landeplatz":"ort","ende":"abgegeben"},', '{"typ":"rettung","parameter":{"landeplatz":"ort","ende":"an_bord"},', 'Absicht bergung: ende an_bord'],
  [AB, '"wendungen": ["keine"],\n      "ton_standard": "dringlich",\n      "prompt_zeile": "bergung:', '"wendungen": ["keine","x"],\n      "ton_standard": "dringlich",\n      "prompt_zeile": "bergung:', 'Absicht bergung: Wendung ohne Rezept (Katalog nicht mehr konsistent)'],
  [AB, '{"typ":"rettung","parameter":{"landeplatz":"ort","ende":"abgegeben"},"verzweigung":{"gescheitert":"ende"}},\n            {"id":"ende","typ":"abschluss","erfolg":["rettung"]}', '{"typ":"rettung","parameter":{"landeplatz":"ort","ende":"abgegeben"},"verzweigung":{"gescheitert":"ende"}},\n            {"typ":"rettung","parameter":{"landeplatz":"ort","ende":"abgegeben"},"verzweigung":{"gescheitert":"ende"}},\n            {"id":"ende","typ":"abschluss","erfolg":["rettung"]}', 'Absicht bergung: ein zweiter Beat rettung im Skelett'],
  [NB, '"typ": "rettung",\n        "parameter": {\n          "ende": "abgegeben"\n        },\n        "verzweigung": {\n          "gescheitert": "ende"\n        }', '"typ": "rettung",\n        "parameter": {\n          "ende": "abgegeben"\n        }', 'verzweigung: Scheitern der Rettung fuehrt nirgends hin'],
  [NB, '"parameter": {\n          "text_key": "notruf_standard"\n        },\n        "verzweigung": {\n          "gescheitert": "ende"\n        }', '"parameter": {\n          "text_key": "notruf_standard"\n        },\n        "verzweigung": {\n          "gescheitert": "rettung"\n        }', 'verzweigung: Scheitern des Notrufs fuehrt in die Rettung statt zum Abschluss'],
  [NB, '"kon",\n      "ger"\n    ]', '"kon"\n    ]', 'volk_erlaubt ohne ger (Germanengebiet bekommt einen roemischen NSC)'],
  [NB, '"erfolg": ["rettung"]', '"erfolg": ["notruf", "rettung"]', 'Erfolg des Abschlusses schliesst die Ankunft ein (gelungen ohne Rettung)'],
  [P3, "if (f.phase === 'wartet' && naechster && !naechster.abschluss) f.beat = v.beats.length - 1;", 'if (false) f.beat = v.beats.length - 1;', 'im Stich gelassen: die Rettung entfaellt nicht (Faden spielt weiter)'],
  [NB, '"wert": ["rettung"],\n      "einheit": "Beat-Typen des Plans, die am Landeplatz arbeiten",', '"wert": [],\n      "einheit": "Beat-Typen des Plans, die am Landeplatz arbeiten",', 'Daten: kein Beat traegt Landeplatz und Besetzung'],
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
console.log(`Mutationsprobe Notruf-Bergung (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
