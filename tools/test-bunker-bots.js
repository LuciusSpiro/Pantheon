'use strict';
// BOD-03 C7: Bot-Lauf durch den Bunker als Gesamtnachweis (Kriterium 15 und 16). Headless, echtes Szenario (Lobby-Start arena_graben), keine Debug-Befehle der Bots.
// Mit --god (Treffer wirken nicht; die Quote ohne god ist kein Abnahmeziel: Welle 1 überleben die Bots nicht) spielt ein Bot-Team von Welle 1 bis zum Sieg:
// Welle 1 und 2 oben, Lift, im Bunker zum Reaktorraum (Welle 3 im Gefecht), Zünden (E halten), Flucht aus dem Radius (Friendly Fire r 2 Kacheln),
// Knall, Nachschub oben, zurück per Lift, Pad, Hochbeamen aller, Sieg, zurück in der Lobby. Gruppenlauf mit 2 und 4 Spielern, fester Seed.
// Längere Messläufe (mehr Seeds, ohne god): node tools/sim-headless.js graben --players 1,2,4 --seeds 4 [--god]
//   node tools/test-bunker-bots.js
const CONFIG = require('../shared/config.js');
const { runGraben } = require('./sim-headless.js');

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };
const FF = (CONFIG.anker.explosion.radius || 2) + 0.5;   // Kacheln, Mittelpunkt zu Mittelpunkt (Radius * Kachel + halbe Kachel)

(async () => {
  for (const np of [2, 4]) {
    console.log(`\n[Gruppenlauf ${np} Spieler, god, Seed 1]`);
    const t0 = Date.now();
    const r = await runGraben({ players: np, seed: 1, maxSec: 600, god: true });
    const m = r.marken || {};
    ok(r.sieg, `Sieg nach ${r.zeit} s (Ziel erreicht bei ${r.zielZeit} s)`);
    ok(r.versuche === 1 && r.neustarts.length === 0, `ohne Neubeginn (Versuche ${r.versuche})`);
    ok(r.errors === 0, 'keine Fehler (' + r.errors + ')');
    ok(r.lobby, 'nach dem Sieg zurück in der Lobby');
    ok(m.w1 != null && m.w2 >= m.w1 && m.lift >= m.w2 && m.scharf >= m.lift && m.knall > m.scharf && m.pad1 >= m.knall, `Abschnitte in Reihenfolge: ${['w1', 'w2', 'lift', 'scharf', 'knall', 'pad1'].map((k) => k + ' ' + m[k]).join(', ')}`);
    ok(m.knall - m.scharf >= CONFIG.anker.countdown - 1, `Countdown ${CONFIG.anker.countdown} s lief ab (${m.knall - m.scharf} s)`);
    ok(m.abstand > FF, `Crew beim Knall außerhalb des Friendly-Fire-Radius (${m.abstand} Kacheln, Grenze ${FF})`);
    ok(r.snapMax < CONFIG.net.snapMax, `Snapshot unter dem Budget (${r.snapMax} B)`);
    console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)} s Rechenzeit)`);
  }
  console.log(`\n${fails ? 'VERFEHLT' : 'ok'}: ${n - fails}/${n}`);
  process.exit(fails ? 1 : 0);
})();
