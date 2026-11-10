'use strict';
// DYN-01 A: Mutationsprobe zu tools/test-abenteuer-orte.js. Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), entfernt dort je Lauf EINE Aufraeum-Pflicht
// (Zeile weg) und verlangt, dass der Test rot wird (Exit != 0 UND eine ✗-Zeile; ein Absturz zaehlt nicht als erkannt). Ueberlebt eine Mutation, deckt der Test die Pflicht nicht ab.
// Selbstcheck: VOR jedem Lauf muss jeder Anker genau einmal in der Kopie stehen, sonst Exit 2 (statt eine Mutation still zu ueberspringen).
//   node tools/mutation-abenteuer-orte.js [begriff ...] [--trocken]      (npm run test:abenteuer-orte-mutation)
// Keine node_modules-Junction (nie loeschen, was woanders liegt): NODE_PATH zeigt auf die des Repos.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-orte-'));
const loesche = () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } };
for (const d of ['server', 'shared', 'content']) fs.cpSync(path.join(ROOT, d), path.join(TMP, d), { recursive: true });
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });   // der Server liest karte-tokens.js
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
for (const t of ['test-abenteuer-orte.js', 'regie-fixture.js']) fs.copyFileSync(path.join(ROOT, 'tools', t), path.join(TMP, 'tools', t));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
const TEST = 'tools/test-abenteuer-orte.js';

const AO = 'server/sim/abenteuer-orte.js', GM = 'server/game.js', FA = 'server/sim/faden.js', WS = 'server/weltstand.js', LS = 'server/sim/lpscan.js';
// [Datei, Anker (genau einmal), Ersatz, Beschreibung]
const MUTATIONEN = [
  [AO, "  if (game.away && game.away.map === id) andereKarte(game, id);", "", 'away: game.away.map wird nicht umgesetzt (verwerfen scheitert: belegt)'],
  [AO, "  if (game.transferZiel && game.transferZiel.lp === id) game.transferZiel = null;", "", 'transferZiel bleibt auf dem Ort'],
  [AO, "try { Lpscan().vergessen(game, id); }", "try { void 0; }", 'lpScan: Scan-Markierung bleibt (steht im Weltstand)'],
  [AO, "  LP().halteLoesen(game, id);", "", 'halten/ausstehend werden nicht geloest'],
  [AO, "frei: 'immer', fluechtig: true }, biom ?", "frei: 'immer' }, biom ?", 'Weltstand: der Ort ist nicht fluechtig (steht in welt.landepunkte)'],
  [AO, "  if (unten(game, id)) return false;   // Mehrspieler", "  if (false) return false;   // Mehrspieler", 'Mehrspieler: Abraeumen auch mit Crew unten'],
  [GM, "if (this.weltsim) this.safe('abenteuer-orte', () => AbenteuerOrte.update(this));", "", 'Retry: kein Takt-Aufruf im Tick'],
  [AO, "    if (!m || bestellungVon(faden(m), id)) continue;", "    if (!m || true) continue;", 'Retry/Waise: der Abgleich raeumt keinen Ort ab'],
  [FA, "try { require('./abenteuer-orte.js').abraeumen(game, f.id); }", "try { void 0; }", 'Haken: Abschluss des Fadens raeumt nicht ab'],
  [AO, "  LP().vorbauen(game, [id]);", "", 'vorbauen: nicht sofort nach dem Anlegen'],
  [WS, "try { require('./sim/abenteuer-orte.js').abgleichen(game); }", "try { void 0; }", 'Weltstand: nach dem Laden kein Abgleich'],
  [AO, "  if (f) delete f.orte;", "", 'Weltstand: Bestellung bleibt am beendeten Faden'],
  [FA, "if (o.length) f.orte = o; }", "if (o.length) void 0; }", 'Weltstand: der Faden liest seine Bestellung nicht'],
  [AO, "  if (game.mapResets) delete game.mapResets[id];", "", 'mapResets bleibt stehen'],
  [LS, "for (const p of game.players || []) if (p.planSent) delete p.planSent[lpId];", "", 'planSent bleibt stehen'],
  [AO, "if (typeof p.awayKv === 'string' && p.awayKv.startsWith(id + '@')) p.awayKv = null;", "", 'awayKv bleibt stehen'],
  [AO, "    if (p.awayEnth) delete p.awayEnth[id];", "", 'awayEnth bleibt stehen'],
  [AO, " || !Sektoren.hexVonOrt(ort)) return null;", ") return null;", 'Bestellen: Ort ohne Hex der Karte wird nicht abgelehnt'],
  [AO, "  if ((f.orte || []).length >= D.orte_max) return null;", "", 'Bestellen: keine Obergrenze'],
  [AO, "  d.gesperrt = true;   // nicht mehr", "  void 0;   // nicht mehr", 'wartender Ort bleibt anwaehlbar'],
  [AO, "if (m && !(S && S.dyn[id]) && !bestellungVon(faden(m), id)) spurenLoesen(game, id);", "", 'Scan-Rest ohne Ort wird nicht abgeraeumt (Laden)'],
  [AO, "try { anlegen(game, f, b); out.neu++; }", "try { out.neu++; }", 'Laden: der Ort kommt nicht aus dem Faden zurueck'],
  [AO, "!D.arten.includes(e.art) || typeof e.besitz", "typeof e.besitz", 'Leser: Kartenart aus dem Stand ungeprueft'],
  [AO, "  if (alt) return alt.kachel || idVon(alt.ort, f.id, alt.platz);", "", 'Bestellen: gleicher Platz nicht idempotent'],
  ["content/schema/weltstand.schema.json", "\"orte\":{\"type\":\"array\",\"maxItems\":8,", "\"orte\":{\"type\":\"array\",\"maxItems\":1,", 'Schema: orte hat eine Obergrenze unter orte_max'],
  ["content/welt/abenteuer-orte.json", "\"orte_max\": 2,", "\"orte_max\": 9,", 'Daten: orte_max ueber der Formgrenze des Schemas (Stand wuerde schema-ungueltig)'],
  ["content/welt/abenteuer-orte.json", "\"besitz_standard\": \"herrenlos\",", "\"besitz_standard\": \"rom\",", 'Daten: anderer Standardbesitz (der Code liest ihn aus den Daten)'],
  [GM, "return hatte ? { lp: [], ziel: null } : null;", "return null;", 'Snapshot: kein Leerzustand von transfer nach dem Ende (Client behaelt den alten Ort)'],
  [GM, "return hatte ? { lp: [], ziel: null } : null;", "return { lp: [], ziel: null };", 'Snapshot: Leerform in jedem Snapshot ohne Landepunkte (Budget)'],
  [AO, ", biom ? { gen: { biom } } : {}));", ", {}));", 'Biom: die Wildnis bekommt kein Biom aus der Planetenart (Lava auf dem Wuestenplaneten)'],
  [AO, "return p ? Eignung.biomFuerPlanet(p.art) : null;", "return p ? 'wueste' : null;", 'Biom: jede Wildnis wird Wueste (Fels und Eis nicht mehr auto)'],
  ["server/sim/planeten-eignung.js", "return typeof b === 'string' && GenGelaende.BIOME.includes(b) ? b : null;", "return typeof b === 'string' ? b : null;", 'Biom: ein unbekanntes Biom aus den Daten wird nicht abgefangen'],
  [AO, "game.aways[D.karte_ruhe] ? D.karte_ruhe : Object.keys", "false ? D.karte_ruhe : Object.keys", 'Ausweichkarte: alphabetisch erste (kesh) statt Ruhekarte (Pad-Beschriftung)'],
  [AO, "  return art === undefined || art === d.art ? null :", "  return null; void 0 ||", 'Kachel-Hex: eine andere bestellte Kartenart wird nicht abgelehnt'],
  [AO, "const b = d && bestellung(Object.assign({}, o, { art: d.art }), s.ort, null);", "const b = d && { platz: o.platz === undefined ? '' : o.platz };", 'Kachel-Hex: Besitz, Name und Platz werden nicht geprueft'],
  [AO, "  const z = D.punkt.zustand_nach_art[b.art];\n  if (z) b.zustand = z;", "", 'Wrack im Raum: Zustand verfallen fehlt'],
  [AO, "    if (m && m.faden === fadenId && !ortAbraeumen(game, id)) alle = false;", "    if (m && m.faden === fadenId) ortAbraeumen(game, id);", 'abraeumen meldet immer true (auch wenn noch belegt)'],
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
console.log(`Mutationsprobe test-abenteuer-orte.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP}); Ausgangslage ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
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
