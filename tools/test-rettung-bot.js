'use strict';
// BEA-02 D: Bot-Laeufe des Beats rettung am echten Server (tools/spiel-rettung.js: Rueckfall ohne Modell, Plan Geruecht > rettung > abschluss eingespeist, Bots scannen, waehlen den Landepunkt, beamen runter und hoch,
// die Ops holt die Ueberlebenden per Halteprozess hoch und gibt sie bei ende abgegeben an der Station ab).
// Der Test startet den Laeufer je Fall EINZELN (nacheinander, nie parallel: jeder Lauf startet einen Server) und zaehlt aus der Messdatei (--json) selbst nach; das Urteil des Laeufers allein genuegt nie:
//   A  ende an_bord und abgegeben, Besetzung ruhig, raeuber, belagerer, Crew 1 und 3 (drei Faelle): Faden abgeschlossen und gelungen, Gedaechtnis rettung_gelungen, Beats Geruecht > rettung > ende, alle Ueberlebenden mit Namen
//      aus der Namensliste (namen.json) ohne Doppelte, Betten 0 bis 2, bei an_bord Personen im Lager und im Weltstand, bei abgegeben Lager leer und Weltstand schiff.fracht leer, Gegner nach der Tabelle boden-werte.json,
//      Ort restlos weg (Orte 0 vorher, mindestens einer im Lauf, 0 nachher; keine Reste in lpScan und aways, away.map nicht der Ort), 0 Komponisten-Aufrufe, g.errors 0
//   B  Frist-Lauf (die Crew bleibt oben): Beat rettung gescheitert, nie unten, Verzweigung ins Ende, Faden abgeschlossen, Ort weg, 0 Komponisten-Aufrufe, g.errors 0
//   C  Frachtraum belegt (Erz im einzigen Modul): Funk-Hinweis, Beamen abgelehnt, nichts geraeumt, Beat scheitert an der Frist, Ort weg
//   D  Aufruf: falsche Werte geben Exit 2
//   E  das Repo ist unberuehrt (git status wie vorher)
//   node tools/test-rettung-bot.js [--behalte <ordner>] [--fall <name,...>]      Faelle: an_bord-ruhig-1, an_bord-belagerer-3, abgegeben-raeuber-3, frist, frachtraum     Mutationsprobe: tools/mutation-rettung-bot.js
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
const VOELKER = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'faeden', 'namen.json'), 'utf8')).voelker;
const NAMENLISTE = new Set(); for (const v of Object.values(VOELKER)) for (const a of v.vornamen) for (const b of v.nachnamen) NAMENLISTE.add(a + ' ' + b);
const MIN_GEGNER = { ruhig: 0, raeuber: 1, belagerer: 2 };   // aus der Abnahme (Tabelle boden-werte.json: ruhig leer, raeuber Raubzug klein, belagerer Raubzug mittel)
const tmp = wert('behalte') ? path.resolve(wert('behalte')) : fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-rettung-bot-'));
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
const lesen = (datei) => { try { return JSON.parse(fs.readFileSync(datei, 'utf8')); } catch (e) { return null; } };
const fehlerZeilen = (r) => (r.code === 0 ? '' : '\n' + r.text.split('\n').filter((l) => /FEHLER/.test(l)).slice(0, 8).join('\n'));
const FAELLE = [
  { name: 'an_bord-ruhig-1', ende: 'an_bord', bes: 'ruhig', crew: 1, seed: 7 }, { name: 'an_bord-belagerer-3', ende: 'an_bord', bes: 'belagerer', crew: 3, seed: 7 },
  { name: 'abgegeben-raeuber-3', ende: 'abgegeben', bes: 'raeuber', crew: 3, seed: 5 },
];   // drei Laeufe wegen der Laufzeit (Budget 170 s); die uebrigen Mischungen (abgegeben ruhig/belagerer, Crew 1 und 3) fahren von Hand: node tools/spiel-rettung.js ...
const NUR = wert('fall') ? wert('fall').split(',') : null;   // z. B. --fall frist (Probe, Mutationsprobe)
const gewollt = (name) => !NUR || NUR.includes(name);
const ortWeg = (j) => j.orte.vor === 0 && j.orte.lauf >= 1 && j.orte.nach === 0 && j.orte.nachDetail.dyn.length === 0 && j.orte.nachDetail.scan.length === 0 && j.orte.nachDetail.aways.length === 0 && j.orte.nachDetail.awayMap === null;

(async () => {
  section('D  Aufruf: falsche Werte');
  {
    const r1 = await lauf(['tools/spiel-rettung.js', '--besetzung', 'gibt_es_nicht', '--ende', 'an_bord']);
    const r2 = await lauf(['tools/spiel-rettung.js', '--besetzung', 'ruhig', '--ende', 'an_bord', '--crew', '2']);
    const r3 = await lauf(['tools/spiel-rettung.js', '--besetzung', 'ruhig', '--ende', 'irgendwo']);
    ok(r1.code === 2 && /Aufruf/.test(r1.text), 'unbekannte Besetzung: Exit 2');
    ok(r2.code === 2, 'Crew 2 (laut Steckbrief bei Bots instabil) wird nicht gefahren: Exit 2');
    ok(r3.code === 2, 'unbekanntes Ende: Exit 2');
  }
  ok(Object.keys(BW).sort().join() === Object.keys(MIN_GEGNER).sort().join() && Object.keys(BW.ruhig).length === 0 && BW.raeuber.fraktion === 'raubzug' && BW.belagerer.fraktion === 'raubzug', 'Erwartung gegen die Tabelle boden-werte.json gelesen (ruhig leer, raeuber und belagerer Raubzug)');
  ok(NAMENLISTE.size > 20, `Namensliste namen.json gelesen (${NAMENLISTE.size} Namen)`);

  for (const fl of FAELLE) {
    if (!gewollt(fl.name)) continue;
    const datei = path.join(tmp, fl.name + '.json');
    const r = await lauf(['tools/spiel-rettung.js', '--besetzung', fl.bes, '--ende', fl.ende, '--crew', String(fl.crew), '--seed', String(fl.seed), '--json', datei]);
    const j = lesen(datei);
    section(`A  ${fl.ende}, ${fl.bes}, Crew ${fl.crew}, Seed ${fl.seed} (${r.s} s)`);
    ok(r.code === 0 && !!j, 'Laeufer Exit 0' + fehlerZeilen(r));
    if (!j) continue;
    const g = j.faden.gedaechtnis;
    ok(j.faden.phase === 'abgeschlossen' && j.faden.ausgang === 'gelungen', `Faden abgeschlossen, Ausgang gelungen (${j.faden.phase}, ${j.faden.ausgang})`);
    ok(g.includes('rettung_gelungen') && !g.includes('rettung_gescheitert') && g.includes('geruecht_gelungen'), `Gedaechtnis: Geruecht und rettung gelungen (${g.join(', ')})`);
    const v = j.faden.verlauf.map((x) => x.replace(/ \(.*$/, ''));
    ok(JSON.stringify(v) === JSON.stringify(['beginnt b1_geruecht', 'endet b1_geruecht', 'beginnt b2_rettung', 'endet b2_rettung', 'beginnt ende']), `Beats in der Reihenfolge Geruecht, rettung, ende (${v.join(' > ')})`);
    ok(/b2_rettung gelungen/.test(j.faden.verlauf.join(' ')), 'Beat rettung endet gelungen');
    const sollUnten = fl.crew === 1 ? 1 : 2;
    const downs = j.boden.filter((e) => e.k === 'beamedDown'), ups = j.boden.filter((e) => e.k === 'beamedUp');
    ok(j.unten === sollUnten && downs.reduce((s, e) => s + e.n, 0) === sollUnten && ups.reduce((s, e) => s + e.n, 0) === sollUnten && !ups.some((e) => e.notrueckholung), `unten waren ${j.unten} von ${fl.crew} Bots, runter und hoch ohne Notrueckholung`);
    ok(j.gegner === 0 ? fl.bes === 'ruhig' : fl.bes !== 'ruhig' && j.gegner >= MIN_GEGNER[fl.bes], `Gegner am Ort: ${j.gegner} (Soll ${fl.bes === 'ruhig' ? '0' : 'mindestens ' + MIN_GEGNER[fl.bes]}), Arten ${j.gegnerArten || '-'}`);
    const namen = j.personen.map((p) => p.name);
    ok(j.amOrtStart === 3 && j.personen.length === 3 && new Set(namen).size === 3 && namen.every((x) => NAMENLISTE.has(x)), `3 Ueberlebende, Namen aus der Namensliste, ohne Doppelte: ${namen.join(', ')}`);
    ok(namen[0] === j.nsc, `Ueberlebender 1 ist der Faden-NSC (${j.nsc})`);
    ok(JSON.stringify(j.personen.map((p) => p.bett).sort()) === '[0,1,2]', `Betten 0 bis 2 (${j.personen.map((p) => p.bett).join(',')})`);
    ok(j.halteSek.length === 3 && j.halteSek.every((s) => s >= 2.5), `Aufnahme je Person ein Halteprozess (${j.halteSek.join(', ')} s)`);
    const ereignisse = j.boden.map((e) => e.k);
    ok(ereignisse.filter((x) => x === 'personAnBord').length === 3 && ereignisse.filter((x) => x === 'npcRescued').length === 3, 'je Person npcRescued und personAnBord (Haken)');
    if (fl.ende === 'abgegeben') {
      ok(j.abgegeben.length === 3 && ereignisse.filter((x) => x === 'personAbgegeben').length === 3, 'bei abgegeben: drei personAbgegeben an der Station');
      ok(j.lagerPersonenNachher === 0 && Array.isArray(j.weltFracht) && j.weltFracht.length === 0, `Lager leer, Weltstand schiff.fracht leer (${JSON.stringify(j.weltFracht)})`);
      ok(j.kuenstlich.teleport === 2, `Teleport zum Hex und zur Station (${j.kuenstlich.teleport}x)`);
    } else {
      ok(j.abgegeben.length === 0 && j.lagerPersonenNachher === 3 && j.weltFracht.length === 3 && j.weltFracht.every((x) => /\.u[123]$/.test(x.p) && x.n && Number.isInteger(x.b)), `an Bord: 3 Personen im Lager und im Weltstand schiff.fracht (${j.weltFracht.map((x) => x.n + '/' + x.b).join(', ')})`);
    }
    ok(ortWeg(j), `Ort restlos weg: Orte ${j.orte.vor} vorher, ${j.orte.lauf} im Lauf, ${j.orte.nach} nachher (lpScan, aways, away.map leer)`);
    ok(j.komponistenAufrufe === 0 && j.errors === 0, `0 Komponisten-Aufrufe (${j.komponistenAufrufe}), g.errors ${j.errors}`);
  }

  if (gewollt('frist')) {
    section('B  Frist-Lauf: die Crew bleibt oben (belagerer, Crew 1)');
    const datei = path.join(tmp, 'frist.json');
    const r = await lauf(['tools/spiel-rettung.js', '--besetzung', 'belagerer', '--ende', 'an_bord', '--crew', '1', '--seed', '7', '--frist-lauf', '--json', datei]);
    const j = lesen(datei);
    ok(r.code === 0 && !!j, `Laeufer Exit 0 (${r.s} s)` + fehlerZeilen(r));
    if (j) {
      const g = j.faden.gedaechtnis;
      ok(g.includes('rettung_gescheitert') && !g.includes('rettung_gelungen'), `Beat rettung gescheitert (Frist): ${g.join(', ')}`);
      ok(/b2_rettung gescheitert/.test(j.faden.verlauf.join(' ')) && /weiter ende/.test(j.faden.verlauf.join(' ')), 'Verzweigung: gescheitert fuehrt in den Beat ende');
      ok(j.boden.length === 0 && j.unten === 0 && j.personen.length === 0 && j.lagerPersonenNachher === 0, 'die Crew war nie unten, niemand an Bord');
      ok(j.gegner >= 2, `der Ort war besetzt, der Beat scheiterte trotzdem sauber (${j.gegner} Gegner)`);
      ok(j.faden.phase === 'abgeschlossen', `Faden abgeschlossen, kein Zombie-Faden (${j.faden.phase})`);
      ok(ortWeg(j), `Ort restlos weg (Orte ${j.orte.vor} > ${j.orte.lauf} > ${j.orte.nach})`);
      ok(j.komponistenAufrufe === 0 && j.errors === 0, `0 Komponisten-Aufrufe, g.errors ${j.errors}`);
    }
  }

  if (gewollt('frachtraum')) {
    section('C  Frachtraum belegt: Erz im einzigen Modul (ruhig, Crew 1)');
    const datei = path.join(tmp, 'frachtraum.json');
    const r = await lauf(['tools/spiel-rettung.js', '--besetzung', 'ruhig', '--ende', 'an_bord', '--crew', '1', '--seed', '7', '--frachtraum-belegt', '--json', datei]);
    const j = lesen(datei);
    ok(r.code === 0 && !!j, `Laeufer Exit 0 (${r.s} s)` + fehlerZeilen(r));
    if (j) {
      const TEXT = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'faeden', 'rettung-texte.json'), 'utf8')).texte.rettung_frachtraum_belegt;
      ok(j.kuenstlich['erz-setzen'] === 1, 'kuenstlich gesetzt: nur das Erz im Frachtmodul');
      ok(j.funk.includes(TEXT), 'Funk-Hinweis aus rettung-texte.json beim Start');
      ok(/Kein Bett frei/.test(String(j.aufnehmenFehler)), `Beamen abgelehnt, Klartext der Bordanzeige: ${String(j.aufnehmenFehler).slice(0, 60)}`);
      ok(j.personen.length === 0 && j.lagerPersonenNachher === 0 && j.lagerVorherGleich, 'nichts geraeumt, nichts aufgenommen: das Lager (Erz) ist unveraendert');
      ok(j.faden.gedaechtnis.includes('rettung_gescheitert') && !j.faden.gedaechtnis.includes('rettung_gelungen'), `Beat scheitert an der Frist: ${j.faden.gedaechtnis.join(', ')}`);
      ok(/b2_rettung gescheitert/.test(j.faden.verlauf.join(' ')) && /weiter ende/.test(j.faden.verlauf.join(' ')) && j.faden.phase === 'abgeschlossen', 'Verzweigung ins Ende, Faden abgeschlossen');
      ok(ortWeg(j), `Ort restlos weg (Orte ${j.orte.vor} > ${j.orte.lauf} > ${j.orte.nach})`);
      ok(j.komponistenAufrufe === 0 && j.errors === 0, `0 Komponisten-Aufrufe, g.errors ${j.errors}`);
    }
  }

  section('E  Repo unberuehrt');
  ok(gitStatus() === statusVorher, 'nichts im Repo veraendert (git status wie vorher)');
  if (!wert('behalte') && !fails) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* egal */ } } else console.log('\nAblage: ' + tmp);
  console.log(`\n${n - fails}/${n} Pruefungen ok`);
  if (fails) console.log('FEHLER: ' + fails);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FEHLER Ausnahme: ' + (e && e.stack)); process.exit(1); });
