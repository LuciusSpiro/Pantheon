'use strict';
// SYS-01 Erkundung Frage 1: Zeit bis Zerstörung je Klasse und Crewgröße (Arena-Bots von sim-headless) mit Messfühler tools/sys01-preload.js.
//   node tools/sys01-lauf.js [--kinds raider,korvette,fregatte,kreuzer] [--crews 1,3] [--seeds 20] [--waves 5] [--pilot maneuver] [--jobs 4] [--seed0 1]
// Je Lauf eine Arena mit <waves> Wellen aus einem einzigen Gegner der Klasse. Aggregiert die SYS01-Zeilen des Preloads.
const { spawn } = require('child_process');
const path = require('path');
const a = process.argv.slice(2);
const arg = (k, d) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : d);
const kinds = arg('--kinds', 'raider,korvette,fregatte,kreuzer').split(',');
const crews = arg('--crews', '1,3').split(',').map(Number);
const seeds = Number(arg('--seeds', 20)), waves = Number(arg('--waves', 5)), pilot = arg('--pilot', 'maneuver'), jobs = Number(arg('--jobs', 4)), seed0 = Number(arg('--seed0', 1)), waveLimit = Number(arg('--wave-limit', 600));
const root = path.join(__dirname, '..');
function lauf(kind, crew, seed) {
  return new Promise((res) => {
    const def = Array(waves).fill(kind).join(';');   // kind 'standard': die Standardwellen der Arena (gemischte Klassen), ohne --wellen-def
    const args = ['-r', './tools/sys01-preload.js', 'tools/sim-headless.js', 'arena', '--pilot', pilot, ...(kind === 'standard' ? [] : ['--wellen-def', def]), '--waves', String(waves), '--players', String(crew), '--seeds', '1', '--seed', String(seed), '--wave-limit', String(waveLimit), '--max', '6000'];
    const p = spawn(process.execPath, args, { cwd: root });
    let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    p.on('close', () => res({ g: out.split('\n').filter((l) => l.startsWith('SYS01 ')).map((l) => JSON.parse(l.slice(6))), l: out.split('\n').filter((l) => l.startsWith('SYS01L ')).map((l) => JSON.parse(l.slice(7))) }));
  });
}
const stat = (v) => {
  v = v.filter((x) => x != null).sort((x, y) => x - y); const n = v.length; if (!n) return { n: 0 };
  const m = v.reduce((s, x) => s + x, 0) / n; const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) * (x - m), 0) / Math.max(1, n - 1));
  const q = (p) => v[Math.min(n - 1, Math.floor(p * (n - 1) + 0.5))];
  return { n, mean: m, sd, med: q(0.5), p10: q(0.1), p90: q(0.9), min: v[0], max: v[n - 1] };
};
const f = (x) => (x == null ? '—' : (Math.round(x * 10) / 10).toString());
(async () => {
  const jobsList = [];
  for (const k of kinds) for (const c of crews) for (let i = 0; i < seeds; i++) jobsList.push([k, c, seed0 + i]);
  const results = {}, lerche = {}; let idx = 0;
  await Promise.all(Array.from({ length: jobs }, async () => { while (idx < jobsList.length) { const j = jobsList[idx++]; const r = await lauf(...j); (results[j[0] + '|' + j[1]] = results[j[0] + '|' + j[1]] || []).push(...r.g.filter((x) => j[0] === 'standard' || x.kind === j[0])); (lerche[j[0] + '|' + j[1]] = lerche[j[0] + '|' + j[1]] || []).push(...r.l); } }));
  console.log(`Befehl: node tools/sys01-lauf.js --kinds ${kinds} --crews ${crews} --seeds ${seeds} --seed0 ${seed0} --waves ${waves} --pilot ${pilot}   (je Lauf ${waves} Wellen à 1 Gegner; Steuer ${pilot})`);
  console.log('| Klasse | Crew | n | zerstört | Spawn→Tod Median (Mittel ± SD) | p10–p90 | Erstschaden→Tod Median (Mittel ± SD) | p10–p90 | Spawn→erster Treffer Lerche Median | erster Treffer→Schildsegment 0 Median (n) | erster Treffer→Systemschaden Median (n) | Hülle Lerche Mittel |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const k of kinds) for (const c of crews) {
    const rs = results[k + '|' + c] || []; const kill = rs.filter((r) => r.tKill != null);
    const s1 = stat(kill.map((r) => r.tKill)), s2 = stat(kill.map((r) => r.gefecht)), s3 = stat(rs.map((r) => r.tHitL)), s4 = stat(rs.map((r) => r.tSh0)), s5 = stat(rs.map((r) => r.tSys));
    const hull = rs.length ? rs.reduce((s, r) => s + r.integL, 0) / rs.length : null;
    console.log(`| ${k} | ${c} | ${rs.length} | ${kill.length} | ${f(s1.med)} (${f(s1.mean)} ± ${f(s1.sd)}) | ${f(s1.p10)}–${f(s1.p90)} | ${f(s2.med)} (${f(s2.mean)} ± ${f(s2.sd)}) | ${f(s2.p10)}–${f(s2.p90)} | ${f(s3.med)} | ${f(s4.med)} (${s4.n}) | ${f(s5.med)} (${s5.n}) | ${f(hull)} |`);
  }
  // SYS-01 D: Abnahme 13 misst Spawn → Reaktor zerstört (tRt, das Todesurteil); Spawn → Tod (tKill, inkl. Countdown) zusätzlich.
  console.log('\nAbnahme 13 (Spawn → Reaktor zerstört) und Tod (inkl. Countdown), wave-limit ' + waveLimit + ' s:');
  console.log('| Klasse | Crew | n Gegner | Reaktor zerstört (n) | Reaktor Median | p10–p90 | SD | Tod (n) | Tod Median | p10–p90 | nicht beendet |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const k of kinds) for (const c of crews) {
    const rs = results[k + '|' + c] || [];
    const sr = stat(rs.map((r) => r.tRt)), st = stat(rs.filter((r) => r.tKill != null).map((r) => r.tKill));
    console.log(`| ${k} | ${c} | ${rs.length} | ${sr.n || 0} | ${f(sr.med)} | ${f(sr.p10)}–${f(sr.p90)} | ${f(sr.sd)} | ${st.n || 0} | ${f(st.med)} | ${f(st.p10)}–${f(st.p90)} | ${rs.length - (st.n || 0)} |`);
  }
  // SYS-01 D (Task 5): Reaktor-Countdown, Zonenöffnung, Notsprung im Gefecht
  console.log(''); console.log('Countdown, Zonenöffnung, Notsprung (Bot-Läufe):');
  console.log('| Klasse | Crew | Läufe | Gegner | davon Tod über Reaktor (Countdown) | Tod ohne Reaktor (Sofort-Tod u. a.) | Zone offen (Anteil Gegner) | Spawn→Zone offen Median | Reaktor→Tod Median | Lerche Reaktorausfälle je Lauf | Notsprünge je Lauf | Notfälle je Lauf |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const k of kinds) for (const c of crews) {
    const rs = results[k + '|' + c] || []; const ls = lerche[k + '|' + c] || []; const kill = rs.filter((r) => r.tKill != null);
    const mR = kill.filter((r) => r.tRt != null), oR = kill.length - mR.length, zo = rs.filter((r) => r.tZone != null);
    const sz = stat(zo.map((r) => r.tZone)), sd = stat(mR.map((r) => r.tKill - r.tRt)); const n = Math.max(1, ls.length);
    console.log(`| ${k} | ${c} | ${ls.length} | ${rs.length} | ${mR.length} | ${oR} | ${rs.length ? Math.round(zo.length / rs.length * 100) : 0} % | ${f(sz.med)} | ${f(sd.med)} | ${f(ls.reduce((a, r) => a + r.reaktorAusfaelle, 0) / n)} | ${f(ls.reduce((a, r) => a + r.notsprung, 0) / n)} | ${f(ls.reduce((a, r) => a + r.notfaelle, 0) / n)} |`);
  }
})();
