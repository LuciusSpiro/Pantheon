'use strict';
// SUND-04a-3 Orbit: Mutationsprobe zu tools/test-finale-orbit.js. Kopiert Server, Shared, Content und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je
// Lauf EINE Regel und verlangt, dass ein Test mit einer echten Prüfung rot wird (FEHLER-Zeile, Exit != 0). Ein Absturz (Ausnahme, SyntaxError, Zeitüberschreitung, keine Prüfzeile) zählt NICHT
// als erkannt: er sagt nichts über die Regel. Überlebt eine Mutation, deckt kein Test die Regel ab.
//   node tools/mutation-finale.js [begriff …] [--trocken]      (npm run test:finale-orbit-mutation)
// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst Exit 2. --trocken prüft nur die Anker und endet.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-finorbit-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
const TESTS = [['tools/test-finale-orbit.js']];
for (const f of fs.readdirSync(path.join(ROOT, 'tools'))) if (/\.(js|mjs|json)$/.test(f)) fs.copyFileSync(path.join(ROOT, 'tools', f), path.join(TMP, 'tools', f));   // der Test braucht den Bot (sim-finale-orbit.js, sim-headless.js)
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const K = 'server/sim/kriegslage-szene.js', D = 'content/welt/finale-werte.json', V = 'server/sim/verrat.js';
const SIEG = "  if (S.flaggGefallen && finaleImKampf(game, S).length === 0) { finaleEnde(game, S, 'sieg'); return; }";
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- die sieben Pflicht-Mutationen
  [K, SIEG, "  if (finaleImKampf(game, S).filter((e) => !e.flagg).length === 0) { finaleEnde(game, S, 'sieg'); return; }", 'Sieg ohne Flaggschiff (nur die Wachschiffe zählen)'],
  [K, "  try { Finale.orbitEnde(game, ausgang); } catch (e)", "  try { Finale.orbitEnde(game, ausgang); Finale.orbitEnde(game, ausgang); } catch (e)", 'orbitEnde doppelt'],
  [K, "  try { Finale.orbitEnde(game, ausgang); } catch (e)", "  try { Kriegslage.szeneAbschliessen(game, { wo: 'finale' }); Finale.orbitEnde(game, ausgang); } catch (e)", 'Sim-Tick im Orbit-Ende'],
  [K, "if (!ws || !hex || !game.ship || !ws.finale || ws.finale.phase !== 'orbit') return null;", "if (!ws || !hex || !game.ship) return null;\n  if (!ws.finale) ws.finale = Finale.neu();", 'Szene ohne Finale.bereit (Start auch ohne Phase orbit)'],
  [K, "  if (S.modus === 'finale') { finaleEnde(game, S, 'flucht'); return null; }   // SUND-04a-3 Orbit: der Sprung", "  if (S.modus === 'finale') { S.phase = 'ende'; aufraeumen(game, S); return null; }   // SUND-04a-3 Orbit: der Sprung", 'Flucht per Sprung ruft orbitEnde nicht'],
  [K, "  if (S.modus === 'finale') { finaleEnde(game, S, 'flucht'); return null; }   // SUND-04a-3 Orbit: Szenenwechsel", "  if (S.modus === 'finale') { S.phase = 'ende'; aufraeumen(game, S); return null; }   // SUND-04a-3 Orbit: Szenenwechsel", 'Flucht per Szenenwechsel ruft orbitEnde nicht'],
  [K, "const D = finaleD(); const C = game.C; const n = finaleCrew(game);", "const D = finaleD(); const C = game.C; const n = 1;", 'Skalierung nach Crewgröße ignoriert'],
  [K, "const a0 = Zufall.gleichverteilt(S.rng, 0, Math.PI * 2);", "const a0 = game.rng.range(0, Math.PI * 2);", 'Würfeln über game.rng'],
  // ---- weitere Regeln
  [K, "  if (S.flaggGefallen && !S.abzug) {", "  if (false) {", 'Wachschiffe brechen nach dem Flaggschiff nicht ab'],
  [K, ">= S.emBasis + Math.max(1, Number(D.orbit_notfall_bis_niederlage.wert) || 1)", ">= 99999", 'Notfallprotokoll ist keine Niederlage'],
  [K, "(game.simSzene && game.simSzene.phase !== 'ende') || game.fadenSzene || (game.space && game.space.verfolgung)) return null;", "(game.simSzene && game.simSzene.phase !== 'ende') || (game.space && game.space.verfolgung)) return null;", 'Szenenstart ignoriert eine Faden-Szene'],
  [K, "(game.simSzene && game.simSzene.phase !== 'ende') || game.fadenSzene || (game.space && game.space.verfolgung)) return null;", "game.fadenSzene || (game.space && game.space.verfolgung)) return null;", 'Szenenstart ignoriert eine laufende Sim-Szene'],
  [K, "    if (rest <= 0) finaleGegnerAufstellen(game, S);", "    finaleGegnerAufstellen(game, S);", 'Gegner erscheinen ohne Vorwarnung'],
  [K, "    flagg: { kind: fl.klasse, name: String(fl.name) }, wach,", "    flagg: { kind: fl.klasse, name: 'Spieler1' }, wach,", 'Flaggschiff mit falschem Namen'],
  [K, "  if (Finale.phase(game) === 'orbit') return null;   // SUND-04a-3 Orbit: die Ankunft des Finales (finaleStarten) löst keine zweite Szene aus\n", "", 'Ankunft im Orbit löst eine zweite Sim-Szene aus'],
  [K, "klasse: Number(D.orbit_szene.wert.klasse), fraktion: String(D.orbit_szene.wert.fraktion),", "klasse: 3, fraktion: 'ger',", 'Klasse und Fraktion fest im Code statt in den Daten (K7)'],
  [K, "volk: String(D.orbit_szene.wert.volk)", "volk: 'ger'", 'Volk fest im Code statt in den Daten (K7)'],
  [K, "Math.min(Math.max(1, ...finaleStufen()),", "Math.min(3,", 'Crew-Grenze fest 3 statt aus den Daten (K7)'],
  [V, "  if (S.modus === 'finale') return fehl('finale');", "", 'Verrat in der Entscheidungsschlacht möglich'],
  [V, "  if (S.modus === 'finale') return fehl('finale');", "  if (S.modus === 'finale') return fehl('hauptwelt');", 'Verrat im Finale: Text von Roms Hauptwelt (K4)'],
  [K, "      if (S && S.modus === 'finale') aufraeumen(game, S);\n      game.simSzene = null;", "      game.simSzene = null;", 'Fehler im Szenenaufbau: Verbuendete und Flotte bleiben stehen (K6)'],
  [K, "      if (merk.von && game.ship && game.ship.scene !== merk.von) require('./space.js').enterScene(game, merk.von, { docked: false });\n", "", 'Fehler im Szenenaufbau: das Schiff bleibt im Orbit (K6)'],
  [K, "      game.simSzene = null;\n      endeAufraeumen(game);", "      endeAufraeumen(game);", 'Fehler im Szenenaufbau: simSzene bleibt gesetzt (K6)'],
  [D, '"orbit_vorwarnung": {"wert": 12,', '"orbit_vorwarnung": {"wert": 3,', 'Daten: Vorwarnung unter 8 s'],
  [D, '"orbit_wachschiffe": {"wert": {"1":["korvette","korvette"],"2":["korvette","korvette"],"3":["korvette","korvette","korvette"]}', '"orbit_wachschiffe": {"wert": {"1":["korvette","korvette"],"2":["korvette","korvette"],"3":["raider","raider","raider"]}', 'Daten: Jäger als Wachschiffe'],
  [D, '"orbit_verbuendete": {"wert": {"1":["fregatte","korvette"],"2":["fregatte","korvette"],"3":["fregatte","fregatte","fregatte"]}', '"orbit_verbuendete": {"wert": {"1":["fregatte"],"2":["fregatte","korvette"],"3":["fregatte","fregatte","fregatte"]}', 'Daten: nur ein Verbündeter'],
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
const lauf = ([test, ...arg]) => spawnSync(process.execPath, [test, ...arg], { cwd: TMP, encoding: 'utf8', timeout: 300000 });
// erkannt = rot MIT einer echten FEHLER-Prüfzeile; ein Absturz (FEHLER Ausnahme, SyntaxError, Zeitüberschreitung, nur stderr) ist kein Beleg
const pruefFehler = (r) => ((r && r.stdout) || '').split('\n').filter((l) => /^\s*FEHLER\b/.test(l) && !/^\s*FEHLER Ausnahme/.test(l));
let ueberlebt = 0, gelaufen = 0, abstuerze = 0;
console.log(`Mutationsprobe test-finale-orbit.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of TESTS) {
  const basis = lauf(t);
  console.log(`  Ausgangslage ${t.join(' ')}: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
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
  let wer = null, beleg = null, absturz = false;
  for (const t of TESTS) {
    const r = lauf(t);
    if (r.status === 0) continue;
    const fe = pruefFehler(r);
    if (fe.length) { wer = path.basename(t[0], '.js').replace('test-', ''); beleg = fe; break; }
    absturz = true;   // rot ohne Prüfzeile: Absturz, zählt nicht
  }
  fs.writeFileSync(f, orig);
  if (!wer) { ueberlebt++; if (absturz) abstuerze++; }
  console.log(`  ${wer ? 'rot  ' : 'GRÜN '} ${was}${wer ? ` (${wer}: ${beleg.length} Fehler, z. B. ${beleg[0].replace(/^\s*FEHLER\s*/, '').slice(0, 64)})` : (absturz ? '  <-- NUR ABSTURZ, nicht erkannt' : '  <-- ÜBERLEBT')}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) nicht erkannt (davon ${abstuerze} nur Absturz)` : `alle ${gelaufen} Mutationen erkannt`);
process.exit(ueberlebt ? 1 : 0);
