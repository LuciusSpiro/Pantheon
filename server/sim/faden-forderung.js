'use strict';
// BEA-01 A: Baustein der Forderung (Action-Layer wie faden-bitte.js). Ein Gegner (Zollschiff, Freibeuter) stellt die Lerche per Funk-Ultimatum; die Crew antwortet ueber die Antwortleiste der Bitten
// (world.bitte, Befehl faden.bitte, die ERSTE Antwort gilt, keine Protokollaenderung). Der Baustein ist die Daten-Seite: WER spricht, WAS er sagt und WAS eine Option kostet, steht in
// content/faeden/forderung-texte.json, forderung-werte.json und im Beat-Katalog (beats.json: text_key_standard, optionen_wirkung, ware_bei_scheitern); im Code steht kein Beat- oder Optionsname.
// Ein Beat hat nur zwei Ausgaenge. Die Wahlen laufen deshalb ueber die Ausgaenge zweier Beats (siehe Katalog), nie ueber einen dritten Ausgang.
//
// Was der Baustein tut (alle Haken liest faden-bitte.js beim Baustein, nie beim Namen):
//   angebot: true                                  der Baustein bietet seine Optionen ueber die Antwortleiste an (faden-bitte.js leiste)
//   absender(beat, f) -> { name, fraktion, portrait, kopf } | null     wer fordert (rein aus den Daten, auch beim Laden des Weltstands)
//   text(game, f, beat) -> string | null            der Text des Ultimatums mit {forderer} {ware} {ort} {marken}; null = kein Text (die Bitte wird nicht angeboten)
//   optionPruefen(game, f, beat, opt) -> null | { code, text }       VOR der Wahl: geht die Option? (kostet sie Marken, muss das Guthaben reichen; sonst Funk der Lerche, die Wahl bleibt offen)
//   optionGewaehlt(game, f, beat, opt)              NACH der Antwort der Crew, vor dem Ausgang: bucht die Kosten (Geld.bestechungZahlen), der Forderer antwortet per Funk, Regie-Logbuch
//   starten(game, faden, ctx)                       wie der Baustein der Bitten (Angebot, Hinweise, die Antwort kommt spaeter)
//   datenFehler() -> [Text]                         Konsistenz der Daten (Tests): Texte, Forderer, Kosten, Katalogfelder
// Die Ware verlieren (Ausliefern) oder behalten (Verweigern) regelt NICHT dieser Baustein, sondern der Ausgang des Beats (faden-fracht.js behaeltWare, Katalogfeld ware_bei_scheitern).
const D = require('./faden-daten.js');
const Geld = require('./geld.js');
const Sektoren = require('../../shared/sektoren.js');
const TEXTE = require('../../content/faeden/forderung-texte.json');
const WERTE = require('../../content/faeden/forderung-werte.json').werte;

const Bitte = () => require('./faden-bitte.js');
const Fracht = () => require('./faden-fracht.js');
const regie = () => require('./regie-befehle.js');
const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const fmt = (t, v) => String(t).replace(/\{(\w+)\}/g, (m, k) => (has(v, k) ? v[k] : m));
const hexName = (hex) => { try { return Sektoren.hexName(hex) || hex; } catch (e) { return hex; } };
const katalog = (beat) => (beat && has(D.BEATS, beat.typ) ? D.BEATS[beat.typ] : null);
const wirkung = (beat, optionId) => { const k = katalog(beat); return k && has(k.optionen_wirkung, optionId) ? k.optionen_wirkung[optionId] : null; };
const logbuch = (game, e) => { try { regie().schreibe(game, Object.assign({ art: 'faden_ereignis' }, e)); } catch (err) { if (game && game.countError) game.countError('faden-forderung-logbuch', err); } };

// Eintrag der Texte zu diesem Beat: text_key des Beats, sonst text_key_standard des Katalogs
const eintrag = (beat) => {
  const k = katalog(beat);
  const key = (beat.parameter && beat.parameter.text_key) || (k && k.text_key_standard);
  return typeof key === 'string' && has(TEXTE.texte, key) ? TEXTE.texte[key] : null;
};
const fordererVon = (beat) => { const e = eintrag(beat); return e && has(TEXTE.forderer, e.forderer) ? TEXTE.forderer[e.forderer] : null; };

// Preis einer Option (Marken) nach der Staerke des Beats; 0 = kostet nichts
function kostenVon(beat, optionId) {
  const w = wirkung(beat, optionId);
  if (!w || typeof w.kosten !== 'string' || !has(WERTE, w.kosten)) return 0;
  const tabelle = WERTE[w.kosten].wert;
  const s = beat.parameter && beat.parameter.staerke;
  const staerke = has(tabelle, s) ? s : WERTE.staerke_standard.wert;
  return Math.max(0, Math.floor(Number(tabelle[staerke]) || 0));
}
// Der Preis, den der Funktext nennt: die erste Option des Beats mit Kosten
function preisDesBeats(beat) {
  for (const o of beat.optionen || []) { const n = kostenVon(beat, o.id); if (n > 0) return n; }
  return 0;
}

function absender(beat) {
  const fo = fordererVon(beat);
  return fo ? { name: fo.name, fraktion: fo.fraktion, portrait: fo.portrait, kopf: fo.kopf } : null;
}
function text(game, f, beat) {
  const e = eintrag(beat), fo = fordererVon(beat);
  if (!e || !fo) return null;
  const ware = f.fracht && has(Fracht().WAREN, f.fracht.ware) ? Fracht().WAREN[f.fracht.ware].name : TEXTE.ware_ohne;
  const preis = preisDesBeats(beat);
  return fmt(e.text, { forderer: fo.name, ware, ort: f.parameter && f.parameter.ort ? hexName(f.parameter.ort) : 'hier', marken: preis ? preis + ' ' + WERTE.marken_einheit.wert : '' });
}

function optionPruefen(game, f, beat, opt) {
  const n = kostenVon(beat, opt.id);
  if (n > 0 && !Geld.mindestens(game, n)) {
    const t = TEXTE.ablehnung.zu_wenig_marken;
    Bitte().funkSprecher(game, D.BITTE.antwort_von, t);
    return { code: 'zu_wenig_marken', text: t };
  }
  return null;
}

function optionGewaehlt(game, f, beat, opt) {
  const w = wirkung(beat, opt.id) || {};
  const n = kostenVon(beat, opt.id);
  let bezahlt = 0;
  if (n > 0 && Geld.bestechungZahlen(game, n)) bezahlt = n;   // optionPruefen hat das Guthaben schon geprueft; bucht nichts, wenn es doch fehlt
  const fo = fordererVon(beat);
  const ware = f.fracht && has(Fracht().WAREN, f.fracht.ware) ? Fracht().WAREN[f.fracht.ware].name : TEXTE.ware_ohne;
  if (fo && has(TEXTE.reaktionen, opt.id)) Bitte().funkSprecher(game, fo.name, fmt(TEXTE.reaktionen[opt.id], { forderer: fo.name, ware }));
  logbuch(game, { ausgang: w.ereignis || 'gewaehlt', key: f.id, begruendung: `Forderung ${beat.id}: Option ${opt.id}${bezahlt ? ', ' + bezahlt + ' Marken bezahlt' : ''}`, plan: { faden: f.id, beat: beat.id, option: opt.id, marken: bezahlt } });
}

// Daten-Konsistenz fuer die Tests: jeder Beat mit diesem Baustein hat Texte, Forderer, Kosten-Schluessel
function datenFehler() {
  const out = [];
  for (const [typ, k] of Object.entries(D.BEATS)) {
    if (require('./faden-bausteine.js').vonId(k.baustein) !== baustein) continue;   // jeder Beat-Typ, dessen Baustein dieser ist (kein Beat-Name im Code)
    const e = has(TEXTE.texte, k.text_key_standard) ? TEXTE.texte[k.text_key_standard] : null;
    if (!e) out.push(`Beat ${typ}: text_key_standard ${k.text_key_standard} steht nicht in forderung-texte.json`);
    for (const [oid, w] of Object.entries(k.optionen_wirkung || {})) {
      if (w.kosten !== undefined && !has(WERTE, w.kosten)) out.push(`Beat ${typ}, Option ${oid}: kosten ${w.kosten} steht nicht in forderung-werte.json`);
      if (!has(TEXTE.reaktionen, oid)) out.push(`Beat ${typ}, Option ${oid}: keine Reaktion in forderung-texte.json reaktionen`);
    }
    if (k.ware_bei_scheitern !== undefined && k.ware_bei_scheitern !== 'bleibt') out.push(`Beat ${typ}: ware_bei_scheitern ist "bleibt" oder fehlt`);
    if (k.gefahr === true) out.push(`Beat ${typ}: ein Beat mit Optionen hat keine Gefahr`);
  }
  for (const [key, e] of Object.entries(TEXTE.texte)) if (!has(TEXTE.forderer, e.forderer)) out.push(`Text ${key}: Forderer ${e.forderer} fehlt`);
  for (const [id, fo] of Object.entries(TEXTE.forderer)) if (typeof fo.kopf !== 'string' || fo.kopf.length > 12) out.push(`Forderer ${id}: kopf hoechstens 12 Zeichen`);
  return out;
}

const baustein = {
  angebot: true,
  absender: (beat) => absender(beat),
  text,
  optionPruefen,
  optionGewaehlt,
  starten(game, faden, ctx) { return Bitte().baustein.starten(game, faden, ctx); },
};

module.exports = { baustein, kostenVon, preisDesBeats, datenFehler, TEXTE, WERTE };
