'use strict';
// SPL-01 a1: Mutationsprobe zu tools/test-pflichtsatz-gelaende.js. Je Lauf wird EINE Stelle der Erzeuger in einer Temp-Kopie der Quellen geändert (server, shared, content, package.json);
// der Test läuft dort und muss rot werden. Die Quelldateien im Repo werden nie angefasst (node_modules über NODE_PATH, keine Junction), ein Abbruch lässt shared/ unverändert.
// Die ersten fünf Mutationen fängt die feste Kontextprüfung des Tests (der Sweep wird dann übersprungen), die letzten beiden ändern den ERZEUGER und kann nur der Sweep fangen
// (Posten-Grenze 3 -> 2: die Karte trägt weniger Wachen als zugesagt). --trocken: nur prüfen, dass die Texte in den Quellen vorkommen.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const trocken = process.argv.includes('--trocken');
const MUTATIONEN = [
  ['shared/gen-gelaende.js', 'deckung: 4, wache: 3 }', 'deckung: 4 }', 'wache fehlt im Pflichtsatz der Wildnis'],
  ['shared/gen-hoehle.js', 'deckung: 4, wache: 3, abbau: 4', 'deckung: 4, abbau: 4', 'wache fehlt im Pflichtsatz der Höhle'],
  ['shared/gen-gelaende.js', 'deckung: 4, wache: 3 }', 'deckung: 4, wache: 2 }', 'wache nur min 2 (Wildnis)'],
  ['shared/gen-hoehle.js', 'wache: 3, abbau: 4', 'wache: 2, abbau: 4', 'wache nur min 2 (Höhle)'],
  ['shared/gen-gelaende.js', 'deckung: 4, wache: 3 }', 'deckung: 4, wache: 9 }', 'Zusage wache 9 (Kontextprüfung, Sweep übersprungen)'],
  ['shared/gen-gelaende.js', 'for (const p of kand) { if (posten.length >= 3) break;', 'for (const p of kand) { if (posten.length >= 2) break;', 'Erzeuger Wildnis: höchstens 2 Posten statt 3 (nur der Sweep fängt das)'],
  ['shared/gen-hoehle.js', 'for (const p of kand) { if (posten.length >= 3) break;', 'for (const p of kand) { if (posten.length >= 2) break;', 'Erzeuger Höhle: höchstens 2 Posten statt 3 (nur der Sweep fängt das)'],
];
const KOPIE = ['server', 'shared', 'content', 'package.json'];
const TEST = 'tools/test-pflichtsatz-gelaende.js';

function kopieren(ziel) {
  for (const p of KOPIE.concat([TEST])) {
    fs.mkdirSync(path.dirname(path.join(ziel, p)), { recursive: true });
    fs.cpSync(path.join(ROOT, p), path.join(ziel, p), { recursive: true });
  }
}
const lauf = (ziel) => spawnSync(process.execPath, [path.join(ziel, TEST)], { cwd: ziel, encoding: 'utf8', timeout: 240000, env: Object.assign({}, process.env, { NODE_PATH: path.join(ROOT, 'node_modules') }) });
let ueberlebt = 0;
const basis = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-pflichtsatz-'));
try {
  for (const [datei, alt, neu, was] of MUTATIONEN) {
    const orig = fs.readFileSync(path.join(ROOT, datei), 'utf8');
    if (!orig.includes(alt)) { console.log('FEHLT   ' + was + ' (' + datei + ')'); ueberlebt++; continue; }
    if (trocken) { console.log('ok      ' + was); continue; }
    const ziel = fs.mkdtempSync(path.join(basis, 'lauf-'));
    kopieren(ziel);
    fs.writeFileSync(path.join(ziel, datei), orig.replace(alt, () => neu));
    const r = lauf(ziel);
    const rot = r.status !== 0;
    const ausgabe = (r.stdout || '') + (r.stderr || '');
    const imSweep = /Sweep übersprungen/.test(ausgabe) ? 'Kontextprüfung' : 'Sweep';
    // Mutationen "nur der Sweep" zählen nur als getötet, wenn der Sweep (nicht die Kontextprüfung) rot wurde
    const richtig = rot && (!/nur der Sweep/.test(was) || imSweep === 'Sweep');
    console.log((richtig ? 'getötet ' : 'ÜBERLEBT ') + was + (rot ? ` [${imSweep}]` : '') + (richtig ? '' : '\n' + ausgabe.slice(-600)));
    if (!richtig) ueberlebt++;
  }
} finally { fs.rmSync(basis, { recursive: true, force: true }); }
// Gegenprobe: unveränderte Kopie muss grün sein (sonst wären alle "getötet" wertlos)
if (!trocken) {
  const ziel = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-pflichtsatz-ok-'));
  try {
    kopieren(ziel);
    const r = lauf(ziel);
    console.log(r.status === 0 ? 'Gegenprobe: unveränderte Kopie grün' : 'Gegenprobe FEHLGESCHLAGEN\n' + (r.stdout || '') + (r.stderr || ''));
    if (r.status !== 0) ueberlebt++;
  } finally { fs.rmSync(ziel, { recursive: true, force: true }); }
}
if (!trocken) console.log(ueberlebt ? `${ueberlebt} Mutation(en) überlebt` : 'alle Mutationen getötet');
process.exit(ueberlebt ? 1 : 0);
