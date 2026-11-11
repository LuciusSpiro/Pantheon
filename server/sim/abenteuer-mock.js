'use strict';
// SUND-04b A2: Mock-Komponist fuer kind 'abenteuer' (llm.js: Modi mock und script ohne eigenen Eintrag). Deterministisch aus Seed und Kontext (Prompt: die Tags <kontext> und <aufruf>, wie abenteuer-prompt.js sie baut):
// erzeugt gueltige Bauplaene und mit dem Anteil `mock.ungueltig_anteil` (content/welt/abenteuer-werte.json) absichtlich ungueltige, je eine der benannten Korruptionen. Fuer Tests und tools/messe-abenteuer.js (Gueltigkeit,
// Ablehnquote je Code, Wiederholung) ohne Netz. Was der Mock liefert, prueft trotzdem die echte Kette: expandiere -> Pruefer -> abenteuerAnbieten.
// SPL-02 E1: Betriebsmodus Absichten (aufruf.modus absicht): der Mock waehlt eine Absicht aus dem Katalog (Daten) nach Geschichte und Lage, mit gueltigen Parametern und Bezuegen, manchmal mit einem absichtlich unmoeglichen Wert
// (Anteil mock.absicht_unmoeglich_anteil), damit der Verhandlungsweg offline laeuft; der zweite Aufruf (Tag pruefer) antwortet mit dem Patch des Klartexts oder, ohne Patch, ohne Ausweg.
//   erzeuge(input) -> { text, korruption: null | Name }     planText(input) -> Text      gueltigerPlan(rng, opt?) -> Bauplan-Objekt
const crypto = require('crypto');
const D = require('./faden-daten.js');
const Bauplan = require('./faden-bauplan.js');
const { WERTE } = require('./abenteuer-daten.js');

const M = WERTE.mock;
const tag = (prompt, name) => {
  const m = String(prompt || '').match(new RegExp('<' + name + '>\\n([\\s\\S]*?)\\n</' + name + '>'));
  return m ? m[1] : null;
};
const lesen = (t, d) => { try { return t ? JSON.parse(t) : d; } catch (e) { return d; } };

// kleiner deterministischer Zufall (mulberry32) aus einem Text
function rngVon(text) {
  let a = crypto.createHash('sha1').update(String(text)).digest().readUInt32LE(0);
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const wahl = (rng, liste) => liste[Math.floor(rng() * liste.length) % liste.length];

const planbar = () => Object.keys(D.BEATS).filter((t) => D.BEATS[t].bauplan && typeof D.BEATS[t].bauplan === 'object' && !D.BEATS[t].abschluss && D.BEATS[t].nur_inszenierer !== true);   // nur_inszenierer: kein Zufallsplan (SPL-02 C0)
const nscAlt = (t) => !!(D.BEATS[t].braucht && D.BEATS[t].braucht.nsc_alt === true);   // SUND-04b B1: Wiedersehen braucht einen NSC aus einem frueheren Faden
const lageKey = (t) => (D.BEATS[t].braucht && D.BEATS[t].braucht.lage) || null;   // SUND-04b B2: ein Beat, der von der Lage abhaengt (Sabotage), steht nur im Plan, wenn der Kontext (faeden.lage) ein Ziel nennt
const abschlussTyp = () => Object.keys(D.BEATS).find((t) => D.BEATS[t].abschluss);

// ein gueltiger Bauplan: zufaellige Typenfolge, die der Expander annimmt (er ist hier das Orakel); sonst der einfachste Plan
// opt.lage: { Lagen-Bedingung: Zahl } (Kontext faeden.lage; fehlt = keine Lage da, kein Beat, der sie braucht)
// opt.wiedersehen: false = kein Beat mit einem NSC aus einem frueheren Faden (Kontext: wiedersehen_nsc 0, dann gibt es kein Angebot); opt.mit = dieser Beat-Typ steht an erster Stelle (Tests, Bot-Lauf)
function gueltigerPlan(rng, o) {
  const opt = o || {};
  const typen = planbar().filter((t) => (!nscAlt(t) || opt.wiedersehen === true || opt.mit === t) && (!lageKey(t) || (opt.lage && opt.lage[lageKey(t)] > 0) || opt.mit === t));
  const min = Math.max(opt.min || M.beats.min, 2), max = Math.max(M.beats.max, min);
  for (let versuch = 0; versuch < 300; versuch++) {
    const n = min + Math.floor(rng() * (max - min + 1));   // Beats inklusive Abschluss
    const beats = [];
    for (let i = 0; i < n - 1; i++) beats.push({ typ: wahl(rng, typen) });
    beats.push({ typ: abschlussTyp() });
    if (opt.mit) beats[0] = { typ: opt.mit };
    // Verzweigung: ein Beat springt bei Scheitern zu einem spaeteren (Ids nur, wo sie Ziel sind)
    if (n >= 3 && rng() < 0.35) {
      const von = Math.floor(rng() * (n - 2)), zu = von + 2 + Math.floor(rng() * (n - von - 2));
      if (zu < n) { beats[zu].id = 'b' + (zu + 1); beats[von].verzweigung = { gescheitert: beats[zu].id }; }
    }
    for (const b of beats) if (D.BEATS[b.typ].optionen === 'erlaubt' && rng() < 0.5) b.optionen = true;
    const plan = { format: 'faden-bauplan/1', titel: wahl(rng, M.titel), anlass: wahl(rng, M.anlass), beats };
    if (rng() < 0.2) plan.namenlos = true;
    if (Bauplan.expandiere(plan).ok) return plan;
  }
  return { format: 'faden-bauplan/1', titel: wahl(rng, M.titel), anlass: wahl(rng, M.anlass), beats: [{ typ: 'spontanhilfe' }, { typ: abschlussTyp() }] };
}

// Korruptionen: je eine benannte Regel, gegen die der Plan verstoesst (der erwartete Code steht im Test, nicht hier)
const KORRUPTION = {
  typ_unbekannt: (p) => { p.beats[0].typ = 'teleport'; return p; },
  abschluss_fehlt: (p) => { p.beats.pop(); return p; },
  abschluss_nicht_letzt: (p) => { const n = p.beats.length; [p.beats[n - 1], p.beats[n - 2]] = [p.beats[n - 2], p.beats[n - 1]]; return p; },
  parameter_verboten: (p) => { p.beats[0].parameter = { geheim: 'x' }; return p; },
  verzweigung_rueckwaerts: (p) => { p.beats[0].id = 'b1'; p.beats[1].verzweigung = { gescheitert: 'b1' }; return p; },
  optionen_bei_gefahr: (p) => { const g = Object.keys(D.BEATS).find((t) => D.BEATS[t].gefahr && D.BEATS[t].bauplan && !D.BEATS[t].abschluss); p.beats.unshift({ typ: g, optionen: true }); return p; },
  enthuellung_ohne_hinweis: (p) => { const e = Object.keys(D.BEATS).find((t) => D.BEATS[t].braucht && D.BEATS[t].braucht.wahrheit); p.beats = [{ typ: e }, { typ: abschlussTyp() }]; return p; },
  proto_schluessel: (p) => JSON.stringify(p).replace('{', '{"__proto__":{"x":1},'),
  zu_gross: (p) => JSON.stringify(p) + ' '.repeat(WERTE.antwort_max_zeichen + 10),
  kein_json: () => 'Ich empfehle ein Abenteuer um eine Haendlerin, die Hilfe braucht. Viel Erfolg!',
  abgeschnitten: (p) => { const t = JSON.stringify(p); return t.slice(0, Math.floor(t.length / 2)); },
  anlass_platzhalter: (p) => { p.anlass = '{name} braucht Hilfe bei {ort}.'; return p; },
  titel_zu_kurz: (p) => { p.titel = 'A'; return p; },
  format_falsch: (p) => { p.format = 'faden-bauplan/2'; return p; },
};

// ---------- SPL-02 E1: Absichten
const katalogAbsichten = () => require('./abenteuer-absicht.js').katalog();   // lazy: der Mock laedt den Pruefer nicht beim Start
const pflichtNsc = (e) => (e.bezug || []).some((b) => b.name === 'nsc' && b.pflicht);
const hatNsc = (e) => (e.bezug || []).some((b) => b.name === 'nsc');
function absichtErzeugen(k, a) {
  const rng = rngVon(['absicht', a.nr, a.art, a.hex, k.tick, (k.ruf && JSON.stringify(k.ruf)) || '', (k.chronik || []).length, (k.letzte_absichten || []).join(',')].join('|'));
  const kat = katalogAbsichten();
  const kennungen = (k.crew_geschichte || []).map((z) => (String(z).match(/^([A-Z]{1,3}\d{1,2})\b/) || [])[1]).filter(Boolean);
  const letzte = k.letzte_absichten || [];
  let namen = Object.keys(kat.absichten).filter((n) => !letzte.includes(n) && (kennungen.length || !pflichtNsc(kat.absichten[n])));
  if (!namen.length) namen = Object.keys(kat.absichten).filter((n) => kennungen.length || !pflichtNsc(kat.absichten[n]));
  const mitNsc = namen.filter((n) => hatNsc(kat.absichten[n]));
  if (kennungen.length && mitNsc.length && rng() < 0.5) namen = mitNsc;   // nach Lage: die Geschichte der Crew traegt eine Absicht mit Person
  const name = wahl(rng, namen), e = kat.absichten[name], st = e.standard || {};
  const parameter = {};
  for (const [p, d] of Object.entries(e.parameter || {})) parameter[p] = d.art === 'zahl' ? d.min + Math.floor(rng() * (d.max - d.min + 1)) : wahl(rng, d.erlaubt);
  const bezug = {};
  for (const b of e.bezug || []) {
    if (b.name === 'nsc' && kennungen.length && (b.pflicht || rng() < 0.5)) bezug.nsc = wahl(rng, kennungen);
    else if (b.name === 'ort' && (b.pflicht || rng() < 0.5)) bezug.ort = a.hex || (k.crew && k.crew.hex);
  }
  const toene = Array.isArray(e.toene) ? e.toene : kat.werte.toene.wert;
  const wendungen = Array.isArray(e.wendungen) && e.wendungen.length ? e.wendungen : ['keine'];
  const bogen = Object.assign({ einsatz: wahl(rng, M.anlass), wendung: wahl(rng, wendungen), preis: wahl(rng, M.anlass) }, st.bogen && rng() < 0.5 ? st.bogen : {});
  const absicht = { format: 'absicht/1', absicht: name, titel: st.titel || wahl(rng, M.titel), parameter, bezug, bogen, ton: toene.includes(e.ton_standard) ? e.ton_standard : wahl(rng, toene) };
  const unmoeglich = rng() < M.absicht_unmoeglich_anteil;
  if (unmoeglich) {   // ein Wert ausserhalb: der Pruefer sagt Nein mit Gegenvorschlag (Zahl: ueber dem Hoechstwert, Liste: Tippfehler, sonst ein unbekannter Ton)
    const ps = Object.entries(e.parameter || {});
    if (ps.length) { const [p, d] = ps[Math.floor(rng() * ps.length) % ps.length]; absicht.parameter[p] = d.art === 'zahl' ? d.max + 1 : String(d.erlaubt[0]) + 'x'; }
    else absicht.ton = 'wuetend';
  }
  let text = JSON.stringify(absicht);
  if (rng() < 0.3) text = 'Hier ist die Absicht:\n```json\n' + JSON.stringify(absicht, null, 1) + '\n```';
  return { text, korruption: unmoeglich ? 'absicht_unmoeglich' : null };
}
// zweiter Aufruf: der Klartext des Neins nennt am Ende einen Patch ("Patch: [...]"), wenn jeder Fehler einen Gegenvorschlag hat: der Mock uebernimmt ihn; sonst weiss er keinen Ausweg
function verhandlungText(pruefer) {
  const m = String(pruefer).match(/^Patch: (.*)$/m);
  let patch = null;
  try { patch = m ? JSON.parse(m[1]) : null; } catch (e) { patch = null; }
  return Array.isArray(patch) ? JSON.stringify({ patch }) : 'Dafuer weiss ich keinen Ausweg.';
}

// Kontext faeden.wiedersehen_nsc ist eine Zahl je Volk: der Mock-Plan hat das Standard-Volk-Set, ein Wiedersehen braucht dort mindestens einen NSC
const wiedersehenDa = (z) => !!z && typeof z === 'object' && D.BAUPLAN.werte.volk_erlaubt_standard.some((v) => Number(z[v]) > 0);
function erzeuge(input) {
  const prompt = input && input.prompt;
  const k = lesen(tag(prompt, 'kontext'), {});
  const a = lesen(tag(prompt, 'aufruf'), {});
  if (tag(prompt, 'pruefer') !== null) return { text: verhandlungText(tag(prompt, 'pruefer')), korruption: null };   // SPL-02 E1: zweiter Aufruf (Verhandlung)
  if (a.modus === 'absicht') return absichtErzeugen(k, a);   // SPL-02 E1
  const rng = rngVon(['abenteuer', a.nr, a.art, a.hex, k.tick, (k.ruf && JSON.stringify(k.ruf)) || '', (k.chronik || []).length].join('|'));
  const kaputt = rng() < M.ungueltig_anteil;
  const name = kaputt ? wahl(rng, M.korruptionen.filter((n) => KORRUPTION[n])) : null;
  let plan = gueltigerPlan(rng, { min: name ? 3 : 2, wiedersehen: wiedersehenDa(k.faeden && k.faeden.wiedersehen_nsc), lage: k.faeden && k.faeden.lage });
  let text;
  if (name) { const r = KORRUPTION[name](plan); text = typeof r === 'string' ? r : JSON.stringify(r); }
  else text = JSON.stringify(plan);
  // Zaeune und Text davor: wie ein gespraechiges Modell (die Lesart muss damit umgehen)
  if (!name && rng() < 0.3) text = 'Hier ist der Bauplan:\n```json\n' + JSON.stringify(plan, null, 1) + '\n```';
  return { text, korruption: name };
}
const planText = (input) => erzeuge(input).text;

module.exports = { erzeuge, planText, gueltigerPlan, KORRUPTION, rngVon };
