'use strict';
// TEL-01 G: Mutationsprobe zu tools/test-buchungen.js. Kopiert server/, shared/, content/, public/ und tools/*.js in ein Temp-Verzeichnis (das Repo bleibt unberührt),
// ändert dort je Lauf EINE Stelle und verlangt, dass der Test rot wird (Exit 1 MIT FEHLER-Zeile; ein Absturz zählt nicht als erkannt).
// Mutationen mit `probe` laufen mit der Laufzeitprobe (nur ein kurzer Lauf (test-entern)) und verlangen zusätzlich bestimmte Ausgabezeilen: `nurProbe` = die Probe ist der Täter
// (der statische Scanner schweigt), sonst läuft die Probe ohne (BUCHUNGEN_PROBE=aus, schneller).
// Jeder Anker muss genau einmal im Quelltext stehen (sonst Exit 2). --trocken prüft nur die Anker.
//   node tools/mutation-buchungen.js [--trocken] [begriff …]      (npm test hängt es ein; npm run test:buchungen-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const T0 = Date.now();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-buchungen-'));
for (const rel of ['server', 'shared', 'content', 'public']) { if (fs.existsSync(path.join(ROOT, rel))) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true }); }
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'tools'))) { if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'tools', f), path.join(TMP, 'tools', f)); }
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const GE = 'server/sim/geld.js', VO = 'server/sim/vorrat.js', PR = 'server/sim/buchungspruefung.js';
const PROBE = { probe: true };
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung, Optionen]
const MUTATIONEN = [
  // --- Grenze: direkte Schreibstellen wieder eingebaut (statischer Scanner) ---
  ['server/sim/space.js', "Geld.einnehmen(game, C.enemies[e.kind].salvage, 'abschuss');", 'game.inventory.marks += C.enemies[e.kind].salvage;', 'Abschuss-Beute wieder direkt auf marks geschrieben'],
  ['server/sim/shop.js', "Vorrat.einlagern(game, entry.id, 1, 'kauf');", 'game.inventory[entry.id] = (game.inventory[entry.id] || 0) + 1;', 'Shop schreibt den Kauf wieder direkt ins Inventar (computed Schlüssel)'],
  ['server/sim/away.js', "Vorrat.verbrauchen(game, 'medipack', 1, 'nachschub');", 'game.inventory.medipack--;', 'Medipack-Nachschub wieder mit --'],
  ['server/weltstand.js', "Geld.erstatten(game, 300, 'migration');", 'game.inventory.marks += 300;', 'Erstattung bei Migration wieder direkt'],
  ['server/sim/entern.js', "Geld.einnehmen(game, ec.salvage || 0, 'entern');", '{ const inv = game.inventory; inv.marks += ec.salvage || 0; }', 'Entern schreibt über einen Alias (const inv = game.inventory)'],
  ['server/mission/bausteine/buehne.js', "Vorrat.einlagernBis(m.game, 'ladung', Math.round(a.anzahl), 99, 'mission');", 'const inv = m.game.inventory; inv.ladung = Math.max(0, Math.min(99, (inv.ladung || 0) + Math.round(a.anzahl)));', 'ladung_geben schreibt den Zähler ladung wieder direkt'],
  ['server/sim/anker.js', "Vorrat.verbrauchen(game, 'ladung', 1, 'sprengung');", 'inv.ladung -= 1;', 'Sprengpunkt zieht die Ladung wieder direkt ab'],
  // --- Laufzeitprobe: Syntax, die der Regex-Vorfilter nicht kennt bzw. zusätzlich ---
  ['server/sim/space.js', "Geld.einnehmen(game, C.enemies[e.kind].salvage, 'abschuss');", '{ const inv = game.inventory || {}; inv.marks += C.enemies[e.kind].salvage; }', 'Probe + Scanner: Abschuss-Beute über `const inv = game.inventory || {}`',
    Object.assign({ erwartet: [/direkter Schreibzugriff/, /Verstoß: server\/sim\/space\.js/] }, PROBE)],
  ['server/sim/space.js', "Geld.einnehmen(game, C.enemies[e.kind].salvage, 'abschuss');", '[game.inventory].forEach((q) => { q.marks += C.enemies[e.kind].salvage; });', 'nur Probe: Abschuss-Beute über ein Array-Element (der Scanner kennt das nicht)',
    Object.assign({ erwartet: [/Verstoß: server\/sim\/space\.js/], verboten: [/direkter Schreibzugriff/] }, PROBE)],
  ['server/sim/space.js', "Geld.einnehmen(game, C.enemies[e.kind].salvage, 'abschuss');", 'Reflect.set(game.inventory, "marks", game.inventory.marks + C.enemies[e.kind].salvage);', 'Probe + Scanner: Abschuss-Beute über Reflect.set',
    Object.assign({ erwartet: [/Verstoß: server\/sim\/space\.js/] }, PROBE)],
  // --- Aufrufstellen: Betrag und Ereignis ---
  ['server/sim/space.js', "Geld.einnehmen(game, C.enemies[e.kind].salvage, 'abschuss');", "Geld.einnehmen(game, C.enemies[e.kind].salvage + 1, 'abschuss');", 'falscher Betrag: Abschuss-Beute +1'],
  ['server/sim/space.js', "Geld.abziehenHoechstens(game, C.emergency.marksCost, 'notfall');", "Geld.abziehenHoechstens(game, C.emergency.marksCost + 5, 'notfall');", 'falscher Betrag: Notfallprotokoll +5'],
  ['server/sim/notrufe.js', "if (d.lohn) Geld.gutschreiben(game, d.lohn, 'notruf');", "if (d.lohn) Geld.einnehmen(game, d.lohn, 'notruf');", '`einnehmen` statt `gutschreiben` an einer Stelle mit Ereignis (Notruf-Hinterhalt)'],
  ['server/sim/handel-info.js', "Geld.abziehenGeprueft(game, preis, 'info');", "if (!Geld.bezahlen(game, preis, 'info')) return fehl('zu_wenig_marken');", 'Handelsinfo: toter Zweig mit bezahlen statt bedingungslosem Abzug'],
  ['server/sim/medipack.js', "Vorrat.verbrauchen(game, 'medipack', 1, 'medkit');", "Vorrat.entnehmen(game, 'medipack', 1, 'medkit');", 'onArrive: entnehmen (prüft) statt verbrauchen (Bruchteil-Bestand bleibt stehen)'],
  ['server/sim/sonden.js', "  Vorrat.verbrauchenGanzzahlig(game, 'sonde', 1, 'sonde');\n  const s = { id: 'so' + (++game.sondenSeq), x: sh.x, y: sh.y, tx, ty,", "  Vorrat.verbrauchen(game, 'sonde', 1, 'sonde');\n  const s = { id: 'so' + (++game.sondenSeq), x: sh.x, y: sh.y, tx, ty,", 'Sonde: verbrauchen ohne floor/max (Bruchteil-Bestand)'],
  ['server/game.js', "    Geld.standSetzen(this, this.inventory.marks, 'start');\n", '', 'Anlage führt den Startstand der Marken nicht mehr durch die Kernfunktion'],
  ['server/game.js', "    for (const gut of Vorrat.GUETER) if (gut in this.inventory) Vorrat.standSetzen(this, gut, this.inventory[gut], 'start');\n", '', 'Anlage führt den Startstand der Güter nicht mehr durch die Kernfunktion'],
  // --- Strenger Modus und Zählen ---
  [PR, "function strengPruefen(an) { streng = an !== false; }", "function strengPruefen(an) { }", 'strenger Modus aus: strengPruefen() tut nichts -> Grund-Tests müssen rot werden'],
  [PR, "  if (streng) throw new Error(text);\n", "  throw new Error(text);\n", 'unbekannter Grund wirft auch im Spiel (statt zu zählen)'],
  [PR, "if (game && typeof game.countError === 'function') game.countError(where, new Error(text));", "", 'unbekannter Grund wird nicht gezählt'],
  [VO, "if (!GUETER.includes(gut)) Pruefung.unbekannt(", "if (!GUETER.includes(gut) && false) Pruefung.unbekannt(", 'Vorrat prüft das Gut nicht mehr'],
  [VO, "function einlagernBis(game, gut, n, grenze, grund) {\n  pruefe(game, gut, grund);\n  const neu = Math.max(0, Math.min(grenze, stand(game, gut) + n));", "function einlagernBis(game, gut, n, grenze, grund) {\n  pruefe(game, gut, grund);\n  const neu = Math.max(0, stand(game, gut) + n);", 'einlagernBis ohne Obergrenze'],
  [VO, "const GUETER = Object.freeze(['bolzen', 'sonde', 'medipack', 'loeschgel', 'loeschgelCharges', 'medipackCharges', 'ersatzteil', 'flickblech', 'tafel', 'ladung']);", "const GUETER = Object.freeze(['bolzen', 'sonde', 'medipack', 'loeschgel', 'loeschgelCharges', 'medipackCharges', 'ersatzteil', 'flickblech']);", 'tafel und ladung nicht mehr im Geltungsbereich'],
  // --- Dienste: Ereignisse und Rechnung ---
  [GE, "function einnehmen(game, n, grund) { return schreiben(game, 'buchung', grund, game.inventory.marks + n); }", "function einnehmen(game, n, grund) { game.emit('sfx', { name: 'discovery' }); return schreiben(game, 'buchung', grund, game.inventory.marks + n); }", 'stille Variante einnehmen sendet sfx'],
  [GE, "function erstatten(game, n, grund) { return schreiben(game, 'buchung', grund, game.inventory.marks + n); }", "function erstatten(game, n, grund) { game.missionEvent('marksCredited', { n }); return schreiben(game, 'buchung', grund, game.inventory.marks + n); }", 'stille Variante erstatten sendet marksCredited'],
  [GE, "  schreiben(game, 'buchung', grund, game.inventory.marks - preis);\n  return true;", "  schreiben(game, 'buchung', grund, game.inventory.marks - preis);\n  game.missionEvent('marksPaid', { n: preis });\n  return true;", 'stille Variante bezahlen sendet marksPaid'],
  [GE, "return vorher - game.inventory.marks;", "game.missionEvent('marksPaid', { n: 1 }); return vorher - game.inventory.marks;", 'abziehenHoechstens sendet marksPaid'],
  [GE, "function standSetzen(game, n, grund) { return schreiben(game, 'stand', grund, n); }", "function standSetzen(game, n, grund) { game.missionEvent('marksCredited', { n }); return schreiben(game, 'stand', grund, n); }", 'standSetzen sendet ein Ereignis (wäre eine Buchung)'],
  [GE, 'Math.max(0, vorher - n)', 'vorher - n', 'Clamping auf 0 bei abziehenHoechstens entfernt'],
  [GE, "if (stand(game) < k) { pruefeGrund(game, grund); return false; }", "", 'abbuchen bucht auch bei zu wenig'],
  [GE, "game.missionEvent('marksCredited', { n: k, grund: ereignisGrund || null, marks: game.inventory.marks });", "", 'gutschreiben sendet kein marksCredited mehr'],
  [GE, "game.emit('sfx', { name: 'discovery', volume: 0.5 });", "", 'gutschreiben sendet kein sfx mehr'],
  [GE, "  pruefeGrund(game, grund);\n  const vorher", "  const vorher", 'Kern prüft den Grund nicht mehr'],
  [VO, "if (!(have >= n)) return false;", "", 'entnehmen bucht auch bei zu wenig'],
  [VO, "schreiben(game, gut, 'buchung', grund, Math.max(0, have - n));", "schreiben(game, gut, 'buchung', grund, have - n);", 'abziehenHoechstens ohne Clamping'],
  [VO, "function standSetzen(game, gut, n, grund) {\n  pruefe(game, gut, grund);\n  if (istMarken(gut)) return Geld.standSetzen(game, n, grund);\n  return schreiben(game, gut, 'stand', grund, n);", "function standSetzen(game, gut, n, grund) {\n  pruefe(game, gut, grund);\n  if (istMarken(gut)) return Geld.standSetzen(game, n, grund);\n  return schreiben(game, gut, 'buchung', grund, n);", 'Vorrat.standSetzen bucht als Buchung statt Stand'],
  [VO, "if (istMarken(gut)) Geld.abziehenHoechstens(game, n, grund); else schreiben(game, gut, 'buchung', grund, have - n);", "schreiben(game, gut, 'buchung', grund, have - n);", 'entnehmen(marks) wird nicht mehr an geld.js weitergeleitet'],
];

const trocken = process.argv.includes('--trocken');
const filter = process.argv.slice(2).filter((a) => a !== '--trocken');
const lies = (datei) => fs.readFileSync(path.join(ROOT, datei), 'utf8').replace(/\r\n/g, '\n');   // Windows-Checkout mit CRLF: Muster mit \n sollen treffen
let fehlAnker = 0;
for (const [datei, alt, , was] of MUTATIONEN) { const t = lies(datei).split(alt).length - 1; if (t !== 1) { console.log('ANKER ' + t + 'x: ' + was); fehlAnker++; } }
if (fehlAnker) process.exit(2);
if (trocken) { console.log(MUTATIONEN.length + ' Anker, alle genau einmal'); process.exit(0); }

const lauf = (probe) => spawnSync(process.execPath, [path.join(TMP, 'tools/test-buchungen.js')], {
  env: Object.assign({}, process.env, { BUCHUNGEN_ROOT: TMP, BUCHUNGEN_PROBE: probe ? 'schnell' : 'aus', BUCHUNGEN_STRENG: '' }), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const basis = lauf(true);
if (basis.status !== 0) { console.log('Ausgangslage ist schon rot:\n' + basis.stdout + basis.stderr); process.exit(1); }
let ueberlebt = 0, laeufe = 0;
for (const [datei, alt, neu, was, opt] of MUTATIONEN) {
  if (filter.length && !filter.some((f) => was.includes(f))) continue;
  const o = opt || {};
  const pfad = path.join(TMP, datei), orig = lies(datei);
  fs.writeFileSync(pfad, orig.split(alt).join(neu));
  const r = lauf(!!o.probe);
  fs.writeFileSync(pfad, orig);
  laeufe++;
  const out = r.stdout || '';
  const rot = r.status === 1 && /FEHLER/.test(out) && !/SyntaxError/.test(out + (r.stderr || ''));   // ein Syntaxfehler der Mutation tötet nichts
  const passt = (o.erwartet || []).every((re) => re.test(out)) && !(o.verboten || []).some((re) => re.test(out));
  if (rot && passt) console.log('getötet:  ' + was);
  else {
    if (rot) for (const z of out.split('\n').filter((x) => /FEHLER|Verstoß|direkter/.test(x)).slice(0, 6)) console.log('     | ' + z.trim().slice(0, 160));
    ueberlebt++; console.log((r.status === 0 ? 'ÜBERLEBT: ' : rot ? 'ANDERER TÄTER (erwartete Ausgabe fehlt): ' : 'ABSTURZ (zählt nicht): ') + was); }
}
console.log(`${laeufe} Mutationen, ${ueberlebt} überlebt, ${Math.round((Date.now() - T0) / 100) / 10} s`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(ueberlebt ? 1 : 0);
