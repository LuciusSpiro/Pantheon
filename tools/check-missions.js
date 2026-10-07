'use strict';
// Prüfer für Regiebücher (Konzept S1 „Regiebuch & Weltstand“, Vorarbeit). Prüft ohne Ausführen:
//  1. Schema (Struktur, concept/regiebuch/regiebuch.schema.json)
//  2. Referenzen gegen den Code: Orte (shared/locations.js), Außenkarten + Kachelarten (shared/maps.js),
//     Zahlen aus shared/config.js, Bausteine/Objekte/Bereiche/NSC (concept/regiebuch/bausteine.json), Texte
//  3. Ablauf: Schritte erreichbar, keine Sackgassen, jede Entscheidung mit Ausgang, Ausgänge vorhanden
//  4. Garantien: jeder Schritt mit Pflichtziel hat einen Hinweis/ein Zeitlimit
//  5. Fairness: Wendungen haben eine Ankündigung, Spieleffekte außerhalb von 'enter' sind Wendungen
//  6. Neustartfest: Schritte, in denen angedockt (= gespeichert) werden kann, haben keine Spieleffekte beim Betreten
// Aufruf: node tools/check-missions.js [dateien…] [--selftest] [--quiet]
// Ohne Dateien: concept/regiebuch/*.regiebuch.json und data/regiebuecher/*.json. Exit 1 bei Fehlern.
// Nur Lesezugriff, keine Abhängigkeiten. Die Kernfunktion check(doc) ist exportiert (später ruft der Server sie auf).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONCEPT = path.join(ROOT, 'concept', 'regiebuch');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(CONCEPT, 'regiebuch.schema.json'), 'utf8'));
const REG = JSON.parse(fs.readFileSync(path.join(CONCEPT, 'bausteine.json'), 'utf8'));
const Locations = require('../shared/locations.js');
const Maps = require('../shared/maps.js');
const CONFIG = require('../shared/config.js');

const LOC_IDS = new Set(Locations.LOCATIONS.map((l) => l.id));
const PORT_IDS = new Set(Locations.LOCATIONS.filter((l) => l.kind === 'port' || l.kind === 'trader').map((l) => l.id));
const HIDDEN_IDS = new Set(Locations.LOCATIONS.flatMap((l) => l.hidden.map((h) => h.id)));
const AWAY_LEGENDS = { platform: Maps.PLATFORM_LEGEND, wreck: Maps.WRECK_LEGEND, kesh: Maps.KESH_LEGEND };
const NPC_IDS = new Set(Object.keys(REG.npc).filter((k) => !k.startsWith('$')));
const TEXT_FIELDS_ACTION = ['oda', 'log'];
const EFFECT_ATOMS = ['spawn', 'spawnSalvage'];   // Spieleffekte ohne Baustein (Atome von heute)

// ---------------------------------------------------------------------------------------------------------------
// 1. Mini-Validator für JSON-Schema (nur die Teile, die regiebuch.schema.json benutzt)
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
function resolve(ref, root) {
  if (!ref.startsWith('#/')) throw new Error('Nur lokale $ref: ' + ref);
  return ref.slice(2).split('/').reduce((o, k) => o[k], root);
}
// root: Wurzelschema für $ref (Standard: Regiebuch); auch für Molekül- und Szenentyp-Schemas nutzbar
function validate(v, s, p, out, root) {
  root = root || SCHEMA;
  if (s === true || s == null) return;
  if (s === false) { out.push([p, 'nicht erlaubt']); return; }
  if (s.$ref) return validate(v, resolve(s.$ref, root), p, out, root);
  if (s.type && !typeOk(v, s.type)) { out.push([p, `Typ ${typeOf(v)} statt ${[].concat(s.type).join('|')}`]); return; }
  if ('const' in s && v !== s.const) out.push([p, `muss ${JSON.stringify(s.const)} sein`]);
  if (s.enum && !s.enum.includes(v)) out.push([p, `${JSON.stringify(v)} nicht in ${JSON.stringify(s.enum)}`]);
  if (typeof v === 'string') {
    if (s.maxLength != null && v.length > s.maxLength) out.push([p, `länger als ${s.maxLength} Zeichen`]);
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
      // die „nächste“ Alternative melden (gleicher Typ, wenigste Fehler), sonst allgemein
      const best = results.filter((r) => r.length && !r.some(([, m]) => m.startsWith('Typ '))).sort((a, b) => a.length - b.length)[0];
      if (ok === 0 && best) out.push(...best);
      else out.push([p, ok === 0 ? 'passt zu keiner erlaubten Form' : 'mehrdeutig (passt zu mehreren Formen)']);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Hilfen zum Durchlaufen von Aktionen und Bedingungen
function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }

// Ruft cb(aktion, kontext) für jede Aktion auf, auch in 'wirkung' und 'after'.
function eachAction(list, ctx, cb) {
  for (const a of [].concat(list || [])) {
    if (!isObj(a)) continue;
    cb(a, ctx);
    if (a.wirkung) eachAction(a.wirkung, Object.assign({}, ctx, { wendung: a.wendung || ctx.wendung }), cb);
    if (isObj(a.after)) eachAction(a.after.do || [a.after], ctx, cb);
  }
}
// Alle Aktionslisten eines Schritts mit Herkunft (für Kontextregeln)
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
  return L;
}
// Ruft cb(atomName, wert, pfad) für jedes Atom einer Bedingung auf
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
// Alle Bedingungen eines Schritts
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
function cfgValue(ref) {
  const v = ref.cfg.split('.').reduce((o, k) => (o == null ? undefined : o[k]), CONFIG);
  return typeof v === 'number' ? v + (ref.plus || 0) : undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// 2.–6. Semantische Prüfung
function check(doc) {
  const errors = []; const warnings = [];
  const E = (code, p, msg) => errors.push({ code, p, msg });
  const W = (code, p, msg) => warnings.push({ code, p, msg });

  // 1. Schema
  const schemaOut = [];
  validate(doc, SCHEMA, '$', schemaOut);
  for (const [p, m] of schemaOut) E('SCHEMA', p, m);
  if (!isObj(doc) || !Array.isArray(doc.steps) || !isObj(doc.texte)) return { errors, warnings };

  const buehne = doc.buehne || {}; const bes = doc.besetzung || {};
  const orte = new Set(buehne.orte || []);
  const karten = new Set(buehne.aussenkarten || []);
  const npcCast = new Set(bes.npc || []);
  const gruppen = bes.gruppen || {}; const einheiten = bes.einheiten || {};
  const stepIds = new Map();
  doc.steps.forEach((s, i) => { if (stepIds.has(s.id)) E('ABLAUF-DOPPELT', `steps[${i}]`, `Schritt-ID '${s.id}' doppelt`); stepIds.set(s.id, i); });
  const ausgaenge = new Set(Object.keys(doc.ausgaenge || {}));

  // --- Texte
  const usedTexts = new Set();
  const textRef = (val, p) => {
    if (typeof val !== 'string') return;
    if (val.startsWith('@')) {
      const k = val.slice(1); usedTexts.add(k);
      if (!(k in doc.texte)) E('REF-TEXT', p, `Text '${val}' fehlt in 'texte'`);
    } else W('TEXT-LITERAL', p, 'Literaltext statt Verweis (@kennung) – der Spielleiter kann ihn nicht austauschen');
  };

  // --- Bühne
  for (const o of orte) if (!LOC_IDS.has(o)) E('REF-ORT', 'buehne.orte', `Ort '${o}' gibt es nicht (shared/locations.js)`);
  for (const k of karten) if (!AWAY_LEGENDS[k]) E('REF-KARTE', 'buehne.aussenkarten', `Außenkarte '${k}' gibt es nicht (shared/maps.js)`);
  for (const [map, objs] of Object.entries(buehne.objekte || {})) for (const o of objs) {
    const def = REG.karten[map] && REG.karten[map].objekte[o];
    if (!def) E('REF-OBJEKT', `buehne.objekte.${map}`, `Objekt '${o}' ist für Karte '${map}' nicht deklariert`);
  }
  for (const [map, areas] of Object.entries(buehne.bereiche || {})) for (const a of areas) {
    const def = REG.karten[map] && REG.karten[map].bereiche[a];
    if (!def) E('REF-BEREICH', `buehne.bereiche.${map}`, `Bereich '${a}' ist für Karte '${map}' nicht deklariert`);
    else if (/provisorisch|config/.test(def.quelle || '')) W('BEREICH-PROVISORISCH', `buehne.bereiche.${map}`, `Bereich '${a}' steht noch nicht in den Kartendaten (${def.quelle})`);
  }
  // Kachelarten der deklarierten Objekte/Gruppen müssen in der Karte existieren
  const legendKinds = (map) => new Set(Object.values(AWAY_LEGENDS[map] || {}).flatMap((t) => [t.kind, t.spawn, t.interact].filter(Boolean)));
  for (const [map, grp] of Object.entries(Object.assign({}, gruppen, einheiten))) {
    const g = grp; const kinds = legendKinds(g.map);
    const regG = REG.karten[g.map] && ((REG.karten[g.map].gruppen || {})[map] || (REG.karten[g.map].einheiten || {})[map]);
    if (!regG) E('REF-GRUPPE', `besetzung.${map}`, `Gruppe/Einheit '${map}' ist für Karte '${g.map}' nicht deklariert`);
    else if (!kinds.has(regG.legend)) E('REF-KACHEL', `besetzung.${map}`, `Kachelart '${regG.legend}' fehlt in der Karte '${g.map}'`);
    if (g.anker && AWAY_LEGENDS[g.map] && !(g.anker in AWAY_LEGENDS[g.map])) E('REF-ANKER', `besetzung.${map}.anker`, `Zeichen '${g.anker}' fehlt in der Legende von '${g.map}'`);
    if (!karten.has(g.map)) E('REF-KARTE', `besetzung.${map}.map`, `Karte '${g.map}' fehlt in buehne.aussenkarten`);
  }
  for (const map of karten) {
    const kinds = legendKinds(map);
    for (const [o, def] of Object.entries((REG.karten[map] || {}).objekte || {})) if (!kinds.has(def.legend)) W('REF-KACHEL', `bausteine.karten.${map}.${o}`, `Kachelart '${def.legend}' fehlt in der Karte`);
  }

  // --- NSC
  const npcRef = (id, p) => {
    if (!NPC_IDS.has(id)) E('REF-NPC', p, `NSC '${id}' unbekannt`);
    else if (!npcCast.has(id)) W('NPC-BESETZUNG', p, `NSC '${id}' fehlt in besetzung.npc`);
  };
  if (doc.kopf) npcRef(doc.kopf.auftraggeber, 'kopf.auftraggeber');
  ((doc.buch || {}).von || []).forEach((v, i) => npcRef(v.npc, `buch.von[${i}]`));
  if (doc.buch) { textRef(doc.buch.briefing, 'buch.briefing'); textRef(doc.buch.belohnung, 'buch.belohnung'); }

  // --- Parameter eines Bausteins prüfen
  const paramCheck = (kind, name, args, p, ctx) => {
    const def = (kind === 'aktion' ? REG.aktionen : REG.pruefungen)[name];
    if (!def) { E(kind === 'aktion' ? 'REF-BAUSTEIN' : 'REF-PRUEFUNG', p, `${kind === 'aktion' ? 'Baustein' : 'Prüfung'} '${name}' ist nicht registriert`); return null; }
    if (def.einordnung === 'intern' && !ctx.debug) E('BAUSTEIN-INTERN', p, `Interner Baustein '${name}' nur in 'skip' oder 'debug' erlaubt`);
    for (const [pn, pd] of Object.entries(def.params)) if (pd.pflicht && !(pn in args)) E('PARAM-FEHLT', p, `'${name}' braucht Parameter '${pn}'`);
    for (const [pn, val] of Object.entries(args)) {
      const pd = def.params[pn];
      if (!pd) { E('PARAM-UNBEKANNT', p, `'${name}' kennt keinen Parameter '${pn}'`); continue; }
      if (pd.werte && !pd.werte.includes(val)) E('PARAM-WERT', p, `'${pn}' = ${JSON.stringify(val)} nicht in ${JSON.stringify(pd.werte)}`);
      if (pd.typ === 'number' && !(typeof val === 'number' || (isObj(val) && val.cfg))) E('PARAM-TYP', p, `'${pn}' muss eine Zahl sein`);
      if (pd.typ === 'boolean' && typeof val !== 'boolean') E('PARAM-TYP', p, `'${pn}' muss true/false sein`);
      if (pd.typ === 'loc' && !LOC_IDS.has(val)) E('REF-ORT', p, `Ort '${val}' gibt es nicht`);
      if (pd.typ === 'loc' && !ctx.debug && LOC_IDS.has(val) && !orte.has(val)) W('ORT-BUEHNE', p, `Ort '${val}' fehlt in buehne.orte`);
      if (pd.typ === 'map' && !karten.has(val)) E('REF-KARTE', p, `Karte '${val}' fehlt in buehne.aussenkarten`);
      if (pd.typ === 'npc') npcRef(val, p);
      if (pd.typ === 'text') textRef(val, p);
      if (pd.typ === 'find' && !HIDDEN_IDS.has(val)) E('REF-FUND', p, `Fund '${val}' gibt es nicht`);
      if (pd.typ === 'squad' && !(val in gruppen)) E('REF-GRUPPE', p, `Trupp '${val}' fehlt in besetzung.gruppen`);
      if (pd.typ === 'unit' && !(val in einheiten)) E('REF-GRUPPE', p, `Einheit '${val}' fehlt in besetzung.einheiten`);
      if (pd.typ === 'object') {
        const map = args.map; const def2 = REG.karten[map] && REG.karten[map].objekte[val];
        if (!def2) E('REF-OBJEKT', p, `Objekt '${val}' ist für Karte '${map}' nicht deklariert`);
        else {
          if (!((buehne.objekte || {})[map] || []).includes(val)) W('OBJEKT-BUEHNE', p, `Objekt '${val}' fehlt in buehne.objekte.${map}`);
          if (args.state && !def2.zustaende.includes(args.state)) E('PARAM-WERT', p, `Zustand '${args.state}' gibt es für '${val}' nicht (${def2.zustaende.join(', ')})`);
        }
      }
      if (pd.typ === 'area') {
        const map = args.map;
        if (!(REG.karten[map] && REG.karten[map].bereiche[val])) E('REF-BEREICH', p, `Bereich '${val}' ist für Karte '${map}' nicht deklariert`);
        else if (!((buehne.bereiche || {})[map] || []).includes(val)) W('BEREICH-BUEHNE', p, `Bereich '${val}' fehlt in buehne.bereiche.${map}`);
      }
      if (isObj(val) && val.cfg && cfgValue(val) === undefined) E('REF-CFG', p, `config-Wert '${val.cfg}' gibt es nicht`);
    }
    return def;
  };

  // --- Bedingungen
  const condCheck = (c, p, ctx) => eachAtom(c, p, (k, v, ap) => {
    if (k === 'check') {
      const name = typeof v === 'string' ? v : v.name;
      const args = typeof v === 'string' ? {} : Object.fromEntries(Object.entries(v).filter(([x]) => x !== 'name'));
      paramCheck('pruefung', name, args, ap, ctx);
    }
    if (k === 'atLocation' || k === 'dest' || (k === 'docked' && typeof v === 'string')) {
      if (!LOC_IDS.has(v)) E('REF-ORT', ap, `Ort '${v}' gibt es nicht`);
    }
    if ((k === 'revealed' || k === 'found') && !HIDDEN_IDS.has(v)) E('REF-FUND', ap, `Fund '${v}' gibt es nicht`);
    if ((k === 'known' || k === 'visited') && !LOC_IDS.has(v)) E('REF-ORT', ap, `Ort '${v}' gibt es nicht`);
    if (k === 'elapsed' && isObj(v) && cfgValue(v) === undefined) E('REF-CFG', ap, `config-Wert '${v.cfg}' gibt es nicht`);
    if (k === 'choiceMade' && !ctx.choiceIds.has(v)) E('REF-ENTSCHEIDUNG', ap, `Entscheidung '${v}' gibt es nicht`);
  });

  // Entscheidungs-IDs missionsweit
  const choiceIds = new Set();
  for (const s of doc.steps) for (const cid of Object.keys(s.choices || {})) choiceIds.add(cid);

  // --- Aktionen
  const gotos = new Map(); // stepId -> Set(ziele)
  const completes = new Set();
  const wendungIds = new Map();
  const actionCheck = (a, ctx, p) => {
    if (a.do) {
      const args = Object.fromEntries(Object.entries(a).filter(([k]) => !['do', 'if', 'garantie', 'neu', 'wendung', 'ankuendigung', 'wirkung', 'once'].includes(k)));
      const def = paramCheck('aktion', a.do, args, `${p}.do(${a.do})`, ctx);
      if (def && def.effekt && !ctx.debug && !ctx.wendung && !ctx.inEnter) W('EFFEKT-OHNE-WENDUNG', p, `Spieleffekt '${a.do}' außerhalb von 'enter' sollte eine Wendung mit Ankündigung sein`);
      if (def && def.effekt && ctx.restartSensitive && !ctx.debug) E('NEUSTARTFEST', p, `Schritt kann angedockt gespeichert werden – Spieleffekt '${a.do}' beim Betreten wiederholt sich beim Laden`);
      if (a.do === 'force_choice' && !ctx.optionIds.has(a.option)) E('REF-ENTSCHEIDUNG', p, `Option '${a.option}' gibt es in diesem Schritt nicht`);
    }
    for (const atom of EFFECT_ATOMS) if (a[atom] && !ctx.debug) {
      if (!ctx.wendung && !ctx.inEnter) W('EFFEKT-OHNE-WENDUNG', p, `Spieleffekt '${atom}' außerhalb von 'enter' sollte eine Wendung sein`);
      if (ctx.restartSensitive) E('NEUSTARTFEST', p, `Spieleffekt '${atom}' beim Betreten eines speicherbaren Schritts`);
    }
    for (const f of TEXT_FIELDS_ACTION) if (a[f] !== undefined) textRef(a[f], `${p}.${f}`);
    if (a.radio) { textRef(a.radio.text, `${p}.radio.text`); npcRef(a.radio.from, `${p}.radio.from`); }
    if (a.title) textRef(a.title, `${p}.title`);
    if (a.text && !a.do) textRef(a.text, `${p}.text`);
    if (a.if !== undefined) condCheck(a.if, `${p}.if`, ctx);
    if (a.goto) { if (!stepIds.has(a.goto)) E('REF-SCHRITT', p, `Ziel-Schritt '${a.goto}' gibt es nicht`); if (ctx.stepId) gotos.get(ctx.stepId).add(a.goto); }
    if (a.complete) {
      const id = a.complete === true ? null : a.complete;
      if (id && !ausgaenge.has(id)) E('REF-AUSGANG', p, `Ausgang '${id}' gibt es nicht`);
      if (!id && ausgaenge.size !== 1) E('REF-AUSGANG', p, `'complete: true' ist nur eindeutig, wenn es genau einen Ausgang gibt`);
      completes.add(id || [...ausgaenge][0]);
      if (ctx.stepId) gotos.get(ctx.stepId).add('#complete');
    }
    if (a.choice && !ctx.choiceHere.has(a.choice)) E('REF-ENTSCHEIDUNG', p, `Entscheidung '${a.choice}' ist in diesem Schritt nicht definiert`);
    if (a.wendung) {
      if (wendungIds.has(a.wendung)) E('WENDUNG-DOPPELT', p, `Wendung '${a.wendung}' doppelt`);
      wendungIds.set(a.wendung, p);
      if (!a.ankuendigung) E('FAIRNESS', p, `Wendung '${a.wendung}' ohne Ankündigung`);
      else {
        if (a.ankuendigung.oda) textRef(a.ankuendigung.oda, `${p}.ankuendigung.oda`);
        if (!a.ankuendigung.oda && !a.ankuendigung.radio && a.ankuendigung.art !== 'sichtbar') E('FAIRNESS', p, `Ankündigung von '${a.wendung}' ohne ODA/Funk und nicht 'sichtbar'`);
      }
    }
  };

  // --- Schritte
  const opened = new Set();
  doc.steps.forEach((s, i) => {
    const sp = `steps[${i}:${s.id}]`;
    gotos.set(s.id, new Set());
    if (s.loc && !LOC_IDS.has(s.loc)) E('REF-ORT', `${sp}.loc`, `Ort '${s.loc}' gibt es nicht`);
    else if (s.loc && !orte.has(s.loc)) W('ORT-BUEHNE', `${sp}.loc`, `Ort '${s.loc}' fehlt in buehne.orte`);
    const choiceHere = new Set(Object.keys(s.choices || {}));
    const optionIds = new Set(Object.values(s.choices || {}).flatMap((c) => (c.options || []).map((o) => o.id)));
    // speicherbar = man kann in diesem Schritt angedockt sein
    let dockable = !!(s.loc && PORT_IDS.has(s.loc));
    for (const [, c] of stepConditions(s)) eachAtom(c, '', (k) => { if (k === 'docked') dockable = true; });
    for (const [lp, list] of stepActionLists(s)) {
      const debug = lp === 'skip';
      const inEnter = lp === 'enter';
      const restartSensitive = dockable && (inEnter || /^timers/.test(lp));
      eachAction(list, { stepId: s.id, debug, inEnter, restartSensitive, choiceHere, optionIds, choiceIds }, (a, ctx) => {
        actionCheck(a, ctx, `${sp}.${lp}`);
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
    // Garantien
    const mandatory = (s.objectives || []).filter((o) => !o.optional && o.done !== false);
    const marked = [].concat(s.timers || [], s.rules || [], s.next || []).some((x) => x.garantie)
      || (s.timers || []).some((t) => [].concat(t.do || []).some((a) => a.garantie))
      || (s.rules || []).some((r) => [].concat(r.do || []).some((a) => a.garantie));
    if (mandatory.length && !marked) E('GARANTIE', sp, 'Schritt mit Pflichtziel ohne Garantie (Hinweis, Zeitlimit oder Autolösung bei Stillstand)');
    if (!s.skip) W('SKIP', sp, 'kein skip (Debug/QA kann den Schritt nicht überspringen)');
  });
  for (const cid of choiceIds) if (!opened.has(cid)) W('ENTSCHEIDUNG-NIE', 'steps', `Entscheidung '${cid}' wird nie geöffnet`);

  // --- missionsweite Handler, Ausgänge, Debug
  for (const [ev, acts] of Object.entries(doc.on || {})) eachAction(acts, { stepId: null, choiceHere: new Set(), optionIds: new Set(), choiceIds }, (a, ctx) => actionCheck(a, ctx, `on.${ev}`));
  for (const [aid, ag] of Object.entries(doc.ausgaenge || {})) {
    for (const [k, f] of (ag.folgen || []).map((x) => Object.entries(x)[0])) {
      if (f && f.npc) npcRef(f.npc, `ausgaenge.${aid}.${k}`);
      if (f && f.text) textRef(f.text, `ausgaenge.${aid}.${k}.text`);
      if (k === 'chronik') textRef(f, `ausgaenge.${aid}.chronik`);
    }
    eachAction(ag.danach, { stepId: null, choiceHere: new Set(), optionIds: new Set(), choiceIds }, (a, ctx) => actionCheck(a, ctx, `ausgaenge.${aid}.danach`));
    if (!completes.has(aid)) W('AUSGANG-NIE', `ausgaenge.${aid}`, `Ausgang '${aid}' wird nie erreicht`);
  }
  if (doc.debug) {
    for (const [sid, acts] of Object.entries(doc.debug.prep || {})) {
      if (!stepIds.has(sid)) E('REF-SCHRITT', `debug.prep.${sid}`, `Schritt '${sid}' gibt es nicht`);
      eachAction(acts, { stepId: null, debug: true, choiceHere: new Set(), optionIds: new Set(), choiceIds }, (a, ctx) => actionCheck(a, ctx, `debug.prep.${sid}`));
    }
    eachAction(doc.debug.done, { stepId: null, debug: true, choiceHere: new Set(), optionIds: new Set(), choiceIds }, (a, ctx) => actionCheck(a, ctx, 'debug.done'));
  }
  if (doc.angebot && doc.angebot.nach) condCheck(doc.angebot.nach, 'angebot.nach', { choiceIds });

  // --- Ablauf: erreichbar, keine Sackgassen, Ende erreichbar
  const first = doc.steps[0] && doc.steps[0].id;
  const seen = new Set([first]); const todo = [first];
  while (todo.length) for (const t of gotos.get(todo.pop()) || []) if (t !== '#complete' && stepIds.has(t) && !seen.has(t)) { seen.add(t); todo.push(t); }
  for (const s of doc.steps) {
    if (!seen.has(s.id)) E('ABLAUF-UNERREICHBAR', `steps.${s.id}`, `Schritt '${s.id}' ist vom ersten Schritt aus nicht erreichbar`);
    if (!(gotos.get(s.id) || new Set()).size) E('ABLAUF-SACKGASSE', `steps.${s.id}`, `Schritt '${s.id}' hat keinen Ausgang (kein goto, kein complete)`);
  }
  const endReach = new Set(); let changed = true;
  while (changed) { changed = false; for (const [sid, ts] of gotos) if (!endReach.has(sid) && [...ts].some((t) => t === '#complete' || endReach.has(t))) { endReach.add(sid); changed = true; } }
  if (first && !endReach.has(first)) E('ABLAUF-KEIN-ENDE', 'steps', 'Vom ersten Schritt aus ist kein Missionsende erreichbar');
  for (const s of doc.steps) if (seen.has(s.id) && !endReach.has(s.id)) E('ABLAUF-KEIN-ENDE', `steps.${s.id}`, `Von '${s.id}' aus ist kein Missionsende erreichbar`);

  // --- Texte, die niemand benutzt
  for (const k of Object.keys(doc.texte)) if (!usedTexts.has(k)) W('TEXT-UNBENUTZT', `texte.${k}`, 'wird nirgends verwendet');

  return { errors, warnings };
}

// ---------------------------------------------------------------------------------------------------------------
// Selbsttest: die fünf kaputten Regiebücher aus der Abnahme (Briefing S1 §7.3), erzeugt aus m3
function selftest() {
  const base = JSON.parse(fs.readFileSync(path.join(CONCEPT, 'm3.regiebuch.json'), 'utf8'));
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
    ['Wendung ohne Ankündigung', 'FAIRNESS', (d) => { delete step(d, 'warden').enter[0].ankuendigung; }],
    ['Schritt ohne Garantie', 'GARANTIE', (d) => { step(d, 'tablet').timers = []; }],
    ['Spawn beim Betreten eines Hafen-Schritts', 'NEUSTARTFEST', (d) => { const s = step(d, 'briefing'); s.loc = 'hafen'; s.enter = [{ do: 'spawn_squad', map: 'kesh', squad: 'squad1' }]; }],
  ];
  let ok = 0;
  console.log('Selbsttest: m3 muss fehlerfrei sein, jede Mutation muss den erwarteten Fehler liefern.\n');
  const r0 = check(base);
  console.log(`${r0.errors.length ? '✗' : '✓'} m3 unverändert: ${r0.errors.length} Fehler, ${r0.warnings.length} Warnungen`);
  if (!r0.errors.length) ok++;
  for (const [name, code, mut] of cases) {
    const d = clone(); mut(d);
    const r = check(d); const hit = r.errors.find((e) => e.code === code);
    console.log(`${hit ? '✓' : '✗'} ${name}: ${hit ? `${code} – ${hit.msg}` : `erwartet ${code}, bekommen: ${r.errors.map((e) => e.code).join(', ') || 'keine Fehler'}`}`);
    if (hit) ok++;
  }
  console.log(`\n${ok}/${cases.length + 1} bestanden`);
  return ok === cases.length + 1;
}

// ---------------------------------------------------------------------------------------------------------------
function report(file, r, quiet) {
  const name = path.relative(ROOT, file);
  console.log(`${r.errors.length ? '✗' : '✓'} ${name}: ${r.errors.length} Fehler, ${r.warnings.length} Warnungen`);
  for (const e of r.errors) console.log(`  FEHLER  ${e.code.padEnd(26)} ${e.p}\n          ${e.msg}`);
  if (!quiet) for (const w of r.warnings) console.log(`  warnung ${w.code.padEnd(26)} ${w.p}\n          ${w.msg}`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) process.exit(selftest() ? 0 : 1);
  const quiet = args.includes('--quiet');
  let files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) {
    const dirs = [CONCEPT, path.join(ROOT, 'data', 'regiebuecher')];
    files = dirs.filter((d) => fs.existsSync(d)).flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.regiebuch.json') || (d.endsWith('regiebuecher') && f.endsWith('.json'))).map((f) => path.join(d, f)));
  }
  let bad = 0;
  for (const f of files) {
    let doc;
    try { doc = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.log(`✗ ${f}: kein gültiges JSON (${e.message})`); bad++; continue; }
    const r = check(doc); report(f, r, quiet);
    if (r.errors.length) bad++;
  }
  process.exit(bad ? 1 : 0);
}

module.exports = { check, validate };
