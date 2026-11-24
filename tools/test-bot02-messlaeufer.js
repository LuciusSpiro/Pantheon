'use strict';
// BOT-02 B6: Rauchtest des Messmodus --bord (tools/lib/bord-messung.js, tools/spiel-landung.js, tools/spiel-wrack.js) OHNE einen ganzen Lauf zu fahren (die Laeufe selbst: node tools/spiel-landung.js ... --bord).
//   A  Aufrufkombination: reine Funktion pruefArgs und die echten Aufrufe der Laeufer (Exit 2 mit Text, kein Lauf)
//   B  Pruefungen auf Messdaten: ein gueltiger Lauf ist gruen; je ein Fehler in den Daten macht genau die zustaendige Pruefung rot (Schiff stand still, Mensch scannte, Beam bei Fahrt, Bord-Bot zu spaet, Mensch an Ops/Steuer, Notrueckholung)
//   C  Zusatzmessung: Ansagen je Art, ODA-Meldungen und Codehilfe, Rueckholung
//   D  das Repo ist unberuehrt
//   node tools/test-bot02-messlaeufer.js
const cp = require('child_process');
const path = require('path');
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const Bord = require('./lib/bord-messung.js');
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const gitStatus = () => (cp.spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' }).stdout || '');
const statusVorher = gitStatus();
const node = (a) => { const r = cp.spawnSync(process.execPath, a, { cwd: ROOT, encoding: 'utf8', timeout: 60000 }); return { code: r.status, text: (r.stdout || '') + (r.stderr || '') }; };
const ALLE = ['navigation', 'ops', 'technik'];

section('A  Aufruf');
{
  ok(Bord.pruefArgs({ bord: false, crew: 3, serverBots: null, fristLauf: false }) === null, 'ohne --bord keine Einschraenkung (Crew 3 ohne Server-Bots)');
  ok(Bord.pruefArgs({ bord: true, crew: 1, serverBots: ALLE, fristLauf: false }) === null, '--bord mit Crew 1 und allen drei Server-Bots ist erlaubt');
  ok(/crew 1/.test(Bord.pruefArgs({ bord: true, crew: 3, serverBots: ALLE, fristLauf: false })), '--bord mit Crew 3 abgelehnt');
  ok(/server-bots/.test(Bord.pruefArgs({ bord: true, crew: 1, serverBots: null, fristLauf: false })), '--bord ohne Server-Bots abgelehnt');
  ok(/server-bots/.test(Bord.pruefArgs({ bord: true, crew: 1, serverBots: ['navigation', 'ops'], fristLauf: false })), '--bord ohne Technik-Bot abgelehnt');
  ok(/frist-lauf/.test(Bord.pruefArgs({ bord: true, crew: 1, serverBots: ALLE, fristLauf: true })), '--bord mit --frist-lauf abgelehnt');
  const a = node(['tools/spiel-landung.js', '--besetzung', 'ruhig', '--crew', '1', '--bord']);
  const b = node(['tools/spiel-landung.js', '--besetzung', 'ruhig', '--crew', '1', '--server-bots', 'navigation,ops', '--bord']);
  const c = node(['tools/spiel-wrack.js', '--besetzung', 'ruhig', '--crew', '1', '--bord']);
  const d = node(['tools/spiel-wrack.js', '--besetzung', 'ruhig', '--crew', '3', '--server-bots', ALLE.join(','), '--bord']);
  const e = node(['tools/spiel-wrack.js', '--besetzung', 'ruhig', '--crew', '1', '--server-bots', 'ops,ops']);
  ok(a.code === 2 && /--bord/.test(a.text), 'Landung: --bord ohne Server-Bots: Exit 2 mit Text');
  ok(b.code === 2 && /Technik/.test(b.text), 'Landung: --bord ohne Technik-Bot: Exit 2 mit Text');
  ok(c.code === 2 && /--bord/.test(c.text), 'Wrack: --bord ohne Server-Bots: Exit 2 mit Text');
  ok(d.code === 2, 'Wrack: Crew 3 mit Server-Bots: Exit 2');
  ok(e.code === 2 && /server-bots/.test(e.text), 'Wrack: doppelte Rolle: Exit 2');
}

section('B  Pruefungen auf Messdaten');
const gut = () => ({
  beamMax: 30, startSpeed: 65, maxSpeed: 64, stufe: 3,
  tWahl: 3800, tScan: 9000, tStopp: 6300, tBeam: 11400, tBordTransfer: 9400,
  speedBeam: 0, gescanntBeam: true, bordAmTransferBeam: true, bordRolle: 'technik',
  menschBefehleOpsSteuer: 0, menschBefehleOpsSteuerArten: [], menschStationen: [],
  abweisungen: 0, ansagen: [], oda: [], notrueckholungen: 0, rueckholAbklingzeit: false, lpId: 'x',
});
const rot = (d) => Bord.auswerten(d).filter((x) => !x.ok).map((x) => x.text.split(' ').slice(0, 3).join(' '));
{
  const p0 = Bord.auswerten(gut());
  ok(p0.length === 7 && p0.every((x) => x.ok), `gueltiger Lauf: ${p0.length} Pruefungen, alle gruen`);
  const f = (mut, erwartet, name) => { const d = gut(); mut(d); const r = Bord.auswerten(d); const roten = r.map((x, i) => (x.ok ? null : i)).filter((i) => i !== null); ok(roten.length >= 1 && roten.includes(erwartet) && roten.length <= 2, `${name}: Pruefung ${erwartet + 1} rot (rote: ${roten.map((i) => i + 1).join(',') || '-'})`); };
  f((d) => { d.startSpeed = 0; d.maxSpeed = 0; }, 0, 'Schiff fuhr nie (kuenstlich still)');
  f((d) => { d.tScan = null; }, 1, 'nie gescannt');
  f((d) => { d.menschBefehleOpsSteuerArten = ['weapons.landescan']; d.menschBefehleOpsSteuer = 1; }, 1, 'Mensch scannte selbst');
  f((d) => { d.gescanntBeam = false; }, 2, 'beim Beam nicht gescannt');
  f((d) => { d.tScan = 12000; }, 2, 'Scan erst nach dem Beam');
  f((d) => { d.speedBeam = 52; }, 3, 'Beam bei Fahrt (Tempo 52)');
  f((d) => { d.tStopp = null; }, 3, 'Navigations-Bot hat nie gestoppt');
  f((d) => { d.tBordTransfer = 20000; d.bordAmTransferBeam = false; }, 4, 'Bord-Bot viel zu spaet am Transfer');
  f((d) => { d.tBordTransfer = null; d.bordAmTransferBeam = false; }, 4, 'Bord-Bot nie am Transfer');
  { const d = gut(); d.tBordTransfer = 13000; d.bordAmTransferBeam = false; ok(Bord.auswerten(d)[4].ok, 'Bord-Bot 1,6 s nach dem Beam am Transfer: "kurz danach" gilt'); }
  f((d) => { d.menschBefehleOpsSteuer = 2; d.menschBefehleOpsSteuerArten = ['helm.stop', 'weapons.widescan']; }, 5, 'Mensch bediente die Steuer');
  f((d) => { d.notrueckholungen = 1; }, 6, 'Notrueckholung');
  f((d) => { d.rueckholAbklingzeit = true; }, 6, 'Rueckholung ueber die Abklingzeit gesehen');
}

section('C  Zusatzmessung');
{
  const d = gut();
  d.ansagen = [{ art: 'gegner', t: 1 }, { art: 'gegner', t: 2 }, { art: 'code', t: 3 }];
  d.oda = [{ text: 'Transfer: ...', codehilfe: false, t: 1 }, { text: 'Niemand an Bord? Ich funke euch die Codetabelle', codehilfe: true, t: 2 }];
  const z = Bord.zusatz(d);
  ok(z.ansagen === 3 && z.ansagenArten.gegner === 2 && z.ansagenArten.code === 1, `Ansagen 3, nach Art gegner 2, code 1 (${JSON.stringify(z.ansagenArten)})`);
  ok(z.odaFunk === 2 && z.odaCodehilfe === 1 && z.rueckholung === false, 'ODA: 2 Meldungen, davon 1 Codehilfe; keine Rueckholung');
  d.notrueckholungen = 1;
  ok(Bord.zusatz(d).rueckholung === true, 'Rueckholung wird gemeldet');
  const z0 = Bord.zusatz(gut());
  ok(z0.ansagen === 0 && z0.odaFunk === 0 && z0.odaCodehilfe === 0, 'leerer Lauf: alles 0');
}

section('D  Repo unberuehrt');
ok(gitStatus() === statusVorher, 'nichts im Repo veraendert (git status wie vorher)');
console.log(`\n${n - fails}/${n} Pruefungen ok`);
if (fails) console.log('FEHLER: ' + fails);
process.exit(fails ? 1 : 0);
