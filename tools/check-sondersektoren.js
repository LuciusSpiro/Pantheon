'use strict';
// SON-01 A: Prüfung der Sondersektoren (content/welt/sondersektoren.json, Regeln in server/sim/sondersektoren.js) gegen die Karte sund_frei. Teil von npm run check.
const S = require('../server/sim/sondersektoren.js');
const r = S.pruefe(S.alle());
for (const f of r.fehler) console.log('  FEHLER ' + f);
console.log(r.ok ? `  ok   ${S.ids().length} Sondersektor(en) geprüft: ${S.ids().join(', ')}` : `${r.fehler.length} Fehler.`);
process.exit(r.ok ? 0 : 1);
