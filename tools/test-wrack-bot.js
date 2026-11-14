'use strict';
// WRK-01 B: Bot-Laeufe des Beats wrack am echten Server (tools/spiel-wrack.js: Rueckfall ohne Modell, Plan Geruecht > wrack > abschluss eingespeist, Bots scannen, waehlen das Wrack, beamen runter, bergen Beute,
// lesen das Logbuch, beamen hoch). Der Test startet den Laeufer je Fall EINZELN (nacheinander, nie parallel: jeder Lauf startet einen Server) und zaehlt aus der Messdatei (--json) selbst nach; das Urteil des Laeufers
// allein genuegt nie:
//   A  ruhig/raeuber, Crew 1 und Crew 3, ohne und mit Beute und Logbuch: Faden abgeschlossen und gelungen, Gedaechtnis wrack_gelungen, Beats Geruecht > wrack > ende, mindestens ein Bot unten (Crew 3: zwei),
//      beamedDown und beamedUp am Ort ohne Notrueckholung, Beute (beuteGeborgen, Ware im Lager) und Logbuch (ankerGelesen) nur wo verlangt, Startfunk und Abschlussfunk aus wrack-texte.json in der Variante, die
//      zu Beute und Logbuch passt, Gegner nach der Tabelle boden-werte.json (ruhig 0, raeuber mindestens 1), Ort restlos weg, 0 Komponisten-Aufrufe, g.errors 0
//      Fall ruhig-3blv (--verkauf): nach dem Faden-Ende fliegt die Crew an den Hafen Ostia Nova und verkauft die Beute (weapons.verkaufen): Verkauf ok, Marken-Differenz = Einheiten x Preis (content/waren.json, handel.json), Lager leer
//   B  Frist-Lauf (die Crew bleibt oben): Beat wrack gescheitert, nie unten, Verzweigung ins Ende, Faden abgeschlossen, Ort weg, KEIN Abschlussfunk (das Frist-Scheitern spricht absichtlich nicht), 0 Komponisten-Aufrufe, g.errors 0
//   C  Aufruf: falsche Werte geben Exit 2 (auch --verkauf ohne --beute)
//   D  das Repo ist unberuehrt (git status wie vorher)
//   node tools/test-wrack-bot.js [--behalte <ordner>] [--fall name,name]      Mutationsprobe: tools/mutation-wrack-bot.js
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
const TX = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'faeden', 'wrack-texte.json'), 'utf8')).texte;
const MIN_GEGNER = { ruhig: 0, raeuber: 1 };   // aus der Abnahme (Tabelle boden-werte.json: ruhig leer, raeuber Raubzug klein)
const tmp = wert('behalte') ? path.resolve(wert('behalte')) : fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-wrack-bot-'));
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
  { bes: 'ruhig', crew: 1, seed: 7, beute: false, logbuch: false },
  { bes: 'ruhig', crew: 1, seed: 9, beute: true, logbuch: false },
  { bes: 'ruhig', crew: 1, seed: 3, beute: false, logbuch: true },
  { bes: 'ruhig', crew: 3, seed: 11, beute: true, logbuch: true },
  { bes: 'raeuber', crew: 1, seed: 5, beute: false, logbuch: false },
  { bes: 'raeuber', crew: 3, seed: 7, beute: false, logbuch: false },
  { bes: 'raeuber', crew: 1, seed: 5, beute: true, logbuch: true },
  { bes: 'ruhig', crew: 3, seed: 7, beute: true, logbuch: true, verkauf: true },
];
const nameVon = (fl) => `${fl.bes}-${fl.crew}${fl.beute ? 'b' : ''}${fl.logbuch ? 'l' : ''}${fl.verkauf ? 'v' : ''}`;
const NUR = wert('fall') ? wert('fall').split(',') : null;
const gewollt = (name) => !NUR || NUR.includes(name);
// Erwartung des Verkaufs aus den DATEN (Preis je Einheit der Ware am Hafen: Grundpreis x Volk x Hafen, gerundet, mindestens 1)
const preisJe = (art, hex) => {
  const rj = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, 'content', ...p), 'utf8'));
  const HD = rj('handel.json'), volk = HD.voelker[rj('welt', 'sund_frei.json').hexe[hex].fraktion] || HD.standard, hd = HD.haefen['sund_frei:' + hex] || {};
  const f = (volk.faktor != null ? volk.faktor : 1) * (volk.waren[art] != null ? volk.waren[art] : 1) * (hd.faktor != null ? hd.faktor : 1) * ((hd.waren && hd.waren[art]) != null ? hd.waren[art] : 1);
  return Math.max(1, Math.round(rj('waren.json').waren.find((x) => x.id === art).grundpreis * f));
};
const funkText = (key, j) => TX[key].replace('{platz}', 'Das Wrack').replace('{ort}', j.ortName).slice(0, 160);

(async () => {
  section('C  Aufruf: falsche Werte');
  {
    const r1 = await lauf(['tools/spiel-wrack.js', '--besetzung', 'gibt_es_nicht']);
    const r2 = await lauf(['tools/spiel-wrack.js', '--besetzung', 'ruhig', '--crew', '2']);
    const r3 = await lauf(['tools/spiel-wrack.js', '--besetzung', 'belagerer']);
    ok(r1.code === 2 && /Aufruf/.test(r1.text), 'unbekannte Besetzung: Exit 2');
    ok(r2.code === 2, 'Crew 2 (laut Steckbrief bei Bots instabil) wird nicht gefahren: Exit 2');
    ok(r3.code === 2, 'Besetzung belagerer ist fuer wrack nicht vorgesehen: Exit 2');
    const r4 = await lauf(['tools/spiel-wrack.js', '--besetzung', 'ruhig', '--verkauf']);
    ok(r4.code === 2 && /--beute/.test(r4.text), '--verkauf ohne --beute: Exit 2 mit Hinweis');
  }
  ok(Object.keys(BW.ruhig).length === 0 && BW.raeuber.fraktion === 'raubzug', 'Erwartung gegen die Tabelle boden-werte.json gelesen (ruhig leer, raeuber Raubzug)');

  for (const fl of FAELLE) {
    const name = nameVon(fl);
    if (!gewollt(name)) continue;
    const datei = path.join(tmp, name + '.json');
    const a = ['tools/spiel-wrack.js', '--besetzung', fl.bes, '--crew', String(fl.crew), '--seed', String(fl.seed), '--json', datei].concat(fl.beute ? ['--beute'] : [], fl.logbuch ? ['--logbuch'] : [], fl.verkauf ? ['--verkauf'] : []);
    const r = await lauf(a);
    let j = null; try { j = JSON.parse(fs.readFileSync(datei, 'utf8')); } catch (e) { /* kein Ergebnis */ }
    section(`A  ${fl.bes}, Crew ${fl.crew}, Seed ${fl.seed}${fl.beute ? ', Beute' : ''}${fl.logbuch ? ', Logbuch' : ''}${fl.verkauf ? ', Verkauf' : ''} (${r.s} s)`);
    ok(r.code === 0 && !!j, 'Laeufer Exit 0' + (r.code === 0 ? '' : '\n' + r.text.split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 8).join('\n')));
    if (!j) continue;
    const g = j.faden.gedaechtnis;
    ok(j.faden.phase === 'abgeschlossen' && j.faden.ausgang === 'gelungen', `Faden abgeschlossen, Ausgang gelungen (${j.faden.phase}, ${j.faden.ausgang})`);
    ok(g.includes('wrack_gelungen') && !g.includes('wrack_gescheitert') && g.includes('geruecht_gelungen'), `Gedaechtnis: Geruecht und wrack gelungen (${g.join(', ')})`);
    const v = j.faden.verlauf.map((x) => x.replace(/ \(.*$/, ''));
    ok(JSON.stringify(v) === JSON.stringify(['beginnt b1_geruecht', 'endet b1_geruecht', 'beginnt b2_wrack', 'endet b2_wrack', 'beginnt ende']), `Beats in der Reihenfolge Geruecht, wrack, ende (${v.join(' > ')})`);
    ok(/b2_wrack gelungen/.test(j.faden.verlauf.join(' ')), 'Beat wrack endet gelungen');
    const downs = j.boden.filter((e) => e.k === 'beamedDown'), ups = j.boden.filter((e) => e.k === 'beamedUp');
    const sollUnten = fl.crew === 1 ? 1 : 2;
    ok(j.unten === sollUnten && downs.reduce((s, e) => s + e.n, 0) === sollUnten && downs.length >= 1, `unten waren ${j.unten} von ${fl.crew} Bots (beamedDown mit ${downs.reduce((s, e) => s + e.n, 0)} Spielern)`);
    ok(ups.length >= 1 && ups.reduce((s, e) => s + e.n, 0) === sollUnten && !ups.some((e) => e.notrueckholung), `beamedUp am Ort ohne Notrueckholung (${ups.length}x, ${ups.reduce((s, e) => s + e.n, 0)} Spieler)`);
    const beuteEv = j.boden.filter((e) => e.k === 'beuteGeborgen').length, logEv = j.boden.filter((e) => e.k === 'ankerGelesen').length;
    ok(fl.beute ? (beuteEv >= 1 && (fl.verkauf ? j.lager === 0 : j.lager >= 1)) : (beuteEv === 0 && j.lager === 0), `Beute ${fl.beute ? 'geborgen' : 'nicht geborgen'}: beuteGeborgen ${beuteEv}x, Ware im Lager ${j.lager}${fl.verkauf ? ' (verkauft)' : ''}`);
    ok(fl.logbuch ? logEv >= 1 : logEv === 0, `Logbuch ${fl.logbuch ? 'gelesen' : 'nicht gelesen'}: ankerGelesen ${logEv}x`);
    ok(j.funk.includes(funkText('start_' + fl.bes, j)), `Startfunk der Besetzung ${fl.bes} aus wrack-texte.json`);
    ok(fl.beute ? j.funk.includes(funkText('beute', j)) : !j.funk.includes(funkText('beute', j)), `Funk beim Fund ${fl.beute ? 'gesprochen' : 'nicht gesprochen'}`);
    ok(fl.logbuch ? j.funk.includes(funkText('logbuch', j)) : !j.funk.includes(funkText('logbuch', j)), `Funk beim Logbuch ${fl.logbuch ? 'gesprochen' : 'nicht gesprochen'}`);
    const abKey = `abschluss_${fl.beute ? 'mit' : 'ohne'}_beute_${fl.logbuch ? 'mit' : 'ohne'}_logbuch`;
    ok(j.funk.includes(funkText(abKey, j)) && Object.keys(TX).filter((x) => x.startsWith('abschluss_') && x !== abKey).every((x) => !j.funk.includes(funkText(x, j))), `Abschlussfunk genau die Variante ${abKey}`);
    ok(fl.bes === 'ruhig' ? j.gegner === 0 : j.gegner >= MIN_GEGNER[fl.bes], `Gegner am Ort: ${j.gegner} (Soll ${fl.bes === 'ruhig' ? '0' : 'mindestens ' + MIN_GEGNER[fl.bes]}), Arten ${j.gegnerArten || '-'}`);
    ok(j.orte.vor === 0 && j.orte.lauf >= 1 && j.orte.nach === 0 && j.orte.nachDetail.dyn.length === 0 && j.orte.nachDetail.scan.length === 0 && j.orte.nachDetail.aways.length === 0 && j.orte.nachDetail.awayMap === null, `Ort restlos weg: Orte ${j.orte.vor} vorher, ${j.orte.lauf} im Lauf, ${j.orte.nach} nachher (lpScan, aways, away.map leer)`);
    ok(j.komponistenAufrufe === 0 && j.errors === 0, `0 Komponisten-Aufrufe (${j.komponistenAufrufe}), g.errors ${j.errors}`);
    ok(fl.verkauf ? !!j.verkauf : j.verkauf === undefined, `Messdatei: Verkauf ${fl.verkauf ? 'belegt' : 'nicht vorhanden'} (ohne --verkauf bleibt die Messdatei wie bisher)`);
    if (fl.verkauf && j.verkauf) {
      const v = j.verkauf, pj = preisJe('bergungsgut', '0305');
      ok(v.ok === true && v.hafen === 'ostia_nova', `Verkauf ok am Hafen ${v.hafen}`);
      ok(v.einheiten >= 1 && v.preis_je === pj && v.marken_nachher - v.marken_vorher === v.einheiten * pj, `Marken ${v.marken_vorher} > ${v.marken_nachher}: Differenz ${v.marken_nachher - v.marken_vorher} = ${v.einheiten} x ${pj} (Preis aus waren.json und handel.json)`);
      ok(v.lager_leer === true && j.lager === 0, 'Lager der Beute leer nach dem Verkauf');
      ok(j.faden.ausgang === 'gelungen' && j.faden.gedaechtnis.includes('wrack_gelungen'), 'der Faden bleibt gelungen (Verkauf nach dem Faden-Ende)');
    }
  }

  if (gewollt('frist')) {
    section('B  Frist-Lauf: die Crew bleibt oben (raeuber, Crew 1)');
    const datei = path.join(tmp, 'frist.json');
    const r = await lauf(['tools/spiel-wrack.js', '--besetzung', 'raeuber', '--crew', '1', '--seed', '7', '--frist-lauf', '--json', datei]);
    let j = null; try { j = JSON.parse(fs.readFileSync(datei, 'utf8')); } catch (e) { /* kein Ergebnis */ }
    ok(r.code === 0 && !!j, `Laeufer Exit 0 (${r.s} s)` + (r.code === 0 ? '' : '\n' + r.text.split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 8).join('\n')));
    if (j) {
      const g = j.faden.gedaechtnis;
      ok(g.includes('wrack_gescheitert') && !g.includes('wrack_gelungen'), `Beat wrack gescheitert (Frist): ${g.join(', ')}`);
      ok(/b2_wrack gescheitert/.test(j.faden.verlauf.join(' ')) && /weiter ende/.test(j.faden.verlauf.join(' ')), 'Verzweigung: gescheitert fuehrt in den Beat ende');
      ok(j.boden.length === 0 && j.unten === 0, 'die Crew war nie unten');
      ok(!Object.keys(TX).some((x) => x.startsWith('abschluss_') && j.funk.includes(funkText(x, j))), 'kein Abschlussfunk des Gelingens (die Frist scheitert den Beat in faden.js, der Beat spricht dabei nicht)');
      ok(j.gegner >= 1, `der Ort war besetzt, der Beat scheiterte trotzdem sauber (${j.gegner} Gegner)`);
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
