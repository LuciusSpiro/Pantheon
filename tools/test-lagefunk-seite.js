'use strict';
// FRE-04b: Lagefunk nennt die Seite (B1) und die Auswahl der Übersichtskarte folgt der Lerche (B6)
//   Hafen/Posten x Rom verliert / Rom gewinnt / ohne Rom: Text, Logzeile, Pool-Kennung (nur bei Roms Verlust)
//   KarteLage.auswahlFolgen: folgt dem Anker, manuelle Auswahl gilt bis sich der Anker ändert
//   node tools/test-lagefunk-seite.js
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const Wissen = require('../server/sim/kriegslage-wissen.js');
const KL = require('../public/js/karte-lage.js');

let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const d = { hex: { '0403': { name: 'Speculum' }, '0603': { name: 'Kantenstein' } } };
const hf = (f, eigen) => Wissen.funkVerlust(d, 5, { e: 'hf', h: '0403', f, eigen });
const pv = (f, dd) => Wissen.funkVerlust(d, 5, { e: 'pv', h: '0603', f, d: dd, eigen: f === 'r' });

console.log('\nHafen');
let v = hf('g', true);
ok(v.text === 'Speculum ist an die Germanen gefallen.' && v.romVerliert === true && v.log === 'Gefallen an die Germanen. Tick 5.', 'Rom verliert: „… ist an die Germanen gefallen.“, Pool erlaubt');
v = hf('k', true); ok(v.text === 'Speculum ist an das Konkordat gefallen.', 'Rom verliert an das Konkordat');
v = hf('r', true);
ok(v.text === 'Speculum ist in römischer Hand.' && v.romVerliert === false && !/gefallen|verloren/.test(v.text + v.log), 'Rom gewinnt: „… ist in römischer Hand.“, kein Pool, kein „gefallen/verloren“');
v = hf('p', false);
ok(v.text === 'Speculum hat einen neuen Herrn: Piraten.' && v.romVerliert === false, 'ohne Rom: neuer Herr genannt, kein Pool');

console.log('\nPosten');
v = pv('r', 'g');
ok(v.text === 'Posten Kantenstein an die Germanen verloren.' && v.romVerliert === true, 'römischer Posten verloren an die Germanen, Pool erlaubt');
v = pv('r', '-'); ok(v.text === 'Posten Kantenstein verloren.' && v.romVerliert === true, 'römischer Posten, Gegenseite unbekannt: schlichte Fassung');
v = pv('g', 'r');
ok(v.text === 'Posten Kantenstein (Germanen) durch Rom ausgeschaltet.' && v.romVerliert === false && !/gefallen|verloren/.test(v.text + v.log), 'Rom nimmt fremden Posten: kein „verloren“, kein Pool');
v = pv('g', 'p'); ok(v.text === 'Posten Kantenstein (Germanen) durch die Piraten ausgeschaltet.' && v.romVerliert === false, 'fremd gegen fremd: beide Seiten genannt');
v = pv('g', '-'); ok(v.text === 'Posten Kantenstein (Germanen) ausgeschaltet.', 'fremd, Sieger unbekannt');

console.log('\nAuswahl folgt der Lerche (B6)');
const zs = { sel: null, manuell: false, anker: null };
const gilt = () => true;
ok(KL.auswahlFolgen(zs, 'ostia', gilt) && zs.sel === 'ostia', 'erste Belegung: Ort der Lerche');
ok(!KL.auswahlFolgen(zs, 'ostia', gilt) && zs.sel === 'ostia', 'unverändert: keine Änderung');
ok(KL.auswahlFolgen(zs, 'gull', gilt) && zs.sel === 'gull', 'Lerche wechselt, nichts angeklickt: Auswahl folgt');
zs.sel = 'eis'; zs.manuell = true;
ok(!KL.auswahlFolgen(zs, 'gull', gilt) && zs.sel === 'eis' && zs.manuell, 'manuelle Auswahl bleibt, solange der Anker gleich ist');
ok(KL.auswahlFolgen(zs, 'skj', gilt) && zs.sel === 'skj' && !zs.manuell, 'Ort/Sprungziel der Lerche ändert sich: Auswahl folgt wieder');
zs.sel = 'weg'; zs.manuell = true;
ok(KL.auswahlFolgen(zs, 'skj', (id) => id !== 'weg') && zs.sel === 'skj', 'manuelle Auswahl nicht mehr gültig: zurück zur Lerche');

console.log('\nBeschriftung');
const rec = [];
const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? (s) => ({ width: String(s).length * 5 }) : typeof k === 'string' && k !== 'canvas' ? (k === 'fillText' ? (s) => rec.push(String(s)) : () => {}) : undefined), set: () => true });
const A = { stufe: () => 'jetzt', hex: {}, fl: [], m: [], neu: new Set(), codes: [] };
const o = (sel, hier) => ({ rx: 0, y: 0, rw: 200, sel, hier, name: (h) => h, art: () => '', hafen: () => '', karteFraktion: () => '-', dist: () => undefined, maxZeilen: 4, verborgen: () => false });
KL.env.Render = { text: (c, s) => rec.push(String(s)), measure: (s) => String(s).length * 6 };
try {
  rec.length = 0; KL.ortsinfo(ctx, A, o('0403', '0403'));
  ok(rec.some((s) => s.startsWith('ORT · SEKTOR 0403')), 'Auswahl = Lerchenort: „ORT“');
  rec.length = 0; KL.ortsinfo(ctx, A, o('0403', '1003'));
  ok(rec.some((s) => s.startsWith('AUSWAHL · SEKTOR 0403')), 'Auswahl anderswo: „AUSWAHL“');
} catch (e) { ok(false, 'ortsinfo mit Zeichen-Stub: ' + e.message); }

console.log(fails ? `\n${fails} FEHLER` : '\nalle ok');
process.exit(fails ? 1 : 0);
