'use strict';
// BEA-03 B: Bot-Laeufe des Beats hinterhalt am echten Server (tools/spiel-hinterhalt.js: Rueckfall ohne Modell, Plan Hinterhalt > abschluss eingespeist, Captain waehlt, Navigation loest den Schnellsprung aus oder springt einzeln).
// Der Test startet den Laeufer je Fall EINZELN (nacheinander, nie parallel: jeder Lauf startet einen Server) und zaehlt aus der Messdatei (--json) selbst nach; das Urteil des Laeufers allein genuegt nie:
//   A  schnell gelungen, Crew 1: der Schnellsprung haelt im Hinterhalt-Sektor, Meldung und Gegner stehen im selben Takt (Anzahl aus szenen-werte.json), kein Zufalls-Abfangen, ein TESTHELFER besiegt
//      die Gegner (die Bots haben keine Bordkanone: kuenstlich, im Mitschnitt gezaehlt), Faden abgeschlossen und gelungen, Gedaechtnis hinterhalt_gelungen
//   B  schnell gescheitert (Flucht), Crew 3: vier Gegner, Szenenwechsel, Gedaechtnis hinterhalt_gescheitert, nichts bleibt stehen
//   C  einzel gescheitert (Frist), Crew 1: ein echter Einzelsprung in den Sektor loest dieselbe Szene aus, die Frist laeuft ab, Gedaechtnis hinterhalt_gescheitert
//   D  fremd, Crew 3: Schnellsprung ueber eine Route OHNE den Hinterhalt-Sektor: kein Halt, keine Szene, keine Gegner, der Beat wartet weiter
//   E  Aufruf: falsche Werte geben Exit 2
//   F  das Repo ist unberuehrt (git status wie vorher)
//   node tools/test-hinterhalt-bot.js [--behalte <ordner>] [--fall <name,...>]      Faelle: schnell-gelungen-1, schnell-flucht-3, einzel-frist-1, fremd-3     Mutationsprobe: tools/mutation-hinterhalt-bot.js
// Zeitbudget: rund 60 s (vier Server-Laeufe mit verkuerzter Ladezeit des Sprungantriebs --laden-s 2, kuenstlich im Mitschnitt gezaehlt; die echte Ladezeit (rund 10 s je Sprung) faehrt der Laeufer von Hand: node tools/spiel-hinterhalt.js).
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const args = process.argv.slice(2);
const wert = (n) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : undefined; };
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const SZD = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'faeden', 'szenen-werte.json'), 'utf8'));
const HW = SZD.werte.hinterhalt.wert;
const anzahl = (crew) => Number(HW.anzahl[String(crew)]);   // Soll aus den Daten, nie ein Literal
const tmp = wert('behalte') ? path.resolve(wert('behalte')) : fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-hinterhalt-bot-'));
fs.mkdirSync(tmp, { recursive: true });
const gitStatus = () => (cp.spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' }).stdout || '');
const statusVorher = gitStatus();
const lauf = (a) => new Promise((resolve) => {
  const t0 = Date.now();
  const p = cp.spawn(process.execPath, a, { cwd: ROOT, env: process.env });
  let o = ''; p.stdout.on('data', (d) => { o += d; }); p.stderr.on('data', (d) => { o += d; });
  const t = setTimeout(() => { try { p.kill(); } catch (e) { /* egal */ } }, 120000);
  p.on('exit', (code) => { clearTimeout(t); resolve({ code, text: o, s: Math.round((Date.now() - t0) / 100) / 10 }); });
});
const lesen = (datei) => { try { return JSON.parse(fs.readFileSync(datei, 'utf8')); } catch (e) { return null; } };
const fehlerZeilen = (r) => (r.code === 0 ? '' : '\n' + r.text.split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 8).join('\n'));
const FAELLE = [
  { name: 'schnell-gelungen-1', a: ['--modus', 'schnell', '--ausgang', 'gelungen', '--crew', '1'] },
  { name: 'schnell-flucht-3', a: ['--modus', 'schnell', '--ausgang', 'gescheitert', '--wie', 'flucht', '--crew', '3'] },
  { name: 'einzel-frist-1', a: ['--modus', 'einzel', '--ausgang', 'gescheitert', '--wie', 'frist', '--crew', '1'] },
  { name: 'fremd-3', a: ['--modus', 'fremd', '--crew', '3'] },
];
const NUR = wert('fall') ? wert('fall').split(',') : null;   // z. B. --fall fremd-3 (Probe, Mutationsprobe)
const gewollt = (name) => !NUR || NUR.includes(name);
const SEKUNDEN_MAX = 40;   // je Lauf: ein Lauf darf nie die Testgrenze reissen

(async () => {
  section('E  Aufruf: falsche Werte');
  {
    const r1 = await lauf(['tools/spiel-hinterhalt.js', '--modus', 'gibt_es_nicht']);
    const r2 = await lauf(['tools/spiel-hinterhalt.js', '--crew', '2']);
    const r3 = await lauf(['tools/spiel-hinterhalt.js', '--modus', 'fremd', '--ausgang', 'gelungen']);
    const r4 = await lauf(['tools/spiel-hinterhalt.js', '--wie', 'frist']);
    ok(r1.code === 2 && /Aufruf/.test(r1.text), 'unbekannter Modus: Exit 2');
    ok(r2.code === 2, 'Crew 2 (laut Steckbrief bei Bots instabil) wird nicht gefahren: Exit 2');
    ok(r3.code === 2, 'fremd kennt keinen Ausgang: Exit 2');
    ok(r4.code === 2, '--wie ohne --ausgang gescheitert: Exit 2');
  }
  ok(HW.vorlauf_s === 0 && Object.keys(HW.anzahl).sort().join() === '1,2,3' && anzahl(1) >= 1 && anzahl(3) >= anzahl(1), `Erwartung gegen szenen-werte.json gelesen (kein Vorlauf, Gegner je Crew: 1 ${anzahl(1)}, 3 ${anzahl(3)})`);

  for (const fl of FAELLE) {
    if (!gewollt(fl.name)) continue;
    const datei = path.join(tmp, fl.name + '.json');
    const modus = fl.a[1], crew = Number(fl.a[fl.a.indexOf('--crew') + 1]);
    const ausgang = fl.a.includes('--ausgang') ? fl.a[fl.a.indexOf('--ausgang') + 1] : null;
    const r = await lauf(['tools/spiel-hinterhalt.js', ...fl.a, ...(fl.echt ? [] : ['--laden-s', '2']), '--json', datei]);
    const j = lesen(datei);
    section(`${fl.name}: ${fl.a.join(' ')}${fl.echt ? ' (echte Ladezeit)' : ' (Ladezeit 2 s)'} (${r.s} s)`);
    ok(r.code === 0 && !!j, 'Laeufer Exit 0' + fehlerZeilen(r));
    if (!j) continue;
    const g = j.faden.gedaechtnis, v = j.faden.verlauf.join(' | '), oda = j.oda.join(' | ');
    ok(j.komponistenAufrufe === 0 && j.errors === 0, `Rueckfall ohne Modell: 0 Komponisten-Aufrufe (${j.komponistenAufrufe}), g.errors ${j.errors}`);
    ok(j.sekunden < SEKUNDEN_MAX, `Laufzeit ${j.sekunden} s unter ${SEKUNDEN_MAX} s`);
    ok(/^\d{4}$/.test(j.hex) && j.hex !== j.start, `der Sektor des Hinterhalts (${j.hex}) kommt vom Code, nicht der Startsektor (${j.start})`);
    if (modus === 'fremd') {
      ok(j.szene === null && !g.some((e) => /^hinterhalt_/.test(e)), `keine Szene, kein Hinterhalt im Gedaechtnis (${g.join(', ') || '-'})`);
      ok(!/Schnellsprung angehalten/.test(oda) && /Schnellsprung abgeschlossen/.test(oda), 'kein Halt: der Schnellsprung kommt am Ziel an');
      ok(!j.funk.some((t) => /Hinterhalt im Sektor/.test(t)) && j.faden.phase === 'laeuft', `kein Funk, der Faden laeuft weiter, der Beat wartet (Phase ${j.faden.phase})`);
      ok(!j.kuenstlich['testhelfer-kill'], 'kein Testhelfer im Spiel');
      continue;
    }
    ok(!!j.szene && j.szene.art === 'hinterhalt' && j.szene.phase === 'kampf' && j.szene.sek === 0, `die Szene steht sofort im Kampf, ohne Vorlauf (${j.szene && j.szene.phase}, ${j.szene && j.szene.sek} s)`);
    ok(j.gegnerImTakt === anzahl(crew), `Meldung und Gegner im selben Takt: ${j.gegnerImTakt} Gegner am Ende des Ticks der Funkmeldung (Soll ${anzahl(crew)})`);
    ok(j.soll === anzahl(crew) && j.szene && j.szene.n === anzahl(crew), `Gegner: ${j.szene && j.szene.n} (Soll ${anzahl(crew)} fuer Crew ${crew}, aus den Daten)`);
    ok(j.funk.some((t) => /Hinterhalt im Sektor/.test(t) && t.includes(String(anzahl(crew)))), 'die Funkmeldung nennt den Hinterhalt und die Zahl');
    if (modus === 'schnell') ok(/Schnellsprung angehalten: Hinterhalt im Sektor/.test(oda) && !/Abgefangen/.test(oda), 'Schnellsprung angehalten (Bordanzeige), kein Zufalls-Abfangen');
    else ok(!/Schnellsprung angehalten/.test(oda) && !/Abgefangen/.test(oda) && (j.kuenstlich.teleport || 0) >= 1, 'Einzelsprung: kein Schnellsprung-Halt, kein Zufalls-Abfangen (der Vorsektor wurde per Teleport erreicht)');
    ok(j.faden.phase === 'abgeschlossen' && /endet b1_hinterhalt/.test(v) && /beginnt b2_abschluss/.test(v), `Faden abgeschlossen, Beats hinterhalt > abschluss (${j.faden.phase})`);
    if (ausgang === 'gelungen') {
      ok(j.faden.ausgang === 'gelungen' && g.includes('hinterhalt_gelungen') && !g.includes('hinterhalt_gescheitert') && /b1_hinterhalt gelungen/.test(v), `gelungen: Faden gelungen, Gedaechtnis hinterhalt_gelungen (${g.join(', ')})`);
      ok(j.kuenstlich['testhelfer-kill'] === 1, 'die Gegner besiegte der TESTHELFER (die Bots haben keine Bordkanone), im Mitschnitt ausgewiesen');
    } else {
      ok(g.filter((e) => e === 'hinterhalt_gescheitert').length === 1 && !g.includes('hinterhalt_gelungen') && /b1_hinterhalt gescheitert/.test(v), `gescheitert: Gedaechtnis hinterhalt_gescheitert, einmal (${g.join(', ')})`);
      ok(!j.kuenstlich['testhelfer-kill'], 'kein Testhelfer: niemand hat die Gegner besiegt');
      if (fl.a.includes('flucht')) ok(j.funk.includes(SZD.texte.szenenwechsel), 'Flucht: der Funk meldet den Szenenwechsel');
    }
    ok(j.kuenstlich['laden-kurz'] === (fl.echt ? undefined : 1), fl.echt ? 'echte Ladezeit des Sprungantriebs (nichts verkuerzt)' : 'Ladezeit des Antriebs verkuerzt (kuenstlich, im Mitschnitt gezaehlt)');
  }

  section('F  Repo unberuehrt');
  ok(gitStatus() === statusVorher, 'nichts im Repo veraendert (git status wie vorher)');
  if (!wert('behalte') && !fails) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* egal */ } } else console.log('\nAblage: ' + tmp);
  console.log(`\n${n - fails}/${n} Pruefungen ok`);
  if (fails) console.log('FEHLER: ' + fails);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FEHLER Ausnahme: ' + (e && e.stack)); process.exit(1); });
