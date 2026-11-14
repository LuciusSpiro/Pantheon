'use strict';
// REF-02 Paket 0: Test von tools/messe-zusammen.js – npm run test:messe-zusammen.
// Offline: kuenstliche Lauf-Ordner (messung.json im Format von messe-abenteuer, Prompt-Dateien) und zwei echte Mock-Laeufe von messe-abenteuer, alles in einem mkdtemp-Verzeichnis, nie im Repo.
// Die Beat-Namen kommen aus content/faeden/beats.json (kein Name im Test); die Zahlen der kuenstlichen Laeufe sind von Hand gerechnet (Kommentar bei der Fixture).
//   1 Fixture Beat-Plan (2 Laeufe): Gueltigkeit/Dauer/Tokens/Kosten, Haeufigkeit mit Nullen, nur_inszenierer getrennt, nie gewaehlt, Folgen, Wiederholung, Laengen, Landeplatz, Baseline
//   2 Modus Absichten: Durchreichen; Mischung mit Beat-Plan abgelehnt   3 Fehlaufrufe: Exit 2, nichts geschrieben   4 zwei echte Mock-Laeufe, zusammen.md/json   5 nichts ueberschrieben, Repo sauber
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const Z = require('./messe-zusammen.js');
const MA = require('./messe-absichten.js');
const results = [];
const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail }); };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-messe-zusammen-'));
const env = { ...process.env }; delete env.LLM_LIVE; delete env.REGIE_DIR; delete env.MITSCHNITT; delete env.MITSCHNITT_DIR; delete env.ABENTEUER_ABSICHTEN;
function lauf(tool, args, cwd, extraEnv) {
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, tool), ...args], { cwd: cwd || TMP, encoding: 'utf8', timeout: 240000, env: { ...env, ...(extraEnv || {}) } });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', text: (r.stdout || '') + (r.stderr || '') };
}
const lesen = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const repoSpuren = () => (cp.spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' }).stdout || '').split(/\r?\n/).filter((l) => /zusammen\.(md|json)/.test(l));
const spurenVorher = repoSpuren().join('\n');

// ---------- Fixture: ein Lauf-Ordner mit messung.json und Prompt-Dateien
const K = Z.katalogLesen();
const nurLp = K.waehlbar.filter((n) => !K.landeplatz.includes(n));
const b1 = nurLp[0], b2 = nurLp[1], lp1 = K.landeplatz[0], ins = K.nurInszenierer[0];
check('0 Katalog aus beats.json: waehlbar, nur_inszenierer und Landeplatz-Beats nicht leer, nur_inszenierer nicht in waehlbar', K.waehlbar.length > 3 && K.nurInszenierer.length > 0 && K.landeplatz.length > 0 && !K.nurInszenierer.some((n) => K.waehlbar.includes(n)) && !!(b1 && b2 && lp1 && ins));
function kontextZeile(arten) { return JSON.stringify({ chronik: [], crew: { hex: '0305' }, landeplatz_arten: arten }); }
function fixLauf(name, aufrufe, opt) {
  const dir = path.join(TMP, name); fs.mkdirSync(dir, { recursive: true });
  const o = opt || {};
  const zeilen = aufrufe.map((a, i) => {
    const nr = i + 1, datei = `plan-${String(nr).padStart(2, '0')}.md`;
    if (a.kontext) fs.writeFileSync(path.join(dir, datei.replace('.md', '.prompt.txt')), 'Kopf\n' + kontextZeile(a.kontext === 'leer' ? [] : ['wildnis']) + '\nSchluss\n');
    return { nr, datei, titel: 't' + nr, ausgang: a.ausgang, grund: a.grund || '', dauer_s: a.dauer, tokens: a.tokens === undefined ? 10 : a.tokens, geld: 0, typen: (a.typen || []).join('>'), anbieter: 'mock', modell: 'mock', fehler: [] };
  });
  const kz = o.kennzahlen || MA.kennzahlen(zeilen.map((z) => ({ ausgang: z.ausgang, grund: z.grund, verhandlung: 0, absicht: null, bezug_art: null, typen: z.ausgang === 'gueltig' && z.typen ? z.typen.split('>') : [], tokens: z.tokens, geld: null })), { modusAbsicht: false, live: false, lesbarePlaene: zeilen.length });
  const abg = zeilen.filter((z) => z.ausgang === 'abgelehnt').length;
  const messung = { format: 'messung-abenteuer/1', werkzeug: 'tools/messe-abenteuer.js', aufruf: [], modus: o.anbieter || 'mock', bezeichnung: 'Fixture ' + name, erstellt: '2026-11-14T00:00:00.000Z', abbruch: null,
    zusammenfassung: { aufrufe: zeilen.length, gueltig: zeilen.filter((z) => z.ausgang === 'gueltig').length, abgelehnt: abg, ausfall: zeilen.length - abg - zeilen.filter((z) => z.ausgang === 'gueltig').length, dauer_median_s: 0, dauer_p90_s: 0, kosten_usd: o.kosten === undefined ? null : o.kosten },
    kennzahlen: kz, aufrufe: zeilen };
  fs.writeFileSync(path.join(dir, 'messung.json'), JSON.stringify(messung));
  return dir;
}
// Handrechnung (b1, b2 = gewoehnliche Beats, lp1 = Landeplatz-Beat, ins = nur_inszenierer):
// Lauf A: 1 gueltig b1>b2 (Kontext leer, 1 s) | 2 gueltig b1>b2 (leer, 2 s) | 3 gueltig b1>lp1 (vorhanden, 3 s) | 4 abgelehnt LANDEPLATZ_ART lp1 (leer, 4 s) | 5 Ausfall TIMEOUT (5 s)   Kosten 0,5 USD
// Lauf B: 1 gueltig lp1>b2>b2 (vorhanden, 6 s) | 2 gueltig b1>b2 (vorhanden, 7 s) | 3 gueltig ins>b1 (kein Prompt, 8 s)   Kosten nicht gemeldet
// gesamt 8 Aufrufe, gueltig 6, abgelehnt 1, Ausfall 1; Dauer 1..8: Median 4,5, p90 8; Tokens 8 x 10 = 80; Kosten 0,5 (1 von 2 Laeufen)
// b1: 5 Plaene/5 Vorkommen, b2: 4 Plaene/5 Vorkommen, lp1: 2/2 (der abgelehnte zaehlt nicht), ins: 1/1; wählbar nie gewaehlt = waehlbar - 3
// Folgen gueltig: b1>b2 x3, b1>lp1, lp1>b2>b2, ins>b1 = 4 verschiedene; Wiederholung je Lauf: A (1,2) ja, (2,3) nein; B 0 von 2 -> 1 von 4; Laengen 2,2,2,2,3,2
// Landeplatz: 2 von 6 gueltigen Plaenen; Kontext lesbar 5 von 6 (B3 nicht ableitbar), leer 2 (A1, A2), davon mit Landeplatz-Beat 0; LANDEPLATZ_* abgelehnt 1 (Kontext leer)
const A = fixLauf('abenteuer-A', [
  { ausgang: 'gueltig', typen: [b1, b2], kontext: 'leer', dauer: 1 }, { ausgang: 'gueltig', typen: [b1, b2], kontext: 'leer', dauer: 2 }, { ausgang: 'gueltig', typen: [b1, lp1], kontext: 'voll', dauer: 3 },
  { ausgang: 'abgelehnt', grund: 'LANDEPLATZ_ART', typen: [lp1], kontext: 'leer', dauer: 4 }, { ausgang: 'ausfall', grund: 'TIMEOUT', dauer: 5 },
], { kosten: 0.5 });
const B = fixLauf('abenteuer-B', [
  { ausgang: 'gueltig', typen: [lp1, b2, b2], kontext: 'voll', dauer: 6 }, { ausgang: 'gueltig', typen: [b1, b2], kontext: 'voll', dauer: 7 }, { ausgang: 'gueltig', typen: [ins, b1], dauer: 8 },
]);
const aus = path.join(TMP, 'aus1');
const r1 = lauf('messe-zusammen.js', [A, B, '--out', 'aus1'], TMP);
const md = fs.existsSync(path.join(aus, 'zusammen.md')) ? fs.readFileSync(path.join(aus, 'zusammen.md'), 'utf8') : '';
const js = fs.existsSync(path.join(aus, 'zusammen.json')) ? lesen(path.join(aus, 'zusammen.json')) : null;
check('1 Aufruf Exit 0, zusammen.md und zusammen.json im relativen --out (gegen cwd des Aufrufers)', r1.code === 0 && !!md && !!js, r1.text);
check('1 Konsole = zusammen.md (Abschnitte 1 bis 5)', /## 1 Gültigkeit/.test(r1.out) && /## 2 Häufigkeit/.test(r1.out) && /## 3 Beat-Folgen/.test(r1.out) && /## 4 Landeplatz/.test(r1.out) && /## 5 Vergleich/.test(r1.out));
const g = js.gueltigkeit_gesamt;
check('1 Summen: 8 Aufrufe, 6 gueltig, 1 abgelehnt, 1 Ausfall, Codes', g.aufrufe === 8 && g.gueltig === 6 && g.abgelehnt === 1 && g.ausfall === 1 && g.abgelehnt_je_code.LANDEPLATZ_ART === 1 && g.ausfall_je_code.TIMEOUT === 1, JSON.stringify(g));
check('1 Dauer Median 4,5 und p90 8 ueber alle Aufrufe (nicht Mittel der Lauf-Mediane)', g.dauer_median_s === 4.5 && g.dauer_p90_s === 8 && g.dauer_aufrufe === 8, JSON.stringify(g));
check('1 Tokens 80; Kosten 0,5 nur aus gemeldeten Laeufen (1 von 2); je Lauf: A 0,5, B nicht gemeldet', g.tokens === 80 && g.kosten_usd === 0.5 && g.kosten_laeufe_gemeldet === 1 && js.gueltigkeit_je_lauf[0].kosten_usd === 0.5 && js.gueltigkeit_je_lauf[1].kosten_usd === null && /nicht gemeldet/.test(md));
check('1 je Lauf: A 3/1/1 von 5, B 3/0/0 von 3', js.gueltigkeit_je_lauf[0].gueltig === 3 && js.gueltigkeit_je_lauf[0].abgelehnt === 1 && js.gueltigkeit_je_lauf[0].ausfall === 1 && js.gueltigkeit_je_lauf[1].aufrufe === 3 && js.gueltigkeit_je_lauf[1].gueltig === 3);
const h = (n) => js.beats.waehlbar.find((x) => x.beat === n) || js.beats.nicht_im_beat_plan_katalog.find((x) => x.beat === n);
check('2 Haeufigkeit: b1 5/5, b2 4/5, lp1 2/2 (Abgelehnte zaehlen nicht)', h(b1).plaene === 5 && h(b1).vorkommen === 5 && h(b2).plaene === 4 && h(b2).vorkommen === 5 && h(lp1).plaene === 2 && h(lp1).vorkommen === 2, JSON.stringify([h(b1), h(b2), h(lp1)]));
check('2 JEDER waehlbare Beat des Katalogs steht drin, auch mit Null (JSON und Markdown)', js.beats.waehlbar.length === K.waehlbar.length && K.waehlbar.every((n) => new RegExp('\\| ' + n + ' \\|').test(md)) && js.beats.waehlbar.filter((x) => x.plaene === 0).length === K.waehlbar.length - 3);
check('2 nur_inszenierer getrennt: nicht in "waehlbar", eigener Abschnitt, ins 1/1, die anderen 0', K.nurInszenierer.every((n) => !js.beats.waehlbar.some((x) => x.beat === n)) && /Nicht im Beat-Plan-Katalog \(nur über Inszenierer\)/.test(md) && h(ins).plaene === 1 && js.beats.nicht_im_beat_plan_katalog.length === K.nurInszenierer.length);
check('2 "waehlbar und nie gewaehlt": genau die Nullen, ohne nur_inszenierer; Zeile im Markdown', js.beats.waehlbar_nie_gewaehlt.length === K.waehlbar.length - 3 && !js.beats.waehlbar_nie_gewaehlt.includes(ins) && !js.beats.waehlbar_nie_gewaehlt.includes(b1) && md.includes(`nie gewählt (${K.waehlbar.length - 3} von ${K.waehlbar.length})`));
const f = js.folgen;
check('3 Folgen: 4 verschiedene, b1>b2 dreimal an der Spitze', f.verschiedene_folgen === 4 && f.je_folge[0].folge === `${b1}>${b2}` && f.je_folge[0].plaene === 3 && f.je_folge.reduce((s, x) => s + x.plaene, 0) === 6, JSON.stringify(f.je_folge));
check('3 Wiederholung der Vorigen 1 von 4 (je Lauf, nicht ueber die Lauf-Grenze)', f.wiederholung_der_vorigen === 1 && f.wiederholung_von === 4, JSON.stringify(f));
check('3 Plan-Laengen: min 2, max 3, Verteilung 2 x5, 3 x1, Median 2', f.laenge.min === 2 && f.laenge.max === 3 && f.laenge.verteilung['2'] === 5 && f.laenge.verteilung['3'] === 1 && f.laenge.median === 2, JSON.stringify(f.laenge));
const lp = js.landeplatz;
check('4 Landeplatz: 2 von 6 gueltigen Plaenen mit Landeplatz-Beat', lp.plaene_mit_landeplatz_beat === 2 && lp.gueltige_plaene === 6, JSON.stringify(lp));
check('4 Kontext: 5 von 6 lesbar, B3 nicht ableitbar; leer 2, davon mit Landeplatz-Beat 0', lp.kontext_ableitbar === 5 && lp.kontext_nicht_ableitbar === 1 && lp.plaene_ohne_landeplatz_art_im_kontext === 2 && lp.davon_mit_landeplatz_beat === 0, JSON.stringify(lp));
check('4 abgelehnt LANDEPLATZ_*: 1 (ART), davon Kontext leer 1, getrennt gezaehlt', lp.abgelehnt_landeplatz === 1 && lp.abgelehnt_landeplatz_je_code.LANDEPLATZ_ART === 1 && lp.abgelehnt_landeplatz_kontext_leer === 1 && /Abgelehnt mit Code LANDEPLATZ_\*: 1 \(LANDEPLATZ_ART 1\)/.test(md));
check('5 ohne --baseline: nichts verglichen, nichts erfunden', /Keine Baseline angegeben/.test(md) && !js.vergleich);
// Landeplatz-Kontext-Parser
check('4 Kontext-Parser: leer, vorhanden, fehlt, kaputt', Z.landeplatzKontext('x\n' + kontextZeile([]) + '\n') === 'leer' && Z.landeplatzKontext(kontextZeile(['schiff'])) === 'vorhanden' && Z.landeplatzKontext('kein json\n{"a":1}\n') === null && Z.landeplatzKontext('{kaputt') === null && Z.landeplatzKontext(undefined) === null);

// ---------- Baseline
const baseDatei = path.join(TMP, 'baseline.json');
fs.writeFileSync(baseDatei, JSON.stringify({ format: 'messung-abenteuer/1', zusammenfassung: { aufrufe: 10, gueltig: 9, dauer_median_s: 3, dauer_p90_s: 6 }, kennzahlen: { modus: 'beat-plan', vielfalt: { verschiedene_beat_folgen: 3 } } }));
const rb = lauf('messe-zusammen.js', [A, B, '--out', 'aus-b', '--baseline', baseDatei], TMP);
const jb = fs.existsSync(path.join(TMP, 'aus-b', 'zusammen.json')) ? lesen(path.join(TMP, 'aus-b', 'zusammen.json')) : { vergleich: { zeilen: [] } };
const vz = (k) => (jb.vergleich.zeilen.find((z) => z.kennzahl === k) || {});
check('5 Baseline: Gueltigkeit 75 gegen 90 %, Median 4,5 gegen 3, p90 8 gegen 6, Folgen 4 gegen 3', rb.code === 0 && vz('Gültigkeit (Anteil gültig)').jetzt === 75 && vz('Gültigkeit (Anteil gültig)').baseline === 90 && vz('Dauer Median').differenz === 1.5 && vz('Dauer p90').differenz === 2 && vz('Zahl verschiedener Folgen').differenz === 1, rb.text);
const baseOhne = path.join(TMP, 'baseline-leer.json');
fs.writeFileSync(baseOhne, JSON.stringify({ format: 'messung-abenteuer/1', zusammenfassung: { aufrufe: 10, gueltig: 9 }, kennzahlen: { modus: 'beat-plan', vielfalt: {} } }));
const ro = lauf('messe-zusammen.js', [A, B, '--out', 'aus-o', '--baseline', baseOhne], TMP);
const jo = fs.existsSync(path.join(TMP, 'aus-o', 'zusammen.json')) ? lesen(path.join(TMP, 'aus-o', 'zusammen.json')) : { vergleich: { zeilen: [] } };
check('5 Baseline ohne Median/p90/Folgen: "nicht gemessen", keine erfundenen Werte', ro.code === 0 && jo.vergleich.zeilen.filter((z) => z.baseline === null).length === 3 && (ro.out.match(/nicht gemessen/g) || []).length >= 3);
check('5 kaputte Baseline: Exit 2', lauf('messe-zusammen.js', [A, '--out', 'aus-k', '--baseline', path.join(TMP, 'gibt-es-nicht.json')], TMP).code === 2);

// ---------- Modus Absichten
const zeilenAbs = [
  { ausgang: 'gueltig', grund: '', verhandlung: 0, absicht: 'a1', bezug_art: 'nsc', typen: [b1], tokens: 0 }, { ausgang: 'gueltig', grund: '', verhandlung: 1, absicht: 'a2', bezug_art: 'keiner', typen: [b2], tokens: 0 }, { ausgang: 'abgelehnt', grund: 'X', verhandlung: 1, absicht: null, bezug_art: null, typen: [], tokens: 0 },
];
const kzAbs = MA.kennzahlen(zeilenAbs, { modusAbsicht: true, live: false, lesbarePlaene: 0 });
const mkAbs = (n) => fixLauf(n, [{ ausgang: 'gueltig', dauer: 1, typen: [b1] }, { ausgang: 'gueltig', dauer: 2, typen: [b2] }, { ausgang: 'abgelehnt', grund: 'X', dauer: 3 }], { kennzahlen: kzAbs });
const AB1 = mkAbs('abenteuer-AB1'), AB2 = mkAbs('abenteuer-AB2');
const ra = lauf('messe-zusammen.js', [AB1, AB2, '--out', 'aus-abs'], TMP);
const ja = fs.existsSync(path.join(TMP, 'aus-abs', 'zusammen.json')) ? lesen(path.join(TMP, 'aus-abs', 'zusammen.json')) : {};
const maAbs = fs.existsSync(path.join(TMP, 'aus-abs', 'zusammen.md')) ? fs.readFileSync(path.join(TMP, 'aus-abs', 'zusammen.md'), 'utf8') : '';
check('2 Absichten: Exit 0, Modus absicht, Kennzahlen durchgereicht, Summen der Zaehler (2 x Verhandlung, Bezug, Absichten)', ra.code === 0 && ja.modus === 'absicht' && ja.absichten.je_lauf.length === 2 && ja.absichten.summe.aufrufe_mit_verhandlung === 2 * kzAbs.verhandlung.aufrufe_mit_verhandlung && ja.absichten.summe.plaene_mit_bezug === 2 * kzAbs.bezug.plaene_mit_bezug && ja.absichten.summe.absichten_je_name.a1 === 2 && ja.absichten.summe.verschiedene_absichten === 2, ra.text);
check('2 Absichten: keine Beat-Haeufigkeit, keine Folgen geraten (kein beats/folgen/landeplatz im JSON, Hinweis im Markdown)', !ja.beats && !ja.folgen && !ja.landeplatz && /Nicht anwendbar: Läufe im Modus Absichten/.test(maAbs) && /Kennzahlen \(SPL-02 G, Modus Absichten/.test(maAbs));
const rm = lauf('messe-zusammen.js', [A, AB1, '--out', 'aus-misch'], TMP);
check('2 Mischung Beat-Plan + Absichten: Exit 2, Fehlermeldung nennt die Modi, nichts geschrieben', rm.code === 2 && /gemischt/.test(rm.err) && !fs.existsSync(path.join(TMP, 'aus-misch', 'zusammen.md')), rm.text);

// ---------- Fehlaufrufe: Exit 2
const fehl = (name, args) => { const r = lauf('messe-zusammen.js', args, TMP); check(`3 Fehlaufruf ${name}: Exit 2`, r.code === 2, r.text); return r; };
fehl('ohne Argumente', []);
fehl('ohne --out', [A]);
fehl('--out ohne Wert', [A, '--out']);
fehl('ohne Lauf-Ordner', ['--out', 'x-leer']);
fehl('unbekannte Option', [A, '--out', 'x-opt', '--foo']);
fehl('Lauf-Ordner ohne messung.json', [TMP, '--out', 'x-kein']);
fehl('Lauf-Ordner doppelt', [A, A, '--out', 'x-dop']);
const rr = fehl('--out im Repo', [A, '--out', path.join(ROOT, 'zusammen-test-out')]);
check('3 --out im Repo: Meldung "liegt im Repo", nichts angelegt', /liegt im Repo/.test(rr.err) && !fs.existsSync(path.join(ROOT, 'zusammen-test-out')) && repoSpuren().join('\n') === spurenVorher);
const rf = path.join(TMP, 'falsches-format'); fs.mkdirSync(rf); fs.writeFileSync(path.join(rf, 'messung.json'), JSON.stringify({ format: 'anders' }));
fehl('messung.json mit anderem Format', [rf, '--out', 'x-fmt']);
check('3 nach Fehlaufrufen ist keiner der x-*-Ordner entstanden', fs.readdirSync(TMP).filter((n) => /^x-/.test(n)).length === 0);

// ---------- zwei echte Mock-Laeufe von messe-abenteuer (Kette bis zur Ablage)
const echt = path.join(TMP, 'echt');
const m1 = lauf('messe-abenteuer.js', ['--n', '10', '--seed', '7', '--out', echt], TMP), m2 = lauf('messe-abenteuer.js', ['--n', '10', '--seed', '9', '--out', echt], TMP);
const ordner = fs.existsSync(echt) ? fs.readdirSync(echt).map((n) => path.join(echt, n)) : [];
check('4 zwei Mock-Laeufe abgelegt', m1.code === 0 && m2.code === 0 && ordner.length === 2, m1.text.slice(-300) + m2.text.slice(-300));
if (ordner.length === 2) {
  const re = lauf('messe-zusammen.js', [...ordner, '--out', 'aus-echt', '--baseline', path.join(ordner[0], 'messung.json')], TMP);
  const je = lesen(path.join(TMP, 'aus-echt', 'zusammen.json'));
  const mjs = ordner.map((o) => lesen(path.join(o, 'messung.json')));
  const gueltigSumme = mjs.reduce((s, m) => s + m.zusammenfassung.gueltig, 0);
  check('4 echte Laeufe: Exit 0, 20 Aufrufe, gueltig = Summe der messung.json, zusammen.md vorhanden', re.code === 0 && je.gueltigkeit_gesamt.aufrufe === 20 && je.gueltigkeit_gesamt.gueltig === gueltigSumme && fs.existsSync(path.join(TMP, 'aus-echt', 'zusammen.md')), re.text.slice(-400));
  check('4 echte Laeufe: Summe der Beat-Vorkommen = Summe der Plan-Laengen; Folgen aus messung.json (typen) nachgerechnet', (() => {
    const plaene = [].concat(...mjs.map((m) => m.aufrufe.filter((a) => a.ausgang === 'gueltig')));
    const vork = je.beats.waehlbar.concat(je.beats.nicht_im_beat_plan_katalog).reduce((s, x) => s + x.vorkommen, 0);
    return vork === plaene.reduce((s, a) => s + a.typen.split('>').length, 0) && je.folgen.verschiedene_folgen === new Set(plaene.map((a) => a.typen)).size;
  })());
  check('4 echte Laeufe: Landeplatz-Kontext aus den Prompt-Dateien lesbar (kein "nicht ableitbar")', je.landeplatz.kontext_nicht_ableitbar === 0 && je.landeplatz.kontext_ableitbar === je.gueltigkeit_gesamt.gueltig, JSON.stringify(je.landeplatz));
  check('4 echte Laeufe: Baseline gegen den ersten Lauf, Gueltigkeit gleich Quelle', !!je.vergleich && je.vergleich.zeilen.length === 4 && je.vergleich.zeilen[0].baseline === 100 * mjs[0].zusammenfassung.gueltig / mjs[0].zusammenfassung.aufrufe);
  // ---------- nichts ueberschrieben, nichts geloescht
  const vorher = fs.readFileSync(path.join(TMP, 'aus-echt', 'zusammen.md'), 'utf8');
  const r2 = lauf('messe-zusammen.js', [...ordner, '--out', 'aus-echt'], TMP);
  check('5 zweiter Aufruf in denselben --out: Exit 1, vorhandene Datei unveraendert, nichts geloescht', r2.code === 1 && fs.readFileSync(path.join(TMP, 'aus-echt', 'zusammen.md'), 'utf8') === vorher && ordner.every((o) => fs.existsSync(path.join(o, 'messung.json')) && fs.existsSync(path.join(o, 'index.md'))), r2.text);
}
check('5 Repo: keine zusammen.md/json entstanden (git status)', repoSpuren().join('\n') === spurenVorher, repoSpuren().join('\n'));

fs.rmSync(TMP, { recursive: true, force: true });   // das eigene mkdtemp-Verzeichnis dieses Tests
let bad = 0;
for (const r of results) { if (!r.ok) { bad++; console.log(`✗ ${r.name}${r.detail ? ' – ' + String(r.detail).slice(0, 400) : ''}`); } }
console.log(`${results.length - bad}/${results.length} Prüfungen ok`);
process.exit(bad ? 1 : 0);
