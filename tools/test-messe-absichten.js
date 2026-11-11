'use strict';
// SPL-02 G: Test der Kennzahlen des Messwerkzeugs im Modus Absichten (tools/messe-absichten.js, eingebunden in tools/messe-abenteuer.js). Kein Netz, kein Claude: reine Funktion mit von Hand gebauten Zeilen
// (die Erwartungen stehen hier selbst, nie aus dem Werkzeug abgeleitet) und zwei Mock-Laeufe des Werkzeugs als Kindprozess (Beat-Plan und Absichten, Welt mit Vorgeschichte, JSON).
// Geprueft wird: Gueltigkeit (erster Versuch, nach Verhandlung, abgelehnt je Code, Ausfall) · Verhandlungsquote · Vielfalt (Folgen, Absichten) · Bezugs- und Fortsetzungsquote · Prompt-Groessen getrennt (Kopf, Katalog,
// Kontext) und Tokens ÷3,5 · Kosten (Mock 0) · "nicht anwendbar" im Beat-Plan · Tabelle · Werkzeug-Lauf (JSON, deterministisch, Vorgeschichte) · Quelltext ohne Beat- und Absichtsnamen.
// Aufruf: node tools/test-messe-absichten.js        (npm run test:messe-absichten)
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
process.chdir(path.join(__dirname, '..'));
const MA = require('./messe-absichten.js');
const D = require('../server/sim/faden-daten.js');

let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const nah = (a, b) => Math.abs(a - b) < 1e-9;
const Z = (o) => Object.assign({ ausgang: 'gueltig', grund: null, verhandlung: 0, absicht: null, bezug_art: 'keiner', typen: [], fortsetzungBeat: false, tokens: 0, prompt_zeichen: 1000, kontext_zeichen: 300, katalog_zeichen: 600 }, o);

console.log('Kennzahlen: Absichten');
const zeilen = [
  Z({ absicht: 'a1', bezug_art: 'nsc', typen: ['x', 'y', 'z'] }),
  Z({ absicht: 'a1', bezug_art: 'nsc+ort', typen: ['x', 'y', 'z'] }),
  Z({ absicht: 'a2', bezug_art: 'ort', typen: ['x', 'z'], fortsetzungBeat: true }),
  Z({ absicht: 'a3', bezug_art: 'keiner', typen: ['y', 'z'] }),
  Z({ absicht: 'a2', bezug_art: 'keiner', typen: ['x', 'z'], verhandlung: 1, folge_zeichen: 700 }),
  Z({ ausgang: 'abgelehnt', grund: 'CODE_A', absicht: 'a1', bezug_art: 'nsc', verhandlung: 1, folge_zeichen: 500 }),
  Z({ ausgang: 'abgelehnt', grund: 'CODE_B', absicht: 'a3', bezug_art: 'keiner' }),
  Z({ ausgang: 'ausfall', grund: 'TIMEOUT', absicht: null, bezug_art: null, prompt_zeichen: 1200, kontext_zeichen: 400, katalog_zeichen: 600 }),
];
const k = MA.kennzahlen(zeilen, { modusAbsicht: true, live: false, systemZeichen: 700 });
ok(k.modus === 'absicht' && k.aufrufe === 8, 'Modus Absichten, 8 Aufrufe');
ok(k.gueltigkeit.gueltig === 5 && k.gueltigkeit.erster_versuch === 4 && k.gueltigkeit.nach_verhandlung === 1 && nah(k.gueltigkeit.erster_versuch_quote, 0.5) && nah(k.gueltigkeit.nach_verhandlung_quote, 0.125), 'gueltig 5: 4 im ersten Versuch (50 %), 1 nach Verhandlung (12,5 %)');
ok(k.gueltigkeit.abgelehnt === 2 && k.gueltigkeit.abgelehnt_je_code.CODE_A === 1 && k.gueltigkeit.abgelehnt_je_code.CODE_B === 1 && k.gueltigkeit.ausfall === 1 && k.gueltigkeit.ausfall_je_code.TIMEOUT === 1, 'abgelehnt 2 mit Grund-Codes je 1, Ausfall 1');
ok(k.verhandlung.aufrufe_mit_verhandlung === 2 && nah(k.verhandlung.quote, 0.25) && k.verhandlung.gerettet === 1 && nah(k.verhandlung.gerettet_quote, 0.5), 'Verhandlung: 2 von 8 (25 %), davon gerettet 1 (50 %)');
ok(k.vielfalt.gueltige_plaene === 5 && k.vielfalt.verschiedene_beat_folgen === 3 && k.vielfalt.verschiedene_absichten === 3 && k.vielfalt.absichten_je_name.a1 === 2, 'Vielfalt: 3 Beat-Folgen und 3 Absichten in 5 gueltigen Plaenen');
ok(k.bezug.plaene_mit_bezug === 3 && nah(k.bezug.quote, 0.6) && k.bezug.mit_nsc === 2, 'Bezugsquote 3 von 5 gueltigen (60 %), davon 2 mit NSC (abgelehnte zaehlen nicht)');
ok(k.fortsetzung.plaene === 3 && nah(k.fortsetzung.quote, 0.6), 'Fortsetzung: zwei Plaene mit NSC-Bezug plus ein Beat mit frueherem NSC = 3 von 5');
ok(k.prompt.aufrufe_gemessen === 8 && nah(k.prompt.zeichen, (7 * 1000 + 1200) / 8) && nah(k.prompt.katalog_zeichen, 600) && nah(k.prompt.kontext_zeichen, (7 * 300 + 400) / 8), 'Prompt: Mittel ueber alle Aufrufe, Katalog und Kontext getrennt');
ok(nah(k.prompt.kopf_zeichen, k.prompt.zeichen - k.prompt.kontext_zeichen - k.prompt.katalog_zeichen) && nah(k.prompt.tokens, k.prompt.zeichen / 3.5) && nah(k.prompt.katalog_tokens, 600 / 3.5), 'Kopf = Prompt minus Kontext minus Katalog, Tokens = Zeichen / 3,5');
ok(nah(k.prompt.system_tokens, 200) && nah(k.prompt.folgeprompt_zeichen, 600) && nah(k.prompt.folgeprompt_tokens, 600 / 3.5), 'Systemprompt 700 Z. = 200 Tokens, Folgeprompt der Verhandlung gemittelt (600 Z.)');
ok(k.kosten_usd === 0 && k.kosten_je_aufruf_usd === 0, 'Kosten im Mock 0');
ok(k.wiederholung.von === 4 && k.wiederholung.wiederholt === 1 && k.gelesen.lesbare_absichten === 7, 'Wiederholung: gleiche Absicht wie die vorige (a1,a1 = 1 von 4), 7 lesbare Absichten');
const txt = MA.kennzahlenZeilen(k).join('\n');
ok(/Bezugsquote \| 3 von 5 \(60 %\)/.test(txt) && /Fortsetzungsquote \| 3 von 5/.test(txt) && /gültig nach Verhandlung \| 1 \(12,5 %\)/.test(txt) && /Verhandlungsquote \| 2 von 8/.test(txt), 'Tabelle: Bezug, Fortsetzung, Verhandlung als lesbare Zeilen');
ok(/CODE_A 1/.test(txt) && /Kopf .*Katalog .*Kontext/.test(txt), 'Tabelle: Grund-Codes und Prompt getrennt (Kopf, Katalog, Kontext)');

console.log('Kennzahlen: Beat-Plan (Baseline) und Live-Kosten');
const kb = MA.kennzahlen([Z({ typen: ['x', 'y'] }), Z({ typen: ['x', 'y'] }), Z({ ausgang: 'abgelehnt', grund: 'CODE_A' })], { modusAbsicht: false, live: true, lesbarePlaene: 3 });
ok(kb.modus === 'beat-plan' && kb.verhandlung === null && kb.bezug === null && kb.vielfalt.verschiedene_absichten === null, 'Beat-Plan: Verhandlung, Bezug und Absichten sind null (nicht anwendbar)');
ok(kb.wiederholung.von === 1 && kb.wiederholung.wiederholt === 1 && kb.gelesen.lesbare_antworten === 3, 'Beat-Plan: Wiederholung ueber gueltige Folgen (1 von 1), 3 lesbare Antworten');
ok(kb.kosten_usd === null, 'live ohne gemeldete Kosten: null (nicht gemeldet), nie erfunden');
const kg = MA.kennzahlen([Z({ geld: 0.03 }), Z({ geld: 0.05 })], { modusAbsicht: true, live: true });
ok(nah(kg.kosten_usd, 0.08) && nah(kg.kosten_je_aufruf_usd, 0.04), 'live mit Kosten: Summe und je Aufruf');
ok(/nicht anwendbar/.test(MA.kennzahlenZeilen(kb).join('\n')), 'Tabelle Beat-Plan: "nicht anwendbar" statt leerer Zahlen');
const leer = MA.kennzahlen([], { modusAbsicht: true });
ok(leer.aufrufe === 0 && leer.gueltigkeit.gueltig_quote === null && leer.bezug.quote === null && MA.kennzahlenZeilen(leer).length > 5, 'leere Messung: keine Division durch null, Tabelle bleibt lesbar');

console.log('Werkzeug-Lauf (Mock, Kindprozess)');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-messe-absichten-'));
const lauf = (extra, env, json) => {
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'messe-abenteuer.js'), '--mock', '--n', '12', '--seed', '7', '--vorgeschichte', '--json', json].concat(extra || []), { cwd: TMP, encoding: 'utf8', env: Object.assign({}, process.env, { ABENTEUER_ABSICHTEN: '' }, env || {}), timeout: 120000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), json: fs.existsSync(path.join(TMP, json)) ? JSON.parse(fs.readFileSync(path.join(TMP, json), 'utf8')) : null };
};
const a1 = lauf([], { ABENTEUER_ABSICHTEN: '1' }, 'a1.json'), a2 = lauf([], { ABENTEUER_ABSICHTEN: '1' }, 'a2.json'), b1 = lauf([], {}, 'b1.json');
ok(a1.code === 0 && a1.json && a1.json.kennzahlen.modus === 'absicht' && a1.json.kennzahlen.aufrufe === 12, 'Lauf Absichten: Exit 0, JSON mit Kennzahlen (Modus Absichten, 12 Aufrufe)');
ok(a1.json && a1.json.kennzahlen.welt.vorgeschichte_faeden === 8 && a1.json.kennzahlen.welt.seed === 7, 'Welt mit Vorgeschichte: 8 abgeschlossene Faeden, Seed 7 im JSON');
ok(/Kennzahlen \(SPL-02 G, Modus Absichten/.test(a1.out) && /Bezugsquote/.test(a1.out) && /Fortsetzungsquote/.test(a1.out), 'Konsole: Tabelle der Kennzahlen');
ok(!/0 von 0 \(–\)/.test(a1.out), 'Konsole: die Zeile Wiederholungsrate ist im Modus Absichten gefuellt (nicht 0 von 0)');
ok(a2.json && JSON.stringify(a1.json.kennzahlen) === JSON.stringify(a2.json.kennzahlen), 'deterministisch: zwei Laeufe mit gleichem Seed liefern dieselben Kennzahlen');
ok(b1.code === 0 && b1.json && b1.json.kennzahlen.modus === 'beat-plan' && b1.json.kennzahlen.bezug === null, 'Lauf Beat-Plan: Modus beat-plan, Bezug nicht anwendbar');
ok(a1.json && b1.json && a1.json.kennzahlen.prompt.katalog_zeichen < b1.json.kennzahlen.prompt.katalog_zeichen, 'Katalog der Absichten (' + (a1.json && Math.round(a1.json.kennzahlen.prompt.katalog_zeichen)) + ') kleiner als der Beat-Katalog (' + (b1.json && Math.round(b1.json.kennzahlen.prompt.katalog_zeichen)) + ')');
const ohneVor = cp.spawnSync(process.execPath, [path.join(__dirname, 'messe-abenteuer.js'), '--mock', '--n', '6', '--seed', '9', '--json', 'c.json'], { cwd: TMP, encoding: 'utf8', env: Object.assign({}, process.env, { ABENTEUER_ABSICHTEN: '1' }), timeout: 120000 });
const cj = fs.existsSync(path.join(TMP, 'c.json')) ? JSON.parse(fs.readFileSync(path.join(TMP, 'c.json'), 'utf8')) : null;
ok(ohneVor.status === 0 && cj && cj.kennzahlen.welt.vorgeschichte_faeden === 0 && cj.kennzahlen.welt.seed === 9, 'ohne --vorgeschichte: Welt ohne Faeden, anderer Seed (9) wirkt');
const bad = (a) => cp.spawnSync(process.execPath, [path.join(__dirname, 'messe-abenteuer.js'), '--mock'].concat(a), { cwd: TMP, encoding: 'utf8', timeout: 60000 }).status;
ok(bad(['--seed', '0']) === 2 && bad(['--seed', 'x']) === 2 && bad(['--json']) === 2, 'falscher Aufruf (--seed 0, --seed x, --json ohne Datei): Exit 2');
ok(!fs.readdirSync(path.join(__dirname, '..')).some((f) => /^(a1|a2|b1|c)\.json$/.test(f)), 'keine JSON-Datei im Repo (relativ zum Aufrufer)');

console.log('Quelltext');
const quelle = fs.readFileSync(path.join(__dirname, 'messe-absichten.js'), 'utf8').replace(/^\/\/.*$/gm, '');
const kat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'faeden', 'absichten.json'), 'utf8'));
const namen = Object.keys(D.BEATS).concat(Object.keys(kat.absichten));
const treffer = namen.filter((nm) => new RegExp('[\'"`]' + nm + '[\'"`]').test(quelle));
ok(treffer.length === 0, 'messe-absichten.js nennt keinen Beat- und keinen Absichtsnamen' + (treffer.length ? ': ' + treffer.join(', ') : ''));
const fix = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'messe', 'vorgeschichte.json'), 'utf8'));
ok(fix.faeden.length === 8 && fix.faeden.every((f) => D.BEATS[f.typ]), 'Daten der Vorgeschichte: 8 Zeilen, jeder Typ ist ein Beat der Welt');

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
console.log(`\n${n - fails}/${n} ok${fails ? ', ' + fails + ' FEHLER' : ''}`);
process.exit(fails ? 1 : 0);
