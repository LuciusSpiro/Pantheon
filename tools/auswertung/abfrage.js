'use strict';
// TEL-01 D2: Abfrage der Protokolle per SQL. Alle Sessions liegen in einer lokalen SQLite-Datei (data/telemetrie/abfrage.sqlite, gitignored, kein Serverbetrieb), eingebautes node:sqlite (Node >= 22.13, keine neue
// Abhaengigkeit; Entscheidung von Kai). Die Datei ist abgeleitet: loeschen und neu laden ist immer erlaubt. Laden: tools/abfrage-laden.js (npm run abfrage:laden), Fragen: tools/abfrage.js (npm run abfrage).
//
// TABELLEN
//   sessions     eine Zeile je Session: kennung, quelle, commit_hash, plattform, modus, szenario, gruppe (Gruppen-ID wie in der Basis: modus[/szenario]/spielerzahl), spielerzahl (bereinigt: verbundene Spieler im
//                ersten Fenster), spielerzahl_kopf (Rohwert aus dem Sessionkopf), seed, weltstand, dauer_s, tuning_hash, schema_version, ende_grund (NULL = kein session_ende, Session nicht sauber beendet), datei (Dateiname, ohne Pfad)
//                (commit_hash statt commit: COMMIT ist in SQL ein Schluesselwort)
//   kennzahlen   das flache Kennzahlen-Objekt je Session (kennzahlen.js flach): kennung, schluessel (z. B. f2.quote.boden.lanze), wert
//   ereignisse   alle Zeilen ausser dem Kopf: kennung, zeile (laufende Nummer in der Session, der Kopf ist 1), t, tick, typ, szene_nr (laufende Szenennummer: waechst bei jedem szene_start, 0 vor der ersten), json (die Zeile als jsonb-BLOB; lesbar mit json(json), json_extract(json, '$.feld') geht direkt)
//                Beide grossen Tabellen sind normale rowid-Tabellen mit UNIQUE (kennung, ...): WITHOUT ROWID brachte mit den langen Kennungen im Schluessel und den langen Zeilen keinen Vorteil (gemessen an 192 Sessions: 272 MB mit WITHOUT ROWID und Text-JSON, 133 MB mit rowid und jsonb)
// VIEWS (aus schema.js erzeugt, nicht von Hand: kommt ein Feld ins Schema, steht es in der View)
//   v_<typ> je Schema-Typ ausser kopf (v_schuss, v_treffer, v_kill, v_szene_start, v_szene_ende, v_zeitreihe, ...): kennung, zeile, t, tick, szene_nr + je Feld des Typs eine Spalte (json_extract; Listen als JSON-Text,
//   Wahrheitswerte 1/0). v_szene ist die View von szene_ende (Dauer und Ausgang je Szene). Ein Schema-Feld, das so heisst wie eine Basisspalte (kennung, zeile, t, tick, szene_nr), ist verboten (Fehler beim Aufbau).
// Die Datenbank enthaelt nur, was im Protokoll steht: keine Namen (Protokoll und Test dazu).
// Inkrementell: eine Session mit session_ende wird nur einmal geladen (ueber die Kennung); eine ohne (noch laufend oder abgebrochen) beim naechsten Laden neu. Aendert sich KENNZAHL_VERSION oder die Schema-Version der
// Datenbank, wird sie neu aufgebaut.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { SCHEMA } = require('../../server/telemetrie/schema.js');
const Lesen = require('./lesen.js');
const { kennzahlen, flach, KENNZAHL_VERSION } = require('./kennzahlen.js');
const Basis = require('./basis.js');

const ROOT = path.join(__dirname, '..', '..');
const DB_STANDARD = path.join(ROOT, 'data', 'telemetrie', 'abfrage.sqlite');
const DB_VERSION = 2;                                  // Aufbau der Tabellen; aendert er sich, wird neu geladen
const BASIS_SPALTEN = ['kennung', 'zeile', 't', 'tick', 'szene_nr'];
const KEIN_SCHEMA_TYP = new Set(['kopf']);             // der Kopf steht in sessions
const VIEW_ALIAS = { szene: 'szene_ende' };            // v_szene = v_szene_ende
const ANWEISUNG = /^(select|with|values|explain)\b/i;   // nur lesende Anweisungen (VACUUM INTO und ATTACH schreiben auch auf einer lesenden Verbindung)
const ZEIT_STANDARD_S = 60;                            // Zeitlimit einer Abfrage in Sekunden (--zeit)
const ZEILEN_MAX = 1000;                               // Standard: so viele Zeilen gibt die Tabellenausgabe hoechstens aus (0 = alle)

// node:sqlite ohne die ExperimentalWarning (sie meldet nur "SQLite ist experimentell"); alle anderen Warnungen laufen unveraendert weiter
let sqliteModul = null;
function sqlite() {
  if (sqliteModul) return sqliteModul;
  const orig = process.emitWarning;
  process.emitWarning = function (w, ...rest) {
    const text = String((w && w.message) || w);
    if (/SQLite/i.test(text) && (rest[0] === 'ExperimentalWarning' || (rest[0] && rest[0].type === 'ExperimentalWarning') || (w && w.name === 'ExperimentalWarning'))) return undefined;
    return orig.call(process, w, ...rest);
  };
  try { sqliteModul = require('node:sqlite'); } finally { process.emitWarning = orig; }
  return sqliteModul;
}

class AbfrageFehler extends Error {}

// ---------- Aufbau ----------
const q = (name) => '"' + String(name).replace(/"/g, '""') + '"';

// SQL der Views aus dem Schema: [{ name, sql }]
function viewsAusSchema(schema) {
  const out = [];
  for (const typ of Object.keys(schema).sort()) {
    if (KEIN_SCHEMA_TYP.has(typ)) continue;
    const felder = schema[typ].felder || [];
    for (const f of felder) if (BASIS_SPALTEN.includes(f)) throw new AbfrageFehler('Schema-Feld ' + typ + '.' + f + ' heisst wie eine Basisspalte der Views (' + BASIS_SPALTEN.join(', ') + ')');
    const spalten = BASIS_SPALTEN.concat(felder.map((f) => "json_extract(json, '$." + f + "') AS " + q(f)));
    out.push({ name: 'v_' + typ, sql: 'CREATE VIEW v_' + typ + ' AS SELECT ' + spalten.join(', ') + " FROM ereignisse WHERE typ = '" + typ + "'" });
  }
  for (const alias of Object.keys(VIEW_ALIAS)) out.push({ name: 'v_' + alias, sql: 'CREATE VIEW v_' + alias + ' AS SELECT * FROM v_' + VIEW_ALIAS[alias] });
  return out;
}

const TABELLEN = [
  'CREATE TABLE IF NOT EXISTS meta (schluessel TEXT PRIMARY KEY, wert TEXT)',
  `CREATE TABLE IF NOT EXISTS sessions (kennung TEXT PRIMARY KEY, quelle TEXT, commit_hash TEXT, plattform TEXT, modus TEXT, szenario TEXT, gruppe TEXT, spielerzahl INTEGER, spielerzahl_kopf INTEGER,
     seed INTEGER, weltstand TEXT, dauer_s REAL, tuning_hash TEXT, schema_version INTEGER, ende_grund TEXT, datei TEXT)`,
  'CREATE TABLE IF NOT EXISTS kennzahlen (kennung TEXT NOT NULL, schluessel TEXT NOT NULL, wert REAL, UNIQUE (kennung, schluessel))',
  'CREATE TABLE IF NOT EXISTS ereignisse (kennung TEXT NOT NULL, zeile INTEGER NOT NULL, t REAL, tick INTEGER, typ TEXT NOT NULL, szene_nr INTEGER, json BLOB NOT NULL, UNIQUE (kennung, zeile))',
  'CREATE INDEX IF NOT EXISTS ereignisse_typ ON ereignisse (typ, kennung)',
  'CREATE INDEX IF NOT EXISTS kennzahlen_schluessel ON kennzahlen (schluessel)',
];

function viewsNeu(db, schema) {
  for (const v of db.prepare("SELECT name FROM sqlite_master WHERE type = 'view'").all()) db.exec('DROP VIEW IF EXISTS ' + q(v.name));
  for (const v of viewsAusSchema(schema || SCHEMA)) db.exec(v.sql);
}

// Datenbank zum Laden: anlegen oder oeffnen; Tabellen und Views sicherstellen. Rueckgabe { db, neuAufgebaut }
function oeffnenZumLaden(datei, opt) {
  const f = path.resolve(datei || DB_STANDARD);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const { DatabaseSync } = sqlite();
  const schnell = (d) => { d.exec('PRAGMA journal_mode = MEMORY'); d.exec('PRAGMA synchronous = OFF'); return d; };   // abgeleitete Datei: bei einem Absturz mitten im Laden neu laden, kein Journal-Aufwand
  let db = schnell(new DatabaseSync(f));
  let neu = false;
  const meta = (k) => { try { const r = db.prepare('SELECT wert FROM meta WHERE schluessel = ?').get(k); return r ? r.wert : null; } catch (e) { return null; } };
  if (meta('db_version') !== String(DB_VERSION) || meta('kennzahl_version') !== String(KENNZAHL_VERSION)) {
    if (meta('db_version') != null || meta('kennzahl_version') != null) {   // fremder Stand: von vorn (die Datei ist abgeleitet)
      db.close();
      for (const s of ['', '-journal']) { try { fs.rmSync(f + s, { force: true }); } catch (e) { /* weg */ } }
      db = schnell(new DatabaseSync(f));
      neu = true;
    }
  }
  for (const s of TABELLEN) db.exec(s);
  viewsNeu(db, (opt && opt.schema) || SCHEMA);
  const setze = db.prepare('INSERT INTO meta (schluessel, wert) VALUES (?, ?) ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert');
  setze.run('db_version', String(DB_VERSION));
  setze.run('kennzahl_version', String(KENNZAHL_VERSION));
  return { db, neuAufgebaut: neu };
}

// Datenbank zum Fragen: NUR LESEND (readOnly). Schreib-SQL scheitert hier schon an der Verbindung.
function oeffnenLesend(datei) {
  const f = path.resolve(datei || DB_STANDARD);
  if (!fs.existsSync(f)) throw new AbfrageFehler('Datenbank ' + f + ' gibt es nicht: zuerst `npm run abfrage:laden` ausfuehren');
  const { DatabaseSync } = sqlite();
  return new DatabaseSync(f, { readOnly: true });
}

// ---------- Laden ----------
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ganz = (v) => (num(v) == null ? null : Math.trunc(v));

// Eine Session in die Datenbank (in einer Transaktion; eine vorhandene gleicher Kennung wird ersetzt). protokoll = lesen.js-Ergebnis, kz = kennzahlen(protokoll)
function sessionEinfuegen(db, protokoll, kz, stmts) {
  const kennung = protokoll.kennung;
  const k = kz.kopf || {};
  const st = stmts || vorbereiten(db);
  db.exec('BEGIN');
  try {
    st.delSession.run(kennung); st.delKz.run(kennung); st.delEr.run(kennung);
    st.insSession.run(kennung, k.quelle || null, k.commit || null, k.plattform || null, k.modus || null, k.szenario || null, Basis.gruppenId(k), ganz(k.spielerzahl), ganz(k.spielerzahl_kopf),
      ganz(k.seed), k.weltstand || null, num(k.dauer), k.tuning_hash || null, ganz(k.schema_version), k.grund || null, protokoll.dateien.length ? path.basename(protokoll.dateien[0]) : null);
    const f = flach(kz);
    for (const s of Object.keys(f)) st.insKz.run(kennung, s, f[s]);
    let szene = 0, nr = 0;
    for (const z of protokoll.zeilen) {
      nr++;
      if (z.typ === 'kopf') continue;
      if (z.typ === 'szene_start') szene++;
      st.insEr.run(kennung, nr, num(z.t), ganz(z.tick), String(z.typ), szene, JSON.stringify(z));
    }
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch (x) { /* nichts offen */ } throw e; }
}
function vorbereiten(db) {
  return {
    delSession: db.prepare('DELETE FROM sessions WHERE kennung = ?'), delKz: db.prepare('DELETE FROM kennzahlen WHERE kennung = ?'), delEr: db.prepare('DELETE FROM ereignisse WHERE kennung = ?'),
    insSession: db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'), insKz: db.prepare('INSERT INTO kennzahlen VALUES (?, ?, ?)'),
    insEr: db.prepare('INSERT INTO ereignisse VALUES (?, ?, ?, ?, ?, ?, jsonb(?))'),
  };
}

// Alle Sessions unter den Ordnern laden. Rueckgabe { gefunden, geladen, uebersprungen, fehler: [{ kennung, fehler }], doppelt: [kennung] }
// doppelt: dieselbe Kennung in zwei verschiedenen Ordnern (Laufkennungen sind Zeit + Zaehler; zwei Prozesse, die in derselben Millisekunde starten, koennen dieselbe vergeben): die zweite wird NICHT geladen
// und hier gemeldet. Dieselbe Datei ueber zwei sich ueberlappende Ordner (data/telemetrie und data/telemetrie/bot) ist keine Doppelung.
function laden(db, ordner, opt) {
  const st = vorbereiten(db);
  const fertig = new Set(db.prepare('SELECT kennung FROM sessions WHERE ende_grund IS NOT NULL').all().map((r) => r.kennung));
  const gesehen = new Map();
  const erg = { gefunden: 0, geladen: 0, uebersprungen: 0, fehler: [], doppelt: [] };
  for (const o of ordner) {
    for (const e of Lesen.ordnerSessions(o)) {
      if (gesehen.has(e.kennung)) { if (gesehen.get(e.kennung) !== e.dir) erg.doppelt.push(e.kennung); continue; }
      gesehen.set(e.kennung, e.dir);
      erg.gefunden++;
      if (fertig.has(e.kennung)) { erg.uebersprungen++; continue; }
      try {
        const p = Lesen.lesen(e.kennung, { dirs: [e.dir] });
        if (!p.zeilen.length) throw new Error('keine gueltige Zeile');
        sessionEinfuegen(db, p, kennzahlen(p), st);
        erg.geladen++;
        if (opt && opt.fortschritt) opt.fortschritt(erg, e.kennung);
      } catch (err) { erg.fehler.push({ kennung: e.kennung, fehler: err.message }); }
    }
  }
  return erg;
}

// ---------- Fragen ----------
function ohneKommentar(sql) {
  let s = String(sql);
  for (;;) {
    const a = s.replace(/^\s+/, '');
    const m = /^(--[^\n]*(\n|$)|\/\*[\s\S]*?\*\/)/.exec(a);
    if (!m) return a;
    s = a.slice(m[0].length);
  }
}
// Gibt es hinter der ersten Anweisung noch etwas? (Semikolon ausserhalb von Texten, Bezeichnern in '...', "...", `...`, [...] und Kommentaren)
function mehrereAnweisungen(sql) {
  let i = 0; const s = String(sql);
  while (i < s.length) {
    const c = s[i];
    if (c === "'" || c === '"' || c === '`') { const e = s.indexOf(c, i + 1); if (e < 0) return false; i = e + 1; continue; }
    if (c === '[') { const e = s.indexOf(']', i + 1); if (e < 0) return false; i = e + 1; continue; }   // [Bezeichner] (SQLite-Schreibweise): ein ; darin trennt nichts
    if (c === '-' && s[i + 1] === '-') { const e = s.indexOf('\n', i); if (e < 0) return false; i = e + 1; continue; }
    if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); if (e < 0) return false; i = e + 2; continue; }
    if (c === ';') return ohneKommentar(s.slice(i + 1)).trim() !== '';
    i++;
  }
  return false;
}

// Eine lesende Anweisung ausfuehren. Rueckgabe { spalten: [name], zeilen: [[wert]] }. Alle Fehler sind AbfrageFehler mit verstaendlicher Meldung.
function ausfuehren(db, sql) {
  const roh = String(sql == null ? '' : sql);
  const s = ohneKommentar(roh);
  if (!s.trim()) throw new AbfrageFehler('keine SQL-Anweisung angegeben');
  if (!ANWEISUNG.test(s)) throw new AbfrageFehler('nur lesende Abfragen sind erlaubt (SELECT, WITH, VALUES, EXPLAIN); die Datenbank ist abgeleitet und wird nur von `npm run abfrage:laden` veraendert');
  if (mehrereAnweisungen(roh)) throw new AbfrageFehler('nur eine Anweisung je Abfrage (Semikolon nur am Ende)');
  try {
    const stmt = db.prepare(roh);
    stmt.setReturnArrays(true);
    const spalten = stmt.columns().map((c) => c.name);
    return { spalten, zeilen: stmt.all().map((r) => Array.from(r)) };
  } catch (e) {
    const m = String((e && e.message) || e);
    if (/readonly/i.test(m)) throw new AbfrageFehler('nur lesende Abfragen sind erlaubt: ' + m);
    throw new AbfrageFehler('SQL-Fehler: ' + m + ' (Tabellen und Spalten: npm run abfrage -- --schema)');
  }
}

// Wie ausfuehren, aber mit Zeitlimit: die Abfrage laeuft in einem Kindprozess (abfrage-kind.js), der nach `sekunden` abgeschossen wird (AbfrageFehler mit Hinweis auf --zeit).
// datei = Datenbankdatei (die Verbindung oeffnet der Kindprozess selbst, lesend).
function ausfuehrenMitLimit(datei, sql, sekunden) {
  const s = sekunden == null ? ZEIT_STANDARD_S : sekunden;
  const f = path.resolve(datei || DB_STANDARD);
  if (!fs.existsSync(f)) throw new AbfrageFehler('Datenbank ' + f + ' gibt es nicht: zuerst `npm run abfrage:laden` ausfuehren');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'abfrage-kind.js'), f], { input: String(sql == null ? '' : sql), encoding: 'utf8', maxBuffer: 1 << 30, timeout: s > 0 ? Math.round(s * 1000) : undefined, killSignal: 'SIGKILL', windowsHide: true });
  if (r.error && r.error.code === 'ETIMEDOUT') throw new AbfrageFehler('Abbruch: die Abfrage lief laenger als ' + s + ' s (Zeitlimit, mit --zeit <s> aenderbar; 0 = ohne Limit). Vermutlich fehlt eine Bedingung (Join ohne Schluessel, rekursive Abfrage ohne Ende).');
  if (r.error) throw new AbfrageFehler('Abfrage nicht ausfuehrbar: ' + r.error.message);
  let o;
  try { o = JSON.parse(r.stdout); } catch (e) { throw new AbfrageFehler('Abfrage ohne Ergebnis beendet (Exit ' + r.status + '): ' + String(r.stderr || '').trim().slice(0, 300)); }
  if (o.fehler) throw new AbfrageFehler(o.fehler);
  return o;
}

// ---------- Ausgabe ----------
const zelle = (v) => (v == null ? '' : typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6).replace('.', ',') : typeof v === 'bigint' ? String(v) : String(v));
function tabelle(res, max) {
  const m = max == null ? ZEILEN_MAX : max;
  const z = m > 0 ? res.zeilen.slice(0, m) : res.zeilen;
  const esc = (t) => t.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const out = ['| ' + res.spalten.map(esc).join(' | ') + ' |', '|' + res.spalten.map(() => '---').join('|') + '|'];
  for (const r of z) out.push('| ' + r.map((v) => esc(zelle(v))).join(' | ') + ' |');
  out.push('', '_' + res.zeilen.length + (res.zeilen.length === 1 ? ' Zeile' : ' Zeilen') + (z.length < res.zeilen.length ? ', davon die ersten ' + z.length + ' gezeigt (--max 0 zeigt alle)' : '') + '._');
  return out.join('\n') + '\n';
}
function csv(res) {
  const esc = (v) => { const t = v == null ? '' : String(v); return /[",;\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  return [res.spalten.map(esc).join(',')].concat(res.zeilen.map((r) => r.map(esc).join(','))).join('\n') + '\n';
}

// Tabellen und Views mit ihren Spalten (fuer --schema)
function schemaText(db) {
  const out = [];
  for (const o of db.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type DESC, name").all()) {
    const sp = db.prepare('PRAGMA table_info(' + q(o.name) + ')').all().map((c) => c.name);
    out.push((o.type === 'view' ? 'View    ' : 'Tabelle ') + o.name + ': ' + sp.join(', '));
  }
  return out.join('\n') + '\n';
}

// ---------- Beispielabfragen (tools/auswertung/abfragen.sql) ----------
// Format: "-- @name <name>", danach Kommentarzeilen "-- ..." (Beschreibung), danach das SQL bis zum naechsten "-- @name".
function beispiele(text) {
  const out = [];
  let cur = null;
  for (const zeile of String(text).split(/\r?\n/)) {
    const m = /^--\s*@name\s+(\S+)\s*$/.exec(zeile);
    if (m) { cur = { name: m[1], text: [], sql: [] }; out.push(cur); continue; }
    if (!cur) continue;
    if (!cur.sql.length && /^--/.test(zeile)) cur.text.push(zeile.replace(/^--\s?/, ''));
    else if (cur.sql.length || zeile.trim()) cur.sql.push(zeile);
  }
  return out.map((b) => ({ name: b.name, text: b.text.join(' ').trim(), sql: b.sql.join('\n').trim() })).filter((b) => b.sql);
}
const BEISPIELE_DATEI = path.join(__dirname, 'abfragen.sql');
function beispieleLaden(datei) { return beispiele(fs.readFileSync(datei || BEISPIELE_DATEI, 'utf8')); }

module.exports = {
  DB_STANDARD, DB_VERSION, BASIS_SPALTEN, BEISPIELE_DATEI, ZEILEN_MAX, ZEIT_STANDARD_S, AbfrageFehler,
  sqlite, viewsAusSchema, oeffnenZumLaden, oeffnenLesend, sessionEinfuegen, laden, ausfuehren, ausfuehrenMitLimit, mehrereAnweisungen, tabelle, csv, schemaText, beispiele, beispieleLaden,
};
