'use strict';
// PAN-01 D: Marken-Messung der Kampagnenkette für die Werftpreise. Startet `sim-headless kette --marken` je Crew und Seed (parallel) und schreibt
// tools/fixtures/werft-kette-marken.json: je Lauf der Kontostand am Anfang und Ende jedes Kapitels (Bot ohne Einkäufe, Startmarken 150).
// tools/test-werft.js bindet die Preise an dieses Ergebnis (Stufe 1 + 2 + zwei Waffen unter dem schwächsten Wert an Castra Martis, Stufe 1 + 2 + 3 über dem höchsten Kapitel-6-Wert).
//   node tools/messung-kette-marken.js [--seeds 6] [--crews 1,3] [--jobs 4]
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const seeds = Number(arg('--seeds', 6));
const crews = String(arg('--crews', '1,3')).split(',').map(Number);
const jobs = Number(arg('--jobs', 4));
const OUT = path.join(__dirname, 'fixtures', 'werft-kette-marken.json');

const todo = [];
for (const crew of crews) for (let s = 1; s <= seeds; s++) todo.push({ crew, seed: s });
const laeufe = [];
function lauf(j) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(__dirname, 'sim-headless.js'), 'kette', '--crew', String(j.crew), '--seed', String(j.seed), '--marken'], { cwd: path.join(__dirname, '..') });
    let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    p.on('close', () => {
      const m = /^Marken .* Crew (\d+) Seed (\d+): (.*)$/m.exec(out);
      if (!m) { console.log(`Crew ${j.crew} Seed ${j.seed}: keine Messzeile`); return resolve(); }
      const kap = {};
      for (const teil of m[3].split(' | ')) {
        const q = /^(K\d) (\d+)->(\d+)$/.exec(teil.trim()); if (!q) continue;
        if (!kap[q[1]]) kap[q[1]] = { start: Number(q[2]), ende: Number(q[3]) }; else kap[q[1]].ende = Number(q[3]);   // Kapitel 7 kann mehrfach beginnen (Rückzüge)
      }
      laeufe.push({ crew: j.crew, seed: j.seed, ok: /SIM KETTE OK/.test(out), kapitel: kap });
      console.log(`Crew ${j.crew} Seed ${j.seed}: K5 Ende ${kap.K5 && kap.K5.ende}, K6 Ende ${kap.K6 && kap.K6.ende}`);
      resolve();
    });
  });
}
(async () => {
  const q = todo.slice();
  await Promise.all(Array.from({ length: jobs }, async () => { while (q.length) await lauf(q.shift()); }));
  laeufe.sort((a, b) => a.crew - b.crew || a.seed - b.seed);
  fs.writeFileSync(OUT, JSON.stringify({ gemessen: new Date().toISOString().slice(0, 10), start: 150, laeufe }, null, 1) + '\n');
  console.log('geschrieben: ' + OUT);
})();
