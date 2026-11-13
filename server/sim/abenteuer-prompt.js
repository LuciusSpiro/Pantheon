'use strict';
// SUND-04b A2: Prompt des Abenteuer-Aufrufs (kind abenteuer, Stufe bauplan) und Lesen seiner Antwort. Reine Funktionen, kein Zustand, kein Netz.
// Eigener Aufruf, NICHT der Takt-Prompt der Lage (der hat nur ~2 500 Zeichen Reserve von 16 000: Komposition dort drueckte den Ausschnitt).
//
//   katalogText()                 Katalog der Beat-Typen mit Parametern, Standard-Zustaenden und den Regeln, ABGELEITET aus den Daten (content/faeden/beats.json `bauplan`, bauplan.json, werte.json, szenen-werte.json). Statisch.
//   baue(game, { nr, grenze, hex, letzte, werte }) -> { prompt, zeichen, kontextZeichen } | { fehler }
//                                 Reihenfolge fuer das Caching: Katalog (statisch) -> Kontext -> Aufruf -> Schluss. KEINE Spielernamen: der Kontext nennt die Crew nur als Crew (Rang, Stufe, Ort); Freitext (Chronik) ist vom Ausschnitt
//                                 der Lage schon gefiltert; Titel und Anlass frueherer Abenteuer (freier Text des Modells) stehen nie im Kontext, nur ihre Typenfolge.
//                                 SPL-02 D: baue(..., { geschichte }) / Datenwert geschichte.json im_prompt (Standard aus): haengt die Crew-Geschichte als Kontext-Feld crew_geschichte an (4 bis 6 Zeilen mit Kennung K1.., abenteuer-geschichte.js; nie ein Spielername) und gibt `kennungen` mit zurueck
//   bauplanAusText(text)          -> { plan } | { fehler }   das erste lesbare JSON-Objekt (Zaeune, Text davor/danach, Komma vor }/] wie beim Plan der Lage)
//   typenVon(vorlage)             Typenfolge einer expandierten Vorlage (ohne Abschluss)
const path = require('path');
const LLM = require('../mission/llm.js');
const D = require('./faden-daten.js');
const Ausschnitt = require('./lage-ausschnitt.js');
const LagePrompt = require('./lage-prompt.js');
const { WERTE } = require('./abenteuer-daten.js');
const Orte = require('./abenteuer-orte.js');
const Geschichte = () => require('./abenteuer-geschichte.js');   // SPL-02 D

const SYSTEM_DATEI = path.join(LLM.PROMPT_DIR, 'abenteuer.system.md');
const W = D.WERTE, B = D.BEATS, BP = D.BAUPLAN, BW = BP.werte, RW = D.BRETT.werte.wiederholung;
const waren = () => Object.keys(require('../../content/faeden/szenen-werte.json').werte.waren.wert);
const liste = (a) => a.join(' | ');

// ---------- Katalog aus den Daten
let katalogCache = null;
function parameterText(bp) {
  const ps = Object.entries(bp.parameter || {}).filter(([, s]) => !(s && s.verborgen === true));   // BEA-01 C2: ein Parameter mit verborgen: true (Datenfeld in beats.json bauplan.parameter) steht nicht im Katalog des Modells (spart Zeichen; er gilt weiter, der Standard und der Inszenierer setzen ihn)
  if (!ps.length) return 'keine Parameter';
  return ps.map(([k, s]) => {
    const erlaubt = Array.isArray(s.erlaubt) ? (s.erlaubt.length === 1 && s.erlaubt[0] === '$ort' ? 'der Ort des Abenteuers' : liste(s.erlaubt))
      : s.erlaubt === 'fluchtziel' ? `Hex-Code oder ${liste(W.fluchtziele)}` : s.erlaubt === 'waren' ? liste(waren()) : '?';
    if (s.erlaubt === 'landeplatz') return `${k} (id)`;   // DYN-01 B: ohne Standard
    return `${k} (Standard ${s.standard === '$ort' ? 'der Ort des Abenteuers' : s.standard}; erlaubt ${erlaubt})`;
  }).join(', ');
}
function katalogText() {
  if (katalogCache) return katalogCache;
  const T = BW.titel, A = BW.anlass;
  const L = [];
  L.push(`Bauplan (dein Antwortobjekt, Format faden-bauplan/1): { "format": "faden-bauplan/1", "titel": Text mit ${T.min} bis ${T.max} Zeichen, "anlass"?: Text mit ${A.min} bis ${A.max} Zeichen (warum es dieses Abenteuer gibt; ohne geschweifte Klammern, ohne Namen), "namenlos"?: true, "volk_erlaubt"?: [${liste(W.voelker)}] (Standard ${BW.volk_erlaubt_standard.join(' | ')}), "wahrheit"?: Kennung, "landeplaetze"?: [Landeplatz, ...], "beats": [Beat, ...] }`);
  L.push(`Landeplatz (Ort fuer die Dauer des Abenteuers, hoechstens ${Orte.DATEN.orte_max}): { "id": a-z0-9_ (bis 16 Zeichen), "art": ${liste(Orte.DATEN.arten)}, "besitz"?: a-z_, "name"?: Text }, nie Seed, Biom oder Besetzung. Beat-Parameter landeplatz (id) landet dort; Beats duerfen einen Platz teilen, jeder Platz braucht einen Beat. Art nur aus Kontext landeplatz_arten. Platz erst nach ${liste(Object.keys(B).filter((t) => B[t].verlegt_ort === true && B[t].nur_inszenierer !== true))} genutzt: nur ${liste(require('./planeten-eignung.js').DATEN.punkt)}.`);
  L.push('Beat: { "typ": Beat-Typ, "id"?: Text a-z0-9_ (nur als Ziel einer Verzweigung noetig), "parameter"?: { nur die Parameter des Typs }, "optionen"?: true, "verzweigung"?: { "gelungen"?: id eines SPAETEREN Beats, "gescheitert"?: id eines SPAETEREN Beats }, "erfolg"?: [Beat-Typen] (nur am Abschluss) }');
  L.push(`Laenge: 2 bis ${W.beats_max} Beats; hoechstens ${W.abenteuer.plan_max_zeichen} Zeichen serialisiert. Der letzte Beat ist der Abschluss (und nur der letzte). Die Beats laufen der Reihe nach, eine Verzweigung springt nur nach vorn. Zustaende, Ausgaenge, Folgen, Optionstexte und Hinweise schreibst du NIE: sie kommen aus den Daten.`);
  L.push('Beat-Typen (nur diese; Zustaende des NSC: ' + liste(W.status) + '):');
  for (const [typ, c] of Object.entries(B)) {
    const bp = c.bauplan;
    if (!bp || typeof bp !== 'object') continue;   // ein Typ ohne Standards kann in keinem Plan stehen
    if (c.nur_inszenierer === true) continue;   // SPL-02 C0: nur ueber den Inszenierer planbar, nicht im Katalog des Modells (Datenfeld in beats.json)
    const br = c.braucht || {};
    const flags = [c.gefahr ? 'Gefahr' : null, c.szene ? 'Szene' : null].filter(Boolean);
    const opt = c.optionen === 'erlaubt' ? (bp.optionen_pflicht ? 'Optionen Pflicht ("optionen": true)' : 'Optionen erlaubt ("optionen": true)') : 'keine Optionen';
    const st = (ag) => (bp.aus && bp.aus[ag] && bp.aus[ag].status ? liste(bp.aus[ag].status) : 'unveraendert');
    const nach = c.abschluss ? 'beendet den Faden' : `NSC danach: gelungen ${st('gelungen')}, gescheitert ${st('gescheitert')}`;
    const braucht = [br.nsc_status ? `braucht den NSC im Zustand ${liste(br.nsc_status)}` : null, br.wahrheit ? 'braucht eine Wahrheit' : null, br.hinweis_vorher ? 'braucht vorher einen Beat mit Hinweis-Traeger auf jedem Weg' : null, br.letzter ? 'nur als letzter Beat' : null, c.nur_einmal === true ? 'hoechstens einmal je Plan' : null, br.landeplatz === true ? 'Pflicht: landeplatz' : null, br.lage ? `braucht die Lage ${br.lage} (Kontext faeden.lage.${br.lage} groesser 0)` : null].filter(Boolean);
    L.push(`- ${typ}${flags.length ? ' [' + flags.join(', ') + ']' : ''}: ${c.zweck} ${opt}. Parameter: ${parameterText(bp)}. ${bp.hinweis_traeger ? 'Hinweis-Traeger. ' : ''}${braucht.length ? braucht.join('; ') + '. ' : ''}Start-Zustand ${bp.start_status}. ${nach}.`);
  }
  L.push(`Wahrheiten (nur mit einem Beat, der eine Wahrheit braucht): ${Object.entries(BP.wahrheiten).map(([k, w]) => `${k} (${w.fraktion ? 'der NSC ist in Wahrheit ' + w.fraktion : 'verborgen'})`).join('; ')}. Ohne Angabe gilt ${BW.wahrheit_standard}. Die Hinweise streut der Code an alle Hinweis-Traeger vor der Enthuellung.`);
  if (Object.values(B).some((c) => c.braucht && c.braucht.nsc_alt === true)) L.push(`Kontext faeden.wiedersehen_nsc: Zahl je Volk (${liste(W.voelker)}) der NSC aus abgeschlossenen Faeden, die fuer einen Beat mit NSC aus einem frueheren Faden taugen (nur Zahlen, keine Namen). Ein solcher Beat steht nur am Anfang und nur, wenn die Zahl in mindestens einem Volk deines volk_erlaubt (Standard ${BW.volk_erlaubt_standard.join(' | ')}) groesser 0 ist; sonst kein Angebot. Setzt du volk_erlaubt, nimm ein Volk mit einer Zahl groesser 0.`);
  const lagen = Array.from(new Set(Object.values(B).map((c) => c.braucht && c.braucht.lage).filter(Boolean)));
  if (lagen.length) L.push(`Kontext faeden.lage: Zahl je Lage (${lagen.join(' | ')}), nur Zahlen, keine Namen. Ein Beat, der eine Lage braucht, steht nur im Plan, wenn seine Zahl groesser 0 ist (sonst lehnt der Pruefer den Plan ab); sie haengt von der Welt ab und aendert sich, die Zahl im Kontext gilt jetzt.`);
  L.push(`Regeln, die der Pruefer erzwingt: bei Gefahr nie Optionen; Scheitern muss etwas veraendern (anderer Weg oder anderer Zustand); Annehmen und Ablehnen einer Bitte muessen in verschiedene Beats fuehren (verzweigung); jeder Beat muss erreichbar sein; "namenlos": true nur mit Typen, die einen NSC im Zustand aktiv zulassen. Ein erfolg-Eintrag nennt hoechstens ${BW.erfolg_max} Typen, die im Plan vorkommen. Wiederholung (Daten abenteuer-brett.json werte.wiederholung): nie dieselbe Typenfolge wie eines der letzten ${RW.folge_zuletzt} Abenteuer (Kontext letzte_abenteuer) oder wie ein offenes Angebot; nie derselbe erste Beat wie eines der letzten ${RW.ort_typ_zuletzt} Abenteuer an diesem Ort (Kontext sperre_beginn: erste Beat-Typen, die hier gesperrt sind); ein Wiedersehen nie mit der Hauptfigur der letzten ${RW.nsc_zuletzt} Abenteuer (die Zahl in faeden.wiedersehen_nsc zaehlt sie nicht).`);
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
  // SUND-04b B1: wie viele NSC aus abgeschlossenen Faeden fuer ein Wiedersehen taugen, JE VOLK (nur Zahlen, nie ein Name): ein Plan mit Wiedersehen braucht einen in einem Volk seines volk_erlaubt, sonst gibt es kein Angebot
  const wiedersehen = require('./abenteuer-wiederholung.js').zahlenFrisch(game);   // SUND-04b E3: ohne die Hauptfiguren der letzten Abenteuer (sonst lehnte das Brett den Plan ab)
  // SUND-04b B2: Lagen-Bedingungen der Beats (Sabotage: wie viele Ziele stehen, 0 in der Pause): nur Zahlen
  const lage = {};
  for (const c of Object.values(B)) { const k = c.braucht && c.braucht.lage; const l = typeof k === 'string' ? require('./faden-b2.js').lage(k) : null; if (l) lage[k] = l.zahl(game); }
  return { aktiv, laufende_abenteuer: abenteuer, abenteuer_angebote: require('./faden-pruefer.js').regulaereAngebote(F).map((a) => typenVon(a.vorlage)), notruf_angebote: F.angebote.length, wiedersehen_nsc: wiedersehen, lage };
}
// SUND-04b E3: die Typenfolgen, gegen die das Brett prueft (die zuletzt BEGONNENEN Abenteuer aus dem Kanon) und die zuletzt angebotenen dieses Spielleiters, ohne Doppelte, aelteste zuerst; nie Titel, Anlass oder Namen
function letzteAbenteuer(game, letzte, werte) {
  const alle = require('./abenteuer-wiederholung.js').letzteFolgen(game).concat((letzte || []).slice(-werte.letzte_abenteuer).map((x) => x.typen));
  return alle.filter((t, i) => alle.findIndex((u) => JSON.stringify(u) === JSON.stringify(t)) === i);
}
// erste Beat-Typen, die an diesem Ort gesperrt sind (derselbe Ort UND derselbe erste Beat wie eines der letzten Abenteuer, WIEDERHOLUNG_ORT)
function sperreBeginn(game, hex) {
  const typen = require('./abenteuer-wiederholung.js').verlauf(game).slice(0, RW.ort_typ_zuletzt).filter((e) => e.ort === hex).map((e) => e.folge[0]);
  return typen.filter((t, i) => typen.indexOf(t) === i);
}
// Der verdichtete Kontext: nur was der Ausschnitt der Lage schon gefiltert liefert (Chronik ohne Namen, Crew ohne Namen) und der Faden-Zustand ohne NSC-Namen.
function kontextVon(game, werte, letzte, stufe, hex, mitGeschichte) {
  const a = JSON.parse(Ausschnitt.ausschnitt(game, { stufe }).text);
  const f = a.flotten || {};
  const wende = [].concat((f.gefallen || []).map((x) => Object.assign({ art: 'gefallen' }, x)), (f.belagert || []).map((x) => Object.assign({ art: 'belagert' }, x)), (f.unterwegs || []).map((x) => Object.assign({ art: 'marsch' }, x))).slice(-werte.wendepunkte_max);
  const crew = a.crew || {};
  const k = {
    tick: a.tick,
    crew: { rang: crew.rang, stufe: crew.stufe, ort: crew.ort, hex: crew.hex },
    ruf: a.ruf, lage: a.lage,
    wendepunkte: wende,
    chronik: (a.chronik || []).slice(-werte.chronik_zeilen),
    faeden: fadenKontext(game),
    landeplatz_arten: Orte.moeglicheArten(hex),   // DYN-01 B: Kartenarten, die am Hex der Crew gehen (sonst lehnt der Pruefer den Plan ab)
    letzte_abenteuer: letzteAbenteuer(game, letzte, werte),
    sperre_beginn: sperreBeginn(game, hex),
  };
  // SPL-02 D: die Crew-Geschichte (4 bis 6 Zeilen mit Kennung, abenteuer-geschichte.js), nur bei gesetztem Schalter (Datenwert im_prompt oder baue({ geschichte })); sonst bleibt der Kontext byte-gleich
  if (mitGeschichte) k.crew_geschichte = Geschichte().geschichteZeilen(game).zeilen;
  return k;
}
const sortiert = (x) => require('../mission/context.js').sortKeys(x);

function baue(game, { nr, grenze, hex, letzte, werte, geschichte }) {
  const w = werte || WERTE;
  const schluss = 'Gib jetzt den Bauplan aus. Nur das JSON-Objekt.';
  const aufruf = { art: String(grenze || 'unbekannt'), nr: Number.isInteger(nr) ? nr : 1, hex: hex || null };
  const stufen = Ausschnitt.STUFEN.length;
  const mitGeschichte = geschichte === undefined ? Geschichte().imPromptStandard() : geschichte === true;
  // erst der volle Kontext, dann gekuerzt (kleinere Stufe des Ausschnitts, weniger Chronik und Wendepunkte), bis die Obergrenze haelt
  for (let s = 0; s < stufen + 2; s++) {
    const ww = Object.assign({}, w);
    if (s >= stufen) { ww.chronik_zeilen = Math.max(1, Math.floor(w.chronik_zeilen / (s - stufen + 2))); ww.wendepunkte_max = Math.max(1, Math.floor(w.wendepunkte_max / (s - stufen + 2))); }
    const kontext = JSON.stringify(sortiert(kontextVon(game, ww, letzte, Math.min(s, stufen - 1), hex, mitGeschichte)));
    const prompt = LLM.buildPrompt({ katalog: katalogText(), variabel: [['kontext', kontext], ['aufruf', JSON.stringify(aufruf)]], schluss });
    // kennungen: damit Prompt und Aufloesung (pruefeAbsicht) zum selben Zustand gehoeren
    if (prompt.length <= w.prompt_max_zeichen) return Object.assign({ prompt, zeichen: prompt.length, kontextZeichen: kontext.length }, mitGeschichte ? { kennungen: Geschichte().geschichteZeilen(game).kennungen } : {});
  }
  return { fehler: `Prompt zu gross (Katalog ${katalogText().length} Zeichen, Obergrenze ${w.prompt_max_zeichen})` };
}

// ---------- SPL-02 E1: Betriebsmodus Absichten (Schalter ABENTEUER_ABSICHTEN, abenteuer-absicht.js). Eigene Funktionen statt eines Schalters in baue/katalogText: Katalog aus den prompt_zeile der Absichten
// (nie zugleich die Beat-Zeilen), schlanker Kontext (nur was fuer die Wahl einer Absicht zaehlt, keine Typenfolgen), immer mit der Crew-Geschichte. Der Katalog der Absichten kommt vom Aufrufer
// (abenteuer-absicht.js laedt den Pruefer): dieses Modul liest ihn nicht selbst.
function katalogTextAbsicht(katalog) {
  const T = BW.titel, A = BW.anlass, w = katalog.werte, K = Object.entries(katalog.absichten);
  const L = [];
  L.push(`Absicht (dein Antwortobjekt, Format absicht/1): { "format": "absicht/1", "absicht": Name aus der Liste, "titel": Text mit ${T.min} bis ${T.max} Zeichen, "parameter"?: { nur die Parameter der Absicht }, "bezug"?: { "nsc"?: Kennung aus crew_geschichte, "ort"?: Hex-Code }, "bogen": { "einsatz": Text mit ${A.min} bis ${A.max} Zeichen, "wendung": Symbol der Absicht oder keine, "preis": Text mit ${A.min} bis ${A.max} Zeichen }, "ton": ${liste(w.toene.wert)} }`);
  L.push('titel, einsatz und preis: ohne geschweifte Klammern und ohne Eigennamen (Personen, Orte, Schiffe); den NSC nennst du nie mit Namen, nur mit seiner Kennung im Bezug.');
  L.push('Absichten (nur diese; die Welt macht daraus das Abenteuer und sagt Nein, wenn es nicht geht):');
  for (const [, e] of K) if (typeof e.prompt_zeile === 'string') L.push(e.prompt_zeile);
  L.push('Bezug nsc: nur eine Kennung aus crew_geschichte (K1, K2, ...), nie ein Name. Fehlt der passende NSC, waehle eine Absicht ohne Pflicht-Bezug. Wendung nur aus der Zeile der Absicht. Wiederhole nicht die Absichten aus letzte_absichten.');
  return L.join('\n');
}
// Kontext der Absichten: Crew, Ruf, Lage, Chronik ohne Namen, was gerade laeuft (Zahlen), die Crew-Geschichte (Zeilen mit Kennung) und die zuletzt angebotenen Absichten
function kontextAbsichtVon(game, werte, letzteAbsichten, stufe, geschichte) {
  const a = JSON.parse(Ausschnitt.ausschnitt(game, { stufe }).text);
  const f = a.flotten || {};
  const wende = [].concat((f.gefallen || []).map((x) => Object.assign({ art: 'gefallen' }, x)), (f.belagert || []).map((x) => Object.assign({ art: 'belagert' }, x)), (f.unterwegs || []).map((x) => Object.assign({ art: 'marsch' }, x))).slice(-werte.wendepunkte_max);
  const crew = a.crew || {};
  const F = require('./faden.js').zustandVon(game);
  const lage = {};
  for (const c of Object.values(B)) { const k = c.braucht && c.braucht.lage; const l = typeof k === 'string' ? require('./faden-b2.js').lage(k) : null; if (l) lage[k] = l.zahl(game); }
  return {
    tick: a.tick,
    crew: { rang: crew.rang, stufe: crew.stufe, ort: crew.ort, hex: crew.hex },
    ruf: a.ruf, lage: a.lage,
    wendepunkte: wende,
    chronik: (a.chronik || []).slice(-werte.chronik_zeilen),
    laufend: { abenteuer: F.liste.filter((x) => x.phase !== 'abgeschlossen' && x.plan).length, angebote: require('./faden-pruefer.js').regulaereAngebote(F).length, notrufe: F.angebote.length, lage },
    letzte_absichten: (letzteAbsichten || []).slice(-werte.letzte_abenteuer),
    crew_geschichte: geschichte.zeilen,
  };
}
// -> { prompt, zeichen, kontextZeichen, katalogZeichen, kennungen } | { fehler }. kennungen: die Kennungen DIESES Prompts (K1 -> Vollname), vom Aufrufer am Job gehalten: nur sie gelten fuer die Antwort
function baueAbsicht(game, { nr, grenze, hex, letzteAbsichten, werte, katalog }) {
  const w = werte || WERTE;
  const schluss = 'Gib jetzt die Absicht aus. Nur das JSON-Objekt.';
  const aufruf = { art: String(grenze || 'unbekannt'), nr: Number.isInteger(nr) ? nr : 1, hex: hex || null, modus: 'absicht' };
  const stufen = Ausschnitt.STUFEN.length;
  const geschichte = Geschichte().geschichteZeilen(game);
  const kat = katalogTextAbsicht(katalog);
  for (let s = 0; s < stufen + 2; s++) {
    const ww = Object.assign({}, w);
    if (s >= stufen) { ww.chronik_zeilen = Math.max(1, Math.floor(w.chronik_zeilen / (s - stufen + 2))); ww.wendepunkte_max = Math.max(1, Math.floor(w.wendepunkte_max / (s - stufen + 2))); }
    const kontext = JSON.stringify(sortiert(kontextAbsichtVon(game, ww, letzteAbsichten, Math.min(s, stufen - 1), geschichte)));
    const prompt = LLM.buildPrompt({ katalog: kat, variabel: [['kontext', kontext], ['aufruf', JSON.stringify(aufruf)]], schluss });
    if (prompt.length <= w.prompt_max_zeichen) return { prompt, zeichen: prompt.length, kontextZeichen: kontext.length, katalogZeichen: kat.length, kennungen: geschichte.kennungen };
  }
  return { fehler: `Prompt zu gross (Katalog ${kat.length} Zeichen, Obergrenze ${w.prompt_max_zeichen})` };
}

// ---------- Antwort lesen
function bauplanAusText(text) {
  const r = LagePrompt.objektAusText(text, ['beats', 'titel', 'format']);
  return r.plan ? { plan: r.plan } : r;
}
// SPL-02 E1: derselbe Weg (Zaeune, Text davor und danach, Komma vor }/]) fuer die Antwort des Modells im Modus Absichten: eine Absicht (absicht/1) oder eine Verhandlungsantwort ({ patch })
function absichtAusText(text) {
  const r = LagePrompt.objektAusText(text, ['absicht', 'patch', 'format']);
  return r.plan ? { absicht: r.plan } : r;
}

module.exports = { katalogText, katalogNeuLesen, baue, bauplanAusText, typenVon, kontextVon, SYSTEM_DATEI, WERTE, katalogTextAbsicht, baueAbsicht, absichtAusText };
