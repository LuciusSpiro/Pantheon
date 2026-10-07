'use strict';
// QA-Hilfe: Balancing-Experimente ohne Dateiänderung. TUNE='{"pfad.zum.wert": 1.2, ...}' node -r ./tools/tune-preload.js tools/sim-headless.js arena …
const C = require('../shared/config.js');
const CFG = C.CONFIG || C;
const raw = process.env.TUNE;
if (raw) {
  const t = JSON.parse(raw);
  for (const [path, val] of Object.entries(t)) {
    const keys = path.split('.'); let o = CFG;
    for (let i = 0; i < keys.length - 1; i++) { if (o[keys[i]] == null) o[keys[i]] = {}; o = o[keys[i]]; }
    o[keys[keys.length - 1]] = val;
  }
  console.log('TUNE ' + raw);
}
