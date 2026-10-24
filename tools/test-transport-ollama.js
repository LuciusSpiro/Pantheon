'use strict';
// SUND-03 B (a): Ollama-Transport gegen einen Fake-Server auf 127.0.0.1. Kein Netz, kein echtes Modell.
//   node tools/test-transport-ollama.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./transport-testhilfe.js');
const Ollama = require('../server/mission/transport-ollama.js');
const LLM = require('../server/mission/llm.js');

const T = H.runner('Ollama-Transport');
const SCHEMA = { type: 'object', required: ['a'], properties: { a: { type: 'number' } } };
const fehler = async (p) => { try { await p; return null; } catch (e) { return e; } };

(async () => {
  // ---- Anfrage und Antwort ----
  await T.safe('Anfrage: POST /api/chat, think:false, stream:false, format, Modell, Systemprompt, kein keep_alive', async () => {
    const srv = await H.fakeOllama();
    try {
      const t = Ollama.create({ url: srv.url, model: 'testmodell:1b' });
      const sys = path.join(os.tmpdir(), `pantheon-sys-${process.pid}.md`); fs.writeFileSync(sys, 'Du bist Spielleiter.');
      const r = await t.call('Hallo Welt', { system: sys, schema: SCHEMA, timeoutMs: 5000 });
      fs.unlinkSync(sys);
      const q = srv.requests[0]; const b = q.body;
      T.check('Methode und Pfad', q.method === 'POST' && q.url === '/api/chat', `${q.method} ${q.url}`);
      T.check('think:false, stream:false', b.think === false && b.stream === false, JSON.stringify({ think: b.think, stream: b.stream }));
      T.check('format = übergebenes Schema', JSON.stringify(b.format) === JSON.stringify(SCHEMA), JSON.stringify(b.format));
      T.check('Modell aus der Konfiguration', b.model === 'testmodell:1b', b.model);
      T.check('Nachrichten: system (Dateiinhalt) + user', b.messages.length === 2 && b.messages[0].role === 'system' && b.messages[0].content === 'Du bist Spielleiter.' && b.messages[1].role === 'user' && b.messages[1].content === 'Hallo Welt', JSON.stringify(b.messages));
      T.check('kein keep_alive, keine options ohne Temperatur', !('keep_alive' in b) && !('options' in b), JSON.stringify(Object.keys(b)));
      T.check('Antwort-Mapping: text, usage aus prompt_eval_count/eval_count, cost 0, modelId, anbieter', r.text === '{"ok":true}' && r.usage.input === 11 && r.usage.output === 7 && r.cost === 0 && r.modelId === 'testmodell:1b' && r.anbieter === 'ollama' && typeof r.sec === 'number', JSON.stringify(r));
    } finally { await srv.close(); }
  });
  await T.safe('ohne Schema kein format; model aus dem Aufruf schlägt die Konfiguration; Temperatur nur wenn gesetzt', async () => {
    const srv = await H.fakeOllama();
    try {
      const t = Ollama.create({ url: srv.url, model: 'a:1', temperature: 0.2 });
      await t.call('x', { model: 'b:2', timeoutMs: 5000 });
      const b = srv.requests[0].body;
      T.check('kein format ohne Schema, Modell des Aufrufs, Temperatur', !('format' in b) && b.model === 'b:2' && b.options && b.options.temperature === 0.2 && b.messages.length === 1, JSON.stringify(b));
    } finally { await srv.close(); }
  });
  await T.safe('Konfiguration aus der Umgebung: OLLAMA_URL, OLLAMA_MODEL, Standardwerte', async () => {
    const srv = await H.fakeOllama();
    try {
      await Ollama.create({ env: { OLLAMA_URL: srv.url + '/', OLLAMA_MODEL: 'env-modell:7b' } }).call('x', { timeoutMs: 5000 });
      T.check('URL und Modell aus der Umgebung (Schrägstrich am Ende egal)', srv.requests[0].url === '/api/chat' && srv.requests[0].body.model === 'env-modell:7b', JSON.stringify(srv.requests[0].body.model));
    } finally { await srv.close(); }
    const std = Ollama.create({ env: {} });
    T.check('Standard: http://127.0.0.1:11435 und gemma4:26b-a4b-it-q4_K_M', std.url === 'http://127.0.0.1:11435' && std.model === 'gemma4:26b-a4b-it-q4_K_M', `${std.url} ${std.model}`);
  });

  // ---- Fehler ----
  await T.safe('Zeitlimit: hart, ETIMEDOUT, Server antwortet nie', async () => {
    const srv = await H.fakeOllama(() => { /* antwortet nie */ });
    try {
      const t0 = Date.now();
      const e = await fehler(Ollama.create({ url: srv.url }).call('x', { timeoutMs: 250 }));
      T.check('ETIMEDOUT nach ~250 ms', e && e.code === 'ETIMEDOUT' && Date.now() - t0 < 2500, `${e && e.code} nach ${Date.now() - t0} ms`);
    } finally { await srv.close(); }
  });
  await T.safe('Zeitlimit gilt auch, wenn der Rumpf nie endet', async () => {
    const srv = await H.fakeOllama((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"message":'); /* Rest kommt nie */ });
    try {
      const t0 = Date.now();
      const e = await fehler(Ollama.create({ url: srv.url }).call('x', { timeoutMs: 250 }));
      T.check('ETIMEDOUT trotz begonnener Antwort', e && e.code === 'ETIMEDOUT' && Date.now() - t0 < 2500, `${e && e.code} nach ${Date.now() - t0} ms`);
    } finally { await srv.close(); }
  });
  await T.safe('Verbindungsabbruch: vor der Antwort und mitten in der Antwort → EXIT', async () => {
    const srv = await H.fakeOllama((req, res) => { req.socket.destroy(); });
    try {
      const e = await fehler(Ollama.create({ url: srv.url }).call('x', { timeoutMs: 5000 }));
      T.check('Abbruch vor der Antwort → EXIT', e && e.code === 'EXIT', `${e && e.code}: ${e && e.message}`);
    } finally { await srv.close(); }
    const srv2 = await H.fakeOllama((req, res) => { res.writeHead(200, { 'content-type': 'application/json', 'content-length': '500' }); res.write('{"message"'); setTimeout(() => req.socket.destroy(), 30); });
    try {
      const e = await fehler(Ollama.create({ url: srv2.url }).call('x', { timeoutMs: 5000 }));
      T.check('Abbruch mitten in der Antwort → EXIT', e && e.code === 'EXIT', `${e && e.code}: ${e && e.message}`);
    } finally { await srv2.close(); }
  });
  await T.safe('Dienst nicht erreichbar (Port zu) → OFFLINE', async () => {
    const port = await H.toterPort();
    const e = await fehler(Ollama.create({ url: `http://127.0.0.1:${port}` }).call('x', { timeoutMs: 3000 }));
    T.check('OFFLINE', e && e.code === 'OFFLINE', `${e && e.code}: ${e && e.message}`);
  });
  await T.safe('leere Antwort → EMPTY (auch nur Leerraum)', async () => {
    const leer = (content) => (req, res) => H.antwort(res, 200, { model: 'm', message: { role: 'assistant', content }, done: true, prompt_eval_count: 5, eval_count: 0 });
    for (const [name, content] of [['leer', ''], ['Leerraum', '  \n ']]) {
      const srv = await H.fakeOllama(leer(content));
      try { const e = await fehler(Ollama.create({ url: srv.url }).call('x', { timeoutMs: 5000 })); T.check(`${name} → EMPTY`, e && e.code === 'EMPTY', `${e && e.code}`); } finally { await srv.close(); }
    }
    const srv = await H.fakeOllama((req, res) => H.antwort(res, 200, { model: 'm', done: true }));
    try { const e = await fehler(Ollama.create({ url: srv.url }).call('x', { timeoutMs: 5000 })); T.check('ohne message → EMPTY', e && e.code === 'EMPTY', `${e && e.code}`); } finally { await srv.close(); }
  });
  await T.safe('HTTP 500, 404, Fehlerfeld, kein JSON → EXIT', async () => {
    const faelle = [['HTTP 500 mit Rumpf wie eine gültige Antwort', (req, res) => H.antwort(res, 500, { model: 'm', message: { role: 'assistant', content: '{"ok":true}' }, done: true })], ['HTTP 500', (req, res) => H.antwort(res, 500, { error: 'model runner has unexpectedly stopped' })], ['HTTP 404', (req, res) => H.antwort(res, 404, { error: 'model not found' })],
      ['Fehlerfeld bei 200', (req, res) => H.antwort(res, 200, { error: 'kaputt' })], ['kein JSON', (req, res) => H.antwort(res, 200, '<html>proxy</html>')]];
    for (const [name, h] of faelle) {
      const srv = await H.fakeOllama(h);
      try { const e = await fehler(Ollama.create({ url: srv.url }).call('x', { timeoutMs: 5000 })); T.check(`${name} → EXIT`, e && e.code === 'EXIT', `${e && e.code}: ${e && e.message}`); } finally { await srv.close(); }
    }
  });

  // ---- Healthcheck ----
  await T.safe('gesund(): GET /api/version, Version, Fehlerfälle, kurzer Timeout', async () => {
    const srv = await H.fakeOllama((req, res) => H.antwort(res, 200, { version: '0.40.4' }));
    try {
      const r = await Ollama.gesund({ url: srv.url });
      T.check('gesund → ok mit Version, GET /api/version', r.ok === true && r.version === '0.40.4' && srv.requests[0].method === 'GET' && srv.requests[0].url === '/api/version', JSON.stringify(r));
    } finally { await srv.close(); }
    const port = await H.toterPort();
    const tot = await Ollama.gesund({ url: `http://127.0.0.1:${port}` });
    T.check('Dienst tot → ok:false, Code OFFLINE, wirft nicht', tot.ok === false && tot.code === 'OFFLINE', JSON.stringify(tot));
    const hang = await H.fakeOllama(() => {});
    try {
      const t0 = Date.now();
      const h = await Ollama.gesund({ url: hang.url, timeoutMs: 200 });
      T.check('hängender Dienst → ok:false nach kurzem Timeout', h.ok === false && h.code === 'ETIMEDOUT' && Date.now() - t0 < 2000, JSON.stringify(h));
    } finally { await hang.close(); }
    const srv5 = await H.fakeOllama((req, res) => H.antwort(res, 503, 'nein'));
    try { const r5 = await Ollama.gesund({ url: srv5.url }); T.check('HTTP 503 → ok:false', r5.ok === false, JSON.stringify(r5)); } finally { await srv5.close(); }
  });

  // ---- als Transport in llm.js (Modus live) ----
  await T.safe('llm.create({ mode: live, transport: ollama }): Antwort, Schema, kind; Prozess-Zähler zählt Ollama nicht', async () => {
    const srv = await H.fakeOllama();
    const alt = process.env.LLM_LIVE; process.env.LLM_LIVE = '1';
    try {
      LLM.resetBudget();
      const llm = LLM.create({ mode: 'live', transport: Ollama.create({ url: srv.url, model: 'm:1' }), model: 'm:1' });
      const r = await llm.ask('szene', { prompt: 'p', system: 'Systemtext' }, { timeoutMs: 5000, schema: SCHEMA });
      T.check('Antwort mit anbieter/modell, Schema beim Server angekommen, Zähler 0', r.anbieter === 'ollama' && r.modell === 'm:1' && r.tokens === 18 && JSON.stringify(srv.requests[0].body.format) === JSON.stringify(SCHEMA) && LLM.budget().used === 0, JSON.stringify({ a: r.anbieter, m: r.modell, t: r.tokens, used: LLM.budget().used }));
    } finally { if (alt === undefined) delete process.env.LLM_LIVE; else process.env.LLM_LIVE = alt; await srv.close(); }
  });
  T.finish();
})();
