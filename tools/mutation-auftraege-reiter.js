'use strict';
// SPT-02 5: Mutationsprobe zu tools/test-auftraege-reiter.js. Kopiert Server, Shared, Content, public/js und die Tests in ein Temp-Verzeichnis (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel
// und verlangt, dass der Test rot wird (Exit != 0). Überlebt eine Mutation, deckt kein Test die Regel ab.
//   node tools/mutation-auftraege-reiter.js [--trocken] [begriff …]
//   --trocken: prüft nur, ob jede Textstelle genau einmal gefunden wird (kein Testlauf)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-auftraege-reiter-'));
const kopiere = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
['server', 'shared', 'content'].forEach(kopiere);
fs.mkdirSync(path.join(TMP, 'public', 'js'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools', 'fixtures'), path.join(TMP, 'tools', 'fixtures'), { recursive: true });
const TEST = 'tools/test-auftraege-reiter.js';
fs.copyFileSync(path.join(ROOT, TEST), path.join(TMP, TEST));
fs.copyFileSync(path.join(ROOT, 'tools', 'regie-fixture.js'), path.join(TMP, 'tools', 'regie-fixture.js'));
fs.copyFileSync(path.join(ROOT, 'tools', 'faden-fixture.js'), path.join(TMP, 'tools', 'faden-fixture.js'));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const NV = 'public/js/notrufe.js', SM = 'public/js/starmap.js', CO = 'public/js/consoles.js', PS = 'public/js/pult-stationen.js', TA = 'public/js/tasten.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  // ---- Quelle der Notruf-Liste: jede Marke hat einen Eintrag
  [NV, "if (!mk || mk.t !== 'notruf' || typeof mk.id !== 'string' || belegt.has(mk.id)) continue;", "if (!mk || mk.t !== 'notruf' || typeof mk.id !== 'string' || belegt.has(mk.id) || mk.id.startsWith('reise:')) continue;", 'a: Takt-Marken (reise:nN) bekommen keinen Eintrag'],
  [NV, "if (!mk || mk.t !== 'notruf' || typeof mk.id !== 'string' || belegt.has(mk.id)) continue;", "if (!mk || mk.t !== 'notruf' || typeof mk.id !== 'string') continue;", 'b: die Kampagnen-Marke zaehlt doppelt (kein belegt-Abgleich)'],
  [NV, "const belegt = new Set(out.map((r) => 'notruf:' + r.i));", 'const belegt = new Set();', 'c: Kampagnen-Marken werden nicht von nr abgeleitet (doppelter Eintrag)'],
  [NV, 'const ai = frei.findIndex((a) => a.ort === mk.h);', 'const ai = -1;', 'd: Brett-Angebot wird dem Takt-Eintrag nicht zugeordnet'],
  [NV, 'const f = a ? null : faeden.find((l) => l.ort === mk.h) || null;', 'const f = null;', 'e: angenommener Takt-Notruf verweist nicht auf seinen Faden'],
  [NV, "for (const a of frei) out.push({ i: 'a:' + a.id, art: 'takt', h: a.ort, b: null, angebot: a, faden: null });", '', 'f: Notruf-Angebot ohne Marke bekommt keinen Eintrag'],
  [NV, 'const frei = ((m && m.angebote) || []).filter((a) => a.notruf);', 'const frei = ((m && m.angebote) || []);', 'g: auch regulaere Angebote erscheinen als Notruf'],
  // ---- Tab Aktive Missionen
  [NV, 'return laufendeFaeden().concat(mis, pseudoEintraege());', 'return laufendeFaeden().filter((e) => !e.notruf).concat(mis, pseudoEintraege());', 'i: Notruf-Faeden fehlen bei den aktiven Missionen'],
  [NV, 'return laufendeFaeden().concat(mis, pseudoEintraege());', 'return laufendeFaeden().concat(mis);', 'j: der zuletzt-Pseudo-Eintrag fehlt'],
  [NV, "const mis = buch.filter((e) => e && !e.pseudo && e.state === 'aktiv')", "const mis = buch.filter((e) => e && e.state === 'aktiv')", 'k: Planungs-Pseudo-Eintrag des Missionsbuchs erscheint'],
  [NV, "const mis = buch.filter((e) => e && !e.pseudo && e.state === 'aktiv')", 'const mis = buch.filter((e) => e && !e.pseudo)', 'l: auch erledigte und angebotene Missionen erscheinen'],
  // ---- Karten-Klick und Tabs
  [NV, "V.tab = 'notruf'; V.wahl.notruf = id; V.puls", 'V.wahl.notruf = id; V.puls', 'm: der Karten-Klick oeffnet den Tab Notrufe nicht'],
  [NV, "id = String(id == null ? '' : id).replace(/^notruf:/, '');", "id = String(id == null ? '' : id);", 'n: Kampagnen-Marke notruf:<id> waehlt den Eintrag <id> nicht'],
  [NV, "V.puls = { id, t: jetzt() };\n    return true;", "V.puls = { id, t: jetzt() };\n    return false;", 'o: oeffne meldet keinen Erfolg'],
  [NV, "if (code === 'ArrowRight' || code === 'KeyD') { V.tab = 'notruf'; return true; }", "if (code === 'ArrowRight') { V.tab = 'notruf'; return true; }", 'p: Taste D wechselt nicht zum Tab Notrufe'],
  [NV, "if (code === 'ArrowLeft' || code === 'KeyA') { V.tab = 'aktiv'; return true; }", "if (code === 'ArrowLeft') { V.tab = 'aktiv'; return true; }", 'q: Taste A wechselt nicht zurueck'],
  [NV, "if (tab !== 'notruf' || !sel || sel.art !== 'kampagne') return false;", "if (tab !== 'notruf' || !sel) return false;", 'r: Takt-Notruf nimmt Enter/X/Fragen an (Annahme nur am Brett)'],
  [NV, "if (code === 'ArrowUp' || code === 'KeyW') return geh(-1);", "if (code === 'ArrowUp') return geh(-1);", 't: W waehlt nicht'],
  [NV, "if (tab === 'notruf' && e.art === 'kampagne' && cmd) cmd('captain.notruf.fokus', { id: e.i });", '', 'u: die Wahl eines Kampagnen-Notrufs fragt den Fokus nicht an'],
  [NV, 'const ab = si >= rows ? si - rows + 1 : 0;', 'const ab = 0;', 'v: bei vielen Eintraegen bleibt der gewaehlte unsichtbar'],
  // ---- Karte, Konsole, Benennung
  [SM, "if (mk.t !== 'ziel' && mk.id) mkRects.push(", 'if (false) mkRects.push(', 'w: Plaketten haben keine Klickflaeche'],
  [SM, 'if (d <= m.r + 3 && d < bd)', 'if (d <= 0 && d < bd)', 'x: Trefferradius der Plakette null'],
  [CO, "if (mkHit && mkHit.t === 'notruf' && mkHit.id && NotrufView.oeffne(mkHit.id)) { this.tab = TAB_NOTRUF;", "if (mkHit && mkHit.t === 'notruf' && mkHit.id && NotrufView.oeffne(mkHit.id)) { ", 'y: der Klick oeffnet den Reiter nicht'],
  [CO, "const TABS = ['Funk', 'Sternkarte', 'Lage', 'Außenteam', 'Sektorplan', 'Aufträge'];", "const TABS = ['Funk', 'Sternkarte', 'Lage', 'Außenteam', 'Sektorplan', 'Notrufe'];", 'z1: Konsole: Reiter heisst noch Notrufe'],
  [PS, "const TABS = ['Funk', 'Sternkarte', 'Lage', 'Außenteam', 'Sektorplan', 'Aufträge'];", "const TABS = ['Funk', 'Sternkarte', 'Lage', 'Außenteam', 'Sektorplan', 'Notrufe'];", 'z2: Pult: Reiter heisst noch Notrufe'],
  [TA, "A('captain.reiter6', 'captain', 'Reiter Aufträge', NUM(6).reverse()),", "A('captain.reiter6', 'captain', 'Reiter Notrufe', NUM(6).reverse()),", 'z3: Tastenbelegung: Reiter 6 heisst noch Notrufe'],
  [TA, "    A('captain.notruf.tabNotruf', 'captain', 'Aufträge: Tab Notrufe', ['ArrowRight', 'KeyD'], 'captain.notruf'),\n", '', 'z4: Tastenbelegung ohne Tab-Taste'],
];

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const TROCKEN = process.argv.includes('--trocken');
const lauf = () => spawnSync(process.execPath, [TEST], { cwd: TMP, encoding: 'utf8', timeout: 600000 });
let ueberlebt = 0, gelaufen = 0;
console.log(`Mutationsprobe test-auftraege-reiter.js (${MUTATIONEN.length} Mutationen${TROCKEN ? ', trocken' : ''}, Kopie in ${TMP})`);
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
