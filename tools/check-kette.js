'use strict';
// EK8: Prüfer für Kampagnenketten (content/kampagne/*.json) samt der Kapitel-Regiebücher.
//   node tools/check-kette.js            alle Ketten prüfen, Kapitelübersicht und Platzhalter ausgeben
//   node tools/check-kette.js --selftest kaputte Ketten (aus eisenwald erzeugt) müssen mit dem erwarteten Code abgelehnt werden
//   node tools/check-kette.js --json     Ergebnis als JSON
const Kampagne = require('../server/mission/kampagne.js');
const Loader = require('../server/mission/loader.js');
const args = process.argv.slice(2);
const json = args.includes('--json');
const out = (s) => { if (!json) console.log(s); };
let fail = 0;

const { books, invalid } = Loader.loadAll();
const result = { ketten: {}, platzhalter: [], buecher: {} };
for (const inv of invalid) { out(`Buch '${inv.id}' ungültig: ${inv.errors.slice(0, 3).map((e) => e.code + ' ' + e.p + ' ' + e.msg).join('; ')}`); fail++; }

for (const id of Kampagne.alleIds()) {
  let doc;
  try { doc = Kampagne.lesen(id); } catch (e) { out(`✗ ${id}: nicht lesbar (${e.message})`); fail++; continue; }
  const r = Kampagne.pruefen(doc, { books });
  result.ketten[id] = { ok: r.ok, errors: r.errors, warnings: r.warnings };
  out(`${r.ok ? '✓' : '✗'} Kampagne ${id}: ${r.errors.length} Fehler, ${r.warnings.length} Warnungen`);
  for (const e of r.errors) out(`    FEHLER ${e.code} ${e.p}: ${e.msg}`);
  for (const w of r.warnings) out(`    Warnung ${w.code} ${w.p}: ${w.msg}`);
  if (!r.ok) { fail++; continue; }
  out('');
  out('  Nr  Kapitel                    Bücher                 Ausgänge → Folge');
  for (const c of doc.kapitel) {
    const folge = Object.entries(c.ausgaenge).map(([a, f]) => `${a} → ${(Array.isArray(f) ? f : [f]).map((x) => (x.wiederholen ? 'wiederholen' : x.weiter)).join('/')}`).join(', ');
    const bl = Kampagne.buecherVon(c);
    out(`  ${String(c.nr).padStart(2)}  ${c.id.padEnd(26)} ${bl.join('+').padEnd(22)} ${folge}`);
    for (const b of bl) {
      const bk = books[b]; if (!bk) continue;
      result.buecher[b] = bk.steps.length;
      out(`        ${bk.steps.map((s) => s.id + (s.platzhalter ? '*' : '')).join(' > ')}`);
    }
  }
  result.platzhalter.push(...Kampagne.platzhalter(doc, books));
  out('');
  out(`  ${result.platzhalter.length} Platzhalter-Schritte (* = Stand-in, wird durch die echte Szene ersetzt):`);
  for (const p of result.platzhalter) out(`    ${p.kapitel}/${p.schritt} -> ${p.echt}`);
}

if (args.includes('--selftest')) {
  const base = Kampagne.lesen('eisenwald');
  const clone = () => JSON.parse(JSON.stringify(base));
  const kap = (d, id) => d.kapitel.find((c) => c.id === id);
  const cases = [
    ['Unbekanntes Buch', 'KETTE-BUCH', (d) => { kap(d, 'k2_konvoi').buecher = ['gibts_nicht']; }],
    ['Ausgang ohne Folge', 'KETTE-AUSGANG-FEHLT', (d) => { delete kap(d, 'k2_konvoi').ausgaenge.rueckzug; }],
    ['Folge für unbekannten Ausgang', 'KETTE-AUSGANG-UNBEKANNT', (d) => { kap(d, 'k1_anwerbung').ausgaenge.scheitern = { wiederholen: true }; }],
    ['Fortschritt ohne erreichtes Ziel', 'KETTE-FORTSCHRITT', (d) => { kap(d, 'k2_konvoi').ausgaenge.rueckzug = { weiter: 'k3_nebelheim' }; }],
    ['Kapitel nicht erreichbar', 'KETTE-UNERREICHBAR', (d) => { kap(d, 'k1_anwerbung').ausgaenge.erfolg = { weiter: 'k3_nebelheim' }; }],
    ['Ende nicht erreichbar', 'KETTE-KEIN-ENDE', (d) => { kap(d, 'k8_sieg').ausgaenge.erfolg = { weiter: 'k7_siedlung' }; }],
    ['Unbekanntes Ziel', 'KETTE-ZIEL', (d) => { kap(d, 'k1_anwerbung').ausgaenge.erfolg = { weiter: 'k9_nirgends' }; }],
    ['Rückfallfolge fehlt', 'KETTE-FOLGE', (d) => { kap(d, 'k2_konvoi').ausgaenge.erfolg = [{ weiter: 'k3_nebelheim', wenn: { flag: 'konvoi_gepluendert' } }]; }],
    ['Unbekannter Ort', 'REF-ORT', (d) => { kap(d, 'k3_nebelheim').ort = 'nebelhain'; }],
    ['Unbekannte Kante im Einstieg', 'KETTE-EINSTIEG', (d) => { kap(d, 'k5_legat').einstieg.oeffnet = ['gibts-nicht']; }],
    ['Platzhalter nicht im Buch markiert', 'KETTE-PLATZHALTER', (d) => { kap(d, 'k1_anwerbung').platzhalter = ['hafen']; }],
    ['Nummern nicht fortlaufend', 'KETTE-NR', (d) => { kap(d, 'k3_nebelheim').nr = 9; }],
    ['Folge ohne weiter/wiederholen', 'KETTE-FOLGE', (d) => { kap(d, 'k2_konvoi').ausgaenge.rueckzug = {}; }],
  ];
  let ok = 0;
  for (const [name, code, mut] of cases) {
    const d = clone(); mut(d);
    const r = Kampagne.pruefen(d, { books });
    const hit = r.errors.find((e) => e.code === code);
    out(`${hit ? '✓' : '✗'} ${name}: ${hit ? code : 'erwartet ' + code + ', bekommen ' + (r.errors.map((e) => e.code).join(', ') || 'keine Fehler')}`);
    if (hit) ok++; else fail++;
  }
  out(`${ok}/${cases.length} bestanden`);
}
if (json) console.log(JSON.stringify(result, null, 1));
else console.log(fail ? '\nKETTE FEHLERHAFT' : '\nKETTE OK');
process.exit(fail ? 1 : 0);
