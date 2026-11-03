'use strict';
// TEL-01 C: Basis-Datei der Bot-Laeufe. REINE Funktionen (kein I/O, keine Uhr, kein Zufall); den Lauf fahren und die Dateien schreiben tut tools/basis.js (npm run basis).
//
// Eine Basis-Gruppe = alle Laeufe mit gleichem Modus, Szenario und gleicher (bereinigter) Spielerzahl (gruppenId). Je Gruppe und Kennzahl steht die Statistik ueber die Basis-Seeds:
//   [n, min, q1, median, q3, max]      n = Zahl der Laeufe mit Wert; q3 - q1 (IQR) ist die Streuung, die bewertung.js abweichungGegenBasisGruppe nutzt
// Zaehleinheiten (n, stueck): fehlt die Kennzahl in einem Lauf, waren es 0 Ereignisse und der Lauf zaehlt mit 0 (sonst wuerde "selten" wie "immer" aussehen).
// Quoten, Zeiten usw. fehlen einfach (kein Wert, kein Lauf in n). Kennzahlen mit determ: false (Technik) stehen NICHT in der Basis: sie gelten nur als Spitze.
//
// Dateiformat (tools/fixtures/telemetrie/basis-<plattform>.json):
//   { version: BASIS_VERSION,
//     kopf: { spielstand_wie, commit, plattform, node, kennzahl_version, tuning_hash, datum, seeds, jobs, laufzeit_s, schwelle: { streuung_k, rel } },
//     gruppen: { '<gruppenId>': { id, name, modus, szenario, spieler, befehl, seeds: [..], laeufe, ausgang: { ... }, kz: { '<schluessel>': [n, min, q1, med, q3, max] } } } }
// Keine listen.reihen, keine Rohprotokolle, keine Namen. Gueltigkeit (pruefen): Kennzahl-Version passt, jede Kennzahl hat einen Info-Eintrag; ein geaenderter Vertrag macht test-basis rot.

const { flach, infoZu, KENNZAHL_VERSION } = require('./kennzahlen.js');
const { ZAEHL_EINHEITEN, STREUUNG_K } = require('./bewertung.js');

const BASIS_VERSION = 1;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const r3 = (v) => Math.round(v * 1000) / 1000;

// Quantil mit linearer Interpolation (sortierte Liste)
function quantil(s, q) {
  if (!s.length) return null;
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
// [n, min, q1, median, q3, max] (auf 3 Stellen gerundet); null ohne Werte
function statistik(werte) {
  const s = werte.filter(num).sort((x, y) => x - y);
  if (!s.length) return null;
  return [s.length, s[0], quantil(s, 0.25), quantil(s, 0.5), quantil(s, 0.75), s[s.length - 1]].map((v, i) => (i === 0 ? v : r3(v)));
}

// Gruppenschluessel eines Laufs aus dem Kopfauszug der Kennzahlen (kz.kopf): Modus, Szenario (Karte der Wellen), bereinigte Spielerzahl
function gruppenId(kopf) {
  const k = kopf || {};
  return String(k.modus == null ? 'unbekannt' : k.modus) + (k.szenario ? '/' + k.szenario : '') + '/' + (num(k.spielerzahl) ? k.spielerzahl : '?');
}

// Gruppe aus den Kennzahlen mehrerer Laeufe: laeufe = [{ seed, kz, ausgang }]
function gruppeBauen(laeufe, meta) {
  const kopf = laeufe[0].kz.kopf;
  const flache = laeufe.map((l) => flach(l.kz));
  const schluessel = new Set();
  for (const f of flache) for (const k of Object.keys(f)) { const i = infoZu(k); if (i && i.determ !== false) schluessel.add(k); }
  const kz = {};
  for (const k of [...schluessel].sort()) {
    const i = infoZu(k);
    const fuell = ZAEHL_EINHEITEN.has(i.einheit);
    const st = statistik(flache.map((f) => (num(f[k]) ? f[k] : (fuell ? 0 : null))));
    if (st) kz[k] = st;
  }
  const ausgang = {};
  for (const l of laeufe) ausgang[l.ausgang || 'ok'] = (ausgang[l.ausgang || 'ok'] || 0) + 1;
  const dauer = flache.map((f) => f['f1.dauer.session']);
  return Object.assign({
    id: gruppenId(kopf), modus: kopf.modus, szenario: kopf.szenario || null, spieler: kopf.spielerzahl,
    seeds: laeufe.map((l) => l.seed), laeufe: laeufe.length, ausgang, dauer_median_s: (statistik(dauer) || [])[3] == null ? null : statistik(dauer)[3], kz,
  }, meta || {});
}

// Basis-Datei aus Gruppen (id -> Gruppe) und Kopfdaten (vom Aufrufer: Commit, Plattform, Datum ... aus der Uhr/Umgebung)
function basisBauen(gruppen, kopf) {
  const g = {};
  for (const id of Object.keys(gruppen).sort()) g[id] = gruppen[id];
  return { version: BASIS_VERSION, kopf: Object.assign({ kennzahl_version: KENNZAHL_VERSION, schwelle: { streuung_k: STREUUNG_K, rel: 0.25 } }, kopf || {}), gruppen: g };
}

// Passende Gruppe zu einem Lauf: gleiche gruppenId wie der Lauf. Rueckgabe { id, laeufe, seeds, kz, kopf } (fuer bewertung.js opt.basisGruppe) oder null
function gruppeWaehlen(basis, kzKopf) {
  if (!basis || !basis.gruppen) return null;
  const id = gruppenId(kzKopf);
  const g = Object.prototype.hasOwnProperty.call(basis.gruppen, id) ? basis.gruppen[id] : null;
  return g ? Object.assign({}, g, { id, kopf: basis.kopf }) : null;
}
// Text fuer den Bericht, wenn es keine passende Gruppe gibt
function keineGruppe(basis, kzKopf) {
  return 'keine passende Basis-Gruppe (' + gruppenId(kzKopf) + '; vorhanden: ' + Object.keys((basis && basis.gruppen) || {}).join(', ') + ')';
}

// Gueltigkeit der eingecheckten Basis gegen den aktuellen Vertrag: Liste der Probleme (leer = gueltig)
function pruefen(basis) {
  const p = [];
  if (!basis || typeof basis !== 'object' || !basis.gruppen || !basis.kopf) return ['keine Basis-Datei (kopf/gruppen fehlen)'];
  if (basis.version !== BASIS_VERSION) p.push('Basis-Format ' + basis.version + ' statt ' + BASIS_VERSION);
  if (basis.kopf.kennzahl_version !== KENNZAHL_VERSION) p.push('Kennzahl-Version ' + basis.kopf.kennzahl_version + ' in der Basis, aktuell ' + KENNZAHL_VERSION);
  for (const id of Object.keys(basis.gruppen)) {
    const g = basis.gruppen[id];
    if (g.id !== id) p.push(id + ': Gruppen-ID stimmt nicht');
    if ('listen' in g || 'reihen' in g) p.push(id + ': enthaelt Listen/Reihen (gehoert nicht in die Basis)');
    for (const k of Object.keys(g.kz || {})) {
      const s = g.kz[k];
      const info = infoZu(k);
      if (!info) p.push(id + ': Kennzahl ' + k + ' hat keinen Info-Eintrag');
      else if (info.determ === false) p.push(id + ': nicht deterministische Kennzahl ' + k + ' gehoert nicht in die Basis');
      if (!Array.isArray(s) || s.length !== 6 || !s.every(num)) p.push(id + ': ' + k + ' ist keine Statistik [n, min, q1, med, q3, max]');
      else if (!(s[1] <= s[2] && s[2] <= s[3] && s[3] <= s[4] && s[4] <= s[5])) p.push(id + ': ' + k + ' Statistik nicht geordnet');
    }
  }
  return p.slice(0, 20);
}

// ---------- Basis-Bericht (Markdown) ----------
const n1 = (v) => (num(v) ? String(Math.round(v * 10) / 10).replace('.', ',') : '-');
const zahl = (v) => (num(v) ? String(Math.round(v * 100) / 100).replace('.', ',') : '-');
const zeitText = (s) => (num(s) ? (s < 120 ? n1(s) + ' s' : Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0') + ' min') : '-');
const FRAGEN = [['1', 'F1 Dauer und Ausgang'], ['2', 'F2 Gefecht'], ['2b', 'F2b Deckung'], ['3', 'F3 Verluste'], ['4', 'F4 Rollen'], ['5', 'F5 Wirtschaft'], ['6', 'F6 Technik (deterministischer Teil)']];
function umbruch(text, max) {
  const out = [];
  let rest = text;
  while (rest.length > max) {
    let i = rest.lastIndexOf(' · ', max);
    if (i < 20) i = max;
    out.push(rest.slice(0, i));
    rest = '  ' + rest.slice(i).replace(/^ · /, '');
  }
  out.push(rest);
  return out;
}

// Eine Seite je Gruppe, kompakt: Kopf (Laeufe, Seeds, Ausgang, Dauer), dann je Frage "Schluessel Median [Min-Max]" in dichten Zeilen. Zahlen aus der Datei, nichts von Hand.
function basisMarkdown(basis) {
  const k = basis.kopf || {};
  const z = [
    '# Basis-Bericht der Bot-Läufe (' + (k.plattform || '?') + ')',
    '',
    'Erzeugt aus `basis-' + (k.plattform || '?') + '.json` (`npm run basis`), ersetzt die Handtabellen der README. Gilt nur für **' + (k.plattform || '?') + '**: auf anderer Plattform ist der Raumkampf nicht bit-gleich, der Bericht meldet das als Datenzeile.',
    '',
    '- Spielstand wie `' + (k.spielstand_wie || '?') + '` (Commit der Läufe `' + String(k.commit || '?').slice(0, 8) + '`), Node ' + (k.node || '?') + ', Kennzahl-Version ' + k.kennzahl_version + ', Tuning-Hash `' + (k.tuning_hash || '?') + '`, Stand ' + (k.datum || '?') + '.',
    '- ' + (k.seeds || '?') + ' Seeds je Gruppe, Laufzeit ' + zeitText(k.laufzeit_s) + ' (' + (k.jobs || '?') + ' Prozesse parallel).',
    '- Schwelle für „auffällig“ (Bericht): Abstand zur Spanne Min–Max der Basis-Seeds größer als max(' + Math.round(100 * ((k.schwelle || {}).rel || 0.25)) + ' %, ' + String((k.schwelle || {}).streuung_k || STREUUNG_K).replace('.', ',') + ' × IQR) UND Abstand zum Median mindestens die Mindestmenge der Kennzahl (innerhalb der Spanne ist nie etwas auffällig). Technik (Tickzeit, Snapshot) steht nicht in der Basis.',
    '- Schreibweise: `Schlüssel Median [Min–Max]`; fehlende Zähler gelten als 0. Ausgang `rot` = das Bot-Skript meldete Misserfolg (kein Sieg, Softlock); das Protokoll ist gültig und zählt mit.',
    '',
    '| Gruppe | Läufe | Ausgang | Spielzeit (Median) |',
    '|---|---|---|---|',
  ];
  for (const id of Object.keys(basis.gruppen)) {
    const g = basis.gruppen[id];
    z.push('| `' + id + '` ' + (g.name ? g.name : '') + ' | ' + g.laeufe + ' | ' + Object.keys(g.ausgang || {}).sort().map((a) => a + ' ' + g.ausgang[a]).join(', ') + ' | ' + zeitText(g.dauer_median_s) + ' |');
  }
  for (const id of Object.keys(basis.gruppen)) {
    const g = basis.gruppen[id];
    z.push('', '## ' + id + (g.name ? ' – ' + g.name : ''), '', '`' + (g.befehl || '') + '` · Seeds ' + (g.seeds.length ? g.seeds[0] + '–' + g.seeds[g.seeds.length - 1] : '-') + ' · ' + g.laeufe + ' Läufe', '');
    for (const [frage, titel] of FRAGEN) {
      const eintraege = Object.keys(g.kz).filter((s) => (infoZu(s) || {}).frage === frage).map((s) => {
        const [, mn, , med, , mx] = g.kz[s];
        return s.replace(/^f[0-9b]+\./, '') + ' ' + zahl(med) + (mn === mx ? '' : ' [' + zahl(mn) + '–' + zahl(mx) + ']');
      });
      if (!eintraege.length) continue;
      z.push(...umbruch('- **' + titel + ':** ' + eintraege.join(' · '), 160));
    }
  }
  return z.join('\n') + '\n';
}

module.exports = { BASIS_VERSION, statistik, quantil, gruppenId, gruppeBauen, basisBauen, gruppeWaehlen, keineGruppe, pruefen, basisMarkdown };
