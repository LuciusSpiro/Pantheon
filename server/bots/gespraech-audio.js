'use strict';
// BOT-05 B1: Ablage der Sprachclips des Bot-Gespraechs im Speicher (nie auf der Platte) und ihre Auslieferung.
//   GET /api/bot-rede/<id>.wav   id = 32 Hex-Zeichen (crypto.randomBytes, nicht erratbar), Gueltigkeit 3 Minuten, hoechstens 30 Dateien und 20 MB; danach 404
//   ablegen(buf, art?)  -> { id, url }       art 'status' (bot.status-Stimme, B-Nacharbeit W3): eigener kleiner Topf, hoechstens STATUS_MAX Clips; ist er voll, faellt der aelteste Statusclip raus. Bei Platzmangel
//   (Dateien, Bytes) gehen immer zuerst die Statusclips, erst dann die aeltesten Gespraechsclips: Statusstimmen verdraengen nie ein Gespraechsaudio.
//   route(req, res) -> true, wenn die Anfrage dieser Route gehoert (Einhaengepunkt in server/index.js)
// Prozessweit (die ids sind zufaellig, kein Zustand einer Partie). Nur lesen, keine Auflistung, kein Verzeichnis.
const crypto = require('crypto');

const GUELTIG_MS = 3 * 60 * 1000;
const MAX_DATEIEN = 30;
const MAX_BYTES = 20 * 1024 * 1024;
const STATUS_MAX = 6;
const PFAD = /^\/api\/bot-rede\/([0-9a-f]{32})\.wav$/;

const speicher = new Map();   // id -> { buf, bis, status }   (Einfuegereihenfolge = Alter)
let bytes = 0;
let jetzt = () => Date.now();

function aufraeumen() {
  const t = jetzt();
  for (const [id, e] of speicher) if (e.bis <= t) { bytes -= e.buf.length; speicher.delete(id); }
}
const entfernen = (id) => { const e = speicher.get(id); if (e) { bytes -= e.buf.length; speicher.delete(id); } };
// aeltester Eintrag der Art (status: true/false), ohne die neue Datei
const aeltester = (status, ausser) => { for (const [id, e] of speicher) if (id !== ausser && !!e.status === status) return id; return null; };
function ablegen(buf, art) {
  aufraeumen();
  const id = crypto.randomBytes(16).toString('hex');
  const status = art === 'status';
  speicher.set(id, { buf, bis: jetzt() + GUELTIG_MS, status });
  bytes += buf.length;
  if (status) { let n = 0; for (const e of speicher.values()) if (e.status) n++; while (n-- > STATUS_MAX) entfernen(aeltester(true, id)); }   // eigener Topf
  while (speicher.size > MAX_DATEIEN || (bytes > MAX_BYTES && speicher.size > 1)) {   // Platzmangel: zuerst die aeltesten Statusclips, dann die aeltesten Gespraechsclips (die neue Datei bleibt immer)
    const raus = aeltester(true, id) || aeltester(false, id);
    if (!raus) break;
    entfernen(raus);
  }
  return { id, url: `/api/bot-rede/${id}.wav` };
}
function holen(id) {
  const e = speicher.get(id);
  if (!e) return null;
  if (e.bis <= jetzt()) { bytes -= e.buf.length; speicher.delete(id); return null; }
  return e.buf;
}

function route(req, res) {
  const m = PFAD.exec(String(req.url || '').split('?')[0]);
  if (!m) return false;
  const kopf = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (req.method !== 'GET') { res.writeHead(405, Object.assign({ Allow: 'GET' }, kopf)); res.end(); return true; }
  const buf = holen(m[1]);
  if (!buf) { res.writeHead(404, kopf); res.end(); return true; }
  res.writeHead(200, Object.assign({ 'Content-Type': 'audio/wav', 'Content-Length': buf.length }, kopf));
  res.end(buf);
  return true;
}

// nur fuer Tests: Uhr ersetzen, Zustand leeren
const test = { uhr(f) { jetzt = f || (() => Date.now()); }, leeren() { speicher.clear(); bytes = 0; }, stand: () => ({ n: speicher.size, bytes }) };

module.exports = { ablegen, holen, route, test, GUELTIG_MS, MAX_DATEIEN, MAX_BYTES, STATUS_MAX };
