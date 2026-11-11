'use strict';
// SPL-01 a3: gemeinsame Hilfen der Messwerkzeuge tools/messe-spl-*.js (kein Produktcode, liest nur).
//   args(argv, erlaubt) -> { flags, rest }     einfache Aufrufauswertung: --name wert / --name=wert / --flag; unbekannte Optionen -> Exit 2
//   weltstand(name)     -> Weltstand-Fixture aus tools/fixtures/context (Standard nach-tutorial)
//   anlass()            -> Anlass wie in den Spielleiter-Tests (missionsgrenze, crew 3)
//   tabelle(zeilen)     -> ausgerichtete Textspalten
//   kontextZuwachs(c)   -> { vorher, nachher, plus }  Formel von T13 (tools/test-spielleiter.js, SPL-01 a2: dort und in test-kontext-gelaende gemeinsam genutzt):
//                          Grobplan-Kontext ohne 'verfuegbar'; vorher = ohne die Felder von S2b/GEL-02 (FELDER, Landepunkte je Ort samt Zaehlzeile, Bewaffnung);
//                          Tokens = Zeichen / 2,5; plus = Zuwachs in Tokens
// Exit-Codes aller Werkzeuge: 0 = Messung gelaufen, 1 = Fehler beim Messen (Ausnahme, Modul fehlt), 2 = falscher Aufruf.
const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..', '..');
const CTX_DIR = path.join(WURZEL, 'tools', 'fixtures', 'context');

// erlaubt: { name: 'zahl' | 'text' | 'flag' }
function args(argv, erlaubt, hilfe) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--hilfe' || a === '-h') { console.log(hilfe); process.exit(0); }
    const m = /^--([\w-]+)(?:=(.*))?$/.exec(a);
    if (!m || !erlaubt[m[1]]) { console.error(`Unbekannte Option ${a}\n${hilfe}`); process.exit(2); }
    const art = erlaubt[m[1]];
    if (art === 'flag') { flags[m[1]] = true; continue; }
    const wert = m[2] !== undefined ? m[2] : argv[++i];
    if (wert === undefined) { console.error(`Option --${m[1]} braucht einen Wert\n${hilfe}`); process.exit(2); }
    if (art === 'zahl') {
      const n = Number(wert);
      if (!Number.isInteger(n) || n < 1) { console.error(`--${m[1]} erwartet eine ganze Zahl >= 1, bekam "${wert}"`); process.exit(2); }
      flags[m[1]] = n;
    } else flags[m[1]] = wert;
  }
  return flags;
}

const weltstand = (name) => JSON.parse(fs.readFileSync(path.join(CTX_DIR, `${name || 'nach-tutorial'}.weltstand.json`), 'utf8'));
const weltstaende = () => fs.readdirSync(CTX_DIR).filter((f) => f.endsWith('.weltstand.json')).sort().map((f) => [f.replace('.weltstand.json', ''), weltstand(f.replace('.weltstand.json', ''))]);
const anlass = () => ({ art: 'missionsgrenze', crew: 3, nach: 'm3', zielspieldauer_min: 12, auftraggeber: 'tesk' });
const clone = (o) => JSON.parse(JSON.stringify(o));
const tok = (o, faktor) => Math.round(JSON.stringify(o).length / (faktor || 2.5));

const KONTEXT_FELDER = ['bodenbilanz', 'kartenarten', 'fraktionen', 'gegner', 'rollen_gesehen'];
function kontextZuwachs(c) {
  const nachher = Object.assign({}, c); delete nachher.verfuegbar;
  const vorher = clone(nachher);
  for (const k of KONTEXT_FELDER) delete vorher[k];
  for (const o of vorher.orte) { delete o.landepunkte; delete o.landepunkte_mehr; }
  if (vorher.crew) delete vorher.crew.bewaffnung;
  const a = JSON.stringify(vorher).length; const b = JSON.stringify(nachher).length;
  return { vorher: Math.round(a / 2.5), nachher: Math.round(b / 2.5), plus: Math.round((b - a) / 2.5) };
}

function tabelle(zeilen) {
  const breite = [];
  for (const z of zeilen) z.forEach((c, i) => { breite[i] = Math.max(breite[i] || 0, String(c).length); });
  return zeilen.map((z) => z.map((c, i) => (i === z.length - 1 ? String(c) : String(c).padEnd(breite[i]))).join(' | '));
}

// Eine Messung als Hauptprogramm: fn() -> { text: [Zeilen], daten: Objekt }. Ohne --json Text, mit --json nur JSON.
// Ausnahmen -> Exit 1. exitCode statt exit(), damit gepipte Ausgabe vollstaendig geschrieben wird.
function laufen(name, flags, fn) {
  try {
    const erg = fn();
    if (flags.json) console.log(JSON.stringify(erg.daten, null, 1));
    else console.log(erg.text.join('\n'));
  } catch (e) {
    console.error(name + ': Fehler beim Messen: ' + (e && e.stack ? e.stack : e));
    process.exitCode = 1;
  }
}

module.exports = { KONTEXT_FELDER, kontextZuwachs, WURZEL, CTX_DIR, args, weltstand, weltstaende, anlass, clone, tok, tabelle, laufen };
