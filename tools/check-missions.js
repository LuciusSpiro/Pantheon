'use strict';
// Prüfer für Regiebücher – Kommandozeile (CONTRACT-S1 §3.3). Die Prüflogik liegt in server/mission/checker.js
// (der Server ruft sie beim Start und in startMission auf); Prüfgrundlage für Bausteine ist server/mission/registry.js.
// Aufruf: node tools/check-missions.js [dateien…] [--selftest] [--quiet] [--bausteine]
//   ohne Dateien: alle content/regiebuecher/*.json · --selftest: kaputte Bücher aus der Abnahme (aus m3 erzeugt)
//   --bausteine: Registry.describe() als JSON ausgeben (Stand für content/regiebuch/bausteine.json)
// Exit 1 bei Fehlern.
const fs = require('fs');
const path = require('path');
const Checker = require('../server/mission/checker.js');
const Loader = require('../server/mission/loader.js');

const ROOT = path.join(__dirname, '..');

function report(file, r, quiet) {
  const name = path.relative(ROOT, file);
  console.log(`${r.errors.length ? '✗' : '✓'} ${name}: ${r.errors.length} Fehler, ${r.warnings.length} Warnungen`);
  for (const e of r.errors) console.log(`  FEHLER  ${e.code.padEnd(26)} ${e.p}\n          ${e.msg}`);
  if (!quiet) for (const w of r.warnings) console.log(`  warnung ${w.code.padEnd(26)} ${w.p}\n          ${w.msg}`);
}

function selftest() {
  console.log('Selbsttest: m3 muss fehlerfrei sein, jede Mutation muss den erwarteten Fehler liefern.\n');
  const r = Checker.selftest();
  for (const l of r.lines) console.log(l);
  return r.ok;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) process.exit(selftest() ? 0 : 1);
  if (args.includes('--bausteine')) { console.log(JSON.stringify(require('../server/mission/registry.js').describe(), null, 2)); process.exit(0); }
  const quiet = args.includes('--quiet');
  let files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) {
    const d = Loader.BOOK_DIR;
    files = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(d, f)) : [];
  }
  let bad = 0;
  for (const f of files) {
    let doc;
    try { doc = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.log(`✗ ${f}: kein gültiges JSON (${e.message})`); bad++; continue; }
    const r = Checker.check(doc); report(f, r, quiet);
    if (r.errors.length) bad++;
  }
  process.exit(bad ? 1 : 0);
}

module.exports = { check: Checker.check, validate: Checker.validate, selftest: Checker.selftest };
