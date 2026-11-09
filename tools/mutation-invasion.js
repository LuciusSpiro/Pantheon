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
  [B, "  if (fl.hochgestuft === true) return 'Flotte ist schon hochgestuft';\n", "", 'invasion: zweites Hochstufen derselben Flotte geht durch (hochgestuft-Test entfernt)'],
  [B, "fl.staerke += fl.staerke * W.invasion.wert.staerke_zuwachs;", "fl.staerke += fl.staerke * 0.2;", 'invasion: Zuwachs 20 statt 30 Prozent'],
  [B, "  fl.hochgestuft = true;\n  if (st.T < A.min_treibstoff)", "  fl.staerke = Math.min(fl.staerke, fl.kap); fl.hochgestuft = true;\n  if (st.T < A.min_treibstoff)", 'invasion: Stärke bleibt unter kap'],
  [B, "  fl.hochgestuft = true;\n  if (st.T < A.min_treibstoff)", "  if (st.T < A.min_treibstoff)", 'invasion: Feld hochgestuft wird nicht gesetzt'],
  [B, "  if (fl.miete) return 'Mietflotten werden nicht hochgestuft';\n", "", 'invasion: Mietflotte wird hochgestuft'],
  [B, "      if (!I.fraktionen.includes(b.fraktion)) return `fraktion muss ${I.fraktionen.join(' oder ')} sein`;\n", "", 'invasion: Fraktion wird nicht geprüft'],
  [B, "invasion: ['typ', 'fraktion', 'flotte', 'ziel'],", "invasion: ['typ', 'fraktion', 'flotte', 'ziel', 'staerke'],", 'invasion: Fremdfeld erlaubt'],
  [B, "if (fl.hochgestuft !== undefined && (fl.hochgestuft !== true ||", "if (false && (fl.hochgestuft !== true ||", 'laden: Müll im Feld hochgestuft bleibt stehen'],
  [B, "      return KATALOG.angreifen.pruefe(invasionProbe(c, b), angriffVon(b));   // der Angriff gegen den Stand NACH dem Hochstufen, auf einer Kopie", "      return null;", 'atomar: der Angriff wird bei der Prüfung nicht mitgeprüft (Hochstufen ohne Angriff möglich)'],
  [B, "      if (KATALOG.invasion.pruefe(c, b)) return;   // gegen den echten Zustand erneut: nie ein Hochstufen ohne Angriff\n", "", 'atomar: anwenden prüft nicht erneut gegen den echten Zustand'],
  [B, "const c2 = Object.assign({}, c, { z: z2 });", "const c2 = c;", 'atomar: die Prüfung hochstuft den echten Zustand (keine Kopie)'],
  [B, "KATALOG.angreifen.pruefe(invasionProbe(c, b), angriffVon(b))", "KATALOG.angreifen.pruefe(c, angriffVon(b))", 'invasion: Angriff wird gegen den Stand VOR dem Hochstufen geprüft'],
  [B, "  if (st.T < A.min_treibstoff) st.T = A.min_treibstoff;", "  st.T = A.min_treibstoff;", 'invasion: Treibstoff wird auch abgesenkt'],
  [B, "  if (st.U < A.min_munition) st.U = A.min_munition;", "", 'invasion: Munition wird nicht aufgefuellt'],
  [B, "const A = W.angreifen.wert, st = c.z.vorrat[fl.fraktion];", "const A = W.angreifen.wert, st = c.z.vorrat.rom;", 'invasion: falsche Fraktion wird versorgt'],
  [B, "      if (istHex(c.z, b.ziel) && c.z.hexe[b.ziel].besitzer !== 'rom') return 'Ziel gehört nicht Rom';\n", "", 'invasion: Ziel ohne Wirkung auf Rom'],
  [R, "  if (b.typ === 'invasion') return 'Invasion kommt nur aus einem Faden, nicht aus einem Plan';   // FAD-01 B\n", "", 'plan: der Spielleiter kann invasion setzen'],
  [R, "if (v || !gueltig.includes(inv)) {", "if (false) {", 'invasion: abgelehnter Befehl wird trotzdem vorgemerkt'],
  [R, "    if (f) funkSenden(game, f);\n    schreibe(game, { art: 'lage_befehl', ausgang: 'vorgemerkt', key: 'invasion'", "    schreibe(game, { art: 'lage_befehl', ausgang: 'vorgemerkt', key: 'invasion'", 'invasion: keine Vorankündigung per Funk'],
  [R, "s.vorgemerkt.push({ b: inv, ab, w: 1 });", "s.vorgemerkt.push({ b: inv, ab });", 'invasion: Eintrag ohne Ankündigungsmarke w'],
  [R, "const ab = n0 + 1 + vorlaufVon('invasion');", "const ab = n0 + 1;", 'invasion: ohne Vorlauf'],
  [R, "if (abk > 0 && Number.isFinite(s.letzte[key]) && n0 - s.letzte[key] < abk) return lehne(", "if (false) return lehne(", 'abkühlzeit: wird nicht durchgesetzt'],
  [R, "    s.letzte[key] = n0;\n    const f = w && vorwarnText(w, ab, n0, inv);", "    const f = w && vorwarnText(w, ab, n0, inv);", 'abkühlzeit: wird bei der Annahme nicht gesetzt'],
  [R, "key = abkuehlSchluessel({ typ: 'invasion', fraktion: 'ger' });", "key = 'invasion';", 'abkühlzeit: falscher Schlüssel (nicht je Fraktion über abkuehlSchluessel)'],
  [R, "  if (s.vorgemerkt.length >= WARTEND_MAX) return lehne(", "  if (false) return lehne(", 'obergrenze: Invasion ignoriert die volle Warteschlange'],
  [R, "  if (s.vorgemerkt.length >= WARTEND_MAX) { const grund", "  if (false) { const grund", 'obergrenze: Sprengung ignoriert die volle Warteschlange'],
  [R, "const t = (texte().entwarnung || {})[b.typ];", "const t = (texte().entwarnung || {})[b.typ === 'invasion' ? 'angreifen' : b.typ];", 'entwarnung: Invasion bekommt den Angriffs-Text'],
  [R, "const w = trifftRom(ws.zustand, e.b);   // nur ankündigen, wo die Wirkung noch kommt", "const w = e.b.typ === 'invasion' ? { art: 'invasion', ort: e.b.ziel } : trifftRom(ws.zustand, e.b);   // nur ankündigen, wo die Wirkung noch kommt", 'laden: erneute Ankündigung ohne Prüfung, ob das Ziel noch Rom gehört'],
  [R, "(e.w ? { b: klon(e.b), ab: e.ab, w: 1 } :", "(e.w ? { b: klon(e.b), ab: e.ab } :", 'speichern: die Marke w geht verloren'],
  [R, "(b.typ === 'angreifen' || b.typ === 'invasion') ? b.ziel : (b.typ === 'piratenueberfall' || b.typ === 'sabotage') ? b.ort : null;\n  if (!ort ||", "(b.typ === 'angreifen') ? b.ziel : (b.typ === 'piratenueberfall' || b.typ === 'sabotage') ? b.ort : null;\n  if (!ort ||", 'vorTick: eine Invasion ohne Ankündigung wirkt unangekündigt auf Rom'],
  [R, "if (sab ? nSab >= R.plan.wert.faden_vorgemerkt_max :", "if (sab ? nSab >= R.plan.wert.vorgemerkt_max :", 'laden: Faden-Befehle bis plan.vorgemerkt_max (Summe passt nicht ins Schema)'],
  [R, "|| typeof e.b.typ !== 'string' || !Object.prototype.hasOwnProperty.call(KATALOG, e.b.typ)) continue;", "|| typeof e.b.typ !== 'string') continue;", 'laden: unbekannte Typen (auch ein einzelnes Hochstufen) kommen in die Warteschlange'],
  [R, "    if (FADEN_BEFEHLE.includes(typ)) continue;   // Faden-Befehle sind nicht Sache des Spielleiters\n", "", 'ausschnitt: die Abkühlzeit der Invasion erscheint im Ausschnitt des Spielleiters'],
  [B, "      return KATALOG.angreifen.pruefe(invasionProbe(c, b), angriffVon(b));   // der Angriff gegen den Stand NACH dem Hochstufen, auf einer Kopie\n    },\n    anwenden(c, b) {\n      if (KATALOG.invasion.pruefe(c, b)) return;   // gegen den echten Zustand erneut: nie ein Hochstufen ohne Angriff\n      hochstufen(c, flotteMit(c, b.flotte));\n      KATALOG.angreifen.anwenden(c, angriffVon(b));", "      return null;\n    },\n    anwenden(c, b) {\n      hochstufen(c, flotteMit(c, b.flotte));\n      if (!KATALOG.angreifen.pruefe(c, angriffVon(b))) KATALOG.angreifen.anwenden(c, angriffVon(b));", 'atomar: Hochstufen wirkt auch, wenn der Angriff scheitert (altes Verhalten, halbe Invasion)'],
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
