'use strict';
// Test-Runner (TST-01 Paket A): fuehrt die Schritte aus tools/testliste.json aus und misst Zeit, Exit-Code, Ausgabegroesse.
// Aufruf: node tools/run-tests.js --seriell [--nur <id,...>] [--kette check|test] [--timeout <s>]
//                                  [--ausgabe <datei.json>] [--liste <datei.json>]
//   --nur      Schritt-IDs oder Dateinamen ohne Argumente (z. B. test-flight), kommagetrennt
//   --timeout  je Schritt in Sekunden (Standard 1800)
//   --ausgabe  Ergebnis-JSON (Standard tools/fixtures/testzeiten/lauf-<Zeitstempel>.json)
//   --liste    andere Testliste (Standard tools/testliste.json)
// Kein Abbruch beim ersten roten Schritt; Gesamt-Exit 1 bei irgendeinem Roten oder Timeout.
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

function schrittLaufen(eintrag, timeoutS) {
  return new Promise(resolve => {
    const t0 = process.hrtime.bigint();
    const kind = spawn(process.execPath, eintrag.cmd, {
      cwd: WURZEL, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let bytes = 0;
    let ende = Buffer.alloc(0);
    let timeout = false;
    const sammeln = d => {
      bytes += d.length;
      ende = Buffer.concat([ende, d]);
      if (ende.length > ENDE_BYTES * 4) ende = ende.subarray(ende.length - ENDE_BYTES * 2);
    };
    kind.stdout.on('data', sammeln);
    kind.stderr.on('data', sammeln);
    const uhr = setTimeout(() => { timeout = true; beenden(kind); }, timeoutS * 1000);
    const fertig = (exit, signal) => {
      clearTimeout(uhr);
      const dauer = Number(process.hrtime.bigint() - t0) / 1e9;
      resolve({
        id: eintrag.id, cmd: eintrag.cmd, dauer_s: Math.round(dauer * 100) / 100, exit, signal: signal || null,
        timeout, ausgabe_bytes: bytes, _ende: ende.subarray(Math.max(0, ende.length - ENDE_BYTES)).toString('utf8'),
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

async function main() {
  if (!process.argv.includes('--seriell')) {
    console.error('Nur --seriell ist implementiert (Parallelmodus folgt in Paket B).');
    process.exit(2);
  }
  const listeDatei = path.resolve(argWert('--liste', path.join(__dirname, 'testliste.json')));
  let liste = JSON.parse(fs.readFileSync(listeDatei, 'utf8'));
  const kette = argWert('--kette', null);
  if (kette) liste = liste.filter(e => e.kette === kette);
  const nur = argWert('--nur', null);
  if (nur) {
    const wunsch = nur.split(',').map(s => s.trim()).filter(Boolean);
    const unbekannt = wunsch.filter(w => !liste.some(e => e.id === w || e.id.split(' ')[0] === w));
    if (unbekannt.length) { console.error('Unbekannte Schritte: ' + unbekannt.join(', ')); process.exit(2); }
    liste = liste.filter(e => wunsch.some(w => e.id === w || e.id.split(' ')[0] === w));
  }
  const timeoutS = Number(argWert('--timeout', 1800));
  const jetzt = new Date();
  const ausgabe = path.resolve(argWert('--ausgabe', path.join(__dirname, 'fixtures', 'testzeiten', 'lauf-' + stempel(jetzt) + '.json')));
  fs.mkdirSync(path.dirname(ausgabe), { recursive: true });
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: WURZEL, encoding: 'utf8' });

  const doc = {
    datum: jetzt.toISOString(), node: process.version, kerne: os.cpus().length, modus: 'seriell',
    git: git.status === 0 ? git.stdout.trim() : null, timeout_s: timeoutS, schritte_gesamt: liste.length,
    fertig: false, gesamtdauer_s: 0, schritte: [],
  };
  const schreiben = () => fs.writeFileSync(ausgabe, JSON.stringify(doc, null, 1) + '\n');
  schreiben();

  const t0 = Date.now();
  let abbruch = false;
  process.on('SIGINT', () => { abbruch = true; console.log('\nAbbruch angefordert, laufender Schritt wird noch beendet ...'); });
  for (let i = 0; i < liste.length && !abbruch; i++) {
    const r = await schrittLaufen(liste[i], timeoutS);
    const rot = r.exit !== 0 || r.timeout;
    const eintrag = { id: r.id, cmd: r.cmd, dauer_s: r.dauer_s, exit: r.exit, signal: r.signal, timeout: r.timeout, ausgabe_bytes: r.ausgabe_bytes };
    if (rot) eintrag.ausgabe_ende = r._ende;
    doc.schritte.push(eintrag);
    doc.gesamtdauer_s = Math.round((Date.now() - t0) / 10) / 100;
    schreiben();
    const status = r.timeout ? 'TIMEOUT' : r.exit === 0 ? 'ok' : 'ROT (exit ' + r.exit + (r.signal ? ', ' + r.signal : '') + ')';
    console.log('[' + (i + 1) + '/' + liste.length + '] ' + r.id + '  ' + r.dauer_s.toFixed(1) + ' s  ' + status);
  }
  doc.fertig = !abbruch;
  doc.gesamtdauer_s = Math.round((Date.now() - t0) / 10) / 100;
  schreiben();

  const gruen = doc.schritte.filter(s => s.exit === 0 && !s.timeout).length;
  const tout = doc.schritte.filter(s => s.timeout).length;
  const rot = doc.schritte.length - gruen - tout;
  console.log('\nZusammenfassung: ' + doc.schritte.length + '/' + liste.length + ' Schritte, ' + gruen + ' gruen, ' + rot + ' rot, ' + tout + ' Timeout'
    + (abbruch ? ' (abgebrochen)' : ''));
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
