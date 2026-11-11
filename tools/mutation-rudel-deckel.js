'use strict';
// SPL-01 a4: Mutationsprobe zum Rudel-Deckel (tools/test-rudel-deckel.js). Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Stelle
// und verlangt, dass der Test mit einer echten Prüfung rot wird (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, keine Prüfzeile) zählt NICHT als erkannt. Mutationen, die nichts beobachten lässt
// (gleichwertig), stehen mit einer Begründung und müssen überleben.
//   node tools/mutation-rudel-deckel.js [begriff …] [--trocken]      (npm run test:rudel-deckel-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-rudel-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
for (const rel of ['server', 'shared', 'content']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const T = 'tools/test-rudel-deckel.js';
for (const rel of [T, 'package.json']) fs.copyFileSync(path.join(ROOT, rel), path.join(TMP, rel));
for (const rel of ['public', 'node_modules']) { if (fs.existsSync(path.join(ROOT, rel))) { try { fs.symlinkSync(path.join(ROOT, rel), path.join(TMP, rel), 'junction'); } catch (e) { /* kein Modul nötig */ } } }

const KR = 'server/sim/kreatur.js', PL = 'server/mission/bausteine/kreaturen.js', CK = 'server/mission/checker.js', DA = 'content/kampf/kreaturen.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, gleichwertig (Begründung) oder fehlt]
const MUTATIONEN = [
  // ---- (b) Rudelgröße
  [KR, "  if (!R || typeof o.anzahl !== 'number') return [];\n  if (o.anzahl >= R.tiere.min && o.anzahl <= R.tiere.max) return [];", "  return [];\n  if (o.anzahl >= R.tiere.min && o.anzahl <= R.tiere.max) return [];", 'Größe: Regel entfernt (nie ein Fehler)'],
  [KR, 'if (o.anzahl >= R.tiere.min && o.anzahl <= R.tiere.max) return [];', 'if (o.anzahl >= R.tiere.min) return [];', 'Größe: Obergrenze fehlt'],
  [KR, 'if (o.anzahl >= R.tiere.min && o.anzahl <= R.tiere.max) return [];', 'if (o.anzahl <= R.tiere.max) return [];', 'Größe: Untergrenze fehlt'],
  [KR, 'if (o.anzahl >= R.tiere.min && o.anzahl <= R.tiere.max) return [];', 'if (o.anzahl > R.tiere.min && o.anzahl <= R.tiere.max) return [];', 'Größe: Untergrenze exklusiv (3 Tiere abgelehnt)'],
  [KR, 'if (o.anzahl >= R.tiere.min && o.anzahl <= R.tiere.max) return [];', 'if (o.anzahl >= R.tiere.min && o.anzahl < R.tiere.max) return [];', 'Größe: Obergrenze exklusiv (4 Tiere abgelehnt)'],
  [KR, "  return [\"'anzahl' = \" + o.anzahl + \" außerhalb der Rudelgröße \" + R.tiere.min + '–' + R.tiere.max", "  return [\"'anzahl' = \" + o.anzahl + \" außerhalb der Rudelgröße 3–4\"", 'Größe: Text mit festen Zahlen statt Daten (Zahlen im Prüfer hartcodiert)'],
  [PL, '.rudelGroesseFehler(args).concat(bereichImDeckFehler(args))', '.rudelGroesseFehler({}).concat(bereichImDeckFehler(args))', 'Größe: Baustein reicht die Argumente nicht an die Regel'],
  // ---- (a) Rudel je Karte
  [KR, 'if (neu && S.size > R.jeKarte) out.push(', 'if (neu && S.size > R.jeKarte + 1) out.push(', 'Je Karte: Grenze um eins zu hoch (3 Rudel gültig)'],
  [KR, 'if (neu && S.size > R.jeKarte) out.push(', 'if (neu && S.size >= R.jeKarte) out.push(', 'Je Karte: Grenze um eins zu niedrig (2 Rudel abgelehnt)'],
  [KR, 'const key = JSON.stringify([o.map, o.typ]);', 'const key = o.typ;', 'Je Karte: Zählung über alle Karten statt je Karte'],
  [KR, "const kennung = typeof o.gruppe === 'string' ? o.gruppe : '#' + index;", "const kennung = '#' + index;", 'Je Karte: jeder Aufruf zählt, auch dieselbe gruppe in zwei Zweigen'],
  [KR, 'const neu = !S.has(kennung);', 'const neu = true;', 'Je Karte: ein Fehler auch für schon gezählte gruppe (4 Rudel: mehr Fehler)'],
  [KR, "    const R = o && rudelRegel(o.typ);\n    if (!R || typeof o.map !== 'string') return;", "    const R = o && rudelRegel('rudeltier');\n    if (!R || typeof o.map !== 'string') return;", 'Je Karte: Regel hängt am Typnamen statt am Typ des Aufrufs'],
  [PL, '    dokPruefen: (liste) => Kreatur().rudelJeKarteFehler(liste.map((x) => x.args))', '    dokPruefen: (liste) => Kreatur().rudelJeKarteFehler([])', 'Je Karte: Baustein reicht keine Aufrufe an die Regel'],
  [PL, "    dokPruefen: (liste) => Kreatur().rudelJeKarteFehler(liste.map((x) => x.args)).map((f) => ({ code: 'PARAM-WERT', p: liste[f.index].p,", "    dokPruefen: (liste) => Kreatur().rudelJeKarteFehler(liste.map((x) => x.args)).map((f) => ({ code: 'PARAM-WERT', p: 'x',", 'Je Karte: Fehler zeigt nicht auf die Aktion'],
  [CK, "for (const [name, D] of dokListen) for (const f of D.def.dokPruefen(D.liste)) E(f.code, f.p, `'${name}' ${f.text}`);", '', 'Je Karte: der Prüfer ruft dokPruefen nie'],
  [CK, 'D.liste.push({ args, p });', '', 'Je Karte: der Prüfer sammelt keine Aufrufe'],
  [CK, "if (typeof def.dokPruefen === 'function') { const D = dokListen.get(name) || { def, liste: [] }; dokListen.set(name, D);", "if (typeof def.dokPruefen === 'function' && kind === 'pruefung') { const D = dokListen.get(name) || { def, liste: [] }; dokListen.set(name, D);", 'Je Karte: der Prüfer sammelt nur Prüfungen, keine Aktionen'],
  // ---- (c) Bereich im Deck
  [PL, "  if (!lp || lp.art !== MIT_DECK) return [];", '  if (!lp) return [];', 'Deck: gilt auch für eigene Höhlenkarten'],
  [PL, "  if (!lp || lp.art !== MIT_DECK) return [];", '  return [];', 'Deck: Regel entfernt'],
  [PL, "  if (o.bereich !== P && !o.bereich.startsWith(P + '_')) return [];", '  if (o.bereich !== P) return [];', 'Deck: nur der Bereich hoehle, nicht hoehle_lager_n'],
  [PL, "  if (o.bereich !== P && !o.bereich.startsWith(P + '_')) return [];", '  if (false) return [];', 'Deck: jeder Bereich der Wildnis gilt als Deck'],
  [PL, '.concat(bereichImDeckFehler(args))', '', 'Deck: Baustein ruft die Regel nicht'],
  [PL, "const MIT_DECK = 'wildnis';", "const MIT_DECK = 'aussenposten';", 'Deck: falsche Kartenart'],
  // ---- Daten
  [DA, '"tiere": { "min": 3, "max": 4 }', '"tiere": { "min": 3, "max": 5 }', 'Daten: max 5 statt 4'],
  [DA, '"tiere": { "min": 3, "max": 4 }', '"tiere": { "min": 2, "max": 4 }', 'Daten: min 2 statt 3'],
  [DA, '"jeKarte": 2', '"jeKarte": 3', 'Daten: 3 Rudel je Karte statt 2'],
  [DA, '"rudel": { "tiere": { "min": 3, "max": 4 }, "jeKarte": 2, "abstand": 12 },\n', '', 'Daten: Feld rudel fehlt (kein Deckel)'],
  // ---- Feldprüfung der Daten
  [KR, "if (!Number.isInteger(R.jeKarte) || R.jeKarte < 1) f(", 'if (false) f(', 'Feldprüfung: jeKarte ungeprüft'],
  [KR, 'T.min < 1 || T.max > RUDEL_MAX || T.min > T.max) f(', 'T.max > RUDEL_MAX) f(', 'Feldprüfung: min < 1 und min > max ungeprüft'],
  [KR, "for (const k of Object.keys(R)) if (!RUDEL_FELDER.includes(k)) f(", 'for (const k of []) if (!RUDEL_FELDER.includes(k)) f(', 'Feldprüfung: unbekannte Felder in rudel erlaubt'],
  // ---- Laufzeit bleibt ohne Deckel
  [KR, "if (!Number.isInteger(n) || n < 1 || n > RUDEL_MAX) return fehl(", "if (!Number.isInteger(n) || n < 1 || n > RUDEL_MAX || rudelGroesseFehler({ typ: p.typ, anzahl: n }).length) return fehl(", 'Laufzeit: rudelSetzen wendet den Deckel an (Debug und Rudel-Tests brächen)'],
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
const lauf = (test) => spawnSync(process.execPath, [test], { cwd: TMP, encoding: 'utf8', timeout: 180000 });
// erkannt = rot MIT einer echten FEHLER-Prüfzeile; ein Absturz ist kein Beleg
const pruefFehler = (r) => ((r && r.stdout) || '').split('\n').filter((l) => /^\s*FEHLER\b/.test(l) && !/^\s*FEHLER Abschnitt/.test(l));
let ueberlebt = 0, gelaufen = 0, abstuerze = 0;
console.log(`Mutationsprobe Rudel-Deckel (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
{
  const basis = lauf(T);
  console.log(`  Ausgangslage ${T}: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log(pruefFehler(basis).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
}
for (const [datei, alt, neu, was, gleichwertig] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  const r = lauf(T);
  fs.writeFileSync(f, orig);
  const fe = r.status === 0 ? [] : pruefFehler(r);
  const absturz = r.status !== 0 && !fe.length;
  if (gleichwertig) {   // als gleichwertig eingestuft (kein Test beobachtet die Stelle): darf überleben
    console.log(`  ${fe.length ? 'ROT  ' : 'gleich'} ${was} (gleichwertig: ${fe.length ? 'wurde doch erkannt' : 'überlebt erwartungsgemäß; ' + gleichwertig})`);
    continue;
  }
  if (!fe.length) { ueberlebt++; if (absturz) abstuerze++; }
  console.log(`  ${fe.length ? 'rot  ' : 'GRÜN '} ${was}${fe.length ? ` (${fe.length} Fehler, z. B. ${fe[0].replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : (absturz ? '  <-- NUR ABSTURZ, keine Prüfzeile' : '')}`);
}
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) nicht erkannt (davon ${abstuerze} nur Absturz)` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
