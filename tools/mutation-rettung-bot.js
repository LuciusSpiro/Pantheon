'use strict';
// BEA-02 D: Mutationsprobe zu tools/test-rettung-bot.js (Bot-Laeufe des Beats rettung am echten Server). Kopiert Server, Shared, Content, public und die Werkzeuge in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf
// EINE Regel und verlangt, dass der Test fuer den zugehoerigen Fall rot wird (Exit 1 MIT FEHLER-Zeile). ABSTUERZE (Exit != 0 ohne FEHLER-Zeile) zaehlen NICHT als erkannt. Der Selbstcheck vorab verlangt, dass jeder Anker genau einmal
// im Quelltext steht (Exit 2, wenn nicht). --trocken prueft nur die Anker. Jede Mutation faehrt nur ihren Fall (--fall), die Ausgangslage zwei Faelle: je Fall ein echter Server-Lauf (rund 10 bis 60 s).
//   node tools/mutation-rettung-bot.js [--trocken] [begriff ...]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-rettung-bot-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'public'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
kopiere('tools/lib');
for (const f of ['tools/spiel-rettung.js', 'tools/test-rettung-bot.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

// Hinweis: Der Haken in game.missionEvent (FAB-01) laesst sich im Bot-Lauf nicht abschalten und erkennen: der Beat bewertet bei jedem Tick aus Lager und Karte, der Haken beschleunigt nur (Haken-Wege: test-faden-rettung, test-faden-boden)
const FR = 'server/sim/faden-rettung.js', FL = 'server/sim/faden-landung.js', AO = 'server/sim/abenteuer-orte.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, Fall des Tests]
const MUTATIONEN = [
  [FR, '{ person: p.person, name: p.name, injured: false }', '{ person: p.person, name: p.name, injured: true }', 'Ueberlebende verletzt gesetzt: die Ops darf sie nicht hochbeamen', 'an_bord-ruhig-1'],
  [FR, '    ueberlebendeSetzen(game, faden, beat, lp);', '    // ueberlebendeSetzen(game, faden, beat, lp);', 'Ueberlebende werden nicht gesetzt: niemand wartet am Ort', 'an_bord-ruhig-1'],
  [FR, 'namen: [f.nsc.name].concat(Faden().ueberlebendeNamen(game, f, n - 1))', 'namen: [f.nsc.name].concat(Array(n - 1).fill(f.nsc.name))', 'Namen der Ueberlebenden doppelt (alle heissen wie der NSC)', 'an_bord-ruhig-1'],
  [FR, "const abgeben = (beat) => WERTE.enden.wert[endeVon(beat)].abgeben === true;", "const abgeben = () => false;", 'ende abgegeben ignoriert: der Beat gilt mit der Aufnahme als gelungen, die Abgabe zaehlt nicht', 'abgegeben-raeuber-3'],
  [FR, "if (zs.every((z) => erledigt.includes(z))) return 'gelungen';", "if (zs.some((z) => erledigt.includes(z))) return 'gelungen';", 'Bewertung gelungen schon bei der ersten erledigten Person statt bei allen', 'abgegeben-raeuber-3'],
  [FR, '    if (!platz.ok) {   // nichts raeumen', '    if (false) {   // nichts raeumen', 'Frachtraum-Hinweis aus: kein Funk, keine Bordanzeige bei belegtem Modul', 'frachtraum'],
  [FR, '    if (!platz.ok) {   // nichts raeumen, nichts werfen: der Hinweis nennt, warum niemand hochgeholt werden kann; der Beat wartet bis zur Frist', '    if (!platz.ok) { Fracht().state(game).lager.length = 0;   // nichts raeumen, nichts werfen: der Hinweis nennt, warum niemand hochgeholt werden kann; der Beat wartet bis zur Frist', 'Beat raeumt den Frachtraum (Erz wird still vernichtet)', 'frachtraum'],
  [FL, 'const besetzungVon = (beat) => WERTE.besetzung.wert[besetzungsSchluessel(beat)];', 'const besetzungVon = () => WERTE.besetzung.wert[WERTE.besetzung_standard.wert];', 'Besetzung immer ruhig: der Belagerer-Lauf zeigt zu wenige Gegner', 'an_bord-belagerer-3'],
  [AO, 'function ortAbraeumen(game, id) {', 'function ortAbraeumen(game, id) {\n  return false;', 'Abraeumen weg: der Ort bleibt nach dem Faden-Ende stehen (Rettung gelungen)', 'an_bord-ruhig-1'],
  [AO, 'function ortAbraeumen(game, id) {', 'function ortAbraeumen(game, id) {\n  return false;', 'Abraeumen weg: der Ort bleibt nach dem Faden-Ende stehen (Frist)', 'frist'],
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

const lauf = (fall) => spawnSync(process.execPath, ['tools/test-rettung-bot.js', '--fall', fall], { cwd: TMP, encoding: 'utf8', timeout: 900000 });
let ueberlebt = 0, gelaufen = 0, erkannt = 0, abstuerze = 0;
console.log(`Mutationsprobe Rettung-Bot (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
{
  const basis = lauf('an_bord-ruhig-1,frist');
  console.log(`  Ausgangslage (an_bord-ruhig-1, frist): ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
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
