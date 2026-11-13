'use strict';
// WRK-01 A1: Mutationsprobe zu tools/test-wrack-beute.js (Beute am Wrack: Deckel, Platzfall oeffnet trotzdem, Wrack-Orte, Einlagern, Haken in anker.js, Meldung nur an die Spielerin, kein Textliteral im Servercode, Zustand der Prise im Wrack).
// Kopiert Server, Shared, Content, public und die noetigen Tests in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Regel und verlangt, dass der Test rot wird (Exit 1 MIT FEHLER-Zeile).
// ABSTUERZE (Exit != 0 ohne FEHLER-Zeile) zaehlen NICHT als erkannt. Der Selbstcheck vorab verlangt, dass jeder Anker genau einmal im Quelltext steht (Exit 2, wenn nicht). --trocken prueft nur die Anker.
//   node tools/mutation-wrack-beute.js [--trocken] [begriff ...]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-wrack-beute-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'public'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
for (const f of ['tools/test-wrack-beute.js', 'tools/regie-fixture.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }
const TESTS = [['tools/test-wrack-beute.js']];

const WB = 'server/sim/wrack-beute.js', AK = 'server/sim/anker.js', LPK = 'server/sim/landepunkte.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  [WB, 'ganzzahl(BEUTE.deckel_je_wrack) - geleert * ganzzahl(BEUTE.je_anker)))', 'ganzzahl(BEUTE.deckel_je_wrack) * 100))', 'Deckel ignoriert (jeder Anker gibt Ware)'],
  [WB, 'Math.min(ganzzahl(BEUTE.je_anker), ganzzahl(BEUTE.deckel_je_wrack) - geleert', 'Math.min(ganzzahl(BEUTE.je_anker), ganzzahl(BEUTE.deckel_je_wrack) - 0 * geleert', 'Deckel zaehlt die geleerten Anker nicht (nie erreicht)'],
  [WB, 'if (Fracht().freiFuer(game, BEUTE.art) < n) return { ok: true, ware: 0, text: D.texte.kein_platz };', '', 'Platzpruefung fehlt (Einlagern ohne Platz, keine Meldung)'],
  [WB, 'Fracht().freiFuer(game, BEUTE.art) < n)', 'Fracht().freiFuer(game, BEUTE.art) < 0)', 'Platzpruefung prueft nur < 0'],
  [WB, 'return !!Orte().parse(map) || !!Entern().frei(game, map);', 'return true;', 'jede Karte gilt als Wrack-Ort (Kampagnenkarten bekommen Beute)'],
  [WB, 'return !!Orte().parse(map) || !!Entern().frei(game, map);', 'return !!Orte().parse(map);', 'Prise und Wrack (welt.wracks) gelten nicht als Wrack-Ort'],
  [WB, 'return !!Orte().parse(map) || !!Entern().frei(game, map);', 'return !!Entern().frei(game, map);', 'Faden-Orte gelten nicht als Wrack-Ort'],
  [WB, 'const r = Fracht().beuteEinlagern(game, BEUTE.art, n);', 'const r = { eingelagert: n };', 'beuteBergen lagert nichts ein (Anker leer, keine Ware)'],
  [WB, '{ ok: true, ware: 0, text: D.texte.nichts_mehr }', '{ ok: true, ware: 0 }', 'Deckel erreicht: keine Meldung an die Spielerin'],
  [WB, 'text: D.texte.kein_platz', "text: 'Frachtraum voll'", 'Platz-Meldung als Textliteral im Servercode (Quelltext-Scan)'],
  [WB, 'ware: 0, text: D.texte.kein_platz', 'ware: 0', 'Platzfall: keine Meldung an die Spielerin'],
  [AK, "game.missionEvent('beuteGeborgen', {", "if (b.ware || !b.text) game.missionEvent('beuteGeborgen', {", 'Platzfall: Ereignis beuteGeborgen fehlt (Missions-Baustein haengt)'],
  [AK, "setzen(game, map, a.id, 'leer', p.id); game.missionEvent('beuteGeborgen'", "if (!b.ware && b.text === require('../../content/wrack-daten.json').texte.kein_platz) return; setzen(game, map, a.id, 'leer', p.id); game.missionEvent('beuteGeborgen'", 'Platzfall sperrt wieder (Anker bleibt voll, Missions-Baustein haengt)'],
  [AK, 'if (b.text && game.notice) game.notice(p, b.text);', 'if (b.text) game.oda(b.text, null);', 'Meldung geht an alle (ODA) statt nur an die Spielerin'],
  [AK, 'const b = Wrack.beuteBergen(game, map);', 'const b = { ok: true };', 'Haken ruft beuteBergen nicht auf (alter Zustand: nur leer)'],
  [LPK, 'if (game.aways && game.aways[id]) sichern(game, id);', '', 'Prise -> Wrack: geleerte Anker gehen verloren (Deckel zaehlt neu)'],
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

const lauf = ([test, ...arg]) => spawnSync(process.execPath, [test, ...arg], { cwd: TMP, encoding: 'utf8', timeout: 300000 });
let ueberlebt = 0, gelaufen = 0, erkannt = 0, abstuerze = 0;
console.log(`Mutationsprobe Wrack-Beute (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
