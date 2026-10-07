// Mini-JSON-Validator für Claude-generierte Teaser-Missionen (CONTRACT.md §8). UMD: window.Shared_Schema / require.
// Unterstützt nur, was wir brauchen: type object/string/integer/number, required, maxLength, minimum, maximum,
// additionalProperties:false. clamp() kürzt Strings und klemmt Zahlen, statt nur abzulehnen.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared_Schema = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MISSION_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'from', 'briefing', 'reward', 'hook'],
    properties: {
      title: { type: 'string', maxLength: 60 },
      from: { type: 'string', maxLength: 40 },
      briefing: { type: 'string', maxLength: 500 },
      reward: { type: 'integer', minimum: 50, maximum: 500 },
      hook: { type: 'string', maxLength: 200 },
    },
  };

  function typeOk(type, v) {
    if (type === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v);
    if (type === 'string') return typeof v === 'string';
    if (type === 'integer') return typeof v === 'number' && Number.isInteger(v);
    if (type === 'number') return typeof v === 'number' && Number.isFinite(v);
    if (type === 'boolean') return typeof v === 'boolean';
    if (type === 'array') return Array.isArray(v);
    return true;
  }

  // Strenge Prüfung: { ok, errors: [string] }
  function validate(schema, value, path) {
    const errors = [];
    const p = path || '$';
    if (!typeOk(schema.type, value)) { errors.push(`${p}: erwartet ${schema.type}`); return { ok: false, errors }; }
    if (schema.type === 'string' && schema.maxLength != null && value.length > schema.maxLength) errors.push(`${p}: länger als ${schema.maxLength}`);
    if ((schema.type === 'integer' || schema.type === 'number')) {
      if (schema.minimum != null && value < schema.minimum) errors.push(`${p}: kleiner als ${schema.minimum}`);
      if (schema.maximum != null && value > schema.maximum) errors.push(`${p}: größer als ${schema.maximum}`);
    }
    if (schema.type === 'object') {
      for (const k of schema.required || []) if (!(k in value)) errors.push(`${p}.${k}: fehlt`);
      for (const k of Object.keys(value)) {
        const sub = schema.properties && schema.properties[k];
        if (!sub) { if (schema.additionalProperties === false) errors.push(`${p}.${k}: nicht erlaubt`); continue; }
        errors.push(...validate(sub, value[k], `${p}.${k}`).errors);
      }
    }
    return { ok: errors.length === 0, errors };
  }

  // Tolerante Variante: kürzt/klemmt/rundet. Gibt { ok, value, errors } zurück; ok=false nur bei fehlenden/falschen Typen.
  function clamp(schema, value) {
    if (!typeOk('object', value)) return { ok: false, value: null, errors: ['kein Objekt'] };
    const out = {}; const errors = [];
    for (const k of Object.keys(schema.properties)) {
      const sub = schema.properties[k];
      let v = value[k];
      if (v == null) { if ((schema.required || []).includes(k)) errors.push(`${k}: fehlt`); continue; }
      if (sub.type === 'string') {
        if (typeof v !== 'string') v = String(v);
        v = v.replace(/\s+/g, ' ').trim();
        if (sub.maxLength != null && v.length > sub.maxLength) v = v.slice(0, sub.maxLength - 1).trimEnd() + '…';
        if (!v.length && (schema.required || []).includes(k)) errors.push(`${k}: leer`);
      } else if (sub.type === 'integer' || sub.type === 'number') {
        v = Number(v);
        if (!Number.isFinite(v)) { errors.push(`${k}: keine Zahl`); continue; }
        if (sub.type === 'integer') v = Math.round(v);
        if (sub.minimum != null) v = Math.max(sub.minimum, v);
        if (sub.maximum != null) v = Math.min(sub.maximum, v);
      }
      out[k] = v;
    }
    return { ok: errors.length === 0, value: out, errors };
  }

  // M4 Stufe 1 (CONTRACT-M4 §2.4): Form der neuen, optionalen Snapshot-Felder (für Tests/Tools; der Server prüft sie nicht).
  const LIFT_SNAPSHOT_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['to', 't', 'T'],
    properties: { to: { type: 'integer', minimum: 0, maximum: 1 }, t: { type: 'number', minimum: 0 }, T: { type: 'number', minimum: 0 } },
  };
  const LADDER_SNAPSHOT_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['t', 'T'],
    properties: { t: { type: 'number', minimum: 0 }, T: { type: 'number', minimum: 0 } },
  };

  return { MISSION_SCHEMA, LIFT_SNAPSHOT_SCHEMA, LADDER_SNAPSHOT_SCHEMA, validate, clamp };
});
