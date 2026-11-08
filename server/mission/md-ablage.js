'use strict';
// Gemeinsame Hilfen für Markdown-Ablagen mit Frontmatter und Notizen-Abschnitt (Missions-Ablage `ablage.js`, Mitschnitt
// `telemetrie/mitschnitt-render.js`). Aus ablage.js herausgelöst, Verhalten dort unverändert.
//
//   writeAtomic(file, text)              tmp + rename (Windows: EPERM/EBUSY/EACCES -> direkt schreiben)
//   slugify(s, n?) / localDate(d) / readJson(file) / mmss(sec)
//   notizenAus(text)                     -> Text des Abschnitts `## Notizen` bis Dateiende oder null
//   frontmatterWert(text, schluessel)    -> Wert (ohne Anführungszeichen/Kommentar) oder null
//   readMdFelder(file, schluessel[])     -> { felder: { <schluessel>: wert|null }, notizen }   (Datei fehlt -> alles null)
//   setFrontmatter(file, schluessel, wert) -> { ok, error? }   (setzt/ergänzt genau einen Schlüssel, Zeilenende bleibt)
//   NOTES_HEAD, NOTES_DEFAULT

const fs = require('fs');
const path = require('path');

const NOTES_HEAD = '## Notizen';
const NOTES_DEFAULT = '_Platz für Anmerkungen beim Review – dieser Abschnitt bleibt beim Neuschreiben erhalten._';

function slugify(s, n) {
  return String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, n || 48) || 'mission';
}
function localDate(d) {
  const x = d instanceof Date ? d : new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}
function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
}
let SEQ = 0;
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${++SEQ}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  try { fs.renameSync(tmp, file); } catch (e) {
    // Windows: Datei gerade in einem Editor offen (EPERM/EBUSY) -> direkt schreiben
    try { fs.unlinkSync(tmp); } catch (e2) { /* egal */ }
    if (e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES') fs.writeFileSync(file, text, 'utf8'); else throw e;
  }
}
function mmss(sec) { if (!Number.isFinite(sec)) return '–'; const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

const escRe = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c);
const normiere = (text) => String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
function notizenAus(text) {
  const s = normiere(text);
  const i = s.indexOf('\n' + NOTES_HEAD);
  if (i < 0) return null;
  const rest = s.slice(i + 1 + NOTES_HEAD.length);
  const nl = rest.indexOf('\n');
  return (nl >= 0 ? rest.slice(nl + 1) : '').replace(/^\n+|\s+$/g, '') || null;
}
function frontmatterWert(text, schluessel) {
  const m = /^---\n([\s\S]*?)\n---(\n|$)/.exec(normiere(text));
  if (!m) return null;
  const esc = escRe(schluessel);
  const z = new RegExp('^' + esc + ':[ \\t]*(.*)$', 'm').exec(m[1]);
  if (!z) return null;
  let v = z[1].replace(/\s+#.*$/, '').trim();
  if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
  return v === '' ? null : v;
}
function readMdFelder(file, schluessel) {
  const felder = {};
  for (const k of schluessel) felder[k] = null;
  let text = null;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return { felder, notizen: null }; }
  for (const k of schluessel) felder[k] = frontmatterWert(text, k);
  return { felder, notizen: notizenAus(text) };
}
function setFrontmatter(file, schluessel, wert) {
  try {
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const s = text.replace(/\r\n?/g, '\n');
    const zeile = `${schluessel}: ${wert}`;
    const re = new RegExp('^' + escRe(schluessel) + ':.*$', 'm');
    const m = /^---\n([\s\S]*?)\n---(\n|$)/.exec(s);
    let out;
    if (!m) out = `---\n${zeile}\n---\n\n` + s;
    else {
      const fm = re.test(m[1]) ? m[1].replace(re, () => zeile) : `${zeile}\n${m[1]}`;
      out = `---\n${fm}\n---${m[2]}` + s.slice(m[0].length);
    }
    writeAtomic(file, eol === '\n' ? out : out.replace(/\n/g, '\r\n'));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { writeAtomic, slugify, localDate, readJson, mmss, notizenAus, frontmatterWert, readMdFelder, setFrontmatter, NOTES_HEAD, NOTES_DEFAULT };
