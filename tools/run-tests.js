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
//   --trocken  nur die Auswahl listen (Zahl je Stufe), nichts starten, keine Ausgabedatei, Exit 0
//   --timeout  je Schritt in Sekunden (Standard 1800)
//   --ausgabe  Ergebnis-JSON (Standard tools/fixtures/testzeiten/lauf-<Zeitstempel>.json)
//   --liste    andere Testliste (Standard tools/testliste.json)
// Kein Abbruch beim ersten roten Schritt; Gesamt-Exit 1 bei irgendeinem Roten oder Timeout.
// Optionales Feld je Listeneintrag: "seriell": true -> der Schritt laeuft im Parallelmodus erst nach dem Pool, allein
//   (kein anderer Schritt gleichzeitig). Gesetzt bei test-abenteuer und -kanon (spawnSync-Timeouts reissen bei ueberbuchter CPU).
//   --stufe aendert daran nichts: die Markierung gilt unabhaengig von der Stufe.
// Isolation im Parallelmodus: jeder Schritt bekommt ein eigenes Temp-Verzeichnis (TEMP/TMP/TMPDIR zeigen darauf,
//   os.tmpdir() liefert es), das nach dem Schritt geloescht wird; REGIE_DIR zeigt auf <Temp>/regie (Standard waere data/regie im Repo). Ports: die Tests nutzen Port 0 (frei vergeben), PORT wird
//   bewusst NICHT gesetzt. Ergebnis-JSON je Schritt zusaetzlich start_s/ende_s (relativ zum Laufbeginn).
// Ctrl-C: alle laufenden Kindprozessbaeume werden beendet (taskkill /T /F), Temp aufgeraeumt, Exit 1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const WURZEL = path.join(__dirname, '..');
const ENDE_BYTES = 2048;

function argWert(name, std) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : std;
}

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
    const uhr = setTimeout(() => { timeout = true; beenden(kind); }, timeoutS * 1000);
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
  const parallel = process.argv.includes('--parallel');
  if (!parallel && !process.argv.includes('--seriell')) {
    console.error('Aufruf: node tools/run-tests.js --seriell|--parallel [--worker N] [--nur ids] [--kette check|test] [--stufe fast|full|slow|alles] [--trocken] [--timeout s] [--ausgabe datei] [--liste datei]');
    process.exit(2);
  }
  const listeDatei = path.resolve(argWert('--liste', path.join(__dirname, 'testliste.json')));
  let liste = JSON.parse(fs.readFileSync(listeDatei, 'utf8'));
  const STUFEN = ['fast', 'full', 'slow'];
  const ungueltig = liste.filter(e => !STUFEN.includes(e.stufe));
  if (ungueltig.length) {
    console.error('Testliste ungueltig: Feld "stufe" fehlt oder ist nicht fast|full|slow bei ' + ungueltig.length + ' Eintraegen: '
      + ungueltig.slice(0, 10).map(e => e.id + ' (' + JSON.stringify(e.stufe) + ')').join('; ') + (ungueltig.length > 10 ? ' ...' : ''));
    process.exit(2);
  }
  const stufe = argWert('--stufe', 'alles');
  if (![...STUFEN, 'alles'].includes(stufe)) { console.error('Ungueltige Stufe: ' + stufe + ' (erlaubt: fast, full, slow, alles)'); process.exit(2); }
  const kette = argWert('--kette', null);
  if (kette) liste = liste.filter(e => e.kette === kette);
  const nur = argWert('--nur', null);
  if (nur) {
    const wunsch = nur.split(',').map(s => s.trim()).filter(Boolean);
    const unbekannt = wunsch.filter(w => !liste.some(e => e.id === w || e.id.split(' ')[0] === w));
    if (unbekannt.length) { console.error('Unbekannte Schritte: ' + unbekannt.join(', ')); process.exit(2); }
    liste = liste.filter(e => wunsch.some(w => e.id === w || e.id.split(' ')[0] === w));
  }
  liste = liste.filter(e => stufe === 'alles' || (stufe === 'full' ? e.stufe !== 'slow' : e.stufe === stufe));
  if (process.argv.includes('--trocken')) {
    const z = {}; for (const e of liste) z[e.stufe] = (z[e.stufe] || 0) + 1;
    console.log('Trocken: Stufe ' + stufe + (kette ? ', Kette ' + kette : '') + ': ' + liste.length + ' Schritte (fast ' + (z.fast || 0) + ', full ' + (z.full || 0)
      + ', slow ' + (z.slow || 0) + '), davon seriell-markiert ' + liste.filter(e => e.seriell).length);
    for (const e of liste) console.log('  ' + e.stufe.padEnd(5) + (e.seriell ? ' S ' : '   ') + e.id);
    process.exit(0);
  }
  const timeoutS = Number(argWert('--timeout', 1800));
  const worker = parallel ? Math.max(1, Math.floor(Number(argWert('--worker', Math.max(1, os.cpus().length - 4)))) || 1) : 1;
  const jetzt = new Date();
  const ausgabe = path.resolve(argWert('--ausgabe', path.join(__dirname, 'fixtures', 'testzeiten', 'lauf-' + stempel(jetzt) + '.json')));
  fs.mkdirSync(path.dirname(ausgabe), { recursive: true });
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: WURZEL, encoding: 'utf8' });

  const doc = {
    datum: jetzt.toISOString(), node: process.version, kerne: os.cpus().length, modus: parallel ? 'parallel' : 'seriell', stufe, kette: kette || null,
    git: git.status === 0 ? git.stdout.trim() : null, timeout_s: timeoutS, schritte_gesamt: liste.length,
    fertig: false, gesamtdauer_s: 0, schritte: [],
  };
  if (parallel) doc.worker = worker;
  const schreiben = () => fs.writeFileSync(ausgabe, JSON.stringify(doc, null, 1) + '\n');
  schreiben();

  const t0 = Date.now();
  const aktiv = new Set();
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
    const tempBasis = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-tests-'));
    const beendeAlles = () => {
      if (abbruch) return;
      abbruch = true;
      for (const k of aktiv) beenden(k);
      aufraeumen(tempBasis);
      doc.fertig = false; doc.abgebrochen = true;
      doc.gesamtdauer_s = Math.round((Date.now() - t0) / 10) / 100;
      schreiben();
      console.log('\nAbbruch: alle Schritte beendet, Zwischenstand: ' + ausgabe);
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

  const gruen = doc.schritte.filter(s => s.exit === 0 && !s.timeout).length;
  const tout = doc.schritte.filter(s => s.timeout).length;
  const rot = doc.schritte.length - gruen - tout;
  console.log('\nZusammenfassung: ' + doc.schritte.length + '/' + liste.length + ' Schritte, ' + gruen + ' gruen, ' + rot + ' rot, ' + tout + ' Timeout'
    + ', Stufe ' + stufe + (parallel ? ' (parallel, ' + worker + ' Worker)' : '') + (abbruch ? ' (abgebrochen)' : ''));
  console.log('Top 15 nach Dauer:');
  doc.schritte.slice().sort((a, b) => b.dauer_s - a.dauer_s).slice(0, 15)
    .forEach(s => console.log('  ' + s.dauer_s.toFixed(1).padStart(8) + ' s  ' + s.id));
  console.log('Gesamtdauer: ' + doc.gesamtdauer_s.toFixed(1) + ' s');
  const rote = doc.schritte.filter(s => s.exit !== 0 || s.timeout);
  if (rote.length) console.log('Rot/Timeout: ' + rote.map(s => s.id).join('; '));
  console.log('Ergebnis: ' + ausgabe);
  process.exit(rote.length || abbruch ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
