'use strict';
// BEA-03 B: Mutationsprobe zu tools/test-faden-hinterhalt.js (Beat hinterhalt: Reichweite des parameter.hex, Wahl ohne Ziel, Laden, Halt am richtigen Sektor, Crewgroesse, Schlange und Sim-Szene, Reise-Gefahr, Andocken, Daten).
// Kopiert Server, Shared, Content, public und die noetigen Tests in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Regel und verlangt, dass der Test rot wird (Exit 1 MIT FEHLER-Zeile).
// ABSTUERZE (Exit != 0 ohne FEHLER-Zeile) zaehlen NICHT als erkannt. Der Selbstcheck vorab verlangt, dass jeder Anker genau einmal im Quelltext steht (Exit 2, wenn nicht). --trocken prueft nur die Anker.
//   node tools/mutation-faden-hinterhalt.js [--trocken] [begriff ...]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-faden-hinterhalt-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'public'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-faden-hinterhalt.js']];
for (const f of ['tools/test-faden-hinterhalt.js', 'tools/test-faden-vorlagen.js', 'tools/regie-fixture.js', 'tools/faden-fixture.js', 'tools/gegner-testhilfe.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const HHJ = 'server/sim/faden-hinterhalt.js', SZ = 'server/sim/faden-szene.js', RS = 'server/sim/reise.js', FA = 'server/sim/faden.js', BT = 'content/faeden/beats.json', SW = 'content/faeden/szenen-werte.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // Datei-Beat mit parameter.hex
  [HHJ, 'B1().erreichbar(game, von, H.ziel.erreichbar_max).has(p.hex) ? p.hex : null;', 'B1().erreichbar(game, von, H.ziel.erreichbar_max).has(p.hex) || true ? p.hex : null;', 'parameter.hex: die Reichweite erreichbar_max wird nicht geprueft (ein Sektor am anderen Ende der Karte gilt)'],
  [HHJ, 'B1().erreichbar(game, von, H.ziel.erreichbar_max).has(p.hex) ? p.hex : null;', 'B1().erreichbar(game, von, H.ziel.max).has(p.hex) ? p.hex : null;', 'parameter.hex: die Reichweite ist ziel.max statt erreichbar_max (ein Sektor am Rand der Reichweite scheitert)'],
  // Wahl ohne Ziel
  [HHJ, "  if (!k.length) return null;\n  const z = Faden()", "  if (!k.length) return hierHex(game);\n  const z = Faden()", 'ohne waehlbaren Sektor liefert die Wahl den eigenen Sektor (der Hinterhalt beginnt sofort, nichts scheitert)'],
  [HHJ, "return { ausgang: 'gescheitert' }; }", "return { laeuft: true }; }", 'ohne Sektor scheitert der Beat nicht: er laeuft ohne Ziel weiter'],
  // Ankunft: nur einmal einplanen
  [HHJ, "if ((game.fadenSzene && game.fadenSzene.fadenId === f.id) || (game.fadenWarte || []).some((it) => it.fadenId === f.id)) return;", "if (false) return;", 'Ankunft plant die Szene in jedem Takt neu ein (keine Sperre gegen Doppeleintrag in Schlange und Szene)'],
  // Halt nur am richtigen Sektor
  [HHJ, "beatVon(x) && x.laufend.hex === hex)", "beatVon(x))", 'Halt: der Schnellsprung haelt an jedem Sektor, solange ein Hinterhalt wartet (nicht nur an seinem Sektor)'],
  [HHJ, "return f ? fmt(T.schnellsprung_hinterhalt, { ort: hexName(hex) }) : null;", "return f ? fmt(T.schnellsprung_hinterhalt, { ort: hex }) : null;", 'Halt-Meldung nennt die Sektornummer statt des Ortsnamens'],
  // Daten statt Literal
  [HHJ, "H.salz + ':' + salz", "'hinterhalt_hexwahl' + ':' + salz", 'das Salz des Zufallsstroms steht als Literal im Servercode'],
  // Crewgroesse
  [SZ, '? nachCrew(W[it.art].anzahl, crewN(game)) : 1;', '? nachCrew(W[it.art].anzahl, 3) : 1;', 'Zahl der Gegner immer fuer Crew 3 (die Crewgroesse zaehlt nicht)'],
  [SW, '"anzahl": {"1": 2, "2": 3, "3": 4}, "ring": 300, "vorlauf_s": 0', '"anzahl": {"1": 2, "2": 3, "3": 3}, "ring": 300, "vorlauf_s": 0', 'Daten: Crew 3 hat nicht mehr Gegner als Crew 2'],
  // Laden
  [FA, "D.BEATS[D.vorlage(f.vorlage).beats[f.beat].typ].szene) { f.phase = 'wartet';", "D.BEATS[D.vorlage(f.vorlage).beats[f.beat].typ].szene && false) { f.phase = 'wartet';", 'Laden: ein laufender Szenen-Beat steht nach dem Laden nicht wieder aus'],
  [BT, '"gefahr": true,\n      "optionen": "keine",\n      "szene": true,\n      "frist": 16,\n      "braucht": {"nsc_status": ["aktiv", "feindlich", "geflohen"], "lage": "hinterhalt_ziel"},\n      "parameter": {"pflicht": [], "optional": ["volk", "hex"]},', '"gefahr": true,\n      "optionen": "keine",\n      "szene": false,\n      "frist": 16,\n      "braucht": {"nsc_status": ["aktiv", "feindlich", "geflohen"], "lage": "hinterhalt_ziel"},\n      "parameter": {"pflicht": [], "optional": ["volk", "hex"]},', 'Katalog: der Beat gilt nicht als Szenen-Beat (kein Zuruecksetzen beim Laden)'],
  // nie zwei Kaempfe uebereinander
  [SZ, 'const frei = (game) => !game.simSzene && !game.fadenSzene', 'const frei = (game) => !game.fadenSzene', 'frei(): eine laufende Sim-Szene haelt den Hinterhalt nicht auf'],
  [SZ, '&& !verfolgungLaeuft(game) && !Reise.gefahrLaeuft(game) && !game.ship.docked', '&& !verfolgungLaeuft(game) && !game.ship.docked', 'frei(): eine laufende Reise-Gefahr haelt den Hinterhalt nicht auf (zwei Kaempfe uebereinander)'],
  [SZ, "else if (game.simSzene && game.fadenSzene) unterbrechen(game, game.fadenSzene);", "else if (false) unterbrechen(game, game.fadenSzene);", 'eine Sim-Szene unterbricht den laufenden Hinterhalt nicht'],
  // Andocken
  [SZ, "if (game.ship.docked && game.fadenSzene) andockenEnde(game);", "if (false) andockenEnde(game);", 'Andocken beendet den laufenden Hinterhalt nicht'],
  // Halt vor dem Abfangen (Reise)
  [RS, "const halt = befreiungHalt(game, next) || hinterhaltHalt(game, next);", "const halt = befreiungHalt(game, next);", 'Reise: der Hinterhalt haelt den Schnellsprung nicht an'],
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
console.log(`Mutationsprobe Faden-Hinterhalt (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
  else if (absturz) { abstuerze++; console.log(`  ABSTURZ ${was} (${absturz.test}: ${absturz.text}) - nicht als erkannt gezaehlt`); }
  else { ueberlebt++; console.log(`  GRUEN  ${was}  <-- UEBERLEBT`); }
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`Ergebnis: ${erkannt} erkannt, ${ueberlebt} ueberlebt, ${abstuerze} Absturz/Syntaxfehler (von ${gelaufen})`);
process.exit(ueberlebt || abstuerze ? 1 : 0);
