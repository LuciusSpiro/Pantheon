'use strict';
// TEL-01 A: Sessionkopf und Tuning-Stand. Alles hier läuft einmal je Session (nie je Tick).
//   baueKopf(game)        -> Objekt für die erste Zeile (typ 'kopf'), ohne Namen, ohne Schlüssel
//   tuningStand(game)     -> { hash, teile: { config, '<werte-datei>': hash }, json } (json = Inhalt von tuning/<hash>.json)
//   commit()              -> Commit aus .git (kein Prozess; Worktree-tauglich), im Prozess gemerkt

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const CONTENT = path.join(ROOT, 'content');
// Positivliste der Schalter, die in den Kopf dürfen (keine Schlüssel, Token, URLs)
const SCHALTER = ['FAEDEN', 'WAFFEN', 'REISE_EREIGNISSE', 'LAGE_SPIELLEITER', 'SPIELLEITER_LLM', 'TEXTE_POOL', 'RUESTPHASE', 'MISSION_SOURCE', 'DEBUG', 'LLM_ROUTER'];

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

// Vorbild: tools/sync-assets.mjs readCommit (HEAD -> ref -> loose ref/packed-refs, Worktree über commondir)
let commitMerk;
function commit() {
  if (commitMerk !== undefined) return commitMerk;
  commitMerk = null;
  try {
    let gitDir = path.join(ROOT, '.git');
    if (fs.statSync(gitDir).isFile()) gitDir = path.resolve(ROOT, fs.readFileSync(gitDir, 'utf8').replace(/^gitdir:/, '').trim());
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref:')) return (commitMerk = head);
    const ref = head.slice(4).trim();
    const common = fs.existsSync(path.join(gitDir, 'commondir')) ? path.resolve(gitDir, fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim()) : gitDir;
    for (const base of [gitDir, common]) {
      const loose = path.join(base, ref);
      if (fs.existsSync(loose)) return (commitMerk = fs.readFileSync(loose, 'utf8').trim());
    }
    const line = fs.readFileSync(path.join(common, 'packed-refs'), 'utf8').split('\n').find((l) => l.endsWith(' ' + ref));
    commitMerk = line ? line.split(' ')[0] : null;
  } catch (e) { /* ohne Git: null */ }
  return commitMerk;
}

// JSON-sichere Kopie: Funktionen, Symbole, Zyklen und exotische Objekte (Map, Set …) fallen weg
function sicher(v, weg) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'object') return undefined;
  const w = weg || new Set();
  if (w.has(v)) return undefined;
  const proto = Object.getPrototypeOf(v);
  if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) return undefined;
  w.add(v);
  let out;
  if (Array.isArray(v)) out = v.map((x) => { const s = sicher(x, w); return s === undefined ? null : s; });
  else { out = {}; for (const k of Object.keys(v)) { const s = sicher(v[k], w); if (s !== undefined) out[k] = s; } }
  w.delete(v);
  return out;
}

function werteDateien(dir, out) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) werteDateien(f, out); else if (/-werte\.json$|^werte\.json$/.test(e.name)) out.push(f);
  }
  return out;
}
// Dateiinhalt je Prozess gemerkt (Größe + mtime als Schlüssel): die Dateien ändern sich im Lauf nicht
const dateiMerk = new Map();
function dateiText(f) {
  const st = fs.statSync(f);
  const k = st.size + ':' + st.mtimeMs;
  const m = dateiMerk.get(f);
  if (m && m.k === k) return m.text;
  const text = fs.readFileSync(f, 'utf8');
  dateiMerk.set(f, { k, text });
  return text;
}

function tuningStand(game) {
  const teile = {}; const werte = {};
  const config = JSON.stringify(sicher(game.C));
  teile.config = hash(config);
  for (const f of werteDateien(CONTENT, []).sort()) {
    const rel = path.relative(CONTENT, f).split(path.sep).join('/');
    try { const text = dateiText(f); teile[rel] = hash(text); werte[rel] = JSON.parse(text); } catch (e) { teile[rel] = 'fehler'; }
  }
  const gesamt = hash(Object.keys(teile).sort().map((k) => k + '=' + teile[k]).join(';'));
  return { hash: gesamt, teile, json: () => JSON.stringify({ v: 1, hash: gesamt, teile, config: JSON.parse(config), werte }) };
}

function schalter(env) {
  const out = {};
  for (const k of SCHALTER) {
    const v = env && env[k];
    if (v == null || v === '') continue;
    const s = String(v);
    out[k] = /[:/\@]/.test(s) || s.length > 40 ? '[gesetzt]' : s;   // nichts, was nach URL, Pfad oder Schlüssel aussieht
  }
  return out;
}

const jaNein = (o) => (o && typeof o === 'object' ? sicher(o) : null);

function baueKopf(game, ctx) {
  const env = game.env || {};
  const lo = game.lobbyOpts || {};
  const ws = game.weltstand;
  const sh = game.ship || {};
  const Regielog = require('../mission/regielog.js');
  const tuning = ctx.tuning;
  return {
    commit: commit(),
    server_version: game.serverVersion,
    plattform: process.platform + '-' + process.arch,
    node: process.version,
    run_id: game.runId,
    seed: game.seed,
    modus: lo.startMission || null,
    szenario: lo.labor && lo.startMission === 'labor' ? lo.labor.id || null : (lo.szene || lo.wellen || null),
    weltstand: ws && ws.persistent ? ws.id : null,
    regielog: Regielog.safeId((ws && ws.id) || 'ohne-welt') + '.jsonl',
    quelle: ctx.quelle,
    spielerzahl: game.players.length,
    slots: game.players.map((p) => ({ slot: p.id, konsole: p.console || null, verbunden: !!p.connected })),   // nie Name, Karte, clientId
    schiff: { stufe: sh.stufe == null ? null : sh.stufe, module: jaNein(sh.module), waffen: jaNein(sh.waffen), ort: sh.scene || null },
    schalter: schalter(env),
    tuning_hash: tuning.hash,
    tuning_teile: tuning.teile,
  };
}

module.exports = { baueKopf, tuningStand, commit, sicher, schalter, SCHALTER };
