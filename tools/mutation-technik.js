'use strict';
// TEC-01 F: Mutationsprobe zu den Regeln der Schildkette (Technik Stufe 1): server/sim/komponenten.js, komponenten-plan.js, interior.js, sprung.js, kriegslage-szene.js, shared/komponenten-format.js, shared/protocol.js, Weltstand-Schema.
// Kopiert den Quellbaum (server, shared, content, tools ohne Fixtures) in ein Temp-Verzeichnis AUSSERHALB des Repos, ersetzt je Lauf EINEN Text in EINER Datei der Kopie
// (das Repo bleibt unberührt) und lässt die Tests dagegen laufen (Liste TESTS: Regeln, Sprungbruch, Tutorial, Bedienung, Übersicht, Weltstand, Bot-Pläne). Eine Mutation gilt als erkannt, sobald ein Test rot wird
// (Exit != 0 mit Ausgabe FEHLER); sie überlebt, wenn alle Tests grün bleiben. Exit 1, wenn eine Mutation überlebt (oder ein Text nicht genau einmal vorkommt).
// Der volle Lauf ist nicht in der Standardkette (dauert einige Minuten): npm run mutation:technik; der schnelle Textanker-Check (--trocken) läuft in der Kette check.
//   node tools/mutation-technik.js [begriff ...] [--trocken]     (--trocken: nur prüfen, dass jeder Text genau einmal vorkommt; begriff: nur Mutationen, deren Beschreibung ihn enthält)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const trocken = process.argv.includes('--trocken');
const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
// schnelle Tests zuerst (eine Mutation endet beim ersten roten Test); test-bot-komponenten ist mit gut 20 s der langsamste
const TESTS = ['tools/test-komponenten.js', 'tools/test-sprungbruch.js', 'tools/test-m1-technik.js', 'tools/test-komp-bedienung.js', 'tools/test-komp-uebersicht.js', 'tools/test-weltstand.js', 'tools/test-bot-komponenten.js'];
const KOMP = 'server/sim/komponenten.js', FORMAT = 'shared/komponenten-format.js', PLAN = 'server/sim/komponenten-plan.js';

// [Datei, alter Text, neuer Text, Beschreibung: welche Regel verletzt wird]
const MUTATIONEN = [
  [KOMP, 'const frei = L.filter((k) => k.z !== DEFEKT);', 'const frei = L.filter((k) => k.z === OK);', 'Treffer-Pool nur ok: geflickte Komponenten werden nie getroffen (Pool ist ok + geflickt)'],
  [KOMP, '  const vorher = wahl.z;\n  faelltAus(wahl);', '  const vorher = wahl.z;\n  faelltAus(wahl);\n  L.forEach((q) => { if (q.z === GEFLICKT) q.z = DEFEKT; });', 'Treffer bricht alle Flicken statt nur die getroffene Komponente'],
  [KOMP, 'return ziel.index != null ? setzeRepariert(game, sys, ziel, OK, true) : null;', 'return ziel.index != null ? (liste(game, sys).forEach((q) => { q.z = OK; }), setzeRepariert(game, sys, ziel, OK, true)) : null;', 'Tausch heilt alle Komponenten statt nur eine'],
  [KOMP, 'return ziel.index != null ? setzeRepariert(game, sys, ziel, OK, true) : null;', 'return ziel.index != null ? setzeRepariert(game, sys, ziel, OK, false) : null;', 'Tausch setzt den Ausfallzähler n nicht zurück'],
  [KOMP, 'return ziel.index != null ? setzeRepariert(game, sys, ziel, GEFLICKT, false) : null;', 'return ziel.index != null ? setzeRepariert(game, sys, ziel, OK, false) : null;', 'Flicken heilt voll statt zu flicken (kein Sprungbruch-Risiko)'],
  [FORMAT, "const hatZaehler = (t) => t === 'R' || t === 'K';", "const hatZaehler = (t) => t === 'R' || t === 'K' || t === 'S';", 'Ausfallzähler n zählt auch den Spannungsregler (nur R und K zählen)'],
  [FORMAT, "const hatZaehler = (t) => t === 'R' || t === 'K';", "const hatZaehler = (t) => t === 'R';", 'Ausfallzähler n zählt den Steuerkern nicht (R und K zählen)'],
  [KOMP, 'if (k.z === OK && F.hatZaehler(k.t)) k.n', 'if (F.hatZaehler(k.t)) k.n', 'n zählt auch beim Bruch eines Flickens (nur ok -> defekt zählt)'],
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
  // ---- TEC-01 Endreview M3: Weltstand, Snapshot, Wächter, Überlast, Haltezeiten, Zielwahl, normKomp, Bot-Plan ----
  [KOMP, "if (zustandZahl(L.filter((k) => k.z === DEFEKT).length) !== gespeichert[sys]) {", 'if (false) {', 'Weltstand speichern: Codes werden nicht gegen den Systemzustand geprüft (widersprüchliche Codes landen im Block)'],
  [KOMP, "(out || (out = {}))[sys] = '-'.repeat(L.length) + zt;", "(out || (out = {}))[sys] = 'o'.repeat(L.length) + zt;", "Weltstand speichern: bei Widerspruch steht 'o' statt '-' (Zustandscodes würden beim Laden gelten)"],
  [KOMP, "if (zt) (out || (out = {}))[sys] = '-'.repeat(L.length) + zt;", 'if (false) (out || (out = {}))[sys] = "-";', 'Weltstand speichern: bei Widerspruch gehen die Zähler verloren'],
  [KOMP, 'else game.ship.komp[sys].forEach((k, i) => { k.n = L[i].n; k.sp = L[i].sp; });', 'else { /* Zähler verworfen */ }', 'Weltstand laden: bei widersprüchlichen Codes bleiben die Zähler nicht erhalten'],
  [KOMP, 'if (L.every((k) => k.z) && zustandZahl(L.filter((k) => k.z === DEFEKT).length) === interior().effZustand(game, sys)) game.ship.komp[sys] = L;', 'if (L.every((k) => k.z)) game.ship.komp[sys] = L;', 'Weltstand laden: Codes gelten auch gegen den Systemzustand'],
  [KOMP, 'F.dekodiereStreng(block[sys], rezept(game, sys))', 'F.dekodiere(block[sys], rezept(game, sys))', 'Weltstand laden: Block nur lax statt streng geprüft (Zähler über 9999, kurze Zählerliste werden geklemmt statt verworfen)'],
  [KOMP, '    if (!Array.isArray(L) || !L.some((k) => k.z !== OK || k.n > 0 || k.sp > 0)) continue;\n    (out || (out = {}))[sys] = kodiere(game, sys);', '    if (!Array.isArray(L)) continue;\n    (out || (out = {}))[sys] = kodiere(game, sys);', 'snapshot(): Feld auch ohne Abweichung (Systeme, die komplett ok sind, stehen im Snapshot)'],
  [KOMP, 'if (kodiere(game, sys) === standard) continue;', 'if (false) continue;', 'Weltstand speichern: Standard (aus dem Systemzustand ableitbar) wird trotzdem gespeichert'],
  [KOMP, '=== st) return false;\n  erzeugeAusZustand(game, sys);', '=== st || true) return false;\n  erzeugeAusZustand(game, sys);', 'Wächter konsistent(): zieht die Komponenten bei geschriebenem Systemzustand nie nach'],
  [KOMP, '  korrekturZaehlen(game);\n  return true;', '  return true;', 'Wächter konsistent(): zählt die Korrektur nicht (kompKorrekturen)'],
  [KOMP, 'const t = r && d.ueberlast && d.ueberlast[d.systeme[sys]];', 'const t = r && d.ueberlast && null;', 'Überlast-Ziel entfällt (ueberlastZiel liefert nie eine Art)'],
  [KOMP, 'const pool = bev.length ? bev : frei;', 'const pool = frei;', 'waehleFrei: die Vorzugsart (Überlast trifft zuerst den Spannungsregler) gilt nicht'],
  [KOMP, 'const z = reparaturZiel(game, sys, aktion, komp);', 'const z = reparaturZiel(game, sys, aktion, null);', 'reparaturGueltig: ein Hold auf Komponente X gilt auch, wenn nur noch eine andere Ziel wäre (Wunsch wird im Hold nicht mehr geprüft)'],
  [KOMP, "const passt = Array.isArray(alt) && alt.length === rezept(game, sys).length && (!(st in RANG) || zustandZahl(alt.filter((k) => k.z === DEFEKT).length) === st);\n  return (passt ? alt : ausZustandRein(game, sys, alt))", "const passt = Array.isArray(alt) && alt.length === rezept(game, sys).length && (!(st in RANG) || zustandZahl(alt.filter((k) => k.z === DEFEKT).length) === st);\n  return (alt || ausZustandRein(game, sys, alt))", 'lage() (lesend): bei geschriebenem Systemzustand gilt die veraltete Liste statt der Berechnung aus dem Zustand'],
  [KOMP, "F.zulaessigeZiele(L, 'minigame', ausfallSperre(game)).length > 0; }", "F.zulaessigeZiele(L, 'flick', ausfallSperre(game)).length > 0; }", 'minispielMoeglich: Minispiel geht schon bei jedem defekten Bauteil'],
  ['server/sim/interior.js', "case 'swap': return p.zone === 'ship' && p.carry === 'ersatzteil' && repairable(game, h.system)", "case 'swap': return p.zone === 'ship' && repairable(game, h.system)", 'Tausch-Hold gilt weiter, auch wenn das Ersatzteil nicht mehr in der Hand ist (Ersatzteil ist Voraussetzung)'],
  ['server/sim/interior.js', "return how === 'swap' ? (R.partTime || 3) : (R.flickTime || 1.5);", "return how === 'swap' ? (R.partTime || 3) - 0.2 : (R.flickTime || 1.5);", 'Haltezeit Tausch 0,2 s zu kurz (3 s)'],
  ['server/sim/interior.js', "return how === 'swap' ? (R.partTime || 3) : (R.flickTime || 1.5);", "return how === 'swap' ? (R.partTime || 3) : (R.flickTime || 1.5) - 0.2;", 'Haltezeit Flicken 0,2 s zu kurz (1,5 s)'],
  [FORMAT, 'return gewaehlt && z.includes(gewaehlt) ? gewaehlt : (z[0] || null);', 'return gewaehlt || z[0] || null;', 'Client-Zielwahl: ein unzulässiges gewähltes Ziel gilt weiter (kein Rückfall auf den Standard)'],
  [FORMAT, 'return z[(i + 1) % z.length];', 'return z[i % z.length];', 'Client-Wechseltaste: bleibt auf demselben Ziel stehen'],
  [FORMAT, "if (aktion === 'swap') return art(DEFEKT).concat(art(GEFLICKT));", "if (aktion === 'swap') return art(DEFEKT);", 'zulaessigeZiele: Tausch erlaubt keine geflickte Komponente'],
  ['shared/protocol.js', 'KOMP_ARTEN.indexOf(v) >= 0 ? v : undefined;', 'KOMP_ARTEN.indexOf(v) >= 0 ? v : v;', 'normKomp: unbekannter Komponentenwunsch gilt als Wunsch statt als keiner'],
  ['shared/protocol.js', "const KOMP_ARTEN = ['K', 'S', 'R', 'L'];", "const KOMP_ARTEN = ['K', 'S', 'R'];", 'Protokoll: KOMP_ARTEN kennt die Leitung L nicht'],
  [PLAN, "if (druck) return { aktion: 'flick', komp: defekt[0].t };", "if (false) return { aktion: 'flick', komp: defekt[0].t };", 'Bot-Plan: unter Druck (Gefecht) wird nicht nur geflickt'],
  [PLAN, 'if (defekt.length >= 2 && teile > 0) return', 'if (defekt.length >= 3 && teile > 0) return', 'Bot-Plan: zerstörtes System (2 defekt) wird nicht zuerst per Tausch angegangen'],
  [PLAN, 'teile - zahl(k.reserve) <= 0) return null;', 'teile <= 0) return null;', 'Bot-Plan: die Teile-Reserve der ruhigen Tauschrunde wird angetastet'],
  [PLAN, '(zerstoert ? 0 : TEILE_RESERVE)', '0', 'Bot-Kontext: beschädigtes System rührt die Reserve für ein zerstörtes System an'],
  [PLAN, '.includes(komp);   // dieselbe Regel', '.length > 0;   // dieselbe Regel', 'Bot-Wunsch: jeder Komponentenwunsch gilt als zulässig, sobald irgendein Ziel zulässig ist'],
  ['content/schema/weltstand.schema.json', '"komp": { "description": "TEC-01 A1:', '"komp": { "type": "object", "additionalProperties": { "type": "string", "pattern": "^[odg-]{1,6}$" }, "description": "TEC-01 A1:', 'Schema prüft den Komponentenblock streng (ein kaputter Block macht den ganzen Weltstand unladbar)'],
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
fs.cpSync(path.join(ROOT, 'tools'), path.join(TMP, 'tools'), { recursive: true, filter: (s) => !/[\\/]fixtures([\\/]|$)/.test(s) || /[\\/]fixtures$|[\\/]fixtures[\\/](context|weltstand)([\\/]|$)/.test(s) });   // Fixtures nur, soweit test-weltstand sie braucht
fs.cpSync(path.join(ROOT, 'public', 'js'), path.join(TMP, 'public', 'js'), { recursive: true });   // der Server lädt gemeinsame Module aus public/js
for (const f of ['package.json']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));

// Nullprobe: ohne Mutation müssen alle Tests der Kopie grün sein, sonst zählt "rot" nichts (die Kopie ließe z. B. Fixtures vermissen)
for (const t of TESTS) {
  const r = spawnSync(process.execPath, [path.join(TMP, t)], { cwd: TMP, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 180000 });
  if (r.status !== 0) { console.log(`  FEHLER Nullprobe: ${t} ist in der unveränderten Kopie nicht grün (Exit ${r.status}).`); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } process.exit(1); }
}
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
