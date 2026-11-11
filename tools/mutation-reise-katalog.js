'use strict';
// FRE-03 C: Mutationsprobe zu tools/test-reise-katalog.js. Kopiert Server, Shared, Content und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel
// (Eintrag mit fünftem Element true: alle Fundstellen) und verlangt, dass der Test rot wird (Exit != 0). Überlebt eine Mutation, deckt kein Test die Regel ab.
//   node tools/mutation-reise-katalog.js [begriff …]      (npm run test:reise-katalog-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-katalog-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TEST = 'tools/test-reise-katalog.js';
fs.copyFileSync(path.join(ROOT, TEST), path.join(TMP, TEST));
fs.copyFileSync(path.join(ROOT, 'tools', 'regie-fixture.js'), path.join(TMP, 'tools', 'regie-fixture.js'));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const RE = 'server/sim/reise-ereignis.js', MA = 'server/sim/marken.js', DK = 'content/reise/ereignisse.json', DA = 'content/faeden/absichten.json';
// [Datei, alter Text (genau einmal, mit fünftem Element true: mindestens einmal, alle werden ersetzt), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- Folge beim Ignorieren (Code)
  [RE, "  ignoriertBuchen(game, o);\n}", "}", 'Ignorieren: die Folge wird nicht gebucht (Verfall und Ablehnen)'],
  [RE, "typ: 'fund', hex: o.hex, sym: ig.fund.sym", "typ: 'spur', hex: o.hex, sym: ig.fund.sym", 'Ignorieren: die Marke hat den falschen Typ'],
  [RE, "hex: o.hex, sym: ig.fund.sym, ticks: ig.fund.ticks", "hex: o.hex, sym: ig.fund.sym, ticks: 1", 'Ignorieren: die Ticks stehen nicht in den Daten'],
  [RE, "hex: o.hex, sym: ig.fund.sym,", "hex: o.hex, sym: 'boje',", 'Ignorieren: das Zeichen kommt nicht aus den Daten'],
  [RE, "    Chronik.eintragen(game, { art: 'reise', ref: o.id, kurz: fmt(ig.chronik, { ort: hexName(o.hex) }).slice(0, WERTE.chronik_kurz_max), param: { art: 'notruf', hex: o.hex } });\n  } catch", "  } catch", 'Ignorieren: keine Chronik-Zeile'],
  [RE, "  try {\n    const m = Marken.setze(game, { id: 'fund:' + o.marke,", "  gruendeBuchen(game, ['reise_hilfe_rom']);\n  try {\n    const m = Marken.setze(game, { id: 'fund:' + o.marke,", 'Ignorieren: kostet Ruf (reise_hilfe_rom gebucht, rufLog wächst)'],
  [RE, "  try {\n    const m = Marken.setze(game, { id: 'fund:' + o.marke,", "  game.weltsim.zustand.seed = (game.weltsim.zustand.seed | 0) + 1;\n  try {\n    const m = Marken.setze(game, { id: 'fund:' + o.marke,", 'Ignorieren: verändert den Sim-Zustand'],
  [RE, "  notrufVerfaellt(game, R, o, 'abgelehnt');   // Ablehnen kostet nichts: keine Wirkung, kein Ruf", "  Marken.entferne(game, o.marke); R.offen.splice(R.offen.indexOf(o), 1);", 'Ablehnen: ohne Folge (kein Fund)'],
  [RE, "const folgeBuchen = (game, e) => gruendeBuchen(game, (e && e.folge && e.folge.angenommen) || []);", "const folgeBuchen = (game, e) => gruendeBuchen(game, []);", 'Ankunft: folge.angenommen wird nicht gebucht'],
  // ---- Marken-Grenze
  [MA, "  return aufMaxKuerzen(ziele(game).concat(L));", "  return ziele(game).concat(L).slice(0, MAX);", 'Marken: wieder slice(0, MAX) (der jüngste Fund verschwindet hinter Notruf-Marken)'],
  [MA, "const WEICHT_ZUERST = ['notruf', 'kontakt', 'spur', 'fund'];", "const WEICHT_ZUERST = ['fund', 'kontakt', 'spur', 'notruf'];", 'Marken: Funde weichen vor Notruf-Marken'],
  [MA, "const WEICHT_ZUERST = ['notruf', 'kontakt', 'spur', 'fund'];", "const WEICHT_ZUERST = ['notruf', 'fund', 'kontakt', 'spur'];", 'Marken: Funde weichen vor Kontakt und Spur'],
  [MA, "const WEICHT_ZUERST = ['notruf', 'kontakt', 'spur', 'fund'];", "const WEICHT_ZUERST = ['ziel', 'notruf', 'kontakt', 'spur', 'fund'];", 'Marken: Ziele weichen zuerst'],
  [MA, "  while (out.length > MAX) {", "  while (out.length > MAX + 1) {", 'Marken: MAX wird überschritten'],
  // ---- Katalog-Daten
  [DK, '"besitzer": ["vorl"], "min_abstand": 6 }', '"besitzer": ["rom"], "min_abstand": 6 }', 'Katalog: kein Eintrag für Vorläufer-Sektoren (zwei Sektoren ohne Kandidat)', true],
  [DK, '"besitzer": ["pirat"], "min_abstand": 6 }', '"besitzer": ["rom"], "min_abstand": 6 }', 'Katalog: kein Eintrag für Piraten-Sektoren', true],
  [DK, '"besitzer": ["ger"], "min_abstand": 6 }', '"besitzer": ["rom"], "min_abstand": 6 }', 'Katalog: nur noch ein Eintrag für Germanen-Sektoren', true],
  [DK, '"gefahr": false', '"gefahr": true', 'Katalog: keine Notrufe ohne Gefahr', true],
  [DK, '"ablehnen": [], "ignoriert": { "fund": { "sym": "wrack", "ticks": 60 }, "chronik": "Bei {ort} treibt das Wrack des Frachters Aurelia" }', '"ablehnen": []', 'Katalog: ein alter Notruf ohne folge.ignoriert'],
  [DK, '"ablehnen": [], "ignoriert": { "fund": { "sym": "boje", "ticks": 40 }, "chronik": "Bei {ort} schwebt ein Vorläufer-Brocken ohne Schiff" }', '"ablehnen": []', 'Katalog: ein neuer Notruf ohne folge.ignoriert'],
  [DK, '"ticks": 60 }, "chronik": "Bei {ort} treibt das Wrack des Frachters Aurelia"', '"ticks": 0 }, "chronik": "Bei {ort} treibt das Wrack des Frachters Aurelia"', 'Katalog: Fund mit 0 Ticks'],
  [DK, '"Hier Händler Silberfuchs: Piraten hängen uns bei {ort} am Heck, und kein Läufer', '"Hier Händler Silberfuchs: Etwas hängt uns bei {ort} am Heck, und kein Läufer', 'Katalog: ein Notruf mit Gefahr nennt sie im Text nicht'],
  [DA, '"wendungen": ["keine","piraten"]', '"wendungen": ["keine","kaperung"]', 'Absichten: keine Wendung piraten mehr'],
];

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lauf = () => spawnSync(process.execPath, [TEST], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
let ueberlebt = 0, gelaufen = 0;
console.log(`Mutationsprobe test-reise-katalog.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
