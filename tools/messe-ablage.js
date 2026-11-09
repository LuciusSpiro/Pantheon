'use strict';
// LIV-01 C: gemeinsame Ablage der Messwerkzeuge der Live-Messung (messe-abenteuer.js, messe-lage.js): je Plan eine Markdown-Datei, index.md mit Links, messung.json.
// Die Ablage liegt NIE im Repo, wird nie geloescht und nie ueberschrieben: jeder Aufruf legt einen neuen Lauf-Ordner <Praefix>-<JJJJMMTT-HHMMSS>[-n] unter der Wurzel an (--out <Ordner>).
//   wurzelPruefen(arg, cwd)          -> absoluter Pfad der Wurzel (relativ gegen cwd des Aufrufers); wirft Error mit code 'ABLAGE', wenn sie im Repo liegt
//   laufOrdner(wurzel, praefix)      -> neuer, leerer Lauf-Ordner (mkdir ohne recursive fuer den Lauf: ein vorhandener Ordner wird nie wiederverwendet)
//   schreibe(ordner, name, text)     schreibt eine Datei (kein Pfad ausserhalb des Ordners, kein Ueberschreiben)
//   frontmatter(obj), zaun(text, sprache), median(a), perzentil(a, p), fmt(x, d), prozent(a, b), sha1(text), zeit(d)
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..');

function ablageFehler(msg) { const e = new Error(msg); e.code = 'ABLAGE'; return e; }
const innerhalb = (kind, eltern) => { const r = path.relative(eltern, kind); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

function wurzelPruefen(arg, cwd) {
  if (typeof arg !== 'string' || !arg.trim()) throw ablageFehler('--out braucht einen Ordner');
  const abs = path.resolve(cwd || process.cwd(), arg);
  if (innerhalb(abs, REPO)) throw ablageFehler(`--out ${abs} liegt im Repo (${REPO}); die Ablage gehoert nach aussen (z. B. ${path.join(os.tmpdir(), 'messung')})`);
  return abs;
}

const zwei = (n) => String(n).padStart(2, '0');
function zeit(d) { d = d || new Date(); return `${d.getFullYear()}${zwei(d.getMonth() + 1)}${zwei(d.getDate())}-${zwei(d.getHours())}${zwei(d.getMinutes())}${zwei(d.getSeconds())}`; }

function laufOrdner(wurzel, praefix) {
  fs.mkdirSync(wurzel, { recursive: true });
  const basis = `${praefix}-${zeit()}`;
  for (let i = 0; i < 1000; i++) {
    const ordner = path.join(wurzel, i ? `${basis}-${i + 1}` : basis);
    try { fs.mkdirSync(ordner); return ordner; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  throw ablageFehler('kein freier Lauf-Ordner unter ' + wurzel);
}

function schreibe(ordner, name, text) {
  if (path.basename(name) !== name) throw ablageFehler('Dateiname ohne Pfad erwartet: ' + name);
  fs.writeFileSync(path.join(ordner, name), text, { encoding: 'utf8', flag: 'wx' });
  return name;
}

// YAML-Frontmatter: Zeichenketten als JSON-String (immer gueltiges YAML), Zahlen, Wahrheitswerte, null, Listen im Flussformat
function wert(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return '[' + v.map(wert).join(', ') + ']';
  return JSON.stringify(String(v));
}
function frontmatter(obj) {
  return '---\n' + Object.entries(obj).map(([k, v]) => `${k}: ${wert(v)}`).join('\n') + '\n---\n';
}
// Codezaun, der laenger ist als jede Gravis-Folge im Text (Rohantworten enthalten selbst Zaeune)
function zaun(text, sprache) {
  const t = String(text == null ? '' : text);
  const laengste = (t.match(/`+/g) || []).reduce((m, s) => Math.max(m, s.length), 0);
  const z = '`'.repeat(Math.max(3, laengste + 1));
  return `${z}${sprache || ''}\n${t.replace(/\s+$/, '')}\n${z}\n`;
}

const sortiert = (a) => a.filter(Number.isFinite).slice().sort((x, y) => x - y);
function median(a) { const s = sortiert(a); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function perzentil(a, p) { const s = sortiert(a); if (!s.length) return null; return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; }
const fmt = (x, d) => (Number.isFinite(x) ? (Math.round(x * (d || 1)) / (d || 1)).toLocaleString('de-DE', { maximumFractionDigits: 4 }) : '–');
const prozent = (a, b) => (b ? fmt((100 * a) / b, 10) + ' %' : '–');
const sha1 = (t) => crypto.createHash('sha1').update(String(t)).digest('hex');
const zelle = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');


// lesbarer Plan aus dem gelesenen Bauplan: Titel, Anlass, Beats mit ihren Angaben
function planLesbar(gelesen) {
  if (!gelesen || !gelesen.plan) return `_Kein lesbarer Plan_${gelesen && gelesen.fehler ? ' (' + gelesen.fehler + ')' : ''}.\n`;
  const p = gelesen.plan, L = [];
  L.push(`**Titel:** ${p.titel != null ? p.titel : '–'}`, '', `**Anlass:** ${p.anlass != null ? p.anlass : '–'}`, '');
  if (p.namenlos) L.push('Namenlos: ja', '');
  L.push('**Beats:**', '');
  (Array.isArray(p.beats) ? p.beats : []).forEach((b, i) => {
    if (!b || typeof b !== 'object') { L.push(`${i + 1}. ${JSON.stringify(b)}`); return; }
    const rest = Object.assign({}, b); delete rest.typ;
    L.push(`${i + 1}. \`${b.typ}\`${Object.keys(rest).length ? ' – ' + Object.entries(rest).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('; ') : ''}`);
  });
  return L.join('\n') + '\n';
}
module.exports = { planLesbar, REPO, wurzelPruefen, laufOrdner, schreibe, frontmatter, zaun, median, perzentil, fmt, prozent, sha1, zeit, zelle, innerhalb };
