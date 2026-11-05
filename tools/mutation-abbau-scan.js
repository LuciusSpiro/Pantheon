'use strict';
// GEL-03 G: Mutationsprobe zu tools/test-abbau-scan.js. Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel
// und verlangt, dass der Test mit einer echten Prüfung rot wird (FEHLER-Zeile, Exit != 0). Ein Absturz zählt nicht als erkannt.
//   node tools/mutation-abbau-scan.js [begriff …] [--trocken]      (npm run test:abbau-scan-mutation)
// Selbstcheck: VOR jedem Lauf muss jeder Anker genau einmal im Quelltext der Kopie stehen, sonst Exit 2. --trocken prüft nur die Anker und endet (Exit 0).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-abbau-scan-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
for (const rel of ['server', 'shared', 'content']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const TEST = 'tools/test-abbau-scan.js';
fs.copyFileSync(path.join(ROOT, TEST), path.join(TMP, TEST));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
for (const rel of ['public', 'node_modules']) { if (fs.existsSync(path.join(ROOT, rel))) { try { fs.symlinkSync(path.join(ROOT, rel), path.join(TMP, rel), 'junction'); } catch (e) { /* kein Modul nötig */ } } }

const AN = 'server/sim/anker.js', DB = 'content/scanner/datenblaetter.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  [AN, "tiefen: { position: 1 } });", "tiefen: { position: 3 } });", 'Position erst ab Stufe 3 statt ab 1'],
  [AN, "if (z === 'da' || z === 'laeuft') { const m = mitte(a);", "if (z === 'da') { const m = mitte(a);", 'laufende Ader ist kein Ziel'],
  [AN, "if (z === 'da' || z === 'laeuft') { const m = mitte(a);", "if (z !== 'abgebaut') { const m = mitte(a);", 'leere Ader ist ein Ziel'],
  [AN, "if (z === 'da' || z === 'laeuft') { const m = mitte(a);", "if (z !== 'leer') { const m = mitte(a);", 'abgebaute Ader bleibt ein Ziel'],
  [AN, "typ: 'erzader' });", "typ: 'ader' });", 'Typ stimmt nicht mit dem Datenblatt überein'],
  [AN, "const m = mitte(a); out.push({ id: a.id, x: m.x, y: m.y,", "const m = mitte(a); out.push({ id: a.id, x: m.x - TILE / 2, y: m.y,", 'Position nicht die Kachelmitte'],
  [AN, "  if (ab.length) o.ab = ab;\n", "", 'Snapshot ohne Halterfeld ab'],
  [AN, "if (b && aw.zustaende[a.id] === 'laeuft') ab.push([i, b.pid]);", "if (b) ab.push([i + 1, b.pid]);", 'Halterfeld mit falschem Ankerindex'],
  [AN, "if (b && aw.zustaende[a.id] === 'laeuft') ab.push([i, b.pid]);", "if (b) ab.push([i, b.pid]);", 'Halterfeld ohne Prüfung des Zustands', true],
  [DB, "\"hinweis\": \"E halten baut ab, ein Halter je Ader. Ein Treffer unterbricht. Der Abbau ist laut.\",", "\"hinweis\": \"E halten baut ab, ein Halter je Ader. Ein Treffer unterbricht. Der Abbau ist laut und lockt zuverlässig jeden Schwarm der ganzen Höhle an.\",", 'Hinweistext zu lang und mit Versprechen'],
  [DB, "\"symbol\": \"ER\",\n      \"positionAb\": 1", "\"symbol\": \"ER\",\n      \"positionAb\": 3", 'Datenblatt: Position erst ab Stufe 3 behauptet'],
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
const pruefFehler = (r) => ((r && r.stdout) || '').split('\n').filter((l) => /^\s*FEHLER\b/.test(l) && !/^\s*FEHLER Ausnahme/.test(l));
let ueberlebt = 0, gelaufen = 0;
console.log(`Mutationsprobe test-abbau-scan.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
  const fe = r.status === 0 ? [] : pruefFehler(r);
  if (gleichwertig) {   // gleichwertig begründet (der Halter-Eintrag fällt ohnehin mit dem Zustand weg): muss überleben
    console.log(`  ${fe.length ? 'ROT  ' : 'gleich'} ${was} (gleichwertig: ${fe.length ? 'wurde doch erkannt, Einstufung prüfen' : 'überlebt erwartungsgemäß'})`);
    if (fe.length) ueberlebt++;
    continue;
  }
  if (!fe.length) ueberlebt++;
  console.log(`  ${fe.length ? 'rot  ' : 'GRÜN '} ${was}${fe.length ? ` (${fe.length} Fehler, z. B. ${fe[0].replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : '  <-- ÜBERLEBT'}`);
}
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) nicht erkannt` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
