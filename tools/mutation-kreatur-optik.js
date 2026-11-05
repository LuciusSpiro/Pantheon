'use strict';
// MON-02 O3a: Mutationsprobe zur Kreaturen-Optik (tools/test-kreatur-optik.js; Server-Bit zusätzlich über tools/test-kreatur-anzeige.js).
// Kopiert Server, Shared, Content, public/js, public/voxel/index.json und die Manifeste in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Stelle und verlangt,
// dass der Test mit einer echten Prüfung rot wird (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, keine Prüfzeile) zählt NICHT als erkannt. Gleichwertige Mutationen stehen mit Begründung und müssen überleben.
//   node tools/mutation-kreatur-optik.js [begriff …] [--trocken]      (npm run test:kreatur-optik-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal), sonst Exit 2. --trocken prüft nur die Anker und endet.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-optik-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
for (const rel of ['server', 'shared', 'content', 'assets/manifest', 'public/js']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'public/voxel/assets/palettes'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'public/voxel/index.json'), path.join(TMP, 'public/voxel/index.json'));
fs.copyFileSync(path.join(ROOT, 'public/voxel/assets/palettes/kreatur.json'), path.join(TMP, 'public/voxel/assets/palettes/kreatur.json'));
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const T1 = 'tools/test-kreatur-optik.js', T2 = 'tools/test-kreatur-anzeige.js';
for (const rel of [T1, T2, 'tools/gel02-hilfen.js', 'package.json']) fs.copyFileSync(path.join(ROOT, rel), path.join(TMP, rel));
for (const rel of ['README.md', 'CONTRACT-B2.md']) fs.copyFileSync(path.join(ROOT, rel), path.join(TMP, rel));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const AC = 'public/js/voxel/actors.js', FX = 'public/js/voxel/fx.js', KR = 'server/sim/kreatur.js', MO = 'content/kreaturen/modelle.json', IX = 'server/index.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, Tests, gleichwertig (Begründung) oder fehlt]
const MUTATIONEN = [
  // ---- Bits und Pose
  [AC, '(b & 4) ? 2 : (b & 8) ? 3 : (b & 64) ? 1 : 0;', '(b & 4) ? 2 : (b & 8) ? 3 : (b & 32) ? 1 : 0;', 'Bit zielt falsch gelesen (32 statt 64)', [T1]],
  [AC, '(b & 4) ? 2 : (b & 8) ? 3 : (b & 64) ? 1 : 0;', '(b & 4) ? 2 : (b & 8) ? 3 : 0;', 'Bit zielt wird gar nicht gelesen (Aufladen sieht aus wie Stehen)', [T1]],
  [AC, '(b & 4) ? 2 : (b & 8) ? 3 : (b & 64) ? 1 : 0;', '(b & 8) ? 2 : (b & 4) ? 3 : (b & 64) ? 1 : 0;', 'Pose: Pause und Rammen vertauscht', [T1]],
  [AC, 'function kreaturLadung(b) { return b & 3; }', 'function kreaturLadung(b) { return b & 7; }', 'Ladung liest ein Bit zu viel (Pause)', [T1]],
  // ---- Fell, Beinphase, Parameter, Cache
  [AC, '(((nr | 0) % v) + v) % v; }', '0; }', 'Fell fest (immer Ton 0)', [T1]],
  [AC, 'return pose === 0 ? (Math.floor(Math.max(0, strecke) / KR_SCHRITT) & 1) : 0; }', 'return (Math.floor(Math.max(0, strecke) / KR_SCHRITT) & 1); }', 'Beinphase auch in den Posen ohne Gehen (mehr Cache-Einträge, Beine wechseln im Stand der Pose)', [T1]],
  [AC, 'return pose === 0 ? (Math.floor(Math.max(0, strecke) / KR_SCHRITT) & 1) : 0; }', 'return pose === 0 ? 0 : 0; }', 'Beinphase nie (keine Beinbewegung)', [T1]],
  [AC, 'const p = kreaturParameter(eintrag, nr, b, a.dist || 0);', 'const p = kreaturParameter(eintrag, nr, b, t);', 'Beinphase nach Zeit statt Strecke (Beine laufen im Stand)', [T1]],
  [AC, 'marken: { ladung: kreaturLadung(b), pose } };', 'marken: { ladung: kreaturLadung(b), pose: 0 } };', 'Marken ohne die Pose des Körpers', [T1]],
  [AC, 'marken: { ladung: kreaturLadung(b), pose } };', 'marken: { ladung: 3, pose } };', 'Marken zeigen immer volle Ladung', [T1]],
  [AC, "function kreaturSchluessel(id, p) { return id + '|' + Object.keys(p).sort().map((k) => k + '=' + p[k]).join(','); }", "function kreaturSchluessel(id, p) { return id + '|' + Object.keys(p).sort().filter((k) => k !== 'ladung').map((k) => k + '=' + p[k]).join(','); }", 'Cache-Schlüssel ohne Ladung (Marken bleiben beim Wechsel stehen)', [T1]],
  [AC, 'const nr = +String(e.id).slice(1) || 0;\n  const p = kreaturParameter', 'const nr = 0;\n  const p = kreaturParameter', 'Tier-Nummer wird nicht aus der ID gelesen (alle Tiere gleiches Fell)', [T1]],
  // ---- Zuordnung und Rückfall
  [AC, 'const id = inhalt.reihenfolge[typCode | 0];', 'const id = inhalt.reihenfolge[1];', 'typCode wird ignoriert (jeder Typ bekommt das Rudeltier)', [T1]],
  [AC, 'return e && e.modell && e.marken && e.varianten > 0 ? e : null;', 'return e || null;', 'unvollständiger Eintrag gilt (Marken fehlen)', [T1]],
  [AC, '    kreaturPlatzhalter(a, b, t);\n    a.body.position.set(0, 0, 0); a.body.rotation.set(0, 0, 0);\n', '', 'Rückfall fehlt (ohne Modell wird nichts gezeigt)', [T1]],
  [AC, 'if (!kor.userData.slot.ready || !mar.userData.slot.ready) return false;', 'if (!kor.userData.slot.ready) return false;', 'Rückfall nur nach dem Körper (fehlende Marken lassen die Plätze leer)', [T1]],
  [AC, 'if (!kor.userData.slot.ready || !mar.userData.slot.ready) return false;', 'if (!mar.userData.slot.ready) return false;', 'Rückfall nur nach den Marken (Körper fehlt, nur Marken sichtbar)', [T1]],
  [AC, "if (a.markenPivot) a.markenPivot.visible = false;", '', 'Rückfall blendet die Marken nicht aus', [T1]],
  [AC, "L.kreaturInhalt = null;\n  fetch('/content/kreaturen/modelle.json')", "L.kreaturInhalt = null;\n  fetch('/content/kreaturen/modelle.jsn')", 'Client lädt eine falsche Datei', [T1]],
  [AC, 'a.labelH = 1.45;', '', 'Namenshöhe nicht dem kleineren Modell angepasst', [T1]],
  [AC, "const mk = 'kreatur:' + (b & 3) + ((b >> 2) & 3) + ((b >> 4) & 3);\n  if (a.modelKey !== mk) {", "const mk = 'kreatur:' + (b & 3) + ((b >> 2) & 3) + ((b >> 4) & 3);\n  if (a.modelKey !== mk || true) {", 'Platzhalter baut sich je Frame neu auf (Cache-Prüfung)', [T1], 'gleichwertig für das Ergebnis: das Platzhalter-Modell kommt weiter aus a.models (Cache), nur das Umhängen läuft je Frame; im Spiel unsichtbar'],
  // ---- Effekte
  [AC, 'return (b & 64) && !(b & 12) ? 0.008 + 0.006 * (b & 3) : 0; }', 'return !(b & 12) ? 0.008 + 0.006 * (b & 3) : 0; }', 'Zittern auch im Stehen (ohne Bit zielt)', [T1]],
  [AC, 'return (b & 64) && !(b & 12) ? 0.008 + 0.006 * (b & 3) : 0; }', 'return (b & 64) && !(b & 12) ? 0.008 : 0; }', 'Zittern wächst nicht mit der Ladung', [T1]],
  [AC, 'return (b & 64) && !(b & 12) ? 0.008 + 0.006 * (b & 3) : 0; }', 'return (b & 64) ? 0.008 + 0.006 * (b & 3) : 0; }', 'Zittern auch bei gesetzten Pause-/Rammbits', [T1], 'gleichwertig: der Server setzt Bit 6 nur im Modus zielen, der nie zugleich steht oder rammt; nur der Test erzwingt die Eindeutigkeit mit synthetischen Bits'],
  [AC, 'function kreaturStaubAn(b) { return (b & 8) !== 0 && (b & 4) === 0; }', 'function kreaturStaubAn(b) { return (b & 12) !== 0; }', 'Staubspur auch bei Pause', [T1]],
  [AC, 'function kreaturStaubAn(b) { return (b & 8) !== 0 && (b & 4) === 0; }', 'function kreaturStaubAn(b) { return false; }', 'Staubspur nie', [T1]],
  [AC, 'function kreaturSterneAn(b) { return (b & 4) !== 0; }', 'function kreaturSterneAn(b) { return (b & 12) !== 0; }', 'Sterne auch beim Rammen', [T1]],
  [AC, 'function kreaturSterneAn(b) { return (b & 4) !== 0; }', 'function kreaturSterneAn(b) { return false; }', 'Sterne nie', [T1]],
  [AC, 'return (b & 3) === 3 ? 1 + 0.2 *', 'return (b & 3) >= 2 ? 1 + 0.2 *', 'Pulsieren schon ab Ladung 2', [T1]],
  [AC, 'return (b & 3) === 3 ? 1 + 0.2 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * KR_PULS_HZ)) : 1; }', 'return (b & 3) === 3 ? 1 + 0 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * KR_PULS_HZ)) : 1; }', 'Marken pulsieren nicht (Amplitude 0)', [T1]],
  [AC, 'const KR_PULS_HZ = 1.5;', 'const KR_PULS_HZ = 8;', 'Puls viel zu schnell (8 Hz)', [T1]],
  [AC, 'a.markenPivot.scale.setScalar(kreaturPuls(b, t));', 'a.markenPivot.scale.setScalar(1);', 'Anzeige wendet das Pulsieren nicht an', [T1]],
  [AC, '  if (speed < 0.25) return 0;\n', '', 'Wippen auch im Stand', [T1]],
  [AC, 'const amp = (b & 8) ? 0.05 : 0.012 + 0.016 * Math.min(1, speed / 2.8);', 'const amp = 0.012;', 'Wippen in Jagd und Rammen nicht stärker', [T1]],
  [AC, "  if (kreaturStaubAn(b) && a.speed > 0.25) {", "  if (kreaturStaubAn(b)) {", 'Staub auch im Stand (Rammen ohne Bewegung, z. B. steckt)', [T1]],
  [AC, "fx.spawnFx('staub', {", "fx.spawnFx('sparks', {", 'Staubspur löst einen anderen Effekt aus', [T1]],
  [AC, 'while (a.staubT >= 0.04) {', 'while (a.staubT >= 0.0001) {', 'Staub: Schwelle der Schleife fast 0 statt 0,04', [T1], 'gleichwertig: jeder Aufruf zieht 0,04 s ab, der Zähler wird negativ und die Rate bleibt im Mittel 25 Hz (Test: 60 Bilder in 1 s, 20 bis 30 Aufrufe)'],
  [AC, 'if (stern) { s.rotation.y = t * 2.2 + ph;', 'if (stern) { s.rotation.y = 0;', 'Sterne drehen nicht', [T1], 'gleichwertig für den Test: die Drehung ist reine Optik und wird nur im Browser-Beleg beurteilt'],
  [AC, "if (kind === 'kreatur') { updateKreatur(a, e, dt, t); return; }", "if (kind === 'kreatur') { kreaturPlatzhalter(a, (e.kr && e.kr.b) | 0, t); return; }", 'updateEnemy nutzt nur noch den Platzhalter', [T1]],
  [FX, "      case 'staub': FX.staub(p, o.dir); break;", '', 'fx.js: Effekt staub fehlt', [T1]],
  // ---- Content, Auslieferung
  [MO, '"reihenfolge": ["probe", "rudeltier"]', '"reihenfolge": ["rudeltier", "probe"]', 'Client-Content: Typ-Reihenfolge vertauscht (falsches Modell für typCode)', [T1]],
  [MO, '"varianten": 6', '"varianten": 7', 'Client-Content: sieben statt sechs Fellvarianten', [T1]],
  [MO, '"ohne": ["probe"],', '"ohne": [],', 'Client-Content: probe weder Eintrag noch ohne', [T1]],
  [MO, '"marken": "kreatur/rudeltier_marken"', '"marken": "kreatur/rudeltier_markn"', 'Client-Content: Marken-Modell unbekannt', [T1]],
  [IX, "  { prefix: '/content/kreaturen/', dir: path.join(ROOT, 'content', 'kreaturen'), nur: ['modelle.json'] },", '', 'Server liefert modelle.json nicht aus', [T1]],
  [IX, "dir: path.join(ROOT, 'content', 'kreaturen'), nur: ['modelle.json'] }", "dir: path.join(ROOT, 'content', 'kreaturen') }", 'Server liefert den ganzen Ordner content/kreaturen aus', [T1]],
  // ---- Server: Bit zielt
  [KR, 'BIT_RAMMT = 8, BIT_ZIELT = 64;', 'BIT_RAMMT = 8, BIT_ZIELT = 32;', 'Server: Bit zielt hat den Wert 32', [T1, T2]],
  [KR, "(modus === 'zielen' ? BIT_ZIELT : 0) | ", '', 'Server: Bit zielt wird nie gesetzt', [T2]],
  [KR, "(modus === 'zielen' ? BIT_ZIELT : 0)", "(modus === 'steht' ? BIT_ZIELT : 0)", 'Server: Bit zielt im Modus steht statt zielen', [T2]],
  [KR, "(modus === 'zielen' ? BIT_ZIELT : 0)", "(modus !== 'streife' ? BIT_ZIELT : 0)", 'Server: Bit zielt in fast jedem Modus', [T2]],
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
console.log(`Mutationsprobe Kreaturen-Optik (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of [T1, T2]) {
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
