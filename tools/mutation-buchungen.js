'use strict';
// TEL-01 G: Mutationsprobe zu tools/test-buchungen.js. Kopiert server/ und shared/ und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt),
// ändert dort je Lauf EINE Stelle und verlangt, dass der Test rot wird (Exit 1 MIT FEHLER-Zeile; ein Absturz zählt nicht als erkannt).
// Jeder Anker muss genau einmal im Quelltext stehen (sonst Exit 2). --trocken prüft nur die Anker.
//   node tools/mutation-buchungen.js [--trocken] [begriff …]      (npm run test:buchungen-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-buchungen-'));
for (const rel of ['server', 'shared', 'content', 'public']) { if (fs.existsSync(path.join(ROOT, rel))) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true }); }
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'tools', 'test-buchungen.js'), path.join(TMP, 'tools', 'test-buchungen.js'));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const GE = 'server/sim/geld.js', VO = 'server/sim/vorrat.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  ['server/sim/space.js', "Geld.einnehmen(game, C.enemies[e.kind].salvage, 'abschuss');", 'game.inventory.marks += C.enemies[e.kind].salvage;', 'Abschuss-Beute wieder direkt auf marks geschrieben'],
  ['server/sim/shop.js', "Vorrat.einlagern(game, entry.id, 1, 'kauf');", 'game.inventory[entry.id] = (game.inventory[entry.id] || 0) + 1;', 'Shop schreibt den Kauf wieder direkt ins Inventar (computed Schlüssel)'],
  ['server/sim/away.js', "Vorrat.entnehmen(game, 'medipack', 1, 'nachschub');", 'game.inventory.medipack--;', 'Medipack-Nachschub wieder mit --'],
  ['server/weltstand.js', "Geld.erstatten(game, 300, 'migration');", 'game.inventory.marks += 300;', 'Erstattung bei Migration wieder direkt'],
  ['server/sim/entern.js', "Geld.einnehmen(game, ec.salvage || 0, 'entern');", 'const inv = game.inventory; inv.marks += ec.salvage || 0;', 'Entern schreibt über einen Alias (const inv = game.inventory)'],
  [GE, "function einnehmen(game, n, grund) { return schreiben(game, 'buchung', grund, game.inventory.marks + n); }", "function einnehmen(game, n, grund) { game.emit('sfx', { name: 'discovery' }); return schreiben(game, 'buchung', grund, game.inventory.marks + n); }", 'stille Variante einnehmen sendet sfx'],
  [GE, "function erstatten(game, n, grund) { return schreiben(game, 'buchung', grund, game.inventory.marks + n); }", "function erstatten(game, n, grund) { game.missionEvent('marksCredited', { n }); return schreiben(game, 'buchung', grund, game.inventory.marks + n); }", 'stille Variante erstatten sendet marksCredited'],
  [GE, "  schreiben(game, 'buchung', grund, game.inventory.marks - preis);\n  return true;", "  schreiben(game, 'buchung', grund, game.inventory.marks - preis);\n  game.missionEvent('marksPaid', { n: preis });\n  return true;", 'stille Variante bezahlen sendet marksPaid'],
  [GE, "return vorher - game.inventory.marks;", "game.missionEvent('marksPaid', { n: 1 }); return vorher - game.inventory.marks;", 'abziehenHoechstens sendet marksPaid'],
  [GE, "function standSetzen(game, n, grund) { return schreiben(game, 'stand', grund, n); }", "function standSetzen(game, n, grund) { game.missionEvent('marksCredited', { n }); return schreiben(game, 'stand', grund, n); }", 'standSetzen sendet ein Ereignis (wäre eine Buchung)'],
  [GE, 'Math.max(0, vorher - n)', 'vorher - n', 'Clamping auf 0 bei abziehenHoechstens entfernt'],
  [GE, "if (stand(game) < k) return false;", "", 'abbuchen bucht auch bei zu wenig'],
  [GE, "game.missionEvent('marksCredited', { n: k, grund: ereignisGrund || null, marks: game.inventory.marks });", "", 'gutschreiben sendet kein marksCredited mehr'],
  [GE, "game.emit('sfx', { name: 'discovery', volume: 0.5 });", "", 'gutschreiben sendet kein sfx mehr'],
  [GE, "if (!GRUENDE.includes(grund)) throw new Error('geld: unbekannter Grund ' + grund);\n  const vorher", "const vorher", 'Kern prüft den Grund nicht mehr'],
  [VO, "if (!(have >= n)) return false;", "", 'entnehmen bucht auch bei zu wenig'],
  [VO, "schreiben(game, gut, 'buchung', grund, Math.max(0, have - n));", "schreiben(game, gut, 'buchung', grund, have - n);", 'abziehenHoechstens ohne Clamping'],
  [VO, "function standSetzen(game, gut, n, grund) { return schreiben(game, gut, 'stand', grund, n); }", "function standSetzen(game, gut, n, grund) { return schreiben(game, gut, 'buchung', grund, n); }", 'Vorrat.standSetzen bucht als Buchung statt Stand'],
];

const trocken = process.argv.includes('--trocken');
const filter = process.argv.slice(2).filter((a) => a !== '--trocken');
const lies = (datei) => fs.readFileSync(path.join(ROOT, datei), 'utf8').replace(/\r\n/g, '\n');   // Windows-Checkout mit CRLF: Muster mit \n sollen treffen
let fehlAnker = 0;
for (const [datei, alt, , was] of MUTATIONEN) { const t = lies(datei).split(alt).length - 1; if (t !== 1) { console.log('ANKER ' + t + 'x: ' + was); fehlAnker++; } }
if (fehlAnker) process.exit(2);
if (trocken) { console.log(MUTATIONEN.length + ' Anker, alle genau einmal'); process.exit(0); }

const lauf = () => spawnSync(process.execPath, [path.join(TMP, 'tools/test-buchungen.js')], { env: Object.assign({}, process.env, { BUCHUNGEN_ROOT: TMP }), encoding: 'utf8' });
const basis = lauf();
if (basis.status !== 0) { console.log('Ausgangslage ist schon rot:\n' + basis.stdout + basis.stderr); process.exit(1); }
let ueberlebt = 0, laeufe = 0;
for (const [datei, alt, neu, was] of MUTATIONEN) {
  if (filter.length && !filter.some((f) => was.includes(f))) continue;
  const pfad = path.join(TMP, datei), orig = lies(datei);
  fs.writeFileSync(pfad, orig.split(alt).join(neu));
  const r = lauf();
  fs.writeFileSync(pfad, orig);
  laeufe++;
  if (r.status !== 0 && /FEHLER/.test(r.stdout)) console.log('getötet:  ' + was);
  else { ueberlebt++; console.log((r.status === 0 ? 'ÜBERLEBT: ' : 'ABSTURZ (zählt nicht): ') + was); }
}
console.log(`${laeufe} Mutationen, ${ueberlebt} überlebt`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(ueberlebt ? 1 : 0);
