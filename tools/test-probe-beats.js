'use strict';
// PAR-01 B: Regressionstest "ein neuer planbarer Beat darf keinen Test kippen". Faehrt eine kleine Auswahl leichter Kern-Tests
// (die Zaehl-/Katalog-/Brett-/Landeplatz-Tests, die frueher bei jedem neuen Beat rot wurden, plus ein paar Nachbarn) mit einem und mit
// zwei Probe-Beats (probe_a, probe_b nur im Speicher, tools/probe-beat.js) und verlangt 0 rote. Treiber: tools/probe-kette.js.
// Aufruf: node tools/test-probe-beats.js   (die volle Kette ueber alle Tests: npm run probe:beats, siehe probe-kette.js)
const path = require('path');
const { spawnSync } = require('child_process');

const AUSWAHL = ['test-faden-pruefer', 'test-faden-katalog-b1', 'test-faden-katalog-b2', 'test-abenteuer', 'test-abenteuer-brett', 'test-abenteuer-landeplaetze', 'test-abenteuer-titel', 'test-abenteuer-orte'];
const r = spawnSync(process.execPath, [path.join(__dirname, 'probe-kette.js'), '--stufen', '1,2', '--worker', '4', '--nur', AUSWAHL.join(',')], { cwd: path.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 1 << 26 });
process.stdout.write(r.stdout || '');
if (r.stderr) process.stderr.write(r.stderr);
const ok = r.status === 0;
console.log(ok ? 'ok: 0 rote Tests mit 1 und 2 Probe-Beats (' + AUSWAHL.length + ' Tests)' : 'FEHLER: Tests kippen durch zusaetzliche planbare Beats');
process.exit(ok ? 0 : 1);
