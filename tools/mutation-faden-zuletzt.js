'use strict';
// SPT-02 2: Mutationsprobe zu tools/test-faden-zuletzt.js. Kopiert Server, Shared, Content, public/js und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel
// und verlangt, dass der Test rot wird (Exit != 0). Überlebt eine Mutation, deckt kein Test die Regel ab.
//   node tools/mutation-faden-zuletzt.js [--trocken] [begriff …]
//   --trocken: prüft nur, ob jede Textstelle genau einmal gefunden wird (kein Testlauf)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-faden-zuletzt-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TEST = 'tools/test-faden-zuletzt.js';
fs.copyFileSync(path.join(ROOT, TEST), path.join(TMP, TEST));
fs.copyFileSync(path.join(ROOT, 'tools', 'regie-fixture.js'), path.join(TMP, 'tools', 'regie-fixture.js'));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const BR = 'server/sim/abenteuer-brett.js', P3 = 'server/sim/faden-p3.js', NR = 'public/js/notrufe.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  [BR, '  zuletztMerken(game, F, f, key);\n', '', 'a: beiEnde merkt den Faden nicht (kein zuletzt)'],
  [BR, 'z.nr === F.nr && F.t - z.t < BW.zuletzt_gilt_taetigkeiten ? z : null', 'F.t - z.t < BW.zuletzt_gilt_taetigkeiten ? z : null', 'b: ein neuer Faden nimmt den Eintrag nicht weg'],
  [BR, 'z.nr === F.nr && F.t - z.t < BW.zuletzt_gilt_taetigkeiten ? z : null', 'z.nr === F.nr ? z : null', 'c: der Eintrag laeuft nie ab'],
  [BR, 'z.nr === F.nr && F.t - z.t < BW.zuletzt_gilt_taetigkeiten ? z : null', 'z.nr === F.nr && F.t - z.t < 1 ? z : null', 'd: der Eintrag laeuft sofort ab'],
  [BR, "z ? z.nr + ':' + z.t : ''", "''", 'e: der Schluessel kennt zuletzt nicht (Client bekommt den Block nie neu)'],
  [BR, "if (z) s.zuletzt = { titel: z.titel, ausgang: z.ausgang, text: z.text, ...(z.w ? { w: z.w } : {}) };", "if (z) s.zuletzt = { titel: z.titel, ausgang: 'gelungen', text: z.text, ...(z.w ? { w: z.w } : {}) };", 'f: der Ausgang im Snapshot ist immer gelungen'],
  [BR, "if (z) s.zuletzt = { titel: z.titel, ausgang: z.ausgang, text: z.text, ...(z.w ? { w: z.w } : {}) };", "if (z) s.zuletzt = { titel: z.titel, ausgang: z.ausgang, text: BW.zuletzt_text_gelungen, ...(z.w ? { w: z.w } : {}) };", 'g: der Text ist nicht der des Abschluss-Beats'],
  [BR, "if (z) s.zuletzt = { titel: z.titel, ausgang: z.ausgang, text: z.text, ...(z.w ? { w: z.w } : {}) };", "if (z) s.zuletzt = { titel: z.titel, ausgang: z.ausgang, text: z.text };", 'h: die Wirkung w fehlt im Snapshot'],
  [BR, "if (!F.abenteuerAngebote.length && !l && !z) return null;\n  const text", "if (!F.abenteuerAngebote.length && !l) return null;\n  const text", 'i: ohne Angebot und laufenden Faden kein Block (zuletzt wird nie gesendet)'],
  [BR, 'delete f.abschlussText;\n', '', 'j: der Merktext bleibt am Faden (landet im Weltstand)'],
  [P3, 'if (faden.plan) faden.abschlussText = text;', '', 'k: der Abschluss-Beat hinterlaesst keinen Text'],
  [NR, "if (!sel || sel.pseudo) return false;", "if (!sel) return false;", 'l: Enter/X gelten auch auf dem Pseudo-Eintrag'],
  [NR, "if (!l[V.sel].pseudo) cmd('captain.notruf.fokus'", "if (true) cmd('captain.notruf.fokus'", 'm: W/S schickt einen Fokus-Befehl fuer den Pseudo-Eintrag'],
  [NR, "if (w && w.pseudo) return w; ", "", 'n: die Wahl auf dem Pseudo-Eintrag gilt nicht vor dem Server-Fokus'],
  [NR, "return [{ i: 'zuletzt', pseudo: true,", "return [{ i: 'zuletzt', pseudo: false,", 'o: der Eintrag traegt pseudo nicht'],
];

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const TROCKEN = process.argv.includes('--trocken');
const lauf = () => spawnSync(process.execPath, [TEST], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
let ueberlebt = 0, gelaufen = 0;
console.log(`Mutationsprobe test-faden-zuletzt.js (${MUTATIONEN.length} Mutationen${TROCKEN ? ', trocken' : ''}, Kopie in ${TMP})`);
if (!TROCKEN) {
  const basis = lauf();
  console.log(`  Ausgangslage: ${basis.status === 0 ? 'grün' : 'ROT (Abbruch)'}`);
  if (basis.status !== 0) { console.log((basis.stdout || '').split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 5).join('\n') + (basis.stderr || '').slice(0, 400)); process.exit(1); }
}
for (const [datei, alt, neu, was] of MUTATIONEN) {
  if (FILTER.length && !FILTER.some((f) => was.toLowerCase().includes(f))) continue;
  gelaufen++;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  const nl = orig.includes('\r\n');
  const text = nl ? orig.replace(/\r\n/g, '\n') : orig;
  const stellen = text.split(alt).length - 1;
  if (stellen !== 1) { console.log(`  ?? ${was}: Textstelle nicht eindeutig gefunden (${datei}, ${stellen}x)`); ueberlebt++; continue; }
  if (TROCKEN) { console.log(`  ok   ${was}: Textstelle gefunden (${stellen}x)`); continue; }
  const neuText = text.replace(alt, () => neu);
  fs.writeFileSync(f, nl ? neuText.replace(/\n/g, '\r\n') : neuText);
  const r = lauf();
  fs.writeFileSync(f, orig);
  const rot = r.status !== 0;
  const fehler = (r.stdout || '').split('\n').filter((l) => /FEHLER/.test(l));
  if (!rot) ueberlebt++;
  console.log(`  ${rot ? 'rot  ' : 'GRÜN '} ${was}${rot ? ` (${fehler.length} Fehler, z. B. ${(fehler[0] || 'Absturz').replace(/^\s*FEHLER\s*/, '').slice(0, 70)})` : '  <-- ÜBERLEBT'}`);
}
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(ueberlebt ? `${ueberlebt} von ${gelaufen} Mutation(en) überlebt` : `alle ${gelaufen} Mutationen ${TROCKEN ? 'gefunden (trocken)' : 'erkannt'}`);
process.exit(ueberlebt ? 1 : 0);
