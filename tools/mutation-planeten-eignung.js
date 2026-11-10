'use strict';
// DYN-01 C: Mutationsprobe zu tools/test-planeten-eignung.js. Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), veraendert dort je Lauf EINE Stelle der Eignungspruefung
// (Zeile weg bzw. Datei-Eintrag der Eignungsdatei veraendert) und verlangt, dass der Test rot wird (Exit != 0 UND eine ✗-Zeile; ein Absturz zaehlt nicht als erkannt). Ueberlebt eine Mutation, deckt der Test die Pflicht nicht ab.
// Selbstcheck: VOR jedem Lauf muss jeder Anker genau einmal in der Kopie stehen, sonst Exit 2 (statt eine Mutation still zu ueberspringen).
//   node tools/mutation-planeten-eignung.js [begriff ...] [--trocken]      (npm run test:planeten-eignung-mutation)
// Keine node_modules-Junction (nie loeschen, was woanders liegt): NODE_PATH zeigt auf die des Repos.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-eignung-'));
const loesche = () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } };
for (const d of ['server', 'shared', 'content']) fs.cpSync(path.join(ROOT, d), path.join(TMP, d), { recursive: true });
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });   // der Server liest karte-tokens.js
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
for (const t of ['test-planeten-eignung.js', 'regie-fixture.js']) fs.copyFileSync(path.join(ROOT, 'tools', t), path.join(TMP, 'tools', t));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
const TEST = 'tools/test-planeten-eignung.js';

const AO = 'server/sim/abenteuer-orte.js', EM = 'server/sim/planeten-eignung.js', ED = 'content/welt/planeten-eignung.json', OD = 'content/welt/abenteuer-orte.json';
// [Datei, Anker (genau einmal), Ersatz, Beschreibung]
const MUTATIONEN = [
  [AO, "  if (!Eignung.artPasstAmKoerper(k.planetenart, o.art)) return null;", "", 'bestellenAmKoerper: keine Eignungspruefung'],
  [AO, "{ planetenart: p.art, beam:", "{ beam:", 'bestellenAmKoerper: Planetenart des Koerpers unbekannt'],
  [AO, "  return Eignung.grundGegen(k.planetenart, o.art);", "  return null;", 'grundAmKoerper: nennt nie einen Grund'],
  [EM, "const artPasstAmKoerper = (planetenart, art) => artenFuerPlanet(planetenart).includes(art);", "const artPasstAmKoerper = () => true;", 'artPasstAmKoerper: alles passt'],
  [EM, "Object.prototype.hasOwnProperty.call(DATEN.planetenarten, planetenart) ? ", "planetenart in DATEN.planetenarten ? ", 'artenFuerPlanet: Prototyp-Namen (toString) gelten als Planetenart'],
  [EM, "if (!arten.includes(a)) f.push(", "if (false) f.push(", 'Pruefer: unbekannte Kartenart wird nicht erkannt'],
  [EM, "if (!bekannt.includes(name)) f.push(", "if (false) f.push(", 'Pruefer: unbekannte Planetenart wird nicht erkannt'],
  [EM, "for (const name of bekannt) if (!(name in d.planetenarten)) f.push(", "for (const name of bekannt) if (false) f.push(", 'Pruefer: fehlende Planetenart wird nicht erkannt'],
  [EM, "  out.punkt = DATEN.punkt.slice();\n", "", 'artenAmHex: Leerraum ohne Punkt-Arten'],
  [EM, "  if (!sc) return out;", "  if (!sc) return { koerper: [], punkt: DATEN.punkt.slice() };", 'artenAmHex: Hex ohne Szene bietet Punkt-Arten an'],
  [EM, "arten: artenFuerPlanet(p.art) }));", "arten: [] }));", 'artenAmHex: Koerper ohne Arten'],
  [ED, '"ozean": []', '"ozean": ["wildnis"]', 'Datei: Ozean laesst wildnis zu'],
  [ED, '"gasriese": []', '"gasriese": ["station"]', 'Datei: Gasriese laesst station zu'],
  [ED, '"fels": ["wildnis", "hoehle"]', '"fels": ["wildnis", "hoehle", "station"]', 'Datei: Fels laesst station am Koerper zu'],
  [ED, '"wueste": ["wildnis", "aussenposten"]', '"wueste": ["wildnis", "hoehle", "aussenposten"]', 'Datei: Wueste laesst hoehle zu'],
  [ED, '"eis": ["wildnis", "hoehle"]', '"eis": ["wildnis"]', 'Datei: Eis verliert hoehle'],
  [ED, '"punkt": ["schiff", "station"]', '"punkt": ["schiff"]', 'Datei: Raumpunkt ohne station'],
  [OD, '"beam_zuschlag": 200', '"beam_zuschlag": -200', 'Beam: Reichweite am Planeten kleiner als der Radius'],
];

{   // Selbstcheck: jeder Anker genau einmal
  const schlecht = [];
  for (const [datei, alt, , was] of MUTATIONEN) {
    const t = fs.readFileSync(path.join(TMP, datei), 'utf8').replace(/\r\n/g, '\n');
    const k = t.split(alt).length - 1;
    if (k !== 1) schlecht.push(`${was}: Anker ${k}x in ${datei}`);
  }
  if (schlecht.length) { console.log(`Anker-Check: ${schlecht.length} von ${MUTATIONEN.length} Mutationen nicht anwendbar:\n  ` + schlecht.join('\n  ')); loesche(); process.exit(2); }
  console.log(`Anker-Check: alle ${MUTATIONEN.length} Anker genau einmal gefunden.`);
  if (process.argv.includes('--trocken')) { loesche(); process.exit(0); }
}

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lauf = () => spawnSync(process.execPath, [TEST], { cwd: TMP, encoding: 'utf8', timeout: 300000, env: Object.assign({}, process.env, { NODE_PATH: path.join(ROOT, 'node_modules') }) });
let ueberlebt = 0, gelaufen = 0, erkannt = 0, abstuerze = 0;
const basis = lauf();
console.log(`Mutationsprobe test-planeten-eignung.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP}); Ausgangslage ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /✗/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); loesche(); process.exit(1); }
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
  const rot = ((r.stdout || '').split('\n')).filter((l) => /^✗/.test(l) && !/Absturz/.test(l));
  if (r.status !== 0 && rot.length) { erkannt++; console.log(`  rot    ${was} (${rot.length} Pruefung(en), z. B. ${rot[0].replace(/^✗\s*/, '').slice(0, 70)})`); }
  else if (r.status !== 0) { abstuerze++; console.log(`  ABSTURZ ${was} (Exit ${r.status}: ${((r.stderr || '') + (r.stdout || '')).split('\n').filter((l) => /Error|Absturz/.test(l)).slice(0, 1).join(' ').slice(0, 100)}) – nicht als erkannt gezaehlt`); }
  else { ueberlebt++; console.log(`  GRUEN  ${was}  <-- UEBERLEBT`); }
}
loesche();
console.log(`Ergebnis: ${erkannt} erkannt, ${ueberlebt} ueberlebt, ${abstuerze} Absturz (von ${gelaufen})`);
process.exit(ueberlebt || abstuerze ? 1 : 0);
