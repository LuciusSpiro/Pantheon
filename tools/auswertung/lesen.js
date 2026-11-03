'use strict';
// TEL-01 D1: Protokoll einlesen. Nur I/O und Zaehlen, keine Kennzahlen (die macht kennzahlen.js als reine Funktion).
//   lesen(eingabe, opt)   eingabe = Dateipfad ODER Sessionkennung. Bei einer Kennung (oder einer Datei einer Session mit mehreren Teilen)
//                         werden alle Teile derselben Session in Reihenfolge gelesen: <kennung>.jsonl, dann <kennung>.2.jsonl, <kennung>.3.jsonl ...
//                         Der Schreiber (server/telemetrie/protokoll.js) schreibt heute genau eine Datei je Session; die Teile-Regel ist die
//                         vereinbarte Form fuer eine spaetere Rotation und wird hier und im Test schon bedient.
//   ausText(text, opt)    wie lesen, aber aus einem Text (Tests)
//   letzteKennung(dirs)   Kennung der juengsten Session in den Ordnern (Standard: data/telemetrie und data/telemetrie/bot)
//   ordnerSessions(dir)   TEL-01 D2: alle Sessions unter einem Ordner (rekursiv, ohne tuning/ und berichte/): [{ kennung, dir }], je Kennung einmal (Teile einer Session zaehlen als eine), nach Kennung sortiert
// Ergebnis: { kennung, dateien, zeilen, abgeschnitten, kaputt, unbekannt: {typ: n}, versionen: {v: n}, schemaOk, warnungen: [text] }
//   zeilen   alle gueltigen Zeilen in Dateireihenfolge (auch der Kopf und session_ende), unbekannte Typen eingeschlossen (kennzahlen.js ignoriert sie)
//   abgeschnitten  Zeilen am Dateiende ohne Zeilenumbruch, die kein JSON sind (Prozess hart beendet); kaputt  Zeilen mitten in der Datei, die kein JSON sind
// Ein Fehler beim Lesen einer einzelnen Zeile bricht nie ab: zaehlen, weiter.

const fs = require('fs');
const path = require('path');
const { SCHEMA } = require('../../server/telemetrie/schema.js');
const { SCHEMA_VERSION } = require('../../server/telemetrie/protokoll.js');

const ROOT = path.join(__dirname, '..', '..');
const STANDARD_DIRS = [path.join(ROOT, 'data', 'telemetrie'), path.join(ROOT, 'data', 'telemetrie', 'bot')];

function leer(kennung) {
  return { kennung, dateien: [], zeilen: [], abgeschnitten: 0, kaputt: 0, unbekannt: {}, versionen: {}, schemaOk: true, warnungen: [] };
}

// Text einer Datei (oder ein Textstueck) in das Ergebnis einlesen
function einlesen(erg, text, name) {
  const teile = text.split('\n');
  const endetMitUmbruch = text.endsWith('\n');
  for (let i = 0; i < teile.length; i++) {
    const l = teile[i].replace(/\r$/, '');
    if (!l.trim()) continue;
    let z = null;
    try { z = JSON.parse(l); } catch (e) { z = undefined; }
    const letzte = i === teile.length - 1 && !endetMitUmbruch;
    if (z === undefined || z === null || typeof z !== 'object' || typeof z.typ !== 'string') {
      if (letzte) erg.abgeschnitten++; else erg.kaputt++;
      continue;
    }
    erg.zeilen.push(z);
    erg.versionen[z.v] = (erg.versionen[z.v] || 0) + 1;
    if (!Object.prototype.hasOwnProperty.call(SCHEMA, z.typ)) erg.unbekannt[z.typ] = (erg.unbekannt[z.typ] || 0) + 1;
  }
}
function abschluss(erg) {
  const falsch = Object.keys(erg.versionen).filter((v) => String(v) !== String(SCHEMA_VERSION));
  if (falsch.length) { erg.schemaOk = false; erg.warnungen.push('Schema-Version ' + falsch.join(', ') + ' statt ' + SCHEMA_VERSION + ' (Auswertung kann Felder falsch deuten)'); }
  if (erg.zeilen.length && !erg.zeilen.some((z) => z.typ === 'kopf')) erg.warnungen.push('kein Sessionkopf in den Zeilen');
  if (erg.zeilen.length && !erg.zeilen.some((z) => z.typ === 'session_ende')) erg.warnungen.push('kein session_ende (Session nicht sauber beendet)');
  return erg;
}

function ausText(text, opt) {
  const erg = leer((opt && opt.kennung) || null);
  einlesen(erg, String(text), 'text');
  const k = erg.zeilen.find((z) => z.typ === 'kopf');
  if (!erg.kennung && k) erg.kennung = k.sitzung || null;
  return abschluss(erg);
}

// Teile einer Session in einem Ordner: [{ n, datei }] sortiert (Basisdatei zuerst)
function teile(dir, kennung) {
  const out = [];
  let namen = [];
  try { namen = fs.readdirSync(dir); } catch (e) { return out; }
  const re = new RegExp('^' + kennung.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\.(\\d+))?\\.jsonl$');
  for (const n of namen) { const m = re.exec(n); if (m) out.push({ n: m[1] ? Number(m[1]) : 1, datei: path.join(dir, n) }); }
  return out.sort((a, b) => a.n - b.n);
}
// Kennung und Ordner zu einer Datei: <kennung>.jsonl oder <kennung>.<n>.jsonl (die Sitzung enthaelt nie einen Punkt)
function kennungVon(datei) {
  const m = /^(.*?)(?:\.\d+)?\.jsonl$/.exec(path.basename(datei));
  return m ? m[1] : path.basename(datei, '.jsonl');
}

function finden(eingabe, dirs) {
  if (fs.existsSync(eingabe) && fs.statSync(eingabe).isFile()) {
    const dir = path.dirname(path.resolve(eingabe));
    const kennung = kennungVon(eingabe);
    const t = teile(dir, kennung);
    return { kennung, dateien: t.length ? t.map((x) => x.datei) : [path.resolve(eingabe)] };
  }
  const kennung = kennungVon(String(eingabe));
  for (const dir of dirs || STANDARD_DIRS) {
    const t = teile(dir, kennung);
    if (t.length) return { kennung, dateien: t.map((x) => x.datei) };
  }
  return null;
}

function lesen(eingabe, opt) {
  const f = finden(eingabe, opt && opt.dirs);
  if (!f) throw new Error('Session nicht gefunden: ' + eingabe);
  const erg = leer(f.kennung);
  for (const datei of f.dateien) { erg.dateien.push(datei); einlesen(erg, fs.readFileSync(datei, 'utf8'), datei); }
  return abschluss(erg);
}

function letzteKennung(dirs) {
  let best = null;
  for (const dir of dirs || STANDARD_DIRS) {
    let namen = [];
    try { namen = fs.readdirSync(dir); } catch (e) { continue; }
    for (const n of namen) {
      if (!n.endsWith('.jsonl')) continue;
      try { const m = fs.statSync(path.join(dir, n)).mtimeMs; if (!best || m > best.m) best = { m, kennung: kennungVon(n), dir }; } catch (e) { /* weg */ }
    }
  }
  return best ? best.kennung : null;
}

// Alle Sessions unter einem Ordner. Die Teile einer rotierten Session (<kennung>.2.jsonl ...) sind eine Session; lesen(kennung, { dirs: [dir] }) liest alle Teile.
const OHNE_ORDNER = new Set(['tuning', 'berichte']);
function ordnerSessions(dir) {
  const out = [];
  const geh = (d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    const hier = new Set();
    for (const e of ents) {
      if (e.isDirectory()) { if (!OHNE_ORDNER.has(e.name)) geh(path.join(d, e.name)); }
      else if (e.name.endsWith('.jsonl')) hier.add(kennungVon(e.name));
    }
    for (const kennung of hier) out.push({ kennung, dir: d });
  };
  geh(path.resolve(dir));
  return out.sort((a, b) => (a.kennung < b.kennung ? -1 : a.kennung > b.kennung ? 1 : 0));
}

module.exports = { lesen, ausText, letzteKennung, kennungVon, ordnerSessions, STANDARD_DIRS };
