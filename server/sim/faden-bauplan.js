'use strict';
// SUND-04b A1: der Expander der Abenteuer-Plaene. Ein Abenteuer ist ein Faden, den ein PLAN beschreibt und der nicht als Datei unter content/faeden/vorlagen liegt. Der Spielleiter (Claude, ab A2) liefert nur einen
// kleinen BAUPLAN (faden-bauplan/1, Form content/schema/faden-bauplan.schema.json): Titel, Anlass, Folge von Beat-Typen mit Parametern, optionale Verzweigung (Ausgang -> id eines SPAETEREN Beats), optional namenlos.
// Alles andere kommt aus DATEN (Katalog = Grenze der Moeglichkeiten): Zustaende, Ausgaenge, Folgen, Optionen und Hinweis-Traeger je Beat-Typ in content/faeden/beats.json (`bauplan`), Plan-Grenzen,
// Wahrheiten und der Hinweis-Katalog in content/faeden/bauplan.json. Aus dem Bauplan wird eine volle Vorlage (faden-vorlage/1) oder eine begruendete Ablehnung; EIN Pruefer (faden-pruefer.js) prueft die Vorlage.
//
//   expandiere(plan) -> { ok, vorlage, fehler: ["CODE: Text"], codes }   nur der Expander: Form, Regeln des Plans, Standards aus den Daten, Zustaende der Ausgaenge, Hinweise vor der Enthuellung.
//                                                                          Ist ok wahr, besteht die Vorlage den Pruefer (Test: tools/test-faden-bauplan.js); der Pruefer ist das Netz darunter.
//   pruefe(plan)     -> { ok, vorlage, fehler, codes }                      expandiere + faden-pruefer.pruefeVorlage (der Weg, den faden.abenteuerAnbieten nimmt)
//   katalogFehler()  -> [Text]                                              die Daten des Expanders sind in sich stimmig (Test, und einmal je Prozess vor dem ersten Plan; katalogNeuLesen() fuer Tests)
//
// Regeln des Expanders (Code): FORM · BAUPLAN_TEXT · VOLK · BEATS_ANZAHL · ID_DOPPELT · TYP_UNBEKANNT · BAUPLAN_TYP_NICHT_PLANBAR · ABSCHLUSS_NICHT_LETZT · ABSCHLUSS_FEHLT · PARAMETER · FLUCHTZIEL_FEHLT ·
//   OPTION_BEI_GEFAHR · OPTIONEN_NICHT_ERLAUBT · BAUPLAN_OPTIONEN_PFLICHT · OPTIONEN_GLEICHER_WEG · WEITER_UNGUELTIG · AUSGANG_UNGUELTIG (Verzweigung am Abschluss) · ERFOLG_UNGUELTIG · BAUPLAN_NAMENLOS_TYP ·
//   BAUPLAN_WAHRHEIT_UNBEKANNT · NSC_ALT_NICHT_ERSTER (SUND-04b B1: Wiedersehen nur als erster Beat, nie namenlos) · WAHRHEIT_OHNE_ENTHUELLUNG · HINWEIS_FEHLT · UNERREICHBAR · STATUS_PASST_NICHT · SCHEITERN_FOLGENLOS · BAUPLAN_KATALOG. Gleiche Codes wie der Pruefer, wo es dieselbe Regel ist.
const fs = require('fs');
const path = require('path');
const D = require('./faden-daten.js');
const P = require('./faden-pruefer.js');

const W = D.WERTE, B = D.BEATS, N = D.NAMEN, BP = D.BAUPLAN, BW = BP.werte;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const istObjekt = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const klon = (x) => JSON.parse(JSON.stringify(x));
const fehl = (code, text) => `${code}: ${text}`;
const codeVon = (t) => String(t).split(':')[0];
const waren = () => Object.keys(require('../../content/faeden/szenen-werte.json').werte.waren.wert);

let schemaCache = null;
const schema = () => schemaCache || (schemaCache = JSON.parse(fs.readFileSync(path.join(D.DIR, '..', 'schema', 'faden-bauplan.schema.json'), 'utf8')));
const fallbackValidate = (v, s) => require('../weltstand.js').fallbackValidate(v, s);

// Wert eines Plan-Parameters gegen `erlaubt` der Daten: Liste, "fluchtziel" (Hex-Code oder Symbol, wie der Pruefer) oder "waren" (Schluessel in szenen-werte.json)
function parameterErlaubt(erlaubt, wert) {
  if (Array.isArray(erlaubt)) return erlaubt.includes(wert);
  if (erlaubt === 'fluchtziel') return P.fluchtzielOk(wert);
  if (erlaubt === 'waren') return waren().includes(wert);
  return false;
}
const textOk = (t) => typeof t === 'string' && !/[{}]/.test(t);

// ---------- die Daten des Expanders sind in sich stimmig
let katalogCache = null;
function katalogFehler() {
  const out = [];
  const f = (t) => out.push(fehl('BAUPLAN_KATALOG', t));
  if (!(typeof BW.id_praefix === 'string' && /^[a-z][a-z0-9_]*$/.test(BW.id_praefix) && BW.id_praefix.length + BW.id_hash_laenge <= 32)) f('id_praefix und id_hash_laenge ergeben keine gueltige Vorlagen-Id (a-z, 0-9, _, hoechstens 32 Zeichen)');
  if (!(BW.ausloeser && W.ausloeser.includes(BW.ausloeser.art) && W.ausgaenge.includes(BW.ausloeser.ausgang))) f('ausloeser ist keine erlaubte Art und kein erlaubter Ausgang (werte.json)');
  const vs = JSON.parse(fs.readFileSync(path.join(D.DIR, '..', 'schema', 'faden-vorlage.schema.json'), 'utf8')).properties.beats.items.properties;
  if (!(Number.isInteger(BW.erfolg_max) && BW.erfolg_max >= 1)) f('erfolg_max fehlt');
  else if (BW.erfolg_max > vs.erfolg.properties.ereignis.maxItems) f('erfolg_max ist groesser als das Schema der Vorlage erlaubt (erfolg.ereignis hoechstens ' + vs.erfolg.properties.ereignis.maxItems + ')');
  if (!BW.volk_erlaubt_standard.every((v) => W.voelker.includes(v) && N[v])) f('volk_erlaubt_standard enthaelt ein unbekanntes Volk');
  if (!has(BP.wahrheiten, BW.wahrheit_standard)) f('wahrheit_standard steht nicht in wahrheiten');
  for (const [k, h] of Object.entries(BP.hinweise)) {
    if (!W.hinweis_kanaele.includes(h.kanal)) f(`Hinweis ${k}: Kanal ${h.kanal} unbekannt`);
    if (typeof h.mit_name !== 'boolean') f(`Hinweis ${k}: mit_name fehlt`);
    const t = h.text;
    if (typeof t !== 'string' || t.trim().length < 8 || t.length > W.hinweis_text_max) f(`Hinweis ${k}: Text fehlt oder nicht 8 bis ${W.hinweis_text_max} Zeichen`);
    else if ((t.match(/\{[^}]*\}/g) || []).some((p) => p !== '{name}' && p !== '{ort}')) f(`Hinweis ${k}: nur {name} und {ort} erlaubt`);
    else if (h.mit_name === false && t.includes('{name}')) f(`Hinweis ${k}: ohne mit_name darf {name} nicht vorkommen`);
    else if (/^\{name\}\s*:/.test(t)) f(`Hinweis ${k}: kein "{name}:" am Anfang`);
  }
  for (const [k, w] of Object.entries(BP.wahrheiten)) {
    if (!/^[a-z][a-z0-9_]{1,31}$/.test(k)) f(`Wahrheit ${k}: Kennung ungueltig`);
    if (w.fraktion !== undefined && !W.voelker.includes(w.fraktion)) f(`Wahrheit ${k}: Fraktion unbekannt`);
    const hs = Array.isArray(w.hinweise) ? w.hinweise : [];
    if (!hs.length || !hs.every((h) => has(BP.hinweise, h))) f(`Wahrheit ${k}: hinweise leer oder mit unbekanntem Hinweis`);
    else if (!hs.some((h) => BP.hinweise[h].mit_name === false)) f(`Wahrheit ${k}: kein Hinweis ohne {name} (ein namenloses Abenteuer braucht einen)`);
    if (hs.length > 8) f(`Wahrheit ${k}: mehr als 8 Hinweise (Schema)`);
  }
  const p3 = require('../../content/faeden/p3-texte.json').texte;
  for (const [typ, cat] of Object.entries(B)) {
    const bp = cat.bauplan;
    if (bp === undefined) continue;
    const g = (t) => f(`Beat ${typ}: ${t}`);
    const nsc = (cat.braucht && cat.braucht.nsc_status) || [];
    if (!W.status.includes(bp.start_status) || !nsc.includes(bp.start_status)) g(`start_status "${bp.start_status}" fehlt in werte.status oder braucht.nsc_status`);
    if (typeof bp.hinweis_traeger !== 'boolean') g('hinweis_traeger fehlt');
    const spec = cat.parameter || { pflicht: [], optional: [] };
    const erl = (spec.pflicht || []).concat(spec.optional || []);
    const ps = bp.parameter || {};
    for (const [k, s] of Object.entries(ps)) {
      if (!erl.includes(k)) g(`Parameter ${k} steht nicht in parameter (pflicht/optional)`);
      if (!istObjekt(s) || s.standard === undefined || !parameterErlaubt(s.erlaubt, s.standard)) g(`Parameter ${k}: standard fehlt oder steht nicht in erlaubt`);
      if (k === 'text_key' && istObjekt(s) && Array.isArray(s.erlaubt)) {
        for (const t of s.erlaubt) {
          if (!P.TEXT_KEY.test(t)) g(`text_key ${t} ungueltig`);
          if (cat.baustein === 'bitte') {
            if (!has(D.BITTE.texte, t)) g(`text_key ${t} steht nicht in bitte-werte.json texte`);
            for (const ton of D.HALTUNG.toene) if (has(D.BITTE.texte, t + '_' + ton.id)) g(`text_key ${t} hat eine Ton-Variante (${ton.id}): der Expander kann die Erreichbarkeit der Toene nicht zusichern`);
          } else if (cat.baustein === 'notruf' && !has(p3, t)) g(`text_key ${t} steht nicht in p3-texte.json`);
        }
      }
    }
    for (const k of spec.pflicht || []) if (!has(ps, k)) g(`Pflichtparameter ${k} hat keinen Standard`);
    for (const ag of W.ausgaenge) {
      const o = bp.aus && bp.aus[ag];
      if (!istObjekt(o)) { g(`aus.${ag} fehlt`); continue; }
      if (!Array.isArray(o.folge)) g(`aus.${ag}.folge fehlt`);
      for (const x of o.folge || []) { const r = P.folgeWirkung(x, 'n1'); if (r.fehler) g(`aus.${ag}: ${r.fehler}`); }
      if (!cat.abschluss && !(Array.isArray(o.status) && o.status.length && o.status.every((s) => W.status.includes(s)))) g(`aus.${ag}.status ist leer oder enthaelt einen unbekannten Zustand`);
    }
    if (cat.braucht && cat.braucht.nsc_alt !== undefined && cat.braucht.nsc_alt !== true) g('braucht.nsc_alt ist true oder fehlt');
    if (bp.optionen_pflicht && cat.optionen !== 'erlaubt') g('optionen_pflicht, aber der Beat-Typ erlaubt keine Optionen');
    if (bp.optionen !== undefined) {
      if (cat.optionen !== 'erlaubt' || cat.gefahr) g('optionen nur bei einem Typ mit optionen erlaubt und ohne Gefahr');
      const probe = { id: 'p', typ, optionen: bp.optionen, parameter: {}, aus: {} };
      const e = P.optionenFehler(probe, cat);
      if (e.length) g('Standard-Optionen ungueltig: ' + e[0]);
    } else if (bp.optionen_pflicht) g('optionen_pflicht ohne optionen');
  }
  out.push(...require('./faden-b1.js').katalogFehler().map((t) => fehl('BAUPLAN_KATALOG', t)));   // SUND-04b B1: Texte, Spuren und Parameter der Bausteine geruecht, spur, wiedersehen
  return out;
}

// ---------- Expander
function expandiere(plan) {
  const fehler = [];
  const add = (code, text) => fehler.push(fehl(code, text));
  const ergebnis = () => ({ ok: fehler.length === 0, vorlage: null, fehler, codes: fehler.map(codeVon) });
  if (katalogCache === null) katalogCache = katalogFehler();
  if (katalogCache.length) { fehler.push(katalogCache[0]); return ergebnis(); }
  if (!istObjekt(plan)) { add('FORM', 'der Bauplan ist kein Objekt'); return ergebnis(); }
  const form = fallbackValidate(plan, schema());
  if (form.length) { for (const t of form) add('FORM', t); return ergebnis(); }

  // Kopf
  const T = BW.titel, A = BW.anlass;
  if (plan.titel.trim().length < T.min || !textOk(plan.titel)) add('BAUPLAN_TEXT', `der Titel braucht ${T.min} bis ${T.max} Zeichen ohne Platzhalter`);
  if (plan.anlass !== undefined && (plan.anlass.trim().length < A.min || plan.anlass.length > A.max || !textOk(plan.anlass))) add('BAUPLAN_TEXT', `der Anlass braucht ${A.min} bis ${A.max} Zeichen ohne Platzhalter (Crew-neutral, keine Spielernamen)`);
  const volk = plan.volk_erlaubt || BW.volk_erlaubt_standard;
  for (const vk of volk) if (!W.voelker.includes(vk) || !N[vk]) add('VOLK', `Volk "${vk}" ist unbekannt`);
  const namenlos = plan.namenlos === true;
  const bs = plan.beats, n = bs.length, last = n - 1;
  if (n < 2 || n > W.beats_max) add('BEATS_ANZAHL', `${n} Beats, erlaubt sind 2 bis ${W.beats_max}`);

  if (n === 0) return ergebnis();

  // Ids und Typen
  const ids = bs.map((b, i) => b.id || `b${i + 1}_${/^[a-z][a-z0-9_]{0,20}$/.test(b.typ) ? b.typ : 'x'}`.slice(0, 32));
  const idx = new Map();
  let graphOk = true;
  ids.forEach((id, i) => { if (idx.has(id)) { add('ID_DOPPELT', `Beat-Id ${id} kommt doppelt vor`); graphOk = false; } else idx.set(id, i); });
  const cats = bs.map((b, i) => {
    if (!has(B, b.typ)) { add('TYP_UNBEKANNT', `Beat ${ids[i]}: Typ "${b.typ}" steht nicht im Beat-Katalog (nur Katalogtypen)`); graphOk = false; return null; }
    if (!istObjekt(B[b.typ].bauplan)) { add('BAUPLAN_TYP_NICHT_PLANBAR', `Beat ${ids[i]}: der Typ ${b.typ} hat keine Standards (beats.json bauplan) und kann in keinem Plan stehen`); graphOk = false; return null; }
    return B[b.typ];
  });
  if (!graphOk) return ergebnis();   // ohne Typen und Ids gibt es keine weiteren Regeln zu pruefen

  const params = [], optionen = [], ziele = [];   // je Beat: Parameter (Standards + Plan), Optionen (oder null), Ziele { gelungen, gescheitert } (Index)
  bs.forEach((b, i) => {
    const cat = cats[i], bp = cat.bauplan, id = ids[i];
    if ((cat.abschluss || (cat.braucht && cat.braucht.letzter)) && i !== last) add('ABSCHLUSS_NICHT_LETZT', `Beat ${id} (${b.typ}) darf nur der letzte sein`);
    if (namenlos && !((cat.braucht && cat.braucht.nsc_status) || []).includes('aktiv')) add('BAUPLAN_NAMENLOS_TYP', `Beat ${id} (${b.typ}) laeuft nur mit einem NSC in einem anderen Zustand als aktiv: in einem namenlosen Abenteuer bleibt der NSC aktiv`);
    if (cat.braucht && cat.braucht.nsc_alt === true) {   // SUND-04b B1: ein NSC aus einem frueheren Faden kommt mit dem Oeffnen (parameter nsc_von), also nur am Anfang und nie namenlos
      if (i !== 0) add('NSC_ALT_NICHT_ERSTER', `Beat ${id} (${b.typ}): ein Beat mit einem NSC aus einem fruheren Faden steht nur am Anfang des Plans`);
      if (namenlos) add('BAUPLAN_NAMENLOS_TYP', `Beat ${id} (${b.typ}): ein namenloses Abenteuer hat keinen NSC aus einem fruheren Faden`);
    }
    // Parameter: Standards der Daten, der Plan darf nur nennen, was die Daten erlauben
    const p = {};
    for (const [k, s] of Object.entries(bp.parameter || {})) p[k] = s.standard;
    const gegeben = b.parameter || {};
    for (const [k, v] of Object.entries(gegeben)) {
      const s = (bp.parameter || {})[k];
      if (!s) { add('PARAMETER', `Beat ${id} (${b.typ}): der Plan darf den Parameter "${k}" nicht setzen (erlaubt: ${Object.keys(bp.parameter || {}).join(', ') || 'keiner'})`); continue; }
      if (!parameterErlaubt(s.erlaubt, v)) add(k === 'fluchtziel' ? 'FLUCHTZIEL_FEHLT' : 'PARAMETER', `Beat ${id}: ${k} "${String(v).slice(0, 40)}" ist nicht erlaubt${Array.isArray(s.erlaubt) ? ' (' + s.erlaubt.join(', ') + ')' : k === 'fluchtziel' ? ' (Hex-Code oder ' + W.fluchtziele.join(', ') + ')' : ''}`);
      else p[k] = v;
    }
    params.push(p);
    // Optionen
    let opt = null;
    const will = b.optionen === true || (bp.optionen_pflicht && b.optionen === undefined);
    if (bp.optionen_pflicht && b.optionen === false) add('BAUPLAN_OPTIONEN_PFLICHT', `Beat ${id} (${b.typ}): dieser Typ gibt nur mit Optionen ein Angebot (ohne Optionen scheitert er nach der Frist immer)`);
    if (will) {
      if (cat.gefahr) add('OPTION_BEI_GEFAHR', `Beat ${id} (${b.typ}) bringt Gefahr: bei Gefahr gibt es nie Optionen (Gefahr wird angekuendigt, nicht abgefragt)`);
      else if (cat.optionen !== 'erlaubt' || !bp.optionen) add('OPTIONEN_NICHT_ERLAUBT', `Beat ${id}: der Beat-Typ ${b.typ} erlaubt keine Optionen`);
      else opt = klon(bp.optionen);
    }
    optionen.push(opt);
    // Verzweigung
    const z = { gelungen: i + 1, gescheitert: i + 1 };
    for (const [ag, ziel] of Object.entries(b.verzweigung || {})) {
      if (cat.abschluss) { add('AUSGANG_UNGUELTIG', `Beat ${id}: der Abschluss fuehrt nirgends weiter (verzweigung ${ag})`); continue; }
      const zi = idx.get(ziel);
      if (zi === undefined) { add('WEITER_UNGUELTIG', `Beat ${id}, ${ag}: weiter "${ziel}" ist kein Beat des Plans`); graphOk = false; }
      else if (zi <= i) { add('WEITER_UNGUELTIG', `Beat ${id}, ${ag}: weiter "${ziel}" geht nicht nach vorn (die Reihenfolge ist vorwaerts)`); graphOk = false; }
      else z[ag] = zi;
    }
    ziele.push(z);
    // Erfolg des Abschlusses
    if (b.erfolg !== undefined) {
      if (!cat.abschluss) add('ERFOLG_UNGUELTIG', `Beat ${id}: erfolg gibt es nur am Abschluss`);
      else if (b.erfolg.length > BW.erfolg_max) add('ERFOLG_UNGUELTIG', `Beat ${id}: erfolg nennt mehr als ${BW.erfolg_max} Typen`);
      else for (const t of b.erfolg) if (!bs.some((x, j) => j !== i && x.typ === t && !cats[j].abschluss)) add('ERFOLG_UNGUELTIG', `Beat ${id}: erfolg nennt ${t}, aber der Plan hat keinen solchen Beat`);
    }
  });
  if (!cats[last].abschluss) add('ABSCHLUSS_FEHLT', 'der letzte Beat ist kein Abschluss: jeder Faden braucht einen Ausgang');

  // Wahrheit und Hinweise: eine Enthuellung braucht auf JEDEM Weg vorher einen Hinweis; der Expander streut sie an allen Hinweis-Traegern vor der ersten Enthuellung
  const braucht = (i) => cats[i].braucht || {};
  const erste = bs.findIndex((b, i) => braucht(i).wahrheit || braucht(i).hinweis_vorher);
  if (plan.wahrheit !== undefined && !has(BP.wahrheiten, plan.wahrheit)) add('BAUPLAN_WAHRHEIT_UNBEKANNT', `die Wahrheit "${plan.wahrheit}" gibt es nicht (${Object.keys(BP.wahrheiten).join(', ')})`);
  if (plan.wahrheit !== undefined && !bs.some((b, i) => braucht(i).wahrheit)) add('WAHRHEIT_OHNE_ENTHUELLUNG', 'der Plan nennt eine verborgene Wahrheit, hat aber keinen Enthuellungs-Beat');
  const wahrheitId = bs.some((b, i) => braucht(i).wahrheit) ? (plan.wahrheit !== undefined ? plan.wahrheit : BW.wahrheit_standard) : null;
  const wahrheit = wahrheitId && has(BP.wahrheiten, wahrheitId) ? BP.wahrheiten[wahrheitId] : null;
  const hinweise = {}, hinweisBeat = bs.map(() => []);
  if (wahrheit && erste >= 0) {
    const kand = wahrheit.hinweise.filter((h) => !namenlos || BP.hinweise[h].mit_name === false);
    let k = 0;
    for (let i = 0; i < erste; i++) {
      if (!cats[i].bauplan.hinweis_traeger) continue;
      const h = kand[k % kand.length]; k++;
      hinweisBeat[i] = [h];
      hinweise[h] = { kanal: BP.hinweise[h].kanal, text: BP.hinweise[h].text };
    }
  }
  if (!graphOk) return ergebnis();

  // Wege: Erreichbarkeit und Hinweis auf jedem Weg (wie der Pruefer: Beat-Index x Hinweis-Bit)
  const gesehen = new Set(), erreicht = new Set(), gemeldet = new Set(), stack = [{ i: 0, h: false }];
  while (stack.length) {
    const { i, h } = stack.pop();
    const key = i + '|' + (h ? 1 : 0);
    if (gesehen.has(key)) continue;
    gesehen.add(key); erreicht.add(i);
    if (braucht(i).hinweis_vorher && !h && !gemeldet.has(i)) { gemeldet.add(i); add('HINWEIS_FEHLT', `Beat ${ids[i]} (${bs[i].typ}): auf einem Weg dorthin gibt es keinen Hinweis-Traeger (${Object.keys(B).filter((t) => B[t].bauplan && B[t].bauplan.hinweis_traeger).join(', ')}): jede Enthuellung braucht vorher einen Hinweis`); }
    if (cats[i].abschluss) continue;
    const h2 = h || hinweisBeat[i].length > 0;
    for (const ag of W.ausgaenge) if (ziele[i][ag] < n) stack.push({ i: ziele[i][ag], h: h2 });
  }
  bs.forEach((b, i) => { if (!erreicht.has(i)) add('UNERREICHBAR', `Beat ${ids[i]} wird auf keinem Weg erreicht`); });

  // Zustaende der Ausgaenge: der erste Kandidat der Daten, den der Folgebeat zulaesst; Gelingen und Scheitern muessen etwas veraendern (Zustand, Weg oder, namenlos, Folge)
  const aus = bs.map(() => null);
  bs.forEach((b, i) => {
    const cat = cats[i], bp = cat.bauplan;
    if (!cat.abschluss && (ziele[i].gelungen >= n || ziele[i].gescheitert >= n)) return;   // nach dem letzten Beat gibt es kein Ziel (ABSCHLUSS_FEHLT ist schon gemeldet)
    if (cat.abschluss) { aus[i] = { gelungen: { folge: klon(bp.aus.gelungen.folge) }, gescheitert: { folge: klon(bp.aus.gescheitert.folge) } }; return; }
    const zl = ziele[i];
    const opts = optionen[i];
    if (opts && opts.some((o) => o.ausgang === 'gelungen') && opts.some((o) => o.ausgang === 'gescheitert') && zl.gelungen === zl.gescheitert) {
      add('OPTIONEN_GLEICHER_WEG', `Beat ${ids[i]}: Annehmen und Ablehnen fuehren in denselben Beat (${ids[zl.gelungen]}): die Wahl aendert den Weg nicht (verzweigung gescheitert oder gelungen setzen)`);
    }
    const o = { gelungen: {}, gescheitert: {} };
    for (const ag of W.ausgaenge) { o[ag].folge = klon(bp.aus[ag].folge); if (b.verzweigung && b.verzweigung[ag] !== undefined) o[ag].weiter = b.verzweigung[ag]; }
    if (namenlos) {
      if (zl.gelungen === zl.gescheitert && P.folgeProfil(o.gelungen.folge) === P.folgeProfil(o.gescheitert.folge)) add('SCHEITERN_FOLGENLOS', `Beat ${ids[i]}: Scheitern veraendert den Faden nicht (gleicher Weg, gleiche Folge wie Gelingen); verzweigung gescheitert setzen`);
    } else {
      const zulaessig = (ag) => bp.aus[ag].status.filter((s) => ((cats[zl[ag]].braucht && cats[zl[ag]].braucht.nsc_status) || []).includes(s));
      const gl = zulaessig('gelungen'), gs = zulaessig('gescheitert');
      if (!gl.length) add('STATUS_PASST_NICHT', `Beat ${ids[i]}, gelungen: kein Zustand des NSC (${bp.aus.gelungen.status.join(', ')}) passt zum Folgebeat ${ids[zl.gelungen]} (${bs[zl.gelungen].typ})`);
      else if (!gs.length) add('STATUS_PASST_NICHT', `Beat ${ids[i]}, gescheitert: kein Zustand des NSC (${bp.aus.gescheitert.status.join(', ')}) passt zum Folgebeat ${ids[zl.gescheitert]} (${bs[zl.gescheitert].typ})`);
      else {
        let paar = null;
        for (const a of gl) { for (const c of gs) if (a !== c || zl.gelungen !== zl.gescheitert) { paar = [a, c]; break; } if (paar) break; }
        if (!paar) add('SCHEITERN_FOLGENLOS', `Beat ${ids[i]}: Scheitern veraendert den Faden nicht (gleicher Zustand, gleicher Weg wie Gelingen); verzweigung gescheitert setzen`);
        else { o.gelungen.status = paar[0]; o.gescheitert.status = paar[1]; }
      }
    }
    for (const ag of W.ausgaenge) if (!o[ag].folge.length) delete o[ag].folge;
    aus[i] = o;
  });
  if (fehler.length) return ergebnis();

  // Die Vorlage
  const typen = [];
  bs.forEach((b, i) => { if (!cats[i].abschluss && !typen.includes(b.typ)) typen.push(b.typ); });
  const v = {
    format: 'faden-vorlage/1', id: 'platzhalter', titel: plan.titel.trim(),
    ausloeser: [klon(BW.ausloeser)], volk_erlaubt: volk.slice(),
    nsc: { status: namenlos ? 'aktiv' : cats[0].bauplan.start_status, haltung: BW.nsc_haltung_start },
    hinweise,
    beats: bs.map((b, i) => {
      const e = { id: ids[i], typ: b.typ };
      if (Object.keys(params[i]).length) e.parameter = params[i];
      if (hinweisBeat[i].length) e.hinweise = hinweisBeat[i];
      if (optionen[i]) e.optionen = optionen[i];
      if (cats[i].abschluss) e.erfolg = { ereignis: (b.erfolg || typen.slice(-BW.erfolg_max)).map((t) => t + '_gelungen') };   // ohne Angabe die letzten erfolg_max Typen des Plans (die Vorlage erlaubt hoechstens so viele)
      e.aus = aus[i];
      return e;
    }),
  };
  if (plan.anlass !== undefined) v.anlass = plan.anlass.trim();
  if (namenlos) v.nsc.rolle = 'namenlos';
  if (wahrheit) v.wahrheit = Object.assign({ id: wahrheitId }, wahrheit.fraktion !== undefined ? { fraktion: wahrheit.fraktion } : {});
  v.id = D.abenteuerId(v);
  return { ok: true, vorlage: v, fehler, codes: [] };
}

function pruefe(plan) {
  const r = expandiere(plan);
  if (!r.ok) return r;
  const pr = P.pruefeVorlage(r.vorlage);
  if (!pr.ok) return { ok: false, vorlage: null, fehler: pr.fehler, codes: pr.fehler.map(codeVon) };
  return r;
}

const katalogNeuLesen = () => { katalogCache = null; };   // Tests: die Daten wurden geaendert, der naechste Plan prueft sie neu

module.exports = { expandiere, pruefe, katalogFehler, katalogNeuLesen };
