'use strict';
// SUND-04a-1 B: Daten der Geschichtsfaeden (Freie Fahrt Sund) und das Register der Fadenvorlagen. Reine Daten und Nachschlagen, kein Spielzustand.
//   WERTE / BEATS / NAMEN / HALTUNG   die Dateien in content/faeden/ (werte.json, beats.json, namen.json, haltung-werte.json), Zahlen als Werte (ohne einheit und _hinweis); B1 (SUND-04b B1) = b1-texte.json: werte, texte, spuren; B2 (SUND-04b B2) = b2-texte.json: werte, texte
//   vorlage(id) / vorlagenIds()        gepruefte Vorlagen (nur was server/sim/faden-pruefer.js bestanden hat, ist hier; Ungueltiges wird nie gespielt)
//   registriere(v) -> { ok, fehler }   eine Vorlage pruefen und eintragen (Tiefenkopie, eingefroren); entferne(id); zuruecksetzen()  (Tests, Werkstatt)
//   ladeVerzeichnis(dir) -> { geladen: [id], fehler: [{ datei, fehler: [Text] }] }   alle *.json eines Verzeichnisses; Fehler landen auch in ladefehler() und (sobald ein Spiel laeuft) im Regie-Logbuch
//   SUND-04b A1 Abenteuer: registriereAbenteuer(v) -> { ok, fehler, id } traegt eine expandierte Vorlage (Bauplan, faden-bauplan.js) in ein EIGENES Register ein (vorlage(id) findet sie, vorlagenIds() nie:
//   ein Abenteuer wird nie ueber einen Ausloeser angeboten); abenteuerId(v) = Praefix + Hash des Inhalts; istAbenteuer(id)
//   SUND-04b A2 Register-Aufraeumen: registriereAbenteuer(v, besitzer?) merkt, WER einen Eintrag braucht (ein Weltstand-Zustand der Faeden, schwach gehalten: ein beendetes Spiel haelt nichts fest); raeumeAbenteuerAuf(besitzer, plaene) stellt
//   sicher, dass alle genannten Plaene (laufende Faeden und offene Angebote dieses Besitzers) eingetragen sind, und gibt jeden Eintrag frei, den dieser Besitzer nicht mehr nennt; ein Eintrag faellt erst weg, wenn KEIN Besitzer ihn mehr braucht
//   (das Register gilt fuer den ganzen Prozess, mehrere Spiele teilen es). Eintraege ohne Besitzer (Tests, Werkstatt) bleiben bis zuruecksetzen().
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
const B1_DATEI = lies('b1-texte.json');   // SUND-04b B1: Zahlen und Texte der Bausteine geruecht, spur, wiedersehen (faden-b1.js)
const B1 = { werte: werteVon(B1_DATEI), texte: B1_DATEI.texte, spuren: B1_DATEI.spuren };
const B2_DATEI = lies('b2-texte.json');   // SUND-04b B2: Zahlen und Texte des Beats sabotage (faden-b2.js)
const B2 = { werte: werteVon(B2_DATEI), texte: B2_DATEI.texte };
const VORLAGEN_DIR = path.join(DIR, 'vorlagen');

const registry = new Map();   // id -> Vorlage (eingefroren)
const abenteuer = new Map();  // SUND-04b A1: id -> expandierte Vorlage eines Abenteuers (eingefroren)
const abenteuerBesitzer = new Map();   // SUND-04b A2: id -> { dauer: bool, refs: [WeakRef(Besitzer)] }
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
const BAUPLAN_PLAN_MAX = () => WERTE.abenteuer.plan_max_zeichen;
const istAbenteuer = (id) => typeof id === 'string' && id.startsWith(BAUPLAN.werte.id_praefix);
const PROTO_SCHLUESSEL = ['__proto__', 'constructor', 'prototype'];
// der Plan kommt von aussen (Spielleiter, gespeicherter Stand): tief nach Prototyp-Schluesseln absuchen (Object.assign und Schemas wuerden sie verschlucken oder aus dem Prototyp lesen)
function protoSchluessel(x, tiefe) {
  if (!x || typeof x !== 'object') return false;
  if (tiefe > 12) return true;
  for (const k of Object.keys(x)) if (PROTO_SCHLUESSEL.includes(k) || protoSchluessel(x[k], tiefe + 1)) return true;
  return false;
}
function besitzerMerken(id, besitzer) {
  let b = abenteuerBesitzer.get(id);
  if (!b) abenteuerBesitzer.set(id, b = { dauer: false, refs: [] });
  if (!besitzer || typeof besitzer !== 'object') { b.dauer = true; return; }
  if (!b.refs.some((r) => r.deref() === besitzer)) b.refs.push(new WeakRef(besitzer));
}
function registriereAbenteuer(v, besitzer) {
  const r = registriereAbenteuerOhneBesitzer(v);
  if (r.ok) besitzerMerken(r.id, besitzer);
  return r;
}
function registriereAbenteuerOhneBesitzer(v) {
  const P = require('./faden-pruefer.js');
  init();
  // vor Hash und Pruefer: Prototyp-Schluessel (ABENTEUER_FORM) und Groesse (ABENTEUER_GROESSE)
  if (istObjekt(v) && protoSchluessel(v, 0)) return { ok: false, fehler: ['ABENTEUER_FORM: der Plan enthaelt einen verbotenen Schluessel (__proto__, constructor, prototype)'], id: null };
  if (istObjekt(v)) {
    let zeichen = Infinity;
    try { zeichen = JSON.stringify(v).length; } catch (e) { /* unbrauchbar: gilt als zu gross */ }
    if (!(zeichen <= BAUPLAN_PLAN_MAX())) return { ok: false, fehler: ['ABENTEUER_GROESSE: der Plan ist groesser als ' + BAUPLAN_PLAN_MAX() + ' Zeichen'], id: null };
  }
  if (!istObjekt(v) || v.id !== abenteuerId(v)) return { ok: false, fehler: ['ABENTEUER_ID: die Id ist nicht Praefix ' + BAUPLAN.werte.id_praefix + ' + Hash des Inhalts'], id: null };
  if (registry.has(v.id)) return { ok: false, fehler: ['ABENTEUER_ID: die Id gehoert einer Vorlage der Dateien'], id: null };
  if (abenteuer.has(v.id)) return { ok: true, fehler: [], id: v.id };   // derselbe Inhalt, schon geprueft (nur Zeitersparnis: ohne diese Zeile gaebe dieselbe Pruefung dasselbe Ergebnis)
  const r = P.pruefeVorlage(v);
  if (!r.ok) return { ok: false, fehler: r.fehler, id: null };
  abenteuer.set(v.id, tief(JSON.parse(JSON.stringify(v))));
  return { ok: true, fehler: [], id: v.id };
}
// Register aufraeumen (SUND-04b A2). plaene = die Plaene, die dieser Besitzer noch braucht (laufende Faeden, offene Angebote). Jeder davon ist danach eingetragen (ein Plan, der fehlte, wird erneut geprueft und
// eingetragen: ein laufender Faden bricht nie). Jeder Eintrag, den dieser Besitzer frueher hielt und nicht mehr nennt, wird freigegeben; ohne weiteren Besitzer faellt er weg. Tote Besitzer (beendete Spiele) zaehlen nicht.
// -> { entfernt: n, behalten: n, fehler: [Text] }
function raeumeAbenteuerAuf(besitzer, plaene) {
  init();
  const fehler = [];
  const noetig = new Set();
  for (const p of Array.isArray(plaene) ? plaene : []) {
    if (!istObjekt(p) || typeof p.id !== 'string') continue;
    const r = registriereAbenteuer(p, besitzer);
    if (!r.ok) fehler.push(String(p.id).slice(0, 32) + ': ' + String(r.fehler[0]).slice(0, 80));
    else noetig.add(p.id);
  }
  let entfernt = 0;
  for (const id of Array.from(abenteuer.keys())) {
    const b = abenteuerBesitzer.get(id) || { dauer: true, refs: [] };
    b.refs = b.refs.filter((r) => { const o = r.deref(); return o !== undefined && !(o === besitzer && !noetig.has(id)); });
    if (!b.dauer && b.refs.length === 0) { abenteuer.delete(id); abenteuerBesitzer.delete(id); entfernt++; }
  }
  return { entfernt, behalten: abenteuer.size, fehler };
}
const abenteuerAnzahl = () => { init(); return abenteuer.size; };
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
function zuruecksetzen() { registry.clear(); abenteuer.clear(); abenteuerBesitzer.clear(); fehlerListe = []; geladen = false; }

module.exports = { WERTE, BEATS, NAMEN, HALTUNG, HALTUNG_DATEI, BITTE, BAUPLAN, B1, B2, DIR, registriereAbenteuer, raeumeAbenteuerAuf, abenteuerAnzahl, abenteuerId, istAbenteuer, vorlage, vorlagenIds, registriere, entferne, ladeVerzeichnis, ladefehler, zuruecksetzen };
