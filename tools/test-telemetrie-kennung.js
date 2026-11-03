'use strict';
// TEL-01 D2 Nacharbeit: Laufkennung. Die Sitzung des Protokolls (Kennung und Dateiname) ist Spielkennung + Prozess (runId + '-' + pid in Basis 36), kopf.run_id bleibt die Spielkennung.
// Grund: runId ist Zeit + Zaehler und kann in zwei Prozessen gleich sein (Bot-Laeufe mit --jobs, zwei Server); die Auswertung (Abfrage, Vergleich, Basis) haelt die Kennung fuer eindeutig.
//   node tools/test-telemetrie-kennung.js  (npm run test:telemetrie-kennung; Mutationsprobe: tools/mutation-auswertung.js)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { Game } = require('../server/game.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-tel-kennung-'));
process.on('exit', () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* egal */ } });
let zaehler = 0;
const neuesVerz = () => path.join(root, 'v' + (++zaehler));
const lesen = (f) => fs.readFileSync(f, 'utf8').split(String.fromCharCode(10)).filter(Boolean).map((l) => JSON.parse(l));
const dateien = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((x) => x.endsWith('.jsonl')).map((x) => path.join(d, x)) : []);

function setup(players, dir) {
  const env = { MISSION_SOURCE: 'fallback', TELEMETRIE: 'an', TELEMETRIE_DIR: dir, TELEMETRIE_QUELLE: 'bot' };
  const g = new Game({ noStore: true, seed: 7, env, log: () => {} });
  const conns = [];
  for (let i = 0; i < players; i++) {
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'Clientqzx-' + i, name: 'Spieler' + i, color: i });
    conns.push(c);
  }
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
  return { g, conns, run };
}

(async () => {
  console.log('Laufkennung (Sitzung = Spielkennung + Prozess)');
  {
    // D2-Nacharbeit: runId ist Zeit + Zaehler und kann in zwei Prozessen gleich sein (Bot-Laeufe mit --jobs, zwei Server). Kennung und Dateiname tragen deshalb die Prozesskennung, kopf.run_id bleibt die Spielkennung.
    const dl = neuesVerz();
    const sl = setup(1, dl);
    sl.run(1); sl.g.telemetrie.schreibeJetzt();
    const sit = sl.g.telemetrie.s.sitzung;
    ok(sit === String(sl.g.runId).replace(/[^A-Za-z0-9_-]/g, '_') + '-' + process.pid.toString(36), 'Sitzung = runId + "-" + Prozesskennung (' + sit + ')');
    sl.g.telemetrie.sessionBeenden('test');
    const fl = dateien(dl);
    const zl = fl.length === 1 ? lesen(fl[0]) : [];
    ok(fl.length === 1 && path.basename(fl[0]) === sit + '.jsonl', 'Dateiname = Sitzung');
    ok(zl[0] && zl[0].typ === 'kopf' && zl[0].run_id === sl.g.runId && zl[0].sitzung === sit && zl.every((z) => z.sitzung === sit), 'kopf.run_id bleibt die Spielkennung, jede Zeile traegt die Sitzung');
    // zwei Prozesse mit derselben runId: in denselben und in verschiedene Ordner
    const kind = path.join(root, 'kind.js');
    fs.writeFileSync(kind, [
      'const { Game } = require(' + JSON.stringify(path.join(__dirname, '..', 'server', 'game.js')) + ');',
      "const g = new Game({ noStore: true, seed: 7, env: { MISSION_SOURCE: 'fallback', TELEMETRIE: 'an', TELEMETRIE_DIR: process.argv[2] }, log: () => {} });",
      "g.runId = 'run-kollision-1'; g.telemetrie.sessionBeginnen(); g.telemetrie.ereignis('x', { a: 1 }); g.telemetrie.sessionBeenden('test');",
    ].join('\n'));
    const geteilt = neuesVerz(), anderes = neuesVerz();
    const r1 = spawnSync(process.execPath, [kind, geteilt], { encoding: 'utf8' });
    const r2 = spawnSync(process.execPath, [kind, geteilt], { encoding: 'utf8' });
    const r3 = spawnSync(process.execPath, [kind, anderes], { encoding: 'utf8' });
    ok(r1.status === 0 && r2.status === 0 && r3.status === 0, 'drei Prozesse mit derselben runId laufen (Exit ' + [r1.status, r2.status, r3.status].join(',') + ')');
    const fg = dateien(geteilt).map((f) => path.basename(f, '.jsonl')), fa = dateien(anderes).map((f) => path.basename(f, '.jsonl'));
    ok(fg.length === 2 && fg[0] !== fg[1] && fg.every((x) => /^run-kollision-1-[0-9a-z]+$/.test(x)), 'zwei Prozesse, derselbe Ordner: zwei Dateien mit verschiedener Kennung (' + fg.join(', ') + ')');
    ok(fa.length === 1 && /^run-kollision-1-[0-9a-z]+$/.test(fa[0]), 'anderer Ordner: Kennung nach demselben Muster');
    ok(new Set(fg.concat(fa)).size === 3, 'alle drei Kennungen sind verschieden, auch ueber Ordner hinweg');
    ok(dateien(geteilt).every((f) => { const z = lesen(f); return z[0].run_id === 'run-kollision-1' && z[0].sitzung === path.basename(f, '.jsonl'); }), 'run_id gleich, Sitzung = Dateiname je Datei');
  }

  console.log((n - fails) + '/' + n + ' ok');
  if (fails) { console.log('TEST-TELEMETRIE-KENNUNG FEHLER'); process.exit(1); }
  console.log('TEST-TELEMETRIE-KENNUNG OK');
})().catch((e) => { console.error(e); process.exit(1); });
