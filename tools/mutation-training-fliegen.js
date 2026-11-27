'use strict';
// TRA-01 D: Mutationsproben zu tools/test-training-fliegen.js. Jede Mutation bricht genau eine Zusicherung des Abzeichens Fliegen;
// der Test muss rot werden (Exit != 0), sonst ist er zu lasch. Die Datei wird nur für den Lauf geändert und im finally wiederhergestellt.
//   node tools/mutation-training-fliegen.js            alle Proben (je ein Testlauf, einige Sekunden)
//   node tools/mutation-training-fliegen.js --trocken  nur prüfen, dass jede Mutation anwendbar ist (Muster einmal gefunden, Datei ändert sich)
//   node tools/mutation-training-fliegen.js --nur <nr> eine Probe
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BUCH = 'content/regiebuecher/tra_fliegen.regiebuch.json';
const TRAINING = 'server/sim/training.js';

// Eine Mutation: { name, datei, aendern(text) -> neuer Text }
const ersetzen = (von, nach) => (t) => { const teile = t.split(von); if (teile.length !== 2) throw new Error('Muster nicht genau einmal gefunden: ' + von); return teile.join(nach); };
const buch = (f) => (t) => { const crlf = t.includes('\r\n'); const d = JSON.parse(t); f(d); const s = JSON.stringify(d, null, 2); return (crlf ? s.replace(/\n/g, '\r\n') : s) + (crlf ? '\r\n' : '\n'); };
const schritt = (d, id) => d.steps.find((s) => s.id === id);

const MUTATIONEN = [
  { name: 'Ziel entfällt: Allstopp wird übersprungen (a_ruder -> a_rolle)', datei: BUCH, aendern: ersetzen('"goto": "a_stopp"', '"goto": "a_rolle"') },
  { name: 'Flag trainingFertig wird nicht gesetzt', datei: BUCH, aendern: ersetzen('"trainingFertig": true', '"trainingFertig": false') },
  { name: 'Hinweis ohne Timer (a_hoch hat keinen Hänger-Hinweis mehr)', datei: BUCH, aendern: buch((d) => { const s = schritt(d, 'a_hoch'); s.timers = s.timers.filter((t) => !/^@hinweis\./.test(t.oda || '')); }) },
  { name: 'Hinweis feuert zu früh (a_hoch nach 3 s statt 45 s)', datei: BUCH, aendern: buch((d) => { const s = schritt(d, 'a_hoch'); s.timers.find((t) => t.oda === '@hinweis.hoch').at = 3; }) },
  { name: 'vorerkunden entfernt: kein Schnellsprung hafen -> b7', datei: TRAINING, aendern: ersetzen('vorerkunden: { hexe:', 'vorerkundenX: { hexe:') },
  { name: 'Abzeichen fehlt: Tabelle verweist auf ein unbekanntes Abzeichen', datei: TRAINING, aendern: ersetzen("sprachwahl: false, abzeichen: 'fliegen',", "sprachwahl: false, abzeichen: 'fliegenX',") },
  { name: 'Abfangen im Schnellsprung bleibt an (Tabellenfeld reise entfällt)', datei: TRAINING, aendern: ersetzen('reise: { feindChance: 0,', 'reiseX: { feindChance: 0,') },
  { name: 'Der Modus setzt das Sprungziel nicht (b_sprungpunkt ohne training_sprungziel)', datei: BUCH, aendern: buch((d) => { const s = schritt(d, 'b_sprungpunkt'); s.enter = s.enter.filter((a) => a.do !== 'training_sprungziel'); }) },
  { name: 'Rückweg ohne Sprungziel (b_rueckflug setzt das Ziel Hafen nicht)', datei: BUCH, aendern: buch((d) => { const s = schritt(d, 'b_rueckflug'); s.enter = s.enter.filter((a) => a.do !== 'training_sprungziel'); }) },
];

function lauf(m, i) {
  const pfad = path.join(ROOT, m.datei);
  const original = fs.readFileSync(pfad);
  try {
    const neu = m.aendern(original.toString('utf8'));
    if (neu === original.toString('utf8')) throw new Error('Mutation ändert nichts');
    fs.writeFileSync(pfad, neu);
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'test-training-fliegen.js')], { cwd: ROOT, encoding: 'utf8', timeout: 240000 });
    const rot = r.status !== 0;
    const erster = ((r.stdout || '').split('\n').find((z) => /FEHLER/.test(z)) || (r.stderr || '').split('\n').find((z) => z.trim()) || '').trim();
    return { rot, erster };
  } finally { fs.writeFileSync(pfad, original); }
}
function trocken(m) {
  const t = fs.readFileSync(path.join(ROOT, m.datei), 'utf8');
  const neu = m.aendern(t);
  if (neu === t) throw new Error('Mutation ändert nichts');
  return true;
}

function main(argv) {
  const nur = argv.includes('--nur') ? Number(argv[argv.indexOf('--nur') + 1]) : null;
  let rot = 0; let gesamt = 0; let schlecht = 0;
  MUTATIONEN.forEach((m, i) => {
    if (nur != null && nur !== i + 1) return;
    gesamt++;
    if (argv.includes('--trocken')) { try { trocken(m); rot++; console.log(`  anwendbar ${i + 1}: ${m.name}`); } catch (e) { schlecht++; console.log(`  FEHLER ${i + 1}: ${m.name}: ${e.message}`); } return; }
    const r = lauf(m, i);
    if (r.rot) { rot++; console.log(`  rot (gut)  ${i + 1}: ${m.name}\n             ${r.erster}`); } else { schlecht++; console.log(`  GRUEN (schlecht) ${i + 1}: ${m.name}`); }
  });
  console.log(`\n${argv.includes('--trocken') ? 'anwendbar' : 'rot'}: ${rot}/${gesamt}`);
  process.exit(schlecht ? 1 : 0);
}
if (require.main === module) main(process.argv.slice(2));
module.exports = { MUTATIONEN };
