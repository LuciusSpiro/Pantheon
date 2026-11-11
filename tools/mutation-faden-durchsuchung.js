'use strict';
// BEA-01 B: Mutationsprobe zu tools/test-faden-durchsuchung.js (Durchsuchung, BEA-01 B). Kopiert Server, Shared, Content, public und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberuehrt),
// aendert dort je Lauf EINE Regel und verlangt, dass der Test rot wird (Exit 1 MIT FEHLER-Zeile). ABSTUERZE (Exit != 0 ohne FEHLER-Zeile) zaehlen NICHT als erkannt.
// Der Selbstcheck vorab verlangt, dass jeder Anker genau einmal im Quelltext steht (Exit 2, wenn nicht). --trocken prueft nur die Anker.
//   node tools/mutation-faden-durchsuchung.js [--trocken] [begriff ...]      (npm run test:faden-durchsuchung-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-durchsuchung-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'public'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-faden-durchsuchung.js']];
for (const f of ['tools/test-faden-durchsuchung.js', 'tools/test-faden-vorlagen.js', 'tools/regie-fixture.js', 'tools/faden-fixture.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const FR = 'server/sim/faden-fracht.js', FF = 'server/sim/faden-forderung.js', BI = 'server/sim/faden-bitte.js', BT = 'content/faeden/beats.json', LA = 'server/sim/fracht.js', PR = 'server/sim/faden-pruefer.js', FD = 'server/sim/faden.js', GE = 'server/sim/geld.js', SZ = 'server/sim/faden-szene.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  [FD, "      try { require('./faden-bitte.js').beatFristAbgelaufen(game, f); } catch (e) { fehlerZaehlen(game, 'faden-bitte', e); }", '', 'Frist des Beats vor dem Verfall der Bitte: kein Verfall-Pfad (Durchsuchung faellt aus)'],
  [GE, 'Math.min(vorher, Math.max(0, vorher - n))', 'Math.max(0, vorher - n)', 'Abzug bei negativem Stand schreibt gut'],
  [FR, "    if (ev) F().erinnern(game, f, ev, 'ware_verloren');\n    wareAbgeben(game, f);\n  }   // BEA-01 A:", "    wareAbgeben(game, f);\n  }   // BEA-01 A:", 'Notsprung im Beat mit Ware: kein Gedaechtnis fuer die verlorene Ladung'],
  [FF, 'const funde = weg.n + weg.bleibt;', 'const funde = weg.n;', 'aufgedeckte Auftragsware zaehlt nicht als Fund (Meldung sauber, keine Strafe)'],
  [SZ, 'tag: fs.tag, volk: fs.volk || C.volk })', 'tag: fs.tag, volk: C.volk })', 'Volk des Beats wird ignoriert (Gegner immer nach szenen-werte.json)'],
  [LA, "    if (tiefe === 'scan' && e.getarnt) continue;", '    if (false) continue;', 'Durchsuchung findet getarnte Ware schon bei Tiefe scan'],
  [LA, 'const anzeigeArt = (l) => (l.eig && l.eig.getarnt && !l.eig.aufgedeckt ? l.eig.getarnt : l.art);', 'const anzeigeArt = (l) => l.art;', 'Bezeichnung verraet die echte Art (Anzeige nennt immer die echte Art)'],
  [FF, 'fmt(T.fund, { n: weg.n })', "fmt(T.fund, { n: weg.n + ' ' + weg.arten.join() })", 'Funk nach dem Fund nennt die echte Art'],
  [LA, '    s.lager.splice(i, 1);\n    plaetze.unshift({ art: l.art','    plaetze.unshift({ art: l.art', 'Beschlagnahme laesst die Ware im Lager'],
  [LA, '    if (e.auftrag) { bleibt++; continue; }', '    if (e.auftrag) { bleibt++; }', 'Auftragsware des Fadens wird mitgenommen'],
  [FF, "  if (grund) Faden().folgenAnwenden(game, f, [{ typ: 'ruf_aenderung', grund }], false);", '  // keine Ruf-Folge', 'Fund ohne Ruf-Folge'],
  [FF, "const bussgeld = soll > 0 ? Geld.bussgeldZahlen(game, soll) : 0;", 'const bussgeld = 0;', 'Fund ohne Bussgeld'],
  [FF, "const fund = w.durchsuchen === true ? durchsuchen(game, f, beat, fo) : null;", "const fund = (w.durchsuchen === true || opt.id === 'bestechen') ? durchsuchen(game, f, beat, fo) : null;", 'Bestechen durchsucht trotzdem'],
  [BT, '"ware_bei_scheitern": "bleibt", "optionen_wirkung": {"dulden"', '"optionen_wirkung": {"dulden"', 'Dulden nimmt die Auftragsware des Fadens (ware_bei_scheitern der Art fehlt)'],
  [FF, 'Lager().frachtDurchsuchen(game, { wer, tiefe: tiefe || undefined });', 'Lager().frachtDurchsuchen(game, { wer });', 'Tiefe aus dem Parameter wird ignoriert (immer voll)'],
  [BI, "if (bsV && typeof bsV.verfall === 'function')", 'if (false)', 'Schweigen auf den Zoll ist eine Ausrede (keine Durchsuchung bei Verfall)'],
  [FR, "const lad = q.ladung && typeof q.ladung.art === 'string' ? q.ladung : { art: 'fracht', eigenschaften: {} };", "const lad = { art: 'fracht', eigenschaften: {} };", 'Beat fracht legt immer Art fracht ohne Eigenschaften (Parameter ladung wirkungslos)'],
  [PR, "if (has(p, am.parameter) && !has(am.modi, p[am.parameter]))", 'if (false)', 'Pruefer nimmt eine unbekannte art an'],
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
console.log(`Mutationsprobe Durchsuchung (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
