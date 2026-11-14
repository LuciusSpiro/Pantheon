'use strict';
// KAT-01 B: Waechter fuer das Kontextfeld beat_zaehler (abenteuer-prompt.js kontextVon, beatZaehler) und seine Regelzeile im Katalog – npm run test:katalog-beatzaehler.
// Offline, kein Claude-Aufruf. Das Feld zaehlt, wie oft jeder Beat-Typ in den Typenfolgen von letzte_abenteuer vorkam (genau die Liste, die im selben Kontext steht, also nach Brett-Quelle und Entdopplung).
//   a Zaehler stimmt fuer eine konstruierte Folge (von Hand gerechnet, nicht aus dem Erzeuger abgeleitet); nur Zahlen, sortiert, nie Namen/Titel
//   b leere letzte_abenteuer -> {}
//   c abschluss steht nie im Zaehler; nur Typen mit Zahl groesser 0
//   d Absichten-Modus (baueAbsicht): Kontext und Prompt enthalten das Feld nicht
//   e Katalogwachstum von KAT-01 gesamt hoechstens 800 gegenueber 11 945 (A + B); die Zeile selbst hoechstens 200 Zeichen
//   f Mutationsprobe: die Pruefung (zaehlerProbleme) wird mit falschen Zaehlern gefuettert und muss rot werden; ohne Regelzeile ist die Zeilenpruefung rot
//   g Prompt in allen vier Profilen hoechstens 15 350 Zeichen (Mock, tools/messe-abenteuer.js --out ausserhalb des Repos)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
process.chdir(path.join(__dirname, '..'));

const X = require('./faden-fixture.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const D = require('../server/sim/faden-daten.js');
const AP = require('../server/sim/abenteuer-prompt.js');
const Abs = require('../server/sim/absicht-pruefer.js');

const results = [];
const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail }); };
const BASIS = 11945, BUDGET = 800, PROMPT_MAX = 15350;

const t = X.F.neuesSpiel({ crew: 3, seed: 11, names: ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'], env: { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', ABENTEUER_ANSCHLUSS: '0' } });
const g = t.g;
g.lageSpielleiter = LS.create(g, { llm: LLM.create({ mode: 'mock' }), werte: { min_abstand_ticks: 1, deckel_je_sitzung: 0 }, abenteuerWerte: { deckel_je_sitzung: 0 } });
g.lageSchalter = true;
const W = AP.WERTE;
const kontext = (letzte) => AP.kontextVon(g, W, letzte, 0, '0305');

// Pruefung des Zaehlers gegen eine von Hand gerechnete Erwartung; leere Liste = stimmig. zaehl ist austauschbar (Mutationsprobe).
const LETZTE = [{ nr: 1, typen: ['landung', 'wrack', 'rettung', 'abschluss'] }, { nr: 2, typen: ['landung', 'verfolgung', 'abschluss'] }, { nr: 3, typen: ['landung', 'wrack', 'spur', 'abschluss'] }];
const ERWARTET = { landung: 3, rettung: 1, spur: 1, verfolgung: 1, wrack: 2 };
function zaehlerProbleme(zaehl) {
  const P = [];
  const z = zaehl(LETZTE.map((x) => x.typen));
  if (JSON.stringify(z) !== JSON.stringify(ERWARTET)) P.push('Zaehler ' + JSON.stringify(z));
  if (Object.keys(z).includes('abschluss')) P.push('abschluss im Zaehler');
  if (Object.values(z).some((v) => !Number.isInteger(v) || v <= 0)) P.push('Wert keine positive Zahl');
  if (JSON.stringify(zaehl([])) !== '{}') P.push('leer nicht {}');
  return P;
}

// ---------- a bis c
const kA = kontext(LETZTE);
check('a Kontext letzte_abenteuer ist die Liste der drei Folgen (Brett-Quelle leer im frischen Spiel)', JSON.stringify(kA.letzte_abenteuer) === JSON.stringify(LETZTE.map((x) => x.typen)), JSON.stringify(kA.letzte_abenteuer));
check('a beat_zaehler im Kontext: landung 3, wrack 2, rettung 1, spur 1, verfolgung 1; Schluessel sortiert', JSON.stringify(kA.beat_zaehler) === JSON.stringify(ERWARTET), JSON.stringify(kA.beat_zaehler));
check('a Zaehler stammt aus genau der Liste letzte_abenteuer (gleiche Folge zaehlt nach der Entdopplung einmal)', (() => { const k = kontext(LETZTE.concat([{ nr: 4, typen: LETZTE[0].typen }])); return JSON.stringify(k.beat_zaehler) === JSON.stringify(AP.beatZaehler(k.letzte_abenteuer)) && k.beat_zaehler.landung === 3; })());
check('a nur Zahlen, nie Namen oder Titel', Object.values(kA.beat_zaehler).every((v) => typeof v === 'number') && !/Mireille|Ouzo|Tzvi/.test(JSON.stringify(kA)));
check('a nur Beat-Typen der Daten', Object.keys(kA.beat_zaehler).every((k) => !!D.BEATS[k]));
check('a erscheint im Prompt von baue()', (() => { const b = AP.baue(g, { nr: 1, grenze: 'andocken', hex: '0305', letzte: LETZTE }); return !b.fehler && b.prompt.includes('"beat_zaehler":{"landung":3,"rettung":1,"spur":1,"verfolgung":1,"wrack":2}'); })());
check('b leere letzte_abenteuer -> beat_zaehler {}', JSON.stringify(kontext([]).beat_zaehler) === '{}' && JSON.stringify(kontext([]).letzte_abenteuer) === '[]');
check('c abschluss nie im Zaehler, auch wenn eine Folge ihn enthaelt', !('abschluss' in kA.beat_zaehler) && !('abschluss' in AP.beatZaehler([['abschluss', 'landung']])));
check('c nur Typen mit Zahl groesser 0 (unbekannter Typ zaehlt nicht)', JSON.stringify(AP.beatZaehler([['landung', 'zz_gibtsnicht']])) === '{"landung":1}');
check('a-c Zaehlerpruefung: keine Probleme mit dem echten Zaehler', zaehlerProbleme(AP.beatZaehler).length === 0, zaehlerProbleme(AP.beatZaehler).join(' / '));

// ---------- d Absichten-Modus
{
  const bau = AP.baueAbsicht(g, { nr: 1, grenze: 'andocken', hex: '0305', letzteAbsichten: [], werte: W, katalog: Abs.katalogStandard() });
  const k = bau.fehler ? {} : JSON.parse(/<kontext>\n([\s\S]*?)\n<\/kontext>/.exec(bau.prompt)[1]);
  check('d Absichten-Prompt: kein beat_zaehler im Kontext, Kontext-Schluessel unveraendert', !bau.fehler && !('beat_zaehler' in k) && Object.keys(k).sort().join() === 'chronik,crew,crew_geschichte,lage,laufend,letzte_absichten,ruf,tick,wendepunkte', Object.keys(k).join());
  check('d Absichten-Prompt nennt beat_zaehler nirgends (auch nicht im Katalog)', !bau.fehler && !/beat_zaehler/.test(bau.prompt));
}

// ---------- e Katalog
const text = AP.katalogText();
const zeile = text.split('\n').find((l) => l.startsWith('Kontext beat_zaehler:'));
check('e Regelzeile steht im Katalog, genau einmal, mit dem Wortlaut (nur Hinweis, nichts gesperrt)', !!zeile && text.split('beat_zaehler').length === 2 && zeile === 'Kontext beat_zaehler: wie oft jeder Beat-Typ in letzte_abenteuer vorkam (nur Zahlen). Meide Typen mit hohem Zaehler; nimm bevorzugt Typen, die dort fehlen oder selten sind.', zeile);
check('e die Zeile hat hoechstens 200 Zeichen', !!zeile && zeile.length <= 200, zeile && zeile.length);
check('e Katalog gesamt hoechstens 11 945 + 800 (KAT-01 A + B)', text.length <= BASIS + BUDGET, `${text.length} (Wachstum ${text.length - BASIS})`);
check('e kein Befehlston gegen einzelne Beats: die Zeile nennt keinen Beat-Typ', !!zeile && !Object.keys(D.BEATS).some((b) => new RegExp('\\b' + b + '\\b').test(zeile.replace('beat_zaehler', ''))));

// ---------- f Mutationsprobe
{
  const falsch = {
    'mit abschluss': (fo) => { const z = {}; for (const f of fo) for (const x of f.concat('abschluss')) z[x] = (z[x] || 0) + 1; return z; },
    'jede Folge nur einmal je Typ': (fo) => { const z = {}; for (const f of fo) for (const x of new Set(f)) if (D.BEATS[x] && !D.BEATS[x].abschluss) z[x] = (z[x] || 0) + 1; return z; },
    'immer leer': () => ({}),
    'unsortiert': (fo) => Object.fromEntries(Object.entries(AP.beatZaehler(fo)).reverse()),
  };
  for (const [n, f] of Object.entries(falsch)) check(`f Mutation "${n}" macht die Zaehlerpruefung rot`, zaehlerProbleme(f).length > 0);
  const ohneZeile = text.split('\n').filter((l) => !l.startsWith('Kontext beat_zaehler:')).join('\n');
  check('f ohne Regelzeile fehlt beat_zaehler im Katalog (die Zeilenpruefung e wuerde rot)', !ohneZeile.includes('beat_zaehler') && text.length - ohneZeile.length > 0);
}

// ---------- g Prompt in den vier Profilen (Mock)
{
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'katbz-'));
  const dir = path.join(__dirname, 'fixtures', 'messe', 'profile');
  const profile = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  check('g vier Profile vorhanden', profile.length === 4, profile.join());
  for (const p of profile) {
    const out = path.join(ordner, p);
    const r = spawnSync(process.execPath, [path.join(__dirname, 'messe-abenteuer.js'), '--n', '2', '--profil', path.join(dir, p), '--out', out], { encoding: 'utf8', env: Object.assign({}, process.env, { LLM_LIVE: '' }) });
    const lauf = fs.existsSync(out) ? fs.readdirSync(out).map((d) => path.join(out, d)) : [];
    const laengen = lauf.flatMap((d) => fs.readdirSync(d).filter((f) => /\.prompt\.txt$/.test(f)).map((f) => fs.readFileSync(path.join(d, f), 'utf8').length));
    const max = Math.max(0, ...laengen);
    check(`g Profil ${p}: Prompt hoechstens ${PROMPT_MAX} Zeichen (Maximum ${max}, ${laengen.length} Prompts)`, r.status === 0 && laengen.length >= 2 && max <= PROMPT_MAX, (r.stderr || '').slice(0, 120));
  }
  try { fs.rmSync(ordner, { recursive: true, force: true }); } catch (e) { /* egal */ }
}

const fail = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok    ' : 'FEHLER'} ${r.name}${!r.ok && r.detail !== undefined ? '  [' + r.detail + ']' : ''}`);
console.log(`\n${results.length - fail.length}/${results.length} Pruefungen bestanden`);
process.exit(fail.length ? 1 : 0);
