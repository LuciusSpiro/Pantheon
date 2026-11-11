'use strict';
// EIS-01 P5: Der Kette-Bot spielt Kapitel 4 (Schritt kette/bunker auf der Festkarte grabenangriff) ueber das Tor (Lift) und ueber das Rohr, OHNE Skip.
// GOD: Der Bot gewinnt das Bunker-Gefecht ohne god nicht (Erkundung EIS-01 Frage 3, Bot-Schwaeche). Darum ist game.god im Bunker-Schritt (und NUR dort) an und das Ergebnis weist es aus
// (Spalte "god" der Kette-Tabelle, res.god, Mitschnitt kuenstlich 'god'). Dieser Test prueft die Kennzeichnung ebenso wie den Sieg: Sieg, Fehler 0, skip x0, god nur im Schritt,
// genommener Zugang (tor = Lift, rohr = Leiter), Flag methalle_gesprengt, Kapitel 5 erreicht. Kleine Seeds, Crew 1 und 3 (je beide Zugaenge) + ein CLI-Lauf fuer die Tabelle.
// Die ganze Kette (Crew 1/3, K4 bis Abspann) ist nur manueller Beleg: node tools/sim-headless.js kette --von k4_methalle --crew 1 --bunker tor
//   node tools/test-bunker-kette-bot.js
const path = require('path');
const { spawnSync } = require('child_process');
const CONFIG = require('../shared/config.js');
const { runGeneric } = require('./sim-headless.js');

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };

(async () => {
  for (const crew of [1, 3]) for (const route of ['tor', 'rohr']) {
    console.log(`\n[K4-Einstieg Crew ${crew}, Zugang ${route}, god im Bunker-Schritt, Seed 1]`);
    const t0 = Date.now();
    let G = null; let godAusserhalb = 0; let godImSchritt = 0;
    const r = await runGeneric({ seed: 1, crew, mode: 'kette', start: 'eisenwald_ohne', einstieg: 'k4_methalle', stopNach: 'k4_methalle', pilot: 'maneuver', maxSec: 5000, missionMax: 3600, funk: 'b', bunker: route,
      tickHook: (g) => { G = g; const m = g.mission; const imBunker = !!(m.activeId && m.step && m.step.umsetzung === 'kette/bunker'); if (g.god) { if (imBunker) godImSchritt++; else godAusserhalb++; } } });
    const k4 = r.missions.find((m) => m.id === 'k4_methalle') || {};
    ok(!r.aborted && r.stopNach === 'k4_methalle', `Kapitel 4 beendet, kein Abbruch (${r.aborted || 'ok'}, ${r.gameTime} s)`);
    ok(k4.success && k4.ausgang === 'erfolg', `Ausgang erfolg (${k4.ausgang})`);
    ok(r.errors === 0, 'Fehler 0 (' + r.errors + ')');
    ok(!(k4.skips && k4.skips.length), 'skip x0 (kein Skip in K4)');
    ok(k4.steps && k4.steps.some((s) => s.ums === 'kette/bunker' && !s.skipped), 'Bunker-Schritt gespielt, nicht uebersprungen');
    ok(r.god && r.god.length === 1 && r.god[0].route === route && r.god[0].mission === 'k4_methalle' && r.god[0].bis > r.god[0].von, `god ausgewiesen (res.god: ${JSON.stringify(r.god)})`);
    ok(godImSchritt > 0 && godAusserhalb === 0 && G && !G.god, `god nur im Bunker-Schritt (Ticks im Schritt ${godImSchritt}, ausserhalb ${godAusserhalb}), am Ende aus`);
    ok(r.sim.bunkerWeg && r.sim.bunkerWeg.hinein === (route === 'rohr' ? 'rohr' : 'lift'), `Zugang hinein: ${route === 'rohr' ? 'Leiter (Rohr)' : 'Lift (Tor)'} (${JSON.stringify(r.sim.bunkerWeg)})`);
    ok(G && G.mission.flags.methalle_gesprengt === true, 'Flag methalle_gesprengt gesetzt');
    const f = G && G.weltstand && G.weltstand.data.fakten;
    ok(f && (f.kapitel === 'k5_legat' || f.kapitel_nr >= 5), `Kapitel 5 erreicht (kapitel ${f && f.kapitel}, Nr ${f && f.kapitel_nr})`);
    ok(r.snapMax < CONFIG.net.snapMax, `Snapshot unter dem Budget (${r.snapMax} B)`);
    console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)} s Rechenzeit)`);
  }

  console.log('\n[CLI: kette --kapitel k4_methalle --crew 1 --bunker rohr, Tabelle mit Kennzeichnung]');
  const cli = (a) => spawnSync(process.execPath, [path.join(__dirname, 'sim-headless.js'), 'kette', '--ohne-telemetrie', ...a], { encoding: 'utf8', timeout: 240000 });
  const c = cli(['--kapitel', 'k4_methalle', '--crew', '1', '--bunker', 'rohr']);
  const zeile = (c.stdout || '').split('\n').find((l) => /^\| Einstieg k4_methalle/.test(l)) || '';
  ok(c.status === 0 && /SIM KETTE OK/.test(c.stdout), 'Exit 0, SIM KETTE OK');
  ok(/^\| .* \| 1 \| 1 \| ok \|/.test(zeile), 'Tabellenzeile ok: ' + zeile.slice(0, 60));
  ok(/K4 [\d.]+ skip×0/.test(zeile), 'Tabelle zeigt K4 ... skip×0');
  ok(/\| god im Bunker \(rohr, K4, [\d.]+ s\) \|$/.test(zeile.trim()), 'Tabelle weist god aus (Spalte god): ' + zeile.split('|').slice(-2, -1)[0]);
  ok(/Spalte|\| god \|/.test(c.stdout) && /Im Bunker-Schritt ist god an/.test(c.stdout), 'Kopf des Laufs nennt god');
  const bad = cli(['--kapitel', 'k4_methalle', '--bunker', 'luke']);
  ok(bad.status === 1, 'unbekannter Zugang (--bunker luke) endet mit Exit 1');

  console.log(`\n${fails ? 'VERFEHLT' : 'ok'}: ${n - fails}/${n}`);
  process.exit(fails ? 1 : 0);
})();
