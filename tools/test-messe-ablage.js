'use strict';
// LIV-01 C: Test der Ablage der Messwerkzeuge (tools/messe-abenteuer.js --out, tools/messe-lage.js, tools/messe-ablage.js) – npm run test:messe-ablage.
// Offline (nur Mock), schreibt nur in ein mkdtemp-Verzeichnis, nie ins Repo. Geprueft:
//   1 messe-abenteuer --mock --out: Dateien, Frontmatter, Index-Links, messung.json, relative --out gegen das Verzeichnis des Aufrufers
//   2 ohne --out: Konsolenzusammenfassung unveraendert (gleiche Zeilen wie mit --out, kein "Ablage:", nichts geschrieben)
//   3 --out im Repo, kaputte Aufrufe: Exit 2, nichts angelegt   4 zweiter Lauf: neuer Ordner, Vorlauf und Fremddateien unberuehrt
//   5 messe-lage --mock --out: lage-NN.md, abenteuer-NN.md, index.md, auswertung.md (vier Befunde), messung.json, Links, --auswerten ueberschreibt nichts
//   6 --live ohne LLM_LIVE: "nicht gemessen", Exit 0, nichts angelegt   7 Hilfsfunktionen (Frontmatter, Zaun, Wurzel)   8 Claude-Deckel 10
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const Ablage = require('./messe-ablage.js');
const results = [];
const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail }); };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-messe-ablage-'));

const env = { ...process.env }; delete env.LLM_LIVE; delete env.REGIE_DIR; delete env.MITSCHNITT; delete env.MITSCHNITT_DIR; delete env.CLAUDE_TOKEN_BUDGET;
function lauf(tool, args, cwd, extraEnv) {
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, tool), ...args], { cwd: cwd || TMP, encoding: 'utf8', timeout: 240000, env: { ...env, ...(extraEnv || {}) } });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', text: (r.stdout || '') + (r.stderr || '') };
}
const frontmatter = (t) => (/^---\r?\n([\s\S]*?)\r?\n---/.exec(t) || [])[1] || '';
const fmKeys = (t) => frontmatter(t).split(/\r?\n/).map((l) => l.split(':')[0]);
const hash = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
const laufOrdner = (wurzel) => fs.readdirSync(wurzel, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(wurzel, d.name));
const dateien = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? dateien(path.join(dir, d.name)) : [path.join(dir, d.name)]));
// alle Markdown-Links [text](ziel) einer Datei, relativ zu ihrem Ordner aufgeloest
const links = (datei) => [...fs.readFileSync(datei, 'utf8').matchAll(/\]\(([^)#\s]+)\)/g)].map((m) => m[1]).filter((l) => !/^[a-z]+:/i.test(l)).map((l) => path.resolve(path.dirname(datei), decodeURIComponent(l)));
// was die Werkzeuge im Repo angelegt haetten (git kennt nur Pfade im Repo; wir suchen die Ablage-Muster)
function repoSpuren() {
  const r = cp.spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' });
  return (r.stdout || '').split(/\r?\n/).filter((l) => /(abenteuer|lage)-(mock|live)-\d{8}|messung\.json|plan-\d+\.md|lage-\d+\.md|abenteuer-\d+\.md|auswertung/.test(l));
}
const spurenVorher = repoSpuren().join('\n');

// ---------- 1 messe-abenteuer --mock --out (relativ: gegen das Verzeichnis des Aufrufers, nicht des Repos)
const out1 = path.join(TMP, 'ablage');
fs.mkdirSync(out1);
fs.writeFileSync(path.join(out1, 'FREMD.txt'), 'darf nie verschwinden');
const r1 = lauf('messe-abenteuer.js', ['--mock', '--n', '4', '--out', 'ablage'], TMP);
check('1 messe-abenteuer --mock --out: Exit 0', r1.code === 0, r1.text);
const ordner1 = laufOrdner(out1);
check('1 genau ein Lauf-Ordner abenteuer-mock-<Zeit> unter dem relativen --out', ordner1.length === 1 && /abenteuer-mock-\d{8}-\d{6}/.test(ordner1[0]), ordner1.join(','));
const o1 = ordner1[0] || out1;
const namen1 = fs.existsSync(o1) ? fs.readdirSync(o1) : [];
for (const n of ['index.md', 'messung.json', 'plan-01.md', 'plan-02.md', 'plan-03.md', 'plan-04.md', 'plan-01.prompt.txt', 'plan-04.prompt.txt']) check(`1 Datei ${n} vorhanden`, namen1.includes(n), namen1.join(','));
check('1 Ausgabe nennt den Ablageordner', /Ablage: /.test(r1.out));
const idx1 = fs.existsSync(path.join(o1, 'index.md')) ? fs.readFileSync(path.join(o1, 'index.md'), 'utf8') : '';
const l1 = links(path.join(o1, 'index.md'));
check('1 index.md: Tabelle verlinkt jede Plan-Datei, alle Links loesen auf', l1.length >= 5 && l1.every((l) => fs.existsSync(l)) && [1, 2, 3, 4].every((n) => l1.some((l) => l.endsWith(`plan-0${n}.md`))), l1.join(','));
check('1 index.md: Zusammenfassung (Gueltigkeit, Median/p90, Tokens gegen CLAUDE_TOKEN_BUDGET, Kosten, Wiederholungsrate)', /Gültigkeit: gültig/.test(idx1) && /Median/.test(idx1) && /p90/.test(idx1) && /CLAUDE_TOKEN_BUDGET/.test(idx1) && /Kosten:/.test(idx1) && /Wiederholungsrate/.test(idx1), idx1.slice(0, 600));
const pflicht = ['aufruf', 'zeit', 'dauer_s', 'tokens', 'kosten_usd', 'gueltigkeit', 'pruefer_befunde', 'rueckfall', 'anbieter', 'modell'];
for (const n of [1, 2, 3, 4]) {
  const f = path.join(o1, `plan-0${n}.md`);
  const t = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  check(`1 plan-0${n}.md: Frontmatter mit allen Pflichtfeldern`, pflicht.every((k) => fmKeys(t).includes(k)), frontmatter(t).slice(0, 300));
  check(`1 plan-0${n}.md: Plan, Rohantwort, Prompt-Link`, /## Plan/.test(t) && /## Rohantwort/.test(t) && /plan-0\d\.prompt\.txt/.test(t));
}
const m1 = fs.existsSync(path.join(o1, 'messung.json')) ? JSON.parse(fs.readFileSync(path.join(o1, 'messung.json'), 'utf8')) : {};
check('1 messung.json: 4 Aufrufe, Zusammenfassung, Budget', m1.aufrufe && m1.aufrufe.length === 4 && m1.zusammenfassung && m1.zusammenfassung.aufrufe === 4 && m1.zusammenfassung.budget && m1.zusammenfassung.budget.limit > 0, JSON.stringify(m1).slice(0, 200));
check('1 Logbuch des Spiels liegt im Lauf-Ordner (REGIE_DIR gesetzt, nicht im Temp der Fixture)', fs.existsSync(path.join(o1, 'regie')) && dateien(path.join(o1, 'regie')).some((f) => /\.jsonl$/.test(f)));
check('1 Fremddatei im --out-Ordner unberuehrt', fs.existsSync(path.join(out1, 'FREMD.txt')) && fs.readFileSync(path.join(out1, 'FREMD.txt'), 'utf8') === 'darf nie verschwinden');
check('1 nichts im Verzeichnis des Repos (cwd des Tools) abgelegt', !fs.existsSync(path.join(ROOT, 'ablage')));

// ---------- 2 ohne --out: bisheriges Verhalten (nur Konsole)
const sauber = (t) => t.split(/\r?\n/).filter((l) => /^(Messung Abenteuer|Aufrufe:|Gültigkeit:|Ablehnquote|Wiederholungsrate|Hinweis:)/.test(l)).join('\n');
const vorDateien = dateien(TMP).length;
const r2 = lauf('messe-abenteuer.js', ['--n', '4'], TMP);
check('2 ohne --out: Exit 0, Konsolenzusammenfassung mit allen Zeilen', r2.code === 0 && /Messung Abenteuer-Komposition: Mock/.test(r2.out) && /Aufrufe: 4/.test(r2.out) && /Gültigkeit:/.test(r2.out) && /Wiederholungsrate/.test(r2.out) && /Tokens: 0/.test(r2.out) && /Hinweis: Mock-Werte/.test(r2.out), r2.text);
check('2 ohne --out: kein "Ablage:", keine neue Datei', !/Ablage:/.test(r2.out) && dateien(TMP).length === vorDateien);
check('2 Zeilen (Aufrufe, Gueltigkeit, Ablehnquote, Wiederholungsrate) mit --out identisch zu ohne --out (Mock ist deterministisch)', sauber(r2.out) === sauber(r1.out) && sauber(r2.out).length > 100, sauber(r2.out) + '\n---\n' + sauber(r1.out));
const r2b = lauf('messe-abenteuer.js', ['--n', '2', '--mock'], TMP);
check('2 --mock ist Standard (gleiche Ausgabe, Exit 0)', r2b.code === 0 && /Aufrufe: 2/.test(r2b.out) && !/Ablage:/.test(r2b.out), r2b.text);

// ---------- 3 --out im Repo und kaputte Aufrufe
const r3 = lauf('messe-abenteuer.js', ['--mock', '--n', '2', '--out', path.join(ROOT, 'tools', 'fixtures', 'messung-nie')], TMP);
check('3 --out im Repo: Exit 2, Meldung, nichts angelegt', r3.code === 2 && /liegt im Repo/.test(r3.err) && !fs.existsSync(path.join(ROOT, 'tools', 'fixtures', 'messung-nie')), r3.text);
const r3b = lauf('messe-abenteuer.js', ['--mock', '--live', '--out', 'x'], TMP);
check('3 --mock zusammen mit --live: Exit 2', r3b.code === 2, r3b.text);
const r3c = lauf('messe-abenteuer.js', ['--mock', '--out'], TMP);
check('3 --out ohne Ordner: Exit 2', r3c.code === 2, r3c.text);
const r3d = lauf('messe-lage.js', ['--out', path.join(ROOT, 'data', 'messung-nie')], TMP);
check('3 messe-lage --out im Repo: Exit 2, nichts angelegt', r3d.code === 2 && !fs.existsSync(path.join(ROOT, 'data', 'messung-nie')), r3d.text);
for (const a of [['--plaene', '99'], ['--abend', '9'], ['--live', '--mock'], ['--spruenge', '0'], ['--auswerten']]) {
  const r = lauf('messe-lage.js', a, TMP);
  check(`3 messe-lage ${a.join(' ')}: Exit 2`, r.code === 2, r.text);
}

// ---------- 4 zweiter Lauf: neuer Ordner, Vorlauf unberuehrt
const vorher = dateien(o1).map((f) => [f, hash(f)]);
const r4 = lauf('messe-abenteuer.js', ['--mock', '--n', '2', '--out', out1], TMP);
const ordner4 = laufOrdner(out1);
check('4 zweiter Lauf im selben --out: Exit 0, jetzt zwei Lauf-Ordner', r4.code === 0 && ordner4.length === 2, r4.text + ordner4.join(','));
check('4 der erste Lauf ist Byte fuer Byte unveraendert (nichts geloescht, nichts ueberschrieben)', vorher.every(([f, h]) => fs.existsSync(f) && hash(f) === h) && dateien(o1).length === vorher.length);

// ---------- 5 messe-lage --mock --out
const out5 = path.join(TMP, 'lage-ablage');
const r5 = lauf('messe-lage.js', ['--mock', '--abend', '1', '--spruenge', '90', '--plaene', '2', '--out', out5], TMP);
check('5 messe-lage --mock: Exit 0, keine Serverfehler', r5.code === 0 && !/Serverfehler/.test(r5.out), r5.text);
const ordner5 = fs.existsSync(out5) ? laufOrdner(out5) : [];
check('5 genau ein Lauf-Ordner lage-mock-<Zeit>', ordner5.length === 1 && /lage-mock-\d{8}-\d{6}/.test(ordner5[0]), ordner5.join(','));
const o5 = ordner5[0] || out5;
const ab5 = path.join(o5, 'abend1');
const lagePlaene = fs.existsSync(ab5) ? fs.readdirSync(ab5).filter((n) => /^lage-\d+\.md$/.test(n)) : [];
const abenteuerPlaene = fs.existsSync(ab5) ? fs.readdirSync(ab5).filter((n) => /^abenteuer-\d+\.md$/.test(n)) : [];
check('5 je Lage-Plan eine Datei (2 Aufrufe) und je Abenteuer-Plan eine Datei (mindestens 1)', lagePlaene.length === 2 && abenteuerPlaene.length >= 1, fs.existsSync(ab5) ? fs.readdirSync(ab5).join(',') : 'kein abend1');
for (const n of ['index.md', 'auswertung.md', 'auswertung.json', 'messung.json']) check(`5 Datei ${n}`, fs.existsSync(path.join(o5, n)));
for (const n of ['plaene.json', 'ticks.jsonl', 'logbuch.jsonl', 'zusammenfassung.json', 'lage-01.prompt.txt']) check(`5 Datei abend1/${n}`, fs.existsSync(path.join(ab5, n)));
const l5 = fs.existsSync(path.join(o5, 'index.md')) ? links(path.join(o5, 'index.md')) : [];
check('5 index.md: jeder Plan verlinkt, alle Links loesen auf', l5.length >= 4 && l5.every((l) => fs.existsSync(l)) && lagePlaene.concat(abenteuerPlaene).every((n) => l5.some((l) => l.endsWith(n))), l5.join(','));
const pflichtLage = ['abend', 'art', 'aufruf', 'grenze', 'tick', 'zeit', 'dauer_s', 'tokens', 'kosten_usd', 'gueltigkeit', 'pruefer_befunde', 'rueckfall', 'anbieter', 'modell'];
for (const n of lagePlaene.concat(abenteuerPlaene)) {
  const t = fs.readFileSync(path.join(ab5, n), 'utf8');
  check(`5 ${n}: Frontmatter mit allen Pflichtfeldern, Rohantwort, Prompt-Link`, pflichtLage.every((k) => fmKeys(t).includes(k)) && /## Rohantwort/.test(t) && links(path.join(ab5, n)).every((l) => fs.existsSync(l)), frontmatter(t).slice(0, 300));
}
const aw = fs.existsSync(path.join(o5, 'auswertung.md')) ? fs.readFileSync(path.join(o5, 'auswertung.md'), 'utf8') : '';
check('5 auswertung.md: die vier Befunde als Zahlen (Anteil mit Befehlen ausser fokus, Ablehnquote, Rate, Absicht/Vorwarnung ja/nein)', /## 1\. Die Befehlsrate/.test(aw) && /## 2\. Claude sieht die Ablehnungen nicht/.test(aw) && /## 3\. Der Ausschnitt/.test(aw) && /## 4\. Absicht und Vorwarnung/.test(aw) && /Pläne mit Befehl außer `fokus` vorgeschlagen: \d+ von \d+ \(/.test(aw) && /Ablehnquote/.test(aw) && /Rate-Erschöpfung/.test(aw) && /Absicht der Crew gesetzt[^\n]*: (ja|nein)/.test(aw), aw.slice(0, 1500));
const pl5 = fs.existsSync(path.join(ab5, 'plaene.json')) ? JSON.parse(fs.readFileSync(path.join(ab5, 'plaene.json'), 'utf8')) : [];
check('5 plaene.json: Zuordnung ueber Nummer, jeder Lage-Plan mit Regie-Ergebnis und Prompt-Merkmalen', pl5.filter((p) => p.art === 'lage').length === 2 && pl5.filter((p) => p.art === 'lage').every((p) => p.res && p.merkmale && p.merkmale.befehle_frei === true), JSON.stringify(pl5.map((p) => [p.art, p.nr, !!p.res])));
const logb = fs.existsSync(path.join(ab5, 'logbuch.jsonl')) ? fs.readFileSync(path.join(ab5, 'logbuch.jsonl'), 'utf8').split('\n').filter(Boolean) : [];
check('5 Logbuch vollstaendig aus der Datei unter REGIE_DIR (Eintraege der Lage und der Abenteuer-Komposition)', logb.some((l) => /"art":"lage_grobplan"/.test(l)) && logb.some((l) => /"art":"abenteuer_bauplan"/.test(l)), String(logb.length));
// --auswerten: neue Datei mit Zeitstempel, die vorhandene bleibt
const vor5 = dateien(o5).map((f) => [f, hash(f)]);
const r5b = lauf('messe-lage.js', ['--auswerten', o5], TMP);
const neu5 = dateien(o5).filter((f) => !vor5.some(([g]) => g === f));
check('5 --auswerten: Exit 0, neue auswertung-<Zeit>.md, alle alten Dateien unveraendert', r5b.code === 0 && neu5.some((f) => /auswertung-\d{8}-\d{6}\.md$/.test(f)) && vor5.every(([f, h]) => hash(f) === h), r5b.text + neu5.join(','));

// ---------- 6 --live ohne LLM_LIVE
const out6 = path.join(TMP, 'live-ablage');
const r6 = lauf('messe-lage.js', ['--live', '--out', out6], TMP);
check('6 messe-lage --live ohne LLM_LIVE: "nicht gemessen", Exit 0, nichts angelegt (das Werkzeug setzt LLM_LIVE nie selbst)', r6.code === 0 && /nicht gemessen/.test(r6.out) && !fs.existsSync(out6), r6.text);
const r6b = lauf('messe-abenteuer.js', ['--live', '--n', '3', '--out', out6], TMP);
check('6 messe-abenteuer --live ohne LLM_LIVE: "nicht gemessen", Exit 0, nichts angelegt', r6b.code === 0 && /nicht gemessen/.test(r6b.out) && !fs.existsSync(out6), r6b.text);

// ---------- 7 Hilfsfunktionen
check('7 frontmatter: Zeichenketten als JSON, Listen, null', Ablage.frontmatter({ a: 'x"y', b: [1, 'z'], c: null, d: true }) === '---\na: "x\\"y"\nb: [1, "z"]\nc: null\nd: true\n---\n');
check('7 zaun: laenger als jede Gravis-Folge im Text', /^````\n/.test(Ablage.zaun('a ``` b')) && /^```json\n/.test(Ablage.zaun('x', 'json')));
check('7 median/p90', Ablage.median([1, 2, 3, 4]) === 2.5 && Ablage.perzentil([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90) === 9 && Ablage.median([]) === null);
let wirft = false; try { Ablage.wurzelPruefen(path.join(ROOT, 'x'), TMP); } catch (e) { wirft = e.code === 'ABLAGE'; }
check('7 wurzelPruefen: Pfad im Repo wirft, relativer Pfad ausserhalb gegen cwd aufgeloest', wirft && Ablage.wurzelPruefen('r', TMP) === path.join(TMP, 'r'));
const lo = Ablage.laufOrdner(path.join(TMP, 'lo'), 'p'), lo2 = Ablage.laufOrdner(path.join(TMP, 'lo'), 'p');
check('7 laufOrdner: zwei Aufrufe in derselben Sekunde ergeben zwei Ordner', lo !== lo2 && fs.existsSync(lo) && fs.existsSync(lo2));
let ueberschreibt = false; try { Ablage.schreibe(lo, 'a.txt', '1'); Ablage.schreibe(lo, 'a.txt', '2'); } catch (e) { ueberschreibt = e.code === 'EEXIST'; }
check('7 schreibe: eine vorhandene Datei wird nie ueberschrieben', ueberschreibt && fs.readFileSync(path.join(lo, 'a.txt'), 'utf8') === '1');

// ---------- 8 harte Deckelung bei Claude
const ba = fs.readFileSync(path.join(__dirname, 'messe-abenteuer.js'), 'utf8');
check('8 Claude hoechstens 10 Aufrufe, im Werkzeug dokumentiert', /Math\.min\(n \|\| 10, 10\)/.test(ba) && /hoechstens 10 Aufrufe/.test(ba));

// ---------- 9 Live-Pfad mit Fake-CLI (offline: CLAUDE_CLI zeigt auf tools/fixtures/messe/fake-claude.js; LLM_LIVE=1 steht nur im Kindprozess)
{
  const FAKE = path.join(__dirname, 'fixtures', 'messe', 'fake-claude.js');
  const zdir = path.join(TMP, 'zaehler'); fs.mkdirSync(zdir);
  const liveEnv = { LLM_LIVE: '1', CLAUDE_CLI: FAKE, CLAUDE_TOKEN_BUDGET: '300000', FAKE_FAIL_ERSTER: 'abenteuer', FAKE_ZAEHLER_DIR: zdir };
  const out9 = path.join(TMP, 'live-fake');
  const r9 = lauf('messe-abenteuer.js', ['--live', '--n', '3', '--out', out9], TMP, liveEnv);
  check('9 messe-abenteuer --live mit Fake-CLI: Exit 0', r9.code === 0 && /Ablage:/.test(r9.out), r9.text);
  const o9 = fs.existsSync(out9) ? laufOrdner(out9)[0] : null;
  const m9 = o9 && fs.existsSync(path.join(o9, 'messung.json')) ? JSON.parse(fs.readFileSync(path.join(o9, 'messung.json'), 'utf8')) : { aufrufe: [], zusammenfassung: {} };
  check('9 live: der erste Aufruf (Fehlaufruf) ist als Ausfall abgelegt, die anderen haben ihre eigene Antwort (keine verrutschte Zuordnung)', m9.aufrufe.length === 3 && m9.aufrufe[0].ausgang === 'ausfall' && m9.aufrufe[0].rohantwort.every((x) => x === null) && m9.aufrufe[1].rohantwort[0] && m9.aufrufe[1].typen && m9.aufrufe[1].typen === require('../server/sim/abenteuer-prompt.js').bauplanAusText(m9.aufrufe[1].rohantwort[0]).plan.beats.map((b) => b.typ).join('>'), JSON.stringify(m9.aufrufe.map((a) => [a.nr, a.ausgang, a.typen])));
  const p9 = o9 && fs.existsSync(path.join(o9, 'plan-01.md')) ? fs.readFileSync(path.join(o9, 'plan-01.md'), 'utf8') : '';
  check('9 live: plan-01.md nennt den Ausfall und "Keine Antwort"', /gueltigkeit: "ausfall"/.test(p9) && /Keine Antwort/.test(p9) && /EXIT/.test(p9), p9.slice(0, 500));
  const p9b = o9 && fs.existsSync(path.join(o9, 'plan-02.md')) ? fs.readFileSync(path.join(o9, 'plan-02.md'), 'utf8') : '';
  check('9 live: Frontmatter mit Kosten, Modell, Anbieter, Aufnahme', /kosten_usd: 0\.0123/.test(p9b) && /modell: "claude-fake-1"/.test(p9b) && /anbieter: "claude"/.test(p9b) && /aufnahme: "regie\/aufnahmen\/abenteuer\/[0-9a-f]{40}\.json"/.test(p9b), p9b.slice(0, 600));
  check('9 live: Aufnahmen (Prompt und Rohantwort je Aufruf) liegen im Lauf-Ordner (recordDir)', o9 && fs.existsSync(path.join(o9, 'regie', 'aufnahmen', 'abenteuer')) && fs.readdirSync(path.join(o9, 'regie', 'aufnahmen', 'abenteuer')).length >= 2);
  const zf9 = m9.zusammenfassung || {};
  check('9 live: Tokens gegen CLAUDE_TOKEN_BUDGET gezaehlt (Zaehler, Limit 300000, Kosten bekannt)', zf9.budget && zf9.budget.limit === 300000 && zf9.budget.zaehler_delta === 3600 && zf9.tokens === 3600 && Math.abs(zf9.kosten_usd - 0.0246) < 1e-9, JSON.stringify(zf9.budget) + ' ' + zf9.tokens + ' ' + zf9.kosten_usd);
  const out9b = path.join(TMP, 'live-fake-lage');
  const r9b = lauf('messe-lage.js', ['--live', '--abend', '1', '--plaene', '1', '--spruenge', '60', '--out', out9b], TMP, { ...liveEnv, FAKE_FAIL_ERSTER: 'lage' });
  check('9 messe-lage --live mit Fake-CLI: Exit 0, Ablage', r9b.code === 0 && /Ablage:/.test(r9b.out), r9b.text);
  const o9b = fs.existsSync(out9b) ? laufOrdner(out9b)[0] : null;
  const pl9 = o9b && fs.existsSync(path.join(o9b, 'abend1', 'plaene.json')) ? JSON.parse(fs.readFileSync(path.join(o9b, 'abend1', 'plaene.json'), 'utf8')) : [];
  const lage9 = pl9.filter((p) => p.art === 'lage');
  check('9 messe-lage live: der Fehlaufruf (Lage-Plan 1) steht als Rueckfall mit Fehler, ohne Regie-Ergebnis; die Datei wird trotzdem geschrieben', lage9.length === 1 && lage9[0].ausgang === 'fehler' && lage9[0].rueckfall === true && lage9[0].res === null && lage9[0].befunde.length > 0 && fs.existsSync(path.join(o9b, lage9[0].datei)), JSON.stringify(lage9.map((p) => [p.nr, p.ausgang, p.rueckfall])));
  check('9 messe-lage live: Aufnahmen und Logbuch im Lauf-Ordner, Fehler im Logbuch', o9b && fs.existsSync(path.join(o9b, 'abend1', 'regie')) && /"ausgang":"fehler"/.test(fs.readFileSync(path.join(o9b, 'abend1', 'logbuch.jsonl'), 'utf8')));
}

// ---------- 10 N7 (a): --auswerten prueft den Ordner wie --out (nie im Repo)   (b): gleicher Median in Konsole und index.md   N6: Kontingent im Index
{
  const shots = path.join(ROOT, 'shots'), vorherListe = fs.existsSync(shots) ? fs.readdirSync(shots).join('|') : null;
  const r10 = lauf('messe-lage.js', ['--auswerten', shots], TMP);
  check('10 messe-lage --auswerten <Ordner im Repo>: Exit 2, Meldung nennt den Ordner, nichts geschrieben', r10.code === 2 && /liegt im Repo/.test(r10.text) && /--auswerten/.test(r10.text) && (vorherListe === null || fs.readdirSync(shots).join('|') === vorherListe), r10.text);
  const r10b = lauf('messe-lage.js', ['--auswerten', path.relative(TMP, ROOT)], TMP);
  check('10 messe-lage --auswerten mit relativem Pfad ins Repo: ebenfalls Exit 2', r10b.code === 2 && /liegt im Repo/.test(r10b.text), r10b.text);
  const MA = require('./messe-abenteuer.js');
  check('10 Konsolen-Median = Ablage.median (gerade Anzahl: Mittel der beiden mittleren, nicht dauer[floor(n/2)])', MA.dauerText([1, 2, 3, 10]) === 'Median 2,5 s, max 10 s' && MA.dauerText([1, 2, 9]) === 'Median 2 s, max 9 s' && MA.dauerText([]) === 'Median – s, max – s' && MA.dauerText([4, 1]) === 'Median 2,5 s, max 4 s', [1, 2, 3, 10].map(String).join() + ' -> ' + MA.dauerText([1, 2, 3, 10]));
  // N6: Kontingent im Index (CLAUDE_TOKEN_BUDGET=1: Schwelle 0, der Zaehler ist am Anfang "erreicht")
  const out10 = path.join(TMP, 'kontingent-lage');
  const r10c = lauf('messe-lage.js', ['--mock', '--abend', '1', '--spruenge', '30', '--plaene', '1', '--out', out10], TMP, { CLAUDE_TOKEN_BUDGET: '1' });
  const o10 = fs.existsSync(out10) ? laufOrdner(out10)[0] : null;
  const idx10 = o10 && fs.existsSync(path.join(o10, 'index.md')) ? fs.readFileSync(path.join(o10, 'index.md'), 'utf8') : '';
  check('10 index.md: Abend mit erreichtem Kontingent ist ausdruecklich als gesperrt ausgewiesen, Zaehler prozessweit', r10c.code === 0 && /Kontingent erreicht: Abend 1 war wegen des Kontingents gesperrt/.test(idx10) && /prozessweit/.test(idx10) && /spaeteren|späteren Abende/.test(idx10), r10c.text + idx10.slice(0, 600));
  const mj10 = o10 && fs.existsSync(path.join(o10, 'messung.json')) ? JSON.parse(fs.readFileSync(path.join(o10, 'messung.json'), 'utf8')) : { abende_ergebnis: [] };
  check('10 messung.json: zusammenfassung.kontingent_gesperrt wahr', mj10.abende_ergebnis.length === 1 && mj10.abende_ergebnis[0].zusammenfassung.kontingent_gesperrt === true);
  check('10 LIV-02: der Stand kommt vom Server (kontingent.erreicht/schwelle/used), nicht aus einem Snapshot-Feld oder Funk', mj10.abende_ergebnis.length === 1 && mj10.abende_ergebnis[0].zusammenfassung.kontingent && mj10.abende_ergebnis[0].zusammenfassung.kontingent.erreicht === true && Number.isFinite(mj10.abende_ergebnis[0].zusammenfassung.kontingent.schwelle) && Number.isFinite(mj10.abende_ergebnis[0].zusammenfassung.kontingent.used));
  const idxNormal = fs.existsSync(path.join(o5, 'index.md')) ? fs.readFileSync(path.join(o5, 'index.md'), 'utf8') : '';
  check('10 ohne erreichtes Kontingent (Lauf 5): keine Sperr-Zeile, aber der Hinweis auf den prozessweiten Zaehler', !/war wegen des Kontingents gesperrt/.test(idxNormal) && /prozessweit/.test(idxNormal) && JSON.parse(fs.readFileSync(path.join(o5, 'messung.json'), 'utf8')).abende_ergebnis.every((a) => a.zusammenfassung.kontingent_gesperrt === false));
}

// ---------- Repo bleibt sauber
check('Repo: keine Ablage-Dateien entstanden (git status)', repoSpuren().join('\n') === spurenVorher, repoSpuren().join('\n'));

fs.rmSync(TMP, { recursive: true, force: true });   // das eigene mkdtemp-Verzeichnis dieses Tests
let bad = 0;
for (const r of results) { if (!r.ok) { bad++; console.log(`✗ ${r.name}${r.detail ? ' – ' + String(r.detail).slice(0, 400) : ''}`); } }
console.log(`${results.length - bad}/${results.length} Prüfungen ok`);
process.exit(bad ? 1 : 0);
