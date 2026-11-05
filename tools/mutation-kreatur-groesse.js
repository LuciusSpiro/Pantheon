'use strict';
// MON-02 G: Mutationsprobe zu Größe 1 im Kreaturen-Rahmen (tools/test-kreatur-groesse.js, dazu test-kreatur.js und test-kreatur-anzeige.js je nach Mutation).
// Kopiert Server, Shared, Content und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Stelle und verlangt, dass einer der genannten Tests mit einer echten Prüfung rot wird
// (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, keine Prüfzeile) zählt NICHT als erkannt. Mutationen, die nichts beobachten lässt (äquivalent), stehen mit einer Begründung und müssen überleben.
//   node tools/mutation-kreatur-groesse.js [begriff …] [--trocken]      (npm run test:kreatur-groesse-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-groesse-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
for (const rel of ['server', 'shared', 'content']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const T = 'tools/test-kreatur-groesse.js', K = 'tools/test-kreatur.js', A = 'tools/test-kreatur-anzeige.js';
for (const rel of [T, K, A, 'tools/fixture-station-bahn.js', 'tools/gel02-hilfen.js', 'CONTRACT-B2.md', 'package.json']) fs.copyFileSync(path.join(ROOT, rel), path.join(TMP, rel));
fs.cpSync(path.join(ROOT, 'tools', 'fixtures', 'mon01-station-bahn.json'), path.join(TMP, 'tools', 'fixtures', 'mon01-station-bahn.json'), { recursive: true });
for (const rel of ['public', 'node_modules']) { if (fs.existsSync(path.join(ROOT, rel))) { try { fs.symlinkSync(path.join(ROOT, rel), path.join(TMP, rel), 'junction'); } catch (e) { /* kein Modul nötig */ } } }

const MO = 'server/sim/monster.js', SH = 'shared/monster.js', KR = 'server/sim/kreatur.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, Tests, gleichwertig (Begründung) oder fehlt]
const MUTATIONEN = [
  // ---- Mitte je Größe (shared/monster.js)
  [SH, 'const o = f / 2 - versatzVon(f);', 'const o = 0;', 'mitteVon: Größe 1 liegt auf der Kachelecke statt der Mitte', [T]],
  [SH, 'const o = versatzVon(f) - f / 2;', 'const o = 0;', 'ankerVonPosition: Größe 1 rundet auf die Ecke', [T]],
  [SH, 'const mitte = (p) => mitteVon(p, FUSS);', 'const mitte = (p) => mitteVon(p, 1);', 'mitte (Station): Kachelmitte statt Kachelecke', [K, T]],
  [SH, 'const ankerVon = (x, y) => ankerVonPosition(x, y, FUSS);', 'const ankerVon = (x, y) => ankerVonPosition(x, y, 1);', 'ankerVon (Station): Fußabdruck 1', [T]],
  [SH, 'const versatzVon = (f) => Math.floor(f / 2);', 'const versatzVon = (f) => 1;', 'Fußabdruck-Versatz fest 1 (Größe 1 deckt die Kachel links oben)', [T, K]],
  [SH, 'const c = mitteVon({ cx, cy }, f);', 'const c = { x: cx * TILE, y: cy * TILE };', 'naechster: Abstand von der Kachelecke statt der Mitte des Tieres', [T]],
  [SH, 'const hi = radius + (f % 2 === 0 ? 1 : 0);', 'const hi = radius + 1;', 'naechster: Ring bei Größe 1 eine Kachel weiter rechts/unten', [T]],
  // ---- Maske
  [SH, 'for (let cx = v; cx - v + f - 1 < w; cx++) {', 'for (let cx = v; cx + f - 2 < w; cx++) {', 'Randfehler in der Spaltenschleife (cx = w, Stand von main)', [K, T],
    'seit dem Fußabdruck-Versatz 0 bei Größe 1 liest und schreibt der Überlauf denselben Index (ok[(cy+1)·w] = frei[(cy+1)·w]), der Wert ist der richtige; der Fehler zeigt sich nur über geht() (nächste Mutation)'],
  [SH, 'for (let cy = v; cy - v + f - 1 < h; cy++) for', 'for (let cy = v; cy + f - 2 < h; cy++) for', 'Randfehler in der Zeilenschleife (cy = h)', [K, T],
    'der Zeilenüberlauf liest nur hinter das Ende des frei-Feldes (undefined = nicht frei) und schreibt nie in ok; geht() lehnt cy = h ohnehin ab'],
  [SH, 'cx - v + f - 1 < w && cy - v + f - 1 < h && ok[', 'cx + f - 2 < w && cy + f - 2 < h && ok[', 'geht: Größe 1 lässt cx = w zu (liest die nächste Zeile)', [K, T]],
  [SH, 'if (!frei[(cy - v + dy) * w + cx - v + dx]) { alle = false; break; }', 'if (!frei[(cy + dy) * w + cx + dx]) { alle = false; break; }', 'Maske: Fußabdruck um v Kacheln versetzt', [K, T]],
  // ---- Box und Daten (kreatur.js)
  [KR, 'typ.kollision && typ.kollision.box != null ? typ.kollision.box : typ.groesse * KOERPER_PRO_FUSS', 'typ.groesse * KOERPER_PRO_FUSS', 'Box aus den Daten ignoriert (immer Größe × 14)', [T]],
  [KR, ': typ.groesse * KOERPER_PRO_FUSS; return { w: b, h: b, fuss', ': 28; return { w: b, h: b, fuss', 'Rückfall der Box fest 28 px', [T]],
  [KR, 'Physics.moveWithCollision(ctx.E.solid, K.x, K.y, dx * s, dy * s, hbVon(ctx.typ))', 'Physics.moveWithCollision(ctx.E.solid, K.x, K.y, dx * s, dy * s, { w: 28, h: 28 })', 'Rammen ignoriert die Box je Typ (28 px)', [T]],
  [KR, 'Monster.gehenMitAufbrechen(game, ctx.E, K, dt, tempo, hbVon(ctx.typ), ctx.typ.rammZeit)', 'Monster.gehenMitAufbrechen(game, ctx.E, K, dt, tempo, { w: 28, h: 28, fuss: ctx.typ.groesse }, ctx.typ.rammZeit)', 'Gehen (Türen aufbrechen) ignoriert die Box je Typ', [T],
    'Physics.cornerShift (Ecken-Hilfe, bis 10 px) schiebt eine Figur, deren Box in eine Wand ragt, in die Gangmitte; eine Box von 20 px steht höchstens 6 px neben der Mitte, 28 px ragt damit höchstens 4 px hinein: beim Gehen auf Kachelmitten ist der Unterschied nicht zu messen. Der Haltepunkt am Hindernis (Rammen) zeigt die Box und ist durch die Rammen-Mutationen abgedeckt'],
  [KR, 'Monster.gehenOhneAufbrechen(game, ctx.E, K, dt, tempo, hbVon(ctx.typ))', 'Monster.gehenOhneAufbrechen(game, ctx.E, K, dt, tempo, { w: 28, h: 28, fuss: ctx.typ.groesse })', 'Gehen (Türen bleiben zu) ignoriert die Box je Typ', [T],
    'Physics.cornerShift (Ecken-Hilfe, bis 10 px) schiebt eine Figur, deren Box in eine Wand ragt, in die Gangmitte; eine Box von 20 px steht höchstens 6 px neben der Mitte, 28 px ragt damit höchstens 4 px hinein: beim Gehen auf Kachelmitten ist der Unterschied nicht zu messen. Der Haltepunkt am Hindernis (Rammen) zeigt die Box und ist durch die Rammen-Mutationen abgedeckt'],
  [KR, 'return { w: b, h: b, fuss: typ.groesse };', 'return { w: b, h: b, fuss: 2 };', 'Körper (hbVon) trägt immer Fußabdruck 2', [T]],
  [KR, 'const pos = Mon.mitteVon(a, typ.groesse);', 'const pos = Mon.mitte(a);', 'Debug legt Größe 1 auf die Kachelecke', [T]],
  [KR, 'const m = Monster.maskeVonGroesse(k, typ.groesse);\n  K.zt += dt;', 'const m = Monster.maskeVonGroesse(k, 2);\n  K.zt += dt;', 'Tick benutzt immer die Maske Größe 2', [T]],
  [KR, 'const base = Mon.ankerVonPosition(K.x, K.y, ctx.m.fuss);', 'const base = Mon.ankerVon(K.x, K.y);', 'Streife: Mittelpunkt der Zufallsziele aus Fußabdruck 2', [T],
    'die Zufallsziele liegen in ±radius um den Mittelpunkt und werden gegen die Maske geprüft; ein um eine Kachel verschobener Mittelpunkt ändert nur die Verteilung, nichts Prüfbares'],
  // ---- Bewegung (monster.js)
  [MO, 'const von = Mon.ankerVonPosition(M.x, M.y, m.fuss);', 'const von = Mon.ankerVon(M.x, M.y);', 'setzePfad: Ankerpunkt unter der Figur nach Fußabdruck 2', [T]],
  [MO, 'const n = M.pfad[0]; const c = Mon.mitteVon(n, hb.fuss);', 'const n = M.pfad[0]; const c = Mon.mitte(n);', 'gehenKern: Wegpunkte nach der Mitte von Größe 2', [T]],
  [MO, 'const tz = kanteAmSchritt(E, n, hb.fuss);', 'const tz = kanteAmSchritt(E, n);', 'Tür-Prüfung: Fußabdruck 2 statt der Kreatur', [T]],
  // ---- Validator
  [KR, 'const GROESSEN = [1, 2];', 'const GROESSEN = [1, 2, 3];', 'Validator lässt Größe 3 zu', [K, T]],
  [KR, 'if (!GROESSEN.includes(t.groesse)) f(', 'if (false) f(', 'Validator: Größe wird nicht geprüft', [K, T]],
  [KR, 'if (!zahl(t.kollision.box, 4, GROESSEN.includes(t.groesse) ? t.groesse * TILE - 8 : undefined)) f(', 'if (!zahl(t.kollision.box, 4)) f(', 'Validator: kollision.box ohne Obergrenze', [T]],
  [KR, 'if (!KOLLISION_FELDER.includes(k)) f(', 'if (false) f(', 'Validator: unbekanntes Feld in kollision', [T]],
  [KR, "'groesse', 'kollision', 'sicht'", "'groesse', 'sicht'", 'Validator: kollision ist kein bekanntes Typfeld', [T]],
  // ---- Snapshot
  [KR, '((typ.groesse - 1) << 4)', '(1 << 4)', 'Snapshot: Größenbits fest 1', [A]],
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
console.log(`Mutationsprobe Größe 1 (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of [T, K, A]) {
  const basis = lauf(t);
  console.log(`  Ausgangslage ${t}: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log(pruefFehler(basis).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
}
for (const [datei, alt, neu, was, tests, gleichwertig] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  let fe = [], absturz = false, von = null;
  for (const test of tests) {   // der erste Test mit einer roten Prüfzeile genügt
    const r = lauf(test);
    const e = r.status === 0 ? [] : pruefFehler(r);
    if (e.length) { fe = e; von = test; break; }
    if (r.status !== 0) absturz = true;
  }
  fs.writeFileSync(f, orig);
  if (gleichwertig) {   // als gleichwertig eingestuft (kein Test beobachtet die Stelle): muss überleben
    if (fe.length) ueberlebt++;
    console.log(`  ${fe.length ? 'ROT  ' : 'gleich'} ${was} (gleichwertig: ${fe.length ? 'wurde doch erkannt, Einstufung prüfen' : 'überlebt erwartungsgemäß; ' + gleichwertig})`);
    continue;
  }
  if (!fe.length) { ueberlebt++; if (absturz) abstuerze++; }
  console.log(`  ${fe.length ? 'rot  ' : 'GRÜN '} ${was}${fe.length ? ` (${path.basename(von)}: ${fe.length} Fehler, z. B. ${fe[0].replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : (absturz ? '  <-- NUR ABSTURZ, nicht erkannt' : '  <-- ÜBERLEBT')}`);
}
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) nicht erkannt (davon ${abstuerze} nur Absturz)` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
