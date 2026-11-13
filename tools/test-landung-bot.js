'use strict';
// FAB-01 C: Bot-Laeufe des Beats landung am echten Server (tools/spiel-landung.js: Rueckfall ohne Modell, Plan Geruecht > landung > abschluss eingespeist, Bots scannen, waehlen den Landepunkt, beamen runter und hoch).
// Der Test startet den Laeufer je Fall EINZELN (nacheinander, nie parallel: jeder Lauf startet einen Server) und zaehlt aus der Messdatei (--json) selbst nach; das Urteil des Laeufers allein genuegt nie:
//   A  Besetzung ruhig, raeuber, belagerer mit Crew 1 und Crew 3 (mehrere Seeds): Faden abgeschlossen und gelungen, Gedaechtnis landung_gelungen, Beats in der Reihenfolge Geruecht > landung > ende, mindestens ein Bot unten
//      (Crew 3: zwei), beamedDown und beamedUp am Ort ohne Notrueckholung, Gegner am Ort nach der Tabelle boden-werte.json (ruhig 0, raeuber mindestens 1, belagerer mindestens 2), Ort restlos weg
//      (Orte 0 vorher, mindestens einer im Lauf, 0 nachher; keine Reste in lpScan und aways, away.map nicht der Ort), 0 Komponisten-Aufrufe, g.errors 0
//   B  Frist-Lauf (die Crew bleibt oben): Beat landung gescheitert (Gedaechtnis), nie unten, Verzweigung ins Ende, Faden abgeschlossen, Ort weg, kein Zombie-Faden, 0 Komponisten-Aufrufe, g.errors 0
//   C  Aufruf: falsche Werte geben Exit 2
//   D  das Repo ist unberuehrt (git status wie vorher)
//   node tools/test-landung-bot.js [--behalte <ordner>]      Mutationsprobe: tools/mutation-landung-bot.js
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
const BW = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'faeden', 'boden-werte.json'), 'utf8')).werte.besetzung.wert;
const MIN_GEGNER = { ruhig: 0, raeuber: 1, belagerer: 2 };   // aus der Abnahme (Tabelle boden-werte.json: ruhig leer, raeuber Raubzug klein, belagerer Raubzug mittel)
const tmp = wert('behalte') ? path.resolve(wert('behalte')) : fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-landung-bot-'));
fs.mkdirSync(tmp, { recursive: true });
const gitStatus = () => (cp.spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' }).stdout || '');
const statusVorher = gitStatus();
const lauf = (a) => new Promise((resolve) => {
  const t0 = Date.now();
  const p = cp.spawn(process.execPath, a, { cwd: ROOT, env: process.env });
  let o = ''; p.stdout.on('data', (d) => { o += d; }); p.stderr.on('data', (d) => { o += d; });
  const t = setTimeout(() => { try { p.kill(); } catch (e) { /* egal */ } }, 240000);
  p.on('exit', (code) => { clearTimeout(t); resolve({ code, text: o, s: Math.round((Date.now() - t0) / 100) / 10 }); });
});
const FAELLE = [
  { bes: 'ruhig', crew: 1, seed: 7 }, { bes: 'raeuber', crew: 1, seed: 9 }, { bes: 'belagerer', crew: 1, seed: 3 },
  { bes: 'ruhig', crew: 3, seed: 11 }, { bes: 'raeuber', crew: 3, seed: 5 }, { bes: 'belagerer', crew: 3, seed: 7 },
];
const NUR = wert('fall') ? wert('fall').split(',') : null;   // z. B. --fall belagerer-3 (Probe, Mutationsprobe)
const gewollt = (name) => !NUR || NUR.includes(name);

(async () => {
  section('C  Aufruf: falsche Werte');
  {
    const r1 = await lauf(['tools/spiel-landung.js', '--besetzung', 'gibt_es_nicht']);
    const r2 = await lauf(['tools/spiel-landung.js', '--besetzung', 'ruhig', '--crew', '2']);
    ok(r1.code === 2 && /Aufruf/.test(r1.text), 'unbekannte Besetzung: Exit 2');
    ok(r2.code === 2, 'Crew 2 (laut Steckbrief bei Bots instabil) wird nicht gefahren: Exit 2');
  }
  ok(Object.keys(BW).sort().join() === Object.keys(MIN_GEGNER).sort().join() && Object.keys(BW.ruhig).length === 0 && BW.raeuber.fraktion === 'raubzug' && BW.belagerer.fraktion === 'raubzug', 'Erwartung gegen die Tabelle boden-werte.json gelesen (ruhig leer, raeuber und belagerer Raubzug)');

  const erg = {};
  for (const fl of FAELLE) {
    const name = `${fl.bes}-${fl.crew}`;
    if (!gewollt(name)) continue;
    const datei = path.join(tmp, name + '.json');
    const r = await lauf(['tools/spiel-landung.js', '--besetzung', fl.bes, '--crew', String(fl.crew), '--seed', String(fl.seed), '--json', datei]);
    let j = null; try { j = JSON.parse(fs.readFileSync(datei, 'utf8')); } catch (e) { /* kein Ergebnis */ }
    erg[name] = { r, j };
    section(`A  ${fl.bes}, Crew ${fl.crew}, Seed ${fl.seed} (${r.s} s)`);
    ok(r.code === 0 && !!j, 'Laeufer Exit 0' + (r.code === 0 ? '' : '\n' + r.text.split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 8).join('\n')));
    if (!j) continue;
    const g = j.faden.gedaechtnis;
    ok(j.faden.phase === 'abgeschlossen' && j.faden.ausgang === 'gelungen', `Faden abgeschlossen, Ausgang gelungen (${j.faden.phase}, ${j.faden.ausgang})`);
    ok(g.includes('landung_gelungen') && !g.includes('landung_gescheitert') && g.includes('geruecht_gelungen'), `Gedaechtnis: Geruecht und landung gelungen (${g.join(', ')})`);
    const v = j.faden.verlauf.map((x) => x.replace(/ \(.*$/, ''));
    ok(JSON.stringify(v) === JSON.stringify(['beginnt b1_geruecht', 'endet b1_geruecht', 'beginnt b2_landung', 'endet b2_landung', 'beginnt ende']), `Beats in der Reihenfolge Geruecht, landung, ende (${v.join(' > ')})`);
    ok(/b2_landung gelungen/.test(j.faden.verlauf.join(' ')), 'Beat landung endet gelungen');
    const downs = j.boden.filter((e) => e.k === 'beamedDown'), ups = j.boden.filter((e) => e.k === 'beamedUp');
    const sollUnten = fl.crew === 1 ? 1 : 2;
    ok(j.unten === sollUnten && downs.reduce((s, e) => s + e.n, 0) === sollUnten && downs.length >= 1, `unten waren ${j.unten} von ${fl.crew} Bots (beamedDown mit ${downs.reduce((s, e) => s + e.n, 0)} Spielern)`);
    ok(ups.length >= 1 && ups.reduce((s, e) => s + e.n, 0) === sollUnten && !ups.some((e) => e.notrueckholung), `beamedUp am Ort ohne Notrueckholung (${ups.length}x, ${ups.reduce((s, e) => s + e.n, 0)} Spieler)`);
    ok(fl.bes === 'ruhig' ? j.gegner === 0 : j.gegner >= MIN_GEGNER[fl.bes], `Gegner am Ort: ${j.gegner} (Soll ${fl.bes === 'ruhig' ? '0' : 'mindestens ' + MIN_GEGNER[fl.bes]}), Arten ${j.gegnerArten || '-'}`);
    ok(j.orte.vor === 0 && j.orte.lauf >= 1 && j.orte.nach === 0 && j.orte.nachDetail.dyn.length === 0 && j.orte.nachDetail.scan.length === 0 && j.orte.nachDetail.aways.length === 0 && j.orte.nachDetail.awayMap === null, `Ort restlos weg: Orte ${j.orte.vor} vorher, ${j.orte.lauf} im Lauf, ${j.orte.nach} nachher (lpScan, aways, away.map leer)`);
    ok(j.komponistenAufrufe === 0 && j.errors === 0, `0 Komponisten-Aufrufe (${j.komponistenAufrufe}), g.errors ${j.errors}`);
  }
  // Besetzung ist Datensache: die Gegnerzahl waechst von ruhig ueber raeuber zu belagerer (gleiche Crew)
  for (const c of [1, 3]) {
    const a = erg['ruhig-' + c], b = erg['raeuber-' + c], d = erg['belagerer-' + c];
    if (a && a.j && b && b.j && d && d.j) ok(a.j.gegner < b.j.gegner && b.j.gegner <= d.j.gegner,`Crew ${c}: Gegner ruhig ${a.j.gegner} < raeuber ${b.j.gegner} <= belagerer ${d.j.gegner}`);
  }

  if (gewollt('frist')) {
    section('B  Frist-Lauf: die Crew bleibt oben (belagerer, Crew 1)');
    const datei = path.join(tmp, 'frist.json');
    const r = await lauf(['tools/spiel-landung.js', '--besetzung', 'belagerer', '--crew', '1', '--seed', '7', '--frist-lauf', '--json', datei]);
    let j = null; try { j = JSON.parse(fs.readFileSync(datei, 'utf8')); } catch (e) { /* kein Ergebnis */ }
    ok(r.code === 0 && !!j, `Laeufer Exit 0 (${r.s} s)` + (r.code === 0 ? '' : '\n' + r.text.split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 8).join('\n')));
    if (j) {
      const g = j.faden.gedaechtnis;
      ok(g.includes('landung_gescheitert') && !g.includes('landung_gelungen'), `Beat landung gescheitert (Frist): ${g.join(', ')}`);
      ok(/b2_landung gescheitert/.test(j.faden.verlauf.join(' ')) && /weiter ende/.test(j.faden.verlauf.join(' ')), 'Verzweigung: gescheitert fuehrt in den Beat ende');
      ok(j.boden.length === 0 && j.unten === 0, 'die Crew war nie unten');
      ok(j.gegner >= 2, `der Ort war besetzt, der Beat scheiterte trotzdem sauber (${j.gegner} Gegner)`);
      ok(j.faden.phase === 'abgeschlossen', `Faden abgeschlossen, kein Zombie-Faden (${j.faden.phase})`);
      ok(j.orte.vor === 0 && j.orte.lauf >= 1 && j.orte.nach === 0 && j.orte.nachDetail.awayMap === null, `Ort restlos weg (Orte ${j.orte.vor} > ${j.orte.lauf} > ${j.orte.nach})`);
      ok(j.komponistenAufrufe === 0 && j.errors === 0, `0 Komponisten-Aufrufe, g.errors ${j.errors}`);
    }
  }

  section('D  Repo unberuehrt');
  ok(gitStatus() === statusVorher, 'nichts im Repo veraendert (git status wie vorher)');
  if (!wert('behalte') && !fails) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* egal */ } } else console.log('\nAblage: ' + tmp);
  console.log(`\n${n - fails}/${n} Pruefungen ok`);
  if (fails) console.log('FEHLER: ' + fails);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FEHLER Ausnahme: ' + (e && e.stack)); process.exit(1); });
