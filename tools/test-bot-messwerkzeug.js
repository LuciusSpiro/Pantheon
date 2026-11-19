'use strict';
// BOT-01 B4b: Rauchtest des Messmodus --server-bots (Mensch-Ersatz + Server-Bots) in tools/spiel-landung.js und tools/sim-sund.js.
//   A  Aufruf: --server-bots nur mit --crew 1 und bekannten, nicht doppelten Rollen (sonst Exit 2, kein Lauf)
//   B  spiel-landung ruhig, Crew 1, Seed 7, --server-bots navigation,ops,technik: Exit 0, die Bots sitzen (Messdatei serverBots: Rollen, ein Agent je Bot, Befehlszeile), nur der Mensch-Ersatz war unten
//   C  sim-sund --kapitel k1_kantenstein --crew 1 --server-bots ...: Exit 0, Tabelle und Zeile "Server-Bots" nennen den Modus
//   D  das Repo ist unberuehrt
//   node tools/test-bot-messwerkzeug.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const gitStatus = () => (cp.spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' }).stdout || '');
const statusVorher = gitStatus();
const node = (a) => { const r = cp.spawnSync(process.execPath, a, { cwd: ROOT, encoding: 'utf8', timeout: 240000 }); return { code: r.status, text: (r.stdout || '') + (r.stderr || '') }; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-bot-messwerkzeug-'));
const ROLLEN = 'navigation,ops,technik';

section('A  Aufruf');
{
  const a = node(['tools/spiel-landung.js', '--besetzung', 'ruhig', '--crew', '3', '--server-bots', ROLLEN]);
  const b = node(['tools/spiel-landung.js', '--besetzung', 'ruhig', '--crew', '1', '--server-bots', 'navigation,gibtsnicht']);
  const c = node(['tools/spiel-landung.js', '--besetzung', 'ruhig', '--crew', '1', '--server-bots', 'ops,ops']);
  const d = node(['tools/sim-sund.js', '--kapitel', 'alle', '--crew', '3', '--server-bots', ROLLEN]);
  ok(a.code === 2 && /server-bots/.test(a.text), 'Landung: Crew 3 mit Server-Bots: Exit 2');
  ok(b.code === 2, 'Landung: unbekannte Rolle: Exit 2');
  ok(c.code === 2, 'Landung: doppelte Rolle: Exit 2');
  ok(d.code === 2 && /server-bots/.test(d.text), 'Sund: Crew 3 mit Server-Bots: Exit 2');
}

section('B  Landung ruhig, Crew 1, Seed 7, mit Server-Bots');
{
  const datei = path.join(tmp, 'l.json');
  const r = node(['tools/spiel-landung.js', '--besetzung', 'ruhig', '--crew', '1', '--seed', '7', '--server-bots', ROLLEN, '--json', datei]);
  let j = null; try { j = JSON.parse(fs.readFileSync(datei, 'utf8')); } catch (e) { /* kein Ergebnis */ }
  ok(r.code === 0 && !!j, 'Laeufer Exit 0' + (r.code === 0 ? '' : '\n' + r.text.split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 8).join('\n')));
  if (j) {
    ok(!!j.serverBots && j.serverBots.rollen.join() === ROLLEN, `Messdatei nennt die Rollen (${j.serverBots && j.serverBots.rollen})`);
    ok(j.serverBots.befehle.length === 3 && ['navigation', 'ops', 'technik'].every((x) => j.serverBots.befehle.some((l) => l.startsWith(x + ':'))), `ein Agent je Bot am Ende (${j.serverBots.befehle.length})`);
    ok(j.serverBots.stationen.some((s) => /\[navigation\]:helm/.test(s)), 'die Navigation sass am Steuer (Stationsverlauf)');
    ok(j.faden.ausgang === 'gelungen' && j.unten === 1 && j.boden.filter((e) => e.k === 'beamedDown').every((e) => e.n === 1), `Landung gelungen, nur der Mensch-Ersatz unten (unten ${j.unten})`);
  }
  ok(/server-bots navigation,ops,technik/.test(r.text), 'Kurzzeile nennt den Modus');
}

section('C  Sund-Einstieg k1_kantenstein, Crew 1, mit Server-Bots');
{
  const r = node(['tools/sim-sund.js', '--kapitel', 'k1_kantenstein', '--crew', '1', '--server-bots', ROLLEN, '--ohne-laden']);
  ok(r.code === 0 && /SIM SUND OK/.test(r.text), 'Exit 0, SIM SUND OK');
  ok(/Server-Bots \(navigation,ops,technik\): navigation \d+ Befehle.*ops .*technik /.test(r.text), 'Zeile Server-Bots mit allen drei Rollen');
  ok(/\| 1 \+ Server-Bots \| ok \|/.test(r.text), 'Tabelle: Crew "1 + Server-Bots", ok');
}

section('D  Repo unberuehrt');
ok(gitStatus() === statusVorher, 'nichts im Repo veraendert (git status wie vorher)');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`\n${n - fails}/${n} Pruefungen ok`);
if (fails) console.log('FEHLER: ' + fails);
process.exit(fails ? 1 : 0);
