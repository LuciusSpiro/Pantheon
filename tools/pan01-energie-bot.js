'use strict';
// PAN-01 Paket A (Abnahme 4): Raumkampf-Bot (sim-headless arena) mit der echten Energie-Implementierung, mehrere Seeds, Mittelwerte je Satz.
//   node tools/pan01-energie-bot.js [--seeds 12] [--players 3] [--pilot maneuver] [--jobs 4] [--set "start;voll;..."] [--out datei.json]
// Sätze (Namen, siehe PRESETS): start (2 Module, 2/2/2), voll (4 Module per Debug, 1/2/1), voll-kampf (Technik schaltet beide Frachträume ab -> 2/2/2),
//   start-kampf (Technik schaltet Frachtraum + Krankenstation ab -> 8 frei), voll-212 / voll-121 u. a. zum Vergleich. Preload: tools/pan01-energie-preload.js.
// Gleiche Zählung wie die Erkundung PAN-01 (tools/erkundung-pan01/frage1-bot.js): Wellen geschafft, Hülle verloren, Notfälle (Hülle 30 = Zurücksetzen,
// kein Game Over), Dauer. Rauschen etwa ±20 Hülle und ±25–50 s bei 12 Seeds.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const a = process.argv.slice(2);
const arg = (k, d) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : d);
const seeds = Number(arg('--seeds', 12)), players = Number(arg('--players', 3)), pilot = arg('--pilot', 'maneuver'), jobs = Number(arg('--jobs', 4));
const PRESETS = {
  start: { PAN01_MODUL: 'start' },
  voll: { PAN01_MODUL: 'voll' },
  'voll-ohne-werkstatt': { PAN01_MODUL: 'frachtraum,krankenstation,frachtraum,krankenstation' },
  'voll-kampf': { PAN01_MODUL: 'voll', PAN01_KAMPF: 'aus:frachtraum,frachtraum' },
  'start-kampf': { PAN01_MODUL: 'start', PAN01_KAMPF: 'aus:frachtraum,krankenstation' },
  'voll-kampf-schild': { PAN01_MODUL: 'voll', PAN01_KAMPF: 'aus:frachtraum,frachtraum;1,3,2' },
  'voll-212': { PAN01_MODUL: 'voll', PAN01_POWER: '2,1,1' },
  'voll-112': { PAN01_MODUL: 'voll', PAN01_POWER: '1,1,2' },
  'voll-031': { PAN01_MODUL: 'voll', PAN01_POWER: '0,3,1' },
  'start-114': { PAN01_MODUL: 'start', PAN01_POWER: '1,1,4' },
};
const sets = arg('--set', 'start;voll;voll-kampf;start-kampf').split(';');
const root = path.join(__dirname, '..');
function run(set, seed) {
  return new Promise((res) => {
    const env = Object.assign({}, process.env, PRESETS[set] || {});
    const args = ['-r', './tools/pan01-energie-preload.js', 'tools/sim-headless.js', 'arena', '--pilot', pilot, '--seeds', '1', '--seed', String(seed), '--players', String(players)];
    const p = spawn(process.execPath, args, { cwd: root, env });
    let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    p.on('close', () => {
      const m = out.match(/Seed (\d+): (\d+)\/(\d+) Wellen \((\d+) über \d+ s\) in ([\d.]+) s(.*?) · Hülle −([\d.]+) \(Überlauf ([\d.—]+)\) · Notfälle (\d+) · je Welle (.*?) · leakHits (\d+)/);
      if (!m) return res({ set, seed, err: out.slice(-300) });
      res({ set, seed, cleared: +m[2], total: +m[3], failed: +m[4], time: +m[5], softlock: /SOFTLOCK/.test(m[6]), hull: +m[7], em: +m[9], leak: +m[11] });
    });
  });
}
(async () => {
  const tasks = []; for (const s of sets) for (let i = 1; i <= seeds; i++) tasks.push([s, i]);
  const results = []; let idx = 0;
  await Promise.all(Array.from({ length: jobs }, async () => { while (idx < tasks.length) { const t = tasks[idx++]; results.push(await run(t[0], t[1])); } }));
  const mean = (xs) => xs.reduce((x, y) => x + y, 0) / (xs.length || 1);
  const se = (xs) => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1)) / Math.sqrt(xs.length); };
  const f = (v) => (Math.round(v * 10) / 10).toString();
  console.log(`\nPAN-01 A Arena-Bot: Steuer ${pilot}, ${players} Spieler, ${seeds} Seeds, Standardwellen (6), echte Implementierung`);
  console.log('| Satz | Läufe | Wellen geschafft | Zeitlimit-Wellen | Hülle verloren (±SE) | Notfälle/Lauf | Dauer s (±SE) | Softlocks | Fehler |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const s of sets) {
    const rs = results.filter((r) => r.set === s && !r.err); const er = results.filter((r) => r.set === s && r.err).length;
    if (!rs.length) { console.log(`| ${s} | 0 | Fehler ${er} |`); continue; }
    console.log(`| ${s} | ${rs.length} | ${f(mean(rs.map((r) => r.cleared)))}/${rs[0].total} | ${f(mean(rs.map((r) => r.failed)))} | ${f(mean(rs.map((r) => r.hull)))} (±${f(se(rs.map((r) => r.hull)))}) | ${f(mean(rs.map((r) => r.em)))} | ${f(mean(rs.map((r) => r.time)))} (±${f(se(rs.map((r) => r.time)))}) | ${rs.filter((r) => r.softlock).length} | ${er} |`);
  }
  const o = arg('--out', null); if (o) fs.writeFileSync(o, JSON.stringify(results, null, 1));
})();
