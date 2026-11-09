'use strict';
// FAD-01 C: Mutationsprobe zu tools/test-faden-haendler-invasion.js (Falscher Händler: Invasion nur nach der Ablieferung, Hinweis vorher). Kopiert Server, Shared, Content und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel
// und verlangt, dass der Test rot wird (Exit != 0). Überlebt eine Mutation, deckt der Test die Regel nicht ab.
//   node tools/mutation-sim-befehl.js [begriff …] [--trocken]      (npm run test:haendler-invasion-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet (Exit 0).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-haendler-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools', 'fixtures'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures', 'faeden'), path.join(TMP, 'tools', 'fixtures', 'faeden'), { recursive: true });
const TESTS = ['tools/test-faden-haendler-invasion.js'];
for (const t of TESTS.concat(['tools/test-faden-vorlagen.js', 'tools/regie-fixture.js', 'tools/faden-fixture.js', 'package.json'])) fs.copyFileSync(path.join(ROOT, t), path.join(TMP, t));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const PR = 'server/sim/faden-pruefer.js', P3 = 'server/sim/faden-p3.js', VL = 'content/faeden/vorlagen/falscher_haendler.json', TXT = 'content/faeden/p3-texte.json';
// Anker in der Vorlage: die Ausgänge stehen mehrfach gleich, darum mit dem Nachbartext; lesen() und der Lauf normalisieren die Zeilenenden
const BITTE_GESCH = '"gescheitert": { "status": "aktiv", "weiter": "b_abschluss" }\n      }\n    },\n    {\n      "id": "b_fracht"';
const FRACHT_GESCH = '"gelungen": { "status": "verbuendet", "weiter": "b_enthuell" },\n        "gescheitert": { "status": "aktiv", "weiter": "b_abschluss" }';
const REGEL_C = [PR, "if (!t && simBefehlFolge(b)) m('SIM_BEFEHL_OHNE_TAT'", "if (false && simBefehlFolge(b)) m('SIM_BEFEHL_OHNE_TAT'"];
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, weitere Änderungen [[Datei, alt, neu]]]
const MUTATIONEN = [
  // der Weg ohne Ablieferung (der Prüfer würde ihn ablehnen: einmal mit Prüfer, einmal mit abgeschaltetem Prüfer, damit der Ablauf selbst geprüft wird)
  [VL, FRACHT_GESCH, FRACHT_GESCH.replace('"b_abschluss"', '"b_enthuell"'), 'Zweig b_fracht gescheitert führt wieder in die Enthüllung (Prüfer lehnt ab)'],
  [VL, FRACHT_GESCH, FRACHT_GESCH.replace('"b_abschluss"', '"b_enthuell"'), 'Zweig b_fracht gescheitert führt in die Enthüllung, Prüfer Regel c aus (Ablauf)', [REGEL_C]],
  [VL, BITTE_GESCH, BITTE_GESCH.replace('"b_abschluss"', '"b_enthuell"'), 'Zweig b_bitte gescheitert führt wieder in die Enthüllung (Prüfer lehnt ab)'],
  [VL, BITTE_GESCH, BITTE_GESCH.replace('"b_abschluss"', '"b_enthuell"'), 'Zweig b_bitte gescheitert führt in die Enthüllung, Prüfer Regel c aus (Ablauf)', [REGEL_C]],
  [VL, '"gelungen": { "status": "feindlich", "weiter": "b_jagd", "folge": [{ "typ": "sim_befehl" }] }', '"gelungen": { "status": "feindlich", "weiter": "b_jagd" }', 'die Folge sim_befehl fehlt in der Enthüllung'],
  [VL, '"gelungen": { "status": "feindlich", "weiter": "b_jagd", "folge": [{ "typ": "sim_befehl" }] }', '"gelungen": { "status": "feindlich", "weiter": "b_jagd", "folge": [{ "typ": "sim_befehl", "arten": ["invasion", "beides"] }] }', 'die Folge schließt die Sprengung aus (Art sprengung nicht erlaubt)'],
  // Hinweis
  [VL, '"hinweise": ["h_papiere", "h_schmuggel"]', '"hinweise": ["h_papiere"]', 'Hinweis h_schmuggel hängt an keinem Beat'],
  [VL, '"hinweise": ["h_papiere", "h_schmuggel"]', '"hinweise": ["h_papiere"]', 'Hinweis h_schmuggel entfernt und aus der Vorlage gestrichen', [[VL, ',\n    "h_schmuggel": { "kanal": "geruecht", "text": "Gerücht: Piraten wollen bei {name} Schmuggelware an Bord gewittert haben." }', '']]],
  [VL, '"h_schmuggel": { "kanal": "geruecht", "text": "Gerücht: Piraten wollen bei {name} Schmuggelware', '"h_schmuggel": { "kanal": "geruecht", "text": "Gerücht: Piraten wollen bei {name} eine Waffe', 'der Hinweis verrät die Waffe'],
  [VL, '"h_schmuggel": { "kanal": "geruecht"', '"h_schmuggel": { "kanal": "papiere"', 'Hinweis über den Kanal papiere (Sprecher Frachtpapiere) statt Gerücht: Text nennt dann die Piraten falsch'],
  [VL, '"hinweise": ["h_papiere", "h_schmuggel"]', '"hinweise": ["h_schmuggel", "h_papiere"]', 'Reihenfolge der Hinweise am Beat vertauscht'],
  // Text
  [TXT, '"enthuellung_invasion": "Ich bin Germane, kein Händler. Die Ladung war Waffe: Meine Flotte greift {invasion} an!"', '"enthuellung_invasion": "Ich bin Germane, kein Händler. Meine Flotte greift {invasion} an!"', 'der Enthüllungstext erzählt nicht mehr „Ladung war Waffe“'],
];

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lesen = (datei) => { const t = fs.readFileSync(path.join(TMP, datei), 'utf8'); return t.replace(/\r\n/g, '\n'); };
let kaputt = 0;
for (const [datei, alt, , was, extra] of MUTATIONEN) for (const [d, a] of [[datei, alt]].concat((extra || []).map((x) => [x[0], x[1]]))) if (lesen(d).split(a).length !== 2) { console.log(`  ?? Anker nicht eindeutig: ${was} (${d})`); kaputt++; }
if (kaputt) { console.log(`${kaputt} Anker nicht anwendbar`); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } process.exit(2); }
if (process.argv.includes('--trocken')) { console.log(`alle ${MUTATIONEN.length} Anker eindeutig`); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } process.exit(0); }

const lauf = (test) => spawnSync(process.execPath, [test], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
let ueberlebt = 0, gelaufen = 0;
console.log(`Mutationsprobe ${TESTS.join(', ')} (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of TESTS) {
  const basis = lauf(t);
  console.log(`  Ausgangslage ${t}: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
}
for (const [datei, alt, neu, was, extra] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const aend = [[datei, alt, neu]].concat(extra || []);
  const sicher = [];
  for (const [d, a, n] of aend) {
    const f = path.join(TMP, d);
    const orig = fs.readFileSync(f, 'utf8');
    const nl = orig.includes('\r\n');
    const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
    fs.writeFileSync(f, nl ? text.replace(a, () => n).replace(/\n/g, '\r\n') : text.replace(a, () => n));
    sicher.push([f, orig]);
  }
  let wer = null, r = null;
  for (const t of TESTS) { r = lauf(t); if (r.status !== 0) { wer = path.basename(t, '.js').replace('test-', ''); break; } }
  for (const [f, orig] of sicher.reverse()) fs.writeFileSync(f, orig);
  const fehler = ((r && r.stdout) || '').split('\n').filter((l) => /FEHLER/.test(l));
  if (!wer) ueberlebt++;
  console.log(`  ${wer ? 'rot  ' : 'GRÜN '} ${was}${wer ? ` (${wer}: ${fehler.length} Fehler, z. B. ${(fehler[0] || 'Absturz').replace(/^\s*FEHLER\s*/, '').slice(0, 64)})` : '  <-- ÜBERLEBT'}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) überlebt` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
