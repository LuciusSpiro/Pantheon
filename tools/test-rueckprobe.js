'use strict';
// TEL-01 E: Test der Rueckwaertsprobe (tools/rueckprobe.js) mit einem Kleinlauf (Wellen Kesh solo, 4 Seeds, wenige Sekunden).
//   1. Aufrufpruefung: Pflichtoptionen, unbekannte Gruppe, zu wenige Seeds.
//   2. Ein Pfad, der keine Zahl ist, bricht ab (kein stiller Lauf ohne Fehler).
//   3. Kleinlauf: der eingebaute Fehler (Blaster-Schaden x2) wirkt (die Laeufe mit Fehler weichen von denen ohne ab = Lauf gegen Lauf, dieselbe Seed), der Tuning-Pfad steht im Kopf des
//      Gruppenvergleichs, der Bericht hat die Zeilen a), b), b0), c); die Kontrolle ohne Fehler hat denselben Tuning-Hash wie die Basis (der Fehler leckt nicht in saubere Laeufe).
//   4. Das Repo bleibt unberuehrt: `git status` fuer server/, shared/, content/ leer, shared/config.js hat den alten Wert.
//   node tools/test-rueckprobe.js   (npm run test:rueckprobe; Mutationsprobe: in VORLADE den Faktor ignorieren -> Abschnitt 3 rot)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const R = require('./rueckprobe.js');
const ROOT = path.join(__dirname, '..');

let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const wirft = (f) => { try { f(); return null; } catch (e) { return e.message; } };

console.log('1. Aufrufpruefung');
ok(!!wirft(() => R.optionen([])), 'ohne Pflichtoptionen: Fehler');
ok(/unbekannte Gruppe/.test(wirft(() => R.optionen(['--pfad', 'a.b', '--faktor', '2', '--gruppe', 'gibt/es/nicht'])) || ''), 'unbekannte Gruppe: Fehler');
ok(/seeds/.test(wirft(() => R.optionen(['--pfad', 'a.b', '--faktor', '2', '--gruppe', 'm1/1', '--seeds', '3'])) || ''), 'weniger als 4 Seeds: Fehler');
ok(R.optionen(['--pfad', 'a.b', '--faktor', '1.2', '--gruppe', 'm1/1,m1/3']).gruppen.length === 2 && R.optionen(['--pfad', 'a.b', '--faktor', '1.2', '--gruppe', 'm1/1']).seeds === 12, 'gueltiger Aufruf: Gruppenliste, Standard 12 Seeds');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-rueckprobe-test-'));
  const log = () => {};
  console.log('\n2. Pfad ohne Zahl');
  let fehler = null;
  try { await R.probe(R.optionen(['--pfad', 'awayCombat.waffen.blaster', '--faktor', '2', '--gruppe', 'arena_away/kesh/1', '--seeds', '4']), path.join(tmp, 'x'), log); } catch (e) { fehler = e.message; }
  ok(/keine Zahl/.test(fehler || ''), 'awayCombat.waffen.blaster (ein Objekt) bricht ab: ' + fehler);

  console.log('\n3. Kleinlauf Wellen Kesh solo, Blaster-Schaden x2');
  const o = R.optionen(['--pfad', 'awayCombat.waffen.blaster.schaden', '--faktor', '2', '--gruppe', 'arena_away/kesh/1', '--seeds', '4', '--jobs', '4']);
  const wert0 = require('../shared/config.js').awayCombat.waffen.blaster.schaden;
  const aus = await R.probe(o, path.join(tmp, 'lauf'), log);
  const g = aus.gruppen[0];
  ok(g.schlechte.length === 0, 'alle 12 Laeufe mit gueltiger Session (' + g.schlechte.join('; ') + ')');
  ok(g.b.seeds.length === 4 && g.b.seeds.every((x) => x.wesentlich > 0), 'Lauf gegen Lauf: in jeder der 4 Seeds weicht der Lauf mit Fehler ab (' + g.b.seeds.map((x) => x.wesentlich).join(',') + ')');
  ok(g.a.tuningPfad === true, 'der Tuning-Pfad (blaster.schaden) steht im Kopf des Gruppenvergleichs');
  ok(g.c.n === 4 && g.b.rauschen.length === 4, 'Kontrolle (4 Laeufe) und Rauschen (4 Paare) vorhanden');
  const text = R.bericht(aus, o);
  ok(/a\) Basis gegen Fehler/.test(text) && /b\) Lauf gegen Lauf/.test(text) && /b0\) Rauschen/.test(text) && /c\) Kontrolle/.test(text), 'Bericht hat die Zeilen a), b), b0), c)');
  const bas = require('./fixtures/telemetrie/basis-win32-x64.json');
  const dateien = fs.readdirSync(path.join(tmp, 'lauf', 'tuning'));
  ok(dateien.includes(bas.kopf.tuning_hash + '.json') && dateien.length === 2, 'die Laeufe ohne Fehler tragen den Tuning-Hash der Basis (' + bas.kopf.tuning_hash + '), der Fehler hat einen eigenen: ' + dateien.length + ' Tuning-Dateien');

  console.log('\n4. Repo unberuehrt');
  ok(require('../shared/config.js').awayCombat.waffen.blaster.schaden === wert0 && wert0 === 1, 'shared/config.js im eigenen Prozess unveraendert (blaster.schaden ' + wert0 + ')');
  const st = spawnSync('git', ['status', '--porcelain', '--', 'server', 'shared', 'content'], { cwd: ROOT, encoding: 'utf8' });
  ok(st.status === 0 && st.stdout.trim() === '', 'git status fuer server, shared, content leer');
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* egal */ }
  console.log(fails ? '\n' + fails + ' FEHLER' : '\nalle Pruefungen gruen');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
