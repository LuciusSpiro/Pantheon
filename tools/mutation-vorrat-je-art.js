'use strict';
// FRE-03 E: Mutationsprobe zu tools/test-vorrat-je-art.js. Kopiert Server, Shared, Content, die Werkzeuge und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Regel
// (Eintrag mit fuenftem Element true: alle Fundstellen) und verlangt, dass der Test rot wird (Exit != 0). Ueberlebt eine Mutation, deckt kein Test die Regel ab.
//   node tools/mutation-vorrat-je-art.js [begriff ...]      (npm run test:vorrat-je-art-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-vorrat-je-art-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'tools'))) if (f.endsWith('-fixture.js') || f === 'test-vorrat-je-art.js') fs.copyFileSync(path.join(ROOT, 'tools', f), path.join(TMP, 'tools', f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }
const TEST = 'tools/test-vorrat-je-art.js';

const VR = 'server/sim/abenteuer-vorrat.js', BR = 'server/sim/abenteuer-brett.js', AB = 'content/faeden/absichten.json', SC = 'content/schema/weltstand.schema.json';
// [Datei, alter Text (genau einmal, mit fuenftem Element true: mindestens einmal, alle werden ersetzt), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- Quote je Art (fuenf Stellen)
  [VR, "  while (dieseArt().length > quoteFuer(katalog, e.art)) F.vorrat.splice(F.vorrat.indexOf(dieseArt()[0]), 1);", "", 'hinzufuegen: keine Quote je Art (nur die Summe)'],
  [VR, "  while (F.vorrat.length > wert(katalog, 'vorrat_max')) F.vorrat.shift();", "", 'hinzufuegen: die Summe vorrat_max wird nicht eingehalten'],
  [VR, "while (dieseArt().length > quoteFuer(katalog, e.art)) F.vorrat.splice(F.vorrat.indexOf(dieseArt()[0]), 1);", "while (dieseArt().length > quoteFuer(katalog, e.art)) F.vorrat.shift();", 'hinzufuegen: die Quote verdraengt den aeltesten Eintrag IRGENDEINER Art'],
  [VR, "return has(q, art) ? q[art] : wert(katalog, 'vorrat_max'); }", "return has(q, art) ? q[art] : 1; }", 'Art ohne Quote bekommt Quote 1 statt vorrat_max'],
  [VR, "return begrenzt(F.vorrat, AP().katalogStandard()).map((e) => klon(e));", "return F.vorrat.slice(-wert(AP().katalogStandard(), 'vorrat_max')).map((e) => klon(e));", 'toSave: keine Quote je Art'],
  [VR, "  return liste.filter((x, i) => behalten.has(i)).slice(-wert(katalog, 'vorrat_max'));", "  return liste.filter((x, i) => behalten.has(i));", 'begrenzt (toSave, lesen): die Summe vorrat_max fehlt'],
  [VR, "if (k <= quoteFuer(katalog, a)) behalten.add(i); }", "if (k <= quoteFuer(katalog, a) + 1) behalten.add(i); }", 'begrenzt: eine Quote zu viel je Art'],
  [VR, "for (let i = liste.length - 1; i >= 0; i--) {", "for (let i = 0; i < liste.length; i++) {", 'begrenzt: die aeltesten statt der neuesten bleiben'],
  [VR, "  if (out.length) F.vorrat = begrenzt(out, katalog);", "  if (out.length) F.vorrat = out;", 'lesen: keine Quote je Art beim Laden'],
  [VR, "const quoten = jeArt('vorrat_max_je_art', 'ganze Zahl >= 1', ganzMin1);", "const quoten = null;", 'werteFehler: Quoten werden nicht geprueft'],
  [VR, "reduce((a, b) => a + b, 0) > katalog.werte.vorrat_max.wert)", "reduce((a, b) => a + b, 0) > 999)", 'werteFehler: die Summe der Quoten ueber vorrat_max wird nicht gemeldet'],
  [VR, "if (!muster || !muster.test(a)) f(`${k}.${a}: Name nach name_muster`);", "", 'werteFehler: der Artname wird nicht gegen name_muster geprueft'],
  [AB, '"vorrat_max_je_art": {"wert":{"angebot":4,"notruf":2}', '"vorrat_max_je_art": {"wert":{"angebot":4,"notruf":3}', 'Daten: Quote notruf 3 (Summe ueber vorrat_max)'],
  [SC, '"vorrat":{"type":"array","maxItems":12,', '"vorrat":{"type":"array","maxItems":4,', 'Schema: maxItems des Vorrats unter vorrat_max'],
  // ---- Alter in Spielzeit
  [VR, "const jetztFuer = (game, katalog, art) => (zeitArt(katalog, art) ? (game && Number.isFinite(game.time) && game.time >= 0 ? Math.floor(game.time) : 0) : jetzt(game));", "const jetztFuer = (game, katalog, art) => jetzt(game);", 'Alter: auch die Art notruf zaehlt Ticks der Weltsim (altert unter dem Takt nie)'],
  [VR, "t - e.erstellt > alterMaxFuer(katalog, e.art))", "t - e.erstellt > wert(katalog, 'vorrat_alter_max'))", 'gueltig: die Art notruf altert nach vorrat_alter_max statt vorrat_alter_max_s_je_art'],
  [VR, "  const t = jetztFuer(game, katalog, e.art);\n  if ((e.ablauf", "  const t = jetzt(game);\n  if ((e.ablauf", 'gueltig: jetzt ist immer der Tick'],
  [VR, "erstellt: jetztFuer(game, katalog, o.art) };", "erstellt: jetzt(game) };", 'eintrag: erstellt ist immer der Tick'],
  [VR, "const alterMaxFuer = (katalog, art) => (zeitArt(katalog, art) ? tabelle(katalog, 'vorrat_alter_max_s_je_art')[art] : wert(katalog, 'vorrat_alter_max'));", "const alterMaxFuer = (katalog, art) => (zeitArt(katalog, art) ? tabelle(katalog, 'vorrat_alter_max_s_je_art')[art] : tabelle(katalog, 'vorrat_alter_max_s_je_art').notruf);", 'gueltig: die Art angebot altert in Sekunden'],
  // ---- Entnahme beim Entstehen eines Takt-Notrufs
  [BR, "  if (ausV) return ausV;\n", "", 'Entstehen: nie ein Plan aus dem Vorrat (immer der Daten-Plan)'],
  [BR, "ausVorratFuerNotruf(game, BW.vorrat_art_notruf, o.hex,", "ausVorratFuerNotruf(game, BW.vorrat_art, o.hex,", 'Entnahme nimmt aus der Art angebot statt notruf'],
  [VR, "  if (!Absicht().aktiv(game)) return nein(CODES.INAKTIV, 'der Modus Absichten ist aus');\n  const F = zustand(game);\n  if (!F || !Array.isArray(F.vorrat)) return nein(CODES.VORRAT_LEER, 'der Vorrat ist leer');\n  if (typeof anbieter", "  const F = zustand(game);\n  if (!F || !Array.isArray(F.vorrat)) return nein(CODES.VORRAT_LEER, 'der Vorrat ist leer');\n  if (typeof anbieter", 'ausVorratFuerNotruf: kein Waechter fuer den Modus Absichten (Opt-in)'],
  [VR, "|| !Brett().passtZuLage(game, r.plan, hex)) continue;   // passt nicht zu diesem Ort", "|| false) continue;   // passt nicht zu diesem Ort", 'Entnahme: der Ort des Notrufs wird nicht gegen den Plan geprueft (passtZuLage)'],
  [VR, "if (g.grund !== INS().CODES.WELT_BEDINGUNG) entnehmen(game, e); continue; }", "entnehmen(game, e); continue; }", 'Entnahme: ein Nein der Welt (Wiederholung) verwirft den Eintrag'],
  [VR, "    if (g.wartet) continue;\n    if (!g.ok) { if (g.grund !==", "    if (!g.ok) { if (g.grund !==", 'Entnahme: kein freies Ziel (wartet) verwirft den Eintrag'],
  [VR, "    if (res && res.ok) { entnehmen(game, e); return { ok: true, ergebnis: res }; }", "    if (res) { entnehmen(game, e); return { ok: true, ergebnis: res }; }", 'Entnahme: der Eintrag verlaesst den Vorrat, auch wenn das Brett das Angebot nicht nahm'],
  [BR, "if (!plan.beats || !plan.beats[0] || plan.beats[0].typ !== 'notruf') return { ok: false };", "", 'Entnahme: auch ein Plan ohne Beat notruf wird als Notruf angeboten'],
  [BR, "bezug: { sprecher }, erstellt });", "bezug: { sprecher } });", 'Angebot aus dem Vorrat traegt das erste Alter des Eintrags nicht'],
  // ---- Einlegen (Ablehnen, Verfall)
  [BR, "const vorratArtVon = (a) => (a.notruf ? BW.vorrat_art_notruf : BW.vorrat_art);", "const vorratArtVon = (a) => BW.vorrat_art;", 'Einlegen: ein Notruf-Angebot geht unter der Art angebot ein'],
  [BR, "  if (a.absicht) { try { Vorrat().einlegenAus(game, a, vorratArtVon(a)); }", "  if (a.absicht && !a.notruf) { try { Vorrat().einlegenAus(game, a, vorratArtVon(a)); }", 'Ablehnen: ein Notruf-Angebot kommt nicht in den Vorrat'],
  [BR, "    if (!a.absicht || F.abenteuerAngebote.includes(a) || b.antworten.includes(a.nr)) continue;", "    if (!a.absicht || a.notruf || F.abenteuerAngebote.includes(a) || b.antworten.includes(a.nr)) continue;", 'Verfall: ein Notruf-Angebot kommt nicht in den Vorrat'],
  // ---- Luecke aus D: gefuellter Vorrat im Absichten-Modus
  [BR, "if (P.regulaereAngebote(F).length >= W.abenteuer.angebote_max || P.abenteuerLaufend(F)) return null;\n  const hex = crewHex(game);", "if (F.abenteuerAngebote.length >= W.abenteuer.angebote_max || P.abenteuerLaufend(F)) return null;\n  const hex = crewHex(game);", 'Vorrat fuellt das Brett: Notruf-Angebote zaehlen mit (ausVorratEinsAnbieten)'],
  [BR, "  while (out.length < W.abenteuer.angebote_max) {\n    const a = ausVorratEinsAnbieten(game);", "  while (out.length < 1) {\n    const a = ausVorratEinsAnbieten(game);", 'ausVorratFuellen fuellt nur ein Angebot'],
];

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lauf = () => spawnSync(process.execPath, [TEST], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
let ueberlebt = 0, gelaufen = 0;
console.log(`Mutationsprobe test-vorrat-je-art.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
const basis = lauf();
console.log(`  Ausgangslage: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
for (const [datei, alt, neu, was, alle] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  const stellen = text.split(alt).length - 1;
  if (alle ? stellen < 1 : stellen !== 1) { console.log(`  ?? ${was}: Textstelle nicht ${alle ? 'gefunden' : 'eindeutig gefunden'} (${datei}, ${stellen}x)`); ueberlebt++; continue; }
  const neuText = alle ? text.split(alt).join(neu) : text.replace(alt, () => neu);
  fs.writeFileSync(f, nl ? neuText.replace(/\n/g, '\r\n') : neuText);
  const r = lauf();
  fs.writeFileSync(f, orig);
  const rot = r.status !== 0;
  const fehler = (r.stdout || '').split('\n').filter((l) => /FEHLER/.test(l));
  if (!rot) ueberlebt++;
  console.log(`  ${rot ? 'rot  ' : 'GRÜN '} ${was}${rot ? ` (${fehler.length} Fehler, z. B. ${(fehler[0] || 'Absturz').replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : '  <-- ÜBERLEBT'}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) überlebt` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
