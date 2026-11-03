'use strict';
// TEL-01 D2: Vergleich zweier Laeufe oder Gruppen von Laeufen. Rechnen und Darstellen steht in tools/auswertung/vergleich.js und bewertung.js (rein); hier nur: Eingaben lesen, Ausgabe schreiben.
//   npm run vergleich -- <A> <B> [--alle] [--aus <datei.md>] [--filter k=v,...] [--filter-a ...] [--filter-b ...] [--basis-datei <json>] [--tuning-dir <ordner>]
//     A und B sind je eines von:
//       <protokoll.jsonl> | <sessionkennung>     ein Lauf (alle Teile der Session)
//       <ordner>                                  eine Gruppe: alle Sessions darin (rekursiv, ohne tuning/ und berichte/); Gruppen-ID und Statistik wie in der Basis, Fehlerlaeufe (Bot ohne session_ende,
//                                                 vom Prozessende abgebrochen) gehen nicht ein, eine gemischte Gruppe (Modus, Szenario, Spielerzahl, Quelle, Commit, Tuning) bekommt eine Warnung
//       basis:<gruppen-id>                        Gruppe aus der Basis-Datei (z. B. basis:m1/3, Standard: tools/fixtures/telemetrie/basis-<plattform>.json)
//       <kennzahlen.json>                         Kennzahlen eines Laufs (npm run auswerten -- ... --json <datei>)
//     --filter        gilt fuer beide Seiten, --filter-a / --filter-b nur fuer eine: modus=, szenario=, spielerzahl=, quelle=, plattform=, seed=, commit=<praefix>, tuning=<praefix>, mit Komma verbunden
//                     (so lassen sich Build, Mensch gegen Bot und Spielerzahl aus einem Ordner trennen: npm run vergleich -- ordner ordner --filter-a commit=ab12 --filter-b commit=cd34 --filter modus=m1,spielerzahl=3)
//                     (gilt nicht fuer basis:<id>: die Basis-Gruppe ist schon gewaehlt)
//     --alle          alle Kennzahlen statt der wesentlichen und der Kernkennzahlen
//     --aus <datei>   Bericht in eine Datei statt auf die Standardausgabe
//     --tuning-dir    weiterer Ordner mit tuning/<hash>.json (gesucht wird sonst neben den Protokollen und in data/telemetrie/)
// Exit 0 bei Erfolg (auch bei wesentlichen Abweichungen: das ist das Ergebnis; laesst ein Filter eine Seite leer, steht das im Bericht), 2 bei Aufrufproblemen (Eingabe nicht gefunden, unbekannte Option, kaputter Filter).

const fs = require('fs');
const path = require('path');
const Lesen = require('./auswertung/lesen.js');
const { kennzahlen } = require('./auswertung/kennzahlen.js');
const Vergleich = require('./auswertung/vergleich.js');
const { standardBasisDatei } = require('./auswerten.js');

const ROOT = path.join(__dirname, '..');

function args(argv) {
  const a = { eingaben: [], alle: false, aus: null, filter: null, filterA: null, filterB: null, basisDatei: null, tuningDir: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    const wert = () => { const v = argv[++i]; if (v == null) throw new Error(x + ' braucht einen Wert'); return v; };
    if (x === '--alle') a.alle = true;
    else if (x === '--aus') a.aus = wert();
    else if (x === '--filter') a.filter = wert();
    else if (x === '--filter-a') a.filterA = wert();
    else if (x === '--filter-b') a.filterB = wert();
    else if (x === '--basis-datei') a.basisDatei = wert();
    else if (x === '--tuning-dir') a.tuningDir.push(wert());
    else if (x.startsWith('--')) throw new Error('unbekannte Option ' + x);
    else a.eingaben.push(x);
  }
  if (a.eingaben.length !== 2) throw new Error('zwei Eingaben noetig: <A> <B> (Datei, Sessionkennung, Ordner, basis:<gruppen-id> oder Kennzahlen-JSON), bekommen ' + a.eingaben.length);
  return a;
}

const jsonDatei = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const istDatei = (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };
const istOrdner = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };

function basisLaden(datei) {
  const f = datei || standardBasisDatei(process.platform + '-' + process.arch);
  if (!f) throw new Error('keine Basis-Datei gefunden (tools/fixtures/telemetrie/basis-<plattform>.json); mit --basis-datei angeben');
  return jsonDatei(f);
}

// Ein Lauf aus einem Protokoll: { kz, kennung, tuningTeile, dir }
function laufLesen(eingabe, dirs) {
  const p = Lesen.lesen(eingabe, dirs ? { dirs } : undefined);
  const kopf = p.zeilen.find((z) => z.typ === 'kopf');
  return { kz: kennzahlen(p), kennung: p.kennung, tuningTeile: kopf && kopf.tuning_teile && typeof kopf.tuning_teile === 'object' ? kopf.tuning_teile : null, dir: p.dateien.length ? path.dirname(p.dateien[0]) : null };
}

// Seite zu einer Eingabe. Rueckgabe die Seite aus vergleich.js, dazu seite.dirs (Ordner mit Protokollen, fuer die Suche nach tuning/<hash>.json)
function seiteLaden(spec, opt) {
  opt = opt || {};
  const filter = Vergleich.filterParsen(opt.filter);
  const kopfOk = (l) => Vergleich.filterPasst(l.kz.kopf, filter);
  if (spec.startsWith('basis:')) {
    const basis = basisLaden(opt.basisDatei);
    const id = spec.slice(6);
    const s = Vergleich.seiteAusBasis(basis, id);
    if (!s) throw new Error('Basis-Gruppe "' + id + '" gibt es nicht; vorhanden: ' + Object.keys(basis.gruppen).join(', '));
    s.dirs = [];
    return s;
  }
  if (istOrdner(spec)) {
    const sessions = Lesen.ordnerSessions(spec);
    if (!sessions.length) throw new Error('keine Protokolle (*.jsonl) in ' + spec);
    const laeufe = sessions.map((e) => laufLesen(e.kennung, [e.dir])).filter(kopfOk);
    const s = Vergleich.seiteAusLaeufen(path.basename(path.resolve(spec)) + (opt.filter ? ' [' + opt.filter + ']' : ''), laeufe, { art: 'gruppe' });
    s.dirs = [...new Set(laeufe.map((l) => l.dir).concat([path.resolve(spec)]))];
    return s;
  }
  if (spec.endsWith('.json') && istDatei(spec)) {
    const kz = jsonDatei(spec);
    if (!kz || !kz.version || !(kz.f1 || kz.f2 || kz.f6)) throw new Error(spec + ' ist keine Kennzahlen-Datei (npm run auswerten -- ... --json)');
    const l = { kz, kennung: kz.kopf && kz.kopf.sitzung, tuningTeile: null };
    const s = Vergleich.seiteAusLaeufen(path.basename(spec), kopfOk(l) ? [l] : [], { art: 'lauf' });
    s.dirs = [];
    return s;
  }
  let l;
  try { l = laufLesen(spec); } catch (e) { throw new Error('Eingabe "' + spec + '" ist weder Ordner, Datei, Sessionkennung noch basis:<id> (' + e.message + ')'); }
  const s = Vergleich.seiteAusLaeufen(spec, kopfOk(l) ? [l] : [], { art: 'lauf' });
  s.dirs = l.dir ? [l.dir] : [];
  return s;
}

// tuning/<hash>.json suchen: neben den Protokollen der Seite, in --tuning-dir, in data/telemetrie/ und data/telemetrie/bot/
function tuningFinden(hash, seite, extra) {
  const dirs = [].concat((seite && seite.dirs) || [], extra || [], Lesen.STANDARD_DIRS);
  for (const d of dirs) {
    for (const base of [d, path.dirname(d)]) {
      const f = path.join(base, 'tuning', hash + '.json');
      if (istDatei(f)) { try { return jsonDatei(f); } catch (e) { /* kaputt: naechster Ort */ } }
    }
  }
  return null;
}

// Kern, auch fuer Tests: Eingaben laden, vergleichen. Rueckgabe { text, wesentlich, ... } aus vergleich.js (+ a, b: die Seiten)
function vergleichen(eingabeA, eingabeB, o) {
  o = o || {};
  const a = seiteLaden(eingabeA, { filter: [o.filter, o.filterA].filter(Boolean).join(','), basisDatei: o.basisDatei });
  const b = seiteLaden(eingabeB, { filter: [o.filter, o.filterB].filter(Boolean).join(','), basisDatei: o.basisDatei });
  const r = Vergleich.vergleichen(a, b, { alle: !!o.alle, tuningLaden: (hash, seite) => tuningFinden(hash, seite, (o.tuningDir || []).map((d) => path.resolve(d))) });
  return Object.assign(r, { a, b });
}

function main() {
  let a;
  try { a = args(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  let r;
  try { r = vergleichen(a.eingaben[0], a.eingaben[1], a); } catch (e) { console.error('Vergleich fehlgeschlagen: ' + e.message); process.exit(2); }
  if (a.aus) {
    const f = path.resolve(a.aus);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, r.text, 'utf8');
    console.log('Vergleich: ' + f + ' (' + (r.text.split('\n').length - 1) + ' Zeilen, ' + r.wesentlich + ' wesentlich)');
  } else process.stdout.write(r.text);
}

if (require.main === module) main();
module.exports = { vergleichen, seiteLaden, tuningFinden, args, laufLesen, ROOT };
