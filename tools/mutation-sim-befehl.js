'use strict';
// FAD-01 A: Mutationsprobe zu tools/test-faden-sim-befehl.js. Kopiert Server, Shared, Content und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel
// und verlangt, dass der Test rot wird (Exit != 0). Überlebt eine Mutation, deckt der Test die Regel nicht ab.
//   node tools/mutation-sim-befehl.js [begriff …] [--trocken]      (npm run test:faden-sim-befehl-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet (Exit 0).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-sim-befehl-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools', 'fixtures'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures', 'faeden'), path.join(TMP, 'tools', 'fixtures', 'faeden'), { recursive: true });
const TESTS = ['tools/test-faden-sim-befehl.js'];
for (const t of TESTS.concat(['tools/regie-fixture.js', 'tools/faden-fixture.js', 'package.json'])) fs.copyFileSync(path.join(ROOT, t), path.join(TMP, t));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const PR = 'server/sim/faden-pruefer.js', P3 = 'server/sim/faden-p3.js', FA = 'server/sim/faden.js', WE = 'content/faeden/werte.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // Regel (c): jeder Weg über eine Tat
  [PR, "if (!t && simBefehlFolge(b)) m('SIM_BEFEHL_OHNE_TAT'", "if (false && simBefehlFolge(b)) m('SIM_BEFEHL_OHNE_TAT'", 'Regel c entfernt: die Tat auf dem Weg wird nicht geprüft'],
  [PR, "const t2 = t || (ag === 'gelungen' && o === b.aus[ag] && SB.tat_beats.includes(b.typ));", "const t2 = true;", 'Regel c: jeder Weg gilt als Tat'],
  [PR, "const t2 = t || (ag === 'gelungen' && o === b.aus[ag] && SB.tat_beats.includes(b.typ));", "const t2 = t || (o === b.aus[ag] && SB.tat_beats.includes(b.typ));", 'Regel c: auch der Ausgang gescheitert (Frist, Zeitablauf) zählt als Tat'],
  [PR, "const t2 = t || (ag === 'gelungen' && o === b.aus[ag] && SB.tat_beats.includes(b.typ));", "const t2 = t || (ag === 'gelungen' && o === b.aus[ag]);", 'Regel c: das Gelingen jedes Beat-Typs zählt als Tat (tat_beats ignoriert)'],
  [PR, "const key = i + '|' + s + '|' + (h ? 1 : 0) + '|' + (t ? 1 : 0);", "const key = i + '|' + s + '|' + (h ? 1 : 0);", 'Regel c: die Wegesuche unterscheidet Zustände mit und ohne Tat nicht'],
  // Regel (a), (b), (d), (e)
  [PR, "if (istSimBefehl(f)) { folgeOk = false;", "if (false) { folgeOk = false;", 'Regel a: sim_befehl in einer Option wird nicht als Ort-Fehler erkannt'],
  [PR, "if (ag !== 'gelungen') fehler.push(fehl('SIM_BEFEHL_ORT'", "if (false) fehler.push(fehl('SIM_BEFEHL_ORT'", 'Regel a: sim_befehl in aus.gescheitert wird nicht erkannt'],
  [PR, "if (istSimBefehl(f)) { out.push(fehl('SIM_BEFEHL_ORT', `Beat ${b.id}, Variante", "if (false) { out.push(fehl('SIM_BEFEHL_ORT', `Beat ${b.id}, Variante", 'Regel a: sim_befehl in der Variante wird nicht erkannt'],
  [PR, "if (!SB.beats_erlaubt.includes(b.typ)) fehler.push(", "if (false) fehler.push(", 'Regel b entfernt: jeder Beat-Typ darf die Folge tragen'],
  [PR, "    if (istSimBefehl(f)) continue;   // FAD-01 A (d)", "", 'Regel d: folgeProfil zählt sim_befehl als Fehlerprofil'],
  [PR, "else if (!a.includes(SB.standard_art)) out.push(", "else if (false) out.push(", 'Regel e: die Standardart muss nicht in arten stehen'],
  [PR, "|| new Set(a).size !== a.length ||", "||", 'Regel e: doppelte Arten sind erlaubt'],
  [PR, "if (f.grund !== undefined) out.push(fehl('SIM_BEFEHL_FORM'", "if (false) out.push(fehl('SIM_BEFEHL_FORM'", 'Regel e: sim_befehl mit grund wird nicht beanstandet'],
  // faden_weiter.art
  [PR, "faden_weiter: ['typ', 'faden', 'beat', 'art'] };", "faden_weiter: ['typ', 'faden', 'beat'] };", 'faden_weiter: das Feld art ist unbekannt'],
  [PR, "if (typeof b.art !== 'string' || !has(SB.arten, b.art)) return fehl('ART_UNGUELTIG'", "if (false) return fehl('ART_UNGUELTIG'", 'faden_weiter: eine unbekannte Art wird angenommen'],
  [PR, "if (!sf) return fehl('ART_OHNE_FOLGE'", "if (false) return fehl('ART_OHNE_FOLGE'", 'faden_weiter: art bei einem Beat ohne die Folge wird angenommen'],
  [PR, "if (!simBefehlArten(sf).includes(b.art)) return fehl('ART_NICHT_ERLAUBT'", "if (false) return fehl('ART_NICHT_ERLAUBT'", 'faden_weiter: eine Art außerhalb der erlaubten wird angenommen'],
  [FA, "if (typeof b.art === 'string') ctx.art = b.art;", "", 'weiterSetzen: die Art des Spielleiters kommt nie beim Baustein an'],
  [FA, "    if (P.istSimBefehl(x)) continue;   // FAD-01 A: sim_befehl", "    // FAD-01 A: sim_befehl", 'folgenAnwenden: sim_befehl wird als Wirkung abgelehnt und protokolliert'],
  // Standardart und Baustein
  [P3, "? ctx.art : SB.standard_art;", "? ctx.art : 'sprengung';", 'Standardart vertauscht: ohne Angabe kommt die Sprengung'],
  [WE, "\"standard_art\": \"invasion\"", "\"standard_art\": \"sprengung\"", 'Standardart vertauscht in den Daten: sprengung'],
  [WE, "\"beides\": [\"sabotage\", \"invasion\"]", "\"beides\": [\"invasion\", \"sabotage\"]", 'beides: die Reihenfolge der Ankündigungen ist vertauscht'],
  [P3, "const art = Pruefer.simBefehlArten(folge).includes(ctx.art) ? ctx.art : SB.standard_art;", "const art = SB.standard_art;", 'Baustein: die Art des Spielleiters wird ignoriert'],
  [P3, "return { ausgang: ok.length ? 'gelungen' : 'gescheitert' };", "return { ausgang: 'gelungen' };", 'Fallback: auch ohne angekündigte Wirkung gilt der Beat als gelungen'],
  [P3, "if (folge) return simBefehl(game, faden, ctx, folge);", "return simBefehl(game, faden, ctx, folge || { typ: 'sim_befehl' });", 'Baustein: auch eine Vorlage ohne die Folge bekommt die Invasion'],
  [P3, "const nach = faden.fracht && HEX.test(faden.fracht.nach || '') ? faden.fracht.nach : null;", "const nach = null;", 'invasion: das Ziel der Lieferung wird nie benutzt'],
  // invasionsZiel
  [P3, "if (nd.besitzer !== 'rom' || nd.crew === true || haupt.includes(code)) continue;", "if (nd.besitzer !== 'rom' || haupt.includes(code)) continue;", 'invasionsZiel: ein Posten der Crew ist ein Ziel'],
  [P3, "if (nd.besitzer !== 'rom' || nd.crew === true || haupt.includes(code)) continue;", "if (nd.besitzer !== 'rom' || nd.crew === true) continue;", 'invasionsZiel: die Hauptwelt ist ein Ziel'],
  [P3, "if (!(nd.posten || (d.hex[code] && d.hex[code].hafen))) continue;", "if (!nd.posten) continue;", 'invasionsZiel: ein Hafen ist kein Ziel'],
  [P3, "if (dist < bd) { best = code; bd = dist; }", "if (dist <= bd) { best = code; bd = dist; }", 'invasionsZiel: bei Gleichstand gewinnt der größere Code'],
  [P3, "if (dist === null || dist > reichweite) continue;", "if (dist === null) continue;", 'invasionsZiel: keine Reichweite'],
  [P3, "if (nd.besitzer !== 'rom' || nd.crew === true || haupt.includes(code)) continue;", "if (nd.besitzer === 'ger' || nd.crew === true || haupt.includes(code)) continue;", 'invasionsZiel: auch Ziele fremder Fraktionen'],
];

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const lesen = (datei) => { const t = fs.readFileSync(path.join(TMP, datei), 'utf8'); return t.replace(/\r\n/g, '\n'); };
let kaputt = 0;
for (const [datei, alt, , was] of MUTATIONEN) if (lesen(datei).split(alt).length !== 2) { console.log(`  ?? Anker nicht eindeutig: ${was} (${datei})`); kaputt++; }
if (kaputt) { console.log(`${kaputt} Anker nicht anwendbar`); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } process.exit(2); }
if (process.argv.includes('--trocken')) { console.log(`alle ${MUTATIONEN.length} Anker eindeutig`); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } process.exit(0); }

const lauf = (test) => spawnSync(process.execPath, [test], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
let ueberlebt = 0, gelaufen = 0;
console.log(`Mutationsprobe ${TESTS.join(', ')} (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of TESTS) {
  const basis = lauf(t);
  console.log(`  Ausgangslage ${t}: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
}
for (const [datei, alt, neu, was] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  fs.writeFileSync(f, nl ? text.replace(alt, () => neu).replace(/\n/g, '\r\n') : text.replace(alt, () => neu));
  let wer = null, r = null;
  for (const t of TESTS) { r = lauf(t); if (r.status !== 0) { wer = path.basename(t, '.js').replace('test-', ''); break; } }
  fs.writeFileSync(f, orig);
  const fehler = ((r && r.stdout) || '').split('\n').filter((l) => /FEHLER/.test(l));
  if (!wer) ueberlebt++;
  console.log(`  ${wer ? 'rot  ' : 'GRÜN '} ${was}${wer ? ` (${wer}: ${fehler.length} Fehler, z. B. ${(fehler[0] || 'Absturz').replace(/^\s*FEHLER\s*/, '').slice(0, 64)})` : '  <-- ÜBERLEBT'}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) überlebt` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
