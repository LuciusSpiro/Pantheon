'use strict';
// Regie-Logbuch (CONTRACT-S2 §2.3): Was der Spielleiter getan hat, je Weltstand eine Datei <REGIE_DIR>/<weltId>.jsonl
// (anhängen, Rotation bei 5 MB -> <weltId>.1.jsonl). Eintrag:
//   { t, spielzeit, art, mission, szene, quelle: 'llm'|'archiv'|'rohfassung'|'mock', dauer_s, tokens, fehler[], begruendung, wunsch?,
//     reparaturen? (S2b) }
// wunschliste.json sammelt fehlende Bausteine ({ text: { n, zuerst, zuletzt, missionen[] } }).
// Schreiben wirft nie (Fehler -> onError, z. B. game.countError). Lesen: Regielog.read(dir, weltId).
//
//   const log = Regielog.create({ dir, weltId, rotateBytes, onError })
//   log.write(entry) / log.wish(text, { mission }) / log.file / log.entries (letzte 200 im Speicher)
//   Regielog.dir(env)   // REGIE_DIR oder data/regie

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_ROTATE = 5 * 1024 * 1024;
const QUELLEN = ['llm', 'archiv', 'rohfassung', 'mock'];
const KEEP = 200;

function dir(env) {
  const e = env || process.env;
  const d = e && typeof e.REGIE_DIR === 'string' && e.REGIE_DIR.trim() ? e.REGIE_DIR.trim() : path.join('data', 'regie');
  return path.resolve(ROOT, d);
}
const safeId = (id) => String(id || 'ohne-welt').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60) || 'ohne-welt';

function create(opts) {
  const o = opts || {};
  const d = o.dir || dir(o.env);
  const id = safeId(o.weltId);
  const file = path.join(d, id + '.jsonl');
  const rotateBytes = o.rotateBytes || DEFAULT_ROTATE;
  const onError = typeof o.onError === 'function' ? o.onError : () => {};
  const entries = [];
  let mkdirDone = false;
  const ensureDir = () => { if (!mkdirDone) { fs.mkdirSync(d, { recursive: true }); mkdirDone = true; } };

  function normalize(e) {
    const x = Object.assign({}, e || {});
    const out = {
      t: x.t || new Date().toISOString(),
      spielzeit: Number.isFinite(x.spielzeit) ? Math.round(x.spielzeit * 10) / 10 : null,
      art: String(x.art || 'notiz'),
      mission: x.mission != null ? String(x.mission) : null,
      szene: x.szene != null ? String(x.szene) : null,
      quelle: QUELLEN.includes(x.quelle) ? x.quelle : (x.quelle == null ? null : String(x.quelle)),
      dauer_s: Number.isFinite(x.dauer_s) ? Math.round(x.dauer_s * 100) / 100 : null,
      tokens: Number.isFinite(x.tokens) ? x.tokens : 0,
      fehler: Array.isArray(x.fehler) ? x.fehler.map((f) => String(f).slice(0, 300)).slice(0, 20) : [],
      begruendung: x.begruendung != null ? String(x.begruendung).slice(0, 500) : null,
    };
    if (x.wunsch != null) out.wunsch = x.wunsch;
    // QA S2b: automatische Reparaturen der Szenen-Antwort (spielleiter.js) mitschreiben
    if (Array.isArray(x.reparaturen) && x.reparaturen.length) out.reparaturen = x.reparaturen.map((r) => String(r).slice(0, 200)).slice(0, 10);
    for (const k of ['origin', 'titel', 'auftraggeber', 'ausgang', 'versuch', 'budget', 'key', 'plan']) if (x[k] !== undefined) out[k] = x[k];
    return out;
  }
  function rotate() {
    try {
      const st = fs.statSync(file);
      if (st.size < rotateBytes) return;
      const old = path.join(d, id + '.1.jsonl');
      try { fs.unlinkSync(old); } catch (e) { /* gab es nicht */ }
      fs.renameSync(file, old);
    } catch (e) { if (e.code !== 'ENOENT') onError(e); }
  }
  function write(e) {
    const rec = normalize(e);
    entries.push(rec); if (entries.length > KEEP) entries.splice(0, entries.length - KEEP);
    if (o.memoryOnly) return rec;
    try { ensureDir(); rotate(); fs.appendFileSync(file, JSON.stringify(rec) + '\n', 'utf8'); } catch (err) { onError(err); }
    return rec;
  }
  function wish(text, info) {
    const t = String(text || '').trim().slice(0, 200);
    if (!t) return;
    write({ art: 'wunsch', mission: info && info.mission, begruendung: t, wunsch: t, quelle: info && info.quelle });
    if (o.memoryOnly) return;
    const wf = path.join(d, 'wunschliste.json');
    try {
      ensureDir();
      let list = {};
      try { list = JSON.parse(fs.readFileSync(wf, 'utf8')); } catch (e) { list = {}; }
      if (!list || typeof list !== 'object' || Array.isArray(list)) list = {};
      const now = new Date().toISOString();
      const w = list[t] || { n: 0, zuerst: now, missionen: [] };
      w.n++; w.zuletzt = now;
      if (info && info.mission && !w.missionen.includes(info.mission)) w.missionen = w.missionen.concat([String(info.mission)]).slice(-20);
      list[t] = w;
      fs.writeFileSync(wf, JSON.stringify(list, null, 2) + '\n', 'utf8');
    } catch (err) { onError(err); }
  }
  return { dir: d, file, weltId: id, write, wish, entries };
}

// Alle Einträge eines Weltstands (rotierte Datei zuerst). Kaputte Zeilen werden übersprungen und gezählt.
function read(d, weltId) {
  const id = safeId(weltId);
  const out = []; let bad = 0;
  for (const f of [id + '.1.jsonl', id + '.jsonl']) {
    let raw = '';
    try { raw = fs.readFileSync(path.join(d, f), 'utf8'); } catch (e) { continue; }
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch (e) { bad++; }
    }
  }
  return { entries: out, bad };
}
function readWishes(d) {
  try { return JSON.parse(fs.readFileSync(path.join(d, 'wunschliste.json'), 'utf8')); } catch (e) { return {}; }
}

module.exports = { create, read, readWishes, dir, safeId, QUELLEN, DEFAULT_ROTATE };
