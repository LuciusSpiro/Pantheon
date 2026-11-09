'use strict';
// FAD-01 B: Mutationsprobe zu tools/test-sim-befehl-invasion.js. Kopiert Server, Shared, Content und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel
// und verlangt, dass der Test rot wird (Exit != 0). Überlebt eine Mutation, deckt der Test die Regel nicht ab.
//   node tools/mutation-invasion.js [begriff …] [--trocken]      (npm run test:invasion-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet (Exit 0).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-invasion-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools', 'fixtures'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'tools', 'fixtures', 'weltsim-golden-ohne-befehle.json'), path.join(TMP, 'tools', 'fixtures', 'weltsim-golden-ohne-befehle.json'));
const TESTS = ['tools/test-sim-befehl-invasion.js', 'tools/test-befehle.js'];
for (const t of TESTS) fs.copyFileSync(path.join(ROOT, t), path.join(TMP, t));
fs.copyFileSync(path.join(ROOT, 'tools', 'regie-fixture.js'), path.join(TMP, 'tools', 'regie-fixture.js'));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const B = 'server/weltsim/befehle.js', R = 'server/sim/regie-befehle.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  [B, "      if (fl.hochgestuft === true) return 'Flotte ist schon hochgestuft';\n", "", 'hochstufen: zweites Hochstufen derselben Flotte geht durch (hochgestuft-Test entfernt)'],
  [B, "fl.staerke += fl.staerke * W.flotte_hochstufen.wert.staerke_zuwachs;", "fl.staerke += fl.staerke * 0.2;", 'hochstufen: Zuwachs 20 statt 30 Prozent'],
  [B, "      fl.hochgestuft = true;\n    },\n  },\n\n  piratenueberfall", "      fl.staerke = Math.min(fl.staerke, fl.kap); fl.hochgestuft = true;\n    },\n  },\n\n  piratenueberfall", 'hochstufen: Stärke bleibt unter kap'],
  [B, "      fl.hochgestuft = true;\n    },\n  },\n\n  piratenueberfall", "    },\n  },\n\n  piratenueberfall", 'hochstufen: Feld hochgestuft wird nicht gesetzt'],
  [B, "      if (fl.miete) return 'Mietflotten werden nicht hochgestuft';\n", "", 'hochstufen: Mietflotte wird hochgestuft'],
  [B, "      if (fl.fraktion !== b.fraktion) return `Flotte ${fl.id} gehört nicht zu ${b.fraktion}`;\n", "", 'hochstufen: fremde Flotte wird hochgestuft'],
  [B, "      if (!F.fraktionen.includes(b.fraktion)) return `fraktion muss ${F.fraktionen.join(' oder ')} sein`;\n", "", 'hochstufen: Fraktion wird nicht geprüft'],
  [B, "      if (!w.war) return 'Krieg ist aus';\n      if (!fl) return 'unbekannte Flotte';", "      if (!fl) return 'unbekannte Flotte';", 'hochstufen: Krieg aus wird nicht geprüft'],
  [B, "flotte_hochstufen: ['typ', 'fraktion', 'flotte'],", "flotte_hochstufen: ['typ', 'fraktion', 'flotte', 'staerke'],", 'hochstufen: Fremdfeld erlaubt'],
  [B, "if (fl.hochgestuft !== undefined && (fl.hochgestuft !== true ||", "if (false && (fl.hochgestuft !== true ||", 'laden: Müll im Feld hochgestuft bleibt stehen'],
  [R, "  if (b.typ === 'flotte_hochstufen') return 'Hochstufen kommt nur aus einem Faden (Invasion), nicht aus einem Plan';   // FAD-01 B\n", "", 'plan: der Spielleiter kann flotte_hochstufen setzen'],
  [R, "s.vorgemerkt.push({ b: hoch, ab }, { b: ang, ab, w: 2 });", "s.vorgemerkt.push({ b: ang, ab, w: 2 }, { b: hoch, ab });", 'invasion: Angriff vor dem Hochstufen vorgemerkt'],
  [R, "Kern.filtereBefehle(z, wartend.concat([hoch, ang]))", "Kern.filtereBefehle(z, wartend.concat([ang, hoch]))", 'invasion: Angriff wird vor dem Hochstufen geprüft (zu schwach)'],
  [R, "    if (f) funkSenden(game, f);\n    schreibe(game, { art: 'lage_befehl', ausgang: 'vorgemerkt', key: 'invasion'", "    schreibe(game, { art: 'lage_befehl', ausgang: 'vorgemerkt', key: 'invasion'", 'invasion: keine Vorankündigung per Funk'],
  [R, "s.vorgemerkt.push({ b: hoch, ab }, { b: ang, ab, w: 2 });", "s.vorgemerkt.push({ b: hoch, ab }, { b: ang, ab });", 'invasion: Angriff ohne Ankündigungsmarke w'],
  [R, "const ab = n0 + 1 + vorlaufVon('invasion');", "const ab = n0 + 1;", 'invasion: ohne Vorlauf'],
  [R, "if (v || !gueltig.includes(hoch) || !gueltig.includes(ang)) {", "if (false) {", 'invasion: abgelehnter Befehl wird trotzdem vorgemerkt'],
  [R, "if (z.hexe[ziel].besitzer !== 'rom') return lehne('Ziel gehört nicht Rom');", "", 'invasion: Ziel ohne Wirkung auf Rom'],
  [R, "(w === 2 ? 'invasion' : b.typ)", "b.typ", 'entwarnung: Invasion bekommt den Angriffs-Text'],
  [R, "const w = e.w === 2 ? { art: 'invasion', ort: e.b.ziel } : trifftRom(ws.zustand, e.b);", "const w = trifftRom(ws.zustand, e.b);", 'laden: erneute Ankündigung ohne Invasions-Text'],
  [R, "w: e.w === 2 ? 2 : 1 }", "w: 1 }", 'speichern: w 2 geht verloren'],
  [R, "(e.b.typ === 'sabotage' || e.b.typ === 'flotte_hochstufen' || e.w === 2)", "(e.b.typ === 'sabotage')", 'laden: Invasionsbefehle zählen in vorgemerkt_max'],
];

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lesen = (datei) => { const t = fs.readFileSync(path.join(TMP, datei), 'utf8'); return t.replace(/\r\n/g, '\n'); };
let kaputt = 0;
for (const [datei, alt, , was] of MUTATIONEN) if (lesen(datei).split(alt).length !== 2) { console.log(`  ?? Anker nicht eindeutig: ${was} (${datei})`); kaputt++; }
if (kaputt) { console.log(`${kaputt} Anker nicht anwendbar`); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } process.exit(2); }
if (process.argv.includes('--trocken')) { console.log(`alle ${MUTATIONEN.length} Anker eindeutig`); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } process.exit(0); }

const lauf = (test) => spawnSync(process.execPath, [test], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
let ueberlebt = 0, gelaufen = 0;
console.log(`Mutationsprobe test-sim-befehl-invasion.js, test-befehle.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of TESTS) {
  const basis = lauf(t);
  console.log(`  Ausgangslage ${t}: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
}
for (const [datei, alt, neu, was] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  let wer = null, r = null;
  for (const t of TESTS) { r = lauf(t); if (r.status !== 0) { wer = path.basename(t, '.js').replace('test-', ''); break; } }
  fs.writeFileSync(f, orig);
  const fehler = ((r && r.stdout) || '').split('\n').filter((l) => /FEHLER/.test(l));
  if (!wer) ueberlebt++;
  console.log(`  ${wer ? 'rot  ' : 'GRÜN '} ${was}${wer ? ` (${wer}: ${fehler.length} Fehler, z. B. ${(fehler[0] || 'Absturz').replace(/^\s*FEHLER\s*/, '').slice(0, 64)})` : '  <-- ÜBERLEBT'}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) überlebt` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
