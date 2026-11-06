'use strict';
// GEL-03 B/C: Mutationsprobe zu tools/test-abbau-neu.js. Kopiert Server, Shared, Content und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel
// und verlangt, dass der Test mit einer echten Prüfung rot wird (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, keine Prüfzeile) zählt NICHT als erkannt.
//   node tools/mutation-abbau-neu.js [begriff …] [--trocken]      (npm run test:abbau-neu-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet.
// Einträge mit 5. Element true sind als gleichwertig begründet (keine Beobachtung möglich) und müssen überleben. 6. Element true = Generator-Regel: voller Lauf mit allen Seeds
// (sonst ABBAU_NEU_SCHNELL=1, 3 Seeds je Gruppe: der Generator-Abschnitt braucht voll ca. 40 s).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-abbau-neu-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
for (const rel of ['server', 'shared', 'content']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools', 'fixtures'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'tools', 'fixtures', 'weltstand-main.schema.json'), path.join(TMP, 'tools', 'fixtures', 'weltstand-main.schema.json'));
const TEST = 'tools/test-abbau-neu.js';
fs.copyFileSync(path.join(ROOT, TEST), path.join(TMP, TEST));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
for (const rel of ['public', 'node_modules']) { if (fs.existsSync(path.join(ROOT, rel))) { try { fs.symlinkSync(path.join(ROOT, rel), path.join(TMP, rel), 'junction'); } catch (e) { /* kein Modul nötig */ } } }

const AN = 'server/sim/anker.js', LP = 'server/sim/landepunkte.js', GH = 'shared/gen-hoehle.js', VO = 'server/sim/vorrat.js', SQ = 'server/sim/squad.js', BH = 'shared/buehne.js', SC = 'content/schema/weltstand.schema.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, gleichwertig?, Generator-Regel (voller Lauf)?]
const MUTATIONEN = [
  // ---- Menge und Buchung (Paket B)
  [AN, "  Vorrat.einlagern(game, m.art, m.menge, 'abbau');", "", 'Buchung: der Abbau lagert nichts ein'],
  [AN, "  Vorrat.einlagern(game, m.art, m.menge, 'abbau');", "  Vorrat.einlagern(game, m.art, m.menge, 'fund');", 'Buchung: falscher Grund (fund statt abbau)'],
  [AN, "  return { menge: 1 + ((h >>> 8) % 3), art };", "  return { menge: 1, art };", 'Menge: immer 1'],
  [AN, "  return { menge: 1 + ((h >>> 8) % 3), art };", "  return { menge: 1 + ((h >>> 8) % 4), art };", 'Menge: bis 4'],
  [AN, "  const h = Buehne.fnv(`abbau:${abbauRunde(game, map)}:${a ? a.id : ''}`) >>> 0;", "  const h = Buehne.fnv(`abbau:0:${a ? a.id : ''}`) >>> 0;", 'Menge: ignoriert die Runde'],
  [AN, "  const h = Buehne.fnv(`abbau:${abbauRunde(game, map)}:${a ? a.id : ''}`) >>> 0;", "  const h = Buehne.fnv(`abbau:${abbauRunde(game, map)}:`) >>> 0;", 'Menge: ignoriert die Ader-ID'],
  [VO, "const SPAET = Object.freeze(['medipackCharges', 'erz']);", "const SPAET = Object.freeze(['medipackCharges']);", 'erz ist kein spätes Konto (Betrag der ersten Buchung NaN)'],
  [VO, "'belohnung', 'abbau',", "'belohnung',", 'Grund abbau fehlt im Buchungsdienst'],
  [VO, "'tafel', 'ladung', 'erz']);", "'tafel', 'ladung']);", 'Gut erz fehlt im Buchungsdienst'],
  // ---- Runde erhöht, Auswahl, Ereignis
  [AN, "  const runde = Math.min(LP.ABBAU_RUNDE_MAX, ((e.abbau_runde | 0) || 0) + 1);", "  const runde = Math.min(LP.ABBAU_RUNDE_MAX, ((e.abbau_runde | 0) || 0) + 0);", 'abbauNeu erhöht die Runde nicht'],
  [AN, "  e.abbau_runde = runde;\n", "", 'abbauNeu schreibt die Runde nicht in den Eintrag'],
  [AN, "game.emit('abbauNeu', { map, runde, adern }); game.missionEvent('abbauNeu', { map, runde, adern });", "game.emit('abbauNeu', { map, runde, adern });", 'Missionsereignis abbauNeu fehlt'],
  [AN, "    if (game.away && game.away.map === map) for (const p of game.players || []) if (p.hold && p.hold.kind === 'anker:abbau' && neu[p.hold.anker] !== undefined) p.hold = null;\n", "", 'abbauNeu bricht laufende Halter nicht ab'],
  [AN, "    if (aw) setzen(game, map, a.id, neu[a.id], null, { merken: true });", "", 'abbauNeu setzt die Zustände der geladenen Karte nicht'],
  [AN, "    e.zustaende[a.id] = neu[a.id];\n", "", 'abbauNeu schreibt nur die geladene Karte, nicht den Eintrag'],
  [GH, "      da = rg.filter((x) => !vor.has(x.id)).concat(rg.filter((x) => vor.has(x.id))).slice(0, anzahl(r)).map((x) => x.id);", "      da = rg.slice(0, anzahl(r)).map((x) => x.id);", 'adernWahl: keine Bevorzugung frischer Adern'],
  [GH, "(n >= 5 ? 2 + (fnv(`${seed | 0}:${r}:anzahl`) % 2) : Math.min(2, n))", "(n >= 5 ? 4 : Math.min(2, n))", 'adernWahl: zu viele aktive Adern'],
  // ---- Karte unverändert (adernWahl nie in die Karte schreiben)
  [AN, "    e.zustaende[a.id] = neu[a.id];\n", "    e.zustaende[a.id] = neu[a.id]; k.zustaende[a.id] = neu[a.id];\n", 'abbauNeu schreibt die Auswahl in die Karte'],
  [GH, "patrouillen: [], coverSpots: [], decks: null, kanten: {}, zustaende: {}, gelaende: null,", "patrouillen: [], coverSpots: [], decks: null, kanten: {}, zustaende: { 'hoehle.abbau.1': 'leer' }, gelaende: null,", 'Generator schreibt Zustände in die Karte'],
  // ---- Persistenz
  [LP, "'neu', 'gesperrt', 'abbau_runde'];", "'neu', 'gesperrt'];", 'Weltstand: abbau_runde nicht in FELDER (Laden verliert die Runde)'],
  [LP, "if (aw.zustaende[id] == null) aw.zustaende[id] = w[id];", "aw.zustaende[id] = w[id];", 'Laden: die Auswahl überschreibt gespeicherte Zustände (abgebaut geht verloren)'],
  [LP, "abbauWahlZustaende(karte, (e && e.abbau_runde) | 0)", "abbauWahlZustaende(karte, 0)", 'Laden: nimmt immer Runde 0 statt der Runde des Eintrags'],
  [LP, "    e.abbau_runde = abbauRundeKlemmen(e.abbau_runde);   // Altstand ohne Feld: 0; Obergrenze ABBAU_RUNDE_MAX (K3)\n", "", 'Laden: Rundenfeld nicht geklemmt (K3: manipulierter Wert bleibt)'],
  [LP, " o.abbau_runde = abbauRundeKlemmen(o.abbau_runde);", "", 'Speichern: Rundenfeld nicht geklemmt (K3)'],
  [AN, "    if (aw && neu[a.id] === 'da' && zustandIn(aw, k, a.id) === 'leer' && figurAufKachel(game, aw, a.x, a.y)) {", "    if (false) {", "W1: abbauNeu stellt den Wechsel unter einer Figur nicht zurück (Einmauern)"],
  [AN, "  for (const d of aw.drones || []) if (d.alive !== false && Physics.boxHits(hier, d.x, d.y, DROHNEN_BOX.w, DROHNEN_BOX.h)) return true;\n", "", "W1: Drohnen zählen nicht als Figur auf der Kachel"],
  [AN, "  if (Kr) for (const K of aw.kreaturen) if (K.alive !== false) {", "  if (Kr) for (const K of []) if (K.alive !== false) {", "W1: Kreaturen zählen nicht als Figur auf der Kachel"],
  [AN, "    for (const p of game.players || []) if (p.zone === 'away' && Physics.boxHits(hier, p.x, p.y, hb.w, hb.h)) return true;\n", "", "W1: Spieler zählen nicht als Figur auf der Kachel"],
  [AN, "  abbauVormerkTick(game, aw, k);\n  // Feldzeichen", "  // Feldzeichen", "W1: update setzt vorgemerkte Adern nie (Ader bleibt dauerhaft leer)"],
  [AN, "    if (figurAufKachel(game, aw, a.x, a.y)) continue;\n    delete vm[id];", "    delete vm[id];", "W1: Vormerkung wird sofort gesetzt, auch unter einer Figur"],
  [AN, "vormerkung(aw)[a.id] = true; delete e.zustaende[a.id]; continue;", "vormerkung(aw)[a.id] = true; continue;", "W1: vorgemerkte Ader behält ihren alten Zustand im Eintrag"],
  [LP, "  if (vm) for (const id of Object.keys(vm)) delete z[id];\n", "", "W1: Speichern schreibt eine vorgemerkte Ader als leer (Laden verliert da)"],
  [SQ, "    if (blk && blk.has(y * k.w + x)) continue;\n", "", "W2: Ersatzplätze nehmen feste Anker-Kacheln"],
  [SQ, "(game.aways && game.aways[info.id]) || game.away", "game.away", "W2: Ersatzplätze lesen den Zustand von game.away statt der Zielkarte"],
  [AN, "  const k = karteVon(map);\n  const aw = awVon(game, map);\n  if (!k && !LP.hatAdern(game, map))", "  const k = karteVon(map) || LP.karte(game, map);\n  const aw = awVon(game, map);\n  if (!k && !LP.hatAdern(game, map))", "K2: abbauNeu baut die nicht geladene Karte"],
  [AN, "    for (const id of Object.keys(e.zustaende)) if (GenHoehle.istAderKandidat({ rolle: 'abbau', id })) delete e.zustaende[id];\n", "", "K2: nicht geladen: Zustände der Vorrunde bleiben im Eintrag"],
  [GH, "    runde = Math.min(ADERN_RUNDE_MAX, Math.max(0, runde | 0));", "    runde = Math.max(0, runde | 0);", "K3: adernWahl ohne Obergrenze der Kette"],
  [AN, "Math.min(LP.ABBAU_RUNDE_MAX, ((e.abbau_runde | 0) || 0) + 1);   // an der Obergrenze", "((e.abbau_runde | 0) || 0) + 1;   // an der Obergrenze", "K3: abbauNeu zählt über die Obergrenze"],
  [LP, "const abbauRundeKlemmen = (r) => Math.min(ABBAU_RUNDE_MAX, Math.max(0, r | 0));", "const abbauRundeKlemmen = (r) => Math.max(0, r | 0);", "K3: restore/toSave klemmen nicht"],
  [SC, "\"maximum\": 10000, ", "", "K3: Schema ohne maximum"],
  [AN, "    if (game.away && game.away.map === map) for (const p of game.players || []) if (p.hold", "    for (const p of game.players || []) if (p.hold", "K4: abbauNeu bricht Halter anderer Karten ab"],
  [BH, "    return !(a.rolle === 'abbau' && zustand === 'leer');", "    return true;", "K5: ankerBlockiertIn: leere Ader blockiert"],
  
  // ---- Generator (voller Lauf)
  [GH, "        if (frei) kand.push([x, y]);", "        kand.push([x, y]);", 'Generator: Engstellen-Regel (2x2-Block) entfällt', false, true],
  [GH, "if (!blockBoden(x, y) || belegtAnker.has(ix(x, y)) || dist([x, y], E) < 6) continue;", "if (!blockBoden(x, y) || belegtAnker.has(ix(x, y))) continue;", 'Generator: Abstand zum Eingang entfällt', false, true],
  [GH, "        if (objekte.some((q) => Math.max(Math.abs(q[0] - x), Math.abs(q[1] - y)) < 3)) continue;\n", "", 'Generator: Abstand zu Funden entfällt', false, true],
  [GH, "const ADERN_ZIEL = (flaeche) => (flaeche < 2400 ? 4 : flaeche < 5000 ? 5 : 6);", "const ADERN_ZIEL = (flaeche) => (flaeche < 2400 ? 4 : flaeche < 5000 ? 4 : 6);", 'Generator: Ziel mittel nur 4'],
  [GH, "abbau: 4 };   // abbau (GEL-03 C): Ader-Kandidaten", "abbau: 2 };   // abbau (GEL-03 C): Ader-Kandidaten", 'Pflichtsatz abbau zu niedrig'],
  [GH, "  const VERSION = 2;", "  const VERSION = 1;", 'Höhle-VERSION nicht angehoben'],
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
const lauf = (voll) => spawnSync(process.execPath, [TEST], { cwd: TMP, encoding: 'utf8', timeout: 300000, env: Object.assign({}, process.env, voll ? {} : { ABBAU_NEU_SCHNELL: '1' }) });
// erkannt = rot MIT einer echten FEHLER-Prüfzeile; ein Absturz ist kein Beleg
const pruefFehler = (r) => ((r && r.stdout) || '').split('\n').filter((l) => /^\s*FEHLER\b/.test(l) && !/^\s*FEHLER Ausnahme/.test(l));
let ueberlebt = 0, gelaufen = 0, abstuerze = 0;
console.log(`Mutationsprobe test-abbau-neu.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
const basis = lauf(true);
console.log(`  Ausgangslage: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
if (basis.status !== 0) { console.log(pruefFehler(basis).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
for (const [datei, alt, neu, was, gleichwertig, voll] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  const r = lauf(voll);
  fs.writeFileSync(f, orig);
  const fe = r.status === 0 ? [] : pruefFehler(r);
  const absturz = r.status !== 0 && !fe.length;
  if (gleichwertig) {   // als gleichwertig eingestuft (keine Beobachtung möglich): muss überleben
    if (fe.length) ueberlebt++;
    console.log(`  ${fe.length ? 'ROT  ' : 'gleich'} ${was} (gleichwertig: ${fe.length ? 'wurde doch erkannt, Einstufung prüfen' : 'überlebt erwartungsgemäß'})`);
    continue;
  }
  if (!fe.length) { ueberlebt++; if (absturz) abstuerze++; }
  console.log(`  ${fe.length ? 'rot  ' : 'GRÜN '} ${was}${fe.length ? ` (${fe.length} Fehler, z. B. ${fe[0].replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : (absturz ? '  <-- NUR ABSTURZ, nicht erkannt' : '  <-- ÜBERLEBT')}`);
}
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) nicht erkannt (davon ${abstuerze} nur Absturz)` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
