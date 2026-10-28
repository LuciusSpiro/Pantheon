'use strict';
// SUND-04a-1 A: Mutationsprobe zu tools/test-zielsysteme.js, tools/test-verfolgung.js und tools/test-verfolgung-bot.js (gezielter Antriebstreffer, Verfolgung). Kopiert Server, Shared, Content, Client-Module und
// die Tests in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel und verlangt, dass mindestens einer der Tests rot wird (Exit != 0). Überlebt eine Mutation, deckt kein Test
// die Regel ab. Vorher prüft ein Selbstcheck, dass jeder Anker genau einmal vorkommt (sonst Exit 2, keine stille Auslassung).
//   node tools/mutation-antrieb.js [begriff …]      (npm run test:antrieb-mutation)
//   node tools/mutation-antrieb.js --trocken         nur die Anker prüfen
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-antrieb-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'public', 'index.html'), path.join(TMP, 'public', 'index.html'));
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
// die Tests (die Bot-Läufe laden sim-headless.js und dessen Hilfsmodule)
const TESTS = [['tools/test-zielsysteme.js'], ['tools/test-zielsysteme-zonen.js'], ['tools/test-verfolgung.js'], ['tools/test-verfolgung-bot.js']];
for (const f of fs.readdirSync(path.join(ROOT, 'tools'))) if (f.endsWith('.js') && (/^(test-zielsysteme|test-verfolgung)/.test(f) || f === 'sim-headless.js' || f === 'regie-fixture.js' || f === 'gegner-testhilfe.js')) fs.copyFileSync(path.join(ROOT, 'tools', f), path.join(TMP, 'tools', f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const ZS = 'server/sim/zielsysteme.js', VF = 'server/sim/verfolgung.js', SP = 'server/sim/space.js', PI = 'server/sim/pilot.js', KO = 'server/sim/konvoi.js', FL = 'shared/flight.js', SW = 'server/sim/schiffswaffen.js',
  DZ = 'content/kampf/zielsysteme-werte.json', DV = 'content/kampf/verfolgung-werte.json';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
// Bewusst nicht in der Liste (äquivalente Mutanten): „wendeTempoMin 0“ (die Wende-Untergrenze 8 px/s rundet auf die Stopp-Stufe, die Klemme tempoMin 0,25 liegt darüber: nur bei Tempo unter 0,041, außerhalb der Klemme, unterscheiden sich die Varianten; vom Entwicklungsleiter als äquivalent dokumentiert, 2026-10-26), „Wiederholung auch bei wiederholung false“ (update() prüft k.wiederholung ein zweites Mal vor neu()), „das Schiff fährt während der Ladung weiter“ (nur der Bremsweg: es bremst vor oder am Fluchtpunkt), „Geschosse tragen opts.angriff auch ohne Szenenschalter“ (space.js: der Haken fragt den Schalter nur, damit die Optionen in Szenen ohne Schalter unverändert bleiben; trifftLerche prüft ihn selbst, das Verhalten ist gleich).
// Dateien je Kürzel (ZSD) und Einträge [Datei, alter Text (genau einmal), neuer Text, Beschreibung] für das Zonenmodell (C1b-1)
const ZSD = {ZS: "server/sim/zielsysteme.js", GS: "server/sim/gegnersystem.js", SPC: "server/sim/space.js", PI: "server/sim/pilot.js", KO: "server/sim/konvoi.js", VF: "server/sim/verfolgung.js", IN: "server/sim/interior.js", DM: "server/sim/damage.js", WZ: "content/kampf/zielsysteme-werte.json"};
const MUTATIONEN = [
  [ZSD.ZS, "  if (!e || !e.sys || !e.tempoAn) return 1;", "  if (!e || !e.sys) return 1;", "Tempo: der Antrieb bremst auch ohne Wirkung (Golden würde kippen)"],
  [ZSD.ZS, "    if (d && d.faktor != null) f *= d.faktor;", "    if (d && d.faktor != null) f *= 1;", "Tempo: die Faktoren aus den Daten wirken nicht"],
  [ZSD.ZS, "function merke(game, e, gezielt) { if (e && (gezielt || szeneAktiv(game))) e.tempoAn = true; }", "function merke(game, e, gezielt) { if (e) e.tempoAn = true; }", "Tempo: jeder Treffer macht den Antrieb wirksam"],
  [ZSD.ZS, "  if (!id || !e || game.ship.target !== e.id || !e.sys || !e.sys[id]) return null;", "  if (!id || !e || !e.sys || !e.sys[id]) return null;", "Systemziel: gilt für jedes Ziel, nicht nur das gewählte"],
  [ZSD.SPC, "const gez = opts && opts.angriff && !opts.ally && game.ship.target === e.id ?", "const gez = opts && opts.angriff && game.ship.target === e.id ?", "Gegner: Verbündete treffen gezielt"],
  [ZSD.SPC, "  if (t) Zielsysteme.merke(game, e, t.gezielt);", "", "Gegner: der gezielte Treffer macht den Antrieb nicht wirksam"],
  [ZSD.SPC, "  if (t && t.gezielt && t.state !== t.vorher) Zielsysteme.gegnerGetroffen(game, e, t);", "", "Gegner: gezielte Zustandswechsel werden nicht gemeldet"],
  [ZSD.SPC, "    vKin *= Zielsysteme.tempoFaktor(e);", "    vKin *= 1;", "Kinematisches Modell ignoriert den Antrieb"],
  [ZSD.PI, "Flight.stepBody(e, input, c, e.tempoAn ? { speedFactor: Zielsysteme.tempoFaktor(e) } : null, dt);", "Flight.stepBody(e, input, c, null, dt);", "Pilot-Modell ignoriert den Antrieb"],
  [ZSD.PI, "(c.minSpeed || 0) * (e.tempoAn ? Math.min(1, Zielsysteme.tempoFaktor(e)) : 1);", "(c.minSpeed || 0);", "Jäger: Mindestfahrt ohne Antrieb-Wirkung"],
  [ZSD.KO, "{ speedFactor: e.tempoAn ? Zielsysteme.tempoFaktor(e) : 1 }", "{ speedFactor: 1 }", "Konvoi-Transporter ignoriert den Antrieb"],
  [ZSD.ZS, "  if (!Gsys.erreichbar(e, id, zugewandteZone(game, e))) return 'Von hier nicht erreichbar – erst die Seite öffnen, zu der das System gehört.';", "", "Wahl: keine Erreichbarkeit bei der Wahl"],
  [ZSD.GS, "  if (gez && e.sys[gez.id] && e.sys[gez.id].z !== 'broken' && defOf(e.kind, gez.id).zone === zielZone && erreichbar(e, gez.id, gez.zugewandt)) id = gez.id;", "  if (gez && e.sys[gez.id]) id = gez.id;", "Gezielt: wirkt auch außerhalb der Zone und ohne Erreichbarkeit"],
  [ZSD.GS, "  return z === zugewandt || (z === 'mitte' && !!zugewandt && frei(e, zugewandt).length === 0);", "  return true;", "Erreichbarkeit: jede Zone ist erreichbar"],
  [ZSD.GS, "(z === 'mitte' && !!zugewandt && frei(e, zugewandt).length === 0)", "(z === 'mitte' && !!zugewandt)", "Mitte: erreichbar, auch wenn die zugewandte Zone noch Systeme hat"],
  [ZSD.GS, "  if (reg.sperre && st.sp != null && now < st.sp + SPERRE_S) return true;", "", "Sperre aus: eine Salve schaltet den Antrieb in einem Zug aus"],
  [ZSD.GS, "  return st.imm != null && now < st.imm;", "  return false;", "Immunität aus: ein Treffer nach der Reparatur verschlechtert wieder"],
  [ZSD.GS, "\n  if (RANG[z] > RANG[st.z] && !gesperrt(game, st, id)) { st.z = z; st.sp = game.time; }", "\n  if (RANG[z] > RANG[st.z]) { st.z = z; st.sp = game.time; }", "Sperre im Treffer umgangen"],
  [ZSD.GS, "  for (const id of ids(e)) {\n    if (!regelVon(id)) continue;", "  for (const id of []) {\n    if (!regelVon(id)) continue;", "Sperre: verzögerte Zustandswechsel werden nicht nachgeholt"],
  [ZSD.GS, "  e.sysTreffer = (e.sysTreffer || 0) + 1;", "", "Verzögerung: der Systemtreffer-Zähler der Verfolgung zählt nicht"],
  [ZSD.WZ, "\"sperre\": true,", "\"sperre\": false,", "Daten: der Antrieb hat keine Sperre"],
  [ZSD.WZ, "\"sperre_s\": 1.5,", "\"sperre_s\": 0,", "Daten: Sperre 0 s"],
  [ZSD.WZ, "\"immunitaet_s\": 10", "\"immunitaet_s\": 0", "Daten: Immunität 0 s"],
  [ZSD.ZS, "function halte(e) { if (e) e.gestellt = true; }", "function halte(e) { void e; }", "Gestellt: das Flag fehlt (Reparatur bliebe an)"],
  [ZSD.ZS, "function reparaturErlaubt(e) { return !(e && e.gestellt); }", "function reparaturErlaubt(e) { return true; }", "Reparatur: der Schalter ist aus"],
  [ZSD.VF, "  Zielsysteme.halte(e);   // ein gestelltes Schiff bleibt ausgefallen (die Reparatur bleibt aus, C2)", "", "Verfolgung: gestellt setzt den Schalter nicht"],
  [ZSD.VF, "  const aus = Zielsysteme.ausgefallen(e, SYSTEM_ZIEL);", "  const aus = false;", "Verfolgung: der ausgefallene Antrieb stellt nicht"],
  [ZSD.VF, "  if (k.stellT >= STELLEN.zeit) gestellt(game, k, e);", "  if (k.stellT >= 0) gestellt(game, k, e);", "Verfolgung: gestellt ohne Haltezeit"],
  [ZSD.VF, "  if (reaktorAus && e.sprung != null) { e.sprung = null; k.verz = 0; }", "", "Verfolgung: der zerstörte Reaktor bricht die Ladung nicht ab"],
  [ZSD.VF, "  if (e.sprung == null && !aus && !reaktorAus && dist(", "  if (e.sprung == null && !aus && dist(", "Verfolgung: ohne Reaktor startet die Ladung trotzdem"],
  [ZSD.IN, "  if (ziel && frei(ziel) && systemSector(ziel) === zone && erreichbarZone(systemSector(ziel), opts.zugewandt)) {", "  if (ziel && frei(ziel) && systemSector(ziel) === zone) {", "Lerche: Erreichbarkeit entfällt"],
  [ZSD.IN, "  const erreichbarZone = (sz, zug) => sz === zug || (sz === -1 && zug != null && !zoneFrei(zug));", "  const erreichbarZone = () => true;", "Lerche: die Mitte ist immer erreichbar"],
  [ZSD.DM, "o.zielt ? { ziel: o.zielt, zugewandt: sector } : null", "null", "Lerche: das Systemziel der Gegner wirkt nicht"],
];

// Selbstcheck der Anker: VOR jedem Lauf muss jede Mutation anwendbar sein (Anker genau einmal im Quelltext der Kopie). Sonst bricht die Probe mit Exit 2 ab.
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
const lauf = ([test, ...arg]) => spawnSync(process.execPath, [test, ...arg], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
// Erkannt = ein Test ist mit FEHLER-Zeilen rot (eine Prüfung schlägt fehl). Ein Lauf ohne FEHLER-Zeile bei Exit != 0 ist ein ABSTURZ (SyntaxError,
// Laufzeitfehler der Mutante): wird getrennt ausgewiesen und NICHT als erkannt gezählt.
const fehlerZeilen = (r) => ((r && r.stdout) || '').split('\n').filter((l) => /FEHLER/.test(l) && !/Ausnahme/.test(l));
let ueberlebt = 0, gelaufen = 0, erkannt = 0, abstuerze = 0;
console.log(`Mutationsprobe test-zielsysteme.js, test-verfolgung.js, test-verfolgung-bot.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
for (const t of TESTS) {
  const basis = lauf(t);
  console.log(`  Ausgangslage ${t.join(' ')}: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
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
    const fz = fehlerZeilen(r);
    if (fz.length) { wer = path.basename(t[0], '.js').replace('test-', ''); fehler = fz; break; }
    if (!absturz) absturz = { test: path.basename(t[0], '.js'), text: ((r.stderr || '') + (r.stdout || '')).split('\n').filter((l) => /Error|    at /.test(l)).slice(0, 1).join(' ').trim().slice(0, 120) || `Exit ${r.status}` };
  }
  fs.writeFileSync(f, orig);
  if (wer) { erkannt++; console.log(`  rot   ${was} (${wer}: ${fehler.length} Fehler, z. B. ${fehler[0].replace(/^\s*FEHLER\s*/, '').slice(0, 64)})`); }
  else if (absturz) { abstuerze++; console.log(`  ABSTURZ ${was} (${absturz.test}: ${absturz.text}) – nicht als erkannt gezählt`); }
  else { ueberlebt++; console.log(`  GRÜN  ${was}  <-- ÜBERLEBT`); }
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`Ergebnis: ${erkannt} erkannt, ${ueberlebt} überlebt, ${abstuerze} Absturz/Syntaxfehler (von ${gelaufen})`);
process.exit(ueberlebt || abstuerze ? 1 : 0);
