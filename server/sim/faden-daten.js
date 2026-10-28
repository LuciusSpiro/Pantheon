'use strict';
// SUND-04a-1 B: Daten der Geschichtsfaeden (Freie Fahrt Sund) und das Register der Fadenvorlagen. Reine Daten und Nachschlagen, kein Spielzustand.
//   WERTE / BEATS / NAMEN / HALTUNG   die Dateien in content/faeden/ (werte.json, beats.json, namen.json, haltung-werte.json), Zahlen als Werte (ohne einheit und _hinweis)
//   vorlage(id) / vorlagenIds()        gepruefte Vorlagen (nur was server/sim/faden-pruefer.js bestanden hat, ist hier; Ungueltiges wird nie gespielt)
//   registriere(v) -> { ok, fehler }   eine Vorlage pruefen und eintragen (Tiefenkopie, eingefroren); entferne(id); zuruecksetzen()  (Tests, Werkstatt)
//   ladeVerzeichnis(dir) -> { geladen: [id], fehler: [{ datei, fehler: [Text] }] }   alle *.json eines Verzeichnisses; Fehler landen auch in ladefehler() und (sobald ein Spiel laeuft) im Regie-Logbuch
//   SUND-04b A1 Abenteuer: registriereAbenteuer(v) -> { ok, fehler, id } traegt eine expandierte Vorlage (Bauplan, faden-bauplan.js) in ein EIGENES Register ein (vorlage(id) findet sie, vorlagenIds() nie:
//   ein Abenteuer wird nie ueber einen Ausloeser angeboten); abenteuerId(v) = Praefix + Hash des Inhalts; istAbenteuer(id)
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
const BITTE = werteVon(lies('bitte-werte.json'));   // SUND-04a-2 P2: Bitten (faden-bitte.js): Zahlen, Texte, Weigerungen
const BAUPLAN_DATEI = lies('bauplan.json');   // SUND-04b A1: Daten des Expanders (Plan-Grenzen, Hinweis-Katalog, Wahrheiten)
const BAUPLAN = { werte: werteVon(BAUPLAN_DATEI), wahrheiten: BAUPLAN_DATEI.wahrheiten, hinweise: BAUPLAN_DATEI.hinweise };
const VORLAGEN_DIR = path.join(DIR, 'vorlagen');

const registry = new Map();   // id -> Vorlage (eingefroren)
const abenteuer = new Map();  // SUND-04b A1: id -> expandierte Vorlage eines Abenteuers (eingefroren)
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
// ---------- Abenteuer (SUND-04b A1): Vorlagen, die ein Plan beschreibt und die nicht als Datei vorliegen
const istObjekt = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
function kanonisch(x) {   // Schluessel sortiert: derselbe Inhalt ergibt dieselbe Zeichenfolge, egal in welcher Reihenfolge der Plan geschrieben wurde
  if (Array.isArray(x)) return '[' + x.map(kanonisch).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map((k) => JSON.stringify(k) + ':' + kanonisch(x[k])).join(',') + '}';
  return JSON.stringify(x);
}
function abenteuerId(v) {
  const o = Object.assign({}, v); delete o.id;
  return BAUPLAN.werte.id_praefix + require('crypto').createHash('sha1').update(kanonisch(o)).digest('hex').slice(0, BAUPLAN.werte.id_hash_laenge);
}
const istAbenteuer = (id) => typeof id === 'string' && id.startsWith(BAUPLAN.werte.id_praefix);
function registriereAbenteuer(v) {
  const P = require('./faden-pruefer.js');
  init();
  if (!istObjekt(v) || v.id !== abenteuerId(v)) return { ok: false, fehler: ['ABENTEUER_ID: die Id ist nicht Praefix ' + BAUPLAN.werte.id_praefix + ' + Hash des Inhalts'], id: null };
  if (registry.has(v.id)) return { ok: false, fehler: ['ABENTEUER_ID: die Id gehoert einer Vorlage der Dateien'], id: null };
  if (abenteuer.has(v.id)) return { ok: true, fehler: [], id: v.id };   // derselbe Inhalt, schon geprueft (nur Zeitersparnis: ohne diese Zeile gaebe dieselbe Pruefung dasselbe Ergebnis)
  const r = P.pruefeVorlage(v);
  if (!r.ok) return { ok: false, fehler: r.fehler, id: null };
  abenteuer.set(v.id, tief(JSON.parse(JSON.stringify(v))));
  return { ok: true, fehler: [], id: v.id };
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
  const kat = require('./faden-pruefer.js').katalogFehler();   // B-M1: der Beat-Katalog muss zum Gedächtnis-Schema passen; Verstöße landen in ladefehler() und im Regie-Logbuch
  if (kat.length) fehlerListe.push({ datei: 'beats.json', fehler: kat });
  ladeVerzeichnis(VORLAGEN_DIR);
  const env = process.env.FADEN_VORLAGEN_ZUSATZ;
  if (env) for (const d of String(env).split(path.delimiter).filter(Boolean)) ladeVerzeichnis(d);
}
const vorlage = (id) => { init(); return registry.get(id) || abenteuer.get(id) || null; };
const vorlagenIds = () => { init(); return Array.from(registry.keys()).sort(); };
const entferne = (id) => { init(); registry.delete(id); };
const ladefehler = () => { init(); return fehlerListe.slice(); };
function zuruecksetzen() { registry.clear(); abenteuer.clear(); fehlerListe = []; geladen = false; }

module.exports = { WERTE, BEATS, NAMEN, HALTUNG, HALTUNG_DATEI, BITTE, BAUPLAN, DIR, registriereAbenteuer, abenteuerId, istAbenteuer, vorlage, vorlagenIds, registriere, entferne, ladeVerzeichnis, ladefehler, zuruecksetzen };
