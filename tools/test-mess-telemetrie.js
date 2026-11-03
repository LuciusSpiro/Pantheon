'use strict';
// TEL-01 E: Selbsttest der Tickmessung (tools/mess-telemetrie.js, tools/mess-telemetrie-vorlade.js) mit einem Kurzlauf (Wellen Kesh solo, 1 Seed, 2 Paare). KEINE Zeitgrenzen: das Ergebnis ist
// auf einer ausgelasteten Maschine (parallele Tests) beliebig; geprueft wird nur, dass die Messung funktioniert und die Zahlen plausibel gebaut sind.
//   1. Aufrufpruefung.  2. Kosten: Ergebnis vorhanden, Schreibmessung greift (patch_ok), Aufteilung B1 + B2 + Dienst = Summe, Schreibvorgaenge mit Bytes.
//   3. A-B-A-B: gleiche Ticks mit und ohne Protokoll (gleiche Last), Zahlen > 0, Rauschen berechnet.  4. Das Vorlademodul aendert das Spielverhalten nicht: Bot-Ausgabe mit und ohne -r identisch.
//   5. Bericht: Tabellen und Grenzen stehen drin.
//   node tools/test-mess-telemetrie.js   (npm run test:mess-telemetrie; Mutationsprobe: in mess-telemetrie-vorlade.js die Schreibmessung (Umhuellung von schreibe) weglassen -> Abschnitt 2 rot)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const M = require('./mess-telemetrie.js');
const ROOT = path.join(__dirname, '..');

let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const wirft = (f) => { try { f(); return null; } catch (e) { return e.message; } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-mess-test-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* egal */ } });

console.log('1. Aufrufpruefung');
ok(!!wirft(() => M.optionen(['--modi', 'unbekannt'])), 'unbekannter Modus: Fehler');
ok(!!wirft(() => M.optionen(['--paare', '0'])), '0 Paare: Fehler');
ok(M.optionen(['--kurz']).modi[0] === 'kurz' && M.optionen([]).modi.length === 3 && M.optionen([]).paare === 5, 'Standard: drei Modi, 5 Paare; --kurz nur der Kurzmodus');

console.log('\n2. Kosten (ein Kurzlauf)');
const k = M.messenKosten('kurz', [1], tmp, () => {});
ok(k.fehler.length === 0 && k.ticks > 1000, 'Lauf ohne Fehler, ' + k.ticks + ' Ticks' + (k.fehler.length ? ': ' + k.fehler[0] : ''));
if (k.fehler.length === 0) {
  ok(k.us_je_tick > 0 && Math.abs(k.us_je_tick - (k.B1 + k.B2 + k.Dienst)) < 0.01, 'us/Tick ' + k.us_je_tick.toFixed(2) + ' = B1 ' + k.B1.toFixed(2) + ' + B2 ' + k.B2.toFixed(2) + ' + Dienst ' + k.Dienst.toFixed(2));
  ok(k.top.length > 0 && k.top[0][2] > 0, 'Aufteilung nach Funktion vorhanden (groesste: ' + (k.top[0] || []).slice(0, 1) + ')');
  ok(k.schreiben.n >= 2 && k.schreiben.max_ms > 0 && k.schreiben.med_bytes > 0, 'Schreibvorgaenge gemessen: ' + k.schreiben.n + ', Max ' + (k.schreiben.max_ms || 0).toFixed(2) + ' ms, Median ' + Math.round(k.schreiben.med_bytes) + ' Bytes');
  ok(k.schreiben.max_ms >= k.schreiben.erster_max_ms - 1e-9, 'Maximum >= erster Vorgang');
}

console.log('\n3. A-B-A-B (2 Paare)');
const a = M.messenAbab('kurz', 1, 2, tmp, () => {});
ok(a.fehler.length === 0 && a.gleiche_ticks === true, 'gleiche Ticks mit und ohne Protokoll (' + a.ticks + '): gleiche Last');
if (a.med_us) {
  ok(a.med_us.aus > 0 && a.med_us.an > 0 && a.p99_us.aus >= a.med_us.aus, 'Median ' + a.med_us.aus.toFixed(0) + ' us aus, ' + a.med_us.an.toFixed(0) + ' us an; p99 >= Median');
  ok(a.med_us.rausch_aa_pct != null && a.med_us.rausch_bb_pct != null && a.med_us.je_paar_pct.length === 2, 'Rauschen A-A / B-B und Delta je Paar berechnet');
}

console.log('\n4. Das Vorlademodul aendert das Spielverhalten nicht');
const ausgabe = (mit) => spawnSync(process.execPath, (mit ? ['-r', path.join(__dirname, 'mess-telemetrie-vorlade.js')] : []).concat([path.join(__dirname, 'sim-headless.js'), 'wellen', '--karte', 'kesh', '--players', '1', '--seed', '1']),
  { cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, { TELEMETRIE: 'aus', MESS_ART: 'tick', MESS_AUS: path.join(tmp, 'v.jsonl') }) });
const x = ausgabe(false), y = ausgabe(true);
ok(x.status === y.status && x.stdout === y.stdout && x.stdout.length > 50, 'Bot-Ausgabe mit und ohne Vorlademodul identisch (' + x.stdout.length + ' Zeichen)');

console.log('\n5. Bericht');
if (k.fehler.length === 0 && a.med_us) {
  const text = M.bericht({ kosten: [k], abab: [a] }, { seeds: [1], seed: 1, paare: 2 });
  ok(/## Kosten der Protokollaufrufe je Tick/.test(text) && /## Schreibvorgang/.test(text) && /## A-B-A-B/.test(text) && /Grenze 20 us/.test(text) && /Grenze 5 ms/.test(text), 'Abschnitte und Grenzen im Bericht');
}
console.log(fails ? '\n' + fails + ' FEHLER' : '\nalle Pruefungen gruen');
process.exit(fails ? 1 : 0);
