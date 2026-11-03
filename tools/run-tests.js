'use strict';
// Test-Runner (TST-01): fuehrt die Schritte aus tools/testliste.json aus und misst Zeit, Exit-Code, Ausgabegroesse.
// Aufruf: node tools/run-tests.js --seriell|--parallel [--worker N] [--nur <id,...>] [--kette check|test] [--timeout <s>]
//                                                      [--stufe fast|full|slow|alles] [--trocken]
//                                                      [--ausgabe <datei.json>] [--liste <datei.json>]
//   --seriell  ein Schritt nach dem anderen (Reihenfolge der Liste), Schritte teilen sich Temp und Umgebung
//   --parallel Pool mit N Workern (Standard: Kerne minus 4, mind. 1); laengste Schritte zuerst (Dauer aus
//              tools/fixtures/testzeiten/baseline.json, unbekannte Schritte gelten als lang)
//   --worker   Poolgroesse fuer --parallel
//   --nur      Schritt-IDs oder Dateinamen ohne Argumente (z. B. test-flight), kommagetrennt
//   --stufe    Auswahl nach Feld "stufe" je Listeneintrag (Pflicht, fast|full|slow): fast = nur fast, full = fast + full
//              (alles ausser slow), slow = nur slow, alles = alle (Standard). Fehlt das Feld oder ist der Wert ungueltig:
//              Abbruch vor dem Start, Exit 2. Kombinierbar mit --kette, --nur, --parallel/--seriell.
//   --lastfaktor  Faktor auf budget_s im Parallelmodus (Standard 4; seriell immer 1)
//   --grenze-aus  Zeitgrenze der Stufe (grenzen in testliste.json) nicht pruefen (Fehlersuche)
//   --trocken  nur die Auswahl listen (Zahl je Stufe), nichts starten, keine Ausgabedatei, Exit 0
//   --timeout  je Schritt in Sekunden (Standard 1800); wirksam ist je Schritt max(--timeout, "timeout_s" des Schritts)
//   --ausgabe  Ergebnis-JSON (Standard tools/fixtures/testzeiten/lauf-<Zeitstempel>.json)
//   --liste    andere Testliste (Standard tools/testliste.json)
// Aufruf strikt: jede Option hoechstens einmal (auch gegenueber den npm-Skripten: `npm test` hat schon --stufe full, dafuer node tools/run-tests.js ...
//   direkt nutzen; `npm test -- --nur <id>` geht, weil --nur dort fehlt), Zahlen > 0, unbekannte --kette, leere Auswahl: alles Exit 2.
// Kein Abbruch beim ersten roten Schritt; Gesamt-Exit 1 bei irgendeinem Roten oder Timeout.
// Exit-Codes: 0 alles gruen; 1 rote Schritte, Timeout, Abbruch oder Ausnahme im Runner nach dem Start (Kindprozesse beendet, Temp geloescht);
//   2 Aufruf/Liste ungueltig, leere Auswahl oder Datei in tools/ ohne Eintrag (siehe unten);
//   3 nur die harte Grenze der Stufe fast (Wandzeit, Parallelmodus) ueberschritten, alle Schritte gruen.
// Zeitbudget: Feld "budget_s" je Schritt (abgeleitet mit tools/testliste-budgets.js). Ueberschreitungen stehen nach dem Lauf im Abschnitt
//   "Zeitbudget ueberschritten" und im JSON (budget_ueberschritten); sie aendern den Exit-Code nicht. Parallel gilt budget_s x --lastfaktor.
// Zeitgrenze: testliste.json "grenzen" je Stufe (fast, full, slow, alles): {"s": Sekunden Wandzeit, "hart": true|false}, nur im Parallelmodus.
//   hart (nur fast): Ueberschreitung gibt Exit 3, wenn sonst alles gruen ist (bei roten Schritten bleibt es Exit 1). Nicht hart (full, slow, alles):
//   nur Hinweis in der Zusammenfassung, kein Einfluss auf den Exit-Code (npm test darf nicht an Fremdlast rot werden).
// Optionales Feld je Listeneintrag: "timeout_s": eigener Timeout des Schritts (z. B. 3600 bei sim-headless kette); wirksam ist max(--timeout, timeout_s).
// Pflichtpruefung beim Start (nicht mit --liste): jede tools/test-*.js, mutation-*.js, check-*.js|mjs steht in einem cmd der Liste oder unter
//   "ausgenommen" (datei + grund); sonst Exit 2.
// Optionales Feld je Listeneintrag: "seriell": true -> der Schritt laeuft im Parallelmodus erst nach dem Pool, allein
//   (kein anderer Schritt gleichzeitig). Gesetzt bei test-abenteuer und -kanon (spawnSync-Timeouts reissen bei ueberbuchter CPU).
//   --stufe aendert daran nichts: die Markierung gilt unabhaengig von der Stufe.
// Isolation im Parallelmodus: jeder Schritt bekommt ein eigenes Temp-Verzeichnis (TEMP/TMP/TMPDIR zeigen darauf,
//   os.tmpdir() liefert es), das nach dem Schritt geloescht wird; REGIE_DIR zeigt auf <Temp>/regie (Standard waere data/regie im Repo).
//   Folge: Spiele ohne eigenes Regie-Verzeichnis schreiben ihr Regielog dort in den Temp statt nur im Speicher (server/mission/spielleiter.js:314,
//   server/sim/regie-befehle.js:430); folgenlos fuer die Pruefungen, aber ein Unterschied zu einem direkten node tools/test-xyz.js. Ports: die Tests nutzen Port 0 (frei vergeben), PORT wird
//   bewusst NICHT gesetzt. Ergebnis-JSON je Schritt zusaetzlich start_s/ende_s (relativ zum Laufbeginn).
// Ctrl-C: alle laufenden Kindprozessbaeume werden beendet (taskkill /T /F), Temp aufgeraeumt, Exit 1.
// --ausgabe auf tools/fixtures/testzeiten/baseline.json: der Lauf schreibt in baseline.json.neu und ersetzt baseline.json erst nach vollstaendig
//   gruenem Lauf (sonst bleibt die alte Baseline, der Zwischenstand steht in .neu).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const io = require('./testliste-io');

const WURZEL = path.join(__dirname, '..');
const ENDE_BYTES = 2048;
const PFLICHT_MUSTER = /^(test|mutation|check)-.*\.m?js$/;   // Dateien in tools/, die einen Eintrag oder eine Ausnahme brauchen (sim-*, messe-*, mess-*, sicht-* nicht: von Hand eintragen)

// Dateien in tools/ nach PFLICHT_MUSTER, die weder in einem cmd der Schritte noch unter "ausgenommen" stehen
function ohneEintrag(doc) {
  const bekannt = new Set();
  for (const e of doc.schritte) if (e.cmd && e.cmd[0]) bekannt.add(path.basename(e.cmd[0]));
  for (const a of doc.ausgenommen) bekannt.add(path.basename(a.datei || ''));
  return fs.readdirSync(__dirname).filter(f => PFLICHT_MUSTER.test(f) && !bekannt.has(f)).sort();
}

function aufrufFehler(text) { console.error(text); process.exit(2); }

const WERT_OPTIONEN = ['--worker', '--nur', '--kette', '--timeout', '--stufe', '--lastfaktor', '--ausgabe', '--liste'];
const FLAG_OPTIONEN = ['--seriell', '--parallel', '--trocken', '--grenze-aus'];
// Doppelte Optionen ablehnen (sonst gewinnt still die erste, z. B. bei `npm test -- --stufe fast`) und fehlende Werte
function aufrufPruefen() {
  const args = process.argv.slice(2);
  for (const o of [...WERT_OPTIONEN, ...FLAG_OPTIONEN]) {
    if (args.filter(a => a === o).length > 1) {
      aufrufFehler('Option doppelt: ' + o + '. Die npm-Skripte setzen schon Optionen (`npm test` hat --stufe full und --kette test); zum Ueberschreiben '
        + 'node tools/run-tests.js ... direkt aufrufen.');
    }
  }
  for (const o of WERT_OPTIONEN) {
    const i = args.indexOf(o);
    if (i >= 0 && (i + 1 >= args.length || args[i + 1].startsWith('--'))) aufrufFehler('Option ' + o + ' braucht einen Wert');
  }
  if (args.includes('--seriell') && args.includes('--parallel')) aufrufFehler('--seriell und --parallel schliessen sich aus (die npm-Skripte setzen den Modus schon)');
}

function argWert(name, std) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : std;
}

// Zahl > 0 (ganzzahlig, wenn ganz) aus einer Option, sonst Exit 2
function zahlOption(name, std, ganz) {
  const roh = argWert(name, null);
  if (roh === null) return std;
  const ok = ganz ? /^\d+$/.test(roh) : /^\d+(\.\d+)?$/.test(roh);
  if (!ok || !(Number(roh) > 0)) aufrufFehler('Ungueltiger Wert fuer ' + name + ': "' + roh + '" (erwartet: ' + (ganz ? 'ganze Zahl' : 'Zahl') + ' > 0)');
  return Number(roh);
}

// Zustand fuer den Aufraeumpfad bei Ausnahmen (siehe main().catch)
const lauf_ = { aktiv: new Set(), tempBasis: null, doc: null, schreiben: null, gestartet: false };

// Prozessbaum beenden (Windows: taskkill /T /F)
function beenden(kind) {
  if (!kind.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(kind.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-kind.pid, 'SIGKILL'); } catch (e) { try { kind.kill('SIGKILL'); } catch (e2) { /* weg */ } } }
}

function schrittLaufen(eintrag, timeoutS, env, aktiv) {
  return new Promise(resolve => {
    const t0 = process.hrtime.bigint();
    const kind = spawn(process.execPath, eintrag.cmd, {
      cwd: WURZEL, env: env || process.env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    if (aktiv) aktiv.add(kind);
    let bytes = 0;
    let ende = Buffer.alloc(0);
    let timeout = false;
    let rest = '';
    const fehler = [];   // Zeilen mit FEHLER (die Tests melden so ihre roten Pruefungen), damit sie nicht im Ausgabe-Ende untergehen
    const sammeln = d => {
      bytes += d.length;
      const zeilen = (rest + d.toString('utf8')).split('\n'); rest = zeilen.pop();
      for (const z of zeilen) if (/FEHLER/.test(z) && fehler.length < 30) fehler.push(z.trim().slice(0, 300));
      ende = Buffer.concat([ende, d]);
      if (ende.length > ENDE_BYTES * 4) ende = ende.subarray(ende.length - ENDE_BYTES * 2);
    };
    kind.stdout.on('data', sammeln);
    kind.stderr.on('data', sammeln);
    const wirksamS = Math.max(timeoutS, Number(eintrag.timeout_s) > 0 ? Number(eintrag.timeout_s) : 0);
    const uhr = setTimeout(() => { timeout = true; beenden(kind); }, wirksamS * 1000);
    const fertig = (exit, signal) => {
      clearTimeout(uhr);
      if (aktiv) aktiv.delete(kind);
      const dauer = Number(process.hrtime.bigint() - t0) / 1e9;
      resolve({
        id: eintrag.id, cmd: eintrag.cmd, dauer_s: Math.round(dauer * 100) / 100, exit, signal: signal || null,
        timeout, ausgabe_bytes: bytes, _fehler: fehler, _ende: ende.subarray(Math.max(0, ende.length - ENDE_BYTES)).toString('utf8'),
      });
    };
    kind.on('error', e => { sammeln(Buffer.from(String(e))); fertig(-1, null); });
    kind.on('close', (code, signal) => fertig(code, signal));
  });
}

function stempel(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

// Temp-Verzeichnis eines Schritts wegraeumen (Windows: Dateien koennen kurz noch gesperrt sein)
function aufraeumen(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (e) { /* egal */ }
}

// Dauer je Schritt aus der Baseline (fuer die Reihenfolge); unbekannt -> Infinity (gilt als lang)
function baselineDauern() {
  const m = new Map();
  try {
    const b = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'testzeiten', 'baseline.json'), 'utf8'));
    for (const s of b.schritte || []) m.set(s.id, s.dauer_s);
  } catch (e) { /* ohne Baseline: alles unbekannt, Listenreihenfolge */ }
  return m;
}

async function main() {
  aufrufPruefen();
  const parallel = process.argv.includes('--parallel');
  if (!parallel && !process.argv.includes('--seriell')) {
    console.error('Aufruf: node tools/run-tests.js --seriell|--parallel [--worker N] [--nur ids] [--kette check|test] [--stufe fast|full|slow|alles] [--trocken] [--lastfaktor n] [--grenze-aus] [--timeout s] [--ausgabe datei] [--liste datei]');
    process.exit(2);
  }
  const listeDatei = path.resolve(argWert('--liste', path.join(__dirname, 'testliste.json')));
  const listeDoc = io.lesen(listeDatei);
  let liste = listeDoc.schritte;
  if (!argWert('--liste', null)) {
    const fehlend = ohneEintrag(listeDoc);
    const schlecht = listeDoc.ausgenommen.filter(a => !a.datei || !a.grund);
    if (fehlend.length || schlecht.length) {
      if (fehlend.length) console.error('Testliste unvollstaendig: ' + fehlend.length + ' Datei(en) in tools/ ohne Eintrag:\n  ' + fehlend.map(f => 'tools/' + f).join('\n  ')
        + '\nEntweder einen Schritt mit "stufe" (fast|full|slow) in tools/testliste.json anlegen (Budget danach mit node tools/testliste-budgets.js)'
        + ' oder die Datei unter "ausgenommen" mit Grund eintragen (z. B. Mutationsprobe auf Abruf, Live-Test).');
      if (schlecht.length) console.error('Eintraege unter "ausgenommen" brauchen "datei" und "grund": ' + JSON.stringify(schlecht.slice(0, 5)));
      process.exit(2);
    }
  }
  const STUFEN = ['fast', 'full', 'slow'];
  const ungueltig = liste.filter(e => !STUFEN.includes(e.stufe));
  if (ungueltig.length) {
    console.error('Testliste ungueltig: Feld "stufe" fehlt oder ist nicht fast|full|slow bei ' + ungueltig.length + ' Eintraegen: '
      + ungueltig.slice(0, 10).map(e => e.id + ' (' + JSON.stringify(e.stufe) + ')').join('; ') + (ungueltig.length > 10 ? ' ...' : ''));
    process.exit(2);
  }
  const stufe = argWert('--stufe', 'alles');
  if (![...STUFEN, 'alles'].includes(stufe)) { console.error('Ungueltige Stufe: ' + stufe + ' (erlaubt: fast, full, slow, alles)'); process.exit(2); }
  const timeoutS = zahlOption('--timeout', 1800, false);
  const lastfaktorOpt = zahlOption('--lastfaktor', 4, false);
  const lastfaktor = parallel ? lastfaktorOpt : 1;
  const workerOpt = zahlOption('--worker', Math.max(1, os.cpus().length - 4), true);
  const kette = argWert('--kette', null);
  if (kette) {
    const ketten = [...new Set(liste.map(e => e.kette))].sort();
    if (!ketten.includes(kette)) aufrufFehler('Unbekannte Kette: ' + kette + ' (in der Liste: ' + ketten.join(', ') + ')');
    liste = liste.filter(e => e.kette === kette);
  }
  const nur = argWert('--nur', null);
  if (nur) {
    const wunsch = nur.split(',').map(s => s.trim()).filter(Boolean);
    const unbekannt = wunsch.filter(w => !liste.some(e => e.id === w || e.id.split(' ')[0] === w));
    if (unbekannt.length) { console.error('Unbekannte Schritte: ' + unbekannt.join(', ')); process.exit(2); }
    liste = liste.filter(e => wunsch.some(w => e.id === w || e.id.split(' ')[0] === w));
  }
  liste = liste.filter(e => stufe === 'alles' || (stufe === 'full' ? e.stufe !== 'slow' : e.stufe === stufe));
  if (!liste.length) {
    aufrufFehler('Leere Auswahl: 0 Schritte nach Stufe ' + stufe + (kette ? ', Kette ' + kette : '') + (nur ? ', --nur ' + nur : '')
      + '. Ein leerer Lauf gilt nicht als gruen. (Schritte einer anderen Stufe lassen sich mit --stufe alles oder der passenden Stufe waehlen.)');
  }
  if (process.argv.includes('--trocken')) {
    const z = {}; for (const e of liste) z[e.stufe] = (z[e.stufe] || 0) + 1;
    console.log('Trocken: Stufe ' + stufe + (kette ? ', Kette ' + kette : '') + ': ' + liste.length + ' Schritte (fast ' + (z.fast || 0) + ', full ' + (z.full || 0)
      + ', slow ' + (z.slow || 0) + '), davon seriell-markiert ' + liste.filter(e => e.seriell).length);
    for (const e of liste) console.log('  ' + e.stufe.padEnd(5) + (e.seriell ? ' S ' : '   ') + e.id);
    process.exit(0);
  }
  const grenze = parallel && !process.argv.includes('--grenze-aus') ? io.grenze(listeDoc, stufe) : null;
  const grenzeS = grenze ? grenze.s : null;
  const grenzeHart = !!(grenze && grenze.hart);
  const worker = parallel ? Math.max(1, workerOpt) : 1;
  const jetzt = new Date();
  const ausgabe = path.resolve(argWert('--ausgabe', path.join(__dirname, 'fixtures', 'testzeiten', 'lauf-' + stempel(jetzt) + '.json')));
  fs.mkdirSync(path.dirname(ausgabe), { recursive: true });
  // Baseline nie halb beschreiben: erst .neu, nach vollstaendig gruenem Lauf darueberkopieren
  const istBaseline = ausgabe === path.resolve(__dirname, 'fixtures', 'testzeiten', 'baseline.json');
  const schreibPfad = istBaseline ? ausgabe + '.neu' : ausgabe;
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: WURZEL, encoding: 'utf8' });

  const doc = {
    datum: jetzt.toISOString(), node: process.version, kerne: os.cpus().length, modus: parallel ? 'parallel' : 'seriell', stufe, kette: kette || null,
    git: git.status === 0 ? git.stdout.trim() : null, timeout_s: timeoutS, schritte_gesamt: liste.length,
    lastfaktor, grenze_s: grenzeS, grenze_hart: grenzeHart,
    fertig: false, gesamtdauer_s: 0, schritte: [],
  };
  if (parallel) doc.worker = worker;
  const schreiben = () => fs.writeFileSync(schreibPfad, JSON.stringify(doc, null, 1) + '\n');
  const t0 = Date.now();
  const aktiv = lauf_.aktiv;
  lauf_.doc = doc; lauf_.schreiben = schreiben; lauf_.gestartet = true;
  schreiben();

  let abbruch = false;
  const eintragen = (r, start, ende) => {
    const rot = r.exit !== 0 || r.timeout;
    const e = { id: r.id, cmd: r.cmd, dauer_s: r.dauer_s, exit: r.exit, signal: r.signal, timeout: r.timeout, ausgabe_bytes: r.ausgabe_bytes };
    if (parallel) { e.start_s = start; e.ende_s = ende; }
    if (rot) { if (r._fehler && r._fehler.length) e.fehlerzeilen = r._fehler; e.ausgabe_ende = r._ende; }
    doc.schritte.push(e);
    doc.gesamtdauer_s = Math.round((Date.now() - t0) / 10) / 100;
    schreiben();
    const status = r.timeout ? 'TIMEOUT' : r.exit === 0 ? 'ok' : 'ROT (exit ' + r.exit + (r.signal ? ', ' + r.signal : '') + ')';
    console.log('[' + doc.schritte.length + '/' + liste.length + '] ' + r.id + '  ' + r.dauer_s.toFixed(1) + ' s  ' + status);
  };

  if (!parallel) {
    process.on('SIGINT', () => { abbruch = true; console.log('\nAbbruch angefordert, laufender Schritt wird noch beendet ...'); });
    for (let i = 0; i < liste.length && !abbruch; i++) {
      const r = await schrittLaufen(liste[i], timeoutS);
      eintragen(r);
    }
  } else {
    const tempBasis = lauf_.tempBasis = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-tests-'));
    const beendeAlles = () => {
      if (abbruch) return;
      abbruch = true;
      for (const k of aktiv) beenden(k);
      aufraeumen(tempBasis);
      doc.fertig = false; doc.abgebrochen = true;
      doc.gesamtdauer_s = Math.round((Date.now() - t0) / 10) / 100;
      schreiben();
      console.log('\nAbbruch: alle Schritte beendet, Zwischenstand: ' + schreibPfad);
      process.exit(1);
    };
    process.on('SIGINT', beendeAlles);
    process.on('SIGTERM', beendeAlles);
    // Reihenfolge: laengste zuerst (Baseline), unbekannte zuerst; seriell-Schritte kommen danach einzeln
    const dauern = baselineDauern();
    const lang = e => (dauern.has(e.id) ? dauern.get(e.id) : Infinity);
    const sortiert = a => a.map((e, i) => [e, i]).sort((x, y) => {
      const dx = lang(x[0]), dy = lang(y[0]);
      return dx === dy ? x[1] - y[1] : (dy > dx ? 1 : -1);
    }).map(x => x[0]);
    const pool = sortiert(liste.filter(e => !e.seriell));
    const exklusiv = sortiert(liste.filter(e => e.seriell));
    let zaehler = 0;
    const lauf = async (eintrag) => {
      const dir = path.join(tempBasis, 's' + (++zaehler));
      fs.mkdirSync(dir, { recursive: true });
      const env = Object.assign({}, process.env, { TEMP: dir, TMP: dir, TMPDIR: dir, REGIE_DIR: path.join(dir, 'regie') });
      const start = Math.round((Date.now() - t0) / 10) / 100;
      const r = await schrittLaufen(eintrag, timeoutS, env, aktiv);
      const ende = Math.round((Date.now() - t0) / 10) / 100;
      aufraeumen(dir);
      eintragen(r, start, ende);
    };
    let naechster = 0;
    const arbeiter = async () => { while (!abbruch && naechster < pool.length) await lauf(pool[naechster++]); };
    await Promise.all(Array.from({ length: Math.min(worker, pool.length) }, arbeiter));
    for (const e of exklusiv) { if (abbruch) break; await lauf(e); }
    aufraeumen(tempBasis);
  }
  doc.fertig = !abbruch;
  doc.gesamtdauer_s = Math.round((Date.now() - t0) / 10) / 100;
  schreiben();

  // Zeitbudget (nur Hinweis) und harte Grenze
  const budgets = new Map(liste.map(e => [e.id, e.budget_s]));
  doc.budget_ueberschritten = doc.schritte.filter(s => budgets.get(s.id) > 0 && s.dauer_s > budgets.get(s.id) * lastfaktor)
    .map(s => ({ id: s.id, dauer_s: s.dauer_s, budget_s: budgets.get(s.id), grenze_s: Math.round(budgets.get(s.id) * lastfaktor * 10) / 10,
      faktor: Math.round(s.dauer_s / (budgets.get(s.id) * lastfaktor) * 100) / 100 }))
    .sort((a, b) => b.faktor - a.faktor);
  doc.grenze_ueberschritten = !!(grenzeS && !abbruch && doc.gesamtdauer_s > grenzeS);
  const grenzeWirkt = doc.grenze_ueberschritten && grenzeHart;
  schreiben();

  const gruen = doc.schritte.filter(s => s.exit === 0 && !s.timeout).length;
  const tout = doc.schritte.filter(s => s.timeout).length;
  const rot = doc.schritte.length - gruen - tout;
  console.log('\nZusammenfassung: ' + doc.schritte.length + '/' + liste.length + ' Schritte, ' + gruen + ' gruen, ' + rot + ' rot, ' + tout + ' Timeout'
    + ', Stufe ' + stufe + (parallel ? ' (parallel, ' + worker + ' Worker)' : '') + (abbruch ? ' (abgebrochen)' : ''));
  console.log('Top 15 nach Dauer:');
  doc.schritte.slice().sort((a, b) => b.dauer_s - a.dauer_s).slice(0, 15)
    .forEach(s => console.log('  ' + s.dauer_s.toFixed(1).padStart(8) + ' s  ' + s.id));
  console.log('Gesamtdauer: ' + doc.gesamtdauer_s.toFixed(1) + ' s');
  if (doc.budget_ueberschritten.length) {
    console.log('\nZeitbudget ueberschritten (' + doc.budget_ueberschritten.length + ', nur Hinweis' + (parallel ? '; Budget x ' + lastfaktor + ' Last' : '') + '):');
    for (const b of doc.budget_ueberschritten) console.log('  ' + b.id + '  ' + b.dauer_s.toFixed(1) + ' s  Budget ' + b.grenze_s + ' s' + (parallel ? ' (' + b.budget_s + ' x ' + lastfaktor + ')' : '') + '  Faktor ' + b.faktor.toFixed(2));
  }
  const ohneBudget = liste.filter(e => !(e.budget_s > 0)).length;
  if (ohneBudget) console.log('Ohne budget_s: ' + ohneBudget + ' Schritt(e) (node tools/testliste-budgets.js --aus <serieller Lauf>)');
  const rote = doc.schritte.filter(s => s.exit !== 0 || s.timeout);
  if (rote.length) console.log('Rot/Timeout: ' + rote.map(s => s.id).join('; '));
  const grenzText = 'Stufe ' + stufe + ' brauchte ' + doc.gesamtdauer_s.toFixed(1) + ' s, Grenze ' + grenzeS + ' s (Wandzeit, parallel)';
  if (doc.grenze_ueberschritten) {
    if (!grenzeHart) console.log('\nZeitgrenze der Stufe ueberschritten, nur Hinweis: ' + grenzText + '.');
    else if (rote.length) console.log('\nHarte Grenze ueberschritten: ' + grenzText + '. Der Exit-Code bleibt 1 wegen roter Schritte.');
    else console.log('\nHARTE GRENZE UEBERSCHRITTEN: ' + grenzText + '. Exit 3.');
  }
  if (istBaseline) {
    if (!rote.length && !abbruch) { fs.renameSync(schreibPfad, ausgabe); console.log('Baseline aktualisiert (Lauf vollstaendig gruen): ' + ausgabe); }
    else console.log('Baseline NICHT ersetzt (Lauf nicht vollstaendig gruen). Zwischenstand: ' + schreibPfad);
  }
  console.log('Ergebnis: ' + (istBaseline && (rote.length || abbruch) ? schreibPfad : ausgabe));
  process.exit(rote.length || abbruch ? 1 : grenzeWirkt ? 3 : 0);
}

// Ausnahme nach dem Start (z. B. EBUSY beim Schreiben der Ergebnisdatei): Kindprozessbaeume beenden, Temp loeschen, Exit 1.
// Davor (Liste/Aufruf kaputt): Exit 2.
main().catch(e => {
  console.error(e);
  if (!lauf_.gestartet) process.exit(2);
  for (const k of lauf_.aktiv) beenden(k);
  if (lauf_.tempBasis) aufraeumen(lauf_.tempBasis);
  try { lauf_.doc.fertig = false; lauf_.doc.abgebrochen = true; lauf_.schreiben(); } catch (e2) { /* Ergebnisdatei nicht beschreibbar */ }
  console.error('Runner-Ausnahme: alle Schritte beendet, Temp aufgeraeumt, Exit 1.');
  process.exit(1);
});
