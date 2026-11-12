'use strict';
// FRE-03 D: Mutationsprobe zu tools/test-reise-notruf-brett.js. Kopiert Server, Shared, Content und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel
// (Eintrag mit fünftem Element true: alle Fundstellen) und verlangt, dass der Test rot wird (Exit != 0). Überlebt eine Mutation, deckt kein Test die Regel ab.
//   node tools/mutation-reise-notruf-brett.js [begriff …]      (npm run test:reise-notruf-brett-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-notruf-brett-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TEST = 'tools/test-reise-notruf-brett.js';
fs.copyFileSync(path.join(ROOT, TEST), path.join(TMP, TEST));
fs.copyFileSync(path.join(ROOT, 'tools', 'regie-fixture.js'), path.join(TMP, 'tools', 'regie-fixture.js'));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const RE = 'server/sim/reise-ereignis.js', BR = 'server/sim/abenteuer-brett.js', FA = 'server/sim/faden.js', PR = 'server/sim/faden-pruefer.js', DA = 'content/faeden/notruf-brett.json';
// [Datei, alter Text (genau einmal, mit fünftem Element true: mindestens einmal, alle werden ersetzt), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- Entstehen und Lebensdauer
  [RE, "notrufAnbieten(game, { nr: ev.nr,", "notrufAnbieten(null, { nr: ev.nr,", 'Entstehen: kein Brett-Angebot'],
  [RE, "  try { require('./abenteuer-brett.js').zurueckziehenFuerNotruf(game, o.marke); }", "  try { /* nichts */ }", 'Lebensdauer: der Eintrag zieht sein Angebot nie zurück (Verfall, Ablehnen, Beantworten)'],
  [RE, "  R.offen.splice(R.offen.indexOf(o), 1);\n  brettZurueckziehen(game, o);\n  funk(game, textFuer(o.ev, 'eintreffen', game));", "  R.offen.splice(R.offen.indexOf(o), 1);\n  funk(game, textFuer(o.ev, 'eintreffen', game));", 'Beantworten: das Angebot bleibt am Brett'],
  [RE, "  R.offen.splice(R.offen.indexOf(o), 1);\n  brettZurueckziehen(game, o);\n  Chronik.eintragen(game, { art: 'reise', ref: o.id, kurz: `Notruf bei ${hexName(o.hex)} ${text}`", "  R.offen.splice(R.offen.indexOf(o), 1);\n  Chronik.eintragen(game, { art: 'reise', ref: o.id, kurz: `Notruf bei ${hexName(o.hex)} ${text}`", 'Verfall und Ablehnen des Eintrags: das Angebot bleibt am Brett'],
  [BR, "  entfernen(F, a);\n  return true;\n}", "  return true;\n}", 'zurueckziehenFuerNotruf entfernt nichts'],
  [RE, "  if (ev && ev.takt === true) return;\n", "", 'alter Hook: auch Takt-Notrufe legen ein zweites Angebot in F.angebote an'],
  // ---- Altern und Obergrenzen
  [FA, "for (const a of F.abenteuerAngebote) if (!a.notruf) a.alter++;", "for (const a of F.abenteuerAngebote) a.alter++;", 'Notruf-Angebote altern in Tätigkeiten'],
  [FA, "a.notruf || a.alter <= W.abenteuer.angebot_gilt_taetigkeiten", "a.alter <= W.abenteuer.angebot_gilt_taetigkeiten", 'Notruf-Angebote verfallen nach angebot_gilt_taetigkeiten'],
  [BR, "if (da.length >= NB.notruf_angebote_max || da.some((a) => a.notruf.marke === o.marke)) return null;", "if (da.some((a) => a.notruf.marke === o.marke)) return null;", 'notruf_angebote_max wird nicht eingehalten'],
  [BR, "if (da.length >= NB.notruf_angebote_max || da.some((a) => a.notruf.marke === o.marke)) return null;", "if (da.length >= NB.notruf_angebote_max) return null;", 'dieselbe Marke bekommt ein zweites Angebot'],
  [PR, "if (regulaereAngebote(F).length >= W.abenteuer.angebote_max) return fehl('ABENTEUER_ANGEBOTE'", "if ((F.abenteuerAngebote || []).length >= W.abenteuer.angebote_max) return fehl('ABENTEUER_ANGEBOTE'", 'Notruf-Angebote zählen gegen angebote_max (verdrängen Andock-Angebote)'],
  [FA, "const g = (pruefeAnbieten || P.pruefeAbenteuerAnbieten)(F, o);", "const g = P.pruefeAbenteuerAnbieten(F, o);", 'Notruf-Angebot prüft gegen angebote_max (bei vollem Brett kein Notruf-Angebot)'],
  [BR, "const k = a.notruf ? 'notruf' : 'regulaer';", "const k = 'regulaer';", 'Snapshot zählt Notruf- und Andock-Angebote zusammen (3 statt 3 + 3)'],
  [BR, "if (P.regulaereAngebote(F).length || P.abenteuerLaufend(F)) return null;   // FRE-03 D", "if (F.abenteuerAngebote.length || P.abenteuerLaufend(F)) return null;   // FRE-03 D", 'Anschluss-Garantie: ein Notruf-Angebot zählt als Angebot'],
  [BR, "while (P.regulaereAngebote(F).length < W.abenteuer.angebote_max) {", "while (F.abenteuerAngebote.length < W.abenteuer.angebote_max) {", 'Rückfall füllt das Brett: Notruf-Angebote zählen mit (weniger Andock-Angebote)'],
  // ---- Felder und Verhalten des Angebots
  [BR, "angebotAusstatten(a, { herkunft: o.ankunft,", "angebotAusstatten(a, { herkunft: o.hex,", 'herkunft ist der Notruf-Hex statt der Crew-Hex'],
  [BR, "bezug: { sprecher }, erstellt });", "bezug: { sprecher: '' }, erstellt });", 'bezug.sprecher fehlt'],
  [BR, "  a.variante = typeof o.variante === 'string' ? o.variante : '';\n", "  a.variante = '';\n", 'variante fehlt am Angebot'],
  [BR, "    if (a.notruf) e.notruf = 1;", "", 'Snapshot: kein Feld notruf'],
  [BR, "  if (a.notruf) notrufBeatStarten(game, r.faden);", "", 'Annehmen startet den Beat notruf nicht'],
  [BR, "    faden.zaehler = Math.max(faden.zaehler, faden.abstand);\n", "", 'Annehmen: der Abstand des Fadens wird nicht übersprungen'],
  // ---- Angebot ablehnen / Vorrat (FRE-03 E: Einlegen und Entnehmen der Art notruf, gefuellter Vorrat am Brett: tools/mutation-vorrat-je-art.js)
  [BR, "  if (!a.notruf) gemerkt(b.abgelehnt, a.ref, 3);", "  gemerkt(b.abgelehnt, a.ref, 3);", 'Angebot ablehnen: Rückfall-Sperre für den Notruf-Plan'],
  // ---- Daten
  [DA, '"belagerung": "notruf"', '"belagerung": "kaperung"', 'Daten: eine Variante hat eine unbekannte Absicht'],
  [DA, '"kon",\n      "ger"', '"kon"', 'Daten: ger fehlt in volk_erlaubt (römischer NSC im Germanengebiet)'],
  [DA, '"wert": 3,\n      "einheit": "Angebote"', '"wert": 4,\n      "einheit": "Angebote"', 'Daten: notruf_angebote_max 4'],
];

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lauf = () => spawnSync(process.execPath, [TEST], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
let ueberlebt = 0, gelaufen = 0;
console.log(`Mutationsprobe test-reise-notruf-brett.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
