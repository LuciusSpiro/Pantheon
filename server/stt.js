'use strict';
// BOT-04 C: Sprach-Anbindung des Spielservers. Zwei Routen, beide nur mit gesetztem STT_URL (sonst 503, "Route aus"):
//   POST /api/stt          Audio roh im Body (Content-Type wird durchgereicht) -> STT_URL (OpenAI-kompatibel /v1/audio/transcriptions,
//                          multipart file, model=whisper-1, language=de) -> { text }
//   POST /api/bot-messung  Messmodus (?botmessung=1): { sitzung, eintrag } (nur application/json, nur gleicher Ursprung) wird als eine JSON-Zeile
//                          an <ROOT>/messungen/<sitzung>.jsonl angehaengt (je Sitzung hoechstens 2000 Eintraege / 1 MB, hoechstens 200 Sitzungen)
// Absicherung: Limit 1 MB, Rate-Limit je Socket-Adresse (Kopfzeilen wie X-Forwarded-For zaehlen nie als Schluessel), Timeout,
// nur lokale Browser (Loopback ohne Proxy-Kopfzeile), ausser STT_REMOTE=1.
// Kein Eingriff in den WebSocket (maxPayload bleibt). Der Browser spricht nie selbst mit Sleipnir.
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_ADRESSEN = 500;          // Rate-Limit-Tabelle
const MAX_EINTRAEGE = 2000;        // je Sitzungsdatei
const MAX_DATEI_BYTES = 1024 * 1024;
const MAX_SITZUNGEN = 200;         // Dateien unter messungen/
const ROOT = path.join(__dirname, '..');
const ROUTE_STT = '/api/stt';
const ROUTE_MESSUNG = '/api/bot-messung';
const ENDUNG = { 'audio/webm': 'webm', 'video/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav' };

function antwort(res, status, obj) {
  const body = JSON.stringify(obj);
  if (res.headersSent) { try { res.end(); } catch (e) { /* egal */ } return; }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

// Ziel-URL des STT-Dienstes: STT_URL darf Basis (http://127.0.0.1:8300) oder die volle Adresse sein
function sttZiel(url) {
  const u = String(url).replace(/\/+$/, '');
  return /\/audio\/transcriptions$/.test(u) ? u : u + '/v1/audio/transcriptions';
}

function erzeuge(opt) {
  const o = opt || {};
  const env = () => o.env || process.env;
  const holen = o.fetch || ((...a) => fetch(...a));
  const jetzt = o.now || (() => Date.now());
  const messDir = () => o.messDir || path.join(ROOT, 'messungen');
  const fenster = new Map();   // adresse -> [zeitpunkte] (gleitendes Minutenfenster), hoechstens MAX_ADRESSEN Eintraege
  const stand = new Map();     // sitzung -> { n, bytes } (aus der Datei beim ersten Zugriff, danach mitgezaehlt)

  const aktiv = () => !!String(env().STT_URL || '').trim();
  const remoteErlaubt = () => /^(1|true|on|an)$/i.test(String(env().STT_REMOTE || ''));
  const pro = () => Math.max(1, +env().STT_PRO_MINUTE || 30);
  const timeoutMs = () => Math.max(500, +env().STT_TIMEOUT_MS || 8000);

  const hdr = (req, k) => { const v = req.headers && req.headers[k]; return Array.isArray(v) ? v[0] : v; };
  // Schluessel nur die Socket-Adresse: Kopfzeilen (X-Forwarded-For, CF-Connecting-IP) kann jeder Client frei setzen und damit das Limit umgehen
  const adresse = (req) => String((req.socket && req.socket.remoteAddress) || '?');
  // lokal = Verbindung von Loopback und kein Proxy dazwischen (ein Tunnel verbindet von localhost, setzt aber eine Weiterleitungs-Kopfzeile)
  function lokal(req) {
    const a = (req.socket && req.socket.remoteAddress) || '';
    const loop = a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
    return loop && !hdr(req, 'cf-connecting-ip') && !hdr(req, 'x-forwarded-for') && !hdr(req, 'forwarded');
  }
  function drosseln(req) {
    const k = adresse(req), t = jetzt(), liste = (fenster.get(k) || []).filter((x) => t - x < 60000);
    if (liste.length >= pro()) { fenster.set(k, liste); return false; }
    liste.push(t); fenster.delete(k); fenster.set(k, liste);   // neu einfuegen: die zuletzt genutzten stehen hinten
    if (fenster.size > MAX_ADRESSEN) {
      for (const [a, l] of fenster) if (!l.some((x) => t - x < 60000)) fenster.delete(a);
      while (fenster.size > MAX_ADRESSEN) fenster.delete(fenster.keys().next().value);   // alle aktiv: aelteste raus
    }
    return true;
  }

  // Body mit Obergrenze einlesen; null = zu gross (Verbindung wird nicht weiter gelesen)
  function lies(req, max) {
    return new Promise((resolve, reject) => {
      const len = +hdr(req, 'content-length');
      if (len > max) { req.resume(); return resolve(null); }
      const teile = []; let n = 0, zuGross = false;
      req.on('data', (c) => { n += c.length; if (n > max) { zuGross = true; return; } if (!zuGross) teile.push(c); });
      req.on('end', () => resolve(zuGross ? null : Buffer.concat(teile)));
      req.on('error', reject);
    });
  }

  // gemeinsame Pruefungen beider Routen; true = weiter
  function zugang(req, res) {
    if (!aktiv()) { antwort(res, 503, { fehler: 'stt-aus', text: 'Sprache ist auf diesem Server nicht eingerichtet (STT_URL fehlt).' }); return false; }
    if (!lokal(req) && !remoteErlaubt()) { antwort(res, 403, { fehler: 'nur-lokal' }); return false; }
    return true;
  }

  async function stt(req, res) {
    if (!zugang(req, res)) { req.resume(); return; }
    if (req.method !== 'POST') { req.resume(); return antwort(res, 405, { fehler: 'nur-post' }); }
    const typ = String(hdr(req, 'content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    if (!/^(audio\/|video\/webm$|application\/octet-stream$)/.test(typ)) { req.resume(); return antwort(res, 415, { fehler: 'kein-audio' }); }
    if (!drosseln(req)) { req.resume(); return antwort(res, 429, { fehler: 'zu-viele-anfragen' }); }
    let audio;
    try { audio = await lies(req, MAX_BYTES); } catch (e) { return antwort(res, 400, { fehler: 'lesefehler' }); }
    if (!audio) return antwort(res, 413, { fehler: 'zu-gross', max: MAX_BYTES });
    if (!audio.length) return antwort(res, 400, { fehler: 'leer' });
    const form = new FormData();
    const mime = String(hdr(req, 'content-type') || typ);   // Content-Type durchreichen (samt codecs)
    form.append('file', new Blob([audio], { type: mime }), 'aufnahme.' + (ENDUNG[typ] || 'webm'));
    form.append('model', 'whisper-1');
    form.append('language', 'de');
    try {
      const r = await holen(sttZiel(env().STT_URL), { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs()) });
      if (!r.ok) return antwort(res, 502, { fehler: 'stt-fehler', status: r.status });
      const d = await r.json();
      return antwort(res, 200, { text: typeof (d && d.text) === 'string' ? d.text.trim() : '' });
    } catch (e) {
      const zeit = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      return antwort(res, zeit ? 504 : 502, { fehler: zeit ? 'stt-zeit' : 'stt-nicht-erreichbar' });
    }
  }

  // Origin (falls der Browser einen schickt) muss zum Host passen; ohne Origin (lokale Skripte, curl) ist es erlaubt
  function herkunftOk(req) {
    const origin = hdr(req, 'origin');
    if (origin === undefined || origin === '') return true;
    try { return new URL(origin).host.toLowerCase() === String(hdr(req, 'host') || '').toLowerCase(); } catch (e) { return false; }
  }
  function sitzungStand(datei, sitzung) {
    let st = stand.get(sitzung);
    if (!st) {
      st = { n: 0, bytes: 0 };
      try { const b = fs.readFileSync(datei); st.bytes = b.length; for (const x of b) if (x === 10) st.n++; } catch (e) { /* neue Sitzung */ }
      stand.set(sitzung, st);
      if (stand.size > MAX_SITZUNGEN) stand.delete(stand.keys().next().value);
    }
    return st;
  }

  async function messung(req, res) {
    if (!zugang(req, res)) { req.resume(); return; }
    if (req.method !== 'POST') { req.resume(); return antwort(res, 405, { fehler: 'nur-post' }); }
    const typ = String(hdr(req, 'content-type') || '').split(';')[0].trim().toLowerCase();
    if (typ !== 'application/json') { req.resume(); return antwort(res, 415, { fehler: 'nur-json' }); }
    if (!herkunftOk(req)) { req.resume(); return antwort(res, 403, { fehler: 'fremder-ursprung' }); }
    if (!drosseln(req)) { req.resume(); return antwort(res, 429, { fehler: 'zu-viele-anfragen' }); }
    let d;
    try { const b = await lies(req, MAX_JSON_BYTES); if (!b) return antwort(res, 413, { fehler: 'zu-gross' }); d = JSON.parse(b.toString('utf8')); } catch (e) { return antwort(res, 400, { fehler: 'kein-json' }); }
    const sitzung = String((d && d.sitzung) || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);
    if (!sitzung || !d.eintrag || typeof d.eintrag !== 'object') return antwort(res, 400, { fehler: 'unvollstaendig' });
    try {
      fs.mkdirSync(messDir(), { recursive: true });
      const datei = path.join(messDir(), sitzung + '.jsonl');
      const st = sitzungStand(datei, sitzung);
      if (st.n === 0 && !fs.existsSync(datei) && fs.readdirSync(messDir()).length >= MAX_SITZUNGEN) return antwort(res, 429, { fehler: 'zu-viele-sitzungen' });
      const zeile = JSON.stringify({ sitzung, eintrag: d.eintrag }) + '\n';   // eine Zeile je Eintrag (Zeilenumbrueche im Inhalt sind als \n escaped)
      if (st.n >= MAX_EINTRAEGE || st.bytes + Buffer.byteLength(zeile) > MAX_DATEI_BYTES) return antwort(res, 413, { fehler: 'sitzung-voll' });
      fs.appendFileSync(datei, zeile);
      st.n++; st.bytes += Buffer.byteLength(zeile);
      return antwort(res, 200, { ok: true, n: st.n, datei: path.relative(ROOT, datei) });
    } catch (e) { return antwort(res, 500, { fehler: 'schreiben' }); }
  }

  // Einhaengepunkt fuer server/index.js: true = die Anfrage gehoert uns (und wird beantwortet)
  function route(req, res) {
    const p = String(req.url || '').split('?')[0];
    if (p === ROUTE_STT) { stt(req, res).catch(() => antwort(res, 500, { fehler: 'intern' })); return true; }
    if (p === ROUTE_MESSUNG) { messung(req, res).catch(() => antwort(res, 500, { fehler: 'intern' })); return true; }
    return false;
  }
  return { route, aktiv, lokal, MAX_BYTES, fensterGroesse: () => fenster.size };
}

const standard = erzeuge();
module.exports = { erzeuge, route: standard.route, sttZiel, MAX_BYTES, ROUTE_STT, ROUTE_MESSUNG };
