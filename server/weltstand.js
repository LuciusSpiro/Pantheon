'use strict';
// Weltstand (CONTRACT-S1 §5): Speicherstand einer Kampagne. Ablage als JSON in WORLD_DIR (Standard data/worlds),
// atomar geschrieben (tmp + fsync + rename, vorher alte Datei -> <id>.bak.json). Laden wirft nie.
// Laufzeit-Weltstand game.weltstand (§5.4): NSC, Chronik, Fakten, Tutorial-Status + Methoden für die Bausteine.
const fs = require('fs');
const path = require('path');
const Locations = require('../shared/locations.js');

const ROOT = path.join(__dirname, '..');
const VERSION = 3;   // B1–B3: welt.landepunkte, welt.wracks, welt.sektoren, crew (v2 -> v3 per MIGRATIONS[2]); S2: spielleiter (v1 -> v2)
const MAX = 5;
const SCHEMA_FILE = path.join(ROOT, 'content', 'schema', 'weltstand.schema.json');
const NPC_FILE = path.join(ROOT, 'content', 'npc.json');
const ID_RE = /^[a-z0-9-]{4,40}$/;
const NPC_STATES = ['lebt', 'verwundet', 'verletzt', 'gefangen', 'tot', 'verschwunden', 'vermisst', 'unbekannt', 'befoerdert', 'uebergelaufen'];
const SYSTEM_ORDER = ['reactor', 'engines', 'shields', 'life', 'transfer', 'thruster_port', 'thruster_stbd',
  'emitter_bow', 'emitter_stbd', 'emitter_aft', 'emitter_port', 'weapon_bow', 'battery_port', 'battery_stbd'];
const TUTORIAL_MISSIONS = ['m1', 'm2', 'm3'];
const CHRONIK_KEEP = 200;

// ---------- B1–B3 (CONTRACT-B1 §8): Blöcke anderer Teams ----------
// Die Inhalte gehören den Modulen (toSave/restore), der Weltstand trägt sie nur ein. Aufrufkonvention für alle:
//   mod.toSave(game) -> Block      mod.restore(block, game)
// Fehlt ein Modul oder ist es noch der Welle-0-Stub (stub: true), bleibt der zuletzt geladene Block unverändert erhalten
// (ws.data.bloecke) – ein Stand verliert also keine Daten, nur weil ein Team noch nicht geliefert hat.
const BLOCK_MODS = {
  landepunkte: './sim/landepunkte.js',   // welt.landepunkte (BUEHNE)
  wracks: './sim/entern.js',             // welt.wracks (ENTERN)
  waffen: './sim/waffen.js',             // crew.waffen (WAFFEN)
  sektoren: './sim/sprung.js',           // welt.sektoren (SEKTOR; alternativ explore.toSave().sektoren / explore.restore(welt))
};
const BLOCK_DEFAULTS = { landepunkte: () => ({}), wracks: () => [], waffen: () => ({}), sektoren: () => ({ erkundet: [], bojen: [], temp: [], offen: [] }) };
const modCache = {};
function blockMod(key) {
  if (key in modCache) return modCache[key];
  let m = null;
  try { m = require(BLOCK_MODS[key]); } catch (e) {
    if (!(e && e.code === 'MODULE_NOT_FOUND' && String(e.message).includes(path.basename(BLOCK_MODS[key])))) console.warn('[Pantheon] Weltstand-Block ' + key + ':', e && e.message);
    m = null;
  }
  modCache[key] = m;
  return m;
}
const blockLive = (m, fn) => !!(m && !m.stub && typeof m[fn] === 'function');
let sektorenMod;   // undefined = noch nicht gesucht
function sektoren() {
  if (sektorenMod === undefined) { try { sektorenMod = require('../shared/sektoren.js'); } catch (e) { sektorenMod = null; } }
  return sektorenMod && sektorenMod.KARTE ? sektorenMod : null;
}
const uniq = (a) => [...new Set(a)];
// B3 §5 Migration v2 -> v3: Erkundungsstand aus den Orten. erkundet = Hexe aller besuchten Orte; bojen = open/locked-Kanten
// zwischen zwei bekannten Orten; offen = Kanten zu den Schlüsseln aus verbindungen_offen. Ohne shared/sektoren.js leer
// (apply leitet dann beim Laden nach, sobald die Sektorkarte da ist).
function sektorenAusOrten(welt) {
  const out = { erkundet: [], bojen: [], temp: [], offen: [] };
  const S = sektoren();
  if (!S) return out;
  const w = welt || {}; const orte = w.orte || {};
  const hex = (id) => { try { return (typeof S.hexVonOrt === 'function' && S.hexVonOrt(id)) || null; } catch (e) { return null; } };
  const kid = (a, b) => (typeof S.kanteId === 'function' ? S.kanteId(a, b) : [a, b].sort().join('-'));
  const bekannt = new Set([...(orte.bekannt || []), ...(orte.besucht || [])].map(hex).filter(Boolean));
  out.erkundet = uniq((orte.besucht || []).map(hex).filter(Boolean));
  const keys = new Set(w.verbindungen_offen || []);
  for (const k of (S.KARTE && S.KARTE.kanten) || []) {
    if (!k || !k.a || !k.b) continue;
    const id = kid(k.a, k.b);
    if ((k.art === 'open' || k.art === 'locked') && bekannt.has(k.a) && bekannt.has(k.b)) out.bojen.push(id);
    if (k.key && keys.has(k.key)) out.offen.push(id);
  }
  out.bojen = uniq(out.bojen); out.offen = uniq(out.offen);
  return out;
}
function normSektoren(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return { erkundet: [], bojen: [], temp: [], offen: [] };
  const strs = (a) => (Array.isArray(a) ? uniq(a.filter((v) => typeof v === 'string')) : []);
  return Object.assign({}, x, { erkundet: strs(x.erkundet), bojen: strs(x.bojen), offen: strs(x.offen),
    temp: Array.isArray(x.temp) ? x.temp.filter((t) => t && typeof t === 'object' && !Array.isArray(t)) : [] });
}

// Migrationskette: MIGRATIONS[n](data) hebt Version n auf n + 1.
const MIGRATIONS = {
  // S2 (CONTRACT-S2 §3.2): v1 (S1) bekommt einen leeren Spielleiter-Block
  1: (data) => Object.assign({}, data, { version: 2, spielleiter: Object.assign({}, data.spielleiter || {}) }),
  // B1–B3 (CONTRACT-B1 §8, B3 §5): leere Blöcke landepunkte/wracks/crew, Sektoren aus den Orten abgeleitet. orte.* bleibt.
  2: (data) => {
    const welt = Object.assign({}, data.welt || {});
    if (!welt.landepunkte || typeof welt.landepunkte !== 'object' || Array.isArray(welt.landepunkte)) welt.landepunkte = {};
    if (!Array.isArray(welt.wracks)) welt.wracks = [];
    welt.sektoren = welt.sektoren ? normSektoren(welt.sektoren) : sektorenAusOrten(welt);
    const crew = Object.assign({ waffen: {}, rollen_gesehen: [] }, data.crew || {});
    return Object.assign({}, data, { version: 3, welt, crew });
  },
};
// Block 'spielleiter' (§3.2): { plaene: { <missionId>: { grobplan, anlass, origin, szenen, buch } }, archiv_gespielt: [],
// zusammenfassung: [{ id, titel, auftraggeber, ausgang }], naechste_id }. Inhalt gehört dem Spielleiter (toSave/restore).
function spielleiterSave(game) {
  const sl = game.spielleiter;
  if (!sl || typeof sl.toSave !== 'function') return {};
  try { const r = sl.toSave(); return r && typeof r === 'object' && !Array.isArray(r) ? clone(r) : {}; } catch (e) { countError(game, 'weltstand-spielleiter', e); return {}; }
}

// ---------- Hilfen ----------
const clone = (o) => JSON.parse(JSON.stringify(o));
function countError(game, where, err) {
  if (game && typeof game.countError === 'function') game.countError(where, err);
  else console.warn('[Pantheon] Fehler in ' + where + ':', err && err.message ? err.message : err);
}
function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (e) { /* egal */ }
}
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
}
function ddmm(d) { return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.'; }

let schemaCache = null;
function schema() {
  if (!schemaCache) { try { schemaCache = readJson(SCHEMA_FILE); } catch (e) { schemaCache = { type: 'object' }; console.warn('[Pantheon] Weltstand-Schema nicht lesbar:', e.message); } }
  return schemaCache;
}

// ---------- Schema-Prüfung ----------
// Kleiner JSON-Schema-Prüfer (Teilmenge: type, const, enum, required, properties, additionalProperties, items,
// minimum, maximum, maxLength, minLength, pattern, minItems, maxItems). Rückgabe: Liste von Fehlertexten.
function typeOk(v, t) {
  switch (t) {
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'array': return Array.isArray(v);
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'integer': return Number.isInteger(v);
    case 'boolean': return typeof v === 'boolean';
    case 'null': return v === null;
    default: return true;
  }
}
function fallbackValidate(v, s, p, out) {
  p = p || '$'; out = out || [];
  if (!s || typeof s !== 'object' || out.length > 20) return out;
  if (s.type) { const ts = Array.isArray(s.type) ? s.type : [s.type]; if (!ts.some((t) => typeOk(v, t))) { out.push(`${p}: erwartet ${ts.join('|')}`); return out; } }
  if ('const' in s && v !== s.const) out.push(`${p}: muss ${JSON.stringify(s.const)} sein`);
  if (s.enum && !s.enum.includes(v)) out.push(`${p}: unbekannter Wert ${JSON.stringify(v)}`);
  if (typeof v === 'number') {
    if (s.minimum != null && v < s.minimum) out.push(`${p}: kleiner als ${s.minimum}`);
    if (s.maximum != null && v > s.maximum) out.push(`${p}: größer als ${s.maximum}`);
  }
  if (typeof v === 'string') {
    if (s.maxLength != null && v.length > s.maxLength) out.push(`${p}: länger als ${s.maxLength} Zeichen`);
    if (s.minLength != null && v.length < s.minLength) out.push(`${p}: kürzer als ${s.minLength} Zeichen`);
    if (s.pattern && !new RegExp(s.pattern).test(v)) out.push(`${p}: passt nicht zu ${s.pattern}`);
  }
  if (Array.isArray(v)) {
    if (s.maxItems != null && v.length > s.maxItems) out.push(`${p}: mehr als ${s.maxItems} Einträge`);
    if (s.minItems != null && v.length < s.minItems) out.push(`${p}: weniger als ${s.minItems} Einträge`);
    if (s.items) v.forEach((x, i) => fallbackValidate(x, s.items, `${p}[${i}]`, out));
  }
  if (typeOk(v, 'object')) {
    for (const k of s.required || []) if (!(k in v)) out.push(`${p}: Pflichtfeld ${k} fehlt`);
    const props = s.properties || {};
    for (const [k, x] of Object.entries(v)) {
      if (props[k]) fallbackValidate(x, props[k], `${p}.${k}`, out);
      else if (s.additionalProperties === false) out.push(`${p}: unbekanntes Feld ${k}`);
      else if (s.additionalProperties && typeof s.additionalProperties === 'object') fallbackValidate(x, s.additionalProperties, `${p}.${k}`, out);
    }
  }
  return out;
}
// Fehler aus Checker.validate: Text, [pfad, text] oder { p|path, msg|message|code }
function fmtErr(e) {
  if (typeof e === 'string') return e;
  if (Array.isArray(e)) return `${e[0] || '$'}: ${e[1] || 'ungültig'}`;
  return `${(e && (e.p || e.path)) || '$'}: ${(e && (e.msg || e.message || e.code)) || 'ungültig'}`;
}
// Missionsteil normalisieren: Vertragsform (= mission.toSave()) oder Altform (Missions-ID -> Status, beispiel.json)
function missionsOf(data) {
  const m = data && data.missionen;
  if (m && m.missionen && typeof m.missionen === 'object') return m;
  const map = m && typeof m === 'object' ? m : {};
  const aktiv = Object.keys(map).find((id) => map[id] && map[id].status === 'aktiv') || null;
  return { missionen: map, aktiv, flags: (data && data.welt && data.welt.flags) || {}, buchFokus: null };
}
let checkerMod;   // undefined = noch nicht gesucht, null = nicht vorhanden
function checker() {
  if (checkerMod === undefined) {
    try { const m = require('./mission/checker.js'); checkerMod = m && (m.Checker || m); if (!checkerMod || typeof checkerMod.validate !== 'function') checkerMod = null; } catch (e) { checkerMod = null; }
  }
  return checkerMod;
}
// -> Liste von Fehlertexten (leer = gültig). Nutzt Checker.validate (ENGINE), sonst den eigenen Prüfer. Wirft nie.
function validate(data, game) {
  const C = checker();
  if (C) {
    try {
      const r = C.validate(data, schema());
      if (Array.isArray(r)) return r.map((e) => fmtErr(e));
      if (r === true || r == null) return [];
      if (r === false) return ['ungültig'];
      if (typeof r === 'object') {
        const errs = Array.isArray(r.errors) ? r.errors : [];
        if (r.ok === false && !errs.length) return ['ungültig'];
        return errs.map((e) => fmtErr(e));
      }
    } catch (e) { countError(game, 'weltstand-validate', e); }
  }
  try { return fallbackValidate(data, schema()); } catch (e) { countError(game, 'weltstand-validate', e); return ['Prüfung fehlgeschlagen: ' + e.message]; }
}

// ---------- Ablage ----------
function dir(env) {
  const e = env || process.env;
  const d = e && typeof e.WORLD_DIR === 'string' && e.WORLD_DIR.trim() ? e.WORLD_DIR.trim() : path.join('data', 'worlds');
  return path.resolve(ROOT, d);
}
const mainFile = (d, id) => path.join(d, id + '.json');
const bakFile = (d, id) => path.join(d, id + '.bak.json');
const lockFile = (d, id) => path.join(d, id + '.lock');

// Datei lesen + migrieren + prüfen -> { ok, data?, state?, grund? }
function readChecked(file, game) {
  let data;
  try { data = readJson(file); } catch (e) {
    if (e.code === 'ENOENT') return { ok: false, state: 'fehlt', grund: 'Datei fehlt.' };
    return { ok: false, state: 'kaputt', grund: e instanceof SyntaxError ? 'Die Datei ist unvollständig oder beschädigt (kein gültiges JSON).' : 'Die Datei ist nicht lesbar (' + (e.code || e.message) + ').' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, state: 'kaputt', grund: 'Die Datei enthält keinen Weltstand.' };
  const v = Number(data.version);
  if (Number.isFinite(v) && v > VERSION) return { ok: false, state: 'neuer', grund: `Gespeichert mit einer neueren Spielversion (Format ${v}).` };
  try {
    for (let n = Number.isFinite(v) ? v : VERSION; n < VERSION; n++) { if (!MIGRATIONS[n]) throw new Error('keine Migration ab Version ' + n); data = MIGRATIONS[n](data); }
  } catch (e) { return { ok: false, state: 'kaputt', grund: 'Altes Format lässt sich nicht übernehmen (' + e.message + ').' }; }
  const errs = validate(data, game);
  if (errs.length) return { ok: false, state: 'kaputt', grund: 'Der Weltstand passt nicht zum Format (' + errs[0] + ').', errors: errs };
  return { ok: true, data };
}

// -> { pid, port } | null
function readLock(d, id) { try { return readJson(lockFile(d, id)); } catch (e) { return null; } }
// gesperrt = Sperrdatei eines anderen, noch laufenden Prozesses
function lockedByOther(d, id) {
  const l = readLock(d, id);
  return !!(l && l.pid !== process.pid && pidAlive(l.pid));
}

function summary(id, data, state, grund) {
  const ms = data ? missionsOf(data) : null; const aktiv = ms && ms.aktiv ? ms.aktiv : null;
  const mi = aktiv && ms.missionen[aktiv];
  const ch = data && Array.isArray(data.chronik) && data.chronik.length ? data.chronik[data.chronik.length - 1].text : null;
  const o = {
    id, name: (data && data.name) || id, savedAt: (data && data.gespeichert) || null, playTime: Math.round((data && data.spielzeit_s) || 0),
    loc: (data && data.ort && data.ort.angedockt) || null, mission: aktiv, step: (mi && mi.schritt) || null,
    chronikLast: ch ? String(ch).slice(0, 120) : null, spieler: (data && data.meta && Array.isArray(data.meta.spieler)) ? data.meta.spieler.slice(0, 3) : [],
    state,
  };
  if (grund) o.grund = grund;
  return o;
}

// -> [{ id, name, savedAt, playTime, loc, mission, step, chronikLast, spieler, state, grund? }], neueste zuerst
function list(d, game) {
  let files;
  try { files = fs.readdirSync(d); } catch (e) { return []; }
  const ids = new Map();   // id -> { main, bak, kaputt: [name] }
  for (const f of files) {
    let m, id, kind;
    if ((m = /^(.+)\.bak\.json$/.exec(f))) { id = m[1]; kind = 'bak'; }
    else if ((m = /^(.+)\.kaputt-(\d+)\.json$/.exec(f))) { id = m[1]; kind = 'kaputt'; }
    else if ((m = /^([a-z0-9-]+)\.json$/.exec(f))) { id = m[1]; kind = 'main'; }
    else continue;
    if (!ID_RE.test(id)) continue;
    const e = ids.get(id) || { main: false, bak: false, kaputt: [] };
    if (kind === 'kaputt') e.kaputt.push(f); else e[kind] = true;
    ids.set(id, e);
  }
  const out = [];
  for (const [id, e] of ids) {
    let r = e.main ? readChecked(mainFile(d, id), game) : { ok: false, state: 'fehlt' };
    if (!r.ok && r.state !== 'neuer' && e.bak) {
      const b = readChecked(bakFile(d, id), game);
      if (b.ok) r = b;
    }
    let item;
    if (r.ok) item = summary(id, r.data, 'ok');
    else if (r.state === 'neuer') item = summary(id, null, 'neuer', r.grund);
    else if (r.state === 'kaputt') item = summary(id, null, 'kaputt', r.grund);
    else if (e.kaputt.length) {
      const ts = Math.max(...e.kaputt.map((f) => Number(/kaputt-(\d+)/.exec(f)[1]) || 0));
      item = summary(id, null, 'kaputt', 'Die Datei war beschädigt und wurde beiseitegelegt.');
      item.savedAt = ts ? new Date(ts).toISOString() : null;
    } else continue;
    if (item.state === 'ok' && lockedByOther(d, id)) { item.state = 'belegt'; item.grund = 'Gerade in einer anderen Runde geöffnet.'; }
    out.push(item);
  }
  out.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
  return out;
}

// -> { ok, data?, error?, state?, fromBak? }  nie throw
function load(d, id, game) {
  try {
    if (typeof id !== 'string' || !ID_RE.test(id)) return { ok: false, error: 'Unbekannter Weltstand.', state: 'fehlt' };
    const main = mainFile(d, id);
    const r = readChecked(main, game);
    if (r.ok) return { ok: true, data: r.data };
    if (r.state === 'neuer') return { ok: false, error: r.grund, state: 'neuer' };
    const b = readChecked(bakFile(d, id), game);
    if (r.state === 'kaputt') {
      // kaputte Hauptdatei beiseitelegen: <id>.kaputt-<ts>.json
      try { fs.renameSync(main, path.join(d, `${id}.kaputt-${Date.now()}.json`)); } catch (e) { countError(game, 'weltstand-kaputt-rename', e); }
      if (game && game.log) game.log(`Weltstand ${id} beschädigt: ${r.grund}${b.ok ? ' – Sicherung (.bak) wird genutzt.' : ''}`);
    }
    if (b.ok) return { ok: true, data: b.data, fromBak: true };
    if (b.state === 'neuer') return { ok: false, error: b.grund, state: 'neuer' };
    return { ok: false, error: r.state === 'fehlt' ? 'Weltstand nicht gefunden.' : r.grund, state: r.state === 'fehlt' ? 'fehlt' : 'kaputt' };
  } catch (e) {
    countError(game, 'weltstand-load', e);
    return { ok: false, error: 'Laden fehlgeschlagen (' + e.message + ').', state: 'kaputt' };
  }
}

function withRetry(fn) {
  for (let i = 0; ; i++) {
    try { return fn(); } catch (e) {
      if (i >= 2 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      sleepSync(30 * (i + 1));
    }
  }
}

// Atomar schreiben: tmp + fsync + rename; vorher gültige alte Datei -> <id>.bak.json
function writeAtomic(d, id, data) {
  fs.mkdirSync(d, { recursive: true });
  const main = mainFile(d, id);
  const tmp = main + '.' + process.pid + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, JSON.stringify(data, null, 1)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try {
    let oldOk = false;
    try { readJson(main); oldOk = true; } catch (e) { oldOk = false; }
    if (oldOk) withRetry(() => fs.copyFileSync(main, bakFile(d, id)));
    withRetry(() => fs.renameSync(tmp, main));
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) { /* egal */ }
    throw e;
  }
}

// -> { ok, error?, ms?, captureMs?, unchanged?, pending? }. opts.ifChanged: nur schreiben, wenn sich der Inhalt geändert hat.
// opts.async: Erfassen + Prüfen jetzt (Zustand des Ticks, < 1 ms), Schreiben per setImmediate (Platte unter Windows
// 5–15 ms); Ergebnis dann über opts.onDone(result). Ohne async wird synchron geschrieben.
function save(game, opts) {
  const o = opts || {};
  const ws = game && game.weltstand;
  if (!ws || !ws.persistent) return { ok: false, error: 'Kein Kampagnen-Weltstand.' };
  const t0 = performance.now();
  let data, key;
  try {
    data = capture(game);
    key = JSON.stringify(Object.assign({}, data, { gespeichert: null, spielzeit_s: null, meta: null }));
    if (o.ifChanged && key === ws.lastKey) return { ok: true, unchanged: true, ms: 0 };
    const errs = validate(data, game);
    if (errs.length) {
      countError(game, 'weltstand-capture', new Error(errs.slice(0, 3).join('; ')));
      return { ok: false, error: 'Der Weltstand passt nicht zum Format (' + errs[0] + ').' };
    }
  } catch (e) {
    countError(game, 'weltstand-capture', e);
    return { ok: false, error: 'Erfassen fehlgeschlagen (' + e.message + ').' };
  }
  const captureMs = Math.round((performance.now() - t0) * 100) / 100;
  const d = ws.dir || dir(game.env); const id = ws.id;
  ws.lastKey = key;
  const seq = ws.saveSeq = (ws.saveSeq || 0) + 1;
  const write = () => {
    // ein späterer (synchroner) Stand ist schon geschrieben -> diesen älteren nicht mehr darüberlegen
    if (seq < (ws.writtenSeq || 0)) return { ok: true, superseded: true, ms: 0, captureMs, loc: data.ort.angedockt };
    const t1 = performance.now();
    try {
      writeAtomic(d, id, data);
      ws.writtenSeq = seq;
      ws.savedAt = data.gespeichert;
      return { ok: true, ms: Math.round((performance.now() - t1) * 100) / 100, captureMs, loc: data.ort.angedockt };
    } catch (e) {
      if (ws.lastKey === key) ws.lastKey = null;   // beim nächsten Mal wieder versuchen
      countError(game, 'weltstand-save', e);
      return { ok: false, error: 'Schreiben fehlgeschlagen (' + (e.code || e.message) + ').' };
    }
  };
  if (o.async) {
    setImmediate(() => { const r = write(); if (typeof o.onDone === 'function') { try { o.onDone(r); } catch (e) { countError(game, 'weltstand-save', e); } } });
    return { ok: true, pending: true, captureMs, loc: data.ort.angedockt };
  }
  return write();
}

// Datei + .bak (+ beiseitegelegte kaputte Dateien) löschen. -> { ok, error?, code? }
function remove(d, id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return { ok: false, error: 'Unbekannter Weltstand.' };
  if (lockedByOther(d, id)) return { ok: false, code: 'worldbusy', error: 'Dieser Weltstand ist gerade in einer anderen Runde geöffnet.' };
  let n = 0;
  let files = [];
  try { files = fs.readdirSync(d); } catch (e) { return { ok: false, error: 'Ordner nicht lesbar.' }; }
  for (const f of files) {
    if (f === id + '.json' || f === id + '.bak.json' || f === id + '.lock' || (f.startsWith(id + '.kaputt-') && f.endsWith('.json'))) {
      try { withRetry(() => fs.unlinkSync(path.join(d, f))); n++; } catch (e) { return { ok: false, error: 'Löschen fehlgeschlagen (' + (e.code || e.message) + ').' }; }
    }
  }
  return n ? { ok: true } : { ok: false, error: 'Weltstand nicht gefunden.' };
}

// <id>.lock mit { pid, port }. Verwaist (pid läuft nicht mehr oder Datei unlesbar) -> wird übernommen.
function lock(d, id, info) {
  try {
    fs.mkdirSync(d, { recursive: true });
    const body = JSON.stringify(Object.assign({ pid: process.pid, port: null, at: new Date().toISOString() }, info || {}, { pid: process.pid }));
    const f = lockFile(d, id);
    try { fs.writeFileSync(f, body, { flag: 'wx' }); return { ok: true }; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const l = readLock(d, id);
    if (l && l.pid !== process.pid && pidAlive(l.pid)) return { ok: false, code: 'worldbusy', error: 'Dieser Weltstand ist gerade in einer anderen Runde geöffnet.' };
    withRetry(() => fs.writeFileSync(f, body));
    return { ok: true, stale: true };
  } catch (e) { return { ok: false, error: 'Sperre nicht möglich (' + (e.code || e.message) + ').' }; }
}
function unlock(d, id) {
  try {
    const l = readLock(d, id);
    if (l && l.pid !== process.pid && pidAlive(l.pid)) return false;   // fremde Sperre nicht anfassen
    fs.unlinkSync(lockFile(d, id));
    return true;
  } catch (e) { return false; }
}

// ---------- NSC-Startwerte (content/npc.json, DATEN) ----------
let npcWarned = false;
// count: fehlende/kaputte Datei als Fehler zählen (Kampagne mit Ablage); sonst nur einmal je Prozess loggen
function readNpcFile(game, count) {
  try { return readJson(NPC_FILE); } catch (e) {
    const err = e.code === 'ENOENT' ? new Error('content/npc.json fehlt – NSC-Liste leer') : e;
    if (count !== false) countError(game, 'weltstand-npc', err);
    else if (!npcWarned) { npcWarned = true; console.warn('[Pantheon] ' + err.message); }
    return null;
  }
}
function npcStartValues(game, file) {
  const C = game && game.C && game.C.weltstand || {};
  const lo = Number.isFinite(C.attitudeMin) ? C.attitudeMin : -3, hi = Number.isFinite(C.attitudeMax) ? C.attitudeMax : 3;
  const out = {};
  const src = file && file.npc && typeof file.npc === 'object' ? file.npc : {};
  for (const [id, n] of Object.entries(src)) {
    if (!n || typeof n !== 'object') continue;
    const status = NPC_STATES.includes(n.status) ? n.status : 'lebt';
    if (n.status != null && status !== n.status) countError(game, 'weltstand-npc', new Error(`NSC ${id}: unbekannter Status ${n.status}`));
    const rec = { name: String(n.name || id), fraktion: String(n.fraktion || 'unbekannt'), status,
      haltung: Math.max(lo, Math.min(hi, Math.round(Number(n.haltung) || 0))), gedaechtnis: [] };
    if (n.titel != null) rec.titel = String(n.titel);
    if (n.rolle != null) rec.rolle = String(n.rolle);
    if (n.ort != null) rec.ort = String(n.ort);
    out[id] = rec;
  }
  return out;
}

// ---------- Laufzeit-Weltstand (§5.4) ----------
function makeRuntime(game, base) {
  const ws = Object.assign({ id: null, name: null, persistent: false, dir: null, lastKey: null, savedAt: null, lastDockedAt: null }, base);
  const cfg = () => (game.C && game.C.weltstand) || {};
  const playTime = () => { try { return game.mission ? game.mission.playTime() : 0; } catch (e) { return 0; } };
  const resolveText = (t) => {
    let s = t == null ? '' : String(t);
    if (s.startsWith('@')) {
      const def = game.mission && (game.mission.textDef || game.mission.def);
      const key = s.slice(1);
      if (def && def.texte && typeof def.texte[key] === 'string') s = def.texte[key];
      else countError(game, 'weltstand-text', new Error('Text ' + s + ' nicht gefunden'));
    }
    return s;
  };
  const npcOf = (npc, where) => {
    const n = ws.data.npc[npc];
    if (!n) countError(game, where, new Error('Unbekannter NSC ' + npc));
    return n || null;
  };
  const clampAtt = (v) => {
    const c = cfg(); const lo = Number.isFinite(c.attitudeMin) ? c.attitudeMin : -3, hi = Number.isFinite(c.attitudeMax) ? c.attitudeMax : 3;
    return Math.max(lo, Math.min(hi, Math.round(v)));
  };
  ws.npcAttitude = (npc, delta) => {
    const n = npcOf(npc, 'weltstand-npcAttitude'); if (!n) return false;
    const d = Number(delta); if (!Number.isFinite(d)) { countError(game, 'weltstand-npcAttitude', new Error('delta ' + delta)); return false; }
    n.haltung = clampAtt(n.haltung + d);
    return true;
  };
  // W1 AP4 (§5.4 Nr. 6): Haltung der Crew gegenüber einer Fraktion (Besitz-ID, z. B. kontor), Vorbild npcAttitude
  // (−3 … +3, gekappt). Gespeichert als Fakt haltung_<fraktion> (welt.fakten, Zahl) – damit ohne neues Schemafeld im
  // Weltstand und für den Spielleiter im Kontext sichtbar (Fakten). -> neue Haltung | null
  ws.fraktionHaltung = (fraktion) => {
    const v = Number(ws.data && ws.data.fakten && ws.data.fakten['haltung_' + fraktion]);
    return Number.isFinite(v) ? clampAtt(v) : 0;
  };
  ws.fraktionHaltungAendern = (fraktion, delta, quelle) => {
    if (typeof fraktion !== 'string' || !/^[a-z][a-z0-9_]*$/.test(fraktion)) { countError(game, 'weltstand-fraktionHaltung', new Error('Fraktion ' + fraktion)); return null; }
    const d = Number(delta); if (!Number.isFinite(d)) { countError(game, 'weltstand-fraktionHaltung', new Error('delta ' + delta)); return null; }
    const neu = clampAtt(ws.fraktionHaltung(fraktion) + d);
    ws.fact('haltung_' + fraktion, neu, quelle != null ? quelle : null);
    return neu;
  };
  // entry: { ereignis, text, haltung?, gewicht?, mission?, schritt? } – text wird jetzt aufgelöst ('@kennung')
  ws.npcMemory = (npc, entry) => {
    const n = npcOf(npc, 'weltstand-npcMemory'); if (!n) return false;
    const e = entry || {};
    const m = game.mission;
    const rec = { ereignis: String(e.ereignis || 'ereignis'), text: resolveText(e.text).slice(0, 200),
      mission: e.mission != null ? String(e.mission) : (m && m.activeId) || null,
      spielzeit_s: Math.round(Number.isFinite(e.spielzeit_s) ? e.spielzeit_s : playTime()) };
    if (rec.mission == null) delete rec.mission;
    const step = e.schritt != null ? e.schritt : (m && m.step && m.step.id);
    if (step != null) rec.schritt = String(step);
    if (Number.isFinite(Number(e.haltung)) && e.haltung != null) { rec.haltung = Math.round(Number(e.haltung)); ws.npcAttitude(npc, rec.haltung); }
    if (Number.isFinite(Number(e.gewicht)) && e.gewicht != null) rec.gewicht = Number(e.gewicht);
    n.gedaechtnis.push(rec);
    const max = Math.max(1, Number(cfg().npcMemoryMax) || 12);
    while (n.gedaechtnis.length > max) {
      // älteste mit kleinstem Gewicht fällt raus (Gewicht fehlt = 1)
      let idx = 0, w = Infinity;
      n.gedaechtnis.forEach((x, i) => { const g = Number.isFinite(x.gewicht) ? x.gewicht : 1; if (g < w) { w = g; idx = i; } });
      n.gedaechtnis.splice(idx, 1);
    }
    return true;
  };
  ws.npcStatus = (npc, status, ort) => {
    if (ort !== undefined) { const n0 = ws.data.npc[npc]; if (n0) { if (ort == null) delete n0.ort; else n0.ort = String(ort); } }
    const n = npcOf(npc, 'weltstand-npcStatus'); if (!n) return false;
    if (!NPC_STATES.includes(status)) { countError(game, 'weltstand-npcStatus', new Error('Status ' + status)); return false; }
    n.status = status;
    return true;
  };
  // opts (S2): { faden: bool } – offener Erzählfaden (welt.faeden), false schließt ihn
  ws.fact = (key, value, quelle, opts) => {
    if (typeof key !== 'string' || !key) { countError(game, 'weltstand-fact', new Error('key ' + key)); return false; }
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) { countError(game, 'weltstand-fact', new Error('Wert für ' + key)); return false; }
    ws.data.fakten[key] = value;
    if (quelle != null) ws.data.faktenQuelle[key] = String(quelle);
    if (opts && opts.faden !== undefined) {
      const f = ws.data.faeden || (ws.data.faeden = []);
      const i = f.indexOf(key);
      if (opts.faden && i < 0) f.push(key);
      if (!opts.faden && i >= 0) f.splice(i, 1);
    }
    return true;
  };
  // B2 §5/§9: Gegnerrolle gilt als gesehen (crew.rollen_gesehen, Einführungsregel E24). -> true, wenn sie neu ist.
  // Aufruf: BODENKAMPF (squad.js), sobald ein Gegner dieser Rolle für einen Spieler sichtbar war.
  ws.rolleGesehen = (rolle) => {
    if (typeof rolle !== 'string' || !rolle) return false;
    const l = ws.data.rollen_gesehen || (ws.data.rollen_gesehen = []);
    if (l.includes(rolle)) return false;
    l.push(rolle);
    return true;
  };
  ws.rollenGesehen = () => ((ws.data && ws.data.rollen_gesehen) || []).slice();
  // entry: Text oder { text, mission?, ausgang? }
  ws.chronicle = (entry) => {
    const e = typeof entry === 'string' ? { text: entry } : (entry || {});
    const m = game.mission;
    const rec = { text: resolveText(e.text).slice(0, 300), spielzeit_s: Math.round(Number.isFinite(e.spielzeit_s) ? e.spielzeit_s : playTime()) };
    const mid = e.mission != null ? e.mission : (m && m.activeId);
    if (mid != null) rec.mission = String(mid);
    if (e.ausgang != null) rec.ausgang = String(e.ausgang);
    if (!rec.text) return false;
    ws.data.chronik.push(rec);
    if (ws.data.chronik.length > CHRONIK_KEEP) ws.data.chronik.splice(0, ws.data.chronik.length - CHRONIK_KEEP);
    if (game.explore) game.explore.logVersion++;   // Chronik reist im Log-Slot des Snapshots mit
    return true;
  };
  return ws;
}

// Neuer Stand im Speicher. opts: { tutorial, persistent? (Standard true), dir? }
function create(game, opts) {
  const o = opts || {};
  for (const k of Object.keys(BLOCK_MODS)) blockMod(k);   // B1 §8: Module jetzt laden, nicht beim ersten Erfassen im Tick
  sektoren();
  const persistent = o.persistent !== false;
  const d = o.dir || dir(game && game.env);
  let id = null;
  if (persistent) {
    for (let i = 0; i < 50; i++) {
      const cand = 'w-' + Math.random().toString(36).slice(2, 6).padEnd(4, '0');
      if (!fs.existsSync(mainFile(d, cand)) && !fs.existsSync(bakFile(d, cand))) { id = cand; break; }
    }
    if (!id) id = 'w-' + Date.now().toString(36);
  }
  const now = new Date();
  // Eindeutiger Name (QA-Abnahme S1): zweiter Stand am selben Tag heißt „Lerche · 08.10. (2)“, dritter „(3)“ usw.
  // Zähler statt Uhrzeit, weil die Liste das relative Datum ohnehin zeigt und der Name kurz bleiben soll.
  let name = null;
  if (persistent) {
    const base = 'Lerche · ' + ddmm(now);
    let taken = [];
    try { taken = list(d, game).map((w) => w.name); } catch (e) { countError(game, 'weltstand-name', e); }
    name = base;
    for (let n = 2; taken.includes(name) && n < 100; n++) name = `${base} (${n})`;
  }
  const ws = makeRuntime(game, { id, name, persistent, dir: d });
  ws.data = { npc: npcStartValues(game, readNpcFile(game, o.countMissing !== false && persistent)), chronik: [], fakten: {}, faktenQuelle: {},
    tutorial: o.tutorial ? 'laeuft' : 'uebersprungen', erstellt: now.toISOString(), rollen_gesehen: [], bloecke: {} };
  return ws;
}

// ---------- Erfassen ----------
function missionSave(game) {
  const m = game.mission;
  if (m && typeof m.toSave === 'function') {
    try { const r = m.toSave(); if (r && typeof r === 'object') return clone(r); } catch (e) { countError(game, 'weltstand-toSave', e); }
  }
  // Ersatz, bis ENGINE mission.toSave() liefert: nur Status, Schritt und Zeiten
  const out = { missionen: {}, aktiv: m ? m.activeId || null : null, flags: m ? clone(m.flags || {}) : {}, buchFokus: m && m.book ? m.book.focus || null : null };
  if (m) for (const [id, x] of Object.entries(m.missions || {})) {
    const st = (game.stats.missions || {})[id] || {};
    const e = { status: x.state === 'done' ? 'erledigt' : x.state === 'active' ? 'aktiv' : 'angeboten' };
    if (m.activeId === id && m.step) { e.schritt = m.step.id; e.v = clone(m.v || {}); e.ereignisse = [...(m.events || [])]; }
    if (Number.isFinite(st.start)) e.start_s = st.start;
    if (Number.isFinite(st.end)) e.ende_s = st.end;
    out.missionen[id] = e;
  }
  return out;
}
const isDone = (e) => !!e && (e.status === 'erledigt' || e.status === 'done');
// B1 §8: Block eines anderen Teams erfassen (toSave(game)); fehlt das Modul -> zuletzt geladener Block bzw. Leerform
function blockSave(game, key) {
  const ws = game.weltstand;
  const kept = ws && ws.data && ws.data.bloecke && ws.data.bloecke[key];
  const m = blockMod(key);
  if (blockLive(m, 'toSave')) {
    try {
      const r = m.toSave(game);
      if (r != null && typeof r === 'object') return clone(r);
    } catch (e) { countError(game, 'weltstand-' + key, e); }
  }
  return kept != null ? clone(kept) : BLOCK_DEFAULTS[key]();
}
// B1 §8: Block an sein Modul (restore(block, game)); fehlt es, bleibt er in ws.data.bloecke und wird unverändert gespeichert
function blockRestore(game, key, block) {
  const m = blockMod(key);
  if (!blockLive(m, 'restore')) return false;
  try { m.restore(clone(block), game); return true; } catch (e) { countError(game, 'weltstand-' + key, e); return false; }
}

function capture(game) {
  const ws = game.weltstand;
  const C = game.C; const ship = game.ship; const inv = game.inventory; const ex = game.explore;
  const ms = missionSave(game);
  const missionen = ms.missionen && typeof ms.missionen === 'object' ? ms.missionen : {};
  const flags = {};
  for (const [k, v] of Object.entries(ms.flags || (game.mission && game.mission.flags) || {})) {
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) flags[k] = v;
  }
  let tutorial = ws.data.tutorial;
  if (tutorial !== 'uebersprungen') tutorial = TUTORIAL_MISSIONS.every((id) => isDone(missionen[id])) ? 'erledigt' : 'laeuft';
  ws.data.tutorial = tutorial;
  const lager = {};
  for (const [k, v] of Object.entries(inv)) if (k !== 'marks' && Number.isFinite(v)) lager[k] = Math.max(0, Math.round(v));
  const systeme = {};
  for (const k of SYSTEM_ORDER) {
    let st = ship.systems[k];
    if (st === 'offline') st = 'ok';
    if (st === 'ok' && ship.fragile && ship.fragile[k]) st = 'damaged';
    systeme[k] = ['ok', 'damaged', 'broken'].includes(st) ? st : 'ok';
  }
  const loc = ship.docked && ship.dockedAt ? ship.dockedAt : (ws.lastDockedAt || Locations.START);
  const wreck = game.aways && game.aways.wreck;
  const now = new Date().toISOString();
  const data = {
    version: VERSION, id: ws.id, name: ws.name, erstellt: ws.data.erstellt || now, gespeichert: now,
    spielzeit_s: Math.max(0, Math.round((game.time - game.stats.playTimeStart) * 10) / 10),
    tutorial,
    meta: { spieler: game.players.map((p) => p.name).slice(0, 3), server: String(game.serverVersion || '') },
    ort: { angedockt: loc },
    schiff: {
      name: 'Lerche',
      marken: Math.max(0, Math.round(inv.marks || 0)),
      lager,
      ausbauten: Object.keys(game.upgrades || {}).filter((k) => game.upgrades[k]),
      deko: (inv.deko || []).map(String),
      dekoPlaetze: clone(game.deco || {}),
      quartiere: clone(game.quarters || {}),
      systeme,
      huelle: Math.max(0, Math.round(ship.hull * 10) / 10),
      support: clone(game.support || {}),
      pins: clone((game.plan && game.plan.pins) || []),
    },
    welt: Object.assign({
      flags,
      fakten: clone(ws.data.fakten),
      faktenQuelle: clone(ws.data.faktenQuelle || {}),
      odaSeen: [...(game.odaSeen || [])].map(String),
      scans: [...(game.scans || [])].map(String),
      wrack: wreck ? { salvage: (wreck.salvage || []).map((s) => !!s.done), loreRead: !!wreck.loreRead,
        hollow: { marked: !!(wreck.hollow && wreck.hollow.marked), open: !!(wreck.hollow && wreck.hollow.open) } } : { salvage: [], loreRead: false },
    }, ex.toSave ? ex.toSave((C.weltstand && C.weltstand.logKeep) || 60) : { orte: { bekannt: [], besucht: [] } }),
    missionen: Object.assign({}, ms, { missionen, flags }),   // Vertrag §5.1: = mission.toSave()
    npc: clone(ws.data.npc),
    chronik: clone(ws.data.chronik),
    spielleiter: spielleiterSave(game),   // S2 §3.2
  };
  if (Array.isArray(ws.data.faeden) && ws.data.faeden.length) data.welt.faeden = ws.data.faeden.slice();
  // B1–B3 (§8): Blöcke der Teams (explore.toSave darf sektoren selbst liefern, sonst sprung.js bzw. der geladene Block)
  data.welt.landepunkte = blockSave(game, 'landepunkte');
  data.welt.wracks = blockSave(game, 'wracks');
  let sek = data.welt.sektoren;
  if (!sek && ex && typeof ex.sektorenToSave === 'function') { try { sek = ex.sektorenToSave(); } catch (e) { countError(game, 'weltstand-sektoren', e); } }
  data.welt.sektoren = normSektoren(sek || blockSave(game, 'sektoren'));
  data.crew = { waffen: blockSave(game, 'waffen'), rollen_gesehen: (ws.data.rollen_gesehen || []).slice() };
  return data;
}

// ---------- Anwenden (nach reset()) ----------
function apply(game, data) {
  const d = clone(data);
  const C = game.C; const ship = game.ship;
  const ws = makeRuntime(game, { id: d.id, name: d.name, persistent: true, dir: (game.weltstand && game.weltstand.dir) || dir(game.env) });
  ws.data = { npc: d.npc || {}, chronik: d.chronik || [], fakten: (d.welt && d.welt.fakten) || {}, faktenQuelle: (d.welt && d.welt.faktenQuelle) || {},
    tutorial: d.tutorial === 'gespielt' ? 'erledigt' : (d.tutorial || 'laeuft'), erstellt: d.erstellt,
    faeden: Array.isArray(d.welt && d.welt.faeden) ? d.welt.faeden.slice() : [],
    rollen_gesehen: Array.isArray(d.crew && d.crew.rollen_gesehen) ? d.crew.rollen_gesehen.filter((r) => typeof r === 'string') : [],
    bloecke: {} };
  for (const n of Object.values(ws.data.npc)) if (!Array.isArray(n.gedaechtnis)) n.gedaechtnis = [];
  // Fakten in der Form { value, quelle } auf Wert + faktenQuelle abbilden
  for (const [k, v] of Object.entries(ws.data.fakten)) {
    if (v && typeof v === 'object') { ws.data.fakten[k] = v.value === undefined ? null : v.value; if (v.quelle != null) ws.data.faktenQuelle[k] = String(v.quelle); }
  }
  ws.lastDockedAt = d.ort && d.ort.angedockt;
  game.weltstand = ws;
  // Spielzeit läuft weiter
  game.stats.playTimeStart = game.time - (Number(d.spielzeit_s) || 0);
  // Schiff
  const s = d.schiff || {};
  game.inventory.marks = Math.max(0, Math.round(Number(s.marken) || 0));
  for (const [k, v] of Object.entries(s.lager || {})) if (Number.isFinite(v)) game.inventory[k] = v;
  game.inventory.deko = Array.isArray(s.deko) ? s.deko.slice() : [];
  for (const k of Object.keys(game.upgrades)) game.upgrades[k] = false;
  for (const k of s.ausbauten || []) game.upgrades[k] = true;
  if (s.dekoPlaetze) for (const [k, v] of Object.entries(s.dekoPlaetze)) if (k in game.deco) game.deco[k] = v;
  if (s.quartiere) for (const [k, v] of Object.entries(s.quartiere)) game.quarters[k] = Object.assign({}, game.quarters[k] || {}, v);
  if (s.support) for (const [k, v] of Object.entries(s.support)) if (k in game.support && Number.isFinite(v)) game.support[k] = v;
  if (Array.isArray(s.pins)) {
    game.plan.pins = s.pins;
    game.plan.seq = s.pins.reduce((mx, p) => Math.max(mx, Number(String(p.id || '').replace(/\D/g, '')) || 0), 0);
  }
  if (Number.isFinite(s.huelle)) ship.hull = Math.max(1, Math.min(ship.hullMax, s.huelle));
  for (const k of SYSTEM_ORDER) if (s.systeme && ['ok', 'damaged', 'broken'].includes(s.systeme[k])) ship.systems[k] = s.systeme[k];
  ship.offline = {}; ship.fragile = {};
  // Welt
  const w = d.welt || {};
  // B3 §5: Sektoren fehlen bzw. wurden ohne Sektorkarte migriert -> jetzt aus den Orten ableiten
  if (!w.sektoren || (!(w.sektoren.erkundet || []).length && ((w.orte && w.orte.besucht) || []).length)) w.sektoren = sektorenAusOrten(w);
  w.sektoren = normSektoren(w.sektoren);
  ws.data.bloecke = { landepunkte: w.landepunkte || {}, wracks: Array.isArray(w.wracks) ? w.wracks : [], sektoren: w.sektoren,
    waffen: (d.crew && d.crew.waffen) || {} };
  // B1 §8 Reihenfolge: sektoren -> landepunkte -> spielleiter.restore -> mission.restore -> away.applyWorldFacts
  // sektoren: explore.restore(w) bekommt den ganzen Block welt und stellt welt.sektoren selbst her (SEKTOR, sektorenRestore)
  if (game.explore.restore) game.explore.restore(w);
  blockRestore(game, 'landepunkte', ws.data.bloecke.landepunkte);
  blockRestore(game, 'wracks', ws.data.bloecke.wracks);
  blockRestore(game, 'waffen', ws.data.bloecke.waffen);
  game.odaSeen = new Set(w.odaSeen || []);
  game.scans = new Set(w.scans || []);
  const wreck = game.aways && game.aways.wreck;
  if (wreck && w.wrack) {
    (w.wrack.salvage || []).forEach((done, i) => { if (wreck.salvage[i]) wreck.salvage[i].done = !!done; });
    wreck.loreRead = !!w.wrack.loreRead;
    if (w.wrack.hollow && wreck.hollow) { wreck.hollow.marked = !!w.wrack.hollow.marked; wreck.hollow.open = !!w.wrack.hollow.open; }
  }
  // Schiff angedockt an den gespeicherten Ort
  const loc = Locations.get(ws.lastDockedAt) ? ws.lastDockedAt : Locations.START;
  const space = require('./sim/space.js');
  space.enterScene(game, loc, { docked: true });
  game.explore.location = loc;
  // Missionen (ENGINE: mission.restore; sonst Ersatz)
  const flags = Object.assign({}, w.flags || {});
  Object.assign(game.mission.flags, flags);
  const ms = missionsOf(d);
  Object.assign(flags, ms.flags || {});
  Object.assign(game.mission.flags, flags);
  const obj = Object.assign({}, ms, { missionen: ms.missionen || {}, flags });
  // S2 §3.2: Spielleiter vor mission.restore (seine Bücher müssen registriert sein, bevor die aktive Mission neu startet)
  if (typeof game.createSpielleiter === 'function') { try { game.createSpielleiter(); } catch (e) { countError(game, 'weltstand-spielleiter', e); } }
  const sl = game.spielleiter;
  if (sl && typeof sl.restore === 'function') {
    try { sl.restore(d.spielleiter && typeof d.spielleiter === 'object' ? d.spielleiter : {}); } catch (e) { countError(game, 'weltstand-spielleiter', e); }
  }
  const m = game.mission;
  if (typeof m.restore === 'function') {
    m.restore(obj);
  } else {
    countError(game, 'weltstand-restore', new Error('mission.restore fehlt – einfacher Ersatz'));
    restoreFallback(game, obj);
  }
  game.asteroidsDirty = true;
  // S2 (BAUSTEINE): Außenkarten aus den Fakten herrichten (Tafel weg vom Kesh-Sockel, zerstörter Wächter bleibt zerstört)
  try {
    const away = require('./sim/away.js');
    if (typeof away.applyWorldFacts === 'function') away.applyWorldFacts(game);
  } catch (e) { countError(game, 'weltstand-applyWorldFacts', e); }
  return ws;
}

// Ersatz, bis ENGINE mission.restore() liefert: erledigte Missionen markieren, aktive Mission am Schritt neu starten.
function restoreFallback(game, obj) {
  const m = game.mission;
  let started = false;
  for (const [id, e] of Object.entries(obj.missionen || {})) {
    if (isDone(e)) { m.missions[id] = { id, title: id, state: 'done' }; continue; }
  }
  const aktiv = obj.aktiv;
  if (aktiv && obj.missionen[aktiv] && typeof m.startMission === 'function') {
    m.startMission(aktiv);
    const step = obj.missionen[aktiv].schritt;
    if (m.activeId === aktiv && step && m.def && m.def.steps && m.def.steps.some((s) => s.id === step) && m.step && m.step.id !== step) m.setStep(step);
    started = m.activeId === aktiv;
  }
  if (!started && !Object.keys(obj.missionen || {}).length && typeof m.start === 'function') m.start();
}

module.exports = { BLOCK_MODS, sektorenAusOrten, readChecked, MAX, VERSION, MIGRATIONS, NPC_STATES, dir, list, create, capture, save, load, apply, remove, lock, unlock, validate, fallbackValidate, schema, readNpcFile, pidAlive };
