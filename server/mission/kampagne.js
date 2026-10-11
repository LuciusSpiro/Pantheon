'use strict';
// EK8 Kapitelsteuerung: die feste Kampagnenkette (content/kampagne/<id>.json, Format kampagne/1).
//   Kampagne.laden(id?)            -> Kettendefinition (geprüft, gecacht) bzw. null
//   Kampagne.pruefen(doc, ctx?)    -> { ok, errors: [{ code, p, msg }], warnings }   (tools/check-kette.js)
//   Kampagne.platzhalter(doc?, books?) -> [{ kapitel, buch, schritt, echt }]   noch nicht echt umgesetzte Szenen
//   new Kette(mission, doc)        Laufzeit: Kapitel starten, Ausgänge auswerten, wiederholen, Ende, Laden, Einstieg
// Die Kette ist ein dünner Aufsatz auf der Regiebuch-Engine (server/sim/mission.js): jedes Kapitel ist ein Regiebuch
// (kopf.art 'kapitel'); die Kette startet das nächste Buch, wenn das aktuelle mit einem Ausgang endet. Fortschritt gibt es nur
// über Ausgänge, also erreichte Missionsziele; es gibt keinen Spielleiter und keine Schnellroute.
// Zustand im Weltstand (kein neues Schema): Fakten kampagne, kapitel, kapitel_nr, kapitel_buch, kampagne_ende; die Bücher
// selbst (aktiv/erledigt, Schritt, Flags) speichert die Engine (mission.toSave). Gespeichert wird bei jedem Missionsende
// (game.markSaveDue('missionDone')), also an jedem Kapitelübergang, und beim Andocken.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'content', 'kampagne');
const SCHEMA_FILE = path.join(DIR, 'kampagne.schema.json');
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const ENDE = 'ende';
const FACT_SRC = 'kette';

let schemaCache = null;
const schema = () => schemaCache || (schemaCache = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8')));
const cache = {};

function dateien() {
  try { return fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'kampagne.schema.json').sort(); } catch (e) { return []; }
}
// Ohne Prüfung lesen (Prüfer, Werkzeuge)
function lesen(id) {
  const f = path.join(DIR, id + '.json');
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
function laden(id, reload) {
  id = id || 'eisenwald';
  if (cache[id] && !reload) return cache[id].doc;
  let doc = null;
  try { doc = lesen(id); } catch (e) { console.error(`[Pantheon] Kampagne '${id}' nicht lesbar: ${e.message}`); cache[id] = { doc: null }; return null; }
  const r = pruefen(doc);
  if (!r.ok) {
    console.error(`[Pantheon] Kampagne '${id}' ungültig – wird nicht angeboten:`);
    for (const e of r.errors.slice(0, 8)) console.error(`  ${e.code} ${e.p}: ${e.msg}`);
    doc = null;
  }
  cache[id] = { doc };
  return doc;
}
function alleIds() { return dateien().map((f) => f.replace(/\.json$/, '')); }
function buecherVon(ch) { return Array.isArray(ch.buecher) && ch.buecher.length ? ch.buecher : [ch.id]; }

// ---------------------------------------------------------------------------------------------------------------
// Prüfer
function folgenListe(f) { return Array.isArray(f) ? f : [f]; }
function flagsGesetzt(book) {
  const Checker = require('./checker.js');
  const out = new Set();   // nur, was das Buch selbst setzt (erwartet = Standardwerte zählt nicht)
  const sammle = (list) => Checker.eachAction(list, {}, (a) => { if (isObj(a.setFlag)) for (const k of Object.keys(a.setFlag)) out.add(k); });
  for (const s of book.steps || []) {
    for (const f of s.liefert_flags || []) out.add(f);
    for (const [, list] of Checker.stepActionLists(s)) sammle(list);
  }
  for (const acts of Object.values(book.on || {})) sammle(acts);
  for (const ag of Object.values(book.ausgaenge || {})) { sammle(ag.folgen); sammle(ag.danach); }
  return out;
}
function pruefen(doc, ctxIn) {
  const Checker = require('./checker.js');
  const Loader = require('./loader.js');
  const errors = []; const warnings = [];
  const E = (code, p, msg) => errors.push({ code, p, msg });
  const W = (code, p, msg) => warnings.push({ code, p, msg });
  const done = () => ({ ok: !errors.length, errors, warnings });
  for (const [p, m] of Checker.validate(doc, schema())) E('SCHEMA', p, m);
  if (!isObj(doc) || !Array.isArray(doc.kapitel)) return done();
  const books = (ctxIn && ctxIn.books) || Loader.loadAll().books;
  const L = require('../../shared/locations.js');
  let GEN = [];
  try { GEN = typeof L.get === 'function' ? require('../../shared/sektoren.js').datenOrte().map((id) => L.get(id)).filter(Boolean) : []; } catch (e) { GEN = []; }
  const ortIds = new Set(L.LOCATIONS.concat(GEN).map((l) => l.id));
  const links = new Set(['sperrriegel'].concat((L.LOCKED_LINKS || []).map((l) => l.key)));
  try { for (const k of require('../../shared/sektoren.js').KARTE.kanten.map((x) => x.key).filter(Boolean)) links.add(k); } catch (e) { /* ohne Kartendaten */ }
  const Kap = new Map();
  doc.kapitel.forEach((c, i) => {
    if (Kap.has(c.id)) E('KETTE-DOPPELT', `kapitel[${i}]`, `Kapitel '${c.id}' doppelt`);
    Kap.set(c.id, c);
  });
  const nrs = doc.kapitel.map((c) => c.nr);
  nrs.forEach((n, i) => { if (n !== i + 1) E('KETTE-NR', `kapitel[${i}].nr`, `Kapitelnummern müssen fortlaufend ab 1 stehen (hier ${n}, erwartet ${i + 1})`); });
  if (!Kap.has(doc.start)) E('KETTE-ZIEL', 'start', `Startkapitel '${doc.start}' gibt es nicht`);
  const bookOf = new Map();   // Buch -> Kapitel
  doc.kapitel.forEach((c, i) => {
    const p = `kapitel[${i}:${c.id}]`;
    if (!ortIds.has(c.ort)) E('REF-ORT', `${p}.ort`, `Ort '${c.ort}' gibt es nicht`);
    const bl = buecherVon(c);
    bl.forEach((b, bi) => {
      if (bookOf.has(b)) E('KETTE-DOPPELT', `${p}.buecher`, `Buch '${b}' steht schon in Kapitel '${bookOf.get(b).id}'`);
      bookOf.set(b, c);
      const book = books[b];
      if (!book) { E('KETTE-BUCH', `${p}.buecher[${bi}]`, `Regiebuch '${b}' fehlt oder ist ungültig (content/regiebuecher)`); return; }
      if (!book.kopf || book.kopf.art !== 'kapitel') E('KETTE-BUCH', `${p}.buecher[${bi}]`, `Regiebuch '${b}' braucht kopf.art 'kapitel' (ist '${book.kopf && book.kopf.art}')`);
      const aus = Object.keys(book.ausgaenge || {});
      if (!aus.includes('erfolg')) E('KETTE-ERFOLG', `${p}.buecher[${bi}]`, `Buch '${b}' hat keinen Ausgang 'erfolg' – ohne ihn gibt es keinen Fortschritt`);
      if (bi < bl.length - 1) return;
      // letztes Buch: jeder Ausgang des Buchs braucht eine Folge, jede Folge einen Ausgang
      for (const a of aus) if (!(a in c.ausgaenge)) E('KETTE-AUSGANG-FEHLT', `${p}.ausgaenge`, `Ausgang '${a}' von Buch '${b}' hat keine Folge – jede Szene braucht einen Weg weiter`);
      for (const a of Object.keys(c.ausgaenge || {})) if (!aus.includes(a)) E('KETTE-AUSGANG-UNBEKANNT', `${p}.ausgaenge.${a}`, `Buch '${b}' kennt keinen Ausgang '${a}'`);
    });
    // Folgen
    for (const [a, f] of Object.entries(c.ausgaenge || {})) {
      const fl = folgenListe(f);
      fl.forEach((x, k) => {
        const fp = `${p}.ausgaenge.${a}${Array.isArray(f) ? `[${k}]` : ''}`;
        const n = (x.weiter ? 1 : 0) + (x.wiederholen ? 1 : 0);
        if (n !== 1) E('KETTE-FOLGE', fp, "Eine Folge hat genau eines von 'weiter' oder 'wiederholen'");
        if (x.weiter && x.weiter !== ENDE && !Kap.has(x.weiter)) E('KETTE-ZIEL', `${fp}.weiter`, `Kapitel '${x.weiter}' gibt es nicht`);
        if (x.weiter && a !== 'erfolg') E('KETTE-FORTSCHRITT', fp, `'weiter' nur aus dem Ausgang 'erfolg' (Fortschritt nur durch erreichte Ziele); '${a}' muss die Szene wiederholen`);
        if (x.wiederholen && a === 'erfolg') E('KETTE-FORTSCHRITT', fp, "'erfolg' darf nicht wiederholen");
        if (k < fl.length - 1 && x.wenn === undefined) E('KETTE-FOLGE', fp, "Nur die letzte Folge darf ohne 'wenn' stehen");
      });
      const last = fl[fl.length - 1];
      if (last && last.wenn !== undefined) E('KETTE-FOLGE', `${p}.ausgaenge.${a}`, "Die letzte Folge braucht eine Rückfallfolge ohne 'wenn' (jede Szene hat einen Ausgang)");
    }
    // Einstieg
    const ei = c.einstieg || {};
    if (!ortIds.has(ei.ort)) E('REF-ORT', `${p}.einstieg.ort`, `Ort '${ei.ort}' gibt es nicht`);
    for (const k of ei.oeffnet || []) if (!links.has(k)) E('KETTE-EINSTIEG', `${p}.einstieg.oeffnet`, `Schlüssel '${k}' ist keine bekannte Sprungkante`);
    // Platzhalter: Schritt-IDs gegen steps[].platzhalter
    const phSchritte = [];
    for (const b of bl) for (const s of (books[b] && books[b].steps) || []) if (s.platzhalter) phSchritte.push(s.id);
    for (const sid of c.platzhalter || []) if (!phSchritte.includes(sid)) E('KETTE-PLATZHALTER', `${p}.platzhalter`, `Schritt '${sid}' ist in den Büchern nicht als platzhalter markiert`);
    for (const sid of phSchritte) { if (!(c.platzhalter || []).includes(sid)) W('KETTE-PLATZHALTER', `${p}.platzhalter`, `Schritt '${sid}' ist als platzhalter markiert, steht aber nicht in der Kapitelliste`); }
  });
  // Erreichbarkeit und Ende
  const nach = (c) => { const r = new Set(); for (const f of Object.values(c.ausgaenge || {})) for (const x of folgenListe(f)) if (x.weiter) r.add(x.weiter); return r; };
  const reach = new Set(); const todo = [doc.start];
  while (todo.length) { const id = todo.pop(); if (reach.has(id) || !Kap.has(id)) continue; reach.add(id); for (const t of nach(Kap.get(id))) todo.push(t); }
  for (const c of doc.kapitel) {
    if (!reach.has(c.id)) E('KETTE-UNERREICHBAR', `kapitel.${c.id}`, `Kapitel '${c.id}' ist vom Start aus nicht erreichbar`);
    // vom Kapitel aus muss das Ende erreichbar sein
    const seen = new Set(); const st = [c.id]; let ok = false;
    while (st.length && !ok) { const id = st.pop(); if (seen.has(id)) continue; seen.add(id); const k = Kap.get(id); if (!k) continue; for (const t of nach(k)) { if (t === ENDE) ok = true; else st.push(t); } }
    if (!ok) E('KETTE-KEIN-ENDE', `kapitel.${c.id}`, `Vom Kapitel '${c.id}' aus ist das Ende nicht erreichbar`);
  }
  // Flags: was ein Buch von früheren Kapiteln erwartet, muss ein früheres Kapitel setzen
  const gesetzt = new Map();
  for (const c of doc.kapitel) { const s = new Set(); for (const b of buecherVon(c)) if (books[b]) for (const f of flagsGesetzt(books[b])) s.add(f); gesetzt.set(c.id, s); }
  doc.kapitel.forEach((c, i) => {
    for (const b of buecherVon(c)) {
      const bk = books[b]; if (!bk) continue;
      for (const f of Object.keys(bk.erwartet || {})) {
        const frueher = doc.kapitel.slice(0, i).some((k) => gesetzt.get(k.id).has(f)) || Checker.GLOBAL_FLAGS.includes(f);
        const selbst = flagsGesetzt(bk).has(f);
        const spaeter = doc.kapitel.slice(i + 1).some((k) => gesetzt.get(k.id).has(f)) || ((doc.schnittstelle || {}).flags || []).includes(f);
        if (!frueher && !selbst && !spaeter) W('KETTE-FLAG-NIE', `kapitel.${c.id}`, `Buch '${b}' erwartet die Flag '${f}', die kein früheres Kapitel setzt`);
        if (c.einstieg && c.einstieg.flags && f in c.einstieg.flags === false && i > 0 && frueher && !Checker.GLOBAL_FLAGS.includes(f)) W('KETTE-EINSTIEG', `kapitel.${c.id}.einstieg.flags`, `Der Einstieg setzt die erwartete Flag '${f}' nicht (Labor-Einstieg ohne Vorgeschichte)`);
      }
    }
  });
  // Ende
  if (isObj(doc.ende)) for (const [i, b] of (doc.ende.abspann || []).entries()) if (!b.kopf) E('SCHEMA', `ende.abspann[${i}]`, 'Block ohne Kopf');
  const tut = doc.tutorial || {};
  for (const k of tut.oeffnet || []) if (!links.has(k)) E('KETTE-EINSTIEG', 'tutorial.oeffnet', `Schlüssel '${k}' ist keine bekannte Sprungkante`);
  return done();
}

// Stand-in-Szenen der Kette: Schritte mit platzhalter in den Kapitelbüchern
function platzhalter(docIn, booksIn) {
  const doc = docIn || laden();
  const books = booksIn || require('./loader.js').loadAll().books;
  const out = [];
  if (!doc) return out;
  for (const c of doc.kapitel) for (const b of buecherVon(c)) for (const s of (books[b] && books[b].steps) || []) if (s.platzhalter) out.push({ kapitel: c.id, buch: b, schritt: s.id, echt: s.platzhalter });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Laufzeit
class Kette {
  constructor(mission, doc) {
    this.m = mission; this.doc = doc;
    this.kap = new Map(doc.kapitel.map((c) => [c.id, c]));
    this.buchKap = new Map();
    for (const c of doc.kapitel) buecherVon(c).forEach((b, i) => this.buchKap.set(b, { c, i }));
  }
  get g() { return this.m.game; }
  get id() { return this.doc.id; }
  fakt(key, value) { this.m.callWeltstand('fact', key, value, FACT_SRC); }
  faktLesen(key) { const ws = this.g.weltstand; return ws && ws.data && ws.data.fakten ? ws.data.fakten[key] : undefined; }
  chapter(id) { return this.kap.get(id) || null; }
  aktuell() { return this.chapter(this.faktLesen('kapitel')); }
  naechsteNr() { const c = this.aktuell(); return c ? c.nr : 0; }

  // NSC der Kette (z. B. der Legat) in den Weltstand legen, falls noch nicht da (neue Kampagne bzw. älterer Stand)
  npcEinfuegen() {
    const ws = this.g.weltstand; const npc = ws && ws.data && ws.data.npc;
    if (!npc) return;
    for (const [id, n] of Object.entries(this.doc.npc || {})) {
      if (npc[id]) continue;
      const rec = { name: n.name, fraktion: n.fraktion || 'unbekannt', status: n.status || 'lebt', haltung: Number.isFinite(n.haltung) ? n.haltung : 0, gedaechtnis: [] };
      for (const k of ['titel', 'rolle', 'ort']) if (n[k] != null) rec[k] = n[k];
      npc[id] = rec;
    }
  }
  // Kette beginnen (Weltstand-Fakten setzen); mit Tutorial erst nach dem Tutorial-Ende, sonst sofort das erste Kapitel
  anlegen() { this.fakt('kampagne', this.id); this.npcEinfuegen(); }
  starten() { this.begin(this.doc.start, {}); }
  tutorialEnde() {
    const g = this.g;
    for (const key of (this.doc.tutorial.oeffnet || [])) { try { g.explore.openLink(key); } catch (e) { g.countError('kette-tutorial', e); } }
    this.starten();
  }

  // Kapitel (bzw. dessen Buch idx) starten. o: { idx?, wiederholung?, grund?, stumm? }
  begin(id, o) {
    const m = this.m; const g = this.g; const opt = o || {};
    const c = this.chapter(id);
    if (!c) { g.countError('kette-begin', new Error('Unbekanntes Kapitel ' + id)); return false; }
    const idx = opt.idx || 0; const buch = buecherVon(c)[idx];
    this.fakt('kampagne', this.id); this.fakt('kapitel', c.id); this.fakt('kapitel_nr', c.nr); this.fakt('kapitel_buch', buch);
    if (m.activeId) m.abbrechen();
    if (!opt.wiederholung && idx === 0 && c.karte && !opt.stumm) { g.emit('chapter', { title: c.karte.titel, text: c.karte.text, kopf: 'Neues Kapitel' }); g.log(`Kapitelkarte: ${c.karte.titel}`); }
    if (opt.wiederholung) g.log(`Kapitel ${c.nr} (${c.id}): noch einmal${opt.grund ? ' (' + opt.grund + ')' : ''}.`);
    else g.log(`Kapitel ${c.nr}: ${c.titel} (${buch}).`);
    m.startMission(buch);
    return !!m.activeId;
  }

  // Aufruf der Engine bei jedem Missionsende
  onMissionDone(ev) {
    const m = this.m;
    if (!ev || !ev.id) return;
    if (ev.id === this.doc.tutorial.nach && !this.faktLesen('kapitel')) { this.tutorialEnde(); return; }
    const hit = this.buchKap.get(ev.id);
    if (!hit) return;
    const { c, i } = hit; const ausgang = ev.ausgang || 'erfolg';
    const letzte = i === buecherVon(c).length - 1;
    if (!letzte) {
      if (ausgang === 'erfolg') this.begin(c.id, { idx: i + 1 }); else this.begin(c.id, { idx: i, wiederholung: true, grund: ausgang });
      return;
    }
    const f = this.folge(c, ausgang);
    if (!f) { this.g.countError('kette-folge', new Error(`Kapitel ${c.id}: Ausgang '${ausgang}' ohne Folge – Szene wird wiederholt`)); this.begin(c.id, { idx: i, wiederholung: true, grund: ausgang }); return; }
    if (f.weiter === ENDE) { this.ende(); return; }
    if (f.weiter) { this.begin(f.weiter, {}); return; }
    this.begin(c.id, { idx: i, wiederholung: true, grund: ausgang });
  }
  folge(c, ausgang) {
    const f = c.ausgaenge[ausgang];
    if (!f) return null;
    for (const x of folgenListe(f)) if (x.wenn === undefined || this.m.cond(x.wenn)) return x;
    return null;
  }

  // Sieg und Abspann; danach kein freies Spiel (der Client zeigt nur den Abspann und das Hauptmenü)
  ende() {
    const g = this.g; const e = this.doc.ende;
    this.fakt('kampagne_ende', true);
    g.log(`Kampagne ${this.id} beendet: ${e.titel}.`);
    g.endGame({ title: e.titel, text: e.text, abspann: { titel: this.doc.titel, text: e.text, bloecke: e.abspann } });
  }

  // Nach dem Laden (mission.restore): läuft ein Buch, übernimmt die Engine; sonst aus den Fakten und dem Buch-Ausgang ableiten
  fortsetzen() {
    const m = this.m;
    if (this.faktLesen('kampagne_ende')) { this.ende(); return 'ende'; }
    if (m.activeId) return 'aktiv';
    const c = this.aktuell();
    if (!c) return this.faktLesen('kampagne') ? 'tutorial' : null;   // Tutorial läuft noch bzw. gerade beendet: m3 startet die Kette
    const buch = this.faktLesen('kapitel_buch') || buecherVon(c)[0];
    const ms = m.missions[buch];
    if (ms && ms.state === 'done') { this.onMissionDone({ id: buch, ausgang: ms.ausgang || 'erfolg' }); return 'folge'; }
    this.begin(c.id, { idx: Math.max(0, buecherVon(c).indexOf(buch)), stumm: true });
    return 'neu';
  }

  // Alle Flags, die die Bücher der Kette setzen, und die der Einstiege
  alleFlags() {
    const out = new Set();
    for (const c of this.doc.kapitel) {
      for (const k of Object.keys((c.einstieg || {}).flags || {})) out.add(k);
      for (const b of buecherVon(c)) { const bk = this.m.rawBook(b); if (bk) for (const f of flagsGesetzt(bk)) out.add(f); }
    }
    return out;
  }

  // Labor-/Debug-Einstieg: den Zustand herstellen, den die Kette vor dem Kapitel erwartet, und das Kapitel starten.
  einstieg(id, opts) {
    const m = this.m; const g = this.g; const o = opts || {};
    const c = this.chapter(id);
    if (!c) return `Unbekanntes Kapitel '${id}'. Gültig: ${[...this.kap.keys()].join(', ')}.`;
    if (m.activeId) m.abbrechen();
    if (typeof m.tutorialUeberspringen === 'function') m.tutorialUeberspringen({ still: true, marken: false });
    const ei = c.einstieg || {};
    // frühere Kapitel gelten als erledigt (nur die Bücher; ihre Folgen schreibt der Einstieg selbst)
    for (const k of this.doc.kapitel) {
      if (k.nr >= c.nr) break;
      for (const b of buecherVon(k)) {
        const inf = m.info(b);
        m.missions[b] = { id: b, title: inf ? inf.title : b, state: 'done', ausgang: 'erfolg' };
        g.stats.missions[b] = { start: m.playTime(), end: m.playTime() };
      }
    }
    // sauberer Ausgangszustand: Flags der Kette und Frachtraum zurücksetzen, dann den Zustand dieses Kapitels setzen
    const Fracht = require('../sim/fracht.js');
    Fracht.restore(g, []);
    for (const f of this.alleFlags()) delete m.flags[f];
    for (const [k, v] of Object.entries(ei.flags || {})) m.flags[k] = v;
    for (const [k, v] of Object.entries(ei.fakten || {})) this.fakt(k, v);
    if (Number.isFinite(ei.marken) && o.marken !== false) g.inventory.marks = ei.marken;
    for (const art of ei.fracht || []) Fracht.anBordLegen(g, art);
    for (const key of ei.oeffnet || []) {
      try { if (key === 'sperrriegel') g.explore.sperrriegelOeffnen(); else g.explore.openLink(key); } catch (e) { g.countError('kette-einstieg', e); }
    }
    for (const k of this.doc.tutorial.oeffnet || []) { try { g.explore.openLink(k); } catch (e) { g.countError('kette-einstieg', e); } }
    this.fakt('kampagne', this.id);
    if (o.ort !== false) {
      const loc = require('../../shared/locations.js').get(ei.ort);
      const err = g.debugGoto(ei.ort, ei.angedockt !== false && !!(loc && loc.scene && loc.scene.dock));
      if (err) return err;
    }
    this.begin(c.id, { stumm: o.stumm !== false });
    return null;
  }
}

module.exports = { DIR, ENDE, laden, lesen, alleIds, pruefen, platzhalter, buecherVon, Kette, schema };
