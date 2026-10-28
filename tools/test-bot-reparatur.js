'use strict';
// SYS-02c Problem 1: Reparaturschleife bei Triebwerksausfall (Sim-Bots). Zustandsablauf im laufenden Arena-Spiel, kein Attrappen-Test:
//   Debug-Schaden am Triebwerk (engines zerstört) bei t >= 15 s mitten im Gefecht (ein Gegner da), mit und ohne Ersatzteile, solo und zu dritt. Erwartet:
//     - das Triebwerk ist innerhalb der Frist wieder ok (Ersatzteil: Austausch, ohne Teil: Flicken zerstört -> beschädigt -> ok),
//     - die Reparaturliste ist danach leer (kein hängender Eintrag, kein Schrauber ohne Auftrag in der Liste),
//     - die Reparatur kostet höchstens ein Ersatzteil (Spieler-Bot und Schrauber holen nicht beide eines für dasselbe System),
//     - solo verlässt der Spieler-Bot dafür die Konsole nicht (nur Reaktor/Schilde sind im Gefecht kritisch; den Rest macht der Schrauber).
//   Der Test startet sim-headless arena als Kindprozess und lädt sich selbst als Preload (Umgebungsvariable BOTREP).
//   node tools/test-bot-reparatur.js
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');

if (process.env.BOTREP) {   // ---- Preload im Kindprozess ----
  const { Game } = require('../server/game.js');
  const interior = require('../server/sim/interior.js');
  const cfg = JSON.parse(process.env.BOTREP);
  const orig = Game.prototype.step; let done = false; const log = []; let last = -9; let maxTeile = 0;
  Game.prototype.step = function (...a) {
    const r = orig.apply(this, a);
    const t = this.time;
    if (!done && t >= 15 && this.space && this.space.enemies.length) { done = true; this.inventory.ersatzteil = cfg.teile; interior.damageSystem(this, 'engines', 'broken', { debug: true }); log.push({ t, z: 'broken', teile: this.inventory.ersatzteil }); }
    if (done && t - last >= 1) {
      last = t;
      const z = this.ship.systems.engines; const q = (this.ship.repairQueue || []).length;
      const traeger = this.players.filter((p) => p.carry === 'ersatzteil').length + this.bots.filter((b) => b.carry === 'ersatzteil').length;
      const teile = this.inventory.ersatzteil + traeger;
      const p0 = this.players[0];
      const k = log[log.length - 1];
      if (!k || k.z !== z || k.q !== q || k.teile !== teile) log.push({ t: Math.round(t * 10) / 10, z, q, teile, ort: p0 ? (p0.console || p0.zone) : null });
    }
    return r;
  };
  process.on('exit', () => {
    const sim = (global.__simStatsRef || {});
    console.log('BOTREP ' + JSON.stringify({ log, ende: { z: log.length ? log[log.length - 1].z : null } }));
  });
  // sim-headless wird danach als Hauptmodul geladen (process.argv), der Hook sitzt vorher
  return;
}

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function lauf(spieler, teile) {
  const env = Object.assign({}, process.env, { BOTREP: JSON.stringify({ teile }) });
  const r = spawnSync(process.execPath, ['-r', path.join(__dirname, 'test-bot-reparatur.js'), 'tools/sim-headless.js', 'arena', '--pilot', 'maneuver', '--wellen-def', 'raider', '--waves', '1',
    '--players', String(spieler), '--seeds', '1', '--seed', '1', '--wave-limit', '120', '--max', '6000'], { cwd: ROOT, env, encoding: 'utf8', timeout: 240000 });
  const m = (r.stdout || '').split('\n').find((l) => l.startsWith('BOTREP '));
  if (!m) throw new Error('keine BOTREP-Zeile: ' + (r.stderr || '').slice(0, 300) + (r.stdout || '').slice(-300));
  return JSON.parse(m.slice(7));
}
const wannOk = (log) => { const e = log.find((x) => x.z === 'ok'); return e ? e.t : null; };
const ablauf = (log) => log.map((x) => x.z).filter((z, i, a) => i === 0 || a[i - 1] !== z).join(' -> ');

for (const spieler of [1, 3]) for (const teile of [4, 0]) {
  console.log(`\n[Triebwerk zerstört: ${spieler === 1 ? 'solo' : 'zu dritt'}, ${teile} Ersatzteile]`);
  const { log } = lauf(spieler, teile);
  const t0 = log[0].t, t1 = wannOk(log);
  console.log('  Ablauf: ' + ablauf(log) + (t1 != null ? ` (ok nach ${(t1 - t0).toFixed(0)} s)` : ''));
  ok(t1 != null && t1 - t0 <= 45, `Triebwerk wieder ok innerhalb von 45 s (${t1 != null ? (t1 - t0).toFixed(0) + ' s' : 'nie'})`);
  const nachOk = log.filter((x) => t1 != null && x.t >= t1);
  ok(nachOk.length > 0 && nachOk.every((x) => x.q === 0 || x.q === undefined), 'Reparaturliste nach der Reparatur leer');
  const minTeile = Math.min(...log.filter((x) => x.teile !== undefined).map((x) => x.teile));
  ok(teile === 0 ? minTeile === 0 : minTeile >= teile - 1, `höchstens ein Ersatzteil verbraucht (Bestand + Getragenes min. ${minTeile} von ${teile})`);
  if (spieler === 1) ok(log.every((x) => x.ort !== 'ship' && x.ort !== null), 'solo: der Spieler-Bot bleibt im Gefecht an der Konsole (Orte: ' + [...new Set(log.map((x) => x.ort))].join(',') + ')');
}

console.log(`\ntest-bot-reparatur: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
