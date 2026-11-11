'use strict';
// SUND-03b T: Prüfer, Schema und Prompt für die Live-Texte (Action-Layer ohne Zustand; der Pool in texte-pool.js ruft sie). Alle Zahlen und Wortlisten stehen in content/texte/texte-werte.json.
//
//   WERTE                                   die Daten (wert je Schlüssel)
//   schemaFuer(slot) -> JSON-Schema         kleines Schema je Slot-Art (Objekt { text }, nur die Mindestlänge: ein maxLength würde mitten im Wort abschneiden, die Obergrenze prüft pruefe()), geht als `format` an Ollama
//   textAusAntwort(roh) -> string | null    liest die Antwort des Modells (JSON { text }, sonst der blanke Text)
//   pruefe(text, ctx) -> { ok, text, fehler[] }
//        ctx { slot, platzhalter[] (erlaubt), pflicht[], stimme, namen[] (Spielernamen), vorhanden[] (schon im Pool oder als Vorlage: Duplikate), muss[] / nicht[] (Regex-Texte: Pflicht- und Verbotswörter dieses Eintrags),
//              bezug (SPL-02 E2: Zeile mit Bezug: keine Klartext-Eigennamen, keine erfundenen Eigennamen gegen fakt und vorhanden, Daten bezug_pruefung), fakt, ausnahmen[] (gewoehnliche Woerter, die kein Eigenname sind), anrede (Schlüssel aus anreden: ihr = keine Sie-Form) }
//        Regeln: Länge je Slot, nur erlaubte Platzhalter ({ort}, {n}) und alle Pflicht-Platzhalter, keine `{{…}}` und keine losen Klammern, keine Ziffern, keine Spielernamen, keine Zeilenumbrüche, Markdown
//        oder Emojis, ein Satzende, keine verbotenen Wörter (ausweichen, kriegsfolgen, sieger je nach Slot), keine Wörter einer fremden Stimme (Germane klingt nicht römisch), kein Duplikat.
//   promptBauen(spec, o) -> string          der Prompt (statisch aus den Daten, nie aus dem Spielzustand; Freitext des Aufrufers läuft durch den Namensfilter): <figur>, <lage>, <aufgabe>, <stilvorlagen>, <schon_vorhanden>,
//        <spieler_antwort>, bei der Wiederholung <deine_antwort> und <pruefer>. spec { sprecher, stimme, fakt, slot, platzhalter[], pflicht[], beispiele[], antwort?, option?, namen[] }
//   SYSTEM_DATEI                            Pfad content/spielleiter/prompts/text.system.md
const path = require('path');
const Ausschnitt = { ohneNamen: (...a) => require('./lage-ausschnitt.js').ohneNamen(...a) };   // lazy: lage-ausschnitt.js lädt regie-befehle.js, und das lädt den Pool (kein Ladezyklus)

const DATEN = require('../../content/texte/texte-werte.json').werte;
const WERTE = Object.fromEntries(Object.entries(DATEN).map(([k, v]) => [k, v.wert]));
WERTE.slots = Object.assign({}, WERTE.slots, WERTE.slots_abenteuer || {});   // SPL-02 E2: die Slots der Abenteuer-Zeilen stehen in einer eigenen Gruppe (ein Test fixiert die sieben des Reise-Funks), der Pool kennt beide
const SYSTEM_DATEI = path.join(__dirname, '..', '..', 'content', 'spielleiter', 'prompts', 'text.system.md');

const regex = (muster) => new RegExp(muster, 'i');
const VERBOTEN = Object.fromEntries(Object.entries(WERTE.verboten).map(([k, v]) => [k, { re: regex(v.muster), slots: v.slots }]));
const STIMMEN = Object.fromEntries(Object.entries(WERTE.stimmen).map(([k, v]) => [k, regex(v.verboten)]));
const slotWerte = (slot) => WERTE.slots[slot] || null;
const ANREDEN = Object.fromEntries(Object.entries(WERTE.anreden || {}).map(([k, v]) => [k, new RegExp(v.verboten, 'u')]));   // Gross-/Kleinschreibung zaehlt: Sie (Anrede) ist nicht sie (dritte Person)
const normal = (t) => String(t == null ? '' : t).toLowerCase().replace(/[^a-zäöüß{}\s]/g, '').replace(/\s+/g, ' ').trim();

function schemaFuer(slot) {
  const s = slotWerte(slot);
  if (!s) throw new Error('Unbekannter Slot ' + slot);
  return { type: 'object', properties: { text: { type: 'string', minLength: s.min } }, required: ['text'], additionalProperties: false };
}

function textAusAntwort(roh) {
  let t = String(roh == null ? '' : roh).trim();
  if (!t) return null;
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  if (t[0] === '{') {
    try { const o = JSON.parse(t); return o && typeof o.text === 'string' ? o.text : null; } catch (e) { return null; }
  }
  return t;
}

// Äußere Anführungszeichen um den GANZEN Text und Randleerzeichen entfernen (Gemma setzt sie gern); innere bleiben
function bereinigen(text) {
  let t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  const paare = [['"', '"'], ['„', '“'], ['„', '”'], ['»', '«'], ['“', '”']];
  for (const [a, b] of paare) if (t.length > 2 && t[0] === a && t[t.length - 1] === b && !t.slice(1, -1).includes(a)) { t = t.slice(1, -1).trim(); break; }
  return t;
}

// SPL-02 E2: Regeln fuer Zeilen mit Bezug (Daten bezug_pruefung). Namen stehen nur als Platzhalter; was gross geschrieben mitten im Satz steht und weder im fakt noch in den Stilvorlagen vorkommt, ist erfunden.
const gross = (w) => /^[A-ZÄÖÜ]/.test(w);
const stamm = (w, n) => w.toLowerCase().slice(0, n);
function bezugFehler(t, c) {
  const B = WERTE.bezug_pruefung, out = [];
  const Namen = require('./namen-liste.js');   // lazy: die Namenslisten laden die Daten der Fadenmaschine
  const namen = Namen.klartextNamen(t, c.ausnahmen);
  if (namen.length) out.push(`Eigenname im Klartext (Namen nur als Platzhalter {nsc}, {ort}): „${namen.slice(0, 3).join('“, „')}“`);
  const bekannt = new Set(), bekanntStamm = new Set();
  const lies = (x) => { for (const w of String(x == null ? '' : x).replace(/\{\w+\}/g, ' ').match(/\p{L}+/gu) || []) { bekannt.add(w.toLowerCase()); bekanntStamm.add(stamm(w, B.stamm_zeichen)); } };
  lies(c.fakt); for (const v of c.vorhanden || []) lies(v);
  const erlaubt = new Set(B.erlaubte_grosswoerter.concat(B.gewoehnliche_nomen).map((w) => w.toLowerCase()));
  const gewoehnlich = new Set((c.ausnahmen || []).map((w) => String(w).toLowerCase()));   // Dorn, Rabe: auch gewoehnliche Woerter (ausnahmen der Spec, aus absichten.json gewoehnliche_woerter)
  const imNamen = new Set(namen.flatMap((x) => x.split(/\s+/)).map((x) => x.toLowerCase()));   // schon als Klartextname gemeldet
  const erlaubtWort = (k) => erlaubt.has(k) || gewoehnlich.has(k) || Array.from(erlaubt).some((x) => x.length >= 4 && k.startsWith(x) && k.length - x.length <= B.beugung_max);   // gebeugte Form eines erlaubten Wortes (Wege zu Weg)
  const welt = new Set(B.weltbegriffe.map((w) => w.toLowerCase()));
  const ohne = t.replace(/\{\w+\}/g, ' ');
  const erfunden = [];
  const re = /\p{L}+/gu;
  let m;
  while ((m = re.exec(ohne))) {
    const w = m[0], k = w.toLowerCase();
    if (w.length < B.wort_min || !gross(w) || imNamen.has(k) || bekannt.has(k) || bekanntStamm.has(stamm(w, B.stamm_zeichen))) continue;
    const davor = ohne.slice(0, m.index).trimEnd();
    const satzanfang = davor === '' || /[.!?…:]$|[„"»]$/.test(davor);
    if (welt.has(k)) { erfunden.push(w); continue; }
    if (B.erfindung_modus !== 'gross' || satzanfang || erlaubtWort(k) || B.nomen_endungen.some((e) => k.endsWith(e))) continue;   // erfindung_modus weltbegriffe: nur die Liste weltbegriffe zaehlt
    erfunden.push(w);
  }
  if (erfunden.length) out.push(`erfundener Eigenname oder Begriff, der nicht in der Lage steht: „${Array.from(new Set(erfunden)).slice(0, 3).join('“, „')}“`);
  return out;
}

function pruefe(text, ctx) {
  const c = ctx || {};
  const fehler = [];
  if (typeof text !== 'string') return { ok: false, text: '', fehler: ['kein Text'] };
  const t = bereinigen(text);
  const s = slotWerte(c.slot);
  if (!s) return { ok: false, text: t, fehler: ['unbekannter Slot ' + c.slot] };
  if (t.length < s.min) fehler.push(`zu kurz (${t.length} Zeichen, mindestens ${s.min})`);
  if (t.length > s.max) fehler.push(`zu lang (${t.length} Zeichen, höchstens ${s.max})`);
  // Platzhalter: nur die erlaubten, alle Pflicht-Platzhalter, nie {{…}} oder lose Klammern
  if (/\{\{|\}\}/.test(t)) fehler.push('doppelte Klammern {{…}} sind verboten');
  const erlaubt = new Set(c.platzhalter || []), gefunden = new Set();
  for (const m of t.matchAll(/\{(\w*)\}/g)) { gefunden.add(m[1]); if (!erlaubt.has(m[1])) fehler.push(`Platzhalter {${m[1]}} ist hier nicht erlaubt`); }
  for (const p of c.pflicht || []) if (!gefunden.has(p)) fehler.push(`Platzhalter {${p}} fehlt`);
  if (/[{}]/.test(t.replace(/\{\w+\}/g, ''))) fehler.push('lose geschweifte Klammer');
  if (/[\n\r<>*_#`\[\]|\\]/.test(t)) fehler.push('Markdown oder Sonderzeichen');
  if (/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/u.test(t)) fehler.push('Emoji');
  if (!WERTE.ziffern_erlaubt && /\d/.test(t)) fehler.push('Ziffern sind verboten (Zahlen nur als Platzhalter)');
  if (s.satzende !== false && !/[.!?…][“”"»«]?$/.test(t)) fehler.push('kein Satzende');   // Optionstexte (antwort) brauchen keins
  if (c.namen && c.namen.length && Ausschnitt.ohneNamen(t, c.namen) !== t) fehler.push('enthält einen Spielernamen');
  for (const [name, v] of Object.entries(VERBOTEN)) {
    if (!v.slots.includes(c.slot)) continue;
    const m = v.re.exec(t);
    if (m) fehler.push(`verbotenes Wort (${name}): „${m[0]}“`);
  }
  const fremd = c.stimme && STIMMEN[c.stimme] && STIMMEN[c.stimme].exec(t);
  if (fremd) fehler.push(`klingt nicht nach der Stimme (${WERTE.stimmen[c.stimme].name}): „${fremd[0]}“`);
  for (const m of c.muss || []) if (!regex(m).test(t)) fehler.push(`muss „${m}“ enthalten`);
  for (const m of c.nicht || []) { const x = regex(m).exec(t); if (x) fehler.push(`darf „${x[0]}“ nicht enthalten`); }
  if (c.bezug) fehler.push(...bezugFehler(t, c));
  if (c.anrede && ANREDEN[c.anrede]) { const x = ANREDEN[c.anrede].exec(t); if (x) fehler.push(`falsche Anrede (${WERTE.anreden[c.anrede].name}): „${x[0]}“`); }
  if (c.vorhanden && c.vorhanden.length) { const n = normal(t); if (c.vorhanden.some((v) => normal(v) === n)) fehler.push('Duplikat eines vorhandenen Textes'); }
  return { ok: fehler.length === 0, text: t, fehler };
}

const filter = (x, namen) => (namen && namen.length ? Ausschnitt.ohneNamen(x, namen) : String(x == null ? '' : x));
const ph = (liste) => (liste && liste.length ? liste.map((p) => '{' + p + '}').join(', ') : 'keine');

function promptBauen(spec, o) {
  const opt = o || {};
  const namen = spec.namen || [];
  const s = slotWerte(spec.slot);
  if (!s) throw new Error('Unbekannter Slot ' + spec.slot);
  const out = [];
  out.push(`<figur>\nSprecher: ${filter(spec.sprecher || 'ein Funker', namen)}\nStimme: ${WERTE.stimmen_beschreibung[spec.stimme] || WERTE.stimmen_beschreibung.rom}\n</figur>`);
  out.push(`<lage>\n${filter(spec.fakt, namen)}\n</lage>`);
  if (spec.antwort) out.push(`<spieler_antwort>\n${filter(spec.antwort, namen)}\n</spieler_antwort>`);
  if (spec.option) out.push(`<option>\n${filter(spec.option, namen)}\n</option>`);
  const pflicht = spec.pflicht || [];
  out.push(`<aufgabe>\nTextart: ${spec.slot}. ${s.aufgabe}\nLänge: ${s.min} bis ${s.max} Zeichen.\nErlaubte Platzhalter: ${ph(spec.platzhalter)}${pflicht.length ? '; im Text müssen vorkommen: ' + ph(pflicht) : ''}.\n</aufgabe>`);
  const bsp = (spec.beispiele || []).slice(0, WERTE.beispiele_max);
  if (bsp.length) out.push(`<stilvorlagen>\n${bsp.map((b) => '- ' + filter(b, namen)).join('\n')}\n</stilvorlagen>`);
  if (opt.vorhanden && opt.vorhanden.length) out.push(`<schon_vorhanden>\n${opt.vorhanden.map((b) => '- ' + filter(b, namen)).join('\n')}\n</schon_vorhanden>`);
  if (opt.vorher) {
    out.push(`<deine_antwort>\n${String(opt.vorher.antwort).slice(0, 600)}\n</deine_antwort>`);
    out.push(`<pruefer>\n${(opt.vorher.fehler || []).map((e) => '- ' + e).join('\n')}\n</pruefer>`);
    out.push('Schreibe den Text neu und behebe die Fehler. Nur das JSON-Objekt.');
  } else out.push('Schreibe jetzt den Text. Nur das JSON-Objekt {"text": "…"}.');
  return out.join('\n\n');
}

module.exports = { WERTE, SYSTEM_DATEI, schemaFuer, textAusAntwort, pruefe, promptBauen, bereinigen, slotWerte };
