'use strict';
// Werkstatt-Route (CONTRACT-B1 §4, Team WERKSTATT). server/index.js bindet sie immer ein (Abnahme F8): Lesen (status, daten)
// geht immer, Speichern nur mit opts.speichern (WERKSTATT=1 bzw. --werkstatt, `npm run werkstatt`).
// route(req, res, opts?) -> true, wenn die Anfrage beantwortet wurde; sonst false (dann läuft die normale Auslieferung weiter).
// Nach dem Speichern nach content/buehnen lädt der Server den Modulbestand neu (Abnahme F9): Buehne.setDaten (leert die
// Lagen-/bauversion-Caches; neue bauversion der Kartenart -> Landepunkte bauen neu) und landepunkte.cacheLeeren(art), falls vorhanden.
//
//   GET  /werkstatt/status                     -> { aktiv (Speichern erlaubt), quellen }
//   GET  /werkstatt/daten?quelle=content       -> Vokabular + alle Module/Schablonen (Bündel für Shared_Buehne.setDaten), speichern
//   POST /werkstatt/save                       -> { quelle?, inhalt, trotzFehler? }  schreibt <quelle>/<art>/<module|schablonen>/<id>.json
//
// Quellen: content = content/buehnen (Vertrag), fixtures = tools/fixtures/buehne (Testdaten von BUEHNE; dort nur fehlerfreie
// Module, weil tools/test-buehne.js jedes Fixture-Modul als gültig erwartet). Der Pfad wird nur aus art + id gebildet,
// nie aus einer Pfadangabe des Browsers. Format (public/js/werkstatt/format.js) und K-RASTER sperren immer; übrige
// Bühnen-Fehler (shared/buehne.js) nur mit trotzFehler (Werkstatt fragt nach), in fixtures immer.
const fs = require('fs');
const path = require('path');
const Buehne = require('../shared/buehne.js');
const Format = require('../public/js/werkstatt/format.js');

const ROOT = path.join(__dirname, '..');
const QUELLEN = {
  content: path.join(ROOT, 'content', 'buehnen'),
  fixtures: path.join(ROOT, 'tools', 'fixtures', 'buehne'),
};
const MAX_BODY = 1024 * 1024;

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function quelleVon(name) {
  const q = name == null || name === '' ? 'content' : String(name);
  return Object.prototype.hasOwnProperty.call(QUELLEN, q) ? q : null;
}

function buendel(quelle) {
  const d = Buehne.ladeVerzeichnis(QUELLEN[quelle], QUELLEN.content);
  let cfg = null;
  try { cfg = require('../shared/config.js').buehne || null; } catch (e) { cfg = null; }
  return Object.assign({ quelle, cfg }, d);
}

// Gleiche Herkunft: Browser schicken bei POST Origin mit; fremde Seiten dürfen nicht speichern.
function gleicheHerkunft(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch (e) { return false; }
}

function leseBody(req, cb) {
  let n = 0; const teile = []; let fertig = false;
  req.on('data', (c) => {
    if (fertig) return;
    n += c.length;
    if (n > MAX_BODY) { fertig = true; cb(new Error('zu groß')); req.destroy(); return; }
    teile.push(c);
  });
  req.on('end', () => { if (!fertig) { fertig = true; cb(null, Buffer.concat(teile).toString('utf8')); } });
  req.on('error', (e) => { if (!fertig) { fertig = true; cb(e); } });
}

// Prüft ein Modul bzw. eine Schablone. -> { sperrend: [...], fehler: [...], warnungen: [...], pfadRel }
function pruefeInhalt(inhalt, quelle) {
  const sperrend = Format.pruefe(inhalt).slice();
  let fehler = [], warnungen = [];
  const pfadRel = sperrend.length ? null : Format.dateiPfad(inhalt);
  if (!sperrend.length && !Format.istSchablone(inhalt)) {
    const daten = Buehne.ladeVerzeichnis(QUELLEN[quelle], QUELLEN.content);
    const r = Buehne.pruefeModul(inhalt, { daten });
    for (const f of r.fehler) (f.code === 'K-RASTER' ? sperrend : fehler).push(f);
    warnungen = r.warnungen;
  }
  if (!sperrend.length && Format.istSchablone(inhalt)) {
    // Platztypen ohne Modul sind kein Formatfehler, aber ein Hinweis
    const daten = Buehne.ladeVerzeichnis(QUELLEN[quelle], QUELLEN.content);
    const typen = new Set(daten.module.filter((m) => m.art === inhalt.art).map((m) => m.typ));
    const plaetze = inhalt.decks ? inhalt.decks.flatMap((d) => d.plaetze || []) : (inhalt.plaetze || []);
    for (const p of plaetze) if (!typen.has(p.typ)) warnungen.push({ code: 'K-MODUL', msg: `Platz ${p.id}: kein Modul vom Typ ${p.typ}` });
  }
  return { sperrend, fehler, warnungen, pfadRel };
}

function speichern(req, res, nachSpeichern) {
  if (!gleicheHerkunft(req)) return json(res, 403, { ok: false, fehler: [{ code: 'HERKUNFT', msg: 'fremde Herkunft' }] });
  if (!/application\/json/i.test(String(req.headers['content-type'] || ''))) {
    return json(res, 415, { ok: false, fehler: [{ code: 'FORMAT', msg: 'Content-Type application/json erwartet' }] });
  }
  leseBody(req, (err, text) => {
    if (err) return json(res, 413, { ok: false, fehler: [{ code: 'FORMAT', msg: 'Anfrage zu groß oder abgebrochen' }] });
    let body;
    try { body = JSON.parse(text); } catch (e) { return json(res, 400, { ok: false, fehler: [{ code: 'FORMAT', msg: 'kein gültiges JSON' }] }); }
    const quelle = quelleVon(body && body.quelle);
    if (!quelle) return json(res, 400, { ok: false, fehler: [{ code: 'PFAD', msg: `Quelle ${body && body.quelle} unbekannt (content, fixtures)` }] });
    const inhalt = body && body.inhalt;
    let p;
    try { p = pruefeInhalt(inhalt, quelle); } catch (e) {
      return json(res, 500, { ok: false, fehler: [{ code: 'INTERN', msg: String(e && e.message || e) }] });
    }
    if (p.sperrend.length) return json(res, 422, { ok: false, fehler: p.sperrend.concat(p.fehler), warnungen: p.warnungen });
    if (p.fehler.length && (quelle === 'fixtures' || !body.trotzFehler)) {
      return json(res, 409, { ok: false, brauchtBestaetigung: quelle !== 'fixtures', fehler: p.fehler, warnungen: p.warnungen });
    }
    const basis = QUELLEN[quelle];
    const ziel = path.resolve(basis, p.pfadRel);
    // nur <basis>/<art>/<module|schablonen>/<id>.json
    const rel = path.relative(basis, ziel).split(path.sep);
    if (rel.length !== 3 || rel[0] !== inhalt.art || !['module', 'schablonen'].includes(rel[1]) || ziel.indexOf(basis + path.sep) !== 0) {
      return json(res, 400, { ok: false, fehler: [{ code: 'PFAD', msg: 'Pfad außerhalb von <quelle>/<art>/' }] });
    }
    const ueberschrieben = fs.existsSync(ziel);
    try {
      fs.mkdirSync(path.dirname(ziel), { recursive: true });
      const tmp = ziel + '.tmp-' + process.pid;
      fs.writeFileSync(tmp, Format.alsText(inhalt), 'utf8');
      fs.renameSync(tmp, ziel);
    } catch (e) {
      return json(res, 500, { ok: false, fehler: [{ code: 'SCHREIBEN', msg: String(e && e.message || e) }] });
    }
    const anzeige = path.relative(ROOT, ziel).replace(/\\/g, '/');
    const neu = quelle === 'content' ? neuLaden(inhalt.art) : null;
    if (nachSpeichern) { try { nachSpeichern(quelle, inhalt); } catch (e) { /* nur Hinweis */ } }
    return json(res, 200, { ok: true, pfad: anzeige, ueberschrieben, fehler: p.fehler, warnungen: p.warnungen, neuGeladen: neu,
      nichtVerbaut: p.fehler.length ? 'Modul hat Prüffehler – der Zusammenbau verbaut es nicht.' : undefined });
  });
}

// Modulbestand des laufenden Servers neu laden (F9b). -> { module, art, cache } | { fehler }
function neuLaden(art) {
  try {
    Buehne.setDaten(Buehne.ladeVerzeichnis());
    let cache = false;
    try { const L = require('./sim/landepunkte.js'); if (L && typeof L.cacheLeeren === 'function') { L.cacheLeeren(art); cache = true; } } catch (e) { cache = false; }
    try { Buehne.vorwaermen(); } catch (e) { /* Inhalte unvollständig */ }
    return { module: Buehne.module().length, art: art || null, cache };
  } catch (e) { return { fehler: String(e && e.message || e) }; }
}

function route(req, res, opts) {
  const darfSpeichern = !!(opts && opts.speichern);
  const url = String(req.url || '');
  const pfad = url.split('?')[0].split('#')[0];
  if (pfad !== '/werkstatt' && pfad.indexOf('/werkstatt/') !== 0) return false;
  const query = new URLSearchParams(url.indexOf('?') >= 0 ? url.slice(url.indexOf('?') + 1) : '');
  try {
    if (pfad === '/werkstatt/status' && req.method === 'GET') {
      json(res, 200, { aktiv: darfSpeichern, lesen: true, quellen: Object.keys(QUELLEN), ziel: { content: 'content/buehnen', fixtures: 'tools/fixtures/buehne' } });
      return true;
    }
    if (pfad === '/werkstatt/daten' && req.method === 'GET') {
      const q = quelleVon(query.get('quelle'));
      if (!q) { json(res, 400, { ok: false, fehler: [{ code: 'PFAD', msg: 'Quelle unbekannt' }] }); return true; }
      json(res, 200, Object.assign(buendel(q), { speichern: darfSpeichern }));
      return true;
    }
    if (pfad === '/werkstatt/save') {
      if (req.method !== 'POST') { json(res, 405, { ok: false, fehler: [{ code: 'METHODE', msg: 'nur POST' }] }); return true; }
      if (!darfSpeichern) { json(res, 403, { ok: false, fehler: [{ code: 'NUR-LESEN', msg: 'Speichern ist aus: Server mit WERKSTATT=1 starten (npm run werkstatt).' }] }); return true; }
      speichern(req, res, opts && opts.nachSpeichern);
      return true;
    }
  } catch (e) {
    json(res, 500, { ok: false, fehler: [{ code: 'INTERN', msg: String(e && e.message || e) }] });
    return true;
  }
  json(res, 404, { ok: false, fehler: [{ code: 'PFAD', msg: 'unbekannte Werkstatt-Route' }] });
  return true;
}

module.exports = { route, pruefeInhalt, neuLaden, QUELLEN };
