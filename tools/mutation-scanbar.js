'use strict';
// SCA-01 P2: Mutationsprobe zu tools/test-scanbar.js. Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel
// und verlangt, dass der Test mit einer echten Prüfung rot wird (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, keine Prüfzeile) zählt NICHT als erkannt.
//   node tools/mutation-scanbar.js [begriff …] [--trocken]      (npm run test:scanbar-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-scanbar-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
for (const rel of ['server', 'shared', 'content']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const TEST = 'tools/test-scanbar.js';
fs.copyFileSync(path.join(ROOT, TEST), path.join(TMP, TEST));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
for (const rel of ['public', 'node_modules']) { if (fs.existsSync(path.join(ROOT, rel))) { try { fs.symlinkSync(path.join(ROOT, rel), path.join(TMP, rel), 'junction'); } catch (e) { /* kein Modul nötig */ } } }

const SB = 'server/sim/scanbar.js', WF = 'server/sim/waffen.js', CB = 'server/sim/combat.js', AW = 'server/sim/away.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- Pflicht
  [SB, "  if (alt && alt.sk >= stufe) {\n    if (!mitPosition", "  if (false) {\n    if (!mitPosition", 'sk sinkt (ein schlechter Scan überschreibt)'],
  [SB, "  const mitPosition = stufe >= z.tiefen.position;", "  const mitPosition = stufe >= 1;", 'Position schon bei Stufe 1 gesetzt'],
  [SB, "if (d <= R) imKreis.push({ z, d }); }", "imKreis.push({ z, d }); }", 'Reichweite ignoriert'],
  [SB, "else if (r === 'bewegt') bewegt++;\n", "else if (r === 'bewegt') bewegt++;\n    break;\n", 'nur das erste Ziel gescannt'],
  [SB, "  if (mitPosition) { e.x = x; e.y = y; }", "  e.x = x; e.y = y;", 'Position gespeichert und im Snapshot ohne Positionsstufe'],
  [AW, "  game.aways[map] = fresh;\n", "  fresh.sc = old.sc;\n  game.aways[map] = fresh;\n", 'Reset fehlt (aw.sc überlebt den Kartenreset)'],
  // ---- weitere Regeln
  [SB, "if (da.has(k)) rest++; else delete aw.sc[k];", "rest++;", 'verschwundene Ziele bleiben in aw.sc'],
  [SB, "  if (!rest) delete aw.sc;\n", "", 'leeres aw.sc bleibt stehen'],
  [SB, "  if (stufe <= 0) {", "  if (stufe < 0) {", 'Stufe 0 (Rauschen) setzt Einträge'],
  [SB, "Scanner.beiErgebnis(scanWirkung);", "", 'Wirkung nicht an den Scanner gehängt'],
  [SB, "const schluessel = (art, id) => art + ':' + id;", "const schluessel = (art, id) => String(id);", 'Schlüssel ohne Art (gleiche Id in zwei Arten kollidiert)'],
  [SB, "  if (!inReichweite) return 'Nichts in Reichweite.';", "  if (false) return 'Nichts in Reichweite.';", 'keine Meldung bei leerer Reichweite'],
  [SB, "(game.debug ? testZiele.get(aw) || [] : [])", "(testZiele.get(aw) || [])", 'Testziele auch ohne Debug'],
  [SB, "  const sc = [];\n  for (const e of Object.values(aw.sc)) sc.push(e.x != null ?", "  const sc = [];\n  for (const e of Object.values(aw.sc)) sc.push(e.sk >= 0 ?", 'Snapshot: Positionsfelder immer (auch ohne Wert)'],
  [SB, "  return sc.length ? { sc } : {};", "  return { sc };", 'Snapshot: Feld auch bei leerem aw.sc', true],   // gleichwertig: aw.sc ist nie leer (update löscht es), Rückgabe {} schon vorher
  [SB, "  if (!aw || !aw.sc) return {};\n", "  if (!aw) return {};\n  if (!aw.sc) return { sc: [] };\n", 'Snapshot: leeres Feld ohne aw.sc'],
  [SB, "  e.sk = stufe;\n", "  e.sk = stufe;\n  e.art = z.art + z.art;\n", 'Art im Eintrag falsch'],
  [WF, "  if (p.scan) require('./scanner.js').scanUnterbrochen(game, p);   // SCA-01 P2: Waffenwechsel", "  // SCA-01 P2: Waffenwechsel", 'Waffenwechsel bricht den Scan nicht ab'],
  [CB, "  if (p.scan) scannerAbbruch(game, p);   // SCA-01 P2: Schießen", "  // SCA-01 P2: Schießen", 'Schießen bricht den Scan nicht ab'],
  [SB, "  const R = game.C.scanner.reichweite, max = game.C.scanner.maxEintraege;", "  const R = game.C.scanner.reichweite * 2, max = game.C.scanner.maxEintraege;", 'Reichweite doppelt'],
  // ---- Nacharbeit (M3, M4, N3, M2)
  [SB, "    alt.x = x; alt.y = y;\n    return 'bewegt';", "    return 'gleich';", 'Position wird nie aktualisiert (bewegtes Ziel zeigt die alte Position)'],
  [SB, "    if (!bekannt && belegt >= max) { voll++; continue; }\n", "", 'Obergrenze maxEintraege fehlt'],
  [SB, "  imKreis.sort((a, b) => a.d - b.d);", "", 'Obergrenze ohne Sortierung nach Entfernung (nicht die nächsten zuerst)'],
  [SB, "if (neu) t = 'Scan: ' + neu", "if (false) t = 'Scan: ' + neu", 'Meldung: neue Ziele nicht gemeldet'],
  [SB, "  if (voll && (neu || bewegt)) t +=", "  if (false) t +=", 'Meldung: Überlauf nicht gemeldet (bei neuen Zielen)'],
  [SB, "  else t = voll ? 'Scan: Speicher voll' : 'Scan: nichts Neues.';", "  else t = 'Scan: nichts Neues.';", 'Meldung: Speicher voll fehlt bei reinem Überlauf'],
  [SB, "  if (game.time < (pruefBis.get(aw) || 0)) return;", "", 'Aufräumprüfung in jedem Tick (nicht gedrosselt)'],
  [SB, "  for (const k of Object.keys(t)) if (k !== 'position') throw", "  for (const k of Object.keys(t)) if (false) throw", 'tiefen.hinweis wird still akzeptiert'],
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
console.log(`Mutationsprobe test-scanbar.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
