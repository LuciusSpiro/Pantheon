'use strict';
// MON-01 Nacharbeit: Mutationsprobe zu tools/test-kreatur.js (Station-Monster gegen den Sollwert, Validator, Maske, Update ohne Außenteam). Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINEN
// Baustein, Hook oder Cursor-Trick und verlangt, dass der Test mit einer echten Prüfung rot wird (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, keine Prüfzeile) zählt NICHT als erkannt.
//   node tools/mutation-kreatur.js [begriff …] [--trocken]      (npm run test:kreatur-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-kreatur-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
for (const rel of ['server', 'shared', 'content']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const TEST = 'tools/test-kreatur.js';
for (const rel of [TEST, 'tools/fixture-station-bahn.js']) fs.copyFileSync(path.join(ROOT, rel), path.join(TMP, rel));
fs.cpSync(path.join(ROOT, 'tools', 'fixtures', 'mon01-station-bahn.json'), path.join(TMP, 'tools', 'fixtures', 'mon01-station-bahn.json'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
for (const rel of ['public', 'node_modules']) { if (fs.existsSync(path.join(ROOT, rel))) { try { fs.symlinkSync(path.join(ROOT, rel), path.join(TMP, rel), 'junction'); } catch (e) { /* kein Modul nötig */ } } }

const MO = 'server/sim/monster.js', SH = 'shared/monster.js', KR = 'server/sim/kreatur.js';
const GEHEN = 'return gehenMitAufbrechen(game, E, M, dt, speed, HB, cfg(game).rammZeit);';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, gleichwertig?]
const MUTATIONEN = [
  // ---- Station-Monster (M1): gehen -> gehenMitAufbrechen / gehenOhneAufbrechen / gehenKern
  [MO, GEHEN, 'return gehenOhneAufbrechen(game, E, M, dt, speed, HB);', 'A: Station sperrt Türen statt aufzubrechen'],
  [MO, GEHEN, 'return gehenMitAufbrechen(game, E, M, dt, speed, HB, 0.2);', 'B: Rammzeit der Station fest 0,2 s'],
  [MO, 'const HB = { w: 28, h: 28 };', 'const HB = { w: 30, h: 30 };', 'D: Kollisionsbox der Station 30×30 statt 28×28'],
  [MO, '      return beiTuer(tz);', '      return null;', 'Kern: geschlossene Tür wird ignoriert (läuft hindurch)'],
  [MO, '(tz) => { M.ramm = { kid: tz.kid, t: rammZeit }; return null; }', '(tz) => { M.ramm = { kid: tz.kid, t: rammZeit * 0.5 }; return null; }', 'gehenMitAufbrechen: halbe Rammzeit'],
  [MO, "() => 'tuer');", '(tz) => { M.ramm = { kid: tz.kid, t: 1 }; return null; });', 'gehenOhneAufbrechen: bricht doch auf'],
  // ---- Maske (E)
  [SH, 'for (let cy = v; cy - v + f - 1 < h; cy++) for (let cx = v; cx - v + f - 1 < w; cx++) {', 'for (let cy = v; cy - v + f - 1 < h - 1; cy++) for (let cx = v; cx - v + f - 1 < w; cx++) {', 'E: Maske Größe 2 ohne letzte Zeile'],
  [SH, 'for (let cy = v; cy - v + f - 1 < h; cy++) for (let cx = v; cx - v + f - 1 < w; cx++) {', 'for (let cy = v; cy - v + f - 1 < h; cy++) for (let cx = v; cx - v + f - 1 < w - 1; cx++) {', 'Maske Größe 2 ohne letzte Spalte'],
  [SH, 'geht(cx, cy) { return cx >= v && cy >= v && cx - v + f - 1 < w && cy - v + f - 1 < h &&', 'geht(cx, cy) { return cx >= v && cy >= v && cx - v + f - 1 < w && cy - v + f - 1 < h - 1 &&', 'geht: letzte Zeile wird abgelehnt'],
  [SH, 'if (!frei[(cy - v + dy) * w + cx - v + dx]) { alle = false; break; }', 'if (!frei[(cy + dy) * w + cx + dx]) { alle = false; break; }', 'Maske: Fußabdruck um eine Kachel versetzt'],
  // ---- kein Update ohne Außenteam (F)
  [KR, "  const team = game.players.some((p) => p.zone === 'away');", '  const team = true;', 'F: kreatur.update läuft ohne Außenteam'],
  // ---- Validator (M2, Lücken)
  [KR, 'if (!GROESSEN.includes(t.groesse)) f(', 'if (false) f(', 'Validator: Größe wird nicht geprüft'],
  [KR, 'if (!SCHILD_FELDER.includes(k)) f(', 'if (false) f(', 'Validator: unbekanntes Feld in schild'],
  [KR, 'if (!SCHILDREGEN_FELDER.includes(k)) f(', 'if (false) f(', 'Validator: unbekanntes Feld in schildRegen'],
  [KR, 'if (!UEBERGANG_FELDER.includes(k)) f(', 'if (false) f(', 'Validator: unbekanntes Feld im Übergang'],
  [KR, "if (u.auf !== 'nah' && u.abstand !== undefined) f(", 'if (false) f(', 'Validator: abstand bei Auslöser ≠ nah'],
  [KR, "if (z.modus === 'ramme' && z.tempo === 0 &&", 'if (false &&', 'Validator: Sackgasse (ramme, tempo 0)'],
  [KR, 'else if (von.has(n)) f(', 'else if (false) f(', 'Validator: zwei Bausteine mit gleichem Modus-/Auslösernamen'],
  [KR, 'if (kern.includes(n)) f(', 'if (false) f(', 'Validator: Baustein überdeckt Kernnamen'],
  [KR, 'if (!gesehen.has(zn)) f(', 'if (false) f(', 'Validator: unerreichbare Zustände'],
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
  if (schlecht.length) { console.log(`Anker-Check: ${schlecht.length} von ${MUTATIONEN.length} Mutationen nicht anwendbar:\n  ` + schlecht.join('\n  ')); process.exit(2); }
  console.log(`Anker-Check: alle ${MUTATIONEN.length} Anker genau einmal gefunden.`);
  if (process.argv.includes('--trocken')) process.exit(0);
}

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lauf = () => spawnSync(process.execPath, [TEST], { cwd: TMP, encoding: 'utf8', timeout: 120000 });
// erkannt = rot MIT einer echten FEHLER-Prüfzeile; ein Absturz ist kein Beleg
const pruefFehler = (r) => ((r && r.stdout) || '').split('\n').filter((l) => /^\s*FEHLER\b/.test(l) && !/^\s*FEHLER Abschnitt/.test(l));
let ueberlebt = 0, gelaufen = 0, abstuerze = 0;
console.log(`Mutationsprobe test-kreatur.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
const basis = lauf();
console.log(`  Ausgangslage: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
if (basis.status !== 0) { console.log(pruefFehler(basis).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
for (const [datei, alt, neu, was, gleichwertig] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  const r = lauf();
  fs.writeFileSync(f, orig);
  // Abschnitt-Abbruch durch eine Ausnahme zählt hier als Erkennung nur, wenn zugleich eine Prüfzeile rot ist; sonst Absturz
  const fe = r.status === 0 ? [] : pruefFehler(r);
  const absturz = r.status !== 0 && !fe.length;
  if (gleichwertig) {   // als gleichwertig eingestuft (kein Test beobachtet die Stelle): muss überleben
    if (fe.length) ueberlebt++;
    console.log(`  ${fe.length ? 'ROT  ' : 'gleich'} ${was} (gleichwertig: ${fe.length ? 'wurde doch erkannt, Einstufung prüfen' : 'überlebt erwartungsgemäß (nicht getestet)'})`);
    continue;
  }
  if (!fe.length) { ueberlebt++; if (absturz) abstuerze++; }
  console.log(`  ${fe.length ? 'rot  ' : 'GRÜN '} ${was}${fe.length ? ` (${fe.length} Fehler, z. B. ${fe[0].replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : (absturz ? '  <-- NUR ABSTURZ, nicht erkannt' : '  <-- ÜBERLEBT')}`);
}
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) nicht erkannt (davon ${abstuerze} nur Absturz)` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
