'use strict';
// SUND-04a-1 B: EIN Pruefer fuer alle Geschichtsfaeden. Er kennt keine Vorlage beim Namen, er liest nur die Daten (content/faeden/beats.json, werte.json, namen.json, haltung-werte.json) und die Felder der
// Vorlage. Eine neue Vorlage oder ein neuer Beat im Katalog laeuft ohne Codeaenderung durch dieselben Regeln. Ungueltiges wird nie gespielt; jeder Fehler hat einen Code ("CODE: Text"), den faden.js ins
// Regie-Logbuch schreibt (server/sim/regie-befehle.js schreibe, art faden_pruefung).
//
//   pruefeVorlage(v) -> { ok, fehler: [Text] }       Form (content/schema/faden-vorlage.schema.json) und Regeln der Vorlage; alle Fehler, nicht nur der erste
//   pruefeFaden(f) -> [Text]                         Regeln eines Fadens im Zustand (Leser, Tests): Vorlage da, Beat im Bereich, Ausgang, Hinweis vor der Enthuellung, Abstand, Gedaechtnis
//   pruefeOeffnen(F, b, ctx) / pruefeWeiter(F, b, ctx) -> null | Grund   Befehle faden_oeffnen und faden_weiter des Lage-Spielleiters gegen den Fadenzustand F (ctx: ein Plan, siehe neuerKontext)
//   folgeWirkung(folge, npc) -> { wirkung } | { fehler }   eine Folge { typ, grund } als Wirkung des Katalogs (Zahl aus den Daten, geprueft mit dem Pruefer der Wirkung)
//   folgeProfil(folge) -> Text                       Wirkung einer Option als Summe je Ziel (ruf.<fraktion>, haltung): gleiche Profile = Scheinwahl
//
// Regeln der Vorlage (Code): FORM · BEATS_ANZAHL · ID_DOPPELT · TYP_UNBEKANNT · BAUSTEIN_FEHLT · PARAMETER · FLUCHTZIEL_FEHLT · ABSCHLUSS_NICHT_LETZT · ABSCHLUSS_FEHLT · WAHRHEIT_OHNE_ENTHUELLUNG ·
//   ENTHUELLUNG_OHNE_WAHRHEIT · HINWEIS_UNBEKANNT · HINWEIS_FEHLT (auf JEDEM Weg vor der Enthuellung mindestens ein Hinweis) · AUSGANG_FEHLT · AUSGANG_UNGUELTIG · WEITER_UNGUELTIG (nur nach vorn) ·
//   SCHEITERN_FOLGENLOS (Scheitern veraendert den Faden: anderer Zustand oder anderer Weg als Gelingen, beide Ausgaenge fuehren zu einem Beat oder zum Abschluss) · STATUS_PASST_NICHT · TOT_BLEIBT_TOT ·
//   UNERREICHBAR · OPTION_BEI_GEFAHR · GEFAHR_ABGESCHWAECHT · OPTIONEN_NICHT_ERLAUBT · OPTIONEN_ANZAHL · OPTION_UNGUELTIG · SCHEINWAHL · FOLGE_UNGUELTIG · ABSTAND · VOLK · AUSLOESER · NSC.
const fs = require('fs');
const path = require('path');
const D = require('./faden-daten.js');
const Wirkungen = require('../weltsim/wirkungen.js');

const W = D.WERTE, B = D.BEATS, N = D.NAMEN, H = D.HALTUNG;
const RUF_QUELLEN = require('../../content/welt/ruf-werte.json').werte.quellen.wert;
const HEX = /^\d{4}$/;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const istObjekt = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const fehl = (code, text) => `${code}: ${text}`;
// B-M1: text_key (Ausgang und Gedächtnis) nur a-z, 0-9, _; das Gedächtnis-Ereignis (Beat-Typ + '_' + Ausgang) nur a-z und _ (Weltstand-Schema)
const TEXT_KEY = /^[a-z0-9_]{1,40}$/, EREIGNIS = /^[a-z_]{1,40}$/;
const r2 = (x) => Math.round(x * 100) / 100;

let schemaCache = null;
const schema = () => schemaCache || (schemaCache = JSON.parse(fs.readFileSync(path.join(D.DIR, '..', 'schema', 'faden-vorlage.schema.json'), 'utf8')));

// ---------- Folgen (Wirkungen des Katalogs)
function folgeWirkung(f, npc) {
  if (!istObjekt(f)) return { fehler: 'Folge ist kein Objekt' };
  if (!W.folge_typen.includes(f.typ)) return { fehler: `Folge-Typ "${f.typ}" ist nicht erlaubt (${W.folge_typen.join(', ')})` };
  let w;
  if (f.typ === 'ruf_aenderung') {
    const q = typeof f.grund === 'string' && has(RUF_QUELLEN, f.grund) ? RUF_QUELLEN[f.grund] : null;
    if (!q) return { fehler: `unbekannter Ruf-Grund "${f.grund}"` };
    w = { typ: 'ruf_aenderung', fraktion: q.fraktion, delta: q.delta, grund: f.grund };
  } else {
    const q = typeof f.grund === 'string' && has(H.quellen, f.grund) ? H.quellen[f.grund] : null;
    if (!q) return { fehler: `unbekannter Haltungs-Grund "${f.grund}"` };
    w = { typ: 'haltung_aenderung', npc: npc || 'n1', delta: q.delta, grund: f.grund };
  }
  const g = Wirkungen.KATALOG[f.typ].pruefe(null, null, w);   // Aufsatz-Wirkungen lesen weder Zustand noch Daten der Sim
  return g ? { fehler: `${f.typ}: ${g}` } : { wirkung: w };
}
// Wirkung einer Option/eines Ausgangs als Summe je Ziel; die `folge` der Ruf-Quelle (z. B. Germanen sinken) zaehlt mit
function folgeProfil(folge) {
  const s = {};
  const add = (k, d) => { s[k] = (s[k] || 0) + d; };
  for (const f of Array.isArray(folge) ? folge : []) {
    const r = folgeWirkung(f, 'n1');
    if (!r.wirkung) { add('?' + JSON.stringify(f), 1); continue; }
    if (r.wirkung.typ === 'haltung_aenderung') add('haltung', r.wirkung.delta);
    else {
      add('ruf.' + r.wirkung.fraktion, r.wirkung.delta);
      const q = RUF_QUELLEN[r.wirkung.grund];
      if (q && q.folge) for (const [fr, d] of Object.entries(q.folge)) add('ruf.' + fr, d);
    }
  }
  return Object.keys(s).sort().filter((k) => r2(s[k]) !== 0).map((k) => k + '=' + r2(s[k])).join(',');
}

// ---------- Hilfen der Vorlage
const wirksamGefahr = (beat, cat) => !!(cat && cat.gefahr) || beat.gefahr === true;
const fluchtzielOk = (p) => typeof p === 'string' && (HEX.test(p) || W.fluchtziele.includes(p));
function zielIndex(v, i, o, idx) {
  const z = o && o.weiter ? idx.get(o.weiter) : i + 1;
  return Number.isInteger(z) && z > i && z < v.beats.length ? z : null;
}
// Optionen eines Beats gegen den Katalog: -> [Fehlertext]
function optionenFehler(beat, cat) {
  const out = [];
  const opts = beat.optionen;
  if (!Array.isArray(opts) || !opts.length) return out;
  const O = W.optionen;
  if (wirksamGefahr(beat, cat)) { out.push(fehl('OPTION_BEI_GEFAHR', `Beat ${beat.id} (${beat.typ}) bringt Gefahr: bei Gefahr gibt es nie Optionen (Gefahr wird angekündigt, nicht abgefragt)`)); return out; }
  if (cat.optionen !== 'erlaubt') { out.push(fehl('OPTIONEN_NICHT_ERLAUBT', `Beat ${beat.id}: der Beat-Typ ${beat.typ} erlaubt keine Optionen`)); return out; }
  if (opts.length < O.min || opts.length > O.max) out.push(fehl('OPTIONEN_ANZAHL', `Beat ${beat.id}: ${opts.length} Optionen, erlaubt sind ${O.min} bis ${O.max}`));
  const ids = new Set(); const profile = []; let folgenlos = 0;
  for (const o of opts) {
    if (!istObjekt(o) || typeof o.id !== 'string' || ids.has(o.id)) { out.push(fehl('OPTION_UNGUELTIG', `Beat ${beat.id}: Option ohne eindeutige Id`)); continue; }
    ids.add(o.id);
    if (typeof o.text !== 'string' || !o.text.trim() || o.text.length > O.text_max) out.push(fehl('OPTION_UNGUELTIG', `Beat ${beat.id}, Option ${o.id}: Text fehlt oder länger als ${O.text_max} Zeichen`));
    if (o.ausgang !== undefined && !W.ausgaenge.includes(o.ausgang)) out.push(fehl('OPTION_UNGUELTIG', `Beat ${beat.id}, Option ${o.id}: unbekannter Ausgang "${o.ausgang}"`));
    let folgeOk = true;
    for (const f of Array.isArray(o.folge) ? o.folge : []) { const r = folgeWirkung(f, 'n1'); if (r.fehler) { folgeOk = false; out.push(fehl('FOLGE_UNGUELTIG', `Beat ${beat.id}, Option ${o.id}: ${r.fehler}`)); } }
    if (!Array.isArray(o.folge)) { folgeOk = false; out.push(fehl('FOLGE_UNGUELTIG', `Beat ${beat.id}, Option ${o.id}: folge fehlt`)); }
    if (!folgeOk) continue;
    const p = folgeProfil(o.folge) + (o.ausgang ? '>' + o.ausgang : '');
    if (!p) folgenlos++;
    profile.push({ id: o.id, p });
  }
  if (folgenlos > 1) out.push(fehl('SCHEINWAHL', `Beat ${beat.id}: mehr als eine folgenlose Option (höchstens eine ist ausdrücklich folgenlos)`));
  for (let a = 0; a < profile.length; a++) for (let b = a + 1; b < profile.length; b++) if (profile[a].p && profile[a].p === profile[b].p) out.push(fehl('SCHEINWAHL', `Beat ${beat.id}: die Optionen ${profile[a].id} und ${profile[b].id} haben dieselbe Folge (${profile[a].p}), das ist keine Wahl`));
  return out;
}
function parameterFehler(beat, cat) {
  const out = [];
  const spec = cat.parameter || { pflicht: [], optional: [] };
  const p = beat.parameter === undefined ? {} : beat.parameter;
  if (!istObjekt(p)) return [fehl('PARAMETER', `Beat ${beat.id}: parameter ist kein Objekt`)];
  const erlaubt = (spec.pflicht || []).concat(spec.optional || []);
  for (const k of Object.keys(p)) {
    if (!erlaubt.includes(k)) out.push(fehl('PARAMETER', `Beat ${beat.id} (${beat.typ}): unbekannter Parameter "${k}"`));
    else if (!(typeof p[k] === 'boolean' || (typeof p[k] === 'number' && Number.isFinite(p[k])) || (typeof p[k] === 'string' && p[k].length > 0 && p[k].length <= 40))) out.push(fehl('PARAMETER', `Beat ${beat.id}: Parameter "${k}" muss ein kurzer Text, eine Zahl oder ein Wahrheitswert sein`));
  }
  const braucht = cat.braucht || {};
  for (const k of spec.pflicht || []) if (!(k in p) && !(k === 'fluchtziel' && braucht.fluchtziel)) out.push(fehl('PARAMETER', `Beat ${beat.id} (${beat.typ}): Pflichtparameter "${k}" fehlt`));
  if (braucht.fluchtziel && !fluchtzielOk(p.fluchtziel)) out.push(fehl('FLUCHTZIEL_FEHLT', `Beat ${beat.id} (${beat.typ}): ohne gültiges Fluchtziel (Hex-Code oder ${W.fluchtziele.join(', ')}) gibt es keine Verfolgung`));
  return out;
}

// ---------- Vorlage
// Katalog (B-M1): jeder Beat-Typ muss mit beiden Ausgängen ein gültiges Gedächtnis-Ereignis ergeben. Wird beim Laden der Daten (faden-daten.js) geprüft.
function katalogFehler() {
  const out = [];
  for (const typ of Object.keys(B)) for (const ag of W.ausgaenge) { const e = typ + '_' + ag; if (!EREIGNIS.test(e)) out.push(fehl('KATALOG_EREIGNIS', `Beat-Typ "${typ}": das Ereignis "${e}" passt nicht zu ${EREIGNIS} (Gedächtnis des NSC)`)); }
  return out;
}

function pruefeVorlage(v) {
  const fehler = [];
  const form = require('../weltstand.js').fallbackValidate(v, schema());
  if (form.length) return { ok: false, fehler: form.map((t) => fehl('FORM', t)) };
  if (v.format !== 'faden-vorlage/1') return { ok: false, fehler: [fehl('FORM', 'format')] };
  const Bausteine = require('./faden-bausteine.js');

  // Kopf
  if (v.beats.length < 2 || v.beats.length > W.beats_max) fehler.push(fehl('BEATS_ANZAHL', `${v.beats.length} Beats, erlaubt sind 2 bis ${W.beats_max}`));
  for (const a of v.ausloeser) if (!W.ausloeser.includes(a.art) || !W.ausgaenge.includes(a.ausgang)) fehler.push(fehl('AUSLOESER', `Auslöser ${a.art}/${a.ausgang} ist nicht erlaubt (Arten ${W.ausloeser.join(', ')}, Ausgänge ${W.ausgaenge.join(', ')})`));
  for (const vk of v.volk_erlaubt) if (!W.voelker.includes(vk) || !N[vk]) fehler.push(fehl('VOLK', `Volk "${vk}" ist unbekannt`));
  if (v.nsc) {
    if (v.nsc.status !== undefined && !W.status.includes(v.nsc.status)) fehler.push(fehl('NSC', `Start-Status "${v.nsc.status}" ist unbekannt`));
    if (v.nsc.haltung !== undefined && !(v.nsc.haltung >= H.grenzen.min && v.nsc.haltung <= H.grenzen.max)) fehler.push(fehl('NSC', `Start-Haltung außerhalb ${H.grenzen.min} bis ${H.grenzen.max}`));
    for (const k of v.nsc.klassen || []) for (const vk of v.volk_erlaubt) if (N[vk] && !N[vk].klassen.includes(k)) fehler.push(fehl('NSC', `Klasse "${k}" gibt es für das Volk ${vk} nicht (namen.json)`));
  }
  if (v.abstand) {
    const a = v.abstand;
    if (!(a.min >= W.abstand.min && a.max <= W.abstand.max && a.min <= a.max)) fehler.push(fehl('ABSTAND', `Abstand ${a.min} bis ${a.max} liegt nicht in ${W.abstand.min} bis ${W.abstand.max} (eine Vorlage darf den Bereich nur verengen)`));
  }
  const hin = v.hinweise || {};
  for (const [k, h] of Object.entries(hin)) if (!W.hinweis_kanaele.includes(h.kanal)) fehler.push(fehl('HINWEIS_UNBEKANNT', `Hinweis ${k}: Kanal "${h.kanal}" ist unbekannt (${W.hinweis_kanaele.join(', ')})`));
  if (v.wahrheit && v.wahrheit.fraktion !== undefined && !W.voelker.includes(v.wahrheit.fraktion)) fehler.push(fehl('NSC', `Wahrheit: Fraktion "${v.wahrheit.fraktion}" ist unbekannt`));

  // Beats
  const idx = new Map();
  let typenOk = true;
  v.beats.forEach((b, i) => { if (idx.has(b.id)) fehler.push(fehl('ID_DOPPELT', `Beat-Id ${b.id} kommt doppelt vor`)); else idx.set(b.id, i); });
  const last = v.beats.length - 1;
  let wahrheitBeat = false;
  v.beats.forEach((b, i) => {
    const cat = has(B, b.typ) ? B[b.typ] : null;
    if (!cat) { typenOk = false; fehler.push(fehl('TYP_UNBEKANNT', `Beat ${b.id}: Typ "${b.typ}" steht nicht im Beat-Katalog (nur Katalogbausteine)`)); return; }
    if (!Bausteine.vonId(cat.baustein)) fehler.push(fehl('BAUSTEIN_FEHLT', `Beat ${b.id}: der Baustein ${cat.baustein} ist nicht registriert`));
    if ((cat.abschluss || (cat.braucht && cat.braucht.letzter)) && i !== last) fehler.push(fehl('ABSCHLUSS_NICHT_LETZT', `Beat ${b.id} (${b.typ}) darf nur der letzte sein`));
    if (cat.braucht && cat.braucht.wahrheit) { wahrheitBeat = true; if (!v.wahrheit) fehler.push(fehl('ENTHUELLUNG_OHNE_WAHRHEIT', `Beat ${b.id}: ohne verborgene Wahrheit gibt es nichts zu enthüllen`)); }
    if (b.gefahr === false && cat.gefahr) fehler.push(fehl('GEFAHR_ABGESCHWAECHT', `Beat ${b.id}: ein Beat ${b.typ} bringt immer Gefahr, die Vorlage darf das nicht abschwächen`));
    fehler.push(...parameterFehler(b, cat));
    fehler.push(...optionenFehler(b, cat));
    for (const h of b.hinweise || []) if (!has(hin, h)) fehler.push(fehl('HINWEIS_UNBEKANNT', `Beat ${b.id}: Hinweis "${h}" ist in hinweise nicht beschrieben`));
    // Ausgaenge
    const aus = b.aus || {};
    for (const ag of W.ausgaenge) {
      const o = aus[ag];
      if (!o) { fehler.push(fehl('AUSGANG_FEHLT', `Beat ${b.id}: der Ausgang ${ag} fehlt (jeder Beat hat Ausgänge gelungen und gescheitert)`)); continue; }
      if (o.status !== undefined && !W.status.includes(o.status)) fehler.push(fehl('AUSGANG_UNGUELTIG', `Beat ${b.id}, ${ag}: Status "${o.status}" ist unbekannt`));
      if (o.text_key !== undefined && !(typeof o.text_key === 'string' && TEXT_KEY.test(o.text_key))) fehler.push(fehl('TEXT_KEY', `Beat ${b.id}, ${ag}: text_key "${String(o.text_key).slice(0, 40)}" ist ungültig (nur a-z, 0-9, _, 1 bis 40 Zeichen; der Weltstand verlangt es)`));
      for (const f of o.folge || []) { const r = folgeWirkung(f, 'n1'); if (r.fehler) fehler.push(fehl('FOLGE_UNGUELTIG', `Beat ${b.id}, ${ag}: ${r.fehler}`)); }
      if (cat.abschluss) { if (o.weiter !== undefined) fehler.push(fehl('AUSGANG_UNGUELTIG', `Beat ${b.id}: der Abschluss führt nirgends weiter (weiter ${o.weiter})`)); continue; }
      if (o.status === undefined) fehler.push(fehl('AUSGANG_UNGUELTIG', `Beat ${b.id}, ${ag}: der Zustand des NSC (status) fehlt`));
      if (o.weiter !== undefined) {
        const z = idx.get(o.weiter);
        if (z === undefined) fehler.push(fehl('WEITER_UNGUELTIG', `Beat ${b.id}, ${ag}: weiter "${o.weiter}" ist kein Beat der Vorlage`));
        else if (z <= i) fehler.push(fehl('WEITER_UNGUELTIG', `Beat ${b.id}, ${ag}: weiter "${o.weiter}" geht nicht nach vorn (die Reihenfolge ist vorwärts)`));
      }
    }
    if (!cat.abschluss && aus.gelungen && aus.gescheitert) {
      const nach = (o) => (o.weiter !== undefined ? o.weiter : (v.beats[i + 1] || {}).id);
      if (aus.gescheitert.status === aus.gelungen.status && nach(aus.gescheitert) === nach(aus.gelungen)) fehler.push(fehl('SCHEITERN_FOLGENLOS', `Beat ${b.id}: Scheitern verändert den Faden nicht (gleicher Zustand, gleicher Weg wie Gelingen); es muss etwas ändern, ohne den Faden zu beenden`));
    }
  });
  if (v.wahrheit && !wahrheitBeat) fehler.push(fehl('WAHRHEIT_OHNE_ENTHUELLUNG', 'die Vorlage hat eine verborgene Wahrheit, aber keinen Enthüllungs-Beat (ohne Enthüllung sind auch die Hinweise sinnlos)'));
  const l = v.beats[last];
  if (typenOk && !(has(B, l.typ) && B[l.typ].abschluss)) fehler.push(fehl('ABSCHLUSS_FEHLT', 'der letzte Beat ist kein Abschluss: jeder Faden braucht einen Ausgang'));

  // Wege: Zustand des NSC, Hinweise vor der Enthuellung, Erreichbarkeit (nur wenn Ids, Typen und Ziele stimmen, sonst folgen die Fehler oben)
  if (typenOk && !fehler.some((f) => /^(ID_DOPPELT|WEITER_UNGUELTIG|AUSGANG_FEHLT|ABSCHLUSS_NICHT_LETZT)/.test(f))) {
    const gesehen = new Set(), erreicht = new Set(), meld = new Set();
    const stack = [{ i: 0, s: (v.nsc && v.nsc.status) || 'aktiv', h: false }];
    while (stack.length) {
      const { i, s, h } = stack.pop();
      const key = i + '|' + s + '|' + (h ? 1 : 0);
      if (gesehen.has(key)) continue;
      gesehen.add(key); erreicht.add(i);
      const b = v.beats[i], cat = B[b.typ];
      const m = (code, text) => { const k = code + '|' + b.id + '|' + text; if (!meld.has(k)) { meld.add(k); fehler.push(fehl(code, text)); } };
      const br = cat.braucht || {};
      if (br.nsc_status && !br.nsc_status.includes(s)) m('STATUS_PASST_NICHT', `Beat ${b.id} (${b.typ}) kann nicht laufen, wenn der NSC ${s} ist (erlaubt: ${br.nsc_status.join(', ')})`);
      if (br.hinweis_vorher && !h) m('HINWEIS_FEHLT', `Beat ${b.id} (${b.typ}): auf einem Weg dorthin wurde vorher kein Hinweis gestreut (jede Enthüllung braucht mindestens einen Hinweis davor)`);
      if (cat.abschluss) continue;
      const h2 = h || (Array.isArray(b.hinweise) && b.hinweise.length > 0);
      for (const ag of W.ausgaenge) {
        const o = b.aus[ag];
        let s2 = s;
        if (o.status !== undefined) { if (s === 'tot' && o.status !== 'tot') m('TOT_BLEIBT_TOT', `Beat ${b.id}, ${ag}: ein toter NSC wird nicht wieder ${o.status}`); else s2 = o.status; }
        const z = zielIndex(v, i, o, idx);
        if (z !== null) stack.push({ i: z, s: s2, h: h2 });
      }
    }
    v.beats.forEach((b, i) => { if (!erreicht.has(i)) fehler.push(fehl('UNERREICHBAR', `Beat ${b.id} wird auf keinem Weg erreicht`)); });
  }
  return { ok: fehler.length === 0, fehler };
}

// ---------- Faden im Zustand
function pruefeFaden(f) {
  const out = [];
  const v = istObjekt(f) ? D.vorlage(f.vorlage) : null;
  if (!v) return [fehl('FADEN_OHNE_VORLAGE', 'Vorlage unbekannt oder ungeprüft')];
  if (!Number.isInteger(f.beat) || f.beat < 0 || f.beat >= v.beats.length) return [fehl('FADEN_BEAT', `Beat-Index ${f.beat} außerhalb der Vorlage`)];
  if (!['wartet', 'laeuft', 'abgeschlossen'].includes(f.phase)) out.push(fehl('FADEN_PHASE', `Phase "${f.phase}" unbekannt`));
  if (f.phase === 'abgeschlossen') {
    if (!istObjekt(f.ausgang) || !W.ausgaenge.includes(f.ausgang.art)) out.push(fehl('FADEN_OHNE_AUSGANG', 'ein abgeschlossener Faden hat einen Ausgang (kein Faden ohne Ausgang)'));
    if (!(B[v.beats[f.beat].typ] || {}).abschluss) out.push(fehl('FADEN_OHNE_ABSCHLUSS', 'ein Faden endet nur im Abschluss-Beat'));
  } else if (f.ausgang) out.push(fehl('FADEN_AUSGANG', 'ein offener Faden hat noch keinen Ausgang'));
  if (f.phase === 'laeuft' && !istObjekt(f.laufend)) out.push(fehl('FADEN_PHASE', 'ein laufender Beat hat laufend'));
  const a = v.abstand || W.abstand;
  if (!(Number.isInteger(f.abstand) && f.abstand >= Math.max(a.min, W.abstand.min) && f.abstand <= Math.min(a.max, W.abstand.max))) out.push(fehl('ABSTAND', `Abstand ${f.abstand} liegt nicht in ${W.abstand.min} bis ${W.abstand.max}`));
  const n = f.nsc;
  if (!istObjekt(n)) return out.concat(fehl('NSC', 'NSC fehlt'));
  if (!W.status.includes(n.status)) out.push(fehl('NSC', `Status "${n.status}" unbekannt`));
  if (!Array.isArray(n.gedaechtnis) || n.gedaechtnis.length > W.gedaechtnis_max) out.push(fehl('NSC', `Gedächtnis hat mehr als ${W.gedaechtnis_max} Einträge`));
  if (!(n.haltung >= H.grenzen.min && n.haltung <= H.grenzen.max)) out.push(fehl('NSC', 'Haltung außerhalb der Grenzen'));
  if (n.wahrheit && n.wahrheit.offenbart && !(Array.isArray(f.hinweise) && f.hinweise.length)) out.push(fehl('HINWEIS_FEHLT', 'die Wahrheit ist enthüllt, aber es wurde nie ein Hinweis gestreut'));
  return out;
}

// ---------- Befehle des Lage-Spielleiters
const neuerKontext = () => ({ n: 0, oeffnen: 0, benutzt: new Set(), weiter: new Set() });
const aktive = (F) => F.liste.filter((f) => f.phase !== 'abgeschlossen');
const BEFEHL_FELDER = { faden_oeffnen: ['typ', 'vorlage', 'parameter'], faden_weiter: ['typ', 'faden', 'beat'] };
const PARAM_FELDER = ['volk', 'ort', 'name', 'angebot'];
const nameOk = (name, volk) => {
  const L = N[volk];
  if (!L || typeof name !== 'string') return false;
  const t = name.split(' ');
  return t.length === 2 && L.vornamen.includes(t[0]) && L.nachnamen.includes(t[1]);
};
function felderFehler(b) {
  for (const k of Object.keys(b)) if (!BEFEHL_FELDER[b.typ].includes(k)) return fehl('BEFEHL_FELD', `${b.typ}: unbekanntes Feld "${k}"`);
  return null;
}

function pruefeOeffnen(F, b, ctx) {
  const fe = felderFehler(b); if (fe) return fe;
  if (typeof b.vorlage !== 'string') return fehl('VORLAGE_UNBEKANNT', 'vorlage fehlt');
  const v = D.vorlage(b.vorlage);
  if (!v) return fehl('VORLAGE_UNBEKANNT', `Vorlage "${String(b.vorlage).slice(0, 40)}" gibt es nicht (nur geprüfte Vorlagen)`);
  const p = b.parameter === undefined ? {} : b.parameter;
  if (!istObjekt(p)) return fehl('PARAMETER', 'parameter ist kein Objekt');
  for (const k of Object.keys(p)) if (!PARAM_FELDER.includes(k)) return fehl('PARAMETER', `unbekannter Parameter "${k}" (erlaubt: ${PARAM_FELDER.join(', ')})`);
  if (aktive(F).length + ctx.oeffnen >= W.aktiv_max) return fehl('OBERGRENZE', `höchstens ${W.aktiv_max} aktive Fäden`);
  // Angebot: eine Taetigkeit mit Person muss da sein (explizit per Nummer oder das erste passende)
  let a;
  if (p.angebot !== undefined) {
    if (!Number.isInteger(p.angebot)) return fehl('KEIN_ANGEBOT', 'angebot ist keine Nummer');
    a = F.angebote.find((x) => x.nr === p.angebot);
    if (!a) return fehl('KEIN_ANGEBOT', `Angebot ${p.angebot} gibt es nicht (mehr)`);
    if (!a.vorlagen.includes(v.id)) return fehl('KEIN_ANGEBOT', `Angebot ${a.nr} passt nicht zur Vorlage ${v.id}`);
    if (ctx.benutzt.has(a.nr)) return fehl('KEIN_ANGEBOT', `Angebot ${a.nr} ist in diesem Plan schon verbraucht`);
  } else {
    a = F.angebote.find((x) => x.vorlagen.includes(v.id) && !ctx.benutzt.has(x.nr));
    if (!a) return fehl('KEIN_ANGEBOT', `kein offenes Angebot für ${v.id} (ein Faden beginnt nur an einer Tätigkeit mit Person am Ausgang)`);
  }
  if (p.volk !== undefined && !v.volk_erlaubt.includes(p.volk)) return fehl('PARAMETER', `volk "${p.volk}" ist für ${v.id} nicht erlaubt (${v.volk_erlaubt.join(', ')})`);
  const volk = p.volk || (v.volk_erlaubt.includes(a.volk) ? a.volk : v.volk_erlaubt[0]);
  if (p.ort !== undefined && !(typeof p.ort === 'string' && HEX.test(p.ort) && require('../../shared/sektoren.js').spielbar(p.ort))) return fehl('PARAMETER', 'ort ist kein spielbarer Sektor');
  if (p.name !== undefined) {
    if (!nameOk(p.name, volk)) return fehl('NAME', `name muss aus Vor- und Nachname der Liste des Volkes ${volk} bestehen (NSC entstehen nur aus Datenlisten)`);
    if (F.liste.some((f) => f.nsc.name === p.name)) return fehl('NAME', `der Name ${p.name} ist schon vergeben`);
  }
  ctx.benutzt.add(a.nr);
  ctx.oeffnen++;
  return null;
}

function pruefeWeiter(F, b, ctx) {
  const fe = felderFehler(b); if (fe) return fe;
  if (typeof b.faden !== 'string' || typeof b.beat !== 'string') return fehl('FADEN_UNBEKANNT', 'faden und beat müssen Kennungen sein');
  const f = F.liste.find((x) => x.id === b.faden);
  if (!f) return fehl('FADEN_UNBEKANNT', `Faden ${String(b.faden).slice(0, 20)} gibt es nicht`);
  if (f.phase === 'abgeschlossen') return fehl('FADEN_ABGESCHLOSSEN', `Faden ${f.id} ist abgeschlossen`);
  if (f.phase === 'laeuft') return fehl('FADEN_BELEGT', `Faden ${f.id}: der Beat ${(D.vorlage(f.vorlage).beats[f.beat] || {}).id} läuft noch`);
  if (ctx.weiter.has(f.id)) return fehl('DOPPELT', `Faden ${f.id} geht in diesem Plan schon weiter`);
  const v = D.vorlage(f.vorlage);
  if (!v) return fehl('VORLAGE_UNBEKANNT', `Vorlage ${f.vorlage} gibt es nicht mehr`);
  const beat = v.beats[f.beat], cat = B[beat.typ];
  if (b.beat !== beat.id) return fehl('REIHENFOLGE', `als Nächstes kommt ${beat.id}, nicht ${String(b.beat).slice(0, 32)} (die Reihenfolge der Beats ist fest)`);
  if (f.zaehler < f.abstand) return fehl('ABSTAND', `Faden ${f.id}: erst nach ${f.abstand} Tätigkeiten seit dem letzten Beat (bisher ${f.zaehler})`);
  const br = cat.braucht || {};
  if (br.nsc_status && !br.nsc_status.includes(f.nsc.status)) return fehl('STATUS_PASST_NICHT', `Beat ${beat.id} (${beat.typ}) läuft nicht mit einem NSC im Zustand ${f.nsc.status}`);
  if (br.wahrheit && !f.nsc.wahrheit) return fehl('ENTHUELLUNG_OHNE_WAHRHEIT', `Faden ${f.id} hat keine verborgene Wahrheit`);
  if (br.hinweis_vorher && !(f.hinweise && f.hinweise.length)) return fehl('HINWEIS_FEHLT', `Faden ${f.id}: vor der Enthüllung wurde noch kein Hinweis gestreut`);
  if (br.fluchtziel && !fluchtzielOk((beat.parameter || {}).fluchtziel)) return fehl('FLUCHTZIEL_FEHLT', `Beat ${beat.id}: ohne Fluchtziel keine Verfolgung`);
  const og = optionenFehler(beat, cat);
  if (og.length) return og[0];
  ctx.weiter.add(f.id);
  return null;
}

function befehlPruefen(F, b, ctx) {
  if (!istObjekt(b) || !has(BEFEHL_FELDER, b.typ)) return fehl('BEFEHL_FELD', 'kein Faden-Befehl');
  if (ctx.n >= W.befehle_je_plan_max) return fehl('BEFEHLE_JE_PLAN', `höchstens ${W.befehle_je_plan_max} Faden-Befehle je Plan`);
  const g = b.typ === 'faden_oeffnen' ? pruefeOeffnen(F, b, ctx) : pruefeWeiter(F, b, ctx);
  if (!g) ctx.n++;
  return g;
}
const istBefehl = (b) => istObjekt(b) && has(BEFEHL_FELDER, b.typ);

module.exports = { katalogFehler, TEXT_KEY, pruefeVorlage, pruefeFaden, pruefeOeffnen, pruefeWeiter, befehlPruefen, istBefehl, neuerKontext, folgeWirkung, folgeProfil, optionenFehler, fluchtzielOk, aktive, nameOk, BEFEHL_FELDER, PARAM_FELDER };
