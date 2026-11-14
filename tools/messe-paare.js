'use strict';
// KAT-01 Paket 0.1 (A: Kern nach server/sim/faden-paare.js verschoben, dieses Werkzeug ist der duenne Aufrufer fuer Konsole, --json, --md): Paarmatrix der Beat-Folgen – welches Paar `A direkt vor B` besteht den Bauplan-Pruefer, welches nur mit Verzweigung, welches nie (reine Auswertung, kein Spiel, kein Netz, kein Claude-Aufruf).
//   node tools/messe-paare.js [--json <datei>] [--md <datei>]          npm run messe:paare
// Planbar sind alle Beats mit `bauplan`, ohne `nur_inszenierer`, ohne `abschluss` (Quelle: server/sim/faden-daten.js = content/faeden/beats.json). Je geordnetes Paar (A, B, auch A = B) wird der Plan [A, B, abschluss]
// ueber denselben Weg geprueft wie Claudes Antwort (faden-bauplan.js pruefe: Expander, dann Pruefer). Dazu die Paare `B direkt vor abschluss` (Plan [B, abschluss]).
// Je Paar zwei Proben: (1) ohne Verzweigung, (2) mit A.verzweigung.gescheitert -> abschluss (B waere der Standardweg, kein Ziel); bei [B, abschluss] ist jede Verzweigung der Standardweg, also nur Probe 1.
// Beats B mit Optionen-Pflicht (bauplan.optionen_pflicht, aus den Daten): Annehmen und Ablehnen duerfen nicht in denselben Beat fuehren. Im Dreier-Plan steht B direkt vor dem abschluss, dort ist fuer B kein Ziel moeglich. Deshalb bekommen
// solche B zusaetzlich den Vierer-Plan [A, B, C, abschluss] mit einem Neutralbeat C: Probe 3 = B.verzweigung.gescheitert -> abschluss (A ohne Verzweigung), Probe 4 = A.verzweigung und B.verzweigung (beide -> abschluss).
// Neutralbeat C je B: der erste Beat in Katalogreihenfolge, der planbar ist, ohne Optionen-Pflicht, dessen braucht nur nsc_status kennt (keine Lage, Wahrheit, Hinweis, nsc_alt, Fluchtziel, Landeplatz) und dessen nsc_status ALLE Endzustaende von B
// (gelungen und gescheitert) zulaesst; gibt es keinen, der erste mit allen Zustaenden von B.gelungen (nur der Weg nach C ist dann der Gelungen-Ausgang). Die Wahl steht je B in der Ausgabe (neutral, neutral_regel).
// Beats mit Optionen bekommen optionen:true, Beats mit braucht.landeplatz einen Landeplatz im Plan (erste passende Kartenart). Kontext (Lage, Wahrheit-Hinweise, NSC aus frueherem Faden) ist NICHT Teil der Matrix.
// Kuerzel: ok (ohne Verzweigung gueltig) · nurV (nur mit Verzweigung gueltig, Ort der Verzweigung A, B oder A+B) · nie (in keiner Probe gueltig) · kontext (scheitert an einem Kontext-Code, kein Urteil ueber den Zustand) · hinweis (nur HINWEIS_FEHLT).
// Kontext-Codes werden aus den Code-Namen von faden-bauplan.js/faden-pruefer.js abgeleitet (Praefixe LAGE_, SABOTAGE_, NSC_ALT_, NSC_VON); SABOTAGE_NUR_EINMAL ist eine Planregel (sabotage zweimal), kein Kontext.
// Ausgabe: Konsole; --json/--md relativ zum Aufrufer, nie im Repo (Exit 2). Das Modul exportiert nur reine Funktionen: matrix, kontextCode, planFuer. main() nur beim direkten Start. Exit 0.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { matrix, kontextCode, planFuer } = require('../server/sim/faden-paare.js');   // KAT-01 A: der Kern liegt in server/sim (der Katalog nutzt ihn); hier nur Aufruf und Ausgabe


// ---------- Ausgabe
const KUERZEL = { ok: 'ok', nurV: 'nurV', nie: 'nie', kontext: 'kontext', hinweis: 'hinweis' };
function paarListe(M, k) {
  const z = [];
  for (const a of M.beats) for (const b of M[k][a]) { const c = M.zellen[a][b]; z.push({ a, b, codes: k === 'nie' ? c.letzte : c.ohne, ohne: c.ohne, mit: c.mit, mitB: c.mitB, beide: c.beide, ort: c.ort }); }
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
      if (k === 'nurV') zeilen.push(`  ${p.a} > ${p.b}: ohne ${p.ohne.join(', ')}; Verzweigung noetig bei ${p.ort}${p.ort === 'A' ? '' : ' (Vierer-Plan mit ' + M.neutral[p.b].beat + ')'}`);
      else if (k === 'nie') zeilen.push(`  ${p.a} > ${p.b}: ohne ${p.ohne.join(', ')}; mit A.verzweigung: ${p.mit.join(', ')}` + (p.mitB ? `; mit B.verzweigung (Vierer-Plan, C = ${M.neutral[p.b].beat}): ${p.mitB.join(', ')}; beide: ${p.beide.join(', ')}` : ''));
      else zeilen.push(`  ${p.a} > ${p.b}: ${p.ohne.join(', ')}`);
    }
  };
  liste('nur mit Verzweigung', 'nurV'); liste('nie gueltig', 'nie'); liste('kontext (kein Urteil)', 'kontext'); liste('hinweis (HINWEIS_FEHLT)', 'hinweis');
  zeilen.push(''); zeilen.push('Verzweigung noetig bei (je A: Ort der Verzweigung, dann die B)');
  for (const a of n) { const v = M.verzweigung_noetig_bei[a]; const t = ['A', 'B', 'A+B'].filter((o) => v[o].length).map((o) => `${o}: ${v[o].join(', ')}`); if (t.length) zeilen.push(`  ${a}: ${t.join(' | ')}`); }
  zeilen.push(''); zeilen.push('Neutralbeat C je B mit Optionen-Pflicht (Plan [A, B, C, abschluss])');
  for (const b of Object.keys(M.neutral)) zeilen.push(`  ${b}: C = ${M.neutral[b].beat}  (${M.neutral[b].regel})`);
  zeilen.push(''); zeilen.push(`vor_abschluss: B direkt vor ${M.abschluss_beat} ist nie fuer ${M.vor_abschluss_nie.map((v) => v.beat).join(', ')}; Beats mit Optionen-Pflicht: ${Object.keys(M.neutral).join(', ')}`);
  for (const v of M.vor_abschluss_nie) zeilen.push(`  ${v.beat} > ${M.abschluss_beat}: ${v.codes.join(', ')} (Annehmen und Ablehnen fuehren beide in den ${M.abschluss_beat}: die Wahl aendert den Weg nicht)`);
  zeilen.push(''); zeilen.push(`Paare B direkt vor ${M.abschluss_beat} (Plan [B, ${M.abschluss_beat}], keine Verzweigungsprobe: jedes Ziel ist der Standardweg)`);
  for (const b of n) { const v = M.vor_abschluss[b]; zeilen.push(`  ${b} > ${M.abschluss_beat}: ${KUERZEL[v.klasse]}${v.codes.length ? ' (' + v.codes.join(', ') + ')' : ''}`); }
  return zeilen.join('\n') + '\n';
}
function markdown(M) {
  const n = M.beats, L = [];
  L.push('# Paarmatrix der Beat-Folgen (KAT-01)', '');
  L.push(`Zeile = A, Spalte = B, Plan [A, B, ${M.abschluss_beat}]. Proben: 1 ohne Verzweigung, 2 A.verzweigung.gescheitert -> ${M.abschluss_beat}; fuer B mit Optionen-Pflicht 3 B.verzweigung (Plan [A, B, C, ${M.abschluss_beat}]), 4 beide. Kontext (Lage, NSC aus frueherem Faden) ist nicht Teil der Matrix.`, '');
  L.push('| A \\ B | ' + n.join(' | ') + ' |', '|---|' + n.map(() => '---').join('|') + '|');
  for (const a of n) L.push(`| **${a}** | ` + n.map((b) => KUERZEL[M.zellen[a][b].klasse]).join(' | ') + ' |');
  L.push('', 'Zaehlung: ' + Object.entries(M.zaehlung).map(([k, v]) => `${k} ${v}`).join(', '), '');
  const tab = (titel, k, kopf, zeile) => {
    const l = paarListe(M, k);
    L.push(`## ${titel} (${l.length})`, '');
    if (l.length) { L.push(kopf, '|---|---|---|'); for (const p of l) L.push(zeile(p)); } else L.push('keine');
    L.push('');
  };
  tab('Nur mit Verzweigung', 'nurV', '| Paar | Codes ohne Verzweigung | Verzweigung noetig bei |', (p) => `| ${p.a} > ${p.b} | ${p.ohne.join(', ')} | ${p.ort} |`);
  tab('Nie gueltig', 'nie', '| Paar | Codes ohne Verzweigung | Codes mit Verzweigung (letzte Probe) |', (p) => `| ${p.a} > ${p.b} | ${p.ohne.join(', ')} | ${p.codes.join(', ')} |`);
  tab('Kontext (kein Urteil)', 'kontext', '| Paar | Codes | |', (p) => `| ${p.a} > ${p.b} | ${p.ohne.join(', ')} | |`);
  tab('Hinweis (HINWEIS_FEHLT)', 'hinweis', '| Paar | Codes | |', (p) => `| ${p.a} > ${p.b} | ${p.ohne.join(', ')} | |`);
  L.push('## Verzweigung noetig bei', '', '| A | Ort A | Ort B | Ort A+B |', '|---|---|---|---|');
  for (const a of n) { const v = M.verzweigung_noetig_bei[a]; if (v.A.length || v.B.length || v['A+B'].length) L.push(`| ${a} | ${v.A.join(', ')} | ${v.B.join(', ')} | ${v['A+B'].join(', ')} |`); }
  L.push('', '## Neutralbeat C (B mit Optionen-Pflicht)', '');
  for (const b of Object.keys(M.neutral)) L.push(`- ${b}: C = ${M.neutral[b].beat} (${M.neutral[b].regel})`);
  L.push('', `## B direkt vor ${M.abschluss_beat}`, '', `nie fuer: ${M.vor_abschluss_nie.map((v) => v.beat + ' (' + v.codes.join(', ') + ')').join(', ')} (Annehmen und Ablehnen fuehren beide in den ${M.abschluss_beat})`, '', '| Paar | Kuerzel | Codes |', '|---|---|---|');
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
