'use strict';
// Archiv des Spielleiters (CONTRACT-S2 §2.1): fertige Missionen als Grobplan-Aufzeichnungen, die durch dieselbe Pipeline
// laufen wie ein frisch erzeugter Plan (Grobplan-Prüfung → Szenen → Regiebuch → Prüfer). Inhalte liefert Team KATALOG
// nach content/spielleiter/archiv/*.json; dieses Modul liefert den Lader und das Format.
//
// FORMAT (eine Datei je Mission, wie tools/fixtures/llm/grobplan):
//   {
//     "format": "llm-aufzeichnung/1", "kind": "grobplan", "key": "<beliebig>", "name": "zollfeuer",
//     "quelle": "archiv" | "live", "modell"?: "sonnet",
//     "input"?: { … },                                   // was das LLM bekam (nur Doku)
//     "response": { "text": "<Grobplan als JSON-Text>" } // Format grobplan/2 (erinnerung als { npc, ereignis } | { fakt })
//     "szenen"?: { "<szenen-id>": <Szenen-Antwort> }      // optional: ausgearbeitete Szenenparameter je Szene
//                                                        //   Antwort = { molekuele, verzweigung, wendung } (Objekt)
//                                                        //   oder { "text": "…" } bzw. { "response": { "text": "…" } }
//     "erinnerung_varianten"?: [ { "erinnerung": { npc, ereignis } | { fakt }, "text": "sichtbare Erinnerung" } ],
//     "erinnerung_neutral"?: "Text, wenn keine Variante zum Weltstand passt",
//     "nur_wenn"?: { "fakt"?: "key", "npc_status"?: { "<npc>": "lebt" } }   // optional: Voraussetzung im Weltstand
//   }
// Fehlende Szenen spielen als Rohfassung (Rückfall-/Testparameter der Umsetzung).
//
//   Archiv.load(dir?, { erzeugtDir }?)  -> { entries: [entry], errors: [{ file, msg }] }
//                                          (+ freigegebene erzeugt/*/mission.json, §8c; entry.erzeugt/ordner gesetzt)
//   Archiv.mdStatus(mdText)             -> 'offen'|'angenommen'|'abgelehnt'|null (Frontmatter einer mission.md)
//   Archiv.pick(entries, gespielt, kontext, ausser?) -> entry | null   (ungespielte zuerst; Wiederholung erst, wenn alle gespielt)
//   Archiv.erinnerung(entry, kontext)   -> { ref: {…}|null, text }     (passende Variante oder neutral)
//   entry = { name, file, grobplan, szenen: { sid: answerObj }, rec }

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'content', 'spielleiter', 'archiv');
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

function parseJson(text) {
  const s = String(text); const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('kein JSON-Objekt');
  return JSON.parse(s.slice(a, b + 1));
}
function sceneAnswer(x) {
  if (!x) return null;
  if (isObj(x) && (x.molekuele || x.verzweigung || x.wendung !== undefined) && !x.text && !x.response) return x;
  const t = isObj(x) && x.response && typeof x.response.text === 'string' ? x.response.text : (isObj(x) && typeof x.text === 'string' ? x.text : (typeof x === 'string' ? x : null));
  return t == null ? null : parseJson(t);
}

// Ablage erzeugter Missionen (CONTRACT-S2 §8c): content/spielleiter/erzeugt/<JJJJ-MM-TT>_<kennung>/{mission.json,mission.md}.
// Zum Vorrat gehören nur Ordner, deren mission.md im Frontmatter `status: angenommen` trägt (Kai gibt von Hand frei).
const ERZEUGT_DIR = path.join(ROOT, 'content', 'spielleiter', 'erzeugt');
const erzeugtDir = (env) => ((env || process.env).ERZEUGT_DIR || ERZEUGT_DIR);
// Status aus dem Frontmatter einer mission.md ('offen' | 'angenommen' | 'abgelehnt' | null, wenn keiner steht)
function mdStatus(text) {
  const s = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---(\n|$)/.exec(s);
  if (!m) return null;
  const st = /^status:\s*["']?([A-Za-zäöü_-]+)["']?\s*(#.*)?$/m.exec(m[1]);
  return st ? st[1].toLowerCase() : null;
}

function readRecord(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const rec = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  if (!isObj(rec)) throw new Error('kein Objekt');
  return rec;
}
function entryOf(rec, name, file, errors, label) {
  const text = rec.response && typeof rec.response.text === 'string' ? rec.response.text : (isObj(rec.grobplan) ? JSON.stringify(rec.grobplan) : null);
  if (!text) throw new Error("'response.text' (Grobplan) fehlt");
  const grobplan = parseJson(text);
  if (!Array.isArray(grobplan.szenen)) throw new Error('Grobplan ohne Szenen');
  const szenen = {};
  for (const [sid, x] of Object.entries(isObj(rec.szenen) ? rec.szenen : {})) {
    try { const a = sceneAnswer(x); if (a) szenen[sid] = a; } catch (e) { errors.push({ file: label, msg: `Szene '${sid}': ${e.message}` }); }
  }
  return { name, file, grobplan, szenen, rec };
}

// opts: { erzeugtDir } – Ordner der Ablage (Standard: ohne `dir` ERZEUGT_DIR bzw. content/spielleiter/erzeugt;
//        mit `dir` nur, wenn ausdrücklich angegeben – Tests mit eigenem Archiv sehen Kais Freigaben nicht)
function load(dir, opts) {
  const o = opts || {};
  const d = dir || DIR;
  const entries = []; const errors = [];
  let files = [];
  try { files = fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort(); } catch (e) { files = []; }
  for (const f of files) {
    const file = path.join(d, f);
    try {
      const rec = readRecord(file);
      entries.push(entryOf(rec, String(rec.name || f.replace(/\.json$/, '')), file, errors, f));
    } catch (e) { errors.push({ file: f, msg: e.message }); }
  }
  const ed = o.erzeugtDir !== undefined ? o.erzeugtDir : (dir ? null : erzeugtDir());
  if (ed) loadErzeugt(ed, entries, errors);
  return { entries, errors };
}

// Freigegebene erzeugte Missionen anhängen (doppelte Kennungen – Name oder Grobplan-ID – werden übersprungen)
function loadErzeugt(dir, entries, errors) {
  let ordner = [];
  try { ordner = fs.readdirSync(dir, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort(); } catch (e) { return; }
  // Kennung = Ordner-/Archivname; dieselbe Mission (Grobplan-ID und Titel gleich, z. B. kopierter Ordner) nur einmal
  const gkey = (g) => (g && g.id ? `${g.id}|${g.titel || ''}` : null);
  const names = new Set(entries.map((e) => e.name));
  const gids = new Set(entries.map((e) => gkey(e.grobplan)).filter(Boolean));
  for (const o of ordner) {
    const label = `erzeugt/${o}`;
    let status = null;
    try { status = mdStatus(fs.readFileSync(path.join(dir, o, 'mission.md'), 'utf8')); } catch (e) { status = null; }
    if (status !== 'angenommen') continue;
    try {
      const file = path.join(dir, o, 'mission.json');
      const rec = readRecord(file);
      const e = entryOf(rec, o, file, errors, label);
      const k = gkey(e.grobplan);
      if (names.has(e.name) || (k && gids.has(k))) { errors.push({ file: label, msg: `doppelte Kennung '${e.grobplan.id || e.name}' („${e.grobplan.titel || ''}“) – übersprungen` }); continue; }
      names.add(e.name); if (k) gids.add(k);
      e.erzeugt = true; e.ordner = o;
      entries.push(e);
    } catch (e) { errors.push({ file: label, msg: e.message }); }
  }
}

// Voraussetzung im Weltstand erfüllt?
function fits(entry, kontext) {
  const nw = entry && entry.rec && entry.rec.nur_wenn;
  if (!isObj(nw)) return true;
  const k = kontext || {};
  if (nw.fakt && !(nw.fakt in (k.fakten || {}))) return false;
  if (isObj(nw.npc_status)) for (const [id, st] of Object.entries(nw.npc_status)) { const n = (k.npc || []).find((x) => x.id === id); if (!n || n.status !== st) return false; }
  return true;
}

// ungespielte zuerst (Dateireihenfolge), dann – wenn alle gespielt – wieder von vorn; `ausser` = gerade angebotene Namen
// vorzug (B1 §11.2, optional): { boden: true -> Bodenmissionen zuerst (Quote fällig), ohneLang: true -> lange Missionen nach
//   hinten (schon eine lange im Angebot), info(entry) -> { boden, lang } }. Der Vorzug ordnet nur, er schließt nichts aus.
function pick(entries, gespielt, kontext, ausser, vorzug) {
  let list = (entries || []).filter((e) => fits(e, kontext) && !(ausser || []).includes(e.name));
  if (!list.length) return null;
  const played = new Set(gespielt || []);
  const v = vorzug && typeof vorzug.info === 'function' ? vorzug : null;
  const infoOf = (e) => { try { return (v && v.info(e)) || {}; } catch (x) { return {}; } };
  // Quote fällig: Bodenmissionen gehen vor (auch vor ungespielten ohne Boden), sonst alle
  if (v && v.boden) { const mit = list.filter((e) => infoOf(e).boden); if (mit.length) list = mit; }
  const rang = (e) => (v && v.ohneLang && infoOf(e).lang ? 1 : 0);
  const best = (arr) => { if (!v) return arr[0]; let b = arr[0]; let r = rang(b); for (const e of arr.slice(1)) { const x = rang(e); if (x < r) { b = e; r = x; } } return b; };
  const fresh = list.filter((e) => !played.has(e.name));
  if (fresh.length) return best(fresh);
  // alle gespielt: der am längsten zurückliegende zuerst (mit Vorzug: erst nach Rang)
  const order = (gespielt || []).slice();
  const sorted = list.slice().sort((a, b) => (rang(a) - rang(b)) || (order.lastIndexOf(a.name) - order.lastIndexOf(b.name)));
  return sorted[0];
}

function refOk(ref, kontext) {
  const k = kontext || {};
  if (!isObj(ref)) return false;
  if (ref.neutral === true) return false;   // QA S2b: neutrale Erinnerung -> Archiv nimmt seine neutrale Variante
  if (typeof ref.fakt === 'string') return ref.fakt in (k.fakten || {});
  const n = (k.npc || []).find((x) => x.id === ref.npc);
  return !!(n && (n.gedaechtnis || []).some((g) => g.ereignis === ref.ereignis));
}
// Passende Erinnerung: Grobplan-Erinnerung, sonst erste passende Variante, sonst neutral
function erinnerung(entry, kontext) {
  const g = entry.grobplan || {};
  if (refOk(g.erinnerung, kontext)) return { ref: g.erinnerung, text: g.erinnerung_text || null };
  for (const v of (entry.rec && entry.rec.erinnerung_varianten) || []) if (refOk(v && v.erinnerung, kontext)) return { ref: v.erinnerung, text: v.text || null };
  const neutral = (entry.rec && entry.rec.erinnerung_neutral) || (typeof g.erinnerung === 'string' ? g.erinnerung : null);
  return { ref: null, text: neutral };
}

module.exports = { load, pick, fits, erinnerung, sceneAnswer, mdStatus, erzeugtDir, DIR, ERZEUGT_DIR };
