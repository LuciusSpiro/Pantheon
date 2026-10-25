'use strict';
// SUND-04a-1 B: Daten der Geschichtsfaeden (Freie Fahrt Sund) und das Register der Fadenvorlagen. Reine Daten und Nachschlagen, kein Spielzustand.
//   WERTE / BEATS / NAMEN / HALTUNG   die Dateien in content/faeden/ (werte.json, beats.json, namen.json, haltung-werte.json), Zahlen als Werte (ohne einheit und _hinweis)
//   vorlage(id) / vorlagenIds()        gepruefte Vorlagen (nur was server/sim/faden-pruefer.js bestanden hat, ist hier; Ungueltiges wird nie gespielt)
//   registriere(v) -> { ok, fehler }   eine Vorlage pruefen und eintragen (Tiefenkopie, eingefroren); entferne(id); zuruecksetzen()  (Tests, Werkstatt)
//   ladeVerzeichnis(dir) -> { geladen: [id], fehler: [{ datei, fehler: [Text] }] }   alle *.json eines Verzeichnisses; Fehler landen auch in ladefehler() und (sobald ein Spiel laeuft) im Regie-Logbuch
//   Beim ersten Zugriff werden content/faeden/vorlagen/ und die Verzeichnisse aus FADEN_VORLAGEN_ZUSATZ (Pfade, getrennt mit path.delimiter) geladen. Eine neue Vorlage ist eine neue Datei: kein Code.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'content', 'faeden');
const lies = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const werteVon = (j) => Object.fromEntries(Object.entries(j.werte).map(([k, v]) => [k, v.wert]));

const WERTE = werteVon(lies('werte.json'));
const BEATS = lies('beats.json').beats;
const NAMEN = lies('namen.json').voelker;
const HALTUNG_DATEI = lies('haltung-werte.json');
const HALTUNG = werteVon(HALTUNG_DATEI);
const VORLAGEN_DIR = path.join(DIR, 'vorlagen');

const registry = new Map();   // id -> Vorlage (eingefroren)
let fehlerListe = [];         // Ladefehler { datei, fehler }
let geladen = false;

const tief = (x) => { if (x && typeof x === 'object') { for (const k of Object.keys(x)) tief(x[k]); Object.freeze(x); } return x; };

function registriere(v) {
  const P = require('./faden-pruefer.js');
  const r = P.pruefeVorlage(v);
  if (!r.ok) return { ok: false, fehler: r.fehler };
  registry.set(v.id, tief(JSON.parse(JSON.stringify(v))));
  return { ok: true, fehler: [] };
}
function ladeVerzeichnis(dir) {
  const out = { geladen: [], fehler: [] };
  let dateien = [];
  try { dateien = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch (e) { return out; }
  for (const f of dateien) {
    let v;
    try { v = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { out.fehler.push({ datei: f, fehler: ['JSON: ' + e.message] }); continue; }
    const r = registriere(v);
    if (r.ok) out.geladen.push(v.id); else out.fehler.push({ datei: f, fehler: r.fehler });
  }
  fehlerListe = fehlerListe.concat(out.fehler);
  return out;
}
function init() {
  if (geladen) return;
  geladen = true;
  ladeVerzeichnis(VORLAGEN_DIR);
  const env = process.env.FADEN_VORLAGEN_ZUSATZ;
  if (env) for (const d of String(env).split(path.delimiter).filter(Boolean)) ladeVerzeichnis(d);
}
const vorlage = (id) => { init(); return registry.get(id) || null; };
const vorlagenIds = () => { init(); return Array.from(registry.keys()).sort(); };
const entferne = (id) => { init(); registry.delete(id); };
const ladefehler = () => { init(); return fehlerListe.slice(); };
function zuruecksetzen() { registry.clear(); fehlerListe = []; geladen = false; }

module.exports = { WERTE, BEATS, NAMEN, HALTUNG, HALTUNG_DATEI, DIR, vorlage, vorlagenIds, registriere, entferne, ladeVerzeichnis, ladefehler, zuruecksetzen };
