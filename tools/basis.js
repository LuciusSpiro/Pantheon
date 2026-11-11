'use strict';
// TEL-01 C: Basis-Lauf der Bots. Faehrt eine feste Liste von Gruppen mit festen Seeds (je Lauf ein eigener Prozess von tools/sim-headless.js, parallel), rechnet je Lauf die Kennzahlen
// (tools/auswertung/kennzahlen.js) und schreibt je Gruppe und Kennzahl die Statistik (Median, Min, Max, Streuung) in eine eingecheckte Datei.
//   npm run basis -- [--seeds 12] [--jobs 4] [--seed-base 1] [--aus <datei.json>] [--gruppen <id,id,...>] [--behalten] [--nur-md]
//     --seeds       Seeds je Gruppe (Standard 12: seed-base .. seed-base + seeds - 1; die Fehlalarm-Probe nimmt andere, 101-106)
//     --jobs        parallele Prozesse (Standard 4)
//     --aus         Ausgabedatei (Standard tools/fixtures/telemetrie/basis-<plattform>.json); der Basis-Bericht liegt daneben als .md
//     --gruppen     nur diese Gruppen-IDs (z. B. m3/3,arena_graben/3), sonst alle; mit --aus fuer Proben ausserhalb des Repos
//     --behalten    Rohprotokolle der Laeufe nicht loeschen (Ordner wird ausgegeben); sie gehoeren NICHT ins Repo
//     --nur-md      keine Laeufe: den Basis-Bericht aus der vorhandenen JSON-Datei neu erzeugen
// Die Basis gilt nur fuer die Plattform, auf der sie gefahren wurde (win32-x64). Die Bots sind je Lauf deterministisch (gleiche Seed -> gleiche Kennzahlen ausser Technik, siehe KENNZAHL_INFO determ).
// Exit 0 = alle Laeufe ergaben eine saubere Session (Kopf, session_ende); 1 = mindestens ein Lauf ohne gueltige Session (steht in der Ausgabe, die Datei wird trotzdem geschrieben).
// Ein Fehlerlauf (S3: Prozess abgebrochen, kein session_ende, falsche Gruppe) geht nicht in die Statistik; die Zahl steht im Kopf und je Gruppe der Basis-Datei, die Ausgabe nennt jeden einzeln.
// Ein Lauf, dessen Bot-Skript "FEHLGESCHLAGEN" meldet (Exit 1 von sim-headless: kein Sieg, Softlock), ist KEIN Fehler dieses Werkzeugs: das Protokoll ist gueltig und zaehlt (Ausgang 'rot' in der Gruppe).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Lesen = require('./auswertung/lesen.js');
const { kennzahlen, KENNZAHL_VERSION } = require('./auswertung/kennzahlen.js');
const Basis = require('./auswertung/basis.js');

const ROOT = path.join(__dirname, '..');
const SIM = path.join(__dirname, 'sim-headless.js');
const FIXTURES = path.join(__dirname, 'fixtures', 'telemetrie');
// Der Spielcode auf tel01 ist bit-gleich zu main 9cf0397 (TEL-01 M2: main mit KUL-02 und UEB-01 integriert; Bot-Laeufe und Golden Trace mit Protokoll gegen 9cf0397 bit-gleich).
// Die Laeufe der Basis selbst entstanden auf 75ab5a7 (TEL-01 M); 75ab5a7 und 9cf0397 liefern dieselben Bot-Ausgaben und denselben Golden Trace (M2), die Basis gilt unveraendert.
// Vor Paket M stand hier f2daff7 (Stand vor GEG-01/OPS-01); die Basis dieses Stands ist ueberholt.
const SPIELSTAND_WIE = '08c665e7';   // Basis neu gefahren auf main 08c665e7 (2026-11-11, Merge BEA-01 nach main 2c1ffb49: Tuning-Hash durch Zusammenfuehrung der *-werte.json geaendert, Spielverhalten der Bots unveraendert). Davor bea01 f2a966bd (2026-11-11, BEA-01 Nacharbeit: Tuning-Hash durch szenen-werte.json (Text raumschlacht_rom) geaendert, Spielverhalten der Bots unveraendert). Davor bea01 f92127df (2026-11-11, BEA-01 C2: Tuning-Hash durch abenteuer-werte.json (prompt_max_zeichen) geaendert, Spielverhalten der Bots unveraendert; die neuen Beats und die Absicht laufen nur in Plaenen). Davor: Basis neu gefahren auf bea01 6f3d537d (2026-11-11, BEA-01 C1: Tuning-Hash durch werte.json (vorlage_beats_max) geaendert, Spielverhalten der Bots unveraendert; falscher_haendler hat zehn Beats, die Bots der Basis spielen keine Faeden). Davor bea01 dde9358e (2026-11-11, BEA-01 B: Tuning-Hash durch forderung-werte (fund_ruf, bussgeld_marken) und ruf-werte (schmuggel_entdeckt_rom) geaendert, Spielverhalten der Bots unveraendert; Lauf ueber dde9358e und den Commit mit SPIELSTAND_WIE). Davor bea01 afcb03a3 (2026-11-11, BEA-01 A: Tuning-Hash durch forderung-werte geaendert, Spielverhalten der Bots unveraendert; Lauf ueber afcb03a3 und ecdac54b, dazwischen nur der Geld-Grund umbenannt). Davor spl02 c1b1dea7 (2026-11-10, SPL-02: Tuning-Hash durch szenen-werte erz, texte-werte, abenteuer-werte, inszenierer-werte geaendert; Spielverhalten der Bots unveraendert, der Modus Absichten ist aus)
const LAUF_TIMEOUT_MS = 20 * 60 * 1000;
const WELLEN_KARTEN = ['aussenposten', 'station', 'ruine', 'schiff', 'kesh'];

// Feste Liste: id = gruppenId des Laufs (Modus/Szenario/Spielerzahl aus dem Sessionkopf), args = Argumente an sim-headless OHNE Seed (der kommt als --seed S dazu)
// Begruendung der Auswahl: die Modi, deren Zahlen die README als Bot-Messung fuehrte (Raumkampf, Graben, Wellen am Boden, Kampagne, Kesh) – je solo/zu dritt, wo es das gab.
const GRUPPEN = [
  { id: 'arena_graben/3', name: 'Grabenangriff zu dritt', args: ['graben', '--players', '3', '--seeds', '1'] },
  // Die Steuerstrategie steht als Szenario im Sessionkopf (game.telemetrie.szenario, sim-headless arena), damit nose und maneuver verschiedene Gruppen sind
  { id: 'arena_space/maneuver/3', name: 'Raumkampf-Arena zu dritt, Steuer maneuver', args: ['arena', '--pilot', 'maneuver', '--players', '3', '--seeds', '1'] },
  { id: 'arena_space/nose/3', name: 'Raumkampf-Arena zu dritt, Steuer nose', args: ['arena', '--pilot', 'nose', '--players', '3', '--seeds', '1'] },
  { id: 'm1/1', name: 'Kampagne solo (M1, M2)', args: ['1'] },
  { id: 'm1/3', name: 'Kampagne zu dritt (M1, M2)', args: ['3'] },
  { id: 'm3/3', name: 'M3 Die Tafel von Kesh zu dritt', args: ['m3'] },
];
for (const karte of WELLEN_KARTEN) for (const p of [1, 3]) GRUPPEN.push({ id: 'arena_away/' + karte + '/' + p, name: 'Wellen ' + karte + (p === 1 ? ' solo' : ' zu dritt'), args: ['wellen', '--karte', karte, '--players', String(p), '--seeds', '1'] });

function optionen(argv) {
  const o = { seeds: 12, jobs: 4, seedBase: 1, aus: null, gruppen: null, behalten: false, nurMd: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    const wert = () => { const v = argv[++i]; if (v == null) throw new Error(x + ' braucht einen Wert'); return v; };
    if (x === '--seeds') o.seeds = Number(wert());
    else if (x === '--jobs') o.jobs = Number(wert());
    else if (x === '--seed-base') o.seedBase = Number(wert());
    else if (x === '--aus') o.aus = wert();
    else if (x === '--gruppen') o.gruppen = wert().split(',');
    else if (x === '--behalten') o.behalten = true;
    else if (x === '--nur-md') o.nurMd = true;
    else throw new Error('unbekannte Option ' + x);
  }
  if (!(o.seeds >= 1) || !(o.jobs >= 1)) throw new Error('--seeds und --jobs muessen >= 1 sein');
  return o;
}

// Ausgang des Bot-Laufs aus dem Exit-Code von sim-headless: 0 = Ziel erreicht (ok), sonst rot (FEHLGESCHLAGEN: kein Sieg, Softlock); ein Abbruch des Prozesses ist ein Fehlerlauf (Basis.fehlerlauf), kein rot
const ausgangZu = (code) => (code === 0 ? 'ok' : 'rot');

// Ein Lauf: Prozess starten, Protokoll im eigenen Ordner lesen, Kennzahlen rechnen. Rueckgabe { gruppe, seed, kz, ausgang, fehler }
function lauf(g, seed, tmp) {
  return new Promise((resolve) => {
    const dir = path.join(tmp, g.id.replace(/[^A-Za-z0-9_-]/g, '_') + '-s' + seed);
    fs.mkdirSync(dir, { recursive: true });
    const env = Object.assign({}, process.env, { TELEMETRIE: 'an', TELEMETRIE_DIR: dir });
    const ch = spawn(process.execPath, [SIM].concat(g.args, ['--seed', String(seed)]), { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ch.stderr.on('data', (d) => { if (err.length < 2000) err += d; });
    const t = setTimeout(() => { try { ch.kill(); } catch (e) { /* weg */ } }, LAUF_TIMEOUT_MS);
    ch.on('exit', (code) => {
      clearTimeout(t);
      const r = { gruppe: g, seed, kz: null, ausgang: ausgangZu(code), fehler: null, dir };
      try {
        const dateien = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl'));
        if (dateien.length !== 1) r.fehler = dateien.length + ' Protokolldateien statt 1';
        else {
          const p = Lesen.lesen(path.join(dir, dateien[0]));
          const kz = kennzahlen(p);
          if (!p.zeilen.some((z) => z.typ === 'session_ende')) r.fehler = 'kein session_ende';
          else if (Basis.fehlerlauf(kz.kopf.grund, code)) r.fehler = Basis.fehlerlauf(kz.kopf.grund, code);   // S3: Prozess abgebrochen, kein Bot-Ergebnis
          else if (Basis.gruppenId(kz.kopf) !== g.id) r.fehler = 'Gruppe ' + Basis.gruppenId(kz.kopf) + ' statt ' + g.id;
          else r.kz = kz;
        }
      } catch (e) { r.fehler = 'Lesen fehlgeschlagen: ' + e.message; }
      if (r.fehler && err) r.fehler += ' (stderr: ' + err.trim().split('\n')[0].slice(0, 160) + ')';
      resolve(r);
    });
    ch.on('error', (e) => { clearTimeout(t); resolve({ gruppe: g, seed, kz: null, ausgang: 'rot', fehler: 'Start fehlgeschlagen: ' + e.message, dir }); });
  });
}

async function pool(auftraege, jobs, fn, fortschritt) {
  const out = new Array(auftraege.length);
  let next = 0, fertig = 0;
  async function worker() {
    for (;;) { const i = next++; if (i >= auftraege.length) return; out[i] = await fn(auftraege[i]); fertig++; if (fortschritt) fortschritt(fertig, auftraege.length, out[i]); }
  }
  await Promise.all(Array.from({ length: Math.min(jobs, auftraege.length) }, worker));
  return out;
}

const einzigartig = (a) => [...new Set(a.filter((x) => x != null))];
// Basis-Datei (Objekt) aus den Laeufen; rein bis auf die uebergebenen Kopfdaten
function dateiAus(ergebnisse, o, kopfExtra) {
  const gruppen = {};
  for (const g of GRUPPEN) {
    const ok = ergebnisse.filter((r) => r.gruppe.id === g.id && r.kz);
    if (!ok.length) continue;
    ok.sort((a, b) => a.seed - b.seed);
    const fehl = ergebnisse.filter((r) => r.gruppe.id === g.id && r.fehler).length;   // S3: nicht in der Statistik, hier gezaehlt
    gruppen[g.id] = Basis.gruppeBauen(ok.map((r) => ({ seed: r.seed, kz: r.kz, ausgang: r.ausgang })), { fehlerlaeufe: fehl, name: g.name, befehl: 'node tools/sim-headless.js ' + g.args.join(' ') + ' --seed <S>' });
  }
  const alle = ergebnisse.filter((r) => r.kz).map((r) => r.kz.kopf);
  const eins = (k) => { const w = einzigartig(alle.map((x) => x[k])); return w.length === 1 ? w[0] : w.join(','); };
  return Basis.basisBauen(gruppen, Object.assign({
    spielstand_wie: SPIELSTAND_WIE, commit: eins('commit'), plattform: eins('plattform'), node: eins('node'), kennzahl_version: KENNZAHL_VERSION, tuning_hash: eins('tuning_hash'),
    seeds: o.seeds, seed_base: o.seedBase, jobs: o.jobs, fehlerlaeufe: ergebnisse.filter((r) => r.fehler).length,
  }, kopfExtra || {}));
}

async function main() {
  const o = optionen(process.argv.slice(2));
  const plattform = process.platform + '-' + process.arch;
  const aus = path.resolve(o.aus || path.join(FIXTURES, 'basis-' + plattform + '.json'));
  const mdPfad = aus.replace(/\.json$/, '') + '.md';
  if (o.nurMd) {
    fs.writeFileSync(mdPfad, Basis.basisMarkdown(JSON.parse(fs.readFileSync(aus, 'utf8'))), 'utf8');
    console.log('Basis-Bericht: ' + mdPfad);
    return 0;
  }
  const gruppen = o.gruppen ? GRUPPEN.filter((g) => o.gruppen.includes(g.id)) : GRUPPEN;
  if (o.gruppen && gruppen.length !== o.gruppen.length) throw new Error('unbekannte Gruppe in --gruppen; bekannt: ' + GRUPPEN.map((g) => g.id).join(', '));
  const auftraege = [];
  for (const g of gruppen) for (let i = 0; i < o.seeds; i++) auftraege.push({ g, seed: o.seedBase + i });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-basis-'));
  const t0 = Date.now();
  console.log('Basis-Lauf: ' + gruppen.length + ' Gruppen x ' + o.seeds + ' Seeds = ' + auftraege.length + ' Laeufe, ' + o.jobs + ' parallel, Rohprotokolle in ' + tmp);
  const ergebnisse = await pool(auftraege, o.jobs, (a) => lauf(a.g, a.seed, tmp), (n, gesamt, r) => {
    if (r.fehler || n % 10 === 0 || n === gesamt) console.log('  ' + n + '/' + gesamt + ' ' + r.gruppe.id + ' Seed ' + r.seed + (r.fehler ? '  FEHLER: ' + r.fehler : '  ' + r.ausgang));
  });
  const laufzeit = Math.round((Date.now() - t0) / 1000);
  const datei = dateiAus(ergebnisse, o, { datum: new Date().toISOString().slice(0, 10), laufzeit_s: laufzeit });
  const text = JSON.stringify(datei);
  fs.mkdirSync(path.dirname(aus), { recursive: true });
  fs.writeFileSync(aus, text + '\n', 'utf8');
  fs.writeFileSync(mdPfad, Basis.basisMarkdown(datei), 'utf8');
  if (!o.behalten) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* egal */ } }
  const bad = ergebnisse.filter((r) => r.fehler);
  console.log('Basis-Datei: ' + aus + ' (' + Math.round(text.length / 1024) + ' KB), Bericht: ' + mdPfad + ', Laufzeit ' + laufzeit + ' s' + (o.behalten ? ', Rohprotokolle ' + tmp : ''));
  const probleme = Basis.pruefen(datei);
  if (probleme.length) console.log('GUELTIGKEIT: ' + probleme.join('; '));
  if (bad.length) console.log(bad.length + ' Lauf/Laeufe ohne gueltige Session (nicht in der Statistik): ' + bad.map((r) => r.gruppe.id + '#' + r.seed).join(', '));
  return bad.length || probleme.length ? 1 : 0;
}

if (require.main === module) main().then((c) => process.exit(c), (e) => { console.error('Basis-Lauf fehlgeschlagen: ' + e.message); process.exit(2); });
module.exports = { GRUPPEN, SPIELSTAND_WIE, optionen, lauf, pool, dateiAus, ausgangZu };
