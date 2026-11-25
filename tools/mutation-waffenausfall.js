'use strict';
// SPT-02 9: Mutationsprobe zu tools/test-waffenausfall.js (Wenden bei Waffenausfall, pilot.js waffenSeite/breitseite). Kopiert Server, Shared, Content, Client-Module und
// den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel und verlangt, dass der Test rot wird (FEHLER-Zeile). Überlebt eine Mutation, deckt
// der Test die Regel nicht ab. Vorher prüft ein Selbstcheck, dass jeder Anker genau einmal vorkommt (sonst Exit 2).
//   node tools/mutation-waffenausfall.js [begriff …]      (nicht in package.json, nicht in der Kette)
//   node tools/mutation-waffenausfall.js --trocken         nur die Anker prüfen
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-waffenausfall-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'public', 'index.html'), path.join(TMP, 'public', 'index.html'));
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
// Test und Hilfsdatei
const TESTS = [['tools/test-waffenausfall.js']];
for (const f of ['test-waffenausfall.js', 'gegner-testhilfe.js']) fs.copyFileSync(path.join(ROOT, 'tools', f), path.join(TMP, 'tools', f));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const PI = 'server/sim/pilot.js', CF = 'shared/config.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
// Bewusst nicht in der Liste (äquivalent): "platz(s).length > 0" in aus() (nur für Klassen ohne Seitenplätze, die breitseite nie fliegen); "ganz(3) > 0" in waffenSeite (aus(3) false und Plätze vorhanden heißt schon ganz(3) > 0); Rücksetzen von e.wunschT (der Test bricht nur einmal, ein Rest-Zähler ohne zweiten Ausfall ändert nichts).
const MUTATIONEN = [
  [PI, "  if (!wv || !wv.an) return null;", "  if (!wv) return null;", "Schalter waffenWechsel.an wirkt nicht"],
  [PI, "  const aus = (s) => platz(s).length > 0 && ganz(s) === 0;", "  const aus = (s) => platz(s).length > 0 && ganz(s) <= 1;", "Ausfall: schon eine heile Waffe zählt als ausgefallen"],
  [PI, "  if (aus(1) && !aus(3) && ganz(3) > 0) return 3;", "  if (aus(1) && ganz(3) >= 0) return 3;", "Beide Seiten ausgefallen: Wunsch trotzdem"],
  [PI, "  if (aus(3) && !aus(1) && ganz(1) > 0) return 1;", "  if (aus(3) && ganz(1) >= 0) return 1;", "Beide Seiten ausgefallen (Gegenrichtung): Wunsch trotzdem"],
  [PI, "w.platz.indexOf(s === 1 ? 'stbd' : 'bb') === 0", "w.platz.indexOf(s === 1 ? 'bb' : 'stbd') === 0", "Seiten vertauscht (stbd/bb)"],
  [PI, "  if (aus(1) && !aus(3) && ganz(3) > 0) return 3;", "  if (aus(1) && !aus(3) && ganz(3) > 0) return 1;", "Wunsch: die ausgefallene Seite statt der heilen"],
  [PI, "e.wunschT >= ((p.waffenWechsel || {}).verzug || 0) ? wRoh : null;", "e.wunschT >= 0 ? wRoh : null;", "Verzug ignoriert"],
  [PI, "const waffeAus = other != null && ws != null && (e.side === 1 ? 3 : 1) !== ws && tv >= 15;", "const waffeAus = other != null && ws != null && tv >= 15;", "Seitenwechsel auch, wenn die richtige Seite schon zeigt"],
  [PI, "const waffeAus = other != null && ws != null && (e.side === 1 ? 3 : 1) !== ws && tv >= 15;", "const waffeAus = other != null && ws != null && (e.side === 1 ? 3 : 1) !== ws;", "Seitenwechsel auch bei stehender Lerche (Umlauf statt Drehen)"],
  [PI, "(((weak || waffeAus) && nearSt) || e.offBeamT > 6)", "((weak && nearSt) || e.offBeamT > 6)", "Waffenausfall löst keinen Seitenwechsel aus"],
  [PI, "const weak = ws == null && other != null", "const weak = other != null", "Schwachschild-Regel auch bei Waffenausfall (Umlauf bei ungleichen Schilden)"],
  [PI, "      e.side = -e.side; e.offBeamT = 0; e.switchCd = K.switchCd;", "      e.side = -e.side; e.offBeamT = 0; e.switchCd = 0;", "Abklingzeit nach dem Wechsel fehlt"],
  [PI, "((e.side === 1 ? 3 : 1) === ws ? base : norm(base + Math.PI))", "((e.side === 1 ? 3 : 1) !== ws ? base : norm(base + Math.PI))", "Quer liegen: falsche Seite zur Lerche"],
  [PI, "ws != null ? ((e.side === 1 ? 3 : 1) === ws", "false ? ((e.side === 1 ? 3 : 1) === ws", "Quer liegen: Waffenseite ignoriert"],
  [PI, " && !(ws != null && sec !== ws && tv < 15);", ";", "Drehen auf der Stelle zählt als „nicht querab“ (Umlauf)"],
  [CF, "waffenWechsel: { an: true, verzug: 2 }", "waffenWechsel: { an: false, verzug: 2 }", "Daten: Schalter aus"],
  [CF, "waffenWechsel: { an: true, verzug: 2 }", "waffenWechsel: { an: true, verzug: 0 }", "Daten: Verzug 0"],
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
console.log(`Mutationsprobe test-waffenausfall.js (${MUTATIONEN.length} Mutationen, Kopie in ${TMP})`);
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
