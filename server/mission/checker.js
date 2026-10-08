'use strict';
// S1 (CONTRACT-S1 §3.3): Prüfer für Regiebücher. Prüft ohne Ausführen:
//  1. Schema (Struktur, content/regiebuch/regiebuch.schema.json)
//  2. Referenzen gegen den Code: Orte (shared/locations.js), Außenkarten + Objekte/Bereiche (shared/maps.js, objects.js),
//     Zahlen aus shared/config.js, Bausteine mit Parametern (registry.js), NSC (content/npc.json), Texte
//  3. Ablauf: Schritte erreichbar, keine Sackgassen, jede Entscheidung mit Ausgang, Ausgänge vorhanden
//  4. Garantien: jeder Schritt mit Pflichtziel hat einen Hinweis/ein Zeitlimit
//  5. Fairness: Wendungen haben eine Ankündigung, Spieleffekte außerhalb von 'enter' sind Wendungen
//  6. Neustart: Schritte, in denen angedockt (= gespeichert) werden kann, wiederholen beim Laden keine Spieleffekte
//  7. Flags: Form (FLAG-FORM), gelesen aber nie gesetzt (FLAG-UNGESETZT), gesetzt aber nie gelesen (FLAG-UNGELESEN, Warnung)
//   Checker.check(book, ctx?)     -> { ok, errors: [{ code, p, msg }], warnings: [...] }
//   Checker.validate(obj, schema) -> [[pfad, meldung], …]   kleiner JSON-Schema-Prüfer ohne Abhängigkeiten
// ctx (optional): { registry, maps, locations, config, npc: Set|Array }
const fs = require('fs');
const path = require('path');
const Loader = require('./loader.js');

const ROOT = path.join(__dirname, '..', '..');
const SCHEMA_FILE = path.join(ROOT, 'content', 'regiebuch', 'regiebuch.schema.json');
let schemaCache = null;
function schema() { return schemaCache || (schemaCache = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'))); }

const TEXT_FIELDS_ACTION = ['oda', 'log'];
const ODA_MAX = 120;
const EFFECT_ATOMS = ['spawn', 'spawnSalvage'];   // Spieleffekte ohne Baustein (Atome von heute)
// Flags, die die Engine oder frühere Missionen setzen (CONTRACT-S1 §3.3)
const GLOBAL_FLAGS = ['selaCalled', 'vaelenHelped', 'technikerRescued', 'bribed', 'decision', 'm3Direct'];
const FLAG_KEY = /^[a-z][A-Za-z0-9_]*$/;
// Flags, deren Setzen durch Andocken einen Schritt speicherbar macht (Andocken bei Vaelen setzt vaelenHelped)
const DOCK_FLAGS = ['vaelenHelped'];
const PLANNED_FOLGEN = ['ruf', 'uhr'];
// S2: Flags, die die Schützlings-Umsetzung je Tag setzt (<tag>_heil, <tag>_beschaedigt, <tag>_verloren)
const SHIP_FLAG_SUFFIXES = ['_heil', '_beschaedigt', '_verloren'];

// ---------------------------------------------------------------------------------------------------------------
// Mini-Validator für JSON-Schema (nur die Teile, die die Schemas des Projekts benutzen)
function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}
function typeOk(v, t) {
  const ts = [].concat(t); const vt = typeOf(v);
  return ts.some((x) => x === vt || (x === 'number' && vt === 'integer'));
}
function resolveRef(ref, root) {
  if (!ref.startsWith('#/')) throw new Error('Nur lokale $ref: ' + ref);
  return ref.slice(2).split('/').reduce((o, k) => o[k], root);
}
// validate(v, s, p, out, root) wie tools/check-missions.js; Kurzform validate(obj, schema) -> Liste
function validate(v, s, p, out, root) {
  if (out === undefined) { const o = []; validate(v, s, '$', o, s); return o; }
  root = root || schema();
  if (s === true || s == null) return out;
  if (s === false) { out.push([p, 'nicht erlaubt']); return out; }
  if (s.$ref) return validate(v, resolveRef(s.$ref, root), p, out, root);
  if (s.type && !typeOk(v, s.type)) { out.push([p, `Typ ${typeOf(v)} statt ${[].concat(s.type).join('|')}`]); return out; }
  if ('const' in s && v !== s.const) out.push([p, `muss ${JSON.stringify(s.const)} sein`]);
  if (s.enum && !s.enum.includes(v)) out.push([p, `${JSON.stringify(v)} nicht in ${JSON.stringify(s.enum)}`]);
  if (typeof v === 'string') {
    if (s.maxLength != null && v.length > s.maxLength) out.push([p, `länger als ${s.maxLength} Zeichen`]);
    if (s.minLength != null && v.length < s.minLength) out.push([p, `kürzer als ${s.minLength} Zeichen`]);
    if (s.pattern && !new RegExp(s.pattern).test(v)) out.push([p, `passt nicht zu ${s.pattern}`]);
  }
  if (typeof v === 'number') {
    if (s.minimum != null && v < s.minimum) out.push([p, `kleiner als ${s.minimum}`]);
    if (s.maximum != null && v > s.maximum) out.push([p, `größer als ${s.maximum}`]);
  }
  if (Array.isArray(v)) {
    if (s.minItems != null && v.length < s.minItems) out.push([p, `weniger als ${s.minItems} Einträge`]);
    if (s.maxItems != null && v.length > s.maxItems) out.push([p, `mehr als ${s.maxItems} Einträge`]);
    if (s.items) v.forEach((x, i) => validate(x, s.items, `${p}[${i}]`, out, root));
  }
  if (typeOf(v) === 'object') {
    const keys = Object.keys(v);
    for (const r of s.required || []) if (!(r in v)) out.push([p, `Pflichtfeld '${r}' fehlt`]);
    if (s.minProperties != null && keys.length < s.minProperties) out.push([p, `weniger als ${s.minProperties} Felder`]);
    if (s.maxProperties != null && keys.length > s.maxProperties) out.push([p, `mehr als ${s.maxProperties} Felder`]);
    for (const [k, deps] of Object.entries(s.dependentRequired || {})) {
      if (k in v) for (const d of deps) if (!(d in v)) out.push([p, `'${k}' verlangt '${d}'`]);
    }
    for (const k of keys) {
      if (s.propertyNames) {
        if (s.propertyNames.enum && !s.propertyNames.enum.includes(k)) out.push([`${p}.${k}`, `unbekannter Schlüssel '${k}'`]);
        if (s.propertyNames.pattern && !new RegExp(s.propertyNames.pattern).test(k)) out.push([`${p}.${k}`, `Schlüssel passt nicht zu ${s.propertyNames.pattern}`]);
      }
      if (s.properties && k in s.properties) validate(v[k], s.properties[k], `${p}.${k}`, out, root);
      else if (s.additionalProperties === false) out.push([`${p}.${k}`, `unbekanntes Feld '${k}'`]);
      else if (typeof s.additionalProperties === 'object') validate(v[k], s.additionalProperties, `${p}.${k}`, out, root);
    }
  }
  if (s.oneOf) {
    const results = s.oneOf.map((alt) => { const o = []; validate(v, alt, p, o, root); return o; });
    const ok = results.filter((r) => !r.length).length;
    if (ok !== 1) {
      const best = results.filter((r) => r.length && !r.some(([, m]) => m.startsWith('Typ '))).sort((a, b) => a.length - b.length)[0];
      if (ok === 0 && best) out.push(...best);
      else out.push([p, ok === 0 ? 'passt zu keiner erlaubten Form' : 'mehrdeutig (passt zu mehreren Formen)']);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Hilfen zum Durchlaufen von Aktionen und Bedingungen
function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }

// cb(aktion, kontext) für jede Aktion, auch in 'wirkung' und 'after'
function eachAction(list, ctx, cb) {
  for (const a of [].concat(list || [])) {
    if (!isObj(a)) continue;
    cb(a, ctx);
    if (a.wirkung) eachAction(a.wirkung, Object.assign({}, ctx, { wendung: a.wendung || ctx.wendung, guarded: ctx.guarded || a.if !== undefined }), cb);
    if (isObj(a.after)) eachAction(a.after.do || [a.after], Object.assign({}, ctx, { guarded: ctx.guarded || a.if !== undefined }), cb);
  }
}
function stepActionLists(step) {
  const L = [];
  if (step.enter) L.push(['enter', step.enter]);
  (step.timers || []).forEach((t, i) => L.push([`timers[${i}]`, t.do || [t], t]));
  (step.rules || []).forEach((r, i) => L.push([`rules[${i}]`, r.do, r]));
  (step.next || []).forEach((n, i) => L.push([`next[${i}]`, (n.do || []).concat(n.goto ? [{ goto: n.goto }] : [], n.complete ? [{ complete: n.complete }] : []), n]));
  for (const [cid, c] of Object.entries(step.choices || {})) {
    for (const [oid, acts] of Object.entries(c.on || {})) L.push([`choices.${cid}.on.${oid}`, acts]);
    if (c.after) L.push([`choices.${cid}.after`, c.after]);
  }
  if (step.onAccept) L.push(['onAccept', step.onAccept]);
  for (const [ev, acts] of Object.entries(step.on || {})) L.push([`on.${ev}`, acts]);
  if (step.skip) L.push(['skip', step.skip]);
  if (step.wiederaufnahme && step.wiederaufnahme.prep) L.push(['wiederaufnahme.prep', step.wiederaufnahme.prep]);
  return L;
}
function eachAtom(c, p, cb) {
  if (c == null || typeof c === 'boolean') return;
  if (Array.isArray(c)) { c.forEach((x, i) => eachAtom(x, `${p}[${i}]`, cb)); return; }
  if (!isObj(c)) return;
  for (const [k, v] of Object.entries(c)) {
    if (k === 'all' || k === 'any') (v || []).forEach((x, i) => eachAtom(x, `${p}.${k}[${i}]`, cb));
    else if (k === 'not') eachAtom(v, `${p}.not`, cb);
    else cb(k, v, `${p}.${k}`);
  }
}
function stepConditions(step) {
  const C = [];
  const fromActions = (list, p) => eachAction(list, {}, (a) => { if (a.if !== undefined) C.push([`${p}.if`, a.if]); });
  for (const [p, list, holder] of stepActionLists(step)) {
    if (holder && holder.if !== undefined) C.push([`${p}.if`, holder.if]);
    fromActions(list, p);
  }
  (step.objectives || []).forEach((o, i) => { if (o.show !== undefined) C.push([`objectives[${i}].show`, o.show]); C.push([`objectives[${i}].done`, o.done]); });
  if (step.scan && step.scan.requires) C.push(['scan.requires', step.scan.requires]);
  (step.jumpBlock || []).forEach((b, i) => C.push([`jumpBlock[${i}].if`, b.if]));
  (step.destBlock || []).forEach((b, i) => C.push([`destBlock[${i}].if`, b.if]));
  for (const [cid, c] of Object.entries(step.choices || {})) (c.options || []).forEach((o, i) => { if (o.disabledIf) C.push([`choices.${cid}.options[${i}].disabledIf`, o.disabledIf]); });
  return C;
}
// Flags, die eine Bedingung liest
function flagsRead(c, out) {
  eachAtom(c, '', (k, v) => {
    if (k !== 'flag') return;
    if (typeof v === 'string') out.add(v);
    else if (isObj(v)) for (const f of Object.keys(v)) out.add(f);
  });
}

function defaultCtx() {
  return {
    registry: require('./registry.js'),
    maps: require('../../shared/maps.js'),
    locations: require('../../shared/locations.js'),
    config: require('../../shared/config.js'),
    objects: require('./objects.js'),
    npc: Loader.npcIds(),
  };
}

// ---------------------------------------------------------------------------------------------------------------
function check(doc, ctxIn) {
  const ctx = Object.assign(defaultCtx(), ctxIn || {});
  const Reg = ctx.registry; const Obj = ctx.objects; const L = ctx.locations;
  const LOC_IDS = new Set(L.LOCATIONS.map((l) => l.id));
  const PORT_IDS = new Set(L.LOCATIONS.filter((l) => l.kind === 'port' || l.kind === 'trader').map((l) => l.id));
  const HIDDEN_IDS = new Set(L.LOCATIONS.flatMap((l) => (l.hidden || []).map((h) => h.id)));
  const cfgValue = (ref) => Loader.cfgValue(ref, ctx.config);

  const errors = []; const warnings = [];
  const E = (code, p, msg) => errors.push({ code, p, msg });
  const W = (code, p, msg) => warnings.push({ code, p, msg });
  const done = () => ({ ok: !errors.length, errors, warnings });

  // 1. Schema
  for (const [p, m] of validate(doc, schema(), '$', [], schema())) E('SCHEMA', p, m);
  if (!isObj(doc) || !isObj(doc.texte)) return done();
  const kopf = doc.kopf || {};
  const art = kopf.art || 'mission';
  const isSide = art === 'nebenauftrag';
  const isIntern = art === 'intern';
  if (!isSide && !Array.isArray(doc.steps)) { E('SCHEMA', '$', "Pflichtfeld 'steps' fehlt (art mission/intern)"); return done(); }
  if (!isSide && !isObj(doc.ausgaenge)) E('SCHEMA', '$', "Pflichtfeld 'ausgaenge' fehlt (art mission/intern)");
  if (!Array.isArray(doc.steps)) doc = Object.assign({}, doc, { steps: [] });
  const sideOnly = ['sichtbar', 'erledigt', 'ort', 'ziele'].filter((k) => doc.buch && doc.buch[k] !== undefined);
  if (!isSide && sideOnly.length) E('SCHEMA', 'buch', `${sideOnly.join(', ')} nur bei kopf.art 'nebenauftrag'`);

  const buehne = doc.buehne || {}; const bes = doc.besetzung || {};
  const orte = new Set(buehne.orte || []);
  const karten = new Set(buehne.aussenkarten || []);
  const npcCast = new Set(bes.npc || []);
  const stimmen = new Set(Object.keys(bes.stimmen || {}));
  const NPC_IDS = new Set([...(ctx.npc || []), ...stimmen]);
  const gruppen = bes.gruppen || {}; const einheiten = bes.einheiten || {};
  const stepIds = new Map();
  doc.steps.forEach((s, i) => { if (stepIds.has(s.id)) E('ABLAUF-DOPPELT', `steps[${i}]`, `Schritt-ID '${s.id}' doppelt`); stepIds.set(s.id, i); });
  const ausgaenge = new Set(Object.keys(doc.ausgaenge || {}));

  // --- S2: Schiffe/Schützlinge (besetzung.schiffe: Tag -> { kind, name, npc? })
  const schiffe = isObj(bes.schiffe) ? bes.schiffe : {};
  const shipTags = new Set(Object.keys(schiffe));

  // --- Texte
  const usedTexts = new Set();
  const textRef = (val, p, maxLen) => {
    if (typeof val !== 'string') return;
    let resolved = val;
    if (val.startsWith('@')) {
      const k = val.slice(1); usedTexts.add(k);
      if (!(k in doc.texte)) { E('REF-TEXT', p, `Text '${val}' fehlt in 'texte'`); return; }
      resolved = doc.texte[k];
    } else W('TEXT-LITERAL', p, 'Literaltext statt Verweis (@kennung) – der Spielleiter kann ihn nicht austauschen');
    if (maxLen && typeof resolved === 'string' && resolved.length > maxLen) E('ODA-LAENGE', p, `ODA-Text hat ${resolved.length} Zeichen (höchstens ${maxLen})`);
  };

  // --- Bühne
  for (const o of orte) if (!LOC_IDS.has(o)) E('REF-ORT', 'buehne.orte', `Ort '${o}' gibt es nicht (shared/locations.js)`);
  for (const k of karten) if (!Obj.AWAY_LEGENDS[k]) E('REF-KARTE', 'buehne.aussenkarten', `Außenkarte '${k}' gibt es nicht (shared/maps.js)`);
  for (const [map, objs] of Object.entries(buehne.objekte || {})) for (const o of objs) {
    if (!Obj.declared(map)[o]) E('REF-OBJEKT', `buehne.objekte.${map}`, `Objekt '${o}' ist für Karte '${map}' nicht deklariert (MAP_OBJECTS)`);
  }
  for (const [map, areas] of Object.entries(buehne.bereiche || {})) for (const a of areas) {
    if (!Obj.areas(map)[a]) E('REF-BEREICH', `buehne.bereiche.${map}`, `Bereich '${a}' ist für Karte '${map}' nicht deklariert (MAP_AREAS)`);
  }
  for (const [name, g] of Object.entries(Object.assign({}, gruppen, einheiten))) {
    if (!isObj(g)) continue;
    const kinds = Obj.legendKinds(g.map);
    const regG = Obj.groups(g.map)[name] || Obj.units(g.map)[name];
    if (!regG) E('REF-GRUPPE', `besetzung.${name}`, `Gruppe/Einheit '${name}' ist für Karte '${g.map}' nicht deklariert`);
    else if (!kinds.has(regG.legend)) E('REF-KACHEL', `besetzung.${name}`, `Kachelart '${regG.legend}' fehlt in der Karte '${g.map}'`);
    if (g.anker && Obj.AWAY_LEGENDS[g.map] && !(g.anker in Obj.AWAY_LEGENDS[g.map])) E('REF-ANKER', `besetzung.${name}.anker`, `Zeichen '${g.anker}' fehlt in der Legende von '${g.map}'`);
    if (!karten.has(g.map)) E('REF-KARTE', `besetzung.${name}.map`, `Karte '${g.map}' fehlt in buehne.aussenkarten`);
  }
  for (const map of karten) {
    const kinds = Obj.legendKinds(map);
    for (const [o, def] of Object.entries(Obj.declared(map))) if (!kinds.has(def.legend)) W('REF-KACHEL', `karten.${map}.${o}`, `Kachelart '${def.legend}' fehlt in der Karte`);
  }

  // --- NSC
  const npcRef = (id, p) => {
    if (!NPC_IDS.has(id)) E('REF-NPC', p, `NSC '${id}' unbekannt (content/npc.json oder besetzung.stimmen)`);
    else if (!npcCast.has(id) && !stimmen.has(id)) W('NPC-BESETZUNG', p, `NSC '${id}' fehlt in besetzung.npc`);
  };
  npcRef(kopf.auftraggeber, 'kopf.auftraggeber');
  ((doc.buch || {}).von || []).forEach((v, i) => npcRef(v.npc, `buch.von[${i}]`));
  if (doc.buch) { textRef(doc.buch.briefing, 'buch.briefing'); textRef(doc.buch.belohnung, 'buch.belohnung'); }
  if (doc.angebot && doc.angebot.anbieter) npcRef(doc.angebot.anbieter, 'angebot.anbieter');
  if (doc.buch) { if (doc.buch.erinnerung !== undefined) textRef(doc.buch.erinnerung, 'buch.erinnerung'); if (doc.buch.ziel !== undefined && !LOC_IDS.has(doc.buch.ziel)) E('REF-ORT', 'buch.ziel', `Ort '${doc.buch.ziel}' gibt es nicht`); }
  if (isObj(doc.erinnerung) && doc.erinnerung.npc) npcRef(doc.erinnerung.npc, 'erinnerung.npc');
  for (const [tag, sh] of Object.entries(schiffe)) if (isObj(sh) && sh.npc) npcRef(sh.npc, `besetzung.schiffe.${tag}.npc`);

  // --- Flags
  const flagsSet = new Set(); const flagsReadSet = new Set();
  const flagForm = (obj, p, what) => {
    if (!isObj(obj)) { E('FLAG-FORM', p, `'${what}' muss ein Objekt { name: wert } sein`); return; }
    for (const [k, v] of Object.entries(obj)) {
      if (!FLAG_KEY.test(k)) E('FLAG-FORM', `${p}.${k}`, `Name '${k}' passt nicht zu ${FLAG_KEY}`);
      if (!(v === null || ['boolean', 'string', 'number'].includes(typeof v))) E('FLAG-FORM', `${p}.${k}`, `Wert von '${k}' muss true/false, Text, Zahl oder null sein`);
    }
  };
  if (doc.erwartet) { flagForm(doc.erwartet, 'erwartet', 'erwartet'); if (isObj(doc.erwartet)) for (const k of Object.keys(doc.erwartet)) flagsSet.add(k); }
  // S2: Flags, die Umsetzungen zur Laufzeit liefern (steps[].liefert_flags) und die Schützlings-Flags je Tag
  for (const s of Array.isArray(doc.steps) ? doc.steps : []) for (const f of (isObj(s) && Array.isArray(s.liefert_flags) ? s.liefert_flags : [])) flagsSet.add(f);
  for (const tag of shipTags) for (const suf of SHIP_FLAG_SUFFIXES) flagsSet.add(tag + suf);
  const dsf = doc.angebot && doc.angebot.direktstart && doc.angebot.direktstart.setFlag;
  if (dsf !== undefined) { flagForm(dsf, 'angebot.direktstart.setFlag', 'setFlag'); if (isObj(dsf)) for (const k of Object.keys(dsf)) flagsSet.add(k); }

  // --- Parameter eines Bausteins
  const paramCheck = (kind, name, args, p, actx) => {
    const def = Reg.get(name);
    if (!def || def.art !== kind) { E(kind === 'aktion' ? 'REF-BAUSTEIN' : 'REF-PRUEFUNG', p, `${kind === 'aktion' ? 'Baustein' : 'Prüfung'} '${name}' ist nicht registriert`); return null; }
    if (def.intern && !actx.debug && !isIntern) E('BAUSTEIN-INTERN', p, `Interner Baustein '${name}' nur in 'skip', 'debug' oder Büchern mit kopf.art 'intern' erlaubt`);
    for (const [pn, pd] of Object.entries(def.params)) if (pd.pflicht && !(pn in args)) E('PARAM-FEHLT', p, `'${name}' braucht Parameter '${pn}'`);
    for (const [pn, val] of Object.entries(args)) {
      const pd = def.params[pn];
      if (!pd) { E('PARAM-UNBEKANNT', p, `'${name}' kennt keinen Parameter '${pn}'`); continue; }
      if (pd.werte && !pd.werte.includes(val)) E('PARAM-WERT', p, `'${pn}' = ${JSON.stringify(val)} nicht in ${JSON.stringify(pd.werte)}`);
      if (pd.typ === 'number') {
        if (!(typeof val === 'number' || Loader.isCfgRef(val))) E('PARAM-TYP', p, `'${pn}' muss eine Zahl sein`);
        else if (typeof val === 'number' && ((pd.min != null && val < pd.min) || (pd.max != null && val > pd.max))) E('PARAM-WERT', p, `'${pn}' = ${val} außerhalb ${pd.min != null ? pd.min : '…'}–${pd.max != null ? pd.max : '…'}`);
      }
      if (pd.typ === 'bool' && typeof val !== 'boolean') E('PARAM-TYP', p, `'${pn}' muss true/false sein`);
      if (pd.typ === 'region' && !(val === 'random' || (Number.isInteger(val) && val >= 0 && val <= 3))) E('PARAM-WERT', p, `'${pn}' muss 0–3 oder "random" sein`);
      if (pd.typ === 'loc' && !LOC_IDS.has(val)) E('REF-ORT', p, `Ort '${val}' gibt es nicht`);
      if (pd.typ === 'loc' && !actx.debug && LOC_IDS.has(val) && !orte.has(val)) W('ORT-BUEHNE', p, `Ort '${val}' fehlt in buehne.orte`);
      if (pd.typ === 'map' && !Obj.AWAY_LEGENDS[val]) E('REF-KARTE', p, `Außenkarte '${val}' gibt es nicht`);
      else if (pd.typ === 'map' && !karten.has(val)) E('REF-KARTE', p, `Karte '${val}' fehlt in buehne.aussenkarten`);
      if (pd.typ === 'npc') npcRef(val, p);
      if (pd.typ === 'text') textRef(val, p, pd.oda ? ODA_MAX : 0);
      if (pd.typ === 'hidden' && !HIDDEN_IDS.has(val)) E('REF-FUND', p, `Fund '${val}' gibt es nicht`);
      if (pd.typ === 'squad' && !(val in gruppen)) E('REF-GRUPPE', p, `Trupp '${val}' fehlt in besetzung.gruppen`);
      if (pd.typ === 'unit' && !(val in einheiten)) E('REF-GRUPPE', p, `Einheit '${val}' fehlt in besetzung.einheiten`);
      if (pd.typ === 'ship' && !shipTags.has(val)) E('REF-SCHIFF', p, `Schiff '${val}' fehlt in besetzung.schiffe`);
      if (pd.typ === 'zone' && !(Obj.SPACE_ZONES[args.loc] && Obj.SPACE_ZONES[args.loc][val])) E('REF-ZONE', p, `Zone '${val}' gibt es für Ort '${args.loc}' nicht (objects.js SPACE_ZONES)`);
      if (pd.typ === 'object') {
        const map = args.map; const def2 = Obj.declared(map)[val];
        if (!def2) E('REF-OBJEKT', p, `Objekt '${val}' ist für Karte '${map}' nicht deklariert`);
        else {
          if (!((buehne.objekte || {})[map] || []).includes(val)) W('OBJEKT-BUEHNE', p, `Objekt '${val}' fehlt in buehne.objekte.${map}`);
          if (args.state !== undefined && !def2.zustaende.includes(args.state)) E('PARAM-WERT', p, `Zustand '${args.state}' gibt es für '${val}' nicht (${def2.zustaende.join(', ')})`);
        }
      }
      if (pd.typ === 'area') {
        const map = args.map;
        if (!Obj.areas(map)[val]) E('REF-BEREICH', p, `Bereich '${val}' ist für Karte '${map}' nicht deklariert`);
        else if (!((buehne.bereiche || {})[map] || []).includes(val)) W('BEREICH-BUEHNE', p, `Bereich '${val}' fehlt in buehne.bereiche.${map}`);
      }
      if (Loader.isCfgRef(val) && cfgValue(val) === undefined) E('REF-CFG', p, `config-Wert '${val.cfg}' gibt es nicht`);
    }
    return def;
  };

  // --- Bedingungen
  const lossPaths = new Set();   // S2: Tags mit einem Weg für 'kampfunfaehig' (escort_state … kampfunfaehig)
  const condCheck = (c, p, cctx) => {
    flagsRead(c, flagsReadSet);
    eachAtom(c, p, (k, v, ap) => {
      if (k === 'check') {
        const name = typeof v === 'string' ? v : v && v.name;
        const args = typeof v === 'string' ? {} : Object.fromEntries(Object.entries(v || {}).filter(([x]) => x !== 'name'));
        paramCheck('pruefung', name, args, ap, cctx);
        if (name === 'escort_state' && args.state === 'kampfunfaehig') lossPaths.add(args.tag || '*');
      }
      if (k === 'atLocation' || k === 'dest' || (k === 'docked' && typeof v === 'string')) {
        if (!LOC_IDS.has(v)) E('REF-ORT', ap, `Ort '${v}' gibt es nicht`);
      }
      if ((k === 'revealed' || k === 'found') && !HIDDEN_IDS.has(v)) E('REF-FUND', ap, `Fund '${v}' gibt es nicht`);
      if ((k === 'known' || k === 'visited') && !LOC_IDS.has(v)) E('REF-ORT', ap, `Ort '${v}' gibt es nicht`);
      if (k === 'elapsed' && Loader.isCfgRef(v) && cfgValue(v) === undefined) E('REF-CFG', ap, `config-Wert '${v.cfg}' gibt es nicht`);
      if (k === 'choiceMade' && !cctx.choiceIds.has(v)) E('REF-ENTSCHEIDUNG', ap, `Entscheidung '${v}' gibt es nicht`);
      if (k === 'flag' && isObj(v)) flagForm(v, ap, 'flag');
    });
  };

  const choiceIds = new Set();
  for (const s of doc.steps) for (const cid of Object.keys(s.choices || {})) choiceIds.add(cid);

  // --- Aktionen
  const gotos = new Map();
  const completes = new Set();
  const wendungIds = new Map();
  const actionCheck = (a, actx, p) => {
    if (a.do) {
      const args = Object.fromEntries(Object.entries(a).filter(([k]) => !['do', 'if', 'garantie', 'neu', 'wendung', 'ankuendigung', 'wirkung', 'once', '_kommentar'].includes(k)));
      const def = paramCheck('aktion', a.do, args, `${p}.do(${a.do})`, actx);
      if (def && def.effekt && !actx.debug && !actx.wendung && !actx.inEnter && !actx.folge) W('EFFEKT-OHNE-WENDUNG', p, `Spieleffekt '${a.do}' außerhalb von 'enter' sollte eine Wendung mit Ankündigung sein`);
      if (def && def.effekt && actx.restartSensitive && !actx.debug && !actx.guarded && a.if === undefined) E('NEUSTART', p, `Schritt kann angedockt gespeichert werden – Spieleffekt '${a.do}' wiederholt sich beim Laden (wiederaufnahme setzen oder per Bedingung absichern)`);
      if (a.do === 'force_choice' && actx.optionIds && !actx.optionIds.has(a.option)) E('REF-ENTSCHEIDUNG', p, `Option '${a.option}' gibt es in diesem Schritt nicht`);
    }
    for (const atom of EFFECT_ATOMS) if (a[atom] && !actx.debug) {
      if (!actx.wendung && !actx.inEnter) W('EFFEKT-OHNE-WENDUNG', p, `Spieleffekt '${atom}' außerhalb von 'enter' sollte eine Wendung sein`);
      if (actx.restartSensitive && !actx.guarded && a.if === undefined) E('NEUSTART', p, `Spieleffekt '${atom}' in einem speicherbaren Schritt wiederholt sich beim Laden (wiederaufnahme setzen oder per Bedingung absichern)`);
    }
    for (const f of TEXT_FIELDS_ACTION) if (a[f] !== undefined) textRef(a[f], `${p}.${f}`, f === 'oda' ? ODA_MAX : 0);
    if (a.radio) { textRef(a.radio.text, `${p}.radio.text`); npcRef(a.radio.from, `${p}.radio.from`); }
    if (a.title) textRef(a.title, `${p}.title`);
    if (a.text && !a.do) textRef(a.text, `${p}.text`);
    if (a.if !== undefined) condCheck(a.if, `${p}.if`, actx);
    if (a.setFlag !== undefined) { flagForm(a.setFlag, `${p}.setFlag`, 'setFlag'); if (isObj(a.setFlag)) for (const k of Object.keys(a.setFlag)) flagsSet.add(k); }
    if (a.set !== undefined) flagForm(a.set, `${p}.set`, 'set');
    if (a.goto) { if (!stepIds.has(a.goto)) E('REF-SCHRITT', p, `Ziel-Schritt '${a.goto}' gibt es nicht`); if (actx.stepId) gotos.get(actx.stepId).add(a.goto); }
    if (a.complete) {
      const id = a.complete === true ? 'erfolg' : a.complete;
      if (!ausgaenge.has(id)) E('REF-AUSGANG', p, a.complete === true ? "'complete: true' verlangt einen Ausgang 'erfolg'" : `Ausgang '${id}' gibt es nicht`);
      completes.add(id);
      if (actx.stepId) gotos.get(actx.stepId).add('#complete');
    }
    if (a.choice && actx.choiceHere && !actx.choiceHere.has(a.choice)) E('REF-ENTSCHEIDUNG', p, `Entscheidung '${a.choice}' ist in diesem Schritt nicht definiert`);
    if (a.wendung) {
      if (wendungIds.has(a.wendung)) E('WENDUNG-DOPPELT', p, `Wendung '${a.wendung}' doppelt`);
      wendungIds.set(a.wendung, p);
      if (!a.ankuendigung) E('FAIRNESS', p, `Wendung '${a.wendung}' ohne Ankündigung`);
      else {
        if (a.ankuendigung.oda) textRef(a.ankuendigung.oda, `${p}.ankuendigung.oda`, ODA_MAX);
        if (a.ankuendigung.radio) { textRef(a.ankuendigung.radio.text, `${p}.ankuendigung.radio.text`); npcRef(a.ankuendigung.radio.from, `${p}.ankuendigung.radio.from`); }
        if (!a.ankuendigung.oda && !a.ankuendigung.radio && a.ankuendigung.art !== 'sichtbar') E('FAIRNESS', p, `Ankündigung von '${a.wendung}' ohne ODA/Funk und nicht 'sichtbar'`);
      }
    }
    for (const k of PLANNED_FOLGEN) if (a[k] !== undefined && !a.do) E('MECHANIK-GEPLANT', p, `'${k}' (Ruf/Feldzug-Uhr) kommt erst ab S3`);
  };
  const noStep = (extra) => Object.assign({ stepId: null, choiceHere: null, optionIds: null, choiceIds }, extra || {});

  // --- Schritte
  const opened = new Set();
  doc.steps.forEach((s, i) => {
    const sp = `steps[${i}:${s.id}]`;
    gotos.set(s.id, new Set());
    if (s.loc && !LOC_IDS.has(s.loc)) E('REF-ORT', `${sp}.loc`, `Ort '${s.loc}' gibt es nicht`);
    else if (s.loc && !orte.has(s.loc)) W('ORT-BUEHNE', `${sp}.loc`, `Ort '${s.loc}' fehlt in buehne.orte`);
    for (const m of s.allowBeam || []) if (!Obj.AWAY_LEGENDS[m]) E('REF-KARTE', `${sp}.allowBeam`, `Außenkarte '${m}' gibt es nicht`);
    if (s.wiederaufnahme && !stepIds.has(s.wiederaufnahme.ab)) E('REF-SCHRITT', `${sp}.wiederaufnahme.ab`, `Schritt '${s.wiederaufnahme.ab}' gibt es nicht`);
    const choiceHere = new Set(Object.keys(s.choices || {}));
    const optionIds = new Set(Object.values(s.choices || {}).flatMap((c) => (c.options || []).map((o) => o.id)));
    // speicherbar = man kann in diesem Schritt angedockt sein (Hafen-/Händler-Ort, Bedingung 'docked', Andock-Flag)
    let dockable = !!(s.loc && PORT_IDS.has(s.loc));
    for (const [, c] of stepConditions(s)) eachAtom(c, '', (k, v) => {
      if (k === 'docked') dockable = true;
      if (k === 'flag' && (DOCK_FLAGS.includes(v) || (isObj(v) && Object.keys(v).some((f) => DOCK_FLAGS.includes(f))))) dockable = true;
    });
    const restartSafe = !!s.drill || !!s.wiederaufnahme;
    for (const [lp, list, holder] of stepActionLists(s)) {
      const debug = lp === 'skip' || lp === 'wiederaufnahme.prep';
      const inEnter = lp === 'enter';
      const restartSensitive = dockable && !restartSafe && (inEnter || /^timers/.test(lp));
      const guarded = !!(holder && holder.if !== undefined);
      eachAction(list, { stepId: lp === 'wiederaufnahme.prep' ? null : s.id, debug, inEnter, restartSensitive, guarded, choiceHere, optionIds, choiceIds }, (a, actx) => {
        actionCheck(a, actx, `${sp}.${lp}`);
        if (a.choice) opened.add(a.choice);
      });
    }
    for (const [cp, c] of stepConditions(s)) condCheck(c, `${sp}.${cp}`, { choiceIds, debug: false });
    (s.objectives || []).forEach((o, k) => textRef(o.text, `${sp}.objectives[${k}].text`));
    for (const [cid, c] of Object.entries(s.choices || {})) {
      textRef(c.prompt, `${sp}.choices.${cid}.prompt`);
      for (const o of c.options || []) {
        textRef(o.label, `${sp}.choices.${cid}.${o.id}.label`);
        if (!(c.on && c.on[o.id]) && !c.after) E('ENTSCHEIDUNG-OHNE-AUSGANG', `${sp}.choices.${cid}`, `Option '${o.id}' hat keine Folge (kein on.${o.id}, kein after)`);
      }
      for (const k of Object.keys(c.on || {})) if (!(c.options || []).some((o) => o.id === k)) W('ENTSCHEIDUNG-OPTION', `${sp}.choices.${cid}.on`, `Handler für unbekannte Option '${k}'`);
    }
    if (s.scan) { textRef(s.scan.label, `${sp}.scan.label`); if (s.scan.blocked) textRef(s.scan.blocked, `${sp}.scan.blocked`); }
    for (const b of (s.jumpBlock || []).concat(s.destBlock || [])) textRef(b.reason, `${sp}.jumpBlock.reason`);
    if (isSide) return;
    // Garantien
    const mandatory = (s.objectives || []).filter((o) => !o.optional && o.done !== false);
    const marked = [].concat(s.timers || [], s.rules || [], s.next || []).some((x) => x.garantie)
      || (s.timers || []).some((t) => [].concat(t.do || []).some((a) => a.garantie))
      || (s.rules || []).some((r) => [].concat(r.do || []).some((a) => a.garantie));
    if (mandatory.length && !marked) E('GARANTIE', sp, 'Schritt mit Pflichtziel ohne Garantie (Hinweis, Zeitlimit oder Autolösung bei Stillstand)');
    if (!s.skip) W('SKIP', sp, 'kein skip (Debug/QA kann den Schritt nicht überspringen)');
  });
  for (const cid of choiceIds) if (!opened.has(cid)) W('ENTSCHEIDUNG-NIE', 'steps', `Entscheidung '${cid}' wird nie geöffnet`);

  // --- missionsweite Handler, Ausgänge, Debug, Angebot, Buch
  for (const [ev, acts] of Object.entries(doc.on || {})) eachAction(acts, noStep(), (a, actx) => actionCheck(a, actx, `on.${ev}`));
  for (const [aid, ag] of Object.entries(doc.ausgaenge || {})) {
    const folgen = (ag.folgen || []).map(Loader.normalizeFolge);
    eachAction(folgen, noStep({ folge: true }), (a, actx) => actionCheck(a, actx, `ausgaenge.${aid}.folgen`));
    eachAction(ag.danach, noStep(), (a, actx) => actionCheck(a, actx, `ausgaenge.${aid}.danach`));
    if (!completes.has(aid) && aid !== 'uebersprungen') W('AUSGANG-NIE', `ausgaenge.${aid}`, `Ausgang '${aid}' wird nie erreicht`);
  }
  if (kopf.tutorial && !isSide && ausgaenge.size && !ausgaenge.has('uebersprungen')) W('AUSGANG-UEBERSPRUNGEN', 'ausgaenge', "Tutorial-Mission ohne Ausgang 'uebersprungen' (Kampagne ohne Tutorial setzt dann keine Fakten)");
  if (doc.debug) {
    for (const [sid, acts] of Object.entries(doc.debug.prep || {})) {
      if (!stepIds.has(sid)) E('REF-SCHRITT', `debug.prep.${sid}`, `Schritt '${sid}' gibt es nicht`);
      eachAction(acts, noStep({ debug: true }), (a, actx) => actionCheck(a, actx, `debug.prep.${sid}`));
    }
    eachAction(doc.debug.done, noStep({ debug: true }), (a, actx) => actionCheck(a, actx, 'debug.done'));
  }
  if (doc.angebot) {
    if (doc.angebot.nach) condCheck(doc.angebot.nach, 'angebot.nach', { choiceIds });
    if (doc.angebot.nicht_wenn) condCheck(doc.angebot.nicht_wenn, 'angebot.nicht_wenn', { choiceIds });
    const ds = doc.angebot.direktstart;
    if (ds && ds.prep) eachAction(ds.prep, noStep({ debug: true }), (a, actx) => actionCheck(a, actx, 'angebot.direktstart.prep'));
  }
  ((doc.buch || {}).von || []).forEach((v, i) => { if (v.if !== undefined) condCheck(v.if, `buch.von[${i}].if`, { choiceIds }); });
  // Nebenauftrag: Bucheintrag als Daten (buch.sichtbar/erledigt/ort/ziele)
  if (isSide && doc.buch) {
    const b = doc.buch;
    if (b.sichtbar === undefined && !(doc.angebot && doc.angebot.nach)) W('NEBEN-SICHTBAR', 'buch.sichtbar', 'ohne Bedingung steht der Eintrag ab Spielbeginn im Buch');
    if (b.sichtbar !== undefined) condCheck(b.sichtbar, 'buch.sichtbar', { choiceIds });
    if (b.erledigt !== undefined) condCheck(b.erledigt, 'buch.erledigt', { choiceIds });
    if (b.ort !== undefined && !LOC_IDS.has(b.ort)) E('REF-ORT', 'buch.ort', `Ort '${b.ort}' gibt es nicht`);
    if (!(b.ziele || []).length && !doc.steps.length) E('NEBEN-ZIELE', 'buch.ziele', 'Nebenauftrag ohne Ziele');
    (b.ziele || []).forEach((o, k) => {
      textRef(o.text, `buch.ziele[${k}].text`);
      if (o.show !== undefined) condCheck(o.show, `buch.ziele[${k}].show`, { choiceIds });
      condCheck(o.done, `buch.ziele[${k}].done`, { choiceIds });
    });
  }

  // --- Zahlen aus config.js überall
  const walkCfg = (node, p) => {
    if (Array.isArray(node)) { node.forEach((x, i) => walkCfg(x, `${p}[${i}]`)); return; }
    if (!isObj(node)) return;
    if (Loader.isCfgRef(node)) { if (cfgValue(node) === undefined) E('REF-CFG', p, `config-Wert '${node.cfg}' gibt es nicht`); return; }
    for (const [k, v] of Object.entries(node)) walkCfg(v, `${p}.${k}`);
  };
  walkCfg(doc.steps, 'steps'); walkCfg(doc.on, 'on'); walkCfg(doc.ausgaenge, 'ausgaenge'); walkCfg(doc.debug, 'debug');
  // doppelte REF-CFG (paramCheck + walk) zusammenfassen
  const seen = new Set();
  for (let i = errors.length - 1; i >= 0; i--) {
    const e = errors[i];
    if (e.code !== 'REF-CFG') continue;
    const key = e.msg; if (seen.has(key)) errors.splice(i, 1); else seen.add(key);
  }

  // --- Flags: gelesen, aber nie gesetzt / gesetzt, aber nie gelesen
  for (const f of flagsReadSet) {
    if (!flagsSet.has(f) && !GLOBAL_FLAGS.includes(f)) E('FLAG-UNGESETZT', 'flags', `Flag '${f}' wird gelesen, aber nie gesetzt (weder hier noch in 'erwartet' noch global: ${GLOBAL_FLAGS.join(', ')})`);
  }
  for (const f of flagsSet) {
    if (!flagsReadSet.has(f) && !GLOBAL_FLAGS.includes(f) && !(doc.erwartet && f in doc.erwartet)) W('FLAG-UNGELESEN', 'flags', `Flag '${f}' wird gesetzt, aber in diesem Buch nie gelesen`);
  }

  // --- S2: Schützling ohne Verlustweg. Ein Weg ist: Prüfung escort_state { tag, state: 'kampfunfaehig' }, gelesene Flag
  // <tag>_verloren bzw. <tag>_beschaedigt (liefert_flags der Umsetzung) oder ein Handler für escortDisabled.
  if (shipTags.size && !isSide) {
    const onDisabled = !!((doc.on || {}).escortDisabled) || doc.steps.some((s) => s.on && s.on.escortDisabled);
    for (const tag of shipTags) {
      const ok = onDisabled || lossPaths.has(tag) || lossPaths.has('*') || flagsReadSet.has(tag + '_verloren') || flagsReadSet.has(tag + '_beschaedigt');
      if (!ok) E('SCHUETZLING-OHNE-VERLUST', `besetzung.schiffe.${tag}`, `Schützling '${tag}' hat keinen Weg für 'kampfunfaehig' (escort_state … kampfunfaehig, Flag ${tag}_verloren/${tag}_beschaedigt oder on.escortDisabled) – Verlust darf kein Softlock sein`);
    }
  }

  // --- Ablauf (nicht für Nebenaufträge: dort nur Bucheintrag)
  if (!isSide) {
    const first = doc.steps[0] && doc.steps[0].id;
    const reach = new Set([first]); const todo = [first];
    while (todo.length) for (const t of gotos.get(todo.pop()) || []) if (t !== '#complete' && stepIds.has(t) && !reach.has(t)) { reach.add(t); todo.push(t); }
    for (const s of doc.steps) {
      if (!reach.has(s.id)) E('ABLAUF-UNERREICHBAR', `steps.${s.id}`, `Schritt '${s.id}' ist vom ersten Schritt aus nicht erreichbar`);
      if (!(gotos.get(s.id) || new Set()).size && !isIntern) E('ABLAUF-SACKGASSE', `steps.${s.id}`, `Schritt '${s.id}' hat keinen Ausgang (kein goto, kein complete)`);
    }
    if (!isIntern) {
      const endReach = new Set(); let changed = true;
      while (changed) { changed = false; for (const [sid, ts] of gotos) if (!endReach.has(sid) && [...ts].some((t) => t === '#complete' || endReach.has(t))) { endReach.add(sid); changed = true; } }
      if (first && !endReach.has(first)) E('ABLAUF-KEIN-ENDE', 'steps', 'Vom ersten Schritt aus ist kein Missionsende erreichbar');
      for (const s of doc.steps) if (reach.has(s.id) && !endReach.has(s.id)) E('ABLAUF-KEIN-ENDE', `steps.${s.id}`, `Von '${s.id}' aus ist kein Missionsende erreichbar`);
    }
  }

  for (const k of Object.keys(doc.texte)) if (!usedTexts.has(k)) W('TEXT-UNBENUTZT', `texte.${k}`, 'wird nirgends verwendet');
  return done();
}

// ---------------------------------------------------------------------------------------------------------------
// Selbsttest: kaputte Regiebücher (Abnahme Briefing S1 §7.3 + S1-Codes), erzeugt aus m3. -> { ok, lines }
function selftest(baseFile) {
  const file = baseFile || path.join(Loader.BOOK_DIR, 'm3.regiebuch.json');
  const base = JSON.parse(fs.readFileSync(file, 'utf8'));
  const clone = () => JSON.parse(JSON.stringify(base));
  const step = (d, id) => d.steps.find((s) => s.id === id);
  const cases = [
    ['Fehlender Ort', 'REF-ORT', (d) => { step(d, 'courtyard').loc = 'kesch'; }],
    ['Unerreichbarer Schritt', 'ABLAUF-UNERREICHBAR', (d) => { d.steps.push({ id: 'geheim', loc: 'kesh', objectives: [], next: [{ if: { elapsed: 5 }, goto: 'extract' }], skip: [] }); }],
    ['Entscheidung ohne Ausgang', 'ENTSCHEIDUNG-OHNE-AUSGANG', (d) => {
      const s = step(d, 'flight');
      d.texte['test.frage'] = 'Landen oder warten?'; d.texte['test.landen'] = 'Landen'; d.texte['test.warten'] = 'Warten';
      s.choices = { landung: { prompt: '@test.frage', options: [{ id: 'landen', label: '@test.landen' }, { id: 'warten', label: '@test.warten' }], on: { landen: [{ oda: '@flight.kurs' }] } } };
      s.timers.push({ at: 1, choice: 'landung' });
    }],
    ['Fehlender Text', 'REF-TEXT', (d) => { step(d, 'flight').timers[0].oda = '@flight.kurss'; }],
    ['Wendung ohne Ankündigung', 'FAIRNESS', (d) => { const e = step(d, 'warden').enter.find((a) => a.wendung); delete e.ankuendigung; }],
    ['Schritt ohne Garantie', 'GARANTIE', (d) => { step(d, 'tablet').timers = []; }],
    ['Spawn beim Betreten eines Hafen-Schritts', 'NEUSTART', (d) => { const s = step(d, 'briefing'); s.loc = 'hafen'; s.enter = [{ do: 'spawn_squad', map: 'kesh', squad: 'squad1' }]; }],
    ['setFlag als Liste', 'FLAG-FORM', (d) => { step(d, 'flight').timers[0].do = [{ setFlag: ['kaputt'] }]; }],
    ['Flag mit falschem Namen', 'FLAG-FORM', (d) => { step(d, 'flight').timers[0].do = [{ setFlag: { 'Kaputt-Flag': true } }]; }],
    ['Gelesene Flag nie gesetzt', 'FLAG-UNGESETZT', (d) => { step(d, 'flight').timers[0].if = { flag: 'gibtsNicht' }; }],
    ['Schützling ohne Verlustweg (S2)', 'SCHUETZLING-OHNE-VERLUST', (d) => { d.besetzung.schiffe = { konvoi: { kind: 'frachter', name: 'Konvoi' } }; }],
    ['Unbekannter Baustein', 'REF-BAUSTEIN', (d) => { step(d, 'flight').enter = [{ do: 'spawnSquad', squad: 'squad1' }]; }],
    ['Interner Baustein im Ablauf', 'BAUSTEIN-INTERN', (d) => { step(d, 'flight').enter = [{ do: 'debug_jump', loc: 'kesh' }]; }],
    ['ODA-Text zu lang', 'ODA-LAENGE', (d) => { d.texte['flight.kurs'] = 'x'.repeat(130); }],
  ];
  const lines = [];
  let ok = 0;
  const r0 = check(base);
  lines.push(`${r0.errors.length ? '✗' : '✓'} ${path.basename(file)} unverändert: ${r0.errors.length} Fehler, ${r0.warnings.length} Warnungen`);
  if (r0.errors.length) for (const e of r0.errors) lines.push(`    ${e.code} ${e.p}: ${e.msg}`);
  if (!r0.errors.length) ok++;
  for (const [name, code, mut] of cases) {
    const d = clone();
    try { mut(d); } catch (e) { lines.push(`✗ ${name}: Mutation passt nicht zum Buch (${e.message})`); continue; }
    const r = check(d); const hit = r.errors.find((e) => e.code === code);
    lines.push(`${hit ? '✓' : '✗'} ${name}: ${hit ? `${code} – ${hit.msg}` : `erwartet ${code}, bekommen: ${r.errors.map((e) => e.code).join(', ') || 'keine Fehler'}`}`);
    if (hit) ok++;
  }
  // Warnung FLAG-UNGELESEN
  {
    const d = clone(); step(d, 'flight').timers[0].do = [{ setFlag: { nieGelesen: true } }];
    const r = check(d); const hit = r.warnings.find((w) => w.code === 'FLAG-UNGELESEN');
    lines.push(`${hit ? '✓' : '✗'} Gesetzte Flag nie gelesen (Warnung): ${hit ? 'FLAG-UNGELESEN – ' + hit.msg : 'keine Warnung'}`);
    if (hit) ok++;
  }
  const total = cases.length + 2;
  lines.push(`${ok}/${total} bestanden`);
  return { ok: ok === total, passed: ok, total, lines };
}

module.exports = { check, validate, selftest, schema, eachAction, eachAtom, stepActionLists, stepConditions, GLOBAL_FLAGS, ODA_MAX, SHIP_FLAG_SUFFIXES };
