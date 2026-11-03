'use strict';
// GEG-01 D: Mutationsprobe zu tools/test-tutorial-sprung.js. Kopiert Server, Shared, Content, public und den Test in ein Temp-Verzeichnis
// (das Repo bleibt unberührt), ändert dort je Lauf EINE Regel und verlangt, dass der Test rot wird (Exit 1 MIT FEHLER-Zeile; ein Absturz zählt nicht).
// Jeder Anker muss genau einmal im Quelltext stehen (sonst Exit 2). --trocken prüft nur die Anker.
//   node tools/mutation-tutorial-sprung.js [--trocken] [begriff …]      (npm run test:tutorial-sprung-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-tutsprung-'));
for (const rel of ['server', 'shared', 'content', 'public']) fs.cpSync(path.join(ROOT, rel), path.join(TMP, rel), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'tools', 'test-tutorial-sprung.js'), path.join(TMP, 'tools', 'test-tutorial-sprung.js'));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(TMP, 'package.json'));
if (fs.existsSync(path.join(ROOT, 'node_modules'))) { try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(TMP, 'node_modules'), 'junction'); } catch (e) { /* kein Modul nötig */ } }

const SP = 'server/sim/sprung.js', RE = 'server/sim/reise.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  [RE, "!sprung().tutorialZielErlaubt(game, n)) continue;\n      const id = Sektoren.kanteId(h, n);\n      if (!ex.bojeBekannt(id) || !ex.kanteOffen(id)) continue;", "!sprung().tutorialZielErlaubt(game, n)) continue;\n      const id = Sektoren.kanteId(h, n);\n      if (!ex.bojeBekannt(id)) continue;", 'planen: Sperrprüfung kanteOffen entfernt (Wolfstor ohne Sperrriegel per Schnellsprung)'],
  [SP, "if (!ex.kanteOffen(id)) { const t = Sektoren.sperrtext(ziel); return t || 'Sprungpunkt gesperrt.'; }", "", 'hexGrund: Sperre geschlossener Kanten entfernt (Sperrriegel, Wolfstor)'],
  [SP, "  return !d || d.region === 'saumraum';", "  return true;", 'tutorialZielErlaubt: Saumraum-Grenze entfernt'],
  [RE, "sprung().hexGrund(game, here, next) || (ort && (game.mission.destBlocked(ort) || game.mission.jumpBlocked(ort)));", "(ort && game.mission.jumpBlocked(ort));", 'Hop: hexGrund und destBlocked entfernt'],
  [RE, "game.mission.destBlocked(ort) || game.mission.jumpBlocked(ort)", "game.mission.jumpBlocked(ort)", 'Hop: destBlocked entfernt'],
  [SP, "|| game.mission.destBlocked(ort)) continue;", ") continue;", 'Automatik: destBlocked entfernt'],
  [SP, "  if (!tutorialZielErlaubt(game, ziel)) return 'Außerhalb des Saumraums gesperrt – erst das Tutorial abschließen.';\n  if (temp) return null;", "  if (temp) return null;", 'hexGrund: Tutorial-Regionsgrenze entfernt (Automatik, Zielwahl, Hop)'],
  [SP, "  if (!tutorialZielErlaubt(game, ziel)) return 'Außerhalb des Saumraums gesperrt – erst das Tutorial abschließen.';\n  let schnell", "  let schnell", 'selectDest: Tutorial-Regionsgrenze entfernt'],
  [SP, "  if (nah && nah.ort !== (routeDest || id)) game._jumpSperre = nah.id;", "", 'selectDest: Wahl des Captains gegen die Automatik nicht abgesichert'],
  [SP, "  c = c.filter((h) => tutorialZielErlaubt(game, h));", "", 'Notsprung: Saumraum-Filter entfernt'],
];

const trocken = process.argv.includes('--trocken');
const filter = process.argv.slice(2).filter((a) => a !== '--trocken');
const lies = (datei) => fs.readFileSync(path.join(ROOT, datei), 'utf8').replace(/\r\n/g, '\n');
let fehlAnker = 0;
for (const [datei, alt, , was] of MUTATIONEN) { const t = lies(datei).split(alt).length - 1; if (t !== 1) { console.log('ANKER ' + t + 'x: ' + was); fehlAnker++; } }
if (fehlAnker) process.exit(2);
if (trocken) { console.log(MUTATIONEN.length + ' Anker, alle genau einmal'); process.exit(0); }

const lauf = () => spawnSync(process.execPath, [path.join(TMP, 'tools/test-tutorial-sprung.js')], { env: Object.assign({}, process.env, { TUTSPRUNG_ROOT: TMP }), encoding: 'utf8' });
const basis = lauf();
if (basis.status !== 0) { console.log('Basis ist nicht grün (Exit ' + basis.status + ')'); process.exit(2); }
let nichtErkannt = 0;
for (const [datei, alt, neu, was] of MUTATIONEN) {
  if (filter.length && !filter.some((f) => was.includes(f))) continue;
  const f = path.join(TMP, datei);
  const orig = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, orig.replace(/\r\n/g, '\n').replace(alt, () => neu));
  const r = lauf();
  fs.writeFileSync(f, orig);
  const erkannt = r.status === 1 && /FEHLER/.test(r.stdout);
  console.log((erkannt ? 'erkannt   ' : 'NICHT ERKANNT ') + was + (erkannt ? '' : ' (Exit ' + r.status + ')'));
  if (!erkannt) nichtErkannt++;
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log(nichtErkannt ? nichtErkannt + ' Mutation(en) nicht erkannt' : 'alle Mutationen erkannt');
process.exit(nichtErkannt ? 1 : 0);
