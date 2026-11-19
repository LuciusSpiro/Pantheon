'use strict';
// BOT-01 B4b: Rauchtest des Messmodus --server-bots (Mensch-Ersatz + Server-Bots) in tools/spiel-landung.js und tools/sim-sund.js.
//   A  Aufruf: --server-bots nur mit --crew 1 und bekannten, nicht doppelten Rollen (sonst Exit 2, kein Lauf)
//   B  spiel-landung ruhig, Crew 1, Seed 7, --server-bots navigation,ops,technik: Exit 0, die Bots sitzen (Messdatei serverBots: Rollen, ein Agent je Bot, Befehlszeile), nur der Mensch-Ersatz war unten
//   C  sim-sund --kapitel k1_kantenstein --crew 1 --server-bots ...: Exit 0, Tabelle und Zeile "Server-Bots" nennen den Modus
//   E  BOT-01 B4c: arena --mensch captain,helm --bots ops,technik (zwei Mensch-Ersatz, zwei Server-Bots, 1 Seed, 1 Welle): Exit 0, beide Menschen sitzen, beide Bots an_station, kein Fehler
//   F  BOT-01 B4c Aufruf: unbekannte/doppelte Rolle, Ueberschneidung Mensch/Bot, --players dazu: Exit 2 mit Text, kein Lauf
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

section('E  Arena mit zwei Mensch-Ersatz und zwei Server-Bots');
{
  const r = node(['tools/sim-headless.js', 'arena', '--pilot', 'maneuver', '--mensch', 'captain,helm', '--bots', 'ops,technik', '--seed', '1', '--seeds', '1', '--waves', '1']);
  ok(r.code === 0 && /SIM ARENA OK/.test(r.text), 'Exit 0, SIM ARENA OK');
  ok(/4 Spieler \(Mensch-Ersatz captain,helm \+ Server-Bots ops, technik\)/.test(r.text), 'Kopfzeile nennt vier Koepfe und beide Gruppen');
  const m = r.text.match(/Stationsanteil: Mensch captain an eigener Konsole ([\d.]+) % · Mensch helm an eigener Konsole ([\d.]+) %/);
  ok(!!m && Number(m[1]) > 90 && Number(m[2]) > 90, 'beide Menschen sitzen an der eigenen Konsole (' + (m ? m[1] + ' / ' + m[2] + ' %' : 'keine Zeile') + ')');
  ok(/Bot ops: \d+ Befehle, abgewiesen \d+, Zustand an_station/.test(r.text) && /Bot technik: \d+ Befehle, abgewiesen \d+, Zustand an_station/.test(r.text), 'beide Bots am Ende an_station');
  ok(/Fehler 0 · /.test(r.text) && /Softlocks 0/.test(r.text), 'kein Serverfehler, kein Softlock');
}

section('F  Aufrufe, die Exit 2 geben');
{
  const arena = (a) => node(['tools/sim-headless.js', 'arena', '--pilot', 'maneuver', '--seeds', '1', '--waves', '1'].concat(a));
  const a = arena(['--mensch', 'captain,pilot', '--bots', 'ops']);
  const b = arena(['--mensch', 'captain,captain', '--bots', 'ops']);
  const c = arena(['--mensch', 'captain,helm', '--bots', 'navigation,technik']);
  const d = arena(['--mensch', 'captain', '--bots', 'ops,ops']);
  const e = arena(['--mensch', 'captain', '--bots', 'ops', '--players', '3']);
  ok(a.code === 2 && /unbekannte Mensch-Rolle "pilot"/.test(a.text), 'unbekannte Mensch-Rolle: Exit 2 mit Text');
  ok(b.code === 2 && /doppelte Mensch-Rolle/.test(b.text), 'doppelte Mensch-Rolle: Exit 2 mit Text');
  ok(c.code === 2 && /Mensch-Konsole helm wird von einem Server-Bot gehalten \(navigation\)/.test(c.text), 'Mensch-Konsole und Server-Bot ueberschneiden sich: Exit 2 mit Text');
  ok(d.code === 2 && /doppelte Bot-Rolle/.test(d.text), 'doppelte Bot-Rolle: Exit 2 mit Text');
  ok(e.code === 2 && /--players/.test(e.text), '--mensch mit --players: Exit 2');
}

section('D  Repo unberuehrt');
ok(gitStatus() === statusVorher, 'nichts im Repo veraendert (git status wie vorher)');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`\n${n - fails}/${n} Pruefungen ok`);
if (fails) console.log('FEHLER: ' + fails);
process.exit(fails ? 1 : 0);
