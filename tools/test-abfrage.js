'use strict';
// TEL-01 D2: Test der Abfrage (tools/auswertung/abfrage.js, tools/abfrage-laden.js, tools/abfrage.js, tools/auswertung/abfragen.sql). node:sqlite, keine neue Abhaengigkeit.
//   1. Laden aus einem Ordner mit 3 echten Bot-Sessions (Wellen solo Seed 1 und 2, zu dritt Seed 1): Zeilenzahlen gegen lesen.js/kennzahlen.js, Kopf nicht in ereignisse, szene_nr.
//   2. Inkrementell: zweites Laden aendert nichts; eine Session ohne session_ende wird beim naechsten Laden ersetzt; geaenderte Kennzahl-Version baut die Datenbank neu auf.
//   3. Views aus dem Schema: jede View hat die Spalten des Schemas, ein neues Schema-Feld ist ohne Handarbeit in der View, Namenskollision wird gemeldet; Werte stimmen mit dem Protokoll.
//   4. Beispielabfragen (Abnahme 7, mindestens drei Laeufe): Trefferquote je Waffe nach Spielerzahl, gegengerechnet mit kennzahlen(); alle Beispiele laufen; weitere Zahlen gegengerechnet.
//   5. Nur lesend: Schreib-SQL (INSERT, DELETE, DROP, VACUUM INTO, ATTACH, PRAGMA) wird abgelehnt, die Verbindung ist schreibgeschuetzt, fehlerhaftes SQL ergibt eine verstaendliche Meldung.
//   6. Datenschutz: Namensmuster ueber alle Zellen aller Tabellen (mit Gegenprobe, dass der Test einen Namen findet).
//   7. Aufruf: Exit-Codes von npm run abfrage:laden und npm run abfrage, keine ExperimentalWarning.
//   node tools/test-abfrage.js   (npm run test:abfrage; Mutationsprobe: tools/mutation-auswertung.js)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const Lesen = require('./auswertung/lesen.js');
const { kennzahlen, flach, KENNZAHL_VERSION } = require('./auswertung/kennzahlen.js');
const Abfrage = require('./auswertung/abfrage.js');
const { SCHEMA } = require('../server/telemetrie/schema.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const gleich = (a, b, t) => ok(JSON.stringify(a) === JSON.stringify(b), t + (JSON.stringify(a) === JSON.stringify(b) ? '' : ' (ist ' + JSON.stringify(a) + ', soll ' + JSON.stringify(b) + ')'));
const section = (t) => console.log('\n' + t);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-abfrage-test-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });

const BOT_NAME = /\b(Ada|Bo|Cem)\b/;   // Namen der Bots (wie in test-telemetrie-schema.js)
const BOT_ID = /sim-\d+/;
const wirft = (f) => { try { f(); return null; } catch (e) { return e; } };
const alle = (db, sql, ...p) => db.prepare(sql).all(...p).map((r) => Object.assign({}, r));
const eins = (db, sql, ...p) => { const r = db.prepare(sql).get(...p); return r ? Object.assign({}, r) : null; };

async function main() {
  // ===================== 0. Vorbereitung: 3 echte Sessions =====================
  const PROT = path.join(TMP, 'protokolle');
  await Promise.all([
    bot(['wellen', '--karte', 'aussenposten', '--players', '1', '--seeds', '1', '--seed', '1'], path.join(PROT, 's1')),
    bot(['wellen', '--karte', 'aussenposten', '--players', '1', '--seeds', '1', '--seed', '2'], path.join(PROT, 's2')),
    bot(['wellen', '--karte', 'aussenposten', '--players', '3', '--seeds', '1', '--seed', '1'], path.join(PROT, 'd1')),
  ]);
  // Die drei Prozesse haben verschiedene Prozesskennungen, die Sitzungskennungen (runId + Prozess) sind deshalb ohne Nacharbeit eindeutig.
  const sessions = Lesen.ordnerSessions(PROT);
  gleich(sessions.length, 3, 'Vorbereitung: 3 Sessions in 3 Unterordnern (ordnerSessions laeuft rekursiv, ohne tuning/)');
  const prot = sessions.map((e) => { const p = Lesen.lesen(e.kennung, { dirs: [e.dir] }); return { p, kz: kennzahlen(p) }; });
  const spielerzahlen = prot.map((x) => x.kz.kopf.spielerzahl).sort();
  gleich(spielerzahlen, [1, 1, 3], 'Vorbereitung: Spielerzahlen 1, 1, 3');

  // ===================== 1. Laden =====================
  section('1. Laden aus einem Ordner mit 3 Sessions');
  const DB = path.join(TMP, 'abfrage.sqlite');
  const o = Abfrage.oeffnenZumLaden(DB);
  ok(o.neuAufgebaut === false, 'neue Datenbank: nicht "neu aufgebaut"');
  const erg = Abfrage.laden(o.db, [PROT]);
  gleich([erg.gefunden, erg.geladen, erg.uebersprungen, erg.fehler.length], [3, 3, 0, 0], 'erstes Laden: 3 gefunden, 3 geladen, 0 uebersprungen, 0 Fehler');
  gleich(eins(o.db, 'SELECT COUNT(*) c FROM sessions').c, 3, 'sessions: 3 Zeilen');
  gleich(eins(o.db, 'SELECT SUM(c) s FROM (SELECT COUNT(*) c FROM kennzahlen GROUP BY kennung)').s, prot.reduce((s, x) => s + Object.keys(flach(x.kz)).length, 0), 'kennzahlen: so viele Zeilen wie das flache Kennzahlen-Objekt je Session');
  gleich(eins(o.db, 'SELECT COUNT(*) c FROM ereignisse').c, prot.reduce((s, x) => s + x.p.zeilen.length - 1, 0), 'ereignisse: alle Zeilen ausser dem Kopf');
  gleich(eins(o.db, "SELECT COUNT(*) c FROM ereignisse WHERE typ = 'kopf'").c, 0, 'der Kopf steht nicht in ereignisse');
  for (const x of prot) {
    const kennung = x.p.kennung;
    const s = eins(o.db, 'SELECT * FROM sessions WHERE kennung = ?', kennung);
    gleich([s.quelle, s.modus, s.szenario, s.spielerzahl, s.spielerzahl_kopf, s.seed, s.tuning_hash, s.schema_version, s.ende_grund, s.gruppe, s.datei],
      [x.kz.kopf.quelle, x.kz.kopf.modus, x.kz.kopf.szenario, x.kz.kopf.spielerzahl, x.kz.kopf.spielerzahl_kopf, x.kz.kopf.seed, x.kz.kopf.tuning_hash, x.kz.kopf.schema_version, x.kz.kopf.grund, 'arena_away/aussenposten/' + x.kz.kopf.spielerzahl, kennung + '.jsonl'], 'sessions ' + kennung + ': Kopfwerte');
    ok(s.commit_hash === x.kz.kopf.commit && Math.abs(s.dauer_s - x.kz.kopf.dauer) < 1e-9 && !/[\\/]/.test(s.datei), 'sessions ' + kennung + ': Commit, Dauer, Datei ohne Pfad');
    const kzDb = {};
    for (const r of alle(o.db, 'SELECT schluessel, wert FROM kennzahlen WHERE kennung = ?', kennung)) kzDb[r.schluessel] = r.wert;
    const sortiert = (o) => Object.keys(o).sort().map((k) => [k, o[k]]);
    gleich(sortiert(kzDb), sortiert(flach(x.kz)), 'kennzahlen ' + kennung + ': genau das flache Objekt');
    const zeilen = alle(o.db, 'SELECT zeile, typ, szene_nr, json(json) AS json FROM ereignisse WHERE kennung = ? ORDER BY zeile', kennung);
    ok(zeilen[0].zeile === 2 && zeilen.every((r, i) => r.zeile === i + 2) && zeilen.every((r, i) => r.typ === x.p.zeilen[i + 1].typ), 'ereignisse ' + kennung + ': Zeilennummern 2.. (Kopf = 1), Typen in Protokollreihenfolge');
    ok(zeilen.every((r, i) => JSON.stringify(JSON.parse(r.json)) === JSON.stringify(x.p.zeilen[i + 1])), 'ereignisse ' + kennung + ': json = die Protokollzeile');
    const starts = x.p.zeilen.filter((z) => z.typ === 'szene_start').length;
    ok(starts >= 1 && Math.max(...zeilen.map((r) => r.szene_nr)) === starts, 'szene_nr ' + kennung + ': waechst mit jedem szene_start (' + starts + ')');
    const ersteStart = zeilen.findIndex((r) => r.typ === 'szene_start');
    ok(zeilen.slice(0, ersteStart).every((r) => r.szene_nr === 0) && zeilen[ersteStart].szene_nr === 1, 'szene_nr ' + kennung + ': 0 vor der ersten Szene, der szene_start selbst traegt 1');
  }
  o.db.close();

  // ===================== 2. Inkrementell =====================
  section('2. Inkrementell ueber die Sessionkennung');
  const o2 = Abfrage.oeffnenZumLaden(DB);
  const vorher = { s: eins(o2.db, 'SELECT COUNT(*) c FROM sessions').c, k: eins(o2.db, 'SELECT COUNT(*) c FROM kennzahlen').c, e: eins(o2.db, 'SELECT COUNT(*) c FROM ereignisse').c };
  const e2 = Abfrage.laden(o2.db, [PROT]);
  gleich([e2.gefunden, e2.geladen, e2.uebersprungen, e2.fehler.length], [3, 0, 3, 0], 'zweites Laden: 0 geladen, 3 uebersprungen');
  gleich({ s: eins(o2.db, 'SELECT COUNT(*) c FROM sessions').c, k: eins(o2.db, 'SELECT COUNT(*) c FROM kennzahlen').c, e: eins(o2.db, 'SELECT COUNT(*) c FROM ereignisse').c }, vorher, 'zweites Laden aendert keine Zeilenzahl');
  // eine Session ohne session_ende (laeuft noch) wird beim naechsten Laden ersetzt
  const quelle = sessions[0];
  const voll = fs.readFileSync(path.join(quelle.dir, quelle.kennung + '.jsonl'), 'utf8');
  const teil = voll.replace(/\n[^\n]*"typ":"session_ende"[^\n]*\n?$/, '\n');
  ok(teil.length < voll.length && !teil.includes('"typ":"session_ende"'), 'Vorbereitung: abgeschnittene Kopie ohne session_ende');
  const NEU = path.join(TMP, 'laeuft');
  fs.mkdirSync(NEU);
  const kennNeu = 'run-t-laeuft';
  const ersetze = (t) => t.split(quelle.kennung).join(kennNeu);
  fs.writeFileSync(path.join(NEU, kennNeu + '.jsonl'), ersetze(teil));
  const e3 = Abfrage.laden(o2.db, [PROT, NEU]);
  gleich([e3.geladen, e3.uebersprungen], [1, 3], 'neue Session ohne Ende: geladen, die drei alten uebersprungen');
  gleich(eins(o2.db, 'SELECT ende_grund g FROM sessions WHERE kennung = ?', kennNeu).g, null, 'ende_grund NULL = Session nicht sauber beendet');
  const e4 = Abfrage.laden(o2.db, [PROT, NEU]);
  gleich([e4.geladen, e4.uebersprungen], [1, 3], 'eine Session ohne Ende wird bei jedem Laden neu gelesen');
  const zeilenTeil = eins(o2.db, 'SELECT COUNT(*) c FROM ereignisse WHERE kennung = ?', kennNeu).c;
  fs.writeFileSync(path.join(NEU, kennNeu + '.jsonl'), ersetze(voll));
  const e5 = Abfrage.laden(o2.db, [PROT, NEU]);
  gleich([e5.geladen, e5.uebersprungen], [1, 3], 'die inzwischen beendete Session wird ersetzt');
  ok(eins(o2.db, 'SELECT ende_grund g FROM sessions WHERE kennung = ?', kennNeu).g != null && eins(o2.db, 'SELECT COUNT(*) c FROM ereignisse WHERE kennung = ?', kennNeu).c === zeilenTeil + 1, 'ersetzt, nicht verdoppelt: ende_grund gesetzt, genau eine Zeile (session_ende) mehr');
  const e6 = Abfrage.laden(o2.db, [PROT, NEU]);
  gleich([e6.geladen, e6.uebersprungen], [0, 4], 'danach ist auch sie uebersprungen');
  // geaenderte Kennzahl-Version: von vorn
  o2.db.prepare("UPDATE meta SET wert = '0' WHERE schluessel = 'kennzahl_version'").run();
  o2.db.close();
  const o3 = Abfrage.oeffnenZumLaden(DB);
  ok(o3.neuAufgebaut === true && eins(o3.db, 'SELECT COUNT(*) c FROM sessions').c === 0, 'andere Kennzahl-Version: Datenbank wird neu aufgebaut (leer)');
  const e7 = Abfrage.laden(o3.db, [PROT]);
  gleich([e7.geladen, e7.uebersprungen], [3, 0], 'danach laedt alles von vorn');
  ok(eins(o3.db, "SELECT wert w FROM meta WHERE schluessel = 'kennzahl_version'").w === String(KENNZAHL_VERSION), 'meta traegt die aktuelle Kennzahl-Version');
  // D2-Nacharbeit S4: normale Tabellen (kein WITHOUT ROWID), json als jsonb-BLOB; eine Datei im alten Aufbau (DB_VERSION 1) wird von vorn geladen
  gleich(Abfrage.DB_VERSION, 2, 'Aufbau der Datenbank: Version 2');
  ok(alle(o3.db, "SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE '%WITHOUT ROWID%'").length === 0, 'keine Tabelle ist WITHOUT ROWID');
  gleich(eins(o3.db, "SELECT COUNT(*) c FROM ereignisse WHERE typeof(json) <> 'blob'").c, 0, 'ereignisse.json ist jsonb (BLOB), kein Text');
  gleich(eins(o3.db, "SELECT COUNT(*) c FROM ereignisse WHERE NOT json_valid(json, 8)").c, 0, 'jede jsonb-Zelle ist gueltiges jsonb (json_extract in den Views geht darauf)');
  {
    const alt = path.join(TMP, 'alt-v1.sqlite');
    const { DatabaseSync } = Abfrage.sqlite();
    const d = new DatabaseSync(alt);
    d.exec('CREATE TABLE meta (schluessel TEXT PRIMARY KEY, wert TEXT)');
    d.exec("INSERT INTO meta VALUES ('db_version', '1'), ('kennzahl_version', '" + KENNZAHL_VERSION + "')");
    d.exec('CREATE TABLE ereignisse (kennung TEXT NOT NULL, zeile INTEGER NOT NULL, t REAL, tick INTEGER, typ TEXT NOT NULL, szene_nr INTEGER, json TEXT NOT NULL, PRIMARY KEY (kennung, zeile)) WITHOUT ROWID');
    d.exec("INSERT INTO ereignisse VALUES ('run-alt', 2, 0, 0, 'x', 0, '{}')");
    d.close();
    const oa = Abfrage.oeffnenZumLaden(alt);
    ok(oa.neuAufgebaut === true && eins(oa.db, 'SELECT COUNT(*) c FROM ereignisse').c === 0, 'Datei im alten Aufbau (Version 1): wird neu aufgebaut, die alten Zeilen sind weg');
    ok(!/WITHOUT ROWID/.test(eins(oa.db, "SELECT sql FROM sqlite_master WHERE name = 'ereignisse'").sql), 'nach dem Neuaufbau: ereignisse ohne WITHOUT ROWID');
    const ea = Abfrage.laden(oa.db, [PROT]);
    gleich([ea.geladen, ea.fehler.length], [3, 0], 'die alte Datei laedt danach alle Sessions von vorn');
    gleich(eins(oa.db, "SELECT wert w FROM meta WHERE schluessel = 'db_version'").w, '2', 'meta traegt db_version 2');
    oa.db.close();
  }
  // dieselbe Kennung in zwei Ordnern: die zweite wird gemeldet, nicht still verschluckt; derselbe Ordner zweimal angegeben ist keine Doppelung
  const DOPPELT = path.join(TMP, 'doppelt');
  fs.mkdirSync(DOPPELT);
  fs.writeFileSync(path.join(DOPPELT, quelle.kennung + '.jsonl'), voll);
  const od = Abfrage.oeffnenZumLaden(path.join(TMP, 'doppelt.sqlite'));
  const ed = Abfrage.laden(od.db, [PROT, DOPPELT, PROT]);
  gleich([ed.gefunden, ed.geladen, ed.doppelt], [3, 3, [quelle.kennung]], 'dieselbe Kennung in zwei Ordnern wird als doppelt gemeldet, derselbe Ordner zweimal nicht');
  od.db.close();
  o3.db.close();

  // ===================== 3. Views aus dem Schema =====================
  section('3. Views aus schema.js');
  const lesend = Abfrage.oeffnenLesend(DB);
  const spaltenVon = (db, name) => alle(db, 'PRAGMA table_info("' + name + '")').map((c) => c.name);
  const typen = Object.keys(SCHEMA).filter((t) => t !== 'kopf');
  ok(typen.length >= 30, 'Schema hat ' + typen.length + ' Typen ausser dem Kopf');
  let fehlendeSpalten = [];
  for (const t of typen) {
    const soll = Abfrage.BASIS_SPALTEN.concat(SCHEMA[t].felder);
    const ist = spaltenVon(lesend, 'v_' + t);
    if (JSON.stringify(ist) !== JSON.stringify(soll)) fehlendeSpalten.push(t + ': ' + soll.filter((s) => !ist.includes(s)).join(',') + '|' + ist.length + ' statt ' + soll.length);
  }
  ok(fehlendeSpalten.length === 0, 'jede View v_<typ> hat genau die Spalten des Schemas (kennung, zeile, t, tick, szene_nr + Felder)' + (fehlendeSpalten.length ? ': ' + fehlendeSpalten.slice(0, 4).join('; ') : ''));
  gleich(spaltenVon(lesend, 'v_zeitreihe').length, 5 + SCHEMA.zeitreihe.felder.length, 'v_zeitreihe: alle ' + SCHEMA.zeitreihe.felder.length + ' Schema-Felder');
  gleich(spaltenVon(lesend, 'v_szene'), spaltenVon(lesend, 'v_szene_ende'), 'v_szene = v_szene_ende (Dauer und Ausgang je Szene)');
  ok(!!eins(lesend, "SELECT 1 x FROM sqlite_master WHERE name = 'v_kopf'") === false, 'der Kopf hat keine View (er steht in sessions)');
  // Werte
  const hits = prot.reduce((s, x) => s + x.p.zeilen.filter((z) => z.typ === 'treffer').length, 0);
  gleich(eins(lesend, 'SELECT COUNT(*) c FROM v_treffer').c, hits, 'v_treffer: so viele Zeilen wie treffer-Ereignisse');
  const waffen = {};
  for (const x of prot) for (const z of x.p.zeilen) if (z.typ === 'schuss') { const k = z.ort + '|' + z.waffe + '|' + z.von; waffen[k] = (waffen[k] || 0) + 1; }
  const ausDb = {};
  for (const r of alle(lesend, 'SELECT ort, waffe, von, COUNT(*) c FROM v_schuss GROUP BY ort, waffe, von')) ausDb[r.ort + '|' + r.waffe + '|' + r.von] = r.c;
  gleich(Object.keys(ausDb).sort().map((k) => [k, ausDb[k]]), Object.keys(waffen).sort().map((k) => [k, waffen[k]]), 'v_schuss: Schuesse je Ort, Waffe und Schuetze wie im Protokoll');
  const sz = alle(lesend, 'SELECT ort, hitze, geduckt, von_deckung FROM v_schuss WHERE von_deckung IS NOT NULL LIMIT 1')[0];
  ok(sz && (sz.geduckt === 0 || sz.geduckt === 1) && typeof sz.hitze === 'number', 'v_schuss: Zahlen als Zahlen, Wahrheitswerte als 0/1');
  const zr = alle(lesend, 'SELECT b_sp, slots FROM v_zeitreihe WHERE slots IS NOT NULL LIMIT 1')[0];
  ok(zr && typeof zr.slots === 'string' && Array.isArray(JSON.parse(zr.slots)), 'v_zeitreihe: Listen als JSON-Text (mit json_each lesbar)');
  const nrKill = alle(lesend, 'SELECT nr FROM v_kill LIMIT 1');
  ok(nrKill.length === 0 || nrKill[0].nr >= 1, 'v_kill.nr ist das Schema-Feld nr (nicht die Zeilennummer: die heisst zeile)');
  lesend.close();
  // neues Schema-Feld ist ohne Handarbeit in der View; Namenskollision wird gemeldet
  const schemaPlus = JSON.parse(JSON.stringify(SCHEMA));
  schemaPlus.schuss.felder.push('neues_feld_xyz');
  const DB2 = path.join(TMP, 'schema-plus.sqlite');
  const op = Abfrage.oeffnenZumLaden(DB2, { schema: schemaPlus });
  ok(spaltenVon(op.db, 'v_schuss').includes('neues_feld_xyz') && !spaltenVon(op.db, 'v_treffer').includes('neues_feld_xyz'), 'ein neues Schema-Feld steht automatisch in der View seines Typs (und nur dort)');
  op.db.close();
  const kollision = JSON.parse(JSON.stringify(SCHEMA)); kollision.kill.felder.push('zeile');
  const fk = wirft(() => Abfrage.viewsAusSchema(kollision));
  ok(fk instanceof Abfrage.AbfrageFehler && /Basisspalte/.test(fk.message), 'ein Schema-Feld namens zeile (Basisspalte) wird beim Aufbau gemeldet');

  // ===================== 4. Beispielabfragen =====================
  section('4. Beispielabfragen (Abnahme 7: Trefferquote je Waffe nach Spielerzahl ueber 3 Laeufe)');
  const bsp = Abfrage.beispieleLaden();
  const namen = bsp.map((b) => b.name);
  ok(bsp.length >= 6 && namen.includes('quote_je_waffe_nach_spielerzahl') && namen.includes('lanze_quote_dritte_szenen_drei_spieler'), 'abfragen.sql: ' + bsp.length + ' Beispiele (' + namen.join(', ') + ')');
  ok(bsp.every((b) => b.text.length > 20 && /^(WITH|SELECT)/i.test(b.sql)), 'jedes Beispiel hat eine Beschreibung und ein SQL');
  const db = Abfrage.oeffnenLesend(DB);
  for (const b of bsp) { const r = wirft(() => Abfrage.ausfuehren(db, b.sql)); ok(r === null, 'Beispiel ' + b.name + ' laeuft' + (r ? ': ' + r.message : '')); }
  const q = Abfrage.ausfuehren(db, bsp.find((b) => b.name === 'quote_je_waffe_nach_spielerzahl').sql);
  gleich(q.spalten, ['spielerzahl', 'ort', 'waffe', 'laeufe', 'schuesse', 'mit_treffer', 'quote_prozent'], 'Abnahme 7: Spalten der Quotentabelle');
  const sql4 = q.zeilen;
  const lauefeGesamt = alle(db, "SELECT COUNT(DISTINCT kennung) c FROM v_schuss WHERE von GLOB 'p[1-4]'")[0].c;
  gleich(lauefeGesamt, 3, 'Abnahme 7: die Tabelle stuetzt sich auf 3 Laeufe');
  ok(new Set(sql4.map((r) => r[0])).size === 2 && sql4.some((r) => r[0] === 1 && r[3] === 2) && sql4.some((r) => r[0] === 3 && r[3] === 1), 'Zeilen fuer Spielerzahl 1 (2 Laeufe) und 3 (1 Lauf)');
  // gegengerechnet mit kennzahlen(): schuesse und Quote je Waffe, gepoolt ueber die Sessions einer Spielerzahl
  const erwartet = {};
  for (const x of prot) {
    const f = flach(x.kz);
    for (const k of Object.keys(f)) {
      const m = /^f2\.schuesse\.([a-z]+)\.(.+)$/.exec(k);
      if (!m) continue;
      const id = x.kz.kopf.spielerzahl + '|' + m[1] + '|' + m[2];
      const e = erwartet[id] || (erwartet[id] = { schuesse: 0, mit: 0, laeufe: 0 });
      const quote = f['f2.quote.' + m[1] + '.' + m[2]];
      e.schuesse += f[k]; e.mit += Math.round(quote * f[k] / 100); e.laeufe++;
    }
  }
  const sqlMap = {};
  for (const r of sql4) sqlMap[r[0] + '|' + r[1] + '|' + r[2]] = { schuesse: r[4], mit: r[5], laeufe: r[3], quote: r[6] };
  gleich(Object.keys(sqlMap).sort(), Object.keys(erwartet).sort(), 'dieselben Zeilen (Spielerzahl, Ort, Waffe) wie aus kennzahlen()');
  let falsch = [];
  for (const id of Object.keys(erwartet)) {
    const e = erwartet[id], s = sqlMap[id];
    if (!s || s.schuesse !== e.schuesse || s.mit !== e.mit || s.laeufe !== e.laeufe || Math.abs(s.quote - Math.round(1e4 * e.mit / e.schuesse) / 100) > 1e-9) falsch.push(id + ' SQL ' + JSON.stringify(s) + ' kennzahlen ' + JSON.stringify(e));
  }
  ok(falsch.length === 0, 'Schuesse, Treffer-Schuesse, Laeufe und Quote je Waffe stimmen mit kennzahlen() ueberein (' + Object.keys(erwartet).length + ' Zeilen)' + (falsch.length ? ': ' + falsch[0] : ''));
  // eine einzelne Session: Quote (%) je Waffe exakt wie f2.quote.* (2 Stellen)
  const proSession = alle(db, `WITH treffer_pid AS (SELECT DISTINCT kennung, ort, pid FROM v_treffer WHERE pid IS NOT NULL AND (von GLOB 'p[1-4]' OR von IN ('lerche', 'crew')))
    SELECT sh.kennung, sh.ort, sh.waffe, COUNT(*) AS s, ROUND(100.0 * SUM(CASE WHEN sh.treffer = 1 OR (sh.kennung, sh.ort, sh.pid) IN (SELECT kennung, ort, pid FROM treffer_pid) THEN 1 ELSE 0 END) / COUNT(*), 2) AS q
    FROM v_schuss sh
    WHERE (sh.von GLOB 'p[1-4]' OR sh.von IN ('lerche', 'crew')) AND (sh.pid IS NOT NULL OR sh.treffer IS NOT NULL) GROUP BY sh.kennung, sh.ort, sh.waffe`);
  const abw = proSession.filter((r) => { const x = prot.find((p) => p.p.kennung === r.kennung); const f = flach(x.kz); return f['f2.quote.' + r.ort + '.' + r.waffe] !== r.q || f['f2.schuesse.' + r.ort + '.' + r.waffe] !== r.s; });
  ok(proSession.length >= 5 && abw.length === 0, 'je Session und Waffe ist die SQL-Quote gleich f2.quote.* (' + proSession.length + ' Paare)');
  // weitere Beispiele gegengerechnet
  const dauer = Abfrage.ausfuehren(db, bsp.find((b) => b.name === 'dauer_je_gruppe').sql);
  const solo = prot.filter((x) => x.kz.kopf.spielerzahl === 1).map((x) => flach(x.kz)['f1.dauer.session']);
  const zSolo = dauer.zeilen.find((r) => r[0] === 'arena_away/aussenposten/1');
  ok(zSolo && zSolo[1] === 2 && Math.abs(zSolo[2] - Math.round(10 * (solo[0] + solo[1]) / 2) / 10) < 1e-9, 'dauer_je_gruppe: Gruppe solo mit 2 Laeufen und Mittel der Kennzahl f1.dauer.session');
  const kills = Abfrage.ausfuehren(db, bsp.find((b) => b.name === 'kills_je_rolle_nach_spielerzahl').sql);
  const killsSoll = prot.filter((x) => x.kz.kopf.spielerzahl === 1).reduce((s, x) => s + (flach(x.kz)['f2.kills.boden.gesamt'] || 0), 0);
  gleich(kills.zeilen.filter((r) => r[0] === 1 && r[1] === 'boden').reduce((s, r) => s + r[3], 0), killsSoll, 'kills_je_rolle_nach_spielerzahl: Summe der Kills (solo, Boden) = f2.kills.boden.gesamt');
  const lz = Abfrage.ausfuehren(db, bsp.find((b) => b.name === 'lanze_quote_dritte_szenen_drei_spieler').sql);
  gleich(lz.spalten, ['ort', 'laeufe', 'schuesse', 'mit_treffer', 'quote_prozent'], 'Lanze, dritte Szenen, drei Spieler: Spalten (Zeilen: ' + lz.zeilen.length + ', die Wellen-Sessions haben nur eine Szene)');
  // die Filter wirken wirklich: dieselbe Abfrage ohne Szenenfilter findet Lanzenschuesse? (Wellen am Boden: Lanze moeglich); mit szene_nr = 1 und 3 Spielern auch Zeilen moeglich
  const eineSzene = Abfrage.ausfuehren(db, "SELECT COUNT(*) FROM v_schuss sh JOIN sessions s ON s.kennung = sh.kennung WHERE sh.szene_nr = 1 AND s.spielerzahl = 3");
  const dritteSzene = Abfrage.ausfuehren(db, "SELECT COUNT(*) FROM v_schuss sh JOIN sessions s ON s.kennung = sh.kennung WHERE sh.szene_nr = 3 AND s.spielerzahl = 3");
  ok(eineSzene.zeilen[0][0] > 0 && dritteSzene.zeilen[0][0] === 0, 'szene_nr filtert: Schuesse der 1. Szene zu dritt vorhanden (' + eineSzene.zeilen[0][0] + '), der 3. Szene keine');
  const mehrSzenen = Abfrage.ausfuehren(db, "SELECT MAX(szene_nr) FROM ereignisse");
  ok(mehrSzenen.zeilen[0][0] >= 1, 'szene_nr in ereignisse');
  // Ausgabe: Markdown und CSV
  const md = Abfrage.tabelle(q);
  ok(/^\| spielerzahl \| ort \| waffe \|/.test(md) && /\|---\|/.test(md) && /_5 Zeilen\._|_\d+ Zeilen\._/.test(md), 'Tabellenausgabe: Markdown mit Kopf, Trenner und Zeilenzahl');
  ok(Abfrage.csv(q).split('\n')[0] === 'spielerzahl,ort,waffe,laeufe,schuesse,mit_treffer,quote_prozent' && Abfrage.csv({ spalten: ['a'], zeilen: [['x,"y"']] }) === 'a\n"x,""y"""\n', 'CSV: Kopfzeile und Anfuehrungszeichen');
  ok(/die ersten 2 gezeigt/.test(Abfrage.tabelle({ spalten: ['a'], zeilen: [[1], [2], [3]] }, 2)), 'Tabelle mit --max kuerzt und sagt es');

  // ===================== 5. Nur lesend =====================
  section('5. Nur lesend, verstaendliche Fehler');
  const vorS = eins(db, 'SELECT COUNT(*) c FROM sessions').c;
  const direkt = wirft(() => db.exec('DELETE FROM sessions'));
  ok(direkt && /readonly/i.test(direkt.message), 'die Verbindung ist schreibgeschuetzt (DELETE scheitert an der Datenbank selbst: ' + (direkt && direkt.message) + ')');
  ok(wirft(() => db.exec("INSERT INTO meta VALUES ('x', 'y')")) != null && wirft(() => db.exec('DROP TABLE sessions')) != null && wirft(() => db.exec('CREATE TABLE x (a)')) != null, 'INSERT, DROP und CREATE scheitern an der Verbindung');
  const FRAGE = path.join(TMP, 'kopie.sqlite');
  for (const sql of ["DELETE FROM sessions", "INSERT INTO meta VALUES ('x','y')", 'DROP TABLE sessions', 'UPDATE sessions SET modus = 1', "VACUUM INTO '" + FRAGE.replace(/\\/g, '/') + "'", "ATTACH DATABASE '" + FRAGE.replace(/\\/g, '/') + "' AS x", 'PRAGMA writable_schema = 1', 'CREATE TABLE y (a)', 'SELECT 1; DELETE FROM sessions', '/* tarnung */ DELETE FROM sessions', '-- x\nINSERT INTO meta VALUES (1, 2)']) {
    const f = wirft(() => Abfrage.ausfuehren(db, sql));
    ok(f instanceof Abfrage.AbfrageFehler && /nur lesende|nur eine Anweisung/.test(f.message), 'abgelehnt: ' + sql.replace(/\n/g, ' ').slice(0, 44) + ' (' + (f && f.message.slice(0, 40)) + ')');
  }
  ok(!fs.existsSync(FRAGE), 'VACUUM INTO hat keine Datei geschrieben');
  gleich(eins(db, 'SELECT COUNT(*) c FROM sessions').c, vorS, 'die Datenbank ist nach allen Versuchen unveraendert');
  const f1 = wirft(() => Abfrage.ausfuehren(db, 'SELECT * FRM sessions'));
  ok(f1 instanceof Abfrage.AbfrageFehler && /SQL-Fehler: .*syntax error/.test(f1.message) && /--schema/.test(f1.message), 'Syntaxfehler: verstaendliche Meldung mit Hinweis auf --schema (' + (f1 && f1.message) + ')');
  const f2 = wirft(() => Abfrage.ausfuehren(db, 'SELECT gibtesnicht FROM sessions'));
  ok(f2 instanceof Abfrage.AbfrageFehler && /no such column/.test(f2.message), 'unbekannte Spalte: Meldung (' + (f2 && f2.message.slice(0, 60)) + ')');
  ok(wirft(() => Abfrage.ausfuehren(db, '')) instanceof Abfrage.AbfrageFehler && wirft(() => Abfrage.ausfuehren(db, '-- nur Kommentar')) instanceof Abfrage.AbfrageFehler, 'leere Abfrage: Meldung');
  gleich(Abfrage.ausfuehren(db, "SELECT ';' AS x;").zeilen, [[';']], 'Semikolon in einem Text und am Ende ist erlaubt');
  gleich(Abfrage.ausfuehren(db, '-- Kommentar\nSELECT 1 AS a, 2 AS b').spalten, ['a', 'b'], 'fuehrender Kommentar vor dem SELECT ist erlaubt');
  // K6: Bezeichner in [...], "..." und `...` duerfen ein Semikolon enthalten; ein Semikolon dahinter trennt weiterhin
  gleich(Abfrage.ausfuehren(db, 'SELECT 1 AS [a;b]').spalten, ['a;b'], 'Semikolon in einem [Bezeichner] ist erlaubt');
  gleich(Abfrage.ausfuehren(db, 'SELECT 1 AS "a;b", 2 AS `c;d`;').spalten, ['a;b', 'c;d'], 'Semikolon in "Bezeichner" und `Bezeichner` ist erlaubt');
  ok(Abfrage.mehrereAnweisungen('SELECT 1 AS [a;b]; SELECT 2') === true && Abfrage.mehrereAnweisungen('SELECT 1 AS [a;b]') === false && Abfrage.mehrereAnweisungen('SELECT 1 AS [a;b];') === false, 'mehrereAnweisungen: [..] schuetzt das ; darin, ein echtes ; dahinter trennt');
  const fb = wirft(() => Abfrage.ausfuehren(db, 'SELECT 1 AS [a]; DROP TABLE sessions'));
  ok(fb instanceof Abfrage.AbfrageFehler && /nur eine Anweisung/.test(fb.message), 'zwei Anweisungen mit [Bezeichner] davor: abgelehnt');
  // K6: Zeitlimit (eigener Prozess, wird abgeschossen): rekursive Abfrage ohne Ende bricht nach dem Limit ab
  {
    const t0 = Date.now();
    const fz = wirft(() => Abfrage.ausfuehrenMitLimit(DB, 'WITH RECURSIVE r(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM r) SELECT COUNT(*) FROM r', 1));
    const dt = Date.now() - t0;
    ok(fz instanceof Abfrage.AbfrageFehler && /laenger als 1 s/.test(fz.message) && /--zeit/.test(fz.message), 'Zeitlimit: rekursiver CTE bricht mit Meldung ab (' + (fz && fz.message.slice(0, 40)) + ')');
    ok(dt >= 900 && dt < 15000, 'Zeitlimit: Abbruch nach etwa einer Sekunde (' + dt + ' ms)');
    gleich(Abfrage.ausfuehrenMitLimit(DB, 'SELECT COUNT(*) AS n FROM sessions', 30).zeilen, [[3]], 'mit Limit: eine schnelle Abfrage liefert das Ergebnis');
    const fq = wirft(() => Abfrage.ausfuehrenMitLimit(DB, 'DELETE FROM sessions', 30));
    ok(fq instanceof Abfrage.AbfrageFehler && /nur lesende/.test(fq.message), 'mit Limit: Schreib-SQL wird abgelehnt');
    const fs2 = wirft(() => Abfrage.ausfuehrenMitLimit(DB, 'SELECT * FRM x', 30));
    ok(fs2 instanceof Abfrage.AbfrageFehler && /SQL-Fehler/.test(fs2.message), 'mit Limit: SQL-Fehler bleibt eine verstaendliche Meldung');
  }
  db.close();
  const fehlt = wirft(() => Abfrage.oeffnenLesend(path.join(TMP, 'gibt-es-nicht.sqlite')));
  ok(fehlt instanceof Abfrage.AbfrageFehler && /abfrage:laden/.test(fehlt.message) && !fs.existsSync(path.join(TMP, 'gibt-es-nicht.sqlite')), 'fehlende Datenbank: Meldung "zuerst abfrage:laden", es wird keine angelegt');

  // ===================== 6. Datenschutz =====================
  section('6. Namensprobe ueber alle Zellen');
  const zellenMitName = (d) => {
    const tab = alle(d, "SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);
    let gefunden = 0, zellen = 0;
    for (const t of tab) {
      // jsonb-Spalten (BLOB) als Text lesen, sonst bliebe die Namensprobe an ereignisse.json blind
      const sel = alle(d, 'PRAGMA table_info("' + t + '")').map((c) => (/BLOB/i.test(c.type) ? 'json("' + c.name + '") AS "' + c.name + '"' : '"' + c.name + '"')).join(', ');
      for (const r of d.prepare('SELECT ' + sel + ' FROM "' + t + '"').all()) for (const v of Object.values(r)) { zellen++; if (typeof v === 'string' && (BOT_NAME.test(v) || BOT_ID.test(v))) gefunden++; }
    }
    return { gefunden, zellen, tabellen: tab };
  };
  const dbn = Abfrage.oeffnenLesend(DB);
  const pn = zellenMitName(dbn);
  ok(pn.zellen > 10000 && pn.gefunden === 0, 'keine Bot-Namen und keine Client-Kennung in ' + pn.zellen + ' Zellen der Tabellen ' + pn.tabellen.join(', '));
  const alleVons = Object.keys(SCHEMA).filter((t) => t !== 'kopf').every((t) => !/name|clientid/i.test(SCHEMA[t].felder.join(' ')));
  ok(alleVons, 'kein Schema-Feld heisst name oder clientId');
  dbn.close();
  // Gegenprobe: der Test findet einen Namen, wenn einer drinsteht
  const { DatabaseSync } = Abfrage.sqlite();
  const mem = new DatabaseSync(':memory:');
  mem.exec('CREATE TABLE t (a, b)'); mem.exec("INSERT INTO t VALUES ('x', 'der Spieler Ada trifft'), ('sim-123', 1)");
  mem.exec('CREATE TABLE j (a TEXT, b BLOB)'); mem.exec(`INSERT INTO j VALUES ('x', jsonb('{"spieler":"Cem"}'))`);
  gleich(zellenMitName(mem).gefunden, 3, 'Gegenprobe: die Namensprobe findet "Ada" und "sim-123" in einer Testtabelle und "Cem" in einer jsonb-Zelle');
  mem.close();

  // ===================== 7. Aufruf =====================
  section('7. Aufruf (Exit-Codes, keine ExperimentalWarning)');
  const lauf = (skript, ...a) => spawnSync(process.execPath, [path.join(__dirname, skript), ...a], { cwd: ROOT, encoding: 'utf8' });
  const CLI_DB = path.join(TMP, 'cli.sqlite');
  const l1 = lauf('abfrage-laden.js', PROT, '--db', CLI_DB);
  ok(l1.status === 0 && /3 Sessions gefunden, 3 geladen, 0 schon vorhanden, 0 Fehler/.test(l1.stdout) && !/ExperimentalWarning|experimental/i.test(l1.stderr), 'abfrage-laden: Exit 0, Zusammenfassung, keine ExperimentalWarning (' + l1.stdout.trim().replace(/^.*sqlite: /, '') + ')');
  const l2 = lauf('abfrage-laden.js', PROT, '--db', CLI_DB);
  ok(l2.status === 0 && /0 geladen, 3 schon vorhanden/.test(l2.stdout), 'abfrage-laden zweimal: 0 geladen, 3 schon vorhanden');
  ok(lauf('abfrage-laden.js', '--unsinn').status === 2 && lauf('abfrage-laden.js', '--db').status === 2, 'abfrage-laden: unbekannte Option und fehlender Wert: Exit 2');
  const a1 = lauf('abfrage.js', '--beispiel', 'quote_je_waffe_nach_spielerzahl', '--db', CLI_DB);
  ok(a1.status === 0 && /\| spielerzahl \| ort \| waffe \| laeufe \| schuesse \| mit_treffer \| quote_prozent \|/.test(a1.stdout) && /\| 3 \| boden \| blaster \|/.test(a1.stdout) && a1.stderr === '', 'abfrage --beispiel quote_je_waffe_nach_spielerzahl: Exit 0, Tabelle, keine Warnung');
  const a2 = lauf('abfrage.js', 'SELECT kennung, spielerzahl FROM sessions ORDER BY kennung', '--csv', '--db', CLI_DB);
  ok(a2.status === 0 && a2.stdout.split('\n')[0] === 'kennung,spielerzahl' && a2.stdout.trim().split('\n').length === 4, 'abfrage --csv: Kopfzeile und 3 Zeilen');
  const a3 = lauf('abfrage.js', 'SELECT * FRM sessions', '--db', CLI_DB);
  ok(a3.status === 2 && /SQL-Fehler/.test(a3.stderr), 'fehlerhaftes SQL: Exit 2 mit verstaendlicher Meldung');
  const a4 = lauf('abfrage.js', 'DELETE FROM sessions', '--db', CLI_DB);
  ok(a4.status === 2 && /nur lesende Abfragen/.test(a4.stderr), 'Schreib-SQL: Exit 2, "nur lesende Abfragen"');
  ok(eins(Abfrage.oeffnenLesend(CLI_DB), 'SELECT COUNT(*) c FROM sessions').c === 3, 'danach sind die 3 Sessions noch da');
  ok(lauf('abfrage.js', '--db', CLI_DB).status === 2 && lauf('abfrage.js', '--beispiel', 'gibt-es-nicht', '--db', CLI_DB).status === 2 && lauf('abfrage.js', 'SELECT 1', '--db', path.join(TMP, 'nix.sqlite')).status === 2, 'kein SQL, unbekanntes Beispiel, fehlende Datenbank: Exit 2');
  const a5 = lauf('abfrage.js', '--beispiel', '--db', CLI_DB);
  ok(a5.status === 0 && namen.every((nm) => a5.stdout.includes(nm)), '--beispiel ohne Namen listet alle Beispiele');
  const a6 = lauf('abfrage.js', '--schema', '--db', CLI_DB);
  ok(a6.status === 0 && /Tabelle sessions: kennung, quelle, commit_hash/.test(a6.stdout) && /View +v_schuss: kennung, zeile, t, tick, szene_nr, ort, waffe/.test(a6.stdout), '--schema: Tabellen, Views und Spalten');
  ok(lauf('abfrage.js', 'SELECT 1', 'SELECT 2', '--db', CLI_DB).status === 2, 'zwei SQL-Angaben: Exit 2');
  const z1 = lauf('abfrage.js', 'WITH RECURSIVE r(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM r) SELECT COUNT(*) FROM r', '--zeit', '1', '--db', CLI_DB);
  ok(z1.status === 2 && /laenger als 1 s/.test(z1.stderr), 'abfrage --zeit 1 mit rekursivem CTE: Exit 2 und Meldung (' + z1.status + ')');
  ok(lauf('abfrage.js', 'SELECT 1', '--zeit', 'x', '--db', CLI_DB).status === 2, '--zeit ohne Zahl: Exit 2');
  const z2 = lauf('abfrage.js', 'SELECT 1 AS [a;b]', '--db', CLI_DB);
  ok(z2.status === 0 && /a;b/.test(z2.stdout), 'abfrage mit [a;b]: Exit 0');

  console.log('\n' + (n - fails) + ' von ' + n + ' Pruefungen ok');
  process.exit(fails ? 1 : 0);
}

function bot(argumente, dir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(dir, { recursive: true });
    const ch = spawn(process.execPath, [path.join(ROOT, 'tools', 'sim-headless.js')].concat(argumente), { cwd: ROOT, env: Object.assign({}, process.env, { TELEMETRIE: 'an', TELEMETRIE_DIR: dir }), stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ch.stderr.on('data', (d) => { if (err.length < 1000) err += d; });
    ch.on('exit', (code) => (code === 0 || code === 1 ? resolve(code) : reject(new Error('sim-headless ' + argumente.join(' ') + ' Exit ' + code + ' ' + err))));
    ch.on('error', reject);
  });
}

main().catch((e) => { console.log('  FEHLER Absturz: ' + (e && e.stack || e)); process.exit(1); });
