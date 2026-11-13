'use strict';
// WRK-01 A2: Mutationsprobe zu tools/test-abbau-frachtraum.js (Erz aus dem Abbau ist Fracht: der Abbau gelingt immer, eingelagert wird, was passt; Hinweis im Angebot, Meldung nur an die Spielerin, Typ-Regel, altes Konto; die echte Szene).
// Kopiert Server, Shared, Content, public und die noetigen Tests in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Regel und verlangt, dass der Test rot wird (Exit 1 MIT
// FEHLER-Zeile). ABSTUERZE (Exit != 0 ohne FEHLER-Zeile) zaehlen NICHT als erkannt. Der Selbstcheck vorab verlangt, dass jeder Anker genau einmal im Quelltext steht (Exit 2, wenn nicht). --trocken prueft nur die Anker.
//   node tools/mutation-abbau-frachtraum.js [--trocken] [begriff ...]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-abbau-frachtraum-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'public'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
for (const f of ['tools/test-abbau-frachtraum.js', 'tools/regie-fixture.js', 'tools/katalog.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
// kein node_modules (Junction): rmSync am Ende soll nie in das echte Verzeichnis greifen; test-abbau-frachtraum braucht keine Fremdpakete
const TESTS = [['tools/test-abbau-frachtraum.js']];

const AK = 'server/sim/anker.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // Hinweis im Angebot (abbauPlatzHinweis, interactionsAt, abbauStarten)
  [AK, 'return frei >= n ? null : `Im', 'return null; `Im', 'Hinweis fehlt (kein Text, wenn der Platz kleiner als die Ausbeute ist)'],
  [AK, 'return frei >= n ? null : `Im', 'return frei > n ? null : `Im', 'Hinweis: Grenze Platz gleich Menge zaehlt als zu wenig (off by one)'],
  [AK, "const n = abbauMenge(game, map, a).menge; const frei = fracht().freiFuer(game, 'erz');", "const n = abbauMenge(game, map, a).menge; const frei = fracht().frei(game);", 'Hinweis ignoriert die Typ-Regel (zaehlt nur freie Plaetze)'],
  [AK, "it(hw ? { op: 'abbauen', hinweis: hw } : { op: 'abbauen' });", "{ if (hw) block(hw); else it({ op: 'abbauen' }); }", 'Sperre kommt zurueck (Angebot gesperrt, das Halten startet nicht)'],
  [AK, "it(hw ? { op: 'abbauen', hinweis: hw } : { op: 'abbauen' });", "it({ op: 'abbauen' });", 'Angebot traegt den Hinweis nicht'],
  [AK, "    if (h.hinweis && game.notice) game.notice(p, h.hinweis);   // WRK-01 A2: Hinweis nur an die Spielerin, vor dem Halten\n", '', 'abbauStarten meldet den Hinweis nicht'],
  [AK, 'game.notice(p, h.hinweis);', 'game.oda(h.hinweis, null);', 'Hinweis geht an alle (ODA) statt nur an die Spielerin'],
  // Abschluss (abbauFertig)
  [AK, "setzen(game, aw.map, a.id, 'abgebaut', p.id);", "if (fracht().freiFuer(game, 'erz') >= m.menge) setzen(game, aw.map, a.id, 'abgebaut', p.id); else { abbauAbbrechen(game, aw.map, a.id, p.id); return; }", 'Ader wird bei Platzmangel nicht abgebaut (bleibt da)'],
  [AK, 'const e = fracht().erzEinlagern(game, m.menge);', "const e = fracht().freiFuer(game, 'erz') >= m.menge ? fracht().erzEinlagern(game, m.menge) : { ok: false, eingelagert: 0, rest: m.menge };", 'Alles-oder-nichts: Menge nicht gekappt, bei zu wenig Platz wird nichts mitgenommen'],
  [AK, 'const e = fracht().erzEinlagern(game, m.menge);', "const e = fracht().erzEinlagern(game, 1);", 'nur ein Stapel statt der ganzen Menge eingelagert'],
  [AK, 'const e = fracht().erzEinlagern(game, m.menge);', 'const e = { ok: true, eingelagert: 0 };', 'nichts eingelagert (Erz verbrennt, keine Meldung)'],
  [AK, 'const e = fracht().erzEinlagern(game, m.menge);', "const e = (Vorrat.einlagern(game, m.art, m.menge, 'abbau'), { ok: true, eingelagert: m.menge });", 'Erz geht wieder ins alte Konto inventory.erz (kein Frachtplatz)'],
  [AK, 'if (!e.ok && game.notice) game.notice(p,', 'if (false && game.notice) game.notice(p,', 'Meldung fehlt (Teilmenge ohne Text an die Spielerin)'],
  [AK, 'if (!e.ok && game.notice) game.notice(p,', 'if (game.notice) game.notice(p,', 'Meldung auch wenn alles passt'],
  [AK, 'if (!e.ok && game.notice) game.notice(p, e.eingelagert > 0', 'if (!e.ok) game.oda(e.eingelagert > 0', 'Meldung geht an alle (ODA) statt nur an die Spielerin'],
  [AK, '`Frachtraum voll: ${e.eingelagert} von ${m.menge} Stapeln', '`Frachtraum voll: ${m.menge} von ${m.menge} Stapeln', 'Meldung nennt die Ausbeute statt der mitgenommenen Menge'],
  [AK, 'menge: m.menge, art: m.art };', 'menge: e.eingelagert, art: m.art };', 'Ereignis traegt die mitgenommene statt der Ausbeute-Menge'],
  // Abbruch bei Platzverlust (muss entfallen sein)
  [AK, 'if (!b || !abbauHaelt(halter, a.id) ||', "if (!b || !abbauHaelt(halter, a.id) || fracht().freiFuer(game, 'erz') < 1 ||", 'Abbruch bei Platzverlust kommt zurueck (Halten bricht ab, sobald nichts mehr passt)'],
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
console.log(`Mutationsprobe Abbau-Frachtraum (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
