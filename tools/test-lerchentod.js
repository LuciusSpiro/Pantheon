'use strict';
// HYG-02 C: Erkennung „Lerche zerstört“ im Bot-Lauf (tools/lib/lerchentod.js) mit synthetischen game-/Snapshot-Objekten, ohne Botlauf.
// node tools/test-lerchentod.js   (npm run test:lerchentod)
const fs = require('fs');
const path = require('path');
const { lerchenTod, lerchenTodGrund } = require('./lib/lerchentod.js');

let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

ok(lerchenTod({ zerstoertOffen: { ok: new Set() } }, null) === true, 'Server-Latch zerstoertOffen (auch ohne Snapshot) = zerstört');
ok(lerchenTod({ zerstoertOffen: null }, { ship: { reaktorTod: { tot: 1 } } }) === true, 'Snapshot ship.reaktorTod.tot = zerstört');
ok(lerchenTod({ zerstoertOffen: null }, { ship: { reaktorTod: { rest: 120, n: 1, dauer: 20, next: 10 } } }) === false, 'laufender Countdown ohne tot = noch nicht zerstört');
ok(lerchenTod({ zerstoertOffen: null }, { ship: {} }) === false, 'Ruhezustand (kein reaktorTod) = nicht zerstört');
ok(lerchenTod({}, undefined) === false, 'leeres game und kein Snapshot = nicht zerstört');
const g = lerchenTodGrund(404.26);
ok(g === 'Lerche zerstört (Reaktor-Countdown) bei t=404.3 s', 'Grundtext mit Spielzeit: ' + g);
ok(!/softlock/i.test(g), 'Grundtext enthält nicht das Wort SOFTLOCK');

// Verdrahtung: Kettenmodus bricht bei Tod ab, Quote führt den Tod als hart
const src = fs.readFileSync(path.join(__dirname, 'sim-headless.js'), 'utf8');
ok(/opts\.mode === 'kette' && LerchenTod\.lerchenTod\(game, S\)/.test(src), 'sim-headless: Abbruch bei Lerchentod nur im Kettenmodus');
ok(/res\.aborted = LerchenTod\.lerchenTodGrund\(game\.time\)/.test(src), 'sim-headless: Abbruchgrund gesetzt (Lauf FEHL, Exit != 0)');

console.log(fails ? `\n${fails} FEHLER` : '\nalle ok');
process.exit(fails ? 1 : 0);
