'use strict';
// SUND-04a-2 Nacharbeit Welle 3 (Abschluss, Ruf-Deckel, Haltung, Befreiung am Ort, Gedaechtnis, Vorlauf-Fall, Notruf-Hinweis, Bot mit echten Kampfausgaengen): Mutationsprobe zu tools/test-faden-nach3.js
// (und den angepassten tools/test-faden-bitte.js, test-faden-vorlagen.js). Kopiert Server, Shared, Content, public und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberuehrt), aendert dort je Lauf
// EINE Regel und verlangt, dass mindestens einer der Tests rot wird (Exit 1 MIT FEHLER-Zeile). ABSTUERZE (Exit != 0 ohne FEHLER-Zeile, Syntaxfehler, Ausnahme beim Laden) zaehlen NICHT als erkannt.
// Der Selbstcheck vorab verlangt, dass jeder Anker genau einmal im Quelltext steht (Exit 2, wenn nicht). --trocken prueft nur die Anker.
//   node tools/mutation-faden-nach3.js [--trocken] [begriff ...]      (npm run test:faden-nach3-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-nach3-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'public'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-faden-nach3.js'], ['tools/test-faden-bitte.js'], ['tools/test-faden-vorlagen.js']];   // die schnellen zuerst (die erste rote Pruefung genuegt)
for (const f of [...TESTS.map((t) => t[0]), 'tools/test-faden-vorlagen.js', 'tools/regie-fixture.js', 'tools/faden-fixture.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const FD = 'server/sim/faden.js', BI = 'server/sim/faden-bitte.js', SZ = 'server/sim/faden-szene.js', P3 = 'server/sim/faden-p3.js', PR = 'server/sim/faden-pruefer.js', FR = 'server/sim/faden-fracht.js';
const HV = 'content/faeden/haltung-werte.json', BT = 'content/faeden/beats.json', SW = 'content/faeden/szenen-werte.json', VC = 'content/faeden/vorlagen/dankbarer_captain.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- 1. Abschluss: Belohnung nur bei Erfolg
  [P3, "    return { ausgang: gelungen ? 'gelungen' : 'gescheitert' };", "    return { ausgang: 'gelungen' };", 'Abschluss: gelingt immer (auch ohne Leistung der Crew)'],
  [PR, "return Array.isArray(e) && ((nsc && nsc.gedaechtnis) || []).some((g) => e.includes(g.ereignis)); };", 'return true; };', 'Abschluss: abschlussGelungen ist immer wahr'],
  [P3, "const key = nsc.status === 'tot' ? 'abschluss_tot' : !gelungen ? 'abschluss_gescheitert' :", "const key = nsc.status === 'tot' ? 'abschluss_tot' : false ? 'abschluss_gescheitert' :", 'Abschluss: ohne Leistung trotzdem der Dankestext'],
  [PR, "fehler.push(fehl('ERFOLG_FEHLT'", "void (fehl('ERFOLG_FEHLT'", 'Pruefer: Abschluss ohne erfolg wird nicht abgelehnt'],
  [PR, '      else for (const x of e) if (!moegliche.has(x)) fehler.push(', '      else for (const x of e) if (false) fehler.push(', 'Pruefer: erfolg mit unbekanntem Ereignis erlaubt'],
  [PR, '    } else if (b.erfolg !== undefined) fehler.push(', '    } else if (false) fehler.push(', 'Pruefer: erfolg an einem Beat ohne Abschluss erlaubt'],
  [VC, '"raumschlacht_gelungen"', '"bitte_gelungen"', 'Daten: der Captain gilt schon nach der Zusage als gelungen (nicht erst nach der Mission)'],
  // ---- 2. Ruf-Deckel begrenzt nur den Ruf
  [FD, '  folgenAnwenden(game, f, opt.folge, true);   // Welle 3:', '  folgenAnwenden(game, f, opt.folge, false);   // Welle 3:', 'Deckel: die Folge einer Option geht am Deckel vorbei'],
  [BI, '  const erlaubt = opts;   // Welle 3:', '  const erlaubt = opts.filter((x) => rufBetrag(x.folge) <= 1e-9 || rufBetrag(x.folge) <= deckelRaum(F) + 1e-9);   // Welle 3:', 'Deckel: die Annahme (Ruf-Folge) entfaellt aus dem Angebot, wenn der Deckel voll ist'],
  [FD, '      if (b <= BF.deckelRaum(F) + 1e-9) { F.bitteLog.push([F.t, b]); rufAn.push(w); } else logbuch(', '      if (true) { F.bitteLog.push([F.t, b]); rufAn.push(w); } else logbuch(', 'Deckel: der Ruf wird nie begrenzt'],
  [FD, '      if (b <= BF.deckelRaum(F) + 1e-9) { F.bitteLog.push([F.t, b]); rufAn.push(w); }', '      if (b <= BF.deckelRaum(F) + 1e-9) { rufAn.push(w); }', 'Deckel: gebuchter Ruf zaehlt nicht im Deckel'],
  // ---- 3. Haltung erreichbar
  [VC, '"grund": "hingehalten"', '"grund": "bitte_abgelehnt"', 'Daten: Spaeter kostet nur 1 statt 2 Haltung (Weg zu kalt und feindlich nicht mehr erreichbar)'],
  [BI, '    if (opt.folge.length) Faden().folgenAnwenden(game, f, opt.folge, true);', '', 'Spaeter: das Hinhalten kostet keine Haltung'],
  [PR, "    if (b.variante && !w.start[i].some((x) => x.s !== 'tot' && x.h < H.feindlich_unter)) out.push(", "    if (false && !w.start[i].some((x) => x.s !== 'tot' && x.h < H.feindlich_unter)) out.push(", 'Pruefer: unerreichbare Variante wird nicht gemeldet'],
  [PR, '        if (!Array.from(w.angebote[i]).some((h) => tonFuer(h) === t.id)) out.push(', '        if (false) out.push(', 'Pruefer: unerreichbarer Ton wird nicht gemeldet'],
  [PR, '  const MAXK = Math.max(0, W.beat_frist - 1);', '  const MAXK = 0;', 'Pruefer: das Zurueckstellen zaehlt nicht als Weg zur Haltung'],
  [BI, "if (ton !== 'sachlich' && Object.prototype.hasOwnProperty.call(BW.texte, key + '_' + ton)) schluessel = key + '_' + ton;", '', 'Bitte: der Ton folgt nicht der Haltung'],
  [PR, "  if (!beat.variante || status === 'tot' || !(haltung < H.feindlich_unter)) return", '  if (true) return', 'Variante: der NSC kehrt nie feindlich wieder'],
  [HV, '{"id": "herzlich", "ab": 2}', '{"id": "herzlich", "ab": 4}', 'Daten: herzlich erst ab 4 (nie erreicht)'],
  [BI, "x.folge.some((fo) => !fo || fo.typ !== 'haltung_aenderung') && x.ausgang === undefined", 'x.folge.length && x.ausgang === undefined', 'Bitte: Option ohne Ausgang darf keine Haltung kosten (Spaeter folgenlos erzwungen)'],
  // ---- 4. Befreiung am Ort
  [SZ, "    if (Sektoren.hexVonOrt(game.ship.scene) === ort) return beatStarten(game, 'befreiung', faden, ctx);", "    if (true) return beatStarten(game, 'befreiung', faden, ctx);", 'Befreiung: beginnt ueberall'],
  [SZ, '    if (f.parameter.ort !== hier) continue;', '', 'Befreiung: die wartende Szene beginnt an jedem Ort'],
  [P3, "  try { require('./faden-szene.js').befreiungAnkunft(game, hier); } catch (e) { fehlerZaehlen(game, 'faden-befreiung', e); }", '', 'Befreiung: die Ankunft am Ort startet die Szene nie'],
  [SZ, "    if (!ort || !HEX.test(ort)) return { ausgang: 'gescheitert' };", '', 'Befreiung: ein Faden ohne Ort wartet weiter'],
  [SW, '    "befreiung_ort": "{name} sitzt bei {ort} fest. Fliegt hin und vertreibt die Wachen.",\n', '', 'Befreiung: kein Funk zur Anreise'],
  // ---- 5. Gedaechtnis
  [FD, "  const ereignis = ausgang === 'gescheitert' && cat.ereignis_ohne_ware && !f.fracht ? cat.ereignis_ohne_ware : beat.typ + '_' + ausgang;", "  const ereignis = beat.typ + '_' + ausgang;", 'Gedaechtnis: fracht_gescheitert auch ohne Ware'],
  [BT, '      "ereignis_ohne_ware": "fracht_ohne_ware",\n', '', 'Katalog: kein Ereignis fuer „ohne Ware“'],
  [P3, "some((g) => g.ereignis === 'fracht_gelungen' || g.ereignis === 'fracht_gescheitert');", 'some((g) => /^fracht_/.test(g.ereignis));', 'Enthuellung: auch fracht_ohne_ware gilt als Fracht'],
  // ---- 6. Vorlauf-Fall
  [BI, '      for (const h of (beat && beat.hinweise) || []) Hinweis().senden(game, faden.id, h);', '', 'Bitte: die Hinweise kommen nur mit dem Angebot (Vorlauf-Fall)'],
  // ---- 7. Hinweis des Notrufs
  [P3, '    for (const h of ctx.beat.hinweise || []) Hinweis().senden(game, faden.id, h);', '', 'Notruf: der Hinweis wird nicht gesendet'],
  [P3, '    for (const h of ctx.beat.hinweise || []) Hinweis().senden(game, faden.id, h);', '    for (const h of ctx.beat.hinweise || []) Faden().hinweisGezeigt(game, faden.id, h);', 'Notruf: der Hinweis gilt formal, ohne gesendet zu sein'],
  // ---- 8. Echte Kampfausgaenge
  [SZ, "  if (!game.space.enemies.some((e) => e.tag === fs.tag)) return enden(game, fs, 'gelungen', null);", "  if (!game.space.enemies.some((e) => e.tag === fs.tag)) return enden(game, fs, 'gescheitert', null);", 'Kampf: die vernichteten Gegner gelten als Niederlage'],
  [SZ, '  for (let i = 0; i < n; i++) {\n    const a = (i / n) * Math.PI * 2 + W.ring_winkel_start;', '  for (let i = 0; i < 0; i++) {\n    const a = (i / n) * Math.PI * 2 + W.ring_winkel_start;', 'Kampf: es spawnen keine Gegner'],
  [SZ, "    if (a === 'gestellt' || a === 'zerstoert') return enden(game, fs, 'gelungen', null);", "    if (false) return enden(game, fs, 'gelungen', null);", 'Verfolgung: das zerstoerte Ziel gilt nie als Erfolg'],
  [FR, "    F().beatAusgang(game, f.id, 'gelungen');\n  }\n  return out;", "    F().beatAusgang(game, f.id, 'gescheitert');\n  }\n  return out;", 'Fracht: die Ablieferung gilt als gescheitert'],
  [P3, "    Faden().beatAusgang(game, f.id, 'gelungen');\n  }\n}", "    Faden().beatAusgang(game, f.id, 'gescheitert');\n  }\n}", 'Notruf: die Ankunft gilt als gescheitert'],
];

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
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

const lauf = ([test, ...arg]) => spawnSync(process.execPath, [test, ...arg], { cwd: TMP, encoding: 'utf8', timeout: 900000 });
let ueberlebt = 0, gelaufen = 0, erkannt = 0, abstuerze = 0;
console.log(`Mutationsprobe Nacharbeit Welle 3 (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of TESTS) {
  const basis = lauf(t);
  console.log(`  Ausgangslage ${t.join(' ')}: ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
}
for (const [datei, alt, neu, was] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  if (text.split(alt).length !== 2) { console.log(`  ?? ${was}: Textstelle nicht eindeutig gefunden (${datei})`); ueberlebt++; continue; }
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  let wer = null, fehler = [], absturz = null;
  for (const t of TESTS) {
    const r = lauf(t);
    if (r.status === 0) continue;
    const fz = ((r.stdout || '').split('\n')).filter((l) => /FEHLER/.test(l) && !/FEHLER Ausnahme/.test(l));
    if (fz.length) { wer = path.basename(t[0], '.js').replace('test-', ''); fehler = fz; break; }
    if (!absturz) absturz = { test: path.basename(t[0], '.js'), text: ((r.stderr || '') + (r.stdout || '')).split('\n').filter((l) => /Error|    at |Ausnahme/.test(l)).slice(0, 1).join(' ').trim().slice(0, 120) || `Exit ${r.status}` };
  }
  fs.writeFileSync(f, orig);
  if (wer) { erkannt++; console.log(`  rot    ${was} (${wer}: ${fehler.length} Fehler, z. B. ${fehler[0].replace(/^\s*FEHLER\s*/, '').slice(0, 64)})`); }
  else if (absturz) { abstuerze++; console.log(`  ABSTURZ ${was} (${absturz.test}: ${absturz.text}) – nicht als erkannt gezaehlt`); }
  else { ueberlebt++; console.log(`  GRUEN  ${was}  <-- UEBERLEBT`); }
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`Ergebnis: ${erkannt} erkannt, ${ueberlebt} ueberlebt, ${abstuerze} Absturz/Syntaxfehler (von ${gelaufen})`);
process.exit(ueberlebt || abstuerze ? 1 : 0);
