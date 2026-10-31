'use strict';
// CHA-01 C: Mutationsprobe zu tools/test-charaktere.js. Kopiert shared/, content/katalog, charaktere.js und den Test in ein Temp-Verzeichnis (das Repo bleibt unberührt),
// ändert dort je Lauf EINE Regel und verlangt, dass der Test rot wird (Exit != 0). Überlebt eine Mutation, deckt der Test die Regel nicht ab.
//   node tools/mutation-charaktere.js [begriff …]      (npm run test:charaktere-mutation)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-muta-cha-'));
for (const rel of ['shared/charakter.js', 'content/katalog/charakter.json', 'public/js/charaktere.js', 'public/js/kammer-ui.js', 'public/js/art.js', 'tools/test-charaktere.js']) {
  fs.mkdirSync(path.dirname(path.join(TMP, rel)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, rel), path.join(TMP, rel));
}
const C = 'public/js/charaktere.js';
// [Datei, alter Text (genau einmal), neuer Text, Beschreibung]
const MUTATIONEN = [
  [C, "if (store.liste.length >= MAX) return { ok: false, grund: 'voll' };\n      const w = ", "if (store.liste.length >= MAX + 1) return { ok: false, grund: 'voll' };\n      const w = ", 'fünfter Charakter wird angenommen'],
  [C, "karte: Ch.pruefeKarte(e.karte, katalog) });", "karte: e.karte });", 'gelesene Karte wird nicht geprüft'],
  [C, "if (liste.length >= MAX) break;", "", 'Speicher mit zehn Einträgen wird ganz übernommen'],
  [C, "if (store.gewaehlt === id) store.gewaehlt = store.liste.length ?", "if (false) store.gewaehlt = store.liste.length ?", 'gewählten löschen lässt die Auswahl auf einer toten id'],
  [C, "if (s.loeschFrage !== c.id) {", "if (false) {", 'Löschen ohne Rückfrage'],
  [C, "const n = Ch.pruefeName(name);\n      if (!n) return { ok: false, grund: 'name' };\n      c.karte.name = n;", "const n = String(name);\n      c.karte.name = n;", 'Umbenennen nimmt ungültige Namen'],
  [C, "if (!e || e.modus !== 'neu' || !PLAETZE.includes(platz)) return { ok: false, grund: 'platz' };", "if (!e || !PLAETZE.includes(platz)) return { ok: false, grund: 'platz' };", 'Umbenennen darf das Aussehen ändern (Platzwahl)'],
  [C, "Ch.pruefeName(altName) || Ch.STANDARD_NAME", "String(altName)", 'ungültiger Altname wird nicht ersetzt'],
  [C, "if (store.liste.length) return { ok: true, quelle: 'vorhanden' };", "", 'Erststart legt trotz vorhandener Charaktere an'],
  [C, "if (!store.bereit) return { ok: false, grund: 'katalog' };\n      if (store.liste.length >= MAX) return { ok: false, grund: 'voll' };\n      const s = store.sitzung;", "if (!store.bereit) return { ok: false, grund: 'katalog' };\n      const s = store.sitzung;", 'Erstellung öffnet bei vier Charakteren'],
];
const filter = process.argv.slice(2);
let ueberlebt = 0, laeufe = 0;
const basis = spawnSync(process.execPath, [path.join(TMP, 'tools/test-charaktere.js')], { env: Object.assign({}, process.env, { CHARAKTERE_ROOT: TMP }), encoding: 'utf8' });
if (basis.status !== 0) { console.log('Ausgangslage ist schon rot:\n' + basis.stdout); process.exit(1); }
for (const [datei, alt, neu, was] of MUTATIONEN) {
  if (filter.length && !filter.some((f) => was.includes(f))) continue;
  const pfad = path.join(TMP, datei), orig = fs.readFileSync(path.join(ROOT, datei), 'utf8');
  const teile = orig.split(alt);
  if (teile.length !== 2) { console.log('KEIN EINZIGER TREFFER: ' + was + ' (' + (teile.length - 1) + ')'); ueberlebt++; continue; }
  fs.writeFileSync(pfad, teile.join(neu));
  const r = spawnSync(process.execPath, [path.join(TMP, 'tools/test-charaktere.js')], { env: Object.assign({}, process.env, { CHARAKTERE_ROOT: TMP }), encoding: 'utf8' });
  fs.writeFileSync(pfad, orig);
  laeufe++;
  if (r.status === 0) { ueberlebt++; console.log('ÜBERLEBT: ' + was); } else console.log('getötet:  ' + was);
}
console.log(`${laeufe} Mutationen, ${ueberlebt} überlebt`);
process.exit(ueberlebt ? 1 : 0);
