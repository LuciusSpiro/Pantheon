'use strict';
// SUND-04b E1: Kanon der Faeden der Freien Fahrt Sund (nur mit FAEDEN=1). Was ein Abenteuer erfindet (Name und Volk des NSC, Titel, Ort, Ausgang) gilt ab dem BEGINN und steht im Weltstand
// (welt.sim.faeden.kanon, additiv, Version 3), auch wenn der abgeschlossene Faden spaeter aus der Liste faellt (faeden_gesamt_max). Der Kanon geht NIE in einen Prompt: er traegt NSC-Namen, und der Name eines NSC steht nie im
// Prompt der Komposition (die Chronik bekommt nur die Zeile aus den Daten, ohne Namen). Action-Layer wie abenteuer-brett.js: reine Regeln auf dem Zustand, jede Regel eine benannte Funktion, alle Zahlen in
// content/faeden/abenteuer-brett.json (werte.kanon_max).
//
// Eintrag { f: 'f<n>', name, volk, ort: Hex des Beginns | '', folge: [Beat-Typen ohne Abschluss], titel?: nur ein Abenteuer (Freitext des Modells, hoechstens 60 Zeichen), wieder?: true (derselbe NSC wie ein frueherer Eintrag:
// ein Wiedersehen), ausgang?: 'gelungen' | 'gescheitert' (genau einmal, beim Abschluss), ort_ende?: Hex, an dem es endete (die Geschichte kann wandern: Gerücht), status?: Zustand des NSC am Ende }
//
// Regeln (Pruefer pruefe(F) -> [ 'CODE: Text' ], jede Regel ein Code, der Test und die Mutationsprobe nennen sie):
//   KANON_FORM           ein Eintrag hat die falsche Form (Kennung, Name, Volk, Ort, Typen, Titel, Ausgang)
//   KANON_ID_DOPPELT     ein Faden steht zweimal im Kanon
//   KANON_NAME_DOPPELT   zwei Eintraege haben denselben Namen, der spaetere ist aber kein Wiedersehen (kein zweiter NSC mit gleichem Namen)
//   KANON_NAME_VOLK      derselbe Name mit zwei Voelkern (eine Person hat ein Volk)
//   KANON_WIEDER         ein Wiedersehen ohne frueheren Eintrag desselben NSC
//   KANON_AUSGANG        ein Ausgang ohne ort_ende oder ein ort_ende ohne Ausgang (ein Abenteuer hat hoechstens einen, und er steht mit seinem Ort)
//   KANON_LISTE          ein Faden der Liste weicht vom Kanon ab (Name, Volk, Ausgang) oder fehlt darin
// beginnen(F, f, wieder?) / wiedersehenBeginnen(F, f)   der Faden beginnt: Eintrag (Aufrufer: faden.js oeffnen, abenteuerOeffnen)
// beendet(game, f, ausgang) -> bool                     der Faden ist abgeschlossen: der Ausgang wird genau einmal eingetragen (ein zweiter wird abgelehnt, Logbuch)
// namenVergeben(F) -> Set    nameFrei(F, name) -> bool  Namen im Kanon und in der Liste (nscErzeugen, pruefeOeffnen)
// toSave(F) / lesen(b, F)    Weltstand; lesen gleicht den Kanon mit der Liste der Faeden ab (die Liste ist die Wahrheit, solange der Faden in ihr steht)
const D = require('./faden-daten.js');

const W = D.WERTE, B = D.BEATS, BW = D.BRETT.werte;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const istObjekt = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const HEX = /^\d{4}$/;
const ID = /^f\d{1,6}$/;
const Regie = () => require('./regie-befehle.js');
const nr = (id) => Number(String(id).replace(/\D/g, '')) || 0;
const fehl = (code, text) => `${code}: ${text}`;
const titelMax = () => D.BAUPLAN.werte.titel.max;

const liste = (F) => (Array.isArray(F.kanon) ? F.kanon : (F.kanon = []));
const eintragVon = (F, id) => liste(F).find((e) => e.f === id) || null;
const typenVon = (v) => (v && Array.isArray(v.beats) ? v.beats.filter((b) => !(has(B, b.typ) && B[b.typ].abschluss)).map((b) => b.typ).slice(0, W.beats_max) : []);

// ---------- Beginn und Ende
function neuerEintrag(f) {
  const e = { f: f.id, name: f.nsc.name, volk: f.nsc.fraktion, ort: f.parameter && HEX.test(f.parameter.ort || '') ? f.parameter.ort : '', folge: typenVon(D.vorlage(f.vorlage)) };
  if (f.plan && typeof f.plan.titel === 'string') e.titel = f.plan.titel.slice(0, titelMax());
  return e;
}
function beginnen(F, f) {
  if (eintragVon(F, f.id)) return false;
  liste(F).push(neuerEintrag(f));
  kuerzen(F);
  return true;
}
function wiedersehenBeginnen(F, f) {
  if (eintragVon(F, f.id)) return false;
  const e = neuerEintrag(f);
  e.wieder = true;
  liste(F).push(e);
  kuerzen(F);
  return true;
}
function beendet(game, f, ausgang) {
  const F = game && game.weltsim && game.weltsim.faeden;
  if (!F || !f || !W.ausgaenge.includes(ausgang)) return false;
  let e = eintragVon(F, f.id);
  if (!e) { beginnen(F, f); e = eintragVon(F, f.id); if (!e) return false; }
  if (e.ausgang !== undefined) {   // KANON_AUSGANG: ein Abenteuer hat genau einen Ausgang, ein zweiter gilt nicht
    try { Regie().schreibe(game, { art: 'faden_pruefung', ausgang: 'abgelehnt', key: 'kanon', fehler: [fehl('KANON_AUSGANG', `${f.id} hat schon den Ausgang ${e.ausgang}`)], begruendung: 'zweiter Ausgang fuer dasselbe Abenteuer abgelehnt' }); } catch (err) { if (game.countError) game.countError('abenteuer-kanon-logbuch', err); }
    return false;
  }
  e.ausgang = ausgang;
  e.ort_ende = f.parameter && HEX.test(f.parameter.ort || '') ? f.parameter.ort : '';
  e.status = f.nsc.status;
  return true;
}

// ---------- Namen: ein NSC-Name gehoert genau einer Person, auch wenn ihr abgeschlossener Faden laengst aus der Liste ist
function namenVergeben(F) {
  const s = new Set((F.liste || []).map((f) => f.nsc.name));
  for (const e of liste(F)) s.add(e.name);
  return s;
}
const nameFrei = (F, name) => !namenVergeben(F).has(name);

// ---------- Pruefer
const hexOk = (h) => typeof h === 'string' && (h === '' || HEX.test(h));
function eintragFehler(e) {
  if (!istObjekt(e)) return 'kein Objekt';
  if (typeof e.f !== 'string' || !ID.test(e.f)) return 'Kennung';
  if (typeof e.name !== 'string' || !e.name.length || e.name.length > 40) return 'Name';
  if (!W.voelker.includes(e.volk)) return 'Volk';
  if (!hexOk(e.ort)) return 'Ort';
  if (!Array.isArray(e.folge) || e.folge.length > W.beats_max || !e.folge.every((t) => typeof t === 'string' && has(B, t) && !B[t].abschluss)) return 'Typenfolge';
  if (e.titel !== undefined && !(typeof e.titel === 'string' && e.titel.length >= 1 && e.titel.length <= titelMax())) return 'Titel';
  if (e.wieder !== undefined && e.wieder !== true) return 'wieder';
  if (e.ausgang !== undefined && !W.ausgaenge.includes(e.ausgang)) return 'Ausgang';
  if (e.ort_ende !== undefined && !hexOk(e.ort_ende)) return 'Ort am Ende';
  if (e.status !== undefined && !W.status.includes(e.status)) return 'Zustand';
  return null;
}
function pruefe(F) {
  const out = [];
  const L = liste(F), ids = new Set(), namen = new Map();
  for (const e of L) {
    const g = eintragFehler(e);
    if (g) { out.push(fehl('KANON_FORM', `${istObjekt(e) ? String(e.f).slice(0, 10) : '?'}: ${g}`)); continue; }
    if (ids.has(e.f)) out.push(fehl('KANON_ID_DOPPELT', `${e.f} steht zweimal im Kanon`));
    ids.add(e.f);
    const frueher = namen.get(e.name);
    if (frueher) {
      if (frueher.volk !== e.volk) out.push(fehl('KANON_NAME_VOLK', `${e.f}: derselbe Name mit zwei Voelkern (${frueher.volk}, ${e.volk})`));
      if (!e.wieder) out.push(fehl('KANON_NAME_DOPPELT', `${e.f}: der Name steht schon bei ${frueher.f}, ein zweiter NSC darf ihn nicht tragen`));
    } else {
      namen.set(e.name, e);
      if (e.wieder) out.push(fehl('KANON_WIEDER', `${e.f}: ein Wiedersehen ohne frueheren Eintrag desselben NSC`));
    }
    if ((e.ausgang === undefined) !== (e.ort_ende === undefined)) out.push(fehl('KANON_AUSGANG', `${e.f}: Ausgang und Ort am Ende gehoeren zusammen`));
  }
  for (const f of F.liste || []) {
    const e = L.find((x) => x.f === f.id);
    if (!e) { out.push(fehl('KANON_LISTE', `${f.id} fehlt im Kanon`)); continue; }
    if (e.name !== f.nsc.name || e.volk !== f.nsc.fraktion) out.push(fehl('KANON_LISTE', `${f.id}: Name oder Volk weichen vom NSC ab`));
    const soll = f.phase === 'abgeschlossen' && f.ausgang ? f.ausgang.art : undefined;
    if (e.ausgang !== soll) out.push(fehl('KANON_LISTE', `${f.id}: Ausgang ${String(e.ausgang)} statt ${String(soll)}`));
  }
  return out;
}

// ---------- Kuerzen: die aeltesten abgeschlossenen Eintraege ohne Faden in der Liste zuerst; ein laufender nie
function kuerzen(F) {
  const L = liste(F);
  while (L.length > BW.kanon_max) {
    const i = L.findIndex((e) => e.ausgang !== undefined && !(F.liste || []).some((f) => f.id === e.f));
    if (i < 0) break;   // was noch in der Liste steht oder laeuft, faellt nie weg (die Liste fasst hoechstens faeden_gesamt_max, kanon_max ist groesser)
    const weg = L.splice(i, 1)[0];
    // die Wiedersehen-Kette bleibt stimmig: war der Entwurf der erste Eintrag seines Namens, wird der naechste Eintrag desselben Namens der erste (kein wieder mehr); der Name bleibt vergeben
    if (!L.slice(0, i).some((e) => e.name === weg.name)) { const n = L.find((e) => e.name === weg.name); if (n) delete n.wieder; }
  }
}

// ---------- Weltstand
function speicherForm(L) {
  return L.map((e) => {
    const o = { f: e.f, name: e.name, volk: e.volk, ort: e.ort, folge: e.folge.slice() };
    if (e.titel !== undefined) o.titel = e.titel;
    if (e.wieder) o.wieder = true;
    if (e.ausgang !== undefined) { o.ausgang = e.ausgang; o.ort_ende = e.ort_ende; if (e.status !== undefined) o.status = e.status; }
    return o;
  });
}
// Der Block steht nur im Stand, wenn er MEHR weiss als die Liste der Faeden (ein verdraengter Faden, ein gewanderter Ort): was sich aus der Liste ableiten laesst, steht ohnehin im Stand (Altstand: byte-gleich).
function toSave(F) {
  const L = liste(F);
  if (!L.length) return null;
  const tmp = { liste: F.liste || [], kanon: [], ladeFehler: [] };
  abgleichen(tmp);
  const soll = speicherForm(L);
  return JSON.stringify(soll) === JSON.stringify(speicherForm(tmp.kanon)) ? null : soll;
}
// muellfest: Unbrauchbares und Widerspruechliches faellt weg (Meldung in F.ladeFehler); danach gleicht der Kanon sich mit der Liste ab: die Liste ist die Wahrheit, ein Faden ohne Eintrag bekommt einen (Altstand)
function lesen(b, F) {
  F.kanon = [];
  if (b !== undefined && !Array.isArray(b)) F.ladeFehler.push('kanon: verworfen');
  const ids = new Set(), namen = new Map();
  for (const x of Array.isArray(b) ? b.slice(-BW.kanon_max) : []) {
    const g = eintragFehler(x);
    if (g) { F.ladeFehler.push('kanon: Eintrag verworfen (' + g + ')'); continue; }
    if (ids.has(x.f)) { F.ladeFehler.push('kanon: Eintrag doppelt verworfen'); continue; }
    const frueher = namen.get(x.name);
    if (frueher && (!x.wieder || frueher.volk !== x.volk)) { F.ladeFehler.push('kanon: Name doppelt, Eintrag verworfen'); continue; }
    if (!frueher && x.wieder) { F.ladeFehler.push('kanon: Wiedersehen ohne Vorgaenger, Eintrag verworfen'); continue; }
    if ((x.ausgang === undefined) !== (x.ort_ende === undefined)) { F.ladeFehler.push('kanon: Ausgang ohne Ort, Eintrag verworfen'); continue; }
    ids.add(x.f);
    if (!frueher) namen.set(x.name, x);
    const e = { f: x.f, name: x.name, volk: x.volk, ort: x.ort, folge: x.folge.slice() };
    if (x.titel !== undefined) e.titel = x.titel;
    if (x.wieder) e.wieder = true;
    if (x.ausgang !== undefined) { e.ausgang = x.ausgang; e.ort_ende = x.ort_ende; if (x.status !== undefined) e.status = x.status; }
    F.kanon.push(e);
  }
  abgleichen(F);
  return F;
}
// die Liste der Faeden ist die Wahrheit fuer alles, was in ihr steht: Name, Volk und Ausgang; fehlende Eintraege (Altstand, verworfener Eintrag) werden aus dem Faden abgeleitet
function abgleichen(F) {
  const L = liste(F);
  const fruehere = (f) => L.some((e) => e.name === f.nsc.name && e.f !== f.id && nr(e.f) < nr(f.id)) || (F.liste || []).some((o) => o !== f && o.nsc.name === f.nsc.name && nr(o.id) < nr(f.id));
  for (const f of F.liste || []) {
    let e = eintragVon(F, f.id);
    if (!e) { e = neuerEintrag(f); if (fruehere(f)) e.wieder = true; L.push(e); }
    e.name = f.nsc.name; e.volk = f.nsc.fraktion;
    if (f.phase === 'abgeschlossen' && f.ausgang) {
      e.ausgang = f.ausgang.art;
      if (e.ort_ende === undefined) e.ort_ende = f.parameter && HEX.test(f.parameter.ort || '') ? f.parameter.ort : '';
      e.status = f.ausgang.status;
    } else { delete e.ausgang; delete e.ort_ende; delete e.status; }
  }
  for (let i = 0; i < L.length; i++) if (L[i].ausgang === undefined && !(F.liste || []).some((f) => f.id === L[i].f)) { L.splice(i--, 1); F.ladeFehler.push('kanon: Eintrag ohne laufenden Faden verworfen'); }   // ein Abenteuer ohne Ausgang und ohne Faden gibt es nicht
  L.sort((a, b) => nr(a.f) - nr(b.f));
  kuerzen(F);
}

module.exports = { beginnen, wiedersehenBeginnen, beendet, namenVergeben, nameFrei, pruefe, toSave, lesen, liste, eintragVon, typenVon, kuerzen };
