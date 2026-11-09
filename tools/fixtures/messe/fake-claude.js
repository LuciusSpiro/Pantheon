'use strict';
// Fake der Claude-CLI fuer tools/test-messe-ablage.js (offline, kein Netz, kein Abo): CLAUDE_CLI=<diese Datei> (wird mit Node gestartet).
// Liest den Prompt von stdin und antwortet im stream-json-Format der CLI mit dem Mock-Plan der passenden Art (Systemprompt-Datei: abenteuer | lage).
// FAKE_FAIL_ERSTER=abenteuer|lage: der erste Aufruf dieser Art endet mit Exit 1 (Zaehler in FAKE_ZAEHLER_DIR), um die Zuordnung bei Fehlaufrufen zu pruefen.
// LIV-01 D (tools/test-live-abend.js): FAKE_PLAN_MIT=typ[,typ...]  die Abenteuer-Plaene sind gueltig, kurz (Beat und Abschluss) und beginnen der Reihe nach mit diesen Typen (Zaehler in FAKE_ZAEHLER_DIR);
//   FAKE_INPUT_TOKENS=<n>  input_tokens je Aufruf (statt 1000), damit ein kleines CLAUDE_TOKEN_BUDGET schnell die Schwelle erreicht.
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..', '..', '..');
const argv = process.argv.slice(2);
const sf = argv[argv.indexOf('--system-prompt-file') + 1] || '';
let prompt = '';
process.stdin.on('data', (d) => { prompt += d; });
process.stdin.on('end', () => {
  const kind = /abenteuer/.test(sf) ? 'abenteuer' : /lage/.test(sf) ? 'lage' : 'x';
  if (process.env.FAKE_FAIL_ERSTER === kind && process.env.FAKE_ZAEHLER_DIR) {
    const z = path.join(process.env.FAKE_ZAEHLER_DIR, 'fake-' + kind + '.zaehler');
    if (!fs.existsSync(z)) { fs.writeFileSync(z, '1'); process.stderr.write('fake: absichtlicher Fehler\n'); process.exit(1); }
  }
  let text = '{}';
  if (kind === 'abenteuer') text = require(path.join(REPO, 'server/sim/abenteuer-mock.js')).planText({ prompt });
  if (kind === 'abenteuer' && process.env.FAKE_PLAN_MIT && process.env.FAKE_ZAEHLER_DIR) {
    const AM = require(path.join(REPO, 'server/sim/abenteuer-mock.js'));
    const z = path.join(process.env.FAKE_ZAEHLER_DIR, 'fake-plan-mit.zaehler');
    const n = fs.existsSync(z) ? Number(fs.readFileSync(z, 'utf8')) || 0 : 0;
    fs.writeFileSync(z, String(n + 1));
    const typen = process.env.FAKE_PLAN_MIT.split(',');
    const typ = typen[n % typen.length];
    const p = AM.gueltigerPlan(AM.rngVon('live-' + typ + '-' + n), { mit: typ, min: 2 });
    p.beats = [{ typ }, { typ: p.beats[p.beats.length - 1].typ }];
    text = JSON.stringify(p);
  }
  if (kind === 'lage') text = require(path.join(REPO, 'server/sim/lage-mock.js')).planText({ prompt });
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  out({ type: 'system', model: 'claude-fake-1' });
  setTimeout(() => {
    out({ type: 'result', result: text, total_cost_usd: 0.0123, usage: { input_tokens: Number(process.env.FAKE_INPUT_TOKENS) || 1000, cache_read_input_tokens: 500, output_tokens: 300 } });
    process.exit(0);
  }, 100);
});
