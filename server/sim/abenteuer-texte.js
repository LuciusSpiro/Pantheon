'use strict';
// SPL-02 E2: der Bogen und die Bezuege einer Absicht wirken auf den TEXT der Beats. Action-Layer: reine Regeln auf Absicht, Inszenierung und Weltstand, kein Modellaufruf, kein Zufall. Alle Texte, Zahlen und Wortlisten stehen
// in Daten: je Absicht `texte` in content/faeden/absichten.json (Slots mit Szene, Bezug-Fakten, Bogen-Feldern, Ton, Rueckfall; Wendungen mit eigenem Fakt), die uebrigen Bausteine in content/faeden/abenteuer-texte.json, Slots,
// Laengen und Pruefregeln in content/texte/texte-werte.json (slots_abenteuer, bezug_pruefung, anreden). Dieses Modul kennt keinen Absichtsnamen, keinen Beat-Typ und keinen Slotnamen.
// Die Fadenmaschine (faden*.js) bleibt unveraendert und ruft diese Schicht noch NICHT: der Haken `zeile` ist die benannte Stelle, die sie spaeter aufruft (Vorschlag im Bericht von SPL-02 E2).
//
// Ablauf: die Absicht wird angenommen (abenteuer-absicht.js) > anmelden() merkt sich den Plan (Vorlage-Id) und meldet je Slot, der zu ihrem Rezept passt, eine Spec beim Text-Pool an (nur mit TEXTE_POOL) >
// der Pool erzeugt im Hintergrund Zeilen mit Platzhaltern (Pruefer: Namen nur als {nsc}, {ort}, {ware}, keine Erfindungen, Anrede) > ein Beat fragt zeile() nach dem Text: Pool-Zeile, sonst der Rueckfall der Absicht (Daten,
// nach Zustand und Haltung des NSC, nie erzwungener Dank), sonst null (dann gilt der Text der Fadenmaschine wie heute).
//
//   specsFuer(game, absicht, inszenierung, angebot?, katalog?) -> { eintraege: [{ slot, beat: { nr, id, typ }, spec, rueckfall }], fehler: [{ code, feld, grund }] }
//        spec = Format poolBefuellenAnfordern ({ art, id, slot, optionId, sprecher, stimme, fakt, beispiele, platzhalter, pflicht, muss, nicht, ziel, bezug: true, anrede? }); fakt traegt nur Platzhalter, nie einen Klartextnamen
//        und nie einen Spielernamen (Felder des Bogens mit Namen im Klartext fallen weg). Ein Bezug, den die Welt nicht kennt, gibt BEZUG_UNBEKANNT und keine Spec.
//   anmelden(game, absicht, inszenierung, angebot, katalog?) -> { ref, eintraege: [{ slot, beat, key, angemeldet }], fehler } | null     merkt den Plan (immer) und meldet beim Pool an (nur mit Schalter TEXTE_POOL)
//   zeile(game, faden, beatId, slot, werte?) -> { text, quelle: 'pool' | 'rueckfall', key } | null       DER HAKEN: Text fuer diesen Slot dieses Beats; null = kein Eintrag, der Aufrufer nimmt seinen Text
//        werte { nsc, ort, ware }: Standard Vollname des NSC des Plans, Ortsname des Fadens, Name der Ware aus dem Parameter der Absicht
//   pruefeZeile(text, spec, namen?) -> { ok, text, fehler[] }     dieselbe Pruefung wie im Pool (texte-pruefer.js pruefe, mit bezug und anrede der Spec)
//   texteFehler(katalog, name, eintrag) -> [Text]      `texte` einer Absicht ist stimmig (Slots, Beats, Platzhalter, Wendungen, Rueckfalltexte bestehen den Pruefer)
//   werteFehler() -> [Text]     die Daten abenteuer-texte.json sind stimmig        werteNeuLesen() / zuruecksetzen()
const fs = require('fs');
const path = require('path');
const D = require('./faden-daten.js');
const Sektoren = require('../../shared/sektoren.js');

const Pool = () => require('./texte-pool.js');
const Pruefer = () => require('./texte-pruefer.js');
const Namen = () => require('./namen-liste.js');
const Faden = () => require('./faden.js');
const Kanon = () => require('./abenteuer-kanon.js');
const Fracht = () => require('./faden-fracht.js');
const Ausschnitt = () => require('./lage-ausschnitt.js');

const DATEI = path.join(D.DIR, 'abenteuer-texte.json');
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const istObjekt = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const text = (x) => typeof x === 'string' && x.trim().length > 0;
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nr = (id) => Number(String(id).replace(/\D/g, '')) || 0;

// Das Vokabular dieses Moduls (Arten von Regeln, nicht Namen von Absichten, Beats oder Slots)
const BEAT = Object.freeze({ ERSTER: 'erster', LETZTER: 'letzter', WENDUNG: 'nach_wendung' });   // Beat-Regeln: der erste, der letzte, der erste Beat, den die Wendung des Bogens einbaut
const BEZUG = Object.freeze({ NSC_STATUS: 'nsc_status', AUSGANG: 'ausgang', HALTUNG: 'haltung' });
const SLOT_FELDER = ['beat', 'szene', 'bezug', 'bogen', 'ton', 'platzhalter', 'pflicht', 'muss', 'nicht', 'rueckfall'];
const TEXTE_FELDER = ['sprecher', 'stimme', 'stimme_aus_volk', 'anrede', 'slots', 'wendungen'];
const KEINE_WENDUNG = 'keine';
const BEZUG_UNBEKANNT = 'BEZUG_UNBEKANNT';   // Code des Pruefers der Absichten (absicht-pruefer.js CODES), gleiches Format; hier nicht geladen (nur die Anbindung abenteuer-absicht.js laedt den Pruefer)
const ausnahmenVon = (katalog) => katalog.werte.gewoehnliche_woerter.wert;   // Woerter der Namenslisten, die auch gewoehnliche Woerter sind (Dorn, Rabe)

// ---------- Daten
let cache = null;
function lesen() {
  if (!cache) {
    const roh = JSON.parse(fs.readFileSync(DATEI, 'utf8'));
    cache = { werte: Object.fromEntries(Object.entries(roh.werte).map(([k, v]) => [k, v.wert])), roh };
  }
  return cache;
}
const werteNeuLesen = () => { cache = null; return lesen().werte; };
const werte = () => lesen().werte;

// ---------- Zuordnung Plan -> Slots (Laufzeit wie der Pool, nicht im Weltstand)
let REG = new Map();
const zuruecksetzen = () => { REG = new Map(); };

// ---------- Welt (nur lesend)
const faedenZustand = (game) => { try { return Faden().aktiv(game) ? Faden().zustandVon(game) : null; } catch (e) { return null; } };
// Zustand des NSC dieses Vollnamens: Status, Haltung und Volk vom juengsten Faden der Liste, sonst vom Kanon; Ausgang des juengsten abgeschlossenen Kanon-Eintrags
function nscZustand(game, name) {
  const F = faedenZustand(game);
  if (!F || typeof name !== 'string' || !name) return null;
  let nsc = null, n = -1;
  for (const f of F.liste || []) if (f.nsc && f.nsc.name === name && nr(f.id) >= n) { n = nr(f.id); nsc = f.nsc; }
  let e = null;
  for (const x of Kanon().liste(F)) if (x.name === name && x.ausgang !== undefined && (!e || nr(x.f) >= nr(e.f))) e = x;
  if (!nsc && !e) return null;
  return { status: nsc ? nsc.status : e.status, haltung: nsc && Number.isFinite(nsc.haltung) ? nsc.haltung : null, volk: nsc ? nsc.fraktion : e.volk, ausgang: e ? e.ausgang : null };
}
const ortName = (hex) => { try { return Sektoren.hexName(hex) || String(hex); } catch (e) { return String(hex); } };
const bandVon = (liste, h) => { for (let i = 0; i < liste.length; i++) if (h <= liste[i].bis) return i; return liste.length - 1; };

// Namen im Freitext durch Platzhalter ersetzen: der volle Name, danach seine Woerter (Claude schreibt "Quintus" statt "Quintus Varro")
function platzhalterSetzen(t, namen) {
  let s = String(t);
  const paare = Object.entries(namen).filter(([, n]) => typeof n === 'string' && n.length >= 3).sort((a, b) => b[1].length - a[1].length);
  for (const [k, n] of paare) {
    s = s.split(n).join('{' + k + '}');
    if (/\s/.test(n)) for (const w of n.split(/\s+/).filter((x) => x.length >= 3)) s = s.replace(new RegExp('(?<![\\p{L}{])' + esc(w) + '(?![\\p{L}}])', 'gu'), '{' + k + '}');
  }
  return s;
}
// Bleibt im Freitext ein Klartext-Eigenname oder ein Spielername, darf er nicht in den fakt
function sauber(game, t, ausnahmen) {
  if (Namen().klartextNamen(t, ausnahmen).length) return false;
  const A = Ausschnitt(), namen = A.spielerNamen(game || {});
  return !(namen && namen.length && A.ohneNamen(t, namen) !== t);
}

// ---------- Beat zu einem Slot
function beatVon(vorlage, regel, wendungDef) {
  const beats = vorlage && Array.isArray(vorlage.beats) ? vorlage.beats : [];
  if (!beats.length) return null;
  let i = -1;
  if (regel === BEAT.ERSTER) i = 0;
  else if (regel === BEAT.LETZTER) i = beats.length - 1;
  else if (regel === BEAT.WENDUNG && wendungDef) { const k = beats.findIndex((b) => b.id === wendungDef.nach || b.typ === wendungDef.nach); i = k >= 0 && k + 1 < beats.length ? k + 1 : -1; }   // der erste eingebaute Beat der Wendung (wie planBauen im Inszenierer)
  if (i < 0) return null;
  const b = beats[i];
  return { nr: i, id: typeof b.id === 'string' ? b.id : `${b.typ}${i}`, typ: b.typ };
}

// ---------- fakt und Spec
function bezugSatz(W, art, z) {
  if (!z) return '';
  const F = W.bezug_fakten;
  if (art === BEZUG.NSC_STATUS) return has(F.nsc_status, z.status) ? F.nsc_status[z.status] : '';
  if (art === BEZUG.AUSGANG) return z.ausgang && has(F.ausgang, z.ausgang) ? F.ausgang[z.ausgang] : '';
  if (art === BEZUG.HALTUNG) return Number.isFinite(z.haltung) ? F.haltung[bandVon(F.haltung, z.haltung)].text : '';
  return '';
}
function variante(W, cfg, sym, z, stimme, ton) {
  const t = [stimme];
  if (cfg.beat === BEAT.WENDUNG && sym) t.push(sym);
  for (const art of cfg.bezug || []) {
    if (!z) continue;
    if (art === BEZUG.NSC_STATUS && z.status) t.push(z.status);
    if (art === BEZUG.AUSGANG && z.ausgang) t.push(z.ausgang);
    if (art === BEZUG.HALTUNG && Number.isFinite(z.haltung)) t.push('h' + bandVon(W.bezug_fakten.haltung, z.haltung));
  }
  if (cfg.ton && ton) t.push(ton);
  return t.join('.');
}
function faktBauen(game, W, cfg, a, z, wendungDef, namen, anredeSatz, ausnahmen) {
  const fest = [cfg.szene];
  if ((cfg.platzhalter || []).includes('nsc')) fest.push(W.sprecher_fakt);
  if (cfg.beat === BEAT.WENDUNG && wendungDef && text(wendungDef.fakt)) fest.push(wendungDef.fakt);
  for (const art of cfg.bezug || []) { const s = bezugSatz(W, art, z); if (s) fest.push(s); }
  const optional = [];
  if (cfg.ton && a.ton && has(W.ton_fakten, a.ton)) optional.push(W.ton_fakten[a.ton]);
  const bogen = istObjekt(a.bogen) ? a.bogen : {};
  const weggelassen = [];
  for (const feld of cfg.bogen || []) {
    const roh = bogen[feld];
    if (!text(roh) || !has(W.bogen_fakten, feld)) continue;
    const t = platzhalterSetzen(roh.trim(), namen);
    if (!sauber(game, t, ausnahmen)) { weggelassen.push(feld); continue; }
    optional.push(W.bogen_fakten[feld].split('{text}').join(t));
  }
  if (anredeSatz) fest.push(anredeSatz);
  let fakt = fest.concat(optional).join(' ');
  while (fakt.length > W.fakt_max && optional.length) { weggelassen.push('baustein'); optional.pop(); fakt = fest.concat(optional).join(' '); }
  return { fakt, weggelassen };
}
const einsetzen = (t, w) => Pool().einsetzen(t, w);
const offen = (t) => /\{\w+\}/.test(t);

function specsFuer(game, absicht, inszenierung, angebot, katalog) {
  const out = { eintraege: [], fehler: [] };
  if (!istObjekt(katalog) || !istObjekt(katalog.absichten)) return out;   // der Katalog kommt vom Aufrufer (abenteuer-absicht.js)
  const a = absicht || {};
  const kat = istObjekt(katalog.absichten) && has(katalog.absichten, a.absicht) ? katalog.absichten[a.absicht] : null;
  if (!kat || !istObjekt(kat.texte)) return out;
  const W = werte(), T = kat.texte, PW = Pruefer().WERTE;
  const rez = istObjekt(kat.inszenierung) ? kat.inszenierung : {};
  const vorlage = (angebot && angebot.vorlage) || (inszenierung && inszenierung.plan) || null;
  const bezug = istObjekt(a.bezug) ? a.bezug : {};
  const z = typeof bezug.nsc === 'string' ? nscZustand(game, bezug.nsc) : null;
  if (typeof bezug.nsc === 'string' && !z) {
    out.fehler.push({ code: BEZUG_UNBEKANNT, feld: 'bezug.nsc', grund: 'die Welt kennt den NSC dieses Bezugs nicht: keine Zeilen mit Bezug' });
    return out;
  }
  const stimme = T.stimme_aus_volk && z && has(PW.stimmen, z.volk) ? z.volk : T.stimme;
  const sym = istObjekt(a.bogen) && text(a.bogen.wendung) && a.bogen.wendung !== KEINE_WENDUNG ? a.bogen.wendung : null;
  const namen = { nsc: typeof bezug.nsc === 'string' ? bezug.nsc : '', ort: inszenierung && inszenierung.hex ? ortName(inszenierung.hex) : '' };
  for (const [slot, cfg] of Object.entries(T.slots || {})) {
    let wendungDef = null, wendungTexte = null;
    if (cfg.beat === BEAT.WENDUNG) {
      wendungTexte = sym && istObjekt(T.wendungen) && has(T.wendungen, sym) ? T.wendungen[sym] : null;
      wendungDef = sym && istObjekt(rez.wendungen) && has(rez.wendungen, sym) ? rez.wendungen[sym] : null;
      if (!wendungTexte || !wendungDef) continue;   // keine Wendung im Bogen, oder keine mit Zeilen: kein Slot
    }
    const beat = beatVon(vorlage, cfg.beat, wendungDef);
    if (!beat) continue;
    const { fakt, weggelassen } = faktBauen(game, W, cfg, a, z, wendungTexte, namen, T.anrede ? PW.anreden[T.anrede].fakt : '', ausnahmenVon(katalog));
    const rueckfall = (cfg.rueckfall || []).concat(wendungTexte && Array.isArray(wendungTexte.rueckfall) ? wendungTexte.rueckfall : []);
    const spec = {
      art: W.pool_art, id: a.absicht, slot, optionId: variante(W, cfg, sym, z, stimme, a.ton),
      sprecher: T.sprecher, stimme, fakt, beispiele: rueckfall.map((r) => r.text),
      platzhalter: (cfg.platzhalter || []).slice(), pflicht: (cfg.pflicht || []).slice(), muss: (cfg.muss || []).slice(), nicht: (cfg.nicht || []).slice(), ziel: W.ziel, bezug: true, ausnahmen: ausnahmenVon(katalog).slice(),
    };
    if (T.anrede) spec.anrede = T.anrede;
    out.eintraege.push(Object.assign({ slot, beat, spec, rueckfall }, weggelassen.length ? { weggelassen } : {}));
  }
  return out;
}

function anmelden(game, absicht, inszenierung, angebot, katalog) {   // katalog: der Katalog der Absichten (abenteuer-absicht.js gibt ihn mit)
  const ref = angebot && typeof angebot.ref === 'string' ? angebot.ref : null;
  if (!ref) return null;
  const r = specsFuer(game, absicht, inszenierung, angebot, katalog);
  const W = werte();
  const slots = {};
  const pool = Pool(), poolAn = pool.aktiv(game);
  const eintraege = r.eintraege.map((e) => {
    const key = pool.keyVon(e.spec.art, e.spec.id, e.spec.slot, e.spec.optionId);
    const an = poolAn ? pool.poolBefuellenAnfordern(e.spec).ok === true : false;
    slots[e.slot] = { beat: e.beat.id, key, spec: e.spec, rueckfall: e.rueckfall, angemeldet: an };
    return { slot: e.slot, beat: e.beat, key, angemeldet: an };
  });
  if (eintraege.length) {
    REG.delete(ref);
    REG.set(ref, { absicht: absicht.absicht, nsc: istObjekt(absicht.bezug) && typeof absicht.bezug.nsc === 'string' ? absicht.bezug.nsc : null, ware: istObjekt(absicht.parameter) && typeof absicht.parameter.ware === 'string' ? absicht.parameter.ware : null, slots });
    while (REG.size > W.eintraege_max) REG.delete(REG.keys().next().value);
  }
  return { ref, eintraege, fehler: r.fehler };
}

// ---------- Rueckfall (Daten): der erste Eintrag, dessen Bedingung zum Zustand des NSC passt
function wennGilt(w, z) {
  if (!istObjekt(w)) return true;
  if (Array.isArray(w.nsc_status) && !(z && w.nsc_status.includes(z.status))) return false;
  if (Number.isFinite(w.haltung_hoechstens) && !(z && Number.isFinite(z.haltung) && z.haltung <= w.haltung_hoechstens)) return false;
  if (Number.isFinite(w.haltung_mindestens) && !(z && Number.isFinite(z.haltung) && z.haltung >= w.haltung_mindestens)) return false;
  return true;
}
const rueckfallWaehlen = (liste, z) => { for (const r of liste || []) if (r && text(r.text) && wennGilt(r.wenn, z)) return r.text; return null; };

function werteVon(e, faden, w) {
  const out = Object.assign({}, w || {});
  const nsc = out.nsc !== undefined ? out.nsc : (e.nsc || (faden && faden.nsc && faden.nsc.name) || '');
  if (nsc) out.nsc = nsc;
  if (out.ort === undefined && faden && faden.parameter && faden.parameter.ort) out.ort = ortName(faden.parameter.ort);
  if (out.ware === undefined && e.ware) { try { const x = Fracht().WAREN[e.ware]; if (x && x.name) out.ware = x.name; } catch (err) { /* ohne Ware: der Platzhalter bleibt, der Text faellt auf den Rueckfall */ } }
  return out;
}
// DER HAKEN der Fadenmaschine: Zeile fuer diesen Slot dieses Beats. Pool-Zeile (mit Schalter und ohne Spielernamen des Raums), sonst der Rueckfall der Absicht, sonst null.
function zeile(game, faden, beatId, slot, w) {
  const e = faden && typeof faden.vorlage === 'string' ? REG.get(faden.vorlage) : null;
  if (!e || !has(e.slots, slot)) return null;
  const s = e.slots[slot];
  if (s.beat !== beatId) return null;
  const wv = werteVon(e, faden, w);
  const t = Pool().poolFuer(game, s.spec.art, s.spec.id, slot, s.spec.optionId);
  if (t) { const x = einsetzen(t, wv); if (!offen(x)) return { text: x, quelle: 'pool', key: s.key }; }
  const z = e.nsc ? nscZustand(game, e.nsc) : null;
  const r = rueckfallWaehlen(s.rueckfall, z);
  if (r) { const x = einsetzen(r, wv); if (!offen(x)) return { text: x, quelle: 'rueckfall', key: s.key }; }
  return null;
}

function pruefeZeile(t, spec, namen) {
  return Pruefer().pruefe(t, { slot: spec.slot, platzhalter: spec.platzhalter, pflicht: spec.pflicht, stimme: spec.stimme, namen: namen || [], vorhanden: spec.beispiele || [], muss: spec.muss, nicht: spec.nicht, fakt: spec.fakt, bezug: spec.bezug, ausnahmen: spec.ausnahmen, anrede: spec.anrede });
}

// ---------- Daten stimmig
const platzhalterVon = (t) => [...String(t).matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
const regexOk = (m) => { try { return typeof m === 'string' && !!new RegExp(m, 'i'); } catch (e) { return false; } };
function texteFehler(katalog, name, e) {
  const out = [];
  const g = (t) => out.push(`TEXTE: ${name}: ${t}`);
  const T = e.texte;
  if (!istObjekt(T)) { g('texte ist kein Objekt'); return out; }
  const PW = Pruefer().WERTE, W = werte();
  for (const k of Object.keys(T)) if (!TEXTE_FELDER.includes(k)) g(`unbekanntes Feld ${k}`);
  if (!text(T.sprecher)) g('sprecher fehlt (Rolle ohne Namen)');
  else if (Namen().klartextNamen(T.sprecher, ausnahmenVon(katalog)).length) g('sprecher nennt einen Namen');
  if (!has(PW.stimmen, T.stimme)) g(`stimme ist eine von ${Object.keys(PW.stimmen).join(', ')}`);
  if (T.anrede !== undefined && !has(PW.anreden, T.anrede)) g(`anrede ist eine von ${Object.keys(PW.anreden).join(', ')}`);
  const bezugArten = (Array.isArray(e.bezug) ? e.bezug : []).map((b) => b.name);
  const hatNsc = bezugArten.includes('nsc');
  if (T.stimme_aus_volk !== undefined && typeof T.stimme_aus_volk !== 'boolean') g('stimme_aus_volk ist wahr oder falsch');
  if (T.stimme_aus_volk === true && !hatNsc) g('stimme_aus_volk braucht den Bezug nsc');
  const wend = istObjekt(e.inszenierung) && istObjekt(e.inszenierung.wendungen) ? e.inszenierung.wendungen : {};
  const symbole = (Array.isArray(e.wendungen) ? e.wendungen : []).filter((s) => s !== KEINE_WENDUNG);
  const erlaubtPh = (cfgPh) => (Array.isArray(cfgPh) ? cfgPh : []).every((p) => PW.platzhalter_erlaubt.includes(p) && (p !== 'nsc' || hatNsc) && (p !== 'ware' || (istObjekt(e.parameter) && has(e.parameter, 'ware'))));
  const phNur = (t, erlaubt, wo) => { for (const p of platzhalterVon(t)) if (!erlaubt.includes(p)) g(`${wo}: Platzhalter {${p}} ist nicht erlaubt`); };
  const pruefeRueckfall = (liste, wo, cfg) => {
    if (liste === undefined) return;
    if (!Array.isArray(liste) || !liste.length) { g(`${wo}.rueckfall ist eine nicht leere Liste`); return; }
    liste.forEach((r, i) => {
      const w = `${wo}.rueckfall[${i}]`;
      if (!istObjekt(r) || !text(r.text)) { g(`${w}: { wenn?, text }`); return; }
      if (r.wenn !== undefined) {
        const x = r.wenn;
        if (!istObjekt(x) || Object.keys(x).some((k) => !['nsc_status', 'haltung_hoechstens', 'haltung_mindestens'].includes(k))) g(`${w}.wenn: nsc_status (Liste), haltung_hoechstens, haltung_mindestens`);
        else {
          if (x.nsc_status !== undefined && !(Array.isArray(x.nsc_status) && x.nsc_status.length && x.nsc_status.every((s) => typeof s === 'string'))) g(`${w}.wenn.nsc_status ist eine Liste von Texten`);
          for (const k of ['haltung_hoechstens', 'haltung_mindestens']) if (x[k] !== undefined && !Number.isFinite(x[k])) g(`${w}.wenn.${k} ist eine Zahl`);
          if (!hatNsc && Object.keys(x).length) g(`${w}.wenn braucht den Bezug nsc`);
        }
      }
      const pr = Pruefer().pruefe(r.text, { slot: cfg.slot, platzhalter: cfg.platzhalter, pflicht: cfg.pflicht, stimme: T.stimme, vorhanden: [], muss: cfg.muss, nicht: cfg.nicht, fakt: cfg.fakt, bezug: true, ausnahmen: ausnahmenVon(katalog), anrede: T.anrede });
      if (!pr.ok) g(`${w} besteht den Pruefer nicht: ${pr.fehler.join('; ')}`);
    });
  };
  if (!istObjekt(T.slots) || !Object.keys(T.slots).length) g('slots fehlt (mindestens ein Slot)');
  let wendungSlots = 0;
  for (const [slot, c] of Object.entries(istObjekt(T.slots) ? T.slots : {})) {
    const wo = `slots.${slot}`;
    if (!has(PW.slots_abenteuer, slot)) { g(`${wo}: kein Slot der Abenteuer-Zeilen (${Object.keys(PW.slots_abenteuer).join(', ')})`); continue; }
    if (!istObjekt(c)) { g(`${wo}: kein Objekt`); continue; }
    for (const k of Object.keys(c)) if (!SLOT_FELDER.includes(k)) g(`${wo}: unbekanntes Feld ${k}`);
    if (!Object.values(BEAT).includes(c.beat)) g(`${wo}.beat ist einer von ${Object.values(BEAT).join(', ')}`);
    if (c.beat === BEAT.WENDUNG) wendungSlots++;
    if (!text(c.szene)) g(`${wo}.szene fehlt`);
    if (!Array.isArray(c.platzhalter) || !erlaubtPh(c.platzhalter)) g(`${wo}.platzhalter: Liste erlaubter Platzhalter (nsc nur mit Bezug nsc, ware nur mit Parameter ware)`);
    const ph = Array.isArray(c.platzhalter) ? c.platzhalter : [];
    if (!Array.isArray(c.pflicht) || !c.pflicht.every((p) => ph.includes(p))) g(`${wo}.pflicht: Liste, nur aus platzhalter`);
    if (c.bezug !== undefined && !(Array.isArray(c.bezug) && c.bezug.every((x) => Object.values(BEZUG).includes(x)))) g(`${wo}.bezug: Liste aus ${Object.values(BEZUG).join(', ')}`);
    if ((c.bezug || []).length && !hatNsc) g(`${wo}.bezug braucht den Bezug nsc der Absicht`);
    if (c.bogen !== undefined && !(Array.isArray(c.bogen) && c.bogen.every((x) => has(W.bogen_fakten, x) && katalog.werte.bogen_felder.wert.includes(x)))) g(`${wo}.bogen: Liste aus ${Object.keys(W.bogen_fakten).join(', ')}`);
    if (c.ton !== undefined && typeof c.ton !== 'boolean') g(`${wo}.ton ist wahr oder falsch`);
    for (const k of ['muss', 'nicht']) if (c[k] !== undefined && !(Array.isArray(c[k]) && c[k].every(regexOk))) g(`${wo}.${k}: Liste gueltiger Muster`);
    phNur(c.szene || '', ph, `${wo}.szene`);
    pruefeRueckfall(c.rueckfall, wo, { slot, platzhalter: ph, pflicht: c.pflicht || [], muss: c.muss, nicht: c.nicht, fakt: c.szene });
    if (c.beat === BEAT.WENDUNG) for (const [s, d] of Object.entries(istObjekt(T.wendungen) ? T.wendungen : {})) { phNur(d && d.fakt ? d.fakt : '', ph, `wendungen.${s}.fakt`); pruefeRueckfall(d && d.rueckfall, `wendungen.${s}`, { slot, platzhalter: ph, pflicht: c.pflicht || [], muss: c.muss, nicht: c.nicht, fakt: `${c.szene} ${d && d.fakt ? d.fakt : ''}` }); }
  }
  if (T.wendungen !== undefined) {
    if (!istObjekt(T.wendungen)) g('wendungen ist kein Objekt');
    else for (const [s, d] of Object.entries(T.wendungen)) {
      if (!symbole.includes(s) || !has(wend, s)) g(`wendungen.${s}: keine Wendung dieser Absicht (Katalog wendungen und Rezept)`);
      if (!istObjekt(d) || !text(d.fakt)) g(`wendungen.${s}.fakt fehlt`);
    }
  }
  if (wendungSlots && !istObjekt(T.wendungen)) g('ein Slot mit beat wendung braucht Eintraege unter wendungen');
  if (wendungSlots > 0 && istObjekt(T.wendungen) && !symbole.some((s) => has(T.wendungen, s))) g('kein Wendungs-Eintrag passt zu einer Wendung der Absicht');
  return out;
}

function werteFehler() {
  const out = [];
  const f = (t) => out.push(`ABENTEUER_TEXTE_WERTE: ${t}`);
  let roh;
  try { roh = JSON.parse(fs.readFileSync(DATEI, 'utf8')); } catch (e) { f('Datei nicht lesbar'); return out; }
  if (roh.format !== 'abenteuer-texte/1' || !istObjekt(roh.werte)) { f('format "abenteuer-texte/1" und werte fehlen'); return out; }
  const W = {};
  for (const [k, v] of Object.entries(roh.werte)) { if (!istObjekt(v) || !('wert' in v) || typeof v.einheit !== 'string' || typeof v._hinweis !== 'string') f(`${k}: wert, einheit, _hinweis`); else W[k] = v.wert; }
  if (!text(W.pool_art)) f('pool_art: Text');
  if (!text(W.sprecher_fakt) || !W.sprecher_fakt.includes('{nsc}')) f('sprecher_fakt: Satz mit {nsc}');
  for (const k of ['ziel', 'fakt_max', 'eintraege_max']) if (!(Number.isInteger(W[k]) && W[k] >= 1)) f(`${k}: ganze Zahl ab 1`);
  if (Number.isInteger(W.ziel) && (W.ziel < 1 || W.ziel > 5)) f('ziel: 1 bis 5 (Pool)');
  const bf = W.bezug_fakten;
  if (!istObjekt(bf) || !istObjekt(bf.nsc_status) || !istObjekt(bf.ausgang) || !Array.isArray(bf.haltung) || !bf.haltung.length) f('bezug_fakten: nsc_status, ausgang (Objekte), haltung (Liste)');
  else {
    for (const t of Object.values(bf.nsc_status).concat(Object.values(bf.ausgang))) if (!text(t) || platzhalterVon(t).some((p) => p !== 'nsc')) f('bezug_fakten: Saetze mit hoechstens dem Platzhalter {nsc}');
    let alt = -Infinity;
    for (const h of bf.haltung) { if (!istObjekt(h) || !Number.isFinite(h.bis) || h.bis <= alt || typeof h.text !== 'string') f('bezug_fakten.haltung: { bis, text } mit steigendem bis'); else alt = h.bis; }
    if (bf.haltung.length && bf.haltung[bf.haltung.length - 1].bis < 99) f('bezug_fakten.haltung: die letzte Zeile deckt den Rest ab (bis 99)');
  }
  if (!istObjekt(W.ton_fakten) || !Object.values(W.ton_fakten).every(text)) f('ton_fakten: Satz je Ton');
  if (!istObjekt(W.bogen_fakten) || !Object.values(W.bogen_fakten).every((t) => text(t) && t.includes('{text}'))) f('bogen_fakten: Satz mit {text} je Feld');
  return out;
}

module.exports = { specsFuer, anmelden, zeile, pruefeZeile, texteFehler, werteFehler, werteNeuLesen, zuruecksetzen, werte, platzhalterSetzen, nscZustand };
