'use strict';
// SUND-04b A2: Prompt des Abenteuer-Aufrufs (kind abenteuer, Stufe bauplan) und Lesen seiner Antwort. Reine Funktionen, kein Zustand, kein Netz.
// Eigener Aufruf, NICHT der Takt-Prompt der Lage (der hat nur ~2 500 Zeichen Reserve von 16 000: Komposition dort drueckte den Ausschnitt).
//
//   katalogText()                 Katalog der Beat-Typen mit Parametern, Standard-Zustaenden und den Regeln, ABGELEITET aus den Daten (content/faeden/beats.json `bauplan`, bauplan.json, werte.json, szenen-werte.json). Statisch.
//   baue(game, { nr, grenze, hex, letzte, werte }) -> { prompt, zeichen, kontextZeichen } | { fehler }
//                                 Reihenfolge fuer das Caching: Katalog (statisch) -> Kontext -> Aufruf -> Schluss. KEINE Spielernamen: der Kontext nennt die Crew nur als Crew (Rang, Stufe, Ort); Freitext (Chronik) ist vom Ausschnitt
//                                 der Lage schon gefiltert; Titel und Anlass frueherer Abenteuer (freier Text des Modells) stehen nie im Kontext, nur ihre Typenfolge.
//   bauplanAusText(text)          -> { plan } | { fehler }   das erste lesbare JSON-Objekt (Zaeune, Text davor/danach, Komma vor }/] wie beim Plan der Lage)
//   typenVon(vorlage)             Typenfolge einer expandierten Vorlage (ohne Abschluss)
const path = require('path');
const LLM = require('../mission/llm.js');
const D = require('./faden-daten.js');
const Ausschnitt = require('./lage-ausschnitt.js');
const LagePrompt = require('./lage-prompt.js');
const { WERTE } = require('./abenteuer-daten.js');

const SYSTEM_DATEI = path.join(LLM.PROMPT_DIR, 'abenteuer.system.md');
const W = D.WERTE, B = D.BEATS, BP = D.BAUPLAN, BW = BP.werte;
const waren = () => Object.keys(require('../../content/faeden/szenen-werte.json').werte.waren.wert);
const liste = (a) => a.join(' | ');

// ---------- Katalog aus den Daten
let katalogCache = null;
function parameterText(bp) {
  const ps = Object.entries(bp.parameter || {});
  if (!ps.length) return 'keine Parameter';
  return ps.map(([k, s]) => {
    const erlaubt = Array.isArray(s.erlaubt) ? (s.erlaubt.length === 1 && s.erlaubt[0] === '$ort' ? 'der Ort des Abenteuers' : liste(s.erlaubt))
      : s.erlaubt === 'fluchtziel' ? `Hex-Code oder ${liste(W.fluchtziele)}` : s.erlaubt === 'waren' ? liste(waren()) : '?';
    return `${k} (Standard ${s.standard === '$ort' ? 'der Ort des Abenteuers' : s.standard}; erlaubt ${erlaubt})`;
  }).join(', ');
}
function katalogText() {
  if (katalogCache) return katalogCache;
  const T = BW.titel, A = BW.anlass;
  const L = [];
  L.push(`Bauplan (dein Antwortobjekt, Format faden-bauplan/1): { "format": "faden-bauplan/1", "titel": Text mit ${T.min} bis ${T.max} Zeichen, "anlass"?: Text mit ${A.min} bis ${A.max} Zeichen (warum es dieses Abenteuer gibt; ohne geschweifte Klammern, ohne Namen), "namenlos"?: true, "volk_erlaubt"?: [${liste(W.voelker)}] (Standard ${BW.volk_erlaubt_standard.join(' | ')}), "wahrheit"?: Kennung, "beats": [Beat, ...] }`);
  L.push('Beat: { "typ": Beat-Typ, "id"?: Text a-z0-9_ (nur als Ziel einer Verzweigung noetig), "parameter"?: { nur die Parameter des Typs }, "optionen"?: true, "verzweigung"?: { "gelungen"?: id eines SPAETEREN Beats, "gescheitert"?: id eines SPAETEREN Beats }, "erfolg"?: [Beat-Typen] (nur am Abschluss) }');
  L.push(`Laenge: 2 bis ${W.beats_max} Beats; hoechstens ${W.abenteuer.plan_max_zeichen} Zeichen serialisiert. Der letzte Beat ist der Abschluss (und nur der letzte). Die Beats laufen der Reihe nach, eine Verzweigung springt nur nach vorn. Zustaende, Ausgaenge, Folgen, Optionstexte und Hinweise schreibst du NIE: sie kommen aus den Daten.`);
  L.push('Beat-Typen (nur diese; Zustaende des NSC: ' + liste(W.status) + '):');
  for (const [typ, c] of Object.entries(B)) {
    const bp = c.bauplan;
    if (!bp || typeof bp !== 'object') continue;   // ein Typ ohne Standards kann in keinem Plan stehen
    const br = c.braucht || {};
    const flags = [c.gefahr ? 'Gefahr' : null, c.szene ? 'Szene' : null].filter(Boolean);
    const opt = c.optionen === 'erlaubt' ? (bp.optionen_pflicht ? 'Optionen Pflicht ("optionen": true)' : 'Optionen erlaubt ("optionen": true)') : 'keine Optionen';
    const st = (ag) => (bp.aus && bp.aus[ag] && bp.aus[ag].status ? liste(bp.aus[ag].status) : 'unveraendert');
    const nach = c.abschluss ? 'beendet den Faden' : `NSC danach: gelungen ${st('gelungen')}, gescheitert ${st('gescheitert')}`;
    const braucht = [br.nsc_status ? `braucht den NSC im Zustand ${liste(br.nsc_status)}` : null, br.wahrheit ? 'braucht eine Wahrheit' : null, br.hinweis_vorher ? 'braucht vorher einen Beat mit Hinweis-Traeger auf jedem Weg' : null, br.letzter ? 'nur als letzter Beat' : null].filter(Boolean);
    L.push(`- ${typ}${flags.length ? ' [' + flags.join(', ') + ']' : ''}: ${c.zweck} ${opt}. Parameter: ${parameterText(bp)}. ${bp.hinweis_traeger ? 'Hinweis-Traeger. ' : ''}${braucht.length ? braucht.join('; ') + '. ' : ''}Start-Zustand ${bp.start_status}. ${nach}.`);
  }
  L.push(`Wahrheiten (nur mit einem Beat, der eine Wahrheit braucht): ${Object.entries(BP.wahrheiten).map(([k, w]) => `${k} (${w.fraktion ? 'der NSC ist in Wahrheit ' + w.fraktion : 'verborgen'})`).join('; ')}. Ohne Angabe gilt ${BW.wahrheit_standard}. Die Hinweise streut der Code an alle Hinweis-Traeger vor der Enthuellung.`);
  L.push(`Regeln, die der Pruefer erzwingt: bei Gefahr nie Optionen; Scheitern muss etwas veraendern (anderer Weg oder anderer Zustand); Annehmen und Ablehnen einer Bitte muessen in verschiedene Beats fuehren (verzweigung); jeder Beat muss erreichbar sein; "namenlos": true nur mit Typen, die einen NSC im Zustand aktiv zulassen. Ein erfolg-Eintrag nennt hoechstens ${BW.erfolg_max} Typen, die im Plan vorkommen.`);
  katalogCache = L.join('\n');
  return katalogCache;
}
const katalogNeuLesen = () => { katalogCache = null; };

// ---------- Kontext (verdichtet, ohne Spielernamen)
const typenVon = (v) => (v && Array.isArray(v.beats) ? v.beats.filter((b) => !(B[b.typ] && B[b.typ].abschluss)).map((b) => b.typ) : []);
function fadenKontext(game) {
  const Faden = require('./faden.js');
  const F = Faden.zustandVon(game);
  const aktiv = [];
  let abenteuer = 0;
  for (const f of F.liste) {
    if (f.phase === 'abgeschlossen') continue;
    const v = D.vorlage(f.vorlage);
    const beat = v && v.beats[f.beat];
    const e = { v: f.plan ? 'abenteuer' : f.vorlage, ph: f.phase, beat: beat ? beat.typ : null };
    if (f.plan) { e.typen = typenVon(f.plan); abenteuer++; }
    aktiv.push(e);
  }
  // SUND-04b B1: wie viele NSC aus abgeschlossenen Faeden fuer ein Wiedersehen taugen (nur die Zahl, nie ein Name): ohne einen gibt es fuer einen Plan mit Wiedersehen kein Angebot
  const wiedersehen = require('./faden-pruefer.js').wiedersehenNsc(F, { volk_erlaubt: BW.volk_erlaubt_standard }).length;
  return { aktiv, laufende_abenteuer: abenteuer, abenteuer_angebote: F.abenteuerAngebote.map((a) => typenVon(a.vorlage)), notruf_angebote: F.angebote.length, wiedersehen_nsc: wiedersehen };
}
// Der verdichtete Kontext: nur was der Ausschnitt der Lage schon gefiltert liefert (Chronik ohne Namen, Crew ohne Namen) und der Faden-Zustand ohne NSC-Namen.
function kontextVon(game, werte, letzte, stufe) {
  const a = JSON.parse(Ausschnitt.ausschnitt(game, { stufe }).text);
  const f = a.flotten || {};
  const wende = [].concat((f.gefallen || []).map((x) => Object.assign({ art: 'gefallen' }, x)), (f.belagert || []).map((x) => Object.assign({ art: 'belagert' }, x)), (f.unterwegs || []).map((x) => Object.assign({ art: 'marsch' }, x))).slice(-werte.wendepunkte_max);
  const crew = a.crew || {};
  return {
    tick: a.tick,
    crew: { rang: crew.rang, stufe: crew.stufe, ort: crew.ort, hex: crew.hex },
    ruf: a.ruf, lage: a.lage,
    wendepunkte: wende,
    chronik: (a.chronik || []).slice(-werte.chronik_zeilen),
    faeden: fadenKontext(game),
    letzte_abenteuer: (letzte || []).slice(-werte.letzte_abenteuer).map((x) => x.typen),
  };
}
const sortiert = (x) => require('../mission/context.js').sortKeys(x);

function baue(game, { nr, grenze, hex, letzte, werte }) {
  const w = werte || WERTE;
  const schluss = 'Gib jetzt den Bauplan aus. Nur das JSON-Objekt.';
  const aufruf = { art: String(grenze || 'unbekannt'), nr: Number.isInteger(nr) ? nr : 1, hex: hex || null };
  const stufen = Ausschnitt.STUFEN.length;
  // erst der volle Kontext, dann gekuerzt (kleinere Stufe des Ausschnitts, weniger Chronik und Wendepunkte), bis die Obergrenze haelt
  for (let s = 0; s < stufen + 2; s++) {
    const ww = Object.assign({}, w);
    if (s >= stufen) { ww.chronik_zeilen = Math.max(1, Math.floor(w.chronik_zeilen / (s - stufen + 2))); ww.wendepunkte_max = Math.max(1, Math.floor(w.wendepunkte_max / (s - stufen + 2))); }
    const kontext = JSON.stringify(sortiert(kontextVon(game, ww, letzte, Math.min(s, stufen - 1))));
    const prompt = LLM.buildPrompt({ katalog: katalogText(), variabel: [['kontext', kontext], ['aufruf', JSON.stringify(aufruf)]], schluss });
    if (prompt.length <= w.prompt_max_zeichen) return { prompt, zeichen: prompt.length, kontextZeichen: kontext.length };
  }
  return { fehler: `Prompt zu gross (Katalog ${katalogText().length} Zeichen, Obergrenze ${w.prompt_max_zeichen})` };
}

// ---------- Antwort lesen
function bauplanAusText(text) {
  const r = LagePrompt.objektAusText(text, ['beats', 'titel', 'format']);
  return r.plan ? { plan: r.plan } : r;
}

module.exports = { katalogText, katalogNeuLesen, baue, bauplanAusText, typenVon, kontextVon, SYSTEM_DATEI, WERTE };
