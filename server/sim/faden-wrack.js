'use strict';
// WRK-01 B: Baustein des Beats wrack (Action-Layer wie faden-landung.js; beide nutzen den Rahmen faden-boden-rahmen.js: laufender Beat, Ort, Besetzung, "niemand mehr unten", Funk). Im Sektor liegt ein Wrack (Landeplatz Art schiff, DYN-01),
// die Crew beamt hinueber, kann dort Beute bergen (WRK-01 A1, wrack-beute.js) und ein Logbuch lesen (Terminal), und beamt wieder hoch. Wracks sind Storytelling, kein Loot: Beute und Logbuch sind KEINE Pflicht fuer gelungen,
// sie wandern nur in den Funk beim Abschluss und ins Logbuch der Regie. Zahlen (Besetzung) stehen in content/faeden/boden-werte.json (dieselbe Tabelle wie landung), die Frist im Katalog (beats.json), Texte in content/faeden/wrack-texte.json;
// im Code steht kein Zahlenwert, keine Fraktion und kein Beat-Name ausser dem eigenen.
//
//   starten(game, faden, ctx)   Der Ort entsteht schon vorher (faden.js -> abenteuer-orte.beatStarten fuer den Parameter landeplatz). Hier: Besetzung je Parameter besetzung (combat.besetzen, ruhig = niemand), Funk nennt das Wrack.
//                               -> { laeuft: true }. Fehlt der Ort, scheitert der Beat.
//   Handler (faden-boden.js, Art wrack), nur fuer den laufenden Beat dieses Fadens:
//     beamedDown      merkt "unten gewesen"; holt die Besetzung nach, falls die Karte keine traegt
//     beuteGeborgen   (WRK-01 B, Verteiler-Ereignis, Zuordnung ueber die Karte) merkt "Beute", Funk beim ersten Fund
//     ankerGelesen    Logbuch-Terminal gelesen: merkt "Logbuch", Funk beim ersten Mal
//     beamedUp        gelungen, wenn unten gewesen UND danach niemand mehr unten ist; mit data.notrueckholung: gescheitert
//     notsprung       gescheitert
//   nachTaetigkeit(game), update(game)   dieselbe Pruefung "niemand mehr unten" wie landung (viele Wege nach oben melden kein beamedUp, siehe faden-boden.js Hinweis 3)
// Gescheitert bei: Frist, Faden-Ende, Notrueckholung, Notsprung. Den Ort raeumt der Faden-Abschluss ab (abenteuer-orte.abraeumen).
// Laufzeit-Zustand steht NICHT im Weltstand und nicht im WeakMap(game): "unten gewesen" (WeakSet) und der Fund (WeakMap) haengen am Faden-OBJEKT und fallen mit reset/Laden weg; ein Beat nach dem Laden zaehlt neu.
// Hinweis, der das naechste Ziel nennt (hinweis_traeger), ist bewusst NICHT Teil dieses Beats (spaeterer, eigener Schritt); der Katalog setzt ihn nicht, der Beat ruft FadenHinweis nie.
const D = require('./faden-daten.js');
const Boden = require('./faden-boden.js');
const R = require('./faden-boden-rahmen.js');
const TEXTE = require('../../content/faeden/wrack-texte.json').texte;

const ART = 'wrack';   // Katalogtyp des Beats (beats.json)
const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const Faden = () => require('./faden.js');
const Bitte = () => require('./faden-bitte.js');

const untenGewesen = new WeakSet();   // Faden-Objekt (game.weltsim.faeden.liste[i])
const fund = new WeakMap();           // Faden-Objekt -> { beute: bool, logbuch: bool }
const fundVon = (f) => { let x = fund.get(f); if (!x) { x = { beute: false, logbuch: false }; fund.set(f, x); } return x; };
const laufenderBeat = (f) => R.laufenderBeatArt(f, ART);

// Funk des NSC (Text aus den Daten, Platzhalter platz und ort); ohne Text oder NSC still
function funk(game, f, beat, key) {
  const text = has(TEXTE, key) ? TEXTE[key] : null;
  const nsc = Faden().nscVon(game, f.nsc.id) || f.nsc;
  if (text && nsc) Bitte().funkVon(game, nsc, R.fmt(text, { platz: R.platzName(f, beat), ort: R.hexName(f.parameter && f.parameter.ort) }));
}
const abschlussSchluessel = (x) => 'abschluss_' + (x.beute ? 'mit' : 'ohne') + '_beute_' + (x.logbuch ? 'mit' : 'ohne') + '_logbuch';

// ---------- Ausgang
function ausgang(game, f, beat, art) {
  const x = fundVon(f);
  untenGewesen.delete(f); fund.delete(f);
  try { funk(game, f, beat, art === 'gelungen' ? abschlussSchluessel(x) : 'scheitern'); } catch (e) { if (game.countError) game.countError('faden-wrack', e); }
  R.logbuch(game, { ausgang: 'wrack_' + art, key: ART, begruendung: `Wrack ${art}, Beute ${x.beute}, Logbuch ${x.logbuch}`, plan: { faden: f.id, beat: beat.id, beute: x.beute, logbuch: x.logbuch } }, 'faden-wrack');
  return Faden().beatAusgang(game, f.id, art);
}
function pruefen(game) {
  const F = game.weltsim && game.weltsim.faeden;
  if (!F || !F.liste.some((x) => untenGewesen.has(x))) return;   // sofort zurueck ohne Allokation, solange kein Faden "unten gewesen" gemerkt hat
  for (const f of F.liste.slice()) {
    if (!untenGewesen.has(f)) continue;
    const beat = laufenderBeat(f), lp = beat && R.ortVon(game, f, beat);
    if (!lp) { untenGewesen.delete(f); continue; }
    if (R.niemandUnten(game, lp)) ausgang(game, f, beat, 'gelungen');
  }
}
const nachTaetigkeit = (game) => pruefen(game);
const update = (game) => pruefen(game);

const handler = {
  ereignis(game, f, ev) {
    const beat = laufenderBeat(f);
    if (!beat) return;
    if (ev.name === 'notsprung') { ausgang(game, f, beat, 'gescheitert'); return; }
    const lp = R.ortVon(game, f, beat), map = ev.data && ev.data.map;
    if (!lp || map !== lp) return;
    if (ev.name === 'beamedDown') { untenGewesen.add(f); R.besetzenFuer(game, beat, lp, ART); return; }
    if (ev.name === 'beuteGeborgen') { const x = fundVon(f); if (!x.beute) { x.beute = true; funk(game, f, beat, 'beute'); } return; }
    if (ev.name === 'ankerGelesen') { const x = fundVon(f); if (!x.logbuch) { x.logbuch = true; funk(game, f, beat, 'logbuch'); } return; }
    if (ev.name === 'beamedUp') {
      if (!untenGewesen.has(f) || !R.niemandUnten(game, lp)) return;
      ausgang(game, f, beat, ev.data.notrueckholung === true ? 'gescheitert' : 'gelungen');
    }
  },
};
Boden.anmelden(ART, handler);

// ---------- Baustein
const baustein = {
  id: ART,
  starten(game, faden, ctx) {
    const beat = ctx && ctx.beat;
    const lp = beat ? R.ortVon(game, faden, beat) : null;
    if (!lp) { R.logbuch(game, { ausgang: 'abgelehnt', key: ART, begruendung: 'Wrack ohne Ort: der Beat gilt als gescheitert', plan: { faden: faden.id } }, 'faden-wrack'); return { ausgang: 'gescheitert' }; }
    fund.delete(faden);
    if (R.niemandUnten(game, lp)) untenGewesen.delete(faden); else untenGewesen.add(faden);   // aus dem echten Zustand wie landung
    R.besetzenFuer(game, beat, lp, ART);
    const schluessel = R.besetzungsSchluessel(beat);
    funk(game, faden, beat, has(TEXTE, 'start_' + schluessel) ? 'start_' + schluessel : 'start_' + R.WERTE.besetzung_standard.wert);
    R.logbuch(game, { ausgang: 'wrack', key: ART, begruendung: `Wrack an ${lp}, Besetzung ${schluessel}`, plan: { faden: faden.id, beat: beat.id, ort: lp, besetzung: schluessel } }, 'faden-wrack');
    return { laeuft: true };
  },
};

// Konsistenz der Daten (Katalogpruefung, Tests): Katalogzeile, Pflicht Landeplatz und Frist, Besetzung nur aus der Tabelle von boden-werte.json, Texte
function datenFehler() {
  const out = [];
  const k = has(D.BEATS, ART) ? D.BEATS[ART] : null;
  if (!k) return ['Beat ' + ART + ' fehlt im Katalog (beats.json)'];
  if (k.baustein !== ART) out.push(`Beat ${ART}: baustein ist ${k.baustein}`);
  if (!(k.braucht && k.braucht.landeplatz === true)) out.push(`Beat ${ART}: braucht.landeplatz ist true`);
  if (!(Number.isInteger(k.frist) && k.frist >= 1)) out.push(`Beat ${ART}: frist (Taetigkeiten) fehlt`);
  if (k.gefahr !== false) out.push(`Beat ${ART}: der Bodenkampf ist keine Raum-Gefahr (gefahr false)`);
  if (k.hinweis_traeger === true || (k.bauplan && k.bauplan.hinweis_traeger === true)) out.push(`Beat ${ART}: hinweis_traeger bleibt aus (Hinweis auf das naechste Ziel ist ein eigener Schritt)`);
  const bp = k.bauplan && k.bauplan.parameter;
  if (!(bp && bp.landeplatz && bp.landeplatz.erlaubt === 'landeplatz')) out.push(`Beat ${ART}: bauplan.parameter.landeplatz.erlaubt ist 'landeplatz'`);
  const tabelle = R.WERTE.besetzung.wert;
  const erlaubt = bp && bp.besetzung && bp.besetzung.erlaubt;
  if (!Array.isArray(erlaubt) || !erlaubt.length || erlaubt.some((e) => !has(tabelle, e))) out.push('bauplan.parameter.besetzung.erlaubt nennt einen Schluessel, den boden-werte.json besetzung nicht kennt');
  if (bp && bp.besetzung && !has(tabelle, bp.besetzung.standard)) out.push('bauplan.parameter.besetzung.standard ist kein Schluessel von boden-werte.json besetzung');
  const max = R.WERTE.text_max.wert;
  const noetig = ['beute', 'logbuch', 'scheitern'].concat((Array.isArray(erlaubt) ? erlaubt : []).map((e) => 'start_' + e), ['mit', 'ohne'].flatMap((a) => ['mit', 'ohne'].map((b) => `abschluss_${a}_beute_${b}_logbuch`)));
  for (const key of noetig) {
    const text = TEXTE[key];
    if (typeof text !== 'string' || !text.trim()) { out.push(`wrack-texte.json: ${key} fehlt`); continue; }
    if (text.length > max) out.push(`wrack-texte.json: ${key} hat ${text.length} Zeichen (hoechstens ${max})`);
    for (const p of text.match(/\{[^}]*\}/g) || []) if (p !== '{platz}' && p !== '{ort}') out.push(`wrack-texte.json: ${key} nennt den Platzhalter ${p} (erlaubt: {platz}, {ort})`);
  }
  return out;
}

module.exports = { baustein, handler, nachTaetigkeit, update, datenFehler, TEXTE };
