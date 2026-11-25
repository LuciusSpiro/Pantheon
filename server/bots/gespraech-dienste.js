'use strict';
// BOT-05 B1: die beiden Dienste des Bot-Gespraechs, beide nur lokal auf Sleipnir und nur diese zwei Ziel-URLs:
//   OLLAMA_URL    (Standard http://127.0.0.1:11435, SSH-Tunnel)       Streaming-Chat des Gespraechsmodells
//   VOICEBOX_URL  (Standard http://sleipnir.local:17493)              Text-zu-Sprache in der Stimme der Figur
// Nie Claude, nie server/mission/llm.js und deren Transporte: dieses Modul hat einen eigenen kleinen Client.
//   ollamaStrom({ messages, signal, onText })   -> { text, ende: 'fertig'|'zeit'|'abgebrochen' }; wirft Error mit code 'nicht_erreichbar' (Verbindung, HTTP-Fehler, Zeitlimit ohne ein Zeichen)
//   sprechen({ voice, text, signal })           -> Buffer (WAV); wirft Error (Auth, Zeit, Verbindung, Format)
//   vorwaermen(voice)                           leerer Ollama-Aufruf mit keep_alive und ein Kurzclip der Voicebox (Fehler werden verschluckt, Rueckgabe { llm, tts })
// Einstellungen (alle beim Aufruf gelesen, damit Tests sie setzen koennen): BOT_GESPRAECH_MODELL, BOT_GESPRAECH_ERSTES_TOKEN_MS (30000), BOT_GESPRAECH_GESAMT_MS (30000),
//   BOT_GESPRAECH_TTS_MS (30000), VOICEBOX_AUTH ("nutzer:passwort"; fehlt es, geht die Anfrage ohne Auth hinaus und ein 401 heisst "ohne Ton", kein ssh).
const MODELL = 'gemma4:26b-a4b-it-q4_K_M';
const WAV_MAX = 8 * 1024 * 1024;
const WARM_TEXT = 'Bereit';

const env = () => process.env;
const zahlEnv = (k, std) => { const n = Number(env()[k]); return Number.isFinite(n) && n > 0 ? n : std; };
const ollamaUrl = () => String(env().OLLAMA_URL || 'http://127.0.0.1:11435').replace(/\/+$/, '');
const voiceboxUrl = () => String(env().VOICEBOX_URL || 'http://sleipnir.local:17493').replace(/\/+$/, '');
const modell = () => String(env().BOT_GESPRAECH_MODELL || MODELL);
const fehler = (code, msg) => { const e = new Error(msg || code); e.code = code; return e; };

async function ollamaStrom({ messages, signal, onText }) {
  const erstes = zahlEnv('BOT_GESPRAECH_ERSTES_TOKEN_MS', 30000), gesamt = zahlEnv('BOT_GESPRAECH_GESAMT_MS', 30000);
  const ac = new AbortController();
  let grund = null;
  const stop = (g) => { if (!grund) grund = g; ac.abort(); };
  const onAbort = () => stop('abgebrochen');
  if (signal) { if (signal.aborted) throw fehler('abgebrochen'); signal.addEventListener('abort', onAbort, { once: true }); }
  const tErstes = setTimeout(() => stop('zeit'), erstes);
  const tGesamt = setTimeout(() => stop('zeit'), gesamt);
  let text = '';
  try {
    let res;
    try {
      res = await fetch(ollamaUrl() + '/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ac.signal,
        body: JSON.stringify({ model: modell(), messages, stream: true, think: false, keep_alive: '30m', options: { num_predict: 80, temperature: 0.7 } }),
      });
    } catch (e) {
      if (grund === 'abgebrochen') return { text, ende: 'abgebrochen' };
      throw fehler('nicht_erreichbar', grund === 'zeit' ? 'Zeitlimit' : (e && e.message));
    }
    if (!res.ok) { try { await res.body.cancel(); } catch (e) { /* egal */ } throw fehler('nicht_erreichbar', 'HTTP ' + res.status); }
    const dec = new TextDecoder();
    const leser = res.body.getReader();
    let rest = '', fertig = false;
    const zeile = (z) => {
      if (!z.trim()) return;
      let d; try { d = JSON.parse(z); } catch (e) { return; }
      if (d && d.error) throw fehler('nicht_erreichbar', String(d.error).slice(0, 100));
      const c = d && d.message && typeof d.message.content === 'string' ? d.message.content : '';
      if (c) { clearTimeout(tErstes); text += c; onText(c); }
      if (d && d.done) fertig = true;
    };
    try {
      while (!fertig) {
        const { done, value } = await leser.read();
        if (done) break;
        rest += dec.decode(value, { stream: true });
        let i;
        while ((i = rest.indexOf('\n')) >= 0) { const z = rest.slice(0, i); rest = rest.slice(i + 1); zeile(z); }
      }
      if (!fertig && rest) zeile(rest);
    } catch (e) {
      if (e && e.code === 'nicht_erreichbar' && !grund) throw e;
      if (grund === 'abgebrochen') return { text, ende: 'abgebrochen' };
      if (grund === 'zeit') { if (!text) throw fehler('nicht_erreichbar', 'Zeitlimit'); return { text, ende: 'zeit' }; }
      if (!text) throw fehler('nicht_erreichbar', e && e.message);
      return { text, ende: 'zeit' };
    }
    try { await leser.cancel(); } catch (e) { /* egal */ }
    return { text, ende: 'fertig' };
  } finally {
    clearTimeout(tErstes); clearTimeout(tGesamt);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

async function sprechen({ voice, text, signal, timeoutMs }) {
  const sigs = [AbortSignal.timeout(timeoutMs || zahlEnv('BOT_GESPRAECH_TTS_MS', 30000))];
  if (signal) sigs.push(signal);
  const headers = { 'Content-Type': 'application/json' };
  const cred = String(env().VOICEBOX_AUTH || '');
  if (cred) headers.Authorization = 'Basic ' + Buffer.from(cred).toString('base64');
  const r = await fetch(voiceboxUrl() + '/v1/audio/speech', {
    method: 'POST', headers, signal: AbortSignal.any(sigs),
    body: JSON.stringify({ model: 'tts-1', voice, input: text, response_format: 'wav', engine: 'qwen' }),
  });
  if (!r.ok) { try { await r.body.cancel(); } catch (e) { /* egal */ } throw fehler('tts_http', 'HTTP ' + r.status); }
  const len = Number(r.headers.get('content-length'));
  if (len > WAV_MAX) { try { await r.body.cancel(); } catch (e) { /* egal */ } throw fehler('tts_gross'); }
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 44 || buf.length > WAV_MAX || buf.toString('latin1', 0, 4) !== 'RIFF') throw fehler('tts_format');
  return buf;
}

async function vorwaermen(voice) {
  const out = { llm: false, tts: false };
  try {
    const r = await fetch(ollamaUrl() + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(120000), body: JSON.stringify({ model: modell(), messages: [], stream: false, keep_alive: '30m' }) });
    out.llm = r.ok; try { await r.arrayBuffer(); } catch (e) { /* egal */ }
  } catch (e) { /* kein Ollama: egal */ }
  if (voice) { try { await sprechen({ voice, text: WARM_TEXT, timeoutMs: 120000 }); out.tts = true; } catch (e) { /* ohne Ton: egal */ } }
  return out;
}

module.exports = { ollamaStrom, sprechen, vorwaermen, MODELL, ollamaUrl, voiceboxUrl };
