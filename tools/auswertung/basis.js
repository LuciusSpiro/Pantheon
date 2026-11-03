'use strict';
// TEL-01 C: Basis-Datei der Bot-Laeufe. REINE Funktionen (kein I/O, keine Uhr, kein Zufall); den Lauf fahren und die Dateien schreiben tut tools/basis.js (npm run basis).
//
// Eine Basis-Gruppe = alle Laeufe mit gleichem Modus, Szenario und gleicher (bereinigter) Spielerzahl (gruppenId). Je Gruppe und Kennzahl steht die Statistik ueber die Basis-Seeds:
//   [n, min, q1, median, q3, max]      n = Zahl der Laeufe mit Wert; q3 - q1 (IQR) ist die Streuung, die bewertung.js abweichungGegenBasisGruppe nutzt
// Zaehler und Summen (summe: true in KENNZAHL_INFO, nicht die Einheit entscheidet): fehlt die Kennzahl in einem Lauf, waren es 0 Ereignisse und der Lauf zaehlt mit 0 (sonst wuerde "selten" wie "immer" aussehen).
// Quoten, Zeiten usw. fehlen einfach (kein Wert, kein Lauf in n). Kennzahlen mit determ: false (Technik) stehen NICHT in der Basis: sie gelten nur als Spitze.
//
// Dateiformat (tools/fixtures/telemetrie/basis-<plattform>.json):
//   { version: BASIS_VERSION,
//     kopf: { spielstand_wie, commit, plattform, node, kennzahl_version, tuning_hash, datum, seeds, jobs, laufzeit_s, fehlerlaeufe, schwelle: { streuung_k, rel } },
//     gruppen: { '<gruppenId>': { id, name, modus, szenario, spieler, befehl, seeds: [..], laeufe, fehlerlaeufe, am_limit?, ausgang: { ... }, kz: { '<schluessel>': [n, min, q1, med, q3, max] } } } }
//   fehlerlaeufe: Laeufe ohne gueltige Session oder mit Prozessabbruch (fehlerlauf()); sie stehen NICHT in der Statistik und werden hier nur gezaehlt.
//   am_limit: alle Laeufe der Gruppe enden am Zeitlimit (amLimit()); dann sind die Spannen der Gruppe kein Balance-Mass.
// Keine listen.reihen, keine Rohprotokolle, keine Namen. Gueltigkeit (pruefen): Kennzahl-Version passt, jede Kennzahl hat einen Info-Eintrag; ein geaenderter Vertrag macht test-basis rot.

const { flach, infoZu, KENNZAHL_VERSION } = require('./kennzahlen.js');
const { STREUUNG_K, MIN_BASIS_N, amLimitText } = require('./bewertung.js');

const BASIS_VERSION = 1;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const r3 = (v) => Math.round(v * 1000) / 1000;
const LIMIT_TOLERANZ_S = 1;   // am_limit: so nah liegen die Sessiondauern aller Laeufe beieinander (Bot-Laeufe sind je Seed verschieden lang, nur ein gemeinsames Zeitlimit macht sie gleich lang)
const LIMIT_MIN_LAEUFE = 3;

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
    const fuell = !!i.summe;
    const st = statistik(flache.map((f) => (num(f[k]) ? f[k] : (fuell ? 0 : null))));
    if (st) kz[k] = st;
  }
  const ausgang = {};
  for (const l of laeufe) ausgang[l.ausgang || 'ok'] = (ausgang[l.ausgang || 'ok'] || 0) + 1;
  const dauer = flache.map((f) => f['f1.dauer.session']);
  const limit = amLimit(dauer);
  return Object.assign({
    id: gruppenId(kopf), modus: kopf.modus, szenario: kopf.szenario || null, spieler: kopf.spielerzahl,
    seeds: laeufe.map((l) => l.seed), laeufe: laeufe.length, ausgang, am_limit: limit ? true : undefined, dauer_median_s: (statistik(dauer) || [])[3] == null ? null : statistik(dauer)[3], kz,
  }, meta || {});
}

// S4: alle Laeufe enden am selben Zeitlimit (Sessiondauern auf LIMIT_TOLERANZ_S gleich, mindestens LIMIT_MIN_LAEUFE Laeufe). Nur ein gemeinsames Limit macht Bot-Laeufe verschiedener Seeds gleich lang;
// der Bot schafft das Szenario dann nicht (Grabenangriff zu dritt), und die Spannen der Kennzahlen sind kein Balance-Mass.
function amLimit(dauern) {
  const d = (dauern || []).filter(num);
  return d.length >= LIMIT_MIN_LAEUFE && d.length === (dauern || []).length && Math.max(...d) - Math.min(...d) <= LIMIT_TOLERANZ_S;
}

// S3: Ein Lauf, dessen Prozess abgebrochen wurde (Absturz, Zeitueberschreitung, Signal), ist ein Fehlerlauf und geht nicht in die Statistik. Erkennbar am Ende der Session: grund 'prozessende'
// (der Prozess-Haken schloss die Session, der Bot hat sie nicht selbst mit 'bot-ende' beendet) UND ein Exit-Code ausser 0/1 (0 = Bot-Ziel erreicht, 1 = FEHLGESCHLAGEN, beides sind Ergebnisse des Bots;
// kein Code = vom Werkzeug beendet, also ohne Bot-Ergebnis). Rueckgabe Text oder null.
function fehlerlauf(grund, exitCode) {
  if (grund !== 'prozessende') return null;
  return exitCode === 0 || exitCode === 1 ? null : 'Prozess abgebrochen (Session endet mit prozessende, Exit ' + (exitCode == null ? 'ohne Code' : exitCode) + ', kein Bot-Ergebnis)';
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
// Text fuer den Bericht, wenn es keine passende Gruppe gibt. K1: nur Gruppen mit gleichem Modus oder Szenario, hoechstens KEINE_GRUPPE_MAX (spart Berichtszeilen)
const KEINE_GRUPPE_MAX = 5;
function keineGruppe(basis, kzKopf) {
  const k = kzKopf || {};
  const aehnlich = Object.keys((basis && basis.gruppen) || {}).filter((id) => { const g = basis.gruppen[id]; return (k.modus != null && g.modus === k.modus) || (k.szenario && g.szenario === k.szenario); });
  return 'keine passende Basis-Gruppe (' + gruppenId(kzKopf) + '; ' + (aehnlich.length ? 'gleicher Modus oder Szenario: ' + aehnlich.slice(0, KEINE_GRUPPE_MAX).join(', ') + (aehnlich.length > KEINE_GRUPPE_MAX ? ', ...' : '') : 'keine mit gleichem Modus oder Szenario') + ')';
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
// S6: Ergebnis der Rueckwaertsprobe (einmalig gefahren, Zahlen stehen als Text hier; sie veralten mit einer neuen Basis, der Text sagt das)
const EINZELLAUF_ERKENNT = ["## Was der Einzellauf gegen die Basis erkennt","","Rückwärtsprobe, Stand 2026-11-03 (nach S1/S2): je Gruppe 6 frische Läufe mit den Seeds 101–106 (96 Läufe, nicht Teil der Basis); in einer Kopie der Kennzahlen wird EINE Kennzahl künstlich verschoben und gezählt, ob die Bewertung genau diese meldet (Fälle = Kennzahl × Lauf). Die Probe liegt nicht im Repo und veraltet mit jeder neuen Basis.","","**Fehlalarme** (frischer Lauf, nichts verschoben): im Mittel 0,71 Kennzahlen je Lauf, 20 von 96 Läufen mit mindestens einer. Je Gruppe 0 bis 1,7, nur Wellen Ruine fällt auf (3,5 solo und 2,3 zu dritt: je ein Lauf mit 19 bzw. 14 Kennzahlen bei einem ungewöhnlich langen Gefecht).","","| Verschobene Kennzahl | Graben | Raumkampf-Arena | Kampagne | Kesh | Wellen |","|---|---|---|---|---|---|","| Quote eigene x1,5 (max 100) | 50 % (6/12) | 0 % (0/18) | 0 % (0/13) | 17 % (2/12) | 24 % (25/103) |","| Quote eigene x0,5 | 50 % (6/12) | 79 % (19/24) | 100 % (24/24) | 58 % (7/12) | 24 % (28/117) |","| Quote Gegner x1,5 (max 100) | 71 % (12/17) | - | - | 0 % (0/10) | 2 % (3/131) |","| Quote Gegner x0,5 | 100 % (18/18) | - | - | 17 % (2/12) | 25 % (57/230) |","| Schaden aus roh x2 | 100 % (6/6) | 50 % (6/12) | 75 % (9/12) | 33 % (2/6) | 18 % (11/60) |","| Schaden ein roh x2 | 100 % (6/6) | 0 % (0/12) | 8 % (1/12) | 0 % (0/6) | 22 % (13/60) |","| Zeit bis Kill x2 | 92 % (11/12) | 49 % (18/37) | 63 % (30/48) | 33 % (3/9) | 31 % (54/174) |","| Zeit bis Kill x1,5 | 0 % (0/12) | 19 % (7/37) | 35 % (17/48) | 11 % (1/9) | 7 % (12/174) |","| Sessiondauer +30 % | 100 % (6/6) | 33 % (4/12) | 8 % (1/12) | 0 % (0/6) | 2 % (1/60) |","| Sessiondauer -30 % | 100 % (6/6) | 8 % (1/12) | 25 % (3/12) | 33 % (2/6) | 0 % (0/60) |","| Kills gesamt x0,5 | 100 % (6/6) | 0 % (0/11) | 8 % (1/12) | 0 % (0/6) | 2 % (1/59) |","| Gefallen n x2 | 100 % (6/6) | - | - | 0 % (0/5) | 7 % (4/60) |","","- **Meist erkannt:** halbierte eigene Quote (Kampagne 100 %, Raumkampf 79 %), verdoppelte Zeit bis Kill im Graben (92 %) und in der Kampagne (63 %), verdoppelter eigener Schaden im Graben (100 %) und in der Kampagne (75 %).","- **Meist nicht erkannt:** Dauer ±30 % (nur im Graben 100 %, aber dort enden alle Läufe am Zeitlimit: kein Balance-Befund), eigener Schaden ×2 außer in Graben, Kampagne und Raumkampf (Wellen 18 %, Kesh 33 %), erlittener Schaden ×2 außer im Graben, halbierte Kills, um die Hälfte höhere Quoten, Gegnerquote außer im Graben. Zeit bis Kill ×1,5 fällt in den meisten Gruppen durch.","- Grund: Mit 12 Seeds fasst die Spanne Min–Max schon fast jeden Wert ein, und die Streuung weitet den Normalbereich zusätzlich. Das ist Absicht (wenige Fehlalarme), kostet aber Trefferquote.","- **Der Einzellauf ist ein Rauchmelder für grobe Brüche und Datenfehler, kein Balance-Messgerät.** Für Balance-Änderungen Gruppe gegen Gruppe vergleichen (`npm run vergleich`, Paket D2; Kerben nach McGill, die mit der Zahl der Läufe schärfer werden).",""];
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
    '- ' + (k.seeds || '?') + ' Seeds je Gruppe, Laufzeit ' + zeitText(k.laufzeit_s) + ' (' + (k.jobs || '?') + ' Prozesse parallel)' + (k.fehlerlaeufe ? ', **' + k.fehlerlaeufe + ' Fehlerlauf/-läufe** (Prozess abgebrochen oder keine gültige Session; nicht in der Statistik)' : ', keine Fehlerläufe') + '.',
    '- Schwelle für „auffällig“ (Bericht): Abstand zur Spanne Min–Max der Basis-Seeds größer als max(' + Math.round(100 * ((k.schwelle || {}).rel || 0.25)) + ' %, ' + String((k.schwelle || {}).streuung_k || STREUUNG_K).replace('.', ',') + ' × IQR) UND Abstand zum Median mindestens die Mindestmenge der Kennzahl (innerhalb der Spanne ist nie etwas auffällig). Technik (Tickzeit, Snapshot) steht nicht in der Basis.',
    '- Schreibweise: `Schlüssel Median [Min–Max]`; fehlende Zähler und Summen (`summe: true` in KENNZAHL_INFO) gelten als 0, Quoten, Mittel und Mediane fehlen einfach (Kennzahlen mit weniger als ' + MIN_BASIS_N + ' Läufen in der Basis werden nicht verglichen). Ausgang `rot` = das Bot-Skript meldete Misserfolg (kein Sieg, Softlock); das Protokoll ist gültig und zählt mit.',
    '',
    ...EINZELLAUF_ERKENNT,
    '| Gruppe | Läufe | Ausgang | Spielzeit (Median) |',
    '|---|---|---|---|',
  ];
  for (const id of Object.keys(basis.gruppen)) {
    const g = basis.gruppen[id];
    z.push('| `' + id + '` ' + (g.name ? g.name : '') + ' | ' + g.laeufe + ' | ' + Object.keys(g.ausgang || {}).sort().map((a) => a + ' ' + g.ausgang[a]).join(', ') + ' | ' + zeitText(g.dauer_median_s) + ' |');
  }
  for (const id of Object.keys(basis.gruppen)) {
    const g = basis.gruppen[id];
    z.push('', '## ' + id + (g.name ? ' – ' + g.name : ''), '', '`' + (g.befehl || '') + '` · Seeds ' + (g.seeds.length ? g.seeds[0] + '–' + g.seeds[g.seeds.length - 1] : '-') + ' · ' + g.laeufe + ' Läufe' + (g.fehlerlaeufe ? ' · ' + g.fehlerlaeufe + ' Fehlerlauf/-läufe nicht gezählt' : ''), '');
    if (g.am_limit) z.push('> [!warning] ' + amLimitText(g.modus).charAt(0).toUpperCase() + amLimitText(g.modus).slice(1) + '.', '');
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

module.exports = { BASIS_VERSION, KEINE_GRUPPE_MAX, statistik, quantil, gruppenId, amLimit, fehlerlauf, gruppeBauen, basisBauen, gruppeWaehlen, keineGruppe, pruefen, basisMarkdown };
