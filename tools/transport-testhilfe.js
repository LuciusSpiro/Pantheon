'use strict';
// Gemeinsame Hilfen der SUND-03-B-Tests (Ollama-Transport, Router, Schema, Reparaturen): Fake-Ollama-Server, kleiner
// JSON-Schema-Prüfer (nur die Schlüsselwörter, die schema-ableiten.js benutzt), Fake-Spiel für den Spielleiter, echte Szenen
// aus Archiv und Ablage. Kein Netz außer 127.0.0.1.
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ---------- Prüfablauf ----------
function runner(titel) {
  const res = []; let t0 = Date.now();
  const api = {
    check(name, cond, detail) { res.push({ name, ok: !!cond, detail }); },
    async safe(name, fn) { try { await fn(); } catch (e) { res.push({ name, ok: false, detail: 'Ausnahme: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e) }); } },
    finish() {
      for (const r of res) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${!r.ok && r.detail ? '\n      FEHLER ' + r.detail : ''}`);
      const bad = res.filter((r) => !r.ok).length;
      console.log(`${titel}: ${res.length - bad} ok, ${bad} Fehler – ${Date.now() - t0} ms`);
      process.exit(bad ? 1 : 0);
    },
  };
  return api;
}

// ---------- Fake-Ollama ----------
// handler(req, res, body) darf antworten oder die Verbindung kappen; Standard: gültige Antwort.
function fakeOllama(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = null; try { body = raw ? JSON.parse(raw) : null; } catch (e) { /* kein JSON */ }
      requests.push({ method: req.method, url: req.url, body, raw });
      if (handler) handler(req, res, body); else antwort(res, 200, { model: body && body.model, message: { role: 'assistant', content: '{"ok":true}' }, done: true, prompt_eval_count: 11, eval_count: 7 });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    resolve({ url: `http://127.0.0.1:${port}`, port, requests, server, close: () => new Promise((r) => { server.closeAllConnections && server.closeAllConnections(); server.close(() => r()); }) });
  }));
}
function antwort(res, status, obj) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); }
// freier Port, auf dem nichts lauscht (für OFFLINE)
function toterPort() {
  return new Promise((resolve) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

// ---------- JSON-Schema (Teilmenge) ----------
const SCHLUESSEL = new Set(['type', 'enum', 'const', 'anyOf', 'required', 'properties', 'additionalProperties', 'items', 'prefixItems', 'minItems', 'maxItems', 'pattern', 'minimum', 'maximum']);
const TYPEN = new Set(['object', 'array', 'string', 'number', 'boolean', 'null']);
// Ist das Schema (rekursiv) eine wohlgeformte Beschreibung aus bekannten Schlüsselwörtern? -> [Fehler]
function schemaFehler(sch, pfad) {
  const E = []; const p = pfad || '$';
  if (typeof sch === 'boolean') return E;
  if (!sch || typeof sch !== 'object' || Array.isArray(sch)) return [`${p}: kein Schema-Objekt`];
  for (const k of Object.keys(sch)) if (!SCHLUESSEL.has(k)) E.push(`${p}: unbekanntes Schlüsselwort '${k}'`);
  if (sch.type !== undefined && !TYPEN.has(sch.type)) E.push(`${p}: type '${sch.type}'`);
  if (sch.enum !== undefined && (!Array.isArray(sch.enum) || !sch.enum.length)) E.push(`${p}: enum leer/kein Array`);
  if (sch.required !== undefined && (!Array.isArray(sch.required) || sch.required.some((x) => typeof x !== 'string'))) E.push(`${p}: required kein String-Array`);
  if (sch.pattern !== undefined) { try { new RegExp(sch.pattern); } catch (e) { E.push(`${p}: pattern ungültig`); } }
  for (const k of ['minItems', 'maxItems']) if (sch[k] !== undefined && !(Number.isInteger(sch[k]) && sch[k] >= 0)) E.push(`${p}: ${k}`);
  if (sch.properties) for (const [k, v] of Object.entries(sch.properties)) E.push(...schemaFehler(v, `${p}.${k}`));
  if (sch.additionalProperties && typeof sch.additionalProperties === 'object') E.push(...schemaFehler(sch.additionalProperties, `${p}.*`));
  if (sch.items) E.push(...schemaFehler(sch.items, `${p}[]`));
  if (sch.prefixItems) { if (!Array.isArray(sch.prefixItems)) E.push(`${p}: prefixItems kein Array`); else sch.prefixItems.forEach((v, i) => E.push(...schemaFehler(v, `${p}[${i}]`))); }
  if (sch.anyOf) { if (!Array.isArray(sch.anyOf) || !sch.anyOf.length) E.push(`${p}: anyOf leer`); else sch.anyOf.forEach((v, i) => E.push(...schemaFehler(v, `${p}|${i}`))); }
  return E;
}
const istObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
function gleich(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
// Wert gegen Schema -> [Fehler] (leer = gültig)
function pruefeSchema(sch, v, pfad) {
  const p = pfad || '$';
  if (sch === true || sch === undefined) return [];
  if (sch === false) return [`${p}: nicht erlaubt`];
  const E = [];
  if (sch.anyOf) {
    const alle = sch.anyOf.map((s) => pruefeSchema(s, v, p));
    if (!alle.some((e) => !e.length)) return [`${p}: passt auf keine Alternative (${alle.map((e) => e[0]).join(' / ')})`];
  }
  if (sch.const !== undefined && !gleich(sch.const, v)) E.push(`${p}: ${JSON.stringify(v)} ≠ ${JSON.stringify(sch.const)}`);
  if (sch.enum && !sch.enum.some((x) => gleich(x, v))) E.push(`${p}: ${JSON.stringify(v)} nicht in enum`);
  if (sch.type) {
    const ok = sch.type === 'array' ? Array.isArray(v) : sch.type === 'object' ? istObj(v) : sch.type === 'null' ? v === null : sch.type === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeof v === sch.type;
    if (!ok) return E.concat(`${p}: Typ ${sch.type} erwartet`);
  }
  if (typeof v === 'string' && sch.pattern && !new RegExp(sch.pattern).test(v)) E.push(`${p}: '${v}' passt nicht auf ${sch.pattern}`);
  if (typeof v === 'number') { if (sch.minimum !== undefined && v < sch.minimum) E.push(`${p}: ${v} < ${sch.minimum}`); if (sch.maximum !== undefined && v > sch.maximum) E.push(`${p}: ${v} > ${sch.maximum}`); }
  if (istObj(v)) {
    for (const r of sch.required || []) if (!(r in v)) E.push(`${p}: Pflichtfeld '${r}' fehlt`);
    for (const [k, x] of Object.entries(v)) {
      if (sch.properties && k in sch.properties) E.push(...pruefeSchema(sch.properties[k], x, `${p}.${k}`));
      else if (sch.additionalProperties === false) E.push(`${p}: unbekanntes Feld '${k}'`);
      else if (istObj(sch.additionalProperties)) E.push(...pruefeSchema(sch.additionalProperties, x, `${p}.${k}`));
    }
  }
  if (Array.isArray(v)) {
    if (sch.minItems !== undefined && v.length < sch.minItems) E.push(`${p}: ${v.length} < ${sch.minItems} Einträge`);
    if (sch.maxItems !== undefined && v.length > sch.maxItems) E.push(`${p}: ${v.length} > ${sch.maxItems} Einträge`);
    const pre = sch.prefixItems || [];
    v.forEach((x, i) => { const s = i < pre.length ? pre[i] : sch.items; if (s !== undefined) E.push(...pruefeSchema(s, x, `${p}[${i}]`)); });
  }
  return E;
}

// ---------- echte Szenen ----------
// Archiv (content/spielleiter/archiv) und Ablage (content/spielleiter/erzeugt): { name, grobplan, szene (Grobplan-Szene), antwort }
function bekannteSzenen() {
  const out = [];
  const Archiv = require('../server/mission/archiv.js');
  for (const e of Archiv.load().entries) for (const [sid, a] of Object.entries(e.szenen || {})) {
    const s = e.grobplan.szenen.find((x) => x.id === sid);
    if (s && (s.molekuele || []).length && a && Array.isArray(a.molekuele)) out.push({ name: `archiv/${e.name}/${sid}`, grobplan: e.grobplan, szene: s, antwort: a });
  }
  const dir = path.join(ROOT, 'content', 'spielleiter', 'erzeugt');
  if (fs.existsSync(dir)) for (const d of fs.readdirSync(dir).sort()) {
    const f = path.join(dir, d, 'mission.json');
    if (!fs.existsSync(f)) continue;
    let m; try { m = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { continue; }
    if (!m.grobplan || !m.szenen) continue;
    for (const [sid, a] of Object.entries(m.szenen)) {
      const s = m.grobplan.szenen.find((x) => x.id === sid);
      if (s && (s.molekuele || []).length && a && Array.isArray(a.molekuele)) out.push({ name: `erzeugt/${d}/${sid}`, grobplan: m.grobplan, szene: s, antwort: a });
    }
  }
  return out;
}

// ---------- Fake-Spiel für den Spielleiter (wie tools/test-spielleiter.js, nur das Nötigste) ----------
function fakeGame(opts) {
  const Checker = require('../server/mission/checker.js');
  const events = []; const errors = [];
  const g = {
    time: 0, C: require('../shared/config.js'), env: {}, players: [{ connected: true }, { connected: true }, { connected: true }], ship: { scene: 'hafen' },
    emit(k, d) { events.push({ k, d }); }, oda(t) { events.push({ k: 'oda', d: { text: t } }); }, notice() {},
    countError(w, e) { errors.push(w + ': ' + (e && e.message)); }, log() {},
    weltstand: { id: 'w-test', persistent: true, data: null, npcMemory() { return true; } },
  };
  const m = {
    books: {}, updates: [], activeId: null, step: null, missions: {}, order: ['m1', 'm2', 'm3'],
    info(id) { return ['m1', 'm2', 'm3'].includes(id) ? { id, tutorial: true } : (this.books[id] ? { id, tutorial: false } : null); },
    registerBook(b, o) { const r = Checker.check(b); this.books[b.id] = { book: b, origin: o && o.origin }; return { ok: !r.errors.length, errors: r.errors }; },
    updateBook(id, b) { const r = Checker.check(b); if (r.errors.length) return { ok: false, errors: r.errors }; this.books[id].book = b; this.updates.push(id); return { ok: true }; },
    unregisterBook(id) { delete this.books[id]; },
    startMission(id) { if (!this.books[id]) return; this.activeId = id; this.missions[id] = { state: 'active' }; this.step = { id: this.books[id].book.steps[0].id }; },
    radio() {}, playTime() { return g.time; },
  };
  for (const id of m.order) m.missions[id] = { state: 'done' };
  g.mission = m;
  return { g, m, events, errors };
}
const flush = () => new Promise((r) => setImmediate(r));
async function ticks(sl, g, sec, dt, until) {
  const step = dt || 0.25;
  for (let t = 0; t < sec; t += step) { g.time += step; sl.update(step); await flush(); if (until && until()) return true; }
  return until ? !!until() : true;
}
function kontextNachTutorial() { return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'context', 'nach-tutorial.context.json'), 'utf8')); }

module.exports = { runner, fakeOllama, antwort, toterPort, schemaFehler, pruefeSchema, bekannteSzenen, fakeGame, ticks, flush, kontextNachTutorial, ROOT };
