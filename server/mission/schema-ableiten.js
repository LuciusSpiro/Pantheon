'use strict';
// Szenen-Schema aus dem Katalog (SUND-03 B): ein strenges JSON-Schema für Ollama `format`, rein aus Daten abgeleitet
// (Katalog, Orte, NSC), nichts von Hand gepflegt. Ausgangspunkt war schema-strikt.js der Erkundung (Gemma 4 26B), angepasst an
// den heutigen Katalog (Parametertypen, vom Spiel gesetzte Parameter, Verzweigung, Wendung).
//
//   szenenSchema(katalog, { szene, npc, orte })   // szene = Szene des Grobplans; npc = [NSC-Ids]; orte = { <ortId>: { hidden: [{ id }] } }
//   szenenSchemaFuer(env, szene)                  // env = Szenenbau.buildEnv(katalog)
//
// Das Schema beschreibt die Antwort der Szene (`molekuele`, `verzweigung`, `wendung`), nicht das Regiebuch.
//   molekuele   genau die Moleküle/Umsetzungen der Szene in Reihenfolge (const), je Umsetzung die Parameter des Katalogs
//               (Typen, Aufzählungen, Zahlenbereiche; Pflichtparameter ohne Standard als required)
//   Parameter, die das Spiel setzt (Landepunkt `map`, Besetzung `fraktion`/`staerke`/`haltung`), sind nie Pflicht
//   Aktionslisten  setFlag | reward | pay_marks | radio | oda | log (wie im Systemprompt der Szene)
//   verzweigung    leer bei einem Ziel; sonst je Ziel des Grobplans ein Eintrag, Bedingung {flag} | {not:{flag}}
//   wendung        Objekt oder null, wenn der Grobplan eine Wendung vorsieht, sonst nur null
// Was ein JSON-Schema nicht ausdrückt (Flag wird gesetzt, Fakten, Sprecher), prüft weiter der Prüfer.

const S = { type: 'string' };
const VOM_SPIEL = new Set(['fraktion', 'staerke', 'haltung', 'besetzung', 'neue_rolle']);
const { hasWendung } = require('./szenenbau.js');

// NSC: bekannte Id oder neue Stimme `neu:Name`
function npcRef(npc) {
  const ids = [...new Set(npc || [])];
  return { anyOf: [{ type: 'string', enum: ids.length ? ids : ['tesk'] }, { type: 'string', pattern: '^neu:.+' }] };
}
function aktion(npc) {
  return { anyOf: [
    { type: 'object', required: ['setFlag'], properties: { setFlag: { type: 'object', additionalProperties: { const: true } } }, additionalProperties: false },
    { type: 'object', required: ['reward'], properties: { reward: { type: 'object', required: ['marks'], properties: { marks: { type: 'number' } }, additionalProperties: false } }, additionalProperties: false },
    { type: 'object', required: ['do', 'marks'], properties: { do: { const: 'pay_marks' }, marks: { type: 'number' } }, additionalProperties: false },
    { type: 'object', required: ['radio'], properties: { radio: { type: 'object', required: ['from', 'text'], properties: { from: npcRef(npc), text: S }, additionalProperties: false } }, additionalProperties: false },
    { type: 'object', required: ['oda'], properties: { oda: S }, additionalProperties: false },
    { type: 'object', required: ['log'], properties: { log: S }, additionalProperties: false },
  ] };
}
function paramSchema(d, ctx) {
  const s = ctx.szene;
  switch (d.typ) {
    case 'loc': return { const: s.ort };
    case 'npc': return npcRef(ctx.npc);
    case 'bool': return { type: 'boolean' };
    case 'zahl': {
      if (Array.isArray(d.werte) && d.werte.length) return { type: 'number', enum: d.werte };
      const o = { type: 'number' };
      if (Number.isFinite(d.min)) o.minimum = d.min;
      if (Number.isFinite(d.max)) o.maximum = d.max;
      return o;
    }
    case 'find': {
      const o = ctx.orte && ctx.orte[s.ort];
      const ids = o && Array.isArray(o.hidden) ? o.hidden.map((h) => h.id) : [];
      return ids.length ? { type: 'string', enum: ids } : S;
    }
    case 'aktionen': return { type: 'array', items: aktion(ctx.npc) };
    case 'map': case 'landepunkt': case 'text': case 'kind': default:
      return Array.isArray(d.werte) && d.werte.length ? { type: 'string', enum: d.werte } : S;
  }
}
function umsetzungSchema(katalog, m, ctx) {
  const mol = katalog.molekuele[m.id];
  const u = mol && mol.umsetzungen.find((x) => x.id === m.umsetzung);
  if (!u) throw new Error(`Umsetzung ${m.id}/${m.umsetzung} fehlt im Katalog`);
  const props = {}; const req = [];
  for (const [n, d] of Object.entries(u.params || {})) {
    props[n] = paramSchema(d, ctx);
    if (d.pflicht && d.default === undefined && d.typ !== 'map' && d.typ !== 'landepunkt' && !VOM_SPIEL.has(n)) req.push(n);
  }
  return { type: 'object', required: ['id', 'umsetzung', 'params'], additionalProperties: false,
    properties: { id: { const: m.id }, umsetzung: { const: m.umsetzung }, params: { type: 'object', required: req, properties: props, additionalProperties: false } } };
}

function szenenSchema(katalog, kontext) {
  const ctx = kontext || {};
  const s = ctx.szene;
  if (!katalog || !s || !Array.isArray(s.molekuele)) throw new Error('szenenSchema braucht Katalog und eine Grobplan-Szene mit Molekülen');
  const items = s.molekuele.map((m) => umsetzungSchema(katalog, m, ctx));
  const ziele = [...new Set((s.weiter || []).map((w) => String(w.nach || '')).filter(Boolean))];
  const flag = { type: 'string', pattern: '^[a-z][a-z0-9_]*$' };
  const bedingung = { anyOf: [
    { type: 'object', required: ['flag'], properties: { flag }, additionalProperties: false },
    { type: 'object', required: ['not'], properties: { not: { type: 'object', required: ['flag'], properties: { flag }, additionalProperties: false } }, additionalProperties: false },
  ] };
  const verzweigung = ziele.length > 1
    ? { type: 'array', minItems: ziele.length, maxItems: ziele.length, items: { type: 'object', required: ['nach'], additionalProperties: false, properties: { nach: { type: 'string', enum: ziele }, if: bedingung } } }
    : { type: 'array', maxItems: 0 };
  // Wendung nur, wenn der Grobplan eine vorsieht; weglassen (null) bleibt erlaubt, der Prüfer entscheidet, ob das genügt
  const wendungObjekt = { type: 'object', required: ['kennung', 'nach_s', 'ankuendigung', 'wirkung'], additionalProperties: false,
    properties: { kennung: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' }, nach_s: { type: 'number', minimum: 20, maximum: 120 }, ankuendigung: S, wirkung: { type: 'array', minItems: 1, items: aktion(ctx.npc) } } };
  const wendung = hasWendung(s) ? { anyOf: [{ type: 'null' }, wendungObjekt] } : { type: 'null' };
  return { type: 'object', required: ['molekuele', 'verzweigung', 'wendung'], additionalProperties: false, properties: {
    molekuele: { type: 'array', minItems: items.length, maxItems: items.length, prefixItems: items },
    verzweigung, wendung,
  } };
}

// env = Szenenbau.buildEnv(katalog): Katalog, NSC-Liste und Orte (LOC) kommen daraus
function szenenSchemaFuer(env, szene) {
  return szenenSchema(env.katalog, { szene, npc: env.npc, orte: env.LOC });
}

module.exports = { szenenSchema, szenenSchemaFuer, hasWendung };
