'use strict';
// SPT-02 7 (E Abgänge): Mutationsprobe zu tools/test-abgaenge.js (und test-konvoi.js, test-szene-sund.js für die Sprungstellen). Kopiert Server, Shared, Content und die Tests in ein Temp-Verzeichnis
// (das Repo bleibt unberuehrt), aendert dort je Lauf EINE Regel und verlangt, dass mindestens einer der Tests rot wird (Exit != 0). Ueberlebt eine Mutation, deckt kein Test die Regel ab.
// Selbstcheck: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie), sonst bricht die Probe mit Exit 2 ab. Abstuerze zaehlen NICHT als erkannt.
//   node tools/mutation-abgaenge.js [begriff ...] [--trocken]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-abgaenge-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TESTS = [['tools/test-abgaenge.js'], ['tools/test-konvoi.js'], ['tools/test-szene-sund.js']];
for (const [t] of TESTS) fs.copyFileSync(path.join(ROOT, t), path.join(TMP, t));
for (const h of fs.readdirSync(path.join(ROOT, 'tools'))) if (/^(regie-fixture|faden-fixture|gegner-testhilfe)\.js$/.test(h) || /^(konvoi|szene)-.*\.js$/.test(h)) fs.copyFileSync(path.join(ROOT, 'tools', h), path.join(TMP, 'tools', h));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul noetig */ } }

const SZ = 'server/sim/faden-szene.js', B2 = 'server/sim/faden-szene-b2.js', ES = 'server/sim/escort.js', GS = 'server/sim/gegnersprung.js', VF = 'server/sim/verfolgung.js', KV = 'server/sim/konvoi.js', KL = 'server/sim/kriegslage-szene.js', CL = 'public/js/client.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  [SZ, "if (textKey === 'szenenwechsel') aufraeumen(game, fs); else aufraeumenMitAbzug(game, fs);", 'aufraeumen(game, fs);', 'Szenenende mit Ausgang loescht still (kein Abzug)'],
  [SZ, "if (textKey === 'szenenwechsel') aufraeumen(game, fs); else aufraeumenMitAbzug(game, fs);", 'aufraeumenMitAbzug(game, fs);', 'Andocken/Szenenwechsel zieht ab statt still zu loeschen'],
  [SZ, '{ aufraeumenMitAbzug(game, fs); naechsteStarten(game); return; }', '{ aufraeumen(game, fs); naechsteStarten(game); return; }', 'Frist im Kampf loescht still'],
  [SZ, "function unterbrechen(game, fs) {\n  aufraeumen(game, fs);", "function unterbrechen(game, fs) {\n  aufraeumenMitAbzug(game, fs);", 'Unterbrechung durch Sim-Szene zieht ab statt still zu loeschen'],
  [SZ, "  Tel.raumWegGrund(game, weg, 'szene_ende');", '', 'Telemetrie-Grund szene_ende fehlt'],
  [SZ, "  if (alt) sp.retreatRule = alt; else delete sp.retreatRule;", '', 'Rueckzugsregel der Szene bleibt stehen / fremde Regel geht verloren'],
  [SZ, "  if (bleibt.length) gegnerStill(game, bleibt);", '', 'Relais/Pylon der Szene bleiben stehen (kein Abzug moeglich)'],
  [SZ, "schuetzling: SZB2.aufraeumenMitKnall", "schuetzling: SZB2.aufraeumen", 'Schuetzling ohne Explosion beim Szenenende'],
  [SZ, "q.tag === h.ally.tag && q.hp > 0) Abgang.melde(game, q, 'sprung');", "q.tag === h.ally.tag) Abgang.melde(game, q, 'sprung');", 'zerstoerter Verbuendeter springt noch einmal ab'],
  [SZ, "for (const q of game.space.escorts) if (q.tag === h.ally.tag && q.hp > 0) Abgang.melde(game, q, 'sprung');", "", 'Verbuendeter der Spontanhilfe verschwindet still'],
  [B2, "      if (game.time - (q.disabledT == null ? -1e9 : q.disabledT) <= W.knall_pause_s) continue;\n", "", 'zweiter Knall im selben Atemzug (kein Pausen-Schutz)'],
  [B2, "      game.emit('explosion', { x: Math.round(q.x), y: Math.round(q.y), zone: 'space' });\n", "", 'treibender Schuetzling verschwindet beim Szenenende still'],
  [ES, "es.state = 'kampfunfaehig'; es.disabledT = game.time;", "es.state = 'kampfunfaehig';", 'disable merkt sich den Zeitpunkt nicht'],
  [ES, "if (e.leaveT > cfg(game).leaveMaxS) Abgang.melde(game, e, 'rueck');", "Abgang.melde(game, e, 'rueck');", 'abgang rueck auch beim Austritt am Rand'],
  [ES, "if (e.leaveT > cfg(game).leaveMaxS) Abgang.melde(game, e, 'rueck');", "", 'Zeitlimit des Rueckzugs ohne abgang rueck'],
  [GS, "  Abgang.melde(game, e, 'sprung');\n", "", 'Notsprung ohne abgang'],
  [VF, "  Abgang.melde(game, e, 'sprung');\n", "", 'Sprung des Verfolgungsziels ohne abgang'],
  [KV, "  Abgang.melde(game, e, 'sprung');", "", 'Konvoi-Transporter springt ohne abgang'],
  [KL, "if (game.ship.scene === S.szene) for (const q of sp.escorts)", "for (const q of sp.escorts)", 'Sim-Szene: abgang der Verbuendeten auch nach einem Ortswechsel'],
  [KL, "if (q.sim === S.id && q.ally && q.hp > 0) Abgang.melde(game, q, 'sprung');", "", 'Sim-Szene: Verbuendete springen still ab'],
  [CL, "R.addFx('abgang_' + ev.art, null, ev.x, ev.y, ev.art === 'sprung' ? 0.8 : 0.9, { space: true });", "", "Client zeichnet abgang nicht"],
  [CL, "case 'konvoiSprung': break;", "", "Client: konvoiSprung nicht ausgewertet"],
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
console.log(`Mutationsprobe test-abgaenge.js, test-konvoi.js, test-szene-sund.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of TESTS) {
  const basis = lauf(t);
  console.log(`  Ausgangslage ${t.join(' ')}: ${basis.status === 0 ? 'gruen' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l) && !/Ausnahme/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
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
    const fz = ((r.stdout || '').split('\n')).filter((l) => /FEHLER/.test(l) && !/Ausnahme/.test(l));
    if (fz.length) { wer = path.basename(t[0], '.js').replace('test-', ''); fehler = fz; break; }
    if (!absturz) absturz = { test: path.basename(t[0], '.js'), text: ((r.stderr || '') + (r.stdout || '')).split('\n').filter((l) => /Error|    at /.test(l)).slice(0, 1).join(' ').trim().slice(0, 120) || `Exit ${r.status}` };
  }
  fs.writeFileSync(f, orig);
  if (wer) { erkannt++; console.log(`  rot    ${was} (${wer}: ${fehler.length} Fehler, z. B. ${fehler[0].replace(/^\s*FEHLER\s*/, '').slice(0, 64)})`); }
  else if (absturz) { abstuerze++; console.log(`  ABSTURZ ${was} (${absturz.test}: ${absturz.text}) – nicht als erkannt gezaehlt`); }
  else { ueberlebt++; console.log(`  GRUEN  ${was}  <-- UEBERLEBT`); }
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`Ergebnis: ${erkannt} erkannt, ${ueberlebt} ueberlebt, ${abstuerze} Absturz/Syntaxfehler (von ${gelaufen})`);
process.exit(ueberlebt || abstuerze ? 1 : 0);
