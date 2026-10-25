'use strict';
// SUND-03b T: Pool vorab erzeugter Live-Texte (Gemma auf Sleipnir über Ollama). Das Spiel wartet NIE auf ein Modell: Texte entstehen im Hintergrund und werden später synchron aus dem Pool gelesen
// (textFuer in reise-ereignis.js, der Lagefunk bei Verlusten, der Funk beim Söldner-Befehl). Ist der Pool leer, der Schalter aus oder der Transport tot, bleibt der Katalogtext (bzw. bei den neuen
// Slots der heutige Text). Alles hinter einem Schalter, Standard AUS: ohne ihn geschieht hier nichts und der Bestand ist byte-gleich zu 03a.
//
// Schalter: TEXTE_POOL=1 (oder on; 0/off = aus; ohne Variable gilt standard_an aus content/texte/texte-werte.json, heute false). Erzeugt wird zusätzlich nur mit LLM_LIVE=1 (wie jeder Live-Aufruf),
// über den Router NUR auf Ollama (OLLAMA_URL, OLLAMA_MODEL, LLM_MODELL_TEXT): nie Claude, keine Eskalation, der Token-Zähler (CLAUDE_TOKEN_BUDGET) wird nicht belastet.
//
// SCHNITTSTELLE (auch für Paket A, Funk-Antworten):
//   poolEntnehmen(art, id, slot, optionId?) -> string | null
//        Der älteste Text des Schlüssels (art, id, slot[, optionId]) oder null. Jeder Text wird genau EINMAL verbraucht (FIFO, kein Zufall: der Zufallsstrom der Reise und der Sim bleibt unberührt).
//        Platzhalter {ort} und {n} stehen noch im Text: der Aufrufer setzt sie ein, mit einsetzen(text, { ort, n }). Ist der Pool leer, nimmt der Aufrufer seinen Katalogtext.
//   poolBefuellenAnfordern(spec) -> { ok, key?, vorhanden?, ziel?, grund? }
//        Meldet einen Schlüssel zum Nachfüllen an. spec: { art, id, slot, optionId?, fakt (alles, was der Text als Wahrheit nehmen darf; {ort}/{n} nur, wenn erlaubt), sprecher?, stimme? (rom|ger|kon|zivil),
//        beispiele? [Katalogtexte als Stilvorlage, werden nicht abgeschrieben], platzhalter? [erlaubte, Standard keine], pflicht? [Pflicht-Platzhalter], muss? / nicht? [Regex-Texte: Wörter, die vorkommen müssen bzw. nicht], antwort? (Text der Spieler-Antwort, nur Slot reaktion), option? (Absicht der Option,
//        nur Slot antwort), ziel? (Texte vorrätig, 1..5, Standard `ziel` aus den Daten) }. slot ∈ ankuendigung | eintreffen | dank | soeldner | verlust | reaktion | antwort (Längen: texte-werte.json slots;
//        antwort höchstens 40 Zeichen). Freitext (fakt, antwort, option, beispiele) läuft vor dem Prompt durch den Namensfilter (Spielernamen des zuletzt aktiven Spiels). Gefüllt wird im Hintergrund
//        (höchstens ein Job zugleich), der Aufruf kehrt sofort zurück. Die Katalogeinträge der Reise (16) und die Zusatz-Einträge (soeldner_an_rom/_ger, posten_verloren, hafen_gefallen) sind ab Werk angemeldet.
//   einsetzen(text, werte) -> string                {ort}, {n} usw. einsetzen (unbekannte bleiben stehen)
//   poolText(game, art, id, slot, werte, optionId?) -> string | null     entnehmen + einsetzen, nur bei Schalter an (für die Lagefunk-Stellen)
//   aktiv(game) / schalterAn(env) / modus(env)       Schalter und Modus (live | off)
//   freigegeben() -> bool                            darf der Pool gelesen werden (der zuletzt laufende Raum hat den Schalter an)? textFuer fragt das; poolEntnehmen selbst liefert immer, was da ist
//   update(game, dt)                                 zwischen den Ticks (Game-Step): zählt den Leerlauf, startet höchstens einen Job
//   beiGrenze(game, art)                             Tätigkeitsgrenze (game.lageGrenze): hebt die Leerlauf-Wartezeit auf, startet nichts Schweres
//   stand() / status()                               Füllstand je Schlüssel und Zähler (Debug, Tests)
//   setLlm(llm) / zuruecksetzen() / jobFertig()      für Tests (eigener LLM, leerer Zustand, auf den laufenden Job warten)
// Der Pool liegt im Prozessspeicher (Laufzeit): er steht NICHT im Weltstand. Wer ihn füllt, ist ein einziger Job-Schalter für den ganzen Prozess (Sleipnir wird mit Kara geteilt).
const LLM = require('../mission/llm.js');
const Pruefer = require('./texte-pruefer.js');
const Ausschnitt = { spielerNamen: (...a) => require('./lage-ausschnitt.js').spielerNamen(...a) };   // lazy: kein Ladezyklus mit regie-befehle.js

const W = Pruefer.WERTE;
const KATALOG = require('../../content/reise/ereignisse.json').eintraege;
const LAGE_TEXTE = require('../../content/flotte/lage-befehle.json');
const SLOTS = Object.keys(W.slots);

const fmt = (s, o) => String(s == null ? '' : s).replace(/\{(\w+)\}/g, (m, k) => (o && o[k] != null ? String(o[k]) : m));
const einsetzen = fmt;
const platzhalterVon = (t) => [...String(t).matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
const keyVon = (art, id, slot, optionId) => [art, id, slot, optionId || ''].join('|');
const klemme = (x, a, b) => Math.max(a, Math.min(b, x));
const regexOk = (m) => { try { return !!new RegExp(m, 'i'); } catch (e) { return false; } };

function schalterAn(env) {
  const e = env || process.env;
  const v = String((e && e.TEXTE_POOL) || '').toLowerCase();
  if (v === '1' || v === 'on') return true;
  if (v === '0' || v === 'off') return false;
  return W.standard_an === true;
}
const modus = (env) => (String(((env || process.env) || {}).LLM_LIVE || '') === '1' ? 'live' : 'off');
const aktiv = (game) => !!game && schalterAn(game.env || process.env);

// ---------- Anmeldungen (Reise-Katalog und Zusatz aus den Daten; Paket A meldet weitere an)
function katalogSpecs() {
  const out = [];
  for (const e of KATALOG) {
    const f = W.fakten[e.id] || {};
    for (const slot of Object.keys(e.texte || {})) {
      if (!W.slots[slot]) continue;
      const liste = e.texte[slot];
      const mengen = liste.map((t) => new Set(platzhalterVon(t)));
      const erlaubt = [...new Set(mengen.flatMap((m) => [...m]))].filter((p) => W.platzhalter_erlaubt.includes(p));
      const pflicht = erlaubt.filter((p) => mengen.every((m) => m.has(p)));
      const fakt = fmt(f.fakt || e.chronik, { ort: erlaubt.includes('ort') ? '{ort}' : 'dem Ort', n: erlaubt.includes('n') ? '{n}' : 'wenigen' });
      out.push({ art: 'reise', id: e.id, slot, optionId: '', sprecher: e.sprecher, stimme: f.stimme || 'rom', fakt, beispiele: liste.slice(), platzhalter: erlaubt, pflicht, ziel: W.ziel });
    }
    // SUND-03b A: Antwortoptionen der Funk-Antworten (Gerüst in den Daten): Optionstext und Reaktion des Sprechers je Option
    for (const o of e.antworten || []) {
      const kopf = { art: e.art, id: e.id, optionId: o.id, sprecher: e.sprecher, stimme: f.stimme || 'rom', fakt: fmt(f.fakt || e.chronik, { ort: 'dem Ort', n: 'wenigen' }), platzhalter: [], pflicht: [], ziel: W.ziel };
      out.push(Object.assign({}, kopf, { slot: 'antwort', beispiele: [o.text], option: o.id }));
      out.push(Object.assign({}, kopf, { slot: 'reaktion', beispiele: [o.reaktion], antwort: o.text }));
    }
  }
  for (const [id, z] of Object.entries(W.zusatz)) {
    const bsp = Array.isArray(z.beispiele) ? z.beispiele.slice() : id.startsWith('soeldner_an_') ? [((LAGE_TEXTE.soeldner || {})[id.slice(-3) === 'rom' ? 'rom' : 'ger'] || {}).text].filter(Boolean) : [];
    out.push({ art: z.art, id, slot: z.slot, optionId: '', sprecher: z.sprecher || '', stimme: z.stimme, fakt: fmt(z.fakt, { ort: z.platzhalter.includes('ort') ? '{ort}' : 'dem Ort' }), beispiele: bsp, platzhalter: z.platzhalter.slice(), pflicht: z.pflicht.slice(), muss: (z.muss || []).slice(), nicht: (z.nicht || []).slice(), ziel: W.ziel });
  }
  return out;
}

// ---------- Zustand (Laufzeit, nicht im Weltstand)
function neuerZustand() {
  return { freigabe: false, pool: new Map(), angefordert: new Map(), job: null, jobPromise: null, zeit: 0, leer: 0, angestossen: false, pauseBis: 0, fehlerFolge: 0, schluesselPause: new Map(), game: null, llm: null, llmFehler: null,
    zaehler: { jobs: 0, gueltig_1: 0, gueltig_2: 0, ungueltig: 0, fehler: 0, verbraucht: 0, leer_gelesen: 0 } };
}
let S = neuerZustand();
function zuruecksetzen() { S = neuerZustand(); }
function setLlm(llm) { S.llm = llm; }
function jobFertig() { return S.jobPromise || Promise.resolve(); }

function alleSpecs() {
  const m = new Map();
  for (const sp of katalogSpecs()) m.set(keyVon(sp.art, sp.id, sp.slot, sp.optionId), sp);
  for (const [k, sp] of S.angefordert) m.set(k, sp);
  return m;
}

function poolEntnehmen(art, id, slot, optionId) {
  const l = S.pool.get(keyVon(art, id, slot, optionId));
  if (!l || !l.length) { S.zaehler.leer_gelesen++; return null; }
  S.zaehler.verbraucht++;
  return l.shift();
}
// Darf der Pool gelesen werden? Ja, wenn der zuletzt laufende Raum (update/beiGrenze) den Schalter TEXTE_POOL an hat. textFuer (Reise) fragt das, damit ein Raum ohne Schalter nie Pool-Texte bekommt.
function freigegeben() { return S.freigabe === true; }
function poolText(game, art, id, slot, werte, optionId) {
  if (!aktiv(game)) return null;
  const t = poolEntnehmen(art, id, slot, optionId);
  return t == null ? null : einsetzen(t, werte);
}

function poolBefuellenAnfordern(spec) {
  const sp = spec || {};
  const str = (x) => typeof x === 'string' && x.trim() !== '';
  if (!str(sp.art) || !str(sp.id) || !SLOTS.includes(sp.slot)) return { ok: false, grund: 'art, id und ein bekannter slot sind Pflicht' };
  if (!str(sp.fakt)) return { ok: false, grund: 'fakt fehlt (der Text darf nur erzählen, was dort steht)' };
  const liste = (x) => (Array.isArray(x) ? x.filter(str).map(String) : []);
  const norm = {
    art: sp.art, id: sp.id, slot: sp.slot, optionId: str(sp.optionId) ? sp.optionId : '', sprecher: str(sp.sprecher) ? sp.sprecher : '', stimme: ['rom', 'ger', 'kon', 'zivil'].includes(sp.stimme) ? sp.stimme : 'rom',
    fakt: sp.fakt, beispiele: liste(sp.beispiele), platzhalter: liste(sp.platzhalter).filter((p) => W.platzhalter_erlaubt.includes(p)), pflicht: liste(sp.pflicht).filter((p) => W.platzhalter_erlaubt.includes(p)),
    ziel: klemme(Math.floor(Number(sp.ziel)) || W.ziel, 1, 5),
    muss: liste(sp.muss).filter(regexOk), nicht: liste(sp.nicht).filter(regexOk),
  };
  if (str(sp.antwort)) norm.antwort = sp.antwort;
  if (str(sp.option)) norm.option = sp.option;
  const key = keyVon(norm.art, norm.id, norm.slot, norm.optionId);
  S.angefordert.set(key, norm);
  return { ok: true, key, vorhanden: (S.pool.get(key) || []).length, ziel: norm.ziel };
}

// ---------- Erzeugung (ein Job zugleich)
function gesamt() { let n = 0; for (const l of S.pool.values()) n += l.length; return n; }
function naechster() {
  if (gesamt() >= W.gesamt_max) return null;
  let best = null;
  for (const [key, sp] of alleSpecs()) {
    const n = (S.pool.get(key) || []).length;
    if (n >= (sp.ziel || W.ziel)) continue;
    if ((S.schluesselPause.get(key) || 0) > S.zeit) continue;
    if (!best || n < best.n) best = { key, sp, n };   // am wenigsten gefüllt zuerst, bei Gleichstand die Reihenfolge der Anmeldung (kein Zufall)
  }
  return best;
}
function getLlm(game) {
  if (S.llm) return S.llm;
  const env = game.env || process.env;
  if (modus(env) !== 'live') return null;
  try {
    const Router = require('../mission/transport-router.js');
    const modell = String(env.LLM_MODELL_TEXT || '') || undefined;
    const transport = Router.routeTransport({ text: { anbieter: 'ollama', modell } }, { eskalation: null, env });   // nur Ollama, nie Claude, keine Eskalation
    S.llm = LLM.create({ mode: 'live', transport });
  } catch (e) { S.llmFehler = e.message; if (game.countError) game.countError('texte-llm', e); return null; }
  return S.llm;
}
function logge(game, eintrag) {
  try { require('./regie-befehle.js').schreibe(game, Object.assign({ art: 'text_pool', quelle: 'llm' }, eintrag)); } catch (e) { if (game && game.countError) game.countError('texte-log', e); }
}

// EIN Versuch: Prompt bauen, bei llm anfragen, Antwort lesen und prüfen. o { vorhanden[], vorher { antwort, fehler[] }, namen[] }. Wirft bei einem Ausfall des Transports (err.code). Auch das Messwerkzeug nutzt ihn.
// -> { r (Antwort des LLM), p (Prüfung { ok, text, fehler }), prompt }
async function versuch(llm, spec, o) {
  const opt = o || {};
  const sp = Object.assign({}, spec, { namen: opt.namen || [] });
  const prompt = Pruefer.promptBauen(sp, { vorhanden: opt.vorhanden, vorher: opt.vorher });
  const r = await llm.ask('text', { system: Pruefer.SYSTEM_DATEI, prompt, art: spec.art, id: spec.id, slot: spec.slot }, { timeoutMs: W.job_timeout_s * 1000, schema: Pruefer.schemaFuer(spec.slot) });
  // Duplikate: nicht nur der Pool, auch die Stilvorlagen (der Katalogtext darf nicht abgeschrieben werden)
  const p = Pruefer.pruefe(Pruefer.textAusAntwort(r.text), { slot: spec.slot, platzhalter: spec.platzhalter, pflicht: spec.pflicht, stimme: spec.stimme, namen: opt.namen, vorhanden: (opt.vorhanden || []).concat(spec.beispiele || []), muss: spec.muss, nicht: spec.nicht });
  return { r, p, prompt };
}
// Ein Text für einen Schlüssel: Versuch 1, bei ungültig ein Wiederholungsversuch (mit den Fehlern des Prüfers), danach bleibt der Katalogtext.
async function erzeuge(sp, key, llm, game) {
  const namen = Ausschnitt.spielerNamen(game);
  let vorher = null;
  for (let v = 1; v <= Math.max(1, W.versuche); v++) {
    const vorhanden = (S.pool.get(key) || []).slice();
    let r, p;
    try { ({ r, p } = await versuch(llm, sp, { vorhanden, vorher, namen })); } catch (e) { return { ausgang: 'fehler', versuch: v, fehler: e }; }
    const mess = { versuch: v, dauer_s: r.sec == null ? null : r.sec, tokens: r.tokens || 0, anbieter: r.anbieter || null, modell: r.modell || r.modelId || null };
    if (p.ok) {
      if (!S.pool.has(key)) S.pool.set(key, []);
      S.pool.get(key).push(p.text);
      return Object.assign({ ausgang: 'gueltig', text: p.text }, mess);
    }
    vorher = { antwort: r.text, fehler: p.fehler };
    if (v >= W.versuche) return Object.assign({ ausgang: 'ungueltig', fehler: p.fehler, antwort: String(r.text).slice(0, 200) }, mess);
  }
  return { ausgang: 'ungueltig', versuch: 0, fehler: ['keine Versuche'] };
}
function jobEnde(game, key, ergebnis) {
  const z = S.zaehler;
  z.jobs++;
  if (ergebnis.ausgang === 'gueltig') { (ergebnis.versuch === 1 ? z.gueltig_1++ : z.gueltig_2++); S.fehlerFolge = 0; S.pauseBis = 0; }
  else if (ergebnis.ausgang === 'ungueltig') { z.ungueltig++; S.schluesselPause.set(key, S.zeit + W.schluessel_pause_s); S.fehlerFolge = 0; }
  else {
    const code = ergebnis.fehler && ergebnis.fehler.code;
    if (code !== 'ABORTED') {
      z.fehler++;
      S.fehlerFolge++;
      S.pauseBis = S.zeit + Math.min(W.fehler_pause_s.max, W.fehler_pause_s.start * Math.pow(2, S.fehlerFolge - 1));   // Ausfall: kein Wiederholen im Sekundentakt
    }
  }
  const e = ergebnis.fehler;
  logge(game, { ausgang: ergebnis.ausgang, key, versuch: ergebnis.versuch, dauer_s: ergebnis.dauer_s, tokens: ergebnis.tokens, anbieter: ergebnis.anbieter, modell: ergebnis.modell,
    fehler: e ? [].concat(ergebnis.ausgang === 'fehler' ? [((e.code || 'EXIT') + ': ' + String(e.message || e)).slice(0, 200)] : e).slice(0, 6) : undefined });
}
function starten(game) {
  const llm = getLlm(game);
  if (!llm || llm.mode === 'off') return false;
  const n = naechster();
  if (!n) return false;
  S.job = { key: n.key, zeit: S.zeit };
  S.angestossen = false;
  S.jobPromise = erzeuge(n.sp, n.key, llm, game).then(
    (erg) => erg,
    (e) => ({ ausgang: 'fehler', versuch: 1, fehler: e }),
  ).then((erg) => { S.job = null; S.leer = 0; S.angestossen = false; try { jobEnde(game, n.key, erg); } catch (e) { if (game.countError) game.countError('texte-job', e); } });
  return true;
}

// Zwischen den Ticks. Wirft nie in den Aufrufer (das Spiel merkt nichts).
function update(game, dt) {
  try {
    S.freigabe = aktiv(game);   // der zuletzt laufende Raum entscheidet, ob der Pool gelesen werden darf (der Schalter ist sonst prozessweit)
    if (!S.freigabe) return;
    S.game = game;
    S.zeit += Number(dt) || 0;
    if (S.job) return;
    S.leer += Number(dt) || 0;
    if (!(S.angestossen || S.leer >= W.leerlauf_s)) return;
    if (S.zeit < S.pauseBis) return;
    starten(game);
  } catch (e) { if (game && game.countError) game.countError('texte-update', e); }
}
// Tätigkeitsgrenze: nur vormerken (nichts Schweres im Hook, der Job startet im nächsten update)
function beiGrenze(game, art) {   // eslint-disable-line no-unused-vars
  try {
    S.freigabe = aktiv(game);
    if (!S.freigabe) return false;
    S.game = game;
    S.angestossen = true;
    return true;
  } catch (e) { return false; }
}

function stand() {
  const je = {};
  for (const [k, l] of S.pool) if (l.length) je[k] = l.length;
  return { pool: je, gesamt: gesamt(), job: S.job ? S.job.key : null, zaehler: Object.assign({}, S.zaehler), zeit: S.zeit, pauseBis: S.pauseBis, fehlerFolge: S.fehlerFolge };
}
function status() {
  const s = stand(), z = s.zaehler;
  return `Text-Pool: ${s.gesamt} Texte in ${Object.keys(s.pool).length} Schlüsseln, Job ${s.job || 'keiner'}, Jobs ${z.jobs} (gültig 1. Versuch ${z.gueltig_1}, 2. ${z.gueltig_2}, ungültig ${z.ungueltig}, Fehler ${z.fehler}), verbraucht ${z.verbraucht}, leer gelesen ${z.leer_gelesen}`;
}

module.exports = { versuch, getLlm, freigegeben, poolEntnehmen, poolBefuellenAnfordern, einsetzen, poolText, aktiv, schalterAn, modus, update, beiGrenze, stand, status, setLlm, zuruecksetzen, jobFertig, katalogSpecs, keyVon, SLOTS, WERTE: W };
