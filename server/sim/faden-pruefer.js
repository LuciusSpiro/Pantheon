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
//   NSC_ALT_NICHT_ERSTER / NSC_VON_FEHLT / NSC_VON (SUND-04b B1: ein Beat mit braucht.nsc_alt, das Wiedersehen, gehoert einem NSC aus einem frueheren, abgeschlossenen Faden: nur als erster Beat, geoeffnet mit parameter nsc_von) ·
//   SABOTAGE_NUR_EINMAL (SUND-04b B2: ein Beat mit nur_einmal steht höchstens einmal im Plan) · LAGE_ZIEL_FEHLT / SABOTAGE_PAUSE / LAGE_UNBEKANNT (SUND-04b B2, pruefeLage: ein Beat mit braucht.lage haengt von der Welt ab; beim Anbieten und Oeffnen, nicht in pruefeVorlage) ·
//   NAMENLOS (SUND-04b A1: vorlage.nsc.rolle namenlos: der NSC bleibt aktiv, die Ausgaenge brauchen keinen status; die Statuspruefung bleibt, nur der Status faellt weg; Scheitern veraendert dann ueber Weg oder Folge) ·
//   ERFOLG_FEHLT / ERFOLG_UNGUELTIG (Abschluss: wann gilt der Faden als gelungen, Nacharbeit Welle 3) · VARIANTE_UNERREICHBAR / TON_UNERREICHBAR (Haltung: gibt es in der Vorlage einen Weg dorthin) ·
//   UNERREICHBAR · OPTION_BEI_GEFAHR · GEFAHR_ABGESCHWAECHT · OPTIONEN_NICHT_ERLAUBT · OPTIONEN_ANZAHL · OPTION_UNGUELTIG · SCHEINWAHL · FOLGE_UNGUELTIG · ABSTAND · VOLK · AUSLOESER · NSC.
const fs = require('fs');
const path = require('path');
const D = require('./faden-daten.js');
const Wirkungen = require('../weltsim/wirkungen.js');

const W = D.WERTE, B = D.BEATS, N = D.NAMEN, H = D.HALTUNG;
const RUF_QUELLEN = require('../../content/welt/ruf-werte.json').werte.quellen.wert;
const HEX = /^\d{4}$/;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// Karte der Faeden ist die der Freien Fahrt Sund (content/welt/sund_frei.json), nicht der gerade global geladene Kartenstand (shared/sektoren.js haelt beim Start Limes): ein Sektor ist spielbar, wenn die Karte ihn
// als spielbar fuehrt oder er im Raster liegt und keinen Eintrag hat (Leerraum), dieselbe Regel wie Sektoren.spielbar
const FADEN_KARTE = 'sund_frei';
function sundSpielbar(hex) {
  if (typeof hex !== 'string' || !HEX.test(hex)) return false;
  const K = require('./welt.js').karte(FADEN_KARTE);
  if (!K) return false;
  const h = K.hexe[hex];
  if (h) return !!h.spielbar;
  const c = Number(hex.slice(0, 2)), r = Number(hex.slice(2));
  return c >= 1 && c <= K.spalten && r >= 1 && r <= K.zeilen;
}
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
    else if (k === 'text_key' && !(typeof p[k] === 'string' && TEXT_KEY.test(p[k]))) out.push(fehl('TEXT_KEY', `Beat ${beat.id}: parameter text_key "${String(p[k]).slice(0, 40)}" ist ungültig (nur a-z, 0-9, _, 1 bis 40 Zeichen; der Weltstand verlangt es)`));
  }
  if (erlaubt.includes('hex') && has(p, 'hex') && !(typeof p.hex === 'string' && HEX.test(p.hex) && sundSpielbar(p.hex))) out.push(fehl('PARAMETER', `Beat ${beat.id} (${beat.typ}): der Parameter hex ist kein spielbarer Sektor der Karte`));   // SUND-04b B1: Ankunftsort der Beats geruecht, wiedersehen, notruf
  const braucht = cat.braucht || {};
  for (const k of spec.pflicht || []) if (!(k in p) && !(k === 'fluchtziel' && braucht.fluchtziel)) out.push(fehl('PARAMETER', `Beat ${beat.id} (${beat.typ}): Pflichtparameter "${k}" fehlt`));
  if (braucht.fluchtziel && !fluchtzielOk(p.fluchtziel)) out.push(fehl('FLUCHTZIEL_FEHLT', `Beat ${beat.id} (${beat.typ}): ohne gültiges Fluchtziel (Hex-Code oder ${W.fluchtziele.join(', ')}) gibt es keine Verfolgung`));
  return out;
}

// SUND-04a-2 P3: Feindlich-Variante (Daten, beat.variante): wenn der NSC feindlich wiederkehrt (Haltung unter feindlich_unter), laeuft der Variante-Typ statt des Typs des Beats.
// Gibt den Katalogeintrag und ob die Variante gilt zurueck. Die Haltung entscheidet (Zahl), nie das Modell.
function effektiv(beat, haltung, status) {
  if (!beat.variante || status === 'tot' || !(haltung < H.feindlich_unter)) return { cat: B[beat.typ], variante: false };
  return { cat: B[beat.variante.typ], variante: true };
}
// Variante (P3): der Variante-Typ muss ein Katalogbaustein mit Gefahr und Szene sein, der bei einem feindlichen NSC laeuft, und ohne Wahrheit, Fluchtziel, Hinweis und Abschluss
function varianteFehler(b, cat, v, i, idx) {
  const out = [];
  const vt = b.variante.typ, vc = has(B, vt) ? B[vt] : null;
  if (!vc) return [fehl('VARIANTE', `Beat ${b.id}: Variante-Typ "${vt}" steht nicht im Beat-Katalog`)];
  if (!require('./faden-bausteine.js').vonId(vc.baustein)) out.push(fehl('VARIANTE', `Beat ${b.id}: der Baustein ${vc.baustein} der Variante ist nicht registriert`));
  if (!(vc.gefahr && vc.szene)) out.push(fehl('VARIANTE', `Beat ${b.id}: die Variante ${vt} muss eine Szene mit Gefahr sein (ein feindlicher NSC greift an)`));
  const br = vc.braucht || {};
  if (!(Array.isArray(br.nsc_status) && br.nsc_status.includes('feindlich'))) out.push(fehl('VARIANTE', `Beat ${b.id}: die Variante ${vt} läuft nicht mit einem feindlichen NSC`));
  if (br.wahrheit || br.fluchtziel || br.hinweis_vorher || br.letzter || vc.abschluss) out.push(fehl('VARIANTE', `Beat ${b.id}: die Variante ${vt} braucht mehr als einen Gegner (Wahrheit, Fluchtziel, Hinweis oder Abschluss)`));
  if (cat && cat.abschluss) out.push(fehl('VARIANTE', `Beat ${b.id}: ein Abschluss hat keine Variante`));
  out.push(...varianteAusFehler(b, v, i, idx));
  return out;
}

// Welle 4 (S1): die Variante hat EIGENE Ausgaenge (variante.aus, Daten). Ohne sie buchte ein gewonnener Kampf gegen den feindlich gewordenen NSC die Ausgaenge des Grund-Beats (Spontanhilfe: „verbuendet“,
// Haltung steigt, Gedaechtnis spontanhilfe_gelungen). Regeln: beide Ausgaenge da, Zustand aus werte.variante_status (nie verbuendet), die Haltung steigt nie (keine Wirkung mit positivem delta), weiter nur nach vorn,
// Scheitern veraendert den Faden (Zustand oder Weg anders als Gelingen).
function varianteAusFehler(b, v, i, idx) {
  const out = [], aus = istObjekt(b.variante.aus) ? b.variante.aus : {};   // fehlt aus ganz, haelt schon die Form (Schema: Pflicht) die Vorlage auf; hier fehlt dann jeder Ausgang
  for (const ag of W.ausgaenge) {
    const o = aus[ag];
    if (!istObjekt(o)) { out.push(fehl('VARIANTE_AUS', `Beat ${b.id}: der Ausgang ${ag} der Variante fehlt (variante.aus braucht gelungen und gescheitert): ein Kampf gegen den Feind ist keine Hilfe`)); continue; }
    if (!W.status.includes(o.status)) out.push(fehl('VARIANTE_AUS', `Beat ${b.id}, Variante ${ag}: der Zustand des NSC (status) fehlt oder ist unbekannt`));
    else if (!W.variante_status.includes(o.status)) out.push(fehl('VARIANTE_AUSGANG', `Beat ${b.id}, Variante ${ag}: ein Kampf gegen den Feind laesst ihn nie "${o.status}" zurueck (erlaubt: ${W.variante_status.join(', ')})`));
    if (o.text_key !== undefined && !(typeof o.text_key === 'string' && TEXT_KEY.test(o.text_key))) out.push(fehl('TEXT_KEY', `Beat ${b.id}, Variante ${ag}: text_key "${String(o.text_key).slice(0, 40)}" ist ungueltig`));
    for (const f of o.folge || []) {
      const r = folgeWirkung(f, 'n1');
      if (r.fehler) out.push(fehl('FOLGE_UNGUELTIG', `Beat ${b.id}, Variante ${ag}: ${r.fehler}`));
      else if (r.wirkung.typ === 'haltung_aenderung' && r.wirkung.delta > 0) out.push(fehl('VARIANTE_AUSGANG', `Beat ${b.id}, Variante ${ag}: die Haltung des Feindes steigt nicht (${f.grund}, +${r.wirkung.delta}): kein Dank fuer einen Kampf`));
    }
    if (o.weiter !== undefined) {
      const z = idx ? idx.get(o.weiter) : undefined;
      if (z === undefined) out.push(fehl('WEITER_UNGUELTIG', `Beat ${b.id}, Variante ${ag}: weiter "${o.weiter}" ist kein Beat der Vorlage`));
      else if (z <= i) out.push(fehl('WEITER_UNGUELTIG', `Beat ${b.id}, Variante ${ag}: weiter "${o.weiter}" geht nicht nach vorn`));
    }
  }
  if (istObjekt(aus.gelungen) && istObjekt(aus.gescheitert)) {
    const nach = (o) => (o.weiter !== undefined ? o.weiter : (v && v.beats[i + 1] || {}).id);
    if (aus.gelungen.status === aus.gescheitert.status && nach(aus.gelungen) === nach(aus.gescheitert)) out.push(fehl('VARIANTE_AUS', `Beat ${b.id}: Scheitern der Variante veraendert den Faden nicht (gleicher Zustand, gleicher Weg wie Gelingen)`));
  }
  return out;
}

// Nacharbeit Welle 3 (Abschluss): ein Faden endet GELUNGEN, wenn die Crew etwas geleistet hat: das Gedaechtnis des NSC kennt mindestens eines der Ereignisse aus beat.erfolg.ereignis
// (Beat-Typ_gelungen eines Beats der Vorlage, Daten). Nur der gelungene Abschluss zahlt seine Folgen (Haltung, Ruf); ohne Erfolg bleibt der Abschluss ohne Belohnung.
const abschlussGelungen = (beat, nsc) => { const e = beat && beat.erfolg && beat.erfolg.ereignis; return Array.isArray(e) && ((nsc && nsc.gedaechtnis) || []).some((g) => e.includes(g.ereignis)); };

// Nacharbeit Welle 3 (Haltung): kann die Crew mit den Wegen DIESER Vorlage die Haltung dorthin bringen, wo ein Verbraucher greift? Wege wie der Pruefer der Vorlage (nur vorwaerts), Haltung nach den Folgen
// der Ausgaenge und der Optionen (Zahlen aus haltung-werte.json); die Option ohne Ausgang mit Haltungs-Folge (Spaeter, „hingehalten“) stellt eine Bitte zurueck und kann bis zur Frist des Beats wiederholt
// werden. -> { start: [{ s, h }] je Beat (Haltung beim Beginn des Beats), angebote: [Set h] je Beat (Haltung bei jedem Angebot einer Bitte, auch nach dem Zurueckstellen) }
const tonFuer = (h) => { let t = H.toene[0].id; for (const x of H.toene) if (h >= x.ab) t = x.id; return t; };
const klemmH = (x) => r2(Math.min(H.grenzen.max, Math.max(H.grenzen.min, x)));
const haltungDelta = (folge) => { let d = 0; for (const f of Array.isArray(folge) ? folge : []) { const r = folgeWirkung(f, 'n1'); if (r.wirkung && r.wirkung.typ === 'haltung_aenderung') d += r.wirkung.delta; } return d; };
function haltungsWege(v, idx) {
  const start = v.beats.map(() => []), angebote = v.beats.map(() => new Set());
  const gesehen = new Set(), stack = [{ i: 0, s: (v.nsc && v.nsc.status) || 'aktiv', h: klemmH((v.nsc && v.nsc.haltung) || 0) }];
  const MAXK = Math.max(0, W.beat_frist - 1);   // jedes Zurueckstellen braucht eine Taetigkeit bis zum naechsten Angebot, nach beat_frist Taetigkeiten ist der Beat vorbei
  while (stack.length) {
    const { i, s, h } = stack.pop();
    const key = i + '|' + s + '|' + h;
    if (gesehen.has(key)) continue;
    gesehen.add(key);
    start[i].push({ s, h });
    const b = v.beats[i], cat = B[b.typ];
    if (cat.abschluss) continue;
    const opts = Array.isArray(b.optionen) ? b.optionen : [];
    const zurueck = opts.filter((o) => o && o.ausgang === undefined && haltungDelta(o.folge) !== 0).map((o) => haltungDelta(o.folge));
    const hs = new Set([h]);
    angebote[i].add(h);
    for (const d of zurueck) { let x = h; for (let k = 0; k < MAXK; k++) { x = klemmH(x + d); hs.add(x); angebote[i].add(x); } }
    for (const hk of hs) {
      const vb = b.variante && istObjekt(b.variante.aus) && s !== 'tot' && hk < H.feindlich_unter ? b.variante.aus : null;   // Welle 4 (S1): bei dieser Haltung laeuft die Variante, mit ihren eigenen Ausgaengen
      const wege = [{ ag: 'gescheitert', d: 0 }];   // ohne Antwort: die Frist scheitert den Beat
      if (!opts.length || vb) wege.push({ ag: 'gelungen', d: 0 });
      if (!vb) for (const o of opts) if (o && o.ausgang) wege.push({ ag: o.ausgang, d: haltungDelta(o.folge) });
      for (const w of wege) {
        const o = (vb || b.aus)[w.ag];
        if (!o) continue;
        const z = zielIndex(v, i, o, idx);
        if (z === null) continue;
        stack.push({ i: z, s: o.status !== undefined && s !== 'tot' ? o.status : s, h: klemmH(hk + w.d + haltungDelta(o.folge)) });
      }
    }
  }
  return { start, angebote };
}
function haltungFehler(v, idx) {
  const out = [], w = haltungsWege(v, idx);
  v.beats.forEach((b, i) => {
    if (b.variante && !w.start[i].some((x) => x.s !== 'tot' && x.h < H.feindlich_unter)) out.push(fehl('VARIANTE_UNERREICHBAR', `Beat ${b.id}: kein Weg der Vorlage bringt die Haltung unter ${H.feindlich_unter}: die Variante (feindliche Wiederkehr) läuft nie (Haltung wirkt nur, was erreichbar ist)`));
    const key = b.parameter && b.parameter.text_key;
    if (B[b.typ] && B[b.typ].baustein === 'bitte' && typeof key === 'string') {
      for (const t of H.toene) {
        if (t.id === 'sachlich' || !has(D.BITTE.texte, key + '_' + t.id)) continue;
        if (!Array.from(w.angebote[i]).some((h) => tonFuer(h) === t.id)) out.push(fehl('TON_UNERREICHBAR', `Beat ${b.id}: der Text ${key}_${t.id} wird nie gesprochen, kein Weg der Vorlage bringt die Haltung zum Ton ${t.id} (Start ${(v.nsc && v.nsc.haltung) || 0}, Haltung wirkt nur, was erreichbar ist)`));
      }
    }
  });
  return out;
}

// ---------- Vorlage
// Katalog (B-M1): jeder Beat-Typ muss mit beiden Ausgängen ein gültiges Gedächtnis-Ereignis ergeben. Wird beim Laden der Daten (faden-daten.js) geprüft.
function katalogFehler() {
  const out = [];
  for (const typ of Object.keys(B)) for (const ag of W.ausgaenge) { const e = typ + '_' + ag; if (!EREIGNIS.test(e)) out.push(fehl('KATALOG_EREIGNIS', `Beat-Typ "${typ}": das Ereignis "${e}" passt nicht zu ${EREIGNIS} (Gedächtnis des NSC)`)); }
  for (const [typ, c] of Object.entries(B)) if (c.ereignis_ohne_ware !== undefined && !(typeof c.ereignis_ohne_ware === 'string' && EREIGNIS.test(c.ereignis_ohne_ware))) out.push(fehl('KATALOG_EREIGNIS', `Beat-Typ "${typ}": ereignis_ohne_ware passt nicht zu ${EREIGNIS} (Gedächtnis des NSC)`));
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
  // SUND-04b A1: ein namenloses Abenteuer haengt nicht an einem festen NSC. Der NSC bleibt technisch erhalten (Gedaechtnis, Haltung), sein Zustand aber aktiv: die Statusregeln unten gelten unveraendert
  // (STATUS_PASST_NICHT lehnt z. B. eine Befreiung ab), nur der status der Ausgaenge faellt weg.
  const namenlos = !!(v.nsc && v.nsc.rolle === 'namenlos');
  if (v.nsc && v.nsc.rolle !== undefined && !W.nsc_rollen.includes(v.nsc.rolle)) fehler.push(fehl('NSC', `Rolle "${v.nsc.rolle}" ist unbekannt (erlaubt: ${W.nsc_rollen.join(', ')})`));
  if (namenlos && v.nsc.status !== undefined && v.nsc.status !== 'aktiv') fehler.push(fehl('NAMENLOS', 'ein namenloser NSC startet im Zustand aktiv'));
  if (v.abstand) {
    const a = v.abstand;
    if (!(a.min >= W.abstand.min && a.max <= W.abstand.max && a.min <= a.max)) fehler.push(fehl('ABSTAND', `Abstand ${a.min} bis ${a.max} liegt nicht in ${W.abstand.min} bis ${W.abstand.max} (eine Vorlage darf den Bereich nur verengen)`));
  }
  const hin = v.hinweise || {};
  for (const [k, h] of Object.entries(hin)) if (!W.hinweis_kanaele.includes(h.kanal)) fehler.push(fehl('HINWEIS_UNBEKANNT', `Hinweis ${k}: Kanal "${h.kanal}" ist unbekannt (${W.hinweis_kanaele.join(', ')})`));
  // Nacharbeit SUND-04a-2 (Fairness): ein Hinweis ist, was die Crew HOERT. Ohne Text wuerde ihn kein Baustein senden: die Vorlage waere formal fair, die Enthuellung aber unfair.
  for (const [k, h] of Object.entries(hin)) {
    const t = istObjekt(h) ? h.text : undefined;
    if (typeof t !== 'string' || t.trim().length < 8) fehler.push(fehl('HINWEIS_TEXT', `Hinweis ${k}: der Text fehlt (hinweise.${k}.text, mindestens 8 Zeichen): ohne Text sieht die Crew den Hinweis nie`));
    else if (t.length > W.hinweis_text_max) fehler.push(fehl('HINWEIS_TEXT', `Hinweis ${k}: der Text ist länger als ${W.hinweis_text_max} Zeichen`));
    else if ((t.match(/\{[^}]*\}/g) || []).some((p) => p !== '{name}' && p !== '{ort}')) fehler.push(fehl('HINWEIS_TEXT', `Hinweis ${k}: nur die Platzhalter {name} und {ort} sind erlaubt`));
    else if (/^\{name\}\s*:/.test(t)) fehler.push(fehl('HINWEIS_TEXT', `Hinweis ${k}: kein "{name}:" am Anfang (der Sprecher steht im Funk)`));
  }
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
    if (cat.nur_einmal === true && v.beats.slice(0, i).some((x) => x.typ === b.typ)) fehler.push(fehl('SABOTAGE_NUR_EINMAL', `Beat ${b.id} (${b.typ}): ein Beat ${b.typ} steht höchstens einmal in einem Plan (eine Pause zwischen zwei Aufträgen: der zweite scheiterte garantiert)`));   // SUND-04b B2 Nacharbeit H1 (Daten: beats.json nur_einmal)
    if (b.variante && namenlos) fehler.push(fehl('NAMENLOS', `Beat ${b.id}: ein namenloses Abenteuer hat keine feindliche Variante (kein fester NSC, der wiederkehrt)`));
    if (cat.braucht && cat.braucht.nsc_alt === true) {   // SUND-04b B1: Wiedersehen
      if (i !== 0) fehler.push(fehl('NSC_ALT_NICHT_ERSTER', `Beat ${b.id} (${b.typ}): ein Beat mit einem NSC aus einem früheren Faden steht nur am Anfang (der NSC kommt mit dem Öffnen)`));
      if (namenlos) fehler.push(fehl('NAMENLOS', `Beat ${b.id}: ein namenloses Abenteuer hat keinen NSC aus einem früheren Faden`));
    }
    if (b.variante) fehler.push(...varianteFehler(b, cat, v, i, idx));
    if (cat.braucht && cat.braucht.wahrheit) { wahrheitBeat = true; if (!v.wahrheit) fehler.push(fehl('ENTHUELLUNG_OHNE_WAHRHEIT', `Beat ${b.id}: ohne verborgene Wahrheit gibt es nichts zu enthüllen`)); }
    if (b.gefahr === false && cat.gefahr) fehler.push(fehl('GEFAHR_ABGESCHWAECHT', `Beat ${b.id}: ein Beat ${b.typ} bringt immer Gefahr, die Vorlage darf das nicht abschwächen`));
    fehler.push(...parameterFehler(b, cat));
    fehler.push(...optionenFehler(b, cat));
    // Nacharbeit Welle 3 (Abschluss): ohne `erfolg` waere jeder Abschluss gelungen und zahlte seine Folgen auch nach einem Faden, den die Crew nicht gespielt hat
    if (cat.abschluss) {
      const e = b.erfolg && b.erfolg.ereignis;
      const moegliche = new Set(v.beats.filter((x) => has(B, x.typ) && !B[x.typ].abschluss).map((x) => x.typ + '_gelungen'));
      if (!Array.isArray(e) || !e.length) fehler.push(fehl('ERFOLG_FEHLT', `Beat ${b.id}: der Abschluss braucht erfolg.ereignis (wann gilt der Faden als gelungen: Gedächtnis-Ereignisse der Crew), sonst gäbe er jeden Faden als gelungen aus`));
      else for (const x of e) if (!moegliche.has(x)) fehler.push(fehl('ERFOLG_UNGUELTIG', `Beat ${b.id}: erfolg.ereignis "${x}" kommt in der Vorlage nie vor (erlaubt: ${Array.from(moegliche).join(', ') || 'keines'})`));
    } else if (b.erfolg !== undefined) fehler.push(fehl('ERFOLG_UNGUELTIG', `Beat ${b.id}: erfolg gibt es nur am Abschluss`));
    for (const h of b.hinweise || []) if (!has(hin, h)) fehler.push(fehl('HINWEIS_UNBEKANNT', `Beat ${b.id}: Hinweis "${h}" ist in hinweise nicht beschrieben`));
    // Ausgaenge
    const aus = b.aus || {};
    for (const ag of W.ausgaenge) {
      const o = aus[ag];
      if (!o) { fehler.push(fehl('AUSGANG_FEHLT', `Beat ${b.id}: der Ausgang ${ag} fehlt (jeder Beat hat Ausgänge gelungen und gescheitert)`)); continue; }
      if (o.status !== undefined && !W.status.includes(o.status)) fehler.push(fehl('AUSGANG_UNGUELTIG', `Beat ${b.id}, ${ag}: Status "${o.status}" ist unbekannt`));
      if (namenlos && o.status !== undefined && o.status !== 'aktiv') fehler.push(fehl('NAMENLOS', `Beat ${b.id}, ${ag}: ein namenloser NSC bleibt aktiv (status "${o.status}")`));
      if (o.text_key !== undefined && !(typeof o.text_key === 'string' && TEXT_KEY.test(o.text_key))) fehler.push(fehl('TEXT_KEY', `Beat ${b.id}, ${ag}: text_key "${String(o.text_key).slice(0, 40)}" ist ungültig (nur a-z, 0-9, _, 1 bis 40 Zeichen; der Weltstand verlangt es)`));
      for (const f of o.folge || []) { const r = folgeWirkung(f, 'n1'); if (r.fehler) fehler.push(fehl('FOLGE_UNGUELTIG', `Beat ${b.id}, ${ag}: ${r.fehler}`)); }
      if (cat.abschluss) { if (o.weiter !== undefined) fehler.push(fehl('AUSGANG_UNGUELTIG', `Beat ${b.id}: der Abschluss führt nirgends weiter (weiter ${o.weiter})`)); continue; }
      if (o.status === undefined && !namenlos) fehler.push(fehl('AUSGANG_UNGUELTIG', `Beat ${b.id}, ${ag}: der Zustand des NSC (status) fehlt`));
      if (o.weiter !== undefined) {
        const z = idx.get(o.weiter);
        if (z === undefined) fehler.push(fehl('WEITER_UNGUELTIG', `Beat ${b.id}, ${ag}: weiter "${o.weiter}" ist kein Beat der Vorlage`));
        else if (z <= i) fehler.push(fehl('WEITER_UNGUELTIG', `Beat ${b.id}, ${ag}: weiter "${o.weiter}" geht nicht nach vorn (die Reihenfolge ist vorwärts)`));
      }
    }
    // Nacharbeit SUND-04a-2: eine Wahl muss in der Geschichte etwas aendern. Fuehren zwei Optionen mit verschiedenem Ausgang in DENSELBEN naechsten Beat, haengt der Beat danach davon ab, was
    // dieser Beat tut (Scheinwahl auf Wegebene: bei falscher_haendler lud auch „Ablehnen“ die Ware, weil beide Wege nach b_fracht fuehrten)
    if (!cat.abschluss && Array.isArray(b.optionen) && aus.gelungen && aus.gescheitert) {
      const ags = new Set(b.optionen.map((x) => x && x.ausgang).filter(Boolean));
      if (ags.has('gelungen') && ags.has('gescheitert') && zielIndex(v, i, aus.gelungen, idx) === zielIndex(v, i, aus.gescheitert, idx)) fehler.push(fehl('OPTIONEN_GLEICHER_WEG', `Beat ${b.id}: Annehmen und Ablehnen führen in denselben Beat (${(v.beats[zielIndex(v, i, aus.gelungen, idx)] || {}).id}): die Wahl ändert den Weg nicht`));
    }
    if (!cat.abschluss && aus.gelungen && aus.gescheitert) {
      const nach = (o) => (o.weiter !== undefined ? o.weiter : (v.beats[i + 1] || {}).id);
      const gleicheFolge = !namenlos || folgeProfil(aus.gescheitert.folge) === folgeProfil(aus.gelungen.folge);   // namenlos: ohne Status veraendert Scheitern ueber Weg oder Folge
      if (aus.gescheitert.status === aus.gelungen.status && nach(aus.gescheitert) === nach(aus.gelungen) && gleicheFolge) fehler.push(fehl('SCHEITERN_FOLGENLOS', `Beat ${b.id}: Scheitern verändert den Faden nicht (gleicher Zustand, gleicher Weg wie Gelingen); es muss etwas ändern, ohne den Faden zu beenden`));
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
      // P3: ohne Variante gilt der Beat-Typ mit dem Status s; mit Variante (feindlicher NSC) der Variante-Typ mit Status feindlich (beide Zweige werden geprüft)
      const zweige = b.variante && s !== 'tot' ? [{ c: cat, s, typ: b.typ }, { c: B[b.variante.typ], s: 'feindlich', typ: b.variante.typ }] : [{ c: cat, s, typ: b.typ }];
      for (const z of zweige) {
        const br = z.c.braucht || {};
        if (br.nsc_status && !br.nsc_status.includes(z.s)) m('STATUS_PASST_NICHT', `Beat ${b.id} (${z.typ}) kann nicht laufen, wenn der NSC ${z.s} ist (erlaubt: ${br.nsc_status.join(', ')})`);
        if (br.hinweis_vorher && !h) m('HINWEIS_FEHLT', `Beat ${b.id} (${b.typ}): auf einem Weg dorthin wurde vorher kein Hinweis gestreut (jede Enthüllung braucht mindestens einen Hinweis davor)`);
      }
      if (cat.abschluss) continue;
      const h2 = h || (Array.isArray(b.hinweise) && b.hinweise.length > 0);
      for (const ag of W.ausgaenge) {
        for (const o of b.variante && istObjekt(b.variante.aus) && s !== 'tot' && istObjekt(b.variante.aus[ag]) ? [b.aus[ag], b.variante.aus[ag]] : [b.aus[ag]]) {   // Welle 4 (S1): beide Zweige, auch die Ausgaenge der Variante
          let s2 = s;
          if (o.status !== undefined) { if (s === 'tot' && o.status !== 'tot') m('TOT_BLEIBT_TOT', `Beat ${b.id}, ${ag}: ein toter NSC wird nicht wieder ${o.status}`); else s2 = o.status; }
          const z = zielIndex(v, i, o, idx);
          if (z !== null) stack.push({ i: z, s: s2, h: h2 });
        }
      }
    }
    v.beats.forEach((b, i) => { if (!erreicht.has(i)) fehler.push(fehl('UNERREICHBAR', `Beat ${b.id} wird auf keinem Weg erreicht`)); });
    if (!fehler.some((f) => /^(TYP_UNBEKANNT|FOLGE_UNGUELTIG|OPTION_UNGUELTIG|AUSGANG_UNGUELTIG)/.test(f))) fehler.push(...haltungFehler(v, idx));   // Nacharbeit Welle 3: Haltung erreichbar
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
const PARAM_FELDER = ['volk', 'ort', 'name', 'angebot', 'nsc_von'];   // SUND-04b B1: nsc_von = Kennung eines NSC aus einem frueheren, abgeschlossenen Faden (Wiedersehen)
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

// ---------- Wiedersehen (SUND-04b B1): ein neuer Faden mit einem alten NSC. Der NSC gehoert einem ABGESCHLOSSENEN Faden (ein NSC in einem aktiven Faden ist noch in seiner Geschichte), lebt, gehoert zu einem Volk der
// Vorlage und hat eine konkrete Tat der Crew im Gedaechtnis (Daten b1-texte.json wiedersehen_erinnert). Mehrere Faeden desselben NSC (Wiedersehen mit dem Wiedersehen): der juengste gilt.
const nscAlt = (v) => !!(v && Array.isArray(v.beats) && v.beats[0] && has(B, v.beats[0].typ) && B[v.beats[0].typ].braucht && B[v.beats[0].typ].braucht.nsc_alt === true);
const erinnertTat = (n) => (Array.isArray(n.gedaechtnis) ? n.gedaechtnis : []).some((g) => istObjekt(g) && typeof g.ereignis === 'string' && has(D.B1.werte.wiedersehen_erinnert, g.ereignis));
// Zustand des NSC: er muss zu braucht.nsc_status des ERSTEN Beats der Vorlage passen (Daten beats.json, kein Zustand im Code): ein gefangener, geflohener, feindlicher NSC kehrt nicht als aktiver zurueck
const wiedersehenStatusOk = (v, status) => { const c = v && v.beats && v.beats[0] && B[v.beats[0].typ]; const st = c && c.braucht && c.braucht.nsc_status; return Array.isArray(st) ? st.includes(status) : status !== 'tot'; };
const fadenNr = (f) => Number(String(f.id).replace(/\D/g, '')) || 0;
// Reihenfolge: der juengste Faden (hoechster Faden-Zaehler) zuerst, deterministisch; Aufrufer (Bot, Test) nehmen [0]
function wiedersehenNsc(F, v) {
  const juengster = new Map();
  for (const f of F.liste) { const alt = juengster.get(f.nsc.name); if (!alt || fadenNr(f) >= fadenNr(alt)) juengster.set(f.nsc.name, f); }
  return Array.from(juengster.values()).filter((f) => f.phase === 'abgeschlossen' && wiedersehenStatusOk(v, f.nsc.status) && v.volk_erlaubt.includes(f.nsc.fraktion) && Number.isFinite(f.nsc.haltung) && erinnertTat(f.nsc))
    .sort((a, b) => fadenNr(b) - fadenNr(a)).map((f) => f.nsc);
}
// (die Zahl der NSC je Volk fuer den Kontext der Komposition steht seit SUND-04b E3 in abenteuer-wiederholung.js zahlenFrisch: ohne die Hauptfiguren der letzten Abenteuer)
function pruefeNscVon(F, v, p) {
  if (!has(p, 'nsc_von')) return nscAlt(v) ? fehl('NSC_VON_FEHLT', 'ein Abenteuer mit einem Wiedersehen braucht nsc_von (einen NSC aus einem früheren, abgeschlossenen Faden)') : null;
  if (!nscAlt(v)) return fehl('NSC_VON', 'nsc_von gibt es nur für ein Abenteuer, das mit einem Wiedersehen beginnt');
  const id = p.nsc_von;
  if (typeof id !== 'string' || !/^n[0-9]{1,6}$/.test(id)) return fehl('NSC_VON', 'nsc_von ist keine NSC-Kennung (n und Ziffern)');
  if (has(p, 'name')) return fehl('NSC_VON', 'name und nsc_von schließen sich aus: der Name ist der des NSC');
  const n = wiedersehenNsc(F, v).find((x) => x.id === id);
  if (!n) return fehl('NSC_VON', `der NSC ${id} ist kein NSC eines abgeschlossenen Fadens, dessen Zustand zum ersten Beat passt (nicht tot, gefangen, geflohen, feindlich), der zu den Völkern dieser Vorlage gehört und sich an eine Tat der Crew erinnert`);
  if (p.volk !== undefined && p.volk !== n.fraktion) return fehl('PARAMETER', `volk "${String(p.volk).slice(0, 8)}" passt nicht zum NSC ${id} (${n.fraktion})`);
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
  if (p.ort !== undefined && !(typeof p.ort === 'string' && HEX.test(p.ort) && sundSpielbar(p.ort))) return fehl('PARAMETER', 'ort ist kein spielbarer Sektor');
  const nv = pruefeNscVon(F, v, p);
  if (nv) return nv;
  if (p.name !== undefined) {
    if (!nameOk(p.name, volk)) return fehl('NAME', `name muss aus Vor- und Nachname der Liste des Volkes ${volk} bestehen (NSC entstehen nur aus Datenlisten)`);
    if (!require('./abenteuer-kanon.js').nameFrei(F, p.name)) return fehl('NAME', `der Name ${p.name} ist schon vergeben`);   // SUND-04b E1: auch ein Name aus dem Kanon (der Faden kann schon aus der Liste gefallen sein)
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
  const beat = v.beats[f.beat];
  const eff = effektiv(beat, f.nsc.haltung, f.nsc.status), cat = eff.cat, status = eff.variante ? 'feindlich' : f.nsc.status;   // P3: feindlicher NSC = Variante des Beats
  if (b.beat !== beat.id) return fehl('REIHENFOLGE', `als Nächstes kommt ${beat.id}, nicht ${String(b.beat).slice(0, 32)} (die Reihenfolge der Beats ist fest)`);
  if (f.zaehler < f.abstand) return fehl('ABSTAND', `Faden ${f.id}: erst nach ${f.abstand} Tätigkeiten seit dem letzten Beat (bisher ${f.zaehler})`);
  const br = cat.braucht || {};
  if (br.nsc_status && !br.nsc_status.includes(status)) return fehl('STATUS_PASST_NICHT', `Beat ${beat.id} (${eff.variante ? beat.variante.typ : beat.typ}) läuft nicht mit einem NSC im Zustand ${status}`);
  if (br.wahrheit && !f.nsc.wahrheit) return fehl('ENTHUELLUNG_OHNE_WAHRHEIT', `Faden ${f.id} hat keine verborgene Wahrheit`);
  if (br.hinweis_vorher && !(f.hinweise && f.hinweise.length)) return fehl('HINWEIS_FEHLT', `Faden ${f.id}: vor der Enthüllung wurde noch kein Hinweis gestreut`);
  if (br.fluchtziel && !fluchtzielOk((beat.parameter || {}).fluchtziel)) return fehl('FLUCHTZIEL_FEHLT', `Beat ${beat.id}: ohne Fluchtziel keine Verfolgung`);
  const og = optionenFehler(beat, cat);
  if (og.length) return og[0];
  ctx.weiter.add(f.id);
  return null;
}

// ---------- Lage (SUND-04b B2): ein Beat mit braucht.lage haengt von der Welt ab (Sabotage: ein germanischer Versorgungsposten muss stehen, den die Crew sprengen darf, und die Pause darf nicht laufen). Die Bedingung steht
// in faden-b2.js lage(key); der Pruefer fragt sie beim Anbieten und beim Oeffnen (faden.js abenteuerAnbieten, abenteuerOeffnen, faden_oeffnen). Fehlt die Lage, wird der Plan nicht angeboten und nicht geoeffnet
// (Code LAGE_ZIEL_FEHLT, SABOTAGE_PAUSE); faellt sie zwischen Oeffnen und Beginn des Beats weg, scheitert der Beat sofort (der Baustein) und der Plan geht den Weg des Scheiterns weiter. -> null | 'CODE: Text'
function pruefeLage(game, v) {
  if (!v || !Array.isArray(v.beats)) return null;
  const B2 = require('./faden-b2.js');
  const gefragt = new Set();
  for (const b of v.beats) {
    const c = istObjekt(b) && has(B, b.typ) ? B[b.typ] : null;
    const key = c && c.braucht ? c.braucht.lage : undefined;
    if (key === undefined || gefragt.has(key)) continue;
    gefragt.add(key);
    const l = typeof key === 'string' ? B2.lage(key) : null;
    const g = l ? l.fehler(game) : fehl('LAGE_UNBEKANNT', `Beat ${b.id}: die Lagen-Bedingung "${String(key).slice(0, 30)}" gibt es nicht`);
    if (g) return g;
  }
  return null;
}

// ---------- Abenteuer (SUND-04b A1): der zweite, benannte Weg, einen Faden zu oeffnen (nicht ueber ein Notruf-Angebot, sondern ueber einen geprueften Bauplan)
// Obergrenze aktiv_max und Abstand gelten weiter (der Abstand wird beim Oeffnen gezogen, faden.js); dazu hoechstens laufend_max laufende Abenteuer und hoechstens angebote_max offene Abenteuer-Angebote.
const abenteuerLaufend = (F) => aktive(F).filter((f) => f.plan).length;
function pruefeAbenteuerAnbieten(F, o) {
  if ((F.abenteuerAngebote || []).length >= W.abenteuer.angebote_max) return fehl('ABENTEUER_ANGEBOTE', `hoechstens ${W.abenteuer.angebote_max} offene Abenteuer-Angebote`);
  if (!(istObjekt(o) && typeof o.hex === 'string' && HEX.test(o.hex) && sundSpielbar(o.hex))) return fehl('PARAMETER', 'hex (Ort des Abenteuers) ist kein spielbarer Sektor');
  return null;
}
function pruefeAbenteuerOeffnen(F, nr, p) {
  p = p === undefined ? {} : p;
  if (!istObjekt(p)) return fehl('PARAMETER', 'parameter ist kein Objekt');
  for (const k of Object.keys(p)) if (!['volk', 'name', 'nsc_von'].includes(k)) return fehl('PARAMETER', `unbekannter Parameter "${k}" (erlaubt: volk, name, nsc_von)`);
  const a = Number.isInteger(nr) ? (F.abenteuerAngebote || []).find((x) => x.nr === nr) : null;
  if (!a) return fehl('KEIN_ANGEBOT', `ein Abenteuer-Angebot ${String(nr).slice(0, 12)} gibt es nicht (mehr)`);
  if (aktive(F).length >= W.aktiv_max) return fehl('OBERGRENZE', `hoechstens ${W.aktiv_max} aktive Faeden`);
  if (abenteuerLaufend(F) >= W.abenteuer.laufend_max) return fehl('ABENTEUER_LAUFEND', `hoechstens ${W.abenteuer.laufend_max} laufendes Abenteuer`);
  const v = a.vorlage;
  if (p.volk !== undefined && !v.volk_erlaubt.includes(p.volk)) return fehl('PARAMETER', `volk "${p.volk}" ist fuer dieses Abenteuer nicht erlaubt (${v.volk_erlaubt.join(', ')})`);
  const volk = p.volk || (v.volk_erlaubt.includes(a.volk) ? a.volk : v.volk_erlaubt[0]);
  const nv = pruefeNscVon(F, v, p);
  if (nv) return nv;
  if (p.name !== undefined) {
    if (!nameOk(p.name, volk)) return fehl('NAME', `name muss aus Vor- und Nachname der Liste des Volkes ${volk} bestehen (NSC entstehen nur aus Datenlisten)`);
    if (!require('./abenteuer-kanon.js').nameFrei(F, p.name)) return fehl('NAME', `der Name ${p.name} ist schon vergeben`);   // SUND-04b E1: auch ein Name aus dem Kanon (der Faden kann schon aus der Liste gefallen sein)
  }
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

module.exports = { sundSpielbar, nscAlt, wiedersehenNsc, pruefeNscVon, pruefeLage, pruefeAbenteuerAnbieten, pruefeAbenteuerOeffnen, abenteuerLaufend, abschlussGelungen, haltungsWege, tonFuer, effektiv, katalogFehler, TEXT_KEY, pruefeVorlage, pruefeFaden, pruefeOeffnen, pruefeWeiter, befehlPruefen, istBefehl, neuerKontext, folgeWirkung, folgeProfil, optionenFehler, fluchtzielOk, aktive, nameOk, BEFEHL_FELDER, PARAM_FELDER };
