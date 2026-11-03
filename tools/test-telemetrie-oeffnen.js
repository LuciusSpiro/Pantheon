'use strict';
// TEL-01 E: Der erste Schreibvorgang einer Session legt keine Datei mehr an. Ordner, Protokolldatei, Rotation und Tuning-Datei entstehen beim Sessionbeginn bzw. am Ende des Starts
// (vor dem ersten Tick); das Anlegen der Datei kostete auf Windows 0,3 bis 8 ms und stand vorher im ersten Flush. Geprueft per Zaehler auf fs (nicht per Zeit):
//   1. Nach dem Start (vor dem ersten Tick): die Protokolldatei ist angelegt (1 openSync auf .jsonl), die Tuning-Datei geschrieben.
//   2. Ticks laufen, der erste schreibeJetzt(): kein openSync auf eine .jsonl, kein mkdirSync/readdirSync im Protokollordner, kein writeFileSync der Tuning-Datei; die Zeilen stehen trotzdem in der Datei.
//   3. Fehlerfall wie bisher: Ordner nicht anlegbar -> kein Wurf, Fehler gezaehlt, der Tick laeuft weiter.
//   node tools/test-telemetrie-oeffnen.js   (npm run test:telemetrie-oeffnen; Mutationsprobe: oeffnen(s, true) in sessionBeginnen() entfernen -> Abschnitt 1 und 2 rot)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Game } = require('../server/game.js');

let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-tel-oeffnen-'));
process.on('exit', () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* egal */ } });

// Zaehler auf fs: nur Aufrufe, die den Protokollordner `dir` betreffen
function spy(dir) {
  const z = { openJsonl: 0, mkdir: 0, readdir: 0, tuningWrite: 0 };
  const alt = { open: fs.openSync, mkdir: fs.mkdirSync, readdir: fs.readdirSync, wf: fs.writeFileSync };
  const im = (p) => typeof p === 'string' && path.resolve(p).startsWith(path.resolve(dir));
  fs.openSync = function (p) { if (im(p) && String(p).endsWith('.jsonl')) z.openJsonl++; return alt.open.apply(this, arguments); };
  fs.mkdirSync = function (p) { if (im(p)) z.mkdir++; return alt.mkdir.apply(this, arguments); };
  fs.readdirSync = function (p) { if (im(p)) z.readdir++; return alt.readdir.apply(this, arguments); };
  fs.writeFileSync = function (p) { if (im(p) && /tuning/.test(String(p))) z.tuningWrite++; return alt.wf.apply(this, arguments); };
  return { z, frei() { fs.openSync = alt.open; fs.mkdirSync = alt.mkdir; fs.readdirSync = alt.readdir; fs.writeFileSync = alt.wf; }, nullen() { for (const k of Object.keys(z)) z[k] = 0; } };
}

function start(dir) {
  const env = { MISSION_SOURCE: 'fallback', TELEMETRIE: 'an', TELEMETRIE_DIR: dir, TELEMETRIE_QUELLE: 'bot' };
  const g = new Game({ noStore: true, seed: 7, env, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'c-oeffnen', name: 'Test', color: 0 });
  g.handleMessage(c, { t: 'ready', ready: true });
  return g;
}

console.log('1. Nach dem Start, vor dem ersten Tick');
const d1 = path.join(root, 'a');
const s = spy(d1);
let g;
try {
  g = start(d1);
  ok(g.phase === 'play' && g.runId, 'Partie laeuft');
  ok(s.z.openJsonl === 1 && g.telemetrie.stand().datei, 'die Protokolldatei ist angelegt (openSync auf .jsonl: ' + s.z.openJsonl + ')');
  ok(s.z.tuningWrite === 1 || fs.existsSync(path.join(d1, 'tuning')), 'die Tuning-Datei ist geschrieben (writeFileSync: ' + s.z.tuningWrite + ')');
  ok(g.tick === 0, 'noch kein Tick gelaufen');

  console.log('\n2. Ticks und erster Schreibvorgang');
  s.nullen();
  for (let i = 0; i < 90; i++) g.step();
  g.telemetrie.schreibeJetzt();
  ok(s.z.openJsonl === 0, 'kein openSync auf eine .jsonl im ersten Schreibvorgang (' + s.z.openJsonl + ')');
  ok(s.z.mkdir === 0 && s.z.readdir === 0, 'kein mkdirSync/readdirSync im Protokollordner (' + s.z.mkdir + '/' + s.z.readdir + ')');
  ok(s.z.tuningWrite === 0, 'kein Schreiben der Tuning-Datei im ersten Schreibvorgang (' + s.z.tuningWrite + ')');
  const f = g.telemetrie.stand().datei;
  const zeilen = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  ok(zeilen.length > 1 && zeilen[0].typ === 'kopf', 'die Zeilen stehen in der Datei (' + zeilen.length + ', erste: kopf)');
} finally { s.frei(); }

console.log('\n3. Fehlerfall: Ordner nicht anlegbar');
const sperr = path.join(root, 'datei');
fs.writeFileSync(sperr, 'x');
let wurf = null; let g2 = null;
try { g2 = start(path.join(sperr, 'unter')); for (let i = 0; i < 30; i++) g2.step(); } catch (e) { wurf = e; }
ok(!wurf, 'kein Wurf beim Start und im Tick' + (wurf ? ': ' + wurf.message : ''));
ok(g2 && g2.telemetrie.fehler > 0 && g2.tick > 0, 'Fehler gezaehlt (' + (g2 && g2.telemetrie.fehler) + '), Spiel laeuft weiter (Tick ' + (g2 && g2.tick) + ')');
console.log(fails ? '\n' + fails + ' FEHLER' : '\nalle Pruefungen gruen');
process.exit(fails ? 1 : 0);
