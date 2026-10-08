'use strict';
// S1 (CONTRACT-S1 §3.2): Regiebücher laden, prüfen und für die Laufzeit vorbereiten.
//   Loader.loadAll(dir?)    -> { books: { id: book }, invalid: [{ id, file, errors }], warnings: { id: [...] } }
//   Loader.prepare(book, C) -> Laufzeit-Def: cfg aufgelöst, def.title = kopf.titel, Texte bleiben @-Verweise
//   Loader.text(def, s, onError?) -> '@kennung' -> def.texte[kennung]; Literal unverändert; unbekannt -> '[kennung]' + onError
// Dazu NSC-Hilfen (content/npc.json, Funkname) und die Kurzform der Folgen aus der Vorarbeit.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BOOK_DIR = path.join(ROOT, 'content', 'regiebuecher');
const NPC_FILE = path.join(ROOT, 'content', 'npc.json');

// Funknamen wie in den JS-Modulen m1–m3 (damit Funk-Texte im Golden Trace gleich bleiben). content/npc.json kann je NSC
// ein Feld 'funkname' setzen, das hat Vorrang.
const NPC_LEGACY = {
  tesk: 'Hafenmeisterin Tesk', sela: 'Sela (Vaelen-Händlerin)', ivo: 'Techniker Ivo', grauzahn: 'Grauzahn (Rostmeute)',
  melk: 'Archivarin Melk', kustoden_relais: 'Kustoden-Relais',
};
// Weltstand-Aktionen in Kurzform { welt_fakt: {…} } bzw. { chronik: '@…' } (Vorarbeit m3) -> { do: …, … }
const FOLGE_SHORT = ['welt_fakt', 'npc_gedaechtnis', 'npc_haltung', 'npc_status', 'chronik', 'remove_item'];

let npcCache = null;
function npcData(reload) {
  if (npcCache && !reload) return npcCache;
  let data = { npc: {}, kampagne: {} };
  try {
    if (fs.existsSync(NPC_FILE)) data = Object.assign(data, JSON.parse(fs.readFileSync(NPC_FILE, 'utf8')));
  } catch (e) {
    console.warn('[Pantheon] content/npc.json nicht lesbar:', e.message);
  }
  if (!data.npc || typeof data.npc !== 'object') data.npc = {};
  npcCache = data;
  return data;
}
function npcIds() { return new Set([...Object.keys(NPC_LEGACY), ...Object.keys(npcData().npc)]); }
// Anzeigename im Funk: Stimme des Buchs -> funkname aus npc.json -> alter Name -> „Titel Name“ -> Kennung/Literal
function npcName(id, def) {
  if (typeof id !== 'string') return id;
  const st = def && def.besetzung && def.besetzung.stimmen && def.besetzung.stimmen[id];
  if (st && st.name) return st.name;
  const n = npcData().npc[id];
  if (n && n.funkname) return n.funkname;
  if (NPC_LEGACY[id]) return NPC_LEGACY[id];
  if (n && n.name) return n.titel ? `${n.titel} ${n.name}` : n.name;
  return id;
}

function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
function isCfgRef(x) { return isObj(x) && typeof x.cfg === 'string' && Object.keys(x).every((k) => k === 'cfg' || k === 'plus'); }
function cfgValue(ref, C) {
  const v = ref.cfg.split('.').reduce((o, k) => (o == null ? undefined : o[k]), C);
  return typeof v === 'number' ? v + (ref.plus || 0) : undefined;
}
function normalizeFolge(f) {
  if (!isObj(f) || 'do' in f) return f;
  const keys = Object.keys(f).filter((k) => k !== 'if' && k !== '_kommentar');
  if (keys.length !== 1 || !FOLGE_SHORT.includes(keys[0])) return f;
  const k = keys[0]; const v = f[k];
  const out = Object.assign({ do: k }, typeof v === 'string' ? { text: v } : (isObj(v) ? v : {}));
  if (f.if !== undefined) out.if = f.if;
  return out;
}

// Alle Bücher eines Ordners laden und prüfen
function loadAll(dir) {
  const Checker = require('./checker.js');
  dir = dir || BOOK_DIR;
  const books = {}; const invalid = []; const warnings = {};
  if (!fs.existsSync(dir)) return { books, invalid, warnings };
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  for (const f of files) {
    const file = path.join(dir, f);
    let doc;
    try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
      invalid.push({ id: f.replace(/(\.regiebuch)?\.json$/, ''), file, errors: [{ code: 'JSON', p: '$', msg: 'kein gültiges JSON: ' + e.message }] });
      continue;
    }
    let r;
    try { r = Checker.check(doc); } catch (e) { r = { errors: [{ code: 'PRUEFER', p: '$', msg: 'Prüfer abgestürzt: ' + e.message }], warnings: [] }; }
    const id = isObj(doc) && typeof doc.id === 'string' ? doc.id : f;
    if (r.errors.length) { invalid.push({ id, file, errors: r.errors }); continue; }
    if (books[id]) { invalid.push({ id, file, errors: [{ code: 'DOPPELT', p: 'id', msg: `Regiebuch '${id}' gibt es schon` }] }); continue; }
    books[id] = doc;
    warnings[id] = r.warnings;
  }
  return { books, invalid, warnings };
}

// Laufzeit-Def. Zahlen { cfg, plus } werden mit C (game.C, damit tune wirkt) aufgelöst; fehlende -> def.cfgErrors.
function prepare(book, C) {
  const cfgErrors = [];
  const walk = (node, p) => {
    if (Array.isArray(node)) return node.map((x, i) => walk(x, `${p}[${i}]`));
    if (isCfgRef(node)) {
      const v = cfgValue(node, C);
      if (v === undefined) { cfgErrors.push(`${p}: config-Wert '${node.cfg}' fehlt`); return 0; }
      return v;
    }
    if (isObj(node)) { const o = {}; for (const [k, v] of Object.entries(node)) o[k] = walk(v, `${p}.${k}`); return o; }
    return node;
  };
  const b = walk(book, '$');
  const ausgaenge = {};
  for (const [id, ag] of Object.entries(b.ausgaenge || {})) ausgaenge[id] = Object.assign({}, ag, { folgen: (ag.folgen || []).map(normalizeFolge) });
  const kopf = b.kopf || {};
  return {
    id: b.id, title: kopf.titel || b.id, isBook: true, kopf,
    art: kopf.art || 'mission', tutorial: !!kopf.tutorial,
    erwartet: b.erwartet || {}, angebot: b.angebot || {}, buch: b.buch || null, buehne: b.buehne || {}, besetzung: b.besetzung || {},
    steps: b.steps || [], on: b.on || {}, ausgaenge, texte: b.texte || {},
    debugPrep: (b.debug && b.debug.prep) || {}, debugDone: (b.debug && b.debug.done) || null,
    cfgErrors,
  };
}

function text(def, s, onError) {
  if (typeof s !== 'string' || s[0] !== '@') return s;
  const k = s.slice(1);
  if (def && def.texte && Object.prototype.hasOwnProperty.call(def.texte, k)) return def.texte[k];
  if (onError) onError(new Error(`Text '${s}' fehlt in ${def ? def.id : '?'}`));
  return '[' + k + ']';
}

module.exports = { BOOK_DIR, NPC_FILE, NPC_LEGACY, FOLGE_SHORT, loadAll, prepare, text, normalizeFolge, npcData, npcIds, npcName, cfgValue, isCfgRef };
