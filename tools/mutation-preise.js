'use strict';
// SUND-03b P: Mutationsprobe zu tools/test-preise.js. Kopiert Server, Shared, Content, public/js und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt),
// ändert dort je Lauf EINE Regel und verlangt, dass der Test rot wird (Exit != 0). Überlebt eine Mutation, deckt kein Test die Regel ab.
// Vor den Läufen prüft ein Selbstcheck, dass jeder Anker genau einmal im Quelltext steht (sonst Exit 2: keine still übersprungene Mutation). --trocken: nur der Selbstcheck.
//   node tools/mutation-preise.js [begriff …] [--trocken]      (npm run test:preise-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-preise-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'tools', 'test-preise.js'), path.join(TMP, 'tools', 'test-preise.js'));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const PR = 'server/sim/preise.js', SH = 'server/sim/shop.js', GA = 'server/game.js', WE = 'server/sim/werft.js', DW = 'content/welt/preise-werte.json',
  CO = 'public/js/consoles.js', TU = 'public/js/terminal-ui.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- Embargo
  [PR, "  if (Kern.BEFEHLE.embargoAktiv(z, besitzer) && a.gut && z.embargo[besitzer].waren.includes(a.gut)) {", "  if (Kern.BEFEHLE.embargoAktiv(z, besitzer) && a.gut) {", 'Embargo: die Ware des Artikels zählt nicht'],
  [PR, "  if (Kern.BEFEHLE.embargoAktiv(z, besitzer) && a.gut && z.embargo[besitzer].waren.includes(a.gut)) {", "  if (z.embargo && a.gut && Object.values(z.embargo).some((e) => e.waren.includes(a.gut))) {", 'Embargo: gilt für jedes Ziel statt für den Besitzer des Hafens'],
  [PR, "  if (Kern.BEFEHLE.embargoAktiv(z, besitzer) && a.gut && z.embargo[besitzer].waren.includes(a.gut)) {", "  if (false) {", 'Embargo: wirkt nie'],
  [DW, '"embargo": {"wert": {"zuschlag": 0.3}', '"embargo": {"wert": {"zuschlag": 0.6}', 'Daten: Embargo-Zuschlag 0,6'],
  // ---- Belagerung
  [PR, "  if (Wirkungen.belagerungen(z, hex).length) {", "  if (false) {", 'Belagerung des Hafens: wirkt nie'],
  [PR, "  if (Wirkungen.belagerungen(z, hex).length) { summe += B.hafen;", "  if (Wirkungen.belagerungen(z, hex).length) { summe += B.umkreis;", 'Belagerung des Hafens: nur der kleine Zuschlag'],
  [PR, "Daten.abstand(d, hex, c) <= B.radius &&", "Daten.abstand(d, hex, c) <= B.radius + 1 &&", 'Umkreis: ein Sprung zu weit'],
  [PR, "  else if (d.codes.some(", "  else if (false && d.codes.some(", 'Umkreis: wirkt nie'],
  [PR, "summe += B.umkreis; gruende.push('umkreis');", "summe += B.umkreis; gruende.push('belagerung');", 'Umkreis: falscher Grund im Hinweis'],
  // ---- Vorrat
  [PR, "    if (v <= V.knapp.bis) {", "    if (v < V.knapp.bis) {", 'Vorrat: Grenze knapp ohne Gleichheit'],
  [PR, "    else if (v >= V.reichlich.ab) {", "    else if (v > V.reichlich.ab) {", 'Vorrat: Grenze reichlich ohne Gleichheit'],
  [PR, "z.vorrat[besitzer][V.gut])) {\n    const v = z.vorrat[besitzer][V.gut];", "z.vorrat[besitzer][V.gut])) {\n    const v = z.vorrat.rom[V.gut];", 'Vorrat: immer der Vorrat von Rom'],
  [PR, "  if (a.gut === V.gut && z.vorrat", "  if (z.vorrat", 'Vorrat: wirkt auf alle Verbrauchsgüter, nicht nur den Torpedo'],
  [DW, '"knapp": {"bis": 8, "zuschlag": 0.3}', '"knapp": {"bis": 8, "zuschlag": 0.8}', 'Daten: Zuschlag knapp 0,8 (Klemme)'],
  // ---- Klemme, Rundung
  [PR, "const klemme = (f) => Math.min(W.faktor_grenzen.wert.max, Math.max(W.faktor_grenzen.wert.min, f));", "const klemme = (f) => f;", 'Klemme: keine'],
  [PR, "const klemme = (f) => Math.min(W.faktor_grenzen.wert.max, Math.max(W.faktor_grenzen.wert.min, f));", "const klemme = (f) => Math.min(W.faktor_grenzen.wert.max, f);", 'Klemme: nur oben'],
  [PR, "const klemme = (f) => Math.min(W.faktor_grenzen.wert.max, Math.max(W.faktor_grenzen.wert.min, f));", "const klemme = (f) => Math.max(W.faktor_grenzen.wert.min, f);", 'Klemme: nur unten'],
  [DW, '"faktor_grenzen": {"wert": {"min": 0.5, "max": 1.5}', '"faktor_grenzen": {"wert": {"min": 0.5, "max": 2}', 'Daten: Obergrenze 2'],
  [PR, "Math.max(1, Math.round(p * f))", "Math.round(p * f)", 'Rundung: kein Mindestpreis 1'],
  [PR, "Math.max(1, Math.round(p * f))", "Math.max(1, Math.ceil(p * f))", 'Rundung: aufrunden'],
  [PR, "Math.max(1, Math.round(p * f))", "Math.max(1, Math.floor(p * f))", 'Rundung: abrunden'],
  [PR, "const rund = (x) => Math.round(x * 1e6) / 1e6;", "const rund = (x) => x;", 'Summe: Gleitkomma-Rest bleibt (1 + 0,3 - 0,2)'],
  // ---- Welche Artikel und Häfen
  [PR, "  if (!a || a.verbrauchsgut !== true || !z || !z.hexe || !has(z.hexe, hex)) return ohne;", "  if (!a || !z || !z.hexe || !has(z.hexe, hex)) return ohne;", 'Artikel: Flag verbrauchsgut im Kern ignoriert'],
  [PR, "  if (!d.hex[hex] || d.hex[hex].hafen === '') return ohne;", "  if (!d.hex[hex]) return ohne;", 'Ort: auch Hexe ohne Hafen'],
  [PR, "  if (!besitzer || W.neutrale_besitzer.wert.includes(besitzer)) return ohne;", "  if (!besitzer) return ohne;", 'Konkordat-Hafen: Regeln wirken auch dort'],
  [PR, "  if (!z || !hex || W.kontexte_ohne.wert.includes(ctx)) return { faktor: 1, gruende: [] };", "  if (!z || !hex) return { faktor: 1, gruende: [] };", 'Karawane: Lagefaktor gilt auch bei Vaelen'],
  [DW, '"neutrale_besitzer": {"wert": ["kon", "saum"]', '"neutrale_besitzer": {"wert": []', 'Daten: keine neutralen Besitzer'],
  [DW, '"sonde": {"verbrauchsgut": false}', '"sonde": {"verbrauchsgut": true, "gut": "M"}', 'Daten: Sonde als Verbrauchsgut'],
  [DW, '"ladung": {"verbrauchsgut": false}', '"ladung": {"verbrauchsgut": true, "gut": "E"}', 'Daten: Sprengstoff als Verbrauchsgut'],
  // ---- Kauf, Snapshot, Anzeige
  [SH, "  const price = Preise.preisFuer(game, entry, ctx);", "  const price = priceFor(entry, ctx);", 'Kauf: rechnet mit dem Grundpreis statt dem Lagepreis'],
  [SH, "function sperreFuer(game) { return game.ship.docked ?", "function sperreFuer(game) { return false && game.ship.docked ?", 'Handelssperre: Stützpunkt wird nicht mehr erkannt'],
  [GA, "(this.weltsim && !shop.sperreFuer(this) ? Preise.snapshot", "(this.weltsim ? Preise.snapshot", 'Snapshot: Preise auch am gesperrten Stützpunkt'],
  [GA, "(this.weltsim && !shop.sperreFuer(this) ? Preise.snapshot(this, shop.shopContext(this)) : null)", "(false ? 0 : null)", 'Snapshot: nie ein Feld shopPreise'],
  [PR, "    if (l.faktor === 1 || !l.gruende.length) continue;", "    if (false) continue;", 'Snapshot: auch Artikel ohne Lage'],
  [PR, "  return (faktor > 1 ? T.teurer : T.billiger) + ': '", "  return (faktor > 1 ? T.billiger : T.teurer) + ': '", 'Hinweis: teurer und günstiger vertauscht'],
  [PR, ".replace('{fraktion}', wer)", ".replace('{fraktion}', '')", 'Hinweis: der Fraktionsname fehlt'],
  [CO, "const price = lage ? lage[0] : (it.prices", "const price = lage ? it.price : (it.prices", 'Client: zeigt den Grundpreis statt des Lagepreises'],
  [CO, "lage ? { preisHinweis: lage[1] } : {});", "{});", 'Client: reicht den Hinweis nicht weiter'],
  [TU, "hinweis: sel.preisHinweis ? {", "hinweis: false ? {", 'Terminal: zeigt den Hinweis nicht'],
  // ---- Werft
  [WE, "return hat(t, id) ? t[id] : null; }", "return hat(t, id) ? Math.round(t[id] * require('./preise.js').faktorFuer(game, 'medipack', '0305')) : null; }", 'Werft: Preise folgen der Lage (muss rot werden)'],
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
  if (schlecht.length) { console.log(`Anker-Check: ${schlecht.length} von ${MUTATIONEN.length} Mutationen nicht anwendbar:\n  ` + schlecht.join('\n  ')); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } process.exit(2); }
  console.log(`Anker-Check: alle ${MUTATIONEN.length} Anker genau einmal gefunden.`);
  if (process.argv.includes('--trocken')) { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } process.exit(0); }
}

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lauf = () => spawnSync(process.execPath, ['tools/test-preise.js'], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
let ueberlebt = 0, gelaufen = 0;
console.log(`Mutationsprobe test-preise.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
const basis = lauf();
console.log(`  Ausgangslage: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
for (const [datei, alt, neu, was] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  const r = lauf();
  fs.writeFileSync(f, orig);
  const rot = r.status !== 0;
  const fehler = (r.stdout || '').split('\n').filter((l) => /FEHLER/.test(l));
  if (!rot) ueberlebt++;
  console.log(`  ${rot ? 'rot  ' : 'GRÜN '} ${was}${rot ? ` (${fehler.length} Fehler, z. B. ${(fehler[0] || 'Absturz').replace(/^\s*FEHLER\s*/, '').slice(0, 64)})` : '  <-- ÜBERLEBT'}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) überlebt` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
