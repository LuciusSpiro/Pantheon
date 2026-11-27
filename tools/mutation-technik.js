'use strict';
// TEC-01 F: Mutationsprobe zu den Regeln der Schildkette (Technik Stufe 1): server/sim/komponenten.js, interior.js, sprung.js, kriegslage-szene.js, shared/komponenten-format.js.
// Kopiert den Quellbaum (server, shared, content, tools ohne Fixtures) in ein Temp-Verzeichnis AUSSERHALB des Repos, ersetzt je Lauf EINEN Text in EINER Datei der Kopie
// (das Repo bleibt unberührt) und lässt die Tests dagegen laufen: test-komponenten, test-sprungbruch, test-m1-technik. Eine Mutation gilt als erkannt, sobald ein Test rot wird
// (Exit != 0 mit Ausgabe FEHLER); sie überlebt, wenn alle Tests grün bleiben. Exit 1, wenn eine Mutation überlebt (oder ein Text nicht genau einmal vorkommt).
// Nicht in der Standardkette (dauert gut eine Minute): npm run mutation:technik.
//   node tools/mutation-technik.js [begriff ...] [--trocken]     (--trocken: nur prüfen, dass jeder Text genau einmal vorkommt; begriff: nur Mutationen, deren Beschreibung ihn enthält)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const trocken = process.argv.includes('--trocken');
const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
const TESTS = ['tools/test-komponenten.js', 'tools/test-sprungbruch.js', 'tools/test-m1-technik.js'];
const KOMP = 'server/sim/komponenten.js', FORMAT = 'shared/komponenten-format.js';

// [Datei, alter Text, neuer Text, Beschreibung: welche Regel verletzt wird]
const MUTATIONEN = [
  [KOMP, 'const frei = L.filter((k) => k.z !== DEFEKT);', 'const frei = L.filter((k) => k.z === OK);', 'Treffer-Pool nur ok: geflickte Komponenten werden nie getroffen (Pool ist ok + geflickt)'],
  [KOMP, '  const vorher = wahl.z;\n  faelltAus(wahl);', '  const vorher = wahl.z;\n  faelltAus(wahl);\n  L.forEach((q) => { if (q.z === GEFLICKT) q.z = DEFEKT; });', 'Treffer bricht alle Flicken statt nur die getroffene Komponente'],
  [KOMP, 'return ziel.index != null ? setzeRepariert(game, sys, ziel, OK, true) : null;', 'return ziel.index != null ? (liste(game, sys).forEach((q) => { q.z = OK; }), setzeRepariert(game, sys, ziel, OK, true)) : null;', 'Tausch heilt alle Komponenten statt nur eine'],
  [KOMP, 'return ziel.index != null ? setzeRepariert(game, sys, ziel, OK, true) : null;', 'return ziel.index != null ? setzeRepariert(game, sys, ziel, OK, false) : null;', 'Tausch setzt den Ausfallzähler n nicht zurück'],
  [KOMP, 'return ziel.index != null ? setzeRepariert(game, sys, ziel, GEFLICKT, false) : null;', 'return ziel.index != null ? setzeRepariert(game, sys, ziel, OK, false) : null;', 'Flicken heilt voll statt zu flicken (kein Sprungbruch-Risiko)'],
  [KOMP, "const ZAEHLT_AUSFALL = ['R', 'K'];", "const ZAEHLT_AUSFALL = ['R', 'K', 'S'];", 'Ausfallzähler n zählt auch den Spannungsregler (nur R und K zählen)'],
  [KOMP, "const ZAEHLT_AUSFALL = ['R', 'K'];", "const ZAEHLT_AUSFALL = ['R'];", 'Ausfallzähler n zählt den Steuerkern nicht (R und K zählen)'],
  [KOMP, 'if (k.z === OK && ZAEHLT_AUSFALL.includes(k.t)) k.n', 'if (ZAEHLT_AUSFALL.includes(k.t)) k.n', 'n zählt auch beim Bruch eines Flickens (nur ok -> defekt zählt)'],
  [KOMP, 'if (!L || defekteZahl(game, sys) >= MAX_DEFEKT_BROKEN) return null;', 'if (!L) return null;', 'zerstörtes System (2 defekt) nimmt weiteren Komponentenschaden durch Treffer'],
  [KOMP, 'if (z === DEFEKT && defekteZahl(game, sys) >= MAX_DEFEKT_BROKEN) return false;', '', 'setzeKomponente: zerstörtes System nimmt weiteren Defekt'],
  [KOMP, 'if (defekteZahl(g, s) < MAX_DEFEKT_BROKEN && strom(g)() < sprungBruchChance(g, k.sp)) {', 'if (strom(g)() < sprungBruchChance(g, k.sp)) {', 'Sprungbruch würfelt auch bei zerstörtem System (Schutz der folgenden Flicken entfällt)'],
  [KOMP, '} else k.sp = (k.sp | 0) + 1;', '} else k.sp = 0;', 'überstandener Sprung zählt nicht in sp (Risiko wächst nicht)'],
  [KOMP, 'faelltAus(k); k.sp = 0;\n          gebrochen.push', 'faelltAus(k);\n          gebrochen.push', 'gebrochener Flicken behält den Sprungzähler sp'],
  [FORMAT, 'return Math.min(1, g + p * Math.max(0,', 'return Math.min(1, g + 0.5 * p * Math.max(0,', 'Sprungbruch-Formel: Anstieg pro überstandenem Sprung halbiert (p = grund + proSprung * sp)'],
  [FORMAT, 'const BRUCH_GRUND = 0.3, BRUCH_PRO_SPRUNG = 0.1;', 'const BRUCH_GRUND = 0.2, BRUCH_PRO_SPRUNG = 0.1;', 'Sprungbruch-Formel: Grundwert 0,2 statt 0,3'],
  ['server/sim/sprung.js', '  Komp().sprungBruch(game);   // TEC-01 C: jeder Sprung', '  // Komp().sprungBruch(game);   // TEC-01 C: jeder Sprung', 'Hook entfällt: Systemsprung (springeNach, auch Hops) bricht keine Flicken'],
  ['server/sim/sprung.js', '  Komp().sprungBruch(game);   // TEC-01 C: der Notsprung', '  // Komp().sprungBruch(game);   // TEC-01 C: der Notsprung', 'Hook entfällt: Notsprung bricht keine Flicken'],
  ['server/sim/kriegslage-szene.js', "  require('./komponenten.js').sprungBruch(game);", "  // require('./komponenten.js').sprungBruch(game);", 'Hook entfällt: Ankunft im Finale-Orbit zählt nicht als Sprung'],
  [KOMP, "function zustandZahl(zahl) { return zahl >= MAX_DEFEKT_BROKEN ? 'broken' : zahl >= 1 ? 'damaged' : 'ok'; }", "function zustandZahl(zahl) { return zahl >= MAX_DEFEKT_BROKEN ? 'broken' : zahl >= 2 ? 'damaged' : 'ok'; }", 'Ableitung: ein Defekt gilt noch als ok'],
  [KOMP, 'return L ? L.filter((k) => k.z === DEFEKT).length : 0;', 'return L ? L.filter((k) => k.z !== OK).length : 0;', 'geflickt zählt als defekt statt als funktionierend'],
  [KOMP, 'const k = L.find((q) => q.t === art && q.z !== DEFEKT);', 'const k = strom(game).pick(L.filter((q) => q.z !== DEFEKT));', 'Skripttreffer (damage_component) wählt per Zufall statt der genannten Art'],
  [FORMAT, 'k.n < (sperre >= 1 ? sperre : AUSFALL_SPERRE) ? [MINISPIEL_ART]', 'k.n <= (sperre >= 1 ? sperre : AUSFALL_SPERRE) ? [MINISPIEL_ART]', 'Minispiel erlaubt eine Reparatur über die Ausfallsperre hinaus'],
];

const norm = (t) => t.replace(/\r\n/g, '\n');
const quellen = {};
const quelle = (f) => quellen[f] || (quellen[f] = norm(fs.readFileSync(path.join(ROOT, f), 'utf8')));
let ueberlebt = 0;
const auswahl = MUTATIONEN.filter((m) => !FILTER.length || FILTER.some((f) => m[3].toLowerCase().includes(f)));
for (const [f, alt] of auswahl) {
  const c = quelle(f).split(alt).length - 1;
  if (c !== 1) { console.log(`  FEHLER Text kommt ${c}× vor in ${f}: ${alt.slice(0, 70)}`); ueberlebt++; }
}
if (ueberlebt) { console.log(`${ueberlebt} Text(e) nicht eindeutig.`); process.exit(1); }
if (trocken) { console.log(`ok (trocken): ${auswahl.length} Mutationen, jeder Text genau einmal.`); process.exit(0); }

// Quellbaum nach TEMP kopieren (außerhalb des Repos)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-technik-'));
for (const d of ['server', 'shared', 'content']) fs.cpSync(path.join(ROOT, d), path.join(TMP, d), { recursive: true });
fs.cpSync(path.join(ROOT, 'tools'), path.join(TMP, 'tools'), { recursive: true, filter: (s) => !/[\\/]fixtures([\\/]|$)/.test(s) });
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });   // der Server lädt gemeinsame Module aus public/js
for (const f of ['package.json']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));

const tabelle = [];
for (const [f, alt, neu, was] of auswahl) {
  const ziel = path.join(TMP, f);
  fs.writeFileSync(ziel, quelle(f).replace(alt, () => neu));
  let rot = null;
  for (const t of TESTS) {
    const r = spawnSync(process.execPath, [path.join(TMP, t)], { cwd: TMP, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 180000 });
    if (r.status !== 0 && /FEHLER/.test(r.stdout || '')) { rot = path.basename(t, '.js').replace('test-', ''); break; }
    if (r.status !== 0) { rot = null; tabelle.push([was, 'ABSTURZ (zählt nicht) in ' + path.basename(t)]); rot = false; break; }
  }
  fs.writeFileSync(ziel, quelle(f));   // zurück auf den Originalstand der Kopie
  if (rot === false) { ueberlebt++; continue; }
  if (rot) tabelle.push([was, 'rot (' + rot + ')']);
  else { ueberlebt++; tabelle.push([was, 'ÜBERLEBT']); }
  console.log(`  ${rot ? 'erkannt  ' : 'ÜBERLEBT '}${was}${rot ? '  -> ' + rot : ''}`);
}
console.log('\nMutation -> Ergebnis');
for (const [w, e] of tabelle) console.log(`  ${e.padEnd(22)} ${w}`);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }   
console.log(ueberlebt ? `\n${ueberlebt} von ${auswahl.length} Mutation(en) nicht erkannt.` : `\nAlle ${auswahl.length} Mutationen erkannt.`);
process.exit(ueberlebt ? 1 : 0);
