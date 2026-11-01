'use strict';
// CHA-01 D: Mutationsprobe zu tools/test-spind.js. Kopiert Server, Shared, Content, public (für world.js/maps) und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt),
// ändert dort je Lauf EINE Regel und verlangt, dass der Test rot wird (Exit 1 MIT FEHLER-Zeile; ein Absturz zählt nicht als erkannt).
// Jeder Anker muss genau einmal im Quelltext stehen (sonst Exit 2). --trocken prüft nur die Anker.
//   node tools/mutation-spind.js [--trocken] [begriff …]      (npm run test:spind-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-spind-'));
for (const rel of ['server', 'shared', 'content', 'public']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'tools', 'test-spind.js'), path.join(TMP, 'tools', 'test-spind.js'));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const IN = 'server/sim/interior.js', GA = 'server/game.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  [IN, "if (raum && raum.id === 'q' + p.color) list.push({ kind: 'locker' });", "if (raum) list.push({ kind: 'locker' });", 'Prüfung „eigenes Quartier“ entfernt (fremde Spinde öffnen)'],
  [IN, "if (info.kind === 'locker' && p.karte) {", "if (info.kind === 'locker') {", 'Prüfung „hat eine Karte“ entfernt (Bots öffnen den Spind)'],
  [IN, "case 'locker': return enterConsole(game, p, 'spind');", "case 'locker': return enterConsole(game, p, 'quartier');", 'Spind öffnet die Quartier-Konsole'],
  [GA, "if (p.console !== 'spind') return;", "", 'Ortsprüfung entfernt (karte.outfit überall)'],
  [GA, "if (p.console !== 'spind') return;", "if (!p.console) return;", 'Ortsprüfung nur „an irgendeiner Konsole“'],
  [GA, "const outfit = Charakter.pruefeOutfit(msg.outfit, charakterKatalog);", "const outfit = Object.assign({}, msg.outfit);", 'Outfit wird nicht geprüft'],
  [GA, "p.karte.outfit = outfit;\n    this.sendeKarte(p);", "Object.assign(p.karte, msg.karte || {}, { outfit });\n    this.sendeKarte(p);", 'karte.outfit darf den Charakterteil mitschreiben'],
  [GA, "if (JSON.stringify(outfit) === JSON.stringify(p.karte.outfit)) return;", "", 'unverändertes Outfit sendet trotzdem ein Ereignis'],
];

const trocken = process.argv.includes('--trocken');
const filter = process.argv.slice(2).filter((a) => a !== '--trocken');
const lies = (datei) => fs.readFileSync(path.join(ROOT, datei), 'utf8').replace(/\r\n/g, '\n');   // Windows-Checkout mit CRLF: Muster mit \n sollen treffen
let fehlAnker = 0;
for (const [datei, alt, , was] of MUTATIONEN) { const t = lies(datei).split(alt).length - 1; if (t !== 1) { console.log('ANKER ' + t + 'x: ' + was); fehlAnker++; } }
if (fehlAnker) process.exit(2);
if (trocken) { console.log(MUTATIONEN.length + ' Anker, alle genau einmal'); process.exit(0); }

const lauf = () => spawnSync(process.execPath, [path.join(TMP, 'tools/test-spind.js')], { env: Object.assign({}, process.env, { SPIND_ROOT: TMP }), encoding: 'utf8' });
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
process.exit(ueberlebt ? 1 : 0);
