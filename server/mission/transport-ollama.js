'use strict';
// Ollama-Transport für den Spielleiter (SUND-03 B). Gleiche Form wie der CLI-Transport in llm.js:
//
//   const T = Ollama.create({ url, model, temperature, numPredict })   // alles optional, sonst Env/Standard
//   await T.call(text, { system, model, timeoutMs, schema })           // -> { text, usage:{input,output}, sec, modelId, cost:0, anbieter:'ollama' }
//   await Ollama.gesund({ url, timeoutMs })                            // -> { ok, version?, fehler? }  (GET /api/version)
//
// Konfiguration (nichts fest verdrahtet): OLLAMA_URL (Standard http://127.0.0.1:11435 = ssh-Tunnel auf Sleipnir),
// OLLAMA_MODEL (Standard gemma4:26b-a4b-it-q4_K_M), optional OLLAMA_TEMPERATURE (sonst gilt der Standard des Modells,
// so wurde gemessen). keep_alive wird nie gesetzt (der Dienst auf Sleipnir hält das Modell selbst).
//
// Anfrage: native POST {url}/api/chat, stream:false, think:false, format = JSON-Schema (wenn übergeben). Das Zeitlimit gilt
// hart für den ganzen Aufruf (AbortController). Es verlässt nichts den Rechner außer dem Prompt.
//
// Fehler tragen err.code wie im übrigen Spielleiter: ETIMEDOUT (Limit), OFFLINE (Dienst nicht erreichbar), EXIT (HTTP-Fehler,
// Fehlerfeld der Antwort, Verbindungsabbruch, kaputte Antwort), EMPTY (leerer Text).

const DEFAULT_URL = 'http://127.0.0.1:11435';
const DEFAULT_MODEL = 'gemma4:26b-a4b-it-q4_K_M';
const DEFAULT_TIMEOUT_MS = 60 * 1000;
const HEALTH_TIMEOUT_MS = 3000;

function err(code, msg) { const e = new Error(msg); e.code = code; return e; }
function baseUrl(opts, env) {
  const e = env || process.env;
  return String((opts && opts.url) || e.OLLAMA_URL || DEFAULT_URL).replace(/\/+$/, '');
}
function modelName(opts, env) { const e = env || process.env; return (opts && opts.model) || e.OLLAMA_MODEL || DEFAULT_MODEL; }
function temperatureOf(opts, env) {
  const e = env || process.env;
  const t = opts && opts.temperature != null ? opts.temperature : (e.OLLAMA_TEMPERATURE !== undefined && e.OLLAMA_TEMPERATURE !== '' ? Number(e.OLLAMA_TEMPERATURE) : null);
  return Number.isFinite(t) ? t : null;
}

// fetch-Fehler -> Spielleiter-Fehlercode
const OFFLINE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']);
function netError(e, url, timedOut, ms) {
  if (timedOut) return err('ETIMEDOUT', `Ollama: Zeitüberschreitung nach ${Math.round(ms / 100) / 10} s (${url})`);
  const code = (e && e.cause && e.cause.code) || (e && e.code) || '';
  if (OFFLINE_CODES.has(code)) return err('OFFLINE', `Ollama nicht erreichbar (${url}, ${code})`);
  return err('EXIT', `Ollama: Verbindung abgebrochen (${url}): ${(e && e.cause && e.cause.message) || (e && e.message) || e}`);
}

// Ein Aufruf mit hartem Zeitlimit; liefert { res, body } oder wirft einen Fehler mit Code.
async function request(method, url, bodyObj, timeoutMs, signal) {
  const ctl = new AbortController();
  let timedOut = false;
  if (signal) { if (signal.aborted) throw err('ABORTED', 'Ollama: Anfrage abgebrochen'); signal.addEventListener('abort', () => ctl.abort(), { once: true }); }   // SUND-03 A2: der Aufrufer (Lage-Spielleiter) bricht ab
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs);
  try {
    const res = await fetch(url, { method, signal: ctl.signal, headers: bodyObj ? { 'content-type': 'application/json' } : undefined, body: bodyObj ? JSON.stringify(bodyObj) : undefined });
    const raw = await res.text();   // Abbruch mitten im Text wirft hier und landet im catch
    return { res, raw };
  } catch (e) {
    if (signal && signal.aborted && !timedOut) throw err('ABORTED', 'Ollama: Anfrage abgebrochen');
    throw netError(e, url, timedOut, timeoutMs);
  } finally { clearTimeout(timer); }
}

function create(opts) {
  const o = opts || {};
  return {
    name: 'ollama',
    get url() { return baseUrl(o, o.env); },
    get model() { return modelName(o, o.env); },
    async call(text, c) {
      const co = c || {};
      const url = baseUrl(o, o.env);
      const model = co.model || modelName(o, o.env);
      const timeoutMs = co.timeoutMs || o.timeoutMs || DEFAULT_TIMEOUT_MS;
      const body = { model, stream: false, think: false, messages: [] };
      // co.system ist beim CLI-Transport ein Dateipfad (--system-prompt-file); hier der Inhalt dieser Datei
      const sys = systemText(co.system);
      if (sys) body.messages.push({ role: 'system', content: sys });
      body.messages.push({ role: 'user', content: String(text) });
      if (co.schema) body.format = co.schema;
      const temp = temperatureOf(o, o.env);
      const options = {};
      if (temp !== null) options.temperature = temp;
      if (o.numPredict) options.num_predict = o.numPredict;
      if (Object.keys(options).length) body.options = options;
      const t0 = Date.now();
      const { res, raw } = await request('POST', url + '/api/chat', body, timeoutMs, co.signal);
      const sec = (Date.now() - t0) / 1000;
      if (!res.ok) throw err('EXIT', `Ollama: HTTP ${res.status} ${String(raw).slice(0, 200).replace(/\s+/g, ' ')}`);
      let j;
      try { j = JSON.parse(raw); } catch (e) { throw err('EXIT', `Ollama: Antwort ist kein JSON (${String(raw).slice(0, 80).replace(/\s+/g, ' ')})`); }
      if (j && j.error) throw err('EXIT', `Ollama: ${String(j.error).slice(0, 200)}`);
      const out = j && j.message && typeof j.message.content === 'string' ? j.message.content : '';
      if (!out.trim()) throw err('EMPTY', 'Ollama: leere Antwort');
      return { text: out, usage: { input: j.prompt_eval_count || 0, output: j.eval_count || 0 }, sec, modelId: j.model || model, cost: 0, anbieter: 'ollama' };
    },
  };
}

// Systemprompt: Dateipfad (wie im CLI-Transport) oder gleich der Text
function systemText(s) {
  if (!s) return '';
  const str = String(s);
  if (str.includes('\n') || str.length > 400) return str;
  try { const fs = require('fs'); if (fs.existsSync(str) && fs.statSync(str).isFile()) return fs.readFileSync(str, 'utf8'); } catch (e) { /* kein Pfad */ }
  return str;
}

// Healthcheck: GET /api/version mit kurzem Zeitlimit. Wirft nie.
async function gesund(opts) {
  const o = opts || {};
  const url = baseUrl(o, o.env);
  try {
    const { res, raw } = await request('GET', url + '/api/version', null, o.timeoutMs || HEALTH_TIMEOUT_MS);
    if (!res.ok) return { ok: false, url, fehler: `HTTP ${res.status}`, code: 'EXIT' };
    let version = null; try { version = JSON.parse(raw).version || null; } catch (e) { /* egal */ }
    return { ok: true, url, version };
  } catch (e) { return { ok: false, url, fehler: e.message, code: e.code }; }
}

module.exports = { create, gesund, DEFAULT_URL, DEFAULT_MODEL, DEFAULT_TIMEOUT_MS };
