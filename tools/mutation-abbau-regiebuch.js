'use strict';
// GEL-03 D: Mutationsprobe zu tools/test-abbau-regiebuch.js. Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel
// und verlangt, dass der Test mit einer echten Prüfung rot wird (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, keine Prüfzeile) zählt NICHT als erkannt.
//   node tools/mutation-abbau-regiebuch.js [begriff …] [--trocken]      (npm run test:abbau-regiebuch-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet.
// Einträge mit 5. Element true sind als gleichwertig begründet (keine Beobachtung möglich) und müssen überleben.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-abbau-rb-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
for (const rel of ['server', 'shared', 'content']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools', 'fixtures'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'tools', 'fixtures', 'weltstand-main.schema.json'), path.join(TMP, 'tools', 'fixtures', 'weltstand-main.schema.json'));
const TEST = 'tools/test-abbau-regiebuch.js';
fs.copyFileSync(path.join(ROOT, TEST), path.join(TMP, TEST));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
for (const rel of ['public', 'node_modules']) { if (fs.existsSync(path.join(ROOT, rel))) { try { fs.symlinkSync(path.join(ROOT, rel), path.join(TMP, rel), 'junction'); } catch (e) { /* kein Modul nötig */ } } }

const PL = 'server/mission/bausteine/abbau.js', BJ = 'content/regiebuch/bausteine.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, gleichwertig?]
const MUTATIONEN = [
  // ---- Prüfung abbau_fertig
  [PL, "if (z === 'abgebaut') abgebaut++;", "if (ZAEHLT_ALS_VORKOMMEN.has(z)) abgebaut++;", 'Zählung: da und laeuft zählen als abgebaut'],
  [PL, "if (z === 'abgebaut') abgebaut++;", "if (z === 'abgebaut' || z === 'leer') abgebaut++;", 'Zählung: leere Adern zählen als abgebaut'],
  [PL, "return s.abgebaut >= a.min;", "return s.abgebaut > a.min;", 'Schwelle: echt größer statt mindestens'],
  [PL, "return s.abgebaut >= a.min;", "return s.abgebaut >= 1;", 'Schwelle: min wird ignoriert'],
  [PL, "const map = a.map != null ? a.map : (g.away && g.away.map) || null;", "const map = a.map != null ? a.map : null;", 'ohne map kein Rückfall auf die aktuelle Außenkarte'],
  [PL, "if (!s) return false;", "if (!s) return true;", 'unbekannte/nicht geladene Karte gilt als erfüllt'],
  [PL, "|| wahl[id] || null)", "|| null)", 'nicht geladene Karte: Auswahl der Runde fehlt (zählt keine Vorkommen)'],
  [PL, "if (!s.adern) { einmal(g, 'keine:' + map, `abbau_fertig: Karte ${map} hat keine Erzadern`); return false; }", "if (!s.adern) return false;", 'Karte ohne Adern: keine Meldung'],
  [PL, "if (a.min > s.vorkommen) einmal(", "if (false) einmal(", 'unerfüllbares min wird nicht gemeldet'],
  [PL, "  if (s.has(schluessel)) return;\n", "", 'Meldung nicht einmalig (je Tick erneut)'],
  // ---- Prüfer
  [PL, "if (!Number.isInteger(v)) out.push(", "if (false) out.push(", 'Prüfer: Bruchzahl für min erlaubt'],
  [PL, "else if (v > adernMax()) out.push(", "else if (false) out.push(", 'Prüfer: min über der größten Kandidatenzahl erlaubt'],
  [PL, "ADERN_ZIEL(Number.MAX_SAFE_INTEGER)", "ADERN_ZIEL(1000)", 'Prüfer: Obergrenze falsch (5 statt 6)'],
  [PL, "params: { min: { typ: 'number', pflicht: true, min: 1 }, map: { typ: 'map' } },", "params: { min: { typ: 'number', pflicht: true }, map: { typ: 'map' } },", 'abbau_fertig: min ohne Untergrenze 1'],
  [PL, "params: { min: { typ: 'number', pflicht: true, min: 1 }, map: { typ: 'map' } },", "params: { min: { typ: 'number', pflicht: true, min: 1 }, map: { typ: 'map', pflicht: true } },", 'abbau_fertig: map Pflicht (Auftrag: optional)'],
  [PL, "id: 'abbau_fertig', art: 'pruefung',", "id: 'abbau_fertig', art: 'aktion',", 'abbau_fertig als Aktion registriert'],
  // ---- Aktion abbau_neu
  [PL, "try { fehler = Anker().abbauNeu(g, a.map); }", "try { fehler = null; }", 'abbau_neu ruft Anker.abbauNeu nicht auf'],
  [PL, "      if (fehler) g.countError('mission-abbau', new Error('abbau_neu: ' + fehler));\n", "", 'abbau_neu: Fehlertext bleibt still'],
  [PL, "id: 'abbau_neu', art: 'aktion', ereignisse: ['abbauNeu'],", "id: 'abbau_neu', art: 'aktion', ereignisse: [],", 'abbau_neu: Ereignis abbauNeu nicht deklariert'],
  [PL, "params: { map: { typ: 'map', pflicht: true } },\n    run(m, a) {", "params: { map: { typ: 'map', pflicht: true }, anzahl: { typ: 'number' } },\n    run(m, a) {", 'abbau_neu: Parameter anzahl (bewusst nicht gebaut)'],
  [PL, "params: { map: { typ: 'map', pflicht: true } },\n    run(m, a) {", "params: { map: { typ: 'map' } },\n    run(m, a) {", 'abbau_neu: map nicht Pflicht'],
  [PL, "      catch (e) { g.countError('mission-abbau', e); return; }", "      catch (e) { throw e; }", 'abbau_neu: Wurf wird nicht abgefangen (Anker.abbauNeu wirft nicht, kein Test erzeugt einen Wurf)', true],
  // ---- Katalog
  [BJ, '"abbau_neu":          {', '"abbau_neu_x":        {', 'Katalog: abbau_neu fehlt in bausteine.json'],
  [BJ, '"abbau_fertig":      { "status": "registriert"', '"abbau_fertig":      { "status": "vertrag"', 'Katalog: abbau_fertig nicht als registriert geführt'],
  [BJ, '"min": { "typ": "number", "min": 1, "max": 6, "pflicht": true }, "map": { "typ": "map" } }', '"min": { "typ": "number", "min": 1, "max": 6 }, "map": { "typ": "map" } }', 'Katalog: min nicht Pflicht (weicht von der Registry ab)'],
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
const pruefFehler = (r) => ((r && r.stdout) || '').split('\n').filter((l) => /^\s*FEHLER\b/.test(l) && !/^\s*FEHLER Ausnahme/.test(l));
let ueberlebt = 0, gelaufen = 0, abstuerze = 0;
console.log(`Mutationsprobe test-abbau-regiebuch.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
  const absturz = r.status !== 0 && !fe.length;
  if (gleichwertig) {   // als gleichwertig eingestuft (keine Beobachtung möglich): muss überleben
    if (fe.length) ueberlebt++;
    console.log(`  ${fe.length ? 'ROT  ' : 'gleich'} ${was} (gleichwertig: ${fe.length ? 'wurde doch erkannt, Einstufung prüfen' : 'überlebt erwartungsgemäß'})`);
    continue;
  }
  if (!fe.length) { ueberlebt++; if (absturz) abstuerze++; }
  console.log(`  ${fe.length ? 'rot  ' : 'GRÜN '} ${was}${fe.length ? ` (${fe.length} Fehler, z. B. ${fe[0].replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : (absturz ? '  <-- NUR ABSTURZ, nicht erkannt' : '  <-- ÜBERLEBT')}`);
}
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) nicht erkannt (davon ${abstuerze} nur Absturz)` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
