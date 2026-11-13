'use strict';
// SON-01 C: Mutationsprobe zu tools/test-sondersektor-angebot.js. Kopiert Server, Shared, Content, public und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Regel und verlangt, dass der Test
// rot wird (Exit 1 MIT FEHLER-Zeile). ABSTUERZE (Exit != 0 ohne FEHLER-Zeile) zaehlen NICHT als erkannt. Der Selbstcheck vorab verlangt, dass jeder Anker genau einmal im Quelltext steht (Exit 2, wenn nicht). Die Kopie bekommt
// kein node_modules (nichts davon wird gebraucht). --trocken prueft nur die Anker.
//   node tools/mutation-sondersektor-angebot.js [--trocken] [begriff ...]      (npm run test:sondersektor-angebot-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-sondang-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'public'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
for (const f of ['tools/test-sondersektor-angebot.js', 'tools/regie-fixture.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));

const SB = 'server/sim/faden-sondersektor.js', PR = 'server/sim/faden-pruefer.js', BR = 'server/sim/abenteuer-brett.js', P3 = 'server/sim/faden-p3.js', AN = 'content/faeden/anschluss.json', AB = 'content/faeden/absichten.json', BT = 'content/faeden/beats.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, Abschnitte des Tests (--nur), die rot werden muessen]
// Nicht aufgenommen: die Lage in abenteuer-brett.js annehmen (if (lg) return veraltet) und in passt (pruefeLage): beide sind zweite Linien hinter faden.js abenteuerOeffnen und abenteuerAnbieten, die dieselbe Lage pruefen; entfaellt eine, aendert sich
// kein beobachtbares Verhalten (Mutation aequivalent, gemessen: ueberlebt). Die gemeinsame Quelle (pruefeBausteinLage, angebotFehler) ist mutiert.
const MUTATIONEN = [
  // Einmaligkeit im Angebotsweg
  [SB, ': einmalFehler(game, s) || reichweiteFehler(game, s);', ': reichweiteFehler(game, s);', 'Angebot: die Einmaligkeit wird nicht geprueft (nach Erfolg liegt wieder ein Helix-Angebot am Brett)', 'A,C1'],
  [SB, "if (s.einmal === 'bei_erfolg') {", 'if (false) {', 'Einmaligkeit fehlt ueberall (Angebot und Start)', 'A,C1'],
  [SB, "st.state === 'done' && st.ausgang === 'erfolg') return", "st.state === 'done' && st.ausgang === 'verloren') return", 'Einmaligkeit sperrt nach Verlust statt nach Erfolg', 'A,E'],
  // Ort / Erreichbarkeit des Angebots
  [SB, ': einmalFehler(game, s) || reichweiteFehler(game, s);', ': einmalFehler(game, s);', 'Angebot: Pulverhorn muss nicht erreichbar sein (Helix auch weit weg)', 'A,B,F'],
  [SB, 'hierHex(game), s.ziel.erreichbar_max).has(s.von)', 'hierHex(game), 99).has(s.von)', 'Angebot: die Sprungzahl der Daten wird ignoriert', 'A,B'],
  [PR, '  return pruefeBausteinLage(game, v);', '  return null;', 'Pruefer: pruefeLage fragt die Bausteine nicht (keine Lage fuer Helix)', 'A,B,F'],
  [PR, 'bs.angebotFehler(game, b) : null', 'null : null', 'Pruefer: der Baustein wird gefragt, aber seine Antwort gilt nie', 'A,B,F'],
  [AN, '"wiedersehen"}, {"typ": "abschluss"}]},\n    {"format": "faden-bauplan/1", "titel": "Helix ruft um Hilfe", "anlass": "Eine Forschungsstation im Gravimetriefeld braucht jemanden, der ihre Messreihe rettet.", "beats": [{"typ": "sondersektor"}, {"typ": "abschluss"}]}', '"wiedersehen"}, {"typ": "abschluss"}]}', 'der Plan Helix steht nicht in anschluss.json (kein Angebot im Standard)', 'A,B'],
  [AB, '"standard": {"titel":"Helix ruft um Hilfe",', '"standard": {"titel":"Helix ruft",', 'Absicht forschungsstation: Standard weicht vom Plan in anschluss.json ab', 'A'],
  [BT, '"baustein": "sondersektor", "verlegt_ort": true,', '"baustein": "sondersektor",', 'Beat ohne verlegt_ort: die Karte am Brett nennt einen Ort', 'B'],
  [BT, '"nur_inszenierer": true, "baustein": "sondersektor"', '"baustein": "sondersektor"', 'der Beat steht im Prompt-Katalog (nur_inszenierer fehlt)', 'A'],
  // Ausgangsbuchung
  [SB, '  f.parameter.ort = s.ausgang.hex;', '  /* kein Ort */', 'Ausgang: faden.parameter.ort wird nicht gesetzt', 'C1,D'],
  [SB, '  f.parameter.ort = s.ausgang.hex;', '  f.parameter.ort = s.hex;', 'Ausgang: der Ort ist der Sondersektor statt des Ausgangs', 'C1,D'],
  [SB, 'fmt(s.ausgang.funk, { hex: s.ausgang.hex, ort: hexName(s.ausgang.hex) })', 'fmt(s.ausgang.funk, { hex: s.hex, ort: hexName(s.hex) })', 'Ausgangsfunk nennt den Sondersektor statt des Ausgangs', 'C1'],
  [SB, '  Bitte().funkSprecher(game, hexName(s.hex), fmt(s.ausgang.funk,', '  if (false) Bitte().funkSprecher(game, hexName(s.hex), fmt(s.ausgang.funk,', 'Ausgang: kein Funk', 'C1'],
  [SB, '      if (gelungen) ausgangBuchen(game, f, s);', '      /* keine Buchung */', 'Ausgang gelungen wird nie gebucht', 'C1,D'],
  [SB, '      if (gelungen) ausgangBuchen(game, f, s);', '      ausgangBuchen(game, f, s);', 'Ausgang verloren bucht ebenfalls den Ausgang', 'E'],
  // Folge-Ort lesen
  [P3, "const hex = typeof p.hex === 'string' && HEX.test(p.hex) ? p.hex : (faden.parameter && faden.parameter.ort);", "const hex = typeof p.hex === 'string' && HEX.test(p.hex) ? p.hex : null;", 'Folgebeat notruf liest den Ort des Fadens nicht', 'D'],
  // Haltefeld nach Fristablauf
  [SB, '      szeneFreigeben(game, s);', '      /* Haltefeld bleibt */', 'Fristablauf schaltet das Haltefeld nicht aus', 'H'],
  [SB, 'ZonenSim().schalten(game, gruppe, false);', 'ZonenSim().schalten(game, gruppe, true);', 'Fristablauf schaltet das Haltefeld an statt aus', 'H'],
  [SB, '  const loc = Locations.get(game.ship.scene), aus = loc && loc.scene && loc.scene.zonenAus;', '  const loc = null, aus = null;', 'Fristablauf kennt die Schaltgruppen der Szene nicht', 'H'],
];

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

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lauf = (nur) => spawnSync(process.execPath, ['tools/test-sondersektor-angebot.js'].concat(nur ? ['--nur', nur] : []), { cwd: TMP, encoding: 'utf8', timeout: 900000 });
let ueberlebt = 0, gelaufen = 0, erkannt = 0, abstuerze = 0;
console.log(`Mutationsprobe Sondersektor-Angebot (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
const basis = lauf();
console.log(`  Ausgangslage: ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
for (const [datei, alt, neu, was, nur] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  const r = lauf(nur);
  fs.writeFileSync(f, orig);
  const fz = (r.stdout || '').split('\n').filter((l) => /FEHLER/.test(l) && !/Abschnitt abgebrochen/.test(l));
  const abbruch = (r.stdout || '').split('\n').filter((l) => /Abschnitt abgebrochen/.test(l));
  if (r.status !== 0 && fz.length) { erkannt++; console.log(`  rot    ${was} (${fz.length} Fehler, z. B. ${fz[0].replace(/^\s*FEHLER\s*/, '').slice(0, 70)})`); }
  else if (r.status !== 0) { abstuerze++; console.log(`  ABSTURZ ${was} (${(abbruch[0] || r.stderr || 'Exit ' + r.status).slice(0, 120)}) – nicht als erkannt gezaehlt`); }
  else { ueberlebt++; console.log(`  GRUEN  ${was}  <-- UEBERLEBT`); }
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`Ergebnis: ${erkannt} erkannt, ${ueberlebt} ueberlebt, ${abstuerze} Absturz/Syntaxfehler (von ${gelaufen})`);
process.exit(ueberlebt || abstuerze ? 1 : 0);
