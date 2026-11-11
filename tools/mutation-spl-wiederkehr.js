'use strict';
// SPL-01 d: Mutationsprobe zu tools/test-spl-wiederkehr.js. Kopiert Server, Shared, Content und die noetigen Werkzeuge in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Stelle
// und verlangt, dass der Test mit einer echten Pruefung rot wird (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, keine Pruefzeile) zaehlt NICHT als erkannt.
//   Daten-Mutationen aendern den geparsten Katalog (abbauen.json bzw. ladung_bergen.json), Text-Mutationen ersetzen genau eine Stelle im Quelltext.
//   node tools/mutation-spl-wiederkehr.js [begriff ...] [--trocken]      (npm run test:spl-wiederkehr-mutation; je Lauf ein Durchlauf des Tests, einige Minuten)
// Selbstcheck: VOR jedem Lauf muss jede Mutation anwendbar sein (Daten: Aenderung aendert etwas; Text: Anker genau einmal), sonst Exit 2. --trocken prueft nur das und endet.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-wiederk-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
for (const rel of ['server', 'shared', 'content']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools', 'lib'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures', 'context'), path.join(TMP, 'tools', 'fixtures', 'context'), { recursive: true });
const T = 'tools/test-spl-wiederkehr.js';
for (const rel of [T, 'tools/katalog.js', 'tools/lib/messe-spl.js', 'package.json']) fs.copyFileSync(path.join(ROOT, rel), path.join(TMP, rel));
for (const rel of ['public', 'node_modules']) { if (fs.existsSync(path.join(ROOT, rel))) { try { fs.symlinkSync(path.join(ROOT, rel), path.join(TMP, rel), 'junction'); } catch (e) { /* kein Modul noetig */ } } }

const SB = 'server/mission/szenenbau.js';
const KAT = 'content/katalog/molekuele/abbauen.json', KAT2 = 'content/katalog/molekuele/ladung_bergen.json';
// Daten-Mutation: [Datei, fn(doc)] aendert die geparste Datei im Speicher
const D = (was, datei, fn, gleichwertig) => ({ art: 'daten', was, datei, fn, gleichwertig });
// Text-Mutation: [Datei, alt (genau einmal), neu]
const X = (datei, alt, neu, was, gleichwertig) => ({ art: 'text', datei, alt, neu, was, gleichwertig });
const abb = (d) => d.umsetzungen.find((u) => u.id === 'adern_in_der_hoehle');
const MUTATIONEN = [
  // ---- Pruefer: Ausnahme und Deckel
  X(SB, 'if (folge <= max) continue;', 'continue;', 'Pruefer: kein Deckel (jede Folge erlaubt)'),
  X(SB, 'if (folge <= max) continue;', 'if (folge < max) continue;', 'Pruefer: Deckel um eins zu streng (2. Wiederkehr abgelehnt)'),
  X(SB, 'if (folge <= max) continue;', 'if (folge <= max + 1) continue;', 'Pruefer: Deckel um eins zu locker (3. Wiederkehr erlaubt)'),
  X(SB, '(isObj(u.wiederkehr) && u.wiederkehr.max > 0 ? u.wiederkehr.max : 0)', '(isObj(u.wiederkehr) ? u.wiederkehr.max : 99)', 'Pruefer: Umsetzung ohne Feld zaehlt als unbegrenzt'),
  X(SB, 'if (wk[id]) {   // SPL-01 d', 'if (false) {   // SPL-01 d', 'Pruefer: Ausnahme entfaellt (Wiederkehr meldet KARTE-WIEDERHOLT)'),
  X(SB, "errors.push(`KARTE-WIEDERKEHR-MAX:", "warnings.push(`KARTE-WIEDERKEHR-MAX:", 'Pruefer: Deckel nur als Warnung'),
  X(SB, 'id in out ? out[id] : Infinity', 'out[id] || Infinity', 'Pruefer: Szene ohne Feld VOR der Szene mit Feld hebt die Regel nicht auf'),
  X(SB, "(fenster[i].landepunkte || []).includes(id); i--) n++;", "true; i--) n++;", 'Pruefer: Folge zaehlt jede Mission, nicht nur die mit dem Landepunkt'),
  X(SB, "let n = 0;\n  for (let i = fenster.length - 1;", "let n = 0;\n  for (let i = 0;", 'Pruefer: Folge zaehlt von der aeltesten Mission statt der juengsten'),
  X(SB, 'Math.min(wk[id], Math.max(1, (C.wiederholtFenster || 3) - 1))', 'wk[id]', 'Pruefer: Deckel nicht auf Fenster-1 begrenzt'),
  X(SB, "${isObj(u.wiederkehr) ? ` · Wiederkehr:", "${false ? ` · Wiederkehr:", 'Prompt: Wiederkehr wird dem Modell nicht genannt'),
  X(SB, 'höchstens ${u.wiederkehr.max}× in Folge, Ressourcen erneuert', 'Ressourcen erneuert', 'Prompt: Deckel steht nicht im Text'),
  // ---- Katalog-Daten
  D('Katalog: Datenfeld wiederkehr fehlt', KAT, (d) => { delete abb(d).wiederkehr; }),
  D('Katalog: wiederkehr.max 3', KAT, (d) => { abb(d).wiederkehr.max = 3; }),
  D('Katalog: wiederkehr.max 1', KAT, (d) => { abb(d).wiederkehr.max = 1; }),
  D('Katalog: Datenfeld auch an ladung_am_boden', KAT2, (d) => { d.umsetzungen.find((u) => u.id === 'ladung_am_boden').wiederkehr = { max: 2 }; }),
  D('Szene: kein abbau_neu beim Betreten (Adern bleiben leer)', KAT, (d) => { delete abb(d).vorlage.steps[0].enter; }),
  D('Szene: Kartenart auch wildnis', KAT, (d) => { abb(d).buehne_braucht.kartenarten.push('wildnis'); }),
  D('Szene: min abbau 5 (ueber dem Pflichtsatz)', KAT, (d) => { abb(d).buehne_braucht.min.abbau = 5; }),
  D('Szene: Bedingung abbau_fertig min fest 1', KAT, (d) => { abb(d).vorlage.steps[0].rules[0].if.all[0].check.min = 1; }),
  D('Szene: Bedingung ohne map', KAT, (d) => { delete abb(d).vorlage.steps[0].rules[0].if.all[0].check.map; }, 'abbau_fertig ohne map gilt fuer die aktuelle Aussenkarte, im Test dieselbe Karte'),
];

function datenMutieren(m) {
  const f = path.join(TMP, m.datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const doc = JSON.parse(orig);
  const vorher = JSON.stringify(doc);
  m.fn(doc);
  if (JSON.stringify(doc) === vorher) throw new Error('Mutation aendert nichts: ' + m.was);
  let text = JSON.stringify(doc, null, 2) + '\n';
  if (nl) text = text.replace(/\n/g, '\r\n');
  return { f, orig, text };
}

{
  const normal = (t) => t.replace(/\r\n/g, '\n');
  const schlecht = [];
  for (const m of MUTATIONEN) {
    if (m.art === 'daten') { try { datenMutieren(m); } catch (e) { schlecht.push(`${m.was}: ${e.message}`); } continue; }
    let text;
    try { text = normal(fs.readFileSync(path.join(TMP, m.datei), 'utf8')); } catch (e) { schlecht.push(`${m.was}: Datei ${m.datei} nicht lesbar`); continue; }
    const k = text.split(normal(m.alt)).length - 1;
    if (k !== 1) schlecht.push(`${m.was}: Anker ${k === 0 ? 'nicht gefunden' : k + 'x gefunden'} (${m.datei})`);
  }
  if (schlecht.length) { console.log(`Anker-Check: ${schlecht.length} von ${MUTATIONEN.length} Mutationen nicht anwendbar:\n  ` + schlecht.join('\n  ')); process.exit(2); }
  console.log(`Anker-Check: alle ${MUTATIONEN.length} Mutationen anwendbar.`);
  if (process.argv.includes('--trocken')) process.exit(0);
}

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lauf = (test) => spawnSync(process.execPath, [test], { cwd: TMP, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
const pruefFehler = (r) => ((r && r.stdout) || '').split('\n').filter((l) => /^\s*FEHLER\b/.test(l) && !/^\s*FEHLER Abschnitt/.test(l));
let ueberlebt = 0, gelaufen = 0, abstuerze = 0;
console.log(`Mutationsprobe Abbau und Wiederkehr (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
{
  const basis = lauf(T);
  console.log(`  Ausgangslage ${T}: ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log(pruefFehler(basis).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
}
for (const m of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => m.was.toLowerCase().includes(f))) continue;
  gelaufen++;
  let datei, orig, neu;
  if (m.art === 'daten') { const r = datenMutieren(m); datei = r.f; orig = r.orig; neu = r.text; }
  else {
    datei = path.join(TMP, m.datei);
    orig = fs.readFileSync(datei, 'utf8');
    const nl = orig.includes('\r\n');
    const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
    neu = text.replace(m.alt.replace(/\r\n/g, '\n'), () => m.neu);
    if (nl) neu = neu.replace(/\n/g, '\r\n');
  }
  fs.writeFileSync(datei, neu);
  const r = lauf(T);
  fs.writeFileSync(datei, orig);
  const fe = r.status === 0 ? [] : pruefFehler(r);
  const absturz = r.status !== 0 && !fe.length;
  if (m.gleichwertig) {
    console.log(`  ${fe.length ? 'ROT  ' : 'gleich'} ${m.was} (gleichwertig: ${fe.length ? 'wurde doch erkannt' : 'ueberlebt erwartungsgemaess; ' + m.gleichwertig})`);
    continue;
  }
  if (!fe.length) { ueberlebt++; if (absturz) abstuerze++; }
  console.log(`  ${fe.length ? 'rot  ' : 'GRUEN '} ${m.was}${fe.length ? ` (${fe.length} Fehler, z. B. ${fe[0].replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : (absturz ? '  <-- NUR ABSTURZ, keine Pruefzeile' : '')}`);
}
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) nicht erkannt (davon ${abstuerze} nur Absturz)` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
