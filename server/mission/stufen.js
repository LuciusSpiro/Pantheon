'use strict';
// SUND-04b A2: Stufen des Spielleiters (schwer -> leicht): bauplan · figuren_haupt · figuren_neben · geruechte_funk. Je Stufe sind Anbieter und Modell einstellbar (Claude oder lokal/Ollama, spaeter auch
// andere lokale Modelle ohne Codeaenderung) und ob eine ausgefallene oder abgelehnte Anfrage einmal an Claude eskaliert (Standard aus). KEIN zweiter Mechanismus: die Stufen sind weitere Arten des
// vorhandenen Routers (transport-router.js); diese Datei liest nur die Konfiguration und liefert sie dem Router.
//
// Konfiguration, spaetere Schicht gewinnt:
//   1. sichere Standardwerte (STANDARD, der Rueckfall bei kaputter Datei)
//   2. content/spielleiter/stufen.json  (oder die Datei aus der Umgebung STUFEN_DATEI, fuer Tests und Versuche)
//   3. Umgebung: LLM_ANBIETER_<STUFE> (claude|ollama), LLM_MODELL_<STUFE> (Modellname des Anbieters), LLM_ESKALATION_<STUFE> (1|0|an|aus), STUFE gross, z. B. LLM_ANBIETER_BAUPLAN=ollama.
//      Begruendung des Namensschemas: es sind genau die Variablen, die der Router fuer die uebrigen Arten schon kennt (LLM_ANBIETER_*, LLM_MODELL_*); ein eigener Satz STUFE_*_* waere ein zweiter Weg.
// Wird der Anbieter einer Stufe geaendert, ohne das Modell zu nennen, faellt das Modell auf den Standard des neuen Anbieters (claude: sonnet, ollama: null = Standard des Transports): ein Claude-Name geht nie an Ollama.
// Kaputte Datei, unbekannte Stufe, unbekannter Anbieter, unbrauchbarer Modellname: der Eintrag faellt auf den Wert der Schicht davor zurueck und steht in `fehler` (der Aufrufer schreibt ihn ins Regie-Logbuch);
// nie ein Absturz. Ein Modellname, den der Anbieter nicht kennt, zeigt sich erst beim Aufruf (Ausfall, Eintrag im Logbuch, Katalog-/Daten-Rueckfall).
//
//   lade(env, o?) -> { stufen: { name: { anbieter, modell, eskalation, quelle } }, slots: { slot: stufe }, fehler: [Text], datei }     o: { datei, lesen }
//   abweichend(geladen) -> [Stufennamen]            Stufen, die vom Standard abweichen (dann braucht der Spielleiter einen Router)
//   stufeFuerSlot(geladen, slot) -> Stufe | null    Zuordnung der Slots des Text-Pools (Daten: stufen.json `slots`)
//   stufeFuerKind(kind) -> Stufe | null             kind abenteuer -> bauplan (Art der Anfrage in llm.js)
const fs = require('fs');
const path = require('path');

const DATEI = path.join(__dirname, '..', '..', 'content', 'spielleiter', 'stufen.json');
const SCHEMA = path.join(__dirname, '..', '..', 'content', 'schema', 'spielleiter-stufen.schema.json');
const ANBIETER = ['claude', 'ollama'];
// sichere Standardwerte (stehen auch in stufen.json: die Datei ist die Einstellung, dies der Rueckfall)
const STANDARD = {
  bauplan: { anbieter: 'claude', modell: 'sonnet', eskalation: false },
  figuren_haupt: { anbieter: 'claude', modell: 'sonnet', eskalation: false },
  figuren_neben: { anbieter: 'ollama', modell: null, eskalation: false },
  geruechte_funk: { anbieter: 'ollama', modell: null, eskalation: false },
};
const STUFEN = Object.keys(STANDARD);
// Zuordnung der Slots des Text-Pools (content/texte/texte-werte.json slots) zu den Stufen, wenn die Datei keine nennt oder kaputt ist (stufen.json `slots` ueberschreibt je Slot; ein Test haelt beide gleich)
const STANDARD_SLOTS = { ankuendigung: 'geruechte_funk', eintreffen: 'geruechte_funk', soeldner: 'geruechte_funk', verlust: 'geruechte_funk', dank: 'figuren_neben', reaktion: 'figuren_neben', antwort: 'figuren_neben' };
const KIND_STUFE = { abenteuer: 'bauplan' };
const MODELL_FORM = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,79}$/;
const stufeFuerKind = (kind) => (Object.prototype.hasOwnProperty.call(KIND_STUFE, kind) ? KIND_STUFE[kind] : null);
const standardModell = (anbieter) => (anbieter === 'claude' ? 'sonnet' : null);

function wahr(v) { const s = String(v).toLowerCase(); return s === '1' || s === 'an' || s === 'on' || s === 'ja' || s === 'true' ? true : (s === '0' || s === 'aus' || s === 'off' || s === 'nein' || s === 'false' ? false : null); }

function lade(env, o) {
  const e = env || process.env;
  const opt = o || {};
  const fehler = [];
  const stufen = {};
  for (const s of STUFEN) stufen[s] = Object.assign({}, STANDARD[s], { quelle: 'standard' });
  const slots = Object.assign({}, STANDARD_SLOTS);
  const datei = opt.datei || (e.STUFEN_DATEI ? path.resolve(String(e.STUFEN_DATEI)) : DATEI);

  // ---- Schicht 2: Datei
  let doc = null;
  try {
    const roh = (opt.lesen || ((p) => fs.readFileSync(p, 'utf8')))(datei);
    doc = JSON.parse(roh);
  } catch (err) { fehler.push(`stufen.json: nicht lesbar (${String(err && err.message).slice(0, 100)}), sichere Standardwerte gelten`); }
  const objekt = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  if (doc !== null && !objekt(doc)) { fehler.push('stufen.json: kein Objekt, sichere Standardwerte gelten'); doc = null; }
  if (doc) {
    let formFehler = [];
    try {
      const schema = JSON.parse(fs.readFileSync(opt.schemaDatei || SCHEMA, 'utf8'));
      formFehler = require('../weltstand.js').fallbackValidate(doc, schema);
    } catch (err) { formFehler = []; }   // ohne Schema (Datei fehlt) prueft der Rest unten jeden Eintrag einzeln
    if (formFehler.length) fehler.push('stufen.json: Form ungueltig (' + formFehler.slice(0, 3).join('; ') + '), sichere Standardwerte gelten');
    else {
      // Jeder Eintrag wird einzeln geprueft, auch wenn das Schema fehlt oder nicht lesbar ist (Typen und erlaubte Anbieter): ein Eintrag wie null oder {"anbieter":"gpt"} wirft nie
      if (doc.stufen !== undefined && !objekt(doc.stufen)) fehler.push('stufen.json: stufen ist kein Objekt, Standardwerte gelten');
      for (const [name, x] of Object.entries(objekt(doc.stufen) ? doc.stufen : {})) {
        if (!STUFEN.includes(name)) { fehler.push(`stufen.json: unbekannte Stufe ${String(name).slice(0, 30)} ignoriert`); continue; }
        if (!objekt(x)) { fehler.push(`stufen.json: ${name}: kein Objekt, Standard gilt`); continue; }
        if (typeof x.anbieter !== 'string' || !ANBIETER.includes(x.anbieter)) { fehler.push(`stufen.json: ${name}: unbekannter Anbieter ${String(x.anbieter).slice(0, 30)} (erlaubt: ${ANBIETER.join(', ')}), Standard gilt`); continue; }
        if (x.modell !== undefined && x.modell !== null && typeof x.modell !== 'string') { fehler.push(`stufen.json: ${name}: Modellname ist kein Text, Standard gilt`); continue; }
        const mod = x.modell === undefined || x.modell === null ? standardModell(x.anbieter) : x.modell;
        if (mod !== null && !MODELL_FORM.test(String(mod))) { fehler.push(`stufen.json: ${name}: Modellname unbrauchbar, Standard gilt`); continue; }
        stufen[name] = { anbieter: x.anbieter, modell: mod, eskalation: x.eskalation === true, quelle: 'datei' };
      }
      for (const [slot, st] of Object.entries(doc.slots || {})) {
        if (STUFEN.includes(st)) slots[slot] = st; else fehler.push(`stufen.json: Slot ${String(slot).slice(0, 30)}: unbekannte Stufe ${String(st).slice(0, 30)} ignoriert`);
      }
    }
  }

  // ---- Schicht 3: Umgebung
  for (const name of STUFEN) {
    const S = name.toUpperCase();
    const vA = e['LLM_ANBIETER_' + S], vM = e['LLM_MODELL_' + S], vE = e['LLM_ESKALATION_' + S];
    const cur = stufen[name];
    let anbieter = cur.anbieter, modell = cur.modell;
    if (vA !== undefined && vA !== '') {
      const a = String(vA).toLowerCase();
      if (!ANBIETER.includes(a)) fehler.push(`LLM_ANBIETER_${S}=${String(vA).slice(0, 30)}: unbekannter Anbieter (erlaubt: ${ANBIETER.join(', ')}), ${cur.anbieter} bleibt`);
      else { if (a !== anbieter) modell = standardModell(a); anbieter = a; cur.quelle = 'env'; }
    }
    if (vM !== undefined && vM !== '') {
      if (!MODELL_FORM.test(String(vM))) fehler.push(`LLM_MODELL_${S}: Modellname unbrauchbar, ${modell || 'Standard'} bleibt`);
      else { modell = String(vM); cur.quelle = 'env'; }
    }
    if (vE !== undefined && vE !== '') {
      const w = wahr(vE);
      if (w === null) fehler.push(`LLM_ESKALATION_${S}=${String(vE).slice(0, 20)}: nicht 1/0 (an/aus), ${cur.eskalation ? 'an' : 'aus'} bleibt`);
      else { cur.eskalation = w; cur.quelle = 'env'; }
    }
    cur.anbieter = anbieter; cur.modell = modell;
  }
  // Eskalation an Claude gibt es nur fuer Stufen, die nicht selbst bei Claude liegen
  for (const name of STUFEN) {
    if (stufen[name].anbieter === 'claude' && stufen[name].eskalation) { stufen[name].eskalation = false; fehler.push(`${name}: eskalation gilt nur fuer eine Stufe bei Ollama (Claude eskaliert nicht an sich selbst), aus`); }
  }
  return { stufen, slots, fehler, datei };
}

function abweichend(geladen) {
  return STUFEN.filter((n) => { const s = geladen.stufen[n], d = STANDARD[n]; return s.anbieter !== d.anbieter || (s.modell || null) !== (d.modell || null) || s.eskalation !== d.eskalation; });
}
function stufeFuerSlot(geladen, slot) { return geladen && geladen.slots && Object.prototype.hasOwnProperty.call(geladen.slots, slot) ? geladen.slots[slot] : null; }

module.exports = { lade, abweichend, stufeFuerSlot, stufeFuerKind, STANDARD, STANDARD_SLOTS, STUFEN, ANBIETER, KIND_STUFE, DATEI, SCHEMA };
