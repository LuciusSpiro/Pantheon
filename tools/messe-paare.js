'use strict';
// KAT-01 Paket 0.1: Paarmatrix der Beat-Folgen – welches Paar `A direkt vor B` besteht den Bauplan-Pruefer, welches nur mit Verzweigung, welches nie (reine Auswertung, kein Spiel, kein Netz, kein Claude-Aufruf).
//   node tools/messe-paare.js [--json <datei>] [--md <datei>]          npm run messe:paare
// Planbar sind alle Beats mit `bauplan`, ohne `nur_inszenierer`, ohne `abschluss` (Quelle: server/sim/faden-daten.js = content/faeden/beats.json). Je geordnetes Paar (A, B, auch A = B) wird der Plan [A, B, abschluss]
// ueber denselben Weg geprueft wie Claudes Antwort (faden-bauplan.js pruefe: Expander, dann Pruefer). Dazu die Paare `B direkt vor abschluss` (Plan [B, abschluss]).
// Je Paar zwei Proben: (1) ohne Verzweigung, (2) mit A.verzweigung.gescheitert -> abschluss (B waere der Standardweg, kein Ziel); bei [B, abschluss] ist jede Verzweigung der Standardweg, also nur Probe 1.
// Beats mit Optionen bekommen optionen:true, Beats mit braucht.landeplatz einen Landeplatz im Plan (erste passende Kartenart). Kontext (Lage, Wahrheit-Hinweise, NSC aus frueherem Faden) ist NICHT Teil der Matrix.
// Kuerzel: ok (ohne Verzweigung gueltig) · nurV (nur mit Verzweigung gueltig) · nie (auch mit Verzweigung nie gueltig) · kontext (scheitert an einem Kontext-Code, kein Urteil ueber den Zustand) · hinweis (nur HINWEIS_FEHLT).
// Kontext-Codes werden aus den Code-Namen von faden-bauplan.js/faden-pruefer.js abgeleitet (Praefixe LAGE_, SABOTAGE_, NSC_ALT_, NSC_VON); SABOTAGE_NUR_EINMAL ist eine Planregel (sabotage zweimal), kein Kontext.
// Ausgabe: Konsole; --json/--md relativ zum Aufrufer, nie im Repo (Exit 2). Das Modul exportiert nur reine Funktionen: matrix, kontextCode, planFuer. main() nur beim direkten Start. Exit 0.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const D = require('../server/sim/faden-daten.js');
const BP = require('../server/sim/faden-bauplan.js');
const ORTE = require('../content/welt/abenteuer-orte.json');

const KONTEXT_PRAEFIX = ['LAGE_', 'SABOTAGE_', 'NSC_ALT_', 'NSC_VON'];
const kontextCode = (c) => c !== 'SABOTAGE_NUR_EINMAL' && KONTEXT_PRAEFIX.some((p) => c.startsWith(p));
const klon = (x) => JSON.parse(JSON.stringify(x));

const planbar = () => Object.keys(D.BEATS).filter((n) => D.BEATS[n].bauplan && !D.BEATS[n].nur_inszenierer && !D.BEATS[n].abschluss);
const abschlussName = () => Object.keys(D.BEATS).find((n) => D.BEATS[n].abschluss);
const brauchtPlatz = (n) => !!(D.BEATS[n].braucht && D.BEATS[n].braucht.landeplatz);
const artenVon = (n) => (Array.isArray(D.BEATS[n].landeplatz_art) ? D.BEATS[n].landeplatz_art : ORTE.arten);

// Beat des Plans: optionen:true wo der Typ Optionen mit Standard hat, landeplatz-Parameter wo er einen braucht
function beatVon(typ, id, platz) {
  const c = D.BEATS[typ], b = { id, typ };
  if (c.optionen === 'erlaubt' && c.bauplan.optionen) b.optionen = true;
  if (brauchtPlatz(typ)) b.parameter = { landeplatz: platz };
  return b;
}
// Plan [typen..., abschluss]; verzweigungA = Id des Ziels von typen[0].verzweigung.gescheitert (oder null)
function planFuer(typen, verzweigungA) {
  const ab = abschlussName();
  const ids = typen.map((t, i) => 'b' + (i + 1)).concat('z');
  const mitPlatz = typen.filter(brauchtPlatz);
  const plaetze = [];
  let platzIds = {};
  if (mitPlatz.length) {
    const gemeinsam = mitPlatz.map(artenVon).reduce((a, x) => a.filter((k) => x.includes(k)));
    if (gemeinsam.length) { plaetze.push({ id: 'p', art: gemeinsam[0] }); typen.forEach((t, i) => { if (brauchtPlatz(t)) platzIds[i] = 'p'; }); }
    else typen.forEach((t, i) => { if (brauchtPlatz(t)) { const id = 'p' + i; plaetze.push({ id, art: artenVon(t)[0] }); platzIds[i] = id; } });
  }
  const beats = typen.map((t, i) => beatVon(t, ids[i], platzIds[i]));
  if (verzweigungA) beats[0].verzweigung = { gescheitert: verzweigungA };
  beats.push({ id: 'z', typ: ab });
  const plan = { format: 'faden-bauplan/1', titel: 'Paarprobe ' + typen.join(' ') , beats };
  if (plaetze.length) plan.landeplaetze = plaetze;
  return plan;
}

function probe(typen, verzweigung) {
  const r = BP.pruefe(planFuer(typen, verzweigung));
  return { ok: r.ok, codes: r.ok ? [] : [...new Set(r.codes)], fehler: r.ok ? [] : r.fehler };
}
function klasse(p0, p1) {
  if (p0.ok) return 'ok';
  if (p0.codes.some(kontextCode)) return 'kontext';
  if (p1 && p1.ok) return 'nurV';
  if (p1 && p1.codes.some(kontextCode)) return 'kontext';
  const letzte = p1 || p0;
  if (letzte.codes.length && letzte.codes.every((c) => c === 'HINWEIS_FEHLT')) return 'hinweis';
  return 'nie';
}

// opt.mutiere(BEATS): verfaelscht die Katalogdaten im Speicher (Test); nach der Auswertung wird alles zurueckgesetzt, die Dateien bleiben unberuehrt
function matrix(opt) {
  const o = opt || {};
  const B = D.BEATS, sicher = klon(B);
  let ergebnis;
  try {
    if (o.mutiere) { o.mutiere(B); BP.katalogNeuLesen(); }
    const namen = planbar(), ab = abschlussName();
    const zellen = {}, abschluss = {};
    for (const a of namen) {
      zellen[a] = {};
      for (const b of namen) {
        const p0 = probe([a, b], null), p1 = p0.ok ? null : probe([a, b], 'z');
        zellen[a][b] = { klasse: klasse(p0, p1), ziel: p1 ? 'abschluss' : null, ohne: p0.codes, mit: p1 ? p1.codes : null, fehler: p0.fehler.concat(p1 ? p1.fehler : []) };
      }
    }
    for (const b of namen) { const p = probe([b], null); abschluss[b] = { klasse: p.ok ? 'ok' : p.codes.some(kontextCode) ? 'kontext' : (p.codes.every((c) => c === 'HINWEIS_FEHLT') ? 'hinweis' : 'nie'), codes: p.codes }; }
    const je = (k) => { const r = {}; for (const a of namen) r[a] = namen.filter((b) => zellen[a][b].klasse === k); return r; };
    const zaehl = {};
    for (const a of namen) for (const b of namen) zaehl[zellen[a][b].klasse] = (zaehl[zellen[a][b].klasse] || 0) + 1;
    ergebnis = { format: 'messung-paare/1', werkzeug: 'tools/messe-paare.js', beats: namen, abschluss_beat: ab, zellen, vor_abschluss: abschluss, nurV: je('nurV'), nie: je('nie'), kontext: je('kontext'), hinweis: je('hinweis'), zaehlung: zaehl };
  } finally {
    if (o.mutiere) {
      for (const k of Object.keys(B)) { for (const f of Object.keys(B[k])) delete B[k][f]; Object.assign(B[k], sicher[k]); }
      BP.katalogNeuLesen();
    }
  }
  return ergebnis;
}

// ---------- Ausgabe
const KUERZEL = { ok: 'ok', nurV: 'nurV', nie: 'nie', kontext: 'kontext', hinweis: 'hinweis' };
function paarListe(M, k) {
  const z = [];
  for (const a of M.beats) for (const b of M[k][a]) { const c = M.zellen[a][b]; z.push({ a, b, codes: c.mit && k === 'nie' ? c.mit : c.ohne, ohne: c.ohne, mit: c.mit }); }
  return z;
}
function text(M) {
  const n = M.beats, w = Math.max(...n.map((x) => x.length)) + 1;
  const zeilen = [];
  zeilen.push(`Paarmatrix: Zeile = A, Spalte = B (Plan [A, B, ${M.abschluss_beat}]); Spalten nummeriert in der Reihenfolge der Zeilen`);
  zeilen.push(n.map((x, i) => `${String(i + 1).padStart(2)} ${x}`).join(' · '));
  zeilen.push('');
  zeilen.push(''.padEnd(w + 4) + n.map((x, i) => String(i + 1).padStart(8)).join(''));
  n.forEach((a, i) => zeilen.push(`${String(i + 1).padStart(2)} ${a.padEnd(w + 1)}` + n.map((b) => KUERZEL[M.zellen[a][b].klasse].padStart(8)).join('')));
  zeilen.push('');
  zeilen.push('Zaehlung: ' + Object.entries(M.zaehlung).map(([k, v]) => `${k} ${v}`).join(', '));
  const liste = (titel, k) => {
    const l = paarListe(M, k);
    zeilen.push(''); zeilen.push(`${titel} (${l.length})`);
    for (const p of l) {
      if (k === 'nurV') zeilen.push(`  ${p.a} > ${p.b}: ohne ${p.ohne.join(', ')}; gueltig mit ${p.a}.verzweigung.gescheitert -> ${M.abschluss_beat}`);
      else if (k === 'nie') zeilen.push(`  ${p.a} > ${p.b}: ohne ${p.ohne.join(', ')}; mit ${p.a}.verzweigung.gescheitert -> ${M.abschluss_beat}: ${p.mit.join(', ') || '(gueltig)'}`);
      else zeilen.push(`  ${p.a} > ${p.b}: ${p.ohne.join(', ')}`);
    }
  };
  liste('nur mit Verzweigung', 'nurV'); liste('nie gueltig', 'nie'); liste('kontext (kein Urteil)', 'kontext'); liste('hinweis (HINWEIS_FEHLT)', 'hinweis');
  zeilen.push(''); zeilen.push(`Paare B direkt vor ${M.abschluss_beat} (Plan [B, ${M.abschluss_beat}], keine Verzweigungsprobe: jedes Ziel ist der Standardweg)`);
  for (const b of n) { const v = M.vor_abschluss[b]; zeilen.push(`  ${b} > ${M.abschluss_beat}: ${KUERZEL[v.klasse]}${v.codes.length ? ' (' + v.codes.join(', ') + ')' : ''}`); }
  return zeilen.join('\n') + '\n';
}
function markdown(M) {
  const n = M.beats, L = [];
  L.push('# Paarmatrix der Beat-Folgen (KAT-01)', '');
  L.push(`Zeile = A, Spalte = B, Plan [A, B, ${M.abschluss_beat}]. Probe 2: A.verzweigung.gescheitert -> ${M.abschluss_beat}. Kontext (Lage, NSC aus frueherem Faden) ist nicht Teil der Matrix.`, '');
  L.push('| A \\ B | ' + n.join(' | ') + ' |', '|---|' + n.map(() => '---').join('|') + '|');
  for (const a of n) L.push(`| **${a}** | ` + n.map((b) => KUERZEL[M.zellen[a][b].klasse]).join(' | ') + ' |');
  L.push('', 'Zaehlung: ' + Object.entries(M.zaehlung).map(([k, v]) => `${k} ${v}`).join(', '), '');
  const tab = (titel, k, kopf, zeile) => {
    const l = paarListe(M, k);
    L.push(`## ${titel} (${l.length})`, '');
    if (l.length) { L.push(kopf, '|---|---|---|'); for (const p of l) L.push(zeile(p)); } else L.push('keine');
    L.push('');
  };
  tab('Nur mit Verzweigung', 'nurV', '| Paar | Codes ohne Verzweigung | Probe 2 |', (p) => `| ${p.a} > ${p.b} | ${p.ohne.join(', ')} | gueltig mit ${p.a}.verzweigung.gescheitert -> ${M.abschluss_beat} |`);
  tab('Nie gueltig', 'nie', '| Paar | Codes ohne Verzweigung | Codes mit Verzweigung -> ' + M.abschluss_beat + ' |', (p) => `| ${p.a} > ${p.b} | ${p.ohne.join(', ')} | ${p.mit.join(', ')} |`);
  tab('Kontext (kein Urteil)', 'kontext', '| Paar | Codes | |', (p) => `| ${p.a} > ${p.b} | ${p.ohne.join(', ')} | |`);
  tab('Hinweis (HINWEIS_FEHLT)', 'hinweis', '| Paar | Codes | |', (p) => `| ${p.a} > ${p.b} | ${p.ohne.join(', ')} | |`);
  L.push(`## B direkt vor ${M.abschluss_beat}`, '', '| Paar | Kuerzel | Codes |', '|---|---|---|');
  for (const b of n) { const v = M.vor_abschluss[b]; L.push(`| ${b} > ${M.abschluss_beat} | ${KUERZEL[v.klasse]} | ${v.codes.join(', ')} |`); }
  return L.join('\n') + '\n';
}

function main(argv) {
  const arg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const ziele = {};
  for (const f of ['--json', '--md']) {
    if (argv.includes(f)) {
      const p = arg(f);
      if (!p || p.startsWith('--')) { console.error(`${f} braucht einen Dateipfad`); return 2; }
      const abs = path.resolve(process.cwd(), p), rel = path.relative(ROOT, abs);
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) { console.error(`${f}: ${p} liegt im Repo; Ausgaben gehoeren nie ins Repo`); return 2; }
      ziele[f] = abs;
    }
  }
  const M = matrix();
  process.stdout.write(text(M));
  if (ziele['--json']) { fs.mkdirSync(path.dirname(ziele['--json']), { recursive: true }); fs.writeFileSync(ziele['--json'], JSON.stringify(M, null, 2) + '\n'); }
  if (ziele['--md']) { fs.mkdirSync(path.dirname(ziele['--md']), { recursive: true }); fs.writeFileSync(ziele['--md'], markdown(M)); }
  return 0;
}

module.exports = { matrix, kontextCode, planFuer };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
