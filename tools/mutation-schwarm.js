'use strict';
// MON-03 Nacharbeit E5: Mutationsprobe zu den Schwarm-Tests (brut, streuung, Ader-Köder und Sperre, gefolge, `abgeleitet` im Katalog-Lader). Kopiert Server, Shared, Content und die Tests in ein
// Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Stelle und verlangt, dass der zugehörige Test mit einer echten Prüfzeile (FEHLER) rot wird. Ein Absturz ohne Prüfzeile zählt NICHT als erkannt.
//   node tools/mutation-schwarm.js [begriff …] [--trocken]      (npm run test:schwarm-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal), sonst Exit 2. --trocken prüft nur die Anker.
// Die Client-Teile (Spurdeckel, Zerfall) liegen in public/js/voxel/actors.js und werden nicht hier, sondern von Hand mit Wiederherstellung per md5 gemutet (siehe Bericht).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-schwarm-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
for (const rel of ['server', 'shared', 'content']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const TESTS = ['tools/test-schwarm.js', 'tools/test-schwarm-nest.js', 'tools/test-schwarm-fix.js', 'tools/test-schwarm-spielleiter.js', 'tools/gel02-hilfen.js'];
for (const t of TESTS) fs.copyFileSync(path.join(ROOT, t), path.join(TMP, t));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
for (const rel of ['public', 'node_modules']) { if (fs.existsSync(path.join(ROOT, rel))) { try { fs.symlinkSync(path.join(ROOT, rel), path.join(TMP, rel), 'junction'); } catch (e) { /* kein Modul nötig */ } } }

const KR = 'server/sim/kreatur.js', KAT = 'server/mission/katalog.js';
const T = { brut: 'tools/test-schwarm.js', nest: 'tools/test-schwarm-nest.js', fix: 'tools/test-schwarm-fix.js', sl: 'tools/test-schwarm-spielleiter.js' };
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, Test, gleichwertig?]
const MUTATIONEN = [
  // ---- brut (Erkundung: Mutationsprobe für brut; Review: 15 Proben)
  [KR, "if (nichtEndgueltigErledigt(O)) lebend++; else O.weg = true;", "if (nichtEndgueltigErledigt(O)) lebend++;", 'brut: tote Nachkommen werden nicht still entfernt', T.brut],
  [KR, "while (B.rest > 0 && lebend < par.max) {", "while (B.rest > 0 && lebend <= par.max) {", 'brut: Startbesatz überschreitet max um eins (gleichwertig: der Validator erzwingt anfang <= max, der Zähler rest endet vor der Grenze)', T.fix, true],
  [KR, "if (lebend >= par.max) { B.rest = 0; B.t = 0; return; }", "if (lebend > par.max) { B.rest = 0; B.t = 0; return; }", 'brut: Obergrenze >= wird >', T.brut],
  [KR, "if (B.t < par.takt) return;", "if (B.t < par.takt * 0.9) return;", 'brut: Takt um 10 % kürzer', T.brut],
  [KR, "const B = K.brut || (K.brut = { t: 0, rest: par.anfang });", "const B = K.brut || (K.brut = { t: 0, rest: 0 });", 'brut: kein Startbesatz', T.brut],
  [KR, "(K.gruppe == null || O.gruppe === K.gruppe)", "true", 'brut: Nachkommen anderer Gruppen zählen mit', T.fix],
  [KR, "    if (!game.players.some((p) => p.zone === 'away')) return;\n    const k = game.karteOf", "    const k = game.karteOf", 'brut: Nachwuchs auch ohne Außenteam', T.fix],
  [KR, "    if (aw.kreaturen.some((O) => !O.weg && O.alive && Math.hypot(pos.x - O.x, pos.y - O.y) < BRUT_NACHBAR * TILE)) continue;\n", "", 'brut: Nachwuchs erscheint auf anderen Kreaturen', T.fix],
  // ---- Lärm-Quelle (Review)
  [KR, "    bausteinLaerm(game, K, ev); n++;", "    n++;", 'laermHoeren: ruft den Köder nicht', T.nest],
  // ---- Ader-Köder und Sperre (B)
  [KR, "  if (!E.solid(tx, ty)) return { x, y };\n  let best", "  return { x, y };\n  let best", 'Köder: bleibt auf dem festen Feld (keine Projektion)', T.fix],
  [KR, "  const ort = E ? koederOrt(E, o.x, o.y) : { x: o.x, y: o.y };", "  const ort = { x: o.x, y: o.y };", 'laermHoeren: Köderort ohne Projektion', T.fix],
  [KR, "  const n = K.pfad[0]; if (!n) return;\n  if (!Mon.fussKacheln", "  const n = K.pfad[0]; return;\n  if (!Mon.fussKacheln", 'Sperre: der blockierte Pfadpunkt wird nicht gemerkt', T.fix],
  [KR, "geht: (cx, cy) => m.geht(cx, cy) && !(S[cx + ',' + cy] > zeit) };", "geht: (cx, cy) => m.geht(cx, cy) };", 'Sperre: die Maske ignoriert gemerkte Punkte', T.fix],
  [KR, "if (K.sperre[key] <= zeit) delete K.sperre[key]; else rest++;", "rest++;", 'Sperre: verfällt nie', T.fix],
  [KR, "  const m = K.sperre ? sperrMaske(m0, K, game.time) : m0;", "  const m = m0;", 'Sperre: tickEine benutzt die Sperrmaske nicht', T.fix],
  [KR, "  else if (r === 'blockiert') sperreMerken(game, K, ctx);", "", 'Sperre: gehe meldet keine Blockade', T.fix],
  // ---- Streuung (A)
  [KR, "    const f = Math.min(v, 1) * par.tempo * dt / v;", "    const f = 0;", 'streuung: keine Bewegung', T.fix],
  [KR, "      const tO = typVon(O.typ); if (!tO || !tO.bausteine.streuung) continue;", "", 'streuung: auch Kreaturen ohne den Baustein stoßen ab', T.fix],
  [KR, "s = nK > nO ? 1 : -1;", "s = 1;", 'streuung: zwei Tiere auf demselben Punkt weichen in dieselbe Richtung aus (gleichwertig: die Tiere werden nacheinander bewegt, das zweite sieht den Abstand des ersten schon und weicht richtig aus)', T.fix, true],
  [KR, "      const w = 1 - d / par.abstand;", "      const w = 1;", 'streuung: Stärke nimmt nicht mit dem Abstand ab (zittert)', T.fix, true],
  [KR, "    const res = Physics.moveWithCollision(ctx.E.solid, K.x, K.y, vx * f, vy * f, hbVon(ctx.typ));\n    K.x = res.x; K.y = res.y;", "    K.x += vx * f; K.y += vy * f;", 'streuung: Ausweichen ohne Kollision (durch Wände)', T.fix],
  [KR, "    if (ctx.typ.zustaende[K.z].modus === 'ramme') return;\n    const L = game.away.kreaturen;", "    const L = game.away.kreaturen;", 'streuung: wirkt auch im Biss (Modus ramme)', T.fix, true],
  // ---- gefolge (Review 8)
  [KR, "const gefolgeSuchradius = (par) => Math.max(1, Math.min(GEFOLGE_SUCHE_MAX, Math.ceil(par.daheim / Math.SQRT2 - 0.5) - 1));", "const gefolgeSuchradius = (par) => 4;", 'gefolge: Suchradius fest 4, unabhängig von daheim', T.fix],
  // ---- Katalog (E4)
  [KAT, "Object.assign({}, expand(abgeleitet, alle), alle)", "Object.assign({}, alle, expand(abgeleitet, alle))", 'Katalog: abgeleitet überschreibt id, weiter und Parameter', T.sl],
  [KAT, "      if (ABGELEITET_RESERVIERT.includes(k)) out.push(", "      if (false) out.push(", 'Katalog: reservierte Schlüssel werden nicht abgelehnt', T.sl],
  [KAT, "      else if (has(u.params, k)) out.push(", "      else if (false) out.push(", 'Katalog: Schlüssel gleich einem Parameter werden nicht abgelehnt', T.sl],
  [KAT, "    for (const w of p.werte) if (!has(tab, w)) out.push(", "    for (const w of p.werte) if (false) out.push(", 'Katalog: Wert ohne Zeile wird nicht abgelehnt', T.sl],
  [KAT, "      if (!abgFehler.length && u.abgeleitet) {", "      if (false) {", 'Katalog: nur der Testwert wird geprüft', T.sl],
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
const lauf = (test) => spawnSync(process.execPath, [test], { cwd: TMP, encoding: 'utf8', timeout: 300000 });
// erkannt = rot MIT einer echten FEHLER-Prüfzeile; ein Absturz ist kein Beleg
const pruefFehler = (r) => ((r && r.stdout) || '').split('\n').filter((l) => /^\s*FEHLER\b/.test(l) && !/^\s*FEHLER Abschnitt/.test(l));
let ueberlebt = 0, gelaufen = 0, abstuerze = 0;
console.log(`Mutationsprobe Schwarm (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of Object.values(T)) {
  const basis = lauf(t);
  console.log(`  Ausgangslage ${t}: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log(pruefFehler(basis).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
}
for (const [datei, alt, neu, was, test, gleichwertig] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  const r = lauf(test);
  fs.writeFileSync(f, orig);
  const fe = r.status === 0 ? [] : pruefFehler(r);
  const absturz = r.status !== 0 && !fe.length;
  if (gleichwertig) {   // als gleichwertig eingestuft (kein Test beobachtet die Stelle): überlebt erwartungsgemäß
    console.log(`  ${fe.length ? 'ROT  ' : 'gleich'} ${was} (gleichwertig: ${fe.length ? 'wurde doch erkannt, Einstufung prüfen' : 'überlebt erwartungsgemäß'})`);
    continue;
  }
  if (!fe.length) { ueberlebt++; if (absturz) abstuerze++; }
  console.log(`  ${fe.length ? 'rot  ' : 'GRÜN '} ${was}${fe.length ? ` (${fe.length} Fehler, z. B. ${fe[0].replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : (absturz ? '  <-- NUR ABSTURZ, nicht erkannt' : '  <-- NICHT ERKANNT')}`);
}
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) nicht erkannt (davon ${abstuerze} nur Absturz)` : `alle ${gelaufen} Mutationen erkannt (außer als gleichwertig eingestufte)`);
process.exit(ueberlebt ? 1 : 0);
