'use strict';
// Szenen-Bauer des Spielleiters (CONTRACT-S2 §2.1): Grobplan prüfen, Szenen aus Katalog-Umsetzungen zusammensetzen,
// daraus ein vollständiges Regiebuch bauen (Rohfassung oder mit ausgearbeiteten Szenen). Übernommen aus
// tools/test-spielleiter.js (S1: checkGrobplan, assembleScene, sceneTestBook, evaluateScene), die ihrerseits aus dem
// Trockenversuch stammen (concept/regiebuch/trockenversuch/{grobplan,szene}.js).
//
//   buildEnv(katalog)                                   -> env für die Prüfungen (Katalog, Orte, Karten, NSC)
//   checkGrobplan(g, env)                               -> [Fehlertext]  (Regeln aus dem Trockenversuch, unverändert)
//   checkGrobplanS2(g, env, kontext, opts)              -> { errors: [Text], warnings: [Text] }  (neue S2-Regeln)
//   assembleScene(g, s, answer, env, opts?)             -> { steps, texte, buehne, besetzung, on, fehler }
//   rohAnswer(g, s, env)                                -> Szenen-Antwort aus Rückfall-/Testparametern (Rohfassung)
//   buildBook(g, answers, env, opts)                    -> { book, errors, warnings, szenen: { sid: { quelle, fehler } } }
//   parseFolge(f)                                       -> Aktion für ausgaenge.folgen (Kurzform aus dem Grobplan)
//   sceneOfStep(g, stepId) / entryStepOf(...)           -> Zuordnung Schritt <-> Szene
//
// Jeder Schritt bekommt `umsetzung: "<molekuel>/<umsetzung>"` (Bots, Logbuch, onSceneEnter); Anflug-Schritte tragen die
// Umsetzung der Szene, zu der sie führen. `liefert_flags` der Umsetzungen (KATALOG, z. B. "{{id}}_heil") sind für die
// Verzweigung erlaubt und stehen am Schritt.
//
// S2b (CONTRACT-S2B §4):
//   missionCast(g, env)                                 -> { named: Set(npc), neu: Set(Name) }  Besetzung der Mission
//   sceneVoice(g, s, role)                              -> Funk-Sprecher einer Szene (stimme | Auftraggeber | neu:…)
//   normalizeGrobplan(g)                                -> [Reparatur]  (Belohnung nur als belohnung_marken, doppelte weiter)
//   repairSceneAnswer(g, s, answer, env)                -> { answer, repairs: [Text] }  (einfache Szenenfehler)
//   speakerErrors(steps, cast, stimmen)                 -> [Text]  (Prüfregel SPRECHER: Funk-Sprecher ∈ Besetzung)
//   factContradictions(texte, fakten)                   -> [Text]  (Prüfregel ERINNERUNG-WIDERSPRUCH)
//   rewardContradictions(g)                             -> [Text]  (Belohnung im Text ≠ belohnung_marken)
// Rohfassung plan-treu: Funk-Sprecher = stimme der Szene (sonst Auftraggeber; Gegenüber-Rolle `npc` ohne stimme: neue
// Stimme), Namen aus ziel_name, Schiffsklasse aus schiff/ziel_name – nie ein Fremd-NSC aus den Testwerten.

const fs = require('fs');
const path = require('path');
const Katalog = require('./katalog.js');
const Checker = require('./checker.js');
const Loader = require('./loader.js');
const Locations = require('../../shared/locations.js');

const ROOT = path.join(__dirname, '..', '..');
const ODA_MAX = 120;
const FAIL_RE = /abbruch|gescheitert|fehlschlag|misserfolg|verloren|verpasst|aufgegeben|unvollstaendig/i;
const GLOBAL_FLAGS = ['selaCalled', 'vaelenHelped', 'technikerRescued', 'bribed', 'decision', 'm3Direct', 'rearguardRepelled'];
const clone = (o) => JSON.parse(JSON.stringify(o));
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const slug = (s, n) => String(s || '').toLowerCase().replace(/[äÄ]/g, 'ae').replace(/[öÖ]/g, 'oe').replace(/[üÜ]/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').replace(/^([0-9])/, 'x$1').slice(0, n || 24) || 'plan';
const shortText = (t, max) => { const s = String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); return s.length > max ? s.slice(0, max - 1) + '…' : s; };

// ---------- Umgebung für die Prüfungen ----------
function buildEnv(katalog) {
  const REG = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'regiebuch', 'bausteine.json'), 'utf8'));
  const npc = new Set(Object.keys(REG.npc).filter((k) => !k.startsWith('$')));
  const npcFile = path.join(ROOT, 'content', 'npc.json');
  if (fs.existsSync(npcFile)) { try { for (const k of Object.keys(JSON.parse(fs.readFileSync(npcFile, 'utf8')).npc || {})) npc.add(k); } catch (e) { /* bleibt bei bausteine.json */ } }
  return {
    katalog,
    LOC: Object.fromEntries(Locations.LOCATIONS.map((l) => [l.id, l])),
    MAP_OF_LOC: Object.fromEntries(Locations.LOCATIONS.filter((l) => l.scene.beam).map((l) => [l.scene.beam.map, l.id])),
    karten: REG.karten,
    npc: [...npc],
  };
}
function hops(LOC, a, b) {
  if (a === b) return 0;
  const seen = new Set([a]); let front = [a]; let d = 0;
  while (front.length) { d++; const next = []; for (const x of front) for (const y of (LOC[x] ? LOC[x].links : [])) { if (y === b) return d; if (!seen.has(y)) { seen.add(y); next.push(y); } } front = next; }
  return -1;
}
function umsetzungOf(env, m) {
  const mol = env.katalog.molekuele[m && m.id];
  return mol ? mol.umsetzungen.find((x) => x.id === m.umsetzung) || null : null;
}

// ---------- S2b: Besetzung, Stimmen, Belohnung, Fakten ----------
const NEU_DEFAULT = 'neu:Unbekannte Stimme';
const isNeu = (v) => typeof v === 'string' && /^neu:/.test(v);
const neuName = (v) => String(v).slice(4).trim() || 'Unbekannt';
const neuId = (name) => ('neu_' + slug(name, 30)).slice(0, 34);
// Besetzung der Mission: Auftraggeber, Grobplan-Feld `besetzung`, `stimme` jeder Szene, NSC der Erinnerung, NSC aus den
// Folgen der Ausgänge und NSC, die der Grobplan beim Namen nennt (Titel, Aufhänger, Sachverhalte, Entscheidungen).
// env (optional): bekannte NSC-Kennungen für die Namenssuche.
function missionCast(g, env) {
  const named = new Set(); const neu = new Set();
  const add = (v) => { if (typeof v !== 'string' || !v.trim()) return; if (isNeu(v)) neu.add(neuName(v)); else named.add(v.trim()); };
  if (g) {
    add(g.auftraggeber);
    for (const v of Array.isArray(g.besetzung) ? g.besetzung : []) add(v);
    for (const s of Array.isArray(g.szenen) ? g.szenen : []) add(s && s.stimme);
    if (isObj(g.erinnerung) && typeof g.erinnerung.npc === 'string') add(g.erinnerung.npc);
    for (const a of Object.values(isObj(g.ausgaenge) ? g.ausgaenge : {})) for (const f of (isObj(a) && Array.isArray(a.folgen) ? a.folgen : [])) { const p = parseFolge(f); if (p && p.npc) add(p.npc); }
    const known = (env && env.npc) || [];
    if (known.length) {
      const txt = grobplanTexts(g).map((x) => x.text).join(' \n ');
      for (const id of known) if (new RegExp(`\\b${id.replace(/[^a-z0-9_]/gi, '')}\\b`, 'i').test(txt)) add(id);
    }
  }
  return { named, neu };
}
// Funk-Sprecher einer Szene. role 'gegenueber' (Parameter `npc`: Gegner/Gegenüber) bekommt ohne stimme eine neue Stimme –
// der Auftraggeber droht der Crew nie (Fall „Grauzahn droht in seiner eigenen Mission“).
function sceneVoice(g, s, role) {
  const st = s && typeof s.stimme === 'string' && s.stimme.trim() ? s.stimme.trim() : null;
  if (st) return st;
  if (role === 'gegenueber') return NEU_DEFAULT;
  return (g && g.auftraggeber) || 'tesk';
}
// Belohnung nur als lesbares Feld (§4.5): Marken-Folgen („schiff_marken +80“) entfernen, Betrag übernehmen,
// doppelte `weiter` derselben Szene zusammenfassen. Verändert g, liefert die Reparaturen.
const NO_WENDUNG = /^\s*(null|none|keine?( wendung)?|nein|-|–|—)?\s*\.?\s*$/i;
const hasWendung = (s) => !!(s && s.wendung && !(typeof s.wendung === 'string' && NO_WENDUNG.test(s.wendung)));
const MARKS_FOLGE =/^(?:schiff_)?(?:marken|marks|belohnung|lohn|reward)\b[^0-9+\-]*([+\-]?\s*\d+)/i;
const REWARD_TEXT = /(?:biete\w*|zahl\w*|versprech\w*|verspricht|lohn\w*|belohnung|prämie|honorar|gibt es)[^.!?:;]{0,40}?(\d{2,4})\s*marken|(\d{2,4})\s*marken[^.!?:;]{0,25}?(?:lohn|belohnung|prämie|honorar|für (?:euch|die crew|eure|den auftrag|nachricht|die rettung))/gi;
const META_FAKTEN = new Set(['tutorial']);   // Weltstand-Fakten über das Spiel, nicht über die Welt (keine Erinnerung)
function normalizeGrobplan(g) {
  const repairs = [];
  if (!isObj(g)) return repairs;
  const found = [];
  for (const [aid, a] of Object.entries(isObj(g.ausgaenge) ? g.ausgaenge : {})) {
    if (!isObj(a) || !Array.isArray(a.folgen)) continue;
    const keep = [];
    for (const f of a.folgen) {
      const m = typeof f === 'string' ? MARKS_FOLGE.exec(f.trim()) : null;
      if (m) { const n = Number(m[1].replace(/\s/g, '')); if (n > 0) found.push(n); repairs.push(`Ausgang '${aid}': Folge „${shortText(f, 40)}“ entfernt – Belohnung nur als belohnung_marken`); continue; }
      keep.push(f);
    }
    a.folgen = keep;
  }
  if (g.belohnung_marken != null && !Number.isFinite(Number(g.belohnung_marken))) { repairs.push(`belohnung_marken „${g.belohnung_marken}“ ist keine Zahl – entfernt`); delete g.belohnung_marken; }
  if (g.belohnung_marken != null) g.belohnung_marken = Math.max(0, Math.min(600, Math.round(Number(g.belohnung_marken))));
  if (g.belohnung_marken == null) {
    const inText = [...new Set(rewardAmounts(g))];
    const pick = inText.length === 1 ? inText[0] : (found.length ? Math.max(...found) : null);
    if (pick != null) { g.belohnung_marken = Math.max(0, Math.min(600, pick)); repairs.push(`belohnung_marken = ${g.belohnung_marken} (aus ${inText.length === 1 ? 'dem Text' : 'den Folgen'} übernommen)`); }
  }
  for (const k of ['aufhaenger', 'erinnerung_text', 'titel']) { const u = unquote(g[k]); if (u !== g[k]) { g[k] = u; repairs.push(`${k}: äußere Anführungszeichen entfernt`); } }
  // QA S2b (Live „ohne Tutorial“): Der Meta-Fakt `tutorial` ist keine Erinnerung – neutrale Variante statt „ihr habt das
  // Tutorial übersprungen“ im Angebot. Ein Text, der das Tutorial/Überspringen erwähnt, fällt weg.
  if (isObj(g.erinnerung) && META_FAKTEN.has(g.erinnerung.fakt)) { repairs.push(`erinnerung: Meta-Fakt '${g.erinnerung.fakt}' → neutral`); g.erinnerung = { neutral: true }; }
  if (typeof g.erinnerung_text === 'string' && /tutorial|übersprung|uebersprung/i.test(g.erinnerung_text)) { repairs.push('erinnerung_text erwähnt das Tutorial – entfernt'); delete g.erinnerung_text; }
  for (const s of Array.isArray(g.szenen) ? g.szenen : []) {
    if (!isObj(s)) continue;
    // Live S2b: Sonnet schreibt „keine Wendung“ gern als Text "null" – das ist keine Wendung
    if (typeof s.wendung === 'string' && NO_WENDUNG.test(s.wendung)) { s.wendung = null; repairs.push(`Szene '${s.id}': wendung „null“ als keine Wendung gelesen`); }
    if (!Array.isArray(s.weiter)) continue;
    const seen = new Set(); const w2 = [];
    for (const w of s.weiter) { const n = w && String(w.nach || ''); if (seen.has(n)) continue; seen.add(n); w2.push(w); }
    if (w2.length < s.weiter.length) { repairs.push(`Szene '${s.id}': doppelte Folgeszene in 'weiter' zusammengefasst`); s.weiter = w2; }
  }
  return repairs;
}
// Texte des Grobplans, die die Crew sieht oder die Szenen prägen (ohne Folgen-Kurzform)
function grobplanTexts(g) {
  const out = [];
  const push = (where, t) => { if (typeof t === 'string' && t.trim()) out.push({ where, text: t }); };
  push('titel', g.titel); push('aufhaenger', g.aufhaenger); push('erinnerung_text', g.erinnerung_text);
  for (const s of Array.isArray(g.szenen) ? g.szenen : []) { push(`Szene '${s.id}'`, s.sachverhalt); push(`Szene '${s.id}' (Wendung)`, s.wendung); }
  for (const e of Array.isArray(g.entscheidungen) ? g.entscheidungen : []) { push('Entscheidung', e.frage); for (const o of e.optionen || []) { push('Entscheidung', o.text); push('Entscheidung', o.folge); } }
  return out;
}
function rewardAmounts(g) {
  const r = [];
  for (const { text } of grobplanTexts(g)) for (const m of text.matchAll(REWARD_TEXT)) r.push(Number(m[1] || m[2]));
  return r;
}
function rewardContradictions(g) {
  const want = Number(g && g.belohnung_marken);
  if (!Number.isFinite(want)) return [];
  const E = [];
  for (const { where, text } of grobplanTexts(g)) for (const m of text.matchAll(REWARD_TEXT)) {
    const n = Number(m[1] || m[2]);
    if (n !== want) E.push(`BELOHNUNG-WIDERSPRUCH ${where}: „${shortText(m[0], 60)}“ nennt ${n} Marken, belohnung_marken ist ${want} – Betrag nur in belohnung_marken, im Text weglassen oder angleichen`);
  }
  return E;
}
// Wo liegt ein Gegenstand laut Weltstand? (Fall „Datenkern an Bord“, obwohl beim Konkordat)
const HOLDERS = {
  lerche: /\ban bord\b|\bim laderaum\b|\bbei euch\b|\bauf der lerche\b|\bihr (?:habt|tragt|transportiert|bringt|fliegt mit|habt noch)\b|\beur(?:en|em)? (?:fracht|laderaum)\b/i,
  konkordat: /\bkonkordat|\barchiv\b|\bmelk\b|\bhafenmeister|\bim hafen\b/i,
};
const FACT_ITEMS = [
  { key: /datenkern/, re: /datenkern/i, was: 'der Datenkern' },
  { key: /tafel/, re: /\btafel\b/i, was: 'die Tafel' },
];
function holderOf(v) {
  const s = String(v == null ? '' : v).toLowerCase();
  if (/lerche|bord|crew/.test(s)) return 'lerche';
  if (/konkordat|archiv|melk|hafen/.test(s)) return 'konkordat';
  return null;
}
// texte: [{ where, text }] | [Text]; fakten: { key: value } -> [Fehlertext]
function factContradictions(texte, fakten) {
  const E = [];
  const list = (texte || []).map((x) => (typeof x === 'string' ? { where: 'Text', text: x } : x)).filter((x) => x && typeof x.text === 'string');
  for (const [key, value] of Object.entries(isObj(fakten) ? fakten : {})) {
    const item = FACT_ITEMS.find((i) => i.key.test(key));
    const holder = holderOf(value);
    if (!item || !holder) continue;
    for (const { where, text } of list) {
      for (const seg of text.split(/[.:;!?…\n]+/)) {
        if (!item.re.test(seg)) continue;
        const claims = Object.keys(HOLDERS).filter((h) => HOLDERS[h].test(seg));
        if (claims.length && !claims.includes(holder)) E.push(`ERINNERUNG-WIDERSPRUCH ${where}: „${shortText(seg, 70)}“ – laut Weltstand ${item.was}: ${key} = ${value}`);
      }
    }
  }
  return [...new Set(E)];
}
// Prüfregel SPRECHER: alle Funk-Sprecher der Schritte sind Besetzung der Mission (oder neue Stimmen dieses Buchs)
function speakerErrors(steps, cast, stimmen) {
  const E = [];
  const st = stimmen || {};
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isObj(n)) return;
    for (const r of [n.radio, n.ankuendigung && n.ankuendigung.radio]) {
      if (!isObj(r) || typeof r.from !== 'string') continue;
      const f = r.from;
      if (isNeu(f) || /^neu_/.test(f) || st[f] || cast.named.has(f) || /^\{\{|^[a-z0-9_]+_person$/.test(f)) continue;
      E.push(`SPRECHER: '${f}' funkt, gehört aber nicht zur Besetzung der Mission (${[...cast.named].join(', ') || '–'}${cast.neu.size ? ', neu: ' + [...cast.neu].join(', ') : ''}) – Fremd-NSC durch eine Stimme der Besetzung ersetzen`);
    }
    for (const v of Object.values(n)) walk(v);
  };
  walk(steps);
  return [...new Set(E)];
}
// Prüfregel GEGNER-AUFTRAGGEBER (Fall „Grauzahn droht als Gegner, obwohl Auftraggeber“): in Kampf-Umsetzungen funkt der
// Anführer der Angreifer (Parameter `npc`) – das ist nie der Auftraggeber der Mission.
const HOSTILE_MOLS = new Set(['vertreiben', 'vernichten']);
function hostileVoiceErrors(g, s, answer) {
  const E = [];
  const auf = g && g.auftraggeber;
  if (!auf || !s) return E;
  (s.molekuele || []).forEach((m, i) => {
    if (!HOSTILE_MOLS.has(m.id)) return;
    const am = answer ? ((answer.molekuele || [])[i] || {}) : null;
    const v = am ? (am.params || {}).npc : s.stimme;
    if (v === auf) E.push(`GEGNER-AUFTRAGGEBER Szene '${s.id}': ${m.id}/${m.umsetzung} – der Auftraggeber '${auf}' funkt als Anführer der Angreifer; Gegner bekommen eine eigene Stimme (neu:Name)`);
  });
  return E;
}
// Typografische Anführungszeichen um einen ganzen Text entfernen (das Spiel setzt selbst welche: „„…““)
function unquote(t) {
  if (typeof t !== 'string') return t;
  const m = /^\s*[„"“'‚](.*)[“"”'‘]\s*$/s.exec(t);
  return m && !/[„“"]/.test(m[1]) ? m[1].trim() : t;
}
function unquoteDeep(n, count) {
  if (Array.isArray(n)) return n.map((x) => unquoteDeep(x, count));
  if (isObj(n)) { const o = {}; for (const [k, v] of Object.entries(n)) o[k] = unquoteDeep(v, count); return o; }
  if (typeof n === 'string') { const u = unquote(n); if (u !== n) count.n++; return u; }
  return n;
}

// Texte einer Szenen-Antwort (für den Fakten-Abgleich)
function answerTexts(a) {
  const out = [];
  const walk = (n, k) => {
    if (typeof n === 'string') { if (n.length > 8 && !/^[a-z0-9_:]+$/.test(n)) out.push({ where: `Szene (${k || 'Text'})`, text: n }); return; }
    if (Array.isArray(n)) return n.forEach((x) => walk(x, k));
    if (isObj(n)) for (const [kk, v] of Object.entries(n)) walk(v, kk);
  };
  walk(a, null);
  return out;
}

// ---------- S2b: einfache Szenenfehler reparieren (§4.3) ----------
// Verzweigung ohne Einträge / mit fehlenden Zielen, Ziele, die der Grobplan nicht kennt, Flag ohne setzende Folge ->
// Standardweg; doppelte weiter-Ziele. Die Antwort wird nicht verändert (Kopie). -> { answer, repairs }
// Flags, die das Buch außerhalb einer Szene setzt: setFlag aller (anderen) Antworten + liefert_flags aller Umsetzungen
// answers: { sid: answerObj | { answer } }
function planFlags(g, answers, env) {
  const out = new Set();
  for (const [, x] of Object.entries(answers || {})) {
    const a = x && x.answer ? x.answer : x;
    for (const m of JSON.stringify((a && a.molekuele) || []).match(/"setFlag":\{[^}]*\}/g) || []) { try { for (const k of Object.keys(JSON.parse(m.slice(10)))) out.add(k); } catch (e) { /* kein reines Objekt */ } }
  }
  for (const s of (g && g.szenen) || []) (s.molekuele || []).forEach((m, i) => {
    const u = umsetzungOf(env, m);
    const id = (s.molekuele || []).length > 1 ? `${s.id}_${i + 1}` : s.id;
    if (u && Array.isArray(u.liefert_flags)) for (const f of Katalog.expand(u.liefert_flags, { id })) if (typeof f === 'string') out.add(f);
  });
  return out;
}
function repairSceneAnswer(g, s, answer, env, opts) {
  const a = clone(isObj(answer) ? answer : {});
  const repairs = [];
  if (!Array.isArray(a.molekuele)) { a.molekuele = []; }
  // Moleküle: id/umsetzung aus dem Grobplan, wenn die Antwort sie weglässt (Reihenfolge wie im Plan)
  const soll = s.molekuele || [];
  if (a.molekuele.length === soll.length) a.molekuele.forEach((m, i) => {
    if (!isObj(m)) return;
    if (!m.id && soll[i]) { m.id = soll[i].id; repairs.push(`Molekül ${i + 1}: id ergänzt`); }
    if (!m.umsetzung && soll[i]) { m.umsetzung = soll[i].umsetzung; repairs.push(`Molekül ${i + 1}: umsetzung ergänzt`); }
    if (!isObj(m.params)) m.params = {};
  });
  // setFlag in falscher Form {"name": "s3_x"} -> {"s3_x": true}
  const fixFlags = (n) => {
    if (Array.isArray(n)) return n.forEach(fixFlags);
    if (!isObj(n)) return;
    if (isObj(n.setFlag)) {
      const e = Object.entries(n.setFlag);
      if (e.length === 1 && typeof e[0][1] === 'string' && /^[a-z][a-z0-9_]{1,40}$/.test(e[0][1])) { n.setFlag = { [e[0][1]]: true }; repairs.push(`setFlag {"${e[0][0]}": "${e[0][1]}"} → {"${e[0][1]}": true}`); }
    }
    for (const v of Object.values(n)) fixFlags(v);
  };
  fixFlags(a.molekuele);
  // Anführungszeichen um ganze Texte, Lohn der Lieferung (die Mission zahlt belohnung_marken am Ende – sonst doppelt)
  const qn = { n: 0 };
  a.molekuele = unquoteDeep(a.molekuele, qn);
  if (isObj(a.wendung)) a.wendung = unquoteDeep(a.wendung, qn);
  if (qn.n) repairs.push(`${qn.n} Text(e) ohne äußere Anführungszeichen`);
  a.molekuele.forEach((m) => {
    const u = isObj(m) ? umsetzungOf(env, m) : null;
    if (u && u.params.lohn && u.params.lohn.typ === 'zahl' && isObj(m.params) && m.params.lohn !== 0) { m.params.lohn = 0; repairs.push(`${m.id}/${m.umsetzung}: lohn 0 (Belohnung nur als belohnung_marken am Missionsende)`); }
  });
  if (a.wendung && !isObj(a.wendung)) { a.wendung = null; repairs.push('wendung kein Objekt – entfernt'); }
  if (isObj(a.wendung)) {
    const at = Number(a.wendung.nach_s);
    if (!(at >= 20 && at <= 120)) { a.wendung.nach_s = Math.max(20, Math.min(120, Number.isFinite(at) ? Math.round(at) : 40)); repairs.push(`Wendung: nach_s ${a.wendung.nach_s}`); }
    if (!a.wendung.kennung) { a.wendung.kennung = 'wendung'; repairs.push('Wendung: kennung ergänzt'); }
    if (!Array.isArray(a.wendung.wirkung) || !a.wendung.wirkung.length) {
      if (a.wendung.ankuendigung) { a.wendung.wirkung = [{ log: shortText(a.wendung.ankuendigung, 120) }]; repairs.push('Wendung: leere wirkung durch Logeintrag ersetzt'); }
    }
  }
  // Verzweigung
  const targets = [...new Set((s.weiter || []).map((w) => String(w.nach || '')).filter(Boolean))];
  if (targets.length <= 1) {
    if (Array.isArray(a.verzweigung) && a.verzweigung.length) repairs.push('Verzweigung entfernt (Szene hat nur ein Ziel)');
    a.verzweigung = [];
    return { answer: a, repairs };
  }
  const flagsSet = new Set((opts && opts.knownFlags) || []);
  for (const x of JSON.stringify(a.molekuele).match(/"setFlag":\{[^}]*\}/g) || []) { try { for (const k of Object.keys(JSON.parse(x.slice(10)))) flagsSet.add(k); } catch (e) { /* kein reines Objekt */ } }
  a.molekuele.forEach((m, i) => {
    const u = isObj(m) ? umsetzungOf(env, m) : null;
    const id = a.molekuele.length > 1 ? `${s.id}_${i + 1}` : s.id;
    if (u && Array.isArray(u.liefert_flags)) for (const f of Katalog.expand(u.liefert_flags, { id })) if (typeof f === 'string') flagsSet.add(f);
  });
  const never = { v: `${slug(s.id.split('_')[0], 12)}_alt` };
  let z = (Array.isArray(a.verzweigung) ? a.verzweigung : []).filter((x) => isObj(x) && x.nach);
  const before = z.length;
  z = z.filter((x) => targets.includes(x.nach));
  if (z.length < before) repairs.push(`Verzweigung: ${before - z.length} Ziel(e) außerhalb des Grobplans entfernt`);
  // je Ziel nur der erste Eintrag
  const seenT = new Set(); z = z.filter((x) => (seenT.has(x.nach) ? false : (seenT.add(x.nach), true)));
  // Flag ohne setzende Folge -> Eintrag nie wahr (Standardweg)
  for (const x of z) {
    const fl = (JSON.stringify(x.if || {}).match(/"flag":"([^"]+)"/g) || []).map((y) => y.slice(8, -1));
    const missing = fl.filter((f) => !flagsSet.has(f));
    if (missing.length) { repairs.push(`Verzweigung nach '${x.nach}': Flag ${missing.join(', ')} setzt keine Folge → Standardweg`); x.if = never; }
  }
  // fehlende Ziele ergänzen; das letzte Ziel des Grobplans ist der Standardweg, wenn kein Eintrag ohne Bedingung existiert
  for (const t of targets) if (!z.some((x) => x.nach === t)) { z.push({ nach: t, if: never }); repairs.push(`Verzweigung: Ziel '${t}' ergänzt (Standardweg bzw. nie gewählt)`); }
  // Standardweg = Eintrag ohne Bedingung, sonst ein ersetzter (never) Eintrag, sonst das letzte Ziel des Grobplans
  let defIdx = z.findIndex((x) => !x.if);
  if (defIdx < 0) defIdx = z.findIndex((x) => x.if === never);
  if (defIdx < 0) defIdx = z.findIndex((x) => x.nach === targets[targets.length - 1]);
  if (defIdx >= 0 && defIdx !== z.length - 1) { const [d] = z.splice(defIdx, 1); z.push(d); repairs.push(`Verzweigung: Standardweg '${d.nach}' ans Ende gestellt`); }
  const last = z[z.length - 1];
  if (last && last.if === never) delete last.if;
  a.verzweigung = z;
  return { answer: a, repairs };
}

// ---------- Grobplan-Prüfung (aus trockenversuch/grobplan.js → pruefe; unverändert, Replay-Erwartungen hängen daran) ----------
function checkGrobplan(g, env) {
  const KAT = env.katalog; const LOC = env.LOC; const NPC = env.npc;
  const E = [];
  for (const k of ['format', 'id', 'titel', 'auftraggeber', 'zielspieldauer_min', 'aufhaenger', 'erinnerung', 'szenen', 'entscheidungen', 'ausgaenge']) if (!(k in g)) E.push(`Feld '${k}' fehlt`);
  if (!Array.isArray(g.szenen)) return E;
  if (!NPC.includes(g.auftraggeber)) E.push(`Auftraggeber '${g.auftraggeber}' unbekannt`);
  if (g.szenen.length < 3 || g.szenen.length > 6) E.push(`${g.szenen.length} Szenen (erlaubt 3–6)`);
  const ids = new Set(g.szenen.map((s) => s.id)); const aus = new Set(Object.keys(g.ausgaenge || {}));
  const s0 = g.szenen[0];
  if (s0 && (s0.szenentyp !== 'hafen' || s0.ort !== 'hafen')) E.push('Erste Szene ist nicht Szenentyp hafen am Ort hafen');
  let summe = 0; const seen = new Set([s0 && s0.id]); const vorher = new Set();
  for (const s of g.szenen) {
    const p = `Szene '${s.id}'`;
    const st = KAT.szenentypen[s.szenentyp];
    if (!st) E.push(`${p}: Szenentyp '${s.szenentyp}' nicht registriert`);
    else if (st.status !== 'verfuegbar') E.push(`${p}: Szenentyp '${s.szenentyp}' ist noch nicht spielbar`);
    if (!LOC[s.ort]) E.push(`${p}: Ort '${s.ort}' gibt es nicht`);
    if (s.karte && !env.karten[s.karte]) E.push(`${p}: Außenkarte '${s.karte}' gibt es nicht`);
    if (s.karte && env.MAP_OF_LOC[s.karte] !== s.ort) E.push(`${p}: Außenkarte '${s.karte}' gehört zu Ort '${env.MAP_OF_LOC[s.karte]}', nicht zu '${s.ort}'`);
    const mols = s.molekuele || [];
    if (st && (mols.length < st.molekuele_plaetze.min || mols.length > st.molekuele_plaetze.max)) E.push(`${p}: ${mols.length} Moleküle, Szenentyp erlaubt ${st.molekuele_plaetze.min}–${st.molekuele_plaetze.max}`);
    for (const m of mols) {
      const mol = KAT.molekuele[m.id];
      if (!mol) { E.push(`${p}: Molekül '${m.id}' nicht registriert`); continue; }
      const u = mol.umsetzungen.find((x) => x.id === m.umsetzung);
      if (!u) { E.push(`${p}: Molekül '${m.id}' hat keine Umsetzung '${m.umsetzung}'`); continue; }
      if (u.status !== 'verfuegbar') E.push(`${p}: Umsetzung '${m.id}/${m.umsetzung}' ist noch nicht spielbar`);
      if (st && !mol.szenentypen.includes(st.kennung) && st.id !== 'hafen') E.push(`${p}: Molekül '${m.id}' passt nicht zu Szenentyp ${st.kennung} ${st.name}`);
      if (st && u.schauplatz !== st.bereich && st.id !== 'hafen') E.push(`${p}: Umsetzung '${m.umsetzung}' spielt '${u.schauplatz}', Szenentyp ist '${st.bereich}'`);
      if (u.params.loc && u.params.loc.werte && !u.params.loc.werte.includes(s.ort)) E.push(`${p}: Umsetzung '${m.umsetzung}' gibt es nur an ${u.params.loc.werte.join(', ')}`);
      if (u.params.map && u.params.map.werte && !u.params.map.werte.includes(s.karte)) E.push(`${p}: Umsetzung '${m.umsetzung}' braucht Karte ${u.params.map.werte.join(', ')}`);
      for (const n of u.nach || []) if (!vorher.has(n)) E.push(`${p}: Umsetzung '${m.umsetzung}' setzt '${n}' in einer früheren Szene voraus`);
      vorher.add(`${m.id}/${m.umsetzung}`);
    }
    summe += Number(s.dauer_min) || 0;
    for (const w of s.weiter || []) {
      const n = String(w.nach || '');
      if (n.startsWith('ausgang:')) { if (!aus.has(n.slice(8))) E.push(`${p}: Ausgang '${n.slice(8)}' fehlt`); } else if (!ids.has(n)) E.push(`${p}: Folgeszene '${n}' gibt es nicht`); else seen.add(n);
    }
    if (!(s.weiter || []).length) E.push(`${p}: kein 'weiter'`);
  }
  for (const s of g.szenen) if (!seen.has(s.id)) E.push(`Szene '${s.id}' ist nicht erreichbar`);
  const byId = Object.fromEntries(g.szenen.map((s) => [s.id, s]));
  let sprungMin = 0;
  for (const s of g.szenen) for (const [i, w] of (s.weiter || []).entries()) {
    const t = byId[w.nach]; if (!t || !LOC[s.ort] || !LOC[t.ort]) continue;
    const h = hops(LOC, s.ort, t.ort);
    if (h < 0) E.push(`Route '${s.id}' (${s.ort}) → '${t.id}' (${t.ort}): keine Verbindung`);
    else if (i === 0) sprungMin += h * 0.5;
  }
  const z = Number(g.zielspieldauer_min) || 0; const gesamt = summe + sprungMin;
  if (z && (gesamt < z * 0.75 || gesamt > z * 1.25)) E.push(`Dauer ${gesamt} min (Szenen ${summe} + Sprünge ${sprungMin}) passt nicht zu Ziel ${z} min (±25 %)`);
  const reachedOut = new Set(g.szenen.flatMap((s) => (s.weiter || []).map((w) => String(w.nach || '')).filter((n) => n.startsWith('ausgang:')).map((n) => n.slice(8))));
  for (const k of Object.keys(g.ausgaenge || {})) if (!reachedOut.has(k)) E.push(`Ausgang '${k}' wird von keiner Szene erreicht`);
  for (const m of JSON.stringify(g).matchAll(/npc_(?:haltung|gedaechtnis):? ([a-z_]+)/g)) if (!NPC.includes(m[1])) E.push(`Folge für unbekannten NSC '${m[1]}' (neue NSC nur als neu:<name>, Folgen als welt_fakt)`);
  for (const e of g.entscheidungen || []) {
    if (!ids.has(e.szene)) E.push(`Entscheidung in unbekannter Szene '${e.szene}'`);
    if (!Array.isArray(e.optionen) || e.optionen.length < 2) E.push(`Entscheidung '${e.frage}' hat weniger als 2 Optionen`);
    const folgen = new Set((e.optionen || []).map((o) => (o.folge || '').trim()));
    if (folgen.size < (e.optionen || []).length) E.push(`Entscheidung '${e.frage}': Optionen mit gleicher Folge (Scheinwahl)`);
  }
  const na = Object.keys(g.ausgaenge || {}).length;
  if (na < 2 || na > 3) E.push(`${na} Ausgänge (erlaubt 2–3)`);
  for (const [k, a] of Object.entries(g.ausgaenge || {})) if (!(a.folgen || []).length) E.push(`Ausgang '${k}' ohne Folgen`);
  return [...new Set(E)];
}

// ---------- Folgen (Kurzform des Grobplans) -> Aktionen ----------
// "npc_haltung grauzahn -1" · "npc_gedaechtnis melk: Text" · "chronik: Text" · "welt_fakt key: Text" ·
// "welt_fakt key (faden): Text" · "npc_status ivo vermisst"; Objekte { do: … } bzw. Kurzform { chronik: … } bleiben.
// -> { art, action?, npc?, key?, text?, faden? } | null
function parseFolge(f) {
  if (isObj(f)) {
    const a = Loader.normalizeFolge(f);
    if (!a || !a.do) return null;
    return { art: a.do, action: a, npc: a.npc, key: a.key, text: a.text, faden: !!a.faden };
  }
  if (typeof f !== 'string') return null;
  const s = f.trim();
  let m;
  if ((m = /^npc_haltung:?\s+([a-z_]+)\s*:?\s*([+\-−]?\s*\d+)/.exec(s))) {
    const d = Math.max(-2, Math.min(2, Number(m[2].replace('−', '-').replace(/\s/g, '')) || 0));
    return { art: 'npc_haltung', npc: m[1], delta: d };
  }
  if ((m = /^npc_gedaechtnis:?\s+([a-z_]+)\s*:?\s*(.*)$/.exec(s))) return { art: 'npc_gedaechtnis', npc: m[1], text: m[2].trim() };
  if ((m = /^chronik:?\s*(.*)$/.exec(s))) return { art: 'chronik', text: m[1].trim() };
  if ((m = /^welt_fakt:?\s+([A-Za-z0-9_]+)\s*(\(faden\))?\s*:?\s*(.*)$/.exec(s))) return { art: 'welt_fakt', key: m[1], faden: !!m[2] || /\bfaden\b/i.test(m[3].slice(0, 12)), text: m[3].trim() };
  if ((m = /^npc_status:?\s+([a-z_]+)\s+([a-z_]+)/.exec(s))) return { art: 'npc_status', npc: m[1], status: m[2] };
  return { art: 'unbekannt', text: s };
}

// Dauer einer Umsetzung (min) für die Crewgröße: dauer_je_crew (KATALOG, gemessen/geschätzt) sonst dauer_min (Mittel)
function umsetzungDauer(u, crew) {
  const je = u && u.dauer_je_crew;
  const r = je && (je[String(crew)] || je[String(Math.max(1, Math.min(3, crew || 3)))]);
  const span = Array.isArray(r) && r.length === 2 ? r : (u && u.dauer_min) || [0, 0];
  return (Number(span[0]) + Number(span[1])) / 2;
}

// ---------- S2-Regeln (CONTRACT-S2 §2.1) ----------
// opts: { origin: 'sl'|'archiv'|'mock', minMinutes (10), maxThreads (1), crew }
const TUTORIAL_TERMS = [
  { re: /tafel von kesh|\btafel\b/i, fakt: 'tafel', was: 'die Tafel von Kesh' },
  { re: /\bivo\b/i, fakt: 'ivo', was: 'Techniker Ivo' },
  { re: /stumme boje|datenkern/i, fakt: 'b7', was: 'die Boje B-7 / den Datenkern' },
  { re: /nachhut/i, fakt: 'nachhut', was: 'die Nachhut aus m1' },
];
function checkGrobplanS2(g, env, kontext, opts) {
  const o = Object.assign({ origin: 'sl', minMinutes: 10, maxThreads: 1 }, opts || {});
  const k = kontext || {};
  const errors = []; const warnings = [];
  if (!g || !Array.isArray(g.szenen)) return { errors: ['Grobplan ohne Szenen'], warnings };
  // 1. Erinnerung: Bezug auf vorhandenen Gedächtnis-Eintrag oder Fakt
  const er = g.erinnerung;
  const fakten = isObj(k.fakten) ? k.fakten : {};
  const erErr = (() => {
    if (!isObj(er)) return "'erinnerung' muss { npc, ereignis } (Gedächtnis-Eintrag) oder { fakt } (Fakt aus dem Weltstand) sein";
    // QA S2b: neutral nur, wenn es nichts zu erinnern gibt (kein Gedächtnis-Eintrag, kein Fakt außer Meta-Fakten)
    const usable = Object.keys(fakten).filter((f) => !META_FAKTEN.has(f)).length + (k.npc || []).reduce((n, x) => n + (x.gedaechtnis || []).length, 0);
    if (er.neutral === true) return usable ? `Erinnerung: neutral nur ohne Gedächtnis-Einträge und Fakten – es gibt ${usable}, bitte einen davon nutzen` : null;
    if (META_FAKTEN.has(er.fakt)) return `Erinnerung: '${er.fakt}' ist ein Meta-Fakt, keine Erinnerung – ${usable ? 'Gedächtnis-Eintrag oder Fakt nutzen' : '{ "neutral": true } verwenden'}`;
    if (typeof er.fakt === 'string') return er.fakt in fakten ? null :`Erinnerung: Fakt '${er.fakt}' gibt es im Weltstand nicht (vorhanden: ${Object.keys(fakten).join(', ') || '–'})`;
    if (typeof er.npc === 'string' && typeof er.ereignis === 'string') {
      const n = (k.npc || []).find((x) => x.id === er.npc);
      if (!n) return `Erinnerung: NSC '${er.npc}' gibt es nicht`;
      if (!(n.gedaechtnis || []).some((x) => x.ereignis === er.ereignis)) return `Erinnerung: '${er.npc}' hat keinen Gedächtnis-Eintrag '${er.ereignis}' (vorhanden: ${(n.gedaechtnis || []).map((x) => x.ereignis).join(', ') || '–'})`;
      return null;
    }
    return "'erinnerung' braucht { npc, ereignis } oder { fakt }";
  })();
  if (erErr) (o.origin === 'sl' ? errors : warnings).push(erErr);
  // 2. keine gefundenen Funde als Ziel
  const found = new Set((k.orte || []).flatMap((l) => (l.funde || []).filter((f) => f.status === 'gefunden').map((f) => f.id)));
  for (const s of g.szenen) for (const f of [].concat(s.fund || [], s.ziel_fund || [])) if (found.has(f)) errors.push(`Szene '${s.id}': Fund '${f}' ist schon gefunden – kein Ziel mehr`);
  // 3. Dauer ≥ minMinutes (Warnung): Hauptweg (jeweils erstes 'weiter'), Umsetzungsdauern je Crew + Sprünge
  const byId = Object.fromEntries(g.szenen.map((s) => [s.id, s]));
  const crew = (k.crew && k.crew.anzahl) || o.crew || 3;
  let min = 0; let cur = g.szenen[0]; const visited = new Set();
  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id);
    const mols = cur.molekuele || [];
    min += mols.length ? mols.reduce((a, m) => a + umsetzungDauer(umsetzungOf(env, m), crew), 0) : Math.min(2, Number(cur.dauer_min) || 1);
    const nx = (cur.weiter || [])[0] && byId[cur.weiter[0].nach];
    if (nx && env.LOC[cur.ort] && env.LOC[nx.ort]) min += Math.max(0, hops(env.LOC, cur.ort, nx.ort)) * 0.5;
    cur = nx;
  }
  if (min < o.minMinutes) warnings.push(`Geschätzte Dauer ${Math.round(min * 10) / 10} min (Hauptweg, Crew ${crew}) unter ${o.minMinutes} min`);
  // 4. kein Tutorial-Bezug ohne passenden Fakt (Kampagne ohne Tutorial)
  if (k.tutorial === 'uebersprungen') {
    const txt = JSON.stringify([g.titel, g.aufhaenger, g.erinnerung_text, g.szenen.map((s) => s.sachverhalt), g.entscheidungen]);
    for (const t of TUTORIAL_TERMS) if (t.re.test(txt) && !Object.keys(fakten).some((f) => f.includes(t.fakt))) errors.push(`Tutorial-Bezug auf ${t.was}, aber das Tutorial wurde übersprungen und kein Fakt '${t.fakt}…' ist bekannt`);
  }
  // 5. höchstens maxThreads offene Fäden; 6. jeder Ausgang schreibt Gedächtnis + Chronik
  const threads = new Set();
  for (const [aid, a] of Object.entries(g.ausgaenge || {})) {
    const fs2 = (a.folgen || []).map(parseFolge).filter(Boolean);
    for (const f of fs2) if (f.art === 'welt_fakt' && f.faden) threads.add(f.key);
    if (!fs2.some((f) => f.art === 'npc_gedaechtnis')) errors.push(`Ausgang '${aid}' schreibt kein npc_gedaechtnis`);
    if (!fs2.some((f) => f.art === 'chronik')) errors.push(`Ausgang '${aid}' schreibt keine chronik`);
    for (const f of fs2) if (f.art === 'unbekannt') warnings.push(`Ausgang '${aid}': Folge „${shortText(f.text, 60)}“ nicht lesbar (wird ignoriert)`);
  }
  if (threads.size > o.maxThreads) errors.push(`${threads.size} offene Fäden (${[...threads].join(', ')}), erlaubt ${o.maxThreads}`);
  // 7. S2b: Stimmen/Besetzung nur bekannte NSC oder neu:Name
  const npcKnown = new Set(env.npc || []);
  for (const v of [...(Array.isArray(g.besetzung) ? g.besetzung : []), ...g.szenen.map((s) => s && s.stimme)]) {
    if (v == null || v === '' || isNeu(v)) continue;
    if (typeof v !== 'string' || !npcKnown.has(v)) errors.push(`SPRECHER: Stimme/Besetzung '${v}' ist kein bekannter NSC (neue Stimmen als neu:Name)`);
  }
  // 8. S2b: Belohnung im Text = belohnung_marken; Erinnerung/Texte gegen Fakten (ERINNERUNG-WIDERSPRUCH)
  const sev = o.origin === 'sl' ? errors : warnings;
  for (const s of g.szenen) sev.push(...hostileVoiceErrors(g, s, null));
  sev.push(...rewardContradictions(g));
  sev.push(...factContradictions(grobplanTexts(g), fakten));
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

// ---------- Szene zusammensetzen (aus trockenversuch/szene.js → baueSzene/pruefRegiebuch) ----------
// opts (nur buildBook): { entryOf(sid) -> Schritt-ID, book: true (umsetzung/liefert_flags/neu:-Stimmen/ODA kürzen),
//                         found: Set (gefundene Funde) }
function assembleScene(g, s, answer, env, opts) {
  const o = opts || {};
  const KAT = env.katalog;
  const a = JSON.parse(JSON.stringify(answer || {}));   // nie die Antwort selbst verändern (Fehler im Trockenversuch)
  const E = []; const steps = []; const texte = {}; const buehne = { orte: [] }; const besetzung = { npc: [] }; const on = {};
  const liefert = new Set();
  const mols = a.molekuele || [];
  if (mols.length !== (s.molekuele || []).length) E.push(`${mols.length} Moleküle statt ${(s.molekuele || []).length} wie im Grobplan`);
  const target = (n) => (n.startsWith('ausgang:') ? { complete: n.slice(8) } : { goto: o.entryOf ? o.entryOf(n) : n });
  const stimmen = {};
  const fixVoice = (v) => { const name = neuName(v); const kid = neuId(name); stimmen[kid] = { name: shortText(name, 40) }; return kid; };
  mols.forEach((m, i) => {
    const soll = s.molekuele[i] || {};
    if (m.id !== soll.id || m.umsetzung !== soll.umsetzung) E.push(`Molekül ${i + 1}: ${m.id}/${m.umsetzung} statt ${soll.id}/${soll.umsetzung}`);
    const mol = KAT.molekuele[m.id]; const u = mol && mol.umsetzungen.find((x) => x.id === m.umsetzung);
    if (!u) return;
    const id = mols.length > 1 ? `${s.id}_${i + 1}` : s.id;
    const weiter = i < mols.length - 1 ? `${s.id}_${i + 2}` : '__weiter__';
    if (o.found) for (const [pn, d] of Object.entries(u.params)) if (d.typ === 'find' && o.found.has((m.params || {})[pn])) E.push(`${m.id}/${m.umsetzung}: Fund '${m.params[pn]}' ist schon gefunden`);
    // S2b: NSC-Parameter mit neuer Stimme (neu:Name) -> Stimmen-Kennung des Buchs (auch in besetzung/spawn_escort)
    const params = Object.assign({}, m.params || {});
    if (o.book) for (const [pn, d] of Object.entries(u.params)) if (d.typ === 'npc' && isNeu(params[pn])) params[pn] = fixVoice(params[pn]);
    const { frag, errs } = Katalog.instantiate(u, params, id, weiter);
    if (o.book && frag.besetzung && Array.isArray(frag.besetzung.npc)) frag.besetzung.npc = frag.besetzung.npc.filter((n) => !stimmen[n]);
    E.push(...errs.map((e) => `${m.id}/${m.umsetzung}: ${e}`));
    const lf = Array.isArray(u.liefert_flags) ? Katalog.expand(u.liefert_flags, { id }).filter((x) => typeof x === 'string') : [];
    lf.forEach((f) => liefert.add(f));
    if (o.book) for (const st of frag.steps || []) {
      if (!st.umsetzung) st.umsetzung = `${m.id}/${m.umsetzung}`;
      if (lf.length && !st.liefert_flags) st.liefert_flags = lf.slice();
    }
    steps.push(...(frag.steps || [])); Object.assign(texte, frag.texte);
    for (const [k, v] of Object.entries(frag.buehne || {})) buehne[k] = Array.isArray(v) ? [...new Set([...(buehne[k] || []), ...v])] : Object.assign(buehne[k] || {}, v);
    for (const [k, v] of Object.entries(frag.besetzung || {})) besetzung[k] = Array.isArray(v) ? [...new Set([...(besetzung[k] || []), ...v])] : Object.assign(besetzung[k] || {}, v);
    for (const [ev, list] of Object.entries(frag.on || {})) on[ev] = (on[ev] || []).concat(list);
  });
  const w = a.wendung;
  if (hasWendung(s) && !w && !o.roh) E.push(`Der Grobplan sieht eine Wendung vor („${s.wendung}“), die Antwort hat keine`);
  if (w && steps[0]) {
    if (!w.kennung || !w.ankuendigung || !Array.isArray(w.wirkung) || !w.wirkung.length) E.push("Wendung braucht 'kennung', 'ankuendigung' und eine nicht leere 'wirkung'");
    const at = Number(w.nach_s);
    if (!(at >= 20 && at <= 120)) E.push(`Wendung: nach_s = ${w.nach_s}, erlaubt 20–120`);
    const erlaubt = ['setFlag', 'reward', 'radio', 'oda', 'log'];
    for (const x of w.wirkung || []) if (!(x.do === 'pay_marks' || (Object.keys(x).length === 1 && erlaubt.includes(Object.keys(x)[0])))) E.push(`Wendung: Aktion ${JSON.stringify(x)} ist nicht erlaubt`);
    (steps[0].timers = steps[0].timers || []).push({ at: at || 30, do: [{ wendung: `${s.id.split('_')[0]}_${w.kennung}`.slice(0, 40), ankuendigung: { oda: w.ankuendigung, art: 'gleichzeitig' }, wirkung: w.wirkung || [] }] });
  }
  let nr = 0;
  const fixRadio = (r) => {
    if (!o.book || !r || typeof r.from !== 'string' || !r.from.startsWith('neu:')) return;
    r.from = fixVoice(r.from);
  };
  const extract = (node) => {
    if (Array.isArray(node)) return node.forEach(extract);
    if (!node || typeof node !== 'object') return;
    for (const k of ['oda', 'log']) if (typeof node[k] === 'string' && !node[k].startsWith('@')) { const key = `${s.id}.t${++nr}`; texte[key] = o.book && k === 'oda' ? shortText(node[k], ODA_MAX) : node[k]; node[k] = '@' + key; }
    if (node.radio) fixRadio(node.radio);
    if (node.ankuendigung && node.ankuendigung.radio) fixRadio(node.ankuendigung.radio);
    if (node.radio && typeof node.radio.text === 'string' && !node.radio.text.startsWith('@')) { const key = `${s.id}.t${++nr}`; texte[key] = node.radio.text; node.radio.text = '@' + key; }
    for (const v of Object.values(node)) extract(v);
  };
  extract(steps);
  // S2b (Live-Befund ODA-LAENGE): ODA-Texte aus Parametern der Vorlage (oda: "@<id>.x") ebenfalls auf ODA_MAX kürzen
  if (o.book) {
    const odaKeys = new Set((JSON.stringify(steps).match(/"oda":"@[^"]+"/g) || []).map((m) => m.slice(8, -1)));
    const walkDir = (n) => { if (Array.isArray(n)) return n.forEach(walkDir); if (!isObj(n)) return; if (n.do === 'direction_hint' && typeof n.text === 'string' && n.text[0] === '@') odaKeys.add(n.text.slice(1)); for (const v of Object.values(n)) walkDir(v); };
    walkDir(steps);
    for (const k of odaKeys) if (typeof texte[k] === 'string' && texte[k].length > ODA_MAX) texte[k] = shortText(texte[k], ODA_MAX);
  }
  if (Object.keys(stimmen).length) besetzung.stimmen = Object.assign(besetzung.stimmen || {}, stimmen);
  for (const x of JSON.stringify(steps).match(/"radio":{"from":"([^"]+)"/g) || []) { const n = x.slice(17, -1); if (!stimmen[n] && !besetzung.npc.includes(n)) besetzung.npc.push(n); }
  for (const x of JSON.stringify(steps).match(/"setFlag":\{[^}]*\}/g) || []) for (const [k, v] of Object.entries(JSON.parse(x.slice(10)))) if (typeof v === 'string' || k === 'name') E.push(`setFlag {"${k}": ${JSON.stringify(v)}}: der Schlüssel ist der Flag-Name, der Wert true – richtig wäre {"${typeof v === 'string' ? v : k}": true}`);
  const soll = o.book ? [...new Set((s.weiter || []).map((x) => x.nach))] : (s.weiter || []).map((x) => x.nach);
  let zweige = (a.verzweigung || []).filter((z) => z && z.nach);
  if (soll.length === 1) zweige = [{ nach: soll[0] }];
  else {
    if (zweige.length < 2) E.push(`Szene verzweigt im Grobplan nach ${soll.join(', ')}, aber 'verzweigung' hat ${zweige.length} Einträge`);
    for (const z of zweige) if (!soll.includes(z.nach)) E.push(`Verzweigung nach '${z.nach}', im Grobplan nicht vorgesehen`);
    for (const n of soll) if (!zweige.some((z) => z.nach === n)) E.push(`Verzweigung: Ziel '${n}' aus dem Grobplan wird nie erreicht`);
    const gesetzt = new Set(JSON.stringify(mols).match(/"setFlag":\{[^}]*\}/g) || []);
    const gesetzteFlags = new Set([...gesetzt].flatMap((x) => Object.keys(JSON.parse(x.slice(10)))));
    for (const f of liefert) gesetzteFlags.add(f);
    for (const f of o.knownFlags || []) gesetzteFlags.add(f);   // S2b: Flags früherer/anderer Szenen desselben Buchs
    for (const z of zweige) for (const f of (JSON.stringify(z.if || {}).match(/"flag":"([^"]+)"/g) || []).map((x) => x.slice(8, -1))) if (!gesetzteFlags.has(f)) E.push(`Verzweigung prüft Flag '${f}', das keine Folge setzt`);
  }
  for (const st of steps) {
    if (!st.next) continue;
    st.next = st.next.flatMap((n) => {
      if (n.goto !== '__weiter__') return [n];
      const { goto, ...rest } = n;
      return zweige.map((z, i) => Object.assign({}, rest, { if: i < zweige.length - 1 && z.if ? { all: [n.if, z.if] } : n.if }, target(z.nach)));
    });
  }
  return { steps, texte, buehne, besetzung, on, liefert: [...liefert], fehler: E };
}

// Testbuch um eine Szene (Replay-Prüfung, aus dem Trockenversuch)
function sceneTestBook(g, s, sz) {
  const vorher = { id: 'start', objectives: [], next: [{ if: true, goto: sz.steps[0] ? sz.steps[0].id : s.id }], skip: [] };
  const ziele = [...new Set(s.weiter.map((w) => w.nach))];
  const platzhalter = ziele.filter((n) => !n.startsWith('ausgang:')).map((n) => ({ id: n, objectives: [], next: [{ if: true, complete: 'platzhalter' }], skip: [] }));
  const ausgaenge = { platzhalter: { beschreibung: 'Rest der Mission (noch nicht ausgearbeitet)', folgen: [{ chronik: '@test.text' }] } };
  for (const n of ziele.filter((x) => x.startsWith('ausgang:'))) ausgaenge[n.slice(8)] = { beschreibung: (g.ausgaenge[n.slice(8)] || {}).wann || n, folgen: [{ chronik: '@test.text' }] };
  return {
    format: 'regiebuch/1', id: `${g.id}_${s.id}`.slice(0, 40),
    kopf: { titel: g.titel.slice(0, 60), art: 'mission', auftraggeber: g.auftraggeber, zielspieldauer_min: g.zielspieldauer_min },
    buch: { von: [{ npc: g.auftraggeber }], briefing: '@test.text', belohnung: '@test.text' },
    buehne: Object.assign({}, sz.buehne, { orte: [...new Set(['hafen', ...(sz.buehne.orte || [])])] }),
    besetzung: Object.assign({}, sz.besetzung, { npc: [...new Set([g.auftraggeber, ...(sz.besetzung.npc || [])])] }),
    steps: [vorher, ...sz.steps, ...platzhalter], on: {}, ausgaenge,
    texte: Object.assign({ 'test.text': 'Platzhalter' }, sz.texte),
  };
}
function parseJsonAnswer(text) {
  const a = String(text).indexOf('{'); const b = String(text).lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('kein JSON-Objekt in der Antwort');
  const raw = String(text).slice(a, b + 1);
  try { return JSON.parse(raw); } catch (e) {
    // QA-Abnahme S2 (Live): Sonnet schließt deutsche Anführungszeichen gern mit ASCII-" („…") – das bricht das JSON.
    // Einmal reparieren (nur „ … " ohne weiteres Anführungszeichen dazwischen), sonst den ursprünglichen Fehler werfen.
    const fixed = raw.replace(/„([^"“”„\n]{0,400}?)"/g, '„$1“');
    if (fixed === raw) throw e;
    try { return JSON.parse(fixed); } catch (e2) { throw e; }
  }
}
function checkBook(book) {
  const r = Checker.check(book) || {};
  return { errors: r.errors || [], warnings: r.warnings || [] };
}
// Szene aus Antworttext -> { gueltig, fehler: Codes (sortiert, eindeutig), details }
function evaluateScene(g, sid, text, env) {
  const s = (g.szenen || []).find((x) => x.id === sid);
  if (!s) return { gueltig: false, fehler: ['SZENE-UNBEKANNT'], details: [`Szene '${sid}' fehlt im Grobplan`] };
  let a;
  try { a = parseJsonAnswer(text); } catch (e) { return { gueltig: false, fehler: ['JSON'], details: [e.message] }; }
  const sz = assembleScene(g, s, a, env);
  const r = checkBook(sceneTestBook(g, s, sz));
  const codes = [...new Set([...sz.fehler.map(() => 'SZENE'), ...r.errors.map((e) => e.code)])].sort();
  return { gueltig: !codes.length, fehler: codes, details: [...sz.fehler, ...r.errors.map((e) => `${e.code} ${e.p}: ${e.msg}`)] };
}
function evaluateGrobplan(text, env) {
  let g;
  try { g = parseJsonAnswer(text); } catch (e) { return { gueltig: false, fehler: ['kein gültiges JSON: ' + e.message] }; }
  const f = checkGrobplan(g, env);
  return { gueltig: !f.length, fehler: f };
}

// ---------- Rohfassung einer Szene ----------
// Parameter: Testwerte der Umsetzung, überlagert von rueckfall.params (KATALOG); loc/map aus dem Grobplan.
// Verzweigung (Standard): Aktionsliste setzt eine Flag -> erster Zweig; sonst liefert_flags[0]; sonst Laufzeitwert v
// (wird in der Rohfassung nie gesetzt -> immer der letzte, also der Standardweg).
// S2b plan-treu: alle NSC-Parameter aus dem Grobplan (stimme der Szene; ohne stimme der Auftraggeber bzw. für das Gegenüber
// `npc` eine neue Stimme), Funk-Absender in Aktionslisten ebenso; Namen aus ziel_name, Schiffsklasse aus schiff/ziel_name.
const SHIP_KINDS = ['frachter', 'karawane', 'bergungsboot'];
const NAME_PARAMS = ['name', 'fund_name', 'objekt_name', 'was'];
function shipKindOf(s) {
  if (typeof s.schiff === 'string' && SHIP_KINDS.includes(s.schiff)) return s.schiff;
  const t = String(s.ziel_name || '').toLowerCase();
  return SHIP_KINDS.find((k) => t.includes(k)) || null;
}
function rohAnswer(g, s, env) {
  const flag = `${slug(s.id.split('_')[0], 12)}_roh`;
  let branchIf = null;
  const cast = missionCast(g, env);
  const molekuele = (s.molekuele || []).map((m, i) => {
    const u = umsetzungOf(env, m);
    if (!u) return { id: m.id, umsetzung: m.umsetzung, params: {} };
    const params = Object.assign({}, clone((u.test && u.test.params) || {}), clone((u.rueckfall && u.rueckfall.params) || {}));
    if (u.params.loc) params.loc = s.ort;
    if (u.params.map && s.karte) params.map = s.karte;
    for (const [pn, d] of Object.entries(u.params)) if (d.typ === 'npc') params[pn] = sceneVoice(g, s, pn === 'npc' ? 'gegenueber' : 'verbuendet');
    if (HOSTILE_MOLS.has(m.id) && params.npc === g.auftraggeber) params.npc = NEU_DEFAULT;   // Auftraggeber nie als Angreifer
    const own = sceneVoice(g, s, 'verbuendet');
    const fixFrom = (n) => {
      if (Array.isArray(n)) return n.forEach(fixFrom);
      if (!isObj(n)) return;
      if (isObj(n.radio) && typeof n.radio.from === 'string' && !isNeu(n.radio.from) && !cast.named.has(n.radio.from)) n.radio.from = own;
      for (const v of Object.values(n)) fixFrom(v);
    };
    for (const [pn, d] of Object.entries(u.params)) if (d.typ === 'aktionen' && Array.isArray(params[pn])) fixFrom(params[pn]);
    if (typeof s.ziel_name === 'string' && s.ziel_name.trim()) {
      for (const pn of NAME_PARAMS) if (u.params[pn] && u.params[pn].typ === 'text') params[pn] = shortText(s.ziel_name, pn === 'name' ? 24 : 60);
    }
    if (u.params.lohn && u.params.lohn.typ === 'zahl') params.lohn = 0;   // Lohn nur am Missionsende (belohnung_marken)
    const kind = shipKindOf(s);
    if (kind && u.params.kind && (!u.params.kind.werte || u.params.kind.werte.includes(kind))) params.kind = kind;
    if (kind && !(typeof s.ziel_name === 'string' && s.ziel_name.trim()) && u.params.name && u.params.name.typ === 'text') params.name = kind === 'frachter' ? 'Frachter' : kind === 'karawane' ? 'Karawane' : 'Bergungsboot';
    if (new Set((s.weiter || []).map((w) => w.nach)).size > 1 && !branchIf) {
      const n = Object.keys(u.params).find((p) => u.params[p].typ === 'aktionen' && Array.isArray(params[p]));
      const id = (s.molekuele || []).length > 1 ? `${s.id}_${i + 1}` : s.id;
      if (n) { params[n] = params[n].concat([{ setFlag: { [flag]: true } }]); branchIf = { flag }; }
      else if (Array.isArray(u.liefert_flags) && u.liefert_flags.length) branchIf = { flag: Katalog.expand(u.liefert_flags[0], { id }) };
    }
    return { id: m.id, umsetzung: m.umsetzung, params };
  });
  const weiter = [...new Set((s.weiter || []).map((w) => w.nach))];
  const cond = branchIf || { v: flag };
  const verzweigung = weiter.length > 1 ? weiter.map((n, i) => (i === 0 ? { nach: n, if: cond } : { nach: n })) : [];
  return { molekuele, verzweigung, wendung: null };
}

// ---------- Zuordnung Schritt <-> Szene ----------
function sceneOfStep(g, stepId) {
  if (!g || !Array.isArray(g.szenen) || typeof stepId !== 'string') return null;
  let best = null;
  for (const s of g.szenen) if ((stepId === s.id || stepId.startsWith(s.id + '_')) && (!best || s.id.length > best.length)) best = s.id;
  return best;
}
// Vorgänger je Szene (aus 'weiter')
function predecessors(g) {
  const pre = {};
  for (const s of g.szenen) for (const w of s.weiter || []) { const n = String(w.nach || ''); if (!n.startsWith('ausgang:')) (pre[n] = pre[n] || []).push(s); }
  return pre;
}
// Braucht die Szene einen Anflug-Schritt? (Ort weicht von einem Vorgänger ab)
function needsApproach(g, s, pre) {
  if (s === g.szenen[0]) return false;
  const ps = (pre || predecessors(g))[s.id] || [];
  return !ps.length || ps.some((p) => p.ort !== s.ort);
}

// ---------- vollständiges Regiebuch ----------
// answers: { sid: { answer, quelle } } (fehlende Szenen -> Rohfassung)
// opts: { id, art: 'generiert'|'archiv', kontext, marks, erinnerungText, crew, checker? }
// -> { book, errors: [{code,p,msg}|Text], warnings, szenen: { sid: { quelle, fehler: [] } } }
function buildBook(g, answers, env, opts) {
  const o = Object.assign({ art: 'generiert' }, opts || {});
  const ans = answers || {};
  const result = { book: null, errors: [], warnings: [], szenen: {} };
  const pre = predecessors(g);
  const found = new Set(((o.kontext && o.kontext.orte) || []).flatMap((l) => (l.funde || []).filter((f) => f.status === 'gefunden').map((f) => f.id)));
  const hasCheck = (() => { try { const R = require('./registry.js'); return !!(R.get && R.get('szene_bereit')); } catch (e) { return false; } })();
  const npcLabel = (id) => { try { return Loader.npcName(id); } catch (e) { return id; } };
  const LOCNAME = (id) => (env.LOC[id] && env.LOC[id].name) || id;
  const firstStep = {};      // sid -> erster Schritt der Szene (ohne Anflug)
  const entry = {};          // sid -> Einstieg (Anflug oder erster Schritt)
  const s0 = g.szenen[0];
  const texte = {}; const steps = []; const buehne = { orte: ['hafen'], aussenkarten: [] }; const besetzung = { npc: [g.auftraggeber] };
  const on = {};
  // tief vereinigen: Listen als Menge, Objekte je Schlüssel (buehne.objekte.platform aus mehreren Szenen!)
  const deep = (a, b) => {
    if (Array.isArray(b)) return [...new Set([...(Array.isArray(a) ? a : []), ...b])];
    if (isObj(b)) { const o = isObj(a) ? Object.assign({}, a) : {}; for (const [k, v] of Object.entries(b)) o[k] = deep(o[k], v); return o; }
    return b;
  };
  const merge = (frag) => {
    Object.assign(texte, frag.texte);
    for (const [k, v] of Object.entries(frag.buehne || {})) buehne[k] = deep(buehne[k], v);
    for (const [k, v] of Object.entries(frag.besetzung || {})) besetzung[k] = deep(besetzung[k], v);
    for (const [ev, list] of Object.entries(frag.on || {})) on[ev] = (on[ev] || []).concat(list);
  };
  // Einstiege vorab (Ziele für goto)
  for (const s of g.szenen) {
    const hafenMols = s === s0 && (s.molekuele || []).length;
    firstStep[s.id] = s === s0 ? s.id : ((s.molekuele || []).length > 1 ? `${s.id}_1` : s.id);
    if (hafenMols) firstStep[`${s.id}_x`] = (s.molekuele.length > 1 ? `${s.id}_x_1` : `${s.id}_x`);
    entry[s.id] = needsApproach(g, s, pre) ? `${s.id}_anflug` : firstStep[s.id];
  }
  const entryOf = (sid) => entry[sid] || sid;
  const cast = missionCast(g, env);
  const bookFlags = planFlags(g, ans, env);
  const sceneUmsetzung =(s) => { const m = (s.molekuele || [])[0]; return m ? `${m.id}/${m.umsetzung}` : undefined; };

  // Szene bauen: Antwort -> sonst Rohfassung
  const buildScene = (s, sidForIds) => {
    const sc = Object.assign({}, s, { id: sidForIds || s.id });
    const given = ans[s.id];
    let quelle = given ? (given.quelle || 'llm') : 'rohfassung';
    const fehler = [];
    let sz = null;
    if (given && given.answer) {
      sz = assembleScene(g, sc, given.answer, env, { entryOf, book: true, found, knownFlags: bookFlags });
      // S2b Prüfregel SPRECHER (nur für Spielleiter-Antworten; Archiv-Szenen sind von Hand geprüft)
      if (!sz.fehler.length && quelle !== 'archiv') sz.fehler.push(...speakerErrors(sz.steps, cast, sz.besetzung.stimmen), ...hostileVoiceErrors(g, s, given.answer));
      if (sz.fehler.length) { fehler.push(...sz.fehler); sz = null; }
    }
    if (!sz) {
      if (given) quelle = 'rohfassung';
      sz = assembleScene(g, sc, rohAnswer(g, sc, env), env, { entryOf, book: true, found, roh: true });
      if (sz.fehler.length) fehler.push(...sz.fehler.map((x) => 'Rohfassung: ' + x));
      for (const e of speakerErrors(sz.steps, cast, sz.besetzung.stimmen)) result.warnings.push(`Rohfassung '${s.id}': ${e}`);
    }
    result.szenen[s.id] = { quelle, fehler };
    return sz;
  };

  // 1. Hafen-Rahmen: Briefing-Funk (annehmen oder 12 s warten), optional Moleküle der Hafenszene
  const after0 = (s0.weiter || []).map((w) => w.nach);
  const hafenNext = (s0.molekuele || []).length ? firstStep[`${s0.id}_x`] : null;
  // Ziele ohne eigene Bedingung: alle außer dem letzten an einen Laufzeitwert v gebunden, der nie gesetzt wird ->
  // der letzte Eintrag ist der Standardweg (der Prüfer sieht trotzdem alle Kanten)
  const toTargets = (list, base, alt) => list.map((n, i) => Object.assign(
    { if: i < list.length - 1 ? { all: [base, { v: alt }] } : base },
    n.startsWith('ausgang:') ? { complete: n.slice(8) } : { goto: entryOf(n) }));
  const accepted = { any: [{ event: 'accepted' }, { elapsed: 12 }] };
  texte[`${s0.id}.funk`] = shortText(g.aufhaenger || g.titel, 380);
  texte[`${s0.id}.ziel`] = 'Auftrag annehmen (Funk) – oder kurz warten';
  texte[`${s0.id}.hinweis`] = 'Der Auftrag läuft. Captain: Funk annehmen – sonst geht es gleich von allein los.';
  const hafenStep = {
    id: s0.id,
    umsetzung: sceneUmsetzung(s0) || sceneUmsetzung(g.szenen.find((x) => (x.molekuele || []).length) || {}),
    enter: [{ radio: { from: g.auftraggeber, text: `@${s0.id}.funk`, accept: true } }],
    onAccept: [{ set: { briefed: true } }],
    timers: [{ at: 6, if: { not: { event: 'accepted' } }, oda: `@${s0.id}.hinweis`, garantie: 'hinweis' }],
    objectives: [{ id: 'auftrag', text: `@${s0.id}.ziel`, done: accepted }],
    next: (hafenNext ? [{ if: accepted, goto: hafenNext }] : toTargets(after0, accepted, 'hafen_alt')).map((n) => Object.assign(n, { garantie: 'autoloesung' })),
    skip: [{ do: 'debug_accept' }],
  };
  if (!hafenStep.umsetzung) delete hafenStep.umsetzung;
  steps.push(hafenStep);
  if (hafenNext) {
    const sz = buildScene(s0, `${s0.id}_x`);
    merge(sz); steps.push(...sz.steps);
  }

  // 2. weitere Szenen: Anflug + Umsetzungen (bzw. Zwischenszene ohne Moleküle)
  for (const s of g.szenen.slice(1)) {
    const um = sceneUmsetzung(s);
    if (entry[s.id] !== firstStep[s.id]) {
      texte[`${s.id}.anflug_ziel`] = shortText(`Nach ${LOCNAME(s.ort)} springen`, 60);
      texte[`${s.id}.anflug_tipp`] = shortText(`Kurs liegt an: ${LOCNAME(s.ort)}. Steuer: Ziel wählen, F für den Faltsprung.`, ODA_MAX);
      const cond = hasCheck ? { all: [{ atLocation: s.ort }, { check: { name: 'szene_bereit', szene: s.id } }] } : { atLocation: s.ort };
      const st = {
        id: `${s.id}_anflug`,
        objectives: [{ id: 'sprung', text: `@${s.id}.anflug_ziel`, done: { atLocation: s.ort } }],
        timers: [{ at: 90, if: { not: { atLocation: s.ort } }, oda: `@${s.id}.anflug_tipp`, garantie: 'hinweis' }],
        next: [{ if: cond, goto: firstStep[s.id] }],
        skip: [{ do: 'debug_jump', loc: s.ort }],
      };
      if (um) st.umsetzung = um;
      steps.push(st);
    }
    if ((s.molekuele || []).length) {
      const sz = buildScene(s);
      merge(sz); steps.push(...sz.steps);
    } else {
      texte[`${s.id}.lage`] = shortText(s.sachverhalt || g.titel, ODA_MAX);
      const targets = (s.weiter || []).map((w) => w.nach);
      const st = { id: s.id, loc: s.ort, timers: [{ at: 1, oda: `@${s.id}.lage` }], objectives: [],
        next: toTargets(targets, { elapsed: 6 }, `${slug(s.id, 12)}_alt`), skip: [] };
      if (um) st.umsetzung = um;
      steps.push(st);
      result.szenen[s.id] = { quelle: 'rohfassung', fehler: [] };
    }
    buehne.orte = [...new Set([...buehne.orte, s.ort])];
    if (s.karte) buehne.aussenkarten = [...new Set([...buehne.aussenkarten, s.karte])];
  }
  if (!buehne.aussenkarten.length) delete buehne.aussenkarten;
  // S2b (Live-Befund, QA-INTEGRATION): Umsetzungen mit Spieleffekten beim Betreten oder im Timer (Spawn: vertreiben,
  // notruf_verteidigen, angriffswelle …) an Hafen-/Händlerorten sind speicherbar – beim Laden wiederholten sich die Effekte
  // (Prüfer: NEUSTART). Sauberes Muster statt der früheren Notlösung (Timer mit `docked: false`, die bei angedockter Lerche
  // ganz ausfiel): ein Wartepunkt „Ablegen“ am selben Ort vor dem Schritt, und der Schritt nimmt beim Laden dort wieder auf
  // (`wiederaufnahme.ab`). So beginnt der Kampf immer erst, wenn die Lerche abgelegt hat – auch nach dem Laden.
  const ports = new Set(Locations.LOCATIONS.filter((l) => l.kind === 'port' || l.kind === 'trader').map((l) => l.id));
  const effectDo = (() => { try { const R = require('./registry.js'); return (n) => { const d = R.get && R.get(n); return !!(d && d.effekt && !d.intern); }; } catch (e) { return () => false; } })();
  const hasRestartEffect = (st) => {
    const js = JSON.stringify([st.enter || [], st.timers || []]);
    if (/"(?:spawn|spawnSalvage)":/.test(js)) return true;
    return (js.match(/"do":"(\w+)"/g) || []).some((m) => effectDo(m.slice(6, -1)));
  };
  const retarget = (node, from, to) => {
    if (Array.isArray(node)) { node.forEach((x) => retarget(x, from, to)); return; }
    if (!isObj(node)) return;
    for (const [k, v] of Object.entries(node)) { if (k === 'goto' && v === from) node[k] = to; else retarget(v, from, to); }
  };
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    if (!st.loc || !ports.has(st.loc) || st.drill || st.wiederaufnahme || st === hafenStep || !hasRestartEffect(st)) continue;
    const gid = `${st.id}_ablegen`;
    texte[`${gid}.ziel`] = 'Ablegen – erst draußen geht es weiter';
    texte[`${gid}.tipp`] = 'Wir liegen noch an der Schleuse. Steuer: ablegen – der Auftrag wartet draußen.';
    const gate = { id: gid, loc: st.loc, objectives: [{ id: 'ablegen', text: `@${gid}.ziel`, done: { docked: false } }],
      timers: [{ at: 20, if: { docked: true }, do: [{ oda: `@${gid}.tipp` }], garantie: 'hinweis' }],
      next: [{ if: { any: [{ docked: false }, { v: `${gid}_skip` }] }, goto: st.id }], skip: [{ set: { [`${gid}_skip`]: true } }] };
    if (st.umsetzung) gate.umsetzung = st.umsetzung;
    if (st.szene) gate.szene = st.szene;
    for (const other of steps) if (other !== st) retarget(other, st.id, gid);
    st.wiederaufnahme = { ab: gid };
    steps.splice(i, 0, gate); i++;
    result.warnings.push(`Szene am Andock-Ort '${st.loc}': Schritt '${st.id}' bekommt den Wartepunkt '${gid}' (Ablegen) und wiederaufnahme`);
  }
  // Flags sind global und Szenen-IDs (s3_…) wiederholen sich zwischen erzeugten Missionen: alle Flags, die dieses Buch
  // selbst setzt oder die seine Umsetzungen liefern, beim Missionsstart zurücksetzen (nie die globalen Kampagnen-Flags)
  const own = new Set();
  for (const x of JSON.stringify(steps).match(/"setFlag":\{[^}]*\}/g) || []) { try { for (const k of Object.keys(JSON.parse(x.slice(10)))) own.add(k); } catch (e) { /* kein reines Objekt */ } }
  for (const st of steps) for (const f of st.liefert_flags || []) own.add(f);
  for (const k of GLOBAL_FLAGS) own.delete(k);
  if (own.size) hafenStep.enter.unshift({ setFlag: Object.fromEntries([...own].sort().map((k) => [k, null])) });

  // 3. Ausgänge: Folgen aus dem Grobplan, mindestens Gedächtnis + Chronik, Belohnung im besten Ausgang
  const ausgaenge = {};
  const aids = Object.keys(g.ausgaenge || {});
  const best = aids.includes('erfolg') ? 'erfolg' : aids[0];
  const marks = Math.max(0, Math.round(o.marks != null ? o.marks : 40 + 10 * (Number(g.zielspieldauer_min) || 12)));
  const npcKnown = new Set(env.npc);
  aids.forEach((aid) => {
    const a = g.ausgaenge[aid] || {};
    const folgen = []; let gn = 0;
    const add = (f) => {
      if (!f) return;
      const tk = () => `aus.${aid}.t${++gn}`;
      if (f.action) { folgen.push(f.action); return; }
      if (f.art === 'npc_haltung' && npcKnown.has(f.npc) && f.delta) folgen.push({ do: 'npc_haltung', npc: f.npc, delta: f.delta });
      else if (f.art === 'npc_gedaechtnis' && npcKnown.has(f.npc)) { const k = tk(); texte[k] = shortText(f.text || a.wann || g.titel, 200); folgen.push({ do: 'npc_gedaechtnis', npc: f.npc, ereignis: `${slug(g.id, 20)}_${aid}`, text: '@' + k }); }
      else if (f.art === 'chronik') { const k = tk(); texte[k] = shortText(f.text || `${g.titel}: ${a.wann || aid}`, 300); folgen.push({ do: 'chronik', text: '@' + k }); }
      else if (f.art === 'welt_fakt' && f.key) { const x = { do: 'welt_fakt', key: f.key, value: shortText(f.text || 'ja', 120), quelle: o.id || g.id }; if (f.faden) x.faden = true; folgen.push(x); }
      else if (f.art === 'npc_status' && npcKnown.has(f.npc)) folgen.push({ do: 'npc_status', npc: f.npc, status: f.status });
      else result.warnings.push(`Ausgang '${aid}': Folge ${JSON.stringify(f).slice(0, 80)} ignoriert`);
    };
    for (const f of a.folgen || []) {
      const p = parseFolge(f);
      if (p && p.art === 'npc_status' && !['lebt', 'vermisst', 'verletzt', 'tot', 'unbekannt'].includes(p.status)) { result.warnings.push(`Ausgang '${aid}': Status '${p.status}' unbekannt`); continue; }
      add(p);
    }
    if (!folgen.some((x) => x.do === 'npc_gedaechtnis')) add({ art: 'npc_gedaechtnis', npc: g.auftraggeber, text: `${g.titel}: ${a.wann || aid}.` });
    if (!folgen.some((x) => x.do === 'chronik')) add({ art: 'chronik', text: `${g.titel}: ${a.wann || aid}.` });
    // Belohnung (Studioleitung 2026-10-08): jeder Ausgang, der kein Scheitern ist, bekommt den vollen Lohn – wer anders
    // entscheidet (z. B. Zoll brechen und kämpfen statt zahlen), steht netto nicht schlechter da. Scheitern: halb, Abbruch: nichts.
    const fail = FAIL_RE.test(aid) || FAIL_RE.test(String(a.wann || '').slice(0, 40));
    const lohn = aid === best ? marks : (/abbruch|aufgegeben/i.test(aid) ? 0 : (fail ? Math.round(marks / 2) : marks));
    if (lohn > 0) folgen.unshift({ reward: { marks: lohn }, rewardNotice: true });
    for (const x of folgen) if (x.npc && npcKnown.has(x.npc)) besetzung.npc.push(x.npc);   // NSC aus den Folgen besetzen
    ausgaenge[aid] = { beschreibung: shortText(a.wann || aid, 200), folgen };
  });

  // 4. Rahmen
  const ziel = (g.szenen.find((s) => s.ort && s.ort !== 'hafen') || s0).ort;
  texte['buch.briefing'] = shortText(g.aufhaenger || g.titel, 400);
  texte['buch.belohnung'] = marks > 0 ? `${marks} Marken` : 'keine Marken – ein Gefallen';   // QA S2b: nie „0 Marken“
  const erText = o.erinnerungText || g.erinnerung_text || (typeof g.erinnerung === 'string' ? g.erinnerung : null);
  const buch = { von: [{ npc: g.auftraggeber }], briefing: '@buch.briefing', belohnung: '@buch.belohnung', ziel,
    dauer_min: Math.max(1, Math.min(120, Math.round(Number(g.zielspieldauer_min) || 15))) };
  if (erText) { texte['buch.erinnerung'] = shortText(erText, 300); buch.erinnerung = '@buch.erinnerung'; }
  besetzung.npc = [...new Set(besetzung.npc)].filter((n) => !(besetzung.stimmen && besetzung.stimmen[n]));
  const book = {
    format: 'regiebuch/1', id: o.id || `sl_${slug(g.id, 30)}`,
    kopf: { titel: shortText(g.titel || 'Auftrag', 60), art: o.art, auftraggeber: g.auftraggeber,
      zielspieldauer_min: Math.max(1, Math.min(120, Number(g.zielspieldauer_min) || 15)) },
    buch, buehne, besetzung, steps, on, ausgaenge, texte,
  };
  if (isObj(g.erinnerung) && ((typeof g.erinnerung.npc === 'string' && typeof g.erinnerung.ereignis === 'string') || typeof g.erinnerung.fakt === 'string')) {
    book.erinnerung = g.erinnerung.fakt ? { fakt: g.erinnerung.fakt } : { npc: g.erinnerung.npc, ereignis: g.erinnerung.ereignis };
  }
  if (o.kontext && o.kontext.crew && o.kontext.crew.anzahl) book.kopf.crew = { empfohlen: Math.max(1, Math.min(4, o.kontext.crew.anzahl)) };
  result.book = book;
  const r = (o.checker || checkBook)(book);
  result.errors = r.errors; result.warnings.push(...(r.warnings || []).map((w) => (typeof w === 'string' ? w : `${w.code} ${w.p}: ${w.msg}`)));
  return result;
}

// Prüferfehler des Buchs für die Nachbesserung des Grobplans lesbar machen (S2b): NEUSTART an Hafen-/Händlerorten heißt
// für den Spielleiter „diese Umsetzung nicht an diesem Ort“.
function explainBookErrors(g, errors, env) {
  return (errors || []).map((x) => {
    if (typeof x === 'string') return x;
    const m = /steps\[\d+:([^\]]+)\]/.exec(x.p || '');
    const sid = m ? sceneOfStep(g, m[1]) : null;
    const s = sid && (g.szenen || []).find((y) => y.id === sid);
    if (x.code === 'NEUSTART' && s && env && env.LOC[s.ort] && ['port', 'trader'].includes(env.LOC[s.ort].kind)) {
      return `Szene '${s.id}': ${(s.molekuele || []).map((mm) => mm.umsetzung).join('+')} kann nicht am Hafen-/Händlerort '${s.ort}' spielen (dort wird angedockt gespeichert) – Ort ohne Andocken wählen (${x.code})`;
    }
    return `${x.code} ${x.p}: ${x.msg}`;
  });
}

// Kurzfassung des Buchs fürs Angebot
function offerInfo(book, g) {
  const t = (k) => (book.texte && typeof book.buch[k] === 'string' && book.buch[k][0] === '@' ? book.texte[book.buch[k].slice(1)] : book.buch[k]) || null;
  return { titel: book.kopf.titel, von: book.kopf.auftraggeber, ziel: book.buch.ziel || null, dauer_min: book.buch.dauer_min || book.kopf.zielspieldauer_min,
    belohnung: t('belohnung'), erinnerung: t('erinnerung'), briefing: t('briefing'), grobplanId: g && g.id };
}

module.exports = {
  buildEnv, hops, checkGrobplan, checkGrobplanS2, parseFolge, umsetzungDauer, assembleScene, sceneTestBook, parseJsonAnswer,
  checkBook, evaluateScene, evaluateGrobplan, rohAnswer, sceneOfStep, predecessors, needsApproach, buildBook, offerInfo, slug, shortText,
  TUTORIAL_TERMS, ODA_MAX,
  // S2b
  missionCast, sceneVoice, normalizeGrobplan, repairSceneAnswer, planFlags, explainBookErrors, speakerErrors, factContradictions, rewardContradictions,
  grobplanTexts, answerTexts, umsetzungOf, NEU_DEFAULT,
};
