'use strict';
// KAT-01 C1: Test der Kontext-Profile und des Gesamtdeckels von tools/messe-abenteuer.js (tools/messe-profil.js) – npm run test:messe-profil.
// Offline: Mock und die Fake-CLI (tools/fixtures/messe/fake-claude.js, LLM_LIVE=1 steht nur im Kindprozess), nie ein echter Aufruf; schreibt nur in ein mkdtemp-Verzeichnis. Geprueft:
//   1 Validierung (unbekanntes Feld, fehlender Name, falscher Hex-Typ, ...) im Modul und als Aufruf (Exit 2, nichts angelegt)
//   2 Profile a/b/c/d im Mock: Profil-Name in index.md/messung.json/plan-NN.md, landeplatz_arten und Prompt-Zeichen wie in _gemessen, Kontexte verschieden
//   3 Ziel reihum (Liste) und fest (ein Hex)   4 ohne --profil unveraendert (kein "Profil"; ein Profil nur mit Namen aendert nichts am Inhalt)
//   5 Gesamtdeckel mit Fake-CLI: Exit 3 mit kleinem Deckel, gesamtverbrauch.json (Tokens, USD, Eintrag je Lauf), zweiter Lauf sieht die Summe, kaputter Zaehler, Mock-Hinweis
//   6 Mutationsprobe: ohne Deckelpruefung (MESSE_DECKEL_TEST_AUS=1) laeuft derselbe Lauf durch – die Pruefungen von 5 wuerden rot
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const Profil = require('./messe-profil.js');
const results = [];
const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail }); };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-messe-profil-'));
const FAKE = path.join(__dirname, 'fixtures', 'messe', 'fake-claude.js');
const PROFILE = path.join(__dirname, 'fixtures', 'messe', 'profile');

const env = { ...process.env }; delete env.LLM_LIVE; delete env.REGIE_DIR; delete env.MITSCHNITT; delete env.MITSCHNITT_DIR; delete env.CLAUDE_TOKEN_BUDGET; delete env.MESSE_DECKEL_TEST_AUS; delete env.ABENTEUER_ABSICHTEN;
function lauf(args, extraEnv, cwd) {
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'messe-abenteuer.js'), ...args], { cwd: cwd || TMP, encoding: 'utf8', timeout: 240000, env: { ...env, ...(extraEnv || {}) } });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', text: (r.stdout || '') + (r.stderr || '') };
}
const laufOrdner = (wurzel) => (fs.existsSync(wurzel) ? fs.readdirSync(wurzel, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(wurzel, d.name)) : []);
const lies = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
const json = (f) => JSON.parse(lies(f) || 'null');
const profilDatei = (name, obj) => { const f = path.join(TMP, name + '.json'); fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj)); return f; };
const arten = (prompt) => { const m = /"landeplatz_arten":(\[[^\]]*\])/.exec(prompt); return m ? JSON.parse(m[1]) : null; };
const NL = String.fromCharCode(10);
const wirft = (f) => { try { f(); return null; } catch (e) { return e; } };

// ---------- 1 Validierung
const ok1 = { name: 'x' };
check('1 Modul: nur ein Name genuegt', !wirft(() => Profil.profilPruefen(ok1)));
check('1 Modul: unbekanntes Feld wird abgelehnt (Name im Fehler)', /unbekanntes Feld "krieg"/.test((wirft(() => Profil.profilPruefen({ name: 'x', krieg: 1 })) || {}).message));
check('1 Modul: fehlender Name / leerer Name / Name kein Text', [{}, { name: '' }, { name: 5 }, { crew_hex: '0305' }].every((p) => wirft(() => Profil.profilPruefen(p))));
check('1 Modul: falscher Hex-Typ (Zahl, kurzer Text, Liste mit Zahl, leere Liste) bei crew_hex/ziel_hex', [{ crew_hex: 305 }, { crew_hex: '305' }, { ziel_hex: 304 }, { ziel_hex: ['0304', 403] }, { ziel_hex: [] }, { ziel_hex: 'abcd' }].every((p) => wirft(() => Profil.profilPruefen({ name: 'x', ...p }))));
check('1 Modul: ziel_hex als Text oder Liste, crew_hex gueltig', !wirft(() => Profil.profilPruefen({ name: 'x', ziel_hex: '0203', crew_hex: '1004' })) && !wirft(() => Profil.profilPruefen({ name: 'x', ziel_hex: ['0304', '0403'] })));
check('1 Modul: krieg_ticks (negativ, Bruch, Text), chronik (Art, kurz zu lang, fremdes Feld), ruf (fremder Schluessel, Text), vorgeschichte (Zahl), _gemessen (Text)', [
  { krieg_ticks: -1 }, { krieg_ticks: 1.5 }, { krieg_ticks: '10' }, { chronik: [{ art: 'gibt_es_nicht', ref: 'p', kurz: 'a' }] }, { chronik: [{ art: 'plan', ref: 'p', kurz: 'x'.repeat(81) }] }, { chronik: [{ art: 'plan', ref: 'p', kurz: 'a', mehr: 1 }] },
  { ruf: { pir: 5 } }, { ruf: { rom: '5' } }, { vorgeschichte: 1 }, { _gemessen: 'x' }].every((p) => wirft(() => Profil.profilPruefen({ name: 'x', ...p }, require('../server/sim/chronik.js').ARTEN))));
for (const [bez, args, datei] of [
  ['unbekanntes Feld', ['--profil', profilDatei('p-feld', { name: 'x', foo: 1 })]],
  ['fehlender Name', ['--profil', profilDatei('p-name', { crew_hex: '0305' })]],
  ['falscher Hex-Typ', ['--profil', profilDatei('p-hex', { name: 'x', ziel_hex: 304 })]],
  ['kein JSON', ['--profil', profilDatei('p-kaputt', '{ nicht json')]],
  ['Datei fehlt', ['--profil', path.join(TMP, 'gibt-es-nicht.json')]],
  ['--profil ohne Datei', ['--profil']],
  ['--gesamtdeckel ohne --out', ['--gesamtdeckel', '1000']],
  ['--gesamtdeckel 0', ['--gesamtdeckel', '0', '--out', path.join(TMP, 'x0')]],
  ['--gesamtdeckel Text', ['--gesamtdeckel', 'viel', '--out', path.join(TMP, 'x0')]],
]) {
  const r = lauf(['--n', '1', ...args]);
  check(`1 Aufruf mit ${bez}: Exit 2, kein Lauf-Ordner`, r.code === 2 && !/Aufrufe:/.test(r.out) && laufOrdner(path.join(TMP, 'x0')).length === 0, r.text);
}
const rRel = lauf(['--n', '1', '--profil', 'p-rel.json'], {}, TMP);
check('1 Profilpfad ist relativ zum Aufrufer (Datei existiert dort nicht: Exit 2 mit dem aufgeloesten Pfad)', rRel.code === 2 && rRel.err.includes(path.join(TMP, 'p-rel.json')), rRel.text);
fs.writeFileSync(path.join(TMP, 'p-rel.json'), JSON.stringify({ name: 'rel' }));
const rRel2 = lauf(['--n', '1', '--profil', 'p-rel.json'], {}, TMP);
check('1 relativer Profilpfad gegen cwd des Aufrufers: Exit 2 entfaellt, Lauf geht durch', rRel2.code === 0 && /Profil: rel/.test(rRel2.out), rRel2.text);

// ---------- 2 Profile a/b/c/d im Mock
const gemessen = {}, ergebnis = {};
for (const p of ['a-hafen', 'b-nur-punkt', 'c-krieg', 'd-vorgeschichte']) {
  const datei = path.join(PROFILE, p + '.json');
  const prof = json(datei);
  gemessen[p] = prof._gemessen;
  const out = path.join(TMP, 'm-' + p);
  const r = lauf(['--n', '2', '--profil', datei, '--out', out]);
  const o = laufOrdner(out)[0] || out;
  const idx = lies(path.join(o, 'index.md')), m = json(path.join(o, 'messung.json')), pl = lies(path.join(o, 'plan-01.md'));
  const prompts = [1, 2].map((n) => lies(path.join(o, `plan-0${n}.prompt.txt`)));
  ergebnis[p] = { kontext: m && m.kennzahlen.prompt.kontext_zeichen, prompt: prompts.map((x) => x.length), arten: prompts.map(arten) };
  check(`2 ${p}: Exit 0, Ablage, Konsole nennt das Profil`, r.code === 0 && /Ablage:/.test(r.out) && new RegExp('Profil: ' + p).test(r.out), r.text);
  check(`2 ${p}: Profilname steht in index.md ("- Profil: ${p}"), messung.json (profil) und plan-NN.md (Frontmatter profil)`, idx.includes(`- Profil: ${p}\n`) && m && m.profil === p && /\nprofil: "/.test(pl) && pl.includes(`profil: "${p}"`), idx.slice(0, 300));
  check(`2 ${p}: landeplatz_arten je Aufruf wie in _gemessen`, JSON.stringify(ergebnis[p].arten) === JSON.stringify(gemessen[p].landeplatz_arten), JSON.stringify(ergebnis[p].arten) + ' <> ' + JSON.stringify(gemessen[p].landeplatz_arten));
  check(`2 ${p}: Prompt-Zeichen und Kontext-Mittel nahe _gemessen (5 Prozent)`, ergebnis[p].prompt.every((z, i) => Math.abs(z - gemessen[p].prompt_zeichen[i]) <= 0.05 * gemessen[p].prompt_zeichen[i]) && Math.abs(ergebnis[p].kontext - gemessen[p].kontext_zeichen_mittel) <= 0.05 * gemessen[p].kontext_zeichen_mittel, JSON.stringify(ergebnis[p]) + ' <> ' + JSON.stringify(gemessen[p]));
}
const ks = Object.values(ergebnis).map((e) => e.kontext);
check('2 die vier Profile liefern vier verschiedene Kontexte (Kontextzeichen paarweise verschieden)', new Set(ks).size === 4, ks.join(','));
check('2 Kontext waechst wie erwartet: c-krieg > d-vorgeschichte > a-hafen > b-nur-punkt', ergebnis['c-krieg'].kontext > ergebnis['d-vorgeschichte'].kontext && ergebnis['d-vorgeschichte'].kontext > ergebnis['a-hafen'].kontext && ergebnis['a-hafen'].kontext > ergebnis['b-nur-punkt'].kontext, ks.join(','));
check('2 b-nur-punkt: nur schiff/station, in beiden Aufrufen', ergebnis['b-nur-punkt'].arten.every((a) => JSON.stringify(a) === '["schiff","station"]'));
{
  const pc = lies(path.join(laufOrdner(path.join(TMP, 'm-c-krieg'))[0], 'plan-01.prompt.txt'));
  check('2 c-krieg: Ruf im Prompt (rom 150, ger -40), Krieg und Chronik im Kontext', /"ruf":\{"ger":-40,"kon":\d+,"rom":150\}/.test(pc) && /"wendepunkte":\[\{/.test(pc) && /"chronik":\["\d+: /.test(pc), pc.slice(pc.indexOf('"ruf"'), pc.indexOf('"ruf"') + 100));
  const pa = lies(path.join(laufOrdner(path.join(TMP, 'm-a-hafen'))[0], 'plan-01.prompt.txt'));
  check('2 a-hafen (Gegenprobe): kein Krieg im Kontext, Chronik leer', /"wendepunkte":\[\]/.test(pa) && !/"chronik":\["/.test(pa), pa.slice(pa.indexOf('"wendepunkte"'), pa.indexOf('"wendepunkte"') + 80));
}

// ---------- 3 Ziel reihum / fest
{
  const out = path.join(TMP, 'z-reihum');
  const r = lauf(['--n', '4', '--profil', path.join(PROFILE, 'a-hafen.json'), '--out', out]);
  const o = laufOrdner(out)[0] || out;
  const a = [1, 2, 3, 4].map((n) => arten(lies(path.join(o, `plan-0${n}.prompt.txt`))));
  check('3 ziel_hex [0304, 0403] reihum: Aufruf 1 bis 4 wechseln 2 Arten / 4 Arten / 2 / 4', r.code === 0 && a.map((x) => x && x.length).join() === '2,4,2,4', JSON.stringify(a));
  const dreier = profilDatei('z-drei', { name: 'z-drei', ziel_hex: ['0304', '0403', '0203'] });
  const out3 = path.join(TMP, 'z-drei-out');
  lauf(['--n', '4', '--profil', dreier, '--out', out3]);
  const a3 = [1, 2, 3, 4].map((n) => arten(lies(path.join(laufOrdner(out3)[0], `plan-0${n}.prompt.txt`))));
  check('3 Liste mit drei Hexen: reihum und wieder von vorn (2, 4, 2, 2)', a3.map((x) => x && x.length).join() === '2,4,2,2', JSON.stringify(a3));
  const out0 = path.join(TMP, 'z-ohne');
  lauf(['--n', '4', '--profil', profilDatei('z-ohne', { name: 'z-ohne' }), '--out', out0]);
  const a0 = [1, 2, 3, 4].map((n) => JSON.stringify(arten(lies(path.join(laufOrdner(out0)[0], `plan-0${n}.prompt.txt`)))));
  const outN = path.join(TMP, 'z-kein');
  lauf(['--n', '4', '--out', outN]);
  const aN = [1, 2, 3, 4].map((n) => JSON.stringify(arten(lies(path.join(laufOrdner(outN)[0], `plan-0${n}.prompt.txt`)))));
  check('3 ohne ziel_hex bleibt das wandernde Ziel (gleiche Arten wie ohne Profil)', a0.join('|') === aN.join('|'), a0.join('|') + ' <> ' + aN.join('|'));
}

// ---------- 4 ohne --profil unveraendert
{
  const norm = (t) => t.replace(/run-\d+-\d+/g, 'run').replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, 'T').replace(/abenteuer-mock-[\d-]+(-\d+)?/g, 'L').replace(/\\x[0-9a-f]{2}/g, '').replace(/(Laufzeit|Dauer je Aufruf|dauer_s|dauer_median_s|dauer_p90_s|dauer_max_s)[^\n]*/g, '$1').replace(/- Aufruf: [^\n]*/, '').replace(/"aufruf":\s*\[[^\]]*\]/, '').replace(/\| \d+(,\d+)? \| (\d+) \| – \|/g, '| D | $2 | – |').replace(/^- Profil: [^\n]*\n/m, '').replace(/^profil: [^\n]*\n/gm, '').replace(/\s*"profil": "[^"]*",?/, '').replace(/\n\s*"profil": "[^"]*"/, '');
  const outO = path.join(TMP, 'o-ohne'), outP = path.join(TMP, 'o-mit');
  const rO = lauf(['--n', '4', '--out', outO]), rP = lauf(['--n', '4', '--profil', profilDatei('o-leer', { name: 'o-leer' }), '--out', outP]);
  const oO = laufOrdner(outO)[0], oP = laufOrdner(outP)[0];
  const alle = [rO.out + rP.out].join('');
  const ohneAufruf = (s) => s.split(NL).filter((l) => !/^- Aufruf: /.test(l)).join(NL);
  check('4 ohne --profil: nirgends "Profil:" / profil-Feld (Konsole, index.md, messung.json, plan-NN.md)', !/Profil:/.test(rO.out) && !/Profil:|^profil:|"profil"/m.test(['index.md', 'messung.json', 'plan-01.md', 'plan-04.md'].map((f) => ohneAufruf(lies(path.join(oO, f)))).join('')) && alle.length > 0);
  const mj = (o) => { const m = json(path.join(o, 'messung.json')); delete m.profil; delete m.kennzahlen.welt.profil; delete m.aufruf; delete m.erstellt; delete m.zusammenfassung.dauer_median_s; delete m.zusammenfassung.dauer_p90_s; delete m.zusammenfassung.dauer_max_s; for (const a of m.aufrufe) delete a.dauer_s; delete m.kennzahlen.dauer; return JSON.stringify(m); };
  check('4 ein Profil nur mit Namen aendert nichts an Plaenen, Prompts, Kennzahlen, Rohantworten (Zeit und Profilzeile abgesehen)', ['plan-01.prompt.txt', 'plan-04.prompt.txt'].every((f) => lies(path.join(oO, f)) === lies(path.join(oP, f))) && mj(oO) === mj(oP) && ['plan-02.md', 'index.md'].every((f) => norm(lies(path.join(oO, f))) === norm(lies(path.join(oP, f)))), ['plan-02.md', 'index.md'].filter((f) => norm(lies(path.join(oO, f))) !== norm(lies(path.join(oP, f)))).join() + (mj(oO) === mj(oP) ? '' : ' messung.json'));
  check('4 Konsole: nur die Zeile "Profil:" kommt hinzu', rP.out.split(/\r?\n/).filter((l) => !/^Profil: /.test(l) && !/Laufzeit|Ablage:/.test(l)).join('\n') === rO.out.split(/\r?\n/).filter((l) => !/Laufzeit|Ablage:/.test(l)).join('\n'));
}

// ---------- 5 Gesamtdeckel mit Fake-CLI (Aufruf = 4000 + 500 + 300 = 4800 Tokens, 0.0123 USD)
const liveEnv = (z) => ({ LLM_LIVE: '1', CLAUDE_CLI: FAKE, CLAUDE_TOKEN_BUDGET: '900000', FAKE_INPUT_TOKENS: '4000', FAKE_ZAEHLER_DIR: z });
check('5 deckelPruefen: Summe >= Deckel, Summe + Schaetzwert > Deckel, genau am Rand ok', Profil.deckelPruefen(100, 100, 1).ok === false && Profil.deckelPruefen(0, 100, 101).ok === false && Profil.deckelPruefen(0, 100, 100).ok === true && Profil.deckelPruefen(99, 100, 1).ok === true && Profil.deckelPruefen(100, 100, 0).ok === false);
const zd = path.join(TMP, 'zaehler'); fs.mkdirSync(zd);
const wurzel = path.join(TMP, 'deckel');
const profA = path.join(PROFILE, 'a-hafen.json');
const r5 = lauf(['--live', '--n', '6', '--profil', profA, '--out', wurzel, '--gesamtdeckel', '15000'], liveEnv(zd));
const v5 = json(path.join(wurzel, 'gesamtverbrauch.json'));
const o5 = laufOrdner(wurzel)[0] || wurzel;
const idx5 = lies(path.join(o5, 'index.md')), m5 = json(path.join(o5, 'messung.json'));
check('5 kleiner Deckel (15 000): Exit 3, Meldung "Deckel erreicht nach 3 Aufrufen"', r5.code === 3 && /Deckel erreicht nach 3 Aufrufen/.test(r5.out), r5.text);
check('5 index.md nennt "Deckel erreicht nach 3 Aufrufen" und das Profil; messung.json: 3 Aufrufe, Abbruch gesetzt', /Deckel erreicht nach 3 Aufrufen/.test(idx5) && /- Profil: a-hafen/.test(idx5) && m5 && m5.aufrufe.length === 3 && /Deckel erreicht/.test(m5.abbruch), idx5.slice(0, 600));
check('5 gesamtverbrauch.json: 14 400 Tokens, 0,0369 USD, ein Lauf-Eintrag (3 Aufrufe, Profil a-hafen, Zeitstempel)', v5 && v5.tokens === 14400 && Math.abs(v5.kosten_usd - 0.0369) < 1e-9 && v5.laeufe.length === 1 && v5.laeufe[0].aufrufe === 3 && v5.laeufe[0].tokens === 14400 && v5.laeufe[0].profil === 'a-hafen' && !isNaN(Date.parse(v5.laeufe[0].zeit)) && v5.laeufe[0].lauf === path.basename(o5), JSON.stringify(v5));
check('5 keine Temp-Datei des atomaren Schreibens zurueckgeblieben', !fs.readdirSync(wurzel).some((n) => /\.tmp$/.test(n)), fs.readdirSync(wurzel).join());
// zweiter Lauf unter derselben Wurzel: sieht die Summe, macht keinen Aufruf
const r5b = lauf(['--live', '--n', '3', '--profil', path.join(PROFILE, 'b-nur-punkt.json'), '--out', wurzel, '--gesamtdeckel', '15000'], liveEnv(zd));
const v5b = json(path.join(wurzel, 'gesamtverbrauch.json'));
check('5 zweiter Lauf (anderes Profil, selbe Wurzel): sieht 14 400, kein Aufruf, Exit 3, Summe unveraendert, zweiter Eintrag mit 0 Aufrufen', r5b.code === 3 && /Deckel erreicht nach 0 Aufrufen/.test(r5b.out) && v5b.tokens === 14400 && v5b.laeufe.length === 2 && v5b.laeufe[1].aufrufe === 0 && v5b.laeufe[1].profil === 'b-nur-punkt', r5b.text + JSON.stringify(v5b));
// dritter Lauf mit grossem Deckel: zaehlt auf der alten Summe weiter
const r5c = lauf(['--live', '--n', '2', '--out', wurzel, '--gesamtdeckel', '100000'], liveEnv(zd));
const v5c = json(path.join(wurzel, 'gesamtverbrauch.json'));
check('5 dritter Lauf mit Deckel 100 000: Exit 0, 2 Aufrufe, Summe 14 400 + 9 600 = 24 000, Lauf ohne Profil traegt profil null', r5c.code === 0 && v5c.tokens === 24000 && v5c.laeufe.length === 3 && v5c.laeufe[2].aufrufe === 2 && v5c.laeufe[2].profil === null, r5c.text + JSON.stringify(v5c));
// ohne --gesamtdeckel: Verhalten wie bisher (keine Datei)
const wo = path.join(TMP, 'ohne-deckel');
const r5d = lauf(['--live', '--n', '2', '--out', wo], liveEnv(zd));
check('5 ohne --gesamtdeckel: Exit 0, 2 Aufrufe, keine gesamtverbrauch.json', r5d.code === 0 && !fs.existsSync(path.join(wo, 'gesamtverbrauch.json')) && /Aufrufe: 2/.test(r5d.out), r5d.text);
// Mock: Hinweis, kein Fehler, keine Datei
const wm = path.join(TMP, 'mock-deckel');
const r5e = lauf(['--n', '2', '--out', wm, '--gesamtdeckel', '1000']);
check('5 Mock mit --gesamtdeckel: Hinweis, Exit 0, keine gesamtverbrauch.json', r5e.code === 0 && /--gesamtdeckel gilt nur fuer Claude/.test(r5e.out) && !fs.existsSync(path.join(wm, 'gesamtverbrauch.json')), r5e.text);
// kaputter Zaehler: kein Aufruf, kein Ueberschreiben
const wk = path.join(TMP, 'kaputt'); fs.mkdirSync(wk);
fs.writeFileSync(path.join(wk, 'gesamtverbrauch.json'), '{ kaputt');
const r5f = lauf(['--live', '--n', '2', '--out', wk, '--gesamtdeckel', '100000'], liveEnv(zd));
check('5 kaputter Zaehler: Lauf bricht ab (Exit 1), Datei unveraendert, kein Plan geschrieben', r5f.code === 1 && lies(path.join(wk, 'gesamtverbrauch.json')) === '{ kaputt' && !laufOrdner(wk).some((d) => fs.existsSync(path.join(d, 'plan-01.md'))), r5f.text);
// Abbruch mitten im Lauf verliert nichts: die Datei ist nach jedem Aufruf aktuell (Zwischenstand ueber einen Deckel, der nach Aufruf 1 greift)
const wz = path.join(TMP, 'zwischen');
lauf(['--live', '--n', '6', '--out', wz, '--gesamtdeckel', '12000'], liveEnv(zd));
check('5 Deckel 12 000: ein Aufruf (4 800), danach 4 800 + 4 800 <= 12 000 noch ein zweiter, dann Schluss: Summe 9 600', json(path.join(wz, 'gesamtverbrauch.json')).tokens === 9600);

// ---------- 6 Mutationsprobe: ohne Deckelpruefung laeuft der Lauf durch
const wmut = path.join(TMP, 'mutation');
const rM = lauf(['--live', '--n', '6', '--profil', profA, '--out', wmut, '--gesamtdeckel', '15000'], { ...liveEnv(zd), MESSE_DECKEL_TEST_AUS: '1' });
const vM = json(path.join(wmut, 'gesamtverbrauch.json'));
check('6 Mutation (Deckelpruefung aus): Lauf geht durch (Exit 0, 6 Aufrufe, 28 800 Tokens ueber dem Deckel) – genau das fangen die Pruefungen von 5 (Exit 3, 3 Aufrufe, 14 400)', rM.code === 0 && vM.tokens === 28800 && vM.laeufe[0].aufrufe === 6 && !(rM.code === 3 && vM.tokens === 14400), rM.text + JSON.stringify(vM));

fs.rmSync(TMP, { recursive: true, force: true });   // das eigene mkdtemp-Verzeichnis dieses Tests
let bad = 0;
for (const r of results) { if (!r.ok) { bad++; console.log(`✗ ${r.name}${r.detail ? ' – ' + String(r.detail).slice(0, 500) : ''}`); } }
console.log(`${results.length - bad}/${results.length} Prüfungen ok`);
process.exit(bad ? 1 : 0);
