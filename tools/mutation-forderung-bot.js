'use strict';
// BEA-01 D: Mutationsprobe zu tools/test-forderung-bot.js (Bot-Wege der Forderung am echten Server). Kopiert Server, Shared, Content, public und die noetigen Werkzeuge in ein Temp-Verzeichnis (das Repo bleibt unberuehrt),
// aendert dort je Lauf EINE Regel und verlangt, dass der Test fuer den genannten Weg rot wird (Exit 1 MIT FEHLER-Zeile). ABSTUERZE (Exit != 0 ohne FEHLER-Zeile) zaehlen NICHT als erkannt.
// Der Selbstcheck vorab verlangt, dass jeder Anker genau einmal im Quelltext steht (Exit 2, wenn nicht). --trocken prueft nur die Anker. node_modules: kein Junction, sondern NODE_PATH auf das Repo.
//   node tools/mutation-forderung-bot.js [--trocken] [begriff ...]      (npm run test:forderung-bot-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-forderung-bot-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content', 'public'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
kopiere('tools/lib');
for (const f of ['tools/spiel-forderung.js', 'tools/test-forderung-bot.js', 'tools/live-abend.js', 'tools/gegner-testhilfe.js', 'tools/messe-ablage.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
const ENV = Object.assign({}, process.env, { NODE_PATH: path.join(ROOT, 'node_modules') });

const FR = 'server/sim/faden-fracht.js', FF = 'server/sim/faden-forderung.js', BI = 'server/sim/faden-bitte.js', LF = 'server/sim/fracht.js', BB = 'tools/lib/bot-beats.js';
const BLEIBT = "const wareBleibtBeiScheitern = (beat) => !!(beat && Object.prototype.hasOwnProperty.call(D.BEATS, beat.typ) && D.BEATS[beat.typ].ware_bei_scheitern === 'bleibt');";
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, Wege des Tests (--weg)]
const MUTATIONEN = [
  [BB, "const antwort = gewuenscht || off.optionen.find((o) => o.id === 'annehmen') || off.optionen[0];", "const antwort = off.optionen.find((o) => o.id === 'annehmen') || off.optionen[0];", 'Bot: --wahl wird ignoriert', 'bestechen'],
  [BB, "else if (typ === 'bitte' || art === 'forderung') {", "else if (typ === 'bitte') {", 'Bot: die Beats der Forderung gelten als nicht gespielt', 'ausliefern'],
  [FR, BLEIBT, 'const wareBleibtBeiScheitern = () => true;', 'Ausliefern: die Ware bleibt im Frachtraum', 'ausliefern'],
  [FF, '  if (n > 0 && Geld.bestechungZahlen(game, n)) bezahlt = n;', '  if (n > 0) bezahlt = n;', 'Bestechen bucht keine Marken ab', 'bestechen'],
  [BI, 'const r = Faden().optionWaehlen(game, off.fadenId, opt.id);', 'const r = Faden().optionWaehlen(game, off.fadenId, off.optionen[0].id);', 'Die Wahl der Crew aendert den Weg nicht (immer die erste Option)', 'bestechen'],
  [FF, '  Lager().frachtDurchsuchen(game, { wer, tiefe: tiefe || undefined });', '  Lager().frachtDurchsuchen(game, { wer });', 'Durchsuchung ignoriert die Tiefe (scan deckt getarnte Ware auf)', 'durchsuchung_scan'],
  [LF, '    s.lager.splice(i, 1);\n    plaetze.unshift', '    plaetze.unshift', 'Beschlagnahmte Ware bleibt im Frachtraum', 'durchsuchung_voll'],
  [FF, "  if (grund) Faden().folgenAnwenden(game, f, [{ typ: 'ruf_aenderung', grund }], false);", '  if (false) Faden().folgenAnwenden(game, f, [{ typ: \'ruf_aenderung\', grund }], false);', 'Fund hat keine Ruf-Folge', 'durchsuchung_voll'],
  [FF, '  const soll = bussgeldVon(beat) * weg.n;', '  const soll = bussgeldVon(beat) * 1;', 'Bussgeld nur fuer einen Platz', 'durchsuchung_voll'],
  [FF, '  if (!weg.n) { if (T.sauber) Bitte().funkSprecher(game, wer, T.sauber); return { n: 0, bussgeld: 0, ruf: null }; }', '  if (!weg.n) { return { n: 0, bussgeld: 0, ruf: null }; }', 'Sauberer Frachtraum: der Zoll meldet nichts', 'durchsuchung_sauber'],
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

const lauf = (weg) => spawnSync(process.execPath, ['tools/test-forderung-bot.js', '--weg', weg], { cwd: TMP, encoding: 'utf8', timeout: 900000, env: ENV });
let ueberlebt = 0, gelaufen = 0, erkannt = 0, abstuerze = 0;
console.log(`Mutationsprobe Bot-Wege der Forderung (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
{
  const alleWege = [...new Set(MUTATIONEN.map((m) => m[4]))].join(',');
  const basis = lauf(alleWege);
  console.log(`  Ausgangslage (--weg ${alleWege}): ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 8).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
}
for (const [datei, alt, neu, was, weg] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  if (text.split(alt).length !== 2) { console.log(`  ?? ${was}: Textstelle nicht eindeutig gefunden (${datei})`); ueberlebt++; continue; }
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  const r = lauf(weg);
  fs.writeFileSync(f, orig);
  const fz = ((r.stdout || '').split('\n')).filter((l) => /FEHLER/.test(l) && !/FEHLER Ausnahme/.test(l));
  if (r.status !== 0 && fz.length) { erkannt++; console.log(`  rot    ${was} (${weg}: ${fz.length} Fehler, z. B. ${fz[0].replace(/^\s*FEHLER\s*/, '').slice(0, 70)})`); }
  else if (r.status !== 0) { abstuerze++; console.log(`  ABSTURZ ${was} (${weg}: Exit ${r.status}) – nicht als erkannt gezaehlt`); }
  else { ueberlebt++; console.log(`  GRUEN  ${was}  <-- UEBERLEBT`); }
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`Ergebnis: ${erkannt} erkannt, ${ueberlebt} ueberlebt, ${abstuerze} Absturz/Syntaxfehler (von ${gelaufen})`);
process.exit(ueberlebt || abstuerze ? 1 : 0);
