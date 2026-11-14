'use strict';
// REF-02 Paket 0: fuehrt die Ablagen mehrerer `messe-abenteuer --out`-Laeufe zu EINER Messung zusammen (reine Auswertung, kein Spiel, kein Netz, kein Claude-Aufruf).
// Hintergrund: Claude ist je Lauf hart auf 10 Aufrufe begrenzt (tools/messe-abenteuer.js, absichtlich); gemessen werden mehrere Laeufe, hier zusammengelegt.
//   node tools/messe-zusammen.js <laufordner> [<laufordner>...] --out <ordner> [--baseline <messung.json>]
// Ein Lauf-Ordner ist `abenteuer-<Zeit>-<modus>` mit messung.json, plan-NN.md, plan-NN.prompt.txt, index.md (siehe ablegen() in tools/messe-abenteuer.js, Hilfen in tools/messe-ablage.js).
// Ausgabe: Konsole und <ordner>/zusammen.md + <ordner>/zusammen.json (--out relativ zum Aufrufer, nie im Repo, vorhandene Dateien werden nie ueberschrieben oder geloescht).
// Abschnitte: 1 Gueltigkeit, Dauer, Tokens, Kosten (je Lauf und gesamt)  2 Haeufigkeit jedes Beats des Katalogs (auch Nullen)  3 Beat-Folgen  4 Landeplatz  5 Vergleich mit --baseline.
// Der Beat-Katalog kommt aus content/faeden/beats.json (keine Beat-Namen im Code): `nur_inszenierer` getrennt (nicht im Beat-Plan-Katalog), `braucht.landeplatz` = Landeplatz-Beat.
// Eine Zahl, die aus den Daten nicht ableitbar ist, steht als "nicht gemessen", nie geschaetzt. Laeufe im Modus Absichten (kennzahlen.modus 'absicht') tragen keine Beat-Folgen: ihre Kennzahlen werden
// durchgereicht; Absichten- und Beat-Plan-Laeufe lassen sich nicht mischen (Exit 2).
// Landeplatz-Kontext: der Prompt jedes Plans (plan-NN.prompt.txt) enthaelt den Kontext als JSON-Zeile mit `landeplatz_arten`; leer = der Kontext bot keine Landeplatz-Art. Fehlt die Datei oder die Zeile, ist der Plan "nicht ableitbar".
// Exit 0, Exit 2 bei falschem Aufruf (auch unlesbarer Lauf-Ordner, Modusmischung), Exit 1 bei Schreibfehler.
const fs = require('fs');
const path = require('path');
const Ablage = require('./messe-ablage.js');
const MA = require('./messe-absichten.js');

const BEATS_DATEI = path.join(__dirname, '..', 'content', 'faeden', 'beats.json');
const NICHT = 'nicht gemessen';
const fmt = (x, d) => (Number.isFinite(x) ? Ablage.fmt(x, d) : NICHT);
const pz = (a, b) => (b ? Ablage.prozent(a, b) : NICHT);
const summe = (xs) => xs.reduce((s, x) => s + x, 0);
const zaehle = (xs) => { const c = {}; for (const x of xs) c[x] = (c[x] || 0) + 1; return c; };
const mergeZaehl = (os) => { const c = {}; for (const o of os) for (const [k, v] of Object.entries(o || {})) c[k] = (c[k] || 0) + v; return c; };
const codes = (o) => (Object.keys(o).length ? Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k} ${v}`).join(', ') : 'keine');
const zelle = Ablage.zelle;

function aufrufFehler(msg) { const e = new Error(msg); e.code = 'AUFRUF'; return e; }

// ---------- Katalog aus beats.json
function katalogLesen(datei) {
  const b = JSON.parse(fs.readFileSync(datei || BEATS_DATEI, 'utf8')).beats || {};
  const namen = Object.keys(b);
  return {
    alle: namen,
    waehlbar: namen.filter((n) => !b[n].nur_inszenierer),
    nurInszenierer: namen.filter((n) => b[n].nur_inszenierer === true),
    landeplatz: namen.filter((n) => !!(b[n].braucht && b[n].braucht.landeplatz)),
  };
}

// ---------- einen Lauf-Ordner lesen
// Kontext-Zeile des Prompts: JSON-Zeile mit landeplatz_arten -> 'leer' | 'vorhanden', sonst null (nicht ableitbar)
function landeplatzKontext(promptText) {
  if (typeof promptText !== 'string') return null;
  for (const l of promptText.split(/\r?\n/)) {
    if (!l.startsWith('{')) continue;
    let o; try { o = JSON.parse(l); } catch (e) { continue; }
    if (o && Array.isArray(o.landeplatz_arten)) return o.landeplatz_arten.length ? 'vorhanden' : 'leer';
  }
  return null;
}
function laufLesen(ordner) {
  let m;
  try { m = JSON.parse(fs.readFileSync(path.join(ordner, 'messung.json'), 'utf8')); } catch (e) { throw aufrufFehler(`${ordner}: messung.json nicht lesbar (${e.code || e.message}); erwartet wird ein Lauf-Ordner von messe-abenteuer --out`); }
  if (!m || m.format !== 'messung-abenteuer/1' || !Array.isArray(m.aufrufe) || !m.zusammenfassung || !m.kennzahlen) throw aufrufFehler(`${ordner}: messung.json hat nicht das Format messung-abenteuer/1`);
  const aufrufe = m.aufrufe.map((z) => {
    let kontext = null;
    if (z.datei) { try { kontext = landeplatzKontext(fs.readFileSync(path.join(ordner, String(z.datei).replace(/\.md$/, '.prompt.txt')), 'utf8')); } catch (e) { kontext = null; } }
    return { nr: z.nr, ausgang: z.ausgang, grund: z.grund || '', dauer_s: Number.isFinite(z.dauer_s) ? z.dauer_s : null, tokens: z.tokens || 0, typen: typeof z.typen === 'string' && z.typen ? z.typen.split('>') : [], kontext };
  });
  return { ordner, name: path.basename(ordner), modus: m.kennzahlen.modus === 'absicht' ? 'absicht' : 'beat-plan', anbieter: m.modus, bezeichnung: m.bezeichnung, zusammenfassung: m.zusammenfassung, kennzahlen: m.kennzahlen, aufrufe };
}

// ---------- Auswertung (rein; `laeufe` wie von laufLesen, `katalog` wie von katalogLesen)
function gueltigkeit(aufrufe, kosten) {
  const gueltig = aufrufe.filter((a) => a.ausgang === 'gueltig').length;
  const abg = aufrufe.filter((a) => a.ausgang === 'abgelehnt'), aus = aufrufe.filter((a) => a.ausgang !== 'gueltig' && a.ausgang !== 'abgelehnt');
  const dauer = aufrufe.map((a) => a.dauer_s).filter(Number.isFinite);
  return {
    aufrufe: aufrufe.length, gueltig, abgelehnt: abg.length, ausfall: aus.length,
    abgelehnt_je_code: zaehle(abg.map((a) => a.grund || '?')), ausfall_je_code: zaehle(aus.map((a) => a.grund || a.ausgang || '?')),
    dauer_aufrufe: dauer.length, dauer_median_s: Ablage.median(dauer), dauer_p90_s: Ablage.perzentil(dauer, 90),
    tokens: summe(aufrufe.map((a) => a.tokens)), kosten_usd: kosten,
  };
}
function auswerten(laeufe, katalog) {
  if (!laeufe.length) throw aufrufFehler('kein Lauf-Ordner angegeben');
  const modi = [...new Set(laeufe.map((l) => l.modus))];
  if (modi.length > 1) throw aufrufFehler(`Modi gemischt (${laeufe.map((l) => `${l.name}: ${l.modus === 'absicht' ? 'Absichten' : 'Beat-Plan'}`).join('; ')}); Absichten- und Beat-Plan-Laeufe werden nie zusammengefuehrt`);
  const modus = modi[0], A = modus === 'absicht';
  // Kosten: nur was der Lauf meldet (zusammenfassung.kosten_usd, im Mock null); gesamt = Summe der gemeldeten Laeufe, mit Angabe wie vieler
  const kostenJe = (l) => (Number.isFinite(l.zusammenfassung.kosten_usd) ? l.zusammenfassung.kosten_usd : null);
  const gemeldet = laeufe.filter((l) => kostenJe(l) !== null);
  const je = laeufe.map((l) => Object.assign({ lauf: l.name, anbieter: l.anbieter, bezeichnung: l.bezeichnung }, gueltigkeit(l.aufrufe, kostenJe(l))));
  const alle = [].concat(...laeufe.map((l) => l.aufrufe));
  const gesamt = Object.assign(gueltigkeit(alle, gemeldet.length ? summe(gemeldet.map(kostenJe)) : null), { laeufe: laeufe.length, kosten_laeufe_gemeldet: gemeldet.length });
  const R = { format: 'messung-zusammen/1', werkzeug: 'tools/messe-zusammen.js', modus, laeufe: laeufe.map((l) => l.name), gueltigkeit_je_lauf: je, gueltigkeit_gesamt: gesamt };
  if (A) {
    const ks = laeufe.map((l) => l.kennzahlen);
    R.absichten = {
      hinweis: 'Modus Absichten: keine Beat-Folgen, Kennzahlen je Lauf aus messung.json (kennzahlen); Summen nur von Zaehlern, keine gemittelten Quoten',
      je_lauf: laeufe.map((l, i) => ({ lauf: l.name, kennzahlen: ks[i] })),
      summe: {
        aufrufe_mit_verhandlung: summe(ks.map((k) => (k.verhandlung ? k.verhandlung.aufrufe_mit_verhandlung : 0))), gerettet: summe(ks.map((k) => (k.verhandlung ? k.verhandlung.gerettet : 0))),
        plaene_mit_bezug: summe(ks.map((k) => (k.bezug ? k.bezug.plaene_mit_bezug : 0))), mit_nsc: summe(ks.map((k) => (k.bezug ? k.bezug.mit_nsc : 0))), fortsetzung_plaene: summe(ks.map((k) => k.fortsetzung.plaene)),
        absichten_je_name: mergeZaehl(ks.map((k) => k.vielfalt.absichten_je_name)),
      },
    };
    R.absichten.summe.verschiedene_absichten = Object.keys(R.absichten.summe.absichten_je_name).length;
    return R;
  }
  // ---- Beat-Plan: nur gueltige Plaene zaehlen (abgelehnte tragen zwar eine gelesene Folge, sind aber kein Ergebnis)
  const gueltigJe = laeufe.map((l) => l.aufrufe.filter((a) => a.ausgang === 'gueltig'));
  const gp = [].concat(...gueltigJe);
  const nGueltig = gp.length;
  const haeuf = (n) => ({ beat: n, plaene: gp.filter((a) => a.typen.includes(n)).length, vorkommen: summe(gp.map((a) => a.typen.filter((t) => t === n).length)) });
  const waehlbar = katalog.waehlbar.map(haeuf), nurIns = katalog.nurInszenierer.map(haeuf);
  const unbekannt = [...new Set(gp.flatMap((a) => a.typen).filter((t) => !katalog.alle.includes(t)))].sort();
  R.katalog = { waehlbar: katalog.waehlbar, nur_inszenierer: katalog.nurInszenierer, landeplatz_beats: katalog.landeplatz };
  R.beats = { gueltige_plaene: nGueltig, waehlbar, nicht_im_beat_plan_katalog: nurIns, waehlbar_nie_gewaehlt: waehlbar.filter((h) => h.plaene === 0).map((h) => h.beat), unbekannt_im_katalog: unbekannt };
  const folgen = gp.map((a) => a.typen.join('>'));
  const hf = Object.entries(zaehle(folgen)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([folge, n]) => ({ folge, plaene: n }));
  let wdh = 0, von = 0;
  for (const g of gueltigJe) for (let i = 1; i < g.length; i++) { von++; if (g[i].typen.join('>') === g[i - 1].typen.join('>')) wdh++; }   // je Lauf, nie ueber die Lauf-Grenze
  const laengen = gp.map((a) => a.typen.length);
  R.folgen = {
    gueltige_plaene: nGueltig, verschiedene_folgen: hf.length, je_folge: hf, wiederholung_der_vorigen: wdh, wiederholung_von: von,
    laenge: { verteilung: zaehle(laengen), min: laengen.length ? Math.min(...laengen) : null, median: Ablage.median(laengen), max: laengen.length ? Math.max(...laengen) : null, mittel: laengen.length ? summe(laengen) / laengen.length : null },
  };
  const mitLp = (a) => a.typen.some((t) => katalog.landeplatz.includes(t));
  const lp = gp.filter(mitLp);
  const kBekannt = gp.filter((a) => a.kontext !== null), kLeer = gp.filter((a) => a.kontext === 'leer');
  const abgLp = [].concat(...laeufe.map((l) => l.aufrufe)).filter((a) => a.ausgang === 'abgelehnt' && /^LANDEPLATZ_/.test(a.grund));
  const hatLp = (as) => as.filter(mitLp).length;
  R.landeplatz = {
    landeplatz_beats: katalog.landeplatz, gueltige_plaene: nGueltig, plaene_mit_landeplatz_beat: lp.length,
    kontext_ableitbar: kBekannt.length, kontext_nicht_ableitbar: nGueltig - kBekannt.length,
    plaene_ohne_landeplatz_art_im_kontext: kLeer.length, davon_mit_landeplatz_beat: hatLp(kLeer),
    plaene_mit_landeplatz_beat_und_bekanntem_kontext: lp.filter((a) => a.kontext !== null).length, plaene_mit_landeplatz_beat_ohne_art_im_kontext: hatLp(kLeer),
    abgelehnt_landeplatz_je_code: zaehle(abgLp.map((a) => a.grund)), abgelehnt_landeplatz: abgLp.length,
    abgelehnt_landeplatz_kontext_leer: abgLp.filter((a) => a.kontext === 'leer').length, abgelehnt_landeplatz_kontext_nicht_ableitbar: abgLp.filter((a) => a.kontext === null).length,
  };
  return R;
}

// ---------- Baseline (messung.json eines Laufs oder zusammen.json)
function baselineLesen(datei) {
  let b;
  try { b = JSON.parse(fs.readFileSync(datei, 'utf8')); } catch (e) { throw aufrufFehler(`--baseline ${datei}: nicht lesbar (${e.code || e.message})`); }
  if (b && b.format === 'messung-zusammen/1' && b.gueltigkeit_gesamt) {
    const g = b.gueltigkeit_gesamt;
    return { quelle: datei, modus: b.modus, aufrufe: g.aufrufe, gueltig: g.gueltig, median: g.dauer_median_s, p90: g.dauer_p90_s, folgen: b.folgen ? b.folgen.verschiedene_folgen : null };
  }
  if (b && b.format === 'messung-abenteuer/1' && b.zusammenfassung && b.kennzahlen) {
    return { quelle: datei, modus: b.kennzahlen.modus === 'absicht' ? 'absicht' : 'beat-plan', aufrufe: b.zusammenfassung.aufrufe, gueltig: b.zusammenfassung.gueltig, median: b.zusammenfassung.dauer_median_s, p90: b.zusammenfassung.dauer_p90_s, folgen: b.kennzahlen.vielfalt ? b.kennzahlen.vielfalt.verschiedene_beat_folgen : null };
  }
  throw aufrufFehler(`--baseline ${datei}: weder messung-abenteuer/1 noch messung-zusammen/1`);
}
function vergleich(R, base) {
  const g = R.gueltigkeit_gesamt;
  const num = (x) => (Number.isFinite(x) ? x : null);
  const zeile = (name, jetzt, vorher, d, einheit) => ({ kennzahl: name, jetzt: num(jetzt), baseline: num(vorher), differenz: num(jetzt) !== null && num(vorher) !== null ? jetzt - vorher : null, suffix: einheit === '%' ? ' %' : einheit ? ' ' + einheit : '', suffix_diff: einheit === '%' ? ' %-Punkte' : einheit ? ' ' + einheit : '', d: d || 1 });
  const v = { quelle: base.quelle, baseline_modus: base.modus, modus_gleich: base.modus === R.modus, zeilen: [] };
  if (!v.modus_gleich) return v;
  v.zeilen.push(zeile('Gültigkeit (Anteil gültig)', g.aufrufe ? 100 * g.gueltig / g.aufrufe : null, base.aufrufe ? 100 * base.gueltig / base.aufrufe : null, 10, '%'));
  v.zeilen.push(zeile('Dauer Median', g.dauer_median_s, base.median, 100, 's'));
  v.zeilen.push(zeile('Dauer p90', g.dauer_p90_s, base.p90, 100, 's'));
  v.zeilen.push(zeile('Zahl verschiedener Folgen', R.folgen ? R.folgen.verschiedene_folgen : null, base.folgen, 1, ''));
  return v;
}

// ---------- Markdown
function markdown(R, V, argv) {
  const L = [Ablage.frontmatter({ titel: 'Messung Abenteuer-Komposition, zusammengeführt', werkzeug: 'tools/messe-zusammen.js', modus: R.modus, laeufe: R.laeufe.length, aufrufe: R.gueltigkeit_gesamt.aufrufe, erstellt: new Date().toISOString() }), '# Messung Abenteuer-Komposition, zusammengeführt', ''];
  L.push(`- Aufruf: \`node tools/messe-zusammen.js ${argv.join(' ')}\``, `- Modus: ${R.modus === 'absicht' ? 'Absichten' : 'Beat-Plan'}; Läufe: ${R.laeufe.join(', ')}`, '');
  const g = R.gueltigkeit_gesamt;
  const zeileG = (n, x) => `| ${zelle(n)} | ${x.aufrufe} | ${x.gueltig} (${pz(x.gueltig, x.aufrufe)}) | ${x.abgelehnt} (${pz(x.abgelehnt, x.aufrufe)}) | ${x.ausfall} (${pz(x.ausfall, x.aufrufe)}) | ${fmt(x.dauer_median_s, 100)} s | ${fmt(x.dauer_p90_s, 100)} s | ${fmt(x.tokens)} | ${Number.isFinite(x.kosten_usd) ? fmt(x.kosten_usd, 10000) + ' USD' : 'nicht gemeldet'} |`;
  L.push('## 1 Gültigkeit, Dauer, Tokens, Kosten', '', '| Lauf | Aufrufe | gültig | abgelehnt | Ausfall | Dauer Median | Dauer p90 | Tokens | Kosten |', '|---|---|---|---|---|---|---|---|---|');
  for (const x of R.gueltigkeit_je_lauf) L.push(zeileG(x.lauf, x));
  L.push(zeileG('**gesamt**', g), '');
  L.push(`- Ablehnungen je Code (gesamt): ${codes(g.abgelehnt_je_code)}`, `- Ausfälle je Code (gesamt): ${codes(g.ausfall_je_code)}`);
  L.push(`- Dauer: Median und p90 über alle ${g.dauer_aufrufe} Aufrufe mit gemeldeter Dauer (nicht der Mittelwert der Lauf-Mediane)`);
  L.push(`- Kosten: ${g.kosten_laeufe_gemeldet ? `Summe der gemeldeten Läufe (${g.kosten_laeufe_gemeldet} von ${g.laeufe})` : 'in keinem Lauf gemeldet (Mock oder CLI ohne total_cost_usd)'}`, '');
  if (R.modus === 'absicht') {
    const A = R.absichten;
    L.push('## 2 bis 4 Beats, Folgen, Landeplatz', '', 'Nicht anwendbar: Läufe im Modus Absichten tragen keine Beat-Folgen des Modells; es wird nichts geraten.', '', `> [!info] ${A.hinweis}`, '');
    L.push('## Absichten-Kennzahlen (Summen der Zähler)', '', `- Verhandlung: ${A.summe.aufrufe_mit_verhandlung} Aufrufe, davon gerettet ${A.summe.gerettet}`, `- Bezug: ${A.summe.plaene_mit_bezug} Pläne, davon mit NSC ${A.summe.mit_nsc}`, `- Fortsetzung: ${A.summe.fortsetzung_plaene} Pläne`, `- Absichten: ${A.summe.verschiedene_absichten} verschiedene: ${codes(A.summe.absichten_je_name)}`, '');
    for (const x of A.je_lauf) L.push(`### ${x.lauf}`, '', ...MA.kennzahlenZeilen(x.kennzahlen), '');
  } else {
    const B = R.beats, f = R.folgen, lp = R.landeplatz;
    L.push(`## 2 Häufigkeit der Beats (${B.gueltige_plaene} gültige Pläne)`, '', 'Pläne = gültige Pläne mit dem Beat, Vorkommen = Zahl der Vorkommen; Nullen stehen mit.', '', '### Wählbar (Beat-Plan-Katalog)', '', '| Beat | Pläne | Anteil | Vorkommen |', '|---|---|---|---|');
    for (const h of B.waehlbar) L.push(`| ${h.beat} | ${h.plaene} | ${pz(h.plaene, B.gueltige_plaene)} | ${h.vorkommen} |`);
    L.push('', `**Wählbar und nie gewählt (${B.waehlbar_nie_gewaehlt.length} von ${B.waehlbar.length}):** ${B.waehlbar_nie_gewaehlt.length ? B.waehlbar_nie_gewaehlt.join(', ') : 'keiner'}`, '');
    L.push('### Nicht im Beat-Plan-Katalog (nur über Inszenierer)', '', B.nicht_im_beat_plan_katalog.length ? '| Beat | Pläne | Vorkommen |\n|---|---|---|' : 'keine', ...B.nicht_im_beat_plan_katalog.map((h) => `| ${h.beat} | ${h.plaene} | ${h.vorkommen} |`), '');
    if (B.unbekannt_im_katalog.length) L.push(`> [!warning] Beats in gültigen Plänen, die beats.json nicht kennt: ${B.unbekannt_im_katalog.join(', ')}`, '');
    L.push(`## 3 Beat-Folgen`, '', `- ${f.verschiedene_folgen} verschiedene Folgen in ${f.gueltige_plaene} gültigen Plänen`, `- Wiederholung der Vorigen (gleiche Folge wie der vorige gültige Plan desselben Laufs): ${f.wiederholung_der_vorigen} von ${f.wiederholung_von} (${pz(f.wiederholung_der_vorigen, f.wiederholung_von)})`);
    L.push(`- Plan-Längen (Beats je Plan): min ${fmt(f.laenge.min)}, Median ${fmt(f.laenge.median, 10)}, max ${fmt(f.laenge.max)}, Mittel ${fmt(f.laenge.mittel, 100)}; Verteilung: ${Object.entries(f.laenge.verteilung).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k} Beats ${v}`).join(', ') || NICHT}`, '');
    L.push('| Folge | Pläne | Anteil |', '|---|---|---|');
    for (const x of f.je_folge) L.push(`| ${zelle(x.folge || '(leer)')} | ${x.plaene} | ${pz(x.plaene, f.gueltige_plaene)} |`);
    L.push('', '## 4 Landeplatz', '', `- Landeplatz-Beats (braucht.landeplatz in beats.json): ${lp.landeplatz_beats.join(', ') || 'keine'}`, `- Gültige Pläne mit einem Landeplatz-Beat: ${lp.plaene_mit_landeplatz_beat} von ${lp.gueltige_plaene} (${pz(lp.plaene_mit_landeplatz_beat, lp.gueltige_plaene)})`);
    if (lp.kontext_nicht_ableitbar === lp.gueltige_plaene && lp.gueltige_plaene > 0) L.push('- Kontext ohne Landeplatz-Art: nicht ableitbar (kein Prompt mit `landeplatz_arten` in den Lauf-Ordnern)');
    else L.push(`- Kontext lesbar (Prompt-Datei, \`landeplatz_arten\`): ${lp.kontext_ableitbar} von ${lp.gueltige_plaene} gültigen Plänen${lp.kontext_nicht_ableitbar ? `, ${lp.kontext_nicht_ableitbar} nicht ableitbar` : ''}`, `- Pläne in Aufrufen, deren Kontext keine Landeplatz-Art bot: ${lp.plaene_ohne_landeplatz_art_im_kontext}, davon mit Landeplatz-Beat ${lp.davon_mit_landeplatz_beat}; Anteil an den Landeplatz-Plänen mit lesbarem Kontext: ${pz(lp.plaene_mit_landeplatz_beat_ohne_art_im_kontext, lp.plaene_mit_landeplatz_beat_und_bekanntem_kontext)}`);
    L.push(`- Abgelehnt mit Code LANDEPLATZ_*: ${lp.abgelehnt_landeplatz}${lp.abgelehnt_landeplatz ? ` (${codes(lp.abgelehnt_landeplatz_je_code)}); davon Kontext ohne Landeplatz-Art ${lp.abgelehnt_landeplatz_kontext_leer}, nicht ableitbar ${lp.abgelehnt_landeplatz_kontext_nicht_ableitbar}` : ''}`, '');
  }
  L.push('## 5 Vergleich zur Baseline', '');
  if (!V) L.push('Keine Baseline angegeben (--baseline <messung.json>); nichts verglichen.', '');
  else if (!V.modus_gleich) L.push(`Baseline \`${V.quelle}\` hat den Modus ${V.baseline_modus === 'absicht' ? 'Absichten' : 'Beat-Plan'}, diese Messung ${R.modus === 'absicht' ? 'Absichten' : 'Beat-Plan'}: kein Vergleich.`, '');
  else {
    L.push(`Baseline: \`${V.quelle}\``, '', '| Kennzahl | jetzt | Baseline | Differenz |', '|---|---|---|---|');
    for (const z of V.zeilen) L.push(`| ${z.kennzahl} | ${fmt(z.jetzt, z.d)}${z.jetzt !== null ? z.suffix : ''} | ${fmt(z.baseline, z.d)}${z.baseline !== null ? z.suffix : ''} | ${z.differenz === null ? NICHT : (z.differenz > 0 ? '+' : '') + fmt(z.differenz, z.d) + z.suffix_diff} |`);
    L.push('');
  }
  return L.join('\n');
}

// ---------- Aufruf
function main(argv, cwd) {
  const eingaben = [];
  let out, base;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out' || a === '--baseline') {
      const w = argv[i + 1];
      if (w === undefined || w.startsWith('--')) throw aufrufFehler(`${a} braucht einen Wert`);
      if (a === '--out') out = w; else base = w;
      i++;
    } else if (a.startsWith('--')) throw aufrufFehler(`unbekannte Option ${a}`);
    else eingaben.push(a);
  }
  if (!eingaben.length) throw aufrufFehler('Aufruf: node tools/messe-zusammen.js <laufordner> [<laufordner>...] --out <ordner> [--baseline <datei>]');
  let wurzel;
  try { wurzel = Ablage.wurzelPruefen(out, cwd); } catch (e) { throw aufrufFehler(e.message); }
  const ordner = eingaben.map((e) => path.resolve(cwd, e));
  if (new Set(ordner).size !== ordner.length) throw aufrufFehler('derselbe Lauf-Ordner ist mehrfach angegeben (er wuerde doppelt zaehlen)');
  const laeufe = ordner.map(laufLesen);
  const katalog = katalogLesen();
  const R = auswerten(laeufe, katalog);
  const V = base ? vergleich(R, baselineLesen(path.resolve(cwd, base))) : null;
  if (V) R.vergleich = V;
  const md = markdown(R, V, argv);
  fs.mkdirSync(wurzel, { recursive: true });
  try {
    Ablage.schreibe(wurzel, 'zusammen.md', md);
    Ablage.schreibe(wurzel, 'zusammen.json', JSON.stringify(R, null, 1));
  } catch (e) { const f = new Error('Ablage fehlgeschlagen: ' + e.message + ' (vorhandene Dateien werden nie ueberschrieben; anderen --out waehlen)'); f.code = 'SCHREIBEN'; throw f; }
  return { md, wurzel, R };
}

if (require.main === module) {
  try {
    const r = main(process.argv.slice(2), process.cwd());
    console.log(r.md);
    console.log(`Ablage: ${r.wurzel} (zusammen.md, zusammen.json)`);
    process.exit(0);
  } catch (e) {
    console.error(e.message);
    process.exit(e.code === 'SCHREIBEN' ? 1 : e.code === 'AUFRUF' ? 2 : 1);
  }
}
module.exports = { auswerten, katalogLesen, landeplatzKontext, laufLesen, baselineLesen, vergleich, main };
