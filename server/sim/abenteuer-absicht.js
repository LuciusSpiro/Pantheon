'use strict';
// SPL-02 E1: Betriebsmodus Absichten des Abenteuer-Spielleiters (abenteuer-spielleiter.js). Action-Layer: reine Funktionen, kein Zustand, kein Netz, kein Modellaufruf (den macht der Spielleiter).
// Schalter ABENTEUER_ABSICHTEN (1 | on | 0 | off, sonst der Datenwert werte.betrieb_standard_an in content/faeden/absichten.json, Standard aus). AUS: der Spielleiter bleibt byte-gleich beim Beat-Plan.
// AN: der Prompt bietet die Absichten an (abenteuer-prompt.js baueAbsicht, Systemprompt abenteuer-absicht.system.md), die Antwort ist eine Absicht (absicht/1), die Kette heisst
// Kennungen aufloesen (die des Prompts, nicht die des Zustands zur Antwortzeit) > Pruefer (absicht-pruefer.js) > Inszenierer (inszenierer.js) > Brett (Brett.neuAnbieten). Ein Nein der Welt geht in EINE
// Verhandlungsrunde (zweiter, kleiner Aufruf: nur Absicht und Klartext des Neins, kein Katalog; Systemprompt abenteuer-absicht-verhandlung.system.md). Dieses Modul kennt keinen Absichts- und keinen Beat-Namen:
// was es gibt, steht im Katalog.
//
//   aktiv(game) -> bool                              Schalter (Umgebung des Spiels, sonst Datenwert)
//   katalog() -> Katalog der Absichten               (absicht-pruefer.js, Daten)
//   baue(game, { nr, grenze, hex, letzteAbsichten, werte }) -> { prompt, zeichen, kontextZeichen, katalogZeichen, kennungen } | { fehler }
//   lesen(text) -> { absicht } | { fehler }          erstes lesbares JSON-Objekt (Zaeune, Text davor und danach, Komma vor }/], wie beim Bauplan)
//   ersterVersuch(game, absicht, kennungen) -> { stand: 'angenommen', angebot, absicht, inszenierung } | { stand: 'offen' | 'abgelehnt', v }   v wie in absicht-pruefer.js (verhandlungStartMit); das Angebot liegt schon im Brett
//   verhandelbar(v, nichtModell) -> bool             lohnt eine Runde? Nein bei BEZUG_VERALTET und bei einem Nein des Bretts, das nicht am Modell liegt (nichtModell: Codes, die der Spielleiter kennt)
//   folgeInput(game, v, absicht, kennungen, nr) -> { system, prompt, art, nr }   der zweite Aufruf; Namen im Klartext sind durch Kennungen ersetzt, nie ein Spielername
//   folgeAntwort(game, v, text, kennungen) -> v'     Patch oder Absicht des Modells durch dieselbe Kette; angenommen: v'.ergebnis.angebot
//   logFelder(absicht, bezug) -> { absicht: Name | null, bezug_art: 'nsc' | 'ort' | 'nsc+ort' | 'keiner' }   fuer das Logbuch: nur gepruefte Namen, nie Titel, Texte oder NSC-Namen
//   codeVon(v) -> Code des letzten Neins; fehlerCodes(v) -> ['CODE (feld)', ...] ohne Grundtexte (die koennen Namen tragen)
const path = require('path');
const LLM = require('../mission/llm.js');
const Prompt = require('./abenteuer-prompt.js');

const AP = () => require('./absicht-pruefer.js');
const AV = () => require('./absicht-verhandlung.js');
const INS = () => require('./inszenierer.js');
const Geschichte = () => require('./abenteuer-geschichte.js');
const Ausschnitt = () => require('./lage-ausschnitt.js');

const SYSTEM_DATEI = path.join(LLM.PROMPT_DIR, 'abenteuer-absicht.system.md');
const VERHANDLUNG_SYSTEM_DATEI = path.join(LLM.PROMPT_DIR, 'abenteuer-absicht-verhandlung.system.md');
const istObjekt = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const codeVonText = (t) => String(t).split(':')[0];
const feldOk = (f) => { const muster = new RegExp(katalog().werte.name_muster.wert), teile = typeof f === 'string' ? f.split('.') : []; return teile.length >= 1 && teile.length <= 2 && teile.every((t) => muster.test(t)); };   // Feldpfad der Absicht: Namen nach name_muster (Daten)

const katalog = () => AP().katalogStandard();

function aktiv(game) {
  const env = (game && game.env) || process.env;
  const v = String((env && env.ABENTEUER_ABSICHTEN) || '').toLowerCase();
  if (v === '1' || v === 'on') return true;
  if (v === '0' || v === 'off') return false;
  return katalog().werte.betrieb_standard_an.wert === true;
}

const baue = (game, o) => Prompt.baueAbsicht(game, Object.assign({}, o, { katalog: katalog() }));
const lesen = (text) => Prompt.absichtAusText(text);

// ---------- die Kette fuer EINE Absicht: Kennung des Prompts > Pruefer + Inszenierer > Angebot im Brett
// Der Pruefer loest eine Kennung sonst aus dem Zustand von JETZT auf (pruefeAbsicht): dann koennte K2 inzwischen eine andere Person meinen. Darum loest diese Kette zuerst mit den eingefrorenen Kennungen
// auf; steht der NSC dann nicht mehr zur Verfuegung (verdraengt, tot, kein Kandidat mehr), ist das BEZUG_VERALTET, nie ein anderer NSC.
// Veraltet heisst: der NSC steht nicht mehr in der Crew-Geschichte (tot, verdraengt, kein Zustand mehr, den sie zeigt) UND der Pruefer lehnt den Bezug ab. Ein NSC, der noch dort steht, aber fuer diese Absicht nicht
// taugt (zum Beispiel nicht grollend), ist ein gewoehnliches Nein mit Vorschlag und geht in die Verhandlung.
function veraltet(game, name, e) {
  const A = AP();
  if (!e.fehler.some((f) => f.feld === 'bezug.nsc') || Object.values(Geschichte().geschichteZeilen(game).kennungen).includes(name)) return e;
  return { ok: false, absicht: e.absicht, veraltet: true, fehler: [{ code: A.CODES.BEZUG_VERALTET, feld: 'bezug.nsc', grund: 'der NSC dieser Kennung steht nicht mehr zur Verfuegung (die Welt hat sich seit der Anfrage veraendert)' }] };
}
function pruefer(kennungen) {
  return function (game, absicht, kat) {
    let a = absicht, mitKennung = false;
    if (istObjekt(a) && istObjekt(a.bezug) && Geschichte().istKennung(a.bezug.nsc)) {
      const r = Geschichte().bezugAufloesen(kennungen, a.bezug);
      if (!r.ok) return { ok: false, absicht: a, fehler: r.fehler };
      a = Object.assign({}, a, { bezug: r.bezug }); mitKennung = true;
    }
    const e = AV().pruefeUndInszeniere(game, a, kat);
    if (!e.ok) return mitKennung ? veraltet(game, a.bezug.nsc, e) : e;
    const an = INS().anbietenAusAbsicht(game, e.absicht, kat);
    if (!an.ok) return { ok: false, absicht: e.absicht, fehler: an.fehler };
    return { ok: true, absicht: e.absicht, fehler: [], inszenierung: an.inszenierung, angebot: an.angebot };
  };
}
function ersterVersuch(game, absicht, kennungen) {
  const kat = katalog();
  const v = AP().verhandlungStartMit(pruefer(kennungen), game, absicht, kat);
  if (v.stand === 'angenommen') return { stand: 'angenommen', angebot: v.ergebnis.angebot, absicht: v.absicht, inszenierung: v.ergebnis.inszenierung };
  return { stand: v.stand, v };
}
function verhandelbar(v, nichtModell) {
  const e = v && v.ergebnis;
  if (!e || e.ok || !Array.isArray(e.fehler) || !e.fehler.length) return false;
  if (e.veraltet === true) return false;
  const brett = INS().CODES.ANGEBOT_ABGELEHNT;
  return !e.fehler.some((f) => f.code === brett && (nichtModell || []).includes(codeVonText(f.grund)));
}

// ---------- zweiter Aufruf
function ohneNamen(game, kennungen, text) {
  let t = String(text);
  const paare = Object.entries(istObjekt(kennungen) ? kennungen : {}).filter(([, n]) => typeof n === 'string' && n.length >= 2).sort((a, b) => b[1].length - a[1].length);
  for (const [k, n] of paare) t = t.split(n).join(k);   // Vollnamen aus der Geschichte stehen im Klartext des Neins: das Modell kennt nur die Kennung
  const A = Ausschnitt();
  return A.ohneNamenGanzwort(t, A.spielerNamen(game || {}));
}
function folgeInput(game, v, absicht, kennungen, nr) {
  const max = AP().katalogStandard().werte.absicht_max_zeichen.wert;
  let a = '{}';
  try { a = JSON.stringify(absicht); } catch (e) { a = '{}'; }
  const prompt = LLM.buildPrompt({ variabel: [['absicht', ohneNamen(game, kennungen, a.slice(0, max))], ['pruefer', ohneNamen(game, kennungen, v.text)]], schluss: 'Nur das JSON-Objekt.' });
  return { system: VERHANDLUNG_SYSTEM_DATEI, prompt, art: 'abenteuer', nr };
}
function folgeAntwort(game, v, text, kennungen) {
  const g = Prompt.absichtAusText(text);
  return AP().verhandlungAntwortMit(pruefer(kennungen), game, v, g.absicht || null, katalog());
}

// ---------- Logbuch
function logFelder(absicht, bezug) {
  const kat = katalog();
  const name = istObjekt(absicht) && typeof absicht.absicht === 'string' && Object.prototype.hasOwnProperty.call(kat.absichten, absicht.absicht) ? absicht.absicht : null;
  const b = istObjekt(bezug) ? bezug : (istObjekt(absicht) && istObjekt(absicht.bezug) ? absicht.bezug : {});
  const arten = kat.werte.bezug_arten.wert.filter((k) => typeof b[k] === 'string' && b[k].length);
  return { absicht: name, bezug_art: arten.length ? arten.join('+') : 'keiner' };
}
function codeVon(v) {
  const e = v && v.ergebnis;
  return e && Array.isArray(e.fehler) && e.fehler.length && typeof e.fehler[0].code === 'string' ? e.fehler[0].code : 'ABGELEHNT';
}
function fehlerCodes(v) {
  const e = v && v.ergebnis;
  return (e && Array.isArray(e.fehler) ? e.fehler : []).slice(0, 6).map((f) => `${f.code} (${feldOk(f.feld) ? f.feld : '?'})`);
}

module.exports = { aktiv, katalog, baue, lesen, ersterVersuch, verhandelbar, folgeInput, folgeAntwort, logFelder, codeVon, fehlerCodes, SYSTEM_DATEI, VERHANDLUNG_SYSTEM_DATEI };
