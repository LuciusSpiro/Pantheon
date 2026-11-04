'use strict';
// AUS-01 Nacharbeit: Der Bot-Pfad (sim-headless KeshAgent.loadoutStep, golden-trace) ist KEIN toter Code: Bots betreten die Ausrüstungsstation
// und senden ausruestung.slot, wenn ihre Wunschwaffe von der aktiven abweicht. Belegt über den Zähler simStats.ausgeruestet (Zeile „Ausrüstung:“
// in der m3-Ausgabe von sim-headless). Der Lauf selbst darf scheitern (Lanze ist in der Ruine bewusst keine gute Wahl); nur der Zähler zählt.
//   node tools/test-ausruestung-bot.js  (npm run test:ausruestung-bot)
const path = require('path');
const { spawnSync } = require('child_process');

let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

function lauf(seed, waffe) {
  const env = Object.assign({}, process.env);
  if (waffe) env.BOT_WAFFE = waffe; else delete env.BOT_WAFFE;
  const r = spawnSync(process.execPath, [path.join(__dirname, 'sim-headless.js'), 'm3', '--seed', String(seed)], { cwd: path.join(__dirname, '..'), env, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 280000 });
  const m = /Ausrüstung: (\d+) Befehle ausruestung\.slot/.exec(r.stdout || '');
  return m ? Number(m[1]) : null;
}

const mit = lauf(5, 'lanze');
ok(mit !== null && mit > 0, 'BOT_WAFFE=lanze, m3, Seed 5: Bots betreten die Station und senden ausruestung.slot (Zähler ' + mit + ' > 0)');
// Standard (ohne BOT_WAFFE): Der Pfad ist nur aktiv, wenn die Tabelle BOT_WAFFEN eine andere Waffe als den Blaster ergibt (Spitze zu dritt: 35 % Sturmgewehr). Nur Beschreibung, keine Prüfung.
const std = lauf(4, null);
console.log('  --   Standard ohne BOT_WAFFE, m3, Seed 4: Zähler ' + std + (std > 0 ? ' (Pfad läuft auch im Standard, wenn die Tabelle eine Nicht-Blaster-Waffe wählt)' : ' (Tabelle wählte den Blaster: nichts zu tun)'));
ok(std !== null, 'Standardlauf liefert den Zähler');

console.log(fails ? '\n' + fails + ' FEHLER' : '\nalle ok');
process.exit(fails ? 1 : 0);
