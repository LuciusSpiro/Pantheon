'use strict';
// SUND-03 F: die Claude-CLI finden (llm.claudeFinden) und den ganzen Prozessbaum beenden (llm.baumBeenden), ohne Netz und ohne echte CLI. Ein Fake-Programm (Node-Skript über CLAUDE_CLI) startet einen
// Kindprozess; Abbruch (AbortSignal) und Timeout müssen Eltern UND Kind beenden. Windows-kompatibel (taskkill /T auf die eigene PID), unter POSIX die Prozessgruppe.
//   node tools/test-llm-cli.js   (npm run test:llm-cli)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const LLM = require('../server/mission/llm.js');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lebt = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const warte = async (f, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return true; await sleep(50); } return !!f(); };

(async () => {
  console.log('\nCLI finden: Reihenfolge');
  const P = (...a) => path.join(...a);
  const mit = (dateien, env, plat) => LLM.claudeFinden({ env, platform: plat || 'win32', node: 'NODE', exists: (p) => dateien.includes(p) });
  const pkg = P('A', 'npm', 'node_modules', '@anthropic-ai', 'claude-code');
  const envW = { APPDATA: 'A', USERPROFILE: 'U', PATH: ['X', 'Y'].join(';') };
  let r = mit([P('E', 'cli.cjs'), P(pkg, 'cli.js')], Object.assign({ CLAUDE_CLI: P('E', 'cli.cjs') }, envW));
  ok(r.quelle === 'CLAUDE_CLI' && r.cmd === 'NODE' && r.args[0] === P('E', 'cli.cjs'), 'CLAUDE_CLI zuerst; eine .cjs-Datei wird mit Node gestartet');
  r = mit([P('E', 'claude.exe')], Object.assign({ CLAUDE_CLI: P('E', 'claude.exe') }, envW));
  ok(r.quelle === 'CLAUDE_CLI' && r.cmd === P('E', 'claude.exe') && r.args.length === 0, 'CLAUDE_CLI als Programm: direkt gestartet, ohne Node');
  r = mit([P(pkg, 'cli.js'), P(pkg, 'bin', 'claude.exe')], envW);
  ok(r.quelle === 'npm cli.js' && r.cmd === 'NODE', 'ohne CLAUDE_CLI: cli.js im npm-Paket');
  r = mit([P(pkg, 'bin', 'claude.exe'), P('U', '.local', 'bin', 'claude.exe')], envW);
  ok(r.quelle === 'npm native' && r.cmd === P(pkg, 'bin', 'claude.exe') && r.args.length === 0, 'kein cli.js (neuer Build): der native Build im npm-Paket');
  r = mit([P('U', '.local', 'bin', 'claude.exe'), P('Y', 'claude.exe')], envW);
  ok(r.quelle === '.local/bin' && r.cmd === P('U', '.local', 'bin', 'claude.exe'), 'danach %USERPROFILE%\\.local\\bin');
  r = mit([P('Y', 'claude.exe'), P('Y', 'claude.cmd')], envW);
  ok(r.quelle === 'PATH' && r.cmd === P('Y', 'claude.exe'), 'danach PATH (claude.exe, nie ein .cmd: es gibt keine Shell)');
  r = mit([], Object.assign({ CLAUDE_CLI: P('E', 'weg.js') }, envW));
  ok(r.cmd === null && r.versucht[0] === P('E', 'weg.js') && r.versucht.length >= 5, 'nichts gefunden: cmd null und die Liste der versuchten Pfade');
  r = mit([P('E', 'weg.js'), P(pkg, 'cli.js')], Object.assign({ CLAUDE_CLI: P('E', 'fehlt.js') }, envW));
  ok(r.quelle === 'npm cli.js', 'ein falsch gesetztes CLAUDE_CLI blockiert die übrigen Orte nicht');
  r = mit([P('H', '.local', 'bin', 'claude'), P('Z', 'claude')], { HOME: 'H', PATH: 'Z' }, 'linux');
  ok(r.quelle === '.local/bin' && r.cmd === P('H', '.local', 'bin', 'claude'), 'POSIX: ~/.local/bin/claude (ohne .exe)');
  const echt = LLM.claudeFinden();
  console.log('  Info  auf diesem Rechner: ' + (echt.cmd ? echt.quelle + ' → ' + echt.pfad : 'nichts gefunden (' + echt.versucht.join(', ') + ')'));

  console.log('\nProzessbaum: Abbruch und Timeout beenden Eltern und Kind');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-llm-cli-'));
  const fake = path.join(dir, 'fake-claude.js');
  const sys = path.join(dir, 'sys.md'); fs.writeFileSync(sys, 'x');
  fs.writeFileSync(fake, [
    "const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');",
    "const dir = path.dirname(__filename); const modus = fs.existsSync(path.join(dir, 'modus')) ? fs.readFileSync(path.join(dir, 'modus'), 'utf8') : 'haengt';",
    "const kind = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });",
    "fs.writeFileSync(path.join(dir, 'pids.json'), JSON.stringify({ eltern: process.pid, kind: kind.pid }));",
    "process.stdin.resume();",
    "if (modus === 'antwort') { process.stdin.on('end', () => { console.log(JSON.stringify({ type: 'result', result: 'fertig', usage: { input_tokens: 5, output_tokens: 2 } })); kind.kill(); process.exit(0); }); }",
  ].join('\n'));
  const alt = process.env.CLAUDE_CLI; process.env.CLAUDE_CLI = fake;
  const pids = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'pids.json'), 'utf8')); } catch (e) { return null; } };
  const frisch = () => { try { fs.unlinkSync(path.join(dir, 'pids.json')); } catch (e) { /* weg */ } };
  const fehler = async (p) => { try { await p; return null; } catch (e) { return e; } };
  try {
    // 1. Antwort kommt normal an
    fs.writeFileSync(path.join(dir, 'modus'), 'antwort');
    const ok1 = await LLM.TRANSPORTS.cli.call('Frage', { system: sys, model: 'sonnet', timeoutMs: 20000 });
    ok(ok1.text === 'fertig' && ok1.usage.input === 5 && ok1.usage.output === 2, 'das Fake-Programm antwortet: Text und Tokens kommen an (CLAUDE_CLI als .js)');
    // 2. Abbruch per Signal
    fs.writeFileSync(path.join(dir, 'modus'), 'haengt'); frisch();
    const ctl = new AbortController();
    const p2 = fehler(LLM.TRANSPORTS.cli.call('Frage', { system: sys, model: 'sonnet', timeoutMs: 60000, signal: ctl.signal }));
    ok(await warte(() => pids(), 8000), 'Eltern und Kind laufen');
    const id2 = pids();
    ok(lebt(id2.eltern) && lebt(id2.kind), 'beide Prozesse leben vor dem Abbruch');
    ctl.abort();
    const e2 = await p2;
    ok(e2 && e2.code === 'ABORTED', 'Abbruch: Fehler ABORTED');
    ok(await warte(() => !lebt(id2.eltern) && !lebt(id2.kind), 6000), 'Abbruch beendet den ganzen Prozessbaum (Eltern ' + id2.eltern + ' und Kind ' + id2.kind + ')');
    // 3. schon abgebrochenes Signal
    frisch();
    const ctl3 = new AbortController(); ctl3.abort();
    const e3 = await fehler(LLM.TRANSPORTS.cli.call('Frage', { system: sys, model: 'sonnet', timeoutMs: 60000, signal: ctl3.signal }));
    ok(e3 && e3.code === 'ABORTED', 'ein schon abgebrochenes Signal: sofort ABORTED');
    await sleep(300);
    const id3 = pids();
    ok(!id3 || (await warte(() => !lebt(id3.eltern) && !lebt(id3.kind), 6000)), 'und kein Prozess bleibt zurück');
    // 4. Timeout
    frisch();
    const e4 = fehler(LLM.TRANSPORTS.cli.call('Frage', { system: sys, model: 'sonnet', timeoutMs: 2500 }));
    await warte(() => pids(), 8000);
    const id4 = pids();
    const er4 = await e4;
    ok(er4 && er4.code === 'ETIMEDOUT', 'Timeout: Fehler ETIMEDOUT');
    ok(id4 && await warte(() => !lebt(id4.eltern) && !lebt(id4.kind), 6000), 'Timeout beendet den ganzen Prozessbaum');
  } finally { if (alt === undefined) delete process.env.CLAUDE_CLI; else process.env.CLAUDE_CLI = alt; }
  // Quelltext-Naht: ohne Shell, Prozessbaum
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'mission', 'llm.js'), 'utf8');
  ok(!/shell:\s*true/.test(src) && /taskkill/.test(src) && /'\/T'/.test(src) && /'\/PID'/.test(src) && !/'\/IM'/.test(src), 'taskkill /T /F /PID auf die eigene PID, nie /IM, keine Shell');
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* egal */ }
  console.log(`\n${n - fails} von ${n} ok` + (fails ? `, ${fails} FEHLER` : ''));
  process.exit(fails ? 1 : 0);
})();
