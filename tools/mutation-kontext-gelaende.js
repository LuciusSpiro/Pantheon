#!/usr/bin/env node
'use strict';
// SPL-01 a2: Mutationsprobe zu tools/test-kontext-gelaende.js. Je Lauf wird EINE Stelle in einer Temp-Kopie der Quellen geändert (server, shared, content,
// package.json und die Dateien, die der Test braucht); der Test läuft dort und muss rot werden. Die Quelldateien im Repo werden nie angefasst
// (node_modules über NODE_PATH, keine Junction). --trocken: nur prüfen, dass die Texte in den Quellen vorkommen.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const trocken = process.argv.includes('--trocken');
const MUTATIONEN = [
  ['shared/config.js', 'kontext: { gelaendeEinzeln: 1,', 'kontext: { gelaendeEinzeln: 99,', 'Deckel faktisch entfernt (Konfigurationswert 99)'],
  ['server/mission/context.js', 'for (const g of gel.slice(Math.max(0, kontextConfig().gelaendeEinzeln | 0))) {', 'for (const g of gel.slice(1e9)) {', 'gelaendeDeckeln schneidet nie ab'],
  ['server/mission/context.js', '(b.z - a.z) || (nr(b.id) - nr(a.id))', '(a.z - b.z) || (nr(a.id) - nr(b.id))', 'Reihenfolge umgekehrt (älteste bleiben einzeln)'],
  ['server/mission/context.js', 'weitere[g.ort] = (weitere[g.ort] || 0) + 1;', 'weitere[g.ort] = 1;', 'Zählzeile zählt nicht mit'],
  ['server/mission/context.js', ' && !!e && (e.besuche | 0) > 0;', ' && !!e;', 'auch nie betretene Landepunkte werden gedeckelt'],
  ['server/mission/context.js', 'kontextConfig().gelaendeArten.includes(d.art) && ', '', 'alle angelegten Landepunkte (auch Schiff) werden gedeckelt'],
  ['server/mission/context.js', '!!d && !d.kachel && ', '!!d && ', 'Kachel-Definitionen werden gedeckelt'],
  ['server/mission/context.js', "e.landepunkte_mehr = `+${weitere[l.id]} weitere Gelände-Karten besucht`;", '/* keine Zählzeile */', 'Zählzeile fehlt'],
  ['server/sim/landepunkte.js', 'e.zuletzt = 1 + Math.max(0, ...Object.values(st(game).eintraege).map((x) => x.zuletzt | 0));', '', 'betreten setzt keine Besuchsfolge'],
  ['server/sim/landepunkte.js', 'if (e.zuletzt > 0) o.zuletzt = e.zuletzt | 0;', '', 'toSave schreibt zuletzt nicht'],
  ['server/sim/landepunkte.js', 'if (b.zuletzt > 0) e.zuletzt = b.zuletzt | 0;', '', 'restore liest zuletzt nicht'],
];
const KOPIE = ['server', 'shared', 'content', 'package.json'];
const TOOLS = ['tools/test-kontext-gelaende.js', 'tools/lib/messe-spl.js', 'tools/fixtures/context'];

function kopieren(ziel) {
  for (const p of KOPIE.concat(TOOLS)) {
    fs.mkdirSync(path.dirname(path.join(ziel, p)), { recursive: true });
    fs.cpSync(path.join(ROOT, p), path.join(ziel, p), { recursive: true });
  }
}
let ueberlebt = 0;
const basis = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-kontext-'));
try {
  for (const [datei, alt, neu, was] of MUTATIONEN) {
    const orig = fs.readFileSync(path.join(ROOT, datei), 'utf8');
    if (!orig.includes(alt)) { console.log('FEHLT    ' + was + ' (' + datei + ')'); ueberlebt++; continue; }
    if (trocken) { console.log('ok       ' + was); continue; }
    const ziel = fs.mkdtempSync(path.join(basis, 'lauf-'));
    kopieren(ziel);
    fs.writeFileSync(path.join(ziel, datei), orig.replace(alt, neu));
    const env = Object.assign({}, process.env, { NODE_PATH: path.join(ROOT, 'node_modules') });
    const r = spawnSync(process.execPath, [path.join(ziel, 'tools', 'test-kontext-gelaende.js')], { cwd: ziel, encoding: 'utf8', env });
    const rot = r.status !== 0;
    console.log((rot ? 'getötet  ' : 'ÜBERLEBT ') + was + (rot ? '' : '\n' + (r.stdout || '') + (r.stderr || '')));
    if (!rot) ueberlebt++;
  }
} finally { fs.rmSync(basis, { recursive: true, force: true }); }
// Gegenprobe: unveränderte Kopie muss grün sein (sonst wären alle "getötet" wertlos)
if (!trocken) {
  const ziel = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-kontext-ok-'));
  try {
    kopieren(ziel);
    const r = spawnSync(process.execPath, [path.join(ziel, 'tools', 'test-kontext-gelaende.js')], { cwd: ziel, encoding: 'utf8', env: Object.assign({}, process.env, { NODE_PATH: path.join(ROOT, 'node_modules') }) });
    console.log(r.status === 0 ? 'Gegenprobe: unveränderte Kopie grün' : 'Gegenprobe FEHLGESCHLAGEN\n' + r.stdout + r.stderr);
    if (r.status !== 0) ueberlebt++;
  } finally { fs.rmSync(ziel, { recursive: true, force: true }); }
}
if (!trocken) console.log(ueberlebt ? `${ueberlebt} Mutation(en) überlebt` : 'alle Mutationen getötet');
process.exit(ueberlebt ? 1 : 0);
